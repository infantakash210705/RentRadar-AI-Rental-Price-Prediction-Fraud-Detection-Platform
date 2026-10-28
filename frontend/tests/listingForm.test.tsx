import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, back: vi.fn() }) }));
vi.mock('@/components/LocationPicker', () => ({
  default: ({ onChange }: { onChange: (v: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onChange({ lat: 12.97, lng: 77.64 })}>Set pin</button>
  ),
}));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api } from '@/lib/api';
import ListingForm from '@/components/ListingForm';
const apiMock = vi.mocked(api);

beforeEach(() => {
  replace.mockReset(); apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/predict') return { predicted_rent: 30000, low: 27000, high: 33000, confidence: 'high' };
    if (path === '/listings') return { listing: { id: 'L1', status: 'approved' } };
    return {};
  });
});

describe('<ListingForm>', () => {
  test('blocks an empty submit with specific, readable errors and sends nothing', async () => {
    const u = userEvent.setup();
    render(<ListingForm />);
    await u.click(screen.getByRole('button', { name: 'Post listing' }));
    expect(await screen.findByText('Title needs at least 5 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter the city')).toBeInTheDocument();
    expect(screen.getByText('Rent must be at least ₹500')).toBeInTheDocument();
    expect(screen.getByText(/Drop a pin on the map/)).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([p]) => p === '/listings')).toHaveLength(0);
  });

  test('valid form posts the right payload and goes to the dashboard', async () => {
    const u = userEvent.setup();
    render(<ListingForm />);
    await u.type(screen.getByLabelText('Title'), '2 BHK near the metro');
    await u.type(screen.getByLabelText('City'), 'Bengaluru');
    await u.type(screen.getByLabelText('Area or locality'), 'Indiranagar');
    await u.type(screen.getByLabelText('Size (sq ft)'), '1000');
    await u.type(screen.getByLabelText('Monthly rent (₹)'), '30000');
    await u.click(screen.getByLabelText('Parking'));
    await u.click(screen.getByRole('button', { name: 'Set pin' }));
    await u.click(screen.getByRole('button', { name: 'Post listing' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard?posted=approved'));
    const call = apiMock.mock.calls.find(([p]) => p === '/listings')!;
    expect(call[1]).toMatchObject({ method: 'POST', body: expect.objectContaining({
      title: '2 BHK near the metro', city: 'Bengaluru', area: 'Indiranagar', size_sqft: 1000, bhk: 2, rent: 30000,
      latitude: 12.97, longitude: 77.64, amenities: ['parking'], furnishing: 'unfurnished',
    }) });
  });

  test('shows the live AI suggestion and a fair verdict for a matching rent', async () => {
    const u = userEvent.setup();
    render(<ListingForm />);
    await u.type(screen.getByLabelText('City'), 'Bengaluru');
    await u.type(screen.getByLabelText('Area or locality'), 'Indiranagar');
    await u.type(screen.getByLabelText('Size (sq ft)'), '1000');
    await u.type(screen.getByLabelText('Monthly rent (₹)'), '30000');
    expect(await screen.findByText(/Our estimate is/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/₹27,000 to ₹33,000/)).toBeInTheDocument();
    expect(screen.getByText(/Fair price\./)).toBeInTheDocument();
    await u.clear(screen.getByLabelText('Monthly rent (₹)'));
    await u.type(screen.getByLabelText('Monthly rent (₹)'), '9000');
    expect(await screen.findByText(/Below market\./)).toBeInTheDocument();
  });

  test('server error is shown and the user stays on the form', async () => {
    const { ApiError } = await import('@/lib/api');
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/predict') return { predicted_rent: 30000, low: 27000, high: 33000, confidence: 'high' };
      throw new ApiError(429, 'Daily listing limit reached', 'rate_limited');
    });
    const u = userEvent.setup();
    render(<ListingForm />);
    await u.type(screen.getByLabelText('Title'), '2 BHK near the metro');
    await u.type(screen.getByLabelText('City'), 'Pune');
    await u.type(screen.getByLabelText('Area or locality'), 'Baner');
    await u.type(screen.getByLabelText('Size (sq ft)'), '900');
    await u.type(screen.getByLabelText('Monthly rent (₹)'), '25000');
    await u.click(screen.getByRole('button', { name: 'Set pin' }));
    await u.click(screen.getByRole('button', { name: 'Post listing' }));
    expect(await screen.findByText('Daily listing limit reached')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Post listing' })).toBeEnabled();
  });

  test('rejects non-image and oversized photos on the client', async () => {
    const u = userEvent.setup({ applyAccept: false });
    render(<ListingForm />);
    const input = screen.getByLabelText('Add photos');
    await u.upload(input, new File(['hi'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText(/notes\.txt: only JPEG, PNG or WebP/)).toBeInTheDocument();
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    await u.upload(input, big);
    expect(await screen.findByText(/huge\.png: larger than 5 MB/)).toBeInTheDocument();
  });
});
