// 哪吒（v3；2026-11-11 照「人物与宠物的尺子」身子加长两行：上衣一行、裤一行，头不动）：朝右绘制，朝左时整体镜像。画布 32×33，脚底锚点 (16, 32)。
// 髻顶到风火轮底 30 像素（原来 28）。造型方向：少年比例（头身约 1:2.5），深朱砂上衣配墨色交领，混天绫比上衣亮一档以免粘成一团；金色只留给乾坤圈、腕环、腰带；
// 发髻（「啾啾」）三种写法见 HAIR，用户在对照图里挑；远眼被刘海压住，只露一只细长的近眼。
// 手画：头身、手臂、乾坤圈、风火轮、火焰。程序生成：混天绫（按波形栅格化，帧间连续飘动）。
import { compose, flipX, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const NEZHA_W = 32;
export const NEZHA_H = 33;
export const NEZHA_ANCHOR = { x: 16, y: 32 };

/** 同色系描边：红绸描暗红、皮肤描深肤、金器描赭，其余描玄。 */
const SELOUT: Record<string, string> = { e: 'R', r: 'R', o: 'R', t: 'S', s: 'S', y: 'B', Y: 'B', b: 'B' };

// 头身：14 宽，放在 (9, 2)。头顶的髻有三种写法（HAIR），其余部分共用：红衣墨领、金腰带、墨色裤。
// 发髻根部扎红绳，红绳飘带另画（ribbon 是飘带在画布上的起点）。
export type HairStyle = 'single' | 'cluster' | 'double' | 'round' | 'bigsingle' | 'backsingle' | 'backtwin';
const HAIR: Record<HairStyle, { rows: string[]; ribbon: { x: number; y: number } }> = {
  // 单啾：头顶偏后一个圆丸子
  single: {
    rows: ['....kkkk......', '...kdggdk.....', '...kddddk.....', '...kreerk.....', '.kkkddddkkkk..'],
    ribbon: { x: 12, y: 5 },
  },
  // 双啾·叠髻（用户选定）：前髻大而圆在头顶，后髻小一圈露在脑后，各自扎红绳、各有高光
  cluster: {
    rows: ['......kkkk....', '..kkk.kdggk...', '.kdgkkkddddk..', '.kddkrereddk..', '.kerkddddddkk.'],
    ribbon: { x: 10, y: 6 },
  },
  // 圆双髻：两个 6 像素宽的圆丸子，亮点高光 + 红绳横缠，读成「扎起来的髻」而不是角或耳朵
  round: {
    rows: ['.kkkk...kkkk..', 'kdghdk.kdghdk.', 'kdgddk.kdgddk.', 'kreerkkkreerk.', '.kddddddddddk.'],
    ribbon: { x: 9, y: 5 },
  },
  // 大单髻：一个 7 像素宽的缠绳丸子
  bigsingle: {
    rows: ['....kkkkk.....', '...kdghddk....', '...kdgdddk....', '...kreeerk....', '.kkkdddddkkk..'],
    ribbon: { x: 12, y: 5 },
  },
  // 后单髻：5 像素宽的缠绳丸子，坐在头顶偏后（用户：不要放正中间，往脑后一点，小一点）
  backsingle: {
    rows: ['..kkk.........', '.kdhdk........', '.kdgdk........', '.krerkkkkkk...', '.kddddddddddk.'],
    ribbon: { x: 10, y: 5 },
  },
  // 后双髻：两个 5 像素宽的缠绳丸子，整体往脑后挪
  backtwin: {
    rows: ['.kkk...kkk....', 'kdhdk.kdhdk...', 'kdgdk.kdgdk...', 'krerkkkrerkk..', '.kddddddddddk.'],
    ribbon: { x: 9, y: 5 },
  },
  // 双啾·分髻：一高一低分在头顶两侧（上一版）
  double: {
    rows: ['........kkk...', '..kkk..kdggk..', '.kdggk.kdddk..', '.kdddkkkrerk..', '.krerdddddddk.'],
    ribbon: { x: 10, y: 6 },
  },
};
const BODY_LOWER = [
  'kddggdddddddk.',
  'kdgddddddddddk',
  'kdddddddddtdtk',
  'kddddddtktkktk',
  'kddddsttttttsk',
  '.kdddsttsttk..',
  '..kkkssttsk...',
  '.....kkkk.....',
  '....kkttkk....',
  '...krdeerrk...',
  '..kRrrdeerrk..',
  '..kRrrrdeerk..',
  '..kRrrrrdeek..',
  '...kRrrrdek...',
  '...kyyyYyyk...',
  '...kdRrrRdk...',
  '...kddkkddk...',
  '...kddk.kddk..',
  '...kddk.kddk..',
  '..kddk..kddk..',
  '..kkkk..kkkk..',
];
const bodyFor = (hair: HairStyle) => grid([...HAIR[hair].rows, ...BODY_LOWER]);
const BODY_X = 9;
const BODY_Y = 2;

// 前臂（只画有色像素，描边统一补）。坐标相对画布。y 腕环。
const ARM_IDLE: Layer = { g: grid(['s.', 'ts', '.y', '.t']), x: 20, y: 17 };
const ARM_THROW: Layer = { g: grid(['ssyt']), x: 20, y: 17 };
const ARM_FOLLOW: Layer = { g: grid(['s...', '.syt']), x: 20, y: 17 };

// 乾坤圈：5×5 空心金环，不描边（中间要透出背景）。
export const RING = grid(['.yYy.', 'y...Y', 'b...y', 'b...y', '.bby.']);
const RING_SPIN = grid(['.byY.', 'b...y', 'B...Y', 'b...y', '.yyb.']);

// 风火轮：两个转动相位。后轮用暗一档的颜色表现纵深。
const WHEEL = [
  grid(['.byb.', 'bk.kb', 'y.k.y', 'bk.kb', '.byb.']),
  grid(['.bYb.', 'b.k.b', 'ykkky', 'b.k.b', '.bYb.']),
];
const darker = (g: Grid): Grid => ({
  ...g,
  rows: g.rows.map((r) => r.replace(/b/g, 'B').replace(/y/g, 'b').replace(/Y/g, 'y')),
});
const WHEEL_BACK = WHEEL.map(darker);

// 火焰：三帧闪烁，贴在轮子后方。不描边，进场景后另加发光。
const FLAME = [
  grid(['..o.', '.oe.', 'oeY.', '.ee.']),
  grid(['.o..', '.eo.', 'eYe.', '.ee.']),
  grid(['....', '..o.', 'oeo.', 'eYe.']),
];
const FLAME_LONG = [
  grid(['...o..', '..oe..', 'oeeYe.', '.eeee.']),
  grid(['..o...', '.oeo..', 'eeYeo.', '..eee.']),
  grid(['......', '.o.o..', 'oeeeo.', 'eYeee.']),
];

/**
 * 混天绫：两条波形曲线。上一条从后肩拱起、越过脑后再垂下；下一条从后腰向后甩。
 * 靠近身体处两像素宽（亮面 + 暗面），往末端收成一像素，末梢提亮。
 */
function sash(phase: number, moving: boolean, rib: { x: number; y: number }): Grid {
  const px = new Map<string, string>();
  const put = (x: number, y: number, ch: string) => {
    const k = `${x},${y}`;
    const cur = px.get(k);
    if (cur && (cur === 'e' || cur === 'o') && ch === 'r') return;
    px.set(k, ch);
  };
  const strand = (fx: (t: number) => number, fy: (t: number) => number, thickUntil: number) => {
    let prev: [number, number] | null = null;
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const p: [number, number] = [Math.round(fx(t)), Math.round(fy(t))];
      const pts: [number, number][] = [];
      if (prev) {
        const steps = Math.max(Math.abs(p[0] - prev[0]), Math.abs(p[1] - prev[1]));
        for (let s = 1; s <= steps; s++)
          pts.push([Math.round(prev[0] + ((p[0] - prev[0]) * s) / steps), Math.round(prev[1] + ((p[1] - prev[1]) * s) / steps)]);
      } else pts.push(p);
      for (const [x, y] of pts) {
        put(x, y, t > 0.86 || (i % 9 === 0 && t > 0.2) ? 'o' : 'e');
        if (t < thickUntil) put(x, y + 1, 'r');
      }
      prev = p;
    }
  };
  const TAU = Math.PI * 2;
  const s = (t: number, f: number) => Math.sin(TAU * (f * t - phase));
  // 发髻红绳：两缕一像素细带，从后髻的红绳处向后飘
  strand(
    (t) => rib.x - (moving ? 6.5 : 5.5) * t,
    (t) => rib.y - 1.2 * Math.sin(Math.PI * t) + (moving ? 0.5 : 3) * t + 0.8 * s(t, 1.3) * t,
    0,
  );
  strand(
    (t) => rib.x - (moving ? 5.5 : 4.5) * t,
    (t) => rib.y + 0.5 - 0.6 * Math.sin(Math.PI * t) + (moving ? 1.5 : 4.5) * t + 0.7 * Math.sin(TAU * (1.1 * t - phase - 0.3)) * t,
    0,
  );
  if (!moving) {
    // 上：从后肩沿肩线向后平甩，略微下垂
    strand(
      (t) => 12 - 11 * t,
      (t) => 16 - 2.5 * Math.sin(Math.PI * t * 0.8) + 1.4 * s(t, 0.9) * t,
      0.5,
    );
    // 下：从后腰向后下方甩
    strand(
      (t) => 12 - 8.5 * t,
      (t) => 21 + 3 * t + 1.4 * s(t, 1.1) * t,
      0.4,
    );
  } else {
    strand(
      (t) => 12 - 12.5 * t,
      (t) => 16 - 1.5 * Math.sin(Math.PI * t * 0.7) + 1.7 * s(t, 1.0) * t,
      0.5,
    );
    strand(
      (t) => 12 - 10 * t,
      (t) => 21 + 0.5 * t + 1.6 * s(t, 1.2) * t,
      0.4,
    );
  }
  const rows = Array.from({ length: NEZHA_H }, (_, y) =>
    Array.from({ length: NEZHA_W }, (_, x) => px.get(`${x},${y}`) ?? '.').join(''),
  );
  return grid(rows);
}

export type NezhaPose = 'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow';

interface FrameSpec {
  pose: NezhaPose;
  bob: number; // 身体上下浮动（像素）
  lean: number; // 身体前倾（像素）
  sashPhase: number;
  wheel: number;
  flame: number;
  ring: 'hand' | 'behind' | 'released' | 'none';
}

function buildFrame(f: FrameSpec, hair: HairStyle): Grid {
  const moving = f.pose === 'move' || f.pose === 'moveBare';
  const shifted = (l: Layer): Layer => ({ ...l, x: l.x + f.lean, y: l.y + f.bob });
  const arm = f.pose === 'throw' ? ARM_THROW : f.pose === 'follow' ? ARM_FOLLOW : f.pose === 'windup' ? null : ARM_IDLE;

  const under: Layer[] = [{ g: sash(f.sashPhase, moving, HAIR[hair].ribbon), x: f.lean, y: f.bob }];
  if (f.ring === 'behind') under.push({ g: RING_SPIN, x: 6 + f.lean, y: 12 + f.bob });
  const base = outline(
    compose(NEZHA_W, NEZHA_H, [
      ...under,
      { g: WHEEL_BACK[f.wheel], x: 10, y: 27 },
      { g: WHEEL[(f.wheel + 1) % 2], x: 16, y: 27 },
      { g: bodyFor(hair), x: BODY_X + f.lean, y: BODY_Y + f.bob },
      ...(arm ? [shifted(arm)] : []),
    ]),
    'k',
    SELOUT,
  );

  const flames = moving ? FLAME_LONG : FLAME;
  const fw = moving ? 6 : 4;
  const extra: Layer[] = [
    { g: flames[f.flame % 3], x: 10 - fw + 1, y: 26 },
    { g: flames[(f.flame + 1) % 3], x: 16 - fw + 2, y: 27 },
  ];
  if (f.ring === 'hand') extra.push({ g: RING, x: 21 + f.lean, y: 19 + f.bob });
  if (f.ring === 'released') extra.push({ g: RING_SPIN, x: 25 + f.lean, y: 15 + f.bob });
  return compose(NEZHA_W, NEZHA_H, [{ g: base, x: 0, y: 0 }, ...extra]);
}

export function makeNezhaFrames(hair: HairStyle): Record<NezhaPose, Grid[]> {
  const b = (f: FrameSpec) => buildFrame(f, hair);
  return {
    idle: [0, 1, 2, 3].map((i) =>
      b({ pose: 'idle', bob: i === 1 || i === 2 ? 1 : 0, lean: 0, sashPhase: i / 4, wheel: 0, flame: i % 3, ring: 'hand' }),
    ),
    move: [0, 1, 2, 3].map((i) =>
      b({ pose: 'move', bob: i % 2, lean: 1, sashPhase: i / 4, wheel: i % 2, flame: i % 3, ring: 'hand' }),
    ),
    // 乾坤圈飞出去时手里是空的
    idleBare: [0, 1, 2, 3].map((i) =>
      b({ pose: 'idleBare', bob: i === 1 || i === 2 ? 1 : 0, lean: 0, sashPhase: i / 4, wheel: 0, flame: i % 3, ring: 'none' }),
    ),
    moveBare: [0, 1, 2, 3].map((i) =>
      b({ pose: 'moveBare', bob: i % 2, lean: 1, sashPhase: i / 4, wheel: i % 2, flame: i % 3, ring: 'none' }),
    ),
    windup: [b({ pose: 'windup', bob: 1, lean: -1, sashPhase: 0.1, wheel: 0, flame: 0, ring: 'behind' })],
    throw: [b({ pose: 'throw', bob: 0, lean: 1, sashPhase: 0.35, wheel: 1, flame: 1, ring: 'released' })],
    follow: [b({ pose: 'follow', bob: 0, lean: 1, sashPhase: 0.6, wheel: 0, flame: 2, ring: 'none' })],
  };
}

export const DEFAULT_HAIR: HairStyle = 'backtwin'; // 暂定：用户在后单髻 / 后双髻 / 圆双髻里挑（2026-11-09），叠髻被否（像两个角）
export const NEZHA_FRAMES = makeNezhaFrames(DEFAULT_HAIR);

/** 飞出去的乾坤圈：两帧旋转。 */
export const RING_PROJECTILE = [RING, RING_SPIN];

// 乾坤圈飞远时变大（用户：毕竟是法宝）：手画 7、9 像素两档，像素不会糊。旋转帧用镜像。
const RING7 = grid(['..yYy..', '.y...Y.', 'b.....y', 'b.....Y', 'b.....y', '.b...y.', '..bby..']);
const RING9 = grid(['...yYy...', '.yy...Yy.', '.y.....Y.', 'b.......y', 'b.......Y', 'b.......y', '.b.....y.', '.bb...yy.', '...bby...']);
/** 按尺寸分档的乾坤圈：[5 像素, 7 像素, 9 像素]，每档两帧旋转。 */
export const RING_SIZES = [RING_PROJECTILE, [RING7, flipX(RING7)], [RING9, flipX(RING9)]];

/** 造型构件（只读）：魔化哪吒这类「另一个自己」用同一套部件重新配色、加新姿势。 */
export const NEZHA_PARTS = { HAIR, BODY_LOWER, BODY_X, BODY_Y, ARM_IDLE, ARM_THROW, ARM_FOLLOW, RING, RING_SPIN, WHEEL, WHEEL_BACK, FLAME, FLAME_LONG, SELOUT, sash };
