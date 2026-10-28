import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/admin' }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me', name: 'Admin', role: 'admin' } }) }));

import { api, ApiError } from '@/lib/api';
import AlertsPage from '@/app/admin/alerts/page';
import AdminOverview from '@/app/admin/page';
import AdminUsers from '@/app/admin/users/page';
import type { AdminAlert, AdminStats } from '@/lib/types';

const apiMock = vi.mocked(api);
const alert1: AdminAlert = {
  id: 'a1', listing_id: 'l1', risk_score: 84, status: 'open', resolution: null, created_at: new Date().toISOString(), resolved_at: null,
  title: 'Too-good-to-be-true flat', city: 'Bengaluru', area: 'Indiranagar', rent: 9000, predicted_rent: 70000, size_sqft: 1000, bhk: 2,
  listing_status: 'pending', owner_id: 'o1', owner_name: 'Mallory', owner_email: 'mallory@example.com', owner_banned: false, cover_image: null,
  flags: [
    { type: 'price_too_low', severity: 'high', detail: 'Rent is 13% of the AI fair price' },
    { type: 'ml_unavailable', severity: 'info', detail: 'should be hidden' },
    { type: 'duplicate_image', severity: 'high', detail: 'Photo matches another listing', related_listing_id: 'l9' },
  ],
};
const page = (items: unknown[]) => ({ items, page: 1, limit: 10, total: items.length, total_pages: 1 });

beforeEach(() => { apiMock.mockReset(); });

describe('fraud alert queue', () => {
  test('shows risk, price gap and human-readable reasons (hides internal info flags)', async () => {
    apiMock.mockResolvedValue(page([alert1]));
    render(<AlertsPage />);
    expect(await screen.findByText('Too-good-to-be-true flat')).toBeInTheDocument();
    expect(screen.getByLabelText('Risk score 84 out of 100')).toBeInTheDocument();
    expect(screen.getByText(/Rent is 13% of the AI fair price/)).toBeInTheDocument();
    expect(screen.queryByText(/should be hidden/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the other listing' })).toHaveAttribute('href', '/listings/l9');
    expect(screen.getByText(/mallory@example.com/)).toBeInTheDocument();
  });

  test('approving sends the decision with the note and removes the card', async () => {
    const u = userEvent.setup();
    apiMock.mockImplementation(async (path: string) => (path.startsWith('/admin/alerts?') ? page([alert1]) : { id: 'a1' }));
    render(<AlertsPage />);
    await screen.findByText('Too-good-to-be-true flat');
    await u.type(screen.getByLabelText('Decision note'), 'Called the owner');
    await u.click(screen.getByRole('button', { name: 'Approve listing' }));
    await waitFor(() => expect(screen.queryByText('Too-good-to-be-true flat')).not.toBeInTheDocument());
    const call = apiMock.mock.calls.find(([p]) => p === '/admin/alerts/a1/resolve')!;
    expect(call[1]).toMatchObject({ method: 'POST', body: { action: 'approve', ban_owner: false, note: 'Called the owner' } });
    expect(await screen.findByText('The queue is clear')).toBeInTheDocument();
  });

  test('"also ban the owner" disables approve/reject so a ban cannot be half-applied', async () => {
    const u = userEvent.setup();
    apiMock.mockResolvedValue(page([alert1]));
    render(<AlertsPage />);
    await screen.findByText('Too-good-to-be-true flat');
    await u.click(screen.getByLabelText(/Also ban the owner/));
    expect(screen.getByRole('button', { name: 'Approve listing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reject/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ban listing and owner' })).toBeEnabled();
  });

  test('a failed decision keeps the card and explains why', async () => {
    const u = userEvent.setup();
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/alerts?')) return page([alert1]);
      throw new ApiError(409, 'Alert was already resolved', 'conflict');
    });
    render(<AlertsPage />);
    await screen.findByText('Too-good-to-be-true flat');
    await u.click(screen.getByRole('button', { name: 'Ban listing' }));
    expect(await screen.findByText('Alert was already resolved')).toBeInTheDocument();
    expect(screen.getByText('Too-good-to-be-true flat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ban listing' })).toBeEnabled();
  });
});

const stats = (over: Partial<AdminStats> = {}): AdminStats => ({
  users: { total: 12, banned: 1, new_7d: 3 },
  listings: { total: 30, by_status: { approved: 20, pending: 5, rejected: 2, banned: 3 }, per_day: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(14 + i).padStart(2, '0')}`, n: i % 3 })) },
  price_verdicts: { fair: 12, above_market: 5, below_market: 3 },
  fraud: { open_alerts: 5, total_alerts: 9, reviewed: 4, confirmed_fraud: 3, false_alarms: 1, flag_precision_pct: 75, avg_risk_score: 22, high_risk_listings: 4, top_flag_types: [{ type: 'price_too_low', n: 6 }] },
  model: { available: true, version: 'rent-xgboost-1', best_model: 'xgboost', dataset: 'synthetic', rows: 30000, trained_at: '', note: 'Trained on SYNTHETIC data: scores reflect the generator.',
    test_metrics: { mae: 4826, rmse: 8415, r2: 0.978, within_15pct: 84.1 }, comparison: { linear_ridge: { mae: 5070, rmse: 9593, r2: 0.972, within_15pct: 83.3 }, xgboost: { mae: 4826, rmse: 8415, r2: 0.978, within_15pct: 84.1 } } },
  ...over,
});

describe('overview analytics', () => {
  test('shows flag accuracy, model accuracy, and warns when trained on synthetic data', async () => {
    apiMock.mockResolvedValue(stats());
    render(<AdminOverview />);
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 reviewed flags were real problems/)).toBeInTheDocument();
    expect(screen.getByText('Average error (MAE)').nextElementSibling).toHaveTextContent('₹4,826');
    expect(screen.getByText('R² score').nextElementSibling).toHaveTextContent('0.978');
    expect(screen.getByText('Within 15% of true rent').nextElementSibling).toHaveTextContent('84.1%');
    expect(screen.getByText(/Trained on SYNTHETIC data/)).toBeInTheDocument();
    expect(screen.getByText(/xgboost \(in use\)/)).toBeInTheDocument();
  });
  test('empty system and ML down are handled gracefully', async () => {
    apiMock.mockResolvedValue(stats({ model: { available: false }, fraud: { open_alerts: 0, total_alerts: 0, reviewed: 0, confirmed_fraud: 0, false_alarms: 0, flag_precision_pct: null, avg_risk_score: null, high_risk_listings: 0, top_flag_types: [] } }));
    render(<AdminOverview />);
    expect(await screen.findByText('n/a')).toBeInTheDocument();
    expect(screen.getByText(/Appears once you review alerts/)).toBeInTheDocument();
    expect(screen.getByText(/ML service is not reachable/)).toBeInTheDocument();
    expect(screen.getByText('Nothing to show yet.')).toBeInTheDocument();
  });
  test('API failure shows an error instead of a blank page', async () => {
    apiMock.mockRejectedValue(new ApiError(500, 'Something went wrong'));
    render(<AdminOverview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('user management', () => {
  const users = [
    { id: 'me', name: 'Admin', email: 'admin@x.com', phone: null, role: 'admin', is_banned: false, created_at: '2026-01-01T00:00:00Z', listing_count: 0, problem_listings: 0 },
    { id: 'u2', name: 'Priya', email: 'priya@x.com', phone: null, role: 'user', is_banned: false, created_at: '2026-02-01T00:00:00Z', listing_count: 3, problem_listings: 1 },
  ];
  test('an admin cannot act on their own row', async () => {
    apiMock.mockResolvedValue(page(users));
    render(<AdminUsers />);
    const meRow = (await screen.findByText('admin@x.com')).closest('tr')!;
    expect(within(meRow).getByText('This is you')).toBeInTheDocument();
    expect(within(meRow).queryByRole('button')).toBeNull();
  });
  test('banning needs a confirmation click, then calls the API and reloads', async () => {
    const u = userEvent.setup();
    apiMock.mockResolvedValue(page(users));
    render(<AdminUsers />);
    const row = (await screen.findByText('priya@x.com')).closest('tr')!;
    expect(within(row).getByText(/1 flagged or removed/)).toBeInTheDocument();
    await u.click(within(row).getByRole('button', { name: 'Ban' }));
    expect(apiMock.mock.calls.some(([p]) => p === '/admin/users/u2')).toBe(false); // not yet
    await u.click(within(row).getByRole('button', { name: 'Confirm ban' }));
    await waitFor(() => expect(apiMock.mock.calls.some(([p, o]) => p === '/admin/users/u2' && (o as { body: unknown }).body && JSON.stringify((o as { body: unknown }).body) === '{"is_banned":true}')).toBe(true));
  });
});
