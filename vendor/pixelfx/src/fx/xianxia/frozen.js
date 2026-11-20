// 冰封（修仙版）：参照 pixelfx 的 status/frozen（MIT，https://github.com/patch-gg/pixelfx）重做的冻结状态。
// 冰棱用的是库的 crystal（出自 Sprite Fusion 的开源 frost nova，https://www.spritefusion.com/pixel-art-vfx，
// MIT License, Copyright (c) 2026 Hugo Duprez）。
// 为什么重做（封神幸存者，2026-11-10）：
// - 原作把整个人物重画成发青的样子、在身上长霜花、从下巴和手上挂冰凌、头肩积雪，全都要知道人物的每个像素；
//   游戏里的敌人有十来种、两个朝向、各有动画帧，逐个烘焙不划算。这里不碰人物：按身体的宽高（选项 body，默认 12×22）
//   在外面封一块半透明的冰（左面亮、右面暗、棱线和边是实的），脚边立几根冰棱，一种体型只要预烘焙一份。
// - 冰块的轮廓是一簇晶体的折线（顶上一高一矮两个尖、下半截往外鼓），不是圆顶直边：圆顶像罩着一个玻璃钟，是个「框」。
// - 原作脚下的霜是一条横线，俯视 3/4 的画面里应该是一片：换成一朵压扁的六出霜花。
// - 去掉脚下的冷光和身上两团光（半径 16–30），只在闪光的地方留很小的光。
// - 冰面上隔一会儿扫过一道亮光、棱角上闪一下星光：冰是静的，靠这两样「活」着，不抖、不闪整身。
import { cycle, fit, crystal, sparkle, clamp, smooth, rand, TAU, WHITE } from "../../core/index.js";
import { gp, snapOf, SY } from "./_lib.js";

export const meta = {
  name: "冰封 Frozen (ice block)",
  desc: "Frozen solid: a thin translucent block of ice seals the body, lit on its left face, two ice spikes at its foot on a six-armed frost flower; a glint sweeps it, corners twinkle.",
  tags: ["status", "ice", "freeze", "frozen", "cold", "debuff", "xianxia", "loop"],
  size: [52, 60],
  origin: [26, 48],
  duration: 2,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: gp("NnncCwwW"), body: [12, 22], seed: 4 },
};

const D = meta.duration;

// 冰块的轮廓：一簇不规则的晶体（顶上两个尖，一高一矮；下半截往外鼓，像从地上冻上来的），脚在 (0, 0)。
// 不画成圆顶：圆顶直边的一圈像罩着个玻璃钟（「框」），晶体的折线才像冰。
function block(o) {
  const [w, h] = o.body, bw = w / 2 + 4, bh = h + 6;
  return {
    bw, bh,
    pts: [
      [-bw + 1, 1.5], [-bw - 1, -bh * 0.28], [-bw + 2, -bh * 0.6], [-bw * 0.4, -bh * 0.78], [-bw * 0.12, -bh],
      [bw * 0.18, -bh * 0.8], [bw * 0.5, -bh * 0.92], [bw - 1, -bh * 0.58], [bw + 1, -bh * 0.26], [bw - 2, 1.5],
    ],
    // 棱线：从两个尖往下斜着走一截（冰的折面）
    ridges: [
      [[-bw * 0.12, -bh + 2], [-bw * 0.3, -bh * 0.55]],
      [[bw * 0.5 - 0.5, -bh * 0.92 + 2], [bw * 0.3, -bh * 0.62]],
    ],
    ridge: (y) => -bw * 0.12 - (bw * 0.18) * clamp((y + bh) / (bh * 0.45)), // 左右两面的分界（左面受光）
  };
}
function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// 脚下的霜花：六出、俯视压扁，枝上带小分叉
function frostFlower(p, C, r, seed) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3, len = r * (0.8 + 0.2 * rand(seed, i)), ca = Math.cos(a), sa = Math.sin(a) * SY;
    for (let d = 1; d <= len; d++) {
      p.px(ca * d, sa * d, d > len - 1.5 ? C[7] : d % 3 === 0 ? C[5] : C[4]);
      if (d === Math.round(len * 0.55))
        for (const s of [-1, 1]) {
          const b = a + s * 1.05;
          for (let k = 1; k <= 2; k++) p.px(ca * d + Math.cos(b) * k, sa * d + Math.sin(b) * k * SY, C[4]);
        }
    }
  }
  p.px(0, 0, C[7]);
}

export function drawBack(p, t, o) {
  const C = fit(o.palette, 8), B = block(o);
  frostFlower(p, C, B.bw + 4, o.seed);
  snapOf(o, C)(p);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8), B = block(o), { pts, bw, bh } = B, ph = t / D;
  // 冰块：很薄的一层半透明（里面的人要看得清），左面亮右面暗；一道亮光斜着扫过去，后面跟一道细的
  const sweep = -bw - 14 + (2 * bw + 30) * smooth(0.08, 0.5, ph), on = ph > 0.08 && ph < 0.5;
  for (let y = Math.floor(-bh) - 1; y <= 2; y++)
    for (let x = Math.floor(-bw) - 1; x <= bw + 1; x++) {
      if (!inside(pts, x + 0.5, y + 0.5)) continue;
      const left = x + 0.5 < B.ridge(y), q = x + 0.5 + (y + 0.5) * 0.7 - sweep;
      if (on && (Math.abs(q) < 1.3 || Math.abs(q + 4.5) < 0.6)) p.blend(x, y, WHITE, 0.55);
      else p.blend(x, y, left ? C[5] : C[4], left ? 0.26 : 0.2);
    }
  // 边：朝左上的几段受光（白），朝右的背光（深）；底边淡一点。棱线只画上半截，断开几处
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const nx = y1 - y0, ny = x0 - x1, lit = nx + ny < -0.5; // 外法线朝左上
    const col = i === pts.length - 1 ? C[5] : lit ? C[7] : nx > 0 ? C[3] : C[5];
    p.line(x0, y0, x1, y1, col, i === pts.length - 1 ? 0.6 : 1);
  }
  for (const [[x0, y0], [x1, y1]] of B.ridges) p.line(x0, y0, x1, y1, (u) => (u < 0.5 ? C[7] : C[6]), (u) => (u > 0.7 && u < 0.8 ? 0 : 1 - u * 0.5));
  // 两根小冰棱立在脚边，一高一矮（边用浅一档的颜色，这么小的冰棱描深边会像獠牙）；高的那根上隔一会儿滑过一道光
  const ICE = [C[3], C[1], C[2], C[3], C[4], C[5], C[6], C[7]];
  crystal(p, -bw + 1, 3, bh * 0.24, 4, -1, ICE, { glint: -1 });
  crystal(p, bw - 2, 3.5, bh * 0.36, 4.5, 1.5, ICE, { glint: (ph + 0.55) % 1 < 0.35 ? ((ph + 0.55) % 1) / 0.35 : -1 });
  // 棱角上的星光，错开着闪
  const tw = (at, x, y, n) => {
    const u = ((ph - at + 1) % 1) / 0.16;
    if (u < 1) sparkle(p, x, y, Math.round(n * Math.sin(u * Math.PI)), C[7], C[5], 0.3);
  };
  tw(0.3, pts[4][0], pts[4][1] + 1, 2);
  tw(0.72, pts[6][0], pts[6][1] + 1, 2);
  tw(0.9, pts[1][0] + 1, pts[1][1] - 1, 1);
  // 几粒往下沉的雪
  cycle(t, D, 5, o.seed + 5, (r) => r.range(1.2, 1.7), (age, life, r) => {
    const x = r.range(-bw - 4, bw + 4) + Math.sin(age * 3 + r.next() * TAU) * 1.2, y = -bh - 4 + r.range(0, bh * 0.5) + age * 9;
    if (y < 1) p.dot(x, y, r.next() < 0.5 ? C[7] : C[5], Math.min(1, age * 4) * Math.min(1, (life - age) * 4));
  });
  snapOf(o, C)(p);
}
