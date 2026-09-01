import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FRAG, VERT, SETTLED_AT, COPY_AT, STREAM_START, STREAM_END } from './oilFloodShader';
import { playNotificationSound } from '../../services/notificationSound';
import { buildTextTexture } from './textTexture';

interface OilFloodGLProps {
  schemeName: string;
  rewardProductName: string | null;
  onContinue: () => void;
  /** Called if WebGL2 can't start, so the caller can fall back to CSS. */
  onUnavailable: () => void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

export default function OilFloodGL({ schemeName, rewardProductName, onContinue, onUnavailable }: OilFloodGLProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const startRef = useRef(0);
  const [runId, setRunId] = useState(0);
  const [copyIn, setCopyIn] = useState(false);

  const chime = useCallback(() => {
    try { playNotificationSound(); } catch { /* silent is fine */ }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // WebGL2 for the const arrays and fwidth-based AA. ~97% of browsers; the
    // rest fall back to the CSS reveal rather than seeing a blank canvas.
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) { onUnavailable(); return; }

    let program: WebGLProgram | null = null;
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`link failed: ${gl.getProgramInfoLog(program)}`);
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    } catch (err) {
      // A driver that rejects the shader is not a crash the user should see.
      console.error('[OilFloodGL]', err);
      onUnavailable();
      return;
    }

    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_res');
    const uTime = gl.getUniformLocation(program, 'u_time');

    // The glyph field the liquid type is shaped from. Painted with the page's
    // own font, so what hardens is the same Inter the rest of the app uses
    // rather than a lookalike baked into an atlas.
    const textTex = buildTextTexture(gl, `You won ${schemeName}.`);
    if (textTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex.texture);
      gl.uniform1i(gl.getUniformLocation(program, 'u_text'), 0);
      gl.uniform2f(gl.getUniformLocation(program, 'u_textHalf'), textTex.halfExtent[0], textTex.halfExtent[1]);
    }

    // Cap DPR at 1.5: a full-screen fbm shader at 3x on a phone is the
    // difference between 60fps and a slideshow, and the extra pixels buy
    // nothing on a soft-edged liquid.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const draw = (t: number) => {
      resize();
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      // One static frame of the settled oil. No loop, no motion, same picture
      // the sequence would have arrived at.
      draw(SETTLED_AT);
      setCopyIn(true);
      chime();
      return () => { gl.deleteProgram(program); gl.deleteBuffer(buf); };
    }

    // Two cues, not five: the stream opening and the bottle topping out. A
    // chime per drop made sense when the fill was five discrete landings.
    const chimes = [STREAM_START, STREAM_END].map(t => setTimeout(chime, t * 1000));
    const copyTimer = setTimeout(() => setCopyIn(true), COPY_AT * 1000);

    // The cathedral never fully settles — the caustics keep crawling — so the
    // loop outlives the sequence. Two guards keep that from being rude: skip
    // drawing entirely while the tab is hidden, and stop for good after
    // HARD_STOP, long past when anyone has read the screen and tapped through.
    const HARD_STOP = 22;
    startRef.current = performance.now();
    const loop = (now: number) => {
      const t = (now - startRef.current) / 1000;
      if (!document.hidden) draw(t);
      if (t < HARD_STOP) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      chimes.forEach(clearTimeout);
      clearTimeout(copyTimer);
      gl.deleteProgram(program);
      gl.deleteBuffer(buf);
      if (textTex) gl.deleteTexture(textTex.texture);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [runId, chime, onUnavailable, schemeName]);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ backgroundColor: '#fdf8f0' }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />

      {/* Contrast scrim. The shader's dimming varies with the animation, and
          legibility cannot depend on where the caustics happen to be. This
          guarantees the floor no matter what is behind it. */}
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 pointer-events-none transition-opacity duration-700 ${copyIn ? 'opacity-100' : 'opacity-0'}`}
        style={{
          // Full-bleed. Boxed to the copy area, the gradient's own top edge
          // showed as a hard horizontal seam across the screen.
          top: 0, bottom: 0,
          // Sits low and fades out well above the copy block. Reaching any
          // higher it tints the shader's liquid type — which is inside the
          // canvas underneath — from molten gold to muddy olive.
          background: 'radial-gradient(ellipse 130% 38% at 50% 94%, rgba(34, 18, 4, 0.62) 0%, rgba(34, 18, 4, 0.30) 52%, rgba(34, 18, 4, 0) 82%)',
        }}
      />

      <div
        className={`absolute inset-x-0 px-6 text-center transition-all duration-700 ${copyIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
        style={{ top: '68%' }}
        role="status"
      >
        {/* The headline is drawn by the shader now, as liquid metal rising out
            of the oil. It stays in the DOM for screen readers, find-in-page
            and copy-paste — the canvas is aria-hidden and announces nothing. */}
        <h1 className="sr-only">You won {schemeName}.</h1>
        <p className="mt-5 mx-auto max-w-[330px] text-base leading-relaxed" style={{ color: '#f7ecd9' }}>
          {rewardProductName ? (
            <>We're delivering your <span className="font-semibold" style={{ color: '#ffffff' }}>{rewardProductName}</span> free, every month, for the rest of this round.</>
          ) : (
            "We're delivering your last order free, every month, for the rest of this round."
          )}
        </p>
        <button
          onClick={onContinue}
          className="mt-9 px-8 py-3 rounded-[18px] bg-parchment-100 text-brand-800 text-sm font-semibold shadow-lg active:scale-[0.98] transition-transform"
        >
          Continue
        </button>
      </div>

      {import.meta.env.DEV && (
        <button
          onClick={() => { setCopyIn(false); setRunId(n => n + 1); }}
          className="absolute bottom-5 right-5 px-3.5 py-2 rounded-xl bg-brand-900/85 text-white text-xs font-semibold shadow-md hover:bg-brand-900 active:scale-95 transition-all"
        >
          ↻ Replay
        </button>
      )}
    </div>
  );
}
