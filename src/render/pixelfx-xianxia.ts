// pixelfx 的「修仙版」预设（用户 2026-11-10：要符合修仙风格，必要时做适当改造）。
//
// 规矩：
// 1. 颜色只用游戏的调色板（src/art/palette.ts 的传统色），按「暗 → 亮」排成色阶，替换库的原配色。
// 2. 辉光（light）压低：用户不要人物和武器身上的发光圆圈 / 光晕，所以 light 默认 0.35，最多 0.6。
// 3. 带「光圈」的效果（魔法阵圈、圣光环、冲击波圆环）不直接用：要么换成别的效果，要么复制到 vendor/pixelfx/src/fx/xianxia/ 改掉再用
//    （例：xianxia/tianlei 是 lightning/lightning-strike 去掉地面法阵圈、换成黄符的版本）。
// 4. 题材要修仙玄幻：雷是五雷 / 天雷（金白、紫青），火是三昧真火（朱砂到缃色），魂是天青的灵气，烟是云气，不要西式的圣光、符文魔法阵。
import { PALETTE } from '../art/palette.ts';
import type { FxOptions } from '../../vendor/pixelfx/src/core/index.js';
import type { FxId } from './pixelfx.ts';

/** 用调色板字符拼一条色阶（暗 → 亮），如 ramp('kRreoyYf')。 */
export const ramp = (chars: string) => [...chars].map((c) => {
  const hex = PALETTE[c];
  if (!hex) throw new Error(`调色板里没有「${c}」`);
  return hex;
});

/** 常用的修仙色阶。 */
export const XRAMP = {
  /** 三昧真火：玄 → 殷 → 朱 → 朱砂 → 橘 → 藤黄 → 缃 → 灵光 → 白 */
  fire: ramp('kRreoyYfW'),
  /** 天雷（金白）：靛 → 黛蓝 → 琥珀 → 藤黄 → 缃 → 灵光 → 白 */
  thunder: ramp('NnbyYfW'),
  /** 天雷（青白）：靛 → 黛蓝 → 石青 → 天青 → 缃 → 灵光 → 白 */
  thunderTeal: ramp('NncCYfW'),
  /** 五雷（紫青）：紫棠 → 胭脂紫 → 桃红 → 天青 → 灵光 → 白 */
  thunderViolet: ramp('PpmCfW'),
  /** 寒冰：靛 → 黛蓝 → 石青 → 天青 → 月白 → 白 */
  ice: ramp('NncCwW'),
  /** 灵气（魂光）：同寒冰，但收在月白，不到纯白 */
  spirit: ramp('NncCw'),
  /** 金光（法宝、宝匣）：赭 → 琥珀 → 藤黄 → 缃 → 灵光 → 白 */
  gold: ramp('BbyYfW'),
  /** 魔气（魔化哪吒、魔物）：玄 → 紫棠 → 胭脂紫 → 殷 → 朱砂 */
  demon: ramp('kPpRe'),
  /** 尘土（落地、砸印）：玄 → 赭 → 檀 → 琥珀 → 银鼠 → 缟 */
  dust: ramp('kBSbij'),
  /** 草木（木行）：墨绿 → 松 → 石绿 → 葱黄 → 灵光 */
  wood: ramp('GvlLf'),
  /** 云气 / 烟：玄 → 乌 → 黛 → 苍 → 银鼠 → 缟 → 月白 */
  cloud: ramp('kdghijw'),
  /** 血：玄 → 殷 → 朱 → 朱砂 */
  blood: ramp('kRre'),
  /** 桃花：胭脂紫 → 桃红 → 月白 */
  peach: ramp('pmw'),
};

/** 火花的色阶（和上面相反，是「头 → 尾」：最亮的在前）。 */
export const XSPARK = {
  /** 雷火花：白 → 灵光 → 缃 → 天青 */
  thunder: ramp('WfYC'),
  /** 火星：白 → 缃 → 藤黄 → 朱砂 */
  fire: ramp('WYye'),
  /** 金铁的火星（命中、暴击）：白 → 缃 → 藤黄 → 琥珀，不带朱红（朱红留给火行和血） */
  gold: ramp('WYyb'),
};

/** 默认的辉光强度（压低，避免光晕）。 */
export const LIGHT = 0.35;

export interface XianxiaFx {
  /** 库里的特效 id，或者我们改造过的 'xianxia/<名字>'。 */
  id: FxId;
  /** 换过颜色、压过辉光的选项（不含位置）。 */
  opts: FxOptions;
  /** 一句话说明它在游戏里干什么、改了什么。 */
  note: string;
}

/**
 * 修仙版预设（第一批，2026-11-10）。名字是游戏里的用途，值是用哪个特效、怎么改；按 docs/pixelfx-presets.md 的编号排。
 * 画布大小、实际占地、时长、预烘焙还是现场画见那份文档（node tools/pixelfx.mjs stats 量显存）。
 * 用法：layer.playId(X.thunder.id, { ...X.thunder.opts, x, y })，或 layer.playBaked('thunder', X.thunder.id, X.thunder.opts, { x, y })。
 */
export const XFX: Record<string, XianxiaFx> = {
  // 1 命中火星、2 暴击
  hitSpark: {
    id: 'xianxia/hit-spark',
    opts: { palette: XRAMP.gold, sparks: XSPARK.gold, light: LIGHT },
    note: '命中火星（一般命中、金铁交击）：改自 impacts/hit-spark——缩到约 20 像素宽（原作 35）、星芒四道不摆十字、白 2 帧再冷下去收短、顺着这一下留一道余光，火星是金色不带朱红，辉光只留一盏半径 8 的',
  },
  critHit: {
    id: 'xianxia/crit-hit',
    opts: { palette: ramp('BbeoyYfW'), sparks: XSPARK.gold, light: LIGHT },
    note: '暴击：改自 impacts/crit-hit——去掉碎成几段的冲击波圆环和十字镜头光，换成斜着划过的一道金线（剑痕）；星芒缩到约 20 像素（原作 130 宽），白的两帧描朱砂边，冷下去只走金色（原作落定后是一大块朱砂橘色的实心星），金屑翻落、闪几粒小星，0.9 秒',
  },
  // 3 回响兵魂散
  soulScatter: {
    id: 'xianxia/soul-scatter',
    opts: { palette: ramp('NnccCCw'), light: LIGHT },
    note: '回响兵魂散：改自 spawn/soul-rise——敌人的剪影白两帧、化成半透明的天青魂影上飘 22 像素、腿化成一缕烟，再从脚往上软软地淡掉，散成几团淡灵气和单像素光点（去掉地上的光环、脚下的光和两盏大灯）。要传 actor（敌人的剪影），按敌人种类各烘一份',
  },
  // 4 灼烧
  burning: {
    id: 'xianxia/burning',
    opts: { palette: XRAMP.fire, smoke: PALETTE.h, body: [12, 22], light: LIGHT },
    note: '灼烧（火行印记、三昧真火），循环 1.2 秒：改自 status/burning——不碰人物本身（原作每 0.6 秒整身刷白），只画头侧、肩、腰三处小火苗、上飘的火星和三缕很淡的烟；芯子平时是灵光、跳伤害的那一下窜高变白；去掉脚下的暖光。按身体宽高摆（body，精英给 [16, 30]），一种体型一份',
  },
  // 4b 风火轮的火痕（功法，2026-11-12）
  wheelEmber: {
    id: 'xianxia/wheel-ember',
    opts: { palette: ramp('kRreoy'), smoke: PALETTE.h, light: LIGHT },
    note: '风火轮的火痕（一处），3.4 秒、约 12×14 像素：参照 status/burning、fire/campfire 新做——地上烫出一点红，一小簇火舌往身后歪着窜起、一跳一跳地矮下去，两三粒火星被风往身后卷，炭由橘转朱转殷、一粒粒灭，一缕很淡的烟斜着散；只用朱砂到殷红，不出亮黄。游戏每走十来像素放一处、断续地连成火痕，往左走时 flip；seed 烘几份轮着用',
  },
  // 4c 五色神光、紫气东来（功法，2026-11-12）
  wuqiBurst: {
    id: 'xianxia/wuqi-burst',
    opts: { reach: 40, light: LIGHT },
    note: '五色神光，1.1 秒：新做——敌人身上先凝一点灵光，金木水火土五色之气朝五个方向迸出、各拖一道由亮到暗的软尾、往同一个方向打旋，走到头放慢上飘、化成同色的光点；不画圆环，中心的光半径 6',
  },
  ziqi: {
    id: 'xianxia/ziqi',
    opts: { light: LIGHT },
    note: '紫气东来，1.6 秒：新做——右上方浮出一缕淡紫云气，拖成一条半透明的带子（头桃红、身胭脂紫、尾紫棠）弯一下收进人物腰间，收进去的地方冒起几粒缃色光点上飘；只从一侧收进去，不绕身一圈',
  },
  // 5 冻结、减速
  frozen: {
    id: 'xianxia/frozen',
    opts: { palette: XRAMP.ice, body: [12, 22], light: LIGHT },
    note: '冻结（水行、寒冰幡、寒冰诀、凝霜），循环 2 秒：参照 status/frozen 重做——不重画人物，按身体宽高在外面封一簇半透明的冰（晶体折线的轮廓、顶上一高一矮两个尖，不是圆顶直边的「玻璃钟」），脚下六出霜花、两根冰棱，隔一会儿扫过一道亮光、棱角闪小星；去掉脚下的冷光',
  },
  chilled: {
    id: 'xianxia/chilled',
    opts: { palette: XRAMP.ice, body: [12, 22], light: LIGHT },
    note: '减速（寒气缠足：水行减速、阴阳镜、寒气蔓延），循环 2.4 秒：改自 status/slowed——去掉脑后的钟面和圆环、身上的冷色薄膜，改成脚下霜花、脚踝两根小冰棱、脚两边很淡的寒气、慢慢上冒的冰屑和两片小雪花；和 frozen 一家（减速只冻脚，冻结整个人封进冰里）',
  },
  // 6 砸地
  sealSlam: {
    id: 'xianxia/seal-slam',
    opts: { palette: ramp('BbyYYfW'), sparks: ramp('Yyoe'), reach: 28, light: LIGHT },
    note: '番天印落地（砸地），2.2 秒：改自 impacts/ground-slam——去掉贴地的亮环和两道立着的激波；侧视改俯视：五道长短不匀的裂纹（缝里先透土黄的光、往外变细，收尾时从尖上合回去）、一圈浅暖灰的尘从四周推开（中间留空给大印）、碎石崩起落在远近不同处；reach 给印的半径',
  },
  // 7 刀光、剑气
  bloodSlash: {
    id: 'xianxia/blade-arc',
    opts: { palette: ramp('kRremw'), sparks: ramp('Wmer'), radius: 40, arc: 1, width: 9, height: 10, aim: 0, light: LIGHT },
    note: '化血神刀的月牙血光斩，0.75 秒：改自 melee/sword-slash——月牙改成地面上以人物为圆心的一段弧（aim 朝向、arc 半张角、radius 半径都是选项，和扇面判定对得上），扫过 0.08 秒、停 0.1 秒、拖 0.32 秒，走过的地方留一道真半透明的淡残影（原来抖成一串零星的点）；殷朱色身、月白刃口。朝向任意，现场画或按 8 个方向各烘一份',
  },
  swordCut: {
    id: 'xianxia/blade-arc',
    opts: { palette: XRAMP.gold, sparks: XSPARK.gold, mid: 1, radius: 64, arc: 0.24, width: 3.2, height: 10, sy: 1, aim: -Math.PI / 2, light: LIGHT },
    note: '斩仙飞刀穿过敌人的那一刀：同一个 blade-arc 的细长版（mid: 1 让刀光的中点落在敌人身上，半径大、张角小，几乎是一道直的金光，带一道贴着的回声），0.4 秒收完、火星按弧长少溅；刀光沿 aim + 90° 走（aim = 飞刀朝向 − 90°）',
  },
  // 8 雷法
  zapHit: {
    id: 'xianxia/zap-hit',
    opts: { palette: XRAMP.ice, light: LIGHT },
    note: '雷法击中（雷公鞭连锁的每一跳，青白，和游戏里 azure 的雷同色），0.7 秒：改自 lightning/zap-hit——缩到约六成（命中点约 16 像素，雷纹爬到 30 像素内），不画劈进来的电弧（游戏自己画雷），雷纹冷到底色就从命中点往外熄（原作冷成深紫、抖着淡掉），去掉灰色的臭氧烟',
  },
  zapHitGold: { id: 'xianxia/zap-hit', opts: { palette: XRAMP.gold, light: LIGHT }, note: '雷法击中的金白版（雌雄双鞭的雌鞭、五雷正法），同 zapHit' },
  zapHitViolet: { id: 'xianxia/zap-hit', opts: { palette: ramp('PpmwW'), light: LIGHT }, note: '雷法击中的紫版（器灵「五雷轰顶」），同 zapHit' },
  thunderDrop: {
    id: 'xianxia/thunder-drop',
    opts: { palette: XRAMP.gold, sparks: XSPARK.gold, light: LIGHT },
    note: '小天雷（五雷正法每 6 秒那一道、雷公鞭的雷印延时落雷），1.5 秒：天雷符的小号——不立黄符，头顶两团半透明的云气合拢、闪两下，雷从 46 像素高处两次闪击落下，雷道从上往下碎掉，落点小焦痕、贴地电弧、火星；画布 96×88（天雷符 240×264）',
  },
  thunderDropAzure: { id: 'xianxia/thunder-drop', opts: { palette: XRAMP.ice, sparks: ramp('WwCc'), light: LIGHT }, note: '小天雷的青白版（雷公鞭的雷印），同 thunderDrop' },
  // 9 开宝匣
  chestOpen: {
    id: 'xianxia/chest-burst',
    opts: { palette: XRAMP.gold, mouth: 10, width: 13, loot: 5, light: LIGHT },
    note: '开乾坤宝匣，1.8 秒：参照 pickups/chest-open 重做——不画匣子（游戏的宝匣有自己的精灵和开盖帧，叠在它上面放，原点是宝匣底边正中），去掉九道光柱、地上的光和收集时的圆环；匣口金白一闪，涌出一团金色光雾，两侧升起两缕卷头的瑞气，五枚元宝和灵石划弧落在两边、闪一下化成金尘',
  },
  // 10 拾取
  stonePickup: {
    id: 'xianxia/stone-pickup',
    opts: { palette: XRAMP.spirit, light: LIGHT },
    note: '拾灵石，0.45 秒、不超过 16 像素：参照 pickups/collect-burst 新做——原作的大白光、十字光、两圈弹开的圆环都不要（一波要捡几十上百颗）；灵石并进人物胸口那一点白一下（天青描边的小菱形），五粒头亮尾暗的小光点迸开、往上飘着化掉',
  },
  peachHeal: {
    id: 'xianxia/peach-heal',
    opts: { palette: ramp('pmwf'), height: 22, light: LIGHT },
    note: '吃蟠桃回血，1 秒、约 32×24 像素：参照 pickups/heart-pickup、nature/healing-bloom 新做——不要西式红心、扩散的细环和回血的十字；一团很淡的桃红软光从身上化开，九片三像素的桃花瓣迸出、翻着往两边飘落，十来缕灵光细光贴着身子两侧往上升。原点在人物脚下',
  },
  talismanGather: {
    id: 'xianxia/talisman-gather',
    opts: { palette: ramp('NncCwW'), ember: ramp('reyY'), ash: ramp('hi'), reach: 28, light: LIGHT },
    note: '拾到聚灵符（把场上的灵石吸过来），1.2 秒：新做——符纸烧成灰游戏自己画；这里是四周八道天青短线朝符收拢（越近越快），收到时符上白一下、迸几粒火星，火星和两像素的纸灰往上飘。不画圆环、法阵',
  },
  // 11 木行
  thornSting: {
    id: 'xianxia/thorn-sting',
    opts: { palette: ramp('GGvvllLf'), leaf: ramp('GvlL'), height: 15, light: LIGHT },
    note: '木行荆棘（青莲宝色旗：敌人进结界被刺一下），0.9 秒：改自 nature/thorns——侧视一排六根 48 像素高的褐色硬木刺改成一只敌人脚下前后错开的三根青藤刺（最高 15 像素），白一帧、过冲，根上翻两片小叶、迸草屑，停一会儿缩回去；去掉地上发绿光的裂缝、烟尘和石块',
  },
  // 12 减益
  stunSeal: {
    id: 'xianxia/stun-seal',
    opts: { palette: XRAMP.gold, ink: ramp('Rr'), body: [12, 22], light: LIGHT },
    note: '眩晕（番天印晕眩、打神鞭「打神」镇住、定身），循环 1.2 秒：参照 status/stunned 重做——不要头顶的发光轨道环、不晃人物；额头贴一张 3×7 的小黄符（朱砂三笔，下半截随风摆），头顶三粒小金星沿看不见的压扁轨道慢慢转。side 给 -1 时符偏到另一边。按身体宽高摆',
  },
  armorBreak: {
    id: 'xianxia/armor-break',
    opts: { palette: ramp('khijwW'), armor: ramp('kghij'), height: 11, light: LIGHT },
    note: '破甲（土生金「淬锋」、哮天犬破甲、易伤），一次性 0.8 秒：新做（原作的「诅咒」是头顶转的紫色符文圈，不要）——胸口裂开一道折线（白两帧、冷下去、从两头收），六片有明暗的甲片崩出来翻着落地、弹一下、抖掉，裂口上闪一粒小星',
  },
  // 相生（2026-11-12 fxpolish 新做：原来是十几粒一像素的火星和一圈方块火苗）
  reactFrost: { id: 'xianxia/xiangsheng', opts: { kind: 'frost', height: 11, r: 0, light: LIGHT }, note: '凝霜（金生水），一次性约 1 秒：胸口一点白，脚边长出四根冰棱、雪花迸开，冰棱停一下碎成冰屑落地，地上一层很淡的霜花' },
  reactConduct: { id: 'xianxia/xiangsheng', opts: { kind: 'conduct', height: 11, r: 0, light: LIGHT }, note: '导雷（水生木）：身上缠两三圈青绿的细电弧（每帧重劈）、几粒电火花；往别处跳的雷照旧由 fx.ts 画' },
  reactIgnite: { id: 'xianxia/xiangsheng', opts: { kind: 'ignite', height: 11, r: 34, light: LIGHT }, note: '引燃（木生火）：几片青叶卷出去、半路着火烧成灰，火顺着地面往外窜出六道（到引燃的半径 34），身上腾起一团三昧真火' },
  reactLava: { id: 'xianxia/xiangsheng', opts: { kind: 'lava', height: 11, r: 26, light: LIGHT }, note: '熔岩（火生土）：脚下裂开几道赤红的缝、慢慢冷成赭黑，熔滴溅出去落地冒烟，一团土黄的尘' },
  reactPierce: { id: 'xianxia/xiangsheng', opts: { kind: 'pierce', height: 11, r: 0, light: LIGHT }, note: '淬锋（土生金）：一道斜的金锋从胸口划过、几粒金火星；叠在破甲 armorBreak 上' },
  blaze: { id: 'xianxia/xiangsheng', opts: { kind: 'blaze', height: 11, r: 26, light: LIGHT }, note: '燎原（火行三件，烧着的敌人倒下时炸开，半径 26）：脚下一团大火和焦痕，七团火划弧抛出去、落地烧成小火苗，火星和烟上飘（原来是一圈方块火苗和十几粒火星）' },
  blazeBig: { id: 'xianxia/xiangsheng', opts: { kind: 'blaze', height: 11, r: 32, light: LIGHT }, note: '焚天（火行四件，半径 32）：同燎原，抛得更远' },
  // 灵物打中（2026-11-12 fxpolish 新做，relic-fx.ts 用）
  stormHit: { id: 'xianxia/relic-hits', opts: { kind: 'storm', height: 11, light: LIGHT }, note: '风雷羽：头顶浮出一枚紫翎，一道紫白的雷从翎尖劈到胸口、胸口一小团细电弧，紫翎打着旋飘落，0.9 秒（原来是一道小雷精灵和一团桃红的雷纹）' },
  jadeDragon: { id: 'xianxia/relic-hits', opts: { kind: 'jade', height: 11, light: LIGHT }, note: '九龙玉佩：一缕玉色的龙气从敌人身上盘旋升起（龙首亮、身子一节节、尾巴散成玉屑），0.9 秒' },
  zhuoLand: { id: 'xianxia/relic-hits', opts: { kind: 'zhuo', height: 11, light: LIGHT }, note: '金刚琢砸中：一点金白星芒，石屑崩起落地、一小团尘、几粒金屑上飘，0.7 秒' },
  talismanBurn: { id: 'xianxia/relic-charm', opts: { kind: 'talisman', lift: 37, light: LIGHT }, note: '黄符化去（定身符、引雷符，人物头顶）：符纸飘下停住，朱砂符文一笔一笔亮起，火从下往上把符纸吃掉，纸灰火星上飘，约 0.9 秒' },
  talismanBurnLow: { id: 'xianxia/relic-charm', opts: { kind: 'talisman', lift: 20, light: LIGHT }, note: '黄符化去（招宝符，人物腰间）' },
  guBite: { id: 'xianxia/relic-charm', opts: { kind: 'gu', light: LIGHT }, note: '噬心蛊：紫黑的小蛊虫绕胸口一圈、扎进去，几滴血气被吸走，蛊虫飞远（原来是一团盖在人物身上的魔气）' },
  incenseCurl: { id: 'xianxia/relic-charm', opts: { kind: 'incense', light: LIGHT }, note: '燃魂香：脚边一炷香，一缕紫灰的烟弯弯曲曲升起、慢慢散，几粒火星' },
  umbrellaOpen: { id: 'xianxia/relic-charm', opts: { kind: 'umbrella', light: LIGHT }, note: '混元伞：头顶的伞由合到开，鬼火打在伞面上碎成墨紫的烟顺着伞沿溅开，伞再合上淡掉' },
  drumBeat: { id: 'xianxia/relic-charm', opts: { kind: 'drum', light: LIGHT }, note: '夔牛鼓：擂两通，肩两侧各一道弯的声纹往外推开，脚下震起尘，肩头火星' },
  // 13 魔气
  demonQi: {
    id: 'xianxia/demon-qi',
    opts: { palette: ramp('kPpm'), spark: ramp('Rem'), body: [12, 24], light: LIGHT },
    note: '魔气缠身（魔化哪吒、魔物），循环 1.6 秒：参照 shadow/shadow-flames、status/burning 新做——不是地上的篝火和 90 像素的烟柱，而是肩、背、后脑四处「黑焰」火舌（外沿胭脂紫、身紫棠、芯玄色，和三昧真火反过来），隔一会儿窜高，尖上冒紫黑软团、朱砂火星。朝左的敌人放的时候 flip（火在后脑勺，不挡脸）',
  },
  // 14 突破
  breakthrough: {
    id: 'xianxia/lotus-ascend',
    opts: { palette: XRAMP.gold, cloud: ramp('jwY'), petals: 8, size: 8, height: 32, light: LIGHT },
    note: '升级 / 悟功法（修仙的「突破」），2 秒、约 30×40 像素：参照 ui/level-up 重做——不要光柱升天、往上套的光环和弹出的字；脚下一朵八瓣金莲由合到开（俯视的碗形，远瓣翘得高，每瓣自带琥珀边），开到一半一道细金线顺着身子冲到头顶化成灵光，两侧淡金云气贴地翻开，最后一瓣瓣化成金光点上飘',
  },
  // 15 换章转场
  chapterClouds: {
    id: 'xianxia/cloud-curtain',
    opts: { palette: ramp('ijwW'), light: LIGHT },
    note: '换章转场（480×270 整屏），2.4 秒：参照 transitions/burn-away、pixel-dissolve 新做——库里的转场都把画面盖黑、而且是 320×180；这里两岸云海从左右翻涌合拢（云头是一串受光、压影的圆卷云，云身里一层压一层的卷云纹），合拢后整屏月白（换章标题由游戏写在上面），0.95–1.4 秒停住，再从中间散开。整屏的效果，现场画（每帧约 3 毫秒），不预烘焙',
  },
  // 16 氛围
  ambientPetals: {
    id: 'xianxia/ambient',
    opts: { kind: 'petal', palette: ramp('pmw'), count: 40, light: LIGHT },
    note: '氛围：第一章的桃花（480×270 镜头坐标的一层，循环 10 秒）：参照 weather/cherry-blossoms 新做——去掉自带的半透明天色和底边那条「地面」上堆着的花瓣；四十片 3×2 的桃花瓣斜着往下飘、翻面（正桃红、背月白）、左右摆。很淡、现场画（每帧约 0.02 毫秒）',
  },
  ambientSand: {
    id: 'xianxia/ambient',
    opts: { kind: 'sand', palette: ramp('Bby'), count: 46, light: LIGHT },
    note: '氛围：第二章西岐城外的黄沙（同上一层、循环 10 秒）：细沙成股横着刮过去（近的拉成三像素一道），几片边缘软掉的淡沙幕跟着风走。每帧约 0.8 毫秒',
  },
  ambientMist: {
    id: 'xianxia/ambient',
    opts: { kind: 'mist', palette: ramp('ijw'), light: LIGHT },
    note: '氛围：第三章界牌关的夜雾（同上一层、循环 10 秒）：参照 weather/fog——两层很淡的雾带慢慢横移、一明一暗，几道细雾丝滑过；没有月亮和天色。每帧约 2 毫秒（可以隔帧更新）',
  },
  // 17 定风珠的旋风（2026-11-11，分支 dingfeng；用户：「定风珠有旋风就行……pixelfx 就有很好的旋风效果，为什么不用？」
  // 「不容易做到美观可以适当加大一点尺寸，一定要精致」）。
  // 游戏里（fx-new.ts 的 WhirlView）分两层画（opts 加 part: 'back' | 'front' 和 split、wrap）：稳定转着的那一段预烘焙，长出来、吹散、缩回珠子里现场画（ctl）。
  whirlwind: {
    id: 'xianxia/whirlwind',
    opts: { palette: ramp('GvvlLwwW'), dust: ramp('hijjw'), leaves: ramp('GvlL'), stone: ramp('dghijjw'), height: 34, width: 1, debris: 7, light: LIGHT },
    note: '定风珠的旋风（凡品，青白的风），循环 1.6 秒、画布 96×72：改自 nature/tornado——漏斗高 112 缩到 34（脚半径约 3、腰约 6、顶约 13），挂在定风珠下面（顶不摆、往下蛇行）；柱身画实（原作半透明的一柱加 58 条细线，缩小了在浅色地面上看不见）：左边受光青白、右边背光深青、一行行错着转的风纹、外沿压深边，顶上看得见漏斗口；十几条 1 像素的风带头亮尾淡、往上转；叶子碎石 24 → 7、从 14–22 像素外贴地卷进来；脚下扬尘收在 17 像素内；去掉罩着漏斗的淡光、脚下的冷光和贴地扫过的弧线',
  },
  whirlwindLing: {
    id: 'xianxia/whirlwind',
    opts: { palette: ramp('GvvlLwwW'), dust: ramp('hijjw'), leaves: ramp('GvlL'), stone: ramp('dghijjw'), height: 37, width: 1.06, debris: 10, light: LIGHT },
    note: '定风珠的旋风（灵品）：同 whirlwind，更高（37）、更宽（顶约 15、腰约 7）、风带和卷的叶子碎石更多',
  },
  whirlwindXian: {
    id: 'xianxia/whirlwind',
    opts: { palette: ramp('GGvvlLLw'), dust: ramp('hijjw'), leaves: ramp('GvlL'), stone: ramp('dghijjw'), height: 40, width: 1.12, debris: 13, light: LIGHT },
    note: '定风珠的旋风（仙品「定风」，青风）：同 whirlwind，再高再宽（40，顶约 17、腰约 8、脚约 3.6）、风是更浓的木行青绿',
  },
  whirlwindStorm: {
    id: 'xianxia/whirlwind',
    opts: { palette: ramp('GGvvlLLw'), dust: ramp('hijjw'), leaves: ramp('GvlL'), stone: ramp('dghijjw'), cloud: ramp('kdNncijw'), bolt: ramp('YfW'), height: 35, width: 1.14, debris: 13, storm: 1, light: LIGHT },
    note: '定风珠的旋风（器灵「风雷」）：仙品的青风（35 高，让出顶上的云），口上压一团乌云——十几团灰青的软云绕着转（原作一层压扁的云带缩小了像个灰盖子），一圈里从里面闪两下淡金的电（光收到半径 9）；游戏的连跳雷（也是淡金）从这团云里劈下来',
  },
  whirlwindCalm: {
    id: 'xianxia/whirlwind',
    opts: { palette: ramp('NNnccCCw'), dust: ramp('hijjw'), leaves: ramp('GvlL'), stone: ramp('dghijjw'), height: 40, width: 1.12, debris: 13, light: LIGHT },
    note: '定风珠的旋风（器灵「定海」，天青的风，和定身的云头风纹同色）：同 whirlwindXian；收招时游戏让它缩回定风珠里（ctl.sink）',
  },
  // 接入时就有的改造样例：天雷符（2026-11-11 起颜色全部收进调色板）。
  // 另外两个只换选项的旧样例 2026-11-11 删掉了：fireTorch（fire/torch 换色，带一根火把杆、约七成像素不在调色板里，游戏里没有用处）、
  // soulPoof（spawn/poof 换色，开头一团白光晕、之后一大团天青烟比回响兵大一倍；魂散用 soulScatter）。
  thunder: { id: 'xianxia/tianlei', opts: { palette: XRAMP.thunder, sparks: XSPARK.thunder, light: LIGHT }, note: '天雷符：黄符立地、金白天雷劈下（改自 lightning-strike：去掉地面法阵圈、辉光收小，颜色收进调色板）' },
  thunderTeal: { id: 'xianxia/tianlei', opts: { palette: XRAMP.thunderTeal, sparks: XSPARK.thunder, light: LIGHT }, note: '天雷符的青白版' },
};
