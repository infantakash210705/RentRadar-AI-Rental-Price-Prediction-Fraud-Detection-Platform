import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, ApiError, errorMessage, imageUrl, tokenStore } from '@/lib/api';

const respond = (status: number, body?: unknown) => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('api client', () => {
  test('sends JSON body and bearer token', async () => {
    tokenStore.set('abc123');
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(200, { ok: true }));
    await api('/listings', { method: 'POST', body: { a: 1 } });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/listings$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc123');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });
  test('no token => no Authorization header; FormData is sent untouched without a JSON content type', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(200, {}));
    const form = new FormData();
    await api('/x', { method: 'POST', form });
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init.body).toBe(form);
  });
  test('204 resolves undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(204));
    await expect(api('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
  test('server validation errors become ApiError with field details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(400, { error: { code: 'validation_error', message: 'Invalid input', details: [{ path: 'rent', message: 'Too small' }] } }));
    const e = (await api('/x').catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(400);
    expect(errorMessage(e)).toBe('rent: Too small');
  });
  test('non-JSON error body still gives a useful message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 })));
    expect(errorMessage(await api('/x').catch((x) => x))).toBe('Request failed (502)');
  });
  test('network failure => friendly message with code "network"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const e = (await api('/x').catch((x) => x)) as ApiError;
    expect(e.code).toBe('network');
    expect(errorMessage(e)).toMatch(/Cannot reach the server/);
  });
  test('imageUrl prefixes relative upload paths only', () => {
    expect(imageUrl('/uploads/a.png')).toMatch(/\/uploads\/a\.png$/);
    expect(imageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(imageUrl(null)).toBe('');
  });
});
