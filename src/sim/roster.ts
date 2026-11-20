// 人员进出：中途加入、离开房间、掉线托管（联机，M2）。房主收到网络消息时从外面调，不在每帧的模拟里；
// 这三件事都只改 World 里的数据，和别的状态一样进快照（snapshot.ts），所以「先加人再存档」「恢复之后再标托管」都对得上。
// 规则和数值在 config.COOP；倒地救援、按人数加强、商店开波这些「打的时候」的规则在 coop.ts。
//
// 编号 = w.players 的下标，一直不变（输入按 inputs[id]、灵石飞向 players[pulled]、首领的危险物按位记谁被打过，都靠它）：
// 离开的人留着格子（left = true，人物从场上消失、不算人数），之后有人中途加入时复用这一格，所以最多 COOP.maxPlayers 格。
// 托管时的操作由机器人给：bot.botTurn(w, id)。
//
// 房主的主循环（net-wire 接；coop.test.ts 的 hostFrame 是一个最小的样子）：
// - 每帧：托管中的人（Player.away）的 inputs[id] 和指令用 bot.botTurn(w, id)，别人的用网络上收到的（离开的人不用给），
//   然后 step(w, inputs, commands)。这一帧的事件里有 waveStart 就 snapshot(w) 发给所有人（房主迁移用，见 snapshot.ts）。
// - 有人要进房：商店阶段 addPlayer(w, hero, ev)；别的阶段先排着，等 shopOpen 那一帧再加。有人掉线 setAway(w, id, true, ev)，
//   回来 setAway(w, id, false, ev)；有人退出 removePlayer(w, id, ev)。这几个函数发的事件放进 ev，和 step 的事件一起广播。
// - 迁移：新房主 w = restore(最近一次刚开波的快照)，setAway(w, 旧房主的编号, true)，接着跑。存档要用 snapshot（逐位精确），
//   不能用状态广播的镜像（取过整）恢复；恢复出来的那一帧的事件不会重放，表现层按状态重建画面。
import { ARENA, COOP, PLAYER } from './config.ts';
import { headcount } from './coop.ts';
import { restock } from './shop.ts';
import { newPlayer, type World } from './world.ts';
import type { HeroId, Player, SimEvent } from './types.ts';

/** 新人站在哪：在场的人身边（第一个活着的人的左右、上下，挑一个不和别人挤在一起的地方），夹在仙台以内。 */
function joinSpot(w: World): { x: number; y: number } {
  const here = w.players.filter((p) => !p.left);
  const anchor = here.find((p) => p.alive) ?? here[0];
  const pad = ARENA.pad + PLAYER.radius;
  const fit = (x: number, y: number) => ({ x: Math.max(pad, Math.min(ARENA.w - pad, x)), y: Math.max(pad, Math.min(ARENA.h - pad, y)) });
  if (!anchor) return fit(ARENA.w / 2, ARENA.h / 2);
  const offsets: [number, number][] = [
    [24, 0],
    [-24, 0],
    [0, 20],
    [0, -20],
    [24, 20],
    [-24, 20],
    [24, -20],
    [-24, -20],
  ];
  for (const [dx, dy] of offsets) {
    const q = fit(anchor.x + dx, anchor.y + dy);
    if (here.every((p) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 >= 14 * 14)) return q;
  }
  return fit(anchor.x + 24, anchor.y);
}

/**
 * 中途加入（只能在商店阶段；房间满了也不行，返回 null）：新人拿基础起手 —— 角色的专属法宝（凡品）、宠物，等级从 1 开始，
 * 灵石给在场的人（没离开的）平均数的 COOP.joinLingshi（★ 先这么定）；货架当场进好货，要自己按「出战」（coop.shopDone 会等他）。
 * 有离开的人留下的空格就复用那一格（编号是那一格的），没有就排在最后。发 join 事件；返回新人。
 * 商店阶段场上没有敌人、法宝、区域，复用空格不会把上一个人的东西算到新人头上。
 */
export function addPlayer(w: World, hero: HeroId, ev: SimEvent[] = []): Player | null {
  if (w.phase !== 'shop' || headcount(w) >= COOP.maxPlayers) return null;
  const here = w.players.filter((p) => !p.left);
  const avg = here.length ? here.reduce((s, p) => s + p.lingshi, 0) / here.length : 0;
  const slot = w.players.findIndex((p) => p.left);
  const id = slot >= 0 ? slot : w.players.length;
  const { x, y } = joinSpot(w);
  const p = newPlayer(id, hero, x, y);
  p.lingshi = Math.round(avg * COOP.joinLingshi);
  if (slot >= 0) w.players[slot] = p;
  else w.players.push(p);
  restock(w, p);
  ev.push({ t: 'join', owner: id, hero, x, y, lingshi: p.lingshi });
  return p;
}

/** 正飞向 id 这个人的灵石、掉落（收灵时）改飞给离它最近的在场的人（先挑活着的）；战斗中被他吸着的灵石松开，谁走近归谁。 */
function handOff(w: World, id: number) {
  const pool = w.players.filter((p) => !p.left && p.id !== id);
  const live = pool.filter((p) => p.alive);
  const near = (o: { x: number; y: number }) => {
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of live.length ? live : pool) {
      const d = (p.x - o.x) ** 2 + (p.y - o.y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  for (const g of w.gems) {
    if (g.pulled !== id) continue;
    const to = g.vac ? near(g) : null;
    g.pulled = to ? to.id : -1;
    g.fly = undefined; // 从现在的位置重新起飞（收灵）
  }
  for (const d of w.drops) {
    if (d.pulled !== id) continue;
    const to = near(d);
    if (to) d.pulled = to.id;
    d.fly = undefined;
  }
}

/**
 * 离开房间（任何阶段都行）：人物从场上消失，不再算人数（按人数加强、商店等谁、灵石分给谁都跟着变），他的指令不再认；
 * 格子留着（编号不变），身上的灵石、法宝跟着他走。正飞向他的灵石、掉落改给别人。他放出去的乾坤圈、飞刀、区域留着自己结束。
 * 离开之后剩下的人都倒着 / 出局了，这一帧的结尾照常判全队陨落。发 leave 事件；已经离开（或没有这个人）返回 false。
 */
export function removePlayer(w: World, id: number, ev: SimEvent[] = []): boolean {
  const p = w.players[id];
  if (!p || p.left) return false;
  p.left = true;
  p.alive = false;
  p.down = 0;
  p.rescue = 0;
  p.helpers = [];
  p.out = false;
  p.away = false;
  p.ready = false;
  handOff(w, id);
  ev.push({ t: 'leave', owner: id, x: p.x, y: p.y });
  return true;
}

/**
 * 掉线托管（away = true）/ 回来接着玩（false）。托管中的人物照常在场上打（操作由 bot.botTurn 给，房主的主循环每帧补上）、
 * 受到的伤害减半（COOP.awayHurt），商店里不等他。回来时如果正在商店，把「出战」清掉：让他自己逛、自己按（机器人可能已经替他按了）。
 * 发 away 事件；状态没变（或这个人不在了）返回 false。
 */
export function setAway(w: World, id: number, away: boolean, ev: SimEvent[] = []): boolean {
  const p = w.players[id];
  if (!p || p.left || !!p.away === away) return false;
  p.away = away;
  if (!away && w.phase === 'shop') p.ready = false;
  ev.push({ t: 'away', owner: id, away });
  return true;
}
