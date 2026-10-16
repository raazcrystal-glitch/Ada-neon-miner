/*
# Daily check-in + leaderboard support

Preserves existing tables. Adds:
1. daily_checkins — one row per user per UTC day
2. application_settings.checkin_reward
3. reward_ledger source 'checkin'
*/

CREATE TABLE IF NOT EXISTS daily_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date date NOT NULL DEFAULT (timezone('utc', now()))::date,
  reward numeric(20,8) NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checkin_date)
);

ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_checkins_select_all" ON daily_checkins;
CREATE POLICY "daily_checkins_select_all" ON daily_checkins FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "daily_checkins_insert_all" ON daily_checkins;
CREATE POLICY "daily_checkins_insert_all" ON daily_checkins FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_user ON daily_checkins(user_id, checkin_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'application_settings' AND column_name = 'checkin_reward'
  ) THEN
    ALTER TABLE application_settings ADD COLUMN checkin_reward numeric(10,4) NOT NULL DEFAULT 2.0;
  END IF;
END $$;

ALTER TABLE reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_source_check;
ALTER TABLE reward_ledger ADD CONSTRAINT reward_ledger_source_check
  CHECK (source IN (
    'mining', 'task', 'referral', 'tap', 'checkin',
    'withdrawal_hold', 'withdrawal_release', 'withdrawal_deduct',
    'admin_adjust', 'ton_payment_bonus'
  ));
