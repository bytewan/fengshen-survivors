// 孙悟空的几个 16×16 图标（波间界面用）：专属法宝如意金箍棒、宠物毫毛猴（起手 / 定身法 / 瞌睡虫）。
// 和 icons.ts 同一个规矩：内容画在 14×14 以内、居中，外圈补一圈玄色描边；在 icons.ts 里登记进 WEAPON_ICONS / BRANCH_ICONS / PET_BASE_ICONS。
import { compose, grid, outline, type Grid } from '../pixel.ts';
import { rotSprite } from './fx.ts';
import { MONKEY_FRAMES } from './maohou.ts';
import { staffUp } from './wukong.ts';

/** 一个 16×16 图标：内容不超过 14×14、居中，外圈描玄色边；accent 是描边之后再叠上去的点缀（不描边）。 */
function icon(g: Grid, accent?: Grid, sel?: Record<string, string>): Grid {
  const x = 1 + ((14 - g.w) >> 1);
  const y = 1 + ((14 - g.h) >> 1);
  const base = outline(compose(16, 16, [{ g, x, y }]), 'k', sel);
  return accent ? compose(16, 16, [{ g: base, x: 0, y: 0 }, { g: accent, x: 0, y: 0 }]) : base;
}

const SEL = { y: 'B', Y: 'B', b: 'B', t: 'S', s: 'S' };

// ---------------------------------------------------------------- 如意金箍棒：斜着放（上端朝右上），和三尖两刃刀、火尖枪的图标一个方向

/** 图标里的棒子：两头金箍、中间乌铁，转 45° 正好放进 14×14；棒身边上缠一缕淡淡的云气（天青）。 */
export const JINGU_ICON: Grid = icon(rotSprite(staffUp(15), Math.PI / 4, 1, 7.5).g, grid(['..............', '..............', '..............', '..............', '..........C...', '...........c..', '..............', '..............', '..............', '..C...........', '...c..........']), { y: 'B', Y: 'B', b: 'B' });

// ---------------------------------------------------------------- 毫毛猴：起手（蹲着的小金丝猴）/ 定身法（额前一道黄符）/ 瞌睡虫（眯着眼，鼻尖一只瞌睡虫）
// 2026-11-11 改：原来是一张朝前的圆猴脸（像毛绒玩偶），和场上那只精瘦的侧身小猴对不上——改成直接从猴的精灵上取（art/sprites/maohou.ts）。

/** 起手：蹲着的那一帧（弓背、长尾卷成钩、头顶一撮金毫毛）。 */
const MONKEY = MONKEY_FRAMES.sit[0];
/** 瞌睡虫：同一帧，眼睛眯成一道（玄换成檀），鼻尖上落着一只松绿的小虫。 */
const MONKEY_SLEEPY = grid(MONKEY.rows.map((r, y) => (y === 3 ? r.replace('k', 'S') : r)));
const BUG = grid(['.l.', 'lvl', '.v.']);
/** 定身法：额前贴一道小黄符（缃底、朱字一竖）。 */
const TALISMAN = grid(['YY', 'Yr', 'Yr', 'YY']);

export const MONKEY_ICONS: { base: Grid; hold: Grid; drowse: Grid } = {
  base: icon(MONKEY, undefined, SEL),
  hold: icon(compose(14, 14, [{ g: MONKEY, x: 0, y: 2 }, { g: TALISMAN, x: 9, y: 2 }]), undefined, { ...SEL, r: 'R' }),
  drowse: icon(compose(14, 14, [{ g: MONKEY_SLEEPY, x: 0, y: 2 }, { g: BUG, x: 11, y: 6 }]), undefined, { ...SEL, l: 'G', v: 'G' }),
};
