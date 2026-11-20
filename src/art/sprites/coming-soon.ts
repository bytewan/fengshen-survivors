// 选角页上「即将开放」的两位（下一条线才做）：赵公明、云霄的剪影。只有轮廓（一团墨色、外沿一圈黛色的光边），
// 尺寸和别的人物一样（画布 32×34，脚底在最下一行）；做好之后换成他们自己的精灵。
import { compose, grid, outline, type Grid } from '../pixel.ts';

/** 剪影：墨色填满，最外一圈描玄，左上沿提一道黛色（像背后有光）。 */
function silhouette(rows: string[]): Grid {
  const g = grid(rows);
  const lit = grid(
    g.rows.map((r, y) =>
      [...r]
        .map((c, x) => {
          if (c === '.') return '.';
          const up = y === 0 || g.rows[y - 1][x] === '.';
          const left = x === 0 || r[x - 1] === '.';
          return up || left ? 'g' : 'd';
        })
        .join(''),
    ),
  );
  return outline(compose(32, 34, [{ g: lit, x: Math.floor((32 - g.w) / 2), y: 33 - g.h }]), 'k');
}

/** 赵公明：铁冠、长须、宽肩，一手执金鞭斜举在身前（剪影）。 */
const ZHAO = silhouette([
  '.......xx..........',
  '......xxxx.........',
  '.....xxxxxx........',
  '.....xxxxxx.....x..',
  '....xxxxxxxx...xx..',
  '....xxxxxxxx..xx...',
  '....xxxxxxxx.xx....',
  '.....xxxxxx.xx.....',
  '.....xxxxxxxx......',
  '...xxxxxxxxxx......',
  '..xxxxxxxxxxxx.....',
  '.xxxxxxxxxxxxxx....',
  '.xxxxxxxxxxxxxx....',
  'xxxxxxxxxxxxxxx....',
  'xxxxxxxxxxxxxxx....',
  'xxxx.xxxxxxx.xx....',
  'xxx..xxxxxxx..x....',
  '.x...xxxxxxx.......',
  '.....xxxxxxxx......',
  '....xxxxxxxxx......',
  '....xxxxxxxxx......',
  '....xxxx.xxxx......',
  '....xxx...xxx......',
  '....xxx...xxx......',
  '...xxxx...xxxx.....',
  '...xxxx...xxxxx....',
]);

/** 云霄：高髻插两支簪、细腰、长裙曳地，一条披帛绕过身后飘起来（剪影）。 */
const YUN = silhouette([
  '.......x..x........',
  '......xx.xx........',
  '......xxxxx........',
  '.....xxxxxx........',
  '.....xxxxxx........',
  '....xxxxxxx........',
  '....xxxxxxx........',
  '.....xxxxx.........',
  '......xxx..........',
  'xx...xxxxx.........',
  '.xx.xxxxxxx........',
  '..xxxxxxxxxx.......',
  '...xxxxxxxxx.......',
  '....xxxxxxxx.......',
  '.....xxxxxx........',
  '.....xxxxxx..xx....',
  '.....xxxxxxxxx.....',
  '....xxxxxxxx.......',
  '....xxxxxxxx.......',
  '...xxxxxxxxxx......',
  '...xxxxxxxxxx......',
  '..xxxxxxxxxxxx.....',
  '..xxxxxxxxxxxx.....',
  '.xxxxxxxxxxxxxx....',
  '.xxxxxxxxxxxxxxx...',
  'xxxxxxxxxxxxxxxx...',
]);

export const SOON_SILHOUETTES = { zhaogongming: ZHAO, yunxiao: YUN };
