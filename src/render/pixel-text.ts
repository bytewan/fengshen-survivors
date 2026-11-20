// 像素字：用像素体「FS Pixel」（缝合像素字体，见 src/game/fonts.ts、docs/fonts.md）按 12px 原尺寸画在 canvas 上，
// 按阈值转成清晰的像素、加描边（可选影子），缓存成纹理。通用工具：法宝相生的名字、对白气泡、横幅……
// 任何要在 480×270 画面里写字的地方都可以用。要大字就整数倍放大（scale 选项，或 sprite.scale 取整数）。
// 颜色可以写调色板字符（'Y'、'e'……，见 src/art/palette.ts）或 '#rrggbb'。
// 画字之前字体必须已经加载完（main.ts 进局、开实验页之前已经 await loadPixelFont()）；还没加载完时画出来的不进缓存，下次会重画。
import type { Texture } from 'pixi.js';
import { PALETTE } from '../art/palette.ts';
import { textureFromBitmap } from './textures.ts';
import { FONT_PIXEL, PIXEL_FONT, PIXEL_FONT_PX } from '../game/fonts.ts';

export interface PixelTextStyle {
  /** 填色：一个颜色，或自上而下的几档（例如 ['f', 'Y', 'y'] 上亮下暗）。默认月白。 */
  color?: string | string[];
  /** 描边色；null 不描边。默认玄色 'k'。 */
  outline?: string | null;
  /** 描边是否连斜角（8 邻域）：更粗、更好认。默认 true。 */
  outline8?: boolean;
  /** 描边之外再往下压一像素的影子；null 不要。默认 null。 */
  shadow?: string | null;
  /** 字形整数倍放大（先放大字形、再描一像素的边，大字也是细描边）。默认 1。 */
  scale?: number;
  /** 字距（像素，放大前），默认 0（像素体自带字距）。 */
  spacing?: number;
  /** 字号：像素体只在 12px 下清晰，一般不要改；换别的字体时才用得上。 */
  size?: number;
  /** CSS 字体族，默认像素体。 */
  family?: string;
  /** 0..1：覆盖率高于它才算一像素。默认 0.5。 */
  threshold?: number;
}

export interface PixelBitmap {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

function rgb(c: string): [number, number, number] {
  const hex = c.startsWith('#') ? c : PALETTE[c];
  if (!hex) throw new Error(`pixel-text: unknown color '${c}'`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 像素体加载好了没有（没加载好时画出来的是后备字体）。 */
export function pixelFontReady(): boolean {
  return typeof document !== 'undefined' && document.fonts.check(`${PIXEL_FONT_PX}px "${PIXEL_FONT}"`, '封神');
}

/** 画成一张 RGBA 位图（不依赖 Pixi，可以拿去拼别的图）。 */
export function pixelTextBitmap(text: string, style: PixelTextStyle = {}): PixelBitmap {
  const size = style.size ?? PIXEL_FONT_PX;
  const family = style.family ?? FONT_PIXEL;
  const spacing = style.spacing ?? 0;
  const threshold = style.threshold ?? 0.5;
  const k = Math.max(1, Math.round(style.scale ?? 1));
  const colors = (Array.isArray(style.color) ? style.color : [style.color ?? 'w']).map(rgb);
  const outline = style.outline === undefined ? rgb('k') : style.outline === null ? null : rgb(style.outline);
  const shadow = style.shadow ? rgb(style.shadow) : null;

  // 1) 按原尺寸逐字画在整数位置上（像素体的每一笔正好落在像素格里）
  const font = `${size}px ${family}`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const chars = [...text];
  const adv = chars.map((ch) => Math.round(probe.measureText(ch).width));
  const W = adv.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1) + 4;
  const H = size * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  let x = 2;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, Math.round(size / 2));
    x += adv[i] + spacing;
  });
  const src = ctx.getImageData(0, 0, W, H).data;

  // 2) 阈值化成「墨」，裁到墨迹的包围盒
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  const ink0 = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let q = 0; q < W; q++)
      if (src[(y * W + q) * 4 + 3] >= threshold * 255) {
        ink0[y * W + q] = 1;
        x0 = Math.min(x0, q);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, q);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return { w: 1, h: 1, data: new Uint8ClampedArray(4) };
  // 3) 整数倍放大字形，四周留出描边与影子的位置
  const iw = (x1 - x0 + 1) * k;
  const ih = (y1 - y0 + 1) * k;
  const pad = outline ? 1 : 0;
  const ow = iw + pad * 2;
  const oh = ih + pad * 2 + (shadow ? 1 : 0);
  const data = new Uint8ClampedArray(ow * oh * 4);
  const filled = new Uint8Array(ow * oh); // 0 空 1 字 2 描边
  const put = (q: number, y: number, [r, g, b]: [number, number, number]) => data.set([r, g, b, 255], (y * ow + q) * 4);
  for (let y = 0; y < ih; y++)
    for (let q = 0; q < iw; q++) {
      if (!ink0[(y0 + Math.floor(y / k)) * W + x0 + Math.floor(q / k)]) continue;
      const band = Math.min(colors.length - 1, Math.floor((y / ih) * colors.length));
      put(q + pad, y + pad, colors[band]);
      filled[(y + pad) * ow + q + pad] = 1;
    }
  if (outline) {
    const dirs = style.outline8 !== false ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] : [[0, -1], [-1, 0], [1, 0], [0, 1]];
    const edge: number[] = [];
    for (let y = 0; y < oh; y++)
      for (let q = 0; q < ow; q++) {
        if (filled[y * ow + q]) continue;
        if (dirs.some(([dx, dy]) => q + dx >= 0 && q + dx < ow && y + dy >= 0 && y + dy < oh && filled[(y + dy) * ow + q + dx] === 1)) edge.push(y * ow + q);
      }
    for (const i of edge) {
      put(i % ow, Math.floor(i / ow), outline);
      filled[i] = 2;
    }
  }
  // 影子：整个字（含描边）往下压一像素，只落在空处
  if (shadow)
    for (let y = oh - 1; y >= 1; y--)
      for (let q = 0; q < ow; q++) if (!filled[y * ow + q] && filled[(y - 1) * ow + q]) put(q, y, shadow);
  return { w: ow, h: oh, data };
}

const cache = new Map<string, Texture>();

/** 像素字纹理（按文字 + 样式缓存，重复调用不重复生成）。 */
export function pixelTextTexture(text: string, style: PixelTextStyle = {}): Texture {
  const key = `${text}\u0000${JSON.stringify(style)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = textureFromBitmap(pixelTextBitmap(text, style)); // 不进 Pixi 的全局缓存（见 textures.ts）
  if (style.family || pixelFontReady()) cache.set(key, t);
  return t;
}
