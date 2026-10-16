import { Routes, Route } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { AnimatedBackground } from './components/AnimatedBackground';
import { BottomNav } from './components/BottomNav';
import { AppHeader, PageContainer, LoadingSpinner, ErrorState } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { MiningPage } from './pages/MiningPage';
import { WalletPage } from './pages/WalletPage';
import { CommunityPage } from './pages/CommunityPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminPage } from './pages/AdminPage';
import { TasksPage } from './pages/TasksPage';
import { LeaderboardPage } from './pages/LeaderboardPage';

function AppContent() {
  const { loading, error } = useApp();

  return (
    <div className="app-shell">
      <AnimatedBackground />
      <AppHeader />
      <PageContainer>
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorState message={error} />
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/mine" element={<HomePage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/miners" element={<MiningPage />} />
            <Route path="/friends" element={<CommunityPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/mining" element={<MiningPage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        )}
      </PageContainer>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ToastProvider>
  );
}
