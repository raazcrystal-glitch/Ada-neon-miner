import { useState, useEffect, useCallback } from 'react';
import { Users, ArrowDownToLine, Settings as SettingsIcon, CreditCard, Share2, FileDown, Shield, Search } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact, hapticNotification } from '../lib/telegram';
import { LoadingSpinner, EmptyState } from '../components/Layout';
import { WithdrawalStatusBadge, PaymentStatusBadge, InfoRow } from '../components/ui';
import type { AppSettings, AdminAuditLog, TonPayment, UserProfile, WithdrawalRequest } from '../types';

interface AdminWithdrawal extends WithdrawalRequest {
  user: { telegram_id: number; username: string | null; first_name: string } | null;
}

interface AdminTonPayment extends TonPayment {
  user: { telegram_id: number; username: string | null; first_name: string } | null;
}

interface AdminReferral {
  id: string;
  status: string;
  reward_amount: number;
  created_at: string;
  referrer: { telegram_id: number; username: string | null; first_name: string } | null;
  referee: { telegram_id: number; username: string | null; first_name: string; tasks_completed: number } | null;
}

type Tab = 'users' | 'withdrawals' | 'transactions' | 'referrals' | 'settings' | 'export';

export function AdminPage() {
  const { user } = useApp();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('users');
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [tonPayments, setTonPayments] = useState<AdminTonPayment[]>([]);
  const [referrals, setReferrals] = useState<AdminReferral[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [updating, setUpdating] = useState(false);

  // Settings form state
  const [settingsForm, setSettingsForm] = useState<Partial<AppSettings>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [usersRes, wRes, txRes, refRes, sRes] = await Promise.all([
      callEdgeFunction<{ users: UserProfile[] }>(`api/admin/users${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}`, { method: 'GET' }),
      callEdgeFunction<{ withdrawals: AdminWithdrawal[] }>('api/admin/withdrawals', { method: 'GET' }),
      callEdgeFunction<{ tonPayments: AdminTonPayment[]; auditLogs: AdminAuditLog[] }>('api/admin/transactions', { method: 'GET' }),
      callEdgeFunction<{ referrals: AdminReferral[] }>('api/admin/referrals', { method: 'GET' }),
      callEdgeFunction<{ settings: AppSettings }>('api/admin/settings', { method: 'GET' }),
    ]);

    if (usersRes.data) setUsers(usersRes.data.users);
    if (wRes.data) setWithdrawals(wRes.data.withdrawals);
    if (txRes.data) {
      setTonPayments(txRes.data.tonPayments);
      setAuditLogs(txRes.data.auditLogs);
    }
    if (refRes.data) setReferrals(refRes.data.referrals);
    if (sRes.data) {
      setSettings(sRes.data.settings);
      setSettingsForm(sRes.data.settings);
    }
    setLoading(false);
  }, [searchQuery]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (!user) return <LoadingSpinner />;
  if (!user.is_admin) {
    return (
      <div className="glass-card text-center" style={{ padding: 40 }}>
        <Shield size={40} style={{ color: 'var(--error)', margin: '0 auto 12px' }} />
        <p className="text-error font-bold">Access Denied</p>
        <p className="text-sm text-muted mt-8">You do not have administrator privileges.</p>
      </div>
    );
  }

  if (loading) return <LoadingSpinner />;

  const handleSearch = () => {
    setSearchQuery(searchInput);
  };

  const handleUpdateWithdrawal = async (id: string, status: string, txHash?: string) => {
    setUpdating(true);
    hapticImpact('heavy');
    const body: Record<string, unknown> = { withdrawal_id: id, status };
    if (txHash !== undefined) body.cardano_tx_hash = txHash;
    const { error } = await callEdgeFunction('api/admin/withdrawals/update', { method: 'POST', body });
    setUpdating(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast(`Withdrawal ${status}`, 'success');
    fetchAll();
  };

  const handleSaveSettings = async () => {
    setUpdating(true);
    hapticImpact('medium');
    const { error } = await callEdgeFunction('api/admin/settings', { method: 'POST', body: settingsForm });
    setUpdating(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast('Settings updated successfully', 'success');
    fetchAll();
  };

  const handleExport = async () => {
    hapticImpact('medium');
    const { data, error } = await callEdgeFunction<Record<string, unknown[]>>('api/admin/export', { method: 'GET' });
    if (error) {
      showToast(error, 'error');
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ada-neon-miner-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export downloaded', 'success');
  };

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'users', label: 'Users', icon: Users },
    { key: 'withdrawals', label: 'Withdrawals', icon: ArrowDownToLine },
    { key: 'transactions', label: 'Payments', icon: CreditCard },
    { key: 'referrals', label: 'Referrals', icon: Share2 },
    { key: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const setField = (field: keyof AppSettings, value: string | number | boolean) => {
    setSettingsForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="flex flex-col gap-12">
      <div className="section-title">
        <Shield className="icon" size={18} /> Admin Panel
      </div>

      {/* Tab selector */}
      <div className="flex gap-8" style={{ overflowX: 'auto', paddingBottom: 4 }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { hapticImpact('light'); setTab(key); }}
            className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
            style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
        <button onClick={handleExport} className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}>
          <FileDown size={14} /> Export
        </button>
      </div>

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="flex flex-col gap-12">
          <div className="flex gap-8">
            <input
              className="input-field"
              placeholder="Search by Telegram ID or username"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn btn-secondary btn-sm" onClick={handleSearch} style={{ width: 'auto' }}>
              <Search size={16} />
            </button>
          </div>
          {users.length > 0 ? (
            <div className="flex flex-col gap-8">
              {users.map((u) => (
                <div key={u.id} className="glass-card compact">
                  <InfoRow label="Telegram ID" value={u.telegram_id} />
                  <InfoRow label="Username" value={u.username || 'N/A'} />
                  <InfoRow label="Name" value={`${u.first_name} ${u.last_name || ''}`} />
                  <InfoRow label="Balance" value={`${Number(u.balance).toFixed(2)} ADA`} />
                  <InfoRow label="Referrals" value={u.total_referrals} />
                  <InfoRow label="Tasks" value={u.tasks_completed} />
                  <InfoRow label="Withdrawal" value={u.withdrawal_eligible ? 'Eligible' : 'Not Eligible'} />
                  <InfoRow label="Joined" value={new Date(u.created_at).toLocaleDateString()} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No users found" />
          )}
        </div>
      )}

      {/* Withdrawals Tab */}
      {tab === 'withdrawals' && (
        <div className="flex flex-col gap-12">
          {withdrawals.length > 0 ? (
            withdrawals.map((w) => (
              <div key={w.id} className="glass-card compact">
                <div className="flex items-center justify-between mb-12">
                  <span className="text-xs text-muted">
                    {w.user?.first_name || 'Unknown'} (ID: {w.user?.telegram_id || 'N/A'})
                  </span>
                  <WithdrawalStatusBadge status={w.status} />
                </div>
                <InfoRow label="Amount" value={`${Number(w.amount_ada).toFixed(2)} ADA`} />
                <InfoRow label="Wallet" value={w.cardano_address.substring(0, 25) + '...'} mono />
                {w.cardano_tx_hash && <InfoRow label="TX Hash" value={w.cardano_tx_hash.substring(0, 25) + '...'} mono />}
                {w.admin_note && <InfoRow label="Note" value={w.admin_note} />}
                <InfoRow label="Date" value={new Date(w.created_at).toLocaleDateString()} />

                {(w.status === 'pending' || w.status === 'under_review') && (
                  <div className="flex gap-8 mt-12">
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => handleUpdateWithdrawal(w.id, 'approved')}
                      disabled={updating}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleUpdateWithdrawal(w.id, 'rejected')}
                      disabled={updating}
                    >
                      Reject
                    </button>
                  </div>
                )}

                {w.status === 'approved' && (
                  <div className="flex gap-8 mt-12">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        const hash = prompt('Enter Cardano transaction hash:');
                        if (hash) handleUpdateWithdrawal(w.id, 'paid', hash);
                      }}
                      disabled={updating}
                    >
                      Mark Paid
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <EmptyState text="No withdrawal requests" />
          )}
        </div>
      )}

      {/* Transactions Tab */}
      {tab === 'transactions' && (
        <div className="flex flex-col gap-12">
          <div className="section-title" style={{ margin: 0 }}>
            <CreditCard className="icon" size={16} /> TON Payments
          </div>
          {tonPayments.length > 0 ? (
            tonPayments.map((p) => (
              <div key={p.id} className="glass-card compact">
                <div className="flex items-center justify-between mb-12">
                  <span className="text-xs text-muted">
                    {p.user?.first_name || 'Unknown'} (ID: {p.user?.telegram_id})
                  </span>
                  <PaymentStatusBadge status={p.status} />
                </div>
                <InfoRow label="Amount" value={`${p.amount_ton} TON`} />
                <InfoRow label="Payment Ref" value={p.payment_ref} mono />
                {p.tx_hash && <InfoRow label="TX Hash" value={p.tx_hash.substring(0, 25) + '...'} mono />}
                <InfoRow label="Wallet" value={p.receiving_wallet.substring(0, 25) + '...'} mono />
                <InfoRow label="Date" value={new Date(p.created_at).toLocaleDateString()} />
              </div>
            ))
          ) : (
            <EmptyState text="No TON payments" />
          )}

          {/* Audit logs */}
          {auditLogs.length > 0 && (
            <div className="glass-card">
              <div className="section-title" style={{ margin: '0 0 12px 0' }}>
                <Shield className="icon" size={16} /> Audit Log
              </div>
              <div className="flex flex-col gap-8">
                {auditLogs.map((log) => (
                  <div key={log.id} className="info-row">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold">{log.action}</span>
                      {log.details && <span className="text-xs text-muted">{log.details.substring(0, 60)}</span>}
                    </div>
                    <span className="text-xs text-muted">{new Date(log.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Referrals Tab */}
      {tab === 'referrals' && (
        <div className="flex flex-col gap-12">
          {referrals.length > 0 ? (
            referrals.map((r) => (
              <div key={r.id} className="glass-card compact">
                <div className="flex items-center justify-between mb-12">
                  <span className="text-sm">
                    {r.referrer?.first_name || 'Unknown'} → {r.referee?.first_name || 'Unknown'}
                  </span>
                  <span className={`withdrawal-status ${r.status === 'qualified' ? 'paid' : 'pending'}`}>
                    {r.status}
                  </span>
                </div>
                <InfoRow label="Referrer ID" value={r.referrer?.telegram_id || 'N/A'} />
                <InfoRow label="Referee ID" value={r.referee?.telegram_id || 'N/A'} />
                <InfoRow label="Reward" value={`+${Number(r.reward_amount).toFixed(2)} ADA`} />
                <InfoRow label="Referee Tasks" value={r.referee?.tasks_completed || 0} />
                <InfoRow label="Date" value={new Date(r.created_at).toLocaleDateString()} />
              </div>
            ))
          ) : (
            <EmptyState text="No referrals" />
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && settings && (
        <div className="flex flex-col gap-12">
          {/* Tap settings */}
          <div className="glass-card">
            <div className="section-title" style={{ margin: '0 0 12px 0' }}>Tap Mining</div>
            <div className="flex flex-col gap-12">
              <div>
                <label className="input-label">Tap Reward (points per tap)</label>
                <input className="input-field" type="number" step="0.1" min="0" value={settingsForm.tap_reward ?? ''} onChange={(e) => setField('tap_reward', Number(e.target.value))} />
              </div>
              <div>
                <label className="input-label">Daily Tap Limit</label>
                <input className="input-field" type="number" min="1" value={settingsForm.tap_daily_limit ?? ''} onChange={(e) => setField('tap_daily_limit', Number(e.target.value))} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Pause Tap Mining</span>
                <button
                  className={`status-badge ${settingsForm.tap_paused ? 'disconnected' : 'connected'}`}
                  onClick={() => setField('tap_paused', !settingsForm.tap_paused)}
                >
                  {settingsForm.tap_paused ? 'Paused' : 'Active'}
                </button>
              </div>
            </div>
          </div>

          {/* Mining settings */}
          <div className="glass-card">
            <div className="section-title" style={{ margin: '0 0 12px 0' }}>Passive Mining</div>
            <div className="flex flex-col gap-12">
              <div>
                <label className="input-label">Mining Rate (points/hour)</label>

              <div className="info-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <span className="info-label">Daily check-in reward</span>
                <input className="input-field" type="number" step="0.1" min="0" value={settingsForm.checkin_reward ?? ''} onChange={(e) => setField('checkin_reward', Number(e.target.value))} />
              </div>
                <input className="input-field" type="number" step="0.01" value={settingsForm.mining_rate ?? ''} onChange={(e) => setField('mining_rate', Number(e.target.value))} />
              </div>
              <div>
                <label className="input-label">Mining Duration (hours)</label>
                <input className="input-field" type="number" value={settingsForm.mining_duration_hours ?? ''} onChange={(e) => setField('mining_duration_hours', Number(e.target.value))} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Pause Mining</span>
                <button
                  className={`status-badge ${settingsForm.mining_paused ? 'disconnected' : 'connected'}`}
                  onClick={() => setField('mining_paused', !settingsForm.mining_paused)}
                >
                  {settingsForm.mining_paused ? 'Paused' : 'Active'}
                </button>
              </div>
            </div>
          </div>

          {/* Referral settings */}
          <div className="glass-card">
            <div className="section-title" style={{ margin: '0 0 12px 0' }}>Referrals</div>
            <div className="flex flex-col gap-12">
              <div>
                <label className="input-label">Referral Reward (ADA Points)</label>
                <input className="input-field" type="number" step="0.01" value={settingsForm.referral_reward ?? ''} onChange={(e) => setField('referral_reward', Number(e.target.value))} />
              </div>
              <div>
                <label className="input-label">Qualification Tasks Required</label>
                <input className="input-field" type="number" value={settingsForm.referral_qualification_tasks ?? ''} onChange={(e) => setField('referral_qualification_tasks', Number(e.target.value))} />
              </div>
            </div>
          </div>

          {/* Withdrawal settings */}
          <div className="glass-card">
            <div className="section-title" style={{ margin: '0 0 12px 0' }}>Withdrawals</div>
            <div className="flex flex-col gap-12">
              <div>
                <label className="input-label">Minimum Withdrawal (ADA)</label>
                <input className="input-field" type="number" step="0.1" value={settingsForm.min_withdrawal_ada ?? ''} onChange={(e) => setField('min_withdrawal_ada', Number(e.target.value))} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Pause Withdrawals</span>
                <button
                  className={`status-badge ${settingsForm.withdrawals_paused ? 'disconnected' : 'connected'}`}
                  onClick={() => setField('withdrawals_paused', !settingsForm.withdrawals_paused)}
                >
                  {settingsForm.withdrawals_paused ? 'Paused' : 'Active'}
                </button>
              </div>
            </div>
          </div>

          {/* TON settings */}
          <div className="glass-card">
            <div className="section-title" style={{ margin: '0 0 12px 0' }}>TON Payment</div>
            <div className="flex flex-col gap-12">
              <div>
                <label className="input-label">TON Payment Amount</label>
                <input className="input-field" type="number" step="0.01" value={settingsForm.ton_payment_amount ?? ''} onChange={(e) => setField('ton_payment_amount', Number(e.target.value))} />
              </div>
              <div>
                <label className="input-label">TON Receiving Wallet</label>
                <input className="input-field" value={settingsForm.ton_receiving_wallet ?? ''} onChange={(e) => setField('ton_receiving_wallet', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Cardano settings */}
          <div className="glass-card">
            <div className="section-title" style={{ margin: '0 0 12px 0' }}>Cardano</div>
            <div className="flex flex-col gap-12">
              <div>
                <label className="input-label">Cardano Reward Wallet</label>
                <input className="input-field" value={settingsForm.cardano_reward_wallet ?? ''} onChange={(e) => setField('cardano_reward_wallet', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Channel & YouTube settings */}
          <div className="glass-card">
            <div className="section-title" style={{ margin: '0 0 12px 0' }}>Tasks & Channels</div>
            <div className="flex flex-col gap-12">
              <div>
                <label className="input-label">Bot Username</label>
                <input className="input-field" value={settingsForm.bot_username ?? ''} onChange={(e) => setField('bot_username', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Channel 1 URL</label>
                <input className="input-field" value={settingsForm.channel_1_url ?? ''} onChange={(e) => setField('channel_1_url', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Channel 1 Title</label>
                <input className="input-field" value={settingsForm.channel_1_title ?? ''} onChange={(e) => setField('channel_1_title', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Channel 1 Reward</label>
                <input className="input-field" type="number" step="0.1" value={settingsForm.channel_1_reward ?? ''} onChange={(e) => setField('channel_1_reward', Number(e.target.value))} />
              </div>
              <div>
                <label className="input-label">Channel 2 URL</label>
                <input className="input-field" value={settingsForm.channel_2_url ?? ''} onChange={(e) => setField('channel_2_url', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Channel 2 Title</label>
                <input className="input-field" value={settingsForm.channel_2_title ?? ''} onChange={(e) => setField('channel_2_title', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Channel 2 Reward</label>
                <input className="input-field" type="number" step="0.1" value={settingsForm.channel_2_reward ?? ''} onChange={(e) => setField('channel_2_reward', Number(e.target.value))} />
              </div>
              <div>
                <label className="input-label">YouTube URL</label>
                <input className="input-field" value={settingsForm.youtube_url ?? ''} onChange={(e) => setField('youtube_url', e.target.value)} />
              </div>
              <div>
                <label className="input-label">YouTube Title</label>
                <input className="input-field" value={settingsForm.youtube_title ?? ''} onChange={(e) => setField('youtube_title', e.target.value)} />
              </div>
              <div>
                <label className="input-label">YouTube Reward</label>
                <input className="input-field" type="number" step="0.1" value={settingsForm.youtube_reward ?? ''} onChange={(e) => setField('youtube_reward', Number(e.target.value))} />
              </div>
              <div>
                <label className="input-label">YouTube Channel ID (for subscription verification)</label>
                <input
                  className="input-field"
                  placeholder="e.g. UCxxxxxxxxxxxxxxxxxxxxxx"
                  value={settingsForm.youtube_channel_id ?? ''}
                  onChange={(e) => setField('youtube_channel_id', e.target.value)}
                />
                <p className="text-xs text-muted mt-8">
                  Find your Channel ID in YouTube Studio &rarr; Settings &rarr; Channel &rarr; Advanced Settings.
                </p>
              </div>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleSaveSettings} disabled={updating}>
            {updating ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Saving...</>
            ) : (
              <>Save All Settings</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
