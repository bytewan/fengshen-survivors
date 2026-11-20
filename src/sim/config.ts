// 数值表：手感原型阶段的全部可调参数集中在这里。单位：像素、秒、每秒。
// 改手感先改这里；M4 用机器人跑模拟调数值时也只动这张表。
import type { EnemyKindName, FoeKind } from './types.ts';

export const DT = 1 / 60; // 模拟固定步长

export const ARENA = { w: 960, h: 540, pad: 14 };

/**
 * 镜头（和表现层 render/stage.ts 的 VIEW_W × VIEW_H 是同一个数）：以人物为中心，看向人物脚下往上 lift 像素。
 * 模拟只在一处用它：保证刷怪刷在所有人的屏幕外（spawn.ts）。改镜头大小时两边一起改（fixes.test.ts 有一条对照）。
 */
export const VIEW = { w: 480, h: 270, lift: 12 };

/**
 * 魔气（用户提议，替代空气墙）：出了仙台边缘就进入魔气带，越往外越慢、掉血越快；魔气带外沿是硬边界。
 * 掉血按最大气血的百分比算，不受无敌时间影响。
 */
export const MIASMA = {
  depth: 72, // 魔气带宽度（从仙台边缘往外）。用户：不要让玩家跑太远
  slowMax: 0.85, // 最深处减速 85%
  slowCurve: 0.6, // 减速 = slowMax × 深度^slowCurve：小于 1 表示前段就陡，一踏进去就明显变慢
  drainMin: 0.02, // 刚进去：每秒掉最大气血的 2%
  drainMax: 0.16, // 最深处：每秒 16%
  report: 0.5, // 每隔多久发一次「侵蚀」事件（表现层飘紫色数字）
};

export const PLAYER = {
  speed: 82,
  radius: 5,
  maxHp: 100,
  iframes: 0.7, // 受伤后的无敌时间
  magnetRadius: 46, // 灵石被吸过来的距离
  pickupRadius: 7,
};

/**
 * 法宝的射程（用户 2026-11-10 试玩：「各种武器、法宝、宠物的攻击距离不能太大」）。画面 480×270、镜头始终以人物为中心，
 * 上下只看得到人物上下各约 135 像素、左右各约 240 像素：法宝打的都要在画面里。规则（docs/design.md「M1 试玩反馈与新规则」）：
 * - seek 索敌半径：离人物（脚下）这么远以内的敌人才会被选为目标 —— 瞄准、落点、第一跳、追谁都只在这里面挑；不吃范围加成。
 *   本来就近的法宝（火尖枪、火罩、血光斩、扇子）照旧按自己够得着的距离找，吃范围加成，但也不超过它。
 * - max 效果的最远处：飞出去的（乾坤圈、飞刀、火鸟）、伸出去的（枪芒、光束、火浪、火罩、火龙）、连过去的（雷的连跳、金绳、
 *   旋风卷人）、散落的（冰棱）都不超过离人物这么远；范围加成可以把它们加长，加成后也不超过它。
 * - 落点处的范围（大印、旋风、水域、震波、鞭痕……的半径）以落点（都在 seek 以内）为中心；范围加成对它们最多算到 +area（30%），
 *   不然范围堆高了，落在画面边上的大印、震波一大半都砸在画面外。攻速只缩冷却，不改任何距离。
 */
export const REACH = { seek: 130, max: 145, area: 0.3 };

export const RING = {
  cooldown: 0.85,
  speed: 270,
  range: 125, // 飞出多远开始折返
  returnSpeed: 320,
  damage: 12,
  critChance: 0.12,
  critMul: 2.2,
  hitRadius: 9,
  grow: 0.7, // 飞到最远处时判定半径放大的比例（和画面上圈变大一致）
  knockback: 110, // 命中给敌人的击退初速度
};

export const SKILL = {
  // 神通·三头六臂：以自身为中心的冲击波 + 向八方各掷一枚乾坤圈；耗尽整条真气
  chargePerKill: 1 / 80, // 用户：神通对真气的消耗可以更多（45 只 → 80 只充满）
  chargePerElite: 0.25,
  radius: 96,
  damage: 70,
  knockback: 320,
  rings: 8,
};

export interface EnemyKind {
  hp: number;
  speed: [number, number]; // 速度区间
  radius: number;
  contact: number; // 接触伤害
  mass: number; // 越大越难击退
  gems: number; // 掉落灵石数
  gemValue: number;
}

// 2026-11-11（M4 数值平衡）：普通敌人的灵石 gemValue 1 → 1.15 —— 气血整体 ×1.6（catalog.WAVE_CURVE.hpBase）以后打得慢了、
// 同样时间里打死的少了约两成，每只多给一点，进账与升级的节奏和原来差不多（功法、宠物进化的等级门槛是按原来的节奏定的）。
// 第 1 轮先给 1.25；第 2 轮敌人走得快了、来得快打死的也多了，等级中位从原来的 17 涨到 19–20，第 4 轮收回到 1.15。
// 精英 260 → 200：乘上 ×1.6 以后第一章的精英约厚 1.25 倍（原来机器人四十局只打死十一只）。
// 移速（同一轮，用户：「怪物的移动速度可以稍微加快一点点，或者是特殊的怪物移动速度更快，给玩家压迫感」）：普通的 +10%；
// 特殊的更快——骁骑、爆符鬼 +20%，风吼妖、飞剑灵、分魂鬼的小鬼 +15%，精英 +25%（原来比回响兵还慢）；骁骑冲锋、风吼妖冲刺、飞剑灵射来的速度另在
// FOES / FOES2 / FOES3、东海夜叉潜水游过来的速度在 elites/config.ts。预警的时长一律不动（躲得开是规矩）。
export const ENEMIES: Record<EnemyKindName, EnemyKind> = {
  // 第一章新加的五种（行为见 enemies.ts，出手的数值见文件末尾的 FOES）。分魂鬼死时分成两只 splitling
  spearman: { hp: 30, speed: [29, 35], radius: 6, contact: 5, mass: 1.3, gems: 1, gemValue: 1.15 },
  shieldbearer: { hp: 70, speed: [17, 21], radius: 8, contact: 7, mass: 6, gems: 2, gemValue: 1.15 },
  cavalry: { hp: 55, speed: [36, 43], radius: 8, contact: 6, mass: 3, gems: 2, gemValue: 1.15 },
  bomber: { hp: 14, speed: [65, 74], radius: 5, contact: 3, mass: 0.8, gems: 1, gemValue: 1.15 },
  splitter: { hp: 36, speed: [26, 33], radius: 7, contact: 5, mass: 1.2, gems: 1, gemValue: 1.15 },
  splitling: { hp: 12, speed: [44, 53], radius: 4, contact: 3, mass: 0.7, gems: 1, gemValue: 1.15 },
  // 第二章新加的三种（行为见 enemies.ts，出手与出场的数值见 sim/ch2/config.ts 的 FOES2）
  bannerman: { hp: 18, speed: [26, 31], radius: 6, contact: 4, mass: 1, gems: 2, gemValue: 1.15 },
  golem: { hp: 110, speed: [13, 17], radius: 10, contact: 9, mass: 8, gems: 4, gemValue: 1.15 },
  windfiend: { hp: 20, speed: [67, 76], radius: 5, contact: 3, mass: 0.7, gems: 1, gemValue: 1.15 },
  // 第三章新加的三种（行为见 sim/ch3/foes.ts，出手与出场的数值见 sim/ch3/config.ts 的 FOES3）：飞剑灵小而快、截教门徒远程、阵图傀儡两只一组
  flysword: { hp: 16, speed: [58, 67], radius: 4, contact: 3, mass: 0.6, gems: 1, gemValue: 1.15 },
  disciple: { hp: 34, speed: [24, 29], radius: 6, contact: 4, mass: 1, gems: 2, gemValue: 1.15 },
  puppet: { hp: 70, speed: [26, 31], radius: 7, contact: 6, mass: 3, gems: 2, gemValue: 1.15 },
  // 第二章首领姚天君召出来的：落魂幡、草人（不动、不伤人，血量在 sim/ch2/config.ts 的 YAO 里另给）
  soulflag: { hp: 900, speed: [0, 0], radius: 5, contact: 0, mass: 1e6, gems: 1, gemValue: 2 },
  strawman: { hp: 560, speed: [0, 0], radius: 6, contact: 0, mass: 1e6, gems: 1, gemValue: 2 },
  soldier: { hp: 22, speed: [26, 37], radius: 6, contact: 5, mass: 1, gems: 1, gemValue: 1.15 },
  elite: { hp: 200, speed: [25, 30], radius: 11, contact: 14, mass: 4, gems: 9, gemValue: 3 },
  caster: { hp: 30, speed: [24, 29], radius: 6, contact: 4, mass: 1, gems: 2, gemValue: 1.15 },
  // 每章第 6 波的首领「魔化哪吒」：和玩家的哪吒一样大（镜像对决），血量、伤害、招式见 BOSS，移动由 boss.ts 控制
  boss: { hp: 7000, speed: [0, 0], radius: 8, contact: 14, mass: 30, gems: 40, gemValue: 3 },
};

/**
 * 首领「魔化哪吒」（用户定，2026-11-09）：三阶段，每一招都先预警、再结算，看得懂、躲得开。
 * - 伤害直接定在这里，不乘波次倍率：按第 6 波时玩家约 100–140 的气血定，每次挨打约 15–25%。
 * - 数组按章节取（下标 1..3）：第二、三章暂时也用魔化哪吒，血量与伤害按章放大。
 * - 时间单位秒，距离像素，速度像素/秒；玩家没有冲刺、移速 82，所以预警都留够了。
 */
export const BOSS = {
  name: ['', '魔化哪吒', '第二章首领（暂用魔化哪吒）', '第三章首领（暂用魔化哪吒）'],
  hp: [0, 16000, 36000, 66000],
  dmg: [0, 1, 1.6, 2.2], // 招式与接触伤害的倍率（按章）
  phases: [0.6, 0.3], // 气血降到这两个比例时换阶段（一次大伤害也只会卡在阈值上，不跳阶段）
  intro: 2.0, // 入场：无敌，横幅「魔化哪吒」
  phaseTime: 2.2, // 换阶段：无敌，身上爆出黑焰
  deathTime: 2.4, // 倒下的表现放多久（黑焰散成灰、魔气退去），之后才收灵、进商店
  entry: [150, 200] as [number, number], // 入场时离玩家多远（用户：人物不回原位，首领不要贴脸出现）
  idle: [0, 1.25, 0.95, 0.68], // 两招之间慢慢朝玩家走多久（按阶段，阶段越高越短）
  walk: [0, 30, 34, 38], // 空闲时走路的速度（按阶段）
  keep: 110, // 空闲时想站在玩家左边或右边多远
  keepY: 36, // 上下最多差多少（镜头是 16:9）
  contact: 18,
  /** 每个阶段的招式池（权重）；不会连续两次出同一招。 */
  pool: [{}, { ring: 1, dash: 1 }, { clones: 1.3, sweep: 1.3, ring: 0.7, dash: 0.6 }, { wheels: 1.5, sweep: 0.9, clones: 0.8, ring: 0.6, dash: 0.5 }] as Record<string, number>[],
  // 黑焰乾坤圈：先亮出往返路线，再匀速飞出、在最远处一顿、折返回首领；二阶段起一次两枚（±25°）
  ring: { warn: 0.7, range: 260, minRange: 160, over: 70, speed: 340, hover: 0.12, r: 12, dmg: 26, spread: (25 * Math.PI) / 180, recover: 0.35 },
  // 火尖枪突进：蓄力时地上亮出一道直线（穿过玩家当时的位置，预警期间不跟踪），然后整条冲过去
  dash: { warn: 0.85, len: 340, hw: 14, speed: 620, dmg: 30, recover: 0.6 },
  // 三头六臂：两个残影滑到玩家两侧，残影 A、残影 B、本体依次预警并突进；三条线都是横的，上下走就能全躲开
  clones: { slide: 0.6, side: 170, rise: 22, bodyRise: 80, gap: 0.4, dmg: 22, recover: 0.7 },
  // 混天绫横扫：站定，红绫从起始角扫过 180°；起始角比朝向玩家的方向往扫动的反方向偏 lead，往反方向走一小段就能躲开
  sweep: { warn: 1.05, time: 0.55, r: 210, lead: 0.4, dmg: 30, recover: 0.5 },
  // 风火轮：地上亮出三条平行车道（一条穿过玩家），火轮从场地一边滚到另一边；最后再单独朝玩家滚一个
  wheels: { warn: 0.9, gap: 70, speed: 230, r: 9, dmg: 22, aimAt: 0.55, aimWarn: 0.75, recover: 0.45 },
  // 魔焰焚城：进入三阶段时施放，之后每隔 every 秒魔气向内推进一步；左右推得多、上下推得少（保持 16:9）
  inferno: { first: 0.7, every: 6, warn: 1.3, push: 1.5, steps: 6, max: { x: 180, y: 100 } },
  // 首领波不按时刷小怪，只零星刷一点回响兵（让靠击杀充能的神通充得起来，也热闹些）；刷在屏幕外沿再往外 out 像素（spawn.ts）
  summon: { first: 6, every: [0, 7, 6, 4.5], n: 2, max: 7, out: [4, 40] as [number, number] },
};

/**
 * 远程怪「鬼火术士」：保持距离，举杖蓄力后放一团慢速鬼火。法宝打不散鬼火，只能躲（用户定）。
 * 站位（2026-11-10 改）：原来停在离人物 130–185 像素处，法宝的射程收到 REACH 之后多数够不着它，掉血三分之二来自鬼火；
 * 改成停在法宝够得着的 90–125 像素，同屏上限也降一点。其它数值留给之后专门的数值调优。
 */
export const CASTER = {
  keepMin: 90, // 比这近就后退（原来 130）
  keepMax: 125, // 比这远就靠近（原来 185）
  cooldown: [2.8, 3.8] as [number, number],
  windup: 0.45, // 蓄力（表现层用来预警）
  orbSpeed: 72,
  orbDamage: 8,
  orbRadius: 4,
  orbLife: 4.5,
  appearAt: 35, // 第几秒开始出现
  share: 0.08, // 占刷怪的比例
  maxAlive: 7, // 同屏最多几只（原来 10）
};

/**
 * 刷怪的位置（每秒刷多少、什么时候来精英和包围在 catalog.ts 的 WAVE_CURVE / SURGE；位置怎么挑在 spawn.ts）。
 * 铁律：敌人不能凭空出现在屏幕里 —— 刷怪点一定在所有活着的人物的镜头外，同时在敌人能待的范围（魔气带外沿）以内。
 * 做法：随便挑一个方向，从人物沿这个方向走到屏幕外沿，再往外 out 像素 —— 各个方向来的一样多，都是刚出屏幕、走几步就进来。
 * 人物靠墙、在角落时，出了界的方向不是夹回场内（那样会刷到人物身边、甚至刷出来那一帧就撞人），而是换个方向重抽。
 */
export const SPAWN = {
  maxEnemies: 280, // 同屏上限
  // 镜头边再往外多少才算「屏幕外」（整只精灵都看不见，震屏时也不露）：左右让出朝人物伸出来的那一截（矛卒的长矛约 25 像素）；
  // 精灵从脚底往上画，所以上边只要让出影子，下边要让出一个身高（精英连血条约 40 像素）；再加震屏的几像素
  margin: { x: 32, top: 8, bottom: 46 },
  out: [6, 30] as [number, number], // 常规刷怪：屏幕外沿再往外这么多像素（平均离人物约 250 像素，和原来刷在 250–320 的椭圆环上差不多）
  eliteOut: [6, 24] as [number, number], // 精英：贴着屏幕边，现身的横幅一出就走进来
  tries: 10, // 随机重抽几次；还抽不到（人物在角落，能刷的方向只剩一小段）就把一整圈扫一遍
  surgeGap: 10, // 包围：贴着屏幕外沿、再往外这么多刷一整圈（原来刷在 170 × 128 的椭圆上，整圈都在屏幕里）
};

/**
 * 波末收灵（用户：把所有的灵石、物品吸过来的画面要保留，速度不要太快也不要太慢，要有爽点；不要直接跳到商店）。
 * 飞行按时间驱动：每件东西从静止匀加速飞向人物，飞行时长 T = √(2 × 距离 / accel)，夹在 [min, max] 秒 —— 近的先到、远的后到，
 * 越到后面到得越密；再远也一定在 max 秒内飞到（不会飞到一半商店就开了、东西凭空结算）。
 * 场上什么都没有也要停 min 秒（「平定」的停顿）；最后一件收下之后再停一下（tail），让最后那一下看得见。
 */
export const COLLECT = {
  min: 1, // 收灵阶段最少多久（场上没有灵石、没有掉落时也停这么久再进商店）
  tail: 0.35, // 最后一颗灵石收下之后再停多久
  tailDrop: 1, // 最后收下的是宝匣 / 蟠桃 / 聚灵符：多停一会儿，看得清开出了什么
  gem: { accel: 260, min: 0.3, max: 2.8 }, // 灵石：100 像素约 0.9 秒、300 约 1.5 秒、900 约 2.6 秒
  drop: { accel: 220, min: 0.5, max: 3 }, // 掉落：比灵石慢一点，看得清飞过来的是什么（300 像素约 1.65 秒）
  max: 8, // 兜底：超过这么久还没收完（不该发生）就直接结算、进商店
};

/**
 * 战场掉落（用户：对战中偶尔掉宝箱、蟠桃、磁铁，做成修仙化的）：
 * 普通兵 / 鬼火术士被打死时按 chance 掉（气运每点 +1%），场上最多 max 个（精英必掉的宝匣不算），life 秒后消失；
 * 人物走到 pickR 以内自动拾取（拾取范围加成吃一半）。蟠桃回 peachHeal 的气血，满血时拿到不浪费、改成气血上限 +peachOver；
 * 聚灵符把场上的灵石全吸过来，吸来的按 magnetBonus 倍算（波末收灵时飞过来的聚灵符同理：这一波收的灵石都按它算，正好把八折补回十成）；
 * 乾坤宝匣随机给一样：一笔灵石（chestLingshi × 物价，精英的 × richMul）、一件已有法宝的碎片（凑满三枚自动升阶）、真气充满。
 * 波末收灵时场上的掉落和灵石一起飞向人物（飞多快见 COLLECT.drop），飞到了照常生效。
 */
export const DROPS = {
  chance: { peach: 0.0035, magnet: 0.0025, chest: 0.002 }, // 一局一千五百只上下：蟠桃五个、聚灵符四个、宝匣三个左右（不算精英的）
  max: 3,
  life: 16,
  pickR: 12,
  peachHeal: 0.25,
  peachOver: 2, // 满血时拿到蟠桃：气血上限 + 这么多（收灵时飞来的蟠桃有一半落在满血上，原来白吃）
  magnetBonus: 1.25, // 聚灵符吸来的灵石按这个倍数算（原来只是把波末本来就会收走的灵石提前吸过来，几乎不值钱）
  chestLingshi: [14, 26] as [number, number],
  richMul: 1.8,
  // 宝匣开出什么（权重）：普通宝匣 / 精英宝匣
  chest: { lingshi: 45, fragment: 30, qi: 25 },
  richChest: { lingshi: 25, fragment: 60, qi: 15 },
};

/**
 * 第一章新敌人的出手与出场（行为见 enemies.ts）。伤害都乘敌人身上随波次加强的 dmgMul（同接触伤害、鬼火的口径）。
 * 每一下都先预警、再结算，看得懂、躲得开；人物移速 82，预警时间都按「看见了再走开来得及」留。
 */
export const FOES = {
  // 回响矛卒：走到离人物约 hold 像素处停下，蓄力（地上亮出一小段刺击线，线定下就不跟踪）后一矛刺出
  spearman: {
    hold: 30, // 走到这么近就停下
    back: 22, // 比这还近就往后退半步
    windup: 0.5, // 蓄力多久
    reach: 46, // 刺击线多长（从脚下量起）：停在 30 像素处，往后退十几像素就够不着
    width: 4, // 刺击线半宽（判定再加人物半径）：往旁边让开十来像素就躲过
    strike: 0.16, // 刺出去的那一下持续多久（这期间走进线里也会挨）
    rest: 0.35, // 收枪
    cooldown: 2, // 从刺出算起，多久后才能再蓄力
    dmg: 9,
  },
  // 玄符盾卫：走得慢、血厚、难击退（ENEMIES 里质量大）；举着符盾慢慢转向人物，正面受到的伤害大幅降低
  shieldbearer: {
    turn: 1.5, // 盾转向的最快速度（弧度 / 秒）：贴着它绕圈就能绕到侧面、背后
    arc: 1.15, // 正面的半角（弧度，约 66°）：伤害从这个扇形里来算正面
    guard: 0.25, // 正面受到的伤害 × 0.25
    // 不吃正面减伤的伤害：持续伤害、地面区域、从天而降 / 脚下刺出 / 炸开的、相生、神通
    // （artifacts 分支补上新法宝里同类的：lash 打神鞭从天抽下、tide 玄元控水旗脚下涌起的水柱、gust 定风珠旋风吹散、rope 捆仙绳绕身勒住；
    //  dou 云霄的混元金斗：被吸进斗里再摔下来的）
    pierce: ['burn', 'bleed', 'zone', 'slam', 'spike', 'thunder', 'chain', 'explode', 'react', 'skill', 'lash', 'tide', 'gust', 'rope', 'dou'] as string[],
  },
  // 阴马骁骑：离人物 band 像素时先亮出一条冲锋线（不跟踪），预警 warn 秒后沿线高速冲过去，冲完原地喘息
  cavalry: {
    band: [120, 200] as [number, number], // 在这个距离上才冲锋：太近先拉开，太远先靠近
    warn: 0.8,
    speed: 330, // 冲锋速度（人物 82；2026-11-11 数值平衡 280 → 330，预警 0.8 秒不变）
    over: 60, // 冲锋线穿过人物（预警时的位置）之后再延伸多远
    len: [150, 260] as [number, number], // 冲锋线长度的上下限
    width: 7, // 冲锋线半宽（判定再加人物半径）
    rest: 1, // 冲完喘息
    cooldown: 3.2, // 从冲完算起（含喘息），多久后才能再冲
    dmg: 14,
  },
  // 爆符鬼：飘得快，贴近人物 light 像素时点燃怀里的爆符，引信 fuse 秒（身体闪烁膨胀、冒火星）后原地炸开。
  // 引信点燃前被打死就不炸；点燃之后打不死、不吃控制，一定会炸 —— 看见它闪就走开
  bomber: {
    light: 28,
    fuse: 0.8,
    radius: 32, // 炸开的半径（量到人物脚下）
    dmg: 16,
  },
  // 分魂鬼：死时分成两只小鬼（splitling），往两边弹开；小鬼再死不再分
  splitter: { n: 2, gap: 5, kick: 90 },
  /**
   * 出场节奏（用户定，每章 6 波、第 6 波首领）：第 1 波只有回响兵；第 2 波加长矛兵；第 3 波加自爆鬼和鬼火术士；
   * 第 4 波加盾兵和精英（精英照旧在 world.ts 里按时出一只）；第 5 波加冲锋骑兵和分魂鬼。第二、三章全都出、更多一些。
   * from：本章第几波起出现；share：刚出现那一波占刷怪的比例，之后每波 + per；max：同屏最多几只。
   * 第二章起按「第 5 波 + chapterStep × (章 − 1) + 本章第几波 − 1」算比例（封顶 capWave）；所有新种类加起来最多占 cap，其余是回响兵。
   * 鬼火术士沿用原来的比例：min(0.2, 0.05 + 全局波次 × 0.008)，见 enemies.ts。
   */
  mix: {
    spearman: { from: 2, share: 0.16, per: 0.015, max: 14 },
    bomber: { from: 3, share: 0.08, per: 0.01, max: 8 },
    shieldbearer: { from: 4, share: 0.07, per: 0.01, max: 6 },
    cavalry: { from: 5, share: 0.05, per: 0.008, max: 4 },
    splitter: { from: 5, share: 0.08, per: 0.01, max: 10 },
  } as Partial<Record<FoeKind, { from: number; share: number; per: number; max: number }>>,
  chapterStep: 1,
  capWave: 9,
  cap: 0.6,
};

/**
 * 联机（1–4 人，M2）的规则，见 coop.ts（人员进出在 roster.ts）。人数 = 还在房间里的人：离开的不算，托管、倒地、出局的都算。
 * 只在人数 > 1 时生效，单人完全不变（倒下就陨落、敌人不加强）。数值都是先给的初值，最后统一调。
 * - 倒地救援 ★（docs/plan-m2-m4.md「联机」）：气血打空（莲花化身、替身符这些保命的先生效）→ 倒地 downT 秒：不能动、不能出手，
 *   敌人不再追他；队友站到身边 reviveR 像素内持续 reviveT 秒就扶起来（回 reviveHp 的气血、无敌 reviveIframes 秒）；
 *   扶的人走开，进度按扶的速度的 decay 倍回落；有人在扶时倒计时停住。downT 秒没人扶 → 出局；这一波打完时还倒着的也出局。
 *   出局的人下一波开始时归队：站到最近的队友身边，气血至少 rejoinHp、无敌 rejoinIframes 秒。所有人都倒地或出局 → 全队陨落（over）。
 * - 按人数加强 ★：n 个人时，敌人气血 ×(1 + hp × (n − 1))、刷怪数（每秒刷怪、包围的一圈）×(1 + spawn × (n − 1))、
 *   首领气血 ×(1 + boss × (n − 1))。精英的只数、首领波的零星召兵不变（召出来的兵照样加血）。
 * - 灵石和经验全队共享（docs/design.md「经济」）：谁捡到一颗灵石，房间里每个人都得 value × share(n)，share = 1 / (1 + spawn × (n − 1))
 *   —— 敌人（灵石）多了几成就分几成，每个人的进账和单人时差不多。
 * - 中途加入：只在商店阶段；灵石给在场的人平均数的 joinLingshi，等级从 1 开始（★ 先这么定）。
 * - 掉线托管：受到的伤害 × awayHurt；商店里不等他（机器人替他买、替他按出战）。
 */
export const COOP = {
  maxPlayers: 4,
  downT: 15,
  reviveR: 30,
  reviveT: 3,
  decay: 0.5,
  reviveHp: 0.3,
  reviveIframes: 1.5,
  rejoinHp: 0.1,
  rejoinIframes: 1,
  scale: { hp: 0.9, spawn: 0.5, boss: 1.1 }, // 2026-11-11 数值平衡 hp 0.6 → 0.9、boss 0.75 → 1.1（2–4 人原来 10/10、倒地中位 0；刷怪多了早几波就崩，加在血上）
  joinLingshi: 0.6,
  awayHurt: 0.5,
  // 商店里等不等出局的人按出战：true = 等（出局只管战斗，他下一波开始就归队，商店照常逛；暂拟）；
  // false = 不等（TASK 原文「出局 / 掉线的人不等」）。界面不给出局的人开商店的话要改成 false，不然商店会一直等他
  waitOut: true,
};
