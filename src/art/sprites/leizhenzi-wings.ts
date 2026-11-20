// 雷震子展开的风雷双翅（神通「风雷翅」腾空、俯冲、砸下时画在人物身后；收拢的样子画在人物帧里，见 leizhenzi.ts）。
// 朝右绘制（人物朝左时整体镜像）；每一张的锚点 WINGS_ROOT 是翅根（对上人物帧里的 WING_ROOT，再加上那一帧上身的前倾）。
// 程序生成：翅膀沿 a 方向伸出去（一根略拱的前缘），六到八根两像素宽的飞羽从前缘往后拖（越近翅尖越长、越往翅尖的方向偏，羽尖错落），
// 外沿上段描金，覆羽两排（葱黄一道、石绿一片片），飞羽受光的一边石绿、另一边松绿、后面一道墨绿的影；远处那只同样画、往上错一点、压暗一档，先画在后面。
// 一张图只有两只翅膀，没有光圈、没有辉光；电光在 wing-fx.ts 里另画（沿着翅尖一闪一闪）。
import { compose, grid, outline, type Grid } from '../pixel.ts';

export const WINGS_W = 64;
export const WINGS_H = 56;
/** 翅根在这张图上的位置。 */
export const WINGS_ROOT = { x: 32, y: 32 };

/** 一只翅膀的样子：a 前缘的方向（弧度，0 朝右、y 朝下：负的朝上），len 前缘多长，feather 飞羽多长，fan 飞羽往翅尖方向偏多少，arch 前缘拱多少。 */
export interface WingShape {
  a: number;
  len: number;
  feather: number;
  fan: number;
  arch: number;
}

const SEL: Record<string, string> = { y: 'B', Y: 'B', b: 'B', l: 'G', L: 'G', v: 'G' };
const DARK: Record<string, string> = { Y: 'y', y: 'b', b: 'B', L: 'l', l: 'v', v: 'G', G: 'G' };

/** 画一只翅膀（朝右、翅根在 WINGS_ROOT）。dark：远处那只，压暗一档。 */
function oneWing(s: WingShape, dark: boolean): Grid {
  const rows = Array.from({ length: WINGS_H }, () => Array(WINGS_W).fill('.'));
  const rank = (c: string) => '.GvlLbyY'.indexOf(c);
  const put = (x: number, y: number, c: string, force = false) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= WINGS_W || y >= WINGS_H) return;
    if (force || rank(c) >= rank(rows[y][x]) || rows[y][x] === '.') rows[y][x] = c;
  };
  const ox = WINGS_ROOT.x;
  const oy = WINGS_ROOT.y;
  const ux = Math.cos(s.a);
  const uy = Math.sin(s.a);
  // 前缘的法线：朝翅膀「后面」（飞羽拖出去的那一边）
  const nx = uy;
  const ny = -ux;
  const edge = (t: number): [number, number] => [ox + ux * s.len * t - nx * s.arch * Math.sin(Math.PI * t), oy + uy * s.len * t - ny * s.arch * Math.sin(Math.PI * t)];
  // 飞羽（2026-11-11 改：原来一根根一像素的细线挤在一起，像一把绿毛）：从前缘 t = 0.15 … 1 隔开长出 6–8 根，
  // 每根两像素宽——朝翅尖的那一边受光（石绿，羽尖葱黄）、往翅根的那一边松绿，再往后一格墨绿的影；越近翅尖越长、越往翅尖的方向偏，
  // 根和根之间隔开，后缘的羽尖一根根错落（不是一整片）。近翅根的几根短（次级飞羽），翅尖那几根长（初级飞羽）。
  const N = Math.max(6, Math.round(s.len / 3));
  for (let i = 0; i < N; i++) {
    const t = 0.15 + (0.85 * i) / (N - 1);
    const [bx, by] = edge(t);
    const fa = s.a - Math.PI / 2 + s.fan * t * t;
    const fl = s.feather * (0.5 + 0.5 * t) * (i === N - 1 ? 0.9 : 1);
    const fx = Math.cos(fa);
    const fy = Math.sin(fa);
    const steps = Math.ceil(fl * 1.5);
    for (let k = 0; k <= steps; k++) {
      const q = k / steps;
      const x = bx + fx * fl * q;
      const y = by + fy * fl * q;
      put(x - ux * 1.6, y - uy * 1.6, 'G'); // 影
      put(x - ux * 0.8, y - uy * 0.8, q > 0.86 ? 'l' : 'v');
      put(x, y, q > 0.86 ? 'L' : 'l');
    }
  }
  // 覆羽：前缘后面一道葱黄、一排一片片的石绿（每隔几格一片亮的，像压着的鳞）
  for (let k = 0; k <= 60; k++) {
    const t = k / 60;
    const [x, y] = edge(t);
    if (t < 0.92) put(x + nx * 1.3, y + ny * 1.3, 'L');
    if (t < 0.85) put(x + nx * 2.4, y + ny * 2.4, k % 5 < 2 ? 'L' : 'l');
    if (t < 0.7) put(x + nx * 3.4, y + ny * 3.4, k % 5 < 2 ? 'l' : 'v');
  }
  // 前缘：上段（靠翅根的七成）描金，翅尖一截琥珀
  for (let k = 0; k <= 80; k++) {
    const t = k / 80;
    const [x, y] = edge(t);
    put(x, y, t < 0.08 ? 'b' : t < 0.7 ? (k % 9 === 0 ? 'Y' : 'y') : 'b', true);
  }
  let g = grid(rows.map((r) => r.join('')));
  if (dark) g = grid(g.rows.map((r) => [...r].map((c) => DARK[c] ?? c).join('')));
  return g;
}

/** 一对翅膀：远的那只（往上偏 farDa、短一点、压暗）先画，近的盖在上面；描好边。 */
export function wingPair(near: WingShape, farDa = -0.32, farLen = 0.9): Grid {
  const far = oneWing({ ...near, a: near.a + farDa, len: near.len * farLen, feather: near.feather * farLen }, true);
  const n = oneWing(near, false);
  return outline(compose(WINGS_W, WINGS_H, [{ g: far, x: 0, y: -2 }, { g: n, x: 0, y: 0 }]), 'k', SEL);
}

const D = Math.PI / 180;
/** 扇一下的几张：翅膀举起、平展、往下压（腾空和砸完弹起时轮着放）。 */
export const FLAP: WingShape[] = [
  { a: -100 * D, len: 22, feather: 13, fan: 0.7, arch: 2.2 },
  { a: -140 * D, len: 23, feather: 12, fan: 0.6, arch: 2.5 },
  { a: -175 * D, len: 22, feather: 11, fan: 0.5, arch: 2 },
  { a: -140 * D, len: 23, feather: 12, fan: 0.6, arch: 2.5 },
];
/** 俯冲：翅膀往后收成两把刀（像扑下来的隼）。 */
export const SWEPT: WingShape = { a: -160 * D, len: 21, feather: 7, fan: 0.25, arch: 1.2 };
/** 砸下：两只翅膀一下子张开、往上扬。 */
export const FLARE: WingShape = { a: -80 * D, len: 23, feather: 14, fan: 0.9, arch: 2.6 };

export function makeWingFrames(): { flap: Grid[]; swept: Grid; flare: Grid } {
  return { flap: FLAP.map((s) => wingPair(s)), swept: wingPair(SWEPT, -0.2, 0.92), flare: wingPair(FLARE, -0.45, 0.88) };
}
