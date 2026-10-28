'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import type { AdminStats } from '@/lib/types';
import { BarList, DayBars, StatTile } from '@/components/AdminBits';
import { Alert, Card, Spinner } from '@/components/ui';

const pct = (n: number) => `${n.toFixed(1)}%`;

export default function AdminOverview() {
  const [s, setS] = useState<AdminStats | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<AdminStats>('/admin/stats').then(setS).catch((e) => setErr(errorMessage(e))); }, []);
  if (err) return <Alert>{err}</Alert>;
  if (!s) return <Spinner label="Loading analytics" />;
  const f = s.fraud;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Users" value={s.users.total} hint={`${s.users.new_7d} joined this week, ${s.users.banned} banned`} />
        <StatTile label="Live listings" value={s.listings.by_status.approved} hint={`${s.listings.total} in total`} />
        <Link href="/admin/alerts" className="block"><StatTile label="Open fraud alerts" value={f.open_alerts} hint="Review the queue" tone={f.open_alerts ? 'alert' : undefined} /></Link>
        <StatTile label="Flag accuracy" value={f.flag_precision_pct === null ? 'n/a' : `${f.flag_precision_pct}%`}
          hint={f.reviewed ? `${f.confirmed_fraud} of ${f.reviewed} reviewed flags were real problems` : 'Appears once you review alerts'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5"><h2 className="font-semibold">Listings posted, last 14 days</h2><DayBars data={s.listings.per_day} /></Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Listings by status</h2>
          <BarList items={[
            { label: 'Live', value: s.listings.by_status.approved, color: 'bg-fair' }, { label: 'Under review', value: s.listings.by_status.pending, color: 'bg-[#b7791f]' },
            { label: 'Rejected', value: s.listings.by_status.rejected, color: 'bg-above' }, { label: 'Removed', value: s.listings.by_status.banned, color: 'bg-danger' },
          ]} />
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">How live listings compare to the AI estimate</h2>
          <BarList items={[
            { label: 'Fair price', value: s.price_verdicts.fair, color: 'bg-fair' }, { label: 'Above market', value: s.price_verdicts.above_market, color: 'bg-above' },
            { label: 'Below market', value: s.price_verdicts.below_market, color: 'bg-[#b7791f]' },
          ]} />
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Most common fraud signals</h2>
          <BarList items={f.top_flag_types.map((t) => ({ label: t.type.replace(/_/g, ' '), value: t.n }))} />
          <p className="text-xs text-ink-soft">{f.high_risk_listings} high-risk listing(s), average risk score {f.avg_risk_score ?? 'n/a'}.</p>
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Rent prediction model</h2>
        {!s.model.available ? <Alert kind="info">The ML service is not reachable, so model accuracy cannot be shown right now.</Alert> : (
          <>
            {s.model.dataset === 'synthetic' && <Alert kind="info">{s.model.note}</Alert>}
            <p className="text-sm text-ink-soft">Version {s.model.version}, best model <b className="text-ink">{s.model.best_model}</b>, trained on {s.model.rows.toLocaleString('en-IN')} rows ({s.model.dataset}). Scores are measured on held-out data.</p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Average error (MAE)', `₹${Math.round(s.model.test_metrics.mae).toLocaleString('en-IN')}`], ['R² score', s.model.test_metrics.r2.toFixed(3)],
                ['Within 15% of true rent', pct(s.model.test_metrics.within_15pct)], ['RMSE', `₹${Math.round(s.model.test_metrics.rmse).toLocaleString('en-IN')}`]].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-ink-soft">{k}</dt><dd className="tabular text-xl font-bold">{v}</dd></div>
              ))}
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-sm"><caption className="sr-only">Model comparison</caption>
                <thead><tr className="border-b border-line text-left text-ink-soft"><th className="py-1 font-medium">Model</th><th className="font-medium">MAE</th><th className="font-medium">R²</th><th className="font-medium">Within 15%</th></tr></thead>
                <tbody>{Object.entries(s.model.comparison).map(([name, m]) => (
                  <tr key={name} className="border-b border-line/60"><td className="py-1">{name.replace('_', ' ')}{name === (s.model as { best_model: string }).best_model && ' (in use)'}</td>
                    <td className="tabular">₹{Math.round(m.mae).toLocaleString('en-IN')}</td><td className="tabular">{m.r2.toFixed(3)}</td><td className="tabular">{pct(m.within_15pct)}</td></tr>))}</tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
