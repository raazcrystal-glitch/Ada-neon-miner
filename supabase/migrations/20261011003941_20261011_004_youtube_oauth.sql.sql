/*
# YouTube OAuth State and Channel Configuration

## Summary
Adds server-side OAuth state tracking for Google/YouTube subscription verification,
and a configurable YouTube channel ID to application settings.

## Changes

1. **New Table: youtube_oauth_states**
   - Stores short-lived PKCE-style OAuth state tokens (expire in 10 minutes)
   - `user_id` — which app user initiated the OAuth flow
   - `state_token` — random UUID used as the OAuth `state` parameter to prevent CSRF
   - `task_id` — which YouTube task this flow is for
   - `expires_at` — auto-expires; states older than this are invalid
   - `used` — single-use flag; once consumed the row cannot be reused
   - `created_at` — audit timestamp

2. **Modified Table: application_settings**
   - Adds `youtube_channel_id` (text, default empty) — the YouTube channel ID (e.g. UCxxxxxx)
     that users must be subscribed to. Admin-configurable.

## Security
- RLS enabled; anon+authenticated can select/insert (edge function enforces real identity)
- State tokens are single-use and expire after 10 minutes
- The OAuth callback validates state, expiry, and used flag before proceeding
*/

-- ===== YOUTUBE OAUTH STATES =====
CREATE TABLE IF NOT EXISTS youtube_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE youtube_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "yt_states_select" ON youtube_oauth_states;
CREATE POLICY "yt_states_select" ON youtube_oauth_states FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "yt_states_insert" ON youtube_oauth_states;
CREATE POLICY "yt_states_insert" ON youtube_oauth_states FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "yt_states_update" ON youtube_oauth_states;
CREATE POLICY "yt_states_update" ON youtube_oauth_states FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_yt_states_token ON youtube_oauth_states(state_token);
CREATE INDEX IF NOT EXISTS idx_yt_states_user_task ON youtube_oauth_states(user_id, task_id);

-- ===== APPLICATION SETTINGS: add youtube_channel_id =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='application_settings' AND column_name='youtube_channel_id'
  ) THEN
    ALTER TABLE application_settings ADD COLUMN youtube_channel_id text NOT NULL DEFAULT '';
  END IF;
END $$;
