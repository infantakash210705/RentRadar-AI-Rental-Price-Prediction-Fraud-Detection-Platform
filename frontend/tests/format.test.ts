import { describe, expect, test } from 'vitest';
import { computeVerdict, formatCompact, formatRent, gaugeScale, verdictSentence } from '@/lib/format';

describe('formatting', () => {
  test('rupees use Indian digit grouping', () => {
    expect(formatRent(30000)).toBe('₹30,000');
    expect(formatRent(1250000)).toBe('₹12,50,000');
    expect(formatRent(29999.6)).toBe('₹30,000');
  });
  test('compact pins', () => {
    expect(formatCompact(950)).toBe('₹950');
    expect(formatCompact(30000)).toBe('₹30k');
    expect(formatCompact(150000)).toBe('₹1.5L');
  });
});

describe('verdict (mirrors backend +/-15% rule)', () => {
  test.each([
    [30000, 30000, 'fair'], [34500, 30000, 'fair'], [25500, 30000, 'fair'],
    [34501, 30000, 'above_market'], [25499, 30000, 'below_market'],
  ])('rent %i vs predicted %i => %s', (rent, pred, v) => expect(computeVerdict(rent, pred)).toBe(v));
  test('no prediction or invalid rent => null', () => {
    expect(computeVerdict(30000, null)).toBeNull();
    expect(computeVerdict(0, 30000)).toBeNull();
  });
  test('sentences explain the gap in rupees', () => {
    expect(verdictSentence(40000, 30000, 'above_market')).toContain('₹10,000 more');
    expect(verdictSentence(10000, 30000, 'below_market')).toContain('₹20,000 less');
    expect(verdictSentence(30000, 30000, 'fair')).toMatch(/in line/);
    expect(verdictSentence(30000, null, null)).toBeNull();
  });
});

describe('gaugeScale', () => {
  test('fair rent sits inside the band; band is ordered', () => {
    const g = gaugeScale(30000, 27000, 33000);
    expect(g.bandStart).toBeLessThan(g.bandEnd);
    expect(g.marker).toBeGreaterThan(g.bandStart);
    expect(g.marker).toBeLessThan(g.bandEnd);
  });
  test('overpriced marker is right of band, cheap marker left of band', () => {
    expect(gaugeScale(60000, 27000, 33000).marker).toBeGreaterThan(gaugeScale(60000, 27000, 33000).bandEnd);
    expect(gaugeScale(9000, 27000, 33000).marker).toBeLessThan(gaugeScale(9000, 27000, 33000).bandStart);
  });
  test('all positions stay within 0-100 even for absurd rents', () => {
    for (const rent of [1, 500, 30000, 10_000_000]) {
      const g = gaugeScale(rent, 27000, 33000);
      for (const v of Object.values(g)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
  });
});
