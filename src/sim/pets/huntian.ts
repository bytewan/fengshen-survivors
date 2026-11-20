// 专属宠物：哪吒 · 混天绫。无敌、不造成伤害，只给敌人上减益（用户：宠物突出减益，不突出输出）。
// （原来的 sim/pet.ts 原样搬到这里；按宠物种类分派的入口还是 sim/pet.ts。）
// 行为（用户 2026-11-10：「不应该一直盯着敌人，应该通过飘过攻击，而不是固定住」「攻击距离不能太大」「不够飘逸」）：
// 混天绫一直在动，像风里的绸带、游动的鱼——有速度和朝向，转弯有上限，走平滑的弧线，从不悬停在某个敌人身上。
// - follow 空闲：在主人身后稍远处（离主人上半身 26–34 像素）沿一个横着的「8」字慢慢飘，速度慢但不停；
// - sweep 掠过：冷却好了、主人身边 100 像素内有敌人时，挑一群，规划一道弧线从侧面切进去、加速穿过敌群
//   （瞄准点放在敌群中心稍往前），沿途离绸带头 16 像素内的敌人被缠住（每趟最多缠几只，同一只一趟只缠一次）；
// - return 回旋：穿过之后顺着惯性兜一个弯回到主人身后，减速，接着飘。两趟之间约 2.7 秒，主人身边一直有敌人就一趟一趟地掠。
// 只挑主人身边 100 像素内的敌人，自己也不离主人超过 110 像素。
// 缠住的敌人减速、易伤，身上一直绑着红绫直到效果结束（表现层读 Enemy.wrapT 画）。
// 混天绫是水行宠物（用户 11-12：宠物的五行按它自己的来历定，不一定和主人相生；九湾河里一搅，东海龙宫都晃）：缠住的敌人带上水行印记。
// 宠物不碰敌人的弹道。
import { HEROES } from '../catalog.ts';
import { REACH } from '../config.ts';
import { buildGrid, elementCounts, enemiesWithin } from '../core.ts';
import type { Enemy, EnemyKindName, Pet, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

export const PET = {
  cd: 2.7, // 两趟掠过的间隔（从上一趟出手算起；用户：出手不能太快）
  // 距离和法宝的射程（config.REACH）一个口径，只是更近：宠物守在人物身边（用户：攻击距离不能太大）
  reach: REACH.seek - 30, // 100：只挑主人（脚下）身边这么远以内的敌人
  leash: REACH.seek - 20, // 110：自己（绸带头正下方的地面）离主人最远多远
  hover: 10, // 绸带头离地的高度：(x, y + hover) 是它正下方的地面
  hitR: 16, // 绸带头扫过多近的敌人会被缠住（吃「范围」，和法宝一样最多算到 +REACH.area）
  pass: 205, // 穿过敌群时的速度（像素 / 秒）
  lead: 8, // 瞄准点放在敌群中心往前（穿过的方向）多远
  through: 0.16, // 过了瞄准点之后再顺势冲多久，才开始兜回来
  // 空闲时飘的「8」字：以主人上半身为圆心、身后偏上的一段弧，角度来回摆 ±arc，半径在 r ± dr 之间按两倍频率进出
  idle: { r: 30, dr: 4.5, arc: 0.5, rate: 1.15, lift: 14 },
  targets: [4, 5, 6, 8], // 每个阶段一趟最多缠几只
  slow: 0.78, // 用户：减速效果要明显；被缠住的敌人明显走不动（水行一件再 ×1.15，最多 85%）
  jolt: 0.4, // 缠上那一下勒住：定身这么久（首领不吃）——打断长矛兵、骑兵的蓄力，勒住时也撞不了人
  vuln: [0.3, 0.35, 0.4, 0.45], // 「破绽」：受到的伤害加成
  wrapTime: [3.5, 3.9, 4.3, 4.7], // 缠住多久（比两趟的间隔长，主人身边的敌人一直绑着）
};
/** 挑哪一群时，这几种更危险的敌人优先（正在蓄力 / 预警的再优先：缠上那一下就打断它）。 */
const THREAT: Partial<Record<EnemyKindName, number>> = { spearman: 0.8, cavalry: 1.2, bomber: 1.2, caster: 1, elite: 0.8 };

/** 一种飞行状态下的速度与转弯上限：sMin 最慢（不会停）、sMax 最快、acc / dec 加减速、wCap 转向角速度上限、aLat 向心加速度上限。 */
interface Limits {
  sMin: number;
  sMax: number;
  acc: number;
  dec: number;
  wCap: number;
  aLat: number;
}
const FOLLOW: Limits = { sMin: 12, sMax: 175, acc: 320, dec: 320, wCap: 5, aLat: 520 };
const SWEEP: Limits = { sMin: 30, sMax: 228, acc: 760, dec: 420, wCap: 7, aLat: 1500 };
const RETURN: Limits = { sMin: 22, sMax: 228, acc: 260, dec: 640, wCap: 6.5, aLat: 1500 };
/** 期望速度的响应时间（秒）：越小越「跟手」。 */
const TAU = 0.12;
/** 敌人身上的缠绕剩下不到这么久，才算「没被缠住」，优先挑。 */
const FRESH = 1;
/** 绕开主人身子的半径（以上半身为圆心）。 */
const BODY = 22;

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 开局的混天绫：在主人身后偏上，朝后慢慢飘着。 */
export function newPet(x: number, y: number): Pet {
  return {
    stage: 0,
    branch: null,
    mode: 'follow',
    x: x - 24,
    y: y - 28,
    px: x - 24,
    py: y - 28,
    vx: 0,
    vy: -PET.idle.rate * 8,
    cd: 1.5,
    tx: x,
    ty: y,
    ux: 1,
    uy: 0,
    ox: 0,
    oy: 0,
    target: -1,
    seekT: 0,
    wrapT: 0,
    hits: [],
    ph: 0,
    side: -1,
  };
}

/** 空闲时飘向的点：「8」字上相位 ph 处（主人在 (x, y)，side 是飘在主人哪一侧）。 */
function idlePoint(x: number, y: number, side: number, ph: number, out: { x: number; y: number }) {
  const I = PET.idle;
  const over = 1 - side * side; // 转身时从头顶上绕过去
  const a = Math.atan2(-0.6 - 0.55 * over, side * 0.8) + I.arc * Math.sin(ph);
  const r = I.r + I.dr * Math.sin(2 * ph);
  out.x = x + Math.cos(a) * r;
  out.y = y - I.lift + Math.sin(a) * r * 0.8;
}

/**
 * 按「期望加速度」(ax, ay) 推进一帧：像一条游动的鱼——先把速度往期望的方向转（角速度、向心加速度都有上限），
 * 要掉头时先减速；速度始终在 [sMin, sMax] 里，所以走的是平滑的弧线、永远不会停。
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
  // 要转的弯越大越想慢下来（掉头时几乎降到最慢），弯转过来了再提速
  const want = ws * (0.5 + 0.5 * Math.cos(err));
  s = clamp(s + clamp((want - s) / TAU, -L.dec, L.acc) * dt, L.sMin, L.sMax);
  pet.vx = Math.cos(h) * s;
  pet.vy = Math.sin(h) * s;
  pet.x += pet.vx * dt;
  pet.y += pet.vy * dt;
}

/**
 * 挑一群：主人身边 reach 内、还没被缠住的敌人里，身边同伴最多、离主人又近（越近越危险）、又是危险种类的那只；
 * 正在蓄力 / 预警的长矛兵、骑兵最优先（缠上那一下的定身打断它）。
 */
function pickTarget(w: World, p: Player): Enemy | null {
  buildGrid(w.enemies);
  const near = enemiesWithin(w, p.x, p.y, PET.reach);
  if (!near.length) return null;
  const fresh = near.filter((e) => e.wrapT < FRESH);
  const pool = fresh.length ? fresh : near;
  const sample = pool.length <= 16 ? pool : Array.from({ length: 16 }, () => pool[Math.floor(w.rng.next() * pool.length)]);
  let best = sample[0];
  let bs = -1e9;
  for (const e of sample) {
    let s = (1 - Math.sqrt(d2(e, p)) / PET.reach) * 1.6 + (THREAT[e.kind] ?? 0) + (e.act === 'windup' ? 2.5 : 0);
    for (const o of pool) if (d2(o, e) < 26 * 26) s += 1;
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  return best;
}

/**
 * 规划一趟掠过：瞄准敌群的中心稍往前，穿过去的方向和「主人 → 敌群」垂直（从侧面切进去），
 * 从混天绫现在所在的那一侧切入，所以每一趟都是顺着它原来的走势画一道弧，不来回折返。
 */
function plan(w: World, p: Player, pet: Pet): boolean {
  const t = pickTarget(w, p);
  if (!t) return false;
  const pool = enemiesWithin(w, t.x, t.y, 26).filter((e) => d2(e, p) <= PET.reach * PET.reach);
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
  // 混天绫在「主人 → 敌群」这条线的哪一侧，就从哪一侧切进去
  const lat = (pet.x - p.x) * nx + (pet.y + PET.hover - p.y) * ny;
  const sgn = lat < -3 ? 1 : lat > 3 ? -1 : pet.vx * nx + pet.vy * ny >= 0 ? 1 : -1;
  pet.ux = nx * sgn;
  pet.uy = ny * sgn;
  pet.ox = cx - t.x + pet.ux * PET.lead;
  pet.oy = cy - t.y + pet.uy * PET.lead;
  pet.target = t.id;
  pet.tx = t.x + pet.ox;
  pet.ty = t.y + pet.oy - PET.hover;
  const dist = Math.hypot(pet.tx - pet.x, pet.ty - pet.y);
  const s = Math.hypot(pet.vx, pet.vy);
  pet.seekT = clamp((dist * 1.2) / ((s + PET.pass) / 2), 0.3, 0.8);
  pet.mode = 'sweep';
  pet.wrapT = 0;
  pet.hits = [];
  pet.cd = PET.cd * (pet.stage >= 3 ? 0.85 : 1);
  return true;
}

/** 缠住一只：只上减益，不打伤害。 */
function bind(w: World, p: Player, pet: Pet, e: Enemy, dur: number) {
  const ec = elementCounts(p);
  e.slow = Math.max(e.slow, Math.min(0.85, PET.slow * (ec.water >= 1 ? 1.15 : 1)));
  e.slowT = Math.max(e.slowT, dur);
  e.vuln = Math.max(e.vuln, PET.vuln[pet.stage]);
  e.vulnT = Math.max(e.vulnT, dur);
  e.wrapT = Math.max(e.wrapT, dur);
  e.wrapMax = Math.max(e.wrapT, e.wrapMax);
  // 宠物的五行印记：缠多久带多久（被相生消耗了就没了）；敌人身上已经有别的印记时不覆盖，免得冲掉玩家攒好的相生
  const el = HEROES[p.hero].petEl; // 宠物自己的五行（按宠物的来历定，用户 11-12）
  if (!e.mark || e.mark === el) {
    e.mark = el;
    e.markT = Math.max(e.markT, dur);
  }
  // 缚龙：先定身；火绫：「引火」，受到的火行伤害更高、灼烧更久（见 core.hitEnemy / addBurn）。
  // 两条都不作用在首领身上：首领不吃定身，也不吃引火——否则火绫在首领战里就成了一档纯伤害加成（灼烧是打首领的主力），
  // 和缚龙差得太远（审查 BAL-07）。首领身上两条线一样：破绽 + 减速。
  if (e.kind !== 'boss') e.stun = Math.max(e.stun, PET.jolt);
  if (pet.branch === 'bind' && pet.stage >= 1 && e.kind !== 'boss') e.stun = Math.max(e.stun, 0.6 + 0.3 * pet.stage);
  if (pet.branch === 'fire' && pet.stage >= 1 && e.kind !== 'boss') {
    e.fireVuln = Math.max(e.fireVuln, 0.2 + 0.1 * pet.stage);
    e.fireVulnT = Math.max(e.fireVulnT, dur);
  }
}

/** 绸带头扫过的地方：离它正下方的地面 hitR 内、在主人身边 reach 内、这一趟还没缠过的敌人，缠住（每趟有上限）。 */
function sweepHits(w: World, p: Player, pet: Pet, ev: SimEvent[]) {
  const cap = PET.targets[pet.stage] + (pet.branch === 'bind' ? 2 : 0);
  if (pet.hits.length >= cap) return;
  const gx = pet.x;
  const gy = pet.y + PET.hover;
  const r = PET.hitR * (1 + Math.min(REACH.area, p.stats.area));
  buildGrid(w.enemies);
  const got = enemiesWithin(w, gx, gy, r)
    .filter((e) => !pet.hits.includes(e.id) && d2(e, p) <= PET.reach * PET.reach)
    .sort((a, b) => a.wrapT - b.wrapT || a.id - b.id)
    .slice(0, cap - pet.hits.length);
  if (!got.length) return;
  const dur = PET.wrapTime[pet.stage] * (1 + p.stats.area * 0.5) * (1 + (p.boon?.petDur ?? 0)); // 修为「御灵」缠得久（xiuwei.ts）
  for (const e of got) {
    bind(w, p, pet, e, dur);
    pet.hits.push(e.id);
  }
  ev.push({ t: 'wrap', owner: p.id, x: gx, y: gy, r, ids: got.map((e) => e.id), branch: pet.branch, dur });
}

const cNow = { x: 0, y: 0 };
const cWas = { x: 0, y: 0 };

export function updatePet(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const pet = p.pet;
  pet.px = pet.x;
  pet.py = pet.y;
  pet.cd -= dt;
  pet.wrapT += dt;
  // 空闲时飘向的点（跟着主人走；转身时从身后这一侧绕过头顶换到另一侧）和它的速度（前馈）
  const side0 = pet.side;
  const ph0 = pet.ph;
  pet.side += clamp(-p.facing - pet.side, -1.6 * dt, 1.6 * dt);
  pet.ph += PET.idle.rate * dt;
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
      // 瞄准点跟着敌群走
      pet.tx = t.x + pet.ox;
      pet.ty = t.y + pet.oy - PET.hover;
    } else pet.target = -1;
    const rx = pet.tx - pet.x;
    const ry = pet.ty - pet.y;
    if (pet.seekT > 0) {
      // 过了瞄准点（或者追了太久、敌群跑出了够得着的范围）就算穿过去了
      const passed = rx * pet.ux + ry * pet.uy < 0 || rx * rx + ry * ry < 36;
      const gone = pet.wrapT > 2 || d2({ x: pet.tx, y: pet.ty + PET.hover }, p) > (PET.reach + 30) ** 2;
      if (passed || gone) pet.seekT = 0;
      else pet.seekT = Math.max(0.05, pet.seekT - dt);
    }
    if (pet.seekT > 0) {
      if (pet.seekT > 0.06) {
        // 三次曲线制导：按剩下的时间算出「现在该怎么加速」，到瞄准点时正好以 pass 的速度沿 u 方向穿过
        const T = pet.seekT;
        ax = (6 * rx) / (T * T) - (4 * pet.vx + 2 * pet.ux * PET.pass) / T;
        ay = (6 * ry) / (T * T) - (4 * pet.vy + 2 * pet.uy * PET.pass) / T;
      } else {
        // 计划的时间用完了还没到：直接朝瞄准点追过去
        const d = Math.hypot(rx, ry) || 1;
        ax = ((rx / d) * PET.pass - pet.vx) / TAU;
        ay = ((ry / d) * PET.pass - pet.vy) / TAU;
      }
      const m = Math.hypot(ax, ay);
      if (m > 2600) {
        ax *= 2600 / m;
        ay *= 2600 / m;
      }
    } else {
      // 穿过去了：顺势再冲一小段（加速），然后兜回来。seekT 从 0 往下记顺势冲了多久。
      // 已经快到拴绳的长度、还在往外飞时不再冲，直接兜回来（免得撞上拴绳，被硬拽一下）
      pet.seekT -= dt;
      const s = Math.hypot(pet.vx, pet.vy) || 1;
      ax = (pet.vx / s) * 380;
      ay = (pet.vy / s) * 380;
      const ox = pet.x - p.x;
      const oy = pet.y + PET.hover - p.y;
      const edge = Math.hypot(ox, oy) > PET.leash - 24 && ox * pet.vx + oy * pet.vy > 0;
      if (pet.seekT < -PET.through || edge) {
        pet.mode = 'return';
        pet.wrapT = 0;
      }
    }
  }
  if (pet.mode === 'return' || pet.mode === 'follow') {
    // 回旋：增益小，顺着惯性兜一个大弯；空闲：增益大，贴着「8」字飘
    const ret = pet.mode === 'return';
    lim = ret ? RETURN : FOLLOW;
    const wn = ret ? 3.2 : 4.2;
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
  let ly = pet.y + PET.hover - p.y;
  let ld = Math.hypot(lx, ly);
  const soft = PET.leash - 20;
  if (ld > soft && ld < PET.leash + 200) {
    const k = (ld - soft) * 140;
    ax -= (lx / ld) * k;
    ay -= (ly / ld) * k;
  }
  fly(pet, ax, ay, lim, dt);
  // 兜底：真的出了 leash（主人跑得快、正好背着它跑），就贴在 leash 上，去掉往外的速度
  lx = pet.x - p.x;
  ly = pet.y + PET.hover - p.y;
  ld = Math.hypot(lx, ly);
  if (ld > PET.leash && ld < PET.leash + 200) {
    const ux = lx / ld;
    const uy = ly / ld;
    pet.x = p.x + ux * PET.leash;
    pet.y = p.y + uy * PET.leash - PET.hover;
    const out = pet.vx * ux + pet.vy * uy;
    if (out > 0) {
      pet.vx -= out * ux;
      pet.vy -= out * uy;
    }
  }
  // 掠过（和刚穿过去、还在高速兜弯的那一段）时扫到的敌人被缠住
  if (pet.mode !== 'follow' && Math.hypot(pet.vx, pet.vy) >= 110) sweepHits(w, p, pet, ev);
}
