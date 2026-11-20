// 首领池（sim/bosspool.ts）的台词、横幅、过场——**按首领查，不按章**（暂拟，待剧情评审）。
// 原来的三位（魔化哪吒、姚天君、诛仙剑灵）的台词还在 story.ts（哪吒的那一套）和 hero-views.ts（别的角色的），这里按章节号转过去；
// 新进池子的（回响赵公明、回响云霄，以后的敖丙）当首领时的那一套写在这里：横幅、战后对白、过场换哪几镜、第 5 波的旁白。
// 战后对白的写法：只换首领自己说的那一句和「散去」的那一句旁白，玩家角色回的那一句、之后的发现照这一章原来的（每个角色都有自己的一套）——
// 所以首领的那一句要写得让每个角色原来的回话都接得上。
import { HEROES, chapterOf, isBossWave, waveInChapter } from '../sim/catalog.ts';
import { POOL, bossChapter, isEchoFamily, type BossId, type Casting } from '../sim/bosspool.ts';
import type { EchoKind } from '../sim/echo/types.ts';
import type { HeroId } from '../sim/types.ts';
import { ECHO_END, echoBark, echoIsSelf } from './echo-lines.ts';
import { HERO_BOSS_AFTER, HERO_BOSS_BARKS, heroWaveLine } from './hero-views.ts';
import { BOSS_AFTER, BOSS_BARKS, BOSS_TITLES, CH1_ICE, CH3_GATE_YUNXIAO, CHAPTER_CUTSCENES, waveLine, type CutsceneId } from './story.ts';

/** 是不是这一章「原来的首领」（剧情默认写的那一位：池子里的第一个）。 */
export const isCanon = (kind: BossId) => POOL.chapters[bossChapter(kind)]?.[0] === kind;
const isEcho = (kind: BossId): kind is EchoKind => isEchoFamily(kind);

interface Title {
  name: string;
  sub: string;
  phases: [string, string];
}
/** 新进池子的几位当首领时的横幅：入场的大字和副标题、换二 / 三阶段时的招式名。 */
const TITLES: Partial<Record<BossId, Title>> = {
  aobing: { name: '回响 · 敖丙', sub: '东海三太子 · 九湾河', phases: ['化龙', '怒潮'] },
  zhao: { name: '回响 · 赵公明', sub: '玄坛旧影 · 西岐城外', phases: ['二十四珠', '珠落如雨'] },
  yunxiao: { name: '回响 · 云霄', sub: '三仙岛 · 九曲黄河', phases: ['黄河阵', '九曲黄河'] },
};
/** 这一位的名字与横幅（血条上的名字、入场的大字和副标题、换阶段的招式名）。 */
export function bossTitleOf(kind: BossId): Title {
  return TITLES[kind] ?? BOSS_TITLES[bossChapter(kind)] ?? BOSS_TITLES[1];
}

/** 首领 / 遭遇战里对玩家说的那一句（对白气泡）：入场、换二阶段、换三阶段（遭遇战没有第三阶段）。没有就是 null。 */
export function fightBark(kind: BossId, hero: HeroId, at: 'intro' | 'phase2' | 'phase3'): string | null {
  if (isEcho(kind)) return echoBark(kind, hero, at === 'phase2' ? 'phase' : at);
  const ch = bossChapter(kind);
  return (HERO_BOSS_BARKS[hero]?.[ch] ?? BOSS_BARKS[ch])?.[at] ?? null;
}

/** 遭遇战打倒 / 退走时横幅下面的那一行。 */
const GUEST_END: Partial<Record<BossId, { win: string; gone: string }>> = {
  nezha: { win: '黑焰熄了，陈塘关的海风里少了一点焦味', gone: '黑焰退回了关楼的影子里：下一局，它还在那里等' },
  yao: { win: '铃声停了，落魂阵的幡垂了下来', gone: '铃声退回了阵台深处：下一局，它还在那里等' },
  zhuxian: { win: '剑光碎了，四把剑各自归了鞘', gone: '剑光退回了阵图里：下一局，它还在那里等' },
};
export const guestEnd = (kind: BossId): { win: string; gone: string } => (isEcho(kind) ? ECHO_END[kind] : GUEST_END[kind]) ?? { win: '回响散了', gone: '回响退走了：下一局，它还在那里等' };

export interface AfterLine {
  who: string | null;
  text: string;
  cue?: string;
  /** 这一句是首领说的（名字牌的颜色、头像按首领配）。 */
  boss?: true;
}

/** 新首领在对白里的名字（和可玩的回响化身同名；玩家用的就是这个回响化身时，对面那个叫「回响」）。 */
const SPEAKER: Partial<Record<BossId, string>> = { zhao: '回响赵公明', yunxiao: '回响云霄', aobing: '敖丙' };
/** 首领倒下后说的那一句：[对别人说的, 对自己（本人或他的回响化身）说的]。 */
const LAST_WORDS: Partial<Record<BossId, [string, string]>> = {
  zhao: ['钉头七箭，二十一日……\n原来倒下去，是这个滋味。', '你还站着……\n那就替我看看，是谁把我们钉回这里。'],
  // 玩家的回话是他第三章原来的那一句（「那就让我看看，是谁在后面」「那就开了这道门，亲眼去看」……），都接得上
  yunxiao: ['阵心之后的那道门……\n连师尊，也不曾让我看过。', '镜子碎了。\n门后的东西，你替我去看。'],
};
/** 「散去」的那一句旁白的前半句（后半句是这个角色原来的：他怎么翻出残页）；整句都换的直接给整句。 */
const DISSOLVE: Partial<Record<BossId, { head?: string; whole?: string }>> = {
  zhao: { head: '回响赵公明散成一片暗金的珠光，落进脚下的阵眼。' },
  yunxiao: { whole: CH3_GATE_YUNXIAO },
};

/**
 * 打赢这一章的首领之后的对白（点一下推进一句）。原来的首领：story.ts / hero-views.ts 的那一套；
 * 新首领：照这个角色这一章原来的那一套，把首领说的换成他的一句、散去的旁白换成他的。
 */
/**
 * 整套另写的战后对白（不照这一章原来的那一套换一句）：敖丙。
 * 对哪吒（和魔化哪吒）：那一天的账——哪吒剔骨还了父亲，没有还给他；他是榜上的人（原著封华盖星），被拘回河边一遍遍重演，
 * 托不在榜上的哪吒去问那张榜。对别的角色：等的不是这个人，把那句话托给过路的。核心还是第一章的那一句：封神榜在召唤。
 */
const FULL_AFTER: Partial<Record<BossId, (hero: HeroId) => AfterLine[]>> = {
  aobing: (hero) => {
    const me = HEROES[hero].name;
    if (hero === 'huiao')
      // 另一个自己
      return [
        { who: '敖丙', text: '你也是我……\n那你替我，把那一天过完了。', boss: true },
        { who: me, text: '没有过完。\n我带着它走。' },
        { who: '敖丙', text: '榜上有我们的名字。\n走到头，替我们问它一句——凭什么。', boss: true },
        { who: null, text: `${CH1_ICE}\n回响敖丙握紧了戟，没有回头。`, cue: 'dissolve' },
      ];
    const nezha = hero === 'nezha' || hero === 'mozha';
    const end: AfterLine = { who: null, text: nezha ? `${CH1_ICE}\n${me}握紧了手里的兵器，没有说话。` : `${CH1_ICE}\n河水清了一瞬，又浑了。`, cue: 'dissolve' };
    if (nezha)
      return [
        { who: '敖丙', text: '你还是赢了。\n……和那一天一样。', boss: true },
        { who: me, text: '那一天的账，我剔骨还过了。' },
        { who: '敖丙', text: '还给了你父亲，没有还给我。\n……罢了。', boss: true },
        { who: '敖丙', text: '榜上有我的名字，它要我一遍遍死在这里。\n你不在榜上——替我去问它，凭什么。', boss: true },
        end,
      ];
    return [
      { who: '敖丙', text: '不是他……\n也好。', boss: true },
      { who: '敖丙', text: '榜上有我的名字。\n它要我一遍一遍，死在这条河边。', boss: true },
      { who: '敖丙', text: '你们往前走吧。\n走到头，替我问它一句——凭什么。', boss: true },
      end,
    ];
  },
};

export function afterLinesOf(kind: BossId, hero: HeroId): AfterLine[] {
  const full = FULL_AFTER[kind];
  if (full) return full(hero);
  const ch = bossChapter(kind);
  const base: AfterLine[] = HERO_BOSS_AFTER[hero]?.[ch] ?? BOSS_AFTER[ch] ?? [];
  const words = LAST_WORDS[kind];
  if (isCanon(kind) || !words) return base;
  const heroName = HEROES[hero].name;
  const self = isEcho(kind) && echoIsSelf(kind, hero);
  const name = SPEAKER[kind] === heroName ? '回响' : (SPEAKER[kind] ?? '回响');
  const out: AfterLine[] = [{ who: name, text: words[self ? 1 : 0], boss: true }];
  const D = DISSOLVE[kind];
  for (const l of base) {
    if (l.cue === 'dissolve') {
      const tail = l.text.includes('\n') ? l.text.slice(l.text.indexOf('\n') + 1) : '';
      out.push({ who: null, text: D?.whole ?? (D?.head ? `${D.head}\n${tail}` : l.text), cue: 'dissolve' });
    } else if (l.who === null || l.who === heroName) out.push(l); // 旁白、玩家自己的话留着；原来的首领说的不要
  }
  return out;
}

/**
 * 这一章开头、结尾放哪一段过场。原来的首领：story.CHAPTER_CUTSCENES；新首领有自己的写法就换（点了名的镜头换说法）。
 * keepDissolve：收尾过场不带「散去」的那一镜——那一句留在对白框里放（倒下的首领在战场上散），过场从后面接。
 */
const CHIEF_CUTS: Partial<Record<BossId, { intro?: CutsceneId; end?: CutsceneId; keepDissolve?: boolean }>> = {
  aobing: { end: 'ch1-end-aobing', keepDissolve: true }, // 第一章的开场没点首领的名，照旧；收尾那一镜画的是魔化哪吒化灰，换成只放「第一章 · 完」
  zhao: { intro: 'ch2-intro-zhao', end: 'ch2-end-zhao', keepDissolve: true },
  yunxiao: { end: 'ch3-end-yunxiao' },
};
export function cutscenesOf(chapter: number, chief: BossId | undefined): { intro?: CutsceneId; end?: CutsceneId; keepDissolve?: boolean } {
  const base = CHAPTER_CUTSCENES[chapter] ?? {};
  const own = chief && !isCanon(chief) ? CHIEF_CUTS[chief] : undefined;
  return own ? { ...base, ...own } : base;
}

/** 本章第 5 波打完（下一波就是首领）的那句旁白：抽到的不是原来的首领时换一句。 */
const EVE_LINES: Partial<Record<BossId, string>> = {
  aobing: '九湾河的水声近了。有人，在河边等你。',
  zhao: '阵心的铃声停了。有虎，在低低地吼。',
  yunxiao: '阵心有水声。九曲黄河，在等最后一个闯阵的人。',
};
/**
 * 第 wave 波（全局编号）打完之后的旁白：这个角色有自己的一套就用他的，没有用 story.ts 的；
 * 首领前一波的那一句按这一章抽到的首领换。没有就是 null。
 */
export function waveLineOf(hero: HeroId, wave: number, cast: readonly Casting[]): string | null {
  if (wave < 1 || isBossWave(wave)) return null;
  const chief = cast[chapterOf(wave) - 1]?.chief;
  if (chief && !isCanon(chief) && waveInChapter(wave) === 5 && EVE_LINES[chief]) return EVE_LINES[chief]!;
  const own = heroWaveLine(hero, wave);
  return own === undefined ? waveLine(wave) : own;
}
