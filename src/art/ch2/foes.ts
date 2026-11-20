// 第二章的三种新敌人：落魂幡手、红沙傀儡、风吼妖。朝右绘制，'.' 透明，描边用 outline（同色系描边见各自的 SELOUT）。
// 和第一章的敌人一个语汇：回响的残魂（骷髅脸、天青的眼光、脚下一缕魂雾），配色往第二章的赭黄、暗红、灰紫靠。
// 用户口径：尺寸收着（哪吒约 16×24）——幡手连幡 30 像素高，幡面只有 4 像素宽；傀儡是「大个子」也只比哪吒宽半个身子。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { sketch } from '../sprites/foe-kit.ts';

// ---------------------------------------------------------------- 落魂幡手

/** 画布 20×31，脚底锚点 (8, 30)。帧：行走 4（幡面随步子摆）。幡头（魂光的出处）在朝右时相对脚底 (BANNER_TIP.x, BANNER_TIP.y)。 */
export const BANNERMAN_W = 20;
export const BANNERMAN_H = 31;
export const BANNERMAN_ANCHOR = { x: 8, y: 30 };
export const BANNER_TIP = { x: 6, y: -29 };

const BAN_SEL: Record<string, string> = { P: 'k', p: 'P', g: 'k', h: 'g', i: 'h', j: 'h', w: 'h', B: 'D', b: 'B', C: 'c', c: 'N' };

// 兜帽长袍的残魂：灰紫的兜帽、月白的面具（天青眼），胭脂紫的长袍、缟色的腰带，袍角散成魂雾
const BAN_BODY = grid([
  '...gggg..',
  '..gPPPPg.',
  '.gPdddPPg',
  '.gPwCwkPg',
  '.gPwwwdPg',
  '..gPddPg.',
  '.gpPPPPpg',
  'gpPPpPPPpg',
  'gPPpjjjPPg',
  'gPPPpPPPPg',
  '.gPPpPPPg.',
  '.gPPpPPPg.',
  '.gPpPPpPg.',
  '.gPPPPPPg.',
  '..gPPpPg..',
  '..gPg.gPg.',
]);

/** 幡：赭色木杆、顶上一道横杆，横杆下垂一条窄窄的幡面（褪色的胭脂紫，缟色符文），杆头一点天青魂火。sway：幡面摆动 -1..1。 */
function banner(sway: number): Grid {
  const s = sketch(BANNERMAN_W, BANNERMAN_H);
  const px = 14; // 杆子的 x
  s.line(px, 3, px, 29, (i) => (i % 5 === 2 ? 'b' : 'B'));
  s.line(px - 2, 3, px + 3, 3, 'B');
  s.set(px, 1, 'C');
  s.set(px, 2, 'c');
  s.set(px + 1, 1, 'c');
  // 幡面：横杆下 4 像素宽、9 像素长，越往下越往后飘（sway）
  for (let y = 0; y < 9; y++) {
    const off = Math.round(sway * (y / 8) * 1.5);
    for (let x = 0; x < 4; x++) {
      const tattered = y === 8 && x % 2 === 1;
      if (tattered) continue;
      const glyph = (x === 1 || x === 2) && (y === 2 || y === 3 || y === 5 || y === 6) && !(x === 2 && y === 3);
      s.set(px + 0 + x + off - (x === 0 ? 0 : 0), 4 + y, glyph ? 'j' : x === 3 ? 'P' : 'p');
    }
  }
  return s.grid();
}

const BAN_LEGS = [grid(['.g..g.']), grid(['.g...g']), grid(['.g..g.']), grid(['g...g.'])];
const BAN_MIST = [
  grid(['.c.C..c.', 'C...c...']),
  grid(['c..c.C..', '..C...c.']),
  grid(['.Cc...c.', 'c...c..C']),
  grid(['c.C..c..', '.c..C...']),
];

function bannermanFrame(i: number): Grid {
  const bob = i % 2;
  const sway = [0, 1, 0, -1][i];
  const layers: Layer[] = [
    { g: BAN_LEGS[i], x: 2, y: 29 },
    { g: BAN_BODY, x: 1, y: 13 + bob },
    { g: banner(sway), x: 0, y: bob },
    { g: grid(['jj']), x: 12, y: 21 + bob }, // 握杆的骨手
  ];
  const base = outline(compose(BANNERMAN_W, BANNERMAN_H, layers), 'k', BAN_SEL);
  return compose(BANNERMAN_W, BANNERMAN_H, [
    { g: base, x: 0, y: 0 },
    { g: BAN_MIST[i], x: 1, y: 28 },
  ]);
}

export const BANNERMAN_FRAMES = { walk: [0, 1, 2, 3].map(bannermanFrame) };

// ---------------------------------------------------------------- 红沙傀儡

/** 画布 22×26，脚底锚点 (10, 25)。帧：行走 4（步子沉：一步一顿，肩头往下一沉，沙粒往下漏）。 */
export const GOLEM_W = 22;
export const GOLEM_H = 26;
export const GOLEM_ANCHOR = { x: 10, y: 25 };

const GOL_SEL: Record<string, string> = { b: 'B', r: 'R', R: 'k', B: 'k', o: 'R', F: 'B', Y: 'B', D: 'k', A: 'D', a: 'A', y: 'B' };

// 夯实的红沙垒成的人形：小脑袋（两点暗橘的眼、额上一道黄符）、宽肩厚背、胸口几道暗缝；受光的顶面是琥珀色的沙
const GOL_HEAD = grid(['.bbbb.', 'brFyrb', 'rorrorR', 'rrRRrR', '.RRRR.']);
const GOL_TORSO = grid([
  '..bbbbbbbbbb..',
  '.brrrrrrrrrrb.',
  'brrrrRrrrrrrrB',
  'brrRrrrrrRrrRB',
  'brrrrrrRrrrrRB',
  'BrrrrrRrrrrrRB',
  '.BrrRrrrrrrRB.',
  '.BrrrrrrRrrRB.',
  '..BRrrrrrrRB..',
  '..BRRRRRRRRB..',
]);
// 胳膊：粗、垂到腰下，拳头大（两帧：前后摆一点）
const GOL_ARM = [grid(['bb.', 'brr', 'rrR', 'rrR', 'rRR', 'rRR', 'rrR', 'bRRB', 'BBB.']), grid(['.bb', 'brr', 'rrR', 'rRR', 'rRR', 'rrR', 'bRR', 'BRRB', '.BBB'])];
const GOL_LEGS = [grid(['BrrB..BrrB', 'BRRB..BRRB', 'DDDD..DDDD']), grid(['BrrB...BrrB', 'BRRB...BRRB', 'DDDD...DDDD']), grid(['BrrB..BrrB', 'BRRB..BRRB', 'DDDD..DDDD']), grid(['.BrrB..BrrB', '.BRRB..BRRB', '.DDDD..DDDD'])];

function golemFrame(i: number): Grid {
  const sink = i % 2; // 一步一沉
  const arm = i % 2;
  const layers: Layer[] = [
    { g: GOL_LEGS[i], x: 6, y: 22 },
    { g: GOL_ARM[arm], x: 1, y: 9 + sink },
    { g: GOL_ARM[1 - arm], x: 18, y: 9 + sink },
    { g: GOL_TORSO, x: 4, y: 9 + sink },
    { g: GOL_HEAD, x: 8, y: 4 + sink },
  ];
  const g = outline(compose(GOLEM_W, GOLEM_H, layers), 'k', GOL_SEL);
  return compose(GOLEM_W, GOLEM_H, [
    { g, x: 0, y: 0 },
    // 沙粒：从缝里往下漏（每帧换个位置）
    { g: grid([i % 2 ? 'b' : '.', '.', i % 2 ? '.' : 'a']), x: 6 + i * 3, y: 19 + sink },
  ]);
}

export const GOLEM_FRAMES = { walk: [0, 1, 2, 3].map(golemFrame) };

// ---------------------------------------------------------------- 风吼妖

/** 画布 22×16，锚点 (9, 15)（影子的位置；身子飘在上面）。帧：飞 4（尾巴卷动）、蓄力 2（缩成一团、鬃毛炸开）、冲刺 2（拉长成一道）。 */
export const WIND_W = 22;
export const WIND_H = 16;
export const WIND_ANCHOR = { x: 9, y: 15 };

const WIND_SEL: Record<string, string> = { w: 'h', j: 'h', i: 'g', h: 'g', C: 'c', p: 'P', m: 'p' };

/**
 * 一帧风吼妖：兽面（银鼠色的额角、天青的眼、张开的嘴）+ 往后卷的身子（缟、月白的风缕），尾巴卷成一个小涡。
 * curl 0..1：尾巴卷动的相位；mode：fly 平飞 / windup 缩成一团 / dash 拉成一道。
 */
function windFrame(curl: number, mode: 'fly' | 'windup' | 'dash'): Grid {
  const s = sketch(WIND_W, WIND_H);
  const hx = mode === 'dash' ? 17 : mode === 'windup' ? 13 : 15; // 头的位置
  const hy = mode === 'windup' ? 6 : 5;
  // 身子：从头往后一条渐细的风缕，上下起伏；冲刺时拉直拉长
  const len = mode === 'dash' ? 16 : mode === 'windup' ? 7 : 11;
  for (let k = 0; k <= len; k++) {
    const u = k / len;
    const x = hx - 2 - k;
    const amp = mode === 'dash' ? 0.5 : 1.6;
    const y = hy + 2 + Math.sin(u * 4 + curl * Math.PI * 2) * amp * u + (mode === 'windup' ? -u * 2 : 0);
    const th = Math.max(0, Math.round((1 - u) * 2.2));
    for (let t = -th; t <= th; t++) s.set(x, y + t, t === -th ? 'w' : t === th ? 'h' : 'j');
  }
  // 尾巴的小涡（冲刺时没有，拉成直线）
  if (mode !== 'dash') {
    const tx = hx - 2 - len;
    const ty = hy + 2;
    const a0 = curl * Math.PI * 2;
    for (let k = 0; k < 7; k++) {
      const a = a0 + k * 0.9;
      const r = 2.6 - k * 0.3;
      s.set(tx + Math.cos(a) * r, ty + Math.sin(a) * r * 0.8, k < 3 ? 'j' : 'i');
    }
  }
  // 兽面：额角、鬃毛（蓄力时炸开）、天青眼、张开的嘴
  s.stamp(
    grid(mode === 'windup' ? ['h..h...', '.hihh..', 'hiiiiwh', 'iiCkiiw', 'hikwkwh', '.hkkkh.'] : ['.h.....', '..hih..', '.hiiiwh', 'hiCkiiw', 'hikwkwh', '.hhkh..']),
    hx - 3,
    hy - 3,
  );
  // 冲刺：身后几道风线
  if (mode === 'dash') for (const [y, l] of [[hy, 5], [hy + 4, 4], [hy + 6, 3]] as [number, number][]) s.line(hx - 4 - l - 8, y, hx - 12, y, 'w', true);
  return outline(s.grid(), 'k', WIND_SEL);
}

export const WIND_FRAMES = {
  fly: [0, 0.25, 0.5, 0.75].map((c) => windFrame(c, 'fly')),
  windup: [0, 0.5].map((c) => windFrame(c, 'windup')),
  dash: [0, 0.5].map((c) => windFrame(c, 'dash')),
};
