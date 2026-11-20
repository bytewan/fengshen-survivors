// 定风珠的旋风（修仙版 · 龙卷）：改自 pixelfx 的 nature/tornado（MIT，https://github.com/patch-gg/pixelfx）。
// 改了什么（封神幸存者，2026-11-11；用户：「定风珠有旋风就行……pixelfx 就有很好的旋风效果，为什么不用？」
// 「不容易做到美观可以适当加大一点尺寸，一定要精致」）：
// - 尺寸：原作漏斗高 112、顶上半径四十多、画布 196×168；游戏里人物约 32 像素高，龙卷按约 1.3 个人高排：漏斗高 height
//   （默认 40，品阶 34–42），脚约 0.08 倍高、腰约 0.17 倍、顶上约 0.38 倍（width 整体放宽），连顶上的定风珠离地不过约 50。画布 96×72。
// - 柱身画实：原作是暗背景上一柱半透明的风加 58 条 1 像素细线，缩小了放在浅色的仙台、黄土地上几乎看不见。
//   现在柱身是不透明的：左边受光（色阶最亮的两档）、右边背光（深两档），一行行按不同的速度错着转的风纹，左右外沿压一道深边；
//   顶上看得见漏斗口（一个压扁的椭圆：远处的内壁、中间的深洞、近处一道亮的口沿），定风珠就悬在口上。
// - 风带十几条（约高度的三分之一）：1 像素的风线绕着漏斗往上转，头亮（少数头上一点白、粗两像素）、往尾巴淡，
//   下面压一道暗线（亮的柱身上才看得出），两成是暗的风线；后半圈被柱身挡住。
// - 漏斗挂在定风珠下面：原作的顶在天上的云里、摆得最厉害；这里顶是定风珠托着的，不摆，往下蛇行，脚也跟着晃。
// - 配色只用游戏调色板：青白的风（凡、灵）、青风（仙品「定风」）、天青（器灵「定海」）；顶上翻滚的乌云和闪电只在器灵「风雷」有
//   （storm: 1，一团团灰青的软云、淡金的电）。其余几档口沿上只有几缕细风绕着。
// - 不要光：去掉原作罩着漏斗的一层淡光、脚下的冷光（地上的一团光）、风带头上的辉光；风雷闪电的光收到半径 9。
// - 叶子、碎石按场景收量（debris，默认 10，原作 24），从地上 14–22 像素外被卷进来，绕着漏斗往上旋、从顶上甩出去，离风眼不过约 27；
//   脚下的扬尘收在 17 像素内；原作贴地扫过的几道弧线不要（用户嫌「旋转的线」画蛇添足）。
// - 分两层画（part + split，游戏里用）：'back' 是离地 split 像素以下的那一截（漏斗的下半截、脚下后半圈的扬尘碎屑），和角色一起按前后排；
//   'front' 是 split 以上的（漏斗上半截、漏斗口、顶上的风云）和前半圈的扬尘碎屑，盖在所有角色上面——卷进风眼的一群敌人挤在漏斗脚下，
//   头顶上立着一根清楚的龙卷；wrap > 0 时下半截前半圈的风线再淡淡地画在前面一层（风裹着他们）。不给 part 时照原作分前后。
// - ctl（游戏现场画时每帧改的一个对象）：grow 从定风珠往下长到地上（0 → 1）、sink 缩回定风珠里（器灵「定海」收招）、
//   burst 吹散（往外撑开一点、淡掉）、a 整体透明度、hide 什么都不画。预烘焙的是稳定转着的那一段（不给 ctl）。
// - 颜色全部收进调色板（snapOf）。
import { cycle, fit, rand, rng, smooth, clamp, lerp, TAU, WHITE, mix, tileNoise, bolt } from "../../core/index.js";
import { drawRock, stoneShape } from "../nature/_lib.js";
import { gp, snapOf } from "./_lib.js";

export const meta = {
  name: "定风珠旋风 Whirlwind (wind-fixing pearl)",
  desc: "A solid snaking funnel of spinning wind hanging from a pearl, lit on the left, dark-rimmed; leaves spiral up, dust boils at its foot. storm: a churning cloud, pale gold lightning.",
  tags: ["nature", "wind", "whirlwind", "tornado", "xianxia", "loop"],
  size: [96, 72],
  origin: [48, 62],
  duration: 1.6,
  loop: true,
  fps: 30,
  bg: "ground",
  options: {
    palette: gp("GGvlLwwW"),
    dust: gp("ghijw"),
    leaves: gp("vlLw"),
    stone: gp("kdghijw"),
    cloud: gp("kdNncijw"),
    bolt: gp("YfW"),
    height: 40,
    width: 1,
    debris: 10,
    storm: 0,
    part: "",
    split: 0,
    wrap: 0,
    ctl: null,
    seed: 4,
  },
};

const D = meta.duration, SY = 0.3;

// 淡入淡出时用半透明，不用抖动（抖动的风带成了一圈虚线）
const put = (p, x, y, c, a) => (a >= 0.98 ? p.dot(x, y, c) : p.blend(x, y, c, a));

// 漏斗在 t 时刻的样子：中轴像蛇一样摆（顶上不摆），半径往上张开、顶上再翻开一点；ctl 管长出来、缩回去、吹散
function geo(o, t) {
  const c = o.ctl, FH = o.height, W = o.width ?? 1, ph = (TAU * t) / D, A = FH * 0.1;
  const grow = c ? c.grow ?? 1 : 1, sink = c ? c.sink ?? 0 : 0, burst = c ? c.burst ?? 0 : 0;
  const lo = Math.max(1 - grow, sink); // 看得见的是 u 从 lo 到 1 的那一截（u：0 地面，1 顶上）
  const narrow = 1 - 0.55 * sink;
  const env = (u) => (1 - u) * (0.6 + 1.6 * u);
  const base = (u) => (0.08 * FH + 0.22 * FH * Math.pow(u, 1.3) + 0.08 * FH * Math.pow(smooth(0.72, 1, u), 2)) * W;
  const tip = (u) => (lo <= 0 ? 1 : smooth(lo, Math.min(1, lo + 0.16), u));
  const spread = 1 + 0.5 * burst; // 吹散只往外撑开一点（撑成一圈一圈的大椭圆就成了光圈），主要靠淡掉、碎屑和尘土往外飞
  return {
    FH,
    sc: FH / 40,
    lo,
    grow,
    sink,
    burst,
    cut: o.split > 0 ? o.split / FH : 0,
    ax: (u) => A * env(u) * (Math.sin(ph - 2.6 * u) + 0.35 * Math.sin(2 * ph + 1.3 - 4.5 * u)),
    rad: (u) => base(u) * narrow * tip(u) * spread,
    top: base(1) * narrow * spread,
  };
}

/** 这一层画哪一截：'low' 只画 split 以下的，'high' 只画以上的，其余全画。 */
const inRange = (g, range, u) => (range === "low" ? u < g.cut : range === "high" ? u >= g.cut : true);

// 漏斗身子：不透明的一柱。左边受光、右边背光，一行行按不同的速度错着转的风纹；左右外沿压一道深边；下面一截混着尘土
function body(p, C, Dst, g, t, seed, alpha, range) {
  const { FH, ax, rad, lo, burst } = g, k0 = alpha * Math.pow(1 - burst, 2.2);
  if (k0 <= 0.01) return;
  for (let y = -Math.ceil(FH) + 1; y <= 0; y++) {
    const u = -(y - 0.5) / FH;
    if (u < lo || !inRange(g, range, u)) continue;
    const cx = ax(u), r = rad(u), K = 2 + (rand(y, seed) < 0.35 ? 1 : 0), rot = (TAU * K * t) / D;
    if (r < 0.8) continue;
    const xl = Math.floor(cx - r + 0.5), xr = Math.floor(cx + r - 0.5);
    for (let x = xl; x <= xr; x++) {
      const c = clamp((x + 0.5 - cx) / r, -1, 1);
      const n = tileNoise(((Math.acos(c) + rot) * 5) / TAU, y * 0.62, 5, 0, seed), v = -c * 0.62 + 0.1 + n * 0.5;
      let col = v > 0.62 ? C[6] : v > 0.3 ? C[5] : v > -0.02 ? C[4] : v > -0.36 ? C[3] : C[2];
      if (u < 0.22) col = mix(col, Dst[v > 0.3 ? 3 : v > -0.2 ? 2 : 1], 0.65 * (1 - u / 0.22));
      if (x === xr && r > 1.6) col = C[1];
      else if (x === xl && r > 1.6) col = C[2];
      put(p, x, y, col, k0);
    }
  }
}

// 风带：绕着漏斗一圈圈往上转的 1 像素风线，头亮、往尾巴淡，下面压一道暗线；少数头上一点白、粗两像素，两成是暗的风线。
// 后半圈在后面（多半被柱身挡住）。thin：只画风线本身（下半截再淡淡地画在角色前面一层时用）
function bands(p, C, g, t, seed, back, alpha, range, thin = false) {
  const { FH, ax, rad, lo, burst } = g, N = Math.max(8, Math.round(FH * 0.36)), fade = alpha * Math.pow(1 - burst, 1.6);
  if (fade <= 0.01) return;
  for (let j = 0; j < N; j++) {
    const R = rng(seed, j), u = (j + R.range(0.15, 0.85)) / N, K = R.int(2, 4), span = R.range(1.5, 2.9), lvl = R.next(), w = R.range(1, 1.07), fl = R.range(0.6, 1.8), h0 = R.range(0, TAU);
    if (u > 0.95 || u < lo || !inRange(g, range, u)) continue;
    const cx = ax(u), r = rad(u) * w * (1 + 0.35 * burst * fl), y0 = -u * FH - burst * fl * 2, head = h0 + (TAU * K * t) / D;
    const dark = lvl < 0.2, hot = lvl > 0.6, fat = hot && u > 0.35;
    for (let s = 0; s <= span; s += 0.45 / Math.max(2, r)) {
      const th = head - s, sn = Math.sin(th);
      if (sn > 0 === back) continue;
      const k = s / span, x = cx + r * Math.cos(th), y = y0 + r * SY * sn, lit = Math.cos(th) < 0.2;
      if (back) {
        p.blend(x, y, C[lit ? 4 : 3], (0.8 - 0.5 * k) * fade);
        continue;
      }
      const a = k < 0.55 ? fade : fade * (1 - k) * 2.2;
      if (dark) {
        put(p, x, y, C[2], a * 0.9);
        continue;
      }
      if (!thin && k < 0.6) put(p, x, y + 1, C[lit ? 3 : 2], a);
      put(p, x, y, k < 0.12 && hot ? WHITE : k < 0.4 ? C[7] : C[lit ? 6 : 5], a);
      if (fat && k < 0.22) put(p, x, y - 1, C[lit ? 7 : 6], a);
    }
  }
}

// 漏斗口（斜着往下看进去）：远处的内壁（左亮右暗）、中间的深洞；吹散、缩回珠子里时跟着收掉
function mouth(p, C, g, a0) {
  const { FH, top } = g, rx = top, ry = Math.max(2, top * SY), cy = -FH;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(-rx); x <= Math.ceil(rx); x++) {
      const dx = (x + 0.5) / rx, dy = (y + 0.5 - cy) / ry, d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const tt = (dy + 1) / 2;
      let col = tt < 0.24 ? C[dx < 0.15 ? 4 : 3] : tt < 0.5 ? C[dx < -0.25 ? 3 : 2] : C[1];
      if (d2 < 0.22 && tt > 0.34) col = C[0];
      put(p, x, y, col, a0);
    }
}

// 近处的口沿：一道亮边，左边受光
function lip(p, C, g, a0) {
  const { FH, top } = g, rx = top, ry = Math.max(2, top * SY);
  for (let th = 0; th <= Math.PI; th += 0.5 / Math.max(2, rx)) {
    const cs = Math.cos(th);
    put(p, rx * cs, -FH + ry * Math.sin(th), cs < -0.45 ? C[7] : cs < 0.35 ? C[6] : C[5], a0);
  }
}

// 一团压扁的软云：rx 宽、ry 高，半透明
function blob(p, cx, cy, rx, ry, c, a) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) p.blend(x, y, c, a);
    }
}

const crownAlpha = (g, alpha) => alpha * smooth(0, 0.35, g.grow) * Math.pow(1 - g.burst, 2.2) * (1 - smooth(0.4, 0.82, g.sink));

// 口沿上绕着的几缕细风（跟着漏斗转，中间厚、尾巴拖细，上沿受光），托着定风珠
function crown(p, C, K, B, g, t, seed, back, flash, storm, alpha) {
  const { FH, top, burst } = g, a0 = crownAlpha(g, alpha);
  if (a0 <= 0.01) return;
  if (storm) return cloud(p, K, B, g, t, seed, back, flash, a0);
  const r = top, y0 = -FH - 1;
  for (let j = 0; j < 6; j++) {
    const R = rng(seed, j), rr = r * R.range(0.7, 1.22) * (1 + burst * R.range(0.2, 0.6)), Kr = R.int(1, 2), span = R.range(1.4, 2.8), h0 = R.range(0, TAU);
    const th0 = R.range(1, 2.2), lift = R.range(-1.5, 2), head = h0 + (TAU * Kr * t) / D;
    for (let s2 = 0; s2 <= span; s2 += 0.6 / Math.max(1, rr)) {
      const th = head - s2, sn = Math.sin(th);
      if (sn > 0 === back) continue;
      const k = s2 / span, th2 = th0 * Math.sin(Math.PI * Math.pow(1 - k, 0.7)), x = rr * Math.cos(th), y = y0 + lift + rr * SY * sn;
      const T = Math.max(1, Math.round(th2)), d = back ? 1 : 0, lit = Math.cos(th) < 0.3;
      for (let i = 0; i < T; i++) p.blend(x, y - T / 2 + i, i === 0 ? C[(lit ? 7 : 6) - d] : C[(lit ? 4 : 3) - d], (0.6 + 0.35 * (1 - k)) * (back ? 0.75 : 1) * a0);
    }
  }
}

// 风雷：口上压一团翻滚的乌云——十几团软云绕着转（后半圈在后面、暗一档），每团底下暗、左上受光，中间一团更暗的云心；
// 一圈里从里面亮两下（淡金），亮的时候一道电横着劈过云底。原作是一层压扁的云带，缩到这么小像一个灰盖子
function cloud(p, K, B, g, t, seed, back, flash, a0) {
  const { FH, top, burst, sc } = g, r = top * 0.95, y0 = -FH - 3, L = (c) => (flash > 0 ? mix(c, B[1], flash * 0.55) : c);
  if (back) blob(p, 0, y0 + 1, r * 0.8, 3.4 * sc, K[1], 0.6 * a0);
  for (let j = 0; j < 14; j++) {
    const R = rng(seed, j), Kr = R.int(1, 2), ang = R.range(0, TAU) + (TAU * Kr * t) / D, rr = r * R.range(0.3, 1.02) * (1 + burst * R.range(0.3, 0.8)), s = R.range(2.8, 4.4) * sc, dy = R.range(-2, 1);
    const sn = Math.sin(ang);
    if (sn > 0 === back) continue;
    const x = rr * Math.cos(ang), y = y0 + dy + rr * SY * sn, d = back ? 1 : 0, lit = Math.cos(ang) < 0.3;
    p.disc(x, y + 0.5, s, K[(lit ? 3 : 2) - d], 0.85 * a0);
    p.disc(x - s * 0.3, y - s * 0.35, s * 0.6, L(K[(lit ? 5 : 4) - d]), 0.75 * a0);
  }
  if (back || flash <= 0.05) return;
  const R = rng(seed, 99, Math.floor((t / D) * 7)), path = bolt(R, -r * 0.95, y0 + 2, r * 0.9, y0 - 0.5, { jag: 0.3, depth: 3 });
  p.polyline(path, flash > 0.6 ? WHITE : B[1], Math.min(1, flash * 1.5) * a0);
  p.glow(0, y0, 9, B[0], 0.3 * flash * a0);
}

// 一片小叶：两三像素长的一道叶脊，侧过来时旁边再贴一行（宽两像素），翻过来是暗面，尖上一点亮。
// 原作带描边的叶形缩到这么小成了一个个深色的圈
function leaf(p, x, y, len, spin, flip, Lf, dk, a) {
  const ca = Math.cos(spin), sa = Math.sin(spin), h = len / 2, f = Math.cos(flip), face = f > 0;
  if (Math.abs(f) > 0.45) p.line(x - ca * h * 0.6 - sa, y - sa * h * 0.6 + ca, x + ca * h * 0.6 - sa, y + sa * h * 0.6 + ca, Lf[face ? 1 : 0], a);
  p.line(x - ca * h, y - sa * h, x + ca * h, y + sa * h, Lf[(face ? 2 : 1) - dk * (face ? 1 : 0)], a);
  p.dot(x + ca * h, y + sa * h, Lf[(face ? 3 : 2) - dk], a);
}

// 叶子、碎石：先贴着地面被卷进来，再绕着漏斗往上旋、从顶上甩出去
function debris(p, Lf, S, g, t, seed, back, count, alpha) {
  const { FH, ax, rad, burst, grow, sink, sc } = g, a0 = alpha * smooth(0.8, 1, grow) * (1 - smooth(0, 0.5, sink)) * Math.pow(1 - burst, 0.7);
  if (a0 <= 0.01) return;
  cycle(t, D, count, seed, (q) => q.range(1.05, 1.55), (age, life, R) => {
    const k = age / life, sk = R.range(0.15, 0.3), q = clamp((k - sk) / (1 - sk)), u = lerp(0.03, 0.98, Math.pow(q, 0.85));
    const th = R.range(0, TAU) + R.range(2, 3) * TAU * k, sn = Math.sin(th);
    const far = R.range(14, 22) * sc, out = R.range(1.5, 4), kind = R.next(), len = R.range(3, 4.6), spin = R.range(-12, 12) * age, flip = age * R.range(5, 10), rs = R.range(1.2, 1.9);
    if (sn > 0 === back) return;
    const fling = smooth(0.8, 1, q), inward = 1 - smooth(0, sk, k);
    const rr = lerp(Math.min(26 * sc, rad(u) * (1.1 + fling * 0.45) + out), far, inward) * (1 + burst * 0.8);
    const x = ax(u) + rr * Math.cos(th), y = Math.max(-FH - 8, Math.min(-1, -u * FH + rr * SY * sn - fling * 2 * sc));
    const a = Math.min(1, k * 8) * (1 - smooth(0.85, 1, k)) * a0;
    if (a <= 0.01) return;
    if (kind < 0.7) leaf(p, x, y, len, spin, flip, Lf, back ? 1 : 0, a);
    else drawRock(p, x, y, rs, spin, stoneShape(R, 5), S, a);
  });
}

// 脚下：尘土绕着翻滚、往外扬，几粒砂子蹦起来
function skirt(p, Dst, g, t, seed, back, alpha) {
  const { ax, burst, grow, sink, sc } = g, a0 = alpha * smooth(0.75, 1, grow) * (1 - smooth(0, 0.3, sink)) * (1 - burst), cx0 = ax(0);
  if (a0 <= 0.01) return;
  cycle(t, D, 20, seed, (q) => q.range(0.6, 1.1), (age, life, R) => {
    const k = age / life, th = R.range(0, TAU) + R.range(5, 9) * age, sn = Math.sin(th), w = R.range(7, 14), hg = R.range(2, 8), s0 = R.range(2, 3.6);
    if (sn > 0 === back) return;
    const rr = (3 + k * w * sc) * (1 + burst * 1.2), x = cx0 + rr * Math.cos(th), y = -1.5 - k * hg * sc + rr * 0.3 * sn, s = s0 * (0.6 + 0.8 * k) * sc;
    const a = Math.min(1, k * 6) * (1 - k) * 0.6 * a0;
    p.disc(x, y + s * 0.2, s, Dst[back ? 1 : 2], a);
    p.disc(x - s * 0.2, y - s * 0.3, s * 0.55, Dst[back ? 2 : 3], a * 0.8);
  });
  if (back) return;
  cycle(t, D, 9, seed + 7, (q) => q.range(0.3, 0.5), (age, life, R) => {
    const th = R.range(0, TAU), v = R.range(14, 30) * sc, up = R.range(22, 44) * sc, c = R.next();
    const x = cx0 + Math.cos(th) * (3 + v * age), y = Math.sin(th) - up * age + 180 * age * age;
    if (y < 0.5) p.dot(x, Math.min(0, y), c < 0.5 ? Dst[3] : Dst[4], (1 - age / life) * a0);
  });
}

// 风雷：一圈里乌云从里面亮两下
function flashAt(t) {
  const q = t / D;
  return Math.max(0, 1 - Math.abs(q - 0.62) / 0.025) + 0.6 * Math.max(0, 1 - Math.abs(q - 0.69) / 0.015);
}

const skip = (o) => !!o.ctl && (o.ctl.hide || (o.ctl.a ?? 1) <= 0.01);
const alphaOf = (o) => (o.ctl ? clamp(o.ctl.a ?? 1) : 1);
const ramps = (o) => ({ C: fit(o.palette, 8), Dst: fit(o.dust, 5), K: fit(o.cloud, 8), B: fit(o.bolt, 3), Lf: fit(o.leaves, 4), S: fit(o.stone, 7) });

// 分层见文件头。库的工具（不给 part）：drawBack 在人物后面，draw 在前面
export function drawBack(p, t, o) {
  if (skip(o)) return;
  const { C, Dst, K, B, Lf, S } = ramps(o), g = geo(o, t), f = o.storm ? flashAt(t) : 0, al = alphaOf(o), P = o.part;
  const range = P === "back" ? "low" : P === "front" ? "high" : "all";
  if (P !== "front") {
    skirt(p, Dst, g, t, o.seed * 5 + 1, true, al);
    debris(p, Lf, S, g, t, o.seed * 11 + 3, true, o.debris, al);
  }
  bands(p, C, g, t, o.seed * 3 + 5, true, al, range);
  body(p, C, Dst, g, t, o.seed, al, range);
  if (P === "back") bands(p, C, g, t, o.seed * 3 + 5, false, al, range);
  else {
    const a0 = crownAlpha(g, al);
    if (a0 > 0.01) mouth(p, C, g, a0);
    crown(p, C, K, B, g, t, o.seed * 7 + 2, true, f, o.storm, al);
  }
  snapOf(o, C, Dst, K, B, Lf, S)(p);
}

export function draw(p, t, o) {
  if (o.part === "back" || skip(o)) return;
  const { C, Dst, K, B, Lf, S } = ramps(o), g = geo(o, t), f = o.storm ? flashAt(t) : 0, al = alphaOf(o), front = o.part === "front";
  if (front && o.wrap > 0) bands(p, C, g, t, o.seed * 3 + 5, false, al * o.wrap, "low", true);
  bands(p, C, g, t, o.seed * 3 + 5, false, al, front ? "high" : "all");
  const a0 = crownAlpha(g, al);
  if (a0 > 0.01) lip(p, C, g, a0);
  crown(p, C, K, B, g, t, o.seed * 7 + 2, false, f, o.storm, al);
  skirt(p, Dst, g, t, o.seed * 5 + 1, false, al);
  debris(p, Lf, S, g, t, o.seed * 11 + 3, false, o.debris, al);
  snapOf(o, C, Dst, K, B, Lf, S)(p);
}
