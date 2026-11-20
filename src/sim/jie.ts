// 劫数（难度，M3 · docs/design.md「劫与修为」）：劫一到劫五，每高一档在前一档上再叠一条词缀；劫一就是原来的难度。
// 一局的劫数开局时定下（createWorld 的 RunSetup.jie，存在 w.jie，整局存档照存）；联机时房主开房时选，所有人同一档。
// 整局通关（第三章首领打赢）一档解锁下一档（game/profile.ts 记）；奖励随劫数涨：灵石在这里，道行的算法在 xiuwei.ts。
//
// 写法照 coop.ts：别的文件只在下面几处调这里。劫一时每个函数都不改状态、不碰随机数、不多发事件，倍率恰好是 1 ——
// 所以劫一的 tools/balance.ts 结果和加劫数之前逐字一样（改完对比过，见 scratch/PROGRESS.md）。
//   world.spawnAt    jieSpawn：刷出来的敌人加气血、移速
//   world.startWave  jieBossStart：首领上场之后气血也加
//   world.step       jieElites：这一波多刷几只精英；fasterOrb：鬼火飞得快；jieTick：首领三阶段狂暴
//   world.gainGem    jieLingshi：灵石的倍率
//   core.hurtPlayer  jieBossDmg：首领打人更疼
//   enemies.ts       jieShot：骑兵、风吼妖冲得快；boss.ts  jieInferno：魔焰焚城推进更勤
// 数值 ★（暂拟，待评审确认；用户口径：数值放到最后统一调）都在 JIE 里。
// 精英的词缀（原来是劫五的一条：迅捷 / 坚韧 / 分裂）2026-11-11 起归精英那一摊（sim/elites/affixes.ts）：每只精英一条（第一章劫一不带），
// 劫五两条；elites/index.ts 的 affixCount 读 w.jie。
import { DT } from './config.ts';
import type { Enemy, Orb } from './types.ts';
import type { World } from './world.ts';

export const JIE_MAX = 5;

export const JIE = {
  hp: 0.15, // 劫二起：敌人（含首领）气血 +15%（2026-11-11 数值平衡 0.25 → 0.15：劫一的敌人已经 ×1.6，再 +25% 机器人劫二只通 11/20，比劫三、劫五还难）
  elites: 1, // 劫三起：每个普通波多来几只精英（每章第 4 波原来那一两只之外再多一只；别的普通波原来没有精英，来一只）
  speed: 0.08, // 劫三起：敌人移速 +8%（首领的走位归首领模块管，不算）
  shot: 0.25, // 劫四起：鬼火飞得快、骑兵 / 风吼妖冲得快 +25%（预警的时长不变）
  inferno: 0.75, // 劫四起：魔焰焚城（第一章首领的三阶段）每一步推进的间隔 ×0.75（6 秒 → 4.5 秒）
  bossDmg: 0.2, // 劫四起：首领（招式、接触、召出来的草人）的伤害 +20%
  rage: 1.6, // 劫五：首领进了三阶段就狂暴——两招之间的空闲、收招过得快 1.6 倍（招式本身的预警不变，照样看得清、躲得开）
  // 用户 2026-11-12：「难度升级，打怪拿到的钱和经验应该减少，只有能拿到的修为会增加」（原来每高一劫灵石 +5%、经验不变、道行 +25%）
  lingshi: -0.05, // 每高一劫，捡到的灵石 −5%（劫五 −20%）
  xp: -0.05, // 每高一劫，捡到的经验 −5%（劫五 −20%）
  dao: 0.3, // 每高一劫，这一局的道行 ×(1 + 30%)（xiuwei.daoReward）
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 每一劫：名字、称号、它新叠上的词缀（选劫页、大厅、结算面板都读这张表）。 */
export const JIE_TIERS: readonly { n: number; name: string; title: string; adds: readonly string[] }[] = [
  { n: 1, name: '劫一', title: '尘劫', adds: ['本来的难度'] },
  { n: 2, name: '劫二', title: '血劫', adds: ['敌人与首领血气更厚', '首章精英亦带词缀，东海夜叉现身'] },
  { n: 3, name: '劫三', title: '兵劫', adds: ['每个普通波多来一只精英', '敌人来势更疾'] },
  { n: 4, name: '劫四', title: '煞劫', adds: ['鬼火与冲锋更快', '魔焰焚城推进更急', '首领出手更重'] },
  { n: 5, name: '劫五', title: '魔劫', adds: ['首领末阶段狂暴，出招不歇', '精英带两条词缀'] },
];

/** 第 n 劫这一档（夹在 1..5）。 */
export const jieTier = (n: number) => JIE_TIERS[clampJie(n) - 1];

/** 奖励的说明（选劫页）：这一劫的灵石、道行比劫一多多少。 */
export function jieRewardText(n: number): string {
  const k = clampJie(n) - 1;
  return k ? `灵石、经验 −${pct(-JIE.lingshi * k)} · 道行 ×${(1 + JIE.dao * k).toFixed(2).replace(/\.?0+$/, '')}` : '灵石、经验、道行如常';
}

/** 夹成 1..5 的整数；不给、不认识就是劫一。 */
export function clampJie(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(JIE_MAX, Math.floor(n))) : 1;
}

const setHp = (e: Enemy, hp: number) => {
  e.hp = e.maxHp = Math.max(1, Math.round(hp));
};

/**
 * 刷出来的一只敌人（world.spawnAt：刚建好、还没放进场里）：劫二起加气血（首领的在 jieBossStart，上场时才定），
 * 劫三起加移速。不用随机数。
 */
export function jieSpawn(w: World, e: Enemy) {
  const n = w.jie;
  if (n < 2) return;
  if (e.kind !== 'boss') setHp(e, e.hp * (1 + JIE.hp));
  if (n >= 3) e.speed *= 1 + JIE.speed;
}

/** 首领上场之后（world.startWave 里，联机按人数加过之后）：劫二起首领的气血也加（换阶段的门槛按比例，跟着变）。 */
export function jieBossStart(w: World) {
  if (w.jie < 2 || !w.boss) return;
  const id = w.boss.id;
  const b = w.enemies.find((e) => e.id === id);
  if (b) setHp(b, b.maxHp * (1 + JIE.hp));
}

/** 这一个普通波比原来多刷几只精英（world.step）：劫三起每个普通波多一只。 */
export const jieElites = (w: World) => (w.jie >= 3 ? JIE.elites : 0);

/** 劫四起敌人的弹道、冲锋的速度倍率（劫一到三是 1）。enemies.ts 的骑兵、风吼妖读它；鬼火见 fasterOrb。 */
export const jieShot = (w: World) => (w.jie >= 4 ? 1 + JIE.shot : 1);

/** 刚放出来的一团鬼火（world.step，鬼火术士举杖放的）：劫四起飞得快。 */
export function fasterOrb(w: World, o: Orb) {
  const k = jieShot(w);
  if (k === 1) return;
  o.vx *= k;
  o.vy *= k;
}

/** 魔焰焚城每一步推进的间隔的倍率（boss.ts；劫一到三是 1）。 */
export const jieInferno = (w: World) => (w.jie >= 4 ? JIE.inferno : 1);

/** 首领打人的伤害倍率（core.hurtPlayer，伤害来源是 'boss' 的；劫一到三是 1）。 */
export const jieBossDmg = (w: World) => (w.jie >= 4 ? 1 + JIE.bossDmg : 1);

/** 捡到的灵石的倍率（world.gainGem；劫一是 1，往上递减）。 */
export const jieLingshi = (w: World) => 1 + JIE.lingshi * (w.jie - 1);
/** 捡到的经验的倍率（world.gainGem；劫一是 1，往上递减）。 */
export const jieXp = (w: World) => 1 + JIE.xp * (w.jie - 1);

/**
 * 每帧（world.step，首领模块推进之后）：劫五的首领进了三阶段就狂暴——两招之间的空闲（idle）、收招（recover）过得快 JIE.rage 倍。
 * 只动这两个状态的计时（BossCore 的 t），出招和预警照原来的节奏：招式照样看得清，只是一招接一招，没有喘息。
 */
export function jieTick(w: World) {
  const b = w.boss;
  if (w.jie < 5 || !b || b.phase < 3 || (b.state !== 'idle' && b.state !== 'recover')) return;
  b.t += DT * (JIE.rage - 1);
}

/** 首领在狂暴没有（表现层读：身边冒暗红的火星）。 */
export const bossEnraged = (w: World) => w.jie >= 5 && !!w.boss && w.boss.phase >= 3 && w.boss.state !== 'dead';
