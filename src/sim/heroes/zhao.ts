// 赵公明（主五行土；暂拟，待评审确认）的神通、专属法宝「定海珠」。宠物黑虎在 pets/heihu.ts，被动「招财」在 passives.ts。
// - 神通「金鞭」：一条巨大的金鞭虚影举起、砸下一条直线（自动朝敌人最多的方向，首领在就先砸首领），线上的敌人挨一下、晕一会儿、
//   被往线的两边震开；地上裂开一道金缝（踩在缝上的减速），缝里迸出几枚金元宝（照灵石捡，值得多一些：财神的味道）。
//   和法宝「打神鞭」不一样：打神鞭是从云里抽下来、抽一只；金鞭是贴着地从脚前砸出去的一整条线，没有云。
// - 定海珠：几颗珠子绕身慢转（画面），隔一会儿飞出一颗，砸在敌群里震开一圈、晕一下；灵品珠子更多（一次飞两颗、各砸一群）、圈更大；
//   仙品「石纹」砸地留下一圈石纹，片刻后再震一次；神品器灵「二十四珠」二十四颗珠子绕着敌群围成一圈依次砸下、整圈石纹随后一起再震，
//   「镇海」一颗巨珠压住一片敌人，定身更久。珠子飞出去到落地之间用 w.pending（kind 'bead'，落地时 weapons.land 调 landBead）。
// 射程守 config.REACH：落点不超过 REACH.seek，金鞭的线不超过 REACH.max。
// 数值是初值（2026-11-11），最后统一调。
import { ENEMIES, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, segDist, slowEnemy, weaponDamage } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import { densest } from '../weapons.ts';
import type { Enemy, OwnedWeapon, Pending, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** 挑方向、挑落点时一只首领算几只（首领战里先打首领）。 */
const BOSS_WEIGHT = 6;
const bossFirst = (e: Enemy) => (e.kind === 'boss' ? BOSS_WEIGHT : 1);
/** 落点处的范围：范围加成最多算到 REACH.area（和番天印、打神鞭一样）。 */
const aoe = (p: Player) => 1 + Math.min(p.stats.area, REACH.area);

// ---------------------------------------------------------------- 神通「金鞭」

export const JINBIAN = {
  len: 126, // 砸下的那条线多长（从脚前算；吃一点范围加成和功法「混元一气」，最多 REACH.max）
  w: 13, // 线的半宽（判定再加敌人身子的一半）
  delay: 0.34, // 鞭影举起到砸下
  dmg: 1.1, // 砸下的伤害（相对 SKILL.damage；三头六臂是 1 倍）
  stun: 1, // 砸中的晕多久（首领不吃）
  kb: 120, // 往线的两边震开
  crack: { life: 2.6, w: 9, slow: 0.45 }, // 金缝：多久合上、半宽、踩在缝上的减速
  ingots: 4, // 缝里迸出几枚金元宝
  ingot: 3, // 一枚金元宝值几颗灵石（照灵石拾取；赵公明自己捡还吃「招财」）
};

/** 金鞭的那条线：从脚前 8 像素起，朝 a 方向 len 长。 */
function lineOf(p: Player, a: number, len: number): [number, number, number, number] {
  return [p.x + Math.cos(a) * 8, p.y + Math.sin(a) * 8, p.x + Math.cos(a) * len, p.y + Math.sin(a) * len];
}

/** 挑方向：在最近的十只（和够得着的首领）里挑一个方向，让那条线罩住最多的敌人（首领算 BOSS_WEIGHT 只；一样多就挑近的）。 */
function aimLine(w: World, p: Player, len: number, hw: number): number {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, len + 8).sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return p.facing > 0 ? 0 : Math.PI;
  const boss = near.find((e) => e.kind === 'boss');
  const pool = boss && near.indexOf(boss) >= 10 ? [...near.slice(0, 10), boss] : near.slice(0, 10);
  let best = Math.atan2(near[0].y - p.y, near[0].x - p.x);
  let bestN = -1;
  for (const c of pool) {
    const a = Math.atan2(c.y - p.y, c.x - p.x);
    const [x0, y0, x1, y1] = lineOf(p, a, len);
    let n = 0;
    for (const e of near) if (segDist(e.x, e.y, x0, y0, x1, y1) <= hw + ENEMIES[e.kind].radius * 0.5) n += bossFirst(e);
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  return best;
}

/** 放金鞭：定下方向，鞭影举起（JINBIAN.delay 秒后在 updateZhao 里砸下）。 */
export function jinbian(w: World, p: Player, ev: SimEvent[]) {
  const J = JINBIAN;
  const len = Math.min(REACH.max, J.len * (1 + Math.min(REACH.area, p.stats.area)) * techSkillRadius(p));
  const a = aimLine(w, p, len, J.w);
  p.facing = Math.cos(a) >= 0 ? 1 : -1;
  const [x0, y0, x1, y1] = lineOf(p, a, len);
  p.whip = { x0, y0, x1, y1, w: J.w, t0: w.time, delay: J.delay, dmg: SKILL.damage * J.dmg * (1 + p.stats.damage), struck: false, until: 0, wave: w.wave };
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: len, kind: 'jinbian', a, dur: J.delay });
}

/** 线段上离 (x, y) 最近的点（震开的方向从这里量：被砸中的往线的两边飞）。 */
function nearestOn(x: number, y: number, x0: number, y0: number, x1: number, y1: number) {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy || 1)));
  return { x: x0 + vx * t, y: y0 + vy * t };
}

/** 砸下：线上的敌人挨一下、晕一会儿、往两边震开；裂开金缝，迸出金元宝。 */
function strike(w: World, p: Player, ev: SimEvent[]) {
  const J = JINBIAN;
  const wh = p.whip!;
  wh.struck = true;
  wh.until = w.time + J.crack.life;
  const { x0, y0, x1, y1 } = wh;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  buildGrid(w.enemies);
  const ids: number[] = [];
  for (const e of enemiesWithin(w, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + wh.w + 14)) {
    if (segDist(e.x, e.y, x0, y0, x1, y1) > wh.w + ENEMIES[e.kind].radius * 0.5) continue;
    hitEnemy(w, e, { dmg: wh.dmg, by: 'skill', owner: p.id, from: nearestOn(e.x, e.y, x0, y0, x1, y1), kb: J.kb, stun: J.stun }, ev);
    ids.push(e.id);
  }
  // 金元宝：沿着缝均匀地迸出来，一左一右往两边蹦开一点（落在缝边上，人走过去就捡到）
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const ingots: number[] = [];
  for (let i = 0; i < J.ingots; i++) {
    const t = (i + 0.5 + (w.rng.next() - 0.5) * 0.5) / J.ingots;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const side = i % 2 ? 1 : -1;
    const sp = 45 + w.rng.next() * 30;
    const along = (w.rng.next() - 0.5) * 24;
    const id = w.nextId++;
    w.gems.push({ id, x, y, px: x, py: y, vx: -uy * side * sp + ux * along, vy: ux * side * sp + uy * along, value: J.ingot, pulled: -1, ingot: true });
    ingots.push(id);
  }
  ev.push({ t: 'whip', owner: p.id, x0, y0, x1, y1, w: wh.w, life: J.crack.life, ids, ingots });
}

/** 每帧：鞭影到点砸下；砸下之后金缝上的敌人减速，到时合上。上一波留下来的、举了太久没砸（主人倒下过）的直接收掉。 */
export function updateZhao(w: World, p: Player, _dt: number, ev: SimEvent[]) {
  const wh = p.whip;
  if (!wh) return;
  if (wh.wave !== w.wave || (!wh.struck && w.time - wh.t0 > wh.delay + 0.5)) {
    delete p.whip;
    return;
  }
  if (!wh.struck) {
    if (w.time - wh.t0 >= wh.delay - 1e-9) strike(w, p, ev);
    return;
  }
  if (w.time >= wh.until) {
    delete p.whip;
    return;
  }
  const C = JINBIAN.crack;
  const { x0, y0, x1, y1 } = wh;
  const len = Math.hypot(x1 - x0, y1 - y0);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + C.w + 14))
    if (segDist(e.x, e.y, x0, y0, x1, y1) <= C.w + ENEMIES[e.kind].radius * 0.5) slowEnemy(w, e, p.id, C.slow, 0.25);
}

// ---------------------------------------------------------------- 专属法宝「定海珠」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const DINGHAI = {
  orbit: [0, 3, 5, 5, 5], // 绕身的珠子几颗（画面用；二十四珠、镇海见下面）
  volley: [0, 1, 2, 2, 2], // 一次飞出去几颗（各砸一群；只有一群时第二颗晚一点砸在同一群里）
  r: [0, 20, 24, 26, 26], // 震开的半径（2026-11-11 各 −4：群伤比中位数高两三成、单体低，正中那颗重一点、震开的圈小一点）（吃范围加成，最多 REACH.area）
  fly: 0.42, // 飞多久落下
  stagger: 0.14, // 第二颗晚飞多久
  side: 0.8, // 第二颗的伤害
  stun: [0, 0.45, 0.55, 0.6, 0.6], // 砸中晕多久（首领不吃）
  kb: 100, // 从落点往外震开（一下约 11 像素：震开，又不至于一下推出仙品再震的那一圈）
  after: { delay: 0.8, grow: 1.25, mul: 0.3, stun: 0.4, kb: 70 }, // 仙品「石纹」：多久后再震、圈大多少（比砸的那一圈大一点：震开的也逃不出去）、伤害、晕、震开；mul 0.45 → 0.3（2026-11-11：仙品群伤偏高）
  rosary: { n: 24, R: 44, flat: 0.62, r: 12, first: 0.25, gap: 0.035, mul: 0.22, stun: 0.3, quake: 2, delay: 0.5 }, // 器灵「二十四珠」：圈的半径（上下压扁成 flat 倍）、每颗的范围、依次砸下的间隔，整圈再震的伤害、砸完多久再震；2026-11-11：r 15 → 12、mul 0.3 → 0.22（群伤偏高）
  anchor: { r: 40, mul: 1.4, root: 1.6, boss: 1.25 }, // 器灵「镇海」：巨珠压住的半径、伤害、定身多久、对首领的倍率（首领不吃定身）
  core: { r: 0.4, mul: 2.2, edge: 0.55 }, // 2026-11-11 数值平衡（没成型不秒杀）：正中 ×2.6 → ×2.2、震到的别的 0.45 → 0.55、冷却 1.7 → 1.45 秒、单发倍率 1.05 / 0.85 / 1.15 → 0.9 / 0.72 / 0.98（凡品一下打死 47% → 23%）。正中：离落点这一比例的半径以内的那只被砸个正着（瞄的就是它），吃 mul 倍（单打一只精英、首领也有分量），震到的别的吃 edge 倍；再震的那一下不分；2026-11-11：mul 2.3 → 2.6、edge 0.66 → 0.45（同上）
};

/**
 * 珠子落在哪：瞄准的那只此刻的位置，往人物那边挪它在珠子飞行期间大概走的一段（敌人朝人走；晕着的不挪），
 * 落点不超过 REACH.seek。
 */
function landAt(p: Player, t: Enemy, fly: number): [number, number] {
  let x = t.x;
  let y = t.y;
  if (t.stun <= 0 && t.kind !== 'boss') {
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    const step = Math.min(Math.max(0, d - 12), t.speed * (1 - t.slow) * fly * 0.8);
    if (d > 1e-6) {
      x += ((p.x - t.x) / d) * step;
      y += ((p.y - t.y) / d) * step;
    }
  }
  const d = Math.hypot(x - p.x, y - p.y);
  if (d > REACH.seek) {
    x = p.x + ((x - p.x) * REACH.seek) / d;
    y = p.y + ((y - p.y) * REACH.seek) / d;
  }
  return [x, y];
}

/** 出手（weapons.ts 的 FIRE 表调）。返回 false = 这次没出手（没有够得着的敌人；二十四珠那一圈还没砸完也先不出）。 */
export function fireDinghai(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const D = DINGHAI;
  buildGrid(w.enemies);
  const dmg = weaponDamage(p, wpn, p.buffs.rage);
  if (wpn.spirit === 'rosary') return rosary(w, p, wpn, dmg, ev);
  const big = wpn.spirit === 'anchor';
  const n = big ? 1 : D.volley[wpn.tier];
  const targets = densest(w, p, REACH.seek, n, [], 0, bossFirst);
  if (!targets.length) return false;
  const r = (big ? D.anchor.r : D.r[wpn.tier]) * aoe(p);
  for (let i = 0; i < n; i++) {
    const t = targets[i] ?? targets[0];
    const t2 = D.fly + i * D.stagger;
    let [x, y] = landAt(p, t, t2);
    if (!targets[i]) {
      // 只有一群：第二颗砸在同一群里，错开一点
      x += (t.x >= p.x ? 1 : -1) * r * 0.45;
      [x, y] = landAt(p, { ...t, x, y, stun: 1 }, 0);
    }
    const id = w.nextId++;
    const mul = (i > 0 ? D.side : 1) * (big ? D.anchor.mul : 1);
    w.pending.push({ id, owner: p.id, kind: 'bead', x, y, r, t: t2, dmg: dmg * mul, tier: wpn.tier, ...(big ? { spirit: 'anchor' } : {}) });
    ev.push({ t: 'bead', owner: p.id, id, x, y, r, t2, kind: 'dinghai', tier: wpn.tier, ...(big ? { spirit: 'anchor' } : {}) });
  }
  return true;
}

/**
 * 器灵「二十四珠」：二十四颗珠子飞到敌人最密的那一群（首领在就是首领）上方，绕着它围成一圈，从靠人物的那一侧起依次砸下；
 * 最后一颗落下之后，整圈石纹一起再震（圈上圈里都挨，围在当中的那一群、首领吃得最多）。
 * 圈心离人物不超过 REACH.seek − 圈的半径：整圈都落在索敌半径里，效果不出 REACH.max。
 */
function rosary(w: World, p: Player, wpn: OwnedWeapon, dmg: number, ev: SimEvent[]): boolean {
  const D = DINGHAI.rosary;
  if (w.pending.some((q) => q.owner === p.id && q.kind === 'bead' && q.spirit === 'rosary')) return false; // 上一圈还没砸完
  const t = densest(w, p, REACH.seek, 1, [], 0, bossFirst)[0];
  if (!t) return false;
  const R = D.R * aoe(p);
  const r = D.r * aoe(p);
  let cx = t.x;
  let cy = t.y;
  const lim = REACH.seek - R;
  const d = Math.hypot(cx - p.x, cy - p.y);
  if (d > lim) {
    cx = p.x + ((cx - p.x) * lim) / d;
    cy = p.y + ((cy - p.y) * lim) / d;
  }
  const a0 = p.facing > 0 ? Math.PI : 0; // 从靠人物的那一侧起
  for (let i = 0; i < D.n; i++) {
    const a = a0 + (i / D.n) * Math.PI * 2 * p.facing;
    // 地面上的一圈按透视压扁（上下 0.62：和画面里所有贴地的圈一样），落点和画出来的那一圈对得上
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R * D.flat;
    const id = w.nextId++;
    const t2 = D.first + i * D.gap;
    w.pending.push({ id, owner: p.id, kind: 'bead', x, y, r, t: t2, dmg: dmg * D.mul, tier: wpn.tier, spirit: 'rosary', seq: i + 1 });
    ev.push({ t: 'bead', owner: p.id, id, x, y, r, t2, kind: 'dinghai', tier: wpn.tier, spirit: 'rosary', seq: i + 1, cx, cy });
  }
  const id = w.nextId++;
  const t2 = D.first + D.n * D.gap + D.delay;
  w.pending.push({ id, owner: p.id, kind: 'bead', x: cx, y: cy, r: R + r, t: t2, dmg: dmg * D.quake, tier: wpn.tier, spirit: 'rosary', quake: true });
  ev.push({ t: 'warn', id, kind: 'bead', x: cx, y: cy, r: R + r, t2, tier: wpn.tier });
  return true;
}

/**
 * 珠子落地（weapons.land 调；调之前已经 buildGrid）：落点 r 内的敌人挨一下、晕一下、从落点往外震开（土行）。
 * 仙品起（不是再震的那一下、也不是二十四珠的一颗）：留下一圈石纹，after.delay 秒后再震一次（发 warn，表现层画石纹）。
 */
export function landBead(w: World, q: Pending, ev: SimEvent[]) {
  const D = DINGHAI;
  const A = D.after;
  const tier = q.tier ?? 1;
  const big = q.spirit === 'anchor';
  const ring = q.spirit === 'rosary';
  const stun = q.quake ? A.stun : big ? D.anchor.root : ring ? D.rosary.stun : D.stun[tier];
  const kb = q.quake ? A.kb : D.kb;
  for (const e of enemiesWithin(w, q.x, q.y, q.r + 16)) {
    const d = Math.hypot(e.x - q.x, e.y - q.y);
    if (d > q.r + ENEMIES[e.kind].radius) continue;
    // 二十四珠整圈再震：围在当中的（瞄的那一群、首领）吃正中的倍数
    const core = q.quake ? (ring && d <= q.r * 0.35 ? D.core.mul : 1) : d <= q.r * D.core.r + ENEMIES[e.kind].radius * 0.5 ? D.core.mul : D.core.edge;
    hitEnemy(w, e, { dmg: q.dmg * core * (big && e.kind === 'boss' ? D.anchor.boss : 1), by: 'bead', owner: q.owner, from: q, kb, el: 'earth', stun }, ev);
  }
  if (q.quake || ring || tier < 3) return;
  const id = w.nextId++;
  const r = q.r * A.grow;
  w.pending.push({ id, owner: q.owner, kind: 'bead', x: q.x, y: q.y, r, t: A.delay, dmg: q.dmg * A.mul, tier, quake: true, ...(big ? { spirit: 'anchor' } : {}) });
  ev.push({ t: 'warn', id, kind: 'bead', x: q.x, y: q.y, r, t2: A.delay, tier });
}
