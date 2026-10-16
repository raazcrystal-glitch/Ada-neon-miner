import { useMemo } from 'react';

export function AnimatedBackground() {
  const particles = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      delay: Math.random() * 8,
      duration: 6 + Math.random() * 6,
    }));
  }, []);

  return (
    <>
      <div className="bg-aura" />
      <div className="bg-particles">
        {particles.map((p) => (
          <span
            key={p.id}
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
            }}
          />
        ))}
      </div>
    </>
  );
}
