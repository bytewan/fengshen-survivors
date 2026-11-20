// 过场画面的公共小工具（纯函数，不依赖 DOM / Pixi，Node 里也能跑）：按调色板字符画点的位图、
// 只在交界处有序抖动的分档渐变、天空、换色、平滑噪声。
// 画法的口径同标题页（src/art/title.ts）：颜色只用调色板里的；渐变分档、交界处几像素的抖动，不铺满颗粒；
// 不画发光的圆圈；不要一像素的细裂缝。
import { PALETTE, hexToRgba } from '../palette.ts';
import { mulberry32, type Bitmap } from '../ground.ts';
import type { Grid } from '../pixel.ts';

export { mulberry32 };
export type { Bitmap };

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** 4×4 有序抖动的阈值（0..1）。 */
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const RGB: Record<string, [number, number, number, number]> = {};
/** 调色板字符 → RGBA。 */
export const rgbaOf = (ch: string) => (RGB[ch] ??= hexToRgba(PALETTE[ch]));

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

export function blank(w: number, h: number): Bitmap {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

/** 画一个调色板颜色的像素（越界不画）；a 是不透明度 0..255。 */
export function put(b: Bitmap, x: number, y: number, ch: string, a = 255) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const c = rgbaOf(ch);
  const i = (y * b.w + x) * 4;
  b.data[i] = c[0];
  b.data[i + 1] = c[1];
  b.data[i + 2] = c[2];
  b.data[i + 3] = a;
}

export function rect(b: Bitmap, x: number, y: number, w: number, h: number, ch: string, a = 255) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(b, x + i, y + j, ch, a);
}

/** 网格的某几种颜色换成别的（同 foe-kit.recolor）。 */
export function recolor(g: Grid, map: Record<string, string>): Grid {
  return { w: g.w, h: g.h, rows: g.rows.map((r) => [...r].map((c) => map[c] ?? c).join('')) };
}

/**
 * 竖直方向的分档渐变：stops 是 [纵坐标, 这一档往下的颜色]，按纵坐标从小到大；两档之间只有 seam 像素宽的有序抖动。
 * lift(x)：这一列的档线整体往上抬多少（做成穹顶那样的弧，不是横贯全屏的直线）。只画 y0..y1 这几行。
 */
export function bands(b: Bitmap, stops: [number, string][], seam = 3, lift: (x: number) => number = () => 0, y0 = 0, y1 = b.h - 1) {
  for (let x = 0; x < b.w; x++) {
    const L = lift(x);
    for (let y = Math.max(0, y0); y <= Math.min(b.h - 1, y1); y++) {
      let i = 0;
      while (i + 1 < stops.length && y >= stops[i + 1][0] - L + seam) i++;
      let ch = stops[i][1];
      if (i + 1 < stops.length && y >= stops[i + 1][0] - L - seam) {
        const t = (y - (stops[i + 1][0] - L - seam)) / (seam * 2);
        ch = t > bayer(x, y) ? stops[i + 1][1] : stops[i][1];
      }
      put(b, x, y, ch);
    }
  }
}

/**
 * 天空：W×H，按 stops（[离天顶的比例 0..1（相对 horizon）, 颜色]）分档，中间的档线往上抬成穹顶的弧。
 * 同标题页的 makeSky，只是颜色和档位可以换（夜里、魔气里的天）。
 */
export function sky(W: number, H: number, horizon: number, stops: [number, string][], dome = 0.11, seam = 3): Bitmap {
  const b = blank(W, H);
  const lift = (x: number) => {
    const dx = (x - W / 2) / (W / 2);
    return dome * (1 - dx * dx) * horizon;
  };
  bands(
    b,
    stops.map(([f, ch]) => [f * horizon, ch] as [number, string]),
    seam,
    lift,
  );
  return b;
}

/** 平滑的格点值噪声（[0,1]），cell 越大越平缓。可横向无缝（wrapW > 0 时按 wrapW 取模）。 */
export function valueNoise(seed: number, cell: number, w: number, h: number, wrapW = 0) {
  const rnd = mulberry32(seed);
  const gw = Math.ceil((wrapW || w) / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, rnd);
  const cols = wrapW ? Math.round(wrapW / cell) : gw;
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fade(fx - ix);
    const ty = fade(fy - iy);
    const at = (i: number, j: number) => {
      const X = wrapW ? (((ix + i) % cols) + cols) % cols : ix + i;
      return g[(iy + j) * gw + X];
    };
    const a = at(0, 0) + (at(1, 0) - at(0, 0)) * tx;
    const c = at(0, 1) + (at(1, 1) - at(0, 1)) * tx;
    return a + (c - a) * ty;
  };
}
