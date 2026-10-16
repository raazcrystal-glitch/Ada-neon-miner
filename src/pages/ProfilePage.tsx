import { useState, useEffect, useRef } from 'react';
import { Play, MessageCircle, CheckCircle2, ExternalLink, Award, User, Shield, Settings as SettingsIcon, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact, hapticNotification, openTelegramLink, openExternalLink } from '../lib/telegram';
import { StatusBadge, InfoRow } from '../components/ui';
import { LoadingSpinner } from '../components/Layout';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { TaskItem } from '../types';

// The redirect URI for the OAuth callback — points back to this page
function getRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function ProfilePage() {
  const { user, settings, tasks, refresh, updateUser } = useApp();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [verifyingTask, setVerifyingTask] = useState<string | null>(null);

  const [youtubeLoading, setYoutubeLoading] = useState<string | null>(null);
  const oauthHandled = useRef(false);

  // Handle OAuth callback when Google redirects back with ?code=...&state=...
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (oauthHandled.current) return;
    if (!code && !error) return;
    oauthHandled.current = true;

    // Remove OAuth params from URL immediately
    setSearchParams({}, { replace: true });

    if (error) {
      if (error === 'access_denied') {
        showToast('YouTube verification was cancelled. You can try again anytime.', 'info');
      } else {
        showToast(`YouTube verification error: ${error}`, 'error');
      }
      return;
    }

    if (code && state) {
      // Find the YouTube task so we know what was being verified
      const ytTask = tasks.find((t) => t.task_type === 'youtube' && !t.completed);
      if (!ytTask) {
        showToast('No pending YouTube task found.', 'error');
        return;
      }

      setYoutubeLoading(ytTask.id);
      callEdgeFunction<{ success: boolean; reward: number; newBalance: number; message: string }>(
        'api/youtube/callback',
        {
          method: 'POST',
          body: { code, state, redirect_uri: getRedirectUri() },
        },
      ).then(({ data, error: apiErr }) => {
        setYoutubeLoading(null);
        if (apiErr) {
          hapticNotification('error');
          showToast(apiErr, 'error');
          return;
        }
        if (data) {
          hapticNotification('success');
          showToast(`YouTube verified! +${Number(data.reward).toFixed(2)} ADA Points`, 'success');
          updateUser({ balance: data.newBalance });
          refresh();
        }
      });
    }
  }, [searchParams, tasks, showToast, setSearchParams, refresh, updateUser]);

  if (!user || !settings) return <LoadingSpinner />;

  const handleOpenLink = (task: TaskItem) => {
    hapticImpact('light');
    if (task.task_type === 'telegram_channel') {
      openTelegramLink(task.link_url);
    } else {
      openExternalLink(task.link_url);
    }
  };

  const handleVerifyTelegram = async (task: TaskItem) => {
    if (task.completed) return;
    setVerifyingTask(task.id);
    hapticImpact('medium');

    const { data, error } = await callEdgeFunction<{ reward: number; newBalance: number }>(
      'api/tasks/verify',
      { method: 'POST', body: { task_id: task.id } },
    );
    setVerifyingTask(null);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast(`Task completed! +${Number(data?.reward).toFixed(2)} ADA Points`, 'success');
    updateUser({ balance: data!.newBalance });
    refresh();
  };

  const handleYouTubeOAuth = async (task: TaskItem) => {
    if (task.completed) return;
    setYoutubeLoading(task.id);
    hapticImpact('medium');

    const redirectUri = getRedirectUri();
    const { data, error } = await callEdgeFunction<{ authUrl: string; state: string }>(
      'api/youtube/auth-url',
      { method: 'POST', body: { task_id: task.id, redirect_uri: redirectUri } },
    );
    setYoutubeLoading(null);

    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }

    if (data?.authUrl) {
      // Redirect to Google OAuth — Google will redirect back with ?code=...&state=...
      window.location.href = data.authUrl;
    }
  };

  const taskIcon = (type: string) => {
    if (type === 'youtube') return <Play size={20} />;
    return <MessageCircle size={20} />;
  };

  return (
    <div className="flex flex-col gap-12">
      <div className="section-title">
        <Award className="icon" size={18} /> Earn Rewards
      </div>

      {/* User profile card */}
      <div className="glass-card glow">
        <div className="flex items-center gap-12">
          {user.photo_url ? (
            <img
              src={user.photo_url}
              alt=""
              style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid var(--neon-blue)' }}
            />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(0,212,255,0.1)', border: '2px solid var(--neon-blue)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <User size={24} style={{ color: 'var(--neon-cyan)' }} />
            </div>
          )}
          <div className="flex-1">
            <div className="font-bold" style={{ fontSize: 16 }}>
              {user.first_name} {user.last_name || ''}
            </div>
            {user.username && <div className="text-xs text-muted">@{user.username}</div>}
            <div className="mt-8">
              <StatusBadge status="connected" label="Telegram Connected" />
            </div>
          </div>
        </div>

        <div className="mt-12">
          <InfoRow label="ADA Points Balance" value={`${Number(user.balance).toFixed(2)}`} />
          <InfoRow label="Pending Balance" value={`${Number(user.pending_balance).toFixed(2)}`} />
          <InfoRow label="Mining Rate" value={`+${Number(user.mining_rate).toFixed(2)} /hour`} />
          <InfoRow label="Total Referrals" value={user.total_referrals} />
          <InfoRow label="Tasks Completed" value={user.tasks_completed} />
          <InfoRow
            label="Withdrawal Eligible"
            value={user.withdrawal_eligible ? <span className="text-success">Yes</span> : <span className="text-warning">No</span>}
          />
          <InfoRow label="Member Since" value={new Date(user.created_at).toLocaleDateString()} />
        </div>
      </div>

      {/* Tasks Section */}
      <div>
        <div className="section-title">
          <Award className="icon" size={18} /> Tasks
        </div>
        <div className="flex flex-col gap-12">
          {tasks.map((task) => (
            <div key={task.id} className="glass-card task-card">
              <div className="task-header">
                <div className="task-info">
                  <div className="task-icon">{taskIcon(task.task_type)}</div>
                  <div>
                    <div className="task-name">{task.title}</div>
                    <div className="task-desc">{task.description || 'Complete this task to earn points'}</div>
                  </div>
                </div>
                <div className="task-reward">+{Number(task.reward_amount).toFixed(2)}</div>
              </div>

              {task.completed ? (
                <div className="task-completed-badge">
                  <CheckCircle2 size={16} /> Completed {task.completed_at && `on ${new Date(task.completed_at).toLocaleDateString()}`}
                </div>
              ) : task.task_type === 'youtube' ? (
                <div className="task-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleOpenLink(task)}
                  >
                    <ExternalLink size={14} /> Open Channel
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleYouTubeOAuth(task)}
                    disabled={youtubeLoading === task.id}
                  >
                    {youtubeLoading === task.id ? (
                      <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Verifying...</>
                    ) : (
                      <><CheckCircle2 size={14} /> Join & Verify</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="task-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => handleOpenLink(task)}>
                    <ExternalLink size={14} /> Open
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleVerifyTelegram(task)}
                    disabled={verifyingTask === task.id}
                  >
                    {verifyingTask === task.id ? (
                      <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Verifying...</>
                    ) : (
                      <>Verify</>
                    )}
                  </button>
                </div>
              )}

              {task.task_type === 'youtube' && !task.completed && (
                <p className="text-xs text-muted mt-8" style={{ lineHeight: 1.4 }}>
                  1) Tap <strong>Open Channel</strong> and subscribe on YouTube.
                  2) Return here and tap <strong>Join & Verify</strong>.
                  Opening the link alone does not complete the task. Verification uses Google OAuth + YouTube Data API and awards the reward only after a confirmed subscription.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Admin access */}
      {user.is_admin && (
        <div className="glass-card">
          <div className="section-title" style={{ margin: '0 0 8px 0' }}>
            <Shield className="icon" size={16} /> Administrator
          </div>
          <p className="text-sm text-muted mb-12">Access the admin control panel to manage users, withdrawals, and settings.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/admin')}>
            <SettingsIcon size={16} /> Admin Panel <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
