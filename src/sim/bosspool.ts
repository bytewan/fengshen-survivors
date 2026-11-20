// 首领池（用户 11-11：「每一个章节的 boss 可以不固定」；做法 暂拟，待评审确认）。这个文件只有数据和不认识模块的小工具；
// 登记模块、抽签在 chapters.ts（章节表的 pool）。
//
// 每章一个池子（POOL.chapters）。开局时抽：一个当这一章第 6 波的**首领**，池里另一个在这一章第 4 波以**遭遇战**出现
// （打得短：气血少、只到二阶段、这一波结束还没打倒就退走、不放结局也不换章）。两个都会见到，只是谁当首领每局不同。
// 抽到了谁记在 World.cast（纯数据，整局存档照存）。
//
// 「首领」和「遭遇战」是同一个首领模块的两种打法，由状态放在哪个槽决定：
//   World.boss  首领：首领波（没有倒计时、不按时刷怪），三个阶段，倒下后「本章平定」、放战后对白；事件 bossIntro / bossPhase / bossDeath
//   World.echo  遭遇战：和刷怪并存的一只敌人，两个阶段，波末没打倒就退走；事件 echoIntro / echoPhase / echoDefeat / echoLeave
// 每个首领的状态里有 guest（true = 遭遇战），模块按它分两种打法（气血、阶段数、倒下时清不清场、刷不刷零星的回响兵）。
// 一个波次里两个槽最多占一个，所以模块、画面找自己的状态都用 fightOf(w)（= w.boss ?? w.echo）。
// 两族首领：魔化哪吒、姚天君、诛仙剑灵各有自己的模块（boss.ts、ch2/yao.ts、ch3/zhuxian.ts）；
// 回响赵公明、回响云霄（以后的回响敖丙）共用回响那一套（echo/：招式表 + 通用的危险物），echo/index.ts 的 echoBoss(kind) 包成首领模块。
// 以后往池里加人（闻太师、申公豹……）：写好模块，在 chapters.ts 的章节表里登记进那一章的 pool，这里的 BossId、POOL、BOSS_INFO 各加一行。
import { WAVES_PER_CHAPTER, chapterOf, waveInChapter } from './catalog.ts';
import { ARENA } from './config.ts';
import { bossHpMul } from './coop.ts';
import { JIE } from './jie.ts';
import type { Drop, Enemy, SimEvent } from './types.ts';
import type { Boss, World } from './world.ts';

/** 池里的每一位（也是他的首领状态的 kind）。 */
export type BossId = 'nezha' | 'aobing' | 'yao' | 'zhao' | 'zhuxian' | 'yunxiao';

/** 一章抽到的：谁当首领、谁来遭遇战（null = 这一章没有遭遇战，第 4 波照旧刷本章的精英）。 */
export interface Casting {
  chief: BossId;
  guest: BossId | null;
}

/**
 * 开局怎么定每一章的首领（RunSetup.cast）：
 *  - 'draw'：抽签（游戏里、tools/balance.ts 默认）。每章用一个随机数。
 *  - 一串（按章）：指定——给一个名字 = 他当首领、池里另一位来遭遇战；给 { chief, guest } = 两样都指定；空着的那一章照抽。
 *  - 不给：「原样」（LEGACY）= 加首领池之前的排法，不用随机数——测试、实验页、各个数值工具默认都是它，所以它们的结果和加首领池之前逐字相同。
 */
export type CastSetup = 'draw' | readonly (BossId | Casting | null | undefined)[];

export const POOL = {
  /** 每章的池子；第一个是「原来的首领」（剧情默认写的那一位）。 */
  chapters: { 1: ['nezha', 'aobing'], 2: ['yao', 'zhao'], 3: ['zhuxian', 'yunxiao'] } as Record<number, BossId[]>,
  /** 遭遇战在本章第几波（精英波：到了出精英的时候，本章的那一两只精英换成它）。 */
  guestWave: 4,
  /**
   * 遭遇战的气血（初值，数值最后统一调）。任务里写的是「约四成」，按机器人量下来打不完（第 4 波出精英之后只剩二十来秒、还要顾着小怪），
   * 所以照已有的两场遭遇战的口径定（约是当首领时的一成二到一成四），机器人大多能在这一波里打倒。按人数、劫数照首领的倍率加。
   */
  // 2026-11-11 数值平衡：第一章两位 600 → 500（机器人打倒率只有四五成，第 4 波人物还没成型）；第三章两位 9000 / 6500 → 12000 / 9000（原来九成到十成、7–13 秒就倒）；第二章两位不动（七到九成）
  guestHp: { nezha: 500, aobing: 500, yao: 2400, zhao: 3200, zhuxian: 12000, yunxiao: 9000 } as Record<BossId, number>,
  /** 魔化哪吒来遭遇战时招式伤害的倍率（第一章第 4 波人物的气血比打首领时少；别的几位的遭遇战和首领战同在一章后半，不减）。 */
  guestDmg: 0.75,
  /** 遭遇战只有两个阶段：气血打到这个比例换二阶段（换阶段之前打不死：Enemy.hpFloor）。 */
  guestPhaseAt: 0.5,
  guestIntro: 1.2, // 遭遇战现身（无敌）
  guestPhaseTime: 1.3, // 遭遇战换阶段（无敌）
  /** 遭遇战倒下的表现放多久（之后槽清空；这一波照常打完）。 */
  guestDeath: 1.6,
  /** 机器人在遭遇战里的站位（自己有模块的那三位；回响那一族用 echo/ 的 echoDodge）：离它 far 外往它那边靠，near 内往外让；躲招时试走 step 像素。 */
  bot: { far: 105, near: 58, pull: 0.07, push: 0.05, step: 16, dodge: 0.3 },
};

/** 「原样」：加首领池之前的排法（第一章魔化哪吒、没有遭遇战；第二章姚天君 + 回响赵公明；第三章诛仙剑灵 + 回响云霄）。 */
export const LEGACY: readonly Casting[] = [
  { chief: 'nezha', guest: null },
  { chief: 'yao', guest: 'zhao' },
  { chief: 'zhuxian', guest: 'yunxiao' },
];

/** 每一位的名字（横幅、血条、图鉴）、打倒后解锁的存档 id（没有可玩版的是 null）。 */
export const BOSS_INFO: Record<BossId, { name: string; unlock: string | null }> = {
  nezha: { name: '魔化哪吒', unlock: 'demon-nezha' },
  aobing: { name: '回响 · 敖丙', unlock: 'echo-aobing' },
  yao: { name: '姚天君', unlock: null },
  zhao: { name: '回响 · 赵公明', unlock: 'echo-zhao' },
  zhuxian: { name: '诛仙剑灵', unlock: null },
  yunxiao: { name: '回响 · 云霄', unlock: 'echo-yunxiao' },
};

export const bossName = (id: BossId) => BOSS_INFO[id].name;
/** 回响那一族（共用 echo/ 那一套招式表和画面的几位）。 */
export type EchoFamily = 'zhao' | 'yunxiao' | 'aobing';
export const isEchoFamily = (id: string): id is EchoFamily => id === 'zhao' || id === 'yunxiao' || id === 'aobing';
export const isBossId = (s: unknown): s is BossId => typeof s === 'string' && Object.hasOwn(BOSS_INFO, s);
/** 这一位在第几章的池子里。 */
export function bossChapter(id: BossId): number {
  for (const [ch, ids] of Object.entries(POOL.chapters)) if (ids.includes(id)) return Number(ch);
  return 1;
}
/** 这一位来遭遇战的那一波、当首领的那一波（全局编号）。 */
export const guestWaveOf = (id: BossId) => (bossChapter(id) - 1) * WAVES_PER_CHAPTER + POOL.guestWave;
export const chiefWaveOf = (id: BossId) => bossChapter(id) * WAVES_PER_CHAPTER;

/**
 * 把网址 ?boss= / 命令行 --boss 的写法读成 CastSetup：'draw' 抽签；'legacy' 原样；
 * 'aobing' 或 'nezha,zhao' = 这几位当他们那一章的首领（池里另一位来遭遇战），没提到的章照抽；
 * 名字后面加 '.solo'（'nezha.solo'）= 这一章只有他、没有遭遇战。认不出的名字不管。
 */
export function parseCast(s: string | null | undefined): CastSetup | undefined {
  if (!s || s === 'draw') return 'draw';
  if (s === 'legacy') return undefined;
  const out: (BossId | Casting | undefined)[] = [];
  for (const part of s.split(',')) {
    const [id, flag] = part.trim().split('.');
    if (!isBossId(id)) continue;
    out[bossChapter(id) - 1] = flag === 'solo' ? { chief: id, guest: null } : id;
  }
  return out;
}

/** 现在这一仗的状态：首领波是 w.boss，遭遇战是 w.echo（一个波次里最多占一个）。 */
export const fightOf = (w: World): Boss | null => w.boss ?? w.echo;
/** 这一仗的本体（w.enemies 里 kind 'boss' 的那只）。 */
export function fightEnemy(w: World): Enemy | null {
  const f = fightOf(w);
  if (!f) return null;
  for (const e of w.enemies) if (e.id === f.id) return e;
  return null;
}
/** 把一场仗的状态放进它的槽（遭遇战 → w.echo，首领 → w.boss）。 */
export function putFight(w: World, f: Boss) {
  if (f.guest) w.echo = f;
  else w.boss = f;
}

/** 第 wave 波所在的那一章抽到的。 */
export const castOf = (w: World, wave = w.wave): Casting | undefined => w.cast[chapterOf(wave) - 1];
/** 这一波有没有遭遇战（有的话是谁）：本章第 4 波、抽到了。 */
export function guestAt(w: World): BossId | null {
  if (waveInChapter(w.wave) !== POOL.guestWave) return null;
  return castOf(w)?.guest ?? null;
}

/**
 * 第一章的精英本来只在第 4 波；这一章有遭遇战（第 4 波的精英换成了它）时挪到第 3 波，照旧出原来那一只
 * （第二、三章的早就挪到第 2 波了：catalog.eliteCount）。world.step 加在这一波要出的精英数上；elites/ 按第 4 波的规矩挑种类。
 */
export const movedElites = (w: World): number => (chapterOf(w.wave) === 1 && waveInChapter(w.wave) === POOL.guestWave - 1 && castOf(w)?.guest ? 1 : 0);

/** 遭遇战的气血：按人数（和首领一样的倍率）、劫数（劫二起 +25%）加。 */
export const guestHp = (w: World, id: BossId) => Math.round(POOL.guestHp[id] * bossHpMul(w) * (w.jie >= 2 ? 1 + JIE.hp : 1));

/** 遭遇战打倒了：发 echoDefeat，掉一只精英宝匣（灵石已经按 kind 'boss' 掉了 40 颗，见 core.onKill）。 */
export function guestDown(w: World, id: BossId, e: Enemy, facing: 1 | -1, ev: SimEvent[]) {
  ev.push({ t: 'echoDefeat', id: e.id, kind: id, x: e.x, y: e.y, facing, unlock: BOSS_INFO[id].unlock ?? '' });
  const pad = ARENA.pad + 10;
  const x = Math.max(pad, Math.min(ARENA.w - pad, e.x));
  const y = Math.max(pad, Math.min(ARENA.h - pad, e.y));
  const d: Drop = { id: w.nextId++, kind: 'chest', x, y, px: x, py: y, t: 0, life: 1e9, rich: true };
  w.drops.push(d);
  ev.push({ t: 'drop', id: d.id, kind: 'chest', x, y, rich: true });
}

/** 波末（world.endWave，清场之前）：还没打倒的遭遇战退走（这一局不解锁）。 */
export function guestWaveEnd(w: World, ev: SimEvent[]) {
  const f = w.echo;
  if (!f) return;
  if (f.state !== 'dead') {
    const e = w.enemies.find((x) => x.id === f.id);
    if (e) ev.push({ t: 'echoLeave', id: f.id, kind: f.kind, x: e.x, y: e.y, facing: f.facing, hp: Math.max(0, e.hp) / e.maxHp });
  }
  w.echo = null;
}
