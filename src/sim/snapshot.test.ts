// 整局快照（snapshot.ts）：存下来、原样恢复，恢复后接着跑和不中断直接跑逐帧相同。
// 测法：机器人打到某一刻存一份（走一趟 JSON，和联机时真的发出去一样），恢复成新世界；
// 原来的世界接着跑 M 帧，记下每一帧的事件和状态摘要；恢复出来的再跑同样的 M 帧（输入也由机器人按状态给），逐帧比，最后比整份状态。
// 恢复出来的那份每一帧开跑前都先把模块里的临时状态（core.ts 的空间网格）搅乱：模拟不能从上一帧的临时变量里读东西，
// 不然换一台机器（迁移后的新房主）恢复出来就会跑岔。
//
// 快照多大（JSON.stringify(snapshot(w)).length；种子 42，机器人打完整局，每半秒量一次，2026-11-10 量的）：
//   单人：刚开波中位 2.4 KB（最大 3.2 KB）；商店 2.5 KB；收灵 7.8 KB；首领战 5.5 KB；波中中位 21.5 KB，最大 62 KB（第 17 波，98 只敌人、88 颗灵石；gzip 后 14 KB）。
//   两人（按人数加强之后，下同）：刚开波中位 4.3 KB；商店 4.6 KB；首领战 9.3 KB；波中中位 32 KB，最大 76 KB（gzip 后 17 KB）。
//   四人：刚开波中位 8.3 KB（最大 9.2 KB）；商店 8.8 KB；收灵 17.5 KB；首领战 17.5 KB；波中中位 56 KB，最大 110 KB（第 17 波，166 只敌人；gzip 后 23 KB）。
//   一只敌人约 450 字节、一颗灵石约 130 字节、一个人物（含商店、宠物）约 1.8 KB。
// 房主迁移用的是「刚开波」那一份，几 KB。下面「单人」那条测试也断言了每种时刻都在 80 KB 以内。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type SimEvent, type World } from './world.ts';
import { botInput, botShop } from './bot.ts';
import { buildGrid, hurtPlayer } from './core.ts';
import { addPlayer, removePlayer, setAway } from './roster.ts';
import { COMMON_WEAPONS, WEAPONS, waveDuration } from './catalog.ts';
import { TECH_IDS } from './techniques.ts';
import { SNAPSHOT_VERSION, canonicalText, cloneWorld, findShared, restore, snapshot, worldHash, type WorldSnapshot } from './snapshot.ts';
import type { Enemy, WeaponKind } from './types.ts';

/** 机器人打一帧：每个人的移动、商店里的指令都由机器人按状态给。帧循环体单独放一个函数（见 tools/balance.ts 开头的 JIT 说明）。 */
function frame(w: World): SimEvent[] {
  const inputs = w.players.map((_, i) => botInput(w, i));
  const cmds = w.phase === 'shop' ? w.players.flatMap((_, i) => botShop(w, i)) : [];
  return step(w, inputs, cmds);
}

/** 一直打到 cond 成立（cond 拿到这一帧之后的世界和这一帧的事件）。打输了、通关了还没到就算没到。 */
function until(w: World, cond: (w: World, ev: SimEvent[]) => boolean, max = 60 * 60 * 20): boolean {
  for (let i = 0; i < max; i++) {
    if (w.phase === 'over' || w.phase === 'win') return false;
    if (cond(w, frame(w))) return true;
  }
  return false;
}

/** 走一趟 JSON：联机时快照是这样发出去、收进来的。 */
const viaJson = (s: WorldSnapshot): WorldSnapshot => JSON.parse(JSON.stringify(s));

const canon = canonicalText;

/** 两份 JSON 第一处不同的地方（出错时报得清楚些）。 */
function firstDiff(a: unknown, b: unknown, path = 'w'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return `${path}: 键不同 [${ka}] ≠ [${kb}]`;
  for (const k of ka) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** 乱七八糟的一堆敌人，用来把空间网格搅乱。 */
const junk: Enemy[] = (() => {
  const w = createWorld(31337);
  const out: Enemy[] = [];
  for (let i = 0; i < 90; i++) out.push(spawnEnemy(w, 'soldier', 30 + ((i * 97) % 900), 30 + ((i * 53) % 480), []));
  return out;
})();
const scramble = () => buildGrid(junk);

/**
 * 核心检查：w 此刻存一份（走 JSON）、恢复；w 接着跑 frames 帧，恢复出来的也跑 frames 帧，逐帧比事件与摘要，最后比整份状态。
 * 返回快照的 JSON 字节数。
 */
function checkResume(w: World, frames: number, label: string): number {
  const text = JSON.stringify(snapshot(w));
  const b = restore(JSON.parse(text));
  assert.equal(canon(b), canon(w), `${label}：刚恢复出来就和原来不一样`);
  assert.deepEqual(findShared(b), findShared(w), `${label}：挂在两处的对象恢复后不是原样`);
  const evA: string[] = [];
  const dgA: string[] = [];
  for (let i = 0; i < frames; i++) {
    evA.push(JSON.stringify(frame(w)));
    dgA.push(digest(w));
  }
  // 换一台机器恢复：模块里的临时状态是别的样子
  const other = createWorld(4242);
  for (let i = 0; i < 30; i++) frame(other);
  for (let i = 0; i < frames; i++) {
    scramble();
    const ev = JSON.stringify(frame(b));
    if (ev !== evA[i] || digest(b) !== dgA[i]) assert.fail(`${label}：恢复后第 ${i + 1} 帧跑岔了\n${firstDiff(JSON.parse(evA[i]), JSON.parse(ev), 'events') ?? '事件相同，状态摘要不同'}`);
  }
  const d = firstDiff(JSON.parse(canon(w)), JSON.parse(canon(b)));
  assert.equal(d, null, `${label}：跑完 ${frames} 帧后整份状态不同：${d}`);
  return text.length;
}

test('快照是纯数据：走一趟 JSON 不丢东西，恢复出来的和原来逐项相同，而且不共用任何对象', () => {
  const w = createWorld(7);
  assert.ok(until(w, (w) => w.phase === 'wave' && w.wave === 2 && w.waveT > 8));
  const s = snapshot(w);
  assert.equal(s.v, SNAPSHOT_VERSION);
  assert.equal(s.tick, w.tick);
  assert.equal(s.wave, 2);
  assert.equal(s.phase, 'wave');
  const b = restore(viaJson(s));
  assert.equal(canon(b), canon(w));
  assert.equal(digest(b), digest(w));
  assert.equal(b.rng.state, w.rng.state);
  assert.equal(b.rng.next(), cloneWorld(w).rng.next(), '随机数从同一个状态接着出');
  // 改恢复出来的，不影响原来的（也不影响快照本身）
  const before = canon(w);
  b.players[0].x += 50;
  b.players[0].weapons.push({ kind: 'huojian', tier: 1, spirit: null, cd: 0 });
  b.enemies.length = 0;
  assert.equal(canon(w), before);
  assert.equal(worldHash(restore(viaJson(s))), worldHash(w), '同一份存档恢复几次都一样');
  assert.notEqual(worldHash(b), worldHash(w));
});

test('JSON 存不下的值也能原样存回来：-0、NaN、±Infinity、Set、Map、数组里的 undefined', () => {
  const w = createWorld(3);
  const e = spawnEnemy(w, 'soldier', 300, 300, []);
  e.kx = -0;
  e.ky = NaN;
  e.burnAcc = Infinity;
  e.bleedAcc = -Infinity;
  w.rings.push({ id: 99, owner: 0, x: 1, y: 2, px: 1, py: 2, vx: 0, vy: -0, out: 0, returning: false, primary: true, hits: new Set([5, 3, 9]), life: 1, dmg: 2, range: 100, fireBurst: false, hover: 0, grind: new Map([[7, 2], [3, 1]]) });
  w.knives.push({ id: 98, owner: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, target: 1, hitsLeft: 2, hit: new Set(), again: new Set([4]), dmg: 1, life: 1 });
  (w.players[0].pet.hits as unknown as (number | undefined)[]).push(undefined, 4);
  const b = restore(viaJson(snapshot(w)));
  const e2 = b.enemies[0];
  assert.ok(Object.is(e2.kx, -0), '-0 还是 -0（JSON 会写成 0）');
  assert.ok(Number.isNaN(e2.ky));
  assert.equal(e2.burnAcc, Infinity);
  assert.equal(e2.bleedAcc, -Infinity);
  const r = b.rings[0];
  assert.ok(r.hits instanceof Set && [...r.hits].join() === '5,3,9', 'Set 原样回来（顺序也一样）');
  assert.ok(r.grind instanceof Map && [...r.grind].join(';') === '7,2;3,1', 'Map 原样回来（顺序也一样）');
  assert.ok(Object.is(r.vy, -0));
  assert.ok(b.knives[0].hit instanceof Set && b.knives[0].hit.size === 0);
  assert.deepEqual([...b.knives[0].again!], [4]);
  const hits = b.players[0].pet.hits as unknown as (number | undefined)[];
  assert.equal(hits.length, 2);
  assert.equal(hits[0], undefined);
  assert.equal(hits[1], 4);
});

test('存不下的东西直接报错、报出在哪（函数、类的实例），不悄悄丢掉；版本对不上也报错', () => {
  const w = createWorld(3);
  (w.players[0] as unknown as Record<string, unknown>).cb = () => 1;
  assert.throws(() => snapshot(w), /w\.players\[0\]\.cb/);
  delete (w.players[0] as unknown as Record<string, unknown>).cb;
  (w as unknown as Record<string, unknown>).when = new Date(0);
  assert.throws(() => snapshot(w), /w\.when.*Date/);
  delete (w as unknown as Record<string, unknown>).when;
  const s = snapshot(w);
  assert.throws(() => restore({ ...s, v: SNAPSHOT_VERSION + 1 }), /版本/);
});

test('同一个对象挂在两处（五火的五道火浪共用一份「打过谁」）、连成环，恢复后还是同一个对象', () => {
  const w = createWorld(3);
  assert.deepEqual(findShared(w), [], '刚开局是一棵树');
  const hit = [4, 2];
  for (let k = 0; k < 3; k++) w.zones.push({ id: 50 + k, owner: 0, kind: 'flameWave', x: 0, y: 0, x2: 0, y2: 0, r: 0, t: 0, life: 1, tick: 0, dmg: 1, tier: 4, a: k, arc: 0.4, len: 90, hit });
  const loop: Record<string, unknown> = { n: 1 };
  loop.self = loop;
  (w as unknown as Record<string, unknown>).loop = loop;
  assert.deepEqual(findShared(w), ['w.zones[1].hit = w.zones[0].hit', 'w.zones[2].hit = w.zones[0].hit', 'w.loop.self = w.loop']);
  const b = restore(viaJson(snapshot(w)));
  assert.equal(canon(b), canon(w));
  assert.ok(b.zones[1].hit === b.zones[0].hit && b.zones[2].hit === b.zones[0].hit, '三道还是共用同一份');
  b.zones[2].hit!.push(9);
  assert.deepEqual(b.zones[0].hit, [4, 2, 9]);
  assert.deepEqual(w.zones[0].hit, [4, 2], '和原来的不共用');
  const l2 = (b as unknown as Record<string, Record<string, unknown>>).loop;
  assert.equal(l2.self, l2);
});

test('单人：刚开波、波中、收灵、商店存下来，恢复后接着跑和不中断的逐帧相同', () => {
  const sizes: Record<string, number> = {};
  const w = createWorld(43); // 种子要让机器人打到第 5 波（2026-11-11 数值平衡后种子 42 在第 5 波陨落）
  assert.ok(until(w, (w, ev) => ev.some((e) => e.t === 'waveStart' && e.wave === 3)), '打到第 3 波开波');
  assert.equal(w.waveT, 0);
  sizes.刚开波 = checkResume(w, 600, '刚开波');
  assert.ok(until(w, (w) => w.phase === 'wave' && w.waveT >= 22 && w.enemies.length > 30), '打到波中，场上一堆敌人');
  sizes.波中 = checkResume(w, 600, '波中');
  assert.ok(until(w, (w) => w.phase === 'collect' && w.collectT >= 0.3 && w.gems.length > 0), '收灵，灵石正飞着');
  sizes.收灵 = checkResume(w, 240, '收灵');
  assert.ok(until(w, (w) => w.phase === 'shop'), '进了商店');
  frame(w); // 机器人先买一样
  sizes.商店 = checkResume(w, 900, '商店');
  assert.ok(w.wave >= 5, `商店之后接着打了下一波（第 ${w.wave} 波）`);
  for (const [k, v] of Object.entries(sizes)) assert.ok(v < 80_000, `${k} 的快照 ${v} 字节`);
});

test('单人：首领战（第二、三阶段、魔焰焚城、倒下的表现）存下来，恢复后接着跑相同', () => {
  const w = createWorld(43); // 种子要让机器人打到第一章首领的第二阶段（同上）
  assert.ok(until(w, (w) => !!w.boss && w.boss.phase >= 2 && w.boss.hazards.length > 0), '打到首领第二阶段、招式正放着');
  w.players[0].hp = w.players[0].stats.maxHp = 1e6; // 这条测的是存档，不是这个种子打不打得过首领
  checkResume(w, 600, '首领第二阶段');
  // 直接把首领打到三成以下：第三阶段的魔焰焚城（魔气往里压）
  const boss = w.enemies.find((e) => e.id === w.boss!.id)!;
  boss.hp = Math.ceil(boss.maxHp * 0.29);
  assert.ok(until(w, (w) => !!w.boss && w.boss.phase === 3 && w.boss.kind === 'nezha' && w.boss.inferno.on && w.miasmaInset.x > 0, 60 * 60), '第三阶段，魔气正往里压');
  // 首领的血加厚（比例不变，还是第三阶段）：免得下面这 600 帧里机器人就把它打倒了（功法扩到 24 门之后，这个种子悟到的功法不同、打得更快）
  const b3 = w.enemies.find((e) => e.id === w.boss!.id)!;
  b3.maxHp *= 4;
  b3.hp = Math.ceil(b3.maxHp * 0.29);
  checkResume(w, 600, '首领第三阶段');
  const b2 = w.enemies.find((e) => e.id === w.boss!.id)!;
  b2.hp = 1;
  assert.ok(until(w, (w) => w.boss?.state === 'dead', 60 * 30), '首领倒下');
  checkResume(w, 300, '首领倒下的表现');
});

/** 全部法宝（十六件，加上 arti2 再加的）按四件一组，神品两个器灵各一遍、仙品一遍，再悟满所有功法、宠物进化到头：各种运行时状态都出现一遍。 */
test('各种法宝、器灵、功法、宠物分支的运行时状态都存得下：恢复后接着跑相同', () => {
  const kinds: WeaponKind[] = ['qiankun', ...COMMON_WEAPONS];
  assert.ok(kinds.length >= 16);
  const groups = Math.ceil(kinds.length / 4);
  let configs = 0;
  for (let g = 0; g < groups; g++) {
    const group = kinds.slice(g * 4, g * 4 + 4);
    for (const mode of [0, 1, 2]) {
      const w = createWorld(500 + g * 3 + mode);
      w.wave = 5;
      w.waveLen = waveDuration(5);
      const p = w.players[0];
      p.weapons = group.map((kind) => ({ kind, tier: mode === 2 ? 3 : 4, spirit: mode === 2 ? null : WEAPONS[kind].spirits[mode].id, cd: 0.5 }));
      p.techs = [...TECH_IDS];
      p.pet.stage = 3;
      p.pet.branch = mode === 1 ? 'fire' : 'bind';
      p.stats.maxHp = p.hp = 600;
      p.skill = 1;
      for (let i = 0; i < 60 * 9; i++) frame(w);
      assert.equal(w.phase, 'wave');
      checkResume(w, 240, `${group.join('+')}（${mode === 2 ? '仙品' : `器灵 ${mode + 1}`}）`);
      configs++;
    }
  }
  assert.equal(configs, groups * 3);
});

/** 一下打空（闪避率是 0，不会闪开）。 */
const knockOut = (w: World, id: number) => {
  const p = w.players[id];
  p.iframes = 0;
  hurtPlayer(w, p, 1e6, 'contact', []);
};

test('四个人（倒地救援、托管、离开、中途加入、出局归队）：各个时刻存下来，恢复后接着跑相同', () => {
  const w = createWorld(77, 4);
  setAway(w, 3, true);
  assert.ok(until(w, (w) => w.phase === 'wave' && w.waveT > 8));
  knockOut(w, 1);
  knockOut(w, 2);
  assert.ok(until(w, (w) => !!w.players[1].helpers?.length || !!w.players[2].helpers?.length, 60 * 10), '有人在扶');
  assert.ok(w.players.some((p) => p.down), '还倒着');
  checkResume(w, 600, '四人·有人倒地正被扶');
  removePlayer(w, 2);
  knockOut(w, 1);
  assert.ok(until(w, (w) => !!w.players[1].out, 60 * 20) || w.players[1].alive, '没人扶就出局（或者被扶起来了）');
  checkResume(w, 300, '四人·有人离开、有人出局');
  assert.ok(until(w, (w) => w.phase === 'shop'));
  const n = addPlayer(w, 'nezha')!;
  assert.equal(n.id, 2, '中途加入复用离开的人的格子');
  frame(w);
  checkResume(w, 600, '四人·商店里刚加入一个人');
  assert.ok(until(w, (w, ev) => ev.some((e) => e.t === 'waveStart')), '下一波');
  assert.equal(w.waveT, 0);
  const size = checkResume(w, 600, '四人·刚开波');
  assert.ok(size < 20_000, `四人刚开波的快照 ${size} 字节`);
});

test('房主迁移：每波开打时存一份发给所有人；旧房主掉线后，新房主从这一份重开这一波（把旧房主标成托管）—— 两台机器各自恢复，跑出来一样', () => {
  const host = createWorld(88, 3);
  let save = '';
  assert.ok(
    until(host, (w, ev) => {
      if (ev.some((e) => e.t === 'waveStart')) save = JSON.stringify(snapshot(w)); // 每波开打时存一份（房主广播出去）
      return w.wave === 3 && w.phase === 'wave' && w.waveT > 12;
    }),
  );
  const at = JSON.parse(save) as WorldSnapshot;
  assert.equal(at.wave, 3);
  assert.equal(at.phase, 'wave');
  // 旧房主（0 号）掉线：1 号和 2 号各自收到过这份存档，谁当新房主都一样
  const replay = () => {
    const w = restore(JSON.parse(save));
    assert.equal(w.waveT, 0, '从这一波开头重开');
    setAway(w, 0, true);
    const ev: string[] = [];
    for (let i = 0; i < 60 * 15; i++) ev.push(JSON.stringify(frame(w)));
    return { w, ev };
  };
  const a = replay();
  const b = replay();
  assert.deepEqual(a.ev, b.ev);
  assert.equal(worldHash(a.w), worldHash(b.w));
  assert.equal(a.w.players[0].away, true);
  assert.ok(a.w.players[0].kills > 0, '旧房主的人物由机器人接着打');
});
