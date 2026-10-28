export interface GeoResult { label: string; lat: number; lng: number; city?: string; area?: string }

/** Nominatim (OpenStreetMap): free, no key. Policy: max 1 request/second, so only call on explicit user action. */
export async function geocode(query: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=in&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Location search is unavailable right now');
  const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; address?: Record<string, string> }>;
  return rows.map((r) => ({
    label: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon),
    city: r.address?.city || r.address?.town || r.address?.state_district || r.address?.county,
    area: r.address?.suburb || r.address?.neighbourhood || r.address?.city_district,
  }));
}
