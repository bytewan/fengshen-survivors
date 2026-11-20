// 阴马骁骑（冲锋骑兵）：残魂骑将骑一匹鬼马。马身靛青、背脊和颈上一道石青的魂光，马头是一副窄长的白骨马颅（天青眼），
// 鬃毛和马尾是往后飘的天青魂火；马腿到下半截化成魂雾、不见马蹄。骑将乌盔红缨、披风往后飘，手里一杆乌杆银锋的长矛。
// 朝右绘制，画布 38×29，脚底锚点 (17, 28)。帧：行走 4（奔跑）、预警 2（刨蹄、压矛）、冲锋 2（四蹄腾空、平矛）、喘息 2（低头喘气）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { sketch } from './foe-kit.ts';

export const CAVALRY_W = 38;
export const CAVALRY_H = 29;
export const CAVALRY_ANCHOR = { x: 17, y: 28 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', i: 'g', h: 'g', e: 'R', r: 'R', o: 'R', y: 'B', Y: 'b', b: 'B', R: 'k', c: 'N', C: 'c' };

/** 填一块形状，再加光：上沿石青（背上受光）、下沿乌色（肚下背光），其余靛青，上半截夹一点黛蓝。 */
function shade(w: number, h: number, inside: (x: number, y: number) => boolean): Grid {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) {
        r += '.';
        continue;
      }
      const up = inside(x, y - 1);
      const down = inside(x, y + 1);
      const up2 = inside(x, y - 2);
      r += !up ? 'c' : !down ? 'd' : !up2 ? 'n' : 'N';
    }
    rows.push(r);
  }
  return grid(rows);
}

// 马身：椭圆的马肚 + 拱起的马颈，画在 38×29 的画布上（马背在 y≈14，腿根在 y≈19）
const inBody = (x: number, y: number) => ((x - 14) / 9.5) ** 2 + ((y - 16.5) / 3.6) ** 2 <= 1;
const inNeck = (x: number, y: number) => {
  // 从马肩 (21, 15) 拱到马头后 (26, 8)：沿这条线、半宽 2.4 的一段
  const ax = 20.5;
  const ay = 15.5;
  const bx = 26;
  const by = 8.5;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  const d = Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t));
  return d <= 2.4 - t * 0.6;
};
const HORSE = shade(CAVALRY_W, CAVALRY_H, (x, y) => inBody(x, y) || inNeck(x, y));

// 白骨马颅：窄长、朝前下方，天青的眼、鼻孔一点玄色；两只小耳朵带石青魂光
const SKULL = grid([
  '.cc.......',
  'cNNjjw....',
  'NjkCjjjw..',
  '.jjjjjjjw.',
  '..djjjjjjw',
  '...dd.jjkj',
  '.......jj.',
]);
const SKULL_X = 25;
const SKULL_Y = 5;

// 骑将（9 宽），放在 (RX, RY)：红缨、乌盔金檐、骷髅脸、银肩、靛甲；一条腿跨在马身侧面
const RIDER = grid([
  '...eo....',
  '..erRe...',
  '..ghhgd..',
  '.gghihgd.',
  '.byyyyyyb',
  '..djjjjjj',
  '..djkCjkC',
  '..ddjjwjj',
  '...dkjkjk',
  '.hiigiiih',
  '.hnnnnnnh',
  '..NNnnNN.',
  '..NnnnnN.',
  '...NnnN..',
  '...gNn...',
  '....gN...',
  '.....g...',
]);
const RX = 8;
const RY = 0;

/** 马腿：从马腹伸出，上半截两像素宽，越往下越淡，最后化成几粒魂雾。ends 是落脚处（相对腿根）。 */
function legs(ends: [number, number][]): Grid {
  const s = sketch(CAVALRY_W, CAVALRY_H);
  const roots: [number, number][] = [
    [8, 19], // 后腿（远）
    [10, 19], // 后腿（近）
    [19, 19], // 前腿（远）
    [21, 19], // 前腿（近）
  ];
  roots.forEach(([x, y], k) => {
    const [dx, dy] = ends[k];
    const near = k % 2 === 1;
    s.line(x, y, x + dx, y + dy, (i, n) => (i < n * 0.55 ? (near ? 'n' : 'N') : i < n * 0.85 ? 'c' : near ? 'C' : 'c'));
    s.line(x + 1, y, x + 1 + dx * 0.6, y + dy * 0.6, near ? 'N' : 'd', true);
    // 化开的魂雾：腿梢往后散开一粒
    s.set(x + dx - Math.sign(dx || 1), y + dy + 1, 'c', true);
  });
  return s.grid();
}

const GALLOP: [number, number][][] = [
  // 后远、后近、前远、前近：伸展 → 收拢 → 腾空 → 收拢
  [[-5, 6], [-4, 7], [5, 6], [4, 7]],
  [[-1, 7], [1, 7], [-1, 7], [1, 7]],
  [[3, 6], [4, 6], [-3, 5], [-2, 6]],
  [[1, 7], [-1, 7], [2, 7], [0, 7]],
];
const PAW: [number, number][][] = [
  [[-1, 7], [0, 7], [1, 7], [5, 3]],
  [[-1, 7], [0, 7], [1, 7], [4, 5]],
];
const STAND: [number, number][] = [[-1, 7], [0, 7], [0, 7], [1, 7]];

/** 鬃毛与马尾：往后飘的魂火（月白的芯、天青、石青的梢），帧间摆动。stream 越大飘得越长（冲锋时）。 */
function soulfire(phase: number, stream: number): Grid {
  const s = sketch(CAVALRY_W, CAVALRY_H);
  // 鬃毛：沿马颈上沿，从耳后到马肩，一缕一缕往后上方飘
  for (let k = 0; k < 6; k++) {
    const x = 26 - k;
    const y = 7 + k;
    const len = 2 + ((k + phase) % 2) + stream + (k < 2 ? 1 : 0);
    for (let j = 1; j <= len; j++) {
      const wav = (k + phase + j) % 3 === 0 ? 1 : 0;
      s.set(x - j, y - Math.round(j * 0.45) - 1 + wav, j === len ? 'c' : j <= 1 ? 'w' : 'C', true);
    }
  }
  // 马尾：从马尻往后飘成三缕
  for (let k = 0; k < 3; k++) {
    const y0 = 14 + k;
    const len = 4 + ((k + phase) % 2) + stream;
    for (let j = 1; j <= len; j++) s.set(5 - j, y0 + Math.round(j * 0.35) - ((k + phase + j) % 3 === 0 ? 1 : 0), j === len ? 'c' : j <= 1 ? 'w' : (k + j) % 2 ? 'C' : 'c', true);
  }
  return s.grid();
}

/** 骑将的披风：从后肩往后飘。 */
function cape(phase: number, stream: number): Grid {
  const s = sketch(CAVALRY_W, CAVALRY_H);
  const x0 = RX + 1;
  const y0 = RY + 10;
  for (let r = 0; r < 4; r++) {
    const len = 3 + r + stream + ((phase + r) % 2);
    for (let j = 0; j < len; j++) s.set(x0 - j, y0 + r + Math.round(j * 0.3), j === len - 1 ? 'n' : r === 0 ? 'n' : 'N', true);
  }
  return s.grid();
}

/** 长矛：乌杆（隔几格一点黛）、银锋、锋下一面小红幡。 */
function lance(x0: number, y0: number, tipX: number, tipY: number): Grid {
  const s = sketch(CAVALRY_W, CAVALRY_H);
  const len = Math.hypot(tipX - x0, tipY - y0);
  const ux = (tipX - x0) / len;
  const uy = (tipY - y0) / len;
  const at = (d: number, n = 0): [number, number] => [tipX - ux * d - uy * n, tipY - uy * d + ux * n];
  const [cx, cy] = at(4);
  s.line(x0, y0, cx, cy, (i) => (i % 3 === 1 ? 'g' : 'd'));
  for (const d of [1, 2, 3]) s.set(...at(d), 'w');
  s.set(...at(0), 'W');
  s.set(...at(2, 1), 'j');
  s.set(...at(4), 'i');
  // 小红幡：挂在锋下，往后飘
  s.set(...at(5, 1), 'e');
  s.set(...at(6, 1), 'r');
  s.set(...at(6, 2), 'e');
  s.set(...at(7, 2), 'r');
  return s.grid();
}

type Pose = 'walk' | 'warn' | 'charge' | 'rest';

function frame(pose: Pose, i: number): Grid {
  const ride = pose === 'walk' ? [0, 1, 0, -1][i] : pose === 'charge' ? [0, 1][i] : 0; // 奔跑时上下起伏
  const head = pose === 'rest' ? 1 + (i % 2) : pose === 'warn' ? 1 : pose === 'charge' ? 1 : 0; // 低头
  const legsG =
    pose === 'walk'
      ? legs(GALLOP[i])
      : pose === 'charge'
        ? legs(i === 0 ? [[-6, 5], [-5, 6], [6, 5], [5, 6]] : [[3, 5], [4, 5], [-2, 5], [-1, 5]])
        : pose === 'warn'
          ? legs(PAW[i])
          : legs(STAND);
  const stream = pose === 'charge' ? 3 : pose === 'walk' ? 1 : 0;
  // 长矛：行走时斜举、预警时压低前指、冲锋时平端、喘息时竖起
  const hx = RX + 8;
  const hy = RY + 11 + ride;
  const sp =
    pose === 'walk'
      ? lance(hx + 1, hy + 6, hx + 6, hy - 11)
      : pose === 'warn'
        ? lance(hx - 9, hy, hx + 15, hy + 2 - i)
        : pose === 'charge'
          ? lance(hx - 8, hy, hx + 19, hy + 1)
          : lance(hx - 2, hy + 5, hx + 3, hy - 12);
  const layers: Layer[] = [
    { g: soulfire(i, stream), x: 0, y: ride + head },
    { g: legsG, x: 0, y: ride },
    { g: HORSE, x: 0, y: ride },
    { g: SKULL, x: SKULL_X, y: SKULL_Y + ride + head },
    { g: cape(i, stream), x: 0, y: ride },
    { g: RIDER, x: RX, y: RY + ride },
    { g: sp, x: 0, y: 0 },
    { g: grid(['jj']), x: hx - 1, y: hy }, // 握矛的骨手
  ];
  return outline(compose(CAVALRY_W, CAVALRY_H, layers), 'k', SELOUT);
}

export const CAVALRY_FRAMES = {
  walk: [0, 1, 2, 3].map((i) => frame('walk', i)),
  warn: [0, 1].map((i) => frame('warn', i)),
  charge: [0, 1].map((i) => frame('charge', i)),
  rest: [0, 1].map((i) => frame('rest', i)),
};
