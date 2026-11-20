// 杨戬 · 三尖两刃刀的画面（和 fx-new.ts 同一个接口：onEvent / update / clear）。只读模拟的事件（cleave / stab / chop / hit）和人物的位置。
// 一套招式：刀从手里挥出（这时人物换成空手的帧，见 game/heroes/index.ts），横扫一刀——刀身沿弧转过去，
// 身前飞出一道银白的月牙刀光、外沿正好到横扫打得到的地方；接着朝前一刺——刀往前一送，刀尖前一道锥形的刺芒到刺得到的地方，
// 芒尖上三粒碎光分开（三尖）；仙品起再从头顶一劈：刀从上往下劈到身前，地上从脚前裂开一道金光（劈山），
// 裂缝里的金光由亮转暗、碎石崩起、尘土扬开，慢慢合上。神品：「开天」一劈三道（扇形）、金光更盛；「回锋」反手再扫一刀、连刺两下。
// 用户口径：法宝不能画得过大（刀 28 像素，凡 / 灵的刀光、刺芒都只到打得到的地方，仙 / 神的劈山不超过裂缝本身）；不要光圈；
// 出现和消失都要有过程（刀光飞出去、停一下、再淡掉；裂缝慢慢合上）；每次升阶都要看得出变化：
//   凡 一道银白月牙；灵 月牙更宽、身后多跟一道淡的；仙 刀光镶金边 + 劈山；神 「开天」三道金裂、「回锋」来回两道刀光。
import { Container, Sprite } from 'pixi.js';
import { grid, type Grid } from '../../art/pixel.ts';
import { SANJIAN_GRIP, SANJIAN_SEL, SANJIAN_UP } from '../../art/sprites/yangjian.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { applyRot, C, clamp01, easeOut, fade, headOf, jag, Pixels, rnd, rotTex, stamp, Stroke, taperedStreak } from '../fx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const TAU = Math.PI * 2;
type Cols = [number, number, number, number];
/** 刀光的颜色（芯、身、外、深边）：凡 / 灵是银白的寒光（外沿一道天青、深边石青：浅色地面、亮的祭台上都看得出），仙品起镶金，神品金。 */
const SILVER: Cols = [C.W, C.w, C.Cc, C.c];
const GILT: Cols = [C.W, C.w, C.Y, C.y];
const GOLD: Cols = [C.f, C.Y, C.y, C.b];
const cols = (tier: number): Cols => (tier >= 4 ? GOLD : tier >= 3 ? GILT : SILVER);

/** 横着的刀（刀尖朝右）：把竖着的那把顺时针转 90°（像素对像素，不糊）；握刀的那一点跟着换。 */
const RIGHT: Grid = grid(Array.from({ length: SANJIAN_UP.w }, (_, y) => Array.from({ length: SANJIAN_UP.h }, (_, x) => SANJIAN_UP.rows[SANJIAN_UP.h - 1 - x][y]).join('')));
const GRIP = { x: SANJIAN_UP.h - 1 - SANJIAN_GRIP.y + 0.5, y: SANJIAN_GRIP.x + 0.5 };
/** 刀尖离握刀的那一点多远。 */
export const BLADE_REACH = SANJIAN_GRIP.y;

/** 一个人手里的那把刀：正在做哪一步、转到哪个角度、往前送了多少。 */
interface Blade {
  s: Sprite;
  step: 'sweep' | 'back' | 'stab' | 'chop' | 'hold';
  t: number; // 这一步过了多久
  a0: number; // 这一步开始和结束时刀的方向
  a1: number;
  ang: number; // 现在的方向
  ext: number; // 往前送了多少（刺）
  idle: number; // 收招后又过了多久（过一会儿收回手里，人物换回握刀的帧）
  alpha: number;
}

/** 一道飞出去的月牙刀光。 */
interface Crescent {
  owner: number;
  a: number;
  arc: number;
  dir: number;
  r: number;
  tier: number;
  t: number;
  delay: number;
  echo: boolean; // 灵品起身后跟的那一道（淡、窄）
  back: boolean;
}
/** 一道刺芒。 */
interface Streak {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tier: number;
  t: number;
  sprayed: boolean;
}
/** 一道劈山的裂缝（贴地）。 */
interface Rift {
  pts: [number, number][];
  len: number;
  w: number;
  tier: number;
  t: number;
  debris: number;
}

const SWEEP_T = 0.12; // 刀转过去要多久（模拟在出手那一帧就结算了，刀光要马上到）
const STAB_T = 0.07;
const CHOP_T = 0.09;
const HOLD_T = 0.22; // 最后一步之后再等多久收刀

export class SanjianFx {
  private blades = new Map<number, Blade>();
  private crescents: Crescent[] = [];
  private streaks: Streak[] = [];
  private rifts: Rift[] = [];
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private stroke = new Stroke();
  private uStroke = new Stroke();
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private hitSound = new Map<number, number>(); // 这一刀响过「打中」没有（一刀只响一次）
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    stage.floor.addChild(this.under.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 这个人手里的刀是不是正挥着（人物这时用空手的帧）。 */
  busy(owner: number): boolean {
    return this.blades.has(owner);
  }

  clear() {
    for (const b of this.blades.values()) b.s.destroy();
    this.blades.clear();
    this.crescents = [];
    this.streaks = [];
    this.rifts = [];
    this.top.flush();
    this.under.flush();
  }

  private blade(owner: number): Blade {
    let b = this.blades.get(owner);
    if (!b) {
      const s = new Sprite();
      this.stage.entities.addChild(s);
      b = { s, step: 'hold', t: 0, a0: 0, a1: 0, ang: 0, ext: 0, idle: 0, alpha: 1 };
      this.blades.set(owner, b);
    }
    b.idle = 0;
    b.t = 0;
    b.alpha = 1;
    return b;
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'cleave': {
        const b = this.blade(e.owner);
        // 刀从扇面的一边转到另一边（转得比扇面稍多一点，收在身前）
        b.step = e.back ? 'back' : 'sweep';
        b.a0 = e.a - e.dir * e.arc * 1.05;
        b.a1 = e.a + e.dir * e.arc * 1.05;
        b.ang = b.a0;
        b.ext = 0;
        this.crescents.push({ owner: e.owner, a: e.a, arc: e.arc, dir: e.dir, r: e.r, tier: e.tier, t: 0, delay: 0.02, echo: false, back: !!e.back });
        // 灵品起身后跟一道淡的；「回锋」本身就是来回两道刀光，不再各跟一道（四道同心的弧叠在一起像一圈圈波纹）
        const edge = w.players[e.owner]?.weapons.some((x) => x.kind === 'sanjian' && x.spirit === 'edge');
        if (e.tier >= 2 && !edge) this.crescents.push({ owner: e.owner, a: e.a, arc: e.arc * 0.9, dir: e.dir, r: e.r * 0.82, tier: e.tier, t: 0, delay: 0.07, echo: true, back: !!e.back });
        this.hitSound.set(e.owner, 0);
        this.play('sanjian.sweep', 'huaxue.slash', e.back ? 0.8 : 1);
        break;
      }
      case 'stab': {
        const b = this.blade(e.owner);
        b.step = 'stab';
        b.a0 = b.a1 = b.ang = Math.atan2(e.y1 - e.y0, e.x1 - e.x0);
        b.ext = 0;
        this.streaks.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, tier: e.tier, t: 0, sprayed: false });
        this.hitSound.set(e.owner, 0);
        this.play('sanjian.stab', 'huojian.thrust', e.seq > 1 ? 0.8 : 1);
        break;
      }
      case 'chop': {
        const b = this.blade(e.owner);
        const a = Math.atan2(e.y1 - e.y0, e.x1 - e.x0);
        const right = Math.cos(a) >= 0;
        if (b.step !== 'chop' || b.t > 0.05) {
          // 刀从头顶（往后一点）劈下来，停在身前、刀尖指着裂缝的方向
          b.step = 'chop';
          b.a0 = right ? -Math.PI * 0.62 : -Math.PI * 0.38;
          b.a1 = a;
          b.ang = b.a0;
          b.ext = 0;
        }
        const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
        this.rifts.push({ pts: jag(e.x0, e.y0, e.x1, e.y1, 5, 4), len, w: e.w, tier: e.tier, t: -CHOP_T * 0.7, debris: 0 });
        this.play('sanjian.chop', 'fantian.land', 0.9);
        this.play('sanjian.rift', 'zone.crack', 0.8);
        this.shake.add(e.tier >= 4 ? 0.22 : 0.15);
        break;
      }
      case 'hit': {
        if (e.by !== 'cleave' && e.by !== 'stab' && e.by !== 'chop') break;
        const hd = headOf(e.kind);
        const c = e.by === 'chop' ? [C.Y, C.f, C.W] : [C.W, C.w, C.j];
        this.sparks.emit(e.x, e.y - hd * 0.5, e.crit ? 6 : 3, c, [30, 80], [0.15, 0.3], { drag: 3 });
        const owner = [...this.blades.keys()][0] ?? 0;
        if (!this.hitSound.get(owner)) {
          this.hitSound.set(owner, 1);
          this.sfx.hit(e.crit);
        }
        break;
      }
    }
    void w;
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const st = this.stroke;
    const us = this.uStroke;
    // ---- 手里的刀 ----
    for (const [owner, b] of this.blades) {
      const p = w.players[owner];
      if (!p) {
        b.s.destroy();
        this.blades.delete(owner);
        continue;
      }
      b.t += dt;
      const hx = p.px + (p.x - p.px) * alpha;
      const hy = p.py + (p.y - p.py) * alpha;
      let k = 1;
      if (b.step === 'sweep' || b.step === 'back') {
        k = easeOut(b.t / SWEEP_T);
        b.ang = b.a0 + (b.a1 - b.a0) * k;
        b.ext = 0;
      } else if (b.step === 'stab') {
        // 往前一送、停一下、收回来一半
        const u = b.t / STAB_T;
        b.ext = u < 1 ? 10 * easeOut(u) : 10 - 5 * clamp01((b.t - STAB_T - 0.06) / 0.12);
      } else if (b.step === 'chop') {
        k = easeOut(b.t / CHOP_T);
        const d = wrapPi(b.a1 - b.a0);
        b.ang = b.a0 + d * k;
        b.ext = 2 * k;
      }
      const done = b.step === 'hold' || b.t > (b.step === 'stab' ? STAB_T + 0.18 : SWEEP_T + 0.05);
      if (done) {
        b.idle += dt;
        if (b.idle > HOLD_T) {
          b.alpha -= dt / 0.06;
          if (b.alpha <= 0) {
            b.s.destroy();
            this.blades.delete(owner);
            continue;
          }
        }
      }
      // 握刀的那一点：胸前（朝着刀的方向偏一点；人物 32 像素高，拳头离脚底约 12）
      const gx = hx + Math.cos(b.ang) * (5 + b.ext);
      const gy = hy - 12 + Math.sin(b.ang) * (2 + b.ext * 0.6);
      applyRot(b.s, rotTex('sanjian', RIGHT, b.ang, GRIP.x, GRIP.y, 48, SANJIAN_SEL, true));
      b.s.position.set(Math.round(gx), Math.round(gy));
      b.s.zIndex = Math.round(hy) + (Math.sin(b.ang) < -0.3 ? -1 : 1); // 刀往上举时在人物身后
      b.s.alpha = clamp01(b.alpha);
      // 挥动时刀尖带一道短短的残光（刀尖的轨迹）
      if ((b.step === 'sweep' || b.step === 'back' || b.step === 'chop') && k < 1) {
        const a0 = b.step === 'chop' ? b.a0 : b.a0;
        const n = Math.ceil(Math.abs(b.ang - a0) * 16);
        for (let i = 0; i <= n; i++) {
          const u = i / Math.max(1, n);
          const aa = a0 + (b.ang - a0) * u;
          const rr = BLADE_REACH - 2;
          stamp(st, gx + Math.cos(aa) * rr, gy + Math.sin(aa) * rr, 0.4 + 0.9 * u, 0.25 + 0.55 * u, SILVER);
        }
      }
    }
    // ---- 月牙刀光：从近处往外飞到横扫的边上，停一下，再淡掉 ----
    for (let i = this.crescents.length - 1; i >= 0; i--) {
      const c = this.crescents[i];
      c.t += dt;
      const t = c.t - c.delay;
      const FLY = 0.16;
      const LIFE = 0.5;
      if (t > LIFE) {
        this.crescents.splice(i, 1);
        continue;
      }
      if (t < 0) continue;
      const p = w.players[c.owner];
      if (!p) continue;
      const hx = p.px + (p.x - p.px) * alpha;
      const hy = p.py + (p.y - p.py) * alpha - 8;
      const kk = easeOut(t / FLY);
      const R = c.r * (0.45 + 0.55 * kk);
      const al = fade(t, LIFE, 0.03, 0.28) * (c.echo ? 0.5 : 1);
      // 刀光细一点（克制）：横扫的扇面大，月牙只是一道细细的光，中间最厚 4–7 像素
      const hw = ([0, 2.1, 2.5, 2.9, 3.3][c.tier] ?? 2.5) * (c.echo ? 0.55 : 1) * (1 - 0.35 * clamp01((t - FLY) / (LIFE - FLY)));
      this.crescent(hx, hy, c, R, hw, al, clamp01(t / 0.09));
      // 刀光边上落下几粒碎光（银，仙品起金）
      if (!c.echo && t < FLY + 0.1 && Math.random() < 0.8) {
        const ang = c.a + rnd(-c.arc, c.arc);
        const rr = R - rnd(0, hw);
        this.sparks.emit(hx + Math.cos(ang) * rr, hy + Math.sin(ang) * rr, 1, c.tier >= 3 ? [C.Y, C.f, C.W] : [C.W, C.w, C.j], [6, 18], [0.3, 0.5], { dir: ang, spread: 0.6, drag: 3 });
      }
    }
    // ---- 刺芒：从刀尖一下飞到刺得到的地方，再慢慢淡掉；芒尖上三粒碎光分开（三尖） ----
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.t += dt;
      const LIFE = 0.34;
      if (s.t > LIFE) {
        this.streaks.splice(i, 1);
        continue;
      }
      const dx = s.x1 - s.x0;
      const dy = s.y1 - s.y0;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const grow = easeOut(s.t / 0.06);
      const start = BLADE_REACH * 0.8;
      const al = fade(s.t, LIFE, 0.02, 0.24);
      const hw = [0, 1.4, 1.7, 1.9, 2.2][s.tier] ?? 1.6;
      taperedStreak(st, s.x0, s.y0, ux, uy, start, start + (len - start) * grow, hw, al, cols(s.tier));
      if (!s.sprayed && s.t >= 0.06) {
        s.sprayed = true;
        const a = Math.atan2(uy, ux);
        for (const da of [-0.35, 0, 0.35]) this.sparks.emit(s.x1, s.y1, 1, s.tier >= 3 ? [C.Y, C.f] : [C.W, C.w], [30, 50], [0.18, 0.3], { dir: a + da, spread: 0.08, drag: 4 });
      }
    }
    // ---- 劈山：地上一道裂开的金光，一下裂到头，亮一会儿、由金转暗、慢慢合上 ----
    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const r = this.rifts[i];
      r.t += dt;
      const LIFE = r.tier >= 4 ? 1.5 : 1.25;
      if (r.t > LIFE) {
        this.rifts.splice(i, 1);
        continue;
      }
      if (r.t < 0) continue;
      this.rift(us, r, LIFE);
    }
    st.commit(this.top);
    us.commit(this.under);
    this.top.flush();
    this.under.flush();
  }

  /** 一道月牙：外沿是半径 R 的弧，中间最厚、两头收尖；从起手的那一边先出来（reveal）。 */
  private crescent(x: number, y: number, c: Crescent, R: number, hw: number, al: number, reveal: number) {
    const st = this.stroke;
    const cl = cols(c.tier);
    const a0 = c.a - c.dir * c.arc;
    const span = c.arc * 2 * reveal;
    const n = Math.ceil(span * R * 1.15);
    for (let i = 0; i <= n; i++) {
      const u = i / Math.max(1, n);
      const ang = a0 + c.dir * span * u;
      const v = (ang - (c.a - c.arc)) / (2 * c.arc);
      const thick = hw * 2 * Math.sin(Math.PI * clamp01(v)) ** 0.8;
      if (thick < 0.4) continue;
      const cx = Math.cos(ang);
      const cy = Math.sin(ang); // 和模拟的判定一样是正圆的扇面
      for (let d = 0; d <= thick; d += 0.6) {
        const q = d / thick;
        const [col, pr] = q < 0.2 ? [cl[0], 5] : q < 0.45 ? [cl[1], 4] : q < 0.75 ? [cl[2], 3] : [cl[3], 2];
        st.dot(x + cx * (R - d), y + cy * (R - d), col, al * (q < 0.2 ? 0.95 : 0.9), pr);
      }
    }
  }

  /** 一道裂缝：中线是深色的缝，两边金光（越新越亮、越宽），慢慢褪成赭色、再淡掉；裂的时候崩起碎石、扬起尘土。 */
  private rift(us: Stroke, r: Rift, life: number) {
    const t = r.t;
    const open = clamp01(t / 0.12); // 一下裂到头
    const heat = 1 - clamp01((t - 0.15) / (life * 0.6)); // 金光由亮转暗
    const al = fade(t, life, 0.02, 0.45);
    const pts = r.pts;
    let total = 0;
    const seg: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      seg.push(total);
    }
    const reach = total * open;
    const glow: Cols = heat > 0.55 ? [C.f, C.Y, C.y, C.b] : heat > 0.2 ? [C.Y, C.y, C.b, C.B] : [C.y, C.b, C.B, C.B];
    for (let i = 1; i < pts.length; i++) {
      if (seg[i - 1] > reach) break;
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const l = seg[i] - seg[i - 1];
      for (let s = 0; s <= l; s += 0.6) {
        const at = seg[i - 1] + s;
        if (at > reach) break;
        const u = at / total;
        const x = x0 + ((x1 - x0) * s) / l;
        const y = y0 + ((y1 - y0) * s) / l;
        // 裂缝两头细、中间宽；新裂开的地方最亮
        const wid = (0.6 + 1.6 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.6) * (r.tier >= 4 ? 1.25 : 1) * (0.55 + 0.45 * heat);
        stamp(us, x, y, wid, al * (0.6 + 0.4 * heat), glow);
        us.dot(x, y, C.k, al * 0.9, 6); // 缝本身
      }
    }
    // 裂开的那一下：沿着缝崩起碎石、扬起尘土（金光里飞出几粒灵光）
    const want = Math.floor(open * (r.tier >= 4 ? 18 : 12));
    while (r.debris < want) {
      r.debris++;
      const at = (r.debris / (r.tier >= 4 ? 18 : 12)) * total;
      let i = 1;
      while (i < seg.length - 1 && seg[i] < at) i++;
      const k = (at - seg[i - 1]) / Math.max(1e-6, seg[i] - seg[i - 1]);
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k;
      const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k;
      this.sparks.emit(x, y - 1, 2, [0x6b5a62, 0x8f9787, C.B], [20, 60], [0.3, 0.55], { up: 40, g: 220, drag: 1 });
      if (r.debris % 3 === 0) this.glows.emit(x, y - 2, 1, [C.Y, C.f], [8, 20], [0.35, 0.6], { up: 18, drag: 2 });
      if (r.debris % 2 === 0) this.sparks.emit(x, y, 1, [0xb3b8a6, 0x8f9787], [6, 16], [0.4, 0.7], { up: 6, drag: 3 });
    }
  }
}

const wrapPi = (a: number) => a - TAU * Math.round(a / TAU);
