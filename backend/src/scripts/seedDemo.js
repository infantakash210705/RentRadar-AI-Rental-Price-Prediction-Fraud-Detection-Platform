/**
 * Demo data: ~64 realistic listings across 8 cities + 4 deliberately suspicious ones
 * (so the admin fraud queue has examples). Requires the ML service for fair-price generation.
 *   npm run seed:demo            (set DEMO_PASSWORD to choose the demo accounts' password)
 */
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const ml = require('../services/mlClient');
const { analyzeListing } = require('../services/listingAnalysis');

const CITIES = {
  Bengaluru: [12.9716, 77.5946, ['Indiranagar', 'Koramangala', 'Whitefield', 'HSR Layout', 'Jayanagar', 'Electronic City']],
  Mumbai: [19.076, 72.8777, ['Bandra', 'Andheri', 'Powai', 'Thane', 'Borivali', 'Worli']],
  Delhi: [28.6139, 77.209, ['Saket', 'Dwarka', 'Rohini', 'Lajpat Nagar', 'Janakpuri', 'Vasant Kunj']],
  Hyderabad: [17.385, 78.4867, ['Gachibowli', 'Madhapur', 'Kukatpally', 'Banjara Hills', 'Miyapur', 'Uppal']],
  Chennai: [13.0827, 80.2707, ['Adyar', 'Anna Nagar', 'Velachery', 'Tambaram', 'Porur', 'Guindy']],
  Kolkata: [22.5726, 88.3639, ['Salt Lake', 'New Town', 'Ballygunge', 'Howrah', 'Jadavpur', 'Behala']],
  Pune: [18.5204, 73.8567, ['Koregaon Park', 'Hinjewadi', 'Baner', 'Kothrud', 'Wakad', 'Hadapsar']],
  Ahmedabad: [23.0225, 72.5714, ['Satellite', 'Bopal', 'Navrangpura', 'Maninagar', 'Vastrapur', 'Chandkheda']],
};
const AMEN = ['parking', 'lift', 'gym', 'pool', 'security', 'power backup', 'garden', 'clubhouse', 'balcony', 'ac', 'wifi'];
const OPEN = [
  (a) => `Well-kept home in ${a}, in a quiet lane away from the main road.`,
  (a) => `Located in the heart of ${a} with everything you need within walking distance.`,
  (a) => `Comfortable family home in a calm pocket of ${a}.`,
  (a) => `Newly repainted flat available in ${a}, ready for immediate move-in.`,
  (a) => `Airy, well-lit apartment in a popular part of ${a}.`,
  (a) => `Neat and practical layout in a settled residential society in ${a}.`,
];
const MID = [
  'Two balconies overlook a green courtyard and the rooms get sun most of the day.',
  'The kitchen has granite counters, a chimney and plenty of cabinet space.',
  'Wardrobes are built in to every bedroom and the flooring is vitrified tile.',
  'The society has a caretaker on site and visitor parking near the gate.',
  'Water supply is steady with a borewell backup, and the building is earthquake-rated.',
  'Rooms are cross-ventilated, so fans are enough most of the year.',
];
const END = [
  'A bus stop and a grocery store are about five minutes away on foot.',
  'Two good schools and a hospital are within a short drive.',
  'Office hubs are reachable in about twenty-five minutes at normal traffic.',
  'Weekend markets, a bakery and a small park are right around the corner.',
  'Preference for a small family or working professionals; pets can be discussed.',
  'The owner lives nearby and responds quickly to maintenance requests.',
];
const describe = (area) => `${pick(OPEN)(area)} ${pick(MID)} ${pick(END)}`;

let seed = 20261028;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

(async () => {
  const password = process.env.DEMO_PASSWORD || crypto.randomBytes(6).toString('base64url') + '1a';
  const hash = await bcrypt.hash(password, 10);
  const owners = [];
  for (let i = 1; i <= 4; i++) {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id, email`,
      [`Demo Owner ${i}`, `demo.owner${i}@rentradar.local`, hash, `+91 98${String(10000000 + i * 1111111).slice(0, 8)}`]
    );
    owners.push(rows[0].id);
  }
  const existing = await db.query('SELECT count(*)::int n FROM listings WHERE owner_id = ANY($1)', [owners]);
  if (existing.rows[0].n > 0) { console.log(`Demo data already present (${existing.rows[0].n} listings). Nothing to do.`); return db.close(); }
  if (!(await ml.predictRent({ city: 'Pune', area: 'Baner', size_sqft: 900, bhk: 2 }))) {
    throw new Error('ML service is not reachable (ML_SERVICE_URL). Start it first so fair prices can be generated.');
  }

  const insert = (o, owner) => db.query(
    `INSERT INTO listings (owner_id, title, description, city, area, latitude, longitude, size_sqft, bhk, bathrooms, furnishing, rent, amenities)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [owner, o.title, o.description, o.city, o.area, o.lat, o.lng, o.size, o.bhk, o.bath, o.furnishing, o.rent, o.amenities]
  ).then((r) => r.rows[0].id);

  const ids = [];
  const make = async (city, area, forceRentFactor) => {
    const [clat, clng] = CITIES[city];
    const bhk = pick([1, 1, 2, 2, 2, 3, 3, 4]);
    const size = Math.round((280 + 330 * bhk + (rnd() - 0.5) * 220) / 10) * 10;
    const furnishing = pick(['unfurnished', 'semi-furnished', 'furnished']);
    const amenities = [...new Set(Array.from({ length: Math.floor(rnd() * 6) }, () => pick(AMEN)))];
    const base = { city, area, size_sqft: size, bhk, bathrooms: Math.min(bhk, 3), furnishing, amenities };
    const fair = (await ml.predictRent(base)).predicted_rent;
    return {
      ...base, bath: base.bathrooms, size, furnishing, amenities, city, area,
      title: `${bhk} BHK ${furnishing.replace('-', ' ')} home in ${area}`, description: describe(area),
      lat: +(clat + (rnd() - 0.5) * 0.12).toFixed(6), lng: +(clng + (rnd() - 0.5) * 0.12).toFixed(6),
      rent: Math.max(1000, Math.round((fair * (forceRentFactor ?? 0.88 + rnd() * 0.26)) / 500) * 500),
    };
  };

  for (const city of Object.keys(CITIES)) {
    for (let i = 0; i < 8; i++) ids.push(await insert(await make(city, pick(CITIES[city][2])), pick(owners)));
  }
  // Suspicious examples for the admin queue
  const scam = await make('Bengaluru', 'Indiranagar', 0.15);
  ids.push(await insert({ ...scam, title: 'URGENT!!! Cheap 2BHK Indiranagar', description: 'Owner is abroad. Send advance payment before visit via western union. Hurry, last chance!' }, owners[3]));
  const dupSrc = ids[0];
  const { rows: src } = await db.query('SELECT * FROM listings WHERE id = $1', [dupSrc]);
  ids.push(await insert({ title: src[0].title, description: src[0].description, city: src[0].city, area: src[0].area, lat: src[0].latitude, lng: src[0].longitude, size: src[0].size_sqft, bhk: src[0].bhk, bath: src[0].bathrooms, furnishing: src[0].furnishing, rent: Math.round(src[0].rent * 0.6), amenities: src[0].amenities }, owners[3]));
  const wrongPin = await make('Pune', 'Baner');
  ids.push(await insert({ ...wrongPin, lat: 19.076, lng: 72.8777, title: 'Lovely flat in Baner, Pune' }, owners[3])); // pin is in Mumbai
  const tiny = await make('Chennai', 'Adyar');
  ids.push(await insert({ ...tiny, bhk: 4, size: 300, bath: 6, title: '3BHK luxury apartment Adyar' }, owners[3]));

  for (const id of ids) await analyzeListing(id); // runs the real AI pipeline: prediction + fraud scoring + status

  const { rows } = await db.query(`SELECT status, count(*)::int n FROM listings WHERE owner_id = ANY($1) GROUP BY status`, [owners]);
  console.log('Demo listings created:', rows.map((r) => `${r.n} ${r.status}`).join(', '));
  console.log(`Demo owner logins: demo.owner1@rentradar.local ... demo.owner4@rentradar.local   password: ${password}`);
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
