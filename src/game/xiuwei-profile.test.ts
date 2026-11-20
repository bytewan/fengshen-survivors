// 存档里的修为与劫数（profile.ts）：结算加道行、通关解锁下一劫、点亮 / 重置节点、存档码带上它们、坏数据的清洗。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64url,
  cleanJie,
  cleanXiuwei,
  crc32,
  decodeProfile,
  defaultProfile,
  describeProfile,
  encodeProfile,
  exportCode,
  freeDao,
  importCode,
  jieAfterRun,
  KEYS,
  lightNode,
  loadJie,
  loadProfile,
  loadXiuwei,
  recordRun,
  resetXiuwei,
  setLastJie,
  unlockedJie,
  useStorage,
  type StorageLike,
} from './profile.ts';
import { XIUWEI_FULL, XIUWEI_NODES, XIUWEI_TOTAL } from '../sim/xiuwei.ts';

function memStore() {
  const m = new Map<string, string>();
  const s: StorageLike & { m: Map<string, string>; writes: number } = {
    m,
    writes: 0,
    getItem: (k) => m.get(k) ?? null,
    setItem(k, v) {
      s.writes++;
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
  };
  return s;
}

let store = memStore();
beforeEach(() => {
  store = memStore();
  useStorage(store);
});

const run = (o: Partial<Parameters<typeof recordRun>[0]> = {}) => recordRun({ chapter: 1, wave: 3, time: 100, kills: 50, combo: 5, ...o });

test('结算：这一局的道行加进存档（累计）；没给道行不加', () => {
  assert.equal(loadXiuwei().dao, 0);
  assert.equal(run({ dao: 12 }).dao, 12);
  assert.equal(run({ dao: 7.9 }).dao, 7);
  assert.equal(run().dao, 0);
  assert.equal(run({ dao: -5 }).dao, 0);
  assert.equal(loadXiuwei().dao, 19);
  assert.equal(loadProfile().stats.runs, 4, '成绩照常记');
});

test('解锁劫数：整局通关劫 N 解锁劫 N + 1；输了、通关比已通关的低的不变；劫五到顶', () => {
  assert.equal(unlockedJie(), 1);
  assert.equal(run({ jie: 1 }).unlockedJie, 0, '输了不解锁');
  assert.equal(unlockedJie(), 1);
  assert.equal(run({ jie: 1, win: true }).unlockedJie, 2);
  assert.equal(unlockedJie(), 2);
  assert.equal(run({ jie: 1, win: true }).unlockedJie, 0, '再通关劫一不再解锁');
  assert.equal(run({ jie: 2, win: true }).unlockedJie, 3);
  assert.equal(run({ jie: 3, win: false }).unlockedJie, 0);
  assert.equal(run({ jie: 3, win: true }).unlockedJie, 4);
  assert.equal(run({ jie: 4, win: true }).unlockedJie, 5);
  assert.equal(run({ jie: 5, win: true }).unlockedJie, 0, '劫五之上没有了');
  assert.deepEqual(loadJie(), { cleared: 5, last: 1 });
  assert.equal(unlockedJie(), 5);
  // 纯函数：联机时跟着别人通关了更高的劫（自己没打过前面的），照样记下
  assert.deepEqual(jieAfterRun({ cleared: 0, last: 1 }, { chapter: 3, wave: 6, time: 1, kills: 1, combo: 1, win: true, jie: 3 }), { jie: { cleared: 3, last: 1 }, unlocked: 4 });
});

test('上次选的劫数：夹在已解锁的范围里，默认劫一', () => {
  assert.equal(loadJie().last, 1);
  setLastJie(3);
  assert.equal(loadJie().last, 1, '劫三还没解锁');
  run({ jie: 1, win: true });
  run({ jie: 2, win: true });
  setLastJie(3);
  assert.equal(loadJie().last, 3);
  setLastJie(0);
  assert.equal(loadJie().last, 1);
});

test('点亮节点：前置没点、境界门槛不够、二选一另一边点了、道行不够都点不了；点了扣剩下的道行；重置全额退还', () => {
  assert.equal(lightNode('wendao'), false, '一点道行都没有');
  run({ dao: 40 });
  assert.equal(lightNode('jilian'), false, '问道还没点');
  assert.equal(lightNode('wendao'), true);
  assert.equal(lightNode('wendao'), false, '已经点过');
  assert.equal(lightNode('jilian'), true);
  assert.equal(lightNode('xunlei'), false, '天仙一层要地仙两节');
  assert.equal(lightNode('tengyun'), true);
  assert.equal(freeDao(loadXiuwei()), 40 - 6 - 8 - 8);
  assert.equal(lightNode('xunlei'), true);
  assert.equal(lightNode('shanhe'), false, '二选一：迅雷点了，山河封住');
  assert.equal(lightNode('lianxing'), false, '剩 4，炼形要 14');
  assert.deepEqual(loadXiuwei(), { dao: 40, nodes: ['wendao', 'tengyun', 'jilian', 'xunlei'] });
  assert.equal(lightNode('nope' as never), false);
  assert.equal(resetXiuwei(), 36);
  assert.deepEqual(loadXiuwei(), { dao: 40, nodes: [] });
  assert.equal(freeDao(loadXiuwei()), 40);
  // 点满（二选一取先写的一边），按节点表的先后一节一节点
  run({ dao: XIUWEI_TOTAL });
  for (const id of XIUWEI_FULL) assert.equal(lightNode(id), true, id);
  assert.equal(freeDao(loadXiuwei()), 40);
  for (const n of XIUWEI_NODES) if (!XIUWEI_FULL.includes(n.id)) assert.equal(lightNode(n.id), false, `${n.id} 封住了`);
});

test('老存档（十节树）迁移：能对上的照旧点亮，对不上的不点，道行总数不变（等于退还）', () => {
  const OLD = ['zhuji', 'qingshen', 'lingjue', 'yuling', 'lianqi', 'ningshen', 'huigen', 'jucai', 'taojia', 'guanghuo'];
  store.m.set(KEYS.xiuwei, JSON.stringify({ dao: 170, nodes: OLD }));
  const x = loadXiuwei();
  assert.deepEqual(x, { dao: 170, nodes: ['wendao', 'tengyun', 'jilian', 'ziqi', 'jinbao', 'yushou', 'lishi'] });
  assert.equal(freeDao(x), 170 - (6 + 8 * 4 + 14 * 2), '灵觉、慧根、广货在新树里前置不满足：退还');
  // 点一节之后存的就是新 id
  assert.equal(lightNode('lianxing'), true);
  assert.deepEqual(JSON.parse(store.m.get(KEYS.xiuwei)!).nodes, ['wendao', 'tengyun', 'jilian', 'ziqi', 'jinbao', 'lianxing', 'yushou', 'lishi']);
  // 只点了筑基、轻身的老存档
  assert.deepEqual(cleanXiuwei({ dao: 16, nodes: ['zhuji', 'qingshen'] }), { dao: 16, nodes: ['wendao', 'tengyun'] });
  // 老存档码（严格）：老 id 照样收，对不上的不算坏数据
  assert.deepEqual(cleanXiuwei({ dao: 156, nodes: OLD }, true).nodes.length, 7);
  assert.throws(() => cleanXiuwei({ dao: 156, nodes: [...OLD, 'nope'] }, true));
});

test('存档码带上修为和劫数：导出、换一台设备导入，一模一样；描述里写上道行和劫数', () => {
  run({ dao: 60, jie: 1, win: true });
  run({ dao: 10, jie: 2, win: true });
  lightNode('wendao');
  lightNode('tengyun');
  setLastJie(2);
  const mine = loadProfile();
  assert.deepEqual(mine.xiuwei, { dao: 70, nodes: ['wendao', 'tengyun'] });
  assert.deepEqual(mine.jie, { cleared: 2, last: 2 });
  const code = exportCode();
  useStorage(memStore());
  assert.deepEqual(loadProfile(), defaultProfile());
  assert.ok(importCode(code).ok);
  assert.deepEqual(loadProfile(), mine);
  assert.equal(exportCode(), code);
  const d = describeProfile(mine);
  assert.match(d, /道行 70（点亮 2 节修为）/);
  assert.match(d, /劫数解锁到劫三/);
});

test('存档码：修为、劫数坏了整份拒绝；旧码（没有这两项）用默认值', () => {
  const forge = (obj: unknown) => {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    const head = Uint8Array.of(1, 0);
    const crc = crc32(new TextEncoder().encode('fengshen-survivors:huixiang'), head, raw);
    const bytes = new Uint8Array(6 + raw.length);
    bytes.set(head);
    bytes.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], 2);
    bytes.set(raw, 6);
    return `FS1-${base64url(bytes)}`;
  };
  const base = { v: 1, ...defaultProfile() };
  assert.ok(decodeProfile(forge({ ...base, xiuwei: { dao: 20, nodes: ['wendao', 'jinbao'] }, jie: { cleared: 1, last: 2 } })).ok);
  assert.ok(decodeProfile(forge({ ...base, xiuwei: { dao: 20, nodes: ['zhuji', 'jucai'] } })).ok, '老十节树的存档码照样收（迁移）');
  const bads = [
    { xiuwei: { dao: 20, nodes: ['wendao', 'nope'] } }, // 不认识的节点
    { xiuwei: { dao: 20, nodes: ['jilian'] } }, // 缺了前一节
    { xiuwei: { dao: 60, nodes: ['wendao', 'jilian', 'xunlei'] } }, // 境界门槛不够
    { xiuwei: { dao: 60, nodes: ['wendao', 'jilian', 'tengyun', 'xunlei', 'shanhe'] } }, // 二选一两边都点
    { xiuwei: { dao: 20, nodes: ['wendao', 'wendao'] } }, // 重复
    { xiuwei: { dao: 10, nodes: ['wendao', 'jilian'] } }, // 花的比攒的多
    { xiuwei: { dao: -1, nodes: [] } },
    { xiuwei: { dao: 1.5, nodes: [] } },
    { xiuwei: { dao: 5, nodes: 'wendao' } },
    { xiuwei: [] },
    { jie: { cleared: 6, last: 1 } },
    { jie: { cleared: 1, last: 0 } },
    { jie: { cleared: '2', last: 1 } },
    { jie: 3 },
  ];
  for (const b of bads) {
    const r = decodeProfile(forge({ ...base, ...b }));
    assert.equal(r.ok, false, JSON.stringify(b));
  }
  const old = decodeProfile(forge({ v: 1, unlocks: [], best: base.best, settings: base.settings, stats: base.stats }));
  assert.ok(old.ok);
  if (old.ok) {
    assert.deepEqual(old.profile.xiuwei, { dao: 0, nodes: [] });
    assert.deepEqual(old.profile.jie, { cleared: 0, last: 1 });
  }
  // 编码再解码一样
  const p = { ...defaultProfile(), xiuwei: { dao: 9999, nodes: [...XIUWEI_FULL] }, jie: { cleared: 5, last: 4 } };
  const r = decodeProfile(encodeProfile(p));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.profile, p);
});

test('本地存储里的修为、劫数坏了：宽松地留下能用的（缺前一节的丢掉、超支的从最后点的退），劫数越界换默认值', () => {
  assert.deepEqual(cleanXiuwei({ dao: 20, nodes: ['wendao', 'nope', 'wudao', 'jinbao'] }), { dao: 20, nodes: ['wendao', 'jinbao'] });
  assert.deepEqual(cleanXiuwei({ dao: 20, nodes: ['wendao', 'jilian', 'jinbao'] }), { dao: 20, nodes: ['wendao', 'jilian'] }, '超支：退掉排在最后的');
  assert.deepEqual(cleanXiuwei({ dao: 40, nodes: ['wendao', 'jilian', 'tengyun', 'xunlei', 'lianxing'] }), { dao: 40, nodes: ['wendao', 'tengyun', 'jilian', 'lianxing'] }, '超支：退掉排在最后的（同一层按路线身、器、灵、财、心）');
  assert.deepEqual(cleanXiuwei({ dao: 'x', nodes: ['wendao'] }), { dao: 0, nodes: [] });
  assert.deepEqual(cleanXiuwei(null), { dao: 0, nodes: [] });
  assert.deepEqual(cleanJie({ cleared: 9, last: -2 }), { cleared: 0, last: 1 });
  store.m.set(KEYS.xiuwei, '{bad json');
  store.m.set(KEYS.jie, JSON.stringify({ cleared: 2, last: 3 }));
  assert.deepEqual(loadXiuwei(), { dao: 0, nodes: [] });
  assert.deepEqual(loadJie(), { cleared: 2, last: 3 });
});
