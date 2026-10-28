import type { ReactNode } from 'react';
import { Card } from './ui';

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'alert' }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={`tabular text-3xl font-bold ${tone === 'alert' ? 'text-above' : ''}`}>{value}</p>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </Card>
  );
}

/** Horizontal bars; width is relative to the largest value. */
export function BarList({ items, color = 'bg-ink' }: { items: { label: string; value: number; color?: string }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-ink-soft">Nothing to show yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate">{i.label}</span>
          <span className="h-3 rounded-full bg-canvas"><span className={`block h-3 rounded-full ${i.color || color}`} style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="tabular text-right font-semibold">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function DayBars({ data }: { data: { day: string; n: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div role="img" aria-label={`Listings posted per day for the last ${data.length} days. Most in a day: ${Math.max(...data.map((d) => d.n))}.`}>
      <div className="flex h-28 items-end gap-1">
        {data.map((d) => <div key={d.day} title={`${d.day}: ${d.n}`} className="flex-1 rounded-t bg-link" style={{ height: `${Math.max((d.n / max) * 100, d.n ? 4 : 1)}%`, opacity: d.n ? 1 : 0.25 }} />)}
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-soft"><span>{data[0]?.day.slice(5)}</span><span>{data.at(-1)?.day.slice(5)}</span></div>
    </div>
  );
}

export const riskTone = (s: number) => (s >= 70 ? 'bg-[#fdecea] text-danger' : s >= 40 ? 'bg-below-bg text-below' : 'bg-fair-bg text-fair');
export const SEV_CLS: Record<string, string> = { high: 'bg-[#fdecea] text-danger', medium: 'bg-below-bg text-below', low: 'bg-canvas text-ink-soft', info: 'bg-canvas text-ink-soft' };
