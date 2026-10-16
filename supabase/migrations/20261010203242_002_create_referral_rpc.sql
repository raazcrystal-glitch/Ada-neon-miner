/*
# Create increment_referral_count RPC

Adds a SECURITY DEFINER function to atomically increment a referrer's total_referrals counter.
This avoids race conditions when multiple referrals happen concurrently.
*/

CREATE OR REPLACE FUNCTION increment_referral_count(ref_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE users SET
    total_referrals = total_referrals + 1,
    updated_at = now()
  WHERE id = ref_id;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_referral_count TO anon, authenticated;
