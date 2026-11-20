// 雷震子（暂拟，待评审确认）：朝右绘制，朝左时整体镜像。画布 40×40，脚底锚点 (20, 39)（鞋底下那一行描边）。
// 尺子（docs/design.md「人物与宠物的尺子」32 像素版）：冠顶到鞋底 33 像素（第 6–38 行；小金冠占顶上 3 行），头 8×8（第 9–16 行）、
// 四分之三侧脸朝右，肩 13（护肩算上），腰 7，腰带离鞋底 13，小腿和靴露出 10 行；站直：头的中线落在两脚中点上，跑的帧上身最多前倾 1 像素。
// 造型：英气的年轻武将——墨发高马尾、束一顶小金冠，鬓角一缕赤发（藏在鬓发里的一道朱红），近眼的眼角一点青纹（细长眼往后挑出一笔）；
// 墨绿战袍、月白交领，前肩一片金色云头护肩、金带、墨绿甲裙描金边，乌裤乌靴、靴口一道金；
// 背后一对风雷双翅收拢：近的那只从肩后斜着垂到腰下（上沿描金，两排覆羽，次级、初级飞羽一根根往后下方垂、羽尖错落，比战袍亮一档），远的那只往后错一格只露一道暗边；
// 羽尖时不时窜一点白金电光（帧间轮着亮）；前手竖提一根黄金棍（比人略矮，待机斜约 7°，两头和上段各一道赭箍），不往前倒。
// 绿金为主：和哪吒的红、杨戬的银甲靛袍、赵公明的玄金、云霄的青白分开。
// 帧：待机 / 跑（各 4）、空手的待机 / 跑（棍子飞出去了）、出手三段（举棍、掷出、收手）、受击（2）、倒下（2：单膝跪地拄着棍、翅膀垂下）；
// 风雷翅用的 fly（腾空：双腿收、棍横在身前）/ dive（俯冲：双手把棍举过头）/ slam（砸下：棍砸在身前）——这三组不带翅膀，
// 展开的双翅由 game/heroes/wing-fx.ts 另画（展开比画布宽得多）；翅根的位置是 WING_ROOT。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const LEIZHENZI_W = 40;
export const LEIZHENZI_H = 40;
export const LEIZHENZI_ANCHOR = { x: 20, y: 39 };
/** 翅根（后肩胛）在画布上的位置：展开的双翅从这里长出来（wing-fx.ts 照它摆）。 */
export const WING_ROOT = { x: 16, y: 19 };

/** 同色系描边：皮肤描檀、金描赭、绿描墨绿、赤发描殷、青纹描黛蓝，其余描玄。 */
export const LZZ_SEL: Record<string, string> = { t: 'S', s: 'S', y: 'B', Y: 'B', b: 'B', l: 'G', L: 'G', v: 'G', e: 'R', r: 'R', c: 'n' };

type Seg = [number, number, string];
/** 把一串 [x, y, '字'] 摆进画布（'.' 不画）。dx / dy 整体挪。 */
function segs(list: Seg[], dx = 0, dy = 0): Grid {
  const rows = Array.from({ length: LEIZHENZI_H }, () => Array(LEIZHENZI_W).fill('.'));
  for (const [x, y, s] of list)
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const X = x + i + dx;
      const Y = y + dy;
      if (c === '.' || X < 0 || X >= LEIZHENZI_W || Y < 0 || Y >= LEIZHENZI_H) continue;
      rows[Y][X] = c;
    }
  return grid(rows.map((r) => r.join('')));
}
const layer = (g: Grid, x = 0, y = 0): Layer => ({ g, x, y });

// ---------------------------------------------------------------- 头

/** 头：小金冠（第 6–8 行）、发、额、剑眉、细长眼（眼角往后一点青）、鼻、嘴角、下巴；鬓角藏一道赤发（18 列）。 */
const HEAD: Seg[] = [
  [19, 6, 'Y'],
  [18, 7, 'yYy'],
  [18, 8, 'byb'],
  [17, 9, 'ddgdddd'],
  [17, 10, 'dgdgdddd'],
  [17, 11, 'drddtttt'], // 额（发际往右斜上）；赤发起头
  [17, 12, 'dedsggtt'], // 剑眉
  [17, 13, 'dedcdkts'], // 近眼：21 乌、22 玄，眼角往后一点青（20）
  [17, 14, 'drsttttt'], // 颊、鼻尖（24）
  [18, 15, 'rSsttSs'], // 嘴角（23）
  [20, 16, 'Ssts'], // 下巴
];
/** 受击：闭眼皱眉。 */
const HURT_FACE: Seg[] = [
  [21, 12, 'gt'],
  [20, 13, 'cSSt'],
];
/** 倒下：低头（眼睛垂下去，只剩一道）。 */
const DOWN_FACE: Seg[] = [[20, 13, 'cggt']];

/** 高马尾：从金冠下往后垂到后颈；sway 是梢头往后甩多少（跑起来甩得更开、更平）。 */
function ponytail(sway: number, flow: number): Seg[] {
  const pts: [number, number][] = [
    [16, 8],
    [15, 9],
    [15, 10],
    [14, 11],
    [14, 12],
    [13, 13],
    [13, 14],
  ];
  return pts.map(([x, y], i) => {
    const t = i / (pts.length - 1);
    const X = Math.round(x - sway * t * t - flow * t * t * 3);
    const Y = Math.round(y - flow * t * t * 1.5);
    return [X, Y, i < 2 ? 'dd' : i < 5 ? 'dg' : 'd'] as Seg;
  });
}

// ---------------------------------------------------------------- 身子

/** 上身：颈、交领、前肩金护肩、袍身、金带、甲裙。 */
const TORSO: Seg[] = [
  [20, 17, 'ss'],
  [15, 18, 'GGGvjwGyYy'],
  [15, 19, 'GGvGjwGyYYb'],
  [15, 20, 'GGGGGjGbyyB'],
  [16, 21, 'GGvGGjGGvG'],
  [17, 22, 'GvGGjGGvG'],
  [17, 23, 'GvGGGGGyb'],
  [17, 24, 'GGvGGGGyb'],
  [18, 25, 'byyYyyb'],
  [18, 26, 'GvGGvGG'],
  [18, 27, 'GvGGGvG'],
  [18, 28, 'byb.byb'],
];
/** 前臂：垂在身前、护腕金，拳在腰下（握棍的那一下由拳盖在棍上）。 */
const ARM: Seg[] = [
  [25, 21, 'Gv'],
  [25, 22, 'Gv'],
  [25, 23, 'yb'],
  [25, 24, 'yb'],
];
const FIST: Seg[] = [
  [25, 25, 'tt'],
  [25, 26, 'ts'],
];

/**
 * 一条腿：从胯（hx, 29）到膝（kx, ky）再到脚（fx, fy），两像素宽；脚往上 4 行是靴（靴口一道金），再往上是乌裤。
 * lifted：脚不着地（跑的时候往后踢起来的那只：不画鞋底的玄色）。front：前面那条腿（受光，靠前的一列提亮）。
 */
function leg(hx: number, kx: number, ky: number, fx: number, fy: number, front: boolean, lifted = false): Seg[] {
  const out: Seg[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.abs(y1 - y0), Math.abs(x1 - x0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      const boot = y >= fy - 4;
      const band = y === fy - 4;
      const c = band ? 'bb' : boot ? (front ? 'dg' : 'dd') : front ? 'gd' : 'dd';
      out.push([x, y, c]);
    }
  };
  line(hx, 29, kx, ky);
  line(kx, ky, fx, fy);
  if (!lifted) out.push([fx - 1, fy, 'ddd'], [fx - 1, fy + 1, front ? 'kkkk' : 'kkk']);
  else out.push([fx - 1, fy, 'dd']);
  return out;
}
/** 站着：两腿分开一点、直直的。 */
const STAND = [...leg(19, 19, 33, 19, 37, false), ...leg(22, 22, 33, 22, 37, true)];

// ---------------------------------------------------------------- 双翅（收拢）

/**
 * 收拢的近翅（2026-11-11 重画：原来一整块石绿贴在背后，像一面盾牌）：从肩后的腕关节（第 14 行，金）斜着垂到腰下（第 31 行），
 * 和背之间留一道缝（露出背和战袍）。上沿一道金（腕关节一点缃、往下琥珀）；第 15–19 行两排覆羽（葱黄、石绿一片片压着）；
 * 第 20–26 行次级飞羽、第 24–31 行初级飞羽：一根根斜着往后下方垂，松绿、石绿相间、墨绿的缝；最下面羽尖错落（一长一短，中间透空）。
 * 颜色比墨绿的战袍亮一档，翅和袍分得开。
 */
const WING_NEAR: Seg[] = [
  [15, 14, 'Y'], // 腕关节
  [14, 15, 'yL'],
  [13, 16, 'yLL'],
  [12, 17, 'yLlL'], // 覆羽：葱黄、石绿一片片压着
  [12, 18, 'bLlLl'],
  [11, 19, 'bLlLlL'], // 覆羽的下沿（一片片圆的羽尖）
  [11, 20, 'GvGvGv'], // 覆羽下的一道影
  [10, 21, 'GlvGlv'], // 次级飞羽
  [10, 22, 'GlvGl'],
  [10, 23, 'GvlGv'],
  [9, 24, 'GlvGlv'], // 初级飞羽
  [9, 25, 'GlvGl'],
  [9, 26, 'GvlGv'],
  [8, 27, 'GlvGlv'],
  [8, 28, 'Glv.lv'], // 羽尖分开
  [8, 29, 'Gl..L'],
  [8, 30, 'Gl'],
  [8, 31, 'L'], // 最长的一根
];
/** 远翅：近翅外沿往后一格、往上一格的一道暗边（上段琥珀、下段墨绿）。 */
const WING_FAR: Seg[] = WING_NEAR.slice(0, 15).map(([x, y], i): Seg => [x - 1, y - 1, i < 5 ? 'b' : 'G']);
/** 羽尖、外沿上会窜电光的几点（白金两档，按相位轮着亮，不画圈）。 */
const SPARKS: [number, number][] = [
  [8, 31],
  [12, 29],
  [9, 30],
  [13, 16],
];
function wingLayers(phase: number, ox = 0, oy = 0): Layer[] {
  const lit: Seg[] = [];
  SPARKS.forEach(([x, y], i) => {
    if ((phase * 4 + i * 1.37) % 4 < 0.85) lit.push([x, y, i % 2 ? 'W' : 'f']);
  });
  if (!lit.length) lit.push([8, 31, 'f']);
  return [layer(segs(WING_FAR), ox, oy), layer(segs(WING_NEAR), ox, oy), layer(segs(lit), ox, oy)];
}

// ---------------------------------------------------------------- 黄金棍

/**
 * 一根黄金棍：从 (x0, y0) 到 (x1, y1)，两像素宽（受光的一侧藤黄、点几处缃，背光的一侧琥珀），两头各两格赭箍、上段一道箍。
 * 返回画布大小、描好边的一层。
 */
export function staffGrid(x0: number, y0: number, x1: number, y1: number, w = LEIZHENZI_W, h = LEIZHENZI_H): Grid {
  const rows = Array.from({ length: h }, () => Array(w).fill('.'));
  const n = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = Math.round(x0 + (x1 - x0) * k);
    const y = Math.round(y0 + (y1 - y0) * k);
    if (y < 0 || y >= h || x < 0 || x + 1 >= w) continue;
    const band = i <= 1 || i >= n - 1 || i === Math.round(n * 0.22);
    const glint = [0.12, 0.34, 0.78].some((g) => Math.abs(k - g) < 0.5 / n);
    rows[y][x] = band ? 'B' : glint ? 'Y' : 'y';
    rows[y][x + 1] = band ? 'B' : 'b';
  }
  return outline(grid(rows.map((r) => r.join(''))), 'k', LZZ_SEL);
}

/**
 * 飞出去的黄金棍（给 game/heroes/staff-fx.ts 转着画）：横着的一根、len 长、两像素粗，不描边（转好之后再描）。
 * 两头各两格赭箍；灵品起棍身中段一道缃，仙品起两头的箍外再嵌一粒月白（棍头的金光），器灵「奔雷」棍身一道道錾出的雷纹（赭），
 * 「碎岳」棍身更粗（三像素）。
 */
export function flyingStaffGrid(len: number, tier: number, spirit: string | null): Grid {
  const h = spirit === 'suiyue' ? 3 : 2;
  const rows = Array.from({ length: h }, () => Array(len).fill('.'));
  for (let x = 0; x < len; x++) {
    const end = x <= 1 || x >= len - 2;
    const mid = tier >= 2 && Math.abs(x - len / 2) < 2;
    const groove = spirit === 'benlei' && x > 3 && x < len - 4 && x % 4 === 0;
    for (let y = 0; y < h; y++) {
      const lit = y === 0;
      rows[y][x] = end ? 'B' : groove ? 'B' : mid ? (lit ? 'f' : 'Y') : lit ? 'Y' : y === h - 1 ? 'b' : 'y';
    }
  }
  if (tier >= 3) {
    rows[0][0] = 'w';
    rows[0][len - 1] = 'w';
  }
  return grid(rows.map((r) => r.join('')));
}

// ---------------------------------------------------------------- 拼帧

export type LeizhenziPose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down' | 'fly' | 'dive' | 'slam';

interface Spec {
  bob: number; // 上身上下浮动（腿不动）
  lean?: number; // 上身前倾（跑、出手；负的是后仰）
  phase: number; // 电光、马尾的相位
  legs: Seg[];
  staff: [number, number, number, number] | null; // 棍子的两头（画布坐标，跟着上身浮动）；null = 空手
  fist?: Seg[];
  arm?: Seg[];
  back?: Seg[]; // 后手（举棍、俯冲时双手握棍才露出来）
  flow?: number; // 马尾往后飘（跑）
  face?: Seg[]; // 换脸（受击、倒下）
  wingDx?: number; // 翅膀往后错（受击时张开一点）
  wings?: boolean; // 带不带收拢的双翅（风雷翅的 fly / dive / slam 不带：展开的双翅另画）
  staffBack?: boolean; // 棍子画在身子后面（举过头顶、横在身后时）
}

function build(f: Spec): Grid {
  const lean = f.lean ?? 0;
  const up = (g: Grid): Layer => layer(g, lean, f.bob);
  const head = segs(f.face ? [...HEAD, ...f.face] : HEAD);
  const body = outline(
    compose(LEIZHENZI_W, LEIZHENZI_H, [
      ...(f.wings === false ? [] : wingLayers(f.phase, lean + (f.wingDx ?? 0), f.bob)),
      up(segs(ponytail(Math.sin(f.phase * Math.PI * 2) * 0.8, f.flow ?? 0))),
      ...(f.back ? [up(segs(f.back))] : []),
      layer(segs(f.legs)),
      up(segs(TORSO)),
      up(head),
      up(segs(f.arm ?? ARM)),
    ]),
    'k',
    LZZ_SEL,
  );
  const fist = up(outline(segs(f.fist ?? FIST), 'k', LZZ_SEL));
  if (!f.staff) return compose(LEIZHENZI_W, LEIZHENZI_H, [layer(body), fist]);
  const [x0, y0, x1, y1] = f.staff;
  const st = up(staffGrid(x0, y0, x1, y1));
  return compose(LEIZHENZI_W, LEIZHENZI_H, f.staffBack ? [st, layer(body), fist] : [st, layer(body), fist]);
}

/** 待机的棍：上头往前斜约 7°（顶在 (28, 9)，尾在 (25, 37)）。 */
const STAFF_IDLE: [number, number, number, number] = [28, 9, 25, 37];
/** 跑：棍子斜得多一点（约 11°）。 */
const STAFF_RUN: [number, number, number, number] = [29, 10, 24, 36];

/** 跑的四步（腿）：前脚着地、后腿踢起、换脚着地、前腿踢起；步子在身子前后对称。 */
const RUN: Seg[][] = [
  [...leg(19, 17, 32, 16, 37, false), ...leg(22, 24, 32, 25, 37, true)],
  [...leg(19, 18, 32, 16, 34, false, true), ...leg(22, 22, 33, 21, 37, true)],
  [...leg(19, 21, 32, 23, 37, false), ...leg(22, 20, 32, 18, 37, true)],
  [...leg(19, 20, 33, 20, 37, false), ...leg(22, 21, 32, 18, 34, true, true)],
];
/** 腾空、俯冲时双腿往后收。 */
const TUCK = [...leg(19, 17, 31, 14, 33, false, true), ...leg(22, 21, 32, 18, 35, true, true)];
/** 砸下时两腿蹲开。 */
const CROUCH = [...leg(19, 17, 32, 16, 37, false), ...leg(22, 25, 31, 25, 37, true)];
/** 倒下：后腿跪地（膝着地）、前腿屈膝立着。上身整个往下沉 5 行。 */
const KNEEL: Seg[] = [
  ...leg(19, 17, 34, 13, 37, false, true),
  [12, 37, 'ddd'],
  [12, 38, 'kkk'],
  ...leg(22, 25, 33, 25, 37, true),
];

/** 举棍（出手的第一段）：前臂举到肩上，拳在耳边，棍子朝前上斜着架在肩上。 */
const ARM_RAISE: Seg[] = [
  [24, 18, 'vv'],
  [24, 17, 'yb'],
];
const FIST_RAISE: Seg[] = [
  [24, 15, 'tt'],
  [24, 16, 'ts'],
];
/** 掷出：前臂朝前伸直，手张开。 */
const ARM_THROW: Seg[] = [
  [25, 20, 'Gvv'],
  [28, 20, 'yb'],
];
const FIST_THROW: Seg[] = [[30, 19, 'tt'], [30, 20, 't']];
/** 收手：手收回胸前。 */
const ARM_BACK: Seg[] = [
  [25, 21, 'Gv'],
  [25, 22, 'yb'],
];
const FIST_BACK: Seg[] = [[26, 23, 'tt'], [26, 24, 'ts']];
/** 横棍（腾空）：前手在腰前握棍，后手在后腰（棍横在身前，前头朝上斜）。 */
const ARM_FLY: Seg[] = [
  [25, 21, 'Gv'],
  [25, 22, 'yb'],
];
const FIST_FLY: Seg[] = [[25, 23, 'tt'], [25, 24, 'ts']];
const BACK_FLY: Seg[] = [[16, 25, 'tt']];
/** 俯冲：双手把棍举过头（拳在头顶前上方），棍横在头顶、前头朝前下。 */
const ARM_DIVE: Seg[] = [
  [24, 17, 'vv'],
  [24, 16, 'yb'],
  [25, 15, 'yb'],
];
const FIST_DIVE: Seg[] = [[25, 13, 'tt'], [25, 14, 'ts']];
/** 砸下：双手握棍砸到身前地上（拳在腰前）。 */
const ARM_SLAM: Seg[] = [
  [25, 21, 'Gvv'],
  [26, 22, 'ybb'],
];
const FIST_SLAM: Seg[] = [[28, 23, 'tt'], [28, 24, 'ts']];

export function makeLeizhenziFrames(): Record<LeizhenziPose, Grid[]> {
  const idleSpec = (i: number, staff: boolean): Spec => ({ bob: i === 1 || i === 2 ? 1 : 0, phase: i / 4, legs: STAND, staff: staff ? STAFF_IDLE : null });
  const runSpec = (i: number, staff: boolean): Spec => ({ bob: i % 2 ? 0 : 1, lean: 1, phase: i / 4, legs: RUN[i], staff: staff ? STAFF_RUN : null, flow: 1 });
  const idle = [0, 1, 2, 3].map((i) => build(idleSpec(i, true)));
  const idleBare = [0, 1, 2, 3].map((i) => build(idleSpec(i, false)));
  const move = [0, 1, 2, 3].map((i) => build(runSpec(i, true)));
  const moveBare = [0, 1, 2, 3].map((i) => build(runSpec(i, false)));
  const hurt = [0, 1].map((i) => build({ ...idleSpec(i, true), bob: 0, lean: -1, face: HURT_FACE, wingDx: -1 - i, staff: [27, 9, 25, 37] }));
  const down = [0, 1].map((i) =>
    build({ bob: 5, phase: 0.3 + i * 0.4, legs: KNEEL, face: DOWN_FACE, staff: [27, 13, 27, 38], arm: [[25, 21, 'Gv'], [25, 22, 'yb']], fist: [[26, 23, 'tt'], [26, 24, 'ts']], wingDx: 1 }),
  );
  return {
    idle,
    move,
    idleBare,
    moveBare,
    windup: [build({ bob: 0, lean: -1, phase: 0.1, legs: STAND, staff: [17, 22, 32, 12], arm: ARM_RAISE, fist: FIST_RAISE })],
    throw: [build({ bob: 0, lean: 1, phase: 0.35, legs: RUN[0], staff: null, arm: ARM_THROW, fist: FIST_THROW, flow: 1 })],
    follow: [build({ bob: 1, phase: 0.6, legs: STAND, staff: null, arm: ARM_BACK, fist: FIST_BACK })],
    hurt,
    down,
    fly: [0, 1].map((i) => build({ bob: 0, lean: 1, phase: i / 2, legs: TUCK, staff: [17, 29, 32, 17], arm: ARM_FLY, fist: FIST_FLY, back: BACK_FLY, flow: 1, wings: false })),
    dive: [build({ bob: 0, lean: 2, phase: 0.2, legs: TUCK, staff: [13, 9, 34, 15], arm: ARM_DIVE, fist: FIST_DIVE, flow: 1, wings: false, staffBack: true })],
    slam: [build({ bob: 2, lean: 1, phase: 0.5, legs: CROUCH, staff: [24, 16, 33, 37], arm: ARM_SLAM, fist: FIST_SLAM, wings: false })],
  };
}
