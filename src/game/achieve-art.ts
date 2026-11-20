// 成就页（标题页的「成就」，codex.ts 的 openAchievements）格子里的朱印：每一组一方，印面刻一个简单的纹样（白文：朱砂底、月白的刻线）。
// 没达成的是同一方印的墨拓（苍色底、缟色刻线）：看得出是哪一组，颜色是暗的。像素格 14×14，和法宝图标（16 格）摆在一起差不多大。
import type { Grid } from '../art/pixel.ts';
import type { AchGroup } from './achievements.ts';

/** 每一组的印文（10×10，w = 刻线）。 */
const GLYPH: Record<AchGroup, string[]> = {
  // 征战：两刃交叉
  zheng: ['w........w', '.w......w.', '..w....w..', '...w..w...', '....ww....', '....ww....', '...w..w...', '..w....w..', '.ww....ww.', 'ww......ww'],
  // 斩获：一口剑
  zhan: ['....ww....', '....ww....', '....ww....', '....ww....', '....ww....', '....ww....', '.wwwwwwww.', '....ww....', '....ww....', '...wwww...'],
  // 构筑：田字（五行各居其位）
  gou: ['wwwwwwwwww', 'w...ww...w', 'w...ww...w', 'w...ww...w', 'wwwwwwwwww', 'wwwwwwwwww', 'w...ww...w', 'w...ww...w', 'w...ww...w', 'wwwwwwwwww'],
  // 角色：人字
  jue: ['....ww....', '....ww....', '....ww....', '...w..w...', '...w..w...', '..w....w..', '..w....w..', '.w......w.', '.w......w.', 'w........w'],
  // 收集：回字
  shou: ['wwwwwwwwww', 'w........w', 'w.wwwwww.w', 'w.w....w.w', 'w.w.ww.w.w', 'w.w.ww.w.w', 'w.w....w.w', 'w.wwwwww.w', 'w........w', 'wwwwwwwwww'],
  // 联机：两方相扣
  lian: ['wwwwww....', 'w....w....', 'w..wwwwww.', 'w..w.w..w.', 'w..w.w..w.', 'wwwwww..w.', '...w....w.', '...w....w.', '...wwwwww.', '..........'],
  // 隐秘：回环的云纹
  mi: ['wwwwwwwww.', '........w.', '........w.', 'wwwwwwwww.', 'w.........', 'w.........', 'w.........', 'w........w', 'w........w', 'wwwwwwwwww'],
};

const N = 14;

function seal(group: AchGroup, lit: boolean): Grid {
  const g = GLYPH[group];
  const [edge, ground, cut, speck] = lit ? ['R', 'e', 'w', 'r'] : ['g', 'h', 'j', 'g'];
  const rows: string[] = [];
  // 毛边、印泥没吃满的几粒：按位置定（同一组每次画出来都一样）
  const rough = (x: number, y: number) => ((x * 7 + y * 13 + group.length * 5) % 11) === 0;
  for (let y = 0; y < N; y++) {
    let r = '';
    for (let x = 0; x < N; x++) {
      const border = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      const corner = (x === 0 || x === N - 1) && (y === 0 || y === N - 1);
      if (corner) r += '.';
      else if (border) r += rough(x, y) ? '.' : edge;
      else if (x >= 2 && y >= 2 && x < 12 && y < 12 && g[y - 2][x - 2] === 'w') r += cut;
      else r += rough(x + 3, y) ? speck : ground;
    }
    rows.push(r);
  }
  return { w: N, h: N, rows };
}

const cache = new Map<string, Grid[]>();
/** 这一组的朱印（lit = 达成了）。 */
export function achSeal(group: AchGroup, lit: boolean): Grid[] {
  const k = `${group}:${lit}`;
  let v = cache.get(k);
  if (!v) cache.set(k, (v = [seal(group, lit)]));
  return v;
}
