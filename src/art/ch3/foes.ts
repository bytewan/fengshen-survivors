// 第三章的三种新敌人：飞剑灵、截教门徒、阵图傀儡。'.' 透明，描边用 outline（同色系描边见各自的 SEL）。
// 和前两章的敌人一个语汇（回响的残魂：苍白的脸、天青的眼光、脚下一缕魂雾），配色往第三章的玄青、冷银、暗金靠。
// 用户口径：尺寸收着（哪吒约 16×24）——飞剑一柄只有 9 像素长；门徒、傀儡都不比哪吒高。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { sketch } from '../sprites/foe-kit.ts';

// ---------------------------------------------------------------- 飞剑灵

/**
 * 画布 54×54，锚点 (27, 37)（地上的影子在这里；剑悬在上面 10 像素）。三柄小飞剑排成一列：头一柄在 (27, 27)，
 * 后两柄沿来的方向排在后面（每柄隔 11 像素，中间留出两三像素的空，一柄是一柄），左右错开一点，一柄比一柄淡。
 * 剑尖朝 FLY_DIRS 个方向各画一张（不旋转精灵，像素不走样），两帧（寒光在剑身上走）。
 */
export const FLY_W = 54;
export const FLY_H = 54;
export const FLY_ANCHOR = { x: 27, y: 37 };
export const FLY_DIRS = 16;
export const FLY_HOVER = 10;

/** 一柄飞剑：剑尖在 (x, y) 前方 4 像素，朝 a；dim：后面那两柄淡一点；glint：寒光在剑身上的位置（0..1，<0 没有）。 */
function blade(s: ReturnType<typeof sketch>, x: number, y: number, a: number, dim: number, glint: number) {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const at = (d: number, o = 0): [number, number] => [x + ux * d - uy * o, y + uy * d + ux * o];
  // 剑身：从剑尖（+4）到护手（-2），中间一道霜白、两边冷银
  const core = dim > 1 ? 'T' : 'Z';
  for (let d = 4; d >= -2; d -= 0.5) {
    const [px, py] = at(d);
    const g = glint >= 0 && Math.abs((4 - d) / 6 - glint) < 0.12;
    s.set(px, py, g ? 'W' : d > 3 ? (dim > 1 ? 'T' : 'Z') : core);
  }
  // 护手：和剑身垂直的三个像素（暗金）
  for (const o of [-1.5, -0.5, 0.5, 1.5]) {
    const [px, py] = at(-2.6, o);
    s.set(px, py, dim > 1 ? 'M' : 'U', true);
  }
  // 剑柄
  for (let d = -3.2; d >= -5; d -= 0.5) {
    const [px, py] = at(d);
    s.set(px, py, 'M', true);
  }
}

function flyFrame(dir: number, f: number): Grid {
  const a = (dir / FLY_DIRS) * Math.PI * 2;
  const s = sketch(FLY_W, FLY_H);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // 后面两柄先画（被头一柄盖住）
  for (const [k, back, side] of [
    [2, 22, 1.5],
    [1, 11, -1.5],
  ] as [number, number, number][]) {
    blade(s, 27 - ux * back - uy * side, 27 - uy * back + ux * side, a, k + 1, -1);
  }
  blade(s, 27, 27, a, 1, f === 0 ? 0.25 : 0.7);
  return outline(s.grid(), 'K', { Z: 'N', W: 'N', T: 'K', U: 'M', M: 'K' });
}

export const FLY_FRAMES: Grid[][] = Array.from({ length: FLY_DIRS }, (_, d) => [flyFrame(d, 0), flyFrame(d, 1)]);
/** 剑尖朝 a（弧度）时用第几个方向的那一组。 */
export const flyDir = (a: number) => ((Math.round((a / (Math.PI * 2)) * FLY_DIRS) % FLY_DIRS) + FLY_DIRS) % FLY_DIRS;

// ---------------------------------------------------------------- 截教门徒

/**
 * 画布 18×27，脚底锚点 (8, 26)。截教的道人：玄色的发髻插一支冷银的簪子，苍白的脸、天青的眼光；石青的道袍，
 * 前襟一道霜白的滚边，暗金的腰带；背上斜背一柄剑（剑柄从右肩露出来）；袍角散成魂雾。
 * 帧：走 4（袍角摆）、抬手 2（前手剑指往前上方一举，掷剑气的那一下）。
 */
export const DISCIPLE_W = 18;
export const DISCIPLE_H = 27;
export const DISCIPLE_ANCHOR = { x: 8, y: 26 };
/** 掷剑气时剑指的指尖（朝右时相对脚底；表现层在这里聚起剑气）。 */
export const DISCIPLE_HAND = { x: 6, y: -19 };

const DIS_SEL: Record<string, string> = { j: 'i', w: 'i', n: 'N', N: 'N', J: 'n', T: 'J', Z: 'J', U: 'M', M: 'K', C: 'c', K: 'k', c: 'n' };
// 头（朝右）：头顶一个发髻插一支冷银的簪子，头发盖住后脑（左边），脸在右边：苍白的脸、天青的眼
const DIS_HEAD = grid(['..KK...', '.KZKK..', '.KKKKK.', 'KKKjjjj', 'KKjjjCj', '.Kjjjjw', '..jjjj.']);

function discipleRobe(hem: number, bob: number): Grid {
  const s = sketch(DISCIPLE_W, DISCIPLE_H);
  const top = 10 + bob;
  const bottom = 23;
  for (let y = top; y <= bottom; y++) {
    const k = (y - top) / (bottom - top);
    const half = 3 + k * 2.2;
    const sway = y > bottom - 3 ? Math.round(Math.sin(hem * Math.PI * 2 + y) * 0.6) : 0;
    const x0 = Math.round(8 - half) + sway;
    const x1 = Math.round(8 + half) + sway;
    for (let x = x0; x <= x1; x++) {
      // 石青的道袍（受月光的左沿雾蓝、背光的右沿黛蓝），前襟一道冷银的滚边
      let c = 'c';
      if (x === x0) c = 'J';
      else if (x >= x1 - 1) c = 'n';
      else if (x === 9) c = 'Z';
      else if ((x + y) % 6 === 0 && y > top + 6) c = 'n'; // 衣褶
      if (y === top + 5) c = x === 9 ? 'Y' : 'U'; // 腰带、扣
      if (y === bottom) c = (x + Math.round(hem * 4)) % 3 === 0 ? 'n' : 'c';
      s.set(x, y, c);
    }
  }
  return s.grid();
}

/** 一只袖子：从肩 (sx, sy) 到手 (hx, hy)，越往袖口越宽一点，手苍白。 */
function discipleSleeve(s: ReturnType<typeof sketch>, sx: number, sy: number, hx: number, hy: number, point: boolean) {
  const n = Math.max(1, Math.round(Math.hypot(hx - sx, hy - sy)));
  const ux = (hx - sx) / n;
  const uy = (hy - sy) / n;
  let nx = -uy;
  let ny = ux;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = sx + (hx - sx) * t;
    const y = sy + (hy - sy) * t;
    const w = Math.round(t * 1.4);
    for (let d = 0; d <= w; d++) s.set(x + nx * d, y + ny * d, i >= n - 1 ? 'Z' : d === w && w > 0 ? 'n' : 'c', true);
  }
  // 手：剑指（食中二指并拢伸出）
  s.set(hx + ux, hy + uy, 'j');
  if (point) {
    s.set(hx + ux * 2, hy + uy * 2, 'j');
    s.set(hx + ux * 3, hy + uy * 3, 'w');
  }
}

function discipleFrame(i: number, cast: boolean): Grid {
  const bob = cast ? 0 : i % 2;
  const hem = i / 4;
  const s = sketch(DISCIPLE_W, DISCIPLE_H);
  // 背上的剑：斜背着，剑鞘从右边的腰后斜到左肩，剑柄从左肩（背后）上方露出来——画在身子之前、被身子盖住
  const back = sketch(DISCIPLE_W, DISCIPLE_H);
  back.line(12, 21 + bob, 3, 9 + bob, (k) => (k < 12 ? 'O' : 'T'));
  back.set(3, 9 + bob, 'M');
  back.set(2, 8 + bob, 'U');
  back.set(1, 7 + bob, 'U');
  back.set(3, 7 + bob, 'M');
  back.set(1, 9 + bob, 'M');
  if (cast) discipleSleeve(s, 10, 11 + bob, 14 + (i % 2), 6 + bob, true);
  else discipleSleeve(s, 10, 11 + bob, 11, 16 + bob, false);
  const layers: Layer[] = [
    { g: back.grid(), x: 0, y: 0 },
    { g: discipleRobe(hem, bob), x: 0, y: 0 },
    { g: DIS_HEAD, x: 4, y: 3 + bob },
    { g: s.grid(), x: 0, y: 0 },
  ];
  const base = outline(compose(DISCIPLE_W, DISCIPLE_H, layers), 'k', DIS_SEL);
  const mist = [grid(['.c..C.c..', 'C...c...c']), grid(['c.C...c..', '..c..C..c']), grid(['.C..c..c.', 'c..C....C']), grid(['c...c.C..', '.C...c..c'])][i % 4];
  return compose(DISCIPLE_W, DISCIPLE_H, [
    { g: base, x: 0, y: 0 },
    { g: mist, x: 4, y: 24 },
  ]);
}

export const DISCIPLE_FRAMES = {
  walk: [0, 1, 2, 3].map((i) => discipleFrame(i, false)),
  cast: [0, 1].map((i) => discipleFrame(i, true)),
};

// ---------------------------------------------------------------- 阵图傀儡

/**
 * 画布 16×24，脚底锚点 (7, 23)。灰白石雕的傀儡：没有五官的石面，两道天青的眼缝，额上贴一道黄符；
 * 胸口嵌一面暗金的小阵盘（剑气线从这里连到另一只），肩、肘、膝是一节一节的关节，走起来一顿一顿的。帧：走 4。
 */
export const PUPPET_W = 16;
export const PUPPET_H = 24;
export const PUPPET_ANCHOR = { x: 7, y: 23 };
/** 胸口阵盘的中心（相对脚底；剑气线连在这里）。 */
export const PUPPET_CORE = { x: 0, y: -13 };

// 灰白的石雕（缟、银鼠，背光的一侧苍），关节是一节节黛色的石榫：在青黑的石台上一眼看得出来
const PUP_SEL: Record<string, string> = { j: 'h', i: 'h', h: 'g', w: 'h', g: 'k', U: 'M', M: 'K', Y: 'b', y: 'B', r: 'R', C: 'c', K: 'k', Z: 'h' };
const PUP_HEAD = grid(['.jjjj.', 'jwjjji', 'jCCjCh', 'jjjjih', '.iiih.']);
// 额上垂下来的一道黄符（盖住半张石面，朱砂的符文）
const PUP_TAG = grid(['YY', 'Yr', 'rY', 'Yr', '.y']);
const PUP_TORSO = grid(['.jjjjjjj.', 'jjwjjjjih', 'jjUUUUiih', 'jiUCZCUih', 'jiUUUUUih', 'jjijjjiih', '.jiiiiih.', '..hiiih..']);
const PUP_ARM = [grid(['j.', 'ji', 'g.', 'ji', 'ih', 'hh']), grid(['.j', 'ji', '.g', 'ji', 'ih', 'hh'])];
const PUP_LEGS = [grid(['ji..ji', 'g...g.', 'ji..ji', 'hh..hh']), grid(['.ji.ji', '.g..g.', 'ji...ji', 'hh...hh']), grid(['ji..ji', 'g...g.', 'ji..ji', 'hh..hh']), grid(['ji.ji.', 'g..g..', 'ji.ji.', 'hh.hh.'])];

function puppetFrame(i: number): Grid {
  const bob = i % 2; // 一步一顿
  const layers: Layer[] = [
    { g: PUP_LEGS[i], x: 4, y: 19 },
    { g: PUP_ARM[i % 2], x: 2, y: 10 + bob },
    { g: PUP_ARM[1 - (i % 2)], x: 12, y: 10 + bob },
    { g: PUP_TORSO, x: 3, y: 8 + bob },
    { g: PUP_HEAD, x: 5, y: 3 + bob },
    { g: PUP_TAG, x: 7, y: 2 + bob },
  ];
  return outline(compose(PUPPET_W, PUPPET_H, layers), 'k', PUP_SEL);
}

export const PUPPET_FRAMES = { walk: [0, 1, 2, 3].map(puppetFrame) };

// ---------------------------------------------------------------- 截教门徒的剑气

/**
 * 一道月牙形的剑气（朝前凸）：画布 QI_S × QI_S，中心在正中；朝 QI_DIRS 个方向各画一张。
 * 中间厚、两头收尖：芯是霜白、外沿天青，背面一点冷银（不画光圈，就是一弯刃光）。
 */
export const QI_S = 13;
export const QI_DIRS = 16;
function qiFrame(dir: number): Grid {
  const a = (dir / QI_DIRS) * Math.PI * 2;
  const s = sketch(QI_S, QI_S);
  const c = (QI_S - 1) / 2;
  const R = 4.5;
  for (let k = -12; k <= 12; k++) {
    const t = k / 12; // -1..1：从一个尖到另一个尖
    const ang = a + t * 1.2;
    const thick = 1 - Math.abs(t);
    // 刃口（外弧）一线霜白，中间厚的那一段背面再衬一线天青（不往外晕）
    const x = c + Math.cos(ang) * R - Math.cos(a) * 1.5;
    const y = c + Math.sin(ang) * R - Math.sin(a) * 1.5;
    s.set(x, y, thick > 0.3 ? 'W' : 'Z');
    if (thick > 0.5) s.set(x - Math.cos(ang), y - Math.sin(ang), 'C', true);
  }
  return s.grid();
}
export const QI_FRAMES: Grid[] = Array.from({ length: QI_DIRS }, (_, d) => qiFrame(d));
export const qiDir = (a: number) => ((Math.round((a / (Math.PI * 2)) * QI_DIRS) % QI_DIRS) + QI_DIRS) % QI_DIRS;
