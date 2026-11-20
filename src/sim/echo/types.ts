// 回响化身遭遇战的状态与事件类型（纯数据：数字、字符串、数组、普通对象，整局存档能原样存下）。行为在 index.ts、zhao.ts、yunxiao.ts。
// 遭遇战是「和刷怪并存的一只敌人」：本体是 w.enemies 里一只 kind 'boss' 的敌人（法宝照常先找它、不吃控制、移动和接触伤害由这里管），
// 打法的状态放在 World.echo。首领池（bosspool.ts）之后，回响这一族也能当章节首领：同一种状态放在 World.boss（guest: false，三个阶段）。
import type { BossId } from '../bosspool.ts';

/** 回响这一族里的哪一位：zhao 回响赵公明（第二章的池子）、yunxiao 回响云霄（第三章的池子）、aobing 回响敖丙（第一章的池子）。都是 bosspool.BossId 里的名字。 */
export type EchoKind = 'zhao' | 'yunxiao' | 'aobing';

/**
 * 招式。回响赵公明：beads 定海珠砸地（几颗珠子砸在你脚下和身边）、whip 金鞭裂地（一条直线，二阶段两条交叉）、
 * tiger 黑虎扑吼（虎影沿线扑过来，扑到尽头吼一声震开一圈）、rosary 二十四珠（二阶段：一圈珠子围着你依次砸下，最后整圈一起再震）。
 * 回响云霄：dou 混元金斗（斗悬在头顶，把人往斗下吸，片刻后扣下）、river 九曲黄河（脚下翻起旋涡，一阵阵冲刷）、
 * luan 青鸾掠过（一条直线）、formation 黄河阵（二阶段：几处旋涡同时翻起）。
 * 当章节首领时才有的第三阶段：storm 珠落如雨（回响赵公明：定海珠一阵接一阵追着人砸；危险物记成 beads，画面照定海珠）、
 * jiuqu 九曲黄河（回响云霄：旋涡沿一条九曲的线一处接一处翻起；危险物记成 river，画面照九曲黄河）。
 * 回响敖丙（aobing.ts）：ji 画戟连刺（直线，二阶段起连刺几下、每一下重新瞄）、icelong 冰龙（冰龙沿线游过去，到尽头炸开一片冰；二阶段起那一片结成冰面）、
 * tide 海浪（几道并排的浪头从他身后推过来，当中空着一道——站进空的那一道）、hualong 化龙（二阶段：化成白龙沿线冲过去，一连几趟，本体跟着走）、
 * tsunami 怒潮（当首领的三阶段：三面的浪一阵接一阵推过来）。
 */
export type EchoMove = 'beads' | 'whip' | 'tiger' | 'rosary' | 'storm' | 'dou' | 'river' | 'luan' | 'formation' | 'jiuqu' | 'ji' | 'icelong' | 'tide' | 'hualong' | 'tsunami';

/**
 * 一个危险物：先预警 warn 秒（不伤人），再生效 live 秒（会伤人），然后消失。判定都按人物脚下算（脚下落进范围就挨打；
 * 表现层的淡红光就画这个范围，不再加人物的身子）：
 *  - disk：以 (x0, y0) 为圆心、半径 r 的圆；生效时打一次（live 很短）。旋涡（river）的生效期长，每 tick 秒打一次（hits 清零重来）。
 *  - lane：(x0, y0) → (x1, y1) 的一条线，半宽 r；生效时打一次。
 *  - pounce：黑虎沿 (x0, y0) → (x1, y1) 扑过去（生效的 live 秒里虎影从起点跑到终点，(x, y) 是它现在的位置），撞到的挨一下。
 *  - pull：混元金斗：(x0, y0) 为中心、半径 r 的吸力范围；预警期间（斗悬着）就往中心吸（pull 像素 / 秒），生效时扣下，
 *    只打中心 core 半径以内的（所以要顶着吸力往外走）。
 * dmg：打一下多少（已乘倍率）；kb：把人往外推开的初速度（像素 / 秒，0 = 不推）；hits：这一下已经打中过哪些人（按位）。
 */
export interface EchoHazard {
  id: number;
  kind: 'disk' | 'lane' | 'pounce' | 'pull';
  move: EchoMove;
  t: number; // 从开始预警算起过了多久
  warn: number;
  live: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  x: number;
  y: number;
  px: number;
  py: number;
  dmg: number;
  kb: number;
  hits: number;
  tick?: number; // 旋涡：每隔多久冲刷一次
  next?: number; // 旋涡：距下一次冲刷
  core?: number; // 混元金斗：扣下时打中的半径
  pull?: number; // 混元金斗：吸力
  seq?: number; // 二十四珠：第几颗（表现层排先后）
  quake?: boolean; // 二十四珠：最后整圈一起再震的那一下
  ice?: boolean; // 冰龙：炸开之后留下的那片冰面（表现层画冰，不画黄河水）
}

/** intro 现身（无敌）；idle 两招之间（慢慢走近）；cast 出招（含预警）；recover 收招；phase 换阶段（无敌）；dead 倒下的表现（不再出招）。 */
export type EchoState = 'intro' | 'idle' | 'cast' | 'recover' | 'phase' | 'dead';

export interface EchoFight {
  kind: EchoKind;
  id: number; // 本体在 w.enemies 里的 id（kind 'boss' 的敌人）
  /** true = 遭遇战（状态在 World.echo：两个阶段、波末退走）；false = 这一章的首领（World.boss：三个阶段、倒下后本章平定）。 */
  guest: boolean;
  chapter: number;
  wave: number; // 哪一波来的（不带进下一波）
  phase: number; // 1..2（当首领时 1..3）
  state: EchoState;
  t: number; // 进入当前状态多久了
  lt: number; // 上一帧的 t（招式按时间点触发用）
  dur: number; // 当前状态打算持续多久
  move: EchoMove | null;
  last: EchoMove | null;
  queue: EchoMove[]; // 指定接下来出哪几招（测试、截图用；空了就按招式池随机）
  facing: 1 | -1;
  moving: boolean; // 这一帧在走路（表现层换走路帧）
  mul: number; // 伤害倍率（劫数）
  hazards: EchoHazard[];
  /** 回响赵公明的黑虎：扑之前在他身边现形（表现层画虎影），扑完散掉。null = 不在场上。 */
  tiger: { x: number; y: number; px: number; py: number; facing: 1 | -1 } | null;
  /** 一连几下的招式（敖丙的连刺、化龙、怒潮）做到第几下了。 */
  step: number;
  /** 本体正跟着哪一个危险物走（敖丙化龙：白龙沿线冲的那一趟；表现层这时画龙、不画人）。null = 没有。 */
  ride: number | null;
  /** 当首领时：距下一次零星刷回响兵还有多久（首领波不按时刷怪，同别的首领）。 */
  summonT: number;
  /** 当首领时：倒下的位置（表现层画跪着的他，等战后对白放完再散）。 */
  deadAt: { x: number; y: number } | null;
}

/**
 * 遭遇战的事件。x / y 都是地面高度。
 * 这四个是**遭遇战的流程**，池里的每一位来遭遇战时都发（kind 是 bosspool.BossId；当首领时发的是 bossIntro / bossPhase / bossDeath）：
 * echoIntro 现身；echoPhase 换阶段；echoLeave 这一波结束还没打倒：退走（这一局不解锁）；
 * echoDefeat 打倒了（unlock 是存档里解锁的 id，没有可玩版的是 ''；表现层写进存档、放解锁卡）。
 * 这三个是回响这一族自己的招式（两种打法都发）：echoMove 一招起手；echoCast 一个危险物开始预警；echoStrike 预警结束、开始伤人。
 */
export type EchoEvent =
  | { t: 'echoIntro'; id: number; kind: BossId; x: number; y: number }
  | { t: 'echoMove'; id: number; kind: EchoKind; move: EchoMove; x: number; y: number }
  | { t: 'echoCast'; id: number; hazard: number; move: EchoMove; shape: EchoHazard['kind']; x: number; y: number }
  | { t: 'echoStrike'; id: number; hazard: number; move: EchoMove; shape: EchoHazard['kind']; x: number; y: number }
  | { t: 'echoPhase'; id: number; kind: BossId; phase: number; x: number; y: number }
  | { t: 'echoLeave'; id: number; kind: BossId; x: number; y: number; facing: 1 | -1; hp: number } // hp：退走时还剩的气血（比例）
  | { t: 'echoDefeat'; id: number; kind: BossId; x: number; y: number; facing: 1 | -1; unlock: string };
