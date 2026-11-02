'use client';
import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

function safeNext(n: string | null) { return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'; } // no open redirects

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const initialEmail = searchParams.get('email') || '';
  const verifiedNotice = searchParams.get('verified') === '1';

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setUnverifiedEmail('');

    try {
      await login(email, password);
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'unverified_email' || (err as unknown as { requires_verification?: boolean }).requires_verification)) {
        setUnverifiedEmail(email);
        setError('Your email is not verified yet. Please enter the verification code sent to your email.');
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Log in</h1>
      <Card className="space-y-4 p-5">
        <form onSubmit={submit} className="space-y-4">
          {verifiedNotice && (
            <div className="rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800 border border-green-200">
              Email verified successfully! You can now log in.
            </div>
          )}

          {error && <Alert>{error}</Alert>}

          {unverifiedEmail && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
              Need to enter your code?{' '}
              <Link
                href={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                className="font-bold text-link underline"
              >
                Go to verification page &rarr;
              </Link>
            </div>
          )}

          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-sm text-ink-soft">
        New here?{' '}
        <Link href="/signup" className="font-semibold text-link underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
