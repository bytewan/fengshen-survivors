// 修仙版特效共用的东西（文件名以 _ 开头：不是特效，库的工具和游戏的特效清单都会跳过它）。
// 封神幸存者，2026-11-10。上游没有这个文件；更新上游时保留整个 xianxia/ 目录。
//
// 这里放三类东西：
// 1. 游戏调色板的副本（GP）和按字符拼色阶的 gp()：改造过的特效，默认颜色一律取调色板里的色。
// 2. 两个「后处理」：snapper（收色：把按比例压暗、混出来的调色板外的颜色收回色阶里）和 rim（描边：浅色地面上亮色的形状要有一圈深色的边才看得清）。
// 3. 修仙的小物件：云气（祥云的卷头）、莲瓣、黄符、灵石、元宝、叶片、花瓣，各个特效拼着用。

import { hex, clamp, TAU, WHITE } from "../../core/index.js";

/**
 * 游戏调色板：src/art/palette.ts 的副本（字符 → 颜色）。库是独立的 JS，不能反过来 import 游戏的 TypeScript，所以抄一份；
 * 改调色板时两边一起改。地面专用的 q u x z 不进特效，这里不收。
 */
export const GP = {
  k: "#1a1520", d: "#2e2433", g: "#4a3b4a", h: "#6b5a62", i: "#9a8a86", j: "#c9bcae", w: "#f2e8d5", // 玄 乌 黛 苍 银鼠 缟 月白
  R: "#5c1a1b", r: "#9c2a22", e: "#d9452b", o: "#f2814a", // 殷 朱 朱砂 橘
  B: "#6b3d1e", b: "#b06a28", y: "#e0a83a", Y: "#f7dc7a", // 赭 琥珀 藤黄 缃
  S: "#8a4f3c", s: "#d08a64", t: "#f2c49b", // 檀 绛肤 肉色亮
  N: "#1d2b4a", n: "#2f5373", c: "#3f8a9e", C: "#7cc4c4", // 靛 黛蓝 石青 天青
  G: "#1f3b2c", v: "#3a6b43", l: "#6fa35a", L: "#b8d67a", // 墨绿 松 石绿 葱黄
  P: "#4b2a4f", p: "#8a4a7a", m: "#d47aa0", // 紫棠 胭脂紫 桃红
  W: "#ffffff", f: "#ffe9a8", // 闪光 灵光
};
/** 按调色板字符拼一条色阶（十六进制字符串），如 gp("BbyYfW")。和 src/render/pixelfx-xianxia.ts 的 ramp() 是一回事。 */
export const gp = (chars) => [...chars].map((c) => {
  if (!GP[c]) throw new Error(`调色板里没有「${c}」`);
  return GP[c];
});
/** 整个调色板（颜色数值），给 snapper 用。 */
export const GAME = Object.values(GP).map(hex);

/** 俯视 3/4：地面上的圆压扁成这个比例的椭圆（游戏里的阵法、霜花、地裂用的是 0.55–0.62）。 */
export const SY = 0.58;

/**
 * 收色。库的粒子有不少颜色是「按比例压暗」算出来的（火星的暗尾、碎屑的阴影、星光的尖），火焰和烟还有写死的色阶，
 * 这些都不在游戏的调色板里。snapper(色阶, 色阶, …) 返回一个函数 snap(p)：把画布上不透明、又不在这些色阶里的颜色，
 * 换成色阶里最接近的一个。在 draw / drawBack 的最后调一次。半透明的像素（烟、雾，要和地面混）不动。
 * 参数可以是色阶数组（十六进制或颜色数值）、单个颜色，或一个 Uint32Array（比如 o.actor.pixels：人物自己的颜色原样保留）。
 */
export function snapper(...ramps) {
  const allowed = [], seen = new Set(), map = new Map();
  const add = (c) => {
    if (!c) return;
    c = (hex(c) | 0xff000000) >>> 0;
    if (!seen.has(c)) (seen.add(c), allowed.push(c));
  };
  for (const r of ramps) {
    if (r == null) continue;
    if (typeof r === "number" || typeof r === "string") add(r);
    else for (const c of r) add(c);
  }
  add(WHITE);
  const nearest = (c) => {
    const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    let best = c, bd = Infinity;
    for (const a of allowed) {
      const dr = r - (a & 255), dg = g - ((a >>> 8) & 255), db = b - ((a >>> 16) & 255);
      // 「红均值」距离：比直接的 RGB 距离更贴近人眼
      const rm = (r + (a & 255)) / 2, d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bd) (bd = d), (best = a);
    }
    return best;
  };
  return (p) => {
    const C = p.C;
    for (let i = 0, n = C.length; i < n; i++) {
      const c = C[i];
      if (c >>> 24 !== 255 || seen.has(c)) continue;
      let m = map.get(c);
      if (m === undefined) map.set(c, (m = nearest(c)));
      C[i] = m;
    }
  };
}

const SNAPS = new WeakMap();
/**
 * 纯函数式的特效（只导出 draw(p, t, o)，没有 create）每帧拿到的是同一个选项对象 o：按它缓存一个 snapper，
 * 免得每帧重建。用法：snapOf(o, 色阶…)(p)。
 */
export function snapOf(o, ...ramps) {
  let s = SNAPS.get(o);
  if (!s) SNAPS.set(o, (s = snapper(...ramps)));
  return s;
}

/**
 * 描边：局部坐标的方框 [x0, x1] × [y0, y1] 里，给已经画上的不透明像素外面补一圈颜色 c（只补空着的格子）。
 * 亮色的星芒、刀光在浅色的仙台地面上会发飘，补一圈色阶里的深色就立住了。先画形状、调 rim、再画火星粒子，粒子就不会被描。
 * a 小于 1 时按有序抖动只描一部分（快消失的那几帧用）。
 */
export function rim(p, x0, y0, x1, y1, c, a = 1) {
  let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
  for (let k = 0; k < 4; k++) {
    const x = k & 1 ? x1 : x0, y = k & 2 ? y1 : y0, sx = p.toX(x, y), sy = p.toY(x, y);
    if (sx < ax) ax = sx; if (sx > bx) bx = sx; if (sy < ay) ay = sy; if (sy > by) by = sy;
  }
  const w = p.w, h = p.h, C = p.C, cu = hex(c) >>> 0;
  const X0 = Math.max(0, Math.floor(ax) - p.ox), X1 = Math.min(w - 1, Math.ceil(bx) - p.ox), Y0 = Math.max(0, Math.floor(ay) - p.oy), Y1 = Math.min(h - 1, Math.ceil(by) - p.oy);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && C[y * w + x] >>> 24 === 255 && C[y * w + x] !== cu;
  const hits = [];
  for (let y = Y0; y <= Y1; y++)
    for (let x = X0; x <= X1; x++)
      if (!(C[y * w + x] >>> 24) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) hits.push(x, y);
  for (let i = 0; i < hits.length; i += 2) p.put(hits[i] + p.ox, hits[i + 1] + p.oy, c, a);
}

/** 把一组「字符画」行变成 { rows, w, h }，配合 stamp 用。 */
export const art = (rows) => ({ rows, w: Math.max(...rows.map((r) => r.length)), h: rows.length });

/**
 * 盖一张字符画：每个字符查 pal（字符 → 颜色；默认查游戏调色板 GP），"." 和空格是空的。(x, y) 是左上角。
 * o: { a 透明度（抖动）, flip 左右镜像, tint 整张换成一个颜色 }。
 */
const STAMP_CACHE = new Map();
export function stamp(p, pic, x, y, o = {}) {
  const pal = o.pal ?? GP, a = o.a ?? 1;
  x = Math.round(x);
  y = Math.round(y);
  for (let r = 0; r < pic.rows.length; r++) {
    const row = pic.rows[r];
    for (let q = 0; q < row.length; q++) {
      const ch = row[q];
      if (ch === "." || ch === " ") continue;
      let c = o.tint;
      if (c === undefined) {
        const v = pal[ch];
        if (v === undefined) continue;
        c = typeof v === "number" ? v : STAMP_CACHE.get(v) ?? (STAMP_CACHE.set(v, hex(v)), STAMP_CACHE.get(v));
      }
      p.dot(x + (o.flip ? pic.w - 1 - q : q), y + r, c, a);
    }
  }
}

export { clamp, TAU };
