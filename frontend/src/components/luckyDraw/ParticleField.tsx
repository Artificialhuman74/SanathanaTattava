import React, { useEffect, useRef } from 'react';

interface ParticleFieldProps {
  size?: number;
  /** 'converge' — scattered gold particles assemble into the chakra wheel (win reveal).
   *  'burst' — a quick outward sparkle burst (join tap). */
  mode: 'converge' | 'burst';
  active: boolean;
  onSettled?: () => void;
  className?: string;
}

interface Particle {
  x: number; y: number;
  startX: number; startY: number;
  targetX: number; targetY: number;
  delay: number;
  size: number;
  angle: number;   // burst mode only
  distance: number; // burst mode only
}

const GOLD = ['#e8b86d', '#c8963c', '#f0d898', '#a87830'];

/** Ease-out-expo — matches this app's existing motion language (chakra-spin-settle), no bounce. */
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Sample points that trace the ChakraIcon's own geometry (rim + 8 spokes + hub), scaled to `size`. */
function chakraTargetPoints(size: number, count: number): { x: number; y: number }[] {
  const cx = size / 2, cy = size / 2;
  const rimR = size * 0.44, spokeR = size * 0.38, hubR = size * 0.1;
  const points: { x: number; y: number }[] = [];

  const rimCount = Math.round(count * 0.45);
  for (let i = 0; i < rimCount; i++) {
    const a = (i / rimCount) * Math.PI * 2;
    points.push({ x: cx + rimR * Math.cos(a), y: cy + rimR * Math.sin(a) });
  }

  const spokeCount = 8;
  const perSpoke = Math.round((count * 0.4) / spokeCount);
  for (let s = 0; s < spokeCount; s++) {
    const a = (s / spokeCount) * Math.PI * 2;
    for (let i = 1; i <= perSpoke; i++) {
      const t = i / perSpoke;
      points.push({ x: cx + spokeR * t * Math.cos(a), y: cy + spokeR * t * Math.sin(a) });
    }
  }

  const hubCount = count - points.length;
  for (let i = 0; i < hubCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * hubR;
    points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return points;
}

export default function ParticleField({ size = 220, mode, active, onSettled, className = '' }: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const settledRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    settledRef.current = false;

    if (reduceMotion) {
      // Draw the settled chakra dots as a single static frame — no motion,
      // but the shape still reads immediately. Confetti/sound still fire.
      if (mode === 'converge') {
        const points = chakraTargetPoints(size, 90);
        ctx.clearRect(0, 0, size, size);
        points.forEach((p, i) => {
          ctx.fillStyle = GOLD[i % GOLD.length];
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      onSettled?.();
      return;
    }

    const count = mode === 'converge' ? 90 : 36;
    const duration = mode === 'converge' ? 1300 : 650;
    const cx = size / 2, cy = size / 2;

    let particles: Particle[];
    if (mode === 'converge') {
      const targets = chakraTargetPoints(size, count);
      particles = targets.map(t => {
        const a = Math.random() * Math.PI * 2;
        const r = size * (0.55 + Math.random() * 0.5); // scattered outside the shape
        return {
          x: 0, y: 0,
          startX: cx + r * Math.cos(a), startY: cy + r * Math.sin(a),
          targetX: t.x, targetY: t.y,
          delay: Math.random() * duration * 0.35,
          size: 1.4 + Math.random() * 1.6,
          angle: 0, distance: 0,
        };
      });
    } else {
      particles = Array.from({ length: count }, () => ({
        x: cx, y: cy, startX: cx, startY: cy, targetX: cx, targetY: cy,
        delay: 0, size: 1.5 + Math.random() * 2,
        angle: Math.random() * Math.PI * 2,
        distance: size * (0.25 + Math.random() * 0.3),
      }));
    }

    const start = performance.now();

    const frame = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, size, size);

      let allDone = true;
      particles.forEach((p, i) => {
        const local = Math.min(1, Math.max(0, (elapsed - p.delay) / (duration - p.delay)));
        if (local < 1) allDone = false;
        const eased = easeOutExpo(local);

        let px: number, py: number, alpha: number;
        if (mode === 'converge') {
          px = p.startX + (p.targetX - p.startX) * eased;
          py = p.startY + (p.targetY - p.startY) * eased;
          alpha = 0.25 + eased * 0.75;
        } else {
          const d = p.distance * eased;
          px = cx + d * Math.cos(p.angle);
          py = cy + d * Math.sin(p.angle);
          alpha = 1 - eased;
        }

        ctx.fillStyle = GOLD[i % GOLD.length];
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      if (!allDone) {
        rafRef.current = requestAnimationFrame(frame);
      } else if (!settledRef.current) {
        settledRef.current = true;
        onSettled?.();
        if (mode === 'converge') idlePulse();
      }
    };

    // Gentle post-convergence shimmer — cheap (opacity only), keeps the
    // formed wheel feeling alive without re-triggering the whole system.
    const idlePulse = () => {
      const targets = chakraTargetPoints(size, count);
      const pulseStart = performance.now();
      const loop = (now: number) => {
        const t = (now - pulseStart) / 1000;
        ctx.clearRect(0, 0, size, size);
        targets.forEach((p, i) => {
          ctx.fillStyle = GOLD[i % GOLD.length];
          // Ramp the pulse depth up from zero so every particle leaves the
          // convergence at alpha 1 and eases into the wave. Starting the sine
          // cold meant all 90 dots stepped from 1.0 to 0.75 + 0.25·sin(0.35i)
          // on the handoff frame — a visible dip at the exact moment the
          // confetti fires. Same 0.5–1.0 range as before, just phased to
          // begin at the crest instead of mid-swing.
          const depth = Math.min(1, t / 0.5) * 0.5;
          ctx.globalAlpha = 1 - (depth * (1 - Math.sin(t * 1.4 + i * 0.35))) / 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.6 + (i % 3 === 0 ? 0.4 : 0), 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className={`pointer-events-none ${className}`}
      aria-hidden="true"
    />
  );
}
