// 整局快照：把一个 World 存成纯数据（能 JSON.stringify），再原样恢复成 World。
// 用处：联机时房主每波开打前存一份、发给所有人（房主掉线迁移时，新房主从「这一波开始时的存档」重开这一波）；
// 中途加入的人拿一份初始状态；以后的存档、回放。
// 恢复出来的世界和原来的逐项相同：之后喂同样的输入，跑出来的状态和事件和不中断直接跑的一模一样（snapshot.test.ts 逐帧核对）。
//
// 做法是按结构通用地走一遍（不按字段一个个抄），别的线以后往 World 里加字段不用回来改这里，只要守住两条：
// 1. 里面只有纯数据：数字、字符串、布尔、null、数组、普通对象，外加 Set / Map（下面会转）。函数、类的实例存不了，碰到就抛错、报出路径。
//    唯一的例外是随机数 w.rng（带 next 方法）：只存它的内部状态，恢复时重建。
// 2. 模拟只从 World 里读状态：模块里的临时变量（core.ts 的空间网格、pet.ts 的临时坐标）每次用之前都重算，不跨帧带东西。
//    测试里每一帧都把空间网格搅乱再跑，查的就是这一条。
// 同一个对象挂在两处（例：五火七禽扇「五火」一圈五道火浪共用一份「打过谁」）也照样存：第一次碰到时记成 { $def: 编号, v: ... }，
// 之后再碰到记成 { $ref: 编号 }，恢复后还是同一个对象（连成环也行）。
//
// JSON 表示不了的值换成带标记的小对象：Set → { $set: [...] }，Map → { $map: [[键, 值], ...] }，
// -0 / NaN / ±Infinity → { $: '-0' | 'NaN' | 'Inf' | '-Inf' }（JSON 会把 -0 写成 0；用 atan2 算方向时 ±0 的结果不同，所以要保住），
// 数组里的 undefined → { $: 'u' }；对象里值为 undefined 的键直接不存（读出来一样是 undefined）。
// 小数原样存：JS 把数字转成字符串用的是「最短、读回来逐位相同」的写法，JSON.parse 读回来是同一个数。
// 快照不含配置表（config.ts / catalog.ts 的常量）：恢复的一方必须跑同一版本的代码。
//
// 大小（JSON 字节数；种子 42 机器人打整局、每半秒量一次，见 snapshot.test.ts 文件头）：
// 单人刚开波约 2.4 KB、商店约 2.5 KB、首领战约 5.5 KB、波中中位约 21 KB（最大约 62 KB，gzip 后 14 KB）；
// 四个人刚开波约 8.3 KB、波中中位约 56 KB（最大约 110 KB，gzip 后 23 KB）。房主迁移用的是刚开波那一份。
import { createRng } from './rng.ts';
import type { Phase, World } from './world.ts';

/** 快照格式的版本：编码规则或 World 的结构不兼容地改了就加一；restore 遇到对不上的版本直接报错，不硬读。 */
export const SNAPSHOT_VERSION = 1;

/** JSON 能直接表示的值。 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** 一整局的存档：纯数据，JSON.stringify / JSON.parse 来回一趟不丢东西。 */
export interface WorldSnapshot {
  v: number; // 格式版本（SNAPSHOT_VERSION）
  // 下面三个是冗余的摘要：不解包就看得出是哪一刻的存档（restore 不读它们）
  tick: number;
  wave: number;
  phase: Phase;
  rng: number; // 随机数的内部状态（rng.ts 里 mulberry32 的 state）
  world: Json; // World 除随机数以外的全部字段，按文件头的规则编码（world.rng 的位置上存 null）
}

const U: Json = { $: 'u' };

/** 走一遍，找出挂在不止一处的对象（这些要按 $def / $ref 存）。 */
function sharedObjects(root: object): Set<object> {
  const seen = new Set<object>();
  const multi = new Set<object>();
  const walk = (v: unknown) => {
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) {
      multi.add(v);
      return;
    }
    seen.add(v);
    if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(k);
        walk(x);
      }
    } else if (v instanceof Set || Array.isArray(v)) {
      for (const x of v) walk(x);
    } else {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) walk(o[k]);
    }
  };
  walk(root);
  return multi;
}

const pathText = (path: (string | number)[]) => 'w' + path.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('');

/**
 * 编码整个世界。sorted：对象的键按字母序走、按字母序写（只看内容、不看字段先后的「规范写法」，算指纹用）；
 * 不排序时键保持原来的先后，恢复出来的对象和原来的一模一样。
 */
function encodeWorld(w: World, sorted: boolean): Json {
  const root = { ...w, rng: null };
  const multi = sharedObjects(root);
  const ids = new Map<object, number>();
  const path: (string | number)[] = [];

  const enc = (v: unknown): Json | undefined => {
    switch (typeof v) {
      case 'number':
        if (Number.isFinite(v)) return Object.is(v, -0) ? { $: '-0' } : v;
        return { $: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' };
      case 'string':
      case 'boolean':
        return v;
      case 'undefined':
        return undefined;
      case 'object':
        break;
      default:
        throw new Error(`快照存不了 ${pathText(path)}：是 ${typeof v}`);
    }
    if (v === null) return null;
    if (multi.has(v)) {
      const id = ids.get(v);
      if (id !== undefined) return { $ref: id };
      const nid = ids.size;
      ids.set(v, nid); // 先登记再编里面：连成环时里面碰到自己就是 $ref
      return { $def: nid, v: body(v) };
    }
    return body(v);
  };

  /** 数组、Set、Map 里的一项：undefined 也要占住位置。 */
  const item = (x: unknown, k: string | number): Json => {
    path.push(k);
    const e = enc(x);
    path.pop();
    return e === undefined ? U : e;
  };

  const body = (v: object): Json => {
    if (Array.isArray(v)) {
      const out: Json[] = new Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = item(v[i], i);
      return out;
    }
    if (v instanceof Set) {
      const out: Json[] = [];
      for (const x of v) out.push(item(x, out.length));
      return { $set: out };
    }
    if (v instanceof Map) {
      const out: Json[] = [];
      for (const [k, x] of v) out.push([item(k, `键${out.length}`), item(x, `值${out.length}`)]);
      return { $map: out };
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error(`快照存不了 ${pathText(path)}：是 ${proto?.constructor?.name ?? '类'} 的实例`);
    const out: { [k: string]: Json } = {};
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (sorted) keys.sort();
    for (const k of keys) {
      path.push(k);
      const x = enc(o[k]);
      path.pop();
      if (x !== undefined) out[k] = x;
    }
    return out;
  };

  return enc(root) as Json;
}

/** 解码：$def 先建好容器、登记，再填里面（这样里面的 $ref 能指回它自己）。 */
function decodeWorld(v: Json): unknown {
  const defs: unknown[] = [];
  const dec = (v: Json): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return build(v, -1);
    const keys = Object.keys(v);
    if (keys.length === 1) {
      switch (keys[0]) {
        case '$':
          switch (v.$) {
            case '-0':
              return -0;
            case 'NaN':
              return NaN;
            case 'Inf':
              return Infinity;
            case '-Inf':
              return -Infinity;
            case 'u':
              return undefined;
          }
          throw new Error(`快照里有认不得的标记 ${JSON.stringify(v)}`);
        case '$ref': {
          const id = v.$ref as number;
          if (!(id in defs)) throw new Error(`快照里的 $ref ${id} 指向还没出现过的对象`);
          return defs[id];
        }
      }
    } else if (keys.length === 2 && '$def' in v && 'v' in v) return build(v.v, v.$def as number);
    return build(v, -1);
  };
  const build = (b: Json, id: number): unknown => {
    if (Array.isArray(b)) {
      const out: unknown[] = [];
      if (id >= 0) defs[id] = out;
      for (const x of b) out.push(dec(x));
      return out;
    }
    const o = b as { [k: string]: Json };
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === '$set') {
      const out = new Set<unknown>();
      if (id >= 0) defs[id] = out;
      for (const x of o.$set as Json[]) out.add(dec(x));
      return out;
    }
    if (keys.length === 1 && keys[0] === '$map') {
      const out = new Map<unknown, unknown>();
      if (id >= 0) defs[id] = out;
      for (const [k, x] of o.$map as [Json, Json][]) out.set(dec(k), dec(x));
      return out;
    }
    const out: Record<string, unknown> = {};
    if (id >= 0) defs[id] = out;
    for (const k of keys) out[k] = dec(o[k]);
    return out;
  };
  return dec(v);
}

/** 存一份整局的快照。纯数据、和 w 不共用任何对象（之后改 w 不影响它）。 */
export function snapshot(w: World): WorldSnapshot {
  return { v: SNAPSHOT_VERSION, tick: w.tick, wave: w.wave, phase: w.phase, rng: w.rng.state, world: encodeWorld(w, false) };
}

/** 从快照恢复出一个新的 World（每次调用都是新的一份，和快照、和别的恢复出来的世界都不共用对象）。 */
export function restore(s: WorldSnapshot): World {
  if (s.v !== SNAPSHOT_VERSION) throw new Error(`快照的格式版本是 ${s.v}，这份代码读的是 ${SNAPSHOT_VERSION}`);
  const w = decodeWorld(s.world) as World;
  const rng = createRng(0);
  rng.state = s.rng >>> 0;
  w.rng = rng;
  return w;
}

/** 深拷贝一个世界（= restore(snapshot(w))）：测试、机器人试跑「如果这样走会怎样」时用。 */
export const cloneWorld = (w: World): World => restore(snapshot(w));

/** 世界的「规范写法」：键按字母排序的 JSON 文本，只看内容、不看字段的先后（随机数的状态也在里面）。两个世界逐项相同 ⇔ 文本相同。 */
export const canonicalText = (w: World): string => JSON.stringify({ rng: w.rng.state, world: encodeWorld(w, true) });

/**
 * 世界的指纹（规范写法的 FNV-1a 32 位，8 位十六进制）。联机时可以拿它对一对两边是不是同一个状态
 * （例：房主发出存档时带上指纹，收到的人 restore 之后自己算一遍）。
 */
export function worldHash(w: World): string {
  const text = canonicalText(w);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 查 World 里哪些对象挂在不止一处（诊断用：快照照样存得下，这里只是列出来）。返回「后碰到的路径 = 先碰到的路径」。
 */
export function findShared(w: World): string[] {
  const seen = new Map<object, string>();
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || typeof v !== 'object') return;
    const prev = seen.get(v);
    if (prev !== undefined) {
      out.push(`${path} = ${prev}`);
      return;
    }
    seen.set(v, path);
    if (v instanceof Map) {
      let i = 0;
      for (const [k, x] of v) {
        walk(k, `${path}.键${i}`);
        walk(x, `${path}.值${i++}`);
      }
      return;
    }
    if (v instanceof Set) {
      let i = 0;
      for (const x of v) walk(x, `${path}{${i++}}`);
      return;
    }
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) walk(o[k], Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`);
  };
  walk({ ...w, rng: null }, 'w');
  return out;
}
