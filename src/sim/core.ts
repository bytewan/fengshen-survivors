// 模拟核心：空间网格、伤害结算（暴击 / 易伤 / 冻结 / 五行 / 相生）、状态效果、击杀奖励、玩家受伤。
// 法宝、神通、五行加成都走这里的同一条伤害管线，保证规则只写一遍。
import { ARENA, ENEMIES, MIASMA, PLAYER, REACH, SKILL } from './config.ts';
import { HEROES, MARK_T, REACT, REACTIONS, TIER_DMG, WEAPONS, WX } from './catalog.ts';
import { rollDrop } from './drops.ts';
import { guardMul, onFoeKilled } from './enemies.ts';
import { terrainDmgMul } from './chapters.ts';
import { jieBossDmg } from './jie.ts';
import { eliteHit } from './elites/index.ts';
import { range } from './rng.ts';
import { techBlock, techBurnTick, techHitMul, techHurt, techHurtMul, techKill, techMarkMul } from './techniques.ts';
import { relicAfterHit, relicBlock, relicHitMul, relicHurt, relicKill } from './relics.ts';
import { hitMul2, kill2, status2 } from './arti2.ts';
import { downPlayer, hurtMul } from './coop.ts';
import { debuffCrit, debuffMul, foeKilled, heroCharge, heroCrit, heroHitMul, heroHurt, sundered } from './heroes/passives.ts';
import type { Element, Enemy, HitBy, HurtBy, OwnedWeapon, Player, ReactionKind, SimEvent, WeaponKind } from './types.ts';
import type { World } from './world.ts';
import { CHAIN_BY, jinqi, petElOf, reactionInto, vine, wxSetOf, wxTier } from './wuxing.ts';

// ---------- 空间网格 ----------
const CELL = 24;
const PADC = Math.ceil(MIASMA.depth / CELL) + 1; // 魔气带里的敌人也要进网格
const GW = Math.ceil(ARENA.w / CELL) + PADC * 2 + 1;
const GH = Math.ceil(ARENA.h / CELL) + PADC * 2 + 1;
// 初值必须是 -1（空格子）：全 0 的话，第一次 buildGrid 之前调 forNear / enemiesWithin 会沿着 heads[c] = 0、nexts[0] = 0 原地打转，整页卡死
const heads = new Int32Array(GW * GH).fill(-1);
let nexts = new Int32Array(512);
const cx = (x: number) => Math.min(GW - 1, Math.max(0, Math.floor(x / CELL) + PADC));
const cy = (y: number) => Math.min(GH - 1, Math.max(0, Math.floor(y / CELL) + PADC));
export function buildGrid(es: Enemy[]) {
  heads.fill(-1);
  if (nexts.length < es.length) nexts = new Int32Array(es.length * 2);
  for (let i = 0; i < es.length; i++) {
    const c = cy(es[i].y) * GW + cx(es[i].x);
    nexts[i] = heads[c];
    heads[c] = i;
  }
}
/** 遍历 (x,y) 半径 r 内可能的敌人下标（粗筛，调用方再精确判距离）。 */
export function forNear(es: Enemy[], x: number, y: number, r: number, fn: (i: number) => void) {
  const x0 = cx(x - r);
  const x1 = cx(x + r);
  const y0 = cy(y - r);
  const y1 = cy(y + r);
  for (let gy = y0; gy <= y1; gy++)
    for (let gx = x0; gx <= x1; gx++) for (let i = heads[gy * GW + gx]; i !== -1; i = nexts[i]) if (i < es.length) fn(i);
}
/** 半径内的活敌人（精确距离），按距离排序可选。 */
export function enemiesWithin(w: World, x: number, y: number, r: number): Enemy[] {
  const out: Enemy[] = [];
  forNear(w.enemies, x, y, r, (i) => {
    const e = w.enemies[i];
    if (e.hp > 0 && (e.x - x) ** 2 + (e.y - y) ** 2 <= r * r) out.push(e);
  });
  return out;
}
/** keep：只挑满足条件的（比如 inReach(p)：连跳、追踪只挑离人物 REACH.max 以内的）。 */
export function nearestEnemy(w: World, x: number, y: number, maxR: number, skip?: Set<number>, keep?: (e: Enemy) => boolean): Enemy | null {
  let best: Enemy | null = null;
  let bd = maxR * maxR;
  for (const e of w.enemies) {
    if (e.hp <= 0 || skip?.has(e.id)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bd && (!keep || keep(e))) {
      bd = d;
      best = e;
    }
  }
  return best;
}
/**
 * 离人物 p（脚下）REACH.max 以内（射程规则见 config.REACH）：雷的连跳、导雷、飞刀与火鸟追的下一只、金绳捆的下一只、
 * 旋风卷的敌人都只在这里面挑。p 不在（掉线的主人）就不限。
 */
export const inReach =
  (p: { x: number; y: number } | undefined) =>
  (e: { x: number; y: number }): boolean =>
    !p || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= REACH.max * REACH.max;

// ---------- 五行 ----------
/** 每个五行带了几件：法宝（专属法宝也算）+ 宠物（宠物算一件，是和主五行不同的另一行，用户 11-12；见 sim/wuxing.ts）。 */
export function elementCounts(p: Player): Record<Element, number> {
  const c: Record<Element, number> = { metal: 0, wood: 0, water: 0, fire: 0, earth: 0 };
  for (const wpn of p.weapons) c[WEAPONS[wpn.kind].el]++;
  if (p.pet) c[petElOf(p)]++;
  return c;
}

/** 法宝一次出手的基础伤害（未算暴击和目标身上的易伤）。品阶倍率按每件法宝自己的表（数量多的法宝单发涨得慢），神品再乘器灵的倍数。 */
export function weaponDamage(p: Player, wpn: OwnedWeapon, rage: number) {
  const def = WEAPONS[wpn.kind];
  const sp = wpn.spirit ? (def.spirits.find((s) => s.id === wpn.spirit)?.mul ?? 1) : 1;
  const d = def.dmg * (def.mul[wpn.tier] ?? TIER_DMG[wpn.tier]) * sp * (1 + p.stats.damage + p.stats.aff[def.el] + rage * 0.3);
  return p.boon?.bond && wpn.kind === HEROES[p.hero].exclusive ? d * (1 + p.boon.bond) : d; // 修为「人宝合一」（xiuwei.ts）
}

/** 点到线段的距离（火尖枪的贯穿、火痕的判定）。 */
export function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t));
}

/**
 * 五行印记与相生（用户：不同属性之间要有搭配、增强）。
 * 带五行的法宝打中敌人，会留下本行的印记（MARK_T 秒）；敌人身上的印记是 A、这一下是 A 所生的那一行时触发相生，
 * 消耗印记，这一下按 catalog.REACT 加强，然后照常留下自己的印记（所以五行可以接力：木 → 火 → 土 → 金 → 水 → 木）。
 * 五行俱全（sim/wuxing.ts）时不挑顺序：印记是别的哪一行都行，触发「生成这一下这一行」的那种；之后这只 WX.cd 秒内不再相生。
 * 三才 / 四象 / 俱全：相生那一下的伤害、印记的持续再加（catalog.WX.set）。
 * 持续伤害（灼烧、流血、区域）、相生本身打出的额外伤害、燎原 / 碎冰的爆炸、五行三件档的金气与震地（wx）、神通都不打印记、不触发相生。
 */
const NO_MARK: ReadonlySet<HitBy> = new Set<HitBy>(['burn', 'bleed', 'zone', 'react', 'explode', 'skill', 'sword', 'ten', 'plague', 'wx']); // ten：第二章十阵轮转的阵（地形的伤害）；sword：第三章四剑轮斩的剑气（地形的伤害）；plague：瘟癀伞的瘟（持续掉血）
const REACTION_BY: Partial<Record<string, ReactionKind>> = Object.fromEntries(
  (Object.keys(REACTIONS) as ReactionKind[]).map((k) => [`${REACTIONS[k].from}>${REACTIONS[k].to}`, k]),
);
/** 带着 mark 印记的敌人被 el 行打中会不会相生，会的话是哪一种。 */
export const reactionOf = (mark: Element, el: Element): ReactionKind | null => REACTION_BY[`${mark}>${el}`] ?? null;

export interface DamageSpec {
  dmg: number;
  by: HitBy;
  owner: number;
  from: { x: number; y: number };
  kb?: number; // 击退速度
  el?: Element; // 来源五行（决定吃哪些五行加成、打什么印记）
  canCrit?: boolean;
  burn?: number; // 附加灼烧：每秒伤害
  burnT?: number;
  bleed?: number; // 附加流血：每层每秒伤害（叠层，最多 BLEED.stacks 层）
  bleedT?: number;
  stun?: number;
  freeze?: number;
  vsElite?: number; // 对精英 / 首领的伤害倍率
  noMark?: boolean; // 这一下不打印记、不触发相生
  execute?: number; // 这一下打完，血量低于最大气血这一比例的非首领敌人直接斩杀（打神鞭器灵「封神」）
}

/** 流血（斩仙飞刀仙品起）：每层每秒伤害，叠层有上限；每 tick 秒跳一次字。 */
export const BLEED = { stacks: 3, tick: 0.5 };

/**
 * 化血神刀的流血（它的击杀结算在这里，所以数值也放这里；斩击的范围在 weapons.TUNE.huaxue）：
 * 每层流血每秒为这一斩的 bleed 倍、流 bleedT 秒，一斩叠 stacks 层（灵品起两层），最多叠 cap 层（比斩仙飞刀的三层多：精英身上越叠越深）；
 * 被一斩斩死的不算「带着流血」。仙品「化血」：身上带着流血死掉的敌人化成血雾，半径 mist.r 内的敌人各被传上 mist.stacks 层、流 mist.t 秒。
 */
export const HUAXUE = {
  bleed: [0, 0.2, 0.2, 0.2, 0.2],
  bleedT: 3.5,
  stacks: [0, 1, 2, 2, 2],
  cap: [0, 3, 4, 5, 5],
  mist: { r: 24, stacks: 1, t: 2 }, // r 26 → 24（2026-11-11：仙品群伤比中位数高两成）
};

/** 点燃：按五行加成算（火一件灼烧 +20%、火两件可叠三层、火绫「引火」灼烧时长翻倍）。 */
export function addBurn(w: World, e: Enemy, owner: number, dps: number, t: number) {
  if (dps <= 0 || t <= 0) return;
  const p = w.players[owner];
  const ec = p ? elementCounts(p) : null;
  const add = dps * (ec && ec.fire >= 1 ? 1.2 : 1);
  e.burn = ec && ec.fire >= 2 ? Math.max(e.burn, Math.min(add * 3, e.burn + add)) : Math.max(e.burn, add);
  e.burnT = Math.max(e.burnT, t * (e.fireVulnT > 0 ? 2 : 1));
  e.burnBy = owner;
}

/** 流血叠一层：每层 dps，最多 cap 层（默认 BLEED.stacks；化血神刀叠得更多），时长刷新。 */
export function addBleed(e: Enemy, owner: number, dps: number, t: number, cap = BLEED.stacks) {
  if (dps <= 0 || t <= 0) return;
  e.bleed = Math.max(e.bleed, Math.min(dps * cap, e.bleed + dps));
  e.bleedT = Math.max(e.bleedT, t);
  e.bleedBy = owner;
  if (e.bleedTick === undefined || e.bleedTick <= 0) e.bleedTick = BLEED.tick;
}

/** 减速（水行一件：减速 +20%），最多 85%。 */
export function slowEnemy(w: World, e: Enemy, owner: number, amount: number, t: number) {
  const p = w.players[owner];
  const ec = p ? elementCounts(p) : null;
  e.slow = Math.max(e.slow, Math.min(0.85, amount * (ec && ec.water >= 1 ? 1.2 : 1)));
  e.slowT = Math.max(e.slowT, t);
}

/**
 * 不带伤害的冻结（玄元控水旗器灵「寒潭」）：和 hitEnemy 里的冻结同一套规则 —— 首领、无敌的不吃，水行一件冻得更久（×1.2），
 * 刚冻上时发 freeze 事件。返回冻没冻上。
 */
export function freezeEnemy(w: World, e: Enemy, owner: number, t: number, ev: SimEvent[]): boolean {
  if (e.hp <= 0 || e.kind === 'boss' || e.invuln > 0 || t <= 0) return false;
  const p = w.players[owner];
  const ec = p ? elementCounts(p) : null;
  const f = t * (ec && ec.water >= 1 ? 1.2 : 1);
  if (e.frozen <= 0) ev.push({ t: 'freeze', id: e.id, x: e.x, y: e.y });
  e.frozen = Math.max(e.frozen, f);
  e.stun = Math.max(e.stun, f);
  return true;
}

/** 对一个敌人结算一次伤害：相生、暴击、易伤、冻结翻倍、击退、状态、印记、击杀。返回实际伤害。 */
export function hitEnemy(w: World, e: Enemy, s: DamageSpec, ev: SimEvent[]): number {
  if (e.hp <= 0 || e.invuln > 0) return 0;
  if (eliteHit(w, e, s, ev)) return 0; // 精英（elites/）：金光力士给的金光挡下这一下；精英词缀「反震」在这里起手
  const p = w.players[s.owner];
  const ec = p ? elementCounts(p) : null;
  const markable = !!s.el && !s.noMark && !NO_MARK.has(s.by);
  const set = ec ? wxSetOf(ec) : null; // 异行档：三才 / 四象 / 五行俱全
  let react: ReactionKind | null = null;
  if (markable && e.mark && e.markT > 0 && !(e.reactUntil !== undefined && w.time < e.reactUntil)) {
    react = reactionOf(e.mark, s.el!) ?? (set?.n === 5 && e.mark !== s.el ? reactionInto(s.el!) : null);
    if (react && set?.n === 5) e.reactUntil = w.time + WX.cd; // 俱全：这只相生之后歇一会儿，免得一帧里接力刷屏
  }
  const ccImmune = e.kind === 'boss'; // 首领不吃控制（晕眩、定身、冻结），否则一套控制就能把它锁死
  let dmg = s.dmg;
  if (react === 'frost' || react === 'conduct' || react === 'lava') dmg *= REACT[react].dmg;
  if (react && set) dmg *= 1 + set.react; // 三才 / 四象 / 俱全：相生的伤害更高（引燃的灼烧、导雷的连跳跟着涨）
  let crit = false;
  if (s.canCrit !== false && p) {
    const chance = p.stats.crit + (ec && ec.metal >= 1 ? 0.05 : 0) + debuffCrit(w, e); // 哮天犬「金牙」：被咬的更容易被暴击
    if (react === 'pierce' || w.rng.next() < chance) {
      crit = true;
      dmg *= p.stats.critMul + (ec && ec.metal >= 2 ? 0.3 : 0) + (react === 'pierce' ? REACT.pierce.critMul : 0);
    }
  }
  dmg *= techHitMul(w, p, e, s, dmg, react, crit, ev); // 功法：天眼通、五行轮转、寒冰诀（techniques.ts）
  dmg *= relicHitMul(w, p, e, ev); // 灵物：照妖镜、逆鳞、定颜珠、夔牛鼓（relics.ts）
  dmg *= hitMul2(w, e); // 再加的 11 件法宝：攒心钉的钉子……（arti2.ts）
  if (w.terrain && p && s.by !== 'skill') dmg *= terrainDmgMul(w, p); // 地形：站在金光阵里法宝伤害提高（chapters.ts；神通不算）
  if (s.vsElite && (e.kind === 'elite' || e.kind === 'boss')) dmg *= s.vsElite;
  if (e.vulnT > 0) dmg *= 1 + e.vuln;
  if (e.tangleUntil !== undefined && w.time < e.tangleUntil) dmg *= 1 + (e.tangle ?? 0); // 木行三件的藤蔓缠着：受伤加深（单算一层）
  if (e.fireVulnT > 0 && s.el === 'fire') dmg *= 1 + e.fireVuln;
  if (e.frozen > 0 && ec && ec.water >= 3) dmg *= WX.frost[wxTier(ec.water)]; // 水行三件「寒彻」（四件「玄冰」更狠）
  dmg *= sundered(w, e) ? 1 : guardMul(e, s, ev); // 盾兵：正面挡下的伤害大幅降低（enemies.ts；其他敌人是 1）。被哮天犬咬得「破甲」时盾挡不住
  if (e.wardT && !sundered(w, e)) dmg *= 1 - (e.ward ?? 0); // 第二章：落魂幡手给的护体（enemies.ts）。「破甲」：护体也不顶用
  dmg *= debuffMul(w, e, s.el); // 角色带来的减益：哮天犬「破甲」「金牙」、杨戬「天眼」的标记（heroes/passives.ts；没有就是 1）
  dmg *= heroHitMul(w, p, e); // 角色的被动：云霄「冰心」打冻住的更疼、魔化哪吒「业火」越残越狠、孙悟空「火眼金睛」打精英和首领更疼（heroes/passives.ts；没有就是 1）
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg;
  if (e.hpFloor !== undefined && e.hp < e.hpFloor) e.hp = e.hpFloor; // 回响化身遭遇战：换阶段之前打不死（echo/）
  // 击退（土行两件 +30%）
  if (s.kb) {
    const k = ENEMIES[e.kind];
    const dx = e.x - s.from.x;
    const dy = e.y - s.from.y;
    const d = Math.hypot(dx, dy) || 1;
    const kb = s.kb * (ec && ec.earth >= 2 ? 1.3 : 1);
    e.kx += (dx / d) * (kb / k.mass);
    e.ky += (dy / d) * (kb / k.mass);
  }
  // 状态
  if (s.burn && s.burnT) addBurn(w, e, s.owner, s.burn, s.burnT);
  if (react === 'ignite') addBurn(w, e, s.owner, dmg * REACT.ignite.burn, REACT.ignite.burnT);
  if (s.bleed && s.bleedT) addBleed(e, s.owner, s.bleed, s.bleedT);
  const stun = (s.stun ?? 0) + (react === 'lava' ? REACT.lava.stun : 0);
  if (stun && !ccImmune) e.stun = Math.max(e.stun, stun);
  let freeze = ccImmune ? 0 : (s.freeze ?? 0);
  if (!freeze && !ccImmune && ec && ec.water >= 2 && !NO_MARK.has(s.by) && w.rng.next() < WX.freezeChance[wxTier(ec.water)]) freeze = 1; // 水行两件：命中几率冻结（三件、四件「寒彻」「玄冰」更常冻）
  if (react === 'frost' && !ccImmune) freeze = Math.max(freeze, REACT.frost.freeze);
  if (!ccImmune && s.el === 'water' && e.soakUntil !== undefined && w.time < e.soakUntil && !NO_MARK.has(s.by)) {
    // 避水兽「湿透」：水行的伤害打上来就冻住（pets/bishui.ts）；冻上就不湿了。霜髓：冻着的这一会儿受伤更深
    freeze = Math.max(freeze, e.soakFreeze ?? 0);
    if (e.soakDeep) {
      e.vuln = Math.max(e.vuln, e.soakDeep);
      e.vulnT = Math.max(e.vulnT, freeze * 1.2 + 0.1);
    }
    delete e.soakUntil;
  }
  if (freeze) {
    if (ec && ec.water >= 1) freeze *= 1.2;
    if (e.frozen <= 0) ev.push({ t: 'freeze', id: e.id, x: e.x, y: e.y });
    e.frozen = Math.max(e.frozen, freeze);
    e.stun = Math.max(e.stun, freeze);
  }
  ev.push({ t: 'hit', id: e.id, kind: e.kind, x: e.x, y: e.y, dmg, crit, by: s.by });
  if (crit && p) heroCrit(w, p); // 角色的被动（杨戬「乘隙」：暴击后加速）
  // 印记：相生消耗旧印记，这一下照常留下自己的
  if (react) {
    e.mark = null;
    e.markT = 0;
  }
  if (markable) {
    e.mark = s.el!;
    e.markT = MARK_T * techMarkMul(p) * (1 + (set?.mark ?? 0)); // 四象 / 俱全：印记更久
  }
  // 金行三件「斩杀」：血量低于斩杀线直接斩（首领除外；三件 15%、四件 20%）；打神鞭「封神」带着自己的斩杀线
  let execute = false;
  const metal3 = !!ec && ec.metal >= 3;
  if (e.hp > 0 && e.kind !== 'boss' && ((metal3 && e.hp < e.maxHp * WX.exec[wxTier(ec!.metal)]) || (s.execute && e.hp < e.maxHp * s.execute))) {
    e.hp = 0;
    execute = true;
  }
  if (e.hp <= 0) onKill(w, e, s.owner, execute, ev, s.by);
  // 金行三件：斩杀时迸出金气斩向身边（金气本身斩死的不再迸，见 wuxing.CHAIN_BY）
  if (execute && metal3 && p && !CHAIN_BY.has(s.by)) jinqi(w, p, e, dmg, ev);
  // 相生的后续放在击杀结算之后：额外伤害里再打死这只（熔岩烧完灼烧）也只结算一次击杀
  if (react) reactAfter(w, e, react, s, dmg, ev);
  relicAfterHit(w, p, e, s, dmg, crit, react, ev); // 灵物：暴击引雷（风雷羽）、相生炸开（九龙玉佩）（relics.ts）
  return dmg;
}

/** 相生的后续：发 react 事件，打出额外的伤害（这些伤害 by 'react'，不再触发相生）。 */
function reactAfter(w: World, e: Enemy, kind: ReactionKind, s: DamageSpec, dmg: number, ev: SimEvent[]) {
  const owner = s.owner;
  const evt: SimEvent & { t: 'react' } = { t: 'react', id: e.id, x: e.x, y: e.y, kind, owner };
  ev.push(evt);
  if (kind === 'conduct') {
    // 导雷：雷光从这只身上再跳几只（和雷公鞭的连跳一样，只跳到离人物 REACH.max 以内的）
    const R = REACT.conduct;
    const used = new Set<number>([e.id]);
    const pts: [number, number][] = [[e.x, e.y - 8]];
    let cur: Enemy = e;
    const keep = inReach(w.players[owner]);
    buildGrid(w.enemies);
    for (let j = 0; j < R.jumps; j++) {
      const next = nearestEnemy(w, cur.x, cur.y, R.range, used, keep);
      if (!next) break;
      used.add(next.id);
      pts.push([next.x, next.y - 8]);
      hitEnemy(w, next, { dmg: dmg * R.jumpDmg, by: 'react', owner, from: cur, el: 'wood', stun: 0.15 }, ev);
      cur = next;
    }
    evt.pts = pts;
  } else if (kind === 'ignite') {
    // 引燃：点着身边的敌人
    const R = REACT.ignite;
    evt.r = R.r;
    buildGrid(w.enemies);
    for (const o of enemiesWithin(w, e.x, e.y, R.r)) if (o !== e) addBurn(w, o, owner, dmg * R.spread, R.spreadT);
  } else if (kind === 'lava') {
    // 熔岩：身上剩下的灼烧一次烧完，溅到身边
    const R = REACT.lava;
    const rest = e.burn * Math.max(0, e.burnT) * R.burnMul + e.burnAcc;
    e.burn = 0;
    e.burnT = 0;
    e.burnAcc = 0;
    evt.r = R.r;
    if (rest >= 1) {
      buildGrid(w.enemies);
      const near = enemiesWithin(w, e.x, e.y, R.r);
      if (e.hp > 0) hitEnemy(w, e, { dmg: rest, by: 'react', owner, from: e, el: 'fire', canCrit: false }, ev);
      for (const o of near) if (o !== e) hitEnemy(w, o, { dmg: rest * R.splash, by: 'react', owner, from: e, el: 'fire', canCrit: false }, ev);
    }
  }
}

/** 化血神刀仙品「化血」的血雾：割出这道流血的人带着仙品起的化血神刀才会发生。 */
function bloodMist(w: World, e: Enemy, ev: SimEvent[]) {
  const p = w.players[e.bleedBy ?? -1];
  const wpn = p?.weapons.find((x) => x.kind === 'huaxue');
  if (!p || !wpn || wpn.tier < 3) return;
  const M = HUAXUE.mist;
  const r = M.r * (1 + p.stats.area * 0.5);
  const per = weaponDamage(p, wpn, p.buffs.rage) * HUAXUE.bleed[wpn.tier];
  buildGrid(w.enemies);
  const ids: number[] = [];
  for (const o of enemiesWithin(w, e.x, e.y, r)) {
    if (o === e) continue;
    for (let k = 0; k < M.stacks; k++) addBleed(o, p.id, per, M.t, HUAXUE.cap[wpn.tier]);
    ids.push(o.id);
  }
  ev.push({ t: 'mist', owner: p.id, x: e.x, y: e.y, r, ids, kind: 'huaxue', tier: wpn.tier });
}

/** by：打死它的那一下。被「余波」（wuxing.CHAIN_BY：爆炸、相生的额外伤害、金气、震地……）打死的不再触发燎原、碎冰、藤蔓（防一帧里无限连环）。 */
function onKill(w: World, e: Enemy, owner: number, execute: boolean, ev: SimEvent[], by: HitBy) {
  ev.push({ t: 'kill', id: e.id, kind: e.kind, x: e.x, y: e.y, owner, execute });
  const k = ENEMIES[e.kind];
  const p = w.players[owner];
  if (p) {
    p.kills++;
    p.skill = Math.min(1, p.skill + (e.kind === 'elite' || e.kind === 'boss' ? SKILL.chargePerElite : SKILL.chargePerKill) * (1 + (p.boon?.skill ?? 0) + heroCharge(p))); // 哪吒「灵珠子」（heroes/passives.ts） // 修为「凝神」充得快（xiuwei.ts）
    techKill(w, p, e, ev); // 功法：混元一气、三昧真火传火（techniques.ts）
    relicKill(w, p, e, ev); // 灵物、符箓：燃魂香、招宝符（relics.ts）
    const ec = elementCounts(p);
    const chained = CHAIN_BY.has(by); // 被余波打死的：不再连环
    const healChance = p.stats.soul + (ec.wood >= 3 ? WX.heal[wxTier(ec.wood)] : 0); // 吸魂 + 木行三件「生生不息」
    if (healChance > 0 && w.rng.next() < healChance) p.hp = Math.min(p.stats.maxHp, p.hp + 2);
    if (ec.wood >= 3 && !chained) vine(w, p, e, ev); // 木行三件：倒下的地方冒出藤蔓（wuxing.ts）
    // 火行三件「燎原」：烧着的敌人死时炸开（四件「焚天」炸得更大更烈）。被爆炸、余波炸死的不再炸开：一帧里最多一层，
    // 火要等点着的那些自己烧死了才接着炸（一帧一帧地烧过去，不会在一帧里连成一片）
    if (ec.fire >= 3 && e.burnT > 0 && !chained) {
      const ft = wxTier(ec.fire);
      const br = WX.blaze.r[ft];
      ev.push({ t: 'explode', x: e.x, y: e.y, r: br });
      buildGrid(w.enemies);
      // 炸开的火只点着没炸死的、按原样传（不再吃一遍火行加成、不叠层）：原来在 hitEnemy 里点火，
      // 连环炸开时每炸一层灼烧就 ×1.2 还能叠到三倍，一帧里越炸越旺（功法分支量到过 10^10 的灼烧，techniques 分支改）
      for (const o of enemiesWithin(w, e.x, e.y, br)) {
        if (o === e) continue;
        hitEnemy(w, o, { dmg: e.burn * WX.blaze.mul[ft], by: 'explode', owner, from: e, el: 'fire', canCrit: false }, ev);
        if (o.hp <= 0) continue;
        o.burn = Math.max(o.burn, e.burn);
        o.burnT = Math.max(o.burnT, 2 * (o.fireVulnT > 0 ? 2 : 1));
        o.burnBy = owner;
      }
    }
    // 寒冰幡器灵「碎冰」：冻住的敌人死时炸出冰片
    if (e.frozen > 0 && !chained && p.weapons.some((x) => x.kind === 'hanbing' && x.spirit === 'shatter')) {
      ev.push({ t: 'explode', x: e.x, y: e.y, r: 22 });
      buildGrid(w.enemies);
      const wpn = p.weapons.find((x) => x.kind === 'hanbing')!;
      for (const o of enemiesWithin(w, e.x, e.y, 22))
        if (o !== e) hitEnemy(w, o, { dmg: weaponDamage(p, wpn, p.buffs.rage) * 0.3, by: 'explode', owner, from: e, el: 'water', freeze: 0.6 }, ev);
    }
  }
  // 化血神刀仙品「化血」：带着流血死掉的敌人化成血雾，把流血传给身边的敌人（算给割出这道流血的人）
  if (e.bleedT > 0) bloodMist(w, e, ev);
  for (let i = 0; i < k.gems; i++) {
    const a = w.rng.next() * Math.PI * 2;
    const sp = k.gems > 1 ? range(w.rng, 30, 90) : 0;
    w.gems.push({ id: w.nextId++, x: e.x, y: e.y, px: e.x, py: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, value: k.gemValue, pulled: -1 });
  }
  rollDrop(w, e, ev);
  foeKilled(w, e, ev); // 黑虎「破财」：被震慑时被打死的多掉一颗灵石（heroes/passives.ts；没走这条路的不动随机数）
  kill2(w, e, ev); // 再加的 11 件法宝：落宝金钱附着的那只死了「落宝」多掉灵石（arti2.ts）
  onFoeKilled(w, e, ev); // 分魂鬼死时分成两只小鬼、红沙傀儡碎开、精英词缀「分魂」分出离魂（enemies.ts）
}

/** 敌人对玩家造成伤害：闪避、护心符、护盾、护体、土行站定减伤、狂血丹、替身符。返回是否真的扣了血。 */
export function hurtPlayer(w: World, p: Player, raw: number, by: HurtBy, ev: SimEvent[]): boolean {
  if (!p.alive || p.iframes > 0) return false;
  if (by === 'boss') raw *= jieBossDmg(w); // 劫四起首领打人更疼（jie.ts；劫一到三是 1）
  const b = p.boon; // 修为（xiuwei.ts）：缩地成寸、先天道体、五气朝元；没点修为没有这个字段
  if (w.rng.next() < Math.min(0.6, p.stats.dodge + zoneDodge(w, p) + (b?.stepDodge && p.moving ? b.stepDodge : 0))) {
    p.iframes = 0.25;
    ev.push({ t: 'dodge', owner: p.id, x: p.x, y: p.y });
    return false;
  }
  if (relicBlock(w, p, by, ev)) return false; // 灵物「混元伞残片」挡下鬼火（relics.ts）
  if (p.charms.includes('huxin') && !p.charmUsed.huxin) {
    p.charmUsed.huxin = true;
    p.iframes = PLAYER.iframes;
    ev.push({ t: 'blocked', owner: p.id, x: p.x, y: p.y, by: 'huxin' });
    return false;
  }
  if (p.shield > 0) {
    p.shield--;
    p.iframes = PLAYER.iframes;
    ev.push({ t: 'blocked', owner: p.id, x: p.x, y: p.y, by: 'shield' });
    if (p.shield === 0) shieldBreak(w, p, ev);
    return false;
  }
  if (techBlock(w, p, ev)) return false; // 功法「六丁六甲」：耗一道护身甲抵掉这一下（techniques.ts）
  const ec = elementCounts(p);
  let dmg = raw * (10 / (10 + Math.max(0, p.stats.armor + (ec.earth >= 1 ? 2 : 0))));
  if (ec.earth >= 3 && p.still > 0.3) dmg *= 0.5; // 土行三件「不动如山」
  if (p.buffs.rage) dmg *= 1.2;
  dmg *= techHurtMul(p); // 功法「法天象地」（techniques.ts）
  dmg *= hurtMul(p); // 联机：掉线托管中受到的伤害减半（coop.ts）
  if (b?.fullGuard && p.hp >= p.stats.maxHp) dmg *= 1 - b.fullGuard;
  if (b?.bossGuard && (by === 'boss' || by === 'echo')) dmg *= 1 - b.bossGuard;
  dmg = Math.max(1, Math.round(dmg));
  p.hp -= dmg;
  p.iframes = PLAYER.iframes;
  if (p.hp <= 0 && p.charms.includes('tishen') && !p.charmUsed.tishen) {
    p.charmUsed.tishen = true;
    p.hp = 1;
    p.iframes = 1.5;
    ev.push({ t: 'blocked', owner: p.id, x: p.x, y: p.y, by: 'tishen' });
  }
  heroHurt(w, p, dmg); // 角色的被动：回响赵公明「怨力」挨打攒怨（heroes/passives.ts；别的角色什么都不做）
  techHurt(w, p, raw, ev); // 功法：莲花化身重生、金刚不坏反弹（techniques.ts）
  relicHurt(w, p, raw, ev); // 灵物、符箓：金刚琢印、定身符、遁地符、神行符（relics.ts）
  ev.push({ t: 'hurt', owner: p.id, x: p.x, y: p.y, dmg, hp: Math.max(0, p.hp), by });
  if (p.hp <= 0) downPlayer(w, p, ev); // 单人倒下就陨落；联机是倒地等人扶（coop.ts）
  return true;
}

/** 站在带闪避的区域里（青莲宝色旗器灵「莲台」的结界）额外的闪避；几块叠在一起取最高的。 */
function zoneDodge(w: World, p: Player) {
  let d = 0;
  for (const z of w.zones) if (z.dodge && z.t < z.life && (p.x - z.x) ** 2 + (p.y - z.y) ** 2 <= z.r * z.r) d = Math.max(d, z.dodge);
  return d;
}

/**
 * 戊己杏黄旗的数值：护盾层数、破碎时震开的半径与伤害倍率（按品阶）、仙品起有盾时脚下金莲的减速。
 * 冷却从护盾破碎时算起（cd 秒后重新套上）。
 */
export const XINGHUANG = {
  shields: [0, 1, 1, 2, 2], // 凡 / 灵挡一次，仙品起挡两次（器灵「金莲护体」再 +2）
  breakR: [0, 46, 60, 64, 64],
  breakMul: [0, 1, 1.25, 1.25, 1.25],
  lotusR: 40, // 金莲半径（吃范围的一半）
  lotusSlow: 0.4,
};

/** 杏黄旗护盾破碎：震开周围敌人。 */
export function shieldBreak(w: World, p: Player, ev: SimEvent[]) {
  const wpn = p.weapons.find((x) => x.kind === 'xinghuang');
  if (!wpn) return;
  const r = XINGHUANG.breakR[wpn.tier] * (1 + p.stats.area);
  ev.push({ t: 'shieldBreak', owner: p.id, x: p.x, y: p.y, r, tier: wpn.tier });
  const dmg = weaponDamage(p, wpn, p.buffs.rage) * XINGHUANG.breakMul[wpn.tier] * (wpn.spirit === 'burst' ? 3 : 1);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, p.x, p.y, r)) hitEnemy(w, e, { dmg, by: 'shield', owner: p.id, from: p, kb: 260, el: 'earth', stun: 0.3 }, ev);
  wpn.cd = WEAPONS.xinghuang.cd;
  p.lotus = 0;
}

/** 状态随时间：灼烧 / 流血掉血、晕眩 / 冻结 / 减速 / 易伤 / 印记倒计时。 */
export function tickStatus(w: World, e: Enemy, dt: number, ev: SimEvent[]) {
  if (e.burnT > 0) {
    e.burnT -= dt;
    e.burnAcc += e.burn * dt * techBurnTick(w, e); // 功法「三昧真火」：灼烧跳得更狠（techniques.ts）
    if (e.burnAcc >= 1 || e.burnT <= 0) {
      const d = Math.floor(e.burnAcc);
      e.burnAcc -= d;
      if (d > 0) hitEnemy(w, e, { dmg: d, by: 'burn', owner: e.burnBy, from: e, el: 'fire', canCrit: false }, ev);
    }
    if (e.burnT <= 0) {
      e.burn = 0;
      e.burnAcc = 0;
    }
  }
  if (e.bleedT > 0 && e.hp > 0) {
    // 流血：每 BLEED.tick 秒跳一次字（不像灼烧那样一点一点跳，免得满屏数字）
    e.bleedT -= dt;
    e.bleedAcc = (e.bleedAcc ?? 0) + e.bleed * dt;
    e.bleedTick = (e.bleedTick ?? BLEED.tick) - dt;
    if (e.bleedTick <= 0 || e.bleedT <= 0) {
      e.bleedTick += BLEED.tick;
      const d = Math.floor(e.bleedAcc);
      e.bleedAcc -= d;
      if (d > 0) hitEnemy(w, e, { dmg: d, by: 'bleed', owner: e.bleedBy ?? 0, from: e, canCrit: false }, ev);
    }
    if (e.bleedT <= 0) {
      e.bleed = 0;
      e.bleedAcc = 0;
      e.bleedTick = 0;
    }
  }
  e.stun = Math.max(0, e.stun - dt);
  e.frozen = Math.max(0, e.frozen - dt);
  e.slowT = Math.max(0, e.slowT - dt);
  if (e.slowT <= 0) e.slow = 0;
  e.vulnT = Math.max(0, e.vulnT - dt);
  if (e.vulnT <= 0) e.vuln = 0; // 到时就清零（同减速）：写入的地方都取 max(旧值, 新值)，不清零的话之后更小的易伤会一直按旧的大值算
  e.invuln = Math.max(0, e.invuln - dt);
  if (e.wardT) e.wardT = Math.max(0, e.wardT - dt); // 落魂幡手的增益：幡手不续了就到时没了
  e.wrapT = Math.max(0, e.wrapT - dt);
  if (e.wrapT <= 0) e.wrapMax = 0;
  e.fireVulnT = Math.max(0, e.fireVulnT - dt);
  if (e.fireVulnT <= 0) e.fireVuln = 0;
  e.markT = Math.max(0, e.markT - dt);
  if (e.markT <= 0) e.mark = null;
  status2(w, e, dt, ev); // 再加的 11 件法宝：攒心钉的钉子到时掉了……（arti2.ts）
}

export type { WeaponKind };
