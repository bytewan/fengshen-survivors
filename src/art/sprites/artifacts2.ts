// 再加的 11 件公共法宝（arti2 分支）用的像素精灵：字符网格（调色板见 ../palette.ts），纯函数、不依赖 DOM。
// 会动、会变形的东西在 src/game/fx-new2.ts 里每帧逐像素画，这里只放成形的小精灵和按大小缓存的地面贴图。
// 尺寸口径（用户 2026-11-10：「所有法宝的尺寸都不能做的过大」）：法宝本身凡 / 灵不高于约 30 像素、仙 / 神不超过约 38；
// 人物约 16×24。地面上的东西要有形状（裂纹、印、浪），不画俗气的发光圆圈、不要硬直线边界。
import { grid, outline, type Grid } from '../pixel.ts';
import { hash, lined, Px } from './fx.ts';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 降魔杵

/**
 * 降魔杵（韦护的法宝）：一根金杵，头朝下砸（金刚杵头的三股合成一个尖，下面一颗莲座），中间缠红，上头一颗宝顶。
 * 7 × 19（描边后 9 × 21）：从天砸下时离地不过约 1.5 个人高（杵底离地 ≤ 15）。
 */
const PESTLE_BASE = grid([
  '...Y...',
  '..yfb..',
  '.bYyyB.',
  '..bYB..',
  '...Yb..',
  '...yb..',
  '..eye..',
  '..rYr..',
  '...yb..',
  '...Yb..',
  '...yb..',
  '.yYfYb.',
  '.bBbBB.',
  '.y.Y.b.',
  '.Y.f.y.',
  '.y.Y.b.',
  '..yYb..',
  '...Y...',
  '...b...',
]);
const GOLD_SEL = { Y: 'B', y: 'B', f: 'B', b: 'B', r: 'R', e: 'R', R: 'R' };
export const PESTLE: Grid = lined(PESTLE_BASE, 'k', GOLD_SEL);
/** 杵尖（砸地的那一点）在精灵里的位置：落地时把它对准落点。 */
export const PESTLE_TIP = { x: 4.5, y: 20 };
/** 杵身中点（翻跟头时绕它转）。 */
export const PESTLE_MID = { x: 4.5, y: 10.5 };

/**
 * 仙品起的降魔杵：同一根杵，杵身多一道朱砂金纹、宝顶换成一点灵光（不加长、不加光圈：华丽靠细节）。
 */
export const PESTLE_HOLY: Grid = lined(
  grid([
    '...W...',
    '..yfb..',
    '.bYfyB.',
    '..bYB..',
    '...Yb..',
    '..eYe..',
    '..eye..',
    '..rYr..',
    '...yb..',
    '..eYe..',
    '...yb..',
    '.yYWYb.',
    '.bBeBB.',
    '.y.f.b.',
    '.Y.W.y.',
    '.y.f.b.',
    '..yYb..',
    '...f...',
    '...y...',
  ]),
  'k',
  GOLD_SEL,
);

/**
 * 降魔印（仙品）：杵砸过的地上留下三股杵头压出来的印 —— 三道往外收尖的深槽（槽里透着金光、两边一像素深色的土），
 * 中间一点灵光，外头再裂开两三道细缝。俯视的地面贴图（竖向压扁 0.55），半径 r；frames 帧做「槽里的光一明一暗」。
 * 不画圆圈：只有压痕、裂缝和光。
 */
export function vajraSealFrames(r: number, seed: number, n = 6): Grid[] {
  const W = Math.ceil(r * 2) + 5;
  const H = Math.ceil(r * 1.2) + 5;
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const out: Grid[] = [];
  const turn = hash(seed, 1) * 0.5 - 0.25;
  const prongs = [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6].map((a) => a + turn);
  const cracks = Array.from({ length: 3 }, (_, i) => ({ a: prongs[i] + Math.PI / 3 + (hash(seed, i, 5) - 0.5) * 0.5, len: r * (0.55 + 0.35 * hash(seed, i, 9)) }));
  for (let f = 0; f < n; f++) {
    const p = new Px(W, H);
    const glow = 0.5 + 0.5 * Math.sin((f / n) * TAU);
    const lit: [number, number][] = [];
    // 三道压痕：从中心往外，先宽后收尖；槽底最亮的一截随帧往外走一点（光一明一暗）
    for (const a of prongs) {
      const L = r * 0.92;
      for (let d = 1.5; d <= L; d += 0.5) {
        const k = d / L;
        const hw = 1.6 * (1 - k) + 0.3;
        for (let o = -hw; o <= hw; o += 0.5) {
          const x = cx + Math.cos(a) * d - Math.sin(a) * o;
          const y = cy + (Math.sin(a) * d + Math.cos(a) * o) * 0.55;
          const ch = k < 0.3 + glow * 0.25 ? 'f' : k < 0.6 ? 'Y' : k < 0.85 ? 'y' : 'b';
          p.set(x, y, Math.abs(o) > hw - 0.5 && ch === 'f' ? 'Y' : ch);
          lit.push([Math.round(x), Math.round(y)]);
        }
      }
    }
    // 两三道细缝（一像素深色，从压痕之间裂出去，尖上断开）
    for (const [ci, c] of cracks.entries())
      for (let d = r * 0.35; d <= c.len; d += 0.6) {
        if (hash(seed, ci, Math.round(d * 3)) < 0.18) continue;
        const bend = (d / c.len) * (hash(seed, ci, 2) - 0.5) * 0.8;
        p.under(cx + Math.cos(c.a + bend) * d, cy + Math.sin(c.a + bend) * d * 0.55, d < c.len * 0.6 ? 'b' : 'B');
      }
    // 压痕两边一像素深色的土
    for (const [x, y] of lit) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) p.under(x + dx, y + dy, 'B');
    // 中间一点灵光
    p.set(Math.round(cx), Math.round(cy), 'W');
    out.push(p.grid());
  }
  return out;
}

// ---------------------------------------------------------------- 五光石

/** 五色（青赤黄白黑）各自的四档：亮、身、暗、描边。下标就是 Knife.color。 */
export const STONE_TONES: [string, string, string, string][] = [
  ['C', 'c', 'n', 'N'], // 青
  ['o', 'e', 'r', 'R'], // 赤
  ['Y', 'y', 'b', 'B'], // 黄
  ['w', 'j', 'i', 'h'], // 白
  ['h', 'g', 'd', 'k'], // 黑
];
/** 一枚五色石（4×4，受光的一角亮），转四个角度当翻滚的四帧；外面一圈同色系的深边。 */
const STONE_BASE = ['.12.', '1223', '2233', '.33.'];
function rot90(rows: string[]): string[] {
  const n = rows.length;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => rows[n - 1 - x][y]).join(''));
}
export const STONES: Grid[][] = STONE_TONES.map(([a, b, c, k]) => {
  const frames: Grid[] = [];
  let r = STONE_BASE;
  for (let i = 0; i < 4; i++) {
    const g = grid(r.map((row) => row.replace(/1/g, a).replace(/2/g, b).replace(/3/g, c)));
    frames.push(lined(g, k, { [a]: k, [b]: k, [c]: k }));
    r = rot90(r);
  }
  return frames;
});
/** 仙品起的五色石：同一枚石子，受光的一角换成闪光，翻滚时一闪一闪（不放大、不加光圈）。 */
export const STONES_LIT: Grid[][] = STONE_TONES.map(([a, b, c, k]) => {
  const frames: Grid[] = [];
  let r = ['.W2.', '1223', '2233', '.33.'];
  for (let i = 0; i < 4; i++) {
    const g = grid(r.map((row) => row.replace(/1/g, a).replace(/2/g, b).replace(/3/g, c)));
    frames.push(lined(g, k, { [a]: k, [b]: k, [c]: k, W: k }));
    r = rot90(r);
  }
  return frames;
});
/** 仙品「五光」碎成的一点五色光：一个小菱形，芯是灵光。 */
export const SHARDS: Grid[] = STONE_TONES.map(([a, b]) => grid([`.${a}.`, `${a}W${b}`, `.${b}.`]));

// ---------------------------------------------------------------- 攒心钉

/** 一枚金钉（朝右）：左头一颗钉帽，钉身一线，钉尖一点灵光；描赭色边（浅色地面上看得清）。 */
export const NAIL: Grid = lined(grid(['Y......', 'fyyyyjW', 'b......']), 'B', { Y: 'B', y: 'B', f: 'B', b: 'B', j: 'B', W: 'B' });
/** 钉子的转心（钉身中间）。 */
export const NAIL_MID = { x: 4.5, y: 2.5 };

// ---------------------------------------------------------------- 金蛟剪

/**
 * 一条金蛟（朝右游）：细长的身子弯成一道波（背上一线受光、肚子暗一档），往尾收成一像素；龙头在右：长吻、一点朱砂眼、
 * 往后支一只小角，一缕灵光的须往后飘。四帧是身子的波往后走（游起来）。约 17 × 7，描赭色边。
 * gold = false 是「四蛟」里的另一对：淡金（灵光 / 缃）。
 */
export function jiaoFrames(gold = true): Grid[] {
  const [hi, mid, lo] = gold ? ['Y', 'y', 'b'] : ['W', 'f', 'Y'];
  const out: Grid[] = [];
  const L = 12; // 身子长（尾 x=0 到颈 x=L）
  for (let f = 0; f < 4; f++) {
    const p = new Px(17, 8);
    const yAt = (x: number) => 4 + Math.sin(x * 0.62 - f * (Math.PI / 2)) * 1.5 * (1 - (x / L) * 0.75);
    for (let x = 0; x <= L; x++) {
      const k = x / L;
      const y = Math.round(yAt(x));
      if (k < 0.3) {
        p.set(x, y, k < 0.12 ? lo : mid); // 尾：一像素
        continue;
      }
      p.set(x, y - 1, hi); // 背上一线受光
      p.set(x, y, mid);
      if (k > 0.7 && x % 2 === f % 2) p.set(x, y, hi); // 颈下一节节的鳞光
    }
    // 龙头（x = L+1 .. L+4）：长吻、眼、角、须
    const Y = Math.round(yAt(L));
    for (const [dx, dy, c] of [
      [1, -1, hi], [2, -1, hi], [3, -1, mid],
      [1, 0, mid], [2, 0, 'e'], [3, 0, mid], [4, 0, mid],
      [1, 1, lo], [2, 1, lo], [3, 1, lo],
      [0, -2, lo], [-1, -2, mid], // 角，往后支
    ] as [number, number, string][]) p.set(L + dx, Y + dy, c);
    p.set(L + 2, Y + 2, 'f'); // 须，往后飘
    p.set(L + 1, Y + 2, 'f');
    p.set(L, Y + 2, hi);
    out.push(lined(p.grid(), 'B', { [hi]: 'B', [mid]: 'B', [lo]: 'B', e: 'B', f: 'B', W: 'B', Y: 'B' }));
  }
  return out;
}
export const JIAO = jiaoFrames(true);
export const JIAO_PALE = jiaoFrames(false);
/** 金蛟的转心（身子中间偏前）。 */
export const JIAO_MID = { x: 10.5, y: 5 };

// ---------------------------------------------------------------- 离地焰光旗

export const YFLAG_W = 16;
export const YFLAG_H = 26; // 连旗杆不高于约 30 像素（插地的旗连旗杆算）
export const YFLAG_FOOT = { x: 1, y: YFLAG_H - 1 };
/**
 * 离地焰光旗（五方旗之南方）：朱红的旗杆、金枪头；旗面朱砂，镶一道橘红的火边，正中一个金色的离卦 ☲（连、断、连），燕尾；
 * 旗面随风起伏（n 帧），下摆的火边一窜一窜。holy：仙品起旗面更亮、离卦是灵光、旗边多几簇小火苗。
 */
export function fireFlagFrames(n = 8, holy = false): Grid[] {
  const out: Grid[] = [];
  const CW = 13;
  const CH = 9;
  const top = 3;
  for (let f = 0; f < n; f++) {
    const p = new Px(YFLAG_W, YFLAG_H);
    const ph = (f / n) * TAU;
    for (let y = 2; y < YFLAG_H; y++) p.set(1, y, y % 6 === 2 ? 'e' : y % 6 === 3 ? 'R' : 'r');
    p.set(1, 0, holy ? 'W' : 'f');
    p.set(1, 1, 'Y');
    p.set(0, 2, 'y');
    p.set(2, 2, 'y');
    const dy = (i: number) => Math.sin(ph - i * 0.6) * 1.4 * Math.min(1, (i + 1) / 5);
    for (let i = 0; i < CW; i++) {
      const x = 2 + i;
      const off = dy(i);
      const slope = dy(i + 1) - dy(i - 1);
      const y0 = Math.round(top + off);
      const tail = i >= CW - 3;
      const y1 = Math.round(top + CH - 1 + off - (tail ? (i - (CW - 4)) * 0.6 : 0));
      for (let y = y0; y <= y1; y++) {
        if (tail && Math.abs(y - (y0 + y1) / 2) < (i - (CW - 4)) * 0.9) continue;
        const edge = y === y0 || y === y1;
        const ch = edge ? (holy ? 'Y' : 'o') : slope < -0.5 ? (holy ? 'o' : 'e') : slope > 0.6 ? 'r' : 'e';
        p.set(x, y, ch);
      }
      // 下摆的火边：一窜一窜的小火苗（随帧换高低）
      const flick = Math.round(1 + Math.sin(ph * 2 + i * 1.7) * 0.8 + (holy ? 0.6 : 0));
      for (let k = 1; k <= flick; k++) if (!tail || i < CW - 1) p.under(x, y1 + k, k === flick ? 'Y' : 'o');
    }
    // 离卦 ☲：连、断、连（随旗面起伏）
    const mx = 2 + 4;
    const mo = Math.round(dy(4));
    for (let r = 0; r < 3; r++)
      for (let dx = 0; dx < 5; dx++) {
        if (r === 1 && dx === 2) continue;
        p.set(mx + dx, top + 2 + r * 2 + mo, holy ? 'W' : 'Y');
      }
    out.push(outline(p.grid(), 'k', { e: 'R', r: 'R', R: 'k', o: 'R', Y: 'B', y: 'B', f: 'B', W: 'B' }));
  }
  return out;
}

/**
 * 地火窜起来之前，敌人脚下先亮的那一道缝（俯视、压扁）：几道细裂纹里透出橘红的光，k 帧由暗到亮。不画圈。
 */
export function emberCrackFrames(r: number, seed: number, n = 5): Grid[] {
  const W = Math.ceil(r * 2) + 3;
  const H = Math.ceil(r * 1.1) + 3;
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const out: Grid[] = [];
  const arms = Array.from({ length: 4 }, (_, i) => ({ a: (i / 4) * TAU + hash(seed, i) * 1.2, len: r * (0.55 + 0.4 * hash(seed, i, 2)) }));
  for (let f = 0; f < n; f++) {
    const p = new Px(W, H);
    const k = (f + 1) / n;
    for (const [i, arm] of arms.entries())
      for (let d = 0; d <= arm.len * k; d += 0.6) {
        const bend = (hash(seed, i, 7) - 0.5) * 0.6 * (d / arm.len);
        const x = cx + Math.cos(arm.a + bend) * d;
        const y = cy + Math.sin(arm.a + bend) * d * 0.5;
        p.set(x, y, d < arm.len * 0.35 ? (f >= n - 2 ? 'Y' : 'o') : d < arm.len * 0.7 ? 'e' : 'r');
      }
    p.set(cx, cy, f >= n - 2 ? 'f' : 'o');
    out.push(p.grid());
  }
  return out;
}

// ---------------------------------------------------------------- 万鸦壶

/**
 * 一只火鸦（俯视，翅膀展开）：四帧——翅膀上扬、平展、下压（扇翅按 0 1 2 1 来回），第四帧是俯冲时收起的翅膀。
 * 乌黑的头、殷红的身子，翅根朱红、往外朱砂、橘红，翅尖一点藤黄（像烧着的羽梢）。9 × 6。
 * gold = true 是器灵「金乌」领头的那一只：琥珀的身子、灵光的心口，翅膀藤黄到缃黄、翅尖橘红，大一圈（11 × 7）。
 */
export function crowFrames(gold = false): Grid[] {
  const rows = gold
    ? [
        ['o.........o', 'Y.........Y', 'Yy.......yY', '.yb..f..by.', '..bBbfbBb..', '....BbB....', '.....o.....'],
        ['...........', '...........', 'o.........o', 'Yy...f...yY', '.ybBbfbBby.', '....BbB....', '.....o.....'],
        ['...........', '...........', '...........', '.....f.....', '..bBbfbBb..', '.yb.BbB.by.', 'oY...o...Yo'],
        ['...........', '...........', '.....f.....', '....bfb....', '...ybBby...', '...Y.B.Y...', '.....o.....'],
      ]
    : [
        ['y.......y', 'oe.....eo', '.er.k.re.', '..rRkRr..', '....R....', '.........'],
        ['.........', '.........', 'y...k...y', 'oerRkRreo', '....R....', '.........'],
        ['.........', '.........', '....k....', '..rRkRr..', '.er.R.re.', 'oe.....eo'],
        ['.........', '.........', '...rkr...', '..erRre..', '..o.R.o..', '....e....'],
      ];
  return rows.map((g) => grid(g));
}
export const CROW = crowFrames(false);
export const CROW_GOLD = crowFrames(true);
/** 扇翅的帧序（来回扇）；俯冲用第 3 帧。 */
export const CROW_FLAP = [0, 1, 2, 1];

/** 万鸦壶（人物出手时在身边一现）：一把赤铜的扁壶，朱红的壶颈，壶嘴朝前斜挑，壶口冒着火。11 × 10（描边后 13 × 12）。 */
export const WANYA_POT: Grid = lined(
  grid([
    '....oY.....',
    '...oYfe....',
    '...RrrR....',
    '....BbB....',
    '...BbyyB..y',
    '..BbyYybB.b',
    '.BbyYyybbBb',
    '.BbyyybbB..',
    '..BbbbbB...',
    '...BBBB....',
  ]),
  'k',
  { e: 'R', o: 'R', Y: 'R', f: 'R' },
);

// ---------------------------------------------------------------- 四海瓶

/**
 * 四海瓶（人物出手时在身边一现，瓶口朝浪头那边倾）：青花的玉壶春瓶——敞口、细颈、溜肩、梨形的腹、圈足；口沿、肩、足各一道青线，
 * 腹上一圈海水纹（石青的浪、靛的浪谷），左边一道釉光、右边落进牙白的影。11 × 17（描边后 13 × 19）。
 * 2026-11-11 重画（原来 7 × 10，颈、腹、纹挤在一起看不清；法宝本体凡 / 灵品上限约 34）。
 */
export const SIHAI_VASE: Grid = lined(
  grid([
    '..jwwwwwj..',
    '...ncccn...',
    '....wWj....',
    '....wWj....',
    '...jwWwj...',
    '...ncccn...',
    '..wWwwwwj..',
    '.wWwwwwwwj.',
    'wWWwwwwwwjj',
    'wWcwwcwwcwj',
    'wcnccnccncj',
    'wnwnnwnnwnj',
    '.wwwwwwwwj.',
    '.jwwwwwwjj.',
    '..ncccccn..',
    '...jwwwj...',
    '...nnnnn...',
  ]),
  'k',
  { n: 'N', c: 'N' },
);

/**
 * 四海瓶浪头的一根「水柱」（1 像素宽、h 高）：浪头由一排排这样的细柱拼成（横着沿浪头一根挨一根，竖着前后五排：d = 0 最前沿、
 * 1 浪顶、2..4 往后缓下去），每根按脚下的 y 和敌人排前后，所以浪头推着的敌人前前后后都遮得对。
 * 顶上的颜色按排：最前沿和浪顶是浪花（白 / 月白），后面三排是水面（天青、石青、黛蓝）——从侧面看就是「后面深蓝、往前一道道亮起来、
 * 最前一道白浪花」；往下是石青的水身、黛蓝，脚下一格靛青。v 是三种浪花的花样（每帧换着用就是翻涌），水身里偶尔一点白沫。
 * frost = 仙品「翻浪」冻上时的颜色（霜白、冰蓝）。
 */
export function surgeColumn(h: number, v: number, d: number, frost = false): Grid {
  const n = Math.max(1, Math.round(h));
  const [F, f, L, M, D, B] = frost ? ['W', 'W', 'Z', 'C', 'c', 'n'] : ['W', 'w', 'C', 'c', 'n', 'N'];
  const tops = d <= 1 ? [v === 1 ? f : F, v === 2 ? F : L, L] : d === 2 ? [L, M] : d === 3 ? [M] : [D];
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const fromBottom = n - 1 - i;
    let c = i < tops.length ? tops[i] : M;
    if (n > 2 && fromBottom === 0) c = B;
    else if (i >= tops.length && fromBottom <= Math.max(1, Math.floor(n * 0.35))) c = D;
    if (v === 2 && d <= 1 && i === Math.floor(n * 0.55) && i >= tops.length && fromBottom > 1) c = f; // 水身里的白沫
    rows.push(c);
  }
  return grid(rows);
}

// ---------------------------------------------------------------- 雾露乾坤网

/** 仙品「乾坤」网缩成的水球（半径 r）：石青的球身，左上受光一片天青、一点高光，右下黛蓝。 */
export function waterBall(r: number): Grid {
  const S = Math.ceil(r * 2) + 1;
  const c = (S - 1) / 2;
  const p = new Px(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > r + 0.3) continue;
      const l = (-dx * 0.6 - dy * 0.8) / Math.max(1, r);
      let ch = l > 0.45 ? 'C' : l > -0.25 ? 'c' : 'n';
      if (d > r - 0.9) ch = l > 0.3 ? 'c' : 'n';
      p.set(x, y, ch);
    }
  p.set(c - r * 0.4, c - r * 0.45, 'W');
  p.set(c - r * 0.4 + 1, c - r * 0.45, 'w');
  p.set(c - r * 0.4, c - r * 0.45 + 1, 'w');
  return p.grid();
}

// ---------------------------------------------------------------- 七宝妙树

/**
 * 七宝妙树（朝右放：左边是缠着丝的握手，往右一根金枝，上下各分出三枝、像一把打开的扇，枝梢和枝头各挂一宝，枝杈上几片翠叶）。
 * 26 × 15（描边后 28 × 17），握手的点在 (1, 8)（描边后）。上面的枝受光（藤黄）、下面的枝在影里（琥珀）。
 * 七宝：金（枝头）、琉璃、玻璃、砗磲（桃红）、玛瑙（朱砂）、银、翠；每一宝 2 × 2，左上一点闪光、右下深一档。
 * 2026-11-11 重画（原来 19 × 7：枝杈和七宝挤在枝头一团，像一把扫帚；法宝本体凡 / 灵品上限约 34）。
 */
export const MIAOSHU_TREE: Grid = lined(
  grid([
    '................WC........',
    '...............yCc........',
    '..............y....Ww.....',
    '............Ly...lywj.....',
    '...........ly....y...Wj...',
    '...........y....y....ji...',
    '......y...y....y....y..W..',
    'YbBbBbYyyYyyyyYyyyyYyyYYy.',
    '......bbbbbb...b....b..b..',
    '...........b....b....WL...',
    '...........vb....b...Ll...',
    '............lb...vbWe.....',
    '..............b....er.....',
    '...............bWm........',
    '................mp........',
  ]),
  'k',
);
/** 七宝妙树握手的点（描边后的网格里）。 */
export const MIAOSHU_GRIP = { x: 1, y: 8 };
/** 七宝的颜色（飞出去的宝按 Knife.color 取）。 */
export const GEM_COLORS = ['Y', 'C', 'w', 'm', 'e', 'j', 'l'];
/** 每一宝描边用的深一档的颜色。 */
const GEM_DARK: Record<string, string> = { Y: 'B', C: 'n', w: 'h', m: 'p', e: 'R', j: 'h', l: 'v' };
/** 飞出去的一宝：菱形的小宝石（中间一点闪光），外面描一圈同色深一档的边。5 × 5。 */
export function gemGrid(c: number): Grid {
  const ch = GEM_COLORS[((c % 7) + 7) % 7];
  return lined(grid([`.${ch}.`, `${ch}W${ch}`, `.${ch}.`]), GEM_DARK[ch]);
}

// ---------------------------------------------------------------- 瘟癀伞

/**
 * 瘟癀伞（撑在敌群上空，微微俯看）：枯黄的伞面、藤黄的伞骨、伞沿一圈紫棠的流苏，伞下露出短短一截伞柄（伞浮在半空）。三帧（伞骨挪一格，像在慢慢转）。
 * 19 × 9（描边后 21 × 11），伞柄的末端在 (10, 10)（描边后）。
 */
export function umbrellaFrames(): Grid[] {
  const W = 19;
  const rib = [
    [4, 9, 14],
    [5, 10, 15],
    [3, 8, 13],
  ];
  return rib.map((ribs) => {
    const p = new Px(W, 9);
    const c = (W - 1) / 2;
    // 伞面：一层层往下变宽（上窄下宽的穹顶）
    const rows = [2, 4, 6, 7, 8, 9];
    rows.forEach((half, y) => {
      for (let x = Math.ceil(c - half); x <= Math.floor(c + half); x++) {
        const edge = Math.abs(x - c) > half - 1;
        p.set(x, y, edge ? 'H' : y < 2 ? 'F' : 'F');
      }
    });
    p.set(c, 0, 'B');
    // 伞骨：从伞顶往下散开
    for (const rx of ribs) for (let y = 1; y < 6; y++) p.set(c + (rx - c) * (y / 5), y, 'y');
    // 伞沿：一圈深色，隔几格垂一根流苏
    for (let x = 0; x < W; x++) p.set(x, 6, x % 4 === 1 ? 'P' : 'H');
    for (let x = 1; x < W; x += 4) p.set(x, 7, 'P');
    // 伞柄：只露出伞下短短一截（伞是浮在半空的，没有人撑着）
    for (let y = 6; y < 9; y++) p.set(c, y, 'S');
    return lined(p.grid(), 'k', { F: 'H', y: 'H', P: 'P', S: 'k' });
  });
}
export const UMBRELLA = umbrellaFrames();
/** 伞柄末端（描边后的网格里）。 */
export const UMBRELLA_TIP = { x: 10, y: 10 };
/** 一滴瘟液（黄绿）。2 × 3。 */
export const PLAGUE_DROP: Grid = grid(['L.', 'Ll', '.l']);

// ---------------------------------------------------------------- 落宝金钱

/** 落宝金钱（带翅的方孔金钱，正面朝人）：三帧扇翅（上扬、平展、下压）。13 × 5（描边后 15 × 7）。 */
export const COIN_FRAMES: Grid[] = [
  ['ww...yyy...ww', '.ww.yYYYy.ww.', '..wwyYBYyww..', '....yYYYy....', '.....yyy.....'],
  ['.....yyy.....', '....yYYYy....', 'wwwwyYBYywwww', '....yYYYy....', '.....yyy.....'],
  ['.....yyy.....', '....yYYYy....', '..wwyYBYyww..', '.ww.yYYYy.ww.', 'ww...yyy...ww'],
].map((rows) => lined(grid(rows), 'k', { w: 'i', y: 'B', Y: 'B' }));
/** 扇翅的帧序。 */
export const COIN_FLAP = [0, 1, 2, 1];

/** 自查用（scratch/grids.ts）：半径 13 的降魔印。 */
export const VAJRA_PREVIEW = () => vajraSealFrames(13, 3);
export const YFLAG_PREVIEW = () => [...fireFlagFrames(4), ...fireFlagFrames(4, true)];
export const EMBER_PREVIEW = () => emberCrackFrames(14, 5);
