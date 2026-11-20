// 开宝匣（修仙版 · 乾坤宝匣）：参照 pixelfx 的 pickups/chest-open（MIT，https://github.com/patch-gg/pixelfx）重做的「开匣」那一下。
// 落地闪的星光、金尘参照了 Sprite Fusion 的开源 pickup (https://www.spritefusion.com/pixel-art-vfx/pickup)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 为什么重做（封神幸存者，2026-11-10）：
// - 原作自己画一只西式的铁箍木箱，开盖前抖三下。游戏里的乾坤宝匣（紫檀描金、正面嵌金八卦）有自己的精灵和开盖帧，
//   所以这里不画匣子，只画开盖那一刻「匣里涌出来的东西」，叠在游戏的宝匣上（原点 = 宝匣底边正中，mouth = 匣口离地多高）。
// - 原作开盖后九道光柱扇形往上照、地上铺一汪光，收集时一圈圆环弹开：都是光柱光环，去掉。换成：
//   匣口一道金白的光一闪（两帧），涌出一团金色的光雾往上飘散（真半透明的软团），两侧升起两缕卷头的瑞气（祥云的卷），
//   几枚金元宝和灵石从匣口弹出、划弧落在两边、弹一下，停一会儿闪一下，化成金尘往上飘。
// - 金币、红绿蓝紫的西式宝石换成元宝和灵石（灵石和游戏里掉的那种一样：天青晶粒描玄边）。
// - 4.6 秒收到 1.8 秒（拾取时放，不能一直挡着画面）；只有一盏半径 14 的小灯，没有大范围的光。
import { Particles, Lights, P, Rng, fit, clamp, smooth, ease, sparkle, TAU, WHITE } from "../../core/index.js";
import { gp, snapper, art, stamp } from "./_lib.js";

export const meta = {
  name: "开宝匣 Treasure box burst",
  desc: "A treasure box opens: a white-gold flash at its mouth, golden haze swells, two hooked wisps of auspicious qi rise, gold ingots and spirit stones arc out, glint and turn to dust.",
  tags: ["pickup", "chest", "treasure", "loot", "reward", "gold", "xianxia", "one-shot"],
  size: [104, 92],
  origin: [52, 78],
  duration: 1.8,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("BbyYfW"), mouth: 10, width: 13, loot: 5, seed: 6 },
};

// 元宝（8×5：两头翘起的耳、正中鼓起的元宝顶带一粒高光）和灵石（3×5，和游戏里掉的灵石一样）
const INGOT = art(["...ff...", "Y.yYYy.Y", "YyyyyyyY", ".ByyyyB.", "..BBBB.."]);
const STONE = art([".k.", "kCk", "kWk", "kck", ".k."]);
const SPRITE_COLORS = gp("YyfbBkCWc");

export function create(o) {
  const C = fit(o.palette, 6), R = new Rng(o.seed), M = -o.mouth, HW = o.width / 2;
  const snap = snapper(C, SPRITE_COLORS);
  const ps = new Particles({ rng: R, ground: () => 0, sparks: [WHITE, C[4], C[3], C[2]] }), lights = new Lights();
  // 宝物：从匣口弹出、划弧落到两边（落点前后错开一点，俯视的地面是一片）、弹一下停住；停一会儿闪一下化成金尘
  const loot = Array.from({ length: o.loot }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    return {
      pic: i % 3 === 2 ? STONE : INGOT, x: R.range(-3, 3), y: M, vx: side * R.range(16, 40), vy: -R.range(80, 108), t0: 0.04 + i * 0.05 + R.range(0, 0.03),
      floor: R.range(-3, 5), bounced: false, rest: -1, glint: R.range(0.2, 0.32), gone: false,
    };
  });
  // 瑞气：一缕从匣口往上斜着升、左右轻轻摆，到头往里卷一个小钩（祥云的卷头）。按一步一像素走出一串点
  const wisp = (side, t0) => {
    const pts = [];
    let x = side * R.range(1.5, 3), y = M - 1, a = -Math.PI / 2 + side * 0.3;
    const n = 24 + R.int(0, 5), curl = 9, ph = R.range(0, TAU);
    for (let i = 0; i < n + curl; i++) {
      // 卷头越卷越紧（螺旋往里收），卷大半圈就停：开口的钩，不是闭合的小圈
      a += i < n ? side * (0.012 + 0.05 * Math.sin(i * 0.3 + ph)) : -side * (0.28 + 0.05 * (i - n));
      x += Math.cos(a);
      y += Math.sin(a);
      pts.push([x, y, i < n ? 1 - i / (n + curl) : 0.25]);
    }
    return { pts, t0, side };
  };
  const wisps = [wisp(-1, 0.06), wisp(1, 0.12)];
  // 光雾：几团金色的软光从匣口涌出、往上飘、胀开、变淡
  const haze = Array.from({ length: 6 }, (_, i) => ({ x: R.range(-HW * 0.5, HW * 0.5), y: M - 1, vx: R.range(-6, 6), vy: -R.range(16, 30), r: R.range(3, 4.5), t0: i * 0.06, life: R.range(0.6, 0.85), c: i % 3 === 0 ? 5 : 4 }));
  let t = 0, opened = false;
  return {
    update(dt) {
      t += dt;
      if (!opened) {
        opened = true;
        lights.add(0, M - 2, 14, C[4], 0.55, 0.5);
      }
      // 匣口一直往外冒几粒金光
      if (t < 0.9 && R.chance(0.5)) ps.spawn(P.STAR, R.range(-HW + 1, HW - 1), M, R.range(-8, 8), -R.range(16, 40), R.range(0.35, 0.7), R.chance(0.5) ? C[5] : C[4], R.range(0.5, 0.95));
      for (const b of loot) {
        if (t < b.t0 || b.gone) continue;
        if (b.rest < 0) {
          b.vy += 420 * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.vy > 0 && b.y >= b.floor) {
            b.y = b.floor;
            if (!b.bounced) (b.bounced = true), (b.vy = -b.vy * 0.28), (b.vx *= 0.5);
            else b.rest = t;
          }
        } else if (t - b.rest > b.glint + 0.12 || t > meta.duration - 0.5) {
          // 化成金尘
          b.gone = true;
          for (let i = 0; i < 4; i++) ps.spawn(P.STAR, b.x + R.range(-2, 2), b.y - 1, R.range(-6, 6), -R.range(12, 26), R.range(0.3, 0.5), R.pick([C[5], C[4], C[4]]), R.range(0.5, 0.9));
        }
      }
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 光雾（真半透明，先画，压在最底下）
      for (const h of haze) {
        const u = (t - h.t0) / h.life;
        if (u <= 0 || u >= 1) continue;
        const age = t - h.t0, x = h.x + h.vx * age, y = h.y + h.vy * age * (1 - 0.3 * u), r = h.r * (0.8 + 0.9 * u), a = Math.min(1, u * 6) * Math.pow(1 - u, 1.3);
        p.disc(x, y, r, C[h.c], a * 0.42);
        p.disc(x - r * 0.2, y - r * 0.3, r * 0.5, C[5], a * 0.35);
      }
      // 瑞气：头先长出去，尾巴再跟上收掉。是一条真半透明的金色软带（根上两像素宽、往上收成一像素），
      // 头上那一截是实的亮色；实的一像素细线画出来像两根触须
      for (const w of wisps) {
        const u = t - w.t0;
        if (u <= 0) continue;
        const n = w.pts.length, head = Math.floor(n * ease.outCubic(clamp(u / 0.55))), tail = Math.floor(n * smooth(0.5, 1.25, u));
        const seen = new Set();
        const put = (x, y, c, a) => {
          const key = Math.floor(x) * 4096 + Math.floor(y);
          if (seen.has(key)) return;
          seen.add(key);
          p.blend(x, y, c, a);
        };
        for (let i = head - 1; i >= tail; i--) {
          const [x, y, wd] = w.pts[i], k = (head - i) / Math.max(1, head - tail), fade = Math.min(1, (i - tail + 1) / 6);
          if (k < 0.1) p.px(x, y, WHITE);
          else if (k < 0.3) p.px(x, y, C[4]);
          else put(x, y, k < 0.65 ? C[4] : C[3], 0.85 * fade);
          if (wd > 0.45) put(x + w.side, y, C[3], 0.6 * fade);
        }
      }
      // 宝物
      for (const b of loot) {
        if (t < b.t0 || b.gone) continue;
        stamp(p, b.pic, b.x - b.pic.w / 2, b.y - b.pic.h + 1);
        if (b.rest >= 0) {
          const g = t - b.rest - b.glint;
          if (g > 0 && g < 0.12) sparkle(p, b.x + 1, b.y - b.pic.h + 1, g < 0.06 ? 2 : 1, C[5], C[3], 0.25);
        }
      }
      // 开盖那一下：匣口一道扁的金白光，两帧
      if (t < 0.067) p.ellipse(0, M, HW + 1.5, 2.2, (d) => (d > 0.75 ? C[3] : d > 0.4 ? C[4] : WHITE));
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}
