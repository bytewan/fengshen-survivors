// 联机：房主把世界状态发给其他人时的编码（纯数据 + 差量）。
//
// 做法（docs/netcode.md「状态同步」）：
//   房主每次广播前，把世界转成一份「纯数据」（plain）：去掉随机数、Set / Map、表现层不读的内部字段；数字按精度取整
//   （坐标一位小数、别的两位）；px / py / pa（上一帧的位置、角度）不发，镜像那边自己补。
//   然后和上一次发出去的那份比（diff），只发变了的部分：
//     - 对象：只发变了的键；删掉的键列在 '-' 里；
//     - 带 id 的对象数组（敌人、乾坤圈、灵石、区域……）：按 id 对，'#' 是新增 / 变了的（[id, 差]），'~' 是没了的 id；
//       每帧都在动的位置单独打包成一串整数 '@'：[id, x×10, y×10, id, x×10, y×10, …]（省掉每只的键名和括号，敌人多时省一半）；
//     - 前面掉几个、后面接几个的数组（风火轮的火痕）：{ '<': 前面去掉几个, '+': 后面接上的 }；
//     - 别的数组（商店货架、法宝列表……）：变了就整个换掉。
//   其他人收到后按顺序打到自己的「镜像世界」上（apply）。WebSocket 是可靠、有序的，中继也按顺序转发，所以差量链不会断；
//   新进来的、重连的、出错的，向房主要一份整的（keyframe = 从空对象开始的差）。
// 这一层不认识游戏规则：只要模拟层加的字段是纯数据，自动就同步过去（别的分支加字段不用改这里）。
// 表现层确定不读、又每帧都在变的内部字段列在 SKIP 里，省带宽；表现层以后要读它们，从 SKIP 里删掉就行。

/** 能直接 JSON 的纯数据。 */
export type Plain = null | boolean | number | string | Plain[] | { [k: string]: Plain };
export type PlainObj = { [k: string]: Plain };

/** 按一位小数取整的键（坐标、速度：480×270 的像素画面，0.1 像素足够）。别的数字取两位小数。 */
const COARSE = new Set(['x', 'y', 'x2', 'y2', 'x0', 'y0', 'x1', 'y1', 'ox', 'oy', 'sx', 'sy', 'tx', 'ty', 'fx', 'fy', 'vx', 'vy', 'boltX', 'boltY']);

/**
 * 不发的字段（按所在的集合分）：表现层不读、只有模拟自己用的运行时状态。'*' 对所有对象都生效：
 * px / py / pa 是「上一帧」的值，镜像在每次打差之前自己补（见 apply 里的 shiftPrev）。
 */
export const SKIP: Record<string, string[]> = {
  '*': ['px', 'py', 'pa'],
  '': ['rng', 'spawnAcc', 'nextId'],
  // （bleedBy 不能跳：化血神刀的血丝按「谁割的」连，fx-new.ts 要读）
  enemies: ['dmgMul', 'kx', 'ky', 'cd', 'burnAcc', 'burnBy', 'vuln', 'vulnT', 'fireVuln', 'fireVulnT', 'invuln', 'bleedAcc', 'bleedTick', 'zoneT', 'zoneHit', 'rush'],
  pet: ['tx', 'ty', 'ux', 'uy', 'ox', 'oy', 'target', 'seekT', 'wrapT', 'hits', 'ph', 'cd'],
  // 法宝的冷却、连击、回血结算：每帧都在变，表现层不读（不跳过的话每个人的整个法宝列表每次都要重发）
  weapons: ['cd', 'burst', 'burstT', 'aim', 'heal', 'healT'],
  rings: ['hits', 'grind', 'hoverTick', 'life', 'vx', 'vy'],
  knives: ['hit', 'again', 'turn', 'life'],
  orbs: ['life'], // 鬼火的速度留着：其他人开 ?bot 时机器人要读它躲鬼火
  gems: ['vx', 'vy'],
  hazards: ['hits'],
  boss: ['queue'],
  echo: ['queue'], // 遭遇战的槽里现在也是首领的状态（首领池，sim/bosspool.ts）
};
const SKIP_SET: Record<string, Set<string>> = Object.fromEntries(Object.entries(SKIP).map(([k, v]) => [k, new Set(v)]));
const ALL = SKIP_SET['*'];

const BIG = 1e9;
function num(v: number, coarse: boolean): number {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 0 : v > 0 ? BIG : -BIG;
  if (Number.isInteger(v)) return v === 0 ? 0 : v; // 不要 -0（JSON 会写成 0，两边就对不上了）
  const r = coarse ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 转成纯数据。ctx 是所在集合的名字（数组 / 对象在父对象里的键），决定跳过哪些字段。
 * Set、Map、函数、undefined 一律不要。
 */
export function plain(v: unknown, ctx = '', key = ''): Plain | undefined {
  if (v === null) return null;
  switch (typeof v) {
    case 'number':
      return num(v, COARSE.has(key));
    case 'string':
    case 'boolean':
      return v;
    case 'object': {
      if (v instanceof Set || v instanceof Map) return undefined;
      if (Array.isArray(v)) {
        const out: Plain[] = new Array(v.length);
        for (let i = 0; i < v.length; i++) out[i] = plain(v[i], ctx, key) ?? null;
        return out;
      }
      const skip = SKIP_SET[ctx];
      const out: PlainObj = {};
      for (const k in v as Record<string, unknown>) {
        if (ALL.has(k) || skip?.has(k)) continue;
        const p = plain((v as Record<string, unknown>)[k], k, k);
        if (p !== undefined) out[k] = p;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** 整个世界 → 纯数据（顶层的集合名是 ''）。 */
export function plainWorld(w: object): PlainObj {
  const skip = SKIP_SET[''];
  const out: PlainObj = {};
  for (const k in w as Record<string, unknown>) {
    if (skip.has(k)) continue;
    const p = plain((w as Record<string, unknown>)[k], k, k);
    if (p !== undefined) out[k] = p;
  }
  return out;
}

function same(a: Plain, b: Plain): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in b) || !same(a[k], (b as PlainObj)[k])) return false;
  return true;
}

/** 带 id 的对象数组（敌人、圈、灵石……）：按 id 对着比。空数组也算（这样从有到无、从无到有都走按 id 的路）。 */
const entityArray = (v: Plain): v is PlainObj[] => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'number');

/**
 * 对象数组按 id 的差：'#' 新增或变了的 [id, 差]，'~' 没了的 id，'@' 打包的位置（[id, x×10, y×10, …]，见文件头）。
 * 没有变化返回 undefined。
 */
function diffEntities(a: PlainObj[], b: PlainObj[]): PlainObj | undefined {
  const old = new Map<number, PlainObj>();
  for (const x of a) old.set(x.id as number, x);
  const ups: Plain[] = [];
  const xy: number[] = [];
  for (const x of b) {
    const id = x.id as number;
    const o = old.get(id);
    if (o) {
      old.delete(id);
      const d = diffObj(o, x);
      if (!d) continue;
      // 位置挪到打包的那一串里（x、y 都是取过一位小数的数，×10 正好是整数）
      if (('x' in d || 'y' in d) && typeof x.x === 'number' && typeof x.y === 'number') {
        xy.push(id, Math.round(x.x * 10), Math.round(x.y * 10));
        delete d.x;
        delete d.y;
        if (!Object.keys(d).length) continue;
      }
      ups.push([id, d]);
    } else ups.push([id, x]);
  }
  if (!ups.length && !old.size && !xy.length) return undefined;
  const out: PlainObj = {};
  if (ups.length) out['#'] = ups;
  if (xy.length) out['@'] = xy;
  if (old.size) out['~'] = [...old.keys()];
  return out;
}

/**
 * 前面掉了几个、后面接了几个的数组（风火轮的火痕：新的点接在后面，过了寿命的从前面收掉）：
 * 返回 { '<': 前面去掉几个, '+': 后面接上的 }；对不上这个样子（或者不划算）返回 undefined。
 */
function diffTail(a: Plain[], b: Plain[]): PlainObj | undefined {
  if (a.length < 4 || !b.length) return undefined;
  for (let k = 0; k <= a.length; k++) {
    const keep = a.length - k;
    if (keep > b.length) continue;
    if (keep && !same(a[k], b[0])) continue;
    let ok = true;
    for (let i = 1; i < keep && ok; i++) ok = same(a[k + i], b[i]);
    if (!ok) continue;
    if (keep < b.length / 2) return undefined; // 大半都是新的：直接整个换掉
    return { '<': k, '+': b.slice(keep) };
  }
  return undefined;
}

/** 两个对象的差（b 相对 a）。没有变化返回 undefined。 */
export function diffObj(a: PlainObj, b: PlainObj): PlainObj | undefined {
  let out: PlainObj | undefined;
  for (const k in b) {
    const av = a[k];
    const bv = b[k];
    if (av === bv) continue;
    let d: Plain | undefined;
    if (isObj(bv) && isObj(av)) {
      d = diffObj(av, bv);
      if (d === undefined) continue;
    } else if (Array.isArray(bv) && Array.isArray(av) && entityArray(bv) && entityArray(av) && (bv.length || av.length)) {
      d = diffEntities(av, bv);
      if (d === undefined) continue;
    } else if (Array.isArray(bv) && entityArray(bv) && bv.length && !(k in a)) {
      d = diffEntities([], bv); // 第一次出现的对象数组也按 id 发，镜像那边建成同一种结构
    } else {
      if (same(av, bv)) continue;
      d = (Array.isArray(av) && Array.isArray(bv) && diffTail(av, bv)) || bv;
    }
    (out ??= {})[k] = d as Plain;
  }
  for (const k in a)
    if (!(k in b)) {
      out ??= {};
      ((out['-'] ??= []) as Plain[]).push(k);
    }
  return out;
}

/** 整份（keyframe）：就是从空对象开始的差。 */
export const fullPatch = (b: PlainObj): PlainObj => diffObj({}, b) ?? {};

/** 独立快照解码：只复制发生变化的分支，不修改 ACK 基线或添加渲染字段。 */
export function decodePatch(base: PlainObj, patch: PlainObj): PlainObj {
  const out = { ...base };
  for (const k in patch) {
    if (k === '-') { for (const key of patch[k] as string[]) delete out[key]; continue; }
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const v = patch[k];
    if (!isObj(v)) { out[k] = v; continue; }
    if ('#' in v || '~' in v || '@' in v) {
      const gone = new Set((v['~'] as number[] | undefined) ?? []);
      const arr = (Array.isArray(base[k]) ? base[k] as PlainObj[] : []).filter(o => !gone.has(o.id as number));
      const indices = new Map(arr.map((o, i) => [o.id as number, i]));
      const xy = (v['@'] as number[] | undefined) ?? [];
      for (let i = 0; i + 2 < xy.length; i += 3) {
        const index = indices.get(xy[i]);
        if (index !== undefined) arr[index] = { ...arr[index], x: xy[i + 1] / 10, y: xy[i + 2] / 10 };
      }
      for (const [id, p] of (v['#'] as [number, PlainObj][] | undefined) ?? []) {
        const index = indices.get(id);
        if (index !== undefined) arr[index] = decodePatch(arr[index], p);
        else { indices.set(id, arr.length); arr.push(decodePatch({}, p)); }
      }
      out[k] = arr;
    } else if ('+' in v && '<' in v) {
      out[k] = (Array.isArray(base[k]) ? base[k] as Plain[] : []).slice(v['<'] as number).concat(v['+'] as Plain[]);
    } else out[k] = decodePatch(isObj(base[k]) ? base[k] as PlainObj : {}, v);
  }
  return out;
}

// ---------- 镜像那边：打差 ----------

type Obj = Record<string, unknown>;

/** 新对象：位置的「上一帧」先等于这一帧（不然第一帧会从 0 插值过来）。 */
function seedPrev(o: Obj) {
  if (typeof o.x === 'number' && typeof o.y === 'number') {
    o.px = o.x;
    o.py = o.y;
  }
  if (typeof o.a === 'number') o.pa = o.a;
}

/** 把差打到 target 上（就地改）。返回 target。 */
export function apply(target: Obj, p: PlainObj): Obj {
  for (const k in p) {
    if (k === '-') {
      for (const r of p[k] as string[]) delete target[r];
      continue;
    }
    const v = p[k];
    if (Array.isArray(v)) {
      // 整个换掉：对象数组按下标接上原来的「上一帧」位置（首领的残影这种没 id 的，也能平滑地插值）
      const old = target[k];
      target[k] = v;
      for (let i = 0; i < v.length; i++) {
        const n = v[i];
        if (!isObj(n)) continue;
        const o = Array.isArray(old) ? old[i] : undefined;
        if (isObj(o) && typeof o.x === 'number' && typeof o.y === 'number' && typeof n.x === 'number') {
          (n as Obj).px = o.x;
          (n as Obj).py = o.y;
          if (typeof o.a === 'number') (n as Obj).pa = o.a;
        } else seedPrev(n as Obj);
        seedDeep(n as Obj);
      }
    } else if (isObj(v)) {
      if ('#' in v || '~' in v || '@' in v) applyEntities(target, k, v);
      else if ('+' in v && '<' in v) {
        // 前面去掉几个、后面接上几个
        const old = Array.isArray(target[k]) ? (target[k] as Plain[]) : [];
        const add = v['+'] as Plain[];
        for (const n of add) if (isObj(n)) seedPrev(n as Obj);
        target[k] = old.slice(v['<'] as number).concat(add);
      }
      else {
        let o = target[k];
        const fresh = !isObj(o);
        if (fresh) target[k] = o = {};
        apply(o as Obj, v);
        if (fresh) {
          seedPrev(o as Obj);
          seedDeep(o as Obj);
        }
      }
    } else target[k] = v;
  }
  return target;
}

/** 新建出来的对象里面嵌着的对象（人物的宠物、首领的危险物……）也补上「上一帧」。 */
function seedDeep(o: Obj) {
  for (const k in o) {
    const v = o[k];
    if (Array.isArray(v)) {
      for (const x of v)
        if (isObj(x)) {
          if (!('px' in x)) seedPrev(x as Obj);
          seedDeep(x as Obj);
        }
    } else if (isObj(v)) {
      if (!('px' in v)) seedPrev(v as Obj);
      seedDeep(v as Obj);
    }
  }
}

function applyEntities(target: Obj, k: string, p: PlainObj) {
  let arr = target[k] as Obj[] | undefined;
  if (!Array.isArray(arr)) target[k] = arr = [];
  const gone = p['~'] as number[] | undefined;
  if (gone?.length) {
    const g = new Set(gone);
    target[k] = arr = arr.filter((x) => !g.has(x.id as number));
  }
  const ups = p['#'] as [number, PlainObj][] | undefined;
  const xy = p['@'] as number[] | undefined;
  if (!ups?.length && !xy?.length) return;
  const byId = new Map<number, Obj>();
  for (const x of arr) byId.set(x.id as number, x);
  if (xy)
    for (let i = 0; i + 2 < xy.length; i += 3) {
      const o = byId.get(xy[i]);
      if (!o) continue;
      o.x = xy[i + 1] / 10;
      o.y = xy[i + 2] / 10;
    }
  if (!ups?.length) return;
  for (const [id, d] of ups) {
    const o = byId.get(id);
    if (o) apply(o, d);
    else {
      const n = apply({}, d);
      seedPrev(n);
      seedDeep(n);
      arr.push(n);
      byId.set(id, n);
    }
  }
}

/**
 * 打下一份差之前：把现在的位置记成「上一帧」（px = x、py = y、pa = a），表现层在两份状态之间插值（alpha）。
 * 整个镜像走一遍（每秒约 15 次，几千个字段，很快）。
 */
export function shiftPrev(o: unknown) {
  if (Array.isArray(o)) {
    for (const x of o) shiftPrev(x);
    return;
  }
  if (!isObj(o)) return;
  if (typeof o.x === 'number' && typeof o.y === 'number') {
    o.px = o.x;
    o.py = o.y;
  }
  if (typeof o.a === 'number') o.pa = o.a;
  for (const k in o) {
    const v = o[k];
    if (typeof v === 'object' && v !== null) shiftPrev(v);
  }
}
