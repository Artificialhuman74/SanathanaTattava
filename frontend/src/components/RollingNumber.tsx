import React, { useEffect, useState } from 'react';

interface RollingNumberProps {
  value: number | string;
  className?: string;
}

export default function RollingNumber({ value, className = '' }: RollingNumberProps) {
  const [current, setCurrent] = useState<number | string>(value);
  const [animClass, setAnimClass] = useState('');

  useEffect(() => {
    if (value === current) return;

    const nextDirection =
      typeof value === 'number' && typeof current === 'number'
        ? value > current
          ? 'up'
          : 'down'
        : 'up';

    setAnimClass(nextDirection === 'up' ? 'animate-roll-in-from-top' : 'animate-roll-in-from-bottom');
    setCurrent(value);

    const timer = setTimeout(() => setAnimClass(''), 260);
    return () => clearTimeout(timer);
  }, [value, current]);

  const widthCh = Math.max(String(current).length, String(value).length, 1) + 0.35;

  return (
    <span
      className={`relative inline-flex h-[1.15em] overflow-hidden items-center justify-center leading-none tabular-nums ${className}`}
      style={{ minWidth: `${widthCh}ch` }}
    >
      <span className={`absolute inset-0 flex items-center justify-center ${animClass}`}>{current}</span>
    </span>
  );
}
