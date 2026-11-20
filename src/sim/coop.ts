// 联机（1–4 人）的规则：倒地救援、出局与归队、按人数加强、商店什么时候开下一波、灵石和经验全队共享。数值和规则说明在 config.COOP。
// 人数 > 1 时才生效；单人走的还是原来的路（倒下就陨落）：这里的每个函数在单人时什么都不改、不碰随机数、不多发事件，
// 倍率在单人时恰好是 1（乘上去一个数都不变）。
// world.ts / core.ts 只在几个地方调这里：人物倒下（downPlayer）、每帧（updateCoop）、波末（coopWaveEnd）、开波（coopWaveStart）、
// 刷怪数（spawnMul）、敌人气血（enemyHpMul）、首领上场（scaleBoss）、商店开波（shopDone）、捡到灵石（gemShares）。
// 人员进出（中途加入、离开、掉线托管）在 roster.ts —— 那些是房主从外面调的，不在每帧的模拟里。
//
// 倒地的人 alive 为 false：原来所有「只管活着的人」的地方（移动、出手、敌人追谁、首领瞄谁、刷怪围着谁、被打）自然就不管他了；
// 「全员 alive 为 false → 全队陨落」也照旧成立（所有人都倒地或出局）。他在哪一种「不在」由 down / out / left 区分。
import { ARENA, COOP, MIASMA, PLAYER } from './config.ts';
import { placePet } from './pet.ts';
import type { Player, SimEvent } from './types.ts';
import type { World } from './world.ts';

/** 还在房间里的人数（离开的不算；托管、倒地、出局的都算）。 */
export function headcount(w: World): number {
  let n = 0;
  for (const p of w.players) if (!p.left) n++;
  return n;
}

/** 是不是联机：人数 > 1 时倒地救援、按人数加强才生效。 */
export const isCoop = (w: World) => headcount(w) > 1;

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 气血打空、保命的都没救回来（world.ts 的魔气、core.hurtPlayer 调）。单人照旧倒下（之后全员倒下判负）；
 * 联机改成倒地 COOP.downT 秒，等队友来扶。
 */
export function downPlayer(w: World, p: Player, ev: SimEvent[]) {
  p.alive = false;
  if (!isCoop(w)) {
    ev.push({ t: 'down', owner: p.id, x: p.x, y: p.y });
    return;
  }
  p.hp = 0;
  p.down = COOP.downT;
  p.rescue = 0;
  p.helpers = [];
  ev.push({ t: 'down', owner: p.id, x: p.x, y: p.y, t2: COOP.downT });
}

/**
 * 每帧（world.step 里玩家都走完之后、刷怪之前）：倒地的人看身边有没有队友在扶 —— 有人扶进度往上涨、倒计时停住，扶满就起身；
 * 没人扶进度慢慢回落、倒计时接着走，走完就出局。扶的人：活着、没离开的队友（托管的机器人也算），站在 COOP.reviveR 以内。
 */
export function updateCoop(w: World, dt: number, ev: SimEvent[]) {
  for (const p of w.players) {
    if (!p.down || p.left) continue;
    keepReachable(w, p);
    const R2 = COOP.reviveR * COOP.reviveR;
    const by: number[] = [];
    for (const q of w.players) if (q !== p && q.alive && !q.left && d2(q, p) <= R2) by.push(q.id);
    const k = p.rescue ?? 0;
    if (!sameIds(by, p.helpers ?? [])) ev.push({ t: 'rescue', owner: p.id, by, k, x: p.x, y: p.y });
    p.helpers = by;
    if (by.length) {
      p.rescue = Math.min(1, k + dt / COOP.reviveT);
      if (p.rescue >= 1 - 1e-9) revive(p, by, ev);
      continue;
    }
    p.rescue = Math.max(0, k - (dt / COOP.reviveT) * COOP.decay);
    p.down -= dt;
    if (p.down <= 1e-9) goOut(p, ev, false);
  }
}

/**
 * 魔焰焚城把魔气往里压时，硬边界跟着收：倒在边上的人物跟着挪进来一点，免得队友被挡在外面够不着
 * （和 world.ts 的 clampOuter 同一条边界）。
 */
function keepReachable(w: World, p: Player) {
  const D = MIASMA.depth;
  const r = PLAYER.radius;
  const i = w.miasmaInset;
  p.x = Math.max(i.x - D + r, Math.min(ARENA.w - i.x + D - r, p.x));
  p.y = Math.max(i.y - D + r, Math.min(ARENA.h - i.y + D - r, p.y));
}

function revive(p: Player, by: number[], ev: SimEvent[]) {
  p.alive = true;
  p.down = 0;
  p.rescue = 0;
  p.helpers = [];
  p.hp = Math.max(1, Math.ceil(p.stats.maxHp * COOP.reviveHp));
  p.iframes = Math.max(p.iframes, COOP.reviveIframes);
  p.still = 0;
  ev.push({ t: 'revive', owner: p.id, by, x: p.x, y: p.y, hp: p.hp });
}

function goOut(p: Player, ev: SimEvent[], waveEnd: boolean) {
  p.down = 0;
  p.rescue = 0;
  p.helpers = [];
  p.out = true;
  ev.push(waveEnd ? { t: 'out', owner: p.id, x: p.x, y: p.y, waveEnd } : { t: 'out', owner: p.id, x: p.x, y: p.y });
}

/**
 * 波末（world.endWave，清场之前）：这一波打完，倒在地上的、出局了的人当场归队（复活），和大家一起收灵、进商店。
 * 用户 2026-11-12：「联机有队友死了，但是平定完不自动复活进入商店」——原来出局的人要等下一波开打才归队，整个商店都还是出局的样子。
 */
export function coopWaveEnd(w: World, ev: SimEvent[]) {
  for (const p of w.players) if (p.down && !p.left) goOut(p, ev, true);
  coopWaveStart(w, ev); // 出局的人现在就归队（下一波开波时就没有要归队的了）
}

/** 归队时站在队友的哪一侧（按自己的编号挑，几个人同时归队也不叠在一起）。 */
const REJOIN_AT: [number, number][] = [
  [-16, 4],
  [16, 4],
  [-16, -14],
  [16, -14],
];

/**
 * 开波（world.startWave，在每个人的开波整理之前）：出局的人归队 —— 站到最近的活着的队友身边（没有就原地，夹回仙台上），
 * 气血至少一成（商店里买了回春丹的照它）、无敌片刻；宠物跟着挪过来。
 */
export function coopWaveStart(w: World, ev: SimEvent[]) {
  for (const p of w.players) {
    if (!p.out || p.left) continue;
    let mate: Player | null = null;
    let bd = Infinity;
    for (const q of w.players) {
      if (q === p || !q.alive || q.left) continue;
      const d = d2(q, p);
      if (d < bd) {
        bd = d;
        mate = q;
      }
    }
    if (mate) {
      const [ox, oy] = REJOIN_AT[p.id % REJOIN_AT.length];
      p.x = mate.x + ox;
      p.y = mate.y + oy;
    }
    const pad = ARENA.pad + PLAYER.radius;
    p.x = Math.max(pad, Math.min(ARENA.w - pad, p.x));
    p.y = Math.max(pad, Math.min(ARENA.h - pad, p.y));
    p.px = p.x;
    p.py = p.y;
    placePet(p); // 宠物摆回身边（按种类：混天绫在身后上方，哮天犬蹲在脚边；pet.ts）
    p.out = false;
    p.alive = true;
    p.hp = Math.max(p.hp, Math.max(1, Math.ceil(p.stats.maxHp * COOP.rejoinHp)));
    p.iframes = Math.max(p.iframes, COOP.rejoinIframes);
    p.miasma = 0;
    p.still = 0;
    ev.push({ t: 'rejoin', owner: p.id, x: p.x, y: p.y, hp: p.hp });
  }
}

/**
 * 刷怪要躲开哪些人的镜头（world.step 的常规刷怪、精英、包围；铁律：敌人不能凭空出现在谁的屏幕里）：活着的人，
 * 再加上倒在地上等人扶的 —— 他的镜头还看着自己的身子。出局、离开的人不算（他们的画面跟着队友走，由表现层定）。
 * 没人倒地时（单人一直如此）原样返回 alive。
 */
export function cameras(w: World, alive: Player[]): Player[] {
  if (!w.players.some((p) => p.down && !p.left)) return alive;
  return w.players.filter((p) => p.alive || (p.down && !p.left));
}

/** 受到的伤害的倍数（core.hurtPlayer、world.ts 的魔气）：掉线托管中的人物减半（roster.setAway），别的都是 1。 */
export const hurtMul = (p: Player) => (p.away ? COOP.awayHurt : 1);

/** 打开商店时（world.openShop）倒下的人要不要就地复活：单人和首领同一帧倒下时照旧复活；出局、离开的不复活（出局的等开波归队）。 */
export const reviveAtShop = (p: Player) => !p.alive && !p.out && !p.left;

// ---------------------------------------------------------------- 按人数加强

/** n 个人时的倍率 1 + k × (n − 1)：单人恰好是 1。 */
const perHead = (w: World, k: number) => 1 + k * Math.max(0, headcount(w) - 1);
/** 敌人（首领以外，含精英、首领召出来的兵）的气血倍率：刷出来的那一刻定下（world.spawnAt）。 */
export const enemyHpMul = (w: World) => perHead(w, COOP.scale.hp);
/** 刷怪数的倍率：每秒刷多少、包围那一圈多少只（world.step）。 */
export const spawnMul = (w: World) => perHead(w, COOP.scale.spawn);
/** 首领的气血倍率。 */
export const bossHpMul = (w: World) => perHead(w, COOP.scale.boss);

/**
 * 包围（world.step，波次进行到六成时）：单人照旧在他四周围一圈「base + 波次」只。联机时按人数加强后的总数平分给每个活着的人、
 * 各围一圈 —— 原来只围第一个人，四个人时那一圈有五十多只，全压在一个人身上。
 */
export function surgeRings(w: World, alive: Player[], base: number): [Player, number][] {
  const total = base * spawnMul(w);
  if (alive.length <= 1) return alive.length ? [[alive[0], Math.round(total)]] : [];
  const each = Math.round(total / alive.length);
  return alive.map((p) => [p, each]);
}

/** 首领上场之后（world.startWave 里 startBoss 之后）：气血按人数乘。换阶段的门槛是按气血上限的比例算的，跟着一起变。单人不动。 */
export function scaleBoss(w: World) {
  const m = bossHpMul(w);
  if (m === 1 || !w.boss) return;
  const id = w.boss.id;
  const b = w.enemies.find((e) => e.id === id);
  if (b) b.hp = b.maxHp = Math.round(b.maxHp * m);
}

// ---------------------------------------------------------------- 商店与经济

/**
 * 商店阶段什么时候开下一波（world.step）：在场的人都按了「出战」。在场 = 没离开、没掉线托管；出局的人也在场 ——
 * 出局只管战斗，他下一波开始就归队，商店是他补强的地方，照常逛、照常要等他按（COOP.waitOut 改成 false 就不等他）。
 * 掉线托管的不等（机器人替他买、替他按，见 bot.botTurn）；一个在场的都没有（剩下的全在托管）就等机器人都按了。
 * 单人就是「他按了没有」，和原来一样。
 */
export function shopDone(w: World): boolean {
  let here = 0;
  let ready = 0;
  let bots = true;
  for (const p of w.players) {
    if (p.left) continue;
    if (p.away || (p.out && !COOP.waitOut)) {
      if (!p.ready) bots = false;
      continue;
    }
    here++;
    if (p.ready) ready++;
  }
  return here > 0 ? ready === here : bots;
}

/**
 * 灵石和经验全队共享（docs/design.md「经济」：避免队友抢资源，总量按人数调平）：谁捡到一颗灵石，房间里每个人（没离开的；
 * 倒地、出局、托管的也算）各得 value × share。share = 1 / 刷怪倍率 —— 人多了敌人（灵石）多几成，就按几成分，
 * 每个人的进账和单人时差不多。单人返回 [[捡到的人, value]]，和原来一样。聚灵丹的加成按各自身上的算（world.gainGem）。
 */
export function gemShares(w: World, p: Player, value: number): [Player, number][] {
  if (headcount(w) <= 1) return [[p, value]];
  const v = value / spawnMul(w);
  const out: [Player, number][] = [];
  for (const q of w.players) if (!q.left) out.push([q, v]);
  return out;
}
