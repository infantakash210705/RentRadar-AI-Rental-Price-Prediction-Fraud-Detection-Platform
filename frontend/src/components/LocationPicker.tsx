'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { geocode, type GeoResult } from '@/lib/geocode';
import { Button, Input } from './ui';
import { TILE_ATTR, TILE_URL } from './MapView';

export interface LatLng { lat: number; lng: number }

/** Click the map, drag the pin, or search an address (OpenStreetMap Nominatim). */
export default function LocationPicker({ value, onChange, onPlace }: {
  value: LatLng | null; onChange: (v: LatLng) => void; onPlace?: (r: GeoResult) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const st = useRef<{ L: typeof Leaflet; map: Leaflet.Map; marker: Leaflet.Marker | null } | null>(null);
  const cb = useRef(onChange); cb.current = onChange;
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [err, setErr] = useState('');

  function place(v: LatLng, zoom?: number) {
    const s = st.current; if (!s) return;
    if (!s.marker) {
      s.marker = s.L.marker([v.lat, v.lng], { draggable: true }).addTo(s.map);
      s.marker.on('dragend', () => { const p = s.marker!.getLatLng(); cb.current({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); });
    } else s.marker.setLatLng([v.lat, v.lng]);
    if (zoom) s.map.setView([v.lat, v.lng], zoom);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || st.current) return;
      // Default marker icon without bundled image assets
      const pin = L.divIcon({ className: '', html: '<div class="rr-pin" style="border-radius:50% 50% 50% 0;width:20px;height:20px;transform:rotate(-45deg) translate(-50%,-50%);background:#2f5bea"></div>', iconSize: [0, 0] });
      L.Marker.prototype.options.icon = pin;
      const map = L.map(el.current).setView(value ? [value.lat, value.lng] : [20.59, 78.96], value ? 15 : 5);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
      map.on('click', (e: Leaflet.LeafletMouseEvent) => { const v = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }; place(v); cb.current(v); });
      st.current = { L, map, marker: null };
      if (value) place(value);
    })();
    return () => { cancelled = true; st.current?.map.remove(); st.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (value) place(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  async function search() {
    if (q.trim().length < 3) { setErr('Type at least 3 characters'); return; }
    setBusy(true); setErr(''); setResults([]);
    try {
      const r = await geocode(q.trim());
      if (!r.length) setErr('No match found. Try a nearby landmark or click the map.');
      setResults(r);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function pick(r: GeoResult) {
    const v = { lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6) };
    place(v, 16); onChange(v); onPlace?.(r); setResults([]);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an address or landmark" aria-label="Search address"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
        <Button type="button" variant="secondary" onClick={search} disabled={busy}>{busy ? 'Searching…' : 'Find'}</Button>
      </div>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      {results.length > 0 && (
        <ul className="max-h-40 overflow-auto rounded-lg border border-line bg-white text-sm">
          {results.map((r, i) => (
            <li key={i}><button type="button" onClick={() => pick(r)} className="block w-full px-3 py-2 text-left hover:bg-canvas">{r.label}</button></li>
          ))}
        </ul>
      )}
      <div ref={el} className="h-72 w-full rounded-xl border border-line" role="region" aria-label="Pick the property location on the map" />
      <p className="text-xs text-ink-soft">
        {value ? `Pin at ${value.lat}, ${value.lng}. Drag it to adjust.` : 'Click the map to drop a pin on the property.'}
      </p>
    </div>
  );
}
