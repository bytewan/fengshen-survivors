// 第一章新敌人的行为（纯函数、确定性：随机数只用 w.rng），以及「这一波刷什么怪」的出场节奏。
//   回响矛卒 spearman：走到离人物约 30 像素处停下，蓄力（地上亮出一小段刺击线，线定下就不跟踪）后一矛刺出，冷却约 2 秒；
//   玄符盾卫 shieldbearer：走得慢、血厚、难击退；举着符盾慢慢转向人物，正面受到的伤害大幅降低，侧面和背后才是全额；
//   阴马骁骑 cavalry：离人物 120–200 像素时先亮出冲锋线（不跟踪），预警后沿线高速冲过去，冲完原地喘息；
//   爆符鬼 bomber：飘得快，贴近人物时点燃怀里的爆符，引信烧完原地炸开；点燃前被打死就不炸，点燃后打不死、一定会炸；
//   分魂鬼 splitter：死时分成两只小鬼（splitling），小鬼再死不再分。
// 第二章新加的三种（数值在 sim/ch2/config.ts 的 FOES2）：
//   落魂幡手 bannerman：像术士一样站在远处、横着挪，幡上的魂光连到身边几只敌人身上，给它们加移速和护体（受伤减少）；自己很脆；
//   红沙傀儡 golem：慢、厚、体型大，走过的地方留下一小片一小片红沙（人物踩上去走得慢），碎了在原地散开一大片；
//   风吼妖 windfiend：贴地快飞、绕到人物侧面，离得近了先亮出冲刺线（预警），再沿线冲过去，冲过人物身边把人吹开（伤害很小）。
// 接到别处的只有四个调用（合并时好对）：
//   world.ts  刷怪挑种类 spawnKind(w)；敌人每帧的行为 [vx, vy] = actEnemy(w, e, target, vx, vy, ev)；
//   core.ts   结算伤害时乘 guardMul(e, spec, ev)（盾牌减伤）；击杀时调 onFoeKilled(w, e, ev)（分裂）。
// 状态都放在敌人身上（types.ts 里 Enemy 的 act / actT / aimX …），表现层只读它们、再配上 FoeEvent 画预警与出手。
// 新敌人没有飞行弹道（刺击、冲锋、爆炸都是当场结算），法宝本来也不碰敌人的攻击。
import { ARENA, CASTER, DT, ENEMIES, FOES, MIASMA, PLAYER } from './config.ts';
import { chapterOf, waveInChapter } from './catalog.ts';
import { chapterOfWave, type SpawnTable } from './chapters.ts';
import { hurtPlayer, segDist, type DamageSpec } from './core.ts';
import { jieShot } from './jie.ts';
import { spawnEnemy } from './world.ts';
import { FOES2 } from './ch2/config.ts';
import { FOES3 } from './ch3/config.ts';
import { disciple, flysword, puppet } from './ch3/foes.ts';
import { actElite, armorMul, eliteKilled } from './elites/index.ts';
import type { Enemy, EnemyKindName, FoeKind, Patch, Player, SimEvent } from './types.ts';
import type { World } from './world.ts';

/** 敌人的名字（界面、图鉴、横幅用）。 */
export const ENEMY_NAME: Record<EnemyKindName, string> = {
  soldier: '回响兵',
  elite: '回响校尉',
  caster: '鬼火术士',
  boss: '首领',
  spearman: '回响矛卒',
  shieldbearer: '玄符盾卫',
  cavalry: '阴马骁骑',
  bomber: '爆符鬼',
  splitter: '分魂鬼',
  splitling: '离魂',
  bannerman: '落魂幡手',
  golem: '红沙傀儡',
  windfiend: '风吼妖',
  flysword: '飞剑灵',
  disciple: '截教门徒',
  puppet: '阵图傀儡',
  soulflag: '落魂幡',
  strawman: '草人',
};

const TAU = Math.PI * 2;
/** 角度差归一到 (-π, π]。 */
const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);

// ---------- 出场节奏 ----------

/** 按这个顺序抽（鬼火术士在最前，抽中的区间和原来一样）。 */
const SPAWN_ORDER: EnemyKindName[] = ['caster', 'spearman', 'bomber', 'shieldbearer', 'cavalry', 'splitter'];

/**
 * 第 wave 波（全局编号）各种怪占刷怪的比例；没列出来的是回响兵。首领波不按时刷怪，不调这里。
 * 第一章按本章第几波一种一种加进来；第二、三章全都出、比例再高一些（见 config.FOES.mix）。
 */
export function spawnShares(wave: number): Partial<Record<EnemyKindName, number>> {
  const ch = chapterOf(wave);
  const n = waveInChapter(wave);
  const ew = ch === 1 ? n : Math.min(FOES.capWave, 5 + FOES.chapterStep * (ch - 1) + n - 1);
  const out: Partial<Record<EnemyKindName, number>> = {};
  if (wave >= 3) out.caster = Math.min(0.2, 0.05 + wave * 0.008); // 鬼火术士：沿用原来的比例
  let sum = 0;
  for (const kind of SPAWN_ORDER) {
    const m = FOES.mix[kind as FoeKind];
    if (!m || ew < m.from) continue;
    out[kind] = m.share + m.per * (ew - m.from);
    sum += out[kind]!;
  }
  // 新种类加起来封顶（鬼火术士照旧，不算在内）：回响兵始终是大头
  if (sum > FOES.cap) for (const kind of SPAWN_ORDER) if (kind !== 'caster' && out[kind]) out[kind] = (out[kind]! * FOES.cap) / sum;
  return out;
}

/** 同屏最多几只（满了这一份就刷成回响兵）。 */
const maxAlive = (kind: EnemyKindName) =>
  kind === 'caster' ? CASTER.maxAlive : (FOES.mix[kind as FoeKind]?.max ?? FOES2.mix[kind as keyof typeof FOES2.mix]?.max ?? FOES3.mix[kind as keyof typeof FOES3.mix]?.max ?? Infinity);

/** 第一章的刷怪表（第三章还没做，也先用它；chapters.ts 登记）。 */
export const CH1_SPAWN: SpawnTable = { order: SPAWN_ORDER, shares: spawnShares };

/** 第二章抽的顺序：第一章那几种在前（区间和第一章的算法一致），三种新的接在后面。 */
const CH2_ORDER: EnemyKindName[] = [...SPAWN_ORDER, 'windfiend', 'bannerman', 'golem'];

/**
 * 第二章（第 7–12 波）各种怪占的比例：第一章的 8 种照 spawnShares 的第二章算法全都出，再按本章第几波加进三种新的
 * （FOES2.mix；三种加起来最多 FOES2.cap），第一章那几种（鬼火术士除外）的比例乘 FOES2.keep 让出位置，回响兵始终有一成多。
 */
export function ch2Shares(wave: number): Partial<Record<EnemyKindName, number>> {
  const out = spawnShares(wave);
  for (const kind of SPAWN_ORDER) if (kind !== 'caster' && out[kind]) out[kind] = out[kind]! * FOES2.keep;
  const n = waveInChapter(wave);
  let sum = 0;
  const add: Partial<Record<EnemyKindName, number>> = {};
  for (const [kind, m] of Object.entries(FOES2.mix) as [keyof typeof FOES2.mix, (typeof FOES2.mix)[keyof typeof FOES2.mix]][]) {
    if (n < m.from) continue;
    add[kind] = m.share + m.per * (n - m.from);
    sum += add[kind]!;
  }
  for (const [kind, v] of Object.entries(add) as [EnemyKindName, number][]) out[kind] = sum > FOES2.cap ? (v * FOES2.cap) / sum : v;
  return out;
}

/** 第二章的刷怪表（chapters.ts 登记）。 */
export const CH2_SPAWN: SpawnTable = { order: CH2_ORDER, shares: ch2Shares };

/** 第三章抽的顺序：第一章那几种在前（区间和第一章的算法一致），三种新的接在后面。 */
const CH3_ORDER: EnemyKindName[] = [...SPAWN_ORDER, 'flysword', 'disciple', 'puppet'];

/**
 * 第三章（第 13–18 波）各种怪占的比例：第一章的 8 种照 spawnShares 的第三章算法全都出，再按本章第几波加进三种新的
 * （FOES3.mix；三种加起来最多 FOES3.cap），第一章那几种（鬼火术士除外）的比例乘 FOES3.keep 让出位置，回响兵始终有一成多。
 * 阵图傀儡刷出来一只、第一帧补上另一只（sim/ch3/foes.ts），所以它的比例给得低。
 */
export function ch3Shares(wave: number): Partial<Record<EnemyKindName, number>> {
  const out = spawnShares(wave);
  for (const kind of SPAWN_ORDER) if (kind !== 'caster' && out[kind]) out[kind] = out[kind]! * FOES3.keep;
  const n = waveInChapter(wave);
  let sum = 0;
  const add: Partial<Record<EnemyKindName, number>> = {};
  for (const [kind, m] of Object.entries(FOES3.mix) as [keyof typeof FOES3.mix, (typeof FOES3.mix)[keyof typeof FOES3.mix]][]) {
    if (n < m.from) continue;
    add[kind] = m.share + m.per * (n - m.from);
    sum += add[kind]!;
  }
  for (const [kind, v] of Object.entries(add) as [EnemyKindName, number][]) out[kind] = sum > FOES3.cap ? (v * FOES3.cap) / sum : v;
  return out;
}

/** 第三章的刷怪表（chapters.ts 登记）。 */
export const CH3_SPAWN: SpawnTable = { order: CH3_ORDER, shares: ch3Shares };

/** 刷一只怪时挑种类：每只只抽一次随机数（第 1 波全是回响兵时，随机数的用法和原来完全一样）。抽哪几种、各占多少按这一章的刷怪表（chapters.ts）。 */
export function spawnKind(w: World): EnemyKindName {
  const r = w.rng.next();
  const table = chapterOfWave(w.wave).spawn;
  const shares = table.shares(w.wave);
  let acc = 0;
  for (const kind of table.order) {
    const s = shares[kind];
    if (!s) continue;
    acc += s;
    if (r >= acc) continue;
    let alive = 0;
    for (const e of w.enemies) if (e.kind === kind && e.hp > 0) alive++;
    return alive < maxAlive(kind) ? kind : 'soldier';
  }
  return 'soldier';
}

// ---------- 每帧的行为 ----------

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

/**
 * 敌人每帧的行为（world.step 的敌人循环里，算完默认的速度之后调用；晕眩时也调，用来打断蓄力）。
 * target：最近的活着的玩家（没有就是 null）；(vx, vy)：默认的速度（朝 target 直走，晕眩时是 0）。
 * 返回这一帧的速度；原有的几种敌人原样返回，不动随机数。
 */
export function actEnemy(w: World, e: Enemy, target: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  switch (e.kind) {
    case 'spearman':
      return spearman(w, e, target, vx, vy, ev);
    case 'shieldbearer':
      return shieldbearer(e, target, vx, vy);
    case 'cavalry':
      return cavalry(w, e, target, vx, vy, ev);
    case 'bomber':
      return bomber(w, e, target, vx, vy, ev);
    case 'bannerman':
      return bannerman(w, e, target, vx, vy);
    case 'golem':
      return golem(w, e, vx, vy);
    case 'windfiend':
      return windfiend(w, e, target, vx, vy, ev);
    case 'flysword':
      return flysword(w, e, target, vx, vy, ev);
    case 'disciple':
      return disciple(w, e, target, vx, vy, ev);
    case 'puppet':
      return puppet(w, e, target, vx, vy, ev);
    case 'elite':
      return actElite(w, e, target, vx, vy, ev); // 各章的精英与词缀（elites/；回响校尉不带词缀时原样返回）
    default:
      return [vx, vy]; // 回响兵、术士、分魂鬼和小鬼：照常
  }
}

/** 刺击线 / 冲锋线的终点。 */
export function strikeEnd(e: Enemy): [number, number] {
  return [(e.ox ?? e.x) + (e.aimX ?? 0) * (e.reach ?? 0), (e.oy ?? e.y) + (e.aimY ?? 0) * (e.reach ?? 0)];
}

/** 定下出手方向与那条线（预警开始时调用，之后不跟踪）。 */
function aimAt(e: Enemy, t: Player, reach: number) {
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.aimX = dx / d;
  e.aimY = dy / d;
  e.ox = e.x;
  e.oy = e.y;
  e.reach = reach;
  e.struck = false;
}

/** 回响矛卒：停在近处，蓄力后沿定下的刺击线刺出一矛；晕眩、冻结打断蓄力。 */
function spearman(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const S = FOES.spearman;
  e.cd -= DT;
  if (e.act) {
    e.actT = (e.actT ?? 0) - DT;
    if (e.act === 'windup') {
      if (e.stun > 0) {
        // 被打断：收枪，过一会儿再来
        startAct(e, 'rest', S.rest);
        e.cd = Math.max(e.cd, S.cooldown * 0.5);
      } else if (e.actT <= 0) {
        const [x1, y1] = strikeEnd(e);
        startAct(e, 'strike', S.strike);
        e.cd = S.cooldown;
        ev.push({ t: 'foeStrike', id: e.id, kind: 'spearman', x0: e.ox!, y0: e.oy!, x1, y1, dur: S.strike });
        stab(w, e, ev);
      }
    } else if (e.act === 'strike') {
      stab(w, e, ev);
      if (e.actT <= 0) startAct(e, 'rest', S.rest);
    } else if (e.actT <= 0) endAct(e);
    return [0, 0]; // 蓄力、出手、收枪时站定
  }
  if (!t || e.stun > 0) return [vx, vy];
  const d = Math.hypot(t.x - e.x, t.y - e.y);
  if (d <= S.hold + 2 && e.cd <= 0) {
    aimAt(e, t, S.reach);
    startAct(e, 'windup', S.windup);
    const [x1, y1] = strikeEnd(e);
    ev.push({ t: 'foeWindup', id: e.id, kind: 'spearman', x0: e.ox!, y0: e.oy!, x1, y1, r: S.width, t2: S.windup });
    return [0, 0];
  }
  if (d > S.hold) return [vx, vy]; // 走近
  if (d < S.back) return [-vx * 0.5, -vy * 0.5]; // 太近了往后退半步
  return [0, 0]; // 站在长矛够得着的地方
}

/** 刺击判定：站在刺击线上的人挨一下（每次出手最多打中一次）。 */
function stab(w: World, e: Enemy, ev: SimEvent[]) {
  if (e.struck) return;
  const S = FOES.spearman;
  const [x1, y1] = strikeEnd(e);
  for (const p of alivePlayers(w)) {
    if (segDist(p.x, p.y, e.ox!, e.oy!, x1, y1) > S.width + PLAYER.radius) continue;
    if (hurtPlayer(w, p, S.dmg * e.dmgMul, 'spear', ev)) e.struck = true;
  }
}

/** 玄符盾卫：盾慢慢转向人物，人往盾朝的方向走（转身时走得慢）；减伤在 guardMul。 */
function shieldbearer(e: Enemy, t: Player | null, vx: number, vy: number): [number, number] {
  const G = FOES.shieldbearer;
  if (!t) return [vx, vy];
  const want = Math.atan2(t.y - e.y, t.x - e.x);
  if (e.face === undefined) e.face = want;
  if (e.stun > 0) return [vx, vy];
  const diff = wrapAngle(want - e.face);
  const turn = G.turn * DT;
  e.face = wrapAngle(e.face + Math.max(-turn, Math.min(turn, diff)));
  const spd = Math.hypot(vx, vy);
  const k = Math.max(0.25, Math.cos(wrapAngle(want - e.face))); // 盾还没转过来时走得慢
  return [Math.cos(e.face) * spd * k, Math.sin(e.face) * spd * k];
}

/**
 * 盾牌减伤（core.hitEnemy 结算伤害时乘上）：伤害从盾的正面扇形里来就 × guard，并发 foeGuard 事件；
 * 侧面、背后、头顶落下的、脚下刺出的、持续伤害、神通都是全额（FOES.shieldbearer.pierce）。带「坚甲」的精英 × (1 − AFFIX.armor.cut)（elites/）。其他敌人一律 1。
 */
export function guardMul(e: Enemy, s: DamageSpec, ev: SimEvent[]): number {
  if (e.affixes) return armorMul(e); // 精英词缀「坚甲」（elites/affixes.ts；被「破甲」咬了的在 core 里已经不乘这里）
  if (e.kind !== 'shieldbearer' || e.face === undefined) return 1;
  const G = FOES.shieldbearer;
  if (G.pierce.includes(s.by)) return 1;
  const dx = s.from.x - e.x;
  const dy = s.from.y - (e.y - 7); // 从胸口量：乾坤圈、飞刀都在胸口高度
  if (dx * dx + dy * dy < 4 * 4) return 1; // 打在身上的（没有方向）
  if (Math.abs(wrapAngle(Math.atan2(dy, dx) - e.face)) > G.arc) return 1;
  ev.push({ t: 'foeGuard', id: e.id, x: e.x + Math.cos(e.face) * 7, y: e.y - 8 + Math.sin(e.face) * 3, a: e.face });
  return G.guard;
}

/** 阴马骁骑：保持在冲锋距离上，冷却好了就预警、沿定下的线冲过去，冲完喘息；晕眩打断预警和冲锋。 */
function cavalry(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const C = FOES.cavalry;
  e.cd -= DT;
  if (e.act === 'windup' || e.act === 'strike') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.stun > 0) {
      startAct(e, 'rest', C.rest * 0.6);
      e.cd = Math.max(e.cd, C.cooldown * 0.5);
      return [0, 0];
    }
    if (e.act === 'windup') {
      if (e.actT <= 0) {
        const [x1, y1] = strikeEnd(e);
        const dur = e.reach! / (C.speed * jieShot(w)); // 劫四起冲得快（jie.ts；劫一到三是 1）
        startAct(e, 'strike', dur + 0.3); // 多给一点，被挤歪了也冲得完
        ev.push({ t: 'foeStrike', id: e.id, kind: 'cavalry', x0: e.ox!, y0: e.oy!, x1, y1, dur });
      }
      return [0, 0];
    }
    // 冲锋：冲到线的尽头（按沿线走了多远算）或超时就停下喘息
    const prog = (e.x - e.ox!) * e.aimX! + (e.y - e.oy!) * e.aimY!;
    if (prog >= e.reach! || e.actT <= 0) {
      startAct(e, 'rest', C.rest);
      e.cd = C.cooldown;
      return [0, 0];
    }
    // 沿线冲；被挤开一点就往线上拉回来（off：偏离线的距离，左正右负）
    const off = (e.x - e.ox!) * -e.aimY! + (e.y - e.oy!) * e.aimX!;
    const sp = C.speed * jieShot(w) * (1 - e.slow * 0.5);
    const v: [number, number] = [e.aimX! * sp + e.aimY! * off * 6, e.aimY! * sp - e.aimX! * off * 6];
    // 撞人：按这一帧要冲过的那一小段判定（在普通的接触伤害之前结算，撞上就是冲锋的伤害）
    if (!e.struck) {
      const r = ENEMIES.cavalry.radius + PLAYER.radius + 2;
      for (const p of alivePlayers(w)) {
        if (segDist(p.x, p.y, e.x, e.y, e.x + v[0] * DT, e.y + v[1] * DT) > r) continue;
        if (hurtPlayer(w, p, C.dmg * e.dmgMul, 'charge', ev)) e.struck = true;
      }
    }
    return v;
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
  const [lo, hi] = C.band;
  if (d >= lo && d <= hi && e.cd <= 0) {
    // 冲锋线：穿过人物（预警时的位置）再延伸一段，夹在上下限之间，并裁在魔气带外沿以内
    aimAt(e, t, Math.max(C.len[0], Math.min(C.len[1], d + C.over)));
    clipToOuter(e);
    startAct(e, 'windup', C.warn);
    const [x1, y1] = strikeEnd(e);
    ev.push({ t: 'foeWindup', id: e.id, kind: 'cavalry', x0: e.ox!, y0: e.oy!, x1, y1, r: C.width, t2: C.warn });
    return [0, 0];
  }
  if (d > hi) return [vx, vy]; // 靠近
  if (d < lo) return [-vx, -vy]; // 太近了：拉开距离
  // 在冲锋距离上等冷却：绕着人物兜圈子
  const side = e.id % 2 ? 1 : -1;
  return [(-dy / d) * side * Math.hypot(vx, vy) * 0.7, (dx / d) * side * Math.hypot(vx, vy) * 0.7];
}

/** 把冲锋线裁在魔气带外沿以内（不然会顶在硬边界上冲不完）。 */
function clipToOuter(e: Enemy) {
  const r = ENEMIES[e.kind].radius + 2;
  const D = MIASMA.depth - r;
  const [ux, uy] = [e.aimX!, e.aimY!];
  let t = e.reach!;
  if (ux > 1e-6) t = Math.min(t, (ARENA.w + D - e.ox!) / ux);
  else if (ux < -1e-6) t = Math.min(t, (-D - e.ox!) / ux);
  if (uy > 1e-6) t = Math.min(t, (ARENA.h + D - e.oy!) / uy);
  else if (uy < -1e-6) t = Math.min(t, (-D - e.oy!) / uy);
  e.reach = Math.max(0, t);
}

/** 爆符鬼：贴近就点燃引信（点燃后打不死、不吃控制），引信烧完原地炸开、就此消失（不算击杀、不掉灵石）。 */
function bomber(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const B = FOES.bomber;
  if (e.act === 'fuse') {
    e.actT = (e.actT ?? 0) - DT;
    e.invuln = Math.max(e.invuln, e.actT + DT);
    if (e.actT <= 0) {
      for (const p of alivePlayers(w)) if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 <= B.radius * B.radius) hurtPlayer(w, p, B.dmg * e.dmgMul, 'blast', ev);
      ev.push({ t: 'foeBlast', id: e.id, x: e.x, y: e.y, r: B.radius });
      endAct(e);
      e.invuln = 0;
      e.hp = 0;
    }
    return [0, 0];
  }
  if (!t || e.stun > 0) return [vx, vy];
  if ((t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= B.light * B.light) {
    startAct(e, 'fuse', B.fuse);
    e.invuln = B.fuse + DT;
    ev.push({ t: 'foeFuse', id: e.id, x: e.x, y: e.y, r: B.radius, t2: B.fuse });
    return [0, 0];
  }
  return [vx, vy];
}

// ---------- 第二章的三种 ----------

/**
 * 落魂幡手：像鬼火术士一样站在 keep 那一圈上（太近往后退、太远靠过去，在圈上横着挪），
 * 每 refresh 秒给身边 aura 以内最近的几只敌人续上增益（移速、护体，管 hold 秒），记下连着谁（表现层画魂光）。
 */
function bannerman(w: World, e: Enemy, t: Player | null, vx: number, vy: number): [number, number] {
  const B = FOES2.bannerman;
  e.cd -= DT;
  if (e.cd <= 0) {
    e.cd = B.refresh;
    const near: { o: Enemy; d: number }[] = [];
    for (const o of w.enemies) {
      if (o === e || o.hp <= 0 || o.kind === 'boss' || o.kind === 'bannerman') continue;
      const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
      if (d <= B.aura * B.aura) near.push({ o, d });
    }
    near.sort((a, b) => a.d - b.d || a.o.id - b.o.id);
    e.links = near.slice(0, B.max).map(({ o }) => {
      o.ward = B.ward;
      o.haste = B.haste;
      o.wardT = B.hold;
      return o.id;
    });
  }
  if (!t || e.stun > 0) return [vx, vy];
  const d = Math.hypot(t.x - e.x, t.y - e.y) || 1;
  const ux = (t.x - e.x) / d;
  const uy = (t.y - e.y) / d;
  const spd = Math.hypot(vx, vy);
  const side = e.id % 2 ? 1 : -1;
  const k = d < B.keep[0] ? -1 : d > B.keep[1] ? 1 : 0;
  return [(ux * k - uy * side * 0.6) * spd, (uy * k + ux * side * 0.6) * spd];
}

/** 红沙傀儡：照常朝人物慢慢走，每隔一会儿在脚下留一小片红沙。 */
function golem(w: World, e: Enemy, vx: number, vy: number): [number, number] {
  const G = FOES2.golem;
  e.cd -= DT;
  if (e.cd <= 0) {
    e.cd = G.every;
    if (vx || vy) addSand(w, e.x, e.y + 1, G.sandR, G.sandLife);
  }
  return [vx, vy];
}

/** 地上留一片红沙（场上太多了就先收最早的）。 */
function addSand(w: World, x: number, y: number, r: number, life: number) {
  w.patches.push({ id: w.nextId++, kind: 'sand', x, y, r, t: 0, life });
  if (w.patches.length > FOES2.golem.maxPatches) w.patches.shift();
}

/** 地上的红沙：到时消失（world.step 每帧调）。 */
export function updatePatches(w: World, dt: number) {
  if (!w.patches.length) return;
  for (const p of w.patches) p.t += dt;
  if (w.patches.some((p) => p.t >= p.life)) w.patches = w.patches.filter((p) => p.t < p.life);
}

/** 站在红沙上的人物的移速倍率（几片叠在一起只算一片）。 */
export function sandSpeedMul(w: World, p: Player): number {
  for (const s of w.patches as Patch[]) if (s.t < s.life && (p.x - s.x) ** 2 + ((p.y - s.y) * 1.4) ** 2 <= s.r * s.r) return 1 - FOES2.golem.slow;
  return 1;
}

/**
 * 风吼妖：没在出手时朝人物「侧面」那一点飞（人物到它的方向转 90°、离人物 side 像素）；离人物在 band 以内、冷却好了就预警：
 * 地上亮出冲刺线（穿过人物当时的位置再延伸 over，夹在 len 之间、裁在魔气带外沿以内），warn 秒后沿线冲过去，
 * 冲过人物身边就把人往线的两侧吹开（每次冲刺最多吹中一次），冲完喘一下；晕眩打断预警和冲刺。
 */
function windfiend(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const F = FOES2.windfiend;
  e.cd -= DT;
  if (e.act === 'windup' || e.act === 'strike') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.stun > 0) {
      startAct(e, 'rest', F.rest);
      e.cd = Math.max(e.cd, F.cooldown * 0.5);
      return [0, 0];
    }
    if (e.act === 'windup') {
      if (e.actT <= 0) {
        const [x1, y1] = strikeEnd(e);
        const dur = e.reach! / (F.speed * jieShot(w)); // 劫四起冲得快（jie.ts；劫一到三是 1）
        startAct(e, 'strike', dur + 0.25);
        ev.push({ t: 'windDash', id: e.id, x0: e.ox!, y0: e.oy!, x1, y1, dur });
      }
      return [0, 0];
    }
    const prog = (e.x - e.ox!) * e.aimX! + (e.y - e.oy!) * e.aimY!;
    if (prog >= e.reach! || e.actT <= 0) {
      startAct(e, 'rest', F.rest);
      e.cd = F.cooldown;
      return [0, 0];
    }
    const off = (e.x - e.ox!) * -e.aimY! + (e.y - e.oy!) * e.aimX!;
    const fs = F.speed * jieShot(w);
    const v: [number, number] = [e.aimX! * fs + e.aimY! * off * 6, e.aimY! * fs - e.aimX! * off * 6];
    if (!e.struck) {
      const r = F.width + PLAYER.radius;
      for (const p of alivePlayers(w)) {
        if (segDist(p.x, p.y, e.x, e.y, e.x + v[0] * DT, e.y + v[1] * DT) > r) continue;
        e.struck = true;
        // 往线的两侧吹：人在线的哪一侧就往哪一侧（正好在线上按编号挑一侧），再顺着冲的方向带一点
        const side = (p.x - e.ox!) * -e.aimY! + (p.y - e.oy!) * e.aimX!;
        const s = Math.abs(side) > 0.5 ? Math.sign(side) : e.id % 2 ? 1 : -1;
        const bx = (-e.aimY! * s * 0.85 + e.aimX! * 0.5) * F.push;
        const by = (e.aimX! * s * 0.85 + e.aimY! * 0.5) * F.push;
        p.blowX = bx;
        p.blowY = by;
        ev.push({ t: 'blown', owner: p.id, id: e.id, x: p.x, y: p.y, vx: bx, vy: by });
        hurtPlayer(w, p, F.dmg * e.dmgMul, 'wind', ev);
      }
    }
    return v;
  }
  if (e.act === 'rest') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.actT <= 0) endAct(e);
    return [vx * 0.4, vy * 0.4];
  }
  if (!t || e.stun > 0) return [vx, vy];
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d >= F.band[0] && d <= F.band[1] && e.cd <= 0) {
    aimAt(e, t, Math.max(F.len[0], Math.min(F.len[1], d + F.over)));
    clipToOuter(e);
    startAct(e, 'windup', F.warn);
    const [x1, y1] = strikeEnd(e);
    ev.push({ t: 'windWarn', id: e.id, x0: e.ox!, y0: e.oy!, x1, y1, r: F.width + PLAYER.radius, t2: F.warn });
    return [0, 0];
  }
  // 绕到侧面：目标点是人物身边、和「人物 → 它」垂直的方向上 side 像素处（左右按编号定）
  const side = e.id % 2 ? 1 : -1;
  const tx = t.x + (-dy / d) * side * F.side;
  const ty = t.y + (dx / d) * side * F.side;
  const gx = tx - e.x;
  const gy = ty - e.y;
  const g = Math.hypot(gx, gy) || 1;
  const spd = Math.hypot(vx, vy);
  return [(gx / g) * spd, (gy / g) * spd];
}

// ---------- 击杀 ----------

/** 敌人被打死时（core.onKill 末尾调用）：分魂鬼分成两只小鬼，往两边弹开；红沙傀儡碎成一大片红沙；带「分魂」的精英分出离魂（elites/）。 */
export function onFoeKilled(w: World, e: Enemy, ev: SimEvent[]) {
  if (e.kind === 'elite') {
    eliteKilled(w, e, ev);
    return;
  }
  if (e.kind === 'golem') {
    const G = FOES2.golem;
    addSand(w, e.x, e.y, G.burstR, G.burstLife);
    const a0 = w.rng.next() * TAU;
    for (let i = 0; i < G.burstN; i++) {
      const a = a0 + (i / G.burstN) * TAU;
      addSand(w, e.x + Math.cos(a) * G.burstR * 0.9, e.y + Math.sin(a) * G.burstR * 0.6, G.sandR + 2, G.burstLife * 0.8);
    }
    ev.push({ t: 'sandBurst', id: e.id, x: e.x, y: e.y, r: G.burstR });
    return;
  }
  if (e.kind !== 'splitter') return;
  const S = FOES.splitter;
  const a0 = w.rng.next() * TAU;
  const ids: number[] = [];
  for (let i = 0; i < S.n; i++) {
    const a = a0 + (i / S.n) * TAU;
    const x = e.x + Math.cos(a) * S.gap;
    const y = e.y + Math.sin(a) * S.gap * 0.7;
    const c = spawnEnemy(w, 'splitling', x, y, ev);
    // 就从分魂鬼死的地方分出来（spawnEnemy 会把新刷的怪挪回仙台上，这里不要）
    c.x = c.px = x;
    c.y = c.py = y;
    c.kx = Math.cos(a) * S.kick;
    c.ky = Math.sin(a) * S.kick * 0.7;
    c.stun = 0.25; // 刚分出来愣一下
    ids.push(c.id);
  }
  ev.push({ t: 'foeSplit', id: e.id, x: e.x, y: e.y, ids });
}
