// 新敌人精灵共用的小工具：在字符网格上逐像素画线、画点（矛杆、冲锋的长矛、引信火星……）。
// 和 soldier.ts 里画长矛的写法一样，只是收成一处，几个新敌人的文件共用。
import { grid, type Grid } from '../pixel.ts';

export interface Sketch {
  w: number;
  h: number;
  rows: string[][];
  /** 画一个像素（越界不画；keep = true 时不覆盖已有的像素）。 */
  set(x: number, y: number, c: string, keep?: boolean): void;
  /** 一像素宽的直线（端点含），每个点的颜色由 color(i, n) 决定（i 从 0 到 n）。 */
  line(x0: number, y0: number, x1: number, y1: number, color: string | ((i: number, n: number) => string), keep?: boolean): void;
  /** 贴一张小网格（'.' 透明）。 */
  stamp(g: Grid, x: number, y: number, keep?: boolean): void;
  grid(): Grid;
}

export function sketch(w: number, h: number): Sketch {
  const rows = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  const s: Sketch = {
    w,
    h,
    rows,
    set(x, y, c, keep = false) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h || c === '.') return;
      if (keep && rows[y][x] !== '.') return;
      rows[y][x] = c;
    },
    line(x0, y0, x1, y1, color, keep = false) {
      const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        s.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, typeof color === 'string' ? color : color(i, n), keep);
      }
    },
    stamp(g, x, y, keep = false) {
      for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) s.set(x + c, y + r, g.rows[r][c], keep);
    },
    grid: () => grid(rows.map((r) => r.join(''))),
  };
  return s;
}

/** 把网格里的某些颜色换成别的（受热泛红、换一身颜色的变体）。 */
export function recolor(g: Grid, map: Record<string, string>): Grid {
  return { w: g.w, h: g.h, rows: g.rows.map((r) => [...r].map((c) => map[c] ?? c).join('')) };
}
