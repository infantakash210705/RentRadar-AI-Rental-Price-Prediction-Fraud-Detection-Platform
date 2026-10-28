'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, imageUrl } from '@/lib/api';
import { AMENITIES, amenityLabel, computeVerdict, formatRent } from '@/lib/format';
import type { Furnishing, Listing, ListingInput, ListingStatus, Prediction } from '@/lib/types';
import type { GeoResult } from '@/lib/geocode';
import FairPriceGauge from './FairPriceGauge';
import LocationPicker, { type LatLng } from './LocationPicker';
import { Alert, Button, Card, Field, Input, Select } from './ui';

const MAX_IMAGES = 8, MAX_MB = 5, TYPES = ['image/jpeg', 'image/png', 'image/webp'];
type Errors = Record<string, string>;

export default function ListingForm({ initial }: { initial?: Listing }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: initial?.title ?? '', description: initial?.description ?? '', city: initial?.city ?? '', area: initial?.area ?? '',
    address: initial?.address ?? '', size: String(initial?.size_sqft ?? ''), bhk: String(initial?.bhk ?? '2'),
    bathrooms: String(initial?.bathrooms ?? '1'), furnishing: (initial?.furnishing ?? 'unfurnished') as Furnishing, rent: String(initial?.rent ?? ''),
  });
  const [amenities, setAmenities] = useState<string[]>(initial?.amenities ?? []);
  const [loc, setLoc] = useState<LatLng | null>(initial ? { lat: initial.latitude, lng: initial.longitude } : null);
  const [existing, setExisting] = useState(initial?.images ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [predNote, setPredNote] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  // Live AI rent suggestion (debounced)
  useEffect(() => {
    const size = Number(f.size), bhk = Number(f.bhk);
    if (!f.city.trim() || !f.area.trim() || !(size >= 50) || !(bhk >= 1)) { setPred(null); setPredNote(''); return; }
    const t = setTimeout(async () => {
      try {
        setPred(await api<Prediction>('/predict', { method: 'POST', body: { city: f.city, area: f.area, size_sqft: size, bhk, bathrooms: Number(f.bathrooms) || 1, furnishing: f.furnishing, amenities } }));
        setPredNote('');
      } catch (e) { setPred(null); setPredNote(errorMessage(e)); }
    }, 700);
    return () => clearTimeout(t);
  }, [f.city, f.area, f.size, f.bhk, f.bathrooms, f.furnishing, amenities]);

  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const problems: string[] = []; const ok: File[] = [];
    for (const file of Array.from(list)) {
      if (!TYPES.includes(file.type)) problems.push(`${file.name}: only JPEG, PNG or WebP`);
      else if (file.size > MAX_MB * 1024 * 1024) problems.push(`${file.name}: larger than ${MAX_MB} MB`);
      else ok.push(file);
    }
    const room = MAX_IMAGES - existing.length - files.length;
    if (ok.length > room) problems.push(`You can add ${Math.max(room, 0)} more photo(s) (max ${MAX_IMAGES})`);
    setFiles([...files, ...ok.slice(0, Math.max(room, 0))]);
    setErrors((e) => ({ ...e, photos: problems.join('. ') }));
  }
  async function removeExisting(id: string) {
    if (!initial) return;
    try { await api(`/listings/${initial.id}/images/${id}`, { method: 'DELETE' }); setExisting(existing.filter((i) => i.id !== id)); }
    catch (e) { setFormError(errorMessage(e)); }
  }
  function onPlace(r: GeoResult) {
    setF((cur) => ({ ...cur, city: cur.city || r.city || '', area: cur.area || r.area || '' }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (f.title.trim().length < 5) e.title = 'Title needs at least 5 characters';
    if (f.city.trim().length < 2) e.city = 'Enter the city';
    if (f.area.trim().length < 2) e.area = 'Enter the area or locality';
    if (!(Number(f.size) >= 50)) e.size = 'Size must be at least 50 sq ft';
    if (!(Number(f.rent) >= 500)) e.rent = 'Rent must be at least ₹500';
    if (!loc) e.location = 'Drop a pin on the map so renters can find the home';
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setFormError('');
    const e = validate(); setErrors(e);
    if (Object.keys(e).length) { document.getElementById('form-top')?.scrollIntoView({ behavior: 'smooth' }); return; }
    setBusy(true);
    const body: ListingInput = {
      title: f.title.trim(), description: f.description.trim(), city: f.city.trim(), area: f.area.trim(),
      ...(f.address.trim() ? { address: f.address.trim() } : {}),
      latitude: loc!.lat, longitude: loc!.lng, size_sqft: Number(f.size), bhk: Number(f.bhk), bathrooms: Number(f.bathrooms) || 1,
      furnishing: f.furnishing, rent: Number(f.rent), amenities,
    };
    let status: ListingStatus = 'pending'; let photoFailed = false;
    try {
      const res = await api<{ listing: Listing }>(initial ? `/listings/${initial.id}` : '/listings', { method: initial ? 'PUT' : 'POST', body });
      status = res.listing.status;
      if (files.length) {
        try {
          const fd = new FormData(); files.forEach((file) => fd.append('photos', file));
          status = (await api<{ listing: Listing }>(`/listings/${res.listing.id}/images`, { method: 'POST', form: fd })).listing.status;
        } catch { photoFailed = true; }
      }
      router.replace(`/dashboard?posted=${status}${photoFailed ? '&photoError=1' : ''}`);
    } catch (err) {
      setFormError(errorMessage(err)); setBusy(false);
      document.getElementById('form-top')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  const rentNum = Number(f.rent);
  const verdict = pred ? computeVerdict(rentNum, pred.predicted_rent) : null;
  const err = (k: string) => errors[k];

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div id="form-top"><h1 className="text-2xl font-bold tracking-tight">{initial ? 'Edit listing' : 'Post a listing'}</h1>
        {initial && <p className="text-sm text-ink-soft">Saving re-runs our price and fraud checks.</p>}</div>
      {formError && <Alert>{formError}</Alert>}

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">The home</h2>
        <Field label="Title" htmlFor="title" error={err('title')}><Input id="title" value={f.title} onChange={set('title')} maxLength={150} placeholder="2 BHK near Indiranagar metro" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="city" error={err('city')}><Input id="city" value={f.city} onChange={set('city')} placeholder="Bengaluru" /></Field>
          <Field label="Area or locality" htmlFor="area" error={err('area')}><Input id="area" value={f.area} onChange={set('area')} placeholder="Indiranagar" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Size (sq ft)" htmlFor="size" error={err('size')}><Input id="size" inputMode="numeric" value={f.size} onChange={set('size')} /></Field>
          <Field label="Bedrooms" htmlFor="bhk"><Select id="bhk" value={f.bhk} onChange={set('bhk')}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} BHK</option>)}</Select></Field>
          <Field label="Bathrooms" htmlFor="bath"><Select id="bath" value={f.bathrooms} onChange={set('bathrooms')}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          <Field label="Furnishing" htmlFor="furn">
            <Select id="furn" value={f.furnishing} onChange={set('furnishing')}>
              <option value="unfurnished">Unfurnished</option><option value="semi-furnished">Semi-furnished</option><option value="furnished">Furnished</option>
            </Select>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Amenities</legend>
          <div className="flex flex-wrap gap-2">
            {AMENITIES.map((a) => (
              <label key={a} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${amenities.includes(a) ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>
                <input type="checkbox" className="sr-only" checked={amenities.includes(a)} onChange={() => setAmenities(amenities.includes(a) ? amenities.filter((x) => x !== a) : [...amenities, a])} />{amenityLabel(a)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Description" htmlFor="desc" hint="Describe the home honestly. Avoid phone numbers and payment requests; they can trigger a review.">
          <textarea id="desc" rows={4} maxLength={5000} value={f.description} onChange={set('description')} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Rent</h2>
        <Field label="Monthly rent (₹)" htmlFor="rent" error={err('rent')}><Input id="rent" inputMode="numeric" value={f.rent} onChange={set('rent')} className="max-w-xs" /></Field>
        {pred && (
          <div className="space-y-3 rounded-lg bg-canvas p-4" aria-live="polite">
            <p className="text-sm">Homes like this usually rent for <span className="tabular font-semibold">{formatRent(pred.low)} to {formatRent(pred.high)}</span>. Our estimate is <span className="tabular font-semibold">{formatRent(pred.predicted_rent)}</span>.</p>
            {rentNum >= 500 && <FairPriceGauge rent={rentNum} low={pred.low} high={pred.high} predicted={pred.predicted_rent} verdict={verdict} label="Your rent" />}
            {rentNum !== pred.predicted_rent && <Button type="button" variant="secondary" onClick={() => setF({ ...f, rent: String(pred.predicted_rent) })}>Use {formatRent(pred.predicted_rent)}</Button>}
            {pred.confidence === 'low' && <p className="text-xs text-ink-soft">We have little data for this city, so treat the estimate loosely.</p>}
          </div>
        )}
        {!pred && predNote && <p className="text-xs text-ink-soft">Price suggestion unavailable right now. You can still post.</p>}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Location</h2>
        <Field label="Street address (optional)" htmlFor="addr"><Input id="addr" value={f.address} onChange={set('address')} /></Field>
        <LocationPicker value={loc} onChange={setLoc} onPlace={onPlace} />
        {err('location') && <p role="alert" className="text-xs text-danger">{err('location')}</p>}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Photos</h2>
        <p className="text-sm text-ink-soft">Up to {MAX_IMAGES} photos, JPEG, PNG or WebP, {MAX_MB} MB each. Use your own photos; reused images are flagged.</p>
        <div className="flex flex-wrap gap-3">
          {existing.map((img) => (
            <div key={img.id} className="relative h-24 w-32 overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(img.url)} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => removeExisting(img.id)} aria-label="Remove photo" className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-sm font-bold">×</button>
            </div>
          ))}
          {previews.map((p, i) => (
            <div key={p.url} className="relative h-24 w-32 overflow-hidden rounded-lg border border-link">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove photo" className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-sm font-bold">×</button>
            </div>
          ))}
        </div>
        <input type="file" accept={TYPES.join(',')} multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} aria-label="Add photos" className="text-sm" />
        {err('photos') && <p role="alert" className="text-xs text-danger">{err('photos')}</p>}
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Post listing'}</Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
