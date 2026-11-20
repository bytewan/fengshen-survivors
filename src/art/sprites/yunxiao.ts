// 云霄（暂拟，待评审确认；2026-11-11 照「人物与宠物的尺子」放大到 32 像素重画）：朝右绘制，朝左时整体镜像。画布 44×40，脚底锚点 (22, 39)。
// 造型：三霄娘娘之首，清冷的女仙，和杨戬一个尺寸（从髻顶到脚底 33 像素、头 8 像素，肩 11、裙摆放到 15）；近眼两格的细长眼。
// 墨发，头顶一个高髻、斜插一支白玉簪（簪头一粒天青珠），刘海压着额头、两鬓垂下；月白道袍、石青交领、天青腰带，
// 两只大袖（后袖垂在身后，前手在胸前掐诀、食中二指竖起，前袖从前臂垂下来）；月白长裙曳地，裙边一道天青。
// 一条天青披帛搭过两肘、绕到身后，两头随风飘（程序生成：按波形栅格化，帧间连续飘动）。手里不拿兵器（法宝是金斗，特效里画）。
// 青白为主：和哪吒的红、杨戬的银甲靛袍、赵公明的玄金分开。
// 帧：待机 / 走（各 4，长裙曳地、走起来裙摆和披帛往后飘）、蓄势（掐诀举到面前）、出手（剑指朝前一点）、收手（各 1）、
// 受击（2：往后一仰、闭眼）、倒下（2：跪坐在地、低头，裙摆铺在地上）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const YUNXIAO_W = 44;
export const YUNXIAO_H = 40;
export const YUNXIAO_ANCHOR = { x: 22, y: 39 };

/** 同色系描边：皮肤描深肤、天青描黛蓝、金描赭，其余描玄。 */
const SELOUT: Record<string, string> = { t: 'S', s: 'S', y: 'B', Y: 'B', C: 'n', c: 'n' };

/** 身子的格子（18 宽）放在画布上的位置：(BX, BY) 是第 0 行第 0 列。 */
const BX = 13;
const BY = 7;

// ---------------------------------------------------------------- 头与上身（手画）

/** 头：0–3 高髻与斜插的簪，4–11 头（发顶到下巴 8 行）、刘海、鬓发。 */
const HEAD = [
  '.........kk..C....', // 0 髻顶、簪头的天青珠
  '........kdgkw.....', // 1
  '........kddgw.....', // 2 簪斜插进髻里
  '.......kkddkk.....', // 3
  '......kddgddddk...', // 4 头顶
  '.....kddgdddddk...', // 5
  '.....kddgddtdtdk..', // 6 刘海
  '.....kdddddttttk..', // 7
  '.....kddddtdktS...', // 8 眼：近眼两格（乌、玄），细长；远眼一格暗
  '.....kddddttttt...', // 9
  '......kdddtttSt...', // 10 嘴
  '.......kkddtts....', // 11 下巴、鬓发
];
/** 受击：闭眼皱眉（换掉第 8、9 行）。 */
const HURT_EYES = ['.....kddddtkkkt...', '.....kddddtSSSt...'];
/** 上身：12 颈，13–18 肩、交领、袍身（后袖另画），19 腰带，20 腰下。 */
const TORSO = [
  '.......kd...ss....', // 0 颈；身后的长发垂下来
  '.....kdCwccwwccC..', // 1 肩：天青的外袍（褙子）罩着月白的里衣，石青交领
  '.....kdCCwcwwcCC..', // 2
  '.....kCCCwwcwwCC..', // 3
  '.....kCCcwwwwwCC..', // 4
  '......CCcwwwwwCc..', // 5
  '......CCcwwwwwCc..', // 6
  '......CcCCCCCCcc..', // 7 腰带（外袍在两边垂下来）
  '......Ccwwwwwwwc..', // 8
];
const UPPER = [...HEAD, ...TORSO];
/** 上身到第几行为止（之后是长裙，按帧生成）。 */
const SKIRT_TOP = UPPER.length; // 21
const FEET = 31; // 裙边最下一行（身子格子里的行号；画布上是 BY + 31 = 38，脚底锚点在 39）

/** 后袖：从后肩垂下来的大袖，袖口一道天青。坐标相对身子格子。 */
const BACK_SLEEVE = { rows: ['.cC.', 'ccC.', 'ccC.', 'ccC.', 'ccC.', 'ncc.', 'ncc.', 'ncc.', '.jj.'], x: 3, y: 14 };
/** 前臂。hand：拳 / 指尖相对身子格子的位置；rows 是前臂和前袖（大袖从前臂垂下）。 */
interface Arm {
  rows: string[];
  x: number;
  y: number;
}
/** 掐诀：手在胸前，食中二指竖起，前袖从前臂垂下来。 */
const ARM_MUDRA: Arm = { rows: ['.t..', 'tt..', 'tt..', 'w...', 'CCCc', 'CCCc', 'CCcc', 'CCcc', 'Cccc', 'wwj.'], x: 12, y: 15 };
/** 蓄势：掐诀的手举到面前，袖子往下坠。 */
const ARM_RAISE: Arm = { rows: ['.t.', 'tt.', 'tt.', 'wt.', 'CC.', 'CCc', 'Ccc', 'Ccc', 'ccc', 'wj.'], x: 13, y: 10 };
/** 出手：剑指朝前一点，袖子往后甩。 */
const ARM_POINT: Arm = { rows: ['.......', 'CCCCwtt', 'Ccccc..', 'cccc...', 'ccc....', 'wj.....'], x: 12, y: 15 };
/** 收手：手收回胸前，袖子还在晃。 */
const ARM_BACK: Arm = { rows: ['..tt', 'CCwt', 'CCCc', 'CCcc', 'Cccc', 'ccc.', 'wj..'], x: 12, y: 15 };

// ---------------------------------------------------------------- 长裙（程序生成：曳地，走起来裙摆往后飘）

/**
 * 长裙：从腰下（第 SKIRT_TOP 行）到裙边（第 FEET 行）。左边线往后曳、右边线往前微张；sway 是左右摆，
 * flow 是往后飘多少（走的时候），step 是前脚把裙摆往前顶多少（走的时候一帧一帧变）。
 * 月白为底，两道缟色的褶从腰下散开；裙边一道天青，下沿错落（不是一条硬直线），走的时候前头露出一点鞋尖。
 */
function skirt(sway: number, flow: number, step: number, shoe: boolean): Grid {
  const px = new Map<string, string>();
  const top = SKIRT_TOP;
  const n = FEET - top;
  for (let r = 0; r <= n; r++) {
    const t = r / n;
    const y = top + r;
    const xl = Math.round(7 - 5.2 * Math.pow(t, 1.25) - flow * t * t - sway * t);
    const xr = Math.round(13 + 3 * t + step * t * t - flow * 0.4 * t * t + sway * 0.5 * t);
    for (let x = xl; x <= xr; x++) {
      let ch = 'w';
      const f1 = Math.round(9 - 2.5 * t - flow * 0.5 * t);
      const f2 = Math.round(12 + 1.6 * t - flow * 0.3 * t);
      if (x === f1 || x === f2) ch = 'j';
      if (x === xl && t > 0.2) ch = 'j';
      if (r === n) ch = (x + Math.round(sway)) % 3 === 0 ? 'c' : 'C';
      else if (r === n - 1 && (x === xl || x === xr)) ch = 'C';
      px.set(`${x},${y}`, ch);
    }
  }
  // 裙边下沿错落：隔几格往下多垂一像素（天青的里子）
  for (let x = -3; x < 20; x++) {
    if (!px.has(`${x},${FEET}`)) continue;
    if ((x * 7 + Math.round(flow * 3) + Math.round(sway * 2)) % 5 === 0) px.set(`${x},${FEET + 1}`, 'c');
  }
  if (shoe) {
    const xs = Math.round(13 + 3 + step - flow * 0.4) - 1;
    px.set(`${xs},${FEET + 1}`, 'n');
    px.set(`${xs + 1},${FEET + 1}`, 'n');
  }
  // 腰带在身前打的结垂下来的两根带子（天青、一像素宽，下端轻轻摆；走起来往后飘一点），把一整片月白的裙子分开
  for (let r = 0; r < 8; r++) {
    const t = r / 7;
    const y = top + r;
    for (const [x0, len] of [
      [11, 8],
      [12, 6],
    ] as const) {
      if (r >= len) continue;
      const x = Math.round(x0 - flow * 0.6 * t + sway * 0.8 * t * t);
      px.set(`${x},${y}`, r === len - 1 ? 'c' : 'C');
    }
  }
  return pixelGrid(px, 20, FEET + 2);
}

// ---------------------------------------------------------------- 长发、披帛（程序生成）

/** 身后的长发：从后脑垂到背后（第 11–19 行），走起来往后飘一点。 */
function backHair(phase: number, flow: number): Grid {
  const px = new Map<string, string>();
  const TAU = Math.PI * 2;
  for (let y = 11; y <= 18; y++) {
    const t = (y - 11) / 7;
    const x1 = 6 - Math.round(t * 0.9 + flow * t * t * 2.2 + 0.7 * Math.sin(TAU * (t * 0.8 - phase)) * t);
    for (let x = x1 - 1; x <= x1 + 1; x++) px.set(`${x},${y}`, x === x1 - 1 && t > 0.4 ? 'g' : 'd');
  }
  return pixelGrid(px, 20, FEET + 2);
}

/**
 * 披帛：一条一到两像素宽的天青细绸。两头：后一头从后肘垂下、往身后飘；前一头从前肘垂下，
 * 站着时垂在身前一侧，走起来往后甩、从裙后绕到身后。程序生成，phase 让它帧间连续飘。
 * 两条曲线都按参数 t（0 = 搭在肘上那一头，1 = 末梢）取点；末梢收成一像素、提亮成月白。
 * 返回 [身子后面那一层, 身子前面那一层]（坐标是画布坐标）。
 */
function scarf(phase: number, moving: boolean, lift = 0): [Grid, Grid] {
  const back = new Map<string, string>();
  const front = new Map<string, string>();
  const TAU = Math.PI * 2;
  const s = (t: number, f: number, o = 0) => Math.sin(TAU * (f * t - phase - o));
  const strand = (px: Map<string, string>, fx: (t: number) => number, fy: (t: number) => number, thick: number) => {
    let prev: [number, number] | null = null;
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const p: [number, number] = [Math.round(fx(t)), Math.round(fy(t))];
      const pts: [number, number][] = [];
      if (prev) {
        const steps = Math.max(Math.abs(p[0] - prev[0]), Math.abs(p[1] - prev[1]));
        for (let k = 1; k <= steps; k++) pts.push([Math.round(prev[0] + ((p[0] - prev[0]) * k) / steps), Math.round(prev[1] + ((p[1] - prev[1]) * k) / steps)]);
      } else pts.push(p);
      for (const [x, y] of pts) {
        const tip = t > 0.88;
        if (!px.has(`${x},${y}`) || px.get(`${x},${y}`) === 'c') px.set(`${x},${y}`, tip ? 'w' : i % 11 === 5 && t > 0.25 ? 'C' : 'C');
        if (t < thick && !px.has(`${x},${y + 1}`)) px.set(`${x},${y + 1}`, 'c');
      }
      prev = p;
    }
  };
  // 后肘（画布约 (13, 19)）垂下的一头：站着时先往外鼓、再垂下来，末梢往上一翘；走起来往后拉长、上下起伏
  const bx = BX + 4;
  const by = BY + 17;
  if (!moving) {
    strand(back, (t) => bx - 1 - 5.8 * Math.sin(t * 2.2) - 2.5 * t - 1.1 * s(t, 0.8) * t, (t) => by + 2 + 11 * t - 3.4 * t * t * t - lift * t + 1.1 * s(t, 1.2, 0.2) * t, 0.6);
  } else {
    strand(back, (t) => bx - 1 - 13.5 * t, (t) => by + 1 + 4.6 * t - 1.7 * t * t - lift * t + 2 * s(t, 1.3, 0.2) * Math.sin(t * Math.PI * 0.9), 0.6);
  }
  // 前肘（画布约 (25, 23)）垂下的一头：站着垂在身前一侧（和裙边隔开一像素），末梢微微翻起
  const fx0 = BX + 16;
  const fy0 = BY + 23;
  if (!moving) {
    strand(front, (t) => fx0 + 1.6 * Math.sin(t * 2) + 1 * s(t, 0.9, 0.4) * t, (t) => fy0 + 8 * t - lift * t, 0.55);
  } else {
    // 走起来：前一头往后甩，从裙后绕到身后（画在后面那一层，被身子挡住一段），末梢在身后飘
    strand(back, (t) => fx0 - 21 * t, (t) => fy0 + 1 + 5 * t - 2.5 * t * t + 1.8 * s(t, 1.1, 0.5) * Math.sin(t * Math.PI * 0.9), 0.5);
  }
  return [pixelGrid(back, YUNXIAO_W, YUNXIAO_H), pixelGrid(front, YUNXIAO_W, YUNXIAO_H)];
}

function pixelGrid(px: Map<string, string>, w: number, h: number): Grid {
  return grid(Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => px.get(`${x},${y}`) ?? '.').join('')));
}

// ---------------------------------------------------------------- 拼帧

export type YunxiaoPose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down';

interface FrameSpec {
  bob: number; // 上身上下浮动
  lean: number; // 上身前倾（负的是后仰）
  phase: number; // 披帛、长发、裙摆的相位
  moving: boolean;
  step?: number; // 走：前脚把裙摆往前顶多少
  shoe?: boolean;
  arm: Arm;
  hurt?: boolean;
  lift?: number; // 披帛往上扬（受击）
}

function buildFrame(f: FrameSpec): Grid {
  const rows = [...UPPER];
  if (f.hurt) rows.splice(8, 2, ...HURT_EYES);
  const sway = Math.sin(Math.PI * 2 * f.phase) * (f.moving ? 0.6 : 0.5);
  const flow = f.moving ? 2.2 : 0;
  const [sBack, sFront] = scarf(f.phase, f.moving, f.lift ?? 0);
  const at = (g: Grid, x: number, y: number): Layer => ({ g, x: x + f.lean, y: y + f.bob });
  const body = outline(
    compose(YUNXIAO_W, YUNXIAO_H, [
      at(backHair(f.phase, f.moving ? 1 : 0), BX, BY),
      at(grid(BACK_SLEEVE.rows), BX + BACK_SLEEVE.x, BY + BACK_SLEEVE.y),
      { g: skirt(sway, flow, f.step ?? 0, !!f.shoe), x: BX, y: BY },
      at(grid(rows), BX, BY),
    ]),
    'k',
    SELOUT,
  );
  const arm = outline(grid(f.arm.rows), 'k', SELOUT);
  return compose(YUNXIAO_W, YUNXIAO_H, [{ g: sBack, x: 0, y: 0 }, { g: body, x: 0, y: 0 }, at(arm, BX + f.arm.x - 1, BY + f.arm.y - 1), { g: sFront, x: 0, y: f.bob }]);
}

/** 倒下：跪坐在地、低头，前手撑地，裙摆铺在地上，披帛落在身边。18 宽、21 行，贴地放（最下一行在画布第 39 行）。 */
const DOWN = [
  '........kk..C.....',
  '.......kdgkw......',
  '.......kddgw......',
  '......kkddkk......',
  '.....kddgddddk....',
  '....kddgdddddk....',
  '....kddddtdtdk....',
  '....kdddddttttk...',
  '....kddddtdkt.....',
  '.....kdddttttd....',
  '.....kddtttsd.....',
  '.....kddcwwcwc....',
  '....kddwwwcwwcc...',
  '....jjwwwwwcwwc...',
  '...jjjwwwwwwwwwt..',
  '...ijjCCCCCCCCwt..',
  '..jjwwwwwwwwwwwj..',
  '.jwwwjwwwwwjwwwwj.',
  'jwwwwwjwwwwwjwwwwj',
  'CCCCCCCCCCCCCCCCCC',
  '.cc.cc.cccc.cc.cc.',
];
function buildDown(phase: number): Grid {
  const [sBack] = scarf(phase, false, -1);
  const body = outline(compose(YUNXIAO_W, YUNXIAO_H, [{ g: grid(DOWN), x: BX - 1, y: YUNXIAO_ANCHOR.y - DOWN.length + 1 }]), 'k', SELOUT);
  return compose(YUNXIAO_W, YUNXIAO_H, [{ g: sBack, x: 0, y: 3 }, { g: body, x: 0, y: 0 }]);
}

export function makeYunxiaoFrames(): Record<YunxiaoPose, Grid[]> {
  const idle = [0, 1, 2, 3].map((i) => buildFrame({ bob: i === 1 || i === 2 ? 1 : 0, lean: 0, phase: i / 4, moving: false, arm: ARM_MUDRA }));
  const move = [0, 1, 2, 3].map((i) => buildFrame({ bob: i % 2, lean: 1, phase: i / 4, moving: true, step: [1.5, 0.5, -0.5, 0.5][i], shoe: i === 0, arm: ARM_MUDRA }));
  return {
    idle,
    move,
    idleBare: idle,
    moveBare: move,
    windup: [buildFrame({ bob: 0, lean: -1, phase: 0.1, moving: false, arm: ARM_RAISE })],
    throw: [buildFrame({ bob: 0, lean: 1, phase: 0.35, moving: false, arm: ARM_POINT, lift: 1 })],
    follow: [buildFrame({ bob: 1, lean: 0, phase: 0.6, moving: false, arm: ARM_BACK })],
    hurt: [0, 1].map((i) => buildFrame({ bob: 0, lean: -1 - i, phase: 0.2 + i * 0.25, moving: false, arm: ARM_MUDRA, hurt: true, lift: 2 })),
    down: [0, 1].map((i) => buildDown(0.3 + i * 0.4)),
  };
}

export const YUNXIAO_FRAMES = makeYunxiaoFrames();

// ---------------------------------------------------------------- 混元金斗（专属法宝；画面在 game/heroes/dou-fx.ts，转着画）

/**
 * 金斗：口大底小的一只斗（斗口朝上），口沿一圈金，斗里一片深靛（「混元」——斗口里看不见底，中间一点天青的旋），
 * 斗身藤黄、受光一侧提亮成缃，下面一圈赭色的斗足。不描边的网格（转好之后再描）：凡 12×9，灵品斗身多一道回纹，
 * 仙品起口沿嵌一圈月白的小珠、斗身一道天青玉带（仙 / 神靠细节，不靠变大：最大也就 13×10）。
 * 器灵：「倒海」斗身的玉带换成一道起伏的水纹；「收宝」口沿上多三粒金光。
 * DOU_MOUTH 是斗口中心（转动中心、吸东西的那一点）。
 */
export function jindouGrid(tier: number, spirit: string | null): Grid {
  const rows = [
    '.bYYYYYYYYb.', // 0 口沿（后沿）
    'yYNNNNNNNNYy', // 1 斗口里
    'yYNNnCNNNNYy',
    'byYYYYYYYYyb', // 3 口沿（前沿）
    '.byYyyyyyyb.',
    '.byYyyyyyyb.',
    '..byYyyyyb..',
    '..bbyyyybb..',
    '...BbbbbB...', // 8 斗足
  ];
  if (tier >= 2) rows[5] = '.bBYBYBYBYb.'; // 灵：一道回纹
  if (tier >= 3) {
    rows[0] = '.bWYWYYWYWb.'; // 仙：口沿一圈小珠
    rows[5] = spirit === 'dao' ? '.bcCwCcCwCb.' : '.bCCCCCCCCb.'; // 天青玉带（倒海：起伏的水纹）
  }
  if (spirit === 'shou') rows[0] = '.bWfWYfWYWb.';
  return grid(rows);
}
export const DOU_MOUTH = { x: 6, y: 2 };
/** 金斗的描边：金描赭、天青描黛蓝，其余描玄。 */
export const DOU_SEL: Record<string, string> = { y: 'B', Y: 'B', b: 'B', f: 'B', W: 'B', C: 'n', c: 'n', w: 'n' };
