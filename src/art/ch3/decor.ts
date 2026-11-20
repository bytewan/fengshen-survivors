// 第三章 · 界牌关的零碎道具与四把剑。朝右绘制，'.' 透明。
// 用户口径：剑、旗这些不能画得过大（2026-11-10）——台上的剑连剑柄 17 像素长、剑身两像素宽，比哪吒（16×24）小得多；
// 剑身暗金，偶尔一线寒光从剑身上走过（表现层换帧）。
import { compose, grid, outline, type Grid } from '../pixel.ts';
import { sketch } from '../sprites/foe-kit.ts';

// ---------------------------------------------------------------- 四剑

/** 剑的方向帧：剑尖朝 SWORD_DIRS 个方向各画一张（不旋转精灵，像素不走样）。画布 SWORD_S × SWORD_S，剑的中点在正中。 */
export const SWORD_DIRS = 16;
export const SWORD_S = 23;
/** 四把剑的剑穗颜色（西北绝仙、东北诛仙、东南戮仙、西南陷仙）：剑都是暗金的，剑穗分得清是哪一把。 */
const TASSEL = ['j', 'e', 'p', 'c'];
/** 剑身长（剑尖到护手）、柄长。 */
const BLADE = 11;
const HILT = 4;

/**
 * 一把剑：剑尖朝 a，剑的中点在画布正中。glint：寒光走到剑身的哪里（0 剑尖 … 1 护手，< 0 没有）；small：首领身后那四把（短一截）。
 * 剑身：中脊一道暗金、背光的一侧古金，剑尖一点琥珀（剑身是暗的金，不是亮黄）；护手暗金、剑柄古金，柄头垂一缕剑穗。
 */
function swordGrid(a: number, glint: number, tassel: string, small = false): Grid {
  const S = small ? 17 : SWORD_S;
  const s = sketch(S, S);
  const c = (S - 1) / 2;
  const blade = small ? 8 : BLADE;
  const hilt = small ? 3 : HILT;
  const total = blade + 1 + hilt;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  // 从剑尖量起：d = 0 剑尖，d = blade 护手
  const P = (d: number, o = 0): [number, number] => [c + ux * (total / 2 - d) + nx * o, c + uy * (total / 2 - d) + ny * o];
  for (let d = 0; d <= blade; d += 0.5) {
    const [x, y] = P(d);
    const g = glint >= 0 && Math.abs(d / blade - glint) < 0.09;
    s.set(x, y, g ? 'W' : d < 1.2 ? 'b' : 'U');
    if (d > 1.5 && !small) {
      const [x2, y2] = P(d, 1);
      s.set(x2, y2, g ? 'Z' : 'M', true);
    }
  }
  for (const o of small ? [-1.5, -0.5, 0.5, 1.5] : [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) {
    const [x, y] = P(blade + 0.8, o);
    s.set(x, y, Math.abs(o) > 2 ? 'M' : 'b', true);
  }
  for (let d = blade + 1.6; d <= blade + 1 + hilt; d += 0.5) {
    const [x, y] = P(d);
    s.set(x, y, 'M', true);
  }
  // 剑穗：柄头往下垂一缕（总是往下，不跟着剑转）
  const [tx, ty] = P(total + 0.3);
  s.set(tx, ty + 1, tassel, true);
  s.set(tx, ty + 2, tassel, true);
  if (!small) s.set(tx + (ux > 0 ? -1 : 1), ty + 3, tassel, true);
  return outline(s.grid(), 'K', { b: 'M', U: 'K', M: 'K', W: 'M', Z: 'M', j: 'i', e: 'r', p: 'P', c: 'n' });
}

/**
 * 四把剑的帧：SWORD_FRAMES[剑][方向] = [平时, 寒光走过的几帧…]。平时剑尖朝下悬在台上（方向 4 = 正下方），
 * 出鞘时剑尖转向剑气斩去的方向。
 */
export const SWORD_FRAMES: Grid[][][] = TASSEL.map((t) =>
  Array.from({ length: SWORD_DIRS }, (_, d) => {
    const a = (d / SWORD_DIRS) * Math.PI * 2;
    return [swordGrid(a, -1, t), ...[0.1, 0.3, 0.5, 0.7, 0.9].map((g) => swordGrid(a, g, t))];
  }),
);
/** 首领身后那四把（短一截，剑穗同台上的四把）：BOSS_SWORD_FRAMES[剑][方向]。 */
export const BOSS_SWORD_S = 17;
export const BOSS_SWORD_FRAMES: Grid[][] = TASSEL.map((t) => Array.from({ length: SWORD_DIRS }, (_, d) => swordGrid((d / SWORD_DIRS) * Math.PI * 2, -1, t, true)));
/** 剑尖朝 a（弧度）时用第几个方向。 */
export const swordDir = (a: number) => ((Math.round((a / (Math.PI * 2)) * SWORD_DIRS) % SWORD_DIRS) + SWORD_DIRS) % SWORD_DIRS;
/** 剑尖朝下（悬在台上）的那个方向。 */
export const SWORD_DOWN = SWORD_DIRS / 4;

// ---------------------------------------------------------------- 道具

const SELOUT: Record<string, string> = { U: 'M', M: 'K', y: 'M', T: 'V', Z: 'T', X: 'O', V: 'O', O: 'K', J: 'O' };
const lined = (rows: string[]) => {
  const g = grid(rows);
  return outline(compose(g.w + 2, g.h + 2, [{ g, x: 1, y: 1 }]), 'K', SELOUT);
};

/** 插在地上的残剑（两种，斜插）：剑身冷银、半截没进石缝里，剑柄暗金。剑冢的语汇，但很小。 */
export const STUBS: Grid[] = [
  lined(['M...', '.U..', '..T.', '..T.', '...T', '...Z', '..XO']),
  lined(['...M', '..U.', '.T..', '.T..', 'T...', 'Z...', 'OX..']),
];

/** 碎石：两种大小，青黑石、左上受月光。 */
export const STONES: Grid[] = [lined(['.TX.', 'TXXV', 'XVVO']), lined(['..TX...', '.TXXV..', 'TXXXVXV', 'XXVVXXO', '.VOOVO.'])];
