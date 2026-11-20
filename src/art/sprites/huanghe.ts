// 云霄神通「九曲黄河」的地面贴图（暂拟，待评审确认）：一圈浑黄的河水（按透视压扁成椭圆，纵向 FLAT 倍），
// 越往中间越深（浅黄土 → 泥黄 → 琥珀 → 赭），岸边断断续续的白浪；水上三道往中心卷的漩涡纹（一组循环帧，逆时针转）。
// 第二章的地是黄土：水的颜色比地深、偏琥珀，再靠月白的浪头和漩涡分出来。
// 都是断开的短线和有起伏的岸线，不是一个圆圈、不是硬直线边界。纯函数（字符网格），游戏里转成纹理，Node 里也能出 PNG 自查。
import type { Grid } from '../pixel.ts';
import { hash, Px } from './fx.ts';

const TAU = Math.PI * 2;
/** 和模拟里的 FLAT 一样（sim/heroes/yunxiao.ts）：地上的一圈纵向压成这么多。这里不引模拟的模块，数字写在一处对得上就行。 */
export const RIVER_FLAT = 0.62;

/** 岸线：半径按角度轻轻起伏（ph 让它慢慢动）。最远到 r（判定半径），不往外凸出判定范围。 */
function shore(a: number, seed: number, ph: number) {
  return 0.9 + 0.045 * Math.sin(3 * a + seed) + 0.035 * Math.sin(5 * a + seed * 1.7 + ph) + 0.02 * Math.sin(9 * a + ph * 2);
}

const size = (r: number) => [Math.ceil(r * 2.1) + 4, Math.ceil(r * 2.1 * RIVER_FLAT) + 4] as const;

/** 水底（一张）：越往中间越深；岸边一圈浅水。 */
export function riverBody(r: number, seed: number): Grid {
  const [S, SH] = size(r);
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  const p = new Px(S, SH);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - cx;
      const dy = (y - cy) / RIVER_FLAT;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const R = r * shore(a, seed, 0);
      if (d > R) continue;
      const k = d / R;
      // 浑黄：每一档是两种颜色的棋盘格（琥珀和黄土、赭和深黄土混出来的泥黄），深浅交界处错开一点，不画成一圈圈的硬边
      const odd = (x + y) & 1;
      const j = odd * 0.05;
      const band = k + j > 0.88 ? 0 : k + j > 0.62 ? 1 : k + j > 0.32 ? 2 : 3;
      p.set(x, y, [odd ? 'E' : 'a', odd ? 'a' : 'b', odd ? 'b' : 'A', odd ? 'A' : 'B'][band]);
    }
  return p.grid();
}

/**
 * 水面（一组循环帧，n 帧转过 120°：三道漩涡一样，转完正好接上）：三道往中心卷的漩涡纹（浪头月白、身子浅黄、背后一像素暗面），
 * 岸边断断续续的白浪（沿岸慢慢走），零星几点水光。
 */
export function riverSwirl(r: number, seed: number, n = 16): Grid[] {
  const [S, SH] = size(r);
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  const out: Grid[] = [];
  const steps = Math.round(TAU * r * 1.3);
  for (let f = 0; f < n; f++) {
    const p = new Px(S, SH);
    const rot = -(f / n) * (TAU / 3); // 逆时针（画面上；和模拟里卷着转的方向一样）
    const ph = (f / n) * TAU;
    for (let arm = 0; arm < 3; arm++) {
      const len = Math.round(r * 3.2);
      for (let i = 0; i < len; i++) {
        const u = i / len; // 0 外 … 1 中心
        const rr = r * 0.86 * (1 - u) + 3;
        const a = rot + (arm / 3) * TAU - u * 3.6;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * RIVER_FLAT;
        if (u < 0.05 || (u > 0.18 && u < 0.23) || (u > 0.5 && u < 0.54)) continue; // 浪头断开几下，不连成一个圈
        p.set(x, y, u < 0.3 ? 'w' : u < 0.7 ? 'F' : 'E');
        if (u > 0.08 && u < 0.75) p.under(x, y + 1, 'H');
      }
    }
    // 岸边白浪：一段一段，沿岸慢慢走
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU;
      const R = r * shore(a, seed, ph);
      const dash = Math.sin(a * 13 - ph + seed) + 0.35 * Math.sin(a * 5 + ph * 2);
      if (dash < -0.2) continue;
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R * RIVER_FLAT;
      p.set(x, y, dash > 0.8 ? 'w' : 'j');
    }
    // 水光：几点浮沫
    for (let k = 0; k < Math.round(r / 7); k++) {
      if (hash(seed, k, f) < 0.5) continue;
      const a = hash(seed, k, 1) * TAU + rot;
      const rr = Math.sqrt(hash(seed, k, 2)) * r * 0.8;
      p.set(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * RIVER_FLAT, 'j');
    }
    out.push(p.grid());
  }
  return out;
}

/** 只留椭圆半径 k（0..1）以内的部分：水从中心铺开的那几帧。 */
export function riverReveal(g: Grid, k: number): Grid {
  const cx = (g.w - 1) / 2;
  const cy = (g.h - 1) / 2;
  const R = (g.w / 2) * k;
  return { w: g.w, h: g.h, rows: g.rows.map((row, y) => [...row].map((ch, x) => (Math.hypot(x - cx, (y - cy) / RIVER_FLAT) <= R ? ch : '.')).join('')) };
}
