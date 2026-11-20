// 法宝本体的像素精灵：火尖枪、斩仙飞刀（含神品「请宝贝转身」的有眉有目带翅的白光）、番天印、戊己杏黄旗、九龙神火罩的火龙头。
// 都朝右画，要转角度的（枪、刀、龙头）在游戏里用 RotSprite（fx.ts 的 rotSprite）按方向转好再缓存。
// 乾坤圈的本体在 nezha.ts（RING_SIZES），这里不画。
import { compose, flipX, grid, outline, type Grid } from '../pixel.ts';
import { Px, recolor } from './fx.ts';

// ---------------------------------------------------------------- 火尖枪

/** 枪的同色系描边：红漆杆描殷、金件描赭、银刃描苍。 */
export const SPEAR_SEL: Record<string, string> = { e: 'R', r: 'R', o: 'R', y: 'B', Y: 'B', b: 'B', f: 'B', W: 'h', w: 'h', j: 'h' };
/** 枪长 30 像素（人物约 16×24；用户 2026-11-10：法宝都不能画得过大。原来 40）。仙、神也是这么长，高品阶靠烧红的枪头和火舌。 */
export const SPEAR_LEN = 30;
/** 枪尖像素中心在源图里的位置（旋转中心）。 */
export const SPEAR_TIP = { x: SPEAR_LEN - 0.5, y: 4.5 };

/**
 * 火尖枪（朝右，30×9，第 4 行是枪杆）：金枪纂、朱漆杆上两道金箍、红缨、金吞口、火焰形的枪头。
 * fire=false 是银亮的枪头（凡、灵），fire=true 是烧红的枪头、刃边窜着火舌（仙、神）。
 * tassel 0..2 是红缨的三帧：垂着、被风扯向后、甩起来。flick 0..2 是火舌的三帧（只有 fire 时有用）。
 */
export function spearGrid(fire: boolean, tassel: number, flick = 0): Grid {
  const p = new Px(SPEAR_LEN, 9);
  const Y = 4; // 枪杆所在的行
  // 枪纂
  p.set(0, Y, 'b');
  p.set(1, Y, 'Y');
  p.set(1, Y - 1, 'y');
  p.set(1, Y + 1, 'b');
  // 枪杆：朱漆，隔几像素一点亮漆；两道金箍
  for (let x = 2; x <= 20; x++) p.set(x, Y, x % 6 === 4 ? 'o' : 'e');
  for (const x of [7, 14]) {
    p.set(x, Y, 'Y');
    p.set(x + 1, Y, 'y');
  }
  // 红缨：挂在吞口后面，三帧
  const T: [number, number, string][][] = [
    // 垂着
    [
      [20, Y + 1, 'e'],
      [19, Y + 1, 'o'],
      [18, Y + 1, 'e'],
      [19, Y + 2, 'e'],
      [18, Y + 2, 'r'],
      [17, Y + 2, 'e'],
      [18, Y + 3, 'r'],
      [17, Y + 3, 'e'],
    ],
    // 被风扯向后（刺出时）
    [
      [20, Y + 1, 'e'],
      [19, Y + 1, 'o'],
      [18, Y + 1, 'e'],
      [17, Y + 1, 'e'],
      [16, Y + 1, 'r'],
      [18, Y + 2, 'r'],
      [17, Y + 2, 'e'],
      [16, Y + 2, 'e'],
      [15, Y + 2, 'r'],
    ],
    // 甩起来（收枪时）
    [
      [20, Y + 1, 'e'],
      [19, Y + 1, 'o'],
      [18, Y + 1, 'e'],
      [17, Y + 2, 'e'],
      [16, Y + 2, 'r'],
      [18, Y + 2, 'e'],
      [16, Y + 3, 'r'],
      [15, Y + 3, 'e'],
    ],
  ];
  for (const [x, y, ch] of T[tassel % 3]) p.set(x, y, ch);
  // 吞口：金色的一圈
  p.set(21, Y - 1, 'y');
  p.set(21, Y, 'Y');
  p.set(21, Y + 1, 'b');
  p.set(22, Y - 2, 'y');
  p.set(22, Y - 1, 'Y');
  p.set(22, Y, 'f');
  p.set(22, Y + 1, 'y');
  p.set(22, Y + 2, 'b');
  // 枪头：火焰形 —— 根部两侧各卷起一道火舌状的刃翼，再收成一道长尖（行 Y-3 .. Y+3，列 22 起）
  const blade = fire
    ? ['.e.o....', 'oYo.e...', 'YffYo...', 'fWWWWWWW', 'oYYYe...', 'eoe.o...', '.r.e....']
    : ['.w.j....', 'wWj.w...', 'jWWWj...', 'WWWWWWWW', 'hjjjh...', 'jhj.h...', '.h.h....'];
  blade.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && p.set(22 + c, Y - 3 + r, ch)));
  // 烧红的枪头：刃边窜出的火舌（三帧）
  if (fire) {
    const F: [number, number, string][][] = [
      [
        [25, Y - 3, 'o'],
        [26, Y - 4, 'e'],
        [27, Y + 2, 'e'],
      ],
      [
        [27, Y - 2, 'e'],
        [24, Y + 3, 'o'],
        [25, Y + 4, 'e'],
      ],
      [
        [24, Y - 4, 'e'],
        [27, Y - 2, 'o'],
        [26, Y + 3, 'e'],
      ],
    ];
    for (const [x, y, ch] of F[flick % 3]) p.set(x, y, ch);
  }
  return p.grid();
}

// ---------------------------------------------------------------- 斩仙飞刀

export const KNIFE_SEL: Record<string, string> = { W: 'h', w: 'h', j: 'h', f: 'B', Y: 'B', y: 'B', b: 'B', e: 'R', r: 'R' };
/** 斩仙飞刀（朝右，17×5）：金柄红穗、金护手、白金刃（上沿月白、刃芯闪光、下沿银）。 */
export const KNIFE: Grid = grid([
  '.....y...........',
  'er.bYy.wwwwwwW...',
  'eRbbYfWWWWWWWWWWW',
  'r..bYy.jjjjjjjj..',
  '.....b...........',
]);
export const KNIFE_TIP = { x: 16.5, y: 2.5 };

/**
 * 神品「请宝贝转身」：斩仙飞刀本相 ——「一道白光，上有眉有目，有两翅」（《封神演义》）。
 * 朝右的一团白光，两只小翅膀，一对细眉细眼。两帧扇翅。
 */
export const WINGED_KNIFE: Grid[] = [
  grid([
    '.....jj.........',
    '...jjwwj........',
    '.jwwWWwj........',
    '....jwWWWWWWf...',
    'ffWWWkWWkWWWWWWW',
    '....jwWWWWWWf...',
    '.jwwWWwj........',
    '...jjwwj........',
    '.....jj.........',
  ]),
  grid([
    '................',
    '................',
    'jjwwwWwj........',
    '..jjwWWWWWWWf...',
    'ffWWWkWWkWWWWWWW',
    '..jjwWWWWWWWf...',
    'jjwwwWwj........',
    '................',
    '................',
  ]),
];
export const WINGED_TIP = { x: 15.5, y: 4.5 };

// ---------------------------------------------------------------- 番天印

export type SealGlyph = 'yin' | 'shan' | 'kun';
const GLYPHS: Record<SealGlyph, string[]> = {
  // 「印」
  yin: ['e...eeee', 'e...e..e', 'eee.e..e', 'e...e..e', 'eee.e.ee', 'e...e...', 'eeeee...'],
  // 「山」（三山压顶）
  shan: ['...e...', 'e..e..e', 'e..e..e', 'e..e..e', 'e..e..e', 'eeeeeee'],
  // 坤卦 ☷（地裂）
  kun: ['ee.ee', '.....', 'ee.ee', '.....', 'ee.ee'],
};

/**
 * 番天印（3/4 俯视的一方金印）：顶上一只蹲兽钮挂着红绶，顶面亮金，正面刻着朱砂字（印 / 山 / 坤卦），刻痕带阴影。
 * S 是印身的宽度（18 / 22 / 26）。
 */
export function sealGrid(S: number, glyph: SealGlyph): Grid {
  const knobH = Math.round(S * 0.24);
  const topH = Math.max(3, Math.round(S * 0.2));
  const frontH = Math.round(S * 0.62);
  const W = S;
  const H = knobH + topH + frontH;
  const p = new Px(W, H);
  const cx = (W - 1) / 2;
  // 印钮：蹲着的瑞兽（圆背、前额、一点眼），下面一道红绶
  const kw = Math.max(5, Math.round(S * 0.36));
  for (let y = 0; y < knobH; y++) {
    const t = y / Math.max(1, knobH - 1);
    const half = (kw / 2) * Math.sqrt(Math.min(1, 0.35 + t));
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      if (Math.abs(x - cx) > half) continue;
      p.set(x, y, x < cx - half * 0.3 ? 'Y' : x > cx + half * 0.5 ? 'b' : 'y');
    }
  }
  p.set(cx - 1, Math.round(knobH * 0.45), 'k'); // 兽眼
  p.set(cx - 2, 0, 'f');
  // 红绶垂在钮下一侧
  p.set(cx + Math.ceil(kw / 2), knobH - 1, 'e');
  p.set(cx + Math.ceil(kw / 2) + 1, knobH, 'e');
  p.set(cx + Math.ceil(kw / 2) + 1, knobH + 1, 'r');
  // 顶面：后沿各内缩一像素的梯形，前沿一道亮边
  for (let y = 0; y < topH; y++) {
    const inset = topH - 1 - y > 0 ? 1 : 0;
    for (let x = inset; x < W - inset; x++) p.set(x, knobH + y, y === topH - 1 ? 'f' : x < 2 ? 'Y' : 'Y');
  }
  // 正面：亮金，左沿受光、右沿和底边暗；里面一圈印边
  const fy = knobH + topH;
  for (let y = 0; y < frontH; y++)
    for (let x = 0; x < W; x++) {
      const edgeL = x === 0;
      const edgeR = x === W - 1;
      const bottom = y >= frontH - 2;
      p.set(x, fy + y, edgeL ? 'Y' : edgeR || bottom ? 'b' : 'y');
    }
  for (let x = 2; x < W - 2; x++) {
    p.set(x, fy + 1, 'b');
    p.set(x, fy + frontH - 3, 'Y');
  }
  for (let y = 1; y < frontH - 2; y++) {
    p.set(2, fy + y, 'b');
    p.set(W - 3, fy + y, 'Y');
  }
  // 刻字：朱砂，每笔右下压一像素暗红（刻痕）
  const gl = grid(GLYPHS[glyph]);
  const gx = Math.round(cx - gl.w / 2 + 0.5);
  const gy = fy + Math.round((frontH - 2 - gl.h) / 2);
  gl.rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      p.set(gx + c, gy + r, 'e');
      if (GLYPHS[glyph][r + 1]?.[c] !== 'e' && p.get(gx + c, gy + r + 1) !== 'e') p.set(gx + c, gy + r + 1, 'R');
    }),
  );
  return outline(p.grid(), 'k', { y: 'B', Y: 'B', f: 'B', b: 'B', e: 'R', r: 'R' });
}

// ---------------------------------------------------------------- 戊己杏黄旗

/** apricot：凡、灵；golden：仙品起（金莲护体同）；war：神品「破军」。 */
export type FlagStyle = 'apricot' | 'golden' | 'war';
interface FlagLook {
  body: string;
  hi: string;
  lo: string;
  trim: string;
  mark: string;
  /** 仙品起：旗头一颗明珠、垂一缕随风摆的红缨、旗脚一排金穗。 */
  rich: boolean;
  fringe: string;
}
const FLAG_COLS: Record<FlagStyle, FlagLook> = {
  // 杏黄旗：藤黄的旗面、缃黄的浪峰、琥珀的浪谷、朱砂镶边，旗心一个坤卦
  apricot: { body: 'y', hi: 'Y', lo: 'b', trim: 'e', mark: 'B', rich: false, fringe: 'Y' },
  // 仙品起：同一面旗，坤卦描成朱红，旗头明珠、红缨、旗脚一排金穗（华丽靠细节，不靠变大；镶边仍是朱砂，浅色地面上压得住）
  golden: { body: 'y', hi: 'Y', lo: 'b', trim: 'e', mark: 'r', rich: true, fringe: 'Y' },
  // 神品「破军」：朱红战旗，金边金卦
  war: { body: 'e', hi: 'o', lo: 'r', trim: 'Y', mark: 'Y', rich: true, fringe: 'y' },
};
export const FLAG_W = 15;
/** 连旗杆 28 像素高（人物约 16×24；用户 2026-11-10：法宝都不能画得过大，包括这面旗。原来 46 高，旗面飘在人头顶上方）。 */
export const FLAG_H = 28;
/** 旗杆脚在画布里的位置（插在地上的那一点）。 */
export const FLAG_FOOT = { x: 1, y: FLAG_H - 1 };
/** 旗面中心离旗杆脚多远（破碎时旗面碎片从这里飞散）。 */
export const FLAG_CLOTH = { dx: 7, dy: 20 };

/**
 * 插在地上的一面旗（旗杆在左，旗面向右飘）：金色枪形旗头、旗杆、旗面按正弦波起伏（浪峰亮、浪谷暗），
 * 上下镶边，末端燕尾，旗心坤卦 ☷。旗面在人的头肩高度。n 帧一个循环。朝向不同时整面镜像。
 */
export function flagFrames(n: number, style: FlagStyle = 'apricot'): Grid[] {
  const c = FLAG_COLS[style];
  const out: Grid[] = [];
  const CW = 12; // 旗面宽
  const CH = 9; // 旗面高
  const top = 3; // 旗面上沿（在旗头下面）
  for (let f = 0; f < n; f++) {
    const p = new Px(FLAG_W, FLAG_H);
    const ph = (f / n) * Math.PI * 2;
    // 旗杆
    for (let y = 2; y < FLAG_H; y++) p.set(1, y, y % 5 === 2 ? 'b' : 'B');
    // 旗头：小小的金枪尖（仙品起顶上一颗明珠）+ 一缕红缨
    p.set(1, 0, c.rich ? 'W' : 'f');
    p.set(1, 1, 'Y');
    p.set(0, 2, 'y');
    p.set(2, 2, 'y');
    p.set(0, 3, 'e');
    if (c.rich) p.set(0, 4 + (Math.sin(ph) > 0.3 ? 1 : 0), 'r'); // 红缨随风一摆
    // 旗面：每一列的起伏
    const dy = (i: number) => Math.sin(ph - i * 0.55) * 1.3 * Math.min(1, (i + 1) / 4);
    const mo = Math.round(dy(4)); // 旗心坤卦跟着旗心那一列起伏
    for (let i = 0; i < CW; i++) {
      const x = 2 + i;
      const off = dy(i);
      const slope = dy(i + 1) - dy(i - 1);
      const y0 = Math.round(top + off);
      const tail = i >= CW - 3; // 燕尾
      const y1 = Math.round(top + CH - 1 + off - (tail ? (i - (CW - 4)) * 0.5 : 0));
      for (let y = y0; y <= y1; y++) {
        if (tail && Math.abs(y - (y0 + y1) / 2) < (i - (CW - 4)) * 0.8) continue; // 燕尾的缺口
        const edge = y === y0 || y === y1;
        // 只在折得厉害的地方亮 / 暗一档（旗面小了，处处分档会变成竖条纹）；坤卦底下保持平涂，三横才看得清
        const emblem = i >= 1 && i <= 7 && y >= top + 1 + mo && y <= top + 7 + mo;
        const ch = edge ? c.trim : emblem ? c.body : slope < -0.9 ? c.hi : slope > 0.9 ? c.lo : c.body;
        p.set(x, y, ch);
      }
      // 仙品起：旗脚一排金穗（隔一列垂一粒，随旗面起伏）
      if (c.rich && !tail && i % 2 === 1) p.set(x, y1 + 1, c.fringe);
    }
    // 旗心：坤卦三道（断开的三横）
    for (let r = 0; r < 3; r++) for (const dx of [2, 3, 5, 6]) p.set(2 + dx, top + 2 + r * 2 + mo, c.mark);
    out.push(outline(p.grid(), 'k', { y: 'B', Y: 'B', b: 'B', e: 'R', o: 'R', r: 'R', B: 'k', f: 'B', W: 'B' }));
  }
  return out;
}

// ---------------------------------------------------------------- 九龙神火罩的火龙头

/** 火龙头（朝右，18×12）：两支金角向后扫、鬃火往后飘、一点金睛、长吻、张开的上下颚露出白牙，颔下一缕须。 */
export const DRAGON_HEAD: Grid = outline(
  grid([
    '.YY...............',
    '..yYY.YY..........',
    '....yYyYy.........',
    '.or..yeee.........',
    'oeo.reeeooe.......',
    '.oeeeeooooooe.....',
    'oreeYkeoooooooeY..',
    '.reeeeeeeeeeeeeoW.',
    'oree..RRRWWRRRW...',
    '.reeeeooooooee....',
    '..oree.ee...o.....',
    '...r....r.........',
  ]),
  'k',
  { e: 'R', o: 'R', r: 'R', Y: 'B', y: 'B', W: 'R' },
);
export const DRAGON_PIVOT = { x: 9.5, y: 7.5 };

/** 把火龙头换成金色（神品「九龙吐焰」的龙王）。 */
export const DRAGON_HEAD_GOLD: Grid = recolor(DRAGON_HEAD, { e: 'y', o: 'Y', r: 'b', R: 'B' });

// ---------------------------------------------------------------- 九龙神火罩的本体

export const BELL_W = 17;
export const BELL_H = 18;
/** 罩口中心在画布里的位置（摆在人头顶上方时对齐这一点）。 */
export const BELL_MOUTH = { x: 8, y: 14 };

/**
 * 九龙神火罩的本体：一口悬在哪吒头顶的金罩（钟形，口朝下），和商店图标里的是同一口：
 * 顶上一枚钮，圆顶、直身、罩口外翻；罩身左沿受光、右沿背光，两道金箍夹着一圈龙鳞纹，口沿烧得通红，口下窜着火舌。
 * hot（仙品起）：罩整个烧透了 —— 金箍、龙鳞纹透出火光，口沿发白，火舌更旺。flick 0..2 是火舌的三帧。
 * 17×18 的画布（罩身 15 宽、连火舌 16 高）。用户 2026-11-10：法宝都不能画得过大 —— 原来没有本体，
 * 整口罩是一副火骨架，从脚下一圈（半径 104）弯到人头顶 140 多像素。
 */
export function bellGrid(hot: boolean, flick: number): Grid {
  const p = new Px(BELL_W, BELL_H);
  // 每一行从 x0 到 x1：左沿一格受光、右沿两格背光。cols = [受光, 本色, 背光, 最暗]
  const GOLD = ['Y', 'y', 'b', 'B'];
  const BAND = hot ? ['o', 'e', 'r', 'R'] : ['Y', 'b', 'B', 'B']; // 金箍（仙品起烧红）
  const row = (y: number, x0: number, x1: number, cols: string[]) => {
    for (let x = x0; x <= x1; x++) p.set(x, y, x === x0 ? cols[0] : x === x1 ? cols[3] : x === x1 - 1 ? cols[2] : cols[1]);
  };
  // 钮
  p.set(7, 1, 'Y');
  p.set(8, 1, 'f');
  p.set(9, 1, 'b');
  p.set(7, 2, 'Y');
  p.set(8, 2, 'y');
  p.set(9, 2, 'b');
  // 圆顶
  row(3, 5, 11, GOLD);
  row(4, 4, 12, GOLD);
  for (let y = 5; y <= 11; y++) row(y, 3, 13, y === 7 || y === 11 ? BAND : GOLD);
  // 一道竖的高光（金器的光泽）
  for (const [x, y] of [
    [6, 3],
    [5, 4],
    [5, 5],
    [5, 6],
  ])
    p.set(x, y, 'f');
  // 龙鳞纹：两行错开的鳞点（仙品起透出火光）
  const scale = hot ? 'o' : 'b';
  for (const x of [5, 8, 11]) p.set(x, 8, scale);
  for (const x of [6, 9]) p.set(x, 9, scale);
  // 罩口外翻
  row(12, 2, 14, GOLD);
  row(13, 1, 15, GOLD);
  p.set(2, 13, 'Y');
  // 口沿：烧红的一圈（仙品起烧得发白）
  for (let x = 2; x <= 14; x++) p.set(x, 14, hot ? (x % 2 ? 'f' : 'o') : x % 2 ? 'o' : 'e');
  const bell = outline(p.grid(), 'k', { y: 'B', Y: 'B', f: 'B', b: 'B', B: 'k', e: 'R', o: 'R', r: 'R' });
  // 口下的火舌（不描边，透出底下的地面）：三帧错开
  const F: [number, number, string][][] = [
    [
      [3, 15, 'o'],
      [6, 15, 'e'],
      [9, 15, 'o'],
      [12, 15, 'e'],
      [6, 16, 'r'],
      [12, 16, 'r'],
    ],
    [
      [4, 15, 'e'],
      [7, 15, 'o'],
      [10, 15, 'e'],
      [13, 15, 'o'],
      [7, 16, 'e'],
      [10, 16, 'r'],
    ],
    [
      [2, 15, 'e'],
      [5, 15, 'o'],
      [8, 15, 'Y'],
      [11, 15, 'o'],
      [14, 15, 'e'],
      [8, 16, 'o'],
    ],
  ];
  const rows = bell.rows.map((r) => [...r]);
  for (const [x, y, ch] of F[flick % 3]) rows[y][x] = ch;
  if (hot) for (const [x, y, ch] of F[(flick + 1) % 3]) if (rows[y][x] === '.') rows[y][x] = ch === 'Y' ? 'f' : ch; // 仙品起火舌密一倍
  return { w: bell.w, h: bell.h, rows: rows.map((r) => r.join('')) };
}

/** 乾坤圈周围要用到的组合：把一张网格放到更大的画布中间（给旋转留边）。 */
export function padded(g: Grid, pad: number): Grid {
  return compose(g.w + pad * 2, g.h + pad * 2, [{ g, x: pad, y: pad }]);
}

// ---------------------------------------------------------------- 乾坤圈（更大的两档）

/**
 * 更大的乾坤圈（11、13 像素）：给灵品、仙品以上用（用户：每次升阶都要看得出变化，灵品更大）。
 * 右上受光（缃黄、灵光白），左下背光（琥珀、赭），13 像素的圈是两像素厚的金环。两帧：正、镜像（转起来）。
 */
function bigRing(size: number): Grid {
  const p = new Px(size, size);
  const c = (size - 1) / 2;
  const R = c - 0.2;
  const thick = size >= 13 ? 1.6 : 0.9;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > R + 0.5 || d < R - thick) continue;
      const a = Math.atan2(dy, dx); // 右上是 -π/4
      const lit = Math.cos(a + Math.PI / 4); // 1 = 正对光
      const inner = d < R - thick * 0.5;
      const ch = lit > 0.82 ? (inner ? 'Y' : 'f') : lit > 0.25 ? (inner ? 'y' : 'Y') : lit > -0.45 ? 'y' : inner ? 'B' : 'b';
      p.set(x, y, ch);
    }
  return p.grid();
}
const RING11 = bigRing(11);
const RING13 = bigRing(13);
/** 接在 nezha.ts 的 RING_SIZES（5、7、9 像素）后面的两档：[11 像素, 13 像素]，每档两帧。 */
export const RING_BIG: Grid[][] = [
  [RING11, flipX(RING11)],
  [RING13, flipX(RING13)],
];
