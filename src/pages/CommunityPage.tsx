import { useState, useEffect, useCallback } from 'react';
import { Users, Copy, Share2, CheckCircle2, UserPlus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact, openTelegramLink } from '../lib/telegram';
import { LoadingSpinner, EmptyState } from '../components/Layout';

interface ReferralData {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  qualifiedReferrals: number;
  pendingReferrals: number;
  referralReward: number;
  referrals: Array<{
    id: string;
    status: string;
    reward_amount: number;
    created_at: string;
    qualified_at: string | null;
    referee_name: string;
    referee_username: string | null;
    referee_tasks_completed: number;
    referee_created_at: string;
  }>;
}

export function CommunityPage() {
  const { user, settings } = useApp();
  const { showToast } = useToast();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const { data: result, error } = await callEdgeFunction<ReferralData>('api/referrals', { method: 'GET' });
    if (error) {
      setLoading(false);
      return;
    }
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!user || !settings) return <LoadingSpinner />;
  if (loading || !data) return <LoadingSpinner />;

  const copyLink = () => {
    navigator.clipboard?.writeText(data.referralLink);
    hapticImpact('light');
    showToast('Referral link copied!', 'info');
  };

  const shareLink = () => {
    hapticImpact('medium');
    const shareText = `Join ADA NEON MINER and start mining ADA Points! Use my referral link:`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      const url = `https://t.me/share/url?url=${encodeURIComponent(data.referralLink)}&text=${encodeURIComponent(shareText)}`;
      openTelegramLink(url);
    } else {
      navigator.share?.({ title: 'ADA NEON MINER', text: shareText, url: data.referralLink }).catch(() => {
        copyLink();
      });
    }
  };

  const completedTaskReferrals = data.referrals.filter((r) => r.referee_tasks_completed > 0).length;

  return (
    <div className="flex flex-col gap-12">
      <div className="section-title">
        <Users className="icon" size={18} /> Invite Friends
      </div>

      {/* Referral Link */}
      <div className="glass-card glow">
        <div className="text-center mb-12">
          <UserPlus size={36} style={{ color: 'var(--neon-cyan)', margin: '0 auto 8px' }} />
          <h3 style={{ fontSize: '16px' }}>Invite Friends</h3>
          <p className="text-xs text-muted mt-8">
            Earn {data.referralReward} ADA Points per qualified referral
          </p>
        </div>

        <div className="referral-link-box">
          <span className="link-text">{data.referralLink}</span>
          <button onClick={copyLink}>
            <Copy size={16} style={{ color: 'var(--neon-cyan)' }} />
          </button>
        </div>

        <div className="flex gap-8 mt-12">
          <button className="btn btn-secondary" onClick={copyLink}>
            <Copy size={16} /> Copy
          </button>
          <button className="btn btn-primary" onClick={shareLink}>
            <Share2 size={16} /> Share
          </button>
        </div>
      </div>

      {/* Referral Stats */}
      <div className="stats-grid">
        <div className="glass-card stat-item">
          <div className="stat-label">Total Invited</div>
          <div className="stat-value">{data.totalReferrals}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Qualified</div>
          <div className="stat-value">{data.qualifiedReferrals}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Pending</div>
          <div className="stat-value muted">{data.pendingReferrals}</div>
        </div>
        <div className="glass-card stat-item">
          <div className="stat-label">Tasks Done</div>
          <div className="stat-value muted">{completedTaskReferrals}</div>
        </div>
      </div>

      {/* Task completion stats */}
      <div className="glass-card">
        <div className="section-title" style={{ margin: '0 0 12px 0' }}>
          <CheckCircle2 className="icon" size={16} /> Community Statistics
        </div>
        <div className="info-row">
          <span className="info-label">Total Referral Rewards</span>
          <span className="info-value text-success font-bold">
            +{(data.qualifiedReferrals * data.referralReward).toFixed(2)} ADA Points
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Qualification Requirement</span>
          <span className="info-value">
            {settings.referral_qualification_tasks} task(s)
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Your Referral Code</span>
          <span className="info-value mono">{data.referralCode}</span>
        </div>
      </div>

      {/* Referral List */}
      <div className="glass-card">
        <div className="section-title" style={{ margin: '0 0 12px 0' }}>
          <Users className="icon" size={16} /> Invited Users
        </div>
        {data.referrals.length > 0 ? (
          <div className="flex flex-col gap-8">
            {data.referrals.map((r) => (
              <div key={r.id} className="info-row" style={{ borderBottom: '1px solid rgba(0,212,255,0.08)' }}>
                <div className="flex flex-col">
                  <span className="info-value" style={{ textAlign: 'left', fontSize: 14 }}>
                    {r.referee_name}
                  </span>
                  {r.referee_username && (
                    <span className="text-xs text-muted">@{r.referee_username}</span>
                  )}
                  <span className="text-xs text-muted mt-8">
                    Joined {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-8">
                  <span className={`withdrawal-status ${r.status === 'qualified' ? 'paid' : 'pending'}`}>
                    {r.status === 'qualified' ? 'Qualified' : 'Pending'}
                  </span>
                  <span className="text-xs text-muted">
                    {r.referee_tasks_completed} task(s) done
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No referrals yet. Share your link to start earning!" />
        )}
      </div>
    </div>
  );
}
