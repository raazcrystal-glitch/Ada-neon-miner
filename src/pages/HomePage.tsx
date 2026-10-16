import { useState, useRef, useCallback, useEffect } from 'react';
import { Pickaxe, Users, CheckCircle2, ArrowRight, Zap, MessageCircle, Rocket } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact, hapticNotification } from '../lib/telegram';
import { AdapCoin } from '../components/AdapCoin';
import { StatusBadge } from '../components/ui';
import { LoadingSpinner } from '../components/Layout';
import { useNavigate } from 'react-router-dom';

export function HomePage() {
  const { user, settings, updateUser } = useApp();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [tapping, setTapping] = useState(false);
  // Debounce tap requests — only one in flight at a time
  const tapInFlight = useRef(false);
  const lastTapTime = useRef(0);
  const [stats, setStats] = useState<{
    totalEarned: number;
    earnedToday: number;
    tapsToday: number;
  } | null>(null);

  useEffect(() => {
    callEdgeFunction<{ totalEarned: number; earnedToday: number; tapsToday: number }>(
      'api/stats',
      { method: 'GET' },
    ).then(({ data }) => {
      if (data) setStats({ totalEarned: data.totalEarned, earnedToday: data.earnedToday, tapsToday: data.tapsToday });
    });
  }, [user?.balance]);

  const handleTap = useCallback(async () => {
    if (!user || !settings) return;
    if (settings.tap_paused) {
      showToast('Tap mining is currently paused.', 'error');
      return;
    }
    // Client-side 1s throttle to match server rate limit
    const now = Date.now();
    if (now - lastTapTime.current < 1000) return;
    if (tapInFlight.current) return;

    lastTapTime.current = now;
    tapInFlight.current = true;
    setTapping(true);
    hapticImpact('light');

    const { data, error } = await callEdgeFunction<{
      reward: number;
      newBalance: number;
      tapsToday: number;
      dailyLimit: number;
    }>('api/tap', { method: 'POST' });

    tapInFlight.current = false;
    setTapping(false);

    if (error) {
      if (!error.includes('Too fast')) {
        hapticNotification('error');
        showToast(error, 'error');
      }
      return;
    }

    if (data) {
      updateUser({ balance: data.newBalance });
      setStats((prev) =>
        prev
          ? {
              totalEarned: prev.totalEarned + (data.reward || 0),
              earnedToday: prev.earnedToday + (data.reward || 0),
              tapsToday: data.tapsToday ?? prev.tapsToday + 1,
            }
          : prev,
      );
    }
  }, [user, settings, showToast, updateUser]);

  const handleStartMining = async () => {
    if (!settings) return;
    if (settings.mining_paused) {
      showToast('Mining is currently paused by the administrator.', 'error');
      return;
    }
    setStarting(true);
    hapticImpact('medium');
    const { error } = await callEdgeFunction('api/mining/start', { method: 'POST' });
    setStarting(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    updateUser({ is_mining_active: true, mining_started_at: new Date().toISOString() });
    showToast('Mining started! Come back later to claim your rewards.', 'success');
    navigate('/mining');
  };

  if (!user || !settings) return <LoadingSpinner />;

  const tgConnected = !!user.telegram_id;

  return (
    <div className="flex flex-col gap-12">
      {/* Telegram status */}
      <div className="glass-card compact flex items-center justify-between">
        <span className="text-sm text-muted">Telegram</span>
        <StatusBadge status={tgConnected ? 'connected' : 'disconnected'} label={tgConnected ? 'Connected' : 'Not Connected'} />
      </div>

      {/* Main heading */}
      <div className="text-center mt-8">
        <h1 style={{ fontSize: '28px', letterSpacing: '1px' }}>Mine ADA Points</h1>
        <p className="text-xs text-muted mt-8" style={{ letterSpacing: '1px' }}>
          Your in-app mining dashboard
        </p>
      </div>

      {/* ADA Coin — tap to mine */}
      <AdapCoin
        onTap={handleTap}
        tapping={tapping}
        tapReward={settings.tap_reward ?? 1}
      />

      {/* Balance card */}
      <div className="glass-card glow balance-card">
        <div className="label">Your Balance</div>
        <div className="value">
          {Number(user.balance).toFixed(2)}
          <span className="unit">ADA Points</span>
        </div>
        <div className="mining-rate">
          <Zap size={16} />
          Mining Rate: +{Number(user.mining_rate).toFixed(2)} Points/hour
        </div>
      </div>


      {/* Activity stats */}
      <div className="stats-grid">
        <div className="glass-card stat-item">
          <div className="stat-label">Total Earned</div>
          <div className="stat-value">{stats ? stats.totalEarned.toFixed(1) : '—'}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Today</div>
          <div className="stat-value">{stats ? stats.earnedToday.toFixed(1) : '—'}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Taps Today</div>
          <div className="stat-value">{stats ? stats.tapsToday : '—'}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Tasks</div>
          <div className="stat-value">{user.tasks_completed}</div>
        </div>
      </div>

      {/* Start Mining button */}
      <button
        className="btn btn-primary"
        onClick={handleStartMining}
        disabled={starting || user.is_mining_active || settings.mining_paused}
      >
        {starting ? (
          <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Starting...</>
        ) : user.is_mining_active ? (
          <><Pickaxe size={18} /> Mining Active</>
        ) : settings.mining_paused ? (
          <>Mining Paused</>
        ) : (
          <><Pickaxe size={18} /> Start Mining</>
        )}
      </button>

      {user.is_mining_active && (
        <div className="glass-card compact text-center">
          <div className="mining-pulse" style={{ justifyContent: 'center' }}>
            <span className="pulse-dot" />
            Mining in progress...
          </div>
          <button className="btn btn-secondary btn-sm mt-12" onClick={() => navigate('/mining')} style={{ width: 'auto', margin: '0 auto' }}>
            View Mining <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Stats grid */}
      <div className="stats-grid">
        <div className="glass-card stat-item">
          <div className="stat-label">Total Referrals</div>
          <div className="stat-value">{user.total_referrals}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Tasks Done</div>
          <div className="stat-value">{user.tasks_completed}</div>
        </div>
      </div>

      {/* Feature cards */}
      <div className="section-title">
        <Rocket className="icon" size={18} /> Get Started
      </div>
      <div className="stats-grid">
        <div className="glass-card stat-item" style={{ cursor: 'pointer' }} onClick={() => navigate('/community')}>
          <Users size={28} style={{ color: 'var(--neon-cyan)', margin: '0 auto 8px' }} />
          <div className="stat-label">Join Community</div>
          <div className="text-xs text-muted">Invite friends & earn</div>
        </div>
        <div className="glass-card stat-item" style={{ cursor: 'pointer' }} onClick={() => navigate('/profile')}>
          <CheckCircle2 size={28} style={{ color: 'var(--neon-cyan)', margin: '0 auto 8px' }} />
          <div className="stat-label">Complete Tasks</div>
          <div className="text-xs text-muted">Earn bonus points</div>
        </div>
        <div className="glass-card stat-item" style={{ cursor: 'pointer' }} onClick={() => navigate('/community')}>
          <MessageCircle size={28} style={{ color: 'var(--neon-cyan)', margin: '0 auto 8px' }} />
          <div className="stat-label">Invite Friends</div>
          <div className="text-xs text-muted">0.5 Points per referral</div>
        </div>
        <div className="glass-card stat-item" style={{ cursor: 'pointer' }} onClick={() => navigate('/mining')}>
          <Rocket size={28} style={{ color: 'var(--neon-cyan)', margin: '0 auto 8px' }} />
          <div className="stat-label">Build Together</div>
          <div className="text-xs text-muted">Mine & grow</div>
        </div>
      </div>
    </div>
  );
}
