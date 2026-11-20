// 商店与升级：生成升级选项、宠物进化、商店货架，执行买卖 / 刷新 / 锁定 / 准备等指令。
// 全部用世界的随机数，结果确定，联机时房主执行即可。
import {
  CHARMS,
  ELIXIRS,
  MAX_TIER_BY_BUY,
  MAX_WEAPONS,
  RELICS,
  STAT_UPGRADES,
  WEAPONS,
  ECON,
  priceScale,
  rerollPrice,
  shopWeapons,
} from './catalog.ts';
import { ELEMENTS } from './types.ts';
import { learnTechnique, techFreeRerolls, techOfferCut } from './techniques.ts';
import { PET_KINDS, petKindOf } from './pet.ts';
import type { CharmId, Command, ElixirId, PetBranch, Player, RelicId, ShopOffer, SimEvent, StatId, StatOffer, WeaponKind } from './types.ts';
import type { World } from './world.ts';

const STATS = Object.keys(STAT_UPGRADES) as StatId[];
const TP = (t: number) => ECON.tierPrice[t]; // 每次现读：tools/tune.ts 改的是 ECON 上的数组
const pick = <T>(w: World, xs: readonly T[]) => xs[Math.floor(w.rng.next() * xs.length)];
/** 同名完整件的价：按手里那件的品阶（ps 是物价随波次的倍数）。 */
const sameNamePrice = (kind: WeaponKind, tier: number, ps: number) => Math.round(WEAPONS[kind].price * ECON.upPrice[tier] * ps);
/** 碎片的价：同名完整件的三成，最少 3 灵石。 */
const fragmentPrice = (full: number) => Math.max(3, Math.round(full * ECON.fragment));

// ---------- 升级 ----------

/** 这个人这一次刷新万宝阁要花多少灵石：修为「利市」打折、「玄坛赐福」每进一次商店头一次不花（xiuwei.ts；没点修为照原价）。 */
/**
 * 这一次刷新万宝阁要多少灵石：头几次免费（修为「玄坛赐福」p.boon.freeReroll、功法「五鬼搬运」techFreeRerolls），之后按 rerollPrice
 * （修为「利市」打折）；五鬼搬运白刷的那几次不算进涨价（从第一次的价起），玄坛赐福的算。
 */
export function rerollCost(w: World, p: Player) {
  const tech = techFreeRerolls(p);
  if (p.rerolls < (p.boon?.freeReroll ?? 0) + tech) return 0;
  return rerollPrice(w.wave, p.rerolls - tech, p.boon?.reroll);
}

export function makeLevelOffers(w: World, p: Player): StatOffer[] {
  const out: StatOffer[] = [];
  const used = new Set<string>();
  while (out.length < 4 + (p.boon?.offers ?? 0) - techOfferCut(p)) { // 修为「慧根」：多一个可选（xiuwei.ts）；功法「五鬼搬运」：少一个（techniques.ts）
    const stat = pick(w, STATS);
    const el = stat === 'aff' ? pick(w, ELEMENTS) : undefined;
    const key = stat + (el ?? '');
    if (used.has(key)) continue;
    used.add(key);
    // 档位：等级和气运越高，越容易出高档
    const lift = p.level * 0.012 + p.stats.luck * 0.002;
    const r = w.rng.next();
    const tier = r < 0.01 + lift * 0.3 ? 4 : r < 0.08 + lift * 0.8 ? 3 : r < 0.3 + lift ? 2 : 1;
    out.push({ stat, tier, el });
  }
  return out;
}

export function applyStat(p: Player, o: StatOffer) {
  const v = STAT_UPGRADES[o.stat].values[o.tier - 1];
  const s = p.stats;
  switch (o.stat) {
    case 'maxHp':
      s.maxHp += v;
      p.hp += v;
      break;
    case 'aff':
      s.aff[o.el!] += v;
      break;
    default:
      (s as unknown as Record<string, number>)[o.stat] += v;
  }
}

/** 宠物进化的时机：升到 5 / 10 / 15 级。 */
export const PET_LEVELS = [5, 10, 15];

/**
 * 这一刻该不该进化、有哪几条路可选：到了 PET_LEVELS 里的等级还没进化的就该进化；还没选过分支时二选一，选过了沿着那条路走。
 * 打开商店时、每次进化之后都按它重算：一波里连跨两个门槛，就在同一次商店里接连进化两次（原来第二次要等到下一个商店）。
 */
export function petEvolveOffer(p: Player): PetBranch[] | null {
  const due = PET_LEVELS.filter((l) => p.level >= l).length;
  if (p.pet.stage >= due) return null;
  return p.pet.branch ? [p.pet.branch] : [...PET_KINDS[petKindOf(p)].branches]; // 两条路按宠物种类（pet.ts）
}

// ---------- 商店货架 ----------
/**
 * 这个人能不能刷到这一件：还没靠成就解锁的（Player.sealed）不刷。只是从池子里去掉几样，抽签照旧一次一个随机数：
 * 没有 sealed 时池子和原来一模一样，随机数的用法、刷出来的货都不变。
 */
const open = (p: Player, cat: 'weapon' | 'relic' | 'elixir' | 'charm', id: string) => !p.sealed?.includes(`${cat}:${id}`);

function weaponOffer(w: World, p: Player): ShopOffer {
  const owned = new Map(p.weapons.map((x) => [x.kind, x]));
  const full = p.weapons.length >= MAX_WEAPONS;
  const own = (Object.keys(WEAPONS) as WeaponKind[]).filter((k) => WEAPONS[k].exclusive === p.hero);
  // 候选：公共法宝 + 自己的专属；位置满了只出已有的；同名件稍微更容易刷到。画面还没做完的（标 wip 的）不刷，见 catalog.WIP
  // 还没解锁的（成就奖励，Player.sealed）不刷；手里已经有的照常出同名件、碎片、器灵
  let pool: WeaponKind[] = [...shopWeapons(), ...own].filter((k) => owned.has(k) || (!full && !WEAPONS[k].exclusive && open(p, 'weapon', k)));
  pool = [...pool, ...p.weapons.map((x) => x.kind)];
  for (let tries = 0; tries < 20; tries++) {
    const kind = pick(w, pool);
    const def = WEAPONS[kind];
    const have = owned.get(kind);
    const ps = priceScale(w.wave);
    if (have) {
      if (have.tier >= 4) continue;
      if (have.tier >= MAX_TIER_BY_BUY) {
        // 器灵：先随机挑一个，进货时（restock）另一个紧挨着一起上架，二选一
        const sp = pick(w, def.spirits);
        return { cat: 'spirit', kind, spirit: sp.id, price: Math.round(def.price * ECON.spirit * ps) };
      }
      // 同名件按手里那件的品阶定价，不能用低阶件刷升级；碎片是升阶材料，三枚升一阶
      const price = sameNamePrice(kind, have.tier, ps);
      return w.rng.next() < 0.6 ? { cat: 'weapon', kind, form: 'full', tier: have.tier, price } : { cat: 'weapon', kind, form: 'fragment', tier: have.tier, price: fragmentPrice(price) };
    }
    const t2 = Math.max(0, Math.min(0.35, (w.wave - 4) * 0.05 + p.stats.luck * 0.002));
    const t3 = Math.max(0, Math.min(0.15, (w.wave - 10) * 0.03));
    const r = w.rng.next();
    const tier = r < t3 ? 3 : r < t3 + t2 ? 2 : 1;
    return { cat: 'weapon', kind, form: 'full', tier, price: Math.round(def.price * TP(tier) * ps) };
  }
  return relicOffer(w, p);
}

const RELIC_IDS = Object.keys(RELICS) as RelicId[];
const ELIXIR_IDS = Object.keys(ELIXIRS) as ElixirId[];
const CHARM_IDS = Object.keys(CHARMS) as CharmId[];

function relicOffer(w: World, p: Player): ShopOffer {
  const can = p.sealed ? RELIC_IDS.filter((id) => open(p, 'relic', id)) : RELIC_IDS;
  const id = pick(w, can.length ? can : RELIC_IDS);
  return { cat: 'relic', id, price: Math.round(RELICS[id].price * priceScale(w.wave)) };
}

/**
 * 一格货是哪一类：法宝 45%、灵物 33%、丹药 10%、符箓 12%（符箓都有了就换成灵物）。
 * 符箓原来 10%、灵物 35%：M3 符箓从 2 种扩到 8 种之后，替身符、护心符这两张保命的刷到的机会只剩四分之一，
 * 机器人 60 局第一章首领多死了 4 局（57 → 52 胜，node --no-osr-from-maglev tools/balance.ts 60）；符箓提到 12% 拉回到 56 胜。
 */
function makeOffer(w: World, p: Player): ShopOffer {
  const r = w.rng.next();
  // 其余三类按原来 33 : 10 : 12 的比例分剩下的几率
  const ws = ECON.weaponShare;
  if (r < ws) return weaponOffer(w, p);
  if (r < ws + (1 - ws) * (33 / 55)) return relicOffer(w, p);
  if (r < ws + (1 - ws) * (43 / 55)) {
    const can = p.sealed ? ELIXIR_IDS.filter((id) => open(p, 'elixir', id)) : ELIXIR_IDS;
    const id = pick(w, can.length ? can : ELIXIR_IDS);
    return { cat: 'elixir', id, price: Math.round(ELIXIRS[id].price * priceScale(w.wave)) };
  }
  const left = CHARM_IDS.filter((c) => !p.charms.includes(c) && open(p, 'charm', c));
  if (!left.length) return relicOffer(w, p);
  const id = pick(w, left);
  return { cat: 'charm', id, price: Math.round(CHARMS[id].price * priceScale(w.wave)) };
}

/** 货的「身份」：同一次进货里同一件法宝（同名件、碎片、器灵都算它）/ 同一件灵物不重复出现。 */
const offerKey = (o: ShopOffer | null) => (!o ? '' : o.cat === 'weapon' || o.cat === 'spirit' ? `w:${o.kind}` : `${o.cat}:${o.id}`);

/** 器灵「二选一」里的另一个（同一件法宝、同一个价）。 */
function otherSpirit(o: ShopOffer & { cat: 'spirit' }): ShopOffer {
  const sp = WEAPONS[o.kind].spirits.find((s) => s.id !== o.spirit)!;
  return { cat: 'spirit', kind: o.kind, spirit: sp.id, price: o.price };
}

/** 货架上和第 slot 格配成一对的另一个器灵在第几格（同一件法宝的另一个器灵）；没有就是 -1。界面用它把一对器灵标成「二选一」。 */
export function spiritPair(p: Player, slot: number): number {
  const o = p.shop[slot];
  if (!o || o.cat !== 'spirit') return -1;
  return p.shop.findIndex((x, i) => i !== slot && !!x && x.cat === 'spirit' && x.kind === o.kind && x.spirit !== o.spirit);
}

/**
 * 刷新货架：锁住的格子保留。
 * 器灵二选一（用户定：每件法宝两个器灵二选一）：刷出器灵时，同一件法宝的两个器灵紧挨着一起上架，让人并排比较；
 * 买下一个，另一个随之下架（见 syncOffers）。原来是随机给一个，另一个永远看不到，不满意只能刷新。
 */
export function restock(w: World, p: Player) {
  const taken = new Set(p.shop.filter((o, i) => o && p.locked[i]).map(offerKey));
  const free: number[] = [];
  for (let i = 0; i < p.shop.length; i++) if (!(p.locked[i] && p.shop[i])) free.push(i);
  // 先一格一格进货（没刷出器灵时，随机数的用法和原来完全一样）
  const made: ShopOffer[] = [];
  for (let j = 0; j < free.length; j++) {
    let o = makeOffer(w, p);
    for (let tries = 0; tries < 12 && taken.has(offerKey(o)); tries++) o = makeOffer(w, p);
    taken.add(offerKey(o));
    made.push(o);
  }
  // 再排上架：器灵带着另一个一起占两格；放不下一对时，让出前面最后一件不是器灵的货；实在没处放（只空着一格）这个器灵就不上架
  const lockedSpirit = (o: ShopOffer) => o.cat === 'spirit' && p.shop.some((x, i) => !!x && p.locked[i] && x.cat === 'spirit' && x.kind === o.kind && x.spirit === o.spirit);
  const out: ShopOffer[] = [];
  for (const o of made) {
    // 这件法宝的器灵已经排上了（同名去重偶尔漏过去）：不再排第二对
    if (o.cat === 'spirit' && out.some((x) => x.cat === 'spirit' && x.kind === o.kind)) continue;
    // 已经锁在货架上的那个器灵不重复上架（只补它缺的另一个）
    const add = o.cat === 'spirit' ? [o, otherSpirit(o)].filter((x) => !lockedSpirit(x)) : [o];
    if (add.length < 2) {
      if (add.length && out.length < free.length) out.push(add[0]);
      continue;
    }
    if (out.length + 2 > free.length) {
      let k = out.length - 1;
      while (k >= 0 && out[k].cat === 'spirit') k--;
      if (k < 0 || out.length + 1 > free.length) continue;
      out.splice(k, 1);
    }
    out.push(...add);
  }
  // 让位之后空出来的格子补上别的货（不再出器灵）
  while (out.length < free.length) {
    let o = makeOffer(w, p);
    for (let tries = 0; tries < 20 && (o.cat === 'spirit' || taken.has(offerKey(o))); tries++) o = makeOffer(w, p);
    if (o.cat === 'spirit') o = relicOffer(w, p);
    taken.add(offerKey(o));
    out.push(o);
  }
  free.forEach((i, j) => {
    p.locked[i] = false;
    p.shop[i] = out[j];
  });
}

/**
 * 把货架上的法宝货和手里的法宝对齐。打开商店时（opening，在进货之前）和每次买完东西之后调：
 * - 同名完整件 / 碎片：品阶和价钱跟着手里那件现在的品阶走。锁住的货会留到下一波，这期间手里那件可能靠宝匣开出的碎片升了阶；
 *   原来仍按上架时的旧品阶收钱，等于用低价升阶。
 * - 器灵：手里那件已经觉醒（买下了另一个器灵），剩下的这个随之下架。
 * - 打开商店时，锁着但已经用不上的货（手里那件到了仙品，同名件和碎片都升不了它）解锁，让这一格重新进货。
 */
export function syncOffers(w: World, p: Player, opening = false) {
  const ps = priceScale(w.wave);
  for (let i = 0; i < p.shop.length; i++) {
    const o = p.shop[i];
    if (!o || (o.cat !== 'weapon' && o.cat !== 'spirit')) continue;
    const have = p.weapons.find((x) => x.kind === o.kind);
    if (!have) continue;
    if (o.cat === 'spirit') {
      if (have.tier > MAX_TIER_BY_BUY) {
        p.shop[i] = null;
        p.locked[i] = false;
      }
    } else if (have.tier >= MAX_TIER_BY_BUY) {
      if (opening) p.locked[i] = false;
    } else if (o.tier !== have.tier) {
      const full = sameNamePrice(o.kind, have.tier, ps);
      p.shop[i] = { ...o, tier: have.tier, price: o.form === 'full' ? full : fragmentPrice(full) };
    }
  }
}

// ---------- 买 ----------
function addWeapon(p: Player, kind: WeaponKind, tier: number) {
  p.weapons.push({ kind, tier, spirit: null, cd: 0.5 });
}

/** 给一件已有的法宝加一枚碎片：攒满三枚升一阶。没有这件、或已到仙品（之后只能靠器灵）返回 null。商店和乾坤宝匣共用。 */
export function addFragment(p: Player, kind: WeaponKind): 'fragment' | 'upgraded' | null {
  const have = p.weapons.find((x) => x.kind === kind);
  if (!have || have.tier >= MAX_TIER_BY_BUY) return null;
  const n = (p.frags[kind] ?? 0) + 1;
  if (n >= 3) {
    have.tier++;
    p.frags[kind] = 0;
    return 'upgraded';
  }
  p.frags[kind] = n;
  return 'fragment';
}

/** 执行一次购买，返回结果说明（upgraded / new / fragment / awakened / relic / elixir / charm，给表现层做提示）；买不了返回 null。 */
export function buy(w: World, p: Player, slot: number): string | null {
  const o = p.shop[slot];
  if (!o || p.lingshi < o.price) return null;
  let result = '';
  switch (o.cat) {
    case 'weapon': {
      const have = p.weapons.find((x) => x.kind === o.kind);
      // 同名件、碎片按手里那件的品阶定价：品阶对不上（上架之后手里那件升过阶，价钱是旧的）就不卖 —— 不能用低阶的价升阶。
      // 正常流程里 syncOffers 已经把价改好了，走不到这里
      if (have && o.tier !== have.tier) return null;
      if (o.form === 'full') {
        if (have) {
          if (have.tier >= MAX_TIER_BY_BUY) return null;
          have.tier++;
          result = 'upgraded';
        } else {
          if (p.weapons.length >= MAX_WEAPONS) return null;
          addWeapon(p, o.kind, o.tier);
          result = 'new';
        }
      } else {
        // 碎片：升阶材料，只对手里已有的法宝有用；攒满三枚升一阶
        const r = addFragment(p, o.kind);
        if (!r) return null;
        result = r;
      }
      break;
    }
    case 'spirit': {
      const have = p.weapons.find((x) => x.kind === o.kind);
      if (!have || have.tier !== MAX_TIER_BY_BUY) return null;
      have.tier = 4;
      have.spirit = o.spirit;
      result = 'awakened';
      break;
    }
    case 'relic': {
      const before = p.stats.maxHp;
      RELICS[o.id].apply(p.stats);
      p.relics[o.id] = (p.relics[o.id] ?? 0) + 1;
      if (p.stats.maxHp > before) p.hp += p.stats.maxHp - before;
      p.hp = Math.min(p.hp, p.stats.maxHp);
      result = 'relic';
      break;
    }
    case 'elixir':
      ELIXIRS[o.id].drink(p); // 立刻生效的（回春丹、大还丹）直接改气血；其余记进 p.buffs，只管下一波（relics.relicWaveStart）
      result = 'elixir';
      break;
    case 'charm':
      if (p.charms.includes(o.id)) return null;
      p.charms.push(o.id);
      result = 'charm';
      break;
  }
  p.lingshi -= o.price;
  p.shop[slot] = null;
  p.locked[slot] = false;
  syncOffers(w, p); // 手里的法宝变了：货架上同一件的货跟着改价；觉醒了器灵，另一个器灵随之下架
  return result;
}

/** 卖掉一件法宝（专属的不能卖），退四分之一的钱。 */
export function sell(w: World, p: Player, index: number): boolean {
  const wpn = p.weapons[index];
  if (!wpn || WEAPONS[wpn.kind].exclusive) return false;
  p.lingshi += Math.round(WEAPONS[wpn.kind].price * TP(wpn.tier) * priceScale(w.wave) * 0.25);
  p.weapons.splice(index, 1);
  return true;
}

/** 处理商店阶段的一条指令。 */
export function applyCommand(w: World, c: Command, ev: SimEvent[]) {
  const p = w.players[c.player];
  if (!p || p.left || w.phase !== 'shop') return; // 离开了房间的人的指令不认（roster.ts）
  switch (c.t) {
    case 'evolve':
      if (!p.petOffer?.includes(c.branch)) return;
      p.pet.stage++;
      if (!p.pet.branch) p.pet.branch = c.branch;
      ev.push({ t: 'evolve', owner: p.id, stage: p.pet.stage, branch: p.pet.branch });
      p.petOffer = petEvolveOffer(p); // 一波里连跨两个门槛：接着再进化一次（沿着已经选定的那条路）
      break;
    case 'learn': // 悟功法（techniques.ts）：宠物进化之后、选属性之前
      learnTechnique(w, p, c.id, ev);
      break;
    case 'pick':
      if (p.petOffer || p.techOffer || p.pendingLevels <= 0 || !p.levelOffers[c.index]) return;
      applyStat(p, p.levelOffers[c.index]);
      p.pendingLevels--;
      p.levelOffers = p.pendingLevels > 0 ? makeLevelOffers(w, p) : [];
      break;
    case 'rerollLevel': {
      const cost = 2 + p.level;
      if (p.pendingLevels <= 0 || p.lingshi < cost) return;
      p.lingshi -= cost;
      p.levelOffers = makeLevelOffers(w, p);
      break;
    }
    case 'buy': {
      const o = p.shop[c.slot];
      const r = buy(w, p, c.slot);
      if (r && o) ev.push({ t: 'bought', owner: p.id, offer: o, result: r });
      break;
    }
    case 'reroll': {
      const cost = rerollCost(w, p); // 修为「利市」「玄坛赐福」（xiuwei.ts）；功法「五鬼搬运」前几次不要钱（techniques.ts）
      if (p.lingshi < cost) return;
      p.lingshi -= cost;
      p.rerolls++;
      restock(w, p);
      break;
    }
    case 'lock':
      if (p.shop[c.slot]) p.locked[c.slot] = !p.locked[c.slot];
      break;
    case 'sell':
      sell(w, p, c.weapon);
      break;
    case 'ready':
      if (p.pendingLevels <= 0 && !p.petOffer && !p.techOffer) p.ready = true;
      break;
    // ---- 联机（什么时候开下一波见 coop.shopDone）----
    case 'unready':
      p.ready = false;
      break;
    case 'give': {
      const q = w.players[c.to];
      const n = Math.floor(Math.min(c.amount, p.lingshi));
      if (!q || q === p || q.left || !(n > 0)) return;
      p.lingshi -= n;
      q.lingshi += n;
      ev.push({ t: 'gift', owner: p.id, to: q.id, amount: n });
      break;
    }
  }
}
