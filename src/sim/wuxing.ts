// 五行的构筑（用户 2026-11-12 的方向；具体做法和数值 暂拟，待评审确认。数值都在 catalog.WX）：
//   同行（纵深）：三件是质变、四件再进一步——金「斩杀」迸出金气、木「生生不息」冒出藤蔓、土「不动如山」站稳震地
//     （水「寒彻」、火「燎原」本来就是质变，四件只是加强，结算在 core.hitEnemy / onKill）；
//   异行（广度）：凑齐三行「三才」、四行「四象」、五行「五行俱全」——相生更狠、印记更久，俱全时相生不再挑顺序。
// 件数 = 法宝 + 宠物（core.elementCounts；宠物的五行是 HEROES[hero].petEl，和主五行不同）。
// 防无限循环（用户：「注意五行不要无限循环」）：这里打出的伤害都是 by 'wx'（core 的 NO_MARK：不打印记、不触发相生）；
// 被这些「余波」（CHAIN_BY：金气、震地、相生的额外伤害、燎原 / 碎冰的爆炸、灵物的余波）打死的，不再触发三件档的击杀效果
// （燎原、碎冰、金气、藤蔓），所以一帧里的连环最多一层；燎原点着的火要等它自己烧死人，才会再炸，那是一帧一帧烧过去的。
import { HEROES, TIER_DMG, WEAPONS, WX } from './catalog.ts';
import { buildGrid, elementCounts, enemiesWithin, hitEnemy, inReach } from './core.ts';
import { ELEMENTS, type Element, type Enemy, type HitBy, type Player, type ReactionKind, type SimEvent } from './types.ts';
import type { World } from './world.ts';

/** 宠物的五行。 */
export const petElOf = (p: Player): Element => HEROES[p.hero].petEl;

/** 这一行的档位：件数按四件封顶（三件档、四件档的表都按这个下标取）。 */
export const wxTier = (n: number) => Math.min(4, n);

/** 带了几种不同的五行。 */
export function distinctOf(ec: Record<Element, number>) {
  let n = 0;
  for (const e of ELEMENTS) if (ec[e] > 0) n++;
  return n;
}

/** 异行档：三才 / 四象 / 五行俱全（凑不到三行是 null）。 */
export function wxSetOf(ec: Record<Element, number>) {
  const n = distinctOf(ec);
  for (let i = WX.set.length - 1; i >= 0; i--) if (n >= WX.set[i].n) return WX.set[i];
  return null;
}

/** 五行俱全：打进这一行的那种相生（打出这一下的是被生的一行，例：火 → 引燃）。 */
const INTO: Partial<Record<Element, ReactionKind>> = { water: 'frost', wood: 'conduct', fire: 'ignite', earth: 'lava', metal: 'pierce' };
export const reactionInto = (el: Element): ReactionKind => INTO[el]!;

/**
 * 「余波」：被这些伤害打死的，不再触发三件档的击杀效果（燎原、碎冰、金气、藤蔓）。
 * explode 燎原 / 碎冰的爆炸；react 相生打出的额外伤害；wx 金气、震地；relic 九龙玉佩的龙息、风雷羽的小雷。
 */
export const CHAIN_BY: ReadonlySet<HitBy> = new Set<HitBy>(['explode', 'react', 'wx', 'relic']);

/**
 * 金行三件「斩杀」的金气：从被斩的那只身上迸出 n 道，各斩身边最近的一只（离人物 REACH.max 以内）。
 * 伤害 = 被斩那只最大气血 × jinqi.mul（不少于斩它的那一下），被斩到的照常按斩杀线判一次；金气 by 'wx'，打死的不再迸金气。
 */
export function jinqi(w: World, p: Player, e: Enemy, hitDmg: number, ev: SimEvent[]) {
  const t = wxTier(elementCounts(p).metal);
  const n = WX.jinqi.n[t];
  if (n <= 0) return;
  buildGrid(w.enemies);
  const keep = inReach(p);
  const near = enemiesWithin(w, e.x, e.y, WX.jinqi.r)
    .filter((o) => o !== e && keep(o))
    .sort((a, b) => (a.x - e.x) ** 2 + (a.y - e.y) ** 2 - ((b.x - e.x) ** 2 + (b.y - e.y) ** 2) || a.id - b.id)
    .slice(0, n);
  if (!near.length) return;
  const dmg = Math.max(hitDmg, e.maxHp * WX.jinqi.mul);
  ev.push({ t: 'wx', kind: 'jinqi', owner: p.id, x: e.x, y: e.y, ids: near.map((o) => o.id), pts: near.map((o) => [o.x, o.y]), tier: t });
  for (const o of near) hitEnemy(w, o, { dmg, by: 'wx', owner: p.id, from: e, el: 'metal', canCrit: false }, ev);
}

/**
 * 木行三件「生生不息」的藤蔓：击杀时（每 vine.cd 秒最多一次）从倒下的地方冒出来，缠住身边最近的 n 只：
 * 减速、受伤加深（Enemy.tangle：单算一层，和宠物的破绽这些易伤相乘——不然被混天绫缠过的身上已经有更大的易伤，藤蔓等于没加）；
 * 缠上时绞一下（木行伤害 vine.base，按身上最高品阶的木行法宝与伤害、木行亲和放大；by 'wx'：不打印记、不相生，绞死的不再冒藤）；
 * 四件先定住片刻（首领不定）。
 */
export function vine(w: World, p: Player, e: Enemy, ev: SimEvent[]) {
  const st = (p.wx ??= { vineCd: 0, quakeCd: 0 });
  if (st.vineCd > 0) return;
  const t = wxTier(elementCounts(p).wood);
  const V = WX.vine;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, e.x, e.y, V.r)
    .filter((o) => o !== e)
    .sort((a, b) => (a.x - e.x) ** 2 + (a.y - e.y) ** 2 - ((b.x - e.x) ** 2 + (b.y - e.y) ** 2) || a.id - b.id)
    .slice(0, V.n[t]);
  if (!near.length) return;
  st.vineCd = V.cd;
  for (const o of near) {
    o.slow = Math.max(o.slow, V.slow);
    o.slowT = Math.max(o.slowT, V.t);
    o.tangle = V.vuln;
    o.tangleUntil = Math.max(o.tangleUntil ?? 0, w.time + V.t);
    if (V.root[t] && o.kind !== 'boss') o.stun = Math.max(o.stun, V.root[t]);
  }
  ev.push({ t: 'wx', kind: 'vine', owner: p.id, x: e.x, y: e.y, r: V.r, ids: near.map((o) => o.id), pts: near.map((o) => [o.x, o.y]), tier: t });
  const dmg = wxDamage(p, 'wood', V.base);
  for (const o of near) hitEnemy(w, o, { dmg, by: 'wx', owner: p.id, from: e, el: 'wood', canCrit: false }, ev);
}

/** 三件档自己打出的伤害（藤蔓绞、震地）：base × 身上这一行最高品阶的倍率 × (1 + 伤害 + 这一行的亲和)。 */
function wxDamage(p: Player, el: Element, base: number) {
  let tier = 1;
  for (const x of p.weapons) if (x.tier > tier && WEAPONS[x.kind].el === el) tier = x.tier;
  return base * TIER_DMG[tier] * (1 + p.stats.damage + p.stats.aff[el]);
}

/** 每帧（world.step 里每个人调一次）：三件档的冷却；土行三件站稳了就震地。 */
export function updateWuxing(w: World, p: Player, dt: number, ev: SimEvent[]) {
  if (!p.wx) {
    if (!p.alive) return;
    p.wx = { vineCd: 0, quakeCd: 0 };
  }
  const st = p.wx;
  st.vineCd = Math.max(0, st.vineCd - dt);
  st.quakeCd = Math.max(0, st.quakeCd - dt);
  if (!p.alive) return;
  const earth = elementCounts(p).earth;
  if (earth < 3 || p.still < WX.quake.still || st.quakeCd > 0) return;
  quake(w, p, wxTier(earth), ev);
}

/** 土行三件的震地：以人物为心震一圈（土行伤害、击退；四件震晕片刻）。伤害按身上最高品阶的土行法宝。 */
function quake(w: World, p: Player, t: number, ev: SimEvent[]) {
  const Q = WX.quake;
  const st = p.wx!;
  st.quakeCd = Q.cd[t];
  const dmg = wxDamage(p, 'earth', Q.base);
  const r = Q.r[t] * (1 + p.stats.area * 0.5);
  ev.push({ t: 'wx', kind: 'quake', owner: p.id, x: p.x, y: p.y, r, tier: t });
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, p.x, p.y, r)) hitEnemy(w, e, { dmg, by: 'wx', owner: p.id, from: p, kb: Q.kb, el: 'earth', canCrit: false, stun: Q.stun[t] || undefined }, ev);
}
