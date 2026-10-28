import Link from 'next/link';
import { formatRent, furnishingLabel } from '@/lib/format';
import { imageUrl } from '@/lib/api';
import type { Listing } from '@/lib/types';
import { VerdictChip } from './Badges';

export default function ListingCard({ l, active, onHover }: { l: Listing; active?: boolean; onHover?: (id: string | null) => void }) {
  return (
    <Link
      href={`/listings/${l.id}`} id={`card-${l.id}`}
      onMouseEnter={() => onHover?.(l.id)} onMouseLeave={() => onHover?.(null)}
      className={`flex gap-3 rounded-xl border bg-white p-3 transition-colors hover:border-ink/40 ${active ? 'border-link' : 'border-line'}`}
    >
      <div className="h-24 w-32 shrink-0 overflow-hidden rounded-lg bg-canvas sm:h-28 sm:w-40">
        {l.cover_image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imageUrl(l.cover_image)} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <div className="flex h-full items-center justify-center text-xs text-ink-soft">No photo</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="tabular text-lg font-bold">{formatRent(l.rent)}<span className="text-sm font-normal text-ink-soft"> /month</span></p>
          <VerdictChip verdict={l.price_verdict} />
        </div>
        <h3 className="truncate text-sm font-medium">{l.title}</h3>
        <p className="truncate text-sm text-ink-soft">{l.area}, {l.city}</p>
        <p className="mt-1 text-xs text-ink-soft">
          {l.bhk} BHK, {l.size_sqft} sq ft, {furnishingLabel[l.furnishing]}
          {l.distance_km !== undefined && <>, {l.distance_km} km away</>}
        </p>
      </div>
    </Link>
  );
}
