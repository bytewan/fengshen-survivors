// 可玩的回响敖丙（sim/heroes/huiao.ts、sim/pets/bishui.ts）的模拟测试：角色表登记（解锁 id 和首领池里敖丙的对得上）；
// 游龙戟：冰龙一只接一只咬（同一程不连着咬同一只）、只剩一只就绕回来再咬、咬到的减速、仙品尽头凝冰、器灵双龙 / 回澜；
// 化龙：那几秒不受伤、游得快，身边的敌人隔一会儿挨一下，变回来掀一圈浪；龙鳞：气血越满伤害越高；
// 避水兽：只上减益不打伤害，打湿的挨一下水行的伤害就冻住（首领不吃），霜髓冻着的时候受伤更深；整段确定、存档恢复后逐帧相同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, REACH } from './config.ts';
import { ECHO, HEROES, LONGLIN, WEAPONS, unlockIdOf } from './catalog.ts';
import { BOSS_INFO } from './bosspool.ts';
import { hitEnemy } from './core.ts';
import { HUALONG, YOULONG } from './heroes/huiao.ts';
import { heroHitMul, longlinBonus } from './heroes/passives.ts';
import { BISHUI } from './pet.ts';
import { soaked } from './pets/bishui.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { Enemy, EnemyKindName } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);

/** 干净的场地：刷怪关掉，人物是回响敖丙（宠物先不出手），在他身边摆几只不动、打不死的敌人。 */
function arena(spots: [number, number, EnemyKindName?][], tier = 1, spirit: string | null = null, seed = 3) {
  const w = createWorld(seed, 1, ['huiao']);
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = [{ kind: 'youlong', tier, spirit, cd: 0.05 }];
  p.pet.cd = 1e12;
  p.stats.maxHp = p.hp = 1e6;
  const es: Enemy[] = spots.map(([dx, dy, kind]) => {
    const e = spawnEnemy(w, kind ?? 'soldier', p.x + dx, p.y + dy, []);
    e.speed = 0;
    e.hp = e.maxHp = 1e7;
    return e;
  });
  return { w, p, es };
}
const run = (w: World, secs: number, input: PlayerInput = idle) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) out.push(...step(w, [input]));
  return out;
};

test('角色表：回响敖丙是水行的回响化身，专属法宝游龙戟、宠物避水兽、神通化龙；解锁 id 就是首领池里打倒敖丙给的那个', () => {
  const h = HEROES.huiao;
  assert.equal(h.el, 'water');
  assert.equal(h.exclusive, 'youlong');
  assert.equal(WEAPONS.youlong.exclusive, 'huiao');
  assert.equal(h.petKind, 'bishui');
  assert.equal(h.skill, 'hualong');
  assert.equal(unlockIdOf('huiao'), 'echo-aobing');
  assert.equal(BOSS_INFO.aobing.unlock, ECHO.huiao!.unlock);
  const w = createWorld(1, 1, ['huiao']);
  assert.equal(w.players[0].weapons[0].kind, 'youlong');
});

test('游龙戟：冰龙从戟尖游出去，一只接一只咬（一程里不连着咬同一只），一共咬够口数；咬到的减速；离得太远的不咬', () => {
  const { w, es } = arena([
    [50, 0],
    [70, 18],
    [90, -10],
    [60, -30],
    [110, 10],
    [REACH.max + 80, 0], // 够不着的
  ]);
  const ev = run(w, 1.6);
  assert.equal(evs(ev, 'loong').length, 1);
  const bites = evs(ev, 'loongBite');
  assert.equal(bites.length, YOULONG.bites[1], '咬够四口');
  assert.equal(new Set(bites.map((b) => b.target)).size, bites.length, '四口咬的是四只');
  assert.ok(!bites.some((b) => b.target === es[5].id), '够不着的不咬');
  for (const b of bites) {
    const e = es.find((x) => x.id === b.target)!;
    assert.ok(e.hp < e.maxHp);
    assert.ok(e.slow > 0, '咬到的走得慢');
  }
  assert.equal(evs(ev, 'loongEnd').length, 1);
  assert.equal(evs(ev, 'loongEnd')[0].burst, 0, '凡品尽头不凝冰');
  assert.ok(evs(ev, 'hit').every((h) => h.by === 'loong'));
});

test('游龙戟：只剩一只（打首领）就绕回来再咬——照样咬够口数；首领不吃减速以外的控制', () => {
  const { w, es } = arena([[60, 0, 'boss']]);
  const ev = run(w, 1.85);
  const bites = evs(ev, 'loongBite');
  assert.ok(bites.length >= 3, `绕回来再咬（咬了 ${bites.length} 口）`);
  assert.ok(bites.every((b) => b.target === es[0].id));
  assert.equal(es[0].frozen, 0);
});

test('游龙戟仙品「凝冰」：游到尽头炸开一片冰，圈里的冻住；器灵「双龙」一次两条；「回澜」游完掉头回主人身边、回程再咬', () => {
  const spots: [number, number][] = [
    [50, 0],
    [66, 14],
    [82, -8],
    [58, -24],
    [98, 8],
    [74, 26],
    [44, 20],
  ];
  const a = arena(spots, 3);
  const ev = run(a.w, 1.8);
  const end = evs(ev, 'loongEnd')[0];
  assert.ok(end && end.burst > 0, '尽头凝冰');
  assert.ok(evs(ev, 'freeze').length > 0, '冻住了');
  const b = arena(spots, 4, 'twin');
  const ev2 = run(b.w, 0.2);
  assert.equal(evs(ev2, 'loong').length, 2, '双龙');
  assert.equal(b.p.loongs?.length, 2);
  const c = arena(spots, 4, 'ebb');
  const ev3 = run(c.w, 1.85);
  assert.ok(evs(ev3, 'loongBite').length > YOULONG.bites[4], '回程又咬了');
  assert.equal(c.p.loongs, undefined, '游回来就收了');
  assert.ok(evs(ev3, 'loongEnd').length >= 2, '掉头处一次、收的时候一次');
});

test('化龙：那几秒不受伤、游得快；身子扫过的敌人隔一会儿挨一下、第一下冻住；变回来掀一圈浪（hualongEnd）', () => {
  const { w, p, es } = arena([
    [14, 0],
    [-12, 8],
    [40, 0],
    [200, 0],
  ]);
  p.weapons = [];
  p.skill = 1;
  const x0 = p.x;
  const ev0 = step(w, [{ mx: 0, my: 0, skill: true }]);
  assert.equal(evs(ev0, 'skill')[0]?.kind, 'hualong');
  assert.ok(p.hualong);
  assert.ok(p.iframes >= HUALONG.dur);
  // 扫到的会被撞开：这里每帧把第一只摆回身边，数它一秒里挨几下
  const ev: SimEvent[] = [...ev0];
  for (let i = 0; i < 60; i++) {
    es[0].x = p.x + 14;
    es[0].y = p.y;
    es[0].kx = es[0].ky = 0;
    ev.push(...step(w, [idle]));
  }
  const near = evs(ev, 'hit').filter((h) => h.id === es[0].id);
  assert.ok(near.length >= 3, `隔一会儿挨一下（1 秒 ${near.length} 下）`);
  assert.ok(evs(ev, 'freeze').some((f) => f.id === es[0].id), '第一下冻住');
  assert.equal(es[3].hp, es[3].maxHp, '远处的不挨');
  // 游得快：同样往右走 1 秒，比平常远
  const far = p.x;
  run(w, 1, { mx: 1, my: 0, skill: false });
  const fast = p.x - far;
  const n = arena([]);
  const nx = n.p.x;
  run(n.w, 1, { mx: 1, my: 0, skill: false });
  assert.ok(fast > (n.p.x - nx) * (1 + HUALONG.speed) * 0.9, '游得快');
  const ev2 = run(w, HUALONG.dur - 2 + 0.1);
  const end = evs(ev2, 'hualongEnd')[0];
  assert.ok(end, '变回来');
  assert.ok(end.r > 0);
  assert.equal(p.hualong, undefined);
  void x0;
});

test('被动「龙鳞」：气血 LONGLIN.full 以上伤害吃满，LONGLIN.none 以下不加，中间按比例；别的角色没有', () => {
  const { w, p, es } = arena([[30, 0]]);
  p.hp = p.stats.maxHp;
  assert.equal(longlinBonus(p), LONGLIN.max);
  assert.equal(heroHitMul(w, p, es[0]), 1 + LONGLIN.max);
  // 门槛从数值表里读（2026-11-11 数值平衡：九成 / 五成 → 八成 / 三成）
  p.hp = p.stats.maxHp * LONGLIN.none;
  assert.equal(longlinBonus(p), 0);
  p.hp = p.stats.maxHp * ((LONGLIN.full + LONGLIN.none) / 2);
  assert.ok(Math.abs(longlinBonus(p) - LONGLIN.max / 2) < 1e-9);
  const o = createWorld(1, 1, ['nezha']);
  assert.equal(heroHitMul(o, o.players[0], es[0]), 1);
});

test('避水兽：冲过敌群，只上减益不打伤害——打湿的走得慢、被往两边推开；湿着的挨一下水行的伤害就冻住（冻上就不湿了），首领不冻；霜髓：冻着的时候受伤更深', () => {
  // 避水兽卧在主人身后约 46 像素，出手范围以它为圆心 80（11-12 起）：敌群放在主人身前 20–34 像素
  const { w, p, es } = arena([
    [20, 6],
    [28, -8],
    [34, 4],
    [24, 0, 'boss'],
  ]);
  p.weapons = [];
  p.pet.cd = 0.05;
  const ev = run(w, 3.5); // 11-12 起一趟最多打湿 2 只（冷却 1.6 秒）：跑三趟
  const sp = evs(ev, 'splash');
  assert.ok(sp.length >= 1, '冲过去打湿了');
  assert.equal(evs(ev, 'hit').length, 0, '不打伤害');
  const wet = es.filter((e) => soaked(w, e));
  assert.ok(wet.length >= 3);
  for (const e of wet) assert.ok(e.slow > 0);
  const foe = wet.find((e) => e.kind !== 'boss')!;
  // 火行的打上去不冻；水行的打上去冻住
  hitEnemy(w, foe, { dmg: 5, by: 'thrust', owner: 0, from: p, el: 'fire', canCrit: false }, []);
  assert.equal(foe.frozen, 0);
  assert.ok(soaked(w, foe));
  const fe: SimEvent[] = [];
  hitEnemy(w, foe, { dmg: 5, by: 'loong', owner: 0, from: p, el: 'water', canCrit: false }, fe);
  assert.ok(foe.frozen >= BISHUI.freeze[0], '冻住');
  assert.equal(evs(fe, 'freeze').length, 1);
  assert.equal(soaked(w, foe), false, '冻上就不湿了');
  const boss = es[3];
  assert.ok(soaked(w, boss));
  hitEnemy(w, boss, { dmg: 5, by: 'loong', owner: 0, from: p, el: 'water', canCrit: false }, []);
  assert.equal(boss.frozen, 0, '首领不冻');
  // 霜髓
  const m = arena([[24, 0]]);
  m.p.weapons = [];
  m.p.pet.cd = 0.05;
  m.p.pet.stage = 1;
  m.p.pet.branch = 'marrow';
  run(m.w, 2);
  const e = m.es[0];
  assert.ok(soaked(m.w, e));
  hitEnemy(m.w, e, { dmg: 5, by: 'loong', owner: 0, from: m.p, el: 'water', canCrit: false }, []);
  assert.ok(e.frozen >= BISHUI.freeze[1] * BISHUI.marrow.freeze, '冻得更久');
  assert.ok(e.vulnT > 0 && e.vuln >= BISHUI.marrow.deep[1], '冻着的时候受伤更深');
});

test('回响敖丙的一局：同种子同输入完全确定；冰龙在游、化着龙、避水兽冲到一半时存档恢复后接着跑逐帧相同', () => {
  const play = () => {
    const w = createWorld(23, 1, ['huiao']);
    const trace: string[] = [];
    for (let i = 0; i < 60 * 70 && w.phase !== 'over'; i++) {
      step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
      if (i % 40 === 0) trace.push(digest(w));
    }
    return trace;
  };
  assert.deepEqual(play(), play());
  const w = createWorld(29, 1, ['huiao']);
  w.players[0].stats.maxHp = w.players[0].hp = 1e6;
  let saw = false;
  for (let i = 0; i < 60 * 60 && !saw; i++) {
    const p = w.players[0];
    p.skill = 1;
    step(w, [{ ...botInput(w, 0), skill: i > 300 }]);
    saw = !!p.loongs?.length && !!p.hualong && p.pet.mode === 'sweep';
  }
  assert.ok(saw, '三样同时在场');
  const r = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(canonicalText(r), canonicalText(w));
  for (let i = 0; i < 400; i++) {
    const a = JSON.stringify(step(w, [botInput(w, 0)]));
    const b = JSON.stringify(step(r, [botInput(r, 0)]));
    assert.equal(b, a, `第 ${i + 1} 帧跑岔了`);
  }
});
