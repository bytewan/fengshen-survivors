// 回响校尉（精英）：原生 28×36 手绘，不再是放大的小兵。朝右绘制，脚底锚点 (12, 35)。
// 帅的来源：背后扇开的靠旗（戏曲武将的标志；2026-11-10 收成三面细旗）、金盔红缨、紫甲金边、一柄偃月刀。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const ELITE_W = 28;
export const ELITE_H = 36;
export const ELITE_ANCHOR = { x: 12, y: 35 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', i: 'g', y: 'B', Y: 'b', b: 'B', e: 'R', r: 'R' };

/**
 * 靠旗：三面三角小旗插在背后，三根细旗杆从后颈向上、向后扇开，旗面只挂在杆的上半截（宽的一头在杆头）；两帧飘动。
 * 收着画（用户 2026-11-10：所有法宝的尺寸都不能做得过大，包括那个旗子）：原来四面、旗面最宽 3.6 像素、从后肩一直挂到杆头，
 * 四面挤成一大块红金条纹，比人的上半身还大；现在少一面，旗面最宽 2.2、只占杆的上半截，朱红一色、外缘一道金边，
 * 三面分得开，背后看得出是靠旗。杆头比盔顶高几个像素，整只精英连旗比哪吒高约两成（锚点不动）。
 */
function flags(phase: number, face = 'e', edgeC = 'y'): Grid {
  const rows = Array.from({ length: ELITE_H }, () => Array(ELITE_W).fill('.'));
  const set = (x: number, y: number, c: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < ELITE_W && y < ELITE_H && rows[y][x] === '.') rows[y][x] = c;
  };
  const base = { x: 9, y: 13 };
  const angles = [-2.28, -1.8, -1.32]; // 往上、往后扇开，三面分得开
  angles.forEach((a, k) => {
    const len = k === 1 ? 13 : 12;
    const tx = base.x + Math.cos(a) * len;
    const ty = base.y + Math.sin(a) * len;
    // 旗杆
    for (let i = 0; i <= len; i++) set(base.x + Math.cos(a) * i, base.y + Math.sin(a) * i, 'B');
    // 旗面：挂在杆的上半截，向外的三角形（杆头那一端最宽），末端随相位摆动
    const nx = Math.cos(a - Math.PI / 2);
    const ny = Math.sin(a - Math.PI / 2);
    const from = len - 6;
    for (let i = from; i <= len - 1; i++) {
      const width = ((i - from + 1) / (len - from)) * 2.2;
      for (let wv = 0; wv < width; wv++) {
        const sway = Math.sin(phase * Math.PI * 2 + i * 0.5 + k) * 0.5 * (wv / 2);
        const edge = wv >= width - 1; // 旗面外缘一道金边
        set(base.x + Math.cos(a) * i + nx * (wv + 1) + sway, base.y + Math.sin(a) * i + ny * (wv + 1), edge ? edgeC : face);
      }
    }
    set(tx, ty, 'Y'); // 杆头金顶
  });
  return grid(rows.map((r) => r.join('')));
}

// 头身 16 宽，放在 (5, 5)
const BODY = grid([
  '.......er.......',
  '......yyyy......',
  '.....yYbbyy.....',
  '....Byyyyyyb....',
  '.....wjjjjw.....',
  '.....jkejke.....',
  '.....jjwjjj.....',
  '......jkjkj.....',
  '...ybPPPPPPby...',
  '..ybbPpppppPbby.',
  '...bPPpyypPPPb..',
  '....PPpyypPPP...',
  '....PPpppppPP...',
  '....yyyyYyyyy...',
  '....PpPPPPPpP...',
  '....PPp.PPpPP...',
  '....PP...PPP....',
  '....PP...PP.....',
]);

const LEGS = [
  grid(['PP...PP', 'PP...PP']),
  grid(['PP....PP', 'P.....P.']),
];
const MIST = [grid(['.m.p.mp.', 'p...m...', '..m....p']), grid(['p.m..p.m', '..p.m...', 'm.....p.'])];

/** 偃月刀：竖持在身前，刀头在上、弯月形刀刃向前。 */
const GLAIVE = grid([
  '.Wj.',
  '..wj',
  '..wj',
  '..jw',
  '.ijw',
  'Bji.',
  'B...',
  'B...',
  'b...',
  'B...',
  'B...',
  'B...',
  'b...',
  'B...',
  'B...',
  'B...',
  'b...',
  'B...',
  'B...',
  'B...',
  'b...',
  'B...',
  'B...',
]);

function frame(i: number, face = 'e', edge = 'y'): Grid {
  const bob = i % 2;
  const layers: Layer[] = [
    { g: flags(i / 4, face, edge), x: 0, y: bob },
    { g: LEGS[i % 2], x: 9, y: 23 + bob },
    { g: BODY, x: 5, y: 5 + bob },
    { g: GLAIVE, x: 20, y: 2 + bob },
    { g: grid(['jj']), x: 19, y: 15 + bob },
  ];
  const base = outline(compose(ELITE_W, ELITE_H, layers), 'k', SELOUT);
  return compose(ELITE_W, ELITE_H, [
    { g: base, x: 0, y: 0 },
    { g: MIST[i % 2], x: 9, y: 26 + bob },
  ]);
}

export const ELITE_FRAMES = { walk: [0, 1, 2, 3].map((i) => frame(i)) };

/**
 * 靠旗换成别的颜色（精英词缀的着色，见 src/art/elites/sprites.ts 的 ACCENT）：face 旗面、edge 外缘那一道（默认朱砂旗面、藤黄金边）。
 * 只换靠旗，脸、盔缨、甲都不动。
 */
export function eliteFlagFrames(face: string, edge = 'y') {
  return { walk: [0, 1, 2, 3].map((i) => frame(i, face, edge)) };
}
