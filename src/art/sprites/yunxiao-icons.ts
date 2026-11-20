// 云霄的几个 16×16 图标（波间界面用）：专属法宝混元金斗、宠物青鸾（起手 / 冰魄 / 沧溟）。
// 和 icons.ts 同一个规矩：内容画在 14×14 以内、居中，外圈补一圈玄色描边；在 icons.ts 里登记进 WEAPON_ICONS / BRANCH_ICONS / PET_BASE_ICONS。
import { compose, grid, outline, type Grid } from '../pixel.ts';

/** 一个 16×16 图标：内容不超过 14×14、居中，外圈描玄色边；accent 是描边之后再叠上去的点缀（不描边）。 */
function icon(g: Grid, accent?: Grid, sel?: Record<string, string>): Grid {
  const x = 1 + ((14 - g.w) >> 1);
  const y = 1 + ((14 - g.h) >> 1);
  const base = outline(compose(16, 16, [{ g, x, y }]), 'k', sel);
  return accent ? compose(16, 16, [{ g: base, x: 0, y: 0 }, { g: accent, x: 0, y: 0 }]) : base;
}

const SEL = { y: 'B', Y: 'B', b: 'B', C: 'n', c: 'n' };

/** 混元金斗：口大底小的金斗（斗口里一片深靛、一点天青的旋），斗口上方飘着一缕被吸进去的天青气。 */
const DOU = grid([
  '.....C.cC.....',
  '....c...C.....',
  '.....CC.......',
  '..............',
  '.bYYYYYYYYYYb.',
  'yYNNNNNNNNNNYy',
  'yYNNNnCCNNNNYy',
  'byYYYYYYYYYYyb',
  '.byYyyyyyyyyb.',
  '.bBYBYBYBYBYb.',
  '..byYyyyyyyb..',
  '..bbyyyyyybb..',
  '...BbbbbbbB...',
]);
export const JINDOU_ICON: Grid = icon(DOU, undefined, SEL);

/** 青鸾：朝右的头和前胸——两缕冠羽、一点玄色的眼、金喙、天青的颈羽，半张开的翅膀。 */
const LUAN = grid([
  '.....CC.......',
  '......CwC.....',
  '.......CCC....',
  '......CCCCC...',
  '.....CCwkCCy..',
  '.....CCwwCCyy.',
  '....CCwwww....',
  '...ccCwwww....',
  '..cccCCwww....',
  '.ccc.cCCww....',
  'cc...ccCCw....',
  'c.....ccCC....',
  '.......ccc....',
]);
/** 冰魄：通身转白，冠羽和颈下结着两粒冰。 */
const LUAN_RIME = grid([
  '.....WC.......',
  '......WwC.....',
  '.......wwC....',
  '......wwwwC...',
  '.....wwWkwwy..',
  '.....wwWWwwyy.',
  '....wwWWWW....',
  '...CCwWWWW....',
  '..CCCwwWWW....',
  '.CCC.Cwwww....',
  'CC...CCwwW....',
  'C.....CCww....',
  '.......CCC....',
]);
const ICE = grid(['..............', '..............', '..............', '..............', '..............', '..............', '..............', '..........C...', '.........CWC..', '..........C...']);
/** 沧溟：转深成黛蓝，身后一道水纹。 */
const LUAN_DEEP = grid([
  '.....cc.......',
  '......cCc.....',
  '.......ccc....',
  '......ccccc...',
  '.....ccCkccy..',
  '.....ccCCccyy.',
  '....ccCCCC....',
  '...nncCCCC....',
  '..nnnccCCC....',
  '.nnn.nccCC....',
  'nn...nnccC....',
  'n.....nncc....',
  '.......nnn....',
]);
const WAVE = grid(['..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '.C.C..........', 'C.C.C.........']);

export const LUAN_ICONS: { base: Grid; rime: Grid; deep: Grid } = {
  base: icon(LUAN, undefined, SEL),
  rime: icon(LUAN_RIME, compose(16, 16, [{ g: ICE, x: 1, y: 1 }]), { ...SEL, w: 'c', W: 'c' }),
  deep: icon(LUAN_DEEP, compose(16, 16, [{ g: WAVE, x: 1, y: 1 }]), { ...SEL, n: 'N' }),
};
