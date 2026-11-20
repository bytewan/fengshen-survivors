// 再加的 11 件公共法宝（arti2 分支，模拟在 sim/arti2.ts）的测试：每件凡品能出手、灵品量变、仙品质变、神品两个器灵各自生效、
// 首领不吃控制、射程守 REACH，以及整局里同种子同输入完全确定、快照存得下。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, ENEMIES, REACH } from './config.ts';
import { COMMON_WEAPONS, WEAPONS } from './catalog.ts';
import { hitMul2, TUNE2 } from './arti2.ts';
import { botInput, botShop } from './bot.ts';
import { buildGrid, hitEnemy } from './core.ts';
import { restore, snapshot } from './snapshot.ts';
import type { EnemyKindName, WeaponKind, Zone } from './types.ts';

/** 这一批（做完一件加一件）。 */
const NEW2: WeaponKind[] = ['xiangmo', 'wuguang', 'zanxin', 'jinjiao', 'yanguang', 'wanya', 'sihai', 'wulu', 'miaoshu', 'wenhuang', 'luobao'];
const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 干净的测试场：普通波、刷怪关掉、宠物不出手、人物无敌。 */
const arena = (seed: number, weapons: { kind: WeaponKind; tier: number; spirit?: string | null }[] = []) => {
  const w = createWorld(seed);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = weapons.map((x) => ({ kind: x.kind, tier: x.tier, spirit: x.spirit ?? null, cd: 0 }));
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  return { w, p };
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 9999, speed = 0) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = speed;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
const hitsOn = (ev: SimEvent[], id: number, by?: string) => ev.filter((e) => e.t === 'hit' && e.id === id && (!by || e.by === by));
const dealt = (ev: SimEvent[], by?: string) => ev.reduce((a, e) => a + (e.t === 'hit' && (!by || e.by === by) ? e.dmg : 0), 0);
const zonesOf = (w: World, kind: Zone['kind']) => w.zones.filter((z) => z.kind === kind);
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);

// ---------- 图鉴 ----------

test('图鉴：再加的几件都有名字、五行、价格、冷却 ≥ 1.2 秒、伤害、说明、三个品阶的说明和两个器灵；都是公共法宝', () => {
  for (const k of NEW2) {
    const d = WEAPONS[k];
    assert.ok(d.name && d.desc && d.price > 0 && d.dmg > 0, k);
    assert.ok(d.cd >= 1.2, `${k} 冷却 ${d.cd}`);
    assert.equal(d.mul.length, 5, `${k} 各品阶倍率`);
    assert.ok(d.tiers[1] && d.tiers[2] && d.tiers[3], `${k} 品阶说明`);
    assert.equal(d.spirits.length, 2);
    for (const s of d.spirits) assert.ok(s.id && s.name && s.desc, `${k} 器灵`);
    assert.ok(!d.exclusive && COMMON_WEAPONS.includes(k), `${k} 是公共法宝`);
  }
  const names = new Set(Object.values(WEAPONS).map((d) => d.name));
  assert.equal(names.size, Object.keys(WEAPONS).length, '法宝不重名');
});

// ---------- 降魔杵 ----------

/** 降魔杵：第一下砸到离人物 d 远的那只要多久；一串 n 下（每下最远弹 hop）最多要多久。 */
const firstT = (d: number) => TUNE2.xiangmo.fall + d / TUNE2.xiangmo.speed + 0.05;
const chainT = (n: number) => firstT(REACH.seek) + (n - 1) * (TUNE2.xiangmo.gap + TUNE2.xiangmo.hop / TUNE2.xiangmo.speed) + 0.1;

test('降魔杵：先在最近的一只头上预警、跟着它砸下；砸完弹向下一只，一串三下，砸中的晕眩、震开', () => {
  const { w, p } = arena(201, [{ kind: 'xiangmo', tier: 1 }]);
  const a = enemy(w, 'soldier', p.x + 40, p.y, 9999);
  const b = enemy(w, 'soldier', p.x + 90, p.y + 10, 9999);
  const c = enemy(w, 'soldier', p.x + 60, p.y + 60, 9999);
  const ev0 = run(w, 0.05);
  const warn = evs(ev0, 'warn').find((e) => e.kind === 'pestle');
  assert.ok(warn && warn.tier === 1, '先预警');
  assert.ok(w.pending.some((q) => q.kind === 'pestle' && q.target === a.id && q.seq === 1 && q.n === 3), '先砸最近的那只，一串三下');
  const X = TUNE2.xiangmo;
  const ev = run(w, chainT(3));
  const lands = evs(ev, 'land').filter((e) => e.kind === 'pestle');
  assert.equal(lands.length, 3, '一串砸三下');
  for (const e of [a, b, c]) assert.ok(hitsOn(ev, e.id, 'pestle').length >= 1, `三只都挨了一下（${e.id}）`);
  assert.ok(w.pending.every((q) => q.kind !== 'pestle'), '砸完收起来');
  // 晕眩：刚砸完那一下的那只晕着
  const { w: w2, p: p2 } = arena(202, [{ kind: 'xiangmo', tier: 1 }]);
  const t = enemy(w2, 'soldier', p2.x + 50, p2.y, 9999);
  run(w2, firstT(50));
  assert.ok(t.stun > 0.3, `晕了（${t.stun.toFixed(2)}）`);
});

test('降魔杵：身边只有一只时一串都砸它；弹向的下一只离落点不超过 hop、离人物不超过 REACH.max', () => {
  const { w, p } = arena(203, [{ kind: 'xiangmo', tier: 1 }]);
  p.stats.crit = 0;
  const only = enemy(w, 'soldier', p.x + 50, p.y, 99999);
  const X = TUNE2.xiangmo;
  const ev = run(w, chainT(3));
  assert.equal(hitsOn(ev, only.id, 'pestle').length, 3, '三下都砸它');
  // 远处（离人物 REACH.max 以外）的不弹过去
  const b = arena(204, [{ kind: 'xiangmo', tier: 1 }]);
  const near = enemy(b.w, 'soldier', b.p.x + 120, b.p.y, 99999);
  const far = enemy(b.w, 'soldier', b.p.x + 120 + 40, b.p.y, 99999); // 离落点 40（在 hop 里），但离人物 160
  const ev2 = run(b.w, chainT(3));
  assert.ok(hitsOn(ev2, near.id, 'pestle').length >= 1);
  assert.ok(Math.hypot(far.x - b.p.x, far.y - b.p.y) > REACH.max);
  assert.equal(hitsOn(ev2, far.id, 'pestle').length, 0, '不弹向离人物 REACH.max 以外的那只');
});

test('降魔杵灵品：一串四下、晕得更久', () => {
  const X = TUNE2.xiangmo;
  assert.ok(X.slams[2] === 4 && X.stun[2] > X.stun[1]);
  const { w, p } = arena(205, [{ kind: 'xiangmo', tier: 2 }]);
  for (let i = 0; i < 4; i++) enemy(w, 'soldier', p.x + 40 + i * 22, p.y + (i % 2) * 14, 9999);
  const ev = run(w, chainT(4));
  assert.equal(evs(ev, 'land').filter((e) => e.kind === 'pestle').length, 4);
});

test('降魔杵仙品「降魔印」：每一砸在地上留一枚印，走上去的敌人被镇住一次（首领不吃）', () => {
  const X = TUNE2.xiangmo;
  const { w, p } = arena(206, [{ kind: 'xiangmo', tier: 3 }]);
  enemy(w, 'soldier', p.x + 50, p.y, 9999);
  run(w, firstT(50));
  const seals = zonesOf(w, 'vajra');
  assert.ok(seals.length >= 1, '留下降魔印');
  const s = seals[0];
  // 一只兵走上这枚印：被镇住；之后在印上也不再被镇（每只每枚只镇一次）
  p.weapons = [];
  w.pending = []; // 后面几下不砸了：只看印
  const walker = enemy(w, 'soldier', s.x + 30, s.y, 9999, 30); // 在印的另一边，朝人物走、正好踩过这枚印
  let rooted = 0;
  for (let i = 0; i < 90; i++) {
    run(w, DT);
    if (walker.stun > 0.3) rooted++;
  }
  assert.ok(rooted > 0, '走上印的被镇住');
  assert.ok(s.hit?.includes(walker.id));
  const boss = enemy(w, 'boss', s.x, s.y, 1e7);
  run(w, 0.3);
  assert.equal(boss.stun, 0, '首领不吃');
  // 凡 / 灵不留印
  const b = arena(207, [{ kind: 'xiangmo', tier: 2 }]);
  enemy(b.w, 'soldier', b.p.x + 50, b.p.y, 9999);
  run(b.w, firstT(50));
  assert.equal(zonesOf(b.w, 'vajra').length, 0);
});

test('降魔杵神品：「韦陀」两根杵各砸一串；「泰山」每一砸更重、最后一下砸出一大圈', () => {
  const X = TUNE2.xiangmo;
  const { w, p } = arena(208, [{ kind: 'xiangmo', tier: 4, spirit: 'weituo' }]);
  for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x + 30 + (i % 3) * 40, p.y - 30 + Math.floor(i / 3) * 60, 9999);
  const ev = run(w, 0.05);
  const firsts = evs(ev, 'warn').filter((e) => e.kind === 'pestle');
  assert.equal(firsts.length, 2, '两根杵');
  const chains = new Set(w.pending.filter((q) => q.kind === 'pestle').map((q) => q.chain));
  assert.equal(chains.size, 2, '各砸一串');
  // 泰山：最后一下的半径更大 —— 离最后落点在 r 和 r × lastR 之间的敌人只在最后一下挨打
  const b = arena(209, [{ kind: 'xiangmo', tier: 4, spirit: 'taishan' }]);
  b.p.stats.crit = 0;
  const t = enemy(b.w, 'soldier', b.p.x + 50, b.p.y, 99999);
  const r = X.r[4];
  const ring = enemy(b.w, 'shieldbearer', b.p.x + 50 + r * 1.5, b.p.y, 99999); // 最后一下才够得着
  ring.face = Math.PI; // 盾朝右（背对落点）：不挡
  const ev2 = run(b.w, chainT(4));
  const ls = evs(ev2, 'land').filter((e) => e.kind === 'pestle');
  assert.equal(ls.length, 4);
  assert.ok(hitsOn(ev2, t.id, 'pestle').length >= 3);
  // 盾卫离第一只 r×1.5：只有最后一下（半径 ×lastR）够得着它 —— 除非它被弹成了目标（离落点 hop 以内会被挑中）
  assert.ok(hitsOn(ev2, ring.id, 'pestle').length >= 1, '最后一下的大圈打到更远的');
  // 泰山每一砸更重：同一只、同品阶，泰山的第一下 > 韦陀的第一下
  const c = arena(210, [{ kind: 'xiangmo', tier: 4, spirit: 'weituo' }]);
  c.p.stats.crit = 0;
  const t2 = enemy(c.w, 'soldier', c.p.x + 50, c.p.y, 99999);
  const ev3 = run(c.w, firstT(50));
  const h1 = hitsOn(ev2, t.id, 'pestle')[0];
  const h2 = hitsOn(ev3, t2.id, 'pestle')[0];
  assert.ok(h1 && h2 && h1.t === 'hit' && h2.t === 'hit' && h1.dmg > h2.dmg, '泰山更重');
});

test('降魔杵：首领在索敌半径里先砸首领；首领不晕', () => {
  const { w, p } = arena(211, [{ kind: 'xiangmo', tier: 2 }]);
  enemy(w, 'soldier', p.x + 30, p.y, 9999);
  const boss = enemy(w, 'boss', p.x + 100, p.y, 1e7);
  run(w, 0.05);
  assert.ok(w.pending.some((q) => q.kind === 'pestle' && q.target === boss.id), '先砸首领');
  run(w, firstT(100));
  assert.equal(boss.stun, 0);
});

// ---------- 五光石 ----------

const stonesOf = (w: World) => w.knives.filter((k) => k.kind === 'wuguang' && !k.shard);

test('五光石：朝最近的敌人扇形掷出三枚五色石，直飞、打中第一只就碎：伤害 + 晕眩；不穿过去打后面那只', () => {
  const S = TUNE2.wuguang;
  const { w, p } = arena(221, [{ kind: 'wuguang', tier: 1 }]);
  const front = enemy(w, 'soldier', p.x + 40, p.y, 9999);
  const back = enemy(w, 'soldier', p.x + 70, p.y, 9999); // 正后面
  run(w, 0.02);
  assert.equal(stonesOf(w).length, 3, '三枚');
  assert.deepEqual(stonesOf(w).map((k) => k.color), [0, 1, 2], '青赤黄');
  const ev = run(w, 0.4);
  const hf = hitsOn(ev, front.id, 'stone');
  assert.ok(hf.length >= 1, '打中前面那只');
  assert.ok(front.stun > 0, '晕了');
  assert.equal(hitsOn(ev, back.id, 'stone').length, 0, '中间那枚碎在前面那只身上，不穿过去');
  // 石子最远飞到 range（离人物 REACH.max 以内），没打中就落地
  const b = arena(222, [{ kind: 'wuguang', tier: 1 }]);
  enemy(b.w, 'soldier', b.p.x + 100, b.p.y + 60, 9999); // 只有一只，偏在一边：中间那枚打中，两边的飞空
  let far = 0;
  for (let i = 0; i < 60; i++) {
    run(b.w, DT);
    for (const k of stonesOf(b.w)) far = Math.max(far, Math.hypot(k.x - b.p.x, k.y - b.p.y));
  }
  assert.ok(far > 60 && far <= REACH.max + 1, `最远 ${far.toFixed(0)}`);
  assert.equal(stonesOf(b.w).length, 0, '飞到头就没了');
  assert.ok(S.range <= REACH.max);
});

test('五光石灵品：一次五枚（青赤黄白黑），扇面更宽', () => {
  const S = TUNE2.wuguang;
  assert.ok(S.n[2] === 5 && S.fan[2] * 4 > S.fan[1] * 2, '五枚、扇面更宽');
  const { w, p } = arena(223, [{ kind: 'wuguang', tier: 2 }]);
  enemy(w, 'soldier', p.x + 60, p.y, 9999);
  run(w, 0.02);
  assert.deepEqual(stonesOf(w).map((k) => k.color), [0, 1, 2, 3, 4]);
});

test('五光石仙品「五光」：打中后碎成五色光，弹向身边两只（离这只 hop 以内）；凡 / 灵不碎', () => {
  const S = TUNE2.wuguang;
  const { w, p } = arena(224, [{ kind: 'wuguang', tier: 3 }]);
  const t = enemy(w, 'soldier', p.x + 40, p.y, 9999);
  const n1 = enemy(w, 'soldier', p.x + 40, p.y + 30, 9999);
  const n2 = enemy(w, 'soldier', p.x + 40, p.y - 30, 9999);
  const far = enemy(w, 'soldier', p.x + 40, p.y + 30 + S.shard.hop + 12, 9999); // 离谁都比 hop 远
  w.enemies.forEach((e) => (e.speed = 0));
  const ev = run(w, 0.7);
  assert.ok(hitsOn(ev, t.id, 'stone').length >= 1);
  assert.ok(w.knives.length === 0 || w.knives.every((k) => k.kind === 'wuguang'));
  assert.ok(hitsOn(ev, n1.id, 'stone').length >= 1 && hitsOn(ev, n2.id, 'stone').length >= 1, '弹到身边两只');
  assert.equal(hitsOn(ev, far.id, 'stone').length, 0, '太远的弹不到');
  const b = arena(225, [{ kind: 'wuguang', tier: 2 }]);
  enemy(b.w, 'soldier', b.p.x + 40, b.p.y, 9999);
  let shards = 0;
  for (let i = 0; i < 40; i++) {
    run(b.w, DT);
    shards += b.w.knives.filter((k) => k.shard).length;
  }
  assert.equal(shards, 0, '灵品不碎');
});

test('五光石神品：「连珠」掷完一轮紧接着再掷一轮；「破面」晕得更久、对精英更痛', () => {
  const S = TUNE2.wuguang;
  const { w, p } = arena(226, [{ kind: 'wuguang', tier: 4, spirit: 'beads' }]);
  enemy(w, 'soldier', p.x + 80, p.y, 9999);
  const ev = run(w, S.beads + 0.05);
  assert.equal(evs(ev, 'throw').filter((e) => e.kind === 'wuguang').length, 2, '两轮');
  const a = arena(227, [{ kind: 'wuguang', tier: 4, spirit: 'face' }]);
  a.p.stats.crit = 0;
  const el = enemy(a.w, 'elite', a.p.x + 40, a.p.y, 99999);
  const evA = run(a.w, 0.4);
  const c = arena(227, [{ kind: 'wuguang', tier: 4, spirit: 'beads' }]);
  c.p.stats.crit = 0;
  const el2 = enemy(c.w, 'elite', c.p.x + 40, c.p.y, 99999);
  const evC = run(c.w, 0.2);
  const ha = hitsOn(evA, el.id, 'stone')[0];
  const hc = hitsOn(evC, el2.id, 'stone')[0];
  assert.ok(ha?.t === 'hit' && hc?.t === 'hit' && ha.dmg > hc.dmg, '破面对精英更痛');
  const s1 = arena(228, [{ kind: 'wuguang', tier: 4, spirit: 'face' }]);
  const t1 = enemy(s1.w, 'soldier', s1.p.x + 40, s1.p.y, 99999);
  run(s1.w, 0.3);
  assert.ok(t1.stun > S.stun[4] + 0.1, `晕得更久（${t1.stun.toFixed(2)}）`);
});

test('五光石：首领在索敌半径里朝首领掷；首领不晕', () => {
  const { w, p } = arena(229, [{ kind: 'wuguang', tier: 2 }]);
  enemy(w, 'soldier', p.x - 30, p.y, 9999);
  const boss = enemy(w, 'boss', p.x + 90, p.y, 1e7);
  const ev = run(w, 0.8);
  assert.ok(hitsOn(ev, boss.id, 'stone').length >= 1, '朝首领掷');
  assert.equal(boss.stun, 0);
});

// ---------- 攒心钉 ----------

test('攒心钉：朝最近的敌人连发金钉（凡品四枚；只有一只时一轮只钉两枚），钉子留在身上：每枚让它受到的伤害 +5%（谁打都算），最多 5 枚，几秒后掉了', () => {
  const Z = TUNE2.zanxin;
  const { w, p } = arena(241, [{ kind: 'zanxin', tier: 1 }]);
  p.stats.crit = 0;
  const e = enemy(w, 'soldier', p.x + 50, p.y, 99999);
  const ev = run(w, 0.6);
  assert.equal(hitsOn(ev, e.id, 'nail').length, Z.cap[1], '只有一只：一轮两枚');
  run(w, Z.n[1] * Z.gap + 1.2); // 再来一轮
  assert.equal(e.nails, 2 * Z.cap[1] > Z.max[1] ? Z.max[1] : 2 * Z.cap[1]);
  e.nails = 3;
  // 谁打都算：再打它一下（别的伤害来源），伤害按 1 + 0.05 × 3 放大
  p.weapons = [];
  const base = 100;
  const ev2: SimEvent[] = [];
  buildGrid(w.enemies);
  hitEnemy(w, e, { dmg: base, by: 'skill', owner: 0, from: p, canCrit: false }, ev2);
  const got = ev2.find((x) => x.t === 'hit' && x.id === e.id);
  assert.ok(got && got.t === 'hit' && Math.abs(got.dmg - base * (1 + Z.per * 3)) <= 1, `受伤 +15%（${got && got.t === 'hit' && got.dmg}）`);
  // 最多 5 枚
  const b = arena(242, [{ kind: 'zanxin', tier: 1 }]);
  const t = enemy(b.w, 'soldier', b.p.x + 50, b.p.y, 99999);
  run(b.w, 4);
  assert.equal(t.nails, Z.max[1], '最多 5 枚');
  // 不再钉：几秒后掉了
  b.p.weapons = [];
  run(b.w, Z.t + 0.2);
  assert.equal(t.nails, 0, '到时掉了');
});

test('攒心钉：一轮的几枚一枚一只，先钉身上已经有钉的；灵品连发五枚、最多 6 枚；同一只一轮最多挨三枚', () => {
  const Z = TUNE2.zanxin;
  const { w, p } = arena(243, [{ kind: 'zanxin', tier: 2 }]);
  const near = enemy(w, 'soldier', p.x + 30, p.y, 99999);
  const nailed = enemy(w, 'soldier', p.x + 80, p.y, 99999);
  nailed.nails = 2;
  nailed.nailT = 3;
  run(w, 0.02);
  assert.equal(w.knives.find((k) => k.kind === 'zanxin')?.target, nailed.id, '第一枚先钉已经有钉的那只');
  const ev = run(w, 0.9);
  const a = hitsOn(ev, nailed.id, 'nail').length;
  const b = hitsOn(ev, near.id, 'nail').length;
  assert.ok(a >= b && a + b === Z.n[2], `五枚分给两只（${a} / ${b}）`);
  // 一群里：五枚钉五只
  const c = arena(248, [{ kind: 'zanxin', tier: 2 }]);
  const es = Array.from({ length: 6 }, (_, i) => enemy(c.w, 'soldier', c.p.x + 40 + i * 12, c.p.y + (i % 2) * 10, 99999));
  const evC = run(c.w, 0.9);
  assert.equal(es.filter((e) => hitsOn(evC, e.id, 'nail').length === 1).length, Z.n[2], '一枚一只');
  // 只有一只：一轮只发三枚
  const d = arena(249, [{ kind: 'zanxin', tier: 2 }]);
  const solo = enemy(d.w, 'soldier', d.p.x + 50, d.p.y, 99999);
  const evD = run(d.w, 0.9);
  assert.equal(hitsOn(evD, solo.id, 'nail').length, Z.cap[2]);
});

test('攒心钉仙品「攒心」：钉满时一齐钻心（一记重伤，钉子用掉）；凡 / 灵钉满了不钻心', () => {
  const { w, p } = arena(244, [{ kind: 'zanxin', tier: 3 }]);
  p.stats.crit = 0;
  const e = enemy(w, 'soldier', p.x + 50, p.y, 99999);
  const ev = run(w, 4);
  const drills = evs(ev, 'arti2').filter((x) => x.kind === 'zanxin' && x.act === 'drill');
  assert.ok(drills.length >= 1, '钻心了');
  assert.ok((drills[0].v ?? 0) === TUNE2.zanxin.max[3]);
  const hs = hitsOn(ev, e.id, 'nail').map((h) => (h.t === 'hit' ? h.dmg : 0));
  assert.ok(Math.max(...hs) > 3 * Math.min(...hs), '钻心那一下比一枚钉重得多');
  const b = arena(245, [{ kind: 'zanxin', tier: 2 }]);
  enemy(b.w, 'soldier', b.p.x + 50, b.p.y, 99999);
  const evB = run(b.w, 4);
  assert.equal(evs(evB, 'arti2').length, 0);
});

test('攒心钉神品：「七星」一次七枚、分钉三只；「透骨」钉子透过去再钉后面一只，钻心时溅血', () => {
  const { w, p } = arena(246, [{ kind: 'zanxin', tier: 4, spirit: 'seven' }]);
  const es = [enemy(w, 'soldier', p.x + 40, p.y - 20, 99999), enemy(w, 'soldier', p.x + 50, p.y + 10, 99999), enemy(w, 'soldier', p.x + 60, p.y + 40, 99999)];
  const ev = run(w, 1.2);
  const n = es.map((e) => hitsOn(ev, e.id, 'nail').length);
  assert.ok(n.every((x) => x >= 2), `三只都钉了（${n.join(',')}）`);
  assert.equal(n.reduce((a, b) => a + b, 0), TUNE2.zanxin.seven.n, '一共七枚');
  const b = arena(247, [{ kind: 'zanxin', tier: 4, spirit: 'bone' }]);
  const front = enemy(b.w, 'soldier', b.p.x + 40, b.p.y, 99999);
  const back = enemy(b.w, 'soldier', b.p.x + 64, b.p.y, 99999);
  const evB = run(b.w, 0.8);
  assert.ok(hitsOn(evB, front.id, 'nail').length >= 1 && hitsOn(evB, back.id, 'nail').length >= 1, '透过去再钉后面那只');
  run(b.w, 4);
  assert.ok(front.bleedT > 0 || back.bleedT > 0, '钻心时溅血');
});

// ---------- 金蛟剪 ----------

test('金蛟剪：两条金蛟绕身盘旋一阵（跟着人走），碰到的被咬（同一只隔一会儿才再咬），圈外的轮流扑出去咬；盘完收起、歇一会儿再放', () => {
  const J = TUNE2.jinjiao;
  const { w, p } = arena(261, [{ kind: 'jinjiao', tier: 1 }]);
  const e = enemy(w, 'soldier', p.x + J.r[1], p.y, 99999); // 正好在绕身的圈上
  const far = enemy(w, 'soldier', p.x + 90, p.y, 99999); // 圈外
  const ev = run(w, 1.5);
  const z = zonesOf(w, 'orbit')[0];
  assert.ok(z && z.n === 2 && z.tier === 1, '一阵两条');
  const bites = hitsOn(ev, e.id, 'jiao');
  assert.ok(bites.length >= 2, `圈上的那只被咬了 ${bites.length} 口`);
  assert.ok(evs(ev, 'arti2').filter((x) => x.act === 'bite' && x.id === far.id).length >= 1 || hitsOn(ev, far.id, 'jiao').length >= 1, '圈外的那只：金蛟扑出去咬');
  // 跟着人走
  p.x += 30;
  run(w, 0.05);
  assert.ok(Math.abs(zonesOf(w, 'orbit')[0].x - p.x) < 1, '跟着人走');
  // 盘完收起，歇一会儿再放
  let gone = false;
  let again = false;
  for (let i = 0; i < Math.round(6 / DT); i++) {
    run(w, DT);
    const n = zonesOf(w, 'orbit').length;
    if (!n) gone = true;
    else if (gone) again = true;
  }
  assert.ok(gone && again, '盘完收起，歇一会儿再放');
});

test('金蛟剪灵品：盘得更大、更快、更久', () => {
  const J = TUNE2.jinjiao;
  assert.ok(J.r[2] > J.r[1] && J.spin[2] > J.spin[1] && J.life[2] > J.life[1]);
});

test('金蛟剪仙品「交剪」：盘旋中隔一会儿扑向最近的敌人交错一剪（重击）；凡 / 灵不扑', () => {
  const J = TUNE2.jinjiao;
  const { w, p } = arena(262, [{ kind: 'jinjiao', tier: 3 }]);
  p.stats.crit = 0;
  const e = enemy(w, 'soldier', p.x + 80, p.y, 99999); // 圈外，扑得到
  const ev = run(w, J.lunge.every * J.snip.nth + 0.6);
  const darts = evs(ev, 'arti2').filter((x) => x.kind === 'jinjiao' && x.act === 'dart');
  const snips = evs(ev, 'arti2').filter((x) => x.kind === 'jinjiao' && x.act === 'snip');
  assert.ok(darts.length >= 1 && snips.length >= 1, '扑出去、剪');
  assert.ok(hitsOn(ev, e.id, 'jiao').length >= 1, '剪中');
  const b = arena(263, [{ kind: 'jinjiao', tier: 2 }]);
  enemy(b.w, 'soldier', b.p.x + 80, b.p.y, 99999);
  const evB = run(b.w, 3);
  const acts = new Set(evs(evB, 'arti2').map((x) => x.act));
  assert.ok(!acts.has('dart') && !acts.has('snip'), '灵品不交剪');
  assert.ok(acts.has('lunge') && acts.has('bite'), '灵品是一条一条扑出去咬');
});

test('金蛟剪神品：「四蛟」四条、两把剪各剪一只；「绞龙」剪完缠住它（定身，首领只受伤）', () => {
  const J = TUNE2.jinjiao;
  const { w, p } = arena(264, [{ kind: 'jinjiao', tier: 4, spirit: 'four' }]);
  const a = enemy(w, 'soldier', p.x + 70, p.y - 20, 99999);
  const b = enemy(w, 'soldier', p.x - 70, p.y + 20, 99999);
  const ev = run(w, J.lunge.every * J.snip.nth + 0.6);
  assert.equal(zonesOf(w, 'orbit')[0]?.n, 4, '四条');
  const snips = evs(ev, 'arti2').filter((x) => x.kind === 'jinjiao' && x.act === 'snip');
  assert.ok(new Set(snips.map((x) => x.id)).size >= 2 && snips.some((x) => x.id === a.id) && snips.some((x) => x.id === b.id), '两把剪各剪一只');
  const c = arena(265, [{ kind: 'jinjiao', tier: 4, spirit: 'coil' }]);
  const t = enemy(c.w, 'soldier', c.p.x + 70, c.p.y, 99999);
  let rooted = false;
  for (let i = 0; i < Math.round((J.lunge.every * J.snip.nth + 1) / DT); i++) {
    run(c.w, DT);
    if ((zonesOf(c.w, 'orbit')[0]?.coil ?? 0) > 0 && t.stun > 0) rooted = true;
  }
  assert.ok(rooted, '缠住、定身');
  const d = arena(266, [{ kind: 'jinjiao', tier: 4, spirit: 'coil' }]);
  const boss = enemy(d.w, 'boss', d.p.x + 70, d.p.y, 1e7);
  run(d.w, J.lunge.every * J.snip.nth + 1);
  assert.equal(boss.stun, 0, '首领不吃定身');
});

// ---------- 离地焰光旗 ----------

test('离地焰光旗：插在人物和敌群之间，旗边的敌人脚下先亮、再窜起地火（点燃）；人走远了旗跟过去重插；插满了收起', () => {
  const Y = TUNE2.yanguang;
  const { w, p } = arena(281, [{ kind: 'yanguang', tier: 1 }]);
  const e = enemy(w, 'soldier', p.x + 70, p.y, 99999);
  run(w, 0.05);
  const z = zonesOf(w, 'banner')[0];
  assert.ok(z, '插旗');
  assert.ok(z.x > p.x + 10 && z.x < e.x, `插在人物和敌人之间（${(z.x - p.x).toFixed(0)}）`);
  const ev = run(w, 1.5);
  assert.ok(evs(ev, 'warn').some((x) => x.kind === 'geyser'), '先亮');
  const hs = hitsOn(ev, e.id, 'geyser');
  assert.ok(hs.length >= 1, '地火窜起来烧到');
  assert.ok(e.burnT > 0, '点燃');
  // 人走远了：旗跟过去
  p.x += 150;
  p.px = p.x;
  enemy(w, 'soldier', p.x + 60, p.y, 99999);
  const ev2 = run(w, 0.3);
  assert.ok(evs(ev2, 'arti2').some((x) => x.kind === 'yanguang' && x.act === 'hop'), '旗跟过去重插');
  assert.ok(Math.hypot(zonesOf(w, 'banner')[0].x - p.x, zonesOf(w, 'banner')[0].y - p.y) < Y.follow);
  const id0 = zonesOf(w, 'banner')[0].id;
  run(w, Y.life[1]);
  assert.ok(!w.zones.some((b) => b.id === id0), '插满了收起');
});

test('离地焰光旗灵品：管得更远、一次窜两道（旗边只有一只时第二道也窜它）', () => {
  const Y = TUNE2.yanguang;
  assert.ok(Y.R[2] > Y.R[1] && Y.n[2] === 2);
  const { w, p } = arena(282, [{ kind: 'yanguang', tier: 2 }]);
  enemy(w, 'soldier', p.x + 60, p.y - 15, 99999);
  enemy(w, 'soldier', p.x + 60, p.y + 25, 99999);
  const ev = run(w, 0.5);
  assert.ok(evs(ev, 'warn').filter((x) => x.kind === 'geyser').length >= 2, '一次两道');
});

test('离地焰光旗仙品「焰光」：地火一路窜到下一只（连窜三只）；神品南离两面旗、焚城留火海', () => {
  const { w, p } = arena(283, [{ kind: 'yanguang', tier: 3 }]);
  const a = enemy(w, 'soldier', p.x + 55, p.y, 99999);
  const b = enemy(w, 'soldier', p.x + 85, p.y + 10, 99999);
  const c = enemy(w, 'soldier', p.x + 115, p.y + 20, 99999);
  w.enemies.forEach((e) => (e.speed = 0));
  const ev = run(w, 2);
  for (const e of [a, b, c]) assert.ok(hitsOn(ev, e.id, 'geyser').length >= 1, `窜到了 ${e.id}`);
  const twin = arena(284, [{ kind: 'yanguang', tier: 4, spirit: 'twin' }]);
  enemy(twin.w, 'soldier', twin.p.x + 60, twin.p.y, 99999);
  enemy(twin.w, 'soldier', twin.p.x - 60, twin.p.y, 99999);
  run(twin.w, 0.05);
  assert.equal(zonesOf(twin.w, 'banner').length, 2, '南离两面旗');
  const bl = arena(285, [{ kind: 'yanguang', tier: 4, spirit: 'blaze' }]);
  enemy(bl.w, 'soldier', bl.p.x + 60, bl.p.y, 99999);
  run(bl.w, 1.2);
  assert.ok(zonesOf(bl.w, 'blaze').length >= 1, '焚城留下火海');
});

// ---------- 万鸦壶 ----------

test('万鸦壶：一群火鸦扑到敌人最密处，在上空盘旋、一只接一只俯冲啄烧（点燃），跟着敌群挪；盘完散了', () => {
  const A = TUNE2.wanya;
  const { w, p } = arena(301, [{ kind: 'wanya', tier: 1 }]);
  const pack = [enemy(w, 'soldier', p.x + 80, p.y, 99999), enemy(w, 'soldier', p.x + 88, p.y + 8, 99999), enemy(w, 'soldier', p.x + 84, p.y - 8, 99999)];
  enemy(w, 'soldier', p.x - 60, p.y, 99999);
  run(w, 0.05);
  const z = zonesOf(w, 'crows')[0];
  assert.ok(z && z.n === A.n[1] && Math.hypot(z.x - pack[0].x, z.y - pack[0].y) < 20, '扑到最密那群');
  const ev = run(w, 2);
  const pecks = pack.reduce((a, e) => a + hitsOn(ev, e.id, 'crow').length, 0);
  assert.ok(pecks >= 4, `啄了 ${pecks} 口`);
  assert.ok(pack.some((e) => e.burnT > 0), '点燃');
  // 跟着挪：敌群走开一点，鸦群跟过去
  for (const e of pack) e.x += 20;
  const x0 = zonesOf(w, 'crows')[0].x;
  run(w, 0.5);
  assert.ok(zonesOf(w, 'crows')[0].x > x0 + 4, '跟着敌群挪');
  run(w, A.life[1]);
  assert.ok(!w.zones.some((q) => q.id === z.id), '盘完散了');
});

test('万鸦壶灵品：八只、盘得更久；仙品「火鸦」盘完一齐扑下自焚（炸开）；凡 / 灵不自焚', () => {
  const A = TUNE2.wanya;
  assert.ok(A.n[2] === 8 && A.life[2] > A.life[1]);
  const { w, p } = arena(302, [{ kind: 'wanya', tier: 3 }]);
  enemy(w, 'soldier', p.x + 80, p.y, 99999);
  enemy(w, 'soldier', p.x + 86, p.y + 8, 99999);
  const ev = run(w, A.life[3] + 0.6);
  const booms = evs(ev, 'land').filter((x) => x.kind === 'dive' && x.r >= A.boom.r);
  assert.ok(booms.length >= A.n[3], `自焚 ${booms.length} 只`);
  const b = arena(303, [{ kind: 'wanya', tier: 2 }]);
  enemy(b.w, 'soldier', b.p.x + 80, b.p.y, 99999);
  const evB = run(b.w, A.life[2] + 0.6);
  assert.equal(evs(evB, 'land').filter((x) => x.kind === 'dive' && x.r >= A.boom.r).length, 0);
});

test('万鸦壶神品：「遮天」十二只、盘得更大；「金乌」领头一只先扑首领、落下炸开日火（连旁边的一起烧）、比别的鸦重', () => {
  const A = TUNE2.wanya;
  const { w, p } = arena(304, [{ kind: 'wanya', tier: 4, spirit: 'sky' }]);
  enemy(w, 'soldier', p.x + 80, p.y, 99999);
  run(w, 0.05);
  const z = zonesOf(w, 'crows')[0];
  assert.ok(z.n === A.sky.n && z.r > A.r[4] * 1.2, '十二只、更大');
  const b = arena(305, [{ kind: 'wanya', tier: 4, spirit: 'sun' }]);
  b.p.stats.crit = 0;
  const near = enemy(b.w, 'soldier', b.p.x + 80, b.p.y + 10, 99999);
  const boss = enemy(b.w, 'boss', b.p.x + 84, b.p.y, 1e7);
  const ev = run(b.w, 2);
  assert.equal(zonesOf(b.w, 'crows')[0].n, A.sun.n);
  const sun = evs(ev, 'land').filter((x) => x.kind === 'dive' && x.r >= A.sun.r);
  assert.ok(sun.length >= 1 && Math.hypot(sun[0].x - boss.x, sun[0].y - boss.y) < 6, '金乌扑首领');
  const hb = hitsOn(ev, boss.id, 'crow').map((h) => (h.t === 'hit' ? h.dmg : 0));
  assert.ok(hb.length >= 2 && Math.max(...hb) > 1.4 * Math.min(...hb), '扑得比别的鸦重');
  const hn = hitsOn(ev, near.id, 'crow').map((h) => (h.t === 'hit' ? h.dmg : 0));
  assert.ok(hn.some((d) => d > 1.4 * Math.min(...hb)), '日火连旁边的一起烧');
});

// ---------- 四海瓶 ----------

test('四海瓶：浪头冲向敌群，撞上的挨一下、减速、被推着往外走，推到头砸下再挨一下；首领推不动、召唤物几乎推不动', () => {
  const S = TUNE2.sihai;
  const { w, p } = arena(401, [{ kind: 'sihai', tier: 1 }]);
  const line = [enemy(w, 'soldier', p.x + 30, p.y), enemy(w, 'soldier', p.x + 46, p.y + 6), enemy(w, 'soldier', p.x + 60, p.y - 5)];
  const x0 = line.map((e) => e.x);
  run(w, 0.05);
  const z = zonesOf(w, 'surge')[0];
  assert.ok(z && Math.abs(z.a ?? 9) < 0.3 && (z.len ?? 0) <= S.len[1] + 1e-6, '朝敌群涌过去');
  const ev = run(w, (z.len ?? 0) / S.speed + 0.1);
  for (const [i, e] of line.entries()) {
    assert.ok(e.x > x0[i] + 15, `第 ${i + 1} 只被推出去 ${(e.x - x0[i]).toFixed(1)}`);
    assert.ok(hitsOn(ev, e.id, 'surge').length >= 2, '撞上一下、砸下一下');
    assert.ok(e.slowT > 0, '减速');
  }
  const crash = evs(ev, 'arti2').filter((x) => x.kind === 'sihai' && x.act === 'crash');
  assert.equal(crash.length, 1);
  assert.ok(Math.hypot(crash[0].x - p.x, crash[0].y - p.y) <= 145, '砸下的地方在 REACH.max 以内');
  run(w, S.linger + 0.1);
  assert.equal(zonesOf(w, 'surge').length, 0, '水退了');
  // 首领推不动，草人（召唤物）几乎推不动
  const b = arena(402, [{ kind: 'sihai', tier: 2 }]);
  const boss = enemy(b.w, 'boss', b.p.x + 40, b.p.y, 1e7);
  const straw = enemy(b.w, 'strawman', b.p.x + 50, b.p.y + 12, 1e6);
  const bx = boss.x;
  const sx = straw.x;
  const evB = run(b.w, 1.2);
  assert.ok(Math.abs(boss.x - bx) < 1 && Math.abs(straw.x - sx) < 1, '推不动');
  assert.ok(hitsOn(evB, boss.id, 'surge').length >= 1, '首领照样挨浪头');
  // 撞上推不动的（精英）：浪头就地砸下，精英挨得重
  const c = arena(404, [{ kind: 'sihai', tier: 1 }]);
  c.p.stats.crit = 0;
  const elite = enemy(c.w, 'elite', c.p.x + 40, c.p.y, 1e6);
  const evC = run(c.w, 1);
  const cr = evs(evC, 'arti2').find((x) => x.kind === 'sihai' && x.act === 'crash');
  assert.ok(cr && cr.x < elite.x + 4 && cr.x > c.p.x + 15, '撞上精英就地砸下');
  const he = hitsOn(evC, elite.id, 'surge').map((h) => (h.t === 'hit' ? h.dmg : 0));
  assert.ok(he.length === 2 && he[1] > he[0] * 4, '砸在精英身上更重');
});

test('四海瓶仙品「翻浪」：砸下时冻住砸中的（凡、灵不冻）', () => {
  const S = TUNE2.sihai;
  const frozen = (tier: number) => {
    const { w, p } = arena(403 + tier, [{ kind: 'sihai', tier }]);
    const es = [enemy(w, 'soldier', p.x + 40, p.y), enemy(w, 'soldier', p.x + 52, p.y + 6)];
    run(w, 0.05);
    const z = zonesOf(w, 'surge')[0];
    run(w, (z.len ?? 0) / S.speed + 0.05);
    return es.filter((e) => e.frozen > 0).length;
  };
  assert.ok(frozen(3) >= 2, '仙品冻住');
  assert.equal(frozen(2), 0);
});

test('四海瓶神品：「四海」四个方向各一道；「怒涛」浪头更宽、砸得更重', () => {
  const S = TUNE2.sihai;
  const { w, p } = arena(410, [{ kind: 'sihai', tier: 4, spirit: 'four' }]);
  enemy(w, 'soldier', p.x + 50, p.y);
  run(w, 0.05);
  const zs = zonesOf(w, 'surge');
  assert.equal(zs.length, 4);
  const angs = zs.map((z) => (((z.a ?? 0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(angs[i] - angs[i - 1] - Math.PI / 2) < 1e-6, '四个方向');
  const crashOf = (spirit: string | null) => {
    const a = arena(411, [{ kind: 'sihai', tier: 4, spirit }]);
    a.p.stats.crit = 0;
    const e = enemy(a.w, 'soldier', a.p.x + 40, a.p.y);
    run(a.w, 0.05);
    const z = zonesOf(a.w, 'surge')[0];
    const ev = run(a.w, (z.len ?? 0) / S.speed + 0.05);
    const hs = hitsOn(ev, e.id, 'surge').map((h) => (h.t === 'hit' ? h.dmg : 0));
    return { r: z.r, crash: Math.max(...hs) };
  };
  const rage = crashOf('rage');
  const plain = crashOf(null);
  assert.ok(rage.r > plain.r * 1.15, '更宽');
  assert.ok(rage.crash > plain.crash * 1.3, '砸得更重');
});

// ---------- 雾露乾坤网 ----------

test('雾露乾坤网：网张在敌群前沿，网里够三只就收网：都挨一下、网住的定身；精英一罩上就收（挨得重、网不住）；张够了没敌人就散', () => {
  const N = TUNE2.wulu;
  const { w, p } = arena(501, [{ kind: 'wulu', tier: 1 }]);
  const pack = [enemy(w, 'soldier', p.x + 100, p.y), enemy(w, 'soldier', p.x + 100, p.y + 60), enemy(w, 'soldier', p.x + 100, p.y - 60)];
  run(w, 0.05);
  const z = zonesOf(w, 'net')[0];
  const t0 = pack.find((e) => Math.hypot(e.x - z.x, e.y - z.y) < N.r[1] + 6)!;
  assert.ok(t0 && Math.hypot(z.x - p.x, z.y - p.y) < Math.hypot(t0.x - p.x, t0.y - p.y), '张在敌群前沿（朝人物那边）');
  assert.equal(z.nth, 0, '只有一只：先张着等');
  // 另外两只也走进网里
  pack.forEach((e, i) => {
    e.x = z.x + (i - 1) * 8;
    e.y = z.y + (i - 1) * 6;
  });
  const ev = run(w, 0.1);
  assert.equal(zonesOf(w, 'net')[0]?.nth, 1, '够三只就收网');
  for (const e of pack) {
    assert.equal(hitsOn(ev, e.id, 'net').length, 1);
    assert.ok(e.stun > N.hold[1] - 0.2, '定身');
  }
  // 精英：网直接罩在它身上，一罩上就收；挨得重、网不住
  const b = arena(502, [{ kind: 'wulu', tier: 1 }]);
  b.p.stats.crit = 0;
  const elite = enemy(b.w, 'elite', b.p.x + 60, b.p.y, 1e6);
  const evB = run(b.w, 0.1);
  const he = hitsOn(evB, elite.id, 'net').map((h) => (h.t === 'hit' ? h.dmg : 0));
  assert.ok(he.length === 1 && he[0] > WEAPONS.wulu.dmg * 2, '罩上精英就收、勒得重');
  assert.ok(elite.stun <= 0, '精英网不住');
  // 张够了网里没敌人：散了
  const c = arena(503, [{ kind: 'wulu', tier: 1 }]);
  const far = enemy(c.w, 'soldier', c.p.x + 100, c.p.y);
  run(c.w, 0.05);
  far.x += 200;
  const evC = run(c.w, N.wait + 0.1);
  assert.ok(evs(evC, 'arti2').some((x) => x.kind === 'wulu' && x.act === 'miss'), '落空');
  assert.equal(hitsOn(evC, far.id, 'net').length, 0);
});

test('雾露乾坤网仙品「乾坤」：收网之后把网住的拽到网心，缩成水球砸下；神品天罗（更大、精英也网住、首领减速）/ 地网（两张）', () => {
  const N = TUNE2.wulu;
  const { w, p } = arena(504, [{ kind: 'wulu', tier: 3 }]);
  const pack = [enemy(w, 'soldier', p.x + 90, p.y), enemy(w, 'soldier', p.x + 96, p.y + 12), enemy(w, 'soldier', p.x + 94, p.y - 12)];
  const ev0 = run(w, 0.05);
  const z = zonesOf(w, 'net')[0];
  for (const e of pack) e.x = z.x + (e.x - pack[0].x) * 0.5 + 8;
  const ev = [...ev0, ...run(w, N.cinch.t + 0.2)];
  for (const e of pack) assert.ok(Math.hypot(e.x - z.x, e.y - z.y) < 12, '拽到网心（挤在一起，各占各的身子）');
  assert.ok(evs(ev, 'arti2').some((x) => x.kind === 'wulu' && x.act === 'slam'), '缩成水球砸下');
  for (const e of pack) assert.equal(hitsOn(ev, e.id, 'net').length, 2, '收网一下、砸下一下');
  // 天罗
  const b = arena(505, [{ kind: 'wulu', tier: 4, spirit: 'sky' }]);
  const elite = enemy(b.w, 'elite', b.p.x + 60, b.p.y, 1e6);
  run(b.w, 0.1);
  assert.ok(zonesOf(b.w, 'net')[0].r > N.r[4] * 1.3 && elite.stun > 1, '更大、精英也网住');
  const c = arena(506, [{ kind: 'wulu', tier: 4, spirit: 'sky' }]);
  const boss = enemy(c.w, 'boss', c.p.x + 60, c.p.y, 1e7);
  run(c.w, 0.1);
  assert.ok(boss.slowT > 1 && boss.stun <= 0, '首领减速、不定身');
  // 地网
  const d = arena(507, [{ kind: 'wulu', tier: 4, spirit: 'earth' }]);
  enemy(d.w, 'soldier', d.p.x + 80, d.p.y);
  enemy(d.w, 'soldier', d.p.x - 80, d.p.y);
  run(d.w, 0.05);
  assert.equal(zonesOf(d.w, 'net').length, 2, '两张');
});

// ---------- 七宝妙树 ----------

test('七宝妙树：索敌半径里有敌人才出手；绕身一刷，刷得到的四面八方各挨一下、被刷开，刷不到的不挨刷；刷完飞出三宝各追一只', () => {
  const M = TUNE2.miaoshu;
  const { w, p } = arena(701, [{ kind: 'miaoshu', tier: 1 }]);
  run(w, 0.5);
  assert.equal(zonesOf(w, 'sweep').length, 0, '没敌人：不刷');
  const far = enemy(w, 'soldier', p.x + 110, p.y, 1e6);
  const ring = [0, 1, 2, 3, 4, 5].map((i) => enemy(w, 'soldier', p.x + Math.cos(i) * 30, p.y + Math.sin(i) * 30, 1e6));
  const d0 = ring.map((e) => Math.hypot(e.x - p.x, e.y - p.y));
  const ev = run(w, M.t + 0.12);
  assert.equal(w.knives.filter((k) => k.kind === 'miaoshu').length, M.gems.n[1], '三宝');
  run(w, 0.4);
  for (const [i, e] of ring.entries()) {
    assert.equal(hitsOn(ev, e.id, 'sweep').length, 1, `第 ${i} 只挨一下`);
    assert.ok(Math.hypot(e.x - p.x, e.y - p.y) > d0[i] + 8, `被刷开（${(Math.hypot(e.x - p.x, e.y - p.y) - d0[i]).toFixed(1)}）`);
  }
  assert.equal(hitsOn(ev, far.id, 'sweep').length, 0, '刷不到的不挨刷');
});

test('七宝妙树仙品「七宝」：七宝齐出、打中炸开；神品双刷（两遍、两轮宝）/ 宝光（十四宝）', () => {
  const M = TUNE2.miaoshu;
  const { w, p } = arena(702, [{ kind: 'miaoshu', tier: 3 }]);
  const es = [0, 1, 2, 3].map((i) => enemy(w, 'soldier', p.x + Math.cos(i * 1.5) * 30, p.y + Math.sin(i * 1.5) * 30, 1e6));
  const ev = run(w, M.t + 0.12);
  assert.equal(w.knives.filter((k) => k.kind === 'miaoshu').length, M.gems.n[3], '七宝');
  const ev2 = [...ev, ...run(w, 1)];
  const gems = es.reduce((a, e) => a + hitsOn(ev2, e.id, 'gem').length, 0);
  assert.ok(gems >= M.gems.n[3], `七宝打中 ${gems} 下（连炸开的）`);
  const b = arena(703, [{ kind: 'miaoshu', tier: 4, spirit: 'twin' }]);
  const eb = enemy(b.w, 'soldier', b.p.x + 30, b.p.y, 1e6);
  const evB = run(b.w, M.t * 2 + 0.12);
  assert.equal(hitsOn(evB, eb.id, 'sweep').length, 2, '一来一回两遍');
  const c = arena(704, [{ kind: 'miaoshu', tier: 4, spirit: 'glow' }]);
  enemy(c.w, 'soldier', c.p.x + 30, c.p.y, 1e6);
  run(c.w, M.t + 0.12);
  assert.equal(c.w.knives.filter((k) => k.kind === 'miaoshu').length, M.glow.n, '十四宝');
});

// ---------- 瘟癀伞 ----------

test('瘟癀伞：伞撑在敌群上空，伞下的染瘟（持续掉血、变慢），隔一会儿传给身边一只；到时没了', () => {
  const U = TUNE2.wenhuang;
  const { w, p } = arena(801, [{ kind: 'wenhuang', tier: 1 }]);
  const pack = [enemy(w, 'soldier', p.x + 80, p.y, 1e6), enemy(w, 'soldier', p.x + 110, p.y, 1e6)];
  const out = enemy(w, 'soldier', p.x + 138, p.y, 1e6); // 伞下够不着、离伞边上那只不到 30 像素
  run(w, 0.05);
  assert.equal(zonesOf(w, 'umbrella').length, 1);
  const ev = run(w, 0.6);
  for (const e of pack) {
    assert.ok((e.plague ?? 0) === 1 && (e.plagueT ?? 0) > 0, '伞下的染上');
    assert.ok(e.slow > 0, '变慢');
  }
  const ev2 = [...ev, ...run(w, 1.2)];
  assert.ok(pack.every((e) => hitsOn(ev2, e.id, 'plague').length >= 2), '持续掉血');
  assert.ok((out.plagueT ?? 0) > 0, '传给身边的');
  assert.ok(evs(ev2, 'arti2').some((x) => x.kind === 'wenhuang' && x.act === 'spread'));
  // 走远了、伞也收了：到时没了
  for (const e of [...pack, out]) e.x += 400;
  run(w, U.t + 0.5);
  assert.ok([...pack, out].every((e) => !(e.plagueT && e.plagueT > 0) && !e.plague), '到时没了');
});

test('瘟癀伞仙品「瘟毒」：叠三层，叠满瘟倒（首领不倒）；神品五瘟（传得更远）/ 瘟神（染瘟的受到的伤害 +20%）', () => {
  const U = TUNE2.wenhuang;
  const { w, p } = arena(802, [{ kind: 'wenhuang', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 80, p.y, 1e6);
  const boss = enemy(w, 'boss', p.x + 84, p.y + 6, 1e7);
  const ev = run(w, 2.6);
  assert.equal(e.plague, U.max[3], '叠满三层');
  assert.ok(evs(ev, 'arti2').some((x) => x.kind === 'wenhuang' && x.act === 'down' && x.id === e.id), '瘟倒');
  assert.ok(!evs(ev, 'arti2').some((x) => x.kind === 'wenhuang' && x.act === 'down' && x.id === boss.id), '首领不倒');
  // 五瘟：离染瘟的 40 像素也传得到
  const b = arena(803, [{ kind: 'wenhuang', tier: 4, spirit: 'five' }]);
  enemy(b.w, 'soldier', b.p.x + 80, b.p.y, 1e6);
  enemy(b.w, 'soldier', b.p.x + 118, b.p.y, 1e6);
  const far = enemy(b.w, 'soldier', b.p.x + 158, b.p.y, 1e6); // 伞下够不着、离伞边上那只 40 像素（平常传不到）
  run(b.w, 1.6);
  assert.ok((far.plagueT ?? 0) > 0, '五瘟传得更远');
  // 瘟神：染瘟的受到的伤害 +20%
  const c = arena(804, [{ kind: 'wenhuang', tier: 4, spirit: 'god' }]);
  const g = enemy(c.w, 'soldier', c.p.x + 80, c.p.y, 1e6);
  run(c.w, 0.5);
  assert.ok(Math.abs(hitMul2(c.w, g) - (1 + U.god)) < 1e-9, '瘟神');
});

// ---------- 落宝金钱 ----------

test('落宝金钱：飞到血最厚的那只头上一下一下地敲（钱声震到身边的）；它死了落宝多掉一枚灵石，金钱飞向下一只；一回最多落宝两次', () => {
  const L = TUNE2.luobao;
  const { w, p } = arena(901, [{ kind: 'luobao', tier: 1 }]);
  const fat = enemy(w, 'soldier', p.x + 70, p.y, 5000);
  const side = enemy(w, 'soldier', p.x + 80, p.y + 6, 1e6);
  const thin = enemy(w, 'soldier', p.x - 60, p.y, 200);
  run(w, 0.05);
  const z = zonesOf(w, 'coin')[0];
  assert.ok(z && (z.ids ?? [])[0] === side.id, '挑血最厚的');
  void fat;
  const ev = run(w, 1.2);
  assert.ok(hitsOn(ev, side.id, 'coin').length >= 2, '一下一下地敲');
  assert.ok(hitsOn(ev, fat.id, 'coin').length >= 2, '钱声震到身边的');
  // 附着的那只死了：落宝、换下一只
  const gems0 = w.gems.length;
  side.hp = 1;
  const ev2 = run(w, 0.5);
  assert.ok(evs(ev2, 'arti2').some((x) => x.kind === 'luobao' && x.act === 'drop'), '落宝');
  assert.ok(w.gems.length >= gems0 + ENEMIES.soldier.gems + 1, '多掉一枚灵石');
  assert.ok(evs(ev2, 'arti2').some((x) => x.kind === 'luobao' && x.act === 'hop'), '飞向下一只');
  const z2 = zonesOf(w, 'coin')[0];
  assert.ok(z2 && [fat.id, thin.id].includes((z2.ids ?? [])[0]), '换了一只');
  void L;
});

test('落宝金钱仙品「落宝」：被附上的受到的伤害 +20%、落魂幡手给的护体失效；神品金钱雨（两枚各附一只）/ 生财（精英多掉五枚）', () => {
  const L = TUNE2.luobao;
  const { w, p } = arena(902, [{ kind: 'luobao', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 60, p.y, 1e6);
  e.ward = 0.5;
  e.wardT = 5;
  run(w, 0.4);
  assert.ok(Math.abs(hitMul2(w, e) - (1 + L.vuln)) < 1e-9 && !e.wardT, '宝光打落、护体失效');
  const b = arena(903, [{ kind: 'luobao', tier: 4, spirit: 'rain' }]);
  const a1 = enemy(b.w, 'soldier', b.p.x + 60, b.p.y, 1e6);
  const a2 = enemy(b.w, 'soldier', b.p.x - 60, b.p.y, 9e5);
  run(b.w, 0.6);
  const zs = zonesOf(b.w, 'coin');
  assert.equal(zs.length, 2, '两枚');
  assert.deepEqual(zs.map((z) => (z.ids ?? [])[0]).sort(), [a1.id, a2.id].sort(), '各附一只');
  const c = arena(904, [{ kind: 'luobao', tier: 4, spirit: 'luck' }]);
  const el = enemy(c.w, 'elite', c.p.x + 60, c.p.y, 1e6);
  run(c.w, 0.5);
  const g0 = c.w.gems.length;
  el.hp = 1;
  run(c.w, 0.5);
  assert.ok(c.w.gems.length >= g0 + ENEMIES.elite.gems + 1 + L.luck.elite, '精英多掉五枚');
});

// ---------- 和别的分支的新机制 ----------

test('金光（金光力士给敌人套的）挡下第一下：挡下的那一枚钉子不钉、那一网网不住、那一浪不减速；第二下照常', () => {
  const shield = (w: World, e: ReturnType<typeof enemy>) => {
    e.aegis = 1;
    e.aegisT = w.time + 10;
  };
  // 攒心钉
  const a = arena(601, [{ kind: 'zanxin', tier: 1 }]);
  const ea = enemy(a.w, 'soldier', a.p.x + 60, a.p.y, 1e6);
  shield(a.w, ea);
  const evA = run(a.w, 1.5);
  const first = evs(evA, 'hit').filter((h) => h.id === ea.id && h.by === 'nail');
  assert.ok((ea.aegis ?? 0) === 0 && first.length >= 1, '金光挡掉一下之后照常钉');
  assert.ok((ea.nails ?? 0) <= first.length, '挡下的那一枚没钉上');
  // 雾露乾坤网
  const b = arena(602, [{ kind: 'wulu', tier: 1 }]);
  const pack = [enemy(b.w, 'soldier', b.p.x + 60, b.p.y), enemy(b.w, 'soldier', b.p.x + 64, b.p.y + 8), enemy(b.w, 'soldier', b.p.x + 64, b.p.y - 8)];
  shield(b.w, pack[0]);
  run(b.w, 0.1);
  assert.ok(pack[0].stun <= 0 && pack[1].stun > 0, '金光挡下的网不住，别的照常网住');
  // 四海瓶
  const c = arena(603, [{ kind: 'sihai', tier: 1 }]);
  const ec = enemy(c.w, 'soldier', c.p.x + 30, c.p.y);
  shield(c.w, ec);
  const x0 = ec.x;
  run(c.w, 0.4);
  assert.ok(ec.slowT <= 0 && ec.x > x0 + 10, '挡下的不减速，照样被浪推走');
});

// ---------- 确定性与快照 ----------

test('再加的几件：同种子同输入完全确定；中途存快照、恢复后接着跑，和不中断的一模一样', () => {
  const play = (seed: number, cut = -1) => {
    let w = createWorld(seed);
    w.wave = 10;
    w.waveLen = 26;
    const p = w.players[0];
    p.weapons = NEW2.map((k, i) => ({ kind: k, tier: 3 + (i % 2), spirit: i % 2 ? WEAPONS[k].spirits[i % 2].id : null, cd: 0.5 }));
    p.stats.maxHp = 5000;
    p.hp = 4000;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      if (i === cut) w = restore(JSON.parse(JSON.stringify(snapshot(w))));
      ev.push(...step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []));
    }
    return { d: `${digest(w)}|${w.zones.length}|${w.pending.length}|${ev.length}`, kinds: new Set(ev.map((e) => (e.t === 'hit' ? `hit:${e.by}` : e.t))) };
  };
  const a = play(301);
  assert.equal(a.d, play(301).d);
  assert.equal(a.d, play(301, 700).d, '快照恢复后一样');
  for (const k of ['hit:pestle', 'hit:stone', 'hit:nail', 'hit:jiao', 'hit:geyser', 'hit:crow']) assert.ok(a.kinds.has(k), k);
});
