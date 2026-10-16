import { useState, useEffect, useRef } from 'react';
import { Play, MessageCircle, CheckCircle2, ExternalLink, Award, CalendarCheck, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact, hapticNotification, openTelegramLink, openExternalLink } from '../lib/telegram';
import { LoadingSpinner } from '../components/Layout';
import { useSearchParams } from 'react-router-dom';
import type { TaskItem } from '../types';

function getRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function TasksPage() {
  const { user, settings, tasks, refresh, updateUser } = useApp();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [verifyingTask, setVerifyingTask] = useState<string | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState<string | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinStatus, setCheckinStatus] = useState<{
    checkedInToday: boolean;
    checkinReward: number;
    totalCheckins: number;
  } | null>(null);
  const oauthHandled = useRef(false);

  useEffect(() => {
    callEdgeFunction<{
      checkedInToday: boolean;
      checkinReward: number;
      totalCheckins: number;
    }>('api/checkin/status', { method: 'GET' }).then(({ data }) => {
      if (data) setCheckinStatus(data);
    });
  }, []);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    if (oauthHandled.current) return;
    if (!code && !error) return;
    oauthHandled.current = true;
    setSearchParams({}, { replace: true });

    if (error) {
      showToast(
        error === 'access_denied'
          ? 'YouTube verification was cancelled.'
          : `YouTube verification error: ${error}`,
        error === 'access_denied' ? 'info' : 'error',
      );
      return;
    }

    if (code && state) {
      const ytTask = tasks.find((t) => t.task_type === 'youtube' && !t.completed);
      if (!ytTask) {
        showToast('No pending YouTube task found.', 'error');
        return;
      }
      setYoutubeLoading(ytTask.id);
      callEdgeFunction<{ success: boolean; reward: number; newBalance: number; message: string }>(
        'api/youtube/callback',
        { method: 'POST', body: { code, state, redirect_uri: getRedirectUri() } },
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
    const { data, error } = await callEdgeFunction<{ authUrl: string }>(
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
      window.location.href = data.authUrl;
    }
  };

  const handleCheckin = async () => {
    if (checkinStatus?.checkedInToday) return;
    setCheckinLoading(true);
    hapticImpact('medium');
    const { data, error } = await callEdgeFunction<{
      reward: number;
      newBalance: number;
      message: string;
    }>('api/checkin', { method: 'POST' });
    setCheckinLoading(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast(data?.message || 'Check-in successful!', 'success');
    if (data) updateUser({ balance: data.newBalance });
    setCheckinStatus((prev) =>
      prev
        ? { ...prev, checkedInToday: true, totalCheckins: prev.totalCheckins + 1 }
        : { checkedInToday: true, checkinReward: data?.reward ?? 2, totalCheckins: 1 },
    );
  };

  const taskIcon = (type: string) =>
    type === 'youtube' ? <Play size={20} /> : <MessageCircle size={20} />;

  const statusIcon = (task: TaskItem) => {
    if (task.completed) {
      return (
        <span className="task-status completed">
          <CheckCircle2 size={14} /> Completed
        </span>
      );
    }
    return (
      <span className="task-status pending">
        <Clock size={14} /> Pending
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-12">
      <div className="section-title">
        <Award className="icon" size={18} /> Tasks & Rewards
      </div>

      {/* Daily check-in */}
      <div className="glass-card glow">
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-8">
            <CalendarCheck size={22} style={{ color: 'var(--neon-cyan)' }} />
            <div>
              <div className="font-bold">Daily Check-in</div>
              <div className="text-xs text-muted">
                +{checkinStatus?.checkinReward ?? settings.checkin_reward ?? 2} ADA Points once per day
              </div>
            </div>
          </div>
          {checkinStatus?.checkedInToday ? (
            <span className="task-status completed">
              <CheckCircle2 size={14} /> Done
            </span>
          ) : (
            <span className="task-status pending">
              <Clock size={14} /> Available
            </span>
          )}
        </div>
        <button
          className="btn btn-primary"
          onClick={handleCheckin}
          disabled={checkinLoading || !!checkinStatus?.checkedInToday}
        >
          {checkinLoading ? (
            <>
              <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Checking in...
            </>
          ) : checkinStatus?.checkedInToday ? (
            <>
              <CheckCircle2 size={18} /> Checked in today
            </>
          ) : (
            <>
              <CalendarCheck size={18} /> Claim daily reward
            </>
          )}
        </button>
        {checkinStatus && (
          <p className="text-xs text-muted mt-8 text-center">
            Total check-ins: {checkinStatus.totalCheckins}
          </p>
        )}
      </div>

      {/* Task list */}
      <div className="flex flex-col gap-12">
        {tasks.length === 0 ? (
          <div className="glass-card text-center text-muted">No tasks available right now.</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="glass-card task-card">
              <div className="task-header">
                <div className="task-info">
                  <div className="task-icon">{taskIcon(task.task_type)}</div>
                  <div>
                    <div className="task-name">{task.title}</div>
                    <div className="task-desc">
                      {task.description || 'Complete this task to earn points'}
                    </div>
                  </div>
                </div>
                <div className="task-reward">+{Number(task.reward_amount).toFixed(2)}</div>
              </div>

              <div className="mt-8 mb-8">{statusIcon(task)}</div>

              {task.completed ? (
                <div className="task-completed-badge">
                  <CheckCircle2 size={16} /> Completed
                  {task.completed_at && ` on ${new Date(task.completed_at).toLocaleDateString()}`}
                </div>
              ) : task.task_type === 'youtube' ? (
                <>
                  <div className="task-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => handleOpenLink(task)}>
                      <ExternalLink size={14} /> Open Channel
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleYouTubeOAuth(task)}
                      disabled={youtubeLoading === task.id}
                    >
                      {youtubeLoading === task.id ? (
                        <>
                          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Verifying...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={14} /> Join & Verify
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted mt-8" style={{ lineHeight: 1.4 }}>
                    Open the channel and subscribe, then return and tap Join & Verify. Opening the link alone
                    never completes the task. Verification uses Google OAuth and the YouTube Data API.
                  </p>
                </>
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
                      <>
                        <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Verifying...
                      </>
                    ) : (
                      <>Verify membership</>
                    )}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
