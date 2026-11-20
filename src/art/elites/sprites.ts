// 各章精英的精灵（东海夜叉、金光力士、截教剑侍；回响校尉在 sprites/elite.ts）和精英用到的小东西（剑侍绕身的小剑、金光符、召唤符、浪头）。
// 朝右绘制，'.' 透明，描边用 outline（同色系描边见各自的 SEL）。和前几章的敌人一个语汇：回响的残魂（天青的眼光、脚下一缕魂雾或水）。
// 尺寸收着（哪吒约 16×24）：精英连旗不超过人物的约 1.6 倍高——夜叉连钢叉 31、力士连旗 37、剑侍 29。
// 词缀着色（accent）：每一种精英身上有一处「词缀色」的饰物——校尉的靠旗、夜叉的头发、力士的旗面、剑侍的腰带和剑穗——
// 平时是朱红（e / r / R 三档），带了词缀就换成那条词缀的颜色（ACCENT 表）；画这几处只用 e / r / R，别处一律不用这三个字符。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { recolor, sketch } from '../sprites/foe-kit.ts';
import type { EliteAffix } from '../../sim/elites/types.ts';

/** 词缀色：亮、中、暗三档（调色板字符）。none = 不带词缀（朱红）。两条词缀时按第一条着色。 */
export const ACCENT: Record<EliteAffix | 'none', [string, string, string]> = {
  none: ['e', 'r', 'R'],
  swift: ['w', 'C', 'n'], // 迅捷：天青（风；中档天青、亮档月白，免得和夜叉身上的石青粘在一起）
  armor: ['Y', 'y', 'b'], // 坚甲：缃金（甲）
  split: ['m', 'p', 'P'], // 分魂：桃红（魂）
  recoil: ['w', 'j', 'i'], // 反震：月白（震为雷）
  summon: ['L', 'l', 'v'], // 召唤：葱绿（符）
};
export type AccentKey = keyof typeof ACCENT;
export const ACCENT_KEYS = Object.keys(ACCENT) as AccentKey[];

/** 把一张图里的词缀色（e / r / R）换成 key 那一档。 */
export function accentize(g: Grid, key: AccentKey): Grid {
  if (key === 'none') return g;
  const [a, b, c] = ACCENT[key];
  return recolor(g, { e: a, r: b, R: c });
}

// ================================================================ 东海夜叉

/**
 * 画布 27×35，脚底锚点 (12, 34)（顶上留三行给举起来的钢叉）。陈塘关九湾河的巡海夜叉的回响：石青、黛蓝的皮（湿的，受光处一点天青），
 * 一头往后飘的乱发（词缀色），天青的眼、两颗白獠牙，前臂后面一片鳍；墨绿的海草围腰，脚下滴着水。手里一柄钢叉（赭色叉杆、银鼠叉头）。
 * 帧：走 4；拍浪：举叉 2（双手把叉举过头，叉头聚水）+ 砸下 1（叉头往前砸在地上）；潜水（蹲下）1。
 */
export const YECHA_W = 27;
export const YECHA_H = 35;
export const YECHA_ANCHOR = { x: 12, y: 34 };
const Y0 = 3; // 整个身子往下挪三行（顶上留给举起来的叉）
/** 眼睛（朝右时相对脚底）。 */
export const YECHA_EYE = { x: 2, y: -25 };

const YE_SEL: Record<string, string> = { c: 'N', C: 'n', n: 'N', N: 'k', e: 'R', r: 'R', R: 'k', G: 'k', v: 'G', l: 'G', w: 'g', j: 'g', i: 'g', B: 'k', b: 'B', Y: 'b', y: 'B', m: 'P', p: 'P', P: 'k', L: 'v', o: 'r' };

// 头（朝右）：额头凸起的眉骨受光，深陷的眼窝里一点天青的眼，咧开的嘴两颗獠牙
const YE_HEAD = grid([
  '..nccc..',
  '.ncccccc',
  'nccCCCCc',
  'ncnnkwCc',
  'nccccccC',
  'nncnwcw.',
  '.nnnccn.',
  '..nnnn..',
]);

/** 乱发：从头顶往后（左）飘，sway 让发梢摆一下。 */
function yechaHair(sway: number): Grid {
  const s = sketch(YECHA_W, YECHA_H);
  // 发根在头顶 (11..14, 3..4)，一束束往左后方飘、往下垂
  const tufts: [number, number, number, number][] = [
    [13, 3, 7, 1],
    [12, 4, 4, 4],
    [11, 5, 3, 8],
    [11, 7, 5, 11],
    [12, 3, 9, 0],
  ];
  tufts.forEach(([x0, y0, x1, y1], k) => {
    const sw = k >= 2 ? sway : 0;
    s.line(x0, y0, x1 + sw, y1, (i, n) => (i < n * 0.4 ? 'r' : i < n * 0.8 ? 'R' : 'R'));
    s.line(x0, y0 - 1, x1 + sw + 1, y1 - 1, (i, n) => (i < n * 0.5 ? 'e' : 'r'), true);
  });
  return s.grid();
}

const YE_TORSO = grid([
  '....nnnnn..',
  '..nnccccccn',
  '.nncccCCccc',
  '.ncccccCccn',
  '.nccncccnnn',
  '..ncccnccn.',
  '..nnccccnn.',
  '...nnccnn..',
]);
// 海草围腰：墨绿、松绿，往下垂几缕
const YE_KILT = [
  grid(['..GvvvvvG..', '.GvlvGvvlG.', '.vG.vGv.vG.', '.G..G.G..G.']),
  grid(['..GvvvvvG..', '.GvlvGvvlG.', '..vG.vGv.vG', '..G..G.G..G']),
];

/** 腿：从胯到脚，四帧迈步（crouch：蹲下，两腿分开、膝盖往外）；脚是带蹼的一撇。 */
function yechaLegs(i: number, crouch = false): Grid {
  const s = sketch(YECHA_W, YECHA_H);
  const stride = crouch ? 0 : [2, 0, -2, 0][i];
  const legs: [number, number, number][] = crouch
    ? [
        [10, 7, 0],
        [14, 17, 0],
      ]
    : [
        [10, 9 + stride, i === 1 ? 1 : 0],
        [14, 15 - stride, i === 3 ? 1 : 0],
      ];
  const hip = Y0 + (crouch ? 25 : 23);
  const foot = Y0 + 30;
  for (const [hx, fx, up] of legs) {
    if (crouch) {
      // 蹲：膝盖往外顶
      const kx = hx < 12 ? hx - 3 : hx + 3;
      s.line(hx, hip, kx, hip + 2, 'n');
      s.line(kx, hip + 2, fx, foot, 'c');
      s.line(kx + (hx < 12 ? 1 : -1), hip + 2, fx + 1, foot, 'n', true);
    } else {
      s.line(hx, hip, fx, foot - up, (k) => (k < 3 ? 'n' : 'c'));
      s.line(hx + 1, hip, fx + 1, foot - up, 'n', true);
    }
    s.set(fx + 2, foot - up, 'c');
    s.set(fx + 3, foot - up, 'n');
  }
  return s.grid();
}

/** 钢叉：叉杆从 (x0, y0)（叉头那一端）到 (x1, y1)，叉头三股（中间一股长一点），按叉杆的方向画。 */
function fork(x0: number, y0: number, x1: number, y1: number, wet = false): Grid {
  const s = sketch(YECHA_W, YECHA_H);
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x0 - x1) / L; // 朝叉头的方向
  const uy = (y0 - y1) / L;
  const at = (d: number, o: number): [number, number] => [x0 - ux * d - uy * o, y0 - uy * d + ux * o];
  // 叉杆（从叉头往下 4 像素的横档开始）
  const [hx, hy] = at(4, 0);
  s.line(hx, hy, x1, y1, (k) => (k % 6 === 3 ? 'b' : 'B'));
  // 横档、三股叉尖
  for (const o of [-2, -1, 0, 1, 2]) {
    const [px, py] = at(4, o);
    s.set(px, py, 'i');
  }
  for (const o of [-2, 2]) for (let d = 1; d <= 3; d++) s.set(...at(d, o), d === 1 ? 'w' : 'j');
  for (let d = 0; d <= 3; d++) s.set(...at(d, 0), d === 0 ? 'w' : 'j');
  if (wet) {
    // 叉头聚起的水
    s.set(...at(-1, -1), 'C');
    s.set(...at(0, 3), 'C');
    s.set(...at(1, -3), 'w');
  }
  return s.grid();
}

/** 一条胳膊：肩 → 手，手上两根爪；fin 前臂后面一片鳍（天青）。 */
function arm(s: ReturnType<typeof sketch>, sx: number, sy: number, hx: number, hy: number, dark: boolean, fin: boolean) {
  s.line(sx, sy, hx, hy, dark ? 'n' : 'c');
  s.line(sx + 1, sy, hx + 1, hy, dark ? 'N' : 'n', true);
  if (fin) {
    const mx = Math.round((sx + hx) / 2);
    const my = Math.round((sy + hy) / 2);
    s.set(mx - 1, my, 'C', true);
    s.set(mx - 2, my + 1, 'c', true);
  }
  // 爪：两根细的（后手暗一点，免得像腰上的扣子）
  s.set(hx, hy + 1, dark ? 'i' : 'j');
  s.set(hx + 1, hy + 1, dark ? 'j' : 'w');
}

type YechaPose = 'walk' | 'raise' | 'slam' | 'crouch';

function yechaFrame(pose: YechaPose, i: number): Grid {
  const bob = pose === 'walk' ? i % 2 : 0;
  const low = pose === 'crouch' ? 2 : pose === 'slam' ? 1 : 0; // 蹲下 / 砸下时身子往下压
  const y = Y0 + bob + low;
  const back = sketch(YECHA_W, YECHA_H);
  const front = sketch(YECHA_W, YECHA_H);
  const lean = pose === 'slam' ? 1 : 0; // 砸下时身子往前探
  const layers: Layer[] = [];
  // 后手（垂着；举叉时也举起来握叉）
  if (pose === 'raise') arm(back, 8, 12 + y, 13, 4 + y, true, false);
  else if (pose === 'slam') arm(back, 9, 12 + y, 14, 15 + y, true, false);
  else arm(back, 8, 12 + y, 6, 18 + y, true, false);
  layers.push({ g: back.grid(), x: 0, y: 0 });
  layers.push({ g: yechaLegs(pose === 'walk' ? i : 1, pose === 'crouch'), x: 0, y: 0 });
  layers.push({ g: yechaHair(pose === 'walk' ? (i % 2 ? -1 : 0) : pose === 'slam' ? 2 : 1), x: lean, y });
  layers.push({ g: YE_KILT[pose === 'walk' ? i % 2 : 0], x: 6, y: 19 + y });
  layers.push({ g: YE_TORSO, x: 6 + lean, y: 11 + y });
  layers.push({ g: YE_HEAD, x: 9 + lean, y: 3 + y });
  if (pose === 'raise') {
    // 双手把叉横举过头（叉头朝前上方），第二帧叉头聚水
    layers.push({ g: fork(23, Y0 - 3 + i, 5, 6 + Y0 + i, i === 1), x: 0, y: 0 });
    arm(front, 15, 12 + y, 18, 3 + y, false, true);
  } else if (pose === 'slam') {
    // 叉头往前砸在地上
    layers.push({ g: fork(26, Y0 + 30, 13, 10 + Y0), x: 0, y: 0 });
    arm(front, 16, 12 + y, 20, 17 + y, false, true);
  } else {
    layers.push({ g: fork(19, 1 + y - low, 19, 28 + Y0 + Math.min(1, bob)), x: 0, y: 0 });
    arm(front, 15, 12 + y, 18, 17 + y, false, true);
  }
  layers.push({ g: front.grid(), x: 0, y: 0 });
  const base = outline(compose(YECHA_W, YECHA_H, layers), 'k', YE_SEL);
  // 脚下滴的水
  const drip = [grid(['.C...c..', 'c..C...C']), grid(['..c..C..', '.C...c.c']), grid(['C...c...', '..C...cC']), grid(['.c.C....', 'C....c.C'])][i % 4];
  return compose(YECHA_W, YECHA_H, [
    { g: base, x: 0, y: 0 },
    { g: drip, x: 8, y: Y0 + 30 },
  ]);
}

const yechaSet = () => ({
  walk: [0, 1, 2, 3].map((i) => yechaFrame('walk', i)),
  raise: [0, 1].map((i) => yechaFrame('raise', i)),
  slam: [yechaFrame('slam', 0)],
  crouch: [yechaFrame('crouch', 0)],
});
export type YechaFrames = ReturnType<typeof yechaSet>;
export const YECHA_FRAMES: YechaFrames = yechaSet();

// ================================================================ 金光力士

/**
 * 画布 28×40，脚底锚点 (12, 39)（顶上留两行给举起来的旗）。十绝阵里金光阵的黄巾力士的回响：正面站着，宽肩，
 * 头裹黄巾（藤黄、缃，脑后打结垂一截），苍白的骷髅脸、天青的眼；藤黄、琥珀的金甲（护肩、胸甲、甲裙），赤着两条苍白的胳膊、
 * 上臂一道金箍；玄色的裤、赭色的靴。右手（前手）擎一面金光阵旗：赭色旗杆、杆头缃金的宝顶，旗面往后飘（词缀色），
 * 缃金的滚边、中间一枚缃金的方胜。帧：走 4（旗面随步子飘）；举旗 2（旗杆往上一擎、旗面展开，第二帧方胜亮起）。
 */
export const LISHI_W = 28;
export const LISHI_H = 40;
export const LISHI_ANCHOR = { x: 12, y: 39 };
/** 眼睛（相对脚底；两只）、旗面中心（举旗时金光从这里出来）。 */
export const LISHI_EYES = [
  { x: -2, y: -22 },
  { x: 1, y: -22 },
];
export const LISHI_FLAG = { x: 5, y: -30 };
const L0 = 2;

const LI_SEL: Record<string, string> = { y: 'B', Y: 'b', b: 'B', B: 'k', j: 'h', w: 'h', i: 'h', h: 'g', g: 'k', d: 'k', e: 'R', r: 'R', R: 'k', C: 'c', c: 'N', m: 'P', p: 'P', P: 'k', L: 'v', l: 'v', v: 'G', n: 'N', N: 'k' };

// 头（正面，9×9）：黄巾裹头、脑后的结（左边）垂一截，骷髅脸、天青的两只眼
const LI_HEAD = grid([
  '..bYYYb..',
  '.byyYyyb.',
  'byyyyyyyb',
  '.bwjjjwb.',
  '.jkCjkCj.',
  '.jjjwjjj.',
  '..jkjkj..',
  '...jjj...',
]);
// 身子（16×14）：金甲护肩、胸甲（当中一道琥珀的线），甲裙；中间一条玄色的腰带
const LI_BODY = grid([
  '..ybb.gdg..bby..',
  '.yYyybgddgbyyYy.',
  'byyyybyyyybyyyyb',
  'by.byyYyyYyyb.yb',
  '...byyyyyyyyb...',
  '...bbyybbyybb...',
  '....byyyyyyb....',
  '....gdddddddg...',
  '....bybybybyb...',
  '...bybybybybyb..',
  '...gggg..gggg...',
  '...gggg..gggg...',
]);

/** 胳膊：肩 → 手（苍白的胳膊，上臂一道金箍，拳头月白）。 */
function liArm(s: ReturnType<typeof sketch>, sx: number, sy: number, hx: number, hy: number) {
  s.line(sx, sy, hx, hy, 'j');
  s.line(sx + 1, sy, hx + 1, hy, 'i', true);
  const bx = Math.round(sx + (hx - sx) * 0.35);
  const by = Math.round(sy + (hy - sy) * 0.35);
  s.set(bx, by, 'y');
  s.set(bx + 1, by, 'b');
  s.set(hx, hy + 1, 'w');
  s.set(hx + 1, hy + 1, 'j');
}

/** 腿：玄色的裤、赭色的靴，四帧迈步。 */
function liLegs(i: number): Grid {
  const s = sketch(LISHI_W, LISHI_H);
  const st = [1, 0, -1, 0][i];
  const top = L0 + 31;
  const foot = L0 + 37;
  for (const [hx, dx] of [
    [9, st],
    [14, -st],
  ] as [number, number][]) {
    s.line(hx, top, hx + dx, foot - 1, 'g');
    s.line(hx + 1, top, hx + 1 + dx, foot - 1, 'd', true);
    s.set(hx + dx - 1, foot, 'B');
    s.set(hx + dx, foot, 'B');
    s.set(hx + dx + 1, foot, 'b');
    s.set(hx + dx + 2, foot, 'B');
  }
  return s.grid();
}

/** 金光阵旗：旗杆 x、杆头在 top（往下到 bottom），旗面挂在杆头下面往后（左）飘；phase 0..1 让旗面一波一波地飘，glow 方胜亮起。 */
function liBanner(x: number, top: number, bottom: number, phase: number, glow: boolean, open = 0): Grid {
  const s = sketch(LISHI_W, LISHI_H);
  s.line(x, top + 2, x, bottom, (k) => (k % 7 === 4 ? 'b' : 'B'));
  // 宝顶
  s.set(x, top, 'Y');
  s.set(x, top + 1, 'y');
  s.set(x - 1, top + 1, 'b');
  s.set(x + 1, top + 1, 'b');
  // 旗面：宽 9、高 7（展开时高 8），从杆往左飘；上下两道缃金的滚边，最外一列也是滚边，中间一枚方胜
  const W = 9;
  const H = 7 + open;
  for (let c = 0; c < W; c++) {
    const wave = Math.round(Math.sin(phase * Math.PI * 2 - c * 0.7) * (c / W) * 1.6);
    for (let r = 0; r < H; r++) {
      const yy = top + 3 + r + wave;
      const xx = x - 1 - c;
      const edge = r === 0 || r === H - 1 || c === W - 1;
      let col = edge ? (r === 0 ? 'Y' : 'y') : (c + r) % 5 === 0 ? 'R' : r <= 1 ? 'e' : 'r';
      // 方胜：一枚空心的菱（缃金；举旗时亮成灵光）
      const mc = 4;
      const mr = Math.floor(H / 2);
      if (!edge && Math.abs(c - mc) + Math.abs(r - mr) === 2) col = glow ? 'f' : 'Y';
      // 旗尾两个燕尾的缺口
      if (c === W - 1 && (r === Math.floor(H / 2) || r === Math.floor(H / 2) - 1)) continue;
      s.set(xx, yy, col);
    }
  }
  return s.grid();
}

type LishiPose = 'walk' | 'cast';

function lishiFrame(pose: LishiPose, i: number): Grid {
  const bob = pose === 'walk' ? i % 2 : 0;
  const y = L0 + bob;
  const arms = sketch(LISHI_W, LISHI_H);
  const lift = pose === 'cast' ? 1 : 0;
  const layers: Layer[] = [];
  layers.push({ g: liLegs(pose === 'walk' ? i : 1), x: 0, y: 0 });
  layers.push({ g: LI_BODY, x: 4, y: 19 + y });
  layers.push({ g: LI_HEAD, x: 7, y: 11 + y });
  // 后手（左）：走路时垂着，举旗时握拳横在胸前
  if (pose === 'cast') liArm(arms, 6, 21 + y, 9, 25 + y);
  else liArm(arms, 5, 21 + y, 4, 28 + y + (i % 2));
  // 旗：前手（右）擎着；举旗时往上一擎
  // 连描边离脚底 37 像素（举旗时 38）：精英连旗不超过人物的约 1.6 倍高
  layers.push({ g: liBanner(21, y - lift + 1, 36 + L0 - lift, pose === 'walk' ? i / 4 : 0.15 + i * 0.3, pose === 'cast' && i === 1, pose === 'cast' ? 1 : 0), x: 0, y: 0 });
  liArm(arms, 18, 21 + y, 20, 26 + y - lift * 2);
  layers.push({ g: arms.grid(), x: 0, y: 0 });
  const base = outline(compose(LISHI_W, LISHI_H, layers), 'k', LI_SEL);
  const mist = [grid(['.y...b.', 'b..y...']), grid(['..b..y.', '.y...b.']), grid(['y...b..', '..y...b']), grid(['.b.y...', 'y....b.'])][i % 4];
  return compose(LISHI_W, LISHI_H, [
    { g: base, x: 0, y: 0 },
    { g: mist, x: 8, y: L0 + 37 },
  ]);
}

const lishiSet = () => ({
  walk: [0, 1, 2, 3].map((i) => lishiFrame('walk', i)),
  cast: [0, 1].map((i) => lishiFrame('cast', i)),
});
export type LishiFrames = ReturnType<typeof lishiSet>;
export const LISHI_FRAMES: LishiFrames = lishiSet();

// ================================================================ 截教剑侍

/**
 * 画布 22×30，脚底锚点 (10, 29)。诛仙阵里侍剑的截教弟子：高高的玄色发髻、霜白的小冠一支冷银的簪，苍白的脸、天青的眼；
 * 玄青的长袍一直垂到地（受月光的一侧浅青石，前襟一道冷银的滚边、霜白的里衣领），腰间一条词缀色的丝绦，绦尾往后飘；
 * 前手捏着剑诀（食中二指并拢）横在胸前，出剑时往前一指。三柄绕身的小剑不画在身上（表现层按模拟的角度画，BLADE_FRAMES）。
 * 帧：走 4（袍角、绦尾摆）；出剑 2（剑诀往前指）。
 */
export const JIANSHI_W = 22;
export const JIANSHI_H = 30;
export const JIANSHI_ANCHOR = { x: 10, y: 29 };
export const JIANSHI_EYE = { x: 2, y: -21 };

const JS_SEL: Record<string, string> = { O: 'k', V: 'K', X: 'O', K: 'k', T: 'O', Z: 'X', J: 'O', j: 'h', w: 'h', i: 'h', e: 'R', r: 'R', R: 'k', C: 'c', c: 'N', y: 'B', Y: 'b', m: 'P', p: 'P', P: 'k', L: 'v', l: 'v', v: 'G', n: 'N', N: 'k', b: 'B' };

// 头（朝右，8×9）：发髻高高挽起，霜白的小冠、冷银的簪（往后斜出），脸在右边
const JS_HEAD = grid([
  '...KK...',
  '..KZZK..',
  '.TKKKK..',
  '..KKKKK.',
  '.KKKjjjj',
  '.KKjjjCj',
  '..Kjjjjw',
  '...jjjj.',
  '....jj..',
]);

/** 长袍：上窄下宽一直到地，hem 让袍角摆一下。 */
function jsRobe(hem: number, bob: number): Grid {
  const s = sketch(JIANSHI_W, JIANSHI_H);
  const top = 12 + bob;
  const bottom = 27;
  for (let y = top; y <= bottom; y++) {
    const k = (y - top) / (bottom - top);
    const half = 3 + k * 3.2;
    const sway = y > bottom - 4 ? Math.round(Math.sin(hem * Math.PI * 2 + y * 0.8) * 0.7) : 0;
    const x0 = Math.round(10 - half) + sway;
    const x1 = Math.round(10 + half) + sway;
    for (let x = x0; x <= x1; x++) {
      // 冷银的长袍：受月光的左沿霜白、背光的右沿雾蓝，前襟一道青黑的滚边，衣褶雾蓝
      let c = 'T';
      if (x <= x0 + 1) c = x === x0 ? 'Z' : 'T';
      else if (x >= x1 - 1) c = x === x1 ? 'X' : 'J';
      else if (x === 11) c = 'O';
      else if ((x === 8 || x === 13) && y > top + 7) c = 'J'; // 两道垂下来的衣褶
      if (y === bottom) c = (x + Math.round(hem * 4)) % 3 === 0 ? 'J' : c;
      s.set(x, y, c);
    }
  }
  // 里衣的领口（青黑的交领）
  s.set(10, top, 'O');
  s.set(11, top, 'K');
  s.set(11, top + 1, 'O');
  return s.grid();
}

/** 丝绦：腰间一道，绦尾往后（左）飘；sway 让绦尾摆一下。 */
function jsSash(bob: number, sway: number): Grid {
  const s = sketch(JIANSHI_W, JIANSHI_H);
  const y = 17 + bob;
  for (let x = 6; x <= 14; x++) {
    s.set(x, y, x % 3 === 0 ? 'e' : 'r');
    s.set(x, y + 1, 'R');
  }
  s.set(7, y, 'R');
  // 绦尾：从腰后两缕往左下飘
  s.line(6, y + 1, 2 + sway, y + 7, (k, n) => (k < n / 2 ? 'r' : 'R'));
  s.line(7, y + 2, 4 + sway, y + 8, (k, n) => (k < n / 2 ? 'e' : 'r'));
  s.set(2 + sway, y + 8, 'R');
  return s.grid();
}

function jianshiFrame(pose: 'walk' | 'cast', i: number): Grid {
  const bob = pose === 'walk' ? i % 2 : 0;
  const hand = sketch(JIANSHI_W, JIANSHI_H);
  // 前手：袖子（玄青）从肩到手，手苍白，剑诀两指并拢
  if (pose === 'cast') {
    hand.line(13, 13 + bob, 17 + i, 11 + bob, 'T');
    hand.line(13, 14 + bob, 17 + i, 12 + bob, 'J', true);
    hand.set(18 + i, 11 + bob, 'j');
    hand.set(19 + i, 11 + bob, 'j');
    hand.set(20 + i, 11 + bob, 'w');
  } else {
    // 袖子垂在身侧，手捏剑诀横在胸前
    hand.line(14, 13 + bob, 15, 17 + bob, 'T');
    hand.line(15, 13 + bob, 16, 17 + bob, 'J', true);
    hand.set(14, 16 + bob, 'j');
    hand.set(13, 15 + bob, 'j');
    hand.set(13, 14 + bob, 'w');
  }
  const layers: Layer[] = [
    { g: jsSash(bob, pose === 'walk' ? [0, 1, 0, -1][i] : -1), x: 0, y: 0 },
    { g: jsRobe(i / 4, bob), x: 0, y: 0 },
    { g: jsSashFront(bob), x: 0, y: 0 },
    { g: JS_HEAD, x: 6, y: 3 + bob },
    { g: hand.grid(), x: 0, y: 0 },
  ];
  const base = outline(compose(JIANSHI_W, JIANSHI_H, layers), 'k', JS_SEL);
  const mist = [grid(['.T..C.T..', 'C...T...T']), grid(['T.C...T..', '..T..C..T']), grid(['.C..T..T.', 'T..C....C']), grid(['T...T.C..', '.C...T..T'])][i % 4];
  return compose(JIANSHI_W, JIANSHI_H, [
    { g: base, x: 0, y: 0 },
    { g: mist, x: 6, y: 27 },
  ]);
}

/** 丝绦在袍子外面的那一截（系在腰上）：袍子画在绦尾之上，腰上这一道再盖回去。 */
function jsSashFront(bob: number): Grid {
  const s = sketch(JIANSHI_W, JIANSHI_H);
  const y = 17 + bob;
  for (let x = 7; x <= 13; x++) s.set(x, y, x % 3 === 0 ? 'e' : 'r');
  s.set(12, y + 1, 'r');
  s.set(12, y + 2, 'R');
  return s.grid();
}

const jianshiSet = () => ({
  walk: [0, 1, 2, 3].map((i) => jianshiFrame('walk', i)),
  cast: [0, 1].map((i) => jianshiFrame('cast', i)),
});
export type JianshiFrames = ReturnType<typeof jianshiSet>;
export const JIANSHI_FRAMES: JianshiFrames = jianshiSet();

/**
 * 剑侍绕身的小剑：画布 BLADE_S × BLADE_S，中心是剑身的中点；剑尖朝 BLADE_DIRS 个方向各画一张（不转精灵，像素不走样）。
 * 7 像素长：霜白的剑身、暗金的护手、冷银的柄，柄尾一小撮剑穗（词缀色）。
 */
export const BLADE_S = 13;
export const BLADE_DIRS = 16;
function bladeFrame(dir: number): Grid {
  const a = (dir / BLADE_DIRS) * Math.PI * 2;
  const s = sketch(BLADE_S, BLADE_S);
  const c = (BLADE_S - 1) / 2;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const at = (d: number, o = 0): [number, number] => [c + ux * d - uy * o, c + uy * d + ux * o];
  for (let d = 3.5; d >= -0.5; d -= 0.5) s.set(...at(d), d > 3 ? 'W' : 'Z');
  for (const o of [-1, 0, 1]) s.set(...at(-1.4, o), 'U', true);
  s.set(...at(-2.3), 'T', true);
  s.set(...at(-3.2), 'T', true);
  s.set(...at(-4.2, 0.6), 'e', true);
  s.set(...at(-4.6, -0.4), 'r', true);
  return outline(s.grid(), 'K', { Z: 'K', W: 'K', T: 'K', U: 'M', e: 'R', r: 'R' });
}
export const BLADE_FRAMES: Grid[] = Array.from({ length: BLADE_DIRS }, (_, d) => bladeFrame(d));
/** 剑尖朝 a（弧度）时用第几个方向。 */
export const bladeDir = (a: number) => ((Math.round((a / (Math.PI * 2)) * BLADE_DIRS) % BLADE_DIRS) + BLADE_DIRS) % BLADE_DIRS;
