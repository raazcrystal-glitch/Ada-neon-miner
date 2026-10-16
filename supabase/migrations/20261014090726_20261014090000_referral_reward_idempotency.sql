/*
# Make referral rewards single-use

1. Purpose
- Prevent a retry, refresh, or concurrent request from crediting the same referral reward more than once.

2. Modified objects
- Adds a unique partial index on `reward_ledger` for referral rewards keyed by the referrer and referral record.
- Existing rows are preserved; a diagnostic check confirmed no duplicate referral ledger rows currently exist.

3. Security and integrity
- Referral reward identity is enforced by the database instead of only by application checks.
- No user-facing permissions or existing data are removed.

4. Notes
- The edge function treats a duplicate ledger insert as already rewarded.
- Other ledger sources are unchanged.
*/

CREATE UNIQUE INDEX IF NOT EXISTS reward_ledger_referral_once_idx
  ON reward_ledger (user_id, source, reference_id)
  WHERE source = 'referral' AND reference_id IS NOT NULL;
