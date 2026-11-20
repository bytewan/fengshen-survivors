// 混天绫（哪吒的专属宠物）的造型：配色与尺寸、布的动力学、逐点栅格化、被缠敌人身上的红绫。
// 纯数据 + 纯函数，不依赖 Pixi / DOM：游戏里由 src/game/pet-fx.ts 每帧画进动态纹理；Node 工具也能直接出图自查。
// 用户口径：任何时候都是一整段，绝不缩成一点；要精致、飘逸；被缠的敌人身上要明显地绑着红绫，但不画光圈。
// 2026-11-10 用户：「现在混天绫和蛇一样 要做出布带的效果」，看了对折的长绫以后又说「不需要红色流动的这个特效」
// 「太大了」「动起来还是应该头在动 而不是中间在动」。所以本体是一条小布带，不对折：一头（布头）钉在模拟里混天绫的位置上、
// 领着飞，布身跟在后面按布的动力学飘（风、拖拽、轻微下垂、转弯时顺惯性甩出去、快的时候拉直、尾梢抖）。
// 布头是一道略斜的剪口（不凸起、不点金、不收窄，不像蛇头）；布尾是燕尾，末端轻而略透。
// 布是扁的、正反两面不同色：宽窄全由翻转决定（正对时宽，侧过来是一条线），不从头到尾变细。平时大多正面朝外，
// 偶尔慢慢翻一圈；转急弯、猛加速时布头被带着翻过去，翻面再顺着布传到尾梢。尾梢比布头飘得多，起伏不规则。
import type { EnemyKindName, PetBranch } from '../../sim/types.ts';

/** 调色板字符 → 像素缓冲里存的编码（0 = 透明）。 */
export const C = (ch: string) => ch.charCodeAt(0);

// ---------- 像素缓冲 ----------

/**
 * 一块按世界坐标定位的字符像素缓冲：每格存一个调色板字符的编码，和一档透明度（a：0 不透明，1..3 越来越透，见 ALPHA）。
 * 记着「画过的范围」（x0..x1, y0..y1，缓冲内坐标），清空、描边、转色、上传都只处理这一块，免得每帧扫整块缓冲。
 * dist / idx / side 是栅格化绸带时用的临时数组（和像素一一对应）。
 */
export class Pix {
  readonly w: number;
  readonly h: number;
  ox = 0;
  oy = 0;
  readonly c: Uint8Array;
  readonly a: Uint8Array;
  readonly dist: Float32Array;
  readonly idx: Int32Array;
  readonly side: Int8Array;
  x0 = 1e9;
  y0 = 1e9;
  x1 = -1;
  y1 = -1;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.c = new Uint8Array(w * h);
    this.a = new Uint8Array(w * h);
    this.dist = new Float32Array(w * h);
    this.idx = new Int32Array(w * h).fill(-1);
    this.side = new Int8Array(w * h);
  }
  /** 清空，并把左上角放到世界坐标 (ox, oy)。 */
  reset(ox: number, oy: number) {
    if (this.x1 >= this.x0)
      for (let y = this.y0; y <= this.y1; y++) {
        this.c.fill(0, y * this.w + this.x0, y * this.w + this.x1 + 1);
        this.a.fill(0, y * this.w + this.x0, y * this.w + this.x1 + 1);
      }
    this.ox = ox;
    this.oy = oy;
    this.x0 = this.y0 = 1e9;
    this.x1 = this.y1 = -1;
  }
  /** 把缓冲内坐标的一块记进「画过的范围」。 */
  touch(x0: number, y0: number, x1: number, y1: number) {
    if (x0 < this.x0) this.x0 = Math.max(0, x0);
    if (y0 < this.y0) this.y0 = Math.max(0, y0);
    if (x1 > this.x1) this.x1 = Math.min(this.w - 1, x1);
    if (y1 > this.y1) this.y1 = Math.min(this.h - 1, y1);
  }
  set(x: number, y: number, code: number) {
    x -= this.ox;
    y -= this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.c[y * this.w + x] = code;
    this.a[y * this.w + x] = 0;
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  }
  get(x: number, y: number) {
    x -= this.ox;
    y -= this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.c[y * this.w + x];
  }
  /** 只画在空处。 */
  put(x: number, y: number, code: number) {
    if (!this.get(x, y)) this.set(x, y, code);
  }
  /** 是否画过任何东西。 */
  empty() {
    return this.x1 < this.x0;
  }
}

/** Pix.a 每一档的不透明度（0 档不透明）：布尾的末端一档比一档轻、透。 */
export const ALPHA = [1, 0.8, 0.6, 0.4];

/** 往亮里提一档的颜色（布尾末端用）：殷 → 朱 → 朱砂 → 橘 → 肉色亮；赭 → 琥珀 → 藤黄 → 缃。 */
const LIGHTER = new Uint8Array(128);
for (const [a, b] of ['kR', 'Rr', 're', 'eo', 'ot', 'Bb', 'by', 'yY', 'YY', 'tt', 'ff', 'WW']) LIGHTER[a.charCodeAt(0)] = b.charCodeAt(0);
/** 往暗里压一档（上层的布压在下层上，下层沿着上层的边暗一线）。殷不再往下压成玄（大块发黑难看）。 */
const DARKER = new Uint8Array(128);
for (const [a, b] of ['tf', 'to', 'oe', 'er', 'rR', 'RR', 'kk', 'Yy', 'yb', 'bB', 'BB', 'fY', 'WY']) DARKER[a.charCodeAt(0)] = b.charCodeAt(0);

// ---------- 配色与尺寸 ----------

export interface Face {
  hi: number; // 受光的一边
  body: number;
  lo: number; // 背光的一边
}

export interface RibbonStyle {
  /** 各阶段本体的长度（像素，从布头到燕尾的尖）。人物约 16 × 24 像素：布要明显比人物占地方小。 */
  len: number[];
  /** 各阶段布的宽度（像素，正对着看时）：屏幕上的宽窄全靠翻转，不从头到尾变细。 */
  width: number[];
  /** 本体的正面：按受光分三档（暗 / 中 / 亮）。布一翻、一弯，朝光的地方亮、背光的地方暗，这是绸子的光泽。 */
  clothFront: [Face, Face, Face];
  /** 本体的反面：两档（暗 / 中），整体比正面深一档。 */
  clothBack: [Face, Face];
  /** 本体翻面处的折痕：[翻向正面的一侧, 翻向反面的一侧]，比两边暗一档。 */
  crease: [number, number];
  /** 被缠住的敌人身上那几道红绫（drawWrap / drawRibbon / 绳结）的亮面三档与背光面两档：保持原来的样子。 */
  front: [Face, Face, Face];
  back: [Face, Face];
  rim: number; // 背光一侧的外描边
  rimLit: number; // 受光一侧的外描边（0 = 不描，让亮边直接贴着背景，轻一些）
  gold: number;
  goldHi: number;
  goldLo: number;
  pattern: 'cloud' | 'scale' | 'flame';
}

const F = (hi: string, body: string, lo: string): Face => ({ hi: C(hi), body: C(body), lo: C(lo) });

// 默认：正面朱砂（亮处橘），反面朱、背光边殷，金色云纹（用户给的调色板 e o r R y Y）。
// 2026-11-10 用户「混天绫太大了」：未进化时 38 × 3.5 像素，进化越往后越长越宽，但第 3 阶也不过 50 × 4.3。
const BASE: RibbonStyle = {
  len: [38, 42, 46, 50],
  width: [3.5, 3.7, 4, 4.3],
  clothFront: [F('o', 'e', 'r'), F('o', 'e', 'r'), F('t', 'o', 'e')],
  clothBack: [F('e', 'r', 'R'), F('e', 'r', 'R')],
  crease: [C('r'), C('R')],
  front: [F('e', 'r', 'R'), F('o', 'e', 'r'), F('o', 'o', 'e')],
  back: [F('r', 'R', 'R'), F('e', 'r', 'R')],
  rim: C('R'),
  rimLit: 0,
  gold: C('y'),
  goldHi: C('Y'),
  goldLo: C('b'),
  pattern: 'cloud',
};
// 缚龙：更深的绛红、略宽略短，金色鳞纹（窄的本体上只是中线上疏疏的金钉；宽的布才是两道贴边的金线夹着一行人字鳞）
const BIND: RibbonStyle = {
  ...BASE,
  len: [38, 41, 45, 49],
  width: [3.6, 3.9, 4.2, 4.5],
  clothFront: [F('e', 'r', 'R'), F('e', 'r', 'R'), F('o', 'e', 'r')],
  clothBack: [F('r', 'R', 'R'), F('e', 'r', 'R')], // 背面是深绛红（不发黑：飞起来翻面时不会一截截地变成黑块）
  crease: [C('R'), C('R')],
  front: [F('r', 'R', 'k'), F('e', 'r', 'R'), F('o', 'e', 'r')],
  back: [F('r', 'R', 'R'), F('e', 'r', 'R')],
  rim: C('k'),
  rimLit: C('R'),
  pattern: 'scale',
};
// 火绫：颜色偏橘（亮边缃色）、略长略窄，边缘带火舌、飘出余烬
const FIRE: RibbonStyle = {
  ...BASE,
  len: [39, 43, 48, 53],
  width: [3.4, 3.6, 3.9, 4.2],
  clothFront: [F('Y', 'o', 'e'), F('Y', 'o', 'e'), F('f', 'o', 'e')],
  clothBack: [F('o', 'e', 'r'), F('o', 'e', 'r')],
  crease: [C('r'), C('r')],
  front: [F('o', 'e', 'r'), F('o', 'o', 'e'), F('Y', 'o', 'e')],
  back: [F('e', 'r', 'R'), F('o', 'e', 'r')],
  rim: C('R'),
  rimLit: 0,
  pattern: 'flame',
};

/**
 * 黑绫（魔化哪吒的混天绫，回响化身）：同一条布、同一套进化，颜色压暗一档成黑红——和第一章首领身上那条一个口径
 * （殷红为主、背光压成乌和玄，金色的纹样换成暗朱）。按字符整体往暗里换一档（DARK），不另画。
 */
const DARK: Record<string, string> = { f: 'o', Y: 'e', o: 'r', e: 'R', r: 'd', R: 'k', t: 'e', y: 'r', b: 'R' };
const dk = (c: number) => (c ? C(DARK[String.fromCharCode(c)] ?? String.fromCharCode(c)) : 0);
const dkF = (f: Face): Face => ({ hi: dk(f.hi), body: dk(f.body), lo: dk(f.lo) });
const darken = (s: RibbonStyle): RibbonStyle => ({
  ...s,
  clothFront: [dkF(s.clothFront[0]), dkF(s.clothFront[1]), dkF(s.clothFront[2])],
  clothBack: [dkF(s.clothBack[0]), dkF(s.clothBack[1])],
  crease: [dk(s.crease[0]), dk(s.crease[1])],
  front: [dkF(s.front[0]), dkF(s.front[1]), dkF(s.front[2])],
  back: [dkF(s.back[0]), dkF(s.back[1])],
  rim: dk(s.rim),
  rimLit: dk(s.rimLit),
  gold: dk(s.gold),
  goldHi: dk(s.goldHi),
  goldLo: dk(s.goldLo),
});
const DARK_BASE = darken(BASE);
const DARK_BIND = darken(BIND);
const DARK_FIRE = darken(FIRE);

/** 绸带的样子：按进化的那条路；dark = 黑绫（魔化哪吒）。 */
export function ribbonStyle(branch: PetBranch | null, dark = false): RibbonStyle {
  if (dark) return branch === 'bind' ? DARK_BIND : branch === 'fire' ? DARK_FIRE : DARK_BASE;
  return branch === 'bind' ? BIND : branch === 'fire' ? FIRE : BASE;
}

// ---------- 混天绫本体：布的动力学 ----------

const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const TAU = Math.PI * 2;

/** 布身周围的风和飞行状态：表现层按混天绫飞得多快、飘在主人哪一侧每帧算好（petWind），交给 ClothBody.step。 */
export interface ClothEnv {
  wx: number; // 风：空气本身的速度（像素 / 秒）
  wy: number;
  sway: number; // 0..1：布身低频的大起伏（慢的时候大）
  flutter: number; // 0..1：尾梢的高频抖动（快的时候大）
}

/** 布的物理参数（像素、秒）。 */
export const CLOTH = {
  seg: 4.2, // 质点间距
  grav: 10, // 重力：轻微下垂（风小的时候才看得出来）
  kn: 6, // 垂直于布身的空气阻力（1 / 秒）：布面兜风，横着推不动——所以布身跟在布头后面顺着风拖开，不沿着布头走过的路走（那是蛇）
  kt: 1.2, // 顺着布长的阻力：顺着长边滑得动，所以转弯时尾巴会顺着惯性甩出去
  sway: 380, // 大起伏的横向推力（像素 / 秒²）：几道慢波叠起来，忽这边忽那边，越往尾梢越大
  swayExp: 1.5, // 大起伏沿布长的包络 u^swayExp：布头那一截几乎不摆
  swayK: 4, // 起伏里沿布往尾梢走的那一份：一条布上几个弧度（2π = 一整个波；不到一个波，最多弯成一道缓缓的 S）
  swayW: 1.6, // 它往尾梢走的快慢（弧度 / 秒）
  flutter: 1100, // 尾梢抖动的横向推力（像素 / 秒²），只在尾梢：慢飘时轻轻地抖，飞得快时抖得猛
  bendRoot: 0.24, // 每节最多弯多少（弧度）：布头这边硬，往尾梢越来越软；有上限所以不打死结、尾梢卷不成钩
  bendTip: 0.45,
  stiffRoot: 1.2, // 每秒往直里回多少：布头这边挺，尾梢软
  stiffTip: 0.3,
  damp: 0.9, // 跟随领头（DFTL）的速度补偿
  vmax: 520,
  h: 1 / 120, // 子步长
};

/**
 * 布的翻面（弧度、秒）。扁的布在风里总想平着：平时正面朝外，隔几秒自己慢慢翻一圈；
 * 转急弯、猛加速时布头被带着翻过去，翻面再一节一节传到尾梢（飞得快传得快），不会一直沿着布往后走。
 */
export const ROLL = {
  turn: 450, // 布头的横向加速度（像素 / 秒²）超过这么多才被带着翻（空闲时绕「8」字、跟着主人走都转不到这么急）
  push: 650, // 顺着飞的方向猛加速（像素 / 秒²）超过这么多也会翻
  gain: 0.014, // 超出的部分每 1 像素 / 秒² 每秒带着翻多少（弧度）：掠过敌群后兜回来的那个弯正好翻过去一次
  fast: 8, // 被带着翻时最快每秒翻多少
  back: 5, // 不再被带着时，每秒往正面回多少（翻过一小半的接着翻完，不往回拧）
  idle: [4.5, 9], // 空闲时隔多久自己慢慢翻一圈（秒，在这两个数之间）
  slow: 6.5, // 自己翻的那一圈每秒翻多少（一圈约一秒）
  c0: 60, // 翻面从布头传到尾梢的速度：c0 + c1 × 布头的速度（像素 / 秒）
  c1: 0.6,
  smooth: 0.06, // 算转弯、加速用的布头速度先平滑这么久（秒），免得帧间抖动当成急转
};

/**
 * 尾梢翻过去的那一截（按布长算比例，长过 100 像素的按 100 算）：at 是翻转处，在原地挪 ±wander；w 是一道翻转有多长；
 * gain 越大越跟着大起伏翻；bias 越大，尾梢翻过去（露出反面）的时候越多；every：更长的布往后每隔多少像素再一道。
 * flat：正面、反面各平平地多停一会儿（扁的布在风里总想平着）。
 */
export const STAND = { at: 0.6, wander: 0.08, w: 0.26, gain: 1.4, bias: -0.1, flat: 0.12, every: 46 };

/** 布身大起伏的那一阵风这时往哪边推（-1.1 … 1.1，几道频率互不成倍的慢波叠起来）：ClothBody 的推力和尾梢的翻转共用。 */
const swayPhase = (t: number, ph: number) => 0.7 * Math.sin(1.07 * t + ph) + 0.4 * Math.sin(0.43 * t + 2.3 * ph);

/** 一条布：0 号点是布头（钉在混天绫的位置上），后面的点有速度、受风和重力、被前一个点以定长拉着。 */
export class ClothTail {
  readonly n: number;
  readonly len: number;
  readonly ph: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly qx: Float32Array; // 这一子步预测的位置
  readonly qy: Float32Array;
  readonly cx: Float32Array; // 这一子步被定长拉回的那一截（下一节的速度补偿用）
  readonly cy: Float32Array;
  readonly rl: Float32Array; // 每个点翻到了哪儿（弧度，0 / 2π… 是正面朝外）：布头翻过的，一节一节传下来
  constructor(len: number, ph: number) {
    const n = Math.max(4, Math.round(len / CLOTH.seg) + 1);
    this.n = n;
    this.len = len;
    this.ph = ph;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.qx = new Float32Array(n);
    this.qy = new Float32Array(n);
    this.cx = new Float32Array(n);
    this.cy = new Float32Array(n);
    this.rl = new Float32Array(n);
  }
  get seg() {
    return this.len / (this.n - 1);
  }
  /**
   * 弧长 s 处的扭转角（0 = 正面正对着看的人，π = 反面）：这个点翻到的角度，压成「正面、反面各平平地停一段，
   * 中间快快地翻过去」（翻面处侧过来成一条线）；加一点慢慢的倾侧（光泽跟着布的朝向变，但不沿着布走）；
   * 快的时候尾梢再快速地来回翻。
   */
  twist(s: number, t: number, flutter: number) {
    const f = clamp(s / this.seg, 0, this.n - 1);
    const i = Math.min(this.n - 2, Math.floor(f));
    const u = s / this.len;
    // 尾梢那一截跟着布身的大起伏翻：往这边兜风时翻过去露出反面，兜回来时翻回正面（翻转处侧成一条线，
    // 只在原地慢慢挪，不沿着布往尾梢走）。所以尾梢比布头翻得多，布头那一截一直平平地正面朝外。
    // 翻转处按布长摆：混天绫本体（60 像素以内）只有尾梢那一道；过场里的长绫（近景，又长又宽）翻转处也拉长一些，
    // 往后每 S.every 像素再一道，一正一反
    const S = STAND;
    const Lr = Math.min(this.len, 100);
    let over = 0;
    for (let k = 0, at = S.at * Lr; at < this.len + S.w * Lr; k++, at += S.every) {
      const amt = Math.PI * smooth(0.5 + S.bias + S.gain * swayPhase(t, this.ph + k * 1.7));
      const neck = at + S.wander * Lr * Math.sin(0.37 * t + this.ph + k * 2.1);
      over += (k % 2 ? -amt : amt) * smooth((s - neck) / (S.w * Lr) + 0.5);
    }
    const r = this.rl[i] + (this.rl[i + 1] - this.rl[i]) * (f - i) + over;
    const tilt = 0.32 * Math.sin(s * 0.11 + this.ph) * (0.65 + 0.35 * Math.sin(t * 0.5 + 2 * this.ph));
    return r - S.flat * Math.sin(2 * r) + tilt + flutter * 1.6 * u * u * u * Math.sin(t * 27 - s * 0.3 + this.ph);
  }
}

/**
 * 混天绫本体：一条布，布头（0 号点）跟着模拟里混天绫的位置走、领着飞，布身自己飘。
 * 每个子步：先按相对空气的阻力（垂直布身的大、顺着布长的小）、重力、低频的大起伏、尾梢的抖动推一下速度，预测位置；
 * 再从布头往尾梢逐节拉回定长（Müller 等的 Dynamic Follow-The-Leader：一遍就严格定长，所以长度永远不变、绝不缩成一点），
 * 拉的时候每节的弯折往直里回一点、并且有上限（顺滑、不打死结）；最后按挪动的距离算速度，并补上下一节被拉回的那一截。
 * （可以有几条布从同一个布头拖出去，各飘各的；混天绫和过场里都只用一条。）
 */
export class ClothBody {
  readonly tails: ClothTail[] = [];
  t = 0;
  private hx = 0;
  private hy = 0;
  private hvx = 0; // 布头平滑过的速度（算转弯、加速）
  private hvy = 0;
  /** 布头翻到了哪儿（弧度）。 */
  roll = 0;
  private rollTo = 0; // 要翻到的那个正面（0 / 2π…）
  private rollDir = 1; // 上一次往哪边翻
  private rollRate: number = ROLL.back; // 往 rollTo 走的快慢：自己翻那一圈慢，回正快一些
  private nextRoll: number; // 离下一次自己慢慢翻一圈还有多久
  private seed: number;
  constructor(lens: readonly number[], seed = 7) {
    lens.forEach((l, k) => this.tails.push(new ClothTail(l, 1.3 + k * 0.9)));
    this.seed = Math.max(1, Math.floor(Math.abs(seed) * 7919) % 2147483646);
    this.nextRoll = ROLL.idle[0] * (0.5 + this.rnd());
  }
  /** 布自己的伪随机数（Park–Miller）：同一个种子每次飘得一样，测试和离线连拍可复现。 */
  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** 摆成从 (hx, hy) 朝 (dx, dy) 方向伸出去的样子（开局、重开、瞬移时用），正面朝外。 */
  place(hx: number, hy: number, dx: number, dy: number) {
    const a0 = Math.atan2(dy, dx);
    this.hx = hx;
    this.hy = hy;
    this.hvx = this.hvy = 0;
    this.roll = this.rollTo = 0;
    this.rollRate = ROLL.back;
    for (const T of this.tails) {
      let x = hx;
      let y = hy;
      for (let i = 0; i < T.n; i++) {
        const a = a0 + Math.sin(i * 0.45 + T.ph) * 0.12;
        if (i) {
          x += Math.cos(a) * T.seg;
          y += Math.sin(a) * T.seg;
        }
        T.x[i] = x;
        T.y[i] = y;
        T.vx[i] = 0;
        T.vy[i] = 0;
        T.rl[i] = 0;
      }
    }
  }

  /** 换长度（进化时）：沿原来的形状按新的间距重新取点（更长就顺着最后一节往外延），接着飘。 */
  resize(lens: readonly number[]) {
    for (let k = 0; k < this.tails.length; k++) {
      const old = this.tails[k];
      if (old.len === lens[k]) continue;
      const T = new ClothTail(lens[k], old.ph);
      let j = 0;
      for (let i = 0; i < T.n; i++) {
        const s = i * T.seg;
        while (j < old.n - 2 && (j + 1) * old.seg <= s) j++;
        const f = (s - j * old.seg) / old.seg;
        const near = Math.min(old.n - 1, j + (f > 0.5 ? 1 : 0));
        T.x[i] = old.x[j] + (old.x[j + 1] - old.x[j]) * f;
        T.y[i] = old.y[j] + (old.y[j + 1] - old.y[j]) * f;
        T.vx[i] = old.vx[near];
        T.vy[i] = old.vy[near];
        T.rl[i] = old.rl[j] + (old.rl[j + 1] - old.rl[j]) * Math.min(1, f);
      }
      this.tails[k] = T;
    }
  }

  /** 慢慢翻一圈（dir：往哪边翻）：进化时用。 */
  flip(dir: number) {
    this.rollDir = dir < 0 ? -1 : 1;
    this.rollTo = TAU * Math.round(this.roll / TAU) + this.rollDir * TAU;
    this.rollRate = ROLL.slow * 1.3;
    this.nextRoll = Math.max(this.nextRoll, ROLL.idle[0]);
  }

  /** 推进 dt 秒：布头被拉到 (hx, hy)。按 1/120 秒的子步走（掉帧时多走几步），布头在这一帧里匀速挪过去。 */
  step(dt: number, hx: number, hy: number, env: ClothEnv) {
    if (dt <= 0) return;
    const m = Math.min(12, Math.max(1, Math.ceil(dt / CLOTH.h - 1e-6)));
    const h = dt / m;
    const x0 = this.hx;
    const y0 = this.hy;
    const rvx = (hx - x0) / dt;
    const rvy = (hy - y0) / dt;
    this.turn(dt, rvx, rvy);
    for (let k = 1; k <= m; k++) {
      this.t += h;
      this.sub(h, x0 + ((hx - x0) * k) / m, y0 + ((hy - y0) * k) / m, rvx, rvy, env);
    }
    this.hx = hx;
    this.hy = hy;
  }

  /** 布头的翻面：转急弯、猛加速时被带着翻过去，之后回到正面；空闲时隔几秒自己慢慢翻一圈。再一节一节传到尾梢。 */
  private turn(dt: number, vx: number, vy: number) {
    const P = ROLL;
    const jump = Math.hypot(vx, vy) > 900; // 瞬移（重开、换位置）：不算急转
    const k = 1 - Math.exp(-dt / P.smooth);
    const ox = this.hvx;
    const oy = this.hvy;
    if (!jump) {
      this.hvx += (vx - this.hvx) * k;
      this.hvy += (vy - this.hvy) * k;
    }
    const sp = Math.hypot(this.hvx, this.hvy);
    let drive = 0;
    let dir = this.rollDir;
    if (!jump && sp > 1) {
      const ax = (this.hvx - ox) / dt;
      const ay = (this.hvy - oy) / dt;
      const ux = this.hvx / sp;
      const uy = this.hvy / sp;
      const lat = ay * ux - ax * uy; // 横向（向心）加速度，带符号：往哪边拐
      const lon = ax * ux + ay * uy; // 顺着飞的方向的加速度
      const over = Math.max(0, Math.abs(lat) - P.turn) + Math.max(0, lon - P.push);
      if (over > 0) {
        drive = Math.min(P.fast, over * P.gain);
        if (Math.abs(lat) > P.turn) dir = lat > 0 ? 1 : -1;
      }
    }
    if (drive > 0) {
      this.rollDir = dir;
      this.roll += dir * drive * dt;
      this.rollRate = P.back;
      // 翻过一小半的接着翻完，没翻到的翻回来
      this.rollTo = TAU * Math.round(this.roll / TAU + dir * 0.2);
      this.nextRoll = Math.max(this.nextRoll, P.idle[0]);
    } else {
      this.nextRoll -= dt;
      if (this.nextRoll <= 0 && Math.abs(this.rollTo - this.roll) < 1e-3) {
        this.rollDir = this.rnd() < 0.5 ? -1 : 1;
        this.rollTo += this.rollDir * TAU;
        this.rollRate = P.slow;
        this.nextRoll = P.idle[0] + (P.idle[1] - P.idle[0]) * this.rnd();
      }
      const d = this.rollTo - this.roll;
      const st = this.rollRate * dt;
      this.roll += Math.abs(d) <= st ? d : Math.sign(d) * st;
    }
    // 一节一节传下去：每个点追着前一个点翻（追的快慢 = 传播速度 / 节长）
    const c = P.c0 + P.c1 * sp;
    for (const T of this.tails) {
      T.rl[0] = this.roll;
      const q = 1 - Math.exp((-dt * c) / T.seg);
      for (let i = 1; i < T.n; i++) T.rl[i] += (T.rl[i - 1] - T.rl[i]) * q;
    }
    // 翻了很多圈以后整体减掉整圈数（看上去一样），免得数越来越大
    if (Math.abs(this.rollTo) > 4 * Math.PI) {
      const K = TAU * Math.round(this.rollTo / TAU);
      this.roll -= K;
      this.rollTo -= K;
      for (const T of this.tails) for (let i = 0; i < T.n; i++) T.rl[i] -= K;
    }
  }

  private sub(h: number, rx: number, ry: number, rvx: number, rvy: number, env: ClothEnv) {
    const P = CLOTH;
    const t = this.t;
    const dn = Math.exp(-P.kn * h);
    const dl = Math.exp(-P.kt * h);
    // 1. 预测：相对空气的阻力、重力、大起伏、尾梢抖动
    for (const T of this.tails) {
      const { n, x, y, vx, vy, qx, qy } = T;
      const L = T.len;
      const ph = T.ph;
      x[0] = qx[0] = rx;
      y[0] = qy[0] = ry;
      vx[0] = rvx;
      vy[0] = rvy;
      // 大起伏：几道频率互不成倍的慢波叠起来——整条布一阵往这边兜、一阵往那边兜，间或弯成一道缓缓的 S；
      // 布头那一截几乎不摆，越往尾梢摆得越大（不是从头到尾一样大的规整正弦波，那是蛇）
      const g1 = swayPhase(t, ph);
      const g2 = 0.6 * Math.sin(0.71 * t + 0.6 * ph) * Math.sin(0.29 * t + 1.7 * ph);
      for (let i = 1; i < n; i++) {
        const u = i / (n - 1);
        const s = u * L;
        let tx = x[i] - x[i - 1];
        let ty = y[i] - y[i - 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const ax = vx[i] - env.wx;
        const ay = vy[i] - env.wy;
        const vt = ax * tx + ay * ty;
        const nx = ax - vt * tx;
        const ny = ay - vt * ty;
        const lat =
          P.sway * env.sway * Math.pow(u, P.swayExp) * (g1 + g2 * Math.sin(P.swayK * u - P.swayW * t + ph)) +
          P.flutter * env.flutter * Math.sin(41 * t - (5.5 * s) / L + ph) * u * u;
        let wvx = env.wx + vt * dl * tx + nx * dn - ty * lat * h;
        let wvy = env.wy + vt * dl * ty + ny * dn + (tx * lat + P.grav) * h;
        const sp = Math.hypot(wvx, wvy);
        if (sp > P.vmax) {
          wvx *= P.vmax / sp;
          wvy *= P.vmax / sp;
        }
        vx[i] = wvx;
        vy[i] = wvy;
        qx[i] = x[i] + wvx * h;
        qy[i] = y[i] + wvy * h;
      }
    }
    // 2. 从布头往尾梢逐节拉回定长；第一节绕着布头自由转（布头是布的一端，没有别的东西拧着它）
    for (const T of this.tails) {
      const { n, qx, qy, cx, cy } = T;
      const seg = T.seg;
      let pa = 0;
      for (let i = 1; i < n; i++) {
        const u = i / (n - 1);
        let a = Math.atan2(qy[i] - qy[i - 1], qx[i] - qx[i - 1]);
        if (i > 1) {
          let b = wrapAngle(a - pa);
          const lim = P.bendRoot + (P.bendTip - P.bendRoot) * u;
          b *= Math.exp(-(P.stiffRoot + (P.stiffTip - P.stiffRoot) * u) * h);
          if (b > lim) b = lim;
          else if (b < -lim) b = -lim;
          a = pa + b;
        }
        const X = qx[i - 1] + Math.cos(a) * seg;
        const Y = qy[i - 1] + Math.sin(a) * seg;
        cx[i] = X - qx[i];
        cy[i] = Y - qy[i];
        qx[i] = X;
        qy[i] = Y;
        pa = a;
      }
    }
    // 3. 速度 = 挪动的距离 / 子步长，再补上下一节被拉回的那一截（不然布身被拖得发「黏」）
    for (const T of this.tails) {
      const { n, x, y, vx, vy, qx, qy, cx, cy } = T;
      for (let i = 1; i < n; i++) {
        const ncx = i + 1 < n ? cx[i + 1] : 0;
        const ncy = i + 1 < n ? cy[i + 1] : 0;
        vx[i] = (qx[i] - x[i] - P.damp * ncx) / h;
        vy[i] = (qy[i] - y[i] - P.damp * ncy) / h;
        x[i] = qx[i];
        y[i] = qy[i];
      }
    }
  }

  /** 甩一下（掠过时头一回缠上敌人的那一下）：布身往一侧抽一下，越往尾梢抽得越猛，之后自己荡回来。 */
  kick(strength: number) {
    for (const T of this.tails)
      for (let i = 1; i < T.n; i++) {
        const u = i / (T.n - 1);
        const tx = T.x[i] - T.x[i - 1];
        const ty = T.y[i] - T.y[i - 1];
        const d = Math.hypot(tx, ty) || 1;
        T.vx[i] += (-ty / d) * strength * 90 * u;
        T.vy[i] += (tx / d) * strength * 90 * u;
      }
  }
}

/**
 * 混天绫本体这一帧的风：慢的时候是一阵一阵往身后（离开主人的那一侧）、略往上吹的微风（风向自己也慢慢摆），
 * 布身大起伏；飞起来以后相对空气的风主要来自自己的速度（ClothBody 按相对速度算阻力），起伏收小、尾梢抖起来。
 * side 是混天绫飘在主人哪一侧（-1 左 … 1 右），(vx, vy) 是它现在的速度，k 是平滑过的快慢（0 慢 … 1 快），t 是时间。
 */
export function petWind(side: number, vx: number, vy: number, k: number, t: number, out: ClothEnv): ClothEnv {
  const P = WIND;
  const speed = Math.hypot(vx, vy);
  // 一阵一阵：几道频率互不成倍的慢波叠起来，强弱和方向都不规律地变
  const gust = 1 + P.gust * (0.6 * Math.sin(t * 0.71 + 1) + 0.3 * Math.sin(t * 1.37 + 2.3) + 0.2 * Math.sin(t * 2.29));
  // 风向：往身后吹，往上的那一份慢慢地变（只在「平」和「往上」之间摆，不往下吹，免得布被压成垂下来的一条）
  const up = Math.max(-0.05, P.lift + P.wobble * (Math.sin(t * 0.53 + 2) + 0.5 * Math.sin(t * 1.13)));
  const a = Math.atan2(-up, side);
  const B = P.breeze * gust;
  // 空闲时混天绫在身后慢慢漂，布身只吃到它一部分的漂移（像带着一团自己的风）：顺风漂的时候不至于一下子垂下来
  const carry = P.carry * (1 - k);
  out.wx = Math.cos(a) * B + vx * carry;
  out.wy = Math.sin(a) * B + vy * carry;
  out.sway = 1 - 0.55 * k;
  out.flutter = P.flutter + (1 - P.flutter) * smooth((speed - 70) / 120);
  return out;
}

/** 混天绫身边的风（像素 / 秒、弧度）。 */
export const WIND = {
  breeze: 36, // 微风的风速
  carry: 0.7, // 空闲时布身跟着混天绫的漂移一起走的那一份（0 = 全按相对空气算）
  gust: 0.22, // 一阵一阵：风速上下浮动的幅度（比例）
  lift: 0.3, // 往上吹多少（往身后吹 1 的时候往上吹这么多）
  wobble: 0.3, // 风向来回摆的幅度
  flutter: 0.3, // 慢飘的时候尾梢也轻轻地抖（快的时候抖到 1）
};

// ---------- 布的栅格化 ----------

// 光从左上前方来：LX / LY 是屏幕里的方向（受光的一边是外法线朝左上的那一边），LZ 是正对着看的人的那一份
const LX = -0.37;
const LY = -0.93;
const LZ = 0.75;
const LXY = Math.sqrt(1 - LZ * LZ);

const MAXC = 2048;

/**
 * 布的中心线采样：可以拼几条（一条布尾一条，后加的压在先加的上面），每个采样点带切线、弧长、扭转、屏幕上的半宽和受光。
 */
export class ClothSpine {
  n = 0;
  readonly x = new Float32Array(MAXC);
  readonly y = new Float32Array(MAXC);
  readonly tx = new Float32Array(MAXC);
  readonly ty = new Float32Array(MAXC);
  readonly s = new Float32Array(MAXC); // 这一条上的弧长
  readonly hw = new Float32Array(MAXC); // 屏幕上的半宽
  readonly ct = new Float32Array(MAXC); // 扭转角的余弦：>0 正面朝外，越接近 0 越侧
  readonly fe = new Float32Array(MAXC); // 布面「正对」的程度（0..1，算上急弯处的侧身）：纹样只在够宽处露出来
  readonly lum = new Float32Array(MAXC); // 朝外那一面的受光（-1..1）
  readonly strip = new Uint8Array(MAXC);
  readonly first: number[] = [];
  readonly len: number[] = [];
  strips = 0;

  reset() {
    this.n = 0;
    this.strips = 0;
    this.first.length = 0;
    this.len.length = 0;
    return this;
  }
  last(k: number) {
    return k + 1 < this.strips ? this.first[k + 1] - 1 : this.n - 1;
  }
  private open() {
    this.first[this.strips] = this.n;
  }
  private push(x: number, y: number) {
    if (this.n >= MAXC) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.s[i] = i > this.first[this.strips] ? this.s[i - 1] + Math.hypot(x - this.x[i - 1], y - this.y[i - 1]) : 0;
    this.strip[i] = this.strips;
  }
  private close() {
    const f = this.first[this.strips];
    const e = this.n - 1;
    for (let i = f; i <= e; i++) {
      const a = Math.max(f, i - 1);
      const b = Math.min(e, i + 1);
      const dx = this.x[b] - this.x[a];
      const dy = this.y[b] - this.y[a];
      const d = Math.hypot(dx, dy) || 1;
      this.tx[i] = dx / d;
      this.ty[i] = dy / d;
    }
    this.len[this.strips] = e >= f ? this.s[e] : 0;
    return this.strips++;
  }

  /** 加一条：节点（根在前）→ Catmull-Rom 平滑曲线，约 step 像素一个采样点。返回这一条的编号。 */
  addNodes(px: ArrayLike<number>, py: ArrayLike<number>, count: number, step = 0.4) {
    this.open();
    for (let i = 0; i < count - 1; i++) {
      const i0 = Math.max(0, i - 1);
      const i3 = Math.min(count - 1, i + 2);
      const x0 = px[i0], y0 = py[i0], x1 = px[i], y1 = py[i], x2 = px[i + 1], y2 = py[i + 1], x3 = px[i3], y3 = py[i3];
      const m = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
      for (let j = i === 0 ? 0 : 1; j <= m; j++) {
        const t = j / m;
        const t2 = t * t;
        const t3 = t2 * t;
        this.push(
          0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
          0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
        );
      }
    }
    return this.close();
  }

  /** 加一条任意参数曲线 f(u)（u 从 0 到 1，0 是根）。 */
  addCurve(f: (u: number, out: [number, number]) => void, approxLen: number, step = 0.4) {
    this.open();
    const m = Math.max(2, Math.ceil(approxLen / step));
    const p: [number, number] = [0, 0];
    for (let j = 0; j <= m; j++) {
      f(j / m, p);
      this.push(p[0], p[1]);
    }
    return this.close();
  }

  /**
   * 给第 k 条定形：w 是布宽（正对着看时），twist(s, u) 是扭转角。屏幕上的宽 = 布宽 × |cos 扭转|，侧过来时剩一像素的线；
   * 急弯处再侧过来一些——扁的布在自己的平面里弯不动，看上去弯得急的地方一定是侧着的，也免得宽布在弯里挤成一团。
   */
  shape(k: number, w: number, twist: (s: number, u: number) => number) {
    const f = this.first[k];
    const e = this.last(k);
    const L = this.len[k] || 1;
    for (let i = f; i <= e; i++) {
      const th = twist(this.s[i], this.s[i] / L);
      const c = Math.cos(th);
      const a = Math.max(f, i - 3);
      const b = Math.min(e, i + 3);
      const ds = this.s[b] - this.s[a];
      const cr = this.tx[a] * this.ty[b] - this.ty[a] * this.tx[b];
      const dt = this.tx[a] * this.tx[b] + this.ty[a] * this.ty[b];
      const kap = ds > 0.01 ? Math.abs(Math.atan2(cr, dt)) / ds : 0;
      const fe = Math.abs(c) * (1 - 0.65 * clamp((kap - 0.06) / 0.12, 0, 1));
      this.ct[i] = c;
      this.fe[i] = fe;
      this.hw[i] = Math.max(1, w * fe) / 2;
      // 受光：布面的法线 = cos 扭转（朝看的人）+ sin 扭转（朝中心线的一侧），光从左上前方来
      const l3 = c * LZ + Math.sin(th) * (-this.ty[i] * LX + this.tx[i] * LY) * LXY;
      this.lum[i] = c >= 0 ? l3 : -l3;
    }
  }
}

export interface ClothDraw {
  /** 纹样密度（0 不画）：正面上的金色纹样，按布面上的位置画，跟着翻转压扁、侧过去时消失。 */
  gold?: number;
  /** 尾梢渐隐的长度（像素）：最后这么长一档比一档轻、透。 */
  fade?: number;
  /** 燕尾的深度（像素，0 = 方口）。 */
  notch?: number;
  /** 尾梢那头的金边离末端多远（像素，0 不画）。 */
  hem?: number;
  /** 火焰的时间（只有火绫用）；undefined 不画火焰。 */
  flame?: number;
  /**
   * 每条的起点是布头：一道剪口（不收圆、不收窄）。不压金边——小布带的布头上一道金（不管亮暗）看着像火柴头、
   * 像一对眼睛（用户：不能像蛇头）。slant 是剪口的斜度：横着每偏一像素，剪口往后退多少像素（0 = 剪得平直）。
   */
  head?: boolean;
  slant?: number;
  /** 布面在屏幕上至少这么宽（像素）才画背光边；更窄的布不画（三像素宽的布一边亮一边暗，就成了圆管）。 */
  edgeMin?: number;
  /** 布面至少这么宽才画受光边（默认同 edgeMin）：一道亮边贴着布的一侧，是扁的布边迎着光。 */
  edgeHi?: number;
}

/** 同一条布上弧长相差这么多的两段叠在一起，就是折过来交叠了：后面那段压在上面，不再按「离谁近」分像素。 */
const GAP = 12;

/**
 * 把布的中心线画成扁平的布：先按「离中心线最近的采样点」给每个像素归属（叠在一起的两层，上层得像素），
 * 再按正反面、受光、边、折痕、纹样着色；上层的边压在下层上，下层沿着它暗一线（看得出是叠着的）。像素级逐点绘制。
 */
export function drawCloth(pix: Pix, cs: ClothSpine, st: RibbonStyle, o: ClothDraw = {}) {
  const { n } = cs;
  if (n < 2) return;
  const W = pix.w;
  const H = pix.h;
  // 1. 包围盒（缓冲内坐标）
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) {
    const r = cs.hw[i] + 1;
    if (cs.x[i] - r < x0) x0 = cs.x[i] - r;
    if (cs.y[i] - r < y0) y0 = cs.y[i] - r;
    if (cs.x[i] + r > x1) x1 = cs.x[i] + r;
    if (cs.y[i] + r > y1) y1 = cs.y[i] + r;
  }
  const fl = o.flame !== undefined ? 4 : 0;
  const bx0 = Math.max(0, Math.floor(x0) - pix.ox - 2 - fl);
  const by0 = Math.max(0, Math.floor(y0) - pix.oy - 2 - fl);
  const bx1 = Math.min(W - 1, Math.ceil(x1) - pix.ox + 2 + fl);
  const by1 = Math.min(H - 1, Math.ceil(y1) - pix.oy + 2);
  if (bx0 > bx1 || by0 > by1) return;
  const { dist, idx, c } = pix;
  const A = pix.a;
  pix.touch(bx0, by0, bx1, by1);
  for (let y = by0; y <= by1; y++)
    for (let x = bx0, k = y * W + bx0; x <= bx1; x++, k++) {
      dist[k] = 99;
      idx[k] = -1;
    }
  const notch = o.notch ?? 0;
  const head = o.head ? (o.slant ?? 0) : 0;
  // 2. 逐个采样点往两侧铺满半宽（dist 存带符号的横向偏移）
  for (let i = 0; i < n; i++) {
    const hw = cs.hw[i];
    const nx = -cs.ty[i];
    const ny = cs.tx[i];
    const sk = cs.strip[i];
    const L = cs.len[sk];
    const s = cs.s[i];
    // 燕尾：末端 notch 像素里，中间挖掉一个越来越深的 V（布够宽时才挖；侧着时就是一条线，一直画到头）
    const cut = notch > 0 && hw >= 1.5 && s > L - notch ? (s - (L - notch)) / notch : 0;
    const m = Math.max(1, Math.ceil((hw * 2) / 0.45));
    for (let j = 0; j <= m; j++) {
      const v = -hw + (2 * hw * j) / m;
      if (cut > 0 && Math.abs(v) < cut * hw - 0.25) continue;
      // 布头：一道略斜的剪口（一角比另一角长出一两个像素），一看就是剪开的布边，不是圆圆的头
      if (head > 0 && s < (v + hw) * head) continue;
      const X = Math.round(cs.x[i] + nx * v) - pix.ox;
      const Y = Math.round(cs.y[i] + ny * v) - pix.oy;
      if (X < bx0 || Y < by0 || X > bx1 || Y > by1) continue;
      const k = Y * W + X;
      const q = idx[k];
      // 后加的条压在先加的上面；同一条上折过来的后一段压在前一段上面；同一段里离中心线近的那个采样点得这个像素
      if (q >= 0 && cs.strip[q] === sk && s - cs.s[q] < GAP && Math.abs(v) >= Math.abs(dist[k])) continue;
      idx[k] = i;
      dist[k] = v;
    }
  }
  const same = (k: number, i: number) => {
    const q = idx[k];
    return q >= 0 && cs.strip[q] === cs.strip[i] && Math.abs(cs.s[q] - cs.s[i]) < GAP;
  };
  const above = (k: number, i: number) => {
    const q = idx[k];
    if (q < 0) return false;
    const a = cs.strip[q];
    const b = cs.strip[i];
    return a > b || (a === b && cs.s[q] - cs.s[i] >= GAP);
  };
  const gold = o.gold ?? 0;
  const fade = o.fade ?? 0;
  const hem = o.hem ?? 0;
  const edgeMin = o.edgeMin ?? 0;
  const edgeHi = o.edgeHi ?? edgeMin;
  /** 弧长 s 处（这一条长 L）的透明度档位：末端 fade 像素里一档比一档透。 */
  const lvlAt = (s: number, L: number) => {
    if (fade <= 0) return 0;
    const r = (L - s) / fade;
    return r >= 1 ? 0 : r > 0.4 ? 1 : 2;
  };
  // 3. 着色
  for (let y = by0; y <= by1; y++)
    for (let x = bx0, k = y * W + bx0; x <= bx1; x++, k++) {
      const i = idx[k];
      if (i < 0) continue;
      const L = cs.len[cs.strip[i]];
      const s = cs.s[i];
      const lv = lvlAt(s, L);
      A[k] = lv;
      const hw = cs.hw[i];
      const ct = cs.ct[i];
      const front = ct >= 0;
      const fe = cs.fe[i];
      const lm = cs.lum[i];
      const Fc = front ? st.clothFront[lm > 0.9 ? 2 : lm > 0.45 ? 1 : 0] : st.clothBack[lm > 0.6 ? 1 : 0];
      const edge = !(x > bx0 && same(k - 1, i) && x < bx1 && same(k + 1, i) && y > by0 && same(k - W, i) && y < by1 && same(k + W, i));
      const under = (x > bx0 && above(k - 1, i)) || (x < bx1 && above(k + 1, i)) || (y > by0 && above(k - W, i)) || (y < by1 && above(k + W, i));
      const nx = -cs.ty[i];
      const ny = cs.tx[i];
      // 像素中心离它所属采样点的横向偏移（准的；铺像素时记下的偏移偏向中心线，不能拿来分行）
      const v = (x + pix.ox - cs.x[i]) * nx + (y + pix.oy - cs.y[i]) * ny;
      const sd = v > 0.3 ? 1 : v < -0.3 ? -1 : 0;
      const lit = sd !== 0 && sd * (nx * LX + ny * LY) > 0.08;
      let col = Fc.body;
      if (edge && lit && 2 * hw >= edgeHi) col = Fc.hi;
      else if (edge && sd !== 0 && !lit && 2 * hw >= edgeMin) col = Fc.lo;
      if (Math.abs(ct) < 0.28) col = st.crease[front ? 0 : 1]; // 侧过来的地方：一道暗的折痕
      else if (hem > 0 && s > L - hem - 1 && s <= L - hem && fe > 0.45) col = front ? st.gold : st.goldLo; // 尾梢那头的金边
      else if (front && gold > 0 && fe > 0.55 && hw >= 1.75 && s > 12 && s < L - 6 && !(edge && sd !== 0) && !under) {
        // 金色纹样只在布够宽、离布头远的地方露出来：窄布上一粒粒金点排成一行，像蛇的花纹
        const g = motif(st.pattern, s, v, hw, gold);
        if (g) col = g === 2 ? st.goldHi : g === 3 ? st.goldLo : st.gold;
      }
      if (under) col = DARKER[col] || col;
      // 末端：越往后越轻——颜色往亮里提一档（再加上透明，铺在什么底色上都是浅浅的一抹，不发灰）
      c[k] = lv >= 2 ? LIGHTER[col] || col : col;
    }
  // 4. 火绫：受光边上一簇簇火舌（底宽两像素，往上收成一点，忽高忽矮），长在布上固定的地方、原地跳动，
  // 不沿着布往后走（用户不要「流动」的感觉）；布侧过去的地方不起火
  if (o.flame !== undefined) {
    const t = o.flame;
    const SP = 7.5;
    for (let sk = 0; sk < cs.strips; sk++) {
      const f = cs.first[sk];
      const e = cs.last(sk);
      const L = cs.len[sk];
      let i = f;
      // 布头那一截不起火（亮黄的火舌贴着布头像一对眼睛）；火舌之间疏密不匀（一样密的一排像毛虫背上的刺）
      for (let id = sk * 7, sj = 8; sj < L - 3; id++, sj += SP + 2.6 * Math.sin(id * 2.7 + 1)) {
        while (i < e && cs.s[i] < sj) i++;
        if (cs.fe[i] < 0.4) continue;
        const nx = -cs.ty[i];
        const ny = cs.tx[i];
        const sg = nx * LX + ny * LY >= 0 ? 1 : -1;
        const hw = cs.hw[i] + 0.5;
        const ex = Math.round(cs.x[i] + nx * sg * hw);
        const ey = Math.round(cs.y[i] + ny * sg * hw);
        const flk = Math.sin(id * 2.3 + t * 13) * 0.5 + 0.5;
        const h = Math.max(1, Math.min(sj > L * 0.75 ? 1 : 3, Math.floor(flk * 3.99)));
        const lean = id % 2 ? 1 : 0;
        const lv = lvlAt(sj, L);
        const put = (X: number, Y: number, code: number) => {
          X -= pix.ox;
          Y -= pix.oy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) return;
          const k = Y * W + X;
          if (idx[k] >= 0) return;
          c[k] = code;
          A[k] = lv;
          pix.touch(X, Y, X, Y);
        };
        // 火舌：贴着布的根部最亮（缃），往上是橘（只用暖的亮色，尖上不点暗红，免得一根根像刺）
        put(ex, ey, C('Y'));
        if (h >= 2) put(ex + (cs.tx[i] > 0 ? -1 : 1), ey, C('Y'));
        if (h >= 2) put(ex - lean, ey - 1, C('o'));
        if (h >= 3) put(ex - lean, ey - 2, C('o'));
      }
    }
  }
}

/**
 * 正面上的金色纹样。s 是弧长，v 是离中心线的横向偏移（像素，带符号），hw 是这里屏幕上的半宽——布侧过去时 hw 变小，
 * 纹样按 v / hw（布面上的位置）画，所以跟着压扁、侧过去时消失。返回 0 不画、1 金、2 亮金、3 暗金。
 * 云纹：一朵朵小菱花（中间一粒亮金），越进化越密；缚龙：贴着两道布边各一道金线（一段段绣上去的，隔一段亮一粒），
 * 中间一行暗金的人字鳞；火绫：疏疏的金点。
 */
function motif(pattern: RibbonStyle['pattern'], s: number, v: number, hw: number, gold: number): number {
  const av = Math.abs(v);
  const am = av / hw;
  if (pattern === 'scale') {
    // 窄布（混天绫本体）：只在中线上疏疏地钉一粒金。一行密密的鳞纹在窄布上就是蛇背上的花纹
    if (hw < 2.6) return av < 0.5 && ((s % 10) + 10) % 10 < 1 ? 1 : 0;
    if (hw >= 2.6 && av > hw - 1.5) {
      const r = ((s % 9) + 9) % 9;
      return r < 1 ? 2 : 1;
    }
    if (av > hw - 1.5) return 0;
    const P = 5;
    const r = ((s % P) + P) % P;
    // 一片鳞是一个朝尾梢的「›」：中线上靠后一格，两边靠前一格
    return av < 0.5 ? (r >= 1 && r < 2 ? 1 : 0) : av < 1.5 && r < 1 ? 1 : 0;
  }
  if (pattern === 'flame') {
    if (hw < 2.6) return 0; // 窄布上有火舌就够了，再点金点就花了
    const P = 9;
    const r = ((s % P) + P) % P;
    return am < 0.3 && r < 1 ? 2 : 0;
  }
  const P = 15 - 2.4 * gold;
  const r = ((s % P) + P) % P;
  if (gold < 1.2) return am < 0.3 && r < 1 ? 2 : 0; // 第一阶：疏疏的一粒粒亮金
  if (am < 0.3) return r < 3 ? (r >= 1 && r < 2 ? 2 : 1) : 0;
  if (am < 0.66) return r >= 1 && r < 2 ? 1 : 0;
  return 0;
}

// ---------- 混天绫本体 ----------

export interface PetLook {
  t: number; // 时间（秒）
  stage: number;
  flutter?: number; // 0..1：尾梢抖动（快的时候翻得也快）
}

const petCloth = new ClothSpine();
/** 本体的画法：布头剪口的斜度、受光边 / 背光边从多宽起画（见 ClothDraw）。 */
export const PETLOOK = { slant: 0.55, edgeHi: 3, edgeMin: 5 };

/**
 * 把混天绫本体（ClothBody）画进缓冲：布头一道略斜的剪口，布尾燕尾、末端轻透；进化以后尾梢那头压一道金边。
 * 没有沿着布跑的光泽（2026-11-10 用户：「不需要红色流动的这个特效」）。
 */
export function drawPetCloth(pix: Pix, body: ClothBody, st: RibbonStyle, o: PetLook) {
  const cs = petCloth.reset();
  const stage = Math.min(st.width.length - 1, o.stage);
  const w = st.width[stage];
  const fl = o.flutter ?? 0;
  for (let k = body.tails.length - 1; k >= 0; k--) {
    const T = body.tails[k];
    const id = cs.addNodes(T.x, T.y, T.n, 0.4);
    cs.shape(id, w, (s) => T.twist(s, body.t, fl));
  }
  drawCloth(pix, cs, st, {
    gold: 1 + o.stage * 0.25,
    fade: 6,
    notch: Math.min(3, w * 0.7),
    hem: o.stage >= 1 ? 3 : 0,
    flame: st.pattern === 'flame' ? o.t : undefined,
    head: true,
    slant: PETLOOK.slant,
    edgeMin: PETLOOK.edgeMin,
    edgeHi: PETLOOK.edgeHi,
  });
  return cs;
}

// ---------- 绸带的中心线（被缠住的敌人身上的红绫用） ----------

const MAX_SAMPLES = 4096;

/** 绸带的中心线：按约 step 像素一个采样点，带切线、弧长、半宽和「朝向」（>0 亮面朝外，<0 背光面朝外）。 */
export class Spine {
  n = 0;
  len = 0;
  readonly x = new Float32Array(MAX_SAMPLES);
  readonly y = new Float32Array(MAX_SAMPLES);
  readonly tx = new Float32Array(MAX_SAMPLES);
  readonly ty = new Float32Array(MAX_SAMPLES);
  readonly s = new Float32Array(MAX_SAMPLES);
  readonly hw = new Float32Array(MAX_SAMPLES);
  readonly face = new Float32Array(MAX_SAMPLES);
  readonly lum = new Float32Array(MAX_SAMPLES);

  private push(x: number, y: number) {
    if (this.n >= MAX_SAMPLES) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.s[i] = i ? this.s[i - 1] + Math.hypot(x - this.x[i - 1], y - this.y[i - 1]) : 0;
  }

  private finish() {
    const { n } = this;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let dx = this.x[b] - this.x[a];
      let dy = this.y[b] - this.y[a];
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      this.tx[i] = dx;
      this.ty[i] = dy;
    }
    this.len = n ? this.s[n - 1] : 0;
  }

  /** 任意参数曲线 f(u)，u 从 0 到 1（u = 0 是头）。 */
  fromCurve(f: (u: number, out: [number, number]) => void, approxLen: number, step = 0.4) {
    this.n = 0;
    const m = Math.max(2, Math.ceil(approxLen / step));
    const p: [number, number] = [0, 0];
    for (let j = 0; j <= m; j++) {
      f(j / m, p);
      this.push(p[0], p[1]);
    }
    this.finish();
    return this;
  }

  /**
   * 设半宽与扭转：width(s, u) 是全宽，twist(s, u) 是绸带绕自身长轴扭过的角度（0 = 亮面正对着看的人）。
   * face 是扭转角的余弦（>0 亮面朝外，越接近 0 越侧、越窄），lum 是朝外那一面的受光程度（光从斜上方来）。
   */
  shape(width: (s: number, u: number) => number, twist: (s: number, u: number) => number) {
    const { n, len } = this;
    for (let i = 0; i < n; i++) {
      const s = this.s[i];
      const u = len ? s / len : 0;
      const th = twist(s, u);
      const f = Math.cos(th);
      this.face[i] = f;
      const l = Math.cos(th - 0.45);
      this.lum[i] = f >= 0 ? l : -l;
      this.hw[i] = Math.max(0.5, width(s, u) * (0.3 + 0.7 * Math.abs(f))) / 2;
    }
  }
}

// ---------- 绸带的栅格化（被缠住的敌人身上的红绫用） ----------

export interface RibbonDraw {
  /** 金纹密度（0 不画）。 */
  gold?: number;
  /** 外描边（被缠住的敌人身上的几道由 drawWrap 统一描，这里不描）。 */
  rim?: false;
  /** 尾梢提亮的长度（像素）。 */
  tip?: number;
}

/**
 * 把一条中心线画成绸带：先按「离中心线最近的采样点」给每个像素归属，再按亮面 / 背光面、受光边 / 背光边 / 中间着色。
 * 像素级逐点绘制，不用 Graphics 的线条。
 */
export function drawRibbon(pix: Pix, sp: Spine, st: RibbonStyle, o: RibbonDraw = {}) {
  const { n } = sp;
  if (n < 2) return;
  const W = pix.w;
  // 1. 包围盒（缓冲内坐标）
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) {
    const r = sp.hw[i] + 1;
    x0 = Math.min(x0, sp.x[i] - r);
    y0 = Math.min(y0, sp.y[i] - r);
    x1 = Math.max(x1, sp.x[i] + r);
    y1 = Math.max(y1, sp.y[i] + r);
  }
  const bx0 = Math.max(0, Math.floor(x0) - pix.ox - 2);
  const by0 = Math.max(0, Math.floor(y0) - pix.oy - 2);
  const bx1 = Math.min(W - 1, Math.ceil(x1) - pix.ox + 2);
  const by1 = Math.min(pix.h - 1, Math.ceil(y1) - pix.oy + 2);
  if (bx0 > bx1 || by0 > by1) return;
  const { dist, idx, side, c } = pix;
  const A = pix.a;
  pix.touch(bx0, by0, bx1, by1);
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const k = y * W + x;
      dist[k] = 99;
      idx[k] = -1;
    }
  // 2. 逐个采样点往两侧铺满半宽
  for (let i = 0; i < n; i++) {
    const hw = sp.hw[i];
    const nx = -sp.ty[i];
    const ny = sp.tx[i];
    const m = Math.max(1, Math.ceil((hw * 2) / 0.45));
    for (let j = 0; j <= m; j++) {
      const v = -hw + (2 * hw * j) / m;
      const X = Math.round(sp.x[i] + nx * v) - pix.ox;
      const Y = Math.round(sp.y[i] + ny * v) - pix.oy;
      if (X < bx0 || Y < by0 || X > bx1 || Y > by1) continue;
      const k = Y * W + X;
      const a = Math.abs(v);
      if (a < dist[k]) {
        dist[k] = a;
        idx[k] = i;
        side[k] = v > 0.3 ? 1 : v < -0.3 ? -1 : 0;
      }
    }
  }
  const inMask = (x: number, y: number) => x >= bx0 && y >= by0 && x <= bx1 && y <= by1 && idx[y * W + x] >= 0;
  const len = sp.len;
  const gold = o.gold ?? 0;
  const tip = o.tip ?? 0;
  // 3. 着色
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const k = y * W + x;
      const i = idx[k];
      if (i < 0) continue;
      A[k] = 0;
      const s = sp.s[i];
      const front = sp.face[i] >= 0;
      const lm = sp.lum[i];
      const F = front ? st.front[lm > 0.88 ? 2 : lm > 0.32 ? 1 : 0] : st.back[lm > 0.55 ? 1 : 0];
      const sd = side[k];
      const edge = !inMask(x - 1, y) || !inMask(x + 1, y) || !inMask(x, y - 1) || !inMask(x, y + 1);
      const nx = -sp.ty[i];
      const ny = sp.tx[i];
      const lit = sd !== 0 && sd * (nx * LX + ny * LY) > 0.08;
      const unlit = sd !== 0 && !lit;
      let col = F.body;
      if (edge && lit) col = F.hi;
      else if (edge && unlit) col = F.lo;
      const fa = Math.abs(sp.face[i]);
      if (s > len - tip) col = F.hi; // 尾梢提亮
      else if (fa < 0.2) col = edge && unlit ? F.body : F.hi; // 翻面处侧着对光，亮一线
      else if (front && gold > 0 && st.pattern === 'scale') {
        // 缚龙的鳞纹：亮面上一道金色折线（像龙脊上的一排鳞），背光边压一道暗金的边
        const hwI = sp.hw[i];
        const v = side[k] * dist[k];
        const q = s / 5;
        const tri = 2 * Math.abs(2 * (q - Math.floor(q + 0.5))) - 1;
        if (!edge && hwI >= 1.5 && Math.abs(v - tri * (hwI - 1.3)) < 0.55) col = Math.floor(q) % 4 === 0 ? st.goldHi : st.gold;
        else if (edge && unlit && lm > 0.3) col = st.goldLo;
      }
      c[k] = col;
    }
}

// ---------- 被缠住的敌人 ----------

export interface Band {
  y: number; // 离脚底的高度（负数朝上）
  rx: number; // 绕身的横向半径
  ry: number; // 透视下的纵向半径（俯视 3/4，所以很扁）
  tilt: number; // 斜度：x 每偏一像素，y 偏多少
  w: number; // 绸带宽（像素行数）
}

/** 一种体型的缠法：几道绕身的绸带、绳结的位置、两根飘带。坐标相对敌人的脚底锚点，x 朝敌人的正面为正。 */
export interface WrapLook {
  cx: number; // 身体中线相对锚点的 x
  bands: Band[];
  knot: number; // 绳结在哪一道上
  knotDx: number; // 绳结偏离中线多少（朝正面）
  knotSize: 0 | 1 | 2;
  tail: number; // 飘带长
  tailW: number; // 飘带根部宽
}

/**
 * 回响兵（20×24，脚底 (8, 23)，身子在 -12..-7 行）：胸口斜缠一道（把手臂绑在身上），再把两条腿绑在一起（一眼看出走不动）。
 * 身子只有六行高，再多缠一道就把人整个盖住了，读不出「一道一道缠着」。
 */
const SOLDIER_WRAP: WrapLook = {
  cx: -1,
  bands: [
    { y: -11, rx: 6, ry: 1.2, tilt: 0.26, w: 2 },
    { y: -4, rx: 4, ry: 0.8, tilt: 0.12, w: 1 },
  ],
  knot: 0,
  knotDx: 1,
  knotSize: 0,
  tail: 7,
  tailW: 1.6,
};
/** 鬼火术士（16×24，脚底 (7, 23)，袍身在 -12..-5 行）：胸口一道，再缠住袍摆。 */
const CASTER_WRAP: WrapLook = {
  cx: 0,
  bands: [
    { y: -12, rx: 5.5, ry: 1.2, tilt: 0.24, w: 2 },
    { y: -5, rx: 3.5, ry: 0.8, tilt: 0.1, w: 1 },
  ],
  knot: 0,
  knotDx: 1,
  knotSize: 0,
  tail: 7,
  tailW: 1.6,
};
/** 回响校尉（28×36，脚底 (12, 35)，身子浮在锚点上方：胸甲 -22..-18、腰带 -17、腿 -16..-11）：胸口、腰间、腿上各一道，绳结大一号。 */
const ELITE_WRAP: WrapLook = {
  cx: 1,
  bands: [
    { y: -21, rx: 8, ry: 1.8, tilt: 0.24, w: 2 },
    { y: -16, rx: 7.5, ry: 1.5, tilt: -0.16, w: 1 },
    { y: -12, rx: 5.5, ry: 1.2, tilt: 0.1, w: 2 },
  ],
  knot: 0,
  knotDx: 2,
  knotSize: 1,
  tail: 11,
  tailW: 2.4,
};
/** 首领魔化哪吒（和哪吒一样大：上衣在脚底往上 -16..-9 行，腿在 -8..-4）：胸口、腰间两道，再缠住腿。 */
const BOSS_WRAP: WrapLook = {
  cx: 0,
  bands: [
    { y: -15, rx: 7, ry: 1.5, tilt: 0.22, w: 2 },
    { y: -11, rx: 6.5, ry: 1.3, tilt: -0.14, w: 2 },
    { y: -6, rx: 5, ry: 1, tilt: 0.1, w: 1 },
  ],
  knot: 0,
  knotDx: 2,
  knotSize: 1,
  tail: 11,
  tailW: 2.2,
};

export function wrapLook(kind: EnemyKindName): WrapLook {
  return FOE_WRAP[kind as keyof typeof FOE_WRAP] ?? (kind === 'elite' ? ELITE_WRAP : kind === 'boss' ? BOSS_WRAP : kind === 'caster' ? CASTER_WRAP : SOLDIER_WRAP);
}

/**
 * 第一章新敌人的缠法（坐标按各自精灵的脚底锚点量的，见 spearman.ts / shieldbearer.ts / cavalry.ts / bomber.ts / splitter.ts）。
 * 长矛兵：胸口一道、腿上一道；盾兵：连盾带人缠两道、腿上一道；骑兵：骑将胸口一道、马肚子一道、马腿一道（缓冲用大一号）；
 * 自爆鬼：圆滚滚的身子上下两道；分魂鬼：袍子上三道；离魂：一道。
 */
const FOE_WRAP: Partial<Record<EnemyKindName, WrapLook>> = {
  spearman: {
    cx: 0,
    bands: [
      { y: -12, rx: 6, ry: 1.2, tilt: 0.24, w: 2 },
      { y: -5, rx: 4, ry: 0.8, tilt: 0.12, w: 1 },
    ],
    knot: 0,
    knotDx: 1,
    knotSize: 0,
    tail: 7,
    tailW: 1.6,
  },
  shieldbearer: {
    cx: 0,
    bands: [
      { y: -13, rx: 8.5, ry: 1.6, tilt: 0.22, w: 2 },
      { y: -8, rx: 8, ry: 1.4, tilt: -0.12, w: 1 },
      { y: -4, rx: 5, ry: 1, tilt: 0.1, w: 1 },
    ],
    knot: 0,
    knotDx: 2,
    knotSize: 1,
    tail: 9,
    tailW: 2,
  },
  cavalry: {
    cx: -3,
    bands: [
      { y: -17, rx: 5, ry: 1.2, tilt: 0.24, w: 2 },
      { y: -12, rx: 10.5, ry: 2.2, tilt: -0.1, w: 2 },
      { y: -6, rx: 8, ry: 1.4, tilt: 0.06, w: 1 },
    ],
    knot: 1,
    knotDx: 3,
    knotSize: 1,
    tail: 11,
    tailW: 2.4,
  },
  bomber: {
    cx: -1,
    bands: [
      { y: -13, rx: 6, ry: 1.4, tilt: 0.22, w: 2 },
      { y: -8, rx: 5, ry: 1.1, tilt: -0.14, w: 1 },
    ],
    knot: 0,
    knotDx: 1,
    knotSize: 0,
    tail: 6,
    tailW: 1.6,
  },
  splitter: {
    cx: 0,
    bands: [
      { y: -12, rx: 6, ry: 1.3, tilt: 0.22, w: 2 },
      { y: -8, rx: 6, ry: 1.2, tilt: -0.14, w: 1 },
      { y: -4, rx: 4.5, ry: 0.9, tilt: 0.1, w: 1 },
    ],
    knot: 0,
    knotDx: 1,
    knotSize: 0,
    tail: 7,
    tailW: 1.6,
  },
  splitling: {
    cx: 0,
    bands: [{ y: -5, rx: 3.6, ry: 0.8, tilt: 0.2, w: 1 }],
    knot: 0,
    knotDx: 1,
    knotSize: 0,
    tail: 4,
    tailW: 1.2,
  },
};

export interface WrapPose {
  x: number; // 脚底锚点（世界坐标，整数）
  y: number;
  flip: 1 | -1; // 敌人朝向（精灵的 scale.x 符号）
  t: number; // 时间（秒）：飘带、火苗的抖动
  reveal: number; // 0..1：缠上去的进度——每道从 from 那一侧起头，经过身前绕到另一侧、再从身后绕回来（上面那道先绕）
  from: number; // 混天绫从哪一侧掠过来的（屏幕上：1 右、-1 左）
  tight: number; // 绕身半径的额外偏移（绕的时候松松的，绕完一勒：先松后紧、略微勒过头再回弹）
  loose: number; // 0..1：快到时间时慢慢松开
  strain: number; // 0..1：挣扎时被勒紧的那一下
  tailX: number; // 飘带往哪边飘（单位向量）
  tailY: number;
  impact: number; // 1..0：缠上那一瞬的「勒紧」线
  seed: number;
}

const spine = new Spine();

/**
 * 把一只被缠住的敌人身上的红绫画进两块缓冲：front 叠在敌人精灵上面，back 垫在下面。
 * 绕身的绸带按椭圆走一圈，前半圈画进 front、后半圈画进 back（只从身体两侧和缝隙里露出来），所以看起来是真的绕在身上。
 */
export function drawWrap(front: Pix, back: Pix, look: WrapLook, pose: WrapPose, st: RibbonStyle) {
  const { flip, t, loose } = pose;
  const ax = pose.x + look.cx * flip;
  const nb = look.bands.length;
  let knotX = 0;
  let knotY = 0;
  for (let bi = 0; bi < nb; bi++) {
    const b = look.bands[bi];
    // 绕身的半径：缠上时先松后紧；挣扎时勒紧一像素；松开时慢慢变大、往下滑
    const R = b.rx + pose.tight * (1 - bi * 0.15) + loose * 1.6 - pose.strain * 0.9;
    const cy = pose.y + b.y + loose * (1 + bi * 0.4) - pose.strain * 0.6 * (bi === 0 ? 1 : 0.5);
    const tilt = b.tilt * flip;
    // 绑好以后每道从绳结那一侧开始绕，loose 让它从末端松脱。缠上去的时候（reveal < 1）每道从混天绫掠来的那一侧起头：
    // 角度 0 是右侧、π/2 是身前、π 是左侧，从右边来就往 π/2 那边绕（先过身前），从左边来反过来；上面那道先绕，下面的晚一点
    const winding = pose.reveal < 1;
    const cover = (winding ? clamp((pose.reveal - bi * 0.1) / 0.8, 0, 1) : 1) * (1 - loose * 0.55);
    const knotA = Math.PI / 2 + (bi === look.knot ? look.knotDx / Math.max(4, b.rx) : (bi % 2 ? -0.5 : 0.4)) * flip;
    if (bi === look.knot) {
      const co = Math.cos(knotA);
      knotX = ax + R * co;
      knotY = cy + tilt * R * co + b.ry * Math.sin(knotA);
    }
    if (cover <= 0) continue;
    const start = winding ? (pose.from > 0 ? 0 : Math.PI) : knotA;
    const dir = winding ? (pose.from > 0 ? 1 : -1) : bi % 2 ? -flip : flip;
    const total = Math.PI * 2 * cover;
    const stepA = 0.32 / R;
    let endX = 0;
    let endY = 0;
    let endFront = true;
    for (let a = 0; a <= total; a += stepA) {
      const phi = start + dir * a;
      const co = Math.cos(phi);
      const si = Math.sin(phi);
      const X = ax + R * co;
      const Y = cy + tilt * R * co + b.ry * si;
      const isFront = si > -0.2;
      const P = isFront ? front : back;
      const side = Math.abs(co);
      // 绕在身上的绸带像圆柱上的一圈：正面中间最亮，往两侧转过去渐暗
      const Fc = st.front[side < 0.45 ? 2 : side < 0.85 ? 1 : 0];
      for (let j = 0; j < b.w; j++) {
        let col: number;
        if (isFront) {
          if (j === 0) col = Fc.hi;
          else if (j === b.w - 1 && b.w > 1) col = Fc.lo;
          else col = Fc.body;
          // 金纹：缚龙在绸带中间压一行金点，默认在正面中央点一粒
          if (st.pattern === 'scale' && j === Math.floor(b.w / 2) && b.w >= 3 && Math.round(a * R) % 2 === 0 && side < 0.8) col = st.gold;
          else if (st.pattern === 'cloud' && b.w >= 3 && j === 1 && Math.round(a * R) % 5 === 0 && side < 0.6) col = st.gold;
        } else col = j === 0 ? st.back[0].body : st.back[0].lo;
        P.set(Math.round(X), Math.round(Y) + j, col);
      }
      endX = X;
      endY = Y;
      endFront = isFront;
    }
    // 松脱的那一头：只有系绳结的那一道垂下一截（越松越长），其余几道只是变松、往下滑，免得满身碎条
    if (loose > 0.05 && bi === look.knot) {
      const L = (1 - cover) * Math.PI * R * 0.4 + 1;
      const P = endFront ? front : back;
      const tx = pose.tailX * 0.6 + flip * dir * 0.3;
      const ty = 0.55 + Math.max(0, pose.tailY) * 0.3;
      spine.fromCurve(
        (u, out) => {
          out[0] = endX + tx * L * u + Math.sin(u * 5 - t * 7 + bi) * 1.2 * u;
          out[1] = endY + ty * L * u + 0.6 * L * u * u * 0.4;
        },
        L,
      );
      spine.shape(
        (s, u) => Math.max(1, b.w * (1 - u * 0.7)),
        (s) => 1.9 * Math.sin(s * 0.5 - t * 6 + bi * 2),
      );
      drawRibbon(P, spine, st, { rim: false, tip: 1 });
    }
  }
  // 两根飘带：绕完、系上以后从绳结伸出（勒紧的那一下从短里长出来），往身后飘、末梢抖动；垫在身后（back），只有根部压在身前
  if (pose.reveal >= 1) {
    const kx = Math.round(knotX);
    const ky = Math.round(knotY);
    for (let k = 0; k < (look.knotSize ? 2 : 1); k++) {
      const L = look.tail * (k ? 0.72 : 1) * (1 - 0.45 * pose.impact);
      const spread = (k ? 0.55 : -0.25) * (pose.tailX >= 0 ? 1 : -1);
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const dx = pose.tailX * ca - pose.tailY * sa;
      const dy = pose.tailX * sa + pose.tailY * ca;
      const droop = 0.35 + loose * 0.5;
      const ph = pose.seed + k * 1.9;
      spine.fromCurve(
        (u, out) => {
          const wave = Math.sin(u * 4.2 - t * (k ? 9 : 7.5) + ph) * (0.8 + 1.6 * u) * (look.knotSize + 1) * 0.8;
          out[0] = kx + dx * L * u - dy * wave;
          out[1] = ky + dy * L * u + dx * wave + droop * L * u * u;
        },
        L,
      );
      spine.shape(
        (s, u) => Math.max(1, look.tailW * (1 - u * 0.75)),
        (s) => 1.9 * Math.sin(s * 0.45 - t * 5 + ph),
      );
      drawRibbon(back, spine, st, { tip: 1.5, rim: false, gold: st.pattern === 'scale' ? 1 : 0 });
    }
  }
  // 绳结：快绕完的时候系上
  if (pose.reveal > 0.9) drawKnot(front, Math.round(knotX), Math.round(knotY), look.knotSize, flip, st);
  // 缠上那一瞬：绳结两侧弹出几道短短的金线（勒紧的力道），很快收掉
  if (pose.impact > 0.05) {
    const b0 = look.bands[0];
    const len = Math.round(1 + pose.impact * (2 + look.knotSize * 2));
    for (const sgn of [-1, 1]) {
      const X = Math.round(ax + sgn * (b0.rx + 2));
      const Y = Math.round(pose.y + b0.y);
      for (let j = 0; j < len; j++) {
        front.set(X + sgn * j, Y - j, j === 0 ? C('W') : C('Y'));
        front.set(X + sgn * j, Y + 3 + j, j === 0 ? C('Y') : C('f'));
      }
    }
  }
  // 火绫：绸带上窜起小火苗
  if (st.pattern === 'flame' && loose < 0.8) {
    for (let bi = 0; bi < nb; bi++) {
      const b = look.bands[bi];
      const R = b.rx + pose.tight;
      for (let k = -2; k <= 2; k++) {
        const fz = Math.sin(k * 2.1 + t * 10 + bi * 1.3 + pose.seed) + Math.sin(k * 0.7 - t * 6.5);
        if (fz < 0.6) continue;
        const X = Math.round(ax + (k / 2.5) * R * 0.9);
        const Y = Math.round(pose.y + b.y + b.tilt * flip * (k / 2.5) * R * 0.9 + b.ry) - 1;
        front.put(X, Y, C('o'));
        if (fz > 1.2) front.put(X, Y - 1, C('Y'));
      }
    }
  }
  rimAround(front, st.rim, true);
  rimAround(back, st.back[0].lo === C('k') ? C('k') : st.rim, false);
}

/** 绳结：0 小（2×2）、1 中（3×3 带两瓣）、2 大（蝴蝶结）。 */
function drawKnot(P: Pix, x: number, y: number, size: 0 | 1 | 2, flip: number, st: RibbonStyle) {
  const g = KNOTS[size];
  const h = g.length;
  const w = g[0].length;
  const ox = x - Math.floor(w / 2);
  const oy = y - Math.floor(h / 2);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const ch = g[j][flip > 0 ? i : w - 1 - i];
      if (ch === '.') continue;
      const code = ch === 'H' ? st.front[2].hi : ch === 'B' ? st.front[1].body : ch === 'L' ? st.front[1].lo : ch === 'G' ? st.gold : ch === 'g' ? st.goldHi : C(ch);
      P.set(ox + i, oy + j, code);
    }
}
// H 受光 / B 绸面 / L 背光 / G 金 / g 亮金（换成当前绸带的配色）
const KNOTS = [
  ['HB', 'BL'],
  ['H.H', 'BGB', 'L.L'],
  ['HH.HH', 'HBgBL', '.BGB.', 'LB.BL'],
];

/**
 * 在缓冲里已画像素的外围补描边（只补空处）。front 层不描上沿：绸带叠在敌人身上，上沿再压一道暗线，
 * 几道绸带之间的缝就被填死了，读不出是「一道一道缠着」。
 */
function rimAround(P: Pix, rim: number, front: boolean) {
  if (P.empty()) return;
  const { w, h, c } = P;
  const mark = P.idx;
  const X0 = Math.max(0, P.x0 - 1);
  const Y0 = Math.max(0, P.y0 - 1);
  const X1 = Math.min(w - 1, P.x1 + 1);
  const Y1 = Math.min(h - 1, P.y1 + 1);
  for (let y = Y0; y <= Y1; y++)
    for (let x = X0; x <= X1; x++) {
      const k = y * w + x;
      mark[k] = c[k] && !GLOW[c[k]] ? 1 : 0;
    }
  for (let y = Y0; y <= Y1; y++)
    for (let x = X0; x <= X1; x++) {
      const k = y * w + x;
      if (c[k]) continue;
      const up = y > Y0 && mark[k - w] === 1;
      const side = (x > X0 && mark[k - 1] === 1) || (x < X1 && mark[k + 1] === 1);
      const down = y < Y1 && mark[k + w] === 1;
      if (up || side || (!front && down)) c[k] = rim;
    }
  for (let y = Y0; y <= Y1; y++) mark.fill(-1, y * w + X0, y * w + X1 + 1);
  P.touch(X0, Y0, X1, Y1);
}
// 勒紧线、火苗这些「光」不描边（按编码查表）
const GLOW = new Uint8Array(128);
for (const ch of 'WYf') GLOW[C(ch)] = 1;

// ---------- 飘落的红绸碎片 ----------

/** 被缠住的敌人身上飘下的红绸碎片：三帧翻飞（横、斜、竖）。 */
export const SHRED_FRAMES = [['eo'], ['.e', 'r.'], ['o', 'r'], ['e.', '.r']];
export const SHRED_FIRE_FRAMES = [['oY'], ['.o', 'e.'], ['Y', 'e'], ['o.', '.e']];
export const SHRED_BIND_FRAMES = [['ry'], ['.r', 'R.'], ['e', 'R'], ['r.', '.R']];
