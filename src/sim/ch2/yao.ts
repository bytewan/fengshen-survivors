// 第二章首领「落魂阵主 · 姚天君」（第 12 波；设计见 docs/story/ch2-ch3.md，数值见 config.ts 的 YAO）。
// 十天君之一，原著里在落魂阵中拜草人、摇摄魂铃，摄去姜子牙的魂魄。三阶段（气血 100% → 60% → 30% → 0），每一招都先预警、再结算：
//   一：落魂幡——在人物身边插三面幡，幡和他之间连起魂线（他站着施法），碰到魂线被定住一下并掉血；幡有血量，打断一面那条线就断。
//       摄魂铃——摇铃，一圈接一圈慢速的魂波往外扩，每一圈都有一个缺口，从缺口里穿出去。
//   二：草人拜魂——人物身边立起几个草人，头顶倒计时，到时没打碎的让人物掉一截血（要先打草人）。十阵齐鸣——一次亮起 5 座阵眼。
//   三：落魂化雾——化成魂雾在场上游走（打不到），停在人物身边，先亮出一大片淡红光，然后显形、那一片炸开魂波；显形的几秒里摇铃 / 插幡。
// 纯函数、确定性：随机数只用 w.rng。本体是 w.enemies 里 kind 'boss' 的敌人（法宝照常打它；化雾时无敌），移动由这里控制；
// 幡、草人是 w.enemies 里的 soulflag / strawman（不动、不伤人，有血量）；每一招的预警与判定放在 YaoFight.hazards 里，表现层只读它来画。
// 换阶段无敌、不吃控制（core.hitEnemy 对 kind 'boss' 一律不上晕眩 / 冻结）、伤害写在配置里不乘波次倍率。
// 对外是首领模块 YAO_BOSS（chapters.ts 登记到第二章；接口见 chapters.BossModule）。
import { DT, PLAYER } from '../config.ts';
import { chapterOf } from '../catalog.ts';
import { hurtPlayer } from '../core.ts';
import { range } from '../rng.ts';
import { spawnSpot } from '../spawn.ts';
import { cameras, enemyHpMul } from '../coop.ts';
import { bossEnemy, innerRect, segDist } from '../boss.ts';
import { POOL, fightOf, guestDown, guestHp, putFight } from '../bosspool.ts';
import type { BossModule, Spawn } from '../chapters.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { YAO } from './config.ts';
import { tenActivate } from './terrain.ts';
import type { YaoFight, YaoHazard, YaoMove, YaoState } from './types.ts';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** 整数 → [0, 1) 的固定散列（机器人的「走神」用，不动 w.rng）。 */
const hashUnit = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** 这一仗（首领战在 w.boss、遭遇战在 w.echo）是姚天君的话返回它。 */
export function yaoOf(w: World): YaoFight | null {
  const f = fightOf(w);
  return f && f.kind === 'yao' ? f : null;
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
const findEnemy = (w: World, id: number) => {
  for (const e of w.enemies) if (e.id === id) return e;
  return null;
};

// ---------- 状态机 ----------
function enter(f: YaoFight, s: YaoState, dur = 0) {
  f.state = s;
  f.t = 0;
  f.lt = -1;
  f.dur = dur;
}
/** 招式脚本里的「到了第 T 秒」：每个时间点只触发一次。 */
const at = (f: YaoFight, T: number) => f.lt < T && f.t >= T;
function face(f: YaoFight, from: { x: number }, toX: number) {
  if (Math.abs(toX - from.x) > 2) f.facing = toX >= from.x ? 1 : -1;
}

function addHazard(w: World, f: YaoFight, h: Partial<YaoHazard> & Pick<YaoHazard, 'kind' | 'warn' | 'live' | 'x0' | 'y0' | 'r' | 'dmg'>, ev: SimEvent[]): YaoHazard {
  const hz: YaoHazard = { x1: h.x0, y1: h.y0, flag: -1, gapA: 0, gapW: 0, rad: 0, prad: 0, ...h, id: w.nextId++, t: 0, hit: w.players.map(() => -1) };
  f.hazards.push(hz);
  ev.push({ t: 'yaoCast', id: f.id, hazard: hz.id, kind: hz.kind, x: hz.x0, y: hz.y0 });
  return hz;
}

/** 首领召出来的东西（幡、草人）：按配置给血量（联机按人数加），不动、不愣。 */
function summonThing(w: World, spawn: Spawn, kind: 'soulflag' | 'strawman', x: number, y: number, hp: number): Enemy {
  const e = spawn(kind, x, y);
  e.hp = e.maxHp = Math.round(hp * enemyHpMul(w));
  e.speed = 0;
  return e;
}

/** 在人物身边挑 n 个点：方向均匀错开（起始方向随机），离人物 dist 区间里的距离，夹在能站的范围里、离他本人不太近。 */
function ringSpots(w: World, p: Player, b: Enemy, n: number, dist: [number, number]): { x: number; y: number }[] {
  const R = innerRect(w, 24);
  const a0 = w.rng.next() * TAU;
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * TAU + range(w.rng, -0.25, 0.25);
    const d = range(w.rng, dist[0], dist[1]);
    let x = clamp(p.x + Math.cos(a) * d, R.x0, R.x1);
    let y = clamp(p.y + Math.sin(a) * d * 0.8, R.y0, R.y1);
    // 别插在他自己脚下（魂线太短）
    const bd = Math.hypot(x - b.x, y - b.y);
    if (bd < 36) {
      x = clamp(b.x + ((x - b.x) / (bd || 1)) * 36, R.x0, R.x1);
      y = clamp(b.y + ((y - b.y) / (bd || 1)) * 36, R.y0, R.y1);
    }
    out.push({ x, y });
  }
  return out;
}

type MoveScript = (w: World, f: YaoFight, b: Enemy, p: Player, ev: SimEvent[], spawn: Spawn) => boolean;

const MOVES: Record<YaoMove, MoveScript> = {
  // 落魂幡：插三面幡（他站着施法），魂线先预警再连上；幡全倒了、或连够了时间就收招（剩下的幡散掉）
  banners(w, f, b, p, ev, spawn) {
    const B = YAO.banners;
    if (at(f, 0)) {
      face(f, b, p.x);
      for (const q of ringSpots(w, p, b, B.n, B.dist)) {
        const e = summonThing(w, spawn, 'soulflag', q.x, q.y, B.hp);
        f.flags.push(e.id);
        ev.push({ t: 'yaoFlag', id: f.id, flag: e.id, x: e.x, y: e.y });
        addHazard(w, f, { kind: 'line', warn: B.warn, live: B.live, x0: e.x, y0: e.y, x1: b.x, y1: b.y, r: B.r, flag: e.id, dmg: B.dmg }, ev);
      }
    }
    const done = f.t >= B.warn + B.live || (f.t > B.warn && !f.hazards.some((h) => h.kind === 'line'));
    if (done) dropFlags(w, f, ev);
    return done;
  },
  // 摄魂铃：抬铃摇一会儿（预警），然后一圈接一圈往外扩的魂波，每圈一个缺口（第一圈偏离人物的方向一点，后面每圈再转一下）
  bell(w, f, b, p, ev) {
    const B = YAO.bell;
    const n = B.count[f.phase] ?? 2;
    const pre = 0.4; // 每一圈自己的预警：魂波在铃边先亮出来（带着缺口），再往外扩
    if (at(f, 0)) face(f, b, p.x);
    for (let k = 0; k < n; k++) {
      if (!at(f, B.warn - pre + k * B.gap)) continue;
      const base = Math.atan2(p.y - b.y, p.x - b.x);
      const prev = f.hazards.filter((h) => h.kind === 'wave').at(-1);
      const sign = w.rng.next() < 0.5 ? -1 : 1;
      const gapA = k === 0 || !prev ? base + sign * range(w.rng, B.turn[0], B.turn[1]) : prev.gapA + sign * range(w.rng, B.turn[0], B.turn[1]);
      addHazard(w, f, { kind: 'wave', warn: pre, live: (B.rMax - B.r0) / B.speed, x0: b.x, y0: b.y, r: B.hw, gapA: wrapAngle(gapA), gapW: B.gapW, rad: B.r0, prad: B.r0, dmg: B.dmg }, ev);
    }
    return f.t >= B.warn + (n - 1) * B.gap + 0.2;
  },
  // 草人拜魂：抬手，人物身边立起几个草人（头顶倒计时；倒计时在 update 里走，招式本身很快收）
  straw(w, f, b, p, ev, spawn) {
    const S = YAO.straw;
    if (at(f, 0)) face(f, b, p.x);
    if (at(f, S.cast)) {
      const ids: number[] = [];
      for (const q of ringSpots(w, p, b, S.n, S.dist)) {
        const e = summonThing(w, spawn, 'strawman', q.x, q.y, S.hp);
        e.actT = e.actLen = S.time;
        f.straws.push(e.id);
        ids.push(e.id);
      }
      ev.push({ t: 'yaoStraw', id: f.id, ids, t2: S.time });
    }
    return f.t >= S.cast + 0.3;
  },
  // 十阵齐鸣：双手一抬，一次亮起 5 座阵眼（地形照常先预警）
  formations(w, f, b, p, ev) {
    const F = YAO.formations;
    if (at(f, 0)) face(f, b, p.x);
    if (at(f, F.cast)) tenActivate(w, F.n, ev, 'soul'); // 必带他自己的落魂阵
    return f.t >= F.cast + 0.2;
  },
  // 落魂化雾：化成魂雾游走（无敌），跟着人物飘到他身边某个方向停下；先亮一大片淡红光，然后显形、那一片炸开
  mist(w, f, b, p, ev) {
    const M = YAO.mist;
    if (at(f, 0)) {
      f.hidden = true;
      b.invuln = Math.max(b.invuln, M.roam + M.warn + 0.05);
      f.roam = { a: w.rng.next() * TAU, d: range(w.rng, M.near[0], M.near[1]) };
      ev.push({ t: 'yaoMist', id: f.id, act: 'vanish', x: b.x, y: b.y });
    }
    if (f.t < M.roam && f.roam) {
      // 游走：朝「人物身边那个方向上的点」飘（人物在动，点跟着动）
      const R = innerRect(w, 20);
      const tx = clamp(p.x + Math.cos(f.roam.a) * f.roam.d, R.x0, R.x1);
      const ty = clamp(p.y + Math.sin(f.roam.a) * f.roam.d * 0.8, R.y0, R.y1);
      const dx = tx - b.x;
      const dy = ty - b.y;
      const d = Math.hypot(dx, dy);
      const step = Math.min(d, M.speed * DT);
      if (d > 0.5) {
        b.x += (dx / d) * step;
        b.y += (dy / d) * step;
        f.moving = true;
        face(f, b, tx);
      }
    }
    if (at(f, M.roam)) addHazard(w, f, { kind: 'burst', warn: M.warn, live: 0.15, x0: b.x, y0: b.y, r: M.r, dmg: M.dmg }, ev);
    if (at(f, M.roam + M.warn)) {
      f.hidden = false;
      b.invuln = 0;
      f.roam = null;
      ev.push({ t: 'yaoMist', id: f.id, act: 'appear', x: b.x, y: b.y });
    }
    return f.t >= M.roam + M.warn + 0.2;
  },
};

const RECOVER: Record<YaoMove, number> = {
  banners: YAO.banners.recover,
  bell: YAO.bell.recover,
  straw: YAO.straw.recover,
  formations: YAO.formations.recover,
  mist: YAO.mist.recover,
};

function pickMove(w: World, f: YaoFight): YaoMove {
  if (f.queue.length) return f.queue.shift()!;
  let pool = Object.entries(YAO.pool[f.phase]).filter(([m]) => m !== f.last) as [YaoMove, number][];
  // 场上还有草人就不再拜（等这一批结完）
  if (f.straws.length) pool = pool.filter(([m]) => m !== 'straw');
  let r = w.rng.next() * pool.reduce((s, [, v]) => s + v, 0);
  for (const [m, v] of pool) {
    r -= v;
    if (r < 0) return m;
  }
  return pool[pool.length - 1][0];
}

function toIdle(w: World, f: YaoFight) {
  enter(f, 'idle', YAO.idle[f.phase] + range(w.rng, -0.15, 0.15));
  f.move = null;
}

/** 空闲：慢慢走到人物左边或右边 keep 像素、上下差得不多的地方（施法的，站得比魔化哪吒远）。 */
function walk(f: YaoFight, b: Enemy, p: Player) {
  const side = b.x >= p.x ? 1 : -1;
  face(f, b, p.x);
  const mx = p.x + side * YAO.keep - b.x;
  const my = p.y + clamp(b.y - p.y, -YAO.keepY, YAO.keepY) - b.y;
  const m = Math.hypot(mx, my);
  if (m < 3) return;
  const sp = YAO.walk[f.phase] * (1 - 0.5 * b.slow) * DT;
  b.x += (mx / m) * Math.min(m, sp);
  b.y += (my / m) * Math.min(m, sp);
  f.moving = true;
}

function runState(w: World, f: YaoFight, b: Enemy, p: Player | null, ev: SimEvent[], spawn: Spawn) {
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
      if (MOVES[f.move](w, f, b, p, ev, spawn)) enter(f, 'recover', RECOVER[f.move]);
      break;
    case 'recover':
      if (f.t >= f.dur) toIdle(w, f);
      break;
    case 'dead':
      break;
  }
}

// ---------- 幡与草人 ----------

/** 幡全散掉（收招、换阶段、倒下）：幡消失（不算击杀、不掉灵石），魂线一起没了。 */
function dropFlags(w: World, f: YaoFight, ev: SimEvent[]) {
  for (const id of f.flags) {
    const e = findEnemy(w, id);
    if (e && e.hp > 0) {
      ev.push({ t: 'yaoLineBreak', id: f.id, hazard: -1, flag: id, x: e.x, y: e.y });
      e.hp = 0;
    }
  }
  f.flags = [];
  f.hazards = f.hazards.filter((h) => h.kind !== 'line');
}

/** 每帧：被打倒的幡，那条魂线就断；被打碎的草人从名单里拿掉。 */
function syncSummons(w: World, f: YaoFight, ev: SimEvent[]) {
  if (f.flags.length) {
    const alive = f.flags.filter((id) => (findEnemy(w, id)?.hp ?? 0) > 0);
    if (alive.length !== f.flags.length) {
      for (let i = f.hazards.length - 1; i >= 0; i--) {
        const h = f.hazards[i];
        if (h.kind !== 'line' || alive.includes(h.flag)) continue;
        f.hazards.splice(i, 1);
        ev.push({ t: 'yaoLineBreak', id: f.id, hazard: h.id, flag: h.flag, x: h.x0, y: h.y0 });
      }
      f.flags = alive;
    }
  }
  if (f.straws.length) f.straws = f.straws.filter((id) => (findEnemy(w, id)?.hp ?? 0) > 0);
}

/** 草人的倒计时：到时还没打碎的，一起让离得最近的那个人掉血（一个草人一份），然后烧掉（不算击杀）。 */
function updateStraws(w: World, f: YaoFight, alive: Player[], ev: SimEvent[]) {
  if (!f.straws.length) return;
  const due: Enemy[] = [];
  for (const id of f.straws) {
    const e = findEnemy(w, id);
    if (!e) continue;
    e.actT = (e.actT ?? 0) - DT;
    if (e.actT <= 0) due.push(e);
  }
  if (!due.length) return;
  const cx = due.reduce((s, e) => s + e.x, 0) / due.length;
  const cy = due.reduce((s, e) => s + e.y, 0) / due.length;
  const p = nearest({ x: cx, y: cy }, alive);
  let dmg = 0;
  if (p) {
    const hp = p.hp;
    if (hurtPlayer(w, p, YAO.straw.dmg * due.length, 'boss', ev)) dmg = hp - Math.max(0, p.hp);
  }
  ev.push({ t: 'yaoCurse', id: f.id, ids: due.map((e) => e.id), owner: p?.id ?? -1, dmg, x: p?.x ?? cx, y: p?.y ?? cy });
  for (const e of due) e.hp = 0;
  f.straws = f.straws.filter((id) => !due.some((e) => e.id === id));
}

// ---------- 危险物的推进与判定 ----------

function updateHazards(w: World, f: YaoFight, alive: Player[], ev: SimEvent[]) {
  for (let i = f.hazards.length - 1; i >= 0; i--) {
    const h = f.hazards[i];
    const was = h.t;
    h.t += DT;
    if (h.t < h.warn) continue;
    if (was < h.warn) ev.push({ t: 'yaoStrike', id: f.id, hazard: h.id, kind: h.kind, x: h.x0, y: h.y0 });
    const tl = h.t - h.warn;
    switch (h.kind) {
      case 'line': {
        const B = YAO.banners;
        for (const p of alive) {
          if (!p.alive || (h.hit[p.id] >= 0 && w.time - h.hit[p.id] < B.rehit)) continue;
          if (segDist(p.x, p.y, h.x0, h.y0, h.x1, h.y1) > h.r + PLAYER.radius) continue;
          h.hit[p.id] = w.time;
          if (hurtPlayer(w, p, h.dmg, 'boss', ev)) {
            p.root = Math.max(p.root ?? 0, B.root);
            ev.push({ t: 'yaoRoot', owner: p.id, x: p.x, y: p.y, t2: B.root });
          }
        }
        break;
      }
      case 'wave': {
        h.prad = h.rad;
        h.rad = YAO.bell.r0 + tl * YAO.bell.speed;
        const lo = Math.min(h.prad, h.rad) - h.r - PLAYER.radius;
        const hi = Math.max(h.prad, h.rad) + h.r + PLAYER.radius;
        for (const p of alive) {
          if (!p.alive || h.hit[p.id] >= 0) continue;
          const d = Math.hypot(p.x - h.x0, p.y - h.y0);
          if (d < lo || d > hi) continue;
          // 整个身子都在缺口里才躲得过（身子和缺口的边有重叠就算打中）
          const rel = Math.abs(wrapAngle(Math.atan2(p.y - h.y0, p.x - h.x0) - h.gapA));
          if (rel + PLAYER.radius / Math.max(d, 8) <= h.gapW) continue;
          h.hit[p.id] = w.time;
          hurtPlayer(w, p, h.dmg, 'boss', ev);
        }
        break;
      }
      case 'burst': {
        if (was >= h.warn) break; // 炸开那一帧结算一次
        for (const p of alive) {
          if (!p.alive || Math.hypot(p.x - h.x0, p.y - h.y0) > h.r) continue;
          h.hit[p.id] = w.time;
          hurtPlayer(w, p, h.dmg, 'boss', ev);
        }
        break;
      }
    }
    if (tl >= h.live) f.hazards.splice(i, 1);
  }
}

function contactDamage(w: World, f: YaoFight, b: Enemy, alive: Player[], ev: SimEvent[]) {
  if (f.state === 'intro' || f.hidden) return;
  const r = 8 + PLAYER.radius;
  for (const p of alive) {
    if (!p.alive || p.iframes > 0) continue;
    if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 > r * r) continue;
    hurtPlayer(w, p, YAO.contact, 'boss', ev);
  }
}

/** 零星的回响兵：和普通刷怪一样刷在所有人的镜头外（cameras：联机时倒在地上的人的镜头也算）。 */
function summon(w: World, f: YaoFight, alive: Player[], spawn: Spawn) {
  if (f.state === 'intro' || f.state === 'phase' || !alive.length) return;
  const S = YAO.summon;
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

/**
 * 首领波开始：在离人物 150–200 像素、场地里面的地方现身（朝场心的方向优先，上下别太远）。
 * guest：来遭遇战（首领池，bosspool.ts；本章第 4 波出精英的那一刻）——气血少、现身短一些，状态放进 w.echo；只打一、二两个阶段（不化雾）。
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
  const d = range(w.rng, YAO.entry[0], YAO.entry[1]);
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
  b.hp = b.maxHp = guest ? guestHp(w, 'yao') : YAO.hp;
  b.dmgMul = 1;
  b.speed = 0;
  const intro = guest ? POOL.guestIntro : YAO.intro;
  b.invuln = intro;
  if (guest) b.hpFloor = Math.ceil(b.maxHp * POOL.guestPhaseAt); // 换二阶段之前打不死（core.hitEnemy）
  putFight(w, {
    kind: 'yao',
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
    hazards: [],
    flags: [],
    straws: [],
    hidden: false,
    roam: null,
    summonT: YAO.summon.first,
    deadAt: null,
  });
  if (guest) ev.push({ t: 'echoIntro', id: b.id, kind: 'yao', x: b.x, y: b.y });
  else ev.push({ t: 'bossIntro', id: b.id, kind: 'yao', x: b.x, y: b.y, chapter });
}

function update(w: World, alive: Player[], ev: SimEvent[], spawn: Spawn) {
  const f = yaoOf(w);
  if (!f) return;
  f.lt = f.t;
  f.t += DT;
  if (f.state === 'dead') return;
  const b = bossEnemy(w);
  if (!b) return;
  syncSummons(w, f, ev);
  f.moving = false;
  const p = nearest(b, alive);
  for (let guard = 0; guard < 3; guard++) {
    const s: YaoState = f.state;
    runState(w, f, b, p, ev, spawn);
    if (f.state === s) break;
  }
  updateHazards(w, f, alive, ev);
  updateStraws(w, f, alive, ev);
  contactDamage(w, f, b, alive, ev);
  if (!f.guest) summon(w, f, alive, spawn); // 遭遇战那一波照常刷怪，不另刷
  const r = innerRect(w, 14);
  b.x = clamp(b.x, r.x0, r.x1);
  b.y = clamp(b.y, r.y0, r.y1);
}

function enterPhase(w: World, f: YaoFight, b: Enemy, n: number, ev: SimEvent[]) {
  f.phase = n;
  // 换阶段：还没出手的预警取消、魂线和幡散掉（施法被打断）；已经扩出去的魂波照常扩完；草人的倒计时照走
  dropFlags(w, f, ev);
  f.hazards = f.hazards.filter((h) => h.kind === 'wave' && h.t >= h.warn);
  f.move = null;
  f.hidden = false;
  f.roam = null;
  const T = f.guest ? POOL.guestPhaseTime : YAO.phaseTime;
  enter(f, 'phase', T);
  b.invuln = Math.max(b.invuln, T);
  if (f.guest) ev.push({ t: 'echoPhase', id: b.id, kind: 'yao', phase: n, x: b.x, y: b.y });
  else ev.push({ t: 'bossPhase', id: b.id, phase: n, x: b.x, y: b.y });
  if (n === 3) f.queue = ['mist']; // 三阶段：一进来先化雾
}

function die(w: World, f: YaoFight, b: Enemy, ev: SimEvent[]) {
  // 倒下的表现期间这一仗已经打赢：危险物、幡、草人、回响兵、鬼火都清掉（不算击杀），阵也不再伤人（terrain.ts 看 boss.state）
  dropFlags(w, f, ev);
  f.hazards = [];
  f.move = null;
  f.hidden = false;
  f.deadAt = { x: b.x, y: b.y };
  if (f.guest) {
    // 遭遇战：这一波照常打完，场上别的敌人、鬼火都不动；他立的草人跟着烧掉（不算击杀）；掉一只精英宝匣（bosspool.guestDown）
    for (const id of f.straws) {
      const e = findEnemy(w, id);
      if (e) e.hp = 0;
    }
    f.straws = [];
    guestDown(w, 'yao', b, f.facing, ev);
    enter(f, 'dead', POOL.guestDeath);
    return;
  }
  f.straws = [];
  ev.push({ t: 'bossDeath', id: b.id, kind: 'yao', x: b.x, y: b.y, facing: f.facing, chapter: f.chapter });
  enter(f, 'dead', YAO.deathTime);
  w.enemies = w.enemies.filter((e) => e === b);
  w.orbs = [];
  b.hp = 0;
}

/** 每帧伤害都结算完之后：跨过阈值就卡在阈值上换阶段；三阶段打空才真的倒下。 */
function check(w: World, ev: SimEvent[]) {
  const f = yaoOf(w);
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
    const floor = Math.ceil(b.maxHp * YAO.phases[f.phase - 1]);
    if (b.hp <= floor) {
      b.hp = floor;
      enterPhase(w, f, b, f.phase + 1, ev);
    }
  } else if (b.hp <= 0) die(w, f, b, ev);
}

function defeated(w: World) {
  const f = yaoOf(w);
  return !!f && f.state === 'dead' && f.t >= f.dur - 1e-9;
}

/**
 * 机器人躲招：落在还没结束的危险物里算 1 再加陷得多深（口径同魔化哪吒的 bossDanger）。
 * 魂线：离线段多远；魂波：把带子往外推一点（它在往外扩，站着不动的话马上就到），站在缺口里不算；显形前那一片：离圆心多远。
 */
function danger(w: World, x: number, y: number, react = 0, margin = 6, jitter = 0): number {
  const f = yaoOf(w);
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
      case 'line':
        add(h.r + PLAYER.radius + margin - segDist(x, y, h.x0, h.y0, h.x1, h.y1));
        break;
      case 'wave': {
        // 魂波一直往外扩（比人走得慢不了多少），带子外面、不在缺口方向上的地方早晚都要挨打：都算危险，离带子越近越危险；
        // 缺口方向上不算（往缺口那边钻），带子里面（已经扩过去的）不算。往外跑只是晚一点挨打，不如钻缺口
        const d = Math.hypot(x - h.x0, y - h.y0);
        const rad = tl > 0 ? h.rad : YAO.bell.r0;
        const band = h.r + PLAYER.radius + margin;
        if (d < rad - band) break;
        const rel = Math.abs(wrapAngle(Math.atan2(y - h.y0, x - h.x0) - h.gapA));
        if (rel + (PLAYER.radius + margin * 0.5) / Math.max(d, 8) <= h.gapW) break;
        const gapFar = Math.min(1, Math.max(0, rel - h.gapW) * 0.8); // 离缺口越远越危险（往缺口那边走）
        s += 0.5 + 1.3 * Math.max(0, 1 - Math.max(0, d - rad - band) / 110) + 0.6 * gapFar;
        break;
      }
      case 'burst':
        add(h.r + PLAYER.radius + margin - Math.hypot(x - h.x0, y - h.y0));
        break;
    }
  }
  const b = bossEnemy(w);
  if (b && f.state !== 'intro' && !f.hidden) {
    const d = Math.hypot(x - b.x, y - b.y);
    if (d < 30) s += 0.4 + 0.6 * (1 - d / 30);
  }
  return s;
}

/**
 * 机器人的站位偏好：离他不远不近（约 105 像素；化雾时不管他）；场上有草人就往最近的草人那边靠（要先打草人），
 * 有落魂幡就往最近的幡那边靠一点（打断魂线）。
 */
function prefer(w: World, x: number, y: number): number {
  const f = yaoOf(w);
  const b = bossEnemy(w);
  if (!f || !b) return 0;
  let s = 0;
  if (!f.hidden) {
    const d = Math.hypot(x - b.x, y - b.y);
    s += ((d - 105) / 90) ** 2 * 0.8;
  }
  const near = (ids: number[]) => {
    let best = Infinity;
    for (const id of ids) {
      const e = findEnemy(w, id);
      if (e && e.hp > 0) best = Math.min(best, Math.hypot(x - e.x, y - e.y));
    }
    return best;
  };
  const ds = near(f.straws);
  if (ds < Infinity) s += Math.max(0, ds - 50) * 0.012;
  const df = near(f.flags);
  if (df < Infinity) s += Math.max(0, df - 60) * 0.004;
  return s;
}

/** 姚天君的首领模块（chapters.ts 登记到第二章）。 */
export const YAO_BOSS: BossModule = { kind: 'yao', start, update, check, defeated, danger, prefer };

/** 表现层用的姿势。 */
export type YaoPose = 'idle' | 'walk' | 'cast' | 'bell' | 'raise' | 'roar' | 'hidden';
export function yaoPose(f: YaoFight): YaoPose {
  if (f.hidden) return 'hidden';
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
        case 'bell':
          return 'bell';
        case 'banners':
          return 'cast';
        case 'straw':
        case 'formations':
          return 'raise';
        default:
          return 'idle';
      }
  }
}

/** 状态摘要（测试比确定性用）。 */
export function yaoDigest(w: World): string {
  const f = yaoOf(w);
  const r = (v: number) => Math.round(v * 100);
  if (!f) return 'noyao';
  const parts: (string | number)[] = [f.phase, f.state, r(f.t), f.move ?? '-', f.last ?? '-', f.facing, f.hidden ? 1 : 0, f.flags.join('|'), f.straws.join('|')];
  for (const h of f.hazards) parts.push(h.id, h.kind, r(h.t), r(h.x0), r(h.y0), r(h.rad), r(h.gapA), h.hit.join('|'));
  return parts.join(',');
}
