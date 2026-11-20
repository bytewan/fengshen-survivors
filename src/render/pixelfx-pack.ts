// 预烘焙 pixelfx 特效：把每一帧画出来、裁掉四周的空白、排进一张（或几张）大图，播放时只换贴图。
// 这里只有纯计算（不碰 Pixi、不碰浏览器），Node 里就能跑、能测；src/render/pixelfx.ts 把结果变成 Pixi 纹理。
//
// 为什么要裁、要排：一个特效一帧一张独立纹理的话，天雷符这种 240×264、91 帧的效果要 91 张纹理、约 23 MB 显存，
// 而且每张都要单独上传、互相打断批处理（PixiJS 的性能建议：用图集，不要一堆零散纹理）。
// 特效的画布大多是空的，裁掉空白再排进图集，显存通常只剩几分之一，一个特效一般一张纹理。
import { clearFrame, composite, createFrame, createFx, type FxModule, type FxOptions } from '../../vendor/pixelfx/src/core/index.js';

/** 图集一张大图的边长上限。2048 在手机的 WebGL 上都能用，一张最多 16 MB。 */
export const ATLAS_MAX = 2048;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一帧在图集里的位置：在第几张大图的 (x, y) 处，大小 w × h；(dx, dy) 是它在特效原画布里的左上角（裁掉的空白）。 */
export interface AtlasFrame extends Rect {
  page: number;
  dx: number;
  dy: number;
}

export interface AtlasPage {
  w: number;
  h: number;
  /** RGBA（未预乘），w × h × 4 字节。 */
  data: Uint8Array;
}

export interface Atlas {
  pages: AtlasPage[];
  /** 每一帧；整帧是空的为 null（播放时把精灵藏起来）。 */
  frames: (AtlasFrame | null)[];
  fps: number;
  loop: boolean;
  /** 特效的原点在原画布里的位置（meta.origin）。 */
  ox0: number;
  oy0: number;
  /** 原画布大小（meta.size）。 */
  w: number;
  h: number;
  /** 图集一共多少像素（× 4 就是占的显存字节数）。 */
  pixels: number;
}

/** 一帧里有内容（不透明度 > 0）的最小矩形；整帧是空的返回 null。 */
export function trimBounds(rgba: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4 + 3;
    for (let x = 0; x < w; x++) {
      if (rgba[row + x * 4] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface Placed {
  page: number;
  x: number;
  y: number;
}

export interface Packing {
  /** 每张大图实际用到的大小。 */
  pages: { w: number; h: number }[];
  /** 每个矩形的位置（空帧为 null）。 */
  at: (Placed | null)[];
}

/**
 * 把一串矩形按原来的顺序排进若干张不超过 maxW × maxH 的大图：从左往右排，一行排满换行，一张排满换张；
 * 矩形之间留 pad 像素的空，免得采样时串到邻居。sizes 里的 null（空帧）原样留空。
 */
export function packShelves(sizes: ({ w: number; h: number } | null)[], maxW = ATLAS_MAX, pad = 1, maxH = maxW): Packing {
  const pages: { w: number; h: number }[] = [];
  const at: (Placed | null)[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let pageW = 0; // 这一张实际用到的宽、高（放进去的矩形的最右、最下）
  let pageH = 0;
  const close = () => {
    if (pageH > 0) pages.push({ w: pageW, h: pageH });
    x = y = rowH = pageW = pageH = 0;
  };
  for (const s of sizes) {
    if (!s) {
      at.push(null);
      continue;
    }
    if (s.w > maxW || s.h > maxH) throw new Error(`pixelfx：一帧 ${s.w}×${s.h} 比图集上限 ${maxW}×${maxH} 还大`);
    if (x > 0 && x + s.w > maxW) {
      // 换行
      y += rowH + pad;
      x = 0;
      rowH = 0;
    }
    if (y + s.h > maxH) close(); // 换张
    at.push({ page: pages.length, x, y });
    pageW = Math.max(pageW, x + s.w);
    pageH = Math.max(pageH, y + s.h);
    rowH = Math.max(rowH, s.h);
    x += s.w + pad;
  }
  close();
  return { pages, at };
}

/**
 * 挑一个最省的排法：一行排多宽会影响浪费多少（最后一行排不满、每行按最高的那个留高），
 * 所以把几种行宽都排一遍，取大图张数最少的；张数一样取总面积最小的。
 */
export function packBest(sizes: ({ w: number; h: number } | null)[], max = ATLAS_MAX, pad = 1): Packing {
  const widest = sizes.reduce((m, s) => Math.max(m, s ? s.w : 0), 0);
  const area = sizes.reduce((a, s) => a + (s ? (s.w + pad) * (s.h + pad) : 0), 0);
  const square = Math.ceil(Math.sqrt(area)); // 排成正方形时的边长，在它附近多试几个
  const tries = new Set<number>([max]);
  for (const k of [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.8, 2.2, 2.8, 3.5]) tries.add(Math.min(max, Math.max(widest, Math.ceil(square * k))));
  for (const w of [128, 256, 512, 1024]) if (w >= widest && w <= max) tries.add(w);
  let best: Packing | null = null;
  let bestArea = Infinity;
  for (const w of [...tries].sort((a, b) => a - b)) {
    const p = packShelves(sizes, w, pad, max);
    const a = p.pages.reduce((t, g) => t + g.w * g.h, 0);
    if (!best || p.pages.length < best.pages.length || (p.pages.length === best.pages.length && a < bestArea)) {
      best = p;
      bestArea = a;
    }
  }
  return best ?? { pages: [], at: sizes.map(() => null) };
}

/**
 * 把一个特效的所有帧画出来（按 meta.fps，默认 30 帧 / 秒，一共 duration × fps 帧），裁掉空白，排进图集。
 * opts 里不用放位置；颜色、种子、旋钮在这里就定死了。同样的输入得到同样的输出（特效本身是确定的）。
 */
export function bakeAtlas(mod: FxModule, opts: FxOptions = {}, max = ATLAS_MAX): Atlas {
  const [w, h] = mod.meta.size;
  const [ox0, oy0] = mod.meta.origin;
  const fps = mod.meta.fps ?? 30;
  const loop = !!mod.meta.loop;
  const n = Math.max(1, Math.round((mod.meta.duration ?? 1) * fps));
  const fx = createFx(mod, { ...opts, x: ox0, y: oy0 });
  const frame = createFrame(w, h, 0, 0);
  const buf = new Uint8Array(w * h * 4);
  const shots: ({ r: Rect; px: Uint8Array } | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) fx.update(1 / fps);
    clearFrame(frame);
    fx.draw(frame);
    composite(frame, buf, null, 1); // 每个像素都会写到，buf 可以反复用
    const r = trimBounds(buf, w, h);
    if (!r) {
      shots.push(null);
      continue;
    }
    const px = new Uint8Array(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) {
      const from = ((r.y + y) * w + r.x) * 4;
      px.set(buf.subarray(from, from + r.w * 4), y * r.w * 4);
    }
    shots.push({ r, px });
  }
  const packed = packBest(shots.map((s) => s && s.r), max, 1);
  const pages: AtlasPage[] = packed.pages.map((p) => ({ w: p.w, h: p.h, data: new Uint8Array(p.w * p.h * 4) }));
  const frames = shots.map((s, i): AtlasFrame | null => {
    const p = packed.at[i];
    if (!s || !p) return null;
    const page = pages[p.page];
    for (let y = 0; y < s.r.h; y++) page.data.set(s.px.subarray(y * s.r.w * 4, (y + 1) * s.r.w * 4), ((p.y + y) * page.w + p.x) * 4);
    return { page: p.page, x: p.x, y: p.y, w: s.r.w, h: s.r.h, dx: s.r.x, dy: s.r.y };
  });
  return { pages, frames, fps, loop, ox0, oy0, w, h, pixels: pages.reduce((a, p) => a + p.w * p.h, 0) };
}
