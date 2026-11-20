// 第三章的状态与事件类型（纯数据：数字、字符串、数组、普通对象，整局存档能原样存下）。行为在 terrain.ts、zhuxian.ts、foes.ts。

// ---------- 地形「四剑轮斩」 ----------

/** line 直线：剑气从剑台沿一条直线斩过整个场地；fan 扇形：剑气以剑台为圆心扫过一道扇面。 */
export type CutKind = 'line' | 'fan';

/**
 * 一道剑气：先在地上亮出路径 warn 秒（不伤人），再斩出去 live 秒，然后消失。几何都在地面高度（脚底）：
 *  - line：线段 (x0, y0)（剑台）→ (x1, y1)，半宽 r（判定再加人物半径）；剑气的头从起点以 SWORDS.line.speed 往终点走，
 *    head 是头离起点多远（prev 是上一帧的），扫过的那一小段里的人挨打；
 *  - fan：圆心 (x0, y0)（剑台）、半径 rad，从角 a0 朝 dir 方向扫过 arc；head 是扫过了多少角度（0..arc，prev 是上一帧的）。
 * hit[i]：第 i 个人被这一道打中的时刻（w.time；-1 = 没有）——每道剑气对每个人只打一次；foes：斩过的敌人（每只只斩一次）。
 * pair：交叉斩时同时出鞘的另一道的 id（-1 = 单斩）。
 */
export interface SwordCut {
  id: number;
  sword: number; // 哪一把剑（SWORDS.altars 的下标）
  kind: CutKind;
  t: number;
  warn: number;
  live: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  rad: number;
  a0: number;
  arc: number;
  dir: 1 | -1;
  head: number;
  prev: number;
  dmg: number;
  hit: number[];
  foes: number[];
  pair: number;
}

export interface SwordTerrain {
  kind: 'swords';
  next: number; // 距下一次出鞘
  order: number[]; // 出鞘的先后（四把剑洗过的顺序，用完再洗；不连着两次是同一把）
  last: number; // 上一次出鞘的是哪一把（-1 = 还没有）
  round: number; // 这一波出鞘了几轮
  cuts: SwordCut[];
}

/** 四剑轮斩的事件（terrain.ts 发出；表现层据此画剑出鞘、路径的淡红光、剑气斩过、回鞘）。 */
export type SwordEvent =
  // 一把剑出鞘、地上亮出剑气的路径（几何在 w.terrain.cuts 里按 id 查），t2 秒后斩出去；pair 是同时出鞘的另一道（-1 = 没有）
  | { t: 'swordWarn'; id: number; sword: number; kind: CutKind; x: number; y: number; t2: number; pair: number }
  // 剑气斩出去
  | { t: 'swordCut'; id: number; sword: number; kind: CutKind; x: number; y: number }
  // 斩完，剑回到台上
  | { t: 'swordHome'; id: number; sword: number };

// ---------- 三种新敌人 ----------

/**
 * 第三章新敌人的事件（foes.ts 发出）。线段都在地面高度（脚底），(x0, y0) → (x1, y1)，r 是判定半宽（已经加上人物半径）。
 * 截教门徒掷出的剑气是 w.orbs 里 kind 'qi' 的弹道（会拐弯），阵图傀儡之间的剑气线是持续的状态（Enemy.mate），表现层每帧读。
 */
export type Ch3FoeEvent =
  // 飞剑灵瞄准了：地上亮出射来的直线（定下就不跟踪），t2 秒后射出
  | { t: 'flyAim'; id: number; x0: number; y0: number; x1: number; y1: number; r: number; t2: number }
  // 飞剑灵沿线射过去（dur 秒射完，射空了掉头再来）
  | { t: 'flyShot'; id: number; x0: number; y0: number; x1: number; y1: number; dur: number }
  // 截教门徒抬手（t2 秒后掷出剑气）
  | { t: 'qiCast'; id: number; x: number; y: number; t2: number }
  // 截教门徒掷出一道剑气（orb 是 w.orbs 里那一道的 id）
  | { t: 'qiThrow'; id: number; orb: number; x: number; y: number }
  // 阵图傀儡两只一组：之间连起剑气线（a、b 是两只的 id）
  | { t: 'tetherOn'; a: number; b: number }
  // 打掉其中一只，剑气线断了（在两只最后的位置之间迸开）
  | { t: 'tetherCut'; a: number; b: number; x0: number; y0: number; x1: number; y1: number };

// ---------- 首领「诛仙剑灵」 ----------

/**
 * ring 四剑环斩；rain 剑雨；split 一剑化四；walls 四剑归阵；rush 连续突进（三阶段）。
 * 三阶段一进来另有「诛仙」：剑阵从四面往中间收拢（ZhuxianFight.close，不占招式）。
 */
export type ZhuxianMove = 'ring' | 'rain' | 'split' | 'walls' | 'rush';
/** intro 入场；idle 两招之间；cast 出招；recover 收招；phase 换阶段；dead 倒下的表现。 */
export type ZhuxianState = 'intro' | 'idle' | 'cast' | 'recover' | 'phase' | 'dead';
/**
 * arc 四剑环斩的一斩（扇形横扫）；cell 剑雨的一格（方格）；lane 剑影放出的一道剑气直线；wall 四剑归阵的剑气墙（会转）；dash 突进。
 */
export type ZxHazardKind = 'arc' | 'cell' | 'lane' | 'wall' | 'dash';

/**
 * 一个危险物：先预警 warn 秒（不伤人），再生效 live 秒，然后消失。几何都在地面高度（脚底）：
 *  - arc：圆心 (x0, y0)、半径 rad，从角 a0 朝 dir 方向扫过 arc（head 是扫过了多少，prev 是上一帧的）；src 是第几把剑（0..3）；
 *  - cell：中心 (x0, y0)、半边长 r 的方格（人物脚下落进格子里就挨打）；
 *  - lane：线段 (x0, y0) → (x1, y1)、半宽 r（判定再加人物半径）；剑气的头从起点往终点走（head / prev 同 SwordCut）；src 是谁放的（0 本体，1..3 剑影）；
 *  - wall：过 (x0, y0)（转轴）朝 a0 方向的一整条直线（两头都伸到场外），半宽 r；生效期间以 dir × ZHUXIAN.walls.spin 弧度 / 秒转动（a0 跟着变）；
 *  - dash：首领本体沿线段 (x0, y0) → (x1, y1) 突进，半宽 r；head 是他冲到哪。
 * hit[i]：第 i 个人上一次被它打中的时刻（w.time；-1 = 没有）——剑气墙隔一会儿能再打中，别的每个人只打一次。
 */
export interface ZxHazard {
  id: number;
  kind: ZxHazardKind;
  src: number;
  t: number;
  warn: number;
  live: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  rad: number;
  a0: number;
  arc: number;
  dir: 1 | -1;
  head: number;
  prev: number;
  dmg: number;
  hit: number[];
}

/** 一剑化四的剑影：打不到，不进 w.enemies；先滑到人物四角之一，再轮流放剑气，放完就散。 */
export interface ZxShadow {
  src: number; // 1..3
  x: number;
  y: number;
  px: number;
  py: number;
  sx: number; // 滑出去的起点与终点
  sy: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
}

/**
 * 「诛仙」（三阶段）：剑阵从四面往中间收拢——以场心为中心的一圈剑气（椭圆，半径 rx × ry），每隔一阵往里收一步；
 * 圈外是剑气，站在外面持续掉血（按最大气血的百分比，不吃无敌时间，同魔气）。step 收到第几步；next 距下一步；
 * warned 这一步的预警发过没有；t 正在收（-1 = 没在收）；from / to 这一步从哪收到哪（rx，ry 按场地的长宽比跟着）。
 * drain / drainT：每个人（按 id）还没报出去的掉血和攒了多久。
 */
export interface ZxClose {
  on: boolean;
  step: number;
  next: number;
  warned: boolean;
  t: number;
  from: number;
  to: number;
  rx: number;
  ry: number;
  drain: number[];
  drainT: number[];
}

export interface ZhuxianFight {
  kind: 'zhuxian';
  id: number; // 本体在 w.enemies 里的 id
  /** true = 来遭遇战（首领池，bosspool.ts：状态在 w.echo，两个阶段、剑阵不收、不刷回响兵、波末退走）；false = 当这一章的首领。 */
  guest: boolean;
  chapter: number;
  phase: number;
  state: ZhuxianState;
  t: number;
  lt: number;
  dur: number;
  move: ZhuxianMove | null;
  last: ZhuxianMove | null;
  again: boolean; // 上一招是连着出的第二次（三阶段的突进最多连两次）
  queue: ZhuxianMove[]; // 指定接下来出哪几招（测试、截图用；空了就按招式池随机）
  facing: 1 | -1;
  moving: boolean;
  hazards: ZxHazard[];
  shadows: ZxShadow[];
  slide: { sx: number; sy: number; tx: number; ty: number } | null; // 一剑化四时本体滑去的位置
  fire: number[]; // 一剑化四：四个（本体 0、剑影 1..3）放剑气的先后
  spin: 1 | -1; // 四剑环斩：四把剑绕着他转的方向
  mark: { x: number; y: number } | null; // 剑雨：格子的中心（人物出招时的位置，第二拨照这个摆）
  rush: number; // 连续突进：已经冲了几次
  cue: number; // 招式脚本自己的计时 / 角度（四剑环斩：第一斩的中线；连续突进：距下一次瞄准）
  close: ZxClose;
  summonT: number;
  deadAt: { x: number; y: number } | null;
}

/** 诛仙剑灵的事件（zhuxian.ts 发出；入场、换阶段、倒下、起招用 boss.ts 的通用事件 bossIntro / bossPhase / bossDeath / bossMove）。 */
export type ZhuxianEvent =
  // 一个危险物开始预警 / 开始伤人（几何在 w.boss.hazards 里按 hazard 查）
  | { t: 'zxCast'; id: number; hazard: number; kind: ZxHazardKind; src: number; x: number; y: number }
  | { t: 'zxStrike'; id: number; hazard: number; kind: ZxHazardKind; src: number; x: number; y: number }
  // 一剑化四：分出三个剑影（滑向四角）；剑影散去
  | { t: 'zxSplit'; id: number; x: number; y: number }
  | { t: 'zxMerge'; id: number; x: number; y: number }
  // 四剑归阵：四角的剑台同时亮起
  | { t: 'zxAltars'; id: number; t2: number }
  // 诛仙：剑阵马上要再往里收一步（step 是第几步，rx / ry 是收完之后的半径）；开始收
  | { t: 'zxCloseWarn'; step: number; rx: number; ry: number }
  | { t: 'zxClose'; step: number; rx: number; ry: number }
  // 站在剑阵外面持续掉的血（攒够 report 秒报一次）
  | { t: 'zxDrain'; owner: number; x: number; y: number; dmg: number };
