// 破甲（修仙版的减益：土生金「破甲」、哮天犬的「破甲」、易伤）：参照 pixelfx 的 status/cursed、impacts/crit-hit 的碎片新做。
// 碎片的翻滚和弹跳用的是库的 Bits（出自 Sprite Fusion 的开源像素特效，https://www.spritefusion.com/pixel-art-vfx，
// MIT License, Copyright (c) 2026 Hugo Duprez）。
// 为什么新做（封神幸存者，2026-11-10）：
// - 原作的「诅咒」是头顶一个转着的紫色符文圈加一身紫雾：西式的符文魔法阵，游戏里不要。
// - 破甲画成「甲崩」：胸口裂开一道折线（白两帧、冷成缟色、收掉），五六片甲片崩出来翻着落地、弹一下、停住、抖掉，
//   一粒小星光闪在裂口上。0.8 秒的一次性效果（上了破甲的那一下放），不碰人物，按胸口高度（height）摆。
import { Bits, Lights, B, Rng, fit, clamp, sparkle, TAU, WHITE } from "../../core/index.js";
import { gp, snapper } from "./_lib.js";

export const meta = {
  name: "破甲 Armor break",
  desc: "Armor breaks: a jagged crack splits across the chest in white and cools, five or six plates of armor burst off, tumble down, bounce and settle, a glint winks on the split.",
  tags: ["status", "debuff", "armor", "break", "vulnerable", "shards", "xianxia", "one-shot"],
  size: [56, 48],
  origin: [28, 38],
  duration: 0.8,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("khijwW"), armor: gp("kghij"), height: 11, seed: 3 },
};

export function create(o) {
  const C = fit(o.palette, 6), ARMOR = o.armor, R = new Rng(o.seed), Y = -o.height, snap = snapper(C, ARMOR);
  const bits = new Bits({ ground: () => 0 }), lights = new Lights();
  // 裂口：一道斜着的折线，五六个点
  const crack = [];
  let x = -4, y = Y - 2;
  for (let i = 0; i < 6; i++) {
    crack.push([x, y]);
    x += R.range(1.2, 2);
    y += (i % 2 ? -1 : 1) * R.range(0.8, 1.6) + 0.5;
  }
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i % 2 ? 1 : -1) * R.range(0.4, 1.2), v = R.range(32, 58);
    // 甲片用库的 CHUNK（一块有明暗、有暗边的碎块），颜色是甲的玄、黛、苍、银鼠、缟；SHARD 是一像素的细条，看着像白点
    bits.add({ kind: B.CHUNK, x: R.range(-3, 3), y: Y + R.range(-2, 2), vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.6, drag: 0.6, bounce: 0.35, life: R.range(0.55, 0.72), a: R.range(0, TAU), va: R.range(-20, 20), s: R.range(1.3, 2), ramp: ARMOR });
  }
  lights.add(0, Y, 7, C[4], 0.4, 0.15);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      bits.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // 裂口：白两帧，冷成缟、银鼠，0.3 秒内从两头收掉
      if (t < 0.3) {
        const k = clamp(t / 0.3), c = t < 0.067 ? WHITE : t < 0.15 ? C[4] : C[3], n = crack.length - 1, from = k * 0.5 * n, to = n - k * 0.5 * n;
        for (let i = 0; i < n; i++) {
          if (i + 1 < from || i > to) continue;
          const [x0, y0] = crack[i], [x1, y1] = crack[i + 1];
          p.line(x0, y0, x1, y1, c);
          if (t < 0.15) p.line(x0, y0 + 1, x1, y1 + 1, C[0]); // 裂口下沿一道暗缝，浅色的身上也看得出
        }
      }
      bits.draw(p);
      const g = t - 0.08;
      if (g > 0 && g < 0.16) sparkle(p, crack[3][0], crack[3][1] - 1, g < 0.08 ? 2 : 1, C[5], C[3], 0.25);
      lights.draw(p);
      snap(p);
    },
  };
}
