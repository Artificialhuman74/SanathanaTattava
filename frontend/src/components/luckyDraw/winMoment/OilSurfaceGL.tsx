import React, { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * The oil surface: a summed-sine height field with thickness shading, a
 * specular crest and refracted internal banding. One full-screen triangle,
 * redrawn on demand from the composition clock rather than from its own rAF —
 * the timeline owns time, this only owns pixels.
 */

const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.,1.);}`;

const FS = `precision highp float;
varying vec2 uv;
uniform float uT, uLevel, uCalm;
uniform vec3 cLo, cMid, cHi;

float surf(float x){
  return sin(x*7.0+uT*2.7)*0.030
       + sin(x*13.3-uT*4.1)*0.014
       + sin(x*3.1+uT*1.2)*0.020
       + sin(x*23.0+uT*6.3)*0.006;
}

void main(){
  vec2 q = uv*2.0-1.0;
  if(dot(q,q)>1.0){ gl_FragColor=vec4(0.); return; }

  float h = surf(uv.x)*uCalm;
  float lvl = mix(-1.08, 1.08, uLevel) + h;   // surface height in clip space
  float d = lvl - q.y;                        // >0 inside the liquid
  if(d < 0.0){ gl_FragColor=vec4(0.); return; }

  // slope of the surface -> shading normal + specular band along the crest
  float dx = (surf(uv.x+0.004)-surf(uv.x-0.004))*uCalm*40.0;
  float nx = clamp(dx,-1.,1.);

  float depth = clamp(d*0.85, 0.0, 1.0);
  vec3 col = mix(cHi, cMid, smoothstep(0.0,0.30,depth));
  col = mix(col, cLo, smoothstep(0.28,1.0,depth));

  // internal caustic bands, refracted by the surface
  float band = sin((q.y - h*3.0)*22.0 + uT*1.6 + nx*2.0);
  col += vec3(0.16,0.12,0.05)*band*(1.0-depth)*0.7;

  // crest: bright meniscus with a moving specular highlight
  float crest = 1.0 - smoothstep(0.0, 0.075, d);
  col = mix(col, cHi, crest*0.85);
  float spec = pow(max(0.0, 1.0 - abs(nx - sin(uT*0.9)*0.6)), 6.0);
  col += vec3(1.0,0.93,0.72)*spec*crest*0.55;

  // body highlight + rim darkening so it reads as a filled lens
  col += vec3(0.28,0.24,0.16)*pow(max(0.0,1.0-length(q-vec2(-0.28,0.42))*1.15),3.0)*uLevel;
  col *= 1.0 - 0.30*smoothstep(0.72,1.0,length(q));

  float edge = 1.0 - smoothstep(0.985, 1.0, length(q));
  gl_FragColor = vec4(col, edge);
}`;

interface OilSurfaceGLProps {
  /** Edge length of the square canvas, in design-space pixels. */
  size: number;
  /** Authored time, seconds — drives the wave phase. */
  T: number;
  /** Fill height, 0 (empty) to 1 (brimming). */
  level: number;
  /** How agitated the surface is, 0 (glass) to 1 (churning). */
  calm: number;
  /** Called once if WebGL is unavailable, so the caller can paint a fallback. */
  onUnavailable?: () => void;
}

interface GLState {
  g: WebGLRenderingContext;
  program: WebGLProgram;
  shaders: WebGLShader[];
  buffer: WebGLBuffer;
  uT: WebGLUniformLocation | null;
  uLevel: WebGLUniformLocation | null;
  uCalm: WebGLUniformLocation | null;
}

export default function OilSurfaceGL({ size, T, level, calm, onUnavailable }: OilSurfaceGLProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const gl = useRef<GLState | null>(null);
  // A ref, not state: the failure is reported to the parent, and re-rendering
  // this component on it would only re-run the same failing setup.
  const reported = useRef(false);

  const fail = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    onUnavailable?.();
  }, [onUnavailable]);

  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;

    const g = (cv.getContext('webgl', { premultipliedAlpha: false, antialias: true }) ||
      cv.getContext('experimental-webgl', { premultipliedAlpha: false, antialias: true })) as WebGLRenderingContext | null;
    if (!g) { fail(); return; }

    const shaders: WebGLShader[] = [];
    const mk = (type: number, src: string) => {
      const s = g.createShader(type);
      if (!s) return null;
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
        g.deleteShader(s);
        return null;
      }
      shaders.push(s);
      return s;
    };

    const vs = mk(g.VERTEX_SHADER, VS);
    const fs = mk(g.FRAGMENT_SHADER, FS);
    const program = g.createProgram();
    const buffer = g.createBuffer();
    if (!vs || !fs || !program || !buffer) {
      shaders.forEach(s => g.deleteShader(s));
      if (program) g.deleteProgram(program);
      if (buffer) g.deleteBuffer(buffer);
      fail();
      return;
    }

    g.attachShader(program, vs);
    g.attachShader(program, fs);
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) {
      shaders.forEach(s => g.deleteShader(s));
      g.deleteProgram(program);
      g.deleteBuffer(buffer);
      fail();
      return;
    }
    g.useProgram(program);

    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(program, 'p');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    g.enable(g.BLEND);
    g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);

    const u = (n: string) => g.getUniformLocation(program, n);
    g.uniform3f(u('cLo'), 0.42, 0.28, 0.06);
    g.uniform3f(u('cMid'), 0.85, 0.66, 0.25);
    g.uniform3f(u('cHi'), 0.97, 0.89, 0.63);

    gl.current = { g, program, shaders, buffer, uT: u('uT'), uLevel: u('uLevel'), uCalm: u('uCalm') };

    return () => {
      gl.current = null;
      shaders.forEach(s => { g.detachShader(program, s); g.deleteShader(s); });
      g.deleteProgram(program);
      g.deleteBuffer(buffer);
      // The reveal unmounts for the rest of the session; hand the context back
      // rather than waiting for the driver to reclaim it.
      g.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [fail]);

  // Layout effect, not effect: the draw lands in the same frame as the
  // transform updates around it, so the oil never lags the ring by a frame.
  useLayoutEffect(() => {
    const s = gl.current;
    if (!s) return;
    const { g } = s;
    g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    g.uniform1f(s.uT, T);
    g.uniform1f(s.uLevel, level);
    g.uniform1f(s.uCalm, calm);
    g.drawArrays(g.TRIANGLES, 0, 3);
  }, [T, level, calm]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: size, height: size, display: 'block' }}
    />
  );
}
