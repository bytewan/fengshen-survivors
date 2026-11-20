// 灼烧（修仙版 · 三昧真火）：改自 pixelfx 的 status/burning（MIT，https://github.com/patch-gg/pixelfx）。
// 原作的火舌、余烬和细烟改编自 Sprite Fusion 的开源 fire (https://www.spritefusion.com/pixel-art-vfx/fire)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 不再碰人物本身：原作每 0.6 秒把整个身体刷白再刷橙、在衣服上画焦痕，这要知道人物这一帧的每个像素，
//   游戏里的敌人在走动，叠上去会错位；满场都在烧的时候整身闪白也太吵。现在只画火：三处火苗、往上飘的火星、几缕细烟。
// - 不依赖人物剪影：火苗的位置按身体的宽高（选项 body，默认 12×22）摆在头顶、一侧肩、另一侧腰。
//   这样一种体型只要预烘焙一份，所有敌人共用。
// - 去掉脚下那片跟着闪的暖光（人物脚下不要光），每处火苗的光从半径 9–15 收到 5。
// - 每 0.6 秒那一下「窜火」留着（火苗高一截、迸几粒火星），是灼烧跳伤害的节拍。
// - 火苗的芯子平时是灵光色，窜火的那一下才白（满场都在烧的时候不刺眼）；头顶那处偏到一侧、矮一点（正中的像一顶火帽子）。
// - 细烟只留三缕、团大一点、很淡：原来一粒粒小灰团在浅色地面上像脏点。
// - 画布从 72×80 收到 44×60。颜色全部收进色阶。
import { cycle, fit, hex, mix, rand } from "../../core/index.js";
import { tnoise, travel, tongue, smoke, ember } from "../status/_lib.js";
import { gp, snapOf } from "./_lib.js";

export const meta = {
  name: "灼烧 Burning (samadhi fire)",
  desc: "Burning over time, flames only: three small fires lick from the head, a shoulder and a hip, embers drift up, thin smoke curls off; every 0.6 s they flare and spit sparks.",
  tags: ["status", "fire", "burn", "dot", "debuff", "xianxia", "loop"],
  size: [44, 60],
  origin: [22, 50],
  duration: 1.2,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: gp("kRreoyYfW"), smoke: gp("h")[0], body: [12, 22], seed: 3 },
};

const D = meta.duration, TICK = 0.6, WIND = -8;
const since = (t) => (((t % TICK) + TICK) % TICK);
const flare = (t) => Math.exp(-since(t) / 0.14);
// 火苗的几层（宽、高、取火色阶的第几档：0 白 1 灵光 2 缃 4 橘 6 朱）：平时芯子是灵光，窜火的那一下才白
const CALM = [[1, 1, 6], [0.76, 0.84, 4], [0.5, 0.62, 2], [0.28, 0.38, 1]];
const HOT = [[1, 1, 6], [0.78, 0.88, 4], [0.56, 0.7, 2], [0.32, 0.44, 0]];

// 三处火苗：头顶、一侧肩、另一侧腰（按身体的宽高摆）
function spots(o) {
  const [w, h] = o.body, s = o.seed;
  return [
    { x: w * 0.16, y: -h + 2.5, n: 2, h: 4.2 },
    { x: -w * 0.38, y: -h * 0.6, n: 2, h: 3.8 },
    { x: w * 0.42, y: -h * 0.34, n: 2, h: 3.2 },
  ].map((sp, i) => ({ ...sp, tongues: Array.from({ length: sp.n }, (_, j) => ({ dx: (j - (sp.n - 1) / 2) * 1.7 + (rand(s, i, j) - 0.5) * 0.8, h: sp.h * (0.8 + 0.4 * rand(s, i, j, 2)), n: i * 17 + j * 5 + s })) }));
}

export function drawBack(p, t, o) {
  const F = fit(o.palette, 9).reverse(), list = spots(o), smokeC = mix(hex(o.smoke), F[6], 0.15);
  // 几缕细烟，顺着风往斜上方走
  cycle(t, D, 3, o.seed + 4, (r) => r.range(0.8, 1.1), (age, life, r, i) => {
    const sp = list[i % list.length], x = sp.x + travel(WIND * 0.6, WIND * 0.5, 0.8, age) + Math.sin(age * 4 + i) * 1.1, y = sp.y - 5 - travel(15, 5, 1, age);
    smoke(p, x, y, r.range(1.5, 2.1), age / life, smokeC, 0.4);
  });
}

export function draw(p, t, o) {
  const F = fit(o.palette, 9).reverse(), list = spots(o), ph = since(t), tick = Math.floor(t / TICK) % 2, fl = flare(t);
  // 火苗：平时小小地舔，跳伤害的那一下窜高
  for (const sp of list) {
    for (const tg of sp.tongues) {
      const h = tg.h * (0.85 + 0.25 * tnoise(t, D, 5, tg.n)) * (1 + 1.1 * fl);
      tongue(p, sp.x + tg.dx, sp.y, h, 1.1 + 0.3 * fl, WIND * 0.1 * h / 4 + tnoise(t, D, 3, tg.n + 9) * 0.8, F, t, D, tg.n, fl > 0.45 ? HOT : CALM);
    }
    p.glow(sp.x, sp.y - 2, 5, F[4], 0.25 + 0.3 * fl);
  }
  // 火星一粒粒往上飘
  cycle(t, D, 12, o.seed + 6, (r) => r.range(0.45, 0.75), (age, life, r, i) => {
    const sp = list[i % list.length], x = sp.x + r.range(-1.5, 1.5) + travel(WIND + r.range(-6, 4), WIND * 0.6, 1.2, age) + Math.sin(age * 9 + i) * 1.1 * age;
    const y = sp.y - 2 + travel(-r.range(16, 30), -10, 1.4, age);
    ember(p, x, y, age / life, [F[2], F[3], F[5]], age + i);
  });
  // 窜火的那一下，每处迸出几粒火星
  if (ph < 0.3)
    for (const [k, sp] of list.entries())
      for (let j = 0; j < 3; j++) {
        const an = -Math.PI / 2 + (rand(k, j, tick) - 0.5) * 2.2, v = 32 + 32 * rand(k, j, 2), x = sp.x + Math.cos(an) * travel(v, 0, 3, ph), y = sp.y - 2 + Math.sin(an) * travel(v, 0, 3, ph) + 50 * ph * ph;
        p.px(x, y, ph < 0.12 ? F[2] : F[4]);
        p.light(x, y, F[3], 0.4 * (1 - ph / 0.3));
      }
  snapOf(o, F, o.smoke)(p);
}
