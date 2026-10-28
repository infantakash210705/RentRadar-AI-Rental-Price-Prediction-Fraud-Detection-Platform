'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

function safeNext(n: string | null) { return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'; } // no open redirects

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(email, password); router.replace(next); } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Log in</h1>
      <Card className="space-y-4 p-5">
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} /></Field>
          <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Logging in…' : 'Log in'}</Button>
        </form>
      </Card>
      <p className="mt-4 text-sm text-ink-soft">New here? <Link href="/signup" className="font-semibold text-link underline">Create an account</Link></p>
    </div>
  );
}
export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
