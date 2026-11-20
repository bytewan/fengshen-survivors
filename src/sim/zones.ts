// 地面区域的结算（法宝仙品的质变）：火痕、火罩笼罩（灼烧），地裂、寒霜（减速）；
// 以及剩下 8 件公共法宝的持续效果：旋风、青莲结界、阴阳镜光束、水域、火浪、焦土、金绳（种类与字段见 types.ts 的 Zone）。
// 由 world.step 每帧调用；波次结束时 world 清空 w.zones。表现层直接读 w.zones 画。
// 区域的伤害跳字 by 'zone'，不打五行印记、不触发相生（持续伤害一律如此）；光束、火浪、旋风吹散、风雷落雷、金绳勒住
// 是法宝的直接命中（by 'beam' / 'wave' / 'gust' / 'chain' / 'rope'），照常打印记、触发相生。
// 区域不碰敌人的弹道；首领不被拉扯、不吃定身与冻结（定身、冻结走 core 的规则，拉扯在这里跳过首领、精英拉得慢）。
import { ENEMIES } from './config.ts';
import { buildGrid, elementCounts, enemiesWithin, freezeEnemy, hitEnemy, inReach, nearestEnemy, segDist, slowEnemy } from './core.ts';
import { stepZone2 } from './arti2.ts';
import type { Element, Enemy, SimEvent, WeaponKind, Zone, ZoneKind } from './types.ts';
import type { World } from './world.ts';

/** 每种区域多久结算一次、减速多少（灼烧类的每跳伤害记在 Zone.dmg 上）。tick 为 0 的种类每帧判定（光束、火浪、金绳）。 */
export const ZONE: Record<ZoneKind, { tick: number; slow: number }> = {
  fireTrail: { tick: 0.3, slow: 0 },
  fireDome: { tick: 0.3, slow: 0 },
  crack: { tick: 0.2, slow: 0.45 },
  frost: { tick: 0.2, slow: 0.4 },
  whirl: { tick: 0.4, slow: 0 }, // 仙品「定风」起：旋风期间反复伤害的间隔
  lotus: { tick: 0.4, slow: 0 }, // 荆棘刺一下的间隔
  beam: { tick: 0, slow: 0.4 }, // 光束扫到时减速（每帧判定扫过的角度）
  water: { tick: 0.3, slow: 0.55 }, // 水域：大幅减速（水行一件再 ×1.2）
  flameWave: { tick: 0, slow: 0 },
  scorch: { tick: 0.3, slow: 0 },
  rope: { tick: 0, slow: 0 },
  // 再加的 11 件（结算在 sim/arti2.ts；tick 在那边自己管）
  vajra: { tick: 0.1, slow: 0 },
  orbit: { tick: 0, slow: 0 },
  banner: { tick: 0, slow: 0 },
  blaze: { tick: 0.3, slow: 0 }, // 离地焰光旗「焚城」的火海：走默认的灼烧（和火痕、火罩一样）
  crows: { tick: 0, slow: 0 },
  surge: { tick: 0, slow: 0 },
  net: { tick: 0, slow: 0 },
  sweep: { tick: 0, slow: 0 },
  umbrella: { tick: 0, slow: 0 },
  coin: { tick: 0, slow: 0 },
};

/**
 * 剩下 8 件公共法宝的区域在结算时用到的常数。放出时随品阶 / 器灵 / 范围变化的数值（半径、时长、拉扯速度、伤害）
 * 在 weapons.TUNE 里算好记在区域对象上；这里是各种区域自己的打法。
 */
export const ZONE_FX = {
  whirl: {
    cap: [0, 6, 7, 6, 7], // 2026-11-11 再各 +1（见 weapons.TUNE.dingfeng.r）；2026-11-11 凡 4 → 5、灵 5 → 6（凡 / 灵品群伤偏低）； 一次最多卷住几只（木行一件再 +1：定风珠自己就是木行，所以实际是 5 / 6 / 6 / 7）；吹散只打卷住的（和风里的首领）。只卷离人物 REACH.max 以内的，所以多卷一只补回来
    burst: 0.85, // 首领卷不动：吹散时离中心这么远（相对卷人的半径）以内的首领也挨一下
    kb: 230, // 吹散的击退
    chip: 0.095, // 2026-11-11 0.08 → 0.095（单发倍率降了，旋风期间的那几下补回来）；仙品「定风」：旋风期间每 tick 对卷住的敌人的伤害（相对吹散的一下）
    drift: 34, // 仙品：追着敌群移动的速度（像素 / 秒）
    follow: 1.6, // 仙品：看多大范围里的敌群（相对卷人的半径）
    calm: 1.6, // 器灵「定海」：定身多久
    eye: 3.0, // 2026-11-11 2.5 → 3.0；风眼：吹散时离中心最近的那一只吃这一倍数（卷得越少越集中：单个精英也吹得动）
    thunder: { every: 0.45, hops: 2, hop: 52, dmg: 0.32, stun: 0.12 }, // 器灵「风雷」：落雷间隔、连跳几次（木行一件再 +1）、跳多远、伤害
  },
  lotus: { report: 0.5 }, // 回血多久报一次 heal 事件
  beam: { slowT: 2, freeze: 1.1, demon: 1.25, core: 1.6, edge: 0.7 }, // 光束减速多久；仙品两道都照到冻住多久；器灵「照妖」对精英与首领的倍率；；core 1.8 → 1.6、edge 0.6 → 0.7（2026-11-11：贴身的精英吃得太狠，单体比中位数高六成，首领在光束尽头又偏低）
  // 近处最亮：贴着镜子的吃 core 倍（原来 2.2），往外线性降到光束尽头的 edge 倍
  water: { freeze: 1.6, core: 2, edge: 0.5 }, // 器灵「寒潭」：结束时冻住多久；水深：正中吃 core 倍，往外线性降到岸边的 edge 倍
  flameWave: { speed: 230, kb: 170, burn: 0.4, burnT: 2.5, fade: 0.35, core: 1.6, edge: 0.9 }, // 火线推进的速度、击退、点燃（每秒为这一下的 40%）、；core 1.5 → 1.6（2026-11-11：扇子跟前的单体偏低）
  // 推到头之后留多久淡出；越推越弱：扇子跟前吃 core 倍，推到头 edge 倍（原来 0.7：首领总在火浪的尽头）
};

/** 区域是哪件法宝放的（zone / zoneEnd 事件带上）。旧的四种不发这两个事件。 */
export const ZONE_WEAPON: Partial<Record<ZoneKind, WeaponKind>> = {
  whirl: 'dingfeng',
  lotus: 'qinglian',
  beam: 'yinyang',
  water: 'xuanyuan',
  flameWave: 'wuhuo',
  scorch: 'wuhuo',
  rope: 'kunxian',
  vajra: 'xiangmo',
  orbit: 'jinjiao',
  banner: 'yanguang',
  crows: 'wanya',
  surge: 'sihai',
  net: 'wulu',
  sweep: 'miaoshu',
  umbrella: 'wenhuang',
  coin: 'luobao',
};

/** 同一个人同一种区域最多同时存在几块（多了先收掉最早的几块，免得满地都是）。 */
export const ZONE_CAP = 8;
/** 提前收掉的区域淡出多久（表现层看 life - t 淡出，不是一下子消失）。 */
export const ZONE_FADE = 0.4;

/**
 * 新放一块区域。第一次结算在 0.05 秒后（放下去就生效）。同一个人同一种还没在收尾的区域已经有 ZONE_CAP 块了，
 * 就把最早的几块提前收尾，放下这一块后正好 ZONE_CAP 块。已经在收尾（剩不到 ZONE_FADE 秒）的不算：
 * 原来只收最早的那一块，它淡出的那 0.4 秒里下一块又挑中它，上限等于没有（高攻速的梨花枪铺出过 27 道火痕）。
 */
export function addZone(w: World, z: Omit<Zone, 'id' | 't' | 'tick'>): Zone {
  const zone: Zone = { id: w.nextId++, t: 0, tick: 0.05, ...z };
  const live = w.zones.filter((o) => o.owner === z.owner && o.kind === z.kind && o.life - o.t > ZONE_FADE);
  if (live.length >= ZONE_CAP) {
    live.sort((a, b) => b.t - a.t); // 最早放下的在前
    for (const o of live.slice(0, live.length - ZONE_CAP + 1)) o.life = Math.min(o.life, o.t + ZONE_FADE);
  }
  w.zones.push(zone);
  return zone;
}

/** 角度差，落在 (-π, π]。 */
export const angDiff = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/** 点在不在扇面里（圆心 (x, y)、朝 a、半张角 arc、半径 r；bodyR：身子大一点也算碰到）。 */
export function inSector(x0: number, y0: number, a: number, arc: number, r: number, x: number, y: number, bodyR = 0) {
  const d = Math.hypot(x - x0, y - y0);
  if (d > r + bodyR) return false;
  if (d <= bodyR) return true; // 身子罩住了扇子的根部：怎么扇都碰得到
  return Math.abs(angDiff(Math.atan2(y - y0, x - x0), a)) <= arc + Math.atan2(bodyR, d);
}

/** 敌人站没站在区域里：圆形看圆心距离，火痕看到线段的距离，扇面看角度，光束看到光束的距离；敌人的身子大一点也算踩到。 */
export function inZone(z: Zone, x: number, y: number, bodyR = 0) {
  const r = z.r + bodyR * 0.5;
  if (z.kind === 'fireTrail') return segDist(x, y, z.x, z.y, z.x2, z.y2) <= r;
  if (z.kind === 'flameWave') return inSector(z.x, z.y, z.a ?? 0, z.arc ?? 0, z.r, x, y, bodyR * 0.5);
  if (z.kind === 'scorch') return segDist(x, y, z.x, z.y, z.x2, z.y2) <= r;
  if (z.kind === 'beam') {
    const a = z.a ?? 0;
    const len = z.len ?? 0;
    return segDist(x, y, z.x, z.y, z.x + Math.cos(a) * len, z.y + Math.sin(a) * len) <= r;
  }
  if (z.kind === 'rope') return false;
  return (x - z.x) ** 2 + (y - z.y) ** 2 <= r * r;
}

export function updateZones(w: World, dt: number, ev: SimEvent[]) {
  if (!w.zones.length) return;
  buildGrid(w.enemies);
  for (let i = w.zones.length - 1; i >= 0; i--) {
    const z = w.zones[i];
    z.t += dt;
    const fx = FX[z.kind];
    if (fx) {
      // 剩下 8 件公共法宝的区域：各有各的打法，到时收招、发 zoneEnd
      fx.step(w, z, dt, ev);
      if (z.t >= z.life) {
        const end = fx.end?.(w, z, ev) ?? {};
        ev.push({ t: 'zoneEnd', id: z.id, zone: z.kind, owner: z.owner, x: z.x, y: z.y, r: z.r, kind: ZONE_WEAPON[z.kind]!, tier: z.tier, ...end });
        const j = w.zones.indexOf(z); // 收招时可能新放了区域（焚风的焦土），下标按对象重新找
        if (j >= 0) w.zones.splice(j, 1);
      }
      continue;
    }
    // 九龙神火罩的笼罩跟着主人走
    if (z.kind === 'fireDome') {
      const p = w.players[z.owner];
      if (p?.alive) {
        z.x = z.x2 = p.x;
        z.y = z.y2 = p.y;
      }
    }
    z.tick -= dt;
    if (z.tick <= 0 && z.t <= z.life) {
      const spec = ZONE[z.kind];
      z.tick += spec.tick;
      const cxz = (z.x + z.x2) / 2;
      const cyz = (z.y + z.y2) / 2;
      const reach = Math.hypot(z.x2 - z.x, z.y2 - z.y) / 2 + z.r + 12;
      for (const e of enemiesWithin(w, cxz, cyz, reach)) {
        if (!inZone(z, e.x, e.y, ENEMIES[e.kind].radius)) continue;
        if (spec.slow > 0) slowEnemy(w, e, z.owner, spec.slow, spec.tick + 0.25);
        if (z.dmg > 0) {
          // 几块火痕 / 火罩叠在一起只算一块：同一只敌人每 tick 秒最多被烫一次
          if (e.zoneT !== undefined && w.time - e.zoneT < spec.tick - 1e-6) continue;
          e.zoneT = w.time;
          hitEnemy(w, e, { dmg: z.dmg, by: 'zone', owner: z.owner, from: { x: cxz, y: cyz }, el: 'fire', canCrit: false }, ev);
        }
      }
    }
    if (z.t >= z.life) w.zones.splice(i, 1);
  }
}

// ---------- 剩下 8 件公共法宝的区域 ----------

type End = { effect?: 'gust' | 'root' | 'freeze'; ids?: number[] };
const FX: Partial<Record<ZoneKind, { step: (w: World, z: Zone, dt: number, ev: SimEvent[]) => void; end?: (w: World, z: Zone, ev: SimEvent[]) => End }>> = {
  whirl: { step: stepWhirl, end: endWhirl },
  lotus: { step: stepLotus },
  beam: { step: stepBeam },
  water: { step: stepWater, end: endWater },
  flameWave: { step: stepWave, end: endWave },
  scorch: { step: stepScorch },
  rope: { step: stepRope },
  // 再加的 11 件：sim/arti2.ts
  vajra: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  orbit: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  banner: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  crows: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  surge: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  net: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  sweep: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  umbrella: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
  coin: { step: (w, z, dt, ev) => stepZone2(w, z, dt, ev) },
};

/**
 * 区域的持续伤害（by 'zone'：不打印记、不触发相生、不暴击）。同一种区域叠在一起只算一块：
 * 灼烧类（火痕、火罩、焦土）共用一个计时，别的种类各算各的。
 */
function zoneHurt(w: World, z: Zone, e: Enemy, dmg: number, el: Element, ev: SimEvent[]) {
  if (dmg <= 0) return;
  const tick = ZONE[z.kind].tick;
  if (el === 'fire') {
    if (e.zoneT !== undefined && w.time - e.zoneT < tick - 1e-6) return;
    e.zoneT = w.time;
  } else {
    const last = e.zoneHit?.[z.kind];
    if (last !== undefined && w.time - last < tick - 1e-6) return;
    (e.zoneHit ??= {})[z.kind] = w.time;
  }
  hitEnemy(w, e, { dmg, by: 'zone', owner: z.owner, from: z, el, canCrit: false }, ev);
}

/** 把 (x, y) 半径 r 内的敌人往中心拉（像素 / 秒）。 */
function pullIn(w: World, x: number, y: number, r: number, speed: number, dt: number) {
  if (speed <= 0) return;
  for (const e of enemiesWithin(w, x, y, r + 4)) pullOne(e, x, y, speed, dt);
}
/** 拉一只：首领和无敌的（点着了引信的爆符鬼「不吃控制」）拉不动；越重的拉得越慢（÷√质量：精英、盾兵大约一半、四成）。 */
function pullOne(e: Enemy, x: number, y: number, speed: number, dt: number) {
  if (e.kind === 'boss' || e.invuln > 0) return;
  const k = Math.min(1, 1 / Math.sqrt(ENEMIES[e.kind].mass));
  const dx = x - e.x;
  const dy = y - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) return;
  const s = Math.min(d - 1.5, speed * k * dt);
  e.x += (dx / d) * s;
  e.y += (dy / d) * s;
}

const area = (w: World, z: Zone) => 1 + (w.players[z.owner]?.stats.area ?? 0);

// 定风珠旋风：卷 → （仙品）追着敌群走、反复伤害、（风雷）落雷 → 吹散 / （定海）定身
function stepWhirl(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const W = ZONE_FX.whirl;
  buildGrid(w.enemies);
  z.px = z.x;
  z.py = z.y;
  if (z.tier >= 3) {
    const keep = inReach(w.players[z.owner]);
    const around = enemiesWithin(w, z.x, z.y, z.r * W.follow).filter(keep); // 只追画面里（离人物 REACH.max 以内）的敌群
    if (around.length) {
      let sx = 0;
      let sy = 0;
      for (const e of around) {
        sx += e.x;
        sy += e.y;
      }
      const dx = sx / around.length - z.x;
      const dy = sy / around.length - z.y;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const s = Math.min(d, W.drift * dt);
        z.x = z.x2 = z.x + (dx / d) * s;
        z.y = z.y2 = z.y + (dy / d) * s;
      }
    }
  }
  // 卷：旋风一次最多卷住 cap 只（木行一件「聚怪目标 +1」，定风珠自己就是木行），卷住的被往中心拉；卷住的死了就再卷新的
  const caught = whirlCatch(w, z);
  for (const e of caught) pullOne(e, z.x, z.y, z.pull ?? 0, dt);
  buildGrid(w.enemies);
  z.tick -= dt;
  if (z.tick <= 0) {
    z.tick += ZONE.whirl.tick;
    // 仙品「定风」：期间反复伤害卷住的；首领卷不动，站在风里照样挨风刃（同吹散、风雷）
    if (z.tier >= 3) for (const e of whirlTargets(w, z, z.r)) if (e.hp > 0) zoneHurt(w, z, e, z.dmg * W.chip, 'wood', ev);
  }
  if (z.spirit === 'thunder') {
    z.tick2 = (z.tick2 ?? W.thunder.every * 0.5) - dt;
    if (z.tick2 <= 0) {
      z.tick2 += W.thunder.every;
      whirlThunder(w, z, ev);
    }
  }
}

/** 旋风卷住的敌人（z.ids）：去掉死了的，还有空位就从半径内挑最近的补上（首领、点着了的爆符鬼卷不动）。 */
function whirlCatch(w: World, z: Zone): Enemy[] {
  const W = ZONE_FX.whirl;
  const ids = (z.ids ??= []);
  const caught: Enemy[] = [];
  for (const id of ids) {
    const e = w.enemies.find((o) => o.id === id && o.hp > 0);
    if (e) caught.push(e);
  }
  const p = w.players[z.owner];
  const cap = W.cap[z.tier] + (p && elementCounts(p).wood >= 1 ? 1 : 0);
  if (caught.length < cap) {
    const keep = inReach(p); // 只卷离人物 REACH.max 以内的
    const fresh = enemiesWithin(w, z.x, z.y, z.r)
      .filter((e) => e.kind !== 'boss' && e.invuln <= 0 && !ids.includes(e.id) && keep(e))
      .sort((a, b) => (a.x - z.x) ** 2 + (a.y - z.y) ** 2 - ((b.x - z.x) ** 2 + (b.y - z.y) ** 2));
    for (const e of fresh) {
      if (caught.length >= cap) break;
      caught.push(e);
    }
  }
  z.ids = caught.map((e) => e.id);
  return caught;
}

/** 旋风卷不动首领，但首领站在风里照样挨风刃、挨雷：卷住的 + 风里的首领。 */
function whirlTargets(w: World, z: Zone, r: number): Enemy[] {
  const out = whirlCatch(w, z);
  for (const e of enemiesWithin(w, z.x, z.y, r)) if (e.kind === 'boss') out.push(e);
  return out;
}

/** 器灵「风雷」：旋风里随机一只挨雷（卷住的或风里的首领），再在敌人之间连跳（木行一件 +1 跳，定风珠自己就是木行；只跳到离人物 REACH.max 以内的）。 */
function whirlThunder(w: World, z: Zone, ev: SimEvent[]) {
  const T = ZONE_FX.whirl.thunder;
  buildGrid(w.enemies);
  const inside = whirlTargets(w, z, z.r);
  if (!inside.length) return;
  const p = w.players[z.owner];
  const ec = p ? elementCounts(p) : null;
  const n = 1 + T.hops + (ec && ec.wood >= 1 ? 1 : 0);
  let cur: Enemy | null = inside[Math.floor(w.rng.next() * inside.length)];
  const used = new Set<number>();
  const pts: [number, number][] = [[z.x, z.y - 46]];
  for (let j = 0; j < n && cur; j++) {
    used.add(cur.id);
    pts.push([cur.x, cur.y - 8]);
    hitEnemy(w, cur, { dmg: z.dmg * T.dmg, by: 'chain', owner: z.owner, from: cur, el: 'wood', stun: T.stun }, ev);
    cur = nearestEnemy(w, cur.x, cur.y, T.hop * area(w, z), used, inReach(p));
  }
  ev.push({ t: 'chain', owner: z.owner, pts, kind: 'dingfeng', tier: z.tier });
}

function endWhirl(w: World, z: Zone, ev: SimEvent[]): End {
  const W = ZONE_FX.whirl;
  buildGrid(w.enemies);
  const calm = z.spirit === 'calm';
  const ids: number[] = [];
  const caught = whirlTargets(w, z, z.r * W.burst);
  // 风眼：离中心最近的那一只吹得最狠
  let eye: Enemy | null = null;
  for (const e of caught) if (!eye || (e.x - z.x) ** 2 + (e.y - z.y) ** 2 < (eye.x - z.x) ** 2 + (eye.y - z.y) ** 2) eye = e;
  for (const e of caught) {
    ids.push(e.id);
    hitEnemy(w, e, { dmg: z.dmg * (e === eye ? W.eye : 1), by: 'gust', owner: z.owner, from: z, el: 'wood', kb: calm ? 0 : W.kb, stun: calm ? W.calm : 0 }, ev);
  }
  return { effect: calm ? 'root' : 'gust', ids };
}

// 青莲结界：站在里面的玩家回血（「莲台」再加闪避，见 core.hurtPlayer）；进来的敌人被荆棘刺伤；仙品起跟着主人走
function stepLotus(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const p = w.players[z.owner];
  z.px = z.x;
  z.py = z.y;
  if (z.tier >= 3 && p?.alive) {
    z.x = z.x2 = p.x;
    z.y = z.y2 = p.y;
  }
  for (const q of w.players) {
    if (!q.alive || (q.x - z.x) ** 2 + (q.y - z.y) ** 2 > z.r * z.r) continue;
    const h = Math.min(q.stats.maxHp - q.hp, (z.heal ?? 0) * dt);
    if (h <= 0) continue;
    q.hp += h;
    if (q.id === z.owner) z.acc = (z.acc ?? 0) + h;
  }
  z.tick2 = (z.tick2 ?? ZONE_FX.lotus.report) - dt;
  if (z.tick2 <= 0) {
    z.tick2 += ZONE_FX.lotus.report;
    if (p && (z.acc ?? 0) >= 0.05) ev.push({ t: 'heal', owner: z.owner, x: p.x, y: p.y, amount: z.acc!, kind: 'qinglian', tier: z.tier });
    z.acc = 0;
  }
  z.tick -= dt;
  if (z.tick <= 0) {
    z.tick += ZONE.lotus.tick;
    buildGrid(w.enemies);
    for (const e of enemiesWithin(w, z.x, z.y, z.r + 6)) if (inZone(z, e.x, e.y, ENEMIES[e.kind].radius)) zoneHurt(w, z, e, z.dmg, 'wood', ev);
  }
}

/** 光束：a 在 life 秒内从 from 扫到 to（两头慢、中间快），扫过的敌人各打一次；两道都照到的（仙品）冻住。 */
function stepBeam(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const B = ZONE_FX.beam;
  const p = w.players[z.owner];
  z.px = z.x;
  z.py = z.y;
  if (p?.alive) {
    z.x = z.x2 = p.x;
    z.y = z.y2 = p.y - 8;
  }
  const from = z.from ?? 0;
  const to = z.to ?? 0;
  const k = Math.min(1, z.t / z.life);
  const ease = k * k * (3 - 2 * k);
  const prev = z.a ?? from;
  const cur = from + (to - from) * ease;
  z.pa = prev;
  z.a = cur;
  const lo = Math.min(prev, cur);
  const span = Math.abs(cur - prev);
  const len = z.len ?? 0;
  const hit = (z.hit ??= []);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, z.x, z.y, len + 12)) {
    if (hit.includes(e.id)) continue;
    const br = ENEMIES[e.kind].radius;
    const ex = e.x;
    const ey = e.y - 6;
    const d = Math.hypot(ex - z.x, ey - z.y);
    if (d > len + br) continue;
    // 扫过的角度区间 [lo, lo + span]，两边各放宽光束半宽 + 身子
    const tol = Math.atan2(z.r + br, Math.max(d, 1));
    const off = (((Math.atan2(ey - z.y, ex - z.x) - lo) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (!(off <= span + tol || off >= Math.PI * 2 - tol)) continue;
    hit.push(e.id);
    const twin = z.twin !== undefined ? w.zones.find((o) => o.id === z.twin) : undefined;
    const both = !!twin?.hit?.includes(e.id);
    const k = B.core - (B.core - B.edge) * Math.min(1, d / Math.max(1, len));
    hitEnemy(w, e, { dmg: z.dmg * k, by: 'beam', owner: z.owner, from: z, el: 'water', vsElite: z.spirit === 'demon' ? B.demon : undefined, freeze: both ? B.freeze : undefined }, ev);
    if (e.hp > 0) slowEnemy(w, e, z.owner, ZONE.beam.slow, B.slowT);
  }
}

// 玄元控水旗水域：减速 + 持续受伤；仙品起漩涡往中心吸；「寒潭」结束时冻住里面的
function stepWater(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  buildGrid(w.enemies);
  if (z.pull) {
    pullIn(w, z.x, z.y, z.r, z.pull, dt);
    buildGrid(w.enemies);
  }
  z.tick -= dt;
  if (z.tick > 0) return;
  z.tick += ZONE.water.tick;
  const X = ZONE_FX.water;
  for (const e of enemiesWithin(w, z.x, z.y, z.r + 6)) {
    if (!inZone(z, e.x, e.y, ENEMIES[e.kind].radius)) continue;
    slowEnemy(w, e, z.owner, ZONE.water.slow, ZONE.water.tick + 0.25);
    const depth = X.core - (X.core - X.edge) * Math.min(1, Math.hypot(e.x - z.x, e.y - z.y) / Math.max(1, z.r));
    zoneHurt(w, z, e, z.dmg * depth, 'water', ev);
  }
}

function endWater(w: World, z: Zone, ev: SimEvent[]): End {
  if (z.spirit !== 'abyss') return {};
  buildGrid(w.enemies);
  const ids: number[] = [];
  for (const e of enemiesWithin(w, z.x, z.y, z.r + 6))
    if (inZone(z, e.x, e.y, ENEMIES[e.kind].radius) && freezeEnemy(w, e, z.owner, ZONE_FX.water.freeze, ev)) ids.push(e.id);
  return { effect: 'freeze', ids };
}

/** 火浪：火线的半径 r 从 0 推到 len，推到谁就烧谁一次（击退 + 点燃）。 */
function stepWave(w: World, z: Zone, _dt: number, ev: SimEvent[]) {
  const F = ZONE_FX.flameWave;
  const len = z.len ?? 0;
  z.r = Math.min(len, F.speed * z.t);
  const hit = (z.hit ??= []);
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, z.x, z.y, z.r + 12)) {
    if (hit.includes(e.id)) continue;
    // 和瞄准用同一个参考点（敌人身子中间、离脚底 6 像素）
    if (!inSector(z.x, z.y, z.a ?? 0, z.arc ?? 0, z.r, e.x, e.y - 6, ENEMIES[e.kind].radius)) continue;
    hit.push(e.id);
    const k = F.core - (F.core - F.edge) * Math.min(1, Math.hypot(e.x - z.x, e.y - 6 - z.y) / Math.max(1, len));
    hitEnemy(w, e, { dmg: z.dmg * k, by: 'wave', owner: z.owner, from: z, el: 'fire', kb: F.kb, burn: z.dmg * k * F.burn, burnT: F.burnT }, ev);
  }
}

/** 火浪推到头：器灵「焚风」顺着火浪的中线在地上留下一道火痕（焦土），脚下这一头也烧得到。 */
function endWave(w: World, z: Zone, ev: SimEvent[]): End {
  if (z.spirit !== 'gale') return {};
  const S = SCORCH;
  const a = z.a ?? 0;
  const len = z.len ?? z.r;
  const y0 = z.y + 6; // 火浪从胸口扇出，焦土落在地上
  const s = addZone(w, { owner: z.owner, kind: 'scorch', x: z.x, y: y0, x2: z.x + Math.cos(a) * len, y2: y0 + Math.sin(a) * len, r: S.w, life: S.life, dmg: z.dmg * S.dmg, tier: z.tier, a, spirit: z.spirit });
  ev.push({ t: 'zone', id: s.id, zone: 'scorch', owner: s.owner, x: s.x, y: s.y, r: s.r, life: s.life, kind: 'wuhuo', tier: s.tier });
  return {};
}
/** 焚风的焦土：一道多宽（半宽）、存在多久、每跳伤害（相对火浪的一下，0.3 秒一跳）。 */
export const SCORCH = { w: 10, life: 2.6, dmg: 0.03 }; // dmg 0.06 → 0.03（2026-11-11：焚风的群伤比中位数高三成）

function stepScorch(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  z.tick -= dt;
  if (z.tick > 0) return;
  z.tick += ZONE.scorch.tick;
  buildGrid(w.enemies);
  const reach = Math.hypot(z.x2 - z.x, z.y2 - z.y) / 2 + z.r + 12;
  for (const e of enemiesWithin(w, (z.x + z.x2) / 2, (z.y + z.y2) / 2, reach)) if (inZone(z, e.x, e.y, ENEMIES[e.kind].radius)) zoneHurt(w, z, e, z.dmg, 'fire', ev);
}

/** 金绳：x/y 跟着捆住的敌人的中心走；仙品「缚仙」把他们往一起拽，第一次撞上别的被捆的敌人时两只各挨一下。都死了就提前收绳。 */
function stepRope(w: World, z: Zone, dt: number, ev: SimEvent[]) {
  const live: Enemy[] = [];
  for (const id of z.ids ?? []) {
    const e = w.enemies.find((o) => o.id === id && o.hp > 0);
    if (e) live.push(e);
  }
  z.px = z.x;
  z.py = z.y;
  if (!live.length) {
    z.life = Math.min(z.life, z.t);
    return;
  }
  let sx = 0;
  let sy = 0;
  for (const e of live) {
    sx += e.x;
    sy += e.y;
  }
  z.x = z.x2 = sx / live.length;
  z.y = z.y2 = sy / live.length;
  if (!z.pull) return;
  for (const e of live) pullOne(e, z.x, z.y, z.pull, dt);
  const hit = (z.hit ??= []);
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const rr = ENEMIES[a.kind].radius + ENEMIES[b.kind].radius + 1;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > rr * rr) continue;
      for (const [e, o] of [[a, b], [b, a]] as [Enemy, Enemy][]) {
        if (hit.includes(e.id) || e.hp <= 0) continue;
        hit.push(e.id);
        hitEnemy(w, e, { dmg: z.dmg, by: 'rope', owner: z.owner, from: o, el: 'earth', noMark: true }, ev);
      }
    }
}
