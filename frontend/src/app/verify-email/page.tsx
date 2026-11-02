'use client';
import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email') || '';

  const [email, setEmail] = useState(emailParam);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (emailParam) setEmail(emailParam);
  }, [emailParam]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    setOtp(val);
    if (error) setError('');
  };

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      const res = await api<{ message: string }>('/auth/verify-otp', {
        method: 'POST',
        body: { email, otp },
      });
      setSuccess(res.message || 'Email successfully verified! Redirecting to login…');
      setTimeout(() => {
        router.push(`/login?email=${encodeURIComponent(email)}&verified=1`);
      }, 2000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (!email) {
      setError('Please enter your email address to resend code.');
      return;
    }
    setResending(true);
    setError('');
    setSuccess('');
    try {
      const res = await api<{ message: string }>('/auth/resend-otp', {
        method: 'POST',
        body: { email },
      });
      setSuccess(res.message || 'A new verification code has been sent to your email.');
      setResendCooldown(60); // 60s cooldown
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="text-center mb-6">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-link/10 text-link mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Verify Your Email</h1>
        <p className="mt-2 text-sm text-ink-soft">
          We sent a 6-digit verification code to
          <br />
          <span className="font-semibold text-ink">{email || 'your email'}</span>
        </p>
      </div>

      <Card className="space-y-4 p-6 shadow-sm">
        <form onSubmit={handleVerify} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          {success && (
            <div className="rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800 border border-green-200">
              {success}
            </div>
          )}

          {!emailParam && (
            <Field label="Email Address" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value.toLowerCase())}
                placeholder="name@example.com"
              />
            </Field>
          )}

          <Field label="6-Digit Verification Code" htmlFor="otp">
            <Input
              id="otp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              required
              value={otp}
              onChange={handleOtpChange}
              placeholder="000000"
              className="text-center tracking-widest text-2xl font-bold font-mono h-12"
            />
          </Field>

          <Button type="submit" disabled={busy || otp.length !== 6} className="w-full">
            {busy ? 'Verifying…' : 'Verify & Continue'}
          </Button>
        </form>

        <div className="pt-2 text-center text-sm text-ink-soft border-t border-line">
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
            className="font-semibold text-link underline disabled:opacity-50 disabled:no-underline"
          >
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : resending
              ? 'Sending…'
              : 'Resend Code'}
          </button>
        </div>
      </Card>

      <div className="mt-6 text-center text-sm text-ink-soft">
        Already verified?{' '}
        <Link href="/login" className="font-semibold text-link underline">
          Log in
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
