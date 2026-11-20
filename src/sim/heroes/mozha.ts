// 魔化哪吒（回响化身，主五行火；第一章首领，打赢解锁。用户 11-11 确认：法宝、神通、被动都和哪吒不同）。
// 玩法一眼看得懂：低血高爆发、冲阵——气血上限低一点（catalog.HEROES.mozha.maxHp），越残越狠（被动「业火」在 passives.ts），
// 神通是无敌的一枪冲阵，专属法宝黑焰轮从脚下朝四面滚出去碾过敌群（站在敌群当中最划算）。宠物黑绫就是混天绫（pets/huntian.ts），只换了颜色。
// - 神通「火尖枪突进」（首领的同名一招反过来给玩家用）：地上先亮一道线（自动朝敌人最多的方向，首领在就先冲首领），端枪蓄力片刻，
//   然后整条冲过去——蓄力和冲的时候无敌，沿路的敌人挨一下、被往线的两边撞开、点上灼烧；冲过的那条线烧一会儿，踩上去的接着烧。
// - 黑焰轮：凡三只、灵四只（大一圈、滚得更远、烧得更久），朝四面滚出去（其中一只朝敌人最密的地方），碾到的都挨一下、点上灼烧；
//   仙品「轮回」滚到尽头掉头滚回脚下，回程再碾一遍；神品器灵「八方」一次八只，「红莲」滚到最远处炸开一朵红莲业火、烧一圈再回来。
// 轮子和这一枪的状态都挂在人物身上（Player.wheels / Player.dash，纯数据）：这一枪每帧在 updateMozha 里推进（heroes/index.ts 的 KITS），
// 轮子跟着法宝推进（weapons.updateWeapons 调 updateWheels：哪个人物身上有轮子都照常滚，测试、实验页把黑焰轮给别人也一样）。
// 射程守 config.REACH：轮子离人物不超过 REACH.max（人走开了，滚得出圈的提前掉头 / 散掉），突进的线不超过 REACH.max。
// 数值是初值（2026-11-11），最后统一调。
import { ARENA, ENEMIES, REACH, SKILL } from '../config.ts';
import { addBurn, buildGrid, enemiesWithin, hitEnemy, segDist, weaponDamage } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import { densest } from '../weapons.ts';
import type { DashCast, Enemy, FireWheel, OwnedWeapon, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

const TAU = Math.PI * 2;
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** 挑方向时一只首领算几只（首领战里先冲首领）。 */
const BOSS_WEIGHT = 6;
const bossFirst = (e: Enemy) => (e.kind === 'boss' ? BOSS_WEIGHT : 1);

/** 线段上离 (x, y) 最近的点（撞开的方向从这里量：被撞到的往线的两边飞）。 */
function nearestOn(x: number, y: number, x0: number, y0: number, x1: number, y1: number) {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy || 1)));
  return { x: x0 + vx * t, y: y0 + vy * t };
}

// ---------------------------------------------------------------- 神通「火尖枪突进」

export const TUJIN = {
  len: 130, // 冲多远（吃一点范围加成和功法「混元一气」，最多 REACH.max；碰到仙台边就截短）
  w: 11, // 线的半宽（判定再加敌人身子的一半）
  windup: 0.32, // 端枪蓄力多久（这期间站着不动、无敌）
  speed: 560, // 冲的速度（像素 / 秒）：130 像素约 0.23 秒冲完
  dmg: 1.25, // 撞到的伤害（相对 SKILL.damage；三头六臂是 1 倍）
  kb: 150, // 往线的两边撞开
  burn: 0.16, // 撞到的点上灼烧：每秒这一下的这么多倍
  burnT: 3,
  trail: { life: 2.4, tick: 0.4, w: 9, burn: 0.1, burnT: 1.2 }, // 冲过的那条线烧多久、多久结算一次、半宽、踩上去的灼烧（每秒相对这一下）
  after: 0.2, // 冲完之后再无敌多久（收枪）
};

/** 挑方向：在最近的十只（和够得着的首领）里挑一个方向，让那条线罩住最多的敌人（首领算 BOSS_WEIGHT 只；一样多就挑近的）。 */
function aimDash(w: World, p: Player, len: number, hw: number): number {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, len + 8).sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return p.facing > 0 ? 0 : Math.PI;
  const boss = near.find((e) => e.kind === 'boss');
  const pool = boss && near.indexOf(boss) >= 10 ? [...near.slice(0, 10), boss] : near.slice(0, 10);
  let best = Math.atan2(near[0].y - p.y, near[0].x - p.x);
  let bestN = -1;
  for (const c of pool) {
    const a = Math.atan2(c.y - p.y, c.x - p.x);
    const x1 = p.x + Math.cos(a) * len;
    const y1 = p.y + Math.sin(a) * len;
    let n = 0;
    for (const e of near) if (segDist(e.x, e.y, p.x, p.y, x1, y1) <= hw + ENEMIES[e.kind].radius * 0.5) n += bossFirst(e);
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  return best;
}

/** 冲到哪：沿 a 走 len，碰到仙台边（往里收 12 像素）就停——不冲进魔气里。 */
function dashEnd(p: Player, a: number, len: number): [number, number] {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const pad = ARENA.pad + 12;
  let t = len;
  if (ux > 1e-6) t = Math.min(t, (ARENA.w - pad - p.x) / ux);
  else if (ux < -1e-6) t = Math.min(t, (pad - p.x) / ux);
  if (uy > 1e-6) t = Math.min(t, (ARENA.h - pad - p.y) / uy);
  else if (uy < -1e-6) t = Math.min(t, (pad - p.y) / uy);
  t = Math.max(0, t);
  return [p.x + ux * t, p.y + uy * t];
}

/** 放火尖枪突进：定下方向和那条线，端枪蓄力（TUJIN.windup 秒后在 updateMozha 里冲出去）。 */
export function tujin(w: World, p: Player, ev: SimEvent[]) {
  const T = TUJIN;
  const len = Math.min(REACH.max, T.len * (1 + Math.min(REACH.area, p.stats.area)) * techSkillRadius(p));
  const a = aimDash(w, p, len, T.w);
  p.facing = Math.cos(a) >= 0 ? 1 : -1;
  const [x1, y1] = dashEnd(p, a, len);
  const dur = Math.max(0.05, Math.hypot(x1 - p.x, y1 - p.y) / T.speed);
  p.dash = { x0: p.x, y0: p.y, x1, y1, w: T.w, t0: w.time, windup: T.windup, dur, dmg: SKILL.damage * T.dmg * (1 + p.stats.damage), hit: [], done: false, burnUntil: 0, tick: 0, wave: w.wave };
  p.iframes = Math.max(p.iframes, T.windup + dur + T.after);
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: len, kind: 'tujin', a, dur: T.windup });
}

/** 突进的这一帧：从上一帧的位置冲到这一帧的位置，扫过的敌人各撞一次。 */
function dashStep(w: World, p: Player, d: DashCast, fx: number, fy: number, tx: number, ty: number, ev: SimEvent[]) {
  const T = TUJIN;
  buildGrid(w.enemies);
  const len = Math.hypot(tx - fx, ty - fy);
  for (const e of enemiesWithin(w, (fx + tx) / 2, (fy + ty) / 2, len / 2 + d.w + 14)) {
    if (d.hit.includes(e.id)) continue;
    if (segDist(e.x, e.y, fx, fy, tx, ty) > d.w + ENEMIES[e.kind].radius * 0.5) continue;
    d.hit.push(e.id);
    hitEnemy(w, e, { dmg: d.dmg, by: 'skill', owner: p.id, from: nearestOn(e.x, e.y, d.x0, d.y0, d.x1, d.y1), kb: T.kb, el: 'fire', burn: d.dmg * T.burn, burnT: T.burnT }, ev);
  }
}

/** 每帧：蓄力时站着不动；到点冲出去（人物沿线走，扫过的敌人挨撞）；冲完之后那条线烧一会儿。 */
function updateDash(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const d = p.dash;
  if (!d) return;
  if (d.wave !== w.wave) {
    delete p.dash;
    return;
  }
  const T = TUJIN;
  const t = w.time - d.t0;
  if (!d.done) {
    if (t < d.windup - 1e-9) {
      // 端枪蓄力：站定（这一帧走出去的那一步收回来）
      p.x = d.x0;
      p.y = d.y0;
      return;
    }
    const was = Math.max(0, (t - dt - d.windup) / d.dur);
    if (t - dt < d.windup - 1e-9) ev.push({ t: 'tujin', owner: p.id, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, w: d.w, dur: d.dur, life: T.trail.life });
    const k = Math.min(1, (t - d.windup) / d.dur);
    const fx = d.x0 + (d.x1 - d.x0) * was;
    const fy = d.y0 + (d.y1 - d.y0) * was;
    p.x = d.x0 + (d.x1 - d.x0) * k;
    p.y = d.y0 + (d.y1 - d.y0) * k;
    dashStep(w, p, d, fx, fy, p.x, p.y, ev);
    if (k >= 1) {
      d.done = true;
      d.burnUntil = w.time + T.trail.life;
      d.tick = 0;
    }
    return;
  }
  // 冲过的那条线烧着：踩在线上的敌人隔一会儿点一次灼烧
  if (w.time >= d.burnUntil) {
    delete p.dash;
    return;
  }
  d.tick -= dt;
  if (d.tick > 0) return;
  d.tick = T.trail.tick;
  const len = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, len / 2 + T.trail.w + 14))
    if (segDist(e.x, e.y, d.x0, d.y0, d.x1, d.y1) <= T.trail.w + ENEMIES[e.kind].radius * 0.5) addBurn(w, e, p.id, d.dmg * T.trail.burn, T.trail.burnT);
}

// ---------------------------------------------------------------- 专属法宝「黑焰轮」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const HEIYAN = {
  n: [0, 3, 4, 4, 4], // 一次滚出去几只（器灵「八方」8 只）
  eight: 8,
  r: [0, 8.5, 9.5, 9.5, 9.5], // 轮子的判定半径（再加敌人身子的一半）（2026-11-11 数值平衡：凡 7 → 8.5、灵起 8.5–9 → 9.5：群伤偏低、贴身的那只被几只轮子一起碾，单体偏高）
  len: [0, 112, 128, 128, 128], // 滚多远（吃范围加成，最多 REACH.max）
  speed: [0, 150, 165, 170, 175], // 滚多快（像素 / 秒）
  back: 0.75, // 回程（仙品「轮回」起）碾的伤害
  backSpeed: 1.15, // 回程比去程快多少
  burn: [0, 0.22, 0.28, 0.3, 0.3], // 碾到的点上灼烧：每秒这一下的这么多倍
  burnT: [0, 2, 2.6, 2.6, 2.6],
  kb: 45, // 顺着滚的方向推一下
  lotus: { r: 30, mul: 0.6, burn: 0.35, burnT: 3 }, // mul 0.9 → 0.6、器灵倍率 1 → 1.2（2026-11-11：红莲单体偏低两成多）； // 器灵「红莲」：炸开的半径、伤害、灼烧
  homeR: 8, // 回程滚到离脚下这么近就收回
  homeNoHit: 26, // 回程离脚下这么近就不碾了
  boss: 2.6, // 2026-11-11 2.2 → 2.6（八方打首领 −29%）； 碾到首领：朝四面滚，打首领的只有一两只，单打首领偏弱（tools/weapon-dps.ts 量过），对首领加倍
  life: 3, // 一只轮子最多滚多久（主人倒下、追不上时也收掉）
};

/** 出手（weapons.ts 的 FIRE 表调）：身边有敌人才滚（够得着的最密处定一只轮子的方向，其余均匀分开）。返回 false = 这次没出手。 */
export function fireHeiyan(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const H = HEIYAN;
  buildGrid(w.enemies);
  const t = densest(w, p, REACH.seek, 1, [], 0, bossFirst)[0];
  if (!t) return false;
  const n = wpn.spirit === 'eight' ? H.eight : H.n[wpn.tier];
  const a0 = Math.atan2(t.y - p.y, t.x - p.x);
  const len = Math.min(REACH.max, H.len[wpn.tier] * (1 + p.stats.area));
  const dmg = weaponDamage(p, wpn, p.buffs.rage);
  const ret = wpn.tier >= 3;
  p.wheels ??= [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const id = w.nextId++;
    const x = p.x + ux * 4;
    const y = p.y + uy * 2;
    const wh: FireWheel = { id, x0: x, y0: y, ux, uy, len, s: 0, t: 0, x, y, px: x, py: y, r: H.r[wpn.tier], dmg, tier: wpn.tier, back: false, ret, hit: [], wave: w.wave };
    if (wpn.spirit === 'lotus') wh.burst = false;
    p.wheels.push(wh);
    ev.push({ t: 'wheel', owner: p.id, id, x, y, ux, uy, len, r: wh.r, tier: wpn.tier, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
  }
  return true;
}

/** 一只轮子这一帧从 (fx, fy) 滚到 (wh.x, wh.y)：扫过的敌人各碾一次（去程、回程各一次）。 */
function crush(w: World, p: Player, wh: FireWheel, fx: number, fy: number, ev: SimEvent[]) {
  const H = HEIYAN;
  const len = Math.hypot(wh.x - fx, wh.y - fy);
  const ux = len > 1e-6 ? (wh.x - fx) / len : wh.ux;
  const uy = len > 1e-6 ? (wh.y - fy) / len : wh.uy;
  const base = wh.dmg * (wh.back ? H.back : 1);
  for (const e of enemiesWithin(w, (fx + wh.x) / 2, (fy + wh.y) / 2, len / 2 + wh.r + 14)) {
    if (wh.hit.includes(e.id)) continue;
    if (segDist(e.x, e.y, fx, fy, wh.x, wh.y) > wh.r + ENEMIES[e.kind].radius * 0.5) continue;
    wh.hit.push(e.id);
    const dmg = base * (e.kind === 'boss' ? H.boss : 1);
    hitEnemy(w, e, { dmg, by: 'wheel', owner: p.id, from: { x: e.x - ux * 10, y: e.y - uy * 10 }, kb: H.kb, el: 'fire', burn: dmg * H.burn[wh.tier], burnT: H.burnT[wh.tier] }, ev);
  }
}

/** 器灵「红莲」：滚到最远处炸开一朵红莲业火（半径内的都挨一下、烧一会儿）。 */
function lotus(w: World, p: Player, wh: FireWheel, ev: SimEvent[]) {
  const L = HEIYAN.lotus;
  wh.burst = true;
  ev.push({ t: 'wheelBurst', owner: p.id, id: wh.id, x: wh.x, y: wh.y, r: L.r });
  for (const e of enemiesWithin(w, wh.x, wh.y, L.r + 12)) {
    if (Math.hypot(e.x - wh.x, e.y - wh.y) > L.r + ENEMIES[e.kind].radius * 0.5) continue;
    hitEnemy(w, e, { dmg: wh.dmg * L.mul, by: 'wheel', owner: p.id, from: wh, kb: 60, el: 'fire', burn: wh.dmg * L.burn, burnT: L.burnT }, ev);
  }
}

/** 掉头：去程碾过的清掉（回程再碾一遍）。 */
function turn(p: Player, wh: FireWheel, ev: SimEvent[]) {
  wh.back = true;
  wh.hit = [];
  ev.push({ t: 'wheelTurn', owner: p.id, id: wh.id, x: wh.x, y: wh.y });
}

/** 每帧推进黑焰轮：去程沿直线滚，到尽头（或离人物超过 REACH.max）掉头 / 散掉；回程追着人物脚下滚回来。 */
export function updateWheels(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const ws = p.wheels;
  if (!ws) return;
  const H = HEIYAN;
  buildGrid(w.enemies);
  for (let i = ws.length - 1; i >= 0; i--) {
    const wh = ws[i];
    wh.px = wh.x;
    wh.py = wh.y;
    if (wh.wave !== w.wave) {
      ws.splice(i, 1);
      continue;
    }
    const sp = H.speed[wh.tier] * (wh.back ? H.backSpeed : 1);
    const fx = wh.x;
    const fy = wh.y;
    let gone = false;
    if (!wh.back) {
      wh.s = Math.min(wh.len, wh.s + sp * dt);
      wh.x = wh.x0 + wh.ux * wh.s;
      wh.y = wh.y0 + wh.uy * wh.s;
      crush(w, p, wh, fx, fy, ev);
      const far = dist2(wh, p) > REACH.max * REACH.max;
      if (wh.s >= wh.len - 1e-9 || far) {
        if (wh.burst === false) lotus(w, p, wh, ev);
        if (wh.ret) turn(p, wh, ev);
        else gone = true;
      }
    } else {
      // 回程：追着人物脚下滚回来
      const dx = p.x - wh.x;
      const dy = p.y - wh.y;
      const d = Math.hypot(dx, dy);
      if (d <= H.homeR + sp * dt) gone = true;
      else {
        wh.x += (dx / d) * sp * dt;
        wh.y += (dy / d) * sp * dt;
        wh.s = Math.max(0, wh.s - sp * dt);
        // 快收回脚下的那一段不再碾（几只轮子一起收回来，不能全砸在贴身的那一只身上）
        if (d > H.homeNoHit) crush(w, p, wh, fx, fy, ev);
      }
    }
    // 滚得太久（一直追不上主人）也收掉
    wh.t += dt;
    if (wh.t > H.life) gone = true;
    if (gone) ws.splice(i, 1);
  }
  if (!ws.length) delete p.wheels;
}

/** 每帧（heroes/index.ts 的 KITS 调）：神通的这一枪。 */
export function updateMozha(w: World, p: Player, dt: number, ev: SimEvent[]) {
  updateDash(w, p, dt, ev);
}
