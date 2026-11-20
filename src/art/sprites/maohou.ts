// 毫毛猴（孙悟空的宠物；用户 11-11 确认的设计，画法 暂拟）：一只小金毛猴，朝右绘制，朝左时整体镜像。画布 14×12，脚底锚点 (7, 11)。
// 用户：宠物比人物小得多、不要画得过大（人物约 16×24）——这只猴蹲着约 10 宽、9 高，比人矮一大半、比黑虎小一圈；
// 用户（11-11 试玩后）：宠物也要帅、比例协调——画成一只精瘦、机灵的小金丝猴（不是圆滚滚的布偶）。
// 样子：赭 / 琥珀两档的金毛、侧身的小脸（尖一点的嘴筒子、一只亮眼）、弓背长臂、长尾巴卷成钩翘起来；头顶一撮金毫毛（藤黄）。
// 帧：蹲着（4：尾巴慢慢甩、挠一下头）、蹦（4：蹲下、蹦起、腾空、落地）、吹毫毛（2：拈一根毫毛凑到嘴边、鼓腮一吹）。
// 吹出来的小猴分身用同一套帧，换成更亮的金色（CLONE_COLORS；毫毛变的，比本体浅、半透明一点，见 game/pets/maohou-fx.ts）。
import { compose, grid, outline, type Grid } from '../pixel.ts';

export const MONKEY_W = 14;
export const MONKEY_H = 12;
export const MONKEY_ANCHOR = { x: 7, y: 11 };

/** 描边：金毛、毫毛描赭，脸描檀，其余描玄。 */
const SEL: Record<string, string> = { b: 'B', y: 'B', Y: 'B', t: 'S', s: 'S' };

/**
 * 每一帧手画：10 行，放在画布 (1, 1)。侧身朝右的一只精瘦的小金丝猴（用户：要灵、不要像布偶）：小脑袋、尖一点的嘴筒子、
 * 一只亮眼（玄），弓着背、长胳膊撑在地上，长尾巴从身后卷成一个钩高高地翘起来。
 * B 深毛（背、尾巴、四肢的暗面）、b 毛、t 脸和胸口、s 脸上的暗处、k 眼睛（已经是描边色，不再往外描）、y 头顶的一撮金毫毛、吹出去的毫毛。
 */
const SIT = [
  '..BB........',
  '.B..B..ybb..',
  '.B...Bbbtk..',
  '..B..BbtttS.',
  '...BBbbbtb..',
  '...BbbbbbB..',
  '..BbbbtbB...',
  '..BbBbtB....',
  '..Bb.BbB....',
  '..BB.BB.B...',
];
/** 尾巴甩到另一边（钩往下一勾）、头偏一偏。 */
const SIT2 = [
  '............',
  '.......ybb..',
  '.BB...Bbbtk.',
  'B..B..BbtttS',
  'B...BBbbbtb.',
  '.B..BbbbbbB.',
  '..BBbbbtbB..',
  '...BbBbtB...',
  '...Bb.BbB...',
  '...BB.BB.B..',
];
/** 挠头：一只手抬到头顶（眯起眼）。 */
const SCRATCH = [
  '..BB....Bb..',
  '.B..B..ybbB.',
  '.B...BbbtS..',
  '..B..BbtttS.',
  '...BBbbbtb..',
  '...BbbbbbB..',
  '..BbbbtB....',
  '..BbBbtB....',
  '..Bb.BbB....',
  '..BB.BB.B...',
];
/** 蹦：蹲下蓄劲 / 蹬地蹿起（身子拉长）/ 腾空（四肢伸开、尾巴拉直）/ 落地（前爪先着地）。 */
const HOP = [
  [
    '............',
    '.BB.........',
    'B..B...ybb..',
    'B...BBbbbtk.',
    '.B..BbbbtttS',
    '..BBbbbbbtb.',
    '..BbbbbbbB..',
    '..BbbbtbB...',
    '..BBb.BbBB..',
    '..BB..BB.BB.',
  ],
  [
    '.........yb.',
    '........bbtk',
    'BB....BbbttS',
    '..B..BbbbtB.',
    '...BBbbbbB..',
    '...BbbbtB...',
    '..BbbbBB....',
    '.BbB.Bb.....',
    'BB...B......',
    '............',
  ],
  [
    '............',
    '.........yb.',
    '........bbtk',
    'BBBB..BbbbttS',
    '....BBbbbbB.',
    '....BbbtbB.B',
    '...BB....BB.',
    '..B.........',
    '............',
    '............',
  ],
  [
    '............',
    '............',
    '........ybb.',
    '.BB....Bbbtk',
    'B..BBBbbbttS',
    '....BbbbbtB.',
    '...BbbbbbBB.',
    '..BbBbtBB.B.',
    '.BB..BB...BB',
    '............',
  ],
];
/** 吹毫毛：坐直了拈一根毫毛凑到嘴边 / 鼓腮一吹（几根毫毛往前飞散）。 */
const BLOW = [
  [
    '..BB........',
    '.B..B..ybb..',
    '.B...Bbbtk..',
    '..B..BbtttBy',
    '...BBbbbtBB.',
    '...BbbbbbB..',
    '..BbbbtbB...',
    '..BbBbtB....',
    '..Bb.BbB....',
    '..BB.BB.B...',
  ],
  [
    '..BB........',
    '.B..B..ybb.y',
    '.B...Bbbtk..',
    '..B..BbtttO.y',
    '...BBbbbtb..',
    '...BbbbbbB.y',
    '..BbbbtbB...',
    '..BbBbtB....',
    '..Bb.BbB....',
    '..BB.BB.B...',
  ],
];

const frame = (rows: string[]): Grid => outline(compose(MONKEY_W, MONKEY_H, [{ g: grid(rows.map((r) => r.replace(/O/g, 'k'))), x: 1, y: 1 }]), 'k', SEL);

export type MonkeyPose = 'sit' | 'hop' | 'blow';
export const MONKEY_FRAMES: Record<MonkeyPose, Grid[]> = {
  sit: [SIT, SIT2, SIT, SCRATCH].map(frame),
  hop: HOP.map(frame),
  blow: BLOW.map(frame),
};

/** 分身的换色：毫毛变的小猴，毛色亮一档（深毛 → 琥珀，毛 → 藤黄，脸 → 缃），一眼看得出不是本体。 */
export const CLONE_COLORS: Record<string, string> = { B: 'b', b: 'y', t: 'Y', s: 'y' };
