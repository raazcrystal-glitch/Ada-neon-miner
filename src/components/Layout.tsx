import type { ReactNode } from 'react';

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export function AppHeader({ title = 'ADA NEON MINER', subtitle = 'DECENTRALIZED MINING APP' }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="logo">{title}</div>
      <div className="subtitle">{subtitle}</div>
    </header>
  );
}

interface PageContainerProps {
  children: ReactNode;
}

export function PageContainer({ children }: PageContainerProps) {
  return <div className="page-container">{children}</div>;
}

export function LoadingSpinner() {
  return (
    <div className="loading-spinner">
      <div className="spinner" />
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-state">
      <div className="error-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="error-msg">{message}</div>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <div className="empty-text">{text}</div>
    </div>
  );
}
