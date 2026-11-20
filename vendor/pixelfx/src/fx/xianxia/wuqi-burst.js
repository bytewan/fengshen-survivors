// 五气朝元（功法）：封神幸存者 2026-11-12 新做（pixelfx 的画笔与做法，MIT，https://github.com/patch-gg/pixelfx）。
// 用户 2026-11-12：「这些特效都不能廉价」——不用几粒单像素的粒子，而是五道有头有尾的气：
//   起势 0–0.1 秒：敌人身上先凝出一点灵光（白芯、灵光边，一盏很小的光）；
//   主体 0.1–0.55 秒：金木水火土五色之气从那一点朝五个方向迸出，各拖一道由亮到暗的尾，边走边往同一个方向打旋（像五气绕着一点转）；
//   余韵 0.55–1.1 秒：五道气走到头放慢、往上飘，尾巴收短，各化成两三粒同色的光点慢慢暗下去；中间那点灵光也在这时淡掉。
// 不画圆环、不画光圈；中心的光很小（半径 6）。
import { hex, clamp, rand, ease, TAU } from "../../core/index.js";
import { gp, snapOf } from "./_lib.js";

export const meta = {
  name: "五气朝元 Five breaths",
  desc: "Five breaths in the five element colours burst from one bright point, spiralling out on fading tails, then slow, drift up and break into motes.",
  tags: ["burst", "wuxing", "xianxia", "qi"],
  size: [104, 80],
  origin: [52, 52],
  duration: 1.1,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { reach: 40, seed: 1 },
};

// 五行各一条色阶（暗 → 亮）：金 木 水 火 土
// 土用游戏调色板里的黄土四色（褐 深黄土 黄土 浅黄土；库的 GP 副本没收这几个，直接写色值）
const RAMPS = [gp("BbyYf"), gp("Gvlf"), gp("ncCw"), gp("Rreo"), ["#6b5749", "#958064", "#a48e6d", "#b39e7d"]].map((r) => r.map(hex));
const CY = -8; // 气从敌人身上（脚下往上 8 像素）迸出

function headAt(u, a, R, curl) {
  const k = ease.outCubic(clamp(u));
  const ang = a + curl * k;
  return [Math.cos(ang) * R * k, CY + Math.sin(ang) * R * k * 0.62];
}

export function draw(p, t, o) {
  if (t >= meta.duration) return;
  const R = o.reach, s = o.seed, rot = rand(s, 1) * TAU, curl = 0.9;
  const W = hex("#ffffff"), F = hex("#ffe9a8");
  // ---- 中心那点灵光：起势亮起，余韵里淡掉 ----
  const c = t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.1) / 0.6);
  if (c > 0.03) {
    p.glow(0, CY, 6, F, 0.3 * c);
    p.px(0, CY, c > 0.5 ? W : F);
    if (c > 0.4) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.dot(dx, CY + dy, F, c);
  }
  // ---- 五道气 ----
  for (let i = 0; i < 5; i++) {
    const C = RAMPS[i], n = C.length;
    const a = rot + (i / 5) * TAU + (rand(s, 2, i) - 0.5) * 0.3;
    const go = 0.1 + rand(s, 3, i) * 0.04, life = 0.45 + rand(s, 4, i) * 0.08;
    const u = (t - go) / life;
    if (u <= 0) continue;
    const Ri = R * (0.82 + 0.25 * rand(s, 5, i));
    const lift = (v) => (v > 1 ? -12 * (v - 1) * (v - 1) - 6 * (v - 1) : 0); // 走到头之后往上飘
    if (u < 1.25) {
      // 尾：沿来路往回取几个点，越往后越暗、越透
      const tail = 0.42 * Math.min(1, u * 2.5) * (u > 1 ? Math.max(0, 1 - (u - 1) / 0.25) : 1);
      const steps = 18;
      for (let j = steps; j >= 0; j--) {
        const v = Math.max(0, Math.min(u, 1.25) - (tail * j) / steps);
        const [x, y] = headAt(Math.min(1, v), a, Ri, curl);
        const yy = y + lift(v);
        const k = 1 - j / steps; // 1 头、0 尾梢
        const ci = Math.min(n - 1, Math.floor(k * (n - 0.01)));
        const alpha = Math.min(1, 0.25 + k) * (u > 1 ? Math.max(0, 1 - (u - 1) / 0.25) * 0.6 + 0.4 : 1);
        // 气是有体积的：每一节一团半透明的软团（越近头越粗），近头的一半再压一像素实芯
        p.disc(x, yy, 0.5 + 1.3 * k, C[Math.max(0, ci - 1)], alpha * 0.55);
        if (k > 0.5) p.px(x, yy, C[Math.max(0, ci)]);
        else p.dot(x, yy, C[Math.max(0, ci)], alpha);
      }
      // 头：两像素（亮的在前），一盏小光
      const [hx, hy0] = headAt(Math.min(1, u), a, Ri, curl);
      const hy = hy0 + lift(Math.min(u, 1.25));
      if (u < 1.05) {
        p.disc(hx, hy, 2.2, C[n - 2], 0.45);
        p.px(hx, hy, C[n - 1]);
        p.px(hx - Math.cos(a + curl) * 1, hy - Math.sin(a + curl) * 0.62, C[n - 2]);
        p.light(hx, hy, C[n - 1], 0.4 * (1 - Math.max(0, u - 0.6)));
      }
    }
    // ---- 散成光点：头停下的地方往上飘的两三粒 ----
    if (u > 0.95) {
      const [ex, ey] = headAt(1, a, Ri, curl);
      for (let m = 0; m < 3; m++) {
        const ma = t - (go + life * 0.95) - m * 0.06;
        const ml = 0.35 + rand(s, 6, i, m) * 0.2;
        if (ma < 0 || ma > ml) continue;
        const q = ma / ml;
        const x = ex + (rand(s, 7, i, m) - 0.5) * 6 + Math.sin(ma * 8 + m) * 0.8;
        const y = ey - 2 - ma * (16 + rand(s, 8, i, m) * 10);
        const col = q < 0.4 ? C[n - 1] : q < 0.75 ? C[n - 2] : C[Math.max(0, n - 3)];
        if (q > 0.8) p.dot(x, y, col, (1 - q) / 0.2);
        else p.px(x, y, col);
      }
    }
  }
  snapOf(o, ...RAMPS, W, F)(p);
}
