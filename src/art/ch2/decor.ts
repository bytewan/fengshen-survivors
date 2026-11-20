// 第二章 · 西岐城外的零碎道具：阵台上的阵旗（褪色的三角旗，几帧摆动）、镇符桩、碎石。朝右绘制。
// 用户口径：旗子不能画得太大（2026-11-10）——阵旗连旗杆 14 像素高，旗面只有 5 像素宽，比哪吒（16×24）小得多。
import { compose, grid, outline, type Grid } from '../pixel.ts';

const SELOUT: Record<string, string> = { j: 'h', i: 'h', w: 'h', F: 'H', y: 'B', Y: 'b', B: 'D', b: 'B', E: 'A', a: 'D', A: 'D', Q: 'g', h: 'g' };

/** 阵旗的旗杆高（不含杆头）、旗面宽、旗面高。锚点在杆脚 (1, FLAG_H - 1)。 */
export const FLAG_W = 9;
export const FLAG_H = 16;
export const FLAG_ANCHOR = { x: 1, y: 15 };

/**
 * 一帧阵旗：旗杆（赭色木杆、顶上一点金色杆头），旗面是一面三角旗，挂在杆子上端、往右飘。
 * phase 0..1 是摆动的相位；wind 0 = 平时（旗面垂着轻轻摆），1 = 猎猎（阵要亮起来：旗面绷直、抖得快）。
 * 旗面用缟色和银鼠（褪了色），表现层再按阵的种类着色（白底着色才着得上）。
 */
function flagFrame(phase: number, wind: number): Grid {
  const rows = Array.from({ length: FLAG_H }, () => Array<string>(FLAG_W).fill('.'));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < FLAG_W && y < FLAG_H) rows[y][x] = c;
  };
  // 旗杆
  set(1, 0, 'Y');
  set(1, 1, 'y');
  for (let y = 2; y < FLAG_H; y++) set(1, y, y % 4 === 0 ? 'b' : 'B');
  // 旗面：从杆上第 2 行到第 7 行，越往下越短（三角），自由边上下波动
  const top = 2;
  const H = wind > 0.5 ? 5 : 6;
  for (let r = 0; r < H; r++) {
    const k = r / (H - 1);
    const base = wind > 0.5 ? 6 - Math.round(k * 3.4) : 5 - Math.round(k * 3.6);
    const wave = Math.round(Math.sin(phase * Math.PI * 2 + r * (wind > 0.5 ? 1.4 : 0.8)) * (wind > 0.5 ? 1 : 0.6));
    const len = Math.max(1, base + (r > 0 ? wave : 0));
    const droop = wind > 0.5 ? 0 : Math.round(Math.max(0, k - 0.4) * 1.5); // 平时旗梢往下垂一点
    for (let i = 0; i < len; i++) {
      const x = 2 + i;
      const y = top + r + (i === len - 1 ? droop : 0);
      const edge = i === len - 1 || r === H - 1;
      set(x, y, edge ? 'i' : (i + r + Math.round(phase * 4)) % 5 === 0 ? 'i' : 'j');
    }
  }
  return grid(rows.map((r) => r.join('')));
}

/** 阵旗：平时的四帧轻摆、猎猎的四帧抖动。 */
export const FLAG = {
  idle: [0, 0.25, 0.5, 0.75].map((p) => flagFrame(p, 0)),
  flutter: [0, 0.25, 0.5, 0.75].map((p) => flagFrame(p, 1)),
};

const lined = (rows: string[]) => {
  const g = grid(rows);
  return outline(compose(g.w + 2, g.h + 2, [{ g, x: 1, y: 1 }]), 'k', SELOUT);
};

/** 镇符桩：一截插在地上的木桩，桩头贴一张褪色的黄符（一角翘起）。 */
export const STAKE = lined(['.FF.', 'FrF.', 'FrFF', '.BF.', '.B..', '.b..', '.B..', '.B..', '.B..', 'DBD.']);

/** 碎石：两种大小，灰紫石、左上受光。 */
export const ROCKS: Grid[] = [lined(['.ih.', 'iQQh', 'QQhg']), lined(['..ih...', '.iQQh..', 'iQQQhih', 'QQhhQQh', '.hgghg.'])];
