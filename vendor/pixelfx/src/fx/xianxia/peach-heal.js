// 蟠桃回血（修仙版）：参照 pixelfx 的 pickups/heart-pickup 和 nature/healing-bloom（MIT，https://github.com/patch-gg/pixelfx）
// 新做的拾取效果；光点上升的做法参照了 Sprite Fusion 的开源 heal (https://www.spritefusion.com/pixel-art-vfx/heal)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 为什么新做（封神幸存者，2026-11-10）：
// - 原作是一颗会跳的西式红心、一圈往外扩的细环、飘走的小心形；回血类的特效常见的「十字」也是西式医疗的符号：都不要。
// - 这里是吃下蟠桃的那一下（游戏的蟠桃精灵自己往上一浮、化开）：一团很淡的桃红软光从人物身上化开，
//   九片桃花瓣（三像素、亮角月白）迸出来、翻着往两边飘落，十来缕灵光、桃红的细光贴着身子两侧往上升（回血），1 秒收完，约 32×32 像素。
//   没有圈，没有十字，辉光只在光点上。原点 = 人物脚下。
// - 选项 glow（默认 1）：身上那团化开的软光和它的辉光乘多少。接进战斗时给 0（fx-wire，2026-11-11）：
//   软光是盖在人物身上的一团桃红（用户口径：人物身上不要光晕），只留花瓣和贴着身子两侧升起的光点。
import { Particles, Lights, Rng, fit, clamp, TAU, WHITE } from "../../core/index.js";
import { gp, snapper } from "./_lib.js";

export const meta = {
  name: "蟠桃回血 Peach heal",
  desc: "Eating a peach of immortality: a faint peach-pink glow melts off the body, blossom petals pop out and tumble down to both sides, motes of light rise up the body as it heals.",
  tags: ["pickup", "heal", "peach", "petal", "restore", "xianxia", "one-shot"],
  size: [56, 56],
  origin: [28, 44],
  duration: 1,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("pmwf"), height: 22, petals: 9, glow: 1, seed: 5 },
};

export function create(o) {
  const C = fit(o.palette, 4), R = new Rng(o.seed), H = o.height, YEL = gp("Y")[0], snap = snapper(C, YEL);
  const lights = new Lights(), ps = new Particles({ rng: R });
  // 花瓣：两像素的一片（深一点的胭脂、桃红，带一点月白），翻着飘：一会儿横一会儿竖
  const petals = Array.from({ length: o.petals }, (_, i) => {
    const side = i % 2 ? 1 : -1, a = -Math.PI / 2 + side * R.range(0.4, 1.2);
    const sp = R.range(30, 55);
    return { x: R.range(-3, 3), y: -H * R.range(0.45, 0.7), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t0: R.range(0, 0.08), life: R.range(0.6, 0.9), flip: R.range(7, 12), ph: R.range(0, TAU), c: R.chance(0.6) ? 1 : 0 };
  });
  // 回血的光点：顺着身子往上升，头亮尾暗的一小截
  // 光大多贴着身子两侧升（压在人物身上看不清，尤其是穿红衣的哪吒）
  const motes = Array.from({ length: 12 }, (_, i) => ({ x: Math.round((i % 2 ? 1 : -1) * (i % 3 ? R.range(5, 9) : R.range(0, 4))), y: -R.range(1, H * 0.45), vy: -R.range(30, 46), t0: R.range(0.05, 0.5), life: R.range(0.4, 0.6), c: R.chance(0.65) ? 3 : 1 }));
  if (o.glow > 0) lights.add(0, -H * 0.55, 10, C[1], 0.35 * o.glow, 0.4);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (const q of petals) {
        if (t < q.t0) continue;
        q.vx -= q.vx * 2.2 * dt;
        q.vy += (60 - q.vy * 2.2) * dt; // 先迸出去，再慢慢往下飘
        q.x += (q.vx + Math.sin(t * 6 + q.ph) * 6) * dt;
        q.y += q.vy * dt;
      }
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 化开的软光：两团很淡的桃红（真半透明），胀开、变淡
      const g = t / 0.55;
      if (g < 1 && o.glow > 0) {
        const a = Math.min(1, g * 8) * (1 - g) * o.glow;
        p.disc(0, -H * 0.55, 5 + g * 6, C[1], 0.4 * a);
        p.disc(-1, -H * 0.62, 3 + g * 4, C[2], 0.4 * a);
      }
      // 光点
      for (const m of motes) {
        const u = (t - m.t0) / m.life;
        if (u <= 0 || u >= 1) continue;
        if (u > 0.8 && Math.floor(t * 30) % 2) continue;
        const y = m.y + m.vy * (t - m.t0) * (1 - 0.35 * u);
        // 往上升的一小截光：头亮，身后两像素冷下去
        p.px(m.x, y, u < 0.6 ? C[m.c] : C[2]);
        if (u < 0.8) p.px(m.x, y + 1, m.c === 3 ? YEL : C[1]);
        if (u < 0.5) p.px(m.x, y + 2, m.c === 3 ? C[1] : C[0]);
        p.light(m.x, y, C[m.c], 0.25 * (1 - u));
      }
      // 花瓣
      for (const q of petals) {
        const u = (t - q.t0) / q.life;
        if (u <= 0 || u >= 1) continue;
        if (u > 0.8 && Math.floor(t * 30) % 2) continue; // 最后几帧一明一暗地化掉
        // 一片花瓣三个像素（缺一角的 2×2），翻着飘：正反两个朝向轮换；亮的一角是月白
        const flat = Math.sin(t * q.flip + q.ph) > 0, c = C[q.c], hi = u < 0.55 ? C[2] : C[1];
        if (flat) (p.px(q.x, q.y, hi), p.px(q.x + 1, q.y, c), p.px(q.x, q.y + 1, c));
        else (p.px(q.x + 1, q.y, hi), p.px(q.x, q.y, c), p.px(q.x + 1, q.y + 1, c));
      }
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}
