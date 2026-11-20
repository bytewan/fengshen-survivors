// 精英：按章刷哪一种、带几条词缀，每帧的行为分派，以及接到别处的几个钩子（纯函数、确定性：随机数只用 w.rng）。
// 接到别处的只有这几个调用（合并时好对）：
//   world.ts      出精英的那一段 spawnElites(w, p, cams, n, ev)（按章刷、带词缀；WAVE_ELITES 按波次换掉）；遭遇战那一波改调 spawnExtraElites（首领池，bosspool.ts）；
//                 接触伤害跳过 hidden 的（潜在水里的夜叉）
//   enemies.ts    actEnemy 的 'elite' 分支 actElite(...)；onFoeKilled 里 eliteKilled(...)；guardMul 里乘坚甲 armorMul(e)
//   core.ts       hitEnemy 结算伤害之前 if (eliteHit(w, e, s, ev)) return 0（金光挡下这一下；反震起手）
//   bot-dodge.ts  精英的招不走通用的那一段，改加 eliteDodge(...)
// 规矩：第一章劫一的精英就是原来的回响校尉、不带词缀——这时这里一个随机数都不多用，劫一第一章的 tools/balance.ts 结果逐字不变。
import { ENEMIES, SPAWN } from '../config.ts';
import { chapterOf, waveInChapter } from '../catalog.ts';
import { movedElites } from '../bosspool.ts';
import type { DamageSpec } from '../core.ts';
import { spawnSpot, type Spot } from '../spawn.ts';
import { spawnAt } from '../world.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { affixDodge, affixOnDeath, affixOnHit, applyAffixes, directHit, rollAffixes, tickAffixes } from './affixes.ts';
import { ELITES } from './config.ts';
import { jianshi, jianshiDodge, setupJianshi, spinBlades } from './jianshi.ts';
import { aegisBlock, aegisLeft, lishi, setupLishi } from './lishi.ts';
import { setupYecha, yecha, yechaDodge } from './yecha.ts';
import type { EliteAffix, EliteKind } from './types.ts';

export { AFFIX, AFFIXES, ELITES } from './config.ts';
export { armorMul, hasAffix } from './affixes.ts';
export { aegisLeft } from './lishi.ts';
export type { EliteAct, EliteAffix, EliteCall, EliteEvent, EliteKind } from './types.ts';

/** 精英的名字、出在哪、一句话（横幅、图鉴、实验页用）。 */
export const ELITE_INFO: Record<EliteKind, { name: string; where: string; desc: string }> = {
  xiaowei: { name: '回响校尉', where: '第一章', desc: '背插靠旗、手提偃月刀的殷商校尉，身厚力沉' },
  yecha: { name: '东海夜叉', where: '第一章 · 劫二起', desc: '巡海夜叉的回响，潜行水底，破浪而出' },
  lishi: { name: '金光力士', where: '第二章', desc: '执金光阵旗，为周遭之敌披上金光' },
  jianshi: { name: '截教剑侍', where: '第三章', desc: '三柄小剑绕身，轮番射来' },
};

/** 词缀的名字、写在血条左边的那个字、说明（横幅、图鉴、实验页用）。 */
export const AFFIX_INFO: Record<EliteAffix, { name: string; mark: string; desc: string }> = {
  swift: { name: '迅捷', mark: '迅', desc: '身轻如风，行动迅疾' },
  armor: { name: '坚甲', mark: '甲', desc: '甲坚难破，受伤大减' },
  split: { name: '分魂', mark: '魂', desc: '身死魂分，化作离魂' },
  recoil: { name: '反震', mark: '震', desc: '近身击之，必遭反震' },
  summon: { name: '召唤', mark: '召', desc: '时时召出回响兵' },
};

/** 这只精英是哪一种（没有字段的是回响校尉）。 */
export const eliteKind = (e: Enemy): EliteKind => e.elite ?? 'xiaowei';

/**
 * 按波次换精英的口子：登记了的那一波，到了出精英的时候不刷本章的精英，改调这里登记的函数。
 * variants 线（回响化身）把第 10、16 波的精英换成「回响化身」遭遇战，就在这里登记那两波（WAVE_ELITES[10] = …）。
 * n：这一波本来要出几只精英（劫三起多出来的那只也算在里面）；p：第一个活着的人；cams：刷怪要躲开的镜头（spawn.ts）。
 */
export const WAVE_ELITES: Partial<Record<number, (w: World, p: Player, cams: readonly Spot[], n: number, ev: SimEvent[]) => void>> = {};

/**
 * 这一波的第 i 只精英是哪一种（按章）：第一章劫一只有回响校尉；第一章劫二起，第 2、4 波的第一只（和劫三起第 4 波多出来的那只之外）
 * 换成东海夜叉——本章第 n 波的第 i 只，n + i 是双数的是夜叉；第二章金光力士；第三章截教剑侍。不用随机数。
 */
export function eliteKindFor(w: World, i: number): EliteKind {
  const ch = chapterOf(w.wave);
  // 第一章有遭遇战（首领池）时第 4 波的那只挪到了第 3 波：种类照第 4 波的规矩挑（不然劫二就见不到夜叉了）
  if (ch <= 1) return w.jie >= 2 && (waveInChapter(w.wave) + movedElites(w) + i) % 2 === 0 ? 'yecha' : 'xiaowei';
  return ch === 2 ? 'lishi' : 'jianshi';
}

/** 一只精英带几条词缀：第一章劫一不带（初见先认清它本身），别的一条，劫五两条。 */
export const affixCount = (w: World) => (chapterOf(w.wave) <= 1 && w.jie < 2 ? 0 : w.jie >= 5 ? 2 : 1);

/**
 * 出精英（world.step 里，这一波到了 35% 的时候）：贴着屏幕边刷 n 只（spawn.ts 的 spawnSpot，同原来），按章挑种类、抽词缀。
 * 第一章劫一时随机数的用法和原来完全一样（只有 spawnSpot 和 spawnAt 用）。
 */
export function spawnElites(w: World, p: Player, cams: readonly Spot[], n: number, ev: SimEvent[]) {
  const over = WAVE_ELITES[w.wave];
  if (over) {
    over(w, p, cams, n, ev);
    return;
  }
  for (let i = 0; i < n; i++) {
    const q = spawnSpot(w, p, cams, ENEMIES.elite.radius, SPAWN.eliteOut[0], SPAWN.eliteOut[1]);
    spawnElite(w, eliteKindFor(w, i), q.x, q.y, ev);
  }
}

/**
 * 遭遇战那一波（world.step；bosspool.ts）：本章原来的那一两只精英换成了遭遇战，只刷劫三起多出来的那几只（第 base 只起），
 * 照常按章挑种类、抽词缀、贴着屏幕边刷。n：这一波本来要出几只精英。
 */
export function spawnExtraElites(w: World, p: Player, cams: readonly Spot[], n: number, ev: SimEvent[]) {
  const base = chapterOf(w.wave) >= 3 ? 2 : 1;
  for (let i = base; i < n; i++) {
    const q = spawnSpot(w, p, cams, ENEMIES.elite.radius, SPAWN.eliteOut[0], SPAWN.eliteOut[1]);
    spawnElite(w, eliteKindFor(w, i), q.x, q.y, ev);
  }
}

/**
 * 在 (x, y) 刷一只 kind 的精英（world.spawnAt：气血按波次、人数、劫数照常加），再换成这一种的身板、带上词缀。
 * affixes 不给就按这一局的规矩抽（affixCount 条）；给了就带这几条（实验页、测试用，不碰随机数）。
 */
export function spawnElite(w: World, kind: EliteKind, x: number, y: number, ev: SimEvent[], affixes?: readonly EliteAffix[]): Enemy {
  const e = spawnAt(w, 'elite', x, y, ev);
  setupElite(e, kind);
  applyAffixes(e, affixes ?? rollAffixes(w, affixCount(w)));
  return e;
}

/** 换成 kind 这一种的身板（气血、移速按倍率，连波次、人数、劫数的加成一起乘）、设好它自己的计时。回响校尉什么都不改。 */
export function setupElite(e: Enemy, kind: EliteKind) {
  if (kind === 'xiaowei') return;
  const K = ELITES[kind];
  e.elite = kind;
  if (K.hp !== 1) e.hp = e.maxHp = Math.max(1, Math.round(e.maxHp * K.hp));
  e.speed *= K.speed;
  if (kind === 'yecha') setupYecha(e);
  else if (kind === 'lishi') setupLishi(e);
  else setupJianshi(e);
}

/**
 * 精英每帧的行为（enemies.actEnemy 的 'elite' 分支）：先走词缀的动作（反震蓄力、召唤掐诀，做的时候站着），再按种类走自己的招。
 * 回响校尉没有自己的招，原样返回默认的速度。
 */
export function actElite(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  if (e.elite === 'jianshi') spinBlades(e);
  if (tickAffixes(w, e, t, ev)) return [0, 0];
  switch (e.elite) {
    case 'yecha':
      return yecha(w, e, t, vx, vy, ev);
    case 'lishi':
      return lishi(w, e, t, vx, vy, ev);
    case 'jianshi':
      return jianshi(w, e, t, vx, vy, ev);
    default:
      return [vx, vy];
  }
}

/**
 * 挨打的那一下（core.hitEnemy，判过死活和无敌之后、结算伤害之前）。返回 true = 这一下被金光挡下了（不掉血、不吃状态）。
 * 金光可以套在任何敌人身上（金光力士给的）：挡直接命中，灼烧、流血、地面区域和神通挡不住。精英的「反震」在这里起手。
 */
export function eliteHit(w: World, e: Enemy, s: DamageSpec, ev: SimEvent[]): boolean {
  if (e.kind === 'elite') affixOnHit(w, e, s, ev);
  if (e.aegis && aegisLeft(w, e) > 0 && directHit(s) && s.by !== 'skill') {
    aegisBlock(w, e, ev);
    return true;
  }
  return false;
}

/** 精英死时（enemies.onFoeKilled）：分魂分出离魂。 */
export function eliteKilled(w: World, e: Enemy, ev: SimEvent[]) {
  if (e.kind !== 'elite') return;
  affixOnDeath(w, e, ev);
}

/**
 * 机器人躲精英的招（bot-dodge.botEnemyDodge 里加上；精英不走那里通用的直线那一段）：夜叉要冒出来的那一片、拍浪那一条，
 * 剑侍抬剑时的那条线，反震蓄力那一圈。量级同 botEnemyDodge（站在危险里最大约 base + pull）。
 */
export function eliteDodge(w: World, p: Player, react: number, margin: number, base: number, pull: number): [number, number] {
  let ax = 0;
  let ay = 0;
  const lane = (x0: number, y0: number, ux: number, uy: number, len: number, half: number): [number, number] => {
    const h = half + margin;
    const rx = p.x - x0;
    const ry = p.y - y0;
    const along = rx * ux + ry * uy;
    const side = -rx * uy + ry * ux;
    if (along < -margin || along > len + margin || Math.abs(side) > h) return [0, 0];
    const s = Math.abs(side) > 0.5 ? Math.sign(side) : 1;
    const k = base + pull * (1 - Math.abs(side) / h);
    return [-uy * s * k, ux * s * k];
  };
  for (const e of w.enemies) {
    if (e.kind !== 'elite' || e.hp <= 0) continue;
    let d: [number, number] = [0, 0];
    if (e.elite === 'yecha') d = yechaDodge(e, p, react, margin, base, pull, lane);
    else if (e.elite === 'jianshi') d = jianshiDodge(e, react, lane);
    ax += d[0];
    ay += d[1];
  }
  const [rx, ry] = affixDodge(w, p, react, margin, base, pull);
  return [ax + rx, ay + ry];
}
