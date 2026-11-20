// 功法（暂定设计，见 docs/design.md「待评审确认的暂定设计」）：到了 TECH_LEVELS 里的等级（第 3、8、12、14 级）各悟一门，
// 三选一、不重复，选了就一直生效（一局内）；和混天绫的进化（5 / 10 / 15 级）错开。一波里跨过几个门槛，波间整理时就依次悟几门。
// 每门都是改变打法的质变，而不只是加数值：数值在 TECH 表里；给玩家看的说明（TECHNIQUES.desc）只写意象，不写数（2026-11-12 用户口径）。
// 2026-11-12 从 12 门扩到 24 门（feat/gongfa），玩法类别见 TechDef.kind，对照表见 docs/design.md「功法」。
//
// 所有功法的数据、效果和挂钩函数都在这里；别的文件里只留一行调用（函数名都以 tech 开头）：
//   core.ts  tickStatus（三昧真火的灼烧加成）、hitEnemy（天眼通 / 五行轮转 / 寒冰诀 / 九转玄功 / 独修一脉 / 五色神光，印记时长）、
//            onKill（混元一气的真气、九转玄功记数、三昧真火传火）、
//            hurtPlayer（六丁六甲抵挡、法天象地受伤加深、莲花化身重生、金刚不坏反弹、土遁）；
//   world.ts 每波开始（吐纳术回血、紫气东来生息、计时清零）、每帧（风火轮火痕、五雷正法、六丁六甲补甲、太乙真诀、撒豆成兵、呼风唤雨）、
//            放神通之后（掌心雷、太乙真诀）、神通范围（混元一气）、魔气里倒下（莲花化身）、波末收灵（聚灵阵）、打开商店（到了门槛就出三选一）；
//   shop.ts  悟功法的指令 learn；没悟完不能选属性、不能出战；刷新的价（五鬼搬运，rerollCost 也给界面和机器人用）、升级可选几个（五鬼搬运）。
// 纯函数，随机数只用 w.rng；运行时的计时与火痕放在 Player.tech（TechState）里。
import { ARENA, ENEMIES, REACH, SKILL } from './config.ts';
import { placePet } from './pet.ts';
import { HEROES, WEAPONS, chapterOf, rerollPrice, waveScale } from './catalog.ts';
import { addBurn, buildGrid, elementCounts, enemiesWithin, hitEnemy, nearestEnemy, segDist, slowEnemy, type DamageSpec } from './core.ts';
import { ELEMENT_NAME } from './types.ts';
import type { Element, Enemy, HitBy, Player, ReactionKind, SimEvent, Stats, TechniqueId, TechState } from './types.ts';
import type { World } from './world.ts';

/**
 * 悟功法的等级门槛：四门在一局里都要悟得到，而且悟到之后还有几波可用。
 * 按机器人 100 局的等级分布定（`node tools/levels.ts 100`；经验曲线 (等级 + 3)²，升到 18 级要的经验比一整局的灵石进账还多）：
 * 各波后商店里的等级中位是 1 2 3 5 6 8 8 9 10 11 12 13 13 14 15 16 17，所以这四门分别在第 3、6、11、14 波后悟到
 * （九成的局不晚于第 3、7、12、15 波），和混天绫进化的 5 / 10 / 15 级（第 4、9、15 波后）几乎不撞在同一次商店（一百局里两次）。
 * 原来是 3 / 8 / 13 / 18：打到最后一个商店的局里，近九成够不到 18 级，第四门基本悟不到。
 */
export const TECH_LEVELS = [3, 8, 12, 14];
/** 一次出几门让人选。 */
const OFFER_N = 3;
/** 和五行有关的功法：带了几件这一行的法宝，三选一时的权重就加几个 EL_BIAS（最多算两件）。稍微偏向，不强制。 */
const EL_BIAS = 0.5;

/**
 * 各门功法的数值（tools/technique-balance.ts 量过）。功法自己打出的伤害（风火轮、五雷正法、金刚不坏）
 * 按波次和敌人的血量一起涨（waveScale），再吃伤害加成、对应五行的亲和、狂血丹，所以后期不会掉队，也不会盖过法宝。
 */
export const TECH = {
  // 三昧真火：灼烧每一跳的伤害 ×burn；身上带火死去的敌人，把火（每秒伤害的 spread 倍，烧 t 秒）传给 r 像素内最近的 n 只
  sanmei: { burn: 1.5, r: 36, n: 4, spread: 0.8, t: 2.5 },
  // 莲花化身：每章一次，受到致命伤时回 hp 的气血、无敌 iframes 秒，莲花开处把 r 像素内的敌人震开、晕 stun 秒
  lianhua: { hp: 0.5, iframes: 2, r: 64, kb: 300, stun: 0.5 },
  // 风火轮：移速 +speed；移动时每走 gap 像素在脚下留一个火点，火痕存在 life 秒、半宽 w；
  // 每 tick 秒结算一次：踩在火痕上的敌人被点燃（每秒 dps × 波次倍率，离开后再烧 burnT 秒）
  fenghuo: { speed: 0.2, gap: 6, life: 3.5, w: 6, tick: 0.3, dps: 9, burnT: 2 },
  // 混元一气：击杀得到的真气 ×charge；神通范围 ×radius
  hunyuan: { charge: 1.5, radius: 1.3 },
  // 金刚不坏：护体 +armor；真被打中时 chance 的几率把这一下（护体减免之前）的 mul 倍反弹给 r 像素内的敌人（土行），震退、晕 stun 秒；
  // 身边没有敌人（被远处的鬼火打中）就打 reach 像素内最近的一只（射程规则见 config.REACH；原来 200）
  jingang: { armor: 4, chance: 0.3, mul: 3, r: 46, reach: REACH.seek, kb: 240, stun: 0.5 },
  // 五雷正法：每 every 秒在 seek 像素内（射程规则见 config.REACH；原来 220）血最厚的敌人头顶聚云，warn 秒后落雷（dmg × 波次倍率，木行，晕 stun 秒），
  // r 像素内的其他敌人吃 splash 倍；每波开头 first 秒后落第一道。天雷不打印记、不触发相生：
  // 雷总劈血最厚的（首领战里就是首领），留木行印记的话，哪吒的火行法宝每 6 秒就在首领身上接一次「引燃」，首领战快了四成多
  wulei: { first: 1.5, every: 6, warn: 0.6, seek: REACH.seek, dmg: 55, r: 24, splash: 0.6, stun: 0.6 },
  // 寒冰诀：法宝命中有 chance 的几率冻住敌人 freeze 秒（首领除外）；打中冻住的敌人时冰碎迸开（冻结解除）：
  // 这一下伤害 +bonus，并以这一下的 splash 倍波及 r 像素内的敌人、减速 slow（slowT 秒）
  hanjue: { chance: 0.1, freeze: 0.8, bonus: 0.8, r: 32, splash: 0.8, slow: 0.4, slowT: 1.5 },
  // 天眼通：暴击率 +crit；被暴击过的敌人 t 秒内受到的伤害 ×(1 + vuln)（谁打都算）
  tianyan: { crit: 0.1, vuln: 0.1, t: 3 },
  // 聚灵阵：拾取范围 +pickup；波末收灵的灵石不打八折
  lingzhen: { pickup: 0.5 },
  // 吐纳术：每秒回复 +regen；每波开始回 heal 的气血
  tuna: { regen: 0.8, heal: 0.1 },
  // 五行轮转：触发相生的那一下伤害 ×react（导雷的连跳、引燃的灼烧跟着涨）；五行印记的持续时间 ×mark
  lunzhuan: { react: 1.8, mark: 2 },
  // 法天象地：伤害 +damage；受到的伤害 ×hurt；身形画大（表现层）
  fatian: { damage: 0.2, hurt: 1.15 },

  // ---- 2026-11-12 再加的 12 门（暂拟，待评审确认；数值是初值，tools/technique-dps.ts 量到现有功法的中位附近）----
  // 掌心雷（神通）：放神通时，掌心雷劈向 seek 像素内最近的 n 只（每道 dmg × 波次倍率，木行，晕 stun 秒）
  zhangxin: { n: 5, seek: REACH.seek, dmg: 90, stun: 0.5 },
  // 六丁六甲（防守）：护身甲最多 max 道（每波开始补满），每 regen 秒补一道；挨打时（闪避之后、护体之前）耗一道抵掉这一下，无敌 iframes 秒
  liuding: { max: 3, regen: 10, iframes: 0.8 },
  // 斩三尸（代价换收益）：悟得时气血上限 −hp（按当时的上限），伤害 +damage、暴击率 +crit
  zhansan: { hp: 0.25, damage: 0.15, crit: 0.06 },
  // 紫气东来（经济）：每波开始，身上的灵石生息 rate（不足一枚不计，至多 cap 枚）
  ziqi: { rate: 0.1, cap: 12 },
  // 五鬼搬运（经济 · 代价）：每次进万宝阁，前 free 次刷新不要灵石（之后照常从第一次的价起）；升级时可选的属性少 cut 个
  wugui: { free: 2, cut: 1 },
  // 土遁（土行 · 走位）：挨了打、还活着，且被围（身边 r 像素内 crowd 只以上）或气血低于 low → 遁到 dist 像素外敌人最少的方向，冷却 cd 秒；
  // 遁走处土石迸起：r 内的敌人吃 dmg × 波次倍率（土行）、震退、晕 stun 秒；出土后无敌 iframes 秒
  tudun: { r: 40, crowd: 4, low: 0.35, dist: 90, cd: 10, dmg: 20, kb: 220, stun: 0.6, iframes: 0.6 },
  // 九转玄功（越战越强）：这一波每斩 per 只进一转，每转伤害 +step，最多 max 转；每波开始归零
  jiuzhuan: { per: 25, step: 0.025, max: 9 },
  // 太乙真诀（宠物）：宠物出手的间隔 ×cd；放神通时宠物马上再出手
  taiyi: { cd: 0.7 },
  // 独修一脉（专精一行）：法宝里件数最多的那一行（至少两件；宠物不算，并列的都算），这一行的伤害 +bonus[件数]
  sanhua: { bonus: [0, 0, 0.08, 0.14, 0.2] },
  // 五色神光（相生）：每接上 n 次相生，第 n 次的那一下迸作五色元气：以这一下的 mul 倍波及 r 像素内的敌人（不再相生）
  wuqi: { n: 5, mul: 1.2, r: 40 },
  // 撒豆成兵（召唤）：每波开头 first 秒后、之后每 every 秒撒 n 粒豆，fly 秒后落地化为豆兵，扑向身边 seek 像素内的敌人，
  // 再过 dash 秒斩一刀（dmg × 波次倍率，金行，击退 kb），之后散去。落点在人物和目标之间（不远于 land 像素）
  sadou: { first: 2, every: 8, n: 4, seek: 100, land: 26, fly: 0.5, dash: 0.4, dmg: 26, kb: 90 },
  // 呼风唤雨（水行 · 控场）：每波开头 first 秒后、之后每 every 秒，在 seek 像素内敌人最密处降一场雨（半径 r，下 t 秒，不跟着走）；
  // 雨里的敌人减速 slow，每 tick 秒吃 dmg × 波次倍率（水行，打印记）
  hufeng: { first: 3, every: 9, t: 4, seek: REACH.seek, r: 34, slow: 0.35, tick: 0.5, dmg: 4 },
};

/** 功法的玩法类别（图鉴、悟功法的卡上的小字）。 */
export type TechKind = '五行' | '神通' | '宠物' | '召唤' | '走位' | '护身' | '输出' | '控场' | '经济' | '代价';

export interface TechDef {
  name: string;
  kind: TechKind;
  el?: Element; // 和五行有关的功法（三选一时稍微偏向已经带了这一行法宝的）
  desc: string; // 给玩家看的说明（数值从 TECH 表里取）
  apply?: (s: Stats) => void; // 悟得时一次性加的属性（之后在属性栏里看得到）
}

const T = TECH;
const pc = (v: number) => `${Math.round(v * 100)}%`;

// 说明（2026-11-12 用户口径）：书面、凝练、略带古意，一条一句，以意象和出处写它是什么、给人什么感觉；
// 不写秒数、半径、几只、倍率这类规则细节（数值在 TECH 表和 docs/design.md）。
export const TECHNIQUES: Record<TechniqueId, TechDef> = {
  sanmei: {
    name: '三昧真火',
    kind: '五行',
    el: 'fire',
    desc: '真火入骨，灼烧愈烈；焚毙之敌余烬未冷，引燃近旁',
  },
  lianhua: {
    name: '莲花化身',
    kind: '护身',
    desc: `每章一次：濒死化莲重生，回复${T.lianhua.hp === 0.5 ? '半数' : ` ${pc(T.lianhua.hp)} `}气血`,
  },
  fenghuo: {
    name: '风火轮',
    kind: '走位',
    desc: '足踏风火二轮，身法迅疾，行过之处火痕不绝',
    apply: (s) => void (s.speed += T.fenghuo.speed),
  },
  hunyuan: {
    name: '混元一气',
    kind: '神通',
    desc: '混元归一，真气聚得更快，神通所及更广',
  },
  jingang: {
    name: '金刚不坏',
    kind: '护身',
    el: 'earth',
    desc: '金身护体，受击时偶有反震，来犯者自受其力',
    apply: (s) => void (s.armor += T.jingang.armor),
  },
  wulei: {
    name: '五雷正法',
    kind: '输出',
    el: 'wood',
    desc: '五雷随身，时召天雷，劈向场中最强之敌',
  },
  hanjue: {
    name: '寒冰诀',
    kind: '控场',
    el: 'water',
    desc: '法宝偶能冰封敌身；再击冰封之敌，冰碎迸散',
  },
  tianyan: {
    name: '天眼通',
    kind: '输出',
    el: 'metal',
    desc: '天眼洞照，出手易中要害；被看破之敌片刻易伤',
    apply: (s) => void (s.crit += T.tianyan.crit),
  },
  lingzhen: {
    name: '聚灵阵',
    kind: '经济',
    desc: '灵气自聚，拾取更远，波末收灵分毫不折',
    apply: (s) => void (s.pickup += T.lingzhen.pickup),
  },
  tuna: {
    name: '吐纳术',
    kind: '护身',
    desc: '吐故纳新，气血自复；每波伊始，元气更复一截',
    apply: (s) => void (s.regen += T.tuna.regen),
  },
  lunzhuan: {
    name: '五行轮转',
    kind: '五行',
    desc: '五行流转不息，印记久驻，相生之威大增',
  },
  fatian: {
    name: '法天象地',
    kind: '代价',
    desc: '化作法相，力大无穷；然身形既巨，受伤亦重',
    apply: (s) => void (s.damage += T.fatian.damage),
  },
  // ---- 2026-11-12 再加的 12 门 ----
  zhangxin: {
    name: '掌心雷',
    kind: '神通',
    el: 'wood',
    desc: '神通既发，掌心雷随之分劈近旁诸敌',
  },
  liuding: {
    name: '六丁六甲',
    kind: '护身',
    desc: '六丁六甲护持左右，可代受数击，久之复聚',
  },
  zhansan: {
    name: '斩三尸',
    kind: '代价',
    desc: '斩却三尸，舍一截气血，换得锋芒更盛',
    apply: (s) => {
      s.maxHp = Math.max(1, Math.round(s.maxHp * (1 - T.zhansan.hp)));
      s.damage += T.zhansan.damage;
      s.crit += T.zhansan.crit;
    },
  },
  ziqi: {
    name: '紫气东来',
    kind: '经济',
    desc: `每波开始，所余灵石生息${T.ziqi.rate === 0.1 ? '一成' : ` ${pc(T.ziqi.rate)}`}`,
  },
  wugui: {
    name: '五鬼搬运',
    kind: '代价',
    desc: '役使五鬼搬运，万宝阁刷新常可不费；然升级少一选',
  },
  tudun: {
    name: '土遁',
    kind: '走位',
    el: 'earth',
    desc: '遭围或垂危时遁入土中，自远处破土而出',
  },
  jiuzhuan: {
    name: '九转玄功',
    kind: '输出',
    desc: '越战越坚，一波之中斩敌愈多，伤害愈高，至九转而止',
  },
  taiyi: {
    name: '太乙真诀',
    kind: '宠物',
    desc: '太乙真人亲传，宠物出手更勤，神通起时随之而动',
  },
  sanhua: {
    name: '独修一脉',
    kind: '五行',
    desc: '专修一行，同行法宝越多，此行威力越盛',
  },
  wuqi: {
    name: '五色神光',
    kind: '五行',
    desc: '相生积久，五色神光迸散四周',
  },
  sadou: {
    name: '撒豆成兵',
    kind: '召唤',
    el: 'metal',
    desc: '时时撒豆成兵，金甲豆兵各扑一敌斩之',
  },
  hufeng: {
    name: '呼风唤雨',
    kind: '控场',
    el: 'water',
    desc: '呼风唤雨，雨落敌群聚处，雨中之敌步履迟滞',
  },
};

/** 功法的显示顺序（图鉴、测试）。 */
export const TECH_IDS = Object.keys(TECHNIQUES) as TechniqueId[];

/** 说明里带上它属于哪一行（界面用）。 */
export const techElementName = (id: TechniqueId) => (TECHNIQUES[id].el ? ELEMENT_NAME[TECHNIQUES[id].el!] : '');

export const has = (p: Player | undefined | null, id: TechniqueId) => !!p?.techs?.includes(id);

function state(p: Player): TechState {
  return (p.tech ??= {
    lotus: 0,
    bolt: TECH.wulei.first,
    boltAt: -1,
    boltT: 0,
    boltX: 0,
    boltY: 0,
    trail: [],
    trailTick: 0,
    jia: TECH.liuding.max,
    jiaT: TECH.liuding.regen,
    dunCd: 0,
    kills: 0,
    zhuan: 0,
    reacts: 0,
    bean: TECH.sadou.first,
    beans: [],
    rain: TECH.hufeng.first,
    storm: null,
  });
}

/** 功法自己打出的伤害：按波次和敌人的血量一起涨，再吃伤害加成、这一行的亲和、狂血丹。 */
function power(w: World, p: Player, el?: Element) {
  return waveScale(w.wave).hp * (1 + p.stats.damage + (el ? p.stats.aff[el] : 0) + p.buffs.rage * 0.3);
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// ---------------------------------------------------------------- 门槛与三选一

/** 这一刻还该悟几门：跨过的门槛数 − 已悟的门数。 */
export const techDue = (p: Player) => TECH_LEVELS.filter((l) => p.level >= l).length - p.techs.length;

/** 下一门功法在第几级悟（都悟完了返回 0）。 */
export const nextTechLevel = (p: Player) => TECH_LEVELS[p.techs.length] ?? 0;

/** 法宝里各行的件数（不算宠物；独修一脉用）。 */
function weaponElements(p: Player): Record<Element, number> {
  const c: Record<Element, number> = { metal: 0, wood: 0, water: 0, fire: 0, earth: 0 };
  for (const wpn of p.weapons) c[WEAPONS[wpn.kind].el]++;
  return c;
}

/**
 * 三选一时的权重：和五行有关的，带了这一行的法宝就稍微容易出（每件 +EL_BIAS，最多算两件）；
 * 独修一脉看法宝里件数最多的那一行多出一件算一份，五色神光看带了几行（三行起每多一行算一份），同样最多两份。
 */
function weightOf(id: TechniqueId, ec: Record<Element, number>, p: Player) {
  if (id === 'sanhua') return 1 + EL_BIAS * Math.min(2, Math.max(0, Math.max(...Object.values(weaponElements(p))) - 1));
  if (id === 'wuqi') return 1 + EL_BIAS * Math.min(2, Math.max(0, Object.values(ec).filter((n) => n > 0).length - 2));
  const el = TECHNIQUES[id].el;
  return el ? 1 + EL_BIAS * Math.min(2, ec[el]) : 1;
}

/** 到了门槛、手里又没有待选的，就出三选一：没悟过的功法里按权重不放回地抽三门。打开商店时调用。 */
export function offerTechnique(w: World, p: Player) {
  if (p.techOffer || techDue(p) <= 0) return;
  const ec = elementCounts(p);
  // 神通就叫「法天象地」的（孙悟空），不再出同名的那门功法（两样同名的东西摆在一起分不清；别的角色照旧）
  const pool = TECH_IDS.filter((id) => !p.techs.includes(id) && !(id === 'fatian' && HEROES[p.hero].skill === 'faxiang'));
  const out: TechniqueId[] = [];
  while (out.length < OFFER_N && pool.length) {
    const wts = pool.map((id) => weightOf(id, ec, p));
    let r = w.rng.next() * wts.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= wts[i]) >= 0) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  p.techOffer = out.length ? out : null;
}

/** 悟一门（shop.applyCommand 的 learn）：要先选完宠物进化；悟完还该悟的，接着出下一组三选一。 */
export function learnTechnique(w: World, p: Player, id: TechniqueId, ev: SimEvent[]) {
  if (p.petOffer || !p.techOffer?.includes(id) || p.techs.includes(id)) return;
  p.techs.push(id);
  const before = p.stats.maxHp;
  TECHNIQUES[id].apply?.(p.stats);
  if (p.stats.maxHp > before) p.hp += p.stats.maxHp - before;
  p.hp = Math.min(p.hp, p.stats.maxHp); // 斩三尸：上限降了，气血跟着收
  p.techOffer = null;
  ev.push({ t: 'learn', owner: p.id, kind: id });
  offerTechnique(w, p);
}

// ---------------------------------------------------------------- 挂钩：core.ts

/**
 * core.tickStatus：灼烧累积伤害的倍数（三昧真火，看是谁点的火）。加在跳伤害上、不加在身上的灼烧值上：
 * 燎原、熔岩、传火都按灼烧值往外传，加在灼烧值上会越传越旺；也不加在每一跳的整数伤害上（一跳常常只有 1 点，取整会变成翻倍）。
 */
export const techBurnTick = (w: World, e: Enemy) => (has(w.players[e.burnBy], 'sanmei') ? TECH.sanmei.burn : 1);

/** core.hitEnemy：五行印记持续时间的倍数（五行轮转）。 */
export const techMarkMul = (p: Player | undefined) => (has(p, 'lunzhuan') ? TECH.lunzhuan.mark : 1);

/** 持续伤害、爆炸、相生的额外伤害：不触发寒冰诀（冰碎的波及也是爆炸，所以不会一碎连一串）。 */
const NOT_DIRECT: ReadonlySet<HitBy> = new Set<HitBy>(['burn', 'bleed', 'zone', 'react', 'explode', 'sword']); // sword：第三章四剑轮斩的剑气（地形的伤害，不算人物打的）

/**
 * core.hitEnemy：算完暴击之后、结算之前调一次（dmg 是这时的伤害），返回这一下的伤害倍数，顺带结算这一下引起的功法效果：
 * 天眼通（被看破的敌人受伤加深 —— 谁打都算；这一下暴击了就看破它）、五行轮转（相生的那一下加伤）、
 * 寒冰诀（打中冻住的敌人：冰碎迸开，这一下加伤并波及身边；没冻住的有几率冻住）。
 */
export function techHitMul(w: World, p: Player | undefined, e: Enemy, s: DamageSpec, dmg: number, react: ReactionKind | null, crit: boolean, ev: SimEvent[]): number {
  let m = e.eyeUntil !== undefined && w.time < e.eyeUntil ? 1 + TECH.tianyan.vuln : 1;
  if (!p?.techs?.length) return m;
  if (react && has(p, 'lunzhuan')) m *= TECH.lunzhuan.react;
  if (has(p, 'jiuzhuan') && p.tech?.zhuan) m *= 1 + p.tech.zhuan * TECH.jiuzhuan.step;
  if (s.el && has(p, 'sanhua')) m *= 1 + sanhuaBonus(p, s.el);
  if (react && has(p, 'wuqi') && ++state(p).reacts >= TECH.wuqi.n) {
    state(p).reacts = 0;
    wuqiBurst(w, p, e, dmg * m * TECH.wuqi.mul, ev);
  }
  if (crit && has(p, 'tianyan')) {
    if (e.eyeUntil === undefined || w.time >= e.eyeUntil) ev.push({ t: 'tech', kind: 'tianyan', owner: p.id, x: e.x, y: e.y, id: e.id });
    e.eyeUntil = w.time + TECH.tianyan.t;
  }
  if (has(p, 'hanjue') && !NOT_DIRECT.has(s.by) && e.kind !== 'boss') {
    const H = TECH.hanjue;
    if (e.frozen > 0) {
      m *= 1 + H.bonus;
      shatter(w, p, e, dmg * m * H.splash, ev);
    } else if (w.rng.next() < H.chance) {
      const f = H.freeze * (elementCounts(p).water >= 1 ? 1.2 : 1); // 水行一件：冻得更久（和别的冻结同一条规则）
      ev.push({ t: 'freeze', id: e.id, x: e.x, y: e.y });
      e.frozen = f;
      e.stun = Math.max(e.stun, f);
    }
  }
  return m;
}

/** 独修一脉：这一行是不是法宝里件数最多的那一行（至少两件，并列的都算），是的话加几成。 */
function sanhuaBonus(p: Player, el: Element) {
  const c = weaponElements(p);
  const top = Math.max(...Object.values(c));
  if (top < 2 || c[el] !== top) return 0;
  const B = TECH.sanhua.bonus;
  return B[Math.min(B.length - 1, top)];
}

/** 五色神光：第 n 次相生的那一下迸作五色元气，波及身边（爆炸：不打印记、不再相生、不触发寒冰诀）。 */
function wuqiBurst(w: World, p: Player, e: Enemy, dmg: number, ev: SimEvent[]) {
  const r = TECH.wuqi.r * (1 + p.stats.area * 0.5);
  ev.push({ t: 'tech', kind: 'wuqi', owner: p.id, x: e.x, y: e.y, id: e.id, r });
  buildGrid(w.enemies);
  for (const o of enemiesWithin(w, e.x, e.y, r)) {
    if (o === e) continue;
    hitEnemy(w, o, { dmg, by: 'explode', owner: p.id, from: e, kb: 60, canCrit: false }, ev);
  }
}

/** 寒冰诀：冰碎迸开 —— 冻结解除（只留一下踉跄），碎冰波及身边的敌人并减速。 */
function shatter(w: World, p: Player, e: Enemy, dmg: number, ev: SimEvent[]) {
  const H = TECH.hanjue;
  e.frozen = 0;
  e.stun = Math.min(e.stun, 0.2);
  const r = H.r * (1 + p.stats.area * 0.5);
  ev.push({ t: 'tech', kind: 'hanjue', owner: p.id, x: e.x, y: e.y, id: e.id, r });
  buildGrid(w.enemies);
  for (const o of enemiesWithin(w, e.x, e.y, r)) {
    if (o === e) continue;
    hitEnemy(w, o, { dmg, by: 'explode', owner: p.id, from: e, kb: 70, el: 'water', canCrit: false }, ev);
    slowEnemy(w, o, p.id, H.slow, H.slowT);
  }
}

/** core.onKill（击杀者 p）：混元一气多给真气；九转玄功记数、进转；三昧真火 —— 带火死去的敌人把火传给身边的（看是谁点的火）。 */
export function techKill(w: World, p: Player, e: Enemy, ev: SimEvent[]) {
  if (has(p, 'hunyuan')) {
    const charge = e.kind === 'elite' || e.kind === 'boss' ? SKILL.chargePerElite : SKILL.chargePerKill;
    p.skill = Math.min(1, p.skill + charge * (TECH.hunyuan.charge - 1));
  }
  if (has(p, 'jiuzhuan')) {
    const st = state(p);
    const J = TECH.jiuzhuan;
    st.kills++;
    if (st.zhuan < J.max && st.kills >= (st.zhuan + 1) * J.per) {
      st.zhuan++;
      ev.push({ t: 'tech', kind: 'jiuzhuan', owner: p.id, x: p.x, y: p.y, v: st.zhuan });
    }
  }
  const burner = e.burnT > 0 && e.burn > 0 ? w.players[e.burnBy] : undefined;
  if (burner && has(burner, 'sanmei')) spreadFire(w, burner, e, ev);
}

/** 三昧真火传火：同一把火（每秒伤害打个折）直接烧到身边最近的几只身上（加成在跳伤害时才算，所以传下去不会越烧越旺）。 */
function spreadFire(w: World, p: Player, e: Enemy, ev: SimEvent[]) {
  const S = TECH.sanmei;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, e.x, e.y, S.r * (1 + p.stats.area * 0.5))
    .filter((o) => o !== e)
    .sort((a, b) => d2(a, e) - d2(b, e))
    .slice(0, S.n);
  if (!near.length) return;
  const dps = e.burn * S.spread;
  for (const o of near) {
    o.burn = Math.max(o.burn, dps);
    o.burnT = Math.max(o.burnT, S.t * (o.fireVulnT > 0 ? 2 : 1)); // 火绫「引火」：灼烧持续翻倍（和 addBurn 一致）
    o.burnBy = p.id;
  }
  ev.push({ t: 'tech', kind: 'sanmei', owner: p.id, x: e.x, y: e.y, pts: near.map((o) => [o.x, o.y] as [number, number]) });
}

/** core.hurtPlayer：受到的伤害的倍数（法天象地）。 */
export const techHurtMul = (p: Player) => (has(p, 'fatian') ? TECH.fatian.hurt : 1);

/**
 * core.hurtPlayer：真扣了血之后（替身符之后、发 hurt 事件之前）调一次。raw 是护体减免之前的伤害。
 * 致命伤：莲花化身重生；还活着：金刚不坏有几率反弹。
 */
export function techHurt(w: World, p: Player, raw: number, ev: SimEvent[]) {
  if (p.hp <= 0) lotus(w, p, ev);
  if (p.hp > 0 && has(p, 'jingang') && w.rng.next() < TECH.jingang.chance) reflect(w, p, raw, ev);
  if (p.hp > 0 && has(p, 'tudun')) earthEscape(w, p, ev);
}

/**
 * core.hurtPlayer：闪避、混元伞、护心符、护盾之后，护体减免之前调一次。六丁六甲还有甲就耗一道、抵掉这一下（返回 true）。
 */
export function techBlock(w: World, p: Player, ev: SimEvent[]): boolean {
  if (!has(p, 'liuding')) return false;
  const st = state(p);
  if (st.jia <= 0) return false;
  st.jia--;
  if (st.jia === TECH.liuding.max - 1) st.jiaT = TECH.liuding.regen; // 从满甲耗掉第一道：补甲从这时起算
  p.iframes = Math.max(p.iframes, TECH.liuding.iframes);
  ev.push({ t: 'tech', kind: 'liuding', act: 'block', owner: p.id, x: p.x, y: p.y, v: st.jia });
  return true;
}

/**
 * 土遁：被围或气血垂危时挨了打 → 遁到敌人最少的那个方向（十二个方向里挑，起始方向随机；不出仙台），冷却 cd 秒。
 * 遁走处土石迸起：震退、晕住身边的敌人（土行，打印记）。宠物跟着摆回身边。
 */
function earthEscape(w: World, p: Player, ev: SimEvent[]) {
  const D = TECH.tudun;
  const st = state(p);
  if (st.dunCd > 0) return;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, D.r);
  if (near.length < D.crowd && p.hp >= p.stats.maxHp * D.low) return;
  st.dunCd = D.cd;
  const pad = 24;
  const inset = w.miasmaInset;
  const a0 = w.rng.next() * Math.PI * 2;
  let best = { x: p.x, y: p.y, n: Infinity };
  for (let i = 0; i < 12; i++) {
    const a = a0 + (i / 12) * Math.PI * 2;
    const x = Math.max(inset.x + pad, Math.min(ARENA.w - inset.x - pad, p.x + Math.cos(a) * D.dist));
    const y = Math.max(inset.y + pad, Math.min(ARENA.h - inset.y - pad, p.y + Math.sin(a) * D.dist * 0.75));
    const short = D.dist - Math.hypot(x - p.x, (y - p.y) / 0.75); // 贴着边、遁不远的方向扣分
    const n = enemiesWithin(w, x, y, 50).length + Math.max(0, short) / 15;
    if (n < best.n) best = { x, y, n };
  }
  const r = D.r * (1 + p.stats.area * 0.5);
  ev.push({ t: 'tech', kind: 'tudun', owner: p.id, x: p.x, y: p.y, r, pts: [[best.x, best.y]] });
  const dmg = D.dmg * power(w, p, 'earth');
  const from = { x: p.x, y: p.y };
  for (const e of enemiesWithin(w, p.x, p.y, r)) hitEnemy(w, e, { dmg, by: 'dun', owner: p.id, from, kb: D.kb, el: 'earth', stun: D.stun }, ev);
  p.x = p.px = best.x;
  p.y = p.py = best.y;
  p.iframes = Math.max(p.iframes, D.iframes);
  placePet(p);
}

/** world.step：在魔气里耗尽了气血。莲花化身能救就救（返回 true），否则照常倒下。 */
export const techSave = (w: World, p: Player, ev: SimEvent[]) => lotus(w, p, ev);

/** 莲花化身：每章一次。回一半气血、无敌片刻，莲开处把身边的敌人震开、晕一下（不打伤害）。 */
function lotus(w: World, p: Player, ev: SimEvent[]): boolean {
  if (!has(p, 'lianhua')) return false;
  const st = state(p);
  const ch = chapterOf(w.wave);
  if (st.lotus === ch) return false;
  st.lotus = ch;
  const L = TECH.lianhua;
  p.hp = Math.max(1, Math.round(p.stats.maxHp * L.hp));
  p.iframes = Math.max(p.iframes, L.iframes);
  const r = L.r * (1 + p.stats.area * 0.5);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, p.x, p.y, r)) {
    if (e.kind === 'boss') continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
    const k = (L.kb * (1 - (0.5 * d) / r)) / ENEMIES[e.kind].mass;
    e.kx += ((e.x - p.x) / d) * k;
    e.ky += ((e.y - p.y) / d) * k;
    e.stun = Math.max(e.stun, L.stun);
  }
  ev.push({ t: 'tech', kind: 'lianhua', owner: p.id, x: p.x, y: p.y, r });
  return true;
}

/**
 * 金刚不坏：把这一下（护体减免之前）的几倍反弹回去（土行，会打出印记、接上相生），震退并晕一下。
 * 身边有敌人就震身边的；没有（被鬼火这类远处的东西打中）就打向最近的一只。
 */
function reflect(w: World, p: Player, raw: number, ev: SimEvent[]) {
  const J = TECH.jingang;
  const r = J.r * (1 + p.stats.area * 0.5);
  buildGrid(w.enemies);
  let near = enemiesWithin(w, p.x, p.y - 4, r);
  let far = false;
  if (!near.length) {
    const o = nearestEnemy(w, p.x, p.y, J.reach);
    if (!o) return;
    near = [o];
    far = true;
  }
  const dmg = raw * J.mul * (1 + p.stats.damage + p.stats.aff.earth + p.buffs.rage * 0.3);
  ev.push({ t: 'tech', kind: 'jingang', owner: p.id, x: p.x, y: p.y, r: far ? 0 : r, ids: near.map((e) => e.id), pts: near.map((e) => [e.x, e.y] as [number, number]) });
  for (const e of near) hitEnemy(w, e, { dmg, by: 'shield', owner: p.id, from: p, kb: J.kb, el: 'earth', stun: J.stun }, ev);
}

// ---------------------------------------------------------------- 挂钩：world.ts

/** world.step 神通的范围倍数（混元一气）。 */
export const techSkillRadius = (p: Player) => (has(p, 'hunyuan') ? TECH.hunyuan.radius : 1);

/** world.endWave 波末收灵：灵石按几折算（聚灵阵不打折）。 */
export const techVacuum = (p: Player | undefined, base: number) => (has(p, 'lingzhen') ? 1 : base);

/** world.startWave：每波开始。吐纳术回血、紫气东来生息；各门的计时、火痕、甲、转数清零或补满。 */
export function techWaveStart(w: World, p: Player, ev: SimEvent[]) {
  if (!p.techs?.length) return;
  const st = state(p);
  st.bolt = TECH.wulei.first;
  st.boltAt = -1;
  st.trail = [];
  st.trailTick = 0;
  st.jia = TECH.liuding.max;
  st.jiaT = TECH.liuding.regen;
  st.dunCd = 0;
  st.kills = 0;
  st.zhuan = 0;
  st.reacts = 0;
  st.bean = TECH.sadou.first;
  st.beans = [];
  st.rain = TECH.hufeng.first;
  st.storm = null;
  if (has(p, 'ziqi') && p.alive) {
    const v = Math.min(TECH.ziqi.cap, Math.floor(p.lingshi * TECH.ziqi.rate));
    if (v > 0) {
      p.lingshi += v;
      ev.push({ t: 'tech', kind: 'ziqi', owner: p.id, x: p.x, y: p.y, v });
    }
  }
  if (has(p, 'tuna') && p.alive) {
    const v = Math.min(p.stats.maxHp - p.hp, Math.round(p.stats.maxHp * TECH.tuna.heal));
    if (v > 0) {
      p.hp += v;
      ev.push({ t: 'tech', kind: 'tuna', owner: p.id, x: p.x, y: p.y, v });
    }
  }
}

/** world.step 每帧（活着的玩家，法宝和宠物之后）：风火轮的火痕、五雷正法。 */
export function updateTechniques(w: World, p: Player, dt: number, ev: SimEvent[]) {
  if (!p.techs?.length) return;
  if (has(p, 'fenghuo')) updateTrail(w, p, dt);
  if (has(p, 'wulei')) updateBolt(w, p, dt, ev);
  if (has(p, 'liuding')) updateJia(p, dt);
  if (has(p, 'tudun')) state(p).dunCd = Math.max(0, state(p).dunCd - dt);
  if (has(p, 'taiyi') && p.pet.cd > 0) p.pet.cd -= dt * (1 / TECH.taiyi.cd - 1); // 宠物自己的计时照常走，这里替它多走几成
  if (has(p, 'sadou')) updateBeans(w, p, dt, ev);
  if (has(p, 'hufeng')) updateRain(w, p, dt, ev);
}

/** 六丁六甲：没满就慢慢补，一道一道来。 */
function updateJia(p: Player, dt: number) {
  const st = state(p);
  const L = TECH.liuding;
  if (st.jia >= L.max) return;
  st.jiaT -= dt;
  if (st.jiaT > 0) return;
  st.jia++;
  st.jiaT = L.regen;
}

/**
 * 撒豆成兵：隔一会儿朝身边的几只敌人各撒一粒豆（落在人物和它之间），落地化为豆兵，扑上去斩一刀就散。
 * 落地时目标已经死了，就近找一只（seek 的一半以内）；找不到就散掉（发一个没斩到的 strike）。
 */
function updateBeans(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const S = TECH.sadou;
  const st = state(p);
  for (let i = st.beans.length - 1; i >= 0; i--) {
    const b = st.beans[i];
    b.t += dt;
    if (b.t < S.fly + S.dash) continue;
    st.beans.splice(i, 1);
    let e = w.enemies.find((o) => o.id === b.id && o.hp > 0) ?? null;
    if (!e || d2(e, b) > S.seek * S.seek) e = nearestEnemy(w, b.x, b.y, S.seek * 0.5);
    ev.push({ t: 'tech', kind: 'sadou', act: 'strike', owner: p.id, x: e?.x ?? b.x, y: e?.y ?? b.y, id: e?.id ?? -1, pts: [[b.x, b.y]] });
    if (e) hitEnemy(w, e, { dmg: S.dmg * power(w, p, 'metal'), by: 'bean', owner: p.id, from: b, kb: S.kb, el: 'metal' }, ev);
  }
  st.bean -= dt;
  if (st.bean > 0) return;
  const near = w.enemies
    .filter((e) => e.hp > 0 && e.invuln <= 0 && d2(e, p) <= S.seek * S.seek)
    .sort((a, b) => d2(a, p) - d2(b, p) || a.id - b.id)
    .slice(0, S.n);
  if (!near.length) {
    st.bean = 0.5; // 身边没有敌人：过一会儿再看
    return;
  }
  st.bean = S.every;
  const pts: [number, number][] = [];
  for (const e of near) {
    const d = Math.sqrt(d2(e, p)) || 1;
    const k = Math.min(S.land, d * 0.5) / d;
    const x = p.x + (e.x - p.x) * k;
    const y = p.y + (e.y - p.y) * k;
    st.beans.push({ x, y, t: 0, id: e.id });
    pts.push([x, y]);
  }
  ev.push({ t: 'tech', kind: 'sadou', act: 'sow', owner: p.id, x: p.x, y: p.y, pts, ids: near.map((e) => e.id), t2: S.fly });
}

/** 呼风唤雨：隔一会儿在附近敌人最密的地方降一场雨（不跟着走）；雨里的敌人减速，隔一会儿沾一下水（水行，打印记）。 */
function updateRain(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const H = TECH.hufeng;
  const st = state(p);
  const r = H.r * (1 + Math.min(REACH.area, p.stats.area));
  if (st.storm) {
    const s = st.storm;
    s.t -= dt;
    s.tick -= dt;
    if (s.tick <= 0) {
      s.tick += H.tick;
      buildGrid(w.enemies);
      const dmg = H.dmg * power(w, p, 'water');
      for (const e of enemiesWithin(w, s.x, s.y, r)) {
        slowEnemy(w, e, p.id, H.slow, H.tick + 0.15);
        hitEnemy(w, e, { dmg, by: 'rain', owner: p.id, from: s, el: 'water', canCrit: false }, ev);
      }
    }
    if (s.t <= 0) st.storm = null;
    return;
  }
  st.rain -= dt;
  if (st.rain > 0) return;
  buildGrid(w.enemies);
  let best: Enemy | null = null;
  let bn = 0;
  let k = 0;
  for (const e of w.enemies) {
    if (e.hp <= 0 || d2(e, p) > H.seek * H.seek) continue;
    if (++k > 48) break; // 只看前几十只：够挑出一处密的了
    const n = enemiesWithin(w, e.x, e.y, r).length;
    if (n > bn) {
      bn = n;
      best = e;
    }
  }
  if (!best) {
    st.rain = 0.5;
    return;
  }
  st.rain = H.every;
  st.storm = { x: best.x, y: best.y, t: H.t, tick: 0.2 };
  ev.push({ t: 'tech', kind: 'hufeng', act: 'start', owner: p.id, x: best.x, y: best.y, r, t2: H.t });
}

/** world.step 放神通之后：掌心雷劈身边最近的几只；太乙真诀让宠物马上再出手。 */
export function techSkill(w: World, p: Player, ev: SimEvent[]) {
  if (!p.techs?.length) return;
  if (has(p, 'taiyi')) p.pet.cd = Math.min(p.pet.cd, 0);
  if (!has(p, 'zhangxin')) return;
  const Z = TECH.zhangxin;
  const near = w.enemies
    .filter((e) => e.hp > 0 && e.invuln <= 0 && d2(e, p) <= Z.seek * Z.seek)
    .sort((a, b) => d2(a, p) - d2(b, p) || a.id - b.id)
    .slice(0, Z.n);
  if (!near.length) return;
  ev.push({ t: 'tech', kind: 'zhangxin', owner: p.id, x: p.x, y: p.y, ids: near.map((e) => e.id), pts: near.map((e) => [e.x, e.y] as [number, number]) });
  const dmg = Z.dmg * power(w, p, 'wood');
  for (const e of near) hitEnemy(w, e, { dmg, by: 'thunder', owner: p.id, from: p, kb: 40, el: 'wood', stun: Z.stun }, ev);
}

// ---------------------------------------------------------------- 挂钩：shop.ts、界面

/** 这一次刷新万宝阁要几枚灵石（五鬼搬运：每次进万宝阁前几次不要钱，之后从第一次的价起）。shop.ts、界面、机器人都用这一个。 */
/** 每进万宝阁，头几次刷新不花灵石（五鬼搬运）；刷新的价在 shop.rerollCost 里合算。 */
export const techFreeRerolls = (p: Player) => (has(p, 'wugui') ? TECH.wugui.free : 0);

/** 升级时少几个属性可选（五鬼搬运）。 */
export const techOfferCut = (p: Player) => (has(p, 'wugui') ? TECH.wugui.cut : 0);

/** 风火轮：走过的地方留下火点，连成一道火痕；每隔一会儿点燃踩在上面的敌人。 */
function updateTrail(w: World, p: Player, dt: number) {
  const F = TECH.fenghuo;
  const st = state(p);
  const tr = st.trail;
  const last = tr[tr.length - 1];
  if (p.moving && (!last || d2(last, p) >= F.gap * F.gap)) tr.push({ x: p.x, y: p.y, t: w.time });
  while (tr.length && w.time - tr[0].t > F.life) tr.shift();
  st.trailTick -= dt;
  if (st.trailTick > 0) return;
  st.trailTick = F.tick;
  if (tr.length < 2) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of tr) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const pad = F.w + 12;
  const dps = F.dps * power(w, p, 'fire');
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.x < x0 - pad || e.x > x1 + pad || e.y < y0 - pad || e.y > y1 + pad) continue;
    const rr = F.w + ENEMIES[e.kind].radius * 0.5;
    for (let i = 1; i < tr.length; i++) {
      if (segDist(e.x, e.y, tr[i - 1].x, tr[i - 1].y, tr[i].x, tr[i].y) > rr) continue;
      addBurn(w, e, p.id, dps, F.burnT);
      break;
    }
  }
}

/** 五雷正法：隔一会儿在附近血最厚的敌人头顶聚云（跟着它走），片刻后落雷。 */
function updateBolt(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const B = TECH.wulei;
  const st = state(p);
  if (st.boltAt >= 0) {
    const t = w.enemies.find((e) => e.id === st.boltAt && e.hp > 0) ?? null;
    if (t) {
      st.boltX = t.x;
      st.boltY = t.y;
    }
    st.boltT -= dt;
    if (st.boltT > 0) return;
    strike(w, p, t, ev);
    st.boltAt = -1;
    st.bolt = B.every - B.warn; // 落雷到落雷正好 every 秒
    return;
  }
  st.bolt -= dt;
  if (st.bolt > 0) return;
  let best: Enemy | null = null;
  for (const e of w.enemies) if (e.hp > 0 && e.invuln <= 0 && d2(e, p) <= B.seek * B.seek && (!best || e.hp > best.hp)) best = e;
  if (!best) {
    st.bolt = 0.4; // 附近没有敌人：过一会儿再看
    return;
  }
  st.boltAt = best.id;
  st.boltT = B.warn;
  st.boltX = best.x;
  st.boltY = best.y;
  ev.push({ t: 'tech', kind: 'wulei', act: 'warn', owner: p.id, x: best.x, y: best.y, id: best.id, t2: B.warn });
}

function strike(w: World, p: Player, t: Enemy | null, ev: SimEvent[]) {
  const B = TECH.wulei;
  const st = state(p);
  const x = st.boltX;
  const y = st.boltY;
  const r = B.r * (1 + p.stats.area * 0.5);
  const dmg = B.dmg * power(w, p, 'wood');
  ev.push({ t: 'tech', kind: 'wulei', act: 'strike', owner: p.id, x, y, r });
  buildGrid(w.enemies);
  const near = enemiesWithin(w, x, y, r);
  if (t) hitEnemy(w, t, { dmg, by: 'thunder', owner: p.id, from: { x, y }, el: 'wood', stun: B.stun, noMark: true }, ev);
  for (const o of near) if (o !== t) hitEnemy(w, o, { dmg: dmg * B.splash, by: 'thunder', owner: p.id, from: { x, y }, kb: 60, el: 'wood', stun: B.stun * 0.5, noMark: true }, ev);
}

// ---------------------------------------------------------------- 机器人

/**
 * 机器人悟功法（bot.botShop 调用）：按手里的构筑给三门打分，挑最高的。
 * 保命的（莲花化身、吐纳术）一直有分；五行功法看带了几件那一行的法宝；五行轮转看已经成了几种相生。
 */
export function botTechnique(w: World, p: Player): TechniqueId | null {
  const offer = p.techOffer;
  if (!offer?.length) return null;
  const ec = elementCounts(p);
  const hp = p.hp / p.stats.maxHp;
  const reacts = (['wood>fire', 'fire>earth', 'earth>metal', 'metal>water', 'water>wood'] as const).filter((k) => {
    const [a, b] = k.split('>') as [Element, Element];
    return ec[a] > 0 && ec[b] > 0; // 宠物算一件（elementCounts 里有宠物那一行：它打的是自己那一行的印记）
  }).length;
  const score: Record<TechniqueId, number> = {
    lianhua: 9,
    tuna: 8.5 + (hp < 0.6 ? 1 : 0), // 机器人的掉血六成是鬼火这种零碎伤害，回复最管用（tools/technique-balance.ts --each）
    fenghuo: 5, // 跑得快反而把敌人甩远、法宝打得少；人玩的话躲首领的招很有用
    fatian: 6,
    sanmei: 4 + 1.5 * Math.min(3, ec.fire),
    wulei: 6 + 1.5 * Math.min(3, ec.wood),
    hanjue: 4 + 2 * Math.min(3, ec.water),
    tianyan: 6 + 1.5 * Math.min(3, ec.metal),
    jingang: 6 + 1.5 * Math.min(3, ec.earth),
    hunyuan: 5,
    lingzhen: p.level <= 4 ? 6 : 3,
    lunzhuan: 3 + 2 * reacts,
    // 2026-11-12 再加的：机器人的打分只是给个大概，保命的偏高、经济的看等级、五行的看构筑
    zhangxin: 5 + Math.min(3, ec.wood),
    liuding: 8,
    zhansan: hp > 0.8 ? 5 : 3,
    ziqi: p.level <= 4 ? 5 : 3,
    wugui: 2,
    tudun: 6 + Math.min(3, ec.earth),
    jiuzhuan: 6,
    taiyi: 4,
    sanhua: 3 + 1.5 * Math.max(0, Math.max(...Object.values(weaponElements(p))) - 1),
    wuqi: 3 + 1.5 * reacts,
    sadou: 5 + Math.min(3, ec.metal),
    hufeng: 5 + Math.min(3, ec.water),
  };
  void w;
  return offer.reduce((a, b) => (score[b] > score[a] ? b : a));
}
