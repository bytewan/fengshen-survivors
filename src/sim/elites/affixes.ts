// 精英词缀（纯函数、确定性：随机数只用 w.rng；数值在 config.ts 的 AFFIX）。index.ts 在这几处调这里：
//   刷精英时 rollAffixes / applyAffixes（抽几条、套上）；每帧 tickAffixes（反震的蓄力、召唤的掐诀）；
//   挨打时 affixOnHit（反震：被身边的人打中就开始蓄力）；坚甲的减伤 armorMul（enemies.guardMul 里乘）；死时 affixOnDeath（分魂）。
// 词缀的动作（反震蓄力、召唤掐诀）只在精英空着的时候起手，起手后它站着不动、自己的招停一停；被晕住就打断。
// 被赵公明的黑虎震慑（吓住、往外逃）时不起手：吓住的那一下先顿一顿（晕眩），正在蓄的、正在掐的就此打断；逃的时候人不在它的「目标」里，
// 召唤不会起手，被人贴身打也不反震。迅捷的逃得也快（逃的速度按它的移速算）。
import { DT, ENEMIES, SPAWN } from '../config.ts';
import { hurtPlayer } from '../core.ts';
import { feared } from '../heroes/passives.ts';
import { inBounds } from '../spawn.ts';
import { spawnAt } from '../world.ts';
import type { DamageSpec } from '../core.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { AFFIX, AFFIXES } from './config.ts';
import type { EliteAffix } from './types.ts';

const TAU = Math.PI * 2;
const alivePlayers = (w: World) => w.players.filter((p) => p.alive);
export const hasAffix = (e: Enemy, a: EliteAffix) => !!e.affixes && e.affixes.includes(a);

/** 抽 n 条不重样的词缀（n = 0 时不碰随机数）。 */
export function rollAffixes(w: World, n: number): EliteAffix[] {
  const pool = [...AFFIXES];
  const out: EliteAffix[] = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(w.rng.next() * pool.length), 1)[0]);
  return out;
}

/** 给刚刷出来的精英套上词缀（不碰随机数）。 */
export function applyAffixes(e: Enemy, list: readonly EliteAffix[]) {
  if (!list.length) return;
  e.affixes = [...list];
  if (list.includes('swift')) e.speed *= AFFIX.swift.speed;
  if (list.includes('recoil')) e.recoilCd = 0;
  if (list.includes('summon')) e.callCd = AFFIX.summon.first;
}

/** 坚甲：受到的伤害的倍率（enemies.guardMul 里乘；被哮天犬「破甲」咬了的不吃，在 core 里已经判过）。 */
export const armorMul = (e: Enemy) => (hasAffix(e, 'armor') ? 1 - AFFIX.armor.cut : 1);

/** 迅捷：精英自己的招里的移动速度（夜叉在水下游）也乘上。 */
export const swiftMul = (e: Enemy) => (hasAffix(e, 'swift') ? AFFIX.swift.speed : 1);

/** 这一下算不算「打在身上」（反震、金光只认直接命中：灼烧、流血、地面区域这些持续伤害不算，神通另算）。 */
export const directHit = (s: DamageSpec) => s.by !== 'burn' && s.by !== 'bleed' && s.by !== 'zone' && s.by !== 'plague'; // plague：瘟癀伞的瘟（持续掉血，同灼烧、流血）

/** 精英空着（没在出招、没潜在水里、没被晕住、词缀的动作也没在做）：词缀的动作只在这时候起手。 */
const idle = (e: Enemy) => (!e.act || e.act === 'rest') && !e.hidden && e.stun <= 0 && !(e.recoilT && e.recoilT > 0) && !e.call;

/**
 * 每帧（actElite 开头）：反震的蓄力、召唤的掐诀往前走。返回 true = 这一帧它被词缀的动作占着（站着不动、自己的招停一停）。
 * t：最近的活着的人（召唤要人在附近才起手）。
 */
export function tickAffixes(w: World, e: Enemy, t: Player | null, ev: SimEvent[]): boolean {
  if (!e.affixes) return false;
  let busy = false;
  // 反震：蓄力，到时震开；被晕住、潜进水里就打断
  if (e.recoilCd && e.recoilCd > 0) e.recoilCd = Math.max(0, e.recoilCd - DT);
  if (e.recoilT && e.recoilT > 0) {
    if (e.stun > 0 || e.hidden) {
      e.recoilT = 0;
      e.recoilCd = AFFIX.recoil.cooldown * 0.5;
    } else {
      e.recoilT = Math.max(0, e.recoilT - DT);
      busy = true;
      if (e.recoilT <= 0) recoil(w, e, ev);
    }
  }
  // 召唤：掐诀，到时从符印里冒出回响兵；被晕住就打断
  if (e.call) {
    // 被晕住、潜进水里、被挪开了（混元金斗吸走又喷到别处）就打断：符印还留在原地，兵不会从离它很远的地方冒出来
    const [cx, cy] = e.call.pts[0] ?? [e.x, e.y];
    if (e.stun > 0 || e.hidden || (cx - e.x) ** 2 + (cy - e.y) ** 2 > (AFFIX.summon.gap * 2.5) ** 2) {
      e.call = undefined;
      e.callCd = 2;
    } else {
      e.call.t -= DT;
      busy = true;
      if (e.call.t <= 0) summon(w, e, ev);
    }
  } else if (hasAffix(e, 'summon')) {
    if (e.callCd && e.callCd > 0) e.callCd = Math.max(0, e.callCd - DT);
    if (!e.callCd && t && !busy && idle(e) && (t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= AFFIX.summon.range ** 2 && room(w, e) > 0) startCall(w, e, ev);
  }
  return busy;
}

/** 反震震开：r 以内的人挨一下、被往外震开。 */
function recoil(w: World, e: Enemy, ev: SimEvent[]) {
  const R = AFFIX.recoil;
  e.recoilCd = R.cooldown;
  ev.push({ t: 'recoil', id: e.id, x: e.x, y: e.y, r: R.r });
  for (const p of alivePlayers(w)) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > R.r) continue;
    const ux = d > 0.5 ? dx / d : e.id % 2 ? 1 : -1;
    const uy = d > 0.5 ? dy / d : 0;
    if (hurtPlayer(w, p, R.dmg * e.dmgMul, 'recoil', ev)) {
      p.blowX = ux * R.push;
      p.blowY = uy * R.push;
    }
  }
}

/** 它召出来、还活着的还能再召几只（场上太满了也不召）。 */
function room(w: World, e: Enemy): number {
  if (w.enemies.length >= SPAWN.maxEnemies - AFFIX.summon.n) return 0;
  const alive = new Set<number>();
  for (const o of w.enemies) if (o.hp > 0) alive.add(o.id);
  e.minions = (e.minions ?? []).filter((id) => alive.has(id));
  return AFFIX.summon.max - e.minions.length;
}

/** 掐诀：身边两处（左右各一，离它 gap）亮出符印；出了界的那一处挪到它身后。 */
function startCall(w: World, e: Enemy, ev: SimEvent[]) {
  const S = AFFIX.summon;
  const r = ENEMIES.soldier.radius;
  const pts: [number, number][] = [];
  const cand: [number, number][] = [
    [e.x - S.gap, e.y + 3],
    [e.x + S.gap, e.y + 3],
    [e.x, e.y - S.gap * 0.7],
    [e.x, e.y + S.gap * 0.7],
  ];
  for (const [x, y] of cand) if (pts.length < S.n && inBounds(w, x, y, r)) pts.push([x, y]);
  while (pts.length < S.n) pts.push([e.x, e.y]);
  e.call = { t: S.warn, len: S.warn, pts };
  ev.push({ t: 'eliteCallWarn', id: e.id, pts: pts.map(([x, y]) => [x, y] as [number, number]), t2: S.warn });
}

/** 从符印里冒出回响兵（刚冒出来愣一下）。 */
function summon(w: World, e: Enemy, ev: SimEvent[]) {
  const S = AFFIX.summon;
  const call = e.call!;
  e.call = undefined;
  e.callCd = S.every;
  const n = Math.min(call.pts.length, Math.max(0, room(w, e)));
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = call.pts[i];
    const s = spawnAt(w, 'soldier', x, y, ev);
    s.stun = S.daze;
    ids.push(s.id);
  }
  e.minions = [...(e.minions ?? []), ...ids];
  ev.push({ t: 'eliteCall', id: e.id, ids });
}

/**
 * 挨打的那一下（core.hitEnemy 里，结算伤害之前；index.eliteHit 调）：反震 —— 被离它 near 以内的人直接打中、冷却好了、它空着，就开始蓄力。
 */
export function affixOnHit(w: World, e: Enemy, s: DamageSpec, ev: SimEvent[]) {
  if (!hasAffix(e, 'recoil') || (e.recoilCd ?? 0) > 0 || !idle(e) || !directHit(s) || s.by === 'skill' || feared(w, e)) return;
  const p = w.players[s.owner];
  if (!p || !p.alive || (p.x - e.x) ** 2 + (p.y - e.y) ** 2 > AFFIX.recoil.near ** 2) return;
  e.recoilT = AFFIX.recoil.warn;
  ev.push({ t: 'recoilWarn', id: e.id, x: e.x, y: e.y, r: AFFIX.recoil.r, t2: AFFIX.recoil.warn });
}

/** 精英死时（enemies.onFoeKilled → index.eliteKilled）：分魂 —— 分出几只离魂，从倒下的地方往外弹开。 */
export function affixOnDeath(w: World, e: Enemy, ev: SimEvent[]) {
  if (!hasAffix(e, 'split')) return;
  const S = AFFIX.split;
  const a0 = w.rng.next() * TAU;
  const ids: number[] = [];
  for (let i = 0; i < S.n; i++) {
    const a = a0 + (i / S.n) * TAU;
    const x = e.x + Math.cos(a) * S.gap;
    const y = e.y + Math.sin(a) * S.gap * 0.7;
    const c = spawnAt(w, 'splitling', x, y, ev);
    c.hp = c.maxHp = Math.max(1, Math.round(c.maxHp * S.hp));
    c.kx = Math.cos(a) * S.kick;
    c.ky = Math.sin(a) * S.kick * 0.7;
    c.stun = 0.25; // 刚分出来愣一下
    ids.push(c.id);
  }
  ev.push({ t: 'affixSplit', id: e.id, x: e.x, y: e.y, ids });
}

/** 机器人：反震蓄力那一圈（以精英为圆心）——站在里面就往外让。量级同 bot-dodge。 */
export function affixDodge(w: World, p: Player, react: number, margin: number, base: number, pull: number): [number, number] {
  let ax = 0;
  let ay = 0;
  const R = AFFIX.recoil.r + margin;
  for (const e of w.enemies) {
    if (e.hp <= 0 || !e.recoilT || e.recoilT <= 0 || AFFIX.recoil.warn - e.recoilT < react) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d >= R) continue;
    const k = base + pull * (1 - d / R);
    ax += (dx / d) * k;
    ay += (dy / d) * k;
  }
  return [ax, ay];
}

