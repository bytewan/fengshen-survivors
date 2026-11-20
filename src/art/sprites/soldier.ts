// 回响兵（v2）：殷商步卒的执念残影。朝右绘制，画布 20×24，脚底锚点 (8, 23)。
// 用户：怪物要帅一点，之前拿的戈像锄头 → 换成斜指向前的长矛（矛头下系红缨），身后加一领破碎的魂披风。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const SOLDIER_W = 20;
export const SOLDIER_H = 24;
export const SOLDIER_ANCHOR = { x: 8, y: 23 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', i: 'g', b: 'B', y: 'B', Y: 'b', B: 'k' };

// 头身 12 宽，放在 (2, 2)
const BODY = grid([
  '...kk.......',
  '..kdgk......',
  '...kkBBBk...',
  '..kBbvbbBk..',
  '.kBBbbbvBBk.',
  '..kBjjjjBk..',
  '..kjkCjkCk..',
  '..kjjwjjjk..',
  '...kjkjkjk..',
  '..knkkkkknk.',
  '.knnNnnnNnk.',
  '.kcnYYnnNnk.',
  '.kcnYrnnNnk.',
  '.kNnYYnnNNk.',
  '..kBbBBbBk..',
  '..knNnnNnk..',
]);

// 魂披风：从后肩垂下、末端破碎，两帧飘动（只画有色像素，描边统一补）
const CAPE = [
  grid(['.NN', 'NNn', 'NNn', 'Nnn', 'NNn', 'NnN', 'N.N', '..N']),
  grid(['NN.', 'NNn', 'NNn', 'NNn', 'Nnn', 'NNN', '.N.', 'N..']),
];

const LEGS = [
  grid(['.Nn..nN.', '.NN..NN.']),
  grid(['.Nn...nN', '.NN...N.']),
  grid(['.Nn..nN.', '.NN..NN.']),
  grid(['Nn...nN.', '.N...NN.']),
];
const MIST = [
  grid(['.c.c.Cc.', 'C...c...', '..c....c']),
  grid(['c.C..c.c', '..c.C...', 'c.....c.']),
  grid(['.Cc.c.C.', 'c....c..', '...c...c']),
  grid(['c..cC..c', '.c...c..', 'c..c....']),
];

/** 长矛：从身后下方斜指向前上方，矛头为柳叶形，下系红缨。返回画布坐标的一层。 */
function spear(bob: number): Layer {
  const w = SOLDIER_W;
  const rows = Array.from({ length: SOLDIER_H }, () => Array(w).fill('.'));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < w && y < SOLDIER_H) rows[y][x] = c;
  };
  // 矛杆：(2,21) → (15,8)，每四格一点高光
  for (let i = 0; i <= 13; i++) set(2 + i, 21 - i, i % 4 === 1 ? 'b' : 'B');
  // 矛头（柳叶形）
  set(16, 7, 'i');
  set(17, 6, 'j');
  set(16, 6, 'j');
  set(17, 5, 'w');
  set(18, 4, 'w');
  set(18, 5, 'j');
  set(19, 3, 'W');
  // 红缨
  set(15, 9, 'e');
  set(14, 10, 'r');
  set(16, 9, 'r');
  return { g: grid(rows.map((r) => r.join(''))), x: 0, y: bob };
}

function frame(i: number): Grid {
  const bob = i % 2;
  const layers: Layer[] = [
    { g: CAPE[i % 2], x: 1, y: 11 + bob },
    { g: LEGS[i], x: 4, y: 18 + bob },
    { g: BODY, x: 2, y: 2 + bob },
    spear(bob),
    { g: grid(['nj']), x: 10, y: 13 + bob }, // 握矛的骨手
  ];
  const base = outline(compose(SOLDIER_W, SOLDIER_H, layers), 'k', SELOUT);
  return compose(SOLDIER_W, SOLDIER_H, [
    { g: base, x: 0, y: 0 },
    { g: MIST[i], x: 4, y: 20 },
  ]);
}

export const SOLDIER_FRAMES = { walk: [0, 1, 2, 3].map(frame) };
