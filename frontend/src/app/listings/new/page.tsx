'use client';
import ListingForm from '@/components/ListingForm';
import RequireAuth from '@/components/RequireAuth';
export default function NewListing() { return <RequireAuth><ListingForm /></RequireAuth>; }
