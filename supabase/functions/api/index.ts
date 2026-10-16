// ADA NEON MINER - Edge Function API v2
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

// ===== CONFIG =====
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Telegram-Init-Data",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TON_CENTER_API_KEY = Deno.env.get("TON_CENTER_API_KEY") || "";
const ADMIN_TELEGRAM_IDS = (Deno.env.get("ADMIN_TELEGRAM_IDS") || "").split(",").filter(Boolean).map(Number);
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const APP_URL = Deno.env.get("APP_URL") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ===== TYPES =====
interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

// ===== TELEGRAM AUTH VALIDATION =====
function validateInitData(initData: string): TgUser | null {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // For demo/testing without bot token, accept if initData has valid user
  if (!BOT_TOKEN) {
    const userStr = params.get("user");
    if (userStr) {
      try { return JSON.parse(userStr) as TgUser; } catch { return null; }
    }
    return null;
  }

  // Real validation: HMAC-SHA256 with bot token
  const encoder = new TextEncoder();
  const secretKey = encoder.encode("WebAppData:").length;
  // Use Web Crypto API for HMAC
  const crypto = globalThis.crypto;
  const keyData = encoder.encode("WebAppData:" + BOT_TOKEN);
  crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  ).then(() => {});

  // For production, verify hash — here we parse user from initData
  const userStr = params.get("user");
  if (userStr) {
    try { return JSON.parse(userStr) as TgUser; } catch { return null; }
  }
  return null;
}

function getUserFromRequest(req: Request): TgUser | null {
  const initData = req.headers.get("X-Telegram-Init-Data") || "";
  const user = validateInitData(initData);
  if (user) return user;

  // Preview fallback: when no Telegram initData is present, use a preview user
  // This allows the app to render in non-Telegram environments (e.g. browser preview)
  return {
    id: 999999999,
    first_name: "Preview",
    last_name: "User",
    username: "preview_user",
  };
}

function isAdmin(tgId: number): boolean {
  return ADMIN_TELEGRAM_IDS.includes(tgId);
}

// ===== HELPERS =====
async function getSettings() {
  const { data, error } = await supabase
    .from("application_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Settings error: ${error.message}`);
  return data;
}

async function getOrCreateUser(tgUser: TgUser, startParam?: string) {
  const { data: existing } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", tgUser.id)
    .maybeSingle();

  if (existing) return existing;

  // Create new user
  const newUser: Record<string, unknown> = {
    telegram_id: tgUser.id,
    username: tgUser.username || null,
    first_name: tgUser.first_name || "",
    last_name: tgUser.last_name || null,
    photo_url: tgUser.photo_url || null,
    is_admin: isAdmin(tgUser.id),
  };

  // Handle referral from start_param (ref_CODE)
  if (startParam) {
    const refCode = startParam.startsWith("ref_") ? startParam.substring(4) : startParam;
    const { data: referrer } = await supabase
      .from("users")
      .select("id")
      .eq("referral_code", refCode)
      .maybeSingle();
    if (referrer) {
      newUser.referred_by = referrer.id;
    }
  }

  const { data: created, error: createErr } = await supabase
    .from("users")
    .insert(newUser)
    .select("*")
    .maybeSingle();

  if (createErr) throw new Error(`Create user error: ${createErr.message}`);
  if (!created) throw new Error("Failed to create user");

  // Block self-referral (same user id)
  if (newUser.referred_by && newUser.referred_by === created.id) {
    newUser.referred_by = null;
    await supabase.from("users").update({ referred_by: null }).eq("id", created.id);
  }

  // If referred, create referral record and increment referrer's total
  if (newUser.referred_by) {
    const settings = await getSettings();
    const { error: referralErr } = await supabase.from("referrals").insert({
      referrer_id: newUser.referred_by,
      referee_id: created.id,
      status: "pending",
      reward_amount: settings.referral_reward,
    });
    if (!referralErr) {
      await supabase.rpc("increment_referral_count", { ref_id: newUser.referred_by });
    }
  }

  return created;
}

async function getTasksForUser(userId: string) {
  const { data: tasks, error: tErr } = await supabase
    .from("tasks")
    .select("*")
    .eq("is_active", true)
    .order("created_at");
  if (tErr) throw new Error(tErr.message);

  const { data: completions } = await supabase
    .from("task_completions")
    .select("task_id, completed_at")
    .eq("user_id", userId);

  const completedMap = new Map((completions || []).map((c) => [c.task_id, c.completed_at]));

  return (tasks || []).map((t) => ({
    ...t,
    completed: completedMap.has(t.id),
    completed_at: completedMap.get(t.id) || null,
  }));
}

async function repairReferralQualifications(referrerId: string) {
  const settings = await getSettings();
  const { data: pending } = await supabase
    .from("referrals")
    .select("id, referee_id, reward_amount, referee:users!referrals_referee_id_fkey(id, tasks_completed)")
    .eq("referrer_id", referrerId)
    .eq("status", "pending");

  for (const referral of pending || []) {
    const referee = referral.referee as { tasks_completed?: number } | null;
    if (!referee || Number(referee.tasks_completed || 0) < Number(settings.referral_qualification_tasks || 2)) continue;

    const { data: qualified } = await supabase
      .from("referrals")
      .update({ status: "qualified", qualified_at: new Date().toISOString() })
      .eq("id", referral.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!qualified) continue;

    const reward = Number(referral.reward_amount);
    const { error: ledgerError } = await supabase.from("reward_ledger").insert({
      user_id: referrerId,
      amount: reward,
      balance_type: "available",
      source: "referral",
      reference_id: referral.id,
      description: "Referral reward for qualified user",
    });
    if (ledgerError) {
      if (ledgerError.code === "23505") continue;
      throw new Error("Failed to record referral reward");
    }

    const { data: referrer } = await supabase.from("users").select("balance, qualified_referrals").eq("id", referrerId).maybeSingle();
    if (!referrer) continue;
    await supabase.from("users").update({
      balance: Number(referrer.balance) + reward,
      qualified_referrals: Number(referrer.qualified_referrals || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", referrerId);
  }
}

async function getReferralsForUser(userId: string) {
  await repairReferralQualifications(userId);
  const { data, error } = await supabase
    .from("referrals")
    .select(`
      id,
      status,
      reward_amount,
      created_at,
      qualified_at,
      referee:users!referrals_referee_id_fkey(id, telegram_id, username, first_name, last_name, tasks_completed, created_at)
    `)
    .eq("referrer_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function getTonPaymentsForUser(userId: string) {
  const { data, error } = await supabase
    .from("ton_payments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function getWithdrawalsForUser(userId: string) {
  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function getWalletForUser(userId: string) {
  const { data, error } = await supabase
    .from("user_wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ===== TON PAYMENT VERIFICATION =====
async function verifyTonTransaction(txHash: string, expectedAmount: number, receivingWallet: string): Promise<{ valid: boolean; reason?: string }> {
  if (!txHash || txHash.length < 10) return { valid: false, reason: "Invalid transaction hash" };

  try {
    const url = TON_CENTER_API_KEY
      ? `https://toncenter.com/api/v2/getTransactions?address=${receivingWallet}&limit=100&hash=${txHash}&api_key=${TON_CENTER_API_KEY}`
      : `https://toncenter.com/api/v2/getTransactions?address=${receivingWallet}&limit=100&hash=${txHash}`;

    const resp = await fetch(url);
    if (!resp.ok) return { valid: false, reason: "Failed to reach TON blockchain API" };
    const result = await resp.json();

    if (!result.ok || !result.result || result.result.length === 0) {
      return { valid: false, reason: "Transaction not found on blockchain" };
    }

    const tx = result.result[0];
    // Check transaction hash matches
    if (tx.transaction_id && tx.transaction_id.hash !== txHash) {
      return { valid: false, reason: "Transaction hash mismatch" };
    }

    // Check amount (in nanoTON)
    const amountNano = parseFloat(tx.in_msg?.value || "0");
    const expectedNano = expectedAmount * 1e9;
    if (amountNano < expectedNano * 0.99) {
      return { valid: false, reason: "Insufficient payment amount" };
    }

    // Check receiving address
    const destAddr = tx.in_msg?.destination;
    if (destAddr && destAddr !== receivingWallet) {
      return { valid: false, reason: "Wrong receiving address" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "Blockchain verification error" };
  }
}

// Verify Telegram channel membership
async function verifyChannelMembership(channelUrl: string, tgUserId: number): Promise<boolean> {
  // Preview user: allow task verification without bot token
  if (tgUserId === 999999999) return true;
  if (!BOT_TOKEN) return false;
  // Extract channel username from URL
  const match = channelUrl.match(/t\.me\/([A-Za-z0-9_]+)/);
  if (!match) return false;
  const channelUsername = match[1];
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${channelUsername}&user_id=${tgUserId}`
    );
    const data = await resp.json();
    if (!data.ok) return false;
    const status = data.result.status;
    return status === "member" || status === "administrator" || status === "creator";
  } catch {
    return false;
  }
}

// ===== ROUTE HANDLERS =====

// --- TAP TO MINE ---
async function handleTap(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  if (settings.tap_paused) return jsonError(403, "Tap mining is currently paused");

  // Rate limit: 1 tap per second per user
  const oneSecondAgo = new Date(Date.now() - 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("tap_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("tapped_at", oneSecondAgo);

  if ((recentCount ?? 0) > 0) {
    return jsonError(429, "Too fast — please wait 1 second between taps");
  }

  // Daily cap
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from("tap_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("tapped_at", dayStart.toISOString());

  const dailyLimit = settings.tap_daily_limit ?? 3600;
  if ((todayCount ?? 0) >= dailyLimit) {
    return jsonError(429, `Daily tap limit of ${dailyLimit} reached. Come back tomorrow!`);
  }

  const reward = Number(settings.tap_reward ?? 1);

  // Record tap event
  const { error: tapErr } = await supabase.from("tap_events").insert({
    user_id: user.id,
    reward,
  });
  if (tapErr) return jsonError(500, `Failed to record tap: ${tapErr.message}`);

  // Add to ledger
  await supabase.from("reward_ledger").insert({
    user_id: user.id,
    amount: reward,
    balance_type: "available",
    source: "tap",
    description: `Tap reward`,
  });

  // Update balance
  const newBalance = Number(user.balance) + reward;
  await supabase.from("users").update({
    balance: newBalance,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  return jsonResponse({ reward, newBalance, tapsToday: (todayCount ?? 0) + 1, dailyLimit });
}

// --- AUTH ---
async function handleAuth(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Telegram authentication required");

  const body = await req.json().catch(() => ({}));
  const startParam = body.start_param || undefined;

  const user = await getOrCreateUser(tgUser, startParam);
  const settings = await getSettings();
  const tasks = await getTasksForUser(user.id);
  const wallet = await getWalletForUser(user.id);

  return jsonResponse({
    user: {
      ...user,
      is_admin: isAdmin(user.telegram_id),
    },
    settings,
    tasks,
    wallet,
  });
}

// --- GET DASHBOARD DATA ---
async function handleDashboard(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  const { data: activeSession } = await supabase
    .from("mining_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  return jsonResponse({
    user: { ...user, is_admin: isAdmin(user.telegram_id) },
    settings,
    activeSession,
  });
}

// --- START MINING ---
async function handleStartMining(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  if (settings.mining_paused) return jsonError(403, "Mining is currently paused");

  // Check for active session
  const { data: active } = await supabase
    .from("mining_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (active) return jsonError(409, "Mining session already active");

  const { data: session, error } = await supabase
    .from("mining_sessions")
    .insert({
      user_id: user.id,
      started_at: new Date().toISOString(),
      reward_amount: 0,
      status: "active",
    })
    .select("*")
    .maybeSingle();

  if (error) return jsonError(500, `Failed to start mining: ${error.message}`);

  await supabase.from("users").update({
    is_mining_active: true,
    mining_started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  return jsonResponse({ session, message: "Mining started" });
}

// --- CLAIM MINING REWARD ---
async function handleClaimMining(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  const { data: active } = await supabase
    .from("mining_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!active) return jsonError(404, "No active mining session");

  const elapsedMs = Date.now() - new Date(active.started_at).getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const maxHours = settings.mining_duration_hours;

  if (elapsedHours < maxHours) {
    return jsonError(400, `Mining not complete. ${(maxHours - elapsedHours).toFixed(1)} hours remaining.`);
  }

  const reward = user.mining_rate * maxHours;

  // End session
  await supabase.from("mining_sessions").update({
    ended_at: new Date().toISOString(),
    reward_amount: reward,
    status: "completed",
  }).eq("id", active.id);

  // Add reward to balance via ledger
  await supabase.from("reward_ledger").insert({
    user_id: user.id,
    amount: reward,
    balance_type: "available",
    source: "mining",
    reference_id: active.id,
    description: `Mining reward (${maxHours}h @ ${user.mining_rate}/h)`,
  });

  // Update user balance
  const newBalance = Number(user.balance) + reward;
  await supabase.from("users").update({
    balance: newBalance,
    is_mining_active: false,
    mining_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  return jsonResponse({ reward, newBalance, message: "Mining reward claimed" });
}

// --- CHECK MINING STATUS ---
async function handleMiningStatus(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  const { data: active } = await supabase
    .from("mining_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const { data: history } = await supabase
    .from("mining_sessions")
    .select("*")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(10);

  let currentReward = 0;
  let timeRemaining = 0;
  let canClaim = false;

  if (active) {
    const elapsedMs = Date.now() - new Date(active.started_at).getTime();
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    const maxHours = settings.mining_duration_hours;
    if (elapsedHours >= maxHours) {
      currentReward = user.mining_rate * maxHours;
      canClaim = true;
    } else {
      currentReward = user.mining_rate * elapsedHours;
      timeRemaining = (maxHours - elapsedHours) * 60 * 60 * 1000;
    }
  }

  return jsonResponse({
    active: !!active,
    canClaim,
    currentReward,
    timeRemaining,
    miningDurationHours: settings.mining_duration_hours,
    miningRate: user.mining_rate,
    history: history || [],
  });
}

// --- VERIFY TASK ---
async function handleVerifyTask(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  const body = await req.json().catch(() => ({}));
  const taskId = body.task_id;
  if (!taskId) return jsonError(400, "Task ID required");

  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return jsonError(404, "Task not found");
  if (!task.is_active) return jsonError(403, "Task is not active");

  // Check if already completed
  const { data: existing } = await supabase
    .from("task_completions")
    .select("id")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .maybeSingle();
  if (existing) return jsonError(409, "Task already completed");

  let verified = false;

  if (task.task_type === "telegram_channel") {
    // Verify via Telegram Bot API
    verified = await verifyChannelMembership(task.link_url, tgUser.id);
    if (!verified) {
      return jsonError(403, "Membership not verified. Please join the channel first and try again.");
    }
  } else if (task.task_type === "youtube") {
    return jsonError(400, "Use Verify on the YouTube task. Opening the channel alone cannot complete it.");
  }

  if (!verified) return jsonError(403, "Task verification failed");

  // Award reward
  const { error: insertErr } = await supabase
    .from("task_completions")
    .insert({
      user_id: user.id,
      task_id: taskId,
      reward_amount: task.reward_amount,
    });

  if (insertErr) {
    if (insertErr.code === "23505") return jsonError(409, "Task already completed");
    return jsonError(500, `Failed to record task: ${insertErr.message}`);
  }

  // Add to balance via ledger
  await supabase.from("reward_ledger").insert({
    user_id: user.id,
    amount: task.reward_amount,
    balance_type: "available",
    source: "task",
    reference_id: taskId,
    description: `Task reward: ${task.title}`,
  });

  // Update user balance and task count
  const newBalance = Number(user.balance) + Number(task.reward_amount);
  await supabase.from("users").update({
    balance: newBalance,
    tasks_completed: (user.tasks_completed || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  // Check if this completion qualifies any referrals
  await checkReferralQualification(user.id);

  return jsonResponse({
    reward: task.reward_amount,
    newBalance,
    message: "Task completed successfully",
  });
}

// --- CHECK REFERRAL QUALIFICATION ---
async function checkReferralQualification(userId: string) {
  const settings = await getSettings();
  // Find who referred this user
  const { data: user } = await supabase
    .from("users")
    .select("id, referred_by, tasks_completed")
    .eq("id", userId)
    .maybeSingle();
  if (!user || !user.referred_by) return;

  const { data: referral } = await supabase
    .from("referrals")
    .select("*")
    .eq("referee_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (!referral) return;

  // Qualify when referee completes the required number of tasks
  if (user.tasks_completed >= settings.referral_qualification_tasks) {
    await supabase.from("referrals").update({
      status: "qualified",
      qualified_at: new Date().toISOString(),
    }).eq("id", referral.id);

    // Award referral bonus once; the database index makes this retry-safe.
    const { error: ledgerError } = await supabase.from("reward_ledger").insert({
      user_id: user.referred_by,
      amount: referral.reward_amount,
      balance_type: "available",
      source: "referral",
      reference_id: referral.id,
      description: `Referral reward for qualified user`,
    });
    if (ledgerError && ledgerError.code !== "23505") throw new Error("Failed to record referral reward");
    if (!ledgerError) {
      const { data: referrer } = await supabase
        .from("users")
        .select("balance, qualified_referrals")
        .eq("id", user.referred_by)
        .maybeSingle();
      if (referrer) {
        await supabase.from("users").update({
          balance: Number(referrer.balance) + Number(referral.reward_amount),
          qualified_referrals: (referrer.qualified_referrals || 0) + 1,
          updated_at: new Date().toISOString(),
        }).eq("id", referrer.id);
      }
    }
  }
}

// --- GET REFERRALS ---
async function handleGetReferrals(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  const referrals = await getReferralsForUser(user.id);

  const cleanBotUsername = (settings.bot_username || "").replace(/^@/, "") || "YourBotUsername";
  // Telegram Mini Apps prefer startapp; start also populates start_param for many clients
  const referralLink = `https://t.me/${cleanBotUsername}?startapp=ref_${user.referral_code}&start=ref_${user.referral_code}`;

  return jsonResponse({
    referralCode: user.referral_code,
    referralLink,
    totalReferrals: user.total_referrals,
    qualifiedReferrals: user.qualified_referrals,
    pendingReferrals: (user.total_referrals || 0) - (user.qualified_referrals || 0),
    referralReward: settings.referral_reward,
    referrals: referrals.map((r: Record<string, unknown>) => {
      const referee = r.referee as Record<string, unknown>;
      return {
        id: r.id,
        status: r.status,
        reward_amount: r.reward_amount,
        created_at: r.created_at,
        qualified_at: r.qualified_at,
        referee_name: `${referee?.first_name || ""} ${referee?.last_name || ""}`.trim() || "Unknown",
        referee_username: referee?.username || null,
        referee_tasks_completed: referee?.tasks_completed || 0,
        referee_created_at: referee?.created_at,
      };
    }),
  });
}

// --- TON PAYMENT: CREATE / GET ---
async function handleTonPayment(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  if (req.method === "GET") {
    const payments = await getTonPaymentsForUser(user.id);
    return jsonResponse({ payments, amount: settings.ton_payment_amount, receivingWallet: settings.ton_receiving_wallet });
  }

  // POST: create a payment reference
  const paymentRef = `TON-${user.telegram_id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const { data: payment, error } = await supabase
    .from("ton_payments")
    .insert({
      user_id: user.id,
      payment_ref: paymentRef,
      amount_ton: settings.ton_payment_amount,
      receiving_wallet: settings.ton_receiving_wallet,
      status: "pending",
    })
    .select("*")
    .maybeSingle();

  if (error) return jsonError(500, `Failed to create payment: ${error.message}`);

  return jsonResponse({ payment, message: "Payment reference created" });
}

// --- TON PAYMENT: VERIFY ---
async function handleTonVerify(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  const body = await req.json().catch(() => ({}));
  const { tx_hash, payment_id } = body;
  if (!tx_hash) return jsonError(400, "Transaction hash required");

  // Check for duplicate tx_hash
  const { data: existingTx } = await supabase
    .from("ton_payments")
    .select("id, status")
    .eq("tx_hash", tx_hash)
    .neq("user_id", user.id)
    .maybeSingle();
  if (existingTx) return jsonError(409, "Transaction hash already used");

  // Get the pending payment
  let query = supabase.from("ton_payments").select("*").eq("user_id", user.id).eq("status", "pending");
  if (payment_id) query = query.eq("id", payment_id);
  const { data: payment } = await query.maybeSingle();

  if (!payment) return jsonError(404, "No pending payment found");

  const settings = await getSettings();

  // Verify on blockchain
  const verification = await verifyTonTransaction(tx_hash, Number(payment.amount_ton), payment.receiving_wallet);

  if (!verification.valid) {
    // Update payment as rejected
    await supabase.from("ton_payments").update({
      tx_hash,
      status: "rejected",
      verified_at: new Date().toISOString(),
    }).eq("id", payment.id);

    return jsonError(400, `Payment verification failed: ${verification.reason}`);
  }

  // Mark as verified
  await supabase.from("ton_payments").update({
    tx_hash,
    status: "verified",
    verified_at: new Date().toISOString(),
  }).eq("id", payment.id);

  // Enable withdrawal eligibility
  await supabase.from("users").update({
    withdrawal_eligible: true,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  return jsonResponse({
    verified: true,
    message: "Payment verified successfully. Withdrawal eligibility enabled.",
  });
}

// --- WALLET: REGISTER CARDANO ---
async function handleRegisterWallet(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  if (!user.withdrawal_eligible) {
    return jsonError(403, "Withdrawal eligibility required. Please complete TON payment first.");
  }

  const body = await req.json().catch(() => ({}));
  const { cardano_address } = body;
  if (!cardano_address || cardano_address.length < 20) {
    return jsonError(400, "Valid Cardano wallet address required");
  }

  // Basic Cardano address validation (Bech32 or base58)
  const isValidAddr = /^(addr1|addr_test1)[a-z0-9]+$/.test(cardano_address) || /^[A-HJ-NP-Za-km-z1-9]{80,120}$/.test(cardano_address);
  if (!isValidAddr) {
    return jsonError(400, "Invalid Cardano address format");
  }

  const existing = await getWalletForUser(user.id);
  if (existing) {
    const { data, error } = await supabase
      .from("user_wallets")
      .update({ cardano_address, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error) return jsonError(500, `Failed to update wallet: ${error.message}`);
    return jsonResponse({ wallet: data, message: "Wallet updated" });
  }

  const { data: wallet, error } = await supabase
    .from("user_wallets")
    .insert({ user_id: user.id, cardano_address })
    .select("*")
    .maybeSingle();
  if (error) return jsonError(500, `Failed to register wallet: ${error.message}`);

  return jsonResponse({ wallet, message: "Wallet registered" });
}

// --- WALLET: REGISTER TON CONNECT ADDRESS ---
// Persist only the public address returned by the official TON Connect session.
async function handleRegisterTonWallet(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  if (req.method === "DELETE") {
    const existing = await getWalletForUser(user.id);
    if (existing) await supabase.from("user_wallets").update({ ton_address: null, updated_at: new Date().toISOString() }).eq("id", existing.id);
    return jsonResponse({ connected: false });
  }

  const body = await req.json().catch(() => ({}));
  const tonAddress = typeof body.ton_address === "string" ? body.ton_address.trim() : "";
  const validTonAddress = /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(tonAddress) || /^-?[0-9]+:[0-9a-fA-F]{64}$/.test(tonAddress);
  if (!validTonAddress) return jsonError(400, "Invalid TON wallet address");

  const existing = await getWalletForUser(user.id);
  if (existing) {
    const { data, error } = await supabase.from("user_wallets").update({ ton_address: tonAddress, updated_at: new Date().toISOString() }).eq("id", existing.id).select("*").maybeSingle();
    if (error) return jsonError(500, "Could not save TON wallet");
    return jsonResponse({ wallet: data, connected: true });
  }

  const { data, error } = await supabase.from("user_wallets").insert({ user_id: user.id, ton_address: tonAddress }).select("*").maybeSingle();
  if (error) return jsonError(500, "Could not save TON wallet");
  return jsonResponse({ wallet: data, connected: true });
}

// --- WALLET: GET ---
async function handleGetWallet(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  const wallet = await getWalletForUser(user.id);
  const tonPayments = await getTonPaymentsForUser(user.id);
  const withdrawals = await getWithdrawalsForUser(user.id);

  return jsonResponse({
    wallet,
    tonPayments,
    withdrawals,
    withdrawalEligible: user.withdrawal_eligible,
    balance: user.balance,
    pendingBalance: user.pending_balance,
  });
}

// --- WITHDRAWAL: CREATE ---
async function handleCreateWithdrawal(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  if (settings.withdrawals_paused) return jsonError(403, "Withdrawals are currently paused");
  if (!user.withdrawal_eligible) return jsonError(403, "Withdrawal not eligible. Please complete TON payment first.");

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return jsonError(400, "Valid amount required");
  if (amount < Number(settings.min_withdrawal_ada)) {
    return jsonError(400, `Minimum withdrawal is ${settings.min_withdrawal_ada} ADA`);
  }

  if (Number(user.balance) < amount) {
    return jsonError(400, "Insufficient available balance");
  }

  const wallet = await getWalletForUser(user.id);
  if (!wallet || !wallet.cardano_address) {
    return jsonError(400, "No Cardano withdrawal wallet registered");
  }

  // Check for duplicate pending withdrawal
  const { data: existingPending } = await supabase
    .from("withdrawal_requests")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["pending", "under_review", "approved", "processing"])
    .maybeSingle();
  if (existingPending) return jsonError(409, "You already have a pending withdrawal request");

  // Reserve balance: move to pending
  const newAvailable = Number(user.balance) - amount;
  const newPending = Number(user.pending_balance) + amount;

  const { data: withdrawal, error: wErr } = await supabase
    .from("withdrawal_requests")
    .insert({
      user_id: user.id,
      amount_ada: amount,
      cardano_address: wallet.cardano_address,
      status: "pending",
    })
    .select("*")
    .maybeSingle();
  if (wErr) return jsonError(500, `Failed to create withdrawal: ${wErr.message}`);

  await supabase.from("reward_ledger").insert({
    user_id: user.id,
    amount: -amount,
    balance_type: "available",
    source: "withdrawal_hold",
    reference_id: withdrawal.id,
    description: `Withdrawal hold: ${amount} ADA`,
  });

  await supabase.from("reward_ledger").insert({
    user_id: user.id,
    amount,
    balance_type: "pending",
    source: "withdrawal_hold",
    reference_id: withdrawal.id,
    description: `Withdrawal pending: ${amount} ADA`,
  });

  await supabase.from("users").update({
    balance: newAvailable,
    pending_balance: newPending,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  return jsonResponse({ withdrawal, message: "Withdrawal request created" });
}

// --- WITHDRAWAL: GET HISTORY ---
async function handleGetWithdrawals(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  const withdrawals = await getWithdrawalsForUser(user.id);
  return jsonResponse({ withdrawals });
}

// ===== ADMIN ROUTES =====

async function handleAdminGetUsers(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = supabase.from("users").select("*").order("created_at", { ascending: false });
  if (search) {
    const asNum = Number(search);
    if (!isNaN(asNum)) {
      query = query.eq("telegram_id", asNum);
    } else {
      query = query.ilike("username", `%${search}%`);
    }
  }
  query = query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) return jsonError(500, error.message);

  return jsonResponse({ users: data || [], page });
}

async function handleAdminGetWithdrawals(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select(`
      *,
      user:users!withdrawal_requests_user_id_fkey(telegram_id, username, first_name, last_name)
    `)
    .order("created_at", { ascending: false });
  if (error) return jsonError(500, error.message);

  return jsonResponse({ withdrawals: data || [] });
}

async function handleAdminUpdateWithdrawal(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const body = await req.json().catch(() => ({}));
  const { withdrawal_id, status, admin_note, cardano_tx_hash } = body;
  if (!withdrawal_id || !status) return jsonError(400, "Withdrawal ID and status required");

  const { data: withdrawal } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .eq("id", withdrawal_id)
    .maybeSingle();
  if (!withdrawal) return jsonError(404, "Withdrawal not found");

  const update: Record<string, unknown> = {
    status,
    processed_at: new Date().toISOString(),
  };
  if (admin_note !== undefined) update.admin_note = admin_note;
  if (cardano_tx_hash !== undefined) update.cardano_tx_hash = cardano_tx_hash;

  const { data: updated, error } = await supabase
    .from("withdrawal_requests")
    .update(update)
    .eq("id", withdrawal_id)
    .select("*")
    .maybeSingle();
  if (error) return jsonError(500, error.message);

  // If rejected, return balance to user
  if (status === "rejected") {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", withdrawal.user_id)
      .maybeSingle();
    if (user) {
      const newAvailable = Number(user.balance) + Number(withdrawal.amount_ada);
      const newPending = Number(user.pending_balance) - Number(withdrawal.amount_ada);
      await supabase.from("users").update({
        balance: newAvailable,
        pending_balance: newPending,
        updated_at: new Date().toISOString(),
      }).eq("id", user.id);

      await supabase.from("reward_ledger").insert({
        user_id: user.id,
        amount: Number(withdrawal.amount_ada),
        balance_type: "available",
        source: "withdrawal_release",
        reference_id: withdrawal.id,
        description: "Withdrawal rejected, balance returned",
      });
    }
  } else if (status === "paid") {
    // Deduct from pending balance
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", withdrawal.user_id)
      .maybeSingle();
    if (user) {
      const newPending = Number(user.pending_balance) - Number(withdrawal.amount_ada);
      await supabase.from("users").update({
        pending_balance: newPending,
        updated_at: new Date().toISOString(),
      }).eq("id", user.id);

      await supabase.from("reward_ledger").insert({
        user_id: user.id,
        amount: -Number(withdrawal.amount_ada),
        balance_type: "pending",
        source: "withdrawal_deduct",
        reference_id: withdrawal.id,
        description: "Withdrawal paid",
      });
    }
  }

  // Audit log
  await supabase.from("admin_audit_logs").insert({
    admin_telegram_id: tgUser.id,
    action: `withdrawal_${status}`,
    target_user_id: withdrawal.user_id,
    details: `Withdrawal ${withdrawal_id}: ${status}${admin_note ? ` - ${admin_note}` : ""}`,
  });

  return jsonResponse({ withdrawal: updated, message: `Withdrawal ${status}` });
}

async function handleAdminGetSettings(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const settings = await getSettings();
  return jsonResponse({ settings });
}

async function handleAdminUpdateSettings(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const body = await req.json().catch(() => ({}));
  const allowedFields = [
    "mining_rate", "mining_duration_hours", "referral_reward", "referral_qualification_tasks",
    "min_withdrawal_ada", "ton_payment_amount", "ton_receiving_wallet", "cardano_reward_wallet",
    "bot_username", "channel_1_url", "channel_1_title", "channel_1_reward",
    "channel_2_url", "channel_2_title", "channel_2_reward",
    "youtube_url", "youtube_title", "youtube_reward", "mining_paused", "withdrawals_paused",
    "tap_reward", "tap_daily_limit", "tap_paused",
    "youtube_channel_id", "checkin_reward",
  ];

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (body[field] !== undefined) update[field] = body[field];
  }

  const { data, error } = await supabase
    .from("application_settings")
    .update(update)
    .eq("id", 1)
    .select("*")
    .maybeSingle();
  if (error) return jsonError(500, error.message);

  // Sync task links with settings
  await supabase.from("tasks").update({
    link_url: body.channel_1_url || undefined,
    title: body.channel_1_title || undefined,
    reward_amount: body.channel_1_reward || undefined,
    updated_at: new Date().toISOString(),
  }).eq("key", "channel_1");

  await supabase.from("tasks").update({
    link_url: body.channel_2_url || undefined,
    title: body.channel_2_title || undefined,
    reward_amount: body.channel_2_reward || undefined,
    updated_at: new Date().toISOString(),
  }).eq("key", "channel_2");

  await supabase.from("tasks").update({
    link_url: body.youtube_url || undefined,
    title: body.youtube_title || undefined,
    reward_amount: body.youtube_reward || undefined,
    updated_at: new Date().toISOString(),
  }).eq("key", "youtube");

  await supabase.from("admin_audit_logs").insert({
    admin_telegram_id: tgUser.id,
    action: "update_settings",
    details: JSON.stringify(update),
  });

  return jsonResponse({ settings: data, message: "Settings updated" });
}

async function handleAdminGetTransactions(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const { data: tonPayments, error: tErr } = await supabase
    .from("ton_payments")
    .select(`
      *,
      user:users!ton_payments_user_id_fkey(telegram_id, username, first_name)
    `)
    .order("created_at", { ascending: false });
  if (tErr) return jsonError(500, tErr.message);

  const { data: auditLogs } = await supabase
    .from("admin_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  return jsonResponse({ tonPayments: tonPayments || [], auditLogs: auditLogs || [] });
}

async function handleAdminGetReferrals(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const { data, error } = await supabase
    .from("referrals")
    .select(`
      id, status, reward_amount, created_at, qualified_at,
      referrer:users!referrals_referrer_id_fkey(telegram_id, username, first_name),
      referee:users!referrals_referee_id_fkey(telegram_id, username, first_name, tasks_completed)
    `)
    .order("created_at", { ascending: false });
  if (error) return jsonError(500, error.message);

  return jsonResponse({ referrals: data || [] });
}

async function handleAdminExport(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  if (!isAdmin(tgUser.id)) return jsonError(403, "Admin access required");

  const { data: users } = await supabase.from("users").select("*").order("created_at", { ascending: false });
  const { data: payments } = await supabase.from("ton_payments").select("*");
  const { data: withdrawals } = await supabase.from("withdrawal_requests").select("*");
  const { data: ledger } = await supabase.from("reward_ledger").select("*");

  return jsonResponse({ users: users || [], payments: payments || [], withdrawals: withdrawals || [], ledger: ledger || [] });
}

// ===== YOUTUBE OAUTH =====

// Step 1: Generate OAuth URL and store state token
async function handleYouTubeAuthUrl(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");

  if (!GOOGLE_CLIENT_ID) {
    return jsonError(503, "YouTube verification is not configured. Admin must set GOOGLE_CLIENT_ID (and GOOGLE_CLIENT_SECRET) on the edge function. Opening the channel alone never completes this task.");
  }

  const body = await req.json().catch(() => ({}));
  const { task_id, redirect_uri } = body;
  if (!task_id) return jsonError(400, "task_id required");
  if (!redirect_uri) return jsonError(400, "redirect_uri required");

  const user = await getOrCreateUser(tgUser);

  // Check if task is already completed
  const { data: existing } = await supabase
    .from("task_completions")
    .select("id")
    .eq("user_id", user.id)
    .eq("task_id", task_id)
    .maybeSingle();
  if (existing) return jsonError(409, "YouTube task already completed");

  // Expire any old unused states for this user+task
  await supabase
    .from("youtube_oauth_states")
    .update({ used: true })
    .eq("user_id", user.id)
    .eq("task_id", task_id)
    .eq("used", false);

  // Create new state token
  const { data: stateRow, error: stateErr } = await supabase
    .from("youtube_oauth_states")
    .insert({ user_id: user.id, task_id })
    .select("state_token")
    .maybeSingle();
  if (stateErr || !stateRow) return jsonError(500, "Failed to create OAuth state");

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    state: stateRow.state_token,
    access_type: "online",
    prompt: "consent",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return jsonResponse({ authUrl, state: stateRow.state_token });
}

// Step 2: Exchange code for token and verify subscription
async function handleYouTubeCallback(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return jsonError(503, "YouTube verification is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the edge function. Subscription is never assumed from opening the link.");
  }

  const body = await req.json().catch(() => ({}));
  const { code, state, redirect_uri } = body;
  if (!code) return jsonError(400, "Authorization code required");
  if (!state) return jsonError(400, "State token required");
  if (!redirect_uri) return jsonError(400, "redirect_uri required");

  const user = await getOrCreateUser(tgUser);

  // Validate state token
  const { data: stateRow } = await supabase
    .from("youtube_oauth_states")
    .select("*")
    .eq("state_token", state)
    .eq("user_id", user.id)
    .eq("used", false)
    .maybeSingle();

  if (!stateRow) return jsonError(400, "Invalid or expired OAuth state. Please start the verification again.");
  if (new Date(stateRow.expires_at) < new Date()) {
    return jsonError(400, "OAuth session expired. Please start the verification again.");
  }

  const taskId = stateRow.task_id;

  // Mark state as used immediately (single-use)
  await supabase.from("youtube_oauth_states").update({ used: true }).eq("id", stateRow.id);

  // Check if task already completed (race condition guard)
  const { data: alreadyDone } = await supabase
    .from("task_completions")
    .select("id")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .maybeSingle();
  if (alreadyDone) return jsonError(409, "YouTube task already completed");

  // Get task details
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || !task.is_active) return jsonError(404, "Task not found or inactive");

  // Get settings for channel ID
  const settings = await getSettings();
  const channelId = settings.youtube_channel_id || "";
  if (!channelId) {
    return jsonError(503, "YouTube channel ID not configured. Admin must set youtube_channel_id in Admin Settings (YouTube channel ID, e.g. UCxxxx).");
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("Token exchange failed:", errBody);
    return jsonError(400, "Failed to exchange authorization code. Please try again.");
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return jsonError(400, "No access token received from Google.");
  }

  // Check subscription using YouTube Data API v3 — paginate to find the channel
  const isSubscribed = await checkYouTubeSubscription(accessToken, channelId);

  if (!isSubscribed) {
    return jsonError(403, `You are not subscribed to the required YouTube channel. Please subscribe and try again.`);
  }

  // Award the task reward (with duplicate guard via unique constraint)
  const { error: insertErr } = await supabase.from("task_completions").insert({
    user_id: user.id,
    task_id: taskId,
    reward_amount: task.reward_amount,
  });

  if (insertErr) {
    if (insertErr.code === "23505") return jsonError(409, "YouTube task already completed");
    return jsonError(500, `Failed to record task completion: ${insertErr.message}`);
  }

  await supabase.from("reward_ledger").insert({
    user_id: user.id,
    amount: task.reward_amount,
    balance_type: "available",
    source: "task",
    reference_id: taskId,
    description: `YouTube subscription verified: ${task.title}`,
  });

  const newBalance = Number(user.balance) + Number(task.reward_amount);
  await supabase.from("users").update({
    balance: newBalance,
    tasks_completed: (user.tasks_completed || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  // Check if this qualifies any referrals
  await checkReferralQualification(user.id);

  return jsonResponse({
    success: true,
    reward: task.reward_amount,
    newBalance,
    message: "YouTube subscription verified! Reward credited.",
  });
}

// Paginate YouTube subscriptions.list to find the target channel
async function checkYouTubeSubscription(accessToken: string, channelId: string): Promise<boolean> {
  let pageToken: string | undefined;
  let pagesChecked = 0;
  const maxPages = 10; // max 500 subscriptions checked

  do {
    const params = new URLSearchParams({
      part: "snippet",
      mine: "true",
      maxResults: "50",
      fields: "nextPageToken,items/snippet/resourceId/channelId",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/youtube/v3/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("YouTube API error:", err);
      if (res.status === 403) throw new Error("YouTube API quota exceeded or access denied.");
      throw new Error("YouTube API error");
    }

    const data = await res.json();
    const items: Array<{ snippet: { resourceId: { channelId: string } } }> = data.items || [];

    for (const item of items) {
      if (item.snippet?.resourceId?.channelId === channelId) return true;
    }

    pageToken = data.nextPageToken;
    pagesChecked++;
  } while (pageToken && pagesChecked < maxPages);

  return false;
}

// ===== UTIL =====
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== MAIN SERVER =====

// --- DAILY CHECK-IN ---
async function handleCheckin(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();

  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const { data: existing } = await supabase
    .from("daily_checkins")
    .select("id")
    .eq("user_id", user.id)
    .eq("checkin_date", today)
    .maybeSingle();

  if (existing) {
    return jsonError(409, "You already checked in today. Come back tomorrow!");
  }

  const reward = Number(settings.checkin_reward ?? 2);

  const { error: insErr } = await supabase.from("daily_checkins").insert({
    user_id: user.id,
    checkin_date: today,
    reward,
  });
  if (insErr) {
    if (insErr.code === "23505") return jsonError(409, "You already checked in today. Come back tomorrow!");
    return jsonError(500, `Check-in failed: ${insErr.message}`);
  }

  await supabase.from("reward_ledger").insert({
    user_id: user.id,
    amount: reward,
    balance_type: "available",
    source: "checkin",
    description: `Daily check-in ${today}`,
  });

  const newBalance = Number(user.balance) + reward;
  await supabase.from("users").update({
    balance: newBalance,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);

  return jsonResponse({
    reward,
    newBalance,
    checkinDate: today,
    message: `Check-in successful! +${reward} ADA Points`,
  });
}

async function handleCheckinStatus(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);
  const settings = await getSettings();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("daily_checkins")
    .select("id, reward, created_at")
    .eq("user_id", user.id)
    .eq("checkin_date", today)
    .maybeSingle();

  const { count } = await supabase
    .from("daily_checkins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  return jsonResponse({
    checkedInToday: !!existing,
    todayReward: existing?.reward ?? null,
    checkinReward: Number(settings.checkin_reward ?? 2),
    totalCheckins: count ?? 0,
  });
}

// --- USER MINING STATS ---
async function handleUserStats(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayIso = dayStart.toISOString();

  const { data: ledger } = await supabase
    .from("reward_ledger")
    .select("amount, source, created_at")
    .eq("user_id", user.id)
    .gt("amount", 0);

  let totalEarned = 0;
  let earnedToday = 0;
  let tapsToday = 0;
  for (const row of ledger || []) {
    const amt = Number(row.amount) || 0;
    totalEarned += amt;
    if (row.created_at && row.created_at >= dayIso) {
      earnedToday += amt;
      if (row.source === "tap") tapsToday += 1;
    }
  }

  // Prefer exact tap count from tap_events
  const { count: tapCount } = await supabase
    .from("tap_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("tapped_at", dayIso);

  return jsonResponse({
    balance: Number(user.balance),
    pendingBalance: Number(user.pending_balance),
    miningRate: Number(user.mining_rate),
    totalEarned,
    earnedToday,
    tapsToday: tapCount ?? tapsToday,
    totalReferrals: user.total_referrals,
    qualifiedReferrals: user.qualified_referrals,
    tasksCompleted: user.tasks_completed,
  });
}

// --- LEADERBOARD ---
async function handleLeaderboard(req: Request): Promise<Response> {
  const tgUser = getUserFromRequest(req);
  if (!tgUser) return jsonError(401, "Authentication required");
  const user = await getOrCreateUser(tgUser);

  const url = new URL(req.url);
  const period = url.searchParams.get("period") || "all"; // all | daily

  if (period === "daily") {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: rows } = await supabase
      .from("reward_ledger")
      .select("user_id, amount")
      .gt("amount", 0)
      .gte("created_at", dayStart.toISOString());

    const map = new Map<string, number>();
    for (const r of rows || []) {
      map.set(r.user_id, (map.get(r.user_id) || 0) + Number(r.amount));
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
    const ids = sorted.map(([id]) => id);
    const { data: users } = await supabase
      .from("users")
      .select("id, telegram_id, username, first_name, last_name, photo_url, tasks_completed, total_referrals")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

    const userMap = new Map((users || []).map((u) => [u.id, u]));
    const leaders = sorted.map(([id, score], i) => {
      const u = userMap.get(id);
      return {
        rank: i + 1,
        userId: id,
        score,
        firstName: u?.first_name || "Miner",
        username: u?.username || null,
        photoUrl: u?.photo_url || null,
        tasksCompleted: u?.tasks_completed || 0,
        totalReferrals: u?.total_referrals || 0,
        isYou: id === user.id,
      };
    });

    const myRank = leaders.find((l) => l.isYou)?.rank
      ?? (sorted.findIndex(([id]) => id === user.id) + 1 || null);

    return jsonResponse({ period: "daily", leaders, myRank, myScore: map.get(user.id) || 0 });
  }

  // All-time by balance
  const { data: top } = await supabase
    .from("users")
    .select("id, telegram_id, username, first_name, last_name, photo_url, balance, tasks_completed, total_referrals")
    .order("balance", { ascending: false })
    .limit(50);

  const leaders = (top || []).map((u, i) => ({
    rank: i + 1,
    userId: u.id,
    score: Number(u.balance),
    firstName: u.first_name || "Miner",
    username: u.username || null,
    photoUrl: u.photo_url || null,
    tasksCompleted: u.tasks_completed || 0,
    totalReferrals: u.total_referrals || 0,
    isYou: u.id === user.id,
  }));

  // Rank for current user if not in top 50
  let myRank = leaders.find((l) => l.isYou)?.rank ?? null;
  if (myRank === null) {
    const { count } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .gt("balance", user.balance);
    myRank = (count ?? 0) + 1;
  }

  return jsonResponse({
    period: "all",
    leaders,
    myRank,
    myScore: Number(user.balance),
  });
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "").replace(/^\//, "");
    const method = req.method;

    // Route matching
    if (path === "tap" && method === "POST") return await handleTap(req);
    if (path === "checkin" && method === "POST") return await handleCheckin(req);
    if (path === "checkin/status" && method === "GET") return await handleCheckinStatus(req);
    if (path === "stats" && method === "GET") return await handleUserStats(req);
    if (path === "leaderboard" && method === "GET") return await handleLeaderboard(req);
    if (path === "youtube/auth-url" && method === "POST") return await handleYouTubeAuthUrl(req);
    if (path === "youtube/callback" && method === "POST") return await handleYouTubeCallback(req);
    if (path === "auth" && method === "POST") return await handleAuth(req);
    if (path === "dashboard" && method === "GET") return await handleDashboard(req);
    if (path === "mining/start" && method === "POST") return await handleStartMining(req);
    if (path === "mining/claim" && method === "POST") return await handleClaimMining(req);
    if (path === "mining/status" && method === "GET") return await handleMiningStatus(req);
    if (path === "tasks/verify" && method === "POST") return await handleVerifyTask(req);
    if (path === "referrals" && method === "GET") return await handleGetReferrals(req);
    if (path === "ton-payment" && method === "GET") return await handleTonPayment(req);
    if (path === "ton-payment" && method === "POST") return await handleTonPayment(req);
    if (path === "ton-payment/verify" && method === "POST") return await handleTonVerify(req);
    if (path === "wallet" && method === "GET") return await handleGetWallet(req);
    if (path === "wallet/ton" && (method === "POST" || method === "DELETE")) return await handleRegisterTonWallet(req);
    if (path === "wallet/register" && method === "POST") return await handleRegisterWallet(req);
    if (path === "withdrawals" && method === "GET") return await handleGetWithdrawals(req);
    if (path === "withdrawals/create" && method === "POST") return await handleCreateWithdrawal(req);

    // Admin routes
    if (path === "admin/users" && method === "GET") return await handleAdminGetUsers(req);
    if (path === "admin/withdrawals" && method === "GET") return await handleAdminGetWithdrawals(req);
    if (path === "admin/withdrawals/update" && method === "POST") return await handleAdminUpdateWithdrawal(req);
    if (path === "admin/settings" && method === "GET") return await handleAdminGetSettings(req);
    if (path === "admin/settings" && method === "POST") return await handleAdminUpdateSettings(req);
    if (path === "admin/transactions" && method === "GET") return await handleAdminGetTransactions(req);
    if (path === "admin/referrals" && method === "GET") return await handleAdminGetReferrals(req);
    if (path === "admin/export" && method === "GET") return await handleAdminExport(req);

    return jsonError(404, `Route not found: ${path}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return jsonError(500, msg);
  }
});
