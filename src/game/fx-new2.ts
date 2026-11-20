// 再加的 11 件公共法宝的画面（arti2 分支；名单见 docs/design.md「法宝扩到约 30 件」）。
// 和 fx.ts 的 WeaponFx、fx-new.ts 的 ArtifactFx 同一个接口（onEvent / update / clear），由 feel.ts 和特效实验页各构造一个、一起喂事件；
// 粒子、纹理缓存、逐像素笔刷这些底子用 fx.ts 导出的那一套。只读模拟状态（world.zones、world.pending、world.knives、敌人），不回写。
// 精灵在 src/art/sprites/artifacts2.ts。
//
// 用户口径（逐条给过的）：
// - 法宝效果要看得见、有特色，出现和消失都要有过程（淡入淡出、收尾），动画不要太快。
// - 每次升阶都要有变化：凡 → 灵变大变多，仙品质变，神品两个器灵各自不同、更华丽 —— 华丽靠细节、动态、粒子，不靠变大。
// - 尺寸收着：法宝本身凡 / 灵不高于约 30 像素、仙 / 神不超过约 38；竖着往上的东西离它下面的地不过约 1.5 个人（约 36 像素）；
//   效果不画得比模拟里的判定范围大；效果不压在人物身上（按前后排，人物挡得住）。
// - 人物、武器身上不要光圈、光晕；地面上的东西要有形状（裂纹、印、浪），不要硬直线边界、不要「框」。
//
// 结构：小工具 → 每件法宝的效果对象 → 对外的 ArtifactFx2。
import { Container, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { crackFrames, ICE_CHIPS, ROCKS, SNOWFLAKE } from '../art/sprites/fx.ts';
import { SPLASH } from '../art/sprites/artifacts.ts';
import { CROW, CROW_FLAP, CROW_GOLD, emberCrackFrames, fireFlagFrames, JIAO, JIAO_MID, JIAO_PALE, NAIL, NAIL_MID, PESTLE, PESTLE_HOLY, PESTLE_MID, PESTLE_TIP, SHARDS, SIHAI_VASE, STONE_TONES, STONES, STONES_LIT, surgeColumn, vajraSealFrames, WANYA_POT, waterBall, MIAOSHU_TREE, MIAOSHU_GRIP, gemGrid, UMBRELLA, UMBRELLA_TIP, PLAGUE_DROP, COIN_FRAMES, COIN_FLAP, YFLAG_FOOT, YFLAG_H, YFLAG_W } from '../art/sprites/artifacts2.ts';
import { dragonAt, orbitRadius } from '../sim/arti2.ts';
import { DT } from '../sim/config.ts';
import { BLOOD_DROP, EMBER, scorch, STAR } from '../art/sprites/fx.ts';
import { PALETTE } from '../art/palette.ts';
import { grid } from '../art/pixel.ts';
import { applyRot, Bits, C, clamp01, type Ctx, easeIn, easeOut, type Effect, FIRE_SPARKS, GOLD_SPARKS, headOf, pick, Pixels, puffSet, rnd, rotTex, shadowTex, T, Ts } from './fx.ts';
import type { Enemy, SimEvent, WeaponKind, Zone, ZoneKind } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

const TAU = Math.PI * 2;
type Ev<K extends SimEvent['t']> = Extract<SimEvent, { t: K }>;
type Gear = { tier: number; spirit: string | null };
/** 给效果对象用的上下文：在 fx.ts 的 Ctx 上多一个「放一个效果」。 */
type ACtx = Ctx & { add(e: Effect): void };

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const EARTH_SPARKS = [C.Y, C.y, C.f, C.b];

/** 眩晕的小金星：两粒金点沿看不见的扁椭圆绕着头顶转（不画圈），晕多久转多久，最后淡掉。 */
class Stars implements Effect {
  private t = 0;
  private id: number;
  private life: number;
  private ph = rnd(0, TAU);
  constructor(id: number, life: number) {
    this.id = id;
    this.life = life;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const e = ctx.enemy(this.id);
    const p = ctx.enemyPos(this.id);
    if (!p || !e || e.hp <= 0) return false;
    const a = clamp01(Math.min(this.t / 0.08, (this.life - this.t) / 0.25));
    const hd = headOf(e.kind);
    for (let i = 0; i < 2; i++) {
      const ang = this.ph + this.t * 7 + i * Math.PI;
      const x = p[0] + Math.cos(ang) * 4;
      const y = p[1] - hd - 2 + Math.sin(ang) * 1.4;
      const front = Math.sin(ang) > 0;
      ctx.top.dot(x, y, front ? C.f : C.Y, a * (front ? 1 : 0.7));
      if (front) ctx.top.dot(x, y - 1, C.Y, a * 0.45);
    }
    return this.t < this.life;
  }
  destroy() {}
}

// ================================================================ 降魔杵

/** 杵飞在半空最高到哪：杵尖离地 15 像素（杵身 21 高，连杵离地不过约 36）。 */
const PESTLE_H = 15;
/** 弹向下一只时跳多高（杵尖离地）；第一下从人物手边（离地 HAND）脱手飞出，弧顶高一点。 */
const PESTLE_HOP = 11;
const PESTLE_HAND = 11;
/** 离人物胸口这么近的一段不画（效果不压在人物身上）：脱手之后飞出这么远才显出来。 */
const PESTLE_HIDE = 12;

/**
 * 降魔杵落地：一圈尘团从落点往外推开（停在砸的半径里）、碎石崩起再落地、凡 / 灵品地上裂几道缝（仙品起由降魔印接着画）、震屏。
 * big：泰山的最后一下 —— 尘更多、石更多、震得更狠，不更大。
 */
function pestleImpact(ctx: Ctx, x: number, y: number, r: number, tier: number, big: boolean) {
  const n = Math.round(6 + r / 4 + (big ? 6 : 0));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.15, 0.15);
    const r0 = r * 0.3;
    const sp = Math.max(5, r * 0.5) * 3.1 * rnd(0.8, 1);
    ctx.bits.spawn(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.55, { frames: puffSet(pick([3, 3, 4]), 'stone', 1 + (i % 3)), life: rnd(0.5, 0.75), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55 - 2, drag: 3.4, fadeIn: 0.03, fadeOut: 0.3, z: true, zOff: 2 });
  }
  const rocks = 3 + tier + (big ? 6 : 0);
  for (let i = 0; i < rocks; i++) {
    const a = rnd(0, TAU);
    ctx.bits.spawn(x + Math.cos(a) * rnd(1, r * 0.3), y + Math.sin(a) * rnd(1, r * 0.2), {
      frames: [Ts('rocks', () => ROCKS)[i % ROCKS.length]],
      life: rnd(0.65, 0.9),
      vx: Math.cos(a) * r * rnd(0.3, 0.7),
      vy: -rnd(45, 80) * (big ? 1.2 : 1),
      g: 320,
      ground: y + rnd(-2, 3),
      bounce: 0.35,
      fadeOut: 0.25,
    });
  }
  // 杵尖砸进地里的那一下：几粒金屑（不画金光圈）
  ctx.sparks.emit(x, y - 2, big ? 9 : 5, EARTH_SPARKS, [25, 70], [0.25, 0.5], { up: 25, g: 160, drag: 2 });
  if (tier < 3) {
    const fr = Ts(`xmcrack${Math.round(r)}`, () => crackFrames(r * 0.62, Math.round(r) * 13 + 5, false));
    ctx.bits.spawn(x, y, { frames: fr, fps: 40, loop: false, life: 1.1, layer: ctx.floor, fadeIn: 0.01, fadeOut: 0.5 });
  } else if (big) {
    const fr = Ts(`xmcrackB${Math.round(r)}`, () => crackFrames(r * 0.75, Math.round(r) * 17 + 3, true));
    ctx.bits.spawn(x, y, { frames: fr, fps: 40, loop: false, life: 1.6, layer: ctx.floor, fadeIn: 0.01, fadeOut: 0.7 });
  }
  ctx.shake.add(Math.min(0.3, 0.05 + tier * 0.012 + (big ? 0.12 : 0)));
}

/**
 * 一根降魔杵（一串连砸用同一个对象）：第一下从人物手边脱手，划一道弧砸到第一只身上；之后每一下从上一个落点弹起、
 * 划一道小弧落到下一只身上（杵头一直朝下，飞的时候朝去的方向斜一点，落下时立直、砸进地里）；
 * 最后一下砸完在地上立一会儿，再微微升起淡去，化成金屑。
 * 杵按落点的 y 和人物、敌人前后排（人物挡得住它）；影子贴在地上，杵越低影子越浓。
 */
class PestleView {
  readonly chain: number;
  private s = new Sprite();
  private sh = new Sprite();
  private holy: boolean;
  private tier: number;
  readonly spirit: string | null;
  private strike = -1; // 正在落的这一下的延时效果 id
  private target = -1;
  private from: [number, number] = [0, 0]; // 这一下从哪里起（地面坐标）
  private h0 = 0; // 起飞时杵尖离地多高（第一下是人物的手边）
  private hero: () => [number, number] | null = () => null;
  private to: [number, number] = [0, 0]; // 落点（跟着目标走）
  private t = 0;
  private t2 = 0.4;
  private mode: 'fall' | 'hop' | 'rest' = 'fall';
  private rest = 0;
  private final = false;
  private trail: [number, number][] = [];
  constructor(ctx: Ctx, chain: number, g: Gear) {
    this.chain = chain;
    this.tier = g.tier;
    this.spirit = g.spirit;
    this.holy = g.tier >= 3;
    this.s.alpha = 0;
    this.sh.anchor.set(0.5);
    this.sh.alpha = 0;
    ctx.floor.addChild(this.sh);
    ctx.stage.entities.addChild(this.s);
  }
  has(id: number) {
    return this.strike === id;
  }
  /**
   * 下一下：seq 1 从人物手边 (ox, oy) 脱手飞出；之后从上一个落点弹过去（漏掉了前面几下时也从模拟给的 (ox, oy) 起）。
   * hero：人物脚下的位置（第一下离人物太近的那一段不画）。
   */
  aim(id: number, target: number, x: number, y: number, t2: number, seq: number, from: [number, number] | null, hero: () => [number, number] | null) {
    this.strike = id;
    this.target = target;
    this.t = 0;
    this.t2 = Math.max(0.15, t2);
    this.mode = 'hop';
    this.h0 = seq <= 1 ? PESTLE_HAND : 0;
    this.from = from ?? [this.to[0], this.to[1]];
    this.hero = hero;
    this.to = [x, y];
    this.final = false;
    this.trail = [];
  }
  land(ctx: Ctx, e: Ev<'land'>, last: boolean, big: boolean) {
    this.to = [e.x, e.y];
    this.mode = 'rest';
    this.rest = 0;
    this.final = last;
    pestleImpact(ctx, e.x, e.y, e.r, this.tier, big);
  }
  track(p: [number, number] | null) {
    if (p && this.mode !== 'rest') this.to = p;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    let gx: number;
    let gy: number;
    let h: number;
    let ang = 0;
    let alpha = 1;
    if (this.mode === 'hop') {
      // 飞过去：弹起前先顿一下（落地那一下压住），再划一道弧；杵头朝下，飞的时候朝去的方向斜一点，后半段立直、加速砸下
      const pause = this.h0 > 0 ? 0 : Math.min(0.06, this.t2 * 0.2);
      const k = clamp01((this.t - pause) / Math.max(0.01, this.t2 - pause));
      const kk = k < 0.6 ? k : 0.6 + 0.4 * easeIn((k - 0.6) / 0.4); // 后四成加速往下砸
      gx = lerp(this.from[0], this.to[0], kk);
      gy = lerp(this.from[1], this.to[1], kk);
      const peak = this.h0 > 0 ? PESTLE_H : PESTLE_HOP;
      h = this.h0 * (1 - kk) + 4 * (peak - this.h0 * 0.5) * kk * (1 - kk);
      h = Math.min(PESTLE_H, Math.max(0, h));
      const dir = this.to[0] >= this.from[0] ? 1 : -1;
      ang = dir * 0.55 * Math.sin(Math.PI * Math.min(1, kk * 1.25));
      // 第一下：离人物胸口太近的那一段不画，飞出去再显出来
      if (this.h0 > 0) {
        const hp = this.hero();
        const near = hp ? Math.hypot(gx - hp[0], gy - h - (hp[1] - 12)) : 99;
        alpha = clamp01((near - PESTLE_HIDE) / 6);
      }
    } else if (this.mode === 'fall') {
      [gx, gy] = this.to;
      h = 0;
    } else {
      // 立在地上：落地那一下往地里压 1 像素；最后一下立一会儿，再微微升起、淡去
      this.rest += dt;
      [gx, gy] = this.to;
      const HOLD = 0.35;
      const lift = this.final && this.rest > HOLD ? easeIn((this.rest - HOLD) / 0.45) * 5 : 0;
      h = (this.rest < 0.06 ? -1 : 0) + lift;
      alpha = this.final && this.rest > HOLD ? clamp01(1 - (this.rest - HOLD) / 0.45) : 1;
      if (this.final && this.rest > HOLD && Math.random() < 0.4) ctx.glows.emit(gx + rnd(-3, 3), gy - rnd(4, 16) - lift, 1, GOLD_SPARKS, [4, 12], [0.4, 0.6], { up: 14, drag: 1 });
      if (this.final && this.rest > HOLD + 0.45) return false;
    }
    // 杵：绕杵身中点转；杵头朝下（角度 0）时杵尖正好在 (gx, gy - h)
    const tex = this.holy ? PESTLE_HOLY : PESTLE;
    const key = this.holy ? 'xmPestleH' : 'xmPestle';
    const r = rotTex(key, tex, ang, PESTLE_MID.x, PESTLE_MID.y, 24);
    applyRot(this.s, r);
    const midDy = PESTLE_TIP.y - PESTLE_MID.y;
    this.s.position.set(Math.round(gx), Math.round(gy - h - midDy));
    this.s.zIndex = gy + 1;
    this.s.alpha = alpha;
    // 影子：杵越低越浓、越大
    const low = 1 - clamp01(h / (PESTLE_H + 2));
    this.sh.texture = shadowTex(3 + low * 2);
    this.sh.position.set(Math.round(gx), Math.round(gy));
    this.sh.alpha = alpha * (0.12 + 0.25 * low);
    // 仙品起：弹过去的时候拖一缕淡金的气（几粒、很快散掉）
    if (this.mode === 'hop' && this.holy) {
      this.trail.push([gx, gy - h - midDy]);
      if (this.trail.length > 6) this.trail.shift();
      this.trail.forEach(([x, y], i) => ctx.top.dot(x + rnd(-1, 1), y + rnd(-2, 2), i > 3 ? C.f : C.Y, (i / this.trail.length) * 0.55));
    }
    if (this.mode === 'hop' && this.t > this.t2 + 0.5) return false; // 没等到落地（被清场）
    return true;
  }
  destroy() {
    this.s.destroy();
    this.sh.destroy();
  }
}

/**
 * 降魔印（仙品）：砸过的地上几道透着金光的裂缝，正中一个小小的三股杵印；缝里的光一明一暗，最后半秒淡掉。
 * 有敌人踩上去被镇住时，那只脚下闪一下金屑。
 */
class VajraView {
  private s: Sprite;
  private frames: Texture[];
  private seen = 0;
  private t = 0;
  constructor(ctx: Ctx, z: Zone) {
    const R = Math.round(z.r);
    this.frames = Ts(`xmvajra${R}`, () => vajraSealFrames(R, R * 7 + 3));
    this.s = new Sprite(this.frames[0]);
    this.s.anchor.set(0.5);
    this.s.position.set(Math.round(z.x), Math.round(z.y));
    this.s.alpha = 0;
    ctx.floor.addChild(this.s);
  }
  update(dt: number, ctx: Ctx, z: Zone | null): boolean {
    this.t += dt;
    if (!z) {
      this.s.alpha -= dt / 0.3;
      return this.s.alpha > 0;
    }
    const left = z.life - z.t;
    this.s.texture = this.frames[Math.floor(this.t * 6) % this.frames.length];
    const a = clamp01(Math.min(this.t / 0.15, left / 0.5));
    this.s.alpha = a * 0.95;
    // 印上慢慢飘起几粒金屑（稀稀的，不成柱）
    if (a > 0.5 && Math.random() < dt * 5) ctx.glows.emit(z.x + rnd(-z.r * 0.6, z.r * 0.6), z.y + rnd(-2, 2), 1, [C.f, C.Y], [3, 8], [0.5, 0.8], { up: 16, drag: 1.2 });
    const hit = z.hit ?? [];
    for (; this.seen < hit.length; this.seen++) {
      const p = ctx.enemyPos(hit[this.seen]);
      if (!p) continue;
      ctx.sparks.emit(p[0], p[1] - 1, 4, EARTH_SPARKS, [10, 30], [0.25, 0.45], { up: 30, drag: 2 });
      ctx.glows.emit(p[0], p[1] - 2, 2, [C.f, C.Y], [5, 12], [0.3, 0.5], { up: 12, drag: 2 });
    }
    return true;
  }
  destroy() {
    this.s.destroy();
  }
}

// ================================================================ 五光石

/** 调色板字符 → 数值颜色（粒子、逐像素笔刷用）。 */
const hexOf = (ch: string) => parseInt(PALETTE[ch].slice(1), 16);
/** 五色各自的 [亮, 身, 暗]（数值）。 */
const STONE_COLS = STONE_TONES.map(([a, b, c]) => [hexOf(a), hexOf(b), hexOf(c)]);
/** 石子飞在多高（离地，胸口那么高）。 */
const STONE_H = 9;

/**
 * 一枚五色石（或仙品碎成的一点五色光）：跟着模拟里的飞行物走，翻着滚、拖一小截同色的尾巴，地上一个小影子；
 * 离人物胸口 10 像素以内不画（刚出手那一截压在人物身上）。
 */
class StoneView {
  private s = new Sprite();
  private sh = new Sprite();
  private t = rnd(0, 1);
  readonly color: number;
  readonly shard: boolean;
  private lit: boolean;
  last: [number, number] = [0, 0];
  private trail: [number, number][] = [];
  constructor(ctx: Ctx, color: number, shard: boolean, tier: number) {
    this.color = color;
    this.shard = shard;
    this.lit = tier >= 3;
    this.s.anchor.set(0.5);
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
    this.sh.texture = shadowTex(2);
    this.sh.anchor.set(0.5);
    this.sh.alpha = 0;
    if (!shard) ctx.floor.addChild(this.sh);
  }
  update(dt: number, ctx: Ctx, x: number, y: number, hero: [number, number] | null) {
    this.t += dt;
    this.last = [x, y];
    const fr = this.shard ? null : this.lit ? Ts(`wgStoneL${this.color}`, () => STONES_LIT[this.color]) : Ts(`wgStone${this.color}`, () => STONES[this.color]);
    this.s.texture = fr ? fr[Math.floor(this.t * 14) % fr.length] : Ts('wgShards', () => SHARDS)[this.color];
    const sy = y - STONE_H;
    this.s.position.set(Math.round(x), Math.round(sy));
    this.s.zIndex = y + 1;
    const near = hero ? Math.hypot(x - hero[0], sy - (hero[1] - 12)) : 99;
    const a = this.shard ? 1 : clamp01((near - 10) / 5);
    this.s.alpha = a;
    this.sh.position.set(Math.round(x), Math.round(y));
    this.sh.alpha = a * 0.25;
    // 尾巴：最近几帧的位置连成一道细光，越往后越淡（仙品起、五色光的尾巴亮一些、长一些）
    this.trail.push([x, sy]);
    const keep = this.shard || this.lit ? 7 : 5;
    while (this.trail.length > keep) this.trail.shift();
    const [c0, c1] = STONE_COLS[this.color];
    const bright = this.shard || this.lit;
    for (let i = 0; i < this.trail.length - 1; i++) {
      const [x0, y0] = this.trail[i];
      const [x1, y1] = this.trail[i + 1];
      const k = (i + 1) / this.trail.length;
      for (let s = 0; s <= 1; s += 0.34) ctx.top.dot(lerp(x0, x1, s), lerp(y0, y1, s), k > 0.6 && bright ? c0 : c1, a * k * (bright ? 0.75 : 0.45));
    }
    if (bright && Math.random() < dt * 8) ctx.glows.emit(x, sy, 1, [c0, C.W], [3, 8], [0.25, 0.4], { drag: 3 });
  }
  destroy() {
    this.s.destroy();
    this.sh.destroy();
  }
}

/** 石子打中面门：碎屑和同色的火星迸开，一点白光一闪就收（不画圈）。 */
function stoneHit(ctx: Ctx, x: number, y: number, color: number, tier: number) {
  const [c0, c1, c2] = STONE_COLS[color];
  ctx.sparks.emit(x, y, 4 + tier, [c0, c1, C.W], [25, 65], [0.2, 0.4], { drag: 2.5, g: 60 });
  ctx.glows.emit(x, y, 2, [c0, C.W], [8, 20], [0.15, 0.3], { drag: 3 });
  // 石子碎成两粒小碴，落到地上弹一下
  const [, b, c] = STONE_TONES[color];
  for (let i = 0; i < 2; i++) ctx.bits.spawn(x + rnd(-2, 2), y, { frames: Ts(`wgChip${color}${i}`, () => [grid([i ? `${b}${c}` : c])]), life: rnd(0.4, 0.55), vx: rnd(-30, 30), vy: -rnd(20, 45), g: 260, ground: y + STONE_H + rnd(-1, 2), bounce: 0.3, fadeOut: 0.2 });
  // 仙品起：五色的光点散开（碎成五色光）
  if (tier >= 3) for (let i = 0; i < 5; i++) ctx.glows.emit(x, y, 1, [STONE_COLS[i][0]], [20, 45], [0.25, 0.45], { drag: 2 });
  void c2;
}

// ================================================================ 攒心钉

/** 一枚飞着的金钉：顺着飞的方向转，后面拖一线金光；离人物胸口 10 像素以内不画。 */
class NailView {
  private s = new Sprite();
  private trail: [number, number][] = [];
  last: [number, number] = [0, 0];
  constructor(ctx: Ctx) {
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
  }
  update(ctx: Ctx, x: number, y: number, vx: number, vy: number, hero: [number, number] | null) {
    this.last = [x, y];
    applyRot(this.s, rotTex('zxNail', NAIL, Math.atan2(vy, vx), NAIL_MID.x, NAIL_MID.y, 24));
    this.s.position.set(Math.round(x), Math.round(y));
    this.s.zIndex = y + 8;
    const near = hero ? Math.hypot(x - hero[0], y - (hero[1] - 12)) : 99;
    const a = clamp01((near - 10) / 5);
    this.s.alpha = a;
    this.trail.push([x, y]);
    while (this.trail.length > 4) this.trail.shift();
    for (let i = 0; i < this.trail.length - 1; i++) {
      const [x0, y0] = this.trail[i];
      const [x1, y1] = this.trail[i + 1];
      const k = (i + 1) / this.trail.length;
      for (let s = 0; s <= 1; s += 0.25) ctx.top.dot(lerp(x0, x1, s), lerp(y0, y1, s), k > 0.6 ? C.f : C.y, a * k * 0.55);
    }
  }
  destroy() {
    this.s.destroy();
  }
}

/** 钉子钉在敌人身上的位置（相对脚底，按回响兵的身量；高大的按头高放大）和朝外的方向：前胸、肩、腰交错开。 */
const PIN_AT: [number, number, number][] = [
  [-4, -12, -2.6],
  [4, -11, -0.5],
  [-1, -15, -1.9],
  [3, -15, -1.1],
  [-4, -8, 2.9],
  [4, -7, 0.25],
];
/** 一枚钉在身上的钉子：根扎在身上（暗），钉身朝外支出来（藤黄），钉帽缃黄、偶尔闪一下灵光；钉帽外面一像素赭色的边（浅色地面上也看得清）。 */
function drawPin(ctx: Ctx, x: number, y: number, a: number, alpha: number, glint: boolean) {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // 钉身（根上一像素藏进身子里）；朝外支出 5 像素，钉帽在身子外面，背后衬一像素赭色
  for (let i = 1; i <= 4; i++) ctx.top.dot(x + ux * i - uy * 0.6, y + uy * i + ux * 0.6, C.B, alpha * 0.55);
  ctx.top.dot(x, y, C.b, alpha);
  ctx.top.dot(x + ux, y + uy, C.y, alpha);
  ctx.top.dot(x + ux * 2, y + uy * 2, C.Y, alpha);
  ctx.top.dot(x + ux * 3, y + uy * 3, C.Y, alpha);
  ctx.top.dot(x + ux * 4, y + uy * 4, C.f, alpha);
  ctx.top.dot(x + ux * 5, y + uy * 5, glint ? C.W : C.Y, alpha);
  ctx.top.dot(x + ux * 5 - uy, y + uy * 5 + ux, C.Y, alpha); // 钉帽：横在钉身上的一小截
  ctx.top.dot(x + ux * 5 + uy, y + uy * 5 - ux, C.b, alpha);
}

/** 钉满了一齐钻心：钉子从各自的地方往心口一收（0.12 秒），心口一点金光迸开（几粒金星、金屑；透骨再溅几滴血）。 */
class Drill implements Effect {
  private t = 0;
  private id: number;
  private n: number;
  private bone: boolean;
  private x: number;
  private y: number;
  private hd: number;
  private burst = false;
  constructor(id: number, n: number, x: number, y: number, hd: number, bone: boolean) {
    this.id = id;
    this.n = n;
    this.x = x;
    this.y = y;
    this.hd = hd;
    this.bone = bone;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const p = ctx.enemyPos(this.id);
    if (p) [this.x, this.y] = p;
    const k = clamp01(this.t / 0.12);
    const sc = this.hd / 21;
    const cx = this.x;
    const cy = this.y - this.hd * 0.55;
    if (k < 1) {
      for (let i = 0; i < this.n; i++) {
        const [dx, dy, a] = PIN_AT[i % PIN_AT.length];
        drawPin(ctx, lerp(this.x + dx * sc, cx, easeIn(k)), lerp(this.y + dy * sc, cy, easeIn(k)), a, 1 - k * 0.3, false);
      }
      return true;
    }
    if (!this.burst) {
      this.burst = true;
      ctx.bits.spawn(cx, cy, { frames: Ts('star', () => STAR).slice(1), fps: 14, loop: false, life: 0.3, fadeOut: 0.12 });
      ctx.sparks.emit(cx, cy, 10, GOLD_SPARKS, [30, 80], [0.25, 0.5], { drag: 2.5, g: 80 });
      ctx.glows.emit(cx, cy, 4, [C.f, C.Y], [10, 25], [0.3, 0.5], { drag: 3 });
      if (this.bone) for (let i = 0; i < 4; i++) ctx.bits.spawn(cx + rnd(-2, 2), cy, { frames: [Ts('bdrop', () => [BLOOD_DROP])[0]], life: rnd(0.4, 0.6), vx: rnd(-30, 30), vy: -rnd(20, 50), g: 260, ground: this.y + rnd(-1, 2), fadeOut: 0.25 });
      ctx.shake.add(0.04);
    }
    return this.t < 0.45;
  }
  destroy() {}
}

// ================================================================ 金蛟剪

/** 金蛟飞在多高（离地，胸口那么高）。 */
const JIAO_H = 10;

/**
 * 金蛟剪的一阵：几条金蛟绕着人物盘旋（位置照模拟里的 orbit 区域：刚放出来从身边盘出去，收起时盘回来），
 * 头朝游的方向、身子一摆一摆，身后拖几粒金鳞光；按落点的 y 和人物前后排（绕到人物身后的被挡住）。
 * 仙品「交剪」：扑出去的时候各自从绕身的地方飞向目标（两条一左一右包过去），剪中时剪口一闪；剪完再飞回来接着绕。
 * 器灵「四蛟」：四条，两对（一对金、一对淡金），各剪一只；「绞龙」：剪完缠在那只身上绕着绞。
 */
class OrbitView implements ZoneView2 {
  private dragons: Sprite[] = [];
  private shadows: Sprite[] = [];
  /** 每条金蛟身后两个淡淡的残影（游得快的样子，不是光圈）：位置、朝向取前几帧的。 */
  private ghosts: Sprite[][] = [];
  private hist: { x: number; y: number; a: number; fr: number; pale: boolean; al: number }[][] = [];
  private t = 0;
  private dartFrom: [number, number][] = [];
  private dartT = 0;
  private dartLen = 0.28;
  private back = 0; // 剪完飞回来还剩多久（0 = 在绕）
  private backFrom: [number, number][] = [];
  private last: [number, number][] = [];
  private trail: [number, number, number][] = [];
  private hero: () => [number, number] | null;
  constructor(ctx: Ctx, z: Zone, hero: () => [number, number] | null) {
    this.hero = hero;
    const n = z.n ?? 2;
    for (let i = 0; i < n; i++) {
      const s = new Sprite();
      s.alpha = 0;
      ctx.stage.entities.addChild(s);
      this.dragons.push(s);
      const sh = new Sprite(shadowTex(2));
      sh.anchor.set(0.5);
      sh.alpha = 0;
      ctx.floor.addChild(sh);
      this.shadows.push(sh);
      this.last.push([z.x, z.y]);
      const gs = [new Sprite(), new Sprite()];
      for (const g of gs) {
        g.alpha = 0;
        ctx.stage.entities.addChild(g);
      }
      this.ghosts.push(gs);
      this.hist.push([]);
    }
  }
  /** 扑出去：记下每条金蛟此刻的位置，之后 len 秒里飞向各自的目标。 */
  dart(len: number) {
    this.dartFrom = this.last.map((p) => [p[0], p[1]] as [number, number]);
    this.dartT = 0;
    this.dartLen = Math.max(0.1, len);
  }
  /** 剪完：从剪口飞回来接着绕（0.25 秒）。 */
  snipped() {
    this.backFrom = this.last.map((p) => [p[0], p[1]] as [number, number]);
    this.back = 0.25;
  }
  update(dt: number, ctx: Ctx, z: Zone | null, alpha: number, w: World): boolean {
    this.t += dt;
    if (!z) {
      for (const s of this.dragons) s.alpha -= dt / 0.2;
      for (const s of this.shadows) s.alpha -= dt / 0.2;
      for (const gs of this.ghosts) for (const g of gs) g.alpha = 0;
      return (this.dragons[0]?.alpha ?? 0) > 0;
    }
    const n = this.dragons.length;
    const ids = z.ids ?? [];
    const spin = z.spin ?? 3;
    const snipping = (z.snip ?? 0) > 0;
    const coiling = (z.coil ?? 0) > 0;
    if (snipping) this.dartT += dt;
    if (this.back > 0) this.back = Math.max(0, this.back - dt);
    const hp = this.hero();
    for (let i = 0; i < n; i++) {
      let gx: number;
      let gy: number;
      let face: number;
      // 绕身的位置（插值到这一帧：角度往回退一点）
      const za = { ...z, a: (z.a ?? 0) - (snipping || coiling ? 0 : spin * DT * (1 - alpha)) };
      const [ox, oy] = dragonAt(za, i);
      const ang = (za.a ?? 0) + (i * Math.PI * 2) / n;
      if (coiling) {
        // 绞龙：缠在那只身上绕着绞（半径 6，转得快）
        const tp = ctx.enemyPos(ids[0]);
        const ca = this.t * 9 + (i * Math.PI * 2) / n;
        gx = (tp?.[0] ?? ox) + Math.cos(ca) * 6;
        gy = (tp?.[1] ?? oy) + Math.sin(ca) * 3 + 2;
        face = ca + Math.PI / 2;
      } else if (snipping && this.dartFrom.length) {
        // 扑出去：一对里的两条从两侧包向同一只，到了剪口交错
        const pair = n === 4 ? i % 2 : 0;
        const tid = ids[Math.min(pair, ids.length - 1)];
        const tp = ctx.enemyPos(tid) ?? [ox, oy];
        const side = (n === 4 ? Math.floor(i / 2) : i) % 2 ? 1 : -1;
        const k = easeIn(clamp01(this.dartT / this.dartLen));
        const [fx, fy] = this.dartFrom[i];
        const dx = tp[0] - fx;
        const dy = tp[1] - fy;
        const L = Math.hypot(dx, dy) || 1;
        const bend = Math.sin(Math.PI * k) * Math.min(14, L * 0.3) * side;
        gx = lerp(fx, tp[0], k) + (-dy / L) * bend;
        gy = lerp(fy, tp[1], k) + (dx / L) * bend;
        face = Math.atan2(gy - this.last[i][1], gx - this.last[i][0]);
      } else if (this.back > 0 && this.backFrom.length) {
        const k = easeOut(1 - this.back / 0.25);
        gx = lerp(this.backFrom[i][0], ox, k);
        gy = lerp(this.backFrom[i][1], oy, k);
        face = Math.atan2(gy - this.last[i][1], gx - this.last[i][0]);
      } else {
        gx = ox;
        gy = oy;
        face = ang + (spin >= 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      this.last[i] = [gx, gy];
      const s = this.dragons[i];
      const pale = n === 4 && i % 2 === 1;
      const fr = Math.floor(this.t * 8 + i * 2) % 4;
      applyRot(s, rotTex(`jiao${pale ? 'P' : ''}${fr}`, (pale ? JIAO_PALE : JIAO)[fr], face, JIAO_MID.x, JIAO_MID.y, 24, undefined, true));
      // 模拟里绕身的圆就在胸口那么高（z.y 是脚下往上 JIAO_H）：扑出去时的目标点是敌人脚下，抬到身子中间
      const lifted = snipping || coiling || this.back > 0;
      const sy = lifted ? gy - 8 : gy;
      const groundY = sy + JIAO_H;
      s.position.set(Math.round(gx), Math.round(sy));
      s.zIndex = groundY + 1;
      // 刚盘出去、快收回来的时候离人物很近：离人物胸口 12 像素以内不画
      const near = hp ? Math.hypot(gx - hp[0], sy - (hp[1] - 12)) : 99;
      const a = clamp01((near - 12) / 6) * clamp01(Math.min(z.t / 0.12, (z.life - z.t) / 0.15 + 0.2));
      s.alpha = a;
      const sh = this.shadows[i];
      sh.position.set(Math.round(gx), Math.round(groundY));
      sh.alpha = a * 0.2;
      // 残影：取 3 帧前、6 帧前的样子，淡淡地跟在后面
      const h = this.hist[i];
      h.push({ x: gx, y: sy, a: face, fr, pale, al: a });
      if (h.length > 7) h.shift();
      this.ghosts[i].forEach((g, j) => {
        const o = h[h.length - 1 - (j + 1) * 3];
        if (!o) {
          g.alpha = 0;
          return;
        }
        applyRot(g, rotTex(`jiao${o.pale ? 'P' : ''}${o.fr}`, (o.pale ? JIAO_PALE : JIAO)[o.fr], o.a, JIAO_MID.x, JIAO_MID.y, 24, undefined, true));
        g.position.set(Math.round(o.x), Math.round(o.y));
        g.zIndex = o.y + JIAO_H;
        g.alpha = o.al * (j ? 0.14 : 0.3);
      });
      // 身后的金鳞光：隔几帧落一粒，慢慢淡掉
      if (a > 0.3 && Math.random() < dt * 14) this.trail.push([gx + rnd(-2, 2), sy + rnd(-1, 2), 0]);
    }
    for (const tr of this.trail) tr[2] += dt;
    this.trail = this.trail.filter((tr) => tr[2] < 0.35);
    for (const [x, y, age] of this.trail) ctx.top.dot(x, y + age * 6, age < 0.12 ? C.f : C.Y, (1 - age / 0.35) * 0.6);
    void w;
    return true;
  }
  destroy() {
    for (const s of this.dragons) s.destroy();
    for (const s of this.shadows) s.destroy();
    for (const gs of this.ghosts) for (const g of gs) g.destroy();
  }
}

/** 交剪：剪口一闪 —— 两道很短的金线交错一下就收（不画十字光、不画圈），金屑迸开，剪中的那只身上一点白。 */
function snipFlash(ctx: ACtx, x: number, y: number, tier: number) {
  const cx = x;
  const cy = y - 10;
  ctx.add(new SnipLines(cx, cy));
  ctx.sparks.emit(cx, cy, 6 + tier, GOLD_SPARKS, [30, 80], [0.2, 0.45], { drag: 2.5 });
  ctx.glows.emit(cx, cy, 3, [C.W, C.f], [8, 20], [0.2, 0.35], { drag: 3 });
  ctx.shake.add(0.03);
}
/** 剪口的两道金线：从两边往中间一合（0.12 秒），再淡掉（0.15 秒）。 */
class SnipLines implements Effect {
  private t = 0;
  private x: number;
  private y: number;
  private a = rnd(-0.4, 0.4);
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const close = clamp01(this.t / 0.12);
    const fadeK = this.t < 0.12 ? 1 : clamp01(1 - (this.t - 0.12) / 0.15);
    for (const sgn of [-1, 1]) {
      const a = this.a + sgn * (0.55 - 0.45 * close);
      for (let s = -6; s <= 6; s += 0.5) {
        const k = Math.abs(s) / 6;
        ctx.top.dot(this.x + Math.cos(a) * s, this.y + Math.sin(a) * s, k < 0.4 ? C.W : C.Y, fadeK * (1 - k * 0.7));
      }
    }
    return this.t < 0.27;
  }
  destroy() {}
}

// ================================================================ 离地焰光旗

/**
 * 一面焰光旗：插下去的时候从上面落一点、扎进地里（一小团尘、几粒火星）；旗面随风飘、下摆的火边一窜一窜，旗脚偶尔冒火星；
 * 人走远了旗拔起来（往上一抽、淡掉），在新的地方再扎下去；插满了往下一沉、淡掉。按旗脚的 y 和人物、敌人前后排。仙品起换亮的那一面。
 */
class BannerView implements ZoneView2 {
  private s = new Sprite();
  private sh = new Sprite(shadowTex(3));
  private frames: Texture[];
  private t = 0;
  private plantT = 0; // 这一次插下去过了多久
  private x: number;
  private y: number;
  constructor(ctx: Ctx, z: Zone) {
    const holy = z.tier >= 3;
    this.frames = Ts(`yflag${holy ? 'H' : ''}`, () => fireFlagFrames(8, holy));
    this.s.anchor.set(YFLAG_FOOT.x / YFLAG_W, YFLAG_FOOT.y / YFLAG_H);
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
    this.sh.anchor.set(0.5);
    this.sh.alpha = 0;
    ctx.floor.addChild(this.sh);
    this.x = z.x;
    this.y = z.y;
    this.plant(ctx);
  }
  private plant(ctx: Ctx) {
    this.plantT = 0;
    ctx.bits.spawn(this.x, this.y, { frames: puffSet(3, 'smoke', 2), life: 0.5, vy: -6, fadeOut: 0.3, alpha: 0.6, z: true, zOff: 1 });
    ctx.sparks.emit(this.x, this.y - 2, 5, FIRE_SPARKS, [15, 40], [0.25, 0.45], { up: 20, g: 60, drag: 2 });
  }
  /** 人走远了：旗拔起来（原地留一个往上一抽、淡掉的旗），在新的地方扎下去。 */
  hop(ctx: Ctx, x: number, y: number) {
    const old = new Sprite(this.s.texture);
    old.anchor.copyFrom(this.s.anchor);
    old.position.copyFrom(this.s.position);
    old.zIndex = this.s.zIndex;
    ctx.stage.entities.addChild(old);
    (ctx as ACtx).add(new Fade(old, 0.22, -8));
    this.x = x;
    this.y = y;
    this.plant(ctx);
  }
  update(dt: number, ctx: Ctx, z: Zone | null): boolean {
    this.t += dt;
    this.plantT += dt;
    if (!z) {
      // 插满了：往下一沉、淡掉
      this.s.alpha -= dt / 0.35;
      this.s.y += dt * 10;
      this.sh.alpha = this.s.alpha * 0.35;
      return this.s.alpha > 0;
    }
    if (Math.abs(z.x - this.x) > 0.5 || Math.abs(z.y - this.y) > 0.5) this.hop(ctx, z.x, z.y);
    this.s.texture = this.frames[Math.floor(this.t * 8) % this.frames.length];
    const drop = 1 - easeOut(clamp01(this.plantT / 0.16));
    this.s.position.set(Math.round(this.x), Math.round(this.y - drop * 7));
    this.s.zIndex = this.y;
    this.s.alpha = clamp01(Math.min(this.plantT / 0.1, (z.life - z.t) / 0.4 + 0.15));
    this.sh.position.set(Math.round(this.x + 2), Math.round(this.y));
    this.sh.alpha = this.s.alpha * 0.35;
    // 旗脚、旗边偶尔冒一粒火星往上飘（稀稀的）
    if (Math.random() < dt * 4) ctx.glows.emit(this.x + rnd(0, 12), this.y - rnd(16, 24), 1, [C.Y, C.o], [4, 10], [0.5, 0.8], { up: 14, drag: 1 });
    return true;
  }
  destroy() {
    this.s.destroy();
    this.sh.destroy();
  }
}

/** 一张精灵慢慢淡掉、往 dy 挪（拔旗留下的那一面）。 */
class Fade implements Effect {
  private t = 0;
  private s: Sprite;
  private life: number;
  private dy: number;
  private y0: number;
  constructor(s: Sprite, life: number, dy: number) {
    this.s = s;
    this.life = life;
    this.dy = dy;
    this.y0 = s.y;
  }
  update(dt: number): boolean {
    this.t += dt;
    const k = clamp01(this.t / this.life);
    this.s.alpha = 1 - k;
    this.s.y = Math.round(this.y0 + this.dy * easeOut(k));
    return this.t < this.life;
  }
  destroy() {
    this.s.destroy();
  }
}

/**
 * 一道地火：预警时敌人脚下先裂开几道透火光的缝（由暗到亮，跟着它走）；落地时窜起一簇火苗（不超过约 1.5 个人高）、
 * 火星往上迸、地上留一块淡淡的焦痕。仙品「焰光」：从上一道地火那里，地下一路透着火光窜过来（一道细缝）。
 */
class GeyserView implements Effect {
  private t = 0;
  private id: number;
  private t2: number;
  private r: number;
  private s: Sprite;
  private frames: Texture[];
  private x: number;
  private y: number;
  private from: [number, number] | null;
  private landed = false;
  private tier: number;
  constructor(ctx: Ctx, id: number, x: number, y: number, r: number, t2: number, tier: number, from: [number, number] | null) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.r = r;
    this.t2 = Math.max(0.1, t2);
    this.tier = tier;
    this.from = from;
    const R = Math.round(r * 0.8);
    this.frames = Ts(`ycrack${R}`, () => emberCrackFrames(R, R * 3 + 1));
    this.s = new Sprite(this.frames[0]);
    this.s.anchor.set(0.5);
    this.s.alpha = 0;
    ctx.floor.addChild(this.s);
  }
  has(id: number) {
    return this.id === id;
  }
  track(x: number, y: number) {
    if (!this.landed) {
      this.x = x;
      this.y = y;
    }
  }
  land(ctx: Ctx, x: number, y: number) {
    this.landed = true;
    this.x = x;
    this.y = y;
    this.t = 0;
    // 火苗：中间一簇高的（仙品起再高一点），两边两簇矮的；都按 y 和人物前后排
    const tall = this.tier >= 3 ? [2, 4, 6, 7, 6, 4, 2] : [2, 4, 5, 6, 5, 3, 1];
    ctx.bits.spawn(x, y + 1, { sizes: tall, fps: 12, life: 0.75, z: true, zOff: 1, fadeOut: 0.25 });
    for (const dx of [-5, 5]) ctx.bits.spawn(x + dx, y + 1, { sizes: [1, 3, 4, 3, 1], fps: 12, life: 0.55, delay: 0.04, z: true, fadeOut: 0.2 });
    ctx.sparks.emit(x, y - 6, 8 + this.tier * 2, FIRE_SPARKS, [30, 80], [0.3, 0.6], { up: 60, g: 90, drag: 1.5 });
    for (let i = 0; i < 2; i++) ctx.bits.spawn(x + rnd(-3, 3), y - rnd(10, 16), { frames: puffSet(3, 'smoke', 1 + i), life: rnd(0.6, 0.8), vy: -rnd(10, 16), delay: 0.15, fadeOut: 0.4, alpha: 0.45 });
    // 焦痕
    const sc = T(`yscorch${Math.round(this.r)}`, () => scorch(this.r * 0.55, Math.round(this.r) * 5));
    ctx.bits.spawn(x, y, { frames: [sc], life: 1.1, layer: ctx.floor, fadeIn: 0.02, fadeOut: 0.6, alpha: 0.5 });
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    if (!this.landed) {
      const k = clamp01(this.t / this.t2);
      this.s.texture = this.frames[Math.min(this.frames.length - 1, Math.floor(k * this.frames.length))];
      this.s.position.set(Math.round(this.x), Math.round(this.y));
      this.s.alpha = 0.4 + 0.6 * k;
      // 一路窜过来：从上一道地火到这里，一道透火光的细缝往前爬
      if (this.from) {
        const [fx, fy] = this.from;
        const n = Math.max(2, Math.ceil(Math.hypot(this.x - fx, this.y - fy) / 1.5));
        for (let i = 0; i <= n * k; i++) {
          const u = i / n;
          const jx = Math.sin(u * 17 + this.id) * 1.2;
          ctx.under.dot(lerp(fx, this.x, u) + jx, lerp(fy, this.y, u), u > k - 0.15 ? C.Y : C.e, 0.85 * (1 - (k - u) * 0.6));
        }
      }
      if (this.t > this.t2 + 0.5) return false; // 没等到（被清场）
      return true;
    }
    this.s.alpha = Math.max(0, 1 - this.t / 0.35);
    return this.t < 0.4;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 焚城：地火窜过留下的一小片火海 —— 几簇矮火苗一直窜着、地上一块焦痕，最后半秒火苗变小、淡掉。 */
class BlazeView implements ZoneView2 {
  private t = 0;
  private next = 0;
  private decal: Sprite;
  constructor(ctx: Ctx, z: Zone) {
    this.decal = new Sprite(T(`yscorch${Math.round(z.r)}`, () => scorch(z.r * 0.6, Math.round(z.r) * 5)));
    this.decal.anchor.set(0.5);
    this.decal.position.set(Math.round(z.x), Math.round(z.y));
    this.decal.alpha = 0;
    ctx.floor.addChild(this.decal);
  }
  update(dt: number, ctx: Ctx, z: Zone | null): boolean {
    this.t += dt;
    if (!z) {
      this.decal.alpha -= dt / 0.4;
      return this.decal.alpha > 0;
    }
    const left = z.life - z.t;
    this.decal.alpha = clamp01(Math.min(this.t / 0.15, left / 0.5)) * 0.6;
    this.next -= dt;
    if (this.next <= 0 && left > 0.3) {
      this.next = 0.12;
      const a = rnd(0, TAU);
      const d = rnd(0, z.r * 0.6);
      ctx.bits.spawn(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d * 0.55, { sizes: left > 0.8 ? [0, 1, 2, 1, 0] : [0, 1, 0], fps: 12, life: 0.5, z: true, fadeOut: 0.2 });
    }
    if (Math.random() < dt * 6) ctx.glows.emit(z.x + rnd(-4, 4), z.y - 4, 1, [EMBER_COL], [4, 10], [0.4, 0.6], { up: 12, drag: 1 });
    return true;
  }
  destroy() {
    this.decal.destroy();
  }
}
const EMBER_COL = C.o;
void EMBER;

// ================================================================ 万鸦壶

/** 一只火鸦：盘旋的槽位（绕鸦群中心的半径、相位、角速度、飞多高），以及正在做什么。 */
interface Crow {
  s: Sprite;
  sh: Sprite;
  r: number;
  ph: number;
  w: number;
  h: number;
  gold: boolean;
  mode: 'out' | 'circle' | 'dive' | 'up' | 'gone';
  t: number; // 这一段过了多久
  len: number; // 这一段要多久
  from: [number, number, number]; // 这一段从哪里起（x, 地面 y, 高度）
  target: number; // 俯冲扑向哪只
  pos: [number, number, number];
  boom: boolean;
}

/**
 * 万鸦壶的鸦群：从人物身边的壶口一只只飞出去，到敌群上空盘旋（各绕各的小圈、高低错开、翅膀扇着，翅尖落几粒火星）；
 * 轮到谁俯冲，那一只就扑下去啄一口再飞回原来的槽位；盘完（凡、灵）飞回人物身边淡掉；仙品「火鸦」最后一齐扑下去自焚、炸开一小团火。
 * 鸦飞在半空，地上各有一个小影子；离人物胸口 12 像素以内不画（刚飞出壶口的那一截）。器灵「金乌」多一只领头的金乌（大一圈、金色）。
 */
class CrowsView implements ZoneView2 {
  private crows: Crow[] = [];
  private t = 0;
  private hero: () => [number, number] | null;
  private cx: number;
  private cy: number;
  constructor(ctx: Ctx, z: Zone, hero: () => [number, number] | null) {
    this.hero = hero;
    this.cx = z.x;
    this.cy = z.y;
    const n = (z.n ?? 6) + (z.spirit === 'sun' ? 1 : 0);
    const hp = hero() ?? [z.x, z.y];
    for (let i = 0; i < n; i++) {
      const gold = z.spirit === 'sun' && i === n - 1;
      const s = new Sprite();
      s.anchor.set(0.5);
      s.alpha = 0;
      ctx.stage.entities.addChild(s);
      const sh = new Sprite(shadowTex(gold ? 3 : 2));
      sh.anchor.set(0.5);
      sh.alpha = 0;
      ctx.floor.addChild(sh);
      this.crows.push({
        s,
        sh,
        r: rnd(0.25, 0.6) * z.r,
        ph: (i / n) * TAU + rnd(-0.3, 0.3),
        w: rnd(2.2, 3.2) * (i % 2 ? 1 : -1),
        h: rnd(14, 22),
        gold,
        mode: 'out',
        t: -i * 0.05,
        len: 0.35,
        from: [hp[0] + rnd(-3, 3), hp[1], 12],
        target: -1,
        pos: [hp[0], hp[1], 12],
        boom: false,
      });
    }
  }
  /** 第 who 只扑向 target（len 秒扑到）。boom = 仙品最后的自焚。 */
  dive(who: number, target: number, len: number, boom: boolean) {
    const c = this.crows[Math.min(who, this.crows.length - 1)];
    if (!c || c.mode === 'gone') return;
    c.mode = 'dive';
    c.t = 0;
    c.len = Math.max(0.08, len);
    c.from = [...c.pos];
    c.target = target;
    c.boom = boom;
  }
  /** 啄中了 / 炸了（boom 自焚，鸦就没了；sun 金乌落下炸开一团日火，再飞回去）。 */
  hit(ctx: Ctx, who: number, x: number, y: number, boom: boolean, r: number, sun = false) {
    const c = this.crows[Math.min(who, this.crows.length - 1)];
    if (sun) {
      // 日火：一团金红的火、四散的金色火星、一缕淡烟（不画圈）
      ctx.bits.spawn(x, y + 1, { sizes: [2, 4, 5, 4, 2], fps: 12, life: 0.55, z: true, fadeOut: 0.25 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + rnd(-0.4, 0.4);
        ctx.bits.spawn(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.3 + 1, { sizes: [1, 2, 3, 2, 1], fps: 12, life: 0.45, z: true, fadeOut: 0.2, delay: 0.04 + i * 0.03 });
      }
      ctx.sparks.emit(x, y - 6, 12, [C.f, C.Y, C.y, C.o], [40, 90], [0.3, 0.55], { up: 30, g: 80, drag: 2 });
      ctx.bits.spawn(x, y - 10, { frames: puffSet(Math.max(3, Math.round(r * 0.3)), 'smoke', 2), life: 0.6, vy: -10, fadeOut: 0.35, alpha: 0.4 });
    } else if (boom) {
      // 自焚：一小团火、火星、一缕烟，这只鸦就没了
      ctx.bits.spawn(x, y + 1, { sizes: [1, 3, 4, 3, 1], fps: 12, life: 0.5, z: true, fadeOut: 0.2 });
      ctx.sparks.emit(x, y - 6, 8, FIRE_SPARKS, [30, 80], [0.25, 0.5], { up: 30, g: 80, drag: 2 });
      ctx.bits.spawn(x, y - 8, { frames: puffSet(Math.max(3, Math.round(r * 0.3)), 'smoke', 2), life: 0.6, vy: -10, fadeOut: 0.35, alpha: 0.5 });
      if (c) {
        c.mode = 'gone';
        c.s.alpha = 0;
        c.sh.alpha = 0;
      }
      return;
    } else ctx.sparks.emit(x, y - 10, 4, FIRE_SPARKS, [20, 50], [0.2, 0.4], { drag: 2.5, up: 10 });
    if (c && c.mode === 'dive') {
      c.mode = 'up';
      c.t = 0;
      c.len = 0.3;
      c.from = [...c.pos];
    }
  }
  update(dt: number, ctx: Ctx, z: Zone | null, alpha: number): boolean {
    this.t += dt;
    if (z) {
      this.cx = (z.px ?? z.x) + (z.x - (z.px ?? z.x)) * alpha;
      this.cy = (z.py ?? z.y) + (z.y - (z.py ?? z.y)) * alpha;
    }
    const ending = !z || z.life - z.t < 0.05;
    const hp = this.hero();
    let alive = 0;
    for (const c of this.crows) {
      if (c.mode === 'gone') continue;
      c.t += dt;
      if (c.t < 0) continue;
      // 盘旋的槽位（跟着鸦群中心走）
      const ang = c.ph + this.t * c.w;
      const slot: [number, number, number] = [this.cx + Math.cos(ang) * c.r, this.cy + Math.sin(ang) * c.r * 0.6, c.h + Math.sin(this.t * 3 + c.ph) * 1.5];
      if (ending && (c.mode === 'circle' || c.mode === 'out')) {
        // 盘完（没有自焚的）：飞回人物身边、淡掉
        c.mode = 'up';
        c.t = 0;
        c.len = 0.4;
        c.from = [...c.pos];
        c.target = -2;
      }
      let [x, gy, h] = c.pos;
      if (c.mode === 'out' || (c.mode === 'up' && c.target !== -2)) {
        const k = easeOut(clamp01(c.t / c.len));
        x = lerp(c.from[0], slot[0], k);
        gy = lerp(c.from[1], slot[1], k);
        h = lerp(c.from[2], slot[2], k) + Math.sin(Math.PI * k) * 6;
        if (c.t >= c.len) c.mode = 'circle';
      } else if (c.mode === 'up') {
        const k = easeIn(clamp01(c.t / c.len));
        const back: [number, number, number] = hp ? [hp[0], hp[1], 12] : slot;
        x = lerp(c.from[0], back[0], k);
        gy = lerp(c.from[1], back[1], k);
        h = lerp(c.from[2], back[2], k);
        if (c.t >= c.len) {
          c.mode = 'gone';
          c.s.alpha = 0;
          c.sh.alpha = 0;
          continue;
        }
      } else if (c.mode === 'dive') {
        const tp = ctx.enemyPos(c.target);
        const k = easeIn(clamp01(c.t / c.len));
        const tx = tp ? tp[0] : c.from[0];
        const ty = tp ? tp[1] : c.from[1];
        x = lerp(c.from[0], tx, k);
        gy = lerp(c.from[1], ty, k);
        h = lerp(c.from[2], 9, k);
        if (c.t > c.len + 0.4) {
          // 没等到啄中（目标没了）：回去接着盘
          c.mode = 'up';
          c.t = 0;
          c.len = 0.3;
          c.from = [x, gy, h];
        }
      } else {
        [x, gy, h] = slot;
      }
      c.pos = [x, gy, h];
      alive++;
      // 画：俯视的鸦是对称的 V，不朝飞的方向转，只换扇翅的帧（上扬、平展、下压来回扇）；俯冲时翅膀收起
      const frames = Ts(c.gold ? 'crowG' : 'crow', () => (c.gold ? CROW_GOLD : CROW));
      const fr = c.mode === 'dive' ? 3 : CROW_FLAP[Math.floor(this.t * 12 + c.ph * 3) % CROW_FLAP.length];
      c.s.texture = frames[fr];
      const sy = gy - h;
      c.s.position.set(Math.round(x), Math.round(sy));
      c.s.zIndex = gy + 14;
      const near = hp ? Math.hypot(x - hp[0], sy - (hp[1] - 12)) : 99;
      const a = clamp01((near - 12) / 6) * (c.mode === 'up' && c.target === -2 ? 1 - clamp01(c.t / c.len) : 1);
      c.s.alpha = a;
      c.sh.position.set(Math.round(x), Math.round(gy));
      c.sh.alpha = a * 0.16;
      // 翅尖落火星（稀稀的）；俯冲拖一道短短的火尾
      if (a > 0.5 && Math.random() < dt * (c.gold ? 6 : 2.5)) ctx.glows.emit(x + rnd(-4, 4), sy, 1, c.gold ? [C.Y, C.o] : [C.e, C.o], [3, 8], [0.3, 0.5], { g: 30, drag: 1 });
      if (a > 0.5 && c.mode === 'dive') ctx.glows.emit(x, sy - 1, 1, c.gold ? [C.Y, C.y] : [C.o, C.e], [0, 4], [0.12, 0.24], { drag: 4 });
    }
    return alive > 0 || this.t < 0.5;
  }
  destroy() {
    for (const c of this.crows) {
      c.s.destroy();
      c.sh.destroy();
    }
  }
}

/** 人物出手：身边一现万鸦壶（壶嘴朝鸦群那边倾一下），0.6 秒淡掉。离人物胸口约 14 像素，按前后排。 */
class PotFlash implements Effect {
  private t = 0;
  private s: Sprite;
  private where: () => [number, number] | null;
  private dir: number;
  constructor(ctx: Ctx, where: () => [number, number] | null, dir: number) {
    this.where = where;
    this.dir = dir;
    this.s = new Sprite(T('wanyaPot', () => WANYA_POT));
    this.s.anchor.set(0.5, 1);
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
  }
  update(dt: number): boolean {
    this.t += dt;
    const p = this.where();
    if (!p) return false;
    const k = this.t / 0.6;
    this.s.position.set(Math.round(p[0] + this.dir * 14), Math.round(p[1] - 6 - easeOut(clamp01(k * 3)) * 3));
    this.s.zIndex = p[1] + 1;
    this.s.rotation = this.dir * 0.5 * Math.sin(Math.PI * clamp01(k * 1.6));
    this.s.scale.x = this.dir;
    this.s.alpha = clamp01(Math.min(this.t / 0.1, (0.6 - this.t) / 0.25));
    return this.t < 0.6;
  }
  destroy() {
    this.s.destroy();
  }
}

// ================================================================ 四海瓶

const WATER_SPARKS = [C.W, C.Cc, C.c, C.w];
const ICE_SPARKS = [C.W, C.Cc, C.w];
/** 浪头前后五排水柱的高度（第 0 排是最前沿：浪舌下面那道陡的浪面；第 1 排是浪顶；往后缓下去）。 */
const SURGE_DEPTH = [0.8, 1, 0.78, 0.5, 0.26];
/** 浪头离人物多远以内不画（瓶口泻下来、刚涌起的那一截），往外 10 像素显出来。 */
const SURGE_NEAR = 18;

/**
 * 四海瓶的一道浪头：一排排 1 像素宽的水柱拼成（横着沿浪头一根挨一根，两头低、中间高、两头往后弯一点；竖着前后五排，前沿陡、
 * 第二排是浪顶、往后缓下去），每根按脚下的 y 和敌人排前后——浪头推着的敌人站在前沿，从哪个方向推都遮得对；浪花每帧换着花样、
 * 高低随着一道波纹起伏（翻涌）。浪头后面的地上拖着一片渐淡的水痕（贴地，一道道顺着浪走的纹），前沿一道白沫，浪顶不时甩出几滴水。
 * 砸下：浪头猛地涌高一截再塌下去、往前泼开一点，沿着浪头溅起一排水花和水珠，地上留一片白沫慢慢淡掉；
 * 仙品「翻浪」：塌到一半冻成一道矮矮的冰棱（霜白、冰蓝），地上一层霜，片刻后冰棱碎成冰碴。器灵「怒涛」浪更高。
 */
/**
 * 浪头的一根水柱的纹理（高 hh、第 vv 帧、第 d 排、冻没冻住）。一道浪上百根、每帧都要取：按数字查表，
 * 不每次拼一个字符串的键、建一个闭包（docs/perf.md）；纹理还是 fx.ts 的 T() 缓存里的那一张。
 */
const SURGE_TEX = new Map<number, Texture>();
function surgeTex(hh: number, vv: number, d: number, ice: boolean): Texture {
  const key = ((hh * 8 + vv + 2) * 8 + d) * 2 + (ice ? 1 : 0); // vv 是 -2..2（调用处对负数取余），挪成 0..4
  let t = SURGE_TEX.get(key);
  if (!t) {
    t = T(`surgeC${hh}.${vv}.${d}${ice ? 'i' : ''}`, () => surgeColumn(hh, vv, d, ice));
    SURGE_TEX.set(key, t);
  }
  return t;
}
class SurgeView implements ZoneView2 {
  private cols: { s: Sprite; v: number; d: number }[] = [];
  private t = 0;
  private z: Zone;
  private crashT = -1;
  private gone = -1;
  private frost: boolean;
  private H: number;
  private ux: number;
  private uy: number;
  private nx: number;
  private ny: number;
  private cx: number;
  private cy: number;
  private shattered = false;
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    const a = z.a ?? 0;
    this.ux = Math.cos(a);
    this.uy = Math.sin(a);
    this.nx = -this.uy;
    this.ny = this.ux;
    this.frost = z.tier >= 3;
    this.H = [0, 8, 9, 10, 11][Math.max(1, Math.min(4, z.tier))] + (z.spirit === 'rage' ? 2 : 0);
    this.cx = z.x;
    this.cy = z.y;
    const R = Math.round(z.r);
    for (let d = SURGE_DEPTH.length - 1; d >= 0; d--)
      for (let v = -R; v <= R; v++) {
        const sp = new Sprite();
        sp.anchor.set(0.5, 1);
        sp.alpha = 0;
        ctx.stage.entities.addChild(sp);
        this.cols.push({ s: sp, v, d });
      }
  }
  /** 浪头上 (v, d) 那一根的脚下（d 往后为正；fwd 砸下时往前泼开多少）。浪头是往前拱的弧：两头往后弯 bend。 */
  private at(v: number, d: number, fwd = 0): [number, number] {
    const r = Math.max(1, this.z.r);
    const q = v / r;
    const u = -Math.min(8, r * 0.5) * q * q - d + fwd;
    return [this.cx + this.nx * v + this.ux * u, this.cy + this.ny * v + this.uy * u];
  }
  private crash(ctx: Ctx) {
    const R = this.z.r;
    const n = Math.max(3, Math.round(R / 5));
    const up = Math.atan2(this.uy * 0.45 - 1, this.ux * 0.45);
    for (let i = 0; i < n; i++) {
      const v = -R + (2 * R * (i + 0.5)) / n + rnd(-1.5, 1.5);
      const [x, y] = this.at(v, 0, 3);
      ctx.bits.spawn(x, y + 1, { frames: Ts('splash', () => SPLASH), fps: 10, loop: false, life: 0.4, delay: i * 0.025, fadeOut: 0.12, z: true });
      ctx.sparks.emit(x, y - this.H * 0.8, 5, this.frost ? ICE_SPARKS : WATER_SPARKS, [35, 95], [0.35, 0.65], { dir: up, spread: 1.2, g: 170, drag: 1.6 });
      // 浪头砸碎时腾起的一团白色水雾
      if (i % 2 === 0) ctx.bits.spawn(x, y - this.H * 0.7, { frames: puffSet(4, 'snow', 1 + (i % 3)), life: 0.55, vy: -9, delay: 0.03 + i * 0.02, fadeOut: 0.3, alpha: 0.55 });
    }
    ctx.shake.add(0.04);
  }
  update(dt: number, ctx: Ctx, z: Zone | null, alpha: number): boolean {
    this.t += dt;
    if (z) {
      this.z = { ...z };
      const px = z.px ?? z.x;
      const py = z.py ?? z.y;
      this.cx = px + (z.x - px) * alpha;
      this.cy = py + (z.y - py) * alpha;
    } else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const Z = this.z;
    if (Z.nth && this.crashT < 0) {
      this.crashT = 0;
      this.crash(ctx);
    } else if (this.crashT >= 0) this.crashT += dt;
    const ct = this.crashT;
    const sd = Math.hypot(this.cx - Z.x2, this.cy - Z.y2);
    // 离人物 SURGE_NEAR 以内不画（涌起的地方离人物 10 像素）；往上推的浪头要过了人物的头顶才显出来（不然像一顶帽子扣在头上）
    const near = clamp01((sd + 10 - SURGE_NEAR - 16 * Math.max(0, -this.uy)) / 10);
    // 高度：涌起 → 推着走 → 砸下时涌高一截（0.07 秒）再塌（0.32 秒；翻浪塌到一半冻住，0.8 秒时碎开）
    let k = easeOut(clamp01(this.t / 0.14));
    let fwd = 0;
    const ICE_AT = 0.16;
    const SHATTER = 0.8;
    if (ct >= 0) {
      if (ct < 0.08) k = 1 + 0.55 * easeOut(ct / 0.08);
      else k = 1.55 * (1 - clamp01((ct - 0.08) / 0.32)) ** 1.5;
      if (this.frost && ct >= ICE_AT) k = Math.max(k, ct < SHATTER ? 0.42 : 0);
      fwd = 6 * easeOut(clamp01(ct / 0.4));
    } else if (this.gone >= 0) k *= 1 - clamp01(this.gone / 0.2); // 没砸就没了（波次结束）：很快淡掉
    const ice = this.frost && ct >= ICE_AT;
    if (ice && ct >= SHATTER && !this.shattered) {
      this.shattered = true;
      const chips = Ts('chips', () => ICE_CHIPS);
      const R = Z.r;
      for (let i = 0; i < Math.round(R * 0.8); i++) {
        const [x, y] = this.at(rnd(-R, R), rnd(0, 2), fwd);
        ctx.bits.spawn(x, y - rnd(1, 4), { frames: [chips[i % chips.length]], life: rnd(0.4, 0.7), vx: rnd(-20, 20), vy: -rnd(30, 60), g: 260, ground: y + rnd(0, 3), bounce: 0.3, fadeOut: 0.25, z: true });
      }
      ctx.sound('hanbing.spike', 0.45, 0.1);
    }
    const R = Z.r;
    const fadeAll = ct >= 0 ? (this.frost ? (ct < SHATTER ? 1 : 1 - clamp01((ct - SHATTER) / 0.08)) : 1) : 1;
    for (const c of this.cols) {
      const q = c.v / Math.max(1, R);
      const churn = 1 + 0.14 * Math.sin(c.v * 0.75 - this.t * 11 + c.d * 0.6) + 0.08 * Math.sin(c.v * 1.9 + this.t * 7);
      const h = this.H * (0.3 + 0.7 * (1 - q * q) ** 0.8) * SURGE_DEPTH[c.d] * (ice ? 1 : churn) * k;
      if (h < 0.6 || near <= 0) {
        c.s.alpha = 0;
        continue;
      }
      const [gx, gy] = this.at(c.v, c.d, fwd);
      const hh = Math.max(1, Math.round(h));
      const vv = ice ? 0 : Math.floor(this.t * 12 + c.v * 1.7 + c.d * 2.3) % 3;
      c.s.texture = surgeTex(hh, vv, c.d, ice);
      c.s.position.set(Math.round(gx), Math.round(gy));
      c.s.zIndex = gy;
      c.s.alpha = (ice ? 0.95 : 0.9) * near * fadeAll * Math.min(1, (1 - Math.abs(q)) * 4 + 0.25);
    }
    // 贴地：浪头后面拖着的水痕（顺着浪走的纹，越往后越淡）；前沿一道白沫
    const ebb = ct >= 0 ? 1 - clamp01(ct / 0.45) : this.gone >= 0 ? 1 - clamp01(this.gone / 0.2) : 1;
    const trailMax = Math.min(sd + 6, 22);
    if (ebb > 0 && near > 0)
      for (let v = -Math.floor(R); v <= R; v++) {
        const q = Math.abs(v) / Math.max(1, R);
        const edge = (1 - q * q) ** 0.7;
        // 水痕的后沿参差（每一纵各长各的），两头短：后沿是一道软的弧，不是一条直边
        const trail = trailMax * (0.55 + 0.3 * hashN(v + 90, 3) + 0.15 * Math.sin(v * 0.5)) * (1 - 0.45 * q * q);
        const streak = ((v % 6) + 6) % 6 === 0; // 一道道顺着浪走的亮纹
        for (let d = 5; d < trail; d++) {
          const [x, y] = this.at(v, d, fwd);
          const f = (1 - d / trail) ** 1.2;
          ctx.under.dot(x, y, streak && d > 6 ? C.Cc : d < 9 ? C.c : C.n, (streak ? 0.45 : 0.32) * f * near * ebb * edge);
        }
        if (ct < 0 && hashN(v, Math.floor(this.t * 14)) > 0.35) {
          const [x, y] = this.at(v, -1, 0);
          ctx.under.dot(x, y, C.W, 0.75 * near * edge);
        }
      }
    // 砸下之后：往前泼开的一片白沫（翻浪是一层霜），慢慢淡掉
    if (ct >= 0) {
      const life = this.frost ? 1.1 : 0.65;
      const fa = 1 - clamp01(ct / life);
      const reach = 4 + 10 * easeOut(clamp01(ct / 0.35));
      if (fa > 0)
        for (let v = -Math.floor(R); v <= R; v++)
          for (let d = -Math.floor(reach); d <= 3; d++) {
            if (hashN(v * 3 + 7, d + 40) < (this.frost ? 0.45 : 0.6)) continue;
            const [x, y] = this.at(v, d, fwd);
            const edge = (1 - (Math.abs(v) / Math.max(1, R)) ** 2) ** 0.7;
            ctx.under.dot(x, y, this.frost ? (hashN(v, d) < 0.5 ? C.W : 0xc3ccd2) : hashN(v, d) < 0.6 ? C.W : C.Cc, 0.6 * fa * edge);
          }
    }
    // 浪顶甩出的水珠
    if (ct < 0 && this.gone < 0 && near > 0.5 && Math.random() < dt * (8 + R * 0.4)) {
      const v = rnd(-R * 0.8, R * 0.8);
      const [x, y] = this.at(v, 1, 0);
      const hh = this.H * (0.55 + 0.45 * (1 - (v / R) ** 2));
      ctx.sparks.emit(x, y - hh, 1, WATER_SPARKS, [25, 55], [0.3, 0.5], { dir: Math.atan2(this.uy * 0.6 - 1, this.ux * 0.6), spread: 0.7, g: 170, drag: 1.4 });
    }
    if (ice && ct < SHATTER && Math.random() < dt * 5) {
      const [x, y] = this.at(rnd(-R, R), 1, fwd);
      ctx.bits.spawn(x, y - rnd(2, 5), { frames: Ts('star', () => STAR).slice(0, 3), fps: 10, loop: false, life: 0.3, fadeOut: 0.12, z: true });
    }
    const end = ct >= 0 ? (this.frost ? 1.15 : 0.7) : 0.25;
    return ct >= 0 ? ct < end : this.gone < 0 || this.gone < end;
  }
  destroy() {
    for (const c of this.cols) c.s.destroy();
  }
}

/** 小整数的 0..1 散列（贴地水痕、白沫的花样，每帧不变）。 */
function hashN(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 人物出手：身边一现四海瓶，瓶口朝浪头那边一倾、泻下一道水（落在浪头涌起的地方），0.65 秒淡掉。离人物 13 像素，按前后排。 */
class VaseFlash implements Effect {
  private t = 0;
  private s: Sprite;
  private where: () => [number, number] | null;
  private a: number;
  private side: number;
  constructor(ctx: Ctx, where: () => [number, number] | null, a: number) {
    this.where = where;
    this.a = a;
    this.side = Math.cos(a) >= 0 ? 1 : -1;
    this.s = new Sprite(T('sihaiVase', () => SIHAI_VASE));
    this.s.anchor.set(0.5, 0.85);
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const p = this.where();
    if (!p) return false;
    const t = this.t;
    const x = p[0] + this.side * 13;
    const y = p[1] - 8 - easeOut(clamp01(t * 5)) * 2;
    const tilt = this.side * 1.05 * easeOut(clamp01(t / 0.16)) * (1 - easeIn(clamp01((t - 0.42) / 0.2)));
    this.s.position.set(Math.round(x), Math.round(y));
    this.s.rotation = tilt;
    this.s.zIndex = p[1] + 1;
    this.s.alpha = clamp01(Math.min(t / 0.08, (0.65 - t) / 0.2));
    // 瓶口泻下来的水
    if (t > 0.08 && t < 0.42) {
      const mx = x + Math.sin(tilt) * 15;
      const my = y - Math.cos(tilt) * 15;
      ctx.sparks.emit(mx, my, 1, WATER_SPARKS, [20, 45], [0.18, 0.3], { dir: Math.atan2(1, this.side * 0.8), spread: 0.35, g: 240, drag: 1 });
    }
    return t < 0.65;
  }
  destroy() {
    this.s.destroy();
  }
}

// ================================================================ 雾露乾坤网

/** 地上的圆画成扁的：竖着 ×NET_SQ。 */
const NET_SQ = 0.62;
/** 网兜拢起来多高（网顶离地）。 */
const NET_H = 18;

/** 一段线（逐像素点）。 */
function seg(px: Pixels, x0: number, y0: number, x1: number, y1: number, color: number, alpha: number, sag = 0, sx = 0, sy = 0) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const b = Math.sin(Math.PI * t) * sag;
    px.dot(lerp(x0, x1, t) + sx * b, lerp(y0, y1, t) + sy * b, color, alpha);
  }
}

/**
 * 雾露乾坤网：张着的时候是地上一张从网心铺开的银网（十来根网纲、三圈网眼，圈与圈之间往里垂一点，边是一圈往里垂的波浪，不是一道硬圈），
 * 网结上挂着露珠一闪一闪，网上飘着几缕薄雾；收网时网边离地升起、往里收，拢成一个网兜（网顶一个结，高约 18）：前半边画在角色之上
 * （网住的敌人看着就在网里），后半边贴地；定身的那一阵网兜轻轻晃；收完化成一阵雾散掉。
 * 仙品「乾坤」：网兜缩成一团水球、把网住的拽进去，再砸下溅开。落空（张够了没等到敌人）：网淡成雾散掉。
 */
class NetView implements ZoneView2 {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private springT = -1;
  private slamT = -1;
  private K: number;
  private seed: number;
  private ball: Sprite | null = null;
  private mistCd = 0.2;
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    this.K = z.r > 32 ? 12 : 10;
    this.seed = z.id % 7;
    for (let i = 0; i < 2; i++) ctx.bits.spawn(z.x + rnd(-z.r, z.r) * 0.4, z.y + rnd(-z.r, z.r) * 0.25, { frames: puffSet(3, 'snow', 1 + (i % 3)), life: 0.6, vy: -5, delay: 0.05 + i * 0.06, alpha: 0.16, fadeIn: 0.15, fadeOut: 0.35 });
  }
  /** 第 j 根网纲在第 i 圈（0 网边 … M 网心 / 网顶）的位置。lift 0 铺在地上、1 拢成网兜；R 网边多大。 */
  private knot(j: number, i: number, M: number, R: number, lift: number, sway: number): [number, number] {
    const a = (j / this.K) * TAU + this.seed * 0.3;
    const k = i / M;
    const rr = R * (1 - k) * (1 - 0.4 * lift);
    const h = lift * (NET_H * Math.pow(k, 0.7) + 2 * (1 - k));
    return [this.z.x + Math.cos(a) * rr + sway * k, this.z.y + Math.sin(a) * rr * NET_SQ - h];
  }
  update(dt: number, ctx: Ctx, z: Zone | null): boolean {
    this.t += dt;
    if (z) this.z = { ...z };
    else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const Z = this.z;
    if (Z.nth === 1 && this.springT < 0) this.springT = 0;
    else if (this.springT >= 0) this.springT += dt;
    if (Z.n && this.slamT < 0) {
      this.slamT = 0;
      this.slam(ctx);
    } else if (this.slamT >= 0) this.slamT += dt;
    const st = this.springT;
    const qian = Z.tier >= 3 && st >= 0;
    // 收完 / 落空 / 砸下之后：淡掉
    const fade = this.slamT >= 0 ? 1 - clamp01(this.slamT / 0.08) : this.gone >= 0 ? 1 - clamp01(this.gone / 0.35) : Z.nth === 2 ? 1 - clamp01((Z.t - (Z.life - 0.4)) / 0.4) : 1;
    if (this.gone > 0.4 || (this.slamT > 0.5 && !this.ball)) return false;
    const unfold = easeOut(clamp01(this.t / 0.25));
    const lift = st >= 0 ? easeOut(clamp01(st / 0.18)) : 0;
    // 乾坤：网兜往里缩成水球
    const cinch = qian ? (Z.prey !== undefined ? easeIn(clamp01((st - 0.06) / 0.24)) : easeIn(clamp01((st - 0.12) / 0.38))) : 0;
    const R = Z.r * unfold * (1 - 0.85 * cinch);
    const sway = st >= 0 ? Math.sin(this.t * 6) * 1.3 * lift * (1 - cinch) : 0;
    const M = 3;
    const a0 = (st >= 0 ? 0.85 : 0.6) * fade;
    if (a0 > 0.01 && R > 1) {
      // 网纲
      for (let j = 0; j < this.K; j++) {
        const ang = (j / this.K) * TAU + this.seed * 0.3;
        const front = lift > 0 && Math.sin(ang) > 0;
        const px = front ? ctx.top : ctx.under;
        for (let i = 0; i < M; i++) {
          const [x0, y0] = this.knot(j, i, M, R, lift, sway);
          const [x1, y1] = this.knot(j, i + 1, M, R, lift, sway);
          seg(px, x0, y0, x1, y1, C.Cc, a0 * (front ? 0.8 : 1));
        }
      }
      // 网眼的圈：两根网纲之间往里垂（铺着）/ 往下垂（拢起来）
      for (let i = 0; i < M; i++) {
        for (let j = 0; j < this.K; j++) {
          const [x0, y0] = this.knot(j, i, M, R, lift, sway);
          const [x1, y1] = this.knot(j + 1, i, M, R, lift, sway);
          const mid = ((j + 0.5) / this.K) * TAU + this.seed * 0.3;
          const front = lift > 0 && Math.sin(mid) > 0;
          const sagIn = (1 - lift) * 0.16 * Math.hypot(x1 - x0, y1 - y0);
          const sagDown = lift * 1.5;
          seg(front ? ctx.top : ctx.under, x0, y0, x1, y1, i === 0 ? C.c : C.Cc, a0 * (i === 0 ? 1 : 0.85) * (front ? 0.8 : 1), 1, -Math.cos(mid) * sagIn, -Math.sin(mid) * sagIn * NET_SQ + sagDown);
        }
      }
      // 露珠：网结上一闪一闪
      if (unfold > 0.8)
        for (let i = 0; i < M; i++)
          for (let j = 0; j < this.K; j++) {
            const tw = 0.5 + 0.5 * Math.sin(this.t * 5 + j * 1.7 + i * 2.3);
            if (tw < 0.55) continue;
            const [x, y] = this.knot(j, i, M, R, lift, sway);
            const ang = (j / this.K) * TAU + this.seed * 0.3;
            (lift > 0 && Math.sin(ang) > 0 ? ctx.top : ctx.under).dot(x, y, C.W, a0 * tw);
          }
      // 网顶的结（拢起来以后）
      if (lift > 0.3) {
        const [x, y] = this.knot(0, M, M, R, lift, sway);
        ctx.top.dot(x, y, C.W, a0);
        ctx.top.dot(x, y + 1, C.c, a0);
      }
    }
    // 网上飘着的薄雾
    this.mistCd -= dt;
    if (this.mistCd <= 0 && fade > 0.5 && this.slamT < 0) {
      this.mistCd = rnd(0.35, 0.6);
      ctx.bits.spawn(Z.x + rnd(-Z.r, Z.r) * 0.6, Z.y + rnd(-Z.r, Z.r) * 0.35 - lift * 8, { frames: puffSet(3, 'snow', 1 + Math.floor(rnd(0, 3))), life: rnd(0.8, 1.1), vx: rnd(-6, 6), vy: -4, alpha: 0.15, fadeIn: 0.25, fadeOut: 0.5 });
    }
    // 乾坤：水球
    if (qian && cinch > 0.05 && this.slamT < 0) {
      if (!this.ball) {
        this.ball = new Sprite(T('wuluBall', () => waterBall(7)));
        this.ball.anchor.set(0.5);
        ctx.stage.entities.addChild(this.ball);
      }
      const k = cinch;
      this.ball.scale.set(0.35 + 0.65 * k);
      this.ball.position.set(Math.round(Z.x), Math.round(Z.y - 9 * k - 2));
      this.ball.zIndex = Z.y + 6;
      this.ball.alpha = 0.9 * clamp01(k * 2);
      if (Math.random() < dt * 20) ctx.sparks.emit(Z.x + rnd(-8, 8), Z.y - 9 * k + rnd(-5, 5), 1, WATER_SPARKS, [5, 15], [0.2, 0.3], { drag: 3 });
    }
    if (this.ball && this.slamT >= 0) {
      // 砸下：水球落地（0.08 秒）
      const k = clamp01(this.slamT / 0.08);
      this.ball.position.set(Math.round(Z.x), Math.round(Z.y - 11 * (1 - k)));
      this.ball.alpha = 0.9 * (1 - k);
      if (k >= 1) {
        this.ball.destroy();
        this.ball = null;
      }
    }
    // 收完：化成一阵雾
    if (this.gone >= 0 && this.gone - dt <= 0 && this.springT >= 0 && this.slamT < 0)
      for (let i = 0; i < 3; i++) ctx.bits.spawn(Z.x + rnd(-Z.r, Z.r) * 0.45, Z.y - rnd(4, 12), { frames: puffSet(3, 'snow', 1 + (i % 3)), life: 0.6, vy: -7, delay: i * 0.04, alpha: 0.2, fadeIn: 0.1, fadeOut: 0.35 });
    return true;
  }
  private slam(ctx: Ctx) {
    const Z = this.z;
    const R = 14;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rnd(-0.3, 0.3);
      ctx.bits.spawn(Z.x + Math.cos(a) * R * 0.7, Z.y + Math.sin(a) * R * 0.7 * NET_SQ + 1, { frames: Ts('splash', () => SPLASH), fps: 10, loop: false, life: 0.4, delay: 0.06 + i * 0.015, fadeOut: 0.12, z: true });
    }
    ctx.sparks.emit(Z.x, Z.y - 4, 16, WATER_SPARKS, [40, 95], [0.35, 0.6], { up: 40, g: 170, drag: 1.5 });
    ctx.bits.spawn(Z.x, Z.y - 6, { frames: puffSet(5, 'snow', 2), life: 0.5, vy: -8, delay: 0.05, alpha: 0.45, fadeOut: 0.3 });
    ctx.shake.add(0.05);
  }
  destroy() {
    this.ball?.destroy();
  }
}

/** 人物出手：一缕薄雾从人物手边飘向网张开的地方（0.3 秒）。 */
function netCast(ctx: Ctx, from: [number, number], x: number, y: number) {
  for (let i = 0; i < 6; i++) {
    const k = (i + 1) / 7;
    ctx.glows.emit(lerp(from[0], x, k), lerp(from[1] - 10, y, k), 1, [C.W, C.Cc], [2, 6], [0.25, 0.4], { drag: 2 });
  }
}

// ================================================================ 七宝妙树

/** 七宝的颜色（画面里的数值色，和 GEM_COLORS 一一对应）。 */
const GEM_RGB = [C.Y, C.Cc, C.w, C.m, C.e, C.j, C.l];

/**
 * 七宝妙树的一刷：人物手里一枝金色的妙树绕身转一圈（握手离人物胸口 7 像素，枝头朝外），枝头扫过的地方拖出一道宝光——
 * 几道顺着转向的细弧（像刷子的毛），从枝头一直刷到判定的边上，越往后越淡，只留身后约一弧度（不是一整圈）；
 * 刷的时候枝头甩出几片翠叶、几点宝石色的光。双刷：刷完反着刷回来一遍。妙树在人物前面那半圈画在人物前面，后面那半圈在后面。
 */
class SweepView implements ZoneView2 {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private s: Sprite;
  private trail: { a: number; t: number }[] = [];
  private leafCd = 0;
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    this.s = new Sprite();
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
  }
  update(dt: number, ctx: Ctx, z: Zone | null, alpha: number): boolean {
    this.t += dt;
    if (z) {
      const pa = this.z.a ?? 0;
      this.z = { ...z };
      // 角度插值（模拟每帧更新 a）
      const a = z.a ?? 0;
      this.z.a = pa + (a - pa) * alpha;
      const px = z.px ?? z.x;
      const py = z.py ?? z.y;
      this.z.x = px + (z.x - px) * alpha;
      this.z.y = py + (z.y - py) * alpha;
    } else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    const Z = this.z;
    const a = Z.a ?? 0;
    const fade = this.gone >= 0 ? 1 - clamp01(this.gone / 0.18) : 1;
    if (this.gone > 0.3) return false;
    // 妙树：握手在胸口外 7 像素，枝头朝外
    const cx = Z.x;
    const cy = Z.y - 10;
    const gx = cx + Math.cos(a) * 7;
    const gy = cy + Math.sin(a) * 5;
    applyRot(this.s, rotTex('miaoshuTree', MIAOSHU_TREE, a, MIAOSHU_GRIP.x, MIAOSHU_GRIP.y, 32));
    this.s.position.set(Math.round(gx), Math.round(gy));
    this.s.zIndex = Z.y + Math.sin(a) * 3;
    this.s.alpha = clamp01(this.t / 0.05) * fade;
    // 宝光：记下枝头扫过的角度，从枝头一直刷到判定的边上——一片往后淡下去的扇（翠色的光，外沿一道灵光），只留身后约一弧度
    if (this.gone < 0) this.trail.push({ a, t: this.t });
    const LIFE = 0.13;
    while (this.trail.length && this.t - this.trail[0].t > LIFE) this.trail.shift();
    const R = Z.r;
    const r0 = 20;
    const SQ = 0.9;
    for (let i = 1; i < this.trail.length; i++) {
      const p0 = this.trail[i - 1];
      const p1 = this.trail[i];
      const k = (1 - (this.t - p1.t) / LIFE) * fade;
      if (k <= 0) continue;
      const steps = Math.max(1, Math.ceil(Math.abs(p1.a - p0.a) * R * 0.9));
      for (let s2 = 0; s2 < steps; s2++) {
        const aa = lerp(p0.a, p1.a, s2 / steps);
        const ca = Math.cos(aa);
        const sa = Math.sin(aa);
        for (let rr = r0; rr <= R; rr += 1.5) {
          const q = (rr - r0) / (R - r0);
          const rim = rr > R - 2.5;
          const x = cx + ca * rr;
          const y = Z.y - 3 + sa * rr * SQ;
          // 毛：几道稍亮的细弧（像刷子的毛）
          const bristle = Math.abs(((rr * 0.45) % 1) - 0.5) < 0.12;
          const col = rim ? C.f : bristle ? C.L : C.l;
          const al = rim ? 0.9 : (bristle ? 0.55 : 0.3) * (0.35 + 0.65 * q) * clamp01((rr - r0) / 6);
          ctx.under.dot(x, y, col, al * k);
        }
      }
    }
    // 枝头甩出的翠叶、宝光点
    this.leafCd -= dt;
    if (this.gone < 0 && this.leafCd <= 0) {
      this.leafCd = 0.03;
      const rr = rnd(r0, R);
      const x = cx + Math.cos(a) * rr;
      const y = Z.y - 3 + Math.sin(a) * rr * SQ;
      const tang = a + (Z.spin ?? 1) * Math.PI / 2;
      ctx.glows.emit(x, y, 1, Math.random() < 0.6 ? [C.L, C.l] : [GEM_RGB[Math.floor(rnd(0, 7))]], [10, 30], [0.25, 0.4], { dir: tang, spread: 0.5, drag: 2 });
    }
    return true;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 飞出去的一宝：十字小宝石（按色），身后拖几点同色的光；打中炸开一下（仙品炸开一小圈宝光）。 */
class GemView {
  private s: Sprite;
  /** 最后画在哪儿。 */
  at: [number, number] = [0, 0];
  private color: number;
  private tier: number;
  constructor(ctx: Ctx, color: number, tier: number) {
    this.color = color;
    this.tier = tier;
    this.s = new Sprite(T(`gem${color % 7}`, () => gemGrid(color)));
    this.s.anchor.set(0.5);
    ctx.stage.entities.addChild(this.s);
  }
  update(ctx: Ctx, x: number, y: number, hero: [number, number] | null) {
    this.at = [x, y];
    this.s.position.set(Math.round(x), Math.round(y));
    this.s.zIndex = y + 12;
    // 离人物胸口 12 像素以内不画（刚从树上飞出来的那一截）
    const near = hero ? Math.hypot(x - hero[0], y - (hero[1] - 10)) : 99;
    this.s.alpha = clamp01((near - 12) / 4);
    if (this.s.alpha > 0.5 && Math.random() < 0.7) ctx.glows.emit(x, y, 1, [GEM_RGB[this.color % 7], C.f], [0, 6], [0.15, 0.3], { drag: 3 });
  }
  /** 散了：打中的话炸开一下（仙品起炸开一小圈宝光）。 */
  end(ctx: Ctx, hit: boolean) {
    const [x, y] = this.at;
    const big = this.tier >= 3;
    if (hit) {
      ctx.sparks.emit(x, y, big ? 9 : 5, [GEM_RGB[this.color % 7], C.f, C.W], [25, 60], [0.2, 0.4], { drag: 2.5 });
      if (big) ctx.bits.spawn(x, y, { frames: Ts('star', () => STAR), fps: 14, loop: false, life: 0.3, fadeOut: 0.12, z: true, zOff: 12 });
    }
  }
  destroy() {
    this.s.destroy();
  }
}

// ================================================================ 瘟癀伞

/** 瘟的颜色：枯黄、葱黄、石绿（瘟神多一点胭脂紫）。 */
const PLAGUE_COLS = [0xc8b07a, C.L, C.l];
const GOD_COLS = [C.p, 0xc8b07a, C.l];
/** 伞撑多高（伞柄末端离地）。 */
const UMB_H = 27;

/**
 * 瘟癀伞：浮在敌群上空（伞柄末端离地约 27，伞顶约 37），慢慢转着、轻轻晃，从收着到撑开约 0.25 秒；伞下的地上是一片软边的黄绿瘟雾
 * （贴地，一块块浓淡不匀、慢慢翻动，边上淡出去，不是一道硬圈），伞沿不停飘下几点黄绿的瘟尘；收伞时伞合上、淡掉，瘟雾也散了。
 */
/** 染瘟的敌人脚下那团瘟气：按列先算好的一道正弦（最宽 2 × (7 + 层数) + 1）。 */
const PLAGUE_NX = new Float64Array(64);
/** 瘟雾按列先算好的三道正弦（所有伞共用一块，不够长再换）。 */
let FOG = new Float64Array(512);
class UmbrellaView implements ZoneView2 {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private s: Sprite;
  private sh: Sprite;
  constructor(ctx: Ctx, z: Zone) {
    this.z = { ...z };
    this.s = new Sprite(Ts('umbrella', () => UMBRELLA)[0]);
    this.s.anchor.set(UMBRELLA_TIP.x / 21, UMBRELLA_TIP.y / 11);
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
    this.sh = new Sprite(shadowTex(8));
    this.sh.anchor.set(0.5);
    this.sh.alpha = 0;
    ctx.floor.addChild(this.sh);
  }
  update(dt: number, ctx: Ctx, z: Zone | null, alpha: number): boolean {
    this.t += dt;
    if (z) {
      this.z = { ...z };
      const px = z.px ?? z.x;
      const py = z.py ?? z.y;
      this.z.x = px + (z.x - px) * alpha;
      this.z.y = py + (z.y - py) * alpha;
    } else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    if (this.gone > 0.4) return false;
    const Z = this.z;
    const open = easeOut(clamp01(this.t / 0.25)) * (this.gone >= 0 ? 1 - easeIn(clamp01(this.gone / 0.3)) : 1);
    const fade = this.gone >= 0 ? 1 - clamp01(this.gone / 0.35) : 1;
    // 伞：收着的时候窄、撑开变宽；慢慢转（换伞骨的帧）、轻轻晃
    const frames = Ts('umbrella', () => UMBRELLA);
    this.s.texture = frames[Math.floor(this.t * 3) % frames.length];
    const sway = Math.sin(this.t * 1.7) * 1.2;
    this.s.position.set(Math.round(Z.x + sway), Math.round(Z.y - UMB_H - Math.sin(this.t * 2.3) * 1));
    this.s.scale.set(0.45 + 0.55 * open, 1);
    this.s.zIndex = Z.y + 30; // 在半空：盖在伞下的敌人头上
    this.s.alpha = clamp01(this.t / 0.12) * fade;
    this.sh.position.set(Math.round(Z.x), Math.round(Z.y));
    this.sh.alpha = 0.12 * open * fade;
    // 伞下的瘟雾：贴地一片软边的黄绿，浓淡不匀、慢慢翻动
    const R = Z.r * (0.4 + 0.6 * open);
    const k = 0.62 * fade * clamp01(this.t / 0.4);
    if (k > 0.01) {
      // 一把伞下面五六千个像素、每帧都画：浓淡的三道正弦按列、按行先算好（第三道 sin(x + y) 用和角公式拆成列和行的乘积），
      // 每个像素只剩几次乘加，不再各算三次 sin 和一次 hypot（docs/perf.md）。画出来的和逐像素算的一样。
      const n = Math.floor(2 * R) + 1;
      if (FOG.length < n * 3) FOG = new Float64Array(n * 3 + 64);
      const fog = FOG;
      let i = 0;
      for (let x = -R; x <= R; x += 1, i++) {
        fog[i] = Math.sin(x * 0.31 + this.t * 1.3);
        fog[n + i] = Math.sin(x * 0.23 + this.t * 0.7);
        fog[2 * n + i] = Math.cos(x * 0.23 + this.t * 0.7);
      }
      const RR = R * R;
      for (let y = -R; y <= R; y += 1) {
        const yy = y / 0.62;
        const ny = Math.sin(y * 0.47 - this.t * 0.9);
        const cy = Math.cos(y * 0.23);
        const sy = Math.sin(y * 0.23);
        i = 0;
        for (let x = -R; x <= R; x += 1, i++) {
          const d2 = (x * x + yy * yy) / RR;
          if (d2 > 1) continue;
          const nn = fog[i] + ny + fog[n + i] * cy + fog[2 * n + i] * sy;
          const a = k * (1 - d2) * (0.45 + 0.18 * nn);
          if (a < 0.04) continue;
          ctx.under.dot(Z.x + x, Z.y + y, nn > 1.4 ? C.L : nn > -0.2 ? C.l : C.v, a);
        }
      }
    }
    // 伞沿飘下的瘟尘
    if (open > 0.7 && this.gone < 0 && Math.random() < dt * 14) {
      const a = rnd(0, TAU);
      const rr = rnd(0.2, 1) * 9;
      ctx.glows.emit(Z.x + sway + Math.cos(a) * rr, Z.y - UMB_H - 2 + Math.sin(a) * rr * 0.3, 1, Z.spirit === 'god' ? GOD_COLS : PLAGUE_COLS, [3, 9], [0.6, 0.9], { dir: Math.PI / 2, spread: 0.6, g: 12, drag: 1 });
    }
    return true;
  }
  destroy() {
    this.s.destroy();
    this.sh.destroy();
  }
}

/** 伞尖滴下的一滴瘟液：从伞下落到那只头上（0.12 秒），落上去溅开一点黄绿。 */
class PlagueDrop implements Effect {
  private t = 0;
  private s: Sprite;
  private id: number;
  private from: [number, number];
  constructor(ctx: Ctx, id: number, from: [number, number]) {
    this.id = id;
    this.from = from;
    this.s = new Sprite(T('plagueDrop', () => PLAGUE_DROP));
    this.s.anchor.set(0.5);
    ctx.stage.entities.addChild(this.s);
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const p = ctx.enemyPos(this.id);
    const e = ctx.enemy(this.id);
    const tx = p ? p[0] : this.from[0];
    const ty = p ? p[1] - (e ? headOf(e.kind) : 16) : this.from[1] + 10;
    const k = easeIn(clamp01(this.t / 0.12));
    const x = lerp(this.from[0], tx, k);
    const y = lerp(this.from[1], ty, k);
    this.s.position.set(Math.round(x), Math.round(y));
    this.s.zIndex = (p ? p[1] : this.from[1] + UMB_H) + 20;
    if (this.t >= 0.12) {
      ctx.glows.emit(tx, ty, 5, PLAGUE_COLS, [12, 30], [0.25, 0.4], { up: 10, g: 40, drag: 2 });
      return false;
    }
    return true;
  }
  destroy() {
    this.s.destroy();
  }
}

/** 瘟从一只传给身边的：一缕黄绿的瘟气顺着弧线飘过去（0.25 秒）。 */
class PlagueWisp implements Effect {
  private t = 0;
  private a: number;
  private b: number;
  private god: boolean;
  constructor(a: number, b: number, god: boolean) {
    this.a = a;
    this.b = b;
    this.god = god;
  }
  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const pa = ctx.enemyPos(this.a);
    const pb = ctx.enemyPos(this.b);
    if (!pa || !pb) return false;
    const k = clamp01(this.t / 0.25);
    for (let i = 0; i < 3; i++) {
      const q = clamp01(k - i * 0.08);
      if (q <= 0) continue;
      const x = lerp(pa[0], pb[0], q);
      const y = lerp(pa[1] - 12, pb[1] - 12, q) - Math.sin(Math.PI * q) * 8;
      ctx.top.dot(x, y, this.god ? C.p : i === 0 ? C.L : 0xc8b07a, 0.75 * (1 - i * 0.25));
    }
    if (Math.random() < 0.5) {
      const x = lerp(pa[0], pb[0], k);
      const y = lerp(pa[1] - 12, pb[1] - 12, k) - Math.sin(Math.PI * k) * 8;
      ctx.glows.emit(x, y, 1, this.god ? GOD_COLS : PLAGUE_COLS, [2, 6], [0.25, 0.4], { drag: 2 });
    }
    return this.t < 0.25;
  }
  destroy() {}
}

// ================================================================ 落宝金钱

/**
 * 落宝金钱：一枚带翅的方孔金钱，飞的时候离地约 20、扇着翅；附上以后停在那只头顶上方 4 像素轻轻起伏，每敲一下往下一磕（0.12 秒）、
 * 迸出几粒金星，钱声震开的那一圈地上掠过一点金尘（贴地、很淡，不画圈）；仙品「落宝」：附着的那只身上不停往下掉几点宝光（金色的光点落到地上）。
 * 地上有个小影子。收回去的时候淡掉。
 */
class CoinView implements ZoneView2 {
  private t = 0;
  private z: Zone;
  private gone = -1;
  private s: Sprite;
  private sh: Sprite;
  private knockT = -1;
  private pos: [number, number, number] = [0, 0, 20];
  private hero: () => [number, number] | null;
  constructor(ctx: Ctx, z: Zone, hero: () => [number, number] | null) {
    this.hero = hero;
    this.z = { ...z };
    this.s = new Sprite(Ts('coin', () => COIN_FRAMES)[0]);
    this.s.anchor.set(0.5);
    this.s.alpha = 0;
    ctx.stage.entities.addChild(this.s);
    this.sh = new Sprite(shadowTex(3));
    this.sh.anchor.set(0.5);
    this.sh.alpha = 0;
    ctx.floor.addChild(this.sh);
    this.pos = [z.x, z.y, 20];
  }
  knock(ctx: Ctx, r: number) {
    this.knockT = 0;
    const [x, y, h] = this.pos;
    ctx.sparks.emit(x, y - h + 4, 4, GOLD_SPARKS, [25, 55], [0.15, 0.3], { drag: 3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rnd(-0.4, 0.4);
      ctx.glows.emit(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.3, 1, [C.Y, C.f], [r * 0.8, r * 1.4], [0.2, 0.3], { dir: a, spread: 0.2, drag: 4 });
    }
  }
  update(dt: number, ctx: Ctx, z: Zone | null, alpha: number): boolean {
    this.t += dt;
    if (z) this.z = { ...z };
    else if (this.gone < 0) this.gone = 0;
    if (this.gone >= 0) this.gone += dt;
    if (this.gone > 0.3) return false;
    const Z = this.z;
    const target = (Z.ids ?? [])[0];
    const tp = target !== undefined ? ctx.enemyPos(target) : null;
    const te = target !== undefined ? ctx.enemy(target) : undefined;
    let x: number;
    let gy: number;
    let h: number;
    if (!Z.nth && tp && te) {
      // 附着：那只头顶上方
      x = tp[0];
      gy = tp[1];
      h = headOf(te.kind) + 4 + Math.sin(this.t * 6) * 1.2;
    } else {
      const px = Z.px ?? Z.x;
      const py = Z.py ?? Z.y;
      x = px + (Z.x - px) * alpha;
      gy = py + (Z.y - py) * alpha;
      h = 20 + Math.sin(this.t * 8) * 1.5;
    }
    // 敲一下：往下一磕
    if (this.knockT >= 0) {
      this.knockT += dt;
      const k = this.knockT / 0.12;
      if (k >= 1) this.knockT = -1;
      else h -= Math.sin(Math.PI * k) * 5;
    }
    // 飞的时候追得平顺一点（不瞬移）
    const sm = Math.min(1, dt * 18);
    this.pos = [lerp(this.pos[0], x, sm), lerp(this.pos[1], gy, sm), lerp(this.pos[2], h, sm)];
    const [cx, cy, ch] = this.pos;
    const frames = Ts('coin', () => COIN_FRAMES);
    this.s.texture = frames[COIN_FLAP[Math.floor(this.t * 14) % COIN_FLAP.length]];
    this.s.position.set(Math.round(cx), Math.round(cy - ch));
    this.s.zIndex = cy + 20;
    const fade = this.gone >= 0 ? 1 - clamp01(this.gone / 0.25) : 1;
    // 离人物胸口 14 像素以内不画（刚出手的那一截）
    const hp = this.hero();
    const near = hp ? clamp01((Math.hypot(cx - hp[0], cy - ch - (hp[1] - 12)) - 14) / 5) : 1;
    this.s.alpha = clamp01(this.t / 0.1) * fade * near;
    this.sh.position.set(Math.round(cx), Math.round(cy));
    this.sh.alpha = 0.18 * fade * near;
    // 仙品「落宝」：附着的那只身上往下掉宝光
    if (Z.tier >= 3 && !Z.nth && tp && te && this.gone < 0 && Math.random() < dt * 10) {
      ctx.glows.emit(tp[0] + rnd(-5, 5), tp[1] - rnd(4, headOf(te.kind)), 1, [C.Y, C.f, C.y], [6, 14], [0.4, 0.6], { dir: Math.PI / 2, spread: 0.4, g: 40, drag: 1 });
    }
    return true;
  }
  destroy() {
    this.s.destroy();
    this.sh.destroy();
  }
}

// ================================================================ 对外

/** 这里画的持续效果。 */
const ZONES2 = new Set<ZoneKind>(['vajra', 'orbit', 'banner', 'blaze', 'crows', 'surge', 'net', 'sweep', 'umbrella', 'coin']);
type ZoneView2 = { update(dt: number, ctx: Ctx, z: Zone | null, alpha: number, w: World): boolean; destroy(): void };

export class ArtifactFx2 {
  private ctx: ACtx;
  private effects: Effect[] = [];
  private zones = new Map<number, ZoneView2>();
  private pestles = new Map<number, PestleView>();
  private stones = new Map<number, StoneView>();
  private nails = new Map<number, NailView>();
  private gems = new Map<number, GemView>();
  private geysers: GeyserView[] = [];
  /** 万鸦壶的俯冲：延时效果 id → 哪一群、第几只、是不是自焚（落地事件到的时候延时效果已经从 world.pending 里拿掉了）。 */
  private lastDive = new Map<number, { chain: number; seq: number; boom: boolean; sun: boolean }>();
  /** 这一帧五光石打中的位置（石子不见了的时候，附近有打中的就是碎了，没有就是落地）。 */
  private stoneHits: { x: number; y: number; t: number }[] = [];
  /** 这一帧七宝打中的位置（宝不见了的时候，附近有打中的就是打中了）。 */
  private gemHitPts: { x: number; y: number; t: number }[] = [];
  private bits: Bits;
  private top = new Pixels();
  private under = new Pixels();
  /** 角色之上的一层、贴地的一层（tools/fx-size.mjs 按它们认法宝自己的画面）。 */
  readonly layer = new Container();
  readonly floor = new Container();
  private sfx: Sfx;
  private time = 0;
  private alpha = 1;
  private byId = new Map<number, Enemy>();
  private ixTick = -1;
  private lastSound = new Map<string, number>();
  private world: World | null = null;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
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
    for (const z of this.zones.values()) z.destroy();
    this.zones.clear();
    for (const v of this.pestles.values()) v.destroy();
    this.pestles.clear();
    for (const v of this.stones.values()) v.destroy();
    this.stones.clear();
    for (const v of this.nails.values()) v.destroy();
    this.nails.clear();
    for (const v of this.gems.values()) v.destroy();
    this.gems.clear();
    for (const v of this.geysers) v.destroy();
    this.geysers = [];
    this.lastDive.clear();
    this.stoneHits = [];
    this.gemHitPts = [];
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

  private playerAt(w: World, owner: number): () => [number, number] | null {
    return () => {
      const p = w.players[owner];
      if (!p) return null;
      return [p.px + (p.x - p.px) * this.alpha, p.py + (p.y - p.py) * this.alpha];
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

  private zoneView(z: Zone): ZoneView2 | null {
    switch (z.kind) {
      case 'vajra':
        return new VajraView(this.ctx, z);
      case 'orbit':
        return new OrbitView(this.ctx, z, this.playerAt(this.world!, z.owner));
      case 'banner':
        return new BannerView(this.ctx, z);
      case 'blaze':
        return new BlazeView(this.ctx, z);
      case 'crows':
        return new CrowsView(this.ctx, z, this.playerAt(this.world!, z.owner));
      case 'surge':
        return new SurgeView(this.ctx, z);
      case 'net':
        return new NetView(this.ctx, z);
      case 'sweep':
        return new SweepView(this.ctx, z);
      case 'umbrella':
        return new UmbrellaView(this.ctx, z);
      case 'coin':
        return new CoinView(this.ctx, z, this.playerAt(this.world!, z.owner));
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
        if (e.kind === 'dive') {
          const q = w.pending.find((x) => x.id === e.id);
          const v = q?.chain !== undefined ? (this.zones.get(q.chain) as CrowsView | undefined) : undefined;
          if (q && v && 'dive' in v) v.dive(q.seq ?? 0, q.target ?? -1, e.t2, !!q.ring);
          break;
        }
        if (e.kind === 'geyser') {
          const q = w.pending.find((x) => x.id === e.id);
          const from: [number, number] | null = (q?.seq ?? 1) > 1 && q?.ox !== undefined && q.oy !== undefined ? [q.ox, q.oy] : null;
          this.geysers.push(new GeyserView(ctx, e.id, e.x, e.y, e.r, e.t2, e.tier ?? 1, from));
          break;
        }
        if (e.kind !== 'pestle') break;
        const q = w.pending.find((x) => x.id === e.id);
        const chain = q?.chain ?? e.id;
        const seq = q?.seq ?? 1;
        let v = this.pestles.get(chain);
        const fresh = !v;
        if (!v) {
          v = new PestleView(ctx, chain, this.gear(w, q?.owner, 'xiangmo', e.tier ?? q?.tier));
          this.pestles.set(chain, v);
        }
        const from: [number, number] | null = (seq <= 1 || fresh) && q?.ox !== undefined && q.oy !== undefined ? [q.ox, q.oy] : null;
        v.aim(e.id, q?.target ?? -1, e.x, e.y, e.t2, seq, from, this.playerAt(w, q?.owner ?? 0));
        if (seq <= 1) this.sound('xiangmo.fall', 0.7, 0.12);
        break;
      }
      case 'land': {
        if (e.kind === 'dive') {
          const q = this.lastDive.get(e.id);
          const v = q ? (this.zones.get(q.chain) as CrowsView | undefined) : undefined;
          if (v && 'hit' in v) v.hit(ctx, q!.seq, e.x, e.y, q!.boom, e.r, q!.sun);
          else if (q?.boom || q?.sun) ctx.sparks.emit(e.x, e.y - 6, 8, FIRE_SPARKS, [30, 80], [0.25, 0.5], { up: 30, g: 80 });
          this.sound(q?.boom || q?.sun ? 'wanya.boom' : 'wanya.peck', q?.boom ? 0.8 : q?.sun ? 0.65 : 0.5, 0.05);
          this.lastDive.delete(e.id);
          break;
        }
        if (e.kind === 'geyser') {
          const v = this.geysers.find((x) => x.has(e.id));
          if (v) v.land(ctx, e.x, e.y);
          this.sound('yanguang.erupt', 0.7, 0.06);
          break;
        }
        if (e.kind !== 'pestle') break;
        const v = [...this.pestles.values()].find((x) => x.has(e.id));
        // 这一下是不是这一串的最后一下：事件是这一步模拟走完才交过来的，要弹向下一只的话，下一下已经在 world.pending 里了
        const last = !v || !w.pending.some((x) => x.kind === 'pestle' && x.chain === v.chain);
        const big = last && v?.spirit === 'taishan';
        if (v) v.land(ctx, e, last, big);
        else pestleImpact(ctx, e.x, e.y, e.r, e.tier ?? 1, false);
        this.sound('xiangmo.land', big ? 1 : 0.75, 0.06);
        break;
      }
      case 'hit':
        if ((e.by === 'pestle' || e.by === 'stone') && e.kind !== 'boss') {
          const t = w.enemies.find((x) => x.id === e.id);
          if (t && t.stun > 0.1) this.add(new Stars(e.id, Math.min(0.9, t.stun)));
        }
        if (e.by === 'stone') this.stoneHits.push({ x: e.x, y: e.y, t: this.time });
        if (e.by === 'gem') {
          this.gemHitPts.push({ x: e.x, y: e.y, t: this.time });
          this.sound('miaoshu.hit', 0.45, 0.04);
        }
        if (e.by === 'sweep') {
          ctx.glows.emit(e.x, e.y - headOf(e.kind) * 0.5, 3, [C.L, C.f], [15, 35], [0.2, 0.35], { drag: 2.5 });
          this.sound('miaoshu.whack', 0.5, 0.05);
        }
        if (e.by === 'nail') {
          ctx.sparks.emit(e.x, e.y - headOf(e.kind) * 0.5, 3, GOLD_SPARKS, [15, 45], [0.15, 0.3], { drag: 3 });
          this.sound('zanxin.hit', 0.5, 0.04);
        }
        break;
      case 'throw':
        if (e.kind === 'wanya') {
          const z = [...w.zones].reverse().find((x) => x.kind === 'crows' && x.owner === e.owner);
          const p = w.players[e.owner];
          this.add(new PotFlash(ctx, this.playerAt(w, e.owner), z && p ? (z.x >= p.x ? 1 : -1) : 1));
          this.sound('wanya.pour', 0.7, 0.2);
        }
        if (e.kind === 'sihai') {
          const p = w.players[e.owner];
          this.add(new VaseFlash(ctx, this.playerAt(w, e.owner), p ? Math.atan2(e.y - p.y, e.x - p.x) : 0));
          this.sound('sihai.pour', 0.7, 0.2);
        }
        if (e.kind === 'wulu') {
          const hp = this.playerAt(w, e.owner)();
          if (hp) netCast(ctx, hp, e.x, e.y);
          this.sound('wulu.cast', 0.6, 0.2);
        }
        if (e.kind === 'wuguang') this.sound('wuguang.throw', 0.7, 0.08);
        if (e.kind === 'zanxin') this.sound('zanxin.shot', 0.6, 0.08);
        break;
      case 'zone':
        if (e.zone === 'banner') this.sound('yanguang.plant', 0.7, 0.15);
        if (e.zone === 'surge') this.sound('sihai.surge', 0.7, 0.2);
        if (e.zone === 'sweep') this.sound('miaoshu.sweep', 0.7, 0.15);
        if (e.zone === 'umbrella') this.sound('wenhuang.open', 0.6, 0.3);
        if (e.zone === 'coin') this.sound('luobao.fly', 0.5, 0.15);
        break;
      case 'arti2':
        if (e.kind === 'yanguang' && e.act === 'hop') this.sound('yanguang.plant', 0.6, 0.15);
        if (e.kind === 'miaoshu' && e.act === 'gems') this.sound('miaoshu.gems', 0.6, 0.15);
        if (e.kind === 'luobao') {
          if (e.act === 'knock') {
            const v = [...this.zones.entries()].find(([zid]) => w.zones.some((q) => q.id === zid && q.kind === 'coin' && (q.ids ?? [])[0] === e.id))?.[1];
            if (v && 'knock' in v) (v as CoinView).knock(ctx, e.r ?? 18);
            this.sound('luobao.knock', 0.45, 0.06);
          }
          if (e.act === 'drop') {
            ctx.sparks.emit(e.x, e.y - 10, 10 + (e.v ?? 1) * 2, GOLD_SPARKS, [30, 80], [0.3, 0.55], { up: 30, g: 120, drag: 1.5 });
            ctx.bits.spawn(e.x, e.y - 12, { frames: Ts('star', () => STAR), fps: 14, loop: false, life: 0.35, fadeOut: 0.12, z: true, zOff: 14 });
            this.sound('luobao.drop', 0.6, 0.1);
          }
          if (e.act === 'hop') this.sound('luobao.fly', 0.4, 0.1);
        }
        if (e.kind === 'wenhuang') {
          if (e.act === 'drip' && e.id !== undefined) {
            const u = [...w.zones].reverse().find((x) => x.kind === 'umbrella' && x.owner === e.owner);
            this.add(new PlagueDrop(ctx, e.id, u ? [u.x, u.y - UMB_H + 1] : [e.x, e.y - 34]));
            this.sound('wenhuang.drip', 0.45, 0.08);
          }
          if (e.act === 'spread' && e.id !== undefined) {
            const src = this.byId.get(e.id);
            for (const id of e.ids ?? []) this.add(new PlagueWisp(e.id, id, src?.plagueSp === 'god'));
            this.sound('wenhuang.spread', 0.35, 0.12);
          }
          if (e.act === 'down' && e.id !== undefined) {
            this.add(new Stars(e.id, 0.8));
            this.sound('wenhuang.down', 0.5, 0.1);
          }
        }
        if (e.kind === 'wulu') {
          if (e.act === 'spring') this.sound('wulu.spring', 0.75, 0.08);
          if (e.act === 'slam') this.sound('wulu.slam', 0.8, 0.08);
        }
        if (e.kind === 'sihai' && e.act === 'crash') {
          this.sound('sihai.crash', 0.8, 0.08);
          if (e.tier >= 3) this.sound('sihai.freeze', 0.6, 0.2);
        }
        if (e.kind === 'jinjiao') {
          const v = [...this.zones.entries()].find(([id]) => w.zones.find((z) => z.id === id)?.owner === e.owner && w.zones.find((z) => z.id === id)?.kind === 'orbit')?.[1] as OrbitView | undefined;
          if (e.act === 'dart') {
            v?.dart(e.v ?? 0.28);
            this.sound('jinjiao.dart', 0.7, 0.1);
          } else if (e.act === 'snip') {
            v?.snipped();
            snipFlash(ctx, e.x, e.y, e.tier);
            this.sound('jinjiao.snip', 0.9, 0.06);
          }
        }
        if (e.kind === 'zanxin' && e.act === 'drill' && e.id !== undefined) {
          const g = this.gear(w, e.owner, 'zanxin', e.tier);
          this.add(new Drill(e.id, e.v ?? 5, e.x, e.y, headOf(this.byId.get(e.id)?.kind), g.spirit === 'bone'));
          this.sound('zanxin.drill', 0.9, 0.08);
        }
        break;
    }
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
      if (ZONES2.has(z.kind)) {
        live.set(z.id, z);
        if (!this.zones.has(z.id)) {
          const v = this.zoneView(z);
          if (v) this.zones.set(z.id, v);
        }
      }
    for (const [id, v] of this.zones)
      if (!v.update(dt, ctx, live.get(id) ?? null, alpha, w)) {
        v.destroy();
        this.zones.delete(id);
      }
    // 万鸦壶：记下还在扑的俯冲（落地那一帧它已经不在 world.pending 里了）
    for (const q of w.pending) if (q.kind === 'dive' && !this.lastDive.has(q.id)) this.lastDive.set(q.id, { chain: q.chain ?? -1, seq: q.seq ?? 0, boom: !!q.ring, sun: !!q.burst });
    // 离地焰光旗的地火：没窜起来之前跟着目标走（模拟里的延时落下跟着目标走）
    for (let i = this.geysers.length - 1; i >= 0; i--) {
      const v = this.geysers[i];
      const q = w.pending.find((x) => v.has(x.id));
      if (q) v.track(q.x, q.y);
      if (!v.update(dt, ctx)) {
        v.destroy();
        this.geysers.splice(i, 1);
      }
    }
    // 降魔杵：还没落地之前跟着目标走
    for (const [id, v] of this.pestles) {
      const q = w.pending.find((x) => x.chain === id && x.kind === 'pestle');
      if (q?.target !== undefined) v.track(this.enemyPos(q.target));
      if (!v.update(dt, ctx)) {
        v.destroy();
        this.pestles.delete(id);
      }
    }
    // 五光石：石子、五色光跟着模拟里的飞行物走；不见了的，附近刚打中过就碎开，不然落地
    const hero = this.playerAt(w, 0);
    const seen = new Set<number>();
    for (const k of w.knives) {
      if (k.kind !== 'wuguang') continue;
      seen.add(k.id);
      let v = this.stones.get(k.id);
      if (!v) {
        v = new StoneView(ctx, k.color ?? 0, !!k.shard, k.tier ?? 1);
        this.stones.set(k.id, v);
      }
      const p = w.players[k.owner];
      const hp = p ? ([p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha] as [number, number]) : hero();
      v.update(dt, ctx, k.px + (k.x - k.px) * alpha, k.py + (k.y - k.py) * alpha, hp);
    }
    for (const [id, v] of this.stones) {
      if (seen.has(id)) continue;
      const [x, y] = v.last;
      const hit = this.stoneHits.find((h) => Math.hypot(h.x - x, h.y - y) < 16);
      const g = this.gear(w, 0, 'wuguang');
      if (hit) {
        stoneHit(ctx, hit.x, hit.y - 10, v.color, g.tier);
        this.sound('wuguang.hit', 0.6, 0.05);
      } else if (!v.shard) ctx.bits.spawn(x, y - STONE_H, { frames: Ts(`wgStone${v.color}`, () => STONES[v.color]), fps: 8, life: 0.5, vx: rnd(-8, 8), vy: -20, g: 240, ground: y, bounce: 0.35, fadeOut: 0.25 });
      v.destroy();
      this.stones.delete(id);
    }
    this.stoneHits = this.stoneHits.filter((h) => this.time - h.t < 0.05);
    // 攒心钉：飞着的金钉；敌人身上钉着的钉子（几枚就画几枚，最后半秒淡掉）
    const seenN = new Set<number>();
    for (const k of w.knives) {
      if (k.kind !== 'zanxin') continue;
      seenN.add(k.id);
      let v = this.nails.get(k.id);
      if (!v) {
        v = new NailView(ctx);
        this.nails.set(k.id, v);
      }
      const p = w.players[k.owner];
      const hp = p ? ([p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha] as [number, number]) : null;
      v.update(ctx, k.px + (k.x - k.px) * alpha, k.py + (k.y - k.py) * alpha, k.vx, k.vy, hp);
    }
    for (const [id, v] of this.nails)
      if (!seenN.has(id)) {
        v.destroy();
        this.nails.delete(id);
      }
    // 染瘟的敌人：脚下一小团贴地的瘟气（软边，层数越多越浓），身上不时冒起几点黄绿的瘟尘（瘟神的带一点胭脂紫）
    for (const e of w.enemies) {
      if (!e.plague || !(e.plagueT && e.plagueT > 0)) continue;
      const p = this.enemyPos(e.id);
      if (!p) continue;
      const lv = e.plague;
      const fadeOut = clamp01(e.plagueT / 0.5);
      const R = 7 + lv;
      // 满场染瘟时几十只、每只一百多个像素：两道正弦按列、按行先算好（docs/perf.md；画出来的一样）
      const nx = PLAGUE_NX;
      for (let x = -R; x <= R; x++) nx[x + R] = Math.sin(x * 0.9 + this.time * 3 + e.id);
      const base = (0.34 + 0.1 * lv) * fadeOut;
      for (let y = -4; y <= 4; y++) {
        const ny = Math.sin(y * 1.3 - this.time * 2);
        const dy2 = (y / 4.5) ** 2;
        for (let x = -R; x <= R; x++) {
          const d2 = (x / R) ** 2 + dy2;
          if (d2 > 1) continue;
          const n = nx[x + R] + ny;
          ctx.under.dot(p[0] + x, p[1] + y, n > 1.1 ? C.L : n > -0.3 ? C.l : C.v, base * (1 - d2));
        }
      }
      if (Math.random() > dt * (4 + 4 * lv)) continue;
      const h = headOf(e.kind);
      ctx.glows.emit(p[0] + rnd(-5, 5), p[1] - rnd(2, h * 0.8), 1, e.plagueSp === 'god' ? GOD_COLS : PLAGUE_COLS, [5, 12], [0.45, 0.75], { dir: -Math.PI / 2, spread: 0.6, drag: 1.5 });
    }
    // 七宝妙树飞出去的宝
    const seenG = new Set<number>();
    for (const k of w.knives) {
      if (k.kind !== 'miaoshu') continue;
      seenG.add(k.id);
      let v = this.gems.get(k.id);
      if (!v) {
        v = new GemView(ctx, k.color ?? 0, k.tier ?? 1);
        this.gems.set(k.id, v);
      }
      const hp = this.playerAt(w, k.owner)();
      v.update(ctx, k.px + (k.x - k.px) * alpha, k.py + (k.y - k.py) * alpha, hp);
    }
    for (const [id, v] of this.gems)
      if (!seenG.has(id)) {
        v.end(ctx, this.gemHitPts.some((h) => Math.hypot(h.x - v.at[0], h.y + 8 - v.at[1]) < 16));
        v.destroy();
        this.gems.delete(id);
      }
    this.gemHitPts = this.gemHitPts.filter((h) => this.time - h.t < 0.05);
    for (const e of w.enemies) {
      if (!e.nails || !(e.nailT && e.nailT > 0)) continue;
      const p = this.enemyPos(e.id);
      if (!p) continue;
      const sc = headOf(e.kind) / 21;
      const a = clamp01(e.nailT / 0.5);
      for (let i = 0; i < Math.min(e.nails, PIN_AT.length); i++) {
        const [dx, dy, ang] = PIN_AT[i];
        drawPin(ctx, p[0] + dx * sc, p[1] + dy * sc, ang, a, Math.sin(this.time * 5 + i * 1.7) > 0.93);
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--)
      if (!this.effects[i].update(dt, ctx, w, alpha)) {
        this.effects[i].destroy();
        this.effects.splice(i, 1);
      }
    this.bits.update(dt);
    this.top.flush();
    this.under.flush();
  }

  /** 实验页、量具用的一点统计。 */
  get stats() {
    return { effects: this.effects.length, zones: this.zones.size, pestles: this.pestles.size, stones: this.stones.size, nails: this.nails.size, bits: this.bits.count };
  }
}
