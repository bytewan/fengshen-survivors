// 荆棘刺（修仙版 · 木行：青莲宝色旗的荆棘）：改自 pixelfx 的 nature/thorns（MIT，https://github.com/patch-gg/pixelfx）。
// 刺一根接一根顶出来、过冲、白一帧的做法改编自 Sprite Fusion 的开源 ice spikes (https://www.spritefusion.com/pixel-art-vfx/ice)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 原作是侧视的一排六根褐色硬木刺，沿地面越长越高地冲出去（232 像素宽、最高的刺 48 像素），是一道直线攻击。
//   游戏里青莲结界的荆棘是「敌人进了结界就被刺一下」，所以改成一只敌人脚下的一小簇：三根青藤刺前后错开地顶出来
//   （俯视：远的一根矮、暗一档），最高约 15 像素、根上两三像素宽，根上翻开两片小叶子，迸几粒草屑，停一会儿再缩回去。0.9 秒。
// - 颜色从褐色硬木换成青藤（墨绿 → 松 → 石绿 → 葱黄，尖上一点灵光）；去掉沿地面跑的那道发绿光的裂缝、
//   大团的烟尘和石块（仙台是玉石地面，不翻土），辉光只在刺冒出来的那一下有一点。
import { Particles, Lights, P, Rng, fit, clamp, smooth, ease, rand, TAU, WHITE } from "../../core/index.js";
import { drawLeaf } from "../nature/_lib.js";
import { gp, snapper, SY } from "./_lib.js";

export const meta = {
  name: "荆棘刺 Thorn sting",
  desc: "Thorns of the green lotus: three vine thorns punch up round a foe's feet in turn, flash white, overshoot, leaves unfurl at their foot, bits of leaf fly, then they sink back.",
  tags: ["nature", "thorn", "vine", "wood", "sting", "ground", "xianxia", "one-shot"],
  size: [56, 48],
  origin: [28, 38],
  duration: 0.9,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("GGvvllLf"), leaf: gp("GvlL"), height: 15, seed: 4 },
};

const RISE = 0.1;

// 一根带钩的藤刺：从根往尖收细（收得快，尖要利），尖往前钩；左边受光、右边背光，描一圈最暗的色（墨绿：玄色描边太重）
function thorn(p, s, h, C, white, base) {
  if (h < 1.5) return;
  const { x, w, hook, lean } = s, cx = (u) => x + lean * u + hook * Math.pow(u, 2.4), hw = (u) => (w / 2) * Math.pow(1 - u, 1.25) + 0.2;
  const inside = (px, py) => {
    const u = (base + s.y - (py + 0.5)) / h;
    if (u < 0 || u > 1 || py + 0.5 > s.y) return false;
    return Math.abs(px + 0.5 - cx(u)) <= hw(u);
  };
  const X0 = Math.floor(x - w - 3), X1 = Math.ceil(x + w / 2 + Math.abs(lean) + Math.abs(hook) + 2);
  for (let py = Math.floor(s.y + base - h) - 1; py <= Math.ceil(s.y); py++)
    for (let px = X0; px <= X1; px++) {
      if (!inside(px, py)) {
        if (py <= s.y && (inside(px - 1, py) || inside(px + 1, py) || inside(px, py + 1) || inside(px, py - 1))) p.px(px, py, C[0]);
        continue;
      }
      if (white) {
        p.px(px, py, WHITE);
        continue;
      }
      const u = (base + s.y - (py + 0.5)) / h, c = cx(u), r = hw(u), q = (px + 0.5 - (c - r)) / (2 * r);
      let i = q < 0.3 ? 6 : q < 0.6 ? 5 : q < 0.85 ? 3 : 2;
      if (u > 0.8) i = q < 0.6 ? 7 : 5;
      p.px(px, py, C[Math.max(1, i - s.dim)]);
    }
}

export function create(o) {
  const C = fit(o.palette, 8), G = fit(o.leaf, 4), R = new Rng(o.seed), H = o.height, snap = snapper(C, G);
  const ps = new Particles({ rng: R, ground: () => 0 }), lights = new Lights();
  // 三根：远（矮、暗一档）、左、右，前后错开 0.05 秒
  const list = [
    { x: 1 + R.range(-1, 1), y: -3 * SY, h: H * 0.65, w: 2, dim: 1 },
    { x: -5 + R.range(-1, 0.5), y: 1, h: H * 0.8, w: 2.2, dim: 0 },
    { x: 5 + R.range(-0.5, 1), y: 2, h: H, w: 2.6, dim: 0 },
  ].map((s, i) => ({ ...s, at: 0.02 + i * 0.05, sink: 0.48 + i * 0.05, hook: (i === 1 ? -1 : 1) * R.range(1, 2), lean: (i === 1 ? -1 : 1) * R.range(0.5, 1.5), up: false }));
  const grown = (s, t) => (t < s.at ? 0 : ease.outBack(clamp((t - s.at) / RISE), 2.2));
  const sunk = (s, t) => smooth(s.sink, s.sink + 0.28, t);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (const s of list) {
        if (!s.up && t >= s.at) {
          s.up = true;
          lights.add(s.x, s.y - s.h * 0.5, 8, C[6], 0.4, 0.15);
          for (let i = 0; i < 4; i++) {
            const a = -Math.PI / 2 + R.range(-1.1, 1.1), v = R.range(40, 90);
            ps.spawn(P.GRIT, s.x + R.range(-1.5, 1.5), Math.min(-1, s.y - 1), Math.cos(a) * v, Math.sin(a) * v, R.range(0.35, 0.55), R.pick([G[1], G[2], G[3]]), 1);
          }
        }
      }
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 远的先画，近的压在上面
      for (const s of list) {
        const g = grown(s, t), k = sunk(s, t);
        if (g <= 0 || k >= 1) continue;
        // 根上翻开的几片叶子：顶出来时展开，缩回去时收起
        const lk = clamp((t - s.at - 0.03) / 0.15) * (1 - k);
        if (lk > 0.05)
          for (const [sd, a0, sz] of [[-1, -2.6, 1], [1, -0.5, 0.85]]) {
            const la = a0 + sd * 0.3 * (1 - lk), L = (2.5 + s.w * 0.5) * sz * lk;
            drawLeaf(p, s.x + sd * s.w * 0.4 + Math.cos(la) * L * 0.5, s.y - 0.5 + Math.sin(la) * L * 0.5, L, 1 + s.w * 0.1, la, 0.35, G);
          }
        thorn(p, s, s.h * g, C, t - s.at < 0.034, k * s.h * 1.05);
      }
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}
