// 混元金斗里的敌人（模拟里暂时拿出了 w.enemies，放在 Player.dou.held 上）此刻画在哪、画多大：
// 敌人的画面（enemy-views.ts）和金斗的画面（dou-fx.ts）都照这里算，斗口的位置两边对得上。
// 一斗的时刻都在 Player.dou 上（模拟的 w.time）；表现层用插值那一刻的时间（renderTime）。
import { DT } from '../../sim/config.ts';
import { DOU } from '../../sim/heroes/yunxiao.ts';
import type { DouCast, Enemy } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

/** 吸、在斗里、喷的时候，斗口离地多高（斗口在 (d.x, d.y) 正上方）。 */
export const DOU_HOVER = 24;
/** 喷出去的那一道弧，最高比斗口和落点的连线再高多少。 */
const ARC = 10;
/** 被吸进去的那一段画多久（吸进去的那一刻起：被拽起来、边转边缩、落进斗口）。 */
const SUCK_ANIM = 0.26;

/** 表现层的「现在」：模拟最后一帧的时刻，按插值往回退到这一帧画的那一刻。 */
export const renderTime = (w: World, alpha: number) => w.time - DT * (1 - alpha);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 斗里的一只此刻的样子：(x, y) 地面上的点（影子画在这里），z 离地多高，s 缩放，a 透明度，spin 转了多少（弧度）。 */
export interface HeldPose {
  x: number;
  y: number;
  z: number;
  s: number;
  a: number;
  spin: number;
}

/**
 * 第 i 只此刻画在哪；在斗里（看不见）返回 null。
 * - 吸：从站的地方被拽起来、越来越快地落进斗口，边转边缩（缩到两成）；
 * - 在斗里：看不见（斗在摇）；
 * - 喷：从斗口抛出去，划一道弧落在落点上，边飞边变回原来的大小，翻着跟头。
 */
export function heldPose(d: DouCast, i: number, t: number): HeldPose | null {
  const [fx, fy] = d.from[i] ?? [d.x, d.y];
  const t0 = d.at[i] ?? d.tSuck;
  if (t < t0 + SUCK_ANIM) {
    const k = clamp01((t - t0) / SUCK_ANIM);
    const e = k * k; // 越拽越快
    return { x: fx + (d.x - fx) * e, y: fy + (d.y - fy) * e, z: DOU_HOVER * Math.pow(k, 0.8), s: crisp(1 - 0.8 * e), a: 1 - 0.5 * e, spin: quarter((i % 2 ? -1 : 1) * 1.8 * e) };
  }
  if (t < d.tSpit || !d.land.length) return null;
  const k = clamp01((t - d.tSpit) / DOU.fall);
  const [lx, ly] = d.land[i] ?? [d.x, d.y];
  const z = DOU_HOVER * (1 - k) + ARC * 4 * k * (1 - k);
  const g = 1 - (1 - k) ** 2;
  return { x: d.x + (lx - d.x) * k, y: d.y + (ly - d.y) * k, z, s: crisp(0.3 + 0.7 * g), a: 0.6 + 0.4 * g, spin: quarter((i % 2 ? 1 : -1) * Math.PI * 2 * k) };
}

/** 像素图不画成任意角度、任意大小（会糊、会歪）：转只转整的四分之一圈（翻跟头），缩只缩成一半。 */
const quarter = (a: number) => (Math.round(a / (Math.PI / 2)) * Math.PI) / 2;
const crisp = (s: number) => (s >= 0.72 ? 1 : 0.5);

/** 场上所有斗里的敌人：[敌人, 那一斗, 第几只]。 */
export function heldEnemies(w: World): [Enemy, DouCast, number][] {
  const out: [Enemy, DouCast, number][] = [];
  for (const p of w.players) {
    const d = p.dou;
    if (d) d.held.forEach((e, i) => out.push([e, d, i]));
  }
  return out;
}
