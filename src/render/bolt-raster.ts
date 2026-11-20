// 闪电的快速栅格化：把一组折线直接画进一块 RGBA 缓冲（白芯、亮色身子、深色描边）。
// 画出来的每一个像素都和 src/art/sprites/fx.ts 的 boltGrid（字符网格 → 描边 → 转色）一样——那是「标准答案」，
// src/game/bolt-raster.test.ts 拿随机折线逐像素对过。区别只在快：不拼字符串、不建网格对象、描边只看画过的像素周围，
// 雷公鞭一次出手要画十几二十张，原来的画法出手那一帧要多花几毫秒。
// 不依赖 Pixi 和 DOM。
import type { BoltPath, BoltStyle } from '../art/sprites/fx.ts';
import { PAL32 } from './pixel-raster.ts';

/** 每种配色的四个颜色（调色板字符）：芯、身子、身子外面的描边、芯直接露在外面时的描边。和 boltGrid 的配色表一致。 */
const STYLE: Record<BoltStyle, { core: string; body: string; edge: string; coreEdge: string }> = {
  azure: { core: 'W', body: 'C', edge: 'N', coreEdge: 'n' },
  gold: { core: 'W', body: 'Y', edge: 'B', coreEdge: 'b' },
  violet: { core: 'W', body: 'm', edge: 'P', coreEdge: 'p' },
};
const COLORS = Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, [0, PAL32[v.core.charCodeAt(0)], PAL32[v.body.charCodeAt(0)], PAL32[v.edge.charCodeAt(0)], PAL32[v.coreEdge.charCodeAt(0)]]])) as Record<BoltStyle, number[]>;

const CORE = 1;
const BODY = 2;
const EDGE = 3;
const CORE_EDGE = 4;

/** 一道闪电占多大：(ox, oy) 是左上角在折线坐标系里的位置，贴图时 sprite.position = (ox, oy)。四周各留 4 像素。 */
export interface BoltBox {
  ox: number;
  oy: number;
  w: number;
  h: number;
}
export function boltBox(paths: BoltPath[]): BoltBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of paths)
    for (const q of p.pts) {
      if (q[0] < minX) minX = q[0];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[1] > maxY) maxY = q[1];
    }
  const ox = Math.floor(minX) - 4;
  const oy = Math.floor(minY) - 4;
  return { ox, oy, w: Math.ceil(maxX) + 4 - ox + 1, h: Math.ceil(maxY) + 4 - oy + 1 };
}

// 画的时候用的临时格子（每格一个编号：0 空、1 芯、2 身子、3 / 4 描边）和「画过的格子」名单，按需变大、反复用
let cells = new Uint8Array(0);
let drawn = new Int32Array(0);
let nDrawn = 0;

/** Bresenham 直线（端点先四舍五入，和 Px.line 一样）。onlyEmpty：只画在空处。 */
function line(w: number, h: number, x0: number, y0: number, x1: number, y1: number, code: number, onlyEmpty: boolean) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) {
      const i = y0 * w + x0;
      const cur = cells[i];
      if (cur === 0) {
        cells[i] = code;
        drawn[nDrawn++] = i;
      } else if (!onlyEmpty) cells[i] = code;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * 把闪电画进 px：这块缓冲每行 stride 个像素，闪电占左上角的 box.w × box.h（这一块要事先清零）。
 * 写进去的是不透明的颜色（0xAABBGGRR），空处不动。
 */
export function rasterBolt(paths: BoltPath[], style: BoltStyle, box: BoltBox, px: Uint32Array, stride: number) {
  const { ox, oy, w, h } = box;
  if (cells.length < w * h) cells = new Uint8Array(w * h);
  else cells.fill(0, 0, w * h);
  // 每条线段最多画五遍（两侧、上下、芯），每遍不超过 w + h 个像素
  let need = 0;
  for (const p of paths) need += (p.pts.length - 1) * 5 * (w + h + 2);
  if (drawn.length < need) drawn = new Int32Array(need);
  nDrawn = 0;
  // 先画细的、后画粗的（粗的盖在上面）。同样粗细的保持原来的先后
  for (let wd = 1; wd <= 3; wd++)
    for (const path of paths) {
      if (path.w !== wd) continue;
      for (let i = 0; i < path.pts.length - 1; i++) {
        const X0 = path.pts[i][0] - ox;
        const Y0 = path.pts[i][1] - oy;
        const X1 = path.pts[i + 1][0] - ox;
        const Y1 = path.pts[i + 1][1] - oy;
        if (wd >= 2) {
          line(w, h, X0 - 1, Y0, X1 - 1, Y1, BODY, true);
          line(w, h, X0 + 1, Y0, X1 + 1, Y1, BODY, true);
          if (wd === 3) {
            line(w, h, X0, Y0 - 1, X1, Y1 - 1, BODY, true);
            line(w, h, X0, Y0 + 1, X1, Y1 + 1, BODY, true);
          }
          line(w, h, X0, Y0, X1, Y1, CORE, false);
        } else line(w, h, X0, Y0, X1, Y1, BODY, true);
      }
    }
  // 描边：画过的像素四周的空格——挨着身子的描深色边，只挨着芯的描芯的边
  const col = COLORS[style];
  const n = nDrawn;
  for (let k = 0; k < n; k++) {
    const i = drawn[k];
    const x = i % w;
    const y = (i - x) / w;
    px[y * stride + x] = col[cells[i]];
    for (let d = 0; d < 4; d++) {
      const qx = d === 1 ? x - 1 : d === 2 ? x + 1 : x;
      const qy = d === 0 ? y - 1 : d === 3 ? y + 1 : y;
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
      const q = qy * w + qx;
      if (cells[q] !== 0) continue;
      // 这个空格的四邻里有没有身子、有没有芯
      let body = false;
      let core = false;
      if (qy > 0) {
        const c = cells[q - w];
        if (c === BODY) body = true;
        else if (c === CORE) core = true;
      }
      if (qx > 0) {
        const c = cells[q - 1];
        if (c === BODY) body = true;
        else if (c === CORE) core = true;
      }
      if (qx < w - 1) {
        const c = cells[q + 1];
        if (c === BODY) body = true;
        else if (c === CORE) core = true;
      }
      if (qy < h - 1) {
        const c = cells[q + w];
        if (c === BODY) body = true;
        else if (c === CORE) core = true;
      }
      const code = body ? EDGE : core ? CORE_EDGE : 0;
      if (code) {
        cells[q] = code;
        px[qy * stride + qx] = col[code];
      }
    }
  }
}
