// 本地存档（设计文档「存档」）：不要账号，进度存在浏览器的 localStorage 里，键名带版本号 fs.v1.*：
//   fs.v1.unlocks   解锁（JSON 字符串数组，如 ["demon-nezha", "wukong"]）——和首领分支的 save.ts 同一个键、同一个格式
//   fs.v1.best      最好成绩：打到第几章第几波、每章最快平定、最快通关、最高连斩
//   fs.v1.settings  设置：主音量、音效、音乐、是否显示伤害数字、字体主题（文楷 / 书法）
//   fs.v1.stats     累计统计：局数、斩数、通关次数、游玩时长
//   fs.v1.xiuwei    修为（局外成长，sim/xiuwei.ts）：攒下的道行、点亮了哪些节点
//   fs.v1.jie       劫数（难度，sim/jie.ts）：通关过的最高一劫（通关劫 N 解锁劫 N + 1）、上次选的劫数
//   fs.v1.codex     图鉴（codex.ts；记录点在 codex-track.ts）：见过的角色、法宝、道具、敌人、首领——第一次见到在第几章、
//                   拿到 / 斩敌 / 出战 / 击败了多少次、法宝炼到过的最高品阶
//   fs.v1.achieve   成就（achievements.ts）：达成了哪些、什么时候（id → Unix 秒；0 = 补记的旧进度）
// 每个键单独读写：一个键坏了只丢那一个键（读成默认值），不连累别的；localStorage 不可用（隐私模式、配额满）时不报错，
// 读到默认值，写不进去就只留在内存里。解锁每次都从存储里现读（首领分支的 save.ts 会直接写这个键），不缓存。
//
// 存档码（换设备、备份用）：整份存档 → JSON → LZW 压缩 → [格式版本][标志][CRC32][数据] → base64url，前面加 "FS1-"。
// 导入时任何一步不对（前缀、字符、长度、版本、校验和、解压、JSON、字段类型与范围）都整份拒绝并说明原因，
// 校验全部通过才一次写入各个键，不会把坏数据写进去。校验和里掺了一段固定的盐，只防手改，不是加密。
// 纯逻辑（编解码、校验、成绩合并）不依赖浏览器，单元测试见 profile.test.ts。
import { FONT_THEMES, type FontTheme } from './fonts.ts';
import { JIE_MAX } from '../sim/jie.ts';
import { XIUWEI, isLegacyId, isXiuweiId, litNodes, nodeState, spentOn, type XiuweiId } from '../sim/xiuwei-table.ts';

// ---------- 数据 ----------

export interface Best {
  /** 打到的最远一章（1 起；0 = 还没打过）。 */
  chapter: number;
  /** 那一章打到第几波（1..6）。 */
  wave: number;
  /** 每章最快平定：从开局到这一章平定时的用时（秒），键是章号。 */
  chapterTimes: Record<string, number>;
  /** 最快通关（全部章节平定）的用时（秒）；没通关过是 null。 */
  clearTime: number | null;
  /** 最高连斩。 */
  combo: number;
}

export interface Settings {
  /** 主音量 0..1（滑块的线性位置；音频那边平方后再换成增益）。 */
  master: number;
  /** 音效 0..1。 */
  sfx: number;
  /** 音乐 0..1。 */
  music: number;
  /** 是否显示伤害数字。 */
  damageNumbers: boolean;
  /** 字体主题：kai = 标题书法 + 正文文楷（默认），brush = 全部书法体（fonts.ts 的 FONT_THEMES）。 */
  fontTheme: FontTheme;
}

export interface Totals {
  /** 打过的局数（陨落、通关、中途回到标题都算一局）。 */
  runs: number;
  /** 累计斩敌。 */
  kills: number;
  /** 通关（全部章节平定）的次数。 */
  clears: number;
  /** 累计游玩时长（秒，只算局内）。 */
  playTime: number;
}

/** 修为（局外成长）：节点表、花费、加成在 sim/xiuwei.ts。 */
export interface Cultivation {
  /** 一共得过多少道行（花掉的不扣：剩下的 = dao − 点亮的节点的花费；重置就是把节点清空，全额退还）。 */
  dao: number;
  /** 点亮的节点（sim/xiuwei.ts 的 id，按依赖排好：前一节在后一节前面）。 */
  nodes: XiuweiId[];
}

/** 劫数（难度）的进度：通关（整局，第三章首领打赢）劫 N 解锁劫 N + 1（★ 先按整局记，不按章）。 */
export interface JieRecord {
  /** 通关过的最高一劫（0 = 还没通关过；能选的是劫一到劫 cleared + 1）。 */
  cleared: number;
  /** 上次选的劫数（选劫页、联机大厅默认停在它上面）。 */
  last: number;
}

/**
 * 图鉴的分类（codex.ts 的页签：角色 hero；法宝 weapon；道具 relic / elixir / charm；敌人 foe；首领 boss）。
 * 键是游戏里的 id（角色 HeroId、法宝 WeaponKind、灵物 RelicId、丹药 ElixirId、符箓 CharmId、敌人 EnemyKindName、首领模块的 kind）。
 */
export const CODEX_CATS = ['hero', 'weapon', 'relic', 'elixir', 'charm', 'foe', 'boss'] as const;
export type CodexCat = (typeof CODEX_CATS)[number];
/**
 * 一条记录：[第一次见到时在第几章（0 = 不知道 / 不适用：角色）, 次数, 法宝炼到过的最高品阶（1..4，只有法宝有这一位）]。
 * 次数：角色是出战的局数，法宝 / 道具是拿到的次数（买下、开局自带），敌人是自己斩的只数，首领是击败的次数。
 * 存成数组（不写字段名），存档码短一些。有这一条 = 见过（图鉴里点亮）。
 */
export type CodexEntry = [ch: number, n: number, tier?: number];
export type Codex = Record<CodexCat, Record<string, CodexEntry>>;

/** 成就：已达成的 id（achievements.ts 的表）→ 达成时的 Unix 秒（0 = 补记：成就系统上线之前就有的进度，不知道是哪天）。 */
export type Achieved = Record<string, number>;

export interface Profile {
  unlocks: string[];
  best: Best;
  settings: Settings;
  stats: Totals;
  xiuwei: Cultivation;
  jie: JieRecord;
  codex: Codex;
  achieve: Achieved;
}

/**
 * 存档里的结构版本（存档码的 JSON 里带着它；以后改结构就升到 2，并在解码时把 1 迁移过去）。
 * 只是多了一节（修为、劫数、图鉴都是这样加的）不算改结构、不升版本：旧存档码里没有这一节，读成空的照常导入；
 * 新的存档码给还没有这一节的旧版游戏导入，那一节被忽略，别的照常。
 */
export const PROFILE_VERSION = 1;

export const KEYS = {
  unlocks: 'fs.v1.unlocks',
  best: 'fs.v1.best',
  settings: 'fs.v1.settings',
  stats: 'fs.v1.stats',
  xiuwei: 'fs.v1.xiuwei',
  jie: 'fs.v1.jie',
  codex: 'fs.v1.codex',
  achieve: 'fs.v1.achieve',
  /** 看过的东西（开场过场这类「只自动放一次」的）：只记在这台设备上，不进存档码。 */
  seen: 'fs.v1.seen',
} as const;

export const DEFAULT_SETTINGS: Readonly<Settings> = { master: 0.8, sfx: 1, music: 1, damageNumbers: true, fontTheme: 'kai' };

export const defaultBest = (): Best => ({ chapter: 0, wave: 0, chapterTimes: {}, clearTime: null, combo: 0 });
export const defaultStats = (): Totals => ({ runs: 0, kills: 0, clears: 0, playTime: 0 });
export const defaultXiuwei = (): Cultivation => ({ dao: 0, nodes: [] });
export const defaultJie = (): JieRecord => ({ cleared: 0, last: 1 });
export const defaultCodex = (): Codex => ({ hero: {}, weapon: {}, relic: {}, elixir: {}, charm: {}, foe: {}, boss: {} });
export const defaultAchieve = (): Achieved => ({});
export const defaultProfile = (): Profile => ({
  unlocks: [],
  best: defaultBest(),
  settings: { ...DEFAULT_SETTINGS },
  stats: defaultStats(),
  xiuwei: defaultXiuwei(),
  jie: defaultJie(),
  codex: defaultCodex(),
  achieve: defaultAchieve(),
});

// ---------- 校验与清洗 ----------
// strict（导入存档码）：出现了的字段类型或范围不对就整份拒绝（抛 BadData）；缺的字段用默认值（兼容旧存档码）。
// 宽松（读本地存储）：坏字段换成默认值，能用多少用多少。

class BadData extends Error {}

const MAX_SECONDS = 1e7; // 约 115 天，再大就是坏数据
const MAX_COUNT = 1e9;
const ID_RE = /^[a-z0-9][a-z0-9.-]{0,31}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, lo: number, hi: number, def: number, strict: boolean, int = false): number {
  if (v === undefined) return def;
  const ok = typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v));
  if (ok) return v as number;
  if (strict) throw new BadData();
  return def;
}

function bool(v: unknown, def: boolean, strict: boolean): boolean {
  if (v === undefined) return def;
  if (typeof v === 'boolean') return v;
  if (strict) throw new BadData();
  return def;
}

const isFontTheme = (v: unknown): v is FontTheme => typeof v === 'string' && Object.hasOwn(FONT_THEMES, v);

function fontTheme(v: unknown, def: FontTheme, strict: boolean): FontTheme {
  if (v === undefined) return def; // 旧存档、旧存档码里没有这一项
  if (isFontTheme(v)) return v;
  if (strict) throw new BadData();
  return def;
}

function section(v: unknown, strict: boolean): Record<string, unknown> {
  if (v === undefined) return {};
  if (isObj(v)) return v;
  if (strict) throw new BadData();
  return {};
}

export function cleanUnlocks(v: unknown, strict = false): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    if (strict) throw new BadData();
    return [];
  }
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && ID_RE.test(x)) {
      if (!out.includes(x)) out.push(x);
    } else if (strict) throw new BadData();
  }
  if (out.length > 64) {
    if (strict) throw new BadData();
    out.length = 64;
  }
  return out;
}

export function cleanBest(v: unknown, strict = false): Best {
  const o = section(v, strict);
  const b = defaultBest();
  b.chapter = num(o.chapter, 0, 99, 0, strict, true);
  b.wave = num(o.wave, 0, 99, 0, strict, true);
  if (b.chapter === 0) b.wave = 0;
  b.combo = num(o.combo, 0, MAX_COUNT, 0, strict, true);
  if (o.clearTime === null || o.clearTime === undefined) b.clearTime = null;
  else b.clearTime = num(o.clearTime, 0.001, MAX_SECONDS, NaN, strict);
  if (Number.isNaN(b.clearTime)) b.clearTime = null;
  const ct = section(o.chapterTimes, strict);
  for (const [k, t] of Object.entries(ct)) {
    if (!/^[1-9][0-9]?$/.test(k)) {
      if (strict) throw new BadData();
      continue;
    }
    const s = num(t, 0.001, MAX_SECONDS, NaN, strict);
    if (!Number.isNaN(s)) b.chapterTimes[k] = s;
  }
  return b;
}

export function cleanSettings(v: unknown, strict = false): Settings {
  const o = section(v, strict);
  return {
    master: num(o.master, 0, 1, DEFAULT_SETTINGS.master, strict),
    sfx: num(o.sfx, 0, 1, DEFAULT_SETTINGS.sfx, strict),
    music: num(o.music, 0, 1, DEFAULT_SETTINGS.music, strict),
    damageNumbers: bool(o.damageNumbers, DEFAULT_SETTINGS.damageNumbers, strict),
    fontTheme: fontTheme(o.fontTheme, DEFAULT_SETTINGS.fontTheme, strict),
  };
}

export function cleanStats(v: unknown, strict = false): Totals {
  const o = section(v, strict);
  return {
    runs: num(o.runs, 0, MAX_COUNT, 0, strict, true),
    kills: num(o.kills, 0, MAX_COUNT, 0, strict, true),
    clears: num(o.clears, 0, MAX_COUNT, 0, strict, true),
    playTime: num(o.playTime, 0, MAX_SECONDS * 100, 0, strict),
  };
}

/**
 * 修为的清洗。strict：道行不是 0..上限的整数、节点里有不认识的 / 重复的 / 前置没点的、花的道行比攒的多，都拒绝。
 * 宽松：不认识的、前置不满足的丢掉；花的比攒的多就从最后点的那些开始退（排在后面的境界更高，从来不是前面的前置，退了不会断）。
 * 老存档（2026-11-11 的十节树，sim/xiuwei.ts 的 LEGACY）：老 id 换成新节点，新树里前置不满足的不点亮——道行总数不变，等于退还；
 * 这是迁移，不算坏数据，存档码里也照这样收（只要每一项都是认识的老 id 或新 id）。
 */
export function cleanXiuwei(v: unknown, strict = false): Cultivation {
  const o = section(v, strict);
  const dao = num(o.dao, 0, MAX_COUNT, 0, strict, true);
  if (o.nodes === undefined) return { dao, nodes: [] };
  if (!Array.isArray(o.nodes)) {
    if (strict) throw new BadData();
    return { dao, nodes: [] };
  }
  const nodes = litNodes(o.nodes);
  const legacy = o.nodes.some(isLegacyId);
  if (strict && !o.nodes.every((v) => isXiuweiId(v) || isLegacyId(v))) throw new BadData();
  if (strict && !legacy && (nodes.length !== o.nodes.length || spentOn(nodes) > dao)) throw new BadData();
  while (nodes.length && spentOn(nodes) > dao) nodes.pop();
  return { dao, nodes };
}

/** 劫数进度的清洗：cleared 0..5、last 1..5 的整数；宽松时坏的换成默认值。 */
export function cleanJie(v: unknown, strict = false): JieRecord {
  const o = section(v, strict);
  return { cleared: num(o.cleared, 0, JIE_MAX, 0, strict, true), last: num(o.last, 1, JIE_MAX, 1, strict, true) };
}

/** 图鉴里的 id：游戏里的 id 都是小写字母开头的英文（有的带下划线，如 orb_metal）。 */
const CODEX_ID_RE = /^[a-z][a-zA-Z0-9_.-]{0,31}$/;
/** 每一类最多记多少条（内容再扩也到不了；防坏数据把存档码撑大）。 */
const CODEX_MAX = 400;

const codexEntryOk = (e: unknown): e is CodexEntry =>
  Array.isArray(e) &&
  (e.length === 2 || e.length === 3) &&
  e.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0) &&
  e[0] <= 99 &&
  e[1] <= MAX_COUNT &&
  (e.length === 2 || e[2] <= 4);

/**
 * 图鉴的清洗。strict（导入存档码）：哪一条的 id 或数字不对就整份拒绝。宽松（读本地存储）：坏的那一条丢掉。
 * 不认识的 id 照留（别的分支 / 以后的版本加的内容，或者改了名的旧内容：图鉴页只列现在有的）；不认识的分类两种模式都忽略
 * （以后的版本多了一类，旧版导入时不拦着）。
 */
export function cleanCodex(v: unknown, strict = false): Codex {
  const o = section(v, strict);
  const c = defaultCodex();
  for (const cat of CODEX_CATS) {
    let n = 0;
    for (const [k, e] of Object.entries(section(o[cat], strict))) {
      if (!CODEX_ID_RE.test(k) || !codexEntryOk(e) || ++n > CODEX_MAX) {
        if (strict) throw new BadData();
        continue;
      }
      c[cat][k] = e.length === 3 ? [e[0], e[1], e[2]] : [e[0], e[1]];
    }
  }
  return c;
}

/** 图鉴里有没有这一条（见过没有）。 */
export const codexHas = (c: Codex, cat: CodexCat, id: string): boolean => Object.hasOwn(c[cat], id);

/** 图鉴的一条（没见过是 null）。 */
export function codexEntry(c: Codex, cat: CodexCat, id: string): { ch: number; n: number; tier: number } | null {
  if (!codexHas(c, cat, id)) return null;
  const [ch, n, tier = 0] = c[cat][id];
  return { ch, n, tier };
}

/** 图鉴一共点亮了多少条。 */
export const codexCount = (c: Codex): number => CODEX_CATS.reduce((s, cat) => s + Object.keys(c[cat]).length, 0);

/**
 * 把一段新记下的（delta：同样的结构；n 是这段时间新增的次数，ch 是这段时间里第一次见到时在第几章）并进图鉴（纯函数，返回新的）。
 * 已经有的：次数加上去（封顶），最高品阶取大的，第一次见到的章不变（原来不知道的才补上）；没有的：整条加进去。
 */
export function mergeCodex(base: Codex, delta: Codex): Codex {
  const out = defaultCodex();
  for (const cat of CODEX_CATS) {
    for (const [k, e] of Object.entries(base[cat])) out[cat][k] = [...e] as CodexEntry;
    for (const [k, d] of Object.entries(delta[cat])) {
      const cur = codexHas(out, cat, k) ? out[cat][k] : null;
      const ch = cur ? cur[0] || d[0] : d[0];
      const n = Math.min(MAX_COUNT, (cur?.[1] ?? 0) + d[1]);
      const tier = Math.max(cur?.[2] ?? 0, d[2] ?? 0);
      out[cat][k] = tier ? [ch, n, tier] : [ch, n];
    }
  }
  return out;
}

const ACH_ID_RE = /^[a-z][a-z0-9.-]{0,31}$/;
const ACH_MAX = 200;

/**
 * 成就：{ id: Unix 秒 }。不认识的 id 照留（以后的版本加的成就、别的分支的），成就页只列现在有的。
 * 时间是 0（补记）到 2100 年以内的整数秒；超过 ACH_MAX 条的、id 或时间不对的，宽松模式丢掉、严格模式整份拒绝。
 */
export function cleanAchieve(v: unknown, strict = false): Achieved {
  const out: Achieved = {};
  let n = 0;
  for (const [k, t] of Object.entries(section(v, strict))) {
    const ok = ACH_ID_RE.test(k) && typeof t === 'number' && Number.isInteger(t) && t >= 0 && t < 4.2e9 && ++n <= ACH_MAX;
    if (ok) out[k] = t as number;
    else if (strict) throw new BadData();
  }
  return out;
}

/** 整份存档的清洗。strict 时有坏字段就返回 null。 */
export function cleanProfile(v: unknown, strict = false): Profile | null {
  try {
    if (!isObj(v)) throw new BadData();
    return {
      unlocks: cleanUnlocks(v.unlocks, strict),
      best: cleanBest(v.best, strict),
      settings: cleanSettings(v.settings, strict),
      stats: cleanStats(v.stats, strict),
      xiuwei: cleanXiuwei(v.xiuwei, strict),
      jie: cleanJie(v.jie, strict),
      codex: cleanCodex(v.codex, strict),
      achieve: cleanAchieve(v.achieve, strict),
    };
  } catch (e) {
    if (e instanceof BadData) return null;
    throw e;
  }
}

// ---------- 存档码：编码 ----------

const CODE_VERSION = 1;
const FLAG_LZW = 1;
const SALT = 'fengshen-survivors:huixiang';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const LZW_MAX = 4096; // 码表上限（12 位）；存档只有几百字节，到不了
/** 第 k 个码（从 1 数）用几位：编码器发出它时码表里已有 256 + k - 1 个串（封顶 4096），码值不会超过这个数减一。 */
const lzwWidth = (k: number) => {
  const next = Math.min(LZW_MAX, 256 + k - 1);
  return Math.max(9, 32 - Math.clz32(next - 1));
};

function writeVarint(out: number[], n: number) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
}

/** LZW 压缩（按字节；开头是原文长度的变长整数，之后是高位在前的码流）。 */
export function lzwCompress(input: Uint8Array): Uint8Array {
  const head: number[] = [];
  writeVarint(head, input.length);
  if (!input.length) return Uint8Array.from(head);
  const dict = new Map<number, number>();
  let next = 256;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  let k = 0;
  const emit = (code: number) => {
    const w = lzwWidth(++k);
    acc = (acc << w) | code;
    bits += w;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  };
  let w = input[0];
  for (let i = 1; i < input.length; i++) {
    const c = input[i];
    const key = w * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) {
      w = hit;
      continue;
    }
    emit(w);
    if (next < LZW_MAX) dict.set(key, next++);
    w = c;
  }
  emit(w);
  if (bits > 0) bytes.push((acc << (8 - bits)) & 0xff);
  return Uint8Array.from([...head, ...bytes]);
}

/** LZW 解压；数据不对就抛错。 */
export function lzwDecompress(data: Uint8Array): Uint8Array {
  let pos = 0;
  let len = 0;
  for (let shift = 0; ; shift += 7) {
    if (pos >= data.length || shift > 28) throw new Error('lzw: bad length');
    const b = data[pos++];
    len |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
  }
  if (len > 1 << 20) throw new Error('lzw: too long');
  const out = new Uint8Array(len);
  if (!len) return out;
  const dict: Uint8Array[] = [];
  for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i));
  let acc = 0;
  let bits = 0;
  let k = 0;
  const read = () => {
    const w = lzwWidth(++k);
    while (bits < w) {
      if (pos >= data.length) throw new Error('lzw: truncated');
      acc = ((acc << 8) | data[pos++]) >>> 0;
      bits += 8;
    }
    bits -= w;
    const code = (acc >>> bits) & ((1 << w) - 1);
    acc &= (1 << bits) - 1;
    return code;
  };
  let o = 0;
  const put = (s: Uint8Array) => {
    if (o + s.length > len) throw new Error('lzw: overflow');
    out.set(s, o);
    o += s.length;
  };
  let prev = dict[read()];
  if (!prev) throw new Error('lzw: bad code');
  put(prev);
  while (o < len) {
    const code = read();
    let cur: Uint8Array;
    if (code < dict.length) cur = dict[code];
    else if (code === dict.length && dict.length < LZW_MAX) {
      cur = new Uint8Array(prev.length + 1);
      cur.set(prev);
      cur[prev.length] = prev[0];
    } else throw new Error('lzw: bad code');
    put(cur);
    if (dict.length < LZW_MAX) {
      const e = new Uint8Array(prev.length + 1);
      e.set(prev);
      e[prev.length] = cur[0];
      dict.push(e);
    }
    prev = cur;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (left > 1 ? B64[(n >> 6) & 63] : '') + (left > 2 ? B64[n & 63] : '');
  }
  return s;
}

export function fromBase64url(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  if (acc !== 0) return null; // 末尾多出来的位必须是 0（不然就是被改过）
  return Uint8Array.from(out);
}

const PREFIX_RE = /^FS(\d+)-/i;

/** 整份存档 → 存档码。 */
export function encodeProfile(p: Profile): string {
  const json = JSON.stringify({ v: PROFILE_VERSION, unlocks: p.unlocks, best: p.best, settings: p.settings, stats: p.stats, xiuwei: p.xiuwei, jie: p.jie, codex: p.codex, achieve: p.achieve });
  const raw = enc.encode(json);
  const packed = lzwCompress(raw);
  const useLzw = packed.length < raw.length;
  const data = useLzw ? packed : raw;
  const head = Uint8Array.of(CODE_VERSION, useLzw ? FLAG_LZW : 0);
  const crc = crc32(enc.encode(SALT), head, data);
  const bytes = new Uint8Array(6 + data.length);
  bytes.set(head, 0);
  bytes[2] = crc >>> 24;
  bytes[3] = (crc >>> 16) & 0xff;
  bytes[4] = (crc >>> 8) & 0xff;
  bytes[5] = crc & 0xff;
  bytes.set(data, 6);
  return `FS${CODE_VERSION}-${base64url(bytes)}`;
}

export type DecodeResult = { ok: true; profile: Profile } | { ok: false; error: string };

/** 存档码 → 整份存档（不碰存储）。出错时 error 是给玩家看的一句话。 */
export function decodeProfile(code: string): DecodeResult {
  const s = code.replace(/\s+/g, ''); // 复制时可能夹进换行和空格
  if (!s) return { ok: false, error: '先把存档码粘贴进来' };
  const m = PREFIX_RE.exec(s);
  if (!m) return { ok: false, error: '这不是封神幸存者的存档码（应以 FS1- 开头）' };
  const ver = Number(m[1]);
  if (ver > CODE_VERSION) return { ok: false, error: '这是更新版本的游戏导出的存档码，请先刷新游戏再导入' };
  if (ver < 1) return { ok: false, error: '这不是封神幸存者的存档码' };
  const bytes = fromBase64url(s.slice(m[0].length));
  const broken = { ok: false as const, error: '存档码不完整或被改动过（校验没有通过），没有导入' };
  if (!bytes || bytes.length < 7) return broken;
  if (bytes[0] !== ver) return broken;
  const flags = bytes[1];
  if (flags & ~FLAG_LZW) return broken;
  const data = bytes.subarray(6);
  const crc = ((bytes[2] << 24) | (bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) >>> 0;
  if (crc32(enc.encode(SALT), bytes.subarray(0, 2), data) !== crc) return broken;
  let obj: unknown;
  try {
    const raw = flags & FLAG_LZW ? lzwDecompress(data) : data;
    obj = JSON.parse(dec.decode(raw));
  } catch {
    return broken;
  }
  if (!isObj(obj) || typeof obj.v !== 'number' || !Number.isInteger(obj.v) || obj.v < 1) return { ok: false, error: '存档码里的数据不对，没有导入' };
  if (obj.v > PROFILE_VERSION) return { ok: false, error: '这是更新版本的游戏导出的存档码，请先刷新游戏再导入' };
  const p = cleanProfile(obj, true);
  if (!p) return { ok: false, error: '存档码里的数据不对，没有导入' };
  return { ok: true, profile: p };
}

// ---------- 成绩 ----------

export interface RunResult {
  /** 打到的章（1 起）。 */
  chapter: number;
  /** 那一章打到第几波（1..6）。 */
  wave: number;
  /** 本局用时（秒）。 */
  time: number;
  kills: number;
  /** 本局最高连斩。 */
  combo: number;
  /** 本局平定的章节：章号 → 从开局到平定时的用时（秒）。 */
  chapterTimes?: Record<number, number>;
  /** 全部章节平定。 */
  win?: boolean;
  /** 这一局的劫数（1..5；不给是劫一）。通关时解锁下一劫。 */
  jie?: number;
  /** 这一局得的道行（sim/xiuwei.daoReward 算好；不给是 0）。 */
  dao?: number;
}

export interface RunRecords {
  /** 打得比以前都远。 */
  reach: boolean;
  combo: boolean;
  /** 刷新了最快通关。 */
  clear: boolean;
  /** 刷新了哪几章的最快平定。 */
  chapters: number[];
}

const reachKey = (chapter: number, wave: number) => chapter * 100 + wave;

/** 把一局的结果并进成绩与累计统计（纯函数，返回新的 best / stats 和破了哪些纪录）。 */
export function mergeRun(best: Best, stats: Totals, r: RunResult): { best: Best; stats: Totals; records: RunRecords } {
  const b: Best = { ...best, chapterTimes: { ...best.chapterTimes } };
  const s: Totals = { ...stats };
  const records: RunRecords = { reach: false, combo: false, clear: false, chapters: [] };
  const chapter = Math.max(0, Math.min(99, Math.floor(r.chapter)));
  const wave = Math.max(0, Math.min(99, Math.floor(r.wave)));
  if (chapter > 0 && reachKey(chapter, wave) > reachKey(b.chapter, b.wave)) {
    b.chapter = chapter;
    b.wave = wave;
    records.reach = true;
  }
  const combo = Math.max(0, Math.floor(r.combo));
  if (combo > b.combo) {
    b.combo = combo;
    records.combo = combo > 0;
  }
  for (const [k, t] of Object.entries(r.chapterTimes ?? {})) {
    if (!(t > 0 && t < MAX_SECONDS) || !/^[1-9][0-9]?$/.test(k)) continue;
    const old = b.chapterTimes[k];
    if (old === undefined || t < old) {
      b.chapterTimes[k] = t;
      records.chapters.push(Number(k));
    }
  }
  if (r.win && r.time > 0 && r.time < MAX_SECONDS) {
    s.clears++;
    if (b.clearTime === null || r.time < b.clearTime) {
      b.clearTime = r.time;
      records.clear = true;
    }
  }
  s.runs++;
  s.kills += Math.max(0, Math.floor(r.kills));
  s.playTime += Math.max(0, Math.min(MAX_SECONDS, r.time));
  return { best: b, stats: s, records };
}

// ---------- 存储 ----------

/** localStorage 的最小接口（测试里换成内存实现）。 */
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const memory = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

let store: StorageLike | null = null;
function storage(): StorageLike {
  if (store) return store;
  try {
    const ls = globalThis.localStorage;
    const probe = 'fs.v1.__probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    store = ls;
  } catch {
    store = memoryStorage; // 隐私模式等：这一页里照常用，关掉就没了
  }
  return store;
}

/** 测试用：换掉存储（传 null 恢复默认）。 */
export function useStorage(s: StorageLike | null) {
  store = s;
  cachedSettings = null;
}

function readKey(k: string): unknown {
  try {
    const v = storage().getItem(k);
    return v === null ? undefined : JSON.parse(v);
  } catch {
    return undefined; // 坏 JSON：当作没存
  }
}

function writeKey(k: string, v: unknown): boolean {
  try {
    storage().setItem(k, JSON.stringify(v));
    return true;
  } catch {
    memory.set(k, JSON.stringify(v)); // 存不进去也不影响这一局
    return false;
  }
}

function removeKey(k: string) {
  try {
    storage().removeItem(k);
  } catch {
    /* 存不进去的时候也删不掉：无妨 */
  }
  memory.delete(k);
}

/** 读出整份存档（坏字段换成默认值）。 */
export function loadProfile(): Profile {
  return {
    unlocks: cleanUnlocks(readKey(KEYS.unlocks)),
    best: cleanBest(readKey(KEYS.best)),
    settings: getSettings(),
    stats: cleanStats(readKey(KEYS.stats)),
    xiuwei: loadXiuwei(),
    jie: loadJie(),
    codex: loadCodex(),
    achieve: loadAchieved(),
  };
}

// 解锁：和 save.ts 同样的语义

export function unlocks(): string[] {
  return cleanUnlocks(readKey(KEYS.unlocks));
}

export function isUnlocked(id: string): boolean {
  return unlocks().includes(id);
}

const unlockListeners = new Set<(id: string) => void>();

/** 解锁一个角色；返回 true 表示这次是新解锁的（新解锁的通知订阅者：成就那边据此补上对应的成就，achievements.ts）。 */
export function unlock(id: string): boolean {
  if (!ID_RE.test(id)) return false;
  const u = unlocks();
  if (u.includes(id)) return false;
  u.push(id);
  writeKey(KEYS.unlocks, u);
  for (const fn of unlockListeners) fn(id);
  return true;
}

/** 订阅「新解锁了一个角色」；返回取消订阅的函数。 */
export function onUnlock(fn: (id: string) => void): () => void {
  unlockListeners.add(fn);
  return () => unlockListeners.delete(fn);
}

/** 隐藏角色孙悟空的解锁 id（和 sim/catalog.ts 的 HIDDEN.wukong.unlock 同一个；这里不引角色表，免得标题页的首包把整张角色表带进来）。 */
export const WUKONG_UNLOCK = 'wukong';

/**
 * 标题页天上那道金色裂缝该不该出现（game/wukong-rift.ts）：通关过一次（第三章首领倒下，任意劫）、孙悟空还没解锁。
 * 「通关过」认三处记录里的任何一处（通关次数、最快通关、劫数进度），导入的旧存档码只带了其中一样也算。
 */
export function riftDue(p: Pick<Profile, 'unlocks' | 'best' | 'stats' | 'jie'>): boolean {
  const cleared = p.stats.clears > 0 || p.best.clearTime !== null || p.jie.cleared > 0;
  return cleared && !p.unlocks.includes(WUKONG_UNLOCK);
}

// 看过的东西：开场过场这类只自动放一次的。只记在这台设备上（不进存档码：换了设备再看一遍开场无妨）

function seenList(): string[] {
  const v = readKey(KEYS.seen);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)) : [];
}

/** 这台设备上看过没有。 */
export function hasSeen(id: string): boolean {
  return seenList().includes(id);
}

/** 记下看过了；返回 true 表示这次是第一次。 */
export function markSeen(id: string): boolean {
  if (!ID_RE.test(id)) return false;
  const s = seenList();
  if (s.includes(id)) return false;
  s.push(id);
  writeKey(KEYS.seen, s);
  return true;
}

// 修为：攒下的道行、点亮的节点（sim/xiuwei.ts）。每次都从存储里现读（标题页、修为页、结算都在改它），不缓存

export function loadXiuwei(): Cultivation {
  return cleanXiuwei(readKey(KEYS.xiuwei));
}

/** 还剩多少道行没花。 */
export const freeDao = (x: Cultivation) => Math.max(0, x.dao - spentOn(x.nodes));

/** 点亮一个节点：前置都满足（同路线前一节、境界门槛、二选一没点另一边）、道行够才点（返回 true）；已经点过、点不了的返回 false，存档不动。 */
export function lightNode(id: XiuweiId): boolean {
  const x = loadXiuwei();
  if (!Object.hasOwn(XIUWEI, id) || nodeState(x.nodes, id, freeDao(x)) !== 'ok') return false;
  writeKey(KEYS.xiuwei, { dao: x.dao, nodes: litNodes([...x.nodes, id]) });
  return true;
}

/** 重置修为：熄掉所有节点，花掉的道行全额退还（道行的总数不变）。返回退了多少。 */
export function resetXiuwei(): number {
  const x = loadXiuwei();
  const back = spentOn(x.nodes);
  if (x.nodes.length) writeKey(KEYS.xiuwei, { dao: x.dao, nodes: [] });
  return back;
}

// 劫数：通关过的最高一劫、上次选的劫数

export function loadJie(): JieRecord {
  return cleanJie(readKey(KEYS.jie));
}

/** 能选到第几劫（劫一一直能选；通关劫 N 解锁劫 N + 1，最多劫五）。 */
export const unlockedJie = (j: JieRecord = loadJie()) => Math.min(JIE_MAX, j.cleared + 1);

/** 记下这一次选的劫数（选劫页、大厅下次默认停在它上面）。 */
export function setLastJie(n: number) {
  const j = loadJie();
  const last = Math.max(1, Math.min(unlockedJie(j), Math.floor(n) || 1));
  if (last !== j.last) writeKey(KEYS.jie, { ...j, last });
}

/** 一局打完之后的劫数进度（纯函数）：通关了劫 N，cleared 至少是 N；unlocked 是这一局新解锁的那一劫（0 = 没有）。 */
export function jieAfterRun(j: JieRecord, r: RunResult): { jie: JieRecord; unlocked: number } {
  const n = Math.max(1, Math.min(JIE_MAX, Math.floor(r.jie ?? 1)));
  if (!r.win || n <= j.cleared) return { jie: j, unlocked: 0 };
  const before = unlockedJie(j);
  const jie = { ...j, cleared: n };
  const after = unlockedJie(jie);
  return { jie, unlocked: after > before ? after : 0 };
}

// 图鉴：每次都从存储里现读（局里的记录点隔一会儿并进来一次，图鉴页打开时读）

export function loadCodex(): Codex {
  return cleanCodex(readKey(KEYS.codex));
}

/** 把一段新记下的并进存档里的图鉴（读出现在的、合上、写回：别处改过存档——比如刚导入了存档码——也不会被盖掉）。 */
export function addCodex(delta: Codex) {
  if (!codexCount(delta)) return;
  writeKey(KEYS.codex, mergeCodex(loadCodex(), delta));
}

// 成就：每次都从存储里现读（局里、标题页、导入存档码都会改它）。判定和奖励在 achievements.ts，这里只管存

export function loadAchieved(): Achieved {
  return cleanAchieve(readKey(KEYS.achieve));
}

/** 存档里有没有成就这一节（没有 = 成就系统上线后第一次打开：旧进度补记的成就不弹窗）。 */
export const hasAchieveKey = (): boolean => readKey(KEYS.achieve) !== undefined;

/** 记下达成了这些成就（at：Unix 秒，0 = 补记）；返回这次新达成的（已经有的不动、不改时间）。没有新的也会把这一节写上（补记过一次的标记）。 */
export function addAchieved(ids: readonly string[], at: number): string[] {
  const a = loadAchieved();
  const fresh = ids.filter((id, i) => ACH_ID_RE.test(id) && !Object.hasOwn(a, id) && ids.indexOf(id) === i);
  for (const id of fresh) a[id] = Math.max(0, Math.floor(at));
  if (fresh.length || !hasAchieveKey()) writeKey(KEYS.achieve, a);
  return fresh;
}

// 设置：缓存在内存里（局内每次命中都要问「显示不显示伤害数字」），改了就通知订阅者

let cachedSettings: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return (cachedSettings ??= cleanSettings(readKey(KEYS.settings)));
}

/** 改设置：立即写进存档并通知订阅者（音量夹在 0..1；类型不对、不认识的值保持原值）。 */
export function updateSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings();
  const vol = (v: unknown, old: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : old);
  const s = cleanSettings({
    master: vol(patch.master, cur.master),
    sfx: vol(patch.sfx, cur.sfx),
    music: vol(patch.music, cur.music),
    damageNumbers: typeof patch.damageNumbers === 'boolean' ? patch.damageNumbers : cur.damageNumbers,
    fontTheme: isFontTheme(patch.fontTheme) ? patch.fontTheme : cur.fontTheme,
  });
  cachedSettings = s;
  writeKey(KEYS.settings, s);
  for (const fn of listeners) fn(s);
  return s;
}

/** 订阅设置的变化；返回取消订阅的函数。 */
export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 别的标签页改了存档：设置跟着变
if (typeof addEventListener === 'function' && typeof window !== 'undefined')
  addEventListener('storage', (e) => {
    if (e.key === KEYS.settings || e.key === null) {
      cachedSettings = null;
      const s = getSettings();
      for (const fn of listeners) fn(s);
    }
  });

/** 一局结束时调用（陨落 / 通关 / 中途回到标题）：并进最好成绩与累计统计，返回破了哪些纪录。 */
export function recordRun(r: RunResult): RunRecords & { dao: number; unlockedJie: number } {
  const { best, stats, records } = mergeRun(cleanBest(readKey(KEYS.best)), cleanStats(readKey(KEYS.stats)), r);
  writeKey(KEYS.best, best);
  writeKey(KEYS.stats, stats);
  // 道行、劫数：这一局得的道行加上去；通关了就解锁下一劫
  const dao = Math.max(0, Math.floor(r.dao ?? 0));
  if (dao) {
    const x = loadXiuwei();
    writeKey(KEYS.xiuwei, { ...x, dao: Math.min(MAX_COUNT, x.dao + dao) });
  }
  const j0 = loadJie();
  const j = jieAfterRun(j0, r);
  if (j.jie.cleared !== j0.cleared) writeKey(KEYS.jie, j.jie);
  return { ...records, dao, unlockedJie: j.unlocked };
}

/** 导出本机存档的存档码。 */
export function exportCode(): string {
  return encodeProfile(loadProfile());
}

/** 导入存档码：校验全部通过才整份覆盖本机存档（四个键一起写）；不通过时本机存档原样不动。 */
export function importCode(code: string): DecodeResult {
  const r = decodeProfile(code);
  if (!r.ok) return r;
  const p = r.profile;
  writeKey(KEYS.unlocks, p.unlocks);
  writeKey(KEYS.best, p.best);
  writeKey(KEYS.stats, p.stats);
  writeKey(KEYS.xiuwei, p.xiuwei);
  writeKey(KEYS.jie, p.jie);
  writeKey(KEYS.codex, p.codex);
  // 没有成就这一节的（旧版导出的存档码）：清掉这一节，下次补记旧进度时不弹窗（和第一次用上成就一样）
  if (Object.keys(p.achieve).length) writeKey(KEYS.achieve, p.achieve);
  else removeKey(KEYS.achieve);
  cachedSettings = null;
  writeKey(KEYS.settings, p.settings);
  const s = getSettings();
  for (const fn of listeners) fn(s);
  return r;
}

/** 给玩家看的一句话概况（导入前对照用）。 */
export function describeProfile(p: Profile, chapterName: (n: number) => string = (n) => `第 ${n} 章`): string {
  const parts: string[] = [];
  parts.push(p.best.chapter ? `最远 ${chapterName(p.best.chapter)} 第 ${p.best.wave} 波` : '还没有战绩');
  if (p.best.clearTime !== null) parts.push(`最快通关 ${formatTime(p.best.clearTime)}`);
  if (p.best.combo) parts.push(`最高连斩 ${p.best.combo}`);
  parts.push(`${p.stats.runs} 局 · 斩 ${p.stats.kills}`);
  if (p.unlocks.length) parts.push(`解锁 ${p.unlocks.length} 名角色`);
  if (p.xiuwei.dao) parts.push(`道行 ${p.xiuwei.dao}（点亮 ${p.xiuwei.nodes.length} 节修为）`);
  if (p.jie.cleared) parts.push(`劫数解锁到劫${'一二三四五'[Math.min(JIE_MAX, p.jie.cleared + 1) - 1]}`);
  const seen = codexCount(p.codex);
  if (seen) parts.push(`图鉴 ${seen} 条`);
  const ach = Object.keys(p.achieve).length;
  if (ach) parts.push(`成就 ${ach} 项`);
  return parts.join(' · ');
}

/** 秒 → 「12 分 05 秒」。 */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m ? `${m} 分 ${String(s % 60).padStart(2, '0')} 秒` : `${s} 秒`;
}
