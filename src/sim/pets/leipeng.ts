// 专属宠物：雷震子 · 雷鹏（暂拟，待评审确认）。无敌、不造成伤害，只给敌人上减益「麻痹」（用户：宠物突出减益，不突出输出）。
// 打法照用户给混天绫的口径（「不应该一直盯着敌人，应该通过飘过攻击」「攻击距离不能太大」），飞法和青鸾分开：
// - follow 空闲：在主人身后高处（离地约 30 像素）慢慢盘着，翅膀张开，像鹰在半空悬停；
// - sweep 出手：冷却好了、主人身边 100 像素内有敌人时，先拔高（LEIPENG.rise 秒），再一道闪电似的俯冲 —— 贴地沿一条「之」字折线
//   （path：起点 → 半路往旁边错开的一处拐点 → 折回来穿过敌群中心 → 再往前冲一段）掠过敌群，离地低的那一段，正下方 hitR 内的敌人沾上「麻痹」
//   （每趟有上限，同一只一趟只麻一次）；
// - return 回旋：冲过去之后拉起来，回到主人身后高处。两趟之间约 2.6 秒。只挑主人身边 100 像素内的敌人，自己也不离主人超过 110 像素。
// 麻痹：沾上那一下一颤（定住 jolt 秒，打断长矛兵、骑兵的蓄力）；之后约 3 秒里每隔一会儿再一颤（twitch.t 秒，蓄力照样被打断），
// 出手慢 30%（冷却、收招按 0.7 倍的速度走）。首领不颤、不慢出手，只走得慢一点（它的招式节奏在 boss.ts 里，不动它）。
// 雷鹏是金行宠物（用户 11-12：宠物的五行按它自己的来历定，不一定和主人相生；金翅大鹏）：麻痹的敌人带上金行印记。
// 进化两条路：掣电（每趟多麻两只，沾上那一下麻得更久，之后颤得更勤）、霹雳（麻痹的敌人受到的木行伤害更高，每一颤把电传给身边一只没麻的）。
// 状态用的是和混天绫同一个 Pet（字段含义见 types.ts）：(x, y) 是雷鹏正下方的地面，z 是离地多高（画面按 y − z 画），俯冲那一趟的折线在 path。
// 不用随机数：挑哪一群、折线往哪边拐、每只多久颤一下都由位置和编号定。
import { HEROES } from '../catalog.ts';
import { REACH } from '../config.ts';
import { buildGrid, enemiesWithin, slowEnemy } from '../core.ts';
import type { Enemy, EnemyKindName, Pet, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

export const LEIPENG = {
  cd: 2.6, // 两趟俯冲的间隔（从上一趟出手算起；用户：出手不能太快）
  reach: REACH.seek - 30, // 100：只挑主人（脚下）身边这么远以内的敌人
  leash: REACH.seek - 20, // 110：自己（正下方的地面）离主人最远多远
  idle: { back: 18, up: 4, z: 36, rate: 0.8 }, // 空闲：停在主人身后 back、往上 up 的地面上方 z 高处，按 rate 慢慢盘（前后、高低各晃一点）
  rise: 0.28, // 俯冲之前先拔高多久
  top: 44, // 拔到多高
  low: 3, // 贴地掠过时离地多高
  hitZ: 12, // 离地低于这么多时才麻得到
  speed: 300, // 俯冲沿折线走多快（像素 / 秒）
  zig: 9, // 「之」字两处拐点往两边错开多少
  through: 34, // 穿过敌群中心以后再往前冲多远
  hitR: 14, // 正下方多大一片（吃「范围」，和法宝一样最多算到 +REACH.area）
  targets: [4, 5, 6, 7], // 每个阶段一趟最多麻几只
  numbT: [3, 3.3, 3.6, 3.9], // 麻痹多久（比两趟的间隔长：主人身边的敌人一直麻着）
  jolt: 0.3, // 沾上那一下：定住这么久（首领不吃）——打断蓄力
  twitch: { every: 0.85, spread: 0.3, t: 0.18 }, // 之后每隔 every ± spread / 2 秒一颤，一颤定住 t 秒
  atk: 0.3, // 出手慢 30%（冷却、收招按 1 − atk 的速度走）
  bossSlow: 0.2, // 首领：只走得慢一点
  flash: { extra: 2, jolt: 0.6, every: 0.7 }, // 掣电：每趟多麻两只；沾上那一下定住更久；颤的间隔 ×every
  clap: { wood: [0, 0.2, 0.26, 0.32], r: 34, dur: 0.6 }, // 霹雳：受到的木行伤害 +wood；每一颤把电传给身边 r 以内一只没麻的（麻 dur 倍那么久）
};
/** 挑哪一群时，这几种更危险的敌人优先（正在蓄力 / 预警的再优先：沾上那一下的一颤打断它）。和混天绫、青鸾一样。 */
const THREAT: Partial<Record<EnemyKindName, number>> = { spearman: 0.8, cavalry: 1.2, bomber: 1.2, caster: 1, elite: 0.8, windfiend: 0.6 };
/** 身上的麻痹剩下不到这么久，才算「没麻着」，优先挑。 */
const FRESH = 1;

const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
const numbLeft = (w: World, e: Enemy) => (e.numbUntil === undefined ? 0 : Math.max(0, e.numbUntil - w.time));
/** 麻痹着没有（首领也算：画面要画它身上的电）。 */
export const numbed = (w: World, e: Enemy) => e.numbUntil !== undefined && w.time < e.numbUntil;

/** 开局的雷鹏：在主人身后高处。 */
export function newLeipeng(x: number, y: number): Pet {
  const I = LEIPENG.idle;
  return { stage: 0, branch: null, mode: 'follow', x: x - I.back, y: y - I.up, px: x - I.back, py: y - I.up, vx: 0, vy: 0, cd: 1.5, tx: x, ty: y, ux: 1, uy: 0, ox: 0, oy: 0, target: -1, seekT: 0, wrapT: 0, hits: [], ph: 0, side: -1, z: I.z };
}

/** 瞬移之后（归队）：摆回主人身后高处。 */
export function placeLeipeng(p: Player) {
  const I = LEIPENG.idle;
  const pet = p.pet;
  pet.x = pet.px = p.x - p.facing * I.back;
  pet.y = pet.py = p.y - I.up;
  pet.vx = pet.vy = 0;
  pet.z = I.z;
  pet.mode = 'follow';
  delete pet.path;
  delete pet.pos;
}

/** 挑一群：主人身边 reach 内、还没麻着的敌人里，身边同伴最多、离主人又近、又是危险种类的那只；正在蓄力的最优先。 */
function pickTarget(w: World, p: Player): Enemy | null {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, LEIPENG.reach);
  if (!near.length) return null;
  const fresh = near.filter((e) => numbLeft(w, e) < FRESH);
  const pool = fresh.length ? fresh : near;
  let best = pool[0];
  let bs = -1e9;
  for (const e of pool) {
    let s = (1 - Math.sqrt(d2(e.x, e.y, p.x, p.y)) / LEIPENG.reach) * 1.6 + (THREAT[e.kind] ?? 0) + (e.act === 'windup' ? 2.5 : 0);
    for (const o of pool) if (d2(o.x, o.y, e.x, e.y) < 26 * 26) s += 1;
    if (s > bs || (s === bs && e.id < best.id)) {
      bs = s;
      best = e;
    }
  }
  return best;
}

/**
 * 俯冲的折线（地面坐标）：从脚下 (x0, y0) 先斜着扑到半路一处往旁边错开 zig 的拐点，再折回来正好穿过敌群中心 (cx, cy)，
 * 然后往前冲 through、末梢往另一边偏一点（先往哪边拐看 side）——一道闪电的样子，中间那一折一定穿过敌群。终点不离主人超过 leash。
 */
function boltPath(p: Player, x0: number, y0: number, cx: number, cy: number, side: number): number[] {
  const L = LEIPENG;
  let dx = cx - x0;
  let dy = cy - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) {
    dx = p.facing;
    dy = 0;
  } else {
    dx /= d;
    dy /= d;
  }
  const nx = -dy * side;
  const ny = dx * side;
  const ax = x0 + (cx - x0) * 0.5 + nx * L.zig;
  const ay = y0 + (cy - y0) * 0.5 + ny * L.zig;
  let ex = cx + dx * L.through - nx * L.zig * 0.5;
  let ey = cy + dy * L.through - ny * L.zig * 0.5;
  const ed = Math.hypot(ex - p.x, ey - p.y);
  if (ed > L.leash - 4) {
    ex = p.x + ((ex - p.x) * (L.leash - 4)) / ed;
    ey = p.y + ((ey - p.y) * (L.leash - 4)) / ed;
  }
  return [x0, y0, ax, ay, cx, cy, ex, ey];
}

/** 折线上走了 s 那么远的那一点（和折线的总长）。 */
function along(path: number[], s: number): { x: number; y: number; len: number } {
  let len = 0;
  for (let i = 0; i + 3 < path.length; i += 2) len += Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1]);
  let left = Math.max(0, Math.min(len, s));
  for (let i = 0; i + 3 < path.length; i += 2) {
    const sl = Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1]);
    if (left <= sl || i + 4 >= path.length - 1) {
      const k = sl > 1e-6 ? Math.min(1, left / sl) : 1;
      return { x: path[i] + (path[i + 2] - path[i]) * k, y: path[i + 1] + (path[i + 3] - path[i + 1]) * k, len };
    }
    left -= sl;
  }
  return { x: path[path.length - 2], y: path[path.length - 1], len };
}

/** 俯冲时离地多高：沿折线走到 u（0..1）时 —— 前四成从拔高的地方扑下来，中间一段贴地，最后一成多拉起来。 */
function stoopZ(u: number): number {
  const L = LEIPENG;
  if (u < 0.42) return L.low + (L.top - L.low) * Math.cos(((u / 0.42) * Math.PI) / 2);
  if (u < 0.86) return L.low;
  return L.low + (L.top * 0.6 - L.low) * Math.sin((((u - 0.86) / 0.14) * Math.PI) / 2);
}

/** 这一只多久颤一下（按编号错开，免得一群一起颤；掣电颤得更勤）。 */
function twitchEvery(e: Enemy, flash: boolean): number {
  const T = LEIPENG.twitch;
  const jitter = ((e.id * 0.6180339887) % 1) - 0.5;
  return (T.every + jitter * T.spread) * (flash ? LEIPENG.flash.every : 1);
}

/** 沾上麻痹：只上减益，不打伤害。首领只走得慢一点（身上照样带电，画面看得见）。 */
function numb(w: World, p: Player, pet: Pet, e: Enemy, dur: number, jolt = true) {
  const L = LEIPENG;
  const flash = pet.branch === 'flash' && pet.stage >= 1;
  const clap = pet.branch === 'clap' && pet.stage >= 1;
  // 宠物的五行印记：麻多久带多久（被相生消耗了就没了）；敌人身上已经有别的印记时不覆盖，免得冲掉玩家攒好的相生
  const el = HEROES[p.hero].petEl; // 宠物自己的五行（按宠物的来历定，用户 11-12）
  if (!e.mark || e.mark === el) {
    e.mark = el;
    e.markT = Math.max(e.markT, dur);
  }
  if (clap) {
    e.clap = Math.max(e.clap ?? 0, L.clap.wood[pet.stage]);
    e.clapUntil = Math.max(e.clapUntil ?? 0, w.time + dur);
  }
  const was = numbed(w, e);
  e.numbUntil = Math.max(e.numbUntil ?? 0, w.time + dur);
  if (e.kind === 'boss') {
    slowEnemy(w, e, p.id, L.bossSlow, dur);
    return;
  }
  e.numb = Math.max(e.numb ?? 0, L.atk);
  if (!was) e.twitchT = twitchEvery(e, flash); // 还麻着时又沾一次：只续时长，下一颤照原来的点（不往后推）
  if (jolt) e.stun = Math.max(e.stun, flash ? L.flash.jolt : L.jolt);
}

/** 正下方扫过的地方：离地够低时，hitR 内、在主人身边 reach 内、这一趟还没麻过的敌人沾上麻痹（每趟有上限）。 */
function sweepHits(w: World, p: Player, pet: Pet, ev: SimEvent[]) {
  const L = LEIPENG;
  const cap = L.targets[pet.stage] + (pet.branch === 'flash' ? L.flash.extra : 0);
  if (pet.hits.length >= cap) return;
  const r = L.hitR * (1 + Math.min(REACH.area, p.stats.area));
  buildGrid(w.enemies);
  const got = enemiesWithin(w, pet.x, pet.y, r)
    .filter((e) => !pet.hits.includes(e.id) && d2(e.x, e.y, p.x, p.y) <= L.reach * L.reach)
    .sort((a, b) => numbLeft(w, a) - numbLeft(w, b) || a.id - b.id)
    .slice(0, cap - pet.hits.length);
  if (!got.length) return;
  // 修为「御灵」：宠物的减益更久（xiuwei.ts）
  const dur = L.numbT[pet.stage] * (1 + p.stats.area * 0.5) * (1 + (p.boon?.petDur ?? 0));
  for (const e of got) {
    numb(w, p, pet, e, dur);
    pet.hits.push(e.id);
  }
  ev.push({ t: 'zap', owner: p.id, x: pet.x, y: pet.y, r, ids: got.map((e) => e.id), dur, branch: pet.branch });
}

/**
 * 麻着的敌人：出手变慢（冷却、收招按 1 − numb 的速度走——这一帧先把 numb × dt 加回去，敌人自己的循环再照常减 dt），
 * 每隔一会儿一颤（定住片刻，蓄力被打断）；霹雳：一颤把电传给身边一只没麻的。首领什么都不做（只吃减速）。同一只一帧只算一次。
 */
function numbTick(w: World, p: Player, pet: Pet, dt: number, ev: SimEvent[]) {
  const L = LEIPENG;
  const flash = pet.branch === 'flash' && pet.stage >= 1;
  const clap = pet.branch === 'clap' && pet.stage >= 1;
  let grid = false;
  for (const e of w.enemies) {
    if (e.numbUntil === undefined || w.time >= e.numbUntil || e.numbTick === w.tick || e.kind === 'boss' || e.hp <= 0) continue;
    e.numbTick = w.tick;
    const k = (e.numb ?? 0) * dt;
    if (e.cd > 0) e.cd += k;
    if (e.act === 'rest' && (e.actT ?? 0) > 0) e.actT = (e.actT ?? 0) + k;
    e.twitchT = (e.twitchT ?? 0) - dt;
    if (e.twitchT > 0) continue;
    e.twitchT += twitchEvery(e, flash);
    e.stun = Math.max(e.stun, L.twitch.t);
    let to: Enemy | undefined;
    if (clap && e.clapUntil !== undefined && w.time < e.clapUntil) {
      if (!grid) {
        buildGrid(w.enemies);
        grid = true;
      }
      to = enemiesWithin(w, e.x, e.y, L.clap.r)
        .filter((o) => o !== e && o.hp > 0 && numbLeft(w, o) <= 0)
        .sort((a, b) => d2(a.x, a.y, e.x, e.y) - d2(b.x, b.y, e.x, e.y) || a.id - b.id)[0];
      if (to) numb(w, p, pet, to, L.numbT[pet.stage] * L.clap.dur);
    }
    ev.push({ t: 'twitch', id: e.id, x: e.x, y: e.y, ...(to ? { to: to.id, tx: to.x, ty: to.y } : {}) });
  }
}

export function updateLeipeng(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const L = LEIPENG;
  const I = L.idle;
  const pet = p.pet;
  pet.px = pet.x;
  pet.py = pet.y;
  pet.cd -= dt;
  pet.wrapT += dt;
  pet.ph += I.rate * dt;
  numbTick(w, p, pet, dt, ev);
  // 空闲时停的那一点：主人身后（转身时慢慢换到另一侧）
  pet.side += Math.max(-2 * dt, Math.min(2 * dt, -p.facing - pet.side));
  const hx = p.x + pet.side * I.back + Math.sin(pet.ph) * 3;
  const hy = p.y - I.up + Math.sin(pet.ph * 2) * 1.5;
  const hz = I.z + Math.sin(pet.ph * 1.3) * 2;
  let z = pet.z ?? I.z;

  // 出手：冷却好了、身边有敌人（刚拉起来的那一小段先不出）
  if (pet.cd <= 0 && (pet.mode === 'follow' || (pet.mode === 'return' && pet.wrapT > 0.35))) {
    const t = pickTarget(w, p);
    if (t) {
      pet.mode = 'sweep';
      pet.wrapT = 0;
      pet.target = t.id;
      pet.tx = t.x;
      pet.ty = t.y;
      pet.hits = [];
      pet.cd = L.cd * (pet.stage >= 3 ? 0.85 : 1);
      delete pet.path;
      delete pet.pos;
    }
  }

  if (pet.mode === 'sweep' && !pet.path) {
    // 拔高：往身后、往上提一点，瞄着的那一群跟着走
    const t = pet.target >= 0 ? w.enemies.find((e) => e.id === pet.target && e.hp > 0) : undefined;
    if (t) {
      pet.tx = t.x;
      pet.ty = t.y;
    }
    const k = Math.min(1, pet.wrapT / L.rise);
    z += (L.top - z) * Math.min(1, dt * 9);
    const bx = pet.x - pet.tx;
    const by = pet.y - pet.ty;
    const bd = Math.hypot(bx, by) || 1;
    pet.vx = (bx / bd) * 22 * (1 - k);
    pet.vy = (by / bd) * 22 * (1 - k);
    pet.x += pet.vx * dt;
    pet.y += pet.vy * dt;
    if (pet.wrapT >= L.rise - 1e-9) {
      // 开始俯冲：从脚下朝那一群的中心（瞄的那只身边 26 像素内的平均位置）画一道之字折线
      buildGrid(w.enemies);
      const pool = t ? enemiesWithin(w, t.x, t.y, 26).filter((e) => d2(e.x, e.y, p.x, p.y) <= L.reach * L.reach) : [];
      const cx = pool.length ? pool.reduce((a, e) => a + e.x, 0) / pool.length : pet.tx;
      const cy = pool.length ? pool.reduce((a, e) => a + e.y, 0) / pool.length : pet.ty;
      const side = (pet.x - p.x) * (cy - pet.y) - (pet.y - p.y) * (cx - pet.x) >= 0 ? 1 : -1;
      pet.path = boltPath(p, pet.x, pet.y, cx, cy, side);
      pet.pos = 0;
      pet.wrapT = 0;
      ev.push({ t: 'stoop', owner: p.id, path: [...pet.path], branch: pet.branch });
    }
  } else if (pet.mode === 'sweep' && pet.path) {
    const path = pet.path;
    pet.pos = (pet.pos ?? 0) + L.speed * dt;
    const q = along(path, pet.pos);
    pet.vx = (q.x - pet.x) / dt;
    pet.vy = (q.y - pet.y) / dt;
    pet.x = q.x;
    pet.y = q.y;
    z = stoopZ(Math.min(1, pet.pos / Math.max(1, q.len)));
    if (z < L.hitZ) sweepHits(w, p, pet, ev);
    if (pet.pos >= q.len - 1e-6) {
      pet.mode = 'return';
      pet.wrapT = 0;
      delete pet.path;
      delete pet.pos;
    }
  } else {
    // 跟着 / 回旋：弹簧拉回主人身后高处（回旋的时候松一点，顺着冲出去的惯性兜回来）
    const ret = pet.mode === 'return';
    const wn = ret ? 5 : 6;
    const zeta = ret ? 0.8 : 1;
    const ax = wn * wn * (hx - pet.x) - 2 * zeta * wn * pet.vx;
    const ay = wn * wn * (hy - pet.y) - 2 * zeta * wn * pet.vy;
    pet.vx += ax * dt;
    pet.vy += ay * dt;
    pet.x += pet.vx * dt;
    pet.y += pet.vy * dt;
    z += (hz - z) * Math.min(1, dt * (ret ? 4 : 6));
    if (ret && (d2(pet.x, pet.y, hx, hy) < 10 * 10 || pet.wrapT > 1.2)) {
      pet.mode = 'follow';
      pet.wrapT = 0;
    }
  }
  pet.z = z;
  // 拴在主人身边：远得离谱（瞬移、归队）就直接摆回去；出了 leash 就贴在 leash 上
  const lx = pet.x - p.x;
  const ly = pet.y - p.y;
  const ld = Math.hypot(lx, ly);
  if (ld >= L.leash + 200) placeLeipeng(p);
  else if (ld > L.leash) {
    pet.x = p.x + (lx / ld) * L.leash;
    pet.y = p.y + (ly / ld) * L.leash;
  }
}
