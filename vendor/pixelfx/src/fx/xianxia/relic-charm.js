// 符箓、灵物在人物身上的几样画面（修仙版，新做；封神幸存者 2026-11-12，用户：「照妖镜等特效都太廉价了」）。
// 原来这几处是一张三帧的小黄符、几粒一像素的小尘、一团盖在人物身上的紫黑魔气，廉价在：没有过程、像贴纸、把人物弄脏。
// 原点是人物脚下；都不碰人物本身（东西浮在头顶、肩侧、脚边）。
//   talisman 黄符化去（定身符、引雷符、招宝符）：符纸飘下来停住，朱砂符文一笔一笔亮起来，火从下往上把符纸吃掉
//            （烧着的边一排小火苗），纸灰和火星往上飘。选项 lift = 符纸离脚多高。0.95 秒。
//   gu       噬心蛊：一只紫黑的小蛊虫绕着人物胸口转一圈、扎进胸口，几滴紫红的血气被它吸走，蛊虫钻出来飞远淡掉。1.1 秒。
//   incense  燃魂香：脚边插着一炷香（香头一点红），一缕紫灰的烟弯弯曲曲往上升、慢慢散，几粒火星。1.2 秒。
//   umbrella 混元伞：头顶的伞由合到开（三帧）、停住，鬼火打在伞面上化成墨紫的碎烟顺着伞沿溅开，伞沿的珍珠一晃，伞再合上淡掉。0.95 秒。
//   drum     夔牛鼓：擂两通 —— 肩两侧各一道弯弯的声纹（金、朱）往外推开淡掉，脚下往两边震起尘，肩头几粒火星。0.85 秒。
import { Particles, Lights, P, Rng, clamp, rand, sparkle, TAU, WHITE, hex } from "../../core/index.js";
import { gp, GP, snapper, GAME } from "./_lib.js";

export const meta = {
  name: "符箓与灵物 Charms",
  desc: "Charms on the hero: a talisman lights stroke by stroke and burns away; a gu worm bites; an incense curl; a parasol opens to catch ghost fire; drum beats push out sound arcs.",
  tags: ["relic", "talisman", "charm", "umbrella", "drum", "incense", "xianxia", "one-shot"],
  size: [72, 72],
  origin: [36, 60],
  duration: 1.5,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { kind: "talisman", lift: 30, seed: 5 },
};

const PAL = Object.fromEntries(Object.entries(GP).map(([k, v]) => [k, v]));
const H = (c) => hex(GP[c]);
// 黄符：琥珀的边、缃的纸，朱砂的符文（一笔一笔亮），下面两缕穗
const TAL = [".yyyyy.", "yYYYYYy", "yYeeeYy", "yYYeYYy", "yYeeeYy", "yYeYeYy", "yYeeeYy", "yYYeYYy", "yYeYeYy", "yYYYYYy", ".yyyyy.", "..b.b.."];
// 符文的笔画（按亮起来的先后）：TAL 里 e 所在的格子分成几笔
const STROKES = [
  [[2, 2], [3, 2], [4, 2]],
  [[3, 3], [2, 4], [3, 4], [4, 4]],
  [[2, 5], [4, 5], [2, 6], [3, 6], [4, 6]],
  [[3, 7], [2, 8], [4, 8]],
];
// 伞：合、半开、全开（紫棠、胭脂紫的伞面，藤黄的伞骨，伞顶一粒缃）
const UMB = [
  ["...yY...", "...pP...", "..pmpP..", "..pmpP..", "..ppPP..", "...yb..."],
  ["....yY....", "...pmyP...", "..pmpyPP..", ".pmppyPPP.", "PPyPPyPPyP", "w...w...w."],
  ["......yY......", "...ppmmyppP...", "..pmmpmyppPP..", ".pmmppmyppppP.", "pmppppmyppppPP", "PPyPPPPyPPPPyP", "w..w...w...w..."],
];
// 蛊虫：两帧（翅膀扇动）
const GU = [["m.....m", ".mP.Pm.", "..kPk..", ".PpmpP.", "k.PpP.k", "...P..."], [".......", "mmP.Pmm", "..kPk..", ".PpmpP.", ".kPpPk.", "...P..."]];

export function create(o) {
  const R = new Rng(o.seed + o.kind.length * 13), K = o.kind, snap = snapper(GAME);
  const ps = new Particles({ rng: R, ground: () => 0, sparks: [WHITE, H("Y"), H("o"), H("e")] });
  const lights = new Lights();
  let t = 0;
  const Y0 = -o.lift;
  // 黄符：烧到哪一行（从下往上）
  const BURN0 = 0.42, BURN1 = 0.78;
  let lastAsh = 0;
  // 噬心蛊：血气（从胸口迸出、被蛊虫吸回去）
  const drops = K === "gu" ? Array.from({ length: 5 }, (_, i) => ({ a: -Math.PI / 2 + (i - 2) * 0.6 + R.range(-0.2, 0.2), d: R.range(7, 11), t0: 0.5 + i * 0.03 })) : [];
  // 燃魂香：烟的路径（香头往上，左右摆）
  const SX = -11, SY = -7;
  // 混元伞：鬼火打上来的几处
  const hits = K === "umbrella" ? Array.from({ length: 4 }, (_, i) => ({ x: (i - 1.5) * 4 + R.range(-1, 1), t0: 0.12 + i * 0.05 })) : [];
  return {
    update(dt) {
      t += dt;
      if (K === "talisman") {
        // 烧着的时候：火星、纸灰往上飘
        if (t > BURN0 && t < BURN1 + 0.05 && t - lastAsh > 0.035) {
          lastAsh = t;
          const row = burnRow(t), y = Y0 - 6 + row;
          ps.spawn(P.EMBER, R.range(-3, 3), y, R.range(-6, 6), -R.range(14, 24), R.range(0.35, 0.55), H(R.pick(["Y", "o", "y"])), 1);
          if (R.chance(0.5)) ps.spawn(P.FLAKE, R.range(-3, 3), y, R.range(-6, 6), -R.range(8, 16), R.range(0.5, 0.8), H(R.pick(["h", "i"])), 1);
        }
        if (Math.abs(t - 0.36) < dt / 2 + 1e-9) lights.add(0, Y0, 8, H("Y"), 0.35, 0.3);
      }
      if (K === "incense" && R.chance(dt * 18) && t < 0.9) ps.spawn(P.EMBER, SX + R.range(-1, 1), SY - 1, R.range(-3, 3), -R.range(8, 14), R.range(0.4, 0.6), H(R.pick(["o", "e", "Y"])), 1);
      if (K === "drum" && (Math.abs(t - 0.02) < dt / 2 + 1e-9 || Math.abs(t - 0.24) < dt / 2 + 1e-9)) {
        for (let i = 0; i < 8; i++) {
          const s = i % 2 ? 1 : -1;
          ps.spawn(P.DUST, s * R.range(3, 6), 0, s * R.range(18, 34), -R.range(2, 8), R.range(0.4, 0.6), H(R.pick(["i", "j"])), R.range(1.4, 2.2));
        }
        for (let i = 0; i < 3; i++) ps.spawn(P.EMBER, R.range(-6, 6), -R.range(14, 20), R.range(-6, 6), -R.range(12, 20), R.range(0.45, 0.65), H(R.pick(["o", "e", "Y"])), 1);
      }
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      if (K === "talisman") drawTalisman(p, t, Y0);
      if (K === "gu") drawGu(p, t, drops);
      if (K === "incense") drawIncense(p, t, SX, SY);
      if (K === "umbrella") drawUmbrella(p, t, hits);
      if (K === "drum") drawDrum(p, t);
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };

  function burnRow(t) {
    // 烧到的那一行：从最下一行（11）往上到第 0 行
    return Math.round(11 - clamp((t - BURN0) / (BURN1 - BURN0)) * 12);
  }

  function drawTalisman(p, t, Y0) {
    const fa = clamp(t / 0.12);
    if (t > BURN1 + 0.08) return;
    const dy = Math.round((1 - clamp(t / 0.16)) * -4 + Math.sin(t * 9) * 0.6);
    const x0 = -3, y0 = Y0 - 6 + dy;
    const lit = (r, c) => {
      // 第几笔亮了：0.1 秒起一笔接一笔，每笔 0.06 秒
      for (let k = 0; k < STROKES.length; k++) if (STROKES[k].some(([cx, cy]) => cx === c && cy === r)) return clamp((t - 0.1 - k * 0.06) / 0.06);
      return 0;
    };
    const cut = t > BURN0 ? burnRow(t) : 99;
    for (let r = 0; r < TAL.length; r++) {
      if (r > cut) continue;
      for (let c = 0; c < TAL[r].length; c++) {
        const ch = TAL[r][c];
        if (ch === ".") continue;
        let col = H(ch);
        if (ch === "e") {
          const k = lit(r, c);
          col = k > 0.66 ? H("Y") : k > 0.33 ? H("o") : H("e");
          if (t > 0.3 && t < 0.38) col = WHITE;
        }
        if (r === cut || r === cut - 1) col = r === cut ? H("o") : H("b"); // 烧着的边：橘，往上一行焦成琥珀
        p.dot(x0 + c, y0 + r, col, fa);
      }
      // 描一圈赭（浅色地面上看得清）
      const row = TAL[r];
      const L = row.indexOf(row.replace(/^\.+/, "")[0]), Rr = row.length - 1 - [...row].reverse().join("").search(/[^.]/);
      if (r <= cut && L >= 0) (p.dot(x0 + L - 1, y0 + r, H("B"), fa * 0.9), p.dot(x0 + Rr + 1, y0 + r, H("B"), fa * 0.9));
    }
    if (cut < 99 && cut >= 0) for (let c = 0; c < 7; c += 2) flameDot(p, x0 + c + ((Math.floor(t * 20) + c) & 1), y0 + cut - 1, t * 20 + c);
    if (t > 0.3 && t < 0.38) sparkle(p, 0, y0 + 5, 2, H("Y"), H("y"), 0.2);
  }

  function drawGu(p, t, drops) {
    // 蛊虫：从左下飞进来，绕胸口转一圈（0.15–0.48），扎进胸口（0.5），钻出来往右上飞远淡掉（0.7–1.05）
    const CY = -13;
    let x, y, a = 1;
    if (t < 0.15) {
      const u = t / 0.15;
      x = -16 + u * 8;
      y = CY + 8 - u * 6;
    } else if (t < 0.48) {
      const u = (t - 0.15) / 0.33, ang = Math.PI + u * TAU;
      x = Math.cos(ang) * 8 * (1 - u * 0.6);
      y = CY + Math.sin(ang) * 4 * (1 - u * 0.6);
    } else if (t < 0.7) {
      x = 0;
      y = CY;
      a = t < 0.52 ? 1 : 0; // 扎进去了（藏在胸口）
    } else {
      const u = (t - 0.7) / 0.35;
      x = u * 16;
      y = CY - u * 14;
      a = 1 - clamp((u - 0.5) / 0.5);
    }
    if (a > 0 && t < 1.05) p.sprite(GU[Math.floor(t * 20) & 1], PAL, Math.round(x - 3), Math.round(y - 3), { a });
    // 扎进去的那一下：胸口一点紫白；血气迸出来又被吸回去
    if (t > 0.5 && t < 0.58) sparkle(p, 0, CY, 2, H("m"), H("p"), 0.15);
    for (const d of drops) {
      const u = (t - d.t0) / 0.2;
      if (u < 0 || u > 1) continue;
      const out = u < 0.5 ? u * 2 : 2 - u * 2; // 迸出去再收回来
      const dx = Math.cos(d.a) * d.d * out, dy = CY + Math.sin(d.a) * d.d * out * 0.8;
      p.px(dx, dy, H(u < 0.5 ? "e" : "m"));
      p.px(dx + 1, dy, H(u < 0.5 ? "r" : "p"));
      p.px(dx, dy + 1, H("R"));
      p.px(dx + 1, dy + 1, H("R"), 0.7);
    }
  }

  function drawIncense(p, t, sx, sy) {
    const fa = clamp(t / 0.15) * (1 - clamp((t - 0.95) / 0.25));
    if (fa <= 0) return;
    // 香：一根赭色的细杆插在地上，香头一点朱红（一明一暗）
    for (let i = 0; i < 7; i++) p.dot(sx, sy + i, H(i === 0 ? (Math.floor(t * 8) & 1 ? "o" : "e") : i < 2 ? "r" : "B"), fa);
    // 烟：从香头往上，左右摆，越往上越宽、越淡；两像素宽（亮的一侧桃红、暗的一侧胭脂紫，外沿紫棠），顶上慢慢长高
    const top = 30 * clamp(t / 0.7);
    for (let s = 1; s < top; s += 0.5) {
      const x = sx + Math.sin(s * 0.22 - t * 3) * (1 + s * 0.12), y = sy - 1 - s;
      const k = (1 - s / 34) * fa;
      if ((Math.floor(s * 2) + Math.floor(t * 10)) % 6 === 0 && s > 12) continue; // 断续，像真的烟
      p.dot(x, y, H(s < 8 ? "m" : "p"), k);
      p.dot(x + 1, y, H(s < 8 ? "p" : "P"), k * 0.85);
      if (s > 14) p.dot(x - 1, y, H("P"), k * 0.5);
    }
  }

  function drawUmbrella(p, t, hits) {
    // 合 → 半开 → 全开（0–0.12），停到 0.7，再合上、淡掉（0.7–0.95）
    const stage = t < 0.05 ? 0 : t < 0.1 ? 1 : t < 0.72 ? 2 : t < 0.8 ? 1 : 0;
    const a = clamp(t / 0.05) * (1 - clamp((t - 0.78) / 0.17));
    if (a <= 0) return;
    const g = UMB[stage], w = g[0].length;
    const bob = Math.round(Math.sin(t * 6) * 0.5);
    const X = -Math.floor(w / 2), Yb = -33 + bob; // 伞沿在头顶上面
    // 伞柄：藏在头后面，只露出伞面下一点
    p.sprite(g, PAL, X, Yb - g.length + 1, { a });
    // 鬼火打到伞面：一点墨紫白一下，碎成几粒顺着伞沿往两边溅开、往下落
    for (const h of hits) {
      const u = (t - h.t0) / 0.35;
      if (u < 0 || u > 1 || stage !== 2) continue;
      const hx = Math.round(h.x), hy = Yb - 5;
      if (u < 0.15) p.px(hx, hy - 1, H("m"));
      for (let k = 0; k < 3; k++) {
        const dir = k === 1 ? 0 : k === 0 ? -1 : 1, d = u * (6 + k), x = hx + dir * d, y = hy + u * u * 10 + (dir === 0 ? -u * 3 : 0);
        p.px(x, y, H(u < 0.4 ? "p" : "P"), 1 - u);
      }
    }
  }

  function drawDrum(p, t) {
    // 两通：每通一对声纹（肩两侧，弯向外的短弧），往外推 10 像素、淡掉
    for (const t0 of [0.02, 0.24]) {
      const u = (t - t0) / 0.45;
      if (u < 0 || u > 1) continue;
      for (const s of [-1, 1]) {
        const x0 = s * (8 + u * 10), cy = -14, hh = 3 + u * 2;
        for (let j = -hh; j <= hh; j++) {
          const x = x0 + s * (1 - (j / hh) * (j / hh)) * 2.2, y = cy + j;
          p.dot(x, y, H(Math.abs(j) < hh * 0.5 ? "e" : "r"), 1 - u);
          p.dot(x - s, y, H(Math.abs(j) < hh * 0.5 ? "Y" : "y"), (1 - u) * 0.9);
          p.dot(x + s, y, H("R"), (1 - u) * 0.6);
        }
      }
    }
  }
}

// 一粒跳动的小火苗（烧符纸的边）
function flameDot(p, x, y, ph) {
  const up = Math.floor(ph) & 1;
  p.px(x, y, hex(GP.o));
  p.px(x, y - 1, hex(GP.Y));
  if (up) p.px(x, y - 2, hex(GP.e));
}
