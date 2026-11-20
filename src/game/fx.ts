// 法宝的画面：把模拟发出的事件（突刺、火罩、落雷、砸印、冰棱、护盾……）和世界状态（乾坤圈、飞刀、地面区域、延时效果、
// 敌人身上的五行印记 / 灼烧 / 流血 / 冰冻）变成像素特效。宠物的画面在 pet-fx.ts，战场掉落在 drops-fx.ts。
// 只作用在表现层（可以用 Math.random）；模拟由 sim 负责，这里只读。
//
// 用户口径（逐条给过的）：
// - 特效要看得见、精致、华丽，帧数足；出现和消失都要有过程（淡入淡出、收尾），整体节奏放慢，不要一闪而过。
// - 每次升阶都要看得出变化：凡、灵是变大变多，仙品是质变的画面，神品是器灵的画面（每件两个器灵各自不同）。
// - 人物、武器身上不要俗气的发光圆圈 / 光圈 / 光晕：一律用线条、像素粒子、小精灵、形状来表现。
// - 法宝不会打散敌人的弹道（不再有 dispel），这里也不表现。
//
// 结构：纹理缓存（含按方向转好的精灵）→ 动画小精灵粒子（Bits）→ 逐像素笔刷（Pixels，每帧重画）→ 各件法宝的效果对象。
import { Container, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { PAL32, flashTextureFromGrid, textureFromGrid } from '../render/textures.ts';
import { WUXING_MARK } from '../art/sprites/wuxing-marks.ts';
import { borrowStrokeTable, packXY, packable, returnStrokeTable, type PixelBuffer, type StrokeTable } from '../render/pixel-raster.ts';
import { PixelSurface } from '../render/pixel-surface.ts';
import { boltBox, rasterBolt } from '../render/bolt-raster.ts';
import { borrowScratch, commitScratch, returnScratch, type Scratch } from '../render/scratch-tex.ts';
import { pixelTextTexture } from '../render/pixel-text.ts';
import { flipX, type Grid } from '../art/pixel.ts';
import {
  BLOOD_DROP,
  BLOOD_DROP_BIG,
  BLOOD_SPLAT,
  crackFrames,
  EMBER,
  FLAME_SIZES,
  flameFrames,
  frostFrames,
  GOLD_PETAL,
  iceClusterFrames,
  ICE_CHIPS,
  iceCrust,
  lined,
  lotusFrames,
  PEAR_BLOSSOM,
  PEAR_PETAL,
  puffFrames,
  Px,
  ROCKS,
  rotSprite,
  WOUND,
  scorch,
  SLASH,
  SNOWFLAKE,
  STAR,
  THUNDER_MARK,
  type BoltPath,
  type BoltStyle,
} from '../art/sprites/fx.ts';
import {
  DRAGON_HEAD,
  DRAGON_HEAD_GOLD,
  DRAGON_PIVOT,
  BELL_H,
  BELL_MOUTH,
  BELL_W,
  bellGrid,
  FLAG_CLOTH,
  FLAG_FOOT,
  FLAG_H,
  FLAG_W,
  flagFrames,
  KNIFE,
  KNIFE_SEL,
  KNIFE_TIP,
  sealGrid,
  SPEAR_SEL,
  SPEAR_TIP,
  spearGrid,
  WINGED_KNIFE,
  WINGED_TIP,
  type SealGlyph,
} from '../art/sprites/weapons.ts';
import { REACTIONS } from '../sim/catalog.ts';
import type { Element, Enemy, ReactionKind, SimEvent, WeaponKind, Zone } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

// ================================================================ 小工具

const TAU = Math.PI * 2;
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
export const easeIn = (k: number) => clamp01(k) ** 2;
export const easeInOut = (k: number) => {
  k = clamp01(k);
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
};
/** 淡入淡出：t 在 [0, life] 内，前 fi 秒淡入、最后 fo 秒淡出。 */
export const fade = (t: number, life: number, fi: number, fo: number) => clamp01(Math.min(fi > 0 ? t / fi : 1, fo > 0 ? (life - t) / fo : 1));

// 调色板里常用的颜色（数值版，给 Graphics 和粒子用）
export const C = {
  k: 0x1a1520,
  d: 0x2e2433,
  g: 0x4a3b4a,
  h: 0x6b5a62,
  i: 0x9a8a86,
  j: 0xc9bcae,
  w: 0xf2e8d5,
  R: 0x5c1a1b,
  r: 0x9c2a22,
  e: 0xd9452b,
  o: 0xf2814a,
  B: 0x6b3d1e,
  b: 0xb06a28,
  y: 0xe0a83a,
  Y: 0xf7dc7a,
  N: 0x1d2b4a,
  n: 0x2f5373,
  c: 0x3f8a9e,
  Cc: 0x7cc4c4,
  G: 0x1f3b2c,
  v: 0x3a6b43,
  l: 0x6fa35a,
  L: 0xb8d67a,
  P: 0x4b2a4f,
  p: 0x8a4a7a,
  m: 0xd47aa0,
  W: 0xffffff,
  f: 0xffe9a8,
};
export const FIRE_SPARKS = [C.Y, C.o, C.e, C.f];
export const ICE_SPARKS = [C.W, C.Cc, C.f];
export const GOLD_SPARKS = [C.Y, C.f, C.W, C.y];

// ================================================================ 纹理缓存

const texCache = new Map<string, Texture>();
const setCache = new Map<string, Texture[]>();
export function T(key: string, make: () => Grid): Texture {
  let t = texCache.get(key);
  if (!t) {
    t = textureFromGrid(make());
    texCache.set(key, t);
  }
  return t;
}
export function Ts(key: string, make: () => Grid[]): Texture[] {
  let t = setCache.get(key);
  if (!t) {
    t = make().map(textureFromGrid);
    setCache.set(key, t);
  }
  return t;
}

export interface RotTex {
  tex: Texture;
  /** 旋转中心在纹理里的位置（像素）。 */
  ax: number;
  ay: number;
}
const rotCache = new Map<string, RotTex>();
/**
 * 按方向转好的精灵（RotSprite），方向量化成 steps 档并缓存。mirror：朝左时先水平镜像再转，免得角、翅膀倒过来。
 * sel 给了就在转好之后描一圈同色系边。
 */
export function rotTex(key: string, g: Grid, angle: number, px: number, py: number, steps: number, sel?: Record<string, string>, mirror = false): RotTex {
  const [idx, flip] = rotSlot(angle, steps, mirror);
  const ck = `${key}:${idx}:${flip ? 1 : 0}`;
  let r = rotCache.get(ck);
  if (!r) {
    r = makeRot(g, idx, flip, px, py, steps, sel);
    rotCache.set(ck, r);
    warmRot(key, g, px, py, steps, sel, mirror);
  }
  return r;
}
/** 这个角度落在第几档、要不要先镜像（rotTex 和后台预生成共用）。 */
function rotSlot(angle: number, steps: number, mirror: boolean): [number, boolean] {
  let a = ((angle % TAU) + TAU) % TAU;
  let flip = false;
  if (mirror && Math.cos(a) < 0) {
    flip = true;
    a = (((a - Math.PI) % TAU) + TAU) % TAU; // 镜像后的图朝左，转剩下的角度
  }
  return [Math.round((a / TAU) * steps) % steps, flip];
}
function makeRot(g: Grid, idx: number, flip: boolean, px: number, py: number, steps: number, sel?: Record<string, string>): RotTex {
  const src = flip ? flipX(g) : g;
  const rot = rotSprite(src, (idx / steps) * TAU, flip ? g.w - px : px, py);
  const out = sel ? lined(rot.g, 'k', sel) : rot.g;
  const pad = sel ? 1 : 0;
  return { tex: textureFromGrid(out), ax: rot.ax + pad, ay: rot.ay + pad };
}
// 后台预生成（docs/perf.md）：转一档要先放大八倍再转再缩回来，一档一两毫秒、手机上要好几倍；一件兵器头一回往新的方向飞时
// 一帧里现转好几档，正打着就顿一下。所以某个 key 头一回用到时，把它其余各档排进队列，趁主线程空着（requestIdleCallback，
// 没有就隔一帧做一点）一档一档转好。转出来的和现转的一模一样，只是早一点。
const warmedRot = new Set<string>();
const rotQueue: (() => boolean)[] = [];
let rotPumping = false;
function warmRot(key: string, g: Grid, px: number, py: number, steps: number, sel: Record<string, string> | undefined, mirror: boolean) {
  if (warmedRot.has(key) || typeof window === 'undefined') return;
  warmedRot.add(key);
  for (let i = 0; i < steps * 2; i++) {
    const [idx, flip] = rotSlot((i / (steps * 2)) * TAU, steps, mirror);
    const ck = `${key}:${idx}:${flip ? 1 : 0}`;
    rotQueue.push(() => {
      if (rotCache.has(ck)) return false;
      rotCache.set(ck, makeRot(g, idx, flip, px, py, steps, sel));
      return true;
    });
  }
  if (!rotPumping) {
    rotPumping = true;
    idle(pumpRot);
  }
}
type Idle = { timeRemaining(): number; didTimeout?: boolean };
const idle = (fn: (d: Idle) => void) => {
  const ric = (window as Window & { requestIdleCallback?: (cb: (d: Idle) => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 1000 });
  else setTimeout(() => fn({ timeRemaining: () => 4, didTimeout: true }), 50);
};
/** 转一档大概要多久（毫秒，按上一次量的）：空闲的时间比它长才动手，免得把下一帧挤掉。 */
let rotCost = 4;
function pumpRot(d: Idle) {
  // 一次最多转一档；空闲时间不够就等下一次（一直不空闲、到点硬叫醒时也只转一档）
  while (rotQueue.length) {
    if (!d.didTimeout && d.timeRemaining() < rotCost + 2) break;
    const t0 = performance.now();
    const did = rotQueue.shift()!();
    if (!did) continue; // 已经有了的跳过（不花时间）
    rotCost = Math.max(1, performance.now() - t0);
    break;
  }
  if (rotQueue.length) idle(pumpRot);
  else rotPumping = false;
}
export function applyRot(s: Sprite, r: RotTex) {
  s.texture = r.tex;
  s.anchor.set(r.ax / r.tex.width, r.ay / r.tex.height);
}

/** 影子：一像素精度的实心椭圆（玄色，靠 sprite.alpha 控制浓淡）。 */
export function shadowTex(rx: number): Texture {
  const R = Math.max(1, Math.round(rx));
  return T(`shadow${R}`, () => {
    const ry = Math.max(1, Math.round(R * 0.45));
    const p = new Px(R * 2 + 1, ry * 2 + 1);
    for (let y = -ry; y <= ry; y++)
      for (let x = -R; x <= R; x++) if ((x / (R + 0.3)) ** 2 + (y / (ry + 0.3)) ** 2 <= 1) p.set(x + R, y + ry, 'k');
    return p.grid();
  });
}

// 常用的帧组（第一次用到时才生成）
export const flameSet = (i: number) => Ts(`flame${i}`, () => flameFrames(FLAME_SIZES[i][0], FLAME_SIZES[i][1], 8, i + 1));
export const FLAMES = () => FLAME_SIZES.map((_, i) => flameSet(i));
export const puffSet = (r: number, tone: 'stone' | 'snow' | 'smoke' | 'gold', seed = 1) => Ts(`puff${r}${tone}${seed}`, () => puffFrames(r, 6, tone, seed));

// ================================================================ 动画小精灵粒子
/** 火苗各档的帧表：每簇火苗每帧都要查，算一次存起来（FLAMES() 每调一次都要新拼一张表）。 */
let flameSets: Texture[][] | null = null;
const flames = () => (flameSets ??= FLAMES());
/** 一波打完之后，池里闲着的小精灵最多留这么多（多的销毁，免得一场大战之后几千个隐藏的精灵一直挂在场景里）。 */
const BITS_KEEP = 384;

export interface Bit {
  s: Sprite;
  frames: Texture[];
  /** 火苗：按寿命阶段换尺寸档（FLAMES 的下标序列），帧在档内循环。 */
  sizes: number[] | null;
  fps: number;
  loop: boolean;
  fo: number; // 帧偏移，免得一群火苗同步闪
  t: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  fi: number;
  fout: number;
  a: number;
  ground: number | null;
  bounce: number;
  z: boolean;
  zOff: number;
  /** 跟着某个点走（每帧取一次位置）。 */
  follow: (() => [number, number] | null) | null;
  ox: number;
  oy: number;
}
export interface BitOpts {
  frames?: Texture[];
  sizes?: number[];
  fps?: number;
  loop?: boolean;
  life: number;
  delay?: number;
  vx?: number;
  vy?: number;
  g?: number;
  drag?: number;
  fadeIn?: number;
  fadeOut?: number;
  alpha?: number;
  ground?: number;
  bounce?: number;
  anchor?: [number, number];
  /** 放进 entities 层（按 y 排序，能被人物挡住 / 挡住人物）。 */
  z?: boolean;
  zOff?: number;
  layer?: Container;
  tint?: number;
  blend?: 'add' | 'normal';
  follow?: () => [number, number] | null;
}

export class Bits {
  private pool: Sprite[] = [];
  private live: Bit[] = [];
  private def: Container;
  private ent: Container;
  constructor(def: Container, ent: Container) {
    this.def = def;
    this.ent = ent;
  }
  spawn(x: number, y: number, o: BitOpts): Bit {
    const s = this.pool.pop() ?? new Sprite();
    const parent = o.z ? this.ent : (o.layer ?? this.def);
    if (s.parent !== parent) parent.addChild(s);
    const frames = o.sizes ? flames()[o.sizes[0]] : (o.frames ?? []);
    s.texture = frames[0];
    s.visible = false;
    s.alpha = 0;
    s.tint = o.tint ?? 0xffffff;
    s.blendMode = o.blend ?? 'normal';
    s.scale.set(1);
    s.anchor.set(...(o.anchor ?? (o.sizes ? [0.5, 1] : [0.5, 0.5])));
    const b: Bit = {
      s,
      frames,
      sizes: o.sizes ?? null,
      fps: o.fps ?? 10,
      loop: o.loop ?? !!o.sizes,
      fo: Math.floor(Math.random() * 8),
      t: -(o.delay ?? 0),
      life: o.life,
      x,
      y,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      g: o.g ?? 0,
      drag: o.drag ?? 0,
      fi: o.fadeIn ?? 0.06,
      fout: o.fadeOut ?? o.life * 0.4,
      a: o.alpha ?? 1,
      ground: o.ground ?? null,
      bounce: o.bounce ?? 0,
      z: !!o.z,
      zOff: o.zOff ?? 0,
      follow: o.follow ?? null,
      ox: 0,
      oy: 0,
    };
    if (b.follow) {
      const p = b.follow();
      if (p) {
        b.ox = x - p[0];
        b.oy = y - p[1];
      }
    }
    this.live.push(b);
    return b;
  }
  update(dt: number) {
    // 从后往前过一遍：播完的回池，没播完的原样往数组尾部收拢，最后整体挪回开头
    // （顺序和逐个 splice 一样，但每帧只挪一次；splice 每删一个都要把后面的全挪一格）
    const live = this.live;
    const n = live.length;
    let w = n;
    const sets = flames();
    for (let i = n - 1; i >= 0; i--) {
      const b = live[i];
      b.t += dt;
      if (b.t >= b.life) {
        b.s.visible = false;
        this.pool.push(b.s);
        continue;
      }
      live[--w] = b;
      if (b.t < 0) continue;
      const k = b.t / b.life;
      // 位置
      if (b.follow) {
        const p = b.follow();
        if (p) {
          b.x = p[0] + b.ox;
          b.y = p[1] + b.oy;
        }
        b.ox += b.vx * dt;
        b.oy += b.vy * dt;
      } else {
        const dk = b.drag ? Math.exp(-b.drag * dt) : 1;
        b.vx *= dk;
        b.vy = b.vy * dk + b.g * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.ground !== null && b.y > b.ground) {
          b.y = b.ground;
          if (b.bounce > 0 && Math.abs(b.vy) > 25) {
            b.vy = -b.vy * b.bounce;
            b.vx *= 0.6;
          } else {
            b.vy = 0;
            b.vx *= 0.5;
            b.g = 0;
          }
        }
      }
      // 帧
      let tex: Texture;
      if (b.sizes) {
        const set = sets[b.sizes[Math.min(b.sizes.length - 1, Math.floor(k * b.sizes.length))]];
        tex = set[(Math.floor(b.t * b.fps) + b.fo) % set.length];
      } else if (b.loop) tex = b.frames[(Math.floor(b.t * b.fps) + b.fo) % b.frames.length];
      else tex = b.frames[Math.min(b.frames.length - 1, Math.floor(k * b.frames.length))];
      if (b.s.texture !== tex) b.s.texture = tex;
      b.s.visible = true;
      b.s.alpha = b.a * fade(b.t, b.life, b.fi, b.fout);
      b.s.position.set(Math.round(b.x), Math.round(b.y));
      if (b.z) b.s.zIndex = b.y + b.zOff;
    }
    if (w > 0) {
      live.copyWithin(0, w);
      live.length -= w;
    }
  }
  clear() {
    // 从后往前回池（和逐个播完时回池的先后一样：池里的精灵重新用起来时，前后叠放的次序和原来一致）
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      b.s.visible = false;
      this.pool.push(b.s);
    }
    this.live.length = 0;
    // 一波开始 / 结束时调到这里：趁这会儿把池收小
    while (this.pool.length > BITS_KEEP) this.pool.pop()!.destroy();
  }
  get count() {
    return this.live.length;
  }
}

// ================================================================ 逐像素笔刷（每帧重画）

/** 按颜色 + 透明度分组收集像素，一组只 fill 一次。画在整数像素上，不糊。 */
export class Pixels {
  private groups = new Map<number, number[]>();
  // ↑ 正在收集的这一帧：组号（颜色 × 16 + 透明度档 1..12）→ 这一组的像素（packXY 打包的坐标），按第一次出现的先后排
  /** 上一次 flush 交出去、现在显示着的那一帧（镜头动了要照着它重画，所以留着）。 */
  private shown = new Map<number, number[]>();
  private surface = new PixelSurface();
  /**
   * 画出来的那张图。原来这里是一个 Graphics，每帧把每个像素建成一个 1×1 的矩形（火行构筑一帧四五千个，
   * Pixi 光重建它们的几何就一两毫秒）；现在整层是一块画面大小的像素缓冲、一张精灵（见 render/pixel-surface.ts）。
   */
  readonly g = this.surface.sprite;
  private lastKey = -1;
  private lastGroup: number[] = [];
  dot(x: number, y: number, color: number, alpha = 1) {
    const a = Math.round(clamp01(alpha) * 12);
    if (a <= 0) return;
    x = Math.round(x);
    y = Math.round(y);
    if (packable(x, y)) this.push(packXY(x, y), color * 16 + a);
  }
  /** 同 dot，坐标是已经打包好的（Stroke 提交时走这里，省掉重复的取整）。 */
  putKey(key: number, color: number, alpha: number) {
    const a = Math.round(clamp01(alpha) * 12);
    if (a > 0) this.push(key, color * 16 + a);
  }
  private push(key: number, group: number) {
    // 连着点的像素多半同色同透明度：记住上一组，省一次查表
    if (group !== this.lastKey) {
      let arr = this.groups.get(group);
      if (!arr) {
        arr = [];
        this.groups.set(group, arr);
      }
      this.lastKey = group;
      this.lastGroup = arr;
    }
    this.lastGroup.push(key);
  }
  /** 一像素直线（Bresenham）。 */
  line(x0: number, y0: number, x1: number, y1: number, color: number, alpha = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 800; n++) {
      this.dot(x0, y0, color, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** 把显示着的那一帧画进缓冲：一组一组按先后叠上去（和原来一组一组 fill 是一个结果）。 */
  private paint = (buf: PixelBuffer) => {
    for (const [group, keys] of this.shown) buf.fill(keys, keys.length, Math.floor(group / 16), ALPHA_255[group % 16]);
  };
  /** 这一帧收集完了：交给画面，换一张空表接着收下一帧。 */
  flush() {
    const frame = this.groups;
    this.groups = this.shown;
    this.shown = frame;
    this.groups.clear();
    this.lastKey = -1;
    this.surface.set(frame.size ? this.paint : null);
  }
}
/** 透明度档（1..12）→ 0..255。 */
const ALPHA_255 = Array.from({ length: 16 }, (_, a) => Math.round((Math.min(12, a) / 12) * 255));

// ================================================================ 效果对象

export interface Ctx {
  bits: Bits;
  top: Pixels; // 角色之上
  under: Pixels; // 贴地
  sparks: Particles;
  glows: Particles;
  stage: Stage;
  layer: Container; // 角色之上的特效层
  floor: Container; // 贴地层
  shake: Shake;
  sound(name: string, vol?: number, gap?: number): void;
  /** 敌人这一帧插值后的脚底位置（没了就是 null）。 */
  enemyPos(id: number): [number, number] | null;
  enemy(id: number): Enemy | undefined;
  time: number;
  /**
   * 落点的那一下交给别处画（xfx.ts 的修仙版：番天印落地 slam、雷落下的落点 zap、斩仙飞刀穿过 knife）：返回 true 就不画这里的尘浪碎石 / 火星电弧 / 刀光。
   * 没有就照旧画。r 是判定半径（slam）或 0；style 是雷的颜色（zap）。
   */
  impactFx?: (what: 'slam' | 'zap' | 'knife', x: number, y: number, r: number, tier: number, style?: string) => boolean;
}

export interface Effect {
  /** 返回 false 表示播完了。 */
  update(dt: number, ctx: Ctx, w: World, alpha: number): boolean;
  destroy(): void;
}

/** 方向向量与法线。 */
export function dirOf(x0: number, y0: number, x1: number, y1: number) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  return { len, ux, uy, nx: -uy, ny: ux, ang: Math.atan2(uy, ux) };
}

/** 一笔粗线：同一像素只留优先级最高的颜色（芯 > 身 > 边），再交给 Pixels。 */
export class Stroke {
  private m = new Map<number, [number, number, number]>();
  // ↑ 像素 → [颜色, 透明度, 优先级]。平时用不到：像素先记在一张借来的定长表里（比 Map 快得多，一帧要点两万多次），
  //   只有一笔的像素多到表里放不下时，多出来的才放进这个 Map（规则一样）
  private table: StrokeTable | null = null;
  dot(x: number, y: number, color: number, alpha: number, prio: number) {
    this.put(Math.round(x), Math.round(y), color, alpha, prio);
  }
  /** 同 dot，坐标已经是整数（stamp、taperedStreak 这些一次点几百上千个像素的走这里）。 */
  put(x: number, y: number, color: number, alpha: number, prio: number) {
    if (!packable(x, y)) return;
    const k = packXY(x, y);
    const t = this.table ?? (this.table = borrowStrokeTable());
    if (t.put(k, color, alpha, prio)) return;
    const cur = this.m.get(k);
    if (!cur) this.m.set(k, [color, alpha, prio]);
    else if (cur[2] < prio || (cur[2] === prio && cur[1] < alpha)) {
      cur[0] = color;
      cur[1] = alpha;
      cur[2] = prio;
    }
  }
  commit(px: Pixels) {
    const t = this.table;
    if (!t) return;
    t.drain(px);
    this.table = null;
    returnStrokeTable(t);
    if (this.m.size) {
      for (const [k, v] of this.m) px.putKey(k, v[0], v[1]);
      this.m.clear();
    }
  }
}

/**
 * 一道锥形的光（枪芒、飞刀光尾）：从 s0 到 s1（沿方向的距离），前端收尖、尾端变细变淡。
 * cols：[芯, 身, 外, 边]（边是深色描边，浅色地面上压得住）。
 */
export function taperedStreak(st: Stroke, ox: number, oy: number, ux: number, uy: number, s0: number, s1: number, hw: number, alpha: number, cols: [number, number, number, number]) {
  if (s1 - s0 < 0.5) return;
  const nx = -uy;
  const ny = ux;
  for (let s = s0; s <= s1; s += 0.5) {
    const k = (s - s0) / (s1 - s0);
    const tip = clamp01((s1 - s) / 7);
    const w = hw * Math.sqrt(tip) * (0.5 + 0.5 * k);
    const a = alpha * (0.6 + 0.4 * k);
    const lim = Math.ceil(w) + 2;
    for (let o = -lim; o <= lim; o += 0.5) {
      // 芯、身、外焰各占一档，最外面一像素深色边（浅色地面、金色阵法上都压得住）
      const d = Math.abs(o) / (w + 0.5);
      if (d > 1.45) continue;
      const band = d < 0.28 ? 0 : d < 0.62 ? 1 : d < 1.02 ? 2 : 3;
      st.put(Math.round(ox + ux * s + nx * o), Math.round(oy + uy * s + ny * o), cols[band], a, 4 - band);
    }
  }
}

// ---------------------------------------------------------------- 火尖枪

interface ThrustStyle {
  fire: boolean; // 烧红的枪头（仙、神）
  reach: number; // 枪尖往前送多远
  hw: number; // 枪芒半宽
  flameEvery: number; // 拖尾火苗的间距
  flameSizes: number[][];
  flameLife: [number, number];
  pear: boolean; // 神品「梨花枪」
  sun: boolean; // 神品「贯日」
  hold: number; // 停顿
}

// 模拟在出手那一帧就结算了伤害，所以枪芒必须马上飞到头（约 0.07 秒）；枪身本身的刺、停、收可以慢一些。
/**
 * 枪的每一帧网格，同一个 key 给同一个对象。转向的缓存（rotTex → rotSprite）是按网格对象记放大过的底图的：
 * 原来每帧现拼一张新网格，转到没转过的角度时就要把底图重新放大三遍（梨花枪一帧要零点几毫秒）。
 */
const spearGrids = new Map<string, Grid>();
function spearOf(key: string, fire: boolean, tassel: number, flick: number): Grid {
  let g = spearGrids.get(key);
  if (!g) spearGrids.set(key, (g = spearGrid(fire, tassel, flick)));
  return g;
}

const T_ANT = 0.03; // 回手
const T_OUT = 0.13; // 刺出（缓出）
const T_BACK = 0.26; // 收回

/** 火尖枪的一次突刺：一杆手绘的枪从哪吒手里刺出、停一下、再收回；枪芒沿路飞出去，留下一串渐隐的火苗。 */
class Thrust implements Effect {
  private t: number;
  private s = new Sprite();
  private d;
  private ox: number;
  private oy: number;
  private st: ThrustStyle;
  private flamed = 0;
  private started = false;
  private pearDone = false;
  private rest = 15;
  private stroke = new Stroke();
  private ghosts = [new Sprite(), new Sprite()];
  private glint = false;
  constructor(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, st: ThrustStyle, delay: number) {
    this.t = -delay;
    this.ox = x0;
    this.oy = y0;
    this.d = dirOf(x0, y0, x1, y1);
    this.st = st;
    this.s.visible = false;
    for (const g of this.ghosts) {
      g.visible = false;
      g.tint = st.fire ? 0xffb070 : 0xffe0c0;
      ctx.layer.addChild(g);
    }
    ctx.layer.addChild(this.s);
  }
  private get total() {
    return T_ANT + T_OUT + this.st.hold + T_BACK;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const t = this.t;
    if (t < 0) return true;
    const st = this.st;
    const { ux, uy, len, ang, nx, ny } = this.d;
    if (!this.started) {
      this.started = true;
      ctx.sound('huojian.thrust');
    }
    // 枪尖离出手点的距离：先回手，再缓出刺到最远，停一下，再收回
    const ext = this.rest + st.reach;
    const t1 = T_ANT;
    const t2 = t1 + T_OUT;
    const t3 = t2 + st.hold;
    const t4 = t3 + T_BACK;
    let tip: number;
    if (t < t1) tip = this.rest - 4 * easeOut(t / t1);
    else if (t < t2) tip = this.rest - 4 + (st.reach + 4) * easeOut((t - t1) / T_OUT);
    else if (t < t3) tip = ext + (st.pear ? Math.round(Math.sin(t * 70)) : 0);
    else tip = ext - st.reach * 0.85 * easeInOut((t - t3) / T_BACK);
    // 枪
    if (t < t4) {
      const tassel = t < t1 ? 0 : t < t3 ? 1 : 2;
      const flick = Math.floor(t * 14) % 3;
      const key = `spear${st.fire ? 1 : 0}${tassel}${st.fire ? flick : 0}`;
      const rt = rotTex(key, spearOf(key, st.fire, tassel, flick), ang, SPEAR_TIP.x, SPEAR_TIP.y, 64, SPEAR_SEL);
      applyRot(this.s, rt);
      this.s.position.set(Math.round(this.ox + ux * tip), Math.round(this.oy + uy * tip));
      this.s.alpha = fade(t, t4, 0.06, 0.16);
      this.s.visible = true;
      // 刺出时身后拖两道残影
      const thrusting = t >= t1 && t < t2 + 0.04;
      this.ghosts.forEach((g, i) => {
        g.visible = thrusting;
        if (!thrusting) return;
        applyRot(g, rt);
        const back = (i + 1) * 5 * (1 - clamp01((t - t1) / (T_OUT + 0.04)));
        g.position.set(Math.round(this.ox + ux * (tip - back)), Math.round(this.oy + uy * (tip - back)));
        g.alpha = (i ? 0.18 : 0.35) * this.s.alpha;
      });
      // 刺到最远的一瞬，枪尖一闪
      if (!this.glint && t >= t2 - 0.02) {
        this.glint = true;
        ctx.bits.spawn(this.ox + ux * (ext - 1), this.oy + uy * (ext - 1), { frames: Ts('star', () => STAR).slice(1, 4), fps: 18, life: 0.2, fadeOut: 0.1, tint: st.fire ? C.Y : 0xffffff });
      }
    } else {
      this.s.visible = false;
      for (const g of this.ghosts) g.visible = false;
    }
    // 枪尖抖出的枪花（梨花枪）：停顿时两侧各一道虚影
    if (st.pear && t >= t2 && t < t3 + 0.05) {
      for (const o of [-3, 3]) {
        const px = this.ox + ux * (ext - 3) + nx * o;
        const py = this.oy + uy * (ext - 3) + ny * o;
        ctx.top.line(px, py, px + ux * 5, py + uy * 5, C.W, 0.55);
      }
    }
    if (st.pear && !this.pearDone && t >= t2) {
      this.pearDone = true;
      // 梨花：枪尖处迸出一团白色花瓣，往前飘散
      const tx = this.ox + ux * ext;
      const ty = this.oy + uy * ext;
      const petals = Ts('pear', () => PEAR_PETAL);
      const blossoms = Ts('pearB', () => PEAR_BLOSSOM);
      for (let i = 0; i < 14; i++) {
        const a = ang + rnd(-1.1, 1.1);
        const sp = rnd(25, 70);
        ctx.bits.spawn(tx + rnd(-2, 2), ty + rnd(-2, 2), { frames: i % 3 === 0 ? blossoms : petals, fps: rnd(6, 12), loop: true, life: rnd(0.9, 1.4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 8, g: 20, drag: 2.2, fadeIn: 0.06, fadeOut: 0.55 });
      }
      // 枪芒上也飘起几片
      for (let i = 0; i < 6; i++) {
        const s2 = rnd(ext, len);
        ctx.bits.spawn(this.ox + ux * s2, this.oy + uy * s2, { frames: petals, fps: rnd(8, 12), loop: true, life: rnd(0.7, 1.1), delay: rnd(0, 0.15), vx: rnd(-10, 10) + ux * 15, vy: rnd(-16, -4), g: 18, drag: 1.8, fadeOut: 0.45 });
      }
      for (let i = 0; i < 3; i++) ctx.bits.spawn(tx + rnd(-5, 5), ty + rnd(-4, 4), { frames: Ts('star', () => STAR).slice(1, 3), fps: 10, loop: true, life: 0.3, delay: i * 0.06, fadeOut: 0.15 });
    }
    // 枪芒：从枪尖飞到枪芒的尽头，尾巴跟上来，沿路落下火苗
    const sStart = 0.01;
    const sRun = st.sun ? 0.1 : 0.07;
    let alive = t < t4;
    if (t >= sStart) {
      const k = clamp01((t - sStart) / sRun);
      const front = ext + (len - ext) * easeOut(k);
      const lingerEnd = t2 + st.hold + (st.sun ? 0.22 : 0);
      const kt = clamp01((t - lingerEnd) / (st.sun ? 0.4 : 0.26));
      const tail = Math.min(front, Math.max(tip, ext * 0.7) + (len - Math.max(tip, ext * 0.7)) * easeIn(kt));
      if (kt < 1) {
        alive = true;
        const a = 1 - kt * 0.5;
        const cols: [number, number, number, number] = st.sun ? [C.W, C.f, C.Y, C.B] : st.fire ? [C.f, C.Y, C.e, C.R] : [C.W, C.Y, C.o, C.r];
        taperedStreak(this.stroke, this.ox, this.oy, ux, uy, tail, front, st.hw, a, cols);
        if (st.sun) {
          // 贯日：枪芒尽头一颗四角星芒，一明一暗
          const sx = this.ox + ux * front;
          const sy = this.oy + uy * front;
          const big = Math.floor(t * 12) % 2;
          for (let i = -4 - big; i <= 4 + big; i++) {
            this.stroke.dot(sx + i, sy, Math.abs(i) < 2 ? C.W : C.f, a, 5);
            this.stroke.dot(sx, sy + i, Math.abs(i) < 2 ? C.W : C.f, a, 5);
          }
        }
        this.stroke.commit(ctx.top);
      }
      // 拖尾火苗：间距、大小、寿命都错开，往枪的反方向飘一点
      while (this.flamed + st.flameEvery <= front) {
        this.flamed += st.flameEvery * rnd(0.7, 1.3);
        const j = rnd(-1.5, 1.5);
        ctx.bits.spawn(this.ox + ux * this.flamed + nx * j, this.oy + uy * this.flamed + ny * j + 2, {
          sizes: pick(st.flameSizes),
          fps: rnd(9, 13),
          life: rnd(...st.flameLife),
          delay: rnd(0, 0.06),
          vx: -ux * rnd(3, 10),
          vy: -rnd(4, 10),
          fadeIn: 0.05,
          fadeOut: 0.28,
        });
        if (Math.random() < 0.5) ctx.sparks.emit(this.ox + ux * this.flamed, this.oy + uy * this.flamed, 1, FIRE_SPARKS, [6, 18], [0.35, 0.7], { up: 16, drag: 2 });
      }
      if (k >= 1 && this.flamed < len - st.flameEvery) this.flamed = len;
    }
    return alive || t < t4 + 0.05;
  }
  destroy() {
    this.s.destroy();
    for (const g of this.ghosts) g.destroy();
  }
}

// ---------------------------------------------------------------- 九龙神火罩

/** 九龙吐焰：一条火龙从火罩里窜出去 —— 龙头在前，一条头粗尾细、带深边的火身子蜿蜒跟着，沿路落下火苗，到头化作火星。 */
class Dragon implements Effect {
  private t: number;
  private s = new Sprite();
  private d;
  private ox: number;
  private oy: number;
  private ph = Math.random() * TAU;
  private last: [number, number];
  private hist: [number, number, number][] = [];
  private stroke = new Stroke();
  private bodyCd = 0;
  private gold: boolean;
  private burst = false;
  constructor(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, delay: number, gold: boolean) {
    this.t = -delay;
    this.ox = x0;
    this.oy = y0;
    this.d = dirOf(x0, y0, x1, y1);
    this.last = [x0, y0];
    this.gold = gold;
    this.s.visible = false;
    ctx.layer.addChild(this.s);
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const t = this.t;
    if (t < 0) return true;
    const FLY = 0.42;
    const { ux, uy, nx, ny, len } = this.d;
    const k = clamp01(t / FLY);
    // 龙头（锚点在头中间）飞到离终点还差半个头的地方：张开的嘴正好到模拟里那一段火龙的尽头，不往外多喷
    const s = Math.max(0, len - 9) * easeOut(k);
    const wig = Math.sin(t * 15 + this.ph) * 5 * (1 - k * 0.5);
    const x = this.ox + ux * s + nx * wig;
    const y = this.oy + uy * s + ny * wig;
    const va = Math.atan2(y - this.last[1], x - this.last[0]);
    if (k < 1 && Math.hypot(x - this.last[0], y - this.last[1]) > 0.3) {
      applyRot(this.s, rotTex(this.gold ? 'dragonG' : 'dragon', this.gold ? DRAGON_HEAD_GOLD : DRAGON_HEAD, va, DRAGON_PIVOT.x, DRAGON_PIVOT.y, 16, undefined, true));
    }
    this.s.position.set(Math.round(x), Math.round(y));
    this.s.alpha = fade(t, FLY + 0.2, 0.05, 0.2);
    this.s.visible = t < FLY + 0.2;
    // 火身子：沿龙头走过的路（按时间截）画一条蜿蜒的火带
    if (k < 1) this.hist.unshift([x, y, t]);
    while (this.hist.length > 2 && t - this.hist[this.hist.length - 1][2] > 0.2) this.hist.pop();
    if (this.hist.length > 1) {
      const a = k < 1 ? 1 : Math.max(0, 1 - (t - FLY) / 0.2);
      polyStreak(this.stroke, this.hist.map((h) => [h[0], h[1]] as [number, number]), 3.2, a, this.gold ? [C.W, C.f, C.Y, C.B] : [C.f, C.Y, C.o, C.R]);
      this.stroke.commit(ctx.top);
    }
    this.bodyCd -= dt;
    if (k < 1 && this.bodyCd <= 0) {
      this.bodyCd = 0.03;
      ctx.bits.spawn(this.last[0], this.last[1] + 3, { sizes: this.gold ? [2, 3, 2, 1] : [1, 2, 2, 1], fps: 12, life: rnd(0.3, 0.42), vy: -6, fadeIn: 0.03, fadeOut: 0.18 });
    }
    if (k >= 1 && !this.burst) {
      this.burst = true;
      ctx.sparks.emit(x, y, 10, FIRE_SPARKS, [12, 30], [0.3, 0.6], { up: 14, drag: 3 });
      ctx.bits.spawn(x, y + 3, { sizes: [3, 4, 3, 1], fps: 12, life: 0.45, fadeOut: 0.22 });
    }
    this.last = [x, y];
    return t < FLY + 0.25;
  }
  destroy() {
    this.s.destroy();
  }
}

type Cols = [number, number, number, number];

/** 罩口离主人脚下多高（人连发髻约 28 高，罩悬在头顶上方一点，不压在人身上）。 */
const BELL_LIFT = 31;
/** 九龙神火罩的本体在罩口下面喷出的火：落到脚边就是火浪的起点。 */
const BELL_FIRE = [C.f, C.Y, C.o, C.e];

/**
 * 九龙神火罩的本体：悬在主人头顶的一口小金罩（weapons.ts 的 bellGrid，罩身 15 宽、连火舌 16 高，和人差不多宽）。
 * 从上面落下来、一震（罩口往下喷一团火星、罩顶一闪），悬着跟主人走；stay 变成 false 之后升起淡去。
 * 用户 2026-11-10：法宝都不能画得过大 —— 原来没有本体，整口罩是一副从脚下一圈弯到人头顶 140 多像素的火骨架。
 */
class BellView {
  private s = new Sprite();
  private t = 0;
  private leaveT = -1;
  private rang = false;
  private hot: boolean;
  private x = 0;
  private y = 0;
  constructor(ctx: Ctx, hot: boolean) {
    this.hot = hot;
    this.s.anchor.set((BELL_MOUTH.x + 0.5) / BELL_W, (BELL_MOUTH.y + 0.5) / BELL_H);
    this.s.visible = false;
    ctx.layer.addChild(this.s);
  }
  /** 罩口的位置（喷火、火柱从这里出）。 */
  get mouth(): [number, number] {
    return [this.x, this.y - BELL_LIFT];
  }
  /** (x, y)：主人脚下。stay：还悬着（false 之后升起淡去）。返回 false 表示走完了。 */
  update(dt: number, ctx: Ctx, x: number, y: number, stay: boolean): boolean {
    this.t += dt;
    this.x = x;
    this.y = y;
    if (!stay && this.leaveT < 0) this.leaveT = 0;
    if (this.leaveT >= 0) this.leaveT += dt;
    const t = this.t;
    const IN = 0.16;
    const OUT = 0.32;
    const drop = (1 - easeOut(clamp01(t / IN))) * 8; // 从高 8 像素处落下来
    const lift = this.leaveT > 0 ? easeIn(clamp01(this.leaveT / OUT)) * 6 : 0;
    const ring = t > 0.1 && t < 0.4 ? Math.round(Math.sin(t * 55) * (1 - (t - 0.1) / 0.3) * 1.2) : 0; // 落定那一下一震
    const a = clamp01(t / 0.1) * (this.leaveT > 0 ? 1 - clamp01(this.leaveT / OUT) : 1);
    const fr = Ts(`bell${this.hot ? 1 : 0}`, () => [0, 1, 2].map((f) => bellGrid(this.hot, f)));
    this.s.texture = fr[Math.floor(t * 12) % fr.length];
    this.s.position.set(Math.round(x + ring), Math.round(y - BELL_LIFT - drop - lift));
    this.s.alpha = a;
    this.s.visible = a > 0;
    if (!this.rang && t > 0.1) {
      this.rang = true;
      const [mx, my] = this.mouth;
      ctx.sparks.emit(mx, my + 2, this.hot ? 12 : 8, FIRE_SPARKS, [20, 50], [0.25, 0.45], { dir: Math.PI / 2, spread: 1.8, drag: 3, g: 60 });
      ctx.bits.spawn(mx + 1, my - 13, { frames: Ts('star', () => STAR).slice(1, 3), fps: 12, life: 0.25, fadeOut: 0.12 });
    }
    // 悬着的时候罩口零星滴下火星
    if (this.leaveT < 0 && t > 0.3 && Math.random() < (this.hot ? 0.3 : 0.15)) {
      const [mx, my] = this.mouth;
      ctx.glows.emit(mx + rnd(-6, 6), my + 2, 1, BELL_FIRE, [4, 12], [0.3, 0.55], { dir: Math.PI / 2, spread: 0.6, g: 30, drag: 1 });
    }
    return this.leaveT < OUT;
  }
  destroy() {
    this.s.destroy();
  }
}

interface DomeStyle {
  tier: number;
  wide: boolean; // 焚天
  nine: boolean; // 九龙吐焰
}

/** 火浪的颜色：芯、身、外焰、深边（浅色地面上也看得见）；拖在后面的那截暗一档。 */
const WAVE_COLS: Cols = [C.Y, C.o, C.e, C.R];
const WAVE_TAIL: Cols = [C.o, C.e, C.r, C.R];
const DOME_SQ = 0.78; // 地上的圆压扁成这么扁（3/4 俯视）
/** 火浪从脚下推到火墙要多久。 */
const DOME_WAVE = 0.3;

/**
 * 九龙神火罩：头顶一口小金罩落下来一震，罩口的火落到脚下，化成一圈贴地的火浪往外推，推到判定半径的 0.92 倍，
 * 那一圈火墙就窜起来（前后按 y 排序，后排的火在人物身后，前排矮、不挡人），烧旺、收成余烬。
 * 灵品火墙更高更密、罩里零星几簇火；焚天：两圈火墙、火更高，罩顶冲起一道短火柱。仙品起罩由火罩区域画（笼罩期间一直悬着）。
 * 所有的火都在判定圆（以胸口为心、半径 r）里面（用户 2026-11-10：效果不能画得比判定范围大；原来钟罩的火骨架顶到人头上 141–157 像素）。
 */
class Dome implements Effect {
  private t = 0;
  private x: number;
  private y: number;
  private r: number;
  private st: DomeStyle;
  private owner: number;
  private bell: BellView | null;
  private wave = new Stroke();
  private seed = Math.random() * TAU;
  private pillarCd = 0;
  constructor(ctx: Ctx, x: number, y: number, r: number, st: DomeStyle, owner: number) {
    this.x = x;
    this.y = y + 6; // 事件给的是胸口高度，火墙落在脚下
    this.r = r;
    this.st = st;
    this.owner = owner;
    const SQ = DOME_SQ;
    const n = Math.round((14 + r * 0.42) * (st.tier >= 2 ? 1.2 : 1) * (st.wide ? 1.25 : 1));
    // 火苗最高一档：凡 7×15、灵起 9×18（焚天也只到这一档：原来 11×22，后排的火比人还高）
    const sizes = st.wide ? [3, 5, 6, 6, 6, 5, 3, 1] : st.tier >= 2 ? [2, 5, 6, 6, 6, 5, 3, 1] : [2, 4, 5, 5, 5, 4, 2, 1];
    // 火墙：后排高、两侧中、前排矮（不挡住人），一高一矮交错；火浪推到的时候才窜起来
    const ring = (rr: number, count: number, delay: number, sz: number[]) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU + rnd(-0.08, 0.08);
        const fx = this.x + Math.cos(a) * rr;
        const fy = this.y + Math.sin(a) * rr * SQ;
        const front = Math.sin(a); // 1 = 正前方
        const drop = (front > 0.3 ? 2 : front > -0.3 ? 1 : 0) + (i % 2);
        const sizes = sz.map((v) => Math.max(0, v - drop));
        ctx.bits.spawn(fx, fy, { sizes, fps: rnd(9, 13), life: rnd(0.8, 1.05), delay: delay + rnd(0, 0.07), vy: -rnd(3, 8), z: true, fadeIn: 0.06, fadeOut: 0.35 });
      }
    };
    ring(r * 0.92, n, DOME_WAVE * 0.85, sizes);
    if (st.wide) ring(r * 0.62, Math.round(n * 0.6), DOME_WAVE * 0.55, [2, 4, 5, 5, 4, 2, 1]);
    // 罩里零星几簇火（火浪经过时留下的）
    if (st.tier >= 2)
      for (let i = 0; i < Math.round(r / 9); i++) {
        const a = rnd(0, TAU);
        const rr = rnd(0.25, 0.65) * r;
        ctx.bits.spawn(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr * SQ, { sizes: [1, 2, 3, 2, 1], fps: 11, life: rnd(0.5, 0.8), delay: DOME_WAVE * (rr / r) + rnd(0, 0.06), z: true, vy: -6 });
      }
    this.bell = st.tier >= 3 ? null : new BellView(ctx, false);
    ctx.sound('jiulong.burst');
    ctx.shake.add(st.wide ? 0.14 : 0.07);
  }
  update(dt: number, ctx: Ctx, w: World, alpha: number): boolean {
    this.t += dt;
    const t = this.t;
    const SQ = DOME_SQ;
    // 火浪：贴地的一圈火，从脚下推到 0.92r（缓出），推到头后淡掉。不画成一道匀称的圈线（用户：不要光圈、不要硬边）：
    // 前沿亮、往后拖成橘红再淡掉的一条火带，半径和粗细跟着角度起伏、断开几处，沿路零星窜起小火舌
    if (t < DOME_WAVE + 0.22) {
      const k = clamp01(t / DOME_WAVE);
      const fadeK = t < DOME_WAVE ? 1 : 1 - (t - DOME_WAVE) / 0.22;
      const rr = 6 + (this.r * 0.92 - 6) * easeOut(k);
      const nSeg = Math.max(20, Math.round((TAU * rr) / 3));
      const ph = this.seed + t * 9;
      for (let i = 0; i < nSeg; i++) {
        const ang = (i / nSeg) * TAU;
        const n = Math.sin(ang * 9 + ph) + Math.sin(ang * 5 - ph * 1.3 + 1.7) * 0.8; // -1.8 … 1.8
        if (n < -1.2) continue; // 断开的地方
        const ca = Math.cos(ang);
        const sa = Math.sin(ang) * SQ;
        const lead = rr + n * 0.9;
        const w = (0.75 + 0.25 * n) * (1 - 0.3 * k);
        stamp(this.wave, this.x + ca * lead, this.y + sa * lead, 1.3 * w, 0.95 * fadeK, WAVE_COLS);
        if (lead > 9) stamp(this.wave, this.x + ca * (lead - 3), this.y + sa * (lead - 3), 0.9 * w, 0.6 * fadeK, WAVE_TAIL);
        if (lead > 14) stamp(this.wave, this.x + ca * (lead - 6), this.y + sa * (lead - 6), 0.5 * w, 0.32 * fadeK, WAVE_TAIL);
      }
      this.wave.commit(ctx.under);
      if (k < 1)
        for (let j = 0; j < 3; j++) {
          const ang = rnd(0, TAU);
          ctx.bits.spawn(this.x + Math.cos(ang) * rr, this.y + Math.sin(ang) * rr * SQ, { sizes: [0, 1, 2, 1, 0], fps: 12, life: rnd(0.3, 0.45), vy: -rnd(4, 9), z: true, fadeOut: 0.18 });
        }
    }
    // 焚天：罩顶冲起一道短火柱（最高到罩顶上方三十来个像素，不出判定圆）
    const p = w.players[this.owner];
    const px = p ? p.px + (p.x - p.px) * alpha : this.x;
    const py = p ? p.py + (p.y - p.py) * alpha : this.y;
    if (this.st.wide && t > 0.25 && t < 0.8) {
      this.pillarCd -= dt;
      if (this.pillarCd <= 0) {
        this.pillarCd = 0.035;
        ctx.bits.spawn(px + rnd(-2, 2), py - BELL_LIFT - 12, { sizes: [3, 5, 6, 5, 3, 1], fps: 12, life: rnd(0.35, 0.45), vy: -rnd(30, 45), drag: 1.5, fadeOut: 0.22 });
      }
    }
    if (Math.random() < 0.5 && t > DOME_WAVE * 0.5 && t < 0.85) {
      const a = rnd(0, TAU);
      const rr = rnd(0, this.r * 0.85);
      ctx.glows.emit(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr * SQ - 4, 1, FIRE_SPARKS, [4, 12], [0.5, 0.9], { up: 22, drag: 1 });
    }
    const bellOn = this.bell ? this.bell.update(dt, ctx, px, py, t < 0.75) : false;
    return t < 1.1 || bellOn;
  }
  destroy() {
    this.bell?.destroy();
  }
}

/** 赤焰轮折返时炸开的一圈火：火苗从圈的位置向四周窜出去、烧旺、再收成火星。 */
function fireNova(ctx: Ctx, x: number, y: number, r: number) {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.1, 0.1);
    const sp = r / 0.38;
    ctx.bits.spawn(x, y + 4, { sizes: [1, 3, 4, 4, 3, 1], fps: 12, life: rnd(0.55, 0.7), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75, drag: 4.5, fadeOut: 0.3 });
  }
  ctx.sparks.emit(x, y, 16, FIRE_SPARKS, [40, 110], [0.3, 0.6], { drag: 3 });
  ctx.sound('jiulong.burst', 0.6);
  ctx.shake.add(0.06);
}

// ---------------------------------------------------------------- 雷公鞭

/** 一道锯齿折线：两端固定，中间按中点位移抖开。 */
export function jag(x0: number, y0: number, x1: number, y1: number, amp: number, depth = 4): [number, number][] {
  let pts: [number, number][] = [
    [x0, y0],
    [x1, y1],
  ];
  let a = amp;
  for (let d = 0; d < depth; d++) {
    const out: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dd = dirOf(ax, ay, bx, by);
      const o = (Math.random() - 0.5) * 2 * a;
      out.push([(ax + bx) / 2 + dd.nx * o, (ay + by) / 2 + dd.ny * o], pts[i + 1]);
    }
    pts = out;
    a *= 0.55;
  }
  return pts;
}

/** 闪电的一张图：画在一张借来的贴图上（render/scratch-tex.ts），(ox, oy) 是它左上角的位置。 */
interface BoltFrame {
  scratch: Scratch;
  ox: number;
  oy: number;
}
interface BoltPiece {
  s: Sprite;
  /** 这一段的折线（每调一次抖出一种新的锯齿）。 */
  make: () => BoltPath[];
  /** 几种锯齿轮着闪：用到哪一种才画哪一种，不在出手那一帧全画完。 */
  frames: (BoltFrame | null)[];
  t0: number;
  life: number;
  mul: number;
}
/** 把一组折线画成一张闪电。像素和 boltGrid 画的一样（见 render/bolt-raster.ts），只是不现建纹理。 */
function boltFrame(paths: BoltPath[], style: BoltStyle): BoltFrame {
  const box = boltBox(paths);
  const scratch = borrowScratch(box.w, box.h);
  rasterBolt(paths, style, box, scratch.px, scratch.stride);
  commitScratch(scratch, box.h);
  return { scratch, ox: box.ox, oy: box.oy };
}

/** 天雷从目标头上多高劈下来（约三个人高），最上面多长一截是淡的。 */
const SKY_H = 76;
const SKY_FADE = 22;

/**
 * 雷公鞭：一道粗闪电从天而降劈在第一只敌人身上（主干 + 分叉，白芯亮身深边），再在敌人之间一跳一跳地连过去；
 * 每段都闪几帧（换几次锯齿）、再带着余光慢慢熄掉。落点有电弧、火花和一小片焦痕。
 */
export class Bolt implements Effect {
  private t = 0;
  private pieces: BoltPiece[] = [];
  private impacts: { x: number; y: number; t0: number; done: boolean; big: boolean }[] = [];
  private style: BoltStyle;
  constructor(ctx: Ctx, pts: [number, number][], style: BoltStyle, opts: { trunk: 2 | 3; branches: number; skyEach: boolean; whip: boolean; skyOnly?: boolean; arcsOnly?: boolean }) {
    this.style = style;
    const first = opts.skyOnly ? pts[0] : pts[1];
    if (!first) return;
    if (opts.arcsOnly) {
      // 只有跳出去的电弧（导雷）
      for (let i = 1; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        this.addPiece(() => [{ pts: jag(ax, ay, bx, by, 5, 4), w: 2 }], (i - 1) * 0.04, 0.45, 2);
        this.impacts.push({ x: bx, y: by, t0: (i - 1) * 0.04, done: false, big: false });
      }
      return;
    }
    // 雷鞭：人物头顶往天上抽一下
    if (opts.whip && !opts.skyOnly) {
      const [hx, hy] = pts[0];
      this.addPiece(() => [{ pts: jag(hx, hy, hx + rnd(-6, 6), hy - 26, 4, 3), w: 1 }], 0, 0.22, 2);
    }
    // 天雷：从目标头上 SKY_H 像素处劈下来（原来 165：从画面外劈下来，竖着比人高六七倍；用户 2026-11-10：效果不能画得过大）。
    // 最上面 SKY_FADE 那一截是一道淡淡的细线，像是从空中显出来的，不是一刀切的头
    const sky = (x: number, y: number, t0: number, trunk: 2 | 3, branches: number) => {
      const top: [number, number] = [x + rnd(-6, 6), y - SKY_H];
      const mid: [number, number] = [x + (top[0] - x) * 0.7 + rnd(-2, 2), y - SKY_H + SKY_FADE];
      this.addPiece(() => [{ pts: jag(top[0], top[1], mid[0], mid[1], 3, 3), w: 1 }], t0, 0.5, 3, 0.4);
      this.addPiece(
        () => {
          const main = jag(mid[0], mid[1], x, y, 6, 5);
          const paths: BoltPath[] = [{ pts: main, w: trunk }];
          for (let b = 0; b < branches; b++) {
            const i = Math.floor(rnd(0.15, 0.7) * main.length);
            const [bx, by] = main[i];
            const ang = Math.PI / 2 + (Math.random() < 0.5 ? -1 : 1) * rnd(0.4, 0.9);
            const L = rnd(9, 18);
            paths.push({ pts: jag(bx, by, bx + Math.cos(ang) * L, by + Math.sin(ang) * L, 3, 3), w: 1 });
          }
          return paths;
        },
        t0,
        0.62,
        3,
      );
      this.impacts.push({ x, y, t0: t0 + 0.02, done: false, big: true });
    };
    sky(first[0], first[1], 0, opts.trunk, opts.branches);
    if (!opts.skyOnly)
      for (let i = 1; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const t0 = 0.04 + (i - 1) * 0.035; // 伤害是同一帧结算的，连跳只留一点先后
        this.addPiece(() => [{ pts: jag(ax, ay, bx, by, 6, 4), w: 2 }], t0, 0.5, 2);
        // 五雷轰顶：前五跳每一跳都再劈下一道天雷
        if (opts.skyEach && i <= 4) sky(bx, by, t0 + 0.02, 2, 1);
        else this.impacts.push({ x: bx, y: by, t0, done: false, big: false });
      }
    ctx.shake.add(opts.trunk === 3 ? 0.12 : 0.08);
  }
  /** mul：这一段整体再淡一些（天雷最上面那截）。 */
  private addPiece(make: () => BoltPath[], t0: number, life: number, variants: number, mul = 1) {
    const s = new Sprite();
    s.visible = false;
    this.pieces.push({ s, make, frames: new Array<BoltFrame | null>(variants).fill(null), t0, life, mul });
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    let alive = false;
    for (const p of this.pieces) {
      if (!p.s.parent) ctx.layer.addChild(p.s);
      const lt = this.t - p.t0;
      if (lt < 0) {
        p.s.visible = false;
        alive = true;
        continue;
      }
      if (lt > p.life) {
        p.s.visible = false;
        continue;
      }
      alive = true;
      // 前几帧换锯齿（劈下来的那一下最亮），之后余光闪烁着熄掉
      const nf = p.frames.length;
      const v = lt < 0.05 ? 0 : lt < 0.1 ? 1 % nf : lt < 0.16 ? 2 % nf : Math.floor(lt / 0.07) % nf;
      const f = p.frames[v] ?? (p.frames[v] = boltFrame(p.make(), this.style));
      p.s.texture = f.scratch.tex;
      p.s.position.set(f.ox, f.oy);
      const k = clamp01((lt - 0.16) / (p.life - 0.16));
      const flick = Math.floor(lt * 30) % 3 === 0 ? 0.65 : 1;
      p.s.alpha = (lt < 0.16 ? 1 : (1 - k) ** 1.4 * flick) * p.mul;
      p.s.visible = true;
    }
    for (const im of this.impacts) {
      const lt = this.t - im.t0;
      if (lt < 0) {
        alive = true;
        continue;
      }
      if (!im.done) {
        im.done = true;
        if (ctx.impactFx?.('zap', im.x, im.y, im.big ? 1 : 0, 0, this.style)) continue;
        const cols = this.style === 'gold' ? GOLD_SPARKS : this.style === 'violet' ? [C.W, C.m, C.f] : [C.W, C.Cc, C.f];
        ctx.sparks.emit(im.x, im.y, im.big ? 14 : 7, cols, [40, 120], [0.25, 0.55], { drag: 3, g: 120 });
        ctx.bits.spawn(im.x, im.y + 8, { frames: [T(`scorch${im.big ? 6 : 4}`, () => scorch(im.big ? 6 : 4, 3))], life: 1.6, layer: ctx.floor, fadeIn: 0.02, fadeOut: 0.9, alpha: 0.75 });
        ctx.bits.spawn(im.x, im.y, { frames: Ts('star', () => STAR).slice(2, 4).reverse(), life: 0.16, fadeOut: 0.08 });
        // 落点的电弧：三四道短锯齿在落点周围爬几帧
        this.addPiece(
          () =>
            Array.from({ length: im.big ? 4 : 3 }, () => {
              const a = rnd(0, TAU);
              const L = rnd(6, im.big ? 13 : 9);
              return { pts: jag(im.x + Math.cos(a) * 2, im.y + Math.sin(a) * 2, im.x + Math.cos(a) * L, im.y + Math.sin(a) * L * 0.7 + 3, 3, 2), w: 1 as const };
            }),
          this.t,
          0.4,
          3,
        );
        alive = true;
      }
    }
    return alive || this.t < 0.1;
  }
  destroy() {
    for (const p of this.pieces) {
      p.s.destroy();
      for (const f of p.frames) if (f) returnScratch(f.scratch);
    }
  }
}

/** 仙品雷印：被打中的敌人头顶一枚小雷纹跟着它走，越快落雷闪得越急；落雷前一瞬天上先垂下一道细细的引雷。 */
class ThunderMark implements Effect {
  t = 0;
  private s: Sprite;
  private target: number;
  private x: number;
  private y: number;
  private t2: number;
  landedAt = -1;
  constructor(ctx: Ctx, target: number, x: number, y: number, t2: number) {
    this.target = target;
    this.x = x;
    this.y = y;
    this.t2 = t2;
    this.s = new Sprite(Ts('tmark', () => THUNDER_MARK)[0]);
    this.s.anchor.set(0.5, 1);
    ctx.layer.addChild(this.s);
    ctx.sparks.emit(x, y - 26, 4, [C.W, C.Cc], [10, 30], [0.2, 0.4]);
  }
  /** 头顶的位置（跟着目标走；目标没了就停在最后的位置）。 */
  where(ctx: Ctx): [number, number] {
    const p = this.target >= 0 ? ctx.enemyPos(this.target) : null;
    if (p) {
      this.x = p[0];
      this.y = p[1];
    }
    return [this.x, this.y];
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const [x, y] = this.where(ctx);
    const head = headHeight(ctx, this.target);
    const left = this.t2 - this.t;
    const period = left > 0.5 ? 0.3 : 0.08;
    this.s.texture = Ts('tmark', () => THUNDER_MARK)[Math.floor(this.t / period) % 2];
    this.s.position.set(Math.round(x), Math.round(y - head - 10));
    if (this.landedAt >= 0) {
      const k = (this.t - this.landedAt) / 0.15;
      this.s.alpha = Math.max(0, 1 - k);
      return k < 1;
    }
    this.s.alpha = clamp01(this.t / 0.15);
    // 引雷：最后 0.15 秒天上垂下一道细线
    if (left < 0.15 && left > 0) {
      const k = 1 - left / 0.15;
      for (let i = 0; i < 6; i++) ctx.top.dot(x + rnd(-1, 1), y - head - 12 - k * 48 + i * 8 * k - 30 * (1 - k), C.Cc, 0.5); // 不高过天雷（SKY_H）
    }
    return this.t < this.t2 + 1.5;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 敌人的头有多高（从脚底算），印记、雷纹放在头顶上方。 */
const HEAD: Partial<Record<Enemy['kind'], number>> = { boss: 36, elite: 37, cavalry: 27, spearman: 24, caster: 23, shieldbearer: 23, bomber: 20, splitter: 20, splitling: 12 };
export function headOf(kind: Enemy['kind'] | undefined): number {
  return (kind && HEAD[kind]) ?? 21;
}
export function headHeight(ctx: Ctx, id: number): number {
  return headOf(ctx.enemy(id)?.kind);
}

// ---------------------------------------------------------------- 番天印

/** 番天印落地：尘浪一圈往外推、碎石崩起再落地弹一下、地面裂开（仙品以上由地裂区域接着画）、震屏。 */
function sealImpact(ctx: Ctx, x: number, y: number, r: number, tier: number, cracks: boolean, big = false) {
  // 尘浪：一圈尘团从印的四周往外推开（中间留空，印看得见）；按 y 排序，印后面的尘在印后面。
  // 推出去的距离按印的半径算，尘团的外沿停在判定半径上（原来按固定速度推，凡品的尘浪推到两倍印半径外；用户：效果不能画得比判定范围大）
  const n = Math.round(9 + r / 5 + (big ? 5 : 0));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.12, 0.12);
    const r0 = r * rnd(0.45, 0.55);
    const sp = Math.max(6, r * 0.42 - 3) * 3.3 * rnd(0.8, 1);
    ctx.bits.spawn(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.6, { frames: puffSet(pick([3, 4]), 'stone', 1 + (i % 3)), life: rnd(0.55, 0.8), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55 - 3, drag: 3, fadeIn: 0.03, fadeOut: 0.3, z: true, zOff: 2 });
  }
  for (let i = 0; i < 2; i++) ctx.bits.spawn(x + (i ? 7 : -7), y - 2, { frames: puffSet(5, 'stone', 2), life: rnd(0.7, 0.9), vy: -rnd(12, 20), drag: 1.5, delay: rnd(0, 0.06), fadeOut: 0.4, alpha: 0.8, z: true, zOff: -1 });
  // 碎石：崩起来再落地弹一下，落点也在判定半径里
  const rocks = 8 + tier * 2 + (big ? 6 : 0);
  for (let i = 0; i < rocks; i++) {
    const a = rnd(0, TAU);
    ctx.bits.spawn(x + Math.cos(a) * rnd(2, r * 0.4), y + Math.sin(a) * rnd(1, r * 0.25), {
      frames: [Ts('rocks', () => ROCKS)[i % ROCKS.length]],
      life: rnd(0.75, 1.05),
      vx: Math.cos(a) * r * rnd(0.25, 0.6),
      vy: -rnd(60, 100),
      g: 340,
      ground: y + rnd(-3, 4),
      bounce: 0.35,
      fadeOut: 0.3,
    });
  }
  if (cracks) {
    const fr = Ts(`crack${Math.round(r)}${tier}`, () => crackFrames(r * 0.8, Math.round(r) * 7 + tier, false));
    ctx.bits.spawn(x, y, { frames: fr, fps: 40, loop: false, life: 1.5, layer: ctx.floor, fadeIn: 0.01, fadeOut: 0.6 });
  }
  ctx.shake.add(Math.min(0.32, 0.16 + tier * 0.03 + (big ? 0.08 : 0)));
}

/** 番天印：影子由小到大、由淡到浓，大印加速砸下（带下坠的金线）；落地后压进地里停一下，再升起淡去、化成金尘。 */
class SealDrop implements Effect {
  private t = 0;
  private shadow = new Sprite();
  private seal: Sprite;
  private landed = -1;
  private x: number;
  private y: number;
  private r: number;
  private t2: number;
  private tier: number;
  private H0 = 72; // 从目标头上多高落下来（原来 130：印从画面外落下来；和天雷一样收到约三个人高）
  constructor(ctx: Ctx, x: number, y: number, r: number, t2: number, tier: number, size: number, glyph: SealGlyph) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.t2 = Math.max(0.15, t2);
    this.tier = tier;
    this.seal = new Sprite(T(`seal${size}${glyph}`, () => sealGrid(size, glyph)));
    this.seal.anchor.set(0.5, 1);
    this.seal.alpha = 0;
    this.shadow.anchor.set(0.5);
    ctx.floor.addChild(this.shadow);
    ctx.layer.addChild(this.seal);
  }
  land(ctx: Ctx) {
    if (this.landed >= 0) return;
    this.landed = 0;
    // 落地后改进 entities 按 y 排序，能被前面的敌人挡住
    ctx.stage.entities.addChild(this.seal);
    this.seal.zIndex = this.y + 2;
    if (ctx.impactFx?.('slam', this.x, this.y, this.r, this.tier)) ctx.shake.add(Math.min(0.32, 0.16 + this.tier * 0.03));
    else sealImpact(ctx, this.x, this.y, this.r, this.tier, this.tier < 3);
    ctx.sound('fantian.land');
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    if (this.landed < 0) {
      const k = clamp01(this.t / this.t2);
      this.shadow.texture = shadowTex(this.r * (0.25 + 0.6 * k));
      this.shadow.alpha = 0.12 + 0.3 * k;
      this.shadow.position.set(Math.round(this.x), Math.round(this.y));
      const h = this.H0 * (1 - easeIn(k));
      this.seal.position.set(Math.round(this.x), Math.round(this.y - h + 2));
      this.seal.alpha = clamp01(this.t / 0.12);
      // 下坠的金线
      if (k > 0.25 && k < 1) {
        const top = this.y - h - this.seal.height + 4;
        for (const dx of [-6, 0, 6]) {
          const L = 6 + 10 * k;
          ctx.top.line(this.x + dx, top - L - 4, this.x + dx, top - 4, dx === 0 ? C.f : C.Y, 0.55 * k);
        }
      }
      if (this.t > this.t2 + 0.2) this.land(ctx);
      return true;
    }
    this.landed += dt;
    const L = this.landed;
    const sink = L < 0.07 ? 2 : 1;
    const HOLD = 0.4;
    const rise = L > HOLD ? easeIn((L - HOLD) / 0.5) * 9 : 0;
    this.seal.position.set(Math.round(this.x), Math.round(this.y + sink - rise));
    const a = L > HOLD ? Math.max(0, 1 - (L - HOLD) / 0.5) : 1;
    this.seal.alpha = a;
    // 落地后影子收成印底那么大
    this.shadow.texture = shadowTex(Math.max(this.seal.width * 0.55, this.r * 0.85 * (1 - clamp01(L / 0.12)) + this.seal.width * 0.55 * clamp01(L / 0.12)));
    this.shadow.alpha = 0.42 * a;
    if (L > HOLD && Math.random() < 0.5) ctx.glows.emit(this.x + rnd(-8, 8), this.y - rnd(4, 18) - rise, 1, GOLD_SPARKS, [5, 15], [0.4, 0.7], { up: 18, drag: 1 });
    return L < HOLD + 0.52;
  }
  destroy() {
    this.shadow.destroy();
    this.seal.destroy();
  }
}

/** 器灵「地裂震波」：印落地后再震出一圈 —— 裂缝从落点一路崩到更远处，一圈尘浪和崩起的石块追着往外推。 */
class Quake implements Effect {
  private t = 0;
  private x: number;
  private y: number;
  private r: number;
  private fired = 0;
  constructor(ctx: Ctx, x: number, y: number, r: number) {
    this.x = x;
    this.y = y;
    this.r = r;
    const fr = Ts(`quake${Math.round(r)}`, () => crackFrames(r * 0.95, Math.round(r) * 11 + 3, true, 6));
    ctx.bits.spawn(x, y, { frames: fr, fps: 30, loop: false, life: 1.8, layer: ctx.floor, fadeIn: 0.01, fadeOut: 0.7 });
    ctx.shake.add(0.3);
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    // 震波一圈一圈往外：0.25 秒内分三圈放出尘团和碎石
    const rings = 3;
    while (this.fired < rings && this.t >= this.fired * 0.08) {
      // 三圈放在震波半径的 0.4、0.62、0.84 倍：尘团往外推一点、外沿停在震波半径上
      const rr = this.r * (0.4 + 0.22 * this.fired);
      const n = Math.round(10 + rr / 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd(-0.1, 0.1);
        ctx.bits.spawn(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr * 0.6, { frames: puffSet(pick([3, 4]), 'stone', 1 + (i % 3)), life: rnd(0.45, 0.65), vx: Math.cos(a) * 18, vy: Math.sin(a) * 11 - 4, drag: 3, fadeOut: 0.25, z: true });
        if (i % 3 === 0) ctx.bits.spawn(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr * 0.6, { frames: [Ts('rocks', () => ROCKS)[i % ROCKS.length]], life: 0.6, vx: Math.cos(a) * 12, vy: -rnd(45, 75), g: 300, ground: this.y + Math.sin(a) * rr * 0.6, bounce: 0.3, fadeOut: 0.2 });
      }
      this.fired++;
    }
    return this.t < 0.3;
  }
  destroy() {}
}

// ---------------------------------------------------------------- 寒冰幡

/** 冰棱要刺出来之前：地面先结霜（冰花枝从中心蔓延开），冒两缕寒气；刺出之后霜停一会儿再化掉。 */
class FrostPatch implements Effect {
  private t = 0;
  private s: Sprite;
  private fr: Texture[];
  private t2: number;
  private landedAt = -1;
  private life: number;
  constructor(ctx: Ctx, x: number, y: number, r: number, t2: number, life = 1.1) {
    const rr = Math.max(6, Math.round(r));
    this.fr = Ts(`frost${rr}${Math.floor(Math.random() * 3)}`, () => frostFrames(rr, Math.floor(Math.random() * 1000), 6));
    this.s = new Sprite(this.fr[0]);
    this.s.anchor.set(0.5);
    this.s.position.set(Math.round(x), Math.round(y));
    this.s.alpha = 0.9;
    ctx.floor.addChild(this.s);
    this.t2 = Math.max(0.1, t2);
    this.life = life;
    for (let i = 0; i < 2; i++) ctx.bits.spawn(x + rnd(-r, r) * 0.5, y + rnd(-2, 2), { frames: puffSet(4, 'snow', 3), life: rnd(0.6, 0.9), vy: -rnd(6, 12), delay: rnd(0, 0.2), alpha: 0.55, fadeOut: 0.4 });
  }
  land() {
    if (this.landedAt < 0) this.landedAt = this.t;
  }
  update(dt: number): boolean {
    this.t += dt;
    const k = clamp01(this.t / this.t2);
    this.s.texture = this.fr[Math.min(this.fr.length - 1, Math.floor(k * this.fr.length))];
    if (this.landedAt < 0 && this.t > this.t2 + 0.3) this.landedAt = this.t;
    if (this.landedAt >= 0) {
      const lt = this.t - this.landedAt;
      this.s.alpha = 0.9 * fade(lt, this.life, 0, 0.7);
      return lt < this.life;
    }
    return true;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 寒气蔓延（寒冰幡仙品的延时冻结）：贴地的寒雾从一圈外沿往里收拢，冰晶零星闪着，到点时冻住。 */
class Chill implements Effect {
  private t = 0;
  private cd = 0;
  private x: number;
  private y: number;
  private r: number;
  private t2: number;
  constructor(ctx: Ctx, x: number, y: number, r: number, t2: number) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.t2 = Math.max(0.2, t2);
    void ctx;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    this.cd -= dt;
    if (this.cd <= 0 && this.t < this.t2) {
      this.cd = 0.07;
      const a = rnd(0, TAU);
      const rr = this.r * rnd(0.8, 0.95); // 寒雾从判定圈里面往圆心收（原来最远在 1.05 倍）
      const sx = this.x + Math.cos(a) * rr;
      const sy = this.y + Math.sin(a) * rr * 0.62;
      // 寒雾往圆心收
      ctx.bits.spawn(sx, sy, { frames: puffSet(4, 'snow', 1 + Math.floor(rnd(0, 3))), life: rnd(0.6, 0.8), vx: (this.x - sx) * 0.9, vy: (this.y - sy) * 0.9 - 2, drag: 0.6, alpha: 0.45, fadeIn: 0.2, fadeOut: 0.35 });
      if (Math.random() < 0.5) ctx.bits.spawn(this.x + Math.cos(a) * rr * 0.6, this.y + Math.sin(a) * rr * 0.38 - 2, { frames: Ts('star', () => STAR).slice(0, 2), life: 0.25, fadeOut: 0.12 });
    }
    return this.t < this.t2 + 0.1;
  }
  destroy() {}
}

/** 一簇冰棱从地里冒出来：尖先冒头、整簇顶上来，停一会儿、闪过一道冰光，再碎成冰屑。 */
class IceSpike implements Effect {
  private t = 0;
  private s: Sprite;
  private fr: Texture[];
  private x: number;
  private y: number;
  private hold: number;
  private broke = false;
  constructor(ctx: Ctx, x: number, y: number, big: boolean, hold = 0.65) {
    const seed = Math.floor(Math.random() * 4);
    this.fr = Ts(`ice${big ? 1 : 0}${seed}`, () => iceClusterFrames(seed + 1, big));
    this.s = new Sprite(this.fr[0]);
    this.s.anchor.set(0.5, 1);
    this.x = x;
    this.y = y;
    this.hold = hold;
    this.s.position.set(Math.round(x), Math.round(y + 2));
    this.s.zIndex = y + 2;
    ctx.stage.entities.addChild(this.s);
    ctx.sparks.emit(x, y, 6, ICE_SPARKS, [15, 35], [0.25, 0.5], { up: 24, drag: 3 });
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const grow = Math.min(this.fr.length - 1, Math.floor(this.t / 0.03));
    this.s.texture = this.fr[grow];
    if (this.t > 0.22 && this.t - dt <= 0.22) ctx.bits.spawn(this.x + rnd(-3, 3), this.y - rnd(6, 11), { frames: Ts('star', () => STAR).slice(1, 3), fps: 12, life: 0.25, fadeOut: 0.12 });
    if (this.t > this.hold && !this.broke) {
      this.broke = true;
      // 碎成冰屑：溅开的范围和冰棱的判定差不多大（原来溅到两三倍远）
      const chips = Ts('chips', () => ICE_CHIPS);
      for (let i = 0; i < 9; i++)
        ctx.bits.spawn(this.x + rnd(-4, 4), this.y - rnd(2, 11), { frames: [chips[i % chips.length]], life: rnd(0.45, 0.7), vx: rnd(-22, 22), vy: -rnd(25, 65), g: 300, ground: this.y + rnd(0, 4), bounce: 0.3, fadeOut: 0.3 });
      ctx.bits.spawn(this.x, this.y - 5, { frames: puffSet(5, 'snow', 2), life: 0.6, vy: -8, fadeOut: 0.35, alpha: 0.8 });
    }
    // 碎前的最后一瞬整簇闪白，然后消失
    this.s.visible = this.t < this.hold + 0.05;
    this.s.tint = this.t > this.hold - 0.06 ? 0xd8f4ff : 0xffffff;
    return this.t < this.hold + 0.06;
  }
  destroy() {
    this.s.destroy();
  }
}

// ---------------------------------------------------------------- 地面区域

/**
 * 一块持续的地面区域（火痕 / 火罩笼罩 / 地裂 / 寒霜）：读 world.zones，出现时铺开、存在时一直动、到期前收尾淡去。
 * 区域消失（比如一波结束）时快速淡出。
 */
class ZoneView implements Effect {
  private id: number;
  private kind: Zone['kind'];
  private z: Zone;
  private gone = -1;
  private decal: Sprite | null = null;
  private decalFr: Texture[] = [];
  private scratch: Scratch | null = null; // 火痕的焦痕画在一张借来的贴图上
  private slots: { x: number; y: number; cd: number; u: number }[] = [];
  private t = 0;
  private alpha = 0;
  private bell: BellView | null = null; // 火罩笼罩期间，头顶一直悬着的那口金罩
  constructor(ctx: Ctx, z: Zone) {
    this.id = z.id;
    this.kind = z.kind;
    this.z = { ...z };
    const len = Math.hypot(z.x2 - z.x, z.y2 - z.y);
    if (z.kind === 'fireTrail') {
      const n = Math.max(2, Math.round(len / 9));
      for (let i = 0; i <= n; i++) {
        const u = Math.min(1, Math.max(0, (i + rnd(-0.3, 0.3)) / n));
        this.slots.push({ x: z.x + (z.x2 - z.x) * u, y: z.y + (z.y2 - z.y) * u, cd: rnd(0, 0.2), u });
      }
      // 焦痕：沿线一道断断续续的焦黑，零星几粒还红着的炭（余烬）
      const d = dirOf(z.x, z.y, z.x2, z.y2);
      const W = Math.ceil(Math.abs(z.x2 - z.x)) + 8;
      const H = Math.ceil(Math.abs(z.y2 - z.y)) + 8;
      const sc = (this.scratch = borrowScratch(W, H));
      const ox = Math.min(z.x, z.x2) - 4;
      const oy = Math.min(z.y, z.y2) - 4;
      for (let s = 0; s <= len; s += 0.5)
        for (let o = -1; o <= 1; o++) {
          if (Math.random() < (o === 0 ? 0.15 : 0.55)) continue;
          const ch = Math.random() < 0.06 ? SCORCH_E : Math.random() < 0.08 ? SCORCH_R : o === 0 ? SCORCH_D : SCORCH_G;
          const X = Math.round(z.x + d.ux * s + d.nx * o - ox);
          const Y = Math.round(z.y + d.uy * s + d.ny * o - oy);
          if (X >= 0 && Y >= 0 && X < W && Y < H) sc.px[Y * sc.stride + X] = ch;
        }
      commitScratch(sc, H);
      const tex = sc.tex;
      this.decalFr = [tex];
      this.decal = new Sprite(tex);
      this.decal.position.set(Math.round(ox), Math.round(oy));
      ctx.sound('zone.fire', 0.7);
    } else if (z.kind === 'fireDome') {
      // 火罩跟着主人走：火苗的位置按角度记，每次按区域当前的圆心算
      const n = Math.max(10, Math.round((TAU * z.r) / 8));
      for (let i = 0; i < n; i++) this.slots.push({ x: 0, y: 0, cd: rnd(0, 0.3), u: (i / n) * TAU + rnd(-0.05, 0.05) });
      this.bell = new BellView(ctx, true);
      ctx.sound('zone.fire', 0.7);
    } else if (z.kind === 'crack') {
      this.decalFr = Ts(`zcrack${z.id % 5}${Math.round(z.r)}`, () => crackFrames(z.r, z.id * 13 + 5, true, 6));
      this.decal = new Sprite(this.decalFr[0]);
      this.decal.anchor.set(0.5);
      this.decal.position.set(Math.round(z.x), Math.round(z.y));
      ctx.sound('zone.crack', 0.8);
    } else {
      this.decalFr = Ts(`zfrost${z.id % 4}${Math.round(z.r)}`, () => frostFrames(Math.round(z.r), z.id * 7 + 3, 8));
      this.decal = new Sprite(this.decalFr[0]);
      this.decal.anchor.set(0.5);
      this.decal.position.set(Math.round(z.x), Math.round(z.y));
      ctx.sound('zone.frost', 0.8);
    }
    if (this.decal) {
      this.decal.alpha = 0;
      ctx.floor.addChild(this.decal);
    }
  }
  update(dt: number, ctx: Ctx, w: World, alpha = 1): boolean {
    this.t += dt;
    const live = w.zones.find((q) => q.id === this.id);
    if (live) this.z = { ...live };
    else if (this.gone < 0) this.gone = 0;
    const z = this.z;
    if (this.gone >= 0) {
      this.gone += dt;
      this.alpha = Math.max(0, this.alpha - dt / 0.3);
    } else this.alpha = fade(z.t, z.life, 0.2, 0.6);
    // 火罩的金罩跟着主人走（按插值后的位置，和人物的精灵对得上），火罩快收的时候升起淡去
    let bellOn = false;
    if (this.bell) {
      const p = w.players[z.owner];
      const bx = p ? p.px + (p.x - p.px) * alpha : z.x;
      const by = p ? p.py + (p.y - p.py) * alpha : z.y;
      bellOn = this.bell.update(dt, ctx, bx, by, !!live && z.life - z.t > 0.32);
    }
    if ((this.gone > 0.35 || (this.alpha <= 0 && z.t > z.life)) && !bellOn) return false;
    const a = this.alpha;
    const spread = clamp01(z.t / 0.25);
    if (this.kind === 'fireTrail' || this.kind === 'fireDome') {
      const dome = this.kind === 'fireDome';
      for (const sl of this.slots) {
        if (!dome && sl.u > spread) continue;
        if (dome) {
          sl.x = z.x + Math.cos(sl.u) * z.r * 0.95;
          sl.y = z.y + Math.sin(sl.u) * z.r * 0.95 * 0.78;
        }
        sl.cd -= dt;
        if (sl.cd > 0 || a <= 0.05) continue;
        sl.cd = dome ? rnd(0.16, 0.32) : rnd(0.3, 0.6);
        // 火苗大小错开：有的窜得高、有的只是一小簇；快熄的时候只剩小火苗
        let big = a > 0.7 ? pick(z.tier >= 4 ? [[1, 3, 4, 3, 1], [0, 2, 3, 2, 0], [0, 1, 2, 1, 0]] : [[0, 2, 3, 2, 0], [0, 1, 3, 2, 0], [0, 1, 2, 1, 0], [0, 1, 1, 0]]) : a > 0.35 ? pick([[0, 1, 2, 1, 0], [0, 1, 1, 0]]) : [0, 1, 0];
        if (dome) big = Math.sin(sl.u) > 0.3 ? big : big.map((v) => v + 1); // 罩子后排高、前排矮（不挡人）
        ctx.bits.spawn(sl.x + rnd(-2, 2), sl.y + rnd(-1, 1), { sizes: big, fps: rnd(9, 13), life: rnd(0.4, 0.75), vy: -rnd(3, 8), z: true, fadeIn: 0.05, fadeOut: 0.25, alpha: Math.min(1, a * 1.3) });
        if (Math.random() < 0.35) ctx.glows.emit(sl.x + rnd(-3, 3), sl.y - 3, 1, FIRE_SPARKS, [4, 14], [0.6, 1.2], { up: 24, drag: 1 });
      }
      if (dome) {
        if (Math.random() < 0.4) {
          const ang = rnd(0, TAU);
          const rr = rnd(0, z.r * 0.8);
          ctx.glows.emit(z.x + Math.cos(ang) * rr, z.y + Math.sin(ang) * rr * 0.78, 1, FIRE_SPARKS, [3, 10], [0.6, 1.1], { up: 20, drag: 1 });
        }
      }
    } else if (this.kind === 'crack') {
      const k = clamp01(z.t / 0.18);
      if (this.decal) this.decal.texture = this.decalFr[Math.min(this.decalFr.length - 1, Math.floor(k * this.decalFr.length))];
      // 裂缝里冒尘、闪土黄的灵光，偶尔崩起一粒小石子
      if (Math.random() < 0.06 * a) {
        const ang = rnd(0, TAU);
        const rr = rnd(0.2, 0.85) * z.r;
        ctx.bits.spawn(z.x + Math.cos(ang) * rr, z.y + Math.sin(ang) * rr * 0.62, { frames: puffSet(3, 'stone', 4), life: rnd(0.5, 0.8), vy: -rnd(6, 12), alpha: 0.7 * a, fadeOut: 0.3 });
      }
      if (Math.random() < 0.08 * a) {
        const ang = rnd(0, TAU);
        const rr = rnd(0.15, 0.8) * z.r;
        ctx.glows.emit(z.x + Math.cos(ang) * rr, z.y + Math.sin(ang) * rr * 0.62, 1, [C.Y, C.y, C.b], [2, 8], [0.4, 0.8], { up: 10, drag: 2 });
      }
      if (Math.random() < 0.03 * a) {
        const ang = rnd(0, TAU);
        const rr = rnd(0.2, 0.8) * z.r;
        const gy = z.y + Math.sin(ang) * rr * 0.62;
        ctx.bits.spawn(z.x + Math.cos(ang) * rr, gy, { frames: [Ts('rocks', () => ROCKS)[3]], life: 0.6, vy: -rnd(40, 70), g: 260, ground: gy, bounce: 0.3, fadeOut: 0.2 });
      }
    } else {
      const k = clamp01(z.t / 0.45);
      if (this.decal) this.decal.texture = this.decalFr[Math.min(this.decalFr.length - 1, Math.floor(k * this.decalFr.length))];
      // 寒霜：飘落的雪、贴地爬的寒气、冰晶一闪
      if (Math.random() < 0.12 * a) {
        const ang = rnd(0, TAU);
        const rr = rnd(0, z.r * 0.9);
        const gx = z.x + Math.cos(ang) * rr;
        const gy = z.y + Math.sin(ang) * rr * 0.62;
        ctx.bits.spawn(gx, gy - rnd(18, 30), { frames: [Ts('snow', () => SNOWFLAKE)[Math.random() < 0.7 ? 0 : 1]], life: rnd(0.9, 1.3), vy: rnd(14, 22), vx: rnd(-4, 4), ground: gy, fadeIn: 0.2, fadeOut: 0.35, alpha: a });
      }
      if (Math.random() < 0.05 * a) {
        const ang = rnd(0, TAU);
        const rr = rnd(0.3, 0.9) * z.r;
        ctx.bits.spawn(z.x + Math.cos(ang) * rr, z.y + Math.sin(ang) * rr * 0.62, { frames: puffSet(5, 'snow', 1), life: rnd(0.8, 1.2), vx: -Math.cos(ang) * 6, vy: -3, alpha: 0.45 * a, fadeIn: 0.25, fadeOut: 0.45 });
      }
      if (Math.random() < 0.05 * a) {
        const ang = rnd(0, TAU);
        const rr = rnd(0, z.r * 0.8);
        ctx.bits.spawn(z.x + Math.cos(ang) * rr, z.y + Math.sin(ang) * rr * 0.62 - 2, { frames: Ts('star', () => STAR).slice(0, 3), fps: 10, loop: false, life: 0.3, fadeOut: 0.12 });
      }
    }
    if (this.decal) this.decal.alpha = (this.kind === 'fireTrail' ? 0.7 * spread : this.kind === 'frost' ? 0.8 : 0.95) * a;
    return true;
  }
  destroy() {
    this.decal?.destroy();
    this.bell?.destroy();
    if (this.scratch) returnScratch(this.scratch);
    this.scratch = null;
  }
}
/** 焦痕的四种颜色：红炭（朱砂、朱）、焦黑（乌、黛）。 */
const SCORCH_E = PAL32['e'.charCodeAt(0)];
const SCORCH_R = PAL32['r'.charCodeAt(0)];
const SCORCH_D = PAL32['d'.charCodeAt(0)];
const SCORCH_G = PAL32['g'.charCodeAt(0)];

// ---------------------------------------------------------------- 乾坤圈周围

/** 沿一串位置画一条锥形光尾（新的一端最粗最亮）。 */
export function polyStreak(st: Stroke, pts: [number, number][], hw: number, alpha: number, cols: [number, number, number, number]) {
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const d = dirOf(x0, y0, x1, y1);
    const k0 = 1 - i / (n - 1);
    for (let s = 0; s <= d.len; s += 0.5) {
      const k = k0 - (s / d.len) * (1 / (n - 1));
      const w = hw * k;
      const lim = Math.ceil(w) + 1;
      for (let o = -lim; o <= lim; o += 0.5) {
        const dd = Math.abs(o) / (w + 0.5);
        if (dd > 1.3) continue;
        const band = dd < 0.3 ? 0 : dd < 0.65 ? 1 : dd < 1 ? 2 : 3;
        st.put(Math.round(x0 + d.ux * s + d.nx * o), Math.round(y0 + d.uy * s + d.ny * o), cols[band], alpha * (0.25 + 0.75 * k), 4 - band);
      }
    }
  }
}

/** 在一点盖一个小圆印（芯 / 身 / 外 / 深边四档），沿曲线连着盖就是一笔有粗细、有描边的弧线。 */
export function stamp(st: Stroke, x: number, y: number, r: number, alpha: number, cols: [number, number, number, number]) {
  const lim = Math.ceil(r) + 1;
  // 圆心先取整、再按整数偏移盖；远近比平方、不开方。盖出来的和逐点取整、开方是一样的，只是省事
  // （这个函数一帧要调几千次，每次十几到几十个点）
  const X = Math.round(x);
  const Y = Math.round(y);
  const R = r + 0.5;
  const core = (0.35 * R) ** 2;
  const body = (0.7 * R) ** 2;
  const rim = R * R;
  const out = (1.3 * R) ** 2;
  for (let dy = -lim; dy <= lim; dy++) {
    const dy2 = dy * dy;
    for (let dx = -lim; dx <= lim; dx++) {
      const d2 = dx * dx + dy2;
      if (d2 > out) continue;
      const band = d2 < core ? 0 : d2 < body ? 1 : d2 < rim ? 2 : 3;
      st.put(X + dx, Y + dy, cols[band], alpha, 4 - band);
    }
  }
}

const WHEEL_FLAME: Cols = [C.f, C.Y, C.o, C.R];
const HOVER_ARC: Cols = [C.W, C.Y, C.o, C.R];
/**
 * 乾坤圈的特效层（本体精灵在 feel.ts 画）：
 * 灵品起拖一条金红色的火尾（彗尾 + 往后飘的火星）；仙品悬停时圈外一圈火星飞旋、三道火弧绞着转；
 * 神品「金环分光」拖金光长尾、沿路留下一串淡去的金环残影，「赤焰轮」整圈窜出旋转的火舌，像一只风火轮。
 */
class RingView {
  /** 最近的位置（x, y, 时刻）：光尾按时间截，不按帧数，帧率低的时候尾巴也不会拖得老长。 */
  private hist: [number, number, number][] = [];
  private t = 0;
  private hovering = false;
  private emberCd = 0;
  private ghostCd = 0;
  private ghosts: { x: number; y: number; t: number }[] = [];
  private stroke = new Stroke();
  update(dt: number, ctx: Ctx, x: number, y: number, hover: boolean, tier: number, spirit: string | null): void {
    this.t += dt;
    const t = this.t;
    this.hist.unshift([x, y, t]);
    while (this.hist.length > 2 && t - this.hist[this.hist.length - 1][2] > 0.17) this.hist.pop();
    const split = tier >= 4 && spirit === 'split';
    const flame = tier >= 4 && spirit === 'flame';
    const px = ctx.top;
    // 灵品起：金红火尾（彗尾），尾巴上不断往后、往上飘出火星和小火苗
    if (tier >= 2 && this.hist.length > 2) {
      const age = flame ? 0.17 : tier >= 3 ? 0.15 : 0.12;
      const pts = this.hist.filter((h) => t - h[2] <= age).map((h) => [h[0], h[1]] as [number, number]);
      const cols: [number, number, number, number] = split ? [C.W, C.f, C.Y, C.B] : [C.f, C.Y, C.o, C.R];
      if (pts.length > 1) polyStreak(this.stroke, pts, split ? 2.6 : flame ? 3 : tier >= 3 ? 2.6 : 2.2, 0.95, cols);
      this.stroke.commit(px);
      this.emberCd -= dt;
      while (this.emberCd <= 0) {
        this.emberCd += split ? 0.05 : 0.035;
        const [bx, by] = this.hist[Math.min(this.hist.length - 1, 1 + Math.floor(Math.random() * this.hist.length))];
        if (split) ctx.glows.emit(bx, by, 1, GOLD_SPARKS, [4, 14], [0.3, 0.55], { drag: 3 });
        else if (Math.random() < 0.45) ctx.bits.spawn(bx + rnd(-1, 1), by + 2, { sizes: [0, 1, 0], fps: 12, life: rnd(0.25, 0.4), vy: -rnd(8, 16), fadeOut: 0.15 });
        else ctx.sparks.emit(bx, by, 1, FIRE_SPARKS, [6, 16], [0.3, 0.55], { up: 14, drag: 2 });
      }
    }
    // 神品「金环分光」：沿路每隔一会儿留下一个金环残影，慢慢淡去；偶尔一颗星芒
    if (split) {
      this.ghostCd -= dt;
      if (this.ghostCd <= 0 && !hover) {
        this.ghostCd = 0.05;
        this.ghosts.push({ x, y, t: 0 });
      }
      if (Math.random() < 0.12) ctx.bits.spawn(x + rnd(-5, 5), y + rnd(-5, 5), { frames: Ts('star', () => STAR).slice(1, 3), fps: 10, life: 0.25, fadeOut: 0.12 });
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      if (g.t > 0.32) {
        this.ghosts.splice(i, 1);
        continue;
      }
      const a = 0.7 * (1 - g.t / 0.32);
      const rr = 4.5 + g.t * 6;
      for (let k = 0; k < 20; k++) {
        const ang = (k / 20) * TAU;
        px.dot(g.x + Math.cos(ang) * rr, g.y + Math.sin(ang) * rr, k % 5 === 0 ? C.W : C.Y, a);
      }
    }
    // 神品「赤焰轮」：圈上一周往外窜的火舌，跟着圈一起转（带一点旋涡的弯），像一只风火轮
    if (flame) {
      const st = this.stroke;
      for (let k = 0; k < 7; k++) {
        const base = t * 11 + (k / 7) * TAU;
        const L = 6 + 4 * Math.abs(Math.sin(t * 8 + k * 1.9));
        for (let u = 0; u <= 1; u += 0.1) {
          const r = 5 + u * L;
          const a = base - u * 0.8;
          stamp(st, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, 1.4 * (1 - u) + 0.3, 1, WHEEL_FLAME);
        }
      }
      st.commit(px);
    }
    // 仙品质变：悬停时的绞杀（火星飞旋 + 三道火弧 + 往里卷的火气）
    if (tier >= 3 && hover) {
      if (!this.hovering) {
        this.hovering = true;
        ctx.sound('qiankun.hover');
      }
      for (let i = 0; i < 14; i++) {
        const base = t * 9 + (i / 14) * TAU;
        const rad = 10 + 4 * Math.sin(t * 5 + i * 1.7);
        for (let k = 0; k < 5; k++) {
          const a = base - k * 0.12;
          px.dot(x + Math.cos(a) * rad, y + Math.sin(a) * rad * 0.8, [C.W, C.f, C.Y, C.o, C.e][k], 1 - k * 0.17);
        }
      }
      // 三道火弧：头粗尾细、深色描边，绕着圈绞
      const st = this.stroke;
      for (let j = 0; j < 3; j++) {
        const base = t * 13 + (j / 3) * TAU;
        for (let da = 0; da < 1.8; da += 0.05) {
          const a = base - da;
          const k = da / 1.8;
          stamp(st, x + Math.cos(a) * 15, y + Math.sin(a) * 15 * 0.8, 1.6 * (1 - k) + 0.2, 1 - k * 0.5, HOVER_ARC);
        }
      }
      st.commit(px);
      if (Math.random() < 0.7) {
        const a = rnd(0, TAU);
        ctx.glows.emit(x + Math.cos(a) * 20, y + Math.sin(a) * 16, 1, FIRE_SPARKS, [34, 44], [0.3, 0.4], { dir: a + Math.PI + 0.7, spread: 0.2, drag: 1 });
      }
    } else this.hovering = false;
  }
  destroy() {}
}

// ---------------------------------------------------------------- 斩仙飞刀

/** 斩仙飞刀：更大的白金飞刀（神品「请宝贝转身」是有眉有目带翅的一道白光），拖一条光尾。 */
class KnifeView {
  private s = new Sprite();
  private hist: [number, number, number][] = [];
  private stroke = new Stroke();
  private t = 0;
  private gone = -1;
  private last: [number, number, number] = [0, 0, 0];
  private cols: [number, number, number, number];
  constructor(ctx: Ctx, id: number, many: boolean) {
    ctx.layer.addChild(this.s);
    this.cols = many ? ([[C.W, C.f, C.Y, C.B], [C.W, C.Cc, C.c, C.N], [C.W, C.w, C.j, C.h]] as [number, number, number, number][])[id % 3] : [C.W, C.f, C.Y, C.B];
  }
  update(dt: number, ctx: Ctx, k: { x: number; y: number; vx: number; vy: number } | null, winged: boolean): boolean {
    this.t += dt;
    if (!k) {
      // 飞刀收走：原地淡出、往前滑一点
      if (this.gone < 0) {
        this.gone = 0;
        ctx.bits.spawn(this.last[0], this.last[1], { frames: Ts('star', () => STAR).slice(1, 3), fps: 10, life: 0.22, fadeOut: 0.12 });
      }
      this.gone += dt;
      this.s.alpha = Math.max(0, 1 - this.gone / 0.25);
      this.s.x += Math.cos(this.last[2]) * 40 * dt;
      this.s.y += Math.sin(this.last[2]) * 40 * dt;
      this.hist.shift();
      if (this.hist.length > 2) {
        polyStreak(this.stroke, this.hist.map((h) => [h[0], h[1]] as [number, number]), 1.6, this.s.alpha, this.cols);
        this.stroke.commit(ctx.top);
      }
      return this.gone < 0.27;
    }
    const ang = Math.atan2(k.vy, k.vx);
    this.last = [k.x, k.y, ang];
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    if (winged) {
      const f = Math.floor(this.t * 10) % 2;
      applyRot(this.s, rotTex(`wing${f}`, WINGED_KNIFE[f], ang, WINGED_TIP.x, WINGED_TIP.y, 32, { W: 'h', w: 'h', j: 'h', f: 'B', k: 'k' }, true));
    } else applyRot(this.s, rotTex('knife', KNIFE, ang, KNIFE_TIP.x, KNIFE_TIP.y, 32, KNIFE_SEL));
    this.s.position.set(Math.round(k.x + ux * 7), Math.round(k.y + uy * 7));
    this.s.alpha = clamp01(this.t / 0.06);
    this.s.visible = true;
    this.hist.unshift([k.x - ux * 3, k.y - uy * 3, this.t]);
    const age = winged ? 0.2 : 0.14;
    while (this.hist.length > 2 && this.t - this.hist[this.hist.length - 1][2] > age) this.hist.pop();
    if (this.hist.length > 1) {
      polyStreak(this.stroke, this.hist.map((h) => [h[0], h[1]] as [number, number]), winged ? 2.4 : 1.8, 0.95, this.cols);
      this.stroke.commit(ctx.top);
    }
    if (Math.random() < 0.25) ctx.sparks.emit(k.x - ux * 8, k.y - uy * 8, 1, [C.W, C.f], [3, 10], [0.2, 0.35], { drag: 3 });
    return true;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 一圈往外射的光芒（破军的震波）：粗细有致、带深边的光线从中心向四周射出去，再变短淡掉。 */
export class Rays implements Effect {
  private t = 0;
  private st = new Stroke();
  private angs: number[];
  private x: number;
  private y: number;
  private r: number;
  private cols: [number, number, number, number];
  constructor(x: number, y: number, r: number, n: number, cols: [number, number, number, number]) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.cols = cols;
    this.angs = Array.from({ length: n }, (_, i) => (i / n) * TAU + rnd(-0.08, 0.08));
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const LIFE = 0.5;
    const k = this.t / LIFE;
    const head = this.r * (0.3 + 0.9 * easeOut(k * 1.6));
    const tail = this.r * (0.35 + 0.85 * easeIn(k));
    const a = 1 - clamp01((k - 0.5) / 0.5);
    for (const ang of this.angs) {
      const ux = Math.cos(ang);
      const uy = Math.sin(ang) * 0.7;
      for (let s = tail; s <= head; s += 0.7) {
        const u = (s - tail) / Math.max(1, head - tail);
        stamp(this.st, this.x + ux * s, this.y + uy * s, 0.4 + 1.1 * u, a, this.cols);
      }
    }
    this.st.commit(ctx.top);
    return this.t < LIFE;
  }
  destroy() {}
}

// ---------------------------------------------------------------- 戊己杏黄旗

/**
 * 杏黄旗：有护盾时一面杏黄旗插在哪吒身后飘（从地里升起来；连旗杆 28 像素，和人差不多高，不比人大）；挡伤时金莲花瓣绽开、旗身一颤；
 * 仙品起旗换成金边朱卦、带明珠红缨金穗的那一面，有盾时脚下一朵金莲；神品「金莲护体」是重瓣大莲 + 身边绕飞的花瓣，
 * 「破军」是朱红战旗、破碎时震波更猛。护盾破碎：旗面撕开飞散、旗杆沉下去，一圈尘浪和花瓣往外推（都收在震开的范围里）。
 */
/** 旗杆插在人物身后多远（旗面往更后面飘，不贴着人的头和发髻）。 */
const FLAG_BACK = 13;
class FlagView {
  private flag = new Sprite();
  private lotus = new Sprite();
  private orbit: Sprite[] = [];
  private shown = false;
  private t = 0;
  private raiseT = 0;
  private dropT = -1;
  private shudder = 0;
  private flash = 0;
  private lotusA = 0;
  private hx = 0;
  private hy = 0;
  private facing: 1 | -1 = 1;
  constructor(ctx: Ctx) {
    this.flag.visible = false;
    this.lotus.visible = false;
    this.lotus.anchor.set(0.5, 0.55);
    ctx.stage.entities.addChild(this.flag);
    ctx.floor.addChild(this.lotus);
  }
  get pos(): [number, number] {
    return [this.hx, this.hy];
  }
  update(dt: number, ctx: Ctx, hx: number, hy: number, facing: 1 | -1, shield: boolean, tier: number, spirit: string | null, lotusR?: number) {
    this.t += dt;
    this.hx = hx;
    this.hy = hy;
    this.facing = facing;
    const style = tier >= 4 && spirit === 'burst' ? 'war' : tier >= 3 ? 'golden' : 'apricot';
    if (shield && !this.shown) {
      this.shown = true;
      this.raiseT = 0;
      this.dropT = -1;
      ctx.bits.spawn(hx - facing * FLAG_BACK, hy, { frames: puffSet(5, 'gold', 2), life: 0.6, vy: -10, fadeOut: 0.3 });
      ctx.glows.emit(hx - facing * (FLAG_BACK + 3), hy - 20, 12, GOLD_SPARKS, [10, 34], [0.4, 0.8], { up: 16, drag: 2 });
    }
    if (!shield && this.shown && this.dropT < 0) this.dropT = 0;
    this.shudder = Math.max(0, this.shudder - dt);
    this.flash = Math.max(0, this.flash - dt);
    // 旗
    if (this.shown) {
      this.raiseT += dt;
      const frames = Ts(`flag${style}${facing}`, () => flagFrames(8, style).map((g) => (facing > 0 ? flipX(g) : g)));
      this.flag.texture = frames[Math.floor(this.t * 9) % frames.length];
      const footX = facing > 0 ? FLAG_W - 1 - FLAG_FOOT.x : FLAG_FOOT.x;
      this.flag.anchor.set((footX + 0.5) / FLAG_W, (FLAG_FOOT.y + 0.5) / FLAG_H);
      // 从地里升起来：带一点回弹的缓出（升起、沉下的距离按旗高来，旗矮了也不会整面露在脚下）
      const k = clamp01(this.raiseT / 0.5);
      const back = 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;
      let sink = (1 - back) * FLAG_H * 0.56;
      let a = clamp01(this.raiseT / 0.2);
      if (this.dropT >= 0) {
        this.dropT += dt;
        const d = this.dropT / 0.4;
        sink = easeIn(d) * FLAG_H * 0.48;
        a *= 1 - clamp01(d);
        if (d >= 1) this.shown = false;
      }
      const jit = this.shudder > 0 ? Math.round(Math.sin(this.t * 70)) : 0;
      this.flag.position.set(Math.round(hx - facing * FLAG_BACK + jit), Math.round(hy - 1 + sink));
      this.flag.zIndex = hy - 0.5;
      this.flag.alpha = a;
      this.flag.tint = this.flash > 0 ? 0xfff6d0 : 0xffffff;
      this.flag.visible = a > 0;
    } else this.flag.visible = false;
    // 仙品：脚下金莲
    // 模拟给了金莲半径（p.lotus）就以它为准，没给就按品阶
    const wantLotus = shield && (lotusR !== undefined ? lotusR > 0 : tier >= 3);
    this.lotusA = wantLotus ? Math.min(1, this.lotusA + dt / 0.3) : Math.max(0, this.lotusA - dt / 0.25);
    const big = tier >= 4 && spirit === 'lotus';
    if (this.lotusA > 0) {
      const fr = Ts(`lotus${big ? 1 : 0}`, () => lotusFrames(8, big));
      this.lotus.texture = fr[Math.floor(this.t * 6) % fr.length];
      this.lotus.position.set(Math.round(hx), Math.round(hy + 1));
      this.lotus.alpha = this.lotusA * (this.flash > 0 ? 1 : 0.95);
      this.lotus.visible = true;
    } else this.lotus.visible = false;
    // 神品「金莲护体」：四片金莲花瓣绕着人飞
    const wantOrbit = shield && big;
    if (wantOrbit && !this.orbit.length)
      for (let i = 0; i < 4; i++) {
        const s = new Sprite(Ts('gpetal', () => GOLD_PETAL)[0]);
        s.anchor.set(0.5);
        ctx.stage.entities.addChild(s);
        this.orbit.push(s);
      }
    this.orbit.forEach((s, i) => {
      const a = this.t * 1.7 + (i / 4) * TAU;
      s.texture = Ts('gpetal', () => GOLD_PETAL)[(Math.floor(this.t * 8) + i * 2) % GOLD_PETAL.length];
      s.position.set(Math.round(hx + Math.cos(a) * 15), Math.round(hy - 11 + Math.sin(a) * 6));
      s.zIndex = hy + Math.sin(a) * 6;
      s.alpha = wantOrbit ? Math.min(1, s.alpha + dt / 0.3) : Math.max(0, s.alpha - dt / 0.25);
      s.visible = s.alpha > 0;
    });
  }
  /** 挡下一次：金莲花瓣在身前绽开，旗一颤、一亮。 */
  block(ctx: Ctx, tier: number) {
    const [hx, hy] = this.pos;
    this.shudder = 0.28;
    this.flash = 0.12;
    // 金莲花瓣在身边绽开：一圈花瓣从身体四周往外张开、慢慢飘落（不盖住人）
    const petals = Ts('gpetal', () => GOLD_PETAL);
    const n = tier >= 3 ? 12 : 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.15, 0.15);
      const sp = rnd(22, 36);
      ctx.bits.spawn(hx + Math.cos(a) * 11, hy - 11 + Math.sin(a) * 9, { frames: petals, fps: rnd(9, 14), loop: true, life: rnd(0.8, 1.1), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 4, g: 16, drag: 2.4, fadeIn: 0.06, fadeOut: 0.45 });
    }
    ctx.glows.emit(hx, hy - 12, 10, GOLD_SPARKS, [25, 55], [0.3, 0.6], { drag: 3 });
  }
  /** 破碎：旗面撕成碎片飞散，一圈尘浪和花瓣往外推（破军再加一圈金色的冲击线）。 */
  shatter(ctx: Ctx, x: number, y: number, r: number, war: boolean): Effect | null {
    const n = 18 + (war ? 6 : 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.1, 0.1);
      const sp = (r / 0.5) * rnd(0.85, 1.1) * (war ? 1.3 : 1);
      ctx.bits.spawn(x + Math.cos(a) * 6, y + Math.sin(a) * 4, { frames: puffSet(pick([4, 5, 6]), 'stone', 1 + (i % 3)), life: rnd(0.6, 0.85), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, drag: 3.2, fadeIn: 0.03, fadeOut: 0.3, z: true, zOff: 1 });
    }
    const petals = Ts('gpetal', () => GOLD_PETAL);
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(40, 80);
      ctx.bits.spawn(x, y - 10, { frames: petals, fps: 14, loop: true, life: rnd(0.8, 1.2), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 20, g: 40, drag: 2, fadeOut: 0.45 });
    }
    // 旗面碎片：从旗面中心飞散，落在震开的范围里
    const cloth = Ts(`cloth${war ? 1 : 0}`, () => (war ? [lined({ w: 2, h: 2, rows: ['eo', 'er'] }, 'k', { e: 'R', o: 'R', r: 'R' }), lined({ w: 2, h: 1, rows: ['Ye'] }, 'k', { Y: 'B', e: 'R' })] : [lined({ w: 2, h: 2, rows: ['yY', 'by'] }, 'k', { y: 'B', Y: 'B', b: 'B' }), lined({ w: 2, h: 1, rows: ['ye'] }, 'k', { y: 'B', e: 'R' })]));
    const [fx, fy] = [this.hx - this.facing * (FLAG_BACK + FLAG_CLOTH.dx), this.hy - 1 - FLAG_CLOTH.dy];
    for (let i = 0; i < 7; i++)
      ctx.bits.spawn(fx + rnd(-4, 4), fy + rnd(-3, 3), { frames: [cloth[i % 2]], life: rnd(0.7, 1), vx: rnd(-18, 18) - this.facing * 8, vy: -rnd(15, 45), g: 160, ground: this.hy + rnd(-2, 4), fadeOut: 0.35 });
    ctx.shake.add(war ? 0.38 : 0.22);
    // 破军：一圈金色的光芒射出去（光芒最长到 Rays 半径的 1.2 倍：收在震开的范围以内）
    return war ? new Rays(x, y - 6, r * 0.8, 14, [C.W, C.Y, C.y, C.B]) : null;
  }
  destroy() {
    this.flag.destroy();
    this.lotus.destroy();
    for (const s of this.orbit) s.destroy();
  }
}

// ---------------------------------------------------------------- 五行相生的名字

const REACT_STYLE: Record<ReactionKind, { color: string[]; outline: string; sparks: number[]; el: Element }> = {
  frost: { color: ['W', 'C'], outline: 'N', sparks: [C.W, C.Cc, C.c], el: 'water' },
  conduct: { color: ['W', 'L'], outline: 'G', sparks: [C.W, C.L, C.Cc], el: 'wood' },
  ignite: { color: ['Y', 'o'], outline: 'R', sparks: FIRE_SPARKS, el: 'fire' },
  lava: { color: ['Y', 'b'], outline: 'R', sparks: [C.Y, C.o, C.b, C.e], el: 'earth' },
  pierce: { color: ['W', 'Y'], outline: 'B', sparks: GOLD_SPARKS, el: 'metal' },
};

/** 相生飘字：像素体的两个字从敌人头顶浮起来，停一下再淡去。 */
class ReactPopup implements Effect {
  t = 0;
  private s: Sprite;
  x: number;
  y: number;
  constructor(ctx: Ctx, kind: ReactionKind, x: number, y: number) {
    const st = REACT_STYLE[kind];
    this.s = new Sprite(pixelTextTexture(REACTIONS[kind].name, { color: st.color, outline: st.outline }));
    this.s.anchor.set(0.5, 1);
    this.x = x;
    this.y = y;
    this.s.alpha = 0;
    ctx.layer.addChild(this.s);
  }
  update(dt: number): boolean {
    this.t += dt;
    const LIFE = 1.3;
    const rise = 9 * easeOut(this.t / 0.6) + 3 * clamp01((this.t - 0.6) / 0.7);
    this.s.position.set(Math.round(this.x), Math.round(this.y - rise + (this.t < 0.06 ? 2 : 0)));
    this.s.alpha = fade(this.t, LIFE, 0.1, 0.4);
    return this.t < LIFE;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 相生时那一小团五行色的东西：火苗 / 雪花 / 电光 / 熔滴 / 金屑。 */
function reactBurst(ctx: Ctx, kind: ReactionKind, x: number, y: number) {
  const st = REACT_STYLE[kind];
  ctx.sparks.emit(x, y, 12, st.sparks, [25, 70], [0.35, 0.7], { drag: 3, up: kind === 'ignite' ? 20 : 0, g: kind === 'lava' ? 120 : 0 });
  if (kind === 'ignite') for (let i = 0; i < 5; i++) ctx.bits.spawn(x + rnd(-6, 6), y + rnd(0, 6), { sizes: [1, 2, 3, 2, 1], fps: 12, life: rnd(0.4, 0.6), delay: i * 0.03, vy: -10, fadeOut: 0.2 });
  if (kind === 'frost') for (let i = 0; i < 4; i++) ctx.bits.spawn(x + rnd(-6, 6), y + rnd(-6, 4), { frames: [Ts('snow', () => SNOWFLAKE)[1]], life: rnd(0.5, 0.8), vx: rnd(-14, 14), vy: rnd(-14, 4), drag: 2, fadeOut: 0.3 });
  if (kind === 'lava') for (let i = 0; i < 3; i++) ctx.bits.spawn(x + rnd(-4, 4), y + 4, { frames: puffSet(4, 'smoke', i + 1), life: 0.7, vy: -12, delay: i * 0.05, alpha: 0.7, fadeOut: 0.35 });
  if (kind === 'pierce' || kind === 'conduct') for (let i = 0; i < 3; i++) ctx.bits.spawn(x + rnd(-7, 7), y + rnd(-7, 5), { frames: Ts('star', () => STAR).slice(1, 3), fps: 12, life: 0.3, delay: i * 0.06, fadeOut: 0.15, tint: kind === 'conduct' ? C.L : 0xffffff });
}

/** 引燃：一圈火苗往外窜到波及的半径；熔岩：一圈熔浆滴溅出去，落地冒烟。 */
function reactRing(ctx: Ctx, kind: 'ignite' | 'lava', x: number, y: number, r: number) {
  const n = Math.max(8, Math.round(r / 3));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.1, 0.1);
    if (kind === 'ignite') ctx.bits.spawn(x, y, { sizes: [1, 2, 3, 2, 1], fps: 12, life: rnd(0.45, 0.6), vx: Math.cos(a) * (r / 0.35), vy: Math.sin(a) * (r / 0.35) * 0.7, drag: 5, fadeOut: 0.22 });
    else {
      const gy = y + Math.sin(a) * r * 0.55 * rnd(0.6, 1);
      ctx.bits.spawn(x, y - 8, { frames: [Ts('lava', () => [lined({ w: 1, h: 2, rows: ['Y', 'o'] }, 'R')])[0]], life: rnd(0.45, 0.6), vx: Math.cos(a) * r * 1.6, vy: -rnd(60, 90), g: 320, ground: gy, fadeOut: 0.15 });
    }
  }
  if (kind === 'lava') for (let i = 0; i < 4; i++) ctx.bits.spawn(x + rnd(-r, r) * 0.5, y + rnd(-3, 3), { frames: puffSet(4, 'smoke', i + 1), life: 0.8, delay: 0.3 + i * 0.05, vy: -10, alpha: 0.6, fadeOut: 0.4 });
}

// ---------------------------------------------------------------- 敌人身上的状态

/** 每只敌人身上的状态画面：五行印记、灼烧的火舌、冻住的冰壳、流血的血珠。 */
interface EnemyFx {
  wound: Sprite | null;
  mark: Sprite | null;
  markEl: Element | null;
  markAge: number;
  burn: Sprite | null;
  burnDx: number;
  crust: Sprite | null;
  frozen: boolean;
  bleedCd: number;
  bleeding: boolean;
  flameCd: number;
  seen: number;
}

// ================================================================ 对外

/** 这里画的地面区域（其余种类是新法宝的，另外画）。 */
const MY_ZONES = new Set<Zone['kind']>(['fireTrail', 'fireDome', 'crack', 'frost']);

type Gear = { tier: number; spirit: string | null };

export class WeaponFx {
  private ctx: Ctx;
  private effects: Effect[] = [];
  private seals = new Map<number, SealDrop>();
  private frosts = new Map<number, FrostPatch>();
  private tmarks = new Map<number, ThunderMark>();
  private warned = new Map<number, { kind: string; tier: number; spirit: string | null; owner: number }>();
  private zones = new Map<number, ZoneView>();
  private rings = new Map<number, RingView>();
  private knives = new Map<number, KnifeView>();
  private flags = new Map<number, FlagView>();
  private status = new Map<number, EnemyFx>();
  private popups: ReactPopup[] = [];
  private thrustN = new Map<number, number>();
  private chainN = new Map<number, number>();
  private slamN = new Map<number, number>();
  private chillN = 0;
  private auraBy = new Set<number>();
  private lastSound = new Map<string, number>();
  private time = 0;
  private frame = 0;
  private byId = new Map<number, Enemy>();
  private ixTick = -1;
  private alpha = 1;
  private bits: Bits;
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private floor = new Container();
  private stage: Stage;
  private sfx: Sfx;
  /** 这只敌人的灼烧火苗 / 冰壳是不是已经由别处画了（xfx.ts 的修仙版状态效果；满了的还是这里画）。 */
  skipStatus: ((id: number, what: 'burn' | 'frozen') => boolean) | null = null;
  /** 落点的那一下交给别处画（见 Ctx.impactFx）。 */
  impactFx: Ctx['impactFx'] = undefined;
  /** 五行相生的那一下交给别处画（xfx.ts：土生金「淬锋」的裂甲）：返回 true 就不放这里那一小团五行色的东西（飘字照旧）。 */
  reactFx: ((kind: ReactionKind, id: number, x: number, y: number) => boolean) | null = null;
  /** 炸开（火行「燎原」、寒冰幡「碎冰」）由别处画了没有（xfx.ts 的修仙版；放了返回 true，这里就不放原来的方块火苗 / 冰片）。 */
  explodeFx: ((x: number, y: number, r: number, ice: boolean) => boolean) | null = null;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sfx = sfx;
    stage.floor.addChild(this.floor);
    this.floor.addChild(this.under.g);
    stage.fx.addChild(this.layer);
    this.bits = new Bits(this.layer, stage.entities);
    this.layer.addChild(this.top.g);
    const self = this;
    this.ctx = {
      bits: this.bits,
      top: this.top,
      under: this.under,
      sparks,
      glows,
      stage,
      layer: this.layer,
      floor: this.floor,
      shake,
      sound: (name, vol = 1, gap = 0.05) => self.sound(name, vol, gap),
      enemyPos: (id) => self.enemyPos(id),
      enemy: (id) => self.byId.get(id),
      get time() {
        return self.time;
      },
      impactFx: (what, x, y, r, tier, style) => !!self.impactFx?.(what, x, y, r, tier, style),
    };
  }

  /** 清空（重开一局或一波开始 / 结束时）。 */
  clear() {
    for (const e of this.effects) e.destroy();
    this.effects = [];
    for (const m of [this.seals, this.frosts, this.tmarks, this.zones]) {
      for (const e of m.values()) e.destroy();
      m.clear();
    }
    this.warned.clear();
    for (const r of this.rings.values()) r.destroy();
    this.rings.clear();
    for (const k of this.knives.values()) k.destroy();
    this.knives.clear();
    for (const s of this.status.values()) this.dropStatus(s);
    this.status.clear();
    for (const p of this.popups) p.destroy();
    this.popups = [];
    this.bits.clear();
  }

  private sound(name: string, vol = 1, gap = 0.05) {
    const last = this.lastSound.get(name) ?? -1;
    if (this.time - last < gap) return;
    this.lastSound.set(name, this.time);
    this.sfx.play(name, vol);
  }

  private enemyPos(id: number): [number, number] | null {
    const e = this.byId.get(id);
    if (!e) return null;
    return [e.px + (e.x - e.px) * this.alpha, e.py + (e.y - e.py) * this.alpha];
  }

  /** 某件法宝的品阶与器灵：事件带了 tier 就用事件的，器灵从玩家手里的法宝读（神品才算）。 */
  private gear(w: World, owner: number | undefined, kind: WeaponKind, tier?: number): Gear {
    const p = w.players[owner ?? 0] ?? w.players[0];
    const wp = p?.weapons.find((x) => x.kind === kind);
    const t = Math.max(1, Math.min(4, tier ?? wp?.tier ?? 1));
    return { tier: t, spirit: t >= 4 ? (wp?.spirit ?? null) : null };
  }

  private add<T extends Effect>(e: T): T {
    this.effects.push(e);
    return e;
  }

  onEvent(e: SimEvent, w: World) {
    const ctx = this.ctx;
    this.indexEnemies(w);
    switch (e.t) {
      case 'thrust': {
        const p = w.players[e.owner];
        const kind: WeaponKind = e.kind ?? (this.auraBy.has(e.owner) && p?.weapons.some((x) => x.kind === 'jiulong' && x.spirit === 'nine') ? 'jiulong' : 'huojian');
        if (kind !== 'huojian' && kind !== 'jiulong') break; // 别的法宝（以后的新法宝）不在这里画
        if (kind === 'jiulong') {
          const n = this.thrustN.get(-1 - e.owner) ?? 0;
          this.thrustN.set(-1 - e.owner, n + 1);
          this.add(new Dragon(ctx, e.x0, e.y0, e.x1, e.y1, 0.03 + n * 0.02, n === 0));
          break;
        }
        const g = this.gear(w, e.owner, 'huojian', e.tier);
        const n = this.thrustN.get(e.owner) ?? 0;
        this.thrustN.set(e.owner, n + 1);
        const storm = g.spirit === 'storm';
        const sun = g.spirit === 'pierce';
        // 火苗：凡少而小，灵多而大；仙品以上地上另有火痕区域，枪路上的火苗不再加；
        // 两个器灵各有主角 —— 梨花枪是白色的梨花瓣和枪花，贯日是一道长长的金色枪芒，火都收着
        const SMALL = [[0, 1, 2, 1, 0], [0, 2, 2, 1, 0], [0, 1, 1, 0], [1, 2, 2, 0]];
        const MID = [[1, 2, 3, 2, 1], [0, 2, 3, 2, 0], [0, 1, 2, 1], [1, 3, 3, 1, 0]];
        const st: ThrustStyle = {
          fire: g.tier >= 3,
          reach: sun ? 30 : [0, 20, 23, 25, 26][g.tier],
          hw: sun ? 3.8 : [0, 2, 2.3, 2.6, 2.6][g.tier],
          flameEvery: storm ? 11 : sun ? 8 : [0, 8, 6.5, 6.5, 6.5][g.tier],
          flameSizes: storm || g.tier === 1 ? SMALL : MID,
          flameLife: g.tier >= 3 ? [0.5, 0.85] : g.tier >= 2 ? [0.42, 0.75] : [0.38, 0.65],
          pear: storm,
          sun,
          hold: sun ? 0.16 : storm ? 0.14 : 0.1,
        };
        // 同一帧来了几刺：梨花枪是扇形齐出，其余是连刺（一刺接一刺）
        this.add(new Thrust(ctx, e.x0, e.y0, e.x1, e.y1, st, storm ? n * 0.02 : n * 0.2));
        break;
      }
      case 'aura': {
        const p = w.players[e.owner];
        const far = p ? Math.hypot(e.x - p.x, e.y - (p.y - 6)) > 20 : false;
        const kind: WeaponKind = e.kind ?? (far ? 'qiankun' : 'jiulong');
        if (kind !== 'qiankun' && kind !== 'jiulong') break;
        if (kind === 'qiankun') {
          fireNova(ctx, e.x, e.y, e.r);
          break;
        }
        this.auraBy.add(e.owner);
        const g = this.gear(w, e.owner, 'jiulong', e.tier);
        this.add(new Dome(ctx, e.x, e.y, e.r, { tier: g.tier, wide: g.spirit === 'wide', nine: g.spirit === 'nine' }, e.owner));
        break;
      }
      case 'chain': {
        if (e.kind && e.kind !== 'leigong') break; // 定风珠等别的法宝也发 chain，不画成雷
        const g = this.gear(w, e.owner, 'leigong', e.tier);
        const n = this.chainN.get(e.owner) ?? 0;
        this.chainN.set(e.owner, n + 1);
        const twin = g.spirit === 'twin';
        const storm = g.spirit === 'storm';
        const style: BoltStyle = storm ? 'violet' : twin ? (n % 2 ? 'azure' : 'gold') : 'azure';
        this.add(new Bolt(ctx, e.pts, style, { trunk: g.tier >= 2 ? 3 : 2, branches: 1 + g.tier, skyEach: storm, whip: true }));
        this.sound('leigong.strike');
        break;
      }
      case 'warn': {
        if (e.kind !== 'slam' && e.kind !== 'spike' && e.kind !== 'thunder' && e.kind !== 'frost') break; // 打神鞭的落鞭（lash）等不归这里画
        const q = w.pending.find((x) => x.id === e.id);
        const owner = q?.owner ?? 0;
        const wk: WeaponKind = e.kind === 'slam' ? 'fantian' : e.kind === 'thunder' ? 'leigong' : 'hanbing';
        const g = this.gear(w, owner, wk, e.tier ?? q?.tier);
        this.warned.set(e.id, { kind: e.kind, tier: g.tier, spirit: g.spirit, owner });
        if (e.kind === 'slam') {
          // 印的大小：凡 18、灵起 22、「地裂」26；三山压顶同一帧里后落的两方是小印，小一号
          const n = this.slamN.get(owner) ?? 0;
          this.slamN.set(owner, n + 1);
          const side = g.spirit === 'triple' && n > 0;
          const size = g.spirit === 'quake' ? 26 : side ? 18 : g.tier >= 2 ? 22 : 18;
          const glyph: SealGlyph = g.spirit === 'triple' ? 'shan' : g.spirit === 'quake' ? 'kun' : 'yin';
          this.seals.set(e.id, new SealDrop(ctx, e.x, e.y, e.r, e.t2, g.tier, size, glyph));
          this.sound('fantian.fall', 0.8);
        } else if (e.kind === 'spike') {
          this.frosts.set(e.id, new FrostPatch(ctx, e.x, e.y, Math.max(8, e.r * 0.9), e.t2));
          this.sound('hanbing.frost', 0.6);
        } else if (e.kind === 'thunder') {
          this.tmarks.set(e.id, new ThunderMark(ctx, q?.target ?? -1, e.x, e.y, e.t2));
          this.sound('leigong.mark');
        } else {
          // 寒气蔓延：一圈寒雾从外往里收拢，冰晶一闪一闪（地上的霜由寒霜区域画）
          this.add(new Chill(ctx, e.x, e.y, e.r, e.t2));
          this.sound('hanbing.frost', 0.8);
        }
        break;
      }
      case 'land': {
        if (e.kind !== 'slam' && e.kind !== 'spike' && e.kind !== 'thunder' && e.kind !== 'frost') break;
        const info = this.warned.get(e.id);
        this.warned.delete(e.id);
        if (e.kind === 'slam') {
          const s = this.seals.get(e.id);
          if (s && !e.quake) {
            s.land(ctx);
            this.seals.delete(e.id);
            this.add(s);
          } else {
            // 器灵「地裂震波」：印落地后再震出的那一圈（不预警）
            this.add(new Quake(ctx, e.x, e.y, e.r));
            this.sound('fantian.land', 0.8);
          }
        } else if (e.kind === 'spike') {
          const f = this.frosts.get(e.id);
          if (f) {
            f.land();
            this.frosts.delete(e.id);
            this.add(f);
          }
          const big = (info?.tier ?? 1) >= 2;
          this.add(new IceSpike(ctx, e.x, e.y, big));
          if (info?.spirit === 'field') this.add(new FrostPatch(ctx, e.x, e.y, 14, 0.1, 1.2));
          this.sound('hanbing.spike');
        } else if (e.kind === 'thunder') {
          const m = this.tmarks.get(e.id);
          let at: [number, number] = [e.x, e.y - 8];
          if (m) {
            const [x, y] = m.where(ctx);
            at = [x, y - 8];
            m.landedAt = m.t;
            this.tmarks.delete(e.id);
            this.add(m);
          }
          this.add(new Bolt(ctx, [at], info?.spirit === 'storm' ? 'violet' : 'azure', { trunk: 2, branches: 2, skyEach: false, whip: false, skyOnly: true }));
          this.sound('leigong.strike', 0.8);
        } else {
          const f = this.frosts.get(e.id);
          if (f) {
            f.land();
            this.frosts.delete(e.id);
            this.add(f);
          }
          // 延时冻结：寒气收拢的那一下，三簇小冰棱同时冒出来，雪团炸开，一圈冰晶闪过
          // （同一帧里落好几处时，后面的只冒一簇，免得满地都是冰）
          const nth = this.chillN;
          this.chillN++;
          for (let i = 0; i < (nth < 3 ? 3 : 1); i++) {
            const a = (i / 3) * TAU + rnd(-0.4, 0.4);
            const rr = rnd(0.35, 0.6) * e.r;
            this.add(new IceSpike(ctx, e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr * 0.62, false, rnd(0.4, 0.55)));
          }
          for (let i = 0; i < 3; i++) ctx.bits.spawn(e.x + rnd(-8, 8), e.y + rnd(-4, 4), { frames: puffSet(5, 'snow', i + 1), life: 0.7, vy: -10, alpha: 0.7, delay: i * 0.04, fadeOut: 0.35 });
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            ctx.bits.spawn(e.x + Math.cos(a) * e.r * 0.8, e.y + Math.sin(a) * e.r * 0.5 - 3, { frames: Ts('star', () => STAR).slice(0, 3), fps: 12, loop: false, life: 0.28, delay: i * 0.015, fadeOut: 0.12 });
          }
          this.sound('hanbing.frost');
        }
        break;
      }
      case 'throw': {
        // 神品「金环分光」：出手那一下，手上金光一分为二
        if (e.kind === 'qiankun' || e.kind === undefined) {
          const g = this.gear(w, e.owner, 'qiankun', e.tier);
          if (g.spirit === 'split') {
            ctx.bits.spawn(e.x, e.y, { frames: Ts('star', () => STAR).slice(1, 4), fps: 14, loop: false, life: 0.3, fadeOut: 0.15 });
            ctx.glows.emit(e.x, e.y, 12, GOLD_SPARKS, [30, 70], [0.3, 0.55], { drag: 3 });
          }
        }
        break;
      }
      case 'shieldUp':
        this.sound('xinghuang.up');
        break;
      case 'blocked': {
        if (e.by === 'shield') {
          const g = this.gear(w, e.owner, 'xinghuang');
          this.flagOf(e.owner).block(ctx, g.tier);
          this.sound('xinghuang.block');
        } else ctx.glows.emit(e.x, e.y - 14, 8, GOLD_SPARKS, [30, 70], [0.2, 0.4]);
        break;
      }
      case 'shieldBreak': {
        const g = this.gear(w, e.owner, 'xinghuang');
        const extra = this.flagOf(e.owner).shatter(ctx, e.x, e.y, e.r, g.spirit === 'burst');
        if (extra) this.add(extra);
        this.sound('xinghuang.break');
        break;
      }
      case 'freeze':
        ctx.sparks.emit(e.x, e.y - 8, 6, ICE_SPARKS, [15, 40], [0.3, 0.5]);
        ctx.bits.spawn(e.x + rnd(-3, 3), e.y - 10, { frames: [Ts('snow', () => SNOWFLAKE)[1]], life: 0.5, vy: -10, fadeOut: 0.25 });
        break;
      case 'explode': {
        // 炸开的事件不带是谁的：联机时有人带着寒冰幡「碎冰」就按碎冰画（单人就是自己）
        const shatter = w.players.some((p) => p.weapons.some((x) => x.kind === 'hanbing' && x.spirit === 'shatter'));
        const ice = shatter && e.r <= 23;
        // 修仙版（xfx.ts，fxpolish）放了就不放下面原来的冰片 / 方块火苗（声音照旧）
        if (this.explodeFx?.(e.x, e.y, e.r, ice)) this.sound(ice ? 'hanbing.spike' : 'jiulong.burst', ice ? 0.6 : 0.5);
        else if (ice) {
          const chips = Ts('chips', () => ICE_CHIPS);
          // 冰片溅开的远近按炸开的半径算（落在碎冰的判定里，原来溅到半径的两倍多）
          for (let i = 0; i < 12; i++) {
            const a = rnd(0, TAU);
            const sp = e.r * rnd(0.8, 1.6);
            ctx.bits.spawn(e.x, e.y - 8, { frames: [chips[i % chips.length]], life: rnd(0.5, 0.75), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 20, g: 200, ground: e.y + rnd(-2, 6), fadeOut: 0.3 });
          }
          ctx.bits.spawn(e.x, e.y - 6, { frames: puffSet(6, 'snow', 2), life: 0.6, fadeOut: 0.3 });
          this.sound('hanbing.spike', 0.6);
        } else {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            ctx.bits.spawn(e.x, e.y, { sizes: [1, 3, 4, 3, 1], fps: 12, life: 0.5, vx: Math.cos(a) * e.r * 2, vy: Math.sin(a) * e.r * 1.4, drag: 5, fadeOut: 0.25 });
          }
          ctx.sparks.emit(e.x, e.y - 6, 14, FIRE_SPARKS, [40, 110], [0.25, 0.5], { drag: 3 });
          this.sound('jiulong.burst', 0.5);
        }
        break;
      }
      case 'react': {
        const head = headOf(this.byId.get(e.id)?.kind);
        let y = e.y - head - 4;
        for (const p of this.popups) if (p.t < 0.7 && Math.abs(p.x - e.x) < 26 && Math.abs(p.y - y) < 12) y = p.y - 12;
        const pop = new ReactPopup(ctx, e.kind, e.x, y);
        this.popups.push(pop);
        // 修仙版（xfx.ts，fxpolish）放了的话，原来的火星和一圈火苗 / 熔滴都不放（不叠两层）
        const taken = !!this.reactFx?.(e.kind, e.id, e.x, e.y);
        if (!taken) reactBurst(ctx, e.kind, e.x, e.y - head * 0.5);
        // 导雷：雷光从这只身上再跳出去；引燃 / 熔岩：火、熔浆往四周溅开
        if (e.kind === 'conduct' && e.pts && e.pts.length > 1) this.add(new Bolt(ctx, [[e.x, e.y - 26], ...e.pts], 'azure', { trunk: 2, branches: 0, skyEach: false, whip: false, arcsOnly: true }));
        if (!taken && (e.kind === 'ignite' || e.kind === 'lava') && e.r) reactRing(ctx, e.kind, e.x, e.y, e.r);
        this.sound(`react.${e.kind}`);
        break;
      }
      case 'hit':
        if (e.by === 'knife' && !ctx.impactFx?.('knife', e.x, e.y, 0, 1)) {
          const sl = Ts('slash', () => SLASH);
          ctx.bits.spawn(e.x + rnd(-2, 2), e.y - 10 + rnd(-2, 2), { frames: sl, fps: 14, loop: false, life: 0.24, fadeOut: 0.1 });
          ctx.sparks.emit(e.x, e.y - 10, 4, [C.W, C.f, C.j], [30, 70], [0.15, 0.3], { drag: 3 });
          this.sound('zhanxian.hit', 0.8);
        }
        break;
    }
  }

  private flagOf(owner: number): FlagView {
    let f = this.flags.get(owner);
    if (!f) {
      f = new FlagView(this.ctx);
      this.flags.set(owner, f);
    }
    return f;
  }

  /** 敌人按 id 的索引：每个模拟步（w.tick）最多重建一次（事件很多，不能每个事件都重建）。 */
  private indexEnemies(w: World) {
    if (this.ixTick === w.tick && this.byId.size === w.enemies.length) return;
    this.byId.clear();
    for (const e of w.enemies) this.byId.set(e.id, e);
    this.ixTick = w.tick;
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    this.alpha = alpha;
    const ctx = this.ctx;
    this.ixTick = -1;
    this.indexEnemies(w);
    // 效果对象
    for (let i = this.effects.length - 1; i >= 0; i--)
      if (!this.effects[i].update(dt, ctx, w, alpha)) {
        this.effects[i].destroy();
        this.effects.splice(i, 1);
      }
    for (const [id, s] of this.seals)
      if (!s.update(dt, ctx)) {
        s.destroy();
        this.seals.delete(id);
      }
    for (const [id, f] of this.frosts)
      if (!f.update(dt)) {
        f.destroy();
        this.frosts.delete(id);
      }
    for (const [id, m] of this.tmarks)
      if (!m.update(dt, ctx)) {
        m.destroy();
        this.tmarks.delete(id);
      }
    for (let i = this.popups.length - 1; i >= 0; i--)
      if (!this.popups[i].update(dt)) {
        this.popups[i].destroy();
        this.popups.splice(i, 1);
      }
    // 地面区域
    for (const z of w.zones) if (MY_ZONES.has(z.kind) && !this.zones.has(z.id)) this.zones.set(z.id, new ZoneView(ctx, z));
    for (const [id, v] of this.zones)
      if (!v.update(dt, ctx, w, alpha)) {
        v.destroy();
        this.zones.delete(id);
      }
    // 乾坤圈
    const rseen = new Set<number>();
    for (const r of w.rings) {
      rseen.add(r.id);
      let v = this.rings.get(r.id);
      if (!v) {
        v = new RingView();
        this.rings.set(r.id, v);
      }
      const g = this.gear(w, r.owner, 'qiankun', r.tier);
      v.update(dt, ctx, r.px + (r.x - r.px) * alpha, r.py + (r.y - r.py) * alpha, r.hover > 0, g.tier, r.primary ? g.spirit : null);
    }
    for (const [id, v] of this.rings)
      if (!rseen.has(id)) {
        v.destroy();
        this.rings.delete(id);
      }
    // 斩仙飞刀
    const kseen = new Set<number>();
    for (const k of w.knives) {
      if (k.kind && k.kind !== 'zhanxian') continue; // 五火七禽扇的火鸟也放在 knives 里，不画成飞刀
      kseen.add(k.id);
      const g = this.gear(w, k.owner, 'zhanxian', k.tier);
      let v = this.knives.get(k.id);
      if (!v) {
        v = new KnifeView(ctx, k.id, g.spirit === 'many');
        this.knives.set(k.id, v);
        this.sound('zhanxian.fly', 0.7, 0.08);
        ctx.bits.spawn(k.x, k.y, { frames: Ts('star', () => STAR).slice(1, 3), fps: 12, life: 0.2, fadeOut: 0.1 });
      }
      v.update(dt, ctx, { x: k.px + (k.x - k.px) * alpha, y: k.py + (k.y - k.py) * alpha, vx: k.vx, vy: k.vy }, g.spirit === 'behead');
    }
    for (const [id, v] of this.knives)
      if (!kseen.has(id) && !v.update(dt, ctx, null, false)) {
        v.destroy();
        this.knives.delete(id);
      }
    // 杏黄旗
    for (const p of w.players) {
      const has = p.weapons.some((x) => x.kind === 'xinghuang');
      if (!has && !this.flags.has(p.id)) continue;
      const g = this.gear(w, p.id, 'xinghuang');
      const hx = Math.round(p.px + (p.x - p.px) * alpha);
      const hy = Math.round(p.py + (p.y - p.py) * alpha);
      this.flagOf(p.id).update(dt, ctx, hx, hy, p.facing, p.alive && p.shield > 0, g.tier, g.spirit, p.lotus);
    }
    // 敌人身上的状态
    this.updateStatus(dt, w, alpha);
    this.bits.update(dt);
    this.top.flush();
    this.under.flush();
    this.thrustN.clear();
    this.chainN.clear();
    this.slamN.clear();
    this.chillN = 0;
    this.auraBy.clear();
    this.frame++;
  }

  private dropStatus(s: EnemyFx) {
    s.mark?.destroy();
    s.burn?.destroy();
    s.crust?.destroy();
    s.wound?.destroy();
    s.mark = s.burn = s.crust = s.wound = null;
  }

  private updateStatus(dt: number, w: World, alpha: number) {
    const ctx = this.ctx;
    const marks = WUXING_MARK;
    for (const e of w.enemies) {
      let s = this.status.get(e.id);
      const needs = (e.mark && e.markT > 0) || e.burnT > 0 || e.frozen > 0 || e.bleedT > 0 || s;
      if (!needs) continue;
      if (!s) {
        s = { wound: null, mark: null, markEl: null, markAge: 0, burn: null, burnDx: rnd(-2, 2), crust: null, frozen: false, bleedCd: 0, bleeding: false, flameCd: rnd(0, 0.3), seen: this.frame };
        this.status.set(e.id, s);
      }
      s.seen = this.frame;
      const x = Math.round(e.px + (e.x - e.px) * alpha);
      const y = Math.round(e.py + (e.y - e.py) * alpha);
      const head = headOf(e.kind);
      const big = e.kind === 'elite' || e.kind === 'boss' || e.kind === 'cavalry';
      const tiny = e.kind === 'splitling';
      // 五行印记：头顶一个很小的五行色标记
      if (e.mark && e.markT > 0) {
        if (!s.mark) {
          s.mark = new Sprite();
          s.mark.anchor.set(0.5, 1);
          ctx.layer.addChild(s.mark);
        }
        if (s.markEl !== e.mark) {
          s.markEl = e.mark;
          s.markAge = 0;
        }
        s.markAge += dt;
        // 换成新的一行：先白一帧、从六成弹到原大（0.12 秒），之后上下浮一像素（fxpolish）
        const g = marks[e.mark as Element];
        s.mark.texture = s.markAge < 0.05 ? flashTextureFromGrid(g) : textureFromGrid(g);
        const pop = clamp01(s.markAge / 0.12);
        s.mark.scale.set(Math.round((0.6 + 0.4 * (1 - (1 - pop) * (1 - pop))) * 5) / 5);
        s.mark.position.set(x, y - head - 3 - (Math.floor(this.time * 2.5 + e.id) % 2));
        s.mark.alpha = clamp01(s.markAge / 0.06) * clamp01(e.markT / 0.35);
      } else if (s.mark) {
        s.mark.destroy();
        s.mark = null;
        s.markEl = null;
      }
      // 灼烧：身上一簇小火舌（烧得越旺越大），时不时窜起一朵（xfx.ts 画了修仙版灼烧的就不画）
      if (e.burnT > 0 && !this.skipStatus?.(e.id, 'burn')) {
        if (!s.burn) {
          s.burn = new Sprite();
          s.burn.anchor.set(0.5, 1);
          ctx.stage.entities.addChild(s.burn);
        }
        const sz = big ? 3 : e.burn > 8 ? 2 : 1;
        s.burn.texture = flameSet(sz)[(Math.floor(this.time * 11) + e.id) % 8];
        s.burn.position.set(Math.round(x + s.burnDx), y - (big ? 6 : 2));
        s.burn.zIndex = y + 0.5;
        s.burn.alpha = clamp01(e.burnT / 0.4) * 0.95;
        s.flameCd -= dt;
        if (s.flameCd <= 0) {
          s.flameCd = rnd(0.25, 0.5);
          ctx.bits.spawn(x + rnd(-4, 4), y - rnd(4, big ? 24 : 12), { sizes: [0, 1, 2, 1, 0], fps: 12, life: rnd(0.35, 0.5), vy: -14, fadeOut: 0.2 });
        }
      } else if (s.burn) {
        s.burn.destroy();
        s.burn = null;
      }
      // 冻住：身上一层冰壳（xfx.ts 画了修仙版冻结的就不画冰壳）；化开的那一下碎成冰屑（两种都有）
      if (e.frozen > 0) {
        s.frozen = true;
        if (this.skipStatus?.(e.id, 'frozen')) {
          s.crust?.destroy();
          s.crust = null;
        } else {
          if (!s.crust) {
            s.crust = new Sprite(T(big ? 'crustL' : tiny ? 'crustT' : 'crustS', () => (big ? iceCrust(20, 28) : tiny ? iceCrust(8, 10) : iceCrust(12, 16))));
            s.crust.anchor.set(0.5, 1);
            ctx.stage.entities.addChild(s.crust);
          }
          s.crust.position.set(x, y + 1);
          s.crust.zIndex = y + 0.7;
          s.crust.alpha = e.frozen < 0.3 ? (Math.floor(this.time * 20) % 2 ? 0.4 : 0.85) : 0.85;
          if (Math.random() < 0.02) ctx.bits.spawn(x + rnd(-5, 5), y - rnd(4, head), { frames: Ts('star', () => STAR).slice(0, 2), life: 0.25, fadeOut: 0.12 });
        }
      } else if (s.frozen) {
        s.frozen = false;
        s.crust?.destroy();
        s.crust = null;
        const chips = Ts('chips', () => ICE_CHIPS);
        for (let i = 0; i < 6; i++) ctx.bits.spawn(x + rnd(-5, 5), y - rnd(3, head), { frames: [chips[i % chips.length]], life: rnd(0.4, 0.6), vx: rnd(-35, 35), vy: -rnd(20, 50), g: 260, ground: y + rnd(0, 3), fadeOut: 0.25 });
      }
      // 流血：身上一道血口子，血珠一滴一滴往下掉，落地变成小血点
      if (e.bleedT > 0) {
        if (!s.bleeding) {
          s.bleeding = true;
          this.sound('dot.bleed', 0.6, 0.3);
        }
        if (!s.wound) {
          s.wound = new Sprite();
          s.wound.anchor.set(0.5);
          ctx.stage.entities.addChild(s.wound);
        }
        s.wound.texture = Ts('wound', () => WOUND)[Math.floor(this.time * 3 + e.id) % 2];
        s.wound.position.set(x + (e.id % 2 ? 1 : -1), y - Math.round(head * 0.45));
        s.wound.zIndex = y + 0.6;
        s.wound.alpha = clamp01(e.bleedT / 0.4);
        s.bleedCd -= dt;
        if (s.bleedCd <= 0) {
          s.bleedCd = rnd(0.14, 0.26) * (e.bleed > 6 ? 0.7 : 1);
          const h = rnd(5, head - 6);
          const sx = x + rnd(-3, 3);
          const g = 300;
          const vy0 = 10;
          const tf = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h)) / g;
          const bigDrop = Math.random() < 0.4;
          ctx.bits.spawn(sx, y - h, { frames: [T(bigDrop ? 'bdropB' : 'bdrop', () => (bigDrop ? BLOOD_DROP_BIG : BLOOD_DROP))], life: tf + 0.02, vy: vy0, g, fadeIn: 0.03, fadeOut: 0.02, z: true, zOff: h + 1 });
          ctx.bits.spawn(sx, y + rnd(0, 2), { frames: [T(`bsplat${Math.floor(Math.random() * 3)}`, () => pick(BLOOD_SPLAT))], life: 1.1, delay: tf, layer: ctx.floor, fadeIn: 0.02, fadeOut: 0.6, alpha: 0.9 });
        }
      } else {
        s.bleeding = false;
        if (s.wound) {
          s.wound.destroy();
          s.wound = null;
        }
      }
    }
    for (const [id, s] of this.status)
      if (s.seen !== this.frame) {
        this.dropStatus(s);
        this.status.delete(id);
      }
  }
}
