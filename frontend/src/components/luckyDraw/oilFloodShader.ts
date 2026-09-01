/**
 * Fragment shader for the Bhagya Chakra win reveal.
 *
 * The story, in one signed-distance field:
 *   drops fall, one after another, each arriving sooner than the last
 *   → the bottle fills a step higher with every one
 *   → the camera pushes into the bottle until the oil is the whole screen
 *
 * What makes it read as glass and oil rather than as coloured shapes:
 *
 *   • Refraction. The glass wall bends what is behind it. The wall normal
 *     comes from the SDF gradient, and the scene is re-sampled along it —
 *     with a slightly different offset per colour channel, which is where the
 *     prismatic fringe at the edge comes from.
 *   • Absorption. Colour is not painted on; it is light surviving a depth of
 *     oil. Beer-Lambert with blue absorbed fastest, so shallow oil is pale
 *     gold and deep oil goes amber on its own.
 *   • Caustics. Light focused through the body, animated on the parchment
 *     under the bottle.
 *   • A meniscus that climbs the glass, bubbles that rise, and a crown that
 *     is thrown off the surface each time a drop lands.
 *
 * The zoom is a coordinate transform, not a CSS scale — sampling a smaller
 * region of the same field. Nothing rasterises twice, so the bottle edge stays
 * razor sharp all the way in, and the push-in ends inside the oil, which is
 * how the gold takes the screen without a separate flood.
 *
 * Everything is a pure function of u_time: deterministic, seekable and
 * restartable, so the dev replay button just resets the clock.
 */
export const FRAG = `#version 300 es
precision highp float;

uniform vec2      u_res;
uniform float     u_time;
uniform sampler2D u_text;     // R = sharp glyphs, G = blurred field
uniform vec2      u_textHalf; // half-extent of that field, in sp units
out vec4 fragColor;

const vec3 BG    = vec3(0.992, 0.973, 0.941);  // parchment-100 #fdf8f0
const vec3 DARK  = vec3(0.105, 0.086, 0.066);  // the room before any light
const vec3 LIGHT = vec3(1.000, 0.945, 0.820);  // the light entering the oil
const vec3 GLASS = vec3(0.541, 0.400, 0.180);

// ── beat sheet, in seconds. Gaps close: the pours accelerate. ──
const float L0 = 0.70;
const float L1 = 1.25;
const float L2 = 1.70;
const float L3 = 2.05;
const float L4 = 2.30;
// Act one: the camera arrives, the floor opens, the bottle rises out of it.
const float DOLLY_END  = 1.10;   // the camera settles
const float IRIS_T     = 0.95;   // the floor starts to open
const float IRIS_DUR   = 0.90;
const float RISE_T     = 1.60;   // the bottle comes up
const float RISE_DUR   = 0.85;
const float RISE_DEPTH = 0.80;   // far enough down that none of it shows
const float PLATE_R    = 0.42;
const float FLOOR_Y    = -0.372;
const float IRIS_R     = 0.235;

// Act two onward hangs off T0, so the opening can be retimed without touching
// a single downstream constant.
const float T0 = 2.55;

const float POUR_START = T0 + 0.40;   // the stream opens
const float POUR_REACH = 0.55;   // how long the leading edge takes to arrive
const float POUR_END   = T0 + 2.35;   // the source shuts off
const float ZOOM_IN  = T0 + 2.45;
const float ZOOM_END = T0 + 3.30;
const float FALL_DUR = 0.70;
const float COPY_T   = T0 + 3.35;   // the words arrive
const float CATH_T   = T0 + 3.15;   // the view settles under the surface
const float BLAZE    = T0 + 2.30;   // the last pour blows the exposure open
const float TYPE_T   = T0 + 3.05;   // the words start to surface
const float CONF_T   = T0 + 3.05;   // and the fall begins with them, as one event
const float TYPE_DUR = 1.40;
const float TYPE_Y   = -0.08;  // where they come to rest
const float SURF_Y   = -0.30;  // the surface they rise out of

// ── bottle geometry ──
// A real bottle profile, not a rounded rectangle: straight-ish body walls, a
// shoulder that tapers into the neck, and a collar lip at the mouth. The lip
// is a hard union so it keeps a crisp edge where the glass thickens, which is
// the single strongest cue that this is a bottle and not an icon.
const vec2  BODY_C = vec2(0.0, -0.115);
const vec2  BODY_H = vec2(0.155, 0.235);
const vec2  SHLD_C = vec2(0.0,  0.115);
const vec2  SHLD_H = vec2(0.105, 0.055);
const vec2  NECK_C = vec2(0.0,  0.225);
const vec2  NECK_H = vec2(0.048, 0.105);
const vec2  LIP_C  = vec2(0.0,  0.320);
const vec2  LIP_H  = vec2(0.062, 0.020);
const float OIL_BOTTOM = -0.332;
const float OIL_TOP    =  0.300;
const float NECK_MOUTH =  0.285;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdEllipse(vec2 p, vec2 r) {
  return (length(p / r) - 1.0) * min(r.x, r.y);
}

/**
 * The hatch the camera cranes down onto: a brushed steel plate with concentric
 * grooves, radial seams, bolt heads and a highlight grazing its far edge.
 *
 * squash is the y/x ratio of the disc, and it is the whole cinematic trick:
 * a circle seen from high above is nearly round, and nearly a line seen from
 * floor level. Animating it as the camera descends is what reads as a crane
 * move rather than a pan.
 */
/**
 * The floor the plate is set into, in perspective.
 *
 * This exists to make the camera move legible. With a single object on an empty
 * background there is no way to tell a camera descending from an object tilting
 * — no parallax, no reference. A receding floor whose convergence changes with
 * camera height is the cue that the viewer is the thing that moved.
 *
 * Pinhole model, camera looking level from camH above the floor: a floor pixel
 * at screen height sp.y lies at depth camH / -sp.y, with the horizon at sp.y=0.
 */
vec4 floorPlane(vec2 sp, float camH) {
  if (sp.y > -0.015) return vec4(0.0);
  float z = camH / (-sp.y);
  if (z > 30.0) return vec4(0.0);
  float X = sp.x * z;

  vec3 col = vec3(0.052, 0.047, 0.041);
  col += vec3(0.028) * fbm(vec2(X * 1.2, z * 1.2));

  // Panel seams. They converge toward the horizon on their own because they
  // are laid out in world space, not screen space.
  float gx = abs(fract(X * 1.6) - 0.5);
  float gz = abs(fract(z * 0.55) - 0.5);
  col = mix(col, vec3(0.112, 0.105, 0.095), 1.0 - smoothstep(0.0, 0.05, min(gx, gz)));

  return vec4(col, 1.0 - smoothstep(4.0, 20.0, z));
}

vec4 plate(vec2 p, float t, float squash, float cy) {
  vec2 q = (p - vec2(0.0, cy)) / vec2(PLATE_R, PLATE_R * squash);
  float r = length(q);
  if (r > 1.06) return vec4(0.0);
  float a = atan(q.y, q.x);

  // Polished steel, so the grain is only a whisper — a strong grain reads as
  // cast or brushed, never as shiny.
  float grain = fbm(vec2(a * 34.0, r * 5.0));
  vec3 col = vec3(0.255, 0.245, 0.228) * (0.95 + 0.10 * grain);

  // What makes metal look shiny is not brightness, it is reflecting something.
  // A polished horizontal disc mirrors the room above it, brightest toward the
  // far edge where the reflection angle is shallowest.
  float refl = smoothstep(-0.9, 1.0, sin(a)) * smoothstep(0.05, 1.0, r);
  col = mix(col, vec3(0.62, 0.60, 0.56), refl * 0.55);
  col = mix(col, vec3(0.075, 0.070, 0.062), smoothstep(0.35, -0.95, sin(a)) * 0.55);

  // Two tight speculars where the highlight wraps the surface. Narrow and hot,
  // not broad and soft.
  float aniso = pow(abs(sin(a - 0.55)), 44.0) + 0.75 * pow(abs(sin(a + 2.30)), 60.0);
  col += vec3(1.00, 0.97, 0.90) * aniso * smoothstep(0.12, 0.95, r) * 0.85;

  // A glint that travels around the rim as the camera descends.
  float glint = pow(max(0.0, sin(a * 1.0 - t * 1.4)), 90.0);
  col += vec3(1.0, 0.98, 0.94) * glint * smoothstep(0.72, 1.0, r) * 0.9;

  // Machined grooves, shaded off their own slope so they read as cut into the
  // surface rather than drawn on it.
  float gw = fract(r * 15.0);
  float slope = (gw < 0.5) ? gw * 2.0 : (1.0 - gw) * 2.0;
  col *= 0.80 + 0.34 * slope;
  col += vec3(0.10) * smoothstep(0.85, 1.0, slope) * smoothstep(0.2, 0.8, r);

  // ── iris blades ──
  // Eight wedges that rotate as they withdraw. Their inner edge retracts
  // outward, which is what opens the aperture.
  float k = clamp((t - IRIS_T) / IRIS_DUR, 0.0, 1.0);
  float shut = smoothstep(RISE_T + RISE_DUR * 0.6, RISE_T + RISE_DUR + 0.55, t);
  float open = clamp(k - shut, 0.0, 1.0);

  const float SECT = 0.78539816;                  // 2pi / 8
  float rot = open * 0.62 + 0.20;
  float la = mod(a + rot + SECT * 0.5, SECT) - SECT * 0.5;
  float rin = mix(0.055, 0.98, open);             // inner edge of the blades
  float blade = (1.0 - smoothstep(SECT * 0.40, SECT * 0.45, abs(la)))
              * smoothstep(rin - 0.02, rin + 0.02, r)
              * (1.0 - smoothstep(0.94, 0.98, r));
  // Each blade is lit across its own width: bright leading edge, dark trailing.
  vec3 bladeCol = vec3(0.34, 0.325, 0.295) * (0.55 + 1.25 * smoothstep(-SECT * 0.45, SECT * 0.18, la));
  // Hot line down each blade's leading edge: a polished bevel catching light.
  bladeCol += vec3(1.0, 0.98, 0.93) * pow(1.0 - smoothstep(0.0, SECT * 0.06, abs(abs(la) - SECT * 0.42)), 2.0) * 0.8;
  bladeCol = mix(bladeCol, vec3(0.66, 0.64, 0.60), refl * 0.45);
  col = mix(col, bladeCol, blade);

  // Machined bevel around the aperture, and the plate's outer edge.
  col += vec3(0.95, 0.92, 0.86) * pow(1.0 - smoothstep(0.0, 0.026, abs(r - rin)), 1.6) * (0.35 + 0.75 * open);
  col += vec3(0.90, 0.88, 0.83) * pow(1.0 - smoothstep(0.0, 0.020, abs(r - 1.0)), 1.6) * 0.85;

  // Bolt heads, domed: lit top-left, shadowed bottom-right, in a cut recess.
  for (int i = 0; i < 8; i++) {
    float ang = float(i) * SECT + SECT * 0.5;
    vec2 bp = vec2(cos(ang), sin(ang)) * 0.885;
    vec2 bd = q - bp;
    float br = length(bd);
    float m = 1.0 - smoothstep(0.040, 0.048, br);
    if (m < 0.001) continue;
    float dome = clamp(dot(normalize(bd + 1e-6), normalize(vec2(-0.6, 0.8))), -1.0, 1.0);
    vec3 bc = vec3(0.34, 0.32, 0.29) * (0.72 - 0.34 * dome);
    bc += vec3(0.30) * pow(max(0.0, -dome), 5.0);
    col = mix(col, bc, m);
    col *= 1.0 - 0.45 * (1.0 - smoothstep(0.046, 0.056, br)) * (1.0 - m);  // recess
  }

  return vec4(col, 1.0 - smoothstep(1.0, 1.04, r));
}

/** The lift pushing the bottle up through the aperture. */
vec4 platform(vec2 p, float squash, float cy, float rise) {
  float top = -0.35 + rise;                  // the bottle stands on this
  float R = 0.175;
  float side = max(max(abs(p.x) - R, p.y - top), (cy - 0.03) - p.y);
  float face = sdEllipse(p - vec2(0.0, top), vec2(R, R * squash));
  float d = min(side, face);
  float m = 1.0 - smoothstep(0.0, 0.004, d);
  if (m < 0.002) return vec4(0.0);
  float lit = 1.0 - smoothstep(0.0, 0.006, face);
  vec3 col = mix(vec3(0.150, 0.140, 0.122), vec3(0.335, 0.305, 0.265), lit);
  col += vec3(0.10) * (1.0 - smoothstep(0.0, 0.010, abs(face)));
  return vec4(col, m);
}

/** How far the bottle still is from fully up. 0 once it has arrived. */
float bottleRise(float t) {
  float k = clamp((t - RISE_T) / RISE_DUR, 0.0, 1.0);
  return mix(-RISE_DEPTH, 0.0, 1.0 - pow(1.0 - k, 3.0));   // ease-out cubic
}

/**
 * The floor iris. A circle seen at a shallow angle, so it is evaluated in
 * squashed space and everything after works in ordinary polar coordinates: a
 * housing ring, blade spokes that rotate as they retract, an aperture whose
 * radius grows, and light spilling out once it is open.
 *
 * Emissive — it is a light source, so it is added after the exposure curve
 * rather than being lit by it.
 */
vec3 iris(vec2 p, float t, float squash, float cy) {
  float k = clamp((t - IRIS_T) / IRIS_DUR, 0.0, 1.0);
  float shut = smoothstep(RISE_T + RISE_DUR * 0.6, RISE_T + RISE_DUR + 0.55, t);
  float open = clamp(k - shut, 0.0, 1.0);
  if (open <= 0.001) return vec3(0.0);

  vec2 q = (p - vec2(0.0, cy)) / vec2(IRIS_R, IRIS_R * squash);
  float r = length(q);
  if (r > 1.15) return vec3(0.0);

  // Only the light: the blades and the housing are metal, handled in plate().
  float hole = 0.90 * open;
  float glow = smoothstep(hole, hole * 0.10, r) * 0.85;          // out of the hole
  glow += exp(-pow((r - hole) * 11.0, 2.0)) * 0.95;              // hot rim
  glow *= 1.0 - smoothstep(1.02, 1.15, r);
  return vec3(1.0, 0.86, 0.55) * glow * open;
}

float bottleSDF(vec2 p) {
  float body = sdRoundBox(p - BODY_C, BODY_H, 0.048);
  float shld = sdRoundBox(p - SHLD_C, SHLD_H, 0.052);
  float neck = sdRoundBox(p - NECK_C, NECK_H, 0.020);
  float lip  = sdRoundBox(p - LIP_C,  LIP_H,  0.010);
  float d = smin(body, shld, 0.075);   // the shoulder curve
  d = smin(d, neck, 0.045);
  return min(d, lip);                  // hard union keeps the collar crisp
}

/**
 * How full the bottle is, 0-1. A single continuous ramp: the level climbs the
 * whole time the stream is running. Five discrete steps read as five separate
 * events with pauses between them, which is not what filling a bottle looks
 * like. Slightly eased at the open, where the stream is still thin.
 */
float fillAmount(float t) {
  // Nothing accumulates until the leading edge has fallen the length of the
  // bottle. Filling from the instant the stream appears reads as the level
  // being animated rather than as oil arriving.
  float t0 = POUR_START + POUR_REACH;
  float k = clamp((t - t0) / (POUR_END - t0), 0.0, 1.0);
  return pow(k, 0.88);
}

/**
 * How much light is in the scene. The spine of the whole piece: it opens in
 * near-darkness lit only by the falling oil, brightens in step with the level
 * in the bottle — the bottle is the lamp — and blows past 1.0 as it tops out.
 * Without that range the gold at the end is just another shade of gold.
 */
float exposure(float t) {
  float e = 0.20;
  e += 0.42 * fillAmount(t);
  e += 0.76 * pow(smoothstep(BLAZE, BLAZE + 0.42, t), 0.72);
  return e;
}

/**
 * The stream. A ribbon from above the frame into the neck, thinning as it
 * accelerates and wandering slightly, the way a thin pour of something viscous
 * does. Fades in at the open and pinches off at the end.
 */
float stream(vec2 p, float t, float fill) {
  float on = smoothstep(POUR_START, POUR_START + 0.09, t);
  if (on < 0.01) return 1e5;

  const float V0 = 1.10;   // speed leaving the mouth
  const float G  = 3.00;   // gravity, in these units
  const float W0 = 0.021;  // half-width at the mouth

  float src = 0.94;
  float lvl = mix(OIL_BOTTOM, OIL_TOP, fill) + 0.004;

  // Shut-off: the source retreats downward and the tail falls away, instead of
  // the whole ribbon fading out uniformly — a fade reads as a dissolve.
  float shut = smoothstep(POUR_END, POUR_END + 0.30, t);
  float top = mix(src, lvl, shut);

  // The leading edge free-falls from the mouth, so the column grows downward
  // at the start rather than appearing at full length.
  float te = max(t - POUR_START, 0.0);
  float front = top - (V0 * te + 0.5 * G * te * te);
  float bot = max(lvl, front);
  if (top <= bot + 0.0015) return 1e5;

  // Mass conservation: A*v is constant and v = sqrt(V0^2 + 2*G*h), so the
  // width goes as v^-1/2 — nearly all the thinning happens just below the
  // mouth and then it barely narrows at all. A linear taper is wrong precisely
  // because it keeps thinning the whole way down.
  float h = clamp(top - p.y, 0.0, 2.0);
  float v = sqrt(V0 * V0 + 2.0 * G * h);
  float w = W0 * sqrt(V0 / v);

  // Rayleigh–Plateau: a falling column is unstable and grows travelling
  // bulges. Something as viscous as oil beads smoothly instead of breaking
  // into drops, and the beads are carried down with the flow.
  w *= 1.0 + 0.17 * sin(h * 40.0 - t * 9.0) * smoothstep(0.05, 0.32, h);

  // It spreads where it enters the oil.
  w *= 1.0 + 0.85 * smoothstep(0.045, 0.0, p.y - bot);
  w *= on;

  // Lateral wander is advected downward and grows with distance from the
  // mouth, where the flow is still coherent.
  float wander = 0.0085 * sin(h * 8.5 - t * 4.0) * smoothstep(0.0, 0.28, h)
               + 0.0045 * sin(t * 1.25);

  float dy = max(p.y - top, bot - p.y);
  return max(abs(p.x - wander) - w, dy);
}

/** The liquid plane's height at x, before perspective. */
float planeAt(float x, float t, float fill) {
  float s = mix(OIL_BOTTOM, OIL_TOP, fill);
  float agitate = (1.0 - 0.55 * fill) * smoothstep(0.0, 0.4, fill);
  s += 0.007 * sin(x * 26.0 - t * 2.6) * agitate;
  s += 0.004 * sin(x * 41.0 + t * 3.7) * agitate;
  // Surface tension pulls the oil up the wall — small, but its absence is
  // exactly what makes CG liquid read as a coloured rectangle.
  s += 0.013 * smoothstep(0.100, 0.155, abs(x));
  return s;
}

/** Half-height of the surface ellipse — how far down you are looking at it. */
float domeAt(float x) {
  float k = clamp(x / 0.150, -1.0, 1.0);
  return 0.021 * sqrt(max(0.0, 1.0 - k * k));
}

/**
 * The visible top of the liquid. You look slightly down at a bottle, so the
 * surface is an ellipse: its far rim rides high at the centre and its near rim
 * dips below. Drawn as a flat line — which is what this was — liquid reads as
 * a coloured rectangle no matter how good the shading above it is.
 */
float surfaceAt(float x, float t, float fill) {
  return planeAt(x, t, fill) + domeAt(x);
}

/** The oil body: inside the glass, below the surface, with drops fused in. */
float oilSDF(vec2 p, float t, float fill) {
  float inner = bottleSDF(p) + 0.013;
  float d = max(inner, p.y - surfaceAt(p.x, t, fill));
  d = smin(d, stream(p, t, fill), 0.042);
  d += (fbm(p * 4.2 + vec2(0.0, t * 0.4)) - 0.5) * 0.010 * smoothstep(0.05, 0.5, fill);
  return d;
}

/** Animated caustic pattern — light focused through the oil. */
float caustics(vec2 q, float t) {
  // Each octave is rotated as well as scaled. Without the rotation every layer
  // shares the same axes and the result reads as a rectangular grid rather
  // than as focused light.
  const mat2 ROT = mat2(0.80, -0.60, 0.60, 0.80);
  vec2 a = q * 8.0;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    a = ROT * a * 1.63 + vec2(t * 0.22, -t * 0.17);
    s += (abs(sin(a.x)) + abs(cos(a.y))) * 0.33;
  }
  return pow(max(0.0, 1.0 - s * 0.62), 3.0);
}

/**
 * The splash where the stream meets the surface. Continuous while pouring
 * rather than one crown per landing — a running stream disturbs the surface the
 * whole time it is running.
 */
/**
 * The fall: thin gold-leaf flakes and marigold petals sinking through oil.
 *
 * The physics are deliberately not a confetti library's. In oil there is no
 * flutter and no zig-zag — each flake reaches terminal velocity at once and
 * sinks steadily, tumbling on its own axis under heavy drag. That slowness is
 * what keeps the fall inside the world the rest of the piece built.
 *
 * A flake is thin, so face-on it catches light and edge-on it nearly vanishes.
 * Scaling its width by |cos(angle)| as it turns, and spiking brightness at the
 * same moment, is what produces the winking: the flash is the effect, not the
 * colour.
 *
 * Three depth layers — near flakes larger, softer and faster, far ones small,
 * slow and dim. A single layer of uniform particles is what makes CG confetti
 * look pasted on. Returns premultiplied colour so petals read as opaque rather
 * than glowing additively.
 */
vec4 confetti(vec2 sp, float t) {
  float on = smoothstep(CONF_T, CONF_T + 0.45, t);
  if (on < 0.01) return vec4(0.0);

  vec3 acc = vec3(0.0);
  float aAcc = 0.0;

  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float s1 = hash21(vec2(fi, 1.7));
    float s2 = hash21(vec2(fi, 9.3));
    float s3 = hash21(vec2(fi, 4.1));

    float lf = mod(fi, 3.0) * 0.5;          // 0 far, 0.5 mid, 1 near
    float speed = mix(0.050, 0.150, lf);
    float size  = mix(0.006, 0.017, lf);
    float dim   = mix(0.42, 1.00, lf);

    float ph = fract((t - CONF_T) * speed + s1 * 1.37);
    float x  = (s1 - 0.5) * 1.18 + 0.030 * sin(t * 0.5 + fi);
    float y  = mix(0.96, -0.96, ph);

    float ang  = t * (1.5 + 2.3 * s2) + s3 * 6.283;
    float face = abs(cos(ang));
    vec2  r    = vec2(size * max(0.10, face), size * 0.70);

    float d  = sdEllipse(sp - vec2(x, y), r);
    float aa = 0.0035 + 0.0055 * lf;        // near layer softer: depth of field
    float m  = (1.0 - smoothstep(-aa, aa, d)) * dim * on
             * smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.86, 1.0, ph));
    if (m < 0.002) continue;

    bool leaf = s2 > 0.42;
    vec3 c = leaf ? vec3(1.00, 0.94, 0.72) : vec3(0.93, 0.47, 0.12);
    c += (leaf ? vec3(0.55, 0.48, 0.30) : vec3(0.28, 0.15, 0.04)) * pow(face, 6.0);

    acc  += c * m;
    aAcc += m;
  }
  return vec4(acc, aAcc);
}

float crown(vec2 p, float t, float fill) {
  float on = smoothstep(POUR_START + POUR_REACH, POUR_START + POUR_REACH + 0.20, t)
           * (1.0 - smoothstep(POUR_END - 0.05, POUR_END + 0.18, t));
  if (on < 0.02) return 1e5;
  float surf = mix(OIL_BOTTOM, OIL_TOP, fill);
  float d = 1e5;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    // Each fleck runs its own short loop, so the splash keeps renewing.
    float ph = fract(t * (1.7 + 0.5 * fi) + fi * 0.31);
    float dir = (mod(fi, 2.0) < 0.5) ? -1.0 : 1.0;
    float x = dir * (0.012 + 0.020 * ph);
    float y = surf + 0.045 * sin(3.1416 * ph) + 0.010;
    float rr = 0.006 * (1.0 - smoothstep(0.5, 1.0, ph)) * on;
    if (rr > 0.0005) d = min(d, sdEllipse(p - vec2(x, y), vec2(rr, rr)));
  }
  return d;
}

/** Bubbles rising through the oil once there is enough of it. */
float bubbles(vec2 p, float t, float fill) {
  if (fill < 0.18) return 1e5;
  float surf = mix(OIL_BOTTOM, OIL_TOP, fill);
  float d = 1e5;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float seed = hash21(vec2(fi, 3.0));
    float ph = fract(t * (0.20 + 0.07 * seed) + seed * 2.7);
    float x = (seed - 0.5) * 0.16 + 0.012 * sin(t * 2.1 + fi);
    float y = mix(OIL_BOTTOM + 0.015, surf - 0.012, ph);
    float rr = (0.0035 + 0.0030 * seed) * (1.0 - smoothstep(0.85, 1.0, ph));
    if (rr > 0.0005) d = min(d, sdEllipse(p - vec2(x, y), vec2(rr, rr)));
  }
  return d;
}

/** Colour of the oil at a point: light that survived a depth of it. */
vec3 oilColour(vec2 p, vec2 sp, float oil, float t, float fill) {
  float surf = surfaceAt(p.x, t, fill);
  // Depth is capped: past roughly a fifth of the bottle the extra absorption
  // only drags the whole field toward brown, and the push-in ends deep inside
  // the oil where that would be the entire screen.
  float depth = clamp(surf - p.y, 0.0, 0.22);

  // Beer-Lambert. Blue is absorbed fastest, so depth turns the light amber
  // without any colour being authored per band.
  vec3 col = LIGHT * exp(-vec3(0.7, 1.5, 2.9) * depth);

  // Edge darkening where the body thins against the glass. Note the order:
  // the smoothstep is 0 deep inside and 1 at the rim, so the dark end belongs
  // to the second argument. Reversed, it dims the entire interior — which is
  // the whole screen once the camera is inside the oil.
  col *= mix(1.0, 0.78, smoothstep(-0.10, -0.012, oil));

  // Sheen and caustics are sampled in screen space, not bottle space. In
  // bottle space the push-in magnifies them 13x and the final frame is a flat
  // field of colour; in screen space the oil keeps moving all the way in.
  float sheen = fbm(sp * 2.6 + vec2(t * 0.16, t * 0.26));
  col += 0.048 * smoothstep(0.60, 0.96, sheen);

  col += 0.065 * caustics(sp * 1.4, t) * smoothstep(0.1, 0.6, fill);

  // Bright meniscus line where oil meets glass.
  col = mix(col, vec3(1.0, 0.97, 0.87), (1.0 - smoothstep(0.0, 0.008, abs(oil))) * 0.28);

  // The surface read as a plane rather than an edge: the band between the far
  // rim and the near rim catches light, and the near rim itself is a bright
  // line. This is the difference between "liquid" and "the top of a shape".
  float plane = planeAt(p.x, t, fill);
  float dome = domeAt(p.x);
  float band = smoothstep(0.0, 0.010, p.y - (plane - dome)) *
               smoothstep(0.0, 0.012, (plane + dome) - p.y);
  col += vec3(0.16, 0.13, 0.08) * band;
  float nearRim = smoothstep(0.0045, 0.0, abs(p.y - (plane - dome)));
  col = mix(col, vec3(1.0, 0.98, 0.90), nearRim * 0.34);
  return col;
}

void main() {
  vec2 sp = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);

  // Handheld float. Two incommensurate frequencies per axis plus a slow roll,
  // so the frame never sits perfectly still and never visibly repeats. Small
  // enough (a few px) that the DOM copy layered on top doesn't drift out of
  // register with it.
  float t = u_time;
  float roll = sin(t * 0.19) * 0.013;
  vec2  bob  = vec2(sin(t * 0.31) * 0.013 + sin(t * 0.17) * 0.007,
                    cos(t * 0.23) * 0.011 + sin(t * 0.13) * 0.005);
  sp = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * sp + bob;

  // The push in: sample a smaller slice of the same field. No interpolation,
  // so the glass edge stays sharp at any magnification.
  // The crane. Three things move together: the camera drops from a high angle
  // to floor level (squash), the plate travels down the frame (plateY), and the
  // camera pulls back off it (dolly). The perspective change is what sells the
  // descent — a pan alone would just slide a static ellipse around.
  float cam = pow(smoothstep(0.0, DOLLY_END, t), 0.75);

  // The only thing being animated is the camera's height above the floor.
  // Everything else — where the plate sits on screen, how squashed it looks,
  // where the horizon falls, how fast the floor converges — is derived from it,
  // so the whole frame moves as one consistent observer rather than as parts.
  float camH = mix(0.95, -FLOOR_Y, cam);
  float plateY = -camH;                                  // it lies at depth 1
  float squash = camH / sqrt(camH * camH + 1.0);          // sine of the elevation
  float dolly = mix(1.22, 1.0, pow(smoothstep(0.0, DOLLY_END, t), 0.70));

  // It clips into place: a damped mechanical judder as the mount locks.
  float clipJ = step(DOLLY_END, t) * exp(-max(t - DOLLY_END, 0.0) * 20.0)
              * sin((t - DOLLY_END) * 58.0) * 0.007;

  float zoom = dolly + 13.0 * pow(smoothstep(ZOOM_IN, ZOOM_END, t), 1.7);
  vec2 p = (sp - BODY_C) / zoom + BODY_C + vec2(0.0, clipJ);

  // The bottle gets its own space so it can rise out of the floor while the
  // floor, the iris and the shadow stay put in the world.
  float rise = bottleRise(t);
  float risen = 1.0 - clamp(-rise / RISE_DEPTH, 0.0, 1.0);
  vec2 pq = p - vec2(0.0, rise + plateY + 0.35);

  // Nothing draws below the plate: while it is still coming up, the bottom of
  // the bottle is under the floor.
  float aboveFloor = smoothstep(plateY - 0.010, plateY + 0.012, p.y);

  // Once the camera is inside the bottle the glass, its highlights and the
  // bubbles are behind the lens. Left visible they band into nested rectangles
  // as fwidth blows up at magnification.
  float structure = 1.0 - smoothstep(2.0, 5.5, zoom);

  float expo = exposure(t);
  float e01 = clamp(expo, 0.0, 1.0);
  vec3 GROUND = mix(DARK, BG, e01);

  float fill = fillAmount(t);
  float bottle = bottleSDF(pq);

  // ── glass normal, from the SDF gradient ──
  vec2 e = vec2(0.0015, 0.0);
  vec2 n = normalize(vec2(
    bottleSDF(pq + e.xy) - bottleSDF(pq - e.xy),
    bottleSDF(pq + e.yx) - bottleSDF(pq - e.yx)
  ) + 1e-6);

  float wall = abs(bottle) - 0.0075;
  float wallMask = (1.0 - smoothstep(0.0, fwidth(bottle) * 1.5 + 1e-5, wall)) * aboveFloor;

  // ── refraction with dispersion: three offsets, one per channel ──
  float refr = 0.030 * wallMask;
  vec3 oilRGB;
  {
    vec2 pr = pq - n * refr * 0.90;
    vec2 pg = pq - n * refr * 1.00;
    vec2 pb = pq - n * refr * 1.12;
    float oR = oilSDF(pr, t, fill);
    float oG = oilSDF(pg, t, fill);
    float oB = oilSDF(pb, t, fill);
    float aaR = fwidth(oR) * 1.1 + 1e-5;
    float aaG = fwidth(oG) * 1.1 + 1e-5;
    float aaB = fwidth(oB) * 1.1 + 1e-5;
    vec3 cR = oilColour(pr, sp, oR, t, fill);
    vec3 cG = oilColour(pg, sp, oG, t, fill);
    vec3 cB = oilColour(pb, sp, oB, t, fill);
    float mR = 1.0 - smoothstep(-aaR, aaR, oR);
    float mG = 1.0 - smoothstep(-aaG, aaG, oG);
    float mB = 1.0 - smoothstep(-aaB, aaB, oB);
    // Each channel composites against the parchment through its own offset —
    // that mismatch at the boundary is the prismatic fringe.
    oilRGB = vec3(mix(GROUND.r, cR.r, mR), mix(GROUND.g, cG.g, mG), mix(GROUND.b, cB.b, mB));
  }

  float oil = oilSDF(pq, t, fill);
  float aaO = fwidth(oil) * 1.1 + 1e-5;
  float mOil = (1.0 - smoothstep(-aaO, aaO, oil)) * aboveFloor;

  // ── the scene ──
  vec3 col = GROUND;

  // The room, then the hatch, then the lift — all under the bottle.
  vec4 fl = floorPlane(sp, camH);
  col = mix(col, fl.rgb, fl.a);

  // The hatch, then the lift rising through it — both under the bottle.
  vec4 pl = plate(p, t, squash, plateY);
  col = mix(col, pl.rgb, pl.a);
  vec4 lift = platform(p, squash, plateY, rise + plateY + 0.35);
  // The lift sits in a shaft: below the plate you can only see it through the
  // aperture. Unmasked, its disc shows off the bottom of frame long before the
  // iris has opened.
  float apMask = 1.0 - smoothstep(0.86, 1.0,
    length((p - vec2(0.0, plateY)) / vec2(IRIS_R, IRIS_R * squash)));
  float irisOpen = clamp(clamp((t - IRIS_T) / IRIS_DUR, 0.0, 1.0)
                  - smoothstep(RISE_T + RISE_DUR * 0.6, RISE_T + RISE_DUR + 0.55, t), 0.0, 1.0);
  col = mix(col, lift.rgb, lift.a * max(aboveFloor, apMask * irisOpen));

  // Contact shadow: the bottle is standing on something. Without it the
  // glass floats and no amount of highlight detail reads as real.
  float shp = length((p - vec2(0.0, -0.368)) / vec2(0.215, 0.028));
  col = mix(col, vec3(0.882, 0.845, 0.788), (1.0 - smoothstep(0.35, 1.0, shp)) * 0.55 * structure * risen);

  // Caustics thrown onto the parchment beneath the bottle.
  float below = smoothstep(0.0, 0.30, BODY_C.y + BODY_H.y - p.y);
  float near = 1.0 - smoothstep(0.14, 0.34, abs(p.x));
  col = mix(col, vec3(0.98, 0.90, 0.74),
            caustics(p * 1.15 + vec2(0.0, 0.1), t) * below * near * 0.30 * smoothstep(0.08, 0.55, fill) * structure);

  float ab = fwidth(bottle) * 1.1 + 1e-5;
  float mGlassBody = (1.0 - smoothstep(-ab, ab, bottle)) * aboveFloor;
  // Barely-there tint. Glass you can't see through is plastic.
  col = mix(col, vec3(0.985, 0.967, 0.936), mGlassBody * 0.22 * structure);

  col = mix(col, oilRGB, max(mOil, wallMask * mGlassBody));

  // Crown and bubbles ride on top of the body.
  float cr = crown(pq, t, fill);
  float mCr = 1.0 - smoothstep(-0.002, 0.002, cr);
  col = mix(col, vec3(0.97, 0.86, 0.60), mCr * structure);

  float bb = bubbles(pq, t, fill);
  float mBb = 1.0 - smoothstep(-0.0015, 0.0015, bb);
  col = mix(col, vec3(1.0, 0.96, 0.84), mBb * 0.55 * mOil * structure);

  // ── the glass itself ──
  // The wall is not a constant-width stroke. Its darkness follows how oblique
  // the surface is — strong down the curved sides, nearly gone across the flat
  // front — which is the difference between glass and a drawn outline.
  float mWall = (1.0 - smoothstep(-ab, ab, wall)) * aboveFloor;
  float oblique = smoothstep(0.35, 1.0, abs(n.x));
  col = mix(col, GLASS, mWall * (0.06 + 0.30 * oblique) * structure);

  // Glass thickness. Looking through the curved sides you traverse far more
  // glass than through the middle, so both edges darken. This is what stops
  // the bottle reading as a flat tinted cutout.
  float thickness = 1.0 - smoothstep(0.0, 0.055, -bottle);
  col *= mix(1.0, 0.62, thickness * mGlassBody * structure);

  // Two-source studio lighting: a broad soft key down the left face and a
  // narrow hard kicker on the right edge. One highlight reads as plastic.
  float inside = step(0.0, -bottle) * aboveFloor;
  float key = smoothstep(0.055, 0.0, abs(p.x + 0.095)) * smoothstep(0.20, -0.26, p.y) * inside;
  col += vec3(1.0, 0.98, 0.93) * key * 0.13 * structure;

  float kicker = smoothstep(0.014, 0.0, abs(p.x - 0.128)) * smoothstep(0.16, -0.24, p.y) * inside;
  col += vec3(1.0, 0.99, 0.95) * kicker * 0.22 * structure;

  // A tight rim of light riding the silhouette itself.
  float rimL = smoothstep(0.010, 0.0, abs(bottle)) * smoothstep(-0.05, 0.14, p.x) * aboveFloor;
  col += vec3(1.0, 0.97, 0.88) * rimL * 0.16 * structure;

  // The base is solid glass — a bright line where the floor of the bottle
  // catches light beneath the oil.
  float baseLine = smoothstep(0.010, 0.0, abs(p.y + 0.318)) * smoothstep(0.150, 0.10, abs(p.x)) * inside;
  col += vec3(1.0, 0.96, 0.86) * baseLine * 0.17 * structure;

  // ── the cathedral ──
  // Once the camera is inside the oil it settles below the surface and looks
  // up. Everything from here is light: shafts coming down through the body,
  // caustics crawling overhead in perspective, and dust suspended in between.
  // No burst and no particles thrown at the viewer — the celebration is the
  // room, not an event inside it.
  float cath = smoothstep(CATH_T, CATH_T + 0.9, t);

  // A single soft bloom marks the transition, then gets out of the way.
  float flash = smoothstep(CATH_T, CATH_T + 0.20, t) * (1.0 - smoothstep(CATH_T + 0.25, CATH_T + 1.2, t));
  col += vec3(1.0, 0.94, 0.78) * flash * 0.22 * (1.0 - smoothstep(0.0, 0.9, length(sp)));

  // Light comes from above, so the body darkens toward the floor. Without this
  // gradient the shafts have nothing to be brighter than.
  col *= mix(1.0, mix(0.80, 1.08, smoothstep(-0.75, 0.75, sp.y)), cath);

  // Overhead caustics, projected. Dividing the sample coordinates by height
  // compresses the pattern as it recedes, so the surface reads as a plane
  // stretching away above you rather than wallpaper on the screen.
  float persp = 1.0 / max(0.10, 0.78 - sp.y);
  vec2  cc = vec2(sp.x * persp * 0.55, persp * 0.85 + t * 0.16);
  // Domain warp — currents moving through the light rather than a pattern
  // sliding rigidly past.
  cc += 0.085 * vec2(fbm(sp * 1.6 + vec2(t * 0.11, 0.0)),
                     fbm(sp * 1.6 - vec2(0.0, t * 0.13)));
  float caus = caustics(cc, t * 0.8);
  caus = max(caus, caustics(cc * 1.9 + vec2(3.1, -1.7), t * 0.5) * 0.6);
  // The divide has to be clamped or it explodes at the horizon, and the clamp
  // draws a hard seam. Fading the pattern out just below it hides the join:
  // the surface goes to pure light where it recedes, which is correct anyway.
  float horizon = 1.0 - smoothstep(0.50, 0.72, sp.y);
  col += vec3(1.0, 0.96, 0.85) * caus * cath * horizon
       * mix(0.07, 0.38, smoothstep(-0.35, 0.70, sp.y));
  col += vec3(1.0, 0.97, 0.88) * cath * smoothstep(0.52, 0.80, sp.y) * 0.10;

  // God rays: shafts from a source above, banded by noise across the angle and
  // falling off with distance. Analytic rather than marched — a loop of samples
  // per pixel buys very little here and costs a great deal on a phone.
  // The source drifts, so the shafts sweep across the frame.
  vec2  toL = sp - vec2(sin(t * 0.21) * 0.34, 1.18);
  float ang = atan(toL.x, -toL.y);
  float shaft = fbm(vec2(ang * 6.5, t * 0.13));
  shaft = pow(smoothstep(0.34, 0.92, shaft), 2.0);
  float falloff = exp(-length(toL) * 0.85);
  col += vec3(1.0, 0.95, 0.82) * shaft * falloff * cath * 0.34;

  // Dust suspended in the shafts — slow, and brighter where a shaft catches it.
  float motes = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float sd  = hash21(vec2(fi, 7.0));
    float sd2 = hash21(vec2(fi, 13.0));
    float ph = fract((t - CATH_T) * (0.045 + 0.05 * sd) + sd2);
    vec2  mp = vec2((sd - 0.5) * 1.15 + 0.035 * sin(t * 0.7 + fi), mix(-0.80, 0.80, ph));
    float rr = 0.0026 + 0.0028 * sd2;
    motes += (1.0 - smoothstep(0.0, 0.006, length(sp - mp) - rr))
           * smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.70, 1.0, ph));
  }
  col += vec3(1.0, 0.96, 0.84) * clamp(motes, 0.0, 1.0) * cath * (0.22 + 0.32 * shaft);

  // ── the exposure ──
  // Everything above is the scene as if fully lit. Here it is stopped down to
  // whatever light actually exists yet, then pushed past 1.0 on the blaze so
  // the arrival genuinely overexposes rather than merely brightening.
  col *= mix(0.46, 1.0, e01);
  col *= mix(1.0, 1.06, clamp(expo - 1.0, 0.0, 1.0));

  // Emission is added after the stop-down: in the dark the oil is the only
  // light source in the frame, so it must not be dimmed by the same curve.
  // Tight halo, not a bloom: at a wide radius the glow swallows the glass and
  // the oil level, which are the things the darkness is meant to reveal.
  // Clipped to the floor like everything else that belongs to the bottle.
  // Emission is added after the exposure curve, so it bypasses the geometry
  // masks — and the bottle's glow was visible hanging below the plate while it
  // was still under it.
  float pourGlow = exp(-max(oil, 0.0) * 42.0) * aboveFloor;
  col += vec3(1.00, 0.82, 0.46) * pourGlow * (1.0 - e01 * 0.80) * 0.26;

  // The floor iris — a light source in its own right, and for the first two
  // seconds the only one in the frame.
  col += iris(p, t, squash, plateY) * (1.0 - e01 * 0.45);

  // Rings of light running out from where the stream lands. Continuous while
  // pouring: in the dark this is most of what reveals the shape of the room.
  float pouring = smoothstep(POUR_START + POUR_REACH, POUR_START + POUR_REACH + 0.2, t)
                * (1.0 - smoothstep(POUR_END, POUR_END + 0.3, t));
  if (pouring > 0.01) {
    float surf = mix(OIL_BOTTOM, OIL_TOP, fill);
    float rd = length(sp - vec2(0.0, surf));
    float rings = 0.0;
    for (int i = 0; i < 3; i++) {
      float ph = fract(t * 0.9 + float(i) * 0.333);
      float rr = ph * 0.42;
      rings += exp(-pow((rd - rr) * 26.0, 2.0)) * (1.0 - ph);
    }
    col += vec3(1.0, 0.84, 0.48) * rings * pouring * (1.0 - e01 * 0.62) * 0.16;
  }

  // The copy sits on this. An oil-filled headline over undimmed oil is gold on
  // gold — nowhere near the 3:1 large-text minimum — so the light concentrates
  // overhead and the lower third falls into shade as the words arrive.
  float copyDim = smoothstep(COPY_T - 0.55, COPY_T + 0.35, t);
  float band = 1.0 - smoothstep(0.0, 0.58, abs(sp.y + 0.26));
  col *= mix(1.0, 0.42, copyDim * band);

  // ── liquid type ──
  // The words do not fade in; they surface. The glyph field is thresholded
  // from a blurred channel first, so early on the letters are bulging, merging
  // blobs held together by surface tension, joined back to the pool by threads
  // that thin and snap as they climb. Crossfading to the sharp channel is the
  // moment they stop being liquid and become type.
  float tk = clamp((t - TYPE_T) / TYPE_DUR, 0.0, 1.0);
  if (tk > 0.0) {
    // The words surface as a wave running left to right, upper line leading,
    // instead of the whole block rising as one slab. Every column of the glyph
    // field carries its own delay, so letters break through in sequence — and
    // the wavefront is visible as a bright bulge travelling across the words.
    float xn = clamp(sp.x / u_textHalf.x * 0.5 + 0.5, 0.0, 1.0);
    float yn = clamp((sp.y - TYPE_Y) / u_textHalf.y * 0.5 + 0.5, 0.0, 1.0);
    float delay = xn * 0.44 + (1.0 - yn) * 0.18;
    float lk = clamp((tk * 1.74 - delay) / 0.60, 0.0, 1.0);

    float rise   = pow(lk, 0.72);
    float harden = smoothstep(0.50, 1.0, lk);
    float wob    = (1.0 - smoothstep(0.28, 0.92, lk)) * 0.018;
    float front  = exp(-pow((lk - 0.52) * 3.6, 2.0));   // the breaking surface

    vec2 q = sp - vec2(0.0, mix(SURF_Y, TYPE_Y, rise));
    q.x += sin(sp.y * 15.0 + t * 5.2) * wob;
    q.y += sin(sp.x * 12.0 - t * 4.1) * wob;
    // Set type still breathes: metal that cooled but never went inert.
    q *= 1.0 + 0.007 * sin(t * 1.25);
    q.y += 0.004 * sin(t * 0.9);

    vec2 uv = q / u_textHalf * 0.5 + 0.5;
    vec2 f = vec2(0.0);
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      f = texture(u_text, vec2(uv.x, 1.0 - uv.y)).rg;
    }
    float field = mix(f.g, f.r, harden);
    float dText = (0.5 - field) * 0.22;

    // A bounded slab, not a half-plane. Left infinite, every pixel below the
    // surface line counts as inside the liquid and the bottom of the screen
    // fills with a hard-edged band of type colour.
    float dSurf = max(max(sp.y - (SURF_Y + 0.02), (SURF_Y - 0.06) - sp.y),
                      abs(sp.x) - 0.40);
    // And it only exists while this column is actually emerging. Present for
    // the whole rise it shows up in columns the wave has not reached yet, where
    // there is no glyph to attach to — which draws its own bare slab edge as a
    // hard wedge sitting beside the words.
    float slabOn = smoothstep(0.02, 0.20, lk) * (1.0 - smoothstep(0.50, 0.82, lk));
    dSurf += (1.0 - slabOn) * 10.0;
    float blend = mix(0.15, 0.004, smoothstep(0.10, 0.80, lk));
    float dLiq  = smin(dText, dSurf, blend);
    dLiq = mix(dLiq, dText, smoothstep(0.55, 1.0, lk));   // the pool drains away

    float aaT = fwidth(dLiq) * 1.2 + 1e-5;
    float mT  = 1.0 - smoothstep(-aaT, aaT, dLiq);

    vec3 typeCol = mix(vec3(1.00, 0.93, 0.70), vec3(0.86, 0.65, 0.29), smoothstep(-0.10, -0.005, dLiq));
    typeCol += vec3(0.15, 0.11, 0.05) * caustics(sp * 3.0, t);
    typeCol += vec3(0.34, 0.27, 0.14) * front;   // molten at the wavefront
    float rimT = 1.0 - smoothstep(0.0, 0.010, abs(dLiq));
    typeCol = mix(typeCol, vec3(1.0, 0.99, 0.94), rimT * 0.32);

    col = mix(col, typeCol, mT);
    col += vec3(1.0, 0.86, 0.55) * exp(-max(dLiq, 0.0) * 32.0) * (0.15 + 0.26 * front);
  }

  // Last, so the near layer passes in front of the type.
  vec4 cf = confetti(sp, t);
  if (cf.a > 0.001) {
    col = mix(col, cf.rgb / max(cf.a, 1e-4), clamp(cf.a, 0.0, 1.0));
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** The stream runs between these (seconds). */
export const STREAM_START = 2.95;   // T0 + 0.40
export const STREAM_END = 4.90;     // T0 + 2.35
/** The copy arrives once the push-in has landed. */
export const COPY_AT = 5.90;        // T0 + 3.35
/** Nothing changes after this, so the render loop stops. */
export const SEQUENCE_END = 8.80;
/** Timeline position representing the settled end state. */
export const SETTLED_AT = 6.85;     // T0 + 4.30
