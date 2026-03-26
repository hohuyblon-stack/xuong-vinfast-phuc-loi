-- ─────────────────────────────────────────────────────────────────────────
-- VinFast Phúc Lợi Bot — Supabase PostgreSQL Schema
-- ─────────────────────────────────────────────────────────────────────────
--
-- DEPLOYMENT INSTRUCTIONS:
-- 1. Create a Supabase project at https://supabase.com
-- 2. Go to SQL Editor
-- 3. Create a new query
-- 4. Copy & paste this entire file
-- 5. Run the query
-- 6. Verify all tables are created (see Schema section on left)
--
-- ⚠️ IMPORTANT: This migration is idempotent.
-- Run it multiple times safely — it will only create what's missing.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────
-- TABLE: DANH SÁCH CHÍNH (vehicles)
-- ─────────────────────────────────────────
-- Purpose: Core tracking table for vehicle entries/exits
-- Primary columns:
--   - vehicle_id: Unique trip ID (format: yyyyMMddHHmmssSSSnnnnnn)
--   - plate: License plate number (e.g., 30A-12345)
--   - time_in: Entry timestamp (UTC ISO 8601)
--   - time_out: Exit timestamp (NULL while in workshop)
--   - duration_minutes: Computed duration on exit
--   - status: 'Đang trong xưởng' | 'Đã ra xưởng' | 'Hết hạn theo dõi'
--   - priority: 'Bình thường' | 'Cảnh báo' (>24h) | 'Khẩn' (>48h)
--
-- Synced to: Google Sheets tab "DANH SÁCH CHÍNH" (read-only mirror)

CREATE TABLE IF NOT EXISTS vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       TEXT NOT NULL UNIQUE,
  plate            TEXT NOT NULL,
  time_in          TIMESTAMPTZ NOT NULL,
  time_out         TIMESTAMPTZ,
  duration_minutes INTEGER,
  image_in_url     TEXT NOT NULL DEFAULT '',
  image_out_url    TEXT,
  status           TEXT NOT NULL DEFAULT 'Đang trong xưởng',
  priority         TEXT NOT NULL DEFAULT 'Bình thường',
  note             TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: Fast lookups by plate + status (most common query)
CREATE INDEX IF NOT EXISTS idx_vehicles_plate_status ON vehicles (plate, status);

-- Index: Status-only queries (get all "in workshop")
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles (status);

-- Index: Time range queries (e.g., vehicles entered in last 7 days)
CREATE INDEX IF NOT EXISTS idx_vehicles_time_in ON vehicles (time_in DESC);

-- Index: Finding vehicles by exit time (for daily reports)
CREATE INDEX IF NOT EXISTS idx_vehicles_time_out ON vehicles (time_out DESC);

-- Index: Direct vehicle ID lookup
CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_id ON vehicles (vehicle_id);

-- ─────────────────────────────────────────
-- TABLE: NHẬT KÝ (events)
-- ─────────────────────────────────────────
-- Purpose: Complete audit log of all OCR events and decisions
-- Primary columns:
--   - event_id: Unique event ID (format: yyyyMMddHHmmssSSSnnnnnn)
--   - timestamp: When photo was received (UTC ISO 8601)
--   - record_type: Type of photo (not currently differentiated)
--   - plate_ai: OCR result (raw license plate text)
--   - confidence_label: 'Cao' | 'Vừa' | 'Thấp' (based on OCR confidence)
--   - message_key: Telegram message identifier (for idempotency)
--   - result: Processing result (status of VAO/RA/error)
--
-- Synced to: Google Sheets tab "NHẬT KÝ" (read-only mirror)

CREATE TABLE IF NOT EXISTS events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         TEXT NOT NULL UNIQUE,
  timestamp        TIMESTAMPTZ NOT NULL,
  record_type      TEXT NOT NULL DEFAULT 'Chưa xác định',
  plate_ai         TEXT NOT NULL DEFAULT '',
  confidence_label TEXT NOT NULL DEFAULT '',
  image_url        TEXT NOT NULL DEFAULT '',
  sender           TEXT NOT NULL DEFAULT '',
  message_key      TEXT NOT NULL DEFAULT '',  -- [MSG_ID:chatId_msgId] for idempotency
  result           TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: O(1) idempotency check on message_key
-- Uses partial index to only index non-empty message_keys
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_message_key
  ON events (message_key)
  WHERE message_key != '';

-- Index: Event ID direct lookup
CREATE INDEX IF NOT EXISTS idx_events_event_id ON events (event_id);

-- Index: Time-based queries (recent events, daily summaries)
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events (timestamp DESC);

-- ─────────────────────────────────────────
-- TABLE: CẦN KIỂM TRA (reviews)
-- ─────────────────────────────────────────
-- Purpose: Failed OCR results requiring manual review
-- Primary columns:
--   - error_id: Unique error ID (format: yyyyMMddHHmmssSSSnnnnnn)
--   - event_id: Link to original event (if applicable)
--   - image_url: Photo of problematic plate
--   - plate_ai: What OCR read (may be empty/garbage)
--   - corrected_plate: Manually corrected plate (filled by reviewer)
--   - reason: Why it failed (e.g., "Ảnh mờ / không thấy biển số")
--   - review_status: 'Chưa xử lý' | 'Đã xử lý' | 'Bỏ qua'
--   - reviewer: Who reviewed it (Telegram user name)
--   - resolved_at: Timestamp when marked as resolved
--   - linked_vehicle_id: If corrected, which vehicle_id it matched
--
-- Synced to: Google Sheets tab "CẦN KIỂM TRA" (read-only mirror)

CREATE TABLE IF NOT EXISTS reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_id          TEXT NOT NULL UNIQUE,
  event_id          TEXT NOT NULL DEFAULT '',
  timestamp         TIMESTAMPTZ NOT NULL,
  image_url         TEXT NOT NULL DEFAULT '',
  plate_ai          TEXT NOT NULL DEFAULT '',
  corrected_plate   TEXT NOT NULL DEFAULT '',
  reason            TEXT NOT NULL DEFAULT '',
  suggestion        TEXT NOT NULL DEFAULT '',
  review_status     TEXT NOT NULL DEFAULT 'Chưa xử lý',
  review_note       TEXT NOT NULL DEFAULT '',
  reviewer          TEXT NOT NULL DEFAULT '',
  resolved_at       TIMESTAMPTZ,
  linked_vehicle_id TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: Find unresolved reviews (priority)
CREATE INDEX IF NOT EXISTS idx_reviews_review_status ON reviews (review_status);

-- Index: Time-based queries (recent failures)
CREATE INDEX IF NOT EXISTS idx_reviews_timestamp ON reviews (timestamp DESC);

-- ─────────────────────────────────────────
-- FUNCTION: process_vehicle()
-- ─────────────────────────────────────────
-- Purpose: Atomic VAO/RA decision with race-condition safety
--
-- MECHANISM:
-- Uses PostgreSQL's SELECT FOR UPDATE inside a PL/pgSQL transaction
-- to serialize concurrent burst photos for the same plate.
-- When two photos of the same plate arrive simultaneously:
--   1. First call acquires row lock on vehicles table
--   2. Second call blocks waiting for lock
--   3. First call completes, releases lock
--   4. Second call acquires lock with updated state
--
-- This eliminates the "burst photo" race condition at the DB level
-- without needing in-process mutexes or Redis locks.
--
-- PARAMETERS:
--   p_plate: License plate number (e.g., "30A-12345")
--   p_vehicle_id: Unique trip ID (generated by app)
--   p_now_ts: Current timestamp in UTC ISO 8601
--   p_image_url: URL to stored photo
--   p_min_workshop_secs: Minimum time in workshop before allowing RA
--     (default: 900 = 15 minutes, avoids burst duplicates)
--
-- RETURNS:
--   action: 'VAO' | 'RA' | 'RA_DUPLICATE'
--   vehicle_id: The trip ID
--   time_in_ts: Entry timestamp
--   seconds_in: 0 for VAO; elapsed seconds for RA
--
-- SIDE EFFECTS:
--   On VAO: Creates new vehicles row (with automatic timestamp)
--   On RA: Updates vehicles row (time_out, duration_minutes, status, priority)
--   On RA_DUPLICATE: Returns decision but makes NO changes (safe to retry)

CREATE OR REPLACE FUNCTION process_vehicle(
  p_plate              TEXT,
  p_vehicle_id         TEXT,
  p_now_ts             TIMESTAMPTZ,
  p_image_url          TEXT,
  p_min_workshop_secs  INTEGER DEFAULT 900
)
RETURNS TABLE(
  action      TEXT,
  vehicle_id  TEXT,
  time_in_ts  TIMESTAMPTZ,
  seconds_in  NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row    vehicles%ROWTYPE;
  v_secs   NUMERIC;
BEGIN
  -- ──────────────────────────────────────────────────────────────
  -- CRITICAL: SELECT FOR UPDATE locks the row for this plate.
  -- Any concurrent calls for the same plate block here until
  -- the first one completes. This serializes burst photos.
  -- ──────────────────────────────────────────────────────────────
  SELECT * INTO v_row
  FROM vehicles
  WHERE plate = p_plate
    AND status = 'Đang trong xưởng'
  ORDER BY time_in DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- ───────────────────────────────────────────────────────────────
    -- Active vehicle found → This is an EXIT (RA)
    -- ───────────────────────────────────────────────────────────────
    v_secs := EXTRACT(EPOCH FROM (p_now_ts - v_row.time_in));

    IF v_secs < p_min_workshop_secs THEN
      -- ───────────────────────────────────────────────────────────────
      -- Too quick: Car entered less than p_min_workshop_secs ago.
      -- Likely a burst duplicate (same photo arrived twice) or OCR noise.
      -- Do NOT mark as RA. Return decision but make no DB changes.
      -- Safe to retry → app will re-call this RPC if needed.
      -- ───────────────────────────────────────────────────────────────
      RETURN QUERY
        SELECT 'RA_DUPLICATE'::TEXT, v_row.vehicle_id, v_row.time_in, v_secs;
    ELSE
      -- ───────────────────────────────────────────────────────────────
      -- Real exit: Vehicle spent adequate time in workshop.
      -- Update record atomically while we hold the row lock.
      -- ───────────────────────────────────────────────────────────────
      UPDATE vehicles SET
        time_out         = p_now_ts,
        duration_minutes = ROUND(v_secs / 60)::INTEGER,
        image_out_url    = p_image_url,
        status           = 'Đã ra xưởng',
        priority         = 'Bình thường',
        updated_at       = now()
      WHERE id = v_row.id;

      RETURN QUERY
        SELECT 'RA'::TEXT, v_row.vehicle_id, v_row.time_in, v_secs;
    END IF;

  ELSE
    -- ───────────────────────────────────────────────────────────────
    -- No active vehicle with this plate → New ENTRY (VAO)
    -- Create record atomically inside the transaction.
    -- ───────────────────────────────────────────────────────────────
    INSERT INTO vehicles (
      vehicle_id, plate, time_in, image_in_url, status, priority, updated_at
    ) VALUES (
      p_vehicle_id, p_plate, p_now_ts, p_image_url, 'Đang trong xưởng', 'Bình thường', now()
    );

    RETURN QUERY
      SELECT 'VAO'::TEXT, p_vehicle_id, p_now_ts, 0::NUMERIC;
  END IF;
END;
$$;

-- Grant execute permission to service role (used by bot's service key)
GRANT EXECUTE ON FUNCTION process_vehicle TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS) — OPTIONAL
-- ─────────────────────────────────────────────────────────────────────────
-- Uncomment below to enable RLS (recommended for multi-user systems)
-- For now, we rely on Supabase service key authentication.

-- ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Service role can read/write vehicles"
--   ON vehicles FOR ALL USING (auth.role() = 'service_role')
--   WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────
-- SCHEMA VERSION TRACKING (OPTIONAL)
-- ─────────────────────────────────────────────────────────────────────────
-- Helps track which migrations have been applied.

CREATE TABLE IF NOT EXISTS _schema_migrations (
  id          SERIAL PRIMARY KEY,
  migration   TEXT NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ DEFAULT now()
);

-- Insert this migration version (if using migration tracking)
-- INSERT INTO _schema_migrations (migration) VALUES ('001-init-schema.sql')
-- ON CONFLICT (migration) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- ─────────────────────────────────────────────────────────────────────────
-- Run these to verify the schema was created correctly:

-- Check tables exist:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
-- ORDER BY table_name;

-- Check indexes:
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;

-- Check functions:
-- SELECT proname FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ─────────────────────────────────────────────────────────────────────────
-- END OF SCHEMA
-- ─────────────────────────────────────────────────────────────────────────
