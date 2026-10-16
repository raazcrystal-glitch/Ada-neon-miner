import { useState, useEffect, useCallback } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import {
  Wallet,
  ArrowDownToLine,
  CheckCircle2,
  Copy,
  Link2,
  Info,
  ShieldCheck,
  Clock3,
  CircleAlert,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact, hapticNotification } from '../lib/telegram';
import { InfoRow, PaymentStatusBadge, WithdrawalStatusBadge } from '../components/ui';
import { LoadingSpinner } from '../components/Layout';
import type { TonPayment, UserWallet, WithdrawalRequest } from '../types';

interface WalletData {
  wallet: UserWallet | null;
  tonPayments: TonPayment[];
  withdrawals: WithdrawalRequest[];
  withdrawalEligible: boolean;
  balance: number;
  pendingBalance: number;
}

function shortenAddress(address: string | null | undefined) {
  if (!address) return 'Not connected';
  if (address.length < 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-5)}`;
}

export function WalletPage() {
  const { user, settings, refresh } = useApp();
  const { showToast } = useToast();
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [txHash, setTxHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [cardanoAddr, setCardanoAddr] = useState('');
  const [savingWallet, setSavingWallet] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [tonBalance, setTonBalance] = useState<number | null>(null);
  const [tonConnectUI] = useTonConnectUI();
  const connectedWallet = useTonWallet();

  const fetchData = useCallback(async () => {
    const { data: result, error } = await callEdgeFunction<WalletData>('api/wallet', { method: 'GET' });
    if (error || !result) {
      setLoading(false);
      return;
    }
    setData(result);
    if (result.wallet?.cardano_address) setCardanoAddr(result.wallet.cardano_address);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const address = connectedWallet?.account.address;
    if (!address) {
      setTonBalance(null);
      return;
    }

    let cancelled = false;
    fetch(`https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(address)}`)
      .then((response) => response.ok ? response.json() as Promise<{ ok?: boolean; result?: string }> : null)
      .then((result) => {
        if (!cancelled && result?.ok && typeof result.result === 'string') {
          setTonBalance(Number(result.result) / 1_000_000_000);
        }
      })
      .catch(() => {
        if (!cancelled) setTonBalance(null);
      });

    void callEdgeFunction('api/wallet/ton', {
      method: 'POST',
      body: { ton_address: address },
    });

    return () => { cancelled = true; };
  }, [connectedWallet?.account.address]);

  if (!user || !settings) return <LoadingSpinner />;
  if (loading || !data) return <LoadingSpinner />;

  const verificationAmount = Number(settings.ton_payment_amount || 0.2).toFixed(1);
  const hasVerifiedPayment = data.tonPayments.some((payment) => payment.status === 'verified');
  const pendingPayment = data.tonPayments.some((payment) => payment.status === 'pending');
  const tonAddress = connectedWallet?.account.address || data.wallet?.ton_address;

  const handleConnectTon = () => {
    hapticImpact('medium');
    void tonConnectUI.openModal();
  };

  const handleDisconnectTon = async () => {
    hapticImpact('medium');
    await tonConnectUI.disconnect();
    await callEdgeFunction('api/wallet/ton', { method: 'DELETE' });
    await fetchData();
  };

  const handleVerifyPayment = async () => {
    if (!txHash.trim()) {
      showToast('Enter the TON transaction hash first.', 'error');
      return;
    }
    setVerifying(true);
    hapticImpact('medium');
    const { error } = await callEdgeFunction('api/ton-payment/verify', {
      method: 'POST',
      body: { tx_hash: txHash.trim() },
    });
    setVerifying(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast('The payment was confirmed on the TON blockchain.', 'success');
    setTxHash('');
    await refresh();
    await fetchData();
  };

  const handleSaveWallet = async () => {
    if (!cardanoAddr.trim() || cardanoAddr.trim().length < 20) {
      showToast('Enter a valid Cardano wallet address.', 'error');
      return;
    }
    setSavingWallet(true);
    hapticImpact('medium');
    const { error } = await callEdgeFunction('api/wallet/register', {
      method: 'POST',
      body: { cardano_address: cardanoAddr.trim() },
    });
    setSavingWallet(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast('Withdrawal wallet saved.', 'success');
    fetchData();
  };

  const handleWithdraw = async () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) {
      showToast('Enter a valid withdrawal amount.', 'error');
      return;
    }
    if (amount < Number(settings.min_withdrawal_ada)) {
      showToast(`Minimum withdrawal is ${settings.min_withdrawal_ada} ADA.`, 'error');
      return;
    }
    setWithdrawing(true);
    hapticImpact('heavy');
    const { error } = await callEdgeFunction('api/withdrawals/create', {
      method: 'POST',
      body: { amount },
    });
    setWithdrawing(false);
    if (error) {
      hapticNotification('error');
      showToast(error, 'error');
      return;
    }
    hapticNotification('success');
    showToast('Withdrawal request submitted for review.', 'success');
    setWithdrawAmount('');
    await refresh();
    await fetchData();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    hapticImpact('light');
    showToast('Address copied.', 'info');
  };

  return (
    <div className="wallet-page flex flex-col gap-12">
      <div className="wallet-heading">
        <div>
          <span className="wallet-eyebrow">Your rewards</span>
          <h1>Vault</h1>
        </div>
        <div className="wallet-heading-icon"><Wallet size={22} /></div>
      </div>

      <section className="wallet-balance-card">
        <div className="wallet-card-shine" />
        <div className="wallet-balance-label">Combined holding · decides your level</div>
        <div className="wallet-balance-value"><span className="wallet-coin">A</span>{Number(data.balance).toFixed(2)}</div>
        <div className="wallet-balance-sub">ADA Points · Level {user.tasks_completed + 1}</div>
        <div className="wallet-balance-grid">
          <div>
            <span>In-app</span>
            <strong>{Number(data.balance).toFixed(2)}</strong>
            <small>Available rewards</small>
          </div>
          <div>
            <span>Pending</span>
            <strong>{Number(data.pendingBalance).toFixed(2)}</strong>
            <small>Awaiting settlement</small>
          </div>
        </div>
      </section>

      <section className="ton-wallet-card">
        <div className="wallet-section-title">TON Wallet</div>
        <div className="ton-wallet-row">
          <div className="ton-wallet-icon"><Wallet size={26} /></div>
          <div className="ton-wallet-copy">
            <strong>{tonAddress ? 'Connected' : 'Connect wallet'}</strong>
            <span>{shortenAddress(tonAddress)}</span>
            {tonBalance !== null && <small>{tonBalance.toFixed(3)} TON</small>}
          </div>
          {tonAddress ? (
            <button className="icon-button" onClick={handleDisconnectTon} aria-label="Disconnect TON wallet">
              <span className="disconnect-label">Disconnect</span>
            </button>
          ) : (
            <button className="ton-connect-button" onClick={handleConnectTon}>Connect</button>
          )}
        </div>
        {!tonAddress && <p className="wallet-note">Choose Tonkeeper or Telegram Wallet from the secure TON Connect picker. No seed phrase or private key is requested.</p>}
      </section>

      <section className={`verification-card ${hasVerifiedPayment ? 'verified' : ''}`}>
        <div className="verification-topline">
          <div className={`verification-icon ${hasVerifiedPayment ? 'success' : pendingPayment ? 'pending' : ''}`}>
            {hasVerifiedPayment ? <ShieldCheck size={25} /> : pendingPayment ? <Clock3 size={25} /> : <CircleAlert size={25} />}
          </div>
          <div>
            <h2>{hasVerifiedPayment ? 'Wallet verified' : pendingPayment ? 'Verification pending' : 'Verify your wallet'}</h2>
            <p>{hasVerifiedPayment ? 'Withdrawals and referral rewards are unlocked.' : 'Required before withdrawals and referral rewards.'}</p>
          </div>
          <Info size={18} className="verification-info" />
        </div>

        <div className="verification-checks">
          <div className="verification-check complete"><CheckCircle2 size={21} /><span>Wallet identity recorded</span></div>
          <div className="verification-check"><Clock3 size={21} /><span>{hasVerifiedPayment ? 'TON blockchain confirmed' : 'TON transaction confirmation required'}</span></div>
          <div className="verification-check"><ShieldCheck size={21} /><span>One-time {verificationAmount} TON verification</span></div>
        </div>

        {!hasVerifiedPayment && (
          <>
            <div className="verification-details">
              <InfoRow label="Exact amount" value={`${verificationAmount} TON`} />
              <InfoRow label="Network" value="The Open Network (TON)" />
              <InfoRow label="Recipient" value={settings.ton_receiving_wallet || 'Not configured'} mono />
            </div>
            <p className="wallet-warning"><Info size={15} /> Review the recipient and amount before approving. Never share a seed phrase or private key.</p>
            <div className="verification-input-wrap">
              <label className="input-label" htmlFor="ton-tx-hash">Transaction hash</label>
              <input
                id="ton-tx-hash"
                className="input-field"
                placeholder="Paste the confirmed TON transaction hash"
                value={txHash}
                onChange={(event) => setTxHash(event.target.value)}
              />
            </div>
            <button className="btn verify-button" onClick={handleVerifyPayment} disabled={verifying || !txHash.trim()}>
              {verifying ? <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Checking blockchain...</> : <><ShieldCheck size={19} /> Verify for {verificationAmount} TON</>}
            </button>
            <p className="wallet-note centered">A button click or initiated transfer does not verify a wallet. Verification only completes after the server confirms the actual TON transaction.</p>
          </>
        )}
      </section>

      {hasVerifiedPayment && (
        <section className="withdrawal-card">
          <div className="wallet-section-title"><ArrowDownToLine size={18} /> Withdraw rewards</div>
          {!data.wallet?.cardano_address ? (
            <>
              <p className="wallet-note">Add the Cardano wallet that should receive approved withdrawals.</p>
              <input className="input-field mt-12" placeholder="addr1..." value={cardanoAddr} onChange={(event) => setCardanoAddr(event.target.value)} />
              <button className="btn btn-primary mt-12" onClick={handleSaveWallet} disabled={savingWallet || !cardanoAddr.trim()}>
                {savingWallet ? 'Saving...' : 'Save withdrawal wallet'}
              </button>
            </>
          ) : (
            <>
              <div className="saved-address"><Link2 size={16} /><span>{shortenAddress(data.wallet.cardano_address)}</span><button onClick={() => copyToClipboard(data.wallet!.cardano_address!)}><Copy size={15} /></button></div>
              {settings.withdrawals_paused ? <p className="wallet-note">Withdrawals are temporarily paused by the administrator.</p> : <>
                <input className="input-field mt-12" type="number" min="0" placeholder={`Minimum ${settings.min_withdrawal_ada} ADA`} value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} />
                <button className="btn btn-primary mt-12" onClick={handleWithdraw} disabled={withdrawing || !withdrawAmount}>{withdrawing ? 'Submitting...' : 'Request withdrawal'}</button>
              </>}
            </>
          )}
        </section>
      )}

      {data.tonPayments.length > 0 && (
        <section className="wallet-history-card">
          <div className="wallet-section-title"><RefreshCw size={17} /> Payment history</div>
          {data.tonPayments.map((payment) => (
            <div className="history-row" key={payment.id}>
              <div><strong>{payment.amount_ton} TON verification</strong><span>{new Date(payment.created_at).toLocaleDateString()}</span></div>
              <PaymentStatusBadge status={payment.status} />
            </div>
          ))}
        </section>
      )}

      {data.withdrawals.length > 0 && (
        <section className="wallet-history-card">
          <div className="wallet-section-title"><ArrowDownToLine size={17} /> Withdrawal history</div>
          {data.withdrawals.map((withdrawal) => (
            <div className="history-row" key={withdrawal.id}>
              <div><strong>{Number(withdrawal.amount_ada).toFixed(2)} ADA</strong><span>{new Date(withdrawal.created_at).toLocaleDateString()}</span></div>
              <WithdrawalStatusBadge status={withdrawal.status} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
