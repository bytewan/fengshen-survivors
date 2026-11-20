// 灵物、符箓、丹药的机制（M3 新加的那批；暂拟，待评审确认）。数值在 catalog.RELIC / CHARM / ELIXIR，给玩家看的说明在
// catalog.RELICS / CHARMS / ELIXIRS（从数值表里取数）。只加属性的灵物在买下时一次性加到 Stats 上（RELICS.apply），这里不管；
// 这里是「有自己机制」的那些，按时机挂钩（别的文件里只留一行调用，函数名都以 relic 开头）：
//   core.ts  hitEnemy：relicHitMul（这一下的伤害倍数：照妖镜、逆鳞、定颜珠、夔牛鼓）、relicAfterHit（结算完：暴击引雷、相生炸开）；
//            onKill：relicKill（燃魂香多攒真气、招宝符数击杀）；
//            hurtPlayer：relicBlock（混元伞挡鬼火）、relicHurt（真扣了血之后：金刚琢印、定身符、遁地符、神行符、冰心玉壶记下「被打中过」）；
//   world.ts 每波开始 relicWaveStart（丹药的临时属性、凝神丹、乾坤袋、噬心蛊、夔牛鼓、计时清零）、波末 relicWaveEnd（减回临时属性、冰心玉壶）、
//            每帧 updateRelics（风火蒲团、照妖镜、夔牛鼓、引雷符、各种计时）、放神通 relicSkill（燃魂香、回灵符）、
//            捡到灵石 relicPickup（踏云履）、移动 relicSpeed（踏云履、遁地符、神行符）、魔气 relicMiasma（桃木簪）；
//   shop.ts  买丹药时调 ELIXIRS[id].drink。
// 纯函数，随机数只用 w.rng；运行时状态放在 Player.relic（RelicState）和 Enemy.revealUntil / reveal / dyT 里，都是纯数据（整局快照照存）。
// 灵物带几件就按几件算（p.relics[id]）；多带一件怎么变写在 catalog.RELICS 的 stack 里。符箓每种只能带一张。
import { ARENA, DROPS, REACH, SKILL } from './config.ts';
import { CHARM, RELIC, priceScale, waveScale } from './catalog.ts';
import { hitEnemy, inReach, nearestEnemy, type DamageSpec } from './core.ts';
import type { CharmId, Drop, Enemy, HitBy, HurtBy, Player, ReactionKind, RelicState, SimEvent } from './types.ts';
import type { World } from './world.ts';

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const hasCharm = (p: Player, id: CharmId) => p.charms.includes(id);
/** 这张符这一波还能用（带着、还没用过）。 */
const charmReady = (p: Player, id: CharmId) => p.charms.includes(id) && !p.charmUsed[id];
/** (x, y) 半径 r 内的活敌人：直接扫一遍（不用空间网格，免得改了别人正在用的网格；敌人最多两百来只）。 */
function within(w: World, x: number, y: number, r: number): Enemy[] {
  const out: Enemy[] = [];
  for (const e of w.enemies) if (e.hp > 0 && (e.x - x) ** 2 + (e.y - y) ** 2 <= r * r) out.push(e);
  return out;
}
/** 灵物、符箓自己打出的伤害：按波次和敌人的血量一起涨（同功法），再吃伤害加成和这一行的亲和、狂血丹。 */
const power = (w: World, p: Player, el: 'wood' | 'earth') => waveScale(w.wave).hp * (1 + p.stats.damage + p.stats.aff[el] + p.buffs.rage * 0.3);

/** 有没有要记运行时状态的道具（没有的人一直不建 Player.relic）。 */
function needsState(p: Player) {
  const r = p.relics;
  return !!(r.zhuo || r.mirror || r.umbrella || r.cloudshoe || r.icevase || r.drum || p.charms.some((c) => c !== 'tishen' && c !== 'huxin'));
}

/** 运行时状态（第一次用到时建）。只在模拟里调：表现层直接读 p.relic，没有就当「什么都没在发生」。 */
export function relicState(p: Player): RelicState {
  return (p.relic ??= { mirror: RELIC.mirror.first, umbrella: 0, zhuo: 0, cloud: 0, hurt: false, drum: 0, kills: 0, dun: 0, run: 0, runs: 0, temp: { dodge: 0, armor: 0, crit: 0 } });
}

// ---------------------------------------------------------------- 挂钩：core.hitEnemy

/** 不算「直接打中」的伤害：持续伤害、爆炸、相生的额外伤害、灵物自己打出的。它们暴击不了，也不该再引雷。 */
const INDIRECT: ReadonlySet<HitBy> = new Set<HitBy>(['burn', 'bleed', 'zone', 'react', 'explode', 'relic']);

/**
 * core.hitEnemy：算完暴击和功法之后、结算之前调一次，返回这一下的伤害倍数。
 * 照妖镜（被照出原形的敌人受伤加深 —— 谁打都算）、逆鳞（低血时）、定颜珠（打定住的）、夔牛鼓（鼓劲 / 鼓歇）。
 */
export function relicHitMul(w: World, p: Player | undefined, e: Enemy, ev: SimEvent[]): number {
  let m = e.revealUntil !== undefined && w.time < e.revealUntil ? 1 + (e.reveal ?? 0) : 1;
  if (!p) return m;
  const r = p.relics;
  if (r.scale && p.hp < p.stats.maxHp * RELIC.scale.hp) m *= 1 + RELIC.scale.damage * r.scale;
  if (r.dingyan && e.stun > 0) {
    m *= 1 + RELIC.dingyan.damage * r.dingyan;
    if (e.dyT === undefined || w.time - e.dyT >= RELIC.dingyan.report) {
      e.dyT = w.time;
      ev.push({ t: 'relic', kind: 'dingyan', owner: p.id, x: e.x, y: e.y, id: e.id });
    }
  }
  if (r.drum) m *= drumMul(p);
  return m;
}

/** 夔牛鼓此刻的伤害倍数：一通鼓的前 beat 秒鼓劲，其余时间鼓歇。 */
export function drumMul(p: Player): number {
  const n = p.relics.drum ?? 0;
  if (!n) return 1;
  const D = RELIC.drum;
  return (p.relic?.drum ?? 0) < D.beat ? 1 + D.up * n : 1 - D.down;
}

/**
 * core.hitEnemy 的最后（击杀、相生都结算完之后）：dmg 是这一下实际打出的伤害。
 * 风雷羽：直接打中的暴击有几率引一道小雷，劈中那只身边的另一只；九龙玉佩：触发了相生就在那只身边炸开一小圈。
 */
export function relicAfterHit(w: World, p: Player | undefined, e: Enemy, s: DamageSpec, dmg: number, crit: boolean, react: ReactionKind | null, ev: SimEvent[]) {
  if (!p) return;
  const r = p.relics;
  if (crit && r.stormfeather && !INDIRECT.has(s.by)) {
    const F = RELIC.stormfeather;
    if (w.rng.next() < Math.min(F.cap, F.chance * r.stormfeather)) stormBolt(w, p, e, dmg * F.mul, ev);
  }
  if (react && r.jadedragon) dragonBreath(w, p, e, react, dmg * RELIC.jadedragon.mul * r.jadedragon, s, ev);
}

/** 风雷羽的小雷：劈那只身边最近的另一只（离人物 REACH.max 以内）；身边没有别的就再劈它一下。不暴击、不打印记。 */
function stormBolt(w: World, p: Player, e: Enemy, dmg: number, ev: SimEvent[]) {
  const F = RELIC.stormfeather;
  const t = nearestEnemy(w, e.x, e.y, F.r, new Set([e.id]), inReach(p)) ?? (e.hp > 0 ? e : null);
  if (!t) return;
  ev.push({ t: 'relic', kind: 'stormfeather', owner: p.id, x: t.x, y: t.y, id: t.id, pts: [[e.x, e.y], [t.x, t.y]] });
  hitEnemy(w, t, { dmg, by: 'relic', owner: p.id, from: { x: t.x, y: t.y - 40 }, el: 'wood', canCrit: false, noMark: true, stun: F.stun }, ev);
}

/** 九龙玉佩：在触发相生的那只身边炸开（连它自己），伤害跟着那一下的五行走（火行的吃火绫「引火」）。 */
function dragonBreath(w: World, p: Player, e: Enemy, react: ReactionKind, dmg: number, s: DamageSpec, ev: SimEvent[]) {
  const r = RELIC.jadedragon.r * (1 + p.stats.area * 0.5);
  const near = within(w, e.x, e.y, r);
  ev.push({ t: 'relic', kind: 'jadedragon', owner: p.id, x: e.x, y: e.y, id: e.id, r, react });
  for (const o of near) hitEnemy(w, o, { dmg, by: 'relic', owner: p.id, from: e, kb: 40, el: s.el, canCrit: false, noMark: true }, ev);
}

// ---------------------------------------------------------------- 挂钩：core.onKill

/** core.onKill（击杀者 p）：燃魂香多攒真气；招宝符数这一波的击杀。 */
export function relicKill(w: World, p: Player, e: Enemy, ev: SimEvent[]) {
  const k = p.relics.incense;
  if (k) {
    const c = e.kind === 'elite' || e.kind === 'boss' ? SKILL.chargePerElite : SKILL.chargePerKill;
    p.skill = Math.min(1, p.skill + c * RELIC.incense.charge * k);
  }
  if (charmReady(p, 'zhaobao')) {
    const st = relicState(p);
    st.kills++;
    if (st.kills >= CHARM.zhaobao.kills) {
      p.charmUsed.zhaobao = true;
      dropChest(w, p, e, ev);
    }
  }
}

/** 招宝符：在那只敌人倒下的地方掉一个乾坤宝匣（和战场掉落同一种，掉在仙台上）。 */
function dropChest(w: World, p: Player, e: Enemy, ev: SimEvent[]) {
  const pad = ARENA.pad + 10;
  const x = Math.max(pad, Math.min(ARENA.w - pad, e.x));
  const y = Math.max(pad, Math.min(ARENA.h - pad, e.y));
  const d: Drop = { id: w.nextId++, kind: 'chest', x, y, px: x, py: y, t: 0, life: DROPS.life };
  w.drops.push(d);
  ev.push({ t: 'drop', id: d.id, kind: 'chest', x, y });
  ev.push({ t: 'relic', kind: 'zhaobao', owner: p.id, x, y, id: d.id });
}

// ---------------------------------------------------------------- 挂钩：core.hurtPlayer

/** core.hurtPlayer（闪避之后、护心符之前）：混元伞残片挡下一枚鬼火。挡下了返回 true（这一下不算数）。 */
export function relicBlock(w: World, p: Player, by: HurtBy, ev: SimEvent[]): boolean {
  const k = p.relics.umbrella;
  if (!k || by !== 'orb') return false;
  const st = relicState(p);
  if (st.umbrella > 0) return false;
  const U = RELIC.umbrella;
  st.umbrella = Math.max(U.cdMin, U.cd - U.cdPer * (k - 1));
  ev.push({ t: 'relic', kind: 'umbrella', owner: p.id, x: p.x, y: p.y });
  void w;
  return true;
}

/**
 * core.hurtPlayer：真扣了血之后（替身符、功法之后）调一次。raw 是护体减免之前的伤害。
 * 记下「这一波被打中过」（冰心玉壶）；还活着的话：金刚琢印（每波前几次）、定身符（跌破一半）、遁地符（跌破三成）、神行符。
 */
export function relicHurt(w: World, p: Player, raw: number, ev: SimEvent[]) {
  if (!p.relic && !needsState(p)) return;
  const st = relicState(p);
  st.hurt = true;
  if (p.hp <= 0) return;
  const z = p.relics.zhuo ?? 0;
  if (st.zhuo < z) {
    st.zhuo++;
    slam(w, p, raw, ev);
  }
  const max = p.stats.maxHp;
  if (charmReady(p, 'dingshen') && p.hp < max * CHARM.dingshen.hp) {
    p.charmUsed.dingshen = true;
    const D = CHARM.dingshen;
    const r = D.r * (1 + p.stats.area * 0.5);
    const near = within(w, p.x, p.y, r).filter((e) => e.kind !== 'boss' && e.invuln <= 0);
    for (const e of near) e.stun = Math.max(e.stun, D.t);
    ev.push({ t: 'relic', kind: 'dingshen', owner: p.id, x: p.x, y: p.y, r, t2: D.t, ids: near.map((e) => e.id) });
  }
  if (charmReady(p, 'dundi') && p.hp < max * CHARM.dundi.hp) {
    p.charmUsed.dundi = true;
    st.dun = CHARM.dundi.t;
    p.iframes = Math.max(p.iframes, CHARM.dundi.t);
    ev.push({ t: 'relic', kind: 'dundi', owner: p.id, x: p.x, y: p.y, t2: CHARM.dundi.t });
  }
  if (hasCharm(p, 'shenxing') && st.runs < CHARM.shenxing.n) {
    st.runs++;
    st.run = CHARM.shenxing.t;
    ev.push({ t: 'relic', kind: 'shenxing', owner: p.id, x: p.x, y: p.y, t2: CHARM.shenxing.t });
  }
}

/**
 * 金刚琢印：把这一下（护体减免之前）的几倍砸向身边的敌人（土行，震退、晕一下）。
 * 身边没有敌人（被远处的鬼火打中）就砸最近的一只（离人物 REACH.seek 以内）。
 */
function slam(w: World, p: Player, raw: number, ev: SimEvent[]) {
  const Z = RELIC.zhuo;
  const r = Z.r * (1 + p.stats.area * 0.5);
  let near = within(w, p.x, p.y - 4, r);
  let far = false;
  if (!near.length) {
    const o = nearestEnemy(w, p.x, p.y, REACH.seek);
    if (o) near = [o];
    far = true;
  }
  const dmg = raw * Z.mul * (1 + p.stats.damage + p.stats.aff.earth + p.buffs.rage * 0.3);
  ev.push({ t: 'relic', kind: 'zhuo', owner: p.id, x: p.x, y: p.y, r: far ? 0 : r, ids: near.map((e) => e.id), pts: near.map((e) => [e.x, e.y] as [number, number]) });
  for (const e of near) hitEnemy(w, e, { dmg, by: 'relic', owner: p.id, from: p, kb: Z.kb, el: 'earth', stun: Z.stun, noMark: true }, ev);
}

// ---------------------------------------------------------------- 挂钩：world.ts

/**
 * world.startWave（每个人物，功法之后）：丹药的临时属性加进来、凝神丹；有机制的道具计时清零；
 * 乾坤袋生灵石、噬心蛊噬血、夔牛鼓擂第一通。
 */
export function relicWaveStart(w: World, p: Player, ev: SimEvent[]) {
  const b = p.buffs;
  if (b.dodge || b.armor || b.crit) {
    const st = relicState(p);
    st.temp = { dodge: b.dodge ?? 0, armor: b.armor ?? 0, crit: b.crit ?? 0 };
    p.stats.dodge += st.temp.dodge;
    p.stats.armor += st.temp.armor;
    p.stats.crit += st.temp.crit;
  }
  if (b.calm && p.alive) {
    p.skill = 1;
    ev.push({ t: 'relic', kind: 'ningshen', owner: p.id, x: p.x, y: p.y });
  }
  const r = p.relics;
  if (p.relic || needsState(p)) {
    const st = relicState(p);
    Object.assign(st, { mirror: RELIC.mirror.first, umbrella: 0, zhuo: 0, cloud: 0, hurt: false, drum: 0, kills: 0, dun: 0, run: 0, runs: 0 });
  }
  if (r.pouch) {
    const P = RELIC.pouch;
    const v = Math.min(P.max * r.pouch, Math.floor(p.lingshi / P.per) * r.pouch);
    if (v > 0) {
      p.lingshi += v;
      ev.push({ t: 'relic', kind: 'pouch', owner: p.id, x: p.x, y: p.y, v });
    }
  }
  if (r.gu && p.alive) {
    // 噬去的是「当前」气血的一份（多带一件再噬一次：0.8 × 0.8……）：代价看得见，但不会一波一波越扣越深、把人耗死
    const v = Math.min(p.hp - 1, Math.round(p.hp * (1 - (1 - RELIC.gu.drain) ** r.gu)));
    if (v > 0) {
      p.hp -= v;
      ev.push({ t: 'relic', kind: 'gu', owner: p.id, x: p.x, y: p.y, v });
    }
  }
  if (r.drum && p.alive) ev.push({ t: 'relic', kind: 'drum', owner: p.id, x: p.x, y: p.y, t2: RELIC.drum.beat });
}

/** world.endWave（清场之前）：丹药临时加的属性减回去；冰心玉壶 —— 这一波没被打中过的多得灵石；加速类的计时清掉。 */
export function relicWaveEnd(w: World, ev: SimEvent[]) {
  const tidy = (v: number) => Math.round(v * 1e9) / 1e9; // 加了又减回去的小数（0.03 + 0.2 − 0.2）抹掉末位的误差
  for (const p of w.players) {
    const st = p.relic;
    if (!st) continue;
    const t = st.temp;
    if (t.dodge || t.armor || t.crit) {
      p.stats.dodge = tidy(p.stats.dodge - t.dodge);
      p.stats.armor = tidy(p.stats.armor - t.armor);
      p.stats.crit = tidy(p.stats.crit - t.crit);
      st.temp = { dodge: 0, armor: 0, crit: 0 };
    }
    const k = p.relics.icevase ?? 0;
    if (k && !st.hurt && p.alive && !p.left && !p.out) {
      const v = Math.round(RELIC.icevase.lingshi * k * priceScale(w.wave));
      p.lingshi += v;
      ev.push({ t: 'relic', kind: 'icevase', owner: p.id, x: p.x, y: p.y, v });
    }
    st.cloud = 0;
    st.dun = 0;
    st.run = 0;
  }
}

/** world.step 每帧（活着的人物，法宝、宠物、功法之后）：计时；风火蒲团入定回血；照妖镜；夔牛鼓；引雷符看有没有被围住。 */
export function updateRelics(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const st = p.relic;
  if (st) {
    st.umbrella = Math.max(0, st.umbrella - dt);
    st.cloud = Math.max(0, st.cloud - dt);
    st.dun = Math.max(0, st.dun - dt);
    st.run = Math.max(0, st.run - dt);
  }
  const r = p.relics;
  if (r.cushion && p.still >= RELIC.cushion.still) p.hp = Math.min(p.stats.maxHp, p.hp + RELIC.cushion.regen * r.cushion * dt);
  if (r.mirror) updateMirror(w, p, r.mirror, dt, ev);
  if (r.drum) {
    const s = relicState(p);
    const D = RELIC.drum;
    s.drum += dt;
    if (s.drum >= D.every) {
      s.drum -= D.every;
      ev.push({ t: 'relic', kind: 'drum', owner: p.id, x: p.x, y: p.y, t2: D.beat });
    }
  }
  if (charmReady(p, 'yinlei')) checkSurrounded(w, p, ev);
}

/** 照妖镜碎片：隔一会儿照出附近血最厚的一只（首领战里多半是首领），它一段时间内受到的伤害加深。附近没有就过一会儿再照。 */
function updateMirror(w: World, p: Player, n: number, dt: number, ev: SimEvent[]) {
  const M = RELIC.mirror;
  const st = relicState(p);
  st.mirror -= dt;
  if (st.mirror > 0) return;
  let best: Enemy | null = null;
  for (const e of w.enemies) if (e.hp > 0 && e.invuln <= 0 && d2(e, p) <= M.seek * M.seek && (!best || e.hp > best.hp)) best = e;
  if (!best) {
    st.mirror = 0.5;
    return;
  }
  st.mirror = M.every;
  const v = M.vuln * n;
  const on = best.revealUntil !== undefined && w.time < best.revealUntil;
  best.reveal = on ? Math.max(best.reveal ?? 0, v) : v;
  best.revealUntil = Math.max(on ? best.revealUntil! : 0, w.time + M.t);
  ev.push({ t: 'relic', kind: 'mirror', owner: p.id, x: best.x, y: best.y, id: best.id, t2: M.t, pts: [[p.x, p.y]] });
}

/** 引雷符：身边挤了够多的敌人（被围住），一道天雷落在自己身上、劈开身边一圈（不伤自己）。 */
function checkSurrounded(w: World, p: Player, ev: SimEvent[]) {
  const Y = CHARM.yinlei;
  let k = 0;
  for (const e of w.enemies) if (e.hp > 0 && d2(e, p) <= Y.near * Y.near && ++k >= Y.count) break;
  if (k < Y.count) return;
  p.charmUsed.yinlei = true;
  const r = Y.r * (1 + p.stats.area * 0.5);
  const near = within(w, p.x, p.y, r);
  const dmg = Y.dmg * power(w, p, 'wood');
  ev.push({ t: 'relic', kind: 'yinlei', owner: p.id, x: p.x, y: p.y, r, ids: near.map((e) => e.id) });
  for (const e of near) hitEnemy(w, e, { dmg, by: 'relic', owner: p.id, from: p, kb: Y.kb, el: 'wood', stun: Y.stun, noMark: true, canCrit: false }, ev);
}

/** world.step 放神通（真气清零之后）：燃魂香燃血；回灵符回一半真气。 */
export function relicSkill(w: World, p: Player, ev: SimEvent[]) {
  if (p.relics.incense) {
    const v = Math.min(p.hp - 1, Math.round(p.hp * RELIC.incense.cost)); // 燃去「当前」气血的一份（同噬心蛊）
    if (v > 0) {
      p.hp -= v;
      ev.push({ t: 'relic', kind: 'incense', owner: p.id, x: p.x, y: p.y, v });
    }
  }
  if (charmReady(p, 'huiling')) {
    p.charmUsed.huiling = true;
    p.skill = Math.max(p.skill, CHARM.huiling.back);
    ev.push({ t: 'relic', kind: 'huiling', owner: p.id, x: p.x, y: p.y, v: p.skill });
  }
  void w;
}

/** world.collectGems（战斗中捡到一颗灵石；波末收灵不算）：踏云履起步。 */
export function relicPickup(w: World, p: Player, ev: SimEvent[]) {
  if (!p.relics.cloudshoe) return;
  const st = relicState(p);
  if (st.cloud <= 0) ev.push({ t: 'relic', kind: 'cloudshoe', owner: p.id, x: p.x, y: p.y });
  st.cloud = RELIC.cloudshoe.t;
  void w;
}

/** world.step 移动：移速加成（踏云履、遁地符、神行符；和属性里的移速相加）。 */
export function relicSpeed(p: Player): number {
  const st = p.relic;
  if (!st) return 0;
  let v = 0;
  if (st.cloud > 0) v += RELIC.cloudshoe.speed * (p.relics.cloudshoe ?? 0);
  if (st.dun > 0) v += CHARM.dundi.speed;
  if (st.run > 0) v += CHARM.shenxing.speed;
  return v;
}

/** world.step 魔气：减速和侵蚀的倍数（桃木簪每件减半）。 */
export const relicMiasma = (p: Player) => (p.relics.hairpin ? RELIC.hairpin.mul ** p.relics.hairpin : 1);
