// 角色的被动天赋，和角色（神通、宠物）带给敌人的减益在伤害里怎么算。
// core.hitEnemy 每一下都要调到这里（暴击了没有、敌人身上的破甲 / 标记），所以这个文件只引 catalog 和类型，
// 不引别的模拟模块（core 引它，它再引回 core 就成了环，模块的初始化先后会出问题）。
// 被动按角色分派（PASSIVES）；减益是敌人身上的状态，谁打都吃（联机时队友打杨戬的狗咬过的敌人也更疼）。
// 赵公明的黑虎「震慑」也在这里：被吓住的敌人怎么走（world.step 的敌人循环）、打人打多重（接触伤害）、被打死时多掉什么（core.onKill）。
// 孙悟空的毫毛猴「戏弄」同理：被戏弄的敌人怎么走（world.step 的敌人循环）；「法天象地」期间站得稳（world.step 走路时）。
import { BINGXIN, FEAR, HUOYAN, JIEJIAO, LINGZHU, LONGLIN, RUSH, YEHUO, YUANLI, ZHAOCAI } from '../catalog.ts';
import { REACH } from '../config.ts';
import type { Element, Enemy, HeroId, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

interface Passive {
  /** 这个人物的一下暴击了（core.hitEnemy）。 */
  onCrit?(w: World, p: Player): void;
  /** 这一帧移速额外加多少（0 = 没有；world.step 走路时乘上）。 */
  speed?(w: World, p: Player): number;
  /** 这个人物打 e 的这一下多疼多少（乘在伤害上；core.hitEnemy）。 */
  hitMul?(w: World, p: Player, e: Enemy): number;
  /** 挨了一下（core.hurtPlayer，扣完血之后；dmg 是真扣掉的）。 */
  onHurt?(w: World, p: Player, dmg: number): void;
  /** 法宝的攻速额外加多少（0 = 没有；weapons.updateWeapons 加进攻速，总的上限照旧）。 */
  haste?(w: World, p: Player): number;
  /** 打死敌人攒的真气多加多少（0.25 = +25%；core.onKill 乘上，和修为「凝神」相加）。 */
  charge?: number;
  /** 拾到的灵石多加多少（0.15 = +15%；只加灵石、不加经验）。 */
  gem?: number;
  /** 地上的减速（第二章红水阵、红沙傀儡留下的红沙……）对他无效（world.step 走路时不乘地形、红沙的移速倍率）。 */
  ground?: boolean;
}

/** 精英或首领（孙悟空「火眼金睛」看得穿的那些）。 */
export const eliteOrBoss = (e: Enemy) => e.kind === 'elite' || e.kind === 'boss';

/** 被动（说明在 catalog.HEROES[hero].passive）。没有登记的角色没有被动。 */
const PASSIVES: Partial<Record<HeroId, Passive>> = {
  // 哪吒「灵珠子」：打死敌人攒的真气 +LINGZHU.charge（三头六臂放得更勤）
  nezha: { charge: LINGZHU.charge },
  // 杨戬「乘隙」：暴击之后 RUSH.t 秒内移速 +RUSH.speed（再暴击就续上，不叠加）
  yangjian: {
    onCrit: (w, p) => void (p.rushUntil = w.time + RUSH.t),
    speed: (w, p) => (p.rushUntil !== undefined && w.time < p.rushUntil ? RUSH.speed : 0),
  },
  // 赵公明「招财」：拾到的灵石 +15%（world.credit 乘在灵石上；经验照旧）
  zhao: { gem: ZHAOCAI.gem },
  // 云霄「冰心」：冻住的敌人受到她的伤害 +BINGXIN（谁冻的都算；和水行三件的「寒彻」各乘各的）
  yunxiao: { hitMul: (_w, _p, e) => (e.frozen > 0 ? 1 + BINGXIN : 1) },
  // 雷震子「生翅」：背生双翅，地上的减速对他无效（魔气不算地上的：那是仙台外的边界）
  leizhenzi: { ground: true },
  // 魔化哪吒「业火」：气血越低伤害越高（满血 ×1，气血 YEHUO.full 以下 ×(1 + YEHUO.max)，中间按少了多少线性加）
  mozha: { hitMul: (_w, p) => 1 + yehuoBonus(p) },
  // 回响赵公明「怨力」：挨打攒怨（满了在 heroes/huizhao.ts 的 updateHuizhao 里震出一圈）
  huizhao: { onHurt: (_w, p, dmg) => void (p.grudge = Math.min(1, (p.grudge ?? 0) + dmg / YUANLI.full)) },
  // 回响云霄「截教」：身边被定住、冻住、晕住的敌人越多，法宝出手越快
  huiyun: { haste: (w, p) => jiejiao(w, p) },
  // 回响敖丙「龙鳞」：气血越满伤害越高；神通「化龙」的那几秒游得快（这个文件不能引 heroes/huiao.ts，快多少写在下面的 LONGLIN_SPEED）
  huiao: { hitMul: (_w, p) => 1 + longlinBonus(p), speed: (_w, p) => (p.hualong ? LONGLIN_SPEED : 0) },
  // 孙悟空「火眼金睛」：打精英、首领 +HUOYAN.elite（谁的法宝、神通打的都算，只要是他打的）
  wukong: { hitMul: (_w, _p, e) => (eliteOrBoss(e) ? 1 + HUOYAN.elite : 1) },
};

/** 回响敖丙化成白龙时游得快多少（神通「化龙」；heroes/huiao.ts 的 HUALONG.speed 就是它）。 */
export const LONGLIN_SPEED = 0.85;
/** 回响敖丙「龙鳞」这一刻加多少伤害（0..LONGLIN.max；表现层画鳞光也用它）。 */
export function longlinBonus(p: Player): number {
  const k = Math.max(0, p.hp) / Math.max(1, p.stats.maxHp);
  return LONGLIN.max * Math.max(0, Math.min(1, (k - LONGLIN.none) / (LONGLIN.full - LONGLIN.none)));
}

/** 魔化哪吒「业火」这一刻加多少伤害（0..YEHUO.max；表现层画身上的黑焰也用它）。 */
export function yehuoBonus(p: Player): number {
  const lost = 1 - Math.max(0, p.hp) / Math.max(1, p.stats.maxHp);
  return YEHUO.max * Math.max(0, Math.min(1, lost / (1 - YEHUO.full)));
}

/** 回响云霄「截教」：身边（REACH.max 以内）被定住、冻住、晕住的敌人有几只 → 攻速加成（每只 JIEJIAO.per，最多 JIEJIAO.cap）。表现层也读它。 */
export function jiejiao(w: World, p: Player): number {
  let n = 0;
  const R2 = REACH.max * REACH.max;
  for (const e of w.enemies) if (e.hp > 0 && (e.stun > 0 || e.frozen > 0) && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= R2) n++;
  return Math.min(JIEJIAO.cap, n * JIEJIAO.per);
}

/** 被动给的法宝攻速加成（0 = 没有）。 */
export function heroHaste(w: World, p: Player): number {
  return PASSIVES[p.hero]?.haste?.(w, p) ?? 0;
}

/** 挨了一下：交给这个角色的被动（回响赵公明「怨力」攒怨；没有就什么都不做）。 */
export function heroHurt(w: World, p: Player, dmg: number) {
  PASSIVES[p.hero]?.onHurt?.(w, p, dmg);
}

/** 暴击了：交给这个角色的被动。 */
export function heroCrit(w: World, p: Player) {
  PASSIVES[p.hero]?.onCrit?.(w, p);
}

/** 被动给的移速加成（0 = 没有）。 */
export function heroSpeed(w: World, p: Player): number {
  return PASSIVES[p.hero]?.speed?.(w, p) ?? 0;
}

/** 被动让这一下多疼多少（没有就是 1；云霄「冰心」打冻住的更疼、魔化哪吒「业火」越残越狠）。没有这条被动的角色正好是 1，乘上去一点不变。 */
export function heroHitMul(w: World, p: Player | undefined, e: Enemy): number {
  return p ? (PASSIVES[p.hero]?.hitMul?.(w, p, e) ?? 1) : 1;
}

/** 地上的减速对这个人物无效（雷震子「生翅」）。 */
export const groundFree = (p: Player) => !!PASSIVES[p.hero]?.ground;
/** 打死敌人攒真气的额外倍率（哪吒「灵珠子」；没有就是 0）。 */
export const heroCharge = (p: Player) => PASSIVES[p.hero]?.charge ?? 0;

/** 拾到灵石的倍数（赵公明「招财」1.15；别的角色正好是 1，乘上去一点不变）。 */
export function heroGemMul(p: Player): number {
  return 1 + (PASSIVES[p.hero]?.gem ?? 0);
}

// ---------------------------------------------------------------- 黑虎「震慑」（pets/heihu.ts 吼出来；这里管被吓住之后）

/** 被黑虎震慑住了没有（首领不会被吓住，黑虎也不吓它）。 */
export const feared = (w: World, e: Enemy) => e.fearUntil !== undefined && w.time < e.fearUntil;

/** 被震慑的敌人这一帧往哪逃（像素 / 秒）：沿吓住时定下的方向（背着吼声、背着人物）跑，比平常快一点，减速照样吃。 */
export function fleeVel(e: Enemy): [number, number] {
  const s = e.speed * (1 - e.slow) * FEAR.run;
  return [(e.fearDx ?? 0) * s, (e.fearDy ?? 0) * s];
}

/** 打人的伤害倍数：被震慑期间 ×(1 − fear)，没被吓住就是 1。 */
export const fearDmgMul = (w: World, e: Enemy) => (feared(w, e) ? 1 - (e.fear ?? 0) : 1) * (e.weakUntil !== undefined && w.time < e.weakUntil ? 1 - (e.weak ?? 0) : 1); // 回响云霄「黄河阵 · 削顶」削去三花的也打人变轻

/**
 * 敌人被打死（core.onKill）：黑虎「破财」—— 被震慑期间被打死的，按 broke 的几率多掉一颗灵石（掉在尸首旁边，照常去捡）。
 * 没走这条路的（没有 broke）一点随机数都不动。
 */
export function foeKilled(w: World, e: Enemy, ev: SimEvent[]) {
  if (!e.broke || !feared(w, e) || w.rng.next() >= e.broke) return;
  const a = w.rng.next() * Math.PI * 2;
  const id = w.nextId++;
  w.gems.push({ id, x: e.x, y: e.y, px: e.x, py: e.y, vx: Math.cos(a) * 55, vy: Math.sin(a) * 55, value: 1, pulled: -1 });
  ev.push({ t: 'broke', id: e.id, gem: id, x: e.x, y: e.y });
}
/** 哮天犬「破甲」还在不在（在的时候盾卫的盾也挡不住，见 core.hitEnemy）。 */
export const sundered = (w: World, e: Enemy) => e.sunderUntil !== undefined && w.time < e.sunderUntil;

// ---------------------------------------------------------------- 毫毛猴「戏弄」（pets/maohou.ts 戏弄上、管出手变慢；这里管被戏弄之后怎么走）

/** 被毫毛猴的小猴戏弄着没有（首领不吃戏弄）。 */
export const teased = (w: World, e: Enemy) => e.teaseUntil !== undefined && w.time < e.teaseUntil;

/**
 * 被戏弄的敌人这一帧怎么走（world.step 的敌人循环，算完原来想走的速度之后调）：速度只剩 teaseWalk 倍，方向左右乱摆
 * （两个频率叠起来，最多偏出去八十多度；相位按敌人 id 错开，一群被戏弄的不会整齐地一起摆），像被小猴逗得东张西望、脚下拌蒜。
 * 正在出招的（冲锋、突刺、点着引信）不动它：那一下的路线和预警对得上。只用 w.time 和 id，不动随机数。
 */
export function teaseVel(w: World, e: Enemy, vx: number, vy: number): [number, number] {
  if (e.act === 'strike' || e.act === 'fuse') return [vx, vy];
  const k = e.teaseWalk ?? 1;
  const ph = e.id * 1.37;
  const a = Math.sin(w.time * 5.3 + ph) * 0.9 + Math.sin(w.time * 2.1 + ph * 2.3) * 0.6;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [(vx * c - vy * s) * k, (vx * s + vy * c) * k];
}

/** 孙悟空「法天象地」还在不在（这一波放的、还没到点；heroes/wukong.ts 和下面的 heroSteady 都问它）。 */
export const faxiangOn = (w: World, p: Player) => p.faxiang !== undefined && p.faxiang.wave === w.wave && w.time < p.faxiang.until;

/** 孙悟空「法天象地」期间站得稳：不吃风吼妖的吹开（world.step 走路时问；别的角色一直是 false）。 */
export const heroSteady = (w: World, p: Player) => faxiangOn(w, p);

/**
 * 敌人身上这些减益让这一下多疼多少（乘在伤害上；没有就是 1）：哮天犬「破甲」+sunder，「金牙」破甲期间金行再 +fang；
 * 杨戬「天眼」的标记 +gaze；云霄的混元金斗仙品起「削去顶上三花」+sanhua，青鸾「沧溟」水行再 +deep；雷鹏「霹雳」木行再 +clap。el 是这一下的五行。
 */
export function debuffMul(w: World, e: Enemy, el: Element | undefined): number {
  let m = 1;
  if (sundered(w, e)) {
    m *= 1 + (e.sunder ?? 0);
    if (e.fang && el === 'metal') m *= 1 + e.fang;
  }
  if (e.gazeUntil !== undefined && w.time < e.gazeUntil) m *= 1 + (e.gaze ?? 0);
  if (e.sanhuaUntil !== undefined && w.time < e.sanhuaUntil) m *= 1 + (e.sanhua ?? 0);
  if (el === 'water' && e.deepUntil !== undefined && w.time < e.deepUntil) m *= 1 + (e.deep ?? 0);
  if (el === 'wood' && e.clapUntil !== undefined && w.time < e.clapUntil) m *= 1 + (e.clap ?? 0);
  return m;
}

/** 「金牙」：破甲期间被暴击的几率提高（fang 的一半）。没有就是 0。 */
export const debuffCrit = (w: World, e: Enemy) => (e.fang && sundered(w, e) ? e.fang / 2 : 0);
