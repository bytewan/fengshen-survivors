// 模拟层共用的类型。纯数据，不含逻辑。
import type { BossEvent } from './boss.ts';
import type { Ch2FoeEvent, TerrainEvent, YaoEvent } from './ch2/types.ts';
import type { Ch3FoeEvent, SwordEvent, ZhuxianEvent } from './ch3/types.ts';
import type { EchoEvent } from './echo/types.ts';
import type { EliteAct, EliteAffix, EliteCall, EliteEvent, EliteKind } from './elites/types.ts';

export type { EliteAffix, EliteKind } from './elites/types.ts';

export type Element = 'metal' | 'wood' | 'water' | 'fire' | 'earth';
export const ELEMENTS: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];
export const ELEMENT_NAME: Record<Element, string> = { metal: '金', wood: '木', water: '水', fire: '火', earth: '土' };

export type EnemyKindName = 'soldier' | 'elite' | 'caster' | 'boss' | FoeKind | BossSummon;
/** 首领召出来、不会动也不伤人的东西（有血量、法宝打得到）：soulflag 姚天君的落魂幡、strawman 草人。 */
export type BossSummon = 'soulflag' | 'strawman';
/**
 * 第一章新加的敌人（行为见 enemies.ts，数值见 config.ts 的 ENEMIES 与 FOES）：
 * spearman 回响矛卒（停在近处蓄力刺击）、shieldbearer 玄符盾卫（正面减伤）、cavalry 阴马骁骑（预警后直线冲锋）、
 * bomber 爆符鬼（贴近点燃引信后自爆）、splitter 分魂鬼（死时分成两只）、splitling 分魂鬼分出来的小鬼（不再分）。
 */
export type FoeKind = 'spearman' | 'shieldbearer' | 'cavalry' | 'bomber' | 'splitter' | 'splitling' | Ch2FoeKind | Ch3FoeKind;
/**
 * 第二章新加的敌人（行为见 enemies.ts，数值见 config.ts 的 ENEMIES 与 sim/ch2/config.ts 的 FOES2）：
 * bannerman 落魂幡手（给身边的敌人加移速和护体，自己很脆）、golem 红沙傀儡（慢、厚，走过的地方留红沙减速，碎了散一片红沙）、
 * windfiend 风吼妖（贴地快飞、绕到侧面，有预警的短冲刺把人吹开）。
 */
export type Ch2FoeKind = 'bannerman' | 'golem' | 'windfiend';
/**
 * 第三章新加的敌人（行为见 sim/ch3/foes.ts，数值见 config.ts 的 ENEMIES 与 sim/ch3/config.ts 的 FOES3）：
 * flysword 飞剑灵（悬空的小飞剑，瞄准后直线射来，射空了掉头再来）、disciple 截教门徒（远程，掷出会拐弯的慢速剑气）、
 * puppet 阵图傀儡（两只一组，之间一条剑气线，线扫到人伤人，打掉一只线就断）。
 */
export type Ch3FoeKind = 'flysword' | 'disciple' | 'puppet';
/**
 * 新敌人正在做什么（可省略 = 平常走动）：windup 蓄力 / 预警（长矛兵、骑兵）；strike 出手（刺出、冲锋）；
 * rest 收招喘息；fuse 引信点燃（自爆鬼，期间打不死、不吃控制）。精英自己的几个动作（夜叉潜水、力士举旗）见 elites/types.ts 的 EliteAct。
 */
export type FoeAct = 'windup' | 'strike' | 'rest' | 'fuse' | EliteAct;
/**
 * 能选的角色（角色表在 catalog.HEROES；神通、被动按角色分派在 sim/heroes/，宠物按种类分派在 sim/pet.ts）。第一行是基础角色（雷震子 2026-11-11 起）。
 * 第二行是「回响化身」（变异角色，打败对应的首领 / 遭遇战才解锁，解锁的 id 见 catalog.ECHO）：mozha 魔化哪吒、huizhao 回响赵公明、huiyun 回响云霄。
 * 第三行的 wukong 是隐藏角色孙悟空（通关一次后标题页天上的金色裂缝里掉下来才解锁，解锁的 id 见 catalog.HIDDEN）。
 */
export type HeroId = 'nezha' | 'yangjian' | 'zhao' | 'yunxiao' | 'leizhenzi'
  | 'mozha' | 'huizhao' | 'huiyun'
  | 'huiao' // 回响敖丙（第一章首领池里的敖丙，打倒解锁；他不是谁的换色：法宝、神通、被动、宠物都是自己的，sim/heroes/huiao.ts）
  | 'wukong';
/** 神通：santou 哪吒「三头六臂」；gaze 杨戬「天眼」；jinbian 赵公明「金鞭」；huanghe 云霄「九曲黄河」；fenglei 雷震子「风雷翅」；tujin 魔化哪吒「火尖枪突进」；dingtou 回响赵公明「钉头七箭」；xueding 回响云霄「黄河阵 · 削顶」；faxiang 孙悟空「法天象地」。 */
export type SkillId = 'santou' | 'gaze' | 'jinbian' | 'huanghe' | 'fenglei' | 'tujin' | 'dingtou' | 'xueding'
  | 'hualong' // 回响敖丙「化龙」
  | 'faxiang';
/** 宠物的种类：huntian 哪吒 · 混天绫；xiaotian 杨戬 · 哮天犬；heihu 赵公明 · 黑虎；qingluan 云霄 · 青鸾；leipeng 雷震子 · 雷鹏；maohou 孙悟空 · 毫毛猴。回响化身的宠物用本人的种类、只换颜色。 */
export type PetKind = 'huntian' | 'xiaotian' | 'heihu' | 'qingluan' | 'leipeng'
  | 'bishui' // 回响敖丙 · 避水兽（pets/bishui.ts）
  | 'maohou';

/**
 * 法宝种类：哪吒的专属乾坤圈 + 公共法宝。
 * 第二行是剩下的 8 件公共法宝（打神鞭、化血神刀、定风珠、青莲宝色旗、阴阳镜、玄元控水旗、五火七禽扇、捆仙绳）：
 * 画面在 game/fx-new.ts，都已进商店（以后再加画面没做完的新法宝，标 WeaponDef.wip 先不进商店）。
 */
export type WeaponKind = 'qiankun' | 'huojian' | 'jiulong' | 'leigong' | 'fantian' | 'xinghuang' | 'zhanxian' | 'hanbing'
  | 'dashen' | 'huaxue' | 'dingfeng' | 'qinglian' | 'yinyang' | 'xuanyuan' | 'wuhuo' | 'kunxian'
  | 'sanjian' | 'dinghai' // 第三行是别的角色的专属法宝：杨戬 · 三尖两刃刀（出手在 sim/heroes/yangjian.ts，画面在 game/heroes/sanjian-fx.ts）；
  // 赵公明 · 定海珠（出手在 sim/heroes/zhao.ts，画面在 game/heroes/dinghai-fx.ts）
  | 'jindou' // 云霄 · 混元金斗（出手在 sim/heroes/yunxiao.ts，画面在 game/heroes/dou-fx.ts）
  | 'huangjin' // 雷震子 · 黄金棍（出手在 sim/heroes/leizhenzi.ts，画面在 game/heroes/staff-fx.ts）
  | 'heiyan' | 'fulong' | 'qiankuntu' // 第四行是回响化身的专属法宝：魔化哪吒 · 黑焰轮（出手在 sim/heroes/mozha.ts，画面在 game/heroes/heiyan-fx.ts）；
  // 回响赵公明 · 缚龙索（sim/heroes/huizhao.ts，画面在 game/heroes/huizhao-fx.ts）；回响云霄 · 乾坤图（sim/heroes/huiyun.ts，画面在 game/heroes/huiyun-fx.ts）
  | 'youlong' // 回响敖丙 · 游龙戟（出手在 sim/heroes/huiao.ts，画面在 game/heroes/youlong-fx.ts）
  | 'jingu' // 孙悟空 · 如意金箍棒（出手在 sim/heroes/wukong.ts，画面在 game/heroes/jingu-fx.ts）
  // 再加的 11 件公共法宝（arti2 分支；模拟在 sim/arti2.ts，画面在 game/fx-new2.ts）：xiangmo 降魔杵、wuguang 五光石、zanxin 攒心钉、jinjiao 金蛟剪、
  // yanguang 离地焰光旗、wanya 万鸦壶、sihai 四海瓶、wulu 雾露乾坤网、miaoshu 七宝妙树、wenhuang 瘟癀伞、luobao 落宝金钱
  | 'xiangmo' | 'wuguang' | 'zanxin' | 'jinjiao' | 'yanguang' | 'wanya' | 'sihai' | 'wulu' | 'miaoshu' | 'wenhuang' | 'luobao';
/**
 * 灵物。第三行起是 M3 新加的（说明与数值见 catalog.RELICS / RELIC，机制见 relics.ts）：
 * 有自己机制的 12 件 —— cushion 风火蒲团、zhuo 金刚琢印、jadedragon 九龙玉佩、mirror 照妖镜碎片、umbrella 混元伞残片、pouch 乾坤袋、
 * hairpin 桃木簪、stormfeather 风雷羽、cloudshoe 踏云履、scale 逆鳞、dingyan 定颜珠、icevase 冰心玉壶；
 * 带代价的魔物 3 件 —— gu 噬心蛊、drum 夔牛鼓、incense 燃魂香；只加属性的 3 件 —— cicada 金蝉蜕、scroll 山河图残卷、qilin 麒麟角。
 */
export type RelicId =
  | 'peach' | 'lingzhi' | 'gourd' | 'jindan' | 'feather' | 'thunderwood' | 'pearl' | 'turtle' | 'cornucopia'
  | 'blooddemon' | 'soulbell' | 'orb_metal' | 'orb_wood' | 'orb_water' | 'orb_fire' | 'orb_earth'
  | 'cushion' | 'zhuo' | 'jadedragon' | 'mirror' | 'umbrella' | 'pouch' | 'hairpin' | 'stormfeather' | 'cloudshoe' | 'scale' | 'dingyan' | 'icevase'
  | 'gu' | 'drum' | 'incense'
  | 'cicada' | 'scroll' | 'qilin';
/** 丹药。后五种是 M3 新加的：dahuan 大还丹、yinshen 隐身丹、jingangdan 金刚丹、leihuo 雷火丹、ningshen 凝神丹。 */
export type ElixirId = 'huichun' | 'juling' | 'kuangxue' | 'dahuan' | 'yinshen' | 'jingangdan' | 'leihuo' | 'ningshen';
/** 符箓。后六种是 M3 新加的（机制见 relics.ts）：dingshen 定身符、yinlei 引雷符、dundi 遁地符、shenxing 神行符、zhaobao 招宝符、huiling 回灵符。 */
export type CharmId = 'tishen' | 'huxin' | 'dingshen' | 'yinlei' | 'dundi' | 'shenxing' | 'zhaobao' | 'huiling';
export type StatId = 'maxHp' | 'regen' | 'soul' | 'damage' | 'haste' | 'crit' | 'area' | 'speed' | 'pickup' | 'armor' | 'dodge' | 'luck' | 'aff';

export interface Stats {
  maxHp: number; // 气血上限
  regen: number; // 每秒回复
  soul: number; // 吸魂：击杀时回血的几率（0..1）
  damage: number; // 伤害加成（0.1 = +10%）
  haste: number; // 攻速加成
  crit: number; // 暴击率
  critMul: number; // 暴击倍率
  area: number; // 范围加成
  speed: number; // 移速加成
  pickup: number; // 拾取范围加成
  armor: number; // 护体：受到的伤害 × 10/(10+护体)
  dodge: number; // 闪避率（上限 60%）
  luck: number; // 气运：影响商店品质与掉落
  aff: Record<Element, number>; // 五行亲和：对应五行法宝的伤害加成
}

export interface OwnedWeapon {
  kind: WeaponKind;
  tier: number; // 1 凡 2 灵 3 仙 4 神
  spirit: string | null; // 器灵（神品才有）
  cd: number; // 冷却计时（运行时）
  // 连击（运行时）：火尖枪灵品起「两连刺」的第二枪，在 burstT 秒后补上，朝 aim 方向
  burst?: number;
  burstT?: number;
  aim?: number;
  // 回血的结算（运行时）：化血神刀「噬魂」还没报出去的回血、距下次发 heal 事件还有多久
  heal?: number;
  healT?: number;
  // 再加的 11 件（sim/arti2.ts，运行时）：攒心钉这一轮连发到第几枚
  shot?: number;
}

export type ShopOffer =
  | { cat: 'weapon'; kind: WeaponKind; form: 'full' | 'fragment'; tier: number; price: number }
  | { cat: 'spirit'; kind: WeaponKind; spirit: string; price: number }
  | { cat: 'relic'; id: RelicId; price: number }
  | { cat: 'elixir'; id: ElixirId; price: number }
  | { cat: 'charm'; id: CharmId; price: number };

export interface StatOffer {
  stat: StatId;
  tier: number; // 1..4，越高加得越多
  el?: Element; // 五行亲和选项指定的五行
}

export interface Player {
  id: number;
  hero: HeroId;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  iframes: number;
  facing: 1 | -1;
  moving: boolean;
  still: number; // 站定了多久（土行三件：站定时减伤、站稳震地）
  wx?: { vineCd: number; quakeCd: number }; // 五行三件档的冷却（sim/wuxing.ts）：木「生生不息」的藤蔓、土「不动如山」的震地；没有 = 都好了
  skill: number; // 神通「真气」0..1
  kills: number;
  alive: boolean;
  miasma: number;
  corrode: number;
  corrodeT: number;
  stats: Stats;
  // 局内成长
  xp: number; // 当前等级内的经验
  level: number;
  pendingLevels: number; // 这一波升了几级，波次结束后统一选属性
  levelOffers: StatOffer[];
  lingshi: number; // 灵石（货币）
  lingshiAcc: number; // 不足一枚的零头（八折、丹药加成会产生小数）
  weapons: OwnedWeapon[];
  frags: Partial<Record<WeaponKind, number>>; // 还没凑齐三枚的碎片
  relics: Partial<Record<RelicId, number>>;
  charms: CharmId[];
  charmUsed: Partial<Record<CharmId, boolean>>; // 每波重置
  // 丹药：作用于下一波（打开商店时清空）。gem 聚灵丹、rage 狂血丹；dodge 隐身丹、armor 金刚丹、crit 雷火丹（开波时临时加进属性、波末减回去，
  // 见 relics.relicWaveStart）、calm 凝神丹（开波时真气满）
  buffs: { gem: number; rage: number; dodge?: number; armor?: number; crit?: number; calm?: number };
  relic?: RelicState; // 灵物、符箓的运行时状态（relics.ts 维护；没带有机制的道具时可省略）
  shop: (ShopOffer | null)[]; // null = 已买走
  locked: boolean[];
  rerolls: number; // 这次商店已刷新次数
  ready: boolean;
  shield: number; // 杏黄旗护盾剩余可挡次数
  lotus?: number; // 杏黄旗仙品起：有盾时脚下金莲的减速半径（0 / 没有 = 没开），表现层据此画金莲
  ringOut: boolean; // 乾坤圈主圈是否在外面
  pet: Pet;
  petOffer: PetBranch[] | null; // 待选的宠物进化（升到 5 / 10 / 15 级时出现）
  techs: TechniqueId[]; // 已悟的功法（按悟得的先后），一局内一直生效
  techOffer: TechniqueId[] | null; // 待悟的功法（升到 techniques.TECH_LEVELS 里的等级时出现，三选一）
  tech?: TechState; // 功法的运行时状态（techniques.ts 维护；没悟过有状态的功法时可省略）
  boon?: Boons; // 修为（局外成长）带进来、局中要用到的加成（xiuwei.ts 开局时放上；没点过修为就没有这个字段）
  /**
   * 这个人还没解锁、万宝阁里不给他刷的东西（开局时从 RunSetup.sealed 抄来：'weapon:jinjiao'、'relic:jadedragon'、'elixir:dahuan'、'charm:zhaobao'；
   * 解锁靠成就，判定在表现层 game/achievements.ts，模拟只认这一串纯数据）。没有这个字段 = 全都能刷（测试、数值工具、机器人）。
   */
  sealed?: string[];
  // ---- 联机（coop.ts / roster.ts 维护，数值在 config.COOP；单人一直没有这些字段，表现层按「没有 = 0 / false」读）----
  down?: number; // 倒地：离出局还剩多少秒（> 0 = 倒在地上等人扶；这时 alive 为 false：不能动、不能出手，敌人也不追他）。有人在扶时停住不走
  rescue?: number; // 扶起的进度 0..1：队友站在身边（COOP.reviveR 以内）持续 COOP.reviveT 秒扶满；没人扶时慢慢回落
  helpers?: number[]; // 此刻正在扶他的队友 id（升序；空 = 没人在扶）
  out?: boolean; // 出局：倒地没人扶（或这一波打完时还倒着），这一波不再回来，下一波开始时归队。商店照常逛、照常要按「出战」
  away?: boolean; // 掉线托管：操作由机器人给（bot.botTurn），受到的伤害减半；商店里不等他
  left?: boolean; // 离开了房间：人物从场上消失、不算人数；格子留着（编号 = 下标不变），之后有人中途加入时复用这一格
  // ---- 第二章的敌人与首领加在人物身上的（enemies.ts / ch2/yao.ts 维护；没有 = 0）----
  blowX?: number; // 被风吼妖吹开：额外的速度（像素 / 秒），很快衰减
  blowY?: number;
  root?: number; // 被姚天君的魂线定住：还剩多久（这期间走不动，法宝照常出手）
  // ---- 角色的被动与神通（sim/heroes/ 维护；没有这个角色的就一直没有这些字段）----
  rushUntil?: number; // 杨戬被动「乘隙」：到 w.time 这一刻之前移速提高（暴击时续上）
  gaze?: GazeCast; // 杨戬神通「天眼」：正在扫的那一道金光（扫完就去掉）
  dou?: DouCast; // 云霄 · 混元金斗：正在吸、正在斗里、正在喷出的那一斗（喷完落地就去掉）
  river?: RiverCast; // 云霄神通「九曲黄河」：正在转的那一圈黄河水（砸下就去掉）
  whip?: WhipCast; // 赵公明神通「金鞭」：举起、砸下的那一鞭和地上那道金缝（金缝合上就去掉）
  faxiang?: FaxiangCast; // 孙悟空神通「法天象地」：变成大身形的那几秒（变回来就去掉；sim/heroes/wukong.ts）
  wheels?: FireWheel[]; // 魔化哪吒 · 黑焰轮：正在滚的几只轮子（滚完就去掉；sim/heroes/mozha.ts）
  dash?: DashCast; // 魔化哪吒神通「火尖枪突进」：端枪蓄力、冲过去的那一段（冲完、那条线烧完就去掉）
  ropes?: RopeCast[]; // 回响赵公明 · 缚龙索：正在往一处拽的几根索（拽完就去掉；sim/heroes/huizhao.ts）
  nails?: NailCast; // 回响赵公明神通「钉头七箭」：钉上了草人符、等着一起落箭的那几只
  grudge?: number; // 回响赵公明被动「怨力」：攒了多少怨（0..1，满了放一圈震波）
  scrolls?: ScrollCast[]; // 回响云霄 · 乾坤图：展开着、裹着敌人的几卷图（压完就去掉；sim/heroes/huiyun.ts）
  formation?: FormationCast; // 回响云霄神通「黄河阵 · 削顶」：摆在地上的那一座阵（到时散掉）
  loongs?: LoongCast[]; // 回响敖丙 · 游龙戟：正在敌群里游的几条冰龙（游完就去掉；sim/heroes/huiao.ts）
  hualong?: HualongCast; // 回响敖丙神通「化龙」：化成白龙的那几秒（变回来就去掉）
  wing?: WingCast; // 雷震子神通「风雷翅」：腾空、连着俯冲的那一趟（落地就去掉；这期间人物由神通托着走、无敌）
}

/**
 * 雷震子神通「风雷翅」的一趟（sim/heroes/leizhenzi.ts）：双翅一展腾空，朝敌人最密处连着俯冲几下，每一下砸出雷击和风浪把敌群掀开。
 * 这一趟里人物由神通托着走（world.step 不听移动输入）、无敌。phase：rise 腾空（原地升起）；dive 俯冲（从 (x0, y0) 飞到 (x1, y1)，
 * 到了就砸）；up 砸完弹起（停在砸的地方往上弹，接着下一下）；land 最后一下砸完落地。t 是这一段开始的时刻（w.time），dur 这一段多长；
 * n 是第几下俯冲（1 起）。表现层按 phase、t、dur 画飞起来的高度和姿势。slams 是砸过的地方（下一下挑别处）。
 */
export interface WingCast {
  phase: 'rise' | 'dive' | 'up' | 'land';
  n: number;
  t: number;
  dur: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number; // 放的时刻（w.time）
  dmg: number; // 每一下砸的伤害（放的时候按 SKILL.damage 算好）
  wave: number; // 哪一波放的（不带进下一波）
  slams: [number, number][];
}

/**
 * 孙悟空神通「法天象地」（sim/heroes/wukong.ts）：t0 起身形长大（grow 秒长足），到 until 这一刻开始变回来；
 * 长足的那一下（t0 + stompAt）脚下一震（stomped 之后为 true）。这期间金箍棒扫得更远、砸得更重，不吃风吼妖的吹开。
 */
export interface FaxiangCast {
  t0: number;
  until: number;
  stomped: boolean;
  wave: number; // 哪一波放的（不带进下一波）
}

/**
 * 毫毛猴吹出来的一只小猴分身（sim/pets/maohou.ts）：从毫毛猴身边窜出去，追着 target 那只（瞄准点 (tx, ty) 在它身后一点）
 * 弯弯地掠过敌群，过了瞄准点再往前窜 over 像素（还没过是 −1），窜完、或者窜够 life 秒就化回一根毫毛。
 * 沿路离它 r 以内的敌人被「戏弄」（一只分身一只敌人只戏弄一次，hits 记着）。(x, y) 是它脚下（贴地窜）；px / py 上一帧的位置（表现层插值用）。
 */
export interface Imp {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  target: number; // 追的那只敌人的 id（-1 = 死了 / 没有，瞄准点停在最后的位置）
  tx: number;
  ty: number;
  over: number;
  t: number; // 窜了多久
  life: number;
  hits: number[];
}

/**
 * 魔化哪吒 · 黑焰轮的一只轮子（sim/heroes/mozha.ts）：从 (x0, y0) 沿 (ux, uy) 滚出去 len 长（地面高度），s 是现在滚到哪（0..len），
 * 回程（仙品「轮回」起）back 为 true、s 从 len 往回减到 0。碾到的敌人记在 hit 里（去程、回程各碾一次：回程开始时清空）。
 * r 是轮子的判定半径；burst 器灵「红莲」：滚到最远处炸开一朵红莲业火（炸过就是 true）。px / py 上一帧的位置（表现层插值用）。
 */
export interface FireWheel {
  id: number;
  x0: number;
  y0: number;
  ux: number;
  uy: number;
  len: number;
  s: number;
  t: number; // 滚了多久（滚得太久、一直追不上主人就收掉）
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  dmg: number;
  tier: number;
  back: boolean;
  ret: boolean; // 滚到尽头会不会掉头滚回来（仙品起）
  burst?: boolean;
  hit: number[];
  wave: number; // 哪一波放的（不带进下一波）
}

/**
 * 回响赵公明 · 缚龙索的一根索（sim/heroes/huizhao.ts）：从人物手里甩出去，缠住 ids 这一串敌人，在 dur 秒里把它们往 (cx, cy) 拽到一起；
 * 拽到了（t ≥ dur）一起撞一下（clash 倍伤害），仙品「锁龙」起再锁住片刻、受伤加深，器灵「千钧」在那一点砸下一记。
 * (fx, fy) 是甩出索的地方（人物的手，表现层画索从这里出来）；首领拽不动，只挨伤害。
 */
export interface RopeCast {
  id: number;
  ids: number[];
  cx: number;
  cy: number;
  fx: number;
  fy: number;
  t: number;
  dur: number;
  dmg: number;
  tier: number;
  spirit: string | null;
  wave: number;
}

/**
 * 回响云霄 · 乾坤图的一卷（sim/heroes/huiyun.ts）：从 (x0, y0) 朝 (x1, y1) 铺开（地面高度），半宽 hw；铺开时卷在图上的 ids 被裹住（定身 wrap 秒，首领只挨伤害）；
 * 仙品「镇山」起，裹够了一座山影压下来（press 倍伤害；器灵「麒麟崖」压的是整卷图上的敌人、裹得更久）。t 是铺开之后过了多久，pressed 压过了没有。
 */
export interface ScrollCast {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hw: number;
  ids: number[];
  t: number;
  wrap: number;
  dmg: number;
  tier: number;
  spirit: string | null;
  pressed: boolean;
  wave: number;
}

/** 回响云霄神通「黄河阵 · 削顶」：以 (x, y) 为心、半径 r 的一座阵，到 until 这一刻散掉；阵里的敌人受伤加深、打人变轻（削去顶上三花）。 */
export interface FormationCast {
  x: number;
  y: number;
  r: number;
  t0: number;
  until: number;
  wave: number;
}

/** 回响赵公明神通「钉头七箭」：ids 这几只身上钉了草人符，到 until 这一刻一起落箭（每只挨 dmg）；t0 是钉上的时刻。 */
export interface NailCast {
  ids: number[];
  t0: number;
  until: number;
  dmg: number;
  wave: number;
}

/**
 * 魔化哪吒神通「火尖枪突进」（sim/heroes/mozha.ts）：地上先亮一道线（(x0, y0) → (x1, y1)，地面高度），端枪蓄力 windup 秒，
 * 然后在 dur 秒里整条冲过去（这期间无敌），沿路半宽 w 内的敌人挨一下、点上业火；冲完之后那条线烧着 burnUntil 秒（踩上去的灼烧）。
 * t0 是开始蓄力的时刻（w.time）；hit 已经撞过的敌人。
 */
/**
 * 回响敖丙 · 游龙戟的一条冰龙（sim/heroes/huiao.ts）：从戟尖游出去，朝 target 那只敌人游，咬到就换下一只（没咬过的里最近的），
 * 一共咬 left 口；场上只剩咬过的（打首领）就绕一下回头再咬。back：器灵「回澜」游完掉头游回主人身边的那一程。(x, y) 是龙头（地面高度）。
 */
export interface LoongCast {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  ux: number; // 现在的游向（单位向量；转弯有角速度上限，走的是弧线）
  uy: number;
  target: number; // 正朝哪一只游（-1 = 还没挑 / 没有了）
  left: number; // 还能咬几口
  hit: number[]; // 咬过的（这一程里同一只不连着咬；都咬过了才回头再咬）
  cool: number; // 刚咬完的那一小会儿不再咬（穿过去）
  dmg: number;
  tier: number;
  spirit?: string;
  back: boolean;
  t: number; // 游了多久
  wave: number;
}
/**
 * 回响敖丙神通「化龙」（sim/heroes/huiao.ts）：until 之前是一条白龙——人物照常听摇杆、游得快、不受伤，身子扫过的敌人
 * 隔 tick 秒挨一下（next[id] 是这只敌人下一次能挨打的时刻）；变回来的那一下落地掀一圈浪。
 */
export interface HualongCast {
  t0: number;
  until: number;
  dmg: number;
  next: Record<number, number>;
  wave: number;
}
export interface DashCast {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  t0: number;
  windup: number;
  dur: number;
  dmg: number;
  hit: number[];
  done: boolean; // 冲完了没有
  burnUntil: number;
  tick: number; // 距下一次结算烧着的那条线
  wave: number;
}

/**
 * 云霄 · 混元金斗的一斗（sim/heroes/yunxiao.ts）。金斗飞到 (x, y)（地面上的一点：斗口正下方）上空，斗口一倾，
 * 把半径 r 内的几只敌人吸进去 —— 吸进去的敌人**暂时从 w.enemies 里拿出来**放在 held 里（谁也打不到、碰不到，也不动），
 * 过一会儿从斗口喷出去，摔在 land 的那几个点上（受伤、晕一下），回到 w.enemies。
 * 时刻都是 w.time：t0 出手（金斗起飞），tSuck 开始吸，tSpit 喷出，tLand 落地。表现层按这几个时刻画金斗和被吸、被喷的敌人。
 * held、from、at、land 一一对应（喷出之前 land 是空的）；from 是每只被吸之前站的地方、at 是吸进去的时刻（画被吸进去的那一段）。
 */
export interface DouCast {
  x: number;
  y: number;
  r: number;
  t0: number;
  tSuck: number;
  tSpit: number;
  tLand: number;
  tier: number;
  spirit: string | null;
  dmg: number; // 摔下来那一下的伤害（出手时按法宝算好）
  held: Enemy[];
  from: [number, number][];
  at: number[]; // 每一只是哪一刻吸进去的（w.time；吸的那一会儿里陆续吸进来）
  land: [number, number][];
  /** 吸 / 浇开始了没有（第一帧发 suck 事件、浇的时候金斗不再跟着挪）。 */
  began?: boolean;
  /** 浇：身边只有吸不进去的（首领、精英……）时，浇的是哪一只（-1 = 不是浇，是吸进去再喷出来）。 */
  pour: number;
  /** 倒海：喷出去的敌人一路撞到的（同一斗里一只只挨一次；运行时）。 */
  hit?: number[];
}

/**
 * 云霄神通「九曲黄河」的一圈水（sim/heroes/yunxiao.ts）：以 (x, y)（放的时候脚下，之后不动）为圆心、半径 r 铺开，
 * 圈里的敌人（ids，首领不卷）在 dur 秒里被卷着转、慢慢收向中心（每只的角度、离中心多远记在 ang / rad，开始时的离心距离在 rad0），
 * 到时一起砸下（伤害、晕、往外震开一点）。t0 是放的时刻（w.time）；tick 距下一次水流冲刷（小伤害）。
 */
export interface RiverCast {
  x: number;
  y: number;
  r: number;
  t0: number;
  dur: number;
  dmg: number;
  tick: number;
  ids: number[];
  ang: number[];
  rad: number[];
  rad0: number[];
}

/**
 * 赵公明神通「金鞭」的一鞭（sim/heroes/zhao.ts）：金鞭虚影举起 delay 秒后沿 (x0, y0) → (x1, y1)（地面高度）砸下，
 * 线上半宽 w 内的敌人挨一下；砸下之后那条线裂开一道金缝，到 until 这一刻合上（踩在缝上的减速）。t0 是举鞭的时刻（w.time）。
 */
export interface WhipCast {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  t0: number;
  delay: number;
  dmg: number;
  struck: boolean; // 砸下了没有
  until: number; // 金缝合上的时刻（砸下之后才有意义）
  wave: number; // 哪一波放的（金缝不带进下一波）
}

/**
 * 杨戬神通「天眼」的一扫（sim/heroes/yangjian.ts）：金光从额上的天眼照出，照在以人物脚下为圆心、半径 r 的扇面上，
 * 在 dur 秒内从 a0 扫到 a1（弧度，屏幕坐标、y 朝下；a1 − a0 的正负就是扫的方向），扫过的敌人各中一次。
 * 光的起点跟着人物走；t0 是开始扫的时刻（w.time），a 是这一帧光所在的角度（pa 上一帧，表现层插值用）。
 */
export interface GazeCast {
  a0: number;
  a1: number;
  a: number;
  pa: number;
  r: number;
  t0: number;
  dur: number;
  dmg: number;
  hit: number[]; // 已经照到过的敌人（一扫一只只中一次）
}

/**
 * 功法（第 3、8、12、14 级各悟一门，三选一、不重复，一局内一直生效；门槛、效果与数值见 techniques.ts）：
 * sanmei 三昧真火、lianhua 莲花化身、fenghuo 风火轮、hunyuan 混元一气、jingang 金刚不坏、wulei 五雷正法、
 * hanjue 寒冰诀、tianyan 天眼通、lingzhen 聚灵阵、tuna 吐纳术、lunzhuan 五行轮转、fatian 法天象地。
 */
export type TechniqueId = 'sanmei' | 'lianhua' | 'fenghuo' | 'hunyuan' | 'jingang' | 'wulei' | 'hanjue' | 'tianyan' | 'lingzhen' | 'tuna' | 'lunzhuan' | 'fatian'
  // 2026-11-12 再加的 12 门（feat/gongfa）：zhangxin 掌心雷、liuding 六丁六甲、zhansan 斩三尸、ziqi 紫气东来、wugui 五鬼搬运、tudun 土遁、
  // jiuzhuan 九转玄功、taiyi 太乙真诀、sanhua 三花聚顶、wuqi 五气朝元、sadou 撒豆成兵、hufeng 呼风唤雨
  | 'zhangxin' | 'liuding' | 'zhansan' | 'ziqi' | 'wugui' | 'tudun' | 'jiuzhuan' | 'taiyi' | 'sanhua' | 'wuqi' | 'sadou' | 'hufeng';

/** 灵物、符箓的运行时状态（relics.ts 维护，表现层只读；每波开始时重置）。 */
export interface RelicState {
  mirror: number; // 照妖镜碎片：距下一次照
  umbrella: number; // 混元伞残片：还要多久才能再挡一枚鬼火
  zhuo: number; // 金刚琢印：这一波已经砸了几次
  cloud: number; // 踏云履：加速还剩多久
  hurt: boolean; // 这一波被打中（真掉了血）过没有（冰心玉壶）
  drum: number; // 夔牛鼓：这一通鼓擂了多久（0 .. RELIC.drum.every；前 beat 秒是鼓劲）
  kills: number; // 这一波的击杀数（招宝符）
  dun: number; // 遁地符：遁地还剩多久
  run: number; // 神行符：加速还剩多久
  runs: number; // 神行符这一波已经用了几次
  temp: { dodge: number; armor: number; crit: number }; // 这一波丹药临时加进属性的量（波末减回去）
}

/** 功法的运行时状态（techniques.ts 维护，表现层只读）。 */
export interface TechState {
  lotus: number; // 莲花化身：上一次重生是在第几章（0 = 还没用过；每章一次）
  bolt: number; // 五雷正法：距下一道天雷还有多久
  boltAt: number; // 正在聚云的那道雷劈谁（敌人 id；-1 = 没在聚云）
  boltT: number; // 聚云还有多久落下
  boltX: number; // 雷落下的位置（跟着目标走；目标死了就落在它最后的位置）
  boltY: number;
  trail: { x: number; y: number; t: number }[]; // 风火轮：身后的火痕，按先后的一串点（t 是留下时的 w.time），过了寿命从头上收掉
  trailTick: number; // 距下次结算火痕
  // ---- 2026-11-12 再加的几门 ----
  jia: number; // 六丁六甲：还剩几道护身甲
  jiaT: number; // 六丁六甲：距补下一道
  dunCd: number; // 土遁：冷却还剩多久
  kills: number; // 九转玄功：这一波斩了几只
  zhuan: number; // 九转玄功：这一波进到第几转
  reacts: number; // 五气朝元：攒了几次相生
  bean: number; // 撒豆成兵：距下一把豆
  beans: { x: number; y: number; t: number; id: number }[]; // 撒豆成兵：撒出去的豆（落点、撒出后过了多久、扑向的敌人 id，-1 = 落地时再找）
  rain: number; // 呼风唤雨：距下一场雨
  storm: { x: number; y: number; t: number; tick: number } | null; // 呼风唤雨：正在下的那场雨（位置、还剩多久、距下次结算）
}

/**
 * 功法的事件（techniques.ts 发出；表现层据此画、放音效）。learn：商店阶段悟得一门。
 * tech 是战斗里的效果，kind 是哪门功法，(x, y) 是发生的位置：
 * - lianhua 莲花化身重生（r 震开的半径）；jingang 金刚不坏反弹（ids 被反弹打中的敌人）；
 * - wulei 五雷正法：act 'warn' 开始聚云（id 目标，t2 秒后落下），act 'strike' 天雷落下（r 波及的半径）；
 * - hanjue 寒冰诀冰碎迸开（id 被打碎冰的那只，r 波及的半径）；tianyan 天眼通看破一只（id）；
 * - sanmei 三昧真火把火传给身边的敌人（pts 传到的位置）；tuna 吐纳术每波开始回血（v 回了多少）。
 * - 2026-11-12 再加的：liuding 六丁六甲 act 'block' 挡下一下；zhangxin 掌心雷（pts / ids 劈到的敌人）；ziqi 紫气东来每波开始生息（v 枚灵石）；
 *   tudun 土遁（(x, y) 遁走处，pts[0] 出土处，r 迸起土石的半径）；jiuzhuan 九转玄功进了一转（v 第几转）；wuqi 五气朝元迸开（r 波及的半径）；
 *   sadou 撒豆成兵：act 'sow' 撒出一把（pts 落点，ids 各扑向谁，t2 落地要多久），act 'strike' 一个豆兵斩下（id 斩谁，没斩到是 -1）；
 *   hufeng 呼风唤雨 act 'start' 开始下雨（r 雨的半径，t2 下多久；之后表现层读 Player.tech.storm）。
 * 风火轮的火痕不发事件，表现层直接读 Player.tech.trail。
 */
export type TechEvent =
  | { t: 'learn'; owner: number; kind: TechniqueId }
  | { t: 'tech'; kind: TechniqueId; owner: number; x: number; y: number; act?: 'warn' | 'strike' | 'block' | 'sow' | 'start'; id?: number; r?: number; t2?: number; ids?: number[]; pts?: [number, number][]; v?: number };

/**
 * 宠物的进化分支（第一次进化时选定，之后沿着它走；名字与说明在 catalog.PET_BRANCH，每种宠物的两条路在 pet.ts 的 PET_KINDS）：
 * 混天绫 bind 缚龙 / fire 火绫；哮天犬 pounce 天狗（扑倒：先按住片刻、每趟多咬两只）/ fang 金牙（被咬的受金行伤害更高、更容易被暴击）；
 * 青鸾 rime 冰魄（沾羽就冻住片刻、每趟多洒两只）/ deep 沧溟（沾羽的受水行伤害更高、被冻住时冻得更久）；
 * 黑虎 gale 啸风（吼声更大、把敌人吼退一步，震慑更久）/ broke 破财（被震慑时被打死的敌人多掉灵石）；
 * 雷鹏 flash 掣电（每趟多麻两只，沾上那一下麻得更久、之后颤得更勤）/ clap 霹雳（麻痹的敌人受到的木行伤害更高，一颤会把电传给身边一只）；
 * 毫毛猴 hold 定身法（被戏弄的先定住片刻）/ drowse 瞌睡虫（被戏弄的昏昏欲睡：更慢、更久）。
 */
export type PetBranch = 'bind' | 'fire' | 'pounce' | 'fang' | 'gale' | 'broke' | 'rime' | 'deep' | 'flash' | 'clap'
  | 'surge' | 'marrow' // 避水兽：surge 怒涛（浪推得更远、每趟多打湿两只）/ marrow 霜髓（湿透的被冻住时冻得更久，冻着的时候受伤更深）
  | 'hold' | 'drowse';
/**
 * 宠物在做什么（三种状态下都一直在动）：follow 跟在主人身边（空闲，或两趟之间）；
 * sweep 掠过：混天绫划一道弧从侧面切进敌群、加速穿过去，哮天犬从敌群里一冲而过，沿途缠住 / 咬一口扫到的敌人；
 * return 穿过之后顺着惯性兜一个弯回到主人身边。
 */
export type PetMode = 'follow' | 'sweep' | 'return';

/**
 * 专属宠物：无敌、不造成伤害、只上减益。种类跟着角色走（catalog.HEROES[hero].pet），行为与数值在 sim/pets/ 下各自的模块，
 * 按种类分派在 sim/pet.ts。stage 0..3，第一次进化时选定分支。下面的字段两种宠物共用（含义按混天绫写，哮天犬的不同处见 pets/xiaotian.ts）。
 */
export interface Pet {
  stage: number;
  branch: PetBranch | null;
  mode: PetMode;
  x: number; // 绸带头的位置（飘在半空：正下方的地面是 (x, y + PET.hover)）
  y: number;
  px: number;
  py: number;
  vx: number; // 速度（像素 / 秒）：方向就是绸带头的朝向
  vy: number;
  cd: number; // 距下一趟掠过
  tx: number; // 这一趟的瞄准点（敌群中心稍往前，跟着敌群走）
  ty: number;
  ux: number; // 这一趟穿过敌群的方向（单位向量）
  uy: number;
  ox: number; // 瞄准点相对 target 那只敌人的偏移
  oy: number;
  target: number; // 这一趟瞄的那群里的一只（-1 = 没有 / 已经死了，瞄准点停在最后的位置）
  seekT: number; // 掠过：离到达瞄准点还剩多少计划时间（穿过之后变成负数，记顺势冲了多久）
  wrapT: number; // 当前这一段（掠过 / 回旋 / 飘）已经过了多久
  hits: number[]; // 这一趟已经缠过的敌人（同一只一趟只缠一次）
  ph: number; // 空闲时沿「8」字飘的相位
  side: number; // 空闲时飘在主人哪一侧（-1 左 … 1 右，转身时平滑过渡、从头顶上绕过去）
  // ---- 雷鹏（pets/leipeng.ts）才有的：(x, y) 是它正下方的地面，z 是离地多高（画面按 y − z 画）；俯冲那一趟贴地走的折线 path
  //（[x0, y0, x1, y1, …]，地面坐标，像一道闪电）和已经沿它走了多远 pos ----
  z?: number;
  path?: number[];
  pos?: number;
  imps?: Imp[]; // 毫毛猴：吹出去还没化回毫毛的小猴分身（别的宠物没有这个字段）
  // ---- 贴地的四只（pets/heel.ts）跟随时用：主人移动速度的平滑值（主人一帧一帧换方向时，「身后」那一点不跟着来回跳）----
  mvx?: number;
  mvy?: number;
}

/** 五行相生（用户：不同属性之间要有搭配、增强）：带着上一行印记的敌人，被下一行法宝打中时触发。 */
export type ReactionKind =
  | 'frost' // 金生水：凝霜
  | 'conduct' // 水生木：导雷
  | 'ignite' // 木生火：引燃
  | 'lava' // 火生土：熔岩
  | 'pierce'; // 土生金：淬锋

/**
 * 修为（局外成长，xiuwei.ts）带进这一局、打的时候还要用到的加成：开局时算好放在 Player.boon 上（属性类的直接加进了 stats）。没有 = 0。
 */
export interface Boons {
  reroll?: number; // 刷新万宝阁便宜几成（shop.rerollCost）
  freeReroll?: number; // 每进万宝阁，头几次刷新不花灵石（shop.rerollCost）
  offers?: number; // 升级时多几个属性可选（shop.makeLevelOffers）
  petDur?: number; // 灵宠的减益时长 +几成（pets/*）
  petHaste?: number; // 灵宠出手快几成（pet.updatePet：冷却多走几成）
  skill?: number; // 神通充能 +几成（core.onKill）
  fullGuard?: number; // 气血全满时受到的伤害减几成（core.hurtPlayer）
  stepDodge?: number; // 走动时闪避 +（core.hurtPlayer）
  bond?: number; // 专属法宝伤害 +几成（core.weaponDamage）
  bossGuard?: number; // 首领、回响化身的招式伤害减几成（core.hurtPlayer）
  lowRegen?: number; // 气血不足三成时每秒回复 +（world.step）
  interest?: number; // 每波打完另得几枚灵石，随物价涨（xiuwei.xiuweiWaveEnd）
}

export interface Enemy {
  id: number;
  kind: EnemyKindName;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmgMul: number; // 随波次加强的伤害倍率
  kx: number;
  ky: number;
  cd: number;
  cast: number;
  // 状态
  burn: number; // 灼烧每秒伤害
  burnT: number;
  burnAcc: number; // 还没报出去的灼烧伤害
  burnBy: number; // 灼烧是谁点的（击杀记给谁）
  stun: number; // 晕眩 / 定身 / 冻结剩余时间
  frozen: number; // 冻结剩余时间（也算晕眩；水行三件：受伤翻倍）
  slow: number; // 减速比例 0..1
  slowT: number;
  vuln: number; // 易伤比例
  vulnT: number;
  wrapT: number; // 被混天绫缠住的剩余时间（表现层画红绫用）
  wrapMax: number; // 这次缠住的总时长
  fireVuln: number; // 火绫「引火」：受到的火行伤害加成
  fireVulnT: number;
  mark: Element | null; // 五行印记：最近一次被哪一行的法宝打中
  markT: number;
  bleed: number; // 流血（金行的持续伤害）每秒伤害
  bleedT: number;
  invuln: number; // 无敌剩余时间（首领换阶段时用）
  // 流血的结算（运行时，可省略）：还没报出去的伤害、距下次跳字、是谁割的（击杀记给谁）
  bleedAcc?: number;
  bleedTick?: number;
  bleedBy?: number;
  zoneT?: number; // 上一次被灼烧类区域烫到的时刻（运行时：几块火痕叠在一起只算一块）
  zoneHit?: Partial<Record<ZoneKind, number>>; // 别的区域（水域、青莲荆棘、旋风）上一次结算到这只的时刻（运行时：同一种叠在一起只算一块）
  // 第一章新敌人的出手状态（enemies.ts 维护，表现层只读；运行时，可省略）
  act?: FoeAct; // 正在做什么（没有 = 平常走动）
  actT?: number; // 这个动作还剩多久（秒）
  actLen?: number; // 这个动作一共多久（表现层算进度用）
  aimX?: number; // 出手方向（单位向量）：蓄力 / 预警开始时朝人物定下，之后不跟踪
  aimY?: number;
  ox?: number; // 出手的起点（骑兵冲锋线的起点；长矛兵从自己脚下刺出，不用它）
  oy?: number;
  reach?: number; // 这一下打多远：长矛的刺击线长度 / 骑兵冲锋线的长度
  struck?: boolean; // 这一次出手已经打中过人（每次出手最多打中一次）
  face?: number; // 盾兵举盾的朝向（弧度）：慢慢转向人物，绕到侧面和背后打才是全额
  eyeUntil?: number; // 功法「天眼通」：被暴击看破，到 w.time 这一刻之前受到的伤害加深（运行时，可省略）
  rush?: number; // 包围刷出来的兵：从屏幕外冲进来，还能冲多久（秒；冲到合围圈上就清零，见 catalog.SURGE）。表现层可以据此画冲刺
  // 第二章：被落魂幡手增益（护体 = 受到的伤害减少 ward，移速 + haste，到 wardT 用完为止；幡手每隔一会儿续一次）
  ward?: number;
  wardT?: number;
  haste?: number;
  links?: number[]; // 落魂幡手：这一刻幡上的魂光连着哪几只（表现层画魂光）
  // 第三章：阵图傀儡两只一组（sim/ch3/foes.ts）。mate 是另一只的 id（没有这个字段 = 还没配对；-1 = 线断了、只剩自己）；
  // tetherT：这一组的剑气线上一次打中人的时刻（w.time，记在编号小的那只身上）
  mate?: number;
  tetherT?: number;
  // ---- 精英（sim/elites/；kind 'elite' 的才有，金光 aegis 除外）----
  elite?: EliteKind; // 哪一种精英（没有 = 回响校尉）
  affixes?: EliteAffix[]; // 带的词缀（一两条；第一章劫一不带）。表现层按词缀给身上的饰物着色、在血条左边写字
  cd2?: number; // 精英的第二个冷却（东海夜叉：拍浪；第一个是 cd：潜水）
  hidden?: boolean; // 东海夜叉潜在水里：打不着（同时无敌）、不接触伤人；表现层画水下游走的一圈涟漪
  aegis?: number; // 金光力士给的「金光护体」：还能挡几下（任何敌人都可能被套上），到 w.time = aegisT 散掉
  aegisT?: number;
  blades?: number; // 截教剑侍：身边还绕着几柄小剑（0..3）
  spin?: number; // 截教剑侍：三柄小剑绕身转到的角度（弧度；晕眩、冻住时不转）
  reload?: number; // 截教剑侍：三柄都射出去以后，还要多久重新聚齐
  recoilT?: number; // 词缀「反震」：蓄力还剩多久（> 0 = 正在蓄，脚下亮淡红光）
  recoilCd?: number;
  call?: EliteCall; // 词缀「召唤」：正在掐诀（地上两处符印，到时冒出回响兵）
  callCd?: number;
  minions?: number[]; // 词缀「召唤」：它召出来、还活着的（最多 AFFIX.summon.max 只）
  // ---- 角色带来的减益（sim/heroes/、sim/pets/xiaotian.ts 加上；没被这些角色碰过的敌人一直没有这些字段）。结算在 core.hitEnemy ----
  sunderUntil?: number; // 哮天犬「破甲」：到 w.time 这一刻之前受到的伤害 +sunder（盾卫的盾也挡不住）
  sunder?: number;
  fang?: number; // 哮天犬「金牙」：破甲期间受到的金行伤害再 +fang、被暴击的几率 +fang / 2（0 / 没有 = 没走这条路）
  gazeUntil?: number; // 杨戬神通「天眼」：被金光照到、标记到 w.time 这一刻之前，受到的伤害 +gaze
  gaze?: number;
  // 云霄（sim/heroes/yunxiao.ts、sim/pets/qingluan.ts）：
  chillUntil?: number; // 青鸾「寒羽」：沾了冰羽，到 w.time 这一刻之前出手变慢（冷却按 1 − chill 的速度走；移速走 slow / slowT）
  chill?: number;
  chillTick?: number; // 寒羽这一帧已经让冷却慢下来过了（w.tick；同一帧不重复算）
  tangleUntil?: number; // 木行三件的藤蔓：缠到 w.time 这一刻，这期间受到的伤害 +tangle（sim/wuxing.ts；表现层按它画藤）
  tangle?: number;
  reactUntil?: number; // 五行俱全：这只刚相生过，到 w.time 这一刻之前不再相生（防一帧里接力刷屏，catalog.WX.cd）
  deepUntil?: number; // 青鸾「沧溟」：到 w.time 这一刻之前受到的水行伤害 +deep，被冻住时冻得更久
  deep?: number;
  sanhuaUntil?: number; // 混元金斗仙品起「削去顶上三花」：喷出来以后到 w.time 这一刻之前受到的伤害 +sanhua
  sanhua?: number;
  riverHeld?: number; // 九曲黄河：正被卷在水里，到 w.time 这一刻为止（卷着的不再被金斗吸走）
  // 雷震子 · 雷鹏「麻痹」（sim/pets/leipeng.ts）：到 w.time = numbUntil 之前身上带电 —— 出手慢 numb（冷却按 1 − numb 的速度走），
  // 每隔一会儿一颤（twitchT 是离下一颤还有多久；颤的时候顿 LEIPENG.twitch.t 秒，蓄力被打断）；numbTick 同一帧不重复算。
  // 霹雳：到 clapUntil 之前受到的木行伤害 +clap。首领不颤、不慢出手，只走得慢一点
  numbUntil?: number;
  numb?: number;
  numbTick?: number;
  twitchT?: number;
  clapUntil?: number;
  clap?: number;
  // 赵公明 · 黑虎「震慑」：到 w.time 这一刻之前被吓住 —— 不追人、不起手，沿 (fearDx, fearDy)（速度倍数，已含逃跑时快的那一点）往外逃，
  // 打人的伤害 ×(1 − fear)；broke 是「破财」：这期间被打死时多掉一颗灵石的几率（0 / 没有 = 没走这条路）。首领不会被吓住
  fearUntil?: number;
  fearDx?: number;
  fearDy?: number;
  fear?: number;
  broke?: number;
  // 孙悟空 · 毫毛猴「戏弄」：到 w.time 这一刻之前被小猴逗得团团转 —— 出手变慢（冷却、收招按 1 − tease 的速度走）、
  // 走路乱晃（朝人走的那一截只剩 teaseWalk 倍，方向左右摆）；teaseTick 是上一次把冷却退回去的那一帧（w.tick，一帧只退一次）。首领不吃
  // 避水兽「湿透」（sim/pets/bishui.ts）：到 w.time 这一刻之前，下一下水行的伤害打上来就冻住 soakFreeze 秒（冻上就不湿了；首领不吃）；
  // soakDeep（进化「霜髓」）：这样冻住的那一会儿受到的伤害再 +这么多
  soakUntil?: number;
  soakFreeze?: number;
  soakDeep?: number;
  teaseUntil?: number;
  tease?: number;
  teaseWalk?: number;
  teaseTick?: number;
  // 灵物（relics.ts；运行时，可省略）：照妖镜碎片照出原形 —— 到 w.time 这一刻之前受到的伤害 ×(1 + reveal)（谁打都算）；
  // dyT 定颜珠上一次报「打中定住的」的时刻（表现层的小闪光不用每一下都发）
  revealUntil?: number;
  weakUntil?: number; // 回响云霄「黄河阵 · 削顶」：到 w.time 这一刻之前被削去三花——打人的伤害 ×(1 − weak)（受伤加深走 vuln）
  weak?: number;
  hpFloor?: number; // 回响化身遭遇战：没到最后一个阶段之前气血打不到这条线以下（core.hitEnemy 卡住；sim/echo/ 换阶段时去掉）
  reveal?: number;
  dyT?: number;
  // 再加的 11 件法宝（sim/arti2.ts；运行时，可省略）：攒心钉钉在身上的钉子 —— nails 几枚（每枚让它受到的伤害提高，谁打都算），
  // nailT 还剩多久（每钉进一枚就刷新），nailBy 是谁钉的
  nails?: number;
  nailT?: number;
  nailBy?: number;
  // 瘟癀伞（sim/arti2.ts）：plague 身上几层瘟（0 没染），plagueT 还剩多久（再染刷新），plagueBy 谁的伞，plagueDps 每层每秒掉多少血，
  // plagueTier / plagueSp 染上它的那把伞的品阶、器灵（传给别人时照抄），plagueTick 下一跳掉血，plagueCd 下一次传给身边的，plagueDown 瘟倒过之后多久才能再倒
  plague?: number;
  plagueT?: number;
  plagueBy?: number;
  plagueDps?: number;
  plagueTier?: number;
  plagueSp?: string;
  plagueTick?: number;
  plagueCd?: number;
  plagueDown?: number;
  // 落宝金钱仙品「落宝」（sim/arti2.ts）：被附上时宝光被打落 —— 到 w.time = luobaoUntil 之前受到的伤害提高、落魂幡手给的护体失效
  luobaoUntil?: number;
}

/**
 * 持续存在的地面区域（法宝高品阶的「质变」用）：火痕、火罩笼罩、地裂、寒霜……
 * 圆形区域 x2/y2 等于 x/y；线段区域（火痕）从 (x, y) 到 (x2, y2)，r 是半宽。表现层直接读 world.zones 画。
 * fireTrail 火尖枪火痕（线段，灼烧）；fireDome 九龙神火罩笼罩（圆，跟着主人走，灼烧）；
 * crack 番天印地裂（圆，减速）；frost 寒冰幡寒霜（圆，减速）。结算见 zones.ts。
 *
 * 剩下 8 件公共法宝的持续效果也放在这里（不全是「地面」，但都是有寿命、每帧结算、波末清空的一块东西）。
 * 角度一律是弧度，0 朝右，屏幕坐标 y 朝下（所以正角度是顺时针）：
 * - whirl 定风珠旋风（圆，r = 卷人的半径）：ids 是卷住的敌人（一次最多几只，首领卷不动），往中心卷（pull 像素 / 秒），到时吹散
 *   （zoneEnd effect 'gust'，器灵「定海」改成定身 'root'）；仙品起追着敌群慢慢移动（px/py 是上一帧的位置）、期间反复伤害；
 *   器灵「风雷」里面不断落雷（chain 事件）。
 * - lotus 青莲宝色旗结界（圆）：站在里面的玩家每秒回 heal 点气血（「莲台」再加 dodge 闪避），敌人进来被荆棘刺伤；仙品起跟着主人走。
 * - beam 阴阳镜光束（线段）：从 (x, y)（跟着主人）朝 a 方向长 len、半宽 r；a 在 life 秒内从 from 扫到 to，扫过的敌人各打一次。
 *   仙品起一阴一阳两道反向扫（yin 区分，twin 是另一道的 id），两道都照到的冻住；器灵「乾坤」扫整整一圈（from 到 to 差 ±2π）。
 * - water 玄元控水旗水域（圆）：里面的敌人大幅减速、持续受伤；仙品起漩涡把敌人往中心吸（pull）；器灵「寒潭」结束时冻住里面的（zoneEnd effect 'freeze'）。
 * - flameWave 五火七禽扇火浪（扇面）：从 (x, y) 朝 a 方向、半张角 arc，火线的半径 r 从 0 推到 len，推到谁就烧谁一次（击退 + 点燃）。
 * - scorch 五火七禽扇器灵「焚风」：火浪推到头后，顺着火浪的中线在地上留下的一道火痕（线段 (x, y) → (x2, y2)，r 是半宽，a 是方向），灼烧踩上去的。
 * - rope 捆仙绳金绳：ids 是捆住的敌人（按绳子穿过的顺序），x/y 是他们的中心；仙品起把他们往一起拽（pull）、撞到一起互相撞伤。
 *   金绳也会抽中捆不住的精英 / 首领（hit 事件 by 'rope'，易伤、不定身），它们不在 ids 里；器灵「困龙」的首领在 ids 里，但只减速。
 */
export type ZoneKind = 'fireTrail' | 'fireDome' | 'crack' | 'frost'
  | 'whirl' | 'lotus' | 'beam' | 'water' | 'flameWave' | 'scorch' | 'rope'
  // 再加的 11 件（sim/arti2.ts）：vajra 降魔杵仙品「降魔印」（圆，踩上去的敌人被镇住片刻，每只每枚只镇一次，hit 是镇过的）；
  // orbit 金蛟剪（跟着主人走：几条金蛟绕身盘旋，碰到的被咬；仙品起隔一会儿扑出去交剪）；
  // banner 离地焰光旗（插在地上的旗，r 是它管得到的半径：旗边的敌人脚下隔一会儿窜起地火；人走远了旗跟过去重插）；
  // blaze 离地焰光旗器灵「焚城」地火窜过留下的一小片火海（圆，灼烧，和火痕、火罩共用「同一只每跳只烫一次」）
  // crows 万鸦壶的鸦群（圆，r 是它们盘旋、俯冲够得着的半径；跟着敌群慢慢挪，n 几只，tick2 下一次俯冲）
  // surge 四海瓶的浪头（(x2, y2) 涌起的地方，(x, y) 浪头当前的中点，a 朝向，r 浪头半宽，len 推多远；推到头砸下，nth = 1 之后只剩画面上的水退）
  // net 雾露乾坤网（圆，r 网的半径；nth 0 张着等、1 收了网（tick 是收网的时刻，ids 网住的）、2 落空；n = 1 仙品「乾坤」已经缩成水球砸下）
  // sweep 七宝妙树绕身一刷（跟着主人走；r 刷多远，from 起刷的角度，spin 往哪边转（±1），a 妙树这一刻指着的角度；hit 这一遍刷到的，
  //   器灵「双刷」第二遍刷到的记在 ids）
  // umbrella 瘟癀伞（圆，撑在敌群上空，r 伞下的瘟雾多大；跟着敌群慢慢挪；tick 下一次洒瘟雾）
  // coin 落宝金钱（附在 ids[0] 那一只头上一下一下地敲，(x, y) 金钱这一刻在的地方（地面坐标）；nth = 1 正飞向它；n 这一回落宝了几次；tick 下一敲）
  | 'vajra' | 'orbit' | 'banner' | 'blaze' | 'crows' | 'surge' | 'net' | 'sweep' | 'umbrella' | 'coin';
export interface Zone {
  id: number;
  owner: number;
  kind: ZoneKind;
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  t: number; // 已经存在了多久
  life: number; // 总时长
  tick: number; // 距下次结算
  dmg: number;
  tier: number;
  // ---- 以下字段只有剩下 8 件公共法宝的区域用（含义见上面各种类的说明）----
  spirit?: string; // 放出它的法宝的器灵（神品才有）：「风雷」「定海」「寒潭」「莲台」「荆棘」……
  a?: number; // 朝向：光束当前的角度（模拟每帧更新，两头慢中间快，表现层用 pa → a 插值即可）；火浪扇面 / 焦土的方向
  pa?: number; // 光束上一帧的角度（表现层插值用）
  from?: number; // 光束这一扫的起止角度
  to?: number;
  arc?: number; // 扇面的半张角（火浪、焦土）
  len?: number; // 光束长度；火浪最远推到多远
  px?: number; // 上一帧的位置（会自己移动的区域：旋风、跟着主人的结界与光束）
  py?: number;
  ids?: number[]; // 金绳捆住的敌人；旋风卷住的敌人
  hit?: number[]; // 已经被这道光束 / 火浪打过的敌人（一道只打一次）；金绳：已经撞过的（运行时）
  twin?: number; // 阴阳镜：另一道光束的区域 id
  yin?: boolean; // 阴阳镜：true 是阴、false 是阳（表现层分两种颜色）
  heal?: number; // 站在里面的玩家每秒回多少气血（青莲结界）
  dodge?: number; // 站在里面的玩家闪避提高多少（青莲「莲台」，core.hurtPlayer 里算）
  pull?: number; // 把里面的敌人往中心拉的速度（像素 / 秒）；首领不被拉，精英拉得慢
  tick2?: number; // 第二个计时器（运行时）：风雷落雷、结界报回血
  acc?: number; // 还没报出去的回血（运行时）
  // ---- 再加的 11 件（sim/arti2.ts）用的 ----
  // 金蛟剪 orbit：a 是第一条金蛟绕到的角度（其余的均匀排开），spin 角速度，len 绕身的半径，n 几条；
  // snip 正扑出去还剩多久（0 = 在绕身），who 是哪一条在扑（-1 = 一齐扑出去交剪，仙品起），ids 扑向的那几只；
  // coil 器灵「绞龙」缠着绞还剩多久（ids[0] 是被缠的）
  spin?: number;
  n?: number;
  snip?: number;
  who?: number;
  coil?: number;
  nth?: number; // 金蛟剪：这一阵扑出去了几次（仙品起每第三次是一齐扑出去交剪）
  idle?: number; // 离地焰光旗：旗边已经多久没有敌人了（久了就拔起来，插到敌人那边去）
  prey?: number; // 雾露乾坤网：收网时网里只有网不住的大个子（精英、首领）——网罩在它身上勒一下就被挣破，这是它的 id（仙品的水球砸在它身上）
}

/** 敌人留在地上的东西（第二章红沙傀儡的红沙：人物站在上面走得慢）。在 World.patches 里，到时消失，波末清空。 */
export interface Patch {
  id: number;
  kind: 'sand';
  x: number;
  y: number;
  r: number;
  t: number; // 留下多久了
  life: number;
}

export interface Orb {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
  // 第三章截教门徒掷出的剑气（sim/ch3/foes.ts；鬼火没有这些）：kind 'qi'；bend 还要拐多久（秒），拐的时候按 turn 弧度 / 秒转向 to 那个人；
  // by 打中人时记作什么伤害（没有 = 鬼火 'orb'）。kind 'blade'：截教剑侍射出来的小剑（sim/elites/jianshi.ts，直线飞）
  kind?: 'qi' | 'blade';
  bend?: number;
  turn?: number;
  to?: number;
  by?: HurtBy;
}

export interface Ring {
  id: number;
  owner: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  out: number;
  returning: boolean;
  primary: boolean;
  hits: Set<number>;
  life: number;
  dmg: number;
  range: number;
  fireBurst: boolean; // 器灵「赤焰轮」：折返时炸开火环
  hover: number; // 仙品质变：飞到最远处悬停旋转的剩余时间（0 = 没在悬停）
  tier?: number; // 掷出这枚圈的乾坤圈品阶（神通散出的圈也带）
  hoverTick?: number; // 悬停时距下一次绞杀（运行时）
  canHover?: boolean; // 这枚圈会不会在最远处悬停（仙品起的主圈）
  r0?: number; // 判定半径的基数（品阶越高越大，飞远了再按 ringGrowth 放大）
  grind?: Map<number, number>; // 悬停时每只敌人被绞了几下（运行时）
}

export interface Knife {
  id: number;
  owner: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  target: number; // 正在追的敌人 id
  hitsLeft: number;
  hit: Set<number>;
  dmg: number;
  life: number;
  tier?: number; // 斩仙飞刀的品阶（仙品起命中留下流血）
  turn?: number; // 身边没有别的目标时，穿过去、绕回来再刺同一只之前还要飞多久（运行时）
  again?: Set<number>; // 已经折回来补刺过一次的敌人（同一只最多刺两下）
  kind?: WeaponKind; // 哪件法宝放出来的：没有 = 斩仙飞刀；'wuhuo' = 五火七禽扇仙品「七禽」的火鸟（每只追一个敌人，打中一次就散）
  // 再加的 11 件（sim/arti2.ts）：'wuguang' 五光石的石子 —— 认 target 那一只、打中第一只就碎；shard 仙品「五光」碎成的五色光（追 target 那一只）；
  // 'zanxin' 攒心钉的金钉 —— 追 target 那一只，钉进去（器灵「透骨」hitsLeft 2：透过去再钉后面一只）；
  // 'miaoshu' 七宝妙树仙品「七宝」飞出去的一宝 —— 追 target 那一只，打中就散（color 七宝里的哪一宝 0..6）；
  // color 五色里的哪一色（0 青 1 赤 2 黄 3 白 4 黑，画面按它上色）；range 最远飞多远（离出手处，石子用）；sx / sy 出手处
  shard?: boolean;
  color?: number;
  range?: number;
  sx?: number;
  sy?: number;
}

/** 延时效果（番天印砸地、寒冰幡冰棱，仙品起的雷公鞭雷印、寒冰幡寒气，打神鞭落鞭）：先预警（warn），再结算（land）。 */
export interface Pending {
  id: number;
  owner: number;
  kind: PendingKind;
  x: number;
  y: number;
  r: number;
  t: number; // 还有多久落下
  dmg: number;
  target?: number; // 跟着某只敌人走（雷印：落在被标记的敌人身上；打神鞭：抽血最厚的那只）
  tier?: number;
  quake?: boolean; // 番天印器灵「地裂震波」：落地后跟着震出的那一圈（不预警、不再开裂）
  // 打神鞭（kind 'lash'）：r 是鞭痕的半宽；len 鞭痕长度；ring 仙品起落点震波的半径（0 = 没有）；
  // spirit 器灵（「封神」抽散残血、「九节」同一目标连抽三鞭）；seq 九节的第几鞭（1..3）
  len?: number;
  ring?: number;
  spirit?: string;
  seq?: number;
  // 黄金棍（kind 'staff'）：棍子从 (x0, y0) 飞出（掠过的那一段从这里量到落点）；hops 这一砸之后还要弹起再砸几处
  x0?: number;
  y0?: number;
  hops?: number;
  // 再加的 11 件（sim/arti2.ts）：降魔杵 —— n 这一串一共砸几下（seq 是第几下）；chain 这一串第一下的 id（表现层把几下连成同一根杵）；
  // (ox, oy) 这一下从哪里飞过来（地面坐标：第一下是人物手边，之后是上一个落点）；hit 这一串砸过的目标；
  // 万鸦壶（kind 'dive'）—— burst 器灵「金乌」那一扑落下炸开的日火半径（ring 是仙品最后的自焚，鸦就没了；burst 炸完金乌飞回去）
  n?: number;
  chain?: number;
  ox?: number;
  oy?: number;
  hit?: number[];
  burst?: number;
}

/**
 * 战场掉落（用户：对战中偶尔掉宝箱、蟠桃、磁铁，做成修仙化的替代品）：
 * chest 乾坤宝匣（随机奖励）、peach 蟠桃（回血）、magnet 聚灵符（把场上灵石全部吸过来）。
 */
export type DropKind = 'chest' | 'peach' | 'magnet';
export interface Drop {
  id: number;
  kind: DropKind;
  x: number;
  y: number;
  px: number;
  py: number;
  t: number; // 掉出来多久了
  life: number; // 多久后消失
  rich?: boolean; // 精英掉的宝匣：奖励更好（多半是碎片）
  pulled?: number; // 波末收灵：正飞向哪个玩家（没有 = 停在原地等人来捡）
  fly?: Flight; // 波末收灵的这一趟飞行（运行时）
}

/**
 * 波末收灵时一件东西（灵石、掉落）的飞行，按时间驱动：从 (x, y) 起飞、飞 dur 秒，已经飞了 t 秒。
 * 从静止匀加速飞向人物（位置 = 起点 + (人物 − 起点) × (t / dur)²），到点一定飞到（见 drops.collectFlight / flyStep）。
 * 起飞时已经在动的灵石，(x, y) 是往后推出来的「静止起点」、t 从大于 0 开始。
 */
export interface Flight {
  x: number;
  y: number;
  t: number;
  dur: number;
}

export interface Gem {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  value: number;
  pulled: number;
  vac?: boolean; // 波末收灵：被一口气吸过来的（价值已按八折算）
  mag?: boolean; // 被聚灵符吸过（价值已按 DROPS.magnetBonus 加过）：不再加第二次，波末收灵也不打折
  ingot?: boolean; // 赵公明神通「金鞭」从金缝里迸出来的金元宝（照灵石算，value 大一些；画面在 game/heroes/jinbian-fx.ts，不画成灵石）
  fly?: Flight; // 波末收灵的这一趟飞行（运行时）
}

/** 玩家受伤的来源。 */
export type HurtBy = 'contact' | 'orb' | 'boss' | 'spear' | 'charge' | 'blast' | 'thunder' | 'ten' | 'wind' | 'sword' | 'flysword' | 'qi' | 'tether' | 'tide' | 'blade' | 'recoil' | 'echo'; // spear 长矛兵刺击；charge 骑兵冲锋；blast 自爆鬼炸开；thunder 天绝阵的天雷；wind 风吼妖的冲刺；sword 四剑轮斩的剑气；flysword 飞剑灵；qi 截教门徒的剑气；tether 阵图傀儡的剑气线；tide 东海夜叉的浪（冒出水面、拍浪）；blade 截教剑侍的小剑；recoil 精英词缀「反震」；echo 回响化身遭遇战的招式与贴身（sim/echo/）
/**
 * 伤害来源（hit 事件的 by）。第二行是剩下 8 件公共法宝的：lash 打神鞭（鞭子、鞭痕、震波）、slash 化血神刀、
 * gust 定风珠吹散、beam 阴阳镜光束、wave 五火七禽扇火浪、bird 七禽火鸟、rope 捆仙绳（勒住与缚仙互撞）、
 * tide 玄元控水旗展开水域时中心涌起的水柱。
 * 定风珠风雷的落雷用 chain；旋风反复伤害、青莲荆棘、水域、焦土都是区域，用 zone。
 * relic：灵物、符箓打出的伤害（金刚琢印、九龙玉佩、风雷羽、引雷符；不打印记、不暴击，见 relics.ts）。
 */
export type HitBy = 'ring' | 'skill' | 'thrust' | 'aura' | 'chain' | 'slam' | 'knife' | 'spike' | 'burn' | 'shield' | 'explode' | 'bleed' | 'thunder' | 'zone' | 'react'
  | 'lash' | 'slash' | 'gust' | 'beam' | 'wave' | 'bird' | 'rope' | 'tide' | 'relic'
  | 'cleave' | 'stab' | 'chop' // 第三行：杨戬 · 三尖两刃刀的横扫、刺击、仙品起的「劈山」
  | 'dou' // 云霄 · 混元金斗：喷出来摔下（和器灵「倒海」一路撞翻的）。九曲黄河的水和别的神通一样是 skill
  | 'ten' // 第二章「十阵轮转」的阵伤到的敌人（地形的伤害：不打印记、不暴击，击杀记给离得最近的人）
  | 'sword' // 第三章「四剑轮斩」斩过的敌人（地形的伤害：不打印记、不暴击，击杀记给离得最近的人）
  | 'bead' // 赵公明 · 定海珠砸地（含仙品起石纹的再一震）
  | 'loong' // 回响敖丙 · 游龙戟的冰龙咬的一口（含仙品起尽头炸开的那片冰）
  | 'wheel' // 魔化哪吒 · 黑焰轮碾过（含器灵「红莲」炸开的那一朵）
  | 'lasso' // 回响赵公明 · 缚龙索（缠上的一勒、拽到一起撞的一下、千钧砸下）
  | 'scroll' // 回响云霄 · 乾坤图（铺开裹住的一下、镇山压下）
  | 'staff' | 'rock' // 孙悟空 · 如意金箍棒的横扫与竖劈、仙品起「定海」震出的石刺
  | 'cudgel' // 雷震子 · 黄金棍（掠过、砸下、仙品起雷纹的再一炸）
  | 'wx' // 五行三件档打出的伤害：金「斩杀」迸出的金气、土「不动如山」的震地（sim/wuxing.ts；不打印记、不相生、不再连锁）
  | 'pestle' | 'stone' | 'nail' | 'jiao' | 'geyser' | 'crow' | 'surge' | 'net' | 'sweep' | 'gem' | 'plague' | 'coin' // 再加的 11 件（sim/arti2.ts）：pestle 降魔杵、stone 五光石（石子和仙品碎成的五色光）、nail 攒心钉（钉进去、钻心）、
  // jiao 金蛟剪（咬、交剪、绞）、geyser 离地焰光旗的地火、crow 万鸦壶的火鸦（俯冲啄烧、仙品起最后自焚炸开）、surge 四海瓶的浪头（撞上、推到头砸下）、
  // net 雾露乾坤网（收网、仙品缩成水球砸下）、sweep 七宝妙树的一刷、gem 七宝妙树飞出去的宝、plague 瘟癀伞的瘟（持续掉血：不暴击、不打印记、金光挡不住）、
  // coin 落宝金钱的一敲（和敲出去的钱声）
  | 'bean' | 'rain' | 'dun'; // 功法（techniques.ts）：bean 撒豆成兵的豆兵一斩、rain 呼风唤雨的雨、dun 土遁遁走时迸起的土石
/**
 * 延时落下 / 延时结算的效果种类（先预警、后结算）。lash：打神鞭从天抽下的一鞭（跟着目标走）；bead：定海珠飞出去砸地（sim/heroes/zhao.ts）；
 * staff：黄金棍飞出去掠过敌群、砸下（sim/heroes/leizhenzi.ts；跟着目标走，seq 0 是半路的「掠过」）；rock：金箍棒仙品起「定海」竖劈落地之后震出的一圈石刺（sim/heroes/wukong.ts）。
 */
export type PendingKind = 'slam' | 'spike' | 'thunder' | 'frost' | 'lash' | 'bead' | 'staff'
  | 'rock' // 孙悟空 · 金箍棒「定海」的石刺
  | 'pestle' // 再加的 11 件（sim/arti2.ts）：pestle 降魔杵从天砸下 / 弹起落向下一只（跟着目标走）
  | 'geyser' // 离地焰光旗：旗边一只敌人脚下先亮、再窜起地火（跟着目标走）；仙品起一路窜到下一只（seq 第几窜，chain 这一路第一窜的 id）
  | 'dive'; // 万鸦壶：一只火鸦俯冲啄向一只敌人（跟着目标走）；seq 是第几只鸦、chain 是鸦群那块区域的 id；ring 不为 0 = 仙品最后自焚（炸开的半径）

export type SimEvent =
  | { t: 'throw'; owner: number; x: number; y: number; kind?: WeaponKind; tier?: number }
  | { t: 'hit'; id: number; kind: EnemyKindName; x: number; y: number; dmg: number; crit: boolean; by: HitBy }
  | { t: 'kill'; id: number; kind: EnemyKindName; x: number; y: number; owner: number; execute: boolean }
  | { t: 'pickup'; owner: number; x: number; y: number; value: number }
  | { t: 'hurt'; owner: number; x: number; y: number; dmg: number; hp: number; by: HurtBy }
  | { t: 'dodge'; owner: number; x: number; y: number }
  | { t: 'blocked'; owner: number; x: number; y: number; by: 'shield' | 'huxin' | 'tishen' }
  | { t: 'corrode'; owner: number; x: number; y: number; dmg: number; depth: number }
  | { t: 'cast'; id: number; x: number; y: number }
  | { t: 'orb'; id: number; x: number; y: number }
  | { t: 'dispel'; x: number; y: number }
  // 气血打空倒下（保命的莲花化身、替身符都没救回来）。t2 只在联机时有：倒地了，t2 秒内没人扶就出局（单人没有这个字段：倒下就陨落）
  | { t: 'down'; owner: number; x: number; y: number; t2?: number }
  // 神通。没有 kind 的是哪吒「三头六臂」（原来的样子，radius 是冲击波的半径）；kind 'gaze' 是杨戬「天眼」：
  // 金光以 (x, y) 为圆心、半径 radius，在 dur 秒内从 a − dir × arc 扫到 a + dir × arc（扫的过程在 Player.gaze 上）；
  // kind 'huanghe' 是云霄「九曲黄河」：以 (x, y) 为圆心铺开半径 radius 的一圈黄河水，dur 秒后砸下（卷着谁在 Player.river 上）
  | { t: 'skill'; owner: number; x: number; y: number; radius: number; kind?: SkillId; a?: number; arc?: number; dir?: number; dur?: number }
  | { t: 'spawn'; id: number; kind: EnemyKindName; x: number; y: number }
  // 包围：在 (x, y) 那个人的四周围一圈兵。owner 只在联机时有：围的是谁（每个活着的人各围一圈、各发一条；单人没有这个字段）
  | { t: 'surge'; x: number; y: number; owner?: number }
  | { t: 'thrust'; owner: number; x0: number; y0: number; x1: number; y1: number; kind?: WeaponKind; tier?: number }
  | { t: 'aura'; owner: number; x: number; y: number; r: number; kind?: WeaponKind; tier?: number }
  | { t: 'chain'; owner: number; pts: [number, number][]; kind?: WeaponKind; tier?: number }
  | { t: 'warn'; id: number; kind: PendingKind; x: number; y: number; r: number; t2: number; tier?: number }
  | { t: 'land'; id: number; kind: PendingKind; x: number; y: number; r: number; tier?: number; quake?: boolean }
  | { t: 'shieldUp'; owner: number; tier?: number; kind?: WeaponKind }
  | { t: 'shieldBreak'; owner: number; x: number; y: number; r: number; tier?: number }
  | { t: 'freeze'; id: number; x: number; y: number }
  | { t: 'explode'; x: number; y: number; r: number }
  // 五行三件档（sim/wuxing.ts）：金气（从 x,y 斩到 ids 里那几只，pts 是落点）、藤蔓（缠住 ids）、震地（以 x,y 为心、半径 r）。tier 是这一行的件数（3 / 4）
  | { t: 'wx'; kind: 'jinqi' | 'vine' | 'quake'; owner: number; x: number; y: number; r?: number; ids?: number[]; pts?: [number, number][]; tier: number }
  | { t: 'levelup'; owner: number; level: number }
  | { t: 'wrap'; owner: number; x: number; y: number; r: number; ids: number[]; branch: PetBranch | null; dur: number }
  // 五行相生：id / x / y 是触发的那只敌人。可选字段给表现层画：pts 导雷多跳出去的落点（从触发处起），r 引燃 / 熔岩波及的半径
  | { t: 'react'; id: number; x: number; y: number; kind: ReactionKind; owner: number; pts?: [number, number][]; r?: number }
  | { t: 'evolve'; owner: number; stage: number; branch: PetBranch }
  | TechEvent
  | HeroEvent // 角色的专属法宝与宠物（三尖两刃刀、哮天犬），见下面
  | { t: 'waveStart'; wave: number; duration: number }
  | { t: 'waveEnd'; wave: number }
  | { t: 'shopOpen'; wave: number }
  | { t: 'bought'; owner: number; offer: ShopOffer; result: string }
  | { t: 'drop'; id: number; kind: DropKind; x: number; y: number; rich?: boolean }
  | { t: 'loot'; id: number; owner: number; kind: DropKind; x: number; y: number; reward: string }
  | { t: 'chapterClear'; chapter: number }
  | { t: 'win' }
  | { t: 'over' }
  | EliteEvent // 精英（sim/elites/）：夜叉潜水与拍浪、力士的金光、剑侍的剑、反震、召唤、分魂
  // ---- 剩下 8 件公共法宝（artifacts 分支）的事件。kind 是法宝、tier 是品阶；画面照这些和 world.zones 里的状态画 ----
  // 打神鞭抽中：target 被抽的那只（id 是这一鞭的 Pending id，和之前的 warn / land 对得上）；鞭痕是过 (x, y)、朝 a 方向、长 len 的一道；
  // ring 仙品起落点震出的一圈的半径（0 = 没有）；seq 器灵「九节」的第几鞭（1..3，没有九节就是 1）
  | { t: 'lash'; id: number; owner: number; target: number; x: number; y: number; a: number; len: number; ring: number; seq: number; kind: WeaponKind; tier: number }
  // 化血神刀斩出一道月牙血光：从 (x, y) 朝 a 方向、半径 r、半张角 arc 的扇面
  | { t: 'slash'; owner: number; x: number; y: number; a: number; r: number; arc: number; kind: WeaponKind; tier: number }
  // 化血神刀仙品「化血」：带着流血死掉的敌人在 (x, y) 化成血雾，把流血传给半径 r 内的敌人（ids）
  | { t: 'mist'; owner: number; x: number; y: number; r: number; ids: number[]; kind: WeaponKind; tier: number }
  // 回血：化血神刀「噬魂」（流血每跳吸回来的）、青莲结界（站在里面的）。每 0.5 秒报一次，amount 是这段时间一共回了多少
  | { t: 'heal'; owner: number; x: number; y: number; amount: number; kind: WeaponKind; tier: number }
  // 一块持续效果出现（定风珠旋风、青莲结界、阴阳镜光束、玄元控水旗水域、五火七禽扇火浪与焦土、捆仙绳金绳）：
  // id 是 world.zones 里那块的 id，zone 是种类；角度、扇面、捆住了谁这些细节在区域对象上（见 Zone）
  | { t: 'zone'; id: number; zone: ZoneKind; owner: number; x: number; y: number; r: number; life: number; kind: WeaponKind; tier: number }
  // 上面那些持续效果到时结束。effect 是结束时的收招：gust 旋风吹散（击退 + 伤害）、root 定风珠「定海」（定身）、
  // freeze 玄元控水旗「寒潭」（冻住）；ids 是收招打到 / 定住 / 冻住的敌人
  | { t: 'zoneEnd'; id: number; zone: ZoneKind; owner: number; x: number; y: number; r: number; kind: WeaponKind; tier: number; effect?: 'gust' | 'root' | 'freeze'; ids?: number[] }
  | FoeEvent
  | BossEvent
  | TerrainEvent // 第二章的地形「十阵轮转」（sim/ch2/types.ts）
  | Ch2FoeEvent // 第二章的新敌人（风吼妖的冲刺、红沙傀儡碎开）
  | YaoEvent // 第二章首领姚天君的招式（sim/ch2/yao.ts）
  | SwordEvent // 第三章的地形「四剑轮斩」（sim/ch3/types.ts）
  | Ch3FoeEvent // 第三章的新敌人（飞剑灵瞄准与射出、截教门徒掷剑气、阵图傀儡的剑气线）
  | ZhuxianEvent // 第三章首领诛仙剑灵的招式（sim/ch3/zhuxian.ts）
  | EchoEvent // 回响化身遭遇战（第 10、16 波的精英换成回响赵公明 / 回响云霄；sim/echo/）
  | CoopEvent
  | RelicEvent
  | Arti2Event; // 再加的 11 件法宝（sim/arti2.ts）

/**
 * 再加的 11 件法宝的事件（sim/arti2.ts 发出；表现层 fx-new2.ts 据此画、放音效）。kind 是哪一件，act 是哪一下，(x, y) 是发生的位置：
 * - zanxin 攒心钉：act 'drill' 钉满一齐钻心（id 那一只，v 钻进去几枚）。
 * - yanguang 离地焰光旗：act 'hop' 人走远了，旗拔起来跟过去重插（(x, y) 新插的地方，pts [[旧 x, 旧 y]]）。
 * - sihai 四海瓶：act 'crash' 浪头推到头砸下（id 那道浪头，(x, y) 浪头中点，r 浪头半宽，v 朝向；ids 砸中的）。
 * - wenhuang 瘟癀伞：act 'spread' 瘟从一只传给身边的（id 传出去的那只，ids 传到的）；act 'down' 叠满三层瘟倒（id）。
 * - luobao 落宝金钱：act 'knock' 敲一下（id 那一只，r 震开的半径）；act 'drop' 附着的那只死了「落宝」（(x, y) 掉灵石的地方，v 多掉几枚）；
 *   act 'hop' 金钱飞向下一只（id 下一只，pts [[从哪儿飞]]）。
 * - wulu 雾露乾坤网：act 'spring' 收网（id 那张网，ids 网住的，r 网的半径）；act 'miss' 张够了也没等到敌人，网散了；
 *   act 'slam' 仙品「乾坤」缩成水球砸下（(x, y) 网心，r 砸开的半径）。
 * - jinjiao 金蛟剪：act 'dart' 金蛟扑出去（ids 扑向的那几只，r 是几条一组，v 扑多久）；act 'snip' 交剪（id 剪中的那只，(x, y) 剪口）；
 *   act 'coil' 器灵「绞龙」缠住（id，v 缠多久）。绕身盘旋本身不发事件，表现层读 world.zones 里的 orbit。
 * 每帧都在的状态（敌人身上的钉子……）不另发事件，表现层直接读 Enemy 上的字段。
 */
export type Arti2Event = {
  t: 'arti2';
  kind: WeaponKind;
  act: string;
  owner: number;
  x: number;
  y: number;
  tier: number;
  id?: number;
  ids?: number[];
  pts?: [number, number][];
  r?: number;
  v?: number;
};

/**
 * 灵物、符箓、丹药的事件（relics.ts 发出；表现层 relic-fx.ts 据此画、放音效）。kind 是哪一件，owner 是谁的，(x, y) 是发生的位置：
 * - 灵物：zhuo 金刚琢印砸下（ids / pts 被砸的敌人和它们的位置，r 范围；r 为 0 = 身边没有敌人，砸向最近的一只）；
 *   jadedragon 九龙玉佩炸开（id 触发相生的那只，r 半径，react 哪种相生）；mirror 照妖镜照出一只（id，t2 照多久）；
 *   umbrella 混元伞挡下一枚鬼火；pouch 乾坤袋生出灵石（v 枚）；stormfeather 风雷羽引下小雷（id 劈中的那只，pts [暴击的那只, 劈中的那只]）；
 *   cloudshoe 踏云履起步；dingyan 定颜珠打中定住的敌人（id）；icevase 冰心玉壶（v 这一波没被打中、多得的灵石）；
 *   gu 噬心蛊开波噬血（v 掉了多少）；drum 夔牛鼓擂一通（t2 鼓劲多久）；incense 燃魂香放神通时燃血（v 掉了多少）；
 * - 符箓：dingshen 定身符（ids 定住的，r，t2 多久）；yinlei 引雷符（ids 劈到的，r）；dundi 遁地符（t2 遁地多久）；shenxing 神行符（t2）；
 *   zhaobao 招宝符（id 掉出来的宝匣）；huiling 回灵符（v 回到的真气）；
 * - 丹药：ningshen 凝神丹（开波真气满）。
 * 持续的状态（入定、逆鳞、踏云、遁地、神行、鼓劲、桃木簪辟秽、照妖镜照着的敌人）不另发事件，表现层每帧读 Player.relic / Enemy.revealUntil。
 */
export type RelicEvent = {
  t: 'relic';
  kind: RelicId | CharmId | ElixirId;
  owner: number;
  x: number;
  y: number;
  id?: number;
  ids?: number[];
  pts?: [number, number][];
  r?: number;
  t2?: number;
  v?: number;
  react?: ReactionKind;
};

/**
 * 角色的专属法宝与宠物的事件（sim/heroes/、sim/pets/ 发出；画面在 game/heroes/、game/pets/）。
 */
export type HeroEvent =
  // 三尖两刃刀横扫：从 (x, y)（人物胸口）朝 a 方向、半径 r、半张角 arc 的扇面，刀从 a − dir × arc 扫到 a + dir × arc；
  // back：器灵「回锋」反手扫回来的那一刀（方向和前一刀相反）
  | { t: 'cleave'; owner: number; x: number; y: number; a: number; r: number; arc: number; dir: number; back?: boolean; kind: WeaponKind; tier: number }
  // 三尖两刃刀刺击：刀尖从 (x0, y0) 刺到 (x1, y1)，贯穿沿线的敌人；seq 第几刺（器灵「回锋」连刺两下）
  | { t: 'stab'; owner: number; x0: number; y0: number; x1: number; y1: number; seq: number; kind: WeaponKind; tier: number }
  // 仙品起「劈山」：刀从头顶劈下，地上从 (x0, y0) 到 (x1, y1) 裂开一道金光（半宽 w，地面高度），裂缝上的敌人挨一下、顿一顿
  | { t: 'chop'; owner: number; x0: number; y0: number; x1: number; y1: number; w: number; kind: WeaponKind; tier: number }
  // 哮天犬咬了一口：(x, y) 是嘴的位置（地面高度），ids 被咬的敌人（破甲 dur 秒）；branch 宠物走的那条路
  | { t: 'bite'; owner: number; x: number; y: number; ids: number[]; dur: number; branch: PetBranch | null }
  // 混元金斗（一斗的全过程在 Player.dou 上）：act 'cast' 金斗起飞，飞向 (x, y)；'suck' 斗口一倾，吸进 ids（r 吸的半径）；
  // 'spit' 喷出 ids（落点在 Player.dou.land）；'land' 摔下：ids 是摔下的，hit 是落地震到 / 倒海一路撞到的别的敌人。
  // pour：身边只有吸不进去的时候，金斗浇的是哪一只（这时 'spit' 是开始浇、'land' 是浇下去那一下，ids 是空的）
  | { t: 'dou'; owner: number; act: 'cast' | 'suck' | 'spit' | 'land'; x: number; y: number; r: number; ids: number[]; hit?: number[]; tier: number; spirit: string | null; pour?: number }
  // 青鸾洒下一片冰羽：(x, y) 是羽毛落下的地方（地面高度）、r 半径，ids 沾上寒羽的敌人（dur 秒）；frozen 其中被冻住的
  | { t: 'feather'; owner: number; x: number; y: number; r: number; ids: number[]; frozen: number[]; dur: number; branch: PetBranch | null }
  // 九曲黄河砸下：(x, y) 圆心、r 圈的半径，ids 被砸到的
  | { t: 'riverSlam'; owner: number; x: number; y: number; r: number; ids: number[] }
  // 定海珠飞出去一颗：t2 秒后砸在 (x, y)（地面高度），震开半径 r；id 是它的 Pending id（和之后的 land 对得上）。
  // spirit：器灵（'rosary' 二十四珠绕成一圈依次砸下的一颗，seq 是第几颗、(cx, cy) 是那一圈的圆心；'anchor' 镇海的巨珠）
  | { t: 'bead'; owner: number; id: number; x: number; y: number; r: number; t2: number; kind: WeaponKind; tier: number; spirit?: string; seq?: number; cx?: number; cy?: number }
  // 金鞭砸下：沿 (x0, y0) → (x1, y1)（地面高度）、半宽 w；ids 被砸中的敌人；地上的金缝 life 秒后合上（状态在 Player.whip）；ingots 迸出来的金元宝（Gem id）
  | { t: 'whip'; owner: number; x0: number; y0: number; x1: number; y1: number; w: number; life: number; ids: number[]; ingots: number[] }
  // 黑虎扑过敌群、在 (x, y) 吼一声：半径 r 内的 ids 被震慑 dur 秒；branch 黑虎走的那条路
  | { t: 'roar'; owner: number; x: number; y: number; r: number; ids: number[]; dur: number; branch: PetBranch | null }
  // 黑虎「破财」：被震慑时被打死的 id 多掉了一颗灵石（gem 是那颗灵石的 id）
  | { t: 'broke'; id: number; gem: number; x: number; y: number }
  // 黄金棍飞出去：从 (x0, y0)（地面高度）飞向 (x, y)，t2 秒后砸下（id 是它的 Pending id，和之后的 land 对得上；落点跟着目标走）；
  // seq 第几砸（灵品起弹一下再砸一处、器灵「奔雷」连砸三处：后面几砸的 (x0, y0) 是上一砸的落点）；spirit 器灵
  | { t: 'staff'; owner: number; id: number; x0: number; y0: number; x: number; y: number; r: number; t2: number; tier: number; seq: number; spirit?: string }
  // 风雷翅俯冲：从 (x0, y0) 飞向 (x1, y1)（都是地面高度），t2 秒后砸下；seq 第几下
  | { t: 'dive'; owner: number; x0: number; y0: number; x1: number; y1: number; t2: number; seq: number }
  // 风雷翅砸下：(x, y) 落点、r 风浪的半径，ids 被砸到的；seq 第几下（最后一下之后落地）
  | { t: 'wingSlam'; owner: number; x: number; y: number; r: number; ids: number[]; seq: number }
  // 雷鹏俯冲：开始沿 path（地面坐标的折线）贴地掠过
  | { t: 'stoop'; owner: number; path: number[]; branch: PetBranch | null }
  // 雷鹏掠过时麻到的：(x, y) 是它正下方的地面、r 半径，ids 沾上「麻痹」的敌人（dur 秒）
  | { t: 'zap'; owner: number; x: number; y: number; r: number; ids: number[]; dur: number; branch: PetBranch | null }
  // 麻痹的敌人一颤（id）；霹雳：电跳到了身边的 to（没有 = 没跳）
  | { t: 'twitch'; id: number; x: number; y: number; to?: number; tx?: number; ty?: number }
  // 黑焰轮滚出去一只：从 (x, y)（地面高度）沿 (ux, uy) 滚 len 长；id 是 Player.wheels 里那只的 id（之后的 wheelTurn / wheelBurst 对得上）
  | { t: 'wheel'; owner: number; id: number; x: number; y: number; ux: number; uy: number; len: number; r: number; tier: number; spirit?: string }
  // 黑焰轮滚到尽头掉头（仙品「轮回」起）；红莲：器灵「红莲」在 (x, y) 炸开一朵红莲业火，半径 r
  | { t: 'wheelTurn'; owner: number; id: number; x: number; y: number }
  | { t: 'wheelBurst'; owner: number; id: number; x: number; y: number; r: number }
  // 火尖枪突进：蓄力完、开始冲（蓄力在 skill 事件里，那里的 dur 是蓄力多久）：沿 (x0, y0) → (x1, y1)、半宽 w，dur 秒冲完；冲过的那条线烧 life 秒
  | { t: 'tujin'; owner: number; x0: number; y0: number; x1: number; y1: number; w: number; dur: number; life: number }
  // 回响敖丙（sim/heroes/huiao.ts）：loong 一条冰龙从戟尖游出去（之后的位置每帧读 Player.loongs）；loongBite 咬了一口；
  // loongEnd 这条龙游完了（burst > 0：仙品起在 (x, y) 炸开一片半径 burst 的冰）；hualongEnd 化龙结束、落地掀一圈半径 r 的浪
  | { t: 'loong'; owner: number; id: number; x: number; y: number; tier: number; spirit?: string }
  | { t: 'loongBite'; owner: number; id: number; target: number; x: number; y: number }
  | { t: 'loongEnd'; owner: number; id: number; x: number; y: number; burst: number }
  | { t: 'hualongEnd'; owner: number; x: number; y: number; r: number }
  // 避水兽（sim/pets/bishui.ts）：冲过敌群，浪往两边推开、打湿（ids）
  | { t: 'splash'; owner: number; x: number; y: number; ux: number; uy: number; ids: number[]; dur: number; branch: PetBranch | null }
  // 缚龙索甩出去缠住 ids，往 (cx, cy) 拽 dur 秒；id 是 Player.ropes 里那根（之后的 lassoEnd 对得上）
  | { t: 'lasso'; owner: number; id: number; x: number; y: number; cx: number; cy: number; ids: number[]; dur: number; tier: number; spirit: string | null }
  // 拽到一起：撞了一下（ids），lock 锁住了多久（仙品起；0 = 没锁），slam 器灵「千钧」砸下的半径（0 = 没砸）
  | { t: 'lassoEnd'; owner: number; id: number; cx: number; cy: number; ids: number[]; lock: number; slam: number }
  // 钉头七箭：ids 钉上了草人符，t2 秒后一起落箭；nailHit 落箭（ids 中箭的）
  | { t: 'nail'; owner: number; ids: number[]; t2: number }
  | { t: 'nailHit'; owner: number; ids: number[] }
  // 怨力攒满：在 (x, y) 放一圈震波，半径 r，ids 震到的
  | { t: 'grudge'; owner: number; x: number; y: number; r: number; ids: number[] }
  // 乾坤图铺开：(x0, y0) → (x1, y1)，半宽 hw，ids 被裹住 wrap 秒；id 是 Player.scrolls 里那一卷（之后的 scrollPress 对得上）
  | { t: 'scroll'; owner: number; id: number; x0: number; y0: number; x1: number; y1: number; hw: number; ids: number[]; wrap: number; tier: number; spirit: string | null }
  // 镇山：山影压下（ids 压到的；big 器灵「麒麟崖」压整卷）
  | { t: 'scrollPress'; owner: number; id: number; ids: number[]; big: boolean }
  // 黄河阵 · 削顶：在 (x, y) 摆下半径 r 的阵，dur 秒（放的时候在 skill 事件里，这里是摆下的那一刻）
  | { t: 'formation'; owner: number; x: number; y: number; r: number; dur: number }
  // ---- 孙悟空（sim/heroes/wukong.ts、sim/pets/maohou.ts；画面在 game/heroes/jingu-fx.ts、faxiang-fx.ts、game/pets/maohou-fx.ts）----
  // 金箍棒横扫一圈：以 (x, y)（人物胸口）为圆心、半径 r，棒子从 a 起朝 dir 方向（1 顺时针 / −1 逆时针，屏幕坐标）转一整圈；
  // spin 第几圈（器灵「搅海」连转三圈，平常就是 1）；big 法天象地期间（棒子画大）
  | { t: 'staffSweep'; owner: number; x: number; y: number; r: number; a: number; dir: number; spin: number; kind: WeaponKind; tier: number; big?: boolean }
  // 金箍棒竖劈：棒子举过头顶朝 (x1, y1) 劈下，砸在从 (x0, y0) 到 (x1, y1) 的一条线上（地面高度，半宽 w）；
  // spirit 'qingtian' 是器灵「擎天」那一下（棒子变得又长又粗）；big 法天象地期间
  | { t: 'staffSmash'; owner: number; x0: number; y0: number; x1: number; y1: number; w: number; kind: WeaponKind; tier: number; spirit?: string; big?: boolean }
  // 法天象地长足的那一下：脚下 (x, y) 一震，半径 r 内的 ids 被震开
  | { t: 'stomp'; owner: number; x: number; y: number; r: number; ids: number[] }
  // 毫毛猴拔一撮毫毛一吹：从 (x, y) 吹出几只小猴分身（imps 是 Pet.imps 里它们的 id）
  | { t: 'hair'; owner: number; x: number; y: number; imps: number[] }
  // 一只小猴分身窜过 (x, y)：ids 被「戏弄」dur 秒（branch 毫毛猴走的那条路；定身法先定住、瞌睡虫更慢）
  | { t: 'tease'; owner: number; imp: number; x: number; y: number; ids: number[]; dur: number; branch: PetBranch | null }
  // 一只小猴分身窜完了，在 (x, y) 化回一根毫毛
  | { t: 'impEnd'; owner: number; imp: number; x: number; y: number };

/**
 * 联机的事件（coop.ts / roster.ts 发出；单人一条都不发）。owner 是那个人物的 id（= w.players 的下标），(x, y) 是他脚下的位置。
 * 倒地本身是上面的 'down' 事件（带 t2）；持续的状态 —— 还剩几秒（Player.down）、扶到几成（rescue）、谁在扶（helpers）、
 * 出局（out）、托管（away）、离开（left）—— 都在 Player 上，表现层每帧读；事件只标「变了」的那一刻（放音效、飘字、提示）。
 */
export type CoopEvent =
  // 救援进度：有人开始扶 / 换了人扶 / 扶的人都走开了（by 为空：进度开始回落）。只在「谁在扶」变的那一帧发；k 是此刻的进度 0..1
  | { t: 'rescue'; owner: number; by: number[]; k: number; x: number; y: number }
  // 扶起：回到 hp 点气血（三成），无敌 COOP.reviveIframes 秒；by 是扶满那一刻在扶的队友
  | { t: 'revive'; owner: number; by: number[]; x: number; y: number; hp: number }
  // 出局：倒地 COOP.downT 秒没人扶；waveEnd 为 true = 这一波打完时还倒着，跟着出局。下一波开始时归队
  | { t: 'out'; owner: number; x: number; y: number; waveEnd?: boolean }
  // 归队：出局的人在新一波开始时回来，站到 (x, y)（最近的活着的队友身边），气血 hp（至少一成）
  | { t: 'rejoin'; owner: number; x: number; y: number; hp: number }
  // 中途加入（只在商店阶段）：新人站在 (x, y)，带起手的专属法宝和宠物、lingshi 枚灵石，等级从 1 开始
  | { t: 'join'; owner: number; hero: HeroId; x: number; y: number; lingshi: number }
  // 离开房间：人物从场上消失（他身上的灵石、法宝跟着走）
  | { t: 'leave'; owner: number; x: number; y: number }
  // 掉线托管开始（away 为 true：机器人接手、受到的伤害减半）/ 结束（回来了，接着自己操作）
  | { t: 'away'; owner: number; away: boolean }
  // 商店里转赠灵石：owner 给了 to 共 amount 枚
  | { t: 'gift'; owner: number; to: number; amount: number };

/**
 * 第一章新敌人的事件（enemies.ts 发出；表现层据此画预警与出手、放音效）。id 都是出手的那只敌人。
 * 线段都在地面高度（脚底），(x0, y0) → (x1, y1)，r 是半宽（判定 = 半宽 + 人物半径）。
 */
export type FoeEvent =
  // 蓄力 / 预警开始：长矛兵地上亮出一小段刺击线，骑兵亮出冲锋线；t2 秒后出手。线定下就不跟踪（躲开就打不中）
  | { t: 'foeWindup'; id: number; kind: 'spearman' | 'cavalry'; x0: number; y0: number; x1: number; y1: number; r: number; t2: number }
  // 出手：长矛沿刺击线刺出 / 骑兵沿冲锋线冲过去（dur 秒冲完，之后原地喘息）
  | { t: 'foeStrike'; id: number; kind: 'spearman' | 'cavalry'; x0: number; y0: number; x1: number; y1: number; dur: number }
  // 自爆鬼点燃引信：t2 秒后在原地炸开，半径 r。点燃之后打不死、不吃控制
  | { t: 'foeFuse'; id: number; x: number; y: number; r: number; t2: number }
  // 自爆鬼炸开（这只就此消失，不算击杀、不掉灵石）
  | { t: 'foeBlast'; id: number; x: number; y: number; r: number }
  // 分魂鬼死时分成两只小鬼：ids 是分出来的两只（它们另有 spawn 事件）
  | { t: 'foeSplit'; id: number; x: number; y: number; ids: number[] }
  // 盾兵正面挡下一击（伤害已按比例降低）：a 是盾的朝向（弧度），(x, y) 是挡下的位置
  | { t: 'foeGuard'; id: number; x: number; y: number; a: number };

/** 商店与升级阶段的指令（联机时由各客户端发给房主，单人就是本地直接执行）。 */
export type Command =
  | { t: 'pick'; player: number; index: number }
  | { t: 'evolve'; player: number; branch: PetBranch }
  | { t: 'rerollLevel'; player: number }
  | { t: 'buy'; player: number; slot: number }
  | { t: 'reroll'; player: number }
  | { t: 'lock'; player: number; slot: number }
  | { t: 'sell'; player: number; weapon: number }
  | { t: 'ready'; player: number }
  | { t: 'learn'; player: number; id: TechniqueId } // 悟一门功法（要先选完宠物进化）
  // ---- 联机（单人用不上）----
  | { t: 'unready'; player: number } // 取消「出战」，接着逛（别人都还没按完时）
  | { t: 'give'; player: number; to: number; amount: number }; // 把 amount 枚灵石转给队友 to（docs/design.md「经济」：灵石可以转赠队友）

export interface PlayerInput {
  mx: number;
  my: number;
  skill: boolean;
}
