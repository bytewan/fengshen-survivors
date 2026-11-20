// 第三章三种新敌人的行为（纯函数、确定性：随机数只用 w.rng；数值在 config.ts 的 FOES3）。enemies.ts 的 actEnemy 按种类分派到这里。
//   飞剑灵 flysword：悬空的小飞剑（画面上三柄排成一列，头一柄是本体），绕在人物身边；瞄准后地上亮出射来的直线（预警），
//     沿线射过去，射空了减速、掉头，再来；晕眩打断瞄准。
//   截教门徒 disciple：远程，站得比鬼火术士近一些，抬手后掷出一道慢速的剑气（w.orbs 里 kind 'qi' 的弹道）：
//     起手偏开人物一点，前一秒多慢慢拐向人物，之后直飞——能躲（法宝打不散它，同鬼火）。
//   阵图傀儡 puppet：两只一组（刷出来一只，第一帧在它身边补上另一只），之间连一条剑气线，两只一起挪、线横着压过来；
//     线扫到人就伤人，打掉其中一只线就断，剩下的那只照常走过来。
// 状态都放在敌人身上（act / actT / aimX … 和 Enemy.mate、tetherT），弹道放在 w.orbs，表现层只读它们、再配上 Ch3FoeEvent。
import { DT, PLAYER } from '../config.ts';
import { hurtPlayer, segDist } from '../core.ts';
import { range } from '../rng.ts';
import { cameras } from '../coop.ts';
import { outOfView, inBounds } from '../spawn.ts';
import { spawnAt } from '../world.ts';
import { fasterOrb, jieShot } from '../jie.ts';
import type { Enemy, Orb, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { FOES3 } from './config.ts';

const TAU = Math.PI * 2;
const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const alivePlayers = (w: World) => w.players.filter((p) => p.alive);
const startAct = (e: Enemy, act: NonNullable<Enemy['act']>, t: number) => {
  e.act = act;
  e.actT = t;
  e.actLen = t;
};
const endAct = (e: Enemy) => {
  e.act = undefined;
  e.actT = 0;
  e.actLen = 0;
};
const findEnemy = (w: World, id: number) => {
  for (const e of w.enemies) if (e.id === id) return e;
  return null;
};

/** 射出去那条线的终点。 */
export function flyEnd(e: Enemy): [number, number] {
  return [(e.ox ?? e.x) + (e.aimX ?? 0) * (e.reach ?? 0), (e.oy ?? e.y) + (e.aimY ?? 0) * (e.reach ?? 0)];
}

// ---------------------------------------------------------------- 飞剑灵

/** 飞剑灵：绕在 keep 那一圈上；冷却好了、离人物在 band 以内就瞄准（定下线就不跟踪），射过去，射空了掉头。e.face 是剑尖的朝向（表现层转精灵）。 */
export function flysword(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const F = FOES3.flysword;
  const speed = F.speed * jieShot(w); // 劫四起射得快（jie.ts；劫一到三是 1；预警的时长不变）
  e.cd -= DT;
  if (e.act === 'windup' || e.act === 'strike') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.stun > 0) {
      // 被打断：晃一下，过一会儿再来
      startAct(e, 'rest', F.turn * 0.6);
      e.cd = Math.max(e.cd, F.cooldown * 0.5);
      return [0, 0];
    }
    if (e.act === 'windup') {
      e.face = Math.atan2(e.aimY!, e.aimX!);
      if (e.actT <= 0) {
        const [x1, y1] = flyEnd(e);
        const dur = e.reach! / speed;
        startAct(e, 'strike', dur + 0.2); // 多给一点，被挤歪了也射得完
        ev.push({ t: 'flyShot', id: e.id, x0: e.ox!, y0: e.oy!, x1, y1, dur });
      }
      return [0, 0];
    }
    // 射：沿线飞到尽头（按沿线走了多远算）或超时就掉头
    const prog = (e.x - e.ox!) * e.aimX! + (e.y - e.oy!) * e.aimY!;
    if (prog >= e.reach! || e.actT <= 0) {
      startAct(e, 'rest', F.turn);
      e.cd = F.cooldown;
      return [e.aimX! * speed * 0.6, e.aimY! * speed * 0.6];
    }
    const off = (e.x - e.ox!) * -e.aimY! + (e.y - e.oy!) * e.aimX!;
    const v: [number, number] = [e.aimX! * speed + e.aimY! * off * 6, e.aimY! * speed - e.aimX! * off * 6];
    if (!e.struck) {
      const r = F.width + PLAYER.radius;
      for (const p of alivePlayers(w)) {
        if (segDist(p.x, p.y, e.x, e.y, e.x + v[0] * DT, e.y + v[1] * DT) > r) continue;
        if (hurtPlayer(w, p, F.dmg * e.dmgMul, 'flysword', ev)) e.struck = true;
      }
    }
    return v;
  }
  if (e.act === 'rest') {
    // 掉头：顺着冲出去的方向慢下来，剑尖绕半圈转回来
    e.actT = (e.actT ?? 0) - DT;
    const len = e.actLen || 1;
    const k = clamp(1 - Math.max(0, e.actT) / len, 0, 1);
    const base = e.aimX !== undefined ? Math.atan2(e.aimY!, e.aimX) : (e.face ?? 0);
    const h = base + Math.PI * smooth(k) * (e.id % 2 ? 1 : -1);
    e.face = wrapAngle(h);
    const sp = speed * 0.6 * (1 - k) * (1 - e.slow);
    if (e.actT <= 0) endAct(e);
    return [Math.cos(h) * sp, Math.sin(h) * sp];
  }
  if (!t || e.stun > 0) return [vx, vy];
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d >= F.band[0] && d <= F.band[1] && e.cd <= 0) {
    // 瞄准：线穿过人物当时的位置再延伸 over，夹在 len 之间
    e.aimX = dx / d;
    e.aimY = dy / d;
    e.ox = e.x;
    e.oy = e.y;
    e.reach = clamp(d + F.over, F.len[0], F.len[1]);
    e.struck = false;
    e.face = Math.atan2(dy, dx);
    startAct(e, 'windup', F.warn);
    const [x1, y1] = flyEnd(e);
    ev.push({ t: 'flyAim', id: e.id, x0: e.ox, y0: e.oy, x1, y1, r: F.width + PLAYER.radius, t2: F.warn });
    return [0, 0];
  }
  // 平时：在 keep 那一圈上横着绕（太近退、太远靠），剑尖朝着飞的方向
  const spd = Math.hypot(vx, vy);
  const side = e.id % 2 ? 1 : -1;
  const k2 = d < F.keep[0] ? -1 : d > F.keep[1] ? 1 : 0;
  const mx = ((dx / d) * k2 - (dy / d) * side * 0.7) * spd;
  const my = ((dy / d) * k2 + (dx / d) * side * 0.7) * spd;
  if (Math.abs(mx) + Math.abs(my) > 0.5) {
    const want = Math.atan2(my, mx);
    const cur = e.face ?? want;
    e.face = wrapAngle(cur + clamp(wrapAngle(want - cur), -4 * DT, 4 * DT));
  }
  return [mx, my];
}

// ---------------------------------------------------------------- 截教门徒

/** 截教门徒：站在 keep 那一圈上横着挪；冷却好了、人在 range 以内就抬手（windup 秒），然后掷出一道会拐弯的剑气。晕眩打断抬手。 */
export function disciple(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const D = FOES3.disciple;
  e.cd -= DT;
  if (e.act === 'windup') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.stun > 0) {
      endAct(e);
      e.cd = Math.max(e.cd, 1);
      return [0, 0];
    }
    if (e.actT <= 0) {
      if (t) throwQi(w, e, t, ev);
      endAct(e);
      e.cd = range(w.rng, D.cooldown[0], D.cooldown[1]);
    }
    return [0, 0];
  }
  if (!t || e.stun > 0) return [vx, vy];
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  if (e.cd <= 0 && d < D.range) {
    startAct(e, 'windup', D.windup);
    ev.push({ t: 'qiCast', id: e.id, x: e.x, y: e.y, t2: D.windup });
    return [0, 0];
  }
  const spd = Math.hypot(vx, vy);
  const side = e.id % 2 ? 1 : -1;
  const k2 = d < D.keep[0] ? -1 : d > D.keep[1] ? 1 : 0;
  return [((dx / d) * k2 - (dy / d) * side * 0.6) * spd, ((dy / d) * k2 + (dx / d) * side * 0.6) * spd];
}

/** 掷出剑气：从手边出手，起手偏开人物 spread 弧度（往哪边偏随机），之后慢慢拐向人物。 */
function throwQi(w: World, e: Enemy, t: Player, ev: SimEvent[]) {
  const D = FOES3.disciple;
  const sx = e.x + (t.x >= e.x ? 5 : -5);
  const sy = e.y - 13;
  const base = Math.atan2(t.y - 8 - sy, t.x - sx);
  const sg = w.rng.next() < 0.5 ? -1 : 1;
  const a = base + sg * D.spread;
  const o: Orb = { id: w.nextId++, x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a) * D.speed, vy: Math.sin(a) * D.speed, life: D.life, dmg: D.dmg * e.dmgMul, kind: 'qi', bend: D.bend, turn: D.turn, to: t.id, by: 'qi' };
  w.orbs.push(o);
  fasterOrb(w, o); // 劫四起剑气飞得快（jie.ts，同鬼火；拐弯时速度不变，见 steerOrb）
  ev.push({ t: 'qiThrow', id: e.id, orb: o.id, x: sx, y: sy });
}

/** 会拐弯的剑气（world.step 的弹道循环里、挪动之前调）：还在拐的那一段里，按 turn 弧度 / 秒拐向它瞄着的人，速度不变。 */
export function steerOrb(w: World, o: Orb) {
  if (!o.bend || o.bend <= 0) return;
  o.bend = Math.max(0, o.bend - DT);
  const p = w.players[o.to ?? -1];
  if (!p || !p.alive) {
    o.bend = 0;
    return;
  }
  const cur = Math.atan2(o.vy, o.vx);
  const want = Math.atan2(p.y - 8 - o.y, p.x - o.x);
  const turn = (o.turn ?? 0) * DT;
  const na = cur + clamp(wrapAngle(want - cur), -turn, turn);
  const sp = Math.hypot(o.vx, o.vy);
  o.vx = Math.cos(na) * sp;
  o.vy = Math.sin(na) * sp;
}

// ---------------------------------------------------------------- 阵图傀儡

/** 刚刷出来的傀儡在身边补上另一只：挑一个谁的屏幕里都看不见的位置（侧面优先，再往外），实在没有就挑最不显眼的那个。 */
function pairUp(w: World, e: Enemy, ev: SimEvent[]) {
  const P = FOES3.puppet;
  e.mate = -1;
  const alive = alivePlayers(w);
  let ux = 1;
  let uy = 0;
  if (alive.length) {
    let best = alive[0];
    for (const p of alive) if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < (best.x - e.x) ** 2 + (best.y - e.y) ** 2) best = p;
    const d = Math.hypot(e.x - best.x, e.y - best.y) || 1;
    ux = (e.x - best.x) / d;
    uy = (e.y - best.y) / d;
  }
  const g = P.gap;
  const cands: [number, number][] = [
    [e.x - uy * g, e.y + ux * g],
    [e.x + uy * g, e.y - ux * g],
    [e.x - uy * g * 0.7 + ux * g * 0.7, e.y + ux * g * 0.7 + uy * g * 0.7],
    [e.x + uy * g * 0.7 + ux * g * 0.7, e.y - ux * g * 0.7 + uy * g * 0.7],
    [e.x + ux * g, e.y + uy * g],
  ];
  const cams = cameras(w, alive);
  const r = 7;
  let pick = cands[0];
  let ps = -Infinity;
  for (const [x, y] of cands) {
    if (!inBounds(w, x, y, r)) continue;
    let s = Infinity;
    for (const q of cams) s = Math.min(s, outOfView(q, x, y));
    if (s > 0) {
      pick = [x, y];
      ps = s;
      break;
    }
    if (s > ps) {
      ps = s;
      pick = [x, y];
    }
  }
  const m = spawnAt(w, 'puppet', pick[0], pick[1], ev);
  m.speed = e.speed;
  m.mate = e.id;
  e.mate = m.id;
  ev.push({ t: 'tetherOn', a: Math.min(e.id, m.id), b: Math.max(e.id, m.id) });
}

/** 阵图傀儡：两只一组；中点朝人物挪，两只的连线保持横在人物面前（和「中点 → 人物」垂直），剑气线碰到人就伤人。 */
export function puppet(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const P = FOES3.puppet;
  if (e.mate === undefined) pairUp(w, e, ev);
  let m: Enemy | null = null;
  if (e.mate !== undefined && e.mate >= 0) {
    m = findEnemy(w, e.mate);
    if (!m || m.hp <= 0) {
      // 另一只被打掉了：线断（只剩这一只会走到这里，报一次）
      ev.push({ t: 'tetherCut', a: Math.min(e.id, e.mate), b: Math.max(e.id, e.mate), x0: e.x, y0: e.y, x1: m?.x ?? e.x, y1: m?.y ?? e.y });
      e.mate = -1;
      m = null;
    }
  }
  if (m && e.id < m.id) tetherHit(w, e, m, ev);
  if (!m) return [vx, vy];
  if (!t || e.stun > 0) return [0, 0];
  const cx = (e.x + m.x) / 2;
  const cy = (e.y + m.y) / 2;
  const dx = t.x - cx;
  const dy = t.y - cy;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const s = e.id < m.id ? 1 : -1;
  const slotX = cx - uy * s * (P.gap / 2);
  const slotY = cy + ux * s * (P.gap / 2);
  const sp = Math.hypot(vx, vy);
  return [ux * sp + (slotX - e.x) * P.pull, uy * sp + (slotY - e.y) * P.pull];
}

/** 剑气线碰到人（离线 r + 人物半径以内）：伤人；同一组隔 rehit 秒才再打中（计时记在编号小的那只身上）。 */
function tetherHit(w: World, a: Enemy, b: Enemy, ev: SimEvent[]) {
  const P = FOES3.puppet;
  if (w.time - (a.tetherT ?? -1e9) < P.rehit) return;
  for (const p of alivePlayers(w)) {
    if (segDist(p.x, p.y, a.x, a.y, b.x, b.y) > P.r + PLAYER.radius) continue;
    if (hurtPlayer(w, p, P.dmg * a.dmgMul, 'tether', ev)) {
      a.tetherT = w.time;
      break;
    }
  }
}

/** 一组傀儡（编号小的那只、另一只）。表现层、机器人用。 */
export function tetherPairs(w: World): [Enemy, Enemy][] {
  const out: [Enemy, Enemy][] = [];
  for (const e of w.enemies) {
    if (e.kind !== 'puppet' || e.hp <= 0 || e.mate === undefined || e.mate < 0) continue;
    const m = findEnemy(w, e.mate);
    if (m && m.hp > 0 && e.id < m.id) out.push([e, m]);
  }
  return out;
}

/**
 * 机器人躲第三章的敌人（bot-dodge.botEnemyDodge 里加上）：阵图傀儡的剑气线——离线太近就往远离线的那一侧让
 * （人在哪一侧往哪一侧）；飞剑灵的瞄准线在 bot-dodge 的直线那一段里一起躲。量级同 botEnemyDodge。
 */
export function ch3Dodge(w: World, p: Player, margin: number, base: number, pull: number): [number, number] {
  let ax = 0;
  let ay = 0;
  const half = FOES3.puppet.r + PLAYER.radius + margin + 4;
  for (const [a, b] of tetherPairs(w)) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const L = Math.hypot(vx, vy) || 1;
    const ux = vx / L;
    const uy = vy / L;
    const rx = p.x - a.x;
    const ry = p.y - a.y;
    const along = rx * ux + ry * uy;
    if (along < -half || along > L + half) continue;
    const side = -rx * uy + ry * ux;
    if (Math.abs(side) > half) continue;
    // 往线的两侧让（出这条带子要走 half − |side|），或者绕过线的一头（要走到端点外 half）——哪个近走哪个
    const perp = half - Math.abs(side);
    const end = Math.min(along + half, L - along + half);
    const k = base + pull * (1 - Math.abs(side) / half);
    if (end < perp) {
      const sg = along < L / 2 ? -1 : 1;
      ax += ux * sg * k;
      ay += uy * sg * k;
    } else {
      const sg = Math.abs(side) > 0.5 ? Math.sign(side) : 1;
      ax += -uy * sg * k;
      ay += ux * sg * k;
    }
  }
  return [ax, ay];
}
