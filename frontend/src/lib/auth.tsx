'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';
import type { User } from './types';

interface AuthCtx {
  user: User | null; loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (d: { name: string; email: string; password: string; phone?: string }) => Promise<User>;
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
    signup: async (d) => finish(await api('/auth/signup', { method: 'POST', body: d })),
    logout: () => { tokenStore.clear(); setUser(null); },
  }), [user, loading, finish]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}
