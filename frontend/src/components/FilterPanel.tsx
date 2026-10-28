'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AMENITIES, amenityLabel } from '@/lib/format';
import { Button, Field, Input, Select } from './ui';

export type Params = Record<string, string>;

export default function FilterPanel({ params, onChange }: { params: Params; onChange: (patch: Params) => void }) {
  const [cities, setCities] = useState<{ city: string; count: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(params.q || '');
  const [minRent, setMin] = useState(params.minRent || '');
  const [maxRent, setMax] = useState(params.maxRent || '');
  const [geoErr, setGeoErr] = useState('');
  const amenities = (params.amenities || '').split(',').filter(Boolean);

  useEffect(() => { api<{ items: { city: string; count: number }[] }>('/meta/cities').then((r) => setCities(r.items)).catch(() => {}); }, []);
  useEffect(() => { setQ(params.q || ''); setMin(params.minRent || ''); setMax(params.maxRent || ''); }, [params.q, params.minRent, params.maxRent]);

  const apply = () => onChange({ q: q.trim(), minRent: minRent.replace(/\D/g, ''), maxRent: maxRent.replace(/\D/g, '') });
  const toggleAmenity = (a: string) => onChange({ amenities: (amenities.includes(a) ? amenities.filter((x) => x !== a) : [...amenities, a]).join(',') });

  function nearMe() {
    setGeoErr('');
    if (!navigator.geolocation) { setGeoErr('Location is not available in this browser'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => onChange({ lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5), radius_km: params.radius_km || '5', sort: 'distance' }),
      () => setGeoErr('Allow location access to search near you'),
    );
  }
  const activeCount = ['bhk', 'furnishing', 'amenities', 'lat'].filter((k) => params[k]).length;

  return (
    <form onSubmit={(e) => { e.preventDefault(); apply(); }} className="space-y-3 rounded-xl border border-line bg-white p-3" aria-label="Search filters">
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Area, landmark or keyword" aria-label="Search text" />
        <Select value={params.city || ''} onChange={(e) => onChange({ city: e.target.value })} aria-label="City">
          <option value="">All cities</option>
          {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.count})</option>)}
        </Select>
        <Input value={minRent} onChange={(e) => setMin(e.target.value)} inputMode="numeric" placeholder="Min ₹" aria-label="Minimum rent" />
        <Input value={maxRent} onChange={(e) => setMax(e.target.value)} inputMode="numeric" placeholder="Max ₹" aria-label="Maximum rent" />
        <Button type="submit">Search</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide filters' : 'More filters'}{activeCount > 0 && ` (${activeCount})`}
        </Button>
        <Button type="button" variant={params.lat ? 'primary' : 'secondary'} onClick={() => (params.lat ? onChange({ lat: '', lng: '', radius_km: '', sort: '' }) : nearMe())}>
          {params.lat ? 'Near me: on' : 'Near me'}
        </Button>
        {params.lat && (
          <Select value={params.radius_km || '5'} onChange={(e) => onChange({ radius_km: e.target.value })} aria-label="Search radius" className="w-28">
            {['2', '5', '10', '25'].map((r) => <option key={r} value={r}>{r} km</option>)}
          </Select>
        )}
        <div className="ml-auto w-44">
          <Select value={params.sort || ''} onChange={(e) => onChange({ sort: e.target.value })} aria-label="Sort by">
            <option value="">Newest first</option>
            <option value="rent_asc">Rent: low to high</option>
            <option value="rent_desc">Rent: high to low</option>
            {params.lat && <option value="distance">Nearest first</option>}
          </Select>
        </div>
      </div>
      {geoErr && <p role="alert" className="text-xs text-danger">{geoErr}</p>}

      {open && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bedrooms" htmlFor="f-bhk">
              <Select id="f-bhk" value={params.bhk || ''} onChange={(e) => onChange({ bhk: e.target.value })}>
                <option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} BHK</option>)}
              </Select>
            </Field>
            <Field label="Furnishing" htmlFor="f-furn">
              <Select id="f-furn" value={params.furnishing || ''} onChange={(e) => onChange({ furnishing: e.target.value })}>
                <option value="">Any</option><option value="unfurnished">Unfurnished</option>
                <option value="semi-furnished">Semi-furnished</option><option value="furnished">Furnished</option>
              </Select>
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Amenities</legend>
            <div className="flex flex-wrap gap-2">
              {AMENITIES.map((a) => (
                <label key={a} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${amenities.includes(a) ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>
                  <input type="checkbox" className="sr-only" checked={amenities.includes(a)} onChange={() => toggleAmenity(a)} />{amenityLabel(a)}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="button" variant="ghost" onClick={() => { setQ(''); setMin(''); setMax(''); onChange({ q: '', city: '', minRent: '', maxRent: '', bhk: '', furnishing: '', amenities: '', lat: '', lng: '', radius_km: '', sort: '' }); }}>
            Clear all filters
          </Button>
        </div>
      )}
    </form>
  );
}
