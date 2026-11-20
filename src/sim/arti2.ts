// 后加的 11 件公共法宝（M3，分支 arti2；暂拟，待评审确认）的模拟：出手、区域、延时落下、飞行物、敌人身上的状态。
// 名单与每件的凡 / 灵 / 仙 / 神见 docs/design.md「法宝扩到约 30 件」；冷却、基础伤害、品阶倍率在 catalog.WEAPONS，打法的数值在下面的 TUNE2。
// 别的文件里只留转接（函数名都带 2）：
//   weapons.ts FIRE 表 → fire2；updatePending 落地 → land2；updateKnives → stepKnife2；
//   zones.ts   ZONE / FX / ZONE_WEAPON 表里的新种类 → stepZone2 / endZone2；
//   core.ts    hitEnemy → hitMul2（叠钉、落宝、瘟神这类「受到的伤害提高」）；onKill → kill2；tickStatus → status2。
// 和原有的 16 件同一套规矩：冷却不短于 1.2 秒；索敌不超过 REACH.seek（130）、效果最远不超过 REACH.max（145），落点处的范围加成最多 +30%（REACH.area）；
// 首领不吃控制（定身、晕眩、冻结、拉扯走 core 的规则，这里自己做的定身也跳过首领）；法宝不碰敌人的弹道；持续伤害不打印记、不暴击。
// 运行时状态都是纯数据：区域在 world.zones、延时落下在 world.pending、飞行物在 world.knives、敌人身上的在 Enemy 的可选字段里（整局快照照存照恢复）。
// 随机数只用 w.rng。
import { ENEMIES, REACH } from './config.ts';
import { buildGrid, enemiesWithin, hitEnemy, inReach, nearestEnemy, slowEnemy, weaponDamage } from './core.ts';
import { addZone } from './zones.ts';
import { densest } from './weapons.ts';
import type { Enemy, HitBy, Knife, OwnedWeapon, Pending, Player, SimEvent, WeaponKind, Zone } from './types.ts';
import type { World } from './world.ts';

const SEEK = REACH.seek;
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** 落点处的范围：范围加成最多算到 REACH.area（同 weapons.aoe）。 */
const aoe = (p: Player) => 1 + Math.min(p.stats.area, REACH.area);
/** 首领不吃控制；点着了引信的爆符鬼（无敌）也不吃。 */
const ccFree = (e: Enemy) => e.kind !== 'boss' && e.invuln <= 0;

/** 各件的打法参数。数组都按品阶取（下标 1 凡 … 4 神）。 */
export const TUNE2 = {
  // 降魔杵：从天砸下一只，弹起再落向下一只（只挑离人物 REACH.max 以内、离上一个落点 hop 以内的），连砸 slams 下
  xiangmo: {
    seek: SEEK,
    hop: 70, // 弹向下一只最远多远（离上一个落点）
    slams: [0, 3, 4, 4, 4], // 一串砸几下（灵品起四下）
    r: [0, 15, 18, 20, 20], // 每一砸的半径（落点处，范围加成最多 +30%）
    stun: [0, 0.45, 0.65, 0.65, 0.65], // 砸中的晕多久（灵品起更久）
    // 第一下脱手飞出、砸到第一只身上要多久：fall + 离人物的距离 / speed（跟着目标走）；之后每一下弹起、落到下一只要 gap + 弹过去的距离 / speed
    // （法宝飞得不能太快，要看得清：最快约 300 像素 / 秒）
    fall: 0.28,
    gap: 0.3,
    speed: 300,
    decay: 0.88, // 每弹一次伤害衰减
    again: 0.6, // 身边没有别的可砸、又砸回这一串砸过的那只：这一下只有这一比例（单打一只、打首领不至于三下全额；0.35 → 0.6：正中轻了以后单体补回来）
    core: 1.25, // 正中那只（瞄准的）吃这一倍数，往外线性降到边上的 edge 倍。2026-11-11 数值平衡（没成型不秒杀）：1.5 / 0.75 → 1.25 / 0.85，正中那一下轻一点（凡品一下打死 27% → 15%）
    edge: 0.85,
    kb: 120,
    // 仙品「降魔印」：每一砸在地上留一枚印，踩上去的敌人被镇住（定身）root 秒，每只每枚印只镇一次
    seal: { r: 12, life: 2.6, root: 0.5 },
    weituo: 0.6, // 2026-11-11 0.62 → 0.6（单体 +16%）； 器灵「韦陀」：两根杵各砸一串，每一下的伤害倍数（两串加起来不至于翻倍）
    taishan: { mul: 1.1, lastR: 1.9, lastMul: 1.5 }, // 器灵「泰山」：每一砸更重；最后一下半径 ×lastR、伤害 ×lastMul
  },
  // 五光石：朝最近的敌人（首领在索敌半径里就朝首领）扇形掷出几枚五色石，直飞、打中第一只就碎：伤害 + 晕眩片刻（打中面门）
  wuguang: {
    seek: SEEK,
    n: [0, 3, 5, 5, 5], // 一次几枚（灵品起五枚：青赤黄白黑）
    fan: [0, 0.28, 0.24, 0.24, 0.24], // 相邻两枚之间的角度（凡 ±16°，灵品起五枚 ±27°）
    speed: 175, // 石子飞多快（看得清）
    steer: 3, // 每枚认一只（扇面前方最近的几只，首领在就先认首领），朝它掷出去、飞的时候稍微跟一点（碰到路上的照样碎）
    cone: 1.05, // 只认扇面前方 ±60° 里的（身后的不认）
    extra: 0.25, // 身边不够每枚一只时，多出来的那几枚也砸已经有人认的，但只有这一比例
    splash: { r: 12, mul: 0.4 }, // 石子在面门上碎开，碎石溅到身边 r 以内的（这一下的 mul 倍，不晕）
    range: 128, // 最远飞多远（吃范围加成，最多 far）
    far: REACH.max - 6,
    hitR: 4, // 石子自己的半径（加上敌人的身子算碰到）
    stun: [0, 0.32, 0.38, 0.38, 0.38], // 打中面门：晕多久
    // 仙品「五光」：打中后碎成五色光，弹向身边 n 只（离这只 hop 以内、离人物 REACH.max 以内），每道是这一下的 dmg 倍
    shard: { n: 2, hop: 46, dmg: 0.4, speed: 210, stun: 0.18, life: 0.5 },
    beads: 0.28, // 器灵「连珠」：多久后再掷一轮
    beadsMul: 0.54, // 「连珠」两轮各打这一比例（两轮加起来不至于翻倍）
    face: { stun: 0.75, mul: 1 }, // 器灵「破面」：晕得更久；对精英与首领伤害 ×mul
  },
  // 攒心钉：朝最近的敌人连发金钉（先钉身上已经有钉的、精英和首领），钉子留在身上，每枚让它受到的伤害 +per（谁打都算）
  zanxin: {
    seek: SEEK,
    n: [0, 3, 5, 6, 6], // 一次连发几枚（凡品三枚、灵品五枚、仙品起六枚），一枚一只（身边只有几只时，多出来的再钉已经钉过的，轻一些）
    again: 0.4, // 这一轮里同一只挨的第二枚起只有这一比例（单打一只不至于每一枚都全额）
    cap: [0, 2, 3, 3, 3], // 这一轮里同一只最多挨几枚（身边只有一两只时，一轮就少发几枚）
    gap: 0.11, // 连发的间隔
    speed: 250, // 金钉飞多快
    steer: 14, // 追得很紧（细钉子快，偏一点就拐回来）
    per: 0.05, // 每枚钉子：受到的伤害 +5%
    max: [0, 5, 6, 6, 6], // 最多钉几枚
    t: 4, // 钉子留多久（每钉进一枚就刷新）
    // 仙品「攒心」：钉满时一齐钻心 —— 这一下是 drill × 钉子数 × 一枚钉的伤害，钉子用掉
    drill: 0.3,
    elite: [0, 0.85, 0.85, 0.68, 0.68], // 细钉子扎精英、首领扎不深：一枚钉的伤害 ×elite / ×boss（钻心那一下不打折）
    boss: 0.75,
    seven: { n: 9, targets: 3, mul: 0.7 }, // 器灵「七星」：一次九枚，只钉身边三只（每枚轻一些；一只身上一轮钉三枚，钉得快、钻心快）
    bone: { hop: 34, cone: 0.7, bleed: 0.25, bleedT: 3 }, // 器灵「透骨」：钉子透过去再钉后面 hop 以内、前方 ±40° 的一只；钻心时溅血（每秒为钻心那一下的 bleed 倍）
  },
  // 金蛟剪：两条金蛟绕着人物盘旋（一阵），碰到的被咬，隔一会儿轮流扑出去咬圈外的；仙品「交剪」两条一齐扑向最近的敌人交错一剪
  jinjiao: {
    life: [0, 3.8, 4.1, 4.3, 4.3], // 绕多久（之后歇一会儿再放：冷却从放出来时算）
    r: [0, 36, 42, 44, 44], // 绕身的半径（吃一半的范围加成，最多 rMax）
    rMax: 54,
    spin: [0, 3.4, 3.9, 3.9, 3.9], // 角速度（弧度 / 秒）。2026-11-11 数值平衡（没成型不秒杀）：咬得轻一点、勤一点——转得快（2.8 / 3.3 → 3.4 / 3.9）、同一只再咬的间隔 0.3 → 0.22、扑咬 0.5 → 0.36 秒一次，单发倍率跟着降（灵品一下打死 49% → 11%、仙品 82% → 47%）
    ramp: 0.3, // 刚放出来从身边盘出去、收起时盘回来要多久
    bite: 10, // 金蛟咬得到多远（加上敌人的身子）
    h: 10, // 金蛟飞在胸口那么高：绕身的圆心是人物脚下往上 h，量咬不咬得到时敌人也取身子中间（脚下往上 8）
    breathe: { amp: 0.35, w: 2.2 }, // 绕身的半径一伸一缩（±amp 倍，角频率 w）：贴身的、跟在后面的都扫得到
    again: 0.22, // 同一只隔多久才会再被咬
    kb: 40,
    // 扑咬：每隔 every 秒，一条金蛟（两条轮流）扑向圈外离人物 reach 以内最近的一只（不超过 REACH.seek），扑过去要 dart 秒，咬它一口（mul 倍）
    lunge: { every: 0.36, reach: 104, dart: 0.26, mul: 1.15, splash: [0, 9, 12, 16, 21], side: 0.85 }, // 咬中那只身边 splash 以内的也挨一下（side 倍；灵品起咬得更开）
    elite: [0, 0.42, 0.42, 0.35, 0.42], // 咬、扑咬、交剪、绞对精英的倍率（单打一只时绕着、扑着都在咬它；仙品交剪一剪剪得重，对精英再轻一点）
    boss: 0.5,
    // 仙品「交剪」：每第 nth 次扑咬换成两条一齐扑出去交错一剪，剪中那只和它身边 r 以内的（这一下 mul 倍）
    snip: { nth: 3, reach: 104, dart: 0.28, r: 18, mul: 2.0 },
    four: 0.68, // 器灵「四蛟」：四条、两把剪（各剪一只）；每一口、每一剪的伤害倍数
    coil: { t: 0.8, every: 0.3, mul: 0.2, reach: 0, spin: 1, n: 3 }, // 器灵「绞龙」：剪完缠住它绞 t 秒（定身；首领只受伤），每 every 秒再咬一口（这一下的 mul 倍）；绞龙三条金蛟绕身（n），绕身咬得到远 reach 像素，角速度 ×spin
  },
  // 离地焰光旗：插在身边的一面旗，旗边的敌人脚下隔一会儿窜起地火（先亮一下）；人走远了旗跟过去重插
  yanguang: {
    life: [0, 6, 6.5, 7, 7], // 插多久
    R: [0, 64, 74, 78, 78], // 管得到多远（旗下一圈；只挑离人物 REACH.seek 以内的）
    every: [0, 0.8, 0.8, 0.75, 0.75], // 隔多久窜一次
    n: [0, 1, 2, 2, 2], // 一次窜几道（灵品起两道，各窜一只；旗边只有一只时第二道也窜它，轻一些）
    extra: 0.4,
    warn: 0.38, // 脚下先亮多久再窜起来
    r: [0, 15, 12, 12, 12], // 地火的半径（落点处，范围加成最多 +30%）
    burn: 0.35, // 点燃：每秒为这一下的 burn 倍
    burnT: 2.5,
    plant: 40, // 旗插在人物和敌群之间：从人物往敌群（首领在索敌半径里就往首领）那边走这么远（最多走到一半）
    follow: 92, // 人离旗超过这么远，旗拔起来跟过去重插
    idle: 1.1, // 旗边这么久都没有敌人，也拔起来重插（插到敌人那边去）
    hopGap: 0.5, // 两次重插至少隔多久
    // 仙品「焰光」：地火从这一只脚下一路窜到下一只（离它 hop 以内、没窜过的），每一窜隔 gap 秒，最多 chain 窜，每窜伤害 ×decay
    run: { chain: 3, hop: 44, gap: 0.16, decay: 0.45 },
    twin1: 0.75, // 南离只有一群时（两面旗插得近）每道的倍数
    twin: 0.5, // 器灵「南离」：一次插两面旗（各管一片），每道地火的伤害倍数
    blaze: { r: 13, life: 2.2, dmg: 0.05 }, // 器灵「焚城」：地火窜过的地方留一小片火海（每 0.3 秒一跳，这一下的 dmg 倍）
  },
  // 万鸦壶：一群火鸦扑到敌人最密处，在上空盘旋，一只接一只俯冲啄烧（跟着敌群慢慢挪）；仙品「火鸦」盘完一齐扑下自焚
  wanya: {
    seek: SEEK,
    n: [0, 7, 8, 8, 8], // 几只（灵品起八只；器灵「遮天」十二只）
    life: [0, 3.2, 3.8, 4, 4], // 盘多久
    r: [0, 30, 34, 36, 36], // 盘旋、俯冲够得着多远（落点处，范围加成最多 +30%）
    every: [0, 1.5, 1.5, 1.4, 1.1], // 每只隔多久俯冲一次（一群里轮着来）
    again: 0.9, // 同一只隔多久才会再被啄（鸦群下面只有一只时，大多数鸦只是盘着）
    extra: 0.1, // 仙品自焚时鸦比敌人多：多出来的也扑已经有鸦扑的，但只有这一比例
    dive: 0.22, // 俯冲下去要多久（先亮出要扑哪只，跟着它）
    drift: 45, // 跟着敌群挪的速度（像素 / 秒；只往离人物 REACH.max 以内的敌群挪）
    burn: 0.3, // 啄中点燃：每秒为这一下的 burn 倍
    burnT: 2.5,
    boom: { r: 14, mul: 1.25 }, // 仙品「火鸦」：盘完每只扑向一只自焚，炸开半径 r（这一下 mul 倍）
    sky: { n: 16, r: 1.3, mul: 0.6 }, // 器灵「遮天」：十二只、盘得更大（×r），每一口轻一些
    sun: { n: 14, reg: 0.7, mul: 0.4, every: 1.4, r: 30, flock: 1.3 }, // 器灵「金乌」：其余 n 只每一口 ×reg；领头一只金乌隔 every 扑一次（先扑首领和精英，没有就扑鸦群正下方的），落下炸开半径 r 的日火（×mul，被扑的那只也算刚被啄过）
  },
  // 四海瓶：瓶口一倾，从人物身前涌起一道浪头冲向敌群最密处，撞上的推着走，推到头砸下
  sihai: {
    seek: SEEK,
    speed: 150, // 浪头推进多快（像素 / 秒）
    start: 10, // 从人物身前多远涌起
    len: [0, 84, 92, 92, 100], // 最远推多远（从涌起的地方算；敌群近就推到它后面 over 像素为止，最少 min）
    over: 26,
    min: 56,
    w: [0, 15, 14, 16, 17], // 浪头半宽（横着），落点处的范围加成最多 +30%
    hit: 0.4, // 浪头撞上的那一下（每只一次，顺带减速）
    slow: 0.35,
    slowT: 1.2,
    front: 5, // 推着走的敌人在浪头前沿多远；比浪头慢的被浪头漫过去就不推了（贴在人物身上的也卷得到：back，四海的另外三道只算 back2）
    back: 16,
    back2: 4,
    heavy: 4, // 质量到这么大的（精英、盾兵、石傀儡……）和首领、召唤物推不动：浪头撞上就地砸下
    crash: 1, // 砸下（推到头，或撞上推不动的）：浪头前后 band 像素里的（被推着走的大多挤在这里）再挨一下、震开
    band: 14,
    big: { elite: 2, boss: 1.6 }, // 砸在精英、首领身上的倍率（大个子挨的是整道浪）
    kb: 70,
    freeze: 0.9, // 仙品「翻浪」：砸下时冻住砸中的（秒；首领不吃）
    four: { main: 1.4, side: 0.5 }, // 器灵「四海」：朝敌群那一道 ×main，另外三个方向各一道 ×side（推满 len）
    rage: { w: 1.7, crash: 1.5 }, // 器灵「怒涛」：浪头更宽、砸得更重
    linger: 0.5, // 砸下之后留给画面的水退（不再结算）
  },
  // 雾露乾坤网：在敌群前沿（朝人物那一侧）张开一张网；网里够数了（或张够 wait 秒）就收网：网里的挨一下、网住的定身
  wulu: {
    seek: SEEK,
    ahead: 0.6, // 网心从敌群中心往人物那边挪 r × ahead（敌人走过来正好进网）
    near: 6, // 网的边离人物至少多远（网心离人物 r + near）
    r: [0, 33, 40, 38, 44], // 网多大（半径；落点处的范围加成最多 +30%）。2026-11-11 数值平衡（没成型不秒杀）：凡 / 灵品的网大一点（30 / 38 → 33 / 40）、收网那一下轻两成（凡品一下打死 48% → 7%、灵品 63% → 28%），网的本事在定身
    body: 0.9, // 身子有一点在网里（离网心 r + 身子半径 × body 以内）就算进网
    wait: 1.2, // 最多张多久就收（秒）
    count: [0, 3, 3, 3, 2], // 网里有几只就收
    hit: 1, // 收网那一下
    big: { elite: 2.2, boss: 1.9 }, // 1.8 / 1.7 → 2.2 / 1.9（单发轻了，勒大个子的那一下补回来）； // 网到精英、首领：网一罩上就收，勒在大个子身上的那一下更重（倍率）
    hold: [0, 1.1, 1.5, 1.5, 1.5], // 定身多久（精英、首领、召唤物网不住，只挨那一下）
    cinch: { t: 0.5, quick: 0.3, slam: 0.9, preySlam: 0.22, r: 18 }, // preySlam 0.5 → 0.22（上面 big 提了以后仙品起单体 +23% 到 +37%）； // 仙品「乾坤」：收网之后 t 秒里把网住的拽到网心、缩成水球砸下（slam 倍，半径 r）；只罩住大个子时 quick 秒就砸（preySlam 倍）
    sky: { r: 1.35, slow: 0.6 }, // 器灵「天罗」：网更大，精英也网得住，首领减速 slow（定身那么久）
    earth: { mul: 0.9, r: 0.85 }, // mul 0.95 → 0.9； // 器灵「地网」：同时张两张，每张小一点（×r）、轻一点（×mul）；只有一群时第二张张在人物另一侧
  },
  // 七宝妙树：手执妙树绕身一刷（t 秒刷一圈），刷到的受伤、被远远刷开；刷完树上的宝飞散出去，各追一只（凡三宝、灵五宝、仙七宝）
  miaoshu: {
    seek: SEEK, // 索敌半径里有敌人就出手（身边刷得到的挨刷，远的等宝飞过去）
    r: [0, 70, 64, 66, 66], // 刷多远（以人物为圆心；范围加成最多 +30%）
    t: 0.3, // 刷一圈多久
    kb: [0, 120, 150, 150, 150], // 刷开（击退）
    gems: { n: [0, 3, 5, 7, 7], mul: 0.62, rep: 0.65, repBoss: 0.84, speed: 170, steer: 9, life: 1.3 }, // 刷完飞出几宝（各追一只：离人物最近的几只；敌人不够就轮着重复，追同一只的第 j 宝再 ×rep^j，首领 ×repBoss^j），每宝 ×mul
    burst: { r: 12, mul: 0.15 }, // 仙品「七宝」：一宝打中炸开一小圈宝光，身边 r 以内的也挨（这一宝的 mul 倍）
    twin: 0.5, // 器灵「双刷」：一来一回两遍（第二遍反着刷回来，各放一轮宝），每遍 ×twin
    glow: { n: 14, mul: 0.28, rep: 0.8 }, // 器灵「宝光」：十四宝，追着敌人飞（每宝 ×mul；轮着重复追同一只 ×rep^j）
  },
  // 瘟癀伞：撑在敌群上空，伞下隔一会儿洒一次瘟雾，染上的持续掉血、变慢，隔一会儿传给身边的；仙品瘟可叠三层，叠满瘟倒
  wenhuang: {
    seek: SEEK,
    r: [0, 28, 40, 40, 40], // 伞下的瘟雾多大（落点处的范围加成最多 +30%）
    life: [0, 3, 3.4, 3.4, 3.4], // 伞撑多久
    every: 0.5, // 伞下隔多久洒一次瘟雾（伞下的都染上；仙品起每洒两次叠一层）
    drift: 24, // 伞跟着伞下附近的敌群挪（像素 / 秒）
    dps: [0, 0.07, 0.12, 0.09, 0.1], // 每层每秒掉 dmg 的多少倍（0.5 秒一跳；第二层起每层只加一半）
    drip: { every: 0.6, mul: [0, 0.75, 0.6, 0.6, 0.6], first: 0.3 }, // 伞尖隔 every 秒滴下一滴瘟液，打伞下最壮的那只（首领、精英先；这一下 mul 倍）
    t: 4, // 染上一回持续多久（再染刷新）
    slow: 0.25, // 染瘟的变慢
    spread: { every: 0.8, reach: 30, n: [0, 1, 2, 2, 2] }, // 每只染瘟的隔 every 秒传给身边 reach 以内的 n 只（先传没染的，再传层数少的）
    max: [0, 1, 1, 3, 3], // 最多几层（仙品「瘟毒」三层）
    down: { t: 0.8, again: 2.5 }, // 叠满三层瘟倒（晕眩 t 秒），倒过之后 again 秒内不再倒
    five: { every: 0.5, reach: 44 }, // 器灵「五瘟」：传得更快、更远
    god: 0.2, // 器灵「瘟神」：染瘟的受到的伤害 +20%
  },
  // 落宝金钱：带翅的金钱飞到索敌半径里血最厚的那只头上，一下一下地敲（钱声震到身边的）；它死了「落宝」多掉灵石，金钱再飞向下一只
  luobao: {
    seek: SEEK,
    every: [0, 0.42, 0.34, 0.34, 0.34], // 隔多久敲一下
    life: [0, 2.6, 3.2, 3.2, 3.2], // 一回附多久
    splash: { r: [0, 15, 22, 30, 32], mul: 0.9 }, // 钱声：敲的那一下震到身边 r 以内的（mul 倍）
    speed: 240, // 飞过去多快
    drops: [0, 2, 3, 3, 3], // 一回最多落宝几次（每次多掉一枚灵石）
    luck: { n: 2, elite: 5 }, // 器灵「生财」：落宝多掉 n 枚，精英多掉 elite 枚
    rain: 0.62, // 器灵「金钱雨」：两枚各附一只，每枚 ×rain
    vuln: 0.2, // 仙品「落宝」：被附上的受到的伤害 +20%（护体失效）
  },
};

type Fire = (w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]) => boolean;

/** 法宝打出的伤害（hit 事件的 by）→ 是哪件法宝（tools/balance.ts 按它归账）。 */
export const ARTI2_BY: Partial<Record<HitBy, WeaponKind>> = { pestle: 'xiangmo', stone: 'wuguang', nail: 'zanxin', jiao: 'jinjiao', geyser: 'yanguang', crow: 'wanya', surge: 'sihai', net: 'wulu', sweep: 'miaoshu', gem: 'miaoshu', plague: 'wenhuang', coin: 'luobao' };

// ================================================================ 出手

const FIRE2: Partial<Record<WeaponKind, Fire>> = {
  // 降魔杵：先砸最近的一只（首领在索敌半径里就先砸首领），落地后在 land2 里弹向下一只；器灵「韦陀」两串
  xiangmo(w, p, wpn, ev) {
    const X = TUNE2.xiangmo;
    buildGrid(w.enemies);
    const near = enemiesWithin(w, p.x, p.y, X.seek).sort((a, b) => d2(a, p) - d2(b, p));
    if (!near.length) return false;
    const boss = near.find((e) => e.kind === 'boss');
    const first = boss ?? near[0];
    const dmg = weaponDamage(p, wpn, p.buffs.rage) * (wpn.spirit === 'taishan' ? X.taishan.mul : 1);
    const chains = wpn.spirit === 'weituo' ? 2 : 1;
    const starts: Enemy[] = [first];
    if (chains > 1) {
      // 第二根杵先砸离第一只远一点的另一只（身边只有一只就也砸它，晚一点落）
      const other = near.find((e) => e !== first && d2(e, first) >= 40 * 40) ?? near.find((e) => e !== first) ?? first;
      starts.push(other);
    }
    starts.forEach((t, i) => {
      const id = w.nextId++;
      const t2 = X.fall + Math.hypot(t.x - p.x, t.y - p.y) / X.speed + i * 0.16;
      const r = X.r[wpn.tier] * aoe(p);
      const q: Pending = {
        id,
        owner: p.id,
        kind: 'pestle',
        x: t.x,
        y: t.y,
        r,
        t: t2,
        dmg: dmg * (chains > 1 ? X.weituo : 1),
        target: t.id,
        tier: wpn.tier,
        seq: 1,
        n: X.slams[wpn.tier],
        chain: id,
        ox: p.x + p.facing * 6,
        oy: p.y,
        hit: [],
        ...(wpn.spirit ? { spirit: wpn.spirit } : {}),
      };
      w.pending.push(q);
      ev.push({ t: 'warn', id, kind: 'pestle', x: t.x, y: t.y, r, t2, tier: wpn.tier });
    });
    p.facing = first.x >= p.x ? 1 : -1;
    return true;
  },
  // 离地焰光旗：插旗（同一时间只有一面；器灵「南离」两面）；窜地火、跟着人重插在 stepBanner 里
  yanguang(w, p, wpn, ev) {
    const Y = TUNE2.yanguang;
    if (w.zones.some((z) => z.owner === p.id && z.kind === 'banner' && z.life - z.t > 0.4)) return false;
    buildGrid(w.enemies);
    if (!enemiesWithin(w, p.x, p.y, SEEK).length) return false; // 身边没有敌人：先不插
    const twin = wpn.spirit === 'twin';
    const R = Y.R[wpn.tier] * aoe(p);
    // 南离：两面旗各管一群；索敌半径里只有一群（或只有一只）时两面旗都按一面算（不然单打一只少一半）
    const groupsN = twin ? densest(w, p, SEEK, 2, [], 0).length : 1;
    const dmg = weaponDamage(p, wpn, p.buffs.rage) * (twin ? (groupsN >= 2 ? Y.twin : Y.twin1) : 1);
    // 插在人物和敌群之间；南离：两面，各插向一群（第二面插向离第一群远一点的那群，没有就插在人物另一侧）
    const spots = bannerSpots(w, p, twin ? 2 : 1);
    spots.forEach(([x, y], i) => {
      const z = addZone(w, { owner: p.id, kind: 'banner', x, y, x2: x, y2: y, r: R, life: Y.life[wpn.tier], dmg, tier: wpn.tier, tick2: 0.35 + i * 0.3, idle: 0, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
      ev.push({ t: 'zone', id: z.id, zone: 'banner', owner: p.id, x, y, r: R, life: z.life, kind: 'yanguang', tier: wpn.tier });
    });
    return true;
  },
  // 万鸦壶：一群火鸦扑到敌人最密处（首领在就扑首领；同一时间只有一群）；盘旋、俯冲、跟着挪、自焚在 stepCrows 里
  wanya(w, p, wpn, ev) {
    const A = TUNE2.wanya;
    if (w.zones.some((z) => z.owner === p.id && z.kind === 'crows' && z.life - z.t > 0.5)) return false;
    buildGrid(w.enemies);
    const t = densest(w, p, A.seek, 1, [], 0, (e) => (e.kind === 'boss' ? 6 : 1))[0];
    if (!t) return false;
    const sky = wpn.spirit === 'sky';
    const sun = wpn.spirit === 'sun';
    const n = sky ? A.sky.n : sun ? A.sun.n : A.n[wpn.tier];
    const r = A.r[wpn.tier] * aoe(p) * (sky ? A.sky.r : sun ? A.sun.flock : 1);
    const z = addZone(w, { owner: p.id, kind: 'crows', x: t.x, y: t.y, x2: t.x, y2: t.y, px: p.x, py: p.y, r, life: A.life[wpn.tier], dmg: weaponDamage(p, wpn, p.buffs.rage) * (sky ? A.sky.mul : sun ? A.sun.reg : 1), tier: wpn.tier, n, tick2: 0.45, nth: 0, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
    z.tick = A.sun.every * 0.6; // 金乌第一扑
    ev.push({ t: 'zone', id: z.id, zone: 'crows', owner: p.id, x: z.x, y: z.y, r, life: z.life, kind: 'wanya', tier: wpn.tier });
    ev.push({ t: 'throw', owner: p.id, x: p.x, y: p.y - 10, kind: 'wanya', tier: wpn.tier });
    return true;
  },
  // 四海瓶：浪头冲向敌群最密处（首领算四只）；器灵「四海」四个方向各一道。推、砸在 stepSurge 里
  sihai(w, p, wpn, ev) {
    const S = TUNE2.sihai;
    buildGrid(w.enemies);
    const t = densest(w, p, S.seek, 1, [], 0, (e) => (e.kind === 'boss' ? 4 : 1))[0];
    if (!t) return false;
    const four = wpn.spirit === 'four';
    const rage = wpn.spirit === 'rage';
    const base = Math.atan2(t.y - p.y, t.x - p.x);
    const dist = Math.hypot(t.x - p.x, t.y - p.y);
    const lenMax = S.len[wpn.tier];
    const half = S.w[wpn.tier] * aoe(p) * (rage ? S.rage.w : 1);
    const dmg = weaponDamage(p, wpn, p.buffs.rage);
    // 四海：朝敌群那一道最后放（区域倒着结算，贴在人物身上的先归它）
    const dirs = four ? [1, 2, 3, 0].map((i) => base + (i * Math.PI) / 2) : [base];
    dirs.forEach((a, k) => {
      const main = k === dirs.length - 1;
      const len = main ? Math.max(S.min, Math.min(lenMax, dist - S.start + S.over)) : lenMax;
      const x = p.x + Math.cos(a) * S.start;
      const y = p.y + Math.sin(a) * S.start;
      const z = addZone(w, { owner: p.id, kind: 'surge', x, y, x2: x, y2: y, px: x, py: y, r: half, life: len / S.speed + S.linger, dmg: dmg * (four ? (main ? S.four.main : S.four.side) : 1), tier: wpn.tier, a, len, nth: 0, who: main ? 0 : 1, hit: [], ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
      ev.push({ t: 'zone', id: z.id, zone: 'surge', owner: p.id, x, y, r: half, life: z.life, kind: 'sihai', tier: wpn.tier });
    });
    ev.push({ t: 'throw', owner: p.id, x: t.x, y: t.y, kind: 'sihai', tier: wpn.tier });
    return true;
  },
  // 雾露乾坤网：网张在敌群前沿（朝人物那一侧，网边离人物至少 near）；器灵「地网」两张。收网、乾坤在 stepNet 里
  wulu(w, p, wpn, ev) {
    const N = TUNE2.wulu;
    buildGrid(w.enemies);
    const two = wpn.spirit === 'earth';
    const groups = densest(w, p, N.seek, two ? 2 : 1, [], 0, (e) => (e.kind === 'boss' ? 4 : 1));
    if (!groups.length) return false;
    // 索敌半径里有首领 / 精英：第一张直接罩在它身上（不往人物这边挪）
    const big = enemiesWithin(w, p.x, p.y, N.seek).find((e) => e.kind === 'boss') ?? enemiesWithin(w, p.x, p.y, N.seek).find((e) => e.kind === 'elite');
    if (big) groups[0] = big;
    const r = N.r[wpn.tier] * aoe(p) * (wpn.spirit === 'sky' ? N.sky.r : two ? N.earth.r : 1);
    const dmg = weaponDamage(p, wpn, p.buffs.rage) * (two ? N.earth.mul : 1);
    // 地网：只有一群时第二张张在人物另一侧（朝第一张的反方向）
    const spots = groups.map((t) => [t.x, t.y] as [number, number]);
    if (two && spots.length < 2) spots.push(spots[0]);
    for (const [i, [tx, ty]] of spots.entries()) {
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const a = (d > 1e-6 ? Math.atan2(dy, dx) : 0) + (i === 1 && spots[1] === spots[0] ? Math.PI : 0);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // 网的外沿不出 REACH.max（网心最远 REACH.max − r）
      const at = Math.min(REACH.max - r, Math.max(r + N.near, d - (big && i === 0 ? 0 : r * N.ahead)));
      const x = p.x + ux * at;
      const y = p.y + uy * at;
      const z = addZone(w, { owner: p.id, kind: 'net', x, y, x2: x, y2: y, r, life: N.wait + N.hold[wpn.tier] + N.cinch.t + 0.5, dmg, tier: wpn.tier, nth: 0, ids: [], ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
      ev.push({ t: 'zone', id: z.id, zone: 'net', owner: p.id, x, y, r, life: z.life, kind: 'wulu', tier: wpn.tier });
    }
    ev.push({ t: 'throw', owner: p.id, x: spots[0][0], y: spots[0][1], kind: 'wulu', tier: wpn.tier });
    return true;
  },
  // 七宝妙树：身边（刷得到的地方）有敌人才刷；刷一圈在 stepSweep 里，仙品刷完放七宝
  miaoshu(w, p, wpn, ev) {
    const M = TUNE2.miaoshu;
    buildGrid(w.enemies);
    const r = M.r[wpn.tier] * aoe(p);
    if (!enemiesWithin(w, p.x, p.y, M.seek).length) return false;
    const twin = wpn.spirit === 'twin';
    const from = -Math.PI / 2; // 从头顶起刷，朝脸朝的那边转
    const spin = p.facing >= 0 ? 1 : -1;
    const z = addZone(w, { owner: p.id, kind: 'sweep', x: p.x, y: p.y, x2: p.x, y2: p.y, px: p.x, py: p.y, r, life: M.t * (twin ? 2 : 1), dmg: weaponDamage(p, wpn, p.buffs.rage) * (twin ? M.twin : 1), tier: wpn.tier, from, a: from, spin, hit: [], ids: [], ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
    ev.push({ t: 'zone', id: z.id, zone: 'sweep', owner: p.id, x: p.x, y: p.y, r, life: z.life, kind: 'miaoshu', tier: wpn.tier });
    return true;
  },
  // 瘟癀伞：撑在敌人最密处上空（同一时间只有一把）；洒瘟雾、跟着挪在 stepUmbrella 里，染上之后掉血、传染在 status2 里
  wenhuang(w, p, wpn, ev) {
    const U = TUNE2.wenhuang;
    if (w.zones.some((z) => z.owner === p.id && z.kind === 'umbrella' && z.life - z.t > 0.4)) return false;
    buildGrid(w.enemies);
    const t = densest(w, p, U.seek, 1, [], 0, (e) => (e.kind === 'boss' ? 4 : 1))[0];
    if (!t) return false;
    const r = U.r[wpn.tier] * aoe(p);
    const z = addZone(w, { owner: p.id, kind: 'umbrella', x: t.x, y: t.y, x2: t.x, y2: t.y, px: t.x, py: t.y, r, life: U.life[wpn.tier], dmg: weaponDamage(p, wpn, p.buffs.rage), tier: wpn.tier, n: 0, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
    z.tick = 0.15; // 撑开之后很快洒第一次
    ev.push({ t: 'zone', id: z.id, zone: 'umbrella', owner: p.id, x: z.x, y: z.y, r, life: z.life, kind: 'wenhuang', tier: wpn.tier });
    return true;
  },
  // 落宝金钱：飞向索敌半径里血最厚的那只（同一时间只有一回；器灵「金钱雨」两枚、各附一只）。敲、落宝、换下一只在 stepCoin / kill2 里
  luobao(w, p, wpn, ev) {
    const L = TUNE2.luobao;
    if (w.zones.some((z) => z.owner === p.id && z.kind === 'coin' && z.life - z.t > 0.4)) return false;
    buildGrid(w.enemies);
    const rain = wpn.spirit === 'rain';
    const ts = coinTargets(w, p, rain ? 2 : 1, []);
    if (!ts.length) return false;
    const dmg = weaponDamage(p, wpn, p.buffs.rage) * (rain && ts.length >= 2 ? L.rain : 1); // 金钱雨：只有一只时两枚并成一枚
    // 金钱雨：两枚各附一只（只有一只时只放一枚）
    for (const [i, t] of ts.entries()) {
      const x = p.x + (i ? -6 : 6);
      const y = p.y;
      const z = addZone(w, { owner: p.id, kind: 'coin', x, y, x2: x, y2: y, px: x, py: y, r: L.splash.r[wpn.tier] * aoe(p), life: L.life[wpn.tier], dmg, tier: wpn.tier, ids: [t.id], nth: 1, n: 0, ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
      z.tick = 0;
      ev.push({ t: 'zone', id: z.id, zone: 'coin', owner: p.id, x, y, r: z.r, life: z.life, kind: 'luobao', tier: wpn.tier });
    }
    ev.push({ t: 'throw', owner: p.id, x: ts[0].x, y: ts[0].y, kind: 'luobao', tier: wpn.tier });
    return true;
  },
  // 金蛟剪：放出绕身的金蛟（同一时间只有一阵）；绕、咬、交剪、绞都在 stepOrbit 里
  jinjiao(w, p, wpn, ev) {
    const J = TUNE2.jinjiao;
    if (w.zones.some((z) => z.owner === p.id && z.kind === 'orbit' && z.life - z.t > J.ramp)) return false;
    buildGrid(w.enemies);
    if (!enemiesWithin(w, p.x, p.y, J.rMax + 40).length) return false; // 身边没有敌人：先不放
    const four = wpn.spirit === 'four';
    const r = Math.min(J.rMax, J.r[wpn.tier] * (1 + p.stats.area * 0.5));
    const z = addZone(w, { owner: p.id, kind: 'orbit', x: p.x, y: p.y - J.h, x2: p.x, y2: p.y - J.h, r, len: r, life: J.life[wpn.tier], dmg: weaponDamage(p, wpn, p.buffs.rage) * (four ? J.four : 1), tier: wpn.tier, a: Math.atan2(-1, p.facing), spin: J.spin[wpn.tier] * (wpn.spirit === 'coil' ? J.coil.spin : 1), n: four ? 4 : wpn.spirit === 'coil' ? J.coil.n : 2, snip: 0, who: 0, coil: 0, tick2: J.lunge.every * 0.5, ids: [], ...(wpn.spirit ? { spirit: wpn.spirit } : {}) });
    ev.push({ t: 'zone', id: z.id, zone: 'orbit', owner: p.id, x: z.x, y: z.y, r, life: z.life, kind: 'jinjiao', tier: wpn.tier });
    return true;
  },
  // 攒心钉：朝挑中的那只连发金钉（第一枚现在射，其余的在 followUp2 里每隔 gap 补一枚）；钉进去、钻心在 stepKnife2 里
  zanxin(w, p, wpn, ev) {
    const Z = TUNE2.zanxin;
    const seven = wpn.spirit === 'seven';
    const ts = nailTargets(w, p, seven ? Z.seven.targets : Z.n[wpn.tier], wpn.tier);
    if (!ts.length) return false;
    const [t0, m0] = nailPick(ts, 0, seven, wpn.tier)!;
    shootNail(w, p, wpn, t0, m0, 0);
    const n = seven ? Z.seven.n : Z.n[wpn.tier];
    wpn.burst = n - 1;
    wpn.burstT = Z.gap;
    wpn.shot = 0;
    ev.push({ t: 'throw', owner: p.id, x: p.x, y: p.y - 10, kind: 'zanxin', tier: wpn.tier });
    p.facing = ts[0].x >= p.x ? 1 : -1;
    return true;
  },
  // 五光石：扇形掷出一轮五色石（器灵「连珠」过一会儿再掷一轮）；飞、碰、碎在 stepKnife2 里
  wuguang(w, p, wpn, ev) {
    const S = TUNE2.wuguang;
    const aim = aimStones(w, p, S.n[wpn.tier]);
    if (!aim) return false;
    const { a0, targets } = aim;
    const beads = wpn.spirit === 'beads';
    throwStones(w, p, wpn, a0, targets, beads ? S.beadsMul : 1, ev);
    if (beads) {
      wpn.burst = 1;
      wpn.burstT = S.beads;
      wpn.aim = a0;
    }
    p.facing = Math.cos(a0) >= 0 ? 1 : -1;
    return true;
  },
};

/**
 * 五光石掷一轮：从人物胸口朝 a0 方向扇形掷出 n 枚（第 i 枚是五色里的第 i 色）；每枚认一只（targets 按扇面从左到右排好），
 * 身边不够每枚一只，多出来的也认已经有人认的，但轻一些（extra）。
 */
function throwStones(w: World, p: Player, wpn: OwnedWeapon, a0: number, targets: Enemy[], mul: number, ev: SimEvent[]) {
  const S = TUNE2.wuguang;
  const n = S.n[wpn.tier];
  const fan = S.fan[wpn.tier];
  const range = Math.min(S.far, S.range * (1 + p.stats.area));
  const dmg = weaponDamage(p, wpn, p.buffs.rage) * mul;
  for (let i = 0; i < n; i++) {
    // 第 i 枚认哪一只：扇面里从左到右按目标的角度对上（目标少的时候，中间那几枚先认）
    const j = targets.length >= n ? i : Math.round((i / Math.max(1, n - 1)) * (targets.length - 1));
    const extra = targets.length < n && i !== Math.floor((n - 1) / 2) && (targets.length < 2 || !isFirstFor(i, j, n, targets.length));
    const t = targets[j];
    // 自己认了一只的直接朝它掷；多出来的那几枚在扇面里散开（也认那一只，慢慢拐过去）
    const a = t && !extra ? Math.atan2(t.y - p.y, t.x - p.x) : a0 + (i - (n - 1) / 2) * fan;
    const x = p.x + Math.cos(a) * 6;
    const y = p.y + Math.sin(a) * 6;
    // 五色：三枚时是青、赤、黄（中间那枚是赤），五枚时青赤黄白黑
    const color = n === 3 ? [0, 1, 2][i] : i % 5;
    w.knives.push({ id: w.nextId++, owner: p.id, x, y, px: x, py: y, vx: Math.cos(a) * S.speed, vy: Math.sin(a) * S.speed, target: t ? t.id : -1, hitsLeft: 1, hit: new Set(), dmg: dmg * (extra ? S.extra : 1), life: range / S.speed, tier: wpn.tier, kind: 'wuguang', color, range, sx: p.x, sy: p.y });
  }
  ev.push({ t: 'throw', owner: p.id, x: p.x, y: p.y - 10, kind: 'wuguang', tier: wpn.tier });
}
/** 目标比石子少时：第 i 枚是不是认第 j 只的那几枚里离中间最近的一枚（那一枚全额，其余的轻一些）。 */
function isFirstFor(i: number, j: number, n: number, m: number) {
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < n; k++) {
    if (Math.round((k / Math.max(1, n - 1)) * (m - 1)) !== j) continue;
    const d = Math.abs(k - (n - 1) / 2);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best === i;
}

/** 五光石朝哪里掷：首领在索敌半径里先认首领，再认最近的几只（最多 n 只）；方向朝第一只。没有就是 null。 */
function aimStones(w: World, p: Player, n: number): { a0: number; targets: Enemy[] } | null {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, TUNE2.wuguang.seek).sort((a, b) => d2(a, p) - d2(b, p));
  if (!near.length) return null;
  const first = near.find((e) => e.kind === 'boss') ?? near[0];
  const a0 = Math.atan2(first.y - p.y, first.x - p.x);
  // 相对 a0 的角度：扇面只朝前面那一群掷（身后的不认，免得石子绕一大圈），按角度从左到右排（左边的石子认左边的，不交叉）
  const rel = (e: Enemy) => {
    let d = Math.atan2(e.y - p.y, e.x - p.x) - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  const front = near.filter((e) => e !== first && Math.abs(rel(e)) <= TUNE2.wuguang.cone);
  const pick = [first, ...front].slice(0, n);
  pick.sort((a, b) => rel(a) - rel(b));
  return { a0, targets: pick };
}

/**
 * 攒心钉挑钉谁（一轮连发的几枚分给最多 n 只，一枚一只；身边只有一只就都钉它）：先挑身上已经有钉、还没钉满的（钉得越多越先），
 * 再挑精英、首领，再挑最近的；钉满了的往后放（凡 / 灵钉满了也不再加伤）。只挑索敌半径里的。
 */
function nailTargets(w: World, p: Player, n: number, tier: number): Enemy[] {
  const Z = TUNE2.zanxin;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, Z.seek);
  const max = Z.max[tier];
  const score = (e: Enemy) => {
    const k = (e.nailT ?? 0) > 0 ? (e.nails ?? 0) : 0;
    return (k >= max ? -20 : k * 10) + (e.kind === 'boss' || e.kind === 'elite' ? 3 : 0) - Math.sqrt(d2(e, p)) / 100;
  };
  return near.sort((a, b) => score(b) - score(a)).slice(0, n);
}
/** 这一轮的第 k 枚钉谁、多重：一枚一只，钉过了一圈再从头钉（第二圈起轻一些）；同一只一轮最多 cap 枚，超出的就不发了（null）。 */
function nailPick(ts: Enemy[], k: number, seven: boolean, tier: number): [Enemy, number] | null {
  const Z = TUNE2.zanxin;
  if (Math.floor(k / ts.length) >= Z.cap[tier]) return null;
  return [ts[k % ts.length], (seven ? Z.seven.mul : 1) * (k < ts.length || seven ? 1 : Z.again)];
}
/** 放一枚金钉：从人物胸口朝 t 飞（器灵「透骨」能透过去再钉一只）。 */
function shootNail(w: World, p: Player, wpn: OwnedWeapon, t: Enemy, mul: number, i: number) {
  const Z = TUNE2.zanxin;
  const a = Math.atan2(t.y - p.y, t.x - p.x) + (i % 2 ? 0.25 : -0.25) * (i ? 1 : 0); // 一枚枚从两侧错开射出，再拐过去
  const x = p.x + Math.cos(a) * 5;
  const y = p.y + Math.sin(a) * 5;
  w.knives.push({ id: w.nextId++, owner: p.id, x, y, px: x, py: y, vx: Math.cos(a) * Z.speed, vy: Math.sin(a) * Z.speed, target: t.id, hitsLeft: wpn.spirit === 'bone' ? 2 : 1, hit: new Set(), dmg: weaponDamage(p, wpn, p.buffs.rage) * mul, life: 1.2, tier: wpn.tier, kind: 'zanxin' });
}

/** weapons.ts 的连击（updateWeapons 里的 burst）转到这里：五光石「连珠」的第二轮、攒心钉的连发。 */
export function followUp2(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]) {
  if (wpn.kind === 'zanxin') {
    const Z = TUNE2.zanxin;
    const seven = wpn.spirit === 'seven';
    const ts = nailTargets(w, p, seven ? Z.seven.targets : Z.n[wpn.tier], wpn.tier);
    if (ts.length) {
      const k = (wpn.shot ?? 0) + 1; // 这一轮的第几枚
      wpn.shot = k;
      const pick = nailPick(ts, k, seven, wpn.tier);
      if (pick) shootNail(w, p, wpn, pick[0], pick[1], k);
      else wpn.burst = 0; // 身边只有这么几只：这一轮发够了
    }
    wpn.burstT = Z.gap;
    return;
  }
  if (wpn.kind !== 'wuguang') return;
  const S = TUNE2.wuguang;
  const aim = aimStones(w, p, S.n[wpn.tier]);
  throwStones(w, p, wpn, aim?.a0 ?? wpn.aim ?? 0, aim?.targets ?? [], S.beadsMul, ev);
}

/** weapons.ts 的 FIRE 表转到这里。 */
export function fire2(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const f = FIRE2[wpn.kind];
  return f ? f(w, p, wpn, ev) : false;
}

// ================================================================ 延时落下

/** weapons.ts 的 updatePending 落地时转到这里（这几种是这里的）。返回 false = 不是这里的种类。 */
export function land2(w: World, q: Pending, ev: SimEvent[]): boolean {
  if (q.kind === 'pestle') {
    landPestle(w, q, ev);
    return true;
  }
  if (q.kind === 'geyser') {
    landGeyser(w, q, ev);
    return true;
  }
  if (q.kind === 'dive') {
    landDive(w, q, ev);
    return true;
  }
  return false;
}

/** 万鸦壶：一只火鸦俯冲啄中（点燃）；仙品最后自焚，炸开一小团火（ring 是炸开的半径）；金乌落下炸开日火（burst）。 */
function landDive(w: World, q: Pending, ev: SimEvent[]) {
  const A = TUNE2.wanya;
  const t = q.target !== undefined ? w.enemies.find((e) => e.id === q.target && e.hp > 0) : undefined;
  const R = q.ring || q.burst || 0;
  if (R) {
    for (const e of w.enemies) {
      if (e.hp <= 0) continue;
      const rr = R + ENEMIES[e.kind].radius * 0.6;
      if (d2(e, q) > rr * rr) continue;
      hitEnemy(w, e, { dmg: q.dmg, by: 'crow', owner: q.owner, from: q, kb: 60, el: 'fire', burn: q.dmg * A.burn, burnT: A.burnT }, ev);
    }
    return;
  }
  if (t) hitEnemy(w, t, { dmg: q.dmg, by: 'crow', owner: q.owner, from: { x: t.x, y: t.y - 20 }, kb: 20, el: 'fire', burn: q.dmg * A.burn, burnT: A.burnT }, ev);
}

/** 离地焰光旗的一道地火：窜起来，烧这一圈的（点燃）；仙品起一路窜到下一只；「焚城」留一小片火海。 */
function landGeyser(w: World, q: Pending, ev: SimEvent[]) {
  const Y = TUNE2.yanguang;
  const p = w.players[q.owner];
  const tier = q.tier ?? 1;
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
    const rr = q.r + ENEMIES[e.kind].radius * 0.6;
    if (d2(e, q) > rr * rr) continue;
    hitEnemy(w, e, { dmg: q.dmg, by: 'geyser', owner: q.owner, from: q, kb: 30, el: 'fire', burn: q.dmg * Y.burn, burnT: Y.burnT }, ev);
  }
  if (q.spirit === 'blaze' && p) addZone(w, { owner: q.owner, kind: 'blaze', x: q.x, y: q.y, x2: q.x, y2: q.y, r: Y.blaze.r * aoe(p), life: Y.blaze.life, dmg: q.dmg * Y.blaze.dmg, tier });
  // 仙品「焰光」：一路窜到下一只
  const seq = q.seq ?? 1;
  if (tier < 3 || seq >= Y.run.chain || !p) return;
  const hit = (q.hit ??= []);
  if (q.target !== undefined && !hit.includes(q.target)) hit.push(q.target);
  const keep = inReach(p);
  const next = nearestEnemy(w, q.x, q.y, Y.run.hop, undefined, (e) => keep(e) && !hit.includes(e.id));
  if (!next) return;
  const id = w.nextId++;
  w.pending.push({ ...q, id, x: next.x, y: next.y, t: Y.run.gap, dmg: q.dmg * Y.run.decay, target: next.id, seq: seq + 1, ox: q.x, oy: q.y, hit });
  ev.push({ t: 'warn', id, kind: 'geyser', x: next.x, y: next.y, r: q.r, t2: Y.run.gap, tier });
}

/** 降魔杵落地：砸一圈（正中那只最重）、晕眩、震开；仙品起留下降魔印；还没砸够就弹向下一只。 */
function landPestle(w: World, q: Pending, ev: SimEvent[]) {
  const X = TUNE2.xiangmo;
  const p = w.players[q.owner];
  const tier = q.tier ?? 1;
  const n = q.n ?? 1;
  const seq = q.seq ?? 1;
  const last = seq >= n;
  const r = q.r; // 泰山的最后一下：排这一下的时候半径已经放大了（预警、落地事件里的 r 就是真的范围）
  const dmg = last && q.spirit === 'taishan' ? q.dmg * X.taishan.lastMul : q.dmg;
  const hitIds = (q.hit ??= []);
  const center = q.target !== undefined ? w.enemies.find((e) => e.id === q.target && e.hp > 0) : undefined;
  const again = q.target !== undefined && hitIds.includes(q.target) ? X.again : 1; // 砸回这一串砸过的那只
  for (const e of enemiesWithin(w, q.x, q.y, r + 6)) {
    const d = Math.max(0, Math.hypot(e.x - q.x, e.y - q.y) - ENEMIES[e.kind].radius);
    if (d > r) continue;
    const k = e === center ? X.core : X.core - (X.core - X.edge) * Math.min(1, d / Math.max(1, r));
    hitEnemy(w, e, { dmg: dmg * k * again, by: 'pestle', owner: q.owner, from: q, kb: X.kb, el: 'earth', stun: X.stun[tier] }, ev);
  }
  if (q.target !== undefined && !hitIds.includes(q.target)) hitIds.push(q.target);
  // 仙品「降魔印」：落点留一枚印（踩上去的被镇住片刻）
  if (tier >= 3 && p) addZone(w, { owner: q.owner, kind: 'vajra', x: q.x, y: q.y, x2: q.x, y2: q.y, r: X.seal.r * aoe(p), life: X.seal.life, dmg: 0, tier, hit: [] });
  if (last || !p) return;
  // 弹向下一只：离这个落点 hop 以内、离人物 REACH.max 以内，先挑这一串还没砸过的；都砸过了就再砸最近的一只（不是刚砸的那只）
  buildGrid(w.enemies);
  const keep = inReach(p);
  const fresh = (e: Enemy) => keep(e) && !hitIds.includes(e.id);
  const next = nearestEnemy(w, q.x, q.y, X.hop, undefined, fresh) ?? nearestEnemy(w, q.x, q.y, X.hop, undefined, (e) => keep(e) && e.id !== q.target) ?? (center && keep(center) ? center : null);
  if (!next) return;
  const id = w.nextId++;
  const t2 = X.gap + Math.hypot(next.x - q.x, next.y - q.y) / X.speed;
  const nr = seq + 1 >= n && q.spirit === 'taishan' ? q.r * X.taishan.lastR : q.r; // 泰山：最后一下砸出一大圈
  const nq: Pending = { ...q, id, x: next.x, y: next.y, r: nr, t: t2, dmg: q.dmg * X.decay, target: next.id, seq: seq + 1, ox: q.x, oy: q.y, hit: hitIds };
  w.pending.push(nq);
  ev.push({ t: 'warn', id, kind: 'pestle', x: next.x, y: next.y, r: nr, t2, tier });
}

// ================================================================ 区域

/** zones.ts 的 FX 表转到这里：这几种区域每帧的打法。 */
export function stepZone2(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  if (z.kind === 'vajra') stepVajra(w, z, dt);
  else if (z.kind === 'orbit') stepOrbit(w, z, dt, ev);
  else if (z.kind === 'banner') stepBanner(w, z, dt, ev);
  else if (z.kind === 'crows') stepCrows(w, z, dt, ev);
  else if (z.kind === 'surge') stepSurge(w, z, dt, ev);
  else if (z.kind === 'net') stepNet(w, z, dt, ev);
  else if (z.kind === 'sweep') stepSweep(w, z, dt, ev);
  else if (z.kind === 'umbrella') stepUmbrella(w, z, dt, ev);
  else if (z.kind === 'coin') stepCoin(w, z, dt, ev);
}

/** 落宝金钱挑谁：索敌半径里（离人物 REACH.max 以内）血最厚的几只（avoid 是别的金钱正附着的，先不挑）。 */
function coinTargets(w: World, p: Player, n: number, avoid: number[]): Enemy[] {
  const keep = inReach(p);
  const pool = enemiesWithin(w, p.x, p.y, TUNE2.luobao.seek).filter((e) => e.hp > 0 && keep(e) && ENEMIES[e.kind].mass < 1e5);
  pool.sort((a, b) => (avoid.includes(a.id) ? 1 : 0) - (avoid.includes(b.id) ? 1 : 0) || b.hp - a.hp || a.id - b.id);
  return pool.slice(0, n);
}

/**
 * 落宝金钱：飞向 ids[0] 那一只（nth 1），到了就附在它头上，隔 every 秒敲一下（钱声震到身边的）；仙品「落宝」附着时它受到的伤害提高、
 * 落魂幡手给的护体失效。它死了（谁打死的都算）在 kill2 里落宝；没了就飞向下一只血最厚的（离人物 REACH.max 以内）。
 */
function stepCoin(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const L = TUNE2.luobao;
  const p = w.players[z.owner];
  if (!p) return;
  z.px = z.x;
  z.py = z.y;
  const keep = inReach(p);
  let t = w.enemies.find((e) => e.id === (z.ids ?? [])[0] && e.hp > 0 && keep(e));
  if (!t) {
    // 换下一只（别的金钱正附着的先不挑）
    const others = w.zones.filter((o) => o !== z && o.owner === z.owner && o.kind === 'coin').map((o) => (o.ids ?? [])[0]);
    t = coinTargets(w, p, 1, others)[0];
    if (!t) return;
    z.ids = [t.id];
    z.nth = 1;
    ev.push({ t: 'arti2', kind: 'luobao', act: 'hop', owner: z.owner, x: t.x, y: t.y, tier: z.tier, id: t.id, pts: [[z.x, z.y]] });
  }
  if (z.nth) {
    const dx = t.x - z.x;
    const dy = t.y - z.y;
    const d = Math.hypot(dx, dy);
    const s = L.speed * dt;
    if (d > s + 2) {
      z.x += (dx / d) * s;
      z.y += (dy / d) * s;
      return;
    }
    z.nth = 0;
    z.tick = Math.min(z.tick, 0.05);
  }
  z.x = z.x2 = t.x;
  z.y = z.y2 = t.y;
  // 仙品「落宝」：附着时宝光被打落
  if (z.tier >= 3) {
    t.luobaoUntil = w.time + 0.25;
    if (t.wardT) t.wardT = 0;
  }
  z.tick -= dt;
  if (z.tick > 0) return;
  z.tick += L.every[z.tier];
  hitEnemy(w, t, { dmg: z.dmg, by: 'coin', owner: z.owner, from: { x: t.x, y: t.y - 30 }, el: 'metal', kb: 10 }, ev);
  for (const e of enemiesWithin(w, t.x, t.y, z.r + 12)) {
    if (e === t || e.hp <= 0) continue;
    const rr = z.r + ENEMIES[e.kind].radius * 0.6;
    if (d2(e, t) <= rr * rr) hitEnemy(w, e, { dmg: z.dmg * L.splash.mul, by: 'coin', owner: z.owner, from: t, el: 'metal', noMark: true }, ev);
  }
  ev.push({ t: 'arti2', kind: 'luobao', act: 'knock', owner: z.owner, x: t.x, y: t.y, tier: z.tier, id: t.id, r: z.r });
}

/** core.ts 的 onKill 转到这里：落宝金钱附着的那只死了「落宝」，多掉灵石（一回最多 drops 次）。 */
export function kill2(w: World, e: Enemy, ev: SimEvent[]) {
  const L = TUNE2.luobao;
  for (const z of w.zones) {
    if (z.kind !== 'coin' || z.nth || (z.ids ?? [])[0] !== e.id) continue;
    if ((z.n ?? 0) >= L.drops[z.tier]) continue;
    z.n = (z.n ?? 0) + 1;
    const n = 1 + (z.spirit === 'luck' ? (e.kind === 'elite' || e.kind === 'boss' ? L.luck.elite : L.luck.n) : 0);
    for (let i = 0; i < n; i++) {
      const a = w.rng.next() * Math.PI * 2;
      const sp = 30 + w.rng.next() * 50;
      w.gems.push({ id: w.nextId++, x: e.x, y: e.y, px: e.x, py: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, value: 1, pulled: -1 });
    }
    ev.push({ t: 'arti2', kind: 'luobao', act: 'drop', owner: z.owner, x: e.x, y: e.y, tier: z.tier, id: e.id, v: n });
  }
}

/** 染上一回瘟：刷新时长，层数 +add（不超过这把伞的上限）；叠满三层瘟倒。 */
function infect(w: World, e: Enemy, owner: number, dps: number, tier: number, spirit: string | undefined, add: number, ev: SimEvent[], fromUmbrella = false) {
  const U = TUNE2.wenhuang;
  if (e.hp <= 0 || e.invuln > 0) return;
  const max = U.max[tier];
  const had = e.plagueT !== undefined && e.plagueT > 0 ? (e.plague ?? 0) : 0;
  e.plague = Math.min(max, Math.max(1, had + add));
  e.plagueT = U.t;
  e.plagueBy = owner;
  e.plagueDps = Math.max(had ? (e.plagueDps ?? 0) : 0, dps);
  e.plagueTier = tier;
  if (spirit) e.plagueSp = spirit;
  else delete e.plagueSp;
  if (!had) e.plagueTick = 0.5;
  // 新染上（或被伞下的瘟雾再染一回）：过一会儿传给身边的；传过一回的要等再染上才再传
  if (!had || (fromUmbrella && (e.plagueCd ?? -1) < 0)) e.plagueCd = spirit === 'five' ? U.five.every : U.spread.every;
  // 瘟毒：叠满三层瘟倒（首领不倒）
  if (max >= 3 && e.plague >= max && had < max && ccFree(e) && (e.plagueDown ?? 0) <= 0) {
    e.stun = Math.max(e.stun, U.down.t);
    e.plagueDown = U.down.again;
    ev.push({ t: 'arti2', kind: 'wenhuang', act: 'down', owner, x: e.x, y: e.y, tier, id: e.id });
  }
}

/** 瘟癀伞：跟着伞下附近的敌群慢慢挪；隔 every 秒洒一次瘟雾，伞下的都染上（仙品起每洒两次叠一层）。 */
function stepUmbrella(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const U = TUNE2.wenhuang;
  const p = w.players[z.owner];
  if (!p) return;
  const keep = inReach(p);
  z.px = z.x;
  z.py = z.y;
  const around = w.enemies.filter((e) => e.hp > 0 && d2(e, z) <= (z.r * 1.5) ** 2 && keep(e));
  if (around.length) {
    let sx = 0;
    let sy = 0;
    for (const e of around) {
      sx += e.x;
      sy += e.y;
    }
    const dx = sx / around.length - z.x;
    const dy = sy / around.length - z.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const s = Math.min(d, U.drift * dt);
      z.x = z.x2 = z.x + (dx / d) * s;
      z.y = z.y2 = z.y + (dy / d) * s;
    }
  }
  // 伞尖的瘟液：隔一会儿滴在伞下最壮的那只身上
  z.tick2 = (z.tick2 ?? U.drip.first) - dt;
  if (z.tick2 <= 0) {
    z.tick2 += U.drip.every;
    let big: Enemy | undefined;
    let bs = -1;
    for (const e of enemiesWithin(w, z.x, z.y, z.r + 12)) {
      const rr = z.r + ENEMIES[e.kind].radius * 0.6;
      if (e.hp <= 0 || d2(e, z) > rr * rr || !keep(e)) continue;
      const sc = (e.kind === 'boss' ? 3e9 : e.kind === 'elite' ? 2e9 : 0) + e.hp;
      if (sc > bs) {
        bs = sc;
        big = e;
      }
    }
    if (big) {
      hitEnemy(w, big, { dmg: z.dmg * U.drip.mul[z.tier], by: 'plague', owner: z.owner, from: { x: big.x, y: big.y - 30 }, el: 'wood' }, ev);
      ev.push({ t: 'arti2', kind: 'wenhuang', act: 'drip', owner: z.owner, x: big.x, y: big.y, tier: z.tier, id: big.id });
      if (big.hp > 0) infect(w, big, z.owner, z.dmg * U.dps[z.tier], z.tier, z.spirit, 0, ev);
    }
  }
  z.tick -= dt;
  if (z.tick > 0) return;
  z.tick += U.every;
  z.n = (z.n ?? 0) + 1;
  const add = z.tier >= 3 && z.n % 2 === 0 ? 1 : 0;
  for (const e of enemiesWithin(w, z.x, z.y, z.r + 12)) {
    const rr = z.r + ENEMIES[e.kind].radius * 0.6;
    if (e.hp > 0 && d2(e, z) <= rr * rr && keep(e)) infect(w, e, z.owner, z.dmg * U.dps[z.tier], z.tier, z.spirit, add, ev, true);
  }
}

/** 身上的瘟：0.5 秒一跳掉血（每层 plagueDps × 0.5）、变慢；隔一会儿传给身边的；到时没了。 */
function tickPlague(w: World, e: Enemy, dt: number, ev: SimEvent[]) {
  const U = TUNE2.wenhuang;
  if (e.plagueDown && e.plagueDown > 0) e.plagueDown = Math.max(0, e.plagueDown - dt);
  if (e.plagueT === undefined || e.plagueT <= 0 || e.hp <= 0) return;
  e.plagueT -= dt;
  if (e.plagueT <= 0) {
    e.plagueT = 0;
    e.plague = 0;
    return;
  }
  slowEnemy(w, e, e.plagueBy ?? 0, U.slow, 0.2);
  e.plagueTick = (e.plagueTick ?? 0.5) - dt;
  if (e.plagueTick <= 0) {
    e.plagueTick += 0.5;
    hitEnemy(w, e, { dmg: (e.plagueDps ?? 0) * (1 + 0.5 * ((e.plague ?? 1) - 1)) * 0.5, by: 'plague', owner: e.plagueBy ?? 0, from: e, el: 'wood', canCrit: false, noMark: true }, ev);
    if (e.hp <= 0) return;
  }
  // 传给身边的（染上一回只传一回；再被伞下的瘟雾染上才再传）
  if (e.plagueCd === undefined || e.plagueCd < 0) return;
  e.plagueCd -= dt;
  if (e.plagueCd > 0) return;
  const five = e.plagueSp === 'five';
  e.plagueCd = -1;
  const tier = e.plagueTier ?? 1;
  const reach = five ? U.five.reach : U.spread.reach;
  const max = U.max[tier];
  const cand: { o: Enemy; k: number }[] = [];
  for (const o of enemiesWithin(w, e.x, e.y, reach + 12)) {
    if (o === e || o.hp <= 0 || o.invuln > 0) continue;
    const rr = reach + ENEMIES[o.kind].radius * 0.6;
    if (d2(o, e) > rr * rr) continue;
    const lv = o.plagueT && o.plagueT > 0 ? (o.plague ?? 0) : 0;
    if (lv >= max) continue;
    cand.push({ o, k: lv * 1e4 + d2(o, e) });
  }
  if (!cand.length) return;
  cand.sort((a, b) => a.k - b.k);
  const ids: number[] = [];
  for (const { o } of cand.slice(0, U.spread.n[tier])) {
    infect(w, o, e.plagueBy ?? 0, e.plagueDps ?? 0, tier, e.plagueSp, max >= 3 ? 1 : 0, ev);
    ids.push(o.id);
  }
  ev.push({ t: 'arti2', kind: 'wenhuang', act: 'spread', owner: e.plagueBy ?? 0, x: e.x, y: e.y, tier, id: e.id, ids });
}

/** 角度差规到 [0, 2π)。 */
const wrap2 = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/**
 * 七宝妙树的一刷：跟着人物，从 from 起朝 spin 那边转一圈（t 秒），妙树扫过的（离人物 r 以内）各挨一下、被刷开；
 * 器灵「双刷」再反着刷回来一遍（第二遍刷到的另记）。刷完：仙品放七宝（宝光十四宝），各追一只。
 */
function stepSweep(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const M = TUNE2.miaoshu;
  void dt;
  const p = w.players[z.owner];
  z.px = z.x;
  z.py = z.y;
  if (p?.alive) {
    z.x = z.x2 = p.x;
    z.y = z.y2 = p.y;
  }
  const T = M.t;
  const twin = z.spirit === 'twin';
  const pass = twin && z.t > T ? 1 : 0;
  const k = Math.min(1, pass ? (z.t - T) / T : z.t / T);
  const dir = (z.spin ?? 1) * (pass ? -1 : 1);
  const from = z.from ?? 0;
  const swept = Math.PI * 2 * k;
  z.a = from + dir * swept;
  const list = pass ? (z.ids ??= []) : (z.hit ??= []);
  for (const e of enemiesWithin(w, z.x, z.y, z.r + 14)) {
    if (e.hp <= 0 || list.includes(e.id)) continue;
    const rr = z.r + ENEMIES[e.kind].radius * 0.6;
    if (d2(e, z) > rr * rr) continue;
    const rel = wrap2((Math.atan2(e.y - z.y, e.x - z.x) - from) * dir);
    if (rel > swept + 0.15 && d2(e, z) > 100) continue; // 贴在身上的（10 像素以内）一起刷
    list.push(e.id);
    hitEnemy(w, e, { dmg: z.dmg, by: 'sweep', owner: z.owner, from: z, el: 'wood', kb: M.kb[z.tier] }, ev);
  }
  // 一遍刷完：放一轮宝（双刷两遍各一轮）
  const done = (z.n ?? 0) | 0;
  const due = z.t >= T - 1e-6 - dt * 0.5 ? (twin && z.t >= 2 * T - 1e-6 - dt * 0.5 ? 2 : 1) : 0;
  if (due <= done) return;
  z.n = due;
  if (!p) return;
  const glow = z.spirit === 'glow';
  const n = glow ? M.glow.n : M.gems.n[z.tier];
  const keep = inReach(p);
  const pool = enemiesWithin(w, p.x, p.y, M.seek).filter((e) => e.hp > 0 && keep(e)).sort((a, b) => d2(a, p) - d2(b, p));
  if (!pool.length) return;
  const base = glow ? M.glow.mul / M.gems.mul : 1; // z.dmg 已经乘过双刷的 twin；每宝 ×gems.mul 在落下时算
  for (let i = 0; i < n; i++) {
    const t = pool[i % pool.length];
    const a = z.a + (i / n) * Math.PI * 2;
    const x = p.x + Math.cos(a) * 14;
    const y = p.y - 10 + Math.sin(a) * 10;
    const rep = (t.kind === 'boss' ? M.gems.repBoss : glow ? M.glow.rep : M.gems.rep) ** Math.floor(i / pool.length); // 轮着重复追同一只：一宝比一宝轻
    w.knives.push({ id: w.nextId++, owner: p.id, x, y, px: x, py: y, vx: Math.cos(a) * M.gems.speed * 0.7, vy: Math.sin(a) * M.gems.speed * 0.7, target: t.id, hitsLeft: 1, hit: new Set(), dmg: z.dmg * M.gems.mul * base * rep, life: M.gems.life, tier: z.tier, kind: 'miaoshu', color: i % 7 });
  }
  ev.push({ t: 'arti2', kind: 'miaoshu', act: 'gems', owner: p.id, x: p.x, y: p.y, tier: z.tier, id: z.id, v: n });
}

/** 七宝妙树的一宝：追自己那一只，到了打一下就散；那只先死了就换身边最近的一只（离人物 REACH.max 以内、没被这一宝打过的），没有就散了。 */
function stepGem(w: World, k: Knife, dt: number, ev: SimEvent[]): boolean {
  const G = TUNE2.miaoshu.gems;
  k.px = k.x;
  k.py = k.y;
  k.life -= dt;
  if (k.life <= 0) return true;
  const p = w.players[k.owner];
  const keep = inReach(p);
  let t = w.enemies.find((e) => e.id === k.target && e.hp > 0 && keep(e));
  if (!t) {
    t = nearestEnemy(w, k.x, k.y, 60, k.hit, keep) ?? undefined;
    if (!t) return true;
    k.target = t.id;
  }
  const dx = t.x - k.x;
  const dy = t.y - 8 - k.y;
  const d = Math.hypot(dx, dy) || 1;
  const s = Math.min(1, dt * G.steer);
  k.vx += ((dx / d) * G.speed - k.vx) * s;
  k.vy += ((dy / d) * G.speed - k.vy) * s;
  const v = Math.hypot(k.vx, k.vy) || 1;
  k.vx = (k.vx / v) * G.speed;
  k.vy = (k.vy / v) * G.speed;
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  if (d > G.speed * dt + 5) return false;
  hitEnemy(w, t, { dmg: k.dmg, by: 'gem', owner: k.owner, from: { x: k.px, y: k.py }, kb: 30, el: 'wood' }, ev);
  // 仙品「七宝」：炸开一小圈宝光
  if ((k.tier ?? 1) >= 3) {
    const B = TUNE2.miaoshu.burst;
    for (const e of enemiesWithin(w, t.x, t.y, B.r + 12)) {
      if (e === t || e.hp <= 0) continue;
      const rr = B.r + ENEMIES[e.kind].radius * 0.6;
      if (d2(e, t) <= rr * rr) hitEnemy(w, e, { dmg: k.dmg * B.mul, by: 'gem', owner: k.owner, from: t, el: 'wood', noMark: true }, ev);
    }
  }
  return true;
}

/**
 * 雾露乾坤网：张着等（nth 0），网里够 count 只、或张够 wait 秒就收网（nth 1）：网里的都挨一下，网得住的定身 hold 秒
 * （首领、精英、召唤物网不住；器灵「天罗」精英也网得住、首领减速）；张够了网里也没有敌人就散了（nth 2）。
 * 仙品「乾坤」：收网之后 cinch.t 秒里把网住的拽到网心，缩成一团水球砸下（网心 cinch.r 以内的都挨）。
 */
function stepNet(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const N = TUNE2.wulu;
  const sky = z.spirit === 'sky';
  if (!z.nth) {
    const inside: Enemy[] = [];
    for (const e of enemiesWithin(w, z.x, z.y, z.r + 14)) {
      const rr = z.r + ENEMIES[e.kind].radius * N.body;
      if (e.hp > 0 && d2(e, z) <= rr * rr) inside.push(e);
    }
    if (inside.length < N.count[z.tier] && z.t < N.wait && !inside.some((e) => e.kind === 'boss' || e.kind === 'elite')) return;
    if (!inside.length) {
      z.nth = 2;
      z.life = Math.min(z.life, z.t + 0.4);
      ev.push({ t: 'arti2', kind: 'wulu', act: 'miss', owner: z.owner, x: z.x, y: z.y, tier: z.tier, id: z.id, r: z.r });
      return;
    }
    z.nth = 1;
    z.tick = z.t;
    const hold = N.hold[z.tier];
    const ids: number[] = [];
    for (const e of inside) {
      // 同一刻另一张网（地网）已经收住的不再算
      if (w.time - (e.zoneHit?.net ?? -9) < 0.3) continue;
      (e.zoneHit ??= {}).net = w.time;
      const caught = ccFree(e) && ENEMIES[e.kind].mass < 1e5 && (e.kind !== 'elite' || sky);
      const mul = e.kind === 'boss' ? N.big.boss : e.kind === 'elite' ? N.big.elite : 1;
      const dealt = hitEnemy(w, e, { dmg: z.dmg * N.hit * mul, by: 'net', owner: z.owner, from: z, el: 'water', ...(caught ? { stun: hold } : {}) }, ev);
      if (caught && dealt > 0) ids.push(e.id); // 金光挡下的网不住
      else if (sky && e.kind === 'boss') slowEnemy(w, e, z.owner, N.sky.slow, hold);
    }
    z.ids = ids;
    // 网里只有网不住的大个子：网罩在它身上勒一下就被挣破（仙品还要缩成水球砸在它身上）
    const big = ids.length ? undefined : inside.find((e) => e.kind === 'boss' || e.kind === 'elite');
    if (big) z.prey = big.id;
    const keep = big ? (z.tier >= 3 ? N.cinch.quick + 0.12 : 0.35) : z.tier >= 3 ? Math.max(hold, N.cinch.t + 0.15) : hold;
    z.life = Math.min(z.life, z.t + keep + 0.05);
    ev.push({ t: 'arti2', kind: 'wulu', act: 'spring', owner: z.owner, x: z.x, y: z.y, tier: z.tier, id: z.id, r: z.r, ids });
    return;
  }
  if (z.nth !== 1 || z.tier < 3 || z.n) return;
  // 乾坤：拽到网心，缩成水球砸下（只罩住大个子时网跟着它，quick 秒就砸在它身上）
  const k = z.t - z.tick;
  const prey = z.prey !== undefined ? w.enemies.find((e) => e.id === z.prey && e.hp > 0) : undefined;
  if (prey) {
    z.x = z.x2 = prey.x;
    z.y = z.y2 = prey.y;
  }
  const caught = (z.ids ?? []).map((id) => w.enemies.find((e) => e.id === id && e.hp > 0)).filter((e): e is Enemy => !!e);
  if (k < (z.prey !== undefined ? N.cinch.quick : N.cinch.t)) {
    const left = Math.max(dt, N.cinch.t - k);
    for (const e of caught) {
      const dx = z.x - e.x;
      const dy = z.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) continue;
      const s = Math.min(d - 1.5, (d / left) * dt);
      e.x += (dx / d) * s;
      e.y += (dy / d) * s;
    }
    return;
  }
  z.n = 1;
  const R = N.cinch.r;
  for (const e of enemiesWithin(w, z.x, z.y, R + 14)) {
    const rr = R + ENEMIES[e.kind].radius * 0.6;
    // 水球砸在大个子（罩住的首领 / 精英，天罗网住的精英）身上轻一些
    const big = z.prey !== undefined || e.kind === 'elite' || e.kind === 'boss';
    if (e.hp > 0 && d2(e, z) <= rr * rr) hitEnemy(w, e, { dmg: z.dmg * (big ? N.cinch.preySlam : N.cinch.slam), by: 'net', owner: z.owner, from: { x: z.x, y: z.y - 20 }, el: 'water' }, ev);
  }
  ev.push({ t: 'arti2', kind: 'wulu', act: 'slam', owner: z.owner, x: z.x, y: z.y, tier: z.tier, id: z.id, r: R });
}

/** 敌人在浪头的坐标系里：u 顺着浪头走的方向（从涌起的地方算），v 横着。 */
function surgeUV(z: Zone, e: { x: number; y: number }): [number, number] {
  const a = z.a ?? 0;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const dx = e.x - z.x2;
  const dy = e.y - z.y2;
  return [dx * ux + dy * uy, -dx * uy + dy * ux];
}

/**
 * 四海瓶的浪头：从 (x2, y2) 顺着 a 推出去，撞上的挨一下（减速）并被推到浪头前沿跟着走（首领、无敌的推不动；越重的推得越慢，
 * 跟不上就被浪头漫过去）；推到 len 砸下：浪头前后的再挨一下、震开，仙品「翻浪」冻住。砸下之后只剩画面上的水退。
 */
function stepSurge(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const S = TUNE2.sihai;
  const a = z.a ?? 0;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const len = z.len ?? 0;
  const s = Math.min(len, S.speed * z.t);
  z.px = z.x;
  z.py = z.y;
  z.x = z.x2 + ux * s;
  z.y = z.y2 + uy * s;
  if (z.nth) return;
  const hit = (z.hit ??= []);
  let stop = s >= len - 1e-6;
  for (const e of enemiesWithin(w, z.x, z.y, z.r + 24)) {
    const rad = ENEMIES[e.kind].radius;
    const [u, v] = surgeUV(z, e);
    if (Math.abs(v) > z.r + rad * 0.6 || u > s + S.front + rad || u < s - (z.who ? S.back2 : S.back)) continue;
    if (!hit.includes(e.id)) {
      hit.push(e.id);
      // 金光挡下的这一下不减速（推照样推：水是推得动的）
      if (hitEnemy(w, e, { dmg: z.dmg * S.hit, by: 'surge', owner: z.owner, from: { x: e.x - ux * 10, y: e.y - uy * 10 }, el: 'water' }, ev) > 0) slowEnemy(w, e, z.owner, S.slow, S.slowT);
    }
    if (e.hp <= 0) continue;
    // 推不动的（首领、无敌的、重的、召唤物）：浪头撞上就地砸下
    if (!ccFree(e) || ENEMIES[e.kind].mass >= S.heavy) {
      stop = true;
      continue;
    }
    const want = s + S.front - u;
    if (want <= 0) continue;
    const step = Math.min(want, S.speed * 1.4 * Math.min(1, 1 / Math.sqrt(ENEMIES[e.kind].mass)) * dt);
    e.x += ux * step;
    e.y += uy * step;
  }
  if (!stop) return;
  // 砸下（推到头，或撞上了推不动的）：浪头停在这里
  z.nth = 1;
  z.len = s;
  const ids: number[] = [];
  const mul = S.crash * (z.spirit === 'rage' ? S.rage.crash : 1);
  for (const e of enemiesWithin(w, z.x, z.y, z.r + 30)) {
    const rad = ENEMIES[e.kind].radius;
    const [u, v] = surgeUV(z, e);
    if (Math.abs(v) > z.r + rad * 0.6 || u < s - S.band || u > s + S.band * 0.6 + rad) continue;
    const big = e.kind === 'boss' ? S.big.boss : e.kind === 'elite' ? S.big.elite : 1;
    hitEnemy(w, e, { dmg: z.dmg * mul * big, by: 'surge', owner: z.owner, from: { x: e.x - ux * 10, y: e.y - uy * 10 }, el: 'water', kb: S.kb, ...(z.tier >= 3 ? { freeze: S.freeze } : {}) }, ev);
    ids.push(e.id);
  }
  // 浪头砸下之后留下的水只是画面：life 收到 linger 之后
  z.life = Math.min(z.life, z.t + S.linger);
  ev.push({ t: 'arti2', kind: 'sihai', act: 'crash', owner: z.owner, x: z.x, y: z.y, tier: z.tier, id: z.id, r: z.r, v: a, ids });
}

/** 放一只火鸦俯冲：dive 秒后啄中 t（跟着它走）。who 是第几只；boom 不为 0 是仙品最后的自焚，burst 不为 0 是金乌落下炸开的日火（半径）。 */
function crowDive(w: World, z: Zone, t: Enemy, who: number, dmg: number, boom: number, ev: SimEvent[], burst = 0) {
  const A = TUNE2.wanya;
  const id = w.nextId++;
  const r = boom || burst || 8;
  w.pending.push({ id, owner: z.owner, kind: 'dive', x: t.x, y: t.y, r, t: A.dive + (boom ? (who % 4) * 0.06 : 0), dmg, target: t.id, tier: z.tier, seq: who, chain: z.id, ring: boom, ...(burst ? { burst } : {}), ...(z.spirit ? { spirit: z.spirit } : {}) });
  ev.push({ t: 'warn', id, kind: 'dive', x: t.x, y: t.y, r, t2: A.dive, tier: z.tier });
}

/** 万鸦壶的鸦群：跟着敌群慢慢挪，一只接一只俯冲（金乌另算）；仙品最后一齐扑下自焚。 */
function stepCrows(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const A = TUNE2.wanya;
  const p = w.players[z.owner];
  if (!p) return;
  const keep = inReach(p);
  const inside = w.enemies.filter((e) => e.hp > 0 && d2(e, z) <= z.r * z.r && keep(e));
  // 跟着敌群挪：往附近（1.6 倍半径里、离人物 REACH.max 以内的）敌人的中心挪
  z.px = z.x;
  z.py = z.y;
  const around = w.enemies.filter((e) => e.hp > 0 && d2(e, z) <= (z.r * 1.6) ** 2 && keep(e));
  if (around.length) {
    let sx = 0;
    let sy = 0;
    for (const e of around) {
      sx += e.x;
      sy += e.y;
    }
    const dx = sx / around.length - z.x;
    const dy = sy / around.length - z.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const s = Math.min(d, A.drift * dt);
      z.x = z.x2 = z.x + (dx / d) * s;
      z.y = z.y2 = z.y + (dy / d) * s;
    }
  }
  const n = z.n ?? 6;
  const sun = z.spirit === 'sun';
  // 仙品「火鸦」：快盘完时一齐扑下自焚（每只扑一只，身边不够就扑同一只）
  if (z.tier >= 3 && !(z.nth ?? 0) && z.life - z.t <= A.dive + 0.12) {
    z.nth = 1;
    const pool = inside.length ? inside : around;
    if (pool.length) for (let i = 0; i < n + (sun ? 1 : 0); i++) crowDive(w, z, pool[i % pool.length], i, z.dmg * A.boom.mul * (i < pool.length ? 1 : A.extra), A.boom.r, ev);
    return;
  }
  if (z.life - z.t < A.dive + 0.15) return;
  // 金乌：领头那一只，先扑首领和精英，一口顶好几只
  if (sun) {
    z.tick -= dt;
    if (z.tick <= 0 && inside.length) {
      z.tick = A.sun.every;
      let big = inside.find((e) => e.kind === 'boss') ?? inside.find((e) => e.kind === 'elite');
      if (!big) for (const e of inside) if (!big || d2(e, z) < d2(big, z)) big = e;
      (big!.zoneHit ??= {}).crows = w.time;
      crowDive(w, z, big!, n, (z.dmg / A.sun.reg) * A.sun.mul, 0, ev, A.sun.r * aoe(p));
    }
  }
  // 一群里轮着俯冲：每 every / n 秒扑一只
  z.tick2 = (z.tick2 ?? 0) - dt;
  if (z.tick2 > 0) return;
  if (!inside.length) {
    z.tick2 = 0.1;
    return;
  }
  z.tick2 = A.every[z.tier] / n;
  // 挑一只最近没被啄过的（同一只隔 again 秒才再被啄）；都刚啄过，这一只就接着盘
  const fresh = inside.filter((e) => e.zoneHit?.crows === undefined || w.time - (e.zoneHit.crows ?? 0) >= A.again);
  if (!fresh.length) return;
  const t = fresh[Math.floor(w.rng.next() * fresh.length)];
  (t.zoneHit ??= {}).crows = w.time;
  const who = (z.acc = ((z.acc ?? 0) + 1) % n);
  crowDive(w, z, t, who, z.dmg, 0, ev);
}

/** 焰光旗插在哪：人物和敌群（首领在索敌半径里就是首领）之间，从人物往那边走 plant（最多走一半的路）；n 面就挑 n 群。 */
function bannerSpots(w: World, p: Player, n: number, avoid: { x: number; y: number }[] = []): [number, number][] {
  const Y = TUNE2.yanguang;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, SEEK);
  const boss = near.find((e) => e.kind === 'boss');
  const groups = densest(w, p, SEEK, n, avoid, 0, (e) => (e.kind === 'boss' ? 6 : 1));
  const targets: { x: number; y: number }[] = boss ? [boss, ...groups.filter((g) => g !== boss)].slice(0, n) : groups;
  const out: [number, number][] = targets.map((t) => {
    const d = Math.hypot(t.x - p.x, t.y - p.y) || 1;
    const k = Math.min(Y.plant, d * 0.5) / d;
    return [p.x + (t.x - p.x) * k, p.y + (t.y - p.y) * k + 2];
  });
  while (out.length < n) {
    const [x, y] = out[0] ?? [p.x + 12, p.y + 2];
    out.push([p.x - (x - p.x), p.y - (y - p.y) + 4]);
  }
  return out;
}

/**
 * 离地焰光旗：隔一会儿在旗边（R 以内，也在离人物 REACH.seek 以内）挑几只敌人，脚下先亮、再窜起地火（Pending 'geyser'，跟着目标走）；
 * 人离旗太远了，旗拔起来跟过去，插在人物身边（hop）。
 */
function stepBanner(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const Y = TUNE2.yanguang;
  const p = w.players[z.owner];
  if (!p) return;
  z.tick = Math.max(0, z.tick - dt); // 借 tick 记「距可以再重插还剩多久」
  const anyNear = w.enemies.some((e) => e.hp > 0 && d2(e, z) <= z.r * z.r);
  z.idle = anyNear ? 0 : (z.idle ?? 0) + dt;
  if (p.alive && (d2(p, z) > Y.follow * Y.follow || (z.idle ?? 0) > Y.idle) && z.tick <= 0 && z.life - z.t > 0.6 && enemiesWithin(w, p.x, p.y, SEEK).length) {
    const ox = z.x;
    const oy = z.y;
    // 另一面旗（南离）插着的地方让开
    const others = w.zones.filter((o) => o !== z && o.kind === 'banner' && o.owner === z.owner);
    const [x, y] = bannerSpots(w, p, 1, others)[0];
    z.x = z.x2 = x;
    z.y = z.y2 = y;
    z.tick = Y.hopGap;
    z.idle = 0;
    ev.push({ t: 'arti2', kind: 'yanguang', act: 'hop', owner: z.owner, x: z.x, y: z.y, tier: z.tier, pts: [[ox, oy]] });
  }
  z.tick2 = (z.tick2 ?? 0) - dt;
  if (z.tick2 > 0 || z.life - z.t < Y.warn) return;
  const keep = inReach(p);
  const busy = new Set(w.pending.filter((q) => q.kind === 'geyser' && q.owner === z.owner).map((q) => q.target));
  const near = w.enemies
    .filter((e) => e.hp > 0 && d2(e, z) <= z.r * z.r && d2(e, p) <= SEEK * SEEK && keep(e) && !busy.has(e.id))
    .sort((a, b) => d2(a, z) - d2(b, z));
  if (!near.length) {
    z.tick2 = 0.15;
    return;
  }
  z.tick2 = Y.every[z.tier];
  const r = Y.r[z.tier] * aoe(p);
  const n = Y.n[z.tier];
  for (let i = 0; i < n; i++) {
    const t = near[i] ?? near[0]; // 旗边只有这么几只：多出来的那一道也窜第一只，轻一些
    const extra = i >= near.length;
    const id = w.nextId++;
    // 同一只身上的第二道错开一点、晚一点窜（不叠在一起）
    const x = t.x + (extra ? 6 : 0);
    const y = t.y + (extra ? 3 : 0);
    w.pending.push({ id, owner: z.owner, kind: 'geyser', x, y, r, t: Y.warn + (extra ? 0.18 : 0), dmg: z.dmg * (extra ? Y.extra : 1), ...(extra ? {} : { target: t.id }), tier: z.tier, seq: 1, chain: id, ox: z.x, oy: z.y, hit: [], ...(z.spirit ? { spirit: z.spirit } : {}) });
    ev.push({ t: 'warn', id, kind: 'geyser', x, y, r, t2: Y.warn + (extra ? 0.18 : 0), tier: z.tier });
  }
}

/** 扑咬、交剪打精英、首领打折（单打一只时扑得太勤）。 */
const tough = (e: Enemy, tier: number) => (e.kind === 'boss' ? TUNE2.jinjiao.boss : e.kind === 'elite' ? TUNE2.jinjiao.elite[tier] : 1);

/** 金蛟剪这一刻绕身的半径：刚放出来从身边盘出去、快收的时候盘回来。 */
export function orbitRadius(z: Zone) {
  const J = TUNE2.jinjiao;
  const k = Math.min(1, z.t / J.ramp, Math.max(0, z.life - z.t) / J.ramp);
  return (z.len ?? z.r) * k * (1 + J.breathe.amp * Math.sin(z.t * J.breathe.w));
}
/** 第 i 条金蛟的位置（绕身的圆，圆心在人物胸口：z.y 已经是脚下往上 TUNE2.jinjiao.h）。 */
export function dragonAt(z: Zone, i: number): [number, number] {
  const a = (z.a ?? 0) + (i * Math.PI * 2) / (z.n ?? 2);
  const r = orbitRadius(z);
  return [z.x + Math.cos(a) * r, z.y + Math.sin(a) * r];
}

/** 金蛟剪：跟着主人绕身盘旋，碰到的咬一口（同一只隔一会儿才再咬）；仙品起隔一会儿扑出去交剪，「绞龙」剪完缠住它绞。 */
function stepOrbit(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const J = TUNE2.jinjiao;
  const p = w.players[z.owner];
  z.px = z.x;
  z.py = z.y;
  if (p?.alive) {
    z.x = z.x2 = p.x;
    z.y = z.y2 = p.y - J.h;
  }
  const ids = (z.ids ??= []);
  // 缠着绞（绞龙）：缠着的那只死了就松开，回来接着绕
  if ((z.coil ?? 0) > 0) {
    const t = w.enemies.find((e) => e.id === ids[0] && e.hp > 0);
    z.coil = t ? (z.coil ?? 0) - dt : 0;
    z.tick -= dt;
    if (t && z.tick <= 0) {
      z.tick += J.coil.every;
      // 绞住定身（金光挡下的那一口不算）
      if (hitEnemy(w, t, { dmg: z.dmg * J.coil.mul * tough(t, z.tier), by: 'jiao', owner: z.owner, from: t, el: 'metal' }, ev) > 0 && ccFree(t)) t.stun = Math.max(t.stun, J.coil.every + 0.05);
    }
    if ((z.coil ?? 0) <= 0) {
      z.coil = 0;
      ids.length = 0;
    }
    return;
  }
  // 扑出去：扑到了就咬（一条扑咬）/ 剪（一齐扑出去交剪）；一条扑出去的时候，别的照常绕着咬
  const lunging = (z.snip ?? 0) > 0 && (z.who ?? -1) >= 0;
  if ((z.snip ?? 0) > 0) {
    z.snip = (z.snip ?? 0) - dt;
    if ((z.snip ?? 0) <= 0 && lunging) {
      z.snip = 0;
      const t = w.enemies.find((e) => e.id === ids[0] && e.hp > 0);
      if (t) {
        ev.push({ t: 'arti2', kind: 'jinjiao', act: 'bite', owner: z.owner, x: t.x, y: t.y, tier: z.tier, id: t.id, v: z.who });
        const L = J.lunge;
        const sr = L.splash[z.tier] ?? L.splash[1];
        for (const e of w.enemies)
          if (e.hp > 0 && (e === t || d2(e, t) <= (sr + ENEMIES[e.kind].radius) ** 2)) hitEnemy(w, e, { dmg: z.dmg * L.mul * tough(e, z.tier) * (e === t ? 1 : L.side), by: 'jiao', owner: z.owner, from: { x: z.x, y: z.y }, kb: 50, el: 'metal' }, ev);
      }
      ids.length = 0;
    }
  }
  if ((z.snip ?? 0) > 0 && !lunging) return; // 一齐扑出去了：不绕
  if ((z.who ?? 0) < 0) {
    // 交剪：扑到了，剪
    z.snip = 0;
    z.who = 0;
    for (const id of ids) {
      const t = w.enemies.find((e) => e.id === id && e.hp > 0);
      if (!t) continue;
      ev.push({ t: 'arti2', kind: 'jinjiao', act: 'snip', owner: z.owner, x: t.x, y: t.y, tier: z.tier, id: t.id });
      for (const e of w.enemies) if (e.hp > 0 && d2(e, t) <= (J.snip.r + ENEMIES[e.kind].radius) ** 2) hitEnemy(w, e, { dmg: z.dmg * J.snip.mul * tough(e, z.tier), by: 'jiao', owner: z.owner, from: t, kb: 60, el: 'metal' }, ev);
      if (z.spirit === 'coil' && t.hp > 0) {
        z.coil = J.coil.t;
        z.tick = 0;
        ids.length = 0;
        ids.push(t.id);
        ev.push({ t: 'arti2', kind: 'jinjiao', act: 'coil', owner: z.owner, x: t.x, y: t.y, tier: z.tier, id: t.id, v: J.coil.t });
        return;
      }
    }
    ids.length = 0;
    return;
  }
  z.a = (z.a ?? 0) + (z.spin ?? 3) * dt;
  // 绕身咬：每条金蛟咬得到身边的（扑出去的那一条除外）；同一只隔 again 秒才再咬
  const r = orbitRadius(z);
  if (r > 4)
    for (let i = 0; i < (z.n ?? 2); i++) {
      if ((z.snip ?? 0) > 0 && i === z.who) continue;
      const [x, y] = dragonAt(z, i);
      for (const e of w.enemies) {
        if (e.hp <= 0) continue;
        const rr = J.bite + (z.spirit === 'coil' ? J.coil.reach : 0) + ENEMIES[e.kind].radius;
        if ((e.x - x) ** 2 + (e.y - 8 - y) ** 2 > rr * rr) continue;
        const last = e.zoneHit?.orbit;
        if (last !== undefined && w.time - last < J.again) continue;
        (e.zoneHit ??= {}).orbit = w.time;
        hitEnemy(w, e, { dmg: z.dmg * tough(e, z.tier), by: 'jiao', owner: z.owner, from: { x: z.x, y: z.y }, kb: J.kb, el: 'metal' }, ev);
      }
    }
  // 扑咬（一条扑出去咬不在圈上的，两条轮流）；仙品起每第 nth 次换成交剪（一齐扑出去，四蛟两把剪各扑一只）；收起前的那一下不扑
  z.tick2 = (z.tick2 ?? J.lunge.every) - dt;
  const snipNow = z.tier >= 3 && ((z.nth ?? 0) + 1) % J.snip.nth === 0;
  const S = snipNow ? J.snip : J.lunge;
  if ((z.snip ?? 0) > 0 || z.life - z.t < S.dart + J.ramp) return;
  if (z.tick2 > 0 || !p) return;
  const keep = inReach(p);
  // 扑咬只扑不在圈上的（圈上的绕着就咬得到）：圈外的，和贴到身边、在圈里头的；交剪扑最近的
  const onRing = (e: Enemy) => !snipNow && Math.abs(Math.hypot(e.x - z.x, e.y - 8 - z.y) - r) <= J.bite + ENEMIES[e.kind].radius;
  const near = w.enemies
    .filter((e) => e.hp > 0 && d2(e, p) <= Math.min(SEEK, S.reach) ** 2 && !onRing(e) && keep(e))
    .sort((a, b) => d2(a, p) - d2(b, p));
  if (!near.length) {
    z.tick2 = 0.2;
    return;
  }
  z.tick2 = J.lunge.every;
  z.nth = (z.nth ?? 0) + 1;
  ids.length = 0;
  if (!snipNow) {
    // 一条扑出去：两条轮流
    z.who = ((z.who ?? 0) + 1) % (z.n ?? 2);
    ids.push(near[0].id);
    z.snip = S.dart;
    ev.push({ t: 'arti2', kind: 'jinjiao', act: 'lunge', owner: z.owner, x: z.x, y: z.y, tier: z.tier, ids: [near[0].id], v: z.who, r: S.dart });
    return;
  }
  const pairs = (z.n ?? 2) / 2;
  for (let i = 0; i < pairs; i++) ids.push(near[Math.min(i, near.length - 1)].id);
  if (ids.length > 1 && ids[1] === ids[0]) ids.pop();
  z.who = -1;
  z.snip = S.dart;
  ev.push({ t: 'arti2', kind: 'jinjiao', act: 'dart', owner: z.owner, x: z.x, y: z.y, tier: z.tier, ids: [...ids], v: S.dart });
}

/** 降魔印：踩上去的敌人被镇住（定身）片刻，每只每枚印只镇一次（首领、点着引信的爆符鬼不吃）。 */
function stepVajra(w: World, z: Zone, dt: number) {
  z.tick -= dt;
  if (z.tick > 0) return;
  z.tick += 0.1;
  const X = TUNE2.xiangmo;
  const hit = (z.hit ??= []);
  for (const e of w.enemies) {
    if (e.hp <= 0 || hit.includes(e.id) || !ccFree(e)) continue;
    const rr = z.r + ENEMIES[e.kind].radius * 0.5;
    if (d2(e, z) > rr * rr) continue;
    hit.push(e.id);
    e.stun = Math.max(e.stun, X.seal.root);
  }
}

// ================================================================ 飞行物

/** weapons.ts 的 updateKnives 转到这里（kind 是这里的几件）。返回 true = 这一只收掉了。 */
export function stepKnife2(w: World, k: Knife, dt: number, ev: SimEvent[]): boolean {
  if (k.kind === 'wuguang') return k.shard ? stepShard(w, k, dt, ev) : stepStone(w, k, dt, ev);
  if (k.kind === 'zanxin') return stepNail(w, k, dt, ev);
  if (k.kind === 'miaoshu') return stepGem(w, k, dt, ev);
  return true;
}

/** 攒心钉的金钉：追自己那一只，到了就钉进去（伤害 + 钉一枚）；那只先死了就换一只身边最近的（离人物 REACH.max 以内），没有就落了。 */
function stepNail(w: World, k: Knife, dt: number, ev: SimEvent[]): boolean {
  const Z = TUNE2.zanxin;
  k.px = k.x;
  k.py = k.y;
  k.life -= dt;
  if (k.life <= 0) return true;
  const p = w.players[k.owner];
  const keep = inReach(p);
  let t = w.enemies.find((e) => e.id === k.target && e.hp > 0 && keep(e));
  if (!t) {
    t = nearestEnemy(w, k.x, k.y, 60, k.hit, keep) ?? undefined;
    if (!t) return true;
    k.target = t.id;
  }
  const dx = t.x - k.x;
  const dy = t.y - 8 - k.y;
  const d = Math.hypot(dx, dy) || 1;
  const s = Math.min(1, dt * Z.steer);
  k.vx += ((dx / d) * Z.speed - k.vx) * s;
  k.vy += ((dy / d) * Z.speed - k.vy) * s;
  const v = Math.hypot(k.vx, k.vy) || 1;
  k.vx = (k.vx / v) * Z.speed;
  k.vy = (k.vy / v) * Z.speed;
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  if (d > Z.speed * dt + 5) return false;
  nailHit(w, k, t, ev);
  k.hit.add(t.id);
  k.hitsLeft--;
  if (k.hitsLeft <= 0) return true;
  // 透骨：透过去，钉后面那一只（前方 ±cone、hop 以内）
  const B = Z.bone;
  const ang = Math.atan2(k.vy, k.vx);
  let next: Enemy | null = null;
  let bd = B.hop * B.hop;
  for (const e of w.enemies) {
    if (e.hp <= 0 || k.hit.has(e.id) || !keep(e)) continue;
    const dd = d2(e, t);
    if (dd > bd) continue;
    let da = Math.atan2(e.y - t.y, e.x - t.x) - ang;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > B.cone) continue;
    bd = dd;
    next = e;
  }
  if (!next) return true;
  k.target = next.id;
  k.x = t.x;
  k.y = t.y - 8;
  return false;
}

/** 一枚钉子钉进去：伤害，钉上一枚（刷新时长）；仙品起钉满了就一齐钻心。 */
function nailHit(w: World, k: Knife, e: Enemy, ev: SimEvent[]) {
  const Z = TUNE2.zanxin;
  const tier = k.tier ?? 1;
  const tough = e.kind === 'boss' ? Z.boss : e.kind === 'elite' ? Z.elite[tier] : 1;
  // 金光（金光力士给的）挡下的这一枚、没钉进去的不算
  if (hitEnemy(w, e, { dmg: k.dmg * tough, by: 'nail', owner: k.owner, from: { x: k.px, y: k.py }, kb: 20, el: 'metal' }, ev) <= 0 || e.hp <= 0) return;
  const max = Z.max[tier];
  e.nails = Math.min(max, ((e.nailT ?? 0) > 0 ? (e.nails ?? 0) : 0) + 1);
  e.nailT = Z.t;
  e.nailBy = k.owner;
  if (tier < 3 || e.nails < max) return;
  // 攒心：钉子一齐钻心
  const p = w.players[k.owner];
  const wpn = p?.weapons.find((x) => x.kind === 'zanxin');
  const one = wpn && p ? weaponDamage(p, wpn, p.buffs.rage) : k.dmg;
  const n = e.nails;
  e.nails = 0;
  e.nailT = 0;
  ev.push({ t: 'arti2', kind: 'zanxin', act: 'drill', owner: k.owner, x: e.x, y: e.y, tier, id: e.id, v: n });
  const bone = wpn?.spirit === 'bone';
  const big = one * n * Z.drill * (e.kind === 'boss' ? Z.boss : 1);
  hitEnemy(w, e, { dmg: big, by: 'nail', owner: k.owner, from: e, el: 'metal', noMark: true, ...(bone ? { bleed: (big * Z.bone.bleed) / 3, bleedT: Z.bone.bleedT } : {}) }, ev);
}

/** core.ts 的 hitEnemy 转到这里：再加的几件让敌人「受到的伤害提高」的（攒心钉的钉子……）。谁打都算。 */
export function hitMul2(w: World, e: Enemy): number {
  const nail = (e.nailT ?? 0) > 0 && e.nails ? 1 + TUNE2.zanxin.per * e.nails : 1;
  const god = (e.plagueT ?? 0) > 0 && e.plagueSp === 'god' ? 1 + TUNE2.wenhuang.god : 1; // 瘟癀伞「瘟神」：染瘟的受到的伤害提高
  const luo = e.luobaoUntil !== undefined && w.time < e.luobaoUntil ? 1 + TUNE2.luobao.vuln : 1; // 落宝金钱「落宝」：宝光被打落
  return nail * god * luo;
}

/** core.ts 的 tickStatus 转到这里：敌人身上再加的几件的状态随时间（钉子到时掉了……）。 */
export function status2(w: World, e: Enemy, dt: number, ev: SimEvent[]) {
  if (e.plagueT !== undefined && (e.plagueT > 0 || (e.plagueDown ?? 0) > 0)) tickPlague(w, e, dt, ev);
  if (e.nailT !== undefined && e.nailT > 0) {
    e.nailT -= dt;
    if (e.nailT <= 0) {
      e.nailT = 0;
      e.nails = 0;
    }
  }
}

/** 五光石的石子：直飞，碰到第一只就碎（伤害 + 晕眩；仙品起碎成五色光弹向身边的）；飞到头、出了 REACH.max 就落地。 */
function stepStone(w: World, k: Knife, dt: number, ev: SimEvent[]): boolean {
  const S = TUNE2.wuguang;
  k.px = k.x;
  k.py = k.y;
  k.life -= dt;
  // 慢慢拐向自己认的那一只（它死了、走出 REACH.max 了就直飞）
  const p = w.players[k.owner];
  const t = k.target >= 0 ? w.enemies.find((e) => e.id === k.target && e.hp > 0) : undefined;
  if (t && inReach(p)(t)) {
    const dx = t.x - k.x;
    const dy = t.y - k.y;
    const d = Math.hypot(dx, dy) || 1;
    const s = Math.min(1, dt * S.steer);
    k.vx += ((dx / d) * S.speed - k.vx) * s;
    k.vy += ((dy / d) * S.speed - k.vy) * s;
    const v = Math.hypot(k.vx, k.vy) || 1;
    k.vx = (k.vx / v) * S.speed;
    k.vy = (k.vy / v) * S.speed;
  }
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  if (k.life <= 0 || (p && d2(k, p) > REACH.max * REACH.max)) return true;
  // 碰到的：这一步走过的线段上离起点最近的一只（快的时候不穿过去）
  let hit: Enemy | null = null;
  let best = Infinity;
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
    const rr = S.hitR + ENEMIES[e.kind].radius;
    const dx = k.x - k.px;
    const dy = k.y - k.py;
    const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e.x - k.px) * dx + (e.y - k.py) * dy) / L));
    const cx = k.px + dx * t;
    const cy = k.py + dy * t;
    if ((e.x - cx) ** 2 + (e.y - cy) ** 2 > rr * rr) continue;
    if (t < best) {
      best = t;
      hit = e;
    }
  }
  if (!hit) return false;
  const face = p?.weapons.find((x) => x.kind === 'wuguang')?.spirit === 'face';
  const tier = k.tier ?? 1;
  hitEnemy(w, hit, { dmg: k.dmg, by: 'stone', owner: k.owner, from: { x: k.px, y: k.py }, kb: 40, el: 'earth', stun: face ? S.face.stun : S.stun[tier], vsElite: face ? S.face.mul : undefined }, ev);
  // 碎石溅到身边的
  for (const e of w.enemies)
    if (e !== hit && e.hp > 0 && d2(e, hit) <= (S.splash.r + ENEMIES[e.kind].radius) ** 2) hitEnemy(w, e, { dmg: k.dmg * S.splash.mul, by: 'stone', owner: k.owner, from: hit, kb: 30, el: 'earth' }, ev);
  // 仙品「五光」：碎成五色光，弹向身边几只
  if (tier >= 3) {
    const keep = inReach(p);
    const others = w.enemies
      .filter((e) => e.hp > 0 && e !== hit && d2(e, hit) <= S.shard.hop * S.shard.hop && keep(e))
      .sort((a, b) => d2(a, hit) - d2(b, hit))
      .slice(0, S.shard.n);
    others.forEach((e, i) => {
      const a = Math.atan2(e.y - hit.y, e.x - hit.x);
      w.knives.push({ id: w.nextId++, owner: k.owner, x: hit.x, y: hit.y, px: hit.x, py: hit.y, vx: Math.cos(a) * S.shard.speed, vy: Math.sin(a) * S.shard.speed, target: e.id, hitsLeft: 1, hit: new Set(), dmg: k.dmg * S.shard.dmg, life: S.shard.life, tier, kind: 'wuguang', shard: true, color: ((k.color ?? 0) + 1 + i * 2) % 5 });
    });
  }
  return true;
}

/** 五色光：追自己的那一只，到了就打一下（不再碎）；那只先死了就散。 */
function stepShard(w: World, k: Knife, dt: number, ev: SimEvent[]): boolean {
  const S = TUNE2.wuguang.shard;
  k.px = k.x;
  k.py = k.y;
  k.life -= dt;
  if (k.life <= 0) return true;
  const t = w.enemies.find((e) => e.id === k.target && e.hp > 0);
  if (!t) return true;
  const dx = t.x - k.x;
  const dy = t.y - k.y;
  const d = Math.hypot(dx, dy) || 1;
  const step = S.speed * dt;
  if (d <= step + 4) {
    hitEnemy(w, t, { dmg: k.dmg, by: 'stone', owner: k.owner, from: { x: k.x, y: k.y }, el: 'earth', stun: S.stun }, ev);
    return true;
  }
  k.vx = (dx / d) * S.speed;
  k.vy = (dy / d) * S.speed;
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  return false;
}
