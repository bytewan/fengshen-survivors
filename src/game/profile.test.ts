// 存档与存档码的纯逻辑测试：LZW / base64url 往返、存档码编解码、篡改与坏数据被拒、成绩合并、和首领分支 save.ts 的兼容、
// 设置（三个音量、伤害数字、字体主题）的读写与校验。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64url,
  cleanProfile,
  crc32,
  decodeProfile,
  defaultProfile,
  encodeProfile,
  exportCode,
  fromBase64url,
  getSettings,
  importCode,
  isUnlocked,
  KEYS,
  loadProfile,
  lzwCompress,
  lzwDecompress,
  mergeRun,
  onSettingsChange,
  recordRun,
  unlock,
  unlocks,
  updateSettings,
  useStorage,
  type Profile,
  type StorageLike,
  hasSeen,
  markSeen,
} from './profile.ts';

/** 内存里的 localStorage，顺便记下写了几次。 */
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

/** 确定性的随机数（测试里不用 Math.random，失败了能复现）。 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sample = (): Profile => ({
  unlocks: ['demon-nezha'],
  best: { chapter: 1, wave: 6, chapterTimes: { '1': 412.5 }, clearTime: null, combo: 143 },
  settings: { master: 0.55, sfx: 0.3, music: 0.9, damageNumbers: false, fontTheme: 'brush' },
  stats: { runs: 12, kills: 4810, clears: 0, playTime: 3725.25 },
  xiuwei: { dao: 40, nodes: ['wendao', 'jilian', 'jinbao'] },
  jie: { cleared: 2, last: 3 },
  codex: {
    hero: { nezha: [0, 9], yangjian: [0, 3] },
    weapon: { qiankun: [1, 12, 4], huojian: [1, 3, 2], kunxian: [2, 0] },
    relic: { peach: [1, 7], orb_fire: [1, 2] },
    elixir: { huichun: [1, 4] },
    charm: { tishen: [2, 1] },
    foe: { soldier: [1, 2210], bomber: [1, 96], golem: [2, 40] },
    boss: { nezha: [1, 1], yao: [2, 0] },
  },
  achieve: { 'zheng.ch1': 1794000000, 'boss.nezha': 0 },
});

test('LZW：各种输入都能原样解回来（含 KwKwK 与码表写满）', () => {
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    Uint8Array.of(7),
    Uint8Array.of(0, 255),
    new TextEncoder().encode('a'.repeat(1000)),
    new TextEncoder().encode('ab'.repeat(500)),
    new TextEncoder().encode('{"unlocks":["demon-nezha"],"best":{"chapter":1}}'.repeat(20)),
  ];
  const r = rng(1);
  for (const n of [1, 2, 3, 10, 100, 1000, 30000]) cases.push(Uint8Array.from({ length: n }, () => Math.floor(r() * 256)));
  // 小字母表的长随机串：码表很快写满（> 4096 个串），测上限之后的行为
  cases.push(Uint8Array.from({ length: 60000 }, () => 97 + Math.floor(r() * 4)));
  for (const c of cases) assert.deepEqual(lzwDecompress(lzwCompress(c)), c, `长度 ${c.length}`);
  // 重复多的 JSON 确实变短
  const json = new TextEncoder().encode(JSON.stringify(sample()));
  assert.ok(lzwCompress(json).length < json.length);
});

test('LZW：截断或乱码的输入抛错，不会读出越界的东西', () => {
  const packed = lzwCompress(new TextEncoder().encode('封神幸存者 · 回响 · 封神幸存者 · 回响'));
  assert.throws(() => lzwDecompress(packed.subarray(0, packed.length - 3)));
  assert.throws(() => lzwDecompress(Uint8Array.of(0x85)));
  const bad = packed.slice();
  bad[0] = 0x7f; // 谎报长度
  assert.throws(() => lzwDecompress(bad));
});

test('base64url：往返、拒绝非法字符和多余的尾位', () => {
  const r = rng(2);
  for (let n = 0; n < 40; n++) {
    const b = Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
    const s = base64url(b);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(fromBase64url(s), b);
  }
  assert.equal(fromBase64url('ab+c'), null);
  assert.equal(fromBase64url('abc=d'), null);
  assert.equal(fromBase64url('abcde'), null); // 长度除以 4 余 1
  assert.equal(fromBase64url('AB'), null); // 'B' 的低 4 位不是 0
  assert.deepEqual(fromBase64url('AA'), Uint8Array.of(0));
});

test('CRC32：标准值', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('存档码：编码再解码，内容完全一致；默认存档也行', () => {
  for (const p of [sample(), defaultProfile(), { ...sample(), best: { ...sample().best, clearTime: 1234.5, chapterTimes: { '1': 400, '2': 800, '3': 1234.5 } } }]) {
    const code = encodeProfile(p);
    assert.match(code, /^FS1-[A-Za-z0-9_-]+$/);
    const r = decodeProfile(code);
    assert.ok(r.ok, r.ok ? '' : r.error);
    if (r.ok) assert.deepEqual(r.profile, p);
  }
});

test('存档码：复制时夹进的空格换行、小写前缀都能认', () => {
  const code = encodeProfile(sample());
  const messy = `  ${code.slice(0, 20)}\n${code.slice(20, 50)} \r\n ${code.slice(50)}  `;
  assert.ok(decodeProfile(messy).ok);
  assert.ok(decodeProfile(code.replace(/^FS/, 'fs')).ok);
});

test('存档码：改动任何一个字符都会被拒（校验和）', () => {
  const code = encodeProfile(sample());
  const body = code.slice(4);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let rejected = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    const swap = alphabet[(alphabet.indexOf(c) + 17) % 64];
    const r = decodeProfile(`FS1-${body.slice(0, i)}${swap}${body.slice(i + 1)}`);
    if (!r.ok) rejected++;
  }
  assert.equal(rejected, body.length);
  // 截短、加长、换前缀
  assert.equal(decodeProfile(code.slice(0, -4)).ok, false);
  assert.equal(decodeProfile(`${code}AAAA`).ok, false);
  const wrong = decodeProfile(`XX1-${body}`);
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.match(wrong.error, /不是封神幸存者的存档码/);
  const tampered = decodeProfile(`FS1-${body.slice(0, 10)}${body[10] === 'A' ? 'B' : 'A'}${body.slice(11)}`);
  assert.equal(tampered.ok, false);
  if (!tampered.ok) assert.match(tampered.error, /校验/);
  const empty = decodeProfile('   ');
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.error, /粘贴/);
});

test('存档码：更新版本导出的码给出明确提示', () => {
  const body = encodeProfile(sample()).slice(4);
  const r = decodeProfile(`FS2-${body}`);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /更新版本/);
});

test('存档码：校验和对得上、但字段坏了的数据也拒绝（不把坏数据写进去）', () => {
  // 手工拼一个「格式正确、校验和正确、内容不对」的码：借 encodeProfile 的输出格式，换掉里面的 JSON
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
  // 先确认拼法本身是对的
  const good = decodeProfile(forge({ v: 1, ...sample() }));
  assert.ok(good.ok);
  const bads: unknown[] = [
    { v: 1, ...sample(), settings: { ...sample().settings, master: 5 } },
    { v: 1, ...sample(), settings: { ...sample().settings, damageNumbers: 'yes' } },
    { v: 1, ...sample(), settings: { ...sample().settings, fontTheme: 'comic' } },
    { v: 1, ...sample(), settings: { ...sample().settings, fontTheme: 7 } },
    { v: 1, ...sample(), settings: { ...sample().settings, fontTheme: 'constructor' } },
    { v: 1, ...sample(), unlocks: 'demon-nezha' },
    { v: 1, ...sample(), unlocks: ['<script>'] },
    { v: 1, ...sample(), best: { ...sample().best, wave: -1 } },
    { v: 1, ...sample(), best: { ...sample().best, chapterTimes: { x: 3 } } },
    { v: 1, ...sample(), stats: { ...sample().stats, kills: 1.5 } },
    { v: 1, ...sample(), stats: [] },
    { ...sample() }, // 没有版本号
    [1, 2, 3],
  ];
  for (const b of bads) {
    const r = decodeProfile(forge(b));
    assert.equal(r.ok, false, JSON.stringify(b).slice(0, 80));
    if (!r.ok) assert.match(r.error, /数据不对/);
  }
  // 缺字段（旧版本的码）可以：用默认值补上
  const old = decodeProfile(forge({ v: 1, unlocks: ['demon-nezha'] }));
  assert.ok(old.ok);
  if (old.ok) {
    assert.deepEqual(old.profile.unlocks, ['demon-nezha']);
    assert.deepEqual(old.profile.stats, defaultProfile().stats);
  }
  // 加字体主题之前导出的码（设置里只有三个音量和伤害数字）：照样能导入，字体主题是默认的文楷
  const beforeFont = decodeProfile(forge({ v: 1, ...sample(), settings: { master: 0.55, sfx: 0.3, music: 0.9, damageNumbers: false } }));
  assert.ok(beforeFont.ok);
  if (beforeFont.ok) assert.deepEqual(beforeFont.profile.settings, { master: 0.55, sfx: 0.3, music: 0.9, damageNumbers: false, fontTheme: 'kai' });
  // 拒绝的码不碰存储
  const before = store.writes;
  assert.equal(importCode(forge(bads[0])).ok, false);
  assert.equal(store.writes, before);
});

test('导出再导入：换一台「设备」（空存储）后存档一致', () => {
  unlock('demon-nezha');
  updateSettings({ master: 0.4, sfx: 0.7, music: 0.2, damageNumbers: false, fontTheme: 'brush' });
  recordRun({ chapter: 1, wave: 6, time: 600, kills: 900, combo: 77, chapterTimes: { 1: 590 } });
  recordRun({ chapter: 1, wave: 3, time: 200, kills: 120, combo: 30 });
  const mine = loadProfile();
  const code = exportCode();

  useStorage(memStore()); // 新设备
  assert.deepEqual(loadProfile(), defaultProfile());
  const r = importCode(code);
  assert.ok(r.ok);
  assert.deepEqual(loadProfile(), mine);
  assert.equal(getSettings().master, 0.4);
  assert.equal(getSettings().fontTheme, 'brush'); // 字体主题跟着存档码走
  assert.equal(exportCode(), code); // 再导出还是同一串
});

test('导入失败时本机存档原样不动', () => {
  unlock('demon-nezha');
  recordRun({ chapter: 1, wave: 4, time: 300, kills: 400, combo: 50 });
  const before = loadProfile();
  const writes = store.writes;
  const code = exportCode();
  const broken = `${code.slice(0, 12)}${code[12] === 'Q' ? 'R' : 'Q'}${code.slice(13)}`;
  const r = importCode(broken);
  assert.equal(r.ok, false);
  assert.equal(store.writes, writes);
  assert.deepEqual(loadProfile(), before);
});

test('看过的东西（开场过场）：只记在这台设备上，不进存档码；坏数据当作没看过', () => {
  assert.equal(hasSeen('ch1-intro'), false);
  assert.equal(markSeen('ch1-intro'), true); // 第一次
  assert.equal(markSeen('ch1-intro'), false); // 已经记过
  assert.equal(hasSeen('ch1-intro'), true);
  assert.equal(hasSeen('ch1-end'), false);
  assert.deepEqual(JSON.parse(store.m.get(KEYS.seen)!), ['ch1-intro']);
  assert.equal(markSeen('不合法 的 id'), false);
  // 不进存档码：导出再导入到一台「新设备」，开场还会再放一遍
  const code = exportCode();
  store.m.delete(KEYS.seen);
  assert.equal(importCode(code).ok, true);
  assert.equal(hasSeen('ch1-intro'), false);
  // 坏数据
  store.m.set(KEYS.seen, '{oops');
  assert.equal(hasSeen('ch1-intro'), false);
  store.m.set(KEYS.seen, JSON.stringify({ a: 1 }));
  assert.equal(hasSeen('ch1-intro'), false);
  assert.equal(markSeen('ch1-intro'), true);
  assert.deepEqual(JSON.parse(store.m.get(KEYS.seen)!), ['ch1-intro']);
});

test('和首领分支 save.ts 兼容：同一个键、同一个格式', () => {
  // save.ts 写的样子
  store.m.set(KEYS.unlocks, JSON.stringify(['demon-nezha']));
  assert.equal(isUnlocked('demon-nezha'), true);
  assert.equal(unlock('demon-nezha'), false); // 已经有了
  // 我们写的，save.ts 也读得懂（JSON 字符串数组）
  store.m.delete(KEYS.unlocks);
  assert.equal(unlock('demon-nezha'), true);
  const raw = JSON.parse(store.m.get(KEYS.unlocks)!);
  assert.ok(Array.isArray(raw) && raw.every((x: unknown) => typeof x === 'string'));
  assert.deepEqual(raw, ['demon-nezha']);
  // save.ts 在这期间又直接写了一个：不缓存，现读现用，不会被我们覆盖掉
  store.m.set(KEYS.unlocks, JSON.stringify(['demon-nezha', 'yang-jian']));
  assert.equal(unlock('sun-wukong'), true);
  assert.deepEqual(unlocks(), ['demon-nezha', 'yang-jian', 'sun-wukong']);
});

test('本地存储里有坏数据：只丢坏掉的那个键，别的照常', () => {
  store.m.set(KEYS.unlocks, JSON.stringify(['demon-nezha']));
  store.m.set(KEYS.best, '{not json');
  store.m.set(KEYS.settings, JSON.stringify({ master: 'loud', sfx: 0.5, music: 9, damageNumbers: false, fontTheme: 'comic' }));
  store.m.set(KEYS.stats, JSON.stringify({ runs: 3, kills: -5 }));
  useStorage(store); // 清掉设置缓存
  const p = loadProfile();
  assert.deepEqual(p.unlocks, ['demon-nezha']);
  assert.deepEqual(p.best, defaultProfile().best);
  assert.deepEqual(p.settings, { master: 0.8, sfx: 0.5, music: 1, damageNumbers: false, fontTheme: 'kai' });
  assert.deepEqual(p.stats, { runs: 3, kills: 0, clears: 0, playTime: 0 });
});

test('存储不可用（隐私模式）：不报错，照常返回默认值', () => {
  const broken: StorageLike = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {},
  };
  useStorage(broken);
  assert.deepEqual(loadProfile(), defaultProfile());
  assert.doesNotThrow(() => updateSettings({ master: 0.2 }));
  assert.equal(getSettings().master, 0.2); // 这一页里照常生效
  assert.doesNotThrow(() => recordRun({ chapter: 1, wave: 2, time: 30, kills: 10, combo: 3 }));
});

test('设置：改了立即写进存档、通知订阅者，越界的值被夹住', () => {
  const seen: number[] = [];
  const off = onSettingsChange((s) => seen.push(s.master));
  updateSettings({ master: 0.3 });
  updateSettings({ master: 7 }); // 越界：夹到 1，不写坏数据
  updateSettings({ master: Number.NaN, damageNumbers: 'no' as never }); // 类型不对：保持原值
  off();
  updateSettings({ master: 0.6 });
  assert.deepEqual(seen, [0.3, 1, 1]);
  assert.equal(JSON.parse(store.m.get(KEYS.settings)!).master, 0.6);
  assert.equal(getSettings().damageNumbers, true);
});

test('设置：三个音量分开存；字体主题只认 fonts.ts 里有的，改了就写进存档', () => {
  assert.deepEqual(getSettings(), { master: 0.8, sfx: 1, music: 1, damageNumbers: true, fontTheme: 'kai' }); // 默认
  // 加字体主题之前存下的设置（没有这一项）：读出来是默认的文楷，别的不变
  store.m.set(KEYS.settings, JSON.stringify({ master: 0.5, sfx: 0.25, music: 0, damageNumbers: false }));
  useStorage(store); // 清掉设置缓存
  assert.deepEqual(getSettings(), { master: 0.5, sfx: 0.25, music: 0, damageNumbers: false, fontTheme: 'kai' });
  // 三个音量各改各的，互不影响
  updateSettings({ sfx: 0.6 });
  updateSettings({ music: 0.35 });
  assert.deepEqual(getSettings(), { master: 0.5, sfx: 0.6, music: 0.35, damageNumbers: false, fontTheme: 'kai' });
  // 字体主题：改成书法，写进存档；不认识的值保持原样
  const seen: string[] = [];
  const off = onSettingsChange((s) => seen.push(s.fontTheme));
  updateSettings({ fontTheme: 'brush' });
  assert.equal(JSON.parse(store.m.get(KEYS.settings)!).fontTheme, 'brush');
  updateSettings({ fontTheme: 'comic' as never });
  updateSettings({ fontTheme: 'toString' as never });
  updateSettings({ master: 0.9 }); // 改别的不会把它改回去
  off();
  assert.deepEqual(seen, ['brush', 'brush', 'brush', 'brush']);
  assert.equal(getSettings().fontTheme, 'brush');
  // 换一页（缓存清掉）重新读：还是书法
  useStorage(store);
  assert.deepEqual(getSettings(), { master: 0.9, sfx: 0.6, music: 0.35, damageNumbers: false, fontTheme: 'brush' });
  updateSettings({ fontTheme: 'kai' });
  assert.equal(loadProfile().settings.fontTheme, 'kai');
});

test('成绩合并：最远、最高连斩、每章最快、最快通关、累计', () => {
  let { best, stats } = defaultProfile();
  let r = mergeRun(best, stats, { chapter: 1, wave: 3, time: 120, kills: 50, combo: 20 });
  assert.deepEqual(r.records, { reach: true, combo: true, clear: false, chapters: [] });
  ({ best, stats } = r);
  r = mergeRun(best, stats, { chapter: 1, wave: 2, time: 60, kills: 10, combo: 5 });
  assert.deepEqual(r.records, { reach: false, combo: false, clear: false, chapters: [] });
  ({ best, stats } = r);
  r = mergeRun(best, stats, { chapter: 2, wave: 1, time: 700, kills: 500, combo: 80, chapterTimes: { 1: 650 } });
  assert.deepEqual(r.records, { reach: true, combo: true, clear: false, chapters: [1] });
  ({ best, stats } = r);
  r = mergeRun(best, stats, { chapter: 3, wave: 6, time: 2000, kills: 1500, combo: 60, chapterTimes: { 1: 700, 2: 1300, 3: 2000 }, win: true });
  assert.deepEqual(r.records, { reach: true, combo: false, clear: true, chapters: [2, 3] });
  ({ best, stats } = r);
  assert.deepEqual(best, { chapter: 3, wave: 6, chapterTimes: { '1': 650, '2': 1300, '3': 2000 }, clearTime: 2000, combo: 80 });
  assert.deepEqual(stats, { runs: 4, kills: 2060, clears: 1, playTime: 2880 });
  // 更快的通关
  r = mergeRun(best, stats, { chapter: 3, wave: 6, time: 1800, kills: 1, combo: 1, chapterTimes: { 3: 1800 }, win: true });
  assert.equal(r.records.clear, true);
  assert.equal(r.best.clearTime, 1800);
  assert.equal(r.stats.clears, 2);
});

test('cleanProfile 宽松模式不抛错，坏的整份也给出默认值', () => {
  assert.deepEqual(cleanProfile({}), defaultProfile());
  assert.equal(cleanProfile(null), null);
  assert.equal(cleanProfile({ unlocks: 3 }, true), null);
});
