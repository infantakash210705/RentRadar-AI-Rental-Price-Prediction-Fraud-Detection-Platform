'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import RequireAuth from '@/components/RequireAuth';

const TABS = [['/admin', 'Overview'], ['/admin/alerts', 'Fraud alerts'], ['/admin/listings', 'Listings'], ['/admin/users', 'Users']] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <RequireAuth admin>
      <div className="mx-auto max-w-6xl px-4 py-5">
        <nav aria-label="Admin" className="mb-5 flex flex-wrap gap-1 border-b border-line">
          {TABS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${path === href ? 'border-ink text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}>{label}</Link>
          ))}
        </nav>
        {children}
      </div>
    </RequireAuth>
  );
}
