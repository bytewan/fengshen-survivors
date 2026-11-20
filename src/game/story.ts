// 剧情台词（第一章 · 陈塘关，第二章 · 西岐城外，第三章 · 界牌关，草稿，待审阅；出处 docs/story/ch1.md、docs/story/ch2-ch3.md）。
// 台词都集中在这里，改字只改这一个文件（改完记得跑 tools/fonts/subset.py：书法体按用到的字裁过）。
// 按章节号查（chapters.ts 的 ChapterDef.story 记着同一章的台词 id：'ch1'、'ch2'……）。
import { chapterOf, isBossWave, waveInChapter } from '../sim/catalog.ts';
import type { MusicTrack } from '../audio/bank.ts';

export interface StoryLine {
  /** 说话人；null = 旁白（对白框里不显示名字牌）。 */
  who: '魔化哪吒' | '哪吒' | '姚天君' | '诛仙剑灵' | null;
  /** 台词；长句用 \n 在停顿处断行（中文哪里都能断，不手动断会把「我们」这种词拆开）。 */
  text: string;
  /** 这一句出现时的画面提示（表现层据此做动作）。dissolve：倒下的首领散去（魔化哪吒化灰、姚天君散进阵眼、诛仙剑灵碎成剑光）。 */
  cue?: 'dissolve';
}

/**
 * 首领的名字与横幅（入场的大字和副标题、换阶段时的招式名）。没有登记的章节按第一章的写，副标题注明是哪一章的首领。
 */
export const BOSS_TITLES: Record<number, { name: string; sub: string; phases: [string, string] }> = {
  1: { name: '魔化哪吒', sub: '陈塘关 · 旧战回响', phases: ['三头六臂', '魔焰焚城'] },
  2: { name: '姚天君', sub: '落魂阵主 · 十绝阵', phases: ['草人拜魂', '落魂化雾'] },
  3: { name: '诛仙剑灵', sub: '诛仙四剑 · 界牌关', phases: ['一剑化四', '诛仙'] },
};
export const bossTitle = (chapter: number) => BOSS_TITLES[chapter] ?? { ...BOSS_TITLES[1], sub: `第${'一二三四五六'[chapter - 1] ?? chapter}章 · 旧战回响` };

/** 首领战中的对白气泡（不打断战斗，显示在首领头顶，几秒后淡出）。这里是对哪吒说的那一套；别的角色有自己的在 hero-views.ts 的 HERO_BOSS_BARKS。 */
export const BOSS_BARKS: Record<number, { intro: string; phase2: string; phase3: string }> = {
  1: {
    intro: '你终于回来了。',
    phase2: '你剔骨还父的那一天，我就在这里，没有走。',
    phase3: '烧吧——连同这座关，连同那一年。',
  },
  2: {
    intro: '三魂七魄，留下一缕便够了。',
    phase2: '草人已拜。你的魂，在我手里。',
    phase3: '散了吧——散在阵里，和我们一样。',
  },
  // 对哪吒：他是莲花化身（没有凡胎），二阶段的一剑化四对着他自己的三头六臂说
  3: {
    intro: '莲花做的身子，也敢进诛仙阵？',
    phase2: '一剑化四——三头六臂的，认得出哪一把是我？',
    phase3: '此阵名诛仙。仙，亦可诛——何况一朵莲。',
  },
};

/** 战后对白的最后一句（旁白）：对白框里有，第一章收尾过场的画面上也是这一句（同一份字，只写在这里）。 */
export const CH1_ASHES = '魔化哪吒化作灰烬，被风吹向天上的裂缝。\n哪吒握紧乾坤圈，没有说话。';
/**
 * 第二章的发现（十座阵眼底下各压着一角残页）：战后对白的最后一句；有收尾过场时这一句交给过场（镜头里同一句）。
 * 别的角色的战后对白（hero-views.ts 的 HERO_BOSS_AFTER）最后一句也是这几个字。
 */
export const CH2_PAGES = '十座阵眼，十角残页。\n有人在用旧阵，养一张新榜。';
/** 第三章战后的旁白（剑灵碎裂、门缝裂开）：同上，对白框和结尾过场的第一镜共用这一句。 */
export const CH3_GATE = '剑灵碎裂，四剑坠地。\n阵心裂开一道门缝。';
/** 首发版结尾的大字（书法体，同章节名的写法）。 */
export const FINALE_TITLE = '三章平定 · 未完待续';

/**
 * 打赢首领之后的对白（点一下推进一句）。第一章的核心一句：「封神榜在召唤我们」；第二章：阵眼下压着封神榜的残页，为第三章埋伏笔；
 * 第三章（首发版的结局）：剑灵守的是阵心后面的门，门开了一条缝——接着放结尾过场（门那边有人回头看了一眼）。
 * 这里是哪吒的那一套；别的角色有自己的在 hero-views.ts 的 HERO_BOSS_AFTER。
 */
export const BOSS_AFTER: Record<number, StoryLine[]> = {
  1: [
    { who: '魔化哪吒', text: '你以为……斩了我，就算放下了？' },
    { who: '哪吒', text: '我早就放下了。' },
    { who: '魔化哪吒', text: '可封神榜没有放下。\n它在召唤我们——所有不在榜上的人。' },
    { who: null, text: CH1_ASHES, cue: 'dissolve' },
  ],
  2: [
    { who: '姚天君', text: '榜上有名……\n死了，还要再死一次。' },
    { who: null, text: '姚天君散成一缕灰烟，落进脚下的阵眼。\n哪吒俯身，从阵眼里翻出一角焦黄的残页。', cue: 'dissolve' },
    { who: '哪吒', text: '这是……封神榜？' },
    { who: null, text: CH2_PAGES },
  ],
  3: [
    { who: '诛仙剑灵', text: '阵心之后……\n不是你该去的地方。' },
    { who: '哪吒', text: '那就让我看看，\n是谁在后面。' },
    // 有结尾过场时，这一句交给过场的第一镜（对白框里不放）
    { who: null, text: CH3_GATE, cue: 'dissolve' },
  ],
};

/**
 * 有收尾过场时，对白框里放哪几句：散去的那一句（cue: 'dissolve'）之前的那几句；从那一句起交给过场
 * （第一、三章散去的那一句就是最后一句；第二章后面还有发现残页的两句，过场里一镜一镜地放：同一句旁白、角色自己的那一句 heroSay）。
 * 没有 dissolve 的那一套整套都放。
 */
export function beforeCut<T extends { cue?: string }>(lines: T[]): T[] {
  const i = lines.findIndex((l) => l.cue === 'dissolve');
  return i < 0 ? lines : lines.slice(0, i);
}

/** 对白结束后的解锁提示。 */
export const UNLOCK_DEMON_NEZHA = { label: '解锁回响化身', name: '魔化哪吒' }; // 和第 10、16 波打倒回响时的解锁卡同一个说法
/** 标题页天上的金色裂缝点开、过场放完之后的解锁提示卡（game/wukong-rift.ts）。 */
export const UNLOCK_WUKONG = { label: '解锁隐藏角色', name: '孙悟空' };

// ---------- 过场（播放器在 src/game/cutscene.ts，画面在 src/game/cutscene-shots.ts） ----------

/**
 * 过场里的一个镜头：一幅动起来的画面 + 一句字。字有三种：
 *  - narr 旁白：竖排，从右往左一列一列「写」出来，标点和 \n 处分列（标点本身不画；一列别超过九个字）；
 *  - say 对白：画面下方一行横排字幕，书法体名字在前；
 *  - title 书法大字（章节名）：small 一行小字在上，big 大字在下。
 */
export interface CutBeat {
  /** 画面：cutscene-shots.ts 里 SHOTS 的名字。 */
  shot: string;
  narr?: string;
  say?: { who: string; text: string };
  /**
   * 这一句是本机玩家的角色说的（第几章）：台词取他这一章的战后对白里、散去那一句之后他说的第一句（hero-views.ts 的 heroCutLine），
   * 名字牌是他的名字和颜色；他没有这一句就用 say（哪吒的那一句）。过场里按角色不同的只有这一句，旁白一套。
   */
  heroSay?: number;
  title?: { small?: string; big: string };
  /** 画面开始后多久出字（秒）；不给就是 0.9 秒（要等画面里的动作先做完的镜头给得晚一些）。 */
  at?: number;
  /** 字出完之后再停多久（秒）才自动进下一镜；不给按字数算。 */
  hold?: number;
}

export type CutsceneId = 'ch1-intro' | 'ch1-end' | 'ch2-intro' | 'ch2-end' | 'ch3-intro' | 'ch3-end' | 'wukong' | 'ch1-end-aobing' | 'ch2-intro-zhao' | 'ch2-end-zhao' | 'ch3-end-yunxiao';

/** 第一章战后的旁白，抽到回响敖丙当首领时（前半句；后半句按角色，见 pool-lines.ts）。 */
export const CH1_ICE = '敖丙化作一片碎冰，落进九湾河里。';
/** 第三章战后的旁白，抽到回响云霄当首领时（首领池）：对白框和结尾过场的第一镜共用这一句。 */
export const CH3_GATE_YUNXIAO = '黄河的水声退了，四剑坠地。\n阵心裂开一道门缝。';

/**
 * 第一章的开场与收尾（docs/story/ch1.md「开场过场」的 7 个镜头；收尾是战后对白第 4 句的画面）。
 * 开场约 50 秒，收尾约 15 秒；随时可以跳过，点一下就往下走。
 */
export const CUTSCENES: Record<CutsceneId, CutBeat[]> = {
  'ch1-intro': [
    { shot: 'altar', narr: '封神之战，已过百年。', at: 1.2 },
    { shot: 'tear', narr: '那一夜，封神榜裂了。', at: 2.2 },
    { shot: 'souls', narr: '榜上的魂\n被拘回旧日的战场，一遍又一遍，重演自己的死。', at: 1 },
    { shot: 'city', narr: '东海之滨，陈塘关。', at: 1.2 },
    { shot: 'landing', say: { who: '哪吒', text: '这里……是我出生的地方。' }, at: 2.6 },
    { shot: 'ranks', say: { who: '哪吒', text: '谁在翻我的旧账。' }, at: 3.2 },
    { shot: 'card', title: { small: '第一章', big: '陈塘关' }, at: 0.6, hold: 2.6 },
  ],
  'ch1-end': [
    // 战后对白的最后一句。游戏里接上收尾过场时，对白框就只放前三句（把带 cue: 'dissolve' 的那一句去掉），这一句交给过场，免得出现两遍
    { shot: 'ashes', narr: CH1_ASHES, at: 1.6, hold: 1.8 },
    { shot: 'card-end', title: { big: '第一章 · 完' }, at: 0.4, hold: 1.6 },
  ],
  // 第二章的开场（换章那一波开始时放）：黄昏的西岐城外，十座阵台一座座拱出黄土 → 台上天君的魂影一遍遍重演自己的死 →
  // 落魂阵的阵台上有人在摇铃（姚天君的剪影；本机玩家的角色在近处望着）→ 章节名
  'ch2-intro': [
    { shot: 'xiqi-rise', narr: '西岐城外，黄昏。\n十座阵台，一座一座，从黄土里立起来。', at: 1.0, hold: 1.6 },
    { shot: 'tianjun', narr: '十天君，都是榜上有名的人，\n死在阵里，\n又被困在阵里，一遍遍重演。', at: 0.8, hold: 1.3 },
    { shot: 'yao-bell', narr: '阵心的台上，有人在摇铃。\n落魂阵主，姚天君。', at: 1.0, hold: 1.5 },
    { shot: 'card-dusk', title: { small: '第二章', big: '西岐城外' }, at: 0.6, hold: 1.8 },
  ],
  // 第二章的收尾（战后对白之后；对白框只放姚天君的那一句，从散去那一句起交给过场，见 beforeCut）：
  // 姚天君散成灰烟沉进阵眼、落魂幡倒下 → 阵眼里顶出一角暗金的残页，本机玩家的角色说他自己的那一句 →
  // 十座阵眼一座接一座透出暗金，起风了，残页被卷着往东飞去（东边地平线上一线冷青的山，界牌关的方向），飞出画面就收场。
  // 不另放「第二章 · 完」的大字：首领倒下时已经有「平定」的横幅，万宝阁的标题也写着「第二章 · 西岐城外 · 平定」；要加就在末尾补一镜
  // { shot: 'card', title: { big: '第二章 · 完' }, at: 0.5, hold: 1.4 }（多约 6 秒）
  'ch2-end': [
    { shot: 'yao-fade', narr: '姚天君散成一缕灰烟，落进阵眼。\n落魂幡倒了。', at: 1.4, hold: 1.2 },
    { shot: 'page', heroSay: 2, say: { who: '哪吒', text: '这是……封神榜？' }, at: 1.7, hold: 1.6 },
    { shot: 'pages-east', narr: `${CH2_PAGES}\n风起了，残页往东飞去。`, at: 0.8, hold: 1.4 },
  ],
  // 第三章的开场（换章那一波开始时放）：夜里的界牌关，第二章那一角残页飘进山谷 → 四角剑台上悬着的四剑，念到哪一把哪一把走过一线寒光 →
  // 阵心：阵线往里收，圆石上隐约一道关着的门缝（结尾它会裂开）→ 章节名
  'ch3-intro': [
    { shot: 'jiepai-pass', narr: '界牌关前，夜。\n那一角残页，落进了山谷。', at: 1.0, hold: 1.5 },
    { shot: 'jiepai-swords', narr: '诛仙，戮仙，陷仙，绝仙。', at: 0.9, hold: 2 },
    { shot: 'jiepai-heart', narr: '通天教主的诛仙阵。\n阵心里，有一道门。', at: 1.0, hold: 1.6 },
    { shot: 'card-moon', title: { small: '第三章', big: '界牌关' }, at: 0.6, hold: 2 },
  ],
  // 首发版的结局（第三章收尾）：阵心的门缝张开 → 缝里的金光里有人回头看了一眼（剪影，不露脸）→ 收束的旁白 → 大字「三章平定 · 未完待续」。
  // 之后 feel.ts 打开致谢、回到标题
  'ch3-end': [
    { shot: 'gate', narr: CH3_GATE, at: 1.4, hold: 1.4 },
    { shot: 'gate-look', narr: '缝里是封神榜的金光。\n门那边，有人回头看了一眼。', at: 0.8, hold: 1.6 },
    { shot: 'gate-hold', narr: '三处回响，已平其三。\n可封神榜上的裂缝，比来时更长了。', at: 0.8, hold: 2 },
    { shot: 'card', title: { big: FINALE_TITLE }, at: 0.6, hold: 3 },
  ],
  // ---- 首领池（sim/bosspool.ts）：这一章抽到的首领不是原来那一位时，点了名的镜头换一个说法（画面还是那几个镜头）----
  // 第一章抽到回响敖丙：收尾那一镜（魔化哪吒化灰）不放，散去的那一句留在对白框里（倒下的敖丙在战场上散），只放章末的大字
  'ch1-end-aobing': [{ shot: 'card-end', title: { big: '第一章 · 完' }, at: 0.4, hold: 1.6 }],
  // 第二章抽到回响赵公明：摇铃的姚天君还在（他这一局来第 4 波的遭遇战），阵心更深处多一个骑虎的影子——不点名
  'ch2-intro-zhao': [
    { shot: 'xiqi-rise', narr: '西岐城外，黄昏。\n十座阵台，一座一座，从黄土里立起来。', at: 1.0, hold: 1.6 },
    { shot: 'tianjun', narr: '十天君，都是榜上有名的人，\n死在阵里，\n又被困在阵里，一遍遍重演。', at: 0.8, hold: 1.3 },
    { shot: 'yao-bell', narr: '落魂阵的台上，有人在摇铃。\n阵心更深处，还有一声虎啸。', at: 1.0, hold: 1.5 },
    { shot: 'card-dusk', title: { small: '第二章', big: '西岐城外' }, at: 0.6, hold: 1.8 },
  ],
  // 收尾：没有姚天君散去的那一镜（散去的那一句留在对白框里，倒下的回响在战场上散），从翻出残页那一镜起
  'ch2-end-zhao': [
    { shot: 'page', heroSay: 2, say: { who: '哪吒', text: '这是……封神榜？' }, at: 1.7, hold: 1.6 },
    { shot: 'pages-east', narr: `${CH2_PAGES}\n风起了，残页往东飞去。`, at: 0.8, hold: 1.4 },
  ],
  // 第三章抽到回响云霄：结尾第一镜（门缝张开）的旁白不说剑灵
  'ch3-end-yunxiao': [
    { shot: 'gate', narr: CH3_GATE_YUNXIAO, at: 1.4, hold: 1.4 },
    { shot: 'gate-look', narr: '缝里是封神榜的金光。\n门那边，有人回头看了一眼。', at: 0.8, hold: 1.6 },
    { shot: 'gate-hold', narr: '三处回响，已平其三。\n可封神榜上的裂缝，比来时更长了。', at: 0.8, hold: 2 },
    { shot: 'card', title: { big: FINALE_TITLE }, at: 0.6, hold: 3 },
  ],
  // 隐藏角色孙悟空（用户 11-11 确认的设计）：通关之后标题页天上那道金色裂缝，点开放这一镜（约 8 秒）——裂缝撕开，
  // 一根金箍棒先掉下来插在地上，一只猴子跟着翻下来，挠挠头。之后解锁（game/wukong-rift.ts）
  wukong: [{ shot: 'wk-rift', say: { who: '孙悟空', text: '俺老孙……这是到了哪一年？' }, at: 4.7, hold: 2.2 }],
};

/**
 * 过场里换的曲子（没写的不换：开场接着放这一章的战斗曲——换章那一波一开始就切过去了，过场放完直接接上战斗；
 * 第一章收尾是首领倒下之后的那一阵安静；首发版的结局从结尾过场起放结局的曲子，feel.ts 的 finale 切）。
 * 第二章收尾：古筝独奏（calm，安静），放完换回万宝阁的曲子。
 */
export const CUTSCENE_MUSIC: Partial<Record<CutsceneId, MusicTrack>> = {
  'ch2-end': 'calm',
  'ch2-end-zhao': 'calm',
};

/**
 * 每一章开头、结尾放哪一段过场（没有就不放）。第二章、第三章的开场还没做（换章时是云海转场）；登记一个 id、在 CUTSCENES 里写好镜头就会放（feel.ts 已经接好）。
 * 最后一章的结尾过场放完接着是致谢、回到标题（feel.ts 的 finale）。
 */
export const CHAPTER_CUTSCENES: Record<number, { intro?: CutsceneId; end?: CutsceneId }> = {
  1: { intro: 'ch1-intro', end: 'ch1-end' },
  2: { intro: 'ch2-intro', end: 'ch2-end' },
  3: { intro: 'ch3-intro', end: 'ch3-end' },
};

// ---------- 波间旁白 ----------

/** 每一章第 1–5 波打完时的一句旁白（首领波没有）。 */
export const WAVE_LINES: Record<number, string[]> = {
  1: [
    '回响里的兵，还在守一座早已不在的关。',
    '海水是黑的。那一年，它也是这个颜色。',
    '鬼火认得你。它们记得你三太子的名号。',
    '校尉的刀上，还沾着一百年前的血。',
    '关楼上有人在等你。',
  ],
  2: [
    '西岐城外的风里，还有一百年前的鼓声。',
    '十座阵台，旗都褪了色，阵却还醒着。',
    '落魂幡底下，魂光一缕一缕地连着。',
    '红沙是从阵里漏出来的，像干了的血。',
    '阵心有人在摇铃。',
  ],
  3: [
    '界牌关前，四把剑悬了一百年，没有人过得去。',
    '剑痕是新的。这些剑，昨夜还斩过人。',
    '截教的门徒还在守阵，守一座早已散了的师门。',
    '阵图傀儡不知道疼，也不知道阵早就破过一回。',
    '阵心有剑鸣。四把剑，在喊同一个名字。',
  ],
};

/** 第 wave 波（全局编号，1 起）打完之后的那句旁白；没有就是 null（首领波、还没写台词的章节）。 */
export function waveLine(wave: number): string | null {
  if (wave < 1 || isBossWave(wave)) return null;
  return WAVE_LINES[chapterOf(wave)]?.[waveInChapter(wave) - 1] ?? null;
}
