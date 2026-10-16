import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';

interface StatusBadgeProps {
  status: 'connected' | 'disconnected' | 'pending';
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`status-badge ${status}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

interface InfoRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function InfoRow({ label, value, mono }: InfoRowProps) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={`info-value ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

interface WithdrawalStatusBadgeProps {
  status: string;
}

export function WithdrawalStatusBadge({ status }: WithdrawalStatusBadgeProps) {
  const icons: Record<string, ReactNode> = {
    pending: <Clock size={12} />,
    under_review: <Clock size={12} />,
    approved: <CheckCircle2 size={12} />,
    processing: <Clock size={12} />,
    paid: <CheckCircle2 size={12} />,
    rejected: <XCircle size={12} />,
  };
  const labels: Record<string, string> = {
    pending: 'Pending',
    under_review: 'Under Review',
    approved: 'Approved',
    processing: 'Processing',
    paid: 'Paid',
    rejected: 'Rejected',
  };
  return (
    <span className={`withdrawal-status ${status}`}>
      {icons[status]}
      {labels[status] || status}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string }) {
  if (status === 'verified') {
    return (
      <span className="status-badge connected">
        <span className="dot" />
        Verified
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="status-badge disconnected">
        <span className="dot" />
        Rejected
      </span>
    );
  }
  return (
    <span className="status-badge pending">
      <span className="dot" />
      Pending
    </span>
  );
}

interface ErrorBannerProps {
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="glass-card" style={{ borderColor: 'rgba(255,71,87,0.3)', padding: '12px 16px' }}>
      <div className="flex items-center gap-8" style={{ color: 'var(--error)' }}>
        <AlertCircle size={18} />
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}
