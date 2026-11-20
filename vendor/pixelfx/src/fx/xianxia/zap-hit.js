// 雷击命中（修仙版）：改自 pixelfx 的 lightning/zap-hit（MIT，https://github.com/patch-gg/pixelfx）。
// 原作的电弧画法（外晕、弧身、白芯）、闪烁和临灭时一明一暗的光参照了 Sprite Fusion 的开源 lightning
// (https://www.spritefusion.com/pixel-art-vfx/lightning)，MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 整体缩到约六成（选项 scale）：原作画布 144×112，命中点那团电火花加雷纹有 60 多像素宽，比人物大两三倍。
// - 从左边劈进来的那道电弧改成选项 from（长度，默认 0 = 不画）：雷公鞭的连锁雷、五雷正法的落雷，游戏自己画雷，
//   这里只管「打中的那一下」。要的话给 from 和 aim（从哪个方向来）。
// - 辉光：原作命中时一盏半径 60 的灯、一团半径 40 的光一明一暗，收到半径 12 和 9。
// - 雷纹（命中点往外爬的那几道电痕）原作冷成深紫色、再抖着淡掉；现在只冷到琥珀，每一段烧够了就断，所以从命中点往外熄。
//   原作那缕「臭氧」的灰烟去掉了（浅色地面上是一块灰斑）。整个特效的颜色都收进色阶。
// - 画布左右对称（原点在正中）：aim 可以朝任何方向。
import { Particles, Lights, P, Rng, fit, clamp, rand, rng, TAU, WHITE } from "../../core/index.js";
import { VOLT, zigzag, stroke, crackle } from "../lightning/_lib.js";
import { gp, snapper } from "./_lib.js";

export const meta = {
  name: "雷击命中 Zap hit",
  desc: "A thunder hit: the point overloads into a knot of tiny crackling zigzags round a white heart, a fern of arcs crawls outward, cools and burns out from the middle, sparks jink away.",
  tags: ["lightning", "thunder", "electric", "hit", "impact", "combat", "xianxia", "one-shot"],
  size: [104, 88],
  origin: [52, 48],
  duration: 0.7,
  loop: false,
  fps: 30,
  bg: "dark",
  options: { palette: VOLT, ash: gp("h")[0], scale: 0.6, from: 0, aim: 0, seed: 3 },
};

// 雷纹：从命中点往外爬的几道分叉的电痕（利希滕贝格图样）
function fern(R, K) {
  const out = [];
  const grow = (x, y, a, len, w, d, depth) => {
    const pts = [[x, y, d]];
    let side = R.sign();
    for (let s = 0; s < len; s += 1.4) {
      a += R.range(-0.3, 0.3);
      x += Math.cos(a) * 1.4;
      y += Math.sin(a) * 1.4;
      d += 1.4;
      pts.push([x, y, d]);
      if (depth < 2 && s > 2 && R.chance(0.2)) {
        side = -side;
        grow(x, y, a + side * R.range(0.55, 1.05), (len - s) * R.range(0.3, 0.55), w * 0.6, d, depth + 1);
      }
    }
    out.push({ pts, w });
  };
  for (let i = 0; i < 5; i++) grow(0, 0, (i / 5) * TAU + R.range(-0.4, 0.4), R.range(16, 30) * K, 1, 0, 0);
  return out;
}

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed), K = o.scale, ps = new Particles({ rng: R }), lights = new Lights();
  const snap = snapper(C, o.ash);
  const SNAP = o.from > 0 ? 0.05 : 0, tree = fern(R, K);
  // 电弧从 aim 的反方向劈进来（aim 是这一下打过去的方向）
  const X0 = -Math.cos(o.aim) * o.from, Y0 = -Math.sin(o.aim) * o.from + (o.from > 0 ? R.range(-6, 3) : 0);
  // 会拐弯的火星：飞出去，每隔百分之几秒猛地换个方向
  const kinked = Array.from({ length: 10 }, () => {
    const a = R.range(0, TAU), sp = R.range(110, 220) * K;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: R.range(0.22, 0.4), age: -SNAP, next: R.range(0.02, 0.05), trail: [] };
  });
  let t = 0, hit = false;
  return {
    update(dt) {
      t += dt;
      if (!hit && t >= SNAP) {
        hit = true;
        lights.add(0, 0, 12, C[5], 0.6, 0.3);
      }
      for (const s of kinked) {
        if ((s.age += dt) < 0 || s.age >= s.life) continue;
        if ((s.next -= dt) <= 0) {
          s.next = R.range(0.03, 0.06);
          const sp = Math.hypot(s.vx, s.vy), a = Math.atan2(s.vy, s.vx) + R.sign() * R.range(0.6, 1.3);
          s.vx = Math.cos(a) * sp;
          s.vy = Math.sin(a) * sp;
          s.trail.push([s.x, s.y]);
          if (s.trail.length > 4) s.trail.shift();
        }
        s.vx -= s.vx * 3 * dt;
        s.vy -= s.vy * 3 * dt - 110 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
      ps.update(dt);
      lights.update(dt);
    },
    drawBack(p) {
      // 雷纹从命中点往外烧：先白，顺着色阶冷到琥珀；每一段烧够了就断掉，所以也是从命中点往外熄（不抖着淡掉，
      // 也不冷成深色：原来最后冷成黛蓝色的一片电痕，敌人走开以后像留在地上的划痕）
      if (t < SNAP) return;
      for (const br of tree)
        for (let i = 1; i < br.pts.length; i++) {
          const [x0, y0] = br.pts[i - 1], [x, y, d] = br.pts[i], age = t - SNAP - d / 170;
          if (age < 0) break;
          if (age > 0.3 + 0.12 * br.w + rand(o.seed, d, br.w) * 0.08) continue;
          const k = Math.exp(-age / 0.2), c = k > 0.75 ? WHITE : k > 0.45 ? C[6] : k > 0.28 ? C[5] : k > 0.14 ? C[4] : C[2];
          p.line(x0, y0, x, y, c);
          if ((i & 3) === 0) p.glow(x, y, 3, C[5], 0.3 * k);
        }
      ps.draw(p, "back");
      snap(p);
    },
    draw(p) {
      const f = Math.floor(t * 30 + 1e-4);
      // 电弧两帧劈进来，停住、闪几下，再松开
      if (o.from > 0 && t < 0.32) {
        const r = rng(o.seed, 2, f), b = zigzag(r, X0, Y0, 0, 0, 0.22, 0.3), u = clamp(t / SNAP);
        const k = t < SNAP ? 1 : t < 0.2 ? (f % 2 ? 0.7 : 1) : 0.55 * (1 - (t - 0.2) / 0.12);
        stroke(p, u < 1 ? { paths: [b.paths[0]] } : b, k, C, t < SNAP + 0.034 ? 0.8 : 0.6, { upTo: u, hero: t >= SNAP && t < SNAP + 0.034, light: 0.25 });
      }
      // 命中点过载：一团小闪电每帧重劈一次，围着一颗白心
      if (t >= SNAP && t < SNAP + 0.42) {
        const a = (t - SNAP) / 0.42, r = rng(o.seed, 5, f), R0 = (8 * K + 1.5) * (1 - a * 0.6), m = Math.round(8 * (1 - a * 0.5));
        for (let i = 0; i < m; i++) {
          const ang = r.range(0, TAU), d0 = r.range(0.5, R0 * 0.5), ang2 = ang + r.range(-1.2, 1.2), d1 = r.range(R0 * 0.55, R0);
          crackle(p, zigzag(r, Math.cos(ang) * d0, Math.sin(ang) * d0, Math.cos(ang2) * d1, Math.sin(ang2) * d1, 0.5, 0), 0.75 * (1 - a) + 0.25, C, 0.12);
        }
        p.circle(0, 0, 2.2 * (1 - a) + 0.8, C[5]);
        p.circle(0, 0, 1.4 * (1 - a) + 0.4, WHITE);
        p.glow(0, 0, 9, C[4], 0.5 * (1 - a) * (f % 2 ? 0.7 : 1));
      }
      // 火星：亮的头，身后那几折冷下去
      for (const s of kinked) {
        if (s.age < 0 || s.age >= s.life) continue;
        const k = 1 - s.age / s.life, path = [...s.trail, [s.x, s.y]];
        for (let i = 0; i < path.length - 1; i++) p.line(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], i === path.length - 2 ? (k > 0.5 ? WHITE : C[6]) : k > 0.5 ? C[5] : C[4], 0.6 + 0.4 * (i / path.length));
        p.px(s.x, s.y, k > 0.4 ? WHITE : C[5]);
        p.glow(s.x, s.y, 3, C[5], 0.35 * k);
      }
      ps.draw(p, "front");
      lights.draw(p);
      snap(p);
    },
  };
}
