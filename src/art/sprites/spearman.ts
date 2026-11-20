// 回响矛卒（长矛兵）：殷商矛手的残魂。乌盔金檐、盔顶一簇往后飘的红缨，银肩甲、成排的鳞甲、红绦垂裳，
// 双手平端一杆朱漆长矛。和回响兵（斜持长矛、赭盔、魂披风）一眼分得开：平端的长矛是一道横线，红缨竖在头顶。
// 朝右绘制，画布 36×26，脚底锚点 (11, 25)。帧：行走 4、蓄力 2（收矛后拉、矛尖亮起）、刺出 2（弓步前刺 / 回收）、收枪 1。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { sketch } from './foe-kit.ts';

export const SPEARMAN_W = 36;
export const SPEARMAN_H = 26;
export const SPEARMAN_ANCHOR = { x: 11, y: 25 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', i: 'g', h: 'g', e: 'R', r: 'R', o: 'R', y: 'B', Y: 'b', b: 'B', R: 'k' };

// 头身 11 宽，放在 (BX, BY)：盔缨、乌盔金檐、骷髅脸（天青眼）、银肩甲、成排鳞甲、红绦金扣、红裳
const BODY = grid([
  '....eo.....',
  '...erRe....',
  '...ghhgd...',
  '..gghihgd..',
  '..ggggggd..',
  '.byyyyyyyy.',
  '..djjjjjj..',
  '..djkCjkC..',
  '..ddjjwjj..',
  '...dkjkjk..',
  '.hiigiiigh.',
  '.hnnnnnnch.',
  '..NNNNNNN..',
  '..nnnnnnc..',
  '..NNNNNNN..',
  '...gyyYg...',
  '...RrRrR...',
  '...RrrRR...',
]);
const BX = 5;
const BY = 1;

// 腿（三行：裤、裤、靴）：行走四帧、蓄力（后腿蹬地）、弓步
const LEGS = {
  walk: [
    grid(['.Nn.nN.', '.Nn.nN.', '.gg.gg.']),
    grid(['.Nn..nN', '.Nn..nN', '.gg..gg']),
    grid(['.Nn.nN.', '.Nn.nN.', '.gg.gg.']),
    grid(['Nn..nN.', 'Nn..nN.', 'gg..gg.']),
  ],
  brace: grid(['Nn..nN.', 'Nn...nN', 'gg...gg']),
  lunge: grid(['Nn....nN', 'n......nN', 'g......gg']),
};

const MIST = [
  grid(['.c.c.Cc.', 'C...c...', '..c....c']),
  grid(['c.C..c.c', '..c.C...', 'c.....c.']),
  grid(['.Cc.c.C.', 'c....c..', '...c...c']),
  grid(['c..cC..c', '.c...c..', 'c..c....']),
];

/**
 * 长矛：朱漆矛杆（隔几格一点亮朱），金箍，柳叶形矛头（中脊月白、两刃缟色、尖上一点白光），矛头下垂一簇红缨。
 * (x0, y0) 是矛尾，(tipX, tipY) 是矛尖；glint：蓄力满时矛尖再亮一点。
 */
function spear(x0: number, y0: number, tipX: number, tipY: number, glint = false): Grid {
  const s = sketch(SPEARMAN_W, SPEARMAN_H);
  const len = Math.hypot(tipX - x0, tipY - y0);
  const ux = (tipX - x0) / len;
  const uy = (tipY - y0) / len;
  const at = (d: number, n = 0): [number, number] => [tipX - ux * d - uy * n, tipY - uy * d + ux * n];
  const P = (d: number, n: number, c: string) => s.set(...at(d, n), c);
  // 矛杆：从矛尾到金箍
  const [cx, cy] = at(6);
  s.line(x0, y0, cx, cy, (i) => (i % 4 === 2 ? 'r' : 'R'));
  // 金箍、矛头
  P(6, 0, 'y');
  for (const d of [1, 2, 3, 4, 5]) P(d, 0, 'w');
  P(0, 0, 'W');
  P(3, 1, 'j');
  P(4, 1, 'j');
  P(3, -1, 'j');
  P(4, -1, 'w');
  // 红缨：系在金箍下，往下垂、往后飘
  P(7, 1, 'e');
  P(7, 2, 'r');
  P(8, 1, 'r');
  P(8, 2, 'e');
  P(9, 2, 'R');
  if (glint) {
    s.set(...at(-1, 0), 'f');
    s.set(...at(1, -2), 'f');
    s.set(...at(1, 2), 'f');
  }
  return s.grid();
}

type Pose = 'walk' | 'windup' | 'strike' | 'rest';

function frame(pose: Pose, i: number): Grid {
  const bob = pose === 'walk' ? i % 2 : 0;
  const lean = pose === 'windup' ? -1 : pose === 'strike' ? (i === 0 ? 2 : 1) : 0;
  const crouch = pose === 'windup' || (pose === 'strike' && i === 0) ? 1 : 0;
  const bx = BX + lean;
  const by = BY + bob + crouch;
  const legs = pose === 'walk' ? LEGS.walk[i] : pose === 'windup' ? LEGS.brace : pose === 'strike' ? LEGS.lunge : LEGS.walk[0];
  // 矛：腰间平端；蓄力时往后拉、矛尖略抬；刺出时整杆前送；收枪时矛尖垂向地面
  const gy = by + 13; // 握矛的高度（胸腹之间）
  let sp: Grid;
  let front: [number, number]; // 前手握矛处
  let back: [number, number]; // 后手
  if (pose === 'walk') {
    sp = spear(bx - 4, gy + 1, bx + 22, gy - 1);
    front = [bx + 9, gy];
    back = [bx + 2, gy + 1];
  } else if (pose === 'windup') {
    sp = spear(bx - 10, gy + 2, bx + 15, gy - 1 - i, i === 1);
    front = [bx + 7, gy];
    back = [bx, gy + 1];
  } else if (pose === 'strike') {
    sp = i === 0 ? spear(bx + 1, gy, bx + 31, gy) : spear(bx - 2, gy, bx + 26, gy);
    front = [bx + 11, gy];
    back = [bx + 5, gy];
  } else {
    sp = spear(bx - 2, gy - 3, bx + 21, gy + 5);
    front = [bx + 9, gy + 1];
    back = [bx + 2, gy - 2];
  }
  // 前臂：从肩头伸到握矛处（袖子黛蓝、骨手）
  const arm = sketch(SPEARMAN_W, SPEARMAN_H);
  arm.line(bx + 8, by + 11, front[0] - 1, front[1] - 1, 'n');
  arm.set(front[0], front[1], 'j');
  arm.set(front[0] - 1, front[1], 'j');
  const layers: Layer[] = [
    { g: legs, x: BX + 2, y: 19 + bob },
    { g: BODY, x: bx, y: by },
    { g: sp, x: 0, y: 0 },
    { g: grid(['j']), x: back[0], y: back[1] }, // 后手
    { g: arm.grid(), x: 0, y: 0 },
  ];
  const base = outline(compose(SPEARMAN_W, SPEARMAN_H, layers), 'k', SELOUT);
  return compose(SPEARMAN_W, SPEARMAN_H, [
    { g: base, x: 0, y: 0 },
    { g: MIST[pose === 'walk' ? i : 0], x: BX + 1, y: 22 + bob },
  ]);
}

export const SPEARMAN_FRAMES = {
  walk: [0, 1, 2, 3].map((i) => frame('walk', i)),
  windup: [0, 1].map((i) => frame('windup', i)),
  strike: [0, 1].map((i) => frame('strike', i)),
  rest: [frame('rest', 0)],
};
