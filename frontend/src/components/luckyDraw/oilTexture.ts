import { FRAG, VERT } from './oilFloodShader';

/**
 * Renders a single frame of the oil shader offscreen and returns it as a data
 * URI, for use as a CSS fill (background-image, mask fill, etc).
 *
 * Why a still rather than the live canvas: one canvas cannot be painted in two
 * places, and background-image cannot reference a canvas element at all. A
 * second live context just to fill a headline would double the shader cost for
 * a strip of letters. One frame, rendered once, is indistinguishable inside
 * glyphs and costs nothing after the first paint.
 *
 * Returns null when WebGL2 is unavailable so callers can fall back to a solid
 * colour rather than a broken fill.
 */
export function renderOilTexture(width = 640, height = 200, time = 4.3): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.viewport(0, 0, width, height);
  gl.uniform2f(gl.getUniformLocation(program, 'u_res'), width, height);
  gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  let url: string | null = null;
  try {
    url = canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    url = null;
  }

  gl.deleteProgram(program);
  gl.deleteBuffer(buf);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return url;
}
