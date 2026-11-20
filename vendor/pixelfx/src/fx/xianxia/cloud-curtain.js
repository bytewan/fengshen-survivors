// 云海合拢（修仙版的换章转场）：参照 pixelfx 的 transitions/burn-away、pixel-dissolve（MIT，https://github.com/patch-gg/pixelfx）新做。
// 「先算好每个像素什么时候被盖住、每帧只比一下」的做法和填满整屏的写法参照了 transitions/_lib.js。
// 为什么新做（封神幸存者，2026-11-10）：
// - 库里的转场都是把画面盖成黑的（烧成黑、碎块填黑、玻璃、快门……），而且是 320×180。游戏的背景不要黑，画面是 480×270。
// - 修仙版：两岸云海从左右翻涌着合拢，云头是一串圆滚滚的卷云（每团上沿受光、下沿压一道缟色的影），
//   合拢以后整屏是月白的云（换章的标题由游戏自己写在上面），停一会儿，再从中间往两边散开，最后一帧是空的。
//   云头一边走一边上下滚动；合拢前、散开时云头前面飘着几缕真半透明的薄云。2.4 秒：0.95 秒合拢，停到 1.4 秒，2.3 秒散尽。
import { fit, clamp, smooth, ease, rand, TAU } from "../../core/index.js";
import { gp } from "./_lib.js";

export const meta = {
  name: "云海合拢 Cloud sea curtain",
  desc: "A chapter turns: two banks of cloud sea roll in from the sides, round curling cloud heads lit on top and shaded below, close over the screen in moon-white, hold, then part again.",
  tags: ["transition", "screen", "cloud", "wipe", "chapter", "xianxia", "one-shot"],
  size: [480, 270],
  origin: [0, 0],
  duration: 2.4,
  loop: false,
  fps: 30,
  bg: "sky",
  options: { palette: gp("ijwW"), seed: 2 },
};

const W = 480, H = 270, D = meta.duration, CLOSE = 0.95, HOLD = 1.4, GONE = 2.3, RMAX = 34, BAND = 6;

// 云头：沿着前沿一串圆，半径 18–34，前后错开；每一行的前沿取这些圆在这一行最靠前的那一点。
// 一岸云有三层：最前面一层是云头，后面两层只在云身里画出一道道卷云的边（上沿受光、下沿压影），云才有一团团的体积
const PUFFS = new Map();
function puffsOf(seed, side, layer) {
  const key = (seed * 2 + side) * 4 + layer;
  if (PUFFS.has(key)) return PUFFS.get(key);
  const list = [];
  for (let y = -10 - layer * 13, k = 0; y < H + 20; k++) {
    const r = (18 + rand(seed, k, side, layer) * 16) * (1 + layer * 0.15);
    list.push({ y: y + r * 0.6, r, dx: rand(seed, k, side + 5, layer) * 10, ph: rand(seed, k, side + 9, layer) * TAU });
    y += r * (0.95 + rand(seed, k, side + 3, layer) * 0.4);
  }
  PUFFS.set(key, list);
  return list;
}
const LAYER_BACK = [0, 44, 92]; // 每一层比云头往后退多少

// 盖住了多少：0（全露）→ 1（全盖）→ 0
const cover = (t) => (t < CLOSE ? ease.inOutSine(t / CLOSE) : t < HOLD ? 1 : 1 - ease.inOutSine(clamp((t - HOLD) / (GONE - HOLD))));

// 这一行里某一层最靠前的那一团：返回 [前沿的 x, 那一团, 圆心 x, 圆心 y]
function frontOf(puffs, F, y, t) {
  let best = null, bx = -Infinity, bc = 0, by = 0;
  for (const q of puffs) {
    const cy = q.y + Math.sin(t * 2.2 + q.ph) * 2, dy = y + 0.5 - cy;
    if (Math.abs(dy) >= q.r) continue;
    const cx = F - RMAX + q.dx, x = cx + Math.sqrt(q.r * q.r - dy * dy);
    if (x > bx) (bx = x), (best = q), (bc = cx), (by = cy);
  }
  return [bx, best, bc, by];
}

// 一团云的边上那一截的颜色：光从左上来，上沿一像素亮、下沿两三像素压成缟、银鼠
function shadeAt(C, x, y, q, cx, cy) {
  const lx = x + 0.5 - cx, ly = y + 0.5 - cy, ny = ly / q.r, nx = lx / q.r, edge = q.r - Math.hypot(lx, ly);
  return ny > 0.55 && edge < 3 ? C[0] : ny > 0.25 && edge < 4.5 ? C[1] : edge < 1.6 && ny < -0.15 + nx * 0.3 ? C[3] : -1;
}

// 云身里的卷云纹：只算一次的一张贴图（按「离云头多远」u 和行 y 存色阶的第几档），后面两层的云团从后往前一团团填上月白、
// 再勾朝前那半圈的边，前面的团把后面的边盖掉——云纹才是一层压一层的，不是一圈圈交叠的圆。
// 每帧只按云头走到哪儿把它平移着抄上去，和平涂一样快。
const TW = W / 2 + RMAX + 130, TEX = new Map();
function texOf(seed, side) {
  const key = seed * 2 + side;
  if (TEX.has(key)) return TEX.get(key);
  const tex = new Uint8Array(TW * H).fill(2);
  for (let i = LAYER_BACK.length - 1; i >= 1; i--)
    for (const q of puffsOf(seed, side, i)) {
      const uc = LAYER_BACK[i] + RMAX - q.dx, cy = q.y, r = q.r;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
        for (let u = Math.max(0, Math.floor(uc - r)); u <= Math.min(TW - 1, Math.ceil(uc + r)); u++) if ((u + 0.5 - uc) ** 2 + (y + 0.5 - cy) ** 2 < r * r) tex[y * TW + u] = 2;
      // 朝前（u 变小的方向）的那半圈：上头细、往下渐粗，底下最外一圈压成银鼠
      for (let a = -1.75; a <= 2.1; a += 0.45 / r) {
        const thick = a < 0.2 ? 1 : 2;
        for (let j = 0; j < thick; j++) {
          const u = Math.floor(uc - Math.cos(a) * (r - j)), y = Math.floor(cy + Math.sin(a) * (r - j));
          if (y >= 0 && y < H && u >= 0 && u < TW) tex[y * TW + u] = a > 0.9 && j === 0 ? 0 : 1;
        }
      }
    }
  TEX.set(key, tex);
  return tex;
}

export function draw(p, t, o) {
  const C = fit(o.palette, 4), k = cover(t);
  if (k <= 0) return;
  // 云头前面飘着的几缕薄云（合拢、散开的时候）。先画：云身画上去会把压在它上面的那部分盖掉，
  // 薄云就只剩云头外面那一截（真半透明），不会和云身混出调色板外的颜色
  for (const side of [0, 1]) {
    const F = k * (W / 2 + RMAX + 6) - 6, X = (x) => (side ? W - 1 - x : x);
    if (k < 0.98)
      for (let i = 0; i < 7; i++) {
        const yy = ((i + 0.5) / 7) * H + Math.sin(t * 1.5 + i) * 6, xx = F + 4 + rand(o.seed, i, side + 11) * 18 + Math.sin(t * 2 + i * 2) * 3;
        const rad = 7 + rand(o.seed, i, side + 13) * 6;
        if (xx > W / 2 + 40 || xx < rad + 1 || yy < rad || yy > H - rad) continue;
        p.disc(X(xx), yy, rad, C[2], 0.32 * (1 - k * 0.6));
      }
  }
  for (const side of [0, 1]) {
    const F = k * (W / 2 + RMAX + 6) - 6, tex = texOf(o.seed, side); // F：云头最前一点离这一侧屏幕边多远
    const X = (x) => (side ? W - 1 - x : x);
    for (let y = 0; y < H; y++) {
      const [bx, best, bc, by] = frontOf(puffsOf(o.seed, side, 0), F, y, t);
      if (!best || bx <= 0) continue;
      const front = Math.min(W, bx), solid = Math.max(0, Math.floor(front - BAND)), row = y * TW;
      // 云身：月白，上面是卷云纹（离云头 u 远处的那一格）
      for (let x = 0; x < solid; x++) {
        const u = Math.floor(F - x);
        p.px(X(x), y, C[u >= 0 && u < TW ? tex[row + u] : 2]);
      }
      // 云头那一截：按这一团的圆算明暗
      for (let x = solid; x < front; x++) {
        const c = shadeAt(C, x, y, best, bc, by);
        p.px(X(x), y, c === -1 ? C[2] : c);
      }
    }
  }
  // 不用收色：画上去的都是色阶里的颜色（薄云是半透明的，收色也不管它），省下每帧扫一遍整屏
}
