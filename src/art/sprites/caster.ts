// 鬼火术士（远程怪）：靛袍骷髅，手持符杖，杖头悬一团鬼火；下半身是拖地的袍摆化成雾。
// 朝右绘制，画布 16×24，脚底锚点 (7, 23)。两帧飘浮 + 一帧举杖蓄力（杖头鬼火变大变亮）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const CASTER_W = 16;
export const CASTER_H = 24;
export const CASTER_ANCHOR = { x: 7, y: 23 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', y: 'B', Y: 'b', b: 'B' };

const BODY = grid([
  '...nnnn...',
  '..nNNNNn..',
  '..NjjjjN..',
  '..jkCjkC..',
  '..jjwjjj..',
  '...jkjk...',
  '.nnNNNNnn.',
  'nNcnyynNNn',
  'nNcnyynNNn',
  '.NNnyynNN.',
  '.NNnnnnNN.',
  '..NNnnNN..',
  '..NNnnNN..',
  '...NnnN...',
]);
const HEM = [grid(['.c.Cc.', 'C..c..', '.c...c']), grid(['c.C..c', '.c.C..', 'c...c.'])];

/** 符杖：竖在身前，杖头挂一道黄符。raised 时举高 2 像素。 */
const STAFF = grid(['Y', 'b', 'B', 'B', 'B', 'b', 'B', 'B', 'B', 'b', 'B', 'B', 'B']);
const TAG = grid(['YY', 'rY', 'Yr']);

// 杖头鬼火：平时小，蓄力时大
const FIRE_SMALL = [grid(['.C.', 'CWC', '.c.']), grid(['.c.', 'CWC', '.C.'])];
const FIRE_BIG = grid(['..C..', '.CWC.', 'CWWWC', '.CWC.', '..c..']);

function frame(i: number, casting: boolean): Grid {
  const bob = i % 2;
  const lift = casting ? -2 : 0;
  const layers: Layer[] = [
    { g: BODY, x: 2, y: 5 + bob },
    { g: STAFF, x: 12, y: 6 + bob + lift },
    { g: TAG, x: 13, y: 8 + bob + lift },
    { g: grid(['jj']), x: 10, y: 13 + bob + lift },
  ];
  const base = outline(compose(CASTER_W, CASTER_H, layers), 'k', SELOUT);
  const fire = casting ? { g: FIRE_BIG, x: 10, y: 1 + bob + lift } : { g: FIRE_SMALL[i % 2], x: 11, y: 3 + bob };
  return compose(CASTER_W, CASTER_H, [
    { g: base, x: 0, y: 0 },
    fire,
    { g: HEM[i % 2], x: 4, y: 19 + bob },
  ]);
}

export const CASTER_FRAMES = { float: [0, 1, 2, 3].map((i) => frame(i, false)), cast: [0, 1].map((i) => frame(i, true)) };

/** 飞行中的鬼火团：5×5，两帧闪烁。 */
export const ORB = [grid(['.cCc.', 'cCWCc', 'CWWWC', 'cCWCc', '.cCc.']), grid(['.CcC.', 'CCWCc', 'cWWWC', 'CCWCC', '.cCc.'])];
