// 隐藏角色解锁之前的「问号剪影」（选角格、图鉴里用）：不露轮廓（孙悟空的乱毛、棒子一看就认得出来），只是一个人那么高的墨色问号，
// 外沿一圈黛色的光边（和 coming-soon.ts 的剪影一个画法），问号的弯里裂着一道极细的金缝——和标题页天上那道裂缝对得上。
// 画布 32×34，脚底在最下一行（和别的人物、剪影一样大）。
import { compose, grid, outline, type Grid } from '../pixel.ts';

/** 问号：墨色填满，左上沿提一道黛色。 */
const MARK = [
  '...xxxxxx...',
  '..xxxxxxxx..',
  '.xxxx..xxxx.',
  'xxxx....xxxx',
  'xxx......xxx',
  'xxx......xxx',
  '.........xxx',
  '........xxxx',
  '.......xxxx.',
  '......xxxx..',
  '.....xxxx...',
  '.....xxx....',
  '.....xxx....',
  '.....xxx....',
  '............',
  '............',
  '.....xxx....',
  '....xxxxx...',
  '.....xxx....',
];

function shade(rows: string[]): Grid {
  const g = grid(rows);
  return grid(
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
}

/** 问号的弯里那道金缝（一像素宽、斜着的三四格，缃 / 藤黄）。 */
const CRACK = grid(['..Y', '.y.', 'Y..', 'y..']);

/** 隐藏角色解锁之前的剪影。 */
export const MYSTERY: Grid = (() => {
  const body = shade(MARK);
  const x = Math.floor((32 - body.w) / 2);
  const y = 33 - body.h - 4;
  const base = outline(compose(32, 34, [{ g: body, x, y }]), 'k');
  return compose(32, 34, [
    { g: base, x: 0, y: 0 },
    { g: CRACK, x: x + 8, y: y + 2 },
  ]);
})();
