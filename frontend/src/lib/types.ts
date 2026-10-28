export type Furnishing = 'unfurnished' | 'semi-furnished' | 'furnished';
export type Verdict = 'fair' | 'below_market' | 'above_market' | null;
export type ListingStatus = 'pending' | 'approved' | 'rejected' | 'banned';

export interface ListingImage { id: string; url: string }
export interface Listing {
  id: string; owner_id: string; owner_name: string; owner_phone?: string;
  title: string; description: string; city: string; area: string; address: string | null;
  latitude: number; longitude: number; size_sqft: number; bhk: number; bathrooms: number;
  furnishing: Furnishing; rent: number; amenities: string[]; status: ListingStatus;
  predicted_rent: number | null; predicted_range: [number, number] | null; price_verdict: Verdict;
  cover_image: string | null; images?: ListingImage[]; distance_km?: number;
  fraud_score?: number | null; fraud_flags?: FraudFlag[];
  created_at: string; updated_at: string;
}
export interface FraudFlag { type: string; severity: 'high' | 'medium' | 'low' | 'info'; detail: string; weight?: number; category?: string; related_listing_id?: string }
export interface MapPoint { id: string; title: string; latitude: number; longitude: number; rent: number; bhk: number; area: string; price_verdict: Verdict; cover_image: string | null }
export interface Paged<T> { items: T[]; page: number; limit: number; total: number; total_pages: number }
export interface User { id: string; name: string; email: string; phone: string | null; role: 'user' | 'admin' }
export interface Prediction { predicted_rent: number; low: number; high: number; confidence: string | null }
export interface ListingInput {
  title: string; description: string; city: string; area: string; address?: string;
  latitude: number; longitude: number; size_sqft: number; bhk: number; bathrooms: number;
  furnishing: Furnishing; rent: number; amenities: string[];
}

// ---- admin ----
export interface AdminAlert {
  id: string; listing_id: string; risk_score: number; flags: FraudFlag[]; status: 'open' | 'resolved'; resolution: string | null;
  created_at: string; resolved_at: string | null; title: string; city: string; area: string; rent: number; predicted_rent: number | null;
  size_sqft: number; bhk: number; listing_status: ListingStatus; owner_id: string; owner_name: string; owner_email: string; owner_banned: boolean; cover_image: string | null;
}
export interface AdminListing {
  id: string; title: string; city: string; area: string; rent: number; predicted_rent: number | null; status: ListingStatus;
  fraud_score: number | null; created_at: string; owner_id: string; owner_name: string; owner_email: string; cover_image: string | null;
}
export interface AdminUser {
  id: string; name: string; email: string; phone: string | null; role: 'user' | 'admin'; is_banned: boolean; created_at: string;
  listing_count: number; problem_listings: number;
}
export interface ModelMetrics { mae: number; rmse: number; r2: number; mape_pct?: number; within_15pct: number }
export interface AdminStats {
  users: { total: number; banned: number; new_7d: number };
  listings: { total: number; by_status: Record<ListingStatus, number>; per_day: { day: string; n: number }[] };
  price_verdicts: { fair: number; above_market: number; below_market: number };
  fraud: { open_alerts: number; total_alerts: number; reviewed: number; confirmed_fraud: number; false_alarms: number; flag_precision_pct: number | null; avg_risk_score: number | null; high_risk_listings: number; top_flag_types: { type: string; n: number }[] };
  model: { available: false } | { available: true; version: string; best_model: string; dataset: string; rows: number; test_metrics: ModelMetrics; comparison: Record<string, ModelMetrics>; trained_at: string; note?: string };
}

// ---- messaging & notifications ----
export interface Conversation {
  id: string;
  listing_id: string;
  renter_id: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  listing_title: string;
  listing_city: string;
  listing_area: string;
  listing_rent: number;
  listing_cover_image: string | null;
  listing_status?: ListingStatus;
  renter_name?: string;
  owner_name?: string;
  other_user_id: string;
  other_user_name: string;
  is_owner: boolean;
  last_message_body: string | null;
  last_message_created_at: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name?: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: 'new_message' | 'new_conversation';
  title: string;
  body: string;
  conversation_id: string | null;
  listing_id: string | null;
  listing_title?: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}
