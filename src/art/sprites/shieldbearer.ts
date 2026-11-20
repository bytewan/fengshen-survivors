// 玄符盾卫（盾兵）：身形宽厚的残魂重甲卫，左手擎一面玄玉符盾 —— 墨玉盾面、石青包边，正中贴一道黄符、朱砂符文，
// 顶上一点朱印（灵符 / 法纹的盾，不是青铜盾）。盾挡下攻击时符文亮起（guard 帧）。
// 朝右绘制（盾在朝向的一侧），画布 24×25，脚底锚点 (10, 24)。帧：行走 4（步子沉，盾随步起伏）、挡格 2（符文亮 / 余光）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const SHIELD_W = 24;
export const SHIELD_H = 25;
export const SHIELD_ANCHOR = { x: 10, y: 24 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', i: 'g', h: 'g', y: 'B', Y: 'b', b: 'B', e: 'R', r: 'R', c: 'n', C: 'c' };

// 头身 13 宽，放在 (2, 1)：重盔（银脊、盔后红缨）、骷髅脸、宽肩重甲、披风
const BODY = grid([
  '.....ii......',
  '...gghhgg....',
  'r.ghhiihgg...',
  'rrgggggggg...',
  '.rdddddddd...',
  '..djjjjjjd...',
  '..djkCjkCd...',
  '..ddjjwjjd...',
  '...dkjkjkd...',
  '.ihhgggggg...',
  'ihnnNNNNNNg..',
  'hnnnNnnnnNN..',
  'hnnNNnnnnNN..',
  '.nnNNnnnnNN..',
  '.gnNNNnnnNg..',
  '..yyyYyyyy...',
  '..NNnNNnNN...',
  '..NnNNnNNN...',
]);

/** 玄符盾：墨玉盾面（受光边一道黛蓝）、石青包边，正中一道窄窄的黄符、朱砂符文，符上一点朱印。glow：挡格时符文发亮。 */
function shield(glow: 0 | 1 | 2): Grid {
  const F = glow === 1 ? 'f' : 'Y'; // 符纸
  const f = glow === 1 ? 'Y' : 'y'; // 符纸背光的一边
  const S = glow === 1 ? 'o' : glow === 2 ? 'e' : 'r'; // 朱砂符文
  const E = glow === 1 ? 'C' : 'c'; // 包边
  const M = glow === 1 ? 'n' : 'N'; // 盾面
  return grid([
    `..${E}${E}${E}..`,
    `.${E}${M}${M}${M}${E}.`,
    `${E}${M}${M}${S}${M}n${E}`,
    `${E}${M}${f}${F}${F}n${E}`,
    `${E}${M}${f}${S}${F}n${E}`,
    `${E}${M}${S}${S}${S}n${E}`,
    `${E}${M}${f}${S}${F}n${E}`,
    `${E}${M}${f}${S}${F}n${E}`,
    `${E}${M}${S}${S}${S}n${E}`,
    `${E}${M}${f}${S}${F}n${E}`,
    `${E}${M}${f}${F}${F}n${E}`,
    `.${E}${M}${F}n${E}.`,
    `..${E}${M}${E}..`,
    `...${E}...`,
  ]);
}
const SHIELDS = [shield(0), shield(1), shield(2)];

const LEGS = [
  grid(['NN..NN', 'Nn..nN', 'gg..gg']),
  grid(['NN...NN', 'Nn...nN', 'gg...gg']),
  grid(['NN..NN', 'Nn..nN', 'gg..gg']),
  grid(['.NN..NN', '.Nn..nN', '.gg..gg']),
];
const MIST = [
  grid(['.c.c.Cc..', 'C...c...c', '..c....c.']),
  grid(['c.C..c.c.', '..c.C...C', 'c.....c..']),
  grid(['.Cc.c.C..', 'c....c..c', '...c...c.']),
  grid(['c..cC..c.', '.c...c..C', 'c..c.....']),
];

function frame(i: number, glow: 0 | 1 | 2): Grid {
  const bob = i % 2;
  const push = glow ? 1 : 0; // 挡格时盾往前一顶
  const layers: Layer[] = [
    { g: LEGS[i], x: 4, y: 19 + bob },
    { g: BODY, x: 2, y: 1 + bob },
    { g: grid(['jj']), x: 11, y: 12 + bob }, // 擎盾的骨手（大半被盾挡住）
    { g: SHIELDS[glow], x: 11 + push, y: 8 + (bob ? 1 : 0) },
  ];
  const base = outline(compose(SHIELD_W, SHIELD_H, layers), 'k', SELOUT);
  return compose(SHIELD_W, SHIELD_H, [
    { g: base, x: 0, y: 0 },
    { g: MIST[i], x: 4, y: 22 + bob },
  ]);
}

export const SHIELD_FRAMES = {
  walk: [0, 1, 2, 3].map((i) => frame(i, 0)),
  guard: [frame(0, 1), frame(0, 2)],
};
