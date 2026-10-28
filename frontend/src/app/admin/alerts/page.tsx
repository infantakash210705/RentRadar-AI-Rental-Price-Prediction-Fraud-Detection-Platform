'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage, imageUrl } from '@/lib/api';
import { formatRent, timeAgo } from '@/lib/format';
import type { AdminAlert, Paged } from '@/lib/types';
import { riskTone, SEV_CLS } from '@/components/AdminBits';
import { Alert, Button, Card, Spinner } from '@/components/ui';

type Action = 'approve' | 'reject' | 'ban';

function AlertCard({ a, onDone }: { a: AdminAlert; onDone: (id: string) => void }) {
  const [note, setNote] = useState(''); const [banOwner, setBanOwner] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null); const [err, setErr] = useState('');
  const open = a.status === 'open';

  async function act(action: Action) {
    setBusy(action); setErr('');
    try {
      await api(`/admin/alerts/${a.id}/resolve`, { method: 'POST', body: { action, ban_owner: banOwner, ...(note.trim() ? { note: note.trim() } : {}) } });
      onDone(a.id);
    } catch (e) { setErr(errorMessage(e)); setBusy(null); }
  }
  return (
    <Card className="space-y-3 p-4">
      <div className="flex gap-3">
        <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-canvas">
          {a.cover_image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={imageUrl(a.cover_image)} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full items-center justify-center text-xs text-ink-soft">No photo</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/listings/${a.listing_id}`} className="truncate font-semibold text-link underline">{a.title}</Link>
            <span className={`tabular shrink-0 rounded-full px-2 py-0.5 text-sm font-bold ${riskTone(a.risk_score)}`} aria-label={`Risk score ${a.risk_score} out of 100`}>{a.risk_score}</span>
          </div>
          <p className="text-sm text-ink-soft">{a.area}, {a.city}, {a.bhk} BHK, {a.size_sqft} sq ft</p>
          <p className="tabular text-sm">Asking <b>{formatRent(a.rent)}</b>{a.predicted_rent ? <> vs AI estimate <b>{formatRent(a.predicted_rent)}</b></> : null}</p>
          <p className="text-xs text-ink-soft">Owner: {a.owner_name} ({a.owner_email}){a.owner_banned && <b className="text-danger"> banned</b>}. Flagged {timeAgo(a.created_at)}.</p>
        </div>
      </div>

      <ul className="space-y-1" aria-label="Why this was flagged">
        {a.flags.filter((f) => f.severity !== 'info').map((f, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${SEV_CLS[f.severity]}`}>{f.severity}</span>
            <span><b>{f.type.replace(/_/g, ' ')}.</b> {f.detail}{f.related_listing_id && <> <Link href={`/listings/${f.related_listing_id}`} className="text-link underline">See the other listing</Link></>}</span>
          </li>
        ))}
      </ul>

      {open ? (
        <div className="space-y-2 border-t border-line pt-3">
          {err && <Alert>{err}</Alert>}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note for the record (optional)" aria-label="Decision note"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={banOwner} onChange={(e) => setBanOwner(e.target.checked)} /> Also ban the owner and remove all their listings</label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => act('approve')} disabled={!!busy || banOwner} title={banOwner ? 'Uncheck "ban the owner" to approve' : undefined}>{busy === 'approve' ? 'Approving…' : 'Approve listing'}</Button>
            <Button variant="secondary" onClick={() => act('reject')} disabled={!!busy || banOwner}>{busy === 'reject' ? 'Rejecting…' : 'Reject (owner can fix)'}</Button>
            <Button variant="danger" onClick={() => act('ban')} disabled={!!busy}>{busy === 'ban' ? 'Banning…' : banOwner ? 'Ban listing and owner' : 'Ban listing'}</Button>
          </div>
        </div>
      ) : <p className="border-t border-line pt-2 text-sm text-ink-soft">Resolved: {a.resolution}</p>}
    </Card>
  );
}

export default function AlertsPage() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open'); const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminAlert> | null>(null); const [err, setErr] = useState('');
  const load = useCallback(() => {
    setData(null); setErr('');
    api<Paged<AdminAlert>>(`/admin/alerts?status=${tab}&page=${page}&limit=10`).then(setData).catch((e) => setErr(errorMessage(e)));
  }, [tab, page]);
  useEffect(load, [load]);
  const done = (id: string) => setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== id), total: d.total - 1 } : d));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Fraud alerts</h1>
        <div className="flex gap-1" role="group" aria-label="Alert status">
          {(['open', 'resolved'] as const).map((t) => <Button key={t} variant={tab === t ? 'primary' : 'secondary'} aria-pressed={tab === t} onClick={() => { setTab(t); setPage(1); }}>{t === 'open' ? 'Needs review' : 'Resolved'}</Button>)}
        </div>
      </div>
      {err && <Alert>{err}</Alert>}
      {!data && !err && <Spinner />}
      {data && data.items.length === 0 && <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center"><p className="font-semibold">{tab === 'open' ? 'The queue is clear' : 'No resolved alerts yet'}</p>{tab === 'open' && <p className="mt-1 text-sm text-ink-soft">New flagged listings will appear here, highest risk first.</p>}</div>}
      {data?.items.map((a) => <AlertCard key={a.id} a={a} onDone={done} />)}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-ink-soft">Page {page} of {data.total_pages}</span>
          <Button variant="secondary" disabled={page >= data.total_pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
