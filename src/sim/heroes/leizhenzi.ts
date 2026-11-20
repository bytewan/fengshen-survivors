// 雷震子（主五行木；暂拟，待评审确认）的神通「风雷翅」、专属法宝「黄金棍」。宠物雷鹏在 pets/leipeng.ts，被动「生翅」在 passives.ts。
// - 神通「风雷翅」：双翅一展腾空（WING.rise 秒，原地升起），然后朝敌人最密处连着俯冲 WING.dives 下：每一下飞过去（约 0.2 秒）、
//   砸出一道雷和一圈风浪把敌群掀开（伤害、晕、往外掀），砸完弹起（WING.up 秒）接着下一下；最后一下砸完落地（WING.land 秒）。
//   这一趟里人物由神通托着走（world.step 不听移动输入，见 heroes/index.ts 的 bodyHeld）、无敌（iframes 盖住整趟再多 WING.grace 秒）。
//   每一下挑离砸过的地方够远、离自己够近的那一群（首领在就先砸首领）；身边没敌人就朝面前飞一小段照样砸。落点不出仙台（不飞进魔气）。
// - 黄金棍：棍子飞出去（STAFF.fly 秒）掠过路上的敌群（飞到半路那一刻，沿线的挨一下轻的、往两边掀一点），砸在最密处（跟着瞄的那只走）：
//   落点劈下一道雷——正中的吃得最重——震开一圈、晕一下。灵品棍更大、砸完弹起再砸一处；仙品「雷纹」每一棍落处留一圈雷纹，片刻后再炸一下；
//   神品器灵「奔雷」一棍连砸三处（一路掠过、处处落雷），「碎岳」棍身暴涨、一棍砸碎一片（落雷更粗、晕得更久、砸首领更重）。
//   出手慢、单下重（用户：慢的单下高、快的单下低，同品阶 DPS 差不多）。棍子在外面时人物空着手（表现层读 w.pending 里 kind 'staff' 的那几根）。
//   飞出去到砸下之间用 w.pending（kind 'staff'：seq 0 是半路的掠过，seq ≥ 1 是第几砸，quake 是雷纹再炸；落下时 weapons.land 调 landStaff）。
// 射程守 config.REACH：瞄的那只在 REACH.seek 以内，弹起再砸的落点离人物不超过 REACH.max，落点处的范围加成最多算到 REACH.area。
// 数值是初值（2026-11-11），最后统一调。
import { ARENA, ENEMIES, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, segDist, weaponDamage } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import { densest } from '../weapons.ts';
import type { Enemy, OwnedWeapon, Pending, Player, SimEvent, WingCast } from '../types.ts';
import type { World } from '../world.ts';

const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
/** 挑落点时一只首领算几只（首领战里先打首领）。 */
const BOSS_WEIGHT = 6;
const bossFirst = (e: Enemy) => (e.kind === 'boss' ? BOSS_WEIGHT : 1);
/** 落点处的范围：范围加成最多算到 REACH.area（和番天印、定海珠一样）。 */
const aoe = (p: Player) => 1 + Math.min(p.stats.area, REACH.area);
/** 仙台上（不进魔气带）的一点：落点、俯冲的终点夹在这里面。 */
function onPlatform(w: World, x: number, y: number, m = 8): [number, number] {
  const i = w.miasmaInset;
  return [Math.max(i.x + m, Math.min(ARENA.w - i.x - m, x)), Math.max(i.y + m, Math.min(ARENA.h - i.y - m, y))];
}

/**
 * 在 (x, y) 身边 maxR 以内挑一群（不用随机数：候选不多，一只只数）：离 avoid 里的点都至少 apart 远、
 * 身边 30 像素内同伴（首领算 BOSS_WEIGHT 只）最多的那只；一样多挑近的。返回那只和它那一群的中心。
 */
function pickCluster(w: World, x: number, y: number, maxR: number, avoid: [number, number][], apart: number, keep?: (e: Enemy) => boolean): { e: Enemy; cx: number; cy: number } | null {
  const near = enemiesWithin(w, x, y, maxR).filter((e) => e.hp > 0 && (!keep || keep(e)) && avoid.every(([ax, ay]) => d2(e.x, e.y, ax, ay) >= apart * apart));
  if (!near.length) return null;
  let best = near[0];
  let bs = -1;
  let bd = Infinity;
  for (const e of near) {
    let s = 0;
    for (const o of near) if (d2(o.x, o.y, e.x, e.y) < 30 * 30) s += bossFirst(o);
    const d = d2(e.x, e.y, x, y);
    if (s > bs || (s === bs && d < bd) || (s === bs && d === bd && e.id < best.id)) {
      bs = s;
      bd = d;
      best = e;
    }
  }
  if (best.kind === 'boss') return { e: best, cx: best.x, cy: best.y };
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const o of near)
    if (d2(o.x, o.y, best.x, best.y) < 30 * 30) {
      cx += o.x;
      cy += o.y;
      n++;
    }
  return { e: best, cx: cx / n, cy: cy / n };
}

// ---------------------------------------------------------------- 神通「风雷翅」

export const WING = {
  rise: 0.3, // 双翅一展、原地升起
  dive: [0.14, 0.24], // 一下俯冲飞多久（按远近，夹在这两个数之间）
  up: 0.16, // 砸完弹起，接下一下
  land: 0.22, // 最后一下砸完，落地
  dives: 3, // 连着俯冲几下
  grace: 0.35, // 落地之后再无敌这么久
  reach: 100, // 每一下往多远找敌群（从这一刻的位置量；首领在里面就先砸首领）
  apart: 34, // 下一下的落点离砸过的地方至少这么远（砸过的那一群已经被掀开了）
  fallback: 46, // 身边没敌人时朝面前飞多远
  r: 36, // 风浪掀开的半径（吃范围加成，最多 REACH.area；功法「混元一气」再大一圈）
  dmg: 0.8, // 每一下的伤害（相对 SKILL.damage；三头六臂一下是 1 倍）
  core: { r: 0.4, mul: 1.5 }, // 正中被雷劈个正着：离落点这一比例的半径以内吃 mul 倍
  stun: 0.7, // 砸到的晕多久（首领不吃）
  kb: 300, // 风浪往外掀
};

/** 整趟飞多久（腾空到落地；无敌盖住它再多 grace）：俯冲按最慢的算。 */
const wingTotal = () => WING.rise + WING.dives * WING.dive[1] + (WING.dives - 1) * WING.up + WING.land;

/** 放风雷翅：双翅一展、原地升起（之后在 updateLeizhenzi 里一下下俯冲）。 */
export function fenglei(w: World, p: Player, ev: SimEvent[]) {
  p.wing = { phase: 'rise', n: 0, t: w.time, dur: WING.rise, x0: p.x, y0: p.y, x1: p.x, y1: p.y, t0: w.time, dmg: SKILL.damage * WING.dmg * (1 + p.stats.damage), wave: w.wave, slams: [] };
  p.iframes = Math.max(p.iframes, wingTotal() + WING.grace);
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: WING.r * aoe(p) * techSkillRadius(p), kind: 'fenglei', dur: WING.rise });
}

/** 这一下往哪俯冲：离砸过的地方够远的那一群（首领在就先砸首领）；没有就朝面前飞一小段。 */
function startDive(w: World, p: Player, g: WingCast, ev: SimEvent[]) {
  buildGrid(w.enemies);
  const c = pickCluster(w, p.x, p.y, WING.reach, g.slams, WING.apart);
  let [x1, y1] = c ? [c.cx, c.cy] : [p.x + p.facing * WING.fallback, p.y];
  [x1, y1] = onPlatform(w, x1, y1);
  const dist = Math.hypot(x1 - p.x, y1 - p.y);
  g.phase = 'dive';
  g.n++;
  g.t = w.time;
  g.dur = Math.max(WING.dive[0], Math.min(WING.dive[1], dist / 420));
  g.x0 = p.x;
  g.y0 = p.y;
  g.x1 = x1;
  g.y1 = y1;
  if (Math.abs(x1 - p.x) > 1) p.facing = x1 >= p.x ? 1 : -1;
  ev.push({ t: 'dive', owner: p.id, x0: p.x, y0: p.y, x1, y1, t2: g.dur, seq: g.n });
}

/** 砸下：落点劈一道雷、一圈风浪掀开敌群（伤害、晕、往外掀）。 */
function wingSlam(w: World, p: Player, g: WingCast, ev: SimEvent[]) {
  const r = WING.r * aoe(p) * techSkillRadius(p);
  const x = g.x1;
  const y = g.y1;
  buildGrid(w.enemies);
  const ids: number[] = [];
  for (const e of enemiesWithin(w, x, y, r + 16)) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > r + ENEMIES[e.kind].radius) continue;
    const core = d <= r * WING.core.r + ENEMIES[e.kind].radius * 0.5 ? WING.core.mul : 1;
    hitEnemy(w, e, { dmg: g.dmg * core, by: 'skill', owner: p.id, from: { x, y }, kb: WING.kb, stun: WING.stun }, ev);
    ids.push(e.id);
  }
  g.slams.push([x, y]);
  ev.push({ t: 'wingSlam', owner: p.id, x, y, r, ids, seq: g.n });
}

/** 每帧：风雷翅的这一段到点了就进下一段；俯冲的时候把人物沿着那一下挪过去（先慢后快，像从高处扑下来）。 */
export function updateLeizhenzi(w: World, p: Player, _dt: number, ev: SimEvent[]) {
  const g = p.wing;
  if (!g) return;
  if (g.wave !== w.wave) {
    delete p.wing;
    return;
  }
  const done = w.time - g.t >= g.dur - 1e-9;
  if (g.phase === 'dive') {
    const k = Math.min(1, (w.time - g.t) / g.dur);
    const e = k * k * (3 - 2 * k) * 0.35 + k * k * 0.65; // 起手慢、扑到最后最快
    p.x = g.x0 + (g.x1 - g.x0) * e;
    p.y = g.y0 + (g.y1 - g.y0) * e;
  }
  if (!done) return;
  if (g.phase === 'rise' || g.phase === 'up') startDive(w, p, g, ev);
  else if (g.phase === 'dive') {
    p.x = g.x1;
    p.y = g.y1;
    wingSlam(w, p, g, ev);
    g.phase = g.n < WING.dives ? 'up' : 'land';
    g.t = w.time;
    g.dur = g.phase === 'up' ? WING.up : WING.land;
  } else delete p.wing;
}

/** 风雷翅托着人物（这一趟里 world.step 不听移动输入）。 */
export const wingHeld = (p: Player) => !!p.wing;

/** 主人倒下 / 出局 / 离开、这一波结束：这一趟作废（落回地上）。 */
export function dropWing(p: Player) {
  delete p.wing;
}

// ---------------------------------------------------------------- 专属法宝「黄金棍」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const STAFF = {
  fly: 0.36, // 飞出去到砸下
  hop: 0.32, // 砸完弹起，飞到下一处砸下
  skim: { w: 9, mul: 0.1, kb: 50, at: 0.5 }, // 掠过：沿线的半宽（再加敌人身子的一半）、伤害、往两边掀；飞到 at 这一比例的时候结算
  r: [0, 24, 20, 24, 26], // 2026-11-11 数值平衡（没成型不秒杀）：冷却 2.2 → 1.9 秒、单发倍率 1 / 1.3 / 1.45 / 2.5 → 0.78 / 1.15 / 1.32 / 2.25、正中 ×1.7 → ×1.55、外圈 0.45 → 0.55、凡品的圈 23 → 24（凡品一下打死 45% → 39%：出手慢的重击；他开局靠这一圈震开，群伤留高）。震开的半径（吃范围加成，最多 REACH.area）
  slams: [0, 1, 2, 2, 2], // 一棍砸几处（器灵另算）
  next: 0.35, // 灵品起弹起再砸的那一下的伤害
  hopR: 76, // 弹起之后往多远找下一群（从上一砸的落点量；离人物不超过 REACH.max）
  stun: [0, 0.3, 0.35, 0.4, 0.4], // 砸中晕多久（首领不吃）
  kb: 120, // 从落点往外震开
  core: { r: 0.42, mul: 1.55, edge: 0.55, boss: 1.3 }, // 雷落处：离落点这一比例的半径以内的吃 mul 倍（瞄的就是它；首领吃 boss 倍），外圈吃 edge 倍；雷纹的再一炸不分
  sigil: { delay: 0.8, grow: 1.15, mul: 0.12, stun: 0.3, kb: 70 }, // 仙品「雷纹」：多久后再炸、圈大多少、伤害、晕、震开
  benlei: { n: 3, first: 1.1, next: 0.3 }, // first 1 → 1.1（2026-11-11）；器灵「奔雷」：一棍连砸几处；第一砸、之后每一砸的伤害
  suiyue: { r: 44, mul: 1.08, stun: 0.9, boss: 1, kb: 220 }, // 2026-11-11 数值平衡：r 38 → 44、mul 1.2 → 1.08（量具里群伤 −13%、单体 +15% → −9% / +4%）； // 器灵「碎岳」：砸碎多大一片、伤害、晕、对首领的倍率、震开
};

/** 这一棍还没砸完（棍子在外面）：上一棍的最后一砸落下之前不出下一棍。 */
export const staffOut = (w: World, p: Player) => w.pending.some((q) => q.owner === p.id && q.kind === 'staff' && (q.seq ?? 0) >= 1);

/**
 * 推一棍：从 (x0, y0) 飞向瞄的那只（落点跟着它走），t 秒后砸下；路上的掠过在半路结算。返回这一砸的 Pending id。
 * hops：这一砸之后还要再砸几处；mul：这一砸的伤害倍数。
 */
function launch(w: World, p: Player, wpn: Pick<OwnedWeapon, 'tier' | 'spirit'>, x0: number, y0: number, t: Enemy, at: [number, number], fly: number, dmg: number, seq: number, hops: number, ev: SimEvent[]): number {
  const S = STAFF;
  const big = wpn.spirit === 'suiyue';
  const r = (big ? S.suiyue.r : S.r[wpn.tier]) * aoe(p);
  const spirit = wpn.spirit ?? undefined;
  const id = w.nextId++;
  const [x, y] = at;
  // 掠过：半路那一刻，从 (x0, y0) 到落点那一段上的敌人（落点那一圈里的不算：它们马上挨砸）
  w.pending.push({ id: w.nextId++, owner: p.id, kind: 'staff', x, y, x0, y0, r, t: fly * S.skim.at, dmg: dmg * S.skim.mul, tier: wpn.tier, seq: 0, target: t.id, ...(spirit ? { spirit } : {}) });
  w.pending.push({ id, owner: p.id, kind: 'staff', x, y, x0, y0, r, t: fly, dmg, tier: wpn.tier, seq, hops, target: t.id, ...(spirit ? { spirit } : {}) });
  ev.push({ t: 'staff', owner: p.id, id, x0, y0, x, y, r, t2: fly, tier: wpn.tier, seq, ...(spirit ? { spirit } : {}) });
  return id;
}

/** 出手（weapons.ts 的 FIRE 表调）。返回 false = 这次没出手（没有够得着的敌人，或上一棍还没砸完）。 */
export function fireStaff(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const S = STAFF;
  if (staffOut(w, p)) return false;
  buildGrid(w.enemies);
  const t = densest(w, p, REACH.seek, 1, [], 0, bossFirst)[0];
  if (!t) return false;
  const n = wpn.spirit === 'benlei' ? S.benlei.n : wpn.spirit === 'suiyue' ? 1 : S.slams[wpn.tier];
  const mul = wpn.spirit === 'suiyue' ? S.suiyue.mul : wpn.spirit === 'benlei' ? S.benlei.first : 1;
  const dmg = weaponDamage(p, wpn, p.buffs.rage) * mul;
  p.facing = t.x >= p.x ? 1 : -1;
  launch(w, p, wpn, p.x, p.y, t, [t.x, t.y], S.fly, dmg, 1, n - 1, ev);
  return true;
}

/**
 * 黄金棍落下（weapons.land 调；调之前已经 buildGrid）：
 * - seq 0 掠过：起点到落点那一段上的敌人挨一下轻的、往两边掀一点（落点那一圈里的不算）；
 * - quake 雷纹再炸：圈里的都挨一下、晕一下；
 * - 其余是砸下：落点 r 内的敌人挨一下（正中的吃 core.mul 倍）、晕一下、往外震开；仙品起留一圈雷纹（发 warn），还要再砸的弹起去找下一群。
 */
export function landStaff(w: World, q: Pending, ev: SimEvent[]) {
  const S = STAFF;
  const tier = q.tier ?? 1;
  const big = q.spirit === 'suiyue';
  if (q.seq === 0) {
    const x0 = q.x0 ?? q.x;
    const y0 = q.y0 ?? q.y;
    const len = Math.hypot(q.x - x0, q.y - y0);
    for (const e of enemiesWithin(w, (x0 + q.x) / 2, (y0 + q.y) / 2, len / 2 + S.skim.w + 16)) {
      const rad = ENEMIES[e.kind].radius;
      if (segDist(e.x, e.y, x0, y0, q.x, q.y) > S.skim.w + rad * 0.5) continue;
      if (Math.hypot(e.x - q.x, e.y - q.y) <= q.r + rad) continue;
      // 往线的两边掀：从线上离它最近的那一点往外
      const vx = q.x - x0;
      const vy = q.y - y0;
      const k = Math.max(0, Math.min(1, ((e.x - x0) * vx + (e.y - y0) * vy) / (vx * vx + vy * vy || 1)));
      hitEnemy(w, e, { dmg: q.dmg, by: 'cudgel', owner: q.owner, from: { x: x0 + vx * k, y: y0 + vy * k }, kb: S.skim.kb, el: 'wood' }, ev);
    }
    return;
  }
  const stun = q.quake ? S.sigil.stun : big ? S.suiyue.stun : S.stun[tier];
  const kb = q.quake ? S.sigil.kb : big ? S.suiyue.kb : S.kb;
  for (const e of enemiesWithin(w, q.x, q.y, q.r + 16)) {
    const rad = ENEMIES[e.kind].radius;
    const d = Math.hypot(e.x - q.x, e.y - q.y);
    if (d > q.r + rad) continue;
    const core = q.quake ? 1 : d <= q.r * S.core.r + rad * 0.5 ? (e.kind === 'boss' ? S.core.boss : S.core.mul) : S.core.edge;
    hitEnemy(w, e, { dmg: q.dmg * core * (big && e.kind === 'boss' ? S.suiyue.boss : 1), by: 'cudgel', owner: q.owner, from: q, kb, el: 'wood', stun }, ev);
  }
  if (q.quake) return;
  // 仙品「雷纹」：落处留一圈雷纹，片刻后再炸一下（圈比砸的那一圈大一点：震开的也逃不出去）
  if (tier >= 3) {
    const id = w.nextId++;
    const r = q.r * S.sigil.grow;
    w.pending.push({ id, owner: q.owner, kind: 'staff', x: q.x, y: q.y, r, t: S.sigil.delay, dmg: q.dmg * S.sigil.mul, tier, quake: true, ...(q.spirit ? { spirit: q.spirit } : {}) });
    ev.push({ t: 'warn', id, kind: 'staff', x: q.x, y: q.y, r, t2: S.sigil.delay, tier });
  }
  // 弹起再砸一处：从这一砸的落点往 hopR 以内找下一群（离这里够远、离人物不出 REACH.max）
  const hops = q.hops ?? 0;
  const p = w.players[q.owner];
  if (hops <= 0 || !p) return;
  const reachMax = REACH.max * REACH.max;
  const c = pickCluster(w, q.x, q.y, S.hopR, [[q.x, q.y]], q.r * 0.9, (e) => d2(e.x, e.y, p.x, p.y) <= reachMax);
  if (!c) return;
  const wpn = { tier, spirit: q.spirit ?? null };
  // 奔雷：第一砸之后的每一砸一样重（比第一砸轻）；灵品起弹起再砸的那一下轻一些
  const dmg = q.spirit === 'benlei' ? (q.seq === 1 ? (q.dmg * S.benlei.next) / S.benlei.first : q.dmg) : q.dmg * S.next;
  launch(w, p, wpn, q.x, q.y, c.e, [c.cx, c.cy], S.hop, dmg, (q.seq ?? 1) + 1, hops - 1, ev);
}
