// 三个回响化身（sim/heroes/mozha.ts、huizhao.ts、huiyun.ts，被动在 heroes/passives.ts）的模拟测试：
// 起手按角色（专属法宝凡品、宠物种类、主五行亲和；魔化哪吒气血上限低一点）；专属法宝不进公共池；要解锁才能选（联机按房主的解锁）；
// 魔化哪吒：黑焰轮（凡三只朝四面滚、碾过的点上灼烧，仙品滚回来，八方 / 红莲）、火尖枪突进（蓄力站定、无敌冲过去、沿路灼烧、冲过的线还烧）、业火（越残越疼）；
// 回响赵公明：缚龙索（缠一串往一处拽、撞一下，仙品锁住加易伤，首领拽不动）、钉头七箭（钉七只、三秒后一起落箭，首领先钉）、怨力（挨打攒满震一圈）；
// 回响云霄：乾坤图（裹住图上的、首领不定身，仙品山影压下，裹天两卷）、黄河阵 · 削顶（阵里受伤加深、打人变轻）、截教（定住的越多出手越快）；
// 射程守规矩；同种子同输入完全确定，招式打到一半存档恢复后接着跑逐帧相同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, PLAYER, REACH, SKILL } from './config.ts';
import { COMMON_WEAPONS, EARNED, ECHO, HEROES, HIDDEN, JIEJIAO, YEHUO, YUANLI } from './catalog.ts';
import { hitEnemy, hurtPlayer } from './core.ts';
import { allowedHeroes, castSkill, HERO_IDS, pickFreeHero } from './heroes/index.ts';
import { fearDmgMul, heroHaste, heroHitMul, yehuoBonus } from './heroes/passives.ts';
import { HEIYAN, TUJIN } from './heroes/mozha.ts';
import { DINGTOU, FULONG } from './heroes/huizhao.ts';
import { QIANKUNTU, XUEDING } from './heroes/huiyun.ts';
import { petKindOf } from './pet.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { EnemyKindName, HeroId } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 干净的测试场：普通波、刷怪关掉、人物无敌；宠物不出手；专属法宝按给的品阶。 */
const arena = (hero: HeroId, opts: { tier?: number; spirit?: string | null; weapons?: boolean } = {}) => {
  const w = createWorld(13, 1, [hero]);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons[0].tier = opts.tier ?? 1;
  p.weapons[0].spirit = opts.spirit ?? null;
  p.weapons[0].cd = opts.weapons === false ? 1e9 : 0;
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  p.stats.crit = 0;
  return { w, p };
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 99999) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};

// ---------------------------------------------------------------- 角色表、起手、解锁

test('三个回响化身的起手：专属法宝凡品、宠物是本人那一种（只换颜色）、主五行亲和按角色表（魔化哪吒 +35%，别的 +10%）；魔化哪吒气血上限少一点', () => {
  const want: Record<string, [string, string, string]> = { mozha: ['heiyan', 'huntian', 'fire'], huizhao: ['fulong', 'heihu', 'earth'], huiyun: ['qiankuntu', 'qingluan', 'metal'] };
  for (const [h, [wk, pk, el]] of Object.entries(want)) {
    const w = createWorld(1, 1, [h as HeroId]);
    const p = w.players[0];
    assert.deepEqual(p.weapons.map((x) => [x.kind, x.tier]), [[wk, 1]]);
    assert.equal(petKindOf(p), pk);
    assert.equal(p.stats.aff[el as 'fire'], HEROES[h as HeroId].affStart); // 2026-11-11 数值平衡：魔化哪吒 0.1 → 0.35
    assert.equal(HEROES[h as HeroId].exclusive, wk);
    assert.ok(!COMMON_WEAPONS.includes(wk as never), `${wk} 不进公共池`);
  }
  const m = createWorld(1, 1, ['mozha']).players[0];
  assert.ok(HEROES.mozha.maxHp! < 0, '比别人少'); // 2026-11-11 数值平衡 −15 → −5
  assert.equal(m.stats.maxHp, PLAYER.maxHp + HEROES.mozha.maxHp!);
  assert.equal(m.hp, PLAYER.maxHp + HEROES.mozha.maxHp!);
  assert.equal(createWorld(1, 1, ['nezha']).players[0].stats.maxHp, PLAYER.maxHp, '别的角色不变');
});

test('回响化身要解锁才能选：没解锁只有本人（四个基础角色；雷震子是成就奖励）；解锁了哪一个就多哪一个；联机按房主的解锁挑（选了房主没解锁的换成能选的）', () => {
  const base = allowedHeroes([]);
  assert.deepEqual(base, ['nezha', 'yangjian', 'zhao', 'yunxiao']);
  assert.ok(allowedHeroes([EARNED.leizhenzi!.unlock]).includes('leizhenzi'));
  assert.ok(allowedHeroes(['echo-zhao']).includes('huizhao'));
  assert.ok(!allowedHeroes(['echo-zhao']).includes('huiyun'));
  // 回响化身全解锁了：除了隐藏角色（孙悟空有自己的解锁 id，catalog.HIDDEN）都能选
  assert.deepEqual(allowedHeroes(Object.values(ECHO).map((e) => e!.unlock)), HERO_IDS.filter((h) => !HIDDEN[h] && !EARNED[h]));
  assert.deepEqual(allowedHeroes([...Object.values(ECHO).map((e) => e!.unlock), ...Object.values(HIDDEN).map((h) => h!.unlock), ...Object.values(EARNED).map((h) => h!.unlock)]), HERO_IDS);
  assert.equal(pickFreeHero([], 'mozha', base), 'nezha', '没解锁的换成能选的');
  assert.equal(pickFreeHero(['nezha'], 'huiyun', base), 'yangjian');
  assert.equal(pickFreeHero([], 'huiyun', allowedHeroes(['echo-yunxiao'])), 'huiyun');
  // 解锁的 id 和遭遇战发的一样
  assert.equal(ECHO.huizhao!.unlock, 'echo-zhao');
  assert.equal(ECHO.huiyun!.unlock, 'echo-yunxiao');
  assert.equal(ECHO.mozha!.unlock, 'demon-nezha');
});

// ---------------------------------------------------------------- 魔化哪吒

test('黑焰轮凡品：三只轮子朝四面滚出去（其中一只朝敌人最多的地方），碾过的挨一下、点上灼烧；滚到尽头就散；身边没人不出手', () => {
  const { w, p } = arena('mozha');
  const ev0 = run(w, 0.5);
  assert.equal(evs(ev0, 'wheel').length, 0, '身边没人不出手');
  const e = enemy(w, 'soldier', p.x + 60, p.y);
  const ev = run(w, 1.2);
  const wh = evs(ev, 'wheel');
  assert.equal(wh.length, 3);
  const hits = evs(ev, 'hit').filter((h) => h.by === 'wheel' && h.id === e.id);
  assert.ok(hits.length >= 1, '碾到了');
  assert.ok(e.burnT > 0, '点上灼烧');
  run(w, 2);
  assert.equal(p.wheels, undefined, '滚完就散');
  assert.equal(evs(ev, 'wheelTurn').length, 0, '凡品不回来');
});

test('黑焰轮仙品「轮回」滚到尽头掉头滚回脚下（回程再碾一遍）；器灵八方一次八只；红莲滚到最远处炸开一朵；轮子离人物不超过 REACH.max', () => {
  const t3 = arena('mozha', { tier: 3 });
  enemy(t3.w, 'soldier', t3.p.x + 60, t3.p.y);
  let far = 0;
  const ev = run(t3.w, 2.5, (w) => {
    for (const wh of w.players[0].wheels ?? []) far = Math.max(far, Math.hypot(wh.x - w.players[0].x, wh.y - w.players[0].y));
    return idle;
  });
  assert.ok(evs(ev, 'wheelTurn').length >= 4, '掉头');
  assert.ok(far <= REACH.max + 1, `最远 ${far.toFixed(1)}`);
  const t8 = arena('mozha', { tier: 4, spirit: 'eight' });
  enemy(t8.w, 'soldier', t8.p.x + 60, t8.p.y);
  assert.equal(evs(run(t8.w, 0.3), 'wheel').length, HEIYAN.eight);
  const tl = arena('mozha', { tier: 4, spirit: 'lotus' });
  enemy(tl.w, 'soldier', tl.p.x + 60, tl.p.y);
  assert.ok(evs(run(tl.w, 1.5), 'wheelBurst').length >= 1, '红莲炸开');
});

test('火尖枪突进：蓄力时站定、无敌；然后沿线冲过去（人跟着走），线上的被撞、点上灼烧；冲过的线还烧一会儿', () => {
  const { w, p } = arena('mozha', { weapons: false });
  p.iframes = 0;
  const es = [40, 70, 100].map((d) => enemy(w, 'soldier', p.x + d, p.y));
  const x0 = p.x;
  const ev: SimEvent[] = [];
  castSkill(w, p, ev);
  assert.ok(p.dash, '蓄力');
  assert.ok(p.iframes > TUJIN.windup, '无敌');
  run(w, TUJIN.windup - 0.05, () => ({ mx: -1, my: 0, skill: false }));
  assert.ok(Math.abs(p.x - x0) < 0.5, '蓄力时站定（按方向键也不走）');
  const ev2 = run(w, 0.4);
  assert.equal(evs(ev2, 'tujin').length, 1);
  assert.ok(p.x > x0 + 100, `冲出去了（${(p.x - x0).toFixed(0)} 像素）`);
  for (const e of es) assert.ok(e.burnT > 0 && e.hp < e.maxHp, '线上的被撞、点上灼烧');
  const late = enemy(w, 'soldier', x0 + 80, p.y);
  run(w, 1);
  assert.ok(late.burnT > 0, '冲过的线还烧着');
});

test('业火：满血不加，气血越低越疼，25% 以下吃满 +45%；别的角色一直是 1', () => {
  const { w, p } = arena('mozha');
  const e = enemy(w, 'soldier', p.x + 30, p.y);
  assert.equal(heroHitMul(w, p, e), 1);
  p.hp = p.stats.maxHp * 0.625;
  assert.ok(Math.abs(yehuoBonus(p) - YEHUO.max * 0.5) < 1e-9);
  p.hp = p.stats.maxHp * 0.2;
  assert.ok(Math.abs(heroHitMul(w, p, e) - (1 + YEHUO.max)) < 1e-9);
  const n = createWorld(1, 1, ['nezha']).players[0];
  n.hp = 1;
  assert.equal(heroHitMul(w, n, e), 1);
});

// ---------------------------------------------------------------- 回响赵公明

test('缚龙索凡品：缠住一串三只、往一处拽到一起，撞一下；首领拽不动、只挨伤害；仙品「锁龙」拽到一起后锁住片刻、受伤加深', () => {
  const { w, p } = arena('huizhao');
  const es = [
    enemy(w, 'soldier', p.x + 70, p.y - 30),
    enemy(w, 'soldier', p.x + 100, p.y + 25),
    enemy(w, 'soldier', p.x + 120, p.y - 5),
  ];
  const spread = () => Math.max(...es.map((a) => Math.max(...es.map((b) => Math.hypot(a.x - b.x, a.y - b.y)))));
  const s0 = spread();
  const ev = run(w, FULONG.dur[1] + 0.2);
  assert.equal(evs(ev, 'lasso')[0]?.ids.length, 3);
  assert.ok(spread() < s0 * 0.4, `拽到一起（${s0.toFixed(0)} → ${spread().toFixed(0)}）`);
  assert.equal(evs(ev, 'lassoEnd').length, 1, '撞了一下');
  const b = arena('huizhao', { tier: 3 });
  const boss = enemy(b.w, 'boss', b.p.x + 80, b.p.y);
  const s = enemy(b.w, 'soldier', b.p.x + 110, b.p.y + 10);
  const bx = boss.x;
  const ev2 = run(b.w, FULONG.dur[3] + 0.05);
  assert.equal(boss.x, bx, '首领拽不动');
  assert.ok(boss.hp < boss.maxHp, '首领挨伤害');
  const end = evs(ev2, 'lassoEnd')[0];
  assert.ok(end && end.lock > 0, '锁龙');
  assert.ok(s.stun > 0 && s.vuln > 0, '锁住、受伤加深');
  assert.equal(boss.stun, 0, '首领不锁');
});

test('钉头七箭：给身边最多七只钉上草人符（首领、精英先钉），三秒后一起落箭（同一帧）；索敌半径外的不钉', () => {
  const { w, p } = arena('huizhao', { weapons: false });
  const near = Array.from({ length: 9 }, (_, i) => enemy(w, 'soldier', p.x + 30 + i * 9, p.y + (i % 3) * 10 - 10, 5000));
  const el = enemy(w, 'elite', p.x - 60, p.y, 5000);
  const far = enemy(w, 'soldier', p.x + REACH.seek + 40, p.y, 5000);
  const ev: SimEvent[] = [];
  castSkill(w, p, ev);
  const nail = evs(ev, 'nail')[0];
  assert.equal(nail.ids.length, DINGTOU.n);
  assert.ok(nail.ids.includes(el.id), '精英先钉');
  assert.ok(!nail.ids.includes(far.id));
  const ev2 = run(w, DINGTOU.delay - 0.1);
  assert.equal(evs(ev2, 'nailHit').length, 0, '还没落箭');
  const ev3 = run(w, 0.2);
  const hit = evs(ev3, 'nailHit')[0];
  assert.ok(hit && hit.ids.length === DINGTOU.n, '一起落箭');
  for (const id of hit.ids) assert.ok((w.enemies.find((x) => x.id === id)?.hp ?? 0) < 5000);
  void near;
});

test('怨力：挨打攒怨（护体减过的实数），挨够约 60 点从身上震出一圈（伤害、震开），再从头攒；别的角色挨打不攒', () => {
  const { w, p } = arena('huizhao', { weapons: false });
  p.iframes = 0;
  p.stats.maxHp = p.hp = 1e5;
  const e = enemy(w, 'soldier', p.x + 30, p.y);
  let got = 0;
  for (let i = 0; i < 20 && got < YUANLI.full; i++) {
    p.iframes = 0;
    const before = p.hp;
    hurtPlayer(w, p, 10, 'contact', []);
    got += before - p.hp;
  }
  assert.ok((p.grudge ?? 0) >= 1 - 1e-9, '攒满');
  const ev = run(w, DT);
  const g = evs(ev, 'grudge')[0];
  assert.ok(g && g.ids.includes(e.id), '震出一圈');
  assert.equal(p.grudge, 0, '从头攒');
  const n = arena('nezha', { weapons: false });
  n.p.iframes = 0;
  hurtPlayer(n.w, n.p, 10, 'contact', []);
  assert.equal(n.p.grudge, undefined);
});

// ---------------------------------------------------------------- 回响云霄

test('乾坤图凡品：朝敌人最多的方向铺开一卷，图上的被裹住（定身）挨一下，首领只挨伤害；仙品「镇山」裹够了山影压下来；裹天一次两卷', () => {
  const { w, p } = arena('huiyun');
  const on = [40, 70, 95].map((d) => enemy(w, 'soldier', p.x + d, p.y));
  const off = enemy(w, 'soldier', p.x, p.y + 80);
  const ev = run(w, 0.1);
  const sc = evs(ev, 'scroll')[0];
  assert.ok(sc, '铺开');
  for (const e of on) assert.ok(sc.ids.includes(e.id) && e.stun > 0, '图上的裹住');
  assert.ok(!sc.ids.includes(off.id));
  const t3 = arena('huiyun', { tier: 3 });
  const boss = enemy(t3.w, 'boss', t3.p.x + 60, t3.p.y);
  const s = enemy(t3.w, 'soldier', t3.p.x + 90, t3.p.y);
  const ev3 = run(t3.w, QIANKUNTU.wrap[3] + 0.1);
  assert.equal(boss.stun, 0, '首领不定身');
  assert.ok(boss.hp < boss.maxHp);
  assert.ok(evs(ev3, 'scrollPress').some((x) => x.ids.includes(s.id)), '镇山压下');
  const tc = arena('huiyun', { tier: 4, spirit: 'cross' });
  enemy(tc.w, 'soldier', tc.p.x + 50, tc.p.y);
  assert.equal(evs(run(tc.w, 0.1), 'scroll').length, 2, '裹天两卷');
});

test('黄河阵 · 削顶：摆在敌人最多的地方，阵里的受伤加深、打人变轻（接触伤害打折），阵外的不变；到时散掉', () => {
  const { w, p } = arena('huiyun', { weapons: false });
  const inside = enemy(w, 'soldier', p.x + 60, p.y);
  enemy(w, 'soldier', p.x + 66, p.y + 6);
  const out = enemy(w, 'soldier', p.x - 120, p.y + 60);
  const ev: SimEvent[] = [];
  castSkill(w, p, ev);
  assert.equal(evs(ev, 'formation').length, 1);
  run(w, 0.1);
  assert.ok(inside.vuln >= XUEDING.vuln - 1e-9, '受伤加深');
  assert.ok(Math.abs(fearDmgMul(w, inside) - (1 - XUEDING.weak)) < 1e-9, '打人变轻');
  assert.equal(fearDmgMul(w, out), 1);
  run(w, XUEDING.dur + 0.5);
  assert.equal(p.formation, undefined, '散掉');
  assert.equal(fearDmgMul(w, inside), 1);
});

test('截教：身边每有一只被定住、冻住、晕住的敌人，攻速 +4%，最多 +24%；冷却跟着快；别的角色不加', () => {
  const { w, p } = arena('huiyun');
  assert.equal(heroHaste(w, p), 0);
  const es = Array.from({ length: 8 }, (_, i) => enemy(w, 'soldier', p.x + 30 + i * 8, p.y));
  es[0].stun = 1;
  es[1].frozen = 1;
  es[1].stun = 1;
  assert.ok(Math.abs(heroHaste(w, p) - 2 * JIEJIAO.per) < 1e-9);
  for (const e of es) e.stun = 5;
  assert.ok(Math.abs(heroHaste(w, p) - JIEJIAO.cap) < 1e-9, '有上限');
  const n = arena('nezha');
  const ne = enemy(n.w, 'soldier', n.p.x + 30, n.p.y);
  ne.stun = 5;
  assert.equal(heroHaste(n.w, n.p), 0);
  void SKILL;
});

// ---------------------------------------------------------------- 确定性与存档

test('三个回响化身的一局：同种子同输入完全确定；招式打到一半（轮子在滚、索在拽、图铺着）存档恢复后接着跑逐帧相同', () => {
  for (const hero of ['mozha', 'huizhao', 'huiyun'] as HeroId[]) {
    const play = () => {
      const w = createWorld(41, 1, [hero]);
      const trace: string[] = [];
      for (let i = 0; i < 60 * 30 && w.phase !== 'over'; i++) {
        step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
        if (i % 30 === 0) trace.push(digest(w));
      }
      return trace;
    };
    assert.deepEqual(play(), play(), `${hero} 两遍一样`);
    const w = createWorld(42, 1, [hero]);
    const p = w.players[0];
    const busy = () => !!(p.wheels?.length || p.ropes?.length || p.scrolls?.length);
    for (let i = 0; i < 60 * 30 && !(w.phase === 'wave' && busy()); i++) step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
    assert.ok(busy(), `${hero}：专属法宝正在出手`);
    for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x + 30 + i * 8, p.y + (i % 3) * 6 - 6, 800);
    p.skill = 1;
    step(w, [{ mx: 0, my: 0, skill: true }]);
    const r = restore(JSON.parse(JSON.stringify(snapshot(w))));
    assert.equal(canonicalText(r), canonicalText(w));
    for (let i = 0; i < 240; i++) {
      const a = JSON.stringify(step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []));
      const b = JSON.stringify(step(r, [botInput(r, 0)], r.phase === 'shop' ? botShop(r, 0) : []));
      assert.equal(b, a, `${hero} 第 ${i + 1} 帧跑岔了`);
    }
  }
});

test('射程：黑焰轮、缚龙索、乾坤图都只对索敌半径里有敌人时出手（只有 140–195 像素处有敌人时不出手）', () => {
  for (const hero of ['mozha', 'huizhao', 'huiyun'] as HeroId[])
    for (const tier of [1, 2, 3, 4]) {
      const { w, p } = arena(hero, { tier, spirit: tier === 4 ? HEROES[hero] && (hero === 'mozha' ? 'eight' : hero === 'huizhao' ? 'twin' : 'cross') : null });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        enemy(w, 'soldier', p.x + Math.cos(a) * 170, p.y + Math.sin(a) * 170);
      }
      const ev = run(w, 2);
      assert.equal(ev.filter((e) => e.t === 'wheel' || e.t === 'lasso' || e.t === 'scroll').length, 0, `${hero} ${tier}`);
    }
});

test('回响化身的被动、法宝都没登记的时候：哪吒照旧（不多用随机数，不改伤害）——第一章的数值模拟逐字不变靠的就是这一条', () => {
  const a = createWorld(99, 1, ['nezha']);
  const b = createWorld(99, 1, ['nezha']);
  for (let i = 0; i < 60 * 20; i++) {
    step(a, [botInput(a, 0)], a.phase === 'shop' ? botShop(a, 0) : []);
    step(b, [botInput(b, 0)], b.phase === 'shop' ? botShop(b, 0) : []);
  }
  assert.equal(digest(a), digest(b));
  assert.equal(heroHaste(a, a.players[0]), 0);
  const e = a.enemies[0] ?? enemy(a, 'soldier', a.players[0].x + 20, a.players[0].y);
  assert.equal(heroHitMul(a, a.players[0], e), 1);
  void hitEnemy;
});
