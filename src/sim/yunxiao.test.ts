// 云霄（sim/heroes/yunxiao.ts、sim/pets/qingluan.ts、heroes/passives.ts 的「冰心」）的模拟测试：
// 起手（混元金斗、青鸾、水行亲和）；金斗吸进去（拿出 w.enemies、打不到碰不到）→ 喷出来摔下（伤害、晕），首领 / 精英 / 召出来的不吸，
// 仙品削去三花、器灵倒海 / 收宝；九曲黄河卷向中心再砸下、卷着的撞不到人、首领不卷；青鸾不造成伤害、寒羽减速 + 出手慢、再沾冻住；
// 冰心只给云霄；斗里的不跨波、主人倒下就掉出来；吸进去的时候存档，恢复后照样吐出来、逐帧相同；同种子同输入完全确定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, SKILL } from './config.ts';
import { BINGXIN, HEROES, WEAPONS } from './catalog.ts';
import { buildGrid, enemiesWithin, hitEnemy } from './core.ts';
import { DOU, FLAT, RIVER } from './heroes/yunxiao.ts';
import { castSkill } from './heroes/index.ts';
import { petKindOf, QINGLUAN } from './pet.ts';
import { petEvolveOffer } from './shop.ts';
import { tetherPairs } from './ch3/foes.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { EnemyKindName, HeroId } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 干净的测试场：普通波、刷怪关掉、人物无敌；宠物默认不出手、法宝默认不出手（要测的自己打开）。 */
const arena = (hero: HeroId = 'yunxiao', opts: { tier?: number; spirit?: string | null; pet?: boolean; weapon?: boolean } = {}) => {
  const w = createWorld(11, 1, [hero]);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons[0].tier = opts.tier ?? 1;
  p.weapons[0].spirit = opts.spirit ?? null;
  p.weapons[0].cd = opts.weapon === false ? 1e12 : 0;
  if (!opts.pet) p.pet.cd = 1e12;
  p.iframes = 1e12;
  p.stats.crit = 0;
  return { w, p };
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 9999) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
const has = (w: World, id: number) => w.enemies.some((e) => e.id === id);

// ---------------------------------------------------------------- 起手

test('起手：云霄拿凡品混元金斗、带青鸾（飞在半空）、金行亲和（按角色表，2026-11-11 起 +20%）；金斗是金行（用户 11-12）、只属于她；青鸾两条路是冰魄、沧溟', () => {
  const w = createWorld(3, 1, ['yunxiao']);
  const p = w.players[0];
  assert.deepEqual(p.weapons.map((x) => [x.kind, x.tier]), [['jindou', 1]]);
  assert.equal(petKindOf(p), 'qingluan');
  assert.ok(p.pet.y < p.y - 20, '青鸾在半空');
  assert.ok(Math.abs(p.stats.aff.metal - HEROES.yunxiao.affStart) < 1e-9); // 2026-11-11 数值平衡 0.1 → 0.2
  assert.equal(WEAPONS.jindou.el, 'metal');
  assert.equal(WEAPONS.jindou.exclusive, 'yunxiao');
  assert.equal(HEROES.yunxiao.skill, 'huanghe');
  p.level = 5;
  assert.deepEqual(petEvolveOffer(p), ['rime', 'deep']);
});

// ---------------------------------------------------------------- 混元金斗

test('混元金斗：飞过去把一小群吸进斗里（拿出 w.enemies，谁也找不到），过一会儿喷出来摔在地上（受伤、晕），回到场上', () => {
  const { w, p } = arena();
  const es = [enemy(w, 'soldier', p.x + 60, p.y), enemy(w, 'soldier', p.x + 66, p.y + 5), enemy(w, 'soldier', p.x + 62, p.y - 6)];
  const far = enemy(w, 'soldier', p.x - 90, p.y + 30);
  const ev = run(w, DOU.fly + 0.05);
  assert.equal(evs(ev, 'dou')[0]?.act, 'cast');
  assert.equal(evs(ev, 'dou')[1]?.act, 'suck');
  assert.ok(p.dou && p.dou.held.length === 3, '三只都吸进去了');
  for (const e of es) assert.ok(!has(w, e.id), '吸进去的不在场上');
  assert.ok(has(w, far.id));
  buildGrid(w.enemies);
  assert.ok(!enemiesWithin(w, p.x + 62, p.y, 30).length, '别的法宝找不到斗里的');
  const ev2 = run(w, DOU.suck + DOU.hold + DOU.fall + 0.05);
  assert.deepEqual(evs(ev2, 'dou').map((d) => d.act), ['spit', 'land']);
  assert.equal(p.dou, undefined);
  for (const e of es) {
    assert.ok(has(w, e.id), '喷出来回到场上');
    assert.ok(e.hp < e.maxHp, '摔下来受伤');
    assert.ok(e.stun > 0, '摔下来晕一下');
  }
  const hits = evs(ev2, 'hit').filter((h) => h.by === 'dou');
  assert.ok(hits.length >= 3);
  assert.ok(!evs([...ev, ...ev2], 'hit').some((h) => h.id === far.id), '远处的不受影响');
});

test('混元金斗不吸首领、精英、首领召出来的东西、点着引信的爆符鬼（吸不进去的就浇一斗水）；够不着就不出手', () => {
  {
    const { w, p } = arena();
    run(w, 0.5);
    assert.equal(p.dou, undefined, '身边没有敌人不出手');
  }
  const { w, p } = arena();
  const el = enemy(w, 'elite', p.x + 60, p.y);
  const flag = enemy(w, 'soulflag', p.x + 64, p.y + 6);
  const bomber = enemy(w, 'bomber', p.x + 58, p.y - 6);
  bomber.act = 'fuse';
  bomber.actT = 99;
  const ev = run(w, DOU.fly + 0.05);
  assert.ok(p.dou && p.dou.held.length === 0 && p.dou.pour >= 0, '一个都吸不进去：改成浇');
  assert.ok(has(w, el.id) && has(w, flag.id) && has(w, bomber.id), '谁都没被吸走');
  const ev2 = run(w, DOU.pour.t + 0.05);
  const land = evs([...ev, ...ev2], 'dou').find((d) => d.act === 'land');
  assert.ok(land && land.pour !== undefined && land.hit!.includes(land.pour), '浇下去打中了');
  assert.ok(land.pour !== bomber.id, '点着引信的不浇');
  // 首领在身边、吸得进去的只有一只：先浇首领
  const b = arena();
  const boss = enemy(b.w, 'boss', b.p.x + 70, b.p.y);
  enemy(b.w, 'soldier', b.p.x - 50, b.p.y);
  run(b.w, DOU.fly + 0.05);
  assert.equal(b.p.dou?.pour, boss.id, '首领先');
  // 收宝：精英也吸得进去，吸进去的护体、加速被收走
  const s = arena('yunxiao', { tier: 4, spirit: 'shou' });
  const e2 = enemy(s.w, 'elite', s.p.x + 60, s.p.y);
  const b2 = enemy(s.w, 'soldier', s.p.x + 64, s.p.y + 6);
  b2.ward = 0.5;
  b2.wardT = 5;
  b2.haste = 0.4;
  run(s.w, DOU.fly + 0.05);
  assert.ok(!has(s.w, e2.id) && !has(s.w, b2.id), '收宝：精英也吸进去');
  assert.equal(b2.ward, 0);
  assert.equal(b2.haste, 0);
});

test('混元金斗升阶：灵品吸得更多；仙品「削去顶上三花」喷出来以后受伤加深；倒海一路撞到别的敌人', () => {
  const pack = (w: World, x: number, y: number, n: number) => Array.from({ length: n }, (_, i) => enemy(w, 'soldier', x + (i % 3) * 7, y + Math.floor(i / 3) * 7 - 7));
  const sucked = (tier: number) => {
    const { w, p } = arena('yunxiao', { tier });
    pack(w, p.x + 60, p.y, 8);
    run(w, DOU.fly + 0.05);
    return p.dou?.held.length ?? 0;
  };
  assert.equal(sucked(1), DOU.n[1]);
  assert.ok(sucked(2) > sucked(1), '灵品吸得更多');
  // 仙品：摔下来的被削去三花，之后受到的伤害提高
  const { w, p } = arena('yunxiao', { tier: 3 });
  const es = pack(w, p.x + 60, p.y, 3);
  run(w, DOU.fly + DOU.suck + DOU.hold + DOU.fall + 0.1);
  const e = es[0];
  assert.ok(has(w, e.id) && (e.sanhuaUntil ?? 0) > w.time && e.sanhua === DOU.sanhua[3]);
  const before = e.hp;
  e.stun = 0;
  hitEnemy(w, e, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  assert.equal(before - e.hp, Math.round(100 * (1 + DOU.sanhua[3])), '削去三花：受伤 +30%');
  // 倒海：喷出去的砸向身边别的敌人，一路撞到的挨一下
  const d = arena('yunxiao', { tier: 4, spirit: 'dao' });
  pack(d.w, d.p.x + 50, d.p.y, 3);
  const others = [enemy(d.w, 'shieldbearer', d.p.x + 100, d.p.y + 4), enemy(d.w, 'elite', d.p.x + 54, d.p.y + 46)];
  const ev = run(d.w, DOU.fly + DOU.suck + DOU.hold + DOU.fall + 0.1);
  const land = evs(ev, 'dou').find((x) => x.act === 'land')!;
  for (const o of others) assert.ok(land.hit!.includes(o.id), `倒海撞到 ${o.kind}`);
});

test('第三章的阵图傀儡：吸进去一只，剑气线断干净（外面那只报断线，喷出来的不再连回去）；两只都吸进去，断线只报一次', () => {
  const pair = (w: World, ax: number, ay: number, bx: number, by: number) => {
    const a = enemy(w, 'puppet', ax, ay);
    const b = enemy(w, 'puppet', bx, by);
    a.mate = b.id;
    b.mate = a.id;
    return [a, b];
  };
  {
    const { w, p } = arena();
    const [a, b] = pair(w, p.x + 60, p.y, p.x + 60, p.y + 70);
    const ev = run(w, DOU.fly + 0.1);
    assert.ok(p.dou?.held.some((e) => e.id === a.id) && has(w, b.id), '吸进去一只');
    assert.equal(a.mate, -1);
    assert.equal(b.mate, -1, '外面那只断了线');
    assert.equal(evs(ev, 'tetherCut').length, 1);
    p.weapons[0].cd = 1e12; // 不再出下一斗（不然落地以后又被吸进去）
    run(w, 2);
    assert.ok(has(w, a.id) && a.mate === -1, '喷出来以后不再连回去');
    assert.equal(tetherPairs(w).length, 0);
  }
  const { w, p } = arena('yunxiao', { tier: 2 });
  const [a, b] = pair(w, p.x + 58, p.y, p.x + 68, p.y + 6);
  const ev = run(w, DOU.fly + 0.1);
  assert.ok(!has(w, a.id) && !has(w, b.id), '两只都吸进去了');
  p.weapons[0].cd = 1e12;
  run(w, 2);
  const cuts = evs([...ev], 'tetherCut');
  assert.equal(cuts.length, 1, '断线只报一次');
  assert.equal(tetherPairs(w).length, 0);
});

// ---------------------------------------------------------------- 九曲黄河

test('九曲黄河：圈里的敌人卷着转、收向中心（不压在人物身上），卷着的不走、撞不到人；到时一起砸下（受伤、晕、往外震开）；首领不卷', () => {
  const { w, p } = arena('yunxiao', { weapon: false });
  p.iframes = 0;
  p.stats.maxHp = p.hp = 1e6;
  const es = [enemy(w, 'soldier', p.x + 70, p.y), enemy(w, 'soldier', p.x - 50, p.y + 40), enemy(w, 'soldier', p.x + 10, p.y - 50), enemy(w, 'spearman', p.x - 80, p.y - 20)];
  for (const e of es) e.speed = 30;
  const boss = enemy(w, 'boss', p.x + 40, p.y + 30);
  const outside = enemy(w, 'soldier', p.x + 20, p.y + 80); // 判定是压扁的椭圆：上下只有 r × FLAT
  const er = (e: { x: number; y: number }) => Math.hypot(e.x - p.x, (e.y - p.y) / FLAT);
  const r0 = es.map(er);
  const ev: SimEvent[] = [];
  castSkill(w, p, ev);
  assert.equal(evs(ev, 'skill')[0].kind, 'huanghe');
  assert.ok(p.river && p.river.ids.length === es.length, '圈里的都卷进来了，首领不卷');
  assert.ok(!p.river.ids.includes(boss.id) && !p.river.ids.includes(outside.id));
  const mid = run(w, RIVER.dur * 0.6);
  es.forEach((e, i) => {
    const r = er(e);
    assert.ok(r < r0[i] - 5, '收向中心');
    assert.ok(r >= RIVER.rMin - 1e-6, '不压在人物身上');
  });
  assert.ok(!evs(mid, 'hurt').length, '卷着的撞不到人');
  const end = run(w, RIVER.dur * 0.5);
  const slam = evs(end, 'riverSlam')[0];
  assert.ok(slam, '一起砸下');
  for (const e of es) {
    assert.ok(slam.ids.includes(e.id));
    assert.ok(e.hp < e.maxHp && e.stun > 0.5);
  }
  assert.equal(p.river, undefined);
  const dmg = evs(end, 'hit').filter((h) => h.id === es[0].id && h.by === 'skill').map((h) => h.dmg);
  assert.ok(dmg.includes(Math.round(SKILL.damage * RIVER.dmg)), '砸下的伤害');
});

// ---------------------------------------------------------------- 青鸾

test('青鸾：不造成伤害，只上寒羽（减速、出手慢、带水行印记）；寒羽还在时再沾一次就冻住；首领只减速、不冻、不慢出手；掠过去不停在敌人身上', () => {
  const { w, p } = arena('yunxiao', { pet: true, weapon: false });
  const es = [enemy(w, 'soldier', p.x + 50, p.y), enemy(w, 'caster', p.x + 56, p.y + 8), enemy(w, 'soldier', p.x + 44, p.y - 10)];
  const boss = enemy(w, 'boss', p.x + 52, p.y + 2);
  const ev = run(w, 3.5);
  assert.ok(!evs(ev, 'hit').length, '宠物不造成伤害');
  const fe = evs(ev, 'feather');
  assert.ok(fe.length >= 1);
  const touched = new Set(fe.flatMap((f) => f.ids));
  for (const e of es) assert.ok(touched.has(e.id), `沾到了 ${e.kind}`);
  for (const e of es) {
    assert.ok(e.slowT > 0 && e.slow > 0.3, '减速');
    assert.ok((e.chillUntil ?? 0) > w.time && e.chill === QINGLUAN.atk, '出手慢');
    assert.equal(e.mark, 'water'); // 青鸾是水行宠物（用户 11-12）
  }
  // 出手慢：冷却走得慢
  const c = es[1];
  c.cd = 2;
  run(w, 1, () => idle);
  assert.ok(c.cd > 2 - 1 + 0.25, `术士的冷却只走了 ${(2 - c.cd).toFixed(2)} 秒`);
  // 再掠几趟：寒羽还在时又沾上，冻住
  const ev2 = run(w, 6);
  assert.ok(evs(ev2, 'feather').some((f) => f.frozen.length > 0), '再沾一次冻住');
  assert.ok(!evs(ev2, 'feather').some((f) => f.frozen.includes(boss.id)), '首领不冻');
  // 青鸾不停在敌人身上：每一刻都在动
  let still = 0;
  for (let i = 0; i < 120; i++) {
    step(w, [idle]);
    if (Math.hypot(p.pet.vx, p.pet.vy) < 10) still++;
  }
  assert.equal(still, 0);
});

test('冰魄：沾上就冻住、每趟多洒两只；沧溟：受到的水行伤害更高', () => {
  const { w, p } = arena('yunxiao', { pet: true, weapon: false });
  p.pet.stage = 1;
  p.pet.branch = 'rime';
  for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x + 44 + (i % 3) * 6, p.y + Math.floor(i / 3) * 8 - 4);
  const ev = run(w, 2.5);
  const f = evs(ev, 'feather');
  assert.ok(f.length && f[0].frozen.length > 0, '冰魄：第一次沾上就冻住');
  const d = arena('yunxiao', { pet: true, weapon: false });
  d.p.pet.stage = 1;
  d.p.pet.branch = 'deep';
  const e = enemy(d.w, 'soldier', d.p.x + 50, d.p.y);
  run(d.w, 2.5);
  assert.ok((e.deepUntil ?? 0) > d.w.time);
  const hp = e.hp;
  e.frozen = 0;
  hitEnemy(d.w, e, { dmg: 100, by: 'ring', owner: 0, from: d.p, canCrit: false, el: 'water', noMark: true }, []);
  assert.equal(hp - e.hp, Math.round(100 * (1 + QINGLUAN.deep.water[1])));
});

// ---------------------------------------------------------------- 冰心

test('冰心：云霄打冻住的敌人 +20%；没冻住的不加；哪吒、杨戬打冻住的不加', () => {
  const dmgOn = (hero: HeroId, frozen: boolean) => {
    const { w, p } = arena(hero, { weapon: false });
    const e = enemy(w, 'soldier', p.x + 200, p.y);
    e.frozen = frozen ? 2 : 0;
    const hp = e.hp;
    hitEnemy(w, e, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false, noMark: true }, []);
    return hp - e.hp;
  };
  assert.equal(dmgOn('yunxiao', true), Math.round(100 * (1 + BINGXIN)));
  assert.equal(dmgOn('yunxiao', false), 100);
  assert.equal(dmgOn('nezha', true), 100);
  assert.equal(dmgOn('yangjian', true), 100);
});

// ---------------------------------------------------------------- 不跨波、倒下、存档

test('斗里的不跨波：这一波结束就清掉；主人倒下（联机倒地）时斗里的当场掉出来，回到场上', () => {
  {
    const { w, p } = arena();
    enemy(w, 'soldier', p.x + 60, p.y);
    run(w, DOU.fly + 0.05);
    assert.ok(p.dou?.held.length);
    w.waveLen = w.waveT + DT; // 这一波下一帧结束
    run(w, 0.1);
    assert.equal(w.phase, 'collect');
    assert.equal(p.dou, undefined);
  }
  const w = createWorld(12, 2, ['yunxiao', 'nezha']);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = w.surgeDone = true;
  const [p, q] = w.players;
  for (const x of w.players) {
    x.iframes = 1e12;
    x.pet.cd = 1e12;
  }
  q.weapons[0].cd = 1e12;
  p.weapons[0].cd = 0;
  q.x = p.x - 200;
  const es = [enemy(w, 'soldier', p.x + 60, p.y), enemy(w, 'soldier', p.x + 64, p.y + 6)];
  for (let i = 0; i < Math.round((DOU.fly + 0.05) / DT); i++) step(w, [idle, idle]);
  assert.equal(p.dou?.held.length, 2);
  p.alive = false; // 倒地
  p.down = 15;
  const ev: SimEvent[] = [];
  ev.push(...step(w, [idle, idle]));
  assert.equal(p.dou, undefined, '斗里的掉出来了');
  for (const e of es) assert.ok(has(w, e.id) && e.hp === e.maxHp, '回到场上，不受伤');
  assert.ok(evs(ev, 'dou').some((d) => d.act === 'land'));
});

test('吸进去的时候存档：恢复后照样吐得出来，接着跑逐帧相同；九曲黄河卷到一半也一样', () => {
  const { w, p } = arena();
  for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x + 56 + (i % 3) * 6, p.y + Math.floor(i / 3) * 8 - 4, 300);
  for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x - 60 + (i % 3) * 6, p.y + 30 + Math.floor(i / 3) * 8, 300);
  run(w, DOU.fly + 0.1);
  assert.ok(p.dou?.held.length);
  p.skill = 1;
  step(w, [{ mx: 0, my: 0, skill: true }]);
  assert.ok(p.river);
  const r = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(canonicalText(r), canonicalText(w));
  let landed = false;
  for (let i = 0; i < 240; i++) {
    const ev1 = step(w, [idle]);
    const ev2 = step(r, [idle]);
    assert.equal(JSON.stringify(ev2), JSON.stringify(ev1), `第 ${i + 1} 帧跑岔了`);
    if (evs(ev2, 'dou').some((d) => d.act === 'land' && d.ids.length)) landed = true;
  }
  assert.ok(landed, '恢复出来的那一份照样把斗里的吐出来');
  assert.equal(canonicalText(r), canonicalText(w));
});

test('云霄的一局：同种子同输入完全确定（机器人打几波，金斗、青鸾、九曲黄河都用上）', () => {
  const play = () => {
    const w = createWorld(91, 1, ['yunxiao']);
    w.players[0].skill = 1; // 一开局真气就满：神通也用上
    const trace: string[] = [];
    let dou = 0;
    let river = 0;
    for (let i = 0; i < 60 * 50 && w.phase !== 'over'; i++) {
      const cmds = w.phase === 'shop' ? botShop(w, 0) : [];
      const ev = step(w, [{ ...botInput(w, 0), skill: w.enemies.length > 4 }], cmds);
      dou += evs(ev, 'dou').filter((d) => d.act === 'land').length;
      river += evs(ev, 'riverSlam').length;
      if (i % 30 === 0) trace.push(JSON.stringify([w.tick, w.enemies.length, w.players[0].hp, w.players[0].kills]));
    }
    return { trace, dou, river };
  };
  const a = play();
  const b = play();
  assert.deepEqual(a.trace, b.trace);
  assert.ok(a.dou > 3, `金斗出手了 ${a.dou} 斗`);
  assert.ok(a.river >= 1, '放过九曲黄河');
});
