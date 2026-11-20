// 修为（xiuwei.ts，2026-11-12 重做的修行图谱）：节点表的形状（五层境界、五条路线、二选一、心法）、整理节点（境界门槛、互斥、老 id）、
// 开局加成、各个节点在局里的效果、道行的算法；没点修为的人和原来逐字一样；带修为的世界存档能存能恢复。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { botInput, botShop } from './bot.ts';
import { hitEnemy, hurtPlayer, weaponDamage } from './core.ts';
import { DT, PLAYER, SKILL } from './config.ts';
import { HEROES, LINGZHU, priceScale, rerollPrice } from './catalog.ts';
import { applyCommand, makeLevelOffers, rerollCost } from './shop.ts';
import { updatePet } from './pet.ts';
import {
  DAO,
  LEGACY,
  PATHS,
  REALMS,
  REALM_COST,
  REALM_GATE,
  XIUWEI,
  XIUWEI_FULL,
  XIUWEI_NODES,
  XIUWEI_TOTAL,
  daoBreakdown,
  daoReward,
  gainOf,
  gateOf,
  litNodes,
  nodeState,
  spentOn,
  wavesCleared,
  xiuweiPreset,
  xiuweiWaveEnd,
  type XiuweiId,
} from './xiuwei.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
/** 点满（二选一取先写的一边）。 */
const FULL = [...XIUWEI_FULL];
/** 点满（二选一取另一边）：和 FULL 一起把每个节点都点到一次。 */
const ALT = litNodes(XIUWEI_NODES.filter((n) => !n.rival || !FULL.includes(n.id)).map((n) => n.id));

function frame(w: World): SimEvent[] {
  const inputs = w.players.map((_, i) => botInput(w, i));
  const cmds = w.phase === 'shop' ? w.players.flatMap((_, i) => botShop(w, i)) : [];
  return step(w, inputs, cmds);
}

/** 点到某一节为止的一串（尽量少）：同路线一路点过去；境界门槛不够的，拿别的路线（排在前面的、没被封住的）补上，补的也照样点它的前置。 */
function pathTo(id: XiuweiId): XiuweiId[] {
  const lit: XiuweiId[] = [];
  const sealed = (n: { id: string; rival: string | null }) => !!n.rival && (lit.includes(n.rival) || n.rival === id);
  const ensure = (nid: XiuweiId) => {
    if (lit.includes(nid)) return;
    const n = XIUWEI[nid];
    if (n.req.length && !n.req.some((q) => lit.includes(q))) ensure(n.req.find((q) => !sealed(XIUWEI[q]))!);
    while (gateOf(lit, n.realm).have < REALM_GATE[n.realm]) ensure(XIUWEI_NODES.find((m) => m.realm === n.realm - 1 && m.path !== n.path && !lit.includes(m.id) && !sealed(m))!.id);
    lit.push(nid);
  };
  ensure(id);
  const out = litNodes(lit);
  assert.equal(out.length, lit.length, `pathTo(${id}) 有点不上的：${lit.join(',')}`);
  return out;
}

test('节点表：树根「问道」加五条路线、各五层境界（洪荒阶位），八对二选一、八个心法，共 34 节；点满 26 节、706 道行', () => {
  assert.deepEqual([...REALMS], ['问道', '地仙', '天仙', '金仙', '太乙金仙', '大罗金仙']);
  assert.equal(XIUWEI_NODES.length, 34);
  assert.equal(XIUWEI_NODES[0].id, 'wendao');
  assert.deepEqual(XIUWEI_NODES[0].req, []);
  assert.equal(new Set(XIUWEI_NODES.map((n) => n.id)).size, 34, 'id 不重复');
  assert.equal(new Set(XIUWEI_NODES.map((n) => n.name)).size, 34, '名字不重复');
  const pairs = XIUWEI_NODES.filter((n) => n.rival);
  assert.equal(pairs.length, 16, '八对');
  for (const n of pairs) {
    const r = XIUWEI[n.rival!];
    assert.equal(r.rival, n.id, '互为另一边');
    assert.equal(r.path, n.path);
    assert.equal(r.realm, n.realm);
  }
  assert.equal(XIUWEI_NODES.filter((n) => n.big).length, 8);
  assert.ok(XIUWEI_NODES.some((n) => n.big && n.rival), '心法里也有二选一');
  XIUWEI_NODES.forEach((n, i) => {
    assert.equal([...n.name].length, n.big ? 4 : 2, n.id);
    assert.equal(n.big, n.realm === 5, '心法都在大罗金仙那一层');
    assert.equal(n.cost, REALM_COST[n.realm]);
    for (const q of n.req) {
      assert.ok(XIUWEI_NODES.findIndex((m) => m.id === q) < i, `${n.id} 的前置在它前面`);
      assert.ok(XIUWEI[q].realm === n.realm - 1 && (XIUWEI[q].path === n.path || XIUWEI[q].path === 'root'), `${n.id} 的前置是同路线前一层`);
    }
    // 说明书面、有意象：一句，8–28 个字，不带口头语，数字最多一个；加多少写在 effect 那一行小字里
    assert.ok([...n.desc].length >= 8 && [...n.desc].length <= 28, `${n.id} 的说明长短不对`);
    assert.doesNotMatch(n.desc, /打死|一下|就|了|约/, n.id);
    assert.ok((n.desc.match(/\d+/g) ?? []).length <= 1, n.id);
    assert.ok(n.effect.length > 0, n.id);
  });
  for (const path of PATHS) {
    assert.deepEqual(
      [...new Set(XIUWEI_NODES.filter((n) => n.path === path).map((n) => n.realm))],
      [1, 2, 3, 4, 5],
      path,
    );
  }
  assert.equal(FULL.length, 26);
  assert.equal(ALT.length, 26);
  assert.equal(new Set([...FULL, ...ALT]).size, 34, 'FULL 和 ALT 合起来每个节点都有');
  assert.equal(XIUWEI_TOTAL, 706);
  assert.equal(spentOn(FULL), XIUWEI_TOTAL);
  assert.equal(spentOn(ALT), XIUWEI_TOTAL);
  assert.deepEqual(litNodes(FULL), FULL, '点满是一串合法的');
});

test('整理节点：前置、境界门槛、二选一互斥；不认识的、重复的丢掉；顺序乱的排好；老 id 换成新的', () => {
  assert.deepEqual(litNodes(undefined), []);
  assert.deepEqual(litNodes([]), []);
  assert.deepEqual(litNodes(['jilian']), [], '没有问道，地仙一层点不了');
  assert.deepEqual(litNodes(['jilian', 'wendao']), ['wendao', 'jilian']);
  assert.deepEqual(litNodes(['wendao', 'wendao', 'nope', 3, null, 'xunlei', 'jilian']), ['wendao', 'jilian'], '天仙一层要地仙两节');
  assert.deepEqual(litNodes(['wendao', 'jilian', 'tengyun', 'xunlei']), ['wendao', 'tengyun', 'jilian', 'xunlei']);
  assert.deepEqual(litNodes(['wendao', 'jilian', 'tengyun', 'xunlei', 'shanhe']), ['wendao', 'tengyun', 'jilian', 'xunlei'], '二选一两边都在：留先写的一边');
  assert.deepEqual(litNodes(['wendao', 'jilian', 'tengyun', 'shanhe', 'fengmang']), ['wendao', 'tengyun', 'jilian', 'shanhe'], '金仙一层要天仙两节');
  assert.deepEqual(litNodes(['wendao', 'jilian', 'tengyun', 'shanhe', 'lianxing', 'fengmang']), ['wendao', 'tengyun', 'jilian', 'lianxing', 'shanhe', 'fengmang'], '前一层是二选一，点哪边都通');
  assert.deepEqual(litNodes(['constructor', 'toString', '__proto__']), []);
  assert.deepEqual(litNodes([...FULL].reverse()), FULL);
  // 老十节树的 id
  assert.deepEqual(litNodes(['zhuji', 'lianqi', 'jucai']), ['wendao', 'jilian', 'jinbao']);
  assert.deepEqual(litNodes(Object.keys(LEGACY)), ['wendao', 'tengyun', 'jilian', 'ziqi', 'jinbao', 'yushou', 'lishi'], '老树点满：能对上的七节照旧，灵觉、慧根、广货前置不满足');
  // 能不能点
  assert.equal(nodeState([], 'wendao', 6), 'ok');
  assert.equal(nodeState([], 'wendao', 5), 'poor');
  assert.equal(nodeState([], 'jilian', 100), 'locked');
  assert.equal(nodeState(['wendao'], 'jilian', 100), 'ok');
  assert.equal(nodeState(['wendao'], 'wendao', 100), 'lit');
  assert.equal(nodeState(['wendao', 'jilian'], 'xunlei', 100), 'gated');
  assert.deepEqual(gateOf(['wendao', 'jilian'], 2), { need: 2, have: 1 });
  assert.equal(nodeState(['wendao', 'jilian', 'tengyun'], 'xunlei', 100), 'ok');
  assert.equal(nodeState(['wendao', 'jilian', 'tengyun', 'xunlei'], 'shanhe', 100), 'sealed');
  assert.equal(nodeState(['wendao', 'jilian', 'tengyun'], 'lianxing', 13), 'poor');
  for (const id of XIUWEI_NODES.map((n) => n.id)) pathTo(id);
});

test('半套与点满：half 由内而外点到总花费的一半左右，是一串合法的', () => {
  const half = xiuweiPreset('half');
  assert.deepEqual(litNodes(half), half);
  assert.ok(spentOn(half) >= XIUWEI_TOTAL / 2 && spentOn(half) < XIUWEI_TOTAL * 0.6, `${spentOn(half)}`);
  assert.deepEqual(xiuweiPreset('all'), FULL);
  assert.deepEqual(xiuweiPreset(null), []);
  assert.deepEqual(xiuweiPreset('x'), []);
});

test('没点修为：和原来逐字一样（Player 上也没有 boon）；点满（两套）：开局的属性、灵石、货架、法宝品阶、boon 都加上', () => {
  const a = createWorld(3);
  assert.equal(canonicalText(createWorld(3, 1, { xiuwei: [[]] })), canonicalText(a));
  assert.equal(canonicalText(createWorld(3, 1, { xiuwei: [undefined] })), canonicalText(a));
  assert.equal(canonicalText(createWorld(3, 1, { xiuwei: [['nope', 'xunlei']] })), canonicalText(a), '没有一节点得上');
  assert.equal('boon' in a.players[0], false);
  const q = a.players[0];
  const close = (x: number, y: number, m: string) => assert.ok(Math.abs(x - y) < 1e-9, `${m}: ${x} ≠ ${y}`);
  for (const [set, jie] of [
    [FULL, 1],
    [ALT, 4],
  ] as const) {
    const base = createWorld(3, 1, { jie });
    const w = createWorld(3, 1, { xiuwei: [set], jie });
    const p = w.players[0];
    const b = base.players[0];
    const g = gainOf(set);
    assert.equal(p.stats.maxHp, b.stats.maxHp + g.maxHp);
    assert.equal(p.hp, b.hp + g.maxHp);
    for (const k of ['speed', 'pickup', 'haste', 'area', 'crit', 'critMul', 'luck', 'regen', 'soul', 'armor', 'dodge'] as const) close(p.stats[k], b.stats[k] + g[k], k);
    close(p.stats.damage, b.stats.damage + g.damage + g.jieDmg * (jie - 1), 'damage（历劫按劫数）');
    const el = HEROES[p.hero].el;
    for (const e of Object.keys(p.stats.aff) as (keyof typeof p.stats.aff)[]) close(p.stats.aff[e], b.stats.aff[e] + g.affAll + (e === el ? g.affMain : 0), `aff.${e}`);
    assert.equal(p.lingshi, b.lingshi + g.lingshi);
    assert.equal(p.shop.length, 4 + g.slots);
    assert.equal(p.locked.length, 4 + g.slots);
    assert.equal(p.weapons[0].tier, 1 + g.tier);
    assert.equal(w.rng.state, base.rng.state, '开局加修为不用随机数');
  }
  assert.deepEqual(createWorld(3, 1, { xiuwei: [FULL] }).players[0].boon, { reroll: 0.2, freeReroll: 1, offers: 1, petDur: 0.27, petHaste: 0.15, skill: 0.08, fullGuard: 0.3, lowRegen: 1.5 });
  assert.deepEqual(createWorld(3, 1, { xiuwei: [ALT] }).players[0].boon, {
    reroll: 0.2,
    freeReroll: 1,
    offers: 1,
    petDur: 0.27,
    petHaste: 0.15,
    skill: 0.08,
    stepDodge: 0.08,
    bond: 0.2,
    bossGuard: 0.2,
    interest: 3,
  });
  // 联机：每个人各带各的
  const m = createWorld(3, 3, { xiuwei: [['wendao'], undefined, ['wendao', 'jinbao']] });
  assert.equal(m.players[0].stats.maxHp, q.stats.maxHp + 8);
  assert.equal(m.players[1].stats.maxHp, q.stats.maxHp);
  assert.equal(m.players[2].lingshi, 10);
  assert.equal(m.players[2].boon, undefined, '只有属性类的，没有 boon');
});

test('局里的效果：悟道五选一、利市刷新便宜、玄坛赐福头一次刷新不花、万宝货架五格都进货、紫气充能快', () => {
  const w = createWorld(4, 1, { xiuwei: [FULL] });
  const p = w.players[0];
  assert.equal(makeLevelOffers(w, p).length, 5);
  const w0 = createWorld(4);
  assert.equal(makeLevelOffers(w0, w0.players[0]).length, 4);
  // 利市：刷新的价便宜两成（至少 1）；玄坛赐福：每进一次商店头一次不花
  assert.equal(rerollCost(w0, w0.players[0]), rerollPrice(w0.wave, 0), '没点修为照原价');
  w.phase = 'shop';
  w.wave = 6;
  p.lingshi = 100;
  assert.equal(rerollCost(w, p), 0);
  const ev: SimEvent[] = [];
  applyCommand(w, { t: 'reroll', player: 0 }, ev);
  assert.equal(p.lingshi, 100, '头一次不花');
  assert.equal(rerollCost(w, p), rerollPrice(6, 1, 0.2));
  applyCommand(w, { t: 'reroll', player: 0 }, ev);
  assert.equal(p.lingshi, 100 - rerollPrice(6, 1, 0.2));
  assert.ok(p.shop.every((o) => o), '五格都进了货');
  // 只点利市、没点玄坛：头一次也照打折价
  const v = createWorld(4, 1, { xiuwei: [pathTo('lishi')] });
  v.wave = 6;
  assert.equal(rerollCost(v, v.players[0]), rerollPrice(6, 0, 0.2));
  // 紫气：每斩一只充能 ×1.08（和哪吒「灵珠子」相加）
  const k = createWorld(4, 1, { xiuwei: [FULL] });
  const e = spawnEnemy(k, 'soldier', 300, 300, []);
  hitEnemy(k, e, { dmg: 1e6, by: 'skill', owner: 0, from: k.players[0], canCrit: false }, []);
  assert.ok(Math.abs(k.players[0].skill - SKILL.chargePerKill * (1.08 + LINGZHU.charge)) < 1e-12);
});

/** 一个不会被打扰的世界：没有刷怪、人物不动。 */
function calm(nodes: XiuweiId[], seed = 9, heroes?: ('nezha' | 'yangjian')[]) {
  const t = createWorld(seed, 1, { xiuwei: [nodes], heroes });
  t.wave = 3;
  t.waveLen = 1e9;
  t.spawnAcc = -1e12;
  t.eliteDone = t.surgeDone = true;
  return t;
}

test('身：先天道体气血全满时减伤三成；缩地成寸走动时闪避更高；三花聚顶气血不足三成时回得快', () => {
  const hurt = (nodes: XiuweiId[], full: boolean, by: 'contact' | 'boss' = 'contact') => {
    const t = calm(nodes);
    const p = t.players[0];
    p.stats.dodge = 0;
    p.stats.armor = 0;
    p.stats.maxHp = p.hp = 1000;
    if (!full) p.hp = 900;
    const ev: SimEvent[] = [];
    hurtPlayer(t, p, 100, by, ev);
    return (full ? 1000 : 900) - p.hp;
  };
  const daoti = pathTo('daoti');
  assert.equal(hurt([], true), 100);
  assert.equal(hurt(daoti, true), 70);
  assert.equal(hurt(daoti, false), 100, '不是满血不减');
  // 五气朝元：首领的招式减两成，别的不减
  const wuqi = pathTo('wuqi');
  assert.equal(hurt(wuqi, false, 'boss'), 80 * 1, '首领之击');
  assert.equal(hurt([], false, 'boss'), 100);
  assert.equal(hurt(wuqi, false, 'contact'), 100);
  // 缩地成寸：同样的随机数，走动时多闪掉一些（闪避 +8%）
  const dodges = (nodes: XiuweiId[], moving: boolean) => {
    const t = calm(nodes, 21);
    const p = t.players[0];
    p.stats.dodge = 0.2;
    p.stats.maxHp = p.hp = 1e9;
    p.moving = moving;
    let n = 0;
    for (let i = 0; i < 4000; i++) {
      p.iframes = 0;
      const ev: SimEvent[] = [];
      hurtPlayer(t, p, 1, 'contact', ev);
      if (ev.some((x) => x.t === 'dodge')) n++;
    }
    return n / 4000;
  };
  const suodi = pathTo('suodi');
  assert.ok(Math.abs(dodges([], true) - 0.2) < 0.03);
  assert.ok(Math.abs(dodges(suodi, true) - 0.28) < 0.03);
  assert.ok(Math.abs(dodges(suodi, false) - 0.2) < 0.03, '站着不加');
  // 三花聚顶：一帧回多少
  const regen = (nodes: XiuweiId[], frac: number) => {
    const t = calm(nodes);
    const p = t.players[0];
    p.weapons = [];
    p.hp = p.stats.maxHp * frac;
    const h0 = p.hp;
    step(t, [idle]);
    return p.hp - h0;
  };
  const sanhua = pathTo('sanhua');
  assert.ok(Math.abs(regen(sanhua, 0.2) - regen(sanhua, 0.5) - 1.5 * DT) < 1e-9);
  assert.ok(Math.abs(regen([], 0.2) - regen([], 0.5)) < 1e-12);
});

test('器：人宝合一专属法宝伤害 +20%、别的法宝不加；先天灵宝起手的专属法宝是灵品', () => {
  const heyi = createWorld(5, 1, { xiuwei: [pathTo('heyi')] });
  const w0 = createWorld(5, 1, { xiuwei: [pathTo('heyi').filter((id) => id !== 'heyi')] });
  const p = heyi.players[0];
  const p0 = w0.players[0];
  assert.ok(Math.abs(weaponDamage(p, p.weapons[0], 0) - weaponDamage(p0, p0.weapons[0], 0) * 1.2) < 1e-9);
  const other = { kind: 'huojian' as const, tier: 1, spirit: null, cd: 0 };
  assert.equal(weaponDamage(p, other, 0), weaponDamage(p0, other, 0));
  const lb = createWorld(5, 1, { xiuwei: [pathTo('lingbao')] });
  assert.equal(lb.players[0].weapons[0].tier, 2);
  assert.equal(lb.players[0].weapons[0].kind, HEROES.nezha.exclusive);
});

test('灵：驭兽、万灵归心让灵宠缠得久、出手勤（冷却多走一成五）', () => {
  const wrapDur = (nodes: XiuweiId[]) => {
    const t = calm(nodes);
    const pl = t.players[0];
    pl.weapons = [];
    pl.iframes = 1e12;
    for (let i = 0; i < 9; i++) {
      const x = spawnEnemy(t, 'soldier', pl.x + 60 + (i % 3) * 12, pl.y + Math.floor(i / 3) * 12, []);
      x.hp = x.maxHp = 500;
      x.speed = 0;
    }
    for (let i = 0; i < 60 * 6; i++) for (const ev2 of step(t, [idle])) if (ev2.t === 'wrap') return ev2.dur;
    assert.fail('混天绫没缠');
  };
  const d0 = wrapDur([]);
  assert.ok(Math.abs(wrapDur(pathTo('yushou')) - d0 * 1.12) < 1e-9);
  assert.ok(Math.abs(wrapDur(pathTo('wanling')) - d0 * 1.27) < 1e-9);
  // 冷却：同一帧里多走 dt × 0.15
  const cdAfter = (nodes: XiuweiId[]) => {
    const t = calm(nodes);
    const p = t.players[0];
    p.pet.cd = 2;
    updatePet(t, p, DT, []);
    return p.pet.cd;
  };
  assert.ok(Math.abs(cdAfter([]) - cdAfter(pathTo('wanling')) - DT * 0.15) < 1e-12);
  // 御灵对哮天犬也管用
  const biteDur = (nodes: XiuweiId[]) => {
    const t = calm(nodes, 9, ['yangjian']);
    const pl = t.players[0];
    pl.weapons = [];
    pl.iframes = 1e12;
    for (let i = 0; i < 9; i++) {
      const x = spawnEnemy(t, 'soldier', pl.x + 50 + (i % 3) * 12, pl.y + Math.floor(i / 3) * 12, []);
      x.hp = x.maxHp = 500;
      x.speed = 0;
    }
    for (let i = 0; i < 60 * 8; i++) for (const ev of step(t, [idle])) if (ev.t === 'bite') return ev.dur;
    assert.fail('哮天犬没咬');
  };
  assert.ok(Math.abs(biteDur(pathTo('yushou')) - biteDur([]) * 1.12) < 1e-9);
});

test('财：生息每波打完另得灵石（随物价涨）；万宝第一次进万宝阁就五格有货；摄灵从更远处吸灵石', () => {
  const t = createWorld(7, 1, { xiuwei: [pathTo('shengxi')] });
  t.wave = 6;
  const l0 = t.players[0].lingshi;
  xiuweiWaveEnd(t);
  assert.equal(t.players[0].lingshi, l0 + Math.round(3 * priceScale(6)));
  // 接在波末：同一个世界去掉生息跑到商店，灵石正好少那么多
  const a = createWorld(7, 1, { xiuwei: [pathTo('shengxi')] });
  const b = createWorld(7, 1, { xiuwei: [pathTo('shengxi')] });
  delete b.players[0].boon!.interest;
  for (let i = 0; i < 60 * 60 && a.phase !== 'shop'; i++) {
    const ia = a.players.map((_, j) => botInput(a, j));
    step(a, ia);
    step(b, ia);
  }
  assert.equal(a.phase, 'shop');
  assert.equal(a.players[0].lingshi - b.players[0].lingshi, Math.round(3 * priceScale(1)));
  const w = createWorld(5, 1, { xiuwei: [FULL] });
  for (let i = 0; i < 60 * 60 && w.phase !== 'shop'; i++) frame(w);
  assert.equal(w.phase, 'shop');
  assert.equal(w.players[0].shop.length, 5);
  assert.ok(w.players[0].shop.every((o) => o));
  const pull = (nodes: XiuweiId[]) => {
    const u = createWorld(6, 1, { xiuwei: [nodes] });
    u.spawnAcc = -1e12;
    const pl = u.players[0];
    const d = PLAYER.magnetRadius * 1.2;
    u.gems.push({ id: u.nextId++, x: pl.x + d, y: pl.y - 4, px: pl.x + d, py: pl.y - 4, vx: 0, vy: 0, value: 1, pulled: -1 });
    step(u, [idle]);
    return u.gems[0]?.pulled ?? 0;
  };
  assert.equal(pull([]), -1);
  assert.equal(pull(pathTo('sheling')), 0);
});

test('道行：打完一波 2、平定一章 4、每斩 150 只 1、通关 6，再乘劫数的倍率', () => {
  assert.equal(daoReward({ cleared: 0, kills: 20, win: false, jie: 1 }), 0);
  assert.equal(daoReward({ cleared: 3, kills: 190, win: false, jie: 1 }), 3 * DAO.perWave + 1);
  assert.equal(daoReward({ cleared: 8, kills: 800, win: false, jie: 1 }), 16 + 4 + 5);
  assert.equal(daoReward({ cleared: 18, kills: 2200, win: true, jie: 1 }), 36 + 12 + 14 + 6);
  assert.equal(daoReward({ cleared: 18, kills: 2200, win: true, jie: 5 }), Math.round(2.2 * 68)); // 每高一劫道行 +30%（11-12 起）
  assert.equal(daoReward({ cleared: 8, kills: 800, win: false, jie: 3 }), Math.round(25 * 1.6));
  assert.equal(daoReward({ cleared: 99, kills: -5, win: false, jie: 9 }), Math.round((36 + 12) * 2.2));
  const b = daoBreakdown({ cleared: 13, kills: 1000, win: false, jie: 2 });
  assert.deepEqual(b, { cleared: 13, chapters: 2, kills: 1000, base: 26 + 8 + 6, mul: 1.3, total: 52 });
  const w = createWorld(1);
  w.wave = 4;
  w.phase = 'wave';
  assert.equal(wavesCleared(w), 3);
  w.phase = 'over';
  assert.equal(wavesCleared(w), 3);
  w.phase = 'collect';
  assert.equal(wavesCleared(w), 4);
  w.phase = 'shop';
  assert.equal(wavesCleared(w), 4);
  w.phase = 'win';
  assert.equal(wavesCleared(w), 18);
});

test('带修为的世界存档能存能恢复，恢复后接着跑逐帧一样（两套点满都试；boon、多出来的货架格子都在存档里）', () => {
  for (const set of [FULL, ALT]) {
    const w = createWorld(17, 1, { xiuwei: [set] });
    for (let i = 0; i < 60 * 40; i++) frame(w);
    const b = restore(JSON.parse(JSON.stringify(snapshot(w))));
    assert.deepEqual(b.players[0].boon, w.players[0].boon);
    assert.equal(b.players[0].shop.length, w.players[0].shop.length);
    for (let i = 0; i < 60 * 30; i++) {
      const ea = JSON.stringify(frame(w));
      const eb = JSON.stringify(frame(b));
      if (ea !== eb || digest(w) !== digest(b)) assert.fail(`恢复后第 ${i + 1} 帧跑岔了`);
    }
    assert.equal(canonicalText(b), canonicalText(w));
  }
});

test('开局设定里角色、劫数、修为一起给；只给一串角色和给 { heroes } 一样', () => {
  assert.equal(canonicalText(createWorld(4, 2, ['yangjian', 'nezha'])), canonicalText(createWorld(4, 2, { heroes: ['yangjian', 'nezha'] })));
  const w = createWorld(4, 2, { heroes: ['yangjian'], jie: 4, xiuwei: [undefined, ['wendao']] });
  assert.deepEqual(
    w.players.map((p) => p.hero),
    ['yangjian', 'nezha'],
  );
  assert.equal(w.jie, 4);
  assert.equal(w.players[1].stats.maxHp, w.players[0].stats.maxHp + 8);
});
