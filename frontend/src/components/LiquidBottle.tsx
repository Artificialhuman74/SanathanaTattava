/**
 * LiquidBottle — WebGL2-rendered cold-pressed oil bottle.
 *
 * The bottle's liquid is a real-time GLSL fragment shader running inside
 * an SVG <foreignObject> clipped to the bottle's interior path. The glass
 * outline, cork, and label remain crisp SVG drawn on top of the canvas.
 *
 * What the shader does, per pixel below the meniscus:
 *  · samples a 2D value-noise field for drifting caustics
 *  · adds a small sin + noise ripple to the surface y position
 *  · adds an outward mouse-ripple that decays with time and distance
 *  · mixes two phase colors (top, bottom) for the liquid gradient
 *  · paints a thin highlight band right under the surface (meniscus)
 *
 * Falls back to a static SVG bottle when WebGL is unavailable or the
 * user prefers reduced motion. Props are identical to BottleSVG so
 * Chapter 3 swaps one for the other without changes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ── Brand color subset (only what the fallback SVG needs) ──────────── */
const C = {
  cream:     '#f7ecd4',
  ink:       '#1a1208',
  inkMute:   '#4c4030',
  gold:      '#d29c43',
  goldDeep:  '#a96f24',
  lightMute: '#b8ad94',
};

export interface BottleProps {
  fill:      number;
  topColor:  string;
  botColor:  string;
  labels:    { coconut: number; groundnut: number; sunflower: number };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Parse "rgb(r,g,b)" or "#rrggbb" into normalized [r, g, b] floats. */
function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  if (s.startsWith('#') && s.length >= 7) {
    const h = s.slice(1);
    return [
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255,
    ];
  }
  return [0, 0, 0];
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const cb = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', cb);
    else mql.addListener(cb);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', cb);
      else mql.removeListener(cb);
    };
  }, []);
  return reduced;
}

/* ──────────────────────────────────────────────────────────────────── *
 *  Shader sources
 * ──────────────────────────────────────────────────────────────────── */

const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv   = (aPos + 1.0) * 0.5;
  vUv.y = 1.0 - vUv.y;                  // flip y so 0 = top of bottle
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uTime;
uniform float uFill;
uniform vec3  uColorTop;
uniform vec3  uColorBot;
out vec4 fragColor;

/* Bottle body extents in foreignObject's normalized y (260x480 viewBox).
   The SVG body path runs from y=152 (top of body) to y=440 (bottom).
   The shader can't see the interior path; we only need to know how far
   the liquid should rise within that body range. The actual shape
   clipping is done by the SVG clipPath outside. */
const float BODY_TOP = 0.317;          // 152 / 480
const float BODY_BOT = 0.917;          // 440 / 480

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i),            hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = vUv;

  /* Liquid surface y. fill=0 -> bottom, fill=1 -> top. */
  float surfaceY = mix(BODY_BOT, BODY_TOP, clamp(uFill, 0.0, 1.0));

  /* Idle ripple: small sin wave along x + tiny noise wobble in time. */
  float idleRipple =
        sin(uv.x * 18.0 + uTime * 1.8) * 0.0025
      + (noise(vec2(uv.x * 6.0, uTime * 0.4)) - 0.5) * 0.005;
  surfaceY += idleRipple;

  /* Above the surface: transparent. A small smoothstep across the
     boundary avoids the hard edge that downsampling would alias. */
  float aboveAlpha = smoothstep(-0.0025, 0.0025, uv.y - surfaceY);
  if (aboveAlpha < 0.01) {
    fragColor = vec4(0.0);
    return;
  }

  /* Below the surface: oil color gradient + caustics + meniscus. */
  float depthFrac = clamp(
    (uv.y - surfaceY) / max(0.001, BODY_BOT - surfaceY),
    0.0, 1.0
  );
  vec3 col = mix(uColorTop, uColorBot, depthFrac);

  /* Drifting caustics: low-frequency noise modulated by time. Subtle
     enough to read as light through liquid, not as a pattern. */
  float caustic = noise(vec2(uv.x * 5.0 + uTime * 0.4,
                             uv.y * 6.0 - uTime * 0.15));
  col += (caustic - 0.5) * 0.035;

  /* Meniscus highlight: thin bright band just below the surface. */
  float menisDist = uv.y - surfaceY;
  float meniscus  = smoothstep(0.012, 0.0, menisDist) * 0.35;
  col += vec3(meniscus);

  fragColor = vec4(col, aboveAlpha);
}`;

/* ──────────────────────────────────────────────────────────────────── *
 *  WebGL bootstrap
 * ──────────────────────────────────────────────────────────────────── */

type GLState = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uniforms: {
    uTime:      WebGLUniformLocation;
    uFill:      WebGLUniformLocation;
    uColorTop:  WebGLUniformLocation;
    uColorBot:  WebGLUniformLocation;
  };
};

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[LiquidBottle] shader compile error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function setupGL(canvas: HTMLCanvasElement): GLState | null {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl) return null;

  const vert = compileShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vert || !frag) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[LiquidBottle] program link error:', gl.getProgramInfoLog(program));
    return null;
  }

  const vao = gl.createVertexArray();
  if (!vao) return null;
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]),
    gl.STATIC_DRAW
  );
  const posLoc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  /* All uniforms exist in the program, so getUniformLocation never
   * returns null here; cast for the type. */
  const u = (name: string) => gl.getUniformLocation(program, name)!;
  const uniforms = {
    uTime:      u('uTime'),
    uFill:      u('uFill'),
    uColorTop:  u('uColorTop'),
    uColorBot:  u('uColorBot'),
  };

  return { gl, program, vao, uniforms };
}

/* ──────────────────────────────────────────────────────────────────── *
 *  LiquidBottleCanvas — the WebGL implementation.
 * ──────────────────────────────────────────────────────────────────── */
function LiquidBottleCanvas({
  fill,
  topColor,
  botColor,
  labels,
  onGLFail,
}: BottleProps & { onGLFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* Latest scroll-driven props read by the rAF loop. */
  const propsRef = useRef({ fill, topColor, botColor });
  propsRef.current = { fill, topColor, botColor };

  const startRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    /* Logical resolution. Rendered at 2× the SVG body size for
     * sharpness; CSS scales the displayed canvas back into the
     * foreignObject viewport. */
    canvas.width  = 520;
    canvas.height = 960;

    const state = setupGL(canvas);
    if (!state) {
      onGLFail();
      return;
    }
    const { gl, program, vao, uniforms } = state;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    startRef.current = performance.now();
    let rafId = 0;

    const render = () => {
      const t = (performance.now() - startRef.current) / 1000;
      const top = parseRgb(propsRef.current.topColor);
      const bot = parseRgb(propsRef.current.botColor);

      gl.uniform1f(uniforms.uTime,      t);
      gl.uniform1f(uniforms.uFill,      clamp01(propsRef.current.fill));
      gl.uniform3f(uniforms.uColorTop,  top[0], top[1], top[2]);
      gl.uniform3f(uniforms.uColorBot,  bot[0], bot[1], bot[2]);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    };
  }, [onGLFail]);

  /* SVG path for the bottle outline (in viewBox 0 0 260 480 units). */
  const BOTTLE_PATH =
    'M105,50 L155,50 L155,90 Q155,118 168,135 Q188,160 188,205 L188,400 Q188,440 148,440 L112,440 Q72,440 72,400 L72,205 Q72,160 92,135 Q105,118 105,90 Z';

  /* The same path, normalized to 0..1 by dividing x by 260 and y by 480.
   * Used with clipPathUnits="objectBoundingBox" so the canvas clip scales
   * with the element's actual rendered size, immune to mask-image
   * aspect-ratio quirks across browsers. */
  const BOTTLE_PATH_BB =
    'M0.404,0.104 L0.596,0.104 L0.596,0.188 Q0.596,0.246 0.646,0.281 Q0.723,0.333 0.723,0.427 L0.723,0.833 Q0.723,0.917 0.569,0.917 L0.431,0.917 Q0.277,0.917 0.277,0.833 L0.277,0.427 Q0.277,0.333 0.354,0.281 Q0.404,0.246 0.404,0.188 Z';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 320,
        aspectRatio: '260 / 480',
      }}
      aria-hidden="true"
    >
      {/* Hidden SVG that defines the clipPath. The path is in
          objectBoundingBox units (0..1) so it scales to whatever size
          the canvas ends up being on screen. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <clipPath id="liquidBottleClipBB" clipPathUnits="objectBoundingBox">
            <path d={BOTTLE_PATH_BB} />
          </clipPath>
        </defs>
      </svg>

      {/* WebGL canvas — clipped to the bottle interior via clip-path. */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
          clipPath:       'url(#liquidBottleClipBB)',
          WebkitClipPath: 'url(#liquidBottleClipBB)',
        }}
      />

      {/* SVG overlay: glass outline, cork, label, variety text. Sits on
          top of the canvas, doesn't receive pointer events. */}
      <svg
        viewBox="0 0 260 480"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <defs>
          <linearGradient id="glassGradLB" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="rgba(247, 236, 212, 0.10)" />
            <stop offset="50%"  stopColor="rgba(247, 236, 212, 0.04)" />
            <stop offset="100%" stopColor="rgba(247, 236, 212, 0.10)" />
          </linearGradient>
        </defs>

        {/* Glass body outline */}
        <path
          d={BOTTLE_PATH}
          fill="url(#glassGradLB)"
          stroke={C.lightMute}
          strokeWidth="1.5"
        />
        {/* Cork */}
        <rect x="100" y="22" width="60" height="32" rx="4" fill={C.goldDeep} />
        <rect x="100" y="22" width="60" height="6"  rx="2" fill={C.gold} />

        {/* Label */}
        <rect x="86" y="245" width="108" height="118" rx="2" fill={C.cream} />
        <text x="140" y="282" textAnchor="middle"
              fontFamily="EB Garamond, Georgia, serif" fontSize="13" fontStyle="italic"
              fill={C.ink}>Sanathana</text>
        <text x="140" y="300" textAnchor="middle"
              fontFamily="EB Garamond, Georgia, serif" fontSize="13" fontStyle="italic"
              fill={C.ink}>Tattva</text>
        <line x1="106" y1="312" x2="174" y2="312" stroke={C.gold} strokeWidth="0.8" />
        <text x="140" y="332" textAnchor="middle"
              fontFamily="Inter, system-ui, sans-serif" fontSize="9" letterSpacing="2"
              fill={C.inkMute}>COLD PRESSED</text>

        {/* Variety labels stack at the same point; opacity per phase. */}
        <text x="140" y="351" textAnchor="middle"
              fontFamily="EB Garamond, Georgia, serif" fontSize="12" fontStyle="italic"
              fill={C.ink} opacity={labels.coconut}>Coconut</text>
        <text x="140" y="351" textAnchor="middle"
              fontFamily="EB Garamond, Georgia, serif" fontSize="12" fontStyle="italic"
              fill={C.ink} opacity={labels.groundnut}>Groundnut</text>
        <text x="140" y="351" textAnchor="middle"
              fontFamily="EB Garamond, Georgia, serif" fontSize="12" fontStyle="italic"
              fill={C.ink} opacity={labels.sunflower}>Sunflower</text>
      </svg>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── *
 *  BottleSVG (fallback) — the static SVG bottle. Identical shape and
 *  label as the WebGL version, with a flat gradient liquid rect.
 * ──────────────────────────────────────────────────────────────────── */
export function BottleSVG({ fill, topColor, botColor, labels }: BottleProps) {
  const f = clamp01(fill);
  const bodyTop    = 152;
  const bodyBottom = 410;
  const liquidTop  = bodyBottom - (bodyBottom - bodyTop) * f;

  return (
    <svg viewBox="0 0 260 480" width="100%" style={{ maxWidth: 320 }} aria-hidden="true">
      <defs>
        <linearGradient id="oilGradFB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={topColor} />
          <stop offset="100%" stopColor={botColor} />
        </linearGradient>
        <linearGradient id="glassGradFB" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="rgba(247, 236, 212, 0.10)" />
          <stop offset="50%"  stopColor="rgba(247, 236, 212, 0.04)" />
          <stop offset="100%" stopColor="rgba(247, 236, 212, 0.10)" />
        </linearGradient>
        <clipPath id="bottleClipFB">
          <path d="M105,50 L155,50 L155,90 Q155,118 168,135 Q188,160 188,205 L188,400 Q188,440 148,440 L112,440 Q72,440 72,400 L72,205 Q72,160 92,135 Q105,118 105,90 Z" />
        </clipPath>
      </defs>

      <g clipPath="url(#bottleClipFB)">
        <rect
          x="0"
          y={liquidTop}
          width="260"
          height={bodyBottom - liquidTop + 40}
          fill="url(#oilGradFB)"
        />
        {f > 0.02 && (
          <ellipse cx="130" cy={liquidTop} rx="58" ry="4" fill="rgba(255, 250, 230, 0.50)" />
        )}
      </g>

      <path
        d="M105,50 L155,50 L155,90 Q155,118 168,135 Q188,160 188,205 L188,400 Q188,440 148,440 L112,440 Q72,440 72,400 L72,205 Q72,160 92,135 Q105,118 105,90 Z"
        fill="url(#glassGradFB)"
        stroke={C.lightMute}
        strokeWidth="1.5"
      />
      <rect x="100" y="22" width="60" height="32" rx="4" fill={C.goldDeep} />
      <rect x="100" y="22" width="60" height="6"  rx="2" fill={C.gold} />
      <rect x="86" y="245" width="108" height="118" rx="2" fill={C.cream} />
      <text x="140" y="282" textAnchor="middle"
            fontFamily="EB Garamond, Georgia, serif" fontSize="13" fontStyle="italic"
            fill={C.ink}>Sanathana</text>
      <text x="140" y="300" textAnchor="middle"
            fontFamily="EB Garamond, Georgia, serif" fontSize="13" fontStyle="italic"
            fill={C.ink}>Tattva</text>
      <line x1="106" y1="312" x2="174" y2="312" stroke={C.gold} strokeWidth="0.8" />
      <text x="140" y="332" textAnchor="middle"
            fontFamily="Inter, system-ui, sans-serif" fontSize="9" letterSpacing="2"
            fill={C.inkMute}>COLD PRESSED</text>
      <text x="140" y="351" textAnchor="middle"
            fontFamily="EB Garamond, Georgia, serif" fontSize="12" fontStyle="italic"
            fill={C.ink} opacity={labels.coconut}>Coconut</text>
      <text x="140" y="351" textAnchor="middle"
            fontFamily="EB Garamond, Georgia, serif" fontSize="12" fontStyle="italic"
            fill={C.ink} opacity={labels.groundnut}>Groundnut</text>
      <text x="140" y="351" textAnchor="middle"
            fontFamily="EB Garamond, Georgia, serif" fontSize="12" fontStyle="italic"
            fill={C.ink} opacity={labels.sunflower}>Sunflower</text>
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────── *
 *  LiquidBottle — runtime chooser. WebGL if available + motion allowed,
 *  otherwise the static SVG fallback. Public API identical to BottleSVG.
 * ──────────────────────────────────────────────────────────────────── */
export default function LiquidBottle(props: BottleProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [glFailed, setGlFailed] = useState(false);
  /* Stable identity: prevents the canvas's useEffect from tearing down +
   * rebuilding WebGL on every parent rerender (which happens on every
   * scroll frame because the parent feeds new fill/color props). */
  const handleGLFail = useCallback(() => setGlFailed(true), []);

  if (reducedMotion || glFailed) {
    return <BottleSVG {...props} />;
  }
  return <LiquidBottleCanvas {...props} onGLFail={handleGLFail} />;
}
