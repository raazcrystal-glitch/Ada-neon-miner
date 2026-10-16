import { useState, useCallback, useRef } from 'react';

interface FloatingLabel {
  id: number;
  x: number;
  y: number;
}

interface AdapCoinProps {
  onTap?: (e: React.MouseEvent | React.TouchEvent) => void;
  tapping?: boolean;
  tapReward?: number;
}

/** Cardano ADA symbol: central dot + concentric rings of dots */
function AdaSymbol({ size = 72 }: { size?: number }) {
  const cx = 50;
  const cy = 42;
  const outerR = 22;
  const innerR = 12;
  const outer = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI * 2) / 8 - Math.PI / 2;
    return { x: cx + outerR * Math.cos(a), y: cy + outerR * Math.sin(a) };
  });
  const inner = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI * 2) / 6 - Math.PI / 2;
    return { x: cx + innerR * Math.cos(a), y: cy + innerR * Math.sin(a) };
  });

  return (
    <svg
      className="ada-symbol"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#a8f0ff" />
          <stop offset="100%" stopColor="#00d4ff" />
        </radialGradient>
        <filter id="dotSoft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r="4.5" fill="url(#dotGlow)" filter="url(#dotSoft)" />
      {inner.map((p, i) => (
        <circle key={`i${i}`} cx={p.x} cy={p.y} r="3.2" fill="url(#dotGlow)" filter="url(#dotSoft)" />
      ))}
      {outer.map((p, i) => (
        <circle key={`o${i}`} cx={p.x} cy={p.y} r="3.6" fill="url(#dotGlow)" filter="url(#dotSoft)" />
      ))}
    </svg>
  );
}

export function AdapCoin({ onTap, tapping, tapReward = 1 }: AdapCoinProps) {
  const [floaters, setFloaters] = useState<FloatingLabel[]>([]);
  const [pressed, setPressed] = useState(false);
  const counterRef = useRef(0);
  const lastInteractRef = useRef(0);

  const handleInteraction = useCallback(
    (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
      if (!onTap) return;
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-fire from touch + click / multiple pointer events
      const now = Date.now();
      if (now - lastInteractRef.current < 350) return;
      lastInteractRef.current = now;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      let clientX: number;
      let clientY: number;
      if ('touches' in e && (e as React.TouchEvent).touches.length > 0) {
        clientX = (e as React.TouchEvent).touches[0].clientX;
        clientY = (e as React.TouchEvent).touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as React.PointerEvent).clientX;
        clientY = (e as React.PointerEvent).clientY;
      } else {
        clientX = rect.left + rect.width / 2;
        clientY = rect.top + rect.height / 2;
      }

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const id = ++counterRef.current;
      setFloaters((prev) => [...prev, { id, x, y }]);
      setTimeout(() => setFloaters((prev) => prev.filter((f) => f.id !== id)), 900);

      setPressed(true);
      setTimeout(() => setPressed(false), 140);

      onTap(e as React.MouseEvent | React.TouchEvent);
    },
    [onTap],
  );

  return (
    <div className="coin-container">
      <div
        className={`coin-wrapper${tapping ? ' is-tapping' : ''}${pressed ? ' is-pressed' : ''}`}
        style={{ cursor: onTap ? 'pointer' : 'default', userSelect: 'none', touchAction: 'manipulation' }}
        onPointerDown={onTap ? handleInteraction : undefined}
        role={onTap ? 'button' : undefined}
        tabIndex={onTap ? 0 : undefined}
        aria-label={onTap ? 'Tap to mine ADA Points' : undefined}
        onKeyDown={
          onTap
            ? (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  handleInteraction(ev as unknown as React.PointerEvent);
                }
              }
            : undefined
        }
      >
        <div className="coin-aura coin-aura-outer" />
        <div className="coin-aura coin-aura-mid" />
        <div className="coin-aura coin-aura-core" />

        <div className="coin-rays" aria-hidden="true">
          <span className="ray ray-1" />
          <span className="ray ray-2" />
          <span className="ray ray-3" />
          <span className="ray ray-4" />
          <span className="ray ray-5" />
          <span className="ray ray-6" />
          <span className="ray ray-7" />
          <span className="ray ray-8" />
        </div>

        <div className="coin-lightning l1" aria-hidden="true" />
        <div className="coin-lightning l2" aria-hidden="true" />
        <div className="coin-lightning l3" aria-hidden="true" />

        <div className="coin-ring r2" />
        <div className="coin-ring r1" />

        <div className="coin">
          <div className="coin-inner-rim" />
          <AdaSymbol size={78} />
          <span className="coin-text">ADA</span>
        </div>

        <div className="coin-spark s1" />
        <div className="coin-spark s2" />
        <div className="coin-spark s3" />
        <div className="coin-spark s4" />
        <div className="coin-spark s5" />
        <div className="coin-spark s6" />

        <div className="coin-floor" aria-hidden="true">
          <span className="floor-ring fr1" />
          <span className="floor-ring fr2" />
          <span className="floor-ring fr3" />
        </div>

        {floaters.map((f) => (
          <div key={f.id} className="tap-floater" style={{ left: f.x, top: f.y }}>
            +{tapReward}
          </div>
        ))}
      </div>

      {onTap && <div className="tap-hint">Tap to earn ADA Points</div>}
    </div>
  );
}
