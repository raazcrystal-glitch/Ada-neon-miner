import { NavLink } from 'react-router-dom';
import { Pickaxe, Wallet, Users, ListChecks, Gem, Shield, Trophy } from 'lucide-react';
import { hapticImpact } from '../lib/telegram';
import { useApp } from '../context/AppContext';

const baseNavItems = [
  { to: '/', icon: Pickaxe, label: 'Mine' },
  { to: '/tasks', icon: ListChecks, label: 'Tasks' },
  { to: '/miners', icon: Gem, label: 'Miners' },
  { to: '/leaderboard', icon: Trophy, label: 'Ranks' },
  { to: '/friends', icon: Users, label: 'Friends' },
  { to: '/wallet', icon: Wallet, label: 'Wallet' },
];

export function BottomNav() {
  const { user } = useApp();

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {baseNavItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          onClick={() => hapticImpact('light')}
        >
          <Icon className="nav-icon" size={20} strokeWidth={2.2} />
          <span className="nav-label">{label}</span>
        </NavLink>
      ))}
      {user?.is_admin && (
        <NavLink to="/admin" className="nav-item admin-nav" onClick={() => hapticImpact('light')}>
          <Shield className="nav-icon" size={18} />
          <span className="nav-label">Admin</span>
        </NavLink>
      )}
    </nav>
  );
}
