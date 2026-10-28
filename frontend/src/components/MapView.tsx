'use client';
import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { formatCompact, formatRent } from '@/lib/format';
import type { MapPoint } from '@/lib/types';

const INDIA: [number, number] = [20.59, 78.96];
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Results map: one price pill per listing. Leaflet is loaded lazily so SSR never touches `window`. */
export default function MapView({ points, activeId, onActive, visible = true, center }: {
  points: MapPoint[]; activeId?: string | null; onActive?: (id: string | null) => void; visible?: boolean; center?: [number, number];
}) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{ L: typeof Leaflet; map: Leaflet.Map; layer: Leaflet.LayerGroup; markers: Map<string, Leaflet.Marker> } | null>(null);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  // init once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || state.current) return;
      const map = L.map(el.current, { zoomControl: true, scrollWheelZoom: true }).setView(center || INDIA, center ? 11 : 5);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
      state.current = { L, map, layer: L.layerGroup().addTo(map), markers: new Map() };
      render();
    })();
    return () => { cancelled = true; state.current?.map.remove(); state.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function render() {
    const s = state.current;
    if (!s) return;
    const { L, map, layer, markers } = s;
    layer.clearLayers(); markers.clear();
    for (const p of points) {
      const icon = L.divIcon({ className: '', html: `<div class="rr-pin" data-active="false">${formatCompact(p.rent)}</div>`, iconSize: [0, 0] });
      const m = L.marker([p.latitude, p.longitude], { icon, keyboard: true, title: `${p.title}, ${formatRent(p.rent)}` });
      const pop = document.createElement('div');
      const a = document.createElement('a');
      a.href = `/listings/${p.id}`; a.textContent = p.title; a.style.fontWeight = '600';
      const sub = document.createElement('div');
      sub.textContent = `${formatRent(p.rent)}/month, ${p.bhk} BHK, ${p.area}`;
      pop.append(a, sub);
      m.bindPopup(pop);
      m.on('mouseover', () => onActiveRef.current?.(p.id));
      m.on('mouseout', () => onActiveRef.current?.(null));
      m.addTo(layer);
      markers.set(p.id, m);
    }
    if (points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [40, 40], maxZoom: 15 });
  }

  useEffect(render, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // highlight pin for hovered card
    state.current?.markers.forEach((m, id) => m.getElement()?.querySelector('.rr-pin')?.setAttribute('data-active', String(id === activeId)));
  }, [activeId, points]);

  useEffect(() => { if (visible) setTimeout(() => state.current?.map.invalidateSize(), 50); }, [visible]);

  return <div ref={el} className="h-full w-full rounded-xl border border-line" role="region" aria-label="Map of listings" />;
}
