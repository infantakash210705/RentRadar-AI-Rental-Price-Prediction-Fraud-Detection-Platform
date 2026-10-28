'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import type { Listing } from '@/lib/types';
import ListingForm from '@/components/ListingForm';
import RequireAuth from '@/components/RequireAuth';
import { Alert, Spinner } from '@/components/ui';

function Edit() {
  const { id } = useParams<{ id: string }>();
  const [l, setL] = useState<Listing | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<{ listing: Listing }>(`/listings/${id}`).then((r) => setL(r.listing)).catch((e) => setErr(errorMessage(e))); }, [id]);
  if (err) return <div className="mx-auto max-w-3xl p-6"><Alert>{err}</Alert></div>;
  if (!l) return <div className="p-8"><Spinner /></div>;
  return <ListingForm initial={l} />;
}
export default function EditPage() { return <RequireAuth><Edit /></RequireAuth>; }
