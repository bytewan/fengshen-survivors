// 成就（achievements.ts）：表、判定、存档读写与补记、奖励进万宝阁（RunSetup.sealed → shop.ts）、联机各刷各的、快照确定性。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, ACH_GROUPS, AchRun, achDef, cnNum, grant, lockOf, reconcile, sealedItems, type RunFacts } from './achievements.ts';
import {
  KEYS,
  cleanAchieve,
  decodeProfile,
  defaultProfile,
  encodeProfile,
  hasAchieveKey,
  importCode,
  loadAchieved,
  unlock,
  unlocks,
  useStorage,
  type StorageLike,
} from './profile.ts';
import { COMMON_WEAPONS, EARNED, HEROES, WEAPONS, shopWeapons } from '../sim/catalog.ts';
import { createWorld, digest, type SimEvent, type World } from '../sim/world.ts';
import { restock } from '../sim/shop.ts';
import { restore, snapshot } from '../sim/snapshot.ts';
import { ELEMENTS, type Player } from '../sim/types.ts';

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

// ---------------------------------------------------------------- 表

test('成就表：id 不重、名字两到四个字、分组都在、说明不空；奖励指向的东西都在，每样东西只挂在一条上', () => {
  const ids = ACHIEVEMENTS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ACHIEVEMENTS.length >= 30 && ACHIEVEMENTS.length <= 45, `约 30–40 条（现在 ${ACHIEVEMENTS.length}）`);
  const groups = new Set(ACH_GROUPS.map((g) => g.id));
  for (const d of ACHIEVEMENTS) {
    assert.ok([...d.name].length >= 2 && [...d.name].length <= 4, d.name);
    assert.ok(groups.has(d.group), d.id);
    assert.ok(d.desc.length >= 4 && !/[了就]|打死|一下/.test(d.desc), `${d.id} 的说明：${d.desc}`);
    assert.ok(d.run || d.prof, `${d.id} 要有判定`);
  }
  for (const g of ACH_GROUPS) assert.ok(ACHIEVEMENTS.some((d) => d.group === g.id), `${g.name}组至少一条`);
  const rewards = ACHIEVEMENTS.filter((d) => d.reward).map((d) => `${d.reward!.cat}:${d.reward!.id}`);
  assert.equal(new Set(rewards).size, rewards.length, '同一样东西不挂两条');
  for (const d of ACHIEVEMENTS) if (d.reward?.cat === 'weapon') assert.ok(shopWeapons().includes(d.reward.id), `${d.reward.id} 是商店里的公共法宝`);
  // 每个角色一条「通关一次」
  for (const h of Object.keys(HEROES)) assert.ok(achDef(`jue.${h}`), h);
});

test('上锁之后：每一行开局都还有至少四件公共法宝可买；雷震子要靠「陈塘初定」解锁', () => {
  const sealed = new Set(sealedItems({}));
  for (const el of ELEMENTS) {
    const open = shopWeapons().filter((k) => WEAPONS[k].el === el && !sealed.has(`weapon:${k}`));
    assert.ok(open.length >= 4, `${el} 行开局只有 ${open.length} 件`);
  }
  const locked = COMMON_WEAPONS.filter((k) => sealed.has(`weapon:${k}`));
  assert.ok(locked.length >= 4 && locked.length <= 6, `锁 4–6 件法宝（现在 ${locked.length}）`);
  assert.equal(achDef('zheng.ch1')!.reward?.id, 'leizhenzi');
  assert.equal(EARNED.leizhenzi?.unlock, 'leizhenzi');
  assert.equal(lockOf('weapon', 'jinjiao')?.id, 'zheng.ch2');
  assert.equal(lockOf('weapon', 'huojian'), null);
});

test('数字写成汉字', () => {
  assert.deepEqual([1, 3, 10, 30, 100, 300, 1500, 1050, 10000, 20000].map(cnNum), ['一', '三', '十', '三十', '一百', '三百', '一千五百', '一千零五十', '一万', '二万']);
});

// ---------------------------------------------------------------- 一局里的判定

const ev = (e: unknown) => e as SimEvent;
function runWith(o: { hero?: Player['hero']; jie?: number; online?: boolean } = {}) {
  const w = createWorld(3, 1, [o.hero ?? 'nezha']);
  const r = new AchRun(true, { hero: o.hero ?? 'nezha', jie: o.jie ?? 1, online: !!o.online });
  return { w, r };
}
const got = () => Object.keys(loadAchieved());

test('征战：平定第一章（顺带解锁雷震子）、打倒回响化身（遭遇战也算）；通关记下劫数与角色', () => {
  const { w, r } = runWith({ hero: 'yangjian', jie: 2 });
  r.onEvent(ev({ t: 'chapterClear', chapter: 1 }), w, 0);
  assert.ok(got().includes('zheng.ch1'));
  assert.ok(unlocks().includes('leizhenzi'), '奖励的角色写进解锁');
  r.onEvent(ev({ t: 'echoDefeat', id: 1, kind: 'aobing', x: 0, y: 0, facing: 1, unlock: 'echo-aobing' }), w, 0);
  assert.ok(got().includes('boss.aobing') && unlocks().includes('echo-aobing'));
  r.onEvent(ev({ t: 'win' }), w, 0);
  for (const id of ['zheng.win', 'zheng.jie2', 'jue.yangjian']) assert.ok(got().includes(id), id);
  assert.ok(!got().includes('zheng.jie3') && !got().includes('jue.nezha'));
});

test('斩获、构筑：看人物的状态（斩敌、灵石、五行、神品、宠物、功法）', () => {
  const { w, r } = runWith();
  const p = w.players[0];
  p.kills = 1600;
  p.lingshi = 320;
  p.weapons = [
    { kind: 'qiankun', tier: 4, spirit: null, cd: 0 },
    { kind: 'zhanxian', tier: 4, spirit: null, cd: 0 },
    { kind: 'leigong', tier: 1, spirit: null, cd: 0 },
    { kind: 'fantian', tier: 1, spirit: null, cd: 0 },
  ];
  p.pet.stage = 1;
  r.update(w, 0, 120);
  for (const id of ['zhan.kills', 'zhan.rich', 'zhan.combo', 'gou.god', 'gou.god2', 'gou.pet', 'gou.wx5']) assert.ok(got().includes(id), id);
  assert.ok(!got().includes('gou.same4') && !got().includes('gou.tech'));
});

test('联机：联机平定一章、联机通关；单人不算', () => {
  const solo = runWith();
  solo.r.onEvent(ev({ t: 'chapterClear', chapter: 1 }), solo.w, 0);
  assert.ok(!got().includes('lian.ch1'));
  const co = runWith({ online: true });
  co.r.onEvent(ev({ t: 'chapterClear', chapter: 2 }), co.w, 0);
  assert.ok(got().includes('lian.ch1'));
});

test('隐秘：首领战一下没挨打、气血将尽时平定一波、分文未花平定第一章；挨过打的不算', () => {
  const a = runWith();
  a.r.onEvent(ev({ t: 'waveStart', wave: 6, duration: 0 }), a.w, 0);
  a.r.onEvent(ev({ t: 'hurt', owner: 0, x: 0, y: 0, dmg: 3, hp: 90, by: 'touch' }), a.w, 0);
  a.r.onEvent(ev({ t: 'bossDeath', id: 1, kind: 'nezha', x: 0, y: 0, facing: 1, chapter: 1 }), a.w, 0);
  assert.ok(!got().includes('mi.unhurt'));
  assert.ok(got().includes('boss.nezha'));
  a.r.onEvent(ev({ t: 'waveStart', wave: 12, duration: 0 }), a.w, 0);
  a.r.onEvent(ev({ t: 'bossDeath', id: 2, kind: 'yao', x: 0, y: 0, facing: 1, chapter: 2 }), a.w, 0);
  assert.ok(got().includes('mi.unhurt'));
  a.w.players[0].hp = 3;
  a.r.onEvent(ev({ t: 'waveEnd', wave: 12 }), a.w, 0);
  assert.ok(got().includes('mi.clutch'));
  // 买过东西的不算「两袖清风」
  const b = runWith();
  b.r.onEvent(ev({ t: 'bought', owner: 0, offer: { cat: 'relic', id: 'peach', price: 1 }, result: '' }), b.w, 0);
  b.r.onEvent(ev({ t: 'chapterClear', chapter: 1 }), b.w, 0);
  assert.ok(!got().includes('mi.thrift'));
  const c = runWith();
  c.r.onEvent(ev({ t: 'chapterClear', chapter: 1 }), c.w, 0);
  assert.ok(got().includes('mi.thrift'));
});

test('机器人自动玩、调试开局（enabled = false）什么都不记', () => {
  const w = createWorld(3, 1, ['nezha']);
  const r = new AchRun(false, { hero: 'nezha', jie: 1, online: false });
  r.onEvent(ev({ t: 'win' }), w, 0);
  r.update(w, 0, 999);
  assert.deepEqual(got(), []);
});

test('每条 run 判定都能被某组事实满足（没有永远达不成的）', () => {
  const all: RunFacts = { hero: 'nezha', jie: 5, online: true, chapters: [1, 2, 3], win: true, bosses: ['nezha', 'aobing', 'yao', 'zhao', 'zhuxian', 'yunxiao'], kills: 1e6, combo: 1e6, lingshi: 1e6, elements: 5, same: 4, gods: 4, pet: 3, techs: 9, bought: 0, unhurt: true, clutch: true, thrift: true };
  for (const d of ACHIEVEMENTS) if (d.run && d.group !== 'jue') assert.ok(d.run(all), d.id);
  for (const h of Object.keys(HEROES) as Player['hero'][]) assert.ok(achDef(`jue.${h}`)!.run!({ ...all, hero: h }), h);
});

// ---------------------------------------------------------------- 存档：读写、补记、迁移

test('老存档第一次打开：按已有的进度补记（时间记 0、不弹窗），已经解锁的角色照旧解锁；之后新达成的记上时间', () => {
  store.m.set(KEYS.unlocks, JSON.stringify(['demon-nezha', 'echo-zhao']));
  store.m.set(KEYS.best, JSON.stringify({ chapter: 2, wave: 4, chapterTimes: { 1: 400 }, clearTime: null, combo: 130 }));
  store.m.set(KEYS.stats, JSON.stringify({ runs: 30, kills: 12000, clears: 0, playTime: 9000 }));
  store.m.set(KEYS.codex, JSON.stringify({ boss: { yao: [2, 1] }, weapon: { huojian: [1, 3, 4] } }));
  assert.equal(hasAchieveKey(), false);
  const first = reconcile();
  const a = loadAchieved();
  for (const id of ['boss.nezha', 'boss.zhao', 'boss.yao', 'zheng.ch1', 'zhan.combo', 'zhan.total', 'gou.god']) assert.equal(a[id], 0, `${id} 补记`);
  assert.ok(!('zheng.ch2' in a) && !('zheng.win' in a));
  assert.equal(first.length, Object.keys(a).length);
  assert.deepEqual(unlocks().slice(0, 2), ['demon-nezha', 'echo-zhao'], '老的解锁照旧');
  assert.ok(unlocks().includes('leizhenzi'), '平定过第一章的老存档：雷震子补上');
  // 第二次（已经有成就这一节了）：新达成的记时间
  store.m.set(KEYS.jie, JSON.stringify({ cleared: 1, last: 1 }));
  reconcile();
  assert.ok(loadAchieved()['zheng.win'] > 1e9);
});

test('新存档：什么都没有也写上成就这一节；之后达成的弹窗（记时间）', () => {
  assert.deepEqual(reconcile(), []);
  assert.equal(hasAchieveKey(), true);
  const g = grant(['gou.pet', 'gou.pet', 'nope']);
  assert.deepEqual(g.map((d) => d.id), ['gou.pet']);
  assert.ok(loadAchieved()['gou.pet'] > 1e9);
  assert.deepEqual(grant(['gou.pet']), [], '已经有了不再记');
});

test('新解锁了角色（天上的裂缝）：对应的隐秘成就跟着补上', () => {
  reconcile();
  unlock('wukong');
  assert.ok('mi.rift' in loadAchieved());
});

test('成就这一节的清洗：坏 id、坏时间宽松模式丢掉、严格模式拒绝；存档码往返带着它；旧存档码导入时清掉这一节', () => {
  assert.deepEqual(cleanAchieve({ 'zheng.ch1': 5, 'BAD id': 1, 'gou.pet': -1, 'gou.god': 1.5 }), { 'zheng.ch1': 5 });
  assert.throws(() => {
    const r = cleanAchieve({ 'BAD id': 1 }, true);
    void r;
  });
  const p = { ...defaultProfile(), achieve: { 'zheng.ch1': 1794000000, 'boss.nezha': 0 } };
  const d = decodeProfile(encodeProfile(p));
  assert.ok(d.ok && d.ok && d.profile.achieve['zheng.ch1'] === 1794000000);
  // 旧版导出的码没有成就：导入后这一节清掉，下次补记不弹窗
  store.m.set(KEYS.achieve, JSON.stringify({ 'gou.pet': 1 }));
  const old = encodeProfile({ ...defaultProfile(), best: { ...defaultProfile().best, chapter: 2, wave: 1 } });
  assert.ok(importCode(old).ok);
  assert.equal(hasAchieveKey(), false);
  reconcile();
  assert.equal(loadAchieved()['zheng.ch1'], 0);
});

// ---------------------------------------------------------------- 奖励进万宝阁（模拟层：RunSetup.sealed）

const offered = (w: World, p: Player, n: number) => {
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    restock(w, p);
    for (const o of p.shop) if (o) seen.add(o.cat === 'weapon' || o.cat === 'spirit' ? `weapon:${o.kind}` : `${o.cat}:${o.id}`);
  }
  return seen;
};

test('没解锁的不刷、解锁了就刷；不给 RunSetup.sealed 时全都刷（测试、数值工具、机器人）', () => {
  const sealed = sealedItems({});
  const locked = createWorld(11, 1, { heroes: ['nezha'], sealed: [sealed] });
  locked.wave = 8;
  const a = offered(locked, locked.players[0], 400);
  for (const k of sealed) assert.ok(!a.has(k), `${k} 不该刷出来`);
  const free = createWorld(11, 1, { heroes: ['nezha'] });
  free.wave = 8;
  const b = offered(free, free.players[0], 400);
  assert.ok(sealed.filter((k) => b.has(k)).length >= sealed.length - 2, '不锁时这些都刷得到');
  // 解锁了金蛟剪：它就进池
  const some = createWorld(11, 1, { heroes: ['nezha'], sealed: [sealed.filter((k) => k !== 'weapon:jinjiao')] });
  some.wave = 8;
  assert.ok(offered(some, some.players[0], 400).has('weapon:jinjiao'));
});

test('给空的 sealed 和不给完全一样（随机数、货架、摘要逐项相同）', () => {
  const a = createWorld(5, 1, { heroes: ['zhao'] });
  const b = createWorld(5, 1, { heroes: ['zhao'], sealed: [[]] });
  assert.equal('sealed' in b.players[0], false);
  for (let i = 0; i < 30; i++) {
    restock(a, a.players[0]);
    restock(b, b.players[0]);
  }
  assert.deepEqual(a.players[0].shop, b.players[0].shop);
  assert.equal(digest(a), digest(b));
});

test('联机：两个人不同的解锁，各刷各的', () => {
  const w = createWorld(21, 2, { heroes: ['nezha', 'yangjian'], sealed: [['weapon:jinjiao', 'relic:jadedragon'], ['weapon:wanya']] });
  w.wave = 8;
  const a = offered(w, w.players[0], 300);
  const b = offered(w, w.players[1], 300);
  assert.ok(!a.has('weapon:jinjiao') && !a.has('relic:jadedragon') && a.has('weapon:wanya'));
  assert.ok(!b.has('weapon:wanya') && b.has('weapon:jinjiao'));
});

test('快照：带着 sealed 存下、恢复之后接着进货逐项相同', () => {
  const w = createWorld(31, 1, { heroes: ['nezha'], sealed: [sealedItems({})] });
  w.wave = 5;
  restock(w, w.players[0]);
  const back = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.deepEqual(back.players[0].sealed, w.players[0].sealed);
  for (let i = 0; i < 20; i++) {
    restock(w, w.players[0]);
    restock(back, back.players[0]);
  }
  assert.deepEqual(back.players[0].shop, w.players[0].shop);
  assert.equal(digest(back), digest(w));
});
