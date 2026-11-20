// 波间界面（万宝阁）的内容：从模拟状态生成各块的 HTML 字符串。纯函数，只读状态；界面怎么排、怎么动在 intermission.ts。
import {
  CHARMS,
  ELEMENT_BONUS,
  ELIXIRS,
  HEROES,
  MAX_TIER_BY_BUY,
  MAX_WEAPONS,
  PET_BRANCH,
  REACTIONS,
  RELICS,
  STAT_UPGRADES,
  TIER_NAME,
  WEAPONS,
  WUXING_SET_DESC,
  WX,
  xpToNext,
  type WeaponDef,
} from '../sim/catalog.ts';
import { elementCounts } from '../sim/core.ts';
import { distinctOf, petElOf, wxSetOf } from '../sim/wuxing.ts';
import { PET_LEVELS, sell, spiritPair } from '../sim/shop.ts';
import { ELEMENT_NAME } from '../sim/types.ts';
import type { Element, PetBranch, Player, ReactionKind, ShopOffer, StatId, StatOffer } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { BRANCH_ICONS, CHARM_ICONS, ELIXIR_ICONS, EXTRA_ICONS, PET_BASE_ICONS, RELIC_ICONS, WEAPON_ICONS, fragmentIcon, spiritIcon } from '../art/sprites/icons.ts';
import { PET_KINDS, petKindOf } from '../sim/pet.ts';
import { gridUrl } from './pixel-url.ts';
import type { Grid } from '../art/pixel.ts';
import { TECHNIQUES, TECH_LEVELS } from '../sim/techniques.ts';
import { TECH_ICONS } from '../art/sprites/icons.ts';
import type { TechniqueId } from '../sim/types.ts';

/** 五行相生的传统顺序：木生火、火生土、土生金、金生水、水生木。 */
export const CYCLE: Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];
/** 相邻两行之间是哪种相生（CYCLE[i] → CYCLE[i+1]）。 */
export const CYCLE_REACTION: ReactionKind[] = CYCLE.map((from, i) => {
  const to = CYCLE[(i + 1) % CYCLE.length];
  return (Object.keys(REACTIONS) as ReactionKind[]).find((k) => REACTIONS[k].from === from && REACTIONS[k].to === to)!;
});

const img = (g: Grid, cls: string) => `<img class="${cls}" src="${gridUrl(g)}" alt="" draggable="false">`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const elSeal = (e: Element, cls = '') => `<i class="seal el-${e} ${cls}">${ELEMENT_NAME[e]}</i>`;
const tierSeal = (t: number, cls = '') => `<i class="seal tier t${t} ${cls}">${TIER_NAME[t]}</i>`;
const tierWord = (t: number) => `<span class="tc${t}">${TIER_NAME[t]}</span>`;
export const gem = () => `<i class="gem"></i>`;
/** 按键提示的一个键帽（只在有键盘的设备上显示，见样式里的 .keys）。 */
export const keycap = (k: string) => `<i class="k">${k}</i>`;
/** 五行加成的短名：三件、四件档只取冒号前的名字（斩杀、燎原……）。n 按四件封顶。 */
const bonusShort = (e: Element, n: number) => ELEMENT_BONUS[e][Math.min(4, n) - 1].split('：')[0];
/** 一行带了 n 件时已有的加成（一到 n 件档，四件封顶）。 */
const bonusList = (e: Element, n: number) => ELEMENT_BONUS[e].slice(0, Math.min(4, n));

// ---------------------------------------------------------------- 五行与相生

/** 每一行能不能「打出印记」：带着这一行的法宝，或者宠物是这一行（宠物算一件，elementCounts 里已经有它）。 */
function markable(_p: Player, ec: Record<Element, number>, e: Element) {
  return ec[e] > 0;
}
/** 相生的状态：on 已成（两行都有；五行俱全时全都成），near 差一行，off 都没有。 */
export function reactionState(p: Player, ec: Record<Element, number>, k: ReactionKind): 'on' | 'near' | 'off' {
  const r = REACTIONS[k];
  const a = markable(p, ec, r.from);
  const b = ec[r.to] > 0;
  return a && b ? 'on' : a || b ? 'near' : 'off';
}
/** 相生缺的那一行。 */
function missing(p: Player, ec: Record<Element, number>, k: ReactionKind): Element {
  const r = REACTIONS[k];
  return markable(p, ec, r.from) ? r.to : r.from;
}
/** 异行档（三才 / 四象 / 五行俱全）一行：已到的档名和效果，下一档还差几行。 */
function setHtml(ec: Record<Element, number>) {
  const n = distinctOf(ec);
  const set = wxSetOf(ec);
  const next = WX.set.find((x) => x.n > n);
  const cur = set ? `<span class="${set.n === 5 ? 'qj' : 'xg'}" data-tip="${set.name}：${WUXING_SET_DESC[set.n as 3 | 4 | 5]}">${set.name}</span>` : `<span class="dim">${n} 行</span>`;
  const more = next ? `<span class="dim" data-tip="${next.name}：${WUXING_SET_DESC[next.n as 3 | 4 | 5]}">再 ${next.n - n} 行：${next.name}</span>` : '';
  return `<span class="wl"><span class="lb">异行</span>${cur}${more}</span>`;
}

// ---------------------------------------------------------------- 货架

/** 一张卡：龛、签、按钮三块的内容，外加「详情」（提示框里的全文：卡片上放不下被截短时，点一下 / 悬停能看到）。 */
export interface CardView {
  key: string; // 这张卡的身份（换了就重新入场）
  tier: number; // 框色：0 = 不分品阶（灵物、丹药、符箓、功法、进化）
  niche: string;
  info: string;
  act: string;
  detail: string;
  /** 详情里有卡片上没写的东西（法宝的各品阶、器灵的另一个选择）：鼠标停在说明上就弹出来。 */
  rich?: boolean;
}
export interface OfferView extends CardView {
  cls: string; // 卡片上的状态类
  canBuy: boolean;
}

/** 这件货现在买不了的原因（灵石不够除外）；和 sim/shop.ts 的 buy() 规则一致。按钮上写得下，三个字以内。 */
function blockReason(p: Player, o: ShopOffer): string | null {
  if (o.cat === 'weapon') {
    const have = p.weapons.find((x) => x.kind === o.kind);
    if (o.form === 'full') {
      if (have ? have.tier >= MAX_TIER_BY_BUY : p.weapons.length >= MAX_WEAPONS) return have ? '需器灵' : '位已满';
    } else if (!have) return '未持有';
    else if (have.tier >= MAX_TIER_BY_BUY) return '需器灵';
  } else if (o.cat === 'spirit') {
    const have = p.weapons.find((x) => x.kind === o.kind);
    if (!have) return '未持有';
    if (have.tier > MAX_TIER_BY_BUY) return '已觉醒'; // 二选一：另一个器灵已经觉醒了
    if (have.tier < MAX_TIER_BY_BUY) return '需仙品';
  } else if (o.cat === 'charm' && p.charms.includes(o.id)) return '已拥有';
  return null;
}

/** 现在能不能买下这件（钱够、也没有别的原因挡着）。 */
export const canBuy = (p: Player, o: ShopOffer) => !blockReason(p, o) && p.lingshi >= o.price;

export function offerKey(o: ShopOffer | null) {
  return o ? JSON.stringify(o) : '';
}

export function offerIcon(o: ShopOffer): Grid {
  switch (o.cat) {
    case 'weapon':
      return o.form === 'fragment' ? fragmentIcon(o.kind) : WEAPON_ICONS[o.kind];
    case 'spirit':
      return spiritIcon(o.kind);
    case 'relic':
      return RELIC_ICONS[o.id];
    case 'elixir':
      return ELIXIR_ICONS[o.id];
    case 'charm':
      return CHARM_ICONS[o.id];
  }
}

/** 一件新法宝带来的变化：五行件数跨过门槛解锁的加成、新成的相生。short 是卡片上的一行，long 是详情里的全文。 */
function weaponGain(p: Player, el: Element): { short: string; long: string }[] {
  const ec = elementCounts(p);
  const out: { short: string; long: string }[] = [];
  const n = ec[el] + 1;
  if (n <= 4) out.push({ short: `${elSeal(el, 'in')}<span class="nw">${n}件</span> <span class="nw">${bonusShort(el, n)}</span>`, long: `${elSeal(el, 'in')}${ELEMENT_NAME[el]}行凑足 ${n} 件（含宠物）：${ELEMENT_BONUS[el][n - 1]}` });
  const after = { ...ec, [el]: n };
  const s0 = wxSetOf(ec);
  const s1 = wxSetOf(after);
  if (s1 && s1.n !== s0?.n) out.push({ short: `<span class="${s1.n === 5 ? 'qj' : 'xg'}">凑成${s1.name}</span>`, long: `<span class="${s1.n === 5 ? 'qj' : 'xg'}">凑成「${s1.name}」</span><span class="dim">：${WUXING_SET_DESC[s1.n as 3 | 4 | 5]}</span>` });
  const fresh = (Object.keys(REACTIONS) as ReactionKind[]).filter((k) => reactionState(p, ec, k) !== 'on' && reactionState(p, after, k) === 'on');
  if (fresh.length) out.push({ short: `<span class="xg">新相生 ${fresh.map((k) => REACTIONS[k].name).join(' ')}</span>`, long: fresh.map((k) => `<span class="xg">新相生「${REACTIONS[k].name}」</span><span class="dim">：${REACTIONS[k].desc}</span>`).join('<br>') });
  return out;
}

/** 龛里的灵光：品阶越高越多（灵 1、仙 2、神 3 点），慢慢明灭，不画光圈。 */
const glints = (tier: number) => (tier >= 2 ? `<i class="glints">${'<i></i>'.repeat(tier - 1)}</i>` : '');

const fragPips = (n: number, add: boolean) =>
  `<i class="pips">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : add && i === n ? 'add' : ''}"></i>`).join('')}</i>`;

/** 卡片上「签」那一块：名字、类别、说明各占固定的位置（各卡对齐），提示行沉到底部。 */
function infoHtml(name: string, sub: string, desc: string, notes: string[], must = '') {
  const nts = `${must ? `<span class="nt must">${must}</span>` : ''}${notes.map((n) => `<span class="nt">${n}</span>`).join('')}`;
  return `<b class="nm">${name}</b>${sub}<span class="ds">${desc}</span>${nts ? `<div class="nts">${nts}</div>` : ''}`;
}

/** 详情（提示框）：名字、类别、说明全文，后面跟品阶梯度 / 提示。 */
function detailHtml(name: string, seal: string, sub: string, desc: string, extra = '', notes: string[] = []) {
  return `<b class="pn">${name}${seal}</b>${sub ? `<span class="ps">${sub}</span>` : ''}<span class="pt">${desc}</span>${extra}${notes.length ? `<div class="pnts">${notes.map((n) => `<span class="nt">${n}</span>`).join('')}</div>` : ''}`;
}

/**
 * 一件法宝升阶之后的变化（用户：每次升阶都要看得出变化）：灵 / 仙各一行，神品写器灵（二选一，或者已经觉醒的那一个）。
 * 凡品就是上面那句说明，不重复写。got 以内的品阶是已经有的（亮）；target 是这次买下之后到的那一阶（高亮）；其余是以后的（暗）。
 */
function ladderHtml(def: WeaponDef, got: number, target = 0, spirit?: string | null) {
  const cls = (t: number) => (t === target ? ' cur' : t <= got ? ' got' : '');
  const rows = [2, 3].map((t) => `${tierSeal(t, cls(t))}<span class="lt${cls(t)}">${def.tiers[t]}</span>`);
  const sp = spirit ? def.spirits.find((s) => s.id === spirit) : null;
  const god = sp ? `器灵 <b>${sp.name}</b>：${sp.desc}` : `器灵二选一${def.spirits.map((s) => `<span class="sp"><b>${s.name}</b>：${s.desc}</span>`).join('')}`;
  rows.push(`${tierSeal(4, cls(4))}<span class="lt${cls(4)}">${god}</span>`);
  return `<div class="lad">${rows.join('')}</div>`;
}

export function offerView(p: Player, o: ShopOffer, i: number): OfferView {
  const block = blockReason(p, o);
  const poor = p.lingshi < o.price;
  const canBuy = !block && !poor;
  let tier = 0;
  let name = '';
  let sub = '';
  let desc = '';
  const notes: string[] = []; // 卡片上的提示行（放不下时先收起，详情里都有）
  let must = ''; // 一定要看得到的一行（碎片的 n/3 进度）
  let seal = '';
  let detail = '';
  let duo = false; // 器灵二选一：同一件法宝的另一个器灵也在货架上
  let duoNext = false; // 另一个器灵就在右边那一格（两张卡之间夹一枚「或」）
  switch (o.cat) {
    case 'weapon': {
      const def = WEAPONS[o.kind];
      const have = p.weapons.find((x) => x.kind === o.kind);
      name = def.name;
      desc = def.desc;
      seal = elSeal(def.el);
      if (o.form === 'fragment') {
        // 碎片按手里那件现在的品阶算（锁住的碎片在法宝升阶之后，写的也是新的下一阶）
        const at = have ? have.tier : o.tier;
        const n = p.frags[o.kind] ?? 0;
        const next = at + 1;
        tier = at;
        sub = `${tierWord(at)}品 碎片`;
        // 用户：每次升阶都要看得出变化 —— 直接写出下一阶会变成什么样（catalog 的 tiers）
        desc = `三枚升一阶。${TIER_NAME[next] ?? '神'}品：${def.tiers?.[next] ?? def.desc}`;
        must = `${fragPips(n, true)}${n + 1 >= 3 ? `凑齐→${tierWord(Math.min(4, next))}` : `已有 ${n}/3`}`;
        detail = detailHtml(def.name, seal, `${TIER_NAME[at]}品碎片 · 三枚升一阶`, def.desc, ladderHtml(def, at, n + 1 >= 3 ? next : 0), [`${fragPips(n, true)}${n + 1 >= 3 ? `买下这一枚就凑齐，升到${TIER_NAME[Math.min(4, next)]}品` : `已有 ${n}/3，买下是第 ${n + 1} 枚`}`]);
      } else if (have) {
        // 同名件：给手里那件升一阶。按手里那件现在的品阶显示（锁住的同名件在法宝升阶之后也跟着变）
        const next = Math.min(4, have.tier + 1);
        tier = next;
        sub = `升阶 ${tierWord(have.tier)}→${tierWord(next)}`;
        desc = `${TIER_NAME[next]}品：${def.tiers?.[next] ?? def.desc}`;
        if (next === 3) notes.push('<span class="xg">仙品起有质变</span>');
        detail = detailHtml(def.name, seal, `同名件 · 升阶 ${TIER_NAME[have.tier]}→${TIER_NAME[next]}`, def.desc, ladderHtml(def, have.tier, next));
      } else {
        tier = o.tier;
        sub = `${tierWord(o.tier)}品 法宝`;
        const gain = weaponGain(p, def.el);
        notes.push(...gain.map((g) => g.short));
        detail = detailHtml(def.name, seal, `${TIER_NAME[o.tier]}品法宝 · ${ELEMENT_NAME[def.el]}行`, def.desc, ladderHtml(def, o.tier), gain.map((g) => g.long));
      }
      break;
    }
    case 'spirit': {
      const def = WEAPONS[o.kind];
      const sp = def.spirits.find((s) => s.id === o.spirit)!;
      const other = def.spirits.find((s) => s.id !== o.spirit);
      // 二选一：模拟层进货时把同一件法宝的两个器灵并排上架（sim/shop.ts 的 restock），买下一个另一个随之下架
      const mate = spiritPair(p, i);
      duo = mate >= 0;
      duoNext = mate === i + 1;
      tier = 4;
      name = sp.name;
      sub = `${def.name} · 器灵`;
      desc = sp.desc;
      seal = elSeal(def.el);
      if (duo && other) must = `<span class="xg"><span class="nw">与「${other.name}」</span><span class="nw">二选一</span></span>`;
      notes.push(`觉醒 ${tierWord(3)}→${tierWord(4)}`);
      detail = detailHtml(
        sp.name,
        seal,
        `${def.name}的器灵 · 觉醒后升到神品`,
        sp.desc,
        '',
        other ? [`<span class="xg">二选一</span>：每件法宝只可觉醒一个器灵，择此则不可再择「${other.name}」`, `<span class="dim">另一个 · ${other.name}：${other.desc}</span>`] : [],
      );
      break;
    }
    case 'relic': {
      const d = RELICS[o.id];
      const n = p.relics[o.id] ?? 0;
      name = d.name;
      sub = d.demon ? '<span class="demon">魔物 有代价</span>' : '灵物 可叠加';
      desc = d.desc;
      if (o.id.startsWith('orb_')) seal = elSeal(o.id.slice(4) as Element); // 五行精：对应那一行
      if (n) notes.push(`<span class="dim">已有 ${n} 件</span>`);
      // 有自己机制的灵物：详情里写多带一件怎么变（stack）
      const more = [...(n ? [`已有 ${n} 件`] : []), ...(d.stack ? [`<span class="dim">叠加：${d.stack}</span>`] : [])];
      detail = detailHtml(d.name, seal, d.demon ? '魔物 · 有代价，可叠加' : '灵物 · 可叠加', d.desc, '', more);
      break;
    }
    case 'elixir': {
      const d = ELIXIRS[o.id];
      name = d.name;
      sub = d.now ? '丹药 立刻' : '丹药 下一波';
      desc = d.desc;
      detail = detailHtml(d.name, '', d.now ? '丹药 · 购下即刻生效' : '丹药 · 仅限下一波', d.desc);
      break;
    }
    case 'charm': {
      const d = CHARMS[o.id];
      name = d.name;
      sub = '符箓 每波';
      desc = d.desc;
      detail = detailHtml(d.name, '', '符箓 · 常驻，每波生效', d.desc);
      break;
    }
  }
  const niche = `${seal}${tier ? tierSeal(tier) : ''}${glints(tier)}${img(offerIcon(o), 'ico')}<i class="stand"></i><i class="stamp">锁</i><i class="kc">${i + 1}</i>`;
  const info = infoHtml(name, `<span class="sub">${sub}</span>`, desc, notes, must);
  // 按钮：买得了写「购买 + 价钱」；被别的原因挡着时只写原因（价钱没意义）
  const label = block ? `<span class="bl why">${block}</span>` : `<span class="bl"><span class="b1">购</span>买</span><span class="pv">${gem()}<span class="pr">${o.price}</span></span>`;
  const act =
    `<button class="buy" data-act="buy" data-i="${i}" aria-disabled="${!canBuy}" aria-label="${block ?? '购买'} ${name} ${o.price} 灵石">${label}</button>` +
    `<button class="lock" data-act="lock" data-i="${i}" aria-pressed="${p.locked[i]}" aria-label="${p.locked[i] ? '解除锁定' : '锁定这一格'}"><span>锁</span></button>`;
  const cls = [p.locked[i] ? 'locked' : '', poor && !block ? 'poor' : '', block ? 'blocked' : '', duo ? 'duo' : '', duoNext ? 'duo-l' : '', `k-${o.cat}`].filter(Boolean).join(' ');
  // 详情里有卡片上没写的东西：法宝的各品阶、器灵的另一个选择、有机制的灵物多带一件怎么变
  const rich = o.cat === 'weapon' || o.cat === 'spirit' || (o.cat === 'relic' && !!RELICS[o.id].stack);
  return { key: offerKey(o), cls, tier, niche, info, act, detail, rich, canBuy };
}

/** 空了的格子：留着空几座，写「已售」（器灵二选一里没选的那个写「未选」）。 */
export function soldView(last: Grid | null, word = '已售'): Pick<CardView, 'niche' | 'info' | 'act' | 'detail'> {
  return {
    niche: `${last ? img(last, 'ico gone') : ''}<i class="stand"></i>`,
    info: `<span class="soldw">${word}</span>`,
    act: '',
    detail: '',
  };
}

// ---------------------------------------------------------------- 升级、进化

/** 每个属性的图标：有对应灵物的就用灵物的图（看着就知道是一回事）。 */
const STAT_ICON: Record<Exclude<StatId, 'aff'>, Grid> = {
  maxHp: RELIC_ICONS.peach,
  regen: RELIC_ICONS.lingzhi,
  soul: RELIC_ICONS.soulbell,
  damage: RELIC_ICONS.jindan,
  haste: RELIC_ICONS.thunderwood,
  crit: RELIC_ICONS.pearl,
  area: EXTRA_ICONS.area,
  speed: RELIC_ICONS.feather,
  pickup: RELIC_ICONS.gourd,
  armor: RELIC_ICONS.turtle,
  dodge: EXTRA_ICONS.dodge,
  luck: RELIC_ICONS.cornucopia,
};
const ESSENCE_ICON: Record<Element, Grid> = {
  metal: RELIC_ICONS.orb_metal,
  wood: RELIC_ICONS.orb_wood,
  water: RELIC_ICONS.orb_water,
  fire: RELIC_ICONS.orb_fire,
  earth: RELIC_ICONS.orb_earth,
};
/** 属性的一句话说明（界面文案）。 */
const STAT_DESC: Record<StatId, string> = {
  maxHp: '提高气血上限，并即刻回复等量',
  regen: '每秒回复气血',
  soul: '击杀时有几率回复气血',
  damage: '法宝伤害提高',
  haste: '法宝出手更快',
  crit: '暴击几率提高',
  area: '法宝与宠物范围扩大',
  speed: '身法更快',
  pickup: '拾取灵石范围扩大',
  armor: '减免所受伤害',
  dodge: '有几率闪避伤害',
  luck: '万宝阁更易出高品阶',
  aff: '此行法宝伤害提高',
};
/** 属性的当前值（升级卡上写「现在多少」）。 */
function statNow(p: Player, o: StatOffer): string {
  const s = p.stats;
  switch (o.stat) {
    case 'maxHp':
      return String(s.maxHp);
    case 'regen':
      return s.regen.toFixed(1);
    case 'armor':
      return String(s.armor);
    case 'luck':
      return String(s.luck);
    case 'aff':
      return pct(s.aff[o.el!]);
    default:
      return pct(s[o.stat]);
  }
}

export function statView(p: Player, o: StatOffer, i: number): CardView {
  const d = STAT_UPGRADES[o.stat];
  const v = d.values[o.tier - 1];
  const name = o.stat === 'aff' ? `${ELEMENT_NAME[o.el!]}行亲和` : d.name;
  const icon = o.stat === 'aff' ? ESSENCE_ICON[o.el!] : STAT_ICON[o.stat];
  const seal = o.stat === 'aff' ? elSeal(o.el!) : '';
  const desc = o.stat === 'aff' ? `${ELEMENT_NAME[o.el!]}行法宝伤害提高` : o.stat === 'area' ? `法宝与${HEROES[p.hero].pet}范围扩大` : STAT_DESC[o.stat];
  const now = `<span class="dim">现在 ${statNow(p, o)}</span>`;
  return {
    key: `${o.stat}${o.el ?? ''}${o.tier}`,
    tier: o.tier,
    niche: `${seal}${tierSeal(o.tier)}${glints(o.tier)}${img(icon, 'ico')}<i class="stand"></i><i class="kc">${i + 1}</i>`,
    info: infoHtml(name, `<span class="big tc${o.tier}">${d.fmt(v)}</span>`, desc, [now]),
    act: `<button class="pick" data-act="pick" data-i="${i}" aria-label="选 ${name} ${d.fmt(v)}"><span>选这项</span></button>`,
    detail: detailHtml(name, seal, `${TIER_NAME[o.tier]}品 · ${d.fmt(v)}`, desc, '', [`现在 ${statNow(p, o)}`]),
  };
}

export function petView(p: Player, b: PetBranch, i: number): CardView {
  const next = p.pet.stage + 1;
  const h = HEROES[p.hero];
  const sub = `${h.pet} ${['', '一', '二', '三'][next]}阶`;
  return {
    key: `${b}${next}`,
    tier: 0,
    niche: `${elSeal(h.petEl)}${img(BRANCH_ICONS[b], 'ico')}<i class="stand"></i><i class="kc">${i + 1}</i>`,
    info: infoHtml(PET_BRANCH[b].name, `<span class="sub">${sub}</span>`, PET_BRANCH[b].desc, []),
    act: `<button class="pick" data-act="evolve" data-b="${b}" aria-label="${PET_BRANCH[b].name}"><span>${p.pet.branch ? '进化' : '走这条路'}</span></button>`,
    detail: detailHtml(PET_BRANCH[b].name, elSeal(h.petEl), sub, PET_BRANCH[b].desc, '', [`<span class="dim">${h.pet}：${h.petDesc}</span>`]),
  };
}

// ---------------------------------------------------------------- 左侧：角色

export function heroHtml(p: Player) {
  const h = HEROES[p.hero];
  const xp = Math.max(0, Math.min(1, p.xp / xpToNext(p.level)));
  return `<i class="pt ${p.hero}"></i><div class="who"><b>${h.name}</b><span class="dim">主五行</span>${elSeal(h.el)}</div><div class="lv"><span>第 ${p.level} 级</span><i class="xp"><i style="width:${Math.round(xp * 100)}%"></i></i></div>`;
}

/** 卖掉第 i 件能拿回多少：直接问 sim/shop.ts 的 sell()，在玩家的一份深拷贝上算，不碰真状态（规则只写一遍）。 */
function sellValue(w: World, p: Player, i: number) {
  const copy = structuredClone(p);
  const before = copy.lingshi;
  return sell(w, copy, i) ? copy.lingshi - before : 0;
}

/**
 * 法宝位：四格。每一格是一个按钮，点一下（或回车）打开这件法宝的详情——只看，不会卖；
 * 「卖出」是详情里单独的一个按钮（slotDetailHtml）。open 是详情正开着的那一格。
 */
export function slotsHtml(p: Player, open: number) {
  return Array.from({ length: MAX_WEAPONS }, (_, i) => {
    const wpn = p.weapons[i];
    if (!wpn) return `<div class="tile empty"><i class="hole"></i><span class="nm">空位</span></div>`;
    const def = WEAPONS[wpn.kind];
    const frags = p.frags[wpn.kind] ?? 0;
    return (
      `<button class="tile${def.exclusive ? ' ex' : ''}${open === i ? ' open' : ''}" data-act="slot" data-i="${i}" aria-label="${def.name}，${TIER_NAME[wpn.tier]}品，看详情">` +
      `${img(WEAPON_ICONS[wpn.kind], 'i16')}<span class="mid">${frags ? fragPips(frags, false) : ''}</span>${tierSeal(wpn.tier)}<span class="nm">${def.name}</span></button>`
    );
  }).join('');
}

/**
 * 已有法宝的详情：说明、升阶之后的变化（已有的品阶亮着；神品写器灵二选一，或已觉醒的那个）、碎片进度，最后是「卖出」（专属法宝不能卖）。
 * pinned = 点开的（能点里面的按钮）：卖出要点两次，第一次变成「再点一次，确认卖出」（armed），3 秒内再点才卖。
 * 鼠标悬停出来的（没钉住，点不到里面）只写一句怎么卖。
 */
export function slotDetailHtml(w: World, p: Player, i: number, pinned: boolean, armed: boolean) {
  const wpn = p.weapons[i];
  if (!wpn) return '';
  const def = WEAPONS[wpn.kind];
  const frags = p.frags[wpn.kind] ?? 0;
  const notes: string[] = [];
  if (frags) notes.push(`${fragPips(frags, false)}碎片 ${frags}/3，凑满三枚升一阶`);
  const price = `${gem()}<span class="pr">${sellValue(w, p, i)}</span>`;
  const sellBtn = def.exclusive
    ? `<span class="keep">专属法宝，不能卖</span>`
    : pinned
      ? `<button class="sell${armed ? ' armed' : ''}" data-act="sell" data-i="${i}"><span class="bl">${armed ? '再点一次，确认卖出' : '卖出'}</span>${price}</button>`
      : `<span class="keep">点开此格可卖出，得回 ${price}</span>`;
  return detailHtml(def.name, `${elSeal(def.el)}${tierSeal(wpn.tier)}`, '', def.desc, ladderHtml(def, wpn.tier, 0, wpn.spirit), notes) + sellBtn;
}

/** 「还差哪一行」：按缺的那一行归在一起（带上一件木行法宝，引燃、导雷都成）。 */
function nearGroups(p: Player, ec: Record<Element, number>, near: ReactionKind[]) {
  const by = new Map<Element, ReactionKind[]>();
  for (const k of near) by.set(missing(p, ec, k), [...(by.get(missing(p, ec, k)) ?? []), k]);
  return [...by]
    .map(([e, ks]) => `<span class="rx" data-tip="再带一件${ELEMENT_NAME[e]}行法宝，可触发：${ks.map((k) => `${REACTIONS[k].name}（${REACTIONS[k].desc}）`).join('；')}">${elSeal(e)}${ks.map((k) => `<span>${REACTIONS[k].name}</span>`).join('')}</span>`)
    .join('');
}

/** 五行与相生：相生链 + 加成（最多 maxBonus 行，件数多的在前；放不下的看链上印章的提示）+ 相生两行（放不下就按组换行）。 */
/** 五行一栏：相生链、加成（最多 maxBonus 行）、相生 / 差几件。maxBonus 为负时「差」那一行也不写（名册放不下时，fitRoster）。 */
export function wuxingHtml(p: Player, maxBonus = 5) {
  const ec = elementCounts(p);
  const pe = p.pet ? petElOf(p) : null;
  const all = distinctOf(ec) === 5;
  const seals = CYCLE.map((e, i) => {
    const r = CYCLE_REACTION[i];
    const st = reactionState(p, ec, r);
    // 件数的小格：最多四格（四件档）；宠物那一格单独标出来（排在最后、窄一点）
    const pips = [0, 1, 2, 3].map((k) => `<i class="${k < ec[e] ? (pe === e && k === ec[e] - 1 ? 'on pet' : 'on') : ''}"></i>`).join('');
    const petNote = pe === e ? `（含宠物 ${HEROES[p.hero].pet}）` : '';
    const tip = `${ELEMENT_NAME[e]}行 ${ec[e]} 件${petNote}：${ec[e] ? bonusList(e, ec[e]).join('；') : `带上 1 件得「${ELEMENT_BONUS[e][0]}」`}`;
    const link = `<i class="lk ${st}" data-tip="${REACTIONS[r].name} · ${REACTIONS[r].desc}"></i>`;
    return `<span class="nd ${ec[e] ? 'has' : ''}" data-tip="${tip}">${elSeal(e, ec[e] ? '' : 'off')}<i class="pp el-${e}">${pips}</i></span>${i < CYCLE.length - 1 ? link : `<i class="ret ${st}" data-tip="${REACTIONS[r].name} · ${REACTIONS[r].desc}"></i>`}`;
  }).join('');
  const bonus = CYCLE.filter((e) => ec[e] > 0)
    .sort((a, b) => ec[b] - ec[a])
    .slice(0, Math.max(0, maxBonus))
    .map((e) => {
      const n = Math.min(4, ec[e]);
      const tip = `${ELEMENT_NAME[e]}行 ${ec[e]} 件${pe === e ? `（含宠物 ${HEROES[p.hero].pet}）` : ''}：${bonusList(e, n).join('；')}${n < 4 ? `。再 1 件：${ELEMENT_BONUS[e][n]}` : ''}`;
      return `<span class="wl" data-tip="${tip}">${elSeal(e)}<span>${bonusShort(e, n)}</span></span>`;
    })
    .join('');
  const ks = CYCLE_REACTION;
  const on = ks.filter((k) => reactionState(p, ec, k) === 'on');
  const near = ks.filter((k) => reactionState(p, ec, k) === 'near');
  const react =
    (all
      ? `<span class="wl"><span class="lb">相生</span><span class="qj" data-tip="${WUXING_SET_DESC[5]}">不挑顺序</span></span>`
      : `<span class="wl"><span class="lb">相生</span>${on.length ? on.map((k) => `<span class="xg" data-tip="${REACTIONS[k].name} · ${REACTIONS[k].desc}">${REACTIONS[k].name}</span>`).join('') : '<span class="dim">尚无</span>'}</span>`) +
    (near.length && maxBonus >= 0 ? `<span class="wl"><span class="lb">差</span>${nearGroups(p, ec, near)}</span>` : '');
  return `<div class="chain${all ? ' all' : ''}">${seals}</div><div class="wls">${bonus}${setHtml(ec)}${react}</div>`;
}

export function statsHtml(p: Player) {
  const s = p.stats;
  const cell = (k: string, v: string) => `<span class="sc"><span>${k}</span><em>${v}</em></span>`;
  const aff = (Object.keys(s.aff) as Element[]).filter((e) => s.aff[e] > 0.001);
  return (
    `<span class="sc wide"><span>气血</span><em>${Math.ceil(p.hp)}/${s.maxHp}</em></span>` +
    cell('伤害', pct(s.damage)) +
    cell('攻速', pct(s.haste)) +
    cell('暴击', pct(s.crit)) +
    cell('范围', pct(s.area)) +
    cell('回复', s.regen.toFixed(1)) +
    cell('吸魂', pct(s.soul)) +
    cell('护体', String(s.armor)) +
    cell('闪避', pct(s.dodge)) +
    cell('移速', pct(s.speed)) +
    cell('拾取', pct(s.pickup)) +
    cell('气运', String(s.luck)) +
    // 亲和：五行各一组，放不下就按组换行（三四行都有亲和时一行写不下）
    (aff.length ? `<span class="sc wide aff"><span>亲和</span><em>${aff.map((e) => `<span>${ELEMENT_NAME[e]} ${pct(s.aff[e])}</span>`).join('')}</em></span>` : '')
  );
}

export function petHtml(p: Player) {
  const h = HEROES[p.hero];
  const pet = p.pet;
  const nextLv = PET_LEVELS[pet.stage];
  const kind = petKindOf(p);
  const icon = pet.branch ? BRANCH_ICONS[pet.branch] : PET_BASE_ICONS[kind];
  const [b1, b2] = PET_KINDS[kind].branches;
  const stage = pet.stage ? `${pet.branch ? PET_BRANCH[pet.branch].name : ''}${['', '一', '二', '三'][pet.stage]}阶` : '未进化';
  return (
    `<div class="ph">${img(icon, 'i16')}<b>${h.pet}</b>${elSeal(h.petEl, 'in')}<span class="dim">${stage}</span></div>` +
    `<span class="pd">${h.petDesc}</span>` +
    (pet.branch ? `<span class="pd br">${PET_BRANCH[pet.branch].name}：${PET_BRANCH[pet.branch].desc}</span>` : '') +
    (nextLv ? `<span class="pd dim">第 ${nextLv} 级进化${pet.branch ? '' : ` · ${PET_BRANCH[b1].name}或${PET_BRANCH[b2].name}二选一`}</span>` : '')
  );
}

/** 行囊：灵物、符箓各一行图标（悬停 / 点一下看说明）。放不下时界面那边把多出来的收进一枚「+N」（data-nm 是它提示里的名字）。 */
export function bagHtml(p: Player) {
  const relics = (Object.entries(p.relics) as [keyof typeof RELICS, number][]).filter(([, n]) => n > 0);
  const it = (name: string, desc: string, icon: Grid, n = 1) =>
    `<span class="it" data-nm="${name}${n > 1 ? ` ×${n}` : ''}" data-tip="${name}${n > 1 ? ` ×${n}` : ''}：${desc}">${img(icon, 'i16')}${n > 1 ? `<em>${n}</em>` : ''}</span>`;
  const r = relics.length ? relics.map(([id, n]) => it(RELICS[id].name, RELICS[id].desc, RELIC_ICONS[id], n)).join('') : '<span class="dim">尚无</span>';
  const c = p.charms.length ? p.charms.map((id) => it(CHARMS[id].name, CHARMS[id].desc, CHARM_ICONS[id])).join('') : '<span class="dim">尚无</span>';
  return `<div class="bg"><span class="lb">灵物</span><span class="its">${r}</span></div><div class="bg"><span class="lb">符箓</span><span class="its">${c}</span></div>`;
}

// ---------------------------------------------------------------- 功法（悟功法这一步的卡、名册里已悟的功法）

/**
 * 悟功法的卡：龛里摆这门功法的徽记（和五行有关的带五行印章），签上写名字、哪一类、效果；
 * 带了这一行的法宝时多一行「合你的 X 行」（三选一稍微偏向已带的五行，这里说明为什么常出）。
 */
export function techView(p: Player, id: TechniqueId, i: number): CardView {
  const d = TECHNIQUES[id];
  const n = d.el ? elementCounts(p)[d.el] : 0;
  const sub = d.el ? `${ELEMENT_NAME[d.el]}行 · ${d.kind}之法` : `${d.kind}之法`; // 玩法类别（sim/techniques.ts 的 TechKind）
  const note = d.el && n ? [`${elSeal(d.el, 'in')}<span class="nw">合你的${ELEMENT_NAME[d.el]}行</span>`] : [];
  return {
    key: `tech:${id}`,
    tier: 0,
    niche: `${d.el ? elSeal(d.el) : ''}${img(TECH_ICONS[id], 'ico')}<i class="stand"></i><i class="kc">${i + 1}</i>`,
    info: infoHtml(d.name, `<span class="sub">${sub}</span>`, d.desc, note),
    act: `<button class="pick" data-act="learn" data-id="${id}" aria-label="悟 ${d.name}"><span>悟此法</span></button>`,
    detail: detailHtml(d.name, d.el ? elSeal(d.el) : '', `${sub} · 本局常驻`, d.desc, '', d.el && n ? [`${elSeal(d.el, 'in')}合你的${ELEMENT_NAME[d.el]}行：你带着 ${n} 件${ELEMENT_NAME[d.el]}行法宝，三选一时它更常出现`] : []),
  };
}

/** 名册里的功法：第 3 / 8 / 13 / 18 级的四个位置，一行一门。已悟的是图标 + 名字（悬停 / 点一下看说明），没悟的写第几级悟。 */
export function techsHtml(p: Player) {
  return TECH_LEVELS.map((lv, i) => {
    const id = p.techs[i];
    if (!id) return `<span class="tk empty" data-tip="升至第 ${lv} 级时，悟一门功法（三选一）"><i class="hole"></i><span class="nm">第 ${lv} 级悟</span></span>`;
    const d = TECHNIQUES[id];
    return `<span class="tk" data-tip="${d.name}：${d.desc}">${img(TECH_ICONS[id], 'i16')}<span class="nm">${d.name}</span></span>`;
  }).join('');
}

/**
 * 「功法」页签（名册用页签时的那一页）：每门已悟的功法一条——图标、名字、效果；后面一行说还有几门、第几级悟。
 * 说明放不下时按行截短（界面那边量），点一下看全文。
 */
export function techNotesHtml(p: Player) {
  const got = p.techs.map((id) => `<div class="te">${img(TECH_ICONS[id], 'i16')}<span class="tn"><b>${TECHNIQUES[id].name}</b>${TECHNIQUES[id].desc}</span></div>`).join('');
  const left = TECH_LEVELS.slice(p.techs.length);
  const next = left.length ? `<span class="tn dim">${p.techs.length ? '下一门' : '功法三选一，本局常驻'}：第 ${left.join('、')} 级悟</span>` : '';
  return got + next;
}
