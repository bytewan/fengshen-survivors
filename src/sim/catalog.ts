// 图鉴与数值表：法宝、灵物、丹药、符箓、升级属性、经验曲线、波次节奏。
// 纯数据。商店、升级界面、平衡模拟都从这里取。
import type { CharmId, Element, ElixirId, HeroId, PetBranch, PetKind, Player, ReactionKind, RelicId, SkillId, StatId, Stats, WeaponKind } from './types.ts';

export const TIER_NAME = ['', '凡', '灵', '仙', '神'];

/** 杨戬的被动「乘隙」：暴击之后 t 秒内移速 +speed（规则在 sim/heroes/yangjian.ts）。 */
export const RUSH = { t: 1, speed: 0.2 };
/**
 * 哪吒的被动「灵珠子」（用户 2026-11-12：「哪吒也得加一个被动」；做法和数值 暂拟，待评审确认）：
 * 灵珠转世，打死敌人攒的真气多 charge——三头六臂放得更勤。规则在 sim/heroes/passives.ts（core.onKill 乘上）。
 */
export const LINGZHU = { charge: 0.25 };
/** 赵公明的被动「招财」：拾到的灵石 +gem（只加灵石，不加经验；规则在 sim/heroes/passives.ts，world.credit 调）。 */
export const ZHAOCAI = { gem: 0.15 };
/** 黑虎「震慑」的敌人往外逃：比平常走得快这么多倍（慌不择路；减速照样吃）。规则在 sim/heroes/passives.ts，数值的其余部分在 sim/pets/heihu.ts。 */
export const FEAR = { run: 1.2 };
/** 云霄的被动「冰心」：冻住的敌人受到她的伤害 +BINGXIN（规则在 sim/heroes/passives.ts）。 */
export const BINGXIN = 0.2;
/** 孙悟空的被动「火眼金睛」：打精英、首领的伤害 +elite（规则在 sim/heroes/passives.ts，core.hitEnemy 乘上）。 */
export const HUOYAN = { elite: 0.1 }; // 2026-11-11 数值平衡 0.15 → 0.1（见 sim/heroes/wukong.ts 的 FAXIANG.dmg）

/**
 * 隐藏角色（用户 11-11 确认）：靠秘密条件解锁，解锁前选角、图鉴、联机大厅里都只露一个问号剪影（不露名字）。
 * unlock 是存档里解锁的 id（game/profile.ts 的 unlock / isUnlocked）；hint 是解锁前那一句暗示。
 * 孙悟空：通关一次（第三章首领倒下，任意劫）之后，标题页的天上多一道金色裂缝，点它放一段过场、解锁（game/wukong-rift.ts）。
 */
export const HIDDEN: Partial<Record<HeroId, { unlock: string; hint: string }>> = {
  wukong: { unlock: 'wukong', hint: '天穹似有一道裂隙……' },
};

/**
 * 魔化哪吒的被动「业火」：气血越低伤害越高——满血不加，气血每少一截加一截，降到 full 这一成（25%）及以下吃满 max（+45%）。
 * 规则在 sim/heroes/passives.ts（core.hitEnemy 乘上）。他的气血上限也比别人低一点（HEROES.mozha.maxHp）：低血高爆发、冲阵。
 */
export const YEHUO = { max: 0.45, full: 0.25 };
/**
 * 回响敖丙的被动「龙鳞」：和魔化哪吒的「业火」正相反——鳞甲完好时最强：气血在 full（九成）以上伤害 +max，
 * 往下一截一截地减，掉到 none（五成）就不加了。规则在 sim/heroes/passives.ts（core.hitEnemy 乘上）。玩法：别挨打。
 */
export const LONGLIN = { max: 0.25, full: 0.8, none: 0.3 }; // 2026-11-11 数值平衡：full 0.9 → 0.8、none 0.5 → 0.3（原来掉一成血就开始少、掉一半就没了：越挨打越打不动，机器人多死在第一章）
/**
 * 回响赵公明的被动「怨力」：挨打攒怨，挨够 full 点伤害（护体减过之后的）攒满，从身上震出一圈：半径 r（吃一半范围加成）、
 * 伤害 dmg 倍 SKILL.damage、震开 kb。攒怨在 sim/heroes/passives.ts，震在 sim/heroes/huizhao.ts。
 */
export const YUANLI = { full: 60, r: 70, dmg: 0.9, kb: 260 };
/** 回响云霄的被动「截教」：身边（REACH.max 以内）每有一只被定住、冻住、晕住的敌人，法宝攻速 +per，最多 +cap（规则在 sim/heroes/passives.ts）。 */
export const JIEJIAO = { per: 0.04, cap: 0.24 };

/**
 * 回响化身（变异角色，用户 11-11 确认）：基础角色在某一章里以首领 / 遭遇战的身份出现，打败后解锁。
 * base 是哪个角色的回响；unlock 是存档里解锁的 id（game/profile.ts 的 unlock / isUnlocked；魔化哪吒沿用首领分支早就在用的 demon-nezha）；
 * where：在哪儿遇到（选角页解锁前的那一行）。
 */
export const ECHO: Partial<Record<HeroId, { base: HeroId; unlock: string; where: string }>> = {
  // where：首领池（bosspool.ts）之后每章的首领不固定——他可能是这一章的首领，也可能在第四波来遭遇战，打倒就解锁
  mozha: { base: 'nezha', unlock: 'demon-nezha', where: '第一章击败魔化哪吒后解锁' },
  huizhao: { base: 'zhao', unlock: 'echo-zhao', where: '第二章击败回响赵公明后解锁' },
  huiyun: { base: 'yunxiao', unlock: 'echo-yunxiao', where: '第三章击败回响云霄后解锁' },
  // 回响敖丙：没有本人（base 写他自己）——帧、法宝、宠物都是他自己的一套
  huiao: { base: 'huiao', unlock: 'echo-aobing', where: '第一章击败回响敖丙后解锁' },
};
/**
 * 靠成就解锁的角色（用户 11-12 的方向「把一些道具、法宝、角色做成成就解锁的奖励」；挑谁、什么条件 暂拟，待评审确认）。
 * 成就表在 game/achievements.ts（达成时写进存档的解锁 id）；unlock 是存档里解锁的 id，where 是选角页解锁前那一行。
 */
export const EARNED: Partial<Record<HeroId, { unlock: string; where: string }>> = {
  leizhenzi: { unlock: 'leizhenzi', where: '平定第一章后解锁' },
};
/** 这个角色要不要解锁（回响化身、隐藏角色、成就奖励）：要的话返回存档里的 id，不要就是 null。 */
export const unlockIdOf = (h: HeroId): string | null => ECHO[h]?.unlock ?? HIDDEN[h]?.unlock ?? EARNED[h]?.unlock ?? null;

/** 一个角色（模拟用的那一半；表现的那一半——人物帧、称号、对白名字牌颜色——在 game/hero-views.ts 的 HERO_VIEWS）。 */
export interface HeroDef {
  name: string;
  el: Element; // 主五行：专属法宝属于它，开局这一行亲和 +affStart
  petEl: Element; // 宠物的五行：按宠物自己的来历和名字定（用户 11-12：「宠物和主属性也不一定需要相生」），宠物打这一行的印记、算一件；多半和主五行不同（才凑得出五行俱全），避水兽和敖丙同是水（龙族一身水）
  exclusive: WeaponKind; // 专属法宝（起手自带凡品，不进公共商店）
  pet: string; // 宠物的名字（界面）
  petKind: PetKind; // 宠物的种类：行为在 sim/pets/ 下（按种类分派在 sim/pet.ts），画面在 game/pets/
  petDesc: string;
  affStart: number;
  skill: SkillId; // 神通：放的时候按它分派（sim/heroes/），名字与说明在 sim/heroes/index.ts 的 SKILL_INFO
  passive: { name: string; desc: string } | null; // 被动天赋（规则在 sim/heroes/ 下这个角色的模块里）；null = 没有
  maxHp?: number; // 起手气血上限比别人多（少）多少（魔化哪吒 −5：低血高爆发；赵公明 +15：身板厚）；没有 = 一样
}

/**
 * 角色：每个角色有一个主五行，专属法宝属于它，开局这一行亲和 +affStart；其余法宝自由搭配。
 * 宠物（用户 2026-11-12 改：原来「专属宠物也适配主五行」）固定是**和主五行不同的另一行**（petEl）：宠物打这一行的印记，
 * 五行件数里也算一件（core.elementCounts），所以开局就有两行各一件；专属 + 三件公共法宝 + 宠物正好五件，能凑齐五行。
 * 各角色宠物的五行（由头，暂拟，待评审确认）：混天绫 / 黑绫 水（九湾河一搅，东海龙宫都晃）、哮天犬 土（戌狗属土）、
 * 黑虎 / 魂虎 木（寅虎属木）、青鸾 / 玄鸾 火（鸾是凤类，凤属南方火）、雷鹏 金（金翅大鹏）、毫毛猴 金（申猴属金）、避水兽 土（土克水，逼得水往两边分）。
 * 宠物进化分支里加伤的那一条（火绫「引火」、金牙「裂甲」、沧溟、霹雳、霜髓）仍然跟主人的主五行走——它们加的是专属法宝那一行的伤害，
 * 画面、名字也是照那一行画的；宠物自己带来的是另一行的印记和件数。
 */
export const HEROES: Record<HeroId, HeroDef> = {
  nezha: { name: '哪吒', el: 'fire', petEl: 'water', exclusive: 'qiankun', pet: '混天绫', petKind: 'huntian', petDesc: '混天绫一展，缚住敌群，令其迟滞、露出「破绽」', affStart: 0.1, skill: 'santou', passive: { name: '灵珠子', desc: '灵珠转世，斩敌所积真气更多' } },
  yangjian: {
    name: '杨戬',
    el: 'metal',
    petEl: 'earth',
    exclusive: 'sanjian',
    pet: '哮天犬',
    petKind: 'xiaotian',
    petDesc: '神犬穿阵而过，噬咬敌人，令其「破甲」',
    affStart: 0.1,
    skill: 'gaze',
    passive: { name: '乘隙', desc: '暴击之后乘隙疾进，身法骤快' },
  },
  zhao: {
    name: '赵公明',
    el: 'earth',
    petEl: 'wood',
    exclusive: 'dinghai',
    pet: '黑虎',
    petKind: 'heihu',
    petDesc: '黑虎扑阵一啸，群敌「震慑」溃散',
    affStart: 0.25, // 2026-11-11 数值平衡 0.1 → 0.25：黑虎只吓不加伤（哪吒、杨戬的宠物给敌人加三成多受伤），敌人厚了以后他开局打得最慢，机器人 40 局只通 26 局
    skill: 'jinbian',
    passive: { name: '招财', desc: '武财神临，拾得灵石更多' },
    maxHp: 15, // 2026-11-11 数值平衡：起手气血上限 +15（武财神，身板厚）——定海珠正中那颗压轻以后他开局贴身挨打最多（前五波 50 点，哪吒 24），120 局只通 85 局；加了通 94 局
  },
  yunxiao: {
    name: '云霄',
    el: 'metal',
    petEl: 'water',
    exclusive: 'jindou',
    pet: '青鸾',
    petKind: 'qingluan',
    petDesc: '青鸾掠阵洒羽，敌沾「寒羽」则迟缓，再沾即冻',
    affStart: 0.2, // 2026-11-11 数值平衡 0.1 → 0.2：商店扩到 26 件公共法宝以后她 120 局通 90–93 局，九个角色里最低（第一章首领和回响赵公明打得慢）
    skill: 'huanghe',
    passive: { name: '冰心', desc: '冰心一片，冰封之敌受她伤害更重' },
  },
  leizhenzi: {
    name: '雷震子',
    el: 'wood',
    petEl: 'metal',
    exclusive: 'huangjin',
    pet: '雷鹏',
    petKind: 'leipeng',
    petDesc: '雷鹏电掣俯冲，掠过敌阵，令其「麻痹」',
    affStart: 0.1,
    skill: 'fenglei',
    passive: { name: '生翅', desc: '背生风雷二翅，不为地上阵法所滞' },
  },
  // ---- 回响化身（ECHO：打败对应的首领 / 遭遇战才解锁；法宝、神通、被动都和本体不同，用户 11-11 确认）----
  // 魔化哪吒：第一章首领。低血高爆发、冲阵——气血上限低一点，越残越狠（业火），神通是无敌的一枪冲阵，黑焰轮从脚下朝四面滚出去碾过敌群
  mozha: {
    name: '魔化哪吒',
    el: 'fire',
    petEl: 'water',
    exclusive: 'heiyan',
    pet: '黑绫',
    petKind: 'huntian', // 混天绫换成黑绫：同样的缠缚与破绽，画面是黑红的（game/pet-fx.ts 按角色换颜色）
    petDesc: '黑绫掠阵，缚敌迟滞，令其露出「破绽」',
    affStart: 0.35, // 2026-11-11 数值平衡 0.1 → 0.35（高爆发：黑焰轮朝四面滚，开局敌人稀稀落落时打得慢，机器人用他 40 局只通 23 局，开局几波贴身被打死得多）
    skill: 'tujin',
    passive: { name: '业火', desc: '以血饲火：生来气血稍薄，血愈少，火愈烈' },
    maxHp: -5, // 2026-11-11 数值平衡 −15 → −5（同上；敌人走得快了，低血更容易被贴身打死）
  },
  // 回响赵公明：第二章第 4 波的遭遇战。拉怪成团、再一起炸——缚龙索把一群拽成一团，钉头七箭给七只钉上草人符、三秒后一起重创，挨打攒怨、攒满震一圈
  huizhao: {
    name: '回响赵公明',
    el: 'earth',
    petEl: 'wood',
    exclusive: 'fulong',
    pet: '魂虎',
    petKind: 'heihu', // 黑虎换成回响色的魂虎：同样的震慑（game/pets/heihu-fx.ts 按角色换颜色）
    petDesc: '魂虎扑阵一啸，群敌「震慑」溃散',
    affStart: 0.1,
    skill: 'dingtou',
    passive: { name: '怨力', desc: '受击积怨，怨满则震开周身之敌' },
  },
  // 回响云霄：第三章第 4 波的遭遇战。先控后打——乾坤图裹住一串（仙品起山影压下），黄河阵削去阵里的三花（受伤加深、打人变轻），定住的越多法宝出手越快
  huiyun: {
    name: '回响云霄',
    el: 'metal',
    petEl: 'water',
    exclusive: 'qiankuntu',
    pet: '玄鸾',
    petKind: 'qingluan', // 青鸾换成回响色的玄鸾：同样的寒羽（game/pets/qingluan-fx.ts 按角色换颜色）
    petDesc: '玄鸾掠阵洒羽，敌沾「寒羽」则迟缓，再沾即冻',
    affStart: 0.1,
    skill: 'xueding',
    passive: { name: '截教', desc: '截教旧术：周身受制之敌愈多，法宝出手愈快' },
  },
  // 回响敖丙：第一章首领池里的敖丙（当首领或来第 4 波的遭遇战，打倒就解锁）。游龙穿群、化龙冲阵——游龙戟放出一条冰龙一只接一只咬过去，
  // 神通化成白龙自己冲进敌群（不受伤、游得快），鳞甲完好（气血满）时打得最重；避水兽把敌群推开、打湿，水行的伤害打上去就冻住
  huiao: {
    name: '回响敖丙',
    el: 'water',
    petEl: 'water',
    exclusive: 'youlong',
    pet: '避水兽',
    petKind: 'bishui',
    petDesc: '避水兽破浪穿阵，分开敌群，令其「湿透」',
    affStart: 0.3, // 2026-11-11 数值平衡 0.1 → 0.3：游龙戟一口一口咬、每下轻（凡品 16），开局五波只打死 195 只（哪吒 262），机器人 120 局只通 78 局
    skill: 'hualong',
    passive: { name: '龙鳞', desc: '鳞甲完好时威势最盛，气血愈满，伤害愈高' },
  },
  // 孙悟空（隐藏角色，见 HIDDEN；用户 11-11 确认）：主五行金（用户 11-12 改：金箍棒是金；原来是木）
  wukong: {
    name: '孙悟空',
    el: 'metal',
    petEl: 'earth',
    exclusive: 'jingu',
    pet: '毫毛猴',
    petKind: 'maohou',
    petDesc: '吹一口毫毛，化作群猴，窜阵「戏弄」敌人',
    affStart: 0.1,
    skill: 'faxiang',
    passive: { name: '火眼金睛', desc: '识破妖魔根脚，对精英、首领伤害更重' },
  },
};

/**
 * 五行相生（用户：不同属性之间要有搭配、增强）。from 的印记被 to 行的法宝打中时触发，消耗印记（规则见 core.hitEnemy）。
 * 数值在 REACT 里；desc 是给玩家看的说明，改数值时一起改。
 */
export const REACTIONS: Record<ReactionKind, { name: string; from: Element; to: Element; desc: string }> = {
  frost: { name: '凝霜', from: 'metal', to: 'water', desc: '金生水：金气化霜，重创并冻结' },
  conduct: { name: '导雷', from: 'water', to: 'wood', desc: '水生木：水导雷行，伤势加重，雷光再跳' },
  ignite: { name: '引燃', from: 'wood', to: 'fire', desc: '木生火：薪尽火传，烈焰燎及周遭' },
  lava: { name: '熔岩', from: 'fire', to: 'earth', desc: '火生土：烈焰入地，化作熔岩，一并爆发' },
  pierce: { name: '淬锋', from: 'earth', to: 'metal', desc: '土生金：土中藏锋，一击必暴' },
};
/** 相生的数值（相对触发它的那一下）。 */
export const REACT = {
  frost: { dmg: 2, freeze: 2 }, // 凝霜：伤害 ×2，必定冻结 2 秒（首领只吃伤害）
  conduct: { dmg: 1.4, jumps: 3, jumpDmg: 0.7, range: 72 }, // 导雷：伤害 ×1.4，雷光再跳 3 只（每只 70%）
  ignite: { burn: 0.6, burnT: 3, r: 34, spread: 0.35, spreadT: 3 }, // 引燃：这一下的 60% 化作每秒灼烧、烧 3 秒；34 像素内的敌人也被点着（35%）
  lava: { dmg: 1.4, stun: 0.9, burnMul: 1.5, r: 26, splash: 0.5 }, // 熔岩：伤害 ×1.4、多晕 0.9 秒；剩下的灼烧 ×1.5 一次烧完，身边 26 像素的敌人吃一半
  pierce: { critMul: 1.2 }, // 淬锋：必定暴击，暴击倍率再 +1.2
};
/** 五行印记持续多久（秒）。 */
export const MARK_T = 2.5;
export const TIER_DMG = [0, 1, 1.6, 2.6, 4.2]; // 品阶伤害倍率（整体输出的目标倍数；各件法宝的单发倍率见 WeaponDef.mul）
export const MAX_WEAPONS = 4; // 法宝位（含专属）
export const MAX_TIER_BY_BUY = 3; // 凡 → 仙靠买同名；神品只能靠器灵

export interface SpiritDef {
  id: string;
  name: string;
  desc: string;
  mul?: number; // 觉醒这个器灵后单发伤害再乘的倍数（器灵的打法差别很大，用它把两个器灵的输出拉平）
}

export interface WeaponDef {
  name: string;
  el: Element;
  exclusive?: HeroId; // 专属法宝：属于哪个角色（只在他的商店里刷同名件、碎片、器灵）
  /**
   * 画面还没做完（true）：商店先不刷它（见 WIP）。模拟、机器人、数值工具照常能用；画面做好后去掉这个字段即可。
   */
  wip?: boolean;
  /**
   * 防御 / 控制型法宝（杏黄旗、青莲宝色旗、捆仙绳）：价值不在自己打出的伤害上，DPS 表单列、不参与中位数。
   */
  role?: 'defense' | 'control';
  price: number; // 凡品基础价
  cd: number; // 基础冷却（秒）。用户：冷却不能太短（不低于 1.2 秒），出手要有分量
  dmg: number; // 基础伤害
  /**
   * 各品阶的单发伤害倍率（下标 1..4）。整体输出按 TIER_DMG 涨，但灵品多了数量 / 范围、仙品多了质变，
   * 单发就涨得慢一些；用 tools/weapon-dps.ts 量过再填。
   */
  mul: number[];
  desc: string;
  /** 每个品阶的变化（下标 1 凡、2 灵、3 仙），商店和图鉴显示用；神品看器灵。 */
  tiers: string[];
  spirits: [SpiritDef, SpiritDef];
}

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  qiankun: {
    name: '乾坤圈',
    el: 'fire', // 哪吒的主五行是火（用户：专属法宝要适配角色的主属性）
    exclusive: 'nezha',
    price: 18,
    cd: 1.6,
    dmg: 21.5,
    mul: [0, 0.92, 1.5, 1.24, 2.18],
    desc: '太乙所赐，掷出复返，往来皆伤，带火灼敌',
    tiers: ['', '一掷一回，灼烧沿途', '圈势更大，飞得更远', '悬于敌阵，旋绞不休'],
    spirits: [
      { id: 'split', name: '金环分光', desc: '两圈并出，各绞一处', mul: 0.8 },
      { id: 'flame', name: '赤焰轮', desc: '回旋之际，火环迸散', mul: 0.78 },
    ],
  },
  huojian: {
    name: '火尖枪',
    el: 'fire',
    price: 20,
    cd: 1.3,
    dmg: 27.5,
    mul: [0, 0.94, 1.1, 1.22, 3.25],
    desc: '枪尖吐火，一刺贯阵，焚灼所过',
    tiers: ['', '一刺贯阵，带火灼敌', '回手再刺，枪芒更长', '枪过之处，火痕不熄'],
    spirits: [
      { id: 'storm', name: '梨花枪', desc: '梨花乱落，一刺三芒', mul: 0.78 },
      { id: 'pierce', name: '贯日', desc: '枪芒贯日，灼烧更烈', mul: 0.62 },
    ],
  },
  jiulong: {
    name: '九龙神火罩',
    el: 'fire',
    price: 24,
    cd: 3.5,
    dmg: 54,
    mul: [0, 0.7, 0.86, 1.12, 2.3],
    desc: '神火罩下，周身烈焰升腾，近者皆焚',
    tiers: ['', '火罩腾起，愈近愈烈', '火罩更广', '火罩随身，焚烧不止'],
    spirits: [
      { id: 'nine', name: '九龙吐焰', desc: '罩中九龙，吐焰四出', mul: 0.9 },
      { id: 'wide', name: '焚天', desc: '焚天之火，罩得更广', mul: 0.89 },
    ],
  },
  leigong: {
    name: '雷公鞭',
    el: 'wood',
    price: 22,
    cd: 1.4,
    dmg: 51.5,
    mul: [0, 0.4, 0.56, 0.63, 1.08],
    desc: '鞭落惊雷，于敌群间跳掷不绝',
    tiers: ['', '落雷连跳', '雷行更远，跳得更多', '中雷者留下雷印，再遭一击'],
    spirits: [
      { id: 'twin', name: '雌雄双鞭', desc: '一雌一雄，双雷并落', mul: 0.5 },
      { id: 'storm', name: '五雷轰顶', desc: '连跳更多，雷势不衰', mul: 0.82 },
    ],
  },
  fantian: {
    name: '番天印',
    el: 'earth',
    price: 26,
    cd: 3.8,
    dmg: 43.5,
    mul: [0, 0.56, 0.92, 1.17, 2.5],
    desc: '大印从天压落，震晕敌群',
    tiers: ['', '大印压落，震晕敌群', '印身更大，晕得更久', '落处地裂，迟滞过往之敌'],
    spirits: [
      { id: 'triple', name: '三山压顶', desc: '三印齐落，如山压顶', mul: 0.82 },
      { id: 'quake', name: '地裂震波', desc: '印落地裂，余震再起', mul: 0.67 },
    ],
  },
  xinghuang: {
    name: '戊己杏黄旗',
    el: 'earth',
    role: 'defense',
    price: 22,
    cd: 9,
    dmg: 47,
    mul: [0, 1, 1.6, 2.6, 4.2],
    desc: '杏黄旗展，金光护体；盾碎之时，震退群邪',
    tiers: ['', '金光护体，碎时震敌', '震退更远，伤得更重', '金光可挡两击，足下金莲迟敌'],
    spirits: [
      { id: 'lotus', name: '金莲护体', desc: '金莲托身，护盾更坚', mul: 1 },
      { id: 'burst', name: '破军', desc: '破军之势，盾碎震波大增', mul: 1 },
    ],
  },
  zhanxian: {
    name: '斩仙飞刀',
    el: 'metal',
    price: 24,
    cd: 2,
    dmg: 28.5,
    mul: [0, 0.92, 1.3, 1.12, 2.2],
    desc: '飞刀游走敌阵，自寻其敌',
    tiers: ['', '飞刀穿梭敌阵', '穿刺更多', '刀过之处，血流不止'],
    spirits: [
      { id: 'many', name: '万刃', desc: '飞刀成群，一出三刃', mul: 0.56 },
      { id: 'behead', name: '请宝贝转身', desc: '专斩强敌，精英、首领受之尤重', mul: 0.8 },
    ],
  },
  hanbing: {
    name: '寒冰幡',
    el: 'water',
    price: 22,
    cd: 1.5,
    dmg: 45.5,
    mul: [0, 0.52, 0.7, 0.74, 1.28],
    desc: '幡动生寒，冰棱破土，冻结敌人',
    tiers: ['', '冰棱破土，冻结敌人', '冰棱更多', '寒霜蔓延，冻及周遭'],
    spirits: [
      { id: 'field', name: '寒冰阵', desc: '布成寒冰阵，冰棱倍出', mul: 0.68 },
      { id: 'shatter', name: '碎冰', desc: '冻毙之敌，碎作冰片四溅', mul: 1 },
    ],
  },
  // ---- 后加的 8 件公共法宝（画面在 game/fx-new.ts）。打法与品阶的数值在 weapons.TUNE、区域的细节在 zones.ZONE_FX ----
  dashen: {
    name: '打神鞭',
    el: 'metal',
    price: 24,
    cd: 1.7,
    dmg: 32,
    mul: [0, 1, 1.15, 1.2, 2.1],
    desc: '元始所赐，鞭打神魔，愈强之敌受之愈重',
    tiers: ['', '自天鞭落，专打强敌', '一鞭可打两敌', '「打神」：鞭下精英为之镇住，余波震及周遭'],
    spirits: [
      { id: 'seal', name: '封神', desc: '残敌一鞭即散', mul: 1 },
      { id: 'nine', name: '九节', desc: '九节连环，一敌连受数鞭', mul: 0.42 },
    ],
  },
  huaxue: {
    name: '化血神刀',
    el: 'metal',
    price: 22,
    cd: 1.3,
    dmg: 24,
    mul: [0, 0.92, 1.1, 1.08, 2.4],
    desc: '血光如月，斩过之处，流血不止',
    tiers: ['', '月牙血光，留下流血', '斩面更宽，流血更深', '「化血」：流血而亡者化作血雾，染及近旁'],
    spirits: [
      { id: 'sea', name: '血海', desc: '血海翻涌，斩得更远更宽', mul: 0.8 },
      { id: 'soul', name: '噬魂', desc: '敌血流淌，反哺己身', mul: 0.75 },
    ],
  },
  dingfeng: {
    name: '定风珠',
    el: 'wood',
    price: 24,
    cd: 3,
    dmg: 38,
    mul: [0, 0.82, 1.12, 1.1, 2.2],
    desc: '珠起旋风，卷敌入眼，少顷吹散',
    tiers: ['', '旋风卷敌，少顷吹散', '风势更大，卷得更多', '「定风」：旋风追敌而行，反复撕扯'],
    spirits: [
      { id: 'thunder', name: '风雷', desc: '风中夹雷，跳掷敌群', mul: 0.52 },
      { id: 'calm', name: '定海', desc: '风止敌定，卷者皆定身', mul: 0.95 },
    ],
  },
  qinglian: {
    name: '青莲宝色旗',
    el: 'wood',
    role: 'defense',
    price: 22,
    cd: 7,
    dmg: 20,
    mul: [0, 1, 1.6, 2.6, 4.2],
    desc: '青莲铺地，立于其中气血自复，荆棘刺敌',
    tiers: ['', '青莲结界，回血伤敌', '结界更大、更久', '「步步生莲」：结界随身而行'],
    spirits: [
      { id: 'dais', name: '莲台', desc: '莲台安坐，回血更多，身形更难捉摸', mul: 1 },
      { id: 'thorn', name: '荆棘', desc: '荆棘丛生，刺敌更深', mul: 1 },
    ],
  },
  yinyang: {
    name: '阴阳镜',
    el: 'water',
    price: 24,
    cd: 1.5,
    dmg: 28,
    mul: [0, 1.04, 1.42, 0.87, 1.62],
    desc: '镜分阴阳，光扫敌群，伤而迟之',
    tiers: ['', '镜光扫敌，伤而迟滞', '镜光更长、更宽', '「阴阳」：双光反扫，交照者冻结'],
    spirits: [
      { id: 'demon', name: '照妖', desc: '妖魔现形，强敌受之尤重', mul: 0.98 },
      { id: 'cosmos', name: '乾坤', desc: '两道镜光，各扫一周', mul: 0.85 },
    ],
  },
  xuanyuan: {
    name: '玄元控水旗',
    el: 'water',
    price: 22,
    cd: 4,
    dmg: 33,
    mul: [0, 0.95, 1.4, 1.85, 3.2],
    desc: '控水之旗，涌泉成泽，陷敌其中，迟滞并伤',
    tiers: ['', '涌泉成泽，迟滞伤敌', '水泽更大、更久', '「漩涡」：泽心生涡，吸敌向内'],
    spirits: [
      { id: 'flood', name: '水淹', desc: '两泽并涌', mul: 0.72 },
      { id: 'abyss', name: '寒潭', desc: '水退成冰，冻结其中之敌', mul: 1.1 },
    ],
  },
  wuhuo: {
    name: '五火七禽扇',
    el: 'fire',
    price: 22,
    cd: 1.6,
    dmg: 21,
    mul: [0, 0.86, 1.02, 0.95, 1.75],
    desc: '扇动五火，火浪扑面，击退并燃',
    tiers: ['', '一扇火浪，击退燃敌', '扇面更宽、更远', '「七禽」：火浪化出七禽，各逐一敌'],
    spirits: [
      { id: 'five', name: '五火', desc: '五道火浪环身齐出', mul: 0.82 },
      { id: 'gale', name: '焚风', desc: '焚风远扫，过处焦土', mul: 0.76 },
    ],
  },
  kunxian: {
    name: '捆仙绳',
    el: 'earth',
    role: 'control',
    price: 20,
    cd: 2.6,
    dmg: 14,
    mul: [0, 1, 1.6, 2.6, 4.2],
    desc: '金绳飞缚一串敌人，定身而易伤',
    tiers: ['', '金绳缚敌，定身易伤', '缚得更多、更久', '「缚仙」：绳收敌撞，伤上加伤'],
    spirits: [
      { id: 'dragon', name: '困龙', desc: '精英亦难挣脱，首领为之迟滞', mul: 1 },
      { id: 'chain', name: '连环', desc: '连环相缚，一网成串', mul: 1 },
    ],
  },
  // ---- 别的角色的专属法宝（出手与品阶的数值在 sim/heroes/ 下这个角色的模块里）----
  sanjian: {
    name: '三尖两刃刀',
    el: 'metal', // 杨戬的主五行是金
    exclusive: 'yangjian',
    price: 18,
    cd: 1.4,
    dmg: 20,
    mul: [0, 1.04, 1.35, 1.36, 2.2],
    desc: '二郎神兵，横扫继以直刺，贯穿一串',
    tiers: ['', '一扫一刺，贯穿一串', '扫得更宽，刺得更远', '「劈山」：当头一劈，地裂金光'],
    spirits: [
      { id: 'rift', name: '开天', desc: '一劈开天，三道金光', mul: 1 },
      { id: 'edge', name: '回锋', desc: '回锋反扫，一刺连二', mul: 0.75 },
    ],
  },
  dinghai: {
    name: '定海珠',
    el: 'earth', // 赵公明的主五行是土
    exclusive: 'zhao',
    price: 18,
    cd: 1.45,
    dmg: 20,
    mul: [0, 0.9, 0.72, 0.98, 1.8],
    desc: '定海神珠绕身而转，时出一颗，砸敌震晕',
    tiers: ['', '神珠绕身，一出一砸', '珠更多，一次两出', '砸地留纹，少顷再震'],
    spirits: [
      { id: 'rosary', name: '二十四珠', desc: '二十四珠环敌而落，石纹齐震', mul: 0.85 },
      { id: 'anchor', name: '镇海', desc: '巨珠镇海，压敌更久', mul: 0.95 },
    ],
  },
  jindou: {
    name: '混元金斗',
    el: 'metal', // 云霄的主五行是金：混元金斗是金（用户 11-12：「金斗按理说是金」；原来是水）
    exclusive: 'yunxiao',
    price: 18,
    cd: 1.9,
    dmg: 36,
    mul: [0, 0.92, 1.3, 1.5, 2.2], // 2026-11-11 数值平衡按 tools/weapon-dps.ts 重拉（出手慢，按用户说的定在中位数 +8% 上下；结果见 docs/balance/log.md 第 3 轮）
    desc: '混元金斗，收敌入内，少顷倾出摔伤',
    tiers: ['', '金斗收敌，倾出摔伤', '斗口更大，收得更多', '「削去顶上三花」：倾出之敌道行大损，受伤更重'],
    spirits: [
      { id: 'dao', name: '倒海', desc: '倾出之敌撞翻同伙', mul: 1.05 },
      { id: 'shou', name: '收宝', desc: '精英亦收，夺其护持之力', mul: 1.4 },
    ],
  },
  huangjin: {
    name: '黄金棍',
    el: 'wood', // 雷震子的主五行是木（震为雷、属木：棍落处劈下的是雷）
    exclusive: 'leizhenzi',
    price: 18,
    cd: 1.9, // 出手慢、单下重（用户：慢的单下高、快的单下低，同品阶 DPS 差不多）
    dmg: 43,
    mul: [0, 0.78, 1.15, 1.32, 2.25], // tools/weapon-dps.ts 量过、拉到同品阶中位数附近（2026-11-11 初值），最后统一调
    desc: '金棍掠阵而下，落处天雷劈落',
    tiers: ['', '掠阵砸落，雷劈震敌', '棍身更大，弹起再砸', '「雷纹」：落处留纹，少顷再炸'],
    spirits: [
      { id: 'benlei', name: '奔雷', desc: '奔雷连砸，处处雷落' },
      { id: 'suiyue', name: '碎岳', desc: '棍身暴涨，碎岳崩山' },
    ],
  },
  // ---- 回响化身的专属法宝（出手在 sim/heroes/ 下各自的模块里）----
  heiyan: {
    name: '黑焰轮',
    el: 'fire', // 魔化哪吒的主五行是火
    exclusive: 'mozha',
    price: 18,
    cd: 1.8,
    dmg: 19,
    mul: [0, 0.92, 0.98, 1, 1.35], // 2026-11-11 数值平衡按新的 tools/weapon-dps.ts 重拉（原来 1 / 1.15 / 0.9 / 1.35；结果见 docs/balance/log.md 第 4 轮）
    desc: '黑焰轮自足下滚向四方，碾过之处烈焰缠身',
    tiers: ['', '黑焰轮滚向四方', '轮更多、更大、更远', '「轮回」：滚至尽头折返，再碾一遍'],
    spirits: [
      { id: 'eight', name: '八方', desc: '八轮齐出，八方俱焚', mul: 0.8 },
      { id: 'lotus', name: '红莲', desc: '滚至尽头，绽开红莲业火', mul: 1.2 },
    ],
  },
  fulong: {
    name: '缚龙索',
    el: 'earth', // 回响赵公明的主五行是土
    exclusive: 'huizhao',
    price: 18,
    cd: 1.9,
    dmg: 22,
    mul: [0, 1.12, 1.4, 1.5, 2.4], // 2026-11-11 数值平衡重拉（原来 1 / 1.25 / 1.65 / 2.4；控制型：拽到一起，略低一点也行）
    desc: '缚龙金索缠住一串敌人，拽作一团相撞',
    tiers: ['', '缠敌拽撞', '缠得更多，拽得更急', '「锁龙」：拽聚之后锁住，伤上加伤'],
    spirits: [
      { id: 'twin', name: '双索', desc: '双索齐出，各拽一群', mul: 1.1 },
      { id: 'qianjun', name: '千钧', desc: '拽聚之处，千钧一击', mul: 1 },
    ],
  },
  qiankuntu: {
    name: '乾坤图',
    el: 'metal', // 回响云霄的主五行是金（跟着云霄；乾坤图，乾属金；用户 11-12 改）
    exclusive: 'huiyun',
    price: 18,
    cd: 1.2,
    dmg: 40,
    mul: [0, 0.8, 1.03, 0.52, 0.79], // 2026-11-11 数值平衡重拉（原来 1 / 1.15 / 0.72 / 0.95；仙品起山影压下 1.3 → 1.6，单发就低一些；控制型：裹住定身，略低一点也行）
    desc: '乾坤图展，图中之敌尽被裹住，动弹不得',
    tiers: ['', '铺开图卷，裹敌定身', '图卷更长更宽，裹得更久', '「镇山」：山影压下，重创图中之敌'],
    spirits: [
      { id: 'cross', name: '裹天', desc: '两卷交叉，天地同裹', mul: 1.2 },
      { id: 'qilin', name: '麒麟崖', desc: '麒麟崖影压尽全卷，裹得更久', mul: 1.1 },
    ],
  },
  youlong: {
    name: '游龙戟',
    el: 'water', // 回响敖丙的主五行是水
    exclusive: 'huiao',
    price: 18,
    cd: 1.9,
    dmg: 15,
    mul: [0, 1, 0.98, 1.02, 1.45], // 2026-11-11 数值平衡按 tools/weapon-dps.ts 重拉（原来 1 / 0.95 / 1 / 1.25；见 docs/balance/log.md 第 8 轮）
    desc: '戟化冰龙，游走敌阵，所噬之处寒气迟敌',
    tiers: ['', '冰龙游噬', '噬得更多，游得更快', '「凝冰」：游至尽头，炸冰冻敌'],
    spirits: [
      { id: 'twin', name: '双龙', desc: '冰龙成双，各噬一路', mul: 0.62 },
      { id: 'ebb', name: '回澜', desc: '游罢回澜，归途再噬', mul: 0.98 },
    ],
  },
  jingu: {
    name: '如意金箍棒',
    el: 'metal', // 孙悟空的主五行是金：如意金箍棒是金（用户 11-12：「金箍棒明显应该是金」；西游丹道里他也是「金公」）
    exclusive: 'wukong',
    price: 18,
    cd: 1.5,
    dmg: 24,
    mul: [0, 1, 1.36, 1.5, 2.4], // 2026-11-11 数值平衡按新的 tools/weapon-dps.ts 重拉（原来 1 / 1.45 / 1.35 / 2.2；出手中等，按中位数；结果见 docs/balance/log.md 第 6 轮）
    desc: '如意金箍棒横扫一周，继以当头竖劈',
    tiers: ['', '横扫一周，接一记竖劈', '棒身更长，扫劈更远', '「定海」：竖劈落地，石刺迸出'],
    spirits: [
      { id: 'qingtian', name: '擎天', desc: '擎天一柱，劈得又远又重', mul: 0.68 },
      { id: 'jiaohai', name: '搅海', desc: '搅海翻江，横扫卷敌入内', mul: 1.2 },
    ],
  },
  // ---- 再加的 11 件公共法宝（arti2 分支；名单与理由见 docs/design.md「法宝扩到约 30 件」）。打法的数值在 sim/arti2.ts 的 TUNE2，画面在 game/fx-new2.ts ----
  xiangmo: {
    name: '降魔杵',
    el: 'earth',
    price: 22,
    cd: 2.6,
    dmg: 28,
    mul: [0, 1.05, 1.25, 1.6, 2.5],
    desc: '降魔杵连环飞砸，中者晕眩震退',
    tiers: ['', '飞砸连环，晕眩震退', '连砸更多，晕得更久', '「降魔印」：砸处留印，踏入者被镇'],
    spirits: [
      { id: 'weituo', name: '韦陀', desc: '韦陀双杵，各砸一串', mul: 1 },
      { id: 'taishan', name: '泰山', desc: '杵重如山，末击震开一片', mul: 1 },
    ],
  },
  wuguang: {
    name: '五光石',
    el: 'earth',
    price: 20,
    cd: 1.4,
    dmg: 25,
    mul: [0, 1.08, 1.06, 1.4, 2.2],
    desc: '五色神石掷出，正中面门，令敌晕眩',
    tiers: ['', '神石击面，令敌晕眩', '五石齐出，扇面更宽', '「五光」：石碎为五色光，弹向近敌'],
    spirits: [
      { id: 'beads', name: '连珠', desc: '一轮掷罢，再掷一轮', mul: 1 },
      { id: 'face', name: '破面', desc: '击面更狠，晕得更久', mul: 1.12 },
    ],
  },
  zanxin: {
    name: '攒心钉',
    el: 'metal',
    price: 22,
    cd: 1.5,
    dmg: 21,
    mul: [0, 1.38, 1.4, 1.8, 2.75],
    desc: '攒心金钉，钉入愈多，所受伤害愈重',
    tiers: ['', '连发金钉，钉入易伤', '连发更多，可钉更多', '「攒心」：钉满齐钻，重创一记'],
    spirits: [
      { id: 'seven', name: '七星', desc: '七星攒聚，专钉近旁数敌', mul: 1 },
      { id: 'bone', name: '透骨', desc: '透骨而过，钻心溅血', mul: 0.88 },
    ],
  },
  jinjiao: {
    name: '金蛟剪',
    el: 'metal',
    price: 24,
    cd: 4.4,
    dmg: 30,
    mul: [0, 0.75, 1.05, 1.45, 2.9],
    desc: '两条金蛟绕身盘旋，噬咬近敌',
    tiers: ['', '双蛟绕身，轮扑圈外之敌', '盘得更大、更快、更久', '「交剪」：双蛟齐扑，交错一剪'],
    spirits: [
      { id: 'four', name: '四蛟', desc: '四蛟两剪，各剪一敌', mul: 1 },
      { id: 'coil', name: '绞龙', desc: '剪后绞缠，敌不能动', mul: 0.9 },
    ],
  },
  yanguang: {
    name: '离地焰光旗',
    el: 'fire',
    price: 22,
    cd: 6.4,
    dmg: 24,
    mul: [0, 0.92, 0.85, 0.8, 1.48],
    desc: '焰光旗插下，旗边之敌足下地火窜起',
    tiers: ['', '插旗引火，地火燃敌', '旗势更远，地火更多', '「焰光」：地火连窜，一烧数敌'],
    spirits: [
      { id: 'twin', name: '南离', desc: '南离双旗，各镇一方', mul: 1 },
      { id: 'blaze', name: '焚城', desc: '地火过处，化作火海', mul: 1 },
    ],
  },
  wanya: {
    name: '万鸦壶',
    el: 'fire',
    price: 22,
    cd: 4,
    dmg: 28,
    mul: [0, 0.9, 1.25, 1.0, 2.4],
    desc: '壶倾火鸦，盘旋敌群，轮番啄烧',
    tiers: ['', '群鸦盘旋，俯冲啄烧', '鸦群更大，盘得更久', '「火鸦」：群鸦齐扑自焚，各炸一团火'],
    spirits: [
      { id: 'sky', name: '遮天', desc: '十二火鸦，蔽日而来', mul: 1 },
      { id: 'sun', name: '金乌', desc: '金乌领群，先扑强敌，落处日火炸开', mul: 0.9 },
    ],
  },
  sihai: {
    name: '四海瓶',
    el: 'water',
    price: 22,
    cd: 2.6,
    dmg: 34,
    mul: [0, 1, 1.4, 1.8, 2.4],
    desc: '瓶倾四海之水，浪头推敌而行，至尽砸下',
    tiers: ['', '浪头推敌，至尽砸下', '浪头推得更远', '「翻浪」：浪落成冰，冻结敌人'],
    spirits: [
      { id: 'four', name: '四海', desc: '四方各泻浪头', mul: 1 },
      { id: 'rage', name: '怒涛', desc: '怒涛更宽，砸得更重', mul: 1 },
    ],
  },
  wulu: {
    name: '雾露乾坤网',
    el: 'water',
    price: 22,
    cd: 2.6,
    dmg: 34,
    mul: [0, 0.92, 1.28, 1.8, 3],
    desc: '雾露乾坤网张开，敌入即收，伤而定之',
    tiers: ['', '敌入网中，收网定身', '网更大，定得更久', '「乾坤」：收网成球，拽聚砸下'],
    spirits: [
      { id: 'sky', name: '天罗', desc: '网更大，精英亦难脱身', mul: 1 },
      { id: 'earth', name: '地网', desc: '天罗地网，两网齐张', mul: 1 },
    ],
  },
  miaoshu: {
    name: '七宝妙树',
    el: 'wood',
    price: 22,
    cd: 2.2,
    dmg: 40,
    mul: [0, 1, 1.3, 1.4, 2.3],
    desc: '七宝妙树绕身一刷，敌被刷开，宝物飞追',
    tiers: ['', '一刷伤敌，宝物飞出', '刷得更远更重，宝物更多', '「七宝」：七宝齐出，中敌炸开宝光'],
    spirits: [
      { id: 'twin', name: '双刷', desc: '一来一回，刷两遍', mul: 1 },
      { id: 'glow', name: '宝光', desc: '宝光满天，追敌而飞', mul: 1 },
    ],
  },
  wenhuang: {
    name: '瘟癀伞',
    el: 'wood',
    price: 22,
    cd: 3.6,
    dmg: 26,
    mul: [0, 1, 1.35, 1.5, 2.6],
    desc: '瘟癀伞撑开，瘟雾洒落，染者渐衰，且传及近旁',
    tiers: ['', '瘟气相染，传及近旁', '瘟雾更大，传得更广', '「瘟毒」：瘟气层层积聚，满则瘟倒'],
    spirits: [
      { id: 'five', name: '五瘟', desc: '五瘟齐行，传得更快更远', mul: 1 },
      { id: 'god', name: '瘟神', desc: '瘟神降世，染瘟之敌受伤更重', mul: 0.85 },
    ],
  },
  luobao: {
    name: '落宝金钱',
    el: 'metal',
    price: 22,
    cd: 3,
    dmg: 12,
    mul: [0, 1, 1.0, 1.05, 1.9],
    desc: '落宝金钱附于强敌头上，敲而不休；敌毙落宝',
    tiers: ['', '敲击强敌，毙之多掉灵石', '敲得更快，附得更久', '「落宝」：宝光被打落，受伤更重，护体失效'],
    spirits: [
      { id: 'rain', name: '金钱雨', desc: '金钱如雨，各附一敌', mul: 1 },
      { id: 'luck', name: '生财', desc: '落宝更丰', mul: 1 },
    ],
  },
};

/** 公共法宝池：不含专属法宝。 */
export const COMMON_WEAPONS = (Object.keys(WEAPONS) as WeaponKind[]).filter((k) => !WEAPONS[k].exclusive);

/**
 * 画面还没做完的法宝（WeaponDef.wip）先不进商店。shop = true 时照常刷（数值工具、测试打开它；
 * 表现层将来可以接一个网址开关，比如 ?wip）。只管商店：直接装备、机器人、DPS 工具都不受影响。
 */
export const WIP = { shop: false };
/** 商店里能刷到的公共法宝。 */
export const shopWeapons = () => COMMON_WEAPONS.filter((k) => WIP.shop || !WEAPONS[k].wip);

// ---------- 灵物：被动加成，可叠加 ----------
export interface RelicDef {
  name: string;
  price: number;
  desc: string;
  apply: (s: Stats) => void; // 买下时一次性加到属性上的部分（只有机制、不加属性的是空函数）
  demon?: boolean; // 带代价的魔物
  /** 有自己机制的灵物（机制在 relics.ts，数值在 RELIC）：多带一件怎么变（商店的详情里显示）。 */
  stack?: string;
}
const aff = (el: Element, v: number) => (s: Stats) => {
  s.aff[el] += v;
};
const none = () => {};

/**
 * M3 新加的、有自己机制的灵物的数值（机制见 relics.ts；给玩家看的说明不报数，2026-11-12）。带几件就按几件算，叠加的规则写在各自的 stack 里。
 * 暂拟的初值，数值最后统一调（用户 2026-11-10）。
 */
export const RELIC = {
  cushion: { still: 1, regen: 1.5 }, // 风火蒲团：站定 still 秒后入定，每秒回复 +regen（每件）
  zhuo: { mul: 4, r: 40, stun: 0.6, kb: 220 }, // 金刚琢印：每波前 n 次受伤（n = 件数），把这一下（护体减免之前）的 mul 倍砸向 r 内的敌人（土行）
  jadedragon: { mul: 0.4, r: 22 }, // 九龙玉佩：相生时在那只身边 r 内炸开，伤害为相生那一下的 mul（每件）
  mirror: { first: 1.5, every: 7, t: 4, vuln: 0.25, seek: 130 }, // 照妖镜碎片：每 every 秒照 seek 内血最厚的一只，t 秒内受伤 +vuln（每件；开波 first 秒后第一次）
  umbrella: { cd: 6, cdPer: 1, cdMin: 3 }, // 混元伞残片：挡一枚鬼火后 cd 秒才能再挡（每多一件 −cdPer，最短 cdMin）
  pouch: { per: 10, max: 5 }, // 乾坤袋：开波时每 per 枚灵石生 1 枚，最多 max 枚（每件）
  hairpin: { mul: 0.5 }, // 桃木簪：魔气的减速、侵蚀 ×mul（每件再乘一次）
  stormfeather: { chance: 0.15, cap: 0.6, mul: 0.5, r: 48, stun: 0.2 }, // 风雷羽：暴击时 chance 几率（每件，最多 cap）劈 r 内另一只，暴击伤害的 mul（木行）
  cloudshoe: { t: 1.5, speed: 0.2 }, // 踏云履：捡到灵石后 t 秒内移速 +speed（每件）
  scale: { hp: 0.3, damage: 0.3 }, // 逆鳞：气血低于 hp 时伤害 +damage（每件）
  dingyan: { damage: 0.2, report: 0.8 }, // 定颜珠：打中晕住 / 定身 / 冻住的敌人伤害 +damage（每件）；同一只隔 report 秒才报一次（表现层闪一下）
  icevase: { lingshi: 10 }, // 冰心玉壶：一波没被打中，多得 lingshi × 物价倍数（每件）
  gu: { damage: 0.3, drain: 0.1 }, // 噬心蛊：伤害 +damage（每件）；开波时噬去当前气血的 drain（每件再噬一次，最多扣到 1 点）
  drum: { every: 8, beat: 4, up: 0.6, down: 0.25 }, // 夔牛鼓：每 every 秒一通，前 beat 秒伤害 +up（每件），其余时间 −down
  incense: { charge: 1, cost: 0.2 }, // 燃魂香：击杀攒的真气多 charge 倍（每件）；放神通燃去当前气血的 cost（最多扣到 1 点）
};
const R = RELIC;
/**
 * 只加一项属性的灵物：加多少（apply 和说明都从这里取）。用户 2026-11-12：说明以意象为主、不报数，
 * 但纯加属性的这一类「留一个数」，同类之间比得出强弱。
 */
export const RELIC_STAT = { peach: 12, lingzhi: 0.4, gourd: 0.4, jindan: 0.07, feather: 0.06, thunderwood: 0.08, pearl: 0.04, turtle: 2, cornucopia: 12, cicada: 0.04, scroll: 0.1, qilin: 0.25 };
const RS = RELIC_STAT;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export const RELICS: Record<RelicId, RelicDef> = {
  peach: { name: '蟠桃', price: 14, desc: `瑶池仙桃，气血上限 +${RS.peach}`, apply: (s) => void (s.maxHp += RS.peach) },
  lingzhi: { name: '灵芝', price: 16, desc: `千年灵芝，每秒回复 +${RS.lingzhi}`, apply: (s) => void (s.regen += RS.lingzhi) },
  gourd: { name: '紫金葫芦', price: 12, desc: `葫芦一开，拾取范围 +${pct(RS.gourd)}`, apply: (s) => void (s.pickup += RS.gourd) },
  jindan: { name: '九转金丹', price: 18, desc: `九转炼成，伤害 +${pct(RS.jindan)}`, apply: (s) => void (s.damage += RS.jindan) },
  feather: { name: '青鸾羽', price: 12, desc: `青鸾遗羽，移速 +${pct(RS.feather)}`, apply: (s) => void (s.speed += RS.feather) },
  thunderwood: { name: '雷击木', price: 18, desc: `天雷所击之木，攻速 +${pct(RS.thunderwood)}`, apply: (s) => void (s.haste += RS.thunderwood) },
  pearl: { name: '夜明珠', price: 16, desc: `照见破绽，暴击率 +${pct(RS.pearl)}`, apply: (s) => void (s.crit += RS.pearl) },
  turtle: { name: '玄龟甲', price: 16, desc: `玄龟背甲，护体 +${RS.turtle}`, apply: (s) => void (s.armor += RS.turtle) },
  cornucopia: { name: '聚宝盆', price: 14, desc: `聚宝纳福，气运 +${RS.cornucopia}`, apply: (s) => void (s.luck += RS.cornucopia) },
  blooddemon: { name: '血魔珠', price: 20, desc: '以血养珠：伤害大增，气血却渐渐流失', demon: true, apply: (s) => ((s.damage += 0.18), (s.regen -= 0.5)) },
  soulbell: { name: '噬魂铃', price: 18, desc: '铃响噬魂，斩敌可回气血，然气血上限受损', demon: true, apply: (s) => ((s.soul += 0.08), (s.maxHp -= 12)) },
  orb_metal: { name: '庚金精', price: 14, desc: '庚金之精，金行法宝威力更盛', apply: aff('metal', 0.12) },
  orb_wood: { name: '乙木精', price: 14, desc: '乙木之精，木行法宝威力更盛', apply: aff('wood', 0.12) },
  orb_water: { name: '玄水精', price: 14, desc: '玄水之精，水行法宝威力更盛', apply: aff('water', 0.12) },
  orb_fire: { name: '离火精', price: 14, desc: '离火之精，火行法宝威力更盛', apply: aff('fire', 0.12) },
  orb_earth: { name: '戊土精', price: 14, desc: '戊土之精，土行法宝威力更盛', apply: aff('earth', 0.12) },
  // ---- M3 新加：有自己机制的（暂拟，待评审确认；机制在 relics.ts） ----
  cushion: { name: '风火蒲团', price: 18, desc: '站定入定，气血渐复', apply: none, stack: '每多一件，入定回复更多' },
  zhuo: { name: '金刚琢印', price: 20, desc: '每波首次受伤，金刚琢反砸周遭', apply: none, stack: '每多一件，每波多砸一次' },
  jadedragon: { name: '九龙玉佩', price: 22, desc: '每逢五行相生，敌旁炸开龙气', apply: none, stack: '每多一件，龙气更烈' },
  mirror: { name: '照妖镜碎片', price: 22, desc: '时时照出强敌，令其受伤更重', apply: none, stack: '每多一件，所受伤害再增' },
  umbrella: { name: '混元伞残片', price: 18, desc: '时时撑开，挡下飞来的鬼火', apply: none, stack: '每多一件，撑开更勤' },
  pouch: { name: '乾坤袋', price: 16, desc: '开波之时，囊中灵石自生', apply: none, stack: '每多一件，生得更多' },
  hairpin: { name: '桃木簪', price: 14, desc: '桃木辟邪，魔气的迟滞与侵蚀大减', apply: none, stack: '每多一件，魔气更难近身' },
  stormfeather: { name: '风雷羽', price: 22, desc: '暴击时偶引小雷，劈向近旁之敌', apply: none, stack: '每多一件，引雷更频' },
  cloudshoe: { name: '踏云履', price: 14, desc: '拾得灵石，足下生云，身法骤快', apply: none, stack: '每多一件，步履更疾' },
  scale: { name: '逆鳞', price: 18, desc: '龙有逆鳞，气血危急时伤害大增', apply: none, stack: '每多一件，怒意更盛' },
  dingyan: { name: '定颜珠', price: 20, desc: '击打受制之敌，伤害更重', apply: none, stack: '每多一件，伤害再增' },
  icevase: { name: '冰心玉壶', price: 16, desc: '一片冰心在玉壶：一波未曾受伤，多得灵石', apply: none, stack: '每多一件，所得更多' },
  // ---- M3 新加：带代价的魔物 ----
  gu: { name: '噬心蛊', price: 22, desc: '蛊入心脉：伤害大增，每波开打噬去气血', demon: true, apply: (s) => void (s.damage += R.gu.damage), stack: '每多一件，伤害更增，噬得更深' },
  drum: { name: '夔牛鼓', price: 22, desc: '鼓响时伤害大增，鼓歇时力衰', demon: true, apply: none, stack: '每多一件，鼓响时更猛' },
  incense: { name: '燃魂香', price: 20, desc: '燃魂为香：斩敌所积真气倍增，每放神通燃去气血', demon: true, apply: none, stack: '每多一件，真气积得更快' },
  // ---- M3 新加：只加属性的 ----
  cicada: { name: '金蝉蜕', price: 16, desc: `金蝉脱壳，闪避 +${pct(RS.cicada)}`, apply: (s) => void (s.dodge += RS.cicada) },
  scroll: { name: '山河图残卷', price: 18, desc: `山河入卷，范围 +${pct(RS.scroll)}`, apply: (s) => void (s.area += RS.scroll) },
  qilin: { name: '麒麟角', price: 18, desc: `麒麟之角，暴击伤害 +${pct(RS.qilin)}`, apply: (s) => void (s.critMul += RS.qilin) },
};

// ---------- 丹药：一次性 ----------
export interface ElixirDef {
  name: string;
  price: number;
  desc: string;
  now?: boolean; // 买下立刻生效（否则只管下一波：效果记在 Player.buffs，打开下一次商店时清掉）
  drink: (p: Player) => void;
}
/** 丹药的数值（M3 新加的那几种；暂拟的初值）。 */
export const ELIXIR = { juling: { gem: 0.2 }, dahuan: { hp: 6 }, yinshen: { dodge: 0.2 }, jingangdan: { armor: 5 }, leihuo: { crit: 0.12 } };
export const ELIXIRS: Record<ElixirId, ElixirDef> = {
  huichun: { name: '回春丹', price: 10, desc: '服之即刻回满气血', now: true, drink: (p) => void (p.hp = p.stats.maxHp) },
  juling: { name: '聚灵丹', price: 12, desc: `下一波拾得灵石 +${pct(ELIXIR.juling.gem)}`, drink: (p) => void (p.buffs.gem = ELIXIR.juling.gem) },
  kuangxue: { name: '狂血丹', price: 12, desc: '狂血沸腾：下一波伤害大增，所受伤害亦增', drink: (p) => void (p.buffs.rage = 1) },
  dahuan: {
    name: '大还丹',
    price: 20,
    desc: `起死还魂：回满气血，气血上限 +${ELIXIR.dahuan.hp}`,
    now: true,
    drink: (p) => {
      p.stats.maxHp += ELIXIR.dahuan.hp;
      p.hp = p.stats.maxHp;
    },
  },
  yinshen: { name: '隐身丹', price: 12, desc: `下一波隐去身形，闪避 +${pct(ELIXIR.yinshen.dodge)}`, drink: (p) => void (p.buffs.dodge = ELIXIR.yinshen.dodge) },
  jingangdan: { name: '金刚丹', price: 12, desc: `下一波金身护体，护体 +${ELIXIR.jingangdan.armor}`, drink: (p) => void (p.buffs.armor = ELIXIR.jingangdan.armor) },
  leihuo: { name: '雷火丹', price: 14, desc: `下一波雷火入目，暴击率 +${pct(ELIXIR.leihuo.crit)}`, drink: (p) => void (p.buffs.crit = ELIXIR.leihuo.crit) },
  ningshen: { name: '凝神丹', price: 10, desc: '凝神静气：下一波开打，真气已满', drink: (p) => void (p.buffs.calm = 1) },
};

// ---------- 符箓：每波限次的应急效果，带上就一直生效 ----------
/** 符箓的数值（M3 新加的六种；机制见 relics.ts；暂拟的初值）。 */
export const CHARM = {
  dingshen: { hp: 0.5, r: 64, t: 2.5 }, // 定身符：气血跌破 hp 时，r 内的敌人（首领除外）定住 t 秒
  yinlei: { near: 44, count: 8, r: 60, dmg: 45, stun: 0.6, kb: 260 }, // 引雷符：near 内有 count 只以上时，天雷劈开 r 内的敌人（dmg × 波次倍率，木行）
  dundi: { hp: 0.3, t: 2, speed: 0.5 }, // 遁地符：气血跌破 hp 时遁地 t 秒（打不着），移速 +speed
  shenxing: { n: 3, t: 2, speed: 0.4 }, // 神行符：每波 n 次，受伤后 t 秒内移速 +speed
  zhaobao: { kills: 40 }, // 招宝符：这一波第 kills 只击杀时掉一个乾坤宝匣
  huiling: { back: 0.5 }, // 回灵符：放完神通，真气回到 back
};
export const CHARMS: Record<CharmId, { name: string; price: number; desc: string }> = {
  tishen: { name: '替身符', price: 24, desc: '替身代死：每波一次，免于致命一击' },
  huxin: { name: '护心符', price: 16, desc: '护心镜照：每波挡下首次伤害' },
  dingshen: { name: '定身符', price: 18, desc: '每波一次：气血过半时，周遭之敌俱被定住' },
  yinlei: { name: '引雷符', price: 20, desc: '每波一次：身陷重围时，引天雷劈开周遭' },
  dundi: { name: '遁地符', price: 22, desc: '每波一次：气血危急时，遁入地下脱身' },
  shenxing: { name: '神行符', price: 14, desc: '每波数次：受伤之后足下生风，疾行脱身' },
  zhaobao: { name: '招宝符', price: 18, desc: '每波一次：斩敌够多时，招来乾坤宝匣' },
  huiling: { name: '回灵符', price: 16, desc: '每波一次：神通放罢，真气回复一半' },
};

// ---------- 升级属性：每级四选一（数值按 1..4 档） ----------
export const STAT_UPGRADES: Record<StatId, { name: string; values: number[]; fmt: (v: number) => string }> = {
  maxHp: { name: '气血上限', values: [5, 9, 13, 18], fmt: (v) => `+${v}` },
  regen: { name: '每秒回复', values: [0.2, 0.4, 0.6, 0.9], fmt: (v) => `+${v}` },
  soul: { name: '吸魂', values: [0.02, 0.04, 0.06, 0.08], fmt: (v) => `+${Math.round(v * 100)}%` },
  damage: { name: '伤害', values: [0.05, 0.08, 0.12, 0.16], fmt: (v) => `+${Math.round(v * 100)}%` },
  haste: { name: '攻速', values: [0.05, 0.08, 0.12, 0.16], fmt: (v) => `+${Math.round(v * 100)}%` },
  crit: { name: '暴击率', values: [0.03, 0.05, 0.07, 0.09], fmt: (v) => `+${Math.round(v * 100)}%` },
  area: { name: '范围', values: [0.05, 0.08, 0.12, 0.16], fmt: (v) => `+${Math.round(v * 100)}%` },
  speed: { name: '移速', values: [0.03, 0.05, 0.07, 0.1], fmt: (v) => `+${Math.round(v * 100)}%` },
  pickup: { name: '拾取范围', values: [0.15, 0.25, 0.35, 0.5], fmt: (v) => `+${Math.round(v * 100)}%` },
  armor: { name: '护体', values: [1, 2, 3, 4], fmt: (v) => `+${v}` },
  dodge: { name: '闪避', values: [0.02, 0.03, 0.05, 0.07], fmt: (v) => `+${Math.round(v * 100)}%` },
  luck: { name: '气运', values: [5, 10, 15, 20], fmt: (v) => `+${v}` },
  aff: { name: '五行亲和', values: [0.08, 0.12, 0.16, 0.22], fmt: (v) => `+${Math.round(v * 100)}%` },
};

/** 升到下一级要多少经验（同土豆兄弟：(等级 + 3)²）。 */
export const xpToNext = (level: number) => (level + 3) ** 2;

// ---------- 波次 ----------
// 用户（2026-11-09）：每章 6 波，第 6 波打首领，打完进入下一章；法宝和等级都不重置。
// 每波时长和怪物数量以后再调，测试阶段先短一些、方便测。
export const WAVES_PER_CHAPTER = 6;
export const CHAPTERS = 3; // 首发 3 章：第一章陈塘关、第二章西岐城外 · 十绝阵、第三章界牌关 · 诛仙阵。每一章的内容见 chapters.ts
export const TOTAL_WAVES = WAVES_PER_CHAPTER * CHAPTERS;
export const CHAPTER_NAME = ['', '第一章 · 陈塘关', '第二章 · 西岐城外', '第三章 · 界牌关'];
/** 第 n 波（全局编号，1 起）在第几章。 */
export const chapterOf = (n: number) => Math.ceil(n / WAVES_PER_CHAPTER);
/** 第 n 波是本章的第几波（1..6）。 */
export const waveInChapter = (n: number) => ((n - 1) % WAVES_PER_CHAPTER) + 1;
export const isBossWave = (n: number) => waveInChapter(n) === WAVES_PER_CHAPTER;
/** 每章第 4 波来精英。 */
export const isEliteWave = (n: number) => waveInChapter(n) === 4;
/**
 * 这一波本来出几只精英（劫三起多出来的那只另算，见 jie.ts）：每章第 4 波（第三章两只）；
 * 第二、三章的第 4 波（第 10、16 波）换成了回响化身遭遇战（sim/echo/），本章自己的精英（金光力士、截教剑侍）挪到第 2 波（第 8、14 波）出一只——
 * 两波一个波峰（实现阶段暂定，★ 待评审确认）。第一章不动。
 */
/**
 * 一波里另外再陆续来的精英（用户 2026-11-12：「精英怪的数量比较稀少，出现得更多」）：原来一波最多在 35% 处来一批（多数波一只也没有）；
 * 现在本章第 from 波起的每个普通波，在波内进度 at（按章）的几处各再来 n 只（第 6 波是首领，有遭遇战的那一波不加）。
 */
export const ELITE_FLOW = { from: 2, at: [[0.55, 0.8], [0.55, 0.8], [0.7]], n: 1 }; // 按章：第三章的精英本来就多、更硬，只加一批；时刻和包围（六成）错开
/** 第 n 波另外陆续来精英的那几处（波内进度）。 */
export const eliteFlowAt = (n: number) => ELITE_FLOW.at[Math.min(ELITE_FLOW.at.length, chapterOf(n)) - 1];
export const eliteCount = (n: number) => (isEliteWave(n) ? (chapterOf(n) >= 3 ? 2 : 1) : chapterOf(n) >= 2 && waveInChapter(n) === 2 ? 1 : 0);
/**
 * 第 n 波的时长：每一波都是 WAVE_SECONDS 秒（首领波没有倒计时）。
 * 用户 2026-11-12：「每关的时长固定一下，至少要有 45 秒，不能太少」（原来本章第 1 波 20 秒、每波 +5 秒，最长 40 秒）。
 */
export const WAVE_SECONDS = 45;
export const waveDuration = (_n: number) => WAVE_SECONDS;
/** 敌人随波次变强、变多的节奏（tools/balance.ts 跑出来调的；表现层不读）。 */
export const WAVE_CURVE = {
  // 气血（M4 数值平衡，用户 2026-11-11：「一般情况下不应该出现秒杀，只有在成型之后可以秒杀」）：
  // 原来是 1 + 0.14 ×（波次 − 1）、整局一直涨，敌人的血和人物每一下的伤害一起涨，从头到尾都是一两下就死（第 1、2 波几乎全是一下打死）。
  // 改成：整体 ×1.6（凡 / 灵品的法宝要两三下），第 9 波以后不再涨（第二章后半起人物的构筑涨得比血快，成型以后一下打死一片）。
  hpBase: 1.6, // 敌人气血的整体倍率（首领另算，见 BOSS / 各章首领的 hp）
  hpPerWave: 0.14, // 前 hpKnee 波：每波血量 +14%（相对第 1 波）
  hpKnee: 8, // 第 hpKnee + 1 波（第 9 波）以后改按 hpLate 涨
  hpLate: 0, // 第 9 波以后每波 +这么多（相对第 1 波）：不再涨，靠数量、出手、精英与首领施压
  dmgBase: 1.3, // 第 1 波的伤害倍率（开局要有压力：原来是 1）
  dmgPerWave: 0.075, // 每波伤害 +7.5%（原来 +8%）
  spawnBase: 1.6, // 每秒刷怪数 = (spawnBase + 波次 × spawnPerWave) × (0.7 + 0.6 × 波内进度)，封顶 spawnCap
  spawnPerWave: 0.32,
  spawnCap: 13,
};
/**
 * 包围：波次进行到六成时在人物四周来一整圈（from 波起，base + 波次只）。
 * 兵刷在屏幕外（贴着镜头外沿的一整圈，spawn.surgeSpots），先冲进来（rush 像素 / 秒），冲到离人物 ring 的椭圆上就恢复平常的速度、
 * 慢慢合拢 —— 合围圈还是原来那么大，只是不再凭空出现在屏幕里；冲了 rushMax 秒还没到（人物在跑）也恢复平常的速度。
 */
export const SURGE = { from: 2, base: 18, ring: { x: 170, y: 128 }, rush: 170, rushMax: 2 }; // 用户：开局要有压力 —— 第 2 波就来一圈（原来第 3 波起、10 + 波次只）
/** 第 n 波的敌人强度：血量与伤害倍率。血量前 hpKnee 波每波 +hpPerWave，之后每波 +hpLate（都相对第 1 波），整体再乘 hpBase。 */
export const waveScale = (n: number) => {
  const C = WAVE_CURVE;
  const k = n - 1;
  return { hp: C.hpBase * (1 + Math.min(k, C.hpKnee) * C.hpPerWave + Math.max(0, k - C.hpKnee) * C.hpLate), dmg: C.dmgBase + k * C.dmgPerWave };
};
/** 第 n 波、波内进度 k（0..1）时的每秒刷怪数。 */
export const spawnRate = (n: number, k: number) => Math.min(WAVE_CURVE.spawnCap, (WAVE_CURVE.spawnBase + n * WAVE_CURVE.spawnPerWave) * (0.7 + 0.6 * k));
/** 商店物价随波次上涨：第 n 波 ×base ×(1 + (n − 1) × PRICE.perWave)。 */
export const PRICE = { base: 1.25, perWave: 0.11 }; // 11-12：整体 ×1.25（原来 1）、每波 0.09 → 0.11
/**
 * 经济的几个旋钮（用户 2026-11-12：「我第一章就能把所有的法宝升级满，价格设计、概率都不合理：法宝的概率得降低、刷新成本得增加、
 * 商品价格得增加，增加灵石百分比的也过强；敌人多没问题，但是太容易提升有问题，一般得第三章才可能把所有的升级满才合理」）。
 * tierPrice：新买一件法宝按它的品阶定价；upPrice：同名件（升阶用）按手里那件的品阶定价（凡 → 灵、灵 → 仙各要几倍凡品价）；spirit：器灵的价是凡品价的几倍；fragment：碎片是同名完整件的几成；
 * weaponShare：一格货是法宝的几率（其余是灵物、丹药、符箓）；lingshi：拾到的灵石按这个倍数入账（经验不变）。
 */
export const ECON = { tierPrice: [0, 1, 2.5, 5, 10], upPrice: [0, 3.5, 10, 0], spirit: 12, fragment: 0.3, weaponShare: 0.3, lingshi: 1 };
// 11-12（按用户劫三的实际进账校准：第 1、2、3 波 75、150、225）：升阶 凡 → 灵 ×1 → ×3.5、灵 → 仙 ×2 → ×10，器灵 ×6 → ×12，法宝货 45% → 30%
export const priceScale = (n: number) => PRICE.base * (1 + (n - 1) * PRICE.perWave);
/**
 * 刷新商店的价格：第 n 波的起价 REROLL.base + n × REROLL.perWave，这一轮每刷一次再 ×REROLL.grow（越刷越贵，涨得越来越快）；
 * 下一次商店重新从起价算。off：便宜几成（修为「讨价」，Player.boon.reroll；没有就是原价）。
 * 用户 2026-11-12：「刷新消耗的灵石要增加，每次刷新都会更多，越后面的关卡也会更多；现在后面灵石花不完，不太合理」
 * （原来是 2 + n × 0.5 + 已刷次数：第 16 波刷一次才 10 灵石，那一波进账六七百）。
 * 第 1 波：7、10、15、22、33……；第 10 波：20、30、45、68、101……；第 16 波：29、44、66、98、148……
 */
export const REROLL = { base: 5, perWave: 1.5, grow: 1.5 }; // 11-12 再调：3 / 1 / 1.4 → 4 / 1.2 / 1.45
export const rerollPrice = (n: number, times: number, off = 0) =>
  Math.max(1, Math.round((REROLL.base + n * REROLL.perWave) * Math.pow(REROLL.grow, times) * (1 - off)));

/**
 * 五行（用户 2026-11-12：「同时有 4 个不同的属性应该很厉害，同时有 3 个一样的属性也应该很厉害……有质变就行」「宠物自带一个五行，
 * 和四个法宝正好凑到五个五行，五个五行才质变」「五行不要无限循环」）。方向是用户定的，具体做法和数值 暂拟，待评审确认。
 * 件数 = 法宝 + 宠物（core.elementCounts）。规则在 sim/wuxing.ts（三件档的金气、藤蔓、震地，三才 / 四象 / 五行俱全）和 core.hitEnemy。
 *
 * 同行（纵深）：一 / 二件照旧；三件是质变；四件（三件法宝 + 宠物，或四件法宝）把三件档再加强一档，不另起新机制。下标是件数（四件以上按四件）。
 *   金：斩杀线 exec，斩杀时迸出 jinqi.n 道金气、各斩身边一只（伤害 = 被斩那只最大气血 × jinqi.mul，不少于斩它的那一下；被金气打的再按斩杀线判一次，但不再迸金气）。
 *   木：击杀时 vine.cd 秒内最多一次，冒出藤蔓缠住身边 vine.n 只（绞一下：木行伤害 vine.base × 品阶倍率 × 伤害 / 木行亲和加成；减速 vine.slow、受伤 +vine.vuln（单算一层，和别的易伤相乘）、vine.t 秒；四件先定住 vine.root 秒），击杀回血几率 heal。
 *   水：寒彻——命中冻结的几率 freezeChance（两件就有 5%），冻住的敌人受伤 ×frost。
 *   火：燎原——烧着死的敌人炸开，半径 blaze.r，炸的伤害 = 它身上每秒灼烧 × blaze.mul。
 *   土：不动如山（站定受伤减半）+ 站稳 quake.still 秒震地一圈：半径 quake.r、伤害 quake.base × 品阶倍率 × 伤害 / 土行亲和加成，击退，站着不动每 quake.cd 秒一圈；四件震晕 quake.stun 秒。
 * 异行（广度）：凑齐不同的五行（宠物那一行也算）。三行「三才」、四行「四象」、五行「五行俱全」。
 *   react：相生那一下的伤害加成；mark：印记持续时间加成；俱全另外相生不挑顺序（见 core.hitEnemy），同一只敌人相生之后 cd 秒内不再相生。
 */
export const WX = {
  exec: [0, 0, 0, 0.15, 0.2],
  jinqi: { n: [0, 0, 0, 1, 2], r: 60, mul: 0.5 },
  vine: { n: [0, 0, 0, 4, 6], r: 36, slow: 0.5, vuln: 0.3, t: 1.6, root: [0, 0, 0, 0, 0.5], cd: 0.5, base: 30 },
  heal: [0, 0, 0, 0.08, 0.12],
  frost: [1, 1, 1, 2, 2.5],
  freezeChance: [0, 0, 0.05, 0.15, 0.2],
  blaze: { r: [0, 0, 0, 26, 32], mul: [0, 0, 0, 3, 3.5] },
  quake: { still: 0.8, cd: [0, 0, 0, 1.5, 1.2], r: [0, 0, 0, 56, 70], base: 90, kb: 220, stun: [0, 0, 0, 0, 0.35] },
  set: [
    { n: 3, name: '三才', react: 0.2, mark: 0 },
    { n: 4, name: '四象', react: 0.4, mark: 0.5 },
    { n: 5, name: '五行俱全', react: 0.6, mark: 0.5 },
  ],
  cd: 0.5, // 五行俱全：同一只敌人相生之后多久内不再相生
};
/** 五行加成的说明（1 / 2 / 3 / 4 件），界面显示用；三件、四件档冒号前是名字。数值改了这里跟着改（读 WX）。 */
export const ELEMENT_BONUS: Record<Element, [string, string, string, string]> = {
  metal: ['易中要害', '暴击更重', '斩杀：残血之敌一击即斩，迸出金气', '裂金：斩杀更狠，金气更多'],
  wood: ['雷电多跳一敌', '气血自复', '生生不息：击杀生藤，绞缚近敌', '万木：藤蔓更多，先定其身'],
  water: ['冻结与迟滞更久', '命中偶尔冻结', '寒彻：更易冻结，冻者受伤翻倍', '玄冰：冻结更频，冻者受伤更重'],
  fire: ['灼烧更烈', '灼烧可叠加', '燎原：焚毙之敌炸开，燃及周遭', '焚天：燎原更大、更烈'],
  earth: ['护体更坚', '击退更远', '不动如山：站定减伤，时时震地', '厚土：震地更大更勤，兼能震晕'],
};
/** 异行（三才 / 四象 / 五行俱全）的说明，界面显示用（前面会接「三才：」这样的名字，这里不再写名字）。 */
export const WUXING_SET_DESC: Record<3 | 4 | 5, string> = {
  3: '天地人三才相合，相生更烈',
  4: '四象齐聚，相生更烈，印记更久',
  5: '相生不拘次序，威力最盛',
};
/** 品阶配色（界面）：凡 银、灵 青、仙 紫、神 金。 */
export const TIER_COLOR = ['', '#c9bcae', '#7cc4c4', '#d47aa0', '#f7dc7a'];
/** 五行配色（界面）。 */
export const ELEMENT_COLOR: Record<Element, string> = { metal: '#e0a83a', wood: '#6fa35a', water: '#3f8a9e', fire: '#d9452b', earth: '#b06a28' };
/** 宠物进化分支的说明（用户：宠物只上减益、不打伤害）。混天绫 bind / fire；哮天犬 pounce / fang；黑虎 gale / broke；青鸾 rime / deep；雷鹏 flash / clap；毫毛猴 hold / drowse（后五种 暂拟，待评审确认；毫毛猴的两条路是孙悟空那条线拟的）。 */
export const PET_BRANCH: Record<PetBranch, { name: string; desc: string }> = {
  bind: { name: '缚龙', desc: '缚龙之术：缠时先定身，缚得更多' },
  fire: { name: '火绫', desc: '「引火」：被缚之敌火行伤更重，灼烧更久' },
  pounce: { name: '天狗', desc: '「扑倒」：扑咬时按住敌人，咬得更多' },
  fang: { name: '金牙', desc: '「裂甲」：被咬之敌金行伤更重，更易被暴击' },
  gale: { name: '啸风', desc: '「虎啸生风」：一啸吼退群敌，震慑更久' },
  broke: { name: '破财', desc: '吓破敌胆：震慑之中被斩，多掉灵石' },
  rime: { name: '冰魄', desc: '冰魄寒羽，沾之即冻' },
  deep: { name: '沧溟', desc: '沧溟之寒：沾羽之敌水行伤更重，愈加迟缓' },
  flash: { name: '掣电', desc: '电掣更急，麻得更多、更久' },
  clap: { name: '霹雳', desc: '霹雳一声：麻痹之敌木行伤更重，电光传及近旁' },
  surge: { name: '怒涛', desc: '浪头更大，推得更远，湿透更多' },
  marrow: { name: '霜髓', desc: '寒入骨髓：湿透之敌冻得更久，冻时受伤更重' },
  hold: { name: '定身法', desc: '一声「定」：被戏之敌先定其身' },
  drowse: { name: '瞌睡虫', desc: '弹入瞌睡虫：敌人昏昏欲睡，戏弄更久' },
};
