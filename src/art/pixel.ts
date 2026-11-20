// 手写像素网格的工具：图层合成、镜像、输出 RGBA。纯函数，不依赖 DOM，
// 游戏运行时（生成纹理）和 Node 工具（输出 PNG 自查）共用。
import { PALETTE, TRANSPARENT, hexToRgba } from './palette.ts';

/** 一张像素图：每行一个字符串，'.' 为透明，其余字符查调色板。 */
export interface Grid {
  w: number;
  h: number;
  rows: string[];
}

export function grid(rows: string[]): Grid {
  const w = Math.max(...rows.map((r) => r.length));
  return { w, h: rows.length, rows: rows.map((r) => r.padEnd(w, TRANSPARENT)) };
}

export interface Layer {
  g: Grid;
  x: number;
  y: number;
  /** 把这一层的所有非透明像素替换成同一个颜色（用于剪影、受击闪白）。 */
  tint?: string;
}

/** 按顺序把图层画到 w×h 画布上，后画的盖住先画的。 */
export function compose(w: number, h: number, layers: Layer[]): Grid {
  const canvas: string[][] = Array.from({ length: h }, () => Array(w).fill(TRANSPARENT));
  for (const { g, x, y, tint } of layers) {
    for (let r = 0; r < g.h; r++) {
      const row = g.rows[r];
      for (let c = 0; c < g.w; c++) {
        const ch = row[c];
        if (ch === TRANSPARENT || ch === ' ') continue;
        const X = x + c;
        const Y = y + r;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        canvas[Y][X] = tint ?? ch;
      }
    }
  }
  return { w, h, rows: canvas.map((r) => r.join('')) };
}

export function flipX(g: Grid): Grid {
  return { w: g.w, h: g.h, rows: g.rows.map((r) => [...r].reverse().join('')) };
}

/**
 * 在有色像素外围补一圈描边（只补透明处）。已经是描边色的像素不算「有色」，
 * 所以手画了描边的部位不会被描成两层。
 *
 * `selout` 给出「同色系描边」：按相邻像素的颜色挑描边色（比如红绸用暗红描），
 * 比通体纯黑描边更柔和、更有质感。相邻多种颜色时，纯黑优先，保证外轮廓清楚。
 */
export function outline(g: Grid, ch = 'k', selout?: Record<string, string>): Grid {
  const out = g.rows.map((r) => [...r]);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < g.w && y < g.h ? g.rows[y][x] : TRANSPARENT);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (at(x, y) !== TRANSPARENT) continue;
      let pick: string | null = null;
      for (const [dx, dy] of [
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ]) {
        const c = at(x + dx, y + dy);
        if (c === TRANSPARENT || c === ch) continue;
        const want = selout?.[c] ?? ch;
        if (pick === null || want === ch) pick = want;
      }
      if (pick) out[y][x] = pick;
    }
  return { w: g.w, h: g.h, rows: out.map((r) => r.join('')) };
}

export function toRgba(g: Grid): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(g.w * g.h * 4);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const ch = g.rows[y][x];
      if (ch === TRANSPARENT || ch === ' ') continue;
      const hex = PALETTE[ch];
      if (!hex) throw new Error(`unknown palette char '${ch}' at ${x},${y}`);
      buf.set(hexToRgba(hex), (y * g.w + x) * 4);
    }
  return buf;
}

/** 校验所有字符都在调色板里，返回出错位置（供测试和工具使用）。 */
export function invalidChars(g: Grid): string[] {
  const bad: string[] = [];
  g.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== TRANSPARENT && ch !== ' ' && !PALETTE[ch]) bad.push(`'${ch}'@${x},${y}`);
    }),
  );
  return bad;
}
