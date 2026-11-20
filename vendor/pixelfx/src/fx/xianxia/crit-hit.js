// 暴击（修仙版）：改自 pixelfx 的 impacts/crit-hit（MIT，https://github.com/patch-gg/pixelfx）。
// 原作的星芒、它的几个主帧和火星改编自 Sprite Fusion 的开源 impact (https://www.spritefusion.com/pixel-art-vfx/impact)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 去掉那一圈「先胀开、再碎成几段弧飞出去」的圆环（游戏里不要冲击波圆环），也去掉横竖两道的十字镜头光。
//   换成斜着划过这一下的一道细长金线（剑痕，选项 cut 是它和来向的夹角），星芒收掉以后还留一会儿。
// - 整体缩小（选项 scale，默认 0.42）：原作画布 216×136、星芒加镜头光有 130 像素宽；现在星芒约 22 像素、剑痕约 30 像素，
//   和人物差不多大。暴击和一般命中（hit-spark）的区别靠细节和动态：星芒多一倍的尖、白的那两帧描朱砂边、有剑痕、
//   金屑翻着落下、四周闪几粒星，而不是更大。
// - 节奏放慢：星芒从 4 帧拉到 8 帧（白 1 帧、过冲 1 帧、冷成缃色 2 帧、落成金色 2 帧、变细散掉 2 帧），金屑和星光多留一会儿，总长 0.9 秒。
//   原作落定以后是一大块朱砂、橘色的实心星，缩小以后成了一团糊的色块，去掉了：冷下去只走金色这一路（藤黄、琥珀）。
// - 辉光：原作三盏灯（半径 30–84）加两团光（半径 44–56），只留一盏半径 12 的和心上一小团。
// - 颜色全部收进色阶。画布左右对称（原点在正中）：aim 可以朝任何方向。
import { Particles, Bits, Lights, P, B, Rng, fit, TAU, WHITE } from "../../core/index.js";
import { spikes, star } from "../impacts/_lib.js";
import { gp, snapper } from "./_lib.js";

export const meta = {
  name: "暴击 Critical hit",
  desc: "A critical hit: a jagged starburst slams in white with a cinnabar rim, overshoots, cools to gold, a thin sword-line cuts across it, sparks spray, gold slivers tumble, glints wink.",
  tags: ["impact", "hit", "crit", "critical", "combat", "directional", "xianxia", "one-shot"],
  size: [112, 88],
  origin: [56, 70],
  duration: 0.9,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("BbeoyYfW"), sparks: gp("WYyb"), height: 12, aim: 0.12, cut: -0.5, scale: 0.42, seed: 3 },
};

// 星芒的主帧：[从第几秒起, 放大, 粗细, 颜色（边、身、里、心）在色阶里的第几档]
// 色阶（默认）：0 赭 1 琥珀 2 朱砂 3 橘 4 藤黄 5 缃 6 灵光 7 白
const KEYS = [
  [0, 1, 1, [2, 7, 7, 7]], // 白，描朱砂边
  [0.034, 1.2, 0.85, [2, 6, 7, 7]], // 过冲
  [0.067, 1.12, 0.75, [1, 5, 6, 7]], // 冷下去：缃
  [0.134, 1, 0.6, [1, 4, 5, 6]], // 落成金色
  [0.2, 0.92, 0.42, [1, 4, 5, 6]], // 变细、抖着散掉
  [0.267],
];

// 剑痕：一道金线，中间粗而白，两头细而冷；k 从 1 到 0 收掉（先从两头缩短，再抖掉）
function swordLine(p, x, y, a, L, k, C) {
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const s of [-1, 1])
    for (let d = 0; d <= L; d += 0.5) {
      const u = d / L, al = u < 0.7 ? 1 : k * (1.6 - u);
      p.dot(x + s * ca * d, y + s * sa * d, u < 0.3 ? WHITE : u < 0.6 ? C[6] : u < 0.85 ? C[5] : C[4], al);
      if (u < 0.3) for (const e of [-1, 1]) p.dot(x + s * ca * d - sa * e * 0.5, y + s * sa * d + ca * e * 0.5, u < 0.14 ? C[6] : C[4], u < 0.2 ? 1 : k);
    }
}

export function create(o) {
  const C = fit(o.palette, 8), S = fit(o.sparks, 4), R = new Rng(o.seed), K = o.scale, X = 0, Y = -o.height, A = o.aim, floor = () => 0;
  const snap = snapper(C, S);
  const ps = new Particles({ rng: R, ground: floor, sparks: S });
  const bits = new Bits({ ground: floor }), lights = new Lights();
  const sp = spikes(R, 10, A, { len: [12 * K, 15 * K], w: [1.3 * K + 0.4, 1.7 * K + 0.4], fwd: 0.9, back: 0.45, jag: 0.55 });
  [...sp].sort((a, b) => b.len - a.len).slice(0, 2).forEach((s) => (s.len *= 1.25));
  const CUT = A + o.cut, LINE = 40 * K;

  lights.add(X, Y, 12, C[5], 0.5, 0.3);
  // 火星：大多顺着这一下溅出去，少数往回弹
  for (let i = 0; i < 12; i++) {
    const back = R.chance(0.22), a = (back ? A + Math.PI : A) + R.range(-1, 1) * (back ? 0.6 : 0.8), v = R.range(130, 300) * K * (back ? 0.6 : 1);
    ps.spawn(P.SPARK, X, Y, Math.cos(a) * v, Math.sin(a) * v - 40, R.range(0.25, 0.55), WHITE, 1, R.chance(0.3) ? R.range(0, 0.06) : 0);
  }
  // 金屑：几片亮的碎片翻着落下，弹一下，停住（星芒散掉的那一刻崩出来）
  for (let i = 0; i < 6; i++) {
    const a = A + R.range(-1, 1) * 1.2 - 0.35, v = R.range(90, 200) * K;
    bits.add({ kind: B.SHARD, x: X, y: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 0.6, drag: 0.7, bounce: 0.35, life: R.range(0.55, 0.8), a: R.range(0, TAU), va: R.range(-25, 25), s: R.range(1.8, 3), c: R.pick([C[6], C[5], C[5], C[4]]) });
  }
  // 往上飘走的几粒金光，和这一下之后在四周闪的星
  for (let i = 0; i < 4; i++) {
    const a = A - Math.PI / 2 + R.range(-1.4, 1.4), v = R.range(30, 80) * K;
    ps.spawn(P.MOTE, X + Math.cos(a) * 3, Y + Math.sin(a) * 3, Math.cos(a) * v, Math.sin(a) * v - 12, R.range(0.4, 0.7), R.pick([C[5], C[4], C[4]]), 0.6, R.range(0, 0.08));
  }
  for (let i = 0; i < 3; i++) {
    const a = R.range(0, TAU), d = R.range(10, 18) * (K / 0.45);
    ps.spawn(P.STAR, X + Math.cos(a) * d, Y + Math.sin(a) * d * 0.8, 0, -4, R.range(0.25, 0.4), R.chance(0.5) ? C[5] : C[6], R.range(0.8, 1.3), R.range(0.15, 0.45));
  }

  let t = 0;
  return {
    update(dt) {
      t += dt;
      ps.update(dt);
      bits.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 星芒砸进来：一帧白、过冲、冷下去、落定、碎开
      for (let i = 0; i < KEYS.length - 1; i++)
        if (t >= KEYS[i][0] && t < KEYS[i + 1][0]) {
          const [, sc, th, cols] = KEYS[i];
          star(p, X, Y, sp, sc, th, cols.map((j) => C[j]), i === KEYS.length - 2 ? 1 - (0.6 * (t - KEYS[i][0])) / 0.067 : 1, 1.7 * K + 0.5);
        }
      // 剑痕：星芒过冲的时候一下划开（压在星芒上面），然后慢慢从两头收
      const f = (t - 0.034) / 0.45;
      if (f > 0 && f < 1) swordLine(p, X, Y, CUT, LINE * Math.min(1, f * 8) * Math.pow(1 - f, 0.8) + 1.5, 1 - f, C);
      bits.draw(p);
      ps.draw(p);
      const pop = Math.exp(-t / 0.07);
      if (pop > 0.02) p.glow(X, Y, 7, WHITE, 0.45 * pop);
      lights.draw(p);
      snap(p);
    },
  };
}
