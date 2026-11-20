// 拾灵石（修仙版）：参照 pixelfx 的 pickups/collect-burst（MIT，https://github.com/patch-gg/pixelfx）新做的一个很小的拾取效果。
// 星光的画法参照了 Sprite Fusion 的开源 pickup (https://www.spritefusion.com/pixel-art-vfx/pickup)，MIT License, Copyright (c) 2026 Hugo Duprez。
// 为什么新做（封神幸存者，2026-11-10）：
// - 原作是一团半径二十多像素的白光、一个十字光、一大一小两圈往外弹的圆环，再往四面甩一圈星：光晕加圆环，游戏里不要；
//   而且灵石一波要捡几十上百颗（波末收灵一起飞过来），每颗都炸一大团太吵。
// - 这里只有一粒：灵石并进人物的那一点白一下（一粒天青描边的小菱形，两帧），四五粒天青、月白的小光点往外一迸、
//   往上飘着化掉（头亮尾暗的两像素一小截：单像素的光点在人物身上几乎看不见），0.45 秒收完，整个不超过 16 像素。
//   辉光只有光点上的一点。原点 = 灵石并进去的那一点（人物胸口）。
import { Lights, Rng, fit, TAU, WHITE } from "../../core/index.js";
import { gp, snapper } from "./_lib.js";

export const meta = {
  name: "拾灵石 Spirit stone pickup",
  desc: "A spirit stone merges into you: a tiny white diamond rimmed in teal flashes for two frames, four or five teal and moon-white motes pop out, drift up and wink out.",
  tags: ["pickup", "collect", "gem", "xp", "spirit", "small", "xianxia", "one-shot"],
  size: [32, 32],
  origin: [16, 18],
  duration: 0.45,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("NncCw"), motes: 5, seed: 2 },
};

export function create(o) {
  const C = fit(o.palette, 5), R = new Rng(o.seed), snap = snapper(C), lights = new Lights();
  // 光点：迸出去、减速、往上飘，头亮（月白）尾暗（天青）的两像素一小截；单像素的星在人物身上几乎看不见
  const a0 = R.range(0, TAU);
  const motes = Array.from({ length: o.motes }, (_, i) => {
    const a = a0 + (i / o.motes) * TAU + R.range(-0.3, 0.3), sp = R.range(34, 52);
    return { x: Math.cos(a) * 1.5, y: Math.sin(a) * 1.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 12, t0: R.range(0, 0.04), life: R.range(0.26, 0.38) };
  });
  lights.add(0, 0, 6, C[3], 0.4, 0.15);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (const m of motes) {
        if (t < m.t0) continue;
        m.vx -= m.vx * 5 * dt;
        m.vy -= m.vy * 5 * dt + 30 * dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
      }
      lights.update(dt);
    },
    draw(p) {
      if (t < 0.1) {
        // 小菱形：白心，天青描边；后两帧缩一圈
        const r = t < 0.067 ? 2 : 1;
        for (let dy = -r - 1; dy <= r + 1; dy++)
          for (let dx = -r - 1; dx <= r + 1; dx++) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d <= r) p.px(dx, dy, WHITE);
            else if (d === r + 1) p.px(dx, dy, C[3]);
          }
      }
      for (const m of motes) {
        const u = (t - m.t0) / m.life;
        if (u <= 0 || u >= 1) continue;
        if (u > 0.75 && Math.floor(t * 30) % 2) continue;
        const v = Math.hypot(m.vx, m.vy) || 1;
        p.px(m.x, m.y, u < 0.5 ? C[4] : C[3]);
        if (u < 0.7) p.px(m.x - m.vx / v, m.y - m.vy / v, u < 0.4 ? C[3] : C[2]);
        p.light(m.x, m.y, C[3], 0.3 * (1 - u));
      }
      lights.draw(p);
      snap(p);
    },
  };
}
