// 刀光 / 剑气（修仙版）：改自 pixelfx 的 melee/sword-slash（MIT，https://github.com/patch-gg/pixelfx）。
// 原作的月牙、回声、拖痕、刀尖一亮和火星改编自 Sprite Fusion 的开源 slash
// (https://www.spritefusion.com/pixel-art-vfx/slash)，MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 月牙的位置、朝向、大小全部做成选项。原作是侧视的小人头顶往下劈的一刀，圆心、倾角、起止角都写死。
//   游戏是俯视 3/4、法宝自动索敌：现在给 aim（朝哪边，地面上的角度）、arc（半张角）、radius（多远）、sy（纵向压扁），
//   月牙就是地面上以人物为圆心的一段弧，和化血神刀的扇面对得上。mid: 1 时改成「月牙的中点落在原点上」，给飞刀穿过敌人那一下用。
// - 不带角色动作（act）：游戏有自己的人物。
// - 辉光：原作沿月牙一串半径 17 的光、刀头一团半径 40 的光，收到半径 4–6。
// - 节奏略放慢：扫过 0.08 秒、停 0.1 秒、拖 0.32 秒（原作 0.06 / 0.06 / 0.24）。
// - 月牙走过的痕改成真半透明的一像素残影（原来抖动画出来淡下去时是一串零星的点）；甩出的亮屑只用单像素的星；刀尖那一闪收小。
// - 月牙外沿描一圈色阶里的深色（只在它还亮的时候）：浅色地面上白边会发飘。颜色全部收进色阶。
// - 只在月牙的包围盒里逐像素算（原作算整个圆的外接方框，半径 90 时每帧要多算几万个像素）。
import { Particles, P, Rng, fit, sparkle, clamp, smooth, ease, TAU } from "../../core/index.js";
import { gp, snapper, rim, SY } from "./_lib.js";

export const meta = {
  name: "刀光 Blade arc",
  desc: "A crescent of blade light whips round on the ground plane in a few frames, white at its rim, cooling down the ramp as it trails off; a thin echo follows, the tip glints.",
  tags: ["melee", "slash", "blade", "sword", "crescent", "combat", "directional", "xianxia", "one-shot"],
  size: [216, 152],
  origin: [108, 84],
  duration: 0.75,
  loop: false,
  fps: 30,
  bg: "ground",
  options: {
    palette: gp("NnccCwW"),
    sparks: gp("WwCc"),
    radius: 40, // 月牙外沿离圆心多远
    arc: 1, // 半张角（弧度）
    aim: 0, // 月牙的中线朝哪边（地面上的角度，0 朝右，正的往下转）
    sy: SY, // 纵向压扁（俯视 3/4）；1 就是不压扁的一道弧
    width: 9, // 月牙最宽处
    dir: 1, // 1 顺时针扫，-1 逆时针
    mid: 0, // 0：原点是圆心（人物）；1：原点是月牙的中点（被斩的敌人）
    height: 0, // 抬高多少（人物胸口的高度）
    seed: 2,
  },
};

const onArc = (s, r, a) => [s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r * s.sy];

// 月牙：紧贴着刀头的地方最宽，往尾巴收成一线；外沿白，越往里、越往尾、越久就越往色阶的暗处走；尾巴抖掉
function crescent(p, s, ta, L, W, age) {
  if (Math.abs(L) < 0.02 || W < 0.3) return null;
  const R = s.ramp, n = R.length, dir = Math.sign(L), span = Math.abs(L);
  // 只算这一段弧的包围盒
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let u = 0; u <= span + 0.11; u += 0.1)
    for (const r of [s.R + 1, s.R - W - 1]) {
      const [x, y] = onArc(s, r, ta + dir * Math.min(u, span));
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  p.shade(x0 - 1, y0 - 1, x1 + 1, y1 + 1, (x, y, out) => {
    const lx = x - s.cx, ly = (y - s.cy) / s.sy, r = Math.hypot(lx, ly);
    if (r > s.R + 0.5 || r < s.R - W - 1) return;
    let u = (dir * (Math.atan2(ly, lx) - ta)) % TAU;
    if (u < 0) u += TAU;
    if (u > span) return;
    const v = u / span, w = W * Math.pow(Math.sin(Math.PI * Math.pow(v, 2.2)), 0.6);
    if (w < 0.35) return;
    const q = (s.R - r) / w;
    if (q < 0 || q > 1) return;
    const ci = q < 0.22 && age < 0.5 ? 0 : Math.round(q * (n - 1) * 0.75 + age * 2.4 - v * 0.8 + 0.4);
    out.c = R[n - 1 - clamp(ci, 0, n - 1)];
    out.a = Math.min(1, v / 0.4);
  });
  for (let u = 0; u <= span; u += 0.3) {
    const [x, y] = onArc(s, s.R - W * 0.4, ta + dir * u);
    p.glow(x, y, 3 + W * 0.3, R[n - 3], 0.22 * (1 - age) * (u / span));
  }
  return [x0 - 2, y0 - 2, x1 + 2, y1 + 2];
}

function drawSlash(p, s, t, edge) {
  const u = t - s.t0;
  if (u < 0) return;
  const span = s.a1 - s.a0, head = ease.outExpo(clamp(u / s.sweep)), tail = smooth(s.sweep + s.hold, s.sweep + s.hold + s.trail, u);
  const age = clamp(u / (s.sweep + s.hold + s.trail));
  if (tail < 1) {
    const box = crescent(p, s, s.a0 + span * tail, span * (head - tail), s.W * (1 - tail * 0.55), age);
    if (box && edge && age < 0.45) rim(p, box[0], box[1], box[2], box[3], edge);
  }
  // 月牙走过的地方留一道很淡的残影（真半透明的一像素弧），慢慢淡掉。
  // 原来是按抖动画的「断断续续的痕」，淡下去时成了一串零星的单像素点。
  const th = 0.55 * (1 - clamp((u - s.sweep - s.hold) / (s.trail + 0.2)));
  if (tail > 0.02 && th > 0.03) {
    const seen = new Set();
    for (let k = 0; k <= tail; k += 0.5 / (Math.abs(span) * s.R)) {
      const [x, y] = onArc(s, s.R - 0.5, s.a0 + span * k), key = Math.floor(x) * 4096 + Math.floor(y);
      if (seen.has(key)) continue;
      seen.add(key);
      p.blend(x, y, s.ramp[3], th * (0.35 + 0.65 * k));
    }
  }
}

function tipOf(s) {
  const d = Math.sign(s.a1 - s.a0), [x, y] = onArc(s, s.R - s.W * 0.3, s.a1), [x2, y2] = onArc(s, s.R - s.W * 0.3, s.a1 + d * 0.05);
  const l = Math.hypot(x2 - x, y2 - y) || 1;
  return { x, y, dx: (x2 - x) / l, dy: (y2 - y) / l };
}

export function create(o) {
  const C = fit(o.palette, 7), S = fit(o.sparks, 4), Rg = new Rng(o.seed), ps = new Particles({ rng: Rg, ground: () => Infinity, sparks: S });
  const snap = snapper(C, S);
  const R0 = o.radius, sy = o.sy, dir = o.dir >= 0 ? 1 : -1, a0 = o.aim - dir * o.arc, a1 = o.aim + dir * o.arc;
  // 圆心：mid 为 0 时就是原点（抬高 height）；为 1 时往回退一个半径，让月牙的中点落在原点上
  const cx = o.mid ? -Math.cos(o.aim) * R0 : 0, cy = -o.height - (o.mid ? Math.sin(o.aim) * R0 * sy : 0);
  // 火星、亮屑的多少和远近按月牙的弧长算（半径大、张角小的一道细长刀光，不该溅得比大月牙还远）
  const big = Math.sqrt(Math.min(1.3, (R0 * o.arc) / 42));
  // 主月牙，和它里面慢一拍、细一些的回声
  const A = { cx, cy, R: R0, sy, a0, a1, W: o.width, t0: 0, sweep: 0.08, hold: 0.1, trail: 0.32, ramp: C };
  const E = { ...A, R: R0 - Math.min(R0 * 0.2, o.width * 1.3 + 1), W: o.width * 0.4, a0: a0 + (a1 - a0) * 0.1, a1: a1 - (a1 - a0) * 0.05, t0: 0.02, hold: 0.06, trail: 0.26, ramp: C.slice(0, 6) };
  const tip = tipOf(A);
  let t = 0, landed = false;
  return {
    update(dt) {
      t += dt;
      if (!landed && t >= A.sweep) {
        landed = true;
        // 刀停住的地方迸几粒火星，弧上甩出几点亮屑
        for (let i = 0; i < Math.round(6 * big); i++) {
          const a = Math.atan2(tip.dy, tip.dx) + Rg.range(-0.5, 0.5), sp = Rg.range(110, 280) * big;
          ps.spawn(P.SPARK, tip.x, tip.y, Math.cos(a) * sp, Math.sin(a) * sp, Rg.range(0.16, 0.38));
        }
        for (let i = 0; i < Math.round(9 * big); i++) {
          const a = a0 + (a1 - a0) * Rg.range(0.3, 1), [x, y] = onArc(A, A.R, a);
          const ox = x - A.cx, oy = y - A.cy, l = Math.hypot(ox, oy) || 1, sp = Rg.range(22, 70) * big;
          // 亮屑只用单像素的星（库的 MOTE 拖着压暗的尾巴，收进色阶后是一粒粒深色的脏点）
          ps.spawn(P.STAR, x, y, (ox / l) * sp, (oy / l) * sp - 8, Rg.range(0.28, 0.55), C[4 + Rg.int(0, 1)], Rg.range(0.5, 0.95));
        }
      }
      ps.update(dt);
    },
    draw(p) {
      drawSlash(p, E, t, 0);
      drawSlash(p, A, t, C[1]);
      // 刀到的时候尖上闪一下
      const g = t - A.sweep * 0.6;
      if (g > 0 && g < 0.24) sparkle(p, tip.x, tip.y, (2 + 1.2 * big) * ease.outBack(Math.min(1, g / 0.05)) * (1 - g / 0.24), C[5], C[3], 0.3);
      ps.draw(p);
      snap(p);
    },
  };
}
