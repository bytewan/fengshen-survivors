// 魔气缠身（修仙版 · 魔化哪吒、魔物身上的魔气）：参照 pixelfx 的 shadow/shadow-flames、status/burning（MIT，https://github.com/patch-gg/pixelfx）新做。
// 软团的画法（暗的身、受光的顶）参照了 Sprite Fusion 的开源 smoke (https://www.spritefusion.com/pixel-art-vfx)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 为什么新做（封神幸存者，2026-11-10）：
// - shadow-flames 是地上的一堆紫黑篝火加一根 90 像素高的烟柱，不是缠在身上的；把灼烧（xianxia/burning）换成魔气的色阶试过，
//   深色的火画在深色的魔化哪吒身上几乎看不见。
// - 这里是「黑焰」：肩、背、头顶偏后四处火舌，和三昧真火反过来——外沿胭脂紫、身紫棠、芯玄色，越往里越暗，
//   深色的人物边上靠那一圈胭脂紫立住；火舌隔一会儿窜高一截，尖上接着冒几缕真半透明的紫黑软团往上飘散，
//   几粒朱砂、桃红的火星往上窜、一明一暗。试过的「只有软团」在浅色地面上是一团团灰烟，不像魔气；脚下的暗雾像脏影子，去掉了。
//   循环 1.6 秒，没有辉光。不碰人物，按身体宽高（body）摆。
import { cycle, fit, TAU } from "../../core/index.js";
import { tnoise, tongue } from "../status/_lib.js";
import { gp, snapOf } from "./_lib.js";

export const meta = {
  name: "魔气缠身 Demon qi",
  desc: "Demonic qi clings to a body: black flames rimmed in violet lick up off the shoulders, back and head, surge now and then, thin into dark wisps above, cinnabar sparks flicker up.",
  tags: ["status", "aura", "demon", "shadow", "qi", "boss", "xianxia", "loop"],
  size: [52, 64],
  origin: [26, 52],
  duration: 1.6,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: gp("kPpm"), spark: gp("Rem"), body: [12, 24], seed: 6 },
};

const D = meta.duration;

// 黑焰的几层（宽、高、取色阶的第几档）：外沿胭脂紫、身紫棠、芯玄——和三昧真火反过来，越往里越暗
const LAYERS = [[1, 1, 1], [0.72, 0.8, 2], [0.42, 0.55, 3]];

export function draw(p, t, o) {
  const C = fit(o.palette, 4), F = [C[3], C[2], C[1], C[0]], S = fit(o.spark, 3), [w, h] = o.body;
  // 魔气的烟：几缕真半透明的紫黑软团，从火舌的尖上接着往上飘、胀开、变淡
  cycle(t, D, 6, o.seed, (r) => r.range(0.8, 1.15), (age, life, r, i) => {
    const u = age / life, sp = SPOTS[i % SPOTS.length], x = sp[0] * w + Math.sin(age * 4 + r.next() * TAU) * 1.4, y = sp[1] * h - 5 - u * r.range(9, 13);
    const rad = r.range(1.6, 2.4) * (0.7 + u * 0.7), a = Math.min(1, u * 5) * Math.pow(1 - u, 1.1);
    p.disc(x, y, rad, C[1], a * 0.5);
    p.disc(x - rad * 0.2, y - rad * 0.35, rad * 0.5, C[2], a * 0.45);
  });
  // 黑焰：肩、背、头侧几处火舌，平时小小地舔，隔一会儿窜高一截
  for (const [k, sp] of SPOTS.entries()) {
    const n = k * 13 + o.seed, surge = Math.max(0, Math.sin((t / D) * TAU * 2 + k * 1.7)) ** 3;
    for (let j = 0; j < 2; j++) {
      const hh = sp[2] * (0.85 + 0.25 * tnoise(t, D, 4, n + j)) * (1 + 0.6 * surge);
      tongue(p, sp[0] * w + (j - 0.5) * 1.6, sp[1] * h, hh, 1.1, sp[0] * -2 + tnoise(t, D, 3, n + j + 7) * 0.8, F, t, D, n + j, LAYERS);
    }
  }
  // 火星：一粒粒往上窜，一明一暗
  cycle(t, D, 6, o.seed + 3, (r) => r.range(0.4, 0.65), (age, life, r) => {
    const u = age / life, x = r.range(-w / 2 - 1, w / 2 + 1) + Math.sin(age * 9 + r.next() * TAU) * 0.8, y = -h * r.range(0.4, 0.95) - u * r.range(10, 18);
    if (u > 0.7 && Math.sin(age * 40) < 0) return;
    p.px(x, y, u < 0.4 ? S[2] : u < 0.75 ? S[1] : S[0]);
  });
  snapOf(o, C, S)(p);
}

// 火舌的位置（按身体宽高的比例）和高度：两肩、背后一侧、头顶偏后（画面朝右；朝左的敌人放的时候 flip）。
// 不放在脸上：头上那一处在后脑勺
const SPOTS = [[-0.45, -0.62, 7], [0.45, -0.58, 5.5], [-0.22, -1, 8], [-0.4, -0.3, 5]];
