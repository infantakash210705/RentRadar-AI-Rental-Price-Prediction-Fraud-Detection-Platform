-- RentRadar schema (idempotent: safe to run repeatedly)
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('pending', 'approved', 'rejected', 'banned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE furnishing_type AS ENUM ('unfurnished', 'semi-furnished', 'furnished');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  phone         TEXT,
  role          user_role   NOT NULL DEFAULT 'user',
  is_banned     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL CHECK (char_length(title) BETWEEN 5 AND 150),
  description    TEXT        NOT NULL DEFAULT '',
  city           TEXT        NOT NULL,
  area           TEXT        NOT NULL,
  address        TEXT,
  latitude       DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude      DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location       GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS
                   (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
  size_sqft      INTEGER     NOT NULL CHECK (size_sqft > 0),
  bhk            SMALLINT    NOT NULL CHECK (bhk BETWEEN 1 AND 10),
  bathrooms      SMALLINT    NOT NULL DEFAULT 1 CHECK (bathrooms BETWEEN 1 AND 10),
  furnishing     furnishing_type NOT NULL DEFAULT 'unfurnished',
  rent           INTEGER     NOT NULL CHECK (rent > 0),
  amenities      TEXT[]      NOT NULL DEFAULT '{}',
  status         listing_status NOT NULL DEFAULT 'pending',
  predicted_rent INTEGER,
  predicted_low  INTEGER,
  predicted_high INTEGER,
  fraud_score    SMALLINT    CHECK (fraud_score BETWEEN 0 AND 100),
  fraud_flags    JSONB       NOT NULL DEFAULT '[]',
  search_vector  TSVECTOR GENERATED ALWAYS AS (
                   to_tsvector('simple',
                     coalesce(title,'') || ' ' || coalesce(description,'') || ' ' ||
                     coalesce(area,'')  || ' ' || coalesce(city,''))
                 ) STORED,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_location   ON listings USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_listings_geom       ON listings USING GIST ((location::geometry));
CREATE INDEX IF NOT EXISTS idx_listings_search     ON listings USING GIN  (search_vector);
CREATE INDEX IF NOT EXISTS idx_listings_amenities  ON listings USING GIN  (amenities);
CREATE INDEX IF NOT EXISTS idx_listings_city_rent  ON listings (lower(city), rent);
CREATE INDEX IF NOT EXISTS idx_listings_status     ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_owner      ON listings (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_fraud      ON listings (fraud_score DESC) WHERE fraud_score IS NOT NULL;

CREATE TABLE IF NOT EXISTS listing_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID        NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  filename    TEXT        NOT NULL,
  sha256      TEXT        NOT NULL,
  phash       TEXT,
  embedding   REAL[],
  position    SMALLINT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_images_listing ON listing_images (listing_id, position);
CREATE INDEX IF NOT EXISTS idx_images_sha     ON listing_images (sha256);

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID        NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  risk_score  SMALLINT    NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  flags       JSONB       NOT NULL DEFAULT '[]',
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution  TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON fraud_alerts (status, created_at DESC);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated    ON users;
CREATE TRIGGER trg_users_updated    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_listings_updated ON listings;
CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Conversations between renters and property owners
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  renter_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversation_listing_renter UNIQUE (listing_id, renter_id),
  CONSTRAINT chk_conversation_different_users CHECK (renter_id <> owner_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_renter  ON conversations (renter_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_owner   ON conversations (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_listing ON conversations (listing_id);

-- Individual messages in a conversation
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender       ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread       ON messages (conversation_id, read_at) WHERE read_at IS NULL;

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('new_message', 'new_conversation')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  listing_id      UUID REFERENCES listings(id) ON DELETE CASCADE,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id) WHERE is_read = FALSE;

DROP TRIGGER IF EXISTS trg_conversations_updated ON conversations;
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
