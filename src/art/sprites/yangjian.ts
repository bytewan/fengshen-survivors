// 杨戬（v3，2026-11-11 用户试玩后重画；暂拟，待评审确认）：朝右绘制，朝左时整体镜像。画布 44×40，脚底锚点 (22, 39)。
// 尺子（docs/design.md「人物与宠物的尺子」，人物放大约 15% 之后）：成年武神约 3.6 头身——头（发顶到下巴）8 像素、冠顶到鞋底 32；
// 肩连护肩 14 宽（头宽的 1.75 倍）、腰 7、甲裙再放开，上身是倒三角；腰带离鞋底 14，甲裙下露出 8 像素的小腿和靴。
// 站直：头的中线在两脚中点上，跑的帧上身最多前倾 1 像素、步子前后对称；三尖两刃刀竖着拿。
// 造型：三山冠（金，中峰最高）；墨发（两道黛色的光泽）；额上天眼是一道竖着的金纹（两像素，不画圆）；细长的近眼、远眼一格暗；嘴角一点。
// 冷银的鳞甲（霜白 / 闪光 / 冷银 / 雾蓝 / 浅青石）：胸甲两排甲片上亮下暗，两肩云头护肩（近身那只镶金色的云头下沿），
// 金带、正中一枚金扣；腰下前后两片鳞甲裙（后片在背光里暗一档、错开的鳞、金色的下沿），中缝和下面露出靛青战袍的下摆；
// 墨裤、冷银护胫、乌靴。身后一领靛青披风（外沿受光一道黛蓝、一道竖褶，跑起来下摆翻起露出石青的里子），按波形栅格化、帧间连续飘动；
// 冠后两缕靛青冠带。帧：待机 / 跑（各 4）、出招时空手的待机 / 跑（刀由特效画，game/heroes/sanjian-fx.ts）、
// 蓄势 / 横扫 / 刺出（各 1）、受击（2）、倒下（2：单膝跪地、拄着刀低头）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { lined, rotSprite } from './fx.ts';

export const YANGJIAN_W = 44;
export const YANGJIAN_H = 40;
export const YANGJIAN_ANCHOR = { x: 22, y: 39 };

/** 同色系描边：皮肤描檀、金器描赭，其余描玄（银甲在浅色的地上要描玄才压得住）。 */
const SELOUT: Record<string, string> = { t: 'S', s: 'S', y: 'B', Y: 'B', b: 'B' };

// ---------------------------------------------------------------- 身子（不含两只手、披风、冠带、刀）

/**
 * 全身站姿的上半截：24 宽，放在画布 (12, 8)，第 0 行是画布的第 8 行（行尾的注释是画布上的行号）。
 * 8–10 三山冠，11–18 头（发顶到下巴 8 行：后脑墨发、四分之三侧脸朝右），19 颈与交领，20–22 云头护肩与胸甲，
 * 23–24 胸甲下两排甲片，25 金带，26–30 鳞甲裙，31 战袍下摆。
 */
const UPPER = [
  '.........Y..............', // 8 冠：中峰
  '.......y.Y.y............', // 9 三峰
  '.......byYyb............', // 10 冠口
  '.......dgdddd...........', // 11 发顶
  '......dgdgdddd..........', // 12 墨发的光泽
  '......ddddttYt..........', // 13 额、天眼
  '......dddsStyt..........', // 14 剑眉（一格檀色，压在近眼外梢）
  '......dddsdktS..........', // 15 眼：近眼两格（乌、玄）细长，远眼一格暗
  '......ddsstttt..........', // 16 颧下一道暗
  '.......dSsttSs..........', // 17 嘴角
  '.........Ssts...........', // 18 下巴
  '........NnssnN..........', // 19 颈、交领
  '....ZWZZWZyZTTT.........', // 20 护肩、胸甲上沿（领口一枚金扣）
  '...ZZZZTWZZZTJZT........', // 21
  '...ybyybTTTTJJTJ........', // 22 云头护肩的金边；甲片
  '.......TZWZTJX..........', // 23
  '.......JTTTJJX..........', // 24
  '.......byyYyyb..........', // 25 金带
  '......NTJTnZWZT.........', // 26 鳞甲裙（后片暗一档、前片），中缝露出袍
  '......NJTJNTZTJ.........', // 27
  '......NTJTnZTZJ.........', // 28
  '......NJTJNTZTJ.........', // 29
  '......NyybNyyyb.........', // 30 甲裙下沿金边
  '......NnnNNNnnN.........', // 31 袍摆
];
const BODY_X = 12;
const BODY_Y = 8;
/** 受击：眉头一拧、眼闭紧（檀色两道）、咬牙（换掉第 14–17 行）。 */
const HURT_FACE = ['......dddsSSyt..........', '......dddsSStS..........', '......ddssSSSt..........', '.......dSstSSs..........'];
/** 后手（近身的那一只，垂在身侧）：靛青的袖、冷银护腕、拳头在胯边。跑的时候跟着步子前后摆（swing）。 */
const BACK_ARM = { rows: ['nN', 'nN', 'nN', 'ZT', 'ZT', 'ts'], x: 16, y: 23 };

/** 站着的腿（8 行，画布第 32–39 行）：墨裤的膝、冷银护胫、乌靴（鞋底一行玄）。两脚的中点在锚点上。 */
const LEGS = [
  '.......dd..dd...........',
  '.......TZ..TZ...........',
  '.......TZ..TZ...........',
  '.......TZ..TZ...........',
  '.......dg..dg...........',
  '.......dd..dd...........',
  '......ddd..ddd..........',
  '......kkkk.kkkk.........',
];
/** 跑：迈开（前腿往前够、后腿往后蹬，前后对称）/ 收拢（后脚抬起来从身下过、前脚踩在身子正下方）。 */
const STRIDE = [
  '......dd....dd..........',
  '.....TZ......TZ.........',
  '.....TZ......TZ.........',
  '....TZ........TZ........',
  '....dg........dg........',
  '...dd.........dd........',
  '..ddd.........ddd.......',
  '..kk..........kkkk......',
];
const PASS = [
  '.......dddd.............',
  '......TZ.TZ.............',
  '.....TZ..TZ.............',
  '....dg...TZ.............',
  '...ddd...dg.............',
  '.........dd.............',
  '.........ddd............',
  '.........kkkk...........',
];
const RUN_LEGS = [STRIDE, PASS, STRIDE, PASS];
/** 弓步（刺出时）：前腿往前一大步、后腿蹬直。 */
const LUNGE_LEGS = [
  '......dd....ddd.........',
  '.....TZ.......TZ........',
  '....TZ.........TZ.......',
  '...TZ...........TZ......',
  '..dg............dg......',
  '.dd.............dd......',
  'ddd.............ddd.....',
  'kkk.............kkkk....',
];

/**
 * 倒下：单膝跪地（后膝着地、小腿贴地，前腿屈起、前脚踏地），上身往前低一点、低着头，前手拄着竖在地上的刀（刀单独画，见 buildDown）。
 * 24 宽，放在画布 (12, 14)：头低下去、比站着矮 6 像素。
 */
const DOWN = [
  '..........Y.............', // 14
  '........y.Y.y...........',
  '........byYyb...........',
  '........dgdddd..........', // 17
  '.......dgdgdddd.........',
  '.......dddddtYt.........', // 19 低着头：额和天眼露得多
  '.......ddddttyt.........',
  '.......dddsdtsS.........', // 21 眼往下看
  '.......ddsttttt.........',
  '........dSsttS..........',
  '..........SsS...........', // 24 下巴
  '.........NnssnN.........', // 25 颈、交领
  '.....ZWZZWZZZTTT........',
  '....ZZZZTWZZZTJZT.......',
  '....ybyybTTTTJJTJ.......', // 28
  '........TZWZTJX.........',
  '........JTTTJJX.........',
  '........byyYyyb.........', // 31 金带
  '......NNTJTnZWZTZ.......', // 32 甲裙：前片搭在屈起的大腿上
  '.....NNJTJNTZTZT........',
  '.....NyybN..yyyyb.......', // 34
  '......ddd.....dd........', // 35 后腿往下跪、前腿的小腿竖着
  '....TZdd......TZ........',
  '.TZTZd........TZ........', // 37 后腿的小腿贴地
  'dddddd........dg........',
  'kkkkkkk......kkkkk......', // 39
];

// ---------------------------------------------------------------- 握刀的前臂

interface Arm {
  rows: string[];
  x: number;
  y: number;
}
/** 握刀：远处的肩下靛青的袖、肘往下，前臂（冷银护腕）往前，拳头在腰前，刀杆从拳里竖穿过去。 */
const ARM_HOLD: Arm = { rows: ['nn...', 'Nn...', 'Nn...', '.NZZ.', '...tt', '...ss'], x: 26, y: 23 };
/** 蓄势：手臂往前上方举起，拳头高过头顶前方（刀由特效画）。 */
const ARM_RAISE: Arm = { rows: ['...ts', '...ss', '..Z..', '..Z..', '.nZ..', '.n...', 'nn...'], x: 26, y: 12 };
/** 横扫：手臂往前平伸。 */
const ARM_SWEEP: Arm = { rows: ['nn.....', 'nnnZZts', '.....ss'], x: 26, y: 23 };
/** 刺出：手臂往前伸直。 */
const ARM_THRUST: Arm = { rows: ['nn......', 'nnnZZZts', '......ss'], x: 26, y: 24 };

// ---------------------------------------------------------------- 三尖两刃刀（竖握时的样子；挥动、刺出由特效按角度转着画）

/** 竖着的刀头：三尖（中间长、两边短，冷银，中脊闪光）、下面一截宽的两刃、金吞口、红缨。 */
const SANJIAN_HEAD = ['...W...', '...W...', '...W...', 'Z..W..Z', 'ZT.W.TZ', '.ZTWTZ.', '.ZZWZT.', '.ZZWZT.', '..ZWT..', '..ZWT..', '...T...', '..yYy..', '..rer..', '...r...'];
/** 刀杆多长（从吞口下沿到杆尾的金镦）。 */
const SHAFT = 19;
/**
 * 整把刀，竖着（刀尖朝上）、不描边：7 宽、33 高（法宝不画得过大：比人高一点，凡 / 灵的本体不过 34）。杆在第 3 列。
 * GRIP 是握刀的那一点（拳头的位置）。特效里挥、刺的刀也是这一把（game/heroes/sanjian-fx.ts 转着画）。
 */
export const SANJIAN_UP = grid([...SANJIAN_HEAD, ...Array.from({ length: SHAFT }, (_, i) => (i === SHAFT - 1 ? '...b...' : i % 6 === 5 ? '...B...' : '...g...'))]);
export const SANJIAN_GRIP = { x: 3, y: 24 };
/** 刀的描边：金器描赭、红缨描殷，其余描玄。 */
export const SANJIAN_SEL: Record<string, string> = { y: 'B', Y: 'B', r: 'R', e: 'R' };

/** 握在手里的刀：拳头在 (x, y)，刀身朝右倾 tilt 弧度（0 = 竖直，正的是刀头往前倒）。返回已描边的图层。 */
function held(x: number, y: number, tilt: number): Layer {
  if (tilt === 0) return { g: lined(SANJIAN_UP, 'k', SANJIAN_SEL), x: x - SANJIAN_GRIP.x - 1, y: y - SANJIAN_GRIP.y - 1 };
  const r = rotSprite(SANJIAN_UP, tilt, SANJIAN_GRIP.x + 0.5, SANJIAN_GRIP.y + 0.5);
  return { g: lined(r.g, 'k', SANJIAN_SEL), x: x - r.ax - 1, y: y - r.ay - 1 };
}
/** 握刀的那一点（拳头里，刀杆穿过的地方）：画布坐标，不含前倾、浮动。 */
const GRIP_AT = { x: 29, y: 27 };

// ---------------------------------------------------------------- 披风、冠带（程序生成：按波形栅格化，帧间连续飘动）

/**
 * 披风：从两肩披下，挡在身后；外沿是一道波浪，站定时垂到小腿、下摆微微摆动，跑起来往后扬起、下摆翻起来露出里子。
 * 外沿一像素受光（n），里面靛（N），中间一道竖褶（n）；下摆翻起的地方是石青的里子（c）。lift：往后扬得更高（受击）。
 */
function cape(phase: number, moving: boolean, lift = 0): Grid {
  const px = new Map<string, string>();
  const TAU = Math.PI * 2;
  const top = 20;
  const bottom = moving ? 35 : 37;
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / (bottom - top);
    const wave = Math.sin(TAU * (t * 1.1 - phase)) * (0.3 + 0.8 * t);
    const flare = (moving ? 2.2 + 5 * t * t : 0.5 + 2 * t * t) + lift * t + wave;
    const outer = Math.round(16 - t * 1.4 - flare);
    const fold = Math.round(outer + 2 + t * 1.4);
    // 挡在身后：腿那一截只到后腿后面（不从两腿之间露出来，腿才看得清）
    const inner = y >= 31 ? 18 : 24;
    for (let x = outer; x <= inner; x++) {
      let ch = 'N';
      if (x === outer) ch = 'n';
      else if (x === fold && t > 0.2) ch = 'n';
      // 下摆：跑起来往上翻，露出石青的里子；站着时最下一行收一道黛蓝
      if (y === bottom) ch = moving || lift > 0 ? (x <= outer + 2 ? 'c' : 'n') : x === outer ? 'n' : 'N';
      if (moving && y === bottom - 1 && x <= outer + 1) ch = 'c';
      px.set(`${x},${y}`, ch);
    }
  }
  return pixelGrid(px);
}

/** 冠带：两缕一像素的细带，从冠后往后飘（站定时垂一点，跑起来往后拉平）。 */
function ribbons(phase: number, moving: boolean, x0: number, y0: number): Grid {
  const px = new Map<string, string>();
  const TAU = Math.PI * 2;
  for (const [len, drop, ph] of [
    [moving ? 8 : 6.5, moving ? 1 : 3.8, 0],
    [moving ? 7 : 5.5, moving ? 2.4 : 5.4, 0.3],
  ] as const) {
    let prev: [number, number] | null = null;
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const x = Math.round(x0 - len * t);
      const y = Math.round(y0 + drop * t + 0.9 * Math.sin(TAU * (1.2 * t - phase - ph)) * t);
      if (prev && prev[0] === x && prev[1] === y) continue;
      px.set(`${x},${y}`, t > 0.8 ? 'c' : 'n');
      prev = [x, y];
    }
  }
  return pixelGrid(px);
}

function pixelGrid(px: Map<string, string>): Grid {
  return grid(Array.from({ length: YANGJIAN_H }, (_, y) => Array.from({ length: YANGJIAN_W }, (_, x) => px.get(`${x},${y}`) ?? '.').join('')));
}

// ---------------------------------------------------------------- 拼帧

export type YangjianPose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down';

interface FrameSpec {
  bob: number; // 上身上下浮动
  lean: number; // 上身前倾（负的是后仰）
  phase: number; // 披风、冠带的相位
  moving: boolean;
  legs?: string[];
  arm: Arm;
  weapon: boolean;
  tilt?: number; // 刀往前倾多少（弧度）
  hurt?: boolean;
  lift?: number;
  /** 后手往前（正）/ 往后（负）摆几像素（跑的时候）。 */
  swing?: number;
}

function buildFrame(f: FrameSpec): Grid {
  const rows = [...UPPER];
  if (f.hurt) rows.splice(14 - BODY_Y, 4, ...HURT_FACE);
  const at = (g: Grid, x: number, y: number): Layer => ({ g, x: x + f.lean, y: y + f.bob });
  const base = outline(
    compose(YANGJIAN_W, YANGJIAN_H, [
      at(cape(f.phase, f.moving, f.lift ?? 0), 0, 0),
      { g: grid(f.legs ?? LEGS), x: BODY_X, y: 32 },
      at(grid(rows), BODY_X, BODY_Y),
      at(grid(BACK_ARM.rows), BACK_ARM.x + (f.swing ?? 0), BACK_ARM.y),
    ]),
    'k',
    SELOUT,
  );
  const layers: Layer[] = [at(ribbons(f.phase, f.moving, 18, 11), 0, 0), { g: base, x: 0, y: 0 }];
  if (f.weapon) layers.push(held(GRIP_AT.x + f.lean, GRIP_AT.y + f.bob, f.tilt ?? 0));
  layers.push(at(outline(grid(f.arm.rows), 'k', SELOUT), f.arm.x - 1, f.arm.y - 1));
  return compose(YANGJIAN_W, YANGJIAN_H, layers);
}

/** 倒下：单膝跪地、拄着刀（刀竖在身前、杆尾插进地里），披风垂在身后的地上。 */
function buildDown(phase: number): Grid {
  const base = outline(
    compose(YANGJIAN_W, YANGJIAN_H, [
      { g: cape(phase, false, 0), x: -1, y: 2 },
      { g: grid(DOWN), x: BODY_X, y: 14 },
    ]),
    'k',
    SELOUT,
  );
  return compose(YANGJIAN_W, YANGJIAN_H, [
    { g: ribbons(phase, false, 19, 17), x: 0, y: 0 },
    { g: base, x: 0, y: 0 },
    held(30, 31, 0),
    { g: outline(grid(['nn..', 'NZts', '..ss']), 'k', SELOUT), x: 26, y: 29 },
  ]);
}

export function makeYangjianFrames(): Record<YangjianPose, Grid[]> {
  const idle = (weapon: boolean) =>
    [0, 1, 2, 3].map((i) => buildFrame({ bob: i === 1 || i === 2 ? 1 : 0, lean: 0, phase: i / 4, moving: false, arm: ARM_HOLD, weapon }));
  const move = (weapon: boolean) =>
    [0, 1, 2, 3].map((i) =>
      buildFrame({ bob: i % 2 ? 0 : 1, lean: 1, phase: i / 4, moving: true, legs: RUN_LEGS[i], arm: ARM_HOLD, weapon, tilt: 0.12, swing: i === 0 ? 1 : i === 2 ? -1 : 0 }),
    );
  return {
    idle: idle(true),
    move: move(true),
    idleBare: idle(false),
    moveBare: move(false),
    windup: [buildFrame({ bob: 1, lean: -1, phase: 0.1, moving: false, arm: ARM_RAISE, weapon: false })],
    throw: [buildFrame({ bob: 0, lean: 1, phase: 0.35, moving: true, arm: ARM_SWEEP, weapon: false })],
    follow: [buildFrame({ bob: 1, lean: 1, phase: 0.6, moving: true, legs: LUNGE_LEGS, arm: ARM_THRUST, weapon: false })],
    // 受击：上身往后一仰，刀被震得往前倒一点（刀头离开脸）
    hurt: [0, 1].map((i) => buildFrame({ bob: 0, lean: -1 - i, phase: 0.2 + i * 0.25, moving: false, arm: ARM_HOLD, weapon: true, tilt: 0.18 + i * 0.1, hurt: true, lift: 2 })),
    down: [0, 1].map((i) => buildDown(0.3 + i * 0.4)),
  };
}

export const YANGJIAN_FRAMES = makeYangjianFrames();
