// 回响赵公明（回响化身，主五行土；第二章第 4 波的遭遇战，打倒解锁。用户 11-11 确认：法宝、神通、被动都和赵公明不同）。
// 玩法一眼看得懂：拉怪成团、再一起炸——
// - 专属法宝「缚龙索」（赵公明在原著里用它缚过黄龙真人）：甩出一根金索缠住敌群里的一串，往一处拽到一起、撞一下；
//   凡四只、灵六只（拽得更快、更疼），仙品「锁龙」拽到一起后再锁住片刻、受伤加深；神品器灵「双索」一次两根各拽一群 /「千钧」拽到一起后在那一点砸下一记。
//   和捆仙绳分得开：捆仙绳是就地捆住一串（定身、易伤），缚龙索不定身、是把一大片敌人拽成一团；首领拽不动，只挨伤害。
// - 神通「钉头七箭」（他死于此咒，回响里反过来用）：给身边最多七只敌人钉上草人符（首领、精英、血厚的先钉），三秒后七箭一起落下重创。
// - 被动「怨力」：挨打攒怨，攒满了从身上震出一圈（伤害、震开），再从头攒。
// 宠物魂虎就是黑虎（pets/heihu.ts），只换了颜色（game/pets/heihu-fx.ts 按角色换）。
// 状态都挂在人物身上（Player.ropes / nails / grudge，纯数据）：索跟着法宝推进（weapons.updateWeapons 调 updateRopes），
// 神通和被动的震波在 updateHuizhao 里（heroes/index.ts 的 KITS）。射程守 config.REACH：缠的、钉的都在索敌半径里。
// 数值是初值（2026-11-11），最后统一调。
import { ENEMIES, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, slowEnemy, weaponDamage } from '../core.ts';
import { densest } from '../weapons.ts';
import { techSkillRadius } from '../techniques.ts';
import { YUANLI } from '../catalog.ts';
import type { Enemy, OwnedWeapon, Player, RopeCast, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const BOSS_WEIGHT = 6;
const bossFirst = (e: Enemy) => (e.kind === 'boss' ? BOSS_WEIGHT : 1);

// ---------------------------------------------------------------- 专属法宝「缚龙索」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const FULONG = {
  n: [0, 3, 5, 6, 6], // 一根索缠几只
  twin: 5, // 器灵「双索」：两根各缠几只
  gather: 70, // 缠的是那一群：离瞄的那只这么近以内的（从近到远挑）
  dur: [0, 0.7, 0.6, 0.6, 0.6], // 拽多久拽到一起
  maxSpeed: 230, // 拽的速度上限（像素 / 秒）
  slow: 0.6, // 拽的时候减速（被拽着走不动）
  bind: 0.5, // 缠上的一勒
  clash: 1.1, // 拽到一起撞的一下
  crowd: 0.1, // 撞到一起的每多一只，撞的那一下 +10%（最多 +50%）
  lone: 1.6, // 只缠住一只（单打精英、首领）：勒得更紧，撞的那一下按这么多倍算（tools/weapon-dps.ts 量过：不然单体偏弱一半）
  lock: { t: 1, vuln: 0.25, vulnT: 2 }, // 仙品「锁龙」：锁住多久、受伤加深
  slam: { r: 34, mul: 0.75, stun: 0.6 }, // mul 0.7 → 0.75（2026-11-11）； // 器灵「千钧」：砸下的半径、伤害、晕
  elite: 0.5, // 精英拽得慢一半
};

/** 挑一群：最密的那只为中心，离它 gather 以内的从近到远挑 n 只；首领、精英也缠（首领拽不动）。 */
function pickChain(w: World, p: Player, n: number, avoid: { x: number; y: number }[]): Enemy[] {
  const t = densest(w, p, REACH.seek, 1, avoid, 0, bossFirst)[0];
  if (!t) return [];
  const near = enemiesWithin(w, t.x, t.y, FULONG.gather).filter((e) => dist2(e, p) <= (REACH.seek + 10) ** 2);
  near.sort((a, b) => dist2(a, t) - dist2(b, t));
  const out = [t, ...near.filter((e) => e !== t)].slice(0, n);
  return out;
}

/** 拽到哪：这一串的中心，往人物这边收一点（拽到身前，正好接着打）。 */
function gatherPoint(p: Player, es: Enemy[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const e of es) {
    x += e.x;
    y += e.y;
  }
  x /= es.length;
  y /= es.length;
  return [x + (p.x - x) * 0.2, y + (p.y - y) * 0.2];
}

/** 出手（weapons.ts 的 FIRE 表调）。返回 false = 这次没出手（身边没有够得着的敌人）。 */
export function fireFulong(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const F = FULONG;
  buildGrid(w.enemies);
  const ropes = wpn.spirit === 'twin' ? 2 : 1;
  const n = wpn.spirit === 'twin' ? F.twin : F.n[wpn.tier];
  const dmg = weaponDamage(p, wpn, p.buffs.rage);
  const used: Enemy[] = [];
  let fired = false;
  for (let k = 0; k < ropes; k++) {
    const chain = pickChain(w, p, n, used).filter((e) => !used.includes(e));
    if (!chain.length) break;
    used.push(...chain);
    const [cx, cy] = gatherPoint(p, chain);
    const id = w.nextId++;
    const rope: RopeCast = { id, ids: chain.map((e) => e.id), cx, cy, fx: p.x + p.facing * 6, fy: p.y - 14, t: 0, dur: F.dur[wpn.tier], dmg, tier: wpn.tier, spirit: wpn.spirit, wave: w.wave };
    (p.ropes ??= []).push(rope);
    for (const e of chain) hitEnemy(w, e, { dmg: dmg * F.bind, by: 'lasso', owner: p.id, from: { x: cx, y: cy }, el: 'earth' }, ev);
    ev.push({ t: 'lasso', owner: p.id, id, x: rope.fx, y: rope.fy, cx, cy, ids: rope.ids, dur: rope.dur, tier: wpn.tier, spirit: wpn.spirit });
    fired = true;
  }
  return fired;
}

/** 拽到一起：撞一下（越多越疼），仙品起锁住、受伤加深，千钧在那一点砸下一记。 */
function clash(w: World, p: Player, r: RopeCast, ev: SimEvent[]) {
  const F = FULONG;
  const alive = r.ids.map((id) => w.enemies.find((e) => e.id === id && e.hp > 0)).filter((e): e is Enemy => !!e);
  const crowd = alive.length === 1 ? F.lone : 1 + Math.min(0.5, F.crowd * Math.max(0, alive.length - 1));
  const lock = r.tier >= 3 ? F.lock.t : 0;
  for (const e of alive) {
    hitEnemy(w, e, { dmg: r.dmg * F.clash * crowd, by: 'lasso', owner: p.id, from: { x: r.cx, y: r.cy }, el: 'earth', stun: lock }, ev);
    if (lock && e.hp > 0) {
      e.vuln = Math.max(e.vuln, F.lock.vuln);
      e.vulnT = Math.max(e.vulnT, F.lock.vulnT);
    }
  }
  let slam = 0;
  if (r.spirit === 'qianjun') {
    slam = F.slam.r;
    buildGrid(w.enemies);
    for (const e of enemiesWithin(w, r.cx, r.cy, F.slam.r + 10)) {
      if (Math.hypot(e.x - r.cx, e.y - r.cy) > F.slam.r + ENEMIES[e.kind].radius * 0.5) continue;
      hitEnemy(w, e, { dmg: r.dmg * F.slam.mul, by: 'lasso', owner: p.id, from: { x: r.cx, y: r.cy }, el: 'earth', kb: 80, stun: F.slam.stun }, ev);
    }
  }
  ev.push({ t: 'lassoEnd', owner: p.id, id: r.id, cx: r.cx, cy: r.cy, ids: alive.map((e) => e.id), lock, slam });
}

/** 每帧推进缚龙索（weapons.updateWeapons 调）：缠住的往一处拽（首领拽不动，精英拽得慢），拽到了一起撞一下。 */
export function updateRopes(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const rs = p.ropes;
  if (!rs) return;
  const F = FULONG;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    if (r.wave !== w.wave) {
      rs.splice(i, 1);
      continue;
    }
    r.t += dt;
    const left = Math.max(1e-3, r.dur - r.t + dt);
    for (const id of r.ids) {
      const e = w.enemies.find((x) => x.id === id && x.hp > 0);
      if (!e || e.kind === 'boss') continue;
      slowEnemy(w, e, p.id, F.slow, 0.15);
      const dx = r.cx - e.x;
      const dy = r.cy - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) continue;
      // 剩下的时间里正好拽到（越近越慢，不会拽过头）；精英慢一半
      const sp = Math.min(F.maxSpeed, d / left) * (e.kind === 'elite' ? F.elite : 1);
      const step = Math.min(d - 1, sp * dt);
      e.x += (dx / d) * step;
      e.y += (dy / d) * step;
    }
    if (r.t >= r.dur - 1e-9) {
      clash(w, p, r, ev);
      rs.splice(i, 1);
    }
  }
  if (!rs.length) delete p.ropes;
}

// ---------------------------------------------------------------- 神通「钉头七箭」

export const DINGTOU = {
  n: 7, // 最多钉几只
  delay: 3, // 钉上之后多久落箭
  dmg: 2.2, // 每只中箭的伤害（相对 SKILL.damage；三头六臂是 1 倍）
  stun: 0.5, // 中箭晕一下（首领不吃）
};

/** 挑谁钉：身边（索敌半径里，吃一点功法「混元一气」）先钉首领、精英，其余按气血从厚到薄。 */
function pickNails(w: World, p: Player): Enemy[] {
  buildGrid(w.enemies);
  const r = Math.min(REACH.max, REACH.seek * techSkillRadius(p));
  const near = enemiesWithin(w, p.x, p.y, r);
  const rank = (e: Enemy) => (e.kind === 'boss' ? 2e9 : e.kind === 'elite' ? 1e9 : 0) + e.hp;
  return near.sort((a, b) => rank(b) - rank(a) || a.id - b.id).slice(0, DINGTOU.n);
}

/** 放钉头七箭：钉上草人符，DINGTOU.delay 秒后（updateHuizhao）一起落箭。 */
export function dingtou(w: World, p: Player, ev: SimEvent[]) {
  const D = DINGTOU;
  const ts = pickNails(w, p);
  p.nails = { ids: ts.map((e) => e.id), t0: w.time, until: w.time + D.delay, dmg: SKILL.damage * D.dmg * (1 + p.stats.damage), wave: w.wave };
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: REACH.seek, kind: 'dingtou', dur: D.delay });
  ev.push({ t: 'nail', owner: p.id, ids: p.nails.ids, t2: D.delay });
}

// ---------------------------------------------------------------- 被动「怨力」

// 攒怨在 passives.ts（core.hurtPlayer 扣完血之后调；数值在 catalog.YUANLI）

/** 攒满了：从身上震出一圈。 */
function release(w: World, p: Player, ev: SimEvent[]) {
  const G = YUANLI;
  p.grudge = 0;
  const r = G.r * (1 + p.stats.area * 0.5);
  buildGrid(w.enemies);
  const ids: number[] = [];
  const dmg = SKILL.damage * G.dmg * (1 + p.stats.damage);
  for (const e of enemiesWithin(w, p.x, p.y, r)) {
    hitEnemy(w, e, { dmg, by: 'skill', owner: p.id, from: p, kb: G.kb, el: 'earth' }, ev);
    ids.push(e.id);
  }
  ev.push({ t: 'grudge', owner: p.id, x: p.x, y: p.y, r, ids });
}

/** 每帧（heroes/index.ts 的 KITS 调）：钉头七箭到点落箭；怨攒满了就震。 */
export function updateHuizhao(w: World, p: Player, _dt: number, ev: SimEvent[]) {
  const n = p.nails;
  if (n) {
    if (n.wave !== w.wave) delete p.nails;
    else if (w.time >= n.until - 1e-9) {
      delete p.nails;
      const hit: number[] = [];
      for (const id of n.ids) {
        const e = w.enemies.find((x) => x.id === id && x.hp > 0);
        if (!e) continue;
        hitEnemy(w, e, { dmg: n.dmg, by: 'skill', owner: p.id, from: { x: e.x, y: e.y - 20 }, stun: DINGTOU.stun }, ev);
        hit.push(id);
      }
      ev.push({ t: 'nailHit', owner: p.id, ids: hit });
    }
  }
  if ((p.grudge ?? 0) >= 1) release(w, p, ev);
}
