// 第二章 · 西岐城外 · 十绝阵 的数值表（地形「十阵轮转」、三种新敌人、首领「落魂阵主 · 姚天君」）。
// 单位：像素、秒、每秒。数值是第一版的初值（用户：数值放到最后统一调），只保证看得懂、躲得开、打得过。
// 设计见 docs/story/ch2-ch3.md；行为见同目录的 terrain.ts、yao.ts 和 ../enemies.ts。
import type { SiteKind } from './types.ts';

/**
 * 地形「十阵轮转」：场上十座阵台（阵眼），每座固定是原著十绝阵里的一座（kinds[i]），每隔 every 秒在离人物近的几座里亮起 count 座
 * （先预警 warn 秒：阵旗猎猎、地纹渐亮），亮 on 秒。亮着时各放各的招（每一招先在地上亮淡红光 warn 秒，够躲开）：
 *  - 天绝阵 thunder：阵里每隔一会儿落一道天雷，有人在阵里时多半瞄着人落；
 *  - 地烈阵 quake：从阵心往外一道道裂开地缝、喷出岩火（一次几道，一道多半朝着阵里的人）；
 *  - 风吼阵 wind：几道风刃绕着阵心扫过一个扇面（刃扫到的人挨一下、被往外吹开）；阵里一直有风往外推；
 *  - 寒冰阵 ice：地下一圈圈冒冰锥（内圈 / 外圈轮着冒，中间的环是空的），扎到的人冻得走不快；
 *  - 金光阵 gold（奖励）：站在阵里法宝伤害提高，但阵边不断冒出回响兵——冒险换输出；
 *  - 化血阵 blood：一片血雾，里面的人和敌人都持续掉血（可以拿来引怪）；
 *  - 烈焰阵 fire：预警的点上窜起火柱，落下后留一会儿烧地；
 *  - 落魂阵 soul（姚天君的阵）：魂火从阵边飘出来追人，站在里面真气流走、走得慢；
 *  - 红水阵 water：人物走得慢、持续掉血（按最大气血的百分比）；敌人走进去也被拖慢；
 *  - 红沙阵 sand：沙暴把人（和敌人）往阵心拖、走得慢，阵心的沙眼磨人。
 * 打人的伤害不乘波次倍率（和首领一样直接写在这里）；打敌人的（foe）乘波次的血量倍率（同第三章的四剑轮斩），首领不吃。
 */
export const TEN = {
  /** 十座阵台的位置（场地 960×540 里错落地摆开，场心留给开局的人物）。阵的半径是 r：判定和地上亮起的阵一样大。 */
  sites: [
    [165, 128],
    [392, 112],
    [598, 140],
    [806, 118],
    [272, 285],
    [688, 262],
    [150, 420],
    [372, 432],
    [604, 405],
    [812, 428],
  ] as [number, number][],
  /** 每座阵台是哪一阵（和 sites 一一对应；颜色相近的几阵——红水、化血、烈焰、红沙、地烈——不挨着摆）。 */
  kinds: ['thunder', 'fire', 'ice', 'sand', 'gold', 'soul', 'water', 'wind', 'blood', 'quake'] as SiteKind[],
  r: 62, // 2026-11-12 用户「十绝阵需要更大」：40 → 62
  /** 阵台（阵眼的石台）本身的半径：画面用，判定不看它。 */
  dais: 13,
  first: 3.5, // 每一波开始之后多久第一次轮转
  every: 12, // 之后每隔多久轮转一次
  warn: 2, // 预警多久
  on: 8, // 亮多久
  fade: 0.6, // 熄灭（表现层淡出用）
  count: [2, 3] as [number, number], // 一次亮几座
  near: 260, // 挑阵眼时偏向离人物这么近以内的
  // aim：阵里有人时，落点瞄着人的几率（不瞄就落在阵里随便一处）
  thunder: { first: 0.4, every: 1.0, warn: 0.9, r: 15, dmg: 18, aim: 0.75, foe: 30 },
  // 地裂：每 every 秒从阵心（离阵心 r0 起）往外裂 n 道，直到阵边；半宽 hw；一道多半朝着阵里的人
  quake: { first: 0.5, every: 1.8, warn: 1.0, n: 3, r0: 10, hw: 5, dmg: 16, aim: 0.75, foe: 26 },
  // 风：阵里一直往外推 push 像素 / 秒（敌人 foePush）；风刃每 every 秒扫一个张角 arc 的扇面（sweep 秒扫完），扫到的人掉 dmg、被往外吹开（初速 blow）
  wind: { push: 26, foePush: 34, first: 0.6, every: 1.5, warn: 0.9, arc: 2.0, sweep: 0.5, dmg: 8, blow: 170, foe: 14 },
  // 冰锥：每 every 秒冒一圈（rings 里轮着：[离阵心多远, 几根]；同一圈的冰锥半径 r），扎到的人冻得走不快（移速 × (1 − slow)，chill 秒），敌人减速 foeSlow
  ice: { first: 0.4, every: 1.3, warn: 0.95, r: 10, rings: [[[0, 1], [28, 6]], [[50, 10]]] as [number, number][][], dmg: 12, chill: 1.2, slow: 0.35, foe: 20, foeSlow: 0.5 },
  gold: { dmg: 0.25, first: 0.8, every: 1.6, max: 4, rise: 0.45 }, // 法宝伤害 +dmg；阵边每 every 秒冒一只回响兵（这座阵附近最多 max 只），刚冒出来愣 rise 秒
  // 化血：人物每秒掉最大气血的 drain（不吃无敌时间，同魔气）；敌人每 foeEvery 秒掉最大气血的 foe × foeEvery（首领不吃，精英 × elite）
  blood: { drain: 0.03, report: 0.5, foe: 0.08, foeEvery: 0.5, elite: 0.35 },
  // 火柱：每 every 秒在阵里窜起一根（半径 r），落下掉 dmg；之后在原地烧 burn 秒，站在上面每 burnEvery 秒烫 burnDmg（吃无敌时间）；敌人 foe、烧地 foeBurn
  fire: { first: 0.5, every: 0.8, warn: 1.0, r: 13, dmg: 14, aim: 0.6, burn: 2.0, burnEvery: 0.5, burnDmg: 5, foe: 24, foeBurn: 6 },
  // 落魂：站在里面移速 × (1 − slow)、真气每秒流走 qi；魂火每 every 秒从阵边离人最近处冒一团（冒出来前 warn 秒的淡红光），
  // 追着最近的人飘（speed），碰到人掉 dmg 就散；飘 life 秒、或出了阵 leash 像素就散；一座阵同时最多 max 团
  soul: { slow: 0.25, qi: 0.12, first: 0.8, every: 1.9, warn: 0.75, r: 6, speed: 40, life: 3.6, leash: 22, max: 3, dmg: 10 },
  water: { slow: 0.45, drain: 0.04, report: 0.5, enemySlow: 0.4 }, // 人物移速 × (1 − slow)；每秒掉最大气血的 drain；敌人减速 enemySlow
  // 红沙：阵里的人往阵心拖（pull 像素 / 秒；敌人 foePull）、移速 × (1 − slow)；阵心的沙眼（半径 eye）每 every 秒磨一下站在里面的（dmg；敌人 foe）
  sand: { pull: 26, foePull: 36, slow: 0.25, eye: 16, every: 0.7, dmg: 6, foe: 12 },
};

/**
 * 第二章的三种新敌人（血量、速度、体型在 ../config.ts 的 ENEMIES；行为在 ../enemies.ts）。伤害乘敌人身上随波次加强的 dmgMul（同第一章的新敌人）。
 */
export const FOES2 = {
  // 落魂幡手：站在人物 keep 像素外举幡（像术士一样保持距离、横着挪），每 refresh 秒给身边 aura 以内最近的 max 只敌人续上增益：
  // 移速 + haste、受到的伤害 × (1 − ward)，续一次管 hold 秒（幡手死了，增益到时就没了）。自己很脆
  bannerman: { keep: [68, 100] as [number, number], aura: 96, max: 5, haste: 0.35, ward: 0.35, refresh: 0.25, hold: 0.6 },
  // 红沙傀儡：每 every 秒在脚下留一小片红沙（半径 sandR、留 sandLife 秒）；碎了在原地散开一大片（burstR）和几小片。
  // 人物站在红沙上移速 × (1 − slow)；场上的红沙最多 maxPatches 片（多了先收最早的）
  golem: { every: 0.45, sandR: 9, sandLife: 3.2, burstR: 22, burstN: 4, burstLife: 4.5, slow: 0.4, maxPatches: 90 },
  // 风吼妖：贴地快飞，绕到人物侧面 side 像素处；离人物 band 以内、冷却好了就预警 warn 秒（地上亮出冲刺线，线穿过人物再延伸 over），
  // 然后沿线冲过去（speed；2026-11-11 数值平衡 250 → 290，预警不变）；冲过人物身边（半宽 width + 人物半径）把人往线的两侧吹开（push 像素 / 秒，很快衰减），伤害很小
  windfiend: { side: 74, band: [58, 100] as [number, number], warn: 0.6, speed: 290, over: 46, len: [90, 150] as [number, number], width: 6, push: 230, dmg: 4, rest: 0.7, cooldown: 3.2 },
  /**
   * 第二章的出场：第一章的 8 种全都出（比例照 enemies.spawnShares 的第二章算法），再按本章第几波加进这三种；
   * from：本章第几波起出现；share：刚出现那一波占刷怪的比例，之后每波 + per；max：同屏最多几只。三种加起来最多占 cap，
   * 第一章那几种的比例乘 keep 让出位置（回响兵始终有一成多）。
   */
  mix: {
    windfiend: { from: 1, share: 0.07, per: 0.01, max: 8 },
    bannerman: { from: 2, share: 0.05, per: 0.008, max: 4 },
    golem: { from: 3, share: 0.05, per: 0.008, max: 5 },
  } as Record<'bannerman' | 'golem' | 'windfiend', { from: number; share: number; per: number; max: number }>,
  cap: 0.24,
  keep: 0.8,
};

/**
 * 首领「落魂阵主 · 姚天君」（第 12 波；设计见 docs/story/ch2-ch3.md，行为在 yao.ts）。十天君之一，原著里用落魂阵摄去姜子牙的魂魄。
 * 伤害直接写在这里、不乘波次倍率（按第 12 波时人物约 110–140 的气血定，每次挨打约一成到两成）。每一招都先预警（地上的淡红光）。
 *   一阶段（100% → 60%）：落魂幡（插三面幡，幡和他之间连起魂线，碰到魂线定住一下并掉血，打断幡魂线就断）、摄魂铃（一圈圈慢速的魂波，有缺口）；
 *   二阶段（60% → 30%）：草人拜魂（几个草人头顶倒计时，到时没打碎的让人物掉一截血）、十阵齐鸣（一次亮起 5 座阵眼），也照样插幡、摇铃；
 *   三阶段（30% 以下）：落魂化雾（化成魂雾在场上游走、打不到；显形前地上先亮出一大片淡红光，显形时那一片炸开魂波；显形的几秒里摇铃 / 插幡）。
 */
export const YAO = {
  hp: 34000, // 2026-11-11 数值平衡 26000 → 34000（打赢用时中位从 57–102 秒拉到约 95–150 秒）； 比第一章的魔化哪吒（16000）厚，比原来暂用的「第二章魔化哪吒」（36000）薄：他会化雾、有幡和草人替他挡
  phases: [0.6, 0.3], // 气血降到这两个比例时换阶段（一次大伤害也只卡在阈值上）
  intro: 2.0, // 入场：无敌
  phaseTime: 2.2, // 换阶段：无敌
  deathTime: 2.4, // 倒下的表现
  entry: [150, 200] as [number, number], // 入场时离人物多远
  idle: [0, 1.0, 0.75, 0.5], // 两招之间慢慢走多久（按阶段；2026-11-11 1.2 / 0.9 / 0.6 → 1.0 / 0.75 / 0.5：招更密，预警不变）
  walk: [0, 26, 30, 34],
  keep: 96, // 空闲时想站在人物左边或右边多远（和魔化哪吒差不多：再远法宝就够不着了）
  keepY: 40,
  contact: 16,
  /** 每个阶段的招式池（权重）；不会连续两次出同一招。 */
  pool: [{}, { banners: 1, bell: 1 }, { straw: 1.3, formations: 0.8, bell: 1, banners: 0.7 }, { mist: 1.6, bell: 1, banners: 0.6 }] as Record<string, number>[],
  // 落魂幡：在人物身边 dist 像素处插三面幡（幡有血量，打断一面魂线就断）；幡和姚天君之间的魂线先预警 warn 秒，之后连 live 秒（他站着施法）。
  // 人物碰到魂线（离线 r + 人物半径以内）被定住 root 秒、掉 dmg；同一条线隔 rehit 秒才会再打中同一个人
  banners: { n: 3, dist: [62, 82] as [number, number], warn: 1.0, live: 4.2, r: 3, dmg: 18, root: 0.7, rehit: 1.6, hp: 240, recover: 0.6 },
  // 摄魂铃：抬铃摇 warn 秒，然后一圈接一圈往外扩的魂波（count 圈，间隔 gap 秒；二阶段起多一圈），速度 speed，带宽 hw（判定再加人物半径）；
  // 每一圈都有一个缺口（半张角 gapW 弧度），第一圈的缺口偏离人物所在的方向 turn 区间里的一个角度，后面每圈再转一下 —— 从缺口里穿出去
  bell: { warn: 0.85, count: [0, 2, 3, 3], gap: 0.95, speed: 72, hw: 4, r0: 14, rMax: 320, gapW: 0.55, turn: [0.6, 1.3] as [number, number], dmg: 24, recover: 0.5 },
  // 草人拜魂：在人物身边 dist 处立起 n 个草人（各有血量），头顶倒计时 time 秒；到时没打碎的每个让人物掉 dmg（一起算一下）
  straw: { n: 3, dist: [70, 100] as [number, number], cast: 0.9, time: 8, hp: 320, dmg: 13, recover: 0.6 },
  // 十阵齐鸣：抬手 cast 秒后，一次亮起 n 座阵眼（地形照常先预警）
  formations: { cast: 1.0, n: 5, recover: 0.6 },
  // 落魂化雾：化成魂雾游走 roam 秒（打不到），停在离人物 near 像素处；先在那里亮 warn 秒的淡红光（半径 r），然后显形、那一片炸开魂波（dmg）
  mist: { roam: 2.3, speed: 96, near: [54, 76] as [number, number], warn: 1.1, r: 80, dmg: 30, recover: 0.4 },
  // 首领波不按时刷小怪，只零星刷一点回响兵（让神通充得起来）
  summon: { first: 6, every: [0, 7, 6, 5], n: 2, max: 7, out: [4, 40] as [number, number] },
};
