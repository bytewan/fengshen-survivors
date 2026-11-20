// 首领「魔化哪吒」（第一章第 6 波）。第二、三章各有自己的首领（ch2/yao.ts、ch3/zhuxian.ts），这里的按章数组（BOSS.hp / dmg）只剩第一章在用。
// 陈塘关的旧战回响里，哪吒被封神榜的执念魔化，玩家操控的哪吒要打败另一个自己（用户定，2026-11-09）。
// 三阶段（气血 100% → 60% → 30% → 0），每一招都先预警、再结算：
//   一：黑焰乾坤圈（往返路线先亮出来）、火尖枪突进（地上先亮一道直线，再整条冲过去）；
//   二：三头六臂（两个残影和本体轮流突进）、混天绫横扫（半个场地的弧形红绸，往扫动的反方向躲）；
//   三：魔焰焚城（魔气从四边往里压，能站的地方越来越小）、风火轮（满场滚过燃烧的火轮）。
// 纯函数、确定性：随机数只用 w.rng。首领本体仍是 w.enemies 里 kind 'boss' 的敌人（法宝照常打它），
// 它的移动由这里控制；每一招的预警与判定都放在 BossFight.hazards 里，表现层只读它来画。
// 首领的弹道（黑焰乾坤圈、风火轮）不和玩家的法宝互动：打不掉，只能躲（用户定）。
// 对外是一个首领模块 NEZHA_BOSS（chapters.ts 登记到第一章；接口见 chapters.ts 的 BossModule），状态在 w.boss（kind 'nezha'）。
import { ARENA, BOSS, DT, ENEMIES, PLAYER } from './config.ts';
import { chapterOf } from './catalog.ts';
import { hurtPlayer } from './core.ts';
import { range } from './rng.ts';
import { spawnSpot } from './spawn.ts';
import { cameras } from './coop.ts';
import { jieInferno } from './jie.ts';
import { POOL, fightEnemy, fightOf, guestDown, guestHp, putFight, type BossId } from './bosspool.ts';
import type { BossModule } from './chapters.ts';
import type { YaoMove } from './ch2/types.ts';
import type { ZhuxianMove } from './ch3/types.ts';
import type { Enemy, EnemyKindName, Player, SimEvent } from './types.ts';
import type { World } from './world.ts';

export type BossMove = 'ring' | 'dash' | 'clones' | 'sweep' | 'wheels';
/** intro 入场；idle 两招之间；cast 出招（含预警）；recover 收招（可以被输出）；phase 换阶段；dead 倒下的表现。 */
export type BossState = 'intro' | 'idle' | 'cast' | 'recover' | 'phase' | 'dead';
export type HazardKind = 'ring' | 'dash' | 'sweep' | 'wheel';

/**
 * 一个危险物：先预警 warn 秒（不伤人），再生效 live 秒（会伤人），然后消失。
 * 几何：
 *  - ring（黑焰乾坤圈）：路线 (x0,y0) → (x1,y1) 是飞出去的那一段，在「胸口高度」（比地面高 8–12 像素）；r 是判定半径。
 *  - dash（火尖枪突进）：地上的直线 (x0,y0) → (x1,y1)，r 是半宽；突进的是本体（src 0）或残影（src 1 / 2）。
 *  - wheel（风火轮）：地上的车道 (x0,y0) → (x1,y1)，r 是火轮半径。
 *  - sweep（混天绫横扫）：以 (x0,y0) 为圆心、r 为半径的半圆，从角 a0 起朝 dir 方向扫过 π。
 * (x, y) 是正在运动的东西（圈、火轮、突进中的人）现在的位置，a 是横扫的红绫现在的角度。
 */
export interface Hazard {
  id: number;
  kind: HazardKind;
  move: BossMove;
  src: number; // 谁放的：0 本体，1 / 2 残影
  t: number; // 从开始预警算起过了多久
  warn: number;
  live: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  a0: number;
  dir: 1 | -1;
  x: number;
  y: number;
  px: number;
  py: number;
  a: number;
  pa: number;
  dmg: number;
  hits: number; // 已经打中过哪些玩家（按位），每个危险物对每个人最多打一次
}

/** 三头六臂的残影：打不到，不进 w.enemies；先滑到玩家身侧，再突进，冲完就散。 */
export interface BossClone {
  src: number; // 1 / 2
  x: number;
  y: number;
  px: number;
  py: number;
  sx: number; // 滑出去的起点与终点
  sy: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
}

/** 魔焰焚城：魔气每隔一阵向内推进一步。 */
export interface Inferno {
  on: boolean;
  step: number; // 已经推了几步
  next: number; // 距下一次推进还有多久
  warned: boolean; // 这一次推进前的预警发过没有
  t: number; // 推进进行了多久（-1 = 没在推）
  fx: number; // 这一步从哪推到哪
  fy: number;
  tx: number;
  ty: number;
}

export interface BossFight {
  kind: 'nezha'; // 哪一个首领（chapters.ts 按它查首领模块）
  id: number; // 首领本体在 w.enemies 里的 id
  /** true = 来遭遇战（首领池，bosspool.ts：状态在 w.echo，两个阶段、不压魔气、不刷回响兵、波末退走）；false = 当这一章的首领。 */
  guest: boolean;
  chapter: number;
  phase: number; // 1..3（遭遇战 1..2）
  state: BossState;
  t: number; // 进入当前状态多久了
  lt: number; // 上一帧的 t（招式按时间点触发用）
  dur: number; // 当前状态打算持续多久（intro / idle / recover / phase / dead）
  move: BossMove | null;
  last: BossMove | null;
  queue: BossMove[]; // 指定接下来出哪几招（测试、截图用；空了就按招式池随机）
  facing: 1 | -1;
  moving: boolean; // 这一帧在走路（表现层换走路帧）
  mul: number; // 伤害倍率（按章）
  hazards: Hazard[];
  clones: BossClone[];
  slide: { sx: number; sy: number; tx: number; ty: number } | null; // 三头六臂时本体滑去的位置
  inferno: Inferno;
  summonT: number;
  deadAt: { x: number; y: number } | null;
  retreat: { x: number; y: number } | null; // 倒下时魔气从多深退回去
}

/** 首领自己的事件（并进 SimEvent）。表现层据此出画面和声音。 */
export type BossEvent =
  | { t: 'bossIntro'; id: number; kind: BossId; x: number; y: number; chapter: number } // kind：这一章抽到的是哪一位（首领池，bosspool.ts）
  | { t: 'bossMove'; id: number; move: BossMove | YaoMove | ZhuxianMove; x: number; y: number } // 一招起手（第二章的姚天君、第三章的诛仙剑灵也用它）
  | { t: 'bossCast'; id: number; hazard: number; move: BossMove; kind: HazardKind; src: number; x: number; y: number } // 一个危险物开始预警
  | { t: 'bossStrike'; id: number; hazard: number; move: BossMove; kind: HazardKind; src: number; x: number; y: number } // 预警结束，开始伤人
  | { t: 'bossPhase'; id: number; phase: number; x: number; y: number }
  | { t: 'bossMiasmaWarn'; step: number } // 魔气马上要再往里推一步
  | { t: 'bossMiasma'; step: number; x: number; y: number } // 魔气开始往里推，x / y 是推完之后的缩进
  | { t: 'bossDeath'; id: number; kind: BossId; x: number; y: number; facing: 1 | -1; chapter: number };

type Spawn = (kind: EnemyKindName, x: number, y: number) => Enemy;

// ---------- 几何 ----------
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (k: number) => k * k * (3 - 2 * k);
/** 角度差归一到 (-π, π]。 */
const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** 点到线段的距离。 */
export function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const t = clamp(((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t));
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** 能站的范围：仙台减去魔焰焚城压进来的魔气，再往里收 pad。 */
export function innerRect(w: World, pad = 0): Rect {
  const i = w.miasmaInset;
  return { x0: i.x + pad, y0: i.y + pad, x1: ARENA.w - i.x - pad, y1: ARENA.h - i.y - pad };
}
/** 从 (x, y) 沿单位向量 (ux, uy) 最多走 len，碰到矩形边就停，返回走得了多远。 */
function rayLen(x: number, y: number, ux: number, uy: number, len: number, r: Rect) {
  let t = len;
  if (ux > 1e-6) t = Math.min(t, (r.x1 - x) / ux);
  else if (ux < -1e-6) t = Math.min(t, (r.x0 - x) / ux);
  if (uy > 1e-6) t = Math.min(t, (r.y1 - y) / uy);
  else if (uy < -1e-6) t = Math.min(t, (r.y0 - y) / uy);
  return Math.max(0, t);
}
const clampPt = (x: number, y: number, r: Rect) => ({ x: clamp(x, r.x0, r.x1), y: clamp(y, r.y0, r.y1) });

/** 整数 → [0, 1) 的固定散列（机器人的「走神」用，不动 w.rng）。 */
const hashUnit = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

// ---------- 查询 ----------
/** 这一仗（首领战在 w.boss、遭遇战在 w.echo）是魔化哪吒的话返回它（别的首领状态长得不一样）。 */
export function nezhaOf(w: World): BossFight | null {
  const f = fightOf(w);
  return f && f.kind === 'nezha' ? f : null;
}
/** 这一仗的本体（w.enemies 里 kind 'boss' 的那只；哪一位、哪种打法都一样）。 */
export const bossEnemy = fightEnemy;
const nearest = (b: { x: number; y: number }, ps: Player[]) => {
  let best: Player | null = null;
  let bd = Infinity;
  for (const p of ps) {
    const d = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
};
/** 首领倒下的表现放完了（world.ts 据此进入「本章平定 → 收灵 → 商店」或通关）。 */
export function bossDefeated(w: World) {
  const f = nezhaOf(w);
  return !!f && f.state === 'dead' && f.t >= f.dur - 1e-9;
}

/** 横扫这一刻扫过了多少角度（0..π）。挥动有起有收：先慢、中间快、最后收住。 */
export function sweepProgress(h: Hazard) {
  const k = clamp((h.t - h.warn) / h.live, 0, 1);
  return Math.PI * smooth(k);
}

/** 乾坤圈飞出去之后在 tl 秒时离出手点多远（飞出、在最远处一顿、折返）。 */
function ringOffset(h: Hazard, tl: number) {
  const len = Math.hypot(h.x1 - h.x0, h.y1 - h.y0);
  const out = len / BOSS.ring.speed;
  if (tl < out) return tl * BOSS.ring.speed;
  if (tl < out + BOSS.ring.hover) return len;
  return Math.max(0, len - (tl - out - BOSS.ring.hover) * BOSS.ring.speed);
}

// ---------- 状态机 ----------
function enter(f: BossFight, s: BossState, dur = 0) {
  f.state = s;
  f.t = 0;
  f.lt = -1;
  f.dur = dur;
}
/** 招式脚本里的「到了第 T 秒」：每个时间点只触发一次。 */
const at = (f: BossFight, T: number) => f.lt < T && f.t >= T;

function face(f: BossFight, from: { x: number }, toX: number) {
  if (Math.abs(toX - from.x) > 2) f.facing = toX >= from.x ? 1 : -1;
}

function addHazard(w: World, f: BossFight, h: Omit<Hazard, 'id' | 't' | 'x' | 'y' | 'px' | 'py' | 'a' | 'pa' | 'hits' | 'a0' | 'dir'> & Partial<Pick<Hazard, 'a0' | 'dir'>>, ev: SimEvent[]) {
  const hz: Hazard = { a0: 0, dir: 1, ...h, id: w.nextId++, t: 0, x: h.x0, y: h.y0, px: h.x0, py: h.y0, a: h.a0 ?? 0, pa: h.a0 ?? 0, hits: 0 };
  f.hazards.push(hz);
  ev.push({ t: 'bossCast', id: f.id, hazard: hz.id, move: hz.move, kind: hz.kind, src: hz.src, x: hz.x0, y: hz.y0 });
  return hz;
}

/** 突进线：从 (x, y) 穿过目标当时的位置，长 len，碰到场地边就截短。 */
function dashLine(w: World, x: number, y: number, tx: number, ty: number) {
  const d = Math.hypot(tx - x, ty - y) || 1;
  const ux = (tx - x) / d;
  const uy = (ty - y) / d;
  const len = Math.max(d, rayLen(x, y, ux, uy, BOSS.dash.len, innerRect(w, 12)));
  return { x0: x, y0: y, x1: x + ux * len, y1: y + uy * len, len };
}

type MoveScript = (w: World, f: BossFight, b: Enemy, p: Player, ev: SimEvent[]) => boolean;

const MOVES: Record<BossMove, MoveScript> = {
  // 黑焰乾坤圈：路线从首领手里穿过玩家当时的位置再往前一点；二阶段起一次两枚
  ring(w, f, b, p, ev) {
    const R = BOSS.ring;
    if (at(f, 0)) {
      face(f, b, p.x);
      const sx = b.x + f.facing * 6;
      const sy = b.y - 12;
      const base = Math.atan2(p.y - 8 - sy, p.x - sx);
      const len0 = clamp(Math.hypot(p.x - sx, p.y - 8 - sy) + R.over, R.minRange, R.range);
      const angles = f.phase >= 2 ? [base - R.spread, base + R.spread] : [base];
      for (const a of angles) {
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const len = Math.max(40, rayLen(sx, sy, ux, uy, len0, innerRect(w, -24)));
        addHazard(w, f, { kind: 'ring', move: 'ring', src: 0, warn: R.warn, live: (2 * len) / R.speed + R.hover, x0: sx, y0: sy, x1: sx + ux * len, y1: sy + uy * len, r: R.r, dmg: R.dmg * f.mul }, ev);
      }
    }
    return !f.hazards.some((h) => h.move === 'ring' && h.src === 0);
  },
  // 火尖枪突进：线在预警开始时定下，预警期间不跟踪；冲完收招
  dash(w, f, b, p, ev) {
    if (at(f, 0)) {
      face(f, b, p.x);
      const l = dashLine(w, b.x, b.y, p.x, p.y);
      addHazard(w, f, { kind: 'dash', move: 'dash', src: 0, warn: BOSS.dash.warn, live: l.len / BOSS.dash.speed, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, r: BOSS.dash.hw, dmg: BOSS.dash.dmg * f.mul }, ev);
    }
    return !f.hazards.some((h) => h.move === 'dash');
  },
  // 三头六臂：残影 A、B 滑到玩家左右两侧，本体滑到一侧偏上（或偏下）；三条线都接近水平，依次瞄准玩家当时的位置
  clones(w, f, b, p, ev) {
    const C = BOSS.clones;
    if (at(f, 0)) {
      const s = b.x >= p.x ? 1 : -1;
      const v = w.rng.next() < 0.5 ? -1 : 1;
      const R = innerRect(w, 18);
      const A = clampPt(p.x - s * C.side, p.y - v * C.rise, R);
      const B = clampPt(p.x + s * C.side, p.y + v * C.rise, R);
      const me = clampPt(p.x + s * (C.side + 14), p.y - v * C.bodyRise, R);
      f.clones = [A, B].map((q, k) => ({ src: k + 1, x: b.x, y: b.y, px: b.x, py: b.y, sx: b.x, sy: b.y, tx: q.x, ty: q.y, facing: (p.x >= q.x ? 1 : -1) as 1 | -1 }));
      f.slide = { sx: b.x, sy: b.y, tx: me.x, ty: me.y };
    }
    if (f.slide && f.t <= C.slide) {
      // 滑行：由快到慢（本体和残影一起）
      const k = 1 - (1 - Math.min(1, f.t / C.slide)) ** 3;
      for (const c of f.clones) {
        c.x = c.sx + (c.tx - c.sx) * k;
        c.y = c.sy + (c.ty - c.sy) * k;
      }
      b.x = f.slide.sx + (f.slide.tx - f.slide.sx) * k;
      b.y = f.slide.sy + (f.slide.ty - f.slide.sy) * k;
      f.moving = true;
      face(f, b, p.x);
    }
    const aim = (src: number) => {
      const who = src === 0 ? b : f.clones.find((c) => c.src === src);
      if (!who) return;
      const l = dashLine(w, who.x, who.y, p.x, p.y);
      if (src === 0) face(f, b, p.x);
      else (who as BossClone).facing = p.x >= who.x ? 1 : -1;
      addHazard(w, f, { kind: 'dash', move: 'clones', src, warn: BOSS.dash.warn, live: l.len / BOSS.dash.speed, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, r: BOSS.dash.hw, dmg: (src === 0 ? BOSS.dash.dmg : C.dmg) * f.mul }, ev);
    };
    if (at(f, C.slide)) aim(1);
    if (at(f, C.slide + C.gap)) aim(2);
    if (at(f, C.slide + 2 * C.gap)) aim(0);
    return f.t > C.slide + 2 * C.gap && !f.hazards.some((h) => h.move === 'clones');
  },
  // 混天绫横扫：站定；起始角 = 朝向玩家的角度往扫动的反方向偏 lead
  sweep(w, f, b, p, ev) {
    const S = BOSS.sweep;
    if (at(f, 0)) {
      face(f, b, p.x);
      const dir = (w.rng.next() < 0.5 ? 1 : -1) as 1 | -1;
      const a0 = Math.atan2(p.y - b.y, p.x - b.x) - dir * S.lead;
      addHazard(w, f, { kind: 'sweep', move: 'sweep', src: 0, warn: S.warn, live: S.time, x0: b.x, y0: b.y, x1: b.x, y1: b.y, r: S.r, a0, dir, dmg: S.dmg * f.mul }, ev);
    }
    return !f.hazards.some((h) => h.move === 'sweep');
  },
  // 风火轮：三条平行车道（一条穿过玩家、另两条隔 gap），火轮从场地一边滚到另一边；再从首领手里单独朝玩家滚一个。
  // 车道总和「首领 → 玩家」的方向垂直：躲进两条车道之间，再顺着车道方向挪一步，就能躲开单独滚来的那个（十字）
  wheels(w, f, b, p, ev) {
    const W = BOSS.wheels;
    if (at(f, 0)) {
      face(f, b, p.x);
      const R = innerRect(w, 0);
      const horiz = Math.abs(b.y - p.y) > Math.abs(b.x - p.x);
      const fwd = w.rng.next() < 0.5 ? 1 : -1;
      for (const k of [-1, 0, 1]) {
        let x0: number, y0: number, x1: number, y1: number;
        if (horiz) {
          y0 = y1 = p.y + k * W.gap;
          if (y0 < R.y0 + 6 || y0 > R.y1 - 6) continue;
          x0 = fwd > 0 ? R.x0 - 40 : R.x1 + 40;
          x1 = fwd > 0 ? R.x1 + 40 : R.x0 - 40;
        } else {
          x0 = x1 = p.x + k * W.gap;
          if (x0 < R.x0 + 6 || x0 > R.x1 - 6) continue;
          y0 = fwd > 0 ? R.y0 - 40 : R.y1 + 40;
          y1 = fwd > 0 ? R.y1 + 40 : R.y0 - 40;
        }
        addHazard(w, f, { kind: 'wheel', move: 'wheels', src: 0, warn: W.warn, live: Math.hypot(x1 - x0, y1 - y0) / W.speed, x0, y0, x1, y1, r: W.r, dmg: W.dmg * f.mul }, ev);
      }
    }
    if (at(f, W.aimAt)) {
      const d = Math.hypot(p.x - b.x, p.y - b.y) || 1;
      const ux = (p.x - b.x) / d;
      const uy = (p.y - b.y) / d;
      const len = Math.max(d + 40, rayLen(b.x, b.y, ux, uy, 2000, innerRect(w, -40)));
      addHazard(w, f, { kind: 'wheel', move: 'wheels', src: 0, warn: W.aimWarn, live: len / W.speed, x0: b.x, y0: b.y, x1: b.x + ux * len, y1: b.y + uy * len, r: W.r, dmg: W.dmg * f.mul }, ev);
    }
    // 火轮放出去就不用等它们滚完，首领可以收招
    return f.t >= Math.max(W.warn, W.aimAt + W.aimWarn) + 0.15;
  },
};

const RECOVER: Record<BossMove, number> = {
  ring: BOSS.ring.recover,
  dash: BOSS.dash.recover,
  clones: BOSS.clones.recover,
  sweep: BOSS.sweep.recover,
  wheels: BOSS.wheels.recover,
};

function pickMove(w: World, f: BossFight): BossMove {
  if (f.queue.length) return f.queue.shift()!;
  const pool = Object.entries(BOSS.pool[f.phase]).filter(([m]) => m !== f.last) as [BossMove, number][];
  let r = w.rng.next() * pool.reduce((s, [, v]) => s + v, 0);
  for (const [m, v] of pool) {
    r -= v;
    if (r < 0) return m;
  }
  return pool[pool.length - 1][0];
}

function toIdle(w: World, f: BossFight) {
  enter(f, 'idle', BOSS.idle[f.phase] + range(w.rng, -0.15, 0.15));
  f.move = null;
  f.slide = null;
}

/**
 * 空闲：慢慢朝玩家走，想站在玩家左边或右边 keep 像素、上下差得不多的地方——
 * 镜头是 16:9、以人物为中心，首领在人物正上方或正下方时容易出画、也会被界面压住。
 */
function walk(f: BossFight, b: Enemy, p: Player) {
  const side = b.x >= p.x ? 1 : -1;
  face(f, b, p.x);
  const mx = p.x + side * BOSS.keep - b.x;
  const my = p.y + clamp(b.y - p.y, -BOSS.keepY, BOSS.keepY) - b.y;
  const m = Math.hypot(mx, my);
  if (m < 3) return;
  const sp = BOSS.walk[f.phase] * (1 - 0.5 * b.slow) * DT; // 混天绫的减速对它只起一半作用
  b.x += (mx / m) * Math.min(m, sp);
  b.y += (my / m) * Math.min(m, sp);
  f.moving = true;
}

function runState(w: World, f: BossFight, b: Enemy, p: Player | null, ev: SimEvent[]) {
  switch (f.state) {
    case 'intro':
    case 'phase':
      if (f.t >= f.dur) toIdle(w, f);
      break;
    case 'idle':
      if (!p) break;
      walk(f, b, p);
      if (f.t >= f.dur) {
        const m = pickMove(w, f);
        f.move = m;
        f.last = m;
        enter(f, 'cast');
        ev.push({ t: 'bossMove', id: f.id, move: m, x: b.x, y: b.y });
      }
      break;
    case 'cast':
      if (!p || !f.move) break;
      if (MOVES[f.move](w, f, b, p, ev)) enter(f, 'recover', RECOVER[f.move]);
      break;
    case 'recover':
      if (f.t >= f.dur) toIdle(w, f);
      break;
    case 'dead':
      break;
  }
}

// ---------- 危险物的推进与判定 ----------
function hitTest(w: World, h: Hazard, alive: Player[], ev: SimEvent[], test: (p: Player) => boolean) {
  for (const p of alive) {
    const bit = 1 << p.id;
    if (h.hits & bit || !p.alive) continue;
    if (!test(p)) continue;
    h.hits |= bit;
    hurtPlayer(w, p, h.dmg, 'boss', ev);
  }
}

function updateHazards(w: World, f: BossFight, b: Enemy, alive: Player[], ev: SimEvent[]) {
  for (let i = f.hazards.length - 1; i >= 0; i--) {
    const h = f.hazards[i];
    const was = h.t;
    h.t += DT;
    if (h.t < h.warn) continue;
    const tl = h.t - h.warn;
    const ux = h.x1 - h.x0;
    const uy = h.y1 - h.y0;
    const len = Math.hypot(ux, uy) || 1;
    if (was < h.warn) ev.push({ t: 'bossStrike', id: f.id, hazard: h.id, move: h.move, kind: h.kind, src: h.src, x: h.x0, y: h.y0 });
    switch (h.kind) {
      case 'ring': {
        const s = ringOffset(h, tl);
        h.x = h.x0 + (ux / len) * s;
        h.y = h.y0 + (uy / len) * s;
        hitTest(w, h, alive, ev, (p) => segDist(p.x, p.y - 8, h.px, h.py, h.x, h.y) < h.r + PLAYER.radius);
        break;
      }
      case 'dash':
      case 'wheel': {
        const s = Math.min(len, tl * (h.kind === 'dash' ? BOSS.dash.speed : BOSS.wheels.speed));
        h.x = h.x0 + (ux / len) * s;
        h.y = h.y0 + (uy / len) * s;
        if (h.kind === 'dash') {
          const who = h.src === 0 ? b : f.clones.find((c) => c.src === h.src);
          if (who) {
            who.x = h.x;
            who.y = h.y;
          }
          if (h.src === 0) f.facing = ux >= 0 ? 1 : -1;
          // 用上一帧到这一帧的扫掠线段判定，冲得再快也不会穿过去
          hitTest(w, h, alive, ev, (p) => segDist(p.x, p.y, h.px, h.py, h.x, h.y) < h.r + 1);
        } else hitTest(w, h, alive, ev, (p) => segDist(p.x, p.y, h.px, h.py, h.x, h.y) < h.r + PLAYER.radius);
        break;
      }
      case 'sweep': {
        const prog = sweepProgress(h);
        h.a = h.a0 + h.dir * prog;
        const prev = h.dir * (h.pa - h.a0); // 上一帧扫到哪
        hitTest(w, h, alive, ev, (p) => {
          const d = Math.hypot(p.x - h.x0, p.y - h.y0);
          if (d > h.r + PLAYER.radius) return false;
          const rel = h.dir * wrapAngle(Math.atan2(p.y - h.y0, p.x - h.x0) - h.a0);
          const m = (PLAYER.radius - 1) / Math.max(d, 8); // 身子和红绫重叠才算打中
          return rel >= prev - m && rel <= prog + m;
        });
        break;
      }
    }
    if (tl >= h.live) {
      f.hazards.splice(i, 1);
      if (h.kind === 'dash' && h.src > 0) f.clones = f.clones.filter((c) => c.src !== h.src); // 残影冲完就散
    }
  }
}

function contactDamage(w: World, f: BossFight, b: Enemy, alive: Player[], ev: SimEvent[]) {
  if (f.state === 'intro') return;
  if (f.hazards.some((h) => h.kind === 'dash' && h.src === 0 && h.t >= h.warn)) return; // 突进中由突进线判定
  const r = ENEMIES.boss.radius + PLAYER.radius;
  for (const p of alive) {
    if (!p.alive || p.iframes > 0) continue;
    if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 > r * r) continue;
    hurtPlayer(w, p, BOSS.contact * f.mul, 'boss', ev);
  }
}

// ---------- 魔焰焚城 ----------
function updateInferno(w: World, f: BossFight, ev: SimEvent[]) {
  const I = f.inferno;
  const C = BOSS.inferno;
  if (!I.on) return;
  if (I.t >= 0) {
    I.t += DT;
    const k = smooth(Math.min(1, I.t / C.push));
    w.miasmaInset.x = I.fx + (I.tx - I.fx) * k;
    w.miasmaInset.y = I.fy + (I.ty - I.fy) * k;
    if (I.t >= C.push) {
      I.t = -1;
      I.next = C.every * jieInferno(w); // 劫四起推进得更勤（jie.ts；劫一到三是 1）
      I.warned = false;
    }
    return;
  }
  if (I.step >= C.steps) return;
  I.next -= DT;
  if (!I.warned && I.next <= C.warn) {
    I.warned = true;
    ev.push({ t: 'bossMiasmaWarn', step: I.step + 1 });
  }
  if (I.next > 0) return;
  I.step++;
  I.fx = w.miasmaInset.x;
  I.fy = w.miasmaInset.y;
  I.tx = Math.min(C.max.x, (C.max.x / C.steps) * I.step);
  I.ty = Math.min(C.max.y, (C.max.y / C.steps) * I.step);
  I.t = 0;
  ev.push({ t: 'bossMiasma', step: I.step, x: I.tx, y: I.ty });
}

// ---------- 零星的回响兵 ----------
function summon(w: World, f: BossFight, alive: Player[], spawn: Spawn) {
  if (f.state === 'intro' || f.state === 'phase' || !alive.length) return;
  f.summonT -= DT;
  if (f.summonT > 0) return;
  f.summonT = BOSS.summon.every[f.phase];
  let n = 0;
  for (const e of w.enemies) if (e.kind === 'soldier') n++;
  for (let i = 0; i < Math.min(BOSS.summon.n, BOSS.summon.max - n); i++) {
    const p = alive[Math.floor(w.rng.next() * alive.length)];
    // 和普通波一样刷在屏幕外（spawn.ts）：魔焰焚城把场地压小以后，能站的地方差不多都在镜头里，回响兵就从魔气里走出来。
    // 原来是夹回能站的范围，人物靠边时会凭空出现在屏幕里
    // 联机时倒在地上等人扶的人的镜头也要躲开（cameras：和普通刷怪同一个判定，coop.ts）
    const q = spawnSpot(w, p, cameras(w, alive), ENEMIES.soldier.radius, BOSS.summon.out[0], BOSS.summon.out[1]);
    spawn('soldier', q.x, q.y);
  }
}

// ---------- 对外 ----------
/**
 * 首领波开始：在离玩家 150–200 像素、场地里面的地方现身（人物不回原位，首领不能贴脸出现）。
 * guest：来遭遇战（本章第 4 波出精英的那一刻）——气血少（bosspool.guestHp）、现身短一些，状态放进 w.echo。
 */
export function startBoss(w: World, ev: SimEvent[], spawn: Spawn, guest = false) {
  const chapter = chapterOf(w.wave);
  const ps = w.players.filter((p) => p.alive);
  const p = ps[0] ?? w.players[0];
  const cx = ARENA.w / 2 - p.x;
  const cy = ARENA.h / 2 - p.y;
  const R = innerRect(w, 40);
  let best = { x: ARENA.w / 2, y: ARENA.h / 2 };
  let bs = -Infinity;
  const d = range(w.rng, BOSS.entry[0], BOSS.entry[1]);
  // 候选方向以水平为主（上下太远会出画），朝场心的方向优先
  for (const a of [0, 0.3, -0.3, 0.6, -0.6, Math.PI, Math.PI - 0.3, Math.PI + 0.3, Math.PI - 0.6, Math.PI + 0.6]) {
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const inside = x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1;
    const s = (inside ? 1000 : 0) + Math.cos(a) * cx + Math.sin(a) * cy - Math.abs(Math.sin(a)) * 40 + w.rng.next();
    if (s > bs) {
      bs = s;
      best = clampPt(x, y, R);
    }
  }
  const b = spawn('boss', best.x, best.y);
  b.hp = b.maxHp = guest ? guestHp(w, 'nezha') : BOSS.hp[chapter];
  b.dmgMul = BOSS.dmg[chapter];
  b.speed = 0;
  const intro = guest ? POOL.guestIntro : BOSS.intro;
  b.invuln = intro;
  if (guest) b.hpFloor = Math.ceil(b.maxHp * POOL.guestPhaseAt); // 换二阶段之前打不死（core.hitEnemy）
  putFight(w, {
    kind: 'nezha',
    id: b.id,
    guest,
    chapter,
    phase: 1,
    state: 'intro',
    t: 0,
    lt: -1,
    dur: intro,
    move: null,
    last: null,
    queue: [],
    facing: p.x >= b.x ? 1 : -1,
    moving: false,
    mul: BOSS.dmg[chapter] * (guest ? POOL.guestDmg : 1), // 遭遇战在第 4 波：人物的气血比打首领时少，招式轻一些
    hazards: [],
    clones: [],
    slide: null,
    inferno: { on: false, step: 0, next: 0, warned: false, t: -1, fx: 0, fy: 0, tx: 0, ty: 0 },
    summonT: BOSS.summon.first,
    deadAt: null,
    retreat: null,
  });
  if (guest) ev.push({ t: 'echoIntro', id: b.id, kind: 'nezha', x: b.x, y: b.y });
  else ev.push({ t: 'bossIntro', id: b.id, kind: 'nezha', x: b.x, y: b.y, chapter });
}

/** 每帧推进首领：状态机、危险物、残影、接触伤害、魔焰焚城、零星刷兵。由 world.ts 在玩家之后、敌人之前调用。 */
export function updateBoss(w: World, alive: Player[], ev: SimEvent[], spawn: Spawn) {
  const f = nezhaOf(w);
  if (!f) return;
  f.lt = f.t;
  f.t += DT;
  if (f.state === 'dead') {
    // 倒下的表现：压进来的魔气慢慢退回去
    if (f.retreat) {
      const k = smooth(Math.min(1, f.t / (f.dur * 0.8)));
      w.miasmaInset.x = f.retreat.x * (1 - k);
      w.miasmaInset.y = f.retreat.y * (1 - k);
    }
    return;
  }
  const b = bossEnemy(w);
  if (!b) return;
  for (const c of f.clones) {
    c.px = c.x;
    c.py = c.y;
  }
  for (const h of f.hazards) {
    h.px = h.x;
    h.py = h.y;
    h.pa = h.a;
  }
  f.moving = false;
  const p = nearest(b, alive);
  for (let guard = 0; guard < 3; guard++) {
    const s: BossState = f.state;
    runState(w, f, b, p, ev);
    if (f.state === s) break;
  }
  updateHazards(w, f, b, alive, ev);
  contactDamage(w, f, b, alive, ev);
  updateInferno(w, f, ev);
  if (!f.guest) summon(w, f, alive, spawn); // 遭遇战那一波照常刷怪，不另刷
  const r = innerRect(w, 14);
  b.x = clamp(b.x, r.x0, r.x1);
  b.y = clamp(b.y, r.y0, r.y1);
}

function enterPhase(w: World, f: BossFight, b: Enemy, n: number, ev: SimEvent[]) {
  f.phase = n;
  // 换阶段：还没出手的预警和残影取消，本体停下；已经飞出去的圈、正在滚的火轮照常飞完
  f.hazards = f.hazards.filter((h) => (h.kind === 'ring' || h.kind === 'wheel') && h.t >= h.warn);
  f.clones = [];
  f.move = null;
  f.slide = null;
  const T = f.guest ? POOL.guestPhaseTime : BOSS.phaseTime;
  enter(f, 'phase', T);
  b.invuln = Math.max(b.invuln, T);
  if (f.guest) ev.push({ t: 'echoPhase', id: b.id, kind: 'nezha', phase: n, x: b.x, y: b.y });
  else ev.push({ t: 'bossPhase', id: b.id, phase: n, x: b.x, y: b.y });
  if (n === 3) {
    // 魔焰焚城：换阶段这一下就施放，第一步紧跟着推进来
    const I = f.inferno;
    I.on = true;
    I.next = BOSS.inferno.first;
    I.warned = true;
    I.t = -1;
  }
}

function die(w: World, f: BossFight, b: Enemy, ev: SimEvent[]) {
  // 倒下的表现期间这一仗已经打赢：危险物、回响兵、鬼火都清掉；压进来的魔气慢慢退、只减速不掉血，
  // 也不再判负（world.step：和首领同一帧倒下也算打赢）
  f.hazards = [];
  f.clones = [];
  f.move = null;
  f.inferno.on = false;
  f.deadAt = { x: b.x, y: b.y };
  if (f.guest) {
    // 遭遇战：这一波照常打完，场上的敌人、鬼火都不动；掉一只精英宝匣（bosspool.guestDown）
    guestDown(w, 'nezha', b, f.facing, ev);
    enter(f, 'dead', POOL.guestDeath);
    return;
  }
  ev.push({ t: 'bossDeath', id: b.id, kind: 'nezha', x: b.x, y: b.y, facing: f.facing, chapter: f.chapter });
  f.retreat = { x: w.miasmaInset.x, y: w.miasmaInset.y };
  enter(f, 'dead', BOSS.deathTime);
  // 首领倒下，回响兵和鬼火一起散掉（不算击杀）
  w.enemies = w.enemies.filter((e) => e === b);
  w.orbs = [];
  b.hp = 0;
}

/**
 * 每帧伤害都结算完之后（world.ts 清理死敌人之前）调用：
 * 气血跨过阈值就卡在阈值上换阶段（一次大伤害也不能跳阶段）；三阶段打空才真的倒下。
 */
export function bossCheck(w: World, ev: SimEvent[]) {
  const f = nezhaOf(w);
  if (!f || f.state === 'dead') return;
  const b = bossEnemy(w);
  if (!b) return;
  if (f.guest) {
    // 遭遇战只有两个阶段：一阶段打到底线（hpFloor 卡住）换二阶段，二阶段打空就倒下
    if (f.phase < 2) {
      if (b.hpFloor !== undefined && b.hp <= b.hpFloor + 1e-9) {
        delete b.hpFloor;
        enterPhase(w, f, b, 2, ev);
      }
    } else if (b.hp <= 0) die(w, f, b, ev);
    return;
  }
  if (f.phase < 3) {
    const floor = Math.ceil(b.maxHp * BOSS.phases[f.phase - 1]);
    if (b.hp <= floor) {
      b.hp = floor;
      enterPhase(w, f, b, f.phase + 1, ev);
    }
  } else if (b.hp <= 0) die(w, f, b, ev);
}

/**
 * 某一点有多危险（机器人躲招用）：落在首领还没结束的危险物（预警中或正在伤人）的范围里就算危险，
 * 每个危险物算 1 再加「陷得多深」（离最近的安全边缘还有多远），所以就算一时躲不出去，也知道往哪边躲最近。
 * react 是反应时间：出现不到这么久的预警当作还没看见；jitter 让每个预警被「看见」的早晚不一样
 * （按危险物的编号定，确定性），模拟人有时候走神、看漏。margin 是想离危险边缘多远。
 */
export function bossDanger(w: World, x: number, y: number, react = 0, margin = 6, jitter = 0): number {
  const f = nezhaOf(w);
  if (!f || f.state === 'dead') return 0;
  let s = 0;
  const add = (depth: number) => {
    if (depth > 0) s += 1 + Math.min(2, depth / 25);
  };
  for (const h of f.hazards) {
    if (h.t < react + jitter * hashUnit(h.id)) continue;
    const tl = h.t - h.warn;
    if (tl >= h.live) continue;
    switch (h.kind) {
      case 'ring':
        add(h.r + PLAYER.radius + margin - segDist(x, y - 8, h.x0, h.y0, h.x1, h.y1));
        break;
      case 'dash':
      case 'wheel': {
        const sx = tl > 0 ? h.x : h.x0;
        const sy = tl > 0 ? h.y : h.y0;
        add(h.r + (h.kind === 'wheel' ? PLAYER.radius : 1) + margin - segDist(x, y, sx, sy, h.x1, h.y1));
        break;
      }
      case 'sweep': {
        const d = Math.hypot(x - h.x0, y - h.y0);
        const out = h.r + PLAYER.radius + margin - d; // 往外跑出半径还要多远
        if (out <= 0) break;
        const rel = h.dir * wrapAngle(Math.atan2(y - h.y0, x - h.x0) - h.a0);
        const done = tl > 0 ? sweepProgress(h) : 0;
        const m = PLAYER.radius + margin;
        // 越过红绫现在所在的那条边（预警时就是起始边）、或者越过另一头的边，各要多远
        const back = rel - done < Math.PI / 2 ? d * Math.sin(Math.max(0, rel - done)) + m : Infinity;
        const fwd = Math.PI - rel < Math.PI / 2 ? d * Math.sin(Math.max(0, Math.PI - rel)) + m : Infinity;
        if (rel > done - m / Math.max(d, 8) && rel < Math.PI + m / Math.max(d, 8)) add(Math.min(out, back, fwd));
        break;
      }
    }
  }
  const b = bossEnemy(w);
  if (b && f.state !== 'intro') {
    const d = Math.hypot(x - b.x, y - b.y);
    if (d < 30) s += 0.4 + 0.6 * (1 - d / 30);
  }
  return s;
}

/** 表现层用的姿势：由状态、招式和危险物推出来。 */
export type BossPose = 'idle' | 'walk' | 'raise' | 'throw' | 'bare' | 'charge' | 'dash' | 'recover' | 'cast' | 'sweepUp' | 'sweep' | 'roar';
export function bossPose(f: BossFight): BossPose {
  switch (f.state) {
    case 'intro':
      return 'cast';
    case 'phase':
      return 'roar';
    case 'dead':
      return 'roar';
    case 'idle':
      return f.moving ? 'walk' : 'idle';
    case 'recover':
      return f.move === 'dash' || f.move === 'clones' ? 'recover' : 'idle';
    case 'cast': {
      const h = f.hazards.find((x) => x.src === 0 && x.move === f.move);
      switch (f.move) {
        case 'ring':
          if (h && h.t < h.warn) return 'raise';
          if (h && h.t < h.warn + 0.15) return 'throw';
          return 'bare';
        case 'dash':
          return !h || h.t < h.warn ? 'charge' : 'dash';
        case 'clones':
          // 先抬手分出残影、和残影一起滑开，再端枪等着轮到自己
          if (!h) return f.t < BOSS.clones.slide ? 'cast' : 'charge';
          return h.t < h.warn ? 'charge' : 'dash';
        case 'sweep':
          return !h || h.t < h.warn ? 'sweepUp' : 'sweep';
        case 'wheels':
          return f.t < BOSS.wheels.warn ? 'cast' : 'throw';
      }
      return 'idle';
    }
  }
}

/** 首领状态的摘要（测试比确定性用）。 */
export function bossDigest(w: World): string {
  const f = nezhaOf(w);
  const r = (v: number) => Math.round(v * 100);
  if (!f) return `noboss,${r(w.miasmaInset.x)},${r(w.miasmaInset.y)}`;
  const parts: (string | number)[] = [f.phase, f.state, r(f.t), f.move ?? '-', f.last ?? '-', f.facing, r(w.miasmaInset.x), r(w.miasmaInset.y), f.inferno.step];
  for (const h of f.hazards) parts.push(h.id, h.kind, h.src, r(h.t), r(h.x), r(h.y), r(h.a), h.hits);
  for (const c of f.clones) parts.push(c.src, r(c.x), r(c.y));
  return parts.join(',');
}

/**
 * 机器人的站位偏好：离首领不远不近（约 95 像素）——法宝够得着，横扫和接触又不至于躲不开。
 * 原来写在 bot.ts 里，挪进首领模块，第二章的首领有自己的偏好。
 */
function bossPrefer(w: World, x: number, y: number): number {
  const b = bossEnemy(w);
  if (!b) return 0;
  const d = Math.hypot(x - b.x, y - b.y);
  return ((d - 95) / 90) ** 2 * 0.8;
}

/** 魔化哪吒的首领模块（chapters.ts 登记；接口见 chapters.BossModule）。 */
export const NEZHA_BOSS: BossModule = {
  kind: 'nezha',
  start: startBoss,
  update: updateBoss,
  check: bossCheck,
  defeated: bossDefeated,
  danger: bossDanger,
  prefer: bossPrefer,
};
