// 五行相生（修仙版，新做；封神幸存者 2026-11-12，用户：「这些特效都不能廉价」）。
// 原来相生的那一下是十几粒一像素的火星（fx.ts reactBurst）+ 引燃 / 熔岩一圈方块火苗和一像素熔滴（reactRing），
// 单色、没有体积、一闪就没。这里五种各有自己的物件，都是 起势（胸口一点白的星芒）→ 主体 → 余韵（碎屑、烟、余烬慢慢散），
// 不画圆圈、不盖住敌人（东西长在它脚边、从胸口往外迸），约 0.8–1.1 秒收干净。
//   frost   凝霜（金生水）：脚边地上长出三四根冰棱、胸口迸出几片雪花，冰棱停一下碎成冰屑落地，地上留一层很淡的霜花；
//   conduct 导雷（水生木）：青绿的雷在身上缠两三圈细电弧（每帧重劈）、几粒会拐弯的电火花，地上一点焦痕的火星；
//   ignite  引燃（木生火）：几片青叶从胸口卷出去，半路着火烧成灰；火从脚下顺着地面往外窜出五六道（到引燃的半径为止），
//           身上腾起一团三昧真火，火星往上飘；
//   lava    熔岩（火生土）：脚下的地裂开几道赤红的缝、慢慢冷成赭黑，几滴熔浆溅出去落地冒一缕烟，一团土黄的尘；
//   blaze   燎原（火行三件：烧着的敌人倒下时炸开）：脚下一团大火、焦痕，七团火划弧抛出去、落地烧成小火苗，火星和两三缕烟往上飘；
//   pierce  淬锋（土生金）：一道斜的金色锋芒从胸口划过、两三粒金屑（破甲由 armorBreak 另画，这里是叠在上面的那一道锋）。
// 颜色都收进调色板（snapper）；选项 height = 胸口离脚多高，r = 引燃 / 熔岩波及的半径（地上的火、裂缝不超过它）。
import { Particles, Bits, Lights, P, B, Rng, clamp, rand, sparkle, TAU, WHITE, hex } from "../../core/index.js";
import { zigzag, crackle } from "../lightning/_lib.js";
import { gp, snapper, GAME, GP, SY } from "./_lib.js";

export const meta = {
  name: "五行相生 Five-phase reaction",
  desc: "Five-phase reactions on a foe: ice spikes that shatter, green arcs, burning leaves and running ground fire, red cooling cracks with molten drops, a gold edge, a blaze.",
  tags: ["reaction", "elemental", "ice", "lightning", "fire", "lava", "metal", "xianxia", "one-shot"],
  size: [88, 64],
  origin: [44, 44],
  duration: 1.1,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { kind: "frost", height: 11, r: 30, seed: 2 },
};

const ICE = gp("NncCwW");
const VOLT = gp("GvlLwW");
const FIRE = gp("RreoyYf");
const LEAF = gp("GvlL");
const EARTH = gp("kBSbyY");
const GOLD = gp("BbyYfW");
const SMOKE = gp("ghij");
/** 导雷的细电弧（crackle 取 3 晕、5 身、7 芯）：石绿的晕、葱黄的身、白芯 */
const ARC = gp("GvllLLLW").map(hex);

export function create(o) {
  const R = new Rng(o.seed + o.kind.length * 7), H = -o.height, K = o.kind, RAD = o.r;
  const snap = snapper(GAME);
  const floor = () => 0;
  const ps = new Particles({ rng: R, ground: floor, sparks: K === "conduct" ? [WHITE, hex(VOLT[4]), hex(VOLT[3]), hex(VOLT[2])] : K === "frost" ? [WHITE, hex(ICE[4]), hex(ICE[3]), hex(ICE[2])] : K === "pierce" ? [WHITE, hex(GOLD[3]), hex(GOLD[2]), hex(GOLD[1])] : [WHITE, hex(FIRE[5]), hex(FIRE[3]), hex(FIRE[2])] });
  const bits = new Bits({ ground: floor });
  const lights = new Lights();
  let t = 0;
  const C = (r, i) => hex(r[clamp(i, 0, r.length - 1)]);

  // ---------- 各自的物件 ----------
  // 凝霜：冰棱（脚边，左右前后错开）
  const spikes = K === "frost" ? [[-5, 0, 9, 3, -2], [4, 1, 12, 4, 1.6], [0, 3, 7, 3, 0.3], [-9, -1, 6, 3, -2.4], [8, -1, 5, 2, 2.2]].map(([x, y, h, w, lean], i) => ({ x, y, h, w, lean, d: i * 0.03 })) : [];
  // 引燃：飞出去的叶子；地上往外窜的火
  const leaves = K === "ignite" ? Array.from({ length: 3 }, (_, i) => {
    const a = -Math.PI / 2 + (i - 1) * 1.1 + R.range(-0.2, 0.2), sp = R.range(24, 34);
    return { x: 0, y: H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, a: R.range(0, TAU), burn: R.range(0.1, 0.18) };
  }) : [];
  const runs = K === "ignite" ? Array.from({ length: 5 }, (_, i) => ({ a: (i / 5) * TAU + 0.3 + R.range(-0.25, 0.25), len: RAD * R.range(0.72, 0.92), acc: 0, trail: [], ph: R.range(0, TAU) })) : [];
  // 熔岩：裂缝（折线，从脚下往外）、熔滴
  const cracks = K === "lava" ? Array.from({ length: 5 }, (_, i) => {
    let a = (i / 5) * TAU + R.range(-0.3, 0.3), x = 0, y = 0;
    const pts = [[0, 0]], len = RAD * R.range(0.45, 0.7);
    for (let s = 0; s < len; s += 2.2) {
      a += R.range(-0.45, 0.45);
      x += Math.cos(a) * 2.2;
      y += Math.sin(a) * 2.2 * SY;
      pts.push([x, y]);
    }
    return pts;
  }) : [];
  const drops = K === "lava" ? Array.from({ length: 7 }, () => {
    const a = R.range(0, TAU), d = RAD * R.range(0.4, 0.85);
    return { tx: Math.cos(a) * d, ty: Math.sin(a) * d * SY, T: R.range(0.32, 0.44), d: R.range(0, 0.08), up: R.range(18, 28), landed: false };
  }) : [];
  // 燎原：抛出去的火团（落地后烧成火苗）、地上的焦痕
  const brands = K === "blaze" ? Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * TAU + R.range(-0.25, 0.25), d = RAD * R.range(0.55, 0.85);
    return { tx: Math.cos(a) * d, ty: Math.sin(a) * d * SY, T: R.range(0.2, 0.3), d: R.range(0.02, 0.08), up: R.range(10, 18), ph: R.range(0, 9) };
  }) : [];
  if (K === "blaze") {
    for (let i = 0; i < 10; i++) ps.spawn(P.EMBER, R.range(-5, 5), R.range(-8, 0), R.range(-16, 16), R.range(-40, -18), R.range(0.6, 1), C(FIRE, R.int(4, 6)), 1, R.range(0, 0.35));
    for (let i = 0; i < 3; i++) ps.spawn(P.SMOKE, R.range(-4, 4), -R.range(4, 10), R.range(-6, 6), -R.range(10, 18), R.range(0.7, 1), C(SMOKE, R.int(0, 1)), R.range(2.4, 3.4), 0.25 + i * 0.08);
  }
  // 淬锋：一道斜锋
  const slashA = -0.6;

  // 起势：胸口一点白
  lights.add(0, H, 8, K === "frost" ? hex(ICE[4]) : K === "conduct" ? hex(VOLT[3]) : K === "pierce" ? hex(GOLD[3]) : hex(FIRE[4]), 0.4, 0.25);
  // 凝霜：胸口迸出的雪花（自己画：月白的十字芯、石青的角，浅色地上也看得清）
  const flakes = K === "frost" ? Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * TAU + R.range(-0.4, 0.4), sp = R.range(22, 38);
    return { x: 0, y: H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 10, life: R.range(0.6, 0.9), big: i % 2 === 0 };
  }) : [];
  if (K === "conduct")
    for (let i = 0; i < 8; i++) {
      const a = R.range(0, TAU), sp = R.range(50, 110);
      ps.spawn(P.SPARK, 0, H, Math.cos(a) * sp, Math.sin(a) * sp - 30, R.range(0.2, 0.4), WHITE, 1, R.range(0, 0.15));
    }
  if (K === "ignite") {
    for (let i = 0; i < 6; i++) ps.spawn(P.EMBER, R.range(-4, 4), H + R.range(-2, 4), R.range(-10, 10), R.range(-30, -14), R.range(0.6, 0.95), C(FIRE, R.int(4, 6)), 1, R.range(0.05, 0.3));
  }
  if (K === "lava") {
    for (let i = 0; i < 4; i++) ps.spawn(P.DUST, R.range(-5, 5), R.range(-1, 1), R.range(-14, 14), R.range(-8, -2), R.range(0.5, 0.8), C(EARTH, R.int(3, 4)), R.range(2, 3), R.range(0, 0.05));
    for (let i = 0; i < 4; i++) ps.spawn(P.FIRE, R.range(-3, 3), H * 0.5, R.range(-6, 6), R.range(-24, -12), R.range(0.3, 0.45), 0, R.range(1.8, 2.6), R.range(0, 0.06));
  }
  if (K === "pierce")
    for (let i = 0; i < 6; i++) {
      const a = slashA + (R.chance(0.5) ? 0 : Math.PI) + R.range(-0.5, 0.5), sp = R.range(40, 80);
      ps.spawn(P.SPARK, 0, H, Math.cos(a) * sp, Math.sin(a) * sp - 20, R.range(0.2, 0.4), WHITE, 1, R.range(0.04, 0.1));
    }

  return {
    update(dt) {
      t += dt;
      // 冰棱：长出来（0.1 秒）、停住，0.42 秒碎成冰屑
      for (const s of spikes)
        if (!s.broke && t > 0.42 + s.d) {
          s.broke = true;
          for (let i = 0; i < 4; i++) bits.add({ kind: B.SHARD, x: s.x + R.range(-1, 1), y: s.y - R.range(1, s.h), vx: R.range(-30, 30), vy: -R.range(20, 50), g: 0.7, drag: 0.5, bounce: 0.3, life: R.range(0.35, 0.5), a: R.range(0, TAU), va: R.range(-18, 18), s: R.range(1, 1.6), c: C(ICE, R.int(3, 5)) });
          ps.spawn(P.FLAKE, s.x, s.y - s.h * 0.5, R.range(-6, 6), -R.range(4, 10), R.range(0.4, 0.6), C(ICE, 4), 0.8);
        }
      for (const f of flakes) {
        f.vx *= Math.exp(-3 * dt);
        f.vy = f.vy * Math.exp(-3 * dt) + 14 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
      }
      // 叶子：卷出去，着火，烧成灰
      for (const l of leaves) {
        l.vx *= Math.exp(-2.5 * dt);
        l.vy = l.vy * Math.exp(-2.5 * dt) + 20 * dt;
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        l.a += dt * 9;
        
        if (t > l.burn + 0.3 && !l.ash) {
          l.ash = true;
          ps.spawn(P.EMBER, l.x, l.y, R.range(-4, 4), -R.range(8, 14), R.range(0.4, 0.6), C(FIRE, 4), 1);
        }
      }
      // 地上窜出去的火：火头沿着地面走，一路留小火苗
      for (const r of runs) {
        const u = clamp((t - 0.04) / 0.32);
        if (u <= 0 || u >= 1) continue;
        const d = r.len * (1 - (1 - u) * (1 - u));
        r.x = Math.cos(r.a) * d;
        r.y = Math.sin(r.a) * d * SY;
        r.acc += dt;
        if (r.acc >= 0.07) {
          r.acc = 0;
          r.trail.push({ x: r.x, y: r.y, t0: t });
          if (R.chance(0.2)) ps.spawn(P.EMBER, r.x, r.y - 2, R.range(-5, 5), -R.range(10, 18), R.range(0.4, 0.6), C(FIRE, R.int(4, 6)), 1);
        }
      }
      // 熔滴：落地冒一缕烟、留一粒冷下去的红
      for (const q of drops)
        if (!q.landed && t > q.d + q.T) {
          q.landed = true;
          q.at = t;
          ps.spawn(P.SMOKE, q.tx, q.ty - 1, R.range(-3, 3), -R.range(8, 14), R.range(0.5, 0.7), C(SMOKE, 1), R.range(1.4, 2), 0);
        }
      ps.update(dt);
      bits.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 起势：胸口一颗小星芒（两帧白、收成色阶）
      if (t < 0.1) {
        const c = K === "frost" ? C(ICE, 4) : K === "conduct" ? C(VOLT, 4) : K === "pierce" ? C(GOLD, 4) : C(FIRE, 5);
        sparkle(p, 0, K === "blaze" ? H * 0.6 : H, t < 0.05 ? 3 : 2, c, c, 0.25);
      }
      if (K === "frost") {
        // 地上的霜花：几道很短的霜线，从脚下往外（压扁），隔点画
        const fa = clamp(t / 0.12) * (1 - clamp((t - 0.55) / 0.45));
        if (fa > 0)
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * TAU + 0.3, L = 6 + ((i * 5) % 4);
            for (let d = 2; d < L; d++) if ((d + i) % 2 === 0) p.dot(Math.cos(a) * d, Math.sin(a) * d * SY + 1, C(ICE, d < 4 ? 4 : 3), fa * 0.8);
          }
        for (const f of flakes) {
          const k = 1 - t / f.life;
          if (k <= 0) continue;
          const a = Math.min(1, k * 2.5);
          flake(p, f.x, f.y, f.big && k > 0.4, a);
        }
        for (const s of spikes) {
          if (s.broke) continue;
          const g = clamp((t - s.d) / 0.1);
          if (g <= 0) continue;
          crystal(p, s.x, s.y, s.h * (1 - (1 - g) * (1 - g)), s.w, s.lean, ICE, { white: t < s.d + 0.14, glint: t > 0.2 && t < 0.3 ? 2 : -1 });
        }
      }
      if (K === "conduct" && t < 0.42) {
        const f = Math.floor(t * 30 + 1e-4), r = new Rng(o.seed * 31 + f), fade = 1 - clamp((t - 0.25) / 0.17);
        const n = t < 0.12 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const a0 = r.range(0, TAU), a1 = a0 + r.range(1.2, 2.4), rx = r.range(4, 7), ry = r.range(4, 8);
          crackle(p, zigzag(r, Math.cos(a0) * rx, H + Math.sin(a0) * ry, Math.cos(a1) * rx, H + Math.sin(a1) * ry, 0.45, 0.25), t < 0.07 ? fade : Math.min(0.44, fade), ARC, 0.08);
        }
      }
      if (K === "ignite") {
        // 地火：每道火头走过的地方留一串小火苗，慢慢矮下去（中 → 小 → 一粒火星）
        for (const r of runs) {
          for (const q of r.trail) {
            const age = t - q.t0, ph = (t + q.t0 * 7) * 9;
            if (age < 0.16) flame(p, q.x, q.y, 1, ph);
            else if (age < 0.34) flame(p, q.x, q.y, 0, ph);
            else if (age < 0.46) p.px(q.x, q.y - 1, C(FIRE, 3));
          }
          const u = clamp((t - 0.04) / 0.32);
          if (u > 0 && u < 1) flame(p, r.x, r.y, 1, t * 10 + r.ph);
        }
        // 身上腾起的一团三昧真火：大 → 中 → 小，0.55 秒矮下去
        const bt = t - 0.02;
        if (bt > 0 && bt < 0.55) {
          const sz = bt < 0.3 ? 2 : bt < 0.44 ? 1 : 0;
          flame(p, -1, 1, sz, t * 10);
          if (bt > 0.04 && bt < 0.4) flame(p, 4, 1, sz > 0 ? sz - 1 : 0, t * 10 + 1);
        }
      }
      if (K === "ignite")
        for (const l of leaves) {
          if (l.ash) continue;
          const lit = t > l.burn, ca = Math.cos(l.a), x = l.x, y = l.y;
          const body = lit ? C(FIRE, t > l.burn + 0.15 ? 2 : 4) : C(LEAF, 2), edge = lit ? C(FIRE, 1) : C(LEAF, 0);
          p.px(x, y, body);
          p.px(x + (ca > 0 ? 1 : -1), y, lit ? C(FIRE, 5) : C(LEAF, 3));
          p.px(x, y + 1, edge);
        }
      if (K === "lava") {
        // 裂缝：0.1 秒裂开，白 → 缃 → 橘 → 朱砂 → 朱 → 殷 → 赭 → 淡掉
        const g = clamp(t / 0.1), heat = 1 - clamp((t - 0.1) / 0.75), fa = 1 - clamp((t - 0.8) / 0.3);
        for (const pts of cracks) {
          const n = Math.max(1, Math.round((pts.length - 1) * g));
          for (let i = 0; i < n; i++) {
            const h = heat * (1 - (i / pts.length) * 0.5), c = h > 0.85 ? WHITE : h > 0.7 ? C(FIRE, 6) : h > 0.55 ? C(FIRE, 4) : h > 0.4 ? C(FIRE, 2) : h > 0.25 ? C(FIRE, 1) : h > 0.1 ? C(FIRE, 0) : C(EARTH, 1);
            p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, fa);
            if (h > 0.5 && (i & 1) === 0) p.glow(pts[i][0], pts[i][1], 3, C(FIRE, 3), 0.18 * h);
          }
        }
        // 熔滴：弧线飞出去，落地后一粒冷下去的红
        for (const q of drops) {
          const u = (t - q.d) / q.T;
          if (u < 0) continue;
          if (u < 1) {
            const x = q.tx * u, y = q.ty * u + H * 0.5 * (1 - u) - Math.sin(u * Math.PI) * q.up;
            p.px(x, y, C(FIRE, 5));
            p.px(x, y + 1, C(FIRE, 2));
          } else {
            const k = 1 - clamp((t - q.at) / 0.45);
            if (k > 0) p.px(q.tx, q.ty, k > 0.6 ? C(FIRE, 4) : k > 0.3 ? C(FIRE, 2) : C(EARTH, 1), Math.min(1, k * 2));
          }
        }
      }
      if (K === "blaze") {
        // 焦痕：脚下一片压扁的赭、殷（隔点画），慢慢淡掉
        const sa = clamp(t / 0.08) * (1 - clamp((t - 0.6) / 0.45));
        if (sa > 0)
          for (let y = -2; y <= 2; y++)
            for (let x = -8; x <= 8; x++) {
              const d = Math.hypot(x / 7, y / 2.4);
              if (d > 1 || rand(o.seed, x * 13 + y) > 1.1 - d) continue; // 中间密、边上稀，不成方块
              p.dot(x, y, d < 0.5 ? C(FIRE, 0) : C(EARTH, 1), sa * (0.85 - d * 0.45));
            }
        // 中间一团大火：大 → 中 → 小
        const bt = t - 0.02;
        if (bt > 0 && bt < 0.6) {
          const sz = bt < 0.32 ? 2 : bt < 0.48 ? 1 : 0;
          flame(p, 0, 1, sz, t * 10);
          if (bt < 0.4) (flame(p, -5, 0, sz > 0 ? 1 : 0, t * 10 + 1), flame(p, 5, 1, sz > 1 ? 1 : 0, t * 10 + 3));
        }
        // 抛出去的火团：一粒亮的火星划弧飞出，落地烧成火苗（中 → 小 → 一粒余烬）
        for (const b of brands) {
          const u = (t - b.d) / b.T;
          if (u < 0) continue;
          if (u < 1) {
            const x = b.tx * u, y = b.ty * u - 6 * (1 - u) - Math.sin(u * Math.PI) * b.up;
            p.px(x, y, C(FIRE, 6));
            p.px(x - Math.sign(b.tx || 1), y + 1, C(FIRE, 3));
          } else {
            const age = t - b.d - b.T, ph = t * 10 + b.ph;
            if (age < 0.2) flame(p, b.tx, b.ty, 1, ph);
            else if (age < 0.42) flame(p, b.tx, b.ty, 0, ph);
            else if (age < 0.56) p.px(b.tx, b.ty - 1, C(FIRE, 2));
          }
        }
      }
      if (K === "pierce" && t > 0.02 && t < 0.3) {
        // 一道斜锋：从一头划到另一头（0.08 秒），白芯金边，再从尾巴收掉
        const u = clamp((t - 0.02) / 0.08), v = clamp((t - 0.12) / 0.18), L = 11, ca = Math.cos(slashA), sa = Math.sin(slashA);
        for (let d = -L + 2 * L * v; d <= -L + 2 * L * u; d += 0.5) {
          const x = ca * d, y = H + sa * d, w = 1 - Math.abs(d) / L;
          p.dot(x, y, w > 0.5 ? WHITE : C(GOLD, 4));
          p.dot(x, y + 1, C(GOLD, 2), 0.9);
          if (w > 0.6) p.dot(x, y - 1, C(GOLD, 4), 0.8);
        }
      }
      bits.draw(p);
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}

// 冰棱（库里 sim.js 的 crystal 的简化版：直接用色阶，white = 刚长出来那两帧整根白）
function crystal(p, x, base, h, w, lean, ramp, o) {
  if (h < 1.5) return;
  const top = base - h;
  for (let py = Math.floor(top); py < Math.ceil(base); py++) {
    const u = (base - (py + 0.5)) / h, cx = x + lean * u, hw = (w / 2) * (1 - u) + 0.35;
    for (let px = Math.floor(cx - hw - 1); px <= Math.ceil(cx + hw + 1); px++) {
      const dx = px + 0.5 - cx;
      if (Math.abs(dx) > hw + 1) continue;
      if (Math.abs(dx) > hw) {
        p.px(px, py, hex(ramp[py >= base - 1 ? 1 : 2]));
        continue;
      }
      const c = o.white ? WHITE : dx < -hw * 0.25 ? hex(ramp[5]) : dx < hw * 0.35 ? hex(ramp[4]) : hex(ramp[3]);
      p.px(px, py, c);
    }
  }
  if (o.glint >= 0) p.px(x + lean, top + 1, WHITE);
}

// 雪花：十字的芯（月白，大的中心一点白），四个角压石青；a 是不透明度
function flake(p, x, y, big, a) {
  const X = Math.round(x), Y = Math.round(y), w = hex(ICE[4]), c = hex(ICE[2]), C2 = hex(ICE[3]);
  if (big) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.dot(X + dx, Y + dy, w, a);
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) p.dot(X + dx, Y + dy, C2, a);
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) p.dot(X + dx, Y + dy, c, a);
    p.dot(X, Y, WHITE, a);
  } else {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.dot(X + dx, Y + dy, c, a);
    p.dot(X, Y, w, a);
  }
}

// 火苗（三昧真火）：手画的三种大小，每种两帧（火尖往左、往右摆）。殷红描边、朱 / 朱砂的身、橘、缃的芯，最热处一点白。
// 脚在 (x, y)：火苗底边的中点。size 0 小、1 中、2 大；ph 决定这一帧摆向哪边。
const FLAME = [
  [
    ["..r..", ".reR.", ".roeR", "reYoR", "reYYe", ".rrr."],
    ["..r..", ".Rer.", "Reor.", "RoYer", "eYYer", ".rrr."],
  ],
  [
    ["...r...", "...er..", "..reoR.", "..roer.", ".reYoeR", ".roYYoR", "reYWYoR", ".reYYeR", "..rrrR."],
    ["...r...", "..re...", ".Roer..", ".reor..", "ReoYer.", "RoYYor.", "RoYWYer", "ReYYer.", ".Rrrr.."],
  ],
  [
    ["....r....", "....er...", "...reR...", "...roeR..", "..reoeR..", "..roYoeR.", ".reoYYoR.", ".roYYWoeR", "reoYWWYoR", "reYYWWYeR", ".reYYYeR.", "..rreerR."],
    ["....r....", "...re....", "...Rer...", "..Reor...", "..Reoer..", ".ReoYor..", ".RoYYoer.", "ReoWYYor.", "RoYWWYoer", "ReYWWYYer", ".ReYYYer.", ".Rreerr.."],
  ],
];
const FPAL = { R: GP.R, r: GP.r, e: GP.e, o: GP.o, Y: GP.Y, W: "#ffffff" };
function flame(p, x, y, size, ph, a = 1) {
  const g = FLAME[size][Math.floor(ph) & 1], w = g[0].length, h = g.length;
  p.sprite(g, FPAL, Math.round(x - (w - 1) / 2), Math.round(y - h + 1), { a });
}
