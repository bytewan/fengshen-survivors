// 第二章的状态与事件类型（纯数据：数字、字符串、数组、普通对象，整局存档能原样存下）。行为在 terrain.ts、yao.ts、../enemies.ts。

// ---------- 地形「十阵轮转」 ----------

/**
 * 十绝阵（原著的十阵，每座阵台固定是其中一座，见 config.TEN.kinds）：
 *  thunder 天绝阵（落雷）、quake 地烈阵（裂地喷岩火）、wind 风吼阵（风刃绕阵、往外推）、ice 寒冰阵（一圈圈冒冰锥）、gold 金光阵（加伤、冒兵），
 *  blood 化血阵（血雾，人和敌人都掉血）、fire 烈焰阵（火柱、留火烧地）、soul 落魂阵（魂火追人、真气流走、走得慢）、
 *  water 红水阵（减速掉血）、sand 红沙阵（沙暴往阵心拖、沙眼磨人）。
 */
export type SiteKind = 'thunder' | 'quake' | 'wind' | 'ice' | 'gold' | 'blood' | 'fire' | 'soul' | 'water' | 'sand';

/** 一座阵眼（位置在 config.TEN.sites[i]，半径 TEN.r，种类 TEN.kinds[i]）。 */
export interface Site {
  kind: SiteKind | null; // 正在预警 / 亮着的是哪一种（熄着是 null）
  state: 'off' | 'warn' | 'on';
  t: number; // 进入当前状态多久了
  dur: number; // 当前状态打算多久（预警 TEN.warn、亮 TEN.on）
  tick: number; // 距下一次出招（天雷、裂地、风刃、冰锥、火柱、魂火、回响兵；化血阵：距下一次结算敌人掉血）
  n: number; // 亮起来之后出了几招（寒冰阵按它轮换内圈 / 外圈；风刃按它换方向）
}

/**
 * 阵里出的一招（纯数据）：先在地上亮 warn 秒的淡红光（不伤人），然后生效 live 秒（0 = 一下就完），然后消失。几何都在地面高度（脚下）：
 *  - bolt 天雷 / spike 冰锥 / pillar 火柱：圆，圆心 (x, y)、半径 r；火柱落下后在原地烧 live 秒（每隔 every 秒烫一下站在上面的）；
 *  - fissure 地裂：线段 (x, y) → (x1, y1)，半宽 r；
 *  - gust 风刃：以阵心 (x, y) 为圆心、半径 r 的扇面，从角 a0 朝 dir 扫过 arc（live 秒扫完；刃扫过的人挨一下、被往外吹开）；
 *  - wisp 魂火：圆心 (x, y) 会动（追着最近的人），半径 r；碰到人就散；
 *  - eye 沙眼：红沙阵的阵心，圆，亮着期间一直在（每隔 every 秒磨一下站在里面的）。
 * hit[i]：第 i 个人上一次被它打中的时刻（w.time；-1 = 没有）；foes：打过的敌人 id（一次性的招每只敌人只吃一下）。
 */
export type StrikeKind = 'bolt' | 'fissure' | 'gust' | 'spike' | 'pillar' | 'wisp' | 'eye';
export interface Strike {
  id: number;
  site: number;
  kind: StrikeKind;
  x: number;
  y: number;
  x1: number;
  y1: number;
  r: number;
  a0: number;
  arc: number;
  dir: 1 | -1;
  t: number; // 出现了多久（预警 + 生效）
  warn: number;
  live: number;
  every: number; // 持续的招（火柱烧地、沙眼）：隔多久再打中同一个人 / 同一只敌人
  hit: number[];
  foes: number[];
  foeT: number; // 持续的招：距下一次结算敌人
}

export interface TenTerrain {
  kind: 'ten';
  sites: Site[];
  next: number; // 距下一次轮转
  strikes: Strike[];
  drain: number[]; // 每个玩家（按 id）红水 / 化血里还没报出去的掉血
  drainT: number[]; // 距上一次报了多久
  chill: number[]; // 每个玩家被冰锥冻得走不快，还剩多久
}

/** 第二章地形的事件（terrain.ts 发出；表现层据此画阵亮起、出招、阵边冒兵）。site 是阵眼的编号（TEN.sites 的下标）。 */
export type TerrainEvent =
  | { t: 'siteWarn'; site: number; kind: SiteKind; t2: number } // 阵要亮了：阵旗猎猎、地纹渐亮，t2 秒后亮起
  | { t: 'siteOn'; site: number; kind: SiteKind; dur: number }
  | { t: 'siteOff'; site: number; kind: SiteKind }
  | { t: 'tenWarn'; id: number; site: number; kind: StrikeKind; x: number; y: number; t2: number } // 一招的预警亮起（几何在 w.terrain.strikes 里按 id 查）
  | { t: 'tenStrike'; id: number; site: number; kind: StrikeKind; x: number; y: number; x1: number; y1: number; r: number } // 预警到时，这一招落下 / 喷出 / 扫起来
  | { t: 'tenFade'; id: number; site: number; kind: StrikeKind; x: number; y: number } // 一招完了（魂火碰到人散了、火烧完了、沙眼收了）
  | { t: 'siteSpawn'; site: number; id: number; x: number; y: number } // 金光阵边冒出一只回响兵（另有 spawn 事件）
  | { t: 'drain'; owner: number; x: number; y: number; dmg: number; kind?: 'water' | 'blood' }; // 红水 / 化血里持续掉的血（攒够 report 秒报一次）

// ---------- 三种新敌人 ----------

/**
 * 第二章新敌人的事件（enemies.ts 发出）。线段都在地面高度（脚底），(x0, y0) → (x1, y1)，r 是判定半宽（已经加上人物半径）。
 * 落魂幡手的魂光、红沙傀儡留下的红沙是持续的状态（Enemy.links、World.patches），表现层每帧读，不发事件。
 */
export type Ch2FoeEvent =
  // 风吼妖要冲了：地上亮出冲刺线（定下就不跟踪），t2 秒后冲
  | { t: 'windWarn'; id: number; x0: number; y0: number; x1: number; y1: number; r: number; t2: number }
  // 风吼妖沿线冲过去（dur 秒冲完）
  | { t: 'windDash'; id: number; x0: number; y0: number; x1: number; y1: number; dur: number }
  // 人物被风吼妖吹开：(vx, vy) 是吹开的初速度
  | { t: 'blown'; owner: number; id: number; x: number; y: number; vx: number; vy: number }
  // 红沙傀儡碎了，在 (x, y) 散开半径 r 的一片红沙
  | { t: 'sandBurst'; id: number; x: number; y: number; r: number };

// ---------- 首领「落魂阵主 · 姚天君」 ----------

/** banners 落魂幡；bell 摄魂铃；straw 草人拜魂；formations 十阵齐鸣；mist 落魂化雾（三阶段）。 */
export type YaoMove = 'banners' | 'bell' | 'straw' | 'formations' | 'mist';
/** intro 入场；idle 两招之间；cast 出招（含施法、化雾游走）；recover 收招；phase 换阶段；dead 倒下的表现。 */
export type YaoState = 'intro' | 'idle' | 'cast' | 'recover' | 'phase' | 'dead';
/** line 魂线（幡和他之间）；wave 魂波（一圈往外扩、有缺口）；burst 显形时那一片炸开的魂波（圆）。 */
export type YaoHazardKind = 'line' | 'wave' | 'burst';

/**
 * 一个危险物：先预警 warn 秒（不伤人），再生效 live 秒，然后消失。几何都在地面高度（脚底）：
 *  - line：线段 (x0, y0)（幡脚）→ (x1, y1)（他脚下），半宽 r（判定再加人物半径）；flag 是那面幡（敌人 id），幡倒了线就断；
 *  - wave：圆心 (x0, y0)，现在的半径 rad（上一帧 prad），带宽半宽 r（判定再加人物半径）；缺口在 gapA 方向、半张角 gapW；
 *  - burst：圆心 (x0, y0)、半径 r（量到人物脚下）。
 * hit[i]：第 i 个人上一次被它打中的时刻（w.time；-1 = 没有）——魂线隔一会儿能再打中，魂波、炸开每个人只打一次。
 */
export interface YaoHazard {
  id: number;
  kind: YaoHazardKind;
  t: number;
  warn: number;
  live: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  flag: number;
  gapA: number;
  gapW: number;
  rad: number;
  prad: number;
  dmg: number;
  hit: number[];
}

export interface YaoFight {
  kind: 'yao';
  id: number; // 本体在 w.enemies 里的 id
  /** true = 来遭遇战（首领池，bosspool.ts：状态在 w.echo，两个阶段、不刷回响兵、波末退走）；false = 当这一章的首领。 */
  guest: boolean;
  chapter: number;
  phase: number;
  state: YaoState;
  t: number;
  lt: number;
  dur: number;
  move: YaoMove | null;
  last: YaoMove | null;
  queue: YaoMove[]; // 指定接下来出哪几招（测试、截图用；空了就按招式池随机）
  facing: 1 | -1;
  moving: boolean;
  hazards: YaoHazard[];
  flags: number[]; // 场上的落魂幡（敌人 id）
  straws: number[]; // 场上的草人（敌人 id；倒计时在敌人的 actT / actLen 上）
  hidden: boolean; // 化成了魂雾（打不到、不接触伤人）
  roam: { a: number; d: number } | null; // 化雾游走：停在人物的哪个方向、多远
  summonT: number;
  deadAt: { x: number; y: number } | null;
}

/** 姚天君的事件（yao.ts 发出；入场、换阶段、倒下、起招用 boss.ts 的通用事件 bossIntro / bossPhase / bossDeath / bossMove）。 */
export type YaoEvent =
  // 一个危险物开始预警 / 开始伤人（几何在 w.boss.hazards 里按 hazard 查）
  | { t: 'yaoCast'; id: number; hazard: number; kind: YaoHazardKind; x: number; y: number }
  | { t: 'yaoStrike'; id: number; hazard: number; kind: YaoHazardKind; x: number; y: number }
  // 插下一面落魂幡（flag 是幡的敌人 id）
  | { t: 'yaoFlag'; id: number; flag: number; x: number; y: number }
  // 幡被打断，魂线断了
  | { t: 'yaoLineBreak'; id: number; hazard: number; flag: number; x: number; y: number }
  // 立起草人（ids），头顶倒计时 t2 秒
  | { t: 'yaoStraw'; id: number; ids: number[]; t2: number }
  // 倒计时到了：没打碎的草人（ids）让人物 owner 掉了 dmg 的血（被闪避 / 护盾挡下时 dmg 是 0）
  | { t: 'yaoCurse'; id: number; ids: number[]; owner: number; dmg: number; x: number; y: number }
  // 化成魂雾（vanish）/ 显形（appear）
  | { t: 'yaoMist'; id: number; act: 'vanish' | 'appear'; x: number; y: number }
  // 人物碰到魂线被定住 t2 秒
  | { t: 'yaoRoot'; owner: number; x: number; y: number; t2: number };
