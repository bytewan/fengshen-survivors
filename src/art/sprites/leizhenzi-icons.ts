// 雷震子的几个 16×16 图标（波间界面用）：专属法宝黄金棍、宠物雷鹏（起手 / 掣电 / 霹雳）。
// 和 icons.ts 同一个规矩：内容画在 14×14 以内、居中，外圈补一圈玄色描边；在 icons.ts 里登记进 WEAPON_ICONS / BRANCH_ICONS / PET_BASE_ICONS。
import { compose, grid, outline, type Grid } from '../pixel.ts';

/** 一个 16×16 图标：内容不超过 14×14、居中，外圈描玄色边；accent 是描边之后再叠上去的点缀（不描边）。 */
function icon(g: Grid, accent?: Grid, sel?: Record<string, string>): Grid {
  const x = 1 + ((14 - g.w) >> 1);
  const y = 1 + ((14 - g.h) >> 1);
  const base = outline(compose(16, 16, [{ g, x, y }]), 'k', sel);
  return accent ? compose(16, 16, [{ g: base, x: 0, y: 0 }, { g: accent, x: 0, y: 0 }]) : base;
}

const SEL = { y: 'B', Y: 'B', b: 'B', l: 'G', v: 'G', L: 'v' };

/** 黄金棍：斜着的一根金棍（两头赭色的箍），棍头旁边一道细细的雷光。 */
const STAFF = grid([
  '..............',
  '...........Yb.',
  '..........BB..',
  '.........Yyb..',
  '........Yyb...',
  '.......Yyb....',
  '......Yyb.....',
  '.....Yyb......',
  '....Yyb.......',
  '...Yyb........',
  '..BBb.........',
  '.bBb..........',
  '..b...........',
]);
const STAFF_BOLT = grid([
  '................',
  '..........W.....',
  '.........f......',
  '........W.......',
  '.........f......',
  '........W.......',
  '.......f........',
]);
export const HUANGJIN_ICON: Grid = icon(STAFF, STAFF_BOLT, SEL);

/** 雷鹏：朝右的头和前胸——墨青的头、一圈藤黄的眼眶、钩喙，月白的颊和胸，颈后几根带金边的羽。 */
const PENG = grid([
  '.....gggg.....',
  '...ggddddgg...',
  '..gddddddddg..',
  '.gddddYkYddyy.',
  '.gdddddYddyybB',
  'gdddwwwddd.bB.',
  'gddwwwwwdd..B.',
  'gGdwwjwwwd....',
  'GvGwjwwjwd....',
  'GlvGwwjwwd....',
  '.GlvGjwwjd....',
  '..GlGwjwd.....',
  '...GGjjd......',
]);
/** 掣电：颈后的羽转成亮金，眼后拖一道白金的电光。 */
const PENG_FLASH = grid([
  '.....gggg.....',
  '...ggddddgg...',
  '..gddddddddg..',
  '.gddddYkYddyy.',
  '.gdddddYddyybB',
  'gdddwwwddd.bB.',
  'gddwwwwwdd..B.',
  'gYdwwjwwwd....',
  'YyYwjwwjwd....',
  'YfyYwwjwwd....',
  '.YfyYjwwjd....',
  '..YfYwjwd.....',
  '...YYjjd......',
]);
const FLASH_BOLT = grid(['................', '................', '................', '................', '................', '.W..............', '..f.............', '.W..............']);
/** 霹雳：通身压暗一档、羽缘泛青绿，胸前一道电纹。 */
const PENG_CLAP = grid([
  '.....gggg.....',
  '...ggddddgg...',
  '..gddddddddg..',
  '.gddddYkYddyy.',
  '.gdddddYddyybB',
  'gdddwwwddd.bB.',
  'gddwwLwwdd..B.',
  'gGdwwwLwwd....',
  'GlGwwLwwwd....',
  'GLlGwwLwwd....',
  '.GLlGwLwwd....',
  '..GLGwwLd.....',
  '...GGjjd......',
]);
export const PENG_ICONS: Record<'base' | 'flash' | 'clap', Grid> = {
  base: icon(PENG, undefined, SEL),
  flash: icon(PENG_FLASH, FLASH_BOLT, SEL),
  clap: icon(PENG_CLAP, undefined, SEL),
};
