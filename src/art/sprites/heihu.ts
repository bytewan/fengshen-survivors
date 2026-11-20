// 黑虎（赵公明的宠物；2026-11-11 用户试玩后重画，暂拟，待评审确认）：一头雄壮的黑虎，朝右绘制，朝左时整体镜像。
// 画布 34×19，脚底锚点 (17, 17)（第 17 行是脚掌）。用户：「每个主角的模型都必须要帅，包括狗和豹子的」「这个豹子也不像豹子」——
// 原来又长又扁、头小腿短，像黄鼠狼；这一版要一眼就是猛兽、一眼就是虎：大头、宽肩、厚胸、粗腿、大爪，额上「王」字，身上的虎纹看得见。
// 尺子（docs/design.md「人物与宠物的尺子」）：约人的一半高——耳尖离地 14、肩峰离地 12，从臀到口鼻 23（约身高的 1.6 倍）。
// 头正对着看过来（四分之三）：圆耳、耳里一点浅毛，额上琥珀色的「王」字（3×5，中间一竖赭色），两边各一道黑纹，金眼，眼上一点白眉，
// 白腮、口鼻、下巴（苍、银鼠），鼻头一点玄。扑出去时头往前伸、耳朵往后抿。
// 毛：乌（d）为底，上半身受光（黛 g），肩峰、胯上一点青光（黛蓝 n）——黑里带一点青紫的光泽；玄色虎纹（k）一道道穿过受光的那一半；
// 肚子、爪尖一道浅毛（h）。前腿最粗、腕上收细，大爪；后腿有弯（飞节往后）。长尾巴两像素粗，梢上卷、一节节玄色环纹。
// 字母沿用原来那一套（d g h i b y w k；回响赵公明的魂虎按字母换色，见 art/sprites/echo-tone.ts 的 TIGER_TONE），新加的只有 n（背上的青光）、B（王字中间一竖）、R（吼的时候的舌）。
// 帧：待机（4：尾巴甩、喘一口气、竖耳张望）、小跑（4）、扑（4：伸展 → 前腿落地 → 收拢 → 蹬地）、吼（2：抬头张口露出獠牙、合上一半）。
// 只画虎本身；吼声、扑起的尘土、被震慑的敌人头上的「王」纹在 game/pets/heihu-fx.ts。
import { compose, grid, outline, type Grid } from '../pixel.ts';

export const TIGER_W = 34;
export const TIGER_H = 19;
export const TIGER_ANCHOR = { x: 17, y: 17 };

/** 描边：金眼、王字纹描赭，其余描玄。 */
const SEL: Record<string, string> = { y: 'B', Y: 'B', b: 'B' };

/** 一个部件：从第 y 行起的几行（34 宽，'.' 透明）。 */
interface Part {
  y: number;
  rows: string[];
}

// ---------------------------------------------------------------- 头

const HEAD: Record<string, Part> = {
  front: {
    y: 3,
    rows: [
      '.....................gg.....gg....', // 圆耳
      '....................gdhgbBbghdg...', // 耳里浅毛；王（上横）
      '....................gdkddBddkdg...', // 额上两道虎纹；王（竖）
      '....................ddkdbBbdkdd...', // 王（中横）
      '....................dddidBdiddd...', // 白眉；王（竖）
      '....................kddydbdyddk...', // 金眼；王（下横）
      '....................didhhkhhdid...', // 腮上一点白；鼻头
      '.....................kdihhhidk....', // 口鼻
      '......................diiiiid.....', // 下巴
    ],
  },
  look: {
    y: 2,
    rows: [
      '.....................g.......g....', // 耳朵竖起来
      '.....................gg.....gg....',
      '....................gdhgbBbghdg...',
      '....................gdkddBddkdg...',
      '....................ddkdbBbdkdd...',
      '....................dddidBdiddd...',
      '....................kddydbdyddk...',
      '....................didhhkhhdid...',
      '.....................kdihhhidk....',
      '......................diiiiid.....',
    ],
  },
  roar: {
    y: 2,
    rows: [
      '.....................gg.....gg....',
      '....................gdhgbBbghdg...',
      '....................gdkddBddkdg...',
      '....................ddkdbBbdkdd...',
      '....................dkdkdBdkdkd...', // 眼眯成一道
      '....................didhhkhhdid...',
      '.....................dwkkkkkwd....', // 张口：獠牙
      '.....................dwkRRRkwd....', // 舌
      '......................diiiiid.....', // 下颌
    ],
  },
  roar2: {
    y: 2,
    rows: [
      '.....................gg.....gg....',
      '....................gdhgbBbghdg...',
      '....................gdkddBddkdg...',
      '....................ddkdbBbdkdd...',
      '....................dkdkdBdkdkd...',
      '....................didhhkhhdid...',
      '.....................kdwkkkwdk....', // 合上一半
      '......................diiiiid.....',
    ],
  },
  run: {
    y: 4,
    rows: [
      '......................gg..........', // 耳朵往后抿
      '.....................gdgbBbg......',
      '....................gdkdBdkdd.....',
      '....................ddkbBbkddd....',
      '....................ddidydddhh....', // 金眼
      '....................didhhhhhhk....', // 口鼻往前探、鼻头
      '.....................ddiiiihh.....',
      '......................diiii.......',
    ],
  },
};

// ---------------------------------------------------------------- 身子

const BODY: Record<string, Part> = {
  stand: {
    y: 5,
    rows: [
      '..............ggnggg..............', // 肩峰：一点青光
      '..........gngggggggd..............',
      '........dgkggkggkggkd.............', // 背上的虎纹
      '.......dgkgdkggkgdkgd.............',
      '.......ddkddkddkddkdd.............',
      '.......ddddddddddddddd............',
      '.......ddddhhhhhhddddd............', // 肚子的浅毛（腰下略收）、厚胸
    ],
  },
  stretch: {
    y: 6,
    rows: [
      '.............ggnggg...............',
      '........gnggggggggd...............',
      '......dgkggkggkggkgd..............',
      '......dgkgdkggkgdkgdd.............',
      '......ddkddkddkddkddd.............',
      '.......ddddhhhhhhhdddd............',
    ],
  },
  gather: {
    y: 4,
    rows: [
      '...........ggngg..................',
      '.........gnggggggn................',
      '........dgkggkggkggd..............',
      '........dgkgdkggkgdkd.............',
      '........ddkddkddkdddd.............',
      '........ddddddddddddd.............',
      '.........dddhhhhhdddd.............',
    ],
  },
};

// ---------------------------------------------------------------- 腿（每帧一套，贴地画）

const LEGS: Record<string, Part> = {
  stand: {
    y: 12,
    rows: [
      '.......gddd.....dggddd............',
      '.......gdd.....dkggdd.............',
      '......ggkd.....dkgkdd.............',
      '......gdd......d.ggd..............',
      '.....gggdd....dd.gggdd............',
      '.....hhkhh....kk.hhkhh............',
    ],
  },
  trotA: {
    y: 12,
    rows: [
      '.......gddd.....dggddd............',
      '......gdd......dk.ggdd............',
      '.....ggkd.....dk...gkdd...........',
      '....gdd.......d.....ggd...........',
      '...gggdd.....dd.....gggdd.........',
      '...hhkhh.....kk.....hhkhh.........',
    ],
  },
  trotB: {
    y: 12,
    rows: [
      '.......gddd.....dggddd............',
      '.......gdd......dggdd.............',
      '.......ggkd.....dgkdd.............',
      '.......gdd......d.ggd.............',
      '......gggdd....dd.hhhd............',
      '......hhkhh....kk.................',
    ],
  },
  trotC: {
    y: 12,
    rows: [
      '.......gddd.....dggddd............',
      '........gdd.....ggdd.d............',
      '........ggkd...gkdd..dk...........',
      '.........gdd...ggd....d...........',
      '.........gggddgggdd...dd..........',
      '.........hhkhhhhkhh...kk..........',
    ],
  },
  trotD: {
    y: 12,
    rows: [
      '.......gddd.....dggddd............',
      '.......gdd......dggdd.............',
      '.......gkd......dgkdd.............',
      '......gd.d......dggd..............',
      '....hhhd.......ddgggdd............',
      '...............kkhhkhh............',
    ],
  },
  runA: {
    y: 12,
    rows: [
      '......gdd..........ggdd...........',
      '....ggd..............ggdd.........',
      '...gkd.................gkd........',
      '.ggd.....................ggd......',
      'hhh.......................hhh.....',
    ],
  },
  runB: {
    y: 12,
    rows: [
      '.......gddd......ggddd............',
      '........gdd......ggdd.............',
      '.........gkd.....gkdd.............',
      '..........gd.....ggd..............',
      '..........hhh...gggdd.............',
      '................hhkhh.............',
    ],
  },
  runC: {
    y: 11,
    rows: [
      '.........gddd.....ggdd............',
      '..........gdd....gdd..............',
      '...........ggd.hhgd...............',
      '............gkd...................',
      '.............gdd..................',
      '..............hhh.................',
    ],
  },
  runD: {
    y: 12,
    rows: [
      '.......gddd.......ggdd............',
      '.......gdd..........ggd...........',
      '......ggkd............gkd.........',
      '......gdd...............gd........',
      '.....gggdd...............hhh......',
      '.....hhkhh........................',
    ],
  },
};

// ---------------------------------------------------------------- 尾巴（两像素粗的长尾，梢上卷，一节节玄色环纹）

/** 尾巴的点（从尾根起；前三个点下面再补一格，尾根粗）。dy 跟着身子走。 */
const TAIL: Record<string, [number, number][]> = {
  rest: [[7, 7], [6, 7], [5, 8], [4, 8], [3, 8], [2, 7], [2, 6], [3, 5]],
  swish: [[7, 7], [6, 8], [5, 9], [4, 9], [3, 9], [2, 8], [2, 7], [2, 6]],
  run: [[6, 8], [5, 8], [4, 8], [3, 7], [2, 7], [1, 6], [1, 5]],
  up: [[7, 6], [6, 5], [5, 5], [4, 4], [4, 3], [4, 2], [5, 1]],
};

/** 拼一帧：尾巴、腿、身子、头（身子、头、尾巴随 dy 浮动；腿是贴地画的），一起描边。 */
function frame(head: string, body: string, legs: string, tail: string, dy = 0, hy = 0): Grid {
  const px: string[][] = Array.from({ length: TIGER_H }, () => Array(TIGER_W).fill('.'));
  const put = (p: Part, oy: number) =>
    p.rows.forEach((r, j) =>
      [...r].forEach((ch, x) => {
        const y = p.y + oy + j;
        if (ch !== '.' && y >= 0 && y < TIGER_H) px[y][x] = ch;
      }),
    );
  TAIL[tail].forEach(([x, y], i, a) => {
    const Y = y + dy;
    if (Y < 0 || Y >= TIGER_H) return;
    px[Y][x] = i % 2 === 1 || i === a.length - 1 ? 'k' : 'd';
    if (i < 3 && Y + 1 < TIGER_H) px[Y + 1][x] = 'd';
  });
  put(LEGS[legs], 0);
  put(BODY[body], dy);
  put(HEAD[head], dy + hy);
  return outline(compose(TIGER_W, TIGER_H, [{ g: grid(px.map((r) => r.join(''))), x: 0, y: 0 }]), 'k', SEL);
}

export type TigerPose = 'idle' | 'trot' | 'run' | 'roar';

export function makeTigerFrames(): Record<TigerPose, Grid[]> {
  return {
    // 待机：尾巴慢慢甩；喘一口气（身子、头往下一格）；竖耳张望
    idle: [frame('front', 'stand', 'stand', 'rest'), frame('front', 'stand', 'stand', 'swish'), frame('front', 'stand', 'stand', 'rest', 1, 0), frame('look', 'stand', 'stand', 'swish')],
    trot: [frame('front', 'stand', 'trotA', 'swish'), frame('front', 'stand', 'trotB', 'rest', -1), frame('front', 'stand', 'trotC', 'swish'), frame('front', 'stand', 'trotD', 'rest', -1)],
    run: [frame('run', 'stretch', 'runA', 'run', 0), frame('run', 'stand', 'runB', 'run', 0, 1), frame('run', 'gather', 'runC', 'up', 0, -1), frame('run', 'stand', 'runD', 'run', 0, 1)],
    roar: [frame('roar', 'stand', 'stand', 'up'), frame('roar2', 'stand', 'stand', 'up')],
  };
}

export const TIGER_FRAMES = makeTigerFrames();
