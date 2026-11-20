// 波间界面（进化 / 升级 / 万宝阁）用的像素图标：法宝、灵物、丹药、符箓、宠物、属性，外加界面上的小装饰。
// 全部按调色板字符手绘（字符表见 ../palette.ts），图标统一 16×16：内容画在 14×14 以内，外圈自动补一圈玄色描边。
// 碎片、器灵由法宝图标派生（碎片：只留图标的一角、断口描边；器灵：叠一层灵纹）。纯数据，不依赖 DOM。
import { BISHUI_ICONS, YOULONG_ICON } from './bishui.ts';
import { compose, grid, outline, type Grid } from '../pixel.ts';
import type { CharmId, Element, ElixirId, PetBranch, PetKind, RelicId, WeaponKind } from '../../sim/types.ts';
import { HOUND_ICONS, SANJIAN_ICON } from './hero-icons.ts';
import { DINGHAI_ICON, TIGER_ICONS } from './zhao-icons.ts';
import { FULONG_ICON, HEIYAN_ICON, QIANKUNTU_ICON } from './echo-icons.ts';
import { JINDOU_ICON, LUAN_ICONS } from './yunxiao-icons.ts';
import { HUANGJIN_ICON, PENG_ICONS } from './leizhenzi-icons.ts';
import { JINGU_ICON, MONKEY_ICONS } from './wukong-icons.ts';

/**
 * 一个 16×16 图标：rows 是内容（不超过 14×14，居中放），外圈描玄色边；
 * accent 是描边之后再叠上去的点缀（火星、灵光、拖尾），不描边，免得单个像素被描成小方块。
 */
function icon(rows: string[], accent?: string[]): Grid {
  const g = grid(rows);
  const x = 1 + ((14 - g.w) >> 1);
  const y = 1 + ((14 - g.h) >> 1);
  const base = outline(compose(16, 16, [{ g, x, y }]), 'k');
  if (!accent) return base;
  return compose(16, 16, [
    { g: base, x: 0, y: 0 },
    { g: grid(accent), x: 0, y: 0 },
  ]);
}

/** 把模板里的 1..4 换成具体颜色（同一个底子按物品换色）。 */
const recolor = (rows: string[], map: Record<string, string>) => rows.map((r) => r.replace(/[1-4]/g, (c) => map[c]));

// ---------------------------------------------------------------- 法宝

const QIANKUN = icon([
  '....YYYYyy....',
  '...YfYYYyyy...',
  '..YYyyBByyyb..',
  '.YYyyB..byyyb.',
  'YYyB......yybb',
  'YyyB......yybb',
  'YyB........Ybb',
  'yyB........Ybb',
  'yyby......YybB',
  'byyy......yybB',
  '.byyyY..YyybB.',
  '..bbyyYYybBB..',
  '...BbbbbbBB...',
  '....BBBBBB....',
]);

const HUOJIAN = icon([
  '..........e.Yf',
  '..........eoYo',
  '........e.oYo.',
  '........eeoe.e',
  '.......byor...',
  '......eeYy.e..',
  '.....eiheb....',
  '....riheer....',
  '....iherr.....',
  '...ih.rR......',
  '..ih..R.......',
  '.ih...........',
  'ih............',
  'y.............',
]);

const JIULONG = icon([
  '......Yf......',
  '.....YffY.....',
  '......yb......',
  '....bYYYyb....',
  '...bYyyyyyb...',
  '..bYyyByyyyb..',
  '..bYyyByyyBb..',
  '.bYyyyByyyBbB.',
  '.bYyyyByyyBbB.',
  '.byyyyByyyBbB.',
  'rYrYrYrYrYrYrR',
  '.eoYoeoYoeoYe.',
  '..o.e.Y.o.e...',
  '...o...e...o..',
]);

const LEIGONG = icon([
  '....f........l',
  '...fY......lv.',
  '..fY......Lv..',
  '..Yff....lvv..',
  '...Yf...Lv....',
  '..Yf...lvv....',
  '..f...Lv......',
  '.....lvv......',
  '....Lv........',
  '...yyv........',
  '..ery.........',
  '.er...........',
  'er............',
  'y.............',
]);

const FANTIAN = icon([
  '.....yYYy.....',
  '....yYyyyb....',
  '...yYyyybbB...',
  '.....bbbB.....',
  '..YYYYYYYYYb..',
  '..YyyyyyyyyB..',
  '..YyyyyyyyyB..',
  '..ybyyyyyybB..',
  '..ybbbbbbbbB..',
  '.rrrrrrrrrrrR.',
  '.reYeYYYeYerR.',
  '.reYYeYeYYerR.',
  '..RRRRRRRRRR..',
]);

const XINGHUANG = icon([
  '.Y............',
  '.yb...........',
  '.BYYYYYYyy....',
  '.ByyyyyyyyyY..',
  '.ByeeyeeyyyyY.',
  '.ByyyyyyyyyyyY',
  '.ByeeyeeyyyyY.',
  '.ByyyyyyyyyY..',
  '.ByeeyeeyyY...',
  '.Bbyyyyybyy...',
  '.Be.b.e..e....',
  '.b............',
  '.B............',
  '.B............',
]);

const ZHANXIAN = icon(
  [
    '............WW',
    '...........Wwj',
    '..........Wwj.',
    '.........Wwj..',
    '........Wwi...',
    '.......Wwi....',
    '.....bywi.....',
    '.....eYy......',
    '....er.b......',
    '...yr.........',
    '..eYb.........',
    '.re...........',
    '.e............',
    'r.............',
  ],
  ['................', '................', '................', '................', '................', '....j...........', '...j............', '................', '...........j....', '..........j.....'],
);

const HANBING = icon([
  '.C............',
  'jCjjjjjjjjjC..',
  '.i.ncccccccn..',
  '.i.nCCCCCCCn..',
  '.i.nCCwCwCCn..',
  '.i.nCCCWCCCn..',
  '.i.nCCwCwCCn..',
  '.i.nCCCCCCCn..',
  '.i.ncCCCCCcn..',
  '.i.nccCCCccn..',
  '.i.n.ncCcn.n..',
  '.i.c.n.c.n.c..',
  '.i............',
  '.j............',
]);

// 剩下 8 件公共法宝的图标（和上面 8 件同一种画法：粗轮廓、受光面亮、暗面压一档，icon() 再描一圈玄色边）
// 打神鞭：右上到左下斜放的竹节金鞭，三道深色的节，两节之间一点朱砂符印；左下是金护手、缠红的鞭柄和一缕穗子
const DASHEN = icon([
  '............fY',
  '...........fyb',
  '..........bBB.',
  '.........fYb..',
  '........Yeb...',
  '.......bBB....',
  '......fYb.....',
  '.....Yeb......',
  '....bBB.......',
  '..yfYb........',
  '...erR........',
  '..erR.........',
  '.YrR..........',
  'eYe...........',
]);
// 化血神刀：一柄微弯的乌钢刀，刃口一道血光（越往刀尖越亮），刀尖滴着两滴血；金吞口、缠红的刀柄
const HUAXUE = icon([
  '............Wo',
  '...........jWe',
  '..........hdoe',
  '.........hdoe.',
  '........hdoe..',
  '.......hdoe...',
  '......hdoeR...',
  '.....hdoeR....',
  '....hdoR...e..',
  '..YyYeR....R..',
  '..ybR.........',
  '.rR.....e.....',
  'rR......R.....',
  'e.............',
]);
// 定风珠：一颗淡青玉色的珠子（左上亮、右下暗），两道青白的风绕着它卷
const DINGFENG = icon([
  '......wwj.....',
  '...jww...jj...',
  '..jw.LLLL..j..',
  '.jw.LwWLlL..j.',
  '.w.LwWLLllL..j',
  'jw.LWLLLlvL..w',
  'w..LLLLllvL..w',
  'w..LLLlllvL.jw',
  'j...LllvvL..w.',
  '.j...LvvL..jw.',
  '..j.......jw..',
  '...jj...jww...',
  '.....jwww.....',
  '..............',
]);
// 青莲宝色旗：金枪头的旗杆，天青的旗面上一朵月白的青莲（瓣尖亮、莲心缃黄），下摆一片莲叶，黛蓝镶边、燕尾
const QINGLIAN = icon([
  '.Y............',
  '.yb...........',
  '.BnnnnnnCC....',
  '.BnCCCCCCcC...',
  '.BnCCCwCCCCc..',
  '.BnCCwWwCCCCc.',
  '.BnCwwYwwCCCc.',
  '.BnCCwwwCCCc..',
  '.BnClLlLlCc...',
  '.BnnCCCCCnc...',
  '.Bn.c.n..n....',
  '.b............',
  '.B............',
  '.B............',
]);
// 阴阳镜：一面圆铜镜，镜面是一枚太极（阳半月白、阴半玄青，各含一点对方的颜色），下面金镜钮、红穗
const YINYANG = icon([
  '....yYYYYy....',
  '...yYwwwwNy...',
  '..yYwwwwwwNy..',
  '.yYwwwNwwwNby.',
  '.yYwwwwwwNNby.',
  '.yYwwNNNNNNby.',
  '.yYwNNNwNNNby.',
  '..ywNNNNNNby..',
  '...yNNNNNby...',
  '....ybbbby....',
  '......yb......',
  '.....eyye.....',
  '......ee......',
  '......e.......',
]);
// 玄元控水旗：银枪头的旗杆，玄青的旗面上三道月白的浪，天青镶边、燕尾
const XUANYUAN = icon([
  '.W............',
  '.jh...........',
  '.hNNNNNNnn....',
  '.hNwCNNNNNn...',
  '.hNNwCCNNNNn..',
  '.hNNNNwCNNwCn.',
  '.hNwCNNNwCCNn.',
  '.hNNwCCNNNNn..',
  '.hNNNNwCNNn...',
  '.hNnnnnnnnc...',
  '.hc.C.c..C....',
  '.i............',
  '.h............',
  '.h............',
]);
// 五火七禽扇：一柄火色羽扇（一根根翎羽从扇根张开，翎脊缃黄），扇面上窜着几簇火苗；金扇柄、红穗
const WUHUO = icon([
  '..o...Y...o...',
  '.oe..oYo.oeo..',
  '.eoeYoYoYoe...',
  '.roYfYYYfYor..',
  '.reoYYfYYoer..',
  '..reoYYYoer...',
  '..rreoYoerr...',
  '...rreYerr....',
  '....rrYrr.....',
  '.....ryr......',
  '......Yb......',
  '......yb......',
  '.....eyB......',
  '.....e.e......',
]);
// 捆仙绳：盘成几圈的金绳（拧着两股，受光的一面亮），绳头垂下来打一个结、挂一缕红穗
const KUNXIAN = icon([
  '....yYYYYy....',
  '..yYbyfyybYy..',
  '.yb.yYYYYy.by.',
  'yb.yb....by.by',
  'Yb.Y.yYYy.Y.bY',
  'Yb.Y.Y..Y.Y.bY',
  'Yb.y.b..y.y.bY',
  'yb.yb.bb.by.by',
  '.yb.yYYYYy.by.',
  '..yYb....bYy..',
  '....yYYYYyYY..',
  '..........Yb..',
  '.........eye..',
  '.........r.e..',
]);

// 再加的 11 件公共法宝的图标（arti2 分支；同一种画法）
// 降魔杵：竖着的一根金杵（头朝下：三股合成一个尖、上面一颗莲座），中间缠红，上头宝顶；一缕红穗飘在一边
const XIANGMO = icon(
  [
    '...Y...',
    '..yfb..',
    '.bYyyB.',
    '..bYB..',
    '..eye..',
    '..rYr..',
    '...yb..',
    '...Yb..',
    '.yYfYb.',
    '.bBbBB.',
    '.y.Y.b.',
    '.Y.f.y.',
    '..yYb..',
    '...Y...',
  ],
  ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '..f...........f.', '.bb.y.......y.bb', '....b.......b...'],
);

// 五光石：一捧五色石（青赤黄白黑，每颗左上受光），最前面一颗赤石最大，掷出去带一缕光
const WUGUANG = icon(
  [
    '...ww.........',
    '..wwjj...ggd..',
    '..wjjii.ghddk.',
    '...jiih.gdddk.',
    '.CCc.....ddkk.',
    'CCccn.YYy.....',
    'Cccnn.Yyyyb...',
    '.cnnN.yyybb...',
    '..NN.eoe.bB...',
    '....eoeerr....',
    '....eeerrrR...',
    '....rrrrrRR...',
    '.....RRRRR....',
  ],
  ['................', '................', '...........f....', '............Y...', '................', '................', '................', '................', '................', '................', '................', '................'],
);

// 攒心钉：一枚粗金钉从右上往左下钉（钉帽圆、受光一线灵光），钉尖一点白、挂一滴朱砂；后面两道细细的金线是连发的下一枚
const ZANXIN = icon(
  [
    '..........BYY.',
    '.........BYfYY',
    '..........YfYb',
    '.........yybB.',
    '........yfb...',
    '.......yfb....',
    '......yfb.....',
    '.....yfb......',
    '....yfb.......',
    '...yfb........',
    '..yjb.........',
    '.ejb..........',
    'eoe...........',
    '.e............',
  ],
  ['................', '................', '................', '................', '................', '...............y', '..............y.', '.............f..', '............y...', '...............y', '..............f.', '.............y..', '................', '................'],
);

// 金蛟剪：一把金剪子，两片剪刃是两条金蛟（龙头在剪尖、一点朱砂眼），交在中间一颗朱砂钉上，下面两个剪环
const JINJIAO = icon([
  'yY..........Yy',
  'fYe........eYf',
  '.yYb......bYy.',
  '..yYb....bYy..',
  '...yYb..bYy...',
  '....yYbbYy....',
  '.....yeey.....',
  '.....byYyb....',
  '....byy.yyb...',
  '..bYyb...bYyb.',
  '.by..yb.by..yb',
  '.y....y.y....y',
  '.by..yb.by..yb',
  '..byyb...byyb.',
]);

// 离地焰光旗：朱红的旗杆（金枪头），旗面朱砂、上面三簇往上窜的火苗（缃黄芯、橘红身），燕尾；旗下地面裂开一道透火光的缝
const YANGUANG = icon(
  [
    '.Y............',
    '.yb...........',
    '.reeeeeeoo....',
    '.reoYoeeeeo...',
    '.reYfYeoYeee..',
    '.reoYoeYfYeeo.',
    '.reeoeeoYoeee.',
    '.reeeeoeeeeo..',
    '.reoYoeeeeo...',
    '.rRRReeRRRe...',
    '.rR.e.R..e....',
    '.r............',
    '.R............',
    'oYo...........',
  ],
  ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '....b.e.........', '...B.bo.........'],
);

// 万鸦壶：一把乌铜扁壶（壶嘴朝左、右边一个把手），壶口窜着一簇火，三只小火鸦从火里飞出去（往右上）
const WANYA = icon(
  [
    '..............',
    '..............',
    '......oY......',
    '.....eYfe.....',
    '.....RrrR.....',
    '.....BbyB.....',
    'y...BbyyyB....',
    'b..BbyYYyybB..',
    '.bBbyYYyyybbB.',
    '..BbyyYyybbbB.',
    '...BbyyybbbB..',
    '....BbbbbbB...',
    '.....BBBBB....',
  ],
  ['................', '.........o.o....', '..........k.....', '............e.e.', '.............k..', '..........o.o...', '...........k....', '................', '................', '................', '................', '................', '................', '................'],
);

/** 四海瓶：一只青花的玉壶春瓶（敞口、细颈、梨形的腹，腹上一道青色的浪纹），瓶口溅出几滴水。 */
const SIHAI = icon(
  [
    '..jwwwwwj..',
    '...jwwwj...',
    '....jwj....',
    '....jwj....',
    '...jwwwj...',
    '..jwwwwwj..',
    '.jwnwwwnwj.',
    'jwcnwcwncwj',
    'jwnccnccnwj',
    'jwwnwwwnwwj',
    '.jwwwwwwwj.',
    '..jwwwwwj..',
    '...nnnnn...',
    '...NNNNN...',
  ],
  ['..C.........C...', '.C...........W..', '..............C.', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................'],
);

/** 雾露乾坤网：一只收拢的网兜（天青的网线、网结一点白，兜里是靛青的水雾），兜口一道藤黄的箍、顶上一个绳结，底下几颗露珠。 */
const WULU = icon(
  [
    '.....nnn.....',
    '.....nWn.....',
    '.....byb.....',
    '...CnCnCNC...',
    '..NnWnnnWNN..',
    '.CnCnCnCNCNC.',
    '.NWnnnWnNNWN.',
    'NCnCnCnCNCNCN',
    'WnnnWnnnWNNNW',
    '.CnCnCnCNCNC.',
    '..WnnnWnNNW..',
    '...CnCnCNC...',
    '....WnnnW....',
  ],
  ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '.C...........C..', '....W.....W.....'],
);

/** 七宝妙树：一枝金色的妙树（左下是握手、往右上分出几枝），枝头挂着七宝（金、琉璃、玻璃、砗磲、玛瑙、银、翠）。 */
const MIAOSHU = icon(
  [
    '.Y.......C....',
    '.y.......y..W.',
    '..y.....y...y.',
    '...m...L...j..',
    '....b..b..b...',
    '.e...b.b.b....',
    '..b...bbb.....',
    '...bb.bb......',
    '.....bb.......',
    '....bb........',
    '...bB.........',
    '..bB..........',
    '.yB...........',
    'yy............',
  ],
);

/** 瘟癀伞：一把枯黄的伞（藤黄的伞骨、紫棠的流苏），伞下飘着几点黄绿的瘟雾。 */
const WENHUANG = icon(
  [
    '......HH......',
    '....HFFFFH....',
    '...HFyFFyFH...',
    '..HFFyFFyFFH..',
    '.HFFFyFFyFFFH.',
    'HHPHHPHHPHHPHH',
    '.P..P..S..P.P.',
    '.......S......',
    '.......S......',
    '.......S......',
    '.......S......',
    '.....S.S......',
    '......S.......',
  ],
  ['................', '................', '................', '................', '................', '................', '................', '................', '...L.........l..', '.....l....L.....', '..l.........L...', '....L...........', '................', '................', '................', '................'],
);

/** 落宝金钱：一枚方孔金钱（藤黄的钱面、缃黄的边、赭色的方孔），两侧一对白翅。 */
const LUOBAO = icon(
  [
    '..............',
    'jw..........wj',
    'wwj..yyyy..jww',
    '.wwjyYYYYyjww.',
    '..wyYyyyyYyw..',
    '...yYyBByYy...',
    '...yYyBByYy...',
    '..jyYyyyyYyj..',
    '..j.yYYYYy.j..',
    '.....yyyy.....',
  ],
);

export const WEAPON_ICONS: Record<WeaponKind, Grid> = {
  qiankun: QIANKUN,
  huojian: HUOJIAN,
  jiulong: JIULONG,
  leigong: LEIGONG,
  fantian: FANTIAN,
  xinghuang: XINGHUANG,
  zhanxian: ZHANXIAN,
  hanbing: HANBING,
  dashen: DASHEN,
  huaxue: HUAXUE,
  dingfeng: DINGFENG,
  qinglian: QINGLIAN,
  yinyang: YINYANG,
  xuanyuan: XUANYUAN,
  wuhuo: WUHUO,
  kunxian: KUNXIAN,
  sanjian: SANJIAN_ICON, // 杨戬的专属法宝（画在 hero-icons.ts）
  dinghai: DINGHAI_ICON, // 赵公明的专属法宝（画在 zhao-icons.ts）
  jindou: JINDOU_ICON, // 云霄的专属法宝（画在 yunxiao-icons.ts）
  huangjin: HUANGJIN_ICON, // 雷震子的专属法宝（画在 leizhenzi-icons.ts）
  heiyan: HEIYAN_ICON, // 魔化哪吒的专属法宝（回响化身的图标画在 echo-icons.ts）
  fulong: FULONG_ICON, // 回响赵公明的专属法宝
  qiankuntu: QIANKUNTU_ICON, // 回响云霄的专属法宝
  youlong: YOULONG_ICON, // 回响敖丙的专属法宝（画在 bishui.ts）
  jingu: JINGU_ICON, // 孙悟空的专属法宝（画在 wukong-icons.ts）
  xiangmo: XIANGMO,
  wuguang: WUGUANG,
  zanxin: ZANXIN,
  jinjiao: JINJIAO,
  yanguang: YANGUANG,
  wanya: WANYA,
  sihai: SIHAI,
  wulu: WULU,
  miaoshu: MIAOSHU,
  wenhuang: WENHUANG,
  luobao: LUOBAO,
};

// 碎片：只留图标的一角（每件选最认得出的那一角），沿锯齿断口重新描边
const FRAG_CORNER: Record<WeaponKind, 'tl' | 'tr' | 'bl' | 'br'> = {
  qiankun: 'tl',
  huojian: 'tr',
  jiulong: 'tl',
  leigong: 'tr',
  fantian: 'tl',
  xinghuang: 'tl',
  zhanxian: 'tr',
  hanbing: 'tl',
  dashen: 'tr',
  huaxue: 'tr',
  dingfeng: 'tl',
  qinglian: 'tl',
  yinyang: 'tl',
  xuanyuan: 'tl',
  wuhuo: 'tl',
  kunxian: 'tl',
  sanjian: 'tr',
  dinghai: 'tl',
  jindou: 'tl',
  huangjin: 'tr',
  heiyan: 'tr',
  fulong: 'tl',
  qiankuntu: 'tr',
  youlong: 'tr',
  jingu: 'tr',
  xiangmo: 'bl',
  wuguang: 'br',
  zanxin: 'tr',
  jinjiao: 'tl',
  yanguang: 'tl',
  wanya: 'bl',
  sihai: 'tr',
  wulu: 'tl',
  miaoshu: 'tr',
  wenhuang: 'tl',
  luobao: 'tr',
};
// 断口：沿对角线来回错开的锯齿，只保留角上那一侧；断口处补一点亮色碴口
const JAG = [0, 2, 1, -1, 0, 2, 1, -1];

const fragCache = new Map<WeaponKind, Grid>();
/** 法宝碎片的图标：法宝图标的一角。 */
export function fragmentIcon(kind: WeaponKind): Grid {
  const hit = fragCache.get(kind);
  if (hit) return hit;
  const src = WEAPON_ICONS[kind];
  const c = FRAG_CORNER[kind];
  const kept = src.rows.map((row, y) =>
    [...row].map((ch, x) => {
      // 把角转到左上角来判断：u + v 不超过（带锯齿的）阈值的留下
      const u = c === 'tl' || c === 'bl' ? x : 15 - x;
      const v = c === 'tl' || c === 'tr' ? y : 15 - y;
      return u + v <= 15 + JAG[(u - v + 16) % 8] && ch !== 'k' ? ch : '.';
    }),
  );
  const g = outline({ w: 16, h: 16, rows: kept.map((r) => r.join('')) }, 'k');
  fragCache.set(kind, g);
  return g;
}

// 器灵：叠一层灵纹（两角的云头纹 + 两点灵光），不改法宝本身的样子
const SPIRIT_MARKS = [
  '.CC.............',
  'C..C..........f.',
  'C.CC.........fWf',
  '.C............f.',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..f.............',
  '.fWf.........C..',
  '..f.........CC.C',
  '............C..C',
  '.............CC.',
];
const spiritCache = new Map<WeaponKind, Grid>();
/** 器灵的图标：法宝图标叠上灵纹。 */
export function spiritIcon(kind: WeaponKind): Grid {
  let g = spiritCache.get(kind);
  if (!g) {
    g = compose(16, 16, [
      { g: WEAPON_ICONS[kind], x: 0, y: 0 },
      { g: grid(SPIRIT_MARKS), x: 0, y: 0 },
    ]);
    spiritCache.set(kind, g);
  }
  return g;
}

// ---------------------------------------------------------------- 灵物

const ESSENCE = [
  '......11......',
  '.....1122.....',
  '....112223....',
  '...11222233...',
  '..1122222333..',
  '..1222222333..',
  '..2222223334..',
  '...22223334...',
  '....223344....',
  '.....3344.....',
  '......44......',
];
const essence = (el: Element) =>
  icon(
    recolor(ESSENCE, {
      metal: { 1: 'f', 2: 'Y', 3: 'y', 4: 'b' },
      wood: { 1: 'L', 2: 'l', 3: 'v', 4: 'G' },
      water: { 1: 'W', 2: 'C', 3: 'c', 4: 'n' },
      fire: { 1: 'Y', 2: 'o', 3: 'e', 4: 'r' },
      earth: { 1: 'Y', 2: 'y', 3: 'b', 4: 'B' },
    }[el]),
  );

export const RELIC_ICONS: Record<RelicId, Grid> = {
  peach: icon([
    '..vv.....e....',
    '.vLlv...mme...',
    '..vlvvtmsmee..',
    '...ttttsmmmee.',
    '..tttttsmmmmee',
    '..ttwttsmmmmme',
    '.tttwttmsmmmme',
    '.ttttttmsmmmmm',
    '.ttttttmsmmmmp',
    '..tttttmmsmmmp',
    '..sttttmmmsmp.',
    '...sstttmmmpp.',
    '.....sssppp...',
  ]),
  lingzhi: icon([
    '...yyyyyy.....',
    '..yYbbbbby....',
    '.yYbSSSSbby...',
    '.ybSBBBBSby...',
    '.ybbbbbbbby...',
    '..yyyyyyyy....',
    '.....BB...yyy.',
    '.....SB..ybby.',
    '....BS..ybSby.',
    '....SB...yyy..',
    '...BSBB...B...',
    '..BSSSBBBSB...',
  ]),
  gourd: icon([
    '......BB......',
    '......yy......',
    '.....pmmp.....',
    '....pmwmmp....',
    '....pmmmmp....',
    '.....pmmp.....',
    '.....yeey.....',
    '....pmmmmp....',
    '...pmwmmmmp...',
    '..pmmmmmmmmp..',
    '..pmmmmmmmPp..',
    '..PpmmmmmmPP..',
    '...PPpppPPP...',
    '.....PPPP.....',
  ]),
  jindan: icon(
    [
      '....yYYYy.....',
      '...yYffYyy....',
      '..yYfYYyyyb...',
      '..yYYyyyBbb...',
      '..yyyyBbyyb...',
      '..byyBbyyyb...',
      '...byyyyybb...',
      '....bbbbbB....',
      '..rreeeeerr...',
      '...RRRRRRR....',
    ],
    ['................', '..........f.....', '...........f....', '................', '................', '.............f..'],
  ),
  feather: icon([
    '...........CC.',
    '.........CCwC.',
    '........CCwcc.',
    '.......CCwcc..',
    '......CCwcc...',
    '.....CCwcc....',
    '....CCwcn.....',
    '...cCwcn......',
    '...cwcn.......',
    '..cwnn........',
    '..wn..........',
    '.w............',
    'j.............',
  ]),
  thunderwood: icon([
    '..........yb..',
    '.........ybYB.',
    '........BbfbB.',
    '.......BSYSBB.',
    '......BSfSB...',
    '.....BSYSB....',
    '....BSfSB.....',
    '...BSYSBl.....',
    '..BSfSB.Ll....',
    '..BYSB...l....',
    '..BSB.........',
    '...B..........',
  ]),
  pearl: icon(
    [
      '.....jjjj.....',
      '....jwWwwj....',
      '...jwWWwwCj...',
      '...jwwwwwCj...',
      '...jwwwwCCj...',
      '...jCwwCCcj...',
      '....jCCCcj....',
      '.....jccj.....',
      '....yYyyb.....',
      '...y.byb.y....',
    ],
    ['................', '..f.............', '................', '.............f..', '................', '................', '..f.............'],
  ),
  turtle: icon([
    '......GG......',
    '.....GvvG.....',
    '..G..GvvG..G..',
    '..vvNNNNNNvv..',
    '...NncCcCcnN..',
    '..NncnnCnncnN.',
    '..NcCnnCnnCcN.',
    '..NccCCCCCccN.',
    '..NcCnnCnnCcN.',
    '..NncnnCnncnN.',
    '...NncCcCcnN..',
    '..vvNNNNNNvv..',
    '..G...vv...G..',
    '.......G......',
  ]),
  cornucopia: icon([
    '.....Y.C......',
    '...YyYYCcY....',
    '..YyyYyyYyY...',
    '.YyYYyyYYyyY..',
    'yyyyyyyyyyyyyy',
    'beeeeeeeeeeeeb',
    '.reeYeeeeYeer.',
    '..rreeeeeerr..',
    '...RrrrrrrR...',
    '....RRRRRR....',
    '...yyyyyyyy...',
  ]),
  blooddemon: icon(
    [
      '....RRRRR.....',
      '..RRrrerrRR...',
      '.RrreeeeerrR..',
      '.RreeoYoeerR..',
      'RreeoYkYoeerR.',
      'RreeoYkYoeerR.',
      'RreeoYkYoeerR.',
      '.RreeoYoeerR..',
      '.RrreeeeerrR..',
      '..RRrrrrrRR...',
      '....RRRRR.....',
    ],
    ['............P...', '.............p..', '................', '..............P.', '................', '.............p..'],
  ),
  soulbell: icon(
    [
      '......pp......',
      '......Pp......',
      '.....PyyP.....',
      '....PppppP....',
      '....PpmppP....',
      '...PpmpppPP...',
      '...PpppppPP...',
      '..PPppppppPP..',
      '..PyyyyyyyyP..',
      '......hh......',
      '......kk......',
    ],
    ['.C..............', 'C.C.............', '.C...........C..', '............C.C.', '.............C..'],
  ),
  orb_metal: essence('metal'),
  orb_wood: essence('wood'),
  orb_water: essence('water'),
  orb_fire: essence('fire'),
  orb_earth: essence('earth'),
  // ---- M3 新加的 18 件（同一种画法：粗轮廓、左上受光、右下压暗，icon() 再描一圈玄色边；点缀不描边） ----
  // 风火蒲团：一只扁扁的圆蒲团，顶上草编一圈一圈盘进去（缃 / 藤黄，沟是琥珀），草编的侧面压暗，正面绣一簇朱红的火苗
  cushion: icon([
    '...yYYYYYYy...',
    '.yYYbbbbbbyyy.',
    'yYbbYYYYYYbbyb',
    'yYbYYbbbbYybyb',
    'yybYbyYYybybyb',
    'byybYbbbbybbyB',
    'bbyybyyyybyybB',
    'Bbbyyyeyyyybbb',
    'BbbbbeoebbbbbB',
    '.BBbbbebbbbBB.',
    '...BBBBBBBB...',
  ]),
  // 金刚琢印：一枚粗银镯似的金刚琢（3/4 俯视，看得见内壁），两处嵌金
  zhuo: icon([
    '....jjwwjj....',
    '..jjwWWWwwji..',
    '.jwWWwjjjjjih.',
    'jwWw.......ihh',
    'jwY........iyh',
    'jww........ihh',
    'jjw........ihg',
    'ijii......ihhg',
    '.iiijjYyiihhg.',
    '..ghhhhhhhhg..',
    '....gggggg....',
  ]),
  // 九龙玉佩：一条盘成「C」字的玉龙（龙头在上、头顶一只角、朝右张口，龙尾在下面卷起来），青白玉色，红绳从龙背上吊着，尾下垂一缕红穗
  jadedragon: icon([
    '.....rr.L.....',
    '.....bYLl.....',
    '...vlLLLvv....',
    '..lLLwdLLLlv..',
    '.lLLlvvvlLLLv.',
    '.lLlv....vv.G.',
    'lLlv..........',
    'lLlv..........',
    'lLlv......vv..',
    '.lLlv....vlLv.',
    '.vlLlvvvlLlv..',
    '..vllllllvv...',
    '...vvvvrv.....',
    '......rer.....',
  ]),
  // 照妖镜碎片：圆铜镜碎下来的一角 —— 右上还留着一段弧形的镜沿（藤黄、琥珀），镜面天青、一道斜白光、一道裂纹，左边和下边是崩开的锯齿口
  mirror: icon([
    '..yyy.........',
    '..CYYyy.......',
    '.cCWWYyy......',
    '..cCWWCYyb....',
    '.ncCCWWCCyb...',
    '..ncCCWCCCyb..',
    '...ncCCCdCcyb.',
    '..nncCCCdcCyb.',
    '...nnccdccCcyb',
    '....NnccdcCcyb',
    '...N.NnncdcCyb',
    '.......NNnncyb',
    '........N.Nnbb',
  ]),
  // 混元伞残片：一把撑开的伞（紫棠伞面、金色伞骨），伞沿垂着几粒珍珠，右边撕掉了一块，伞柄折断
  umbrella: icon([
    '......Yy......',
    '....ppyypP....',
    '..ppmpyypPP...',
    '.pmmpyppypP...',
    'pmmpyppppy....',
    'pmpypppppy.P..',
    'PyPPPyPPPyPPP.',
    'w..w...w...w..',
    '......bB......',
    '......bB......',
    '......bB......',
    '......bB......',
    '.....bB.......',
  ]),
  // 乾坤袋：靛青锦袋，口上一圈金绳、绳头一点朱红，袋身绣一圈金线太极，袋口冒出两粒灵石
  pouch: icon([
    '.....WC.C.....',
    '....cCWCc.....',
    '...nccncnn....',
    '....yYYYy.e...',
    '...ncccccnre..',
    '..ncCCcccnn...',
    '.ncCcyyyccnN..',
    '.nCcyccCycnN..',
    'ncCcyCccycnNN.',
    'ncccycccycnNN.',
    'ncccyyyyccnNN.',
    '.nccnnnnnnNN..',
    '..NNNNNNNNN...',
  ]),
  // 桃木簪：一支细长的桃木簪（右上到左下），簪头一朵五瓣桃花（月白瓣尖、桃红瓣身、缃色花心），花下垂一串红珠
  hairpin: icon([
    '.........mm...',
    '........mwwm.m',
    '.......mmYwmwm',
    '........pYYmm.',
    '.......bpmwwm.',
    '......bB.pmm..',
    '.....bB..e....',
    '....bB...r....',
    '...bB....e....',
    '..bB..........',
    '.bB...........',
    'bB............',
    'B.............',
  ]),
  // 风雷羽：一根宽宽的紫翎（桃红的边、胭脂的羽面、紫棠的暗面），羽杆是一道金色的折线雷，羽尖迸着火星
  stormfeather: icon(
    [
      '..........pm..',
      '.........pmm..',
      '........pmYm..',
      '.......pmmYp..',
      '......pmmYmp..',
      '.....pmmmYYp..',
      '....pmmYYpPp..',
      '...pmmmYmpP...',
      '...pmmYmpP....',
      '..pmmYmpPP....',
      '..pmpYpPP.....',
      '.pPPjPP.......',
      '.PPj..........',
      'jj............',
    ],
    ['.............W..', '...........f....', '..............Y.'],
  ),
  // 踏云履：一只云头履（侧面，朝右）—— 黛蓝的鞋面、朱红的鞋口滚边、细细的月白鞋底，鞋头立着一朵卷起来的白云
  cloudshoe: icon([
    '..........jww.',
    '.........jwCwj',
    '.ee......jwjwj',
    'nddeeee...jwj.',
    'nNNNNNNNNNnj..',
    'nNcNNNNNNNNNj.',
    'nNNNNNNNNNNNNj',
    'gjjjjjjjjjjjjj',
  ]),
  // 逆鳞：一片倒生的龙鳞（尖朝上），金边、朱砂鳞面，下半截一道道暗红的鳞纹顺着鳞边弯
  scale: icon([
    '......YY......',
    '.....YoeY.....',
    '....YooeeY....',
    '...YooeeeeY...',
    '...yoeeeeeyb..',
    '..yoeeeeeeeyb.',
    '..yeerrrrreeb.',
    '.yeerreeerreeb',
    '.yerreeeeerreb',
    '.yereerrreereb',
    '..yerreeerreb.',
    '..byerrrrreyb.',
    '...bbyeeeybb..',
    '.....bbbbb....',
  ]),
  // 定颜珠：一颗粉白的珠子，被四只金爪从下面托住（爪尖亮、爪根暗）
  dingyan: icon([
    '.....mmmm.....',
    '...mwWwmmp....',
    '..mwWwmmmpp...',
    '..mwwmmmmpp...',
    '.Ymmmmmmmppy..',
    '.YymmmmmppyY..',
    '..YympppppyY..',
    '...yYpppPYy...',
    '....yyYYyy....',
    '.....byyb.....',
    '....bBbbBb....',
  ]),
  // 冰心玉壶：一只玉壶春瓶（细颈、撇口、圆腹），冰裂似的天青釉，口沿一圈白
  icevase: icon([
    '....CwwwC.....',
    '.....cCCc.....',
    '......Cc......',
    '......Cc......',
    '.....wCCc.....',
    '....wWCCcc....',
    '...wWCCCccn...',
    '..wWCCCCcccn..',
    '..wCCwCCcccn..',
    '..CCCCCcccnn..',
    '...cCCcccnn...',
    '....nnnnnn....',
    '....NnnnnN....',
  ]),
  // ---- 魔物 ----
  // 噬心蛊：一只乌黑的蛊罐，罐身贴着撕了半截的朱砂封条，一条紫黑的蜈蚣探出罐口（朱红的眼，腿和触须是点缀，不描边）
  gu: icon(
    [
      '.......PPp....',
      '......pPePp...',
      '.......pPp....',
      '......PpPpP...',
      '...ghhPpPhgg..',
      '..ghiihPphhgd.',
      '.ghiihhhhhhhgd',
      '.geeeeYeeeeedd',
      '.gheYeehhhhhdd',
      '.ghhhhhhhhhhdd',
      '..ghhhhhhhhdd.',
      '...dddddddd...',
    ],
    ['......m...m.....', '.......m.m......', '................', '......e...e.....', '................', '.....e.....e....'],
  ),
  // 夔牛鼓：一面朱漆大鼓（3/4 俯视看得见牛皮鼓面，鼓身微鼓），上下两圈金钉
  drum: icon([
    '...ssssssss...',
    '.ssttttttttss.',
    'sttttttttttttS',
    'SsttttttttttsS',
    '.SSssssssssSS.',
    'yYyYyYyYyYyYyy',
    'eooeeeeeeeeerr',
    'eoeeeeeeeeeerR',
    'eoeeeeeeeeeerR',
    'eoeeeeeeeeeerR',
    '.eeeeeeeeeerR.',
    '.yYyYyYyYyYyy.',
    '..RRRRRRRRRR..',
  ]),
  // 燃魂香：三炷香插在乌漆小香座里，香头是紫红的火，飘起几缕紫烟
  incense: icon(
    [
      '...m..m..m....',
      '...e..o..e....',
      '...B..b..B....',
      '...B..b..B....',
      '....B.b.B.....',
      '....B.b.B.....',
      '....BbbbB.....',
      '..ggghhhggg...',
      '.gghiiiiihgg..',
      '.dgggggggggd..',
      '..ddddddddd...',
    ],
    ['....p...p....p..', '...p.m.p..m..p..', '....m...m....m..', '...p....p...p...'],
  ),
  // ---- 只加属性的 ----
  // 金蝉蜕：一只金蝉蜕下的壳（「金蝉脱壳」：闪避），俯视 —— 琥珀金的头胸、背上一道裂口，两片半透的蝉翼（缟白、天青的翅脉）
  cicada: icon([
    '....yy..yy....',
    '...yYyyyyYy...',
    '...byYddYyb...',
    '..jbyyddyybj..',
    '.jwjbyyyybjwj.',
    'jwwCjbyybjCwwj',
    'jwCCjbyybjCCwj',
    'jwCCcjbbjcCCwj',
    '.jwCcjbbjcCwj.',
    '..jwcjbbjcwj..',
    '...jjcbbcjj...',
    '.....jbbj.....',
  ]),
  // 山河图残卷：左边是卷着的卷轴（木轴琥珀），展开的一截画着青山绿水，右边是撕破的毛边
  scroll: icon([
    '.bb...........',
    'bYbb..........',
    'bybbjjjjjjjj..',
    'bybbwwwwwwwjj.',
    'bybbwwwvwwwwj.',
    'bybbwwvlvwwvj.',
    'bybbwvlLlvvlvj',
    'bybbvlLLllvLlj',
    'bybbccCCcccCcj',
    'bybbwCccCCcwj.',
    'bybbwwwwwwwjj.',
    'bybbjjjjjj.j..',
    'Bbbb..........',
    '.BB...........',
  ]),
  // 麒麟角：一支往左上弯起的麒麟角，插在琥珀色的角座上；根部银鼠、往上越来越白，尖上泛金，一圈圈角纹
  qilin: icon([
    '...Wf.........',
    '....fY........',
    '....jYy.......',
    '....jwYy......',
    '.....jwyy.....',
    '.....jjwyb....',
    '......jjiyb...',
    '......ijjiyb..',
    '.......iijhb..',
    '......hiijhbB.',
    '.....hhiiihbB.',
    '....BhhhhhhB..',
    '...BbbbbbbB...',
    '....BBBBBB....',
  ]),
};

// ---------------------------------------------------------------- 丹药：同一只瓷瓶，按丹药换丹丸的颜色

const BOTTLE = [
  '.....ee.......',
  '.....rr.......',
  '....jwwj......',
  '.....wj.......',
  '...jwwwwj.....',
  '..jwwwwwwj....',
  '..j333333j....',
  '..jw2ww2wj..12',
  '..jjwwwwjj.123',
  '...jjjjjj..234',
  '...........44.',
];
const elixir = (c: Record<string, string>, accent?: string[]) => icon(recolor(BOTTLE, c), accent);
/** M3 新加的丹药：同一只瓷瓶，瓶塞（5 / 6）也换成丹药自己的颜色 —— 塞子、瓶腰、丹丸一个色，八种一眼分得开。 */
const BOTTLE2 = BOTTLE.map((r, i) => (i === 0 ? r.replace('ee', '55') : i === 1 ? r.replace('rr', '66') : r));
const elixir2 = (c: Record<string, string>, accent?: string[]) => icon(BOTTLE2.map((r) => r.replace(/[1-6]/g, (ch) => c[ch])), accent);
export const ELIXIR_ICONS: Record<ElixirId, Grid> = {
  huichun: elixir({ 1: 'L', 2: 'l', 3: 'v', 4: 'G' }),
  juling: elixir({ 1: 'W', 2: 'C', 3: 'c', 4: 'n' }),
  kuangxue: elixir({ 1: 'o', 2: 'e', 3: 'r', 4: 'R' }),
  // 大还丹：金塞、金丹，丹边几点灵光
  dahuan: elixir2({ 1: 'W', 2: 'f', 3: 'Y', 4: 'y', 5: 'Y', 6: 'y' }, ['................', '................', '................', '................', '................', '..............f.', '...........f....', '................', '...............f']),
  // 隐身丹：银鼠塞、灰白的丹，丹边飘一缕淡烟
  yinshen: elixir2({ 1: 'w', 2: 'j', 3: 'i', 4: 'h', 5: 'i', 6: 'h' }, ['................', '................', '................', '................', '................', '................', '.............j..', '..............jj', '...............j']),
  // 金刚丹：琥珀塞、赭金的丹
  jingangdan: elixir2({ 1: 'Y', 2: 'y', 3: 'b', 4: 'B', 5: 'b', 6: 'B' }),
  // 雷火丹：紫塞、紫丹，丹顶劈着一点金雷
  leihuo: elixir2({ 1: 'W', 2: 'm', 3: 'p', 4: 'P', 5: 'p', 6: 'P' }, ['................', '................', '................', '................', '................', '..............Y.', '.............Y..', '..............Y.']),
  // 凝神丹：靛青塞、深青的丹
  ningshen: elixir2({ 1: 'C', 2: 'c', 3: 'n', 4: 'N', 5: 'n', 6: 'N' }),
};

// ---------------------------------------------------------------- 符箓

export const CHARM_ICONS: Record<CharmId, Grid> = {
  // 替身符：剪成小纸人的黄符
  tishen: icon([
    '......YY......',
    '.....YyyY.....',
    '......yy......',
    '..YYYYyyYYYY..',
    '..yyyyyyyyyy..',
    '.....yeey.....',
    '.....yeey.....',
    '.....yyyy.....',
    '....yy..yy....',
    '....yb..by....',
  ]),
  // 护心符：长条黄符，中间一面护心镜
  huxin: icon([
    '....yYYYYy....',
    '....yeeeey....',
    '....yYeeYy....',
    '....yyyyyy....',
    '....ybyyby....',
    '....byCCyb....',
    '....yCWCCy....',
    '....yCCCcy....',
    '....byCcyb....',
    '....ybyyby....',
    '....yYeeYy....',
    '....yeYYey....',
    '....bbbbbb....',
  ]),
  // ---- M3 新加的六种：都是黄符纸，各有各的样子 ----
  // 定身符：长条黄符，朱砂画一个回旋的符头，顶上钉着一枚银钉
  dingshen: icon([
    '......ij......',
    '.....iwwj.....',
    '....yYhjYy....',
    '....yYiiYy....',
    '....yeeeey....',
    '....yyyyey....',
    '....yeeeey....',
    '....yeyyyy....',
    '....yeeeey....',
    '....yyyyyy....',
    '....ybeeby....',
    '....yyeeyy....',
    '....bbbbbb....',
  ]),
  // 引雷符：长条黄符上斜劈过一道月白镶紫的雷，雷头雷尾都劈出了符纸
  yinlei: icon(
    [
      '.....yYYYy....',
      '.....yeeey....',
      '.....yYWYy....',
      '.....yWpyy....',
      '.....Wpyyy....',
      '....WWWWWy....',
      '.....yyWpy....',
      '.....yyWpy....',
      '.....yWpyy....',
      '.....Wpeey....',
      '.....yeYey....',
      '.....bbbbb....',
    ],
    ['................', '..........W.....', '...........p....', '................', '................', '................', '................', '................', '................', '................', '................', '.....W..........', '....p...........'],
  ),
  // 遁地符：一张黄符斜斜插进一堆土里，下半截已经没进土中，土块往两边崩开
  dundi: icon(
    [
      '......yYy.....',
      '.....yeeyy....',
      '.....yeYey....',
      '....yyyeyy....',
      '....yeeeyy....',
      '...yyyeyyy....',
      '...yeeeyy.....',
      '..bBbyyybBb...',
      '.bBbbBbbbbBbb.',
      'bBbbbbBbbbbbBb',
      'BbBBbbbBbbBBbB',
      '.BBBBBBBBBBBB.',
    ],
    ['................', '................', '................', '................', '................', '................', '................', '.b..........b...', 'b..............b', '................'],
  ),
  // 神行符：黄符纸剪成的一匹奔马（甲马），朱砂点睛、背上一道朱砂符纹
  shenxing: icon([
    '..........yy..',
    '.........yYy..',
    '........yyey..',
    '..yyyyyyyyy...',
    '.yYYeeeeyy....',
    'yyyyyyyyyy....',
    'y.yyyyyyy.....',
    '..yb...yb.....',
    '.yb.....yb....',
    'yb.......yb...',
  ]),
  // 招宝符：一张朱红的招财符（红纸金字，和别的黄符分得开），正中嵌着一枚灵石，四角点着金星
  zhaobao: icon(
    [
      '....eooooe....',
      '....eYYYYe....',
      '....eeeeee....',
      '....eeWCee....',
      '....eWCCce....',
      '....eCCcce....',
      '....eeccee....',
      '....eeeeee....',
      '....eYeeYe....',
      '....eeYYee....',
      '....rrrrrr....',
    ],
    ['................', '................', '..f.........f...', '................', '................', '................', '................', '................', '................', '..Y.........Y...'],
  ),
  // 回灵符：叠成三角的护身符（黄纸、朱砂边），正中一圈天青的回旋纹
  huiling: icon([
    '......yY......',
    '.....yYYy.....',
    '.....yyyy.....',
    '....yyCCyy....',
    '....yCyyCy....',
    '...yyCyCCyy...',
    '...yyCyyyyy...',
    '..yyyyCCCyyy..',
    '..yyyyyyyyyy..',
    '.yeeeeeeeeeey.',
    '.bbbbbbbbbbbb.',
  ]),
};

// ---------------------------------------------------------------- 宠物：混天绫（起手 / 缚龙 / 火绫）

export const PET_ICONS = {
  base: icon([
    '..........eo..',
    '........eeoe..',
    '......eeor....',
    '.....eor......',
    '....eor.......',
    '....er........',
    '.....re.......',
    '......ree.....',
    '........ree...',
    '.........re...',
    '........re....',
    '......rre.....',
    '....RRr.......',
    '..RR..........',
  ]),
  // 缚龙：绫子一圈一圈缠紧，中间一枚金扣，两头的绫尾飘出来
  bind: icon([
    '..eo..........',
    '...re.........',
    '....re........',
    '...eooooe.....',
    '..errrrrrre...',
    '...eooooooe...',
    '..errryYrrre..',
    '...eooYyooe...',
    '..errrrrrrre..',
    '...eooooooe...',
    '....rrrrrr....',
    '.........er...',
    '..........er..',
    '...........RR.',
  ]),
  fire: icon(
    [
      '..........eo..',
      '........eeoe..',
      '......eeor....',
      '.....eor......',
      '....eor.......',
      '....er........',
      '.....re.......',
      '......ree.....',
      '........ree...',
      '.........re...',
      '........re....',
      '......rre.....',
      '....RRr.......',
      '..RR..........',
    ],
    ['............Y...', '..........o..f..', '...........Y....', '................', '................', '................', '................', '................', '..........o.....', '...........Y....', '................', '................', '..o.............', '.Y..............'],
  ),
};

/** 每条进化分支的图标（混天绫的在上面；哮天犬的画在 hero-icons.ts，黑虎的画在 zhao-icons.ts，青鸾的在 yunxiao-icons.ts，雷鹏的在 leizhenzi-icons.ts，毫毛猴的在 wukong-icons.ts）。 */
export const BRANCH_ICONS: Record<PetBranch, Grid> = { surge: BISHUI_ICONS.surge, marrow: BISHUI_ICONS.marrow, bind: PET_ICONS.bind, fire: PET_ICONS.fire, pounce: HOUND_ICONS.pounce, fang: HOUND_ICONS.fang, gale: TIGER_ICONS.gale, broke: TIGER_ICONS.broke, rime: LUAN_ICONS.rime, deep: LUAN_ICONS.deep, flash: PENG_ICONS.flash, clap: PENG_ICONS.clap, hold: MONKEY_ICONS.hold, drowse: MONKEY_ICONS.drowse };
/** 还没进化时的宠物图标（按宠物种类）。 */
export const PET_BASE_ICONS: Record<PetKind, Grid> = { bishui: BISHUI_ICONS.base, huntian: PET_ICONS.base, xiaotian: HOUND_ICONS.base, heihu: TIGER_ICONS.base, qingluan: LUAN_ICONS.base, leipeng: PENG_ICONS.base, maohou: MONKEY_ICONS.base };

// ---------------------------------------------------------------- 属性（升级时用；有对应灵物的就用灵物的图）

export const EXTRA_ICONS = {
  // 范围：八卦阵盘
  area: icon([
    '....yyyyyy....',
    '..yybbbbbbyy..',
    '.ybYY.YY.YYby.',
    '.yb........by.',
    'yb.YY.CC.YY.by',
    'ybY..CwwC..Yby',
    'yb.Y.CwcC.Y.by',
    'ybY..CccC..Yby',
    'yb.YY.CC.YY.by',
    '.yb........by.',
    '.ybYY.YY.YYby.',
    '..yybbbbbbyy..',
    '....yyyyyy....',
  ]),
  // 闪避：一团云气
  dodge: icon(
    [
      '......jww.....',
      '.....jwwww....',
      '..jw.jwwwwj...',
      '.jwwwjwwwwwjw.',
      'jwwwwwwwwwwwww',
      'jwwwwwwwwwwwwj',
      '.jCCwwwwwwCCj.',
      '..jCCCCCCCCj..',
    ],
    ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '.jjjj...........', '...jjjjj..jjj...', '................'],
  ),
};

// ---------------------------------------------------------------- 界面装饰
// 这些小图按界面的像素尺度显示（和字、图标同一个放大倍数），颜色可以在用的时候换（模板里的 1 / 2 代表主色 / 暗色）。

/** 龛里摆宝物的紫檀几座（20×4，和龛里的图标同倍数放大）。 */
export const STAND: Grid = grid([
  '.kkkkkkkkkkkkkkkkkk.',
  'kYyyyyyyyyyyyyyyyybk',
  'kBBBBBBBBBBBBBBBBBBk',
  '.kSk............kSk.',
]);

/** 灵石：价钱旁边的小晶粒（5×7）。 */
export const GEM: Grid = grid(['..k..', '.kCk.', 'kCWck', 'kCCck', 'kcCck', '.kck.', '..k..']);

/** 框角的回纹（左上角，5×5；其余三个角翻转得到）。1 = 框色。 */
export const CORNER = ['11111', '1....', '1.111', '1.1..', '1.1..'];

/** 多宝格龛口上角的牙子（左上角，9×6）：云头形的木雕挂牙。1 = 木色，2 = 描金。 */
export const BRACKET = ['222222222', '211111112', '21111122.', '2112.2...', '212......', '22.......'];

/** 横梁上的回纹带（一段 8×5，横向平铺）。1 = 纹色。 */
export const FRET = ['11111111', '1......1', '1.1111.1', '1.1..1.1', '1.1..111'];

/** 分隔线中间的菱形（5×3）。 */
export const DIAMOND = ['..1..', '.111.', '..1..'];

/** 墙上的暗纹：菱花格（16×16，平铺起来是一张斜格子窗棂）。1 = 纹色。 */
export const LATTICE: string[] = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x === y || x === 15 - y ? '1' : '.')).join(''));

export type Template = string[];
/** 模板换色：1 / 2 换成调色板字符，'.' 保持透明。 */
export const tint = (t: Template, c1: string, c2 = c1): Grid => grid(t.map((r) => r.replace(/1/g, c1).replace(/2/g, c2)));
/** 左右 / 上下翻转一个模板（框角四个方向用）。 */
export const flipT = (t: Template, h: boolean, v: boolean): Template => {
  const rows = v ? [...t].reverse() : t;
  return h ? rows.map((r) => [...r].reverse().join('')) : rows;
};

// ---------------------------------------------------------------- 功法（第 3 / 8 / 13 / 18 级悟得，见 sim/techniques.ts）
// 每门一个徽记：不画实物法宝，画这门功法的「意象」（三昧火舌、莲花、风火轮、太极、金刚杵、雷云、冰晶、竖目、聚灵阵、打坐的修士、五行珠、法相）。
// （类型引入放在这一段里，免得和别的分支在文件头的引入行上冲突。）
import type { TechniqueId } from '../../sim/types.ts';

export const TECH_ICONS: Record<TechniqueId, Grid> = {
  // 三昧真火：三道火舌（中间最高），焰心是灵光
  sanmei: icon([
    '......Y.....',
    '.....YoY....',
    '.....oeo....',
    '..Y..oeo..Y.',
    '..o.oeYeo.o.',
    '.oe.oeYeo.eo',
    '.oeoeYfYeoeo',
    '.eoeoYffYoeo',
    'eoeoYffffYoe',
    'eoeYffWWffYe',
    'reoYfWWWWfYr',
    '.reoYffffYer',
    '..rreooooer.',
    '...RRrrrrR..',
  ]),
  // 莲花化身：一朵盛开的莲（桃红花瓣、缃色莲蓬），下面一片莲叶
  lianhua: icon([
    '......w......',
    '.....wmw.....',
    '..w..mmm..w..',
    '.wm..mpm..mw.',
    '.mmw.mpm.wmm.',
    '.mmmwmpmwmmm.',
    'w.mmmmpmmmm.w',
    'mm.mmpppmm.mm',
    '.mmmmpYpmmmm.',
    '..mmpYYYpmm..',
    '...PPpppPP...',
    '.llvvvvvvvll.',
    '..GvvvvvvvG..',
  ]),
  // 风火轮：滚动的金轮，轮里一圈火，轮后拖着火尾
  fenghuo: icon([
    '........yYYy..',
    '......yYbbbbYy',
    '..o..yb.eooe.b',
    '.oe..Y.eoYYoeb',
    'oeo.Yb.ob..oeY',
    'eYe.YeoYbfbYoY',
    '.eoeYeoYbbbYoy',
    '..eoyb.ob..oeb',
    '.oerrb.eoYYoeb',
    'oe.rr.b.eooe.b',
    '.r.....bbbbbb.',
    '........bbbb..',
  ]),
  // 混元一气：太极（月白与黛蓝两半，两点互含）
  hunyuan: icon([
    '....CCCCN....',
    '...CwwwwCN...',
    '..CwwwnwwnN..',
    '.CwwwnnnwwnN.',
    'CwwwwwwwwwnnN',
    'CwwwwwwwwnnnN',
    'CwwwwwwnnnnnN',
    'CwwwnnnnnnnnN',
    'CwwnnnnnnnnnN',
    '.CwnnwwwnnnN.',
    '..CnnnwnnnN..',
    '...CNnnnnN...',
    '....CNNNN....',
  ]),
  // 金刚不坏：金刚杵（两头五股合拢，中间朱红握柄嵌宝珠）
  jingang: icon([
    '.....Y.....',
    '...y.Y.y...',
    '..yY.Y.Yy..',
    '..yY.Y.Yb..',
    '..byYYYyb..',
    '...bbyBb...',
    '....rer....',
    '...rYfYr...',
    '....rer....',
    '...bbyBb...',
    '..byYYYyb..',
    '..yY.Y.Yb..',
    '..bY.Y.Yb..',
    '...b.Y.b...',
  ]),
  // 五雷正法：一团雷云，劈下一道金雷
  wulei: icon([
    '.....ghhg.....',
    '...gghiihgg...',
    '..ghiiiiihhgg.',
    '.ghhiiihhhhhg.',
    'gdhhhhhhhhhhdg',
    '.gddgdYYdgddg.',
    '......Yy......',
    '.....Yy.......',
    '....YYYYy.....',
    '......Yy......',
    '.....Yy.......',
    '....Yy........',
    '....f.........',
  ]),
  // 寒冰诀：冰晶
  hanjue: icon([
    '......W......',
    '...C..w..C...',
    '....C.w.C....',
    '.C...cwc...C.',
    '..C.ccwcc.C..',
    '...cCwCwCc...',
    'Wwwwwwfwwwwww',
    '...cCwCwCc...',
    '..C.ccwcc.C..',
    '.C...cwc...C.',
    '....C.w.C....',
    '...C..w..C...',
    '......W......',
  ]),
  // 天眼通：竖目（金睑、天青瞳）
  tianyan: icon(
    [
      '.....Y.....',
      '....yYy....',
      '...yw.wy...',
      '...ywcwy...',
      '..ywcCcwy..',
      '..ywcWcwy..',
      '..ycCNCcy..',
      '..ywcCcwy..',
      '...ywcwy...',
      '...yw.wy...',
      '....yYy....',
      '.....Y.....',
    ],
    ['................', '................', '................', '.f............f.', '................', '..f..........f..', '................', '..f..........f..', '................', '.f............f.'],
  ),
  // 聚灵阵：金线阵环，灵气旋进阵心的灵石
  lingzhen: icon([
    '....b.yy.b....',
    '..y.......C.y.',
    '.y..c......C..',
    '..C.......c..y',
    'b.c....C......',
    'y.....CWC...C.',
    'y....CWWwC..c.',
    '.C...cWwCc...y',
    '.c....cCc.....',
    'y......c....C.',
    '..C.........c.',
    '.y..C.....c..y',
    '..y..cC.Cc..y.',
    '....b.yy.b....',
  ]),
  // 吐纳术：盘坐的修士，头顶升起一缕灵气
  tuna: icon([
    '......C......',
    '.....C.C.....',
    '......C......',
    '.....ddd.....',
    '....dtttd....',
    '....dtttd....',
    '.....dsd.....',
    '...vlllllv...',
    '..vllLLLllv..',
    '..vlvlllvlv..',
    '.vllvtttvllv.',
    'vlllllllllllv',
    '.GvvvvvvvvvG.',
  ]),
  // 五行轮转：五色灵珠绕成一圈（木 → 火 → 土 → 金 → 水）
  lunzhuan: icon([
    '.....lLl.....',
    '....lLvlv....',
    '..i..vlv..i..',
    '.i....v....i.',
    'cCc.......oYo',
    'nWcn.....eoYe',
    '.cn.......reo',
    'i...........i',
    '.i.........i.',
    '..yY.....bY..',
    '.yWYy...byYb.',
    '..yby.i.Bbb..',
    '......i......',
  ]),
  // 法天象地：踏云而立的金身法相
  fatian: icon([
    '......Y......',
    '.....YfY.....',
    '.....yYy.....',
    '......b......',
    '..yYYYYYYYy..',
    '.y..yYYYy..y.',
    'y...yYfYy...y',
    '....yYYYy....',
    '....yy.yy....',
    '....yb.by....',
    '..wjjwjjwjjw.',
    '.wjjjjjjjjjjw',
    '..jjj.jjj.jj.',
  ]),
  // ---- 2026-11-12 再加的 12 门 ----
  // 掌心雷：摊开的手掌，掌心上方迸一道金雷、两点天青电光
  zhangxin: icon([
    '.....f.......',
    '....fY..C....',
    '.C...Yf......',
    '.....fY......',
    '......Y......',
    '..s.s.s.s....',
    '..t.t.t.t....',
    '..ttttttt..s.',
    '..tttttttsst.',
    '..ttttttttts.',
    '..sttttttts..',
    '...sttttts...',
    '...nnnnnnn...',
    '..nNnnnnnNn..',
  ]),
  // 六丁六甲：三道黄符并立（中间一道最高），朱砂符文
  liuding: icon([
    '.....YYY.....',
    '.....YrY.....',
    '.yyy.YYY.yyy.',
    '.yry.YrY.yry.',
    '.yYy.YrY.yYy.',
    '.yry.YYY.yry.',
    '.yYy.YrY.yYy.',
    '.yry.YrY.yry.',
    '.yyy.YYY.yyy.',
    '..r..YrY..r..',
    '..r..YYY..r..',
    '......r......',
    '......r......',
  ]),
  // 斩三尸：一柄剑斜斩而下，三缕紫气（三尸）被斩散
  zhansan: icon([
    '...........Wz',
    '..........WTz',
    '.........WT..',
    '..p.....WT...',
    '.pPp...WT....',
    '..P...WT..p..',
    '.....WT..pPp.',
    '....WT....P..',
    '..bbT........',
    '..yb.........',
    '.yb...p......',
    'yb...pPp.....',
    'b.....P......',
  ]),
  // 紫气东来：几缕紫气自东飘来，下面半轮初升的日
  ziqi: icon([
    '.........pp..',
    '.......ppmmp.',
    '.....ppmmpp..',
    '...ppmmpp....',
    '..pmmpp......',
    '...pp........',
    '........ppp..',
    '.....ppmmmp..',
    '...ppmmpp....',
    '.............',
    '.....oyYYo...',
    '....oyYffYo..',
    '...eoyYYYYoe.',
  ]),
  // 五鬼搬运：一锭元宝，两只小鬼影托着往上抬
  wugui: icon([
    '.www.....www.',
    'wCkCw...wCkCw',
    'wCCCw...wCCCw',
    '.wCw.....wCw.',
    '..cC.....Cc..',
    '...c.....c...',
    '.yY.......Yy.',
    '.yYy.....yYy.',
    '.byYyYYYyYyb.',
    '..byyYfYyyb..',
    '...bbbbbbb...',
  ]),
  // 土遁：隆起的土丘，几块碎石往上迸
  tudun: icon([
    '..zx.....xz..',
    '..xu.....ux..',
    '......zx.....',
    '......xu.....',
    '.............',
    '.....aEa.....',
    '....aEEEa....',
    '...aEaAaEa...',
    '..AaAAEAaAA..',
    '.DAAADAAAAAD.',
    'DDADDDAADDADD',
    '.DDDDDDDDDDD.',
  ]),
  // 九转玄功：一道金色的气旋，一圈圈往里转
  jiuzhuan: icon([
    '....yYYYy....',
    '..yY.....Yy..',
    '.y..bYYYb..y.',
    'y..Y.....Y..y',
    'Y.Y..yYy..Y.Y',
    'Y.Y.Y.f.Y.Y.Y',
    'Y.Y.Y..Y..Y.Y',
    'y..Y.YY..Y..y',
    '.y..Y...Y..y.',
    '..Y..YYY..y..',
    '...Yy...yY...',
    '.....YYY.....',
  ]),
  // 太乙真诀：一柄拂尘（太乙真人随身之物），尾梢一点天青
  taiyi: icon([
    '.........bY..',
    '........bB...',
    '.......bB....',
    '......bB.....',
    '.....yy......',
    '....wjw......',
    '...wjwj......',
    '..wjwjw......',
    '.wjwjwj......',
    '.jwjwj.......',
    'wjwjw........',
    'jwj.j........',
    'C.j..........',
  ]),
  // 独修一脉：三朵小花，花茎聚到一处
  sanhua: icon([
    '......w......',
    '.....wmw.....',
    '......Y......',
    '..w...l...w..',
    '.wmw..l..wmw.',
    '..Y...l...Y..',
    '...l..l..l...',
    '....l.l.l....',
    '.....lll.....',
    '......l......',
    '.....vlv.....',
    '....CC.CC....',
  ]),
  // 五色神光：五色之气（金木水火土）往上聚到一点灵光
  wuqi: icon([
    '......f......',
    '.....fWf.....',
    '......f......',
    '..L.......o..',
    '...l.....e...',
    '.l..l...e..o.',
    '..l..l.e..e..',
    '......C......',
    '..y...c...b..',
    '.y.y..c..b.b.',
    'Y...y.n.b...b',
    '.....yn......',
  ]),
  // 撒豆成兵：一个金甲豆兵执戟而立，脚下撒着几粒豆
  sadou: icon([
    '.......i.....',
    '......iWi....',
    '.....yyi.....',
    '....yYYy.....',
    '....ytty.i...',
    '...bYYYYbi...',
    '...yYbYYyi...',
    '....YYYY.i...',
    '....b..b.i...',
    '...bb..bb....',
    '.............',
    '.Bb..Bb...bB.',
    '..B.......B..',
  ]),
  // 呼风唤雨：一团雨云，斜着落下几道雨
  hufeng: icon([
    '....hiih.....',
    '..hhijjih....',
    '.hijjjjjihh..',
    'hijjjjjjjjih.',
    '.hhiiiiiiihh.',
    '.....C....C..',
    '..C....c.....',
    '.c...C....C..',
    '....c...c....',
    '..C....C..c..',
    '.c...c.......',
    '.......c.....',
  ]),
};
