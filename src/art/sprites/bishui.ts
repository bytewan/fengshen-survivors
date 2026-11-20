// 避水兽（回响敖丙的宠物；暂拟，待评审确认）：原著里敖丙骑的那头水兽。朝右绘制，朝左时整体镜像。画布 36×23，脚底锚点 (16, 21)。
// 2026-11-11 晚重画（原来 30×19「像一只带角的青色小兽」）：照避水金睛兽的意思画成一头镇水的神兽——
// 按「人物与宠物的尺子」：约人的一半高——头顶离地 17（连角 20）、背高 12，从鼻尖到尾根约 24；头占身长三分之一、昂着、粗颈深胸、粗腿。
// 样子：石青的鳞身（背上天青的受光、一片片错开的鳞、腹下背光），从额后到肩一道浪一样的月白长鬃（一绺一绺），
// 额上一支往后掠的分叉龙角（缃金），金睛，颔下一缕白须，踝后一撮水一样的距毛，玄青的蹄；
// 尾巴是一道翻起来的浪（天青的水、梢上一团月白的沫，按波形栅格化，帧间连续起伏；奔的时候被风拉平）。
// 帧：待机（4：呼吸）、小跑（4）、奔（4：伸展 / 收拢）。只画兽本身；冲过去掀起的浪、打湿的水珠在 game/pets/bishui-fx.ts。
// 另有三枚 16×16 图标（万宝阁、升级面板用）：本体、进化「怒涛」「霜髓」，和回响敖丙的专属法宝「游龙戟」的图标。
import { compose, grid, outline, type Grid } from '../pixel.ts';

export const BISHUI_W = 36;
export const BISHUI_H = 23;
export const BISHUI_ANCHOR = { x: 16, y: 21 };

/** 描边：角描赭，其余描玄。 */
const SEL: Record<string, string> = { y: 'B', Y: 'B' };

/**
 * 上身（角、头、颈、躯干；15 行），放在画布 (6, 1)。c 鳞、C 受光的鳞、n 背光 / 远侧 / 腹下、w Z 浪一样的鬃（顺着鬃的走向一绺一绺）和嘴边一根龙须、Y y 往后掠的分叉龙角和金睛、k 瞳。
 * 昂着头、粗颈、深胸，头占身长的三分之一：是一头镇水的神兽，不是猫狗。
 */
const BODY = [
  '.............Y............',
  '..............Y...Y.......',
  '............w..yYy........',
  '...........wZwwCCCCc......',
  '..........wZwwCCCCCCCc....',
  '.........w.wZwCCCYkCCCCc..',
  '..........wZwwcCCCCCCCCCc.',
  '.........wZwwccccCCCcCnCn.',
  '........w.wZwcccccnnnnnn..',
  '....CcCCcwZwwcccccnwZ.....',
  '...CcCCcCCwZwwccccn.w.....',
  '..cCccCccCcwZwcccn........',
  '..ccCccCccCcwZccccn.......',
  '..ccnCcnCcnCcwcccn........',
  '...nnnccnnnccnnccn........',
];
type Legs = [string, string, string, string, string, string];
/** 腿（6 行），放在画布 (6, 15)：粗腿、踝后一撮水一样的距毛（w）、玄青的蹄；远侧的腿只画一道背光（n）。 */
const STAND: Legs = [
  '...ccn.nn......ccn.nn.....',
  '...ccn.nn......ccn.nn.....',
  '...cCn.nn......cCn.nn.....',
  '..wcn..nn.....wcn..nn.....',
  '...cn..nn......cn..nn.....',
  '..NNN..NN.....NNN..NN.....',
];
const TROT: Legs[] = [
  ['...ccn.........ccn........', '..ccn.nn.......nn.ccn.....', '.cCn...nn.....nn...cCn....', 'wcn.....nn...nn.....cn....', '.cn.....nn...nn.....cnw...', 'NNN.....NN...NN.....NNN...'],
  ['...ccn.........ccn........', '...ccnn........ccnn.......', '...cCnn........cCnn.......', '..wcn.n.......wcn.n.......', '...cn..........cn.........', '..NNN.........NNN.........'],
  ['...ccn.........ccn........', '..nn.ccn......ccn.nn......', '.nn...cCn....cCn...nn.....', '.nn....cn...wcn....nn.....', 'nn....wcn....cn.....nn....', 'NN.....NNN..NNN.....NN....'],
  ['...ccn.........ccn........', '...ccnn........ccnn.......', '...cCnn........cCnn.......', '..wcn.n.......wcn.n.......', '...cn..........cn.........', '..NNN.........NNN.........'],
];
const RUN: Legs[] = [
  ['..ccn...........ccn.......', '.ccn.n...........nccn.....', 'cCn..n............n.cCn...', 'cn...n.............n..cnw.', 'NN..n...............n.NNN.', '....N...............N.....'],
  ['...ccn.........ccn........', '...ccnn.......nccn........', '....cCn......ncCn.........', '....wcnn....nwcn..........', '.....NNN....NNN...........', '..........................'],
  ['...ccn.........ccn........', '....ccn.......ccn.........', '.....cCn.....cCn..........', '.....wcn....wcn...........', '......NNN...NNN...........', '..........................'],
  ['..ccn...........ccn.......', '.ccn.n...........nccn.....', 'cCn..n............n.cCn...', 'cn...n.............n..cnw.', 'NN..n...............n.NNN.', '....N...............N.....'],
];

/**
 * 尾巴：一道翻起来的浪——从尾根往后上方卷起、梢上翻下来一点（浪头），根上两像素厚（上面受光、下面背光）、梢上是月白的沫，分两叉；
 * ph 让它一起一伏，run 时被风拉平、拖得更长。
 */
function tail(x0: number, y0: number, ph: number, run: boolean): Grid {
  const px = new Map<string, string>();
  const len = run ? 9 : 6;
  const N = 28;
  let tx = x0;
  let ty = y0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const sway = Math.sin(Math.PI * 2 * (t * 0.8 - ph)) * (run ? 0.9 : 0.7) * t;
    tx = Math.round(x0 - len * t);
    ty = Math.round(y0 - (run ? 2.2 * t : 6 * t * t) + sway);
    px.set(`${tx},${ty}`, t > 0.7 ? 'w' : 'C');
    px.set(`${tx},${ty + 1}`, t > 0.7 ? 'Z' : t < 0.35 ? 'n' : 'c');
  }
  // 浪头：梢上一团翻起来的沫（上面月白、下面一点银灰的影）
  for (const [dx, dy, c] of run
    ? ([[-1, 0, 'w'], [-2, 0, 'w'], [-1, 1, 'Z'], [-2, 1, 'w'], [-3, 1, 'Z']] as const)
    : ([[-1, -1, 'w'], [0, -1, 'w'], [1, -1, 'w'], [-1, 0, 'w'], [1, 0, 'w'], [2, 0, 'Z'], [-1, 1, 'Z'], [1, 1, 'Z']] as const))
    px.set(`${tx + dx},${ty + dy}`, c);
  return grid(Array.from({ length: BISHUI_H }, (_, y) => Array.from({ length: BISHUI_W }, (_, x) => px.get(`${x},${y}`) ?? '.').join('')));
}

export type BishuiPose = 'idle' | 'trot' | 'run';

function frame(legs: Legs, bob: number, ph: number, run: boolean): Grid {
  return outline(
    compose(BISHUI_W, BISHUI_H, [
      { g: tail(9, 11 + bob, ph, run), x: 0, y: 0 },
      { g: grid(legs), x: 6, y: 15 },
      { g: grid(BODY), x: 6, y: 1 + bob },
    ]),
    'k',
    SEL,
  );
}

export function makeBishuiFrames(): Record<BishuiPose, Grid[]> {
  return {
    idle: [frame(STAND, 0, 0, false), frame(STAND, 1, 0.25, false), frame(STAND, 1, 0.5, false), frame(STAND, 0, 0.75, false)],
    trot: TROT.map((l, i) => frame(l, i % 2, i / 4, false)),
    run: RUN.map((l, i) => frame(l, i === 1 || i === 2 ? 0 : 1, i / 4, true)),
  };
}

export const BISHUI_FRAMES = makeBishuiFrames();

// ---------------------------------------------------------------- 图标（16×16：内容不超过 14×14、居中，外圈描玄色边）

function icon(rows: string[], sel?: Record<string, string>): Grid {
  const g = grid(rows);
  return outline(compose(16, 16, [{ g, x: 1 + ((14 - g.w) >> 1), y: 1 + ((14 - g.h) >> 1) }]), 'k', sel);
}

/** 本体：避水兽的头（往后掠的分叉龙角、浪一样的白鬃、石青的鳞、金睛、颔下一缕须）。 */
const BASE = [
  '....Y.........',
  '.....Y...Y....',
  '..w...yYy.....',
  '...wZwCCCCc...',
  '..wZwCCCCCCc..',
  '.w.wZCCYkCCCc.',
  '..wZwcCCCCCCCc',
  '.wZwcccCCcCnCn',
  '..wZcccccnnnn.',
  '.wZwccccnwZ...',
  '..wZwcccn.w...',
  '...wZccn......',
];
/** 怒涛：一道卷起来的浪头（月白的沫、天青的水）。 */
const SURGE = [
  '......wWw.....',
  '....wWCCCw....',
  '...wCCccCCw...',
  '..wCCc..cCW...',
  '.wCCc....cw...',
  '.WCc..........',
  'wCCc..........',
  'wCCcc.......w.',
  'WCCCcc....wCw.',
  '.wCCCCccccCCw.',
  '..wWCCCCCCWw..',
  '....wwWWww....',
];
/** 霜髓：一枚六角的冰晶，当中一点月白。 */
const MARROW = [
  '......C.......',
  '...C..C..C....',
  '....C.Z.C.....',
  '.....CZC......',
  '.C..CZWZC..C..',
  '..CZZWWWZZC...',
  '.C..CZWZC..C..',
  '.....CZC......',
  '....C.Z.C.....',
  '...C..C..C....',
  '......C.......',
];
/** 游龙戟：斜着的一杆方天画戟（月牙刃、天青的缨），戟杆上盘着一条小冰龙。 */
const YOULONG = [
  '.........Z....',
  '........ZWZ..Z',
  '.......ZWWZ.ZZ',
  '........ZWZZZ.',
  '......C..TZZ..',
  '.....CwC.nT...',
  '.....C.Cn.....',
  '......Cn.C....',
  '.....Cn.wC....',
  '....Cn.CC.....',
  '...n..........',
  '..n...........',
  '.y............',
];

export const BISHUI_ICONS: { base: Grid; surge: Grid; marrow: Grid } = { base: icon(BASE, SEL), surge: icon(SURGE), marrow: icon(MARROW) };
export const YOULONG_ICON: Grid = icon(YOULONG, SEL);
