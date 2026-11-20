// 回响化身（变异角色）的几个 16×16 图标（波间界面用）：专属法宝、宠物换色后的样子。
// 和 icons.ts 同一个规矩：内容画在 14×14 以内、居中，外圈补一圈玄色描边；在 icons.ts 里登记进 WEAPON_ICONS（宠物的按角色换，见 icons.petIcon）。
import { compose, grid, outline, type Grid } from '../pixel.ts';

/** 一个 16×16 图标：内容不超过 14×14、居中，外圈描玄色边；accent 是描边之后再叠上去的点缀（不描边）。 */
function icon(g: Grid, accent?: Grid, sel?: Record<string, string>): Grid {
  const x = 1 + ((14 - g.w) >> 1);
  const y = 1 + ((14 - g.h) >> 1);
  const base = outline(compose(16, 16, [{ g, x, y }]), 'k', sel);
  return accent ? compose(16, 16, [{ g: base, x: 0, y: 0 }, { g: accent, x: 0, y: 0 }]) : base;
}

/** 换色：按表把字符换掉（没写的不动）。 */
export const remap = (g: Grid, m: Record<string, string>): Grid => grid(g.rows.map((r) => [...r].map((c) => m[c] ?? c).join('')));

// ---------------------------------------------------------------- 魔化哪吒 · 黑焰轮：一只往右滚的铜轮（暗赭、四根辐、朱砂毂），身后拖着黑焰（焰梢玄黑、焰身紫棠、根上殷红朱砂）

const HEIYAN = grid([
  '....d.........',
  '..dPR..yyyyb..',
  'dPPRe.yy...bb.',
  '.dPReyy..B..bb',
  'PPRRey...B...b',
  'dPRReyBBBeBBBB',
  'PPRReb...B...B',
  '.dPRebb..B..BB',
  'dPPRe.bB...BB.',
  '..dPR..BBBBB..',
  '....d.........',
]);
export const HEIYAN_ICON: Grid = icon(HEIYAN, undefined, { y: 'B', b: 'B', B: 'k', P: 'k', d: 'k', R: 'k', e: 'R' });

// ---------------------------------------------------------------- 回响赵公明 · 缚龙索：盘成一圈的金索（暗金、一道道绞纹），索头甩出去，梢上一点魂火的天青

const FULONG = grid([
  '....bbyyb.....',
  '..bbyYyyybb...',
  '.byy.....yyb..',
  'byb.......yyb.',
  'yb.........yb.',
  'yb..bbyb...yb.',
  'yb.by..yb..yb.',
  'byb.yb.yb.yyb.',
  '.byy.yyb.yyb..',
  '..bbyyybyyb...',
  '.....bbb.byb..',
  '..........byb.',
  '...........bC.',
  '............C.',
]);
export const FULONG_ICON: Grid = icon(FULONG, undefined, { y: 'B', Y: 'B', b: 'B' });

// ---------------------------------------------------------------- 回响云霄 · 乾坤图：半展开的一卷图（月白的绢、两头的轴是靛，图上一个黛色的「乾」卦、三道横），斜着放

const QIANKUNTU = grid([
  '..........NnN.',
  '.........NwjN.',
  '........NwjjN.',
  '.......wwjjN..',
  '......wjgjjN..',
  '.....wjjjjN...',
  '....wjgggjN...',
  '...wjjjjjN....',
  '..wjgggjN.....',
  '.wjjjjjN......',
  'NwjjjjN.......',
  'NnjjjN........',
  'NnNN..........',
]);
export const QIANKUNTU_ICON: Grid = icon(QIANKUNTU, undefined, { w: 'h', j: 'h' });
