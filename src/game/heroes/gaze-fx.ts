// 杨戬 · 神通「天眼」的画面：额上的天眼睁开（一道竖着的金纹亮起、慢慢张开），一道金光从天眼照到地上，
// 在身前扫过一个扇面（扫的角度直接读模拟里的 Player.gaze，和判定逐帧一致）；扫过的地方留下一片渐渐淡去的金色余光，
// 照到的敌人身上亮一下；之后被「标记」的敌人头顶浮着一道竖着的小金纹（和杨戬额上的天眼一个样子），标记快到时慢慢淡掉。
// 用户口径：人物身上不要光圈（天眼是竖纹，不是圆）；特效要看得见、出现消失有过程；不画得过大（金光只到照得到的地方）。
import { Container } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, fade, headOf, Pixels, rnd } from '../fx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

/** 天眼在人物身上的位置（相对脚底；朝右时，朝左镜像 x）：和 src/art/sprites/yangjian.ts 额上那道金纹对齐。 */
export const EYE = { x: 2, y: -26 };

interface Sweep {
  owner: number;
  a0: number;
  a1: number;
  r: number;
  dur: number;
  t: number;
  ang: number; // 这一帧光所在的角度
  trail: { a: number; t: number }[]; // 扫过的角度（余光按它画、慢慢淡）
  hit: Set<number>;
}

const TRAIL = 0.65; // 余光留多久
const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/**
 * 光扫到扇面的哪一处是在什么时候：模拟里光的角度是 a0 + (a1 − a0) × smoothstep(t / dur)（sim/heroes/yangjian.ts），
 * 反过来查表（INV[i] 是 smoothstep 等于 i / N 时的 t / dur），每个像素一次查表，不用每个像素去翻扫过的角度。
 */
const INV_N = 256;
const INV = (() => {
  const out = new Float32Array(INV_N + 1);
  for (let i = 0; i <= INV_N; i++) {
    const v = i / INV_N;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2;
      if (m * m * (3 - 2 * m) < v) lo = m;
      else hi = m;
    }
    out[i] = (lo + hi) / 2;
  }
  return out;
})();
const passFrac = (k: number) => INV[Math.max(0, Math.min(INV_N, Math.round(k * INV_N)))];
const AFTER = 0.25; // 扫完之后光再停多久淡掉

export class GazeFx {
  private sweeps: Sweep[] = [];
  private px = new Pixels();
  private layer = new Container();
  private seen = new Map<number, number>(); // 被标记的敌人 → 第一次看到的时刻（淡入用）
  private eyes = new Map<number, number>(); // 人物 → 天眼睁开了多久（-1 = 合着）
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.px.g);
  }

  /** 这个人正在放天眼吗（放的时候人物不换出招的姿势）。 */
  active(owner: number) {
    return this.sweeps.some((s) => s.owner === owner);
  }

  clear() {
    this.sweeps = [];
    this.seen.clear();
    this.eyes.clear();
    this.px.flush();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'waveStart' || e.t === 'waveEnd') return this.clear();
    if (e.t === 'skill' && e.kind === 'gaze') {
      const dir = e.dir ?? 1;
      const arc = e.arc ?? 0.7;
      const a = e.a ?? 0;
      this.sweeps.push({ owner: e.owner, a0: a - dir * arc, a1: a + dir * arc, r: e.radius, dur: e.dur ?? 0.55, t: 0, ang: a - dir * arc, trail: [], hit: new Set() });
      this.eyes.set(e.owner, 0);
      this.sfx.play(BANK['tianyan.gaze'] ? 'tianyan.gaze' : 'yinyang.beam', 1);
      this.shake.add(0.25);
      return;
    }
    if (e.t === 'hit' && e.by === 'skill') {
      // 照到的那一下：身上一亮（金白碎光往上飘）
      const s = this.sweeps.find((x) => w.players[x.owner] && !x.hit.has(e.id));
      if (!s) return;
      s.hit.add(e.id);
      const hd = headOf(e.kind);
      this.glows.emit(e.x, e.y - hd * 0.55, 5, [C.f, C.Y, C.W], [10, 35], [0.3, 0.55], { up: 20, drag: 3 });
      this.sparks.emit(e.x, e.y - hd * 0.55, 3, [C.W, C.Y], [20, 50], [0.15, 0.3], { drag: 3 });
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const px = this.px;
    // ---- 一扫 ----
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const s = this.sweeps[i];
      s.t += dt;
      const p = w.players[s.owner];
      if (!p || s.t > s.dur + AFTER + TRAIL) {
        this.sweeps.splice(i, 1);
        continue;
      }
      const g = p.gaze;
      if (g) s.ang = g.pa + (g.a - g.pa) * alpha;
      else if (s.t >= s.dur) s.ang = s.a1;
      if (s.t <= s.dur + 0.02) s.trail.push({ a: s.ang, t: s.t });
      const hx = p.px + (p.x - p.px) * alpha;
      const hy = p.py + (p.y - p.py) * alpha;
      const face = Math.cos(s.a0 + (s.a1 - s.a0) / 2) >= 0 ? 1 : -1;
      const ex = hx + face * EYE.x;
      const ey = hy + EYE.y;
      // 余光：扫过的扇面上一层金色的光，按光扫过那一刻算新旧——刚扫过的最亮（白金），越旧越淡，外沿柔柔地散开（没有硬边）
      const dir = s.a1 >= s.a0 ? 1 : -1;
      const span = Math.abs(s.a1 - s.a0) || 1;
      const cur = wrapAngle(s.ang - s.a0) * dir;
      const R = s.r;
      const x0 = Math.floor(hx - R);
      const y0 = Math.floor(hy - R);
      // 隔一个像素点一个（棋盘格）：一层细细的金色光点，也省一半的工夫
      for (let y = y0; y <= y0 + 2 * R; y++)
        for (let x = x0 + ((x0 + y) & 1); x <= x0 + 2 * R; x += 2) {
          const dx = x - hx;
          const dy = y - hy;
          const d2 = dx * dx + dy * dy;
          if (d2 < 64 || d2 > R * R) continue;
          const rel = wrapAngle(Math.atan2(dy, dx) - s.a0) * dir;
          if (rel < -0.02 || rel > cur + 0.02) continue;
          const age = s.t - s.dur * passFrac(rel / span);
          if (age > TRAIL) continue;
          const k = 1 - age / TRAIL;
          const u = Math.sqrt(d2) / R;
          const edge = (1 - smooth(0.78, 1, u)) * smooth(-0.02, 0.16, rel); // 外沿、起手那一边都是柔边
          const a = (age < 0.05 ? 0.7 : 0.48) * k * k * edge * (0.85 + 0.15 * Math.sin(x * 0.9 + y * 1.3));
          px.dot(x, y, age < 0.05 ? C.W : age < 0.14 ? C.f : C.Y, a);
        }
      // 光：从天眼照到地上（照到的那一点 G），细的一头在额上、越往外越宽、越淡（光散开了，不是一道硬的激光）
      const lit = s.t <= s.dur ? 1 : 1 - clamp01((s.t - s.dur) / AFTER);
      if (lit > 0) {
        const gx = hx + Math.cos(s.ang) * s.r;
        const gy = hy + Math.sin(s.ang) * s.r;
        const len = Math.hypot(gx - ex, gy - ey);
        const ux = (gx - ex) / len;
        const uy = (gy - ey) / len;
        const nx = -uy;
        const ny = ux;
        for (let d = 2; d <= len; d += 0.6) {
          const u = d / len;
          const wid = 0.4 + 2.2 * u;
          const fall = lit * (1 - 0.75 * u * u);
          for (let o = -Math.ceil(wid) - 1; o <= Math.ceil(wid) + 1; o += 0.6) {
            const q = Math.abs(o) / (wid + 0.4);
            if (q > 1.4) continue;
            const col = q < 0.3 ? C.W : q < 0.7 ? C.f : q < 1.05 ? C.Y : C.y;
            px.dot(ex + ux * d + nx * o, ey + uy * d + ny * o, col, fall * (q < 1.05 ? 0.8 : 0.35));
          }
        }
        if (Math.random() < 0.8) {
          const u = rnd(0.25, 1);
          this.glows.emit(hx + Math.cos(s.ang) * s.r * u, hy + Math.sin(s.ang) * s.r * u, 1, [C.f, C.Y], [4, 14], [0.4, 0.7], { up: 14, drag: 2 });
        }
      }
    }
    // ---- 天眼：额上一道竖金纹张开（1 → 3 像素），扫完慢慢合上 ----
    for (const [owner, t0] of this.eyes) {
      const p = w.players[owner];
      if (!p) continue;
      const t = t0 + dt;
      this.eyes.set(owner, t);
      const sw = this.sweeps.find((s) => s.owner === owner);
      const dur = sw ? sw.dur : 0.55;
      if (t > dur + 0.45) {
        this.eyes.delete(owner);
        continue;
      }
      const hx = p.px + (p.x - p.px) * alpha;
      const hy = p.py + (p.y - p.py) * alpha;
      const face = sw ? (Math.cos(sw.a0 + (sw.a1 - sw.a0) / 2) >= 0 ? 1 : -1) : p.facing;
      const ex = Math.round(hx + face * EYE.x);
      const ey = Math.round(hy + EYE.y);
      const open = t < dur ? clamp01(t / 0.08) : 1 - clamp01((t - dur) / 0.45);
      const half = open > 0.6 ? 1 : 0;
      for (let j = -half; j <= half; j++) px.dot(ex, ey + j, j === 0 ? C.W : C.f, Math.max(0.35, open));
    }
    // ---- 标记：被照到的敌人头顶一道竖着的小金纹（淡入、轻轻呼吸，快到时淡掉） ----
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.gazeUntil === undefined || w.time >= e.gazeUntil) continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      const a = clamp01((this.time - t0) / 0.2) * clamp01((e.gazeUntil - w.time) / 0.8) * (0.8 + 0.2 * Math.sin(this.time * 5 + e.id));
      const x = Math.round(e.px + (e.x - e.px) * alpha);
      const y = Math.round(e.py + (e.y - e.py) * alpha - headOf(e.kind) - 6 + Math.sin(this.time * 2.4 + e.id) * 0.6);
      // 一道竖着的小金纹（像杨戬额上那只眼）：5 像素高，中间两点月白，两侧描一点赭（亮的地面上也压得住）
      for (const [dy, col] of [[-2, C.y], [-1, C.Y], [0, C.W], [1, C.Y], [2, C.y]] as const) px.dot(x, y + dy, col, a);
      px.dot(x - 1, y - 1, C.b, a * 0.6);
      px.dot(x - 1, y, C.B, a * 0.7);
      px.dot(x - 1, y + 1, C.b, a * 0.6);
      px.dot(x + 1, y - 1, C.b, a * 0.6);
      px.dot(x + 1, y, C.B, a * 0.7);
      px.dot(x + 1, y + 1, C.b, a * 0.6);
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    px.flush();
    void fade;
  }
}
