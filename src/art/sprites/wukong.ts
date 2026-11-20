// 孙悟空（隐藏角色；用户 11-11 确认的设计，画法 暂拟）：朝右绘制，朝左时整体镜像。画布 44×44（棒子竖在身前、雉鸡翎往后飘，要放得下），
// 脚底锚点 (22, 43)。用户（11-11 试玩后）：「每个主角的模型都必须要帅……身体比例要协调」「模型、法宝不好做美观时可以稍微放大、一定要精致」——
// 照 docs/design.md「人物与宠物的尺子」（32 像素的版本）：冠顶到鞋底 32（金冠占顶上 3）、头 8×8（发顶到下巴）、约 3.5 头身，
// 肩连护肩 14、往下收成倒三角，腰 8，腰带离鞋底 13，甲裙下面露出 9 像素的腿；站直挺胸，跑的时候只微微前倾一像素，棒子竖着拿。
// 造型：齐天大圣——金毛（琥珀 / 赭两档）、头戴金箍和一顶小小的紫金冠（正中一粒朱珠，两边一点翅），冠上两根雉鸡翎往后飘（乌色、翎尖苍色）；
// 心形的肉色脸（眉上一道金毛）、近眼是两格深色的短横（细长眼，平视），往前凸一点的嘴筒子、一点嘴角；
// 锁子黄金甲（缃 / 藤黄的甲片、琥珀的鳞点，玄色的边，金护肩），脖子上系着红披风（结在胸前），腰间玄带金扣，甲裙到膝，乌裤金口玄靴；
// 身后一领红披风，按波形栅格化、帧间连续飘动。手里的如意金箍棒：中间一段乌铁、两头各一道金箍；平时竖在身前，出招时由特效画（game/heroes/jingu-fx.ts）。
// 帧：待机 / 跑（各 4）、出招时空手的待机 / 跑、举棒（竖劈之前）/ 劈下 / 横扫（各 1）、受击（2）、倒下（2：单膝跪地、拄着棒）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { lined, rotSprite } from './fx.ts';

export const WUKONG_W = 44;
export const WUKONG_H = 44;
export const WUKONG_ANCHOR = { x: 22, y: 43 };

/** 同色系描边：皮肤描檀、金器和金毛描赭、红披风描殷，其余描玄。 */
const SELOUT: Record<string, string> = { t: 'S', s: 'S', y: 'B', Y: 'B', b: 'B', r: 'R', e: 'R' };

// ---------------------------------------------------------------- 身子（不含前臂、披风、雉鸡翎、棒子）

/**
 * 全身站姿，18 宽、32 行，放在画布 (BODY_X, BODY_Y)：第 0–2 行紫金冠，3–10 行头（3 额上的金毛、4 金箍、5 眉骨、6 眼与耳、
 * 7 往前凸一点的嘴筒子、8 嘴角、9–10 下颌与下巴；脸占前面 5 格），11 行脖子上的红结，12–17 行锁子黄金甲（肩 14 宽往下收），
 * 18 行腰带（腰 8 宽，离鞋底 13 像素），19–22 行甲裙，23–31 行腿与靴（露出 9 像素：腿看着长）。
 */
const BODY = [
  '.........r........',
  '........yYy.......',
  '.......byrYb......',
  '......BbbbbbbB....',
  '......BYYYYYYy....',
  '......BbbBBBtb....',
  '.....sBbbttkkt....',
  '......BbbtttttS...',
  '......BbbttsstS...',
  '......BBbbtttt....',
  '.......BBbttt.....',
  '.........Brrr.....',
  '..dYYyYyyrRrYybd..',
  '..dYYYyyYyyYyybd..',
  '...dYBBBBBBBBBbd..',
  '....dYybybybbbd...',
  '....dYbybybbbd....',
  '.....dYbybbbd.....',
  '.....ddYYrYdd.....',
  '....YyyByyByyb....',
  '....YyyBydByyb....',
  '....YyyBd.dyyb....',
  '....dyYd...dyd....',
  '.....ddd..ddd.....',
  '.....ddg..ddg.....',
  '.....dd....dd.....',
  '.....dd....dd.....',
  '.....dd....dd.....',
  '.....yy....yy.....',
  '.....kk....kk.....',
  '....kkkk..kkkk....',
  '....kkk...kkk.....',
];
const BODY_X = 13;
const BODY_Y = 12;
/** 上身到第几行为止（之后是腿，走路、弓步时换掉）。 */
const UPPER = 23;
/** 受击：龇牙咧嘴（换掉第 6–8 行：眼睛挤成一道、嘴咧开露出牙）。 */
const HURT_FACE = ['.....sBbbttSSt....', '......BbbtttttS...', '......BbbtkwktS...'];

/** 跑：腿换四帧（9 行，接在第 23 行之后）。上身只微微前倾一像素（用户：直立挺胸），步子前后对称。 */
const RUN_LEGS = [
  ['....ddd...ddd.....', '....ddg....ddg....', '...dd.......dd....', '...dd........dd...', '..dd.........dd...', '..yy..........yy..', '..kk..........kk..', '.kkk..........kkk.', '.kk............kk.'],
  ['.....ddd.ddd......', '.....ddg.ddg......', '......dd.dd.......', '......dd.dd.......', '......dd..dd......', '......yy..yy......', '......kk..kk......', '.....kkk.kkkk.....', '.....kk...kk......'],
  ['.....dddddd.......', '......ddgdd.......', '......ddd.........', '.......ddd........', '.......dd.........', '.......yy.........', '.......kk.........', '......kkkk........', '......kkk.........'],
  ['.....ddd.ddd......', '.....ddg.ddg......', '.....dd...dd......', '......dd..dd......', '......dd..dd......', '......yy..yy......', '......kk..kk......', '.....kkk.kkk......', '......kk..kk......'],
];
/** 弓步（劈下、横扫时）：前腿往前一大步、后腿蹬直。 */
const LUNGE_LEGS = ['....ddd...dddd....', '...ddg......ddg...', '..dd..........dd..', '..dd...........dd.', '.dd............dd.', '.yy.............yy', '.kk.............kk', 'kkk.............kk', 'kk..............kk'];

/**
 * 倒下：单膝跪地（后膝着地、前腿屈起），上身前倾、低着头喘气，前手拄着竖在地上的棒子（棒子单独画，见 buildDown）。
 * 18 宽、24 行，放在画布 (BODY_X, BODY_Y + 8)。
 */
const DOWN = [
  '..........r.......',
  '.........yYy......',
  '........byrYb.....',
  '.......BbbbbbbB...',
  '.......BYYYYYYy...',
  '.......BbbBBBtb...',
  '......sBbbttSSt...',
  '.......BbbtttttS..',
  '.......BBbbtttt...',
  '........BBbttt....',
  '..........Brrr....',
  '...dYYYyyYrRryybd.',
  '...dYYyyYyyYyyYbd.',
  '....dYBBBBBBBBBbd.',
  '.....dYbybybybbd..',
  '......ddYYrYdd....',
  '.....YyyByyByyb...',
  '....YyyBydByyByb..',
  '.ddddddd....ddd...',
  'ddgddd......ddd...',
  'dd..........dd....',
  'gd.........yyd....',
  'kkkkk.....kkkkk...',
  '...........kk.....',
];

// ---------------------------------------------------------------- 前臂（握棒的那只手：金甲的袖、玄色的护腕、金毛的手）

interface Arm {
  rows: string[];
  x: number;
  y: number;
}
/** 握棒：手臂垂在身前，手在腰前握着竖在身边的棒子。 */
const ARM_HOLD: Arm = { rows: ['yd.', 'yd.', 'yd.', '.dB', '.BB'], x: BODY_X + 14, y: BODY_Y + 12 };
/** 空手站着：手垂在身侧（棒子由特效画）。 */
const ARM_REST: Arm = { rows: ['yd', 'yd', 'yd', 'dB', '.B'], x: BODY_X + 14, y: BODY_Y + 12 };
/** 举棒：两手举过头顶（棒子由特效画，举在头上）。 */
const ARM_RAISE: Arm = { rows: ['.BB', '.dB', '.yd', 'yd.', 'yd.', 'yd.'], x: BODY_X + 13, y: BODY_Y + 1 };
/** 劈下：手臂往前下方一甩到底。 */
const ARM_STRIKE: Arm = { rows: ['yd.....', 'dyyd...', '...dyBB', '.....BB'], x: BODY_X + 14, y: BODY_Y + 13 };
/** 横扫：手臂往前平伸（棒子由特效绕着身子转）。 */
const ARM_SWEEP: Arm = { rows: ['yyyddBB', '.d...BB'], x: BODY_X + 14, y: BODY_Y + 13 };

// ---------------------------------------------------------------- 如意金箍棒（竖着的样子；握着、挥动时按角度转着画）

/**
 * 竖着的金箍棒，不描边：2 宽、len 高。两头各一道金箍（缃、藤黄，箍边一道琥珀），中间一段乌铁（乌，受光的一侧苍色，隔一段一道暗金的镌纹）。
 * 特效里挥、劈的棒子也照这个画（game/heroes/jingu-fx.ts；随品阶变长、器灵「擎天」变粗）。
 */
export function staffUp(len: number): Grid {
  const cap = ['Yy', 'Yy', 'Yy', 'yb'];
  const mid = Array.from({ length: Math.max(1, len - 8) }, (_, i) => (i % 9 === 4 ? 'hb' : 'hd'));
  return grid([...cap, ...mid, ...[...cap].reverse()]);
}
/** 棒子的描边：金器描赭，其余描玄。 */
export const STAFF_SEL: Record<string, string> = { y: 'B', Y: 'B', b: 'B' };
/** 握在手里的那一根：比人高一点（尺子：人物手里拿的兵器比人高一点）。 */
const HELD_LEN = 33;
const HELD = staffUp(HELD_LEN);

/** 握着的棒：握在 (x, y)（棒上离下端 grip 格的那一点），往后倾 tilt 弧度（0 = 竖直，正的是上端往后倒）。返回已描边的图层。 */
function held(x: number, y: number, tilt: number, grip = 12): Layer {
  const r = rotSprite(HELD, -tilt, 1, HELD_LEN - grip + 0.5);
  return { g: lined(r.g, 'k', STAFF_SEL), x: x - r.ax - 1, y: y - r.ay - 1 };
}

// ---------------------------------------------------------------- 披风、雉鸡翎（程序生成：按波形栅格化，帧间连续飘动）

/**
 * 红披风：从后肩披下，后沿是一道波浪；站定时贴着背垂下、下摆微微摆动，跑起来往后扬起。
 * 外沿一像素朱（r），里面殷（R）；下摆的角提亮一点朱砂（e）。lift：往后扬得更高（受击）。
 */
function cape(phase: number, moving: boolean, top: number, bottom: number, root: number, lift = 0): Grid {
  const px = new Map<string, string>();
  const TAU = Math.PI * 2;
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / (bottom - top);
    const inner = root - Math.round(t * 1.4);
    const flare = (moving ? 2.6 + 5.4 * t : 1 + 2.6 * t) + lift * t + Math.sin(TAU * (t * 1.1 - phase)) * (0.5 + 1 * t);
    const outer = Math.round(inner - flare);
    for (let x = outer; x <= inner; x++) px.set(`${x},${y}`, x === outer ? (y === bottom ? 'e' : 'r') : 'R');
  }
  return pixelGrid(px);
}

/**
 * 雉鸡翎：两根一像素的细翎，从冠上往上挑、再往后弯下去（站定时翘得高，跑起来往后拉平），翎身乌色、末梢苍色，随风轻轻地抖。
 * (x0, y0) 是翎根（冠上）。
 */
function feathers(phase: number, moving: boolean, x0: number, y0: number): Grid {
  const px = new Map<string, string>();
  const TAU = Math.PI * 2;
  for (const [len, rise, ph] of [
    [moving ? 13 : 11, moving ? 4.5 : 7.5, 0],
    [moving ? 8 : 7, moving ? 3 : 4.5, 0.35],
  ] as const) {
    let prev = '';
    for (let i = 0; i <= 36; i++) {
      const u = i / 36;
      const x = Math.round(x0 - len * u);
      const y = Math.round(y0 - rise * Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1)) - 1.2 * u + 0.8 * Math.sin(TAU * (u * 0.8 - phase - ph)) * u);
      const k = `${x},${y}`;
      if (k === prev) continue;
      px.set(k, u > 0.8 ? 'h' : u > 0.15 ? 'd' : 'g');
      prev = k;
    }
  }
  return pixelGrid(px);
}

function pixelGrid(px: Map<string, string>): Grid {
  return grid(Array.from({ length: WUKONG_H }, (_, y) => Array.from({ length: WUKONG_W }, (_, x) => px.get(`${x},${y}`) ?? '.').join('')));
}

// ---------------------------------------------------------------- 拼帧

export type WukongPose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down';

interface FrameSpec {
  bob: number; // 上身上下浮动
  lean: number; // 上身前倾（负的是后仰）
  phase: number; // 披风、翎子的相位
  moving: boolean;
  legs?: string[];
  arm: Arm;
  staff: boolean; // 手里握不握着棒
  tilt?: number; // 棒子往后倾多少（弧度）
  hurt?: boolean;
  lift?: number;
  armBehind?: boolean; // 手臂画在身子后面（举过头顶时从脑后举上去，不挡脸）
}

function buildFrame(f: FrameSpec): Grid {
  const rows = [...BODY];
  if (f.hurt) rows.splice(6, 3, ...HURT_FACE);
  const upper = grid(rows.slice(0, UPPER));
  const lower = grid(f.legs ?? rows.slice(UPPER));
  const at = (g: Grid, x: number, y: number): Layer => ({ g, x: x + f.lean, y: y + f.bob });
  const base = outline(
    compose(WUKONG_W, WUKONG_H, [
      at(cape(f.phase, f.moving, BODY_Y + 12, f.moving ? 39 : 40, BODY_X + 5, f.lift ?? 0), 0, 0),
      { g: lower, x: BODY_X, y: BODY_Y + UPPER },
      at(upper, BODY_X, BODY_Y),
    ]),
    'k',
    SELOUT,
  );
  const behind: Layer[] = [at(feathers(f.phase, f.moving, BODY_X + 9, BODY_Y + 1), 0, 0)];
  const front: Layer[] = [];
  if (f.staff) front.push(held(BODY_X + 17 + f.lean, BODY_Y + 17 + f.bob, f.tilt ?? -0.06));
  (f.armBehind ? behind : front).push(at(outline(grid(f.arm.rows), 'k', SELOUT), f.arm.x - 1, f.arm.y - 1));
  return compose(WUKONG_W, WUKONG_H, [...behind, { g: base, x: 0, y: 0 }, ...front]);
}

/** 倒下：单膝跪地、拄着棒（棒竖在身前、下端插进地里），披风垂在身后的地上。 */
function buildDown(phase: number): Grid {
  const top = BODY_Y + 8;
  const base = outline(
    compose(WUKONG_W, WUKONG_H, [
      { g: cape(phase, false, top + 11, 42, BODY_X + 5, 0), x: 0, y: 0 },
      { g: grid(DOWN), x: BODY_X, y: top },
    ]),
    'k',
    SELOUT,
  );
  return compose(WUKONG_W, WUKONG_H, [
    { g: feathers(phase, false, BODY_X + 10, top + 1), x: 0, y: 0 },
    { g: base, x: 0, y: 0 },
    held(BODY_X + 17, top + 18, -0.04, 6),
    { g: outline(grid(['yd..', 'dyBB', '..BB']), 'k', SELOUT), x: BODY_X + 14, y: top + 16 },
  ]);
}

/**
 * 挠头（只给解锁过场用，game/wukong-shots.ts）：前手抬到头顶挠两下——两帧，手一前一后。
 */
export function makeWukongScratch(): Grid[] {
  const arm = (dx: number): Arm => ({ rows: ['BB..', '.BB.', '..dy', '..yd', '..yd', '...y'], x: BODY_X + 11 + dx, y: BODY_Y + 2 });
  return [0, 1].map((i) => buildFrame({ bob: 0, lean: 0, phase: 0.2 + i * 0.3, moving: false, arm: arm(i), staff: false }));
}

export function makeWukongFrames(): Record<WukongPose, Grid[]> {
  const idle = (staff: boolean) => [0, 1, 2, 3].map((i) => buildFrame({ bob: i === 1 || i === 2 ? 1 : 0, lean: 0, phase: i / 4, moving: false, arm: staff ? ARM_HOLD : ARM_REST, staff }));
  const move = (staff: boolean) =>
    [0, 1, 2, 3].map((i) => buildFrame({ bob: i % 2, lean: 1, phase: i / 4, moving: true, legs: RUN_LEGS[i], arm: staff ? ARM_HOLD : ARM_REST, staff, tilt: -0.24 }));
  return {
    idle: idle(true),
    move: move(true),
    idleBare: idle(false),
    moveBare: move(false),
    windup: [buildFrame({ bob: 1, lean: -1, phase: 0.1, moving: false, arm: ARM_RAISE, staff: false, armBehind: true })],
    throw: [buildFrame({ bob: 1, lean: 1, phase: 0.35, moving: true, legs: LUNGE_LEGS, arm: ARM_STRIKE, staff: false })],
    follow: [buildFrame({ bob: 0, lean: 1, phase: 0.6, moving: true, legs: LUNGE_LEGS, arm: ARM_SWEEP, staff: false })],
    // 受击：上身往后一仰，披风扬起，棒子被震得往后倒一点
    hurt: [0, 1].map((i) => buildFrame({ bob: 0, lean: -1, phase: 0.2 + i * 0.25, moving: false, arm: ARM_HOLD, staff: true, tilt: 0.12 + i * 0.08, hurt: true, lift: 2 })),
    down: [0, 1].map((i) => buildDown(0.3 + i * 0.4)),
  };
}
