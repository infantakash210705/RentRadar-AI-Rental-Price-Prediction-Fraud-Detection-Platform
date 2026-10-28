'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, errorMessage, imageUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { amenityLabel, formatRent, furnishingLabel, timeAgo } from '@/lib/format';
import type { Conversation, Listing, MapPoint } from '@/lib/types';
import FairPriceGauge from '@/components/FairPriceGauge';
import MapView from '@/components/MapView';
import { StatusBadge } from '@/components/Badges';
import { Alert, Button, Card, Spinner } from '@/components/ui';

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [l, setL] = useState<Listing | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgErr, setMsgErr] = useState('');

  useEffect(() => {
    if (authLoading) return; // refetch once we know who is viewing (owner/admin see more)
    setL(null); setErr('');
    api<{ listing: Listing }>(`/listings/${id}`).then((r) => setL(r.listing)).catch((e) => setErr(errorMessage(e)));
  }, [id, authLoading, user?.id]);

  if (err) return <div className="mx-auto max-w-3xl space-y-3 p-6"><Alert>{err}</Alert><Link href="/" className="text-sm font-semibold text-link underline">Back to search</Link></div>;
  if (!l) return <div className="p-8"><Spinner label="Loading listing" /></div>;

  const images = l.images ?? [];
  const isOwner = user?.id === l.owner_id;
  const isAdmin = user?.role === 'admin';
  const point: MapPoint = { id: l.id, title: l.title, latitude: l.latitude, longitude: l.longitude, rent: l.rent, bhk: l.bhk, area: l.area, price_verdict: l.price_verdict, cover_image: l.cover_image };

  async function handleMessageOwner() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/listings/${l!.id}`)}`);
      return;
    }
    if (isOwner) return;

    setMsgLoading(true);
    setMsgErr('');
    try {
      const res = await api<{ conversation: Conversation }>('/messages/conversations', {
        method: 'POST',
        body: { listing_id: l!.id },
      });
      router.push(`/messages?c=${res.conversation.id}`);
    } catch (e) {
      setMsgErr(errorMessage(e));
      setMsgLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <Link href="/" className="text-sm font-medium text-link underline">Back to search</Link>

      {l.status !== 'approved' && (isOwner || isAdmin) && (
        <Alert kind="info">
          <StatusBadge status={l.status} />{' '}
          {l.status === 'pending' ? 'Only you and admins can see this listing until it passes review. Editing it re-runs the checks.' : 'This listing is not visible to the public.'}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="aspect-[16/10] bg-canvas">
              {images[sel]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={imageUrl(images[sel].url)} alt={`Photo ${sel + 1} of ${l.title}`} className="h-full w-full object-cover" />
                : <div className="flex h-full items-center justify-center text-sm text-ink-soft">No photos yet</div>}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-2">
                {images.map((im, i) => (
                  <button key={im.id} onClick={() => setSel(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === sel} className={`h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 ${i === sel ? 'border-link' : 'border-transparent'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(im.url)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <Card className="space-y-3 p-5">
            <h1 className="text-xl font-bold tracking-tight">{l.title}</h1>
            <p className="text-ink-soft">{l.address ? `${l.address}, ` : ''}{l.area}, {l.city}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[['Bedrooms', `${l.bhk} BHK`], ['Bathrooms', l.bathrooms], ['Size', `${l.size_sqft} sq ft`], ['Furnishing', furnishingLabel[l.furnishing]]].map(([k, v]) => (
                <div key={String(k)}><dt className="text-ink-soft">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
            {l.amenities.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Amenities">
                {l.amenities.map((a) => <li key={a} className="rounded-full bg-canvas px-3 py-1 text-sm">{amenityLabel(a)}</li>)}
              </ul>
            )}
            {l.description && <p className="whitespace-pre-line text-sm leading-relaxed">{l.description}</p>}
            <p className="text-xs text-ink-soft">Posted {timeAgo(l.created_at)}</p>
          </Card>

          <div className="h-64 overflow-hidden rounded-xl"><MapView points={[point]} center={[l.latitude, l.longitude]} /></div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          <Card className="space-y-4 p-5">
            <p className="tabular text-3xl font-bold">{formatRent(l.rent)}<span className="text-base font-normal text-ink-soft"> /month</span></p>
            {l.predicted_range
              ? <FairPriceGauge rent={l.rent} low={l.predicted_range[0]} high={l.predicted_range[1]} predicted={l.predicted_rent} verdict={l.price_verdict} />
              : <p className="text-sm text-ink-soft">No price estimate is available for this listing yet.</p>}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Contact the owner</h2>
            <p className="text-sm font-medium">{l.owner_name}</p>

            {user ? (
              l.owner_phone ? (
                <div className="space-y-0.5">
                  <p className="text-xs text-ink-soft">Phone number</p>
                  <a href={`tel:${l.owner_phone.replace(/\s/g, '')}`} className="tabular text-lg font-semibold text-link underline block">
                    {l.owner_phone}
                  </a>
                </div>
              ) : (
                <p className="text-sm text-ink-soft">The owner has not added a phone number.</p>
              )
            ) : (
              <p className="text-sm text-ink-soft">
                <Link href={`/login?next=${encodeURIComponent(`/listings/${l.id}`)}`} className="font-semibold text-link underline">
                  Log in
                </Link>{' '}
                to see the owner&apos;s phone number.
              </p>
            )}

            {!isOwner ? (
              <div className="pt-1">
                {msgErr && <div className="mb-2"><Alert>{msgErr}</Alert></div>}
                <Button
                  onClick={handleMessageOwner}
                  disabled={msgLoading}
                  className="w-full flex items-center justify-center gap-2"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {msgLoading ? 'Opening conversation…' : 'Message Owner'}
                </Button>
              </div>
            ) : (
              <div className="rounded-lg bg-canvas p-2.5 text-xs text-ink-soft">
                This is your listing.{' '}
                <Link href={`/listings/${l.id}/edit`} className="font-semibold text-link underline">
                  Edit listing
                </Link>
              </div>
            )}

            <p className="text-xs text-ink-soft">Visit the home before paying anything. Never send advance money to someone you have not met.</p>
          </Card>

          {isAdmin && l.fraud_score !== undefined && l.fraud_score !== null && (
            <Card className="space-y-2 border-above/40 p-5">
              <h2 className="font-semibold">Fraud review <span className="tabular text-above">(risk {l.fraud_score}/100)</span></h2>
              <ul className="space-y-1 text-sm">
                {(l.fraud_flags ?? []).map((f, i) => <li key={i}><span className="font-semibold">{f.type.replace(/_/g, ' ')}</span> ({f.severity}): {f.detail}</li>)}
                {!l.fraud_flags?.length && <li className="text-ink-soft">No flags.</li>}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
