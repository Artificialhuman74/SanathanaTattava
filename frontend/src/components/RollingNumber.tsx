import React, { useEffect, useState } from 'react';

interface RollingNumberProps {
  value: number | string;
  className?: string;
}

export default function RollingNumber({ value, className = '' }: RollingNumberProps) {
  const [current, setCurrent] = useState<number | string>(value);
  const [previous, setPrevious] = useState<number | string>(value);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (value === current) return;

    const nextDirection =
      typeof value === 'number' && typeof current === 'number'
        ? value > current
          ? 'up'
          : 'down'
        : 'up';

    setPrevious(current);
    setDirection(nextDirection);
    setCurrent(value);
    setAnimating(true);

    const timer = setTimeout(() => setAnimating(false), 260);
    return () => clearTimeout(timer);
  }, [value, current]);

  const previousAnim = direction === 'up' ? 'animate-roll-out-down' : 'animate-roll-out-up';
  const currentAnim = direction === 'up' ? 'animate-roll-in-from-top' : 'animate-roll-in-from-bottom';
  const widthCh = Math.max(String(current).length, String(previous).length, 1) + 0.35;

  return (
    <span
      className={`relative inline-flex h-[1.15em] overflow-hidden items-center justify-center leading-none tabular-nums ${className}`}
      style={{ minWidth: `${widthCh}ch` }}
    >
      {!animating && (
        <span className="absolute inset-0 flex items-center justify-center">
          {current}
        </span>
      )}
      {animating && (
        <>
          <span className={`absolute inset-0 flex items-center justify-center ${previousAnim}`}>
            {previous}
          </span>
          <span className={`absolute inset-0 flex items-center justify-center ${currentAnim}`}>
            {current}
          </span>
        </>
      )}
    </span>
  );
}
