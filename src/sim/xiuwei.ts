// 修为（局外成长，M3 · docs/design.md「局外成长」「修为」）：标题页「修为」里用「道行」点亮的一张修行图谱。
// 2026-11-12 重做（用户：「把修为做得更精致，要更多修为元素，可以选路线，同时存在几条路线，同时某些节点只能二选一」；
// 同日又改：「不要用炼气、筑基、金丹，用洪荒体系」）。做法和数值 暂拟，待评审确认。
//
// 骨架：树根「问道」在图谱的根上，五条路线（身、器、灵、财、心）像经络一样从根上往外长；每条路线五节，各占一层境界——
//   地仙 → 天仙 → 金仙 → 太乙金仙 → 大罗金仙（洪荒的仙道阶位；准圣、圣人不放进来）。
// 点一节要：① 同一条路线上前一层的那一节点亮了（前一层是二选一的，点了哪一边都行）；② 前一层境界一共点够了几节（REALM_GATE，
//   不是点满：天仙要地仙两节，金仙要天仙两节，太乙要金仙三节，大罗要太乙三节）——所以想往外走一条路，就得在别的路上也点一些；
//   ③ 二选一的另一边没点（rival：点了一边，另一边就封住，重置才能改）；④ 道行够。
// 节点三种：小节点（一点属性）；心法（大罗金仙那一层，机制性的，名字四个字）；二选一（八对，其中三对是心法）。
// 一共 34 个节点，点满（二选一只算一边）是 26 个、706 道行。
//
// 开局时把点亮的节点交给模拟（createWorld 的 RunSetup.xiuwei：每个人一串节点 id，纯数据），applyXiuwei 给人物加上：
//   属性类直接加进 stats；开局灵石进 lingshi；万宝阁多一格是 shop / locked 多一格；「先天灵宝」把起手的专属法宝换成灵品；
//   打的时候才用得到的放在 Player.boon 上（Boons，纯数据进快照），由 shop.ts / pet.ts / core.ts / world.ts 读。
// 没点过修为的人 applyXiuwei 什么都不做（Player 上也没有 boon 字段），和原来逐字一样。
// 老存档（2026-11-11 的十节树）的 id 在 LEGACY 里对到新节点；对上了、前置也满足的照旧点亮，对不上的不点（道行总数不变，等于全额退还）。
// 存档（攒了多少道行、点了哪些）在 game/profile.ts；界面在 game/xiuwei.ts。
// 节点、花费和数值 ★（暂拟，待评审确认；数值放到最后统一调）。
// 节点表和纯函数在 xiuwei-table.ts（首屏的存档那一层只引它），这里原样再导出。
import { HEROES, TOTAL_WAVES, WAVES_PER_CHAPTER, priceScale } from './catalog.ts';
import { JIE, clampJie } from './jie.ts';
import { restock } from './shop.ts';
import type { Boons, Element, Player } from './types.ts';
import type { World } from './world.ts';
import { BOON_KEYS, gainOf, litNodes } from './xiuwei-table.ts';

export * from './xiuwei-table.ts';

/**
 * 开局（createWorld；中途加入的人在 net/host.ts 加进来之后）给一个人物加上他点亮的修为。没点过（空的、undefined）什么都不做。
 * 商店阶段加进来的（中途加入）多了货架格子时当场进一次货，新的那一格才有东西。
 */
export function applyXiuwei(w: World, p: Player, nodes: readonly unknown[] | null | undefined) {
  const ids = litNodes(nodes);
  if (!ids.length) return;
  const g = gainOf(ids);
  const s = p.stats;
  const hero = HEROES[p.hero];
  s.maxHp += g.maxHp;
  p.hp += g.maxHp;
  s.speed += g.speed;
  s.pickup += g.pickup;
  s.damage += g.damage + g.jieDmg * (w.jie - 1);
  s.haste += g.haste;
  s.area += g.area;
  s.crit += g.crit;
  s.critMul += g.critMul;
  s.luck += g.luck;
  s.regen += g.regen;
  s.soul += g.soul;
  s.armor += g.armor;
  s.dodge += g.dodge;
  if (g.affAll) for (const el of Object.keys(s.aff) as Element[]) s.aff[el] += g.affAll;
  if (g.affMain) s.aff[hero.el] += g.affMain;
  if (g.tier) {
    const ex = p.weapons.find((x) => x.kind === hero.exclusive);
    if (ex) ex.tier = Math.min(4, Math.max(ex.tier, 1 + g.tier));
  }
  p.lingshi += g.lingshi;
  for (let i = 0; i < g.slots; i++) {
    p.shop.push(null);
    p.locked.push(false);
  }
  const boon: Boons = {};
  for (const k of BOON_KEYS) if (g[k]) boon[k] = g[k];
  if (Object.keys(boon).length) p.boon = boon;
  if (g.slots && w.phase === 'shop') restock(w, p);
}

/** world.endWave：修为「生息」——每波打完另得几枚灵石（随物价涨）。没点的什么都不做。 */
export function xiuweiWaveEnd(w: World) {
  for (const p of w.players) if (p.boon?.interest && !p.left) p.lingshi += Math.round(p.boon.interest * priceScale(w.wave));
}

// ---------------------------------------------------------------- 道行

/** 一局给多少道行 ★（数值放到最后统一调）：打完一波 2、平定一章再 4、每斩 150 只 1、通关再 6，合计再乘劫数的倍率（jie.JIE.dao）。 */
export const DAO = { perWave: 2, perChapter: 4, perKills: 150, win: 6 };

export interface DaoRun {
  /** 打完了几波（全局编号；首领波要打赢才算）。 */
  cleared: number;
  kills: number;
  /** 全部章节平定。 */
  win: boolean;
  jie: number;
}

/** 这一局的道行，以及各部分（结算面板上写「打完 16 波 · 平定 2 章 · 斩 1200」用）。 */
export function daoBreakdown(r: DaoRun) {
  const cleared = Math.max(0, Math.min(TOTAL_WAVES, Math.floor(r.cleared)));
  const chapters = Math.floor(cleared / WAVES_PER_CHAPTER);
  const kills = Math.max(0, Math.floor(r.kills));
  const base = cleared * DAO.perWave + chapters * DAO.perChapter + Math.floor(kills / DAO.perKills) + (r.win ? DAO.win : 0);
  const mul = 1 + JIE.dao * (clampJie(r.jie) - 1);
  return { cleared, chapters, kills, base, mul, total: Math.round(base * mul) };
}

export const daoReward = (r: DaoRun) => daoBreakdown(r).total;

/** 这一局打完了几波：通关是全部；在收灵、商店里（刚打完 w.wave）算上这一波；正在打、或倒在这一波里的不算这一波。 */
export function wavesCleared(w: World): number {
  if (w.phase === 'win') return TOTAL_WAVES;
  return w.phase === 'shop' || w.phase === 'collect' ? w.wave : w.wave - 1;
}
