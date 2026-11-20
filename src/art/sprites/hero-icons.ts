// 杨戬的几个 16×16 图标（波间界面用）：专属法宝三尖两刃刀、宠物哮天犬（起手 / 天狗 / 金牙）。
// 和 icons.ts 同一个规矩：内容画在 14×14 以内、居中，外圈补一圈玄色描边；在 icons.ts 里登记进 WEAPON_ICONS / PET_ICONS。
import { compose, grid, outline, type Grid } from '../pixel.ts';
import { rotSprite } from './fx.ts';
import { HOUND_FRAMES } from './xiaotian.ts';

/** 一个 16×16 图标：内容不超过 14×14、居中，外圈描玄色边；accent 是描边之后再叠上去的点缀（不描边）。 */
function icon(g: Grid, accent?: Grid, sel?: Record<string, string>): Grid {
  const x = 1 + ((14 - g.w) >> 1);
  const y = 1 + ((14 - g.h) >> 1);
  const base = outline(compose(16, 16, [{ g, x, y }]), 'k', sel);
  return accent ? compose(16, 16, [{ g: base, x: 0, y: 0 }, { g: accent, x: 0, y: 0 }]) : base;
}

// ---------------------------------------------------------------- 三尖两刃刀：斜着放（刀头朝右上），和火尖枪的图标一个方向

/** 图标里的刀短一截（刀头照原样、杆短一些），转 45° 正好放进 14×14。 */
const SHORT = grid([
  '...w...',
  '...w...',
  'w..w..w',
  'wj.w.jw',
  '.jjwjj.',
  '.jjwji.',
  '..jwi..',
  '..jwi..',
  '...i...',
  '..yYy..',
  '..rer..',
  '...g...',
  '...g...',
  '...g...',
  '...g...',
  '...B...',
  '...g...',
  '...b...',
]);
export const SANJIAN_ICON: Grid = icon(rotSprite(SHORT, Math.PI / 4, 3.5, 9).g, undefined, { y: 'B', Y: 'B', r: 'R', e: 'R' });

// ---------------------------------------------------------------- 哮天犬：起手（头、颈、前胸）/ 天狗（扑出去、身后一弯月）/ 金牙（张嘴露出金牙）
// 从狗的精灵上直接裁（art/sprites/xiaotian.ts：乌黑的细犬），图标和场上的狗是同一只。

const SEL = { r: 'R', e: 'R', y: 'B', Y: 'B' };
/** 从一帧上裁一块（14×14 以内）。 */
const cut = (g: Grid, x: number, y: number, w: number, h: number): Grid => ({ w, h, rows: g.rows.slice(y, y + h).map((r) => r.slice(x, x + w)) });
/** 起手：站着的狗，立耳、长嘴、金眼，颈上朱红项圈和金铃，一条前腿。 */
const HOUND_BASE = cut(HOUND_FRAMES.idle[0], 17, 0, 14, 14);
/** 天狗：冲刺伸展的那一帧（前腿往前够），身后一弯淡金的月牙（天狗吞月）。 */
const HOUND_POUNCE = cut(HOUND_FRAMES.run[0], 15, 2, 14, 14);
const MOON = grid(['..fY', '.Y..', 'Y...', 'Y...', '.Y..', '..fY']);
/** 金牙：张嘴扑出去的那一帧，牙换成金的。 */
const HOUND_FANG = cut(grid(HOUND_FRAMES.bite[0].rows.map((r) => r.replace(/w/g, 'Y'))), 17, 0, 14, 14);

export const HOUND_ICONS: { base: Grid; pounce: Grid; fang: Grid } = {
  base: icon(HOUND_BASE, undefined, SEL),
  pounce: icon(HOUND_POUNCE, compose(16, 16, [{ g: MOON, x: 1, y: 1 }]), SEL),
  fang: icon(HOUND_FANG, undefined, SEL),
};
