export interface UserProfile {
  id: string
  telegram_id: number
  username: string | null
  first_name: string
  last_name: string | null
  photo_url: string | null
  referral_code: string
  referred_by: string | null
  balance: number
  pending_balance: number
  mining_rate: number
  is_mining_active: boolean
  mining_started_at: string | null
  total_referrals: number
  qualified_referrals: number
  tasks_completed: number
  withdrawal_eligible: boolean
  is_admin: boolean
  created_at: string
}

export interface MiningSession {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  reward_amount: number
  status: 'active' | 'completed' | 'expired'
}

export interface TaskItem {
  id: string
  key: string
  title: string
  description: string
  task_type: 'telegram_channel' | 'youtube'
  link_url: string
  reward_amount: number
  is_active: boolean
  completed: boolean
  completed_at: string | null
}

export interface TaskCompletion {
  id: string
  user_id: string
  task_id: string
  reward_amount: number
  completed_at: string
}

export interface ReferralInfo {
  id: string
  referee_id: string
  referee_name: string
  referee_username: string | null
  status: 'pending' | 'qualified'
  reward_amount: number
  created_at: string
  tasks_completed: number
}

export interface TonPayment {
  id: string
  user_id: string
  payment_ref: string
  amount_ton: number
  receiving_wallet: string
  tx_hash: string | null
  status: 'pending' | 'verified' | 'rejected'
  verified_at: string | null
  created_at: string
}

export interface UserWallet {
  id: string
  user_id: string
  cardano_address: string | null
  ton_address: string | null
  updated_at: string
}

export interface WithdrawalRequest {
  id: string
  user_id: string
  amount_ada: number
  cardano_address: string
  cardano_tx_hash: string | null
  status: 'pending' | 'under_review' | 'approved' | 'processing' | 'paid' | 'rejected'
  admin_note: string | null
  created_at: string
  processed_at: string | null
}

export interface AppSettings {
  mining_rate: number
  mining_duration_hours: number
  referral_reward: number
  referral_qualification_tasks: number
  min_withdrawal_ada: number
  ton_payment_amount: number
  ton_receiving_wallet: string
  cardano_reward_wallet: string
  bot_username: string
  channel_1_url: string
  channel_1_title: string
  channel_1_reward: number
  channel_2_url: string
  channel_2_title: string
  channel_2_reward: number
  youtube_url: string
  youtube_title: string
  youtube_reward: number
  mining_paused: boolean
  withdrawals_paused: boolean
  tap_reward: number
  tap_daily_limit: number
  tap_paused: boolean
  youtube_channel_id: string
  checkin_reward: number
}

export interface AdminUser {
  id: string
  telegram_id: number
  username: string
  first_name: string
  balance: number
  total_referrals: number
  tasks_completed: number
  withdrawal_eligible: boolean
  created_at: string
}

export interface AdminWithdrawal {
  id: string
  user_id: string
  telegram_id: number
  username: string
  amount_ada: number
  cardano_address: string
  cardano_tx_hash: string | null
  status: string
  admin_note: string | null
  created_at: string
  processed_at: string | null
}

export interface AdminAuditLog {
  id: string
  admin_telegram_id: number
  action: string
  target_user_id: string | null
  details: string | null
  created_at: string
}
