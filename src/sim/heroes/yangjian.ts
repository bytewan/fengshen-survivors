// 杨戬（主五行金；暂拟，待评审确认）的神通、被动和专属法宝「三尖两刃刀」。宠物哮天犬在 pets/xiaotian.ts。
// - 神通「天眼」：额上的天眼睁开，一道金光扫过身前的扇面（自动朝敌人最多的方向），照到的敌人定身约 1.5 秒（首领不吃）、
//   挨一下金光，并被标记：之后几秒受到的伤害提高（Enemy.gaze / gazeUntil，结算在 core.hitEnemy）。
// - 被动「乘隙」：暴击之后 1 秒内移速 +20%（规则在 passives.ts：暴击的那一刻 core.hitEnemy 要调到它，放在一个不引别的模块的小文件里）。
// - 三尖两刃刀（近身）：一记横扫（扇面）紧接着朝前一刺（贯穿一串）；灵品扫得更宽、刺得更远、多穿几只；
//   仙品「劈山」刺完再从头顶一劈，地上裂开一道金光（裂缝上的都挨一下、顿一顿）；神品器灵「开天」一劈三道（扇形、更远），
//   「回锋」横扫之后反手再扫回来一刀（扫得更远）、连刺两下。一套招式按顺序走 OwnedWeapon.burst（和火尖枪的两连刺同一套）。
// 数值（2026-11-11，tools/weapon-dps.ts 量过、拉到同品阶中位数附近，最后统一调）：群伤 凡 −18% / 灵 −8% / 仙 −16% / 开天 −3% / 回锋 −12%，
// 单体 +1% / +6% / +21% / +8% / +27%。
// 射程守 config.REACH：索敌不超过 REACH.seek，刺、劈伸出去的长度吃范围加成但不超过 REACH.max。
import { ENEMIES, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, segDist, weaponDamage } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import { inSector } from '../zones.ts';
import type { OwnedWeapon, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

// ---------------------------------------------------------------- 神通「天眼」

export const GAZE = {
  r: 122, // 金光照多远（以脚下为圆心；吃一点范围加成和功法「混元一气」，最多 REACH.max）
  arc: 0.72, // 扇面的半张角（±41°）
  dur: 0.55, // 扫一下要多久（两头慢、中间快）
  stun: 1.5, // 照到的定身多久（首领不吃控制）
  mark: 0.3, // 标记：受到的伤害 +30%（2026-11-11 数值平衡 0.4 → 0.3：用户说杨戬「输出快就得低一点」，机器人用他通过率比别的角色高一截）
  markT: 6, // 标记多久（比定身长得多：定住的那一下打完，还要接着挨打）
  dmg: 0.6, // 金光本身的伤害（相对 SKILL.damage；三头六臂是 1 倍，但天眼的本事在定身和标记）
};

const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** 挑方向时一只首领算几只（首领战里先照首领）。 */
const BOSS_WEIGHT = 6;

/**
 * 扇面瞄准：在最近的几只（和够得着的首领）里挑一个方向，让朝那边、半径 r、半张角 arc 的扇面罩住最多的敌人
 * （首领算 BOSS_WEIGHT 只；一样多就挑近的）。身边没有敌人就朝人物面朝的方向。返回角度。
 */
function aimFan(w: World, p: Player, x0: number, y0: number, r: number, arc: number): number {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, x0, y0, r).sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return p.facing > 0 ? 0 : Math.PI;
  const boss = near.find((e) => e.kind === 'boss');
  const pool = boss && near.indexOf(boss) >= 8 ? [...near.slice(0, 8), boss] : near.slice(0, 8);
  let best = Math.atan2(near[0].y - y0, near[0].x - x0);
  let bestN = -1;
  for (const c of pool) {
    const a = Math.atan2(c.y - y0, c.x - x0);
    let n = 0;
    for (const e of near) if (inSector(x0, y0, a, arc, r, e.x, e.y, ENEMIES[e.kind].radius)) n += e.kind === 'boss' ? BOSS_WEIGHT : 1;
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  return best;
}

/** 放天眼：定下方向，开始一扫（之后每帧在 updateYangjian 里推进）。 */
export function gaze(w: World, p: Player, ev: SimEvent[]) {
  const G = GAZE;
  const r = Math.min(REACH.max, G.r * (1 + Math.min(REACH.area, p.stats.area)) * techSkillRadius(p));
  const a = aimFan(w, p, p.x, p.y, r, G.arc);
  // 从上沿扫到下沿：朝右时角度从小到大（屏幕上从上往下），朝左时反过来
  const dir = Math.cos(a) >= 0 ? 1 : -1;
  p.facing = dir > 0 ? 1 : -1;
  const a0 = a - dir * G.arc;
  p.gaze = { a0, a1: a + dir * G.arc, a: a0, pa: a0, r, t0: w.time, dur: G.dur, dmg: SKILL.damage * G.dmg * (1 + p.stats.damage), hit: [] };
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: r, kind: 'gaze', a, arc: G.arc, dir, dur: G.dur });
}

/** 天眼的一扫往前推一帧：光从上一帧的角度扫到这一帧的角度，扫过的敌人中一次（定身、伤害、标记）。 */
function sweepGaze(w: World, p: Player, ev: SimEvent[]) {
  const g = p.gaze!;
  const k = Math.min(1, (w.time - g.t0) / g.dur);
  const ease = k * k * (3 - 2 * k);
  g.pa = g.a;
  g.a = g.a0 + (g.a1 - g.a0) * ease;
  const dir = g.a1 >= g.a0 ? 1 : -1;
  const from = (g.pa - g.a0) * dir;
  const to = (g.a - g.a0) * dir;
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, p.x, p.y, g.r + 12)) {
    if (g.hit.includes(e.id)) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const br = ENEMIES[e.kind].radius;
    if (d > g.r + br) continue;
    const tol = d > br ? Math.atan2(br, d) : Math.PI;
    const rel = wrapAngle(Math.atan2(e.y - p.y, e.x - p.x) - g.a0) * dir;
    if (rel < from - tol || rel > to + tol) continue;
    g.hit.push(e.id);
    hitEnemy(w, e, { dmg: g.dmg, by: 'skill', owner: p.id, from: p, stun: GAZE.stun }, ev);
    if (e.hp > 0) {
      e.gaze = Math.max(e.gaze ?? 0, GAZE.mark);
      e.gazeUntil = Math.max(e.gazeUntil ?? 0, w.time + GAZE.markT);
    }
  }
  if (k >= 1) delete p.gaze;
}

/** 每帧：天眼正在扫就推进它（扫完了、或者这一扫是上一波留下来的就收掉）。 */
export function updateYangjian(w: World, p: Player, _dt: number, ev: SimEvent[]) {
  if (!p.gaze) return;
  if (w.time - p.gaze.t0 > p.gaze.dur + 0.1) delete p.gaze; // 一扫没扫完这一波就结束了：不带进下一波
  else sweepGaze(w, p, ev);
}

// ---------------------------------------------------------------- 专属法宝「三尖两刃刀」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const SANJIAN = {
  // 横扫：扇面半径、半张角（凡 ±75°，灵品起 ±80°：是一记大开大合的横扫）。半径和化血神刀的血光斩差不多（88）：
  // 太短、太窄了走位时扫不到追上来的敌群（tools/weapon-dps.ts 量过：52 像素、±57° 时群伤只有同品阶中位数的四成，单体正常）
  // 2026-11-11 数值平衡：第 3 轮为了把量具里的群伤拉进 ±15% 加长加宽过（92–96、±83–86°），第 6 轮改回原样——这一扫同时是杨戬的防身：
  // 够得着机器人（和量具里）拖在身后八九十像素的敌群时，贴身挨的打只有别的角色的五分之一，四十局通 37–38 局；改回来通 32 局，和别的角色一档。
  // 代价是量具里的群伤低两成上下（用户：「杨戬……输出快就得低一点」）。见 docs/balance/log.md 第 6 轮
  sweep: { r: [0, 86, 90, 94, 94], arc: [0, 1.3, 1.4, 1.4, 1.4], kb: 70, mul: 1.3 },
  stab: { len: [0, 96, 108, 112, 112], far: REACH.max - 12, w: 10, pierce: [0, 4, 5, 6, 6], mul: 0.7, kb: 50, gap: 0.2 }, // 刺击：扫完 gap 秒刺出，比横扫够得远
  chop: { len: 112, far: REACH.max - 6, w: 12, mul: 0.62, stun: 0.35, gap: 0.24 }, // mul 1.1 → 0.62（仙品的劈山单打一只比中位数高两成） // 仙品「劈山」：刺完 gap 秒劈下；裂缝长度、半宽
  rift: { n: 3, fan: 0.34, len: 1.12, mul: 0.85 }, // 器灵「开天」：一劈三道（扇形，道与道之间 0.34 弧度），更远、每道轻一些
  edge: { back: 0.8, backR: 1.15, gap: 0.13, stab2: 0.4, gap2: 0.16 }, // back 1 → 0.8（回锋的单体偏高） // 器灵「回锋」：反手一刀的伤害与半径（大一圈）、第二刺的伤害
};

/** 一套招式在横扫之后还有哪几步（按顺序；OwnedWeapon.burst 记还剩几步）。 */
type Step = 'back' | 'stab' | 'stab2' | 'chop';
function steps(wpn: OwnedWeapon): Step[] {
  const s: Step[] = wpn.spirit === 'edge' ? ['back', 'stab', 'stab2'] : ['stab'];
  if (wpn.tier >= 3) s.push('chop');
  return s;
}
/** 每一步离上一步多久。 */
function gapBefore(st: Step): number {
  const S = SANJIAN;
  return st === 'back' ? S.edge.gap : st === 'stab2' ? S.edge.gap2 : st === 'chop' ? S.chop.gap : S.stab.gap;
}

const area = (p: Player) => 1 + p.stats.area;
const reachLen = (p: Player, base: number, cap: number) => Math.min(cap, base * area(p));
const sweepR = (p: Player, wpn: OwnedWeapon) => reachLen(p, SANJIAN.sweep.r[wpn.tier], REACH.seek);
const stabLen = (p: Player, wpn: OwnedWeapon) => reachLen(p, SANJIAN.stab.len[wpn.tier], SANJIAN.stab.far);
/** 胸口（横扫、刺击都从这里出）。 */
const chest = (p: Player, a: number) => ({ x: p.x + Math.cos(a) * 4, y: p.y - 9 });

/**
 * 瞄准：够得着的最近几只（和够得着的首领）里挑一个方向，让「横扫的扇面 + 刺击的那条线」罩住最多的敌人
 * （首领算 BOSS_WEIGHT 只；一样多就挑近的）。刺得到的范围里没有敌人返回 null（不出手）。
 */
function aim(w: World, p: Player, wpn: OwnedWeapon): number | null {
  const S = SANJIAN;
  const r = sweepR(p, wpn);
  const arc = S.sweep.arc[wpn.tier];
  const len = stabLen(p, wpn);
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, len).sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return null;
  const boss = near.find((e) => e.kind === 'boss');
  const pool = boss && near.indexOf(boss) >= 6 ? [...near.slice(0, 6), boss] : near.slice(0, 6);
  let best = 0;
  let bestN = -1;
  for (const c of pool) {
    const a = Math.atan2(c.y - 6 - (p.y - 9), c.x - p.x);
    const o = chest(p, a);
    const x1 = o.x + Math.cos(a) * len;
    const y1 = o.y + Math.sin(a) * len;
    let n = 0;
    for (const e of near) {
      const wt = e.kind === 'boss' ? BOSS_WEIGHT : 1;
      if (inSector(p.x, p.y - 8, a, arc, r, e.x, e.y - 6, ENEMIES[e.kind].radius)) n += wt;
      if (segDist(e.x, e.y - 6, o.x, o.y, x1, y1) < S.stab.w + ENEMIES[e.kind].radius * 0.5) n += wt;
    }
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  return best;
}

/** 横扫一刀（back：回锋反手扫回来的那一刀，方向相反、轻一些）。 */
function sweep(w: World, p: Player, wpn: OwnedWeapon, a: number, dir: number, back: boolean, ev: SimEvent[]) {
  const S = SANJIAN;
  const r = Math.min(REACH.seek, sweepR(p, wpn) * (back ? S.edge.backR : 1));
  const arc = S.sweep.arc[wpn.tier];
  const x0 = p.x;
  const y0 = p.y - 8;
  ev.push({ t: 'cleave', owner: p.id, x: x0, y: y0, a, r, arc, dir, ...(back ? { back: true } : {}), kind: 'sanjian', tier: wpn.tier });
  const dmg = weaponDamage(p, wpn, p.buffs.rage) * S.sweep.mul * (back ? S.edge.back : 1);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, x0, y0, r + 16)) {
    if (!inSector(x0, y0, a, arc, r, e.x, e.y - 6, ENEMIES[e.kind].radius)) continue;
    hitEnemy(w, e, { dmg, by: 'cleave', owner: p.id, from: p, kb: S.sweep.kb, el: 'metal' }, ev);
  }
}

/** 朝 a 方向刺一下：贯穿沿线最近的几只。mul：这一刺的伤害倍数。 */
function stab(w: World, p: Player, wpn: OwnedWeapon, a: number, mul: number, seq: number, ev: SimEvent[]) {
  const S = SANJIAN;
  const len = stabLen(p, wpn);
  const o = chest(p, a);
  const x1 = o.x + Math.cos(a) * len;
  const y1 = o.y + Math.sin(a) * len;
  ev.push({ t: 'stab', owner: p.id, x0: o.x, y0: o.y, x1, y1, seq, kind: 'sanjian', tier: wpn.tier });
  const dmg = weaponDamage(p, wpn, p.buffs.rage) * S.stab.mul * mul;
  buildGrid(w.enemies);
  const line = enemiesWithin(w, (o.x + x1) / 2, (o.y + y1) / 2 + 6, len / 2 + 14)
    .filter((e) => segDist(e.x, e.y - 6, o.x, o.y, x1, y1) < S.stab.w + ENEMIES[e.kind].radius * 0.5)
    .sort((a, b) => dist2(a, p) - dist2(b, p))
    .slice(0, S.stab.pierce[wpn.tier]);
  for (const e of line) hitEnemy(w, e, { dmg, by: 'stab', owner: p.id, from: p, kb: S.stab.kb, el: 'metal' }, ev);
}

/** 劈山：刀从头顶劈下，地上从脚前朝 a 方向裂开一道（开天：三道扇形），裂缝上的敌人挨一下、顿一顿（一劈里一只只挨一次）。 */
function chop(w: World, p: Player, wpn: OwnedWeapon, a: number, ev: SimEvent[]) {
  const S = SANJIAN;
  const rift = wpn.spirit === 'rift';
  const len = reachLen(p, S.chop.len * (rift ? S.rift.len : 1), S.chop.far);
  const dmg = weaponDamage(p, wpn, p.buffs.rage) * S.chop.mul * (rift ? S.rift.mul : 1);
  const angles = rift ? Array.from({ length: S.rift.n }, (_, i) => a + (i - (S.rift.n - 1) / 2) * S.rift.fan) : [a];
  const seen = new Set<number>();
  buildGrid(w.enemies);
  for (const b of angles) {
    const x0 = p.x + Math.cos(b) * 8;
    const y0 = p.y + Math.sin(b) * 5;
    const x1 = p.x + Math.cos(b) * len;
    const y1 = p.y + Math.sin(b) * len;
    ev.push({ t: 'chop', owner: p.id, x0, y0, x1, y1, w: S.chop.w, kind: 'sanjian', tier: wpn.tier });
    for (const e of enemiesWithin(w, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + 14)) {
      if (seen.has(e.id) || segDist(e.x, e.y, x0, y0, x1, y1) > S.chop.w + ENEMIES[e.kind].radius * 0.5) continue;
      seen.add(e.id);
      hitEnemy(w, e, { dmg, by: 'chop', owner: p.id, from: p, kb: 40, el: 'metal', stun: S.chop.stun }, ev);
    }
  }
}

/** 出手（weapons.ts 的 FIRE 表调）：先横扫，后面的几步记进 burst，由 weapons.updateWeapons 按间隔补上（sanjianStep）。 */
export function fireSanjian(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const a = aim(w, p, wpn);
  if (a === null) return false;
  p.facing = Math.cos(a) >= 0 ? 1 : -1;
  // 刀从身后那一侧扫向身前那一侧：朝右时从上往下，朝左时反过来（和天眼一样）
  const dir = p.facing;
  sweep(w, p, wpn, a, dir, false, ev);
  const rest = steps(wpn);
  wpn.burst = rest.length;
  wpn.burstT = gapBefore(rest[0]);
  wpn.aim = a;
  return true;
}

/**
 * 一套招式里横扫之后的下一步（weapons.updateWeapons 在 burst 到点时调；那时 burst 已经减过一）。
 * 刺击重新瞄准（敌人在动；够不着就沿着横扫的方向），反手一刀、劈山沿用这一套的方向。
 */
export function sanjianStep(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]) {
  const rest = steps(wpn);
  const i = rest.length - (wpn.burst ?? 0) - 1;
  const st = rest[i];
  if (!st) return;
  const a0 = wpn.aim ?? (p.facing > 0 ? 0 : Math.PI);
  if (st === 'back') sweep(w, p, wpn, a0, -p.facing, true, ev);
  else if (st === 'stab' || st === 'stab2') {
    const a = aim(w, p, wpn) ?? a0;
    wpn.aim = a;
    stab(w, p, wpn, a, st === 'stab2' ? SANJIAN.edge.stab2 : 1, st === 'stab2' ? 2 : 1, ev);
  } else chop(w, p, wpn, a0, ev);
  const next = rest[i + 1];
  if (next) wpn.burstT = gapBefore(next);
}
