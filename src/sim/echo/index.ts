// 回响化身（用户 11-11 确认）：榜上的魂被拘回来的「回响赵公明」「回响云霄」。首领池（bosspool.ts）之后它们是池里的两位，
// 和别的首领一样有两种打法：来遭遇战（本章第 4 波的精英换成它，状态在 World.echo）或当这一章的首领（第 6 波，状态在 World.boss）。
// 本体是 w.enemies 里一只 kind 'boss' 的敌人——法宝照常先找它、不吃控制（core.hitEnemy 对 'boss' 的规矩），移动和接触伤害由这里管
// （world.step 不动 'boss'）；打法的状态是 EchoFight（纯数据，整局存档存得下）。照首领模块的写法：每一招先预警、再判定（危险物 EchoHazard），
// 换阶段无敌、换阶段之前打不死（Enemy.hpFloor），伤害写在 config.ts。机器人读 echoDanger / echoDodge 躲招。
//   遭遇战：两个阶段（一半换阶段）；这一波结束还没打倒就退走（echoLeave，这一局不解锁）；打倒了发 echoDefeat、掉一份大奖励
//           （kind 'boss' 的 40 颗灵石 + 一只精英宝匣），表现层据此写进存档解锁（机器人自动玩不写）、放解锁卡。
//   当首领：气血换成 chiefHp、三个阶段（六成、三成换阶段，第三阶段多一招）、零星刷一点回响兵；倒下时清场、发 bossDeath，之后本章平定。
// 接到别处的只有这几处（合并时好对）：
//   chapters.ts  章节表的 pool 里登记 echoBoss('zhao') / echoBoss('yunxiao')（包成首领模块；world.ts 只通过首领模块调这里）
//   core.ts      hitEnemy 扣血之后 hpFloor（换阶段之前打不死）
//   bot.ts       普通波的躲招：遭遇战的模块有 dodge 就用它（这里的 echoDodge）
import { ARENA, DT, ENEMIES, PLAYER } from '../config.ts';
import { chapterOf } from '../catalog.ts';
import { hurtPlayer, segDist } from '../core.ts';
import { cameras } from '../coop.ts';
import { jieBossDmg } from '../jie.ts';
import { range } from '../rng.ts';
import { spawnSpot } from '../spawn.ts';
import { bossName, guestDown, guestHp, putFight } from '../bosspool.ts';
import type { BossModule, Spawn } from '../chapters.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import { spawnAt, type World } from '../world.ts';
import { ECHO, ECHO_AOBING, ECHO_YUNXIAO, ECHO_ZHAO } from './config.ts';
import { AOBING_MOVES, AOBING_RECOVER } from './aobing.ts';
import { at, clampIn, face, type MoveScript } from './kit.ts';
import { ZHAO_MOVES, ZHAO_RECOVER, zhaoTick } from './zhao.ts';
import { YUNXIAO_MOVES, YUNXIAO_RECOVER } from './yunxiao.ts';
import type { EchoFight, EchoHazard, EchoKind, EchoMove } from './types.ts';

export type { EchoEvent, EchoFight, EchoHazard, EchoKind, EchoMove } from './types.ts';
export { ECHO, ECHO_AOBING, ECHO_YUNXIAO, ECHO_ZHAO } from './config.ts';

/** 每一位回响的一套：名字、当首领时的气血（遭遇战的在 bosspool.POOL.guestHp）、走路与站定、招式池（按阶段；第三阶段只有当首领时才有）、招式脚本、收招、每帧的小事。 */
interface EchoDef {
  name: string;
  chiefHp: number;
  walk: number[];
  idle: number[];
  pool: Partial<Record<string, number>>[];
  moves: Partial<Record<EchoMove, MoveScript>>;
  recover: Partial<Record<EchoMove, number>>;
  tick?(f: EchoFight): void;
  /** 来遭遇战时招式伤害的倍率（不给是 1；敖丙在第一章第 4 波，人物的气血少）。 */
  guestDmg?: number;
  /** 机器人正好站在一条线上时，挑别的危险物少的那一侧让（连着出几条线的招要它；不给就一律往场心那一侧，回响赵公明 / 云霄照旧）。 */
  pickSide?: boolean;
}

export const ECHOS: Record<EchoKind, EchoDef> = {
  zhao: { ...ECHO_ZHAO, moves: ZHAO_MOVES, recover: ZHAO_RECOVER, tick: zhaoTick },
  yunxiao: { ...ECHO_YUNXIAO, moves: YUNXIAO_MOVES, recover: YUNXIAO_RECOVER },
  aobing: { ...ECHO_AOBING, moves: AOBING_MOVES, recover: AOBING_RECOVER, pickSide: true },
};

/** 这一仗是回响这一族的（遭遇战在 w.echo，当首领在 w.boss；一个波次里两个槽最多占一个）就返回它的状态。 */
export function echoOf(w: World): EchoFight | null {
  const f = w.boss ?? w.echo;
  return f && Object.hasOwn(ECHOS, f.kind) ? (f as EchoFight) : null;
}

/** 回响本体（w.enemies 里 kind 'boss' 的那只）。 */
export function echoEnemy(w: World): Enemy | null {
  const f = echoOf(w);
  if (!f) return null;
  for (const e of w.enemies) if (e.id === f.id) return e;
  return null;
}

/** 这一仗收掉（本体没了、换了波次）：从它在的那个槽里拿走。 */
function drop(w: World, f: EchoFight) {
  if (w.echo === f) w.echo = null;
  if (w.boss === f) w.boss = null;
}

/**
 * 现身。遭遇战（world.step，这一波到了 35%、出精英的时候）：在离人物 ECHO.entry 像素、仙台里面（横着为主，朝场心的方向优先）——
 * 在屏幕里现身、不贴脸；当首领（world.startWave）：和别的首领一样离人物 150–200 像素。
 */
export function startEcho(w: World, kind: EchoKind, ev: SimEvent[], spawn: Spawn, guest: boolean) {
  const D = ECHOS[kind];
  const C = ECHO.chief;
  const p = w.players.find((x) => x.alive) ?? w.players[0];
  const cx = ARENA.w / 2 - p.x;
  const cy = ARENA.h / 2 - p.y;
  const entry = guest ? ECHO.entry : C.entry;
  const d = range(w.rng, entry[0], entry[1]);
  let best = clampIn(p.x + d, p.y, 40);
  let bs = -Infinity;
  for (const a of [0, 0.3, -0.3, 0.6, -0.6, Math.PI, Math.PI - 0.3, Math.PI + 0.3, Math.PI - 0.6, Math.PI + 0.6]) {
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const inside = x >= ARENA.pad + 40 && x <= ARENA.w - ARENA.pad - 40 && y >= ARENA.pad + 40 && y <= ARENA.h - ARENA.pad - 40;
    const s = (inside ? 1000 : 0) + Math.cos(a) * cx + Math.sin(a) * cy - Math.abs(Math.sin(a)) * 40 + w.rng.next();
    if (s > bs) {
      bs = s;
      best = clampIn(x, y, 40);
    }
  }
  const e = spawn('boss', best.x, best.y);
  // 气血：遭遇战按人数、劫数加（bosspool.guestHp）；当首领时先给底数，world.startWave 接着按人数（scaleBoss）、劫数（jieBossStart）加
  e.hp = e.maxHp = guest ? guestHp(w, kind) : D.chiefHp;
  e.speed = 0;
  const intro = guest ? ECHO.intro : C.intro;
  e.invuln = intro;
  const f: EchoFight = {
    kind,
    id: e.id,
    guest,
    chapter: chapterOf(w.wave),
    wave: w.wave,
    phase: 1,
    state: 'intro',
    t: 0,
    lt: -1,
    dur: intro,
    move: null,
    last: null,
    queue: [],
    facing: p.x >= e.x ? 1 : -1,
    moving: false,
    mul: jieBossDmg(w) * (guest ? (D.guestDmg ?? 1) : 1),
    hazards: [],
    tiger: null,
    step: 0,
    ride: null,
    summonT: C.summon.first,
    deadAt: null,
  };
  syncFloor(f, e);
  putFight(w, f);
  if (guest) ev.push({ t: 'echoIntro', id: e.id, kind, x: e.x, y: e.y });
  else ev.push({ t: 'bossIntro', id: e.id, kind, x: e.x, y: e.y, chapter: f.chapter });
}

/** 测试、实验页：直接放出这一位来遭遇战（不等这一波出精英的那一刻）。 */
export function spawnEcho(w: World, kind: EchoKind, ev: SimEvent[]) {
  startEcho(w, kind, ev, (k, x, y) => spawnAt(w, k, x, y, ev), true);
}

/** 一共几个阶段、下一次换阶段的气血线（比例；已经是最后一个阶段就是 0）。 */
const phasesOf = (f: EchoFight) => (f.guest ? 2 : 3);
const nextFloor = (f: EchoFight) => (f.phase >= phasesOf(f) ? 0 : f.guest ? ECHO.phaseAt : ECHO.chief.phases[f.phase - 1]);
/** 换阶段之前打不死：气血卡在下一条线上（core.hitEnemy 读 Enemy.hpFloor）。当首领时气血上限在上场之后还会按人数、劫数加，所以每帧对一次。 */
function syncFloor(f: EchoFight, e: Enemy) {
  const k = nextFloor(f);
  if (k > 0) e.hpFloor = Math.ceil(e.maxHp * k);
  else delete e.hpFloor;
}

// ---------------------------------------------------------------- 状态机

function enter(f: EchoFight, s: EchoFight['state'], dur = 0) {
  f.state = s;
  f.t = 0;
  f.lt = -1;
  f.dur = dur;
}

function pickMove(w: World, f: EchoFight): EchoMove {
  if (f.queue.length) return f.queue.shift()!;
  const pool = Object.entries(ECHOS[f.kind].pool[f.phase]).filter(([m]) => m !== f.last) as [EchoMove, number][];
  let r = w.rng.next() * pool.reduce((s, [, v]) => s + v, 0);
  for (const [m, v] of pool) {
    r -= v;
    if (r < 0) return m;
  }
  return pool[pool.length - 1][0];
}

function toIdle(w: World, f: EchoFight) {
  enter(f, 'idle', ECHOS[f.kind].idle[f.phase] + range(w.rng, -0.15, 0.15));
  f.move = null;
}

/**
 * 两招之间：慢慢走到人物左边或右边 ECHO.keep 像素、上下差得不多的地方（减速对它只起一半作用）；
 * 离得远了走得快一些（最多快 ECHO.catchUp 倍），人跑开了它也跟得上，不会丢在屏幕外。
 */
function walk(f: EchoFight, e: Enemy, p: Player) {
  const side = e.x >= p.x ? 1 : -1;
  face(f, e, p.x);
  const mx = p.x + side * ECHO.keep - e.x;
  const my = p.y + Math.max(-ECHO.keepY, Math.min(ECHO.keepY, e.y - p.y)) - e.y;
  const m = Math.hypot(mx, my);
  if (m < 3) return;
  const far = Math.max(0, Math.min(1, (Math.hypot(p.x - e.x, p.y - e.y) - 130) / 120));
  const sp = ECHOS[f.kind].walk[f.phase] * (1 + (ECHO.catchUp - 1) * far) * (1 - 0.5 * e.slow) * DT;
  e.x += (mx / m) * Math.min(m, sp);
  e.y += (my / m) * Math.min(m, sp);
  f.moving = true;
}

function runState(w: World, f: EchoFight, e: Enemy, p: Player | null, ev: SimEvent[]) {
  const D = ECHOS[f.kind];
  switch (f.state) {
    case 'intro':
    case 'phase':
      if (f.t >= f.dur) toIdle(w, f);
      break;
    case 'idle':
      if (!p) break;
      walk(f, e, p);
      if (f.t >= f.dur) {
        const m = pickMove(w, f);
        f.move = m;
        f.last = m;
        enter(f, 'cast');
        ev.push({ t: 'echoMove', id: f.id, kind: f.kind, move: m, x: e.x, y: e.y });
      }
      break;
    case 'cast': {
      if (!p || !f.move) break;
      const script = D.moves[f.move];
      if (!script || script(w, f, e, p, ev)) enter(f, 'recover', D.recover[f.move] ?? ECHO.recover);
      break;
    }
    case 'recover':
      if (f.t >= f.dur) toIdle(w, f);
      break;
    case 'dead':
      break;
  }
}

// ---------------------------------------------------------------- 危险物的推进与判定

/** 打中一个人：伤害（来源记成 echo），kb 不为 0 时从 (fx, fy) 往外推开。每个危险物对每个人只打一次（旋涡每冲刷一次重来）。 */
function hitTest(w: World, h: EchoHazard, alive: Player[], ev: SimEvent[], test: (p: Player) => boolean, fx: number, fy: number) {
  for (const p of alive) {
    const bit = 1 << p.id;
    if (h.hits & bit || !p.alive) continue;
    if (!test(p)) continue;
    h.hits |= bit;
    if (hurtPlayer(w, p, h.dmg, 'echo', ev) && h.kb > 0) {
      const d = Math.hypot(p.x - fx, p.y - fy) || 1;
      p.blowX = ((p.x - fx) / d) * h.kb;
      p.blowY = ((p.y - fy) / d) * h.kb;
    }
  }
}

/** 线段上离 (x, y) 最近的点。 */
function nearestOn(x: number, y: number, h: EchoHazard) {
  const vx = h.x1 - h.x0;
  const vy = h.y1 - h.y0;
  const t = Math.max(0, Math.min(1, ((x - h.x0) * vx + (y - h.y0) * vy) / (vx * vx + vy * vy || 1)));
  return { x: h.x0 + vx * t, y: h.y0 + vy * t };
}

function updateHazards(w: World, f: EchoFight, alive: Player[], ev: SimEvent[]) {
  for (let i = f.hazards.length - 1; i >= 0; i--) {
    const h = f.hazards[i];
    const was = h.t;
    h.t += DT;
    // 混元金斗：斗悬着的时候就把范围里的人往斗下吸（顶着吸力往外走才出得去）
    if (h.kind === 'pull' && h.t < h.warn && h.pull) {
      for (const p of alive) {
        const dx = h.x0 - p.x;
        const dy = h.y0 - p.y;
        const d = Math.hypot(dx, dy);
        if (d > h.r || d < 1) continue;
        const k = Math.min(1, d / 6); // 快到中心时不再拽过头
        p.x += (dx / d) * h.pull * k * DT;
        p.y += (dy / d) * h.pull * k * DT;
      }
    }
    if (h.t < h.warn) continue;
    if (was < h.warn) ev.push({ t: 'echoStrike', id: f.id, hazard: h.id, move: h.move, shape: h.kind, x: h.x0, y: h.y0 });
    const tl = h.t - h.warn;
    switch (h.kind) {
      case 'disk':
        if (h.tick) {
          // 旋涡：一阵阵冲刷，每一阵重新打一次
          h.next = (h.next ?? 0) - (was < h.warn ? 0 : DT);
          if (h.next > 0) break;
          h.next = h.tick;
          h.hits = 0;
        }
        hitTest(w, h, alive, ev, (p) => Math.hypot(p.x - h.x0, p.y - h.y0) <= h.r, h.x0, h.y0);
        break;
      case 'lane':
        hitTest(w, h, alive, ev, (p) => segDist(p.x, p.y, h.x0, h.y0, h.x1, h.y1) <= h.r, (h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2);
        break;
      case 'pounce': {
        // 虎影从起点跑到终点：用上一帧到这一帧扫过的那一段判定，跑得再快也不会穿过去
        const len = Math.hypot(h.x1 - h.x0, h.y1 - h.y0) || 1;
        const s = Math.min(len, (tl / Math.max(1e-6, h.live)) * len);
        h.x = h.x0 + ((h.x1 - h.x0) / len) * s;
        h.y = h.y0 + ((h.y1 - h.y0) / len) * s;
        hitTest(w, h, alive, ev, (p) => segDist(p.x, p.y, h.px, h.py, h.x, h.y) <= h.r, h.x, h.y);
        break;
      }
      case 'pull':
        hitTest(w, h, alive, ev, (p) => Math.hypot(p.x - h.x0, p.y - h.y0) <= (h.core ?? h.r), h.x0, h.y0);
        break;
    }
    if (tl >= h.live) f.hazards.splice(i, 1);
  }
}

/** 贴身的接触伤害（倒下、现身、换阶段的时候不打）。 */
function contactDamage(w: World, f: EchoFight, e: Enemy, alive: Player[], ev: SimEvent[]) {
  if (f.state === 'intro' || f.state === 'phase') return;
  const r = ENEMIES.boss.radius + PLAYER.radius;
  for (const p of alive) {
    if (!p.alive || p.iframes > 0) continue;
    if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 > r * r) continue;
    hurtPlayer(w, p, ECHO.contact * f.mul, 'echo', ev);
  }
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

/** 当首领时零星的回响兵：和普通刷怪一样刷在所有人的镜头外（让靠击杀充能的神通充得起来；同别的首领）。 */
function summon(w: World, f: EchoFight, alive: Player[], spawn: Spawn) {
  if (f.state === 'intro' || f.state === 'phase' || !alive.length) return;
  const S = ECHO.chief.summon;
  f.summonT -= DT;
  if (f.summonT > 0) return;
  f.summonT = S.every[f.phase];
  let n = 0;
  for (const e of w.enemies) if (e.kind === 'soldier') n++;
  for (let i = 0; i < Math.min(S.n, S.max - n); i++) {
    const p = alive[Math.floor(w.rng.next() * alive.length)];
    const q = spawnSpot(w, p, cameras(w, alive), ENEMIES.soldier.radius, S.out[0], S.out[1]);
    spawn('soldier', q.x, q.y);
  }
}

/** 每帧（world.step，玩家之后、敌人之前）：状态机、危险物、接触伤害；当首领时再零星刷一点回响兵。倒下的表现放完由 world 收掉（defeated）。 */
export function updateEcho(w: World, alive: Player[], ev: SimEvent[], spawn?: Spawn) {
  const f = echoOf(w);
  if (!f) return;
  if (f.wave !== w.wave) {
    drop(w, f);
    return;
  }
  f.lt = f.t;
  f.t += DT;
  if (f.state === 'dead') return;
  const e = echoEnemy(w);
  if (!e) {
    drop(w, f);
    return;
  }
  syncFloor(f, e);
  for (const h of f.hazards) {
    h.px = h.x;
    h.py = h.y;
  }
  f.moving = false;
  const p = nearest(e, alive);
  for (let guard = 0; guard < 3; guard++) {
    const s: EchoFight['state'] = f.state;
    runState(w, f, e, p, ev);
    if (f.state === s) break;
  }
  ECHOS[f.kind].tick?.(f);
  updateHazards(w, f, alive, ev);
  contactDamage(w, f, e, alive, ev);
  if (!f.guest && spawn) summon(w, f, alive, spawn);
  const c = clampIn(e.x, e.y, 14);
  e.x = c.x;
  e.y = c.y;
}

/**
 * 每帧的伤害都结算完之后（world.step 清理死敌人之前）：打到这一阶段的底线（hpFloor 卡住）就换下一个阶段（无敌一会儿），
 * 最后一个阶段打空就倒下——遭遇战发 echoDefeat、掉宝匣；当首领时清场、发 bossDeath（之后本章平定）。
 */
export function checkEcho(w: World, ev: SimEvent[]) {
  const f = echoOf(w);
  if (!f || f.state === 'dead') return;
  const e = echoEnemy(w);
  if (!e) return;
  if (f.phase < phasesOf(f)) {
    if (e.hpFloor !== undefined && e.hp <= e.hpFloor + 1e-9) {
      f.phase++;
      // 还没出手的预警取消；已经出手、还在伤人的照常走完
      f.hazards = f.hazards.filter((h) => h.t >= h.warn);
      f.tiger = null;
      f.ride = null;
      f.move = null;
      const T = f.guest ? ECHO.phaseTime : ECHO.chief.phaseTime;
      enter(f, 'phase', T);
      e.invuln = Math.max(e.invuln, T);
      syncFloor(f, e);
      if (f.guest) ev.push({ t: 'echoPhase', id: e.id, kind: f.kind, phase: f.phase, x: e.x, y: e.y });
      else ev.push({ t: 'bossPhase', id: e.id, phase: f.phase, x: e.x, y: e.y });
    }
    return;
  }
  if (e.hp > 0) return;
  // 打倒了：这一仗就算赢，危险物都散掉
  f.hazards = [];
  f.tiger = null;
  f.ride = null;
  f.move = null;
  if (f.guest) {
    // 掉一只精英宝匣（灵石已经按 kind 'boss' 掉了 40 颗，见 core.onKill），这一波照常打完
    guestDown(w, f.kind, e, f.facing, ev);
    enter(f, 'dead', ECHO.deathTime);
    return;
  }
  // 当首领：倒下的表现期间回响兵、鬼火一起散掉（不算击杀），也不再判负（world.step）
  ev.push({ t: 'bossDeath', id: e.id, kind: f.kind, x: e.x, y: e.y, facing: f.facing, chapter: f.chapter });
  f.deadAt = { x: e.x, y: e.y };
  enter(f, 'dead', ECHO.chief.deathTime);
  w.enemies = w.enemies.filter((x) => x === e);
  w.orbs = [];
  e.hp = 0;
}

// ---------------------------------------------------------------- 机器人

/** 这个危险物离 (x, y) 多深（> 0 = 落在里面，数值是离最近的安全边缘还有多远）；还没「看见」的、已经结束的是 0。 */
function depthIn(h: EchoHazard, x: number, y: number, react: number, margin: number): { d: number; fx: number; fy: number } {
  if (h.t < react || h.t - h.warn >= h.live) return { d: 0, fx: 0, fy: 0 };
  switch (h.kind) {
    case 'disk':
      return { d: h.r + margin - Math.hypot(x - h.x0, y - h.y0), fx: h.x0, fy: h.y0 };
    case 'pull': {
      // 斗扣下的那一圈最危险；吸力范围本身也要出去（不然被拽回中心）
      const dist = Math.hypot(x - h.x0, y - h.y0);
      const core = (h.core ?? h.r) + margin - dist;
      return { d: core > 0 ? core + 10 : Math.max(0, (h.r + margin - dist) * 0.25), fx: h.x0, fy: h.y0 };
    }
    case 'lane':
    case 'pounce': {
      const sx = h.kind === 'pounce' && h.t >= h.warn ? h.x : h.x0;
      const sy = h.kind === 'pounce' && h.t >= h.warn ? h.y : h.y0;
      const q = nearestOn(x, y, { ...h, x0: sx, y0: sy });
      return { d: h.r + margin - segDist(x, y, sx, sy, h.x1, h.y1), fx: q.x, fy: q.y };
    }
  }
}

/** (x, y) 有多危险（0 = 安全；口径同首领模块的 danger：落在一个危险物里算 1 再加陷得多深）。 */
export function echoDanger(w: World, x: number, y: number, react = 0, margin = 6): number {
  const f = echoOf(w);
  if (!f || f.state === 'dead') return 0;
  let s = 0;
  for (const h of f.hazards) {
    const { d } = depthIn(h, x, y, react, margin);
    if (d > 0) s += 1 + Math.min(2, d / 25);
  }
  return s;
}

/**
 * 机器人躲回响的招（botInput 的普通波那一段，加在归一化之前；量级和 bot-dodge.botEnemyDodge 一样）：
 * 站在哪个危险物里就往外让——圆往外、线往两侧（正好在线上时往场心那一侧）；陷得越深让得越急。
 */
export function echoDodge(w: World, p: Player, react: number): [number, number] {
  const f = echoOf(w);
  if (!f || f.state === 'dead' || !p.alive) return [0, 0];
  let ax = 0;
  let ay = 0;
  for (const h of f.hazards) {
    const { d, fx, fy } = depthIn(h, p.x, p.y, react, 7);
    if (d <= 0) continue;
    let dx = p.x - fx;
    let dy = p.y - fy;
    let m = Math.hypot(dx, dy);
    if (m < 0.5) {
      // 正好在中心 / 线上：往场心那一侧让
      dx = ARENA.w / 2 - p.x;
      dy = ARENA.h / 2 - p.y;
      if (h.kind === 'lane' || h.kind === 'pounce') {
        const vx = h.x1 - h.x0;
        const vy = h.y1 - h.y0;
        let s = -vy * dx + vx * dy >= 0 ? 1 : -1;
        if (ECHOS[f.kind].pickSide) {
          // 两侧哪边别的危险物少就往哪边让（连刺的上一下还亮着：别折回去）；一样就照旧往场心那一侧
          const vm = Math.hypot(vx, vy) || 1;
          const step = h.r + 10;
          const da = echoDanger(w, p.x + (-vy / vm) * step, p.y + (vx / vm) * step, react, 7);
          const db = echoDanger(w, p.x + (vy / vm) * step, p.y - (vx / vm) * step, react, 7);
          if (Math.abs(da - db) > 1e-6) s = da < db ? 1 : -1;
        }
        dx = -vy * s;
        dy = vx * s;
      }
      m = Math.hypot(dx, dy) || 1;
    }
    const k = 0.05 + 0.24 * Math.min(1, d / Math.max(8, h.r));
    ax += (dx / m) * k;
    ay += (dy / m) * k;
  }
  // 站位：别跑远（法宝够不着它，打不倒就解锁不了），也别贴着它
  const e = echoEnemy(w);
  if (e) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const B = ECHO.bot;
    if (d > B.far) {
      const k = B.pull * Math.min(1, (d - B.far) / 60);
      ax += (dx / d) * k;
      ay += (dy / d) * k;
    } else if (d < B.near) {
      const k = B.push * (1 - d / B.near);
      ax -= (dx / d) * k;
      ay -= (dy / d) * k;
    }
  }
  return [ax, ay];
}

/** 名字（横幅、血条）。 */
export const echoName = (k: EchoKind) => bossName(k);

/**
 * 包成首领模块（chapters.ts 的章节表登记进这一位所在那一章的池子）。两种打法都在上面：start 的 guest 决定状态放哪个槽。
 * 机器人：当首领时走首领战那一套（danger：危险物 + 别贴着他；prefer：离他不远不近）；来遭遇战时走普通波那一套（dodge = echoDodge）。
 */
export function echoBoss(kind: EchoKind): BossModule {
  return {
    kind,
    start: (w, ev, spawn, guest = false) => startEcho(w, kind, ev, spawn, guest),
    update: (w, alive, ev, spawn) => updateEcho(w, alive, ev, spawn),
    check: checkEcho,
    defeated(w) {
      const f = echoOf(w);
      return !!f && f.state === 'dead' && f.t >= f.dur - 1e-9;
    },
    danger(w, x, y, react = 0, margin = 6) {
      let s = echoDanger(w, x, y, react, margin);
      const f = echoOf(w);
      const e = echoEnemy(w);
      if (f && e && f.state !== 'intro') {
        const d = Math.hypot(x - e.x, y - e.y);
        if (d < 30) s += 0.4 + 0.6 * (1 - d / 30);
      }
      return s;
    },
    prefer(w, x, y) {
      const e = echoEnemy(w);
      if (!e) return 0;
      return ((Math.hypot(x - e.x, y - e.y) - ECHO.chief.prefer) / 90) ** 2 * 0.8;
    },
    dodge: echoDodge,
  };
}

/** 表现层用的姿势：由状态、招式和危险物推出来。 */
export type EchoPose = 'idle' | 'walk' | 'raise' | 'strike' | 'roar' | 'down' | 'dragon';
export function echoPose(f: EchoFight): EchoPose {
  if (f.ride !== null && f.state === 'cast') return 'dragon'; // 敖丙化龙：正沿线冲的那一趟（表现层画白龙）
  switch (f.state) {
    case 'intro':
    case 'phase':
      return 'roar';
    case 'dead':
      return 'down';
    case 'idle':
      return f.moving ? 'walk' : 'idle';
    case 'recover':
      return 'idle';
    case 'cast': {
      const h = f.hazards.find((x) => x.move === f.move);
      if (!h) return 'raise';
      return h.t < h.warn - 0.15 ? 'raise' : 'strike';
    }
  }
}

/** 摘要（测试比确定性用）。 */
export function echoDigest(w: World): string {
  const f = echoOf(w);
  const r = (v: number) => Math.round(v * 100);
  if (!f) return 'noecho';
  const parts: (string | number)[] = [f.kind, f.phase, f.state, r(f.t), f.move ?? '-', f.last ?? '-', f.facing];
  for (const h of f.hazards) parts.push(h.id, h.kind, r(h.t), r(h.x), r(h.y), h.hits);
  return parts.join(',');
}

export { at };
