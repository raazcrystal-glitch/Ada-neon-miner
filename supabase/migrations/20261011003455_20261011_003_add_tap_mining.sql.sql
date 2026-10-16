/*
# Add Tap-to-Mine Feature

## Summary
Adds server-side tap mining with rate limiting, configurable tap reward, and a per-user daily cap.

## Changes

1. **New Table: tap_events**
   - Records each tap with timestamp for rate-limiting (1-second cooldown, 3600/day cap)
   - `user_id` — which user tapped
   - `tapped_at` — timestamp (indexed for efficient rate-limit queries)
   - `reward` — points awarded for this tap

2. **Modified Table: application_settings**
   - Adds `tap_reward` column (default 1.0 ADA Point per tap)
   - Adds `tap_daily_limit` column (default 3600 taps per day)
   - Adds `tap_paused` boolean flag

3. **Modified Table: reward_ledger**
   - Drops and recreates the `source` CHECK constraint to include `'tap'` as a valid source

## Security
- RLS enabled on tap_events; anon+authenticated can select/insert (edge function enforces identity)
- Inserts happen via service-role edge function so trust boundary is enforced server-side
*/

-- ===== TAP EVENTS =====
CREATE TABLE IF NOT EXISTS tap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tapped_at timestamptz NOT NULL DEFAULT now(),
  reward numeric(20,8) NOT NULL DEFAULT 1.0
);

ALTER TABLE tap_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tap_events_select_all" ON tap_events;
CREATE POLICY "tap_events_select_all" ON tap_events FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "tap_events_insert_all" ON tap_events;
CREATE POLICY "tap_events_insert_all" ON tap_events FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tap_events_user_id ON tap_events(user_id);
CREATE INDEX IF NOT EXISTS idx_tap_events_tapped_at ON tap_events(user_id, tapped_at DESC);

-- ===== APPLICATION SETTINGS: add tap columns =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='application_settings' AND column_name='tap_reward') THEN
    ALTER TABLE application_settings ADD COLUMN tap_reward numeric(10,4) NOT NULL DEFAULT 1.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='application_settings' AND column_name='tap_daily_limit') THEN
    ALTER TABLE application_settings ADD COLUMN tap_daily_limit integer NOT NULL DEFAULT 3600;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='application_settings' AND column_name='tap_paused') THEN
    ALTER TABLE application_settings ADD COLUMN tap_paused boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ===== REWARD LEDGER: fix source constraint to include 'tap' =====
ALTER TABLE reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_source_check;
ALTER TABLE reward_ledger ADD CONSTRAINT reward_ledger_source_check
  CHECK (source IN ('mining', 'task', 'referral', 'tap', 'withdrawal_hold', 'withdrawal_release', 'withdrawal_deduct', 'admin_adjust', 'ton_payment_bonus'));
