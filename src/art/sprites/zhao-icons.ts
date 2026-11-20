// 赵公明的几个 16×16 图标（波间界面用）：专属法宝定海珠、宠物黑虎（起手 / 啸风 / 破财）。
// 和 icons.ts 同一个规矩：内容画在 14×14 以内、居中，外圈补一圈玄色描边；在 icons.ts 里登记进 WEAPON_ICONS / BRANCH_ICONS / PET_BASE_ICONS。
import { compose, grid, outline, type Grid } from '../pixel.ts';
import { TIGER_FRAMES } from './heihu.ts';

/** 一个 16×16 图标：内容不超过 14×14、居中，外圈描玄色边；accent 是描边之后再叠上去的点缀（不描边）。 */
function icon(g: Grid, accent?: Grid, sel?: Record<string, string>): Grid {
  const x = 1 + ((14 - g.w) >> 1);
  const y = 1 + ((14 - g.h) >> 1);
  const base = outline(compose(16, 16, [{ g, x, y }]), 'k', sel);
  return accent ? compose(16, 16, [{ g: base, x: 0, y: 0 }, { g: accent, x: 0, y: 0 }]) : base;
}

// ---------------------------------------------------------------- 定海珠：一串珠子绕成一圈（金线穿着），下面坠一颗大的

/** 一圈七颗小珠（3×3，左上受光）+ 坠在下面的一颗大珠（4×4），中间是穿珠的金线。 */
const DINGHAI = grid([
  '.....jwj......',
  '..jw.jji.jw...',
  '..jji.y..jji..',
  '...i.b...bi...',
  '.jw.b.....bjw.',
  '.jjiy.....yji.',
  '..i.b.....b...',
  '...jwb...bjw..',
  '...jji.y.jji..',
  '....i.jwwj.i..',
  '......jjwj....',
  '......ijji....',
  '.......ii.....',
]);
export const DINGHAI_ICON: Grid = icon(DINGHAI, undefined, { y: 'B', b: 'B' });

// ---------------------------------------------------------------- 黑虎：起手（正脸看过来的虎头）/ 啸风（张口吼、口边两道风）/ 破财（颈下挂一枚方孔金钱）
// 从虎的精灵上直接裁（art/sprites/heihu.ts），图标和场上的虎是同一只。

const SEL = { y: 'B', Y: 'B', b: 'B' };
/** 从一帧上裁一块（14×14 以内）。 */
const cut = (g: Grid, x: number, y: number, w: number, h: number): Grid => ({ w, h, rows: g.rows.slice(y, y + h).map((r) => r.slice(x, x + w)) });
/** 起手：黑虎的正脸（圆耳、额上「王」字、金眼、白腮），连着前胸和一条前腿。 */
const TIGER_BASE = cut(TIGER_FRAMES.idle[0], 18, 2, 14, 14);
/** 啸风：张口吼（獠牙、舌），口边两道天青的风纹。 */
const TIGER_ROAR = cut(TIGER_FRAMES.roar[0], 18, 1, 14, 14);
const WIND = grid(['............C.', '..............', '.............c', '..............', '............cC']);
/** 破财：起手的虎头，颈下挂一枚方孔金钱（金线系着）。 */
const COIN = grid(['.byb.', 'by.yb', 'b...b', 'by.yb', '.byb.']);

export const TIGER_ICONS: { base: Grid; gale: Grid; broke: Grid } = {
  base: icon(TIGER_BASE, undefined, SEL),
  gale: icon(TIGER_ROAR, compose(16, 16, [{ g: WIND, x: 1, y: 6 }]), SEL),
  broke: icon(compose(14, 14, [{ g: TIGER_BASE, x: 0, y: 0 }, { g: COIN, x: 2, y: 9 }]), undefined, SEL),
};
