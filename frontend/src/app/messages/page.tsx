'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, errorMessage, imageUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRent, timeAgo } from '@/lib/format';
import type { Conversation, Message } from '@/lib/types';
import RequireAuth from '@/components/RequireAuth';
import { Alert, Button, Card, Spinner } from '@/components/ui';

function MessagesContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const selectedConvIdFromUrl = searchParams.get('c');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(selectedConvIdFromUrl);
  const [messages, setMessages] = useState<Message[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'chat'>(selectedConvIdFromUrl ? 'chat' : 'list');
  const [filterQuery, setFilterQuery] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversation list
  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setConvLoading(true);
    try {
      const res = await api<{ items: Conversation[] }>('/messages/conversations');
      setConversations(res.items);
      if (!activeConvId && res.items.length > 0 && !selectedConvIdFromUrl) {
        // default select first on desktop if none specified
      }
    } catch (e) {
      if (!silent) setError(errorMessage(e));
    } finally {
      if (!silent) setConvLoading(false);
    }
  }, [activeConvId, selectedConvIdFromUrl]);

  // Initial load
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // If URL changes, update active conversation
  useEffect(() => {
    if (selectedConvIdFromUrl) {
      setActiveConvId(selectedConvIdFromUrl);
      setMobileView('chat');
    }
  }, [selectedConvIdFromUrl]);

  // Load messages for active conversation
  const loadMessages = useCallback(async (convId: string, silent = false) => {
    if (!silent) setMsgLoading(true);
    try {
      const res = await api<{ items: Message[] }>(`/messages/conversations/${convId}/messages`);
      setMessages(res.items);
      setSendError('');
      // Also update unread count for this conversation in the list
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      );
    } catch (e) {
      if (!silent) setError(errorMessage(e));
    } finally {
      if (!silent) setMsgLoading(false);
    }
  }, []);

  // When active conversation changes, load messages
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    loadMessages(activeConvId);
  }, [activeConvId, loadMessages]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for new messages every 4 seconds in the active conversation
  useEffect(() => {
    if (!activeConvId) return;
    const interval = setInterval(() => {
      loadMessages(activeConvId, true);
    }, 4000);
    return () => clearInterval(interval);
  }, [activeConvId, loadMessages]);

  // Poll conversation list every 12 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadConversations(true);
    }, 12000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || !activeConvId || sendLoading) return;

    setSendLoading(true);
    setSendError('');
    try {
      const res = await api<{ message: Message }>(`/messages/conversations/${activeConvId}/messages`, {
        method: 'POST',
        body: { body: text },
      });
      setInputText('');
      setMessages((prev) => [...prev, res.message]);

      // Update last message in conversation list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? {
                ...c,
                last_message_body: text,
                last_message_created_at: res.message.created_at,
                last_message_sender_id: user?.id ?? null,
              }
            : c
        )
      );
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSendLoading(false);
    }
  }

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const filteredConversations = conversations.filter((c) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      c.listing_title.toLowerCase().includes(q) ||
      c.other_user_name.toLowerCase().includes(q) ||
      (c.last_message_body && c.last_message_body.toLowerCase().includes(q))
    );
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-ink-soft hover:text-ink underline"
        >
          My listings
        </Link>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="grid h-[78vh] grid-cols-1 overflow-hidden rounded-xl border border-line bg-white shadow-sm md:grid-cols-[340px_1fr] lg:grid-cols-[380px_1fr]">
        {/* Left pane: Conversation List */}
        <section
          aria-label="Conversations"
          className={`flex flex-col border-r border-line bg-white ${
            mobileView === 'chat' ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="border-b border-line p-3">
            <input
              type="text"
              placeholder="Search conversations…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas/50 px-3 py-1.5 text-sm placeholder:text-ink-soft/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-link"
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-line">
            {convLoading && conversations.length === 0 ? (
              <div className="p-8 text-center">
                <Spinner label="Loading conversations" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-sm text-ink-soft">
                {filterQuery ? (
                  <p>No conversations match &ldquo;{filterQuery}&rdquo;</p>
                ) : (
                  <>
                    <p className="font-semibold text-ink">No messages yet</p>
                    <p className="mt-1 text-xs">
                      When you message an owner or someone inquires about your home, conversations will show here.
                    </p>
                  </>
                )}
              </div>
            ) : (
              filteredConversations.map((c) => {
                const isSelected = c.id === activeConvId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveConvId(c.id);
                      setMobileView('chat');
                    }}
                    className={`flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-canvas/60 ${
                      isSelected ? 'bg-canvas border-l-4 border-link' : ''
                    }`}
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-canvas border border-line">
                      {c.listing_cover_image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(c.listing_cover_image)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-ink-soft">
                          Home
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-semibold text-sm text-ink">
                          {c.other_user_name}
                        </span>
                        {c.last_message_created_at && (
                          <span className="shrink-0 text-[11px] text-ink-soft">
                            {timeAgo(c.last_message_created_at)}
                          </span>
                        )}
                      </div>

                      <p className="truncate text-xs text-ink-soft font-medium">
                        {c.listing_title}
                      </p>

                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-ink-soft">
                          {c.last_message_body ? (
                            <>
                              {c.last_message_sender_id === user?.id && (
                                <span className="text-ink font-medium">You: </span>
                              )}
                              {c.last_message_body}
                            </>
                          ) : (
                            <span className="italic">Conversation started</span>
                          )}
                        </p>

                        {c.unread_count > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-link px-1.5 text-[10px] font-bold text-white shadow-sm">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right pane: Active Conversation & Chat History */}
        <section
          aria-label="Conversation view"
          className={`flex flex-col bg-canvas/30 ${
            mobileView === 'list' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {activeConv ? (
            <>
              {/* Conversation Header */}
              <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3 shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileView('list')}
                    aria-label="Back to conversations"
                    className="rounded-md p-1.5 text-ink-soft hover:bg-canvas md:hidden"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>

                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-line bg-canvas">
                    {activeConv.listing_cover_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl(activeConv.listing_cover_image)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-ink-soft">
                        Home
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-bold text-ink">
                        {activeConv.other_user_name}
                      </h2>
                      <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-soft border border-line/60">
                        {activeConv.is_owner ? 'Renter' : 'Property Owner'}
                      </span>
                    </div>

                    <Link
                      href={`/listings/${activeConv.listing_id}`}
                      target="_blank"
                      className="group flex items-center gap-1 text-xs text-link hover:underline truncate"
                    >
                      <span className="truncate">{activeConv.listing_title}</span>
                      <span className="font-semibold text-ink shrink-0">
                        • {formatRent(activeConv.listing_rent)}/mo
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70 group-hover:opacity-100">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </Link>
                  </div>
                </div>

                <Link
                  href={`/listings/${activeConv.listing_id}`}
                  className="hidden sm:inline-flex rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas shrink-0"
                >
                  View Property
                </Link>
              </div>

              {/* Message History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgLoading && messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <Spinner label="Loading messages" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center p-6 text-sm text-ink-soft">
                    <div className="h-12 w-12 rounded-full bg-canvas flex items-center justify-center text-ink-soft mb-2">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <p className="font-semibold text-ink">No messages yet</p>
                    <p className="text-xs mt-1 max-w-xs">
                      Send a message below to start the conversation regarding{' '}
                      <b>{activeConv.listing_title}</b>.
                    </p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const isMine = m.sender_id === user?.id;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                            isMine
                              ? 'bg-ink text-white rounded-br-xs'
                              : 'bg-white text-ink border border-line rounded-bl-xs'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-ink-soft">
                          <span>{timeAgo(m.created_at)}</span>
                          {isMine && m.read_at && (
                            <span className="text-fair font-medium" title="Read by recipient">
                              • Read
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input Box */}
              <div className="border-t border-line bg-white p-3">
                {sendError && (
                  <div className="mb-2">
                    <Alert>{sendError}</Alert>
                  </div>
                )}
                <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                  <div className="relative flex-1">
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage(e);
                        }
                      }}
                      placeholder="Type your message… (Press Enter to send)"
                      maxLength={2000}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-line bg-canvas/30 px-3 py-2 text-sm text-ink placeholder:text-ink-soft/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-link"
                    />
                    <span className="absolute bottom-1 right-2 text-[10px] text-ink-soft/60">
                      {inputText.length}/2000
                    </span>
                  </div>

                  <Button
                    type="submit"
                    disabled={sendLoading || !inputText.trim()}
                    className="h-10 px-4 shrink-0 flex items-center justify-center gap-1"
                  >
                    {sendLoading ? (
                      'Sending…'
                    ) : (
                      <>
                        <span>Send</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      </>
                    )}
                  </Button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-ink-soft">
              <div className="h-16 w-16 rounded-full bg-canvas flex items-center justify-center text-ink-soft mb-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-ink">Select a conversation</h2>
              <p className="mt-1 text-sm max-w-sm">
                Choose a conversation from the left to view message history and reply, or contact an owner from any listing page.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="p-8"><Spinner label="Loading messages" /></div>}>
        <MessagesContent />
      </Suspense>
    </RequireAuth>
  );
}
