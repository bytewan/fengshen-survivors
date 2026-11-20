// 专属宠物：赵公明 · 黑虎（暂拟，待评审确认）。无敌、不造成伤害，只给敌人上减益「震慑」（用户：宠物突出减益，不突出输出）。
// 打法照用户给混天绫的口径（「不应该一直盯着敌人，应该通过飘过攻击」「攻击距离不能太大」），和哮天犬一样贴地跑：
// 跟随与出手按用户 11-12 的口径（pets/heel.ts）：
// - follow 空闲：在主人身后离脚下 38–54 像素的距离带里（最近不小于 30），主人站定它也卧下似的停住（左右甩一甩尾巴，画面）；
// - sweep 扑过：冷却好了、**它自己身边 75 像素内**有敌人就出手：挑一群，从自己所在的地方扑过去；扑到那群中间吼一声，
//   半径 r 内的敌人被「震慑」（吓一跳顿一下，然后转身往外逃 dur 秒：不追人、不起手，打人的伤害降低），顺着冲势滑出去一小段再掉头；
// - return 回来：离主人超过 105 像素就快跑回距离带（以内的照常小跑回去）。两趟之间约 1.7 秒；自己不离主人超过 140 像素（拴绳）。
// 首领不会被吓住（不吃控制），只沾上印记。黑虎是木行宠物（用户 11-12：宠物的五行按它自己的来历定，不一定和主人相生；寅虎属木）：被吼到的带上木行印记。
// 进化两条路：啸风（吼声更大、把敌人吼退一步、震慑更久、一吼多吓三只）、破财（被震慑时被打死的敌人多掉一颗灵石，几率随阶段涨）。
// 被吓住之后怎么走、打人打多重、被打死时掉什么，规则在 heroes/passives.ts（world.step、core.onKill 调）。
// 状态用的是和混天绫同一个 Pet；位置 (x, y) 就是脚下（贴地跑）。hits 在这里只记「这一趟吼过没有」（吼过 = 里面有一项）。
import { HEROES } from '../catalog.ts';
import { ENEMIES, REACH } from '../config.ts';
import { buildGrid, enemiesWithin } from '../core.ts';
import { endPass, heelSpot, heelStep, inReach, leash, placeAtHeel, ready, run, type Gait, type Heel } from './heel.ts';
import type { Enemy, EnemyKindName, Pet, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

export const HEIHU = {
  cd: 1.7, // 两趟之间（从上一趟出发算起；用户 11-12 前是 2.8，「只要范围内有敌人就自己攻击」改短；一吼吓住的只数跟着收了两只）
  band: { min: 30, near: 38, rest: 46, far: 54, down: 0.1, back: 105, range: 90, leash: 140 } satisfies Heel, // 距离带、出手范围、回归距离、拴绳（heel.ts）
  r: [30, 32, 34, 36], // 吼声震慑的半径（各阶段；吃「范围」，和法宝一样最多算到 +REACH.area）
  cap: [4, 5, 6, 7], // 一吼最多吓住几只（离吼声最近的先；11-12 冷却 2.8 → 1.7 秒，这里 6–9 → 4–7：每秒吓住的只数和原来差不多）
  fearT: [1.5, 1.6, 1.7, 1.8], // 往外逃多久（用户：约 1.5 秒）
  cut: [0.4, 0.45, 0.5, 0.55], // 这期间打人的伤害降低多少
  flinch: 0.2, // 吓一跳：先顿这么久（打断长矛兵、骑兵的蓄力；首领不吃）
  dash: 205, // 扑过去的速度（像素 / 秒）
  lead: 8, // 瞄准点放在敌群中心往前（扑的方向）多远：吼在敌群中间，而不是停在边上
  through: 0.3, // 吼完顺着冲势滑出去多久（慢下来，不停住），才掉头
  maxDash: 1.2, // 一趟最多扑多久（敌群在跑、一直追不上就不追了，就地吼一声）
  gale: { r: 1.3, t: 1.25, kb: 110, extra: 3 }, // 啸风：吼声半径、震慑时长的倍数，往外吼退的力道，一吼多吓几只
  broke: [0, 0.35, 0.45, 0.55], // 破财：被震慑时被打死、多掉一颗灵石的几率（各阶段）
};
/** 挑哪一群时，这几种更危险的敌人优先（正在蓄力 / 预警的再优先：吓一跳的那一顿打断它）。和哮天犬一样。 */
const THREAT: Partial<Record<EnemyKindName, number>> = { spearman: 0.8, cavalry: 1.2, bomber: 1.2, caster: 1, elite: 0.8, shieldbearer: 0.6 };
/** 敌人身上的震慑剩下不到这么久，才算「没被吓过」，优先挑。 */
const FRESH = 0.4;

/** 跑法（heel.ts 的 Gait）。黑虎比哮天犬沉，拐弯慢一点。 */
const TROT: Gait = { sMax: 140, acc: 480, dec: 620, turn: 9, aLat: 1200 };
const DASH: Gait = { sMax: 225, acc: 1000, dec: 680, turn: 6, aLat: 1500 };
const BACK: Gait = { sMax: 190, acc: 650, dec: 720, turn: 7, aLat: 1400 };

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** 开局的黑虎：卧在主人身后（距离带里）。 */
export function newHeihu(x: number, y: number): Pet {
  const s = heelSpot(x, y, 1, HEIHU.band);
  return { stage: 0, branch: null, mode: 'follow', x: s.x, y: s.y, px: s.x, py: s.y, vx: 0, vy: 0, cd: 1.6, tx: x, ty: y, ux: 1, uy: 0, ox: s.x - x, oy: s.y - y, target: -1, seekT: 0, wrapT: 0, hits: [], ph: 0, side: -1 };
}

/** 瞬移之后（归队）：摆回主人身后。 */
export const placeHeihu = (p: Player) => placeAtHeel(p, HEIHU.band);

/**
 * 挑一群：它自己身边 range 内（离主人不超过拴绳减一点）、还没被吓住的敌人里，身边同伴最多、离它近、离主人也近、又是危险种类的那只；
 * 正在蓄力的最优先。
 */
function pickTarget(w: World, p: Player, pet: Pet): Enemy | null {
  const B = HEIHU.band;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, pet.x, pet.y, B.range).filter(inReach(pet, p, B));
  if (!near.length) return null;
  const fresh = near.filter((e) => e.kind !== 'boss' && (e.fearUntil ?? 0) - w.time < FRESH);
  const pool = fresh.length ? fresh : near;
  const sample = pool.length <= 16 ? pool : Array.from({ length: 16 }, () => pool[Math.floor(w.rng.next() * pool.length)]);
  let best = sample[0];
  let bs = -1e9;
  for (const e of sample) {
    let s = (1 - Math.sqrt(d2(e, pet)) / B.range) + (1 - Math.sqrt(d2(e, p)) / B.leash) * 0.6 + (THREAT[e.kind] ?? 0) + (e.act === 'windup' ? 2.5 : 0);
    for (const o of pool) if (d2(o, e) < 30 * 30) s += 1;
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  return best;
}

/** 规划一趟：从自己所在的地方扑向敌群中心（再往前 lead）。 */
function plan(w: World, p: Player, pet: Pet): boolean {
  const t = pickTarget(w, p, pet);
  if (!t) return false;
  const pool = enemiesWithin(w, t.x, t.y, 30).filter((e) => d2(e, p) <= (HEIHU.band.leash - 20) ** 2);
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
  pet.ox = cx - t.x + ux * HEIHU.lead;
  pet.oy = cy - t.y + uy * HEIHU.lead;
  pet.target = t.id;
  pet.tx = t.x + pet.ox;
  pet.ty = t.y + pet.oy;
  pet.seekT = HEIHU.maxDash;
  pet.mode = 'sweep';
  pet.wrapT = 0;
  pet.hits = [];
  pet.cd = HEIHU.cd * (pet.stage >= 3 ? 0.85 : 1);
  return true;
}

/** 吓住一只：先顿一下，然后背着吼声、背着主人往外逃；土行印记；啸风再往外吼退一步，破财记下几率。 */
function scare(w: World, p: Player, pet: Pet, e: Enemy, dur: number) {
  const H = HEIHU;
  const gale = pet.branch === 'gale' && pet.stage >= 1;
  const norm = (x: number, y: number): [number, number] => {
    const d = Math.hypot(x, y);
    return d > 1e-6 ? [x / d, y / d] : [0, 0];
  };
  const [ax, ay] = norm(e.x - pet.x, e.y - pet.y);
  const [bx, by] = norm(e.x - p.x, e.y - p.y);
  let [fx, fy] = norm(ax + bx, ay + by);
  if (!fx && !fy) [fx, fy] = norm(pet.vx, pet.vy);
  if (!fx && !fy) fx = e.x >= p.x ? 1 : -1;
  e.fearDx = fx;
  e.fearDy = fy;
  e.fearUntil = Math.max(e.fearUntil ?? 0, w.time + H.flinch + dur);
  e.fear = Math.max(e.fear ?? 0, H.cut[pet.stage]);
  e.stun = Math.max(e.stun, H.flinch);
  if (pet.branch === 'broke' && pet.stage >= 1) e.broke = Math.max(e.broke ?? 0, H.broke[pet.stage]);
  if (gale) {
    const m = ENEMIES[e.kind].mass;
    e.kx += (fx * H.gale.kb) / m;
    e.ky += (fy * H.gale.kb) / m;
  }
}

/** 印记：震慑多久带多久（被相生消耗了就没了）；敌人身上已经有别的印记时不覆盖，免得冲掉玩家攒好的相生。 */
function mark(p: Player, e: Enemy, dur: number) {
  const el = HEROES[p.hero].petEl; // 宠物自己的五行（按宠物的来历定，用户 11-12）
  if (!e.mark || e.mark === el) {
    e.mark = el;
    e.markT = Math.max(e.markT, dur);
  }
}

/** 吼一声：在脚下这一点，半径 r 内（且在拴绳以内的）最近的几只被震慑；首领、正在引爆的爆符鬼不会被吓住（首领只沾印记）。 */
function roar(w: World, p: Player, pet: Pet, ev: SimEvent[]) {
  const H = HEIHU;
  const gale = pet.branch === 'gale' && pet.stage >= 1;
  const r = H.r[pet.stage] * (gale ? H.gale.r : 1) * (1 + Math.min(REACH.area, p.stats.area));
  const dur = H.fearT[pet.stage] * (gale ? H.gale.t : 1) * (1 + (p.boon?.petDur ?? 0)); // 修为「御灵」吓得久（xiuwei.ts）
  const cap = H.cap[pet.stage] + (gale ? H.gale.extra : 0);
  const keep = H.band.leash ** 2;
  buildGrid(w.enemies);
  const near = enemiesWithin(w, pet.x, pet.y, r).filter((e) => d2(e, p) <= keep);
  const got = near
    .filter((e) => e.kind !== 'boss' && e.invuln <= 0)
    .sort((a, b) => d2(a, pet) - d2(b, pet) || a.id - b.id)
    .slice(0, cap);
  for (const e of got) {
    scare(w, p, pet, e, dur);
    mark(p, e, dur);
  }
  for (const e of near) if (e.kind === 'boss') mark(p, e, dur);
  pet.hits = [1];
  ev.push({ t: 'roar', owner: p.id, x: pet.x, y: pet.y, r, ids: got.map((e) => e.id), dur, branch: pet.branch });
}

/**
 * 推进一帧。用到的 Pet 字段：mode（follow 跟着 / sweep 扑过 / return 回来）、(x, y) 脚下、(vx, vy) 速度、cd 距下一趟、
 * target 这一趟瞄的那只、(ox, oy) 瞄准点相对它的偏移、(tx, ty) 瞄准点、(ux, uy) 扑的方向、seekT 扑的时间还剩多少
 * （吼过之后变成负数，记顺势滑了多久）、wrapT 当前这一段过了多久、hits 这一趟吼过没有、ph 空闲时甩尾的相位。
 */
export function updateHeihu(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const H = HEIHU;
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
    if (t && !pet.hits.length) {
      pet.tx = t.x + pet.ox;
      pet.ty = t.y + pet.oy;
    } else if (!t) pet.target = -1;
    if (!pet.hits.length) {
      const rx = pet.tx - pet.x;
      const ry = pet.ty - pet.y;
      const passed = rx * pet.ux + ry * pet.uy < 0 || rx * rx + ry * ry < 36;
      const gone = d2({ x: pet.tx, y: pet.ty }, p) > H.band.leash ** 2;
      pet.seekT -= dt;
      if (passed || gone || pet.seekT <= 0) {
        roar(w, p, pet, ev);
        pet.seekT = -1e-9;
      } else {
        const d = Math.hypot(rx, ry) || 1;
        pet.ux = rx / d;
        pet.uy = ry / d;
        run(pet, pet.ux * H.dash, pet.uy * H.dash, DASH, dt);
      }
    }
    if (pet.hits.length) {
      // 吼过了：顺着冲势滑出去一小段（越滑越慢，不停住），然后掉头。快到拴绳的长度就提前掉头
      pet.seekT -= dt;
      const s = Math.hypot(pet.vx, pet.vy) || 1;
      run(pet, (pet.vx / s) * H.dash * 0.35, (pet.vy / s) * H.dash * 0.35, DASH, dt);
      const ox = pet.x - p.x;
      const oy = pet.y - p.y;
      const edge = Math.hypot(ox, oy) > H.band.leash - 16 && ox * pet.vx + oy * pet.vy > 0;
      if (pet.seekT < -H.through || edge) endPass(p, pet, H.band);
    }
  } else heelStep(p, pet, H.band, TROT, BACK, dt);

  // 拴在主人身边：真出了拴绳就贴在上面、掉头回来（还没吼就就地吼一声）
  if (leash(p, pet, H.band) === 'pull' && pet.mode === 'sweep') {
    if (!pet.hits.length) roar(w, p, pet, ev);
    endPass(p, pet, H.band);
  }
}
