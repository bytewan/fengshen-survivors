// 成就（用户 11-12：「加上成就解锁效果，在达成成就的时候会在右上角出一个成就弹窗」「把一些道具、法宝、角色等做成成就解锁的奖励」；
// 成就表、条件、奖励 暂拟，待评审确认。设计文档「成就」）。
//
// 这个文件是成就表和判定：表（ACHIEVEMENTS）是纯数据，每一条写名字、一句说明、分组、奖励、隐秘与否，以及怎么判——
//   run：一局里的事实（AchRun 听事件、隔一会儿看一眼人物的状态，攒成 RunFacts），达成那一刻就记；
//   prof：存档里的进度（最好成绩、累计统计、劫数、图鉴、解锁），打开标题页 / 图鉴、一局记完成绩时对一遍（reconcile）。
// 判定都在表现层和存档层：模拟层不知道成就（不影响确定性、联机）。模拟只拿到一串「还没解锁的东西」（sealedItems → RunSetup.sealed），
// 万宝阁据此不刷。存档在 profile.ts 的 fs.v1.achieve（id → 达成的 Unix 秒；0 = 补记）。
//
// 奖励：角色写进存档的解锁 id（和回响化身、孙悟空同一个键，选角、联机大厅照旧认它）；法宝、灵物、丹药、符箓不另存，
// 「解锁了没有」就是「那一条成就达成了没有」。老存档：第一次打开时按存档里已有的进度补记（不弹窗），已经解锁的角色照旧解锁。
import { CHAPTERS, CHARMS, EARNED, ECHO, ELIXIRS, HEROES, HIDDEN, RELICS, WEAPONS, shopWeapons } from '../sim/catalog.ts';
import { BOSS_INFO, isEchoFamily, type BossId } from '../sim/bosspool.ts';
import { elementCounts } from '../sim/core.ts';
import { ELEMENTS, type CharmId, type ElixirId, type HeroId, type RelicId, type SimEvent, type WeaponKind } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { addAchieved, codexCount, codexHas, hasAchieveKey, loadAchieved, loadProfile, onUnlock, unlock, type Achieved, type Profile } from './profile.ts';

// ---------- 表 ----------

export type AchGroup = 'zheng' | 'zhan' | 'gou' | 'jue' | 'shou' | 'lian' | 'mi';

/** 分组（成就页按这个顺序分段）。 */
export const ACH_GROUPS: readonly { id: AchGroup; name: string }[] = [
  { id: 'zheng', name: '征战' },
  { id: 'zhan', name: '斩获' },
  { id: 'gou', name: '构筑' },
  { id: 'jue', name: '角色' },
  { id: 'shou', name: '收集' },
  { id: 'lian', name: '联机' },
  { id: 'mi', name: '隐秘' },
];

/** 奖励：解锁一个角色，或让一件法宝 / 灵物 / 丹药 / 符箓进万宝阁。 */
export type Reward =
  | { cat: 'hero'; id: HeroId }
  | { cat: 'weapon'; id: WeaponKind }
  | { cat: 'relic'; id: RelicId }
  | { cat: 'elixir'; id: ElixirId }
  | { cat: 'charm'; id: CharmId };

/** 一局里的事实（只算本机这个人；联机时各算各的）。 */
export interface RunFacts {
  hero: HeroId;
  jie: number;
  online: boolean;
  /** 平定了的章。 */
  chapters: number[];
  win: boolean;
  /** 打倒了的首领（当首领、来遭遇战都算）。 */
  bosses: BossId[];
  kills: number;
  combo: number;
  /** 身上同时有过的最多灵石。 */
  lingshi: number;
  /** 凑到过几种不同的五行（法宝 + 宠物）。 */
  elements: number;
  /** 同一行最多凑到过几件。 */
  same: number;
  /** 同时有过几件神品法宝。 */
  gods: number;
  /** 宠物进化到第几阶（0 = 没进化）。 */
  pet: number;
  techs: number;
  /** 在万宝阁里买过几样。 */
  bought: number;
  /** 首领战（整个首领波）一下都没挨打就打倒了首领。 */
  unhurt: boolean;
  /** 气血不足 ACH_N.clutch 时这一波平定。 */
  clutch: boolean;
  /** 一样没买就平定了第一章。 */
  thrift: boolean;
}

export interface AchDef {
  id: string;
  group: AchGroup;
  /** 两到四个字。 */
  name: string;
  /** 一句话的条件（书面、简练）。 */
  desc: string;
  reward?: Reward;
  /** 隐秘：没达成之前只显示「？」，不写条件。 */
  secret?: boolean;
  run?: (f: RunFacts) => boolean;
  prof?: (p: Profile) => boolean;
}

/** 门槛（初值，暂拟；数值最后统一调）。 */
export const ACH_N = {
  kills: 1500, // 一局斩敌
  combo: 100, // 连斩
  total: 10000, // 累计斩敌
  rich: 300, // 一局里身上同时有多少灵石
  codex: [30, 80] as const, // 图鉴点亮多少条
  techs: 3, // 一局悟得几门功法
  clutch: 0.1, // 气血低于几成时平定一波
};

/** 数字写成汉字（门槛写在说明里，读着有古意）：100 → 一百、1500 → 一千五百、10000 → 一万。只管一万以内的整数和整万。 */
export function cnNum(n: number): string {
  const D = '零一二三四五六七八九';
  if (n >= 10000 && n % 10000 === 0) return `${cnNum(n / 10000)}万`;
  if (n < 10) return D[n];
  let out = '';
  let zero = false;
  for (const [u, name] of [[1000, '千'], [100, '百'], [10, '十'], [1, '']] as const) {
    const d = Math.floor(n / u) % 10;
    if (!d) {
      zero = out !== '';
      continue;
    }
    if (zero && out) out += '零';
    zero = false;
    out += (u === 10 && d === 1 && !out ? '' : D[d]) + name;
  }
  return out;
}

const cleared = (p: Profile) => p.stats.clears > 0 || p.best.clearTime !== null || p.jie.cleared > 0;
/** 存档里看得出平定过第 n 章：有这一章的最快平定、打到过更后面的章，或者通关过。 */
const chapterDone = (p: Profile, n: number) => p.best.chapterTimes[String(n)] !== undefined || p.best.chapter > n || cleared(p);
/** 首领在图鉴里的键（和 codex.ts 的 bossCodexKey 一个口径）。 */
const bossKey = (kind: BossId) => (isEchoFamily(kind) ? `echo.${kind}` : kind);
/** 存档里看得出打倒过 kind：图鉴里记过击败，或者他的可玩版已经解锁了（成就系统之前的解锁）。 */
const bossDone = (p: Profile, kind: BossId) => {
  const u = BOSS_INFO[kind].unlock;
  return (p.codex.boss[bossKey(kind)]?.[1] ?? 0) > 0 || (!!u && p.unlocks.includes(u));
};
/** 打倒了首领 kind 对应的角色奖励（回响化身：catalog.ECHO 按解锁 id 找）。 */
const echoHero = (kind: BossId): HeroId | undefined => {
  const u = BOSS_INFO[kind].unlock;
  return u ? (Object.keys(ECHO) as HeroId[]).find((h) => ECHO[h]?.unlock === u) : undefined;
};

const boss = (kind: BossId, name: string, desc: string, reward?: Reward): AchDef => {
  const h = echoHero(kind);
  return {
    id: `boss.${kind}`,
    group: 'zheng',
    name,
    desc,
    reward: reward ?? (h ? { cat: 'hero', id: h } : undefined),
    run: (f) => f.bosses.includes(kind),
    prof: (p) => bossDone(p, kind),
  };
};

const jie = (n: number, name: string, reward?: Reward): AchDef => ({
  id: `zheng.jie${n}`,
  group: 'zheng',
  name,
  desc: `身负第${cnNum(n)}重劫数，三章尽平`,
  reward,
  run: (f) => f.win && f.jie >= n,
  prof: (p) => p.jie.cleared >= n,
});

/** 每个角色通关一次的那一条的名字（没登记的角色用「某某证道」）。 */
const HERO_ACH: Partial<Record<HeroId, string>> = {
  nezha: '莲花化身',
  yangjian: '清源妙道',
  zhao: '玄坛真君',
  yunxiao: '三霄居首',
  leizhenzi: '风雷双翅',
  mozha: '魔焰焚天',
  huiao: '龙鳞不坠',
  huizhao: '怨力缠身',
  huiyun: '截教余音',
  wukong: '齐天大圣',
};

export const ACHIEVEMENTS: readonly AchDef[] = [
  // ---- 征战：平定各章、通关、各劫通关、打倒各位首领 ----
  { id: 'zheng.ch1', group: 'zheng', name: '陈塘初定', desc: '平定第一章，陈塘关外烽烟暂息', reward: { cat: 'hero', id: 'leizhenzi' }, run: (f) => f.chapters.includes(1), prof: (p) => chapterDone(p, 1) },
  { id: 'zheng.ch2', group: 'zheng', name: '西岐解围', desc: '平定第二章，十绝阵破，西岐解围', reward: { cat: 'weapon', id: 'jinjiao' }, run: (f) => f.chapters.includes(2), prof: (p) => chapterDone(p, 2) },
  { id: 'zheng.win', group: 'zheng', name: '三章平定', desc: '三章尽平，界牌关前回响归寂', reward: { cat: 'elixir', id: 'dahuan' }, run: (f) => f.win, prof: cleared },
  jie(2, '二劫渡尽', { cat: 'weapon', id: 'wenhuang' }),
  jie(3, '三劫渡尽', { cat: 'relic', id: 'qilin' }),
  jie(4, '四劫渡尽'),
  jie(5, '五劫渡尽'),
  boss('nezha', '业火熄灭', '打倒魔化哪吒，熄其满身业火'),
  boss('aobing', '九湾河清', '打倒回响敖丙，九湾河水复清'),
  boss('yao', '落魂阵破', '打倒姚天君，草人尽焚，落魂阵破', { cat: 'relic', id: 'incense' }),
  boss('zhao', '玄坛伏首', '打倒回响赵公明，散其二十一日怨力'),
  boss('zhuxian', '剑灵归鞘', '打倒诛仙剑灵，四剑还鞘'),
  boss('yunxiao', '金斗归元', '打倒回响云霄，混元金斗归于沉寂'),
  // ---- 斩获 ----
  { id: 'zhan.kills', group: 'zhan', name: '万军辟易', desc: `一局之内斩敌${cnNum(ACH_N.kills)}，万军为之辟易`, reward: { cat: 'weapon', id: 'wanya' }, run: (f) => f.kills >= ACH_N.kills },
  { id: 'zhan.combo', group: 'zhan', name: '百斩连环', desc: `连斩${cnNum(ACH_N.combo)}，刀光不绝`, reward: { cat: 'weapon', id: 'wuguang' }, run: (f) => f.combo >= ACH_N.combo, prof: (p) => p.best.combo >= ACH_N.combo },
  { id: 'zhan.total', group: 'zhan', name: '万人敌', desc: `累计斩敌满${cnNum(ACH_N.total)}，威名远播`, reward: { cat: 'charm', id: 'zhaobao' }, prof: (p) => p.stats.kills >= ACH_N.total },
  { id: 'zhan.rich', group: 'zhan', name: '囊中丰盈', desc: `一局之中身怀${cnNum(ACH_N.rich)}灵石，宝光盈囊`, reward: { cat: 'weapon', id: 'luobao' }, run: (f) => f.lingshi >= ACH_N.rich },
  // ---- 构筑 ----
  { id: 'gou.wx5', group: 'gou', name: '五行俱全', desc: '法宝与灵宠凑齐金木水火土，五气朝元', reward: { cat: 'relic', id: 'jadedragon' }, run: (f) => f.elements >= 5 },
  { id: 'gou.same4', group: 'gou', name: '一行专精', desc: '同一行凑满四件，一气贯通', run: (f) => f.same >= 4 },
  { id: 'gou.god', group: 'gou', name: '器灵觉醒', desc: '一件法宝炼至神品，器灵自觉', reward: { cat: 'weapon', id: 'wulu' }, run: (f) => f.gods >= 1, prof: (p) => Object.values(p.codex.weapon).some((e) => (e[2] ?? 0) >= 4) },
  { id: 'gou.god2', group: 'gou', name: '双神并立', desc: '两件神品法宝同时在身', run: (f) => f.gods >= 2 },
  { id: 'gou.pet', group: 'gou', name: '灵宠化形', desc: '随身灵宠初次化形', run: (f) => f.pet >= 1 },
  { id: 'gou.tech', group: 'gou', name: '三法同参', desc: `一局之内悟得${cnNum(ACH_N.techs)}门功法，诸法同参`, reward: { cat: 'elixir', id: 'ningshen' }, run: (f) => f.techs >= ACH_N.techs },
  // ---- 角色：每个角色通关一次 ----
  ...(Object.keys(HEROES) as HeroId[]).map(
    (h): AchDef => ({ id: `jue.${h}`, group: 'jue', name: HERO_ACH[h] ?? `${HEROES[h].name}证道`, desc: `以${HEROES[h].name}之身，三章尽平`, run: (f) => f.win && f.hero === h }),
  ),
  // ---- 收集：图鉴 ----
  { id: 'shou.c1', group: 'shou', name: '博闻', desc: `图鉴点亮${cnNum(ACH_N.codex[0])}条，见闻渐广`, prof: (p) => codexCount(p.codex) >= ACH_N.codex[0] },
  { id: 'shou.c2', group: 'shou', name: '广识', desc: `图鉴点亮${cnNum(ACH_N.codex[1])}条，博识天下`, prof: (p) => codexCount(p.codex) >= ACH_N.codex[1] },
  { id: 'shou.weapons', group: 'shou', name: '万宝归宗', desc: '万宝阁中诸般法宝，尽数见过', prof: (p) => shopWeapons().every((k) => codexHas(p.codex, 'weapon', k)) },
  // ---- 联机 ----
  { id: 'lian.ch1', group: 'lian', name: '同袍', desc: '与道友联手，平定一章', run: (f) => f.online && f.chapters.length > 0 },
  { id: 'lian.win', group: 'lian', name: '同心', desc: '与道友联手，三章尽平', run: (f) => f.online && f.win },
  // ---- 隐秘：没达成之前只显示「？」 ----
  { id: 'mi.rift', group: 'mi', name: '天裂', desc: '循天上一道裂缝，寻得齐天大圣', reward: { cat: 'hero', id: 'wukong' }, secret: true, prof: (p) => !!HIDDEN.wukong && p.unlocks.includes(HIDDEN.wukong.unlock) },
  { id: 'mi.unhurt', group: 'mi', name: '片叶不沾', desc: '首领一战，片叶不沾身', reward: { cat: 'charm', id: 'dundi' }, secret: true, run: (f) => f.unhurt },
  { id: 'mi.clutch', group: 'mi', name: '九死一生', desc: '气血将尽之际，犹平定一波', reward: { cat: 'relic', id: 'gu' }, secret: true, run: (f) => f.clutch },
  { id: 'mi.thrift', group: 'mi', name: '两袖清风', desc: '万宝阁中分文未花，平定第一章', secret: true, run: (f) => f.thrift },
];

const BY_ID = new Map(ACHIEVEMENTS.map((d) => [d.id, d]));
export const achDef = (id: string): AchDef | undefined => BY_ID.get(id);

const CAT_NAME = { hero: '角色', weapon: '法宝', relic: '灵物', elixir: '丹药', charm: '符箓' } as const;

/** 奖励的名字（「金蛟剪」）。 */
export function rewardName(r: Reward): string {
  switch (r.cat) {
    case 'hero':
      return HEROES[r.id].name;
    case 'weapon':
      return WEAPONS[r.id].name;
    case 'relic':
      return RELICS[r.id].name;
    case 'elixir':
      return ELIXIRS[r.id].name;
    case 'charm':
      return CHARMS[r.id].name;
  }
}

/** 奖励那一行（「解锁法宝 · 金蛟剪」）。 */
export const rewardText = (r: Reward) => `解锁${CAT_NAME[r.cat]} · ${rewardName(r)}`;

/** 奖励的物品键（Player.sealed 的格式：'weapon:jinjiao'）；角色不是物品，返回 null。 */
const itemKey = (r: Reward | undefined) => (r && r.cat !== 'hero' ? `${r.cat}:${r.id}` : null);

/** 存档里的解锁 id（角色奖励）。 */
const heroUnlockId = (h: HeroId) => ECHO[h]?.unlock ?? HIDDEN[h]?.unlock ?? EARNED[h]?.unlock ?? null;

/** 还没解锁的物品（开局时交给模拟：RunSetup.sealed，万宝阁不刷）。 */
export function sealedItems(a: Achieved = loadAchieved()): string[] {
  const out: string[] = [];
  for (const d of ACHIEVEMENTS) {
    const k = itemKey(d.reward);
    if (k && !Object.hasOwn(a, d.id)) out.push(k);
  }
  return out;
}

/** 这件东西靠哪一条成就解锁（不是成就奖励的返回 null）。 */
export function lockOf(cat: 'weapon' | 'relic' | 'elixir' | 'charm', id: string): AchDef | null {
  return ACHIEVEMENTS.find((d) => itemKey(d.reward) === `${cat}:${id}`) ?? null;
}

/** 解锁条件的一句话（图鉴里锁着的法宝、道具下面那一行）。 */
export const lockLine = (d: AchDef) => (d.secret ? '达成一项隐秘成就后解锁' : `达成成就「${d.name}」后解锁：${d.desc}`);

// ---------- 达成 ----------

let granting = 0;
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * 记下达成了这些成就，发奖励（角色写进解锁），弹窗（quiet 时不弹：补记旧进度）。返回这次新达成的。
 * 奖励在记下成就之后才发：解锁角色会通知 onUnlock → reconcile，那时这一条已经在存档里了，不会重复。
 */
export function grant(ids: readonly string[], opts: { quiet?: boolean } = {}): AchDef[] {
  const known = ids.filter((id) => BY_ID.has(id));
  if (!known.length && hasAchieveKey()) return [];
  granting++;
  try {
    const fresh = addAchieved(known, opts.quiet ? 0 : nowSec())
      .map((id) => BY_ID.get(id)!)
      .filter(Boolean);
    for (const d of fresh) {
      if (d.reward?.cat !== 'hero') continue;
      const u = heroUnlockId(d.reward.id);
      if (u) unlock(u);
    }
    if (!opts.quiet && fresh.length && typeof document !== 'undefined') void import('./achieve-toast.ts').then((m) => m.showAchievements(fresh)).catch((e) => console.error(e));
    return fresh;
  } finally {
    granting--;
  }
}

/**
 * 按存档里的进度对一遍（prof 判得出的那些）。第一次（存档里还没有成就这一节：老存档、刚导入的旧存档码）补记、不弹窗；之后的都弹。
 * 标题页打开时、图鉴打开时、一局记完成绩时、新解锁了角色时调。
 */
export function reconcile(): AchDef[] {
  const p = loadProfile();
  const ids = ACHIEVEMENTS.filter((d) => !Object.hasOwn(p.achieve, d.id) && d.prof?.(p)).map((d) => d.id);
  return grant(ids, { quiet: !hasAchieveKey() });
}

// 新解锁了角色（打倒回响化身、天上的裂缝）：对应的成就跟着补上（发奖励时解锁的不再对一遍）
onUnlock(() => {
  if (!granting) reconcile();
});

// ---------- 一局里 ----------

const freshFacts = (hero: HeroId, jie: number, online: boolean): RunFacts => ({
  hero,
  jie,
  online,
  chapters: [],
  win: false,
  bosses: [],
  kills: 0,
  combo: 0,
  lingshi: 0,
  elements: 0,
  same: 0,
  gods: 0,
  pet: 0,
  techs: 0,
  bought: 0,
  unhurt: false,
  clutch: false,
  thrift: false,
});

/**
 * 一局里的成就：feel.ts 把每个事件交给 onEvent，每帧调 update（隔几帧看一眼人物的状态），一局记完成绩时调 afterRun。
 * enabled = false（机器人自动玩、调试开局 ?wave=）时什么都不记。只算本机这个人（联机时各算各的：其他人的事件是房主广播来的）。
 */
export class AchRun {
  readonly facts: RunFacts;
  private have: Set<string>;
  private hurtWave = false;
  private next = 0;
  private readonly enabled: boolean;

  constructor(enabled: boolean, o: { hero: HeroId; jie: number; online: boolean }) {
    this.enabled = enabled;
    this.facts = freshFacts(o.hero, o.jie, o.online);
    if (enabled) reconcile();
    this.have = new Set(Object.keys(loadAchieved()));
  }

  onEvent(e: SimEvent, w: World, me: number) {
    if (!this.enabled) return;
    const f = this.facts;
    let check = false;
    switch (e.t) {
      case 'waveStart':
        this.hurtWave = false;
        break;
      case 'hurt':
        if (e.owner === me && e.dmg > 0) this.hurtWave = true;
        break;
      case 'bought':
        if (e.owner === me) f.bought++;
        break;
      case 'bossDeath':
        if (!f.bosses.includes(e.kind)) f.bosses.push(e.kind);
        if (!this.hurtWave && w.players[me]?.alive) f.unhurt = true;
        check = true;
        break;
      case 'echoDefeat':
        if (!f.bosses.includes(e.kind)) f.bosses.push(e.kind);
        check = true;
        break;
      case 'chapterClear':
        if (!f.chapters.includes(e.chapter)) f.chapters.push(e.chapter);
        if (e.chapter === 1 && f.bought === 0) f.thrift = true;
        check = true;
        break;
      case 'win':
        f.win = true;
        if (!f.chapters.includes(CHAPTERS)) f.chapters.push(CHAPTERS);
        check = true;
        break;
      case 'waveEnd': {
        const p = w.players[me];
        if (p && p.alive && p.hp > 0 && p.hp < p.stats.maxHp * ACH_N.clutch) f.clutch = true;
        check = true;
        break;
      }
    }
    if (check) {
      this.look(w, me);
      this.judge();
    }
  }

  /** 每帧调：隔 20 帧看一眼人物（斩敌、灵石、五行、神品、宠物、功法）。combo：表现层算的这一局最高连斩。 */
  update(w: World, me: number, combo: number) {
    if (!this.enabled) return;
    this.facts.combo = Math.max(this.facts.combo, combo);
    if (w.tick < this.next && w.phase !== 'shop') return;
    this.next = w.tick + 20;
    this.look(w, me);
    this.judge();
  }

  /** 一局记完成绩之后：存档里的进度（累计斩敌、各章、劫数……）对一遍。 */
  afterRun() {
    if (!this.enabled) return;
    for (const d of reconcile()) this.have.add(d.id);
  }

  private look(w: World, me: number) {
    const p = w.players[me];
    if (!p) return;
    const f = this.facts;
    f.kills = Math.max(f.kills, p.kills);
    f.lingshi = Math.max(f.lingshi, Math.floor(p.lingshi));
    const ec = elementCounts(p);
    let distinct = 0;
    for (const el of ELEMENTS) {
      if (ec[el] > 0) distinct++;
      f.same = Math.max(f.same, ec[el]);
    }
    f.elements = Math.max(f.elements, distinct);
    f.gods = Math.max(f.gods, p.weapons.filter((x) => x.tier >= 4).length);
    f.pet = Math.max(f.pet, p.pet.stage);
    f.techs = Math.max(f.techs, p.techs.length);
  }

  private judge() {
    const ids: string[] = [];
    for (const d of ACHIEVEMENTS) if (!this.have.has(d.id) && d.run?.(this.facts)) ids.push(d.id);
    if (!ids.length) return;
    for (const id of ids) this.have.add(id);
    grant(ids);
  }
}

// 调试 / 截图：window.__ach.demo(['zheng.ch1', 'gou.wx5']) 只弹窗、不写存档；__ach.list() 看达成了哪些
if (typeof window !== 'undefined')
  (window as unknown as { __ach: unknown }).__ach = {
    demo: (ids: string[] = ['zheng.ch1', 'gou.wx5']) =>
      import('./achieve-toast.ts').then((m) => m.showAchievements(ids.map((id) => BY_ID.get(id)).filter((d): d is AchDef => !!d))),
    list: () => loadAchieved(),
  };
