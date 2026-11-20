// 回响敖丙（回响化身，主五行水；第一章首领池里的敖丙，当首领或来第 4 波的遭遇战，打倒解锁）。他不是谁的换色：法宝、神通、被动、宠物都是自己的。
// 玩法一眼看得懂：游龙穿群、化龙冲阵、别挨打——
// - 专属法宝「游龙戟」：戟尖放出一条冰龙，朝敌人最密处游过去，咬到一只就拐向下一只（没咬过的里离龙头最近的），一共咬几口；
//   咬到的挨一下、走得慢，溅开的冰碴让它身边的也挨一下。场上只剩咬过的（打首领）就穿过去、绕回来再咬——所以打一群和打一只的输出差不多。
//   灵品多咬两口、游得快；仙品「凝冰」游到尽头炸开一片冰（伤害、冻住）；神品器灵「双龙」一次两条，「回澜」游完掉头游回主人身边、回程路上的再咬一遍。
// - 神通「化龙」：化成一条白龙几秒——照常听摇杆、游得快、不受伤，身子扫过的敌人隔一会儿挨一下、被撞开、第一下冻住片刻；
//   变回来的那一下落地掀一圈浪（伤害、推开、冻住）。首领那一招（化成白龙沿线冲）反过来给玩家自己开。
// - 被动「龙鳞」（passives.ts）：气血越满伤害越高。和魔化哪吒的「业火」正相反。
// - 宠物避水兽（pets/bishui.ts）：把敌群推开、打湿，水行的伤害打上去就冻住。
// 龙和化龙的状态都挂在人物身上（Player.loongs / Player.hualong，纯数据）：龙跟着法宝推进（weapons.updateWeapons 调 updateLoongs），
// 化龙每帧在 updateHuiao 里推进（heroes/index.ts 的 KITS）。射程守 config.REACH：龙只咬离主人 REACH.max 以内的，游出去太远就散。
// 数值是初值（2026-11-11），最后统一调。
import { ENEMIES, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, slowEnemy, weaponDamage } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import { densest } from '../weapons.ts';
import type { Enemy, LoongCast, OwnedWeapon, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { LONGLIN_SPEED } from './passives.ts';

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
/** 挑第一口时一只首领算几只（首领战里先咬首领）。 */
const bossFirst = (e: Enemy) => (e.kind === 'boss' ? 6 : 1);

// ---------------------------------------------------------------- 专属法宝「游龙戟」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const YOULONG = {
  bites: [0, 4, 6, 6, 6], // 一条龙咬几口
  speed: [0, 215, 245, 250, 250], // 游多快（像素 / 秒）
  turn: 9, // 转弯的角速度（弧度 / 秒；离目标近了转得更急，不会绕着它打转）
  hop: 80, // 下一口：离龙头这么远以内、没咬过的里最近的
  biteR: 6, // 龙头离敌人这么近（再加敌人身子的一半）就咬上
  cool: 0.14, // 咬完这么久之内不再咬（穿过去）
  kb: 30,
  splash: { r: [0, 17, 21, 23, 27], mul: [0, 0.7, 0.75, 0.9, 1] }, // 2026-11-11 数值平衡：r 灵 / 仙 / 神 20 / 22 / 23 → 21 / 23 / 27（神品两个器灵群伤 −19% / −23% → −8% / −12%）； // 咬一口溅开的冰碴：被咬的那只身边这么远以内的也挨一下（群伤靠它）
  slow: 0.3, // 咬到的走得慢
  slowT: 1.6,
  burst: { r: 30, mul: 0.9, freeze: 1 }, // 仙品「凝冰」：尽头炸开的半径（吃一半范围加成）、伤害、冻多久
  ebb: 1, // 器灵「回澜」：回程咬的伤害
  home: 10, // 回程游到离主人这么近就收
  life: 4.5, // 一条龙最多游多久
  boss: 1.0, // 2026-11-11 数值平衡 1.25 → 1（凡 / 灵品打首领 +35% / +31%）； 咬首领：每一口之间要绕一圈回来，单打首领偏慢，补一点
};

/** 出手（weapons.ts 的 FIRE 表调）：够得着的地方有敌人才放（朝最密处；首领在就先咬首领）。返回 false = 这次没出手。 */
export function fireYoulong(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const Y = YOULONG;
  buildGrid(w.enemies);
  const n = wpn.spirit === 'twin' ? 2 : 1;
  const ts = densest(w, p, REACH.seek, n, [], 0, bossFirst);
  if (!ts.length) return false;
  const dmg = weaponDamage(p, wpn, p.buffs.rage);
  p.facing = ts[0].x >= p.x ? 1 : -1;
  p.loongs ??= [];
  for (let i = 0; i < n; i++) {
    const t = ts[i] ?? ts[0];
    // 两条龙：从戟尖往两边分开游出去
    const a = Math.atan2(t.y - p.y, t.x - p.x) + (n > 1 ? (i ? 0.7 : -0.7) : 0);
    const id = w.nextId++;
    const x = p.x + p.facing * 9;
    const y = p.y - 2;
    const L: LoongCast = { id, x, y, px: x, py: y, ux: Math.cos(a), uy: Math.sin(a), target: t.id, left: Y.bites[wpn.tier], hit: [], cool: 0, dmg, tier: wpn.tier, back: false, t: 0, wave: w.wave };
    if (wpn.spirit) L.spirit = wpn.spirit;
    p.loongs.push(L);
    ev.push({ t: 'loong', owner: p.id, id, x, y, tier: wpn.tier, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
  }
  return true;
}

/** 下一口咬谁：离龙头 hop 以内、离主人 REACH.max 以内、这一程没咬过的里最近的（一样近按 id，确定）。 */
function nextTarget(w: World, p: Player, L: LoongCast): Enemy | null {
  let best: Enemy | null = null;
  let bd = Infinity;
  for (const e of enemiesWithin(w, L.x, L.y, YOULONG.hop)) {
    if (e.hp <= 0 || e.hidden || L.hit.includes(e.id) || d2(e, p) > REACH.max * REACH.max) continue;
    const d = d2(e, L);
    if (d < bd || (d === bd && best && e.id < best.id)) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** 这条龙游完了：仙品起在尽头炸开一片冰。 */
function endLoong(w: World, p: Player, L: LoongCast, ev: SimEvent[]) {
  const B = YOULONG.burst;
  let r = 0;
  if (L.tier >= 3 && !L.back) {
    r = B.r * (1 + p.stats.area * 0.5);
    buildGrid(w.enemies);
    for (const e of enemiesWithin(w, L.x, L.y, r)) hitEnemy(w, e, { dmg: L.dmg * B.mul, by: 'loong', owner: p.id, from: L, kb: 60, el: 'water', freeze: B.freeze }, ev);
  }
  ev.push({ t: 'loongEnd', owner: p.id, id: L.id, x: L.x, y: L.y, burst: r });
}

/** 每帧推进主人身上的冰龙（weapons.updateWeapons 调）：朝目标游、咬、换下一只；游完、游太远、太久就收。 */
export function updateLoongs(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const Y = YOULONG;
  const list = p.loongs;
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const L = list[i];
    L.px = L.x;
    L.py = L.y;
    L.t += dt;
    L.cool = Math.max(0, L.cool - dt);
    if (L.wave !== w.wave) {
      list.splice(i, 1);
      continue;
    }
    buildGrid(w.enemies);
    let tx: number;
    let ty: number;
    let t: Enemy | null = null;
    if (L.back) {
      // 回澜：游回主人身边（路上碰到的各咬一口，见下面）
      tx = p.x;
      ty = p.y - 2;
    } else {
      t = L.target >= 0 ? (w.enemies.find((e) => e.id === L.target && e.hp > 0 && !e.hidden) ?? null) : null;
      if (!t && L.cool <= 0) {
        t = nextTarget(w, p, L);
        if (!t && L.hit.length) {
          // 身边只剩咬过的（打首领、敌人稀）：这一程咬过的不算了，绕回来再咬
          L.hit = [];
          t = nextTarget(w, p, L);
        }
        L.target = t ? t.id : -1;
      }
      tx = t ? t.x : L.x + L.ux * 40;
      ty = t ? t.y : L.y + L.uy * 40;
    }
    // 转向：角速度有上限（走弧线），离目标近了转得急
    const dist = Math.hypot(tx - L.x, ty - L.y);
    const err = wrapAngle(Math.atan2(ty - L.y, tx - L.x) - Math.atan2(L.uy, L.ux));
    const wMax = Y.turn * (1 + 70 / Math.max(10, dist)) * dt;
    const a = Math.atan2(L.uy, L.ux) + Math.max(-wMax, Math.min(wMax, err));
    L.ux = Math.cos(a);
    L.uy = Math.sin(a);
    const sp = Y.speed[L.tier] * (L.back ? 1.15 : 1);
    L.x += L.ux * sp * dt;
    L.y += L.uy * sp * dt;
    // 咬
    if (L.back) {
      for (const e of enemiesWithin(w, L.x, L.y, Y.biteR + 12)) {
        if (e.hp <= 0 || L.hit.includes(e.id) || d2(e, L) > (Y.biteR + ENEMIES[e.kind].radius * 0.5) ** 2) continue;
        L.hit.push(e.id);
        bite(w, p, L, e, Y.ebb, ev);
      }
      if (d2(L, { x: p.x, y: p.y - 2 }) <= Y.home * Y.home || L.t > Y.life) {
        endLoong(w, p, L, ev);
        list.splice(i, 1);
      }
      continue;
    }
    if (t && L.cool <= 0 && d2(t, L) <= (Y.biteR + ENEMIES[t.kind].radius * 0.5) ** 2) {
      L.hit.push(t.id);
      L.left--;
      L.cool = Y.cool;
      L.target = -1;
      bite(w, p, L, t, 1, ev);
    }
    const gone = d2(L, p) > (REACH.max + 24) ** 2 || L.t > Y.life || (!t && L.cool <= 0 && L.target < 0 && !L.hit.length);
    if (L.left <= 0 || gone) {
      if (L.spirit === 'ebb' && L.left <= 0) {
        // 回澜：咬完了掉头回去，回程路上的再咬一遍
        endLoong(w, p, L, ev); // 仙品的那片冰在掉头的地方炸（神品一定过了仙品）
        L.back = true;
        L.hit = [];
        L.target = -1;
        continue;
      }
      endLoong(w, p, L, ev);
      list.splice(i, 1);
    }
  }
  if (!list.length) delete p.loongs;
}

function bite(w: World, p: Player, L: LoongCast, e: Enemy, mul: number, ev: SimEvent[]) {
  const Y = YOULONG;
  ev.push({ t: 'loongBite', owner: p.id, id: L.id, target: e.id, x: e.x, y: e.y });
  const ex = e.x;
  const ey = e.y;
  hitEnemy(w, e, { dmg: L.dmg * mul * (e.kind === 'boss' ? Y.boss : 1), by: 'loong', owner: p.id, from: { x: L.x - L.ux * 8, y: L.y - L.uy * 8 }, kb: Y.kb, el: 'water' }, ev);
  if (e.hp > 0) slowEnemy(w, e, p.id, Y.slow, Y.slowT);
  // 溅开的冰碴：身边的也挨一下、走得慢（不算这条龙咬过：之后照样会去咬它）
  const r = Y.splash.r[L.tier] * (1 + p.stats.area * 0.5);
  for (const o of enemiesWithin(w, ex, ey, r)) {
    if (o === e || o.hp <= 0) continue;
    hitEnemy(w, o, { dmg: L.dmg * mul * Y.splash.mul[L.tier], by: 'loong', owner: p.id, from: { x: ex, y: ey }, kb: Y.kb * 0.6, el: 'water' }, ev);
    if (o.hp > 0) slowEnemy(w, o, p.id, Y.slow, Y.slowT);
  }
}

// ---------------------------------------------------------------- 神通「化龙」

export const HUALONG = {
  dur: 3.2, // 化成白龙多久
  speed: LONGLIN_SPEED, // 游得快多少（passives.ts 的 speed 钩子读同一个数）
  r: 19, // 身子扫到多远（判定再加敌人身子的一半）
  tick: 0.3, // 同一只敌人隔多久再挨一下
  dmg: 0.42, // 扫到一下的伤害（相对 SKILL.damage）
  kb: 130,
  freeze: 0.6, // 第一次扫到的冻住片刻（首领不吃）
  end: { r: 62, dmg: 0.9, kb: 300, freeze: 1.1 }, // 变回来落地的那一圈浪：半径（吃一点范围加成和功法「混元一气」）、伤害、推开、冻多久
  after: 0.3, // 变回来之后再无敌多久
};

/** 放化龙：这几秒是一条白龙（updateHuiao 里每帧扫身边的敌人，到时变回来掀一圈浪）。 */
export function hualong(w: World, p: Player, ev: SimEvent[]) {
  const H = HUALONG;
  p.hualong = { t0: w.time, until: w.time + H.dur, dmg: SKILL.damage * (1 + p.stats.damage), next: {}, wave: w.wave };
  p.iframes = Math.max(p.iframes, H.dur + H.after);
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: H.end.r, kind: 'hualong', dur: H.dur });
}

/** 化龙落地的那一圈有多大。 */
const endRadius = (p: Player) => Math.min(REACH.max, HUALONG.end.r * (1 + Math.min(REACH.area, p.stats.area)) * techSkillRadius(p));

/** 每帧（heroes/index.ts 的 KITS）：化龙的那几秒扫身边的敌人；到时变回来。 */
export function updateHuiao(w: World, p: Player, _dt: number, ev: SimEvent[]) {
  const c = p.hualong;
  if (!c) return;
  const H = HUALONG;
  if (c.wave !== w.wave) {
    delete p.hualong;
    return;
  }
  buildGrid(w.enemies);
  if (w.time >= c.until) {
    const r = endRadius(p);
    for (const e of enemiesWithin(w, p.x, p.y, r)) hitEnemy(w, e, { dmg: c.dmg * H.end.dmg, by: 'skill', owner: p.id, from: p, kb: H.end.kb, el: 'water', freeze: H.end.freeze }, ev);
    ev.push({ t: 'hualongEnd', owner: p.id, x: p.x, y: p.y, r });
    delete p.hualong;
    return;
  }
  for (const e of enemiesWithin(w, p.x, p.y, H.r + 12)) {
    if (e.hp <= 0 || d2(e, p) > (H.r + ENEMIES[e.kind].radius * 0.5) ** 2) continue;
    const at = c.next[e.id];
    if (at !== undefined && w.time < at) continue;
    c.next[e.id] = w.time + H.tick;
    hitEnemy(w, e, { dmg: c.dmg * H.dmg, by: 'skill', owner: p.id, from: p, kb: H.kb, el: 'water', freeze: at === undefined ? H.freeze : 0 }, ev);
  }
}
