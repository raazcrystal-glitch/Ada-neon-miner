import { useState, useEffect, useCallback } from 'react';
import { Trophy, Medal, Crown } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { callEdgeFunction } from '../lib/supabase';
import { hapticImpact } from '../lib/telegram';
import { LoadingSpinner, EmptyState } from '../components/Layout';

interface LeaderRow {
  rank: number;
  userId: string;
  score: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  tasksCompleted: number;
  totalReferrals: number;
  isYou: boolean;
}

export function LeaderboardPage() {
  const { user } = useApp();
  const [period, setPeriod] = useState<'all' | 'daily'>('all');
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchBoard = useCallback(async (p: 'all' | 'daily') => {
    setLoading(true);
    const { data } = await callEdgeFunction<{
      leaders: LeaderRow[];
      myRank: number | null;
      myScore: number;
    }>(`api/leaderboard?period=${p}`, { method: 'GET' });
    if (data) {
      setLeaders(data.leaders || []);
      setMyRank(data.myRank);
      setMyScore(data.myScore);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBoard(period);
  }, [period, fetchBoard]);

  if (!user) return <LoadingSpinner />;

  const medal = (rank: number) => {
    if (rank === 1) return <Crown size={16} style={{ color: '#ffd700' }} />;
    if (rank === 2) return <Medal size={16} style={{ color: '#c0c0c0' }} />;
    if (rank === 3) return <Medal size={16} style={{ color: '#cd7f32' }} />;
    return <span className="text-xs text-muted">#{rank}</span>;
  };

  return (
    <div className="flex flex-col gap-12">
      <div className="section-title">
        <Trophy className="icon" size={18} /> Leaderboard
      </div>

      <div className="flex gap-8">
        <button
          className={`btn btn-sm ${period === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            hapticImpact('light');
            setPeriod('all');
          }}
        >
          All-time
        </button>
        <button
          className={`btn btn-sm ${period === 'daily' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            hapticImpact('light');
            setPeriod('daily');
          }}
        >
          Today
        </button>
      </div>

      <div className="glass-card glow text-center">
        <div className="text-xs text-muted">Your rank</div>
        <div className="font-bold" style={{ fontSize: 28, color: 'var(--neon-cyan)' }}>
          {myRank != null ? `#${myRank}` : '—'}
        </div>
        <div className="text-sm text-muted mt-8">
          {period === 'daily' ? 'Earned today' : 'Balance'}: {Number(myScore).toFixed(2)} ADA Points
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : leaders.length === 0 ? (
        <EmptyState text="No rankings yet. Start mining!" />
      ) : (
        <div className="flex flex-col gap-8">
          {leaders.map((row) => (
            <div
              key={row.userId}
              className={`glass-card compact ${row.isYou ? 'glow' : ''}`}
              style={row.isYou ? { borderColor: 'var(--neon-blue)' } : undefined}
            >
              <div className="flex items-center gap-12">
                <div style={{ width: 28, textAlign: 'center' }}>{medal(row.rank)}</div>
                {row.photoUrl ? (
                  <img
                    src={row.photoUrl}
                    alt=""
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      border: '1px solid var(--neon-blue)',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      background: 'rgba(0,212,255,0.12)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      color: 'var(--neon-cyan)',
                    }}
                  >
                    {(row.firstName || '?')[0]}
                  </div>
                )}
                <div className="flex-1">
                  <div className="font-bold text-sm">
                    {row.firstName}
                    {row.isYou ? ' (You)' : ''}
                  </div>
                  {row.username && <div className="text-xs text-muted">@{row.username}</div>}
                </div>
                <div className="text-right">
                  <div className="font-bold" style={{ color: 'var(--neon-cyan)' }}>
                    {Number(row.score).toFixed(2)}
                  </div>
                  <div className="text-xs text-muted">
                    {row.tasksCompleted} tasks · {row.totalReferrals} refs
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
