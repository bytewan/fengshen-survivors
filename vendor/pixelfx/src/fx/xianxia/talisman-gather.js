// 聚灵符（修仙版 · 拾到聚灵符的那一下）：参照 pixelfx 的 arcane/ 里的聚气和 fire/ 里的余烬（MIT，https://github.com/patch-gg/pixelfx）新做。
// 余烬、纸灰的飘法参照了 Sprite Fusion 的开源 fire (https://www.spritefusion.com/pixel-art-vfx/fire)，MIT License, Copyright (c) 2026 Hugo Duprez。
// 为什么新做（封神幸存者，2026-11-10）：
// - 聚灵符是磁铁的替代：拾到时把场上的灵石全吸过来。游戏自己画符纸从下往上烧成灰（drops-fx 里），这里画「聚灵」：
//   四周八道天青的灵气从二三十像素外往符上收（朝着符的短线，越收越快，头亮尾暗），收到的那一下符上白一下；
//   同时符烧出来的火星（朱砂到缃）和几片纸灰（苍、银鼠的两像素小片）往上飘、左右摆着散掉。1.2 秒收完。
// - 收拢的方向就是「吸过来」的意思，但不画圆环、不画法阵：只有一缕缕的线。原点 = 符的位置（离地约 6 像素）。
import { Particles, Lights, P, Rng, fit, clamp, ease, TAU, WHITE } from "../../core/index.js";
import { gp, snapper, SY } from "./_lib.js";

export const meta = {
  name: "聚灵符 Spirit-gathering talisman",
  desc: "A gathering talisman goes off: eight teal streaks of qi rush in from around it, faster as they close, it flashes white as they arrive, embers and flakes of paper ash drift up.",
  tags: ["pickup", "magnet", "talisman", "gather", "qi", "ash", "xianxia", "one-shot"],
  size: [80, 72],
  origin: [40, 46],
  duration: 1.2,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("NncCwW"), ember: gp("reyY"), ash: gp("hi"), reach: 28, seed: 8 },
};

export function create(o) {
  const C = fit(o.palette, 6), E = fit(o.ember, 4), A = fit(o.ash, 2), R = new Rng(o.seed), snap = snapper(C, E, A);
  const ps = new Particles({ rng: R, sparks: [WHITE, E[3], E[2], E[1]] }), lights = new Lights();
  // 灵气：从四周往里收，起点错开、远近不一
  const streams = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * TAU + R.range(-0.25, 0.25), d = o.reach * R.range(0.85, 1.2);
    return { x0: Math.cos(a) * d, y0: Math.sin(a) * d * SY - 2, t0: R.range(0, 0.25), dur: R.range(0.42, 0.55), len: R.range(5, 7), bend: R.range(-0.25, 0.25) };
  });
  // 纸灰：两像素的小片，翻着往上飘
  const ash = Array.from({ length: 6 }, () => ({ x: R.range(-3, 3), y: R.range(-4, 2), vx: R.range(-10, 10), vy: -R.range(14, 26), t0: R.range(0.1, 0.5), life: R.range(0.5, 0.7), ph: R.range(0, TAU), c: R.int(0, 1) }));
  let t = 0, flashT = -1;
  const pos = (s, u) => {
    // 沿一条略弯的路往原点收：越近越快（ease.inCubic）
    const k = 1 - ease.inQuad(u), ang = s.bend * (1 - k) * 2;
    const x = s.x0 * k, y = s.y0 * k, c = Math.cos(ang), sn = Math.sin(ang);
    return [x * c - y * sn, x * sn + y * c];
  };
  return {
    update(dt) {
      t += dt;
      // 第一缕收到的时候符上白一下，迸几粒火星
      if (flashT < 0 && streams.some((s) => t >= s.t0 + s.dur)) {
        flashT = t;
        lights.add(0, 0, 10, C[3], 0.5, 0.3);
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + R.range(-1, 1), sp = R.range(30, 70);
          ps.spawn(P.SPARK, R.range(-2, 2), 0, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.25, 0.45));
        }
      }
      if (t < 0.65 && R.chance(0.35)) ps.spawn(P.EMBER, R.range(-3, 3), R.range(-2, 3), R.range(-6, 6), -R.range(16, 30), Math.min(R.range(0.35, 0.6), meta.duration - 0.08 - t), R.pick([E[2], E[3]]), 1);
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 灵气：一道朝着原点的短线往里收，头（靠原点的一端）是月白、往后天青、石青；越近越快、越近越短，收到原点就没了
      for (const s of streams) {
        const u = (t - s.t0) / s.dur;
        if (u <= 0 || u >= 1) continue;
        const [x, y] = pos(s, u), d = Math.hypot(x, y) || 1, L = Math.min(s.len, d - 1);
        if (L < 1) continue;
        for (let j = 0; j <= L; j++) {
          const k = j / L;
          p.px(x + (x / d) * j, y + (y / d) * j, k < 0.2 ? C[4] : k < 0.6 ? C[3] : C[2]);
        }
      }
      // 符上白一下（两帧），之后一点天青的余光
      if (flashT >= 0) {
        const f = t - flashT;
        if (f < 0.067) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) p.px(dx, dy, f < 0.034 || (dx === 0 && dy === 0) ? WHITE : C[4]);
      }
      // 纸灰
      for (const q of ash) {
        const u = (t - q.t0) / q.life;
        if (u <= 0 || u >= 1) continue;
        const age = t - q.t0, x = q.x + q.vx * age + Math.sin(age * 7 + q.ph) * 1.5, y = q.y + q.vy * age;
        if (u > 0.75 && Math.floor(t * 30) % 2) continue;
        p.px(x, y, A[q.c]);
        if (Math.sin(age * 9 + q.ph) > 0) p.px(x + 1, y, A[1 - q.c]);
      }
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}
