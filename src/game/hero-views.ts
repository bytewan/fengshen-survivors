// 角色框架（表现这一半）：每个角色的人物帧、画布与锚点、对白头像、称号、对白名字牌颜色、战后对白，
// 以及「这一帧该用哪一组帧」。模拟的那一半（主五行、专属法宝、宠物种类、神通、被动）在 sim/catalog.ts 的 HEROES。
// 神通、专属法宝、被动的画面在 game/heroes/（HeroFx 按事件分派），宠物的画面按种类分派在 game/pets/。
// 加一个角色：在下面的 HERO_VIEWS 加一行（帧在 src/art/sprites/<id>.ts 画），再照 game/heroes/index.ts 的文件头接他的画面。
import type { Grid } from '../art/pixel.ts';
import { DEFAULT_HAIR, makeNezhaFrames, NEZHA_ANCHOR, NEZHA_H, NEZHA_W } from '../art/sprites/nezha.ts';
import { makeYangjianFrames, YANGJIAN_ANCHOR, YANGJIAN_H, YANGJIAN_W } from '../art/sprites/yangjian.ts';
import { makeZhaoFrames, ZHAO_ANCHOR, ZHAO_H, ZHAO_W } from '../art/sprites/zhao.ts';
import { DEMON_ANCHOR, DEMON_H, DEMON_W, makeMozhaFrames } from '../art/sprites/demon-nezha.ts';
import { echoTone, tone, YUNXIAO_TONE } from '../art/sprites/echo-tone.ts';
import { makeYunxiaoFrames, YUNXIAO_ANCHOR, YUNXIAO_H, YUNXIAO_W } from '../art/sprites/yunxiao.ts';
import { LEIZHENZI_ANCHOR, LEIZHENZI_H, LEIZHENZI_W, makeLeizhenziFrames } from '../art/sprites/leizhenzi.ts';
import { makeWukongFrames, WUKONG_ANCHOR, WUKONG_H, WUKONG_W } from '../art/sprites/wukong.ts';
import { AOBING_ANCHOR, AOBING_H, AOBING_W, makeAobingFrames } from '../art/sprites/aobing.ts';
import { ECHO, HEROES, chapterOf, isBossWave, waveInChapter } from '../sim/catalog.ts';
import type { HeroId, Player } from '../sim/types.ts';
import { BOSS_AFTER, BOSS_BARKS, CH3_GATE, WAVE_LINES } from './story.ts';

/**
 * 人物的帧有这几组（每个角色都有）：idle / move 待机、跑；idleBare / moveBare 手里没有法宝时（哪吒的乾坤圈飞出去了、
 * 杨戬的刀正由特效挥着）；windup / throw / follow 出手的三个姿势；hurt 受击、down 倒下（哪吒没画这两组，用待机代替）。
 * 会飞的角色另有 fly / dive / slam（雷震子「风雷翅」的腾空、俯冲、砸下；展开的翅膀由他的画面模块另画）：没画的角色没有这几组，
 * 用到时退回这一帧的基本姿势（feel.ts 的 drawHero）。
 */
export type CorePose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down';
export type FlyPose = 'fly' | 'dive' | 'slam';
export type HeroPose = CorePose | FlyPose;
export const HERO_POSES: CorePose[] = ['idle', 'move', 'idleBare', 'moveBare', 'windup', 'throw', 'follow', 'hurt', 'down'];
/** 一个角色的全部帧：每个角色都有的那几组，加上可有可无的飞行几组。 */
export type HeroFrames = Record<CorePose, Grid[]> & Partial<Record<FlyPose, Grid[]>>;

export interface HeroView {
  /** 生成全部帧（只在第一次用到时生成，见 heroFrames）。 */
  make(): HeroFrames;
  /** 画布的宽高和脚底锚点。 */
  w: number;
  h: number;
  anchor: { x: number; y: number };
  /** 联机时头顶名字签的高度（离脚底多少像素：头顶再往上一点）。 */
  tag: number;
  /** 对白的像素头像：从待机第一帧上裁下头部（x, y, 宽, 高）。 */
  face: [number, number, number, number];
  /** 选角页的称号：[宽版, 窄版]。 */
  epithet: [string, string];
  /** 对白里名字牌的颜色。 */
  nameColor: string;
  /** 万宝阁里的小立绘要不要裁掉画布两边的空白（杨戬的画布比人宽，给前倾的刀留了地方）。 */
  cropPortrait?: boolean;
  /** 有没有自己画受击 / 倒下的帧（没有就用待机的帧，靠闪色表现）。 */
  hurtFrames: boolean;
  /**
   * 掷出类的出手（模拟的 throw 事件：乾坤圈，也包括公共法宝斩仙飞刀、七禽扇这些）时，人物要不要换成掷出 → 收手的姿势。
   * 哪吒要（乾坤圈本来就是掷出去的）；杨戬不要：他的出招姿势（横扫、刺出）由三尖两刃刀的特效给（game/heroes/），
   * 飞刀这类出得很勤，每次都换姿势他就一直在往前刺。
   */
  throwPose: boolean;
  /** 宠物换成暗色（回响化身：魔化哪吒的黑绫……；宠物的行为不变，只是画面换色）。 */
  petTint?: 'dark';
}

export const HERO_VIEWS: Record<HeroId, HeroView> = {
  nezha: {
    make: () => {
      const f = makeNezhaFrames(DEFAULT_HAIR);
      return { ...f, hurt: f.idle, down: f.idle };
    },
    w: NEZHA_W,
    h: NEZHA_H,
    anchor: NEZHA_ANCHOR,
    tag: NEZHA_ANCHOR.y + 2,
    face: [7, 1, 18, 15],
    epithet: ['莲花化身 · 陈塘关三太子', '莲花化身'],
    nameColor: '#f2e8d5',
    hurtFrames: false,
    throwPose: true,
  },
  yangjian: {
    make: makeYangjianFrames,
    w: YANGJIAN_W,
    h: YANGJIAN_H,
    anchor: YANGJIAN_ANCHOR,
    tag: 35, // 冠顶离脚底 31 像素
    face: [13, 6, 18, 15],
    epithet: ['清源妙道真君 · 灌江口二郎', '二郎真君'],
    nameColor: '#e0a83a', // 藤黄：主五行金的颜色，墨底上看得清
    cropPortrait: true,
    hurtFrames: true,
    throwPose: false,
  },
  zhao: {
    make: makeZhaoFrames,
    w: ZHAO_W,
    h: ZHAO_H,
    anchor: ZHAO_ANCHOR,
    tag: 35, // 冠顶（冠上的朱珠）离脚底 31 像素
    face: [13, 6, 18, 15],
    epithet: ['玄坛真君 · 峨眉山罗浮洞', '武财神'],
    nameColor: '#d08a64', // 绛：主五行土的暖色，比土行的琥珀亮一档，墨底上看得清
    cropPortrait: true,
    hurtFrames: true,
    throwPose: false, // 定海珠从身边绕着的珠子里飞出去，不用掷出的姿势；神通「金鞭」的举鞭、砸下由 game/heroes/ 给
  },
  yunxiao: {
    make: makeYunxiaoFrames,
    w: YUNXIAO_W,
    h: YUNXIAO_H,
    anchor: YUNXIAO_ANCHOR,
    tag: 36, // 髻顶离脚底 32 像素
    face: [13, 6, 18, 15],
    epithet: ['三霄之首 · 三仙岛', '三霄之首'],
    nameColor: '#7cc4c4', // 天青：主五行水的亮色（石青在墨底上太暗）
    cropPortrait: true,
    hurtFrames: true,
    // 她的出手姿势（放金斗、九曲黄河时掐诀、剑指一点）由 game/heroes/ 给；公共法宝掷出时不换姿势（和杨戬一样，出得勤就一直在比划）
    throwPose: false,
  },
  leizhenzi: {
    make: makeLeizhenziFrames,
    w: LEIZHENZI_W,
    h: LEIZHENZI_H,
    anchor: LEIZHENZI_ANCHOR,
    tag: 36, // 冠顶离脚底 33 像素
    face: [13, 5, 18, 15],
    epithet: ['风雷二翅 · 文王百子', '风雷二翅'],
    nameColor: '#b8d67a', // 葱黄：主五行木的亮色（石绿在墨底上太暗）
    cropPortrait: true,
    hurtFrames: true,
    throwPose: false,
  },
  // 魔化哪吒（回响化身）：第一章首领的那一套美术（本来就和哪吒一样大），手里不拿乾坤圈；画布比哪吒大，是给前刺的枪留的地方
  mozha: {
    make: () => makeMozhaFrames(DEFAULT_HAIR),
    w: DEMON_W,
    h: DEMON_H,
    anchor: DEMON_ANCHOR,
    tag: 32, // 和哪吒一样：发髻顶离脚底约 30 像素
    face: [13, 5, 18, 15],
    epithet: ['回响化身 · 陈塘关的另一面', '回响化身'],
    nameColor: '#d47aa0', // 桃红：黑紫红的魔化哪吒在墨底上的名字牌（朱砂太接近哪吒）
    cropPortrait: true,
    hurtFrames: false,
    throwPose: false, // 黑焰轮从脚下滚出去，不用掷出的姿势；神通的端枪、冲、收枪由 game/heroes/ 给
    petTint: 'dark', // 混天绫换成黑绫
  },
  // 回响赵公明（回响化身）：第二章遭遇战的那一套美术——赵公明本人换成回响的冷色（art/sprites/echo-tone.ts），和本人一样大
  huizhao: {
    make: () => {
      const f = makeZhaoFrames();
      return Object.fromEntries(Object.entries(f).map(([k, gs]) => [k, gs.map(echoTone)])) as Record<HeroPose, Grid[]>;
    },
    w: ZHAO_W,
    h: ZHAO_H,
    anchor: ZHAO_ANCHOR,
    tag: 35, // 和赵公明本人一样（帧是本人换色的）
    face: [13, 6, 18, 15],
    epithet: ['回响化身 · 西岐城外的旧魂', '回响化身'],
    nameColor: '#a8d8d0', // 魂火的天青（和云霄的天青分开一点，偏绿白）
    cropPortrait: true,
    hurtFrames: true,
    throwPose: false,
    petTint: 'dark', // 黑虎换成回响色的魂虎
  },
  // 回响云霄（回响化身）：第三章遭遇战的那一套美术——云霄本人往暗里压一档（art/sprites/echo-tone.ts 的 YUNXIAO_TONE），和本人一样大
  huiyun: {
    make: () => {
      const f = makeYunxiaoFrames();
      return Object.fromEntries(Object.entries(f).map(([k, gs]) => [k, gs.map((g) => tone(g, YUNXIAO_TONE))])) as Record<HeroPose, Grid[]>;
    },
    w: YUNXIAO_W,
    h: YUNXIAO_H,
    anchor: YUNXIAO_ANCHOR,
    tag: 36, // 和云霄本人一样（帧是本人换色的）
    face: [13, 6, 18, 15],
    epithet: ['回响化身 · 麒麟崖下的旧魂', '回响化身'],
    nameColor: '#8fb8d0', // 黛蓝里提亮的一档（和云霄的天青分开）
    cropPortrait: true,
    hurtFrames: true,
    throwPose: false,
    petTint: 'dark', // 青鸾换成回响色的玄鸾
  },
  // 回响敖丙（回响化身）：第一章首领池里的敖丙那一套帧（art/sprites/aobing.ts；他没有「本人」，帧不换色）
  huiao: {
    make: makeAobingFrames,
    w: AOBING_W,
    h: AOBING_H,
    anchor: AOBING_ANCHOR,
    tag: 37,
    face: [11, 6, 18, 15],
    epithet: ['回响化身 · 东海三太子', '回响化身'],
    nameColor: '#9fd3d6', // 冰的天青
    cropPortrait: true, // 画布右边给刺出去的戟留了地方
    hurtFrames: true,
    throwPose: false, // 出手的姿势由游龙戟的事件给（game/heroes/index.ts 的 loong）
  },
  wukong: {
    make: makeWukongFrames,
    w: WUKONG_W,
    h: WUKONG_H,
    anchor: WUKONG_ANCHOR,
    tag: 34, // 冠顶离脚底 31 像素（雉鸡翎再往上，名字签压在翎子上也无妨）
    face: [14, 12, 18, 15],
    epithet: ['齐天大圣 · 花果山水帘洞', '齐天大圣'],
    nameColor: '#b8d67a', // 葱黄：主五行木的亮色，墨底上看得清
    cropPortrait: true,
    hurtFrames: true,
    throwPose: false, // 金箍棒的横扫、竖劈由 game/heroes/jingu-fx.ts 给姿势
  },
};

const cache = new Map<HeroId, HeroFrames>();
/** 这个角色的全部帧（整个会话只生成一次）。 */
export function heroFrames(id: HeroId): HeroFrames {
  let f = cache.get(id);
  if (!f) {
    f = HERO_VIEWS[id].make();
    cache.set(id, f);
  }
  return f;
}

/** 对白头像：从待机第一帧上裁下头部。 */
export function heroFace(id: HeroId): Grid {
  const [x, y, w, h] = HERO_VIEWS[id].face;
  const g = heroFrames(id).idle[0];
  return { w, h, rows: g.rows.slice(y, y + h).map((r) => r.slice(x, x + w)) };
}

/** 万宝阁的小立绘：待机的几帧（杨戬的裁掉画布两边的空白，几帧裁同一块）。 */
export function portraitFrames(id: HeroId): Grid[] {
  const fs = heroFrames(id).idle;
  if (!HERO_VIEWS[id].cropPortrait) return fs;
  let x0 = Infinity;
  let x1 = -1;
  for (const g of fs)
    g.rows.forEach((r) =>
      [...r].forEach((c, x) => {
        if (c === '.') return;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }),
    );
  return fs.map((g) => ({ w: x1 - x0 + 1, h: g.h, rows: g.rows.map((r) => r.slice(x0, x1 + 1)) }));
}

/**
 * 这一帧的基本姿势（没有在出手、受击时）：跑还是站，手里有没有法宝。
 * bare：手里的法宝不在手上（哪吒：主圈飞出去了；杨戬：刀正由特效挥着，见 game/heroes/）。
 */
export function basePose(p: Player, bare: boolean): HeroPose {
  if (p.moving) return bare ? 'moveBare' : 'move';
  return bare ? 'idleBare' : 'idle';
}

/** 手里的法宝在不在手上：哪吒看乾坤圈的主圈飞没飞出去；别的角色由他的画面模块说了算（busy）。 */
export const heroBare = (p: Player, busy: boolean) => (p.hero === 'nezha' ? p.ringOut : busy);

/**
 * 打赢首领之后的对白（story.ts 的 BOSS_AFTER 是哪吒的那一套）：别的角色有自己的台词就换成他的。
 * 第一章的魔化哪吒对杨戬（暂拟，待剧情评审）：两人都是肉身成圣、不在封神榜上，所以「所有不在榜上的人」这一句对杨戬也成立。
 * 第三章的诛仙剑灵对杨戬（暂拟，待审阅）：剑灵说门后的东西天眼也看不穿，杨戬说那就开门亲眼去看；最后一句旁白和哪吒的同一句
 * （CH3_GATE：有结尾过场时交给过场的第一镜）。
 */
export const HERO_BOSS_AFTER: Partial<Record<HeroId, Record<number, { who: string | null; text: string; cue?: string }[]>>> = {
  yangjian: {
    1: [
      { who: '魔化哪吒', text: '杨戬……连你也来斩我？' },
      { who: '杨戬', text: '我斩的是这道回响，不是你。' },
      { who: '魔化哪吒', text: '可封神榜不会放过我们。\n它在召唤我们——所有不在榜上的人。' },
      { who: null, text: '魔化哪吒化作灰烬，被风吹向天上的裂缝。\n杨戬收刀，额上的天眼久久没有合上。', cue: 'dissolve' },
    ],
    2: [
      { who: '姚天君', text: '榜上有名……\n死了，还要再死一次。' },
      { who: null, text: '姚天君散成一缕灰烟，落进脚下的阵眼。\n杨戬额上的天眼一亮：阵眼底下压着一角焦黄的残页。', cue: 'dissolve' },
      { who: '杨戬', text: '封神榜的残页……被压在阵眼里。' },
      { who: null, text: '十座阵眼，十角残页。\n有人在用旧阵，养一张新榜。' },
    ],
    3: [
      { who: '诛仙剑灵', text: '阵心之后的东西，\n你的天眼也看不穿。' },
      { who: '杨戬', text: '那就开了这道门，\n亲眼去看。' },
      { who: null, text: CH3_GATE, cue: 'dissolve' },
    ],
  },
  // 赵公明（暂拟，待剧情评审）：和哪吒、杨戬不一样，他是榜上有名的（死在西岐城外，陆压拜草人、钉头七箭射死，后封玄坛真君），
  // 所以魔化哪吒那句核心的话对他换了说法；第二章的十天君是他当年的同道（闻太师请他下山，就是来助十绝阵的），姚天君认得他。
  zhao: {
    1: [
      { who: '魔化哪吒', text: '你死过一回……\n还要替封神榜收拾残局？' },
      { who: '赵公明', text: '我是死过一回。\n这一回，站在哪边，我自己挑。' },
      { who: '魔化哪吒', text: '它在召唤我们——\n不在榜上的，和已经在榜上的。' },
      { who: null, text: '魔化哪吒化作灰烬，被风吹向天上的裂缝。\n黑虎伏在赵公明脚边，冲着那道裂缝低低地吼了一声。', cue: 'dissolve' },
    ],
    2: [
      { who: '姚天君', text: '赵道兄……\n我们都死在这里，你却还站着。' },
      { who: null, text: '姚天君散成一缕灰烟，落进脚下的阵眼。\n黑虎刨开阵眼的土：底下压着一角焦黄的残页。', cue: 'dissolve' },
      { who: '赵公明', text: '封神榜的残页……\n上面的墨，还是湿的。' },
      { who: null, text: '十座阵眼，十角残页。\n有人在用旧阵，养一张新榜。' },
    ],
    // 第三章：诛仙阵是截教通天教主的阵，赵公明也是截教门下（当年死在诛仙阵之前）；剑灵问他为什么替阐教开门
    3: [
      { who: '诛仙剑灵', text: '你是截教的人……\n为何替阐教开这道门？' },
      { who: '赵公明', text: '我不替谁开门。\n我只想看看，是谁在翻那张榜。' },
      { who: null, text: CH3_GATE, cue: 'dissolve' },
    ],
  },
  // 云霄（暂拟，待审阅）：截教三霄之首，封神之后是榜上的「感应随世仙姑」——榜在召唤她，她听得见，也守得住（冰心）
  yunxiao: {
    1: [
      { who: '魔化哪吒', text: '截教的娘娘……你又何苦来斩我？' },
      { who: '云霄', text: '我斩的是回响。你是你，回响是回响。' },
      { who: '魔化哪吒', text: '你也是榜上的人。\n它在召唤我们——你也听得见。' },
      { who: null, text: '魔化哪吒化作灰烬，被风吹向天上的裂缝。\n云霄收起金斗，斗里的混元之气久久不平。', cue: 'dissolve' },
    ],
    2: [
      { who: '姚天君', text: '榜上有名……\n道友，你我都要再死一次。' },
      { who: null, text: '姚天君散成一缕灰烟，落进脚下的阵眼。\n云霄的金斗一倾，从阵眼里吸出一角焦黄的残页。', cue: 'dissolve' },
      { who: '云霄', text: '封神榜的残页……压在截教的阵眼里。' },
      { who: null, text: '十座阵眼，十角残页。\n有人在用旧阵，养一张新榜。' },
    ],
    // 第三章：诛仙阵是她师尊通天教主的阵，剑灵认得她
    3: [
      { who: '诛仙剑灵', text: '截教的弟子……\n也要来开这道门？' },
      { who: '云霄', text: '师尊的阵，不该困着回响。\n我替他开。' },
      { who: null, text: CH3_GATE, cue: 'dissolve' },
    ],
  },
  // 雷震子（暂拟，待审阅）：周文王的第一百个儿子（燕山雷雨里拾来的义子），云中子的徒弟；吃了两枚仙杏生出风雷二翅，
  // 下山时背着父亲飞过五关、一棍打下一块山头吓退追兵。肉身成圣、不在榜上——魔化哪吒那句核心的话对他原样成立
  leizhenzi: {
    1: [
      { who: '魔化哪吒', text: '雷震子……\n你也没上榜。' },
      { who: '雷震子', text: '没上榜的人，\n才飞得出这一场劫。' },
      { who: '魔化哪吒', text: '可封神榜不会放过我们。\n它在召唤我们——所有不在榜上的人。' },
      { who: null, text: '魔化哪吒化作灰烬，被风吹向天上的裂缝。\n雷震子收拢双翅，羽尖还在噼啪作响。', cue: 'dissolve' },
    ],
    2: [
      { who: '姚天君', text: '榜上有名……\n死了，还要再死一次。' },
      { who: null, text: '姚天君散成一缕灰烟，落进脚下的阵眼。\n一道雷劈开阵眼的土：底下压着一角焦黄的残页。', cue: 'dissolve' },
      { who: '雷震子', text: '封神榜的残页……\n埋得这么深，是怕谁看见？' },
      { who: null, text: '十座阵眼，十角残页。\n有人在用旧阵，养一张新榜。' },
    ],
    3: [
      { who: '诛仙剑灵', text: '阵心之后的东西，\n你飞得过去吗？' },
      { who: '雷震子', text: '五关我都背着父王飞过来了。\n一道门，拦不住我。' },
      { who: null, text: CH3_GATE, cue: 'dissolve' },
    ],
  },
  // 孙悟空（隐藏角色；暂拟，待剧情评审）：他是从千年以后掉进回响的（榜裂之后时间也乱了），
  // 认得这些人在他那个年头的样子——哪吒后来跟着托塔天王来捉过他、他在龙宫借过金箍棒、在地府勾过生死簿；他不在榜上，也不属于这个年头
  wukong: {
    1: [
      { who: '魔化哪吒', text: '你又是谁……\n身上没有榜的味道。' },
      { who: '孙悟空', text: '千年以后，你会踩着风火轮来捉俺老孙。\n现在的你，可比那时候凶多了。' },
      { who: '魔化哪吒', text: '它在召唤我们——\n连不该在这里的，也召来了。' },
      { who: null, text: '魔化哪吒化作灰烬，被风吹向天上的裂缝。\n孙悟空把金箍棒往肩上一扛，眯着火眼金睛看那道缝。', cue: 'dissolve' },
    ],
    2: [
      { who: '姚天君', text: '拜草人、勾魂魄……\n你的魂，怎么勾不走？' },
      { who: '孙悟空', text: '俺的名字早从生死簿上勾掉了，\n你拿什么勾？' },
      { who: null, text: '姚天君散成一缕灰烟，落进脚下的阵眼。\n孙悟空一棒撬开阵眼：底下压着一角焦黄的残页。', cue: 'dissolve' },
      { who: '孙悟空', text: '封神榜……\n天宫里供着的那一张，原来是从这儿来的。' },
      { who: null, text: '十座阵眼，十角残页。\n有人在用旧阵，养一张新榜。' },
    ],
    3: [
      { who: '诛仙剑灵', text: '你不在榜上，也不在这个年头。\n为什么要开这道门？' },
      { who: '孙悟空', text: '俺掉进来，就得找到出去的路。\n门后面有什么，打开看看。' },
      { who: null, text: CH3_GATE, cue: 'dissolve' },
    ],
  },
};

/**
 * 过场里本机玩家的角色说的那一句（story.ts 的 CutBeat.heroSay）：这一章战后对白里，散去的那一句（cue: 'dissolve'）之后他说的第一句。
 * 有收尾过场时对白框只放散去之前的那几句（story.ts 的 beforeCut），这一句就挪到过场里（第二章：从阵眼里翻出残页之后的那一句）。没有就是 null。
 */
export function heroCutLine(hero: HeroId, chapter: number): { who: string; text: string; color: string } | null {
  const lines = HERO_BOSS_AFTER[hero]?.[chapter] ?? BOSS_AFTER[chapter] ?? [];
  const name = HEROES[hero].name;
  const from = lines.findIndex((l) => l.cue === 'dissolve');
  const l = lines.slice(from + 1).find((x) => x.who === name);
  return l ? { who: name, text: l.text, color: HERO_VIEWS[hero].nameColor } : null;
}

/**
 * 首领战里首领对玩家说的话（story.ts 的 BOSS_BARKS 是对哪吒说的那一套）：别的角色有自己的就换成他的（暂拟，待审阅）。
 * 第三章对杨戬：诛仙阵是截教的阵、当年是阐教破的（杨戬是阐教玉鼎真人的弟子）；一剑化四对着他的八九玄功（会变化）说；诛仙对着他的肉身成圣说。
 */
export const HERO_BOSS_BARKS: Partial<Record<HeroId, Record<number, { intro: string; phase2: string; phase3: string }>>> = {
  yangjian: {
    1: {
      intro: '杨戬？……这是我的关，不是你的。',
      phase2: '三头六臂——你的天眼，看得清哪一个是我？',
      phase3: '烧吧——连同这座关，连同你那只天眼。',
    },
    3: {
      intro: '阐教的门人……这座阵，还记得你们。',
      phase2: '一剑化四——会变的，不止你一个。',
      phase3: '此阵名诛仙。肉身成圣，也是仙。',
    },
  },
  zhao: {
    1: {
      intro: '赵公明？……榜上有名的人，来我的关做什么？',
      phase2: '你的珠子定得住海——定得住我吗？',
      phase3: '烧吧——榜上有名的，一样烧成灰。',
    },
    2: {
      intro: '赵道兄，你也回来了。这座阵，你认得。',
      phase2: '草人已拜。这一回，拜的是你。',
      phase3: '散了吧——一百年前，你就散在这里。',
    },
    3: {
      intro: '截教的门人……你是来守阵，还是来破阵？',
      phase2: '一剑化四——师尊的剑，你挡得住几把？',
      phase3: '此阵名诛仙。截教的仙，一样诛。',
    },
  },
  yunxiao: {
    1: {
      intro: '三霄娘娘？……截教的人，也来管陈塘关的事？',
      phase2: '你也是榜上的魂——你听见它在叫你吗？',
      phase3: '烧吧——连同这座关，连同你那两个妹妹的魂。',
    },
    2: {
      intro: '云霄道友……十绝阵里，原来还留着你的位子。',
      phase2: '草人拜魂——你兄长赵公明，就是这么散的。',
      phase3: '散了吧——散在阵里，和你兄长一样。',
    },
    3: {
      intro: '云霄……师尊的阵，你也要破？',
      phase2: '一剑化四——师尊的剑，你认得哪一把？',
      phase3: '此阵名诛仙。截教的门人，一样诛得。',
    },
  },
  // 雷震子：第一章魔化哪吒说他背父飞关的旧事；第二章姚天君说西岐（他父亲的城）；第三章剑灵说他师父云中子（阐教）当年在阵外
  leizhenzi: {
    1: {
      intro: '雷震子？……背着你父亲飞过五关的那一个。',
      phase2: '三头六臂——你那对翅膀，飞得出我这座关吗？',
      phase3: '烧吧——连同你的翅膀，一根羽毛也别剩。',
    },
    2: {
      intro: '西伯侯的第一百个儿子……这片黄土，你父亲也走过。',
      phase2: '草人已拜。你飞得再高，魂也在我铃里。',
      phase3: '散了吧——风雷也吹不散落魂阵的雾。',
    },
    3: {
      intro: '云中子的徒弟……你师父当年，也在这座阵外看过。',
      phase2: '一剑化四——你的风雷，追得上哪一把？',
      phase3: '此阵名诛仙。长了翅膀，也是仙。',
    },
  },
  // 孙悟空：首领们都不认得他（他从千年以后来），只当是一只闯阵的猴子；第三章的诛仙剑灵对着他的七十二变说
  wukong: {
    1: {
      intro: '猴子？……这是我的关，不是你的山。',
      phase2: '三头六臂——你变得出几个，我就分得出几个。',
      phase3: '烧吧——连同这座关，连同你那身金毛。',
    },
    2: {
      intro: '哪来的野猴，也敢闯我的落魂阵？',
      phase2: '草人已拜，七箭已钉——猴头，你的魂呢？',
      phase3: '散了吧——落魂阵里，没有回头的路。',
    },
    3: {
      intro: '来路不明的猴子……诛仙阵不认得你。',
      phase2: '一剑化四——你有七十二般变化，我有四把剑。',
      phase3: '此阵名诛仙。齐天大圣，也是仙。',
    },
  },
};

/** 波间旁白（story.ts 的 WAVE_LINES 写的是哪吒的旧事）：别的角色有自己的一套就换成他的（暂拟，待审阅）。null = 这一波没有。 */
export const HERO_WAVE_LINES: Partial<Record<HeroId, Record<number, string[]>>> = {
  yangjian: {
    1: [
      '回响里的兵，还在守一座早已不在的关。',
      '海水是黑的。天眼看得见，海底还压着龙宫的旧怨。',
      '鬼火绕着你转。它们不认得你，只认得生人的气。',
      '校尉的刀上，还沾着一百年前的血。',
      '关楼上有人在等。等的是另一个人。',
    ],
    // 第三章（暂拟，待审阅）：诛仙阵是截教的阵、当年是阐教破的，杨戬那一夜也在关前；天眼看得见剑气、看得见阵心后面的门；哮天犬闻得出傀儡里没有魂
    3: [
      '界牌关前，四把剑悬了一百年。破阵的那一夜，你也在关前。',
      '剑痕是新的。天眼看得见，石缝里还走着剑气。',
      '截教的门徒还在守阵。他们记得，是阐教破的这座阵。',
      '哮天犬冲着阵图傀儡低吼。石头里没有魂，只有阵。',
      '阵心有剑鸣。天眼看过去，四把剑后面，还有一道门。',
    ],
  },
  zhao: {
    1: [
      '回响里的兵，守着一座早就不在的关。他们的饷，一百年没发了。',
      '东海的水是黑的。袖里的定海珠，转得比平时急。',
      '鬼火绕着你转，又绕开了黑虎。',
      '校尉的刀上，还沾着一百年前的血。',
      '关楼上有人在等。等的不是你。',
    ],
    2: [
      '西岐城外。一百年前，你就倒在这片黄土上。',
      '十座阵台，十位旧相识。当年请你下山助阵的，就是他们。',
      '黑虎一直在嗅地上的土。这里埋过一个草人。',
      '风里有人在数日子：二十一天。和那一年一样。',
      '阵心有人在摇铃。铃声你听过——在你闭眼之前。',
    ],
    3: [
      '界牌关前，四把剑悬了一百年。它们认得你身上截教的气息。',
      '剑痕是新的。这些剑，昨夜还斩过人。',
      '截教的门徒还在守阵。他们叫你师兄，像一百年前那样。',
      '阵图傀儡不知道疼，也不知道阵早就破过一回。',
      '阵心有剑鸣。四把剑在喊同一个名字——是你师尊的。',
    ],
  },
  yunxiao: {
    1: [
      '东海之滨。三仙岛的潮声，传不到这里。',
      '海水是黑的。斗里的混元之气，也跟着沉了一沉。',
      '鬼火绕着你转。它们是榜上的魂——和你一样。',
      '校尉的刀，砍过西岐的人，也砍过三仙岛的人。',
      '关楼上有人在等。等的不是你。',
    ],
    2: [
      '西岐城外。一百年前，你也在这里摆过一座阵。',
      '十座阵台，都是截教道友的手笔。',
      '落魂幡底下，魂光一缕一缕地连着。像你兄长走的那一夜。',
      '红沙是从阵里漏出来的。黄河的水，也是这个颜色。',
      '阵心有人在摇铃。铃声你认得。',
    ],
    3: [
      '界牌关前，四把剑悬了一百年。是师尊的剑。',
      '剑痕是新的。这些剑，昨夜还斩过人。',
      '截教的门徒还在守阵。他们认得你，却不肯让路。',
      '阵图傀儡不知道疼，也不知道师门早就散了。',
      '阵心有剑鸣。四把剑，在喊师尊的名字。',
    ],
  },
  leizhenzi: {
    1: [
      '回响里的兵，还在守一座早已不在的关。风从翅下穿过去，带着海腥味。',
      '东海的水是黑的。翅尖的电光碰到海风，就噼啪作响。',
      '鬼火绕着你转。它们怕雷，却还是围上来。',
      '校尉的刀上，还沾着一百年前的血。',
      '关楼上有人在等。等的不是你，是那个抽了龙筋的少年。',
    ],
    2: [
      '西岐城外。一百年前，你就是从这条路上背着父王飞回家的。',
      '十座阵台，十位天君。当年你站在城头上，看他们一座座摆下。',
      '落魂幡底下，魂光一缕一缕地连着。翅上的雷，烧得断它们。',
      '红沙漫上来，你的脚沾不着地。',
      '阵心有人在摇铃。铃声一响，翅尖的电光就乱跳。',
    ],
    3: [
      '界牌关前，四把剑悬了一百年。翅下的风都是冷的。',
      '剑痕是新的。这些剑，昨夜还斩过人。',
      '截教的门徒还在守阵。他们见过你从天上落下来。',
      '阵图傀儡不知道疼，也不知道天上还有人飞。',
      '阵心有剑鸣。四把剑，在喊同一个名字。',
    ],
  },
  wukong: {
    1: [
      '回响里的兵，守着一座早就不在的关。',
      '东海的水是黑的。俺去龙宫借棒子那年，它还是蓝的。',
      '鬼火绕着你转。火眼金睛一看：不过是些没走成的魂。',
      '校尉的刀上，还沾着一百年前的血。',
      '关楼上有人在等。等的那个，千年以后还会来捉俺。',
    ],
    2: [
      '西岐城外。这一仗，俺只在说书人嘴里听过。',
      '十座阵台，十位天君。比南天门的守将还凶。',
      '地上埋过一个草人。拜草人的把戏，骗不过火眼金睛。',
      '风里有人在数日子：二十一天。',
      '阵心有人在摇铃。俺听着，有点像紧箍咒。',
    ],
    3: [
      '界牌关前，四把剑悬了一百年。',
      '剑痕是新的。这些剑，昨夜还斩过人。',
      '截教的门徒还在守阵。一个个，都没回过头。',
      '阵图傀儡不知道疼。俺拔根毫毛，变得比它们还多。',
      '阵心有剑鸣。四把剑在喊同一个名字。',
    ],
  },
};
/**
 * 回响化身（暂拟，待剧情评审）：自己的台词只写了几处（魔化哪吒在第一章遇到的是另一个自己），
 * 没写的那几章照本人的台词说，名字、宠物的名字换成回响化身的（赵公明 → 回响赵公明、黑虎 → 魂虎……）。
 * 本人的台词以后改了，回响化身的跟着变。
 */
HERO_BOSS_AFTER.mozha = {
  1: [
    { who: '回响', text: '你身上，也烧着黑的火。' },
    { who: '魔化哪吒', text: '所以我知道，该往哪里烧。' },
    { who: '回响', text: '封神榜在召唤我们——\n你听不见吗？' },
    { who: null, text: '另一个魔化哪吒化作灰烬，被风吹向天上的裂缝。\n他抬头看了很久，手里的火尖枪烧得更黑了。', cue: 'dissolve' },
  ],
};
HERO_BOSS_BARKS.mozha = {
  1: {
    intro: '你也是我？……那就看看，哪一个才是回响。',
    phase2: '三头六臂——你分得清，哪一个是你？',
    phase3: '烧吧。我们烧的，本来就是同一座关。',
  },
};
// 回响敖丙（暂拟，待剧情评审）：他是榜上的人（原著封华盖星），死在陈塘关九湾河——魔化哪吒认得他，那一天的账两个人都记得；
// 第二、三章照他的身份写：龙子、榜上有名。第一章抽到敖丙自己当首领时（另一个自己）的那一套在 pool-lines.ts。
HERO_BOSS_AFTER.huiao = {
  1: [
    { who: '魔化哪吒', text: '东海的三太子……\n抽你龙筋的，就是这只手。' },
    { who: '回响敖丙', text: '我认得。\n可我今天斩的是回响，不是那一天。' },
    { who: '魔化哪吒', text: '你我都被它拘在这里。\n封神榜在召唤我们——榜上的，和不在榜上的。' },
    { who: null, text: '魔化哪吒化作灰烬，被风吹向天上的裂缝。\n回响敖丙收了戟，九湾河的水声静了一瞬。', cue: 'dissolve' },
  ],
  2: [
    { who: '姚天君', text: '榜上有名……\n龙子，你我都要再死一次。' },
    { who: null, text: '姚天君散成一缕灰烟，落进脚下的阵眼。\n避水兽低头一拱：阵眼底下压着一角焦黄的残页。', cue: 'dissolve' },
    { who: '回响敖丙', text: '封神榜的残页……\n我的名字，也在这上面。' },
    { who: null, text: '十座阵眼，十角残页。\n有人在用旧阵，养一张新榜。' },
  ],
  3: [
    { who: '诛仙剑灵', text: '榜上的魂，\n也想看门后面？' },
    { who: '回响敖丙', text: '我替自己问一句话。\n问完就走。' },
    { who: null, text: CH3_GATE, cue: 'dissolve' },
  ],
};
HERO_BOSS_BARKS.huiao = {
  1: {
    intro: '敖丙？……那一天的账，轮到你来讨了。',
    phase2: '三头六臂——那一天，我只用了一只手。',
    phase3: '烧吧——连同这座关，连同九湾河。',
  },
  2: {
    intro: '龙子的魂，比凡人的沉。',
    phase2: '草人已拜。你的魂，在我手里。',
    phase3: '散了吧——散在阵里，和我们一样。',
  },
  3: {
    intro: '抽了筋的龙，也敢进诛仙阵？',
    phase2: '一剑化四——龙子，认得出哪一把是我？',
    phase3: '此阵名诛仙。仙，亦可诛——何况一条龙。',
  },
};
for (const [h, def] of Object.entries(ECHO) as [HeroId, { base: HeroId }][]) {
  const base = def.base;
  const swap = (s: string) => s.replaceAll(HEROES[base].name, HEROES[h].name).replaceAll(HEROES[base].pet, HEROES[h].pet);
  for (const ch of [1, 2, 3]) {
    const after = HERO_BOSS_AFTER[base]?.[ch] ?? BOSS_AFTER[ch];
    if (after && !HERO_BOSS_AFTER[h]?.[ch]) (HERO_BOSS_AFTER[h] ??= {})[ch] = after.map((l) => ({ ...l, who: l.who && swap(l.who), text: swap(l.text) }));
    const bark = HERO_BOSS_BARKS[base]?.[ch] ?? BOSS_BARKS[ch];
    if (bark && !HERO_BOSS_BARKS[h]?.[ch]) (HERO_BOSS_BARKS[h] ??= {})[ch] = { intro: swap(bark.intro), phase2: swap(bark.phase2), phase3: swap(bark.phase3) };
    const lines = HERO_WAVE_LINES[base]?.[ch] ?? WAVE_LINES[ch];
    if (lines && !HERO_WAVE_LINES[h]?.[ch]) (HERO_WAVE_LINES[h] ??= {})[ch] = lines.map(swap);
  }
}

/**
 * 这个角色第 wave 波（全局编号）打完之后的旁白：这一章有他自己的一套就用他的（这一波没有就是 null），
 * 没有返回 undefined（调用方用 story.ts 的 waveLine）。
 */
export function heroWaveLine(hero: HeroId, wave: number): string | null | undefined {
  const lines = HERO_WAVE_LINES[hero]?.[chapterOf(wave)];
  if (!lines) return undefined;
  if (wave < 1 || isBossWave(wave)) return null;
  return lines[waveInChapter(wave) - 1] ?? null;
}
