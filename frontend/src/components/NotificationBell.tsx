'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { AppNotification, Paged } from '@/lib/types';
import { Spinner } from './ui';

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Poll for unread count every 10 seconds
  useEffect(() => {
    let mounted = true;
    const fetchUnread = () => {
      api<{ unread_count: number }>('/notifications/unread-count')
        .then((res) => {
          if (mounted) setUnreadCount(res.unread_count);
        })
        .catch(() => {});
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch list when dropdown is opened
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api<Paged<AppNotification> & { unread_count: number }>('/notifications?limit=15')
      .then((res) => {
        setNotifications(res.items);
        setUnreadCount(res.unread_count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // Click outside and escape key listener to close dropdown
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  async function handleMarkRead(id: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    try {
      const res = await api<{ notification: AppNotification; unread_count: number }>(`/notifications/${id}/read`, {
        method: 'PATCH',
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount(res.unread_count);
    } catch {
      // ignore
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      await api('/notifications/read-all', { method: 'PATCH' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    } finally {
      setMarkingAll(false);
    }
  }

  function handleNotificationClick(n: AppNotification) {
    if (!n.is_read) {
      handleMarkRead(n.id);
    }
    setOpen(false);
    if (n.conversation_id) {
      router.push(`/messages?c=${n.conversation_id}`);
    } else if (n.listing_id) {
      router.push(`/listings/${n.listing_id}`);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifications (${unreadCount} unread)`}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative flex items-center justify-center rounded-md p-1.5 text-ink hover:bg-canvas focus:outline-none focus:ring-2 focus:ring-link"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow"
            data-testid="unread-badge"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label="Notifications panel"
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border border-line bg-white shadow-xl z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-canvas/40">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-danger/10 text-danger px-2 py-0.5 text-xs font-bold">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={markingAll}
                className="text-xs font-medium text-link hover:underline disabled:opacity-50"
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-line">
            {loading ? (
              <div className="p-6 flex justify-center">
                <Spinner label="Loading notifications" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-ink-soft">
                <p>No notifications yet</p>
                <p className="text-xs mt-1">You will be notified when someone messages you about a listing.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`flex items-start gap-3 p-3.5 text-left cursor-pointer transition-colors hover:bg-canvas/60 ${
                    !n.is_read ? 'bg-fair-bg/30' : ''
                  }`}
                >
                  <div className="mt-1 shrink-0">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        !n.is_read ? 'bg-link' : 'bg-transparent'
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${!n.is_read ? 'font-semibold text-ink' : 'text-ink-soft'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-ink-soft truncate">{n.body}</p>
                    )}
                    <span className="mt-1 block text-[11px] text-ink-soft/70">
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={(e) => handleMarkRead(n.id, e)}
                      title="Mark as read"
                      aria-label="Mark as read"
                      className="shrink-0 p-1 text-ink-soft hover:text-ink rounded"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-line p-2 text-center bg-canvas/30">
            <Link
              href="/messages"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-link hover:underline block py-1"
            >
              Go to all messages →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
