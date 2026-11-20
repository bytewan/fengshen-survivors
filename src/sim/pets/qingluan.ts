// 专属宠物：云霄 · 青鸾（暂拟，待评审确认）。无敌、不造成伤害，只给敌人上减益「寒羽」（用户：宠物突出减益，不突出输出）。
// 打法照用户给混天绫的口径（「不应该一直盯着敌人，应该通过飘过攻击」「攻击距离不能太大」）：飞法和混天绫同一套——
// 有速度和朝向，转弯有上限，走平滑的弧线，从不悬停在敌人身上：
// - follow 空闲：在主人身后偏上（离主人上半身 24–32 像素）沿一个横着的「8」字慢慢盘旋；
// - sweep 掠过：冷却好了、主人身边 100 像素内有敌人时，挑一群，划一道弧线从侧面切进去、低飞掠过敌群，
//   身下洒落一片冰蓝的羽毛：离它正下方的地面 hitR 内的敌人沾上「寒羽」（每趟有上限，同一只一趟只沾一次）；
// - return 回旋：掠过之后顺着惯性兜一个弯回到主人身后。两趟之间约 2.8 秒。只挑主人身边 100 像素内的敌人，自己也不离主人超过 110 像素。
// 寒羽：移速 −40%、出手慢 40%（冷却、收招按 0.6 倍的速度走；首领只吃减速），约 3 秒；寒羽还在身上时再沾一次就冻住片刻（首领不冻）。
// 沾上那一下顿一顿（打断长矛兵、骑兵的蓄力；首领不吃）。青鸾是水行宠物（用户 11-12：宠物的五行按它自己的来历定，不一定和主人相生；青鸾栖于瑶池，羽带寒露）：沾羽的敌人带上水行印记。
// 进化两条路：冰魄（沾上就冻住片刻，每趟多洒两只）、沧溟（沾羽的敌人受到的水行伤害更高，寒羽更久、更慢）。
// 状态用的是和混天绫同一个 Pet（字段含义见 types.ts）；(x, y) 是青鸾自己（飞在半空：正下方的地面是 (x, y + QINGLUAN.hover)）。
import { HEROES } from '../catalog.ts';
import { REACH } from '../config.ts';
import { buildGrid, enemiesWithin, freezeEnemy, slowEnemy } from '../core.ts';
import type { Enemy, EnemyKindName, Pet, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

export const QINGLUAN = {
  cd: 2.8, // 两趟掠过的间隔（从上一趟出手算起；用户：出手不能太快）
  reach: REACH.seek - 30, // 100：只挑主人（脚下）身边这么远以内的敌人
  leash: REACH.seek - 20, // 110：自己（正下方的地面）离主人最远多远
  hover: 16, // 离地的高度：(x, y + hover) 是它正下方的地面（比混天绫高一点：是只鸟）
  hitR: 17, // 身下的羽毛落多大一片（吃「范围」，和法宝一样最多算到 +REACH.area）
  pass: 200, // 掠过敌群时的速度（像素 / 秒）
  lead: 8, // 瞄准点放在敌群中心往前（掠过的方向）多远
  through: 0.18, // 过了瞄准点之后再顺势滑多久，才开始兜回来
  // 空闲时盘旋的「8」字：以主人上半身为圆心、身后偏上的一段弧，角度来回摆 ±arc，半径在 r ± dr 之间按两倍频率进出
  idle: { r: 28, dr: 4, arc: 0.55, rate: 1.0, lift: 18 },
  targets: [4, 5, 6, 7], // 每个阶段一趟最多沾几只
  slow: 0.5, // 寒羽：移速 −50%（水行一件再 ×1.2，最多 85%；青鸾自己算一件水行，就是 −60%）
  atk: 0.4, // 寒羽：出手慢 40%（冷却、收招按 1 − atk 的速度走）
  chillT: [3, 3.3, 3.6, 3.9], // 寒羽多久（比两趟的间隔长：主人身边的敌人一直沾着）
  refreeze: 0.8, // 寒羽还在身上时又沾一次：冻住这么久（首领不冻；水行一件 ×1.2）
  jolt: 0.25, // 沾上那一下顿一顿：定身这么久（首领不吃）——打断蓄力
  rime: { extra: 2, freeze: [0, 0.8, 1, 1.2] }, // 冰魄：每趟多洒两只，沾上就冻住
  deep: { water: [0, 0.2, 0.26, 0.32], slow: 0.12, dur: 0.25 }, // 沧溟：受到的水行伤害 +water；寒羽再慢 12%、再久 25%
};
/** 挑哪一群时，这几种更危险的敌人优先（正在蓄力 / 预警的再优先：沾上那一下的定身打断它）。和混天绫一样。 */
const THREAT: Partial<Record<EnemyKindName, number>> = { spearman: 0.8, cavalry: 1.2, bomber: 1.2, caster: 1, elite: 0.8, windfiend: 0.6 };

/** 一种飞行状态下的速度与转弯上限：sMin 最慢（不会停）、sMax 最快、acc / dec 加减速、wCap 转向角速度上限、aLat 向心加速度上限。 */
interface Limits {
  sMin: number;
  sMax: number;
  acc: number;
  dec: number;
  wCap: number;
  aLat: number;
}
const FOLLOW: Limits = { sMin: 14, sMax: 170, acc: 300, dec: 300, wCap: 4.5, aLat: 480 };
const SWEEP: Limits = { sMin: 34, sMax: 222, acc: 720, dec: 420, wCap: 6.5, aLat: 1400 };
const RETURN: Limits = { sMin: 26, sMax: 222, acc: 240, dec: 600, wCap: 6, aLat: 1400 };
/** 期望速度的响应时间（秒）：越小越「跟手」。 */
const TAU = 0.13;
/** 敌人身上的寒羽剩下不到这么久，才算「没沾上」，优先挑。 */
const FRESH = 1;
/** 绕开主人身子的半径（以上半身为圆心）。 */
const BODY = 22;

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const chillLeft = (w: World, e: Enemy) => (e.chillUntil === undefined ? 0 : Math.max(0, e.chillUntil - w.time));

/** 开局的青鸾：在主人身后偏上，慢慢盘旋着。 */
export function newQingluan(x: number, y: number): Pet {
  return { stage: 0, branch: null, mode: 'follow', x: x - 22, y: y - 32, px: x - 22, py: y - 32, vx: 0, vy: -8, cd: 1.5, tx: x, ty: y, ux: 1, uy: 0, ox: 0, oy: 0, target: -1, seekT: 0, wrapT: 0, hits: [], ph: 0, side: -1 };
}

/** 瞬移之后（归队）：摆回主人身后偏上。 */
export function placeQingluan(p: Player) {
  const pet = p.pet;
  pet.x = pet.px = p.x - p.facing * 22;
  pet.y = pet.py = p.y - 32;
  pet.vx = 0;
  pet.vy = -8;
  pet.mode = 'follow';
}

/** 空闲时飞向的点：「8」字上相位 ph 处（主人在 (x, y)，side 是飞在主人哪一侧）。 */
function idlePoint(x: number, y: number, side: number, ph: number, out: { x: number; y: number }) {
  const I = QINGLUAN.idle;
  const over = 1 - side * side; // 转身时从头顶上绕过去
  const a = Math.atan2(-0.6 - 0.55 * over, side * 0.8) + I.arc * Math.sin(ph);
  const r = I.r + I.dr * Math.sin(2 * ph);
  out.x = x + Math.cos(a) * r;
  out.y = y - I.lift + Math.sin(a) * r * 0.8;
}

/**
 * 按「期望加速度」(ax, ay) 推进一帧：先把速度往期望的方向转（角速度、向心加速度都有上限），要掉头时先减速；
 * 速度始终在 [sMin, sMax] 里，所以走的是平滑的弧线、永远不会停（鸟在空中不悬停）。
 */
function fly(pet: Pet, ax: number, ay: number, L: Limits, dt: number) {
  let s = Math.hypot(pet.vx, pet.vy);
  let h = s > 1e-6 ? Math.atan2(pet.vy, pet.vx) : -Math.PI / 2;
  if (s < L.sMin) s = L.sMin;
  const wx = pet.vx + ax * TAU;
  const wy = pet.vy + ay * TAU;
  const ws = Math.hypot(wx, wy);
  const err = ws > 1e-6 ? wrapAngle(Math.atan2(wy, wx) - h) : 0;
  const wMax = Math.min(L.wCap, L.aLat / s);
  h += clamp(err / TAU, -wMax, wMax) * dt;
  const want = ws * (0.5 + 0.5 * Math.cos(err));
  s = clamp(s + clamp((want - s) / TAU, -L.dec, L.acc) * dt, L.sMin, L.sMax);
  pet.vx = Math.cos(h) * s;
  pet.vy = Math.sin(h) * s;
  pet.x += pet.vx * dt;
  pet.y += pet.vy * dt;
}

/** 挑一群：主人身边 reach 内、还没沾寒羽的敌人里，身边同伴最多、离主人又近、又是危险种类的那只；正在蓄力的最优先。 */
function pickTarget(w: World, p: Player): Enemy | null {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, QINGLUAN.reach);
  if (!near.length) return null;
  const fresh = near.filter((e) => chillLeft(w, e) < FRESH);
  const pool = fresh.length ? fresh : near;
  const sample = pool.length <= 16 ? pool : Array.from({ length: 16 }, () => pool[Math.floor(w.rng.next() * pool.length)]);
  let best = sample[0];
  let bs = -1e9;
  for (const e of sample) {
    let s = (1 - Math.sqrt(d2(e, p)) / QINGLUAN.reach) * 1.6 + (THREAT[e.kind] ?? 0) + (e.act === 'windup' ? 2.5 : 0);
    for (const o of pool) if (d2(o, e) < 26 * 26) s += 1;
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  return best;
}

/**
 * 规划一趟掠过：瞄准敌群的中心稍往前，掠过的方向和「主人 → 敌群」垂直（从侧面切进去），
 * 从青鸾现在所在的那一侧切入，每一趟都顺着原来的走势画一道弧，不来回折返。
 */
function plan(w: World, p: Player, pet: Pet): boolean {
  const Q = QINGLUAN;
  const t = pickTarget(w, p);
  if (!t) return false;
  const pool = enemiesWithin(w, t.x, t.y, 26).filter((e) => d2(e, p) <= Q.reach * Q.reach);
  let cx = 0;
  let cy = 0;
  for (const e of pool) {
    cx += e.x;
    cy += e.y;
  }
  cx = pool.length ? cx / pool.length : t.x;
  cy = pool.length ? cy / pool.length : t.y;
  let gx = cx - p.x;
  let gy = cy - p.y;
  const g = Math.hypot(gx, gy);
  if (g < 1e-3) {
    gx = p.facing;
    gy = 0;
  } else {
    gx /= g;
    gy /= g;
  }
  const nx = -gy;
  const ny = gx;
  const lat = (pet.x - p.x) * nx + (pet.y + Q.hover - p.y) * ny;
  const sgn = lat < -3 ? 1 : lat > 3 ? -1 : pet.vx * nx + pet.vy * ny >= 0 ? 1 : -1;
  pet.ux = nx * sgn;
  pet.uy = ny * sgn;
  pet.ox = cx - t.x + pet.ux * Q.lead;
  pet.oy = cy - t.y + pet.uy * Q.lead;
  pet.target = t.id;
  pet.tx = t.x + pet.ox;
  pet.ty = t.y + pet.oy - Q.hover;
  const dist = Math.hypot(pet.tx - pet.x, pet.ty - pet.y);
  const s = Math.hypot(pet.vx, pet.vy);
  pet.seekT = clamp((dist * 1.2) / ((s + Q.pass) / 2), 0.3, 0.8);
  pet.mode = 'sweep';
  pet.wrapT = 0;
  pet.hits = [];
  pet.cd = Q.cd * (pet.stage >= 3 ? 0.85 : 1);
  return true;
}

/** 沾上寒羽：只上减益，不打伤害。寒羽还在身上时又沾一次就冻住片刻（冰魄：沾上就冻住）。被冻住的记进 frozen。 */
function frost(w: World, p: Player, pet: Pet, e: Enemy, dur: number, frozen: number[], ev: SimEvent[]) {
  const Q = QINGLUAN;
  const again = chillLeft(w, e) > 0;
  const deep = pet.branch === 'deep' && pet.stage >= 1;
  slowEnemy(w, e, p.id, Q.slow + (deep ? Q.deep.slow : 0), dur);
  e.chill = Math.max(e.chill ?? 0, Q.atk);
  e.chillUntil = Math.max(e.chillUntil ?? 0, w.time + dur);
  if (deep) {
    e.deep = Math.max(e.deep ?? 0, Q.deep.water[pet.stage]);
    e.deepUntil = Math.max(e.deepUntil ?? 0, w.time + dur);
  }
  // 宠物的五行印记：寒羽多久带多久（被相生消耗了就没了）；敌人身上已经有别的印记时不覆盖，免得冲掉玩家攒好的相生
  const el = HEROES[p.hero].petEl; // 宠物自己的五行（按宠物的来历定，用户 11-12）
  if (!e.mark || e.mark === el) {
    e.mark = el;
    e.markT = Math.max(e.markT, dur);
  }
  if (e.kind !== 'boss') e.stun = Math.max(e.stun, Q.jolt);
  const f = pet.branch === 'rime' && pet.stage >= 1 ? Q.rime.freeze[pet.stage] : again ? Q.refreeze : 0;
  if (f > 0 && freezeEnemy(w, e, p.id, f, ev)) frozen.push(e.id);
}

/** 身下扫过的地方：离它正下方的地面 hitR 内、在主人身边 reach 内、这一趟还没沾过的敌人，沾上寒羽（每趟有上限）。 */
function sweepHits(w: World, p: Player, pet: Pet, ev: SimEvent[]) {
  const Q = QINGLUAN;
  const cap = Q.targets[pet.stage] + (pet.branch === 'rime' ? Q.rime.extra : 0);
  if (pet.hits.length >= cap) return;
  const gx = pet.x;
  const gy = pet.y + Q.hover;
  const r = Q.hitR * (1 + Math.min(REACH.area, p.stats.area));
  buildGrid(w.enemies);
  const got = enemiesWithin(w, gx, gy, r)
    .filter((e) => !pet.hits.includes(e.id) && d2(e, p) <= Q.reach * Q.reach)
    .sort((a, b) => chillLeft(w, a) - chillLeft(w, b) || a.id - b.id)
    .slice(0, cap - pet.hits.length);
  if (!got.length) return;
  // 修为「御灵」：宠物的减益更久（xiuwei.ts）；沧溟：寒羽再久一些
  const deep = pet.branch === 'deep' && pet.stage >= 1;
  const dur = Q.chillT[pet.stage] * (1 + p.stats.area * 0.5) * (1 + (p.boon?.petDur ?? 0)) * (deep ? 1 + Q.deep.dur : 1);
  const frozen: number[] = [];
  for (const e of got) {
    frost(w, p, pet, e, dur, frozen, ev);
    pet.hits.push(e.id);
  }
  ev.push({ t: 'feather', owner: p.id, x: gx, y: gy, r, ids: got.map((e) => e.id), frozen, dur, branch: pet.branch });
}

/**
 * 寒羽让敌人出手变慢：冷却（e.cd）、收招（rest）按 1 − chill 的速度走——这一帧先把 chill × dt 加回去，
 * 敌人自己的循环（world.step）再照常减 dt。首领只吃减速（它的招式节奏在 boss.ts 里，不动它）。同一只一帧只算一次。
 */
function chillCooldowns(w: World, dt: number) {
  for (const e of w.enemies) {
    if (e.chillUntil === undefined || w.time >= e.chillUntil || e.chillTick === w.tick || e.kind === 'boss' || e.hp <= 0) continue;
    e.chillTick = w.tick;
    const k = (e.chill ?? 0) * dt;
    if (e.cd > 0) e.cd += k;
    if (e.act === 'rest' && (e.actT ?? 0) > 0) e.actT = (e.actT ?? 0) + k;
  }
}

const cNow = { x: 0, y: 0 };
const cWas = { x: 0, y: 0 };

export function updateQingluan(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const Q = QINGLUAN;
  const pet = p.pet;
  pet.px = pet.x;
  pet.py = pet.y;
  pet.cd -= dt;
  pet.wrapT += dt;
  chillCooldowns(w, dt);
  // 空闲时飞向的点（跟着主人走；转身时从身后这一侧绕过头顶换到另一侧）和它的速度（前馈）
  const side0 = pet.side;
  const ph0 = pet.ph;
  pet.side += clamp(-p.facing - pet.side, -1.6 * dt, 1.6 * dt);
  pet.ph += Q.idle.rate * dt;
  idlePoint(p.px, p.py, side0, ph0, cWas);
  idlePoint(p.x, p.y, pet.side, pet.ph, cNow);
  const cvx = (cNow.x - cWas.x) / dt;
  const cvy = (cNow.y - cWas.y) / dt;

  // 出手：冷却好了、身边有敌人（刚兜回来的那一小段先不出，免得把惯性的弯折断）
  if (pet.cd <= 0 && (pet.mode === 'follow' || (pet.mode === 'return' && pet.wrapT > 0.5))) plan(w, p, pet);

  let ax = 0;
  let ay = 0;
  let lim = FOLLOW;
  if (pet.mode === 'sweep') {
    lim = SWEEP;
    const t = pet.target >= 0 ? w.enemies.find((e) => e.id === pet.target && e.hp > 0) : undefined;
    if (t) {
      pet.tx = t.x + pet.ox;
      pet.ty = t.y + pet.oy - Q.hover;
    } else pet.target = -1;
    const rx = pet.tx - pet.x;
    const ry = pet.ty - pet.y;
    if (pet.seekT > 0) {
      const passed = rx * pet.ux + ry * pet.uy < 0 || rx * rx + ry * ry < 36;
      const gone = pet.wrapT > 2 || d2({ x: pet.tx, y: pet.ty + Q.hover }, p) > (Q.reach + 30) ** 2;
      if (passed || gone) pet.seekT = 0;
      else pet.seekT = Math.max(0.05, pet.seekT - dt);
    }
    if (pet.seekT > 0) {
      if (pet.seekT > 0.06) {
        // 三次曲线制导：按剩下的时间算出「现在该怎么加速」，到瞄准点时正好以 pass 的速度沿 u 方向掠过
        const T = pet.seekT;
        ax = (6 * rx) / (T * T) - (4 * pet.vx + 2 * pet.ux * Q.pass) / T;
        ay = (6 * ry) / (T * T) - (4 * pet.vy + 2 * pet.uy * Q.pass) / T;
      } else {
        const d = Math.hypot(rx, ry) || 1;
        ax = ((rx / d) * Q.pass - pet.vx) / TAU;
        ay = ((ry / d) * Q.pass - pet.vy) / TAU;
      }
      const m = Math.hypot(ax, ay);
      if (m > 2400) {
        ax *= 2400 / m;
        ay *= 2400 / m;
      }
    } else {
      // 掠过去了：顺势再滑一小段，然后兜回来（快到拴绳的长度、还在往外飞时直接兜回来）
      pet.seekT -= dt;
      const s = Math.hypot(pet.vx, pet.vy) || 1;
      ax = (pet.vx / s) * 340;
      ay = (pet.vy / s) * 340;
      const ox = pet.x - p.x;
      const oy = pet.y + Q.hover - p.y;
      const edge = Math.hypot(ox, oy) > Q.leash - 24 && ox * pet.vx + oy * pet.vy > 0;
      if (pet.seekT < -Q.through || edge) {
        pet.mode = 'return';
        pet.wrapT = 0;
      }
    }
  }
  if (pet.mode === 'return' || pet.mode === 'follow') {
    const ret = pet.mode === 'return';
    lim = ret ? RETURN : FOLLOW;
    const wn = ret ? 3.1 : 4;
    const zeta = ret ? 0.85 : 1;
    ax = wn * wn * (cNow.x - pet.x) + 2 * zeta * wn * (cvx - pet.vx);
    ay = wn * wn * (cNow.y - pet.y) + 2 * zeta * wn * (cvy - pet.vy);
    if (ret && ((d2(cNow, pet) < 12 * 12 && Math.hypot(pet.vx, pet.vy) < 70) || pet.wrapT > 1.4)) {
      pet.mode = 'follow';
      pet.wrapT = 0;
    }
  }
  // 绕开主人的身子：从头顶、身旁绕过去，不从人物身上穿过
  const bx = pet.x - p.x;
  const by = pet.y - (p.y - 13);
  const bd = Math.hypot(bx, by);
  if (bd < BODY && bd > 1e-3) {
    const k = (BODY - bd) * 140;
    ax += (bx / bd) * k;
    ay += (by / bd) * k;
  }
  // 拴在主人身边：快到 leash 时往回拉
  let lx = pet.x - p.x;
  let ly = pet.y + Q.hover - p.y;
  let ld = Math.hypot(lx, ly);
  const soft = Q.leash - 20;
  if (ld > soft && ld < Q.leash + 200) {
    const k = (ld - soft) * 140;
    ax -= (lx / ld) * k;
    ay -= (ly / ld) * k;
  }
  fly(pet, ax, ay, lim, dt);
  // 兜底：真的出了 leash（主人跑得快、正好背着它跑），就贴在 leash 上，去掉往外的速度；远得离谱（瞬移）就直接摆回去
  lx = pet.x - p.x;
  ly = pet.y + Q.hover - p.y;
  ld = Math.hypot(lx, ly);
  if (ld > Q.leash && ld < Q.leash + 200) {
    const ux = lx / ld;
    const uy = ly / ld;
    pet.x = p.x + ux * Q.leash;
    pet.y = p.y + uy * Q.leash - Q.hover;
    const out = pet.vx * ux + pet.vy * uy;
    if (out > 0) {
      pet.vx -= out * ux;
      pet.vy -= out * uy;
    }
  } else if (ld >= Q.leash + 200) placeQingluan(p);
  // 掠过（和刚掠过去、还在高速兜弯的那一段）时身下的羽毛沾到的敌人
  if (pet.mode !== 'follow' && Math.hypot(pet.vx, pet.vy) >= 110) sweepHits(w, p, pet, ev);
}
