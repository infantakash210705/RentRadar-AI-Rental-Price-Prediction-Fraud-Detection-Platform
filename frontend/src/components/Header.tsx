'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import NotificationBell from './NotificationBell';

export default function Header() {
  const { user, loading, logout } = useAuth();
  const link = 'rounded-md px-2 py-1 text-sm font-medium text-ink hover:bg-canvas';
  return (
    <header className="sticky top-0 z-[1100] border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="#14213d" strokeWidth="2" />
            <circle cx="12" cy="12" r="5.5" stroke="#14213d" strokeWidth="2" opacity=".55" />
            <circle cx="12" cy="12" r="1.8" fill="#2f5bea" />
          </svg>
          RentRadar
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
          <Link href="/" className={link}>Browse</Link>
          <Link href="/listings/new" className={link}>Post a listing</Link>
          {!loading && user && (
            <>
              <Link href="/dashboard" className={link}>My listings</Link>
              <Link href="/messages" className={link}>Messages</Link>
              <NotificationBell />
              {user.role === 'admin' && <Link href="/admin" className={link}>Admin</Link>}
              <Link href="/profile" className={link}>{user.name.split(' ')[0]}</Link>
              <button onClick={logout} className={link}>Log out</button>
            </>
          )}
          {!loading && !user && (
            <>
              <Link href="/login" className={link}>Log in</Link>
              <Link href="/signup" className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0c1530]">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
