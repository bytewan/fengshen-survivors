// 图鉴的记录与存档（profile.ts 的 fs.v1.codex、codex-track.ts 的记录点）：清洗、合并、存档码往返、旧存档码照常导入；
// 机器人打几波，记下的和模拟对得上（见过的敌人、自己斩的只数、货架上出现过的、买到的、出战的局数、法宝的最高品阶）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS,
  addCodex,
  cleanCodex,
  codexCount,
  codexEntry,
  decodeProfile,
  defaultCodex,
  defaultProfile,
  describeProfile,
  encodeProfile,
  exportCode,
  importCode,
  loadCodex,
  loadProfile,
  mergeCodex,
  useStorage,
  type Codex,
  type StorageLike,
} from './profile.ts';
import { CodexTracker } from './codex-track.ts';
import { createWorld, step, type SimEvent, type World } from '../sim/world.ts';
import { botInput, botShop } from '../sim/bot.ts';
import { chapterOf } from '../sim/catalog.ts';

function memStore() {
  const m = new Map<string, string>();
  const s: StorageLike & { m: Map<string, string> } = {
    m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
  return s;
}
let store = memStore();
beforeEach(() => {
  store = memStore();
  useStorage(store);
});

/** 图鉴之前（2026-11-11，这一节加进来之前）的游戏导出的存档码：scratch/tools/old-code.mts 生成。 */
const OLD_CODE =
  'FS1-AQGfqkPw3AI9iI7CIdDEWCI6m42G8xms5wMtiIyGU2m83C03GU9GgwiIuwYxGU5nSBwAxxs4HQynKBjKDHcwnYywMZwaTGGUSoqGk2yGSCIYwMaDEZC4an2amwymE5TqeQM3HU2Gyam82mI3wMcDejiI5mU6HQ0m4zw4dQA2mGRSqBjAXDaDHMzHi2C4cwY2nU5mkx3QawYyGG0Gcyk461aVWUzGE2V6DGaKnQqGiJzIdCIxHK8mgRVyRGE6WWAZk3WUbwY1mmpWUZ0MYUilHKy64RHA2GE803KjMbDAai4ZUaDHg0nU7mU0z7AVgdDTZm43xKyxCNHU1ciDHGxWTJm6O1zrZWS0mlmUyQOCiLbSKWH0-g';

const sampleCodex = (): Codex => ({
  hero: { nezha: [0, 9], yangjian: [0, 3] },
  weapon: { qiankun: [1, 12, 4], huojian: [1, 3, 2], kunxian: [2, 0] },
  relic: { peach: [1, 7], orb_fire: [1, 2] },
  elixir: { huichun: [1, 4] },
  charm: { tishen: [2, 1] },
  foe: { soldier: [1, 2210], bomber: [1, 96], golem: [2, 40] },
  boss: { nezha: [1, 1], yao: [2, 0] },
});

test('旧存档码（图鉴之前导出的）照常导入：别的都在，图鉴是空的；导入之后本机的图鉴也清空（整份覆盖）', () => {
  const r = decodeProfile(OLD_CODE);
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.deepEqual(r.profile.unlocks, ['demon-nezha']);
  assert.equal(r.profile.best.chapter, 2);
  assert.equal(r.profile.best.wave, 3);
  assert.equal(r.profile.stats.kills, 3120);
  assert.deepEqual(r.profile.xiuwei, { dao: 40, nodes: ['wendao', 'tengyun'] }); // 老十节树的 id（筑基、轻身）换成新树的（sim/xiuwei.ts 的 LEGACY）
  assert.deepEqual(r.profile.jie, { cleared: 1, last: 2 });
  assert.equal(r.profile.settings.fontTheme, 'brush');
  assert.deepEqual(r.profile.codex, defaultCodex());
  addCodex(sampleCodex());
  assert.ok(importCode(OLD_CODE).ok);
  assert.deepEqual(loadCodex(), defaultCodex());
});

test('存档码往返：图鉴原样带过去；换一台空设备导入之后一致；概况里写着图鉴有几条', () => {
  const p = { ...defaultProfile(), codex: sampleCodex() };
  const code = encodeProfile(p);
  assert.match(code, /^FS1-[A-Za-z0-9_-]+$/, '格式版本不涨：旧版游戏照样认得这个前缀');
  const r = decodeProfile(code);
  assert.ok(r.ok);
  assert.deepEqual(r.profile.codex, sampleCodex());
  addCodex(sampleCodex());
  const exported = exportCode();
  useStorage(memStore());
  assert.ok(importCode(exported).ok);
  assert.deepEqual(loadCodex(), sampleCodex());
  assert.deepEqual(loadProfile().codex, sampleCodex());
  assert.match(describeProfile(loadProfile()), /图鉴 14 条/);
  assert.equal(codexCount(sampleCodex()), 14);
});

test('存档码：图鉴里的坏数据整份拒绝（本机存档不动）；不认识的 id 照留、不认识的分类忽略', () => {
  const withCodex = (codex: unknown) => {
    const p = defaultProfile() as unknown as Record<string, unknown>;
    p.codex = codex;
    return encodeProfile(p as never);
  };
  const bad: unknown[] = [
    { foe: { soldier: [1] } }, // 少一位
    { foe: { soldier: [1, 2, 3, 4] } }, // 多一位
    { foe: { soldier: [1, -2] } }, // 负数
    { foe: { soldier: [1, 2.5] } }, // 小数
    { foe: { soldier: [100, 2] } }, // 章号越界
    { weapon: { qiankun: [1, 2, 5] } }, // 品阶越界
    { foe: { Soldier: [1, 2] } }, // 大写开头
    { foe: { 'a b': [1, 2] } }, // 带空格
    { foe: { soldier: '1,2' } }, // 不是数组
    { foe: [] }, // 一节不是对象
    'x',
  ];
  addCodex(sampleCodex());
  for (const c of bad) {
    const r = importCode(withCodex(c));
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.deepEqual(loadCodex(), sampleCodex(), '没导入就不动本机存档');
  }
  const r = decodeProfile(withCodex({ foe: { newfoe_x: [3, 1] }, pets: { a: [1, 1] } }));
  assert.ok(r.ok);
  assert.deepEqual(r.profile.codex.foe, { newfoe_x: [3, 1] });
  // 宽松（读本地存储）：坏的那一条丢掉，别的照常
  const loose = cleanCodex({ foe: { soldier: [1, 5], bad: [1, -1], 'X y': [1, 1] }, boss: 'x', hero: { nezha: [0, 2] } });
  assert.deepEqual(loose.foe, { soldier: [1, 5] });
  assert.deepEqual(loose.boss, {});
  assert.deepEqual(loose.hero, { nezha: [0, 2] });
});

test('本地存储里的图鉴坏了：只丢图鉴，别的照常', () => {
  store.setItem(KEYS.codex, '{坏的');
  store.setItem(KEYS.stats, JSON.stringify({ runs: 3, kills: 10, clears: 0, playTime: 5 }));
  assert.deepEqual(loadCodex(), defaultCodex());
  assert.equal(loadProfile().stats.runs, 3);
});

test('合并：次数相加、品阶取大、第一次见到的章不变（原来不知道的才补上），新的整条加进去', () => {
  const base: Codex = { ...defaultCodex(), weapon: { qiankun: [1, 2, 3], huojian: [0, 1] }, foe: { soldier: [1, 10] } };
  const delta: Codex = { ...defaultCodex(), weapon: { qiankun: [0, 1, 2], huojian: [2, 0, 4] }, foe: { soldier: [0, 5], golem: [2, 1] }, boss: { yao: [2, 0] } };
  const m = mergeCodex(base, delta);
  assert.deepEqual(m.weapon, { qiankun: [1, 3, 3], huojian: [2, 1, 4] });
  assert.deepEqual(m.foe, { soldier: [1, 15], golem: [2, 1] });
  assert.deepEqual(m.boss, { yao: [2, 0] });
  assert.deepEqual(base.weapon.qiankun, [1, 2, 3], '纯函数：不改原来的');
  // 写回存档：期间别处写进去的（比如导入了存档码）不会被这一段的旧副本盖掉
  addCodex({ ...defaultCodex(), foe: { soldier: [1, 3] } });
  store.setItem(KEYS.codex, JSON.stringify({ foe: { soldier: [1, 100] }, boss: { nezha: [1, 2] } }));
  addCodex({ ...defaultCodex(), foe: { soldier: [0, 4] } });
  assert.deepEqual(loadCodex().foe, { soldier: [1, 104] });
  assert.deepEqual(loadCodex().boss, { nezha: [1, 2] });
});

/** 机器人打一帧（商店里替所有人选）。 */
function frame(w: World): SimEvent[] {
  const inputs = w.players.map((_, i) => botInput(w, i));
  const cmds = w.phase === 'shop' ? w.players.flatMap((_, i) => botShop(w, i)) : [];
  return step(w, inputs, cmds);
}

test('机器人打三波：见过的敌人、自己斩的只数、货架上出现过的、买到的、出战的局数、法宝的品阶，都和模拟对得上', () => {
  const w = createWorld(11, 1, { heroes: ['yangjian'] });
  const t = new CodexTracker();
  const kills: Record<string, number> = {};
  const spawned = new Set<string>();
  const shelf = new Set<string>();
  const bought: Record<string, number> = {};
  let shops = 0;
  for (let i = 0; i < 60 * 60 * 6 && w.wave <= 3; i++) {
    const ev = frame(w);
    for (const e of ev) {
      t.onEvent(e, w, 0);
      const foe = (k: string) => (k === 'elite' ? 'elite.xiaowei' : k); // 前三波没有精英；有的话按种类记
      if (e.t === 'spawn') spawned.add(foe(e.kind));
      if (e.t === 'kill' && e.owner === 0) kills[foe(e.kind)] = (kills[foe(e.kind)] ?? 0) + 1;
      if (e.t === 'shopOpen') shops++;
      if (e.t === 'bought') {
        const o = e.offer;
        const key = o.cat === 'weapon' || o.cat === 'spirit' ? `weapon:${o.kind}` : `${o.cat}:${o.id}`;
        if (o.cat !== 'weapon' || e.result === 'new') bought[key] = (bought[key] ?? 0) + (o.cat === 'spirit' ? 0 : 1);
      }
    }
    if (w.phase === 'shop') {
      t.update(w, 0);
      for (const o of w.players[0].shop) if (o) shelf.add(o.cat === 'weapon' || o.cat === 'spirit' ? `weapon:${o.kind}` : `${o.cat}:${o.id}`);
    }
  }
  t.dispose();
  assert.ok(shops >= 3, `打完三波、进了三次商店（${shops}）`);
  assert.ok(Object.keys(bought).length >= 1 && shelf.size >= 5 && Object.keys(kills).length >= 1, '机器人真的斩了、逛了、买了（不然这个测试什么都没测）');
  const c = loadCodex();
  assert.deepEqual(c.hero, { yangjian: [0, 1] }, '第 1 波开打记一局出战');
  assert.equal(codexEntry(c, 'weapon', 'sanjian')?.n ?? 0, 1 + (bought['weapon:sanjian'] ?? 0), '开局自带的专属法宝记一次拿到');
  for (const k of spawned) if (k !== 'boss') assert.ok(codexEntry(c, 'foe', k), `现身过的 ${k} 记下了`);
  for (const [k, n] of Object.entries(kills)) assert.equal(codexEntry(c, 'foe', k)?.n, n, `${k} 斩了 ${n} 只`);
  assert.equal(Object.keys(c.foe).length, spawned.size, '没现身的不记');
  for (const key of shelf) {
    const [cat, id] = key.split(':') as [keyof Codex, string];
    const e = codexEntry(c, cat, id);
    assert.ok(e, `货架上出现过的 ${key} 记下了`);
    assert.equal(e.ch, chapterOf(1), '第一章');
  }
  for (const [key, n] of Object.entries(bought)) {
    const [cat, id] = key.split(':') as [keyof Codex, string];
    if (cat === 'weapon' && id === 'sanjian') continue;
    assert.equal(codexEntry(c, cat, id)?.n, n, `${key} 买了 ${n} 次`);
  }
  for (const wpn of w.players[0].weapons) assert.ok((codexEntry(c, 'weapon', wpn.kind)?.tier ?? 0) >= wpn.tier, `${wpn.kind} 记下了现在的品阶`);
  // 再打一局：出战的局数累加，见过的不再多记
  const w2 = createWorld(12, 1, { heroes: ['yangjian'] });
  const t2 = new CodexTracker();
  for (let i = 0; i < 120; i++) for (const e of frame(w2)) t2.onEvent(e, w2, 0);
  t2.dispose();
  assert.deepEqual(loadCodex().hero, { yangjian: [0, 2] });
});

test('首领：入场算见过（记下是第几章），倒下记一次击败；联机时别人斩的不算自己的', () => {
  const w = { wave: 12, players: [], boss: { kind: 'yao' } } as unknown as World;
  const t = new CodexTracker();
  t.onEvent({ t: 'bossIntro', id: 1, kind: 'yao', x: 0, y: 0, chapter: 2 }, w, 0);
  t.flush();
  assert.deepEqual(loadCodex().boss, { yao: [2, 0] });
  t.onEvent({ t: 'bossDeath', id: 1, kind: 'yao', x: 0, y: 0, facing: 1, chapter: 2 }, w, 0);
  assert.deepEqual(loadCodex().boss, { yao: [2, 1] }, '首领倒下就并进存档');
  // 首领模块的状态没有了（倒下之后）：事件里带着是哪一位（首领池之后每章的首领不固定）
  const w3 = { wave: 18, players: [], boss: null } as unknown as World;
  t.onEvent({ t: 'bossDeath', id: 1, kind: 'zhuxian', x: 0, y: 0, facing: 1, chapter: 3 }, w3, 0);
  assert.deepEqual(loadCodex().boss.zhuxian, [3, 1]);
  // 回响那一族当首领：和它来遭遇战记在同一条（echo.<哪一位>）
  t.onEvent({ t: 'bossDeath', id: 1, kind: 'zhao', x: 0, y: 0, facing: 1, chapter: 2 }, w3, 0);
  t.onEvent({ t: 'echoDefeat', id: 1, kind: 'zhao', x: 0, y: 0, facing: 1, unlock: 'echo-zhao' }, w3, 0);
  t.flush();
  assert.equal(loadCodex().boss['echo.zhao']?.[1], 2);
  // 斩敌只算自己的（owner 是自己）；首领本体不进敌人那一栏
  t.onEvent({ t: 'kill', id: 2, kind: 'soldier', x: 0, y: 0, owner: 1, execute: false }, w, 0);
  t.onEvent({ t: 'kill', id: 3, kind: 'soldier', x: 0, y: 0, owner: 0, execute: false }, w, 0);
  t.onEvent({ t: 'kill', id: 4, kind: 'boss', x: 0, y: 0, owner: 0, execute: false }, w, 0);
  t.onEvent({ t: 'spawn', id: 5, kind: 'boss', x: 0, y: 0 }, w, 0);
  t.dispose();
  assert.deepEqual(loadCodex().foe, { soldier: [2, 1] });
});

test('图鉴的像素图：几帧按同一个框裁掉空白；剪影只留轮廓（淡墨、外沿深一档）；现有的每一条都画得出来', async () => {
  const { cropFrames, silhouette, heroArt, weaponArt, relicArt, elixirArt, charmArt, foeArt, bossArt } = await import('./codex-art.ts');
  const { grid, toRgba } = await import('../art/pixel.ts');
  const a = grid(['....', '.r..', '....']);
  const b = grid(['....', '....', '..e.']);
  const [ca, cb] = cropFrames([a, b]);
  assert.deepEqual([ca.w, ca.h, cb.w, cb.h], [2, 2, 2, 2]);
  assert.deepEqual(ca.rows, ['r.', '..']);
  assert.deepEqual(cb.rows, ['..', '.e']);
  const s = silhouette(grid(['.rrr.', 'rrrrr', '.rrr.']));
  assert.deepEqual(s.rows, ['.hhh.', 'hiiih', '.hhh.']);
  const { HEROES, WEAPONS, RELICS, ELIXIRS, CHARMS, CHAPTERS } = await import('../sim/catalog.ts');
  const { ENEMY_NAME } = await import('../sim/enemies.ts');
  const { chapterDef } = await import('../sim/chapters.ts');
  const arts = [
    ...Object.keys(HEROES).map((k) => heroArt(k as never)),
    ...Object.keys(WEAPONS).map((k) => weaponArt(k as never)),
    ...Object.keys(RELICS).map((k) => relicArt(k as never)),
    ...Object.keys(ELIXIRS).map((k) => elixirArt(k as never)),
    ...Object.keys(CHARMS).map((k) => charmArt(k as never)),
    ...Object.keys(ENEMY_NAME).map((k) => foeArt(k as never)),
    ...Array.from({ length: CHAPTERS }, (_, i) => bossArt(chapterDef(i + 1).boss.kind)),
  ];
  for (const fs of arts) {
    assert.ok(fs.length >= 1);
    for (const g of fs) {
      assert.ok(g.w > 0 && g.h > 0 && g.w === fs[0].w && g.h === fs[0].h, '几帧一样大');
      toRgba(g); // 字符都在调色板里
      toRgba(silhouette(g));
    }
  }
});

test('精英按种类记（Enemy.elite，没有 = 回响校尉），身上的词缀各记一条见过；斩的时候它已经清掉了也认得出是哪一种，带着的词缀也各记斩了一只', () => {
  const enemies: unknown[] = [
    { id: 7, kind: 'elite', elite: 'yecha', affixes: ['swift', 'split'] },
    { id: 8, kind: 'elite' },
    { id: 9, kind: 'elite', affix: 'tough' },
  ];
  const w = { wave: 4, tick: 100, phase: 'wave', players: [{ hero: 'nezha', weapons: [], relics: {}, charms: [], shop: [] }], enemies, boss: null } as unknown as World;
  const t = new CodexTracker();
  for (const id of [7, 8, 9]) t.onEvent({ t: 'spawn', id, kind: 'elite', x: 0, y: 0 }, w, 0);
  enemies.length = 0; // 斩的那一帧之后已经从场上清掉了
  t.onEvent({ t: 'kill', id: 7, kind: 'elite', x: 0, y: 0, owner: 0, execute: false }, w, 0);
  t.onEvent({ t: 'kill', id: 8, kind: 'elite', x: 0, y: 0, owner: 0, execute: false }, w, 0);
  t.dispose();
  const c = loadCodex();
  assert.deepEqual(c.foe, {
    'elite.yecha': [1, 1],
    'affix.swift': [1, 1],
    'affix.split': [1, 1],
    'elite.xiaowei': [1, 1],
    'affix.tough': [1, 0],
  });
});
