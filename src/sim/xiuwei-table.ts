// 修为的节点表和纯函数（2026-11-12 从 xiuwei.ts 拆出来，docs/deploy.md「包体积」）：存档那一层（game/profile.ts）在首屏里，
// 它只要节点表、整理节点、花了多少道行这些；放在这个不引用 world / shop / catalog 的小文件里，整套模拟就不跟着进首屏。
// 说明、设计和开局怎么加成见 xiuwei.ts（那边把这里的东西原样再导出，别处照旧从 xiuwei.ts 引）。
import type { Boons } from './types.ts';

/** 五条路线：身（气血、身法、拾取）、器（法宝）、灵（神通、灵宠、五行）、财（灵石、万宝阁）、心（护体、闪避、劫数）；root 是树根「问道」。 */
export type XiuweiPath = 'root' | 'shen' | 'qi' | 'ling' | 'cai' | 'xin';
export const PATHS: readonly Exclude<XiuweiPath, 'root'>[] = ['shen', 'qi', 'ling', 'cai', 'xin'];
export const PATH_NAME: Record<XiuweiPath, string> = { root: '根', shen: '身', qi: '器', ling: '灵', cai: '财', xin: '心' };
/** 路线的一句话（界面里路名旁边、说明栏里用）。 */
export const PATH_DESC: Record<XiuweiPath, string> = {
  root: '修行之始',
  shen: '炼形养身：气血、身法、拾取',
  qi: '祭炼法宝：伤害、攻速、暴击',
  ling: '通灵御兽：神通、灵宠、五行',
  cai: '聚财通宝：灵石、万宝阁',
  xin: '守心历劫：护体、闪避、劫数',
};

/** 境界（下标 = 第几层；0 是树根）。洪荒的仙道阶位（用户 2026-11-12：「不要用炼气、筑基、金丹，用洪荒体系」）。 */
export const REALMS = ['问道', '地仙', '天仙', '金仙', '太乙金仙', '大罗金仙'] as const;
export type Realm = 0 | 1 | 2 | 3 | 4 | 5;
/** 点第 r 层的节点，前一层要已经点亮几节 ★。第一层只要树根。 */
export const REALM_GATE = [0, 0, 2, 2, 3, 3] as const;
/** 各层一节的花费 ★：树根 6，往外 8 / 14 / 22 / 36 / 60。 */
export const REALM_COST = [6, 8, 14, 22, 36, 60] as const;

/** 一个节点的加成（加在开局的人物身上；没写的是 0）。 */
export interface XiuweiGain {
  maxHp?: number; // 气血上限 +（开局气血跟着加）
  speed?: number; // 移速 +（比例，下同）
  pickup?: number; // 拾取范围
  damage?: number; // 伤害
  haste?: number; // 攻速
  area?: number; // 范围
  crit?: number; // 暴击率
  critMul?: number; // 暴击伤害
  luck?: number; // 气运 +
  regen?: number; // 每秒回复 +
  soul?: number; // 吸魂
  armor?: number; // 护体 +
  dodge?: number; // 闪避
  affAll?: number; // 五行亲和皆 +
  affMain?: number; // 本命五行（角色的主五行）亲和 +
  jieDmg?: number; // 劫数每高一劫，伤害 +
  tier?: number; // 起手的专属法宝升几品
  lingshi?: number; // 开局灵石 +
  slots?: number; // 万宝阁多几格货
  // 下面这些进 Player.boon（局里才用得到）
  reroll?: number; // 刷新万宝阁便宜几成
  freeReroll?: number; // 每进万宝阁，头几次刷新不花灵石
  offers?: number; // 升级时多几个属性可选
  petDur?: number; // 灵宠的减益时长 +几成
  petHaste?: number; // 灵宠出手快几成
  skill?: number; // 神通充能 +几成
  fullGuard?: number; // 气血全满时，受到的伤害减几成
  stepDodge?: number; // 走动时闪避 +
  bond?: number; // 专属法宝伤害 +几成
  bossGuard?: number; // 首领（和回响化身）的招式伤害减几成
  lowRegen?: number; // 气血不足三成时每秒回复 +
  interest?: number; // 每波打完多得几枚灵石（随物价涨）
}

export type XiuweiGainKey = keyof XiuweiGain;
/** 进 Player.boon 的几项（applyXiuwei 用）。 */
export const BOON_KEYS = ['reroll', 'freeReroll', 'offers', 'petDur', 'petHaste', 'skill', 'fullGuard', 'stepDodge', 'bond', 'bossGuard', 'lowRegen', 'interest'] as const satisfies readonly (keyof Boons & XiuweiGainKey)[];

export interface XiuweiNode {
  id: string;
  /** 小节点两个字（印上竖写）；心法四个字（印上两行两列）。 */
  name: string;
  path: XiuweiPath;
  realm: Realm;
  /** 同一条路线上前一层的节点（点亮了其中任何一个才能点这一节；前一层是二选一时有两个）。树根是空的。 */
  req: readonly string[];
  /** 二选一的另一边（点了它，这一节就封住）。 */
  rival: string | null;
  /** 心法（机制性的大节点）。 */
  big: boolean;
  cost: number;
  /** 给玩家读的一句（书面、有意象，数字能不写就不写）。 */
  desc: string;
  /** 选中时说明栏下面那一行小字：加多少。 */
  effect: string;
  gain: XiuweiGain;
}

/** 写节点表用：一条路线上一层的一节（或一对二选一）。 */
type Spec = { id: string; name: string; desc: string; effect: string; gain: XiuweiGain };
const L = (id: string, name: string, desc: string, effect: string, gain: XiuweiGain): Spec => ({ id, name, desc, effect, gain });

/**
 * 每条路线从第一层到第五层：一节是一个 Spec，二选一是两个。
 * desc 是给玩家读的那一句：以意象、出处写它是什么（用户 2026-11-12：「要有意思，不要光有数据，不要过于口语化、数值化」）；
 * effect 是选中时说明栏下面那一行小字，写清楚加多少。
 */
const ROUTES: Record<Exclude<XiuweiPath, 'root'>, readonly (Spec | readonly [Spec, Spec])[]> = {
  shen: [
    L('tengyun', '腾云', '足下生云，行走如风', '移速 +4%', { speed: 0.04 }),
    L('lianxing', '炼形', '炼形养气，筋骨渐坚', '气血上限 +10', { maxHp: 10 }),
    L('sheling', '摄灵', '灵觉外放，遗珠自来', '拾取范围 +25%', { pickup: 0.25 }),
    [L('changsheng', '长生', '吐故纳新，伤损自愈', '每秒回复 +0.3', { regen: 0.3 }), L('jiuzhuan', '九转', '九转玄功，体魄雄浑', '气血上限 +16', { maxHp: 16 })],
    [
      L('daoti', '先天道体', '先天之体，周身圆满时外邪难侵', '气血全满时，所受伤害 −30%', { fullGuard: 0.3 }),
      L('suodi', '缩地成寸', '一步千里，身形游移难以捉摸', '行走之时，闪避 +8%', { stepDodge: 0.08 }),
    ],
  ],
  qi: [
    L('jilian', '祭炼', '以心血祭炼法宝，锋芒渐盛', '伤害 +3%', { damage: 0.03 }),
    [L('xunlei', '迅雷', '法宝出手，迅如惊雷', '攻速 +4%', { haste: 0.04 }), L('shanhe', '山河', '法宝之威，覆压山河', '范围 +6%', { area: 0.06 })],
    L('fengmang', '锋芒', '锋芒所指，每每直取要害', '暴击率 +3%', { crit: 0.03 }),
    L('zhanyao', '斩妖', '斩妖除魔，一击透骨', '暴击伤害 +15%', { critMul: 0.15 }),
    [
      L('lingbao', '先天灵宝', '本命法宝生而有灵，起手即为灵品', '起手的专属法宝为灵品', { tier: 1 }),
      L('heyi', '人宝合一', '人与宝心意相通，本命法宝威力大增', '专属法宝伤害 +20%', { bond: 0.2 }),
    ],
  ],
  ling: [
    L('ziqi', '紫气', '紫气东来，神通蓄势更疾', '神通充能 +8%', { skill: 0.08 }),
    L('yushou', '驭兽', '灵宠受教，所施禁制更为绵长', '灵宠的减益时长 +12%', { petDur: 0.12 }),
    [L('wude', '五德', '五德终始，五行皆有所长', '五行亲和皆 +3%', { affAll: 0.03 }), L('benyuan', '本源', '返本归源，独精本命一行', '本命五行亲和 +10%', { affMain: 0.1 })],
    L('wudao', '悟道', '心有所悟，每逢精进多一分抉择', '升级时多一项属性可选', { offers: 1 }),
    L('wanling', '万灵归心', '万灵归附，灵宠出手更勤，禁制更久', '灵宠冷却 −15%，减益时长再 +15%', { petHaste: 0.15, petDur: 0.15 }),
  ],
  cai: [
    L('jinbao', '进宝', '招财进宝，行囊先有余资', '开局灵石 +10', { lingshi: 10 }),
    L('lishi', '利市', '利市仙官相佑，刷新货架所费更省', '刷新万宝阁 −20%', { reroll: 0.2 }),
    L('nazhen', '纳珍', '纳珍天尊垂青，奇珍更易现身', '气运 +8', { luck: 8 }),
    [
      L('wanbao', '万宝', '宝阁之中，为你多陈一格', '万宝阁多一格货', { slots: 1 }),
      L('shengxi', '生息', '积财生息，每战之后另有进项', '每波打完另得灵石 3（随物价涨）', { interest: 3 }),
    ],
    L('xuantan', '玄坛赐福', '玄坛真君赐福，入阁首次刷新分文不取', '每进万宝阁，第一次刷新免费', { freeReroll: 1 }),
  ],
  xin: [
    L('shouyi', '守一', '抱元守一，外邪难入', '护体 +1', { armor: 1 }),
    L('qingjing', '清静', '清静无为，身随意转', '闪避 +2%', { dodge: 0.02 }),
    [L('shehun', '摄魂', '摄敌之魂，以补己身', '吸魂 +3%', { soul: 0.03 }), L('baopu', '抱朴', '见素抱朴，根基愈固', '护体 +1', { armor: 1 })],
    L('lijie', '历劫', '劫数愈重，道心愈坚', '劫数每高一劫，伤害 +2%', { jieDmg: 0.02 }),
    [
      L('sanhua', '三花聚顶', '三花聚顶，危殆之际生机自涌', '气血不足三成时，每秒回复 +1.5', { lowRegen: 1.5 }),
      L('wuqi', '五气朝元', '五气朝元，首领之威亦难撼动', '首领的招式伤害 −20%', { bossGuard: 0.2 }),
    ],
  ],
};

const ROOT: XiuweiNode = {
  id: 'wendao',
  name: '问道',
  path: 'root',
  realm: 0,
  req: [],
  rival: null,
  big: false,
  cost: REALM_COST[0],
  desc: '叩问大道，自此入门',
  effect: '气血上限 +8',
  gain: { maxHp: 8 },
};

function buildNodes(): XiuweiNode[] {
  const out: XiuweiNode[] = [ROOT];
  for (let r = 1 as Realm; r <= 5; r = (r + 1) as Realm) {
    for (const path of PATHS) {
      const prev = r === 1 ? [ROOT.id] : ([] as Spec[]).concat(ROUTES[path][r - 2] as Spec | Spec[]).map((s) => s.id);
      const here = ROUTES[path][r - 1];
      const pair = Array.isArray(here) ? (here as readonly [Spec, Spec]) : null;
      for (const s of pair ?? [here as Spec]) {
        const rival = pair ? (pair[0] === s ? pair[1].id : pair[0].id) : null;
        out.push({ id: s.id, name: s.name, path, realm: r, req: prev, rival, big: r === 5, cost: REALM_COST[r], desc: s.desc, effect: s.effect, gain: s.gain });
      }
    }
  }
  return out;
}

/** 节点表：按境界由内而外（同一层按路线身、器、灵、财、心；二选一的两边挨着）。前置一定排在前面。 */
export const XIUWEI_NODES: readonly XiuweiNode[] = buildNodes();
export type XiuweiId = string;
export const XIUWEI: Readonly<Record<string, XiuweiNode>> = Object.fromEntries(XIUWEI_NODES.map((n) => [n.id, n]));

/** 二选一只算一边（每对取先写的那一边）点满的那一串。 */
export const XIUWEI_FULL: readonly string[] = XIUWEI_NODES.filter((n) => !n.rival || XIUWEI_NODES.findIndex((m) => m.id === n.rival) > XIUWEI_NODES.indexOf(n)).map((n) => n.id);
/** 点满一共要多少道行（二选一只算一边）。 */
export const XIUWEI_TOTAL = XIUWEI_FULL.reduce((s, id) => s + XIUWEI[id].cost, 0);

export const isXiuweiId = (v: unknown): v is XiuweiId => typeof v === 'string' && Object.hasOwn(XIUWEI, v);

/**
 * 老存档（2026-11-11 的十节树：筑基 → 身 / 法 / 财各三节）的 id → 新节点。十节都对得上（同样的加成，数值、位置改了）；
 * 新树里前置不满足的不点亮（litNodes 丢掉），花的道行自然退回。
 */
export const LEGACY: Readonly<Record<string, string>> = {
  zhuji: 'wendao',
  qingshen: 'tengyun',
  lingjue: 'sheling',
  yuling: 'yushou',
  lianqi: 'jilian',
  ningshen: 'ziqi',
  huigen: 'wudao',
  jucai: 'jinbao',
  taojia: 'lishi',
  guanghuo: 'wanbao',
};
export const isLegacyId = (v: unknown): v is string => typeof v === 'string' && Object.hasOwn(LEGACY, v);

/** 前一层（realm − 1）点亮了几节。 */
const litIn = (lit: ReadonlySet<string> | readonly string[], realm: number) => {
  let n = 0;
  for (const id of lit) if (XIUWEI[id]?.realm === realm) n++;
  return n;
};

/**
 * 整理一串节点：老 id 换成新的；只留认识的、不重复的、前置都满足的（同路线前一节、境界门槛、二选一没点另一边），按节点表排好。
 * 存档、联机里别人发来的都先过一遍；顺序不对的照样认，只是排好序再用。二选一两边都在的（坏数据）留排在前面的那一边。
 */
export function litNodes(v: readonly unknown[] | null | undefined): XiuweiId[] {
  if (!v || !v.length) return [];
  const want = new Set<string>();
  for (const x of v) {
    if (isXiuweiId(x)) want.add(x);
    else if (isLegacyId(x)) want.add(LEGACY[x]);
  }
  const out = new Set<string>();
  for (const n of XIUWEI_NODES) if (want.has(n.id) && reachable(out, n)) out.add(n.id);
  return [...out];
}

/** 前置都满足（不看道行、不看自己点没点）。 */
function reachable(lit: ReadonlySet<string>, n: XiuweiNode) {
  if (n.req.length && !n.req.some((r) => lit.has(r))) return false;
  if (litIn(lit, n.realm - 1) < REALM_GATE[n.realm]) return false;
  return !(n.rival && lit.has(n.rival));
}

/** 这些节点一共花了多少道行。 */
export const spentOn = (ids: readonly XiuweiId[]) => ids.reduce((s, id) => s + (XIUWEI[id]?.cost ?? 0), 0);

/**
 * 一个节点现在能不能点：lit 已经点亮；sealed 二选一的另一边点了；locked 同路线前一节还没点；gated 前一层境界点得不够；
 * poor 道行不够；ok 能点。
 */
export type NodeState = 'lit' | 'sealed' | 'locked' | 'gated' | 'poor' | 'ok';
export function nodeState(lit: readonly XiuweiId[], id: XiuweiId, free: number): NodeState {
  const n = XIUWEI[id];
  if (lit.includes(id)) return 'lit';
  if (n.rival && lit.includes(n.rival)) return 'sealed';
  if (n.req.length && !n.req.some((r) => lit.includes(r))) return 'locked';
  if (litIn(lit, n.realm - 1) < REALM_GATE[n.realm]) return 'gated';
  return free < n.cost ? 'poor' : 'ok';
}

/** 境界门槛：点第 realm 层要前一层几节、已经点了几节。 */
export const gateOf = (lit: readonly XiuweiId[], realm: number) => ({ need: REALM_GATE[realm] ?? 0, have: litIn(lit, realm - 1) });

const ZERO: Required<XiuweiGain> = {
  maxHp: 0, speed: 0, pickup: 0, damage: 0, haste: 0, area: 0, crit: 0, critMul: 0, luck: 0, regen: 0, soul: 0, armor: 0, dodge: 0,
  affAll: 0, affMain: 0, jieDmg: 0, tier: 0, lingshi: 0, slots: 0,
  reroll: 0, freeReroll: 0, offers: 0, petDur: 0, petHaste: 0, skill: 0, fullGuard: 0, stepDodge: 0, bond: 0, bossGuard: 0, lowRegen: 0, interest: 0,
}; // prettier-ignore

/** 一串节点的加成合计。 */
export function gainOf(ids: readonly XiuweiId[]): Required<XiuweiGain> {
  const g = { ...ZERO };
  for (const id of ids) for (const [k, v] of Object.entries(XIUWEI[id]?.gain ?? {}) as [XiuweiGainKey, number][]) g[k] += v;
  return g;
}

/** 调试开局、数值模拟用的几套：all = 点满（二选一取先写的一边）；half = 按节点表由内而外点到总花费的一半。 */
export function xiuweiPreset(kind: string | null | undefined): XiuweiId[] {
  if (kind === 'all') return [...XIUWEI_FULL];
  if (kind !== 'half') return [];
  const out: XiuweiId[] = [];
  let spent = 0;
  for (const id of XIUWEI_FULL) {
    if (spent >= XIUWEI_TOTAL / 2) break;
    out.push(id);
    spent += XIUWEI[id].cost;
  }
  return out;
}
