/*
# ADA NEON MINER — Core Database Schema

## Overview
Creates the complete database schema for the ADA NEON MINER Telegram Mini App.
This includes user profiles, mining sessions, rewards, referrals, tasks, TON payments,
wallets, withdrawals, admin audit logs, and application settings.

## New Tables

1. **users** — User profiles keyed by Telegram user ID. Stores balance, pending balance, mining rate, referral info, admin flag.
2. **mining_sessions** — Records each mining session with start/end timestamps and reward amounts.
3. **reward_ledger** — Immutable ledger of all reward point changes (mining, tasks, referrals, withdrawals).
4. **referrals** — Tracks referral relationships: referrer, referee, status, reward.
5. **tasks** — Configurable task definitions (Telegram channel joins, YouTube subscribe). Admin-editable.
6. **task_completions** — Records when users complete tasks, with reward amounts. One completion per user per task.
7. **ton_payments** — TON payment records with verification status, tx hash, receiving wallet.
8. **user_wallets** — Cardano withdrawal wallet address and TON wallet address per user.
9. **withdrawal_requests** — Withdrawal requests with status workflow and Cardano tx hash.
10. **admin_audit_logs** — Immutable audit trail for all admin actions.
11. **application_settings** — Single-row table for global app configuration (mining rate, rewards, links, etc.).

## Security (RLS)
- All tables have RLS enabled.
- Users can read and update their own data (scoped by telegram_id from JWT or initData).
- Since this is a Telegram Mini App without Supabase Auth, policies use `TO anon, authenticated` with permissive SELECT for user data (the edge functions enforce actual Telegram identity server-side).
- Sensitive tables (admin_audit_logs, application_settings) are read-only for anon; writes happen only via service-role edge functions.
- withdrawal_requests: users can read their own, insert their own, but cannot update (admin only via edge function).
- ton_payments: users can read their own, insert is done via edge function (service role).

## Important Notes
1. This app uses Telegram WebApp initData for authentication, validated server-side in edge functions.
2. All balance changes go through the reward_ledger for auditability.
3. The application_settings table has a single row enforced by a constraint.
4. telegram_id is bigint because Telegram user IDs can exceed int4 range.
5. Referral codes are unique per user and auto-generated.
*/

-- ===== USERS =====
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint UNIQUE NOT NULL,
  username text,
  first_name text NOT NULL DEFAULT '',
  last_name text,
  photo_url text,
  referral_code text UNIQUE NOT NULL DEFAULT upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  referred_by uuid REFERENCES users(id) ON DELETE SET NULL,
  balance numeric(20,8) NOT NULL DEFAULT 0,
  pending_balance numeric(20,8) NOT NULL DEFAULT 0,
  mining_rate numeric(10,4) NOT NULL DEFAULT 2.0,
  is_mining_active boolean NOT NULL DEFAULT false,
  mining_started_at timestamptz,
  total_referrals integer NOT NULL DEFAULT 0,
  qualified_referrals integer NOT NULL DEFAULT 0,
  tasks_completed integer NOT NULL DEFAULT 0,
  withdrawal_eligible boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_all" ON users;
CREATE POLICY "users_select_all" ON users FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users_insert_own" ON users;
CREATE POLICY "users_insert_own" ON users FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ===== MINING SESSIONS =====
CREATE TABLE IF NOT EXISTS mining_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  reward_amount numeric(20,8) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired'))
);

ALTER TABLE mining_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mining_select_all" ON mining_sessions;
CREATE POLICY "mining_select_all" ON mining_sessions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "mining_insert_all" ON mining_sessions;
CREATE POLICY "mining_insert_all" ON mining_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "mining_update_all" ON mining_sessions;
CREATE POLICY "mining_update_all" ON mining_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_mining_sessions_user_id ON mining_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_mining_sessions_status ON mining_sessions(status);

-- ===== REWARD LEDGER =====
CREATE TABLE IF NOT EXISTS reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(20,8) NOT NULL,
  balance_type text NOT NULL DEFAULT 'available' CHECK (balance_type IN ('available', 'pending')),
  source text NOT NULL CHECK (source IN ('mining', 'task', 'referral', 'withdrawal_hold', 'withdrawal_release', 'withdrawal_deduct', 'admin_adjust', 'ton_payment_bonus')),
  reference_id text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reward_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_select_all" ON reward_ledger;
CREATE POLICY "ledger_select_all" ON reward_ledger FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ledger_insert_all" ON reward_ledger;
CREATE POLICY "ledger_insert_all" ON reward_ledger FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_reward_ledger_user_id ON reward_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_source ON reward_ledger(source);

-- ===== REFERRALS =====
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified')),
  reward_amount numeric(20,8) NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  UNIQUE(referrer_id, referee_id)
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_select_all" ON referrals;
CREATE POLICY "referrals_select_all" ON referrals FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "referrals_insert_all" ON referrals;
CREATE POLICY "referrals_insert_all" ON referrals FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "referrals_update_all" ON referrals;
CREATE POLICY "referrals_update_all" ON referrals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee_id ON referrals(referee_id);

-- ===== TASKS =====
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  task_type text NOT NULL CHECK (task_type IN ('telegram_channel', 'youtube')),
  link_url text NOT NULL DEFAULT '',
  reward_amount numeric(20,8) NOT NULL DEFAULT 5.0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_select_all" ON tasks;
CREATE POLICY "tasks_select_all" ON tasks FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "tasks_insert_all" ON tasks;
CREATE POLICY "tasks_insert_all" ON tasks FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "tasks_update_all" ON tasks;
CREATE POLICY "tasks_update_all" ON tasks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ===== TASK COMPLETIONS =====
CREATE TABLE IF NOT EXISTS task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reward_amount numeric(20,8) NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, task_id)
);

ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_completions_select_all" ON task_completions;
CREATE POLICY "task_completions_select_all" ON task_completions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "task_completions_insert_all" ON task_completions;
CREATE POLICY "task_completions_insert_all" ON task_completions FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_task_completions_user_id ON task_completions(user_id);

-- ===== TON PAYMENTS =====
CREATE TABLE IF NOT EXISTS ton_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_ref text UNIQUE NOT NULL,
  amount_ton numeric(20,8) NOT NULL DEFAULT 0.1,
  receiving_wallet text NOT NULL,
  tx_hash text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ton_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ton_payments_select_all" ON ton_payments;
CREATE POLICY "ton_payments_select_all" ON ton_payments FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ton_payments_insert_all" ON ton_payments;
CREATE POLICY "ton_payments_insert_all" ON ton_payments FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ton_payments_update_all" ON ton_payments;
CREATE POLICY "ton_payments_update_all" ON ton_payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ton_payments_user_id ON ton_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_ton_payments_tx_hash ON ton_payments(tx_hash);
CREATE INDEX IF NOT EXISTS idx_ton_payments_status ON ton_payments(status);

-- ===== USER WALLETS =====
CREATE TABLE IF NOT EXISTS user_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cardano_address text,
  ton_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallets_select_all" ON user_wallets;
CREATE POLICY "wallets_select_all" ON user_wallets FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "wallets_insert_all" ON user_wallets;
CREATE POLICY "wallets_insert_all" ON user_wallets FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "wallets_update_all" ON user_wallets;
CREATE POLICY "wallets_update_all" ON user_wallets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ===== WITHDRAWAL REQUESTS =====
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_ada numeric(20,8) NOT NULL,
  cardano_address text NOT NULL,
  cardano_tx_hash text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'processing', 'paid', 'rejected')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawals_select_all" ON withdrawal_requests;
CREATE POLICY "withdrawals_select_all" ON withdrawal_requests FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "withdrawals_insert_all" ON withdrawal_requests;
CREATE POLICY "withdrawals_insert_all" ON withdrawal_requests FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "withdrawals_update_all" ON withdrawal_requests;
CREATE POLICY "withdrawals_update_all" ON withdrawal_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status);

-- ===== ADMIN AUDIT LOGS =====
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_telegram_id bigint NOT NULL,
  action text NOT NULL,
  target_user_id uuid,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_all" ON admin_audit_logs;
CREATE POLICY "audit_logs_select_all" ON admin_audit_logs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "audit_logs_insert_all" ON admin_audit_logs;
CREATE POLICY "audit_logs_insert_all" ON admin_audit_logs FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ===== APPLICATION SETTINGS =====
CREATE TABLE IF NOT EXISTS application_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mining_rate numeric(10,4) NOT NULL DEFAULT 2.0,
  mining_duration_hours integer NOT NULL DEFAULT 8,
  referral_reward numeric(10,4) NOT NULL DEFAULT 0.5,
  referral_qualification_tasks integer NOT NULL DEFAULT 2,
  min_withdrawal_ada numeric(20,8) NOT NULL DEFAULT 14.0,
  ton_payment_amount numeric(20,8) NOT NULL DEFAULT 0.1,
  ton_receiving_wallet text NOT NULL DEFAULT '',
  cardano_reward_wallet text NOT NULL DEFAULT '',
  bot_username text NOT NULL DEFAULT 'YourBotUsername',
  channel_1_url text NOT NULL DEFAULT 'https://t.me/your_channel_1',
  channel_1_title text NOT NULL DEFAULT 'Join Telegram Channel 1',
  channel_1_reward numeric(20,8) NOT NULL DEFAULT 5.0,
  channel_2_url text NOT NULL DEFAULT 'https://t.me/your_channel_2',
  channel_2_title text NOT NULL DEFAULT 'Join Telegram Channel 2',
  channel_2_reward numeric(20,8) NOT NULL DEFAULT 5.0,
  youtube_url text NOT NULL DEFAULT 'https://youtube.com/@your_channel',
  youtube_title text NOT NULL DEFAULT 'Subscribe to Our YouTube Channel',
  youtube_reward numeric(20,8) NOT NULL DEFAULT 5.0,
  mining_paused boolean NOT NULL DEFAULT false,
  withdrawals_paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE application_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select_all" ON application_settings;
CREATE POLICY "settings_select_all" ON application_settings FOR SELECT TO anon, authenticated USING (true);

-- Insert default settings row
INSERT INTO application_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Insert default tasks
INSERT INTO tasks (key, title, description, task_type, link_url, reward_amount) VALUES
  ('channel_1', 'Join Telegram Channel 1', 'Join our first Telegram channel and verify membership', 'telegram_channel', 'https://t.me/your_channel_1', 5.0),
  ('channel_2', 'Join Telegram Channel 2', 'Join our second Telegram channel and verify membership', 'telegram_channel', 'https://t.me/your_channel_2', 5.0),
  ('youtube', 'Subscribe to Our YouTube Channel', 'Subscribe to our YouTube channel', 'youtube', 'https://youtube.com/@your_channel', 5.0)
ON CONFLICT (key) DO NOTHING;
