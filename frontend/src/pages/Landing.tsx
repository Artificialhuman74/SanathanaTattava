import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PARTNER_SITE_URL } from '../appMode';
import LiquidBottle from '../components/LiquidBottle';

/* ════════════════════════════════════════════════════════════════════════
 *  Sanathana Tattva — Landing
 *
 *  Register: brand. Strategy: committed → drenched. The body is the brand
 *  oil-green; cream is a deliberate chapter punctuation; gold is the single
 *  accent, expressed in three shades each with a single job:
 *    gold       — primary CTA + signature rules
 *    goldBright — emphasis (the city dots glow with this)
 *    goldDeep   — the actual oil in the bottle (deeper, redder amber)
 *
 *  Color is opaque, not alpha. Every text token has been computed for
 *  WCAG AA contrast against its specific background. Alpha is used only
 *  for shadows, blurs, and SVG glow gradients where transparency is the
 *  point. (See colorize.md: "Alpha is a design smell".)
 * ════════════════════════════════════════════════════════════════════════*/

const C = {
  /* Primary — drenched oil green */
  oil:        '#0c3a1a',  // body default (drenched)
  oilDeep:    '#082613',  // nav, ch1, ch4, footer

  /* Chapter surface — cream punctuation */
  cream:      '#f7ecd4',  // ch2, ch5 surfaces
  creamRim:   '#d6c08a',  // dividers on cream

  /* Ink (text on cream) — opaque, each step measured */
  ink:        '#1a1208',  // headlines + body on cream      14.9:1
  inkMute:    '#4c4030',  // captions on cream                8.1:1
  inkFaint:   '#776a55',  // compliance copy on cream        ~4.5:1

  /* Light (text on oil) — opaque, each step measured */
  light:      '#f7ecd4',  // headlines on oil               10.6:1
  lightBody:  '#dcd0b4',  // body on oil                     8.1:1
  lightMute:  '#b8ad94',  // secondary on oil                5.4:1
  lightRule:  '#3d4338',  // hairlines on oil (decoration)

  /* Accent — gold, three shades, three jobs */
  gold:       '#d29c43',  // primary CTA + signature rules    5.1:1 (large/UI)
  goldBright: '#ecb255',  // map-dot glow, hover emphasis
  goldDeep:   '#a96f24',  // the oil inside the bottle
};

const PAGE_STYLES = `
  :root {
    --st-oil:        ${C.oil};
    --st-oil-deep:   ${C.oilDeep};
    --st-cream:      ${C.cream};
    --st-ink:        ${C.ink};
    --st-ink-mute:   ${C.inkMute};
    --st-light:      ${C.light};
    --st-light-body: ${C.lightBody};
    --st-gold:       ${C.gold};
    --st-gold-deep:  ${C.goldDeep};
    --st-display:    'EB Garamond', 'Cardo', Georgia, 'Times New Roman', serif;
    --st-body:       'Inter', system-ui, -apple-system, sans-serif;

    /* ── Type scale ──────────────────────────────────────────────────
     * Three display sizes (hero, h2, h3/quote), one dedicated folio
     * size, four body sizes. Display sizes are fluid via clamp(); body
     * sizes are fixed for predictable reading. Ratio between body
     * steps ≈ 1.13 (close to a minor third). */
    --type-hero:    clamp(2.5rem, 6.5vw, 4.5rem);   /* 40 → 72px */
    --type-h2:      clamp(1.85rem, 4vw, 2.8rem);    /* 30 → 45px */
    --type-h3:      clamp(1.5rem, 3vw, 2.2rem);     /* 24 → 35px */
    --type-quote:   clamp(1.5rem, 3.6vw, 2.4rem);   /* 24 → 38px (Ch5) */
    --type-folio:   1.1rem;                          /* small italic chapter mark */

    --type-lede:    clamp(1.05rem, 1.6vw, 1.25rem); /* hero subtitle, italic lead-ins */
    --type-body:    1.0625rem;                       /* 17px — primary body */
    --type-body-sm: 0.9375rem;                       /* 15px — secondary body */
    --type-meta:    0.875rem;                        /* 14px — captions, labels */
    --type-xs:      0.75rem;                         /* 12px — compliance / fine print */

    /* Line heights, named by role. */
    --lh-display:   1.1;
    --lh-h2:        1.12;
    --lh-quote:     1.4;
    --lh-body:      1.72;
    --lh-meta:      1.55;

    /* Letter spacing. --ls-body is the light-on-dark compensation
     * (typeset.md): light type on dark needs a micro-tracking bump so
     * the perceived weight doesn't drop. */
    --ls-display:   -0.02em;
    --ls-tight:     -0.01em;
    --ls-body:      0.005em;
    --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
    --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
    --ease-out-expo:  cubic-bezier(0.16, 1, 0.3, 1);

    /* Fluid section padding: every chapter is one of these three.
       Each beats with a different intent. */
    --st-section-tight: clamp(64px, 7vw, 96px);    /* dense / transactional */
    --st-section:       clamp(88px, 10vw, 144px);  /* default narrative */
    --st-section-quiet: clamp(120px, 15vw, 208px); /* emotional beat — silence */

    /* Component spacing scale (4pt-rooted, used inline where Tailwind's
       class set would force off-scale values). */
    --st-1: 4px;  --st-2: 8px;  --st-3: 12px; --st-4: 16px;
    --st-5: 20px; --st-6: 24px; --st-7: 32px; --st-8: 40px;
    --st-9: 56px; --st-10: 72px;

    /* Semantic z-index scale (no arbitrary 999s) */
    --z-nav:       60;  /* sticky nav once revealed */
    --z-skip:      90;  /* skip-to-content link when focused */

    /* The fixed nav is h-14 = 56px. Used by chapters that pin via
     * position: sticky, so the pinned content starts BELOW the nav. */
    --nav-h:       56px;
  }

  /* Skip-to-content link: invisible until focused (keyboard users only) */
  .st-skip {
    position: absolute;
    top: 0; left: 50%;
    transform: translate(-50%, -120%);
    z-index: var(--z-skip);
    background: ${C.gold};
    color: ${C.oilDeep};
    font-family: var(--st-body);
    font-weight: 600;
    font-size: 0.9rem;
    padding: 12px 20px;
    border-radius: 0 0 6px 6px;
    transition: transform 180ms var(--ease-out-quart);
  }
  .st-skip:focus-visible {
    transform: translate(-50%, 0);
    outline: none;
  }

  /* Brand-aligned focus ring for every interactive element. */
  :focus-visible {
    outline: 2px solid ${C.gold};
    outline-offset: 3px;
    border-radius: 4px;
  }
  /* Buttons that already have rounded corners keep them. */
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid ${C.gold};
    outline-offset: 3px;
  }

  /* Screen-reader-only utility (for "opens in new tab" hints, etc.) */
  .st-sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Fallback if the seal image fails to load: a deep-green plate with
     the brand mark in serif. Keeps the round vessel visually present. */
  .st-seal-fallback {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(closest-side, ${C.oil} 0%, ${C.oilDeep} 100%);
    color: ${C.gold};
    font-family: var(--st-display);
    font-style: italic;
    font-size: 1.05rem;
    text-align: center;
    padding: 1.5rem;
  }


  @keyframes st-seal-rise {
    0%   { opacity: 0; transform: translateY(36px) scale(0.94); filter: blur(10px) saturate(0.55); }
    100% { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0)    saturate(1); }
  }
  @keyframes st-headline-rise {
    0%   { opacity: 0; transform: translateY(22px); filter: blur(8px); }
    100% { opacity: 1; transform: translateY(0);    filter: blur(0); }
  }
  @keyframes st-quiet-rise {
    0%   { opacity: 0; transform: translateY(10px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes st-seal-breathe {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.012); }
  }
  @keyframes st-drift-up {
    0%   { transform: translate3d(0, 0, 0); opacity: 0; }
    20%  { opacity: var(--peak, 0.4); }
    80%  { opacity: var(--peak, 0.4); }
    100% { transform: translate3d(var(--dx, 8px), -120px, 0); opacity: 0; }
  }

  /* Render polish for every text node on the page. */
  .st-page-in {
    font-kerning: normal;
    font-optical-sizing: auto;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Semantic typography classes. Use these on text elements instead of
     inline fontSize/lineHeight/letterSpacing/fontFamily values. */
  .st-hero    { font-family: var(--st-display); font-weight: 500; font-size: var(--type-hero);
                line-height: var(--lh-display); letter-spacing: var(--ls-display); }
  .st-h2      { font-family: var(--st-display); font-weight: 500; font-size: var(--type-h2);
                line-height: var(--lh-h2);      letter-spacing: var(--ls-display); }
  .st-quote   { font-family: var(--st-display); font-weight: 400; font-style: italic;
                font-size: var(--type-quote);   line-height: var(--lh-quote);
                letter-spacing: var(--ls-tight); }
  .st-lede    { font-family: var(--st-display); font-style: italic; font-weight: 400;
                font-size: var(--type-lede);    line-height: var(--lh-quote); }
  .st-folio   { font-family: var(--st-display); font-style: italic; font-size: var(--type-folio); }

  /* Body text. Variants below for light-on-dark compensation. */
  .st-body    { font-family: var(--st-body); font-weight: 400; font-size: var(--type-body);
                line-height: var(--lh-body); max-width: 65ch; }
  .st-body-sm { font-family: var(--st-body); font-weight: 400; font-size: var(--type-body-sm);
                line-height: var(--lh-body); max-width: 65ch; }
  .st-meta    { font-family: var(--st-body); font-weight: 500; font-size: var(--type-meta);
                line-height: var(--lh-meta); }
  .st-xs      { font-family: var(--st-body); font-weight: 400; font-size: var(--type-xs);
                line-height: var(--lh-meta); }

  /* Light-on-dark variant: bump body to weight 450 + 0.005em tracking
     so the perceived weight doesn't drop on the oil-green sections.
     Variable Inter handles the fractional weight; static Inter would
     snap to 500. */
  .st-body-on-dark, .st-body-sm-on-dark {
    font-weight: 450;
    letter-spacing: var(--ls-body);
  }

  /* A quick whole-page fade so the brand-green hero doesn't flash bare
     before the cascade starts. Not a content gate; just an opacity ramp. */
  @keyframes st-page-in {
    0%   { opacity: 0; }
    100% { opacity: 1; }
  }
  .st-page-in {
    animation: st-page-in 380ms var(--ease-out-quart) both;
  }

  /* Chapter scroll reveal; content is visible by default */
  .st-chapter > * {
    transition: opacity 700ms var(--ease-out-quart), transform 800ms var(--ease-out-quart);
  }
  .st-chapter[data-shy='true']:not(.st-seen) > * {
    opacity: 0.22;
    transform: translateY(28px);
  }

  /* ── Chapter 4 (Process compared) ─────────────────────────────────
   * When the section enters view, the strike-through on each refined-
   * process item draws across left → right, staggered. The text itself
   * is always visible; only the strike is animated. */
  .st-cmp-strike {
    position: relative;
    text-decoration: none;
  }
  .st-cmp-strike::after {
    content: '';
    position: absolute;
    left: 0;
    top: 56%;
    width: 100%;
    height: 1px;
    background: currentColor;
    transform-origin: left center;
    transform: scaleX(0);
    transition: transform 540ms var(--ease-out-quart);
    transition-delay: calc(var(--i, 0) * 100ms + 220ms);
  }
  .st-cmp-section.st-seen .st-cmp-strike::after {
    transform: scaleX(1);
  }

  /* Word stagger on the quote chapters */
  .st-word {
    display: inline-block;
    transition: opacity 600ms var(--ease-out-quart), transform 700ms var(--ease-out-quart);
    transition-delay: calc(var(--i, 0) * 70ms);
    opacity: 0;
    transform: translateY(14px);
  }
  .st-seen .st-word { opacity: 1; transform: translateY(0); }

  /* Ambient warm specks rising in the hero */
  .st-spark {
    position: absolute;
    bottom: 0;
    width: 3px; height: 3px;
    border-radius: 999px;
    background: radial-gradient(circle, ${C.goldBright}, ${C.gold}80 60%, transparent 75%);
    pointer-events: none;
    animation: st-drift-up 14s linear infinite;
  }

  /* Reduced motion: collapse to crossfades */
  @media (prefers-reduced-motion: reduce) {
    .st-page-in { animation: none !important; }
    .st-chapter > * { transition: opacity 200ms linear !important; transform: none !important; }
    .st-chapter[data-shy='true']:not(.st-seen) > * { opacity: 1 !important; transform: none !important; }
    .st-word { transition: opacity 200ms linear !important; opacity: 1 !important; transform: none !important; transition-delay: 0ms !important; }
    .st-spark { display: none; }
    [data-st-animate] { animation: none !important; opacity: 1 !important; transform: none !important; filter: none !important; }
    /* Strikes appear instantly, no draw animation. */
    .st-cmp-strike::after {
      transition: none !important;
      transform: scaleX(1) !important;
    }
  }
`;

/* ──────────────────────────────────────────────────────────────────── */

function useSeen<T extends Element>(threshold = 0.18) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); obs.disconnect(); } },
      { threshold, rootMargin: '0px 0px -10% 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

/** Tracks the user's prefers-reduced-motion preference and updates live. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const cb = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari < 14 used the deprecated addListener API.
    if (mql.addEventListener) mql.addEventListener('change', cb);
    else mql.addListener(cb);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', cb);
      else mql.removeListener(cb);
    };
  }, []);
  return reduced;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/* ── Chapter 3: oils. Phase colors + cards. ───────────────────────── */
type OilType = 'coconut' | 'groundnut' | 'sunflower';

const OIL_COLORS: Record<OilType, { top: string; bot: string }> = {
  coconut:   { top: '#f5e2a0', bot: '#c5ab70' },  // pale gold; sets like cream below 24°C
  groundnut: { top: '#c08838', bot: '#704a14' },  // deep amber; high smoke point
  sunflower: { top: '#f0c860', bot: '#a87814' },  // clear bright gold
};

const CHAPTER3_CARDS: Array<{
  tag:       string;
  body:      string;
  highlight?: boolean;
}> = [
  {
    tag:  'coconut',
    body: 'from sun-dried copra. Pale gold at room temperature, pale white below 24°C. Lauric acid, medium-chain triglycerides, mild flavour. Use for tempering, dosa batter, body massage.',
  },
  {
    tag:  'groundnut',
    body: 'from hand-picked nuts. Deep amber, slow to oxidize. Vitamin E, monounsaturated fats, a smoke point that handles a sambar tadka without breaking. Use for shallow frying, gravies, masalas.',
  },
  {
    tag:  'sunflower',
    body: 'from sun-dried seeds. Light golden, mild taste that does not dominate. Mostly polyunsaturated, with vitamin E. Use for everyday cooking, salad dressings, baking.',
  },
  {
    tag:        'the can comes back',
    body:       'we ship in a reusable steel can, not a plastic bottle. Bring it back empty on the next order; we clean it, refill it, and send it out again. You pay for the oil, not for a new container each time.',
    highlight:  true,
  },
];

/* Linear RGB interpolation between two hex colors. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}
function lerpRgb(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const blue = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${blue})`;
}

/** Bottle color at a given pin progress. Interpolates between consecutive
 *  phase centers (0.125 coconut → 0.375 groundnut → 0.625 sunflower → 0.875 stays sunflower). */
function currentOilColor(progress: number, kind: 'top' | 'bot'): string {
  const stops: Array<{ at: number; oil: OilType }> = [
    { at: 0.125, oil: 'coconut'   },
    { at: 0.375, oil: 'groundnut' },
    { at: 0.625, oil: 'sunflower' },
    { at: 0.875, oil: 'sunflower' },  // shelf-life phase keeps the last oil
  ];
  if (progress <= stops[0].at) return OIL_COLORS[stops[0].oil][kind];
  for (let i = 0; i < stops.length - 1; i++) {
    if (progress < stops[i + 1].at) {
      const t = (progress - stops[i].at) / (stops[i + 1].at - stops[i].at);
      return lerpRgb(OIL_COLORS[stops[i].oil][kind], OIL_COLORS[stops[i + 1].oil][kind], t);
    }
  }
  return OIL_COLORS[stops[stops.length - 1].oil][kind];
}

/** Bottle-label opacity for a given oil at a given pin progress. */
function oilLabelOpacity(progress: number, oil: OilType): number {
  const window = (start: number, end: number, fade = 0.05) => {
    if (progress < start - fade) return 0;
    if (progress < start) return clamp01((progress - (start - fade)) / fade);
    if (progress < end)   return 1;
    if (progress < end + fade) return clamp01(1 - (progress - end) / fade);
    return 0;
  };
  if (oil === 'coconut')   return window(0.00, 0.25);
  if (oil === 'groundnut') return window(0.27, 0.52);
  /* sunflower spans through the shelf-life phase, so it stays at 1 until the section ends. */
  return window(0.55, 1.10);
}

/** Card transform + opacity at a given pin progress.
 *  Cards 0-2 enter from below, pass through center, exit upward. Card 3
 *  (shelf life) enters and stays until the section releases. */
function chapter3CardState(progress: number, index: number): { ty: number; opacity: number } {
  const PHASES = [
    { IN: 0.00, PEAK: 0.125, OUT: 0.27 },
    { IN: 0.22, PEAK: 0.375, OUT: 0.52 },
    { IN: 0.47, PEAK: 0.625, OUT: 0.77 },
    { IN: 0.72, PEAK: 0.875, OUT: 1.10 },   // never exits within pin range
  ];
  const TRAVEL = 70;                                  // px each side of centre
  const p = PHASES[index];
  if (progress < p.IN)   return { ty: TRAVEL, opacity: 0 };
  if (progress < p.PEAK) {
    const t = (progress - p.IN) / (p.PEAK - p.IN);
    return { ty: TRAVEL * (1 - t), opacity: t };
  }
  if (progress >= p.OUT) return { ty: -TRAVEL, opacity: 0 };
  const t = (progress - p.PEAK) / (p.OUT - p.PEAK);
  return { ty: -TRAVEL * t, opacity: 1 - t };
}

/** Progress through a tall section that contains a `position: sticky`
 *  child. Returns 0 when the section's top reaches viewport top, and 1
 *  when scrolling has moved one full (section height − viewport height).
 *  Used to drive the bottle pour + card reveals in Chapter 3. */
function usePinnedProgress(ref: React.RefObject<HTMLElement>, opts: { disabled?: boolean } = {}) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (opts.disabled) { setP(1); return; }  // reduced motion: bottle pre-filled
    if (typeof window === 'undefined') return;
    let rafId = 0;
    let pending = false;
    const compute = () => {
      pending = false;
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const height = rect.height;
      const vh = window.innerHeight;
      const range = Math.max(1, height - vh);
      const scrolled = Math.max(0, window.scrollY - top);
      setP(clamp01(scrolled / range));
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      rafId = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, opts.disabled]);
  return p;
}

/** Scroll progress between two elements, rAF-throttled. Returns 0 when
 *  the user prefers reduced motion (caller's scroll-linked animations
 *  collapse to a static state). */
function useScrollProgressBetween(
  start: React.RefObject<HTMLElement>,
  end:   React.RefObject<HTMLElement>,
  opts: { disabled?: boolean } = {}
) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (opts.disabled) { setP(0); return; }
    if (typeof window === 'undefined') return;
    let rafId = 0;
    let pending = false;
    const compute = () => {
      pending = false;
      if (!start.current || !end.current) return;
      const sTop = start.current.getBoundingClientRect().top + window.scrollY;
      const eTop = end.current.getBoundingClientRect().top   + window.scrollY;
      const total = Math.max(1, eTop - sTop);
      const cur = Math.min(Math.max(0, window.scrollY - sTop), total);
      setP(cur / total);
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      rafId = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [start, end, opts.disabled]);
  return p;
}

/** Image with a styled fallback when the network or asset fails. */
function SealImage({
  src, alt, className, style, eager, fallbackText,
}: {
  src: string; alt: string; className?: string; style?: React.CSSProperties;
  eager?: boolean; fallbackText: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`st-seal-fallback ${className || ''}`} role="img" aria-label={alt}>
        {fallbackText}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : 'auto' as any}
      onError={() => setFailed(true)}
    />
  );
}

function StaggeredPhrase({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const words = text.split(' ');
  return (
    <span className={className} style={style}>
      {words.map((w, i) => (
        // The trailing space MUST live outside the inline-block span,
        // otherwise it collapses and every word welds to the next.
        <React.Fragment key={i}>
          <span className="st-word" style={{ ['--i' as any]: i }}>{w}</span>
          {i < words.length - 1 && ' '}
        </React.Fragment>
      ))}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
export default function Landing() {
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();

  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    let rafId = 0;
    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      rafId = requestAnimationFrame(() => {
        pending = false;
        setScrollY(window.scrollY);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  const navShown = scrollY > 280;

  /* Chapter 3 (Pour) is a sticky-pinned scrollytelling section. The outer
   * <section> is 380vh tall; an inner div is `position: sticky` below the
   * nav. Scrolling through the section yields pinProgress 0→1, which
   * drives:
   *   bottleFill  — liquid level (rises 0.05 → 0.92 of progress)
   *   oil color   — phased coconut → groundnut → sunflower via lerp
   *   labels      — three SVG text elements crossfade at the same point
   *   cards       — one at a time, scroll-driven slot at right
   * Reduced motion: bottle is pre-filled to sunflower; first card shown. */
  const bottleSectionRef = useRef<HTMLDivElement>(null);
  const pinProgress = usePinnedProgress(bottleSectionRef, { disabled: reducedMotion });
  const bottleFill = clamp01((pinProgress - 0.05) / 0.87);

  const [seedRef,    seedSeen]    = useSeen<HTMLDivElement>();
  const [pressRef,   pressSeen]   = useSeen<HTMLDivElement>();
  const [familyRef,  familySeen]  = useSeen<HTMLDivElement>();
  const [partnerRef, partnerSeen] = useSeen<HTMLDivElement>();

  const sparks = useMemo(
    () => Array.from({ length: 12 }).map(() => ({
      left:  Math.random() * 100,
      dur:   10 + Math.random() * 12,
      delay: -Math.random() * 18,
      peak:  0.20 + Math.random() * 0.32,
      dx:    (Math.random() - 0.5) * 30,
    })),
    []
  );

  return (
    <div className="st-page-in" style={{ background: C.oil, color: C.light }}>
      <style>{PAGE_STYLES}</style>

      {/* Keyboard users: skip past the nav to the main content. */}
      <a href="#story" className="st-skip">Skip to content</a>

      {/* ── Sticky nav ────────────────────────────────────────────── */}
      <nav
        aria-label="Primary"
        aria-hidden={!navShown}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          zIndex: 'var(--z-nav)' as any,
          background: 'rgba(8, 38, 19, 0.94)',
          backdropFilter: 'blur(14px)',
          borderBottom: `1px solid ${C.lightRule}`,
          opacity: navShown ? 1 : 0,
          pointerEvents: navShown ? 'auto' : 'none',
          transform: `translateY(${navShown ? 0 : -10}px)`,
          transition: 'opacity 360ms var(--ease-out-quart), transform 360ms var(--ease-out-quart)',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center gap-3">
          <img
            src="/logo.webp"
            className="h-7 w-7 rounded-md object-contain flex-shrink-0"
            alt=""
            width={28}
            height={28}
            decoding="async"
            aria-hidden="true"
          />
          <span
            className="st-lede"
            style={{
              fontFamily: 'var(--st-display)',
              fontStyle: 'normal',
              fontWeight: 500,
              fontSize: '1.05rem',
              lineHeight: 1.2,
              letterSpacing: 'var(--ls-tight)',
              color: C.light,
              minWidth: 0,
            }}
          >
            Sanathana Tattva
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => navigate('/shop/register')}
            className="hidden sm:inline-flex items-center text-sm font-medium px-3 transition-colors"
            style={{
              color: C.lightBody,
              fontFamily: 'var(--st-body)',
              minHeight: 44,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = C.light)}
            onMouseLeave={e => (e.currentTarget.style.color = C.lightBody)}
          >
            Create an account
          </button>
          <button
            type="button"
            onClick={() => navigate('/shop/login')}
            className="inline-flex items-center justify-center px-4 rounded-md text-sm font-semibold transition-transform hover:-translate-y-0.5"
            style={{
              background: C.gold,
              color: C.oilDeep,
              fontFamily: 'var(--st-body)',
              minHeight: 40,  /* 40 in tight nav; sign-in is duplicated below at full 44+ */
            }}
          >
            Sign in
          </button>
        </div>
      </nav>

      {/* ══════════════════════════ HERO ══════════════════════════ */}
      <section
        id="story"
        tabIndex={-1}
        className="relative min-h-screen flex flex-col"
        style={{
          background: `radial-gradient(ellipse 100% 70% at 50% 25%, ${C.oil} 0%, ${C.oilDeep} 100%)`,
        }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {sparks.map((s, i) => (
            <span
              key={i}
              className="st-spark"
              style={{
                left: `${s.left}%`,
                animationDuration: `${s.dur}s`,
                animationDelay: `${s.delay}s`,
                ['--peak' as any]: s.peak,
                ['--dx' as any]: `${s.dx}px`,
              }}
              aria-hidden
            />
          ))}
        </div>

        <div className="relative flex-1 flex flex-col items-center justify-center px-6" style={{ paddingTop: 'var(--st-10)', paddingBottom: 'var(--st-9)' }}>
          {/* The vessel: the seal as a printed crest, viscous, breathing */}
          <div
            className="relative"
            style={{
              width:  'min(58vw, 280px)',
              height: 'min(58vw, 280px)',
              opacity: 0,
              animation: 'st-seal-rise 1100ms var(--ease-out-quart) 200ms forwards',
            }}
            data-st-animate
          >
            <div
              className="absolute inset-0 rounded-full overflow-hidden"
              style={{
                boxShadow: `
                  0 32px 70px -28px rgba(0, 0, 0, 0.55),
                  inset 0 0 0 1px rgba(210, 156, 67, 0.30),
                  inset 0 0 60px rgba(210, 156, 67, 0.12)
                `,
              }}
            >
              <SealImage
                src="/Gemini_Generated_Image_agra6kagra6kagra.png"
                alt="A bullock walking the wooden ghani press; coconut kernels and oil at its base."
                eager
                className="w-full h-full object-cover"
                style={{
                  animation: reducedMotion ? undefined : 'st-seal-breathe 7s ease-in-out infinite 1.4s',
                }}
                fallbackText={'Sanathana Tattva\nthe seal'}
              />
              <span
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{ background: `radial-gradient(closest-side, transparent 56%, rgba(8, 38, 19, 0.40) 100%)` }}
              />
            </div>
          </div>

          <h1
            className="st-hero text-center"
            style={{
              color: C.light,
              textWrap: 'balance' as any,
              marginTop: 'var(--st-9)',
              opacity: 0,
              animation: 'st-headline-rise 900ms var(--ease-out-quart) 600ms forwards',
            }}
            data-st-animate
          >
            Sanathana Tattva
          </h1>

          <p
            className="st-lede text-center"
            style={{
              color: C.lightBody,
              textWrap: 'balance' as any,
              maxWidth: '32ch',
              marginTop: 'var(--st-4)',
              opacity: 0,
              animation: 'st-quiet-rise 800ms var(--ease-out-quart) 950ms forwards',
            }}
            data-st-animate
          >
            We press oil the way it has been pressed in our family
            for three generations. One wooden ghani. One bullock. No heat.
          </p>

          <div
            className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm sm:max-w-md"
            style={{
              marginTop: 'var(--st-10)',  /* generous: separate intent */
              opacity: 0,
              animation: 'st-quiet-rise 800ms var(--ease-out-quart) 1200ms forwards',
            }}
            data-st-animate
          >
            <button
              type="button"
              onClick={() => navigate('/shop')}
              className="w-full sm:flex-1 px-6 py-3.5 rounded-md font-semibold transition-all hover:-translate-y-0.5"
              style={{
                background: C.gold,
                color: C.oilDeep,
                fontFamily: 'var(--st-body)',
                fontSize: '0.95rem',
                minHeight: 48,
                boxShadow: '0 12px 28px -12px rgba(169, 111, 36, 0.75)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = C.goldBright)}
              onMouseLeave={e => (e.currentTarget.style.background = C.gold)}
            >
              Open the shop
            </button>
            <button
              type="button"
              onClick={() => navigate('/shop/login')}
              className="w-full sm:flex-1 px-6 py-3.5 rounded-md font-semibold transition-all hover:-translate-y-0.5"
              style={{
                background: 'transparent',
                color: C.light,
                border: `1px solid ${C.lightMute}`,
                fontFamily: 'var(--st-body)',
                fontSize: '0.95rem',
                minHeight: 48,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.light; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.lightMute; }}
            >
              Sign in
            </button>
          </div>

          <p
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center st-lede"
            style={{
              color: C.lightMute,
              fontSize: 'var(--type-meta)',
              opacity: 0,
              animation: 'st-quiet-rise 800ms var(--ease-out-quart) 1500ms forwards',
            }}
            data-st-animate
          >
            Read on, the story is short.
          </p>
        </div>
      </section>

      {/* ══════════════════════ CHAPTER 1 — Seed ══════════════════════
       * Quiet beat. Generous vertical padding, asymmetric body indent. */}
      <section
        ref={seedRef}
        className={`st-chapter relative px-6 sm:px-10 ${seedSeen ? 'st-seen' : ''}`}
        data-shy="true"
        style={{
          background: C.oilDeep,
          paddingTop: 'var(--st-section-quiet)',
          paddingBottom: 'var(--st-section-quiet)',
        }}
      >
        <div className="max-w-5xl mx-auto">
          <p
            className="st-h2"
            style={{
              color: C.light,
              textWrap: 'balance' as any,
              maxWidth: '28ch',
            }}
          >
            <StaggeredPhrase text="It starts with seeds we know by their farmer." />
          </p>
          {/* Body hangs from the right side of the page: deliberate
              asymmetry so the reader's eye travels diagonally down. */}
          <div className="grid grid-cols-12">
            <p
              className="col-span-12 md:col-span-7 md:col-start-6 st-body st-body-on-dark"
              style={{
                color: C.lightBody,
                marginTop: 'var(--st-9)',
                maxWidth: '42ch',
              }}
            >
              Hand-picked, pressed within the week of harvest. We pay above
              the mandi rate, we visit the farms ourselves, and we put the
              farmer's name on every label.
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════ CHAPTER 2 — Press ═════════════════════
       * Standard pacing. Image dominates (1.3fr) — the press IS the brand. */}
      <section
        ref={pressRef}
        className={`st-chapter relative ${pressSeen ? 'st-seen' : ''}`}
        data-shy="true"
        style={{
          background: C.cream,
          color: C.ink,
          paddingTop: 'var(--st-section)',
          paddingBottom: 'var(--st-section)',
        }}
      >
        <div className="max-w-6xl mx-auto px-6 sm:px-10 flex items-baseline gap-4" style={{ marginBottom: 'var(--st-9)' }}>
          <span className="st-folio" style={{ color: C.goldDeep }}>two</span>
          <span style={{ flex: 1, height: 1, background: C.creamRim }} />
        </div>

        <div className="max-w-6xl mx-auto px-6 sm:px-10 grid gap-10 lg:gap-20 md:grid-cols-[1.3fr_1fr] items-center">
          <figure className="relative">
            <div
              className="relative aspect-square rounded-sm overflow-hidden"
              style={{
                boxShadow: '0 24px 50px -22px rgba(26, 18, 8, 0.55), inset 0 0 0 1px rgba(169, 111, 36, 0.25)',
              }}
            >
              <SealImage
                src="/Gemini_Generated_Image_agra6kagra6kagra.png"
                alt="The same wooden ghani, shown in detail; the bullock harnessed to the central pillar, sesame seeds at the base."
                className="absolute inset-0 w-full h-full object-cover"
                style={{ filter: 'sepia(0.12) saturate(0.95)' }}
                fallbackText={'The press\nKarnataka, 2025'}
              />
              <span
                aria-hidden
                className="absolute inset-0"
                style={{ background: 'radial-gradient(closest-side, transparent 58%, rgba(26, 18, 8, 0.28) 100%)' }}
              />
            </div>
            <figcaption
              className="st-lede mt-3"
              style={{ color: C.inkMute, fontSize: 'var(--type-meta)' }}
            >
              The press. Karnataka, photographed in 2025.
            </figcaption>
          </figure>

          <div>
            <h2
              className="st-h2"
              style={{
                color: C.ink,
                textWrap: 'balance' as any,
              }}
            >
              The press is wooden. The cow is real.
            </h2>
            <div
              className="mt-6 space-y-5 st-body"
              style={{
                color: C.ink,
                maxWidth: '38rem',
                textWrap: 'pretty' as any,
              }}
            >
              <p>
                A wooden ghani turns at twelve revolutions a minute. The bullock
                walks; the central pillar grinds; the seed gives up its oil
                slowly, without heat. One batch takes ninety minutes. The same
                batch takes a refinery thirty seconds.
              </p>
              <p>
                The thing the slow speed buys you is everything that heat
                destroys: the vitamin E, the lecithin, the natural antioxidants,
                the smell of the seed itself. Open a bottle and you can tell
                which seed it came from. That's the test.
              </p>
            </div>

            <div className="mt-10 flex items-center gap-3">
              <span style={{ width: 32, height: 1, background: C.gold }} />
              <span className="st-lede" style={{ color: C.goldDeep, fontSize: 'var(--type-meta)' }}>
                pressed cold, never heated
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════ CHAPTER 3 — Pour ══════════════════════
       * Scrollytelling: tall outer + sticky inner pane that pins below
       * the nav. As the reader scrolls:
       *  · the bottle fills (existing pour metaphor)
       *  · its oil color shifts coconut → groundnut → sunflower
       *  · the variety label on the bottle crossfades likewise
       *  · one statement at a time enters from below, peaks, exits up.
       *    The fourth statement is a highlighted shelf-life note. */}
      <section
        ref={bottleSectionRef}
        className="relative"
        style={{
          background: C.oil,
          color: C.light,
          minHeight: '380vh',
        }}
      >
        <div
          className="sticky flex items-center"
          style={{
            top: 'var(--nav-h)',
            height: 'calc(100vh - var(--nav-h))',
          }}
        >
          {/* Grid is items-start so the right column (heading + cards)
              anchors near the top of the pane instead of being vertically
              centred against the tall bottle. A small top pad keeps it
              from sitting flush against the nav. */}
          <div
            className="max-w-6xl w-full mx-auto px-6 sm:px-10 grid gap-8 lg:gap-14 md:grid-cols-[0.9fr_1.1fr] items-start"
            style={{ paddingTop: 'clamp(40px, 8vh, 96px)' }}
          >

            {/* LEFT — Bottle. WebGL liquid: real-time shader with ripples,
                caustics, meniscus highlight, and a mouse-down ripple. Color
                and label shift per phase; liquid fills with scroll. Falls
                back to a static SVG bottle when WebGL is unavailable or the
                user prefers reduced motion. */}
            <div className="flex justify-center md:justify-start">
              <LiquidBottle
                fill={bottleFill}
                topColor={currentOilColor(pinProgress, 'top')}
                botColor={currentOilColor(pinProgress, 'bot')}
                labels={{
                  coconut:   oilLabelOpacity(pinProgress, 'coconut'),
                  groundnut: oilLabelOpacity(pinProgress, 'groundnut'),
                  sunflower: oilLabelOpacity(pinProgress, 'sunflower'),
                }}
              />
            </div>

            {/* RIGHT — Heading sits above a fixed-height slot in which the
                four cards swap, one at a time. */}
            <div className="relative">
              <h2
                className="st-h2"
                style={{
                  color: C.light,
                  textWrap: 'balance' as any,
                  maxWidth: '20ch',
                  fontSize: 'clamp(1.6rem, 3.4vw, 2.4rem)',
                }}
              >
                An oil that still smells like the seed it came from.
              </h2>

              {/* Card slot: relative container with fixed height to host
                  absolutely-positioned cards that swap on scroll. Heading
                  stays anchored near the top of the pane; the slot lives
                  in the middle band so the cards land at mid-viewport. */}
              <div
                className="relative"
                style={{
                  marginTop: 'clamp(120px, 18vh, 240px)',
                  height: 'clamp(180px, 22vh, 220px)',
                }}
              >
                {CHAPTER3_CARDS.map((card, i) => {
                  const { ty, opacity } = chapter3CardState(pinProgress, i);
                  const visible = opacity > 0.02;
                  return (
                    <div
                      key={i}
                      aria-hidden={visible ? undefined : 'true'}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: `translateY(${ty}px)`,
                        opacity,
                        pointerEvents: visible ? undefined : 'none',
                        willChange: 'opacity, transform',
                      }}
                    >
                      <Chapter3Card
                        tag={card.tag}
                        body={card.body}
                        highlight={card.highlight}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════ CHAPTER 4 — Process compared ══════════
       * Two columns of steps. Refined sunflower (left) gets a strike-
       * through cascade when the section enters view; ours (right) is
       * short and clean from the start. The strike-draw on the left is
       * the chapter's single, scripted motion. */}
      <section
        ref={familyRef}
        className={`st-chapter st-cmp-section relative px-6 sm:px-10 ${familySeen ? 'st-seen' : ''}`}
        data-shy="true"
        style={{
          background: C.oilDeep,
          color: C.light,
          paddingTop: 'var(--st-section)',
          paddingBottom: 'var(--st-section)',
        }}
      >
        <div className="max-w-5xl mx-auto">
          <h2
            className="st-h2"
            style={{
              color: C.light,
              textWrap: 'balance' as any,
              maxWidth: '24ch',
            }}
          >
            What happens between the seed and the can.
          </h2>

          <div
            className="mt-12 sm:mt-16 grid gap-10 lg:gap-20 md:grid-cols-2"
            style={{ alignItems: 'start' }}
          >
            {/* Refined: the long industrial path, struck through. */}
            <div>
              <p
                style={{
                  fontFamily: 'var(--st-display)',
                  fontStyle: 'italic',
                  fontSize: 'var(--type-meta)',
                  color: C.lightMute,
                  marginBottom: 'var(--st-5)',
                }}
              >
                refined sunflower oil
              </p>
              <ol
                style={{
                  fontFamily: 'var(--st-body)',
                  fontSize: 'var(--type-body)',
                  lineHeight: 1.85,
                  color: C.lightMute,
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  maxWidth: '34ch',
                }}
              >
                {[
                  'solvent extraction with hexane',
                  'degumming with phosphoric acid',
                  'neutralisation with caustic soda',
                  'bleaching with activated clay',
                  'deodorisation at 240°C, under vacuum',
                  'winterisation to remove waxes',
                  'plastic bottle, single use',
                ].map((step, i) => (
                  <li key={i} style={{ ['--i' as any]: i }}>
                    <del className="st-cmp-strike">{step}</del>
                  </li>
                ))}
              </ol>
            </div>

            {/* Ours: short, plain, in display weight. */}
            <div>
              <p
                style={{
                  fontFamily: 'var(--st-display)',
                  fontStyle: 'italic',
                  fontSize: 'var(--type-meta)',
                  color: C.gold,
                  marginBottom: 'var(--st-5)',
                }}
              >
                what we do
              </p>
              <ol
                style={{
                  fontFamily: 'var(--st-display)',
                  fontWeight: 500,
                  fontSize: 'clamp(1.3rem, 2.2vw, 1.7rem)',
                  lineHeight: 1.7,
                  letterSpacing: 'var(--ls-tight)',
                  color: C.light,
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                }}
              >
                <li>the seed</li>
                <li>the wooden ghani</li>
                <li>a cotton filter</li>
                <li>a steel can we take back</li>
              </ol>
            </div>
          </div>

          <p
            className="mt-12 sm:mt-16 st-body st-body-on-dark"
            style={{ color: C.lightBody, maxWidth: '56ch' }}
          >
            Each step on the left strips something away. Refining strips
            most of it; the plastic bottle goes to a landfill. We do four
            things, and one of them is taking the can back to refill it
            for next time.
          </p>
        </div>
      </section>

      {/* ══════════════════════ CHAPTER 5 — Partners ══════════════════
       * Tight pacing — transactional. CTA column tightens so the button
       * sits next to the pitch instead of floating in empty space. */}
      <section
        ref={partnerRef}
        className={`st-chapter relative px-6 sm:px-10 ${partnerSeen ? 'st-seen' : ''}`}
        data-shy="true"
        style={{
          background: C.oil,
          color: C.light,
          paddingTop: 'var(--st-section-tight)',
          paddingBottom: 'var(--st-section-tight)',
        }}
      >
        <div className="max-w-5xl mx-auto grid gap-10 md:grid-cols-[1.35fr_0.65fr] items-end">
          <div>
            <h2
              className="st-h2"
              style={{
                color: C.light,
                textWrap: 'balance' as any,
              }}
            >
              If you already deliver in your neighbourhood, you should be one of our dealers.
            </h2>
            <p
              className="mt-6 st-body st-body-on-dark"
              style={{ color: C.lightBody }}
            >
              We don't run our own fleet. Our dealers are kirana shops,
              standalone delivery agents, and local distributors who already
              know their street. You get a referral code, customers who use it
              become yours, and you earn on every order they place. Forever.
            </p>
          </div>
          {PARTNER_SITE_URL ? (
            <a
              href={PARTNER_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-3 px-7 py-4 rounded-md font-semibold transition-all hover:-translate-y-0.5"
              style={{
                background: C.gold,
                color: C.oilDeep,
                fontFamily: 'var(--st-body)',
                fontSize: '0.98rem',
                minHeight: 52,
                boxShadow: '0 18px 36px -14px rgba(169, 111, 36, 0.85)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = C.goldBright)}
              onMouseLeave={e => (e.currentTarget.style.background = C.gold)}
            >
              Apply to become a dealer
              <span aria-hidden="true" style={{ fontFamily: 'var(--st-display)', fontStyle: 'italic' }}>→</span>
              <span className="st-sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <p
              className="inline-flex items-center"
              style={{
                fontFamily: 'var(--st-body)',
                fontSize: '0.95rem',
                color: C.lightBody,
              }}
            >
              Dealer applications open soon. Write to{' '}
              <a
                href="mailto:partners@sanathanatattva.shop"
                className="ml-1.5 underline"
                style={{ color: C.gold }}
              >
                partners@sanathanatattva.shop
              </a>
              .
            </p>
          )}
        </div>
      </section>

      {/* ══════════════════════ FOOTER ════════════════════════════════ */}
      <footer
        className="px-6 sm:px-10"
        style={{
          background: C.oilDeep,
          color: C.lightBody,
          paddingTop: 'var(--st-10)',
          paddingBottom: 'var(--st-9)',
        }}
      >
        <div className="max-w-6xl mx-auto grid gap-10 md:grid-cols-[1.6fr_0.85fr_0.85fr] items-start">
          <div>
            <p
              className="st-h2"
              style={{
                color: C.light,
                /* Footer brand sits smaller than chapter headlines. */
                fontSize: '1.6rem',
                letterSpacing: 'var(--ls-tight)',
              }}
            >
              Sanathana Tattva
            </p>
            <p className="mt-2 max-w-sm st-body-sm st-body-sm-on-dark" style={{ color: C.lightBody }}>
              A family-run cold-pressed oil business out of Bengaluru. We
              press coconut, groundnut, and sunflower the same way: slowly,
              with a wooden ghani, without heat.
            </p>
          </div>

          <FooterColumn title="Visit">
            <FooterLink onClick={() => navigate('/shop')} label="Shop the oils" />
            <FooterLink onClick={() => navigate('/shop/login')} label="Sign in" />
            <FooterLink onClick={() => navigate('/shop/register')} label="Create an account" />
          </FooterColumn>

          <FooterColumn title="Read">
            <FooterLink onClick={() => navigate('/shop/legal#terms')} label="Terms" />
            <FooterLink onClick={() => navigate('/shop/legal#privacy')} label="Privacy" />
            <FooterLink onClick={() => navigate('/shop/legal#refunds')} label="Refunds & cancellation" />
            <FooterLink onClick={() => navigate('/shop/legal#grievance')} label="Grievance officer" />
          </FooterColumn>
        </div>

        <div
          className="max-w-6xl mx-auto mt-14 pt-6 st-xs flex flex-wrap items-center gap-x-6 gap-y-2"
          style={{
            borderTop: `1px solid ${C.lightRule}`,
            color: C.lightMute,
          }}
        >
          <span>© {new Date().getFullYear()} Sanathana Tattva</span>
          <span>FSSAI · [License No.]</span>
          <span>GSTIN · [GSTIN]</span>
          <span className="ml-auto st-lede" style={{ color: C.lightBody, fontSize: 'var(--type-xs)' }}>
            Purity of tradition in every drop.
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="mb-3"
        style={{
          fontFamily: 'var(--st-display)',
          fontWeight: 500,
          fontSize: 'var(--type-meta)',
          color: C.light,
          letterSpacing: 'var(--ls-tight)',
        }}
      >
        {title}
      </p>
      <ul className="space-y-2.5 st-body-sm st-body-sm-on-dark">
        {children}
      </ul>
    </div>
  );
}

function FooterLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="transition-colors text-left inline-flex items-center"
        style={{
          color: C.lightBody,
          minHeight: 32,  /* footer links are dense; full 44 would force ugly gaps */
          padding: '4px 0',  /* expanded hit area without visible inflation */
        }}
        onMouseEnter={e => (e.currentTarget.style.color = C.light)}
        onMouseLeave={e => (e.currentTarget.style.color = C.lightBody)}
      >
        {label}
      </button>
    </li>
  );
}

/* ── Chapter 3 card. Used in the swap-on-scroll slot. When `highlight`
 *    is true (the shelf-life card), the card gets a gold border, a
 *    cream-tinted background, and a small italic "keep in mind" eyebrow
 *    so the reader registers it as a parting note, not another fact. */
function Chapter3Card({
  tag,
  body,
  highlight,
}: {
  tag:        string;
  body:       string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        background:    highlight ? 'rgba(210, 156, 67, 0.10)' : 'rgba(8, 38, 19, 0.6)',
        border:        `${highlight ? 1.5 : 1}px solid ${highlight ? C.gold : C.lightRule}`,
        borderRadius:  12,
        padding:       '24px 26px',
        backdropFilter:'blur(2px)',
      }}
    >
      {highlight && (
        <p
          style={{
            fontFamily:    'var(--st-display)',
            fontStyle:     'italic',
            fontSize:      'var(--type-meta)',
            color:         C.gold,
            margin:        '0 0 6px 0',
            letterSpacing: 'var(--ls-tight)',
          }}
        >
          keep in mind
        </p>
      )}
      <p
        className="st-body st-body-on-dark"
        style={{ color: C.lightBody, margin: 0, maxWidth: 'none' }}
      >
        <span
          style={{
            fontFamily: 'var(--st-display)',
            fontStyle:  'italic',
            color:      highlight ? C.goldBright : C.gold,
            fontSize:   '1.2em',
            marginRight:'0.45em',
          }}
        >
          {tag}
        </span>
        {body}
      </p>
    </div>
  );
}

/* ── Karnataka SVG was a stop-gap; the chapter no longer uses any map.
 *    Component kept here in case a future variant wants it back. */
function _KarnatakaMap_unused({ seen }: { seen: boolean }) {
  // Approximate positions within the simplified Karnataka outline.
  // Live = currently delivered; soon = next on the roadmap, dimmed.
  const pins = [
    { id: 'BLR', cx: 168, cy: 252, label: 'Bengaluru',  state: 'live' as const },
    { id: 'MYS', cx: 132, cy: 268, label: 'Mysuru',     state: 'soon' as const },
    { id: 'MNG', cx:  62, cy: 220, label: 'Mangaluru',  state: 'soon' as const },
    { id: 'HUB', cx:  86, cy: 130, label: 'Hubballi',   state: 'soon' as const },
    { id: 'KAL', cx: 196, cy:  84, label: 'Kalaburagi', state: 'soon' as const },
  ];

  return (
    <svg viewBox="0 0 280 340" width="100%" style={{ maxWidth: 380 }} aria-hidden="true">
      <defs>
        <radialGradient id="liveGlow">
          <stop offset="0%"   stopColor={C.goldBright} stopOpacity="0.9" />
          <stop offset="55%"  stopColor={C.gold}       stopOpacity="0.28" />
          <stop offset="100%" stopColor={C.gold}       stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Simplified Karnataka outline. Slightly elongated north–south,
         angled like the real silhouette, but smoothed for legibility. */}
      <path
        d="
          M150,18
          C 175,22 200,30 215,52
          C 228,74 232,98 225,118
          C 218,140 208,160 198,180
          C 196,202 200,222 192,244
          C 184,266 168,282 152,294
          C 134,302 116,300 100,290
          C 86,278 78,260 70,242
          C 60,222 48,202 46,178
          C 44,154 52,132 60,112
          C 68,92 76,72 88,54
          C 104,32 126,18 150,18
          Z
        "
        fill="rgba(247, 236, 212, 0.05)"
        stroke={C.lightMute}
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {pins.map((p, i) => {
        const delay = 240 + i * 140;
        const isLive = p.state === 'live';
        return (
          <g key={p.id}>
            {/* Live city: bright glow + bright dot + bright label.
                Soon cities: no glow, smaller dimmer dot, faded label. */}
            {isLive && (
              <circle
                cx={p.cx} cy={p.cy} r="26"
                fill="url(#liveGlow)"
                style={{
                  opacity: seen ? 1 : 0,
                  transition: `opacity 700ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
                }}
              />
            )}
            <circle
              cx={p.cx} cy={p.cy}
              r={isLive ? 5 : 2.5}
              fill={isLive ? C.goldBright : C.gold}
              opacity={isLive ? 1 : 0.55}
              style={{
                opacity: seen ? (isLive ? 1 : 0.55) : 0,
                transform: seen ? 'scale(1)' : 'scale(0.4)',
                transformOrigin: `${p.cx}px ${p.cy}px`,
                transition: `opacity 480ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform 520ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
              }}
            />
            <text
              x={p.cx + 10} y={p.cy + 4}
              fontFamily="EB Garamond, Georgia, serif"
              fontStyle="italic"
              fontSize={isLive ? 13 : 11}
              fill={isLive ? C.light : C.lightMute}
              style={{
                opacity: seen ? 1 : 0,
                transition: `opacity 600ms cubic-bezier(0.22, 1, 0.36, 1) ${delay + 120}ms`,
              }}
            >
              {p.label}
            </text>
          </g>
        );
      })}

      {/* Legend (only two states, so a sentence beats a colour key). */}
      <text
        x="20" y="324"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="10"
        fill={C.lightMute}
        style={{
          opacity: seen ? 1 : 0,
          transition: 'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1) 1100ms',
        }}
      >
        live now in Bengaluru. the rest of Karnataka, soon.
      </text>
    </svg>
  );
}
