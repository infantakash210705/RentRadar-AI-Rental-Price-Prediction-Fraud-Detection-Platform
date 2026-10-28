'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { formatRent } from '@/lib/format';
import type { AdminListing, ListingStatus, Paged } from '@/lib/types';
import { StatusBadge } from '@/components/Badges';
import { riskTone } from '@/components/AdminBits';
import { Alert, Button, Input, Select, Spinner } from '@/components/ui';

const STATUSES: ListingStatus[] = ['approved', 'pending', 'rejected', 'banned'];

export default function AdminListings() {
  const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [applied, setApplied] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminListing> | null>(null); const [err, setErr] = useState('');

  const load = useCallback(() => {
    setErr('');
    const p = new URLSearchParams({ page: String(page), limit: '15' });
    if (status) p.set('status', status); if (applied) p.set('q', applied);
    api<Paged<AdminListing>>(`/admin/listings?${p}`).then(setData).catch((e) => setErr(errorMessage(e)));
  }, [status, applied, page]);
  useEffect(load, [load]);

  async function setListingStatus(id: string, s: ListingStatus) {
    setErr('');
    try { await api(`/admin/listings/${id}`, { method: 'PATCH', body: { status: s } }); setData((d) => d && { ...d, items: d.items.map((l) => (l.id === id ? { ...l, status: s } : l)) }); }
    catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Listings</h1>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(q.trim()); }} className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, area, city or owner email" aria-label="Search listings" className="max-w-sm" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status" className="w-44">
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Button type="submit">Search</Button>
      </form>
      {err && <Alert>{err}</Alert>}
      {!data && !err && <Spinner />}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Listings</caption>
            <thead><tr className="border-b border-line text-left text-ink-soft"><th className="p-3 font-medium">Listing</th><th className="font-medium">Owner</th><th className="font-medium">Rent</th><th className="font-medium">Risk</th><th className="font-medium">Status</th><th className="p-3 font-medium">Change status</th></tr></thead>
            <tbody>
              {data.items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">No listings match.</td></tr>}
              {data.items.map((l) => (
                <tr key={l.id} className="border-b border-line/60 align-top">
                  <td className="p-3"><Link href={`/listings/${l.id}`} className="font-medium text-link underline">{l.title}</Link><div className="text-xs text-ink-soft">{l.area}, {l.city}</div></td>
                  <td><div>{l.owner_name}</div><div className="text-xs text-ink-soft">{l.owner_email}</div></td>
                  <td className="tabular">{formatRent(l.rent)}</td>
                  <td>{l.fraud_score === null ? <span className="text-ink-soft">n/a</span> : <span className={`tabular rounded-full px-2 py-0.5 text-xs font-bold ${riskTone(l.fraud_score)}`}>{l.fraud_score}</span>}</td>
                  <td><StatusBadge status={l.status} /></td>
                  <td className="p-3">
                    <Select value={l.status} onChange={(e) => setListingStatus(l.id, e.target.value as ListingStatus)} aria-label={`Status for ${l.title}`} className="w-36">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-ink-soft">Page {page} of {data.total_pages} ({data.total} listings)</span>
          <Button variant="secondary" disabled={page >= data.total_pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
