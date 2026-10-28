'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import type { Listing, MapPoint, Paged } from '@/lib/types';
import FilterPanel, { type Params } from '@/components/FilterPanel';
import ListingCard from '@/components/ListingCard';
import MapView from '@/components/MapView';
import { Alert, Button, Spinner } from '@/components/ui';

const FILTER_KEYS = ['q', 'city', 'minRent', 'maxRent', 'bhk', 'furnishing', 'amenities', 'lat', 'lng', 'radius_km'];
const PAGE_SIZE = 10;

function qs(p: Record<string, string>, keys: string[]) {
  const u = new URLSearchParams();
  for (const k of keys) if (p[k]) u.set(k, p[k]);
  return u.toString();
}

function Search() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const params = useMemo(() => Object.fromEntries(sp.entries()) as Params, [sp]);
  const [data, setData] = useState<Paged<Listing> | null>(null);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');

  const update = useCallback((patch: Params) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    if (!('page' in patch)) n.delete('page');
    router.replace(`${pathname}?${n.toString()}`, { scroll: false });
  }, [sp, router, pathname]);

  const listQuery = qs(params, [...FILTER_KEYS, 'sort', 'page']) + `&limit=${PAGE_SIZE}`;
  const mapQuery = qs(params, FILTER_KEYS);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true); setError('');
    Promise.all([
      api<Paged<Listing>>(`/listings?${listQuery}`, { signal: ctrl.signal }),
      api<{ items: MapPoint[] }>(`/listings/map?${mapQuery}`, { signal: ctrl.signal }),
    ])
      .then(([l, m]) => { setData(l); setPoints(m.items); })
      .catch((e) => { if ((e as Error).name !== 'AbortError') setError(errorMessage(e)); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [listQuery, mapQuery]);

  const page = Number(params.page || 1);
  const go = (p: number) => { update({ page: String(p) }); window.scrollTo({ top: 0 }); };

  return (
    <div className="mx-auto max-w-7xl space-y-3 px-4 py-4">
      <h1 className="text-2xl font-bold tracking-tight">Find a rent that is actually fair</h1>
      <FilterPanel params={params} onChange={update} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-soft" aria-live="polite">
          {loading ? 'Searching…' : data ? `${data.total.toLocaleString('en-IN')} ${data.total === 1 ? 'home' : 'homes'}` : ''}
        </p>
        <div className="flex gap-1 lg:hidden" role="group" aria-label="Switch view">
          <Button variant={view === 'list' ? 'primary' : 'secondary'} onClick={() => setView('list')} aria-pressed={view === 'list'}>List</Button>
          <Button variant={view === 'map' ? 'primary' : 'secondary'} onClick={() => setView('map')} aria-pressed={view === 'map'}>Map</Button>
        </div>
      </div>

      {error && <Alert>{error} <button className="font-semibold underline" onClick={() => update({})}>Try again</button></Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`space-y-3 ${view === 'map' ? 'hidden' : ''} lg:block`} aria-label="Search results">
          {loading && !data && <Spinner label="Loading homes" />}
          {data && data.items.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center">
              <p className="font-semibold">No homes match these filters</p>
              <p className="mt-1 text-sm text-ink-soft">Try a higher budget, a different city, or clear the filters.</p>
              <Button className="mt-3" variant="secondary" onClick={() => router.replace(pathname)}>Clear filters</Button>
            </div>
          )}
          <div className={loading && data ? 'opacity-60 transition-opacity' : ''}>
            <div className="space-y-3">
              {data?.items.map((l) => <ListingCard key={l.id} l={l} active={active === l.id} onHover={setActive} />)}
            </div>
          </div>
          {data && data.total_pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between pt-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => go(page - 1)}>Previous</Button>
              <span className="text-sm text-ink-soft">Page {page} of {data.total_pages}</span>
              <Button variant="secondary" disabled={page >= data.total_pages} onClick={() => go(page + 1)}>Next</Button>
            </nav>
          )}
        </section>

        <section className={`${view === 'list' ? 'hidden' : ''} h-[70vh] lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-6rem)]`} aria-label="Map">
          <MapView points={points} activeId={active} onActive={setActive} visible={view === 'map'} />
        </section>
      </div>
    </div>
  );
}

export default function Home() {
  return <Suspense fallback={<div className="p-8"><Spinner /></div>}><Search /></Suspense>;
}
