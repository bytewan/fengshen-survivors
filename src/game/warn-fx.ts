// 敌人与首领攻击的地面预警：传统的「淡红光」（用户 2026-11-10：「可以就直接做传统的淡红光设计」）。
// 地上一片淡红的半透明光区，形状就是判定范围（按人物脚下算：脚下落进红光里就会挨打）；
// 上面一层更亮的红随预警进度推进——直线、车道从起点推到终点，圆从中心往外，横扫沿扫的方向——推满就是出手；
// 出手那一瞬整块亮到缃、橘（1–2 帧），之后还危险的部分保持亮着，攻击走过的地方拖一截慢慢淡掉，最后整体淡出。
// 柔边：两个整像素宽，判定边界里面那一圈 2/3、外面那一圈 1/3（边界正好落在两档之间）；不描边、不画框、不模糊。
// 方向提示：直线和车道里一排淡淡的小箭头，随推进一节一节亮起（只比亮红亮一点，不抢红光）。
//
// 画法：所有形状都由预先生成的柔边纹理拼出来——长条 = 两头的半圆 + 中间一列像素拉伸，圆按整数半径各一张，
// 横扫的半圆切成 48 片扇形，箭头按 32 个方向各一张；每帧只改位置、长度、透明度、颜色，不重画 Graphics。
// 纹理放在模块级缓存里，跨局复用（重开一局、回到标题再开都不销毁）。
// 同一个舞台上的所有预警画在同一层（WarnLayer，在地面层里、人物和敌人的影子下面）。这一层先在离屏纹理里
// 按「取最大值」叠起来（blendMode 'max'），再整体盖到地上：很多块叠在一起也不会越叠越深、变成一大块深红，
// 每一块的外轮廓、推进的亮红和箭头都还分得清。
import { AlphaFilter, BufferImageSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { PALETTE } from '../art/palette.ts';
import type { Stage } from '../render/stage.ts';

const hex = (k: string) => parseInt(PALETTE[k].slice(1), 16);
/** 预警用到的调色板颜色：朱砂（底和亮红）、橘、缃（出手的闪光）。 */
const COL = { e: hex('e'), o: hex('o'), Y: hex('Y') };

/** 各层的透明度（乘在柔边纹理上）：底、推进的亮红、出手后还危险的部分、箭头、出手闪光的两帧。 */
const A = { base: 0.2, lit: 0.42, hot: 0.42, chev: 0.6, flash: 0.5, flash2: 0.42 };
/** 淡入（带一点展开）多久；出手后攻击走过的地方多久淡完（拖尾的长度 = 攻击的速度 × 这么久）。 */
const WARN_APPEAR = 0.15;
const WARN_TRAIL = 0.3;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

// ---------- 柔边纹理 ----------
/** 纹理在判定边界外多留的像素数（soft 在 s ≤ 1 以内不为零）。 */
const PAD = 2;
/** 柔边：离判定边界 s 像素（外正内负，在像素中心量）的透明度倍数——边界里面一个像素以内 2/3，外面一个像素以内 1/3。 */
function soft(s: number) {
  return s <= -1 ? 1 : s <= 0 ? 0.66 : s <= 1 ? 0.33 : 0;
}

const cache = new Map<string, Texture>();
/**
 * 「光」比「颜料」多出来的那一点亮：纹理按预乘透明度存，颜色通道比透明度高这么多（RGB = α × (1 + GLOW)）。
 * 盖到地上时相当于普通叠加之外再加一点同色的光——浅色的仙台上只是红得亮一点，
 * 暗的魔气、云影里红光会亮出来，不会沉成一片看不清的暗褐色。
 * 为了颜色通道不顶到 1（顶到了，满的地方就没有光、只剩柔边上有，反而像描了一圈边），纹理里的透明度先除以 K，
 * 精灵的透明度再乘回 K（见 al）：画出来的透明度不变，颜色多出 GLOW 那一份。
 */
const GLOW = 0.3;
const K = 1 + GLOW;
/** 设计里的透明度 → 精灵的 alpha（纹理里的透明度预先除过 K）。 */
const al = (a: number) => a * K;
/** 生成一张白色、只有透明度的纹理（颜色由 tint 给）。alpha(x, y) 在像素中心取值。 */
function paint(key: string, w: number, h: number, alpha: (x: number, y: number) => number): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = Math.min(1, alpha(x + 0.5, y + 0.5));
      if (a <= 0) continue;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(a * 255);
      data[i + 3] = Math.round((a * 255) / K);
    }
  // 已经是预乘过的数据（颜色可以比透明度亮），按原样上传；最近邻采样
  const t = new Texture({ source: new BufferImageSource({ resource: data, width: w, height: h, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha', scaleMode: 'nearest' }) });
  cache.set(key, t);
  return t;
}

/** 长条中间的一列：横向的柔边剖面（高 2(R+PAD)），沿线拉伸。 */
const bodyTex = (R: number) => paint(`body${R}`, 1, 2 * (R + PAD), (_x, y) => soft(Math.abs(y - (R + PAD)) - R));
/**
 * 长条一头的半圆（u ≥ 0 那一半），往回多带一列和中间那列一样的剖面：和拉伸的那一列重叠一像素（取最大值叠，
 * 重叠处不变深），旋转以后接缝上也不会漏像素。原点（线段端点）在第 1 列的左边。
 */
const capTex = (R: number) =>
  paint(`cap${R}`, R + PAD + 1, 2 * (R + PAD), (x, y) => {
    const u = x - 1;
    const v = y - (R + PAD);
    return soft(u < 0 ? Math.abs(v) - R : Math.hypot(u, v) - R);
  });
/** 拖尾：横向是同样的柔边剖面，沿线从 0 分八档亮到 1（右端是头）。 */
const TRAIL_W = 16;
const trailTex = (R: number) => paint(`trail${R}`, TRAIL_W, 2 * (R + PAD), (x, y) => soft(Math.abs(y - (R + PAD)) - R) * (Math.round((x / TRAIL_W) * 8) / 8));
/** 实心圆（整数半径各一张，圆心在纹理正中、像素的交点上）。 */
const diskTex = (R: number) => paint(`disk${R}`, 2 * (R + PAD), 2 * (R + PAD), (x, y) => soft(Math.hypot(x - R - PAD, y - R - PAD) - R));
/** 实心方格（整数半边长各一张，中心在纹理正中、像素的交点上）：第三章剑雨的格子。 */
const boxTex = (h: number) => paint(`box${h}`, 2 * (h + PAD), 2 * (h + PAD), (x, y) => soft(Math.max(Math.abs(x - h - PAD), Math.abs(y - h - PAD)) - h));

/**
 * 横扫的一片扇形：在自己的坐标里占角度 [0, arc/n]（y 朝下，角度往 y 正方向转）。
 * 扇面（默认半圆，arc = π）在「扫的坐标系」里是 {离圆心 ≤ Rs} ∩ {扫过的角度 ∈ [−margin / max(离圆心, 8), arc]}：起始边那一侧往外宽出约 margin 像素
 * （判定里红绫和身子有重叠就算打中；另一头没有）。中间的片两侧硬切、各往外多盖 1.5 像素（相邻两片取最大值叠，
 * 旋转以后不留缝）；第一片的起始边、最后一片的末边是扇面真正的边，按判定画柔边。
 */
function wedgeTex(Rs: number, n: number, part: 'first' | 'mid' | 'last', margin: number, arc = Math.PI) {
  const D = arc / n;
  const W = 1.5;
  const X0 = 4;
  const Y0 = (part === 'first' ? margin : 0) + 4;
  const Y1 = Math.ceil((Rs + PAD) * Math.sin(D)) + 4;
  const w = Math.ceil(Rs + PAD + X0);
  const h = Y0 + Y1;
  const cs = Math.cos(D);
  const sn = Math.sin(D);
  const rot = part === 'last' ? (n - 1) * D : 0;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const tex = paint(`wedge${Rs},${n},${part},${margin}${arc === Math.PI ? '' : `,${arc.toFixed(4)}`}`, w, h, (px, py) => {
    const x = px - X0;
    const y = py - Y0;
    const d = Math.hypot(x, y);
    // 片的两条边：0° 那条在 y = 0，π/n 那条的外法线是 (−sin, cos)
    const lo = y >= 0 || (x > 0 ? -y : d) <= W;
    const hiOut = -x * sn + y * cs;
    const hi = hiOut <= 0 || (x * cs + y * sn > 0 ? hiOut : d) <= W;
    if (part === 'mid') return lo && hi ? soft(d - Rs) : 0;
    // 第一片 / 最后一片：换到扫的坐标系里，按判定的真实边界算柔边。判定（boss.ts 的 sweep）：
    // 扫过的角度 rel ∈ [−m, π]，m = margin / max(离圆心, 8)，即起始边往外宽出约 margin 像素，靠近圆心处收成一个小角
    const X = x * cr - y * sr;
    const Y = x * sr + y * cr;
    const m = margin / Math.max(d, 8);
    const rel = Math.atan2(Y, X);
    const edge = Math.min(rayDist(X, Y, -m), rayDist(X, Y, arc));
    const sdA = d - Rs; // 到弧
    const sdB = rel >= -m ? -edge : edge; // 到两条直边
    const sd = sdA > 0 && sdB > 0 ? Math.hypot(sdA, sdB) : Math.max(sdA, sdB); // 两条边外侧的角上按到角点的真实距离
    if (part === 'first') return hi ? soft(sd) : 0;
    return lo ? soft(sd) : 0;
  });
  return { tex, ax: X0 / w, ay: Y0 / h };
}
/** 点到「从原点出发、朝 th 方向的射线」的距离。 */
function rayDist(x: number, y: number, th: number) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return x * c + y * s >= 0 ? Math.abs(-x * s + y * c) : Math.hypot(x, y);
}

/** 小箭头「>」：尖在纹理中心、朝 a 方向，两翼往后各 s 像素；thick 再往后叠一笔。32 个方向各一张。 */
const CHEV_DIRS = 32;
function chevTex(a: number, s: number, thick: boolean) {
  const i = ((Math.round((a / (Math.PI * 2)) * CHEV_DIRS) % CHEV_DIRS) + CHEV_DIRS) % CHEV_DIRS;
  const size = 2 * s + 5;
  const c = s + 2;
  const key = `chev${i},${s},${thick ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return { tex: hit, c, size };
  const q = (i / CHEV_DIRS) * Math.PI * 2;
  const ux = Math.cos(q);
  const uy = Math.sin(q);
  const on = new Set<number>();
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let k = 0; k <= n; k++) on.add(Math.round(c + x0 + ((x1 - x0) * k) / n) * size + Math.round(c + y0 + ((y1 - y0) * k) / n));
  };
  for (const o of thick ? [0, 1] : [0]) {
    const bx = -ux * o;
    const by = -uy * o;
    line(bx, by, bx - ux * s - uy * s, by - uy * s + ux * s);
    line(bx, by, bx - ux * s + uy * s, by - uy * s - ux * s);
  }
  const tex = paint(key, size, size, (x, y) => (on.has(Math.floor(x) * size + Math.floor(y)) ? 1 : 0));
  return { tex, c, size };
}

/**
 * 预先把要用的纹理都生成好（首领、敌人的画面建好时调用），免得第一次出招时才算、卡一下。
 * lanes：长条的半径（连箭头的 32 个方向）；disks：圆的半径（连推亮时用到的 1..R）；sweeps：横扫的 [半径, 起始边宽出的像素, 扫过的角度（默认 π）]；
 * boxes：方格的半边长（连推亮时用到的 1..h）。
 */
export function warmWarnTextures(o: { lanes?: number[]; disks?: number[]; sweeps?: [number, number, number?][]; chevrons?: [number, boolean][]; boxes?: number[] }) {
  for (const R of o.lanes ?? []) {
    bodyTex(R);
    capTex(R);
    trailTex(R);
  }
  for (const R of o.disks ?? []) for (let r = 1; r <= R; r++) diskTex(r);
  for (const [R, m, arc] of o.sweeps ?? []) for (const part of ['first', 'mid', 'last'] as const) wedgeTex(R, SWEEP_N, part, m, arc ?? Math.PI);
  for (const h of o.boxes ?? []) for (let r = 1; r <= h; r++) boxTex(r);
  for (const [s, thick] of o.chevrons ?? []) for (let i = 0; i < CHEV_DIRS; i++) chevTex((i / CHEV_DIRS) * Math.PI * 2, s, thick);
}

// ---------- 同一舞台共用的一层 ----------
/** 所有预警共用的一层：在地面层里，叠加处取最大值（见文件头）。 */
export class WarnLayer {
  readonly root = new Container();
  constructor(stage: Pick<Stage, 'floor'>) {
    // AlphaFilter 只是让这一层先画进离屏纹理（里面按 'max' 叠），再整体盖到地上。
    // filterArea 给一块盖住整个场地（连魔气带）的固定范围：不用每帧量几百个精灵的包围盒，
    // 离屏纹理也总是一屏大小（超出屏幕的部分 Pixi 会裁掉），纹理池里不会来回换尺寸
    this.root.filters = [new AlphaFilter({ alpha: 1 })];
    this.root.filterArea = new Rectangle(-2000, -2000, 5000, 5000);
    this.root.visible = false;
    stage.floor.addChild(this.root);
  }
  add(c: Container) {
    this.root.addChild(c);
    this.root.visible = true;
  }
  remove(c: Container) {
    c.destroy({ children: true }); // 只销毁精灵，纹理是模块级缓存，留着下次用
    this.root.visible = this.root.children.length > 0;
  }
}
const layers = new WeakMap<Stage, WarnLayer>();
/**
 * 这个舞台的预警层（第一次调用时建好，放在地面层当前的最上面）。
 * feel.ts 里首领、敌人的画面在法宝的地面效果之后、所有影子之前建好，所以预警盖在火痕、水域这些上面，又压在影子下面。
 */
export function warnLayer(stage: Stage): WarnLayer {
  let l = layers.get(stage);
  if (!l) {
    l = new WarnLayer(stage);
    layers.set(stage, l);
  }
  return l;
}

const maxSprite = (t: Texture, parent: Container, ax = 0.5, ay = 0.5) => {
  const s = new Sprite(t);
  s.anchor.set(ax, ay);
  s.blendMode = 'max';
  s.visible = false;
  parent.addChild(s);
  return s;
};

/** 一段带圆头的长条（局部坐标：u 沿线、v 横向），由两头的半圆和中间拉伸的一列拼成。 */
class Capsule {
  private cap0: Sprite;
  private body: Sprite;
  private cap1: Sprite;
  constructor(parent: Container, R: number) {
    const cap = capTex(R);
    const ax = 1 / (R + PAD + 1);
    this.cap0 = maxSprite(cap, parent, ax);
    this.cap0.scale.x = -1;
    this.body = maxSprite(bodyTex(R), parent, 0, 0.5);
    this.cap1 = maxSprite(cap, parent, ax);
  }
  /** 画 [u0, u1] 这一段（两头各带半圆）。 */
  set(u0: number, u1: number, tint: number, alpha: number) {
    const on = alpha > 0.003 && u1 >= u0;
    this.cap0.visible = this.cap1.visible = on;
    this.body.visible = on && u1 - u0 >= 0.5;
    if (!on) return;
    this.cap0.position.set(u0, 0);
    this.body.position.set(u0, 0);
    this.body.scale.x = Math.max(0.0001, u1 - u0);
    this.cap1.position.set(u1, 0);
    this.cap0.tint = this.body.tint = this.cap1.tint = tint;
    this.cap0.alpha = this.body.alpha = this.cap1.alpha = al(alpha);
  }
  hide() {
    this.cap0.visible = this.body.visible = this.cap1.visible = false;
  }
}

/** 预警的时间线：淡入、出手（闪光按帧数算，慢机器上也至少亮一帧）、淡出。 */
abstract class Warn {
  protected layer: WarnLayer;
  readonly c = new Container();
  protected t = 0; // 出现了多久
  protected sf = -1; // 出手后第几帧（-1 = 还没出手；0 = 出手后画的第一帧）
  protected st = 0; // 出手后多久
  protected gone = -1; // 开始淡出后多久（-1 = 还在）
  protected fadeDur = 0.3;
  constructor(layer: WarnLayer) {
    this.layer = layer;
    layer.add(this.c);
  }
  get struck() {
    return this.sf >= 0;
  }
  /** 淡完了，可以 destroy。 */
  get done() {
    return this.gone >= this.fadeDur;
  }
  /** 出手：下一帧整块闪一下。 */
  strike() {
    if (this.sf < 0) {
      this.sf = 0;
      this.st = 0;
    }
  }
  /** 开始淡出（被打断、攻击结束、敌人没了）。 */
  end(dur = 0.3) {
    if (this.gone < 0) {
      this.gone = 0;
      this.fadeDur = dur;
    }
  }
  destroy() {
    this.layer.remove(this.c);
  }
  protected appear() {
    return clamp01(this.t / WARN_APPEAR);
  }
  protected out() {
    return this.gone < 0 ? 1 : 1 - clamp01(this.gone / this.fadeDur);
  }
  /** 出手闪光：第一帧缃，第二帧（60 帧时）橘；0 = 不闪。 */
  protected flash(): 0 | 1 | 2 {
    return this.sf === 0 ? 2 : this.sf === 1 && this.st < 0.05 ? 1 : 0;
  }
  protected tick(dt: number) {
    this.t += dt;
    if (this.sf >= 0) {
      this.sf++;
      this.st += dt;
    }
    if (this.gone >= 0) this.gone += dt;
  }
}

/** 出手闪光两帧的颜色和亮度：缃、橘。 */
const flashTint = (f: 1 | 2) => (f === 2 ? COL.Y : COL.o);
const flashAlpha = (f: 1 | 2) => (f === 2 ? A.flash : A.flash2);

// ---------- 长条：长矛、冲锋、突进、乾坤圈、风火轮 ----------
export interface LaneChevrons {
  every: number; // 每隔多少像素一个
  start: number; // 第一个离起点多远
  end?: number; // 最后一个离终点至少多远（默认 4）
  size: number; // 两翼长
  thick?: boolean;
  double?: boolean; // 双箭头「»」
}

/** 出手以后这一帧怎么画：还危险的一段 [from, to]（沿线像素），攻击现在走到哪（拖尾的头），拖尾朝哪边。 */
export interface LaneLive {
  from: number;
  to: number;
  head?: number;
  back?: boolean; // 拖尾往终点那一侧（乾坤圈折返）
  flip?: boolean; // 箭头反过来（乾坤圈折返）
}

/**
 * 判定是「到线段 (x0,y0)–(x1,y1) 的距离不超过 R」的预警：两头圆、中间直的一条光带。
 * 预警时亮红从起点推到终点（亮红本身也是同样半径的长条，前沿是圆头，推满时正好和整条重合）。
 */
export class LaneWarn extends Warn {
  readonly len: number;
  readonly R: number;
  private x0: number;
  private y0: number;
  private ux: number;
  private uy: number;
  private base: Capsule;
  private lit: Capsule;
  private trail: Sprite;
  private trailFar: number;
  private chev: { s: Sprite[]; d: number; wx: number; wy: number; tex: Texture; back: Texture }[] = [];
  /** speed：攻击沿线走的速度（像素 / 秒），拖尾长 speed × WARN_TRAIL；不动的攻击传 0。 */
  constructor(layer: WarnLayer, x0: number, y0: number, x1: number, y1: number, R: number, speed: number, chev?: LaneChevrons) {
    super(layer);
    this.R = R;
    this.x0 = x0;
    this.y0 = y0;
    const len = Math.hypot(x1 - x0, y1 - y0);
    this.len = len;
    this.ux = len > 0 ? (x1 - x0) / len : 1;
    this.uy = len > 0 ? (y1 - y0) / len : 0;
    const ang = Math.atan2(this.uy, this.ux);
    this.c.position.set(x0, y0);
    this.c.rotation = ang;
    this.base = new Capsule(this.c, R);
    this.lit = new Capsule(this.c, R);
    this.trail = maxSprite(trailTex(R), this.c, 1, 0.5);
    this.trailFar = speed * WARN_TRAIL;
    if (chev) {
      // 箭头放在不跟着转的子容器里（纹理本身按方向画好，不旋转，像素不走样）
      const holder = new Container();
      holder.rotation = -ang;
      this.c.addChild(holder);
      const end = chev.end ?? 4;
      for (let d = chev.start; d <= len - end; d += chev.every) {
        const wx = this.ux * d;
        const wy = this.uy * d;
        const fwd = chevTex(ang, chev.size, !!chev.thick);
        const bwd = chevTex(ang + Math.PI, chev.size, !!chev.thick);
        const s: Sprite[] = [];
        for (const o of chev.double ? [0, 3] : [0]) {
          const sp = maxSprite(fwd.tex, holder, fwd.c / fwd.size, fwd.c / fwd.size);
          sp.position.set(Math.round(x0 + wx - this.ux * o) - x0, Math.round(y0 + wy - this.uy * o) - y0);
          s.push(sp);
        }
        this.chev.push({ s, d, wx, wy, tex: fwd.tex, back: bwd.tex });
      }
    }
  }

  /** 世界坐标里，离起点 d 像素那一点。 */
  at(d: number): [number, number] {
    return [this.x0 + this.ux * d, this.y0 + this.uy * d];
  }
  /** (x, y) 投到线上离起点多远。 */
  along(x: number, y: number) {
    return (x - this.x0) * this.ux + (y - this.y0) * this.uy;
  }

  /**
   * 每帧调用一次（画完再推进计时）。k：预警进度 0..1；live：出手以后的画法（没给就当整条都还危险）；
   * cam：给了就只显示镜头附近的箭头（车道很长时用）。
   */
  draw(dt: number, k: number, live?: LaneLive, cam?: { x: number; y: number }) {
    const L = this.len;
    const ap = this.appear();
    const out = this.out();
    const fl = this.flash();
    // 箭头：沿线 [c0, c1] 之间的亮成 ca，其余不显示
    let c0 = 0;
    let c1 = -1;
    let ca = 0;
    if (fl) {
      // 出手：整块亮一下
      const tint = flashTint(fl);
      const a = flashAlpha(fl) * out;
      this.base.set(0, L, tint, a);
      this.lit.hide();
      this.trail.visible = false;
      c1 = L;
      ca = a;
      this.tintChev(tint, !!live?.flip);
    } else if (!this.struck) {
      // 预警：淡红的底（淡入时从起点往外展开），亮红从起点推到终点
      const reach = L * easeOut(ap);
      const f = Math.min(reach, clamp01(k) * L);
      this.base.set(0, reach, COL.e, A.base * ap * out);
      this.lit.set(0, f, COL.e, A.lit * ap * out);
      this.trail.visible = false;
      c1 = f;
      ca = A.chev * ap * out;
      this.tintChev(COL.o, false);
    } else {
      // 出手以后：还危险的一段保持亮着，攻击走过的地方拖一截慢慢淡掉
      this.base.hide();
      const from = Math.max(0, Math.min(L, live ? live.from : 0));
      const to = Math.max(0, Math.min(L, live ? live.to : L));
      this.lit.set(from, to, COL.e, A.hot * out);
      const head = live?.head;
      if (head !== undefined && this.trailFar > 0) {
        const back = !!live?.back;
        const far = back ? Math.min(L, head + this.trailFar) : Math.max(0, head - this.trailFar);
        const w = Math.abs(head - far);
        this.trail.visible = w >= 1 && out > 0.003;
        this.trail.position.set(head, 0);
        this.trail.scale.x = ((back ? -1 : 1) * w) / TRAIL_W;
        this.trail.tint = COL.e;
        this.trail.alpha = al(A.hot * out);
      } else this.trail.visible = false;
      c0 = from;
      c1 = to;
      ca = A.chev * out;
      this.tintChev(COL.o, !!live?.flip);
    }
    for (const ch of this.chev) {
      let a = ch.d >= c0 && ch.d <= c1 ? ca : 0;
      if (a > 0 && cam) {
        const x = this.x0 + ch.wx;
        const y = this.y0 + ch.wy;
        if (x < cam.x - 16 || x > cam.x + 496 || y < cam.y - 16 || y > cam.y + 286) a = 0;
      }
      for (const s of ch.s) {
        s.visible = a > 0.003;
        s.alpha = al(a);
      }
    }
    this.tick(dt);
  }

  private chevTint = -1;
  private chevFlip = false;
  private tintChev(tint: number, flip: boolean) {
    if (tint === this.chevTint && flip === this.chevFlip) return;
    this.chevTint = tint;
    this.chevFlip = flip;
    for (const ch of this.chev)
      for (const s of ch.s) {
        s.tint = tint;
        s.texture = flip ? ch.back : ch.tex;
      }
  }
}

// ---------- 圆：爆符鬼炸开的范围 ----------
/** 判定是「离圆心不超过 R」的预警：圆从中心往外推亮。圆心可以跟着走（被撞开的爆符鬼）。 */
export class DiskWarn extends Warn {
  readonly R: number;
  private base: Sprite;
  private lit: Sprite;
  constructor(layer: WarnLayer, x: number, y: number, R: number) {
    super(layer);
    this.R = R;
    this.c.position.set(Math.round(x), Math.round(y));
    this.base = maxSprite(diskTex(R), this.c);
    this.lit = maxSprite(diskTex(1), this.c);
  }
  move(x: number, y: number) {
    this.c.position.set(Math.round(x), Math.round(y));
  }
  draw(dt: number, k: number) {
    const ap = this.appear();
    const out = this.out();
    const fl = this.flash();
    const R = this.R;
    if (fl) {
      this.setDisk(this.base, R, flashTint(fl), flashAlpha(fl) * out);
      this.lit.visible = false;
    } else if (!this.struck) {
      // 淡入时从 0.6 倍半径展开到整圆；亮红从中心往外推
      this.setDisk(this.base, Math.round(R * (0.6 + 0.4 * easeOut(ap))), COL.e, A.base * ap * out);
      this.setDisk(this.lit, Math.round(R * clamp01(k)), COL.e, A.lit * ap * out);
    } else {
      this.setDisk(this.base, R, COL.e, A.hot * out);
      this.lit.visible = false;
    }
    this.tick(dt);
  }
  private setDisk(s: Sprite, r: number, tint: number, alpha: number) {
    s.visible = r >= 1 && alpha > 0.003;
    if (!s.visible) return;
    s.texture = diskTex(r);
    s.tint = tint;
    s.alpha = al(alpha);
  }
}

// ---------- 半圆横扫：混天绫 ----------
const SWEEP_N = 48;
/**
 * 以 (x, y) 为圆心、半径 R 的扇面（默认半圆：arc = π），从角 a0 朝 dir 方向扫过 arc（起始边那一侧多出 margin 像素，见 wedgeTex）。
 * 切成 48 片：淡入时像扇子一样从起始边展开；亮红沿扫的方向一片一片推过去（推到的那一片按进度半亮，前沿不生硬）；
 * 出手后扫过的那几片慢慢淡掉，还没扫到的保持亮着。第三章的扇形剑气、四剑环斩用 arc 小于 π 的扇面。
 */
export class SweepWarn extends Warn {
  private slices: Sprite[] = [];
  private passed: number[] = [];
  private chev: { s: Sprite; q: number }[] = [];
  private arc: number;
  constructor(layer: WarnLayer, x: number, y: number, R: number, a0: number, dir: 1 | -1, margin: number, arc = Math.PI) {
    super(layer);
    this.arc = arc;
    this.c.position.set(x, y);
    this.c.rotation = a0;
    this.c.scale.y = dir;
    const D = arc / SWEEP_N;
    for (let i = 0; i < SWEEP_N; i++) {
      const w = wedgeTex(R, SWEEP_N, i === 0 ? 'first' : i === SWEEP_N - 1 ? 'last' : 'mid', margin, arc);
      const s = maxSprite(w.tex, this.c, w.ax, w.ay);
      s.rotation = i * D;
      this.slices.push(s);
      this.passed.push(-1);
    }
    // 方向提示：0.62 倍半径处一排顺着扫动方向的小箭头（不跟着容器转：纹理按世界里的方向画好）
    const holder = new Container();
    this.c.addChild(holder);
    holder.scale.y = dir; // 抵掉容器的镜像和旋转，回到世界方向
    holder.rotation = -a0 * dir;
    const rr = R * 0.62;
    for (let j = 1; j <= 6; j++) {
      const q = j / 7;
      const a = a0 + dir * arc * q;
      const t = chevTex(a + (dir * Math.PI) / 2, 3, true);
      const s = maxSprite(t.tex, holder, t.c / t.size, t.c / t.size);
      s.position.set(Math.round(x + Math.cos(a) * rr) - x, Math.round(y + Math.sin(a) * rr) - y);
      this.chev.push({ s, q });
    }
  }

  /** k：预警进度；prog：出手后扫过的角度（0..arc），出手前不用。 */
  draw(dt: number, k: number, prog = 0) {
    const ap = this.appear();
    const out = this.out();
    const fl = this.flash();
    const N = SWEEP_N;
    const D = this.arc / N;
    for (let i = 0; i < N; i++) {
      const s = this.slices[i];
      let tint = COL.e;
      let a: number;
      if (fl) {
        tint = flashTint(fl);
        a = flashAlpha(fl);
      } else if (!this.struck) {
        if (i >= Math.ceil(N * easeOut(ap))) a = 0; // 淡入：从起始边像扇子一样展开
        else a = (A.base + (A.lit - A.base) * clamp01(k * N - i)) * ap;
      } else {
        if (this.passed[i] < 0 && prog >= (i + 1) * D) this.passed[i] = this.st;
        a = this.passed[i] < 0 ? A.hot : A.hot * (1 - clamp01((this.st - this.passed[i]) / WARN_TRAIL));
      }
      a *= out;
      s.visible = a > 0.003;
      s.tint = tint;
      s.alpha = al(a);
    }
    for (const ch of this.chev) {
      let a = 0;
      if (fl) a = flashAlpha(fl);
      else if (!this.struck) a = k >= ch.q ? A.chev * ap : 0;
      else a = prog < ch.q * this.arc ? A.chev : 0;
      a *= out;
      ch.s.visible = a > 0.003;
      ch.s.alpha = al(a);
      ch.s.tint = fl ? flashTint(fl) : COL.o;
    }
    this.tick(dt);
  }
}

// ---------- 方格：第三章剑雨的一格 ----------
/** 判定是「中心离格子中心横竖都不超过 h」的预警：方格从中心往外推亮（和圆一样的推法）。 */
export class BoxWarn extends Warn {
  readonly h: number;
  private base: Sprite;
  private lit: Sprite;
  constructor(layer: WarnLayer, x: number, y: number, h: number) {
    super(layer);
    this.h = h;
    this.c.position.set(Math.round(x), Math.round(y));
    this.base = maxSprite(boxTex(h), this.c);
    this.lit = maxSprite(boxTex(1), this.c);
  }
  draw(dt: number, k: number) {
    const ap = this.appear();
    const out = this.out();
    const fl = this.flash();
    const h = this.h;
    if (fl) {
      this.setBox(this.base, h, flashTint(fl), flashAlpha(fl) * out);
      this.lit.visible = false;
    } else if (!this.struck) {
      this.setBox(this.base, Math.round(h * (0.6 + 0.4 * easeOut(ap))), COL.e, A.base * ap * out);
      this.setBox(this.lit, Math.round(h * clamp01(k)), COL.e, A.lit * ap * out);
    } else {
      this.setBox(this.base, h, COL.e, A.hot * out);
      this.lit.visible = false;
    }
    this.tick(dt);
  }
  private setBox(s: Sprite, r: number, tint: number, alpha: number) {
    s.visible = r >= 1 && alpha > 0.003;
    if (!s.visible) return;
    s.texture = boxTex(r);
    s.tint = tint;
    s.alpha = al(alpha);
  }
}
