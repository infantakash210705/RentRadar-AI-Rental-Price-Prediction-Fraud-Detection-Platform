'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';
import type { User } from './types';

interface AuthCtx {
  user: User | null; loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (d: { name: string; email: string; password: string; phone?: string }) => Promise<{ requires_verification?: boolean; email?: string } | User>;
  logout: () => void; setUser: (u: User) => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) { setLoading(false); return; }
    api<{ user: User }>('/users/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())   // expired / banned token
      .finally(() => setLoading(false));
  }, []);

  const finish = useCallback((r: { user: User; token: string }) => { tokenStore.set(r.token); setUser(r.user); return r.user; }, []);
  const value = useMemo<AuthCtx>(() => ({
    user, loading, setUser,
    login: async (email, password) => finish(await api('/auth/login', { method: 'POST', body: { email, password } })),
    signup: async (d) => {
      const res = await api<{ user?: User; token?: string; requires_verification?: boolean; email?: string }>('/auth/signup', { method: 'POST', body: d });
      if (res.requires_verification) {
        return res;
      }
      return finish(res as { user: User; token: string });
    },
    logout: () => { tokenStore.clear(); setUser(null); },
  }), [user, loading, finish]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}
