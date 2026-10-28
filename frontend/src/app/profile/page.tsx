'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import type { User } from '@/lib/types';
import RequireAuth from '@/components/RequireAuth';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value.replace(/[0-9]/g, ''));
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
    // Strip any non-digit characters (preserving optional leading +)
    let val = e.target.value;
    const hasPlus = val.startsWith('+');
    val = val.replace(/[^0-9]/g, '');
    setPhone(hasPlus ? `+${val}` : val);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');

    const trimmedName = name.trim();
    if (/\d/.test(trimmedName)) {
      setErr('Name cannot contain numbers.');
      return;
    }
    if (!trimmedName || trimmedName.length < 2) {
      setErr('Name must be at least 2 characters.');
      return;
    }

    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^[+]?[0-9]{7,15}$/.test(trimmedPhone)) {
      setErr('Phone number must contain only numbers (between 7 and 15 digits).');
      return;
    }

    setBusy(true);
    const body: Record<string, unknown> = { name: trimmedName, phone: trimmedPhone || null };
    if (next) {
      body.currentPassword = cur;
      body.newPassword = next;
    }
    try {
      const r = await api<{ user: User }>('/users/me', { method: 'PUT', body });
      setUser(r.user);
      setCur('');
      setNext('');
      setMsg('Profile saved.');
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
      <Card className="p-5">
        <form onSubmit={save} className="space-y-4" noValidate>
          {msg && <Alert kind="success">{msg}</Alert>}
          {err && <Alert>{err}</Alert>}
          <Field label="Email" htmlFor="em">
            <Input id="em" value={user?.email ?? ''} disabled />
          </Field>
          <Field label="Name" htmlFor="nm" hint="Letters and spaces only (no numbers).">
            <Input
              id="nm"
              value={name}
              onKeyDown={handleNameKeyDown}
              onChange={handleNameChange}
              required
              placeholder="Your full name"
            />
          </Field>
          <Field label="Phone" htmlFor="ph" hint="Numbers only (e.g. 9876543210 or +919876543210).">
            <Input
              id="ph"
              type="tel"
              inputMode="numeric"
              value={phone}
              onKeyDown={handlePhoneKeyDown}
              onChange={handlePhoneChange}
              placeholder="e.g. 9876543210"
            />
          </Field>
          <fieldset className="space-y-3 border-t border-line pt-4">
            <legend className="text-sm font-semibold">Change password (optional)</legend>
            <Field label="Current password" htmlFor="cp">
              <Input
                id="cp"
                type="password"
                autoComplete="current-password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
              />
            </Field>
            <Field label="New password" htmlFor="np" hint="At least 8 characters, with a letter and a number.">
              <Input
                id="np"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
          </fieldset>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  );
}
