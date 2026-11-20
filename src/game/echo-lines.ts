// 回响化身遭遇战的台词（暂拟，待剧情评审）：现身时、换二阶段时，回响对玩家说的一句（对白气泡）；
// 打倒、退走时横幅下面的一行。按玩家的角色换说法：遇到自己的回响（本人、或已经解锁的回响化身）时另有一套。
// 故事（docs/story/ch2-ch3.md）：封神榜裂开，榜上的魂被拘回自己死去的战场重演——
// 赵公明死在西岐城外（陆压拜草人、钉头七箭，二十一日）；云霄是截教门人，黄河阵被破，被老子用乾坤图裹去、压在麒麟崖下。
// 首领池（sim/bosspool.ts）之后回响也能当章节首领：多一句进第三阶段时说的（phase3）。
import type { EchoKind } from '../sim/echo/types.ts';
import type { HeroId } from '../sim/types.ts';

interface Lines {
  intro: string;
  phase: string;
  phase3: string;
}

const DEFAULT: Record<EchoKind, Lines> = {
  zhao: {
    intro: '西岐城外，二十一日，七根钉。\n这一回，换你来数日子。',
    phase: '定海珠，二十四颗——\n这一回，一颗都不会再丢。',
    phase3: '七箭已尽，珠还在落。\n——你接得住几颗？',
  },
  // 敖丙（对别的角色）：他守的是自家门前的那条河；别人都是外人
  aobing: {
    intro: '九湾河的水，一百年没有清过。\n你也是来搅它的？',
    phase: '东海的潮，不是你挡得住的。',
    phase3: '龙筋可以再抽一回。\n这条河，我不让。',
  },
  yunxiao: {
    intro: '诛仙阵前……\n师尊的阵，也是你闯得的？',
    phase: '黄河阵，再摆一回。\n这一次，没有人来破。',
    phase3: '九曲黄河，一曲一劫。\n你，走到第几曲了？',
  },
};

/** 遇到的是自己的回响（本人或他的回响化身）。 */
/**
 * 敖丙对哪吒（和魔化哪吒）：原著里哪吒在九湾河洗混天绫、搅得水晶宫摇动，敖丙出来问罪，被乾坤圈打死、抽了龙筋。
 * 回响里的他还停在那一天——不是来报仇的腔调，是那一天还没过完。
 */
const VS_NEZHA: Lines = {
  intro: '是你。\n——那一天的水，还是红的。',
  phase: '乾坤圈、混天绫……\n都带着呢。那就再来。',
  phase3: '抽了筋的龙，\n也还是龙。',
};

const SELF: Record<EchoKind, Lines> = {
  aobing: {
    intro: '你也是我？……\n那你背上的筋，还在不在？',
    phase: '同一条河里，容不下两条龙。',
    phase3: '倒下去的那一个，\n替另一个把那一天过完。',
  },
  zhao: {
    intro: '你也是我？……\n那就看看，谁才是死过的那一个。',
    phase: '二十一天。\n我数过的日子，你也数一遍。',
    phase3: '第二十一天了。\n你我，总要倒下一个。',
  },
  yunxiao: {
    intro: '镜子里的人……\n也会被压在山下吗？',
    phase: '黄河九曲，曲曲是我。\n你从哪一曲出去？',
    phase3: '麒麟崖下很冷。\n这一回，换你去冷。',
  },
};

const OWNER: Record<EchoKind, HeroId[]> = { zhao: ['zhao'], yunxiao: ['yunxiao'], aobing: [] };

/** 遇到的是不是自己的回响（本人，或已经解锁的那个回响化身）。 */
export const echoIsSelf = (kind: EchoKind, hero: HeroId) => OWNER[kind].includes(hero) || hero === ECHO_HERO[kind];

/** 回响现身 / 换二阶段 / （当首领时）换三阶段时说的那一句。 */
export function echoBark(kind: EchoKind, hero: HeroId, at: 'intro' | 'phase' | 'phase3'): string {
  if (kind === 'aobing' && (hero === 'nezha' || hero === 'mozha')) return VS_NEZHA[at];
  return (echoIsSelf(kind, hero) ? SELF : DEFAULT)[kind][at];
}

/** 每一场遭遇战对应的回响化身（打倒它解锁的那个可玩角色；还没登记的是 null）。 */
export const ECHO_HERO: Record<EchoKind, HeroId | null> = { zhao: 'huizhao', yunxiao: 'huiyun', aobing: 'huiao' };

/** 打倒、退走时横幅下面那一行。 */
export const ECHO_END: Record<EchoKind, { win: string; gone: string }> = {
  aobing: { win: '潮退了，九湾河的水清了一寸', gone: '回响沉回了九湾河底：下一局，它还在那里等' },
  zhao: { win: '玄坛的回响散了，封神榜上那一行字暗了一下', gone: '回响退回了西岐城外的黄土里：下一局，它还在那里等' },
  yunxiao: { win: '黄河的水声远了，三仙岛的风吹过阵台', gone: '回响退回了阵图深处：下一局，它还在那里等' },
};
