import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, VACUUM_VALUE, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, SKILL } from './config.ts';
import { LINGZHU, MARK_T, chapterOf, waveDuration } from './catalog.ts';
import { addBurn, buildGrid, hitEnemy, hurtPlayer } from './core.ts';
import { botInput, botShop } from './bot.ts';
import { TECH, TECHNIQUES, TECH_IDS, TECH_LEVELS, botTechnique, learnTechnique, offerTechnique, techDue } from './techniques.ts';
import { applyCommand, rerollCost } from './shop.ts';
import type { EnemyKindName, Player, TechniqueId, WeaponKind } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 普通波里关掉刷怪。 */
const quiet = (w: World) => {
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
};
/** 干净的测试场：刷怪关掉、宠物不出手、人物无敌、只带给定的法宝、已悟给定的功法。 */
const arena = (seed: number, techs: TechniqueId[] = [], weapons: { kind: WeaponKind; tier: number }[] = []) => {
  const w = createWorld(seed);
  quiet(w);
  const p = w.players[0];
  p.weapons = weapons.map((x) => ({ kind: x.kind, tier: x.tier, spirit: null, cd: 0 }));
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  for (const id of techs) give(p, id);
  return { w, p };
};
/** 直接悟一门（绕过三选一）：和 learnTechnique 一样加属性。 */
const give = (p: Player, id: TechniqueId) => {
  p.techs.push(id);
  TECHNIQUES[id].apply?.(p.stats);
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 9999) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
/** 进商店（跑完第 1 波，人物无敌、不出手）。 */
const toShop = (seed: number, level: number) => {
  const w = createWorld(seed);
  const p = w.players[0];
  p.level = level;
  p.iframes = 1e9;
  p.weapons = [];
  run(w, waveDuration(1) + 3.5);
  assert.equal(w.phase, 'shop');
  return { w, p };
};

// ---------- 门槛与三选一 ----------

test('功法：升到 3 级的那一波之后出三选一（三门互不相同），悟完才能选属性、才能出战', () => {
  const low = toShop(31, 2);
  assert.equal(low.p.techOffer, null, '不到 3 级不出');
  const { w, p } = toShop(32, 3);
  assert.ok(p.techOffer && p.techOffer.length === 3, '到了 3 级出三选一');
  assert.equal(new Set(p.techOffer).size, 3, '三门互不相同');
  // 没悟完：不能选属性、不能出战
  if (p.pendingLevels > 0) {
    const before = p.pendingLevels;
    applyCommand(w, { t: 'pick', player: 0, index: 0 }, []);
    assert.equal(p.pendingLevels, before, '要先悟功法再选属性');
  }
  applyCommand(w, { t: 'ready', player: 0 }, []);
  assert.equal(p.ready, false, '没悟功法不能出战');
  // 不在选项里的悟不了
  const other = TECH_IDS.find((id) => !p.techOffer!.includes(id))!;
  applyCommand(w, { t: 'learn', player: 0, id: other }, []);
  assert.deepEqual(p.techs, []);
  const ev: SimEvent[] = [];
  const id = p.techOffer[1];
  applyCommand(w, { t: 'learn', player: 0, id }, ev);
  assert.deepEqual(p.techs, [id]);
  assert.equal(p.techOffer, null);
  assert.ok(ev.some((e) => e.t === 'learn' && e.kind === id));
  while (p.pendingLevels > 0) applyCommand(w, { t: 'pick', player: 0, index: 0 }, []);
  applyCommand(w, { t: 'ready', player: 0 }, []);
  assert.equal(p.ready, true);
});

test('功法：门槛是 3 / 8 / 12 / 14 级，和混天绫进化（5 / 10 / 15）错开；一波跨过两个门槛就依次悟两门，第二组不含已悟的', () => {
  assert.deepEqual(TECH_LEVELS, [3, 8, 12, 14]);
  const { w, p } = toShop(33, 9);
  assert.equal(techDue(p), 2);
  // 9 级也到了宠物第一次进化：先进化，再悟功法
  assert.ok(p.petOffer);
  const first = p.techOffer![0];
  applyCommand(w, { t: 'learn', player: 0, id: first }, []);
  assert.deepEqual(p.techs, [], '宠物进化没选之前不能悟');
  applyCommand(w, { t: 'evolve', player: 0, branch: 'fire' }, []);
  applyCommand(w, { t: 'learn', player: 0, id: first }, []);
  assert.deepEqual(p.techs, [first]);
  assert.ok(p.techOffer && p.techOffer.length === 3, '接着出第二组');
  assert.ok(!p.techOffer.includes(first), '第二组里没有已悟的');
  applyCommand(w, { t: 'learn', player: 0, id: p.techOffer[2] }, []);
  assert.equal(p.techs.length, 2);
  assert.equal(p.techOffer, null, '两门都悟完了');
  assert.equal(techDue(p), 0);
});

test('功法：不能重复 —— 悟满四门，每一组三选一都不含已悟的；全部 24 门都能出现', () => {
  const seen = new Set<TechniqueId>();
  for (let s = 0; s < 40; s++) {
    const w = createWorld(100 + s);
    w.phase = 'shop';
    const p = w.players[0];
    p.level = TECH_LEVELS[TECH_LEVELS.length - 1]; // 刚到最后一个门槛：四门都该悟了
    offerTechnique(w, p);
    while (p.techOffer) {
      assert.equal(p.techOffer.length, 3);
      assert.equal(new Set(p.techOffer).size, 3);
      for (const id of p.techOffer) {
        assert.ok(!p.techs.includes(id), `又出了已悟的 ${id}`);
        seen.add(id);
      }
      learnTechnique(w, p, p.techOffer[s % 3], []);
    }
    assert.equal(p.techs.length, 4);
    assert.equal(new Set(p.techs).size, 4);
    learnTechnique(w, p, p.techs[0], []);
    assert.equal(p.techs.length, 4, '已悟的不能再悟');
  }
  assert.equal(seen.size, TECH_IDS.length, `${TECH_IDS.length} 门都出现过`);
});

test('功法：三选一稍微偏向已经带的五行（带三件水行时寒冰诀更常出），但不强制', () => {
  const count = (water: number) => {
    let n = 0;
    for (let s = 0; s < 600; s++) {
      const w = createWorld(500 + s);
      const p = w.players[0];
      p.hero = 'yangjian'; // 宠物算一件：哪吒的混天绫是水行，「不带水行」要换一个宠物不是水行的角色（杨戬的哮天犬是土行）
      p.level = 3;
      p.weapons = [{ kind: 'qiankun', tier: 1, spirit: null, cd: 0 }, ...Array.from({ length: water }, () => ({ kind: 'hanbing' as const, tier: 1, spirit: null, cd: 0 }))];
      offerTechnique(w, p);
      if (p.techOffer!.includes('hanjue')) n++;
    }
    return n / 600;
  };
  const none = count(0);
  const three = count(3);
  assert.ok(none > 0.07 && none < 0.2, `不带水行时约八分之一（二十四选三；实际 ${none}）`);
  assert.ok(three > none * 1.3, `带了水行更常出（${none} → ${three}）`);
  assert.ok(three < 0.45, `只是偏向，不是必出（${three}）`);
});

// ---------- 每门功法各自生效 ----------

test('三昧真火：灼烧伤害 +50%（加在累积的跳伤害上，身上的灼烧值不变、不会越传越旺）；带火死去的敌人把火传给身边的敌人', () => {
  const a = arena(41);
  const b = arena(41, ['sanmei']);
  const ea = enemy(a.w, 'soldier', 300, 300);
  const eb = enemy(b.w, 'soldier', 300, 300);
  addBurn(a.w, ea, 0, 10, 2);
  addBurn(b.w, eb, 0, 10, 2);
  assert.equal(eb.burn, ea.burn, '灼烧值不变');
  // 烧两秒：掉的血是一倍半（小火也一样，不因为每跳取整变成翻倍）
  for (const dps of [4, 30]) {
    const hpA = ea.hp;
    const hpB = eb.hp;
    addBurn(a.w, ea, 0, dps, 2);
    addBurn(b.w, eb, 0, dps, 2);
    ea.burn = eb.burn = dps;
    run(a.w, 2.1);
    run(b.w, 2.1);
    const ratio = (hpB - eb.hp) / (hpA - ea.hp);
    assert.ok(ratio > 1.4 && ratio < 1.6, `每秒 ${dps} 的灼烧：烧掉的血 ×${ratio.toFixed(2)}`);
  }
  // 传火：一只带火的被打死，身边的烧起来
  const { w } = b;
  const near = enemy(w, 'soldier', 316, 300);
  const far = enemy(w, 'soldier', 420, 300);
  addBurn(w, eb, 0, 10, 2);
  eb.hp = 5;
  buildGrid(w.enemies);
  const ev: SimEvent[] = [];
  hitEnemy(w, eb, { dmg: 50, by: 'ring', owner: 0, from: { x: 290, y: 300 } }, ev);
  assert.ok(eb.hp <= 0);
  assert.ok(near.burnT > 0 && near.burn > 0, '身边的被点着');
  assert.equal(far.burnT, 0, '远处的不受影响');
  assert.ok(ev.some((e) => e.t === 'tech' && e.kind === 'sanmei'));
  // 没悟的不传
  const c = arena(42);
  const ec = enemy(c.w, 'soldier', 300, 300, 5);
  const nc = enemy(c.w, 'soldier', 316, 300);
  addBurn(c.w, ec, 0, 10, 2);
  buildGrid(c.w.enemies);
  hitEnemy(c.w, ec, { dmg: 50, by: 'ring', owner: 0, from: { x: 290, y: 300 } }, []);
  assert.equal(nc.burnT, 0);
});

test('莲花化身：致命伤时重生（回一半气血、震开身边的敌人），每章只有一次；下一章又能用；魔气里倒下也能救', () => {
  const { w, p } = arena(43, ['lianhua']);
  p.iframes = 0;
  const e = enemy(w, 'soldier', p.x + 20, p.y);
  p.hp = 5;
  const ev: SimEvent[] = [];
  hurtPlayer(w, p, 50, 'contact', ev);
  assert.ok(p.alive, '没有倒下');
  assert.equal(p.hp, Math.round(p.stats.maxHp * TECH.lianhua.hp));
  assert.ok(p.iframes >= TECH.lianhua.iframes - 1e-9, '重生后无敌片刻');
  assert.ok(ev.some((x) => x.t === 'tech' && x.kind === 'lianhua'));
  assert.ok(!ev.some((x) => x.t === 'down'));
  assert.ok(e.kx > 0, '身边的敌人被震开');
  // 同一章第二次：倒下
  p.iframes = 0;
  p.hp = 5;
  const ev2: SimEvent[] = [];
  hurtPlayer(w, p, 50, 'contact', ev2);
  assert.ok(!p.alive, '同一章只救一次');
  assert.ok(ev2.some((x) => x.t === 'down'));
  // 下一章：又能救
  p.alive = true;
  p.iframes = 0;
  p.hp = 5;
  w.wave = 8;
  assert.equal(chapterOf(w.wave), 2);
  hurtPlayer(w, p, 50, 'contact', []);
  assert.ok(p.alive, '新的一章又能重生一次');
  // 魔气：站在魔气最深处，气血耗尽时也被救下
  const m = arena(44, ['lianhua']);
  m.p.x = m.p.px = -60;
  m.p.hp = 2;
  const ev3 = run(m.w, 0.5);
  assert.ok(m.p.alive);
  assert.ok(ev3.some((x) => x.t === 'tech' && x.kind === 'lianhua'));
});

test('风火轮：移速 +20%；走过的地方留下火痕，点燃踩上去的敌人；站着不动不留', () => {
  const a = arena(45);
  const b = arena(45, ['fenghuo']);
  assert.ok(Math.abs(b.p.stats.speed - a.p.stats.speed - TECH.fenghuo.speed) < 1e-9);
  const right: PlayerInput = { mx: 1, my: 0, skill: false };
  const x0 = b.p.x;
  run(b.w, 0.5, () => right);
  const xa0 = a.p.x;
  run(a.w, 0.5, () => right);
  assert.ok(b.p.x - x0 > (a.p.x - xa0) * 1.15, '走得更快');
  const trail = b.p.tech!.trail;
  assert.ok(trail.length >= 5, `留下了一串火点（${trail.length}）`);
  // 敌人站在走过的路上：被点着
  const e = enemy(b.w, 'soldier', (x0 + b.p.x) / 2, b.p.y);
  run(b.w, 0.4);
  assert.ok(e.burnT > 0, '踩在火痕上的敌人烧起来');
  // 火痕过一会儿就灭；站着不动不留新的
  run(b.w, TECH.fenghuo.life + 0.2);
  assert.equal(b.p.tech!.trail.length, 0);
  // 没悟的不留
  assert.equal(a.p.tech, undefined);
});

test('混元一气：击杀的真气 +50%；神通范围 +30%', () => {
  const a = arena(46);
  const b = arena(46, ['hunyuan']);
  for (const { w } of [a, b]) {
    const e = enemy(w, 'soldier', 300, 300, 5);
    buildGrid(w.enemies);
    hitEnemy(w, e, { dmg: 50, by: 'ring', owner: 0, from: { x: 290, y: 300 } }, []);
  }
  // 哪吒「灵珠子」的 +LINGZHU.charge 两边都有，混元一气再加 hunyuan.charge − 1
  assert.ok(Math.abs(a.p.skill - SKILL.chargePerKill * (1 + LINGZHU.charge)) < 1e-9);
  assert.ok(Math.abs(b.p.skill - SKILL.chargePerKill * (TECH.hunyuan.charge + LINGZHU.charge)) < 1e-9);
  // 神通：放在原范围之外、加大后的范围之内的敌人
  const at = SKILL.radius * 1.15;
  for (const [{ w, p }, want] of [
    [a, false],
    [b, true],
  ] as const) {
    const e = enemy(w, 'soldier', p.x + at, p.y);
    p.skill = 1;
    const ev = step(w, [{ mx: 0, my: 0, skill: true }]);
    assert.equal(ev.some((x) => x.t === 'hit' && x.id === e.id && x.by === 'skill'), want);
  }
});

test('金刚不坏：护体 +4；挨打时约三成几率把伤害反弹给身边的敌人（身边没有就打最近的一只）', () => {
  const a = arena(47);
  const b = arena(47, ['jingang']);
  assert.equal(b.p.stats.armor - a.p.stats.armor, TECH.jingang.armor);
  const { w, p } = b;
  const e = enemy(w, 'soldier', p.x + 6, p.y, 1e6);
  let refl = 0;
  for (let i = 0; i < 200; i++) {
    p.iframes = 0;
    p.hp = p.stats.maxHp;
    const ev: SimEvent[] = [];
    hurtPlayer(w, p, 6, 'contact', ev);
    if (ev.some((x) => x.t === 'tech' && x.kind === 'jingang')) refl++;
  }
  assert.ok(refl > 35 && refl < 90, `约三成（${refl}/200）`);
  assert.ok(e.hp < 1e6, '身边的敌人挨了反弹');
  // 被远处打中：反弹打向最近的一只（射程以内：REACH.seek）
  const c = arena(48, ['jingang']);
  const far = enemy(c.w, 'caster', c.p.x + 120, c.p.y, 1e6);
  for (let i = 0; i < 40; i++) {
    c.p.iframes = 0;
    c.p.hp = c.p.stats.maxHp;
    hurtPlayer(c.w, c.p, 8, 'orb', []);
  }
  assert.ok(far.hp < 1e6, '远处的施法者挨了反弹');
});

test('五雷正法：每波开头片刻后在附近血最厚的敌人头顶聚云、落雷（不是最近的那只），之后每 6 秒一道', () => {
  const { w, p } = arena(49, ['wulei']);
  const near = enemy(w, 'soldier', p.x + 30, p.y, 200);
  const thick = enemy(w, 'soldier', p.x + 120, p.y, 900);
  p.tech = undefined;
  const ev = run(w, TECH.wulei.first + TECH.wulei.warn + 0.1);
  const warn = ev.find((x) => x.t === 'tech' && x.kind === 'wulei' && x.act === 'warn');
  assert.ok(warn && warn.t === 'tech' && warn.id === thick.id, '劈血最厚的');
  assert.ok(ev.some((x) => x.t === 'tech' && x.kind === 'wulei' && x.act === 'strike'));
  assert.ok(thick.hp < 900, '打中了');
  assert.equal(near.hp, 200, '近处那只不在波及范围里');
  const ev2 = run(w, TECH.wulei.every + 0.2);
  assert.equal(ev2.filter((x) => x.t === 'tech' && x.kind === 'wulei' && x.act === 'strike').length, 1, '之后隔 6 秒一道');
});

test('寒冰诀：打中冻住的敌人时冰碎迸开（这一下加伤、冻结解除、波及身边并减速）；平时命中有几率冻住', () => {
  const a = arena(50);
  const b = arena(50, ['hanjue']);
  const hit = (w: World, frozen: boolean) => {
    const e = enemy(w, 'soldier', 300, 300);
    const side = enemy(w, 'soldier', 318, 300);
    if (frozen) e.frozen = e.stun = 2;
    buildGrid(w.enemies);
    const ev: SimEvent[] = [];
    const d = hitEnemy(w, e, { dmg: 40, by: 'ring', owner: 0, from: { x: 290, y: 300 }, canCrit: false }, ev);
    return { d, e, side, ev };
  };
  const plain = hit(a.w, true);
  const shat = hit(b.w, true);
  assert.ok(shat.d > plain.d * 1.4, `冰碎这一下加伤（${plain.d} → ${shat.d}）`);
  assert.equal(shat.e.frozen, 0, '冻结解除');
  assert.ok(shat.side.hp < 9999 && shat.side.slowT > 0, '身边的被碎冰波及、减速');
  assert.equal(plain.side.hp, 9999);
  assert.ok(shat.ev.some((x) => x.t === 'tech' && x.kind === 'hanjue'));
  // 持续伤害不碎冰
  const c = arena(51, ['hanjue']);
  const ce = enemy(c.w, 'soldier', 300, 300);
  ce.frozen = ce.stun = 2;
  hitEnemy(c.w, ce, { dmg: 5, by: 'burn', owner: 0, from: ce, canCrit: false }, []);
  assert.ok(ce.frozen > 0);
  // 平时：有几率冻住（首领不吃）
  let frozen = 0;
  for (let i = 0; i < 400; i++) {
    const e = enemy(c.w, 'soldier', 200, 200);
    hitEnemy(c.w, e, { dmg: 1, by: 'ring', owner: 0, from: { x: 190, y: 200 }, canCrit: false }, []);
    if (e.frozen > 0) frozen++;
    c.w.enemies = [];
  }
  const want = TECH.hanjue.chance * 400;
  assert.ok(frozen > want * 0.55 && frozen < want * 1.5, `约 ${Math.round(TECH.hanjue.chance * 100)}%（${frozen}/400）`);
});

test('天眼通：暴击率 +10%；被暴击过的敌人受到的伤害 +20%，几秒后恢复', () => {
  const a = arena(52);
  const b = arena(52, ['tianyan']);
  assert.ok(Math.abs(b.p.stats.crit - a.p.stats.crit - TECH.tianyan.crit) < 1e-9);
  const { w, p } = b;
  const e = enemy(w, 'soldier', 300, 300);
  const spec = { dmg: 50, by: 'ring' as const, owner: 0, from: { x: 290, y: 300 }, canCrit: false };
  const d0 = hitEnemy(w, e, spec, []);
  p.stats.crit = 1; // 下一下必暴
  const ev: SimEvent[] = [];
  hitEnemy(w, e, { ...spec, canCrit: true }, ev);
  assert.ok(ev.some((x) => x.t === 'tech' && x.kind === 'tianyan'), '暴击看破');
  const d1 = hitEnemy(w, e, spec, []);
  assert.ok(Math.abs(d1 / d0 - (1 + TECH.tianyan.vuln)) < 0.05, `受伤加深（${d0} → ${d1}）`);
  w.time += TECH.tianyan.t + 0.1;
  const d2 = hitEnemy(w, e, spec, []);
  assert.equal(d2, d0, '过了时限恢复');
});

test('聚灵阵：拾取范围 +50%；波末收灵的灵石不打八折', () => {
  const end = (techs: TechniqueId[]) => {
    const w = createWorld(53);
    const p = w.players[0];
    for (const id of techs) give(p, id);
    p.iframes = 1e9;
    p.weapons = [];
    run(w, waveDuration(1) - 0.5);
    w.gems = [{ id: 999, x: 10, y: 10, px: 0, py: 0, vx: 0, vy: 0, value: 30, pulled: -1 }];
    w.enemies = [];
    const before = p.lingshi;
    run(w, 4.5);
    assert.equal(w.phase, 'shop');
    return { gain: p.lingshi - before, p };
  };
  const a = end([]);
  const b = end(['lingzhen']);
  assert.equal(a.gain, 30 * VACUUM_VALUE);
  assert.equal(b.gain, 30, '不打折');
  assert.ok(Math.abs(b.p.stats.pickup - a.p.stats.pickup - TECH.lingzhen.pickup) < 1e-9);
});

test('吐纳术：每秒回复加成；每波开始回 10% 气血', () => {
  const { w, p } = arena(54, ['tuna']);
  assert.equal(p.stats.regen, TECH.tuna.regen);
  p.hp = 50;
  run(w, 2);
  assert.ok(Math.abs(p.hp - (50 + 2 * TECH.tuna.regen)) < 0.05, `两秒回 ${2 * TECH.tuna.regen} 点（${p.hp}）`);
  // 每波开始
  w.phase = 'shop';
  p.hp = 50;
  p.ready = true;
  const ev = step(w, [idle]);
  assert.ok(ev.some((x) => x.t === 'waveStart'));
  assert.equal(p.hp, 50 + Math.round(p.stats.maxHp * TECH.tuna.heal));
  assert.ok(ev.some((x) => x.t === 'tech' && x.kind === 'tuna'));
});

test('五行轮转：触发相生的那一下伤害 +50%；五行印记的持续时间翻倍', () => {
  const hit = (techs: TechniqueId[]) => {
    const { w } = arena(55, techs);
    const e = enemy(w, 'soldier', 300, 300);
    e.mark = 'wood';
    e.markT = 1;
    buildGrid(w.enemies);
    const ev: SimEvent[] = [];
    const d = hitEnemy(w, e, { dmg: 40, by: 'ring', owner: 0, from: { x: 290, y: 300 }, el: 'fire', canCrit: false }, ev);
    return { d, e, ev };
  };
  const a = hit([]);
  const b = hit(['lunzhuan']);
  assert.ok(a.ev.some((x) => x.t === 'react') && b.ev.some((x) => x.t === 'react'), '木生火：引燃');
  assert.equal(b.d, Math.round(a.d * TECH.lunzhuan.react));
  assert.ok(b.e.burn > a.e.burn, '引燃的灼烧跟着涨');
  assert.ok(Math.abs(a.e.markT - MARK_T) < 1e-9);
  assert.ok(Math.abs(b.e.markT - MARK_T * TECH.lunzhuan.mark) < 1e-9, '印记更久');
});

test('法天象地：伤害 +25%，受到的伤害 +15%', () => {
  const a = arena(56);
  const b = arena(56, ['fatian']);
  assert.ok(Math.abs(b.p.stats.damage - a.p.stats.damage - TECH.fatian.damage) < 1e-9);
  const hurt = ({ w, p }: { w: World; p: Player }) => {
    p.iframes = 0;
    const hp = p.hp;
    hurtPlayer(w, p, 40, 'contact', []);
    return hp - p.hp;
  };
  assert.equal(hurt(b), Math.round(40 * TECH.fatian.hurt));
  assert.equal(hurt(a), 40);
});

// ---------- 2026-11-12 再加的 12 门 ----------

/** 从商店开下一波（每波开始的那些结算）。 */
const nextWave = (w: World) => {
  w.phase = 'shop';
  w.players[0].ready = true;
  const ev = step(w, [idle]);
  assert.ok(ev.some((x) => x.t === 'waveStart'));
  quiet(w);
  return ev;
};

test('掌心雷：放神通时劈身边最近的几只（木行、晕住），远处的不劈', () => {
  const { w, p } = arena(60, ['zhangxin']);
  const near = Array.from({ length: TECH.zhangxin.n + 2 }, (_, i) => enemy(w, 'soldier', p.x + 40 + i * 8, p.y + (i % 2) * 10, 1e6));
  const far = enemy(w, 'soldier', p.x + TECH.zhangxin.seek + 20, p.y, 1e6);
  p.skill = 1;
  const ev = step(w, [{ mx: 0, my: 0, skill: true }]);
  const zx = ev.find((x) => x.t === 'tech' && x.kind === 'zhangxin');
  assert.ok(zx && zx.t === 'tech' && zx.ids!.length === TECH.zhangxin.n, '劈了 n 只');
  const hit = near.filter((e) => ev.some((x) => x.t === 'hit' && x.id === e.id && x.by === 'thunder'));
  assert.equal(hit.length, TECH.zhangxin.n);
  assert.ok(hit.every((e) => e.stun > 0 && e.mark === 'wood'), '晕住、留木行印记');
  assert.equal(far.hp, 1e6, '射程外的不劈');
  // 没悟的不劈
  const b = arena(60);
  enemy(b.w, 'soldier', b.p.x + 40, b.p.y, 1e6);
  b.p.skill = 1;
  assert.ok(!step(b.w, [{ mx: 0, my: 0, skill: true }]).some((x) => x.t === 'tech' && x.kind === 'zhangxin'));
});

test('六丁六甲：护身甲抵掉几次伤害，用完照常挨打；隔一会儿补一道，每波开始补满', () => {
  const { w, p } = arena(61, ['liuding']);
  const L = TECH.liuding;
  const hurt = () => {
    p.iframes = 0;
    const hp = p.hp;
    const ev: SimEvent[] = [];
    hurtPlayer(w, p, 20, 'contact', ev);
    return { lost: hp - p.hp, ev };
  };
  run(w, 0.1);
  for (let i = 0; i < L.max; i++) {
    const r = hurt();
    assert.equal(r.lost, 0, `第 ${i + 1} 下被甲抵掉`);
    assert.ok(r.ev.some((x) => x.t === 'tech' && x.kind === 'liuding' && x.act === 'block'));
  }
  assert.ok(hurt().lost > 0, '甲用完照常挨打');
  p.iframes = 1e12;
  run(w, L.regen + 0.1);
  assert.equal(p.tech!.jia, 1, '过 regen 秒补回一道');
  nextWave(w);
  assert.equal(p.tech!.jia, L.max, '每波开始补满');
});

test('斩三尸：气血上限降一截（气血跟着收），伤害与暴击率加上去', () => {
  const w = createWorld(62);
  const p = w.players[0];
  const hp0 = p.stats.maxHp;
  const dmg0 = p.stats.damage;
  const crit0 = p.stats.crit;
  p.level = 3;
  p.techOffer = ['zhansan', 'tuna', 'lingzhen'];
  learnTechnique(w, p, 'zhansan', []);
  assert.equal(p.stats.maxHp, Math.round(hp0 * (1 - TECH.zhansan.hp)));
  assert.ok(p.hp <= p.stats.maxHp, '气血不超过新的上限');
  assert.ok(Math.abs(p.stats.damage - dmg0 - TECH.zhansan.damage) < 1e-9);
  assert.ok(Math.abs(p.stats.crit - crit0 - TECH.zhansan.crit) < 1e-9);
});

test('紫气东来：每波开始，身上的灵石生息一成（不足一枚不计，有上限）', () => {
  const { w, p } = arena(63, ['ziqi']);
  p.lingshi = 57;
  const ev = nextWave(w);
  assert.equal(p.lingshi, 57 + Math.floor(57 * TECH.ziqi.rate));
  assert.ok(ev.some((x) => x.t === 'tech' && x.kind === 'ziqi' && x.v === 5));
  p.lingshi = 999;
  nextWave(w);
  assert.equal(p.lingshi, 999 + TECH.ziqi.cap, '封顶');
  p.lingshi = 9;
  const ev3 = nextWave(w);
  assert.equal(p.lingshi, 9, '不足一枚不计');
  assert.ok(!ev3.some((x) => x.t === 'tech' && x.kind === 'ziqi'));
});

test('五鬼搬运：每次进万宝阁前两次刷新不要灵石，之后从第一次的价起；升级时少一个属性可选', () => {
  const plain = toShop(64, 1);
  const a = toShop(64, 1);
  give(a.p, 'wugui');
  for (const s of [plain, a]) {
    s.p.lingshi = 500;
    s.p.pendingLevels = 1;
  }
  const first = rerollCost(plain.w, plain.p);
  assert.ok(first > 0);
  for (let i = 0; i < TECH.wugui.free; i++) {
    assert.equal(rerollCost(a.w, a.p), 0);
    applyCommand(a.w, { t: 'reroll', player: 0 }, []);
  }
  assert.equal(a.p.lingshi, 500, '前两次不要钱');
  assert.equal(rerollCost(a.w, a.p), first, '之后从第一次的价起');
  applyCommand(a.w, { t: 'rerollLevel', player: 0 }, []);
  applyCommand(plain.w, { t: 'rerollLevel', player: 0 }, []);
  assert.equal(a.p.levelOffers.length, plain.p.levelOffers.length - TECH.wugui.cut, '升级少一个可选');
});

test('土遁：被围时挨打就遁到敌人少的一边（遁走处震退、晕住身边的），冷却里不再遁；不被围也不垂危就不遁', () => {
  const { w, p } = arena(65, ['tudun']);
  p.x = p.px = 480;
  p.y = p.py = 270;
  const ring = Array.from({ length: 6 }, (_, i) => enemy(w, 'soldier', 480 + Math.cos(i) * 22, 270 + Math.sin(i) * 16, 1e6));
  // 右边再堆一群：遁走的方向该避开它们
  for (let i = 0; i < 10; i++) enemy(w, 'soldier', 560 + (i % 3) * 10, 260 + Math.floor(i / 3) * 10, 1e6);
  p.iframes = 0;
  const ev: SimEvent[] = [];
  hurtPlayer(w, p, 5, 'contact', ev);
  const dun = ev.find((x) => x.t === 'tech' && x.kind === 'tudun');
  assert.ok(dun, '遁了');
  const moved = Math.hypot(p.x - 480, p.y - 270);
  assert.ok(moved > TECH.tudun.dist * 0.6, `遁出去 ${moved.toFixed(0)} 像素`);
  assert.ok(p.x < 520, '没往敌群那边遁');
  assert.ok(ring.every((e) => e.stun > 0 && e.hp < 1e6), '遁走处的敌人被震、晕住');
  assert.ok(p.iframes > 0, '出土时无敌片刻');
  // 冷却里：再被围、再挨打也不遁
  for (const e of ring) {
    e.x = e.px = p.x + 10;
    e.y = e.py = p.y;
  }
  p.iframes = 0;
  const ev2: SimEvent[] = [];
  hurtPlayer(w, p, 5, 'contact', ev2);
  assert.ok(!ev2.some((x) => x.t === 'tech' && x.kind === 'tudun'), '冷却里不遁');
  // 身边只有一只、气血还多：不遁
  const b = arena(66, ['tudun']);
  enemy(b.w, 'soldier', b.p.x + 10, b.p.y, 1e6);
  b.p.iframes = 0;
  const ev3: SimEvent[] = [];
  hurtPlayer(b.w, b.p, 5, 'contact', ev3);
  assert.ok(!ev3.some((x) => x.t === 'tech' && x.kind === 'tudun'));
  // 气血垂危：一只也遁
  b.p.hp = Math.floor(b.p.stats.maxHp * TECH.tudun.low) - 6;
  b.p.iframes = 0;
  const ev4: SimEvent[] = [];
  hurtPlayer(b.w, b.p, 5, 'contact', ev4);
  assert.ok(ev4.some((x) => x.t === 'tech' && x.kind === 'tudun'), '垂危时遁');
});

test('九转玄功：这一波每斩够数进一转、伤害跟着涨，到九转为止；下一波从头来', () => {
  const { w, p } = arena(67, ['jiuzhuan']);
  const J = TECH.jiuzhuan;
  const probe = () => {
    const e = enemy(w, 'soldier', 300, 300, 1e6);
    buildGrid(w.enemies);
    hitEnemy(w, e, { dmg: 100, by: 'ring', owner: 0, from: { x: 290, y: 300 }, canCrit: false }, []);
    const d = 1e6 - e.hp;
    w.enemies = w.enemies.filter((x) => x !== e);
    return d;
  };
  const base = probe();
  const killN = (n: number) => {
    const ev: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      const e = enemy(w, 'soldier', 300, 300, 1);
      buildGrid(w.enemies);
      hitEnemy(w, e, { dmg: 10, by: 'ring', owner: 0, from: { x: 290, y: 300 }, canCrit: false }, ev);
    }
    w.enemies = [];
    return ev;
  };
  const ev = killN(J.per);
  assert.equal(p.tech!.zhuan, 1);
  assert.ok(ev.some((x) => x.t === 'tech' && x.kind === 'jiuzhuan' && x.v === 1));
  assert.ok(Math.abs(probe() - base * (1 + J.step)) <= 1, '一转：伤害 +step');
  killN(J.per * (J.max + 3));
  assert.equal(p.tech!.zhuan, J.max, '到九转为止');
  nextWave(w);
  assert.equal(p.tech!.zhuan, 0, '下一波从头来');
});

test('太乙真诀：宠物出手的间隔缩短；放神通时宠物马上再出手', () => {
  const { w, p } = arena(68, ['taiyi']);
  p.pet.cd = 3;
  run(w, 1);
  assert.ok(Math.abs(p.pet.cd - (3 - 1 / TECH.taiyi.cd)) < 0.05, `计时走得快（${p.pet.cd}）`);
  p.pet.cd = 5;
  p.skill = 1;
  step(w, [{ mx: 0, my: 0, skill: true }]);
  assert.ok(p.pet.cd <= 0, '放神通时宠物马上可以出手');
});

test('独修一脉：法宝里件数最多的那一行（至少两件）伤害更高，件数越多越高；别的行、只有一件的不加', () => {
  const dmgOf = (weapons: WeaponKind[], el: 'fire' | 'earth') => {
    const { w } = arena(69, ['sanhua'], weapons.map((kind) => ({ kind, tier: 1 })));
    const e = enemy(w, 'soldier', 300, 300, 1e6);
    buildGrid(w.enemies);
    hitEnemy(w, e, { dmg: 100, by: 'ring', owner: 0, from: { x: 290, y: 300 }, el, canCrit: false, noMark: true }, []);
    return 1e6 - e.hp;
  };
  const plain = (() => {
    const { w } = arena(69, [], [{ kind: 'qiankun', tier: 1 }, { kind: 'huojian', tier: 1 }]);
    const e = enemy(w, 'soldier', 300, 300, 1e6);
    buildGrid(w.enemies);
    hitEnemy(w, e, { dmg: 100, by: 'ring', owner: 0, from: { x: 290, y: 300 }, el: 'fire', canCrit: false, noMark: true }, []);
    return 1e6 - e.hp;
  })();
  const two = dmgOf(['qiankun', 'huojian'], 'fire');
  const three = dmgOf(['qiankun', 'huojian', 'jiulong'], 'fire');
  assert.ok(Math.abs(two - plain * (1 + TECH.sanhua.bonus[2])) <= 1, `两件 +${TECH.sanhua.bonus[2]}（${plain} → ${two}）`);
  assert.ok(three > two, '三件更高');
  assert.equal(dmgOf(['qiankun', 'huojian', 'fantian'], 'earth'), dmgOf(['qiankun', 'fantian'], 'earth'), '只有一件的那一行不加');
});

test('五色神光：每接上 n 次相生，第 n 次迸作五色元气波及身边', () => {
  const { w, p } = arena(70, ['wuqi']);
  const target = enemy(w, 'soldier', 300, 300, 1e6);
  const side = enemy(w, 'soldier', 320, 300, 1e6);
  let bursts = 0;
  for (let i = 0; i < TECH.wuqi.n * 2; i++) {
    const ev: SimEvent[] = [];
    buildGrid(w.enemies);
    target.reactUntil = undefined;
    hitEnemy(w, target, { dmg: 10, by: 'ring', owner: 0, from: { x: 290, y: 300 }, el: 'wood', canCrit: false }, ev);
    hitEnemy(w, target, { dmg: 10, by: 'ring', owner: 0, from: { x: 290, y: 300 }, el: 'fire', canCrit: false }, ev); // 木生火：相生
    bursts += ev.filter((x) => x.t === 'tech' && x.kind === 'wuqi').length;
    target.mark = null;
  }
  assert.equal(bursts, 2, '十次相生迸开两次');
  assert.ok(side.hp < 1e6, '身边的挨了元气');
  assert.equal(p.tech!.reacts, 0);
});

test('撒豆成兵：隔一会儿撒豆，豆兵落地扑向身边的敌人斩一刀（金行）；身边没有敌人就不撒', () => {
  const { w, p } = arena(71, ['sadou']);
  const S = TECH.sadou;
  const foes = Array.from({ length: 6 }, (_, i) => enemy(w, 'soldier', p.x + 30 + i * 9, p.y - 10 + (i % 2) * 20, 1e6));
  const ev = run(w, S.first + S.fly + S.dash + 0.1);
  const sow = ev.find((x) => x.t === 'tech' && x.kind === 'sadou' && x.act === 'sow');
  assert.ok(sow && sow.t === 'tech' && sow.pts!.length === S.n, '撒了 n 粒');
  const strikes = ev.filter((x) => x.t === 'tech' && x.kind === 'sadou' && x.act === 'strike');
  assert.equal(strikes.length, S.n);
  const hurt = foes.filter((e) => e.hp < 1e6);
  assert.equal(hurt.length, S.n, '各斩一只');
  assert.ok(hurt.every((e) => e.mark === 'metal'), '金行印记');
  const ev2 = run(w, S.every);
  assert.equal(ev2.filter((x) => x.t === 'tech' && x.kind === 'sadou' && x.act === 'sow').length, 1, '之后隔 every 秒一把');
  const b = arena(72, ['sadou']);
  assert.ok(!run(b.w, S.first + 1).some((x) => x.t === 'tech' && x.kind === 'sadou'), '身边没有敌人不撒');
});

test('呼风唤雨：在附近敌人最密处降雨；雨里的敌人减速、沾水行印记，雨外的不沾；下完就停', () => {
  const { w, p } = arena(73, ['hufeng']);
  const H = TECH.hufeng;
  const lone = enemy(w, 'soldier', p.x - 60, p.y, 1e6);
  const pack = Array.from({ length: 6 }, (_, i) => enemy(w, 'soldier', p.x + 70 + (i % 3) * 8, p.y + Math.floor(i / 3) * 8, 1e6));
  const ev = run(w, H.first + 1);
  const start = ev.find((x) => x.t === 'tech' && x.kind === 'hufeng' && x.act === 'start');
  assert.ok(start && start.t === 'tech' && start.x > p.x + 50, '下在敌群那边');
  assert.ok(pack.every((e) => e.slow > 0 && e.mark === 'water' && e.hp < 1e6), '雨里的减速、沾水');
  assert.equal(lone.hp, 1e6, '雨外的不沾');
  run(w, H.t);
  assert.equal(p.tech!.storm, null, '下完就停');
});

test('三昧真火 + 火行三件「燎原」：一群带火的敌人连环炸开，灼烧不会越传越旺', () => {
  const { w, p } = arena(59, ['sanmei'], [
    { kind: 'qiankun', tier: 1 },
    { kind: 'huojian', tier: 1 },
    { kind: 'jiulong', tier: 1 },
  ]);
  p.weapons.forEach((x) => (x.cd = 1e9)); // 只看炸开，法宝不出手
  const crowd: ReturnType<typeof enemy>[] = [];
  for (let i = 0; i < 40; i++) {
    const e = enemy(w, 'soldier', 200 + (i % 8) * 9, 200 + Math.floor(i / 8) * 9, 30);
    addBurn(w, e, 0, 20, 3);
    crowd.push(e);
  }
  const start = Math.max(...crowd.map((e) => e.burn));
  buildGrid(w.enemies);
  hitEnemy(w, crowd[0], { dmg: 999, by: 'ring', owner: 0, from: { x: 190, y: 200 }, canCrit: false }, []);
  const peak = Math.max(...crowd.map((e) => e.burn));
  assert.ok(crowd.filter((e) => e.hp <= 0).length > 5, '炸开连成一串');
  assert.ok(peak <= start + 1e-9, `连环炸开之后，谁身上的灼烧都不超过一开始的（${start} → ${peak}）`);
});

// ---------- 机器人与确定性 ----------

test('机器人会悟功法，按构筑挑（带三件水行的挑寒冰诀而不是聚灵阵）', () => {
  const w = createWorld(57);
  const p = w.players[0];
  p.weapons = [{ kind: 'qiankun', tier: 1, spirit: null, cd: 0 }, ...Array.from({ length: 3 }, () => ({ kind: 'hanbing' as const, tier: 1, spirit: null, cd: 0 }))];
  p.level = 9;
  p.techOffer = ['lingzhen', 'hanjue', 'hunyuan'];
  assert.equal(botTechnique(w, p), 'hanjue');
  w.phase = 'shop';
  assert.deepEqual(botShop(w, 0), [{ t: 'learn', player: 0, id: 'hanjue' }]);
});

test('同一种子 + 同一串输入（机器人打到第 9 级以后，悟了两门以上的功法）→ 完全相同的状态', () => {
  const play = () => {
    // 要打到第 8 级以后、悟两门以上：人物加满血（这条测的是确定性，不是这个种子打不打得过——数值一调，固定种子总会有某一波死掉）
    // 种子 4 在法宝扩到三十件、调过数值之后，机器人凑不出像样的构筑、卡在第一章首领：换种子 5
    const w = createWorld(5);
    w.players[0].hp = w.players[0].stats.maxHp = 1e6;
    const n = Math.round(400 / DT);
    for (let i = 0; i < n && w.phase !== 'over'; i++) step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
    return w;
  };
  const a = play();
  const b = play();
  assert.ok(a.players[0].techs.length >= 2, `悟了 ${a.players[0].techs.length} 门`);
  assert.equal(digest(a), digest(b));
  assert.deepEqual(a.players[0].techs, b.players[0].techs);
  assert.deepEqual(a.players[0].tech, b.players[0].tech);
});
