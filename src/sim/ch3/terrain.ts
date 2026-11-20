// 第三章的地形「四剑轮斩」（设计见 docs/story/ch2-ch3.md；数值见 config.ts 的 SWORDS）。纯函数、确定性：随机数只用 w.rng。
// 场地四角各一座剑台，台上悬着诛仙四剑。每隔约 9 秒有一把剑出鞘（四把轮着来），朝人物斩出一道剑气：
//   直线——从剑台穿过人物当时的位置一直斩到场外（往旁边让开一步就躲过）；
//   扇形——人物离那座剑台不远时，有一半改成以剑台为圆心扫过的一道扇面（往扫的反方向退一步、或往外退出半径就躲过）。
// 先在地上亮出路径约 1.5 秒（淡红光），斩过的地方伤害很高；斩过的敌人也挨一下（可以把敌人引到剑气的路上）。首领不吃。
// 本章后半（第 4 波起）有时两把剑同时出鞘、两道直线交叉着斩过人物。首领波照样轮斩，只是慢一些，首领出大招时不出鞘。
// 状态在 w.terrain（SwordTerrain，纯数据）；对外是地形模块 SWORD_TERRAIN（chapters.ts 登记到第三章）。
import { ARENA, DT, ENEMIES, MIASMA, PLAYER } from '../config.ts';
import { isBossWave, waveInChapter, waveScale } from '../catalog.ts';
import { hitEnemy, hurtPlayer, segDist } from '../core.ts';
import { range } from '../rng.ts';
import type { TerrainModule } from '../chapters.ts';
import type { Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { SWORDS } from './config.ts';
import type { SwordCut, SwordTerrain, ZhuxianFight } from './types.ts';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (k: number) => k * k * (3 - 2 * k);
/** 角度差归一到 (-π, π]。 */
export const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);

/** w.terrain 是四剑轮斩的话返回它。 */
export function swordsOf(w: World): SwordTerrain | null {
  return w.terrain && w.terrain.kind === 'swords' ? (w.terrain as SwordTerrain) : null;
}

/** 从 (x, y) 沿单位向量 (ux, uy) 走到魔气带外沿（硬边界）有多远。 */
export function rayToOuter(x: number, y: number, ux: number, uy: number): number {
  const D = MIASMA.depth;
  let t = Infinity;
  if (ux > 1e-6) t = Math.min(t, (ARENA.w + D - x) / ux);
  else if (ux < -1e-6) t = Math.min(t, (-D - x) / ux);
  if (uy > 1e-6) t = Math.min(t, (ARENA.h + D - y) / uy);
  else if (uy < -1e-6) t = Math.min(t, (-D - y) / uy);
  return Math.max(0, t === Infinity ? 0 : t);
}

/** 一道直线剑气现在还危险的那一段：[from, 终点]（沿线离起点的距离）。预警时是整条。 */
export function cutFrom(c: SwordCut): number {
  return c.t >= c.warn ? Math.max(0, c.head - 4) : 0;
}

function start(w: World, ev: SimEvent[]) {
  const old = swordsOf(w);
  if (old) for (const c of old.cuts) ev.push({ t: 'swordHome', id: c.id, sword: c.sword });
  const t: SwordTerrain = { kind: 'swords', next: SWORDS.first, order: [], last: -1, round: 0, cuts: [] };
  w.terrain = t;
}

/** 下一把出鞘的剑：四把洗过的顺序轮着来，用完再洗，不连着两次是同一把。 */
function nextSword(w: World, t: SwordTerrain): number {
  if (!t.order.length) {
    const o = [0, 1, 2, 3];
    for (let k = o.length - 1; k > 0; k--) {
      const j = Math.floor(w.rng.next() * (k + 1));
      [o[k], o[j]] = [o[j], o[k]];
    }
    if (o[0] === t.last) [o[0], o[3]] = [o[3], o[0]];
    t.order = o;
  }
  const s = t.order.shift()!;
  t.last = s;
  return s;
}

function newCut(w: World, sword: number, kind: SwordCut['kind'], g: Partial<SwordCut>): SwordCut {
  const [x0, y0] = SWORDS.altars[sword];
  return {
    id: w.nextId++,
    sword,
    kind,
    t: 0,
    warn: SWORDS.warn,
    live: 0,
    x0,
    y0,
    x1: x0,
    y1: y0,
    r: 0,
    rad: 0,
    a0: 0,
    arc: 0,
    dir: 1,
    head: 0,
    prev: 0,
    dmg: 0,
    hit: w.players.map(() => -1),
    foes: [],
    pair: -1,
    ...g,
  };
}

/** 直线：从剑台朝 (tx, ty) 一直斩到场外。 */
function lineCut(w: World, sword: number, tx: number, ty: number): SwordCut {
  const [ax, ay] = SWORDS.altars[sword];
  let dx = tx - ax;
  let dy = ty - ay;
  let d = Math.hypot(dx, dy);
  if (d < 30) {
    // 人物就站在剑台边上：朝场心斩
    dx = ARENA.w / 2 - ax;
    dy = ARENA.h / 2 - ay;
    d = Math.hypot(dx, dy) || 1;
  }
  const ux = dx / d;
  const uy = dy / d;
  const len = Math.max(d + 40, rayToOuter(ax, ay, ux, uy));
  const L = SWORDS.line;
  return newCut(w, sword, 'line', { x1: ax + ux * len, y1: ay + uy * len, r: L.hw, live: len / L.speed, dmg: L.dmg });
}

/** 扇形：以剑台为圆心，半径比人物远一点，起始边在人物身后一点，朝一边扫过去。 */
function fanCut(w: World, sword: number, tx: number, ty: number): SwordCut {
  const [ax, ay] = SWORDS.altars[sword];
  const F = SWORDS.fan;
  const d = Math.max(40, Math.hypot(tx - ax, ty - ay));
  const rad = clamp(Math.round((d + F.over) / 16) * 16, F.rad[0], F.rad[1]); // 半径取整到 16 的倍数（表现层按半径缓存纹理）
  const dir = (w.rng.next() < 0.5 ? 1 : -1) as 1 | -1;
  const lead = clamp(F.lead / d, 0.07, 0.45);
  const a0 = wrapAngle(Math.atan2(ty - ay, tx - ax) - dir * lead);
  return newCut(w, sword, 'fan', { rad, a0, arc: F.arc, dir, live: F.time, dmg: F.dmg });
}

/** 首领正在换阶段、一剑化四、四剑归阵时，剑台不出鞘（等一会儿再来）。 */
function busy(w: World): boolean {
  const f = w.boss ?? w.echo; // 当首领、来遭遇战（首领池）都一样
  if (!f || f.kind !== 'zhuxian') return false;
  return f.state === 'intro' || f.state === 'phase' || (f.state === 'cast' && (f.move === 'split' || f.move === 'walls'));
}

/** 出鞘：挑一个人（联机时随机），挑剑、挑直线还是扇形；本章后半有时两把剑交叉斩。 */
function draw(w: World, t: SwordTerrain, alive: Player[], ev: SimEvent[]) {
  const p = alive[Math.floor(w.rng.next() * alive.length)];
  const tx = p.x + range(w.rng, -SWORDS.aim, SWORDS.aim);
  const ty = p.y + range(w.rng, -SWORDS.aim, SWORDS.aim);
  t.round++;
  const cuts: SwordCut[] = [];
  const P = SWORDS.pair;
  if (!isBossWave(w.wave) && waveInChapter(w.wave) >= P.from && w.rng.next() < P.chance) {
    // 交叉斩：第一把照顺序，第二把从另外三把里挑一把，两道线在人物那里交叉得够开（不能几乎重合）
    const a = nextSword(w, t);
    const dirOf = (s: number) => Math.atan2(ty - SWORDS.altars[s][1], tx - SWORDS.altars[s][0]);
    const ok = [0, 1, 2, 3].filter((s) => {
      if (s === a) return false;
      const diff = Math.abs(wrapAngle(dirOf(s) - dirOf(a)));
      return diff >= P.minAngle && diff <= Math.PI - P.minAngle;
    });
    if (ok.length) {
      const b = ok[Math.floor(w.rng.next() * ok.length)];
      t.order = t.order.filter((s) => s !== b);
      const c1 = lineCut(w, a, tx, ty);
      const c2 = lineCut(w, b, tx, ty);
      c1.pair = c2.id;
      c2.pair = c1.id;
      cuts.push(c1, c2);
    } else cuts.push(lineCut(w, a, tx, ty));
  } else {
    const s = nextSword(w, t);
    const [ax, ay] = SWORDS.altars[s];
    const fan = Math.hypot(tx - ax, ty - ay) <= SWORDS.fan.reach && w.rng.next() < SWORDS.fan.chance;
    cuts.push(fan ? fanCut(w, s, tx, ty) : lineCut(w, s, tx, ty));
  }
  for (const c of cuts) {
    t.cuts.push(c);
    ev.push({ t: 'swordWarn', id: c.id, sword: c.sword, kind: c.kind, x: c.x0, y: c.y0, t2: c.warn, pair: c.pair });
  }
}

/** 离 (x, y) 最近的活着的人（斩死的敌人记在他名下：把敌人引到剑气上也算本事）。 */
function creditTo(w: World, alive: Player[], x: number, y: number): number {
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

/** 扇形这一帧扫过的那一片里有没有 (x, y)（身子半径 rr 和剑气有重叠就算）。 */
function inSweep(c: SwordCut, x: number, y: number, rr: number): boolean {
  const d = Math.hypot(x - c.x0, y - c.y0);
  if (d > c.rad + rr) return false;
  const rel = c.dir * wrapAngle(Math.atan2(y - c.y0, x - c.x0) - c.a0);
  const m = Math.max(0, rr - 1) / Math.max(d, 8);
  return rel >= c.prev - m && rel <= c.head + m;
}

/** 剑气这一帧扫过的地方：人挨打（每道每人一次），敌人挨一下（每只一次，首领不吃）。 */
function strike(w: World, c: SwordCut, alive: Player[], ev: SimEvent[]) {
  const ux = c.kind === 'line' ? (c.x1 - c.x0) / (Math.hypot(c.x1 - c.x0, c.y1 - c.y0) || 1) : 0;
  const uy = c.kind === 'line' ? (c.y1 - c.y0) / (Math.hypot(c.x1 - c.x0, c.y1 - c.y0) || 1) : 0;
  const ax = c.x0 + ux * Math.max(0, c.prev - 2);
  const ay = c.y0 + uy * Math.max(0, c.prev - 2);
  const bx = c.x0 + ux * c.head;
  const by = c.y0 + uy * c.head;
  const touches = (x: number, y: number, rr: number) => (c.kind === 'line' ? segDist(x, y, ax, ay, bx, by) <= c.r + rr : inSweep(c, x, y, rr));
  for (const p of alive) {
    if (!p.alive || c.hit[p.id] >= 0 || !touches(p.x, p.y, PLAYER.radius)) continue;
    c.hit[p.id] = w.time;
    hurtPlayer(w, p, c.dmg, 'sword', ev);
  }
  const foeDmg = (c.kind === 'line' ? SWORDS.line.foeDmg : SWORDS.fan.foeDmg) * waveScale(w.wave).hp;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.kind === 'boss' || c.foes.includes(e.id)) continue;
    const rr = ENEMIES[e.kind].radius;
    if (c.kind === 'line' ? Math.abs(e.x - (ax + bx) / 2) > Math.abs(bx - ax) / 2 + c.r + rr + 2 || Math.abs(e.y - (ay + by) / 2) > Math.abs(by - ay) / 2 + c.r + rr + 2 : false) continue;
    if (!touches(e.x, e.y, rr)) continue;
    c.foes.push(e.id);
    const from = c.kind === 'line' ? { x: bx - ux * 12, y: by - uy * 12 } : { x: c.x0, y: c.y0 };
    hitEnemy(w, e, { dmg: foeDmg, by: 'sword', owner: creditTo(w, alive, e.x, e.y), from, kb: 90, canCrit: false }, ev);
  }
}

function update(w: World, alive: Player[], ev: SimEvent[]) {
  const t = swordsOf(w);
  if (!t) return;
  const won = w.boss?.state === 'dead'; // 首领已经倒下：这一仗打完了，剑不再出鞘、斩出去的也不伤人（同魔气的口径）
  t.next -= DT;
  if (t.next <= 0 && !won && alive.length) {
    if (busy(w)) t.next = 0.5;
    else {
      t.next = isBossWave(w.wave) ? SWORDS.bossEvery : SWORDS.every;
      draw(w, t, alive, ev);
    }
  }
  for (let i = t.cuts.length - 1; i >= 0; i--) {
    const c = t.cuts[i];
    const was = c.t;
    c.t += DT;
    if (c.t < c.warn) continue;
    if (was < c.warn) ev.push({ t: 'swordCut', id: c.id, sword: c.sword, kind: c.kind, x: c.x0, y: c.y0 });
    const tl = c.t - c.warn;
    c.prev = c.head;
    if (c.kind === 'line') c.head = Math.min(Math.hypot(c.x1 - c.x0, c.y1 - c.y0), tl * SWORDS.line.speed);
    else c.head = c.arc * smooth(Math.min(1, tl / c.live)); // 扇形：先慢、中间快、最后收住
    if (!won) strike(w, c, alive, ev);
    if (tl >= c.live) {
      t.cuts.splice(i, 1);
      ev.push({ t: 'swordHome', id: c.id, sword: c.sword });
    }
  }
}

function clear(w: World, ev: SimEvent[]) {
  const t = swordsOf(w);
  if (!t) return;
  for (const c of t.cuts) ev.push({ t: 'swordHome', id: c.id, sword: c.sword });
  t.cuts = [];
  t.next = SWORDS.first;
  t.round = 0;
}

/**
 * 一道剑气对 (x, y) 有多危险：陷进去多深（离最近的安全边缘多远；0 = 安全）。margin 是想离边缘多远。
 * 直线：离还危险的那一段的距离；扇形：往外退出半径、退到起始边后面、越过另一头的边，取最近的（同魔化哪吒的混天绫横扫）。
 */
export function cutDepth(c: SwordCut, x: number, y: number, margin: number): number {
  const tl = c.t - c.warn;
  if (c.kind === 'line') {
    const L = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) || 1;
    const ux = (c.x1 - c.x0) / L;
    const uy = (c.y1 - c.y0) / L;
    const from = cutFrom(c);
    return c.r + PLAYER.radius + margin - segDist(x, y, c.x0 + ux * from, c.y0 + uy * from, c.x1, c.y1);
  }
  const d = Math.hypot(x - c.x0, y - c.y0);
  const out = c.rad + PLAYER.radius + margin - d;
  if (out <= 0) return 0;
  const rel = c.dir * wrapAngle(Math.atan2(y - c.y0, x - c.x0) - c.a0);
  const done = tl > 0 ? c.head : 0;
  const m = PLAYER.radius + margin;
  const mm = m / Math.max(d, 8);
  if (rel <= done - mm || rel >= c.arc + mm) return 0;
  const back = rel - done < Math.PI / 2 ? d * Math.sin(Math.max(0, rel - done)) + m : Infinity;
  const fwd = c.arc - rel < Math.PI / 2 ? d * Math.sin(Math.max(0, c.arc - rel)) + m : Infinity;
  return Math.min(out, back, fwd);
}

/** 机器人躲招：(x, y) 落在还没斩完的剑气（预警中或正在斩）里有多深（口径同首领的 danger）。 */
function danger(w: World, x: number, y: number, react = 0, margin = 6): number {
  const t = swordsOf(w);
  if (!t) return 0;
  let s = 0;
  for (const c of t.cuts) {
    if (c.t < react) continue;
    if (c.t - c.warn >= c.live) continue;
    // 预警快完了才当真（刚亮出来离斩下来还早）；斩出去的整道都算
    const k = c.t >= c.warn ? 1 : Math.min(1, c.t / c.warn + 0.35);
    const depth = cutDepth(c, x, y, margin);
    if (depth > 0) s += k * (1 + Math.min(2, depth / 25));
  }
  return s;
}

/**
 * 机器人在普通波里躲剑气：站在路径上就往外让——直线往线的两侧（人在哪一侧往哪一侧，正好在线上往场心那一侧），
 * 扇形往外退出半径或退到起始边后面（哪个近走哪个）。越靠里越急；量级和 bot-dodge.botEnemyDodge 一样。
 */
function dodge(w: World, p: Player, react: number): [number, number] {
  const t = swordsOf(w);
  if (!t || !p.alive) return [0, 0];
  let ax = 0;
  let ay = 0;
  const margin = 8;
  for (const c of t.cuts) {
    if (c.t < react || c.t - c.warn >= c.live) continue;
    const depth = cutDepth(c, p.x, p.y, margin);
    if (depth <= 0) continue;
    if (c.kind === 'line') {
      const L = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) || 1;
      const ux = (c.x1 - c.x0) / L;
      const uy = (c.y1 - c.y0) / L;
      const half = c.r + PLAYER.radius + margin;
      const side = -(p.x - c.x0) * uy + (p.y - c.y0) * ux;
      const toCenter = -(ARENA.w / 2 - c.x0) * uy + (ARENA.h / 2 - c.y0) * ux;
      const sg = Math.abs(side) > 0.5 ? Math.sign(side) : toCenter >= 0 ? 1 : -1;
      const k = 0.05 + 0.22 * Math.min(1, depth / half);
      ax += -uy * sg * k;
      ay += ux * sg * k;
    } else {
      const dx = p.x - c.x0;
      const dy = p.y - c.y0;
      const d = Math.hypot(dx, dy) || 1;
      const out = c.rad + PLAYER.radius + margin - d;
      const rel = c.dir * wrapAngle(Math.atan2(dy, dx) - c.a0);
      const done = c.t >= c.warn ? c.head : 0;
      const back = d * Math.sin(Math.max(0, Math.min(Math.PI / 2, rel - done))) + PLAYER.radius + margin;
      const k = 0.05 + 0.22 * Math.min(1, depth / 40);
      if (out <= back) {
        ax += (dx / d) * k;
        ay += (dy / d) * k;
      } else {
        // 退到起始边后面：沿切线、和扫的方向相反
        ax += (dy / d) * c.dir * k;
        ay += (-dx / d) * c.dir * k;
      }
    }
  }
  return [ax, ay];
}

/** 四剑轮斩的地形模块（chapters.ts 登记到第三章；接口见 chapters.TerrainModule）。 */
export const SWORD_TERRAIN: TerrainModule = {
  kind: 'swords',
  start,
  update: (w, alive, ev) => update(w, alive, ev),
  clear,
  danger,
  dmgMul: () => 1,
  speedMul: () => 1,
  dodge,
};

/** 状态摘要（测试比确定性用）。 */
export function swordsDigest(w: World): string {
  const t = swordsOf(w);
  if (!t) return 'noswords';
  const r = (v: number) => Math.round(v * 100);
  const parts: (string | number)[] = [r(t.next), t.order.join(''), t.last, t.round];
  for (const c of t.cuts) parts.push(c.id, c.sword, c.kind, r(c.t), r(c.x1), r(c.y1), r(c.a0), r(c.head), c.hit.join('|'), c.foes.length);
  return parts.join(',');
}
