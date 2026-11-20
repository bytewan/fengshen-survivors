// 专属宠物：杨戬 · 哮天犬（暂拟，待评审确认）。无敌、不造成伤害，只给敌人上减益「破甲」（用户：宠物突出减益，不突出输出）。
// 打法照用户给混天绫的口径（「不应该一直盯着敌人，应该通过飘过攻击」「攻击距离不能太大」），跟随与出手按用户 11-12 的口径（pets/heel.ts）：
// - follow 空闲：在主人身后离脚下 36–52 像素的距离带里（最近不小于 28），主人走它小跑着跟、不贴脚边；主人站定它也停下、左右嗅一嗅；
// - sweep 冲过：冷却好了、**它自己身边 90 像素内**有敌人就出手：挑一群，从自己所在的地方直线冲过去、穿过敌群，
//   沿途嘴边 11 像素内的敌人各被咬一口（每趟有上限，同一只一趟只咬一次），冲过头一小段再掉头；
// - return 回来：离主人超过 100 像素就快跑回距离带（以内的照常小跑回去）；两趟之间约 1.5 秒，掉头回来的路上范围内有敌人就接着冲下一趟。
//   自己离主人不超过 140 像素（拴绳）。
// 被咬的敌人「破甲」：受到的伤害提高（敌人没有护体，破甲就是受伤加深；盾卫的盾也挡不住，见 core.hitEnemy），
// 咬上那一下顿一顿（打断长矛兵、骑兵的蓄力；首领不吃）。哮天犬是土行宠物（用户 11-12：宠物的五行按它自己的来历定，不一定和主人相生；戌狗属土）：被咬的带上土行印记
// 金行法宝打上去就是「淬锋」。进化两条路：天狗（扑倒：先按住片刻、每趟多咬两只）、金牙（裂甲：被咬的受金行伤害更高、更容易被暴击）。
// 状态用的是和混天绫同一个 Pet（字段含义见下面 updateXiaotian 里的注释）；位置 (x, y) 就是脚下（贴地跑，不像混天绫飘在半空）。
import { HEROES } from '../catalog.ts';
import { REACH } from '../config.ts';
import { buildGrid, enemiesWithin } from '../core.ts';
import { endPass, heelSpot, heelStep, inReach, leash, placeAtHeel, ready, run, type Gait, type Heel } from './heel.ts';
import type { Enemy, EnemyKindName, Pet, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

export const XIAOTIAN = {
  cd: 1.5, // 两趟之间（从上一趟出发算起；用户 11-12 前是 2.6，「只要范围内有敌人就自己攻击」改短；每趟咬的只数跟着收了一只）
  band: { min: 28, near: 36, rest: 44, far: 52, down: 0.12, back: 100, range: 100, leash: 140 } satisfies Heel, // 距离带、出手范围、回归距离、拴绳（heel.ts）
  hitR: 11, // 嘴边这么近的敌人被咬（吃「范围」，和法宝一样最多算到 +REACH.area）
  mouth: 6, // 嘴在身子前面多远（朝着跑的方向）
  dash: 215, // 冲过敌群的速度（像素 / 秒）
  lead: 10, // 瞄准点放在敌群中心往前（冲的方向）多远：穿过去，而不是停在敌群中间
  through: 0.1, // 过了瞄准点之后再顺势冲多久，才掉头（短一点：穿过去就兜回来，不跑远）
  maxDash: 1.1, // 一趟最多冲多久（敌群在跑、一直追不上就不追了）
  targets: [2, 3, 4, 5], // 每个阶段一趟最多咬几只（11-12 冷却 2.6 → 1.5 秒，这里 3–6 → 2–5：每秒咬的只数和原来差不多）
  sunder: [0.3, 0.35, 0.4, 0.45], // 「破甲」：受到的伤害加成（2026-11-11 数值平衡 0.35–0.5 → 0.3–0.45，和混天绫的破绽一样：杨戬开局打得最快，机器人通过率比别的角色高一截）
  sunderT: [4, 4.4, 4.8, 5.2], // 破甲多久（比两趟的间隔长：主人身边的敌人一直破着）
  jolt: 0.25, // 咬上那一下顿一顿：定身这么久（首领不吃）
  pounce: { extra: 2, stun: [0, 0.8, 1, 1.2] }, // 天狗：每趟多咬两只，咬上先按住（定身）
  fang: [0, 0.25, 0.32, 0.4], // 金牙：破甲期间受到的金行伤害再 +这么多，被暴击的几率 +一半
};
/** 挑哪一群时，这几种更危险的敌人优先（正在蓄力 / 预警的再优先：咬上那一下的定身打断它）。和混天绫一样。 */
const THREAT: Partial<Record<EnemyKindName, number>> = { spearman: 0.8, cavalry: 1.2, bomber: 1.2, caster: 1, elite: 0.8, shieldbearer: 0.6 };
/** 敌人身上的破甲剩下不到这么久，才算「没被咬过」，优先挑。 */
const FRESH = 1;

/** 跑法（heel.ts 的 Gait）。 */
const TROT: Gait = { sMax: 150, acc: 520, dec: 640, turn: 10, aLat: 1300 };
const DASH: Gait = { sMax: 235, acc: 1100, dec: 700, turn: 7, aLat: 1700 };
const BACK: Gait = { sMax: 200, acc: 700, dec: 760, turn: 8, aLat: 1500 };

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** 开局的哮天犬：蹲在主人身后（距离带里）。 */
export function newXiaotian(x: number, y: number): Pet {
  const s = heelSpot(x, y, 1, XIAOTIAN.band);
  return { stage: 0, branch: null, mode: 'follow', x: s.x, y: s.y, px: s.x, py: s.y, vx: 0, vy: 0, cd: 1.5, tx: x, ty: y, ux: 1, uy: 0, ox: s.x - x, oy: s.y - y, target: -1, seekT: 0, wrapT: 0, hits: [], ph: 0, side: -1 };
}

/** 瞬移之后（归队）：摆回主人身后。 */
export const placeXiaotian = (p: Player) => placeAtHeel(p, XIAOTIAN.band);

/** 主人站着、它在带里待着时左右嗅一嗅（ph 是相位）：相对待着那一点的偏移。 */
const sniff = (pet: Pet) => ({ x: 4 * Math.sin(pet.ph * 0.9), y: 1.5 * Math.sin(pet.ph * 1.7) });

/**
 * 挑一群：它自己身边 range 内（离主人不超过拴绳减一点）、还没破甲的敌人里，身边同伴最多、离它近、离主人也近、又是危险种类的那只；
 * 正在蓄力的最优先。
 */
function pickTarget(w: World, p: Player, pet: Pet): Enemy | null {
  const B = XIAOTIAN.band;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, pet.x, pet.y, B.range).filter(inReach(pet, p, B));
  if (!near.length) return null;
  const fresh = near.filter((e) => (e.sunderUntil ?? 0) - w.time < FRESH);
  const pool = fresh.length ? fresh : near;
  const sample = pool.length <= 16 ? pool : Array.from({ length: 16 }, () => pool[Math.floor(w.rng.next() * pool.length)]);
  let best = sample[0];
  let bs = -1e9;
  for (const e of sample) {
    let s = (1 - Math.sqrt(d2(e, pet)) / B.range) + (1 - Math.sqrt(d2(e, p)) / B.leash) * 0.6 + (THREAT[e.kind] ?? 0) + (e.act === 'windup' ? 2.5 : 0);
    for (const o of pool) if (d2(o, e) < 26 * 26) s += 1;
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
  const pool = enemiesWithin(w, t.x, t.y, 26).filter((e) => d2(e, p) <= (XIAOTIAN.band.leash - 20) ** 2);
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
  pet.ox = cx - t.x + ux * XIAOTIAN.lead;
  pet.oy = cy - t.y + uy * XIAOTIAN.lead;
  pet.target = t.id;
  pet.tx = t.x + pet.ox;
  pet.ty = t.y + pet.oy;
  pet.seekT = XIAOTIAN.maxDash;
  pet.mode = 'sweep';
  pet.wrapT = 0;
  pet.hits = [];
  pet.cd = XIAOTIAN.cd * (pet.stage >= 3 ? 0.85 : 1);
  return true;
}

/** 咬一口：只上减益，不打伤害。 */
function bite(w: World, p: Player, pet: Pet, e: Enemy, dur: number) {
  const X = XIAOTIAN;
  e.sunder = Math.max(e.sunder ?? 0, X.sunder[pet.stage]);
  e.sunderUntil = Math.max(e.sunderUntil ?? 0, w.time + dur);
  if (pet.branch === 'fang' && pet.stage >= 1) e.fang = Math.max(e.fang ?? 0, X.fang[pet.stage]);
  // 宠物的五行印记：破甲多久带多久（被相生消耗了就没了）；敌人身上已经有别的印记时不覆盖，免得冲掉玩家攒好的相生
  const el = HEROES[p.hero].petEl; // 宠物自己的五行（按宠物的来历定，用户 11-12）
  if (!e.mark || e.mark === el) {
    e.mark = el;
    e.markT = Math.max(e.markT, dur);
  }
  // 首领不吃定身（咬上那一下的顿、天狗的按住都不作用在首领身上）：首领身上两条路一样，都是破甲
  if (e.kind !== 'boss') e.stun = Math.max(e.stun, X.jolt);
  if (pet.branch === 'pounce' && pet.stage >= 1 && e.kind !== 'boss') e.stun = Math.max(e.stun, X.pounce.stun[pet.stage]);
}

/** 嘴边扫到的：离嘴 hitR 内、在拴绳以内、这一趟还没咬过的敌人，咬一口（每趟有上限）。 */
function biteHits(w: World, p: Player, pet: Pet, ev: SimEvent[]) {
  const X = XIAOTIAN;
  const cap = X.targets[pet.stage] + (pet.branch === 'pounce' ? X.pounce.extra : 0);
  if (pet.hits.length >= cap) return;
  const s = Math.hypot(pet.vx, pet.vy) || 1;
  const mx = pet.x + (pet.vx / s) * X.mouth;
  const my = pet.y + (pet.vy / s) * X.mouth;
  const r = X.hitR * (1 + Math.min(REACH.area, p.stats.area));
  buildGrid(w.enemies);
  const got = enemiesWithin(w, mx, my, r)
    .filter((e) => !pet.hits.includes(e.id) && d2(e, p) <= X.band.leash * X.band.leash)
    .sort((a, b) => (a.sunderUntil ?? 0) - (b.sunderUntil ?? 0) || a.id - b.id)
    .slice(0, cap - pet.hits.length);
  if (!got.length) return;
  const dur = X.sunderT[pet.stage] * (1 + p.stats.area * 0.5) * (1 + (p.boon?.petDur ?? 0)); // 修为「御灵」破甲久（xiuwei.ts）
  for (const e of got) {
    bite(w, p, pet, e, dur);
    pet.hits.push(e.id);
  }
  ev.push({ t: 'bite', owner: p.id, x: mx, y: my, ids: got.map((e) => e.id), dur, branch: pet.branch });
}

/**
 * 推进一帧。用到的 Pet 字段：mode（follow 跟着 / sweep 冲过 / return 回来）、(x, y) 脚下、(vx, vy) 速度、cd 距下一趟、
 * target 这一趟瞄的那只、(ox, oy) 瞄准点相对它的偏移、(tx, ty) 瞄准点、(ux, uy) 冲的方向、seekT 冲刺还剩多少时间
 * （穿过去之后变成负数，记顺势冲了多久）、wrapT 当前这一段过了多久、hits 这一趟咬过的、ph 空闲时嗅的相位。
 */
export function updateXiaotian(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const X = XIAOTIAN;
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
      // 瞄准点跟着敌群走
      pet.tx = t.x + pet.ox;
      pet.ty = t.y + pet.oy;
    } else pet.target = -1;
    const rx = pet.tx - pet.x;
    const ry = pet.ty - pet.y;
    if (pet.seekT > 0) {
      // 过了瞄准点（或者冲了太久、敌群跑出了够得着的范围）就算穿过去了
      const passed = rx * pet.ux + ry * pet.uy < 0 || rx * rx + ry * ry < 36;
      const gone = d2({ x: pet.tx, y: pet.ty }, p) > X.band.leash ** 2;
      pet.seekT -= dt;
      if (passed || gone || pet.seekT <= 0) pet.seekT = -1e-9;
      else {
        const d = Math.hypot(rx, ry) || 1;
        // 冲的方向慢慢跟上瞄准点（敌群在动），但不来回折返
        pet.ux = rx / d;
        pet.uy = ry / d;
        run(pet, pet.ux * X.dash, pet.uy * X.dash, DASH, dt);
      }
    }
    if (pet.seekT <= 0) {
      // 穿过去了：顺着冲的方向再跑一小段，然后掉头。快到拴绳的长度就提前掉头
      pet.seekT -= dt;
      const s = Math.hypot(pet.vx, pet.vy) || 1;
      run(pet, (pet.vx / s) * X.dash, (pet.vy / s) * X.dash, DASH, dt);
      const ox = pet.x - p.x;
      const oy = pet.y - p.y;
      const edge = Math.hypot(ox, oy) > X.band.leash - 16 && ox * pet.vx + oy * pet.vy > 0;
      if (pet.seekT < -X.through || edge) endPass(p, pet, X.band);
    }
  } else heelStep(p, pet, X.band, TROT, BACK, dt, sniff(pet));
  // 拴在主人身边（还在冲的那一趟收掉，掉头回来）
  if (leash(p, pet, X.band) === 'pull' && pet.mode === 'sweep') endPass(p, pet, X.band);
  // 冲的时候（和刚穿过去、还在顺势冲的那一段）嘴边扫到的敌人被咬
  if (pet.mode === 'sweep' && Math.hypot(pet.vx, pet.vy) >= 100) biteHits(w, p, pet, ev);
}
