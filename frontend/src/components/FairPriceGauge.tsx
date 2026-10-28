import { formatRent, gaugeScale, verdictLabel, verdictSentence } from '@/lib/format';
import type { Verdict } from '@/lib/types';

const markerColor: Record<string, string> = { fair: 'bg-fair', below_market: 'bg-[#b7791f]', above_market: 'bg-above' };
const textColor: Record<string, string> = { fair: 'text-fair', below_market: 'text-below', above_market: 'text-above' };

/** The signature element: where this rent sits relative to the AI's expected range. */
export default function FairPriceGauge({ rent, low, high, predicted, verdict, label = 'Asking rent' }: {
  rent: number; low: number; high: number; predicted: number | null; verdict: Verdict; label?: string;
}) {
  const { bandStart, bandEnd, marker } = gaugeScale(rent, low, high);
  const key = verdict || 'fair';
  const labelPos = Math.max(12, Math.min(88, marker));
  const sentence = verdictSentence(rent, predicted, verdict);
  return (
    <figure
      className="space-y-2" role="img"
      aria-label={`${label} ${formatRent(rent)}. Expected range ${formatRent(low)} to ${formatRent(high)}.${verdict ? ' ' + verdictLabel[verdict] + '.' : ''}`}
    >
      <div className="relative h-14">
        <span className="tabular absolute top-0 -translate-x-1/2 whitespace-nowrap text-sm font-semibold" style={{ left: `${labelPos}%` }}>{formatRent(rent)}</span>
        <div className="absolute inset-x-0 top-7 h-2 rounded-full bg-line" />
        <div className="absolute top-7 h-2 rounded-full bg-fair-bg ring-1 ring-fair/40" style={{ left: `${bandStart}%`, width: `${Math.max(bandEnd - bandStart, 1)}%` }} data-testid="gauge-band" />
        <div className={`absolute top-[22px] h-[18px] w-1 -translate-x-1/2 rounded-full ${markerColor[key]}`} style={{ left: `${marker}%` }} data-testid="gauge-marker" />
        <div className="tabular absolute top-10 text-xs text-ink-soft" style={{ left: `${bandStart}%`, transform: 'translateX(-50%)' }}>{formatRent(low)}</div>
        <div className="tabular absolute top-10 text-xs text-ink-soft" style={{ left: `${bandEnd}%`, transform: 'translateX(-50%)' }}>{formatRent(high)}</div>
      </div>
      <figcaption className="text-sm">
        {verdict && <span className={`font-semibold ${textColor[key]}`}>{verdictLabel[verdict]}. </span>}
        <span className="text-ink-soft">{sentence}</span>
      </figcaption>
    </figure>
  );
}
