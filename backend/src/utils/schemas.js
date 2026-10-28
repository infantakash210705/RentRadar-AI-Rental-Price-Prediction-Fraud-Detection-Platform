const { z } = require('zod');

const stripHtml = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const text = (min, max) => z.string().transform(stripHtml).pipe(z.string().min(min).max(max));

const name = text(2, 100)
  .refine((n) => !/\d/.test(n), { message: 'Name cannot contain numbers' })
  .refine((n) => /^[\p{L}\s'-]+$/u.test(n), { message: 'Name can only contain letters, spaces, hyphens and apostrophes' });

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');
const phone = z.string().trim().regex(/^[+]?[0-9\s-]{7,15}$/, 'Invalid phone number');

const signup = z.object({ name, email, password, phone: phone.optional() });
const login = z.object({ email, password: z.string().min(1).max(128) });
const profileUpdate = z.object({
  name: name.optional(),
  phone: phone.nullable().optional(),
  currentPassword: z.string().optional(),
  newPassword: password.optional(),
}).refine((d) => !d.newPassword || d.currentPassword, {
  message: 'currentPassword is required to set a new password', path: ['currentPassword'],
});

const amenities = z.array(z.string().transform((s) => stripHtml(s).toLowerCase()).pipe(z.string().min(1).max(40)))
  .max(30)
  .transform((a) => [...new Set(a)]);

const listingFields = z.object({
  title: text(5, 150),
  description: text(0, 5000),
  city: text(2, 60),
  area: text(2, 80),
  address: text(0, 250).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  size_sqft: z.number().int().min(50).max(100000),
  bhk: z.number().int().min(1).max(10),
  bathrooms: z.number().int().min(1).max(10),
  furnishing: z.enum(['unfurnished', 'semi-furnished', 'furnished']),
  rent: z.number().int().min(500).max(10000000),
  amenities,
});
// Defaults apply on create only. Update is a true partial (zod's .partial() would keep defaults and wipe fields).
const listingCreate = listingFields.extend({
  description: listingFields.shape.description.default(''),
  bathrooms: listingFields.shape.bathrooms.default(1),
  furnishing: listingFields.shape.furnishing.default('unfurnished'),
  amenities: listingFields.shape.amenities.default([]),
});
const listingUpdate = listingFields.partial().refine((d) => Object.keys(d).length > 0, 'No fields to update');

const predictInput = listingFields.pick({
  city: true, area: true, size_sqft: true, bhk: true,
}).extend({
  bathrooms: listingFields.shape.bathrooms.default(1),
  furnishing: listingFields.shape.furnishing.default('unfurnished'),
  amenities: listingFields.shape.amenities.default([]),
});

const num = z.coerce.number();
const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(60).optional(),
  minRent: num.int().min(0).optional(),
  maxRent: num.int().min(0).optional(),
  bhk: num.int().min(1).max(10).optional(),
  minBhk: num.int().min(1).max(10).optional(),
  furnishing: z.enum(['unfurnished', 'semi-furnished', 'furnished']).optional(),
  amenities: z.string().optional().transform((s) => (s ? s.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean) : [])),
  lat: num.min(-90).max(90).optional(),
  lng: num.min(-180).max(180).optional(),
  radius_km: num.min(0.1).max(200).optional(),
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional(),
  sort: z.enum(['newest', 'rent_asc', 'rent_desc', 'distance']).default('newest'),
  page: num.int().min(1).default(1),
  limit: num.int().min(1).max(50).default(12),
}).refine((d) => (d.lat === undefined) === (d.lng === undefined), { message: 'lat and lng must be provided together' })
  .refine((d) => d.radius_km === undefined || d.lat !== undefined, { message: 'radius_km requires lat and lng' })
  .refine((d) => d.sort !== 'distance' || d.lat !== undefined, { message: 'sort=distance requires lat and lng' });

const page = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
const adminAlertsQuery = z.object({ status: z.enum(['open', 'resolved']).default('open'), ...page });
const adminResolve = z.object({
  action: z.enum(['approve', 'reject', 'ban']),
  ban_owner: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});
const adminListingsQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'banned']).optional(),
  q: z.string().trim().max(100).optional(), ...page,
});
const adminListingStatus = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'banned']) });
const adminUsersQuery = z.object({ q: z.string().trim().max(100).optional(), ...page });
const adminUserPatch = z.object({ is_banned: z.boolean().optional(), role: z.enum(['user', 'admin']).optional() })
  .refine((d) => d.is_banned !== undefined || d.role !== undefined, 'Nothing to update');

const createConversation = z.object({
  listing_id: z.string().uuid('Invalid listing ID'),
  initial_message: z.string().transform(stripHtml).pipe(z.string().min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters')).optional(),
});

const createMessage = z.object({
  body: z.string().transform(stripHtml).pipe(z.string().min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters')),
});

const notificationsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

module.exports = {
  adminAlertsQuery,
  adminResolve,
  adminListingsQuery,
  adminListingStatus,
  adminUsersQuery,
  adminUserPatch,
  predictInput,
  signup,
  login,
  profileUpdate,
  listingCreate,
  listingUpdate,
  searchQuery,
  createConversation,
  createMessage,
  notificationsQuery,
};
