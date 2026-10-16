import { useState, useEffect, useCallback } from 'react';
import { Pickaxe, Clock, Gift, History, CheckCircle2, Gem } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact, hapticNotification } from '../lib/telegram';
import { StatusBadge, InfoRow } from '../components/ui';
import { LoadingSpinner, EmptyState } from '../components/Layout';
import type { MiningSession } from '../types';

interface MiningStatus {
  active: boolean;
  canClaim: boolean;
  currentReward: number;
  timeRemaining: number;
  miningDurationHours: number;
  miningRate: number;
  history: MiningSession[];
}

export function MiningPage() {
  const { user, settings } = useApp();
  const { showToast } = useToast();
  const [status, setStatus] = useState<MiningStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const fetchStatus = useCallback(async () => {
    const { data, error } = await callEdgeFunction<MiningStatus>('api/mining/status', { method: 'GET' });
    if (error) {
      setLoading(false);
      return;
    }
    setStatus(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (!user || !settings) return <LoadingSpinner />;
  if (loading) return <LoadingSpinner />;

  const handleStart = async () => {
    if (settings.mining_paused) {
      showToast('Mining is currently paused.', 'error');
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
    showToast('Mining started successfully!', 'success');
    fetchStatus();
  };

  const handleClaim = async () => {
    setClaiming(true);
    hapticImpact('medium');
    const { data, error } = await callEdgeFunction<{ reward: number; newBalance: number; message: string }>(
      'api/mining/claim',
      { method: 'POST' },
    );
    setClaiming(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast(`Claimed ${data?.reward.toFixed(2)} ADA Points!`, 'success');
    fetchStatus();
  };

  const formatTime = (ms: number) => {
    if (ms <= 0) return 'Ready to claim';
    const h = Math.floor(ms / (1000 * 60 * 60));
    const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((ms % (1000 * 60)) / 1000);
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="flex flex-col gap-12">
      <div className="section-title">
        <Gem className="icon" size={18} /> Miners Store
      </div>

      {/* Mining status card */}
      <div className="glass-card glow">
        <div className="flex items-center justify-between mb-12">
          <span className="text-sm text-muted">Session Status</span>
          <StatusBadge
            status={status?.active ? 'connected' : 'disconnected'}
            label={status?.active ? 'Active' : 'Inactive'}
          />
        </div>

        {status?.active ? (
          <>
            <div className="text-center">
              <div className="mining-pulse" style={{ justifyContent: 'center' }}>
                <span className="pulse-dot" />
                Mining in progress
              </div>
            </div>

            <div className="glass-card compact mt-12" style={{ background: 'rgba(0,212,255,0.05)' }}>
              <InfoRow label="Current Reward" value={`+${status.currentReward.toFixed(4)} ADA Points`} />
              <InfoRow
                label="Time Remaining"
                value={
                  status.canClaim
                    ? <span className="text-success font-bold">Ready to claim!</span>
                    : formatTime(status.timeRemaining)
                }
              />
              <InfoRow label="Mining Rate" value={`+${status.miningRate.toFixed(2)} /hour`} />
              <InfoRow label="Duration" value={`${status.miningDurationHours} hours`} />
            </div>

            <button
              className="btn btn-primary mt-12"
              onClick={handleClaim}
              disabled={!status.canClaim || claiming}
            >
              {claiming ? (
                <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Claiming...</>
              ) : status.canClaim ? (
                <><Gift size={18} /> Claim Reward ({status.currentReward.toFixed(2)} Points)</>
              ) : (
                <><Clock size={18} /> Mining... {formatTime(status.timeRemaining)}</>
              )}
            </button>
          </>
        ) : (
          <>
            <div className="text-center" style={{ padding: '20px 0' }}>
              <Pickaxe size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 12px' }} />
              <p className="text-muted text-sm">No active mining session</p>
              <p className="text-muted text-xs mt-8">
                Start mining to earn ADA Points at {user.mining_rate.toFixed(2)} points/hour
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={starting || settings.mining_paused}
            >
              {starting ? (
                <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Starting...</>
              ) : settings.mining_paused ? (
                <>Mining Paused</>
              ) : (
                <><Pickaxe size={18} /> Start Mining</>
              )}
            </button>
          </>
        )}
      </div>

      {/* Balance summary */}
      <div className="stats-grid">
        <div className="glass-card stat-item">
          <div className="stat-label">Available</div>
          <div className="stat-value">{Number(user.balance).toFixed(2)}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Pending</div>
          <div className="stat-value muted">{Number(user.pending_balance).toFixed(2)}</div>
        </div>
      </div>

      {/* Mining history */}
      <div className="glass-card">
        <div className="section-title" style={{ margin: '0 0 12px 0' }}>
          <History className="icon" size={16} /> Mining History
        </div>
        {status?.history && status.history.length > 0 ? (
          <div className="flex flex-col gap-8">
            {status.history.map((s) => (
              <div key={s.id} className="info-row">
                <div className="flex flex-col">
                  <span className="info-label">
                    {new Date(s.started_at).toLocaleDateString()} {new Date(s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-muted">
                    {s.status === 'active' ? 'In progress' : `Completed: +${Number(s.reward_amount).toFixed(2)}`}
                  </span>
                </div>
                <div className="flex items-center gap-8">
                  {s.status === 'completed' && <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />}
                  <span className={`withdrawal-status ${s.status === 'active' ? 'processing' : 'paid'}`}>
                    {s.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No mining history yet" />
        )}
      </div>
    </div>
  );
}
