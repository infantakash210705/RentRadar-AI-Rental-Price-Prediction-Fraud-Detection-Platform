import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import FairPriceGauge from '@/components/FairPriceGauge';

const pos = (el: HTMLElement) => parseFloat(el.style.left);

describe('<FairPriceGauge>', () => {
  test('announces rent, range and verdict to screen readers', () => {
    render(<FairPriceGauge rent={30000} low={27000} high={33000} predicted={30000} verdict="fair" />);
    const fig = screen.getByRole('img');
    expect(fig).toHaveAccessibleName(/Asking rent ₹30,000\. Expected range ₹27,000 to ₹33,000\. Fair price\./);
    expect(screen.getByText(/in line with similar homes/)).toBeInTheDocument();
  });
  test('above market: marker is beyond the fair band and the gap is stated', () => {
    render(<FairPriceGauge rent={45000} low={27000} high={33000} predicted={30000} verdict="above_market" />);
    const band = screen.getByTestId('gauge-band'); const marker = screen.getByTestId('gauge-marker');
    expect(pos(marker)).toBeGreaterThan(pos(band) + parseFloat(band.style.width));
    expect(screen.getByText(/Above market\./)).toBeInTheDocument();
    expect(screen.getByText(/₹15,000 more/)).toBeInTheDocument();
  });
  test('below market: warns the viewer', () => {
    render(<FairPriceGauge rent={9000} low={27000} high={33000} predicted={30000} verdict="below_market" />);
    expect(pos(screen.getByTestId('gauge-marker'))).toBeLessThan(pos(screen.getByTestId('gauge-band')));
    expect(screen.getByText(/Ask why before paying anything/)).toBeInTheDocument();
  });
});
