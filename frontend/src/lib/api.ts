export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const TOKEN_KEY = 'rr_token';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => window.localStorage.setItem(TOKEN_KEY, t),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

export const imageUrl = (u: string | null | undefined) => (!u ? '' : u.startsWith('http') ? u : `${API_URL}${u}`);

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method: opts.method || 'GET', headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.message || `Request failed (${res.status})`, err?.code, err?.details);
  }
  return data as T;
}

/** Turn an ApiError into a short, human message (field errors included). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.details?.length) return e.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message).join('; ');
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
