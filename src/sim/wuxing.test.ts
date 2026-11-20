// 五行的构筑（sim/wuxing.ts、core.hitEnemy / onKill；用户 2026-11-12 的方向）：
// 宠物带另一行、算一件；同行三件 / 四件的质变；三才 / 四象 / 五行俱全；不会无限循环；整局快照恢复逐帧相同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT } from './config.ts';
import { HEROES, MARK_T, WX } from './catalog.ts';
import { elementCounts, hitEnemy } from './core.ts';
import { distinctOf, wxSetOf } from './wuxing.ts';
import { HERO_IDS } from './heroes/index.ts';
import { botInput, botShop } from './bot.ts';
import { restore, snapshot } from './snapshot.ts';
import type { EnemyKindName, HeroId, Player, WeaponKind } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const quiet = (w: World) => {
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
};
/** 干净的测试场：刷怪关掉、宠物不出手、人物无敌、只带给定的法宝（凡品，冷却拉满：不自己出手）。 */
const arena = (seed: number, weapons: WeaponKind[], hero: HeroId = 'nezha') => {
  const w = createWorld(seed, 1, [hero]);
  quiet(w);
  const p = w.players[0];
  p.weapons = weapons.map((kind) => ({ kind, tier: 1, spirit: null, cd: 1e9 }));
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  return { w, p };
};
const enemy = (w: World, x: number, y: number, hp = 9999, kind: EnemyKindName = 'soldier') => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
const run = (w: World, seconds: number, input: PlayerInput = idle) => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(w, [input]));
  return ev;
};
const hit = (w: World, p: Player, e: ReturnType<typeof enemy>, dmg: number, el: Parameters<typeof hitEnemy>[2]['el'], by: Parameters<typeof hitEnemy>[2]['by'] = 'ring') => {
  const ev: SimEvent[] = [];
  const d = hitEnemy(w, e, { dmg, by, owner: p.id, from: p, el, canCrit: false }, ev);
  return { d, ev };
};

// ---------------------------------------------------------------- 宠物的五行

test('宠物的五行：每个角色一行，按宠物的来历定；同一种宠物的变异版跟着本体（用户 11-12）', () => {
  const want: Record<HeroId, string> = { nezha: 'water', mozha: 'water', yangjian: 'earth', zhao: 'wood', huizhao: 'wood', yunxiao: 'water', huiyun: 'water', leizhenzi: 'metal', wukong: 'earth', huiao: 'water' };
  for (const h of HERO_IDS) {
    assert.equal(HEROES[h].petEl, want[h], `${HEROES[h].name} 的宠物`);
    // 宠物的五行按宠物自己的来历定，不一定和主人相生（用户 11-12）；除了敖丙（龙族一身水），都和主五行不同，凑得出五行俱全
    if (h !== 'huiao') assert.notEqual(HEROES[h].petEl, HEROES[h].el, `${HEROES[h].name}：宠物和主五行不同`);
  }
  for (const a of HERO_IDS) for (const b of HERO_IDS) if (HEROES[a].petKind === HEROES[b].petKind && a !== 'huiao' && b !== 'huiao') assert.equal(HEROES[a].petEl, HEROES[b].petEl);
});

test('宠物算一件：开局专属法宝的主五行 + 宠物那一行各一件；没有宠物就不算；联机每个人算自己的', () => {
  const { p } = arena(1, ['qiankun']);
  const ec = elementCounts(p);
  assert.deepEqual(ec, { metal: 0, wood: 0, water: 1, fire: 1, earth: 0 });
  (p as { pet?: unknown }).pet = undefined;
  assert.deepEqual(elementCounts(p), { metal: 0, wood: 0, water: 0, fire: 1, earth: 0 });
  const w = createWorld(2, 2, ['nezha', 'yangjian']);
  assert.equal(elementCounts(w.players[0]).water, 1, '哪吒的混天绫是水行');
  assert.equal(elementCounts(w.players[0]).earth, 0);
  assert.equal(elementCounts(w.players[1]).earth, 1, '杨戬的哮天犬是土行');
  assert.equal(elementCounts(w.players[1]).metal, 1, '杨戬的三尖两刃刀是金行');
});

test('每只宠物给敌人打的印记是宠物自己的五行', () => {
  for (const h of HERO_IDS) {
    const w = createWorld(5, 1, [h]);
    quiet(w);
    const p = w.players[0];
    p.weapons = [];
    p.iframes = 1e12;
    const es = Array.from({ length: 12 }, (_, i) => enemy(w, p.x + Math.cos(i * 0.52) * (34 + (i % 2) * 14), p.y + Math.sin(i * 0.52) * (34 + (i % 2) * 14))); // 围一圈：贴地宠物的出手范围是以它自己为心
    const marks = new Set<string>();
    for (let i = 0; i < 60 * 8; i++) {
      step(w, [idle]);
      for (const e of es) if (e.mark && e.markT > 0) marks.add(e.mark);
    }
    assert.ok(marks.size > 0, `${HEROES[h].pet} 打上了印记`);
    assert.deepEqual([...marks], [HEROES[h].petEl], `${HEROES[h].pet} 打的是 ${HEROES[h].petEl}`);
  }
});

// ---------------------------------------------------------------- 同行：三件、四件

test('金行三件「斩杀」：斩杀线 15%（两件没有）；斩时迸出一道金气斩身边一只，金气斩死的不再迸；四件 20%、两道', () => {
  // 两件：血量 14% 不斩
  {
    const { w, p } = arena(10, ['zhanxian', 'dashen']);
    const e = enemy(w, 300, 300, 100);
    e.hp = 15;
    hit(w, p, e, 1, 'metal');
    assert.equal(e.hp, 14);
  }
  const { w, p } = arena(11, ['zhanxian', 'dashen', 'huaxue']);
  p.x = 300;
  p.y = 300;
  const e = enemy(w, 300, 300, 100);
  const o1 = enemy(w, 320, 300, 100);
  const o2 = enemy(w, 330, 310, 100);
  e.hp = 15;
  o1.hp = 64; // 金气（最大气血 100 × 0.5 = 50）打下去剩 14：再按斩杀线判一次 → 斩
  o2.hp = 10;
  const { ev } = hit(w, p, e, 1, 'metal');
  assert.equal(e.hp, 0, '14% 被斩');
  const jq = ev.filter((x) => x.t === 'wx' && x.kind === 'jinqi');
  assert.equal(jq.length, 1, '只迸一道（金气斩死的不再迸）');
  assert.deepEqual((jq[0] as { ids: number[] }).ids, [o1.id], '斩最近的一只');
  assert.equal(o1.hp, 0, '金气 50 打到 14、低于斩杀线被斩');
  assert.equal(o2.hp, 10, '没有第二道');
  assert.ok(ev.some((x) => x.t === 'hit' && x.id === o1.id && x.by === 'wx'));
  assert.equal(o1.mark, null, '金气不打印记');
  // 四件（三件法宝 + 雷鹏是金行宠物）：20%、两道
  const b = arena(12, ['zhanxian', 'dashen', 'huaxue'], 'leizhenzi');
  assert.equal(elementCounts(b.p).metal, 4);
  b.p.x = 300;
  b.p.y = 300;
  const e2 = enemy(b.w, 300, 300, 100);
  enemy(b.w, 320, 300, 1000);
  enemy(b.w, 330, 300, 1000);
  e2.hp = 20;
  const r = hit(b.w, b.p, e2, 1, 'metal');
  assert.equal(e2.hp, 0, '19% 被斩');
  const jq2 = r.ev.filter((x) => x.t === 'wx' && x.kind === 'jinqi');
  assert.equal(jq2.length, 1);
  assert.equal((jq2[0] as { ids: number[] }).ids.length, 2, '两道');
});

test('木行三件「生生不息」：击杀时冒出藤蔓缠住身边几只（减速、受伤加深）；有冷却；被爆炸打死的不冒；四件多缠、先定住', () => {
  const { w, p } = arena(20, ['leigong', 'dingfeng', 'miaoshu'], 'yangjian');
  const e = enemy(w, 300, 300, 10);
  const near = [enemy(w, 310, 300), enemy(w, 290, 300), enemy(w, 300, 312), enemy(w, 300, 288)];
  const { ev } = hit(w, p, e, 50, 'wood');
  const v = ev.find((x) => x.t === 'wx' && x.kind === 'vine') as { ids: number[] } | undefined;
  assert.ok(v, '冒出藤蔓');
  assert.equal(v.ids.length, WX.vine.n[3]);
  for (const id of v.ids) {
    const o = near.find((x) => x.id === id)!;
    assert.ok(o.slow >= WX.vine.slow && o.slowT > 0 && o.tangle === WX.vine.vuln && o.tangleUntil! > w.time, '减速、受伤加深');
    assert.equal(o.stun, 0, '三件不定身');
  }
  // 冷却里再打死一只：不冒
  const e2 = enemy(w, 300, 300, 10);
  assert.ok(!hit(w, p, e2, 50, 'wood').ev.some((x) => x.t === 'wx'), '冷却里不冒');
  run(w, WX.vine.cd + 0.05);
  // 被爆炸（余波）打死的：不冒
  const e3 = enemy(w, 300, 300, 10);
  assert.ok(!hit(w, p, e3, 50, 'fire', 'explode').ev.some((x) => x.t === 'wx'), '余波打死的不冒');
  const e4 = enemy(w, 300, 300, 10);
  assert.ok(hit(w, p, e4, 50, 'wood').ev.some((x) => x.t === 'wx' && x.kind === 'vine'), '冷却好了再冒');
  // 四件（三件法宝 + 黑虎是木行宠物）：缠五只、先定住
  const b = arena(21, ['leigong', 'dingfeng', 'miaoshu'], 'zhao');
  assert.equal(elementCounts(b.p).wood, 4);
  const k = enemy(b.w, 300, 300, 10);
  for (let i = 0; i < 6; i++) enemy(b.w, 300 + Math.cos(i) * 14, 300 + Math.sin(i) * 14);
  const r = hit(b.w, b.p, k, 50, 'wood').ev.find((x) => x.t === 'wx') as { ids: number[] };
  assert.equal(r.ids.length, WX.vine.n[4]);
  for (const id of r.ids) assert.ok(b.w.enemies.find((x) => x.id === id)!.stun >= WX.vine.root[4] - 1e-9, '先定住');
});

test('水行三件「寒彻」冻住的受伤 ×2，四件 ×2.5', () => {
  const dmgOn = (weapons: WeaponKind[], hero: HeroId) => {
    const { w, p } = arena(30, weapons, hero);
    const e = enemy(w, 300, 300);
    e.frozen = 1;
    return hit(w, p, e, 100, 'metal').d;
  };
  // 杨戬：金 + 哮天犬土；三件水法宝 = 水三
  assert.equal(dmgOn(['hanbing', 'yinyang', 'xuanyuan'], 'yangjian'), 200);
  // 哪吒：混天绫是水行 → 三件水法宝 + 宠物 = 水四
  assert.equal(dmgOn(['hanbing', 'yinyang', 'xuanyuan'], 'nezha'), 250);
  assert.equal(dmgOn(['hanbing', 'yinyang'], 'yangjian'), 100, '两件没有');
});

test('火行三件「燎原」：烧着死的炸开；被炸死的不再炸开（一帧里不连环）；四件炸得更大', () => {
  const { w, p } = arena(40, ['huojian', 'jiulong', 'wuhuo']);
  // 一大团都烧着、一碰就死：打死中间那只，只炸一次
  const pile = Array.from({ length: 40 }, (_, i) => enemy(w, 300 + (i % 8) * 4, 300 + Math.floor(i / 8) * 4, 5));
  for (const e of pile) {
    e.burn = 10;
    e.burnT = 2;
  }
  const { ev } = hit(w, p, pile[20], 50, 'fire');
  const ex = ev.filter((x) => x.t === 'explode');
  assert.equal(ex.length, 1, `只炸一次（实际 ${ex.length}）`);
  assert.equal((ex[0] as { r: number }).r, WX.blaze.r[3]);
  assert.ok(pile.filter((e) => e.hp <= 0).length > 5, '炸死了一片');
  // 四件（四件火行法宝；宠物里没有火行的了）
  const b = arena(41, ['huojian', 'jiulong', 'wuhuo', 'yanguang']);
  assert.equal(elementCounts(b.p).fire, 4);
  const e = enemy(b.w, 300, 300, 5);
  e.burn = 10;
  e.burnT = 2;
  const r = hit(b.w, b.p, e, 50, 'fire').ev.find((x) => x.t === 'explode') as { r: number };
  assert.equal(r.r, WX.blaze.r[4]);
});

test('火行燎原的连环跨帧：炸开点着的火要等它自己烧死人才再炸，每一帧最多一层', () => {
  const { w, p } = arena(42, ['huojian', 'jiulong', 'wuhuo']);
  p.x = 100;
  p.y = 100;
  const pile = Array.from({ length: 60 }, (_, i) => enemy(w, 300 + (i % 10) * 6, 300 + Math.floor(i / 10) * 6, 30));
  pile[0].burn = 40;
  pile[0].burnT = 3;
  let maxPerFrame = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const ev = step(w, [idle]);
    maxPerFrame = Math.max(maxPerFrame, ev.filter((x) => x.t === 'explode').length);
  }
  assert.ok(maxPerFrame <= 10, `一帧里最多炸 ${maxPerFrame} 次`);
});

test('土行三件：站稳 1.5 秒震地一圈（土行伤害、击退、不打印记、不相生），站着不动每隔一会儿一圈，走动就重新算', () => {
  const { w, p } = arena(50, ['fantian', 'xiangmo', 'wuguang']);
  const e = enemy(w, p.x + 30, p.y, 5000);
  e.mark = 'fire'; // 火生土「熔岩」：震地打上去也不触发
  e.markT = 99;
  const ev1 = run(w, WX.quake.still - 0.1);
  assert.ok(!ev1.some((x) => x.t === 'wx'), '还没站稳');
  const ev2 = run(w, 0.2);
  const q = ev2.filter((x) => x.t === 'wx' && x.kind === 'quake');
  assert.equal(q.length, 1, '震了一圈');
  assert.ok(ev2.some((x) => x.t === 'hit' && x.id === e.id && x.by === 'wx'), '打到了');
  assert.ok(!ev2.some((x) => x.t === 'react'), '不相生');
  assert.equal(e.mark, 'fire', '印记还在（没被消耗、没被覆盖）');
  const ev3 = run(w, WX.quake.cd[3] + 0.05);
  assert.equal(ev3.filter((x) => x.t === 'wx' && x.kind === 'quake').length, 1, '每隔一会儿一圈');
  run(w, 0.3, { mx: 1, my: 0, skill: false });
  const ev4 = run(w, WX.quake.still - 0.2);
  assert.ok(!ev4.some((x) => x.t === 'wx'), '走动之后要重新站稳');
  // 两件没有
  const b = arena(51, ['fantian', 'xiangmo']);
  assert.ok(!run(b.w, 4).some((x) => x.t === 'wx'));
});

// ---------------------------------------------------------------- 异行：三才、四象、五行俱全

test('三才 / 四象：相生的伤害 +20% / +40%，四象起印记更久（件数里算宠物）', () => {
  const frostDmg = (weapons: WeaponKind[]) => {
    const { w, p } = arena(60, weapons);
    const e = enemy(w, 300, 300);
    e.mark = 'metal';
    e.markT = 1;
    const r = hit(w, p, e, 100, 'water');
    assert.ok(r.ev.some((x) => x.t === 'react' && x.kind === 'frost'));
    return { d: r.d, markT: e.markT, n: distinctOf(elementCounts(p)) };
  };
  const two = frostDmg(['qiankun']); // 火 + 水（宠物）
  const three = frostDmg(['qiankun', 'zhanxian']); // + 金
  const four = frostDmg(['qiankun', 'zhanxian', 'fantian']); // + 土
  assert.deepEqual([two.n, three.n, four.n], [2, 3, 4]);
  assert.equal(two.d, 200);
  assert.equal(three.d, 240);
  assert.equal(four.d, 280);
  assert.ok(Math.abs(two.markT - MARK_T) < 1e-9 && Math.abs(three.markT - MARK_T) < 1e-9);
  assert.ok(Math.abs(four.markT - MARK_T * 1.5) < 1e-9, '四象：印记 +50%');
});

test('五行俱全：相生不挑顺序（触发打进这一行的那种），同一只相生后 0.5 秒内不再相生；凑不齐时照旧挑顺序', () => {
  // 哪吒：乾坤圈火 + 混天绫水 + 金 木 土各一件
  const { w, p } = arena(70, ['qiankun', 'zhanxian', 'leigong', 'fantian']);
  assert.equal(wxSetOf(elementCounts(p))?.n, 5);
  const e = enemy(w, 300, 300);
  e.mark = 'fire'; // 火 → 水本来不相生
  e.markT = 2;
  const r1 = hit(w, p, e, 100, 'water');
  const re = r1.ev.find((x) => x.t === 'react') as { kind: string } | undefined;
  assert.equal(re?.kind, 'frost', '打出这一下的是水：凝霜');
  assert.equal(e.mark, 'water');
  // 冷却里：带着水印记被土打中（俱全下本该「熔岩」）也不相生
  const r2 = hit(w, p, e, 100, 'earth');
  assert.ok(!r2.ev.some((x) => x.t === 'react'), '冷却里不相生');
  assert.equal(e.mark, 'earth', '印记照常换成这一下的');
  run(w, WX.cd + 0.02);
  e.markT = 2;
  const r3 = hit(w, p, e, 100, 'fire');
  assert.equal((r3.ev.find((x) => x.t === 'react') as { kind: string } | undefined)?.kind, 'ignite', '冷却过了：打出这一下的是火 → 引燃');
  // 同一行的印记不相生
  run(w, WX.cd + 0.02);
  e.mark = 'fire';
  e.markT = 2;
  assert.ok(!hit(w, p, e, 100, 'fire').ev.some((x) => x.t === 'react'));
  // 四象：火 → 水不相生
  const b = arena(71, ['qiankun', 'zhanxian', 'leigong']);
  const e2 = enemy(b.w, 300, 300);
  e2.mark = 'fire';
  e2.markT = 2;
  assert.ok(!hit(b.w, b.p, e2, 100, 'water').ev.some((x) => x.t === 'react'));
});

test('不会无限循环：五行俱全一大群敌人身上都带印记，一下打进去只相生有限次；相生打出的伤害不再相生', () => {
  const { w, p } = arena(72, ['qiankun', 'zhanxian', 'leigong', 'fantian']);
  const els = ['metal', 'wood', 'fire', 'earth', 'water'] as const;
  const pile = Array.from({ length: 50 }, (_, i) => {
    const e = enemy(w, 300 + (i % 10) * 5, 300 + Math.floor(i / 10) * 5, 3000);
    e.mark = els[i % 5];
    e.markT = 5;
    return e;
  });
  const { ev } = hit(w, p, pile[0], 200, 'water');
  assert.equal(ev.filter((x) => x.t === 'react').length, 1, '导雷 / 熔岩的余波（by react）不再相生');
  // 跑几秒，宠物、法宝都出手：每只敌人每 0.5 秒最多相生一次
  for (const x of p.weapons) x.cd = 0;
  p.pet.cd = 0;
  const last = new Map<number, number>();
  for (let i = 0; i < 60 * 4; i++) {
    for (const x of step(w, [idle]))
      if (x.t === 'react') {
        const t0 = last.get(x.id);
        assert.ok(t0 === undefined || w.time - t0 >= WX.cd - 1e-6, `同一只 ${w.time - (t0 ?? 0)} 秒里相生了两次`);
        last.set(x.id, w.time);
      }
  }
});

// ---------------------------------------------------------------- 确定性

test('确定性：五行俱全、金四、土三的构筑，整局快照存下来恢复后逐帧相同', () => {
  const builds: { hero: HeroId; weapons: WeaponKind[]; want: string }[] = [
    { hero: 'nezha', weapons: ['qiankun', 'zhanxian', 'leigong', 'fantian'], want: 'react' },
    { hero: 'leizhenzi', weapons: ['huangjin', 'zhanxian', 'dashen', 'huaxue'], want: 'jinqi' },
    { hero: 'zhao', weapons: ['dinghai', 'fantian', 'xiangmo', 'leigong'], want: 'quake' },
  ];
  for (const b of builds) {
    const w = createWorld(90, 1, [b.hero]);
    const p = w.players[0];
    p.weapons = b.weapons.map((kind) => ({ kind, tier: 2, spirit: null, cd: 0.5 }));
    p.hp = p.stats.maxHp = 2000;
    const frame = (i: number) => {
      const cmds = w.phase === 'shop' ? botShop(w, 0) : [];
      return step(w, [i % 240 < 120 ? idle : botInput(w, 0)], cmds); // 站一会儿走一会儿：土三震地也出现
    };
    let seen = 0;
    for (let i = 0; i < 60 * 25; i++) for (const e of frame(i)) if (e.t === b.want || (e.t === 'wx' && e.kind === b.want)) seen++;
    assert.ok(seen > 0, `${b.hero}：存档之前出现过 ${b.want}`);
    const b2 = restore(JSON.parse(JSON.stringify(snapshot(w))));
    const evA: string[] = [];
    const dA: string[] = [];
    for (let i = 0; i < 600; i++) {
      evA.push(JSON.stringify(frame(i)));
      dA.push(digest(w));
    }
    for (let i = 0; i < 600; i++) {
      const cmds = b2.phase === 'shop' ? botShop(b2, 0) : [];
      const ev = step(b2, [i % 240 < 120 ? idle : botInput(b2, 0)], cmds);
      assert.equal(JSON.stringify(ev), evA[i], `${b.hero}：第 ${i + 1} 帧事件不同`);
      assert.equal(digest(b2), dA[i], `${b.hero}：第 ${i + 1} 帧状态不同`);
    }
  }
});
