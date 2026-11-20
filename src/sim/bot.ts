// 试玩机器人：纯函数，只读状态、给出指令。截图模式（?bot）和无界面的数值模拟共用。
// 策略：远离近处敌群（按距离加权）、绕场心慢慢转圈、避开场地边缘，神通充满且身边敌人够多时放。
// 首领战和地形的危险都从这一章的模块里读（chapters.ts：BossModule.danger / prefer、TerrainModule.danger / dodge）。
import { botLootPull } from './bot-loot.ts';
import { botEnemyDodge } from './bot-dodge.ts';
import { ARENA, COOP, PLAYER, REACH, SKILL } from './config.ts';
import { miasmaDepth, type Player, type PlayerInput, type World } from './world.ts';
import { bossEnemy, innerRect } from './boss.ts';
import { bossModule, guestModule, terrainModule, type BossModule } from './chapters.ts';
import { POOL } from './bosspool.ts';
import { ELIXIRS, WEAPONS } from './catalog.ts';
import { rerollCost } from './shop.ts';
import { distinctOf } from './wuxing.ts';
import { elementCounts } from './core.ts';
import { botTechnique } from './techniques.ts';
import type { Command, ShopOffer, StatId } from './types.ts';


/** 躲敌人的半径：比法宝的索敌半径小一圈，这样机器人躲的时候敌人仍在法宝够得着的地方（射程收短之后的配套）。 */
const AVOID = REACH.seek - 25;

/**
 * 联机：去扶倒地的队友。range 以内最近的那个（太远的不横穿全场去扶）；离他还有 near × 救援半径以上就往他那边走（pull 压过躲小兵），
 * 进了这一圈就照常躲 —— 躲开一点又被拉回来，人一直在救援半径里。首领战里按「离他多远」加进挑方向的分数（weight），躲招还是优先。
 */
export const BOT_RESCUE = { range: 240, near: 0.4, pull: 0.3, weight: 1.5 };

/** 要去扶的那个倒地的队友（没有就是 null）。单人永远是 null。 */
function rescueTarget(w: World, p: Player): Player | null {
  let best: Player | null = null;
  let bd = BOT_RESCUE.range * BOT_RESCUE.range;
  for (const q of w.players) {
    if (q === p || !q.down || q.left) continue;
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/**
 * 遭遇战里躲招的方向分量（没有自己的 dodge 的首领模块用：魔化哪吒、姚天君、诛仙剑灵来遭遇战时）。
 * 读模块的 danger：脚下危险就试走 16 个方向（走 POOL.bot.step 像素），往最安全的那边让；再加站位——离它远了往它那边靠
 * （法宝够不着就打不倒），贴着了往外让。量级和 bot-dodge.botEnemyDodge 一样（加在归一化之前）。
 */
function guestDodge(gm: BossModule, w: World, p: Player, react: number): [number, number] {
  const f = w.echo;
  if (!f || f.state === 'dead' || !p.alive) return [0, 0];
  const B = POOL.bot;
  let ax = 0;
  let ay = 0;
  const here = gm.danger(w, p.x, p.y, react, 7);
  if (here > 0) {
    let best = here;
    let bx = 0;
    let by = 0;
    for (const step of [B.step, B.step * 2.5]) {
      for (let k = 0; k < 16; k++) {
        const dx = Math.cos((k / 16) * Math.PI * 2);
        const dy = Math.sin((k / 16) * Math.PI * 2);
        const d = gm.danger(w, p.x + dx * step, p.y + dy * step, react, 7) + (step > B.step ? 0.15 : 0);
        if (d < best - 1e-6) {
          best = d;
          bx = dx;
          by = dy;
        }
      }
    }
    ax += bx * B.dodge;
    ay += by * B.dodge;
  }
  const e = w.enemies.find((x) => x.id === f.id);
  if (e) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > B.far) {
      const k = B.pull * Math.min(1, (d - B.far) / 60);
      ax += (dx / d) * k;
      ay += (dy / d) * k;
    } else if (d < B.near) {
      const k = B.push * (1 - d / B.near);
      ax -= (dx / d) * k;
      ay -= (dy / d) * k;
    }
  }
  return [ax, ay];
}

export function botInput(w: World, idx = 0, skill = 0.6): PlayerInput {
  const p = w.players[idx];
  // 首领战：读首领的危险物，往安全的方向走（离开突进线、横扫扇区、火轮车道、飞圈路线，别往魔气里走）。
  // 做法是试走 16 个方向（加原地不动），看走一小段之后落在多少个危险物里，再加上「离首领不远不近」「躲小兵」「别贴魔气」的偏好。
  // skill 越低反应越慢：刚出现的预警要过一会儿才「看见」。这一章有地形的话，地形的危险（落雷、红水）也算进去。
  const bm = bossModule(w);
  const boss = bm && w.boss && w.boss.state !== 'dead' ? bossEnemy(w) : null; // 首领战才走这一套；遭遇战（w.echo）走下面普通波的
  const mate = rescueTarget(w, p);
  if (bm && boss) {
    const terrain = terrainModule(w);
    const react = 0.18 + (1 - skill) * 0.3;
    const jitter = 0.25 + (1 - skill) * 0.8; // 有的预警要晚一些才注意到（走神、看小兵）
    const sp = PLAYER.speed * (1 + p.stats.speed);
    const vx = p.x - p.px;
    const vy = p.y - p.py;
    const vm = Math.hypot(vx, vy);
    const R = innerRect(w, 0);
    let bx = 0;
    let by = 0;
    let bs = Infinity;
    for (let k = -1; k < 16; k++) {
      const dx = k < 0 ? 0 : Math.cos((k / 16) * Math.PI * 2);
      const dy = k < 0 ? 0 : Math.sin((k / 16) * Math.PI * 2);
      let s = 0;
      for (const [h, wt] of [
        [0.18, 0.6],
        [0.4, 1],
        [0.75, 0.6],
      ]) {
        const qx = p.x + dx * sp * h;
        const qy = p.y + dy * sp * h;
        const d = bm.danger(w, qx, qy, react, 6, jitter);
        s += wt * 10 * (terrain ? d + terrain.danger(w, qx, qy, react, 6) : d);
        s += wt * 8 * miasmaDepth(qx, qy, w.miasmaInset);
        const edge = Math.min(qx - R.x0, R.x1 - qx, qy - R.y0, R.y1 - qy);
        if (edge < 50) s += wt * ((50 - Math.max(0, edge)) / 50) ** 2 * 2;
      }
      const qx = p.x + dx * sp * 0.4;
      const qy = p.y + dy * sp * 0.4;
      s += bm.prefer(w, qx, qy); // 站位偏好（魔化哪吒：离首领不远不近，法宝够得着、横扫和接触又不至于躲不开）
      if (mate) s += (Math.max(0, Math.hypot(qx - mate.x, qy - mate.y) - COOP.reviveR * BOT_RESCUE.near) / 60) * BOT_RESCUE.weight; // 联机：去扶倒地的队友
      for (const e of w.enemies) {
        if (e === boss) continue;
        const ed = Math.hypot(qx - e.x, qy - e.y);
        if (ed < 46) s += (1 - ed / 46) * 1.5;
      }
      if (k >= 0 && vm > 0.01) s -= 0.18 * ((dx * vx + dy * vy) / vm); // 顺着正在走的方向，少来回抖
      if (s < bs) {
        bs = s;
        bx = dx;
        by = dy;
      }
    }
    const use = p.skill >= 1 && boss.invuln <= 0 && Math.hypot(p.x - boss.x, p.y - boss.y) < SKILL.radius * 0.85;
    return { mx: bx, my: by, skill: use };
  }
  let ax = 0;
  let ay = 0;
  let near = 0;
  for (const e of w.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < AVOID * AVOID) {
      const k = 1 / Math.max(49, d2);
      ax += dx * k;
      ay += dy * k;
      if (d2 < 80 * 80) near++;
    }
  }
  // 绕场心转（切向）+ 轻微往场心收
  const cx = ARENA.w / 2 - p.x;
  const cy = ARENA.h / 2 - p.y;
  const cd = Math.hypot(cx, cy) || 1;
  ax += (-cy / cd) * 0.012 + (cx / cd) * 0.006;
  ay += (cx / cd) * 0.012 + (cy / cd) * 0.006;
  // 避开魔气：离仙台边缘 100 像素以内开始往回推，进了魔气就优先往场心退
  const wall = (d: number) => (d < 100 ? ((100 - d) / 100) ** 2 * 0.12 : 0);
  ax += wall(p.x) - wall(ARENA.w - p.x);
  ay += wall(p.y) - wall(ARENA.h - p.y);
  // 安全的时候去捡战场掉落（宝匣、蟠桃、聚灵符）
  const [lx, ly] = botLootPull(w, idx);
  ax += lx;
  ay += ly;
  // 躲新敌人的招：长矛兵的刺击线、骑兵的冲锋线、自爆鬼的炸开范围（反应快慢和首领战同一个口径）
  const [dx, dy] = botEnemyDodge(w, idx, 0.18 + (1 - skill) * 0.3);
  ax += dx;
  ay += dy;
  // 遭遇战（本章第 4 波，首领池）：躲它的招、别离它太远也别贴着（回响那一族用自己的 echoDodge，别的用通用的 guestDodge）
  const gm = guestModule(w);
  if (gm) {
    const [ex, ey] = gm.dodge ? gm.dodge(w, p, 0.18 + (1 - skill) * 0.3) : guestDodge(gm, w, p, 0.18 + (1 - skill) * 0.3);
    ax += ex;
    ay += ey;
  }
  // 地形（这一章有的话）：躲开危险的阵（落雷、红水），奖励的阵（金光）顺路就进去
  const terrain = terrainModule(w);
  if (terrain) {
    const [tx, ty] = terrain.dodge(w, p, 0.18 + (1 - skill) * 0.3);
    ax += tx;
    ay += ty;
  }
  // 躲鬼火：会在 2 秒内擦身而过的那几团，往垂直于它飞行方向的一侧让开（法宝打不散鬼火，只能躲）
  const [ox, oy] = dodgeOrbs(w, idx, 0.35 + skill * 0.5);
  ax += ox;
  ay += oy;
  if (p.miasma > 0) {
    ax = cx / cd + ax * 0.2;
    ay = cy / cd + ay * 0.2;
  }
  if (mate) {
    // 联机：去扶倒地的队友（他倒在魔气里也去，扶的那几秒掉点血）
    const dx = mate.x - p.x;
    const dy = mate.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > COOP.reviveR * BOT_RESCUE.near) {
      ax += (dx / d) * BOT_RESCUE.pull;
      ay += (dy / d) * BOT_RESCUE.pull;
    }
  }
  const m = Math.hypot(ax, ay) || 1;
  // skill 参数 0..1：越大越「会玩」（越早放神通）
  const use = p.skill >= 1 && near >= Math.round(14 - skill * 8);
  return { mx: ax / m, my: ay / m, skill: use };
}

// ---------- 掉线托管：替第 i 个人物出这一帧的操作 ----------

/**
 * 托管（联机，roster.setAway）：第 i 个人物这一帧的操作 —— 战斗时的移动和神通（botInput），商店里的指令（botShop，一帧一条）。
 * 房主的主循环每帧对托管中的人（Player.away）调一次：inputs[i] = input，commands 并进这一帧交给 step 的指令里。
 * 收灵、倒地、出局、离开、一局结束时给原地不动。纯函数，只读状态。
 */
export function botTurn(w: World, i: number): { input: PlayerInput; commands: Command[] } {
  const p = w.players[i];
  const idle: PlayerInput = { mx: 0, my: 0, skill: false };
  if (!p || p.left) return { input: idle, commands: [] };
  if (w.phase === 'shop') return { input: idle, commands: botShop(w, i) };
  if (w.phase === 'wave' && p.alive) return { input: botInput(w, i), commands: [] };
  return { input: idle, commands: [] };
}

// ---------- 商店阶段的机器人：每次调用给出一条指令 ----------

const STAT_PREF: Partial<Record<StatId, number>> = { damage: 10, haste: 9, maxHp: 8, area: 7, aff: 7, crit: 6, armor: 6, regen: 5, speed: 4, soul: 4, dodge: 4, pickup: 2, luck: 1 };

export function botShop(w: World, idx = 0): Command[] {
  const p = w.players[idx];
  if (p.ready) return [];
  const ec = elementCounts(p);
  const mainEl = (Object.keys(ec) as (keyof typeof ec)[]).sort((a, b) => ec[b] - ec[a])[0];
  if (p.petOffer) return [{ t: 'evolve', player: idx, branch: p.petOffer.includes('fire') && ec.fire >= 1 ? 'fire' : p.petOffer[0] }];
  const tech = botTechnique(w, p); // 功法：按构筑挑（techniques.ts）
  if (tech) return [{ t: 'learn', player: idx, id: tech }];
  if (p.pendingLevels > 0) {
    let best = 0;
    let bs = -1;
    p.levelOffers.forEach((o, i) => {
      const s = (STAT_PREF[o.stat] ?? 0) * o.tier + (o.stat === 'aff' && o.el === mainEl ? 6 : 0);
      if (s > bs) {
        bs = s;
        best = i;
      }
    });
    return [{ t: 'pick', player: idx, index: best }];
  }
  const score = (o: ShopOffer): number => {
    if (o.cat === 'spirit') return 100;
    if (o.cat === 'weapon') {
      const have = p.weapons.some((x) => x.kind === o.kind);
      if (have) return o.form === 'full' ? 80 : 45;
      if (p.weapons.length >= 4) return -1;
      // 五行（wuxing.ts）：稍微偏向凑成同行三件、或补齐五行俱全（件数里算宠物）
      const el = WEAPONS[o.kind].el;
      if (ec[el] + 1 >= 3 || (ec[el] === 0 && distinctOf(ec) === 4)) return 74;
      return el === mainEl ? 70 : 55;
    }
    if (o.cat === 'relic') return 30;
    if (o.cat === 'charm') return 35;
    if (o.cat === 'elixir') return ELIXIRS[o.id].now ? (p.hp < p.stats.maxHp * 0.5 ? 60 : o.id === 'dahuan' ? 20 : -1) : 15;
    return 0;
  };
  let slot = -1;
  let bs = 0;
  p.shop.forEach((o, i) => {
    if (!o || o.price > p.lingshi) return;
    const s = score(o);
    if (s > bs) {
      bs = s;
      slot = i;
    }
  });
  if (slot >= 0) return [{ t: 'buy', player: idx, slot }];
  if (p.rerolls < 2 && p.lingshi > rerollCost(w, p) + 35) return [{ t: 'reroll', player: idx }];
  return [{ t: 'ready', player: idx }];
}

/** 躲鬼火的分量：只看 2 秒内会擦到身边（14 像素内）的鬼火；skill 越高躲得越积极。 */
function dodgeOrbs(w: World, idx: number, k: number): [number, number] {
  const p = w.players[idx];
  let ax = 0;
  let ay = 0;
  for (const o of w.orbs) {
    const rx = p.x - o.x;
    const ry = p.y - 8 - o.y;
    if (rx * rx + ry * ry > 160 * 160) continue;
    const v2 = o.vx * o.vx + o.vy * o.vy;
    if (v2 < 1) continue;
    const t = (rx * o.vx + ry * o.vy) / v2; // 最接近的时刻
    if (t < 0 || t > 2) continue;
    const cx = rx - o.vx * t; // 那时人在鬼火飞行线的哪一侧
    const cy = ry - o.vy * t;
    const d = Math.hypot(cx, cy);
    if (d > 14) continue;
    const vl = Math.sqrt(v2);
    // 往垂直于飞行方向、离线更远的那一侧走；正好在线上时随便挑一侧（按鬼火 id 定，保持确定）
    let nx = cx;
    let ny = cy;
    if (d < 0.5) {
      nx = (o.id % 2 ? 1 : -1) * -o.vy / vl;
      ny = (o.id % 2 ? 1 : -1) * o.vx / vl;
    }
    const nl = Math.hypot(nx, ny) || 1;
    const urg = (1 - t / 2) * (1 - d / 14);
    ax += (nx / nl) * 0.09 * k * (0.4 + urg);
    ay += (ny / nl) * 0.09 * k * (0.4 + urg);
  }
  return [ax, ay];
}
