// 第三章首领「诛仙剑灵」（第 18 波，首发版的最终首领；设计见 docs/story/ch2-ch3.md，数值见 config.ts 的 ZHUXIAN）。
// 诛仙四剑合一的剑灵：人形、半透明的剑光身躯，身后悬着四把剑。三阶段（气血 100% → 60% → 30% → 0），每一招都先预警、再结算：
//   一：四剑环斩——他站定，四把剑绕着他一把接一把向外斩出四道扇形（往外退出半径就躲开）。
//       剑雨——人物身边一格格亮出剑落的位置（棋盘格），分两拨落下：先躲到没亮的格子里，落完再回来。
//   二：一剑化四——分成四个剑影守在人物四角，轮流放剑气直线，交叉着斩过来；只有本体打得到（本体身上有标记）。
//       四剑归阵——四角的剑台同时亮起，对角的剑台之间各连一道剑气墙，把场地分成四块，墙绕场心慢慢转（跟着转、别碰墙）；他站着施法。
//   三：诛仙——剑阵从四面往中间收拢（一圈剑气，每隔一阵往里收一步），圈外持续掉血，能站的地方越来越小。
//       连续突进——追着人物接连冲三次，每次先亮出直线。
// 纯函数、确定性：随机数只用 w.rng。本体是 w.enemies 里 kind 'boss' 的敌人（法宝照常打它），移动由这里控制；
// 剑影不进 w.enemies（打不到）；每一招的预警与判定放在 ZhuxianFight.hazards 里，表现层只读它来画。
// 换阶段无敌、不吃控制（core.hitEnemy 对 kind 'boss' 一律不上晕眩 / 冻结）、伤害写在配置里不乘波次倍率。
// 对外是首领模块 ZHUXIAN_BOSS（chapters.ts 登记到第三章；接口见 chapters.BossModule）。
import { ARENA, DT, PLAYER } from '../config.ts';
import { chapterOf } from '../catalog.ts';
import { hurtPlayer, segDist } from '../core.ts';
import { range } from '../rng.ts';
import { spawnSpot } from '../spawn.ts';
import { cameras, downPlayer, hurtMul } from '../coop.ts';
import { techSave } from '../techniques.ts';
import { bossEnemy, innerRect } from '../boss.ts';
import { POOL, fightOf, guestDown, guestHp, putFight } from '../bosspool.ts';
import type { BossModule, Spawn } from '../chapters.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { SWORDS, ZHUXIAN } from './config.ts';
import { rayToOuter, wrapAngle } from './terrain.ts';
import type { ZhuxianFight, ZhuxianMove, ZhuxianState, ZxHazard } from './types.ts';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (k: number) => k * k * (3 - 2 * k);
/** 剑阵是以场心为中心、和场地同样长宽比的椭圆：竖半径 = 横半径 × RATIO。 */
export const CLOSE_RATIO = ARENA.h / ARENA.w;
const CX = ARENA.w / 2;
const CY = ARENA.h / 2;
/** 整数 → [0, 1) 的固定散列（机器人的「走神」用，不动 w.rng）。 */
const hashUnit = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** 这一仗（首领战在 w.boss、遭遇战在 w.echo）是诛仙剑灵的话返回它。 */
export function zhuxianOf(w: World): ZhuxianFight | null {
  const f = fightOf(w);
  return f && f.kind === 'zhuxian' ? f : null;
}

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

// ---------- 剑阵（诛仙）的几何 ----------

/** 剑阵第 step 步收到的横半径。 */
export const closeR = (step: number) => ZHUXIAN.close.r0 + ((ZHUXIAN.close.r1 - ZHUXIAN.close.r0) * step) / ZHUXIAN.close.steps;
/** 椭圆（横半径 rx、竖半径 rx × RATIO）在 (x, y) 那个方向上的边离场心多远，以及 (x, y) 离场心多远。 */
function radial(x: number, y: number, rx: number) {
  const dx = x - CX;
  const dy = y - CY;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { d, edge: rx * CLOSE_RATIO };
  const c = dx / d;
  const s = dy / d;
  const ry = rx * CLOSE_RATIO;
  const edge = 1 / Math.sqrt((c / rx) ** 2 + (s / ry) ** 2);
  return { d, edge };
}
/** (x, y) 在剑阵外面多远（沿着离场心的方向量；≤ 0 是在圈里）。 */
export function outsideRing(x: number, y: number, rx: number): number {
  const { d, edge } = radial(x, y, rx);
  return d - edge;
}
/** 把 (x, y) 拉回剑阵里（离边 pad 像素以内）。 */
function intoRing(x: number, y: number, rx: number, pad: number): { x: number; y: number } {
  const { d, edge } = radial(x, y, rx);
  const lim = Math.max(10, edge - pad);
  if (d <= lim) return { x, y };
  return { x: CX + ((x - CX) / d) * lim, y: CY + ((y - CY) / d) * lim };
}

// ---------- 状态机 ----------
function enter(f: ZhuxianFight, s: ZhuxianState, dur = 0) {
  f.state = s;
  f.t = 0;
  f.lt = -1;
  f.dur = dur;
}
/** 招式脚本里的「到了第 T 秒」：每个时间点只触发一次。 */
const at = (f: ZhuxianFight, T: number) => f.lt < T && f.t >= T;
function face(f: ZhuxianFight, from: { x: number }, toX: number) {
  if (Math.abs(toX - from.x) > 2) f.facing = toX >= from.x ? 1 : -1;
}

function addHazard(w: World, f: ZhuxianFight, h: Partial<ZxHazard> & Pick<ZxHazard, 'kind' | 'warn' | 'live' | 'x0' | 'y0' | 'r' | 'dmg'>, ev: SimEvent[]): ZxHazard {
  const hz: ZxHazard = { src: 0, x1: h.x0, y1: h.y0, rad: 0, a0: 0, arc: 0, dir: 1, head: 0, prev: 0, ...h, id: w.nextId++, t: 0, hit: w.players.map(() => -1) };
  f.hazards.push(hz);
  ev.push({ t: 'zxCast', id: f.id, hazard: hz.id, kind: hz.kind, src: hz.src, x: hz.x0, y: hz.y0 });
  return hz;
}

/** 一道剑气直线：从 (x, y) 穿过 (tx, ty) 再往前，长度在 [lo, hi] 之间，碰到场地外沿就截短。 */
function laneTo(x: number, y: number, tx: number, ty: number, over: number, lo: number, hi: number) {
  const d = Math.hypot(tx - x, ty - y) || 1;
  const ux = (tx - x) / d;
  const uy = (ty - y) / d;
  const len = Math.min(rayToOuter(x, y, ux, uy), clamp(d + over, lo, hi));
  return { x1: x + ux * len, y1: y + uy * len, len: Math.max(8, len) };
}

type MoveScript = (w: World, f: ZhuxianFight, b: Enemy, p: Player, ev: SimEvent[]) => boolean;

const MOVES: Record<ZhuxianMove, MoveScript> = {
  // 四剑环斩：他站定；四把剑绕着他一把接一把向外斩出四道扇形（首尾相接绕一圈），第一斩就是人物所在的那一块
  ring(w, f, b, p, ev) {
    const R = ZHUXIAN.ring;
    if (at(f, 0)) {
      face(f, b, p.x);
      f.cue = Math.atan2(p.y - b.y, p.x - b.x) + range(w.rng, -0.3, 0.3); // 第一斩的中线
      f.spin = w.rng.next() < 0.5 ? 1 : -1;
    }
    for (let k = 0; k < R.n; k++) {
      if (!at(f, k * R.gap)) continue;
      const dir = f.spin;
      const c = f.cue + dir * k * (TAU / R.n);
      addHazard(w, f, { kind: 'arc', src: k, warn: R.warn, live: R.sweep, x0: b.x, y0: b.y, r: 0, rad: R.rad, a0: wrapAngle(c - dir * (R.arc / 2)), arc: R.arc, dir, dmg: R.dmg }, ev);
    }
    return f.t >= (R.n - 1) * R.gap + R.warn + R.sweep + 0.1;
  },
  // 剑雨：人物身边一片格子，棋盘格分两拨：人物脚下那一拨先落，另一拨晚 gap 秒
  rain(w, f, b, p, ev) {
    const R = ZHUXIAN.rain;
    if (at(f, 0)) {
      face(f, b, p.x);
      // 格子的中心：人物脚下那一格的中心就是人物当时的位置（第二拨照这个摆）
      f.mark = { x: p.x, y: p.y };
      rainWave(w, f, p.x, p.y, 0, ev);
    }
    if (at(f, R.gap) && f.mark) rainWave(w, f, f.mark.x, f.mark.y, 1, ev);
    const done = f.t >= R.gap + R.warn + R.live + 0.1;
    if (done) f.mark = null;
    return done;
  },
  // 一剑化四：本体和三个剑影滑到人物四角，然后轮流（隔 gap 秒）朝人物放剑气直线；放完剑影散去，本体留在那一角
  split(w, f, b, p, ev) {
    const S = ZHUXIAN.split;
    if (at(f, 0)) {
      const R = innerRect(w, 20);
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sy]) => ({ x: clamp(p.x + sx * S.dx, R.x0, R.x1), y: clamp(p.y + sy * S.dy, R.y0, R.y1) }));
      // 本体去离自己最近的那一角，剑影去另外三角
      let mine = 0;
      for (let k = 1; k < 4; k++) if (Math.hypot(corners[k].x - b.x, corners[k].y - b.y) < Math.hypot(corners[mine].x - b.x, corners[mine].y - b.y)) mine = k;
      f.slide = { sx: b.x, sy: b.y, tx: corners[mine].x, ty: corners[mine].y };
      let src = 1;
      f.shadows = [];
      for (let k = 0; k < 4; k++) {
        if (k === mine) continue;
        const q = corners[k];
        f.shadows.push({ src: src++, x: b.x, y: b.y, px: b.x, py: b.y, sx: b.x, sy: b.y, tx: q.x, ty: q.y, facing: (p.x >= q.x ? 1 : -1) as 1 | -1 });
      }
      // 放剑气的先后：随机，本体不先放（看得清哪个是本体之前先别打他）
      const o = [1, 2, 3];
      for (let k = o.length - 1; k > 0; k--) {
        const j = Math.floor(w.rng.next() * (k + 1));
        [o[k], o[j]] = [o[j], o[k]];
      }
      o.splice(1 + Math.floor(w.rng.next() * 3), 0, 0);
      f.fire = o;
      ev.push({ t: 'zxSplit', id: f.id, x: b.x, y: b.y });
    }
    if (f.slide && f.t <= S.slide) {
      const k = 1 - (1 - Math.min(1, f.t / S.slide)) ** 3;
      for (const c of f.shadows) {
        c.x = c.sx + (c.tx - c.sx) * k;
        c.y = c.sy + (c.ty - c.sy) * k;
        c.facing = p.x >= c.x ? 1 : -1;
      }
      b.x = f.slide.sx + (f.slide.tx - f.slide.sx) * k;
      b.y = f.slide.sy + (f.slide.ty - f.slide.sy) * k;
      f.moving = true;
    }
    face(f, b, p.x);
    for (let k = 0; k < f.fire.length; k++) {
      if (!at(f, S.slide + k * S.gap)) continue;
      const src = f.fire[k];
      const who = src === 0 ? b : f.shadows.find((c) => c.src === src);
      if (!who) continue;
      const l = laneTo(who.x, who.y, p.x, p.y, 60, S.len, S.len);
      addHazard(w, f, { kind: 'lane', src, warn: S.warn, live: l.len / S.speed, x0: who.x, y0: who.y, x1: l.x1, y1: l.y1, r: S.hw, dmg: src === 0 ? S.dmg : S.shadowDmg }, ev);
    }
    const done = f.t > S.slide + 3 * S.gap + 0.05 && !f.hazards.some((h) => h.kind === 'lane');
    if (done) {
      f.shadows = [];
      f.slide = null;
      ev.push({ t: 'zxMerge', id: f.id, x: b.x, y: b.y });
    }
    return done;
  },
  // 四剑归阵：四角的剑台亮起，两道剑气墙连起对角的剑台（过场心），预警之后绕场心慢慢转；他站着施法，墙转完才收招
  walls(w, f, b, p, ev) {
    const W = ZHUXIAN.walls;
    if (at(f, 0)) {
      face(f, b, p.x);
      ev.push({ t: 'zxAltars', id: f.id, t2: W.warn });
      const dir = (w.rng.next() < 0.5 ? 1 : -1) as 1 | -1;
      for (const [i, j] of [
        [0, 2],
        [1, 3],
      ]) {
        const [ax, ay] = SWORDS.altars[i];
        const [bx, by] = SWORDS.altars[j];
        addHazard(w, f, { kind: 'wall', src: i, warn: W.warn, live: W.live, x0: (ax + bx) / 2, y0: (ay + by) / 2, r: W.hw, a0: Math.atan2(by - ay, bx - ax), dir, dmg: W.dmg }, ev);
      }
    }
    return f.t >= W.warn + W.live || (f.t > W.warn && !f.hazards.some((h) => h.kind === 'wall'));
  },
  // 连续突进：接连冲 n 次；每次先亮出直线（穿过人物当时的位置再往前），冲完喘一下再瞄下一次
  rush(w, f, b, p, ev) {
    const R = ZHUXIAN.rush;
    if (at(f, 0)) {
      f.rush = 0;
      f.cue = 0;
    }
    const active = f.hazards.some((h) => h.kind === 'dash');
    if (active) return false;
    if (f.rush >= R.n) return true;
    f.cue -= DT;
    if (f.cue > 0) return false;
    face(f, b, p.x);
    const l = laneTo(b.x, b.y, p.x, p.y, R.over, R.len[0], R.len[1]);
    // 截在剑阵里（三阶段剑阵在收）：冲到剑阵边上就停
    const K = f.close;
    let x1 = l.x1;
    let y1 = l.y1;
    if (K.on) {
      const q = intoRing(x1, y1, K.rx, 16);
      x1 = q.x;
      y1 = q.y;
    }
    const len = Math.max(8, Math.hypot(x1 - b.x, y1 - b.y));
    addHazard(w, f, { kind: 'dash', warn: R.warn, live: len / R.speed, x0: b.x, y0: b.y, x1, y1, r: R.hw, dmg: R.dmg }, ev);
    f.rush++;
    f.cue = R.gap;
    return false;
  },
};

/** 剑雨的一拨：以 (cx, cy) 为中心、cols × rows 格里棋盘格的一半（parity 0：中心那一格那一拨）。格子出了场地外沿就不落。 */
function rainWave(w: World, f: ZhuxianFight, cx: number, cy: number, parity: number, ev: SimEvent[]) {
  const R = ZHUXIAN.rain;
  const hc = Math.floor(R.cols / 2);
  const hr = Math.floor(R.rows / 2);
  const outer = innerRect(w, -40);
  for (let j = -hr; j <= hr; j++)
    for (let i = -hc; i <= hc; i++) {
      if ((((i + j) % 2) + 2) % 2 !== parity) continue;
      const x = cx + i * R.cell;
      const y = cy + j * R.cell;
      if (x < outer.x0 || x > outer.x1 || y < outer.y0 || y > outer.y1) continue;
      addHazard(w, f, { kind: 'cell', src: parity, warn: R.warn, live: R.live, x0: x, y0: y, r: R.cell / 2, dmg: R.dmg }, ev);
    }
}

const RECOVER: Record<ZhuxianMove, number> = {
  ring: ZHUXIAN.ring.recover,
  rain: ZHUXIAN.rain.recover,
  split: ZHUXIAN.split.recover,
  walls: ZHUXIAN.walls.recover,
  rush: ZHUXIAN.rush.recover,
};

function pickMove(w: World, f: ZhuxianFight): ZhuxianMove {
  if (f.queue.length) return f.queue.shift()!;
  // 不连出同一招；三阶段的突进是主招，可以连两次（上一次不是已经连着的第二次）
  const pool = Object.entries(ZHUXIAN.pool[f.phase]).filter(([m]) => m !== f.last || (m === 'rush' && !f.again)) as [ZhuxianMove, number][];
  let r = w.rng.next() * pool.reduce((s, [, v]) => s + v, 0);
  for (const [m, v] of pool) {
    r -= v;
    if (r < 0) return m;
  }
  return pool[pool.length - 1][0];
}

function toIdle(w: World, f: ZhuxianFight) {
  enter(f, 'idle', ZHUXIAN.idle[f.phase] + range(w.rng, -0.15, 0.15));
  f.move = null;
}

/** 空闲：慢慢走到人物左边或右边 keep 像素、上下差得不多的地方（三阶段剑阵在收时不出圈）。 */
function walk(f: ZhuxianFight, b: Enemy, p: Player) {
  const side = b.x >= p.x ? 1 : -1;
  face(f, b, p.x);
  let tx = p.x + side * ZHUXIAN.keep;
  let ty = p.y + clamp(b.y - p.y, -ZHUXIAN.keepY, ZHUXIAN.keepY);
  if (f.close.on) {
    const q = intoRing(tx, ty, f.close.rx, 30);
    tx = q.x;
    ty = q.y;
  }
  const mx = tx - b.x;
  const my = ty - b.y;
  const m = Math.hypot(mx, my);
  if (m < 3) return;
  const sp = ZHUXIAN.walk[f.phase] * (1 - 0.5 * b.slow) * DT;
  b.x += (mx / m) * Math.min(m, sp);
  b.y += (my / m) * Math.min(m, sp);
  f.moving = true;
}

function runState(w: World, f: ZhuxianFight, b: Enemy, p: Player | null, ev: SimEvent[]) {
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
        f.again = m === f.last;
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

/** 四剑环斩的一斩这一帧扫过的那一片里有没有 (x, y)。 */
function inArc(h: ZxHazard, x: number, y: number, rr: number): boolean {
  const d = Math.hypot(x - h.x0, y - h.y0);
  if (d > h.rad + rr) return false;
  const rel = h.dir * wrapAngle(Math.atan2(y - h.y0, x - h.x0) - h.a0);
  const m = Math.max(0, rr - 1) / Math.max(d, 8);
  return rel >= h.prev - m && rel <= h.head + m;
}

/** 剑气墙：(x, y) 离墙（过转轴、朝 a0 的整条直线）多远；along 是沿墙离转轴多远、side 是在墙的哪一侧（带符号）。 */
export function wallOffset(h: ZxHazard, x: number, y: number) {
  const ux = Math.cos(h.a0);
  const uy = Math.sin(h.a0);
  const rx = x - h.x0;
  const ry = y - h.y0;
  return { along: rx * ux + ry * uy, side: -rx * uy + ry * ux };
}

function updateHazards(w: World, f: ZhuxianFight, b: Enemy, alive: Player[], ev: SimEvent[]) {
  const W = ZHUXIAN.walls;
  for (let i = f.hazards.length - 1; i >= 0; i--) {
    const h = f.hazards[i];
    const was = h.t;
    h.t += DT;
    if (h.t < h.warn) continue;
    if (was < h.warn) ev.push({ t: 'zxStrike', id: f.id, hazard: h.id, kind: h.kind, src: h.src, x: h.x0, y: h.y0 });
    const tl = h.t - h.warn;
    h.prev = h.head;
    const hitOnce = (test: (p: Player) => boolean) => {
      for (const p of alive) {
        if (!p.alive || h.hit[p.id] >= 0 || !test(p)) continue;
        h.hit[p.id] = w.time;
        hurtPlayer(w, p, h.dmg, 'boss', ev);
      }
    };
    switch (h.kind) {
      case 'arc':
        h.head = h.arc * smooth(Math.min(1, tl / h.live));
        hitOnce((p) => inArc(h, p.x, p.y, PLAYER.radius));
        break;
      case 'cell':
        hitOnce((p) => Math.abs(p.x - h.x0) <= h.r && Math.abs(p.y - h.y0) <= h.r);
        break;
      case 'lane':
      case 'dash': {
        const L = Math.hypot(h.x1 - h.x0, h.y1 - h.y0) || 1;
        const ux = (h.x1 - h.x0) / L;
        const uy = (h.y1 - h.y0) / L;
        const speed = h.kind === 'dash' ? ZHUXIAN.rush.speed : ZHUXIAN.split.speed;
        h.head = Math.min(L, tl * speed);
        const ax = h.x0 + ux * Math.max(0, h.prev - 2);
        const ay = h.y0 + uy * Math.max(0, h.prev - 2);
        const bx = h.x0 + ux * h.head;
        const by = h.y0 + uy * h.head;
        if (h.kind === 'dash') {
          b.x = bx;
          b.y = by;
          f.facing = ux >= 0 ? 1 : -1;
          f.moving = true;
        }
        hitOnce((p) => segDist(p.x, p.y, ax, ay, bx, by) <= h.r + PLAYER.radius);
        break;
      }
      case 'wall': {
        h.a0 = wrapAngle(h.a0 + h.dir * W.spin * DT);
        for (const p of alive) {
          if (!p.alive || (h.hit[p.id] >= 0 && w.time - h.hit[p.id] < W.rehit)) continue;
          if (Math.abs(wallOffset(h, p.x, p.y).side) > h.r + PLAYER.radius) continue;
          h.hit[p.id] = w.time;
          hurtPlayer(w, p, h.dmg, 'boss', ev);
        }
        break;
      }
    }
    if (tl >= h.live) f.hazards.splice(i, 1);
  }
}

function contactDamage(w: World, f: ZhuxianFight, b: Enemy, alive: Player[], ev: SimEvent[]) {
  if (f.state === 'intro') return;
  if (f.hazards.some((h) => h.kind === 'dash' && h.t >= h.warn)) return; // 突进中由突进线判定
  const r = 8 + PLAYER.radius;
  for (const p of alive) {
    if (!p.alive || p.iframes > 0) continue;
    if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 > r * r) continue;
    hurtPlayer(w, p, ZHUXIAN.contact, 'boss', ev);
  }
}

/** 诛仙：剑阵按时往里收一步（先预警）；站在圈外的人持续掉血（不吃无敌时间，同魔气），攒够 report 秒报一次。 */
function updateClose(w: World, f: ZhuxianFight, alive: Player[], ev: SimEvent[]) {
  const K = f.close;
  const C = ZHUXIAN.close;
  if (!K.on) return;
  if (K.t >= 0) {
    K.t += DT;
    K.rx = K.from + (K.to - K.from) * smooth(Math.min(1, K.t / C.move));
    K.ry = K.rx * CLOSE_RATIO;
    if (K.t >= C.move) {
      K.t = -1;
      K.next = C.every;
      K.warned = false;
    }
  } else if (K.step < C.steps) {
    K.next -= DT;
    if (!K.warned && K.next <= C.warn) {
      K.warned = true;
      const to = closeR(K.step + 1);
      ev.push({ t: 'zxCloseWarn', step: K.step + 1, rx: to, ry: to * CLOSE_RATIO });
    }
    if (K.next <= 0) {
      K.step++;
      K.from = K.rx;
      K.to = closeR(K.step);
      K.t = 0;
      ev.push({ t: 'zxClose', step: K.step, rx: K.to, ry: K.to * CLOSE_RATIO });
    }
  }
  for (const p of alive) {
    if (!p.alive) continue;
    const id = p.id;
    if (outsideRing(p.x, p.y, K.rx) <= 0) {
      if ((K.drain[id] ?? 0) >= 0.5) ev.push({ t: 'zxDrain', owner: id, x: p.x, y: p.y, dmg: K.drain[id] });
      K.drain[id] = 0;
      K.drainT[id] = 0;
      continue;
    }
    const dmg = p.stats.maxHp * C.drain * DT * hurtMul(p); // 联机：掉线托管中减半（coop.ts）
    p.hp -= dmg;
    K.drain[id] = (K.drain[id] ?? 0) + dmg;
    K.drainT[id] = (K.drainT[id] ?? 0) + DT;
    if (K.drainT[id] >= C.report - 1e-9) {
      ev.push({ t: 'zxDrain', owner: id, x: p.x, y: p.y, dmg: K.drain[id] });
      K.drain[id] = 0;
      K.drainT[id] = 0;
    }
    if (p.hp <= 0 && !techSave(w, p, ev)) {
      if (K.drain[id] >= 0.5) ev.push({ t: 'zxDrain', owner: id, x: p.x, y: p.y, dmg: K.drain[id] });
      K.drain[id] = 0;
      K.drainT[id] = 0;
      downPlayer(w, p, ev); // 单人倒下就陨落，联机是倒地等人扶（coop.ts）
    }
  }
}

/** 零星的回响兵：和普通刷怪一样刷在所有人的镜头外（cameras：联机时倒在地上的人的镜头也算）。 */
function summon(w: World, f: ZhuxianFight, alive: Player[], spawn: Spawn) {
  if (f.state === 'intro' || f.state === 'phase' || !alive.length) return;
  const S = ZHUXIAN.summon;
  f.summonT -= DT;
  if (f.summonT > 0) return;
  f.summonT = S.every[f.phase];
  let n = 0;
  for (const e of w.enemies) if (e.kind === 'soldier') n++;
  for (let i = 0; i < Math.min(S.n, S.max - n); i++) {
    const p = alive[Math.floor(w.rng.next() * alive.length)];
    const q = spawnSpot(w, p, cameras(w, alive), 6, S.out[0], S.out[1]);
    spawn('soldier', q.x, q.y);
  }
}

// ---------- 对外 ----------

const newClose = (w: World) => ({ on: false, step: 0, next: 0, warned: false, t: -1, from: ZHUXIAN.close.r0, to: ZHUXIAN.close.r0, rx: ZHUXIAN.close.r0, ry: ZHUXIAN.close.r0 * CLOSE_RATIO, drain: w.players.map(() => 0), drainT: w.players.map(() => 0) });

/**
 * 首领波开始：在离人物 150–200 像素、场地里面的地方现身（朝场心的方向优先，上下别太远）。
 * guest：来遭遇战（首领池，bosspool.ts；本章第 4 波出精英的那一刻）——气血少、现身短一些，状态放进 w.echo；只打一、二两个阶段（剑阵不收）。
 */
function start(w: World, ev: SimEvent[], spawn: Spawn, guest = false) {
  const chapter = chapterOf(w.wave);
  const ps = w.players.filter((p) => p.alive);
  const p = ps[0] ?? w.players[0];
  const R = innerRect(w, 40);
  const cx = (R.x0 + R.x1) / 2 - p.x;
  const cy = (R.y0 + R.y1) / 2 - p.y;
  let best = { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 };
  let bs = -Infinity;
  const d = range(w.rng, ZHUXIAN.entry[0], ZHUXIAN.entry[1]);
  for (const a of [0, 0.3, -0.3, 0.6, -0.6, Math.PI, Math.PI - 0.3, Math.PI + 0.3, Math.PI - 0.6, Math.PI + 0.6]) {
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const inside = x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1;
    const s = (inside ? 1000 : 0) + Math.cos(a) * cx + Math.sin(a) * cy - Math.abs(Math.sin(a)) * 40 + w.rng.next();
    if (s > bs) {
      bs = s;
      best = { x: clamp(x, R.x0, R.x1), y: clamp(y, R.y0, R.y1) };
    }
  }
  const b = spawn('boss', best.x, best.y);
  b.hp = b.maxHp = guest ? guestHp(w, 'zhuxian') : ZHUXIAN.hp;
  b.dmgMul = 1;
  b.speed = 0;
  const intro = guest ? POOL.guestIntro : ZHUXIAN.intro;
  b.invuln = intro;
  if (guest) b.hpFloor = Math.ceil(b.maxHp * POOL.guestPhaseAt); // 换二阶段之前打不死（core.hitEnemy）
  putFight(w, {
    kind: 'zhuxian',
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
    again: false,
    queue: [],
    facing: p.x >= b.x ? 1 : -1,
    moving: false,
    hazards: [],
    shadows: [],
    slide: null,
    fire: [],
    spin: 1,
    mark: null,
    rush: 0,
    cue: 0,
    close: newClose(w),
    summonT: ZHUXIAN.summon.first,
    deadAt: null,
  });
  if (guest) ev.push({ t: 'echoIntro', id: b.id, kind: 'zhuxian', x: b.x, y: b.y });
  else ev.push({ t: 'bossIntro', id: b.id, kind: 'zhuxian', x: b.x, y: b.y, chapter });
}

function update(w: World, alive: Player[], ev: SimEvent[], spawn: Spawn) {
  const f = zhuxianOf(w);
  if (!f) return;
  f.lt = f.t;
  f.t += DT;
  if (f.state === 'dead') return;
  const b = bossEnemy(w);
  if (!b) return;
  for (const c of f.shadows) {
    c.px = c.x;
    c.py = c.y;
  }
  f.moving = false;
  const p = nearest(b, alive);
  for (let guard = 0; guard < 3; guard++) {
    const s: ZhuxianState = f.state;
    runState(w, f, b, p, ev);
    if (f.state === s) break;
  }
  updateHazards(w, f, b, alive, ev);
  updateClose(w, f, alive, ev);
  contactDamage(w, f, b, alive, ev);
  if (!f.guest) summon(w, f, alive, spawn); // 遭遇战那一波照常刷怪，不另刷
  const r = innerRect(w, 14);
  b.x = clamp(b.x, r.x0, r.x1);
  b.y = clamp(b.y, r.y0, r.y1);
  if (f.close.on && !f.hazards.some((h) => h.kind === 'dash' && h.t >= h.warn)) {
    const q = intoRing(b.x, b.y, f.close.rx, 14);
    b.x = q.x;
    b.y = q.y;
  }
}

function enterPhase(w: World, f: ZhuxianFight, b: Enemy, n: number, ev: SimEvent[]) {
  f.phase = n;
  // 换阶段：还没出手的、正在放的都收掉（剑气墙、剑影一起散）
  f.hazards = [];
  if (f.shadows.length) ev.push({ t: 'zxMerge', id: f.id, x: b.x, y: b.y });
  f.shadows = [];
  f.slide = null;
  f.mark = null;
  f.move = null;
  const T = f.guest ? POOL.guestPhaseTime : ZHUXIAN.phaseTime;
  enter(f, 'phase', T);
  b.invuln = Math.max(b.invuln, T);
  if (f.guest) ev.push({ t: 'echoPhase', id: b.id, kind: 'zhuxian', phase: n, x: b.x, y: b.y });
  else ev.push({ t: 'bossPhase', id: b.id, phase: n, x: b.x, y: b.y });
  if (n === 3) {
    // 诛仙：一进三阶段剑阵就开始收，第一步紧跟着来；之后先突进
    const K = f.close;
    K.on = true;
    K.step = 0;
    K.t = -1;
    K.rx = K.from = K.to = ZHUXIAN.close.r0;
    K.ry = K.rx * CLOSE_RATIO;
    K.next = ZHUXIAN.phaseTime + ZHUXIAN.close.first;
    K.warned = false;
    f.queue = ['rush'];
  }
}

function die(w: World, f: ZhuxianFight, b: Enemy, ev: SimEvent[]) {
  // 倒下的表现期间这一仗已经打赢：危险物、剑影、回响兵、弹道都清掉（不算击杀），剑阵不再收、不再伤人（world 看 boss.state）
  f.hazards = [];
  f.shadows = [];
  f.slide = null;
  f.move = null;
  f.close.on = false;
  f.deadAt = { x: b.x, y: b.y };
  if (f.guest) {
    // 遭遇战：这一波照常打完，场上别的敌人、弹道都不动；掉一只精英宝匣（bosspool.guestDown）
    guestDown(w, 'zhuxian', b, f.facing, ev);
    enter(f, 'dead', POOL.guestDeath);
    return;
  }
  ev.push({ t: 'bossDeath', id: b.id, kind: 'zhuxian', x: b.x, y: b.y, facing: f.facing, chapter: f.chapter });
  enter(f, 'dead', ZHUXIAN.deathTime);
  w.enemies = w.enemies.filter((e) => e === b);
  w.orbs = [];
  b.hp = 0;
}

/** 每帧伤害都结算完之后：跨过阈值就卡在阈值上换阶段；三阶段打空才真的倒下。 */
function check(w: World, ev: SimEvent[]) {
  const f = zhuxianOf(w);
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
    const floor = Math.ceil(b.maxHp * ZHUXIAN.phases[f.phase - 1]);
    if (b.hp <= floor) {
      b.hp = floor;
      enterPhase(w, f, b, f.phase + 1, ev);
    }
  } else if (b.hp <= 0) die(w, f, b, ev);
}

function defeated(w: World) {
  const f = zhuxianOf(w);
  return !!f && f.state === 'dead' && f.t >= f.dur - 1e-9;
}

/** 一个危险物对 (x, y) 陷进去多深（0 = 安全；口径同 danger）。lead：剑气墙在转，墙往人这边转过来的那一侧多算一点。 */
export function hazardDepth(h: ZxHazard, x: number, y: number, margin: number): number {
  const tl = h.t - h.warn;
  switch (h.kind) {
    case 'arc': {
      const d = Math.hypot(x - h.x0, y - h.y0);
      const out = h.rad + PLAYER.radius + margin - d;
      if (out <= 0) return 0;
      const rel = h.dir * wrapAngle(Math.atan2(y - h.y0, x - h.x0) - h.a0);
      const done = tl > 0 ? h.head : 0;
      const m = PLAYER.radius + margin;
      const mm = m / Math.max(d, 8);
      if (rel <= done - mm || rel >= h.arc + mm) return 0;
      const back = rel - done < Math.PI / 2 ? d * Math.sin(Math.max(0, rel - done)) + m : Infinity;
      const fwd = h.arc - rel < Math.PI / 2 ? d * Math.sin(Math.max(0, h.arc - rel)) + m : Infinity;
      return Math.min(out, back, fwd);
    }
    case 'cell':
      return h.r + margin - Math.max(Math.abs(x - h.x0), Math.abs(y - h.y0));
    case 'lane':
    case 'dash': {
      const L = Math.hypot(h.x1 - h.x0, h.y1 - h.y0) || 1;
      const from = tl > 0 ? Math.max(0, h.head - 4) : 0;
      const ux = (h.x1 - h.x0) / L;
      const uy = (h.y1 - h.y0) / L;
      return h.r + PLAYER.radius + margin - segDist(x, y, h.x0 + ux * from, h.y0 + uy * from, h.x1, h.y1);
    }
    case 'wall': {
      const o = wallOffset(h, x, y);
      // 墙在转：沿墙离转轴 along 处的墙每秒挪 along × spin 像素，挪向的那一侧（leading）多留 0.6 秒的路
      const lead = tl > 0 && Math.sign(o.side) === Math.sign(o.along) * h.dir ? Math.abs(o.along) * ZHUXIAN.walls.spin * 0.6 : 0;
      return h.r + PLAYER.radius + margin + lead - Math.abs(o.side);
    }
  }
}

/**
 * 机器人躲招：落在还没结束的危险物里算 1 再加陷得多深（口径同魔化哪吒的 bossDanger）；
 * 剑阵外面（三阶段）按出圈多深算，下一步要收进来的那一圈（预警中）也算一点。
 */
function danger(w: World, x: number, y: number, react = 0, margin = 6, jitter = 0): number {
  const f = zhuxianOf(w);
  if (!f || f.state === 'dead') return 0;
  let s = 0;
  for (const h of f.hazards) {
    if (h.t < react + jitter * hashUnit(h.id)) continue;
    if (h.t - h.warn >= h.live) continue;
    const depth = hazardDepth(h, x, y, margin);
    if (depth > 0) s += 1 + Math.min(2, depth / 25);
  }
  const K = f.close;
  if (K.on) {
    const out = outsideRing(x, y, K.rx) + margin + 10;
    if (out > 0) s += 1 + Math.min(3, out / 25);
    const next = K.t >= 0 ? K.to : K.warned ? closeR(K.step + 1) : K.rx;
    if (next < K.rx) {
      const o2 = outsideRing(x, y, next) + margin + 10;
      if (o2 > 0) s += 0.6 + Math.min(1.5, o2 / 30);
    }
  }
  const b = bossEnemy(w);
  if (b && f.state !== 'intro') {
    const d = Math.hypot(x - b.x, y - b.y);
    if (d < 30) s += 0.4 + 0.6 * (1 - d / 30);
  }
  return s;
}

/** 机器人的站位偏好：离本体不远不近（约 100 像素）；三阶段剑阵在收时往场心靠一点。 */
function prefer(w: World, x: number, y: number): number {
  const f = zhuxianOf(w);
  const b = bossEnemy(w);
  if (!f || !b) return 0;
  const d = Math.hypot(x - b.x, y - b.y);
  let s = ((d - 100) / 90) ** 2 * 0.8;
  if (f.close.on) s += Math.max(0, outsideRing(x, y, f.close.rx) + 60) * 0.01;
  return s;
}

/** 诛仙剑灵的首领模块（chapters.ts 登记到第三章）。 */
export const ZHUXIAN_BOSS: BossModule = { kind: 'zhuxian', start, update, check, defeated, danger, prefer };

/** 表现层用的姿势。 */
export type ZhuxianPose = 'idle' | 'walk' | 'raise' | 'slash' | 'point' | 'dash' | 'roar';
export function zhuxianPose(f: ZhuxianFight): ZhuxianPose {
  switch (f.state) {
    case 'intro':
      return 'raise';
    case 'phase':
    case 'dead':
      return 'roar';
    case 'idle':
      return f.moving ? 'walk' : 'idle';
    case 'recover':
      return 'idle';
    case 'cast':
      switch (f.move) {
        case 'ring':
          return 'slash';
        case 'rain':
        case 'walls':
          return 'raise';
        case 'split':
          return f.moving ? 'walk' : 'point';
        case 'rush':
          return f.hazards.some((h) => h.kind === 'dash' && h.t >= h.warn) ? 'dash' : 'point';
        default:
          return 'idle';
      }
  }
}

/** 状态摘要（测试比确定性用）。 */
export function zhuxianDigest(w: World): string {
  const f = zhuxianOf(w);
  const r = (v: number) => Math.round(v * 100);
  if (!f) return 'nozhuxian';
  const K = f.close;
  const parts: (string | number)[] = [f.phase, f.state, r(f.t), f.move ?? '-', f.last ?? '-', f.facing, f.rush, r(f.cue), f.fire.join(''), K.on ? 1 : 0, K.step, r(K.rx)];
  for (const h of f.hazards) parts.push(h.id, h.kind, h.src, r(h.t), r(h.x0), r(h.y0), r(h.a0), r(h.head), h.hit.join('|'));
  for (const c of f.shadows) parts.push(c.src, r(c.x), r(c.y));
  return parts.join(',');
}
