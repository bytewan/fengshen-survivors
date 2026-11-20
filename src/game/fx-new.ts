// 剩下 8 件公共法宝的画面：打神鞭、化血神刀、定风珠、青莲宝色旗、阴阳镜、玄元控水旗、五火七禽扇、捆仙绳。
// 和 fx.ts 的 WeaponFx 同一个接口（onEvent / update / clear），由 feel.ts 和特效实验页各构造一个、一起喂事件；
// 粒子、笔刷、纹理缓存这些底子直接用 fx.ts 导出的那一套。只读模拟状态（world.zones、world.pending、world.knives、敌人），不回写。
// 精灵在 src/art/sprites/artifacts.ts。
//
// 用户口径（逐条给过的）：
// - 所有的法宝效果都要足够有特色、足够显眼，不要一闪而过；出现和消失都要有过程（淡入淡出、收尾），动画不要太快，可以多做几帧。
// - 每次升阶都要有变化：凡 → 灵是变大变多，仙品是质变的画面，神品的两个器灵各自不同、更华丽。
// - 武器、人物身上不要俗气的光圈，可以稍微加一点点粒子；地面上的东西要有形状（莲瓣、藤蔓、水纹），不是一个圆圈。
//
// 结构：小工具 → 每件法宝的效果对象（一次出手一个，或者跟着一块区域 / 一只火鸟走）→ 对外的 ArtifactFx。
import { Container, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { textureFromGrid } from '../render/textures.ts';
import { pixelTextTexture } from '../render/pixel-text.ts';
import type { Grid } from '../art/pixel.ts';
import { BLOOD_DROP, BLOOD_DROP_BIG, BLOOD_SPLAT, GOLD_PETAL, ICE_CHIPS, ROCKS, SNOWFLAKE, STAR, recolor } from '../art/sprites/fx.ts';
import { wrapLook, type WrapLook } from '../art/sprites/pet.ts';
import {
  azureLotusFrames,
  BLOOD_BLADE,
  BLOOD_BLADE_SEL,
  BLOOD_BLADE_TIP,
  BLOOD_CUT,
  bloodPuffFrames,
  CALM_SEAL,
  FAN,
  FAN_PIVOT,
  FIREBIRD,
  FIREBIRD_PIVOT,
  iceSheetFrames,
  LEAVES,
  LOTUS_BUD,
  LOTUS_MOTE,
  lotusMandala,
  MIRROR,
  PEARL,
  pillarFrames,
  poolBody,
  poolFrames,
  revealed,
  ROPE_DRAGON,
  ROPE_DRAGON_PIVOT,
  ROPE_KNOT,
  ROPE_RING,
  scorchDecal,
  SOUL_WISP,
  SPLASH,
  STEP_LOTUS,
  TAIJI,
  talisman,
  TALISMAN_H,
  thornFrames,
  vineRingFrames,
  vortexFrames,
  waterFlagFrames,
  WFLAG_FOOT,
  WFLAG_H,
  WFLAG_W,
  XIANGYUN_SMALL,
  xiangyunFrames,
} from '../art/sprites/artifacts.ts';
import {
  applyRot,
  Bits,
  Bolt,
  C,
  clamp01,
  type Ctx,
  dirOf,
  easeIn,
  easeInOut,
  easeOut,
  type Effect,
  fade,
  FIRE_SPARKS,
  GOLD_SPARKS,
  headOf,
  ICE_SPARKS,
  pick,
  Pixels,
  polyStreak,
  puffSet,
  Rays,
  rnd,
  rotTex,
  stamp,
  Stroke,
  T,
  Ts,
} from './fx.ts';
import type { Enemy, SimEvent, WeaponKind, Zone, ZoneKind } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { REACH } from '../sim/config.ts';
import { loadFx, PixelFxLayer, prebake, type Baked, type FxHandle } from '../render/pixelfx.ts';
import { XFX } from '../render/pixelfx-xianxia.ts';
import type { FxModule } from '../../vendor/pixelfx/src/core/index.js';

const TAU = Math.PI * 2;
type Cols = [number, number, number, number];
type Gear = { tier: number; spirit: string | null };
type Ev<K extends SimEvent['t']> = Extract<SimEvent, { t: K }>;

const BLOOD_SPARKS = [C.e, C.r, C.o, C.R];
const WIND_SPARKS = [C.W, C.w, C.L, C.j];
const WATER_SPARKS = [C.W, C.Cc, C.c, C.w];
const LOTUS_SPARKS = [C.W, C.L, C.Cc, C.w];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 角度插值（走近的那一边）。 */
const lerpAng = (a: number, b: number, k: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
};

/** 沿一条折线每隔 step 像素取一个点：位置、法线、走过的路程。 */
function walk(pts: [number, number][], step: number, fn: (x: number, y: number, nx: number, ny: number, s: number, total: number) => void) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  let s0 = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l < 1e-6) continue;
    const ux = (x1 - x0) / l;
    const uy = (y1 - y0) / l;
    for (let s = (step - (s0 % step)) % step; s <= l; s += step) fn(x0 + ux * s, y0 + uy * s, -uy, ux, s0 + s, total);
    s0 += l;
  }
  return total;
}

/**
 * 一根有粗细、有受光面的棍（鞭身、金绳）：沿折线每像素取一截横断面，按到中线的距离分四档颜色：
 * 受光的一侧亮（cols[0]）、身子（cols[1]）、背光的一侧暗（cols[2]）、最外一像素深边（cols[3]）。
 * w(s, total) 给出这一截的半宽，a(s, total) 给出透明度。
 */
function rod(st: Pick<Stroke, 'dot'>, pts: [number, number][], w: (s: number, total: number) => number, a: (s: number, total: number) => number, cols: Cols) {
  walk(pts, 0.7, (x, y, nx, ny, s, total) => {
    const hw = w(s, total);
    const al = a(s, total);
    if (al <= 0.02 || hw <= 0.1) return;
    for (let o = -hw - 0.6; o <= hw + 0.6; o += 0.5) {
      const d = o / Math.max(0.4, hw);
      const [c, p] = Math.abs(o) > hw - 0.05 ? [cols[3], 1] : d < -0.35 ? [cols[0], 4] : d < 0.4 ? [cols[1], 3] : [cols[2], 2];
      st.dot(x + nx * o, y + ny * o, c, al, p);
    }
  });
}

/** 一段椭圆弧（中心 (x, y)，半径 rx / ry，从 a0 到 a1），沿弧每像素一个点。 */
function arc(px: Pixels, x: number, y: number, rx: number, ry: number, a0: number, a1: number, color: number | ((a: number) => number), alpha: number | ((a: number) => number)) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) * 1.2));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const al = typeof alpha === 'number' ? alpha : alpha(a);
    if (al <= 0.02) continue;
    px.dot(x + Math.cos(a) * rx, y + Math.sin(a) * ry, typeof color === 'number' ? color : color(a), al);
  }
}

/** 一个跟着点走的精灵（纸符、太极、绳结……）：淡入淡出、到时收掉。 */
class Tag implements Effect {
  t = 0;
  private s: Sprite;
  private extra: Sprite[] = [];
  private where: () => [number, number] | null;
  private life: number;
  private fi: number;
  private fo: number;
  private bob: number;
  private rise: number;
  constructor(ctx: Ctx, tex: Texture, where: () => [number, number] | null, life: number, fi: number, fo: number, bob = 0, layer?: Container, over?: Texture, rise = 0) {
    this.where = where;
    this.life = life;
    this.fi = fi;
    this.fo = fo;
    this.bob = bob;
    this.rise = rise;
    this.s = new Sprite(tex);
    this.s.anchor.set(0.5);
    this.s.alpha = 0;
    (layer ?? ctx.layer).addChild(this.s);
    if (over) {
      const o = new Sprite(over);
      o.anchor.set(0.5);
      o.alpha = 0;
      (layer ?? ctx.layer).addChild(o);
      this.extra.push(o);
    }
  }
  private last: [number, number] = [0, 0];
  update(dt: number): boolean {
    this.t += dt;
    const p = this.where();
    if (p) this.last = p;
    const a = fade(this.t, this.life, this.fi, this.fo);
    const x = Math.round(this.last[0] + (this.bob ? Math.sin(this.t * 7) * this.bob : 0));
    const y = Math.round(this.last[1] - this.rise * easeOut(this.t / this.life));
    for (const s of [this.s, ...this.extra]) {
      s.position.set(x, y);
      s.alpha = a;
    }
    return this.t < this.life;
  }
  destroy() {
    this.s.destroy();
    for (const s of this.extra) s.destroy();
  }
}

/** 一颗往人身上飞的小东西（血魂、灵光）：二次贝塞尔，起点固定、终点跟着人走，后面拖两粒淡下去的余光。 */
class Homing implements Effect {
  private t: number;
  private s = new Sprite();
  private c: [number, number];
  private trail: [number, number][] = [];
  private frames: Texture[];
  private x0: number;
  private y0: number;
  private to: () => [number, number];
  private dur: number;
  private trailCol: number;
  private onArrive?: (x: number, y: number) => void;
  constructor(ctx: Ctx, frames: Texture[], x0: number, y0: number, to: () => [number, number], dur: number, delay: number, trailCol: number, onArrive?: (x: number, y: number) => void) {
    this.frames = frames;
    this.x0 = x0;
    this.y0 = y0;
    this.to = to;
    this.dur = dur;
    this.trailCol = trailCol;
    this.onArrive = onArrive;
    this.t = -delay;
    const [tx, ty] = to();
    const d = dirOf(x0, y0, tx, ty);
    const bend = rnd(-0.5, 0.5) * Math.min(40, d.len);
    this.c = [(x0 + tx) / 2 + d.nx * bend, (y0 + ty) / 2 + d.ny * bend - rnd(6, 16)];
    this.s.anchor.set(0.5);
    this.s.visible = false;
    ctx.layer.addChild(this.s);
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    if (this.t < 0) return true;
    const k = easeInOut(this.t / this.dur);
    const [tx, ty] = this.to();
    const x = (1 - k) ** 2 * this.x0 + 2 * k * (1 - k) * this.c[0] + k * k * tx;
    const y = (1 - k) ** 2 * this.y0 + 2 * k * (1 - k) * this.c[1] + k * k * ty;
    this.trail.unshift([x, y]);
    if (this.trail.length > 7) this.trail.pop();
    this.s.texture = this.frames[Math.floor(this.t * 12) % this.frames.length];
    this.s.position.set(Math.round(x), Math.round(y));
    this.s.alpha = fade(this.t, this.dur, 0.08, 0.12);
    this.s.visible = true;
    for (let i = 1; i < this.trail.length; i++) {
      ctx.top.dot(this.trail[i][0], this.trail[i][1], this.trailCol, 0.7 - i * 0.09);
      if (i < 4) ctx.top.dot(this.trail[i][0], this.trail[i][1] + 1, this.trailCol, 0.4 - i * 0.08);
    }
    if (this.t >= this.dur) {
      this.onArrive?.(tx, ty);
      return false;
    }
    return true;
  }
  destroy() {
    this.s.destroy();
  }
}

// ================================================================ 打神鞭

/**
 * 鞭身配色 [受光, 身, 背光, 深边]。浅色的仙台上也要压得住：身子用藤黄、背光琥珀、描赭边。
 * 仙品「打神」起鞭身更亮（缃黄身、灵光受光），封神是白金鞭。
 */
const WHIP_GOLD: Cols = [C.Y, C.y, C.b, C.B];
const WHIP_HOLY: Cols = [C.f, C.Y, C.y, C.B];
const WHIP_SEAL: Cols = [C.W, C.w, C.j, C.B];

interface LashInfo {
  id: number;
  target: number;
  tier: number;
  spirit: string | null;
  seq: number;
  t2: number; // 预警时离落鞭还有多久
  len: number;
  ring: number;
}

/** 一鞭：什么时候落（从这条鞭子出现算起）、鞭痕偏多少（九节三鞭交叉）、落了没有。 */
interface Strike {
  id: number;
  t2: number;
  side: number;
  done: boolean;
}

/** 地上的一道鞭痕：落点、方向、画哪一段（[s0, s1]，见 lashSpan）。 */
interface Mark {
  x: number;
  y: number;
  va: number;
  t: number;
  s0: number;
  s1: number;
  seed: number;
}

/** 鞭子落定时的样子：从云里的鞭根起，等长的 WHIP_N 节，先垂下来、再贴着地面躺在鞭痕上（P0 → P1）。 */
interface LashGeo {
  ang: number[]; // 每一节落定时的方向
  seg: number; // 每节多长
  total: number;
  sgn: number; // 抽下来时转的方向：鞭子往右躺就顺时针转（从身后越过头顶抽下来），往左躺就逆时针
  P0: [number, number];
  P1: [number, number];
}

const WHIP_N = 14;
/**
 * 鞭子（连鞭痕）离人物脚下最远画到这里。模拟里的鞭痕以落点为中心、两头各 len/2：落点在索敌半径边上时，外面那一头
 * 会伸到 REACH.max（效果最远 145）外十几像素（用户 2026-11-10：法宝、特效不能画得过大）。画面截在这里，判定照旧。
 */
const LASH_CAP = REACH.max - 4;

/** 鞭痕上从落点量起画哪一段 [s0, s1]（沿方向 (ux, uy)）：模拟里是 ±L；离人物脚下超过 LASH_CAP 的那一截不画。 */
function lashSpan(x: number, y: number, ux: number, uy: number, L: number, hero: [number, number] | null): [number, number] {
  if (!hero) return [-L, L];
  const cx = x - hero[0];
  const cy = y - hero[1];
  const b = ux * cx + uy * cy;
  const D = b * b - (cx * cx + cy * cy) + LASH_CAP * LASH_CAP;
  if (D <= 0) return [-L, L];
  const r = Math.sqrt(D);
  const s0 = Math.max(-L, -b - r);
  const s1 = Math.min(L, -b + r);
  return s1 - s0 >= L * 0.5 ? [s0, s1] : [-L, L];
}

/**
 * 鞭痕的两头：P0 是鞭子先落地的那一头 —— 竖着的鞭痕是上面那头（从上往下躺），横着的是靠人物的那头（往外躺）。
 * hero：人物脚下（给了就按 LASH_CAP 截掉太远的那一截）。
 */
function lashEnds(x: number, y: number, a: number, len: number, side: number, hero: [number, number] | null = null) {
  const va = a + side;
  let ux = Math.cos(va);
  let uy = Math.sin(va);
  const [s0, s1] = lashSpan(x, y, ux, uy, len / 2, hero);
  let P0: [number, number] = [x + ux * s0, y + uy * s0];
  let P1: [number, number] = [x + ux * s1, y + uy * s1];
  if (Math.abs(uy) > 0.45 && P1[1] < P0[1]) {
    [P0, P1] = [P1, P0];
    ux = -ux;
    uy = -uy;
  }
  return { P0, P1, ux, uy };
}

/**
 * 鞭根所在的祥云：先落地那一头的上方 sky 像素，往鞭子来的那一边（身后）偏一点。
 * 按先落地那一头量（原来按两头里画面上更高的那头：鞭痕往右上斜时，云离它下面的地有四十多像素）。
 * 目标就在人物脚下附近时，云会正好压在人物身上：那就往旁边推开，离人物的身子至少 CLEAR 像素（鞭子斜着垂下来）。
 */
function lashRoot(x: number, y: number, a: number, len: number, side: number, sky: number, hero: [number, number] | null): [number, number] {
  const { P0, ux } = lashEnds(x, y, a, len, side, hero);
  const sgn = ux >= 0 ? 1 : -1;
  const A: [number, number] = [P0[0] - sgn * (9 + 7 * (1 - Math.abs(ux))), P0[1] - sky];
  if (hero) {
    const CLEAR = 36;
    const hx = hero[0];
    const hy = hero[1] - 14;
    const dy = A[1] - hy;
    if (Math.hypot(A[0] - hx, dy) < CLEAR) {
      const s = A[0] - hx >= 0.5 ? 1 : A[0] - hx <= -0.5 ? -1 : -sgn;
      A[0] = hx + s * (Math.sqrt(Math.max(0, CLEAR * CLEAR - dy * dy)) + 2);
    }
  }
  return A;
}

/** 落定的骨架：鞭根 A 往下垂（三次贝塞尔：先往下、再顺着鞭痕的方向落地），然后贴着地面 P0 → P1；按弧长等分成 WHIP_N 节。 */
function lashGeo(A: [number, number], x: number, y: number, a: number, len: number, side: number, hero: [number, number] | null): LashGeo {
  const { P0, P1, ux, uy } = lashEnds(x, y, a, len, side, hero);
  const sgn = ux >= 0 ? 1 : -1;
  const drop = Math.max(18, P0[1] - A[1]);
  const c1: [number, number] = [A[0] + sgn * 2, A[1] + drop * 0.55];
  const c2: [number, number] = [P0[0] - ux * drop * 0.5, P0[1] - uy * drop * 0.5];
  const raw: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const m = 1 - u;
    const b = [m * m * m, 3 * m * m * u, 3 * m * u * u, u * u * u];
    raw.push([b[0] * A[0] + b[1] * c1[0] + b[2] * c2[0] + b[3] * P0[0], b[0] * A[1] + b[1] * c1[1] + b[2] * c2[1] + b[3] * P0[1]]);
  }
  for (let i = 1; i <= 8; i++) raw.push([lerp(P0[0], P1[0], i / 8), lerp(P0[1], P1[1], i / 8)]);
  const acc = [0];
  for (let i = 1; i < raw.length; i++) acc.push(acc[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = acc[acc.length - 1];
  const at = (s: number): [number, number] => {
    let j = 1;
    while (j < acc.length - 1 && acc[j] < s) j++;
    const u = (s - acc[j - 1]) / Math.max(1e-6, acc[j] - acc[j - 1]);
    return [lerp(raw[j - 1][0], raw[j][0], u), lerp(raw[j - 1][1], raw[j][1], u)];
  };
  const pts = Array.from({ length: WHIP_N + 1 }, (_, i) => at((i / WHIP_N) * total));
  const ang = Array.from({ length: WHIP_N }, (_, i) => Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]));
  return { ang, seg: total / WHIP_N, total, sgn, P0, P1 };
}

/**
 * 鞭子此刻的骨架：g = 0 是扬在身后（鞭根朝上、往后仰，越往鞭梢仰得越多），g = 1 是落定。第 i 节的方向从扬起的方向
 * 顺着抽下来的方向（鞭子往右躺就顺时针）转到落定的方向，每一节都朝同一个方向转，所以抽下来是一道越过头顶的干净弧线，不会绕圈。
 * wob：落地后鞭身贴着地面抖。
 */
function lashPose(A: [number, number], geo: LashGeo, g: (i: number) => number, wob: number, t: number): [number, number][] {
  const out: [number, number][] = [A];
  let [x, y] = A;
  for (let i = 0; i < WHIP_N; i++) {
    const k = i / (WHIP_N - 1);
    const up = -Math.PI / 2 - geo.sgn * (0.55 + 0.85 * k); // 往身后仰：探出云的那一截不竖得老高
    const delta = (((geo.sgn * (geo.ang[i] - up)) % TAU) + TAU) % TAU;
    const ang = geo.ang[i] - geo.sgn * delta * (1 - g(i)) + wob * Math.sin(i * 1.7 + t * 48) * k;
    x += Math.cos(ang) * geo.seg;
    y += Math.sin(ang) * geo.seg;
    out.push([x, y]);
  }
  return out;
}

/** 沿折线从起点量到 s 处截断（鞭子从云里只伸出来这么长）。 */
function truncate(pts: [number, number][], s: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + l >= s) {
      const u = (s - acc) / Math.max(1e-6, l);
      out.push([lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]);
      return out;
    }
    acc += l;
    out.push(pts[i]);
  }
  return out;
}

/**
 * 打神鞭：落点的上空先聚起一朵祥云，一条金色的竹节鞭从云里伸出来、扬在身后，落鞭前最后一下越过头顶猛地抽下来
 * （鞭梢最后到，身后拖两三道鞭影），整条鞭子砸在目标身上、贴着地面抖一下，再慢慢收回云里，云随后散去。
 * 落点金光四射、崩起尘土和碎石，地上留下一串竹节印成的鞭痕，先烫成金色、再慢慢暗成焦痕。
 * 灵品一次两鞭（两朵云）。仙品「打神」云和鞭都变成金色，鞭上的符印抽下来时一节一节亮起，落点再震出一圈尘浪；
 * 镇住的精英身上贴一张「镇」字符。神品「封神」是白金鞭、朱砂卷纹的云，鞭节上缠着符纸，被抽散的敌人化成一张「封」字符飞上天；
 * 「九节」是九节鞭（节是一个个金环），同一条鞭子连抽三下：抽中、弹起、从另一侧再抽，第三鞭最重，地上三道鞭痕交叉。
 */
class LashView implements Effect {
  private t = 0; // 从这条鞭子出现（第一个预警）算起
  private info: LashInfo;
  private x: number; // 鞭痕中心（落鞭之前跟着目标走）
  private y: number;
  private a: number; // 「人物 → 目标」的方向（落鞭时以模拟为准）
  private len: number;
  private stroke = new Stroke();
  private ghosts: [number, number][][] = [];
  private ghostCd = 0;
  private cloud = new Sprite();
  private cloudFr: Texture[];
  private A: [number, number] | null = null; // 鞭根（第一鞭落下后就定住，云不再动）
  private nine: boolean;
  private seal: boolean;
  private holy: boolean;
  private strikes: Strike[] = [];
  private marks: Mark[] = [];
  private from: () => [number, number] | null;
  private hero0: [number, number] | null = null; // 第一鞭落下时人物脚下（之后鞭子、鞭痕按它截长，人走开了也不变）
  private gathered = false;
  private dispersed = false;
  constructor(ctx: Ctx, info: LashInfo, x: number, y: number, from: () => [number, number] | null) {
    this.from = from;
    this.info = info;
    this.x = x;
    this.y = y;
    const [px, py] = from() ?? [x - 1, y];
    this.a = Math.atan2(y - py, x - px);
    this.len = info.len;
    this.nine = info.spirit === 'nine';
    this.seal = info.spirit === 'seal';
    this.holy = info.tier >= 3;
    const tone = this.seal ? 'seal' : this.holy ? 'gold' : 'white';
    this.cloudFr = Ts(`xiangyun-${tone}-s`, () => xiangyunFrames(tone, 4, XIANGYUN_SMALL)); // 28×12（原来 36×15，比两个人还宽）
    this.cloud.texture = this.cloudFr[0];
    this.cloud.anchor.set(0.5, 0.62);
    this.cloud.alpha = 0;
    ctx.layer.addChild(this.cloud);
    this.addStrike(info.id, info.t2, info.seq);
  }
  /** 同一只身上再记一鞭：九节从左、右、正中轮流抽下（鞭痕交叉）；灵品身边只有一只时第二鞭也抽它，从另一侧抽。 */
  addStrike(id: number, t2: number, seq: number) {
    const n = this.strikes.length;
    const side = this.nine ? ([0, 0, 0.3, -0.3][seq] ?? 0) : n === 0 ? rnd(-0.06, 0.06) : n % 2 ? 0.34 : -0.34;
    this.strikes.push({ id, t2: this.t + t2, side, done: false });
    this.strikes.sort((p, q) => p.t2 - q.t2);
  }
  has(id: number) {
    return this.strikes.some((s) => s.id === id);
  }
  get target() {
    return this.info.target;
  }
  /** 还有没落下的鞭（灵品的第二鞭可以并进来）。 */
  get pending() {
    return this.strikes.some((s) => !s.done);
  }
  /**
   * 云（鞭根）离地多高：法宝别画得比人大太多 —— 连落鞭前探出云的那一截和穗子，凡 / 灵品离地不过约 30 像素，仙 / 神品不过约 34
   * （人物 24 高；竖着往上的东西不过约 1.5 个人）。原来 22 / 26，探出的鞭梢加穗子到离地四十五像素上下。
   */
  private get sky() {
    return this.nine || this.holy ? 21 : 18;
  }
  /** 跟着目标走（第一鞭落下之前）。 */
  track(x: number, y: number) {
    if (this.A) return;
    this.x = x;
    this.y = y;
    const p = this.from();
    if (p) this.a = Math.atan2(y - p[1], x - p[0]);
  }
  /** 截鞭长按的人物位置：落鞭之后用落鞭时的（鞭痕留在地上，人走开了也不变），之前跟着人。 */
  private heroRef(): [number, number] | null {
    return this.hero0 ?? this.from();
  }
  private root(side: number): [number, number] {
    return this.A ?? lashRoot(this.x, this.y, this.a, this.len, side, this.sky, this.heroRef());
  }
  /** 抽中：位置、方向、长度以模拟为准。 */
  strike(ctx: ACtx, e: Ev<'lash'>) {
    const st = this.strikes.find((s) => s.id === e.id);
    if (!st || st.done) return;
    this.x = e.x;
    this.y = e.y;
    this.a = e.a;
    this.len = e.len;
    this.hero0 ??= this.from();
    if (!this.A) this.A = lashRoot(e.x, e.y, e.a, e.len, st.side, this.sky, this.hero0);
    st.done = true;
    st.t2 = this.t; // 以真正落下的时刻为准
    const tier = this.info.tier;
    const va = e.a + st.side;
    const ux = Math.cos(va);
    const uy = Math.sin(va);
    const [s0, s1] = lashSpan(e.x, e.y, ux, uy, e.len / 2, this.hero0);
    const last = this.strikes.indexOf(st) === this.strikes.length - 1;
    const big = this.holy || (this.nine && last);
    const hd = headOf(ctx.enemy(e.target)?.kind);
    const bx = e.x;
    const by = e.y - hd * 0.45;
    // 落点：一颗星芒、一圈金光往外射、金星四溅。都收在被抽中的那只身上（金光最长约 12–17 像素，原来 20–31；金星溅出二十来像素就落下）
    const star = Ts('star', () => STAR);
    ctx.bits.spawn(bx, by, { frames: [star[1], star[2], star[3], star[3], star[2], star[1]], fps: 16, loop: false, life: 0.38, fadeOut: 0.14 });
    ctx.add(new Rays(bx, by, big ? 14 : tier >= 2 ? 12 : 10, big ? 12 : 9, this.seal ? [C.W, C.w, C.Y, C.b] : [C.W, C.f, C.Y, C.b]));
    ctx.sparks.emit(bx, by, big ? 20 : 13, this.seal ? [C.W, C.f, C.w] : GOLD_SPARKS, [30, 85], [0.35, 0.65], { drag: 3.5, g: 140 });
    ctx.glows.emit(bx, by, big ? 10 : 6, [C.f, C.Y], [8, 26], [0.4, 0.75], { up: 10, drag: 2 });
    // 尘土沿鞭痕往两边崩开（不出鞭痕两侧十来像素），碎石崩起一点再落在鞭痕上
    const n = big ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const s = lerp(s0, s1, i / (n - 1)) * 0.95;
      const sd = i % 2 ? 1 : -1;
      const sp = rnd(14, 26);
      ctx.bits.spawn(e.x + ux * s, e.y + uy * s, { frames: puffSet(pick([4, 5]), i % 3 ? 'stone' : 'gold', 1 + (i % 3)), life: rnd(0.6, 0.85), vx: -uy * sd * sp + ux * rnd(-4, 4), vy: ux * sd * sp * 0.6 - 4, drag: 3, fadeIn: 0.02, fadeOut: 0.35, z: true, zOff: 2, alpha: 0.95 });
    }
    for (let i = 0; i < (big ? 8 : 5); i++) {
      const s = lerp(s0, s1, rnd(0.1, 0.9));
      ctx.bits.spawn(e.x + ux * s, e.y + uy * s, { frames: [Ts('rocks', () => ROCKS)[i % ROCKS.length]], life: rnd(0.6, 0.8), vx: rnd(-16, 16), vy: -rnd(55, 95), g: 320, ground: e.y + uy * s + rnd(-2, 3), bounce: 0.3, fadeOut: 0.25 });
    }
    this.marks.push({ x: e.x, y: e.y, va, t: 0, s0, s1, seed: Math.floor(rnd(0, 997)) });
    ctx.shake.add(this.nine && last ? 0.2 : big ? 0.15 : tier >= 2 ? 0.11 : 0.09);
    ctx.sound('dashen.lash', this.nine && !last ? 0.75 : 1);
    // 仙品「打神」：落点再震出一圈 —— 尘浪往外推、碎石崩起、地上一圈断开的波纹
    if (e.ring > 0 && (!this.nine || last || st === this.strikes[0])) {
      ctx.add(new DustRing(ctx, e.x, e.y, e.ring, this.nine && last));
      ctx.sound('dashen.shock', 0.8, 0.1);
    }
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const t = this.t;
    const S = this.strikes;
    const SWING = 0.13; // 抽下来要多久（鞭梢最后到）
    const HOLD = 0.24; // 落地后贴着地面停多久
    const RET = 0.45; // 收回云里
    const LIFT = 0.22; // 九节两鞭之间弹起到哪儿（差不多扬回身后，再从另一侧抽下来）
    const RAISE = 0.13; // 落鞭前从云里探出多少（占整条的比例）
    const REARM = 0.12; // 九节两鞭之间收回到多少（只留一小截在云外）
    const first = S[0];
    const lastS = S[S.length - 1];
    // 现在在哪一鞭：最后一个已经落下的
    let i = -1;
    for (let j = 0; j < S.length; j++) if (S[j].done || t >= S[j].t2 + 0.06) i = j;
    let g: (k: number) => number = () => 0;
    let vis = 0; // 伸出云的长度（0..1）
    let wob = 0;
    let side = first.side;
    let swinging = false;
    let alpha = 1;
    const lag = (u: number, from = 0) => (k: number) => lerp(from, 1, easeIn(clamp01((u - (0.42 * k) / (WHIP_N - 1)) / 0.58)));
    if (i < 0) {
      // 扬起：鞭梢从云里探出一小截，扬在身后轻轻晃；落鞭前 SWING 秒抽下来 —— 边转边从云里放出来（先转后放，鞭子不会竖得老高）
      const appear = clamp01(t / 0.12);
      const s0 = first.t2 - SWING;
      if (t < s0) {
        const sway = 0.06 * Math.sin(t * 11);
        g = () => sway;
        vis = RAISE * easeOut(appear);
      } else {
        const u = (t - s0) / SWING;
        g = lag(u);
        vis = lerp(RAISE * appear, 1, easeIn(u));
        swinging = true;
      }
      alpha = appear;
    } else if (i < S.length - 1) {
      // 九节 / 第二鞭：抽中 → 停一下 → 整条弹起一半（转向下一鞭那一侧）→ 再猛地抽下
      const h = t - S[i].t2;
      const nx = S[i + 1];
      vis = 1;
      if (h < 0.06) {
        g = () => 1;
        side = S[i].side;
        wob = 0.07 * (1 - h / 0.06);
      } else if (t < nx.t2 - SWING) {
        // 弹起时鞭子同时往云里收回大半（整条竖起来会比人高出好几倍）
        const r = easeOut(clamp01((h - 0.06) / 0.1));
        g = () => 1 - (1 - LIFT) * r;
        vis = 1 - (1 - REARM) * r;
        side = lerp(S[i].side, nx.side, r);
      } else {
        const u = (t - (nx.t2 - SWING)) / SWING;
        g = lag(u, LIFT);
        vis = lerp(REARM, 1, easeIn(u));
        side = nx.side;
        swinging = true;
      }
    } else {
      // 最后一鞭：贴着地面抖一下，再整条提起一点、收回云里
      const h = t - S[i].t2;
      side = S[i].side;
      if (h < HOLD) {
        g = () => 1;
        vis = 1;
        wob = 0.07 * (1 - h / HOLD) ** 2;
      } else {
        const r = clamp01((h - HOLD) / RET);
        // 收回云里：鞭梢顺着来路往回缩（竹节一节一节缩进云里），躺在地上的那一截先微微离地
        g = () => 1 - 0.1 * easeOut(r);
        vis = 1 - easeInOut(r);
      }
    }
    const done = i === S.length - 1 && t - lastS.t2 > HOLD + RET;
    // 祥云：先聚起来（几团云气往里收），鞭子收回去之后再散开
    const A = this.root(side);
    const cloudIn = clamp01(t / 0.16);
    const endT = lastS.done ? lastS.t2 + HOLD + RET : Infinity;
    const cloudOut = clamp01((t - endT - 0.08) / 0.42);
    if (!this.gathered) {
      this.gathered = true;
      const tone = this.seal || !this.holy ? 'snow' : 'gold';
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * TAU + rnd(-0.3, 0.3);
        const d = rnd(10, 15);
        ctx.bits.spawn(A[0] + Math.cos(ang) * d, A[1] + Math.sin(ang) * d * 0.45, { frames: puffSet(pick([4, 5]), tone, 1 + (k % 3)), life: rnd(0.32, 0.42), vx: -Math.cos(ang) * d * 2.4, vy: -Math.sin(ang) * d * 1.1, drag: 2, fadeIn: 0.08, fadeOut: 0.16, alpha: 0.75 });
      }
    }
    if (cloudOut > 0 && !this.dispersed) {
      this.dispersed = true;
      const tone = this.seal || !this.holy ? 'snow' : 'gold';
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * TAU + rnd(-0.2, 0.2);
        ctx.bits.spawn(A[0] + Math.cos(ang) * 8, A[1] + Math.sin(ang) * 3, { frames: puffSet(pick([4, 5, 6]), tone, 1 + (k % 3)), life: rnd(0.55, 0.75), vx: Math.cos(ang) * rnd(16, 26), vy: Math.sin(ang) * 6 - rnd(3, 8), drag: 1.6, fadeIn: 0.03, fadeOut: 0.4, alpha: 0.7 });
      }
    }
    this.cloud.texture = this.cloudFr[Math.floor(t * 5) % this.cloudFr.length];
    this.cloud.position.set(Math.round(A[0]), Math.round(A[1] - 2 - 5 * easeIn(cloudOut)));
    this.cloud.alpha = cloudIn * (1 - cloudOut);
    // 鞭子
    if (!done && vis > 0.02) {
      const geo = lashGeo(A, this.x, this.y, this.a, this.len, side, this.heroRef());
      const shown = truncate(lashPose(A, geo, g, wob, t), geo.total * vis);
      // 扬起、抽下来的那一下鞭梢会甩过云顶：云上面那一截按比例压扁，鞭梢最高到云根上方 WHIP_UP（加上穗子，凡 / 灵离地约 33、仙 / 神约 36）
      const WHIP_UP = 11;
      let top = A[1];
      for (const p of shown) top = Math.min(top, p[1]);
      if (A[1] - top > WHIP_UP) {
        const k = WHIP_UP / (A[1] - top);
        for (const p of shown) if (p[1] < A[1]) p[1] = A[1] - (A[1] - p[1]) * k;
      }
      // 鞭影：抽下来的那一下，身后留两三道淡的
      this.ghostCd -= dt;
      if (swinging && this.ghostCd <= 0) {
        this.ghostCd = 0.022;
        this.ghosts.unshift(shown);
        if (this.ghosts.length > 3) this.ghosts.pop();
      }
      if (!swinging && this.ghosts.length) this.ghosts.pop();
      const gc: Cols = this.seal ? [C.W, C.w, C.w, C.j] : [C.f, C.Y, C.Y, C.y];
      this.ghosts.forEach((gh, gi) => rod(this.stroke, gh, (s, tot) => 1.7 - 0.7 * (s / tot), (s, tot) => (0.38 - gi * 0.11) * alpha * clamp01(s / (tot * 0.2)), gc));
      if (this.ghosts.length) this.stroke.commit(ctx.top);
      this.drawWhip(ctx, shown, geo.total * vis, geo.total, alpha, swinging ? (t - (S.find((s) => !s.done)?.t2 ?? t) + SWING) / SWING : -1);
      // 落鞭之前：鞭子的影子投在地上，越抽越近越浓（预告落点）
      const next = S.find((s) => !s.done);
      if (next) {
        const k = clamp01(1 - (next.t2 - t) / 0.3);
        if (k > 0) {
          const { P0, P1 } = lashEnds(this.x, this.y, this.a, this.len, next.side, this.heroRef());
          const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
          for (let s = 0; s <= L; s += 1) {
            if ((s | 0) % 3 === 2) continue;
            const e = Math.sin((Math.PI * s) / L);
            ctx.under.dot(lerp(P0[0], P1[0], s / L), lerp(P0[1], P1[1], s / L) + 1, C.k, 0.32 * k * e * alpha);
          }
        }
      }
    }
    // 鞭痕：一串竹节印，先烫成金色，再慢慢暗成焦痕淡掉
    let marking = false;
    for (const m of this.marks) {
      m.t += dt;
      const life = 1.9;
      if (m.t > life) continue;
      marking = true;
      this.drawMark(ctx, m, life);
    }
    return !done || marking || this.cloud.alpha > 0.01;
  }
  /**
   * 鞭身：由粗到细的一根（受光一侧亮、背光一侧暗、外缘一像素深边），每隔七像素一道竹节（深色节、节上一点亮），
   * 两节之间一点朱砂符印；鞭梢一缕朱红穗子。九节鞭的节是一个个金环。lit：仙品起抽下来时符印一节一节亮起（0..1 是亮到哪儿）。
   */
  private drawWhip(ctx: Ctx, pts: [number, number][], shownLen: number, fullLen: number, a: number, lit: number) {
    if (pts.length < 2 || shownLen < 2) return;
    const cols = this.seal ? WHIP_SEAL : this.holy ? WHIP_HOLY : WHIP_GOLD;
    const st = this.stroke;
    const tier = this.info.tier;
    const w0 = tier >= 3 ? 3 : tier >= 2 ? 2.7 : 2.4;
    const wTip = 1.05;
    // 粗细按到鞭梢的距离算（伸出一半时，伸出来的是细的那一半）；鞭根那一截藏在云里，从透明渐显
    const width = (s: number) => wTip + (w0 - wTip) * clamp01((shownLen - s) / fullLen);
    const alpha = (s: number) => a * clamp01((s - 2) / 6);
    const SEC = 7; // 一节多长
    walk(pts, 0.6, (x, y, nx, ny, s) => {
      const al = alpha(s);
      if (al <= 0.02) return;
      const fromTip = shownLen - s;
      const hw = width(s);
      // 在这一节里的位置（从鞭梢往回量：收回云里时节一节一节缩进去）；九节鞭的节是金环，节与节之间是细一点的链杆
      const m = ((fromTip % SEC) + SEC) % SEC;
      const node = m < 1.1 && fromTip > 2.5;
      const w = this.nine && !node ? hw * 0.72 : node ? hw + 0.5 : hw;
      for (let o = -w - 0.5; o <= w + 0.5; o += 0.5) {
        const d = o / Math.max(0.4, w);
        let c: number;
        let p: number;
        if (Math.abs(o) > w - 0.05) [c, p] = [cols[3], 1];
        // 竹节：一道深色的节环（受光一侧留一点亮），在浅色的仙台上也看得清一节一节
        else if (node) [c, p] = this.nine ? [d < -0.3 ? C.W : d < 0.35 ? C.Y : C.b, 5] : [d < -0.45 ? cols[0] : cols[3], 5];
        else {
          // 每一节中间鼓、两头收暗：受光一侧亮
          const mid = Math.sin((Math.PI * (m - 1.1)) / (SEC - 1.1));
          [c, p] = d < -0.35 ? [mid > 0.35 ? cols[0] : cols[1], 4] : d < 0.4 ? [cols[1], 3] : [cols[2], 2];
        }
        st.dot(x + nx * o, y + ny * o, c, al, p);
      }
      // 符印：两节之间、鞭身正中一点朱砂；仙品起抽下来时从鞭根到鞭梢一节一节亮起
      if (!this.nine && Math.abs(m - 4) < 0.3 && fromTip > 3) {
        const glow = lit >= 0 && Math.abs(1 - fromTip / fullLen - lit) < 0.2;
        st.dot(x, y, glow ? C.W : C.e, al, 6);
        if (this.holy) st.dot(x + nx * 0.6, y + ny * 0.6, glow ? C.f : C.r, al, 6);
      }
    });
    // 鞭梢：一缕朱红的穗子，随鞭子甩
    const [tx, ty] = pts[pts.length - 1];
    const [bx, by] = pts[Math.max(0, pts.length - 2)];
    const d = dirOf(bx, by, tx, ty);
    for (let i = 1; i <= 6; i++) {
      const sw = Math.sin(this.t * 30 + i) * 0.8 * (i / 6);
      st.dot(tx + d.ux * i - d.uy * sw, ty + d.uy * i + d.ux * sw + i * 0.3, i < 3 ? C.e : i < 5 ? C.r : C.R, a, 6);
      if (i > 1) st.dot(tx + d.ux * i - d.uy * (sw + 1), ty + d.uy * i + d.ux * (sw + 1) + i * 0.3, C.R, a, 1);
    }
    st.commit(ctx.top);
    // 封神：节上缠着的符纸（几条小纸条，随鞭子飘）
    if (this.seal)
      for (let i = 3; i < pts.length - 1; i += 2) {
        const [x, y] = pts[i];
        const f = Math.sin(this.t * 18 + i) * 1.5;
        for (let j = 0; j < 6; j++) ctx.top.dot(x + 2 + j * 0.3 + f * (j / 6), y + 1 + j, j === 0 || j === 5 ? C.e : C.Y, a);
      }
    // 鞭身上偶尔一粒金色碎光
    if (Math.random() < 0.45 * a) {
      const [x, y] = pts[1 + Math.floor(Math.random() * (pts.length - 1))];
      ctx.glows.emit(x, y, 1, this.seal ? [C.W, C.f] : GOLD_SPARKS, [4, 14], [0.25, 0.45], { drag: 3 });
    }
  }
  /**
   * 鞭痕：鞭子砸进地里的一串竹节印 —— 每隔七像素一道横着的节印，节与节之间一段断续的细痕，中间宽、两头收；
   * 刚落下时是烫金的（芯灵光白、身缃黄），一会儿退成琥珀、再暗成焦黑淡掉；头一下有几粒火星从痕里冒出来。
   */
  private drawMark(ctx: Ctx, m: Mark, life: number) {
    const ux = Math.cos(m.va);
    const uy = Math.sin(m.va);
    // 画 [s0, s1] 这一段（离人物太远的那一截截掉了），中间宽、两头收
    const mid = (m.s0 + m.s1) / 2;
    const half = Math.max(1, (m.s1 - m.s0) / 2);
    const hot = clamp01(1 - m.t / 0.7);
    const al = fade(m.t, life, 0.03, 0.9);
    const coreC = hot > 0.55 ? C.W : hot > 0.25 ? C.f : hot > 0.05 ? C.y : C.d;
    const bodyC = hot > 0.45 ? C.Y : hot > 0.15 ? C.y : hot > 0.02 ? C.b : C.g;
    const edgeC = hot > 0.3 ? C.b : C.B;
    for (let s = m.s0; s <= m.s1; s += 0.7) {
      const e = 1 - Math.abs(s - mid) / half;
      if (e <= 0.04) continue;
      const node = (((s - m.s0 + m.seed) % 7) + 7) % 7 < 1.2;
      const gap = !node && hashN(Math.floor(s - m.s0), m.seed) < 0.18;
      if (gap) continue;
      const w = node ? 1.2 + 2 * Math.sqrt(e) : 0.4 + 0.9 * Math.sqrt(e);
      for (let o = -w; o <= w; o += 0.5) {
        const q = Math.abs(o) / Math.max(0.5, w);
        const col = q < 0.4 ? coreC : q < 0.8 ? bodyC : edgeC;
        ctx.under.dot(m.x + ux * s - uy * o, m.y + uy * s + ux * o, col, al * (q < 0.8 ? 0.95 : 0.75));
      }
    }
    if (hot > 0.3 && Math.random() < 0.5) {
      const s = lerp(m.s0, m.s1, rnd(0.05, 0.95));
      ctx.glows.emit(m.x + ux * s, m.y + uy * s, 1, [C.f, C.Y, C.o], [6, 16], [0.3, 0.6], { up: 14, drag: 1.5 });
    }
  }
  destroy() {
    this.cloud.destroy();
  }
}

/** 一个确定性的 0..1（鞭痕的断口每帧不跳）。 */
function hashN(a: number, b: number) {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * 打神的震波：落点往外推开一圈尘浪（土色的尘团往外滚、碎石崩起），地上一圈断开的土色波纹跟着往外推、越推越淡。
 * 不画金色的圈：尘土和地面的起伏。尘浪、波纹的外沿停在震波的判定半径里（原来推到半径的 1.1 倍、九节第三鞭再 ×1.15）；
 * 九节的第三鞭尘团更多、更猛，不更大。
 */
class DustRing implements Effect {
  private t = 0;
  private x: number;
  private y: number;
  private R: number;
  constructor(ctx: Ctx, x: number, y: number, R: number, big: boolean) {
    this.x = x;
    this.y = y;
    this.R = R;
    const m = Math.round((big ? 16 : 12) + this.R / 3);
    for (let i = 0; i < m; i++) {
      const ang = (i / m) * TAU + rnd(-0.1, 0.1);
      const r0 = this.R * 0.3;
      // 尘团从 0.3R 往外滚 1.6R / 3.2 ≈ 0.5R：停在 0.8R 上下（尘团自己还有两三像素大）
      ctx.bits.spawn(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0 * 0.6, { frames: puffSet(pick([4, 5]), 'stone', 1 + (i % 3)), life: rnd(0.6, 0.8), vx: Math.cos(ang) * this.R * 1.6, vy: Math.sin(ang) * this.R * 0.95, drag: 3.2, fadeIn: 0.02, fadeOut: 0.32, z: true, zOff: 1 });
      if (i % 3 === 0) ctx.bits.spawn(x + Math.cos(ang) * this.R * 0.5, y + Math.sin(ang) * this.R * 0.3, { frames: [Ts('rocks', () => ROCKS)[i % ROCKS.length]], life: 0.6, vx: Math.cos(ang) * 18, vy: -rnd(40, 75), g: 300, ground: y + Math.sin(ang) * this.R * 0.3, bounce: 0.3, fadeOut: 0.2 });
    }
    ctx.shake.add(big ? 0.12 : 0.06);
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const LIFE = 0.55;
    const k = this.t / LIFE;
    const r = this.R * (0.3 + 0.62 * easeOut(k));
    const a = (1 - k) * 0.85;
    for (let j = 0; j < 7; j++) {
      const a0 = (j / 7) * TAU + 0.2;
      arc(ctx.under, this.x, this.y, r, r * 0.6, a0, a0 + 0.62, (aa) => (Math.sin(aa) > 0 ? C.h : C.i), a);
      arc(ctx.under, this.x, this.y + 1, r - 1, (r - 1) * 0.6, a0 + 0.08, a0 + 0.5, C.g, a * 0.6);
    }
    return this.t < LIFE;
  }
  destroy() {}
}

// ================================================================ 化血神刀

/** 血光的配色：凡、灵是朱砂血光；仙品「化血」加一道紫棠的暗边；「噬魂」整道更暗、更紫。 */
const BLOOD_COLS: Record<'base' | 'mist' | 'soul', number[]> = {
  base: [C.W, C.o, C.e, C.r, C.R],
  mist: [C.W, C.o, C.e, C.r, C.P],
  soul: [C.m, C.e, C.r, C.R, C.P],
};

/**
 * 化血神刀的一斩：刀从身前划过（刀身乌钢、刃口血光，身后一道血色刀影），斩出一道月牙形的血光往外飞，
 * 飞到头停一下再碎成血珠落地；斩中的敌人身上各开一道血口。灵品一斩两层，月牙后面多跟一道；
 * 仙品「化血」的血光带紫棠暗边，身后拖一缕血雾；「血海」三道月牙、扇面更大，地上洒一片血点；「噬魂」血光发暗发紫。
 */
class SlashView implements Effect {
  private t = 0;
  private blade = new Sprite();
  private stroke = new Stroke();
  private dir: number;
  private sprayed = 0;
  private cols: number[];
  private x: number;
  private y: number;
  private a: number;
  private r: number;
  private arc: number;
  private g: Gear;
  constructor(ctx: Ctx, x: number, y: number, a: number, r: number, arc: number, g: Gear, flip: boolean) {
    this.x = x;
    this.y = y;
    this.a = a;
    this.r = r;
    this.arc = arc;
    this.g = g;
    this.dir = flip ? -1 : 1;
    this.cols = g.spirit === 'soul' ? BLOOD_COLS.soul : g.tier >= 3 ? BLOOD_COLS.mist : BLOOD_COLS.base;
    this.blade.visible = false;
    ctx.layer.addChild(this.blade);
    ctx.sound('huaxue.slash');
    if (g.spirit === 'sea') {
      // 血海：扇面里洒下一片血点（贴地，慢慢淡）
      const n = 16;
      for (let i = 0; i < n; i++) {
        const ang = a + rnd(-arc, arc);
        const rr = r * Math.sqrt(rnd(0.15, 1));
        ctx.bits.spawn(x + Math.cos(ang) * rr, y + 8 + Math.sin(ang) * rr * 0.75, { frames: [T(`bsplat${i % 3}`, () => BLOOD_SPLAT[i % 3])], life: rnd(1.2, 1.6), delay: 0.08 + (rr / r) * 0.18, layer: ctx.floor, fadeIn: 0.04, fadeOut: 0.7, alpha: 0.85 });
      }
    }
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const t = this.t;
    const { x, y, a, r, arc } = this;
    const SWEEP = 0.13;
    // 刀：从扇面一边划到另一边，刀尖朝外
    if (t < SWEEP + 0.16) {
      const k = easeOut(t / SWEEP);
      const ang = a - this.dir * arc * 0.95 + this.dir * arc * 1.9 * k;
      const rr = 10;
      applyRot(this.blade, rotTex('hxblade', BLOOD_BLADE, ang, BLOOD_BLADE_TIP.x - 8, BLOOD_BLADE_TIP.y, 32, BLOOD_BLADE_SEL, true));
      this.blade.position.set(Math.round(x + Math.cos(ang) * rr), Math.round(y + Math.sin(ang) * rr));
      this.blade.alpha = fade(t, SWEEP + 0.16, 0.03, 0.12);
      this.blade.visible = true;
      // 刀影：划过的地方一道血色的弧（刀尖的轨迹）
      const a0 = a - this.dir * arc * 0.95;
      const a1 = ang;
      const n = Math.ceil(Math.abs(a1 - a0) * 18);
      for (let i = 0; i <= n; i++) {
        const u = i / Math.max(1, n);
        const aa = a0 + (a1 - a0) * u;
        const rad = rr + 7;
        stamp(this.stroke, x + Math.cos(aa) * rad, y + Math.sin(aa) * rad, 0.4 + 0.9 * u, this.blade.alpha * (0.3 + 0.6 * u), [this.cols[1], this.cols[2], this.cols[3], this.cols[4]]);
      }
    } else this.blade.visible = false;
    // 月牙血光：从近处往外飞到扇面的边，停一下，再碎成血珠淡去
    const layers = this.g.spirit === 'sea' ? 3 : this.g.tier >= 2 ? 2 : 1;
    const FLY = 0.2;
    const LIFE = 0.62;
    for (let li = 0; li < layers; li++) {
      const lt = t - 0.02 - li * 0.05;
      if (lt < 0 || lt > LIFE) continue;
      const k = easeOut(lt / FLY);
      const R = r * (0.32 + 0.6 * k + 0.06 * clamp01((lt - FLY) / (LIFE - FLY)));
      const al = fade(lt, LIFE, 0.04, 0.3) * (li ? 0.55 : 1);
      // 扫开：月牙从起手的那一边先出来
      const reveal = clamp01(lt / 0.1);
      const hw = (this.g.spirit === 'sea' ? 6.2 : this.g.tier >= 3 ? 5.6 : this.g.tier >= 2 ? 5.1 : 4.5) * (li ? 0.55 : 1) * (1 - 0.4 * clamp01((lt - FLY) / (LIFE - FLY)));
      this.crescent(R - li * 6, arc * (li ? 0.85 : 1), hw, al, reveal);
      // 血光的余韵：月牙里沿飘出几粒血珠，往后、往下落
      if (li === 0 && lt < FLY + 0.15 && Math.random() < 0.9) {
        const ang = a + rnd(-arc, arc) * reveal * 0.9;
        const rr = R - hw * rnd(0.8, 1.6);
        ctx.sparks.emit(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 1, BLOOD_SPARKS, [6, 18], [0.35, 0.6], { dir: ang + Math.PI, spread: 0.8, g: 60, drag: 2 });
      }
      // 血珠：月牙飞的时候沿着边往外溅
      if (li === 0 && lt < FLY + 0.05) {
        const want = Math.floor((lt / (FLY + 0.05)) * (this.g.spirit === 'sea' ? 22 : this.g.tier >= 2 ? 14 : 9));
        while (this.sprayed < want) {
          this.sprayed++;
          const ang = a + rnd(-arc, arc) * reveal;
          const px = x + Math.cos(ang) * R;
          const py = y + Math.sin(ang) * R;
          const big = Math.random() < 0.3;
          const gy = py + rnd(8, 16);
          ctx.bits.spawn(px, py, { frames: [T(big ? 'bdropB' : 'bdrop', () => (big ? BLOOD_DROP_BIG : BLOOD_DROP))], life: rnd(0.35, 0.55), vx: Math.cos(ang) * rnd(20, 50), vy: -rnd(10, 40), g: 320, ground: gy, fadeOut: 0.12 });
          if (Math.random() < 0.5) ctx.bits.spawn(px + Math.cos(ang) * 8, gy, { frames: [T(`bsplat${this.sprayed % 3}`, () => BLOOD_SPLAT[this.sprayed % 3])], life: 1.1, delay: 0.3, layer: ctx.floor, fadeIn: 0.03, fadeOut: 0.6, alpha: 0.85 });
        }
      }
      // 仙品「化血」：月牙身后拖一缕血雾
      if (li === 0 && this.g.tier >= 3 && Math.random() < 0.4 && lt < FLY) {
        const ang = a + rnd(-arc, arc) * 0.8;
        const sd = 1 + Math.floor(Math.random() * 3);
        ctx.bits.spawn(x + Math.cos(ang) * R * 0.86, y + Math.sin(ang) * R * 0.86, { frames: Ts(`bpuff4${sd}`, () => bloodPuffFrames(4, sd)), life: rnd(0.6, 0.8), vx: Math.cos(ang) * 14, vy: -5, alpha: 0.85, fadeIn: 0.05, fadeOut: 0.35 });
      }
    }
    this.stroke.commit(ctx.top);
    return t < LIFE + 0.12;
  }
  /** 一道月牙：外沿是半径 R 的弧，中间最厚、两头收尖；从外沿往里依次亮 → 身 → 暗 → 深边。 */
  private crescent(R: number, arc: number, hw: number, al: number, reveal: number) {
    const { x, y, a } = this;
    const st = this.stroke;
    const cols = this.cols;
    const a0 = a - this.dir * arc;
    const span = arc * 2 * reveal;
    const n = Math.ceil(span * R * 1.15);
    for (let i = 0; i <= n; i++) {
      const u = i / Math.max(1, n);
      const ang = a0 + this.dir * span * u;
      const v = (ang - (a - arc)) / (2 * arc); // 0..1 沿整道月牙
      const thick = hw * 2 * Math.sin(Math.PI * clamp01(v)) ** 0.75;
      if (thick < 0.4) continue;
      const cx = Math.cos(ang);
      const cy = Math.sin(ang);
      for (let d = 0; d <= thick; d += 0.6) {
        const q = d / thick; // 0 外沿 … 1 内沿
        const [c, p] = q < 0.18 ? [cols[0], 5] : q < 0.42 ? [cols[1], 4] : q < 0.7 ? [cols[2], 3] : q < 0.9 ? [cols[3], 2] : [cols[4], 1];
        st.dot(x + cx * (R - d), y + cy * (R - d), c, al * (q < 0.18 ? 0.95 : 1), p);
      }
    }
  }
  destroy() {
    this.blade.destroy();
  }
}

/**
 * 化血（仙品）：带着流血死掉的敌人原地化开 —— 身上的血化成一缕缕淡红的血雾往外、往上散开（半透明的几小团，不是一整团），
 * 血珠迸出来落地成血点，几粒血光往上飘；雾里伸出几道血线，飞到身边被传上流血的敌人身上、在那儿溅开一小朵血花（BloodThread）。
 */
function bloodMist(ctx: Ctx, e: Ev<'mist'>) {
  const R = Math.max(14, e.r);
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * TAU + rnd(-0.35, 0.35);
    const d = rnd(0.15, 0.45) * R;
    const sd = 1 + (i % 3);
    ctx.bits.spawn(e.x + Math.cos(ang) * d * 0.5, e.y - 8 + Math.sin(ang) * d * 0.3, {
      frames: Ts(`bpuff${i < 2 ? 4 : 3}${sd}`, () => bloodPuffFrames(i < 2 ? 4 : 3, sd)),
      life: rnd(0.75, 1),
      delay: i * 0.03,
      vx: Math.cos(ang) * R * rnd(1, 1.5),
      vy: Math.sin(ang) * R * 0.6 - rnd(8, 14),
      drag: 2.4,
      alpha: 0.55,
      fadeIn: 0.08,
      fadeOut: 0.5,
    });
  }
  // 血珠迸开、落地成血点
  for (let i = 0; i < 7; i++) {
    const ang = rnd(0, TAU);
    const gy = e.y + Math.sin(ang) * rnd(4, 12);
    ctx.bits.spawn(e.x, e.y - 10, { frames: [T(i % 3 ? 'bdrop' : 'bdropB', () => (i % 3 ? BLOOD_DROP : BLOOD_DROP_BIG))], life: rnd(0.4, 0.6), vx: Math.cos(ang) * rnd(25, 55), vy: -rnd(40, 80), g: 300, ground: gy, fadeOut: 0.1 });
    if (i % 2) ctx.bits.spawn(e.x + Math.cos(ang) * rnd(8, 16), gy, { frames: [T(`bsplat${i % 3}`, () => BLOOD_SPLAT[i % 3])], life: 1.3, delay: 0.35, layer: ctx.floor, fadeIn: 0.03, fadeOut: 0.7, alpha: 0.85 });
  }
  // 身上的血化成血光往上飘
  ctx.glows.emit(e.x, e.y - 10, 8, [C.e, C.o, C.m], [8, 24], [0.5, 0.9], { up: 22, drag: 1.5 });
  ctx.sparks.emit(e.x, e.y - 8, 10, BLOOD_SPARKS, [20, 60], [0.3, 0.6], { drag: 3, g: 60 });
  ctx.sound('huaxue.mist', 0.9, 0.12);
}

/** 化血的血线：从血雾飞向一只被传上流血的敌人（一条头粗尾细的血光，按时间截）。 */
class BloodThread implements Effect {
  private t: number;
  private hist: [number, number, number][] = [];
  private stroke = new Stroke();
  private done = false;
  private c: [number, number];
  private x0: number;
  private y0: number;
  private to: () => [number, number] | null;
  constructor(x0: number, y0: number, to: () => [number, number] | null, delay: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.to = to;
    this.t = -delay;
    const p = to() ?? [x0, y0];
    const d = dirOf(x0, y0, p[0], p[1]);
    this.c = [(x0 + p[0]) / 2 + d.nx * rnd(-14, 14), (y0 + p[1]) / 2 - rnd(8, 18)];
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    if (this.t < 0) return true;
    const DUR = 0.42;
    const k = easeInOut(this.t / DUR);
    const p = this.to();
    if (!p) return false;
    if (this.t <= DUR) {
      const x = (1 - k) ** 2 * this.x0 + 2 * k * (1 - k) * this.c[0] + k * k * p[0];
      const y = (1 - k) ** 2 * this.y0 + 2 * k * (1 - k) * this.c[1] + k * k * p[1];
      this.hist.unshift([x, y, this.t]);
    } else if (!this.done) {
      this.done = true;
      ctx.bits.spawn(p[0], p[1], { frames: Ts('bcut', () => BLOOD_CUT), fps: 14, loop: false, life: 0.26, fadeOut: 0.1 });
      ctx.sparks.emit(p[0], p[1], 5, BLOOD_SPARKS, [20, 50], [0.2, 0.4], { g: 120, drag: 2 });
    }
    while (this.hist.length > 2 && this.t - this.hist[this.hist.length - 1][2] > 0.22) this.hist.pop();
    if (this.hist.length > 1 && this.t < DUR + 0.22) {
      polyStreak(this.stroke, this.hist.map((h) => [h[0], h[1]] as [number, number]), 2.6, 1 - clamp01((this.t - DUR) / 0.22), [C.o, C.e, C.r, C.R]);
      this.stroke.commit(ctx.top);
    }
    return this.t < DUR + 0.24;
  }
  destroy() {}
}

// ================================================================ 定风珠

/**
 * 定风珠的龙卷用哪一份（pixelfx 的 xianxia/whirlwind，改自 nature/tornado；预设在 render/pixelfx-xianxia.ts）：
 * 凡、灵、仙「定风」、器灵「风雷」「定海」。漏斗多高（不连顶上的珠子）在预设的 height 里。
 */
const WHIRL_LOOK = { fan: 'whirlwind', ling: 'whirlwindLing', xian: 'whirlwindXian', storm: 'whirlwindStorm', calm: 'whirlwindCalm' } as const;
type WhirlLook = keyof typeof WHIRL_LOOK;
const whirlLook = (z: Zone): WhirlLook => (z.spirit === 'thunder' ? 'storm' : z.spirit === 'calm' ? 'calm' : z.tier >= 3 ? 'xian' : z.tier >= 2 ? 'ling' : 'fan');
/**
 * 龙卷分两层画：离地 WHIRL_SPLIT 像素以下的那一截（漏斗的下半截、脚下后半圈的扬尘碎屑）和角色一起按前后排，
 * 以上的（漏斗上半截、漏斗口、顶上的风云）和前半圈的扬尘碎屑盖在所有角色上面——卷进风眼的一群敌人挤在漏斗脚下，头顶上立着一根清楚的龙卷。
 */
const WHIRL_PARTS = ['back', 'front'] as const;
/** 从离地多高分层：比小兵的头顶（约 21）低一点，漏斗在他们肩上接上。 */
const WHIRL_SPLIT = 17;
/** 下半截前半圈的风线，再淡淡地画在角色前面一层的透明度（风裹着卷进来的敌人）。 */
const WHIRL_WRAP = 0.55;
/** 下半截的 zIndex 比风眼的 y 小这么多：贴着风眼前后的敌人都排在漏斗脚的前面，只有明显站在后面的才被它挡住。 */
const WHIRL_Z = 9;
const whirlOpts = (look: WhirlLook, part: (typeof WHIRL_PARTS)[number]) => ({ ...XFX[WHIRL_LOOK[look]].opts, part, split: WHIRL_SPLIT, wrap: WHIRL_WRAP });
/** 出手时风从珠子里往下长到地上要多久（秒）；之后稳定地转，换成预烘焙的帧。 */
const WHIRL_FORM = 0.45;
/** 现场画时每帧改的控制（xianxia/whirlwind 的 ctl）：长出来、缩回珠子里、吹散、整体透明度、不画。 */
type WhirlCtl = { grow: number; sink: number; burst: number; a: number; hide: boolean };
/** 预烘焙好了的帧（键：「样子:层」）。图集跨局留着，同一档只画一次。 */
const whirlBaked = new Map<string, Baked>();
let whirlMod: FxModule | null = null;
// 龙卷的模块很小：战斗页一载入就先拿来（第一道旋风出来时就能现场画）
void loadFx(XFX.whirlwind.id).then(
  (m) => void (whirlMod = m),
  () => {},
);

/** 把这一档的前后两层预烘焙好（一层一层画，中间让出主线程；一档两层合起来约 0.3–0.4 MB、画一次约 20–30 毫秒）。画好之前现场画。 */
function readyWhirl(look: WhirlLook) {
  const p = XFX[WHIRL_LOOK[look]];
  void (async () => {
    for (const part of WHIRL_PARTS) {
      const key = `whirl:${look}:${part}`;
      if (whirlBaked.has(key)) continue;
      await new Promise((r) => setTimeout(r, 0));
      whirlBaked.set(key, await prebake(key, p.id, whirlOpts(look, part)));
    }
  })().catch(() => {});
}

/**
 * 定风珠的旋风（用户 2026-11-11：「定风珠有旋风就行，那三条旋转的线画蛇添足了。pixelfx 就有很好的旋风效果，为什么不用？」
 * 「不容易做到美观可以适当加大一点尺寸，一定要精致」）：
 * 风眼上一道 pixelfx 的龙卷——实心的漏斗上宽下窄、蛇行着摆，左边受光、右边背光，十几条风带一圈圈往上转，顶上看得见漏斗口，
 * 叶子碎石从地上卷进来、绕着往上旋、从顶上甩出去，脚下扬尘；漏斗挂在口上那颗淡青的定风珠下面。
 * 出手时风从珠子里往下长到地上（约 0.45 秒），吹散时风淡掉、尘土叶子往外飞；
 * 「定海」收招时风缩回珠子里，卷住的敌人脚下各落一枚云头风纹、被定住。
 * 分层：漏斗离地 17 像素以下的一截和角色一起按前后排（卷进来的敌人挡在它前面），以上的盖在所有角色上面——一群敌人被卷着、头顶上立着一根龙卷。
 * 品阶：凡 34 高（顶上半径约 13）、青白的风；灵 37（顶约 15）、风带和叶子更多；仙「定风」40（顶约 17）、青风，追着敌群走，
 * 每隔一会儿风刃在卷住的敌人身上划一下；「风雷」35、口上压一团翻滚的灰青乌云、闪淡金的电，雷从云里劈下来（淡金）；「定海」40、天青的风。
 * 尺寸（docs/design.md「定风珠换成 pixelfx 的龙卷」）：风柱连顶上的珠子离地不过约 50（约 1.5 个 32 像素的人）；龙卷的叶子、扬尘离风眼不过约 27；
 * 吹散的尘土叶子停在卷人的半径里，也只画到离人物 REACH.max（往外几像素淡掉）。
 * 原来自己画的这些去掉了（龙卷自己有扬尘、碎屑、风带和吹散，宁少勿多）：地上往里卷的三四道尘风、往中心卷的风线、风柱的三股螺旋和
 * 一圈圈风带、绕着转的叶子碎石精灵、卷住的敌人身上的小风环、风雷的乌云精灵、吹散时往外射的一圈风线。
 */
class WhirlView {
  private t = 0;
  private x: number;
  private y: number;
  private z: Zone;
  private gone = -1;
  private endFx: 'gust' | 'root' | null = null;
  private pearl = new Sprite();
  private lastTick = 0;
  private look: WhirlLook;
  private H: number;
  private storm: boolean;
  private owner: () => [number, number] | null;
  /** 龙卷的两层：[下半截（放进 entities，和角色一起按前后排）, 上半截（盖在角色上面）]。 */
  private layers: PixelFxLayer[];
  /** 现场画的那一对（长出来、吹散、缩回去，或者还没烘焙好的时候）和它们共用的控制。 */
  private live: { h: FxHandle[]; ctl: WhirlCtl } | null = null;
  /** 稳定转着的时候，前后两层各放一张预烘焙的帧。 */
  private still: Sprite[] = [];
  constructor(ctx: Ctx, z: Zone, owner: () => [number, number] | null) {
    this.z = { ...z };
    this.x = z.x;
    this.y = z.y;
    this.owner = owner;
    this.look = whirlLook(z);
    const p = XFX[WHIRL_LOOK[this.look]];
    this.H = p.opts.height as number;
    this.storm = !!p.opts.storm;
    this.layers = [new PixelFxLayer(ctx.stage.entities, { flat: true }), new PixelFxLayer(ctx.layer)];
    for (const l of this.layers) {
      const s = new Sprite();
      s.visible = false;
      l.view.addChild(s);
      this.still.push(s);
    }
    this.pearl.anchor.set(0.5);
    this.pearl.alpha = 0;
    ctx.layer.addChild(this.pearl);
    readyWhirl(this.look);
    this.lastTick = z.tick;
    ctx.sound('dingfeng.whirl', 0.9, 0.2);
  }
  /** 地上的东西画到离人物脚下 REACH.max 为止（模拟只卷这以内的敌人）：往外 6 像素淡掉。 */
  private reach(): (px: number, py: number) => number {
    const h = this.owner();
    if (!h) return () => 1;
    const cap = REACH.max;
    return (px, py) => clamp01((cap - Math.hypot(px - h[0], py - h[1])) / 6);
  }
  /** 风雷的雷从哪儿劈下来：龙卷顶上的乌云。 */
  get cloudTop(): [number, number] {
    return [this.x, this.y - this.H - 4];
  }
  end(ctx: ACtx, e: Ev<'zoneEnd'>) {
    this.endFx = e.effect === 'root' ? 'root' : 'gust';
    this.x = e.x;
    this.y = e.y;
    const R = e.r;
    if (this.endFx === 'gust') {
      // 吹散：龙卷的风带往外甩开（update 里）；尘土、叶子往外飞。落点离人物超过 REACH.max 的那几团不放（地上的风也只画到那里）
      const reach = this.reach();
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * TAU + rnd(-0.1, 0.1);
        // 从 0.3R 往外滚 1.7R / 3 ≈ 0.55R：停在 0.85R 上下
        if (reach(this.x + Math.cos(ang) * R * 0.87, this.y + Math.sin(ang) * R * 0.51) < 0.5) continue;
        ctx.bits.spawn(this.x + Math.cos(ang) * R * 0.3, this.y + Math.sin(ang) * R * 0.18, { frames: puffSet(pick([3, 4, 5]), 'stone', 1 + (i % 3)), life: rnd(0.5, 0.7), vx: Math.cos(ang) * R * 1.7, vy: Math.sin(ang) * R * 1.0, drag: 3, fadeIn: 0.02, fadeOut: 0.3, z: true, alpha: 0.8 });
      }
      for (let i = 0; i < 12; i++) {
        const ang = rnd(0, TAU);
        const sp = R * rnd(1.1, 1.7); // 飞出 sp / 2.2 ≈ 0.5–0.75R；往上飞的压低（离地不过约 30）
        if (reach(this.x + Math.cos(ang) * (6 + sp / 2.2), this.y + Math.sin(ang) * sp * 0.25) < 0.5) continue;
        ctx.bits.spawn(this.x + Math.cos(ang) * 6, this.y - rnd(4, this.H * 0.6), { frames: Ts('leaves', () => LEAVES), fps: rnd(10, 16), loop: true, life: rnd(0.6, 0.9), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.35 - 4, drag: 2.2, g: 30, fadeOut: 0.3 });
      }
      ctx.shake.add(0.12);
      ctx.sound('dingfeng.gust');
    } else {
      ctx.sound('dingfeng.gust', 0.6);
      // 定海：风缩回珠子里（update 里），卷住的敌人一只只被定在原地 —— 脚下落一枚云头风纹，身上的风环停住不转、慢慢淡去
      for (const id of e.ids ?? []) {
        const p = ctx.enemyPos(id);
        if (!p) continue;
        ctx.add(new Calm(ctx, id, 1.7));
        ctx.sparks.emit(p[0], p[1] - 10, 6, [C.W, C.Cc, C.L], [10, 30], [0.4, 0.7], { up: 10, drag: 2 });
      }
    }
  }
  /** 现场画一对（从 t0 秒接着放，和预烘焙的帧同一个时刻）。 */
  private startLive(t0: number, ctl: WhirlCtl) {
    if (!whirlMod) return;
    const follow = () => ({ x: this.x, y: this.y, z: this.y - WHIRL_Z });
    const mod = whirlMod;
    this.live = { ctl, h: this.layers.map((l, i) => l.play(mod, { ...whirlOpts(this.look, WHIRL_PARTS[i]), ctl, x: this.x, y: this.y, z: this.y - WHIRL_Z, t0: Math.max(0, t0), follow, fps: 30 })) };
  }
  /** 收掉现场画的那一对（马上不画，留在层里淡出的那 0.3 秒也是空的）。 */
  private dropLive() {
    if (!this.live) return;
    this.live.ctl.hide = true;
    for (const h of this.live.h) h.stop();
    this.live = null;
  }
  update(dt: number, ctx: Ctx, live: Zone | null, alpha: number): boolean {
    this.t += dt;
    if (live) {
      this.z = { ...live };
      this.x = lerp(live.px ?? live.x, live.x, alpha);
      this.y = lerp(live.py ?? live.y, live.y, alpha);
    } else if (this.gone < 0) {
      this.gone = 0;
      if (!this.endFx) this.endFx = 'gust';
    }
    if (this.gone >= 0) this.gone += dt;
    const z = this.z;
    const OUT = this.endFx === 'root' ? 0.5 : 0.4;
    const out = this.gone >= 0 ? clamp01(this.gone / OUT) : 0;
    if (this.gone > OUT + 0.05) return false;
    const a = clamp01(z.t / 0.3) * (1 - out);
    const x = this.x;
    const y = this.y;
    const t = this.t;
    // 1) 龙卷：先从珠子里往下长到地上，之后稳定地转（预烘焙好了就放图集的帧），收招时吹散 / 缩回珠子里
    const ctl: WhirlCtl = {
      a: clamp01(t / 0.2),
      grow: easeOut(clamp01(t / WHIRL_FORM)),
      burst: this.endFx === 'gust' ? easeOut(out) : 0,
      sink: this.endFx === 'root' ? easeInOut(out) : 0,
      hide: false,
    };
    const steady = t >= WHIRL_FORM && !this.endFx;
    const baked = steady ? WHIRL_PARTS.map((part) => whirlBaked.get(`whirl:${this.look}:${part}`)) : [];
    if (baked.length && baked.every((b) => b)) {
      this.dropLive();
      baked.forEach((b, i) => {
        const s = this.still[i];
        const tex = b!.textures[Math.floor(t * b!.fps + 1e-6) % b!.textures.length];
        s.visible = !!tex;
        if (tex) s.texture = tex;
        s.anchor.set(b!.ax, b!.ay);
        s.position.set(Math.round(x), Math.round(y));
        if (i === 0) s.zIndex = y - WHIRL_Z;
      });
    } else {
      for (const s of this.still) s.visible = false;
      if (this.live) Object.assign(this.live.ctl, ctl);
      else this.startLive(t - dt, ctl);
    }
    for (const l of this.layers) l.update(dt);
    // 2) 仙品「定风」：每隔一会儿，风刃在卷住的敌人身上划一下
    if (live && z.tier >= 3 && live.tick > this.lastTick + 0.2) {
      for (const id of z.ids ?? []) {
        const p = ctx.enemyPos(id);
        if (!p) continue;
        const hd = headOf(ctx.enemy(id)?.kind);
        ctx.bits.spawn(p[0] + rnd(-3, 3), p[1] - hd * 0.5 + rnd(-3, 3), { frames: Ts('slash', () => SLASH_W), fps: 14, loop: false, life: 0.24, fadeOut: 0.1, tint: 0xe6ffd0 });
      }
    }
    if (live) this.lastTick = live.tick;
    // 3) 定风珠：悬在漏斗口上（风雷压在乌云上），慢慢上下浮，珠里的风纹在转；吹散时一起淡掉，「定海」等风缩回来了再淡
    const ty = y - this.H - (this.storm ? 9 : 5);
    this.pearl.texture = Ts('pearl', () => PEARL)[Math.floor(t * 8) % 4];
    this.pearl.position.set(Math.round(x), Math.round(ty + Math.sin(t * 3)));
    this.pearl.alpha = clamp01(t / 0.2) * (this.endFx === 'gust' ? 1 - out : 1 - clamp01((out - 0.6) / 0.4));
    if (Math.random() < 0.2 * a) ctx.sparks.emit(x + rnd(-3, 3), ty + rnd(-2, 2), 1, WIND_SPARKS, [4, 12], [0.3, 0.5], { up: -6, drag: 2 });
    return true;
  }
  destroy() {
    this.pearl.destroy();
    for (const s of this.still) s.destroy();
    for (const l of this.layers) l.destroy();
  }
}

/** 定海定住的一只：脚下一枚云头风纹（跟着它），身上两道停住不转的风环，一起慢慢淡去。 */
class Calm implements Effect {
  private t = 0;
  private seal = new Sprite();
  private id: number;
  private life: number;
  private last: [number, number] = [0, 0];
  constructor(ctx: Ctx, id: number, life: number) {
    this.id = id;
    this.life = life;
    this.seal.texture = T('calmseal', () => CALM_SEAL);
    this.seal.anchor.set(0.5);
    this.seal.alpha = 0;
    ctx.floor.addChild(this.seal);
    const p = ctx.enemyPos(id);
    if (p) this.last = p;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const p = ctx.enemyPos(this.id);
    if (p) this.last = p;
    const [x, y] = this.last;
    const a = fade(this.t, this.life, 0.2, 0.6);
    this.seal.position.set(Math.round(x), Math.round(y + 1));
    this.seal.alpha = a;
    const hd = headOf(ctx.enemy(this.id)?.kind);
    for (let k = 0; k < 2; k++) {
      const hy = y - hd * (0.3 + k * 0.38);
      const rx = 7 + k * 1.5 + (hd > 30 ? 4 : 0);
      arc(ctx.top, x, hy, rx, rx * 0.3, 0.15, Math.PI - 0.15, (aa) => (aa < 1.2 ? C.W : C.Cc), a * 0.85);
      arc(ctx.top, x, hy + 1, rx, rx * 0.3, 0.3, Math.PI - 0.3, C.n, a * 0.5);
    }
    if (Math.random() < 0.06) ctx.bits.spawn(x + rnd(-6, 6), y - rnd(4, hd), { frames: Ts('star', () => STAR).slice(0, 2), life: 0.25, fadeOut: 0.12 });
    return this.t < this.life;
  }
  destroy() {
    this.seal.destroy();
  }
}

/** 风刃的划痕（白色，表现层按需要着色）。 */
const SLASH_W: Grid[] = [
  { w: 6, h: 3, rows: ['....WW', '..WW..', 'WW....'] },
  { w: 7, h: 3, rows: ['....WWW', '.WWWW..', 'WW.....'] },
  { w: 7, h: 3, rows: ['.....ww', '..www..', 'ww.....'] },
];

// ================================================================ 青莲宝色旗

/** 荆棘藤环（和藤上的小青莲）画在判定半径的多少倍上。 */
const LOTUS_VINE = 0.9;

/**
 * 青莲结界：脚下的地面浮现一朵大青莲的线描（一片片尖瓣从人脚下辐射出去），外沿一圈两股绞在一起的荆棘青藤（从身后两头往前长合），
 * 藤上一朵朵小青莲次第开放；结界里不时升起青白的灵光，回血时灵光从四周往人身上聚；敌人踩进来，脚下刺出一根带刺的青藤。
 * 灵品更大、两层莲瓣、藤上叶子更多；仙品「步步生莲」结界跟着人走，人走过的地方一步开一朵小青莲；
 * 「莲台」人脚下托起一座重瓣青莲台、灵光更多，闪开时莲瓣飞散；「荆棘」藤更粗、刺尖朱红，刺出来的荆棘更大更狠。
 */
class LotusView {
  private t = 0;
  private z: Zone;
  private x: number;
  private y: number;
  private gone = -1;
  private mandala: Sprite;
  private mandFr: Texture[];
  private vine: Sprite;
  private vineFr: Texture[];
  private buds: { s: Sprite; a: number; d: number }[] = [];
  private throne: Sprite | null = null;
  private moteCd = 0;
  private lastTick: number;
  private stepX: number;
  private stepY: number;
  private thorn: boolean;
  private owner: () => [number, number] | null;
  constructor(ctx: Ctx, z: Zone, owner: () => [number, number] | null) {
    this.owner = owner;
    this.z = { ...z };
    this.x = z.x;
    this.y = z.y;
    this.stepX = z.x;
    this.stepY = z.y;
    this.lastTick = z.tick;
    this.thorn = z.spirit === 'thorn';
    const R = Math.round(z.r / 2) * 2;
    const layers = z.tier >= 2 ? 2 : 1;
    const style = this.thorn ? 'thorn' : z.tier >= 2 ? 'leafy' : 'plain';
    this.mandFr = Ts(`mandala${R}${layers}`, () => {
      const full = lotusMandala(R * 0.88, 8, layers, 3); // 莲瓣收在藤环里面
      return [0.25, 0.45, 0.65, 0.85, 1].map((k) => revealed(full, k));
    });
    // 藤环画在判定半径以内一点：藤身的起伏、刺和藤上的小青莲往外伸出几像素，外沿正好到结界的边，不画得比判定范围大
    const RV = Math.round((z.r * LOTUS_VINE) / 2) * 2;
    this.vineFr = Ts(`vine${RV}${style}`, () => vineRingFrames(RV, 5, style, 6));
    this.mandala = new Sprite(this.mandFr[0]);
    this.mandala.anchor.set(0.5);
    this.mandala.alpha = 0;
    this.vine = new Sprite(this.vineFr[0]);
    this.vine.anchor.set(0.5);
    this.vine.alpha = 0;
    ctx.floor.addChild(this.mandala, this.vine);
    // 藤上的小青莲：沿圈均匀开，次第开放
    const n = z.tier >= 2 ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const s = new Sprite(Ts('lbud', () => LOTUS_BUD)[0]);
      s.anchor.set(0.5, 0.8);
      s.alpha = 0;
      ctx.stage.entities.addChild(s);
      this.buds.push({ s, a: -Math.PI / 2 + ((i + 0.5) / n) * TAU, d: 0.15 + (Math.abs(((i + 0.5) / n) * 2 - 1) * 0.35) });
    }
    if (z.spirit === 'dais') {
      this.throne = new Sprite(Ts('azlotusB', () => azureLotusFrames(8, true))[0]);
      this.throne.anchor.set(0.5, 0.55);
      this.throne.alpha = 0;
      ctx.floor.addChild(this.throne);
    }
    ctx.sound('qinglian.bloom', 0.9, 0.3);
  }
  /** 回血：灵光从结界四周往人身上聚。 */
  heal(ctx: ACtx, amount: number) {
    const n = Math.min(7, 3 + Math.round(amount));
    for (let i = 0; i < n; i++) {
      const ang = rnd(0, TAU);
      const rr = this.z.r * rnd(0.55, 0.95);
      const sx = this.x + Math.cos(ang) * rr;
      const sy = this.y + Math.sin(ang) * rr * 0.62 - 3;
      ctx.add(
        new Homing(ctx, Ts('lmote', () => LOTUS_MOTE), sx, sy, () => this.owner() ?? [this.x, this.y - 12], rnd(0.45, 0.65), i * 0.05, C.L, (x, y) => {
          if (Math.random() < 0.5) ctx.sparks.emit(x, y, 2, LOTUS_SPARKS, [6, 16], [0.2, 0.4], { up: 10, drag: 2 });
        }),
      );
    }
    ctx.sound('qinglian.heal', 0.8, 0.9);
  }
  dodge(ctx: Ctx) {
    if (!this.throne) return;
    const [px, py] = this.owner() ?? [this.x, this.y];
    const petals = Ts('azpetal', () => GOLD_PETAL.map((g) => recolor(g, { f: 'w', Y: 'C', y: 'c', B: 'N' })));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      ctx.bits.spawn(px + Math.cos(a) * 8, py - 10 + Math.sin(a) * 6, { frames: petals, fps: 12, loop: true, life: rnd(0.7, 1), vx: Math.cos(a) * rnd(25, 40), vy: Math.sin(a) * 20 - 6, g: 18, drag: 2.4, fadeOut: 0.4 });
    }
  }
  update(dt: number, ctx: Ctx, live: Zone | null, alpha: number, enemies: Enemy[]): boolean {
    this.t += dt;
    if (live) {
      this.z = { ...live };
      this.x = lerp(live.px ?? live.x, live.x, alpha);
      this.y = lerp(live.py ?? live.y, live.y, alpha);
    } else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const z = this.z;
    const a = this.gone >= 0 ? Math.max(0, 1 - this.gone / 0.35) * fade(z.t, z.life, 0.3, 0.7) : fade(z.t, z.life, 0.3, 0.7);
    if (this.gone > 0.4 || (this.gone >= 0 && a <= 0)) return false;
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    // 莲纹从人脚下往外铺开；藤从身后两头往前长合（收尾时倒着缩回去）
    const grow = clamp01(z.t / 0.55);
    const shrink = clamp01((z.life - z.t) / 0.6);
    const g = Math.min(grow, shrink);
    this.mandala.texture = this.mandFr[Math.min(this.mandFr.length - 1, Math.floor(clamp01(z.t / 0.4) * this.mandFr.length))];
    this.mandala.position.set(x, y);
    this.mandala.alpha = 0.62 * a;
    this.vine.texture = this.vineFr[Math.max(0, Math.min(this.vineFr.length - 1, Math.ceil(g * this.vineFr.length) - 1))];
    this.vine.position.set(x, y + 1);
    this.vine.alpha = a;
    // 小青莲：次第开放，收尾时合上
    const bud = Ts('lbud', () => LOTUS_BUD);
    for (const b of this.buds) {
      const open = clamp01((z.t - 0.25 - b.d) / 0.35);
      const close = clamp01((z.life - z.t - 0.1) / 0.4);
      const k = Math.min(open, close);
      b.s.texture = bud[Math.min(3, Math.floor(k * 3.99))];
      const rr = z.r * LOTUS_VINE;
      const bx = this.x + Math.cos(b.a) * rr;
      const by = this.y + Math.sin(b.a) * rr * 0.62;
      b.s.position.set(Math.round(bx), Math.round(by + Math.sin(this.t * 2 + b.a) * 0.6));
      b.s.zIndex = by;
      b.s.alpha = a * clamp01(open * 3);
    }
    // 莲台
    if (this.throne) {
      const p = this.owner(); // 胸口的位置（往上 12），莲台托在脚下
      if (p) this.throne.position.set(Math.round(p[0]), Math.round(p[1] + 14));
      this.throne.texture = Ts('azlotusB', () => azureLotusFrames(8, true))[Math.floor(this.t * 6) % 8];
      this.throne.alpha = a * clamp01((z.t - 0.15) / 0.3);
    }
    // 灵光：结界里不时升起一粒（莲台多一些）
    this.moteCd -= dt;
    if (this.gone < 0 && this.moteCd <= 0) {
      this.moteCd = this.throne ? 0.06 : 0.11;
      const ang = rnd(0, TAU);
      const rr = Math.sqrt(rnd(0.05, 1)) * z.r * 0.9;
      ctx.glows.emit(this.x + Math.cos(ang) * rr, this.y + Math.sin(ang) * rr * 0.62, 1, LOTUS_SPARKS, [3, 9], [0.6, 1.1], { up: 16, drag: 1.2 });
    }
    // 荆棘：结界每刺一下（模拟的计时器跳回来），踩在里面的敌人脚下刺出一根带刺的青藤
    if (live && live.tick > this.lastTick + 0.2) {
      const R = z.r;
      let n = 0;
      for (const e of enemies) {
        if (n >= 10) break;
        const ex = e.px + (e.x - e.px) * alpha;
        const ey = e.py + (e.y - e.py) * alpha;
        if ((ex - live.x) ** 2 + (ey - live.y) ** 2 > (R + 4) ** 2) continue;
        n++;
        this.stab(ctx, e.id, ex, ey);
      }
      if (n) ctx.sound('qinglian.thorn', 0.7, 0.15);
    }
    if (live) this.lastTick = live.tick;
    // 步步生莲：人走过的地方一步开一朵小青莲
    if (z.tier >= 3 && this.gone < 0) {
      const p = this.owner();
      if (p && Math.hypot(p[0] - this.stepX, p[1] - this.stepY) > 9) {
        this.stepX = p[0];
        this.stepY = p[1];
        ctx.bits.spawn(p[0] + rnd(-2, 2), p[1] + 2, { frames: Ts('steplotus', () => STEP_LOTUS), life: 1.1, layer: ctx.floor, fadeIn: 0.08, fadeOut: 0.4, alpha: 0.95 });
      }
    }
    return true;
  }
  private stab(ctx: Ctx, id: number, x: number, y: number) {
    const fr = Ts(`thorn${this.thorn ? 1 : 0}`, () => thornFrames(this.thorn, this.thorn ? 17 : 13));
    const seq = [...fr, fr[4], fr[4], fr[3], fr[2], fr[1], fr[0]];
    const offs = this.thorn ? [-3, 3] : [0];
    offs.forEach((dx, i) => {
      ctx.bits.spawn(x + dx + rnd(-1, 1), y + 1, { frames: seq, fps: 28, loop: false, life: seq.length / 28, delay: i * 0.05, anchor: [0.5, 1], z: true, zOff: 1.5, fadeIn: 0.02, fadeOut: 0.1 });
    });
    void id;
    ctx.sparks.emit(x, y - 6, this.thorn ? 5 : 3, this.thorn ? [C.e, C.L, C.r] : [C.L, C.l, C.W], [15, 40], [0.2, 0.4], { up: 20, drag: 3 });
  }
  destroy() {
    this.mandala.destroy();
    this.vine.destroy();
    this.throne?.destroy();
    for (const b of this.buds) b.s.destroy();
  }
}

// ================================================================ 阴阳镜

/** 两道光的配色：阳是金白，阴是青。 */
const BEAM_COLS: Record<'yang' | 'yin', Cols> = { yang: [C.W, C.Y, C.y, C.B], yin: [C.W, C.Cc, C.c, C.N] };

/**
 * 阴阳镜的一道光束：哪吒肩头浮起一面铜镜，镜面射出一道由粗到细的光，扫过一个扇面；扫过的地方留下几道越来越淡的光影，
 * 光的尽头一颗星芒一明一暗。扫完停一下，光从远处往镜子收回来、镜子淡去。
 * 凡品一道（阳）；灵品更长、扫得更宽；仙品「阴阳」一青一金两道反向扫，两道都照到的敌人头顶转着一枚小太极、被冻住；
 * 「照妖」光束镶一道金边，照到的精英、首领身上冒出紫黑的妖气；「乾坤」两道各扫整整一圈，光影连成一个转着的太极。
 * 不盖住人物（用户：法宝、特效都不能盖住人物）：原来镜子贴在肩头、光从身边射出，朝上、朝下扫的时候镜子和光都从人物身上过去
 * （仙品两道反向扫、乾坤扫整圈时最多，量过盖住人物三到六成、一秒半）。现在镜子浮在光束的方向上、刚好让开人物身子的地方（`clearOf`：
 * 朝两边离胸口 14 像素、朝下 18.5、朝上 25，让开发髻），光从镜子射出，光的尽头还在原来的地方（判定见 sim/weapons.ts 的 yinyang）；
 * 万一还有落在人物身子那一块里的点（光影、星芒），画到地上一层，人物压在上面；身上也不冒光点。
 */
class BeamView {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private mirror = new Sprite();
  private hist: { a: number; t: number }[] = [];
  private stroke = new Stroke();
  /** 落在人物身上的那一截光束：提交到地上一层（ctx.under），人物压在上面。 */
  private near = new Stroke();
  /** 光束、光影的每一点按落没落在人物身上分到两笔里。 */
  private route = { dot: (x: number, y: number, c: number, a: number, p: number) => (this.onBody(x, y) ? this.near : this.stroke).dot(x, y, c, a, p) };
  private x: number;
  private y: number;
  private a: number;
  private yin: boolean;
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    this.x = z.x;
    this.y = z.y;
    this.a = z.a ?? 0;
    this.yin = !!z.yin && z.tier >= 3;
    this.mirror.texture = T(this.yin ? 'mirrorYin' : 'mirrorYang', () => (this.yin ? MIRROR.yin : MIRROR.yang));
    this.mirror.anchor.set(0.5);
    this.mirror.alpha = 0;
    ctx.layer.addChild(this.mirror);
    ctx.sound('yinyang.beam', this.yin ? 0.7 : 1, 0.08);
  }
  /**
   * (px, py) 落没落在人物身子那一块里：左右各 8 像素半，从脚下往上 27 像素（连发髻、三尖两刃刀的刀头）。
   * 光束从人物脚下往上 8 像素发出（sim/weapons.ts 的 yinyang），所以脚下是 this.y + 8。
   */
  private onBody(px: number, py: number) {
    const fy = this.y + 8;
    return Math.abs(px - this.x) <= 8.5 && py >= fy - 27.5 && py <= fy + 1.5;
  }
  /**
   * 镜子离胸口多远才让开人物的身子（沿光束的方向 (c, s)）：人物身子左右各 8 像素半、胸口往上 19（发髻顶）、往下 12 半（脚底），
   * 镜子连描边 11×12。朝哪边先让开就取哪边，最远 26。
   */
  private static clearOf(c: number, s: number) {
    const dx = Math.abs(c) > 1e-3 ? 14 / Math.abs(c) : Infinity;
    const dy = s > 1e-3 ? 18.5 / s : s < -1e-3 ? 25 / -s : Infinity;
    return Math.min(26, dx, dy);
  }
  /** 一像素的直线：落在人物身上的点画到地上一层。 */
  private line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, col: number, a: number) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      (this.onBody(x, y) ? ctx.under : ctx.top).dot(x, y, col, a);
    }
  }
  update(dt: number, ctx: Ctx, live: Zone | null, alpha: number): boolean {
    this.t += dt;
    if (live) {
      this.z = { ...live };
      this.x = lerp(live.px ?? live.x, live.x, alpha);
      this.y = lerp(live.py ?? live.y, live.y, alpha);
      this.a = lerpAng(live.pa ?? live.a ?? 0, live.a ?? 0, alpha);
    } else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const z = this.z;
    const HOLD = 0.08;
    const OUT = 0.3;
    if (this.gone > HOLD + OUT + 0.15) return false;
    const cosmos = z.spirit === 'cosmos';
    const demon = z.spirit === 'demon';
    const cols = this.yin ? BEAM_COLS.yin : BEAM_COLS.yang;
    // 镜子：浮在光束的方向上、刚好让开人物身子的地方（胸口 = 光束的发出点往上 3）
    const ux = Math.cos(this.a);
    const uy = Math.sin(this.a);
    const d = BeamView.clearOf(ux, uy);
    const mx = this.x + ux * d;
    const my = this.y - 3 + uy * d;
    this.mirror.position.set(Math.round(mx), Math.round(my + Math.sin(this.t * 6) * 0.6));
    this.mirror.alpha = clamp01(this.t / 0.08) * (this.gone >= 0 ? 1 - clamp01((this.gone - HOLD) / (OUT + 0.1)) : 1);
    // 光：刚射出时从镜子往外长出去；扫完停一下，再从远处往回收
    const len = z.len ?? 100;
    const grow = easeOut(clamp01(this.t / 0.07));
    const back = this.gone >= 0 ? easeIn(clamp01((this.gone - HOLD) / OUT)) : 0;
    // 光的尽头离胸口 9 + len·grow（和原来镜子贴在肩头时一样远），起点是镜子的外沿：光比原来短了镜子挪出去的那一截
    const L = len * grow * (1 - back) + 6 - d;
    const al = 1 - back * 0.6;
    // 光影：扫过的角度留几道淡的
    if (this.gone < 0) {
      this.hist.unshift({ a: this.a, t: this.t });
      while (this.hist.length > 2 && this.t - this.hist[this.hist.length - 1].t > (cosmos ? 0.3 : 0.2)) this.hist.pop();
    } else {
      // 扫完：光影慢慢淡掉
      for (const h of this.hist) h.t -= dt * 0.5;
      while (this.hist.length && this.t - this.hist[this.hist.length - 1].t > (cosmos ? 0.3 : 0.2)) this.hist.pop();
    }
    const span = cosmos ? 0.3 : 0.2;
    for (let i = 2; i < this.hist.length; i += 2) {
      const h = this.hist[i];
      const k = (this.t - h.t) / span;
      if (k >= 1) continue;
      const hc = Math.cos(h.a);
      const hs = Math.sin(h.a);
      const g0 = BeamView.clearOf(hc, hs) + 2; // 从那一刻镜子的外沿起
      const g1 = 6 + len * grow * 0.96; // 尽头和原来一样远
      if (g1 <= g0) continue;
      const cy = this.y - 3;
      this.line(ctx, this.x + hc * g0, cy + hs * g0, this.x + hc * g1, cy + hs * g1, k < 0.4 ? cols[1] : cols[2], (1 - k) * 0.42 * al);
    }
    if (L > 2) {
      const sx = mx + ux * 3;
      const sy = my + uy * 3;
      const hw0 = z.tier >= 2 ? 3.8 : 3.4;
      rod(
        this.route,
        [
          [sx, sy],
          [sx + ux * L, sy + uy * L],
        ],
        (s, total) => hw0 * (1 - 0.62 * (s / total)) * (1 - clamp01((s - total + 6) / 6) * 0.7),
        (s, total) => al * (0.75 + 0.25 * (1 - s / total)),
        [cols[0], cols[1], cols[2], cols[3]],
      );
      // 照妖：光束外再镶一道金边
      if (demon && !this.yin)
        for (let s = 4; s < L; s += 1.5) for (const o of [-hw0 - 1, hw0 + 1]) this.route.dot(sx + ux * s - uy * o * (1 - s / L), sy + uy * s + ux * o * (1 - s / L), C.y, al * 0.8, 0);
      this.stroke.commit(ctx.top);
      this.near.commit(ctx.under);
      // 光的尽头一颗星芒，一明一暗
      const ex = sx + ux * L;
      const ey = sy + uy * L;
      const big = Math.floor(this.t * 14) % 2;
      for (let i = -2 - big; i <= 2 + big; i++) {
        const c = Math.abs(i) < 2 ? C.W : cols[1];
        (this.onBody(ex + i, ey) ? ctx.under : ctx.top).dot(ex + i, ey, c, al);
        (this.onBody(ex, ey + i) ? ctx.under : ctx.top).dot(ex, ey + i, c, al);
      }
      if (Math.random() < 0.6 * al) {
        const s = rnd(0.2, 1) * L;
        if (!this.onBody(sx + ux * s, sy + uy * s)) ctx.glows.emit(sx + ux * s, sy + uy * s, 1, [cols[0], cols[1]], [6, 18], [0.2, 0.4], { drag: 3 });
      }
    }
    return true;
  }
  destroy() {
    this.mirror.destroy();
  }
}

// ================================================================ 玄元控水旗

/**
 * 玄元控水旗：敌人最密的地方先涌起一道水柱（冲高、顶上翻起浪花、塌下来溅一地水花），再从中间铺开一片水域 ——
 * 半透明的水底越往中间越深，岸边一圈白浪花沿岸慢慢移动，水里几道往外扩的断弧水纹、几点水光；一面玄青的控水旗从水里升起、插在水边飘；
 * 站在水里的敌人脚下不时溅起水花。灵品更大更久；仙品「漩涡」水面上三道螺旋水纹往中心卷、气泡被吸进去；
 * 「水淹」两片同时铺开，水面上不断有浪头往外推；「寒潭」水更深，岸边慢慢结霜，收尾时整片冻成冰面，停一会儿再碎掉。
 */
class PoolView {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private body: Sprite;
  private detail: Sprite;
  private swirl: Sprite | null = null;
  private flag: Sprite;
  private ice: Sprite | null = null;
  private iceT = -1;
  private bodyFr: Texture[];
  private detailFr: Texture[];
  private revealFr: Texture[];
  private vortexFr: Texture[] = [];
  private iceFr: Texture[] = [];
  private splashCd = new Map<number, number>();
  private crestCd = 0;
  private crests: { r: number; a0: number }[] = [];
  private frostCd = 0;
  private deep: boolean;
  private flood: boolean;
  private R: number;
  private fx: number;
  private fy: number;
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    this.deep = z.spirit === 'abyss';
    this.flood = z.spirit === 'flood';
    const R = (this.R = Math.max(12, Math.round(z.r / 2) * 2));
    const key = `${R}${this.deep ? 1 : 0}`;
    const seed = 3 + (z.id % 3);
    this.bodyFr = Ts(`poolB${key}${seed}`, () => {
      const b = poolBody(R, seed, this.deep);
      return [0.3, 0.5, 0.7, 0.85, 1].map((k) => revealed(b, k));
    });
    this.revealFr = Ts(`poolR${key}${seed}`, () => {
      const d = poolFrames(R, seed, this.deep, 1)[0];
      return [0.3, 0.5, 0.7, 0.85, 1].map((k) => revealed(d, k));
    });
    this.detailFr = Ts(`poolD${key}${seed}`, () => poolFrames(R, seed, this.deep, 8));
    this.body = new Sprite(this.bodyFr[0]);
    this.body.anchor.set(0.5);
    this.body.alpha = 0;
    this.detail = new Sprite(this.revealFr[0]);
    this.detail.anchor.set(0.5);
    this.detail.alpha = 0;
    ctx.floor.addChild(this.body, this.detail);
    if (z.pull) {
      this.vortexFr = Ts(`vortex${R}`, () => vortexFrames(R * 0.95, 12));
      this.swirl = new Sprite(this.vortexFr[0]);
      this.swirl.anchor.set(0.5);
      this.swirl.alpha = 0;
      ctx.floor.addChild(this.swirl);
      ctx.sound('xuanyuan.vortex', 0.8, 0.3);
    }
    // 控水旗：插在水的后沿（偏左），从水里升起来
    this.fx = z.x - R * 0.42;
    this.fy = z.y - R * 0.62 * 0.62;
    this.flag = new Sprite(Ts('wflag', () => waterFlagFrames(8))[0]);
    this.flag.anchor.set((WFLAG_FOOT.x + 0.5) / WFLAG_W, (WFLAG_FOOT.y + 0.5) / WFLAG_H);
    this.flag.alpha = 0;
    ctx.stage.entities.addChild(this.flag);
    // 水柱
    const pill = Ts('pillar', () => pillarFrames());
    ctx.bits.spawn(z.x, z.y + 2, { frames: pill, fps: 16, loop: false, life: pill.length / 16, anchor: [0.5, 1], z: true, zOff: 2, fadeIn: 0.02, fadeOut: 0.12 });
    // 水柱顶上溅开的水珠：跟着水柱压低（水柱最高 32），溅得近一些
    for (let i = 0; i < 16; i++) {
      const ang = rnd(0, TAU);
      const sp = rnd(20, 55);
      ctx.sparks.emit(z.x + rnd(-3, 3), z.y - rnd(8, 28), 1, WATER_SPARKS, [sp, sp], [0.4, 0.75], { dir: ang, spread: 0, g: 160, drag: 1.8 });
    }
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * TAU;
      ctx.bits.spawn(z.x + Math.cos(ang) * 9, z.y + Math.sin(ang) * 5, { frames: Ts('splash', () => SPLASH), fps: 10, loop: false, life: 0.4, delay: 0.25 + i * 0.02, fadeOut: 0.12, z: true });
    }
    ctx.shake.add(0.06);
    ctx.sound('xuanyuan.pool', 1, 0.1);
  }
  end(ctx: Ctx, e: Ev<'zoneEnd'>) {
    if (e.effect !== 'freeze') return;
    // 寒潭：整片冻成冰面
    const R = this.R;
    this.iceFr = Ts(`ice${R}`, () => iceSheetFrames(R, 3 + (this.z.id % 3), 5));
    this.ice = new Sprite(this.iceFr[0]);
    this.ice.anchor.set(0.5);
    this.ice.position.set(Math.round(this.z.x), Math.round(this.z.y));
    ctx.floor.addChild(this.ice);
    this.iceT = 0;
    for (let i = 0; i < 4; i++) ctx.bits.spawn(this.z.x + rnd(-R, R) * 0.6, this.z.y + rnd(-R, R) * 0.3, { frames: puffSet(5, 'snow', 1 + (i % 3)), life: rnd(0.7, 0.9), vy: -10, delay: i * 0.05, alpha: 0.7, fadeOut: 0.4 });
    ctx.sound('xuanyuan.freeze');
  }
  update(dt: number, ctx: Ctx, live: Zone | null, enemies: Enemy[], alpha: number): boolean {
    this.t += dt;
    if (live) this.z = { ...live };
    else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const z = this.z;
    const x = Math.round(z.x);
    const y = Math.round(z.y);
    const R = this.R;
    // 冰面：冻上 → 停 → 碎
    if (this.ice) {
      this.iceT += dt;
      const it = this.iceT;
      const FREEZE = 0.28;
      const HOLDI = 1.25;
      const BREAK = 0.5;
      this.ice.texture = this.iceFr[Math.min(this.iceFr.length - 1, Math.floor((it / FREEZE) * this.iceFr.length))];
      this.ice.alpha = 0.92 * (it > FREEZE + HOLDI ? 1 - (it - FREEZE - HOLDI) / BREAK : 1);
      if (it < FREEZE + HOLDI && Math.random() < 0.15) ctx.bits.spawn(x + rnd(-R, R) * 0.8, y + rnd(-R, R) * 0.45, { frames: Ts('star', () => STAR).slice(0, 3), fps: 10, loop: false, life: 0.3, fadeOut: 0.12 });
      if (it > FREEZE + HOLDI && it - dt <= FREEZE + HOLDI) {
        const chips = Ts('chips', () => ICE_CHIPS);
        // 冰面碎开：冰片崩起一点就落回冰面上（不溅出水域）
        for (let i = 0; i < 16; i++) {
          const ax = x + rnd(-R, R) * 0.7;
          const ay = y + rnd(-R, R) * 0.4;
          ctx.bits.spawn(ax, ay, { frames: [chips[i % chips.length]], life: rnd(0.4, 0.7), vx: rnd(-22, 22), vy: -rnd(30, 70), g: 260, ground: ay + rnd(0, 4), bounce: 0.3, fadeOut: 0.25 });
        }
        ctx.sound('hanbing.spike', 0.5);
      }
      if (it > FREEZE + HOLDI + BREAK) {
        this.ice.destroy();
        this.ice = null;
      }
    }
    const OUT = 0.45;
    // 寒潭：水不退，整片原地冻上（冰面盖上来之后，下面的水很快淡掉）
    const keep = this.deep && this.gone < 0;
    const a = this.gone >= 0 ? Math.max(0, 1 - this.gone / (this.ice ? 0.3 : OUT)) : clamp01(z.t / 0.2) * (keep ? 1 : clamp01((z.life - z.t) / 0.5 + 0.35));
    if (this.gone > OUT + 0.05 && !this.ice) return false;
    // 水从中心铺开、收尾时往中心退
    const spread = clamp01((z.t - 0.12) / 0.38);
    const ebb = this.gone >= 0 ? (this.ice ? 1 : 1 - clamp01(this.gone / OUT)) : keep ? 1 : clamp01((z.life - z.t) / 0.5);
    const k = Math.min(spread, ebb);
    const ri = Math.max(0, Math.min(4, Math.ceil(k * 5) - 1));
    const full = ri >= 4;
    this.body.texture = this.bodyFr[ri];
    this.body.position.set(x, y);
    this.body.alpha = 0.5 * a * clamp01(k * 3);
    this.detail.texture = full ? this.detailFr[Math.floor(this.t * 7) % this.detailFr.length] : this.revealFr[ri];
    this.detail.position.set(x, y);
    this.detail.alpha = 0.9 * a * clamp01(k * 3);
    if (this.swirl) {
      this.swirl.texture = this.vortexFr[Math.floor(this.t * 9) % this.vortexFr.length];
      this.swirl.position.set(x, y);
      this.swirl.alpha = 0.85 * a * clamp01((z.t - 0.4) / 0.4);
      // 气泡：被卷着吸进中心
      if (Math.random() < 0.5 * a) {
        const ang = rnd(0, TAU);
        const rr = R * rnd(0.4, 0.85);
        ctx.bits.spawn(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.62, { frames: [T('bubble', () => ({ w: 1, h: 1, rows: ['W'] }))], life: 0.7, vx: (-Math.cos(ang) * rr) / 0.7 + Math.sin(ang) * 20, vy: (-Math.sin(ang) * rr * 0.62) / 0.7 - Math.cos(ang) * 8, fadeIn: 0.1, fadeOut: 0.3, layer: ctx.floor });
      }
    }
    // 控水旗：从水里升起来，飘着；收尾时沉下去
    const rise = easeOut(clamp01((z.t - 0.15) / 0.45));
    const sink = this.gone >= 0 ? easeIn(clamp01(this.gone / OUT)) : keep ? 0 : easeIn(clamp01(1 - (z.life - z.t) / 0.5));
    this.flag.texture = Ts('wflag', () => waterFlagFrames(8))[Math.floor(this.t * 9) % 8];
    this.flag.position.set(Math.round(this.fx), Math.round(this.fy + (1 - rise) * 18 + sink * 16));
    this.flag.zIndex = this.fy;
    this.flag.alpha = Math.min(rise * 1.5, 1 - sink);
    // 站在水里的敌人：脚下不时溅起水花
    if (full && this.gone < 0)
      for (const e of enemies) {
        const ex = e.px + (e.x - e.px) * alpha;
        const ey = e.py + (e.y - e.py) * alpha;
        if (((ex - z.x) / R) ** 2 + ((ey - z.y) / (R * 0.75)) ** 2 > 1) continue;
        const cd = (this.splashCd.get(e.id) ?? rnd(0, 0.3)) - dt;
        if (cd > 0) {
          this.splashCd.set(e.id, cd);
          continue;
        }
        this.splashCd.set(e.id, rnd(0.3, 0.5) * (this.flood ? 0.7 : 1));
        ctx.bits.spawn(ex + rnd(-3, 3), ey + 1, { frames: Ts('splash', () => SPLASH), fps: 10, loop: false, life: 0.4, fadeOut: 0.12, z: true, zOff: 0.5 });
      }
    // 水淹：浪头往外推（一道道白色的弧）
    if (this.flood && this.gone < 0 && full) {
      this.crestCd -= dt;
      if (this.crestCd <= 0) {
        this.crestCd = 0.45;
        this.crests.push({ r: R * 0.2, a0: rnd(0, TAU) });
      }
    }
    for (let i = this.crests.length - 1; i >= 0; i--) {
      const c = this.crests[i];
      c.r += dt * R * 0.8;
      if (c.r > R * 0.95) {
        this.crests.splice(i, 1);
        continue;
      }
      const k2 = c.r / R;
      for (let j = 0; j < 3; j++) arc(ctx.under, x, y, c.r, c.r * 0.62, c.a0 + (j / 3) * TAU, c.a0 + (j / 3) * TAU + 1.1, C.W, a * 0.8 * (1 - k2));
    }
    // 寒潭：岸边慢慢结霜
    if (this.deep && this.gone < 0 && full) {
      this.frostCd -= dt;
      const rate = 0.25 - 0.18 * clamp01(z.t / z.life);
      if (this.frostCd <= 0) {
        this.frostCd = rate;
        const ang = rnd(0, TAU);
        ctx.bits.spawn(x + Math.cos(ang) * R * 0.92, y + Math.sin(ang) * R * 0.62 * 0.92, { frames: [Ts('snow', () => SNOWFLAKE)[Math.random() < 0.6 ? 0 : 1]], life: rnd(0.9, 1.4), layer: ctx.floor, fadeIn: 0.2, fadeOut: 0.4 });
      }
    }
    return true;
  }
  destroy() {
    this.body.destroy();
    this.detail.destroy();
    this.swirl?.destroy();
    this.flag.destroy();
    this.ice?.destroy();
  }
}

// ================================================================ 五火七禽扇

/**
 * 一道火浪：扇面最前沿一道弯弯的火线（外沿缃黄最亮、往里橘、朱砂、朱），火线推到哪儿，地上就窜起一排火苗
 * （扇子跟前的高、推远了矮），火线推到头之后火苗慢慢烧完。灵品扇面更宽、更远、火苗更大；焚风的火更白、更烫。
 * 火线离人物脚下 WAVE_NEAR 像素以外才画（往外 8 像素显出来），第一排火苗从 24 像素起：五火一圈五道从人物脚下推出去，
 * 原来火线从 12 像素起就画、压在人物腿上，转整圈那一下人物身上一团火色。火苗往外飘的那一点不飘出火浪推到的最远处。
 */
const WAVE_NEAR = 18;
class WaveView {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private rowR = 0;
  private hot: boolean;
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    this.hot = z.spirit === 'gale';
    void ctx;
  }
  update(dt: number, ctx: Ctx, live: Zone | null): boolean {
    this.t += dt;
    if (live) this.z = { ...live };
    else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const z = this.z;
    const len = z.len ?? 90;
    const R = Math.min(len, z.r);
    const a0 = z.a ?? 0;
    // 五火：一圈五道，每道的火线和火苗收窄一点，五道之间留出缝（看得出是五道火浪，不连成一个圈）
    const arcW = (z.arc ?? 0.5) * (z.spirit === 'five' ? 0.8 : 1);
    const pushing = R < len - 0.5 && this.gone < 0;
    // 火线：推的时候亮，推到头以后很快熄掉
    const lineA = pushing ? 1 : Math.max(0, 1 - (this.gone >= 0 ? this.gone + 0.15 : this.t - len / 230) / 0.18);
    const lineIn = clamp01((R - WAVE_NEAR) / 8);
    if (lineA > 0 && lineIn > 0) {
      const n = Math.ceil(arcW * 2 * R * 1.3);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const ang = a0 - arcW + arcW * 2 * u;
        const edge = Math.sin(Math.PI * u) ** 0.5; // 两头收
        const depth = 1.5 + 3.5 * edge;
        for (let d = 0; d <= depth; d += 0.7) {
          const q = d / depth;
          const col = q < 0.2 ? (this.hot ? C.W : C.f) : q < 0.45 ? C.Y : q < 0.7 ? C.o : q < 0.88 ? C.e : C.r;
          ctx.under.dot(z.x + Math.cos(ang) * (R - d), z.y + 6 + Math.sin(ang) * (R - d) * 0.8, col, lineA * lineIn * (0.5 + 0.5 * edge));
        }
      }
    }
    // 火苗：火线每推进几像素，沿着火线窜起一排（扇子跟前高、远了矮；焚风更旺）
    const five = z.spirit === 'five';
    const STEP = five ? 11 : 9;
    while (this.rowR + STEP <= R) {
      this.rowR += STEP;
      const rr = this.rowR;
      if (rr < 24) continue; // 第一排火苗别窜在人物身上（五火一圈时会把人整个围住、盖住；人物后面的火苗还会从头顶冒出来）
      const far = rr / len;
      const n = Math.max(2, Math.round((arcW * 2 * rr) / (five ? 11 : 9)));
      for (let i = 0; i < n; i++) {
        const ang = a0 - arcW * 0.92 + (arcW * 1.84 * (i + rnd(0.2, 0.8))) / n;
        const fx = z.x + Math.cos(ang) * rr;
        const fy = z.y + 6 + Math.sin(ang) * rr * 0.8;
        // 正落在人物身后的火苗不窜：人物挡不住，火舌会从头顶冒出来（五火往上那一道）
        if (Math.abs(fx - z.x) < 12 && fy > z.y + 6 - 36 && fy < z.y + 6) continue;
        const big = z.tier >= 2 || this.hot;
        const sizes = far < 0.45 ? (big ? [2, 4, 5, 4, 2, 1] : [1, 3, 4, 3, 1]) : far < 0.8 ? (big ? [1, 3, 4, 3, 1] : [1, 2, 3, 2, 1]) : [0, 2, 2, 1, 0];
        // 顺着火浪往外飘一点（飘 v / 2.5 像素）：最多飘到火浪推到的最远处
        const drift = Math.min(12, Math.max(0, len - rr - 2)) * 2.5;
        ctx.bits.spawn(fx, fy, { sizes, fps: rnd(10, 14), life: rnd(0.45, 0.7), vx: Math.cos(ang) * drift, vy: Math.sin(ang) * drift * 0.66 - 6, drag: 2.5, z: true, fadeIn: 0.04, fadeOut: 0.28 });
        if (Math.random() < 0.3) ctx.sparks.emit(fx, fy - 4, 1, FIRE_SPARKS, [10, 30], [0.4, 0.8], { up: 24, drag: 1.5 });
      }
    }
    return this.gone < 0 || this.gone < 0.1;
  }
  destroy() {}
}

/**
 * 扇子的一扇：火色羽扇从人手里扫过扇面（五火是转一整圈），扫完停一下再淡去；扇过的地方飘几片火星。
 * 扇子放在人物那一层、按前后排：转到人物身后（画面上偏上）时被人物挡住，不整个盖在人物身上（五火转整圈那一下原来一直压在人物身上）。
 */
class FanSwing implements Effect {
  private t = 0;
  private s = new Sprite();
  private owner: () => [number, number] | null;
  private a: number;
  private arc: number;
  private spin: boolean;
  private hot: boolean;
  constructor(ctx: Ctx, owner: () => [number, number] | null, a: number, arc: number, spin: boolean, hot: boolean) {
    this.owner = owner;
    this.a = a;
    this.arc = arc;
    this.spin = spin;
    this.hot = hot;
    this.s.visible = false;
    ctx.stage.entities.addChild(this.s);
    ctx.sound('wuhuo.fan');
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const t = this.t;
    const SW = this.spin ? 0.34 : 0.16;
    const LIFE = SW + 0.32;
    const p = this.owner();
    if (!p) return t < LIFE;
    const k = easeOut(t / SW);
    const from = this.spin ? this.a - 0.4 : this.a - this.arc - 0.35;
    const to = this.spin ? this.a + TAU - 0.4 : this.a + this.arc + 0.35;
    const ang = from + (to - from) * k;
    applyRot(this.s, rotTex(this.hot ? 'fanH' : 'fan', FAN, ang, FAN_PIVOT.x, FAN_PIVOT.y, 32, undefined, true));
    this.s.position.set(Math.round(p[0] + Math.cos(ang) * 6), Math.round(p[1] - 8 + Math.sin(ang) * 4));
    this.s.zIndex = p[1] + (Math.sin(ang) > -0.25 ? 0.5 : -0.5);
    this.s.alpha = fade(t, LIFE, 0.04, 0.25);
    this.s.tint = this.hot ? 0xfff2d8 : 0xffffff;
    this.s.visible = true;
    if (t < SW && Math.random() < 0.8) {
      const ex = p[0] + Math.cos(ang) * 14;
      const ey = p[1] - 8 + Math.sin(ang) * 11;
      ctx.sparks.emit(ex, ey, 1, FIRE_SPARKS, [10, 30], [0.3, 0.6], { dir: ang, spread: 1, drag: 2 });
    }
    return t < LIFE;
  }
  destroy() {
    this.s.destroy();
  }
}

/**
 * 七禽火鸟：一只扇着翅膀的小火鸟（13×11，四帧扇翅、只左右镜像加一点俯仰），身后拖一道短短的火尾、一路落下火星；
 * 扑中敌人（或者到时）化成一团火散开。
 * 离人物胸口 BIRD_HIDE 像素以内整只（连火尾、火星）不画，再往外 BIRD_FADE 像素慢慢显出来：七只从人物身上一起飞出、
 * 或者绕回来扑人物另一边的敌人时，不在人物身上糊成一团火（原来按离出生处量，绕回来的照样盖在人物身上；出生处还溅火星）。
 */
const BIRD_HIDE = 14;
const BIRD_FADE = 10;
class BirdView {
  private s = new Sprite();
  private t = rnd(0, 1);
  private hist: [number, number, number][] = [];
  private stroke = new Stroke();
  private last: [number, number] = [0, 0];
  private gone = -1;
  private emberCd = 0;
  private shown = false;
  private owner: () => [number, number] | null;
  constructor(ctx: Ctx, x: number, y: number, owner: () => [number, number] | null) {
    ctx.layer.addChild(this.s);
    this.last = [x, y];
    this.owner = owner;
    void ctx;
  }
  update(dt: number, ctx: Ctx, k: { x: number; y: number; vx: number; vy: number } | null): boolean {
    this.t += dt;
    if (!k) {
      if (this.gone < 0) {
        this.gone = 0;
        const [x, y] = this.last;
        // 化成一团火散开（火鸟小了，火团也小一些）；散在人物身边的不画
        const h = this.owner();
        if (!h || Math.hypot(x - h[0], y - h[1]) > BIRD_HIDE + BIRD_FADE * 0.5) {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU;
            ctx.bits.spawn(x, y + 3, { sizes: [1, 2, 2, 1, 0], fps: 12, life: rnd(0.4, 0.55), vx: Math.cos(a) * 20, vy: Math.sin(a) * 12 - 5, drag: 4, fadeOut: 0.2 });
          }
          ctx.sparks.emit(x, y, 7, FIRE_SPARKS, [20, 50], [0.25, 0.45], { drag: 3 });
        }
        this.s.visible = false;
      }
      this.gone += dt;
      return this.gone < 0.05;
    }
    const tilt = Math.max(-0.5, Math.min(0.5, Math.atan2(k.vy, Math.abs(k.vx) + 1e-3)));
    const ang = k.vx >= 0 ? tilt : Math.PI - tilt;
    const f = Math.floor(this.t * 12) % 4;
    applyRot(this.s, rotTex(`birdS${f}`, FIREBIRD[f], ang, FIREBIRD_PIVOT.x, FIREBIRD_PIVOT.y, 32, undefined, true));
    this.s.position.set(Math.round(k.x), Math.round(k.y));
    // 离人物胸口近的时候不画（见 BIRD_HIDE）
    const h = this.owner();
    const near = h ? clamp01((Math.hypot(k.x - h[0], k.y - h[1]) - BIRD_HIDE) / BIRD_FADE) : 1;
    this.s.alpha = clamp01(this.t / 0.08 + 0.3) * near;
    this.s.visible = near > 0;
    this.last = [k.x, k.y];
    if (!this.shown && near > 0.5) {
      // 显出来的那一下溅两粒火星（原来在人物身上溅）
      this.shown = true;
      ctx.sparks.emit(k.x, k.y, 2, FIRE_SPARKS, [15, 35], [0.2, 0.35], { drag: 3 });
    }
    // 火尾：短短一截（火鸟小了，尾巴也短）
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    this.hist.unshift([k.x - ux * 5, k.y - uy * 5 + 1, this.t]);
    while (this.hist.length > 2 && this.t - this.hist[this.hist.length - 1][2] > 0.1) this.hist.pop();
    // 火尾里还在人物胸口 BIRD_HIDE 以内的那几个点不画（刚飞出来时尾巴拖在人物身上）
    const tail = this.hist.filter((p) => !h || Math.hypot(p[0] - h[0], p[1] - h[1]) > BIRD_HIDE).map((p) => [p[0], p[1]] as [number, number]);
    if (tail.length > 1 && near > 0) {
      polyStreak(this.stroke, tail, 1.1, 0.85 * near, [C.f, C.Y, C.o, C.r]);
      this.stroke.commit(ctx.top);
    }
    this.emberCd -= dt;
    if (this.emberCd <= 0 && near > 0.5) {
      this.emberCd = 0.06;
      if (Math.random() < 0.5) ctx.bits.spawn(k.x - ux * 6, k.y - uy * 6 + 2, { sizes: [0, 1, 0], fps: 12, life: rnd(0.25, 0.4), vy: -rnd(6, 12), fadeOut: 0.15 });
      else ctx.sparks.emit(k.x - ux * 6, k.y - uy * 6, 1, FIRE_SPARKS, [5, 15], [0.3, 0.5], { up: 10, drag: 2 });
    }
    return true;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 焚风的焦土：一道烧黑的地（顺着火浪的中线），上面零星窜着小火苗、冒着烟，慢慢冷下去。 */
class ScorchView {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private decal: Sprite;
  private tex: Texture;
  private slots: { u: number; cd: number }[] = [];
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    const d = scorchDecal(z.x, z.y, z.x2, z.y2, z.r, z.id % 7);
    this.tex = textureFromGrid(d.g);
    this.decal = new Sprite(this.tex);
    this.decal.position.set(Math.round(d.ox), Math.round(d.oy));
    this.decal.alpha = 0;
    ctx.floor.addChild(this.decal);
    const len = Math.hypot(z.x2 - z.x, z.y2 - z.y);
    const n = Math.max(3, Math.round(len / 11));
    for (let i = 0; i < n; i++) this.slots.push({ u: (i + rnd(0.2, 0.8)) / n, cd: rnd(0, 0.4) });
    ctx.sound('wuhuo.scorch', 0.8, 0.2);
  }
  update(dt: number, ctx: Ctx, live: Zone | null): boolean {
    this.t += dt;
    if (live) this.z = { ...live };
    else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const z = this.z;
    const a = this.gone >= 0 ? Math.max(0, 1 - this.gone / 0.4) * fade(z.t, z.life, 0.15, 0.9) : fade(z.t, z.life, 0.15, 0.9);
    if (this.gone > 0.45) return false;
    this.decal.alpha = 0.85 * a;
    if (a > 0.1)
      for (const s of this.slots) {
        s.cd -= dt;
        if (s.cd > 0) continue;
        s.cd = rnd(0.35, 0.7);
        const fx = lerp(z.x, z.x2, s.u) + rnd(-3, 3);
        const fy = lerp(z.y, z.y2, s.u) + rnd(-2, 2);
        if (Math.random() < 0.6) ctx.bits.spawn(fx, fy, { sizes: a > 0.6 ? pick([[0, 1, 2, 1, 0], [0, 1, 1, 0]]) : [0, 1, 0], fps: rnd(9, 13), life: rnd(0.4, 0.7), vy: -rnd(3, 7), z: true, fadeIn: 0.05, fadeOut: 0.25, alpha: Math.min(1, a * 1.3) });
        else ctx.bits.spawn(fx, fy - 4, { frames: puffSet(3, 'smoke', 1 + Math.floor(rnd(0, 3))), life: rnd(0.7, 1), vy: -rnd(8, 14), vx: rnd(-3, 3), alpha: 0.45 * a, fadeIn: 0.15, fadeOut: 0.4 });
      }
    return true;
  }
  destroy() {
    this.decal.destroy();
    this.tex.destroy(true);
  }
}

// ================================================================ 捆仙绳

/** 金绳的配色：受光、身、背光、深边。 */
const ROPE: Cols = [C.Y, C.y, C.b, C.B];
const ROPE_DARK: Cols = [C.f, C.Y, C.y, C.B];

/**
 * 捆仙绳：一条金绳从哪吒手里射出去，绳头（困龙是一只小金龙头）一只一只穿过去，穿到谁身上就在谁身上缠两道、打一个金结；
 * 穿过捆不住的精英 / 首领时抽一下、迸出金星。射完之后手里那一截收回去，只剩一条把这一串连在一起的金绳（垂着一点弧），
 * 金绳拧着两股、走着金光；仙品「缚仙」绳子绷直、把它们往一起拽，撞到一起时迸出金星和尘土；「连环」每个绳结上套一枚小金环。
 * 到时绳结松开、金绳化成金屑落下。
 */
class RopeView {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private path: { id: number; held: boolean }[];
  private pathPts: [number, number][]; // 每只最后的脚底位置（死了就停在这里）
  private passed = 0;
  private stroke = new Stroke();
  private head = new Sprite();
  private knots = new Map<number, { s: Sprite; ring: Sprite | null; t0: number }>();
  private dragon: boolean;
  private chainy: boolean;
  private bound = false;
  private from: () => [number, number] | null;
  constructor(ctx: Ctx, z: Zone, hits: { id: number; x: number; y: number }[], from: () => [number, number] | null) {
    this.from = from;
    this.z = { ...z };
    this.dragon = z.spirit === 'dragon';
    this.chainy = z.spirit === 'chain';
    const held = new Set(z.ids ?? []);
    // 绳子穿过的顺序：这一帧被绳子抽到的敌人（按命中顺序）；没收到就按捆住的顺序
    const seen = new Set<number>();
    this.path = [];
    for (const h of hits)
      if (!seen.has(h.id)) {
        seen.add(h.id);
        this.path.push({ id: h.id, held: held.has(h.id) });
      }
    for (const id of z.ids ?? []) if (!seen.has(id)) this.path.push({ id, held: true });
    this.pathPts = this.path.map((p) => {
      const h = hits.find((q) => q.id === p.id);
      return h ? [h.x, h.y] : [z.x, z.y];
    });
    this.head.anchor.set(0.5);
    this.head.visible = false;
    ctx.layer.addChild(this.head);
    ctx.sound('kunxian.throw', 1, 0.1);
  }
  /** 绳子在这一只身上系的地方：捆住的是胸口那道缠绳正面的绳结；捆不住的（被抽一下的精英 / 首领）是身子中间。 */
  private anchorOf(ctx: Ctx, i: number, hand: [number, number] | null): [number, number] {
    const pp = this.path[i];
    const p = ctx.enemyPos(pp.id);
    if (p) this.pathPts[i] = p;
    const [x, y] = this.pathPts[i];
    const kind = ctx.enemy(pp.id)?.kind ?? 'soldier';
    if (!pp.held) return [x, y - headOf(kind) * 0.45];
    const look = wrapLook(kind);
    const facing = hand && hand[0] >= x ? 1 : -1;
    const b = look.bands[look.knot];
    return [x + (look.cx + look.knotDx) * facing, y + b.y + b.ry + 1];
  }
  clash(ctx: Ctx, id: number) {
    const p = ctx.enemyPos(id);
    if (!p) return;
    const hd = headOf(ctx.enemy(id)?.kind);
    const x = p[0];
    const y = p[1] - hd * 0.45;
    ctx.bits.spawn(x + rnd(-3, 3), y + rnd(-3, 3), { frames: Ts('star', () => STAR).slice(1, 4), fps: 14, loop: false, life: 0.26, fadeOut: 0.12 });
    ctx.sparks.emit(x, y, 8, GOLD_SPARKS, [30, 80], [0.25, 0.5], { drag: 3, g: 100 });
    ctx.bits.spawn(x, p[1], { frames: puffSet(4, 'stone', 1 + Math.floor(rnd(0, 3))), life: 0.5, vy: -6, fadeOut: 0.25, z: true, alpha: 0.8 });
    ctx.shake.add(0.04);
    ctx.sound('kunxian.clash', 0.8, 0.08);
  }
  update(dt: number, ctx: Ctx, live: Zone | null): boolean {
    this.t += dt;
    if (live) this.z = { ...live };
    else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const z = this.z;
    const OUT = 0.35;
    if (this.gone > OUT + 0.05) return false;
    const a = this.gone >= 0 ? 1 - this.gone / OUT : fade(z.t, z.life, 0.02, 0.35);
    const hand = this.from();
    const pts = this.path.map((_, i) => this.anchorOf(ctx, i, hand));
    // 射出：绳头沿着「手 → 第一只 → 第二只 ……」走，0.24 秒走完（途中抽一下捆不住的精英 / 首领）；
    // 射完之后只剩捆住的那几只连在一起，手里那一截收回去
    const THROW = 0.24;
    const off = hand ? 1 : 0;
    const throwing = this.t < THROW + 0.02;
    const keep = throwing ? pts : pts.filter((_, i) => this.path[i].held);
    const line: [number, number][] = hand ? [[hand[0], hand[1]], ...keep] : keep;
    let total = 0;
    for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const reach = throwing ? total * easeOut(clamp01(this.t / THROW)) : total;
    const ret = hand ? clamp01((this.t - THROW) / 0.18) : 1;
    const firstLen = hand && keep.length ? Math.hypot(keep[0][0] - hand[0], keep[0][1] - hand[1]) : 0;
    const start = throwing ? 0 : firstLen * easeIn(ret);
    // 绳子：画从 start 到 reach 这一段（捆住的两只之间垂着一点弧；缚仙绷直）
    const taut = z.pull ? clamp01((this.t - THROW) / 0.25) : 0;
    const drawn: [number, number][] = [];
    let sAcc = 0;
    let tip: [number, number] | null = null;
    let tipAng = 0;
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1];
      const [x1, y1] = line[i];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const sag = (i === 1 && hand) || throwing ? 0 : Math.min(9, L * 0.16) * (1 - taut) * clamp01((this.t - THROW) / 0.15);
      const n = Math.max(2, Math.ceil(L / 3));
      for (let j = 0; j <= n; j++) {
        const u = j / n;
        const ss = sAcc + L * u;
        if (ss < start || ss > reach) continue;
        const wob = taut > 0 && taut < 1 ? Math.sin(this.t * 40 + ss * 0.3) * 0.6 * (1 - taut) : 0;
        const px = lerp(x0, x1, u);
        const py = lerp(y0, y1, u) + sag * 4 * u * (1 - u) + wob;
        drawn.push([px, py]);
        tip = [px, py];
        tipAng = Math.atan2(y1 - y0, x1 - x0);
      }
      sAcc += L;
      // 绳头穿过这一只：缠上（捆住的）或者抽一下（捆不住的）
      const idx = i - off;
      if (throwing && sAcc <= reach && idx >= this.passed && idx >= 0 && idx < this.path.length) {
        this.passed = idx + 1;
        const p = this.path[idx];
        if (p.held) {
          this.knot(ctx, p.id);
          if (!this.bound) {
            this.bound = true;
            ctx.sound('kunxian.bind', 0.9, 0.1);
          }
        } else {
          const [bx, by] = pts[idx];
          ctx.bits.spawn(bx, by, { frames: Ts('star', () => STAR).slice(1, 4), fps: 14, loop: false, life: 0.25, fadeOut: 0.12 });
          ctx.sparks.emit(bx, by, 7, GOLD_SPARKS, [30, 80], [0.2, 0.45], { drag: 3 });
        }
      }
    }
    // 射得太快、这一帧跳过去的：补上绳结
    if (!throwing) for (const p of this.path) if (p.held) this.knot(ctx, p.id);
    // 身上缠的两道金绳（先画，绳子压在上面）
    for (const [id, k] of this.knots) {
      const idx = this.path.findIndex((p) => p.id === id);
      const kind = ctx.enemy(id)?.kind ?? 'soldier';
      const look = wrapLook(kind);
      const [bx, by] = this.pathPts[idx];
      const facing = hand && hand[0] >= bx ? 1 : -1;
      const wt = clamp01((this.t - k.t0) / 0.16);
      this.coil(bx, by, look, facing, wt, a);
      const kp = pts[idx];
      k.s.position.set(Math.round(kp[0]), Math.round(kp[1]));
      k.s.alpha = a * wt;
      if (k.ring) {
        k.ring.position.set(Math.round(kp[0] + 1), Math.round(kp[1] + 4));
        k.ring.alpha = a * wt;
      }
    }
    if (drawn.length > 1) {
      // 两股拧在一起的金绳：身子按「拧」的相位换亮暗，两边一像素深边
      walk(drawn, 0.7, (x, y, nx, ny, ss) => {
        for (let o = -1.6; o <= 1.6; o += 0.5) {
          const edge = Math.abs(o) > 1.05;
          const twist = Math.floor((ss * 0.55 + o * 0.9 + this.t * 6) / 1.1) % 2 === 0;
          const c = edge ? (this.dragon ? C.R : C.B) : twist ? (o < 0 ? ROPE_DARK[0] : ROPE_DARK[1]) : ROPE[2];
          this.stroke.dot(x + nx * o, y + ny * o, c, a, edge ? 1 : twist && o < 0 ? 3 : 2);
        }
      });
      // 金光沿着绳子走
      if (Math.random() < 0.4 * a) {
        const q = drawn[Math.floor(Math.random() * drawn.length)];
        ctx.glows.emit(q[0], q[1], 1, GOLD_SPARKS, [4, 12], [0.25, 0.45], { drag: 3 });
      }
    }
    this.stroke.commit(ctx.top);
    // 绳头：射出时在最前面（困龙是小金龙头）
    if (tip && this.t < THROW + 0.02) {
      const g = this.dragon ? ROPE_DRAGON : ROPE_KNOT;
      applyRot(this.head, rotTex(this.dragon ? 'ropedragon' : 'ropeknot', g, tipAng, this.dragon ? ROPE_DRAGON_PIVOT.x : 2, this.dragon ? ROPE_DRAGON_PIVOT.y : 2, 16, undefined, true));
      this.head.position.set(Math.round(tip[0]), Math.round(tip[1]));
      this.head.alpha = a;
      this.head.visible = true;
    } else this.head.visible = false;
    // 到时：金绳化成金屑落下
    if (this.gone >= 0 && this.gone - dt <= 0)
      for (const q of drawn.filter((_, i) => i % 4 === 0)) ctx.sparks.emit(q[0], q[1], 1, GOLD_SPARKS, [5, 20], [0.4, 0.7], { g: 60, drag: 1 });
    return true;
  }
  private knot(ctx: Ctx, id: number) {
    if (this.knots.has(id)) return;
    const s = new Sprite(T('ropeknot', () => ROPE_KNOT));
    s.anchor.set(0.5);
    s.alpha = 0;
    ctx.layer.addChild(s);
    let ring: Sprite | null = null;
    if (this.chainy) {
      ring = new Sprite(T('ropering', () => ROPE_RING));
      ring.anchor.set(0.5);
      ring.alpha = 0;
      ctx.layer.addChild(ring);
    }
    this.knots.set(id, { s, ring, t0: this.t });
    const p = ctx.enemyPos(id);
    if (p) ctx.sparks.emit(p[0], p[1] - 10, 4, GOLD_SPARKS, [15, 40], [0.2, 0.4], { drag: 3 });
  }
  /**
   * 身上缠的金绳：照着混天绫的缠法（wrapLook）取前两道，只画前半圈（后半圈在身子后面看不见），缠上来时从一侧绕过去；
   * 每道是两像素的金绳、上下各一像素深边，和身子分得开。
   */
  private coil(x: number, y: number, look: WrapLook, facing: number, wt: number, a: number) {
    const st = this.stroke;
    look.bands.slice(0, 2).forEach((b, bi) => {
      const cx = x + look.cx * facing;
      const cy = y + b.y;
      const span = Math.PI * wt;
      const rx = b.rx + 1;
      const n = Math.ceil(rx * 3.4);
      for (let i = 0; i <= n; i++) {
        const ang = (i / n) * span;
        const px = cx + Math.cos(ang) * rx * facing;
        const py = cy + Math.sin(ang) * (b.ry + 0.8) - Math.cos(ang) * b.tilt * rx * facing * 0.5;
        const twist = (i + bi) % 3 === 0;
        st.dot(px, py - 1, C.B, a, 1);
        st.dot(px, py, twist ? C.f : C.Y, a, 3);
        st.dot(px, py + 1, twist ? C.Y : C.y, a, 2);
        st.dot(px, py + 2, C.B, a, 1);
      }
    });
  }
  destroy() {
    this.head.destroy();
    for (const k of this.knots.values()) {
      k.s.destroy();
      k.ring?.destroy();
    }
  }
}

// ================================================================ 对外

/** 这里画的持续效果（其余种类 fx.ts 画）。 */
const NEW_ZONES = new Set<ZoneKind>(['whirl', 'lotus', 'beam', 'water', 'flameWave', 'scorch', 'rope']);

type ZoneFx =
  | { kind: 'whirl'; v: WhirlView }
  | { kind: 'lotus'; v: LotusView }
  | { kind: 'beam'; v: BeamView }
  | { kind: 'water'; v: PoolView }
  | { kind: 'flameWave'; v: WaveView }
  | { kind: 'scorch'; v: ScorchView }
  | { kind: 'rope'; v: RopeView };

/** 给效果对象用的上下文：在 fx.ts 的 Ctx 上多一个「放一个效果」。 */
type ACtx = Ctx & { add(e: Effect): void };

export class ArtifactFx {
  private ctx: ACtx;
  private effects: Effect[] = [];
  private lashes = new Map<number, LashView>();
  private zones = new Map<number, ZoneFx>();
  private birds = new Map<number, BirdView>();
  private bits: Bits;
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private floor = new Container();
  private stage: Stage;
  private sfx: Sfx;
  private time = 0;
  private alpha = 1;
  private byId = new Map<number, Enemy>();
  private ixTick = -1;
  private lastSound = new Map<string, number>();
  private world: World | null = null;
  /** 这一帧被捆仙绳抽到的敌人（按命中顺序）：射出的那一帧用来排绳子的路线，之后的算「缚仙」互撞。 */
  private ropeHits: { id: number; x: number; y: number }[] = [];
  private lastLash = -1;
  private fanAt = new Map<number, number>();
  private slashN = 0;

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
      add: (e) => void self.effects.push(e),
    };
  }

  /** 清空（重开一局、一波开始 / 结束时）。 */
  clear() {
    for (const e of this.effects) e.destroy();
    this.effects = [];
    for (const v of this.lashes.values()) v.destroy();
    this.lashes.clear();
    for (const z of this.zones.values()) z.v.destroy();
    this.zones.clear();
    for (const b of this.birds.values()) b.destroy();
    this.birds.clear();
    this.ropeHits = [];
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

  private playerAt(w: World, owner: number, dy = 0): () => [number, number] | null {
    return () => {
      const p = w.players[owner];
      if (!p) return null;
      return [p.px + (p.x - p.px) * this.alpha, p.py + (p.y - p.py) * this.alpha + dy];
    };
  }

  private gear(w: World, owner: number | undefined, kind: WeaponKind, tier?: number): Gear {
    const p = w.players[owner ?? 0] ?? w.players[0];
    const wp = p?.weapons.find((x) => x.kind === kind);
    const t = Math.max(1, Math.min(4, tier ?? wp?.tier ?? 1));
    return { tier: t, spirit: t >= 4 ? (wp?.spirit ?? null) : null };
  }

  private indexEnemies(w: World) {
    if (this.ixTick === w.tick && this.byId.size === w.enemies.length) return;
    this.byId.clear();
    for (const e of w.enemies) this.byId.set(e.id, e);
    this.ixTick = w.tick;
  }

  private add<T extends Effect>(e: T): T {
    this.effects.push(e);
    return e;
  }

  private zoneFx(z: Zone, w: World): ZoneFx | null {
    const ctx = this.ctx;
    switch (z.kind) {
      case 'whirl':
        return { kind: 'whirl', v: new WhirlView(ctx, z, this.playerAt(w, z.owner)) };
      case 'lotus':
        return { kind: 'lotus', v: new LotusView(ctx, z, this.playerAt(w, z.owner, -12)) };
      case 'beam':
        return { kind: 'beam', v: new BeamView(ctx, z) };
      case 'water':
        return { kind: 'water', v: new PoolView(ctx, z) };
      case 'flameWave': {
        // 同一帧放出的几道火浪（五火）只挥一次扇子
        const last = this.fanAt.get(z.owner) ?? -1;
        if (this.time - last > 0.05) {
          this.fanAt.set(z.owner, this.time);
          const five = z.spirit === 'five';
          this.add(new FanSwing(ctx, this.playerAt(w, z.owner), z.a ?? 0, z.arc ?? 0.5, five, z.spirit === 'gale'));
        }
        return { kind: 'flameWave', v: new WaveView(ctx, z) };
      }
      case 'scorch':
        return { kind: 'scorch', v: new ScorchView(ctx, z) };
      case 'rope': {
        const hits = this.ropeHits;
        this.ropeHits = [];
        return { kind: 'rope', v: new RopeView(ctx, z, hits, this.playerAt(w, z.owner, -12)) };
      }
      default:
        return null;
    }
  }

  onEvent(e: SimEvent, w: World) {
    if (w !== this.world) {
      this.clear();
      this.world = w;
    }
    const ctx = this.ctx;
    this.indexEnemies(w);
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'warn': {
        if (e.kind !== 'lash') break;
        const q = w.pending.find((x) => x.id === e.id);
        const owner = q?.owner ?? 0;
        const g = this.gear(w, owner, 'dashen', e.tier ?? q?.tier);
        const seq = q?.seq ?? 1;
        const spirit = q?.spirit ?? g.spirit;
        // 九节：同一个目标的第二、三鞭是同一条鞭子再抽；灵品身边只有一只时，两鞭都抽它 —— 也是同一朵云里的鞭子再抽一下
        const tgt = q?.target ?? -1;
        if (tgt >= 0 && (seq > 1 || spirit !== 'nine')) {
          const prev = [...this.lashes.values()].reverse().find((v) => v.target === tgt && v.pending);
          if (prev) {
            prev.addStrike(e.id, e.t2, seq);
            break;
          }
        }
        const info: LashInfo = { id: e.id, target: q?.target ?? -1, tier: g.tier, spirit, seq, t2: e.t2, len: q?.len ?? 46, ring: q?.ring ?? 0 };
        this.lashes.set(e.id, new LashView(ctx, info, e.x, e.y, this.playerAt(w, owner)));
        if (seq === 1) this.sound('dashen.fall', 0.8, 0.1);
        break;
      }
      case 'lash': {
        let v = [...this.lashes.values()].find((x) => x.has(e.id));
        if (!v) {
          const g = this.gear(w, e.owner, 'dashen', e.tier);
          v = new LashView(ctx, { id: e.id, target: e.target, tier: e.tier, spirit: g.spirit, seq: e.seq, t2: 0, len: e.len, ring: e.ring }, e.x, e.y, this.playerAt(w, e.owner));
          this.lashes.set(e.id, v);
        }
        v.strike(ctx, e);
        this.lastLash = this.time;
        // 打神：抽中的精英身上贴一张「镇」字符（镇住约一秒）
        const t = this.byId.get(e.target);
        if (e.tier >= 3 && t && t.kind === 'elite' && e.seq === 1) this.pinTalisman(e.target, '镇', 1.1);
        break;
      }
      case 'kill':
        // 封神：这一鞭抽散的敌人化成一张封神符往天上飞
        if (e.execute && this.time - this.lastLash < 0.02 && e.kind !== 'boss') this.sealSoul(e.x, e.y, e.kind);
        break;
      case 'slash': {
        const g = this.gear(w, e.owner, 'huaxue', e.tier);
        this.add(new SlashView(ctx, e.x, e.y, e.a, e.r, e.arc, g, this.slashN++ % 2 === 1));
        break;
      }
      case 'mist': {
        bloodMist(ctx, e);
        e.ids.slice(0, 6).forEach((id, i) => {
          const to = () => {
            const p = this.enemyPos(id);
            if (!p) return null;
            return [p[0], p[1] - headOf(this.byId.get(id)?.kind) * 0.5] as [number, number];
          };
          this.add(new BloodThread(e.x, e.y - 8, to, 0.08 + i * 0.04));
        });
        break;
      }
      case 'heal': {
        if (e.kind === 'qinglian') {
          for (const z of this.zones.values()) if (z.kind === 'lotus') z.v.heal(ctx, e.amount);
        } else if (e.kind === 'huaxue') this.drain(w, e.owner, e.amount);
        break;
      }
      case 'zone': {
        if (!NEW_ZONES.has(e.zone) || this.zones.has(e.id)) break;
        const z = w.zones.find((q) => q.id === e.id);
        if (!z) break;
        const v = this.zoneFx(z, w);
        if (v) this.zones.set(e.id, v);
        break;
      }
      case 'zoneEnd': {
        const v = this.zones.get(e.id);
        if (v?.kind === 'whirl' || v?.kind === 'water') v.v.end(ctx, e);
        break;
      }
      case 'chain': {
        if (e.kind !== 'dingfeng') break;
        // 风雷：雷从龙卷顶上的乌云里劈下来，再在敌人之间连跳。模拟给的第一个点在风眼上方 46 像素（只给画面用）：
        // 风柱压低之后改从这道旋风的乌云里起。雷是淡金的（2026-11-11 起；原来紫白），和乌云里闪的电同色
        const [sx, sy] = e.pts[0] ?? [0, 0];
        let src: [number, number] = [sx, sy];
        let best = Infinity;
        for (const z of this.zones.values()) {
          if (z.kind !== 'whirl') continue;
          const c = z.v.cloudTop;
          const d = Math.hypot(c[0] - sx, c[1] - sy);
          if (d < best) {
            best = d;
            src = c;
          }
        }
        this.add(new Bolt(ctx, [[0, 0], src, ...e.pts.slice(1)], 'gold', { trunk: 2, branches: 0, skyEach: false, whip: false, arcsOnly: true }));
        const p = e.pts[1];
        if (p) ctx.sparks.emit(p[0], p[1], 8, [C.W, C.f, C.Y], [30, 90], [0.2, 0.45], { drag: 3, g: 100 });
        this.sound('dingfeng.thunder', 0.8, 0.12);
        break;
      }
      case 'throw':
        if (e.kind === 'wuhuo') this.sound('wuhuo.bird', 0.9, 0.2);
        break;
      case 'freeze': {
        // 阴阳：这一道和它的另一道都照到了这只（模拟里冻住它的条件）
        const both = w.zones.some((q) => q.kind === 'beam' && q.twin !== undefined && q.hit?.includes(e.id) && w.zones.find((o) => o.id === q.twin)?.hit?.includes(e.id));
        if (both) {
          const where = () => {
            const p = this.enemyPos(e.id);
            return p ? ([p[0], p[1] - headOf(this.byId.get(e.id)?.kind) - 7] as [number, number]) : null;
          };
          this.add(new Spinner(ctx, where, 1.2));
          ctx.sparks.emit(e.x, e.y - 10, 8, ICE_SPARKS, [15, 45], [0.3, 0.6], { drag: 2 });
          this.sound('yinyang.freeze', 0.8, 0.15);
        }
        break;
      }
      case 'dodge':
        for (const z of this.zones.values()) if (z.kind === 'lotus') z.v.dodge(ctx);
        break;
      case 'hit':
        this.onHit(e, w);
        break;
    }
  }

  private onHit(e: Ev<'hit'>, w: World) {
    const ctx = this.ctx;
    switch (e.by) {
      case 'slash': {
        const hd = headOf(e.kind);
        ctx.bits.spawn(e.x + rnd(-2, 2), e.y - hd * 0.5 + rnd(-2, 2), { frames: Ts('bcut', () => BLOOD_CUT), fps: 12, loop: false, life: 0.3, fadeOut: 0.12 });
        ctx.sparks.emit(e.x, e.y - hd * 0.5, 4, BLOOD_SPARKS, [20, 60], [0.2, 0.4], { g: 140, drag: 2 });
        break;
      }
      case 'beam': {
        const z = w.zones.find((q) => q.kind === 'beam' && q.hit !== undefined && q.hit[q.hit.length - 1] === e.id);
        const yin = !!z?.yin && (z?.tier ?? 1) >= 3;
        const hd = headOf(e.kind);
        ctx.bits.spawn(e.x + rnd(-3, 3), e.y - hd * 0.55, { frames: Ts('star', () => STAR).slice(1, 3), fps: 12, loop: false, life: 0.22, fadeOut: 0.1, tint: yin ? C.Cc : 0xffffff });
        ctx.glows.emit(e.x, e.y - hd * 0.5, 3, yin ? [C.Cc, C.W] : [C.f, C.W], [10, 30], [0.2, 0.4], { drag: 3 });
        // 照妖：精英、首领身上冒出紫黑的妖气
        if (z?.spirit === 'demon' && (e.kind === 'elite' || e.kind === 'boss'))
          for (let i = 0; i < 4; i++) ctx.bits.spawn(e.x + rnd(-6, 6), e.y - hd * rnd(0.3, 0.8), { frames: Ts(`demonpuff${i % 2}`, () => demonPuff(3 + (i % 2))), life: rnd(0.6, 0.9), vy: -rnd(10, 18), vx: rnd(-4, 4), delay: i * 0.05, alpha: 0.85, fadeOut: 0.35 });
        break;
      }
      case 'rope':
        this.ropeHits.push({ id: e.id, x: e.x, y: e.y });
        break;
      case 'wave':
        ctx.sparks.emit(e.x, e.y - 8, 3, FIRE_SPARKS, [20, 50], [0.2, 0.4], { up: 10, drag: 2 });
        break;
      case 'bird': {
        for (let i = 0; i < 4; i++) ctx.bits.spawn(e.x + rnd(-4, 4), e.y + rnd(-2, 3), { sizes: [1, 2, 3, 2, 1], fps: 12, life: rnd(0.4, 0.55), delay: i * 0.03, vy: -8, fadeOut: 0.2 });
        break;
      }
      case 'tide':
        ctx.sparks.emit(e.x, e.y - 10, 6, WATER_SPARKS, [30, 70], [0.3, 0.5], { up: 30, g: 140 });
        break;
      case 'gust':
        ctx.bits.spawn(e.x, e.y - 8, { frames: Ts('slash', () => SLASH_W), fps: 14, loop: false, life: 0.22, fadeOut: 0.1, tint: 0xe6ffd0 });
        break;
    }
  }

  /** 打神：精英身上贴一张黄符（跟着它走，约一秒后淡去）。 */
  private pinTalisman(id: number, glyph: string, life: number) {
    const ctx = this.ctx;
    const where = () => {
      const p = this.enemyPos(id);
      if (!p) return null;
      return [p[0] + 1, p[1] - headOf(this.byId.get(id)?.kind) * 0.55] as [number, number];
    };
    if (!where()) return;
    this.add(new Tag(ctx, T('talisman', talisman), where, life, 0.08, 0.3, 0.6, undefined, pixelTextTexture(glyph, { color: 'e', outline: null })));
    const [x, y] = where()!;
    ctx.sparks.emit(x, y, 8, GOLD_SPARKS, [20, 60], [0.3, 0.6], { drag: 3 });
  }

  /**
   * 封神：被抽散的敌人原地化成一张封神符，带着一缕金光往上飘起、淡去。
   * 符只往上飘约 10 像素、金光离地不过约 1.5 个人高（原来符飞上 34 像素、金线升到头顶 90 像素外，竖着比人高三四倍）。
   */
  private sealSoul(x: number, y: number, kind: Enemy['kind']) {
    const ctx = this.ctx;
    const hd = headOf(kind);
    const at: [number, number] = [x, y - hd * 0.5];
    this.add(new Tag(ctx, T('talisman', talisman), () => at, 1.2, 0.1, 0.5, 0.8, undefined, pixelTextTexture('封', { color: 'e', outline: null }), 10));
    for (let i = 0; i < 10; i++) ctx.glows.emit(x + rnd(-5, 5), y - rnd(2, hd), 1, GOLD_SPARKS, [8, 20], [0.5, 0.8], { up: 22, drag: 1.2 });
    this.add(new Pillar(ctx, x, y, hd));
    this.sound('dashen.shock', 0.6, 0.1);
  }

  /** 噬魂：身上流着自己割的血的敌人，各飞出一缕血魂到人身上。 */
  private drain(w: World, owner: number, amount: number) {
    const ctx = this.ctx;
    const p = w.players[owner];
    if (!p) return;
    const src = w.enemies
      .filter((e) => e.bleedT > 0 && e.bleedBy === owner && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 170 * 170)
      .sort((a, b) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2 - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2))
      .slice(0, Math.min(6, 2 + Math.round(amount * 2)));
    const to = this.playerAt(w, owner, -12);
    src.forEach((e, i) => {
      const hd = headOf(e.kind);
      this.add(new Homing(ctx, Ts('soulwisp', () => SOUL_WISP), e.x, e.y - hd * 0.5, () => to() ?? [p.x, p.y - 12], rnd(0.4, 0.55), i * 0.05, C.e, (x, y) => ctx.sparks.emit(x, y, 2, BLOOD_SPARKS, [5, 15], [0.2, 0.4], { drag: 2 })));
    });
    if (src.length) this.sound('huaxue.drain', 0.7, 0.45);
  }

  update(dt: number, w: World, alpha: number) {
    if (w !== this.world) {
      this.clear();
      this.world = w;
    }
    this.time += dt;
    this.alpha = alpha;
    const ctx = this.ctx;
    this.ixTick = -1;
    this.indexEnemies(w);
    // 区域：新出现的先建视图（漏掉了 zone 事件也照样画），再逐个推进
    const live = new Map<number, Zone>();
    for (const z of w.zones)
      if (NEW_ZONES.has(z.kind)) {
        live.set(z.id, z);
        if (!this.zones.has(z.id)) {
          const v = this.zoneFx(z, w);
          if (v) this.zones.set(z.id, v);
        }
      }
    // 缚仙：射出之后的那些「捆仙绳命中」是被拽到一起的两只互相撞上
    if (this.ropeHits.length) {
      for (const h of this.ropeHits)
        for (const z of this.zones.values()) if (z.kind === 'rope') z.v.clash(ctx, h.id);
      this.ropeHits = [];
    }
    for (const [id, z] of this.zones) {
      const lz = live.get(id) ?? null;
      let ok: boolean;
      switch (z.kind) {
        case 'whirl':
          ok = z.v.update(dt, ctx, lz, alpha);
          break;
        case 'lotus':
          ok = z.v.update(dt, ctx, lz, alpha, w.enemies);
          break;
        case 'beam':
          ok = z.v.update(dt, ctx, lz, alpha);
          break;
        case 'water':
          ok = z.v.update(dt, ctx, lz, w.enemies, alpha);
          break;
        case 'flameWave':
        case 'scorch':
        case 'rope':
          ok = z.v.update(dt, ctx, lz);
          break;
      }
      if (!ok) {
        z.v.destroy();
        this.zones.delete(id);
      }
    }
    // 打神鞭：还没抽中之前跟着目标走
    for (const [id, v] of this.lashes) {
      const p = v.target >= 0 ? this.enemyPos(v.target) : null;
      if (p) v.track(p[0], p[1]);
      if (!v.update(dt, ctx)) {
        v.destroy();
        this.lashes.delete(id);
      }
    }
    // 一次性的效果
    for (let i = this.effects.length - 1; i >= 0; i--)
      if (!this.effects[i].update(dt, ctx, w, alpha)) {
        this.effects[i].destroy();
        this.effects.splice(i, 1);
      }
    // 七禽火鸟
    const seen = new Set<number>();
    for (const k of w.knives) {
      if (k.kind !== 'wuhuo') continue;
      seen.add(k.id);
      let v = this.birds.get(k.id);
      if (!v) {
        v = new BirdView(ctx, k.x, k.y, this.playerAt(w, k.owner, -12));
        this.birds.set(k.id, v);
      }
      v.update(dt, ctx, { x: k.px + (k.x - k.px) * alpha, y: k.py + (k.y - k.py) * alpha, vx: k.vx, vy: k.vy });
    }
    for (const [id, v] of this.birds)
      if (!seen.has(id) && !v.update(dt, ctx, null)) {
        v.destroy();
        this.birds.delete(id);
      }
    this.bits.update(dt);
    this.top.flush();
    this.under.flush();
  }

  /** 自查用：现在活着的效果有多少。 */
  get stats() {
    return { effects: this.effects.length, zones: this.zones.size, lashes: this.lashes.size, birds: this.birds.size, bits: this.bits.count };
  }
}

/** 太极转起来：Tag 只放第一帧，这个每帧换帧（跟着同一个位置）。 */
class Spinner implements Effect {
  private t = 0;
  private s = new Sprite();
  private where: () => [number, number] | null;
  private life: number;
  constructor(ctx: Ctx, where: () => [number, number] | null, life: number) {
    this.where = where;
    this.life = life;
    this.s.anchor.set(0.5);
    ctx.layer.addChild(this.s);
  }
  private last: [number, number] = [0, 0];
  update(dt: number): boolean {
    this.t += dt;
    const p = this.where();
    if (p) this.last = p;
    this.s.texture = Ts('taiji', () => TAIJI)[Math.floor(this.t * 10) % 8];
    this.s.position.set(Math.round(this.last[0]), Math.round(this.last[1]));
    this.s.alpha = fade(this.t, this.life, 0.12, 0.4);
    return this.t < this.life;
  }
  destroy() {
    this.s.destroy();
  }
}

/**
 * 封神的一缕金光：被抽散的敌人身上往上升起一道细细的金线，慢慢淡去。
 * 金线的顶离地最高约 36 像素（1.5 个人；精英本来就高，只比它的头顶高出一点），不再升到画面外。
 */
class Pillar implements Effect {
  private t = 0;
  private x: number;
  private y: number;
  private hd: number;
  constructor(ctx: Ctx, x: number, y: number, hd: number) {
    this.x = x;
    this.y = y;
    this.hd = hd;
    void ctx;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const LIFE = 0.9;
    const k = this.t / LIFE;
    const peak = Math.max(36, this.hd + 4); // 金线的顶最高到离地多少
    const top = this.y - this.hd * 0.55 - (peak - this.hd * 0.55) * easeOut(Math.min(1, k * 1.4));
    const bottom = this.y - this.hd * 0.4 - (peak - this.hd * 0.4) * 0.7 * easeIn(k);
    const a = fade(this.t, LIFE, 0.06, 0.45);
    for (let yy = top; yy < bottom; yy += 1) {
      const u = (yy - top) / Math.max(1, bottom - top);
      ctx.top.dot(this.x, yy, u > 0.6 ? C.W : C.f, a * (0.3 + 0.7 * u));
      if (u > 0.5) ctx.top.dot(this.x + 1, yy, C.Y, a * 0.5 * u);
    }
    return this.t < LIFE;
  }
  destroy() {}
}

/** 照妖照出来的妖气：紫黑的一团（血雾换成胭脂紫、紫棠、玄）。 */
function demonPuff(r: number): Grid[] {
  return bloodPuffFrames(r, r).map((g) => recolor(g, { e: 'p', r: 'P', R: 'k', P: 'k' }));
}
