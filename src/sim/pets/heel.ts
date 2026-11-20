// 贴地跑的四只宠物（哮天犬、黑虎、避水兽、毫毛猴）共用的跟随与出手范围（用户 2026-11-12：「近战宠物都跟得太紧了，可以稍微远一点。
// 宠物优先自己去攻击攻击范围内的敌人，只要范围内有敌人就自己攻击，否则离主人一定距离就会回到主人身边。注意不要离主人太近，要有一定的距离」）。
// - 距离带：空闲时离主人脚下 near–far 像素（最近不小于 min）。主人走动时它在主人身后（走的方向的反方向）跟着，半径只在带外才往回拉：
//   进了 near 就往外让开，远过 rest 才追（跟着走时就落在 rest 上），方位绕着主人慢慢转到身后（绕过去，不从脚边穿过）；
//   主人站定时它在带里就地停下（各自的画面：嗅一嗅、踱两步、卧下、蹲着），出了带（被挤到 min 以内、落到 far 以外）才挪回去。
// - 出手范围：以宠物自己为圆心 range 像素内有敌人（而且那只离主人不超过 leash − 20，冲过去不会被拴绳拽回来）就出手，不再看主人身边。
// - 回来：没有出手的时候，离主人超过 back 就快跑回带里（Pet.mode 'return'），带外、back 以内的照常小跑回带里；拴绳 leash 照旧。
// 跟随时 Pet 字段的用法（follow / return 这两段里，sweep 用不到这几个值）：seekT 1 = 在追 / 在挪，0 = 在带里待着；
// (ox, oy) = 待着的地方相对主人的偏移（主人站着不动时就待在那儿）；side = 绕到身后时往哪边绕（1 / −1，0 = 还没定）；
// (mvx, mvy) = 主人移动速度的平滑值。
// 防抖（用户 11-12：「宠物很容易抽搐抖动」）：主人的移动方向按 MV_T 秒平滑了再用（机器人、手柄一帧一帧换方向时「身后」那一点不来回跳）；
// 「身后」正好在对面时（主人掉头）绕的方向定下来就不改，绕到差不多了才重新定（原来差一点点就换一边绕，宠物在主人两侧来回抽）。
import type { Pet, Player } from '../types.ts';

/** 跑法：最快多快、加减速、转向角速度上限、向心加速度上限（快的时候拐不了急弯，走的是弧线）。 */
export interface Gait {
  sMax: number;
  acc: number;
  dec: number;
  turn: number;
  aLat: number;
}

/** 一只宠物的距离带、出手范围、回归距离、拴绳（像素，量的都是脚下到主人脚下）。 */
export interface Heel {
  min: number; // 最近不小于这么近（进来了就让开）
  near: number; // 距离带的里沿
  rest: number; // 跟着走的时候、挪回带里的时候落在这么远
  far: number; // 距离带的外沿（主人站着时出了它才挪）
  down: number; // 身后偏下多少（弧度：主人站着、朝着一边时，「身后」略往下一点，站在主人脚边的地面上）
  back: number; // 回归距离：不出手的时候离主人超过它就快跑回来
  range: number; // 出手范围：以宠物自己为圆心
  leash: number; // 拴绳：离主人最远多远
}

const MV_T = 0.25; // 主人移动速度按这么多秒平滑
const OPPOSITE = 2.4; // 「身后」和现在的方位差过这么多（弧度，约 140°）就算在对面：绕的方向不再改
const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * 按「想要的速度」(wx, wy) 跑一帧：先把速度往想要的方向转（角速度、向心加速度都有上限，所以快的时候走弧线），
 * 要转的弯越大越想慢下来；跑得很慢时可以原地转身。
 */
export function run(pet: Pet, wx: number, wy: number, g: Gait, dt: number) {
  let s = Math.hypot(pet.vx, pet.vy);
  const ws = Math.min(g.sMax, Math.hypot(wx, wy));
  const hd = ws > 1e-6 ? Math.atan2(wy, wx) : Math.atan2(pet.vy, pet.vx);
  let h = s > 1e-6 ? Math.atan2(pet.vy, pet.vx) : hd;
  if (s < 12) h = hd; // 慢的时候原地转身
  const err = wrapAngle(hd - h);
  const wMax = Math.min(g.turn, g.aLat / Math.max(1, s));
  h += clamp(err, -wMax * dt, wMax * dt);
  const want = ws * Math.max(0, Math.cos(err));
  s = clamp(s + clamp(want - s, -g.dec * dt, g.acc * dt), 0, g.sMax);
  pet.vx = Math.cos(h) * s;
  pet.vy = Math.sin(h) * s;
  pet.x += pet.vx * dt;
  pet.y += pet.vy * dt;
}

/**
 * 跟随时的跑法（待着、挪）：速度平滑地往「想要的速度」靠（EASE_T 秒），不受转向 / 加减速上限的硬夹——
 * 原来跟随也用 run()：离目标只差几个像素时想要的方向一帧一变，速度在 0 和二三十之间一帧一跳（加速、刹车、原地转身轮着来），
 * 画面上就是宠物在主人身边一抽一抽。差不到 DEAD 像素就不再修正，只跟着主人走。
 */
export function ease(pet: Pet, wx: number, wy: number, sMax: number, dt: number) {
  const k = 1 - Math.exp(-dt / EASE_T);
  pet.vx += (wx - pet.vx) * k;
  pet.vy += (wy - pet.vy) * k;
  const s = Math.hypot(pet.vx, pet.vy);
  if (s > sMax) {
    pet.vx *= sMax / s;
    pet.vy *= sMax / s;
  }
  pet.x += pet.vx * dt;
  pet.y += pet.vy * dt;
}
const EASE_T = 0.18;
const DEAD = 3;
/** 离目标 (dx, dy) 的修正速度：差不到 DEAD 像素就不修正，差得多按 gain 修正（扣掉死区，过死区时不跳）。 */
const correct = (dx: number, dy: number, gain: number): [number, number] => {
  const d = Math.hypot(dx, dy);
  if (d <= DEAD) return [0, 0];
  const k = (gain * (d - DEAD)) / d;
  return [dx * k, dy * k];
};

/** 开局 / 瞬移之后摆在哪里：主人脚下 (x, y)、朝着 facing，摆在身后（朝向的反方向）rest 远、略往下 down。 */
export function heelSpot(x: number, y: number, facing: number, H: Heel) {
  return { x: x - facing * H.rest * Math.cos(H.down), y: y + H.rest * Math.sin(H.down) };
}

/** 瞬移之后（归队）：摆回主人身后、停住、在带里待着。 */
export function placeAtHeel(p: Player, H: Heel) {
  const pet = p.pet;
  const s = heelSpot(p.x, p.y, p.facing, H);
  pet.x = pet.px = s.x;
  pet.y = pet.py = s.y;
  pet.vx = pet.vy = 0;
  pet.mode = 'follow';
  pet.seekT = 0;
  pet.ox = s.x - p.x;
  pet.oy = s.y - p.y;
}

/** 主人「身后」的方位（弧度）：走着的时候是走的方向的反方向，站着的时候是朝向的反方向略往下。 */
function behind(p: Player, H: Heel, mvx: number, mvy: number) {
  const ms = Math.hypot(mvx, mvy);
  if (p.moving && ms > 5) return Math.atan2(-mvy, -mvx);
  return Math.atan2(Math.sin(H.down), -p.facing * Math.cos(H.down));
}

/** 能不能出手的那只：以宠物为圆心 range 内、离主人不超过 leash − 20 的敌人（调用方先 buildGrid）。 */
export const inReach = (pet: Pet, p: Player, H: Heel) => {
  const cap = (H.leash - 20) ** 2;
  return (e: { x: number; y: number }) => d2(e, pet) <= H.range * H.range && d2(e, p) <= cap;
};

/**
 * 不出手的时候（follow 跟着 / return 回来）推进一帧：按距离带跟着主人；pace 是主人站着、它在带里待着时的小动作（嗅一嗅、踱两步：
 * 相对待着那一点的偏移）。trot 是平时的跑法，back 是回来时的快跑。
 */
export function heelStep(p: Player, pet: Pet, H: Heel, trot: Gait, back: Gait, dt: number, pace: { x: number; y: number } = { x: 0, y: 0 }) {
  const k0 = 1 - Math.exp(-dt / MV_T);
  pet.mvx = (pet.mvx ?? 0) + ((p.x - p.px) / dt - (pet.mvx ?? 0)) * k0;
  pet.mvy = (pet.mvy ?? 0) + ((p.y - p.py) / dt - (pet.mvy ?? 0)) * k0;
  const mvx = pet.mvx;
  const mvy = pet.mvy;
  const ox = pet.x - p.x;
  const oy = pet.y - p.y;
  const d = Math.hypot(ox, oy);
  const still = !p.moving;
  const sp = Math.hypot(pet.vx, pet.vy);
  if (pet.mode === 'follow' && d > H.back) {
    // 落得太远（主人跑开了）：快跑回来
    pet.mode = 'return';
    pet.wrapT = 0;
  }
  if (pet.mode === 'return' && d <= H.far) {
    pet.mode = 'follow';
    pet.wrapT = 0;
    pet.seekT = 1;
  }
  if (pet.mode === 'follow') {
    if (pet.seekT <= 0 && (!still || d < H.min || d > H.far)) pet.seekT = 1; // 主人走了 / 被挤到太近 / 落出了带：挪
    else if (pet.seekT > 0 && still && d >= H.near && d <= H.far && sp < 40) {
      // 主人站着、自己在带里、也慢下来了：就地待着
      pet.seekT = 0;
      pet.ox = ox;
      pet.oy = oy;
    }
  }
  if (pet.mode === 'follow' && pet.seekT <= 0) {
    // 待着：朝待着的那一点（加上小动作）慢慢挪，近了就停住
    const [cx, cy] = correct(p.x + pet.ox + pace.x - pet.x, p.y + pet.oy + pace.y - pet.y, 5);
    ease(pet, cx, cy, trot.sMax, dt);
    return;
  }
  // 挪 / 追 / 回来：目标在主人周围一圈上——方位从现在的方位往「身后」转（每次最多转 0.7 弧度：绕着走，不从脚边穿过），
  // 半径：主人走着时 near–rest 之间半径只慢慢往 rest 靠（只绕到身后），进了 near 就让开到 rest、远过 rest 就追到 rest；站着时、回来的时候直接奔 rest
  const cur = d > 1 ? Math.atan2(oy, ox) : behind(p, H, mvx, mvy);
  let diff = wrapAngle(behind(p, H, mvx, mvy) - cur);
  // 绕的方向：差得不多（不到 OPPOSITE）就按近的那边绕、记下来；差不多正对面时照记下的那边绕（不在两边之间来回换）
  if (Math.abs(diff) < OPPOSITE || !pet.side) pet.side = diff >= 0 ? 1 : -1;
  else if (Math.sign(diff) !== pet.side) diff += pet.side * Math.PI * 2;
  const a = cur + clamp(diff, -0.7, 0.7);
  // （near–rest 之间也慢慢往 rest 靠：k × 0.2 ≈ 每秒补上差的一大半，不会来回抖）
  const r = pet.mode === 'follow' && !still && d >= H.near && d < H.rest ? d + (H.rest - d) * 0.2 : H.rest;
  const tx = p.x + Math.cos(a) * r;
  const ty = p.y + Math.sin(a) * r;
  if (pet.mode === 'return') {
    run(pet, (tx - pet.x) * 5 + mvx, (ty - pet.y) * 5 + mvy, back, dt); // 快跑回来：照旧走弧线
    return;
  }
  const [cx, cy] = correct(tx - pet.x, ty - pet.y, 6);
  ease(pet, cx + mvx, cy + mvy, trot.sMax, dt);
}

/**
 * 冲完一趟（掉头）：离主人超过回归距离就快跑回来（return），以内的照常小跑回带里（follow，在追）。
 * 刚掉头的那一小段（TURN 秒）先不出下一趟：冷却至少还剩这么多。
 */
export function endPass(p: Player, pet: Pet, H: Heel) {
  pet.mode = d2(pet, p) > H.back * H.back ? 'return' : 'follow';
  pet.wrapT = 0;
  pet.seekT = 1;
  pet.cd = Math.max(pet.cd, TURN);
}
const TURN = 0.3;

/**
 * 拴在主人身边：真出了 leash（主人跑得快、正好背着它跑）就贴在 leash 上、去掉往外的速度；远到离谱（瞬移、重开、归队）就直接摆回去。
 * 返回 'pull' = 贴在拴绳上了（调用方把还在冲的那一趟收掉），'place' = 摆回去了，'' = 没事。
 */
export function leash(p: Player, pet: Pet, H: Heel): '' | 'pull' | 'place' {
  const lx = pet.x - p.x;
  const ly = pet.y - p.y;
  const ld = Math.hypot(lx, ly);
  if (ld <= H.leash) return '';
  if (ld >= H.leash + 300) {
    placeAtHeel(p, H);
    return 'place';
  }
  const ux = lx / ld;
  const uy = ly / ld;
  pet.x = p.x + ux * H.leash;
  pet.y = p.y + uy * H.leash;
  const out = pet.vx * ux + pet.vy * uy;
  if (out > 0) {
    pet.vx -= out * ux;
    pet.vy -= out * uy;
  }
  return 'pull';
}

/** 冷却好了能不能出手（follow / return 里都行；刚掉头的那一小段 endPass 已经压在冷却里了）。 */
export const ready = (pet: Pet) => pet.cd <= 0 && (pet.mode === 'follow' || pet.mode === 'return');
