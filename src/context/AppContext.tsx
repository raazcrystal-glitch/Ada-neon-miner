import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { UserProfile, AppSettings, TaskItem, UserWallet } from '../types';
import { callEdgeFunction } from '../lib/supabase';
import { initTelegram, getStartParam, getTelegramUser } from '../lib/telegram';

interface AppContextValue {
  user: UserProfile | null;
  settings: AppSettings | null;
  tasks: TaskItem[];
  wallet: UserWallet | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateUser: (partial: Partial<UserProfile>) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    initTelegram();
    const startParam = getStartParam();
    let tgUser = getTelegramUser();

    // Preview fallback: create a mock user when not running inside Telegram
    if (!tgUser) {
      tgUser = {
        id: 999999999,
        first_name: 'Preview',
        last_name: 'User',
        username: 'preview_user',
      };
    }

    const { data, error: apiErr } = await callEdgeFunction<{
      user: UserProfile;
      settings: AppSettings;
      tasks: TaskItem[];
      wallet: UserWallet | null;
    }>('api/auth', { method: 'POST', body: { start_param: startParam } });

    if (apiErr || !data) {
      setError(apiErr || 'Failed to connect to server');
      setLoading(false);
      return;
    }

    setUser(data.user);
    setSettings(data.settings);
    setTasks(data.tasks);
    setWallet(data.wallet);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateUser = useCallback((partial: Partial<UserProfile>) => {
    setUser((prev) => prev ? { ...prev, ...partial } : prev);
  }, []);

  return (
    <AppContext.Provider value={{ user, settings, tasks, wallet, loading, error, refresh, updateUser }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
