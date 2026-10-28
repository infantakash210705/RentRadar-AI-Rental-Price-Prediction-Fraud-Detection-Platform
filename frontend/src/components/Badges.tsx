import { verdictLabel } from '@/lib/format';
import type { ListingStatus, Verdict } from '@/lib/types';

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  if (!verdict) return null;
  const c = { fair: 'bg-fair-bg text-fair', below_market: 'bg-below-bg text-below', above_market: 'bg-above-bg text-above' }[verdict];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>{verdictLabel[verdict]}</span>;
}

const STATUS: Record<ListingStatus, [string, string]> = {
  approved: ['Live', 'bg-fair-bg text-fair'],
  pending: ['Under review', 'bg-below-bg text-below'],
  rejected: ['Rejected', 'bg-above-bg text-above'],
  banned: ['Removed', 'bg-[#fdecea] text-danger'],
};
export function StatusBadge({ status }: { status: ListingStatus }) {
  const [t, c] = STATUS[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>{t}</span>;
}
