import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, miasmaDepth, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { ARENA, CASTER, DT, MIASMA, SKILL } from './config.ts';
import { MAX_WEAPONS, waveDuration, xpToNext } from './catalog.ts';
import { buy, applyCommand } from './shop.ts';
import { botInput, botShop } from './bot.ts';
import type { EnemyKindName, ShopOffer } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
/** 跑若干秒（遇到商店阶段就让机器人买完并准备）。 */
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle, autoShop = true) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const cmds = w.phase === 'shop' && autoShop ? botShop(w, 0) : [];
    events.push(...step(w, [input(w)], cmds));
  }
  return events;
};
/** 只测某个机制时关掉刷怪：借用首领波（不按时刷小怪），并把这一波拉得很长。 */
const quiet = (w: World) => {
  w.wave = 6;
  w.waveLen = 1e9;
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 9999) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};

test('同一种子 + 同一串输入（含商店指令）→ 完全相同的状态', () => {
  const a = createWorld(42);
  const b = createWorld(42);
  run(a, 110, (w) => botInput(w, 0));
  run(b, 110, (w) => botInput(w, 0));
  assert.equal(digest(a), digest(b));
  assert.ok(a.wave >= 3, `应该已经打到第 3 波以后，实际第 ${a.wave} 波`);
  const c = createWorld(43);
  run(c, 110, (w) => botInput(w, 0));
  assert.notEqual(digest(a), digest(c));
});

test('专属法宝起手自带：哪吒开局就有乾坤圈，会自动出手并击杀', () => {
  const w = createWorld(1);
  assert.deepEqual(w.players[0].weapons.map((x) => x.kind), ['qiankun']);
  const ev = run(w, 15, (w) => botInput(w, 0));
  // 敌人都从屏幕外走进来，进了索敌半径（REACH.seek）乾坤圈才出手；冷却 1.4 秒左右：15 秒里出手好几次
  assert.ok(ev.filter((e) => e.t === 'throw').length >= 5);
  assert.ok(ev.filter((e) => e.t === 'kill').length > 5);
});

test('拾取灵石同时加经验和货币，攒够就升级（升级后在波次结束时统一选属性）', () => {
  const w = createWorld(2);
  quiet(w);
  const p = w.players[0];
  const need = xpToNext(1);
  for (let i = 0; i < need; i++) w.gems.push({ id: 900 + i, x: p.x + 10, y: p.y, px: 0, py: 0, vx: 0, vy: 0, value: 1, pulled: -1 });
  const ev = run(w, 1.5);
  assert.equal(p.lingshi, need);
  assert.equal(p.level, 2);
  assert.equal(p.pendingLevels, 1);
  assert.ok(ev.some((e) => e.t === 'levelup'));
});

test('波次结束：清场，场上灵石一口气飞向人物（八折），收完才进商店；选完属性并准备后开始下一波；人物不回原位', () => {
  const w = createWorld(3);
  w.waveLen = 20; // 短一点的波：正式的一波 45 秒，打得久了会升到 5 级、先要选宠物进化
  const p = w.players[0];
  p.iframes = 1e9;
  run(w, w.waveLen - 0.5, () => idle, false);
  assert.equal(w.phase, 'wave');
  w.gems.push({ id: 999, x: 10, y: 10, px: 0, py: 0, vx: 0, vy: 0, value: 30, pulled: -1 });
  w.gems = [w.gems[w.gems.length - 1]]; // 只留这一颗，好算账
  w.enemies = [];
  p.weapons = [];
  const before = p.lingshi;
  p.x = p.px = 300; // 人物站在别处，下一波开始时不应被拉回场心
  let ev = run(w, 1, () => idle, false);
  assert.equal(w.phase, 'collect', '先收灵，不直接跳到商店');
  assert.ok(ev.some((e) => e.t === 'waveEnd'));
  assert.equal(w.enemies.length, 0);
  ev = run(w, 3.2, () => idle, false);
  assert.equal(w.phase, 'shop');
  assert.ok(ev.some((e) => e.t === 'shopOpen'));
  assert.ok(ev.some((e) => e.t === 'pickup'), '灵石是飞过来被拾取的');
  assert.equal(p.lingshi, before + 24, '收灵按八折算');
  assert.ok(p.pendingLevels > 0 && p.levelOffers.length === 4, '有待选的升级');
  assert.equal(p.shop.filter(Boolean).length, 4, '商店四个格子');
  applyCommand(w, { t: 'ready', player: 0 }, []);
  assert.equal(p.ready, false, '没选完属性不能准备');
  while (p.pendingLevels > 0) applyCommand(w, { t: 'pick', player: 0, index: 0 }, []);
  applyCommand(w, { t: 'ready', player: 0 }, []);
  const ev2 = step(w, [idle]);
  assert.equal(w.phase, 'wave');
  assert.equal(w.wave, 2);
  assert.ok(ev2.some((e) => e.t === 'waveStart'));
  assert.equal(p.x, 300, '人物不回原位');
});

test('商店：买同名法宝就是升阶，不会占第二个位置；凡 → 仙靠买，神品只能靠器灵', () => {
  const w = createWorld(4);
  w.phase = 'shop';
  const p = w.players[0];
  p.lingshi = 1e6;
  const offer = (o: ShopOffer) => {
    p.shop[0] = o;
    return buy(w, p, 0);
  };
  assert.equal(offer({ cat: 'weapon', kind: 'qiankun', form: 'full', tier: 1, price: 1 }), 'upgraded');
  assert.equal(p.weapons.length, 1);
  assert.equal(p.weapons[0].tier, 2);
  offer({ cat: 'weapon', kind: 'qiankun', form: 'full', tier: 2, price: 1 });
  assert.equal(p.weapons[0].tier, 3);
  assert.equal(offer({ cat: 'weapon', kind: 'qiankun', form: 'full', tier: 3, price: 1 }), null, '仙品之后买同名不再升');
  assert.equal(offer({ cat: 'spirit', kind: 'qiankun', spirit: 'split', price: 1 }), 'awakened');
  assert.equal(p.weapons[0].tier, 4);
  assert.equal(p.weapons[0].spirit, 'split');
});

test('商店：碎片是升阶材料（只对已有法宝有用，三枚升一阶）；法宝位最多 4 个；专属法宝卖不掉', () => {
  const w = createWorld(5);
  w.phase = 'shop';
  const p = w.players[0];
  p.lingshi = 1e6;
  const offer = (o: ShopOffer) => {
    p.shop[1] = o;
    return buy(w, p, 1);
  };
  assert.equal(offer({ cat: 'weapon', kind: 'leigong', form: 'fragment', tier: 1, price: 1 }), null, '没有这件法宝时碎片没用');
  assert.equal(offer({ cat: 'weapon', kind: 'huojian', form: 'full', tier: 1, price: 1 }), 'new');
  for (let i = 0; i < 2; i++) assert.equal(offer({ cat: 'weapon', kind: 'huojian', form: 'fragment', tier: 1, price: 1 }), 'fragment');
  assert.equal(offer({ cat: 'weapon', kind: 'huojian', form: 'fragment', tier: 1, price: 1 }), 'upgraded', '三枚碎片升一阶');
  assert.equal(p.weapons[1].tier, 2);
  offer({ cat: 'weapon', kind: 'leigong', form: 'full', tier: 1, price: 1 });
  offer({ cat: 'weapon', kind: 'fantian', form: 'full', tier: 1, price: 1 });
  assert.equal(p.weapons.length, MAX_WEAPONS);
  assert.equal(offer({ cat: 'weapon', kind: 'jiulong', form: 'full', tier: 1, price: 1 }), null, '位置满了买不了新法宝');
  applyCommand(w, { t: 'sell', player: 0, weapon: 0 }, []);
  assert.equal(p.weapons[0].kind, 'qiankun');
});

test('商店刷货：位置满时只出已有法宝', () => {
  const w = createWorld(6);
  w.players[0].iframes = 1e9;
  run(w, waveDuration(1) + 3.5, () => idle, false);
  assert.equal(w.phase, 'shop');
  const p = w.players[0];
  p.weapons.push(
    { kind: 'huojian', tier: 1, spirit: null, cd: 0 },
    { kind: 'leigong', tier: 1, spirit: null, cd: 0 },
    { kind: 'fantian', tier: 1, spirit: null, cd: 0 },
  );
  p.lingshi = 1e6;
  const owned = new Set(p.weapons.map((x) => x.kind));
  for (let i = 0; i < 60; i++) {
    applyCommand(w, { t: 'reroll', player: 0 }, []);
    for (const o of p.shop) if (o && (o.cat === 'weapon' || o.cat === 'spirit')) assert.ok(owned.has(o.kind), `满位时刷出了没有的 ${o.kind}`);
  }
});

test('五行：金行三件「斩杀」；火尖枪灼烧', () => {
  const w = createWorld(7);
  quiet(w);
  const p = w.players[0];
  const metal = (kind: 'zhanxian') => ({ kind, tier: 1, spirit: null, cd: 0 });
  p.weapons = [metal('zhanxian'), metal('zhanxian')]; // 金行公共法宝还只做了一件：测试里借同名件凑档（正式规则不允许重复）
  const e1 = enemy(w, 'soldier', p.x + 40, p.y, 1000);
  e1.hp = 101;
  const ev1 = run(w, 1.5);
  assert.ok(!ev1.some((e) => e.t === 'kill' && e.execute), '两件金还没有斩杀');
  p.weapons.push(metal('zhanxian')); // 测试里借第三件金凑档（正式规则不允许重复）
  w.enemies = [];
  const e2 = enemy(w, 'soldier', p.x + 40, p.y, 1000);
  e2.hp = 101;
  const ev2 = run(w, 2);
  assert.ok(ev2.some((e) => e.t === 'kill' && e.execute), '金行三件应触发斩杀');
  const w3 = createWorld(8);
  quiet(w3);
  const p3 = w3.players[0];
  p3.weapons = [{ kind: 'huojian', tier: 1, spirit: null, cd: 0 }];
  const e3 = enemy(w3, 'soldier', p3.x + 40, p3.y);
  run(w3, 0.5);
  assert.ok(e3.burnT > 0 && e3.burn > 0, '被火尖枪刺中的敌人在燃烧');
});

test('符箓：护心符挡下这一波第一次伤害；替身符挡一次致命伤', () => {
  const w = createWorld(9);
  quiet(w);
  const p = w.players[0];
  p.weapons = [];
  p.charms = ['tishen', 'huxin'];
  p.hp = 3;
  const e = enemy(w, 'soldier', p.x + 3, p.y);
  e.dmgMul = 10;
  e.speed = 40; // 被弹开后要能再走回来
  const ev = run(w, 3);
  assert.ok(ev.some((x) => x.t === 'blocked' && x.by === 'huxin'));
  assert.ok(ev.some((x) => x.t === 'blocked' && x.by === 'tishen'));
  assert.ok(ev.some((x) => x.t === 'down'), '两张符都用完之后还是会倒下');
});

test('宠物混天绫：起手就跟着，缠住敌人（减速 + 易伤）；5 级时要先选进化才能准备', () => {
  const w = createWorld(10);
  quiet(w);
  const p = w.players[0];
  p.weapons = [];
  const e = enemy(w, 'soldier', p.x + 60, p.y);
  const ev = run(w, 3);
  assert.ok(ev.some((x) => x.t === 'wrap' && x.ids.includes(e.id)));
  assert.ok(e.slowT > 0 && e.vulnT > 0);
  const w2 = createWorld(11);
  const p2 = w2.players[0];
  p2.level = 5;
  p2.iframes = 1e9;
  run(w2, waveDuration(1) + 3.5, () => idle, false);
  assert.deepEqual(p2.petOffer, ['bind', 'fire']);
  applyCommand(w2, { t: 'ready', player: 0 }, []);
  assert.equal(p2.ready, false, '没选进化不能准备');
  applyCommand(w2, { t: 'evolve', player: 0, branch: 'bind' }, []);
  assert.equal(p2.pet.stage, 1);
  assert.equal(p2.pet.branch, 'bind');
});

test('神通只有真气满才能放；放出后清掉身边一圈敌人并散出八枚乾坤圈', () => {
  const w = createWorld(12);
  quiet(w);
  const p = w.players[0];
  let ev = step(w, [{ mx: 0, my: 0, skill: true }]);
  assert.ok(!ev.some((e) => e.t === 'skill'));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    enemy(w, 'soldier', p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40, 22);
  }
  p.skill = 1;
  ev = step(w, [{ mx: 0, my: 0, skill: true }]);
  assert.ok(ev.some((e) => e.t === 'skill'));
  assert.ok(ev.filter((e) => e.t === 'kill').length >= 12);
  assert.ok(ev.filter((e) => e.t === 'throw').length >= SKILL.rings);
});

test('魔气：出了仙台越往外越慢、掉血越快，外沿走不出去', () => {
  const at = (x: number) => {
    const w = createWorld(13);
    quiet(w);
    const p = w.players[0];
    p.weapons = [];
    p.x = x;
    p.y = ARENA.h / 2;
    step(w, [idle]);
    const hp0 = p.hp;
    for (let i = 0; i < 30; i++) step(w, [{ mx: 0, my: 1, skill: false }]);
    return { moved: Math.abs(p.y - ARENA.h / 2), lost: hp0 - p.hp };
  };
  const safe = at(ARENA.w / 2);
  const shallow = at(ARENA.w + MIASMA.depth * 0.25);
  const deep = at(ARENA.w + MIASMA.depth * 0.9);
  assert.equal(safe.lost, 0);
  assert.ok(shallow.moved < safe.moved && deep.moved < shallow.moved);
  assert.ok(shallow.lost > 0 && deep.lost > shallow.lost * 3);
  const w = createWorld(14);
  quiet(w);
  const p = w.players[0];
  p.hp = p.stats.maxHp = 1e9;
  for (let i = 0; i < 600; i++) step(w, [{ mx: 1, my: 0, skill: false }]);
  assert.ok(p.x <= ARENA.w + MIASMA.depth);
  assert.ok(miasmaDepth(p.x, p.y) > 0.9);
});

test('鬼火术士：保持距离、蓄力后放鬼火；鬼火打中会掉血；法宝穿过鬼火不会把它打散', () => {
  const w = createWorld(15);
  quiet(w);
  const p = w.players[0];
  p.weapons = [];
  const c = enemy(w, 'caster', p.x + 160, p.y);
  c.speed = 24;
  c.cd = 0;
  const ev = run(w, 4);
  const cast = ev.findIndex((e) => e.t === 'cast');
  const orb = ev.findIndex((e) => e.t === 'orb');
  assert.ok(cast >= 0 && orb > cast);
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'orb'));
  assert.ok(Math.hypot(c.x - p.x, c.y - p.y) > CASTER.keepMin - 20);
  const w2 = createWorld(16);
  quiet(w2);
  const p2 = w2.players[0];
  enemy(w2, 'soldier', p2.x + 100, p2.y);
  w2.orbs.push({ id: 9001, x: p2.x + 50, y: p2.y - 10, px: 0, py: 0, vx: 0, vy: 0, life: 9, dmg: 8 });
  const ev2 = run(w2, 1);
  assert.ok(ev2.some((e) => e.t === 'throw'), '乾坤圈照常出手');
  assert.ok(!ev2.some((e) => e.t === 'dispel'));
  assert.ok(w2.orbs.some((o) => o.id === 9001), '鬼火还在');
});
