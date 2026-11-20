// 赵公明（v2，2026-11-11 用户试玩后重画；暂拟，待评审确认）：朝右绘制，朝左时整体镜像。画布 44×40，脚底锚点 (22, 39)。
// 尺子（docs/design.md「人物与宠物的尺子」）：冠顶到鞋底 32，头 8 像素；比杨戬壮——肩连护肩 16 宽、腰 15，站直（头在两脚中点上）。
// 用户点名之后改的：原来通身黑褐一团、脸和胡子糊在一起认不出五官、有点佝偻。这一版把脸、胡子、盔甲的明暗拉开：
// 黑面（檀为底，额、颧、鼻梁受光一档绛）——浓眉竖起、怒目（眼白 + 瞳）、两撇髭；虬髯（乌、黛两档，比甲还黑）从下颌垂到胸口收成一尖；
// 金冠（顶上一粒朱珠）；玄色铠甲提亮一档（黛为底、苍色描甲片的边、银鼠一点光），胸口护心镜金边银光；
// 暗金纹袍（赭底、檀色暗纹、琥珀滚边，袍摆前开衩）罩在甲外，袍袖从护肩下露出来；乌靴。手提一条竹节金鞭（暗金、一道道鞭节）。
// 袍摆的后片按波形栅格化、帧间连续飘动。字母沿用原来那一套（回响赵公明按 ECHO_TONE 换色，见 art/sprites/echo-tone.ts）。
// 帧：待机 / 跑（各 4；鞭不离手，空手的两组就是同一组）、举鞭 / 砸下 / 收势（各 1）、受击（2）、倒下（2：单膝跪地、拄着鞭）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const ZHAO_W = 44;
export const ZHAO_H = 40;
export const ZHAO_ANCHOR = { x: 22, y: 39 };

/** 同色系描边：金器描赭，其余描玄。 */
const SELOUT: Record<string, string> = { y: 'B', Y: 'B' };

// ---------------------------------------------------------------- 身子（不含两只手、袍摆的后片、鞭）

/**
 * 全身站姿的上半截：24 宽，放在画布 (12, 8)（行尾的注释是画布上的行号）。8–10 金冠，11–15 黑面（额、浓眉、怒目、颧与鼻、两撇髭），
 * 16–21 虬髯垂到胸口，17–24 护肩、胸甲、护心镜，25 金带，26–31 暗金纹袍。
 * 字母：玄 k、乌 d、黛 g、苍 h（甲片的边）、银鼠 i（甲片的光）、缟 j（眼白）；赭 B、琥珀 b（袍和滚边）、檀 S（黑面的底、袍上的暗纹）、绛 s（黑面受光）；
 * 藤黄 y / 缃 Y（冠、带、护心镜）；朱 r（冠上的珠）。
 */
const UPPER = [
  '.........r..............', // 8
  '........bYb.............', // 9
  '.....byyyYyyb...........', // 10
  '......ddSsssSS..........', // 11
  '......ddSkksSk..........', // 12
  '......dSSjkSjk..........', // 13
  '......dSsSSsSSs.........', // 14
  '......dSSddsddS.........', // 15
  '.......Sdgddgdd.........', // 16
  '...ghh.kdgdgdgkhhg......', // 17
  '..ghhig.kgdgdkgihhg.....', // 18
  '.Bgddhg.dgdgdghddgB.....', // 19
  '.BBhhhh.kgdgkhhhhBB.....', // 20
  '.BbBggg..dgdgggBbB......', // 21
  '.BSBddd..kdkdddBSB......', // 22
  '..BBhhhhyYyhhhhB........', // 23
  '..BBgggyiiygggBB........', // 24
  '..BbbyyyyYYyyyybbB......', // 25
  '..BBBBBBBbBBBBBBB.......', // 26
  '..BBSBBBBbBBBBSBB.......', // 27
  '..BBBBBSBbBSBBBBB.......', // 28
  '...BBBBBb.bBBBBB........', // 29
  '...BSBBBb.bBBBSB........', // 30
  '...bbbbbb.bbbbbb........', // 31
];
const BODY_X = 12;
const BODY_Y = 8;
/** 受击：眉头拧成一道、眼闭紧（换掉第 12、13 行）。 */
const HURT_FACE = ['......ddSkkkkk..........', '......dSSkkSkk..........'];
/** 后手（近身的那一只，垂在身侧）：暗金的大袖、黑手。 */
const BACK_ARM = { rows: ['BB', 'Bb', 'BB', 'Bb', 'SS'], x: 12, y: 22 };

/** 站着的腿（8 行，画布第 32–39 行）：袍摆下露出乌靴。 */
const LEGS = [
  '.....dg....gd...........',
  '.....dg....gd...........',
  '.....dd....dd...........',
  '.....dd....dd...........',
  '....kddk..kddk..........',
  '....kdd...kddd..........',
  '...kkkkk..kkkkk.........',
  '...kkkk...kkkkk.........',
];
/** 跑：迈开 / 收拢（前后对称）。 */
const STRIDE = [
  '....dg......gd..........',
  '...dg........gd.........',
  '...dd........dd.........',
  '..dd..........dd........',
  '.kddk.........kddk......',
  'kdd...........kddd......',
  'kkk...........kkkkk.....',
  'kk.............kkkk.....',
];
const PASS = [
  '......dggd..............',
  '.....dg..gd.............',
  '....dd...dd.............',
  '...kdd...dd.............',
  '..kddk..kddk............',
  '........kddd............',
  '.......kkkkk............',
  '.......kkkkk............',
];
const RUN_LEGS = [STRIDE, PASS, STRIDE, PASS];
/** 倒下的下半截（画布第 35–39 行）：袍摆铺在地上，后膝着地、前腿屈起。上半截是 UPPER 往下挪 6 行。 */
const DOWN_LOW = [
  '.BBBBBBBbBBBBBBBB.......',
  'bbbbbbbbb.bbbbbbb.......',
  '.dddd.......dg..........',
  'ddddd......kddk.........',
  'kkkkkk....kkkkkk........',
];

// ---------------------------------------------------------------- 前臂（提鞭的那只手：袍袖 + 黑手）

interface Arm {
  rows: string[];
  x: number;
  y: number;
}
/** 提鞭：大袖从护肩下垂下来，黑手握拳在腰前（鞭从拳里斜着往前上方伸出去）。 */
const ARM_HOLD: Arm = { rows: ['BB...', 'BBb..', 'BSB..', '.BBSS', '...SS'], x: 27, y: 22 };
/** 举鞭：手臂高举过肩（鞭举在头顶后面）。 */
const ARM_RAISE: Arm = { rows: ['SS..', 'SS..', '.BB.', '.BBb', '..BB', '..BB'], x: 25, y: 13 };
/** 砸下：手臂往前下方一甩到底。 */
const ARM_STRIKE: Arm = { rows: ['BB.....', 'BBbBBSS', '.BB..SS'], x: 27, y: 22 };
/** 收势：手臂收回胸前。 */
const ARM_RECOVER: Arm = { rows: ['BB....', 'BBbBSS', '.BB.SS'], x: 27, y: 22 };

// ---------------------------------------------------------------- 竹节金鞭（竖着的样子；握在手里时按角度转着画）

/**
 * 竹节鞭，竖着（鞭头朝上）、不描边：2 宽、17 高。鞭身琥珀、受光的一侧藤黄，每隔三格一道赭色的鞭节；
 * 下面一截乌木把手、金镡（护手）。GRIP 是握的那一点（拳头的位置）。神通「金鞭」的虚影也照这个样子（game/heroes/jinbian-fx.ts）。
 */
export const WHIP_UP = grid(['y.', 'bb', 'BB', 'bb', 'by', 'BB', 'bb', 'by', 'BB', 'bb', 'by', 'BB', 'bb', 'by', 'yb', 'd.', 'd.', 'b.']);
export const WHIP_GRIP = { x: 0, y: 15 };
/** 鞭的描边：金器描赭，其余描玄。 */
export const WHIP_SEL: Record<string, string> = { y: 'B', Y: 'B', b: 'B' };

/**
 * 握在手里的鞭：从拳头 (x0, y0) 画到鞭头 (x1, y1)，一像素宽的直线（不旋转贴图，斜着也不起锯齿）。
 * 鞭身琥珀、每隔三格一道赭色的鞭节、受光的一格藤黄、鞭头一点缃；拳头下面露一截乌木把手（往鞭头的反方向）。描玄边。
 */
function held(x0: number, y0: number, x1: number, y1: number): Layer {
  const px = new Map<string, string>();
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    px.set(`${x},${y}`, i === n ? 'Y' : i > 0 && i % 3 === 0 ? 'B' : i % 3 === 1 ? 'y' : 'b');
  }
  // 把手：拳头往后两格
  const ux = (x0 - x1) / n;
  const uy = (y0 - y1) / n;
  for (let i = 1; i <= 2; i++) px.set(`${Math.round(x0 + ux * i)},${Math.round(y0 + uy * i)}`, 'd');
  return { g: outline(pixelGrid(px), 'k', WHIP_SEL), x: 0, y: 0 };
}

// ---------------------------------------------------------------- 袍摆的后片（程序生成：按波形栅格化，帧间连续飘动）

/**
 * 袍摆的后片：从后腰垂下，后沿是一道波浪；站定时贴着腿垂下、下摆微微摆动，跑起来往后扬起。
 * 赭底（B），外沿一像素琥珀（b）的滚边。lift：往后扬得更高（受击）。
 */
function tail(phase: number, moving: boolean, top: number, bottom: number, root: number, lift = 0): Grid {
  const px = new Map<string, string>();
  const TAU = Math.PI * 2;
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / (bottom - top);
    const flare = (moving ? 1.5 + 4 * t : 0.5 + 1.4 * t) + lift * t + Math.sin(TAU * (t * 0.9 - phase)) * (0.3 + 0.8 * t);
    const outer = Math.round(root - flare);
    for (let x = outer; x <= root; x++) px.set(`${x},${y}`, x === outer || y === bottom ? 'b' : 'B');
  }
  return pixelGrid(px);
}

function pixelGrid(px: Map<string, string>): Grid {
  return grid(Array.from({ length: ZHAO_H }, (_, y) => Array.from({ length: ZHAO_W }, (_, x) => px.get(`${x},${y}`) ?? '.').join('')));
}

// ---------------------------------------------------------------- 拼帧

export type ZhaoPose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down';

interface FrameSpec {
  bob: number; // 上身上下浮动
  lean: number; // 上身前倾（负的是后仰）
  phase: number; // 袍摆的相位
  moving: boolean;
  legs?: string[];
  arm: Arm;
  whip: [number, number, number, number] | null; // 鞭：拳头 (x0, y0) → 鞭头 (x1, y1)（画布坐标，再加上前倾、浮动；null = 不画在手上）
  hurt?: boolean;
  lift?: number;
  swing?: number; // 后手跟着步子前后摆
}

function buildFrame(f: FrameSpec): Grid {
  const rows = [...UPPER];
  if (f.hurt) rows.splice(12 - BODY_Y, 2, ...HURT_FACE);
  const at = (g: Grid, x: number, y: number): Layer => ({ g, x: x + f.lean, y: y + f.bob });
  const base = outline(
    compose(ZHAO_W, ZHAO_H, [
      at(tail(f.phase, f.moving, 26, f.moving ? 34 : 36, 15, f.lift ?? 0), 0, 0),
      { g: grid(f.legs ?? LEGS), x: BODY_X, y: 32 },
      at(grid(rows), BODY_X, BODY_Y),
      at(grid(BACK_ARM.rows), BACK_ARM.x + (f.swing ?? 0), BACK_ARM.y),
    ]),
    'k',
    SELOUT,
  );
  const layers: Layer[] = [{ g: base, x: 0, y: 0 }];
  if (f.whip) {
    const [x0, y0, x1, y1] = f.whip;
    layers.push(held(x0 + f.lean, y0 + f.bob, x1 + f.lean, y1 + f.bob));
  }
  layers.push(at(outline(grid(f.arm.rows), 'k', SELOUT), f.arm.x - 1, f.arm.y - 1));
  return compose(ZHAO_W, ZHAO_H, layers);
}

/** 倒下：单膝跪地、低头、拄着鞭（鞭竖在身前、鞭头点地），袍摆铺在身后的地上。 */
function buildDown(phase: number): Grid {
  const base = outline(
    compose(ZHAO_W, ZHAO_H, [
      { g: tail(phase, false, 31, 38, 14, 0), x: 0, y: 0 },
      { g: grid(UPPER.slice(0, 21)), x: BODY_X, y: 14 },
      { g: grid(DOWN_LOW), x: BODY_X, y: 35 },
    ]),
    'k',
    SELOUT,
  );
  return compose(ZHAO_W, ZHAO_H, [
    { g: base, x: 0, y: 0 },
    held(30, 31, 31, 39),
    { g: outline(grid(['BB..', 'BbBS', '..SS']), 'k', SELOUT), x: 27, y: 29 },
  ]);
}

export function makeZhaoFrames(): Record<ZhaoPose, Grid[]> {
  const idle = [0, 1, 2, 3].map((i) => buildFrame({ bob: i === 1 || i === 2 ? 1 : 0, lean: 0, phase: i / 4, moving: false, arm: ARM_HOLD, whip: [30, 26, 35, 11] }));
  const move = [0, 1, 2, 3].map((i) =>
    buildFrame({ bob: i % 2 ? 0 : 1, lean: 1, phase: i / 4, moving: true, legs: RUN_LEGS[i], arm: ARM_HOLD, whip: [30, 26, 36, 12], swing: i === 0 ? 1 : i === 2 ? -1 : 0 }),
  );
  return {
    idle,
    move,
    idleBare: idle,
    moveBare: move,
    windup: [buildFrame({ bob: 1, lean: -1, phase: 0.1, moving: false, arm: ARM_RAISE, whip: [25, 13, 18, 2] })],
    throw: [buildFrame({ bob: 0, lean: 1, phase: 0.35, moving: true, arm: ARM_STRIKE, whip: [33, 24, 41, 30] })],
    follow: [buildFrame({ bob: 0, lean: 0, phase: 0.6, moving: false, arm: ARM_RECOVER, whip: [32, 24, 38, 33] })],
    // 受击：上身往后一仰，袍摆扬起
    hurt: [0, 1].map((i) => buildFrame({ bob: 0, lean: -1 - i, phase: 0.2 + i * 0.25, moving: false, arm: ARM_HOLD, whip: [30 - i, 26, 36 - i * 2, 12 + i], hurt: true, lift: 1.5 })),
    down: [0, 1].map((i) => buildDown(0.3 + i * 0.4)),
  };
}
