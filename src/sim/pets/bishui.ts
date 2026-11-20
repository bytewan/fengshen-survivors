// 专属宠物：回响敖丙 · 避水兽（暂拟，待评审确认）。原著里敖丙骑的那头「避水兽」：青鳞、白鬃、独角，走到哪里水往两边分开。
// 无敌、不造成伤害，只给敌人上减益「湿透」（用户：宠物突出减益，不突出输出；通过「飘过」攻击，不要一直盯着敌人）。
// 跑法和哮天犬同一套（贴地跑、从敌群里一冲而过、冲过头一小段再掉头回主人身后），冲过去的时候身子两边掀起浪头。
// 跟随与出手按用户 11-12 的口径（pets/heel.ts）：空闲时在主人身后离脚下 38–54 像素的距离带里（最近不小于 30），主人站定时慢慢踱两步；
// 冷却好了、**它自己身边 80 像素内**有敌人就冲一趟（约 1.6 秒一趟）；离主人超过 100 像素就快跑回距离带；拴绳 140。
// - 浪扫到的敌人被往两边推开（首领推不动），带上「湿透」：走得慢；到时之前再挨一下水行的伤害就冻住片刻（冻上就不湿了；首领不吃冻，只是慢）；
// - 避水兽是水行宠物（用户 11-12：宠物的五行按它自己的来历定，不一定和主人相生；避水金睛兽，入水分波；和敖丙同是水，龙族一身水）：被打湿的带上水行印记。
// 进化两条路：怒涛（浪推得更远、每趟多打湿两只）、霜髓（湿透的被冻住时冻得更久，冻着的时候受到的伤害更高）。
// 冻结在 core.hitEnemy 里结算（Enemy.soakUntil / soakFreeze / soakDeep）。状态用的是和别的宠物同一个 Pet；位置 (x, y) 就是脚下。
import { HEROES } from '../catalog.ts';
import { ENEMIES, REACH } from '../config.ts';
import { buildGrid, enemiesWithin, slowEnemy } from '../core.ts';
import { endPass, heelSpot, heelStep, inReach, leash, placeAtHeel, ready, run, type Gait, type Heel } from './heel.ts';
import type { Enemy, EnemyKindName, Pet, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

export const BISHUI = {
  cd: 1.6, // 两趟之间（从上一趟出发算起；用户 11-12 前是 3.0，「只要范围内有敌人就自己攻击」改短；每趟打湿的只数跟着收了两只）
  band: { min: 30, near: 38, rest: 46, far: 54, down: 0.12, back: 100, range: 95, leash: 140 } satisfies Heel, // 距离带、出手范围、回归距离、拴绳（heel.ts）
  hitR: 16, // 浪头扫到身子两边这么远（吃「范围」，最多算到 +REACH.area）
  dash: 200, // 冲过敌群的速度（像素 / 秒）
  lead: 12, // 瞄准点放在敌群中心往前多远：穿过去
  through: 0.12, // 过了瞄准点之后再顺势冲多久才掉头
  maxDash: 1.1, // 一趟最多冲多久
  targets: [2, 3, 4, 5], // 每个阶段一趟最多打湿几只（11-12 冷却 3.0 → 1.6 秒，这里 4–7 → 2–5：每秒打湿的只数和原来差不多）
  push: [70, 80, 90, 100], // 往两边推开的速度（按敌人的分量折算；首领推不动）
  slow: [0.25, 0.28, 0.32, 0.35], // 湿透：走得慢
  soakT: [4, 4.4, 4.8, 5.2], // 湿透多久
  freeze: [0.8, 0.9, 1, 1.1], // 湿透时挨一下水行的伤害：冻多久
  surge: { extra: 2, push: 1.6, r: 1.3 }, // 怒涛：每趟多打湿两只、推得更远、浪更宽
  marrow: { freeze: 1.5, deep: [0, 0.2, 0.26, 0.32] }, // 霜髓：冻得更久（倍数）；冻着的时候受到的伤害 +这么多
};
/** 挑哪一群时，这几种更危险的敌人优先（正在蓄力 / 预警的再优先：把它推开、之后一冻就打断了）。 */
const THREAT: Partial<Record<EnemyKindName, number>> = { spearman: 0.8, cavalry: 1.2, bomber: 1.2, caster: 1, elite: 0.8, shieldbearer: 0.6 };
const FRESH = 1;

/** 跑法（heel.ts 的 Gait）。 */
const TROT: Gait = { sMax: 140, acc: 480, dec: 620, turn: 9, aLat: 1200 };
const DASH: Gait = { sMax: 215, acc: 1000, dec: 700, turn: 6.5, aLat: 1600 };
const BACK: Gait = { sMax: 190, acc: 680, dec: 760, turn: 8, aLat: 1500 };

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** 湿透还在不在（表现层画水珠也用它）。 */
export const soaked = (w: World, e: Enemy) => e.soakUntil !== undefined && w.time < e.soakUntil;

/** 开局的避水兽：卧在主人身后（距离带里）。 */
export function newBishui(x: number, y: number): Pet {
  const s = heelSpot(x, y, 1, BISHUI.band);
  return { stage: 0, branch: null, mode: 'follow', x: s.x, y: s.y, px: s.x, py: s.y, vx: 0, vy: 0, cd: 1.8, tx: x, ty: y, ux: 1, uy: 0, ox: s.x - x, oy: s.y - y, target: -1, seekT: 0, wrapT: 0, hits: [], ph: 0, side: 0 };
}

/** 瞬移之后（归队）：摆回主人身后。 */
export const placeBishui = (p: Player) => placeAtHeel(p, BISHUI.band);

/** 主人站着、它在带里待着时慢慢左右踱两步：相对待着那一点的偏移。 */
const pace = (pet: Pet) => ({ x: 3 * Math.sin(pet.ph * 0.7), y: 1.2 * Math.sin(pet.ph * 1.3) });

/**
 * 挑一群：它自己身边 range 内（离主人不超过拴绳减一点）、还没湿透的敌人里，身边同伴最多、离它近、离主人也近、又是危险种类的那只；
 * 正在蓄力的最优先。
 */
function pickTarget(w: World, p: Player, pet: Pet): Enemy | null {
  const B = BISHUI.band;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, pet.x, pet.y, B.range).filter(inReach(pet, p, B));
  if (!near.length) return null;
  const fresh = near.filter((e) => (e.soakUntil ?? 0) - w.time < FRESH);
  const pool = fresh.length ? fresh : near;
  const sample = pool.length <= 16 ? pool : Array.from({ length: 16 }, () => pool[Math.floor(w.rng.next() * pool.length)]);
  let best = sample[0];
  let bs = -1e9;
  for (const e of sample) {
    let s = (1 - Math.sqrt(d2(e, pet)) / B.range) + (1 - Math.sqrt(d2(e, p)) / B.leash) * 0.6 + (THREAT[e.kind] ?? 0) + (e.act === 'windup' ? 2.5 : 0);
    for (const o of pool) if (d2(o, e) < 28 * 28) s += 1;
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  return best;
}

/** 规划一趟：从自己所在的地方直线冲向敌群中心（再往前 lead），穿过去。 */
function plan(w: World, p: Player, pet: Pet): boolean {
  const t = pickTarget(w, p, pet);
  if (!t) return false;
  const pool = enemiesWithin(w, t.x, t.y, 28).filter((e) => d2(e, p) <= (BISHUI.band.leash - 20) ** 2);
  let cx = 0;
  let cy = 0;
  for (const e of pool) {
    cx += e.x;
    cy += e.y;
  }
  cx = pool.length ? cx / pool.length : t.x;
  cy = pool.length ? cy / pool.length : t.y;
  let ux = cx - pet.x;
  let uy = cy - pet.y;
  const u = Math.hypot(ux, uy);
  if (u < 1e-3) {
    ux = p.facing;
    uy = 0;
  } else {
    ux /= u;
    uy /= u;
  }
  pet.ux = ux;
  pet.uy = uy;
  pet.ox = cx - t.x + ux * BISHUI.lead;
  pet.oy = cy - t.y + uy * BISHUI.lead;
  pet.target = t.id;
  pet.tx = t.x + pet.ox;
  pet.ty = t.y + pet.oy;
  pet.seekT = BISHUI.maxDash;
  pet.mode = 'sweep';
  pet.wrapT = 0;
  pet.hits = [];
  pet.cd = BISHUI.cd * (pet.stage >= 3 ? 0.85 : 1);
  return true;
}

/** 打湿一只：只上减益，不打伤害；顺着浪往旁边推开。 */
function soak(w: World, p: Player, pet: Pet, e: Enemy, dur: number, ux: number, uy: number) {
  const X = BISHUI;
  const marrow = pet.branch === 'marrow' && pet.stage >= 1;
  const surge = pet.branch === 'surge' && pet.stage >= 1;
  e.soakUntil = Math.max(e.soakUntil ?? 0, w.time + dur);
  e.soakFreeze = X.freeze[pet.stage] * (marrow ? X.marrow.freeze : 1);
  if (marrow) e.soakDeep = X.marrow.deep[pet.stage];
  else delete e.soakDeep;
  slowEnemy(w, e, p.id, X.slow[pet.stage], dur);
  // 宠物的五行印记：湿多久带多久；敌人身上已经有别的印记时不覆盖，免得冲掉玩家攒好的相生
  const el = HEROES[p.hero].petEl; // 宠物自己的五行（按宠物的来历定，用户 11-12）
  if (!e.mark || e.mark === el) {
    e.mark = el;
    e.markT = Math.max(e.markT, dur);
  }
  // 往两边推开：在它冲的那条线的哪一侧就往哪一侧推（正在线上的按 id 分左右，确定）；首领推不动
  if (e.kind !== 'boss') {
    const side = -uy * (e.x - pet.x) + ux * (e.y - pet.y);
    const s = Math.abs(side) > 0.5 ? Math.sign(side) : e.id % 2 ? 1 : -1;
    const k = (X.push[pet.stage] * (surge ? X.surge.push : 1)) / ENEMIES[e.kind].mass;
    e.kx += -uy * s * k;
    e.ky += ux * s * k;
  }
}

/** 浪头扫到的：身子两边 hitR 内、在拴绳以内、这一趟还没打湿过的敌人（每趟有上限）。 */
function splash(w: World, p: Player, pet: Pet, ev: SimEvent[]) {
  const X = BISHUI;
  const surge = pet.branch === 'surge' && pet.stage >= 1;
  const cap = X.targets[pet.stage] + (surge ? X.surge.extra : 0);
  if (pet.hits.length >= cap) return;
  const s = Math.hypot(pet.vx, pet.vy) || 1;
  const ux = pet.vx / s;
  const uy = pet.vy / s;
  const r = X.hitR * (1 + Math.min(REACH.area, p.stats.area)) * (surge ? X.surge.r : 1);
  buildGrid(w.enemies);
  const got = enemiesWithin(w, pet.x, pet.y, r)
    .filter((e) => !pet.hits.includes(e.id) && d2(e, p) <= X.band.leash * X.band.leash)
    .sort((a, b) => (a.soakUntil ?? 0) - (b.soakUntil ?? 0) || a.id - b.id)
    .slice(0, cap - pet.hits.length);
  if (!got.length) return;
  const dur = X.soakT[pet.stage] * (1 + p.stats.area * 0.5) * (1 + (p.boon?.petDur ?? 0)); // 修为「御灵」湿得久（xiuwei.ts）
  for (const e of got) {
    soak(w, p, pet, e, dur, ux, uy);
    pet.hits.push(e.id);
  }
  ev.push({ t: 'splash', owner: p.id, x: pet.x, y: pet.y, ux, uy, ids: got.map((e) => e.id), dur, branch: pet.branch });
}

/**
 * 推进一帧。用到的 Pet 字段和哮天犬一样：mode（follow 跟着 / sweep 冲过 / return 回来）、(x, y) 脚下、(vx, vy) 速度、cd 距下一趟、
 * target / (ox, oy) / (tx, ty) 瞄准点、(ux, uy) 冲的方向、seekT 冲刺还剩多少时间（穿过去之后变成负数）、wrapT 当前这一段过了多久、
 * hits 这一趟打湿过的、ph 空闲时踱步的相位。
 */
export function updateBishui(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const X = BISHUI;
  const pet = p.pet;
  pet.px = pet.x;
  pet.py = pet.y;
  pet.cd -= dt;
  pet.wrapT += dt;
  pet.ph += dt;
  // 出手：冷却好了、它自己的出手范围里有敌人（刚掉头回来的那一小段先不出）
  if (ready(pet)) plan(w, p, pet);

  if (pet.mode === 'sweep') {
    const t = pet.target >= 0 ? w.enemies.find((e) => e.id === pet.target && e.hp > 0) : undefined;
    if (t) {
      pet.tx = t.x + pet.ox;
      pet.ty = t.y + pet.oy;
    } else pet.target = -1;
    const rx = pet.tx - pet.x;
    const ry = pet.ty - pet.y;
    if (pet.seekT > 0) {
      const passed = rx * pet.ux + ry * pet.uy < 0 || rx * rx + ry * ry < 36;
      const gone = d2({ x: pet.tx, y: pet.ty }, p) > X.band.leash ** 2;
      pet.seekT -= dt;
      if (passed || gone || pet.seekT <= 0) pet.seekT = -1e-9;
      else {
        const d = Math.hypot(rx, ry) || 1;
        pet.ux = rx / d;
        pet.uy = ry / d;
        run(pet, pet.ux * X.dash, pet.uy * X.dash, DASH, dt);
      }
    }
    if (pet.seekT <= 0) {
      pet.seekT -= dt;
      const s = Math.hypot(pet.vx, pet.vy) || 1;
      run(pet, (pet.vx / s) * X.dash, (pet.vy / s) * X.dash, DASH, dt);
      const ox = pet.x - p.x;
      const oy = pet.y - p.y;
      const edge = Math.hypot(ox, oy) > X.band.leash - 16 && ox * pet.vx + oy * pet.vy > 0;
      if (pet.seekT < -X.through || edge) endPass(p, pet, X.band);
    }
  } else heelStep(p, pet, X.band, TROT, BACK, dt, pace(pet));

  // 拴在主人身边（还在冲的那一趟收掉，掉头回来）
  if (leash(p, pet, X.band) === 'pull' && pet.mode === 'sweep') endPass(p, pet, X.band);
  if (pet.mode === 'sweep' && Math.hypot(pet.vx, pet.vy) >= 100) splash(w, p, pet, ev);
}
