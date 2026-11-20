// 东海夜叉（第一章劫二起的精英；数值在 config.ts 的 ELITES.yecha）：陈塘关九湾河里巡海夜叉的回响。
//   潜水突袭：离人物不远不近、冷却好了就沉进水里（打不着），在水下游向人物，停住后地上亮出要冒出来的那一片淡红光，然后冒出水面——
//     那一片里的人挨一下、被浪花往外震开；冒出来以后喘一口气（这时最好打）。
//   拍浪：贴近了就抬爪，地上亮出浪要推过的那一条，然后一道浪头沿线推过去，推到的人挨一下、被顺着浪推开。
// 潜在水里时（dive / under / rise）：Enemy.hidden、无敌（法宝打不着），不接触伤人，晕眩、冻结也不吃；表现层画水下游走的一圈涟漪。
// 晕眩打断拍浪的预警（同长矛兵）。被混元金斗吸走、再喷出来的，状态都在它自己身上，回到场上接着做原来那一步。
import { DT, PLAYER } from '../config.ts';
import { hurtPlayer, segDist } from '../core.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { swiftMul } from './affixes.ts';
import { ELITES } from './config.ts';

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

/** 刚刷出来（index.setupElite）：第一次潜水、拍浪的冷却。 */
export function setupYecha(e: Enemy) {
  const Y = ELITES.yecha;
  e.cd = Y.dive.first;
  e.cd2 = Y.slap.first;
}

/** 拍浪那一条的终点。 */
export function slapEnd(e: Enemy): [number, number] {
  return [(e.ox ?? e.x) + (e.aimX ?? 0) * (e.reach ?? 0), (e.oy ?? e.y) + (e.aimY ?? 0) * (e.reach ?? 0)];
}

/** 潜在水里：打不着（每帧续上一点无敌）、不吃控制（晕眩、冻结、黑虎的震慑都不吃）。 */
function submerge(e: Enemy) {
  e.hidden = true;
  e.invuln = Math.max(e.invuln, DT * 2);
  e.stun = 0;
  e.frozen = 0;
  e.fearUntil = undefined;
}

export function yecha(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const Y = ELITES.yecha;
  if (e.act === 'dive' || e.act === 'under' || e.act === 'rise') {
    submerge(e);
    e.actT = (e.actT ?? 0) - DT;
    if (e.act === 'dive') {
      if (e.actT <= 0) startAct(e, 'under', Y.dive.under);
      return [0, 0];
    }
    if (e.act === 'under') {
      // 在水下游向人物（一直跟着他），到了身边或者游够了就停住、亮出要冒出来的那一片（这一帧没有目标就原地等着）
      const dx = t ? t.x - e.x : 0;
      const dy = t ? t.y - e.y : 0;
      const d = Math.hypot(dx, dy);
      if ((t && d <= Y.dive.near) || e.actT <= 0) {
        startAct(e, 'rise', Y.dive.rise);
        e.ox = e.x;
        e.oy = e.y;
        ev.push({ t: 'yechaRise', id: e.id, x: e.x, y: e.y, r: Y.dive.r, t2: Y.dive.rise });
        return [0, 0];
      }
      if (!t || d < 1e-6) return [0, 0];
      const sp = Y.dive.speed * swiftMul(e);
      return [(dx / d) * sp, (dy / d) * sp];
    }
    // rise：停在水下等预警推满，然后冒出水面
    if (e.actT <= 0) burst(w, e, ev);
    return [0, 0];
  }
  e.hidden = undefined;
  e.cd -= DT;
  e.cd2 = (e.cd2 ?? 0) - DT;
  if (e.act === 'windup' || e.act === 'strike') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.act === 'windup') {
      if (e.stun > 0) {
        // 被打断：收爪，过一会儿再来
        startAct(e, 'rest', Y.slap.rest);
        e.cd2 = Math.max(e.cd2, Y.slap.cooldown * 0.5);
      } else if (e.actT <= 0) {
        const [x1, y1] = slapEnd(e);
        const dur = (e.reach ?? Y.slap.len) / Y.slap.speed;
        startAct(e, 'strike', dur);
        e.struck = false;
        ev.push({ t: 'yechaSlap', id: e.id, x0: e.ox!, y0: e.oy!, x1, y1, dur });
      }
      return [0, 0];
    }
    // 浪头沿线推过去：推到的人挨一下、顺着浪推开（每次出手最多打中一次）
    const k = Math.min(1, 1 - Math.max(0, e.actT) / (e.actLen || 1));
    if (!e.struck) {
      const hx = e.ox! + e.aimX! * (e.reach ?? 0) * k;
      const hy = e.oy! + e.aimY! * (e.reach ?? 0) * k;
      for (const p of alivePlayers(w)) {
        if (segDist(p.x, p.y, e.ox!, e.oy!, hx, hy) > Y.slap.width + PLAYER.radius) continue;
        if (hurtPlayer(w, p, Y.slap.dmg * e.dmgMul, 'tide', ev)) {
          e.struck = true;
          p.blowX = e.aimX! * Y.slap.push;
          p.blowY = e.aimY! * Y.slap.push;
        }
      }
    }
    if (e.actT <= 0) {
      startAct(e, 'rest', Y.slap.rest);
      e.cd2 = Y.slap.cooldown;
    }
    return [0, 0];
  }
  if (e.act === 'rest') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.actT <= 0) endAct(e);
    return [0, 0];
  }
  if (!t || e.stun > 0) return [vx, vy];
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d <= Y.slap.near && e.cd2 <= 0) {
    // 拍浪：浪从脚下朝人物推过去（定下就不跟踪）
    e.aimX = dx / d;
    e.aimY = dy / d;
    e.ox = e.x;
    e.oy = e.y;
    e.reach = Y.slap.len;
    e.struck = false;
    startAct(e, 'windup', Y.slap.warn);
    const [x1, y1] = slapEnd(e);
    ev.push({ t: 'yechaSlapWarn', id: e.id, x0: e.x, y0: e.y, x1, y1, r: Y.slap.width + PLAYER.radius, t2: Y.slap.warn });
    return [0, 0];
  }
  if (d >= Y.dive.band[0] && d <= Y.dive.band[1] && e.cd <= 0) {
    // 潜水：沉进水里（这一下就打不着了）
    startAct(e, 'dive', Y.dive.sink);
    submerge(e);
    ev.push({ t: 'yechaDive', id: e.id, x: e.x, y: e.y });
    return [0, 0];
  }
  return [vx, vy];
}

/** 冒出水面：浪花往四周炸开，那一片里的人挨一下、被往外震开。 */
function burst(w: World, e: Enemy, ev: SimEvent[]) {
  const D = ELITES.yecha.dive;
  e.hidden = undefined;
  e.invuln = 0;
  e.cd = D.cooldown;
  const x = e.ox ?? e.x;
  const y = e.oy ?? e.y;
  ev.push({ t: 'yechaBurst', id: e.id, x, y, r: D.r });
  for (const p of alivePlayers(w)) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.hypot(dx, dy);
    if (d > D.r) continue;
    const ux = d > 0.5 ? dx / d : e.id % 2 ? 1 : -1;
    const uy = d > 0.5 ? dy / d : 0;
    if (hurtPlayer(w, p, D.dmg * e.dmgMul, 'tide', ev)) {
      p.blowX = ux * D.push;
      p.blowY = uy * D.push;
    }
  }
  startAct(e, 'rest', D.rest);
}

/** 机器人躲夜叉的招（index.eliteDodge）：要冒出来的那一片（在里面就往外让），拍浪那一条（往两侧让）。量级同 bot-dodge。 */
export function yechaDodge(e: Enemy, p: Player, react: number, margin: number, base: number, pull: number, lane: LaneDodge): [number, number] {
  const Y = ELITES.yecha;
  const seen = (e.actLen ?? 0) - (e.actT ?? 0) >= react;
  if (e.act === 'rise' && seen) {
    const dx = p.x - (e.ox ?? e.x);
    const dy = p.y - (e.oy ?? e.y);
    const d = Math.hypot(dx, dy) || 1;
    const R = Y.dive.r + margin;
    if (d >= R) return [0, 0];
    const k = base + pull * (1 - d / R);
    return [(dx / d) * k, (dy / d) * k];
  }
  if ((e.act === 'windup' && seen) || e.act === 'strike') return lane(e.ox!, e.oy!, e.aimX!, e.aimY!, e.reach ?? Y.slap.len, Y.slap.width + PLAYER.radius);
  return [0, 0];
}

/** 一条直线危险（从 (x0, y0) 沿 (ux, uy) 长 len、半宽 half）的躲法：index.ts 给。 */
export type LaneDodge = (x0: number, y0: number, ux: number, uy: number, len: number, half: number) => [number, number];
