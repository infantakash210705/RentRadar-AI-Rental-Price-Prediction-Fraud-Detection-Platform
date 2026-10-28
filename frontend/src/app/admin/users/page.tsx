'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AdminUser, Paged } from '@/lib/types';
import { Alert, Button, Input, Spinner } from '@/components/ui';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [q, setQ] = useState(''); const [applied, setApplied] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminUser> | null>(null); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr('');
    const p = new URLSearchParams({ page: String(page), limit: '15' }); if (applied) p.set('q', applied);
    api<Paged<AdminUser>>(`/admin/users?${p}`).then(setData).catch((e) => setErr(errorMessage(e)));
  }, [applied, page]);
  useEffect(load, [load]);

  async function patch(u: AdminUser, body: { is_banned?: boolean; role?: 'user' | 'admin' }) {
    setErr(''); setConfirm(null);
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); load(); } catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(q.trim()); }} className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" aria-label="Search users" className="max-w-sm" /><Button type="submit">Search</Button>
      </form>
      {err && <Alert>{err}</Alert>}
      {!data && !err && <Spinner />}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Users</caption>
            <thead><tr className="border-b border-line text-left text-ink-soft"><th className="p-3 font-medium">User</th><th className="font-medium">Role</th><th className="font-medium">Listings</th><th className="font-medium">Joined</th><th className="p-3 font-medium">Actions</th></tr></thead>
            <tbody>
              {data.items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink-soft">No users match.</td></tr>}
              {data.items.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-b border-line/60 align-top">
                    <td className="p-3"><div className="font-medium">{u.name} {u.is_banned && <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-xs font-semibold text-danger">Banned</span>}</div><div className="text-xs text-ink-soft">{u.email}</div></td>
                    <td>{u.role === 'admin' ? <b>Admin</b> : 'User'}</td>
                    <td className="tabular">{u.listing_count}{u.problem_listings > 0 && <span className="text-xs text-below"> ({u.problem_listings} flagged or removed)</span>}</td>
                    <td className="tabular">{new Date(u.created_at).toLocaleDateString('en-IN')}</td>
                    <td className="p-3">
                      {self ? <span className="text-xs text-ink-soft">This is you</span> : (
                        <div className="flex flex-wrap gap-2">
                          {confirm === u.id
                            ? <><Button variant="danger" onClick={() => patch(u, { is_banned: !u.is_banned })}>{u.is_banned ? 'Confirm unban' : 'Confirm ban'}</Button><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button></>
                            : <Button variant="secondary" onClick={() => (u.is_banned ? patch(u, { is_banned: false }) : setConfirm(u.id))}>{u.is_banned ? 'Unban' : 'Ban'}</Button>}
                          <Button variant="ghost" onClick={() => patch(u, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? 'Remove admin' : 'Make admin'}</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-soft">Banning a user hides all their listings. Unbanning sends those listings back for review rather than publishing them automatically.</p>
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
