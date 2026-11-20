// 第二章的地形「十阵轮转」（设计见 docs/story/ch2-ch3.md；数值见 config.ts 的 TEN）。纯函数、确定性：随机数只用 w.rng。
// 场上十座阵台（阵眼），每座固定是原著十绝阵里的一座（TEN.kinds）。每隔约 12 秒在离人物近的几座里亮起 2–3 座（先预警约 2 秒），亮约 8 秒，
// 亮着时各放各的招（每一招先亮淡红光，见 config.ts 的 TEN 文件头）：
//   天绝落雷、地烈裂地喷岩火、风吼风刃扫扇面并往外推、寒冰一圈圈冒冰锥、金光加伤并冒兵、化血人和敌人都掉血、
//   烈焰火柱留火烧地、落魂魂火追人并让真气流走、红水减速掉血、红沙往阵心拖并有沙眼磨人。
// 阵的招也伤敌人（首领不吃）：引怪进阵是一种打法。金光阵边冒出来的回响兵是「刷在屏幕外」那条铁律的例外（设计如此：兵是从阵里冒出来的）。
// 状态在 w.terrain（TenTerrain，纯数据）；对外是地形模块 TEN_TERRAIN（chapters.ts 登记到第二章）。首领「十阵齐鸣」调 tenActivate。
import { ARENA, DT, ENEMIES, PLAYER } from '../config.ts';
import { waveScale } from '../catalog.ts';
import { hitEnemy, hurtPlayer, segDist, slowEnemy } from '../core.ts';
import { techSave } from '../techniques.ts';
import { downPlayer, hurtMul } from '../coop.ts';
import { heroSteady } from '../heroes/passives.ts';
import type { Spawn, TerrainModule } from '../chapters.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { TEN } from './config.ts';
import type { Site, SiteKind, Strike, StrikeKind, TenTerrain } from './types.ts';

const TAU = Math.PI * 2;

/** w.terrain 是十阵轮转的话返回它。 */
export function tenOf(w: World): TenTerrain | null {
  return w.terrain && w.terrain.kind === 'ten' ? (w.terrain as TenTerrain) : null;
}

/** 第 i 座阵台是哪一阵。 */
export const siteKind = (i: number): SiteKind => TEN.kinds[i];
/** 这一阵会伤人 / 拖人（金光阵以外都是）。 */
export const harmful = (k: SiteKind) => k !== 'gold';

const newSite = (): Site => ({ kind: null, state: 'off', t: 0, dur: 0, tick: 0, n: 0 });
const dist = (x: number, y: number, i: number) => Math.hypot(x - TEN.sites[i][0], y - TEN.sites[i][1]);
/** (x, y) 落在第 i 座阵里（脚下进了阵的圈就算）。 */
export const inSite = (x: number, y: number, i: number) => dist(x, y, i) <= TEN.r;
/** 站在 (x, y) 的人脚下亮着的那座阵（某一种；没有就是 -1）。 */
function siteAt(t: TenTerrain, x: number, y: number, kind: SiteKind): number {
  for (let i = 0; i < t.sites.length; i++) {
    const s = t.sites[i];
    if (s.state === 'on' && s.kind === kind && inSite(x, y, i)) return i;
  }
  return -1;
}
const wrap = (a: number) => {
  a %= TAU;
  return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
};

function start(w: World, ev: SimEvent[]) {
  const old = tenOf(w);
  // 换章进来（或别的地形）就新摆一份；同一章的下一波只是全部熄掉、重新计时
  if (old) {
    for (let i = 0; i < old.sites.length; i++) if (old.sites[i].state !== 'off') ev.push({ t: 'siteOff', site: i, kind: old.sites[i].kind! });
  }
  const t: TenTerrain = {
    kind: 'ten',
    sites: TEN.sites.map(newSite),
    next: TEN.first,
    strikes: [],
    drain: w.players.map(() => 0),
    drainT: w.players.map(() => 0),
    chill: w.players.map(() => 0),
  };
  w.terrain = t;
}

/** 一招（纯数据），先预警 warn 秒。 */
function addStrike(w: World, t: TenTerrain, ev: SimEvent[], o: Partial<Strike> & { site: number; kind: StrikeKind; x: number; y: number; r: number; warn: number }): Strike {
  const s: Strike = { id: w.nextId++, x1: o.x, y1: o.y, a0: 0, arc: 0, dir: 1, t: 0, live: 0, every: 0, hit: w.players.map(() => -1), foes: [], foeT: 0, ...o };
  t.strikes.push(s);
  ev.push({ t: 'tenWarn', id: s.id, site: s.site, kind: s.kind, x: s.x, y: s.y, t2: s.warn });
  return s;
}

/**
 * 亮起 n 座阵（先预警）：在熄着的阵眼里挑，偏向离人物近的；每座阵台是哪一阵是定好的（TEN.kinds）。
 * prefer：这一阵（熄着的话）一定在里面（姚天君「十阵齐鸣」必带他自己的落魂阵）。
 */
export function tenActivate(w: World, n: number, ev: SimEvent[], prefer?: SiteKind) {
  const t = tenOf(w);
  if (!t) return;
  const alive = w.players.filter((p) => p.alive);
  const cand: { i: number; wt: number }[] = [];
  for (let i = 0; i < t.sites.length; i++) {
    if (t.sites[i].state !== 'off') continue;
    let d = Infinity;
    for (const p of alive) d = Math.min(d, dist(p.x, p.y, i));
    if (!alive.length) d = TEN.near;
    cand.push({ i, wt: 1 / (1 + (d / TEN.near) ** 2) });
  }
  const light = (pick: number) => {
    const i = cand[pick].i;
    cand.splice(pick, 1);
    const s = t.sites[i];
    s.kind = siteKind(i);
    s.state = 'warn';
    s.t = 0;
    s.dur = TEN.warn;
    s.tick = 0;
    s.n = 0;
    ev.push({ t: 'siteWarn', site: i, kind: s.kind, t2: TEN.warn });
    // 红沙阵的沙眼跟着阵一起预警（阵心那一片先亮淡红光），阵亮着它就一直在
    if (s.kind === 'sand') {
      const [cx, cy] = TEN.sites[i];
      addStrike(w, t, ev, { site: i, kind: 'eye', x: cx, y: cy, r: TEN.sand.eye, warn: TEN.warn, live: TEN.on, every: TEN.sand.every });
    }
  };
  let m = 0;
  if (prefer) {
    const k = cand.findIndex((c) => siteKind(c.i) === prefer);
    if (k >= 0 && n > 0) {
      light(k);
      m++;
    }
  }
  for (; m < n && cand.length; m++) {
    let r = w.rng.next() * cand.reduce((a, c) => a + c.wt, 0);
    let pick = cand.length - 1;
    for (let c = 0; c < cand.length; c++) {
      r -= cand[c].wt;
      if (r < 0) {
        pick = c;
        break;
      }
    }
    light(pick);
  }
}

/** 击杀记给离得最近的人（同第三章的四剑轮斩）。 */
function creditTo(alive: Player[], x: number, y: number): number {
  let best = alive[0]?.id ?? 0;
  let bd = Infinity;
  for (const p of alive) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  return best;
}

/** 阵伤到敌人（地形的伤害：不打印记、不暴击；乘波次的血量倍率；首领不吃）。 */
function hitFoe(w: World, e: Enemy, dmg: number, alive: Player[], from: { x: number; y: number }, ev: SimEvent[], extra: { kb?: number; burn?: number; burnT?: number } = {}) {
  if (e.hp <= 0 || e.kind === 'boss') return;
  hitEnemy(w, e, { dmg: dmg * waveScale(w.wave).hp, by: 'ten', owner: creditTo(alive, e.x, e.y), from, canCrit: false, noMark: true, ...extra }, ev);
}

/** 阵里随便一处（离阵边留 pad）；或者 aim 的几率瞄着阵里的一个人。 */
function aimPoint(w: World, i: number, alive: Player[], aim: number, pad: number): [number, number] {
  const [cx, cy] = TEN.sites[i];
  const inside = alive.filter((p) => inSite(p.x, p.y, i));
  let x: number;
  let y: number;
  if (inside.length && w.rng.next() < aim) {
    const p = inside[Math.floor(w.rng.next() * inside.length)];
    x = p.x;
    y = p.y;
  } else {
    const a = w.rng.next() * TAU;
    const r = Math.sqrt(w.rng.next()) * (TEN.r - pad);
    x = cx + Math.cos(a) * r;
    y = cy + Math.sin(a) * r;
  }
  // 落点不出阵（招只在阵里出）
  const d = Math.hypot(x - cx, y - cy);
  const lim = TEN.r - pad;
  if (d > lim) {
    x = cx + ((x - cx) / d) * lim;
    y = cy + ((y - cy) / d) * lim;
  }
  return [x, y];
}

/** 阵里的一个人（aim 的几率；没有就是 null）所在的方向。 */
function aimAngle(w: World, i: number, alive: Player[], aim: number): number | null {
  const [cx, cy] = TEN.sites[i];
  const inside = alive.filter((p) => dist(p.x, p.y, i) <= TEN.r + PLAYER.radius);
  if (!inside.length || w.rng.next() >= aim) return null;
  const p = inside[Math.floor(w.rng.next() * inside.length)];
  return Math.atan2(p.y - cy, p.x - cx);
}

function update(w: World, alive: Player[], ev: SimEvent[], spawn: Spawn) {
  const t = tenOf(w);
  if (!t) return;
  const won = w.boss?.state === 'dead'; // 首领已经倒下：这一仗打完了，阵不再伤人（和魔气同一个口径）
  // 轮转
  t.next -= DT;
  if (t.next <= 0 && !won) {
    t.next = TEN.every;
    tenActivate(w, TEN.count[0] + (w.rng.next() < 0.5 ? 0 : 1), ev);
  }
  // 每座阵：预警 → 亮 → 熄
  for (let i = 0; i < t.sites.length; i++) {
    const s = t.sites[i];
    if (s.state === 'off') continue;
    s.t += DT;
    if (s.state === 'warn') {
      if (s.t >= s.dur) {
        s.state = 'on';
        s.t = 0;
        s.dur = TEN.on;
        s.tick = firstTick(s.kind!);
        ev.push({ t: 'siteOn', site: i, kind: s.kind!, dur: TEN.on });
      }
      continue;
    }
    if (s.t >= s.dur || won) {
      siteOff(t, i, ev);
      continue;
    }
    act(w, t, i, alive, ev, spawn);
  }
  // 出了的招：预警到时落下，持续的招接着烧 / 扫 / 追
  for (let k = t.strikes.length - 1; k >= 0; k--) {
    const s = t.strikes[k];
    const was = s.t;
    s.t += DT;
    if (s.t < s.warn) continue;
    if (was < s.warn) {
      ev.push({ t: 'tenStrike', id: s.id, site: s.site, kind: s.kind, x: s.x, y: s.y, x1: s.x1, y1: s.y1, r: s.r });
      if (!won) land(w, s, alive, ev);
    }
    const done = s.t >= s.warn + s.live;
    if (!done && !won && s.live > 0 && was >= s.warn - 1e-9) hold(w, t, s, alive, ev);
    if (done || won || s.live < 0) {
      t.strikes.splice(k, 1);
      if (s.kind === 'pillar' || s.kind === 'wisp' || s.kind === 'eye') ev.push({ t: 'tenFade', id: s.id, site: s.site, kind: s.kind, x: s.x, y: s.y });
    }
  }
  // 站在阵里的人：红水、化血掉血，冰锥冻着的慢慢缓过来，风往外推、沙往里拖，落魂阵里真气流走
  for (const p of w.players) if (t.chill[p.id] > 0) t.chill[p.id] = Math.max(0, t.chill[p.id] - DT);
  if (!won) for (const p of alive) personal(w, t, p, ev);
}

const firstTick = (k: SiteKind) => {
  switch (k) {
    case 'thunder': return TEN.thunder.first;
    case 'quake': return TEN.quake.first;
    case 'wind': return TEN.wind.first;
    case 'ice': return TEN.ice.first;
    case 'gold': return TEN.gold.first;
    case 'fire': return TEN.fire.first;
    case 'soul': return TEN.soul.first;
    case 'blood': return TEN.blood.foeEvery;
    default: return 0;
  }
};

function siteOff(t: TenTerrain, i: number, ev: SimEvent[]) {
  ev.push({ t: 'siteOff', site: i, kind: t.sites[i].kind! });
  t.sites[i] = newSite();
  // 这座阵还在烧的地、飘的魂火、沙眼一起收（还在预警的落雷之类照常落完）
  for (let k = t.strikes.length - 1; k >= 0; k--) {
    const s = t.strikes[k];
    if (s.site !== i) continue;
    if (s.kind === 'eye' || s.kind === 'wisp' || (s.kind === 'pillar' && s.t >= s.warn)) {
      t.strikes.splice(k, 1);
      ev.push({ t: 'tenFade', id: s.id, site: s.site, kind: s.kind, x: s.x, y: s.y });
    }
  }
}

/** 一座亮着的阵这一帧出招。 */
function act(w: World, t: TenTerrain, i: number, alive: Player[], ev: SimEvent[], spawn: Spawn) {
  const s = t.sites[i];
  const k = s.kind!;
  const [cx, cy] = TEN.sites[i];
  if (k === 'water') return waterEnemies(w, i);
  if (k === 'sand') return sandEnemies(w, i);
  if (k === 'wind') windEnemies(w, i);
  s.tick -= DT;
  if (s.tick > 0) return;
  switch (k) {
    case 'thunder': {
      const T = TEN.thunder;
      s.tick = T.every;
      const [x, y] = aimPoint(w, i, alive, T.aim, T.r * 0.5);
      addStrike(w, t, ev, { site: i, kind: 'bolt', x, y, r: T.r, warn: T.warn });
      break;
    }
    case 'fire': {
      const F = TEN.fire;
      s.tick = F.every;
      const [x, y] = aimPoint(w, i, alive, F.aim, F.r * 0.6);
      addStrike(w, t, ev, { site: i, kind: 'pillar', x, y, r: F.r, warn: F.warn, live: F.burn, every: F.burnEvery });
      break;
    }
    case 'quake': {
      const Q = TEN.quake;
      s.tick = Q.every;
      const aim = aimAngle(w, i, alive, Q.aim);
      const a0 = aim ?? w.rng.next() * TAU;
      for (let m = 0; m < Q.n; m++) {
        const a = a0 + (m * TAU) / Q.n + (m ? (w.rng.next() - 0.5) * 0.5 : 0);
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        addStrike(w, t, ev, { site: i, kind: 'fissure', x: cx + ux * Q.r0, y: cy + uy * Q.r0, x1: cx + ux * (TEN.r - Q.hw), y1: cy + uy * (TEN.r - Q.hw), r: Q.hw, warn: Q.warn });
      }
      s.n++;
      break;
    }
    case 'wind': {
      const W = TEN.wind;
      s.tick = W.every;
      const dir: 1 | -1 = s.n % 2 ? -1 : 1;
      const aim = aimAngle(w, i, alive, 0.8);
      // 有人在阵里：刃从人的这一侧扫过来（人在扇面的正中）；没人就随便一个方向
      const a0 = (aim ?? w.rng.next() * TAU) - (dir * W.arc) / 2;
      addStrike(w, t, ev, { site: i, kind: 'gust', x: cx, y: cy, r: TEN.r, a0, arc: W.arc, dir, warn: W.warn, live: W.sweep });
      s.n++;
      break;
    }
    case 'ice': {
      const I = TEN.ice;
      s.tick = I.every;
      const rings = I.rings[s.n % I.rings.length];
      const rot = w.rng.next() * TAU;
      for (const [rho, cnt] of rings)
        for (let m = 0; m < cnt; m++) {
          const a = rot + (m * TAU) / cnt;
          addStrike(w, t, ev, { site: i, kind: 'spike', x: cx + Math.cos(a) * rho, y: cy + Math.sin(a) * rho, r: I.r, warn: I.warn });
        }
      s.n++;
      break;
    }
    case 'soul': {
      const S = TEN.soul;
      s.tick = S.every;
      if (t.strikes.filter((q) => q.site === i && q.kind === 'wisp').length >= S.max) break;
      // 魂火从阵边离人最近的地方冒出来（附近没人就不冒）
      let best: Player | null = null;
      let bd = TEN.r + 60;
      for (const p of alive) {
        const d = dist(p.x, p.y, i);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (!best) break;
      const a = Math.atan2(best.y - cy, best.x - cx) + (w.rng.next() - 0.5) * 1.2;
      const rr = TEN.r - 6;
      addStrike(w, t, ev, { site: i, kind: 'wisp', x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, r: S.r, warn: S.warn, live: S.life });
      break;
    }
    case 'gold':
      gold(w, i, alive, ev, spawn);
      break;
    case 'blood': {
      const B = TEN.blood;
      s.tick = B.foeEvery;
      for (const e of w.enemies) {
        if (e.hp <= 0 || e.kind === 'boss' || Math.abs(e.x - cx) > TEN.r || Math.abs(e.y - cy) > TEN.r || !inSite(e.x, e.y, i)) continue;
        const pct = B.foe * B.foeEvery * (e.kind === 'elite' ? B.elite : 1);
        // 血量按敌人自己的最大气血算（已经含波次），不再乘波次倍率
        hitEnemy(w, e, { dmg: Math.max(1, e.maxHp * pct), by: 'ten', owner: creditTo(alive, e.x, e.y), from: e, canCrit: false, noMark: true }, ev);
      }
      break;
    }
  }
}

/** 一招落下的那一下（天雷、地裂、冰锥、火柱：范围里的人和敌人各挨一下；风刃、魂火、沙眼在 hold 里按帧算）。 */
function land(w: World, s: Strike, alive: Player[], ev: SimEvent[]) {
  const dmg = s.kind === 'bolt' ? TEN.thunder.dmg : s.kind === 'fissure' ? TEN.quake.dmg : s.kind === 'spike' ? TEN.ice.dmg : s.kind === 'pillar' ? TEN.fire.dmg : 0;
  if (!dmg) return;
  const by = s.kind === 'bolt' ? 'thunder' : 'ten';
  const touch = (x: number, y: number, rr: number) => (s.kind === 'fissure' ? segDist(x, y, s.x, s.y, s.x1, s.y1) : Math.hypot(x - s.x, y - s.y)) <= s.r + rr;
  for (const p of alive) {
    if (!p.alive || !touch(p.x, p.y, PLAYER.radius)) continue;
    s.hit[p.id] = w.time;
    hurtPlayer(w, p, dmg, by, ev);
    if (s.kind === 'spike') {
      const tt = tenOf(w)!;
      tt.chill[p.id] = Math.max(tt.chill[p.id] ?? 0, TEN.ice.chill);
    }
  }
  const foe = s.kind === 'bolt' ? TEN.thunder.foe : s.kind === 'fissure' ? TEN.quake.foe : s.kind === 'spike' ? TEN.ice.foe : TEN.fire.foe;
  const reach = s.kind === 'fissure' ? Math.hypot(s.x1 - s.x, s.y1 - s.y) / 2 + s.r + 12 : s.r + 12;
  const mx = (s.x + s.x1) / 2;
  const my = (s.y + s.y1) / 2;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.kind === 'boss' || Math.abs(e.x - mx) > reach || Math.abs(e.y - my) > reach) continue;
    if (!touch(e.x, e.y, ENEMIES[e.kind].radius)) continue;
    s.foes.push(e.id);
    hitFoe(w, e, foe, alive, s, ev, s.kind === 'pillar' ? { burn: TEN.fire.foeBurn, burnT: TEN.fire.burn } : s.kind === 'fissure' ? { kb: 60 } : {});
    if (s.kind === 'spike') slowEnemy(w, e, creditTo(alive, e.x, e.y), TEN.ice.foeSlow, TEN.ice.chill);
  }
}

/** 持续的招这一帧：火柱烧地、沙眼磨人、风刃扫过、魂火追人。s.live = -1 表示这一招到此为止（魂火碰到人散了）。 */
function hold(w: World, t: TenTerrain, s: Strike, alive: Player[], ev: SimEvent[]) {
  const tl = s.t - s.warn; // 生效了多久
  switch (s.kind) {
    case 'pillar':
    case 'eye': {
      const dmg = s.kind === 'pillar' ? TEN.fire.burnDmg : TEN.sand.dmg;
      for (const p of alive) {
        if (!p.alive || Math.hypot(p.x - s.x, p.y - s.y) > s.r + PLAYER.radius) continue;
        if (s.hit[p.id] >= 0 && w.time - s.hit[p.id] < s.every - 1e-9) continue;
        s.hit[p.id] = w.time;
        hurtPlayer(w, p, dmg, 'ten', ev);
      }
      if (s.kind === 'eye') {
        s.foeT -= DT;
        if (s.foeT <= 0) {
          s.foeT = s.every;
          for (const e of w.enemies) {
            if (e.hp <= 0 || e.kind === 'boss' || Math.abs(e.x - s.x) > s.r + 12 || Math.abs(e.y - s.y) > s.r + 12) continue;
            if (Math.hypot(e.x - s.x, e.y - s.y) <= s.r + ENEMIES[e.kind].radius) hitFoe(w, e, TEN.sand.foe, alive, s, ev);
          }
        }
      }
      break;
    }
    case 'gust': {
      // 刃从 a0 往 dir 扫过 arc：这一帧扫过的那一小片里的人挨一下（每人一次），被往外吹开；敌人同样
      const k0 = tl < 2 * DT ? 0 : (tl - DT) / s.live; // 第一帧从起始边算起
      const k1 = Math.min(1, tl / s.live);
      const swept = (x: number, y: number, rr: number) => {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d > s.r + rr || d < 2) return false;
        const rel = s.dir * wrap(Math.atan2(y - s.y, x - s.x) - s.a0);
        const relU = rel < -0.3 ? rel + TAU : rel; // 起始边稍后一点的也算（扫的是扇面）
        const m = rr / Math.max(d, 8);
        return relU >= k0 * s.arc - m && relU <= k1 * s.arc + m;
      };
      const W = TEN.wind;
      for (const p of alive) {
        if (!p.alive || s.hit[p.id] >= 0 || !swept(p.x, p.y, PLAYER.radius)) continue;
        s.hit[p.id] = w.time;
        hurtPlayer(w, p, W.dmg, 'ten', ev);
        if (!heroSteady(w, p)) {
          const d = Math.hypot(p.x - s.x, p.y - s.y) || 1;
          p.blowX = (p.blowX ?? 0) + ((p.x - s.x) / d) * W.blow;
          p.blowY = (p.blowY ?? 0) + ((p.y - s.y) / d) * W.blow;
        }
      }
      for (const e of w.enemies) {
        if (e.hp <= 0 || e.kind === 'boss' || s.foes.includes(e.id) || Math.abs(e.x - s.x) > s.r + 12 || Math.abs(e.y - s.y) > s.r + 12) continue;
        if (!swept(e.x, e.y, ENEMIES[e.kind].radius)) continue;
        s.foes.push(e.id);
        hitFoe(w, e, W.foe, alive, s, ev, { kb: 120 });
      }
      break;
    }
    case 'wisp': {
      const S = TEN.soul;
      const [cx, cy] = TEN.sites[s.site];
      let best: Player | null = null;
      let bd = Infinity;
      for (const p of alive) {
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best && bd > 0.5) {
        const step = Math.min(bd, S.speed * DT);
        s.x += ((best.x - s.x) / bd) * step;
        s.y += ((best.y - s.y) / bd) * step;
        s.x1 = s.x;
        s.y1 = s.y;
      }
      if (best && Math.hypot(best.x - s.x, best.y - s.y) <= s.r + PLAYER.radius) {
        hurtPlayer(w, best, S.dmg, 'ten', ev);
        s.live = -1; // 碰到人就散
      } else if (Math.hypot(s.x - cx, s.y - cy) > TEN.r + S.leash) s.live = -1; // 飘出阵太远就散
      void t;
      break;
    }
  }
}

/** 金光阵：阵边每隔一会儿冒出一只回响兵（这座阵附近最多几只），冒在离人最远的那一侧，刚冒出来愣一下。 */
function gold(w: World, i: number, alive: Player[], ev: SimEvent[], spawn: Spawn) {
  const s = tenOf(w)!.sites[i];
  const G = TEN.gold;
  s.tick = G.every;
  const [cx, cy] = TEN.sites[i];
  let near = 0;
  for (const e of w.enemies) if (e.kind === 'soldier' && e.hp > 0 && Math.hypot(e.x - cx, e.y - cy) < TEN.r + 40) near++;
  if (near >= G.max) return;
  const a0 = w.rng.next() * TAU;
  let best = { x: cx, y: cy, s: -1 };
  for (let k = 0; k < 6; k++) {
    const a = a0 + (k / 6) * TAU;
    const x = cx + Math.cos(a) * (TEN.r + 3);
    const y = cy + Math.sin(a) * (TEN.r + 3);
    let d = Infinity;
    for (const p of alive) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
    if (d > best.s) best = { x, y, s: d };
  }
  const e = spawn('soldier', best.x, best.y);
  e.stun = Math.max(e.stun, G.rise);
  ev.push({ t: 'siteSpawn', site: i, id: e.id, x: e.x, y: e.y });
}

/** 第 i 座阵里的敌人（首领不算）。 */
function* foesIn(w: World, i: number) {
  const [cx, cy] = TEN.sites[i];
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.kind === 'boss') continue;
    if (Math.abs(e.x - cx) > TEN.r || Math.abs(e.y - cy) > TEN.r || !inSite(e.x, e.y, i)) continue;
    yield e;
  }
}

/** 红水阵：走进去的敌人被拖慢（首领不吃控制、不拖）。 */
function waterEnemies(w: World, i: number) {
  for (const e of foesIn(w, i)) {
    e.slow = Math.max(e.slow, TEN.water.enemySlow);
    e.slowT = Math.max(e.slowT, 0.12);
  }
}

/** 把 (x, y) 往阵心挪 v·DT（v < 0 往外）；不挪过阵心。 */
function drift(o: { x: number; y: number }, i: number, v: number) {
  const [cx, cy] = TEN.sites[i];
  const dx = cx - o.x;
  const dy = cy - o.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return;
  const s = v > 0 ? Math.min(d, v * DT) : v * DT;
  o.x = Math.max(0, Math.min(ARENA.w, o.x + (dx / d) * s));
  o.y = Math.max(0, Math.min(ARENA.h, o.y + (dy / d) * s));
}

/** 红沙阵：阵里的敌人被拖向阵心（扎堆，正好一起打）。 */
function sandEnemies(w: World, i: number) {
  for (const e of foesIn(w, i)) drift(e, i, TEN.sand.foePull);
}
/** 风吼阵：阵里的敌人被往外推。 */
function windEnemies(w: World, i: number) {
  for (const e of foesIn(w, i)) drift(e, i, -TEN.wind.foePush);
}

/** 一个人站在阵里：红水 / 化血掉血（不吃无敌时间，同魔气；攒够 report 秒报一次 drain）、风往外推、沙往里拖、落魂阵里真气流走。 */
function personal(w: World, t: TenTerrain, p: Player, ev: SimEvent[]) {
  if (!p.alive) return;
  const id = p.id;
  const steady = heroSteady(w, p);
  for (let i = 0; i < t.sites.length; i++) {
    const s = t.sites[i];
    if (s.state !== 'on' || !inSite(p.x, p.y, i)) continue;
    if (s.kind === 'wind' && !steady) drift(p, i, -TEN.wind.push);
    else if (s.kind === 'sand' && !steady) drift(p, i, TEN.sand.pull);
    else if (s.kind === 'soul') p.skill = Math.max(0, p.skill - TEN.soul.qi * DT);
  }
  const wi = siteAt(t, p.x, p.y, 'water');
  const bi = wi < 0 ? siteAt(t, p.x, p.y, 'blood') : -1;
  const kind = wi >= 0 ? 'water' : 'blood';
  if (wi < 0 && bi < 0) {
    if (t.drain[id] >= 0.5) ev.push({ t: 'drain', owner: id, x: p.x, y: p.y, dmg: t.drain[id] });
    t.drain[id] = 0;
    t.drainT[id] = 0;
    return;
  }
  const pct = wi >= 0 ? TEN.water.drain : TEN.blood.drain;
  const dmg = p.stats.maxHp * pct * DT * hurtMul(p); // 联机：掉线托管中减半（coop.ts）
  p.hp -= dmg;
  t.drain[id] = (t.drain[id] ?? 0) + dmg;
  t.drainT[id] = (t.drainT[id] ?? 0) + DT;
  const report = TEN.water.report;
  if (t.drainT[id] >= report - 1e-9) {
    ev.push({ t: 'drain', owner: id, x: p.x, y: p.y, dmg: t.drain[id], kind });
    t.drain[id] = 0;
    t.drainT[id] = 0;
  }
  if (p.hp <= 0 && !techSave(w, p, ev)) {
    if (t.drain[id] >= 0.5) ev.push({ t: 'drain', owner: id, x: p.x, y: p.y, dmg: t.drain[id], kind });
    t.drain[id] = 0;
    t.drainT[id] = 0;
    downPlayer(w, p, ev); // 单人倒下就陨落，联机是倒地等人扶（coop.ts）
  }
}

function clear(w: World, ev: SimEvent[]) {
  const t = tenOf(w);
  if (!t) return;
  for (let i = 0; i < t.sites.length; i++) {
    const s = t.sites[i];
    if (s.state !== 'off') ev.push({ t: 'siteOff', site: i, kind: s.kind! });
    t.sites[i] = newSite();
  }
  for (const s of t.strikes) if (s.t >= s.warn && (s.kind === 'pillar' || s.kind === 'wisp' || s.kind === 'eye')) ev.push({ t: 'tenFade', id: s.id, site: s.site, kind: s.kind, x: s.x, y: s.y });
  t.strikes = [];
  for (const p of w.players) {
    if ((t.drain[p.id] ?? 0) >= 0.5) ev.push({ t: 'drain', owner: p.id, x: p.x, y: p.y, dmg: t.drain[p.id] });
    t.drain[p.id] = 0;
    t.drainT[p.id] = 0;
    t.chill[p.id] = 0;
  }
  t.next = TEN.first;
}

/** (x, y) 离这一招的判定（脚下）有多深（> 0 = 在里面；魂火往前多算它飘半秒的路）。 */
export function strikeDepth(s: Strike, x: number, y: number, rr: number): number {
  switch (s.kind) {
    case 'fissure':
      return s.r + rr - segDist(x, y, s.x, s.y, s.x1, s.y1);
    case 'gust': {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d > s.r + rr) return 0;
      const rel = s.dir * wrap(Math.atan2(y - s.y, x - s.x) - s.a0);
      const relU = rel < -0.3 ? rel + TAU : rel;
      const m = rr / Math.max(d, 8);
      const done = s.t > s.warn ? ((s.t - s.warn) / Math.max(0.01, s.live)) * s.arc : 0; // 已经扫过的那一截不危险了
      if (relU < done - m || relU > s.arc + m) return 0;
      return Math.min(s.r + rr - d, (Math.min(relU - done, s.arc - relU) + m) * Math.max(d, 8));
    }
    case 'wisp':
      return s.r + rr + TEN.soul.speed * 0.5 - Math.hypot(x - s.x, y - s.y);
    default:
      return s.r + rr - Math.hypot(x - s.x, y - s.y);
  }
}

/** 机器人躲招：(x, y) 落在危险的阵（金光以外，预警中或亮着）或阵里出的招里有多深（口径同首领的 danger）。 */
function danger(w: World, x: number, y: number, react = 0, margin = 6): number {
  const t = tenOf(w);
  if (!t) return 0;
  let s = 0;
  for (let i = 0; i < t.sites.length; i++) {
    const st = t.sites[i];
    if (st.state === 'off' || !harmful(st.kind!)) continue;
    if (st.state === 'warn' && st.t < react) continue;
    // 预警快完了才当真（刚亮的预警离落下还早，先别慌）；亮着的整座阵都算
    const k = st.state === 'on' ? 1 : Math.min(1, st.t / Math.max(0.01, st.dur) + 0.35);
    const depth = TEN.r + PLAYER.radius + margin - dist(x, y, i);
    if (depth > 0) s += k * (1 + Math.min(2, depth / 25));
  }
  for (const q of t.strikes) {
    if (q.t < react) continue;
    const depth = strikeDepth(q, x, y, PLAYER.radius + margin);
    if (depth > 0) s += 1 + Math.min(2, depth / 25);
  }
  return s;
}

/** 站在亮着的金光阵里：法宝伤害倍率。 */
function dmgMul(w: World, p: Player): number {
  const t = tenOf(w);
  return t && siteAt(t, p.x, p.y, 'gold') >= 0 ? 1 + TEN.gold.dmg : 1;
}

/** 站在亮着的红水 / 落魂 / 红沙阵里、被冰锥冻着：移速倍率（几样叠起来相乘）。 */
function speedMul(w: World, p: Player): number {
  const t = tenOf(w);
  if (!t) return 1;
  let m = 1;
  if (siteAt(t, p.x, p.y, 'water') >= 0) m *= 1 - TEN.water.slow;
  if (siteAt(t, p.x, p.y, 'soul') >= 0) m *= 1 - TEN.soul.slow;
  if (siteAt(t, p.x, p.y, 'sand') >= 0) m *= 1 - TEN.sand.slow;
  if ((t.chill[p.id] ?? 0) > 0) m *= 1 - TEN.ice.slow;
  return m;
}

/**
 * 机器人在普通波里躲地形：在危险的阵里（或贴着它的边）就往阵外走，越靠里越急（红沙阵往里拖，走得更急）；阵里出的招同理；
 * 亮着的金光阵在不远处就顺路靠过去一点（分量小，躲敌人、躲招都比它要紧）。量级和 bot-dodge.botEnemyDodge 一样。
 */
function dodge(w: World, p: Player, react: number): [number, number] {
  const t = tenOf(w);
  if (!t || !p.alive) return [0, 0];
  let ax = 0;
  let ay = 0;
  const away = (cx: number, cy: number, R: number, k0: number, k1: number) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= R) return;
    // 正好在圆心：往场心那边走
    const ux = d > 0.5 ? dx / d : ARENA.w / 2 - p.x >= 0 ? 1 : -1;
    const uy = d > 0.5 ? dy / d : 0;
    const k = k0 + k1 * (1 - d / R);
    ax += ux * k;
    ay += uy * k;
  };
  for (let i = 0; i < t.sites.length; i++) {
    const s = t.sites[i];
    if (s.state === 'off') continue;
    if (s.state === 'warn' && s.t < react) continue;
    const [cx, cy] = TEN.sites[i];
    if (s.kind === 'gold') {
      if (s.state !== 'on' || p.hp < p.stats.maxHp * 0.4) continue;
      const dx = cx - p.x;
      const dy = cy - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 150 && d > TEN.r * 0.5) {
        ax += (dx / d) * 0.02;
        ay += (dy / d) * 0.02;
      }
      continue;
    }
    away(cx, cy, TEN.r + PLAYER.radius + 10, s.kind === 'sand' ? 0.12 : 0.05, 0.22);
  }
  for (const q of t.strikes) {
    if (q.t < react) continue;
    if (q.kind === 'fissure') {
      // 离线段最近的那一点
      const vx = q.x1 - q.x;
      const vy = q.y1 - q.y;
      const L2 = vx * vx + vy * vy || 1;
      const k = Math.max(0, Math.min(1, ((p.x - q.x) * vx + (p.y - q.y) * vy) / L2));
      away(q.x + vx * k, q.y + vy * k, q.r + PLAYER.radius + 8, 0.05, 0.2);
    } else if (q.kind === 'gust') {
      if (strikeDepth(q, p.x, p.y, PLAYER.radius + 6) > 0) away(q.x, q.y, q.r + PLAYER.radius + 10, 0.08, 0.2);
    } else away(q.x, q.y, q.r + PLAYER.radius + (q.kind === 'wisp' ? 22 : 8), 0.05, 0.2);
  }
  return [ax, ay];
}

/** 十阵轮转的地形模块（chapters.ts 登记到第二章；接口见 chapters.TerrainModule）。 */
export const TEN_TERRAIN: TerrainModule = { kind: 'ten', start, update, clear, danger, dmgMul, speedMul, dodge };
