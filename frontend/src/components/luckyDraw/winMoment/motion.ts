/**
 * The win moment's clock, palette and geometry.
 *
 * Ported from the "Lucky Draw Winning Animation" design canvas. The canvas ran
 * on its own composition engine (window globals, a scrubbable stage, a tweaks
 * panel); none of that ships. What survives is the part that matters — one
 * authored time axis, `T` in seconds, and every beat written as a pure
 * function of it. Nothing mounts or unmounts at a beat boundary, so elements
 * carry across them by ordinary interpolation rather than by cutting.
 */

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const Easing = {
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t),
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

type Tween = (t: number) => number;

/** Single-segment tween. Holds `from` before `start` and `to` after `end`, so
 *  every beat below is safe to evaluate at any T without a guard. */
function animate(from: number, to: number, start: number, end: number, ease: (t: number) => number): Tween {
  return (t: number) => {
    if (t <= start) return from;
    if (t >= end) return to;
    return from + (to - from) * ease((t - start) / (end - start));
  };
}

/** Exactly three motion helpers — all easing in the piece goes through these,
 *  which is what keeps the timing feeling like one hand wrote it. */
export const MOTION = {
  enter: (from: number, to: number, start: number, end: number) => animate(from, to, start, end, Easing.easeOutCubic),
  draw: (from: number, to: number, start: number, end: number) => animate(from, to, start, end, Easing.easeInOutQuart),
  pop: (from: number, to: number, start: number, end: number) => animate(from, to, start, end, Easing.easeOutBack),
};

/** The authored beats, in order, with their durations in seconds. */
const SCENES: Array<[name: string, seconds: number]> = [
  ['Waiting', 2.6], // the twelve month dots glow clockwise, picking up speed
  ['Drop', 1.8],    // the chase lands on the top dot and flashes; the dots turn to oil
  ['Pour', 1.4],    // the oil rises inside the circle until the whole disc is gold
  ['Bloom', 1.6],   // the ring floods into a molten disc that turns like the ghani stone
  ['Reveal', 3.8],  // gravity inverts: the gold lifts off and leaves the name behind
  ['Settle', 2.4],  // the name settles and the claim button arrives
];

/** Cue table: beat name -> its start on the authored axis. Derived from the
 *  scene list so the two can never drift apart. */
export const CUES = SCENES.reduce<Record<string, number>>((table, [name], i) => {
  table[name] = SCENES.slice(0, i).reduce((sum, [, d]) => sum + d, 0);
  return table;
}, {});

export const AUTHORED_TOTAL = SCENES.reduce((sum, [, d]) => sum + d, 0);

/** The composition is authored on a fixed 1080x1920 field and scaled to the
 *  viewport, so every number in the beats is a design-space pixel. */
export const STAGE_W = 1080;
export const STAGE_H = 1920;

/** Circle centre and radius. CY sits above the geometric middle — the piece is
 *  optically centred on the circle, not on the frame. */
export const CX = 540;
export const CY = 900;
export const R = 300;

export const C = {
  deep: '#08251B',
  green: '#0E3A2B',
  greenLo: '#0A2E22',
  cream: '#F6F1E4',
  creamDim: 'rgba(246,241,228,0.62)',
  gold: '#D8A93F',
  goldLo: '#A8781F',
  goldHi: '#F7E3A1',
};

/** EB Garamond and Inter are already loaded by index.html; the canvas asked for
 *  Lora and Mukta, which are the same two roles. Reusing what the app ships
 *  keeps the reveal on-brand and costs no extra font request. */
export const FONT_D = "'EB Garamond', Georgia, serif";
export const FONT_B = "'Inter', system-ui, sans-serif";
