// 专属宠物：孙悟空 · 毫毛猴（用户 11-11 确认的设计；数值 暂拟）。无敌、不造成伤害，只给敌人上减益「戏弄」（用户：宠物突出减益，不突出输出）。
// 打法照用户给混天绫的口径（「不应该一直盯着敌人，应该通过飘过攻击」「攻击距离不能太大」），但和别的宠物不一样，毫毛猴自己不冲进敌群：
// 跟随与出手按用户 11-12 的口径（pets/heel.ts）：
// - follow 空闲：一只小猴蹲在主人身后离脚下 34–50 像素的距离带里（最近不小于 28），主人走它就蹦蹦跳跳地跟上；
// - sweep 吹毫毛：冷却好了、**它自己身边 85 像素内**有敌人就出手：它站定，拔一撮毫毛一吹（blowT 秒），吹出几只小猴分身（Pet.imps），
//   各挑一群窜过去：弯弯地从敌群里擦身掠过（不停、不盯着打），沿路离它 hitR 以内的敌人被「戏弄」，窜过头一小段就化回一根毫毛。
//   吹完它接着跟着主人。两次之间约 1.8 秒；毫毛猴自己、分身都不离主人超过 140 像素（拴绳；分身到了就散）；离主人超过 95 像素就快跑回来。
// 戏弄：出手变慢（冷却、收招按 1 − atk 的速度走：这一帧先把 atk × dt 加回去，敌人自己的循环再照常减；预警、蓄力不动，和画面对得上），
// 走路乱晃（速度只剩 walk 倍，方向左右乱摆：passives.teaseVel，world.step 的敌人循环调），被拍一下的那一刻愣一愣（打断长矛兵、骑兵的蓄力）。
// 首领不吃戏弄（它的招式节奏在 boss.ts 里），只沾印记。毫毛猴是土行宠物（用户 11-12：宠物的五行按它自己的来历定，不一定和主人相生；石猴出世，毫毛化身，生于石、长于土）：被戏弄的带上土行印记。
// 进化两条路：定身法（被戏弄的先定住片刻，每次多吹一只）、瞌睡虫（被戏弄的昏昏欲睡：出手、走路都更慢，戏弄更久）。
// 状态用的是和混天绫同一个 Pet；(x, y) 是毫毛猴脚下（贴地）。mode 'sweep' 在这里是「站定吹毫毛」，wrapT 记这一段过了多久。
import { HEROES } from '../catalog.ts';
import { ENEMIES, REACH } from '../config.ts';
import { buildGrid, enemiesWithin } from '../core.ts';
import { heelSpot, heelStep, inReach, leash, placeAtHeel, run, type Gait, type Heel } from './heel.ts';
import { densest } from '../weapons.ts';
import { teased } from '../heroes/passives.ts';
import type { Enemy, Imp, Pet, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

export const MAOHOU = {
  cd: 1.8, // 两次吹毫毛之间（从上一次吹出来算起；用户 11-12 前是 3.2，「只要范围内有敌人就自己攻击」改短；一次吹出的分身跟着少了一只）
  band: { min: 28, near: 34, rest: 40, far: 50, down: 0.12, back: 95, range: 95, leash: 140 } satisfies Heel, // 距离带、出手范围、回归距离、拴绳（分身也用它，到了就散）
  blowT: 0.4, // 站定、拔毛、吹：多久分身才窜出来
  n: [2, 2, 3, 3], // 一次吹出几只分身（各阶段；11-12 冷却 3.2 → 1.8 秒，这里 3–4 → 2–3：每秒戏弄的只数和原来差不多）
  speed: 185, // 分身窜的速度（像素 / 秒）
  turn: 9, // 分身拐弯的角速度上限（弧度 / 秒：拐得急，路线是弯的）
  life: 0.95, // 分身最多窜多久
  over: 20, // 窜过瞄准点之后再往前窜多远才散
  side: 7, // 瞄准点放在目标身边多远（几只分身从两侧擦过去，不是一头撞上）
  hitR: 11, // 分身脚下多大一片：离它这么近的敌人被戏弄（吃范围，和法宝一样最多算到 +REACH.area）
  cap: [3, 3, 4, 4], // 一只分身最多戏弄几只
  teaseT: [1.6, 1.7, 1.8, 1.9], // 戏弄多久（各阶段）
  atk: 0.45, // 出手慢多少（冷却、收招按 1 − atk 的速度走）
  walk: 0.7, // 走路只剩几成速度（方向还在乱摆）
  flinch: 0.15, // 被拍一下的那一刻愣多久（定身；首领不吃）
  hold: { root: [0, 0.5, 0.6, 0.7], extra: 1 }, // 定身法：先定住多久（各阶段；首领不吃）、每次多吹几只
  drowse: { atk: 0.25, walk: 0.2, t: 1.35 }, // 瞌睡虫：出手再慢多少、走路再慢多少、戏弄久多少倍
};

/** 跑法（heel.ts 的 Gait；小猴轻，拐得快）。回来的时候蹦得快一点。 */
const TROT: Gait = { sMax: 150, acc: 560, dec: 700, turn: 11, aLat: 1500 };
const BACK: Gait = { sMax: 190, acc: 700, dec: 760, turn: 11, aLat: 1600 };

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 开局的毫毛猴：蹲在主人身后（距离带里）。 */
export function newMaohou(x: number, y: number): Pet {
  const s = heelSpot(x, y, 1, MAOHOU.band);
  return { stage: 0, branch: null, mode: 'follow', x: s.x, y: s.y, px: s.x, py: s.y, vx: 0, vy: 0, cd: 1.6, tx: x, ty: y, ux: 1, uy: 0, ox: s.x - x, oy: s.y - y, target: -1, seekT: 0, wrapT: 0, hits: [], ph: 0, side: -1, imps: [] };
}

/** 瞬移之后（归队）：摆回主人身后，吹出去的分身散掉。 */
export function placeMaohou(p: Player) {
  placeAtHeel(p, MAOHOU.band);
  p.pet.imps = [];
}

/** 出手范围里的敌人：以毫毛猴为圆心 range 内、离主人不超过拴绳减一点（调用方先 buildGrid）。 */
const reachable = (w: World, p: Player, pet: Pet) => enemiesWithin(w, pet.x, pet.y, MAOHOU.band.range).filter(inReach(pet, p, MAOHOU.band));

const hold = (pet: Pet) => pet.branch === 'hold' && pet.stage >= 1;
const drowsy = (pet: Pet) => pet.branch === 'drowse' && pet.stage >= 1;

/** 吹毫毛：在它自己的出手范围里挑几群（彼此隔开一点，首领在就也挑上），每群一只分身，从毫毛猴身边扇形散开窜过去。 */
function blow(w: World, p: Player, pet: Pet, ev: SimEvent[]): boolean {
  const M = MAOHOU;
  const n = M.n[pet.stage] + (hold(pet) ? M.hold.extra : 0);
  buildGrid(w.enemies);
  const ok = inReach(pet, p, M.band);
  const targets = densest(w, { ...p, x: pet.x, y: pet.y }, M.band.range, n).filter(ok); // 以毫毛猴为圆心挑
  if (!targets.length) return false;
  const imps = (pet.imps ??= []);
  const ids: number[] = [];
  const ox = pet.x;
  const oy = pet.y;
  for (let i = 0; i < n; i++) {
    const t = targets[i % targets.length];
    const a0 = Math.atan2(t.y - oy, t.x - ox) + (i - (n - 1) / 2) * 0.5; // 扇形散开，再弯回去
    const id = w.nextId++;
    imps.push({ id, x: ox, y: oy, px: ox, py: oy, vx: Math.cos(a0) * M.speed * 0.7, vy: Math.sin(a0) * M.speed * 0.7, target: t.id, tx: t.x, ty: t.y, over: -1, t: 0, life: M.life, hits: [] });
    ids.push(id);
  }
  ev.push({ t: 'hair', owner: p.id, x: ox, y: oy, imps: ids });
  return true;
}

/** 戏弄一只：出手变慢、走路乱晃，愣一愣（定身法：先定住片刻）；木行印记。首领、无敌中的只沾印记。 */
function tease(w: World, p: Player, pet: Pet, e: Enemy, dur: number) {
  const M = MAOHOU;
  if (e.kind !== 'boss' && e.invuln <= 0) {
    const dz = drowsy(pet);
    e.teaseUntil = Math.max(e.teaseUntil ?? 0, w.time + dur);
    e.tease = Math.max(e.tease ?? 0, M.atk + (dz ? M.drowse.atk : 0));
    e.teaseWalk = Math.min(e.teaseWalk ?? 1, M.walk - (dz ? M.drowse.walk : 0));
    e.stun = Math.max(e.stun, hold(pet) ? M.hold.root[pet.stage] : M.flinch);
  }
  // 印记：戏弄多久带多久（被相生消耗了就没了）；敌人身上已经有别的印记时不覆盖，免得冲掉玩家攒好的相生
  const el = HEROES[p.hero].petEl; // 宠物自己的五行（按宠物的来历定，用户 11-12）
  if (!e.mark || e.mark === el) {
    e.mark = el;
    e.markT = Math.max(e.markT, dur);
  }
}

/** 一只分身推进一帧：追着瞄准点拐过去，过了就往前窜一小段；沿路戏弄脚边的敌人。返回 false = 窜完了，化回毫毛。 */
function stepImp(w: World, p: Player, pet: Pet, imp: Imp, dt: number, ev: SimEvent[]): boolean {
  const M = MAOHOU;
  imp.px = imp.x;
  imp.py = imp.y;
  imp.t += dt;
  let s = Math.hypot(imp.vx, imp.vy) || 1;
  let h = Math.atan2(imp.vy, imp.vx);
  s = Math.min(M.speed, s + 900 * dt);
  if (imp.over < 0) {
    const t = imp.target >= 0 ? w.enemies.find((e) => e.id === imp.target && e.hp > 0) : undefined;
    if (t) {
      // 瞄准点在目标身边一点（按分身 id 的奇偶分两侧），跟着它走
      const side = imp.id % 2 ? 1 : -1;
      const ux = imp.vx / s;
      const uy = imp.vy / s;
      imp.tx = t.x - uy * M.side * side;
      imp.ty = t.y + ux * M.side * side;
    } else imp.target = -1;
    const rx = imp.tx - imp.x;
    const ry = imp.ty - imp.y;
    if (rx * imp.vx + ry * imp.vy < 0 || rx * rx + ry * ry < 25) imp.over = M.over;
    else h += clamp(wrapAngle(Math.atan2(ry, rx) - h), -M.turn * dt, M.turn * dt);
  } else imp.over = Math.max(0, imp.over - s * dt);
  imp.vx = Math.cos(h) * s;
  imp.vy = Math.sin(h) * s;
  imp.x += imp.vx * dt;
  imp.y += imp.vy * dt;
  // 沿路戏弄：脚边 r 内、还没被这只分身戏弄过的（一只分身最多 cap 只）
  if (imp.hits.length < M.cap[pet.stage]) {
    const r = M.hitR * (1 + Math.min(REACH.area, p.stats.area));
    const dur = M.teaseT[pet.stage] * (drowsy(pet) ? M.drowse.t : 1) * (1 + (p.boon?.petDur ?? 0)); // 修为「御灵」戏弄得久（xiuwei.ts）
    const got: number[] = [];
    for (const e of enemiesWithin(w, imp.x, imp.y, r + 12)) {
      if (imp.hits.length >= M.cap[pet.stage]) break;
      if (imp.hits.includes(e.id) || d2(e, imp) > (r + ENEMIES[e.kind].radius * 0.5) ** 2) continue;
      imp.hits.push(e.id);
      tease(w, p, pet, e, dur);
      got.push(e.id);
    }
    if (got.length) ev.push({ t: 'tease', owner: p.id, imp: imp.id, x: imp.x, y: imp.y, ids: got, dur, branch: pet.branch });
  }
  const done = imp.over === 0 || imp.t >= imp.life || d2(imp, p) > M.band.leash * M.band.leash;
  if (done) ev.push({ t: 'impEnd', owner: p.id, imp: imp.id, x: imp.x, y: imp.y });
  return !done;
}

/**
 * 戏弄让敌人出手变慢：冷却（e.cd）、收招（rest）按 1 − tease 的速度走——这一帧先把 tease × dt 加回去，敌人自己的循环（world.step）
 * 再照常减 dt。蓄力、预警不动（和地上的预警对得上）；首领不吃。同一只一帧只算一次（teaseTick）。
 */
function teaseCooldowns(w: World, dt: number) {
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.kind === 'boss' || e.teaseTick === w.tick || !teased(w, e)) continue;
    e.teaseTick = w.tick;
    const k = (e.tease ?? 0) * dt;
    if (e.cd > 0) e.cd += k;
    if (e.act === 'rest' && (e.actT ?? 0) > 0) e.actT = (e.actT ?? 0) + k;
  }
}

/**
 * 推进一帧。用到的 Pet 字段：mode（follow 跟着 / sweep 站定吹毫毛）、(x, y) 脚下、(vx, vy) 速度、cd 距下一次吹、wrapT 这一段过了多久、
 * ph 空闲时的相位（画面用）、imps 吹出去的分身。
 */
export function updateMaohou(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const M = MAOHOU;
  const pet = p.pet;
  pet.px = pet.x;
  pet.py = pet.y;
  pet.cd -= dt;
  pet.wrapT += dt;
  pet.ph += dt;
  teaseCooldowns(w, dt);
  if ((pet.mode === 'follow' || pet.mode === 'return') && pet.cd <= 0) {
    buildGrid(w.enemies);
    if (reachable(w, p, pet).length) {
      pet.mode = 'sweep';
      pet.wrapT = 0;
    } else pet.cd = 0.2;
  }
  if (pet.mode === 'sweep') {
    // 站定（慢慢刹住），拔毛、吹
    run(pet, 0, 0, TROT, dt);
    if (pet.wrapT >= M.blowT) {
      pet.cd = blow(w, p, pet, ev) ? M.cd * (pet.stage >= 3 ? 0.88 : 1) : 0.3;
      pet.mode = 'follow';
      pet.wrapT = 0;
      pet.seekT = 1; // 吹完先按距离带重新站一下位（主人可能走开了）
    }
  } else heelStep(p, pet, M.band, TROT, BACK, dt); // 跟着 / 回来：按距离带跟着主人（heel.ts）
  // 拴在主人身边：站定吹毫毛的时候主人走远了就被拽着走；远到离谱（瞬移）就直接摆回去
  if (leash(p, pet, M.band) === 'place') pet.imps = [];
  // 分身
  if (pet.imps?.length) {
    buildGrid(w.enemies);
    pet.imps = pet.imps.filter((imp) => stepImp(w, p, pet, imp, dt, ev));
  }
}
