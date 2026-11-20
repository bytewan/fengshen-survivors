// 法宝的出手逻辑。每件法宝一个 fire 函数；冷却与基础伤害在 catalog.WEAPONS，品阶的量变（范围、数量、次数）
// 和仙品的质变写在下面的 TUNE 表里，神品再由器灵变一次。DPS 用 tools/weapon-dps.ts 逐件、逐品阶量过（群伤、单体、首领）。
// 后加的 8 件（打神鞭 … 捆仙绳）在 FIRE 表的后半；它们的持续效果（旋风、结界、光束、水域、火浪、焦土、金绳）是
// world.zones 里的区域，每帧的打法在 zones.ts；打神鞭的落鞭走 Pending（kind 'lash'），七禽的火鸟走 w.knives（kind 'wuhuo'）。
// 用户口径：冷却不能太短（不低于 1.2 秒）；法宝飞得不能太快，要看得清；持续类效果（悬停、区域、DoT）时长给足，不要一闪而过；
// 法宝、区域、宠物都不碰敌人的弹道；攻击距离不能太大（2026-11-10）：索敌不超过 REACH.seek（130）、效果最远不超过 REACH.max（145），
// 见 config.REACH —— 索敌半径不吃范围加成，伸出去的长度吃范围加成但封顶，连跳、追踪、捆下一只都只挑 REACH.max 以内的。
import { ENEMIES, REACH, RING } from './config.ts';
import { WEAPONS } from './catalog.ts';
import { HUAXUE, XINGHUANG, addBleed, buildGrid, elementCounts, enemiesWithin, forNear, hitEnemy, inReach, nearestEnemy, segDist, slowEnemy, weaponDamage } from './core.ts';
import { ZONE_FX, addZone, inSector } from './zones.ts';
import { range } from './rng.ts';
import { fireSanjian, sanjianStep } from './heroes/yangjian.ts';
import { fire2, followUp2, land2, stepKnife2 } from './arti2.ts';
import { fireDinghai, landBead } from './heroes/zhao.ts';
import { fireStaff, landStaff } from './heroes/leizhenzi.ts';
import { fireDou, updateDou } from './heroes/yunxiao.ts';
import { fireHeiyan, updateWheels } from './heroes/mozha.ts';
import { fireFulong, updateRopes } from './heroes/huizhao.ts';
import { fireQiankuntu, updateScrolls } from './heroes/huiyun.ts';
import { fireYoulong, updateLoongs } from './heroes/huiao.ts';
import { heroHaste } from './heroes/passives.ts';
import { fireJingu, jinguStep, landRock } from './heroes/wukong.ts';
import type { Enemy, Knife, OwnedWeapon, Pending, Player, Ring, SimEvent, WeaponKind, Zone } from './types.ts';
import type { World } from './world.ts';

/** 索敌半径：离人物这么远以内的敌人才会被选为目标（不吃范围加成）。 */
const SEEK = REACH.seek;

/** 各件法宝的打法参数。数组都按品阶取（下标 1 凡 … 4 神）。 */
export const TUNE = {
  qiankun: {
    seek: SEEK, // 索敌距离（原来 210：会朝画面外的敌人掷圈）
    speed: 160, // 飞出速度（用户：法宝太快看不清；原来 270）
    back: 220, // 折返的最高速度（原来 320；2026-11-11 数值平衡 200 → 220：圈回来得快一点，出手间隔不被飞行拖长）
    range: [0, 112, 114, 120, 120], // 飞多远开始折返（灵品起飞得更远；灵品 120 → 114：飞得远、回来晚，灵品的群伤反而比凡品低）；吃一半的范围加成，加成后最多 far
    far: 124,
    leash: REACH.max - 15, // 圈心离人物胸口超过这么远就提前折返（人物往反方向走时，圈也不飞出画面）
    radius: [0, 8, 9.5, 10, 10], // 判定半径的基数（灵品 8.8 → 9.5）（灵品起圈更大，仙品再大一圈），飞到最远处放大到 1.7 倍
    burn: 0.15, // 命中带轻微灼烧：每秒为这一下的 15%
    burnT: 2,
    hover: 1, // 仙品：飞到最远处悬停旋转多久
    hoverPast: 0, // 仙品的圈飞到目标那里就停下悬停（原来过目标 30 像素：打首领时绞不到它），最少飞 hoverMin、最多 hoverMax
    denseHover: 90, // 仙品起朝这么远以内敌人最密的地方掷（首领在索敌半径里就朝首领），不是朝最近的那只；0 = 照旧朝最近的
    hoverMin: 30,
    hoverMax: 100, // 悬停点离出手处最远多远（绞杀的圈大，悬停点再远就绞到画面外去了）
    hoverTick: 0.25, // 悬停时每隔多久绞杀一次圈里的敌人（停一秒绞四下，一下一下看得清）
    hoverDmg: 0.55, // 每次绞杀的伤害（相对单发）。悬停是仙品的主要输出（0.5 → 0.55，配合下面 grindMax 3 → 2）
    hoverGrow: 2.2, // 悬停时判定再放大一些（圈转起来，绞住一圈）
    grindMax: 2, // 一次悬停里同一只最多被绞几下（绞的是一圈敌人，不是一只；3 → 2：单打一只精英比中位数高两成多）
    flameR: 62, // 器灵「赤焰轮」：折返时炸开的火环半径
    flameDmg: 0.6, // 赤焰轮的火环（0.9 → 0.6：单体比中位数高三成）
    split: 0.35, // 器灵「金环分光」：身边只有一只时，第二枚圈偏开多少角度飞满全程（原来不论几只，两枚都偏开 0.5 飞满全程：都从目标身边擦过去，打首领比仙品还弱）
    splitGap: 50, // 器灵「金环分光」：第二枚圈飞向离第一个目标至少这么远的下一只（各绞一处）
  },
  huojian: {
    reach: [0, 104, 106, 106, 106], // 索敌距离（不超过枪芒长度，刺出去一定够得着）；吃范围加成，最多 REACH.seek
    len: [0, 108, 114, 114, 114], // 枪芒长度（灵品起更长）；吃范围加成，最多 far
    far: REACH.max - 12, // 枪从胸口刺出，再加判定的半宽，枪尖打到的离人物脚下不超过 REACH.max
    width: 11, // 贯穿判定的半宽
    thrusts: [0, 1, 2, 2, 2], // 一次出手刺几枪（灵品起两连刺）
    gap: 0.24, // 两连刺之间隔多久
    second: 0.3, // 第二枪是回手一刺，伤害为第一枪的这一比例
    pierce: [0, 4, 4, 5, 5], // 一枪最多串几只（从近到远）
    burn: 0.3,
    burnT: 2.5,
    trail: { life: 3.2, dmg: 0.03, w: 8 }, // 仙品：火痕存在多久、每跳伤害（相对单发，0.3 秒一跳）、半宽
    fan: 0.24, // 器灵「梨花枪」：三枪的张角
    side: { len: 0.9, dmg: 0.75 }, // 梨花枪两侧的枪短一些、轻一些（中间那杆轻一些、两侧的重一些：多串几只，单打首领不至于翻倍）
    sun: { len: 1.08, burn: 1.5, pierce: 1 }, // 器灵「贯日」：枪芒更长、灼烧更重
  },
  jiulong: {
    r: [0, 104, 106, 108, 116], // 火罩半径（灵品起更大；神品 108 → 116：神品的伤害都溢出在小兵身上，罩得大一点群伤才跟得上）；吃范围加成，最多 REACH.seek。走位时最近的敌人多在 50–80 像素：罩小了一次只烧到一两只
    burn: 0.36, // 点燃：每秒为这一下的 36%（2026-11-11 0.3 → 0.36，单发倍率 0.72 / 1 / 1.18 / 2.4 → 0.7 / 0.86 / 1.12 / 2.3：那一下轻一点、烧得重一点，灵品一下打死 50% → 25%）（原来 10%；火罩打首领吃亏在够不着，烧得久一点补上）
    burnT: 2.5,
    dome: { life: 2.2, dmg: 0.04 }, // 仙品：笼罩多久、每跳伤害（相对单发，0.3 秒一跳）
    wide: 1.05, // 器灵「焚天」：范围倍数（罩子已经很大了，再大一点就烧得到一大片）
    core: 1.4, // 贴身的敌人吃这一倍数，往外线性降到边缘的 edge 倍（越靠近哪吒越烫：贴上来的精英烧得最狠；1.3 → 1.4）
    edge: 0.82, // 原来 1.5 → 0.65：首领总在火罩边上，只吃到六成；0.9 → 0.82：群伤比单体高得多
    waitCrowd: 3, // 首领在附近时：火罩先等首领进罩，除非身边已经有这么多只兵
    dragons: 9, // 器灵「九龙吐焰」
    dragonLen: 1.34, // 火龙从火罩边上（半径的 dragonFrom 倍）喷到 dragonLen 倍，最远 REACH.max（原来 1.8 倍：喷到 190 像素外）
    dragonFrom: 0.5,
    dragonDmg: 0.25, // 0.2 → 0.25（九龙吐焰的群伤偏低）
  },
  leigong: {
    seek: SEEK, // 原来 190（还吃范围加成）
    hop: 86, // 连跳的距离（只跳到离人物 REACH.max 以内的敌人身上）
    strikes: [0, 5, 7, 7, 6], // 2026-11-11 数值平衡（没成型不秒杀）：4 / 5 / 5 / 5 → 5 / 7 / 7 / 6——单下轻了、出手勤了（冷却 2.2 → 1.4 秒，单发倍率减半还多），多跳几只把群伤补回来；量具里凡品一下打死 92% → 12%、灵品 92% → 23%。一道雷打中几只（木行一件再 +1，雷公鞭自己就是木行）。连跳只跳到画面里的，跳得多一点补回射程收短少打的
    first: 1.7, // 2026-11-11 1.15 → 1.7（连跳轻了以后，落雷的那一下相对重一点：单打一只、打首领不掉队）；落雷的那一下更重（之后的连跳按 falloff 衰减）；原来 1.4：单打一只（首领）太狠
    storm: 1.15, // 2026-11-11 1.45 → 1.15（平常就跳得多了）；器灵「五雷轰顶」：连跳次数的倍数（且不再衰减；1.2 → 1.45：神品一下就溢出，多跳几只群伤才上得去）
    twin: 0.6, // 器灵「雌雄双鞭」：第二道雷（雌鞭）跳几次（相对雄鞭；原来三分之一）
    falloff: 0.85, // 每跳一次伤害衰减
    stun: 0.15,
    mark: { delay: 1.2, dmg: 0.3, r: 12 }, // 仙品雷印：多久后再落雷、伤害（相对这一跳）、落雷范围
  },
  fantian: {
    seek: SEEK, // 原来 200：大印多半砸在画面外
    bossFirst: true, // 挑落点时首领算 BOSS_WEIGHT 只（首领战里别总去砸它召来的小兵）
    r: [0, 28, 36, 42, 42], // 2026-11-11 数值平衡（没成型不秒杀）：22 / 27 / 31 / 31 → 28 / 36 / 40 / 40，正中的范围 0.35 → 0.25、正中 ×2.5 → ×4.2、边上 0.72 → 0.85，单发倍率 0.95 / 1.34 / 1.85 / 3.8 → 0.56 / 0.92 / 1.17 / 2.5——印大一圈、压住的每只轻一半，只有正下方那一只照旧砸得重（凡品一下打死 56% → 31%、灵品 67% → 27%）。大印半径（灵品起更大，仙品再大一圈：射程收短后够得着的敌群小了，一印要多压几只）。印要压得死人：罩住一大片小兵、每只只掉一点血就没有分量了
    stun: [0, 0.8, 1.1, 1.1, 1.1], // 晕多久（灵品起更久）
    warn: 0.55, // 预警多久落下
    kb: 140,
    core: 0.25, // 正中：离落点半径的这一比例以内的敌人（就是瞄准的那只）吃 coreMul 倍；往外按距离衰减到 edge 倍
    coreMul: 4.2, // 大印正下方那只被压个正着（对精英也有用，不只是清杂兵；首领战里大印先砸首领，原来的 3 倍太狠）
    edge: 0.85,
    crack: { life: 4.5, grow: 1.25 }, // 仙品：地裂存在多久、比印大多少
    quake: { delay: 0.3, grow: 1.45, dmg: 0.85 }, // dmg 0.6 → 0.85（地裂震波的群伤偏低） // 器灵「地裂震波」：再震一圈（印的 1.7 倍大；仙品起印大了一圈，原来的 2.1 倍就震到画面外去了）
    side: 0.72, // 2026-11-11 再 0.65 → 0.72（器灵倍率 0.85 → 0.82）；器灵「三山压顶」：另外两方小一些的印的伤害（0.5 → 0.65，器灵倍率 1 → 0.85：单打一只的那方印别太重，两方小印多砸一点群）
  },
  zhanxian: {
    seek: SEEK, // 原来 200
    hop: 140, // 穿刺之后找下一只的距离（只找离人物 REACH.max 以内的）
    launch: 110, // 出手时的速度
    speed: 150, // 追击速度（用户：飞刀太快看不清；原来 240）
    steer: 8, // 转向的快慢
    hits: [0, 5, 6, 7, 8], // 一把飞刀刺几下（灵品起更多）。刺得多、每下轻一些：群里来回穿刺是它的本事，单打一只（同一只最多刺两下）就弱一些
    turn: 0.32, // 身边没有别的目标时，先穿过去飞多久再绕回来补刺（来回穿刺；同一只最多刺两下）；飞到 REACH.max 就提前拐回来
    bleed: 0.18, // 仙品：每层流血每秒为这一下的 18%
    bleedT: 3.5,
    many: 3, // 器灵「万刃」：两侧多出的两把是小刀，刺得少、轻一些
    spread: 0.6,
    side: { hits: 3, dmg: 0.6 },
    behead: 1.3, // 器灵「请宝贝转身」：对精英与首领的倍率（原来 1.7：打首领是同品阶中位数的两倍多）
    life: 5,
  },
  hanbing: {
    seek: SEEK, // 原来 150（还吃范围加成）
    spikes: [0, 3, 4, 4, 4], // 2026-11-11 数值平衡（没成型不秒杀）：根数没动，冷却 3 → 1.5 秒、单发倍率减半（1.1 / 1.41 / 1.48 / 2.55 → 0.52 / 0.7 / 0.74 / 1.28）、冻住 1.1 → 0.6 秒：落得勤、每根轻，量具里凡 / 灵品一下打死 86% → 5%。冰棱数量（灵品起更多；器灵「寒冰阵」再翻倍）；散落的冰棱也落在索敌半径里
    r: 9,
    warn: 0.4,
    freeze: 0.6,
    frost: { r: 22, life: 3.2 }, // 仙品：冰棱处结出的寒霜（减速）
    chill: { delay: 1, r: 30, freeze: 1, dmg: 0.15 }, // 仙品：寒气蔓延，片刻后冻住附近的敌人（重在冻，伤害轻）
  },
  // ---- 剩下 8 件公共法宝（区域在结算时的打法见 zones.ZONE_FX；化血神刀的流血与血雾见 core.HUAXUE） ----
  dashen: {
    seek: SEEK, // 在多远内找血最厚的（原来 190，还吃范围加成）
    delay: 0.32, // 鞭子从天上落下要多久（先预警，跟着目标走）
    len: 52, // 鞭痕长度：过目标、顺着人物到目标的方向
    w: 9, // 鞭痕半宽（7 → 9）
    body: 1.0, // 鞭痕上别的敌人挨这一鞭的多少（对精英、首领的倍率降下来之后，群伤靠鞭痕补上；0.8 → 1：凡品群伤比中位数低两成）
    elite: 1.6, // 对精英的倍率（原来 2，首领也吃 2：打首领比别的法宝高出一倍）
    boss: [0, 1.2, 1.2, 1.3, 1.3], // 对首领的倍率（仙品「打神」起首领不吃控制，倍率再高一档；原来凡 / 灵 2、仙品起 3）
    lashes: [0, 1, 2, 2, 2], // 一次抽几只（灵品起两只）
    extra: 0.25, // 身边只有一只时，多出来的那一鞭也抽它，但只有这一比例
    gap: 0.14, // 两鞭错开多久落下
    kb: 60,
    stunElite: 1, // 仙品「打神」：镇住精英多久
    ring: { r: 34, dmg: 0.7, kb: 90 }, // 仙品：落点震出一圈（只波及小怪；dmg 0.6 → 0.7）
    seal: 0.25, // 器灵「封神」：血量低于这一比例的非首领敌人直接抽散
    nine: { n: 3, gap: 0.26 }, // 器灵「九节」：同一目标连抽几鞭、每鞭间隔
  },
  huaxue: {
    reach: [0, 92, 92, 92, 92], // 斩多远（2026-11-11 凡 88 → 92、灵品起 90 → 92）（扇面半径）；吃范围加成，最多 REACH.seek。比火尖枪、火罩短；走位时身后追来的兵多在 50–70 像素，太短就斩不到
    arc: [0, 1.0, 1.1, 1.1, 1.1], // 半张角：凡 ±57°（原来 ±55°），灵品起 ±63°（原来 ±60°；2026-11-11：凡 / 灵品群伤比中位数低一两成）
    kb: 70,
    sea: { r: 1.1, arc: 1.2 }, // 器灵「血海」：半径 ×1.1、半张角放到 ±69°（原来 ±75°：群伤高、单体低两成）
    soul: { per: 0.3, cap: 2 }, // 器灵「噬魂」：每只流着血的敌人每秒给人物回多少气血（流血每 0.5 秒一跳），每秒最多回多少
  },
  dingfeng: {
    seek: SEEK, // 原来 180（还吃范围加成）：旋风多半起在画面外
    minD: 50, // 旋风尽量起在离人物这么远以外（别把敌人卷到自己身上）
    r: [0, 54, 62, 62, 62], // 2026-11-11 数值平衡（没成型不秒杀）：再大一圈（50 / 58 → 54 / 62）、一次多卷一只、风眼 ×2.5 → ×3、单发倍率 1 / 1.45 / 1.42 / 2.6 → 0.82 / 1.12 / 1.1 / 2.2（凡品一下打死 59% → 37%、灵品 72% → 40%：出手慢的重击，留在四成以内）。卷人的半径（灵品起更大；凡 46 → 50、灵 54 → 58：凡 / 灵品群伤偏低）；只卷离人物 REACH.max 以内的
    life: [0, 1.5, 1.8, 3, 3], // 卷多久再吹散（灵品卷得更久；仙品「定风」持续更久）
    pull: [0, 72, 80, 80, 80], // 卷的速度（像素 / 秒；兵只有 24–34，卷得进来）
  },
  qinglian: {
    near: 110, // 身边这么远内有敌人、或者气血不满，才展开结界
    r: [0, 50, 60, 60, 60],
    life: [0, 4, 5.5, 6, 6],
    heal: [0, 1.5, 1.8, 2, 2], // 站在里面每秒回多少气血（仙品起跟着人走，等于一直在回：比木行两件的 +0.6 高三倍多，是它占一个法宝位的价值）
    thorn: 0.3, // 荆棘每 0.4 秒刺一下，为单发的这一比例
    dais: { heal: 1.8, dodge: 0.15 }, // 器灵「莲台」：回血 ×1.8、闪避 +15%
    thornMul: 2.2, // 器灵「荆棘」：荆棘伤害的倍数
  },
  yinyang: {
    len: [0, 112, 120, 120, 110], // 光束长度（灵品起更长；神品 120 → 110：器灵「乾坤」各扫一整圈，群伤比中位数高五成）；吃范围加成，最多 far
    far: REACH.max - 5, // 光束从胸口照出、再加半宽，照到的离人物不超过 REACH.max
    sweep: [0, 1.22, 1.3, 1.9, 1.9], // 扫过的角度：凡 70°（原来 66°，凡品群伤偏低），灵品 74°（原来 70°），灵品 70°，仙品起两道各 110°（原来凡 92° / 灵 110°：扫得宽、一下很轻，打首领只有中位的一半）
    dur: [0, 0.5, 0.6, 0.6, 0.6], // 扫一下要多久
    w: 5, // 光束半宽
    cosmos: 1.2, // 器灵「乾坤」：扫整整一圈要多久
  },
  xuanyuan: {
    seek: SEEK, // 原来 170（还吃范围加成）
    caster: 4, // 挑地方时一只术士算几只（术士总是离群站着：水旗先淹它，水柱一下就能冲倒）
    r: [0, 40, 48, 52, 60], // 水域半径（神品再大一圈：两个器灵挑落点只能挑射程里的敌群）
    life: [0, 3.5, 4.5, 5, 5], // 存在多久（仙品「漩涡」更久）
    dmg: [0, 0.04, 0.04, 0.03, 0.03], // 每 0.3 秒一跳，为单发的这一比例（越靠中间越深、越伤，见 zones.ZONE_FX.water）
    pillar: { r: 14, mul: 2.2 }, // mul 2.4 → 2.2（站在正中的精英单体偏高） // 展开时中心先涌起一道水柱：打中心这么远内的敌人（直接命中，打水行印记）
    pull: 16, // 仙品「漩涡」：往中心吸的速度
  },
  wuhuo: {
    aim: 100, // 索敌（吃范围加成，最多 REACH.seek）
    reach: [0, 86, 96, 96, 96], // 火浪推多远（灵品起更远）；吃范围加成，最多 far
    far: REACH.max - 6,
    arc: [0, 0.55, 0.58, 0.62, 0.62], // 半张角：凡 ±32°（原来 ±29°：凡品群伤偏低），灵品 ±33°（原来 ±36°：群伤高、单体低），仙品起 ±36°
    // 仙品「七禽」：火鸟（先扑 REACH.seek 以内的首领和术士；原来 230 像素内的术士都扑，seek 170），追的、换的目标都在离人物 REACH.max 以内，没得追了就散
    bird: { n: 7, extra: 0.4, dmg: 0.25, speed: 150, steer: 7, life: 2.6, seek: SEEK, burn: 0.3, burnT: 2.5 },
    five: { n: 5, arc: 0.2 }, // arc 0.42 → 0.2（五道各 ±11°：一圈五道群伤比中位数高四成多、单体低两成） // 器灵「五火」：一圈五道（每道 ±24°，道与道之间留着缝；原来 ±36° 连成一整圈，群伤太高、单发只好压得很轻）
    gale: 1.12, // 器灵「焚风」：推得更远（×1.12，原来 1.15；焦土见 zones.SCORCH）
  },
  kunxian: {
    seek: SEEK, // 原来 150（还吃范围加成）
    hop: 60, // 金绳从一只到下一只最远多远（只捆离人物 REACH.max 以内的）
    n: [0, 3, 4, 4, 4], // 一次捆几只（器灵「连环」8 只）
    chain: 8,
    dur: [0, 1.6, 2.1, 2.4, 2.4], // 捆多久（定身）
    vuln: [0, 0.2, 0.25, 0.35, 0.35], // 易伤
    pull: 90, // 仙品「缚仙」：往一起拽的速度
    clash: 0.8, // 仙品：撞到一起的伤害（相对勒住的一下）
    bossSlow: 0.6, // 器灵「困龙」：首领改成大幅减速
  },
};

type Fire = (w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]) => boolean; // 返回 false 表示这次没出手（没目标），冷却不重置

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const area = (p: Player) => 1 + p.stats.area;
/** 伸出去的长度（枪芒、光束、火浪、火罩……）：吃范围加成，加成后不超过 cap。 */
const reachLen = (p: Player, base: number, cap: number) => Math.min(cap, base * area(p));
/** 落点处的范围（大印、鞭痕与震波、旋风、水域）：范围加成最多算到 REACH.area。 */
const aoe = (p: Player) => 1 + Math.min(p.stats.area, REACH.area);
/** 落点离人物太远就往人物那边收（散落的冰棱）：落点和别的落点一样，不超过 REACH.seek。 */
function clampToReach(p: Player, x: number, y: number): [number, number] {
  const d = Math.hypot(x - p.x, y - p.y);
  if (d <= REACH.seek) return [x, y];
  const k = REACH.seek / d;
  return [p.x + (x - p.x) * k, p.y + (y - p.y) * k];
}

/**
 * 找敌人最密的地方：在附近随机抽几只，数它们周围 30 像素内的同伴，取最多的那只。
 * minD：候选尽量离人物这么远以外（定风珠：别把敌人卷到自己身上；附近都太近就不管）。
 * weight：一只算几只（玄元控水旗：远处的术士、首领优先；定风珠：首领优先）；不给就是都算一只（番天印照旧）。
 */
export function densest(w: World, p: Player, maxR: number, n = 1, avoid: { x: number; y: number }[] = [], minD = 0, weight?: (e: Enemy) => number): Enemy[] {
  const near = enemiesWithin(w, p.x, p.y, maxR);
  if (!near.length) return [];
  const away = minD > 0 ? near.filter((e) => dist2(e, p) >= minD * minD) : near;
  const pool = away.length ? away : near;
  const sample = pool.length <= 24 ? pool : Array.from({ length: 24 }, () => pool[Math.floor(w.rng.next() * pool.length)]);
  // 加了权重（首领、术士算好几只）的那几只一定参加评选，不靠随机抽中
  if (weight && pool.length > 24) for (const e of pool) if (weight(e) > 1 && !sample.includes(e)) sample.push(e);
  const count = (e: Enemy) => (weight ? near.reduce((a, o) => a + (dist2(o, e) < 30 * 30 ? weight(o) : 0), 0) : near.filter((o) => dist2(o, e) < 30 * 30).length);
  const scored = sample.map((e) => ({ e, s: count(e) }));
  scored.sort((a, b) => b.s - a.s);
  const out: Enemy[] = [];
  for (const { e } of scored) {
    if (out.length >= n) break;
    if ([...out, ...avoid].some((o) => dist2(o, e) < 40 * 40)) continue;
    out.push(e);
  }
  return out;
}

/** 乾坤圈的放大倍数：飞得越远越大，悬停和折返时保持最大（表现层按它换图，判定按它放大）。 */
export function ringGrowth(r: Ring) {
  const k = r.returning || r.hover > 0 ? 1 : Math.min(1, r.out / r.range);
  return 1 + 0.7 * k;
}

/**
 * 掷出一枚乾坤圈。神通散出的八枚 primary = false：不占「主圈在外」、不悬停。
 * reach：目标有多远（仙品起会悬停的圈飞到目标那里就停下，不必飞满全程；最远 hoverMax）。
 */
export function throwRing(w: World, p: Player, wpn: OwnedWeapon | null, tx: number, ty: number, primary: boolean, ev: SimEvent[], dmgOverride?: number, reach?: number) {
  const Q = TUNE.qiankun;
  const sx = p.x + p.facing * 6;
  const sy = p.y - 10;
  const d = Math.hypot(tx - sx, ty - sy) || 1;
  const tier = wpn?.tier ?? 1;
  const canHover = primary && tier >= 3;
  const full = Math.min(Q.far, Q.range[tier] * (1 + p.stats.area * 0.5));
  w.rings.push({
    id: w.nextId++,
    owner: p.id,
    x: sx,
    y: sy,
    px: sx,
    py: sy,
    vx: ((tx - sx) / d) * Q.speed,
    vy: ((ty - sy) / d) * Q.speed,
    out: 0,
    returning: false,
    primary,
    hits: new Set(),
    life: 6,
    dmg: dmgOverride ?? (wpn ? weaponDamage(p, wpn, p.buffs.rage) : RING.damage),
    range: canHover && reach !== undefined ? Math.max(Q.hoverMin, Math.min(full, Q.hoverMax, reach + Q.hoverPast)) : full,
    fireBurst: wpn?.spirit === 'flame',
    hover: 0,
    tier,
    hoverTick: 0,
    canHover,
    r0: Q.radius[tier] * (1 + p.stats.area * 0.3),
  });
  if (primary) p.ringOut = true;
  ev.push({ t: 'throw', owner: p.id, x: sx, y: sy, kind: 'qiankun', tier });
}

/** 火尖枪刺一下（一杆，器灵「梨花枪」是扇形三杆）；仙品起每杆在地上留下火痕。mul：这一枪的伤害倍数（第二枪轻一些）。 */
function thrust(w: World, p: Player, wpn: OwnedWeapon, base: number, ev: SimEvent[], mul = 1) {
  const H = TUNE.huojian;
  const sun = wpn.spirit === 'pierce';
  const len = reachLen(p, H.len[wpn.tier] * (sun ? H.sun.len : 1), H.far);
  const angles = wpn.spirit === 'storm' ? [base - H.fan, base, base + H.fan] : [base];
  const dmg = weaponDamage(p, wpn, p.buffs.rage) * mul;
  const burn = dmg * H.burn * (sun ? H.sun.burn : 1);
  const cap = Math.round(H.pierce[wpn.tier] * (sun ? H.sun.pierce : 1));
  const seen = new Set<number>(); // 梨花枪：一只敌人一刺只挨一枪
  buildGrid(w.enemies);
  const x0 = p.x + p.facing * 4;
  const y0 = p.y - 10;
  for (const a of angles) {
    const sideSpear = a !== base;
    const l = len * (sideSpear ? H.side.len : 1);
    const d = sideSpear ? dmg * H.side.dmg : dmg;
    const x1 = x0 + Math.cos(a) * l;
    const y1 = y0 + Math.sin(a) * l;
    ev.push({ t: 'thrust', owner: p.id, x0, y0, x1, y1, kind: 'huojian', tier: wpn.tier });
    const line = enemiesWithin(w, (x0 + x1) / 2, (y0 + y1) / 2 + 6, l / 2 + 12)
      .filter((e) => !seen.has(e.id) && segDist(e.x, e.y - 6, x0, y0, x1, y1) < H.width)
      .sort((a, b) => dist2(a, p) - dist2(b, p))
      .slice(0, cap);
    for (const e of line) {
      seen.add(e.id);
      hitEnemy(w, e, { dmg: d, by: 'thrust', owner: p.id, from: p, kb: 60, el: 'fire', burn: sideSpear ? burn * H.side.dmg : burn, burnT: H.burnT }, ev);
    }
    // 仙品：枪芒在地上留下一道火痕（地面上的线段：枪芒往下投到脚下）
    if (wpn.tier >= 3) addZone(w, { owner: p.id, kind: 'fireTrail', x: x0, y: y0 + 10, x2: x1, y2: y1 + 10, r: H.trail.w, life: H.trail.life, dmg: d * H.trail.dmg, tier: wpn.tier });
  }
}

/** 在一只敌人身上留雷印：delay 秒后再落一道雷（跟着它走）。 */
function thunderMark(w: World, p: Player, wpn: OwnedWeapon, e: Enemy, dmg: number, ev: SimEvent[]) {
  const M = TUNE.leigong.mark;
  const id = w.nextId++;
  w.pending.push({ id, owner: p.id, kind: 'thunder', x: e.x, y: e.y, r: M.r, t: M.delay, dmg: dmg * M.dmg, target: e.id, tier: wpn.tier });
  ev.push({ t: 'warn', id, kind: 'thunder', x: e.x, y: e.y, r: M.r, t2: M.delay, tier: wpn.tier });
}

// ---------- 剩下 8 件公共法宝用的小工具 ----------

/** 放一块持续效果（区域）并发 zone 事件：带上法宝的品阶和器灵。 */
function openZone(w: World, p: Player, wpn: OwnedWeapon, z: Omit<Zone, 'id' | 't' | 'tick' | 'owner' | 'tier'>, ev: SimEvent[]): Zone {
  const zone = addZone(w, { ...z, owner: p.id, tier: wpn.tier, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
  ev.push({ t: 'zone', id: zone.id, zone: zone.kind, owner: p.id, x: zone.x, y: zone.y, r: zone.r, life: zone.life, kind: wpn.kind, tier: wpn.tier });
  return zone;
}

/** 血最厚的几只（打神鞭）：当前气血最多的优先；一样多（满血的兵）就挑身边同伴多的（鞭痕、震波能多带几只），再挑近的。 */
function thickest(w: World, p: Player, maxR: number, n: number): Enemy[] {
  const near = enemiesWithin(w, p.x, p.y, maxR);
  const crowd = (e: Enemy) => {
    let c = 0;
    for (const o of near) if (dist2(o, e) < 24 * 24) c++;
    return c;
  };
  return near
    .map((e) => ({ e, hp: Math.round(e.hp), c: crowd(e), d: dist2(e, p) }))
    .sort((a, b) => b.hp - a.hp || b.c - a.c || a.d - b.d)
    .slice(0, n)
    .map((x) => x.e);
}

/** 挑落点、挑方向时一只首领算几只：首领战里别总去打它召来的小兵。 */
const BOSS_WEIGHT = 6;
const bossFirst = (e: Enemy) => (e.kind === 'boss' ? BOSS_WEIGHT : 1);

/**
 * 扇面瞄准（化血神刀、阴阳镜、五火七禽扇）：near 按距离排好，在最近的几只（和够得着的首领）里挑一个方向，
 * 让朝那边的扇面（半径 r、半张角 arc）罩住最多的敌人（首领算 BOSS_WEIGHT 只；一样多就挑近的）。返回角度。
 */
function aimSector(near: Enemy[], x0: number, y0: number, r: number, arc: number, cands = 6): number {
  let best = Math.atan2(near[0].y - 6 - y0, near[0].x - x0);
  let bestN = -1;
  const boss = near.find((e) => e.kind === 'boss');
  const pool = boss && near.indexOf(boss) >= cands ? [...near.slice(0, cands), boss] : near.slice(0, cands);
  for (const c of pool) {
    const a = Math.atan2(c.y - 6 - y0, c.x - x0);
    let n = 0;
    for (const e of near) if (inSector(x0, y0, a, arc, r, e.x, e.y - 6, ENEMIES[e.kind].radius)) n += bossFirst(e);
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  return best;
}

/**
 * 七禽：七只火鸟从扇面里飞出，各追一只：先扑首领和放鬼火的术士，再追最近的；都只挑 REACH.seek 以内的。
 * 身边不到七只时，多出来的火鸟都扑向第一只，但轻一些（extra）。火鸟放在 w.knives 里（kind 'wuhuo'），由 updateKnives 推进。
 */
function launchBirds(w: World, p: Player, wpn: OwnedWeapon, a0: number, dmg: number, ev: SimEvent[]) {
  const B = TUNE.wuhuo.bird;
  const near = enemiesWithin(w, p.x, p.y, B.seek).sort((a, b) => dist2(a, p) - dist2(b, p));
  const first = (e: Enemy) => e.kind === 'boss' || e.kind === 'caster'; // 首领、术士先扑（多出来的火鸟也扑第一只）
  const targets = [...near.filter(first), ...near.filter((e) => !first(e))].slice(0, B.n);
  if (!targets.length) return;
  for (let i = 0; i < B.n; i++) {
    const t = targets[i] ?? targets[0];
    const a = a0 + (i - (B.n - 1) / 2) * 0.22; // 先顺着扇面散开飞出，再拐向各自的目标
    w.knives.push({ id: w.nextId++, owner: p.id, x: p.x, y: p.y - 12, px: p.x, py: p.y - 12, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, target: t.id, hitsLeft: 1, hit: new Set(), dmg: dmg * B.dmg * (i < targets.length ? 1 : B.extra), life: B.life, tier: wpn.tier, kind: 'wuhuo' });
  }
  ev.push({ t: 'throw', owner: p.id, x: p.x, y: p.y - 12, kind: 'wuhuo', tier: wpn.tier });
}

const FIRE: Record<WeaponKind, Fire> = {
  // 乾坤圈：主圈收回后才能再出手；器灵「金环分光」一次两枚
  qiankun(w, p, wpn, ev) {
    if (p.ringOut) return false;
    const Q = TUNE.qiankun;
    // 凡 / 灵：朝最近的敌人掷；仙品起要悬停绞杀：朝身边 denseHover 以内敌人最密的地方掷，首领在索敌半径里就朝首领
    buildGrid(w.enemies);
    const D = Q.denseHover;
    const dense = wpn.tier >= 3 && D > 0 ? densest(w, p, Q.seek, 1, [], 0, (e) => (e.kind === 'boss' ? BOSS_WEIGHT : dist2(e, p) <= D * D ? 1 : 0))[0] : undefined;
    const t = (dense && (dense.kind === 'boss' || dist2(dense, p) <= D * D) ? dense : null) ?? nearestEnemy(w, p.x, p.y, Q.seek);
    if (!t) return false;
    p.facing = t.x >= p.x ? 1 : -1;
    const reach = Math.hypot(t.x - (p.x + p.facing * 6), t.y - 8 - (p.y - 10));
    if (wpn.spirit === 'split') {
      // 两枚圈各绞一处：一枚飞向最近的敌人，另一枚飞向离它远一点的下一只（身边只有它一只，就两枚一左一右都绞它）
      const t2 = nearestEnemy(w, p.x, p.y, TUNE.qiankun.seek, undefined, (e) => e !== t && dist2(e, t) >= TUNE.qiankun.splitGap ** 2);
      if (t2) {
        throwRing(w, p, wpn, t.x, t.y - 8, true, ev, undefined, reach);
        throwRing(w, p, wpn, t2.x, t2.y - 8, true, ev, undefined, Math.hypot(t2.x - (p.x + p.facing * 6), t2.y - 8 - (p.y - 10)));
      } else {
        // 身边只有这一只：一枚绞它，另一枚斜着飞出去、在旁边绞一片（不和第一枚叠在一起绞同一只）
        const a = Math.atan2(t.y - 8 - (p.y - 10), t.x - p.x);
        throwRing(w, p, wpn, t.x, t.y - 8, true, ev, undefined, reach);
        throwRing(w, p, wpn, p.x + Math.cos(a + Q.split) * 100, p.y - 10 + Math.sin(a + Q.split) * 100, true, ev);
      }
    } else throwRing(w, p, wpn, t.x, t.y - 8, true, ev, undefined, reach);
    return true;
  },
  // 火尖枪：朝能一枪串起最多敌人的方向直线突刺，贯穿灼烧；灵品起两连刺（第二枪在 updateWeapons 里补上）
  huojian(w, p, wpn, ev) {
    const H = TUNE.huojian;
    const a = aimSpear(w, p, wpn);
    if (a === null) return false;
    thrust(w, p, wpn, a, ev);
    const extra = H.thrusts[wpn.tier] - 1;
    if (extra > 0) {
      wpn.burst = extra;
      wpn.burstT = H.gap;
      wpn.aim = a;
    }
    return true;
  },
  // 九龙神火罩：周身火罩；仙品起火罩笼罩片刻（跟着人走）；器灵「焚天」范围更大、「九龙吐焰」再喷九道火龙
  jiulong(w, p, wpn, ev) {
    const J = TUNE.jiulong;
    const r = reachLen(p, J.r[wpn.tier] * (wpn.spirit === 'wide' ? J.wide : 1), SEEK);
    buildGrid(w.enemies);
    const hits = enemiesWithin(w, p.x, p.y - 6, r);
    if (!hits.length) return false;
    // 首领战：首领在索敌半径里、还没进火罩时，等它进来再放（身边已经围上来 waitCrowd 只兵就不等了）
    if (!hits.some((e) => e.kind === 'boss') && hits.length < J.waitCrowd && w.enemies.some((e) => e.kind === 'boss' && e.hp > 0 && e.invuln <= 0 && dist2(e, p) <= SEEK * SEEK)) return false;
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    ev.push({ t: 'aura', owner: p.id, x: p.x, y: p.y - 6, r, kind: 'jiulong', tier: wpn.tier });
    for (const e of hits) {
      const k = J.core - (J.core - J.edge) * Math.min(1, Math.hypot(e.x - p.x, e.y - p.y + 6) / r);
      hitEnemy(w, e, { dmg: dmg * k, by: 'aura', owner: p.id, from: p, kb: 90, el: 'fire', burn: dmg * k * J.burn, burnT: J.burnT }, ev);
    }
    if (wpn.tier >= 3) addZone(w, { owner: p.id, kind: 'fireDome', x: p.x, y: p.y, x2: p.x, y2: p.y, r, life: J.dome.life, dmg: dmg * J.dome.dmg, tier: wpn.tier });
    if (wpn.spirit === 'nine') {
      // 九道火龙从火罩边上往外喷（最远 REACH.max）；每只敌人一次最多被一道火龙烧到
      const seen = new Set<number>();
      const far = Math.min(REACH.max - 6, r * J.dragonLen);
      for (let k = 0; k < J.dragons; k++) {
        const a = (k / J.dragons) * Math.PI * 2;
        const x0 = p.x + Math.cos(a) * r * J.dragonFrom;
        const y0 = p.y - 6 + Math.sin(a) * r * J.dragonFrom;
        const x1 = p.x + Math.cos(a) * far;
        const y1 = p.y - 6 + Math.sin(a) * far;
        ev.push({ t: 'thrust', owner: p.id, x0, y0, x1, y1, kind: 'jiulong', tier: wpn.tier });
        for (const e of enemiesWithin(w, (x0 + x1) / 2, (y0 + y1) / 2, r))
          if (!seen.has(e.id) && segDist(e.x, e.y - 6, x0, y0, x1, y1) < 8) {
            seen.add(e.id);
            hitEnemy(w, e, { dmg: dmg * J.dragonDmg, by: 'aura', owner: p.id, from: p, el: 'fire', burn: dmg * 0.2, burnT: J.burnT }, ev);
          }
      }
    }
    return true;
  },
  // 雷公鞭：落雷后在敌人之间连跳（只跳到离人物 REACH.max 以内的）；木行一件 +1 跳；仙品起被打中的留下雷印，片刻后再落一道雷
  leigong(w, p, wpn, ev) {
    const L = TUNE.leigong;
    const first = nearestEnemy(w, p.x, p.y, L.seek);
    if (!first) return false;
    const ec = elementCounts(p);
    const n = Math.round((L.strikes[wpn.tier] + (ec.wood >= 1 ? 1 : 0)) * (wpn.spirit === 'storm' ? L.storm : 1));
    const falloff = wpn.spirit === 'storm' ? 1 : L.falloff;
    const chains = wpn.spirit === 'twin' ? 2 : 1;
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    const keep = inReach(p);
    buildGrid(w.enemies);
    const used = new Set<number>();
    for (let s = 0; s < chains; s++) {
      // 第二道雷先找没挨过的；身边只有一只时就落在同一只身上
      let cur: Enemy | null = s === 0 ? first : (nearestEnemy(w, p.x, p.y, L.seek, used) ?? (first.hp > 0 ? first : null));
      if (!cur) break;
      const pts: [number, number][] = [[p.x, p.y - 26]];
      let d = dmg * L.first;
      const hops = s === 0 ? n : Math.ceil(n * L.twin); // 器灵「雌雄双鞭」：第二道雷是雌鞭，跳得短一些
      for (let j = 0; j < hops && cur; j++) {
        used.add(cur.id);
        pts.push([cur.x, cur.y - 8]);
        hitEnemy(w, cur, { dmg: d, by: 'chain', owner: p.id, from: cur, el: 'wood', stun: L.stun }, ev);
        if (wpn.tier >= 3) thunderMark(w, p, wpn, cur, d, ev);
        d = j === 0 ? dmg : d * falloff;
        cur = nearestEnemy(w, cur.x, cur.y, L.hop * area(p), used, keep);
      }
      ev.push({ t: 'chain', owner: p.id, pts, kind: 'leigong', tier: wpn.tier });
    }
    return true;
  },
  // 番天印：砸在敌人最密的地方，先预警再落下；仙品起落地处龟裂；器灵「三山压顶」一次三方、「地裂震波」再震一圈
  fantian(w, p, wpn, ev) {
    const F = TUNE.fantian;
    buildGrid(w.enemies);
    const n = wpn.spirit === 'triple' ? 3 : 1;
    const targets = densest(w, p, F.seek, n, [], 0, F.bossFirst ? bossFirst : undefined);
    if (!targets.length) return false;
    const r = F.r[wpn.tier] * aoe(p);
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    targets.forEach((t, i) => {
      // 三山压顶：主印砸最密处，另外两方小一些、轻一些，前后错开落下
      const side = i > 0;
      const rr = side ? r * 0.8 : r;
      const id = w.nextId++;
      const t2 = F.warn + i * 0.18;
      w.pending.push({ id, owner: p.id, kind: 'slam', x: t.x, y: t.y, r: rr, t: t2, dmg: dmg * (side ? F.side : 1), tier: wpn.tier });
      ev.push({ t: 'warn', id, kind: 'slam', x: t.x, y: t.y, r: rr, t2, tier: wpn.tier });
    });
    return true;
  },
  // 杏黄旗：没有护盾时套一层（仙品起挡两次）；护盾破碎在 core.hurtPlayer / shieldBreak 里结算；金莲减速在 updateWeapons 里
  xinghuang(_w, p, wpn, ev) {
    if (p.shield > 0) return false;
    p.shield = XINGHUANG.shields[wpn.tier] + (wpn.spirit === 'lotus' ? 2 : 0);
    ev.push({ t: 'shieldUp', owner: p.id, tier: wpn.tier, kind: 'xinghuang' });
    return true;
  },
  // 斩仙飞刀：放出追踪飞刀，在敌群里来回穿刺；仙品起命中留下流血。出手发 throw（kind 'zhanxian'）
  zhanxian(w, p, wpn, ev) {
    const Z = TUNE.zhanxian;
    const t = nearestEnemy(w, p.x, p.y, Z.seek);
    if (!t) return false;
    const n = wpn.spirit === 'many' ? Z.many : 1;
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(t.y - p.y, t.x - p.x) + (i - (n - 1) / 2) * Z.spread;
      const side = n > 1 && i !== (n - 1) / 2;
      w.knives.push({
        id: w.nextId++,
        owner: p.id,
        x: p.x,
        y: p.y - 14,
        px: p.x,
        py: p.y - 14,
        vx: Math.cos(a) * Z.launch,
        vy: Math.sin(a) * Z.launch,
        target: t.id,
        hitsLeft: side ? Z.side.hits : Z.hits[wpn.tier],
        hit: new Set(),
        dmg: side ? dmg * Z.side.dmg : dmg,
        life: Z.life,
        tier: wpn.tier,
        turn: 0,
      });
    }
    ev.push({ t: 'throw', owner: p.id, x: p.x, y: p.y - 14, kind: 'zhanxian', tier: wpn.tier });
    return true;
  },
  // 寒冰幡：在附近几只敌人脚下刺出冰棱，预警后冻住
  hanbing(w, p, wpn, ev) {
    const B = TUNE.hanbing;
    buildGrid(w.enemies);
    const near = enemiesWithin(w, p.x, p.y, B.seek);
    if (!near.length) return false;
    const n = B.spikes[wpn.tier] * (wpn.spirit === 'field' ? 2 : 1);
    const r = B.r * (1 + p.stats.area * 0.5);
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    // 先给不同的敌人各一根；还有多的，再给它们各补一根（同一只一次最多两根）；再多的就散落在敌群附近
    const pool = [...near];
    const second: Enemy[] = [];
    for (let i = 0; i < n; i++) {
      let x: number;
      let y: number;
      if (pool.length) {
        const e = pool.splice(Math.floor(w.rng.next() * pool.length), 1)[0];
        second.push(e);
        x = e.x + range(w.rng, -3, 3);
        y = e.y + range(w.rng, -2, 2);
      } else if (second.length) {
        const e = second.splice(Math.floor(w.rng.next() * second.length), 1)[0];
        const a = w.rng.next() * Math.PI * 2;
        const d = range(w.rng, 5, 11);
        x = e.x + Math.cos(a) * d;
        y = e.y + Math.sin(a) * d * 0.7;
      } else {
        const e = near[Math.floor(w.rng.next() * near.length)];
        const a = w.rng.next() * Math.PI * 2;
        const d = range(w.rng, 24, 48);
        [x, y] = clampToReach(p, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.7); // 散落在敌群附近，但不散出索敌半径
      }
      const id = w.nextId++;
      w.pending.push({ id, owner: p.id, kind: 'spike', x, y, r, t: B.warn, dmg, tier: wpn.tier });
      ev.push({ t: 'warn', id, kind: 'spike', x, y, r, t2: B.warn, tier: wpn.tier });
    }
    return true;
  },

  // ---------------- 剩下 8 件公共法宝 ----------------

  // 打神鞭：从天抽下一鞭，打附近血最厚的（先预警、跟着目标走，落下时在 landLash 里结算）；灵品起一次两只；器灵「九节」同一目标连抽三鞭
  dashen(w, p, wpn, ev) {
    const D = TUNE.dashen;
    buildGrid(w.enemies);
    const n = D.lashes[wpn.tier];
    const targets = thickest(w, p, D.seek, n);
    if (!targets.length) return false;
    const solo = targets.length; // 身边只有这么几只：多出来的鞭子也抽它们，但轻一些
    while (targets.length < n) targets.push(targets[targets.length % solo]);
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    const reps = wpn.spirit === 'nine' ? D.nine.n : 1;
    const ring = wpn.tier >= 3 ? D.ring.r * aoe(p) : 0;
    targets.forEach((t, i) => {
      for (let k = 0; k < reps; k++) {
        const id = w.nextId++;
        const t2 = D.delay + i * D.gap + k * D.nine.gap;
        w.pending.push({ id, owner: p.id, kind: 'lash', x: t.x, y: t.y, r: D.w, t: t2, dmg: i < solo ? dmg : dmg * D.extra, target: t.id, tier: wpn.tier, len: D.len * aoe(p), ring, seq: k + 1, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
        ev.push({ t: 'warn', id, kind: 'lash', x: t.x, y: t.y, r: D.w, t2, tier: wpn.tier });
      }
    });
    p.facing = targets[0].x >= p.x ? 1 : -1;
    return true;
  },
  // 化血神刀：身前斩出一道月牙血光（扇面），留下流血（灵品起一斩两层）；仙品「化血」的血雾在 core.onKill 里
  huaxue(w, p, wpn, ev) {
    const H = TUNE.huaxue;
    const sea = wpn.spirit === 'sea';
    const r = reachLen(p, H.reach[wpn.tier] * (sea ? H.sea.r : 1), SEEK);
    const arc = sea ? H.sea.arc : H.arc[wpn.tier];
    const x0 = p.x;
    const y0 = p.y - 8;
    buildGrid(w.enemies);
    const near = enemiesWithin(w, x0, y0, r + 16).sort((a, b) => dist2(a, p) - dist2(b, p));
    if (!near.length) return false;
    const a = aimSector(near, x0, y0, r, arc);
    const hits = near.filter((e) => inSector(x0, y0, a, arc, r, e.x, e.y - 6, ENEMIES[e.kind].radius));
    if (!hits.length) return false;
    p.facing = Math.cos(a) >= 0 ? 1 : -1;
    ev.push({ t: 'slash', owner: p.id, x: x0, y: y0, a, r, arc, kind: 'huaxue', tier: wpn.tier });
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    const per = dmg * HUAXUE.bleed[wpn.tier];
    for (const e of hits) {
      // 先斩、再叠流血：一斩斩死的不算「带着流血死掉」（不化血雾）
      hitEnemy(w, e, { dmg, by: 'slash', owner: p.id, from: p, kb: H.kb, el: 'metal' }, ev);
      if (e.hp > 0) for (let k = 0; k < HUAXUE.stacks[wpn.tier]; k++) addBleed(e, p.id, per, HUAXUE.bleedT, HUAXUE.cap[wpn.tier]);
    }
    return true;
  },
  // 定风珠：在敌人最密处（尽量离人物远一点）起一道旋风；卷、追敌群、落雷、吹散 / 定海都在 zones.ts
  dingfeng(w, p, wpn, ev) {
    const D = TUNE.dingfeng;
    buildGrid(w.enemies);
    const t = densest(w, p, D.seek, 1, [], D.minD, bossFirst)[0]; // 首领卷不动，但风刃照样吹它（风眼 ×2.5）
    if (!t) return false;
    const r = D.r[wpn.tier] * aoe(p);
    openZone(w, p, wpn, { kind: 'whirl', x: t.x, y: t.y, x2: t.x, y2: t.y, px: t.x, py: t.y, r, life: D.life[wpn.tier], dmg: weaponDamage(p, wpn, p.buffs.rage), pull: D.pull[wpn.tier] }, ev);
    return true;
  },
  // 青莲宝色旗：脚下展开青莲结界（同一时间只有一片）；回血、荆棘、跟着走在 zones.ts，「莲台」的闪避在 core.hurtPlayer
  qinglian(w, p, wpn, ev) {
    const Q = TUNE.qinglian;
    if (w.zones.some((z) => z.owner === p.id && z.kind === 'lotus' && z.t < z.life - 0.3)) return false;
    buildGrid(w.enemies);
    if (p.hp >= p.stats.maxHp && !enemiesWithin(w, p.x, p.y, Q.near).length) return false; // 满血又没敌人：先不展开
    const dais = wpn.spirit === 'dais';
    const dmg = weaponDamage(p, wpn, p.buffs.rage) * Q.thorn * (wpn.spirit === 'thorn' ? Q.thornMul : 1);
    openZone(w, p, wpn, { kind: 'lotus', x: p.x, y: p.y, x2: p.x, y2: p.y, px: p.x, py: p.y, r: reachLen(p, Q.r[wpn.tier], SEEK), life: Q.life[wpn.tier], dmg, heal: Q.heal[wpn.tier] * (dais ? Q.dais.heal : 1), ...(dais ? { dodge: Q.dais.dodge } : {}) }, ev);
    return true;
  },
  // 阴阳镜：朝敌人最密的方向扫出一道光束；仙品「阴阳」一阴一阳两道反向扫；器灵「乾坤」各扫整整一圈。扫的过程在 zones.ts
  yinyang(w, p, wpn, ev) {
    const Y = TUNE.yinyang;
    const x0 = p.x;
    const y0 = p.y - 8;
    buildGrid(w.enemies);
    // 首领战：首领在索敌半径里，光束就照到首领那么远（最远 far）；不然首领常站在光束的尽头之外
    const boss = enemiesWithin(w, x0, y0, SEEK).find((e) => e.kind === 'boss');
    const len = Math.max(reachLen(p, Y.len[wpn.tier], Y.far), boss ? Math.min(Y.far, Math.hypot(boss.x - x0, boss.y - 6 - y0) + ENEMIES.boss.radius) : 0);
    const near = enemiesWithin(w, x0, y0, Math.min(len + 4, SEEK)).sort((a, b) => dist2(a, p) - dist2(b, p)); // 光束最长 far，但只朝索敌半径里的敌人扫
    if (!near.length) return false;
    const cosmos = wpn.spirit === 'cosmos';
    const sweep = cosmos ? Math.PI * 2 : Y.sweep[wpn.tier];
    const half = sweep / 2;
    const a0 = aimSector(near, x0, y0, len, half, 8);
    const dir = w.rng.next() < 0.5 ? 1 : -1; // 这一扫顺着转还是逆着转
    const dur = cosmos ? Y.cosmos : Y.dur[wpn.tier];
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    const beam = (from: number, to: number, yin: boolean) =>
      openZone(w, p, wpn, { kind: 'beam', x: x0, y: y0, x2: x0, y2: y0, px: x0, py: y0, r: Y.w, len, life: dur, dmg, a: from, pa: from, from, to, yin, hit: [] }, ev);
    // 乾坤：两道从最密的方向出发、各朝一边扫整整一圈；不然从扇面的一边扫到另一边（阴阳两道方向相反、在中间交错）
    const yin = cosmos ? beam(a0, a0 + dir * Math.PI * 2, true) : beam(a0 - dir * half, a0 + dir * half, true);
    if (wpn.tier >= 3) {
      const yang = cosmos ? beam(a0, a0 - dir * Math.PI * 2, false) : beam(a0 + dir * half, a0 - dir * half, false);
      yin.twin = yang.id;
      yang.twin = yin.id;
    }
    p.facing = Math.cos(a0) >= 0 ? 1 : -1;
    return true;
  },
  // 玄元控水旗：在敌人最密处展开一片水域（器灵「水淹」两片）；减速、受伤、漩涡、寒潭在 zones.ts
  xuanyuan(w, p, wpn, ev) {
    const X = TUNE.xuanyuan;
    buildGrid(w.enemies);
    const n = wpn.spirit === 'flood' ? 2 : 1;
    const targets = densest(w, p, X.seek, n, [], 0, (e) => (e.kind === 'caster' ? X.caster : bossFirst(e)));
    if (!targets.length) return false;
    while (targets.length < n) targets.push(targets[0]); // 水淹：只有一群的话两片都淹在它身上（水柱各涌一次）
    const r = X.r[wpn.tier] * aoe(p);
    const dmg = weaponDamage(p, wpn, p.buffs.rage) * X.dmg[wpn.tier];
    buildGrid(w.enemies);
    const base = weaponDamage(p, wpn, p.buffs.rage);
    for (const t of targets) {
      openZone(w, p, wpn, { kind: 'water', x: t.x, y: t.y, x2: t.x, y2: t.y, r, life: X.life[wpn.tier], dmg, ...(wpn.tier >= 3 ? { pull: X.pull } : {}) }, ev);
      // 水柱：先打中心的那只（和它贴着的）
      for (const e of enemiesWithin(w, t.x, t.y, X.pillar.r * aoe(p) + 4)) hitEnemy(w, e, { dmg: base * X.pillar.mul, by: 'tide', owner: p.id, from: t, el: 'water' }, ev);
    }
    return true;
  },
  // 五火七禽扇：朝最近的敌人扇出扇形火浪（推进在 zones.ts）；仙品「七禽」再放七只火鸟；器灵「五火」一圈五道、「焚风」推远一倍并留下焦土
  wuhuo(w, p, wpn, ev) {
    const F = TUNE.wuhuo;
    const x0 = p.x;
    const y0 = p.y - 6;
    const five = wpn.spirit === 'five';
    const base = reachLen(p, F.reach[wpn.tier] * (wpn.spirit === 'gale' ? F.gale : 1), F.far);
    const arc = five ? F.five.arc : F.arc[wpn.tier];
    buildGrid(w.enemies);
    const near = enemiesWithin(w, x0, y0, reachLen(p, F.aim, SEEK)).sort((a, b) => dist2(a, p) - dist2(b, p));
    // 首领战：首领总站在火浪推不到的地方（机器人离它 95 像素上下）。首领在索敌半径里，这一扇就推到首领身上为止（最远 far）
    const boss = enemiesWithin(w, x0, y0, SEEK).find((e) => e.kind === 'boss');
    if (boss && !near.includes(boss)) near.push(boss);
    if (!near.length) return false;
    const bossLen = boss ? Math.min(F.far, Math.hypot(boss.x - x0, boss.y - 6 - y0) + ENEMIES.boss.radius) : 0;
    const a0 = aimSector(near, x0, y0, Math.max(base, bossLen), arc);
    const len = boss && bossLen > base && inSector(x0, y0, a0, arc, bossLen, boss.x, boss.y - 6, ENEMIES.boss.radius) ? bossLen : base;
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    const waves = five ? F.five.n : 1;
    const hit: number[] = []; // 五火：一圈五道共用一份「打过谁」，贴身的敌人也只挨一道
    for (let k = 0; k < waves; k++) {
      const a = a0 + (k / waves) * Math.PI * 2;
      openZone(w, p, wpn, { kind: 'flameWave', x: x0, y: y0, x2: x0, y2: y0, r: 0, len, life: len / ZONE_FX.flameWave.speed + ZONE_FX.flameWave.fade, dmg, a, arc, hit }, ev);
    }
    if (wpn.tier >= 3) launchBirds(w, p, wpn, a0, dmg, ev);
    p.facing = Math.cos(a0) >= 0 ? 1 : -1;
    return true;
  },
  // 捆仙绳：金绳射向最近的敌人，把一串捆在一起：定身 + 易伤（先捆没被捆住的）。精英与首领捆不住 —— 金绳照样抽它一下、
  // 让它易伤，但不定身、不算进捆住的（Zone.ids）里；器灵「困龙」精英也捆、首领改为大幅减速；器灵「连环」一次 8 只。缚仙的拽、撞在 zones.ts
  kunxian(w, p, wpn, ev) {
    const K = TUNE.kunxian;
    const dragon = wpn.spirit === 'dragon';
    buildGrid(w.enemies);
    // 点着了引信的爆符鬼（无敌、不吃控制）也捆不住
    const holds = (e: Enemy) => e.invuln <= 0 && ((e.kind !== 'elite' && e.kind !== 'boss') || (dragon && e.kind === 'elite'));
    const skip = new Set<number>();
    const bound = new Set<number>(w.enemies.filter((e) => e.stun > 0.2).map((e) => e.id)); // 已经被定住的先不捆
    const keep = inReach(p); // 金绳只捆离人物 REACH.max 以内的
    const pickNear = (x: number, y: number, r: number) =>
      nearestEnemy(w, x, y, r, new Set([...skip, ...bound]), keep) ?? nearestEnemy(w, x, y, r, skip, keep);
    const first = pickNear(p.x, p.y, K.seek);
    if (!first) return false;
    // 一串捆 n 只：途中抽到的精英 / 首领不占名额（绳子从它身上过去，接着捆下一只），整串最多再多两只
    const n = wpn.spirit === 'chain' ? K.chain : K.n[wpn.tier];
    const chain: Enemy[] = [first];
    skip.add(first.id);
    const count = () => chain.filter((e) => holds(e) || (dragon && e.kind === 'boss')).length;
    while (count() < n && chain.length < n + 2) {
      const last = chain[chain.length - 1];
      const next = pickNear(last.x, last.y, K.hop * area(p));
      if (!next) break;
      chain.push(next);
      skip.add(next.id);
    }
    const dur = K.dur[wpn.tier] * (1 + p.stats.area * 0.5);
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    const vuln = K.vuln[wpn.tier];
    let cx = 0;
    let cy = 0;
    const held: Enemy[] = [];
    for (const e of chain) {
      const hold = holds(e);
      hitEnemy(w, e, { dmg, by: 'rope', owner: p.id, from: p, el: 'earth', stun: hold ? dur : 0 }, ev);
      if (e.hp <= 0) continue;
      e.vuln = Math.max(e.vuln, vuln);
      e.vulnT = Math.max(e.vulnT, dur);
      if (e.kind === 'boss' && dragon) slowEnemy(w, e, p.id, K.bossSlow, dur); // 困龙：首领不吃定身，改成大幅减速
      if (hold || (e.kind === 'boss' && dragon)) held.push(e);
    }
    for (const e of held) {
      cx += e.x / held.length;
      cy += e.y / held.length;
    }
    if (held.length)
      openZone(w, p, wpn, { kind: 'rope', x: cx, y: cy, x2: cx, y2: cy, px: cx, py: cy, r: 0, life: dur, dmg: dmg * K.clash, ids: held.map((e) => e.id), hit: [], ...(wpn.tier >= 3 ? { pull: K.pull } : {}) }, ev);
    p.facing = first.x >= p.x ? 1 : -1;
    return true;
  },
  // ---- 别的角色的专属法宝（出手写在角色自己的模块里）----
  sanjian: fireSanjian, // 杨戬 · 三尖两刃刀：横扫接刺击，仙品起再劈山（sim/heroes/yangjian.ts）
  dinghai: fireDinghai, // 赵公明 · 定海珠：珠子飞出去砸进敌群，仙品起石纹再震（sim/heroes/zhao.ts；落地在 land 里交给 landBead）
  jindou: fireDou, // 云霄 · 混元金斗：吸进斗里再喷出来（一斗的后续在 sim/heroes/yunxiao.ts 里每帧推进）
  huangjin: fireStaff, // 雷震子 · 黄金棍：飞出去掠过敌群、砸下劈雷（sim/heroes/leizhenzi.ts；落下在 land 里交给 landStaff）
  heiyan: fireHeiyan, // 魔化哪吒 · 黑焰轮：几只轮子朝四面滚出去碾过一路，仙品起滚回来（sim/heroes/mozha.ts；每帧的推进在 updateWheels）
  fulong: fireFulong, // 回响赵公明 · 缚龙索：缠住一串往一处拽到一起（sim/heroes/huizhao.ts；每帧的推进在 updateRopes）
  qiankuntu: fireQiankuntu, // 回响云霄 · 乾坤图：铺开一卷裹住一串，仙品起山影压下（sim/heroes/huiyun.ts；每帧的推进在 updateScrolls）
  youlong: fireYoulong, // 回响敖丙 · 游龙戟：一条冰龙在敌群里一只接一只咬过去（sim/heroes/huiao.ts；每帧的推进在 updateLoongs）
  jingu: fireJingu, // 孙悟空 · 如意金箍棒：横扫一圈接竖劈，仙品起石刺（sim/heroes/wukong.ts；石刺扎出来在 land 里交给 landRock）

  // ---------------- 再加的 11 件公共法宝：出手在 sim/arti2.ts ----------------
  xiangmo: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  wuguang: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  zanxin: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  jinjiao: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  yanguang: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  wanya: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  sihai: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  wulu: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  miaoshu: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  wenhuang: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
  luobao: (w, p, wpn, ev) => fire2(w, p, wpn, ev),
};

/**
 * 火尖枪瞄准：够得着的最近几只敌人里，挑一个方向，让这一枪串起最多的敌人（一样多就挑近的）。
 * 返回角度；够不着任何敌人返回 null。
 */
function aimSpear(w: World, p: Player, wpn: OwnedWeapon): number | null {
  const H = TUNE.huojian;
  const reach = reachLen(p, H.reach[wpn.tier], SEEK);
  const len = reachLen(p, H.len[wpn.tier] * (wpn.spirit === 'pierce' ? H.sun.len : 1), H.far);
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, reach).sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return null;
  const x0 = p.x + (near[0].x >= p.x ? 4 : -4);
  const y0 = p.y - 10;
  const inLine = enemiesWithin(w, p.x, p.y, len + 12);
  let best = near[0];
  let bestN = -1;
  for (const c of near.slice(0, 6)) {
    const a = Math.atan2(c.y - 6 - y0, c.x - x0);
    const x1 = x0 + Math.cos(a) * len;
    const y1 = y0 + Math.sin(a) * len;
    let n = 0;
    for (const e of inLine) if (segDist(e.x, e.y - 6, x0, y0, x1, y1) < H.width) n++;
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  p.facing = best.x >= p.x ? 1 : -1;
  return Math.atan2(best.y - 6 - (p.y - 10), best.x - (p.x + p.facing * 4));
}

/** 连击的后续（火尖枪的第二枪；三尖两刃刀横扫之后的刺击、劈山）：重新瞄准，没有够得着的就沿上一枪的方向。 */
function followUp(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]) {
  if (wpn.kind === 'sanjian') return sanjianStep(w, p, wpn, ev); // 下一步隔多久由它自己定（改 burstT）
  if (wpn.kind === 'jingu') return jinguStep(w, p, wpn, ev); // 金箍棒：搅海的后几圈、竖劈（同上）
  if (wpn.kind !== 'huojian') return followUp2(w, p, wpn, ev); // 再加的 11 件（五光石「连珠」）：sim/arti2.ts
  thrust(w, p, wpn, aimSpear(w, p, wpn) ?? wpn.aim ?? 0, ev, TUNE.huojian.second);
}

/** 攻速加成最多把冷却缩到原来的 60%（用户：冷却不能太短）。攻速只缩冷却，不改任何距离。 */
export const MIN_CD_RATIO = 0.6;

/**
 * 每波开始（world.startWave 调）：清掉上一波没打完的连击（火尖枪的第二枪）和没报完的回血。
 * 不清的话，波末刚刺出第一枪，下一波一开场就对着空地补上第二枪（仙品还在地上留一道火痕）。
 */
export function resetWeapons(p: Player) {
  for (const wpn of p.weapons) {
    delete wpn.burst;
    delete wpn.burstT;
    delete wpn.aim;
    delete wpn.heal;
    delete wpn.healT;
  }
}

/** 推进一个玩家的全部法宝。 */
export function updateWeapons(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const haste = Math.min(1 + p.stats.haste + heroHaste(w, p), 1 / MIN_CD_RATIO); // 回响云霄「截教」：身边定住的越多出手越快（heroes/passives.ts；别的角色加 0）
  for (const wpn of p.weapons) {
    if (wpn.burst && wpn.burst > 0) {
      wpn.burstT = (wpn.burstT ?? 0) - dt;
      if (wpn.burstT <= 0) {
        wpn.burst--;
        wpn.burstT = TUNE.huojian.gap;
        followUp(w, p, wpn, ev);
      }
    }
    wpn.cd -= dt * haste;
    if (wpn.cd > 0) continue;
    if (FIRE[wpn.kind](w, p, wpn, ev)) wpn.cd = WEAPONS[wpn.kind].cd;
    else wpn.cd = 0.1; // 没目标：过一会儿再看
  }
  if (p.dou) updateDou(w, p, ev); // 混元金斗：这一斗到点吸、喷、落地（sim/heroes/yunxiao.ts）
  // 杏黄旗仙品起：有盾时脚下金莲，让靠近的敌人减速
  const xh = p.weapons.find((x) => x.kind === 'xinghuang');
  if (xh && xh.tier >= 3 && p.shield > 0) {
    const R = XINGHUANG.lotusR * (1 + p.stats.area * 0.5);
    p.lotus = R;
    buildGrid(w.enemies);
    for (const e of enemiesWithin(w, p.x, p.y, R)) slowEnemy(w, e, p.id, XINGHUANG.lotusSlow, 0.3);
  } else if (p.lotus) p.lotus = 0;
  // 化血神刀器灵「噬魂」：身上流着血的敌人每跳一次，人物回一点气血
  const hx = p.weapons.find((x) => x.kind === 'huaxue' && x.spirit === 'soul');
  if (hx) soulDrain(w, p, hx, dt, ev);
  if (p.wheels) updateWheels(w, p, dt, ev); // 魔化哪吒 · 黑焰轮：滚出去的轮子（heroes/mozha.ts）
  if (p.ropes) updateRopes(w, p, dt, ev); // 回响赵公明 · 缚龙索：正在拽的索（heroes/huizhao.ts）
  if (p.scrolls) updateScrolls(w, p, dt, ev); // 回响云霄 · 乾坤图：铺开着的图（heroes/huiyun.ts）
  if (p.loongs) updateLoongs(w, p, dt, ev); // 回响敖丙 · 游龙戟：在敌群里游的冰龙（heroes/huiao.ts）
}

/** 噬魂：每只身上流着自己割的血的敌人，每秒给人物回 per 点（流血每 0.5 秒一跳），每秒最多 cap；每 0.5 秒报一次 heal。 */
function soulDrain(w: World, p: Player, wpn: OwnedWeapon, dt: number, ev: SimEvent[]) {
  const S = TUNE.huaxue.soul;
  let n = 0;
  for (const e of w.enemies) if (e.hp > 0 && e.bleedT > 0 && e.bleedBy === p.id) n++;
  const h = Math.min(p.stats.maxHp - p.hp, Math.min(S.cap, n * S.per) * dt);
  if (h > 0) {
    p.hp += h;
    wpn.heal = (wpn.heal ?? 0) + h;
  }
  wpn.healT = (wpn.healT ?? 0.5) - dt;
  if (wpn.healT <= 0) {
    wpn.healT += 0.5;
    if ((wpn.heal ?? 0) >= 0.05) ev.push({ t: 'heal', owner: p.id, x: p.x, y: p.y, amount: wpn.heal!, kind: 'huaxue', tier: wpn.tier });
    wpn.heal = 0;
  }
}

/** 圈心离人物胸口超过 leash：人物往反方向走开了，飞出去的圈提前折返，不飞出画面。 */
const leashed = (r: Ring, p: Player | undefined) => !!p && (r.x - p.x) ** 2 + (r.y - (p.y - 10)) ** 2 >= TUNE.qiankun.leash ** 2;
/** 把悬停的圈拉回到离人物胸口 leash 处（人物走开了，圈被拽着走）。 */
function tether(r: Ring, p: Player) {
  const dx = r.x - p.x;
  const dy = r.y - (p.y - 10);
  const k = TUNE.qiankun.leash / (Math.hypot(dx, dy) || 1);
  r.x = p.x + dx * k;
  r.y = p.y - 10 + dy * k;
}

/** 乾坤圈：飞出 → （仙品起）在最远处悬停绞杀 → 折返，往返各打一次。法宝不碰敌人的弹道（用户定）。 */
export function updateRings(w: World, dt: number, ev: SimEvent[]) {
  const Q = TUNE.qiankun;
  buildGrid(w.enemies);
  for (let i = w.rings.length - 1; i >= 0; i--) {
    const r = w.rings[i];
    const p = w.players[r.owner];
    r.life -= dt;
    const burn = r.dmg * Q.burn;
    if (r.hover > 0) {
      // 悬停：原地旋转，每 hoverTick 秒绞杀一次圈里的敌人（同一只可以反复被绞）
      r.hover -= dt;
      r.hoverTick = (r.hoverTick ?? 0) - dt;
      if (r.hoverTick <= 0) {
        r.hoverTick += Q.hoverTick;
        const R = (r.r0 ?? 9) * ringGrowth(r) * Q.hoverGrow;
        for (const e of enemiesWithin(w, r.x, r.y + 8, R + 12)) {
          const rr = R + ENEMIES[e.kind].radius;
          if ((e.x - r.x) ** 2 + (e.y - 8 - r.y) ** 2 > rr * rr) continue;
          const n = (r.grind ??= new Map()).get(e.id) ?? 0;
          if (n >= Q.grindMax) continue;
          r.grind.set(e.id, n + 1);
          hitEnemy(w, e, { dmg: r.dmg * Q.hoverDmg, by: 'ring', owner: r.owner, from: r, el: 'fire', burn, burnT: Q.burnT }, ev); // 绞住不弹开
        }
      }
      if (r.hover <= 0) {
        r.hover = 0;
        turnBack(w, r, ev);
      } else if (p && leashed(r, p)) tether(r, p); // 人物走开了：悬停的圈被拽着跟过来，照样转着绞
      continue;
    }
    if (!r.returning) {
      r.out += Math.hypot(r.vx, r.vy) * dt;
      if (r.out >= r.range || leashed(r, p)) {
        r.out = r.range;
        if (r.canHover) {
          r.canHover = false;
          r.hover = Q.hover;
          r.hoverTick = Q.hoverTick;
          continue;
        }
        turnBack(w, r, ev);
      }
    } else if (p) {
      const dx = p.x - r.x;
      const dy = p.y - 10 - r.y;
      const d = Math.hypot(dx, dy) || 1;
      const a = Math.min(1, dt * 7);
      r.vx += ((dx / d) * Q.back - r.vx) * a;
      r.vy += ((dy / d) * Q.back - r.vy) * a;
      if (d < 9 || r.life <= 0) {
        w.rings.splice(i, 1);
        if (r.primary) p.ringOut = w.rings.some((o) => o.owner === p.id && o.primary);
        continue;
      }
    }
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    const hitR = (r.r0 ?? 9) * ringGrowth(r);
    forNear(w.enemies, r.x, r.y + 8, hitR + 16, (j) => {
      const e = w.enemies[j];
      if (e.hp <= 0 || r.hits.has(e.id)) return;
      const rr = hitR + ENEMIES[e.kind].radius;
      if ((e.x - r.x) ** 2 + (e.y - 8 - r.y) ** 2 > rr * rr) return;
      r.hits.add(e.id);
      hitEnemy(w, e, { dmg: r.dmg, by: 'ring', owner: r.owner, from: r, kb: 110, el: 'fire', burn, burnT: Q.burnT }, ev);
    });
  }
}

/** 乾坤圈开始折返：往回飞时同一只敌人还能再挨一次；器灵「赤焰轮」在这里炸开火环。 */
function turnBack(w: World, r: Ring, ev: SimEvent[]) {
  const Q = TUNE.qiankun;
  r.returning = true;
  r.hits.clear();
  if (!r.fireBurst) return;
  ev.push({ t: 'aura', owner: r.owner, x: r.x, y: r.y, r: Q.flameR, kind: 'qiankun', tier: r.tier });
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, r.x, r.y + 8, Q.flameR))
    hitEnemy(w, e, { dmg: r.dmg * Q.flameDmg, by: 'aura', owner: r.owner, from: r, el: 'fire', burn: r.dmg * 0.3, burnT: 2.5 }, ev);
}

/** 延时效果落地：番天印砸地（仙品起地裂）、寒冰幡冰棱（仙品起寒霜 + 寒气）、雷印落雷、寒气冻结。 */
export function updatePending(w: World, dt: number, ev: SimEvent[]) {
  for (let i = w.pending.length - 1; i >= 0; i--) {
    const q = w.pending[i];
    // 雷印跟着被标记的敌人走；它死了就落在它最后的位置
    if (q.target !== undefined) {
      const t = w.enemies.find((e) => e.id === q.target && e.hp > 0);
      if (t) {
        q.x = t.x;
        q.y = t.y;
      }
    }
    q.t -= dt;
    if (q.t > 0) continue;
    w.pending.splice(i, 1);
    ev.push({ t: 'land', id: q.id, kind: q.kind, x: q.x, y: q.y, r: q.r, tier: q.tier, ...(q.quake ? { quake: true } : {}) });
    buildGrid(w.enemies);
    land(w, q, ev);
  }
}

function land(w: World, q: Pending, ev: SimEvent[]) {
  const p = w.players[q.owner];
  const tier = q.tier ?? 1;
  if (q.kind === 'slam') {
    const F = TUNE.fantian;
    for (const e of enemiesWithin(w, q.x, q.y, q.r + 4)) {
      // 正中压个正着；往外按离落点的距离衰减（震波一圈只按边缘算）
      const d = Math.max(0, Math.hypot(e.x - q.x, e.y - q.y) - ENEMIES[e.kind].radius);
      const k = q.quake ? F.edge : d <= q.r * F.core ? F.coreMul : 1 - (1 - F.edge) * Math.min(1, (d - q.r * F.core) / (q.r * (1 - F.core)));
      hitEnemy(w, e, { dmg: q.dmg * k, by: 'slam', owner: q.owner, from: q, kb: F.kb, el: 'earth', stun: F.stun[tier] }, ev);
    }
    if (q.quake) return;
    // 仙品：落地处地面龟裂，一段时间内减速走过的敌人
    if (tier >= 3) addZone(w, { owner: q.owner, kind: 'crack', x: q.x, y: q.y, x2: q.x, y2: q.y, r: q.r * F.crack.grow, life: F.crack.life, dmg: 0, tier });
    // 器灵「地裂震波」：再震一圈更大的
    if (p?.weapons.some((x) => x.kind === 'fantian' && x.spirit === 'quake'))
      w.pending.push({ id: w.nextId++, owner: q.owner, kind: 'slam', x: q.x, y: q.y, r: q.r * F.quake.grow, t: F.quake.delay, dmg: q.dmg * F.quake.dmg, tier, quake: true });
  } else if (q.kind === 'spike') {
    const B = TUNE.hanbing;
    for (const e of enemiesWithin(w, q.x, q.y, q.r + 4)) hitEnemy(w, e, { dmg: q.dmg, by: 'spike', owner: q.owner, from: q, el: 'water', freeze: B.freeze }, ev);
    // 仙品：冰棱周围结出寒霜（减速），寒气蔓延，片刻后冻住附近的敌人
    if (tier >= 3) {
      addZone(w, { owner: q.owner, kind: 'frost', x: q.x, y: q.y, x2: q.x, y2: q.y, r: B.frost.r, life: B.frost.life, dmg: 0, tier });
      const id = w.nextId++;
      w.pending.push({ id, owner: q.owner, kind: 'frost', x: q.x, y: q.y, r: B.chill.r, t: B.chill.delay, dmg: q.dmg * B.chill.dmg, tier });
      ev.push({ t: 'warn', id, kind: 'frost', x: q.x, y: q.y, r: B.chill.r, t2: B.chill.delay, tier });
    }
  } else if (q.kind === 'frost') {
    const B = TUNE.hanbing;
    for (const e of enemiesWithin(w, q.x, q.y, q.r)) hitEnemy(w, e, { dmg: q.dmg, by: 'spike', owner: q.owner, from: q, el: 'water', freeze: B.chill.freeze }, ev);
  } else if (q.kind === 'thunder') {
    // 雷印：再落一道雷，打被标记的那只和它身边的
    for (const e of enemiesWithin(w, q.x, q.y, q.r)) hitEnemy(w, e, { dmg: q.dmg, by: 'thunder', owner: q.owner, from: q, el: 'wood', stun: 0.2 }, ev);
  } else if (q.kind === 'lash') landLash(w, q, ev);
  else if (q.kind === 'bead') landBead(w, q, ev); // 定海珠落地（sim/heroes/zhao.ts）
  else if (q.kind === 'staff') landStaff(w, q, ev); // 黄金棍掠过、砸下、雷纹再炸（sim/heroes/leizhenzi.ts）
  else if (q.kind === 'rock') landRock(w, q, ev); // 金箍棒「定海」的石刺扎出来（sim/heroes/wukong.ts）
  else land2(w, q, ev); // 再加的 11 件（降魔杵……）：sim/arti2.ts
}

/**
 * 打神鞭落下：抽中目标（对精英、首领的倍率见 TUNE.dashen），鞭痕（过落点、顺着人物到落点的方向）上的也挨一下；
 * 仙品「打神」起抽中的精英被镇住、首领不吃控制改为倍率更高，落点再震出一圈波及周围的小怪；器灵「封神」抽散残血。
 */
function landLash(w: World, q: Pending, ev: SimEvent[]) {
  const D = TUNE.dashen;
  const p = w.players[q.owner];
  const tier = q.tier ?? 1;
  const t = q.target !== undefined ? w.enemies.find((e) => e.id === q.target && e.hp > 0) : undefined;
  const a = p ? Math.atan2(q.y - p.y, q.x - p.x) : 0;
  const len = q.len ?? D.len;
  const dx = (Math.cos(a) * len) / 2;
  const dy = (Math.sin(a) * len) / 2;
  ev.push({ t: 'lash', id: q.id, owner: q.owner, target: q.target ?? -1, x: q.x, y: q.y, a, len, ring: q.ring ?? 0, seq: q.seq ?? 1, kind: 'dashen', tier });
  const execute = q.spirit === 'seal' ? D.seal : undefined;
  const done = new Set<number>();
  const strike = (e: Enemy, dmg: number, kb: number) => {
    done.add(e.id);
    const stun = tier >= 3 && e.kind === 'elite' ? D.stunElite : 0;
    hitEnemy(w, e, { dmg, by: 'lash', owner: q.owner, from: q, kb, el: 'metal', vsElite: e.kind === 'boss' ? D.boss[tier] : D.elite, stun, execute }, ev);
  };
  if (t) strike(t, q.dmg, 0);
  for (const e of enemiesWithin(w, q.x, q.y, len / 2 + 14)) {
    if (done.has(e.id)) continue;
    if (segDist(e.x, e.y - 4, q.x - dx, q.y - dy, q.x + dx, q.y + dy) > q.r + ENEMIES[e.kind].radius * 0.5) continue;
    strike(e, q.dmg * D.body, D.kb);
  }
  if (q.ring)
    for (const e of enemiesWithin(w, q.x, q.y, q.ring)) {
      if (done.has(e.id) || e.kind === 'elite' || e.kind === 'boss') continue;
      strike(e, q.dmg * D.ring.dmg, D.ring.kb);
    }
}

/**
 * 斩仙飞刀：追踪当前目标，命中后换下一只没刺过的；身边没有别的就穿过去、绕回来再刺同一只。仙品起命中留下流血。七禽的火鸟也在这里推进。
 * 射程（config.REACH）：追的、换的目标都在离人物 REACH.max 以内（追的那只走远了就换一只，没有就收刀）；穿过去也不飞出 REACH.max。
 */
export function updateKnives(w: World, dt: number, ev: SimEvent[]) {
  const Z = TUNE.zhanxian;
  for (let i = w.knives.length - 1; i >= 0; i--) {
    const k = w.knives[i];
    if (k.kind === 'wuhuo') {
      if (stepBird(w, k, dt, ev)) w.knives.splice(i, 1);
      continue;
    }
    if (k.kind && k.kind !== 'zhanxian') {
      // 再加的 11 件放出来的飞行物（sim/arti2.ts）
      if (stepKnife2(w, k, dt, ev)) w.knives.splice(i, 1);
      continue;
    }
    k.px = k.x;
    k.py = k.y;
    k.life -= dt;
    if (k.life <= 0 || k.hitsLeft <= 0) {
      w.knives.splice(i, 1);
      continue;
    }
    const keep = inReach(w.players[k.owner]);
    if ((k.turn ?? 0) > 0) {
      // 穿过去：先顺着惯性直飞一小段；飞到离人物 REACH.max（飞刀在胸口高度，量到地面）就提前拐回来
      k.turn = (k.turn ?? 0) - dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      if (!keep({ x: k.x, y: k.y + 12 })) k.turn = 0;
      continue;
    }
    let t = w.enemies.find((e) => e.id === k.target && e.hp > 0 && keep(e)) ?? null;
    if (!t) {
      t = nearestEnemy(w, k.x, k.y, Z.hop, k.hit, keep) ?? (k.again ? nearestEnemy(w, k.x, k.y, Z.hop, k.again, keep) : nearestEnemy(w, k.x, k.y, Z.hop, undefined, keep));
      if (t) k.target = t.id;
    }
    if (!t) {
      w.knives.splice(i, 1);
      continue;
    }
    const dx = t.x - k.x;
    const dy = t.y - 8 - k.y;
    const d = Math.hypot(dx, dy) || 1;
    const a = Math.min(1, dt * Z.steer);
    k.vx += ((dx / d) * Z.speed - k.vx) * a;
    k.vy += ((dy / d) * Z.speed - k.vy) * a;
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    if (d < 9) {
      const p = w.players[k.owner];
      const behead = p?.weapons.some((x) => x.kind === 'zhanxian' && x.spirit === 'behead');
      const bleed = (k.tier ?? 1) >= 3 ? k.dmg * Z.bleed : 0;
      hitEnemy(w, t, { dmg: k.dmg, by: 'knife', owner: k.owner, from: k, kb: 50, el: 'metal', vsElite: behead ? Z.behead : 1, bleed, bleedT: Z.bleedT }, ev);
      if (k.hit.has(t.id)) (k.again ??= new Set()).add(t.id);
      k.hit.add(t.id);
      k.hitsLeft--;
      const next = nearestEnemy(w, k.x, k.y, Z.hop, k.hit, keep);
      if (next) k.target = next.id;
      else {
        // 没有别的目标：穿过去，再绕回来补刺一只还没补过的；都补过了，这把刀就收了
        const back = nearestEnemy(w, k.x, k.y, Z.hop, k.again, keep);
        if (back) {
          k.target = back.id;
          k.turn = Z.turn;
        } else k.hitsLeft = 0;
      }
    }
  }
}

/**
 * 七禽的火鸟：追自己的目标，打中一次就散；目标先死了（或走出了射程）就换最近的、没打过的（都在离人物 REACH.max 以内）；
 * 没得追了就散掉，不往画面外飞。返回这只是不是散了。
 */
function stepBird(w: World, k: Knife, dt: number, ev: SimEvent[]): boolean {
  const B = TUNE.wuhuo.bird;
  k.px = k.x;
  k.py = k.y;
  k.life -= dt;
  if (k.life <= 0 || k.hitsLeft <= 0) return true;
  const keep = inReach(w.players[k.owner]);
  let t = w.enemies.find((e) => e.id === k.target && e.hp > 0 && keep(e)) ?? null;
  if (!t) {
    t = nearestEnemy(w, k.x, k.y, REACH.max * 2, k.hit, keep);
    if (t) k.target = t.id;
  }
  if (!t) return true;
  const dx = t.x - k.x;
  const dy = t.y - 8 - k.y;
  const d = Math.hypot(dx, dy) || 1;
  const s = Math.min(1, dt * B.steer);
  k.vx += ((dx / d) * B.speed - k.vx) * s;
  k.vy += ((dy / d) * B.speed - k.vy) * s;
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  if (d < 8) {
    hitEnemy(w, t, { dmg: k.dmg, by: 'bird', owner: k.owner, from: k, kb: 40, el: 'fire', burn: k.dmg * B.burn, burnT: B.burnT }, ev);
    k.hit.add(t.id);
    k.hitsLeft--;
  }
  return k.hitsLeft <= 0;
}
