// 回响敖丙的招式贴图（暂拟，待评审确认）：冰龙炸开后留在地上的那片冰面（按透视压扁成椭圆，纵向 FLAT 倍）——
// 岸线有起伏、不是一个圆；外沿天青、往里霜白 / 月白（棋盘格过渡），面上几道断开的冰裂；另有一组循环帧的碎光（几粒白点换着位置闪）。
// 冰龙、白龙、浪头是按路线每帧画的（game/echo-fx.ts），不在这里。纯函数（字符网格），游戏里转成纹理。
import type { Grid } from '../pixel.ts';
import { hash, Px } from './fx.ts';

const TAU = Math.PI * 2;
/** 地上的一圈纵向压成这么多（和九曲黄河的水一样）。 */
export const ICE_FLAT = 0.62;

const size = (r: number) => [Math.ceil(r * 2.1) + 4, Math.ceil(r * 2.1 * ICE_FLAT) + 4] as const;
/** 冰面的边：半径按角度起伏，带几个尖（冰是一块块结出去的）。最远到 r（判定半径）。 */
const edge = (a: number, seed: number) => 0.86 + 0.06 * Math.sin(3 * a + seed) + 0.05 * Math.abs(Math.sin(4.5 * a + seed * 1.3)) + 0.025 * Math.sin(11 * a + seed * 0.7);

/** 冰面（一张）。 */
export function iceBody(r: number, seed: number): Grid {
  const [S, SH] = size(r);
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  const p = new Px(S, SH);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - cx;
      const dy = (y - cy) / ICE_FLAT;
      const d = Math.hypot(dx, dy);
      const R = r * edge(Math.atan2(dy, dx), seed);
      if (d > R) continue;
      const k = d / R;
      const odd = (x + y) & 1;
      // 外沿一圈天青（薄冰透着底下的水色），往里霜白，最里面月白；两档之间用棋盘格过渡
      const band = k > 0.9 ? 0 : k + odd * 0.08 > 0.72 ? 1 : k + odd * 0.1 > 0.4 ? 2 : 3;
      p.set(x, y, ['c', odd ? 'C' : 'Z', odd ? 'Z' : 'C', odd ? 'Z' : 'w'][band]);
    }
  // 冰裂：从中心附近往外的几道断开的细线
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + hash(seed, i) * 0.8;
    const len = r * (0.45 + hash(seed, i, 7) * 0.35);
    for (let s = r * 0.12; s < len; s += 1) {
      if (hash(seed, i, Math.floor(s / 4)) < 0.25) continue; // 断开
      const wob = Math.sin(s * 0.5 + i) * 0.9;
      const x = cx + Math.cos(a) * s - Math.sin(a) * wob;
      const y = cy + (Math.sin(a) * s + Math.cos(a) * wob) * ICE_FLAT;
      if (p.get(x, y) !== '.') p.set(x, y, s < len * 0.5 ? 'n' : 'c');
    }
  }
  return p.grid();
}

/** 冰面上的碎光：n 帧，每帧几粒白点（位置按帧换，隔几帧回到原处）。 */
export function iceGlints(r: number, seed: number, n: number): Grid[] {
  const [S, SH] = size(r);
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  return Array.from({ length: n }, (_, f) => {
    const p = new Px(S, SH);
    for (let i = 0; i < 6; i++) {
      if ((i + f) % 3) continue; // 每帧亮其中两粒
      const a = hash(seed, i, 3) * TAU;
      const d = r * (0.15 + hash(seed, i, 5) * 0.6);
      const x = Math.round(cx + Math.cos(a) * d);
      const y = Math.round(cy + Math.sin(a) * d * ICE_FLAT);
      p.set(x, y, 'W');
      if ((f + i) % 2) {
        p.set(x - 1, y, 'w');
        p.set(x + 1, y, 'w');
      }
    }
    return p.grid();
  });
}
