'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, errorMessage, imageUrl } from '@/lib/api';
import { formatRent } from '@/lib/format';
import type { Listing } from '@/lib/types';
import RequireAuth from '@/components/RequireAuth';
import { StatusBadge, VerdictChip } from '@/components/Badges';
import { Alert, Button, Card, Spinner } from '@/components/ui';

function Dashboard() {
  const sp = useSearchParams();
  const [items, setItems] = useState<Listing[] | null>(null);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(() => api<{ items: Listing[] }>('/listings/mine/all').then((r) => setItems(r.items)).catch((e) => setErr(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    try { await api(`/listings/${id}`, { method: 'DELETE' }); setItems((cur) => cur?.filter((l) => l.id !== id) ?? null); setConfirm(null); }
    catch (e) { setErr(errorMessage(e)); }
  }
  const posted = sp.get('posted');

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">My listings</h1>
        <div className="flex items-center gap-2">
          <Link href="/messages" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-canvas">
            Messages
          </Link>
          <Link href="/listings/new" className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c1530]">
            Post a listing
          </Link>
        </div>
      </div>
      {posted === 'approved' && <Alert kind="success">Saved. Your listing is live.</Alert>}
      {posted && posted !== 'approved' && <Alert kind="info">Saved. Our automatic checks flagged this listing, so an admin will review it before it goes live. This usually clears quickly if the details and photos are your own.</Alert>}
      {sp.get('photoError') && <Alert>The listing was saved, but the photos could not be uploaded. Open Edit and add them again.</Alert>}
      {err && <Alert>{err}</Alert>}
      {!items && !err && <Spinner />}
      {items?.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center">
          <p className="font-semibold">You have not posted anything yet</p>
          <p className="mt-1 text-sm text-ink-soft">Post your first home and see how its rent compares to the market.</p>
        </div>
      )}
      <ul className="space-y-3">
        {items?.map((l) => (
          <li key={l.id}>
            <Card className="flex flex-col gap-3 p-3 sm:flex-row">
              <div className="h-28 w-full shrink-0 overflow-hidden rounded-lg bg-canvas sm:w-40">
                {l.cover_image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={imageUrl(l.cover_image)} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-xs text-ink-soft">No photo</div>}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge status={l.status} /><VerdictChip verdict={l.price_verdict} /></div>
                <h2 className="truncate font-semibold">{l.title}</h2>
                <p className="text-sm text-ink-soft">{l.area}, {l.city}. <span className="tabular font-medium text-ink">{formatRent(l.rent)}/month</span></p>
                {l.status === 'pending' && <p className="text-xs text-below">Waiting for review. Not visible to renters yet.</p>}
                {l.status === 'banned' && <p className="text-xs text-danger">Removed by an admin for breaking the listing rules.</p>}
              </div>
              <div className="flex items-start gap-2 sm:flex-col">
                <Link href={`/listings/${l.id}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-canvas">View</Link>
                <Link href={`/listings/${l.id}/edit`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-canvas">Edit</Link>
                {confirm === l.id
                  ? <span className="flex gap-1"><Button variant="danger" onClick={() => remove(l.id)}>Delete</Button><Button variant="secondary" onClick={() => setConfirm(null)}>Keep</Button></span>
                  : <Button variant="ghost" className="text-danger" onClick={() => setConfirm(l.id)}>Delete</Button>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
export default function DashboardPage() { return <RequireAuth><Suspense><Dashboard /></Suspense></RequireAuth>; }
