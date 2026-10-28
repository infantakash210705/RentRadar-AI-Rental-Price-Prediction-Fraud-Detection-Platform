import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const v = {
    primary: 'bg-ink text-white hover:bg-[#0c1530] disabled:opacity-50',
    secondary: 'bg-white text-ink border border-line hover:bg-canvas disabled:opacity-50',
    danger: 'bg-danger text-white hover:opacity-90 disabled:opacity-50',
    ghost: 'text-ink hover:bg-canvas disabled:opacity-50',
  }[variant];
  return <button {...p} className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed', v, className)} />;
}

export const inputCls = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-soft/60 focus:border-link';

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-ink-soft">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;

export function Alert({ kind = 'error', className, children }: { kind?: 'error' | 'info' | 'success'; className?: string; children: ReactNode }) {
  const c = { error: 'border-danger/30 bg-[#fdecea] text-danger', info: 'border-link/30 bg-[#eaf0ff] text-ink', success: 'border-fair/30 bg-fair-bg text-ink' }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-3 py-2 text-sm', c, className)}>{children}</div>;
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div role="status" className="flex items-center gap-2 text-sm text-ink-soft"><span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" />{label}…</div>
);

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('rounded-xl border border-line bg-white', className)}>{children}</div>
);
