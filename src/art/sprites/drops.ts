// 战场掉落的手绘像素精灵（用户：对战中偶尔掉宝箱、蟠桃、磁铁，做成修仙化的）：
// 乾坤宝匣（紫檀描金，正面嵌一枚金八卦）、蟠桃（带叶的寿桃）、聚灵符（黄纸朱砂符，挂一缕红穗）。
// 纯数据，不依赖 Pixi；src/game/drops-fx.ts 把它们变成纹理。
import { compose, grid, outline, type Grid } from '../pixel.ts';

/** 同色系描边：金描赭、紫檀描玄、桃描胭脂、叶描墨绿、黄纸描赭。 */
const SELOUT: Record<string, string> = { y: 'B', Y: 'B', b: 'B', f: 'B', m: 'p', t: 'p', e: 'p', w: 'p', l: 'G', L: 'G', v: 'G', j: 'B' };
const lined = (rows: string[], sel: Record<string, string> = SELOUT) => {
  const g = grid(rows);
  return outline(compose(g.w + 2, g.h + 2, [{ g, x: 1, y: 1 }]), 'k', sel);
};

// ---------- 乾坤宝匣 ----------
// 俯视 3/4：最上面是匣盖顶面（浅紫檀，远边一道暗金、近边一道亮金），下面是盖沿的金带、
// 匣身正面（深紫檀，两侧压浅紫云纹，四角包金），正中嵌一枚金八卦（中间一粒灵光），最下是金座和两只小足。
// 盖子开合三帧：合 → 半开（盖子掀起、缝里透出灵光）→ 全开（盖子立在后面，匣里满是光）。
const BOX_FRONT = [
  'yPPPPPyYyPPPPPy',
  'PpPPPybkbyPPPpP',
  'PPpPPYkfkYPPpPP',
  'PpPPPybkbyPPPpP',
  'yPPPPPyYyPPPPPy',
  'bbbbbbbbbbbbbbb',
  '.B...........B.',
];
const CHEST_CLOSED = [
  '.bbbbbbbbbbbbb.',
  'bpppppppppppppb',
  'bpmpppppppppPPb',
  'bppppppppppPPPb',
  'yYYYYYYYYYYYYYy',
  'byyyyyyyyyyyyyb',
  ...BOX_FRONT,
];
// 金八卦正中那粒灵光、盖沿上一点金光，隔一会儿亮一下
const CHEST_CLOSED_GLINT = CHEST_CLOSED.map((r, i) => (i === 8 ? r.replace('kfk', 'kWk') : i === 4 ? r.replace('yYYY', 'yYfY') : r));
const CHEST_HALF = [
  '.bbbbbbbbbbbbb.',
  'bPPPPPPPPPPPPPb',
  'byyyyyyyyyyyyyb',
  'yfffWfffffWfffy',
  'yYYYYYYYYYYYYYy',
  'byyyyyyyyyyyyyb',
  ...BOX_FRONT,
];
const CHEST_OPEN = [
  '.bbbbbbbbbbbbb.',
  'bPPPPPPPPPPPPPb',
  'bPgggggggggggPb',
  'bPgggggggggggPb',
  'bbbbbbbbbbbbbbb',
  'yffWfffffffWffy',
  'yYfffffWfffffYy',
  'yYYYYYYYYYYYYYy',
  'byyyyyyyyyyyyyb',
  ...BOX_FRONT,
];
const CHEST_SEL = { ...SELOUT, P: 'k', p: 'k', m: 'k', g: 'k', B: 'k' };
/** 宝匣：[合, 合（八卦一闪）]，锚点在底部中间。 */
export const CHEST = [lined(CHEST_CLOSED, CHEST_SEL), lined(CHEST_CLOSED_GLINT, CHEST_SEL)];
/** 开盖：[半开, 全开]（全开的盖子立在后面，高出三行；底边对齐）。 */
export const CHEST_OPENING = [lined(CHEST_HALF, CHEST_SEL), lined(CHEST_OPEN, CHEST_SEL)];

// ---------- 蟠桃 ----------
// 寿桃：圆润的桃身，桃尖偏向右上；一道桃缝从桃尖弯下来；尖上一抹红，往下渐成桃粉、乳白；左上一点高光。
// 底下一对尖尖的桃叶从桃身后面伸出来，中间一截短梗。
const PEACH_FRUIT = [
  '......ee...',
  '.....eeo...',
  '...mmmeee..',
  '..mwmmmmee.',
  '.mwmmmmpmme',
  '.mmmmmmpmmm',
  'tmmmmmpmmmm',
  'ttmmmmpmmmt',
  'tttmmpmmmtt',
  '.ttttpttt t',
  '..ttttttt..',
];
const PEACH_LEAVES = ['vlLL.....LLlv', '.vvlL...Llvv.', '...vv.B.vv...'];
const peach = (fruit: string[]) => {
  const f = grid(fruit.map((r) => r.replace(/ /g, 't')));
  const l = grid(PEACH_LEAVES);
  return outline(
    compose(15, 15, [
      { g: l, x: 1, y: 11 },
      { g: f, x: 2, y: 1 },
    ]),
    'k',
    { ...SELOUT, m: 'p', w: 'p', t: 'S', e: 'R', o: 'R', p: 'P' },
  );
};
// 高光在桃面上缓缓挪一下（两帧）
export const PEACH = [peach(PEACH_FRUIT), peach(PEACH_FRUIT.map((r, i) => (i === 3 ? r.replace('mwmm', 'mmwm') : i === 4 ? r.replace('mwmm', 'mmwm') : r)))];

// ---------- 聚灵符 ----------
// 黄纸符：符头三点（三清），往下一笔一笔的朱砂符文，脚下一方小朱印；纸边暗一档；底下系一缕红穗。
// 三帧：纸角微卷、平、另一角卷起，红穗跟着摆。
const TALI_BODY = [
  'yYYYYYYy',
  'YrYYrYrY',
  'YYYYYYYY',
  'YrrrrrrY',
  'YYYrYYYY',
  'YYrrrrYY',
  'YYYrYYrY',
  'YrYrYrYY',
  'YYrrYYYY',
  'YYYrrrYY',
  'YYYYYrYY',
  'YYrrrYYY',
  'YYrRrYYY',
];
const tali = (bottom: string[], tassel: string[]) => {
  const body = grid([...TALI_BODY, ...bottom]);
  const t = grid(tassel);
  const g = compose(body.w, body.h + t.h, [
    { g: body, x: 0, y: 0 },
    { g: t, x: 0, y: body.h },
  ]);
  return outline(compose(g.w + 2, g.h + 2, [{ g, x: 1, y: 1 }]), 'k', { ...SELOUT, Y: 'b', y: 'b', r: 'R', R: 'R', e: 'R' });
};
/** 聚灵符：三帧飘动（底角卷起、平、另一角卷起），红穗跟着摆。 */
export const TALISMAN = [
  tali(['yYYYYYYy', 'yyyyyyy.'], ['....e...', '...r....', '..e.e...']),
  tali(['yYYYYYYy', 'yyyyyyyy'], ['...e....', '...r....', '..e.e...']),
  tali(['yYYYYYYy', '.yyyyyyy'], ['...e....', '....r...', '...e.e..']),
];

/** 聚灵符烧掉：b 0..1 从下往上烧，火线上一跳一跳地窜起火苗（flick 换帧），火线上方焦一道，下方烧没。 */
export function talismanBurn(b: number, flick: number): Grid {
  const src = TALISMAN[0];
  const line = Math.round(src.h * (1 - b));
  const rows = src.rows.map((r, y) => {
    if (y > line) return '.'.repeat(r.length);
    return [...r]
      .map((c, x) => {
        if (c === '.') return '.';
        if (y === line) return (x + flick) % 3 === 0 ? 'Y' : 'o';
        if (y === line - 1) return (x + flick) % 2 ? 'e' : 'B';
        if (y === line - 2 && (x + flick * 2) % 3 === 0) return 'B';
        return c;
      })
      .join('');
  });
  // 火苗：火线上方窜起一两像素
  const out = rows.map((r) => [...r]);
  if (line - 3 >= 0)
    for (let x = 1; x < src.w - 1; x++) {
      if ((x * 7 + flick * 3) % 5 === 0 && out[line - 1]?.[x] !== '.') {
        out[line - 3][x] = 'o';
        if (line - 4 >= 0 && (x + flick) % 2 === 0) out[line - 4][x] = 'Y';
      }
    }
  return { w: src.w, h: src.h, rows: out.map((r) => r.join('')) };
}

// ---------- 小星光 ----------
/** 掉落物上偶尔闪一下的四芒星光：由小到大再收。 */
export const TWINKLE = [grid(['W']), grid(['.f.', 'fWf', '.f.']), grid(['..f..', '..Y..', 'fYWYf', '..Y..', '..f..']), grid(['.f.', 'fWf', '.f.'])];
