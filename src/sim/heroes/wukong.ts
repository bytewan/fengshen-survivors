// 孙悟空（隐藏角色，主五行木；用户 11-11 确认）的神通「法天象地」、专属法宝「如意金箍棒」。宠物毫毛猴在 pets/maohou.ts，
// 被动「火眼金睛」（打精英、首领更疼）在 passives.ts。
// - 神通「法天象地」：身形长大（grow 秒长足，长足那一下脚下一震、震开身边的敌人），约 6 秒：金箍棒扫得更远（× reach）、
//   打得更重（× dmg），不吃风吼妖的吹开（passives.heroSteady）；到点变回原样（画面上慢慢缩回去）。
// - 如意金箍棒（近身）：抡起来横扫一圈（身边一整圈都挨），紧接着朝敌人最多的方向竖劈一棒（一条线，砸中的顿一顿）；
//   棒子随品阶变长（扫的半径、劈的长度都涨）；仙品「定海」竖劈落地震出一圈石刺（落点四周的挨一下、顿一顿）；
//   神品器灵「擎天」竖劈时棒子长成擎天柱（劈得又远又重，一路从近到远震出石刺），「搅海」横扫连转三圈（把身边的往里卷）再接竖劈。
//   一套招式按顺序走 OwnedWeapon.burst（和三尖两刃刀同一套：横扫在出手那一刻，后面几步由 weapons.updateWeapons 按间隔补上）。
//   石刺用 w.pending（kind 'rock'，先 warn 后 land；落地时 weapons.land 调 landRock）。
// 射程守 config.REACH：扫的半径不超过 REACH.seek，劈的长度不超过 REACH.max，石刺的圈吃范围加成最多算到 REACH.area。
// 数值是初值（2026-11-11），最后统一调。
import { ENEMIES, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, segDist, weaponDamage } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import type { OwnedWeapon, Pending, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { faxiangOn } from './passives.ts';

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** 挑方向时一只首领算几只（首领战里先劈首领）。 */
const BOSS_WEIGHT = 6;
/** 落点处的范围：范围加成最多算到 REACH.area（和番天印、定海珠一样）。 */
const aoe = (p: Player) => 1 + Math.min(p.stats.area, REACH.area);

// ---------------------------------------------------------------- 神通「法天象地」

export const FAXIANG = {
  dur: 4, // 大身形多久（从放的那一刻算；2026-11-11 数值平衡 6 → 5 → 4：商店扩到 26 件公共法宝以后他 120 局通 113 局，再收一档）
  grow: 0.35, // 长足要多久：长足的那一下脚下一震
  shrink: 0.45, // 画面上变回来要多久（模拟里到点就是原样；这一段只给画面）
  stomp: { r: 56, dmg: 0.8, kb: 150, stun: 0.15 }, // stun 0.3 → 0.15（2026-11-11 数值平衡，同下）； // 长足那一下：震开的半径（吃范围加成和功法「混元一气」，最多 REACH.seek）、伤害（相对 SKILL.damage）、震开、晕
  reach: 1.3, // 金箍棒扫的半径、劈的长度 ×（照样不超过 REACH）
  dmg: 1.1, // 金箍棒的伤害 ×（2026-11-11 数值平衡 1.35 → 1.2 → 1.1：先是金箍棒的群伤拉到中位数以后，机器人用他 120 局通 115 局，神通、被动、竖劈的顿一顿各收一点，回到 105 局）
  scale: 1.5, // 画面上身形放大多少（表现层用：game/heroes/faxiang-fx.ts）
};

/** 长足那一下震开的半径。 */
export const stompR = (p: Player) => Math.min(REACH.seek, FAXIANG.stomp.r * aoe(p) * techSkillRadius(p));

/** 放法天象地：身形开始长大，FAXIANG.grow 秒后脚下一震（在 updateWukong 里）。 */
export function faxiang(w: World, p: Player, ev: SimEvent[]) {
  p.faxiang = { t0: w.time, until: w.time + FAXIANG.dur, stomped: false, wave: w.wave };
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: stompR(p), kind: 'faxiang', dur: FAXIANG.dur });
}

/** 长足的那一下：脚下 stompR 内的敌人挨一下、被震开、晕一下（首领不晕）。 */
function stomp(w: World, p: Player, ev: SimEvent[]) {
  const S = FAXIANG.stomp;
  const r = stompR(p);
  const dmg = SKILL.damage * S.dmg * (1 + p.stats.damage);
  buildGrid(w.enemies);
  const ids: number[] = [];
  for (const e of enemiesWithin(w, p.x, p.y, r + 12)) {
    if (Math.hypot(e.x - p.x, e.y - p.y) > r + ENEMIES[e.kind].radius) continue;
    hitEnemy(w, e, { dmg, by: 'skill', owner: p.id, from: p, kb: S.kb, stun: S.stun }, ev);
    ids.push(e.id);
  }
  ev.push({ t: 'stomp', owner: p.id, x: p.x, y: p.y, r, ids });
}

/** 每帧：长足那一下震一震；到点、或者是上一波放的，就变回原样。 */
export function updateWukong(w: World, p: Player, _dt: number, ev: SimEvent[]) {
  const f = p.faxiang;
  if (!f) return;
  if (!faxiangOn(w, p)) {
    delete p.faxiang;
    return;
  }
  if (!f.stomped && w.time - f.t0 >= FAXIANG.grow - 1e-9) {
    f.stomped = true;
    stomp(w, p, ev);
  }
}

// ---------------------------------------------------------------- 专属法宝「如意金箍棒」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const JINGU = {
  // 横扫一圈：半径（棒长加上棍风；吃范围加成，最多 REACH.seek）、伤害、往外震开
  // 2026-11-11 数值平衡：半径、震开没有动，伤害 1 → 0.85（挪给竖劈）。试过把半径加长到 72–84：量具里的群伤也进得了 ±15%，
  // 可身边一圈都被扫干净，机器人四十局通 39–40 局；群伤改从竖劈那条线上补（见 docs/balance/log.md 第 6 轮）
  sweep: { r: [0, 56, 62, 66, 68], mul: 0.85, kb: 80 },
  // 竖劈：从脚前起朝 a 方向劈多长（吃范围加成，最多 far）、半宽、伤害、砸中的顿一顿（首领不顿）、扫完多久劈下
  // 2026-11-11 数值平衡：长 100 / 108 / 114 / 116 → 112 / 118 / 122 / 122、半宽 9 → 13、伤害 1.25 → 1.0
  // （原来凡 / 灵品群伤只有同品阶中位数的四分之三、单体高两三成：横扫只够得着贴身的，群伤靠这一条线串起拖在身后的敌群）
  smash: { len: [0, 112, 118, 122, 122], far: REACH.max - 8, w: 13, mul: 1.0, stun: 0.15, kb: 50, gap: 0.26 }, // stun 0.25 → 0.15（同上）
  // 仙品「定海」：竖劈落地，落点震出一圈石刺——半径（吃范围加成，最多 REACH.area）、多久后扎出来、伤害、晕、往外震开
  // 2026-11-11 数值平衡：半径 26 → 22、伤害 0.7 → 0.2（石刺重在顿住；原来仙品群伤 +23%）
  rock: { r: 22, delay: 0.22, mul: 0.2, stun: 0.4, kb: 70 },
  // 器灵「擎天」：棒子长成擎天柱——劈的长度、半宽、伤害；沿线从近到远震出几簇石刺，每簇的半径、一簇接一簇的间隔、伤害
  // 2026-11-11 数值平衡：那一劈 1.5 → 2.8、石刺 0.6 → 0.2、每簇半径 20 → 16（擎天是又远又重的一劈，群伤靠石刺的话比中位数高两成多）
  pillar: { len: REACH.max - 4, w: 13, mul: 2.8, rocks: 4, rockR: 16, gap: 0.07, rockMul: 0.2 },
  // 器灵「搅海」：一共转几圈、圈与圈的间隔、每圈的伤害、半径大多少、往里卷的力道（负的击退：朝人物拉）
  // 2026-11-11 数值平衡：每圈 0.6 → 0.3（器灵倍率 0.85 → 1.2：三圈轻一点、那一劈重一点）、半径放大 1.12 → 1.06、往里卷 55 → 30（群伤 +22% → 约 +10%）
  churn: { spins: 3, gap: 0.2, mul: 0.3, rGrow: 1.06, pull: 30 },
};

/** 这件法宝的一套招式在横扫之后还有哪几步（按顺序；OwnedWeapon.burst 记还剩几步）。 */
type Step = 'spin' | 'smash';
function steps(wpn: OwnedWeapon): Step[] {
  return wpn.spirit === 'jiaohai' ? [...Array<Step>(JINGU.churn.spins - 1).fill('spin'), 'smash'] : ['smash'];
}
const gapBefore = (st: Step) => (st === 'spin' ? JINGU.churn.gap : JINGU.smash.gap);

/** 法天象地期间棒子扫得更远（半径、长度的倍数；平常是 1）。 */
const bigK = (w: World, p: Player) => (faxiangOn(w, p) ? FAXIANG.reach : 1);
const sweepR = (w: World, p: Player, wpn: OwnedWeapon) =>
  Math.min(REACH.seek, JINGU.sweep.r[wpn.tier] * (1 + p.stats.area) * bigK(w, p) * (wpn.spirit === 'jiaohai' ? JINGU.churn.rGrow : 1));
const smashLen = (w: World, p: Player, wpn: OwnedWeapon) =>
  wpn.spirit === 'qingtian' ? JINGU.pillar.len : Math.min(JINGU.smash.far, JINGU.smash.len[wpn.tier] * (1 + p.stats.area) * bigK(w, p));
/** 这一下的伤害：法宝单发伤害 × 法天象地的倍数。 */
const staffDmg = (w: World, p: Player, wpn: OwnedWeapon) => weaponDamage(p, wpn, p.buffs.rage) * (faxiangOn(w, p) ? FAXIANG.dmg : 1);
/** 胸口（横扫的圆心）。 */
const chest = (p: Player) => ({ x: p.x, y: p.y - 8 });

/** 竖劈那条线：从脚前 8 像素起，朝 a 方向 len 长（地面高度）。 */
function lineOf(p: Player, a: number, len: number): [number, number, number, number] {
  return [p.x + Math.cos(a) * 8, p.y + Math.sin(a) * 6, p.x + Math.cos(a) * len, p.y + Math.sin(a) * len];
}

/**
 * 瞄准：够得着的最近几只（和够得着的首领）里挑一个方向，让「竖劈的那条线」罩住最多的敌人（首领算 BOSS_WEIGHT 只；一样多就挑近的）。
 * 扫得到、劈得到的范围里都没有敌人返回 null（不出手）。
 */
function aim(w: World, p: Player, wpn: OwnedWeapon): number | null {
  const r = sweepR(w, p, wpn);
  const len = smashLen(w, p, wpn);
  const hw = wpn.spirit === 'qingtian' ? JINGU.pillar.w : JINGU.smash.w;
  buildGrid(w.enemies);
  // 只挑索敌半径（REACH.seek）以内的：劈得再远，也只朝够得着的敌人劈
  const near = enemiesWithin(w, p.x, p.y, Math.min(REACH.seek, Math.max(r, len) + 8)).sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return null;
  const boss = near.find((e) => e.kind === 'boss');
  const pool = boss && near.indexOf(boss) >= 8 ? [...near.slice(0, 8), boss] : near.slice(0, 8);
  let best = Math.atan2(near[0].y - p.y, near[0].x - p.x);
  let bestN = -1;
  for (const c of pool) {
    const a = Math.atan2(c.y - p.y, c.x - p.x);
    const [x0, y0, x1, y1] = lineOf(p, a, len);
    let n = 0;
    for (const e of near) if (segDist(e.x, e.y, x0, y0, x1, y1) <= hw + ENEMIES[e.kind].radius * 0.5) n += e.kind === 'boss' ? BOSS_WEIGHT : 1;
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  return best;
}

/** 横扫一圈：胸口为圆心、半径 r 内的都挨一下（spin > 1 是「搅海」的后几圈：往里卷，不往外震）。 */
function sweep(w: World, p: Player, wpn: OwnedWeapon, a: number, spin: number, ev: SimEvent[]) {
  const J = JINGU;
  const churn = wpn.spirit === 'jiaohai';
  const r = sweepR(w, p, wpn);
  const o = chest(p);
  const big = faxiangOn(w, p);
  ev.push({ t: 'staffSweep', owner: p.id, x: o.x, y: o.y, r, a, dir: p.facing, spin, kind: 'jingu', tier: wpn.tier, ...(big ? { big: true } : {}) });
  const dmg = staffDmg(w, p, wpn) * J.sweep.mul * (churn ? J.churn.mul : 1);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, o.x, o.y + 6, r + 16)) {
    if (Math.hypot(e.x - o.x, e.y - 6 - o.y) > r + ENEMIES[e.kind].radius) continue;
    hitEnemy(w, e, { dmg, by: 'staff', owner: p.id, from: p, kb: churn ? -J.churn.pull : J.sweep.kb, el: 'wood' }, ev);
  }
}

/** 竖劈：棒子从头顶朝 a 方向劈下，线上的都挨一下、顿一顿；仙品起落点震出石刺（擎天：一路震出几簇）。 */
function smash(w: World, p: Player, wpn: OwnedWeapon, a: number, ev: SimEvent[]) {
  const J = JINGU;
  const pillar = wpn.spirit === 'qingtian';
  const len = smashLen(w, p, wpn);
  const hw = pillar ? J.pillar.w : J.smash.w;
  const [x0, y0, x1, y1] = lineOf(p, a, len);
  p.facing = Math.cos(a) >= 0 ? 1 : -1;
  const big = faxiangOn(w, p);
  ev.push({ t: 'staffSmash', owner: p.id, x0, y0, x1, y1, w: hw, kind: 'jingu', tier: wpn.tier, ...(pillar ? { spirit: 'qingtian' } : {}), ...(big ? { big: true } : {}) });
  const base = staffDmg(w, p, wpn);
  const dmg = base * J.smash.mul * (pillar ? J.pillar.mul : 1);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + hw + 14)) {
    if (segDist(e.x, e.y, x0, y0, x1, y1) > hw + ENEMIES[e.kind].radius * 0.5) continue;
    hitEnemy(w, e, { dmg, by: 'staff', owner: p.id, from: p, kb: J.smash.kb, el: 'wood', stun: J.smash.stun }, ev);
  }
  if (wpn.tier < 3) return;
  if (pillar) {
    // 擎天：沿线从近到远震出几簇石刺
    const P = J.pillar;
    for (let i = 0; i < P.rocks; i++) {
      const k = (i + 1) / P.rocks;
      rock(w, p, wpn.tier, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, P.rockR * aoe(p), J.rock.delay + i * P.gap, base * P.rockMul, ev);
    }
  } else rock(w, p, wpn.tier, x1, y1, J.rock.r * aoe(p), J.rock.delay, base * J.rock.mul, ev);
}

/**
 * 石刺：t2 秒后在 (x, y) 扎出一圈（半径 r）。先发 warn（表现层画地上的裂纹），到时 weapons.land 调 landRock。
 * 落点和别的落点一样不超过 REACH.seek（劈得比索敌半径远时，往人物那边收一点）。
 */
function rock(w: World, p: Player, tier: number, x: number, y: number, r: number, t2: number, dmg: number, ev: SimEvent[]) {
  const d = Math.hypot(x - p.x, y - p.y);
  if (d > REACH.seek) {
    x = p.x + ((x - p.x) * REACH.seek) / d;
    y = p.y + ((y - p.y) * REACH.seek) / d;
  }
  const id = w.nextId++;
  w.pending.push({ id, owner: p.id, kind: 'rock', x, y, r, t: t2, dmg, tier });
  ev.push({ t: 'warn', id, kind: 'rock', x, y, r, t2, tier });
}

/** 石刺扎出来（weapons.land 调；调之前已经 buildGrid）：落点 r 内的敌人挨一下、顿一顿（首领不顿）、往外震开。 */
export function landRock(w: World, q: Pending, ev: SimEvent[]) {
  const R = JINGU.rock;
  for (const e of enemiesWithin(w, q.x, q.y, q.r + 16)) {
    if (Math.hypot(e.x - q.x, e.y - q.y) > q.r + ENEMIES[e.kind].radius) continue;
    hitEnemy(w, e, { dmg: q.dmg, by: 'rock', owner: q.owner, from: q, kb: R.kb, el: 'wood', stun: R.stun }, ev);
  }
}

/** 出手（weapons.ts 的 FIRE 表调）：先横扫一圈，后面几步记进 burst，由 weapons.updateWeapons 按间隔补上（jinguStep）。 */
export function fireJingu(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const a = aim(w, p, wpn);
  if (a === null) return false;
  p.facing = Math.cos(a) >= 0 ? 1 : -1;
  sweep(w, p, wpn, a, 1, ev);
  const rest = steps(wpn);
  wpn.burst = rest.length;
  wpn.burstT = gapBefore(rest[0]);
  wpn.aim = a;
  return true;
}

/**
 * 一套招式里横扫之后的下一步（weapons.updateWeapons 在 burst 到点时调；那时 burst 已经减过一）。
 * 搅海的后几圈接着转；竖劈重新瞄准（敌人在动；够不着就沿着出手时的方向）。
 */
export function jinguStep(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]) {
  const rest = steps(wpn);
  const i = rest.length - (wpn.burst ?? 0) - 1;
  const st = rest[i];
  if (!st) return;
  const a0 = wpn.aim ?? (p.facing > 0 ? 0 : Math.PI);
  if (st === 'spin') sweep(w, p, wpn, a0, i + 2, ev);
  else {
    const a = aim(w, p, wpn) ?? a0;
    wpn.aim = a;
    smash(w, p, wpn, a, ev);
  }
  const next = rest[i + 1];
  if (next) wpn.burstT = gapBefore(next);
}
