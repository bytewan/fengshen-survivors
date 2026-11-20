// 孙悟空 · 如意金箍棒的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件（staffSweep / staffSmash / warn·land 'rock' / hit）和人物的位置。
// 一套招式：棒子从手里抡出去（这时人物换成空手的帧，见 game/heroes/index.ts），绕着身子横扫一整圈——棒头后面拖一道棍风，
// 外沿正好到横扫打得到的地方，转完那一圈的棍风停一下、慢慢淡掉；接着棒子举过头顶朝敌人最多的方向竖劈下去，
// 落地那一下地上从脚前往外裂开一道细缝、尘土顺着缝一路掀起来（劲顺着地往前走），棒头落点迸出几粒金屑。
// 仙品「定海」：竖劈的落点先裂开几道细纹，片刻后一圈石刺从地里扎出来、停一下、再缩回地里（碎石、尘土）；
// 神品「擎天」：竖劈时那条线上压下一根擎天柱的金色虚影（半透明，两头的金箍更亮，远端离地不过约三十像素，砸平在地上），一路从近到远扎出几簇石刺；
// 「搅海」：横扫连转三圈，棍风换成翻卷的海水（天青、白浪花），地上溅起水沫。
// 用户口径：法宝不能画得过大（棒子本身凡 28 / 灵 31 / 仙 36 / 神 40 像素，擎天 42，法天象地期间长一成半、不过 44：照 32 像素的尺子）；效果不超过判定
// （棍风的外沿就是横扫的半径，裂缝、尘土就在竖劈那条线上，石刺在石刺的半径里）；不要光圈（棍风是一道跟着棒头走的弧，转完就淡掉）；
// 出现和消失都要有过程；每次升阶都看得出变化：凡 一道淡金的棍风；灵 棒子更长、棍风更宽，里面多跟一道淡的；仙 棍风镶金边 + 定海石刺；
// 神 擎天的虚影、一路石刺 / 搅海的三圈海水。
import { Container, Sprite, type Texture } from 'pixi.js';
import { grid, outline, type Grid } from '../../art/pixel.ts';
import { ROCKS } from '../../art/sprites/fx.ts';
import { STAFF_SEL, staffUp } from '../../art/sprites/wukong.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { applyRot, Bits, C, clamp01, easeOut, fade, headOf, jag, pick, Pixels, puffSet, rnd, rotTex, stamp, Stroke, Ts } from '../fx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const TAU = Math.PI * 2;
type Cols = [number, number, number, number];
/** 棍风的颜色（芯、身、外、深边）：凡 / 灵是淡金的风（深边琥珀：浅色地面上看得出），仙品起镶亮金，搅海是海水。 */
const PALE: Cols = [C.W, C.w, C.Y, C.b];
const GILT: Cols = [C.f, C.Y, C.y, C.B];
const SEA: Cols = [C.W, C.Cc, C.c, C.n];
const windCols = (tier: number, churn: boolean): Cols => (churn ? SEA : tier >= 3 ? GILT : PALE);
const DUST = [0x6b5749, 0x776672, 0x4f5652, 0xb3b8a6];

/** 棒子本身多长（各品阶；尺子：法宝本体凡 / 灵不过约 34 像素、仙 / 神不过约 44）。 */
const STAFF_LEN = [0, 28, 31, 36, 40];
const PILLAR_LEN = 42;
const BIG_K = 1.15;
const MAX_LEN = 44;
/** 握棒的手离脚底多高（胸前）。 */
const HAND_Y = 13;
/** 握棒的那一点离棒尾多远（棒子往外伸出 len − GRIP）。 */
const GRIP = 3;

const rightCache = new Map<number, Grid>();
/** 横着的棒（上端朝右）：把竖着的那根转 90°（像素对像素）。按长度缓存。 */
function rightStaff(len: number): Grid {
  let g = rightCache.get(len);
  if (!g) {
    const up = staffUp(len);
    g = grid(Array.from({ length: up.w }, (_, y) => Array.from({ length: up.h }, (_, x) => up.rows[up.h - 1 - x][y]).join('')));
    rightCache.set(len, g);
  }
  return g;
}

/** 石刺（三种大小）：苍、银鼠、缟三档，受光的一侧亮；描玄边。高不过 9 像素。 */
const SPIKES: Grid[] = [
  ['.j.', '.ij', 'hij', 'hij', 'hhi', 'ghh'],
  ['..j.', '.ji.', '.iij', 'hiij', 'hhij', 'hhii', 'ghhi'],
  ['...j..', '..jij.', '..iij.', '.hiij.', '.hhiij', 'hhhiij', 'ghhhii', 'gghhhi'],
].map((r) => outline(grid(r), 'k'));

/** 一个人手里的那根棒：正在做哪一步、转到哪个角度。 */
interface Staff {
  s: Sprite;
  ghosts: Sprite[]; // 横扫时棒子后面的几道残影
  dir: number; // 横扫转的方向
  step: 'sweep' | 'smash' | 'hold';
  t: number;
  a0: number;
  a1: number;
  ang: number;
  len: number;
  idle: number;
  alpha: number;
}

/** 一圈棍风：跟着人物走，从 a0 起朝 dir 方向追着棒头转一整圈，转完停一下、淡掉。 */
interface Gust {
  owner: number;
  r: number;
  a0: number;
  dir: number;
  tier: number;
  churn: boolean;
  t: number;
  inner: boolean; // 灵品起里面多跟一道淡的
}

/** 竖劈落地：一道从脚前往外裂开的细缝、一路掀起的尘土；擎天再压下一根虚影。 */
interface Slam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  tier: number;
  t: number; // 落地之后过了多久（负的是棒子还在往下劈）
  pts: [number, number][];
  dust: number; // 已经掀到哪儿了（沿线的距离）
  pillar: boolean;
}

/** 一处石刺：warn 之后地上先裂几道细纹，land 那一刻一圈石刺扎出来。 */
interface RockSpot {
  id: number;
  x: number;
  y: number;
  r: number;
  tier: number;
  t: number; // warn 之后过了多久
  t2: number; // warn 到扎出来
  up: number; // 扎出来之后过了多久（-1 = 还没扎）
  cracks: [number, number][][];
  spikes: { s: Sprite; x: number; y: number; h: number; delay: number }[];
}

const SWEEP_T = 0.26; // 棒子转一整圈要多久（模拟在出手那一帧就结算了，棍风要马上跟上）
const SMASH_T = 0.1; // 从头顶劈到地上
const HOLD_T = 0.22; // 最后一步之后再等多久收棒
const GUST_FADE = 0.32; // 棍风转完之后淡掉的时间
const SLAM_LIFE = 0.9;
const PILLAR_LIFE = 0.75;
const SPIKE_UP = 0.07;
const SPIKE_HOLD = 0.34;
const SPIKE_DOWN = 0.28;

export class JinguFx {
  private staffs = new Map<number, Staff>();
  private gusts: Gust[] = [];
  private slams: Slam[] = [];
  private rocks = new Map<number, RockSpot>();
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private stroke = new Stroke();
  private uStroke = new Stroke();
  private bits: Bits;
  private spikeTex: Texture[];
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private hitSound = new Map<number, number>();
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.bits = new Bits(stage.fx, stage.entities);
    this.spikeTex = SPIKES.map(textureFromGrid);
    stage.floor.addChild(this.under.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
  }

  /** 名字表（docs/audio.md）里有素材就放它，没有就借 fallback（现有的相近的声音）。 */
  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 这个人手里的棒是不是正抡着（人物这时用空手的帧）。 */
  busy(owner: number): boolean {
    return this.staffs.has(owner);
  }

  clear() {
    for (const b of this.staffs.values()) {
      b.s.destroy();
      for (const g of b.ghosts) g.destroy();
    }
    this.staffs.clear();
    this.gusts = [];
    this.slams = [];
    for (const r of this.rocks.values()) for (const k of r.spikes) k.s.destroy();
    this.rocks.clear();
    this.top.flush();
    this.under.flush();
  }

  private staff(owner: number, len: number): Staff {
    let b = this.staffs.get(owner);
    if (!b) {
      const s = new Sprite();
      this.stage.entities.addChild(s);
      const ghosts = [0, 1, 2].map(() => {
        const g = new Sprite();
        g.visible = false;
        this.stage.entities.addChild(g);
        return g;
      });
      b = { s, ghosts, dir: 1, step: 'hold', t: 0, a0: 0, a1: 0, ang: 0, len, idle: 0, alpha: 1 };
      this.staffs.set(owner, b);
    }
    b.len = len;
    b.idle = 0;
    b.t = 0;
    b.alpha = 1;
    return b;
  }

  private lenOf(tier: number, pillar: boolean, big: boolean) {
    const base = pillar ? PILLAR_LEN : (STAFF_LEN[tier] ?? 24);
    return Math.min(MAX_LEN, Math.round(base * (big ? BIG_K : 1)));
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'staffSweep': {
        if (e.kind !== 'jingu') break;
        const churn = w.players[e.owner]?.weapons.some((x) => x.kind === 'jingu' && x.spirit === 'jiaohai') ?? false;
        const b = this.staff(e.owner, this.lenOf(e.tier, false, !!e.big));
        // 棒子从瞄准方向稍往后起，绕着身子转一整圈（朝右时顺时针）
        b.step = 'sweep';
        b.dir = e.dir;
        b.a0 = e.a - e.dir * 0.5;
        b.a1 = b.a0 + e.dir * TAU;
        b.ang = b.a0;
        this.gusts.push({ owner: e.owner, r: e.r, a0: b.a0, dir: e.dir, tier: e.tier, churn, t: 0, inner: e.tier >= 2 });
        this.hitSound.set(e.owner, 0);
        if (churn) this.play('jingu.churn', 'xuanyuan.vortex', e.spin > 1 ? 0.55 : 0.7);
        this.play('jingu.sweep', 'sanjian.sweep', e.spin > 1 ? 0.75 : 1);
        break;
      }
      case 'staffSmash': {
        if (e.kind !== 'jingu') break;
        const pillar = e.spirit === 'qingtian';
        const b = this.staff(e.owner, this.lenOf(e.tier, pillar, !!e.big));
        const a = Math.atan2(e.y1 - e.y0, e.x1 - e.x0);
        const right = Math.cos(a) >= 0;
        // 棒子从头顶（往后一点）劈下来，棒头砸在身前那条线上（地面上）：手在胸口（离地 HAND_Y 像素），所以画面上的角度往下压一点
        b.step = 'smash';
        b.a0 = right ? -Math.PI * 0.62 : -Math.PI * 0.38;
        const reach = b.len - GRIP;
        b.a1 = Math.atan2(Math.sin(a) * reach + HAND_Y, Math.cos(a) * reach);
        b.ang = b.a0;
        this.slams.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, w: e.w, tier: e.tier, t: -SMASH_T * 0.8, pts: jag(e.x0, e.y0, e.x1, e.y1, 3, 4), dust: 0, pillar });
        this.hitSound.set(e.owner, 0);
        this.play(pillar ? 'jingu.pillar' : 'jingu.smash', pillar ? 'jinbian.strike' : 'sanjian.chop', 0.9);
        break;
      }
      case 'warn': {
        if (e.kind !== 'rock') break;
        // 落点先裂开几道细纹（从中心往外，片刻后石刺从这些纹里扎出来）
        const n = 5 + Math.floor(Math.random() * 3);
        const cracks: [number, number][][] = [];
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * TAU + rnd(-0.3, 0.3);
          const len = e.r * rnd(0.55, 0.85);
          cracks.push(jag(e.x, e.y, e.x + Math.cos(ang) * len, e.y + Math.sin(ang) * len * 0.62, 1.5, 3));
        }
        this.rocks.set(e.id, { id: e.id, x: e.x, y: e.y, r: e.r, tier: e.tier ?? 3, t: 0, t2: e.t2, up: -1, cracks, spikes: [] });
        break;
      }
      case 'land': {
        if (e.kind !== 'rock') break;
        const r = this.rocks.get(e.id);
        if (r) this.erupt(r);
        break;
      }
      case 'hit': {
        if (e.by !== 'staff' && e.by !== 'rock') break;
        const hd = headOf(e.kind);
        const c = e.by === 'rock' ? [C.j, C.i, C.h] : [C.Y, C.f, C.W];
        this.sparks.emit(e.x, e.y - hd * 0.5, e.crit ? 6 : 3, c, [30, 80], [0.15, 0.3], { drag: 3 });
        const owner = [...this.staffs.keys()][0] ?? 0;
        if (!this.hitSound.get(owner)) {
          this.hitSound.set(owner, 1);
          this.sfx.hit(e.crit);
        }
        break;
      }
    }
  }

  /** 一圈石刺从地里扎出来：外圈一圈、里面两三根，参差着先后冒出来。 */
  private erupt(r: RockSpot) {
    r.up = 0;
    const n = Math.max(5, Math.min(9, Math.round(r.r / 4.2)));
    const spots: [number, number, number][] = [];
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * TAU + rnd(-0.25, 0.25);
      const d = r.r * rnd(0.6, 0.82);
      spots.push([r.x + Math.cos(ang) * d, r.y + Math.sin(ang) * d * 0.62, k % 3 === 0 ? 1 : 0]);
    }
    for (let k = 0; k < 2 + (r.tier >= 4 ? 1 : 0); k++) spots.push([r.x + rnd(-r.r, r.r) * 0.3, r.y + rnd(-r.r, r.r) * 0.2, 2]);
    for (const [x, y, big] of spots) {
      const tex = this.spikeTex[big === 2 ? 2 : big === 1 ? 1 : pick([0, 0, 1])];
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.visible = false;
      this.stage.entities.addChild(s);
      r.spikes.push({ s, x: Math.round(x), y: Math.round(y), h: tex.height, delay: rnd(0, 0.06) });
    }
    this.play('jingu.rock', 'dinghai.quake', 0.75);
    this.shake.add(r.tier >= 4 ? 0.14 : 0.1);
    // 扎出来的那一下：中心掀起一团尘、崩起几块碎石
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + rnd(-0.3, 0.3);
      this.bits.spawn(r.x + Math.cos(a) * r.r * 0.4, r.y + Math.sin(a) * r.r * 0.25, { frames: puffSet(3, 'stone', 1 + (k % 3)), life: rnd(0.4, 0.6), vx: Math.cos(a) * 18, vy: Math.sin(a) * 10 - 6, drag: 3, fadeIn: 0.03, fadeOut: 0.25, z: true, zOff: 2 });
      if (k % 2 === 0) this.bits.spawn(r.x, r.y, { frames: [Ts('rocks', () => ROCKS)[k % ROCKS.length]], life: 0.6, vx: Math.cos(a) * r.r * rnd(0.6, 1), vy: -rnd(50, 80), g: 320, ground: r.y + rnd(-2, 2), bounce: 0.3, fadeOut: 0.2 });
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const st = this.stroke;
    const us = this.uStroke;
    // ---- 手里的棒 ----
    for (const [owner, b] of this.staffs) {
      const p = w.players[owner];
      if (!p) {
        b.s.destroy();
        for (const g of b.ghosts) g.destroy();
        this.staffs.delete(owner);
        continue;
      }
      b.t += dt;
      const hx = p.px + (p.x - p.px) * alpha;
      const hy = p.py + (p.y - p.py) * alpha;
      let k = 1;
      if (b.step === 'sweep') {
        k = clamp01(b.t / SWEEP_T);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // 两头慢中间快：抡起来、收住
        b.ang = b.a0 + (b.a1 - b.a0) * e;
      } else if (b.step === 'smash') {
        k = easeOut(b.t / SMASH_T);
        b.ang = b.a0 + wrapPi(b.a1 - b.a0) * k;
      }
      const done = b.step === 'hold' || b.t > (b.step === 'sweep' ? SWEEP_T : SMASH_T) + 0.04;
      if (done) {
        b.idle += dt;
        if (b.idle > HOLD_T) {
          b.alpha -= dt / 0.08;
          if (b.alpha <= 0) {
            b.s.destroy();
            for (const g of b.ghosts) g.destroy();
            this.staffs.delete(owner);
            continue;
          }
        }
      }
      // 握棒的那一点：胸前（朝着棒子的方向偏一点）
      const gx = hx + Math.cos(b.ang) * 3;
      const gy = hy - HAND_Y + Math.sin(b.ang) * 2;
      const g = rightStaff(b.len);
      applyRot(b.s, rotTex(`jingu${b.len}`, g, b.ang, GRIP + 0.5, 1, 48, STAFF_SEL, true));
      b.s.position.set(Math.round(gx), Math.round(gy));
      b.s.zIndex = Math.round(hy) + (Math.sin(b.ang) < -0.3 ? -1 : 1); // 棒子往上举时在人物身后
      b.s.alpha = clamp01(b.alpha);
      // 横扫：棒子后面拖三道越来越淡的残影（转得快，看得出是抡了一整圈）
      const spin = b.step === 'sweep' && k < 1;
      b.ghosts.forEach((gs, i) => {
        gs.visible = spin;
        if (!spin) return;
        const ga = b.ang - b.dir * (0.32 + 0.3 * i) * Math.sin(Math.PI * Math.min(1, k * 1.3) + 0.2);
        applyRot(gs, rotTex(`jingu${b.len}`, g, ga, GRIP + 0.5, 1, 48, STAFF_SEL, true));
        gs.position.set(Math.round(hx + Math.cos(ga) * 3), Math.round(hy - HAND_Y + Math.sin(ga) * 2));
        gs.zIndex = Math.round(hy) + (Math.sin(ga) < -0.3 ? -2 : 0);
        gs.alpha = [0.42, 0.26, 0.13][i];
        gs.tint = 0xf7dc7a;
      });
    }
    // ---- 棍风：追着棒头转一整圈，转完停一下、淡掉 ----
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i];
      g.t += dt;
      if (g.t > SWEEP_T + GUST_FADE) {
        this.gusts.splice(i, 1);
        continue;
      }
      const p = w.players[g.owner];
      if (!p) continue;
      const hx = p.px + (p.x - p.px) * alpha;
      const hy = p.py + (p.y - p.py) * alpha - 8;
      this.gust(st, hx, hy, g);
    }
    // ---- 竖劈落地 ----
    for (let i = this.slams.length - 1; i >= 0; i--) {
      const s = this.slams[i];
      s.t += dt;
      if (s.t > (s.pillar ? Math.max(SLAM_LIFE, PILLAR_LIFE) : SLAM_LIFE)) {
        this.slams.splice(i, 1);
        continue;
      }
      if (s.t < 0) continue;
      this.slam(us, st, s);
    }
    // ---- 石刺 ----
    for (const [id, r] of this.rocks) {
      r.t += dt;
      if (r.up < 0) {
        // 还没扎出来：细纹从中心往外慢慢裂开、颤着往外掉一点土
        if (r.t > r.t2 + 0.3) {
          this.rocks.delete(id); // land 没来（波末清掉了）：收掉
          continue;
        }
        const k = clamp01(r.t / Math.max(0.05, r.t2));
        this.fissures(us, r, k, 1);
        if (Math.random() < dt * 30) this.sparks.emit(r.x + rnd(-r.r, r.r) * 0.5, r.y + rnd(-r.r, r.r) * 0.3, 1, DUST, [4, 12], [0.2, 0.35], { up: 8, drag: 3 });
        continue;
      }
      r.up += dt;
      const life = SPIKE_UP + SPIKE_HOLD + SPIKE_DOWN + 0.1;
      if (r.up > life + 0.3) {
        for (const k of r.spikes) k.s.destroy();
        this.rocks.delete(id);
        continue;
      }
      this.fissures(us, r, 1, 1 - clamp01((r.up - SPIKE_UP - SPIKE_HOLD) / (SPIKE_DOWN + 0.3)));
      for (const k of r.spikes) {
        const t = r.up - k.delay;
        if (t < 0) {
          k.s.visible = false;
          continue;
        }
        // 冒出来（往上顶，略冲过头一点再落稳）、停一下、缩回地里（一边缩一边淡）
        let off: number;
        let a = 1;
        if (t < SPIKE_UP) off = k.h * (1 - easeOut(t / SPIKE_UP)) - 1 * Math.sin(Math.PI * clamp01(t / SPIKE_UP));
        else if (t < SPIKE_UP + SPIKE_HOLD) off = 0;
        else {
          const u = clamp01((t - SPIKE_UP - SPIKE_HOLD) / SPIKE_DOWN);
          off = k.h * u * u;
          a = 1 - u;
          if (u > 0 && u < 0.3 && Math.random() < dt * 8) this.sparks.emit(k.x, k.y, 1, DUST, [4, 10], [0.2, 0.35], { up: 6, drag: 3 });
        }
        k.s.visible = a > 0.02;
        // 从地里冒出来：精灵整体往下压 off 像素，地面以下的部分用遮挡的办法太费，这里直接把高度压扁（缩 scale.y），脚底不动
        k.s.scale.y = Math.max(0.05, 1 - off / k.h);
        k.s.position.set(k.x, k.y);
        k.s.zIndex = k.y;
        k.s.alpha = a;
      }
    }
    this.bits.update(dt);
    st.commit(this.top);
    us.commit(this.under);
    this.top.flush();
    this.under.flush();
  }

  /**
   * 棍风：外沿在半径 r 上（和模拟的判定一样是正圆），一道细细的风弧追着棒头转——只拖棒头后面一截（最长约 140°），
   * 两头收尖、断成两三截（是风，不是一道圈），棒头那里最亮最宽；转完之后那一截顺着转的方向再滑一小段、淡掉。
   * 一圈转下来地上不会留下一个整圈（用户：不要光圈）。灵品起里面再跟一截淡的；搅海是翻卷的海水，边上溅水沫。
   */
  private gust(st: Stroke, x: number, y: number, g: Gust) {
    const cl = windCols(g.tier, g.churn);
    const k = clamp01(g.t / SWEEP_T);
    const lead = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const after = clamp01((g.t - SWEEP_T) / GUST_FADE); // 转完之后
    const head = g.a0 + g.dir * (TAU * lead + after * 0.9); // 转完还顺势滑一小段
    const trail = (0.9 + 1.5 * Math.sin(Math.PI * Math.min(1, k * 1.2))) * (1 - 0.6 * after); // 拖着的那一截（弧度），中间最长
    const hw = ([0, 1.3, 1.7, 2.1, 2.4][g.tier] ?? 1.6) * (g.churn ? 1.25 : 1);
    const R = g.r - hw - 0.5;
    const n = Math.ceil(trail * R * 0.9);
    for (let i = 0; i <= n; i++) {
      const u = i / Math.max(1, n); // 0 = 棒头，1 = 拖在最后
      const ang = head - g.dir * trail * u;
      // 断开：两三截缺口（跟着弧走，不闪）
      if (Math.sin(u * 17 + g.a0 * 3) > 0.72) continue;
      const fadeTail = (1 - u) ** 1.3;
      const al = (0.3 + 0.65 * fadeTail) * (1 - after) * (g.churn ? 0.9 : 0.85);
      if (al < 0.04) continue;
      const th = hw * (0.3 + 0.7 * fadeTail) * Math.min(1, u * 8 + 0.35); // 两头收尖
      const rr = g.churn ? R - Math.sin(ang * 6 + this.time * 9) * 1.2 : R;
      stamp(st, x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, th, al, cl);
      if (g.inner && u > 0.08 && u < 0.7) {
        const ri = rr * 0.72;
        st.dot(x + Math.cos(ang) * ri, y + Math.sin(ang) * ri, cl[1], al * 0.4, 2);
      }
    }
    // 棒头那里掉几粒碎光 / 水沫
    if (after === 0 && Math.random() < 0.7) {
      const a = head + rnd(-0.2, 0.2);
      const c = g.churn ? [C.W, C.Cc, C.c] : g.tier >= 3 ? [C.Y, C.f, C.W] : [C.w, C.Y];
      this.sparks.emit(x + Math.cos(a) * R, y + Math.sin(a) * R, 1, c, [8, 22], [0.25, 0.45], { dir: a + g.dir * Math.PI * 0.5, spread: 0.5, drag: 3, ...(g.churn ? { g: 120 } : {}) });
    }
  }

  /** 竖劈落地：缝从脚前一路裂到头（劲顺着地往前走），尘土跟着掀起来；擎天再压下一根虚影。 */
  private slam(us: Stroke, st: Stroke, s: Slam) {
    const t = s.t;
    const total = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
    const run = clamp01(t / 0.12); // 劲走到哪儿了
    const al = fade(t, SLAM_LIFE, 0.02, 0.45);
    const pts = s.pts;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const l = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d <= l; d += 0.6) {
        const at = acc + d;
        if (at > total * run) break;
        const u = at / total;
        const x = x0 + ((x1 - x0) * d) / l;
        const y = y0 + ((y1 - y0) * d) / l;
        // 缝：两头细、中间宽一点；新裂开的地方边上带一点金（棒子的劲），慢慢褪成土色
        const hot = clamp01(1 - (t - u * 0.12) / 0.25);
        const wid = (0.5 + 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.7) * (s.pillar ? 1.4 : s.tier >= 3 ? 1.15 : 1);
        us.dot(x, y, C.k, al * 0.85, 6);
        if (hot > 0.05) stamp(us, x, y, wid, al * hot * 0.8, [C.f, C.Y, C.y, C.b]);
        else us.dot(x + 1, y, C.h, al * 0.4, 3);
      }
      acc += l;
    }
    // 劲走过的地方掀起尘土（沿线一段一段地冒，越远越晚）
    const want = total * run;
    while (s.dust < want) {
      const k = s.dust / total;
      const x = s.x0 + (s.x1 - s.x0) * k;
      const y = s.y0 + (s.y1 - s.y0) * k;
      const side = Math.random() < 0.5 ? -1 : 1;
      const nx = -(s.y1 - s.y0) / total;
      const ny = (s.x1 - s.x0) / total;
      this.bits.spawn(x + nx * side * rnd(1, s.w * 0.6), y + ny * side * rnd(1, s.w * 0.4), { frames: puffSet(3, 'stone', 1 + Math.floor(Math.random() * 3)), life: rnd(0.4, 0.6), vx: nx * side * 14, vy: ny * side * 8 - 5, drag: 3, fadeIn: 0.03, fadeOut: 0.28, z: true, zOff: 2 });
      if (Math.random() < 0.3) this.sparks.emit(x, y, 1, DUST, [10, 30], [0.25, 0.45], { up: 20, g: 200, drag: 1 });
      s.dust += s.pillar ? 9 : 12;
    }
    // 落地的那一下：棒头落点迸几粒金屑
    if (t < 0.02 && t >= 0) {
      const hx = s.x0 + ((s.x1 - s.x0) / total) * Math.min(total, 22);
      const hy = s.y0 + ((s.y1 - s.y0) / total) * Math.min(total, 22);
      this.sparks.emit(hx, hy - 1, s.tier >= 3 ? 7 : 4, [C.Y, C.f, C.W], [30, 70], [0.2, 0.35], { up: 30, drag: 3 });
      this.shake.add(s.pillar ? 0.2 : s.tier >= 3 ? 0.12 : 0.08);
    }
    if (s.pillar) this.pillar(st, s);
  }

  /**
   * 擎天柱的虚影：沿竖劈那条线压下一根又长又粗的金箍棒的金光虚影（半透明，两头金箍更亮），远端从离地约 26 像素处砸平在地上（0.12 秒），
   * 停一下，再化成往上飘的金屑淡掉。宽不过判定的半宽。
   */
  private pillar(st: Stroke, s: Slam) {
    const t = s.t;
    const total = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
    const ux = (s.x1 - s.x0) / total;
    const uy = (s.y1 - s.y0) / total;
    const fall = easeOut(t / 0.12);
    const lift = 26 * (1 - fall); // 远端离地多高
    const al = fade(t, PILLAR_LIFE, 0.04, 0.35) * 0.55;
    const hw = Math.min(s.w - 2, 2.6);
    for (let d = 0; d <= total; d += 0.6) {
      const u = d / total;
      const x = s.x0 + ux * d;
      const y = s.y0 + uy * d - lift * u;
      // 虚影是金光的（不是乌铁本身：半透明的深色压在地上像一道烟），两头的金箍更亮，棒身上一道道镌纹深一点
      const cap = d < 5 || d > total - 5;
      const cl: Cols = cap ? [C.W, C.f, C.Y, C.y] : [C.f, C.Y, C.y, C.b];
      stamp(st, x, y, hw, al, cl);
      if (!cap && Math.floor(d) % 9 === 0) st.dot(x, y - hw + 0.5, C.b, al * 0.9, 6);
    }
    // 化开：往上飘的金屑
    if (t > PILLAR_LIFE - 0.35 && Math.random() < 0.9) {
      const d = rnd(0, total);
      this.glows.emit(s.x0 + ux * d, s.y0 + uy * d - 2, 1, [C.Y, C.f], [6, 16], [0.35, 0.6], { up: 16, drag: 2 });
    }
  }

  /** 石刺落点的细纹：k 裂开了几成，a 浓淡（石刺缩回去时跟着淡掉）。 */
  private fissures(us: Stroke, r: RockSpot, k: number, a: number) {
    if (a <= 0.02) return;
    for (const c of r.cracks) {
      const n = Math.max(1, Math.ceil((c.length - 1) * k));
      for (let i = 1; i <= n && i < c.length; i++) {
        const [x0, y0] = c[i - 1];
        const [x1, y1] = c[i];
        const l = Math.hypot(x1 - x0, y1 - y0) || 1;
        for (let d = 0; d <= l; d += 0.7) us.dot(x0 + ((x1 - x0) * d) / l, y0 + ((y1 - y0) * d) / l, C.k, a * 0.7, 6);
      }
    }
    // 中心一小片压暗的土（裂开的地面），不画圈；位置按落点的 id 定死，不每帧乱跳
    for (let i = 0; i < 6; i++) us.dot(r.x + (((r.id * 7 + i * 5) % 5) - 2), r.y + (((r.id * 3 + i * 2) % 3) - 1), C.g, a * 0.35, 1);
  }
}

const wrapPi = (a: number) => a - TAU * Math.round(a / TAU);
