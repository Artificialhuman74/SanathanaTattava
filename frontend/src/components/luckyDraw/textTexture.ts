/**
 * Builds the field the liquid type is shaped from.
 *
 * Two channels, because the letters have to do two different things:
 *   R — the text drawn sharp. What the glyphs harden into.
 *   G — the same text drawn heavily blurred. Thresholded, a blurred field
 *       gives rounded, bulging, merging forms — liquid, not letters.
 *
 * The shader crossfades G→R as the type sets, so the glyphs genuinely round
 * off under surface tension and then resolve. A single blurred channel could
 * never sharpen back up, and a single sharp one could never melt.
 */
export interface TextTexture {
  texture: WebGLTexture;
  /** Half-extent of the field in the shader's normalised screen units. */
  halfExtent: [number, number];
}

const W = 1024;
const H = 512;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paint(text: string, blurPx: number): Uint8ClampedArray | null {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const size = 150;
  ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;

  const lines = wrap(ctx, text, W * 0.86);
  const lineHeight = size * 1.04;
  const startY = H / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * lineHeight));

  return ctx.getImageData(0, 0, W, H).data;
}

export function buildTextTexture(gl: WebGL2RenderingContext, text: string): TextTexture | null {
  const sharp = paint(text, 0);
  const soft = paint(text, 22);
  if (!sharp || !soft) return null;

  // Pack both passes into one RGBA upload: R sharp, G blurred.
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4 + 0] = sharp[i * 4];
    data[i * 4 + 1] = soft[i * 4];
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }

  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { texture, halfExtent: [0.46, 0.46 * (H / W)] };
}
