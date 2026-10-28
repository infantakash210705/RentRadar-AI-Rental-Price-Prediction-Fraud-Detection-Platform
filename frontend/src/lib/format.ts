import type { Verdict } from './types';

export const formatRent = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const formatCompact = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`;

/** Same +/-15% rule as the backend, for live feedback while typing a rent. */
export function computeVerdict(rent: number, predicted: number | null): Verdict {
  if (!predicted || !(rent > 0)) return null;
  const d = (rent - predicted) / predicted;
  return d > 0.15 ? 'above_market' : d < -0.15 ? 'below_market' : 'fair';
}

export const verdictLabel: Record<Exclude<Verdict, null>, string> = {
  fair: 'Fair price', below_market: 'Below market', above_market: 'Above market',
};

/** One plain sentence explaining the verdict. */
export function verdictSentence(rent: number, predicted: number | null, verdict: Verdict): string | null {
  if (!predicted || !verdict) return null;
  const diff = Math.abs(rent - predicted);
  if (verdict === 'fair') return 'This rent is in line with similar homes.';
  if (verdict === 'above_market') return `${formatRent(diff)} more than we'd expect for a home like this.`;
  return `${formatRent(diff)} less than we'd expect. Ask why before paying anything.`;
}

/** Positions (0-100) of the fair band and the rent marker on a shared scale. */
export function gaugeScale(rent: number, low: number, high: number) {
  const min = Math.min(low, rent) * 0.75;
  const max = Math.max(high, rent) * 1.25;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  return { bandStart: pos(low), bandEnd: pos(high), marker: pos(rent) };
}

export const AMENITIES = ['parking', 'lift', 'gym', 'pool', 'security', 'power backup', 'garden', 'clubhouse', 'balcony', 'ac', 'wifi', 'gas pipeline'] as const;
export const amenityLabel = (a: string) => (a === 'ac' ? 'Air conditioning' : a === 'wifi' ? 'Wi-Fi' : a.charAt(0).toUpperCase() + a.slice(1));
export const furnishingLabel: Record<string, string> = { unfurnished: 'Unfurnished', 'semi-furnished': 'Semi-furnished', furnished: 'Furnished' };

export const timeAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} days ago`;
};
