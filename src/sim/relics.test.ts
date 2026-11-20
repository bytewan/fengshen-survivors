// 灵物、符箓、丹药（M3 新加的那批，机制在 relics.ts）：每件有机制的灵物一条（触发条件和效果），符箓、丹药各一条，
// 外加「带着全部新道具打几波，中途存档恢复后逐帧相同」（联机要整局存档）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, MIASMA, SKILL } from './config.ts';
import { CHARM, CHARMS, ELIXIRS, LINGZHU, RELIC, RELICS, priceScale, waveDuration } from './catalog.ts';
import { hitEnemy, hurtPlayer } from './core.ts';
import { applyCommand, buy } from './shop.ts';
import { botInput, botShop } from './bot.ts';
import { relicSpeed, relicState, relicWaveStart } from './relics.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { CharmId, ElixirId, EnemyKindName, Player, RelicEvent, RelicId } from './types.ts';

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
/** 带上 n 件灵物（和商店里买下一样：加属性、记件数）。 */
const give = (p: Player, id: RelicId, n = 1) => {
  for (let i = 0; i < n; i++) RELICS[id].apply(p.stats);
  p.relics[id] = (p.relics[id] ?? 0) + n;
};
/** 干净的测试场：刷怪关掉、宠物不出手、人物不带法宝、无敌（要挨打的测试自己把 iframes 清零）。 */
const arena = (seed: number, relics: Partial<Record<RelicId, number>> = {}, charms: CharmId[] = []) => {
  const w = createWorld(seed);
  quiet(w);
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  for (const [id, n] of Object.entries(relics) as [RelicId, number][]) give(p, id, n);
  p.charms = [...charms];
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
const relicEvents = (ev: SimEvent[], kind: RelicEvent['kind']) => ev.filter((e): e is RelicEvent => e.t === 'relic' && e.kind === kind);
/** 一下不暴击、不带五行的伤害（量倍数用）。 */
const plain = (w: World, e: ReturnType<typeof enemy>, dmg = 100, ev: SimEvent[] = []) => hitEnemy(w, e, { dmg, by: 'ring', owner: 0, from: e, canCrit: false }, ev);
/** 进商店（跑完第 1 波，人物无敌、不出手）。 */
const toShop = (seed: number) => {
  const w = createWorld(seed);
  const p = w.players[0];
  p.iframes = 1e9;
  p.weapons = [];
  p.pet.cd = 1e12;
  run(w, waveDuration(1) + 3.5);
  assert.equal(w.phase, 'shop');
  return { w, p };
};
/** 商店里出战（升级都选完），返回开波那一帧的事件。 */
const startNext = (w: World) => {
  const p = w.players[0];
  p.petOffer = null;
  p.techOffer = null;
  while (p.pendingLevels > 0) applyCommand(w, { t: 'pick', player: 0, index: 0 }, []);
  return step(w, [idle], [{ t: 'ready', player: 0 }]);
};

// ---------------------------------------------------------------- 有机制的灵物

test('风火蒲团：站定 1 秒后入定回血，一动就断；没带的不回', () => {
  const { w, p } = arena(1, { cushion: 1 });
  p.hp = 50;
  run(w, 0.8);
  assert.equal(p.hp, 50, '站了不到 1 秒，还没入定');
  run(w, 2);
  const gain = p.hp - 50;
  assert.ok(Math.abs(gain - RELIC.cushion.regen * 1.8) < 0.2, `入定 1.8 秒左右回 ${gain}`);
  const h = p.hp;
  run(w, 1, () => ({ mx: 1, my: 0, skill: false }));
  assert.equal(p.hp, h, '走动时不回');
  const b = arena(1);
  b.p.hp = 50;
  run(b.w, 3);
  assert.equal(b.p.hp, 50, '没带蒲团：站着也不回');
});

test('金刚琢印：每波第一次受伤砸向身边的敌人（伤害、晕）；第二次不砸；带两件第二次也砸；每波重置', () => {
  const { w, p } = arena(2, { zhuo: 1 });
  p.iframes = 0;
  const near = enemy(w, 'soldier', p.x + 20, p.y);
  const far = enemy(w, 'soldier', p.x + 120, p.y);
  const ev: SimEvent[] = [];
  hurtPlayer(w, p, 10, 'contact', ev);
  const z = relicEvents(ev, 'zhuo');
  assert.equal(z.length, 1);
  assert.deepEqual(z[0].ids, [near.id], '只砸身边的');
  assert.ok(near.hp < 9999 - 30 && near.stun > 0.5, '砸出伤害、晕住');
  assert.equal(far.hp, 9999);
  p.iframes = 0;
  const ev2: SimEvent[] = [];
  hurtPlayer(w, p, 10, 'contact', ev2);
  assert.equal(relicEvents(ev2, 'zhuo').length, 0, '一件只砸每波第一次');
  give(p, 'zhuo');
  p.iframes = 0;
  const ev3: SimEvent[] = [];
  hurtPlayer(w, p, 10, 'contact', ev3);
  assert.equal(relicEvents(ev3, 'zhuo').length, 1, '两件：第二次也砸');
  relicWaveStart(w, p, []);
  assert.equal(relicState(p).zhuo, 0, '每波开始重置');
});

test('九龙玉佩：触发五行相生时在那只身边炸开一小圈（相生那一下的 40%），不再连锁', () => {
  const { w, p } = arena(3, { jadedragon: 1 });
  const e = enemy(w, 'soldier', p.x + 60, p.y);
  const o = enemy(w, 'soldier', p.x + 72, p.y);
  e.mark = 'wood';
  e.markT = 2;
  const ev: SimEvent[] = [];
  const dmg = hitEnemy(w, e, { dmg: 100, by: 'ring', owner: 0, from: p, el: 'fire', canCrit: false }, ev);
  const j = relicEvents(ev, 'jadedragon');
  assert.equal(j.length, 1, '引燃（木生火）触发了一次');
  assert.equal(j[0].react, 'ignite');
  const blast = ev.filter((x) => x.t === 'hit' && x.by === 'relic' && x.id === o.id);
  assert.equal(blast.length, 1, '身边那只挨了一下');
  assert.equal(blast[0].t === 'hit' && blast[0].dmg, Math.round(dmg * RELIC.jadedragon.mul));
  // 没有相生：不炸
  const ev2: SimEvent[] = [];
  hitEnemy(w, o, { dmg: 100, by: 'ring', owner: 0, from: p, el: 'metal', canCrit: false }, ev2);
  assert.equal(relicEvents(ev2, 'jadedragon').length, 0);
});

test('照妖镜碎片：开波 1.5 秒后照出附近血最厚的一只，4 秒内它受到的伤害 +25%（别的不加）；之后每 7 秒一次', () => {
  const { w, p } = arena(4, { mirror: 1 });
  const big = enemy(w, 'soldier', p.x + 50, p.y, 5000);
  const small = enemy(w, 'soldier', p.x - 50, p.y, 3000);
  const ev = run(w, 1.6);
  const m = relicEvents(ev, 'mirror');
  assert.equal(m.length, 1);
  assert.equal(m[0].id, big.id, '照的是血最厚的');
  assert.equal(plain(w, big), 125);
  assert.equal(plain(w, small), 100);
  run(w, 4);
  assert.equal(plain(w, big), 100, '4 秒后照的效果过了');
  const ev2 = run(w, 3);
  assert.equal(relicEvents(ev2, 'mirror').length, 1, '7 秒后又照一次');
});

test('混元伞残片：挡下一枚鬼火（不掉血），6 秒内再来的照打；贴身的不挡；带两件间隔短 1 秒', () => {
  const { w, p } = arena(5, { umbrella: 1 });
  p.iframes = 0;
  const ev: SimEvent[] = [];
  assert.equal(hurtPlayer(w, p, 10, 'orb', ev), false);
  assert.equal(p.hp, 100);
  assert.equal(relicEvents(ev, 'umbrella').length, 1);
  assert.equal(hurtPlayer(w, p, 10, 'orb', []), true, '还没撑开，照打');
  p.iframes = 1e9;
  run(w, 6.1);
  p.iframes = 0;
  assert.equal(hurtPlayer(w, p, 10, 'contact', []), true, '贴身的不挡');
  p.iframes = 0;
  assert.equal(hurtPlayer(w, p, 10, 'orb', []), false, '6 秒后又能挡');
  assert.equal(relicState(p).umbrella, RELIC.umbrella.cd);
  give(p, 'umbrella');
  p.iframes = 1e9;
  run(w, 6.1);
  p.iframes = 0;
  assert.equal(hurtPlayer(w, p, 10, 'orb', []), false);
  assert.equal(relicState(p).umbrella, RELIC.umbrella.cd - RELIC.umbrella.cdPer, '两件：间隔短 1 秒');
});

test('乾坤袋：开波时每 10 枚灵石生 1 枚，最多 5 枚；两件翻倍', () => {
  const a = toShop(6);
  give(a.p, 'pouch');
  a.p.lingshi = 37;
  const ev = startNext(a.w);
  assert.equal(a.w.phase, 'wave');
  assert.equal(a.p.lingshi, 40);
  assert.equal(relicEvents(ev, 'pouch')[0]?.v, 3);
  const b = toShop(7);
  give(b.p, 'pouch', 2);
  b.p.lingshi = 200;
  startNext(b.w);
  assert.equal(b.p.lingshi, 210, '两件：每 10 枚生 2 枚，上限 10');
});

test('桃木簪：魔气里的减速、侵蚀都减半', () => {
  const measure = (pin: boolean) => {
    const { w, p } = arena(8, pin ? { hairpin: 1 } : {});
    p.x = p.px = -MIASMA.depth * 0.5; // 魔气带正中
    p.y = p.py = 200;
    p.miasma = 0.5;
    const hp0 = p.hp;
    const y0 = p.y;
    run(w, 1, () => ({ mx: 0, my: 1, skill: false })); // 顺着魔气带往下走
    return { lost: hp0 - p.hp, moved: p.y - y0 };
  };
  const plainRun = measure(false);
  const pin = measure(true);
  assert.ok(Math.abs(pin.lost / plainRun.lost - 0.5) < 0.02, `侵蚀减半：${pin.lost} / ${plainRun.lost}`);
  assert.ok(pin.moved > plainRun.moved * 1.4, `走得快：${pin.moved} > ${plainRun.moved}`);
});

test('风雷羽：直接打中的暴击有几率引下一道小雷，劈中身边的另一只（暴击伤害的一半，不再引雷）；不暴击不引', () => {
  const { w, p } = arena(9, { stormfeather: 4 }); // 四件：60%（封顶）
  p.stats.crit = 1;
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  const o = enemy(w, 'soldier', p.x + 60, p.y);
  const ev: SimEvent[] = [];
  let direct = 0;
  for (let i = 0; i < 60; i++) direct += hitEnemy(w, e, { dmg: 50, by: 'ring', owner: 0, from: p }, ev) > 0 ? 1 : 0;
  const bolts = relicEvents(ev, 'stormfeather');
  assert.ok(bolts.length > 20 && bolts.length < 50, `60 次暴击引了 ${bolts.length} 道（约六成）`);
  assert.ok(bolts.every((b) => b.id === o.id), '劈的是身边的另一只');
  const hits = ev.filter((x) => x.t === 'hit' && x.by === 'relic');
  assert.equal(hits.length, bolts.length, '小雷不暴击、不再引雷');
  assert.ok(hits.every((h) => h.t === 'hit' && !h.crit && h.dmg === Math.round(Math.round(50 * p.stats.critMul) * RELIC.stormfeather.mul)));
  void direct;
  p.stats.crit = 0;
  const ev2: SimEvent[] = [];
  for (let i = 0; i < 30; i++) hitEnemy(w, e, { dmg: 50, by: 'ring', owner: 0, from: p }, ev2);
  assert.equal(relicEvents(ev2, 'stormfeather').length, 0);
});

test('踏云履：战斗中捡到灵石后 1.5 秒内移速 +20%', () => {
  const { w, p } = arena(10, { cloudshoe: 1 });
  assert.equal(relicSpeed(p), 0);
  w.gems.push({ id: w.nextId++, x: p.x + 2, y: p.y - 6, px: p.x + 2, py: p.y - 6, vx: 0, vy: 0, value: 1, pulled: p.id });
  const ev = run(w, 0.1);
  assert.ok(ev.some((x) => x.t === 'pickup'));
  assert.equal(relicEvents(ev, 'cloudshoe').length, 1);
  assert.ok(Math.abs(relicSpeed(p) - RELIC.cloudshoe.speed) < 1e-9);
  run(w, 1.6);
  assert.equal(relicSpeed(p), 0, '1.5 秒后恢复');
});

test('逆鳞：气血低于三成时伤害 +30%', () => {
  const { w, p } = arena(11, { scale: 1 });
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  assert.equal(plain(w, e), 100);
  p.hp = 29;
  assert.equal(plain(w, e), 130);
});

test('定颜珠：打中晕住 / 冻住的敌人伤害 +20%（同一只隔一会儿才报一次）', () => {
  const { w, p } = arena(12, { dingyan: 1 });
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  assert.equal(plain(w, e), 100);
  e.stun = 1;
  const ev: SimEvent[] = [];
  assert.equal(plain(w, e, 100, ev), 120);
  plain(w, e, 100, ev);
  assert.equal(relicEvents(ev, 'dingyan').length, 1, '同一只连着打只报一次');
  e.frozen = 1;
  assert.equal(plain(w, e), 120, '冻住的也算（冻结时也晕着）');
});

test('冰心玉壶：一波打完没被打中过多得灵石（随波次涨）；被打中过就没有', () => {
  const a = toShop(13);
  give(a.p, 'icevase');
  startNext(a.w);
  const before = a.p.lingshi;
  const ev = run(a.w, waveDuration(2) + 0.2);
  const ice = relicEvents(ev, 'icevase');
  assert.equal(ice.length, 1);
  assert.equal(ice[0].v, Math.round(RELIC.icevase.lingshi * priceScale(2)));
  assert.ok(a.p.lingshi >= before + ice[0].v!);
  const b = toShop(13);
  give(b.p, 'icevase');
  startNext(b.w);
  b.p.iframes = 0;
  hurtPlayer(b.w, b.p, 5, 'contact', []);
  b.p.iframes = 1e9;
  const ev2 = run(b.w, waveDuration(2) + 0.2);
  assert.equal(relicEvents(ev2, 'icevase').length, 0);
});

// ---------------------------------------------------------------- 魔物

test('噬心蛊（魔物）：伤害 +30%；每波开打时噬去一成当前气血（两件噬两次；最多扣到 1 点）', () => {
  const a = toShop(14);
  a.p.shop[0] = { cat: 'relic', id: 'gu', price: 1 };
  a.p.lingshi = 10;
  const d0 = a.p.stats.damage;
  assert.equal(buy(a.w, a.p, 0), 'relic');
  assert.ok(Math.abs(a.p.stats.damage - d0 - RELIC.gu.damage) < 1e-9);
  a.p.hp = a.p.stats.maxHp;
  const ev = startNext(a.w);
  assert.equal(a.p.hp, a.p.stats.maxHp - Math.round(a.p.stats.maxHp * RELIC.gu.drain));
  assert.equal(relicEvents(ev, 'gu').length, 1);
  a.p.hp = 50;
  relicWaveStart(a.w, a.p, []);
  assert.equal(a.p.hp, 50 - Math.round(50 * RELIC.gu.drain), '按当前气血算');
  give(a.p, 'gu');
  a.p.hp = 100;
  relicWaveStart(a.w, a.p, []);
  assert.equal(a.p.hp, 100 - Math.round(100 * (1 - (1 - RELIC.gu.drain) ** 2)), '两件：噬两次');
  a.p.hp = 1;
  relicWaveStart(a.w, a.p, []);
  assert.equal(a.p.hp, 1, '最多扣到 1 点');
});

test('夔牛鼓（魔物）：一通鼓前 4 秒伤害 +60%，后 4 秒 −25%；每 8 秒擂一通', () => {
  const { w, p } = arena(15, { drum: 1 });
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  relicWaveStart(w, p, []);
  assert.equal(plain(w, e), 160);
  run(w, 5);
  assert.equal(plain(w, e), 75);
  const ev = run(w, 3.1);
  assert.equal(relicEvents(ev, 'drum').length, 1, '第 8 秒又擂一通');
  assert.equal(plain(w, e), 160);
});

test('燃魂香（魔物）：击杀攒的真气翻倍；放神通时燃去两成当前气血', () => {
  const { w, p } = arena(16, { incense: 1 });
  const e = enemy(w, 'soldier', p.x + 40, p.y, 1);
  plain(w, e, 10);
  assert.ok(Math.abs(p.skill - SKILL.chargePerKill * (2 + LINGZHU.charge)) < 1e-9); // 哪吒「灵珠子」另加 LINGZHU.charge
  p.skill = 1;
  p.hp = 80;
  const ev = run(w, DT, () => ({ mx: 0, my: 0, skill: true }));
  assert.ok(ev.some((x) => x.t === 'skill'));
  assert.equal(relicEvents(ev, 'incense')[0]?.v, Math.round(80 * RELIC.incense.cost));
  assert.equal(p.hp, 80 - Math.round(80 * RELIC.incense.cost));
});

// ---------------------------------------------------------------- 符箓

test('定身符：气血跌破一半时定住身边的敌人（首领除外），每波一次', () => {
  const { w, p } = arena(17, {}, ['dingshen']);
  p.iframes = 0;
  const e = enemy(w, 'soldier', p.x + 30, p.y);
  const far = enemy(w, 'soldier', p.x + 150, p.y);
  hurtPlayer(w, p, 10, 'contact', []);
  assert.equal(e.stun, 0, '还没跌破一半');
  p.hp = 52;
  p.iframes = 0;
  const ev: SimEvent[] = [];
  hurtPlayer(w, p, 10, 'contact', ev);
  assert.equal(relicEvents(ev, 'dingshen').length, 1);
  assert.equal(e.stun, CHARM.dingshen.t);
  assert.equal(far.stun, 0);
  p.iframes = 0;
  e.stun = 0;
  hurtPlayer(w, p, 10, 'contact', []);
  assert.equal(e.stun, 0, '每波一次');
});

test('引雷符：被围住（身边 8 只以上）时引雷劈开身边一圈，每波一次', () => {
  const { w, p } = arena(18, {}, ['yinlei']);
  const ring = Array.from({ length: 7 }, (_, i) => enemy(w, 'soldier', p.x + Math.cos(i) * 30, p.y + Math.sin(i) * 30));
  assert.equal(relicEvents(run(w, 0.2), 'yinlei').length, 0, '7 只还不算被围住');
  ring.push(enemy(w, 'soldier', p.x - 30, p.y));
  const ev = run(w, 0.2);
  const y = relicEvents(ev, 'yinlei');
  assert.equal(y.length, 1);
  assert.ok(ring.every((e) => e.hp < 9999), '一圈都劈到');
  assert.equal(relicEvents(run(w, 0.5), 'yinlei').length, 0, '每波一次');
});

test('遁地符：气血跌破三成时遁地 2 秒（打不着、移速 +50%），每波一次', () => {
  const { w, p } = arena(19, {}, ['dundi']);
  p.iframes = 0;
  p.hp = 35;
  const ev: SimEvent[] = [];
  hurtPlayer(w, p, 10, 'contact', ev);
  assert.equal(relicEvents(ev, 'dundi').length, 1);
  assert.ok(p.iframes >= CHARM.dundi.t - 1e-9, '遁地时打不着');
  assert.ok(Math.abs(relicSpeed(p) - CHARM.dundi.speed) < 1e-9);
  run(w, 2.1);
  assert.equal(relicSpeed(p), 0);
});

test('神行符：受伤后 2 秒内移速 +40%，每波三次', () => {
  const { w, p } = arena(20, {}, ['shenxing']);
  let n = 0;
  for (let i = 0; i < 5; i++) {
    p.iframes = 0;
    const ev: SimEvent[] = [];
    hurtPlayer(w, p, 2, 'contact', ev);
    n += relicEvents(ev, 'shenxing').length;
  }
  assert.equal(n, CHARM.shenxing.n);
  assert.ok(Math.abs(relicSpeed(p) - CHARM.shenxing.speed) < 1e-9);
});

test('招宝符：这一波第 40 只击杀时掉一个乾坤宝匣，每波一次', () => {
  const { w, p } = arena(21, {}, ['zhaobao']);
  let drops = 0;
  for (let i = 0; i < 80; i++) {
    const e = enemy(w, 'soldier', p.x + 40, p.y, 1);
    const ev: SimEvent[] = [];
    plain(w, e, 10, ev);
    const z = relicEvents(ev, 'zhaobao');
    if (z.length) {
      drops++;
      assert.equal(i + 1, CHARM.zhaobao.kills);
      assert.ok(w.drops.some((d) => d.id === z[0].id && d.kind === 'chest'));
    }
  }
  assert.equal(drops, 1);
});

test('回灵符：放完神通真气立刻回到一半，每波一次', () => {
  const { w, p } = arena(22, {}, ['huiling']);
  p.skill = 1;
  run(w, DT, () => ({ mx: 0, my: 0, skill: true }));
  assert.ok(p.skill >= CHARM.huiling.back);
  p.skill = 1;
  run(w, DT, () => ({ mx: 0, my: 0, skill: true }));
  assert.ok(p.skill < 0.1, '第二次就没有了');
});

// ---------------------------------------------------------------- 丹药

test('丹药：大还丹立刻回满、上限 +6；隐身丹 / 金刚丹 / 雷火丹只在下一波加属性，波末原样减回去；凝神丹开波真气满', () => {
  const a = toShop(23);
  const p = a.p;
  const s0 = { ...p.stats };
  const drink = (id: ElixirId) => {
    p.shop[0] = { cat: 'elixir', id, price: 1 };
    p.lingshi = 10;
    assert.equal(buy(a.w, p, 0), 'elixir');
  };
  p.hp = 10;
  drink('dahuan');
  assert.equal(p.stats.maxHp, s0.maxHp + 6);
  assert.equal(p.hp, p.stats.maxHp);
  for (const id of ['yinshen', 'jingangdan', 'leihuo', 'ningshen'] as ElixirId[]) drink(id);
  assert.equal(p.stats.dodge, s0.dodge, '买下时还不加');
  p.skill = 0;
  const ev = startNext(a.w);
  assert.ok(Math.abs(p.stats.dodge - s0.dodge - 0.2) < 1e-9);
  assert.equal(p.stats.armor, s0.armor + 5);
  assert.ok(Math.abs(p.stats.crit - s0.crit - 0.12) < 1e-9);
  assert.equal(p.skill, 1);
  assert.equal(relicEvents(ev, 'ningshen').length, 1);
  run(a.w, waveDuration(2) + 0.2);
  assert.equal(p.stats.dodge, s0.dodge, '波末减回去（不留小数误差）');
  assert.equal(p.stats.armor, s0.armor);
  assert.equal(p.stats.crit, s0.crit);
  assert.ok(Object.values(ELIXIRS).every((d) => d.desc.length > 0));
});

test('目录：灵物 34 件（新的 12 件有机制、3 件魔物）、丹药 8 种、符箓 8 种，共 50 件；名字不重复', () => {
  const relics = Object.values(RELICS);
  assert.equal(relics.length, 34);
  assert.equal(Object.keys(ELIXIRS).length, 8);
  assert.equal(Object.keys(CHARMS).length, 8);
  assert.equal(relics.filter((d) => d.stack).length, 15, '有机制的（含 3 件魔物）都写了叠加规则');
  assert.equal(relics.filter((d) => d.demon).length, 5);
  const names = [...relics, ...Object.values(ELIXIRS), ...Object.values(CHARMS)].map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
});

// ---------------------------------------------------------------- 整局存档

test('带着全部新道具打几波：中途存档、恢复后接着跑，和不中断直接跑逐帧相同', () => {
  const w = createWorld(77);
  const p = w.players[0];
  for (const id of Object.keys(RELICS) as RelicId[]) if (RELICS[id].stack) give(p, id);
  p.charms = Object.keys(CHARMS) as CharmId[];
  p.buffs = { gem: 0, rage: 0, dodge: 0.2, armor: 5, crit: 0.12, calm: 1 };
  const frame = (x: World) => step(x, x.players.map((_, i) => botInput(x, i)), x.phase === 'shop' ? x.players.flatMap((_, i) => botShop(x, i)) : []);
  // 打到第 3 波打了 10 秒
  for (let i = 0; i < 60 * 60 * 6 && !(w.wave === 3 && w.phase === 'wave' && w.waveT > 10); i++) frame(w);
  assert.equal(w.wave, 3);
  assert.ok(p.relic, '有运行时状态');
  const b = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(canonicalText(b), canonicalText(w));
  for (let i = 0; i < 600; i++) assert.equal(JSON.stringify(frame(b)), JSON.stringify(frame(w)), `第 ${i} 帧的事件不同`);
  assert.equal(canonicalText(b), canonicalText(w));
});
