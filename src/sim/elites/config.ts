// 精英与精英词缀的数值（暂拟的初值，待评审确认；用户口径：数值放到最后统一调）。行为在同目录的 yecha / lishi / jianshi / affixes。
// 时间单位秒、距离像素（地面高度，量到人物脚下）、速度像素 / 秒；伤害 × 敌人的波次倍率（Enemy.dmgMul），同别的小怪。
// 共用的身板（半径 11、接触 14、质量 4、宝匣、灵石）照 config.ENEMIES.elite；下面的 hp / speed 是相对回响校尉（气血 200、移速 25–30；2026-11-11 数值平衡前是 260、20–24）的倍率。
import { CASTER } from '../config.ts';
import type { EliteAffix, EliteKind } from './types.ts';

export const ELITES = {
  xiaowei: { hp: 1, speed: 1 },
  /**
   * 东海夜叉（第一章劫二起）：
   * 潜水突袭 dive —— 离人物在 band 以内、冷却好了就沉进水里（sink 秒，打不着），在水下以 speed 游向人物（2026-11-11 数值平衡 128 → 150；最多 under 秒，到 near 以内就停），
   *   停住后地上亮出要冒出来的那一片（rise 秒的淡红光，半径 r，量到人物脚下），然后冒出水面：r 以内的人挨 dmg、被往外震开（初速 push），
   *   之后喘 rest 秒。冷却 cooldown（第一次 first）。
   * 拍浪 slap —— 离人物 near 以内、冷却好了就抬爪（warn 秒，地上亮出浪要推过的那一条：长 len、半宽 width + 人物半径），
   *   然后浪头以 speed 沿线推过去：推到的人挨 dmg、顺着浪的方向被推开（初速 push）；收招 rest 秒，冷却 cooldown（第一次 first）。
   */
  yecha: {
    hp: 1,
    speed: 1.1,
    dive: { band: [64, 180] as [number, number], first: 2.2, cooldown: 7, sink: 0.5, speed: 150, under: 1.2, near: 12, rise: 0.85, r: 26, dmg: 16, push: 210, rest: 0.75 },
    slap: { near: 48, first: 1.5, cooldown: 3.6, warn: 0.6, len: 64, width: 11, speed: 260, dmg: 12, push: 230, rest: 0.45 },
  },
  /**
   * 金光力士（第二章）：走得慢、厚一点。每 every 秒（第一次 first）站定举旗 warn 秒，然后给身边 r 以内最近的 max 只敌人（连它自己，首领除外）
   * 各套一层金光：挡下一下伤害（hits 下；灼烧、流血、地面区域这些持续伤害不挡，神通也挡不住），hold 秒后散掉。举旗时被晕住就打断。
   */
  lishi: { hp: 1.25, speed: 0.85, cast: { first: 1.4, every: 4.6, warn: 0.7, rest: 0.35, r: 96, max: 7, hits: 1, hold: 9 } },
  /**
   * 截教剑侍（第三章）：站在离人物 keep 那一圈上横着挪（同截教门徒）。身边绕着三柄小剑（半径 orbit.r、上下扁 orbit.ry、离地 orbit.h，每秒转 orbit.spin 弧度；
   * 晕眩、冻住时不转）。人在 range 以内、冷却好了就让下一柄停下指向人物（warn 秒，地上亮出它要射过的直线：穿过人物当时的位置再延伸 over，
   * 长度夹在 len 之间，半宽 = 剑的判定半径 r + 人物半径），然后射出去（w.orbs 里 kind 'blade' 的弹道，speed，打中掉 dmg；法宝打不散，同鬼火）；
   * 两柄之间隔 gap 秒，三柄都射完了 reload 秒后重新聚齐。抬剑时被晕住就打断（这一柄回到身边）。
   */
  jianshi: {
    hp: 0.95,
    speed: 1,
    keep: [70, 108] as [number, number],
    orbit: { r: 13, ry: 6, h: 8, spin: 2.4 },
    shot: { range: 150, first: 1.2, warn: 0.55, over: 40, len: [80, 200] as [number, number], speed: 250, dmg: 9, gap: 1, reload: 2.6, r: CASTER.orbRadius },
  },
} satisfies Record<EliteKind, { hp: number; speed: number; [k: string]: unknown }>;

/**
 * 精英词缀：
 * - swift 迅捷：移速（连夜叉在水下游的速度）× speed。
 * - armor 坚甲：受到的伤害 × (1 − cut)（哮天犬「破甲」破得开，同盾卫的盾、落魂幡手的护体）。
 * - split 分魂：死时分出 n 只离魂（分魂鬼分出来的那种小鬼，气血 × hp），从倒下的地方往外弹开（初速 kick）。
 * - recoil 反震：被离它 near 以内的人打中（直接命中；灼烧、流血、区域、神通不算），冷却好了就蓄力 warn 秒（脚下以它为圆心、半径 r 的淡红光，跟着它走），
 *   然后震开：r 以内的人挨 dmg、被往外震开（初速 push）；冷却 cooldown。蓄力时被晕住就打断。
 * - summon 召唤：开打 first 秒后、之后每 every 秒，人物在 range 以内时站着掐诀 warn 秒（身边地上两处亮出符印，离它 gap），然后从符印里冒出 n 只回响兵
 *   （刚冒出来愣 daze 秒）；它召出来、还活着的最多 max 只。掐诀时被晕住就打断（过 2 秒再来）。
 */
export const AFFIX = {
  swift: { speed: 1.5 },
  armor: { cut: 0.4 },
  split: { n: 2, hp: 3, gap: 5, kick: 110 },
  recoil: { near: 46, warn: 0.5, r: 40, dmg: 10, push: 220, cooldown: 3 },
  summon: { first: 3, every: 7, range: 220, warn: 0.8, n: 2, gap: 18, max: 6, daze: 0.5 },
};

/** 抽词缀的顺序（每只精英按这个顺序抽、不重样）。 */
export const AFFIXES: readonly EliteAffix[] = ['swift', 'armor', 'split', 'recoil', 'summon'];
