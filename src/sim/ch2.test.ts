// 第二章（西岐城外 · 十绝阵）的模拟：章节表、地形「十阵轮转」、三种新敌人、首领「落魂阵主 · 姚天君」。
// 测的是规则（预警 → 判定、阶段切换、危险物）、确定性（同种子同结果）、整局存档（快照恢复后接着跑相同）、机器人打不打得过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, PLAYER } from './config.ts';
import { botInput, botShop } from './bot.ts';
import { bossEnemy } from './boss.ts';
import { chapterDef, chapterOfWave, terrainDmgMul, terrainSpeedMul } from './chapters.ts';
import { hitEnemy } from './core.ts';
import { ch2Shares, sandSpeedMul, spawnShares } from './enemies.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import { makeLevelOffers, restock } from './shop.ts';
import { offerTechnique } from './techniques.ts';
import { FOES2, TEN, YAO } from './ch2/config.ts';
import { tenActivate, tenOf } from './ch2/terrain.ts';
import { YAO_BOSS, yaoDigest, yaoOf } from './ch2/yao.ts';
import type { SiteKind } from './ch2/types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(w, [input(w)]));
  return ev;
};

/** 从第 wave − 1 波后的商店开第 wave 波；人物不带法宝、宠物不出手（只看地形 / 敌人 / 首领本身），站在场心。 */
function waveWorld(seed: number, wave: number, opts: { keepWeapons?: boolean } = {}): World {
  const w = createWorld(seed);
  w.wave = wave - 1;
  w.phase = 'shop';
  const p = w.players[0];
  if (!opts.keepWeapons) p.weapons = [];
  p.pet.cd = 1e12;
  p.ready = true;
  step(w, [idle]);
  return w;
}
/** 刷怪关掉（只看自己摆上去的）。 */
const quiet = (w: World) => {
  w.spawnAcc = -1e9;
  w.surgeDone = true;
  w.eliteDone = true;
  w.waveLen = 1e9;
};
/** 人物站在 (x, y)，打不死、不闪避、没有无敌时间。 */
function standAt(w: World, x: number, y: number) {
  const p = w.players[0];
  p.x = p.px = x;
  p.y = p.py = y;
  p.stats.dodge = 0;
  p.iframes = 0;
  p.hp = p.stats.maxHp = 1e6;
  return p;
}
/** 让第 i 座阵直接亮起来（跳过预警）。 */
function lightSite(w: World, i: number, kind: SiteKind, tick = 0.01) {
  const t = tenOf(w)!;
  t.next = 1e9;
  Object.assign(t.sites[i], { kind, state: 'on', t: 0, dur: TEN.on, tick });
}

// ---------------------------------------------------------------- 章节表

test('章节表：第一章魔化哪吒、没有地形；第二章姚天君 + 十阵轮转、西岐城外的场景；第三章诛仙剑灵 + 四剑轮斩；超出的按最后一章', () => {
  assert.equal(chapterDef(1).boss.kind, 'nezha');
  assert.equal(chapterDef(1).terrain, null);
  assert.equal(chapterDef(1).scene, 'plaza');
  assert.equal(chapterDef(2).boss.kind, 'yao');
  assert.equal(chapterDef(2).terrain?.kind, 'ten');
  assert.equal(chapterDef(2).scene, 'xiqi');
  assert.equal(chapterDef(3).boss.kind, 'zhuxian');
  assert.equal(chapterDef(3).terrain?.kind, 'swords');
  assert.equal(chapterDef(3).scene, 'jiepai');
  assert.equal(chapterDef(9).n, 3);
  assert.equal(chapterOfWave(7).n, 2);
  assert.equal(chapterOfWave(12).n, 2);
  assert.equal(chapterOfWave(13).n, 3);
});

test('刷怪表：第一章和原来一样；第二章第一章那几种全都出，再按本章第几波加进风吼妖、落魂幡手、红沙傀儡', () => {
  for (let wave = 1; wave <= 6; wave++) assert.deepEqual(chapterOfWave(wave).spawn.shares(wave), spawnShares(wave), `第 ${wave} 波`);
  const s7 = ch2Shares(7);
  assert.ok(s7.windfiend! > 0 && !s7.bannerman && !s7.golem, '第二章第 1 波：先来风吼妖');
  assert.ok(ch2Shares(8).bannerman! > 0, '第 2 波加落魂幡手');
  assert.ok(ch2Shares(9).golem! > 0, '第 3 波加红沙傀儡');
  for (let wave = 7; wave <= 11; wave++) {
    const s = ch2Shares(wave);
    const sum = Object.values(s).reduce((a, b) => a + (b ?? 0), 0);
    assert.ok(sum < 0.9, `第 ${wave} 波：回响兵还有一成多（${sum.toFixed(2)}）`);
    assert.ok((s.windfiend ?? 0) + (s.bannerman ?? 0) + (s.golem ?? 0) <= FOES2.cap + 1e-9);
    assert.ok(s.spearman! > 0 && s.cavalry! > 0, '第一章的也出');
  }
});

test('换章：第 6 波（第一章）没有地形，第 7 波摆上十阵轮转，第 13 波（第三章）换成四剑轮斩；首领按章换', () => {
  const w6 = waveWorld(1, 6);
  assert.equal(w6.terrain, null);
  assert.equal(w6.boss?.kind, 'nezha');
  const w7 = waveWorld(1, 7);
  assert.equal(w7.terrain?.kind, 'ten');
  assert.equal(tenOf(w7)!.sites.length, TEN.sites.length);
  const w12 = waveWorld(1, 12);
  assert.equal(w12.boss?.kind, 'yao');
  assert.ok(w12.terrain, '首领波也有地形');
  const w13 = waveWorld(1, 13);
  assert.equal(w13.terrain?.kind, 'swords');
  // 同一个世界从第二章走进第三章：十阵轮转换成四剑轮斩
  const w = waveWorld(2, 11);
  assert.ok(w.terrain);
  w.wave = 12;
  w.phase = 'shop';
  w.players[0].ready = true;
  step(w, [idle]);
  assert.equal(w.wave, 13);
  assert.equal(w.terrain?.kind, 'swords');
});

// ---------------------------------------------------------------- 十阵轮转

/** 第几座阵台是这一阵。 */
const siteOf = (k: SiteKind) => TEN.kinds.indexOf(k);
/** 只留这一阵的世界：第 wave 波、刷怪关掉；人物站在 (x, y)（不给就站在阵心），这座阵直接亮起来。 */
function oneSite(seed: number, k: SiteKind, at?: [number, number], tick = 0.01) {
  const w = waveWorld(seed, 8);
  quiet(w);
  const i = siteOf(k);
  const [cx, cy] = TEN.sites[i];
  const p = standAt(w, at?.[0] ?? cx, at?.[1] ?? cy);
  lightSite(w, i, k, tick);
  return { w, p, i, cx, cy };
}
/** 一只被定住、血很厚的敌人（看阵对敌人的作用）。 */
function dummy(w: World, x: number, y: number, kind: 'soldier' | 'elite' = 'soldier') {
  const e = spawnEnemy(w, kind, x, y, []);
  e.stun = 1e9;
  e.hp = e.maxHp = 1e5;
  return e;
}

test('十阵：十座阵台正好是原著的十阵、各一座；阵够大（半径 60 以上）、彼此不重叠，场心空着', () => {
  assert.equal(TEN.kinds.length, TEN.sites.length);
  assert.deepEqual([...TEN.kinds].sort(), ['blood', 'fire', 'gold', 'ice', 'quake', 'sand', 'soul', 'thunder', 'water', 'wind']);
  assert.ok(TEN.r >= 60);
  for (let a = 0; a < TEN.sites.length; a++) {
    for (let b = a + 1; b < TEN.sites.length; b++) {
      const d = Math.hypot(TEN.sites[a][0] - TEN.sites[b][0], TEN.sites[a][1] - TEN.sites[b][1]);
      assert.ok(d > TEN.r * 2 + 20, `第 ${a}、${b} 座离得够远（${d.toFixed(0)}）`);
    }
    assert.ok(Math.hypot(TEN.sites[a][0] - 480, TEN.sites[a][1] - 270) > TEN.r + 70, '场心空着');
  }
});

test('十阵轮转：开波后按时轮转，预警 → 亮 → 熄；一次 2–3 座、各亮各的阵；同种子同结果，换种子不同', () => {
  const play = (seed: number) => {
    const w = waveWorld(seed, 7);
    quiet(w);
    standAt(w, 480, 270);
    const log: string[] = [];
    const times: Record<string, number[]> = { siteWarn: [], siteOn: [], siteOff: [] };
    const warns: number[][] = [];
    for (let i = 0; i < Math.round(26 / DT); i++) {
      const ev = step(w, [idle]);
      const sites = ev.flatMap((e) => (e.t === 'siteWarn' ? [e.site] : []));
      if (sites.length) warns.push(sites);
      for (const e of ev)
        if (e.t === 'siteWarn' || e.t === 'siteOn' || e.t === 'siteOff') {
          times[e.t].push(w.waveT);
          log.push(`${e.t}:${e.site}:${e.kind}`);
          assert.equal(e.kind, TEN.kinds[e.site], '每座阵台亮的是它自己那一阵');
        }
    }
    return { log: log.join(' '), times, warns };
  };
  const a = play(5);
  const b = play(5);
  const c = play(6);
  assert.equal(a.log, b.log, '同种子同结果');
  assert.notEqual(a.log, c.log, '换种子不同');
  assert.ok(Math.abs(a.times.siteWarn[0] - TEN.first) < 0.05, `第一次轮转在开波 ${TEN.first} 秒后`);
  assert.ok(Math.abs(a.times.siteOn[0] - (TEN.first + TEN.warn)) < 0.05, '预警之后亮起');
  assert.ok(Math.abs(a.times.siteOff[0] - (TEN.first + TEN.warn + TEN.on)) < 0.05, '亮够了熄掉');
  for (const k of a.warns) {
    assert.ok(k.length >= TEN.count[0] && k.length <= TEN.count[1], `一次亮 ${k.length} 座`);
    assert.equal(new Set(k).size, k.length, '不重复');
  }
  assert.ok(a.warns.length >= 2, '26 秒里轮转了两次以上');
});

/** 这一阵出的招：先有 tenWarn（预警），过了预警的时长才 tenStrike；每一招的预警都够躲（≥ 0.7 秒）。 */
function warnsBeforeStrike(ev: SimEvent[]) {
  const warnAt = new Map<number, number>();
  let n = 0;
  ev.forEach((e, k) => {
    if (e.t === 'tenWarn') {
      warnAt.set(e.id, k);
      assert.ok(e.t2 >= 0.7, `预警 ${e.t2} 秒，够躲`);
    }
    if (e.t === 'tenStrike') {
      assert.ok(warnAt.has(e.id), '先预警');
      n++;
    }
  });
  return n;
}

test('天绝阵：站在阵里会挨雷（落点先预警再落下）；阵外的人不挨；雷劈到阵里的敌人', () => {
  const { w, p, cx, cy } = oneSite(3, 'thunder');
  const ev = run(w, 3);
  assert.ok(warnsBeforeStrike(ev) >= 2, '落了几道雷');
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'thunder'), '站在阵里挨了天雷');
  assert.ok(p.hp < p.stats.maxHp);
  const { w: w2, i } = oneSite(3, 'thunder', [480, 270]);
  const e = dummy(w2, cx + 6, cy);
  const ev2 = run(w2, 6);
  assert.ok(ev2.some((x) => x.t === 'tenStrike' && x.kind === 'bolt'), '没人也照样落雷（落在阵里）');
  assert.ok(!ev2.some((x) => x.t === 'hurt'), '阵外的人不挨');
  for (const x of ev2) if (x.t === 'tenWarn') assert.ok(Math.hypot(x.x - TEN.sites[i][0], x.y - TEN.sites[i][1]) <= TEN.r, '雷只在阵里落');
  void e;
});

test('地烈阵：从阵心往外裂开几道地缝（线段，先预警），站在缝上的挨岩火，站在两道缝之间不挨；缝上的敌人也挨', () => {
  const { w, cx, cy } = oneSite(4, 'quake');
  const ev = run(w, 1.4);
  const lines = tenOf(w)!.strikes.filter((s) => s.kind === 'fissure');
  assert.equal(ev.filter((e) => e.t === 'tenWarn').length, TEN.quake.n, '一次裂几道');
  assert.ok(warnsBeforeStrike(ev) >= 1 || lines.length === 0);
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'ten'), '人在阵心：缝从脚下裂开，挨了');
  // 站在两道缝之间（阵边、偏开 60°）：不挨
  const w2 = oneSite(4, 'quake', [cx, cy]).w;
  const p2 = w2.players[0];
  const e = dummy(w2, cx, cy);
  const ev2: SimEvent[] = [];
  for (let k = 0; k < Math.round(1.6 / DT); k++) {
    const out = step(w2, [idle]);
    ev2.push(...out);
    for (const x of out)
      if (x.t === 'tenWarn' && x.kind === 'fissure') {
        const s = tenOf(w2)!.strikes.find((q) => q.id === x.id)!;
        const a = Math.atan2(s.y1 - s.y, s.x1 - s.x) + Math.PI / TEN.quake.n;
        p2.x = cx + Math.cos(a) * (TEN.r - 12);
        p2.y = cy + Math.sin(a) * (TEN.r - 12);
      }
  }
  assert.ok(ev2.some((x) => x.t === 'tenStrike' && x.kind === 'fissure'));
  assert.ok(e.hp < e.maxHp, '阵心的敌人挨了岩火');
});

test('风吼阵：阵里一直往外推；风刃扫过扇面（先预警），扫到的人挨一下并被吹开，敌人也被推出去', () => {
  const { w, p, cx, cy } = oneSite(5, 'wind', [TEN.sites[siteOf('wind')][0] + 20, TEN.sites[siteOf('wind')][1]]);
  const x0 = p.x;
  run(w, 0.3);
  assert.ok(p.x > x0 + 3, '被往外推');
  const { w: w2, p: p2 } = oneSite(5, 'wind', [cx + 30, cy]);
  let hurt = false;
  let blown = false;
  for (let k = 0; k < Math.round(2.5 / DT); k++) {
    p2.x = cx + 30;
    p2.y = cy; // 定在原地看风刃
    const ev = step(w2, [idle]);
    if (ev.some((e) => e.t === 'hurt' && e.by === 'ten')) hurt = true;
    if ((p2.blowX ?? 0) > 50) blown = true;
  }
  assert.ok(hurt && blown, '风刃扫到：挨一下、被往外吹');
  const { w: w3 } = oneSite(5, 'wind', [480, 270]);
  const e = spawnEnemy(w3, 'soldier', cx + 10, cy, []);
  e.stun = 1e9;
  run(w3, 1);
  assert.ok(Math.hypot(e.x - cx, e.y - cy) > 30, '敌人被推出去');
});

test('寒冰阵：一圈圈冒冰锥（内圈 / 外圈轮着），扎到的人掉血、冻得走不快；内圈冒时站外环、外圈冒时站内环就躲得开；敌人被扎了也减速', () => {
  const { w, p, cx, cy } = oneSite(6, 'ice');
  const ev = run(w, 1.2);
  assert.equal(ev.filter((e) => e.t === 'tenWarn').length, TEN.ice.rings[0].reduce((a, r) => a + r[1], 0), '第一次冒内圈');
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'ten'), '站在阵心被扎');
  assert.ok(terrainSpeedMul(w, p) < 1, '冻得走不快');
  // 内圈冒的时候站在外环上（离阵心 46）不挨；下一次轮到外圈，同一处就挨了 —— 内外两环之间来回挪着躲
  const { w: w2 } = oneSite(6, 'ice', [cx + 46, cy]);
  const e = dummy(w2, cx, cy);
  const ev2 = run(w2, 1.2);
  assert.ok(ev2.filter((x) => x.t === 'tenStrike').length >= 6, '内圈冒了');
  assert.ok(!ev2.some((x) => x.t === 'hurt'), '内圈冒的时候外环上不挨');
  assert.ok(e.hp < e.maxHp && e.slow > 0, '敌人被扎、减速');
  w2.players[0].iframes = 0;
  const ev3 = run(w2, 1.3);
  assert.ok(ev3.some((x) => x.t === 'hurt' && x.by === 'ten'), '轮到外圈：外环上挨了');
});

test('化血阵：血雾里的人持续掉血（报 drain，不吃无敌时间）、敌人也掉（首领不吃），走出来就停', () => {
  const { w, p, cx, cy } = oneSite(7, 'blood');
  const e = dummy(w, cx + 8, cy);
  const hp0 = p.hp;
  const ev = run(w, 1);
  const lost = hp0 - p.hp;
  assert.ok(Math.abs(lost - p.stats.maxHp * TEN.blood.drain) < p.stats.maxHp * TEN.blood.drain * 0.05, `一秒掉最大气血的 ${TEN.blood.drain * 100}%`);
  assert.ok(ev.filter((x) => x.t === 'drain').length >= 2);
  assert.ok(e.hp <= e.maxHp * (1 - TEN.blood.foe * 0.9), `敌人一秒约掉 ${TEN.blood.foe * 100}%`);
  standAt(w, 480, 270);
  const hp1 = w.players[0].hp;
  run(w, 0.5);
  assert.equal(w.players[0].hp, hp1, '走出来就不掉了');
});

test('烈焰阵：预警的点上窜起火柱（掉血），之后原地烧一会儿（站在上面隔一会儿烫一下）；火柱也烧敌人', () => {
  const { w, p, cx, cy } = oneSite(8, 'fire');
  const e = dummy(w, cx, cy);
  const ev = run(w, 1.2);
  assert.ok(warnsBeforeStrike(ev) >= 1);
  assert.ok(ev.some((x) => x.t === 'hurt' && x.by === 'ten'));
  assert.ok(tenOf(w)!.strikes.some((s) => s.kind === 'pillar' && s.t > s.warn), '火柱落下后还在烧');
  assert.ok(e.hp < e.maxHp && e.burnT > 0, '敌人被火柱烧着');
  void p;
});

test('落魂阵：魂火从阵边冒出来（先预警）追人，碰到人就散；站在阵里真气流走、走得慢', () => {
  const { w, p, cx, cy } = oneSite(9, 'soul', [TEN.sites[siteOf('soul')][0] + 20, TEN.sites[siteOf('soul')][1]]);
  p.skill = 1;
  assert.ok(Math.abs(terrainSpeedMul(w, p) - (1 - TEN.soul.slow)) < 1e-9, '走得慢');
  const ev = run(w, 3);
  assert.ok(p.skill < 1 - TEN.soul.qi * 2.5, '真气流走');
  assert.ok(ev.some((x) => x.t === 'tenWarn' && x.kind === 'wisp'), '冒魂火');
  assert.ok(ev.some((x) => x.t === 'hurt' && x.by === 'ten'), '魂火追上、碰到了');
  assert.ok(ev.some((x) => x.t === 'tenFade' && x.kind === 'wisp'), '碰到人就散');
  void cx;
  void cy;
});

test('红水阵：站在里面走得慢、持续掉血（报 drain）；敌人走进去也被拖慢，首领不吃', () => {
  const { w, p, cx, cy } = oneSite(4, 'water');
  assert.ok(Math.abs(terrainSpeedMul(w, p) - (1 - TEN.water.slow)) < 1e-9, '移速打折');
  const e = spawnEnemy(w, 'soldier', cx + 10, cy, []);
  e.stun = 1e9;
  const hp0 = p.hp;
  const ev = run(w, 1);
  const lost = hp0 - p.hp;
  assert.ok(Math.abs(lost - p.stats.maxHp * TEN.water.drain) < p.stats.maxHp * TEN.water.drain * 0.05, `一秒掉最大气血的 ${TEN.water.drain * 100}%（掉了 ${lost.toFixed(0)}）`);
  assert.ok(ev.filter((x) => x.t === 'drain').length >= 2, '每半秒报一次');
  assert.ok(e.slow >= TEN.water.enemySlow - 1e-9, '敌人被拖慢');
  standAt(w, 480, 270);
  assert.equal(terrainSpeedMul(w, p), 1, '走出红水：移速恢复');
});

test('红沙阵：沙眼跟着阵一起预警；阵里的人和敌人被往阵心拖、走得慢，阵心的沙眼磨人', () => {
  const w0 = waveWorld(10, 8);
  quiet(w0);
  standAt(w0, 480, 270);
  const ev0: SimEvent[] = [];
  tenActivate(w0, 10, ev0);
  assert.ok(ev0.some((x) => x.t === 'tenWarn' && x.kind === 'eye'), '沙眼跟着预警');
  const i = siteOf('sand');
  const [cx, cy] = TEN.sites[i];
  const { w, p } = oneSite(10, 'sand', [cx + 40, cy]);
  const ss = tenOf(w)!;
  ss.strikes.push({ id: 999, site: i, kind: 'eye', x: cx, y: cy, x1: cx, y1: cy, r: TEN.sand.eye, a0: 0, arc: 0, dir: 1, t: 0, warn: 0.01, live: TEN.on, every: TEN.sand.every, hit: [-1], foes: [], foeT: 0 });
  assert.ok(terrainSpeedMul(w, p) < 1, '走得慢');
  const e = dummy(w, cx - 40, cy);
  run(w, 0.5);
  assert.ok(p.x < cx + 40 - 8, '人被往阵心拖');
  assert.ok(e.x > cx - 40 + 10, '敌人被往阵心拖');
  standAt(w, cx + 2, cy);
  const ev = run(w, 1);
  assert.ok(ev.some((x) => x.t === 'hurt' && x.by === 'ten'), '沙眼磨人');
});

test('金光阵：站在里面法宝伤害 +25%（神通不算），阵边不断冒出回响兵（离人远的那一侧，刚冒出来愣一下）', () => {
  const { w, p, cx, cy } = oneSite(5, 'gold', undefined, 0.5);
  assert.ok(Math.abs(terrainDmgMul(w, p) - (1 + TEN.gold.dmg)) < 1e-9);
  const target = spawnEnemy(w, 'elite', cx + 30, cy, []);
  target.hp = target.maxHp = 1e9;
  const hit = (by: 'ring' | 'skill') => hitEnemy(w, target, { dmg: 100, by, owner: 0, from: p, canCrit: false }, []);
  const inside = hit('ring');
  const skillIn = hit('skill');
  standAt(w, 480, 270);
  const outside = hit('ring');
  assert.equal(inside, Math.round(outside * (1 + TEN.gold.dmg)), '法宝伤害提高');
  assert.equal(skillIn, outside, '神通不吃金光阵');
  standAt(w, cx, cy);
  const ev = run(w, 2);
  const sp = ev.filter((e) => e.t === 'siteSpawn');
  assert.ok(sp.length >= 1, '阵边冒兵');
  for (const s of sp) {
    if (s.t !== 'siteSpawn') continue;
    assert.ok(Math.abs(Math.hypot(s.x - cx, s.y - cy) - (TEN.r + 3)) < 2, '冒在阵边');
  }
  const first = sp[0] as { id: number };
  const soldier = w.enemies.find((e) => e.id === first.id);
  assert.ok(soldier && soldier.kind === 'soldier');
});

test('十阵：阵的招不伤首领；机器人读得到每一种招的危险（站在预警里危险，走开就不危险）', () => {
  for (const k of TEN.kinds) {
    if (k === 'gold') continue;
    const { w, cx, cy } = oneSite(12, k, [480, 270]);
    const mod = chapterDef(2).terrain!;
    assert.ok(mod.danger(w, cx, cy) > 0, `${k}：亮着的阵里危险`);
    assert.equal(mod.danger(w, 480, 270), 0, `${k}：场心不危险`);
    for (let n = 0; n < 200; n++) {
      step(w, [idle]);
      const s = tenOf(w)!.strikes[0];
      if (!s) continue;
      const px = s.kind === 'gust' ? s.x + Math.cos(s.a0 + (s.dir * s.arc) / 2) * 30 : s.x;
      const py = s.kind === 'gust' ? s.y + Math.sin(s.a0 + (s.dir * s.arc) / 2) * 30 : s.y;
      tenOf(w)!.sites.forEach((st) => (st.state = 'off')); // 只看这一招
      assert.ok(mod.danger(w, px, py) > 0, `${k}：${s.kind} 的预警里危险`);
      break;
    }
  }
});

test('十阵：波末全都熄掉、还没落的招取消；首领「十阵齐鸣」一次亮 5 座、必带落魂阵', () => {
  const w = waveWorld(6, 9);
  quiet(w);
  standAt(w, 480, 270);
  lightSite(w, siteOf('thunder'), 'thunder');
  run(w, 0.5);
  assert.ok(tenOf(w)!.strikes.length > 0);
  w.waveLen = w.waveT; // 下一帧这一波就打完
  const ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'waveEnd'));
  assert.ok(ev.some((e) => e.t === 'siteOff'));
  assert.ok(tenOf(w)!.sites.every((s) => s.state === 'off'));
  assert.equal(tenOf(w)!.strikes.length, 0);
  for (const seed of [7, 8, 9]) {
    const w2 = waveWorld(seed, 9);
    quiet(w2);
    const ev2: SimEvent[] = [];
    tenActivate(w2, 5, ev2, 'soul');
    assert.equal(ev2.filter((e) => e.t === 'siteWarn').length, 5);
    assert.equal(tenOf(w2)!.sites.filter((s) => s.state === 'warn').length, 5);
    assert.ok(ev2.some((e) => e.t === 'siteWarn' && e.kind === 'soul'), '必带落魂阵');
  }
});

test('十阵：每一阵亮一遍再存档恢复（走一趟 JSON），接着跑和不中断直接跑完全相同', () => {
  for (const k of TEN.kinds) {
    const { w, i } = oneSite(14, k, [TEN.sites[siteOf(k)][0] + 25, TEN.sites[siteOf(k)][1]]);
    dummy(w, TEN.sites[i][0] - 20, TEN.sites[i][1]);
    run(w, 1.7, (w) => botInput(w, 0));
    const copy = restore(JSON.parse(JSON.stringify(snapshot(w))));
    assert.equal(canonicalText(copy), canonicalText(w));
    for (let n = 0; n < 240; n++) {
      step(w, [botInput(w, 0)]);
      step(copy, [botInput(copy, 0)]);
    }
    assert.equal(canonicalText(copy), canonicalText(w), `${k}：接着跑 4 秒还一样`);
  }
});

// ---------------------------------------------------------------- 三种新敌人

test('落魂幡手：给身边的敌人续上增益（移速加快、受到的伤害减少），魂光连着它们；自己很脆', () => {
  const w = waveWorld(8, 8);
  quiet(w);
  standAt(w, 480, 270);
  const b = spawnEnemy(w, 'bannerman', 560, 270, []);
  const near = spawnEnemy(w, 'soldier', 580, 280, []);
  const far = spawnEnemy(w, 'soldier', 300, 400, []);
  b.cd = 0;
  run(w, 0.1);
  assert.ok(b.links?.includes(near.id), '魂光连到身边的那只');
  assert.ok(!b.links?.includes(far.id), '远的不连');
  assert.ok((near.wardT ?? 0) > 0 && near.haste === FOES2.bannerman.haste);
  near.hp = near.maxHp = far.hp = far.maxHp = 1e6;
  const p = w.players[0];
  const dn = hitEnemy(w, near, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  const df = hitEnemy(w, far, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  assert.equal(dn, Math.round(df * (1 - FOES2.bannerman.ward)), '护体：受到的伤害减少');
  assert.ok(b.maxHp < near.maxHp || b.maxHp <= 40, '自己很脆');
  // 幡手死了：增益到时就没了
  b.hp = 0;
  run(w, FOES2.bannerman.hold + 0.1);
  assert.equal(near.wardT, 0);
});

test('红沙傀儡：走过的地方留下红沙（人物踩上去走得慢），碎了散开一大片', () => {
  const w = waveWorld(9, 9);
  quiet(w);
  const p = standAt(w, 480, 270);
  const g = spawnEnemy(w, 'golem', 600, 270, []);
  g.cd = 0;
  run(w, 2);
  assert.ok(w.patches.length >= 3, `留下了红沙（${w.patches.length} 片）`);
  const n0 = w.patches.length;
  const ev: SimEvent[] = [];
  hitEnemy(w, g, { dmg: 1e6, by: 'ring', owner: 0, from: p, canCrit: false }, ev);
  assert.ok(ev.some((e) => e.t === 'sandBurst'), '碎开');
  assert.ok(w.patches.length >= n0 + 1 + FOES2.golem.burstN);
  const s = w.patches[w.patches.length - 1];
  standAt(w, s.x, s.y);
  assert.equal(sandSpeedMul(w, p), 1 - FOES2.golem.slow);
  standAt(w, 100, 100);
  assert.equal(sandSpeedMul(w, p), 1);
  run(w, FOES2.golem.burstLife + 0.5);
  assert.equal(w.patches.length, 0, '红沙到时消失');
});

test('风吼妖：先亮冲刺线（预警），再沿线冲过去，冲过人物身边把人吹开（伤害很小）；晕眩打断预警', () => {
  const w = waveWorld(10, 9);
  quiet(w);
  const p = standAt(w, 480, 270);
  const f = spawnEnemy(w, 'windfiend', 560, 270, []);
  f.cd = 0;
  const ev: SimEvent[] = [];
  let x0 = 0;
  let y0 = 0;
  for (let i = 0; i < 60 * 4 && !ev.some((e) => e.t === 'blown'); i++) {
    const e = step(w, [idle]);
    if (e.some((x) => x.t === 'windDash')) {
      x0 = p.x;
      y0 = p.y;
    }
    ev.push(...e);
  }
  const warn = ev.find((e) => e.t === 'windWarn');
  const dash = ev.find((e) => e.t === 'windDash');
  assert.ok(warn && dash, '预警、冲刺');
  assert.ok(ev.some((e) => e.t === 'blown'), '吹开');
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'wind'));
  run(w, 0.4);
  assert.ok(Math.hypot(p.x - x0, p.y - y0) > 15, `人被吹开了一段（${Math.hypot(p.x - x0, p.y - y0).toFixed(0)} 像素）`);
  // 晕眩打断预警
  const w2 = waveWorld(10, 9);
  quiet(w2);
  standAt(w2, 480, 270);
  const f2 = spawnEnemy(w2, 'windfiend', 560, 270, []);
  f2.cd = 0;
  let ev2: SimEvent[] = [];
  for (let i = 0; i < 60 * 3 && f2.act !== 'windup'; i++) ev2 = step(w2, [idle]);
  assert.equal(f2.act, 'windup');
  f2.stun = 0.5;
  ev2 = run(w2, 0.8);
  assert.ok(!ev2.some((e) => e.t === 'windDash'), '被打断就不冲');
  void f;
});

// ---------------------------------------------------------------- 姚天君

/** 第 12 波：姚天君入场；不刷小兵、不轮转（只测他本身），人物站在场心。 */
function yaoWorld(seed = 1): World {
  const w = waveWorld(seed, 12);
  const f = yaoOf(w)!;
  assert.ok(f, '第 12 波开始时姚天君入场');
  f.summonT = 1e9;
  tenOf(w)!.next = 1e9;
  standAt(w, 480, 270);
  return w;
}
/** 让他站到 (x, y)，下一帧就出 move。 */
function yaoCast(w: World, move: 'banners' | 'bell' | 'straw' | 'formations' | 'mist', x: number, y: number, phase = 1) {
  const f = yaoOf(w)!;
  const b = bossEnemy(w)!;
  b.x = b.px = x;
  b.y = b.py = y;
  b.invuln = 0;
  f.phase = phase;
  f.queue = [move];
  f.state = 'idle';
  f.t = 0;
  f.lt = 0;
  f.dur = 0.001;
}

test('姚天君：入场无敌；气血跨过 60% / 30% 卡在阈值上换阶段（换阶段无敌）；三阶段打空才倒下，倒下的表现放完本章平定', () => {
  const w = yaoWorld();
  const f = yaoOf(w)!;
  const b = bossEnemy(w)!;
  assert.equal(b.maxHp, YAO.hp);
  assert.equal(f.state, 'intro');
  assert.ok(b.invuln > 0, '入场无敌');
  run(w, YAO.intro + 0.1);
  const p = w.players[0];
  let ev: SimEvent[] = [];
  hitEnemy(w, b, { dmg: b.maxHp * 0.5, by: 'ring', owner: 0, from: p, canCrit: false }, ev);
  ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'bossPhase' && e.phase === 2));
  assert.equal(b.hp, Math.ceil(b.maxHp * YAO.phases[0]), '一次大伤害也卡在阈值上');
  assert.ok(b.invuln > 0, '换阶段无敌');
  run(w, YAO.phaseTime + 0.1);
  b.hp = Math.ceil(b.maxHp * 0.29);
  ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'bossPhase' && e.phase === 3));
  run(w, YAO.phaseTime + 0.1);
  // 三阶段一进来先化雾：化雾时打不到
  run(w, 0.5);
  assert.ok(f.hidden, '三阶段先化雾');
  assert.equal(hitEnemy(w, b, { dmg: 999, by: 'ring', owner: 0, from: p, canCrit: false }, []), 0, '化雾时打不到');
  // 打死
  f.hidden = false;
  b.invuln = 0;
  b.hp = 1;
  hitEnemy(w, b, { dmg: 999, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'bossDeath'));
  ev = run(w, YAO.deathTime + 0.1);
  assert.ok(ev.some((e) => e.t === 'chapterClear' && e.chapter === 2));
  assert.equal(w.boss, null);
  assert.equal(w.phase, 'collect');
});

test('姚天君不吃控制：晕眩、冻结都上不去', () => {
  const w = yaoWorld(2);
  run(w, YAO.intro + 0.1);
  const b = bossEnemy(w)!;
  hitEnemy(w, b, { dmg: 10, by: 'ring', owner: 0, from: w.players[0], canCrit: false, stun: 3, freeze: 3 }, []);
  assert.equal(b.stun, 0);
  assert.equal(b.frozen, 0);
});

test('落魂幡：插下三面幡，魂线先预警再连上；碰到魂线定住一下并掉血；打倒一面幡，那条线就断', () => {
  const w = yaoWorld(3);
  run(w, YAO.intro + 0.1);
  yaoCast(w, 'banners', 600, 270);
  let ev = run(w, 0.1);
  const f = yaoOf(w)!;
  assert.equal(f.flags.length, YAO.banners.n);
  const lines = f.hazards.filter((h) => h.kind === 'line');
  assert.equal(lines.length, YAO.banners.n);
  assert.ok(ev.filter((e) => e.t === 'yaoFlag').length === YAO.banners.n);
  // 预警期间站在线上不挨打
  const h = lines[0];
  const p = standAt(w, (h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2);
  ev = run(w, YAO.banners.warn * 0.5);
  assert.ok(!ev.some((e) => e.t === 'hurt'), '预警不伤人');
  ev = run(w, YAO.banners.warn * 0.6);
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'boss'), '连上之后碰到就挨打');
  assert.ok(ev.some((e) => e.t === 'yaoRoot'));
  assert.ok((p.root ?? 0) > 0, '定住');
  // 定住的时候走不动
  const x0 = p.x;
  run(w, 0.2, () => ({ mx: 1, my: 0, skill: false }));
  assert.equal(p.x, x0, '定住时走不动');
  // 打倒一面幡
  const flag = w.enemies.find((e) => e.id === lines[1].flag)!;
  hitEnemy(w, flag, { dmg: 1e6, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  ev = run(w, DT * 2);
  assert.ok(ev.some((e) => e.t === 'yaoLineBreak' && e.flag === flag.id));
  assert.ok(!f.hazards.some((x) => x.flag === flag.id), '那条线断了');
  assert.equal(f.hazards.filter((x) => x.kind === 'line').length, YAO.banners.n - 1);
});

test('摄魂铃：一圈圈往外扩的魂波，缺口里的人躲得过，不在缺口里的挨打', () => {
  const play = (inGap: boolean) => {
    const w = yaoWorld(4);
    run(w, YAO.intro + 0.1);
    yaoCast(w, 'bell', 480, 270);
    // 跑到第一圈魂波出现
    const f = yaoOf(w)!;
    let wave = null as (typeof f.hazards)[number] | null;
    for (let i = 0; i < 300 && !wave; i++) {
      step(w, [idle]);
      wave = f.hazards.find((h) => h.kind === 'wave') ?? null;
    }
    assert.ok(wave);
    // 人物站在离圆心 60 像素、缺口正中（或正对面）
    const a = wave.gapA + (inGap ? 0 : Math.PI);
    const p = standAt(w, wave.x0 + Math.cos(a) * 60, wave.y0 + Math.sin(a) * 60);
    // 只看第一圈：等它扩过 60 像素
    for (let i = 0; i < 400 && wave.rad < 60 + 20; i++) step(w, [idle]);
    void p;
    return wave.hit[0] >= 0;
  };
  assert.equal(play(true), false, '缺口里躲过了');
  assert.equal(play(false), true, '不在缺口里挨打');
});

test('草人拜魂：头顶倒计时，到时没打碎的让人掉血；都打碎了就不掉', () => {
  const play = (smash: boolean) => {
    const w = yaoWorld(5);
    run(w, YAO.intro + 0.1);
    yaoCast(w, 'straw', 600, 270, 2);
    let ev = run(w, YAO.straw.cast + 0.1);
    const f = yaoOf(w)!;
    assert.equal(f.straws.length, YAO.straw.n);
    assert.ok(ev.some((e) => e.t === 'yaoStraw'));
    if (smash) for (const id of f.straws) hitEnemy(w, w.enemies.find((e) => e.id === id)!, { dmg: 1e6, by: 'ring', owner: 0, from: w.players[0], canCrit: false }, []);
    f.dur = 1e9; // 不接下一招
    ev = run(w, YAO.straw.time + 0.5);
    return ev.find((e) => e.t === 'yaoCurse') as { ids: number[]; dmg: number } | undefined;
  };
  const c = play(false);
  assert.ok(c && c.ids.length === YAO.straw.n && c.dmg > 0, '没打碎的三个一起让人掉血');
  assert.equal(play(true), undefined, '都打碎了就不拜');
});

test('落魂化雾：游走时打不到，停下后先亮一大片淡红光，显形时那一片炸开；十阵齐鸣亮 5 座', () => {
  const w = yaoWorld(6);
  run(w, YAO.intro + 0.1);
  yaoCast(w, 'mist', 600, 270, 3);
  run(w, 0.2);
  const f = yaoOf(w)!;
  const b = bossEnemy(w)!;
  assert.ok(f.hidden && b.invuln > 0);
  run(w, YAO.mist.roam);
  const burst = f.hazards.find((h) => h.kind === 'burst');
  assert.ok(burst, '显形前亮出淡红光');
  assert.ok(Math.hypot(b.x - w.players[0].x, b.y - w.players[0].y) < YAO.mist.near[1] + 10, '停在人物身边');
  standAt(w, burst.x0 + 10, burst.y0);
  const ev = run(w, YAO.mist.warn + 0.1);
  assert.ok(ev.some((e) => e.t === 'yaoMist' && e.act === 'appear'));
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'boss'), '炸开打中圈里的人');
  assert.ok(!f.hidden && b.invuln <= 0, '显形了，打得到');
  // 十阵齐鸣
  const w2 = yaoWorld(7);
  run(w2, YAO.intro + 0.1);
  yaoCast(w2, 'formations', 600, 270, 2);
  const ev2 = run(w2, YAO.formations.cast + 0.1);
  assert.equal(ev2.filter((e) => e.t === 'siteWarn').length, YAO.formations.n);
});

test('机器人读姚天君的危险物：魂线上、魂波带子上（缺口外）危险，缺口里、远处安全', () => {
  const w = yaoWorld(8);
  run(w, YAO.intro + 0.1);
  yaoCast(w, 'banners', 600, 270);
  run(w, YAO.banners.warn + 0.1);
  const f = yaoOf(w)!;
  const h = f.hazards.find((x) => x.kind === 'line')!;
  assert.ok(YAO_BOSS.danger(w, (h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2) > 0, '魂线上危险');
  assert.equal(YAO_BOSS.danger(w, 100, 100), 0, '远处安全');
  const w2 = yaoWorld(9);
  run(w2, YAO.intro + 0.1);
  yaoCast(w2, 'bell', 480, 270);
  const f2 = yaoOf(w2)!;
  let wave = null as (typeof f2.hazards)[number] | null;
  for (let i = 0; i < 300 && !(wave && wave.t > wave.warn + 0.2); i++) {
    step(w2, [idle]);
    wave = f2.hazards.find((x) => x.kind === 'wave') ?? null;
  }
  assert.ok(wave);
  const at = (a: number, r: number): [number, number] => [wave!.x0 + Math.cos(a) * r, wave!.y0 + Math.sin(a) * r];
  const r = wave.rad + 6;
  const others = f2.hazards.filter((x) => x !== wave);
  f2.hazards = [wave]; // 只看这一圈
  assert.equal(YAO_BOSS.danger(w2, ...at(wave.gapA, r)), 0, '缺口里安全');
  assert.ok(YAO_BOSS.danger(w2, ...at(wave.gapA + Math.PI, r)) > 0, '缺口外的带子上危险');
  assert.ok(YAO_BOSS.danger(w2, ...at(wave.gapA + Math.PI, r + 50)) > 0, '带子外面不远（它马上扩过来）也危险');
  f2.hazards = [wave, ...others];
});

test('确定性：同一种子 + 机器人打姚天君（连地形、新敌人）→ 完全相同；换个种子就不同', () => {
  const play = (seed: number) => {
    const w = yaoWorld(seed);
    yaoOf(w)!.summonT = YAO.summon.first;
    tenOf(w)!.next = TEN.first;
    w.players[0].hp = w.players[0].stats.maxHp = 1e6;
    w.players[0].weapons = [{ kind: 'qiankun', tier: 2, spirit: null, cd: 0 }];
    for (let i = 0; i < 60 * 30; i++) step(w, [botInput(w, 0)]);
    return `${digest(w)}|${yaoDigest(w)}`;
  };
  assert.equal(play(11), play(11));
  assert.notEqual(play(11), play(12));
});

test('整局存档：姚天君战（魂线、魂波、草人）和十阵轮转存下来（走一趟 JSON），恢复后接着跑和不中断直接跑完全相同', () => {
  const w = yaoWorld(13);
  const f = yaoOf(w)!;
  f.summonT = YAO.summon.first;
  tenOf(w)!.next = 1;
  w.players[0].hp = w.players[0].stats.maxHp = 1e6;
  w.players[0].weapons = [{ kind: 'qiankun', tier: 2, spirit: null, cd: 0 }];
  // 跑到招式、阵正放着的时候（原来固定跑 12 秒；数值一改，那一刻可能正好什么都没在放）
  const busy = () => f.hazards.length > 0 || f.flags.length > 0 || tenOf(w)!.sites.some((s) => s.state !== 'off');
  for (let i = 0; i < 60 * 12 || (!busy() && i < 60 * 40); i++) step(w, [botInput(w, 0)]);
  assert.ok(busy(), '招式、阵正在放');
  const copy = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(canonicalText(copy), canonicalText(w));
  for (let i = 0; i < 600; i++) {
    step(w, [botInput(w, 0)]);
    step(copy, [botInput(copy, 0)]);
  }
  assert.equal(canonicalText(copy), canonicalText(w), '接着跑 10 秒还一样');
});

test('机器人打得过第二章（从第 7 波前的商店开始，带一大笔灵石，和 ?wave=7 一样）：打完六波、打赢姚天君', () => {
  for (const seed of [21, 22]) {
    const w = createWorld(seed);
    const p = w.players[0];
    w.wave = 6;
    w.phase = 'shop';
    p.lingshi = 999;
    p.level = 12;
    p.pendingLevels = 11;
    p.levelOffers = makeLevelOffers(w, p);
    offerTechnique(w, p);
    restock(w, p);
    let won = false;
    for (let i = 0; i < 60 * 60 * 12 && (w.phase as string) !== 'over' && !won; i++) {
      const ev = step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
      if (ev.some((e) => e.t === 'chapterClear' && e.chapter === 2)) won = true;
    }
    assert.ok(won, `种子 ${seed}：打赢了第二章（停在第 ${w.wave} 波，${w.phase}）`);
  }
});
