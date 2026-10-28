'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Type-specific input handlers preventing invalid characters & enforcing formatting
  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent typing digits directly (0-9)
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip any numbers if pasted or entered via IME/autocomplete
    const sanitized = e.target.value.replace(/[0-9]/g, '');
    setF((prev) => ({ ...prev, name: sanitized }));
    if (fields.name) setFields((prev) => ({ ...prev, name: '' }));
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Automatically convert any uppercase letters to lowercase
    const lowercase = e.target.value.toLowerCase();
    setF((prev) => ({ ...prev, email: lowercase }));
    if (fields.email) setFields((prev) => ({ ...prev, email: '' }));
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((prev) => ({ ...prev, password: e.target.value }));
    if (fields.password) setFields((prev) => ({ ...prev, password: '' }));
  };

  const handlePhoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      ['Backspace', 'Tab', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(e.key) ||
      e.ctrlKey ||
      e.metaKey
    ) {
      return;
    }
    // Allow leading + for international format
    if (e.key === '+' && e.currentTarget.selectionStart === 0 && !e.currentTarget.value.includes('+')) {
      return;
    }
    // Block any non-digit character
    if (!/^[0-9]$/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep only numbers and optional leading +
    let val = e.target.value;
    const hasPlus = val.startsWith('+');
    val = val.replace(/[^0-9]/g, '');
    const sanitized = hasPlus ? `+${val}` : val;
    setF((prev) => ({ ...prev, phone: sanitized }));
    if (fields.phone) setFields((prev) => ({ ...prev, phone: '' }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFields({});

    // Client-side validation
    const trimmedName = f.name.trim();
    if (/\d/.test(trimmedName)) {
      setFields({ name: 'Name cannot contain numbers' });
      return;
    }
    if (!trimmedName || trimmedName.length < 2) {
      setFields({ name: 'Name must be at least 2 characters' });
      return;
    }
    if (!/^[\p{L}\s'-]+$/u.test(trimmedName)) {
      setFields({ name: 'Name can only contain letters, spaces, hyphens and apostrophes' });
      return;
    }

    setBusy(true);
    try {
      await signup({
        name: trimmedName,
        email: f.email.trim().toLowerCase(),
        password: f.password,
        ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      });
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setFields(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Create your account</h1>
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Full name" htmlFor="name" hint="Letters and spaces only (no numbers)." error={fields.name}>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={f.name}
              onKeyDown={handleNameKeyDown}
              onChange={handleNameChange}
              placeholder="e.g. John Doe"
            />
          </Field>
          <Field label="Email" htmlFor="email" error={fields.email}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={f.email}
              onChange={handleEmailChange}
              placeholder="name@example.com"
            />
          </Field>
          <Field label="Phone (optional)" htmlFor="phone" hint="Numbers only (shown to logged-in renters on your listings)." error={fields.phone}>
            <Input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={f.phone}
              onKeyDown={handlePhoneKeyDown}
              onChange={handlePhoneChange}
              placeholder="e.g. 9876543210"
            />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 8 characters, with a letter and a number." error={fields.password}>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={f.password}
                onChange={handlePasswordChange}
                className="pr-14"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-ink-soft hover:text-ink focus:outline-none"
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-sm text-ink-soft">
        Already registered? <Link href="/login" className="font-semibold text-link underline">Log in</Link>
      </p>
    </div>
  );
}
