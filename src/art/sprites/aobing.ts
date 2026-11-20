// 敖丙（暂拟，待评审确认）：朝右绘制，朝左时整体镜像。画布 62×40（右边留给刺出去的戟），脚底锚点 (21, 39)。
// 照原著《封神演义》自己设计（不照近年动画电影里的形象）：东海龙王三太子，「骑避水兽、提画杆戟」的少年龙将——
// 墨发高束成马尾、戴一顶小白玉冠，额角一对短短的玉色龙角；银白鱼鳞甲（霜白 / 冷银 / 雾蓝三档）罩在月白战袍外面，
// 龙首吞肩、天青的领缘和中缝、靛青丝绦（两缕绦尾往后飘）；月白裤、银护胫、玄青靴；手里竖握一杆方天画戟（两侧月牙刃、天青的缨）。
// 按「人物与宠物的尺子」：冠顶到鞋底 32 像素、头 8×8、约 3.5 头身，肩（连吞肩）13 宽、腰 7，腰带在鞋底往上 14，露出 8 像素的腿。
// 马尾、绦尾按波形栅格化、帧间连续飘动。
// 帧：待机 / 跑（各 4）、出招时空手的待机 / 跑、蓄势（戟举过肩）/ 刺出 / 收势（各 1）、受击（2）、倒下（2：单膝跪地、拄着戟低头）。
// 首领 / 遭遇战的「回响 · 敖丙」和以后可玩的回响敖丙用同一套帧（game/echo-fx.ts 按姿势取）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { lined, rotSprite } from './fx.ts';

export const AOBING_W = 62;
export const AOBING_H = 40;
export const AOBING_ANCHOR = { x: 21, y: 39 };

/** 同色系描边：皮肤描檀、金器描赭、白甲白袍描雾蓝之外的地方照旧描玄（白甲在浅石地上要描玄才压得住）。 */
const SELOUT: Record<string, string> = { t: 'S', s: 'S', y: 'B', Y: 'B' };

// ---------------------------------------------------------------- 身子（不含前臂、马尾、绦尾、戟）

/**
 * 全身站姿，17 宽、32 行，放在画布 (13, 7)：第 0–2 行玉冠与龙角，3–10 行头（后脑墨发、朝右的四分之三侧脸、细长眼），
 * 11 行脖子，12–16 行吞肩与鱼鳞胸甲，17 行丝绦，18–23 行甲裙与袍摆，24–31 行腿（月白裤、银护胫、玄青靴）。
 */
const BODY = [
  '.....C....w......',
  '......cwZw.C.....',
  '......dwCwdcd....',
  '.....ddddddddd...',
  '....dddgdddddd...',
  '....ddgddttttd...',
  '....dddddtttt....',
  '....ddddtkktkt...',
  '....ddddsttttt...',
  '.....dddsttst....',
  '......ddsstt.....',
  '.........ss......',
  '....TZZwwCwZZT...',
  '..TZWZTwCwTZWZT..',
  '..wwjTZTCTZTjww..',
  '..wj.JTZCZTJ.....',
  '..wj.JZTCTZJ.....',
  '..ts.NnnYnnN.....',
  '.....JZTCTZTJ....',
  '....wJTZCZTZJw...',
  '....wTZTCTZTJw...',
  '....wJZTcTZTJw...',
  '...wjwJZcZTJwjw..',
  '...jjwwwcwwwwjj..',
  '......wj...wj....',
  '......wj...wj....',
  '......jJ...jJ....',
  '......TZ...TZ....',
  '......TZ...TZ....',
  '......JT...JT....',
  '.....NNN..NNNN...',
  '.....NN...NNN....',
];
const BODY_X = 13;
const BODY_Y = 7;
/** 上身到第几行为止（之后是腿，走路、弓步时换掉）。 */
const UPPER = 24;
/** 受击：眯眼咬牙（换掉头部的第 7–9 行）。两眼之间留一格皱起的眉心（原来四格连成一道黑，像戴了墨镜）。 */
const HURT_FACE = ['....ddddtkkSkt...', '....ddddstSSst...', '.....dddsttst....'];

/** 跑：腿换四帧（8 行，接在第 24 行之后）。步子前后对称。 */
const RUN_LEGS = [
  ['.....wj....wjj...', '....wj.......wj..', '....jJ.......jJ..', '...TZ.........TZ.', '..TZ..........TZ.', '..JT..........JT.', '.NNN..........NNN', '.NN.............N'],
  ['......wj..wj.....', '......wj..wj.....', '......jJ.jJ......', '......TZ.TZ......', '......TZTZ.......', '......JTJT.......', '.....NNNNNN......', '.....NN.NNN......'],
  ['......wjwjj......', '.......wjj.......', '.......jJ........', '......TZT........', '......TZT........', '.....JTTJ........', '....NNNNNN.......', '....NN...........'],
  ['.....wj....wj....', '.....wj.....wj...', '....jJ.......jJ..', '....TZ.......TZ..', '...TZ.........TZ.', '...JT.........JT.', '..NNN.........NNN', '..NN............N'],
];
/** 弓步（刺出时）：前腿往前一大步、后腿蹬直。 */
const LUNGE_LEGS = ['.....wj....wjjj..', '....wj.......wjj.', '...jJ.........jJ.', '..TZ..........TZ.', '.TZ...........TZ.', 'JT............JT.', 'NN............NNN', 'N............NNN.'];

/**
 * 倒下：单膝跪地（后膝着地、前腿屈起），上身前倾、低着头，前手拄着竖在地上的戟（戟单独画，见 buildDown）。
 * 17 宽、26 行，放在画布 (13, 13)。
 */
const DOWN = [
  '......C....w.....',
  '.......cwZw.C....',
  '.......dwCwdc....',
  '......dddddddd...',
  '.....dddgddddd...',
  '.....ddgdddddd...',
  '.....dddddddtt...',
  '.....ddddddstt...',
  '......ddddsst....',
  '.....TZZwwCwZZT..',
  '...TZWZTwCwTZWZT.',
  '...wwjTZTCTZTjw..',
  '...wj.JTZCZTJ....',
  '...wj.JZTCTZJ....',
  '...ts.NnnYnnN....',
  '......JZTCTZTJ...',
  '.....wJTZCZTZJw..',
  '....wwTZTCTZTJw..',
  '...wjwJZTcZTJwjw.',
  '..wjjww....wj....',
  '.wjjj......wj....',
  'TZ.........jJ....',
  'TZ.........TZ....',
  'JT........JTZ....',
  'NNNNN....NNNNN...',
  '..........NN.....',
];

// ---------------------------------------------------------------- 前臂（握戟的那只手）

interface Arm {
  rows: string[];
  x: number;
  y: number;
}
/** 握戟：吞肩下露出月白的袍袖，银护腕，拳头在腰前（戟杆从拳里竖穿过去）。 */
const ARM_HOLD: Arm = { rows: ['ww..', 'wjw.', '.TZ.', '..ts', '..ss'], x: 25, y: 21 };
/** 蓄势：前臂往后上抬到肩上（戟举过肩，戟尖朝前上）。 */
const ARM_RAISE: Arm = { rows: ['..st', '.TZ.', 'wjw.', 'ww..'], x: 24, y: 16 };
/** 刺出：手臂往前伸直。 */
const ARM_THRUST: Arm = { rows: ['ww.....', 'wjwTZts', '.....ss'], x: 26, y: 21 };
/** 空手（戟不在手上）：前臂垂在身侧、微微前伸。 */
const ARM_BARE: Arm = { rows: ['ww.', 'wj.', 'TZ.', 'ts.'], x: 25, y: 21 };

// ---------------------------------------------------------------- 方天画戟（竖握时的样子；刺、扫由特效按角度转着画）

/** 竖着的戟头：枪尖、两侧各一道月牙刃（用小枝连在杆上）、淡金吞口、天青的缨。 */
const JI_HEAD = ['...Z...', '...Z...', '..ZWZ..', '.Z.W.Z.', 'Z..W..Z', 'ZTTWTTZ', 'Z..W..Z', '.Z.T.Z.', '..yYy..', '..CcC..', '...c...'];
/** 戟杆多长（从缨下沿到杆尾的镦）。 */
const SHAFT = 23;
/**
 * 整杆戟，竖着（戟尖朝上）、不描边：7 宽、34 高（比人高一点）。杆在第 3 列。GRIP 是握戟的那一点（拳头的位置）。
 * 特效里刺、扫的戟也是这一杆（转着画）。
 */
export const JI_UP = grid([...JI_HEAD, ...Array.from({ length: SHAFT }, (_, i) => (i === SHAFT - 1 ? '...y...' : i % 7 === 6 ? '...T...' : '...n...'))]);
export const JI_GRIP = { x: 3, y: 23 };
/** 戟的描边：金器描赭，其余描玄。 */
export const JI_SEL: Record<string, string> = { y: 'B', Y: 'B' };

/** 握在手里的戟：拳头在 (x, y)，戟身朝右倾 tilt 弧度（0 = 竖直，正的是戟头往前倒）。返回已描边的图层。 */
function held(x: number, y: number, tilt: number): Layer {
  const r = rotSprite(JI_UP, tilt, JI_GRIP.x + 0.5, JI_GRIP.y + 0.5);
  return { g: lined(r.g, 'k', JI_SEL), x: x - r.ax - 1, y: y - r.ay - 1 };
}

// ---------------------------------------------------------------- 马尾、绦尾（程序生成：按波形栅格化，帧间连续飘动）

const TAU = Math.PI * 2;

function pixelGrid(px: Map<string, string>): Grid {
  return grid(Array.from({ length: AOBING_H }, (_, y) => Array.from({ length: AOBING_W }, (_, x) => px.get(`${x},${y}`) ?? '.').join('')));
}

/**
 * 马尾：从脑后的发束（天青发带）往后甩出去，根上粗、梢上细。站定时往后下垂、发梢轻摆；跑起来往后拉平。
 * (x0, y0) 是发束的位置。
 */
function ponytail(phase: number, moving: boolean, x0: number, y0: number, lift = 0): Grid {
  const px = new Map<string, string>();
  const len = moving ? 9 : 6;
  const drop = (moving ? 4 : 9) - lift;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = Math.round(x0 - len * Math.sin((t * Math.PI) / 2) - Math.sin(TAU * (0.8 * t - phase)) * (moving ? 0.3 : 0.7) * t);
    // 跑起来：往后甩成一道起伏的弧（不是一根平的棍子）；站定：贴着后背垂下，发梢轻摆
    const y = Math.round(y0 + drop * t * (moving ? t : t * 0.4 + 0.6) + Math.sin(TAU * (1.1 * t - phase)) * (moving ? 1.6 : 0.2) * t);
    px.set(`${x},${y}`, t > 0.25 && t < 0.6 ? 'g' : 'd');
    if (t < (moving ? 0.5 : 0.7)) px.set(`${x},${y + 1}`, 'd'); // 根上两像素粗，梢上一像素
  }
  // 发带：天青的两格
  px.set(`${x0},${y0 - 1}`, 'C');
  px.set(`${x0},${y0}`, 'c');
  return pixelGrid(px);
}

/** 绦尾：两缕一像素的靛青丝绦，从后腰往后飘（站定时垂着轻摆，跑起来往后扬）。 */
function sashes(phase: number, moving: boolean, x0: number, y0: number, lift = 0): Grid {
  const px = new Map<string, string>();
  for (const [len, drop, ph] of [
    [moving ? 9 : 4, moving ? 3 : 9, 0],
    [moving ? 7 : 2.5, moving ? 5.5 : 7.5, 0.35],
  ] as const) {
    let prev: [number, number] | null = null;
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const x = Math.round(x0 - len * t - Math.sin(TAU * (t - phase - ph)) * (moving ? 0.5 : 0.9) * t);
      const y = Math.round(y0 + (drop - lift) * t + Math.sin(TAU * (1.3 * t - phase - ph)) * (moving ? 1 : 0.3) * t);
      if (prev && prev[0] === x && prev[1] === y) continue;
      px.set(`${x},${y}`, t > 0.82 ? 'C' : t > 0.45 ? 'c' : 'n');
      prev = [x, y];
    }
  }
  return pixelGrid(px);
}

// ---------------------------------------------------------------- 拼帧

export type AobingPose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down';

interface FrameSpec {
  bob: number; // 上身上下浮动
  lean: number; // 上身前倾（负的是后仰）
  phase: number; // 马尾、绦尾的相位
  moving: boolean;
  legs?: string[];
  arm: Arm;
  /** 戟：握在手里时朝前倾多少（弧度）；null = 不在手上（特效画）。 */
  tilt: number | null;
  /** 握戟的拳头相对默认位置挪多少（蓄势、刺出时手的位置变了）。 */
  grip?: [number, number];
  hurt?: boolean;
  lift?: number;
}

function buildFrame(f: FrameSpec): Grid {
  const rows = [...BODY];
  if (f.hurt) rows.splice(7, 3, ...HURT_FACE);
  const upper = grid(rows.slice(0, UPPER));
  const lower = grid(f.legs ?? rows.slice(UPPER));
  const at = (g: Grid, x: number, y: number): Layer => ({ g, x: x + f.lean, y: y + f.bob });
  const base = outline(
    compose(AOBING_W, AOBING_H, [
      at(sashes(f.phase, f.moving, BODY_X + 5, BODY_Y + 18, f.lift ?? 0), 0, 0),
      at(ponytail(f.phase, f.moving, BODY_X + 4, BODY_Y + 4, f.lift ?? 0), 0, 0),
      { g: lower, x: BODY_X, y: BODY_Y + UPPER },
      at(upper, BODY_X, BODY_Y),
    ]),
    'k',
    SELOUT,
  );
  const layers: Layer[] = [{ g: base, x: 0, y: 0 }];
  if (f.tilt !== null) layers.push(held(28 + f.lean + (f.grip?.[0] ?? 0), 25 + f.bob + (f.grip?.[1] ?? 0), f.tilt));
  layers.push(at(outline(grid(f.arm.rows), 'k', SELOUT), f.arm.x - 1, f.arm.y - 1));
  return compose(AOBING_W, AOBING_H, layers);
}

/** 倒下：单膝跪地、拄着戟（戟竖在身前、杆尾插进地里），马尾垂到肩前。 */
function buildDown(phase: number): Grid {
  const base = outline(
    compose(AOBING_W, AOBING_H, [
      { g: sashes(phase, false, BODY_X + 6, 28, 2), x: 0, y: 0 },
      { g: ponytail(phase, false, BODY_X + 5, 17, 0), x: 0, y: 0 },
      { g: grid(DOWN), x: BODY_X, y: 13 },
    ]),
    'k',
    SELOUT,
  );
  return compose(AOBING_W, AOBING_H, [{ g: base, x: 0, y: 0 }, held(31, 24, 0.03), { g: outline(grid(['ww..', 'wTts', '..ss']), 'k', SELOUT), x: 27, y: 22 }]);
}

export function makeAobingFrames(): Record<AobingPose, Grid[]> {
  const idle = (weapon: boolean) =>
    [0, 1, 2, 3].map((i) => buildFrame({ bob: i === 1 || i === 2 ? 1 : 0, lean: 0, phase: i / 4, moving: false, arm: weapon ? ARM_HOLD : ARM_BARE, tilt: weapon ? 0.1 : null }));
  const move = (weapon: boolean) =>
    [0, 1, 2, 3].map((i) => buildFrame({ bob: i % 2, lean: 1, phase: i / 4, moving: true, legs: RUN_LEGS[i], arm: weapon ? ARM_HOLD : ARM_BARE, tilt: weapon ? 0.22 : null }));
  return {
    idle: idle(true),
    move: move(true),
    idleBare: idle(false),
    moveBare: move(false),
    // 蓄势：上身后仰，戟举过肩、戟尖朝前上
    windup: [buildFrame({ bob: 1, lean: -1, phase: 0.1, moving: false, arm: ARM_RAISE, tilt: 1.0, grip: [-1, -7] })],
    // 刺出：弓步，手臂伸直，戟放平刺出去
    throw: [buildFrame({ bob: 1, lean: 1, phase: 0.35, moving: true, legs: LUNGE_LEGS, arm: ARM_THRUST, tilt: 1.5, grip: [4, -2] })],
    follow: [buildFrame({ bob: 1, lean: 2, phase: 0.6, moving: true, legs: LUNGE_LEGS, arm: ARM_THRUST, tilt: 1.57, grip: [6, -2] })],
    // 受击：上身往后一仰，戟被震得往前倒
    hurt: [0, 1].map((i) => buildFrame({ bob: 0, lean: -1 - i, phase: 0.2 + i * 0.25, moving: false, arm: ARM_HOLD, tilt: 0.3 + i * 0.12, hurt: true, lift: 2 })),
    down: [0, 1].map((i) => buildDown(0.3 + i * 0.4)),
  };
}

export const AOBING_FRAMES = makeAobingFrames();
