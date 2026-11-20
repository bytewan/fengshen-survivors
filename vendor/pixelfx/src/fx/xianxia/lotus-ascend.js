// 突破（修仙版的「升级 / 悟功法」）：参照 pixelfx 的 ui/level-up（MIT，https://github.com/patch-gg/pixelfx）重做。
// 光点上升、落定的做法参照了 Sprite Fusion 的开源 level up / heal (https://www.spritefusion.com/pixel-art-vfx)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 为什么重做（封神幸存者，2026-11-10）：
// - 原作是西式的「升级」：一道光柱从脚下升天、几圈光环往上套、再弹出一行字。光柱光环都不要，字由游戏自己出。
// - 修仙的「突破」：脚下一朵金莲由合到开（八瓣，俯视压扁；远的半边先画、近的半边后画），开到一半时一道金线从莲心
//   顺着身子往上一冲（细线，不是光柱），到头顶化成几点灵光；两侧几团淡金的云气贴着地往外翻开、飘散；
//   莲花开足停一会儿，花瓣边上一闪一闪地冒金光点；最后一瓣瓣从尖上化成金色的光点往上飘。2 秒收完，约 30×40 像素。
// - 辉光只在金线和光点上，很小；没有地上的光圈（金莲是花瓣，不是发光的圆）。原点 = 人物脚下。
import { Particles, Lights, P, Rng, fit, clamp, smooth, ease, TAU, WHITE } from "../../core/index.js";
import { gp, snapper, rim, SY } from "./_lib.js";

export const meta = {
  name: "突破 Breakthrough (lotus)",
  desc: "A breakthrough: a golden lotus opens under the feet, a thin gold line shoots up the body into motes, gold cloud rolls out at the sides, petals glint, then melt into rising gold.",
  tags: ["ui", "level-up", "breakthrough", "lotus", "gold", "buff", "xianxia", "one-shot"],
  size: [72, 72],
  origin: [36, 56],
  duration: 2,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("BbyYfW"), cloud: gp("jwY"), petals: 8, size: 8, height: 32, seed: 3 },
};

const OPEN = 0.45; // 莲花开足的时刻

export function create(o) {
  const C = fit(o.palette, 6), CL = fit(o.cloud, 3), R = new Rng(o.seed), N = o.petals, L = o.size, H = o.height;
  const snap = snapper(C, CL);
  const ps = new Particles({ rng: R }), lights = new Lights();
  // 花瓣：围着莲心一圈，远的半边（sin < 0）先画；每瓣开、化的时刻错开一点
  const petals = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * TAU + 0.2 + R.range(-0.05, 0.05);
    return { a, len: L * R.range(0.92, 1.05), w: L * 0.36, open: 0.05 + (1 - Math.sin(a)) * 0.06 + R.range(0, 0.03), melt: 1.25 + R.range(0, 0.25), done: false };
  }).sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
  // 云气：两侧几团，贴着地往外翻
  const clouds = Array.from({ length: 6 }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    return { x: side * R.range(3, 6), y: R.range(-1, 2), vx: side * R.range(14, 24), r: R.range(2.4, 3.6), t0: 0.25 + R.range(0, 0.25), life: R.range(0.7, 1) };
  });
  let t = 0, shot = false;
  const petal = (p, q, k, melt) => {
    // k：开了多少（0..1，带一点过冲）；melt：从尖上化掉了多少。
    // 俯视 3/4 的莲花是个碗：瓣尖往上翘，远的半边翘得高（看得见瓣面），近的半边低。每瓣自带一圈琥珀色的边，
    // 前面的瓣压在后面的瓣上时，靠这道边分得出一瓣一瓣（不描边就糊成一团黄）
    const ca = Math.cos(q.a), sa = Math.sin(q.a), full = q.len * Math.min(1.08, k), len = full * (1 - melt), r0 = 2;
    if (len < 0.8) return;
    const cup = (1.2 + 2.6 * Math.max(0, -sa)) * Math.min(1, k) + (1 - Math.min(1, k)) * 4;
    for (let d = 0; d <= len; d += 0.5) {
      const u = d / Math.max(1e-3, full), hw = q.w * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.06)), 0.7);
      for (let s = -hw; s <= hw; s += 0.5) {
        const lx = ca * (r0 + d) - sa * s, ly = (sa * (r0 + d) + ca * s) * SY - cup * u * u;
        const side = s / Math.max(0.5, hw), edge = Math.abs(s) > hw - 0.7 || u > 0.94;
        const c = edge ? C[1] : u > 0.78 ? C[4] : u < 0.3 ? C[2] : side < -0.2 ? C[3] : C[2];
        p.px(lx, ly, c);
      }
    }
  };
  return {
    update(dt) {
      t += dt;
      // 金线冲上去，到头顶化成几点灵光
      if (!shot && t >= OPEN * 0.6) {
        shot = true;
        lights.add(0, -H * 0.5, 10, C[3], 0.45, 0.5);
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + R.range(-1.2, 1.2), sp = R.range(14, 34);
          ps.spawn(P.STAR, 0, -H, Math.cos(a) * sp, Math.sin(a) * sp - 6, R.range(0.5, 0.8), R.chance(0.5) ? C[4] : C[3], R.range(0.6, 0.95), 0.12);
        }
      }
      // 开足以后，花瓣边上冒金光点
      if (t > OPEN && t < 1.3 && R.chance(0.35)) {
        const q = R.pick(petals), d = 2.2 + q.len * R.range(0.5, 1);
        ps.spawn(P.STAR, Math.cos(q.a) * d, Math.sin(q.a) * d * SY, R.range(-3, 3), -R.range(10, 22), R.range(0.4, 0.7), R.chance(0.5) ? C[4] : C[3], R.range(0.5, 0.9));
      }
      // 化掉：每瓣化的时候冒两三粒往上飘的金光点
      for (const q of petals)
        if (!q.done && t >= q.melt) {
          q.done = true;
          for (let i = 0; i < 3; i++) {
            const d = 2.2 + q.len * R.range(0.3, 0.9);
            const delay = R.range(0, 0.15);
            ps.spawn(P.STAR, Math.cos(q.a) * d, Math.sin(q.a) * d * SY, R.range(-4, 4), -R.range(14, 28), Math.min(R.range(0.35, 0.5), meta.duration - 0.06 - t - delay), R.pick([C[4], C[3], C[3]]), R.range(0.6, 0.95), delay);
          }
        }
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 云气（真半透明，压在最底下）
      for (const c of clouds) {
        const u = (t - c.t0) / c.life;
        if (u <= 0 || u >= 1) continue;
        const age = t - c.t0, x = c.x + c.vx * age * (1 - 0.4 * u), r = c.r * (0.8 + 0.7 * u), a = Math.min(1, u * 5) * Math.pow(1 - u, 1.2);
        p.disc(x, c.y - u * 3, r, CL[1], a * 0.5);
        p.disc(x - r * 0.2, c.y - u * 3 - r * 0.35, r * 0.5, CL[2], a * 0.45);
      }
      // 金莲
      for (const q of petals) {
        const k = t < q.open ? 0 : ease.outBack(clamp((t - q.open) / (OPEN - q.open)), 1.6), melt = smooth(q.melt, q.melt + 0.35, t);
        if (k <= 0 || melt >= 1) continue;
        petal(p, q, k, melt);
      }
      if (t > 0.05 && t < 1.6) {
        // 莲心：一小团缃色，开足时白一下
        const white = t > OPEN && t < OPEN + 0.067;
        p.ellipse(0, 0, 2.2, 1.4, white ? WHITE : C[3]);
        p.px(0, 0, white ? WHITE : C[4]);
      }
      rim(p, -L - 6, -L - 8, L + 6, L * SY + 4, C[0], t < 1.5 ? 1 : 0.5);
      // 金线：从莲心往上一冲（0.12 秒冲到头顶），停一下，从下往上收掉
      const s0 = OPEN * 0.6, u = t - s0;
      if (u > 0 && u < 0.55) {
        const top = -H * ease.outCubic(clamp(u / 0.12)), bottom = -H * smooth(0.18, 0.5, u);
        for (let y = Math.floor(bottom); y >= top; y--) {
          const k = (bottom - y) / Math.max(1, bottom - top);
          p.px(0, y, y - top < 2 ? WHITE : k > 0.6 ? C[4] : C[3]);
        }
        if (u < 0.12) p.px(0, top - 1, WHITE);
        p.glowLine?.(0, bottom, 0, top, 2, C[3], 0.25);
      }
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}
