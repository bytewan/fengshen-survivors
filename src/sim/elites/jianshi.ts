// 截教剑侍（第三章的精英；数值在 config.ts 的 ELITES.jianshi）：诛仙阵里侍剑的截教弟子，身边绕着三柄小剑。
//   站在离人物不远不近的那一圈上横着挪（同截教门徒）；人在够得着的地方、冷却好了，就让下一柄小剑停下、剑尖指向人物
//   （地上亮出它要射过的那条直线，淡红光），然后射出去；三柄轮流射，射完了过一会儿重新聚齐。
// 绕身的小剑：Enemy.blades（还绕着几柄）、spin（转到的角度；晕眩、冻住时不转）、reload（三柄都射出去以后还要多久聚齐）。
// 射出去的那一柄是 w.orbs 里 kind 'blade' 的弹道（直线飞，法宝打不散，同鬼火；劫四起飞得快，同鬼火）。表现层按同样的算法画绕身的剑。
import { DT, PLAYER } from '../config.ts';
import { fasterOrb } from '../jie.ts';
import type { Enemy, Orb, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { ELITES } from './config.ts';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const endAct = (e: Enemy) => {
  e.act = undefined;
  e.actT = 0;
  e.actLen = 0;
};

/** 刚刷出来（index.setupElite）：三柄剑齐、第一剑的冷却。 */
export function setupJianshi(e: Enemy) {
  e.blades = 3;
  e.spin = (e.id * 1.7) % TAU;
  e.reload = 0;
  e.cd = ELITES.jianshi.shot.first;
}

/** 第 k 柄（0..2）绕身的小剑此刻在地上的哪一点（脚下的投影；画的时候再往上抬 orbit.h）。spin 给了就按它算（表现层插值用）。 */
export function bladeSpot(e: Enemy, k: number, spin = e.spin ?? 0): [number, number] {
  const O = ELITES.jianshi.orbit;
  const a = spin + (k * TAU) / 3;
  return [e.x + Math.cos(a) * O.r, e.y + Math.sin(a) * O.ry];
}

/** 下一柄要射的是第几柄（按 0、1、2 的顺序；还绕着 blades 柄）。 */
export const nextBlade = (e: Enemy) => 3 - (e.blades ?? 0);

/** 三柄剑绕身转（每帧，index.actElite 在词缀的动作之前调：剑侍站着掐诀、蓄力时剑照样转）；晕眩、冻住时不转。 */
export function spinBlades(e: Enemy) {
  if (e.stun <= 0) e.spin = ((e.spin ?? 0) + ELITES.jianshi.orbit.spin * DT) % TAU;
}

export function jianshi(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const J = ELITES.jianshi;
  const S = J.shot;
  e.cd -= DT;
  if ((e.blades ?? 0) <= 0 && e.reload !== undefined && e.reload > 0) {
    e.reload = Math.max(0, e.reload - DT);
    if (e.reload <= 0) {
      e.blades = 3;
      e.cd = Math.max(e.cd, S.gap * 0.6); // 聚齐了先缓一口气再射
      ev.push({ t: 'bladeReform', id: e.id, x: e.x, y: e.y });
    }
  }
  if (e.act === 'windup') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.stun > 0) {
      // 被打断：这一柄回到身边，过一会儿再来
      endAct(e);
      e.cd = Math.max(e.cd, 0.8);
      return [0, 0];
    }
    if (e.actT <= 0) {
      shoot(w, e, ev);
      endAct(e);
      e.cd = S.gap;
    }
    return [0, 0];
  }
  if (!t || e.stun > 0) return [vx, vy];
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  if (e.cd <= 0 && (e.blades ?? 0) > 0 && d < S.range) {
    // 下一柄停下、指向人物：线从剑下面的地上穿过人物当时的位置再延伸 over（定下就不跟踪）
    const k = nextBlade(e);
    const [gx, gy] = bladeSpot(e, k);
    const ax = t.x - gx;
    const ay = t.y - gy;
    const ad = Math.hypot(ax, ay) || 1;
    e.aimX = ax / ad;
    e.aimY = ay / ad;
    e.ox = gx;
    e.oy = gy;
    e.reach = clamp(ad + S.over, S.len[0], S.len[1]);
    e.act = 'windup';
    e.actT = e.actLen = S.warn;
    ev.push({ t: 'bladeAim', id: e.id, k, x0: gx, y0: gy, x1: gx + e.aimX * e.reach, y1: gy + e.aimY * e.reach, r: S.r + PLAYER.radius, t2: S.warn });
    return [0, 0];
  }
  // 平时：在 keep 那一圈上横着挪（太近退、太远靠）
  const spd = Math.hypot(vx, vy);
  const side = e.id % 2 ? 1 : -1;
  const k2 = d < J.keep[0] ? -1 : d > J.keep[1] ? 1 : 0;
  return [((dx / d) * k2 - (dy / d) * side * 0.6) * spd, ((dy / d) * k2 + (dx / d) * side * 0.6) * spd];
}

/** 射出这一柄：弹道在胸口高度（同鬼火：判定比人物脚下高 8 像素），沿定下的线直飞。 */
function shoot(w: World, e: Enemy, ev: SimEvent[]) {
  const S = ELITES.jianshi.shot;
  const k = nextBlade(e);
  const x0 = e.ox!;
  const y0 = e.oy!;
  const o: Orb = { id: w.nextId++, x: x0, y: y0 - 8, px: x0, py: y0 - 8, vx: e.aimX! * S.speed, vy: e.aimY! * S.speed, life: 0, dmg: S.dmg * e.dmgMul, kind: 'blade', by: 'blade' };
  fasterOrb(w, o); // 劫四起飞得快（jie.ts，同鬼火；预警的时长不变）
  const sp = Math.hypot(o.vx, o.vy);
  o.life = (e.reach ?? S.len[0]) / sp;
  w.orbs.push(o);
  e.blades = Math.max(0, (e.blades ?? 0) - 1);
  if (!e.blades) e.reload = S.reload;
  ev.push({ t: 'bladeShot', id: e.id, k, orb: o.id, x0, y0, x1: x0 + e.aimX! * (e.reach ?? 0), y1: y0 + e.aimY! * (e.reach ?? 0), dur: o.life });
}

/** 机器人躲剑侍的剑（index.eliteDodge）：抬剑时那一条线（往两侧让）；飞出去的剑由 bot.dodgeOrbs 躲（同鬼火）。 */
export function jianshiDodge(e: Enemy, react: number, lane: (x0: number, y0: number, ux: number, uy: number, len: number, half: number) => [number, number]): [number, number] {
  if (e.act !== 'windup' || (e.actLen ?? 0) - (e.actT ?? 0) < react || e.ox === undefined || e.aimX === undefined) return [0, 0];
  return lane(e.ox, e.oy!, e.aimX, e.aimY!, e.reach ?? 0, ELITES.jianshi.shot.r + PLAYER.radius);
}
