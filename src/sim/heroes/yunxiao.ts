// 云霄（主五行水；暂拟，待评审确认）的神通与专属法宝「混元金斗」。宠物青鸾在 pets/qingluan.ts，被动「冰心」在 passives.ts。
// - 专属法宝「混元金斗」：金斗飞到身边一小群敌人的上空，斗口一倾，把几只吸进去（吸进去的暂时从 w.enemies 里拿出来，
//   放在 Player.dou 上：谁也打不到、碰不到，也不动、不出手），在斗里摇一会儿，再从斗口喷出去、摔在地上（受伤、晕一下）。
//   凡 → 灵：吸得更大一片、更多只；仙「削去顶上三花」：吸进去的被削去顶上三花，喷出来以后一段时间受到的伤害提高；
//   神品器灵「倒海」：喷出去的敌人被砸向身边别的敌人，一路撞翻挡路的；「收宝」：一斗多吸几只、精英也吸得进去，
//   吸进去的敌人身上的增益（落魂幡手给的护体、加速）被收走。
//   首领、首领召出来的东西（落魂幡、草人）、点着了引信的爆符鬼、正卷在九曲黄河里的，都吸不进去；精英只有「收宝」吸得进去。
//   吸的那一会儿（约半秒）斗口下方一大片都被往里拽（精英拽得慢、首领拽不动），拽进吸的半径里的就吸进去，吸满为止。
//   身边只有吸不进去的（首领战、单独一只精英）：金斗飞到它头上浇下一斗混元之水（伤害更重，仙品起一样削去三花）。
// - 神通「九曲黄河」：脚下铺开一圈黄河水，圈里的敌人（首领不卷）被卷着慢慢转、收向中心，最后一起砸下（伤害、晕、往外震开）。
//   卷着的时候每帧给位置，晕眩每帧只续 0.1 秒（不走、不出手、撞不到人；也不到贴镇魂符的 0.4 秒），法宝照样打得到。
// 斗里的、水里卷着的敌人都不跨波：这一波结束（heroWaveEnd）就清掉；主人倒下、出局、离开时（heroIdle）斗里的当场掉出来。
import { ARENA, DT, ENEMIES, MIASMA, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, segDist, weaponDamage } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import type { DouCast, Enemy, EnemyKindName, OwnedWeapon, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

// ---------------------------------------------------------------- 专属法宝「混元金斗」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const DOU = {
  seek: REACH.seek - 20, // 110：只挑离人物（脚下）这么远以内的敌群
  // 一斗的节奏（秒）：金斗飞过去、斗口一倾吸进去、在斗里摇、喷出去到落地
  fly: 0.22,
  suck: 0.45, // 吸的这一会儿：斗口下方一大片都被往里拽，拽进吸的半径里的就吸进去
  hold: 0.7,
  fall: 0.36,
  pull: { r: 1.9, acc: 520 }, // 拽的范围（吸的半径的倍数）、拽的劲（击退速度每秒加多少，按质量分）
  r: [0, 33, 36, 36, 37], // 2026-11-11 数值平衡（没成型不秒杀）：凡 / 灵品斗口大一点（30 / 33 → 33 / 36）、多吸一只（见 n）、只吸到一只时不再摔得更重（见 few）、单发倍率 1.1 / 1.62 / 1.64 → 0.92 / 1.3 / 1.5（凡品一下打死 62% → 23%、灵品 69% → 34%）。吸的半径（以斗口正下方的地面为圆心的椭圆，上下压成 FLAT；吃范围加成，最多 +REACH.area）
  lead: 7, // 斗口对准那几只的中心再往人物这边挪一点（金斗飞过去的那一会儿，它们正朝人物走过来）
  n: [0, 5, 6, 7, 7], // 2026-11-11 凡 4 → 5、灵 5 → 6；一斗最多吸几只
  mul: 1.0, // 摔下来那一下
  stun: 0.85, // 摔下来晕多久（2026-11-11 数值平衡 0.6 → 0.85：单发轻了，摔下来多晕一会儿）
  splash: 18, // 落地时砸到身边这么近的别的敌人（吸不进去的精英、首领也挨）
  splashMul: 0.5,
  spread: [12, 28], // 喷出去落在斗口下方这么远的一圈上（朝着离人物远的那边散开）
  fan: 0.62, // 散开的角度间隔（弧度）
  sanhua: [0, 0, 0, 0.3, 0.35], // 仙品起「削去顶上三花」：喷出来以后受到的伤害 +这么多
  sanhuaT: 5, // 削去三花多久
  dao: { len: 64, w: 8, mul: 0.5, kb: 80 }, // 器灵「倒海」：喷出去的砸向别的敌人，最远这么远；沿路半宽 w 内撞到的挨一下；mul 0.75 → 0.5（2026-11-11：倒海的群伤偏高）
  shou: { n: 3 }, // 器灵「收宝」：一斗多吸三只、精英也吸得进去，吸进去的收走护体与加速
  // 身边没有吸得进去的、只有吸不进去的（首领、精英、首领召出来的）：金斗飞到它头上，斗口一倾，浇下一斗混元之水
  // 只吸到一只时摔得更重：每只 max(1, few ÷ 只数) 倍，按品阶（原来各品阶都是 1.4、和浇的 pour.mul 是同一个数；2026-11-11 数值平衡拆开、按品阶给：
  // 凡 / 灵品不加——没成型不秒杀，仙品起照旧）
  few: [0, 1, 1, 1.4, 1.4],
  // mul 按品阶（2026-11-11 数值平衡：原来各品阶都是 1.4）：凡 / 灵品单发压轻以后她第一章首领打不动（120 局只通 80 局、21 局死在第一章首领），浇的那一斗凡 / 灵品给到 1.85；
  pour: { t: 0.34, mul: [0, 1.85, 1.85, 1.5, 1.5], splash: 0.4 }, //浇多久（之后落下那一下）、伤害（相对一斗的伤害）、身边溅到的
  preferBoss: 3, // 首领就在身边时，吸得进去的不到这么多只就先浇首领
};

/** 吸不进去的：首领、首领召出来的（不会动、不伤人的东西）。精英要「收宝」才吸得进去。 */
const NEVER: ReadonlySet<EnemyKindName> = new Set<EnemyKindName>(['boss', 'soulflag', 'strawman']);
function suckable(w: World, e: Enemy, shou: boolean): boolean {
  if (e.hp <= 0 || e.invuln > 0 || NEVER.has(e.kind)) return false;
  if (e.kind === 'elite' && !shou) return false;
  if (e.act === 'fuse') return false; // 点着了引信的爆符鬼：打不死、不吃控制
  if (e.riverHeld !== undefined && w.time < e.riverHeld) return false; // 正卷在九曲黄河里
  return true;
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/**
 * 地上的一圈按透视压扁成椭圆（纵向 FLAT 倍，和水域、地裂这些地面效果的画法同一个口径）：金斗吸的那一片、九曲黄河的水，
 * 判定和画面都是这个椭圆——卷着转的敌人沿椭圆走，才和画出来的水对得上。edist2 是按这个椭圆量的距离的平方。
 */
export const FLAT = 0.62;
const edist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + ((a.y - b.y) / FLAT) ** 2;
const suckR = (p: Player, tier: number) => DOU.r[tier] * (1 + Math.min(REACH.area, p.stats.area));
const capOf = (tier: number, spirit: string | null) => DOU.n[tier] + (spirit === 'shou' ? DOU.shou.n : 0);

/**
 * 瞄准：离人物 seek 以内吸得进去的敌人里，挑一处让半径 r 的一斗罩住最多只的（一样多就挑近的、正在蓄力的先），
 * 斗口对准那几只的中心。没有吸得进去的返回 null（不出手）。
 */
function aimDou(w: World, p: Player, r: number, cap: number, shou: boolean): { x: number; y: number; n: number } | null {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, DOU.seek)
    .filter((e) => suckable(w, e, shou))
    .sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return null;
  let best = near[0];
  let bs = -1e9;
  for (const c of near.slice(0, 10)) {
    let n = 0;
    for (const e of near) if (edist2(e, c) <= r * r) n++;
    const s = Math.min(n, cap) * 2 + (c.act === 'windup' ? 1.5 : 0) - Math.sqrt(dist2(c, p)) / DOU.seek;
    if (s > bs) {
      bs = s;
      best = c;
    }
  }
  const group = near.filter((e) => edist2(e, best) <= r * r).slice(0, cap);
  let x = 0;
  let y = 0;
  for (const e of group) {
    x += e.x / group.length;
    y += e.y / group.length;
  }
  const d = Math.hypot(p.x - x, p.y - y);
  if (d > DOU.lead * 2) {
    x += ((p.x - x) / d) * DOU.lead;
    y += ((p.y - y) / d) * DOU.lead;
  }
  return { x, y, n: group.length };
}

/** 浇谁：离人物 seek 以内（首领先），最近的那只。bossOnly：只找首领（身边还有零星几只吸得进去的时候）。 */
function pourTarget(w: World, p: Player, bossOnly: boolean): Enemy | null {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, DOU.seek).filter((e) => e.hp > 0 && e.invuln <= 0 && e.act !== 'fuse');
  if (!near.length) return null;
  const boss = near.find((e) => e.kind === 'boss');
  if (boss || bossOnly) return boss ?? null;
  return near.sort((a, b) => dist2(a, p) - dist2(b, p) || a.id - b.id)[0];
}

/** 出手（weapons.ts 的 FIRE 表调）：上一斗还没落地就不出；挑好一处，金斗起飞（之后每帧在 updateDou 里推进）。 */
export function fireDou(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  if (p.dou) return false;
  const shou = wpn.spirit === 'shou';
  const r = suckR(p, wpn.tier);
  let at: { x: number; y: number; n: number } | null = aimDou(w, p, r, capOf(wpn.tier, wpn.spirit), shou);
  let pour = -1;
  // 没有吸得进去的、或者首领就在身边而吸得进去的只有零星一两只：浇（首领在就先浇首领）
  const big = !at || at.n < DOU.preferBoss ? pourTarget(w, p, !!at) : null;
  if (big) {
    at = { x: big.x, y: big.y, n: 1 };
    pour = big.id;
  }
  if (!at) return false;
  const t0 = w.time;
  const tSuck = t0 + DOU.fly;
  const tSpit = pour >= 0 ? tSuck : tSuck + DOU.suck + DOU.hold;
  p.dou = {
    x: at.x,
    y: at.y,
    r,
    t0,
    tSuck,
    tSpit,
    tLand: pour >= 0 ? tSuck + DOU.pour.t : tSpit + DOU.fall,
    pour,
    tier: wpn.tier,
    spirit: wpn.spirit,
    dmg: weaponDamage(p, wpn, p.buffs.rage) * DOU.mul,
    held: [],
    from: [],
    at: [],
    land: [],
  };
  if (Math.abs(at.x - p.x) > 2) p.facing = at.x >= p.x ? 1 : -1;
  ev.push({ t: 'dou', owner: p.id, act: 'cast', x: at.x, y: at.y, r, ids: [], tier: wpn.tier, spirit: wpn.spirit });
  return true;
}

/**
 * 斗口一倾，吸（吸的那一会儿每帧调：first 是第一帧）：斗口下方一大片（pull 倍的半径）里的都被往斗口下方拽，
 * 拽进吸的半径里的吸得进去的，就拿出 w.enemies、放进斗里（at 记下是哪一刻吸进去的，表现层照它画「被吸进去」那一段），
 * 吸满 capOf 只为止；吸不进去的（精英、首领）只被拽一下、拽不动首领。
 */
function suckTick(w: World, p: Player, d: DouCast, dt: number, first: boolean, ev: SimEvent[]) {
  const shou = d.spirit === 'shou';
  const cap = capOf(d.tier, d.spirit);
  const R = d.r * DOU.pull.r;
  buildGrid(w.enemies);
  const around = enemiesWithin(w, d.x, d.y, R + 8).filter((e) => edist2(e, d) <= R * R);
  const got =
    d.held.length >= cap
      ? []
      : around
          .filter((e) => edist2(e, d) <= d.r * d.r && suckable(w, e, shou))
          .sort((a, b) => edist2(a, d) - edist2(b, d) || a.id - b.id)
          .slice(0, cap - d.held.length);
  const ids = new Set(got.map((e) => e.id));
  for (const e of around) {
    if (ids.has(e.id) || e.kind === 'boss' || ENEMIES[e.kind].mass > 100) continue;
    // 拽：越近越使劲（吸得进去的拽得动，精英拽得慢）
    const dx = d.x - e.x;
    const dy = d.y - e.y;
    const dd = Math.hypot(dx, dy) || 1;
    const k = (DOU.pull.acc * dt * (1.2 - 0.6 * Math.min(1, dd / R))) / ENEMIES[e.kind].mass;
    e.kx += (dx / dd) * k;
    e.ky += (dy / dd) * k;
  }
  // 第三章的阵图傀儡（两只一组、连着剑气线）：吸进去的那只和另一只的线断干净——吸进去的不再认它的另一只（喷出来以后不会单边连回去）；
  // 另一只留在外面的，它自己下一帧发现另一只不在了就断线、报 tetherCut（sim/ch3/foes.ts）；两只都吸进去了，这里报一次
  for (const e of got) {
    if (e.kind !== 'puppet' || e.mate === undefined || e.mate < 0) continue;
    const m = got.find((o) => o.id === e.mate) ?? d.held.find((o) => o.id === e.mate);
    if (m && e.id < m.id) ev.push({ t: 'tetherCut', a: e.id, b: m.id, x0: e.x, y0: e.y, x1: m.x, y1: m.y });
    if (m) m.mate = -1;
    e.mate = -1;
  }
  if (got.length) w.enemies = w.enemies.filter((e) => !ids.has(e.id));
  for (const e of got) {
    d.from.push([e.x, e.y]);
    d.at.push(w.time);
    // 进了斗：出手打断（和晕住一样），击退归零，被黑虎吓着的也不再逃（喷出来以后照常追人）；收宝：护体、加速被收走
    e.act = undefined;
    e.actT = 0;
    e.actLen = 0;
    e.kx = e.ky = 0;
    e.fearUntil = undefined;
    if (shou) {
      e.ward = 0;
      e.wardT = 0;
      e.haste = 0;
    }
    d.held.push(e);
  }
  if (first) ev.push({ t: 'dou', owner: p.id, act: 'suck', x: d.x, y: d.y, r: d.r, ids: got.map((e) => e.id), tier: d.tier, spirit: d.spirit });
}

/** 落点夹在场地里（魔气带外沿以内）。 */
function inArena(x: number, y: number): [number, number] {
  const D = MIASMA.depth - 8;
  return [Math.max(-D, Math.min(ARENA.w + D, x)), Math.max(-D, Math.min(ARENA.h + D, y))];
}

/**
 * 喷出：定下每只的落点。平常朝着离人物远的那一边散开一小圈；「倒海」砸向斗口附近别的敌人（一只砸一只，没有就照常散开）。
 */
function spit(w: World, p: Player, d: DouCast, ev: SimEvent[]) {
  const n = d.held.length;
  let a = Math.atan2(d.y - p.y, d.x - p.x);
  if (dist2(d, p) < 16) a = p.facing > 0 ? 0 : Math.PI;
  const targets: Enemy[] = [];
  if (d.spirit === 'dao') {
    buildGrid(w.enemies);
    targets.push(
      ...enemiesWithin(w, d.x, d.y, DOU.dao.len)
        .filter((e) => dist2(e, d) > 10 * 10)
        .sort((x, y) => dist2(x, d) - dist2(y, d) || x.id - y.id)
        .slice(0, n),
    );
  }
  d.land = d.held.map((_, i) => {
    const t = targets[i];
    if (t) {
      const dx = t.x - d.x;
      const dy = t.y - d.y;
      const dd = Math.hypot(dx, dy) || 1;
      const L = Math.min(DOU.dao.len, dd + 6);
      return inArena(d.x + (dx / dd) * L, d.y + (dy / dd) * L);
    }
    const b = a + (i - (n - 1) / 2) * DOU.fan;
    const r = DOU.spread[0] + (DOU.spread[1] - DOU.spread[0]) * w.rng.next();
    return inArena(d.x + Math.cos(b) * r, d.y + Math.sin(b) * r * FLAT);
  });
  ev.push({ t: 'dou', owner: p.id, act: 'spit', x: d.x, y: d.y, r: d.r, ids: d.held.map((e) => e.id), tier: d.tier, spirit: d.spirit });
}

/** 落地：喷出去的回到 w.enemies，摔下来受伤、晕一下（仙品起削去三花）；落点身边的、倒海一路撞到的别的敌人也挨一下。 */
function land(w: World, p: Player, d: DouCast, ev: SimEvent[]) {
  const back = d.held;
  back.forEach((e, i) => {
    const [x, y] = d.land[i] ?? d.from[i] ?? [d.x, d.y];
    e.x = e.px = x;
    e.y = e.py = y;
    e.kx = e.ky = 0;
  });
  w.enemies.push(...back);
  d.held = [];
  const heldIds = new Set(back.map((e) => e.id));
  const hit: number[] = [];
  const seen = new Set<number>();
  buildGrid(w.enemies);
  // 倒海：一路撞到的（同一斗里一只只挨一次）
  if (d.spirit === 'dao') {
    back.forEach((e, i) => {
      const [x1, y1] = d.land[i] ?? [e.x, e.y];
      const len = Math.hypot(x1 - d.x, y1 - d.y);
      for (const o of enemiesWithin(w, (d.x + x1) / 2, (d.y + y1) / 2, len / 2 + 14)) {
        if (heldIds.has(o.id) || seen.has(o.id)) continue;
        if (segDist(o.x, o.y, d.x, d.y, x1, y1) > DOU.dao.w + ENEMIES[o.kind].radius * 0.5) continue;
        seen.add(o.id);
        hit.push(o.id);
        hitEnemy(w, o, { dmg: d.dmg * DOU.dao.mul, by: 'dou', owner: p.id, from: { x: d.x, y: d.y }, kb: DOU.dao.kb, el: 'water' }, ev);
      }
    });
  }
  // 摔下来的那几只：一斗之力分给斗里的这几只——只吸到一两只时摔得更重（和浇一样重），三只起每只照常
  const each = d.dmg * Math.max(1, DOU.few[d.tier] / Math.max(1, back.length));
  for (const e of back) {
    hitEnemy(w, e, { dmg: each, by: 'dou', owner: p.id, from: { x: d.x, y: d.y }, kb: 30, el: 'water', stun: DOU.stun }, ev);
    if (e.hp > 0 && DOU.sanhua[d.tier] > 0) {
      e.sanhua = Math.max(e.sanhua ?? 0, DOU.sanhua[d.tier]);
      e.sanhuaUntil = Math.max(e.sanhuaUntil ?? 0, w.time + DOU.sanhuaT);
    }
  }
  // 落点身边砸到的别的敌人（精英、首领也挨）
  for (const e of back) {
    for (const o of enemiesWithin(w, e.x, e.y, DOU.splash + 8)) {
      if (heldIds.has(o.id) || seen.has(o.id)) continue;
      if (dist2(o, e) > (DOU.splash + ENEMIES[o.kind].radius * 0.5) ** 2) continue;
      seen.add(o.id);
      hit.push(o.id);
      hitEnemy(w, o, { dmg: d.dmg * DOU.splashMul, by: 'dou', owner: p.id, from: e, kb: 40, el: 'water' }, ev);
    }
  }
  ev.push({ t: 'dou', owner: p.id, act: 'land', x: d.x, y: d.y, r: d.r, ids: back.map((e) => e.id), hit, tier: d.tier, spirit: d.spirit });
}

/**
 * 每帧推进这一斗：到点吸、到点喷、到点落地。weapons.updateWeapons 每帧调（跟着法宝走，不跟着角色走：
 * 谁手里有金斗、谁身上有这一斗，就推进谁的——测试、工具里给别的角色装上金斗也照常）。
 */
export function updateDou(w: World, p: Player, ev: SimEvent[]) {
  const d = p.dou;
  if (!d) return;
  if (w.time > d.tLand + 1) {
    // 上一波留下来的（不该有：波末 heroWaveEnd 会清掉）——兜底，直接扔掉
    delete p.dou;
    return;
  }
  if (d.pour >= 0) {
    // 浇：跟着那一只走（它会动），到点浇下去
    const t = w.enemies.find((e) => e.id === d.pour && e.hp > 0);
    if (t && w.time < d.tSuck) {
      d.x = t.x;
      d.y = t.y;
    }
    if (!d.began && w.time >= d.tSuck - 1e-9) {
      d.began = true; // 开始浇了（浇的时候金斗不再挪）
      ev.push({ t: 'dou', owner: p.id, act: 'spit', x: d.x, y: d.y, r: d.r, ids: [], tier: d.tier, spirit: d.spirit, pour: d.pour });
    }
    if (w.time >= d.tLand - 1e-9) {
      pourDown(w, p, d, t ?? null, ev);
      delete p.dou;
    }
    return;
  }
  const tEnd = d.tSuck + DOU.suck;
  if (w.time >= d.tSuck - 1e-9 && w.time < tEnd - 1e-9) {
    suckTick(w, p, d, DT, !d.began, ev);
    d.began = true;
  } else if (w.time >= tEnd - 1e-9 && !d.held.length && d.tSpit > w.time) {
    // 一只都没吸到（敌群在金斗飞过去的时候走开了）：斗口收回，不摇也不喷
    d.tSpit = d.tLand = w.time;
  }
  if (d.held.length && !d.land.length && w.time >= d.tSpit - 1e-9) spit(w, p, d, ev);
  if (w.time >= d.tLand - 1e-9) {
    land(w, p, d, ev);
    delete p.dou;
  }
}

/** 浇下去：那一只挨一下重的（仙品起削去三花），身边溅到的挨一点。 */
function pourDown(w: World, p: Player, d: DouCast, t: Enemy | null, ev: SimEvent[]) {
  const hit: number[] = [];
  buildGrid(w.enemies);
  if (t && t.hp > 0) {
    hit.push(t.id);
    hitEnemy(w, t, { dmg: d.dmg * DOU.pour.mul[d.tier], by: 'dou', owner: p.id, from: { x: d.x, y: d.y - 1 }, el: 'water' }, ev);
    if (t.hp > 0 && DOU.sanhua[d.tier] > 0) {
      t.sanhua = Math.max(t.sanhua ?? 0, DOU.sanhua[d.tier]);
      t.sanhuaUntil = Math.max(t.sanhuaUntil ?? 0, w.time + DOU.sanhuaT);
    }
  }
  for (const o of enemiesWithin(w, d.x, d.y, DOU.splash + 12)) {
    if (o === t || hit.includes(o.id) || dist2(o, d) > (DOU.splash + ENEMIES[o.kind].radius * 0.5) ** 2) continue;
    hit.push(o.id);
    hitEnemy(w, o, { dmg: d.dmg * DOU.pour.splash, by: 'dou', owner: p.id, from: d, kb: 40, el: 'water' }, ev);
  }
  ev.push({ t: 'dou', owner: p.id, act: 'land', x: d.x, y: d.y, r: d.r, ids: [], hit, tier: d.tier, spirit: d.spirit, pour: d.pour });
}

/** 斗里的当场掉出来（主人倒下、出局、离开）：回到被吸之前站的地方（已经喷出来的落在落点），晕一下，不受伤。 */
function dropDou(w: World, p: Player, ev: SimEvent[]) {
  const d = p.dou;
  if (!d) return;
  const back = d.held;
  back.forEach((e, i) => {
    const [x, y] = d.land[i] ?? d.from[i] ?? [d.x, d.y];
    e.x = e.px = x;
    e.y = e.py = y;
    e.stun = Math.max(e.stun, 0.3);
  });
  w.enemies.push(...back);
  if (back.length) ev.push({ t: 'dou', owner: p.id, act: 'land', x: d.x, y: d.y, r: d.r, ids: back.map((e) => e.id), hit: [], tier: d.tier, spirit: d.spirit });
  delete p.dou;
}

// ---------------------------------------------------------------- 神通「九曲黄河」

export const RIVER = {
  r: 106, // 黄河水铺多远（以放的时候的脚下为圆心的椭圆：左右 r、上下 r × FLAT；吃一点范围加成和功法「混元一气」，最多 REACH.max）
  dur: 1.9, // 卷多久（之后一起砸下）
  catchT: 0.45, // 铺开之后这么久里走进圈的也卷进来
  rMin: 30, // 收到离中心最近多远（按椭圆量：左右 30、上下约 19）：卷成一圈围着她，不压在她身上、不把她挡住
  spin: 2.3, // 卷着转的角速度（弧度 / 秒，里圈转得比外圈快）
  elite: 0.5, // 精英卷得慢：收向中心只收这么多
  tick: 0.45, // 水流冲刷：每隔这么久一下小伤害
  tickDmg: 0.1, // 冲刷的伤害（相对 SKILL.damage）
  dmg: 1.0, // 砸下的伤害（相对 SKILL.damage；三头六臂也是 1 倍）
  stun: 0.9, // 砸下之后晕多久（首领不吃）
  slamR: 24, // 砸下时中心这么近的（卷着的以外，首领也算）一起挨
  kb: 150, // 砸下时往外震开
};

/** 卷得动的：首领、首领召出来的、点着引信的爆符鬼不卷；斗里的本来就不在 w.enemies 里。 */
const rollable = (e: Enemy) => e.hp > 0 && !NEVER.has(e.kind) && e.act !== 'fuse';

/** 把 (x, y) 半径 r 内还没卷进来的卷进来。 */
function catchIn(w: World, p: Player) {
  const rv = p.river!;
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, rv.x, rv.y, rv.r)) {
    if (!rollable(e) || rv.ids.includes(e.id) || edist2(e, rv) > rv.r * rv.r) continue;
    const rad = Math.max(RIVER.rMin, Math.sqrt(edist2(e, rv)));
    rv.ids.push(e.id);
    rv.ang.push(Math.atan2((e.y - rv.y) / FLAT, e.x - rv.x));
    rv.rad.push(rad);
    rv.rad0.push(rad);
  }
}

/** 放九曲黄河：脚下铺开一圈水，把圈里的卷起来（之后每帧在 updateRiver 里推进）。 */
export function huanghe(w: World, p: Player, ev: SimEvent[]) {
  const r = Math.min(REACH.max, RIVER.r * (1 + Math.min(REACH.area, p.stats.area)) * techSkillRadius(p));
  p.river = { x: p.x, y: p.y, r, t0: w.time, dur: RIVER.dur, dmg: SKILL.damage * (1 + p.stats.damage), tick: RIVER.tick, ids: [], ang: [], rad: [], rad0: [] };
  catchIn(w, p);
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: r, kind: 'huanghe', dur: RIVER.dur });
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/** 每帧：卷着转、收向中心、冲刷；到时一起砸下。 */
function updateRiver(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const rv = p.river;
  if (!rv) return;
  const t = w.time - rv.t0;
  if (t > rv.dur + 0.5) {
    delete p.river; // 上一波留下来的（兜底）
    return;
  }
  if (t <= RIVER.catchT) catchIn(w, p);
  const k = Math.min(1, t / rv.dur);
  const pull = smooth(k);
  const byId = new Map<number, Enemy>();
  for (const e of w.enemies) if (e.hp > 0) byId.set(e.id, e);
  for (let i = rv.ids.length - 1; i >= 0; i--) {
    const e = byId.get(rv.ids[i]);
    if (!e) {
      // 死了、被别的东西收走了：不再卷
      rv.ids.splice(i, 1);
      rv.ang.splice(i, 1);
      rv.rad.splice(i, 1);
      rv.rad0.splice(i, 1);
      continue;
    }
    const r0 = rv.rad0[i];
    const rad = r0 - (r0 - RIVER.rMin) * pull * (e.kind === 'elite' ? RIVER.elite : 1);
    rv.rad[i] = rad;
    rv.ang[i] -= RIVER.spin * (0.55 + 0.9 * (1 - rad / rv.r)) * dt; // 逆时针（画面上），里圈快
    e.x = rv.x + Math.cos(rv.ang[i]) * rad;
    e.y = rv.y + Math.sin(rv.ang[i]) * rad * FLAT;
    e.kx = e.ky = 0;
    e.stun = Math.max(e.stun, 0.1);
    e.riverHeld = rv.t0 + rv.dur;
  }
  rv.tick -= dt;
  if (rv.tick <= 0 && k < 1) {
    rv.tick += RIVER.tick;
    for (const id of rv.ids) {
      const e = byId.get(id);
      // 冲刷是持续伤害（和区域一样：不闪白、不打印记，盾也挡不住）
      if (e && e.hp > 0) hitEnemy(w, e, { dmg: rv.dmg * RIVER.tickDmg, by: 'zone', owner: p.id, from: rv, el: 'water' }, ev);
    }
  }
  if (k >= 1) {
    // 一起砸下：卷着的，加上中心附近的（首领也挨，但不晕）
    const ids = new Set(rv.ids);
    buildGrid(w.enemies);
    for (const e of enemiesWithin(w, rv.x, rv.y, RIVER.slamR + 12)) if (Math.sqrt(edist2(e, rv)) <= RIVER.slamR + ENEMIES[e.kind].radius) ids.add(e.id);
    const hitIds: number[] = [];
    for (const id of ids) {
      const e = byId.get(id);
      if (!e || e.hp <= 0) continue;
      hitIds.push(id);
      e.riverHeld = undefined;
      hitEnemy(w, e, { dmg: rv.dmg * RIVER.dmg, by: 'skill', owner: p.id, from: rv, el: 'water', stun: RIVER.stun, kb: RIVER.kb }, ev);
    }
    ev.push({ t: 'riverSlam', owner: p.id, x: rv.x, y: rv.y, r: rv.r, ids: hitIds });
    delete p.river;
  }
}

/** 每帧（战斗中、活着的时候）：九曲黄河的这一圈（金斗的这一斗跟着法宝走，见 updateDou）。 */
export function updateYunxiao(w: World, p: Player, dt: number, ev: SimEvent[]) {
  updateRiver(w, p, dt, ev);
}

/** 这个人倒下、出局、离开（不再推进）：斗里的掉出来，水里卷着的松开。不管是什么角色（身上没有这两样就什么都不做）。 */
export function dropHeld(w: World, p: Player, ev: SimEvent[]) {
  if (p.dou) dropDou(w, p, ev);
  if (p.river) {
    for (const e of w.enemies) if (p.river.ids.includes(e.id)) e.riverHeld = undefined;
    delete p.river;
  }
}

/** 这一波结束（敌人都清掉了）：斗里的、水里的跟着清掉，不带进下一波。 */
export function clearHeld(p: Player) {
  delete p.dou;
  delete p.river;
}
