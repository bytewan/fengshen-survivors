// 法宝特效实验页（网址加 ?fxlab）：场景里摆一个哪吒和几只不动的假敌人，按顺序把每件法宝的凡 / 灵 / 仙 / 神（两个器灵）各放几次。
// 原来的 8 件不跑模拟：这里自己伪造事件和世界状态（zones、pending、乾坤圈的悬停、敌人的印记 / 流血 / 冰冻……）喂给 WeaponFx。
// 后加的 8 件（打神鞭 … 捆仙绳）直接跑模拟里的出手与结算（updateWeapons / updatePending / updateZones / updateKnives / tickStatus），
// 画面和游戏里一模一样；敌人保持满血、被击退或拽走后慢慢走回原位。用来自己对照用户的美术口径反复改，也方便以后给用户看。
//
// 操作：← → 换法宝，↑ ↓ 或 1–5 换品阶（4、5 是神品的两个器灵），空格立刻再放一次，P 暂停 / 继续自动轮播。
// 网址参数：w=法宝（qiankun / huojian / jiulong / leigong / fantian / xinghuang / zhanxian / hanbing /
//   dashen / huaxue / dingfeng / qinglian / yinyang / xuanyuan / wuhuo / kunxian /
//   再加的 11 件：xiangmo / wuguang / zanxin / jinjiao / yanguang / wanya / sihai / wulu / miaoshu / wenhuang / luobao / react / status / combo），
//   t=1..5（品阶，4、5 是两个器灵；combo 时是第几组「四件神品一起带」），auto=0 不自动轮播，manual 手动时钟（截图脚本用 window.__fxlab.advance / film）。
import { Container, Sprite } from 'pixi.js';
import { createStage, VIEW_H, VIEW_W } from '../render/stage.ts';
import { Particles, Shake } from '../render/juice.ts';
import { flashTextureFromGrid, textureFromGrid } from '../render/textures.ts';
import { pixelTextTexture } from '../render/pixel-text.ts';
import { Sfx } from '../audio/sfx.ts';
import { DEFAULT_HAIR, makeNezhaFrames, NEZHA_ANCHOR, NEZHA_H, NEZHA_W, RING_SIZES } from '../art/sprites/nezha.ts';
import { SOLDIER_ANCHOR, SOLDIER_FRAMES, SOLDIER_H, SOLDIER_W } from '../art/sprites/soldier.ts';
import { ELITE_ANCHOR, ELITE_FRAMES, ELITE_H, ELITE_W } from '../art/sprites/elite.ts';
import { ARENA } from '../sim/config.ts';
import { REACTIONS, TIER_NAME, WEAPONS } from '../sim/catalog.ts';
import { createWorld, type World } from '../sim/world.ts';
import { updateKnives, updatePending, updateWeapons } from '../sim/weapons.ts';
import { updateZones } from '../sim/zones.ts';
import { hitEnemy, tickStatus } from '../sim/core.ts';
import type { Element, Enemy, EnemyKindName, OwnedWeapon, PendingKind, ReactionKind, SimEvent, WeaponKind } from '../sim/types.ts';
import { WeaponFx } from './fx.ts';
import { ArtifactFx } from './fx-new.ts';
import { ArtifactFx2 } from './fx-new2.ts';
import { RING_BIG } from '../art/sprites/weapons.ts';

/** 原来的八件（伪造事件）和后加的八件（跑模拟）。 */
type OldWeapon = 'qiankun' | 'huojian' | 'jiulong' | 'leigong' | 'fantian' | 'xinghuang' | 'zhanxian' | 'hanbing';
type NewWeapon = 'dashen' | 'huaxue' | 'dingfeng' | 'qinglian' | 'yinyang' | 'xuanyuan' | 'wuhuo' | 'kunxian';
/** 再加的 11 件（arti2 分支；画面在 fx-new2.ts）：和后加的八件一样跑模拟。 */
type NewWeapon2 = 'xiangmo' | 'wuguang' | 'zanxin' | 'jinjiao' | 'yanguang' | 'wanya' | 'sihai' | 'wulu' | 'miaoshu' | 'wenhuang' | 'luobao';
type LabWeapon = OldWeapon | NewWeapon | NewWeapon2;
type DemoKind = LabWeapon | 'react' | 'status' | 'combo';
const NEW_WEAPONS: NewWeapon[] = ['dashen', 'huaxue', 'dingfeng', 'qinglian', 'yinyang', 'xuanyuan', 'wuhuo', 'kunxian'];
const NEW_WEAPONS2: NewWeapon2[] = ['xiangmo', 'wuguang', 'zanxin', 'jinjiao', 'yanguang', 'wanya', 'sihai', 'wulu', 'miaoshu', 'wenhuang', 'luobao'];
const ORDER: DemoKind[] = ['huojian', 'qiankun', 'jiulong', 'leigong', 'fantian', 'xinghuang', 'zhanxian', 'hanbing', ...NEW_WEAPONS, ...NEW_WEAPONS2, 'react', 'status', 'combo'];
/** 跑模拟的演示：后加的八件、再加的 11 件，和「四件神品一起带」。 */
const SIM = new Set<DemoKind>([...NEW_WEAPONS, ...NEW_WEAPONS2, 'combo']);
const LABEL: Record<DemoKind, string> = { ...Object.fromEntries(Object.entries(WEAPONS).map(([k, v]) => [k, v.name])), react: '五行相生', status: '印记与持续伤害', combo: '四件神品' } as Record<DemoKind, string>;
/** 每件法宝多久放一次（秒）。后加的八件按各自的冷却放（区域类等上一块收完再放）。 */
const EVERY: Record<DemoKind, number> = {
  huojian: 1.5,
  qiankun: 2.0,
  jiulong: 2.3,
  leigong: 1.9,
  fantian: 2.2,
  xinghuang: 4.2,
  zhanxian: 2.6,
  hanbing: 2.4,
  dashen: 2.0,
  huaxue: 1.6,
  dingfeng: 3.4,
  qinglian: 6.6,
  yinyang: 1.8,
  xuanyuan: 5.2,
  wuhuo: 2.2,
  kunxian: 3.0,
  xiangmo: 2.6,
  wuguang: 1.6,
  zanxin: 1.8,
  jinjiao: 5.4,
  yanguang: 7.2,
  wanya: 4.4,
  sihai: 2.8,
  wulu: 2.8,
  miaoshu: 2.4,
  wenhuang: 3.8,
  luobao: 3.2,
  react: 0.7,
  status: 4,
  combo: 6,
};
/** 「四件神品一起带」的几组（t=1..5 选一组）：[法宝, 器灵]。 */
const COMBOS: [NewWeapon | OldWeapon, string][][] = [
  [['dingfeng', 'thunder'], ['yinyang', 'cosmos'], ['wuhuo', 'five'], ['xuanyuan', 'flood']],
  [['dashen', 'nine'], ['huaxue', 'sea'], ['qinglian', 'thorn'], ['kunxian', 'chain']],
  [['wuhuo', 'gale'], ['dingfeng', 'calm'], ['xuanyuan', 'abyss'], ['yinyang', 'demon']],
  [['dashen', 'seal'], ['huaxue', 'soul'], ['qinglian', 'dais'], ['kunxian', 'dragon']],
  [['jiulong', 'wide'], ['leigong', 'storm'], ['wuhuo', 'five'], ['yinyang', 'cosmos']],
];

const HX = 452;
const HY = 296;
/**
 * 假敌人的位置（相对哪吒）。都在法宝的索敌半径（REACH.seek 130）以内：射程收短之前精英摆在 150 像素外，
 * 打神鞭找不到它、旋风和水域也不往那边放，演示和游戏里不一样。
 */
const SPOTS: [number, number, EnemyKindName][] = [
  [56, -16, 'soldier'],
  [74, 6, 'soldier'],
  [92, -10, 'soldier'],
  [66, 28, 'soldier'],
  [100, 22, 'soldier'],
  [84, 44, 'soldier'],
  [110, -30, 'soldier'],
  [36, -62, 'soldier'],
  [-58, 26, 'soldier'],
  [-66, -22, 'soldier'],
  [24, 58, 'soldier'],
  [116, 48, 'soldier'],
  [122, 6, 'elite'],
];

const TAU = Math.PI * 2;

export async function startFxLab(mount: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const manual = params.has('manual');
  const stage = await createStage(mount, ARENA.w, ARENA.h);
  const { app, entities, floor, fx, screen } = stage;
  const sfx = new Sfx();
  const shake = new Shake(6, 4, 1.7);
  const sparks = new Particles(fx, stage.tex.dot);
  const glows = new Particles(stage.glow, stage.tex.dot);
  const wfx = new WeaponFx(stage, sparks, glows, shake, sfx);
  const afx = new ArtifactFx(stage, sparks, glows, shake, sfx);
  const afx2 = new ArtifactFx2(stage, sparks, glows, shake, sfx);
  addEventListener('pointerdown', () => sfx.unlock());

  // ---------- 场景 ----------
  const world: World = createWorld(7);
  world.phase = 'wave';
  const P = world.players[0];
  P.x = P.px = HX;
  P.y = P.py = HY;
  P.facing = 1;
  const heroFrames = makeNezhaFrames(DEFAULT_HAIR);
  const heroTex = { idle: heroFrames.idle.map(textureFromGrid), idleBare: heroFrames.idleBare.map(textureFromGrid) };
  const hero = new Sprite(heroTex.idle[0]);
  hero.anchor.set(NEZHA_ANCHOR.x / NEZHA_W, NEZHA_ANCHOR.y / NEZHA_H);
  hero.position.set(HX, HY);
  hero.zIndex = HY;
  entities.addChild(hero);
  const heroSh = new Sprite(stage.tex.shadow);
  heroSh.anchor.set(0.5);
  heroSh.alpha = 0.4;
  heroSh.position.set(HX, HY);
  floor.addChild(heroSh);

  const soldierTex = SOLDIER_FRAMES.walk.map(textureFromGrid);
  const soldierFlash = SOLDIER_FRAMES.walk.map(flashTextureFromGrid);
  const eliteTex = ELITE_FRAMES.walk.map(textureFromGrid);
  const eliteFlash = ELITE_FRAMES.walk.map(flashTextureFromGrid);
  const views = new Map<number, { s: Sprite; sh: Sprite; flash: number; t: number }>();

  function mkEnemy(id: number, kind: EnemyKindName, x: number, y: number): Enemy {
    return {
      id,
      kind,
      x,
      y,
      px: x,
      py: y,
      hp: 999,
      maxHp: 999,
      speed: 0,
      dmgMul: 1,
      kx: 0,
      ky: 0,
      cd: 0,
      cast: 0,
      burn: 0,
      burnT: 0,
      burnAcc: 0,
      burnBy: 0,
      stun: 0,
      frozen: 0,
      slow: 0,
      slowT: 0,
      vuln: 0,
      vulnT: 0,
      wrapT: 0,
      wrapMax: 0,
      fireVuln: 0,
      fireVulnT: 0,
      mark: null,
      markT: 0,
      bleed: 0,
      bleedT: 0,
      invuln: 0,
    };
  }
  /** 每只假敌人的原位（跑模拟的演示里被击退、卷走、拽走之后慢慢走回来；死了过一会儿在原位重生）。 */
  const home = new Map<number, [number, number]>();
  const respawn: { at: number; spot: number }[] = [];
  let enemyId = 1000;
  function addView(e: Enemy) {
    const elite = e.kind === 'elite';
    const s = new Sprite(elite ? eliteTex[0] : soldierTex[0]);
    if (elite) s.anchor.set(ELITE_ANCHOR.x / ELITE_W, ELITE_ANCHOR.y / ELITE_H);
    else s.anchor.set(SOLDIER_ANCHOR.x / SOLDIER_W, SOLDIER_ANCHOR.y / SOLDIER_H);
    s.scale.x = e.x < HX ? 1 : -1;
    s.position.set(e.x, e.y);
    s.zIndex = e.y;
    entities.addChild(s);
    const sh = new Sprite(elite ? stage.tex.shadow : stage.tex.smallShadow);
    sh.anchor.set(0.5);
    sh.alpha = 0.3;
    sh.position.set(e.x, e.y);
    floor.addChild(sh);
    views.set(e.id, { s, sh, flash: 0, t: Math.random() * 4 });
  }
  /** 在第 i 个位置放一只（精英血更厚：打神鞭先抽它）。 */
  function spawnAt(i: number): Enemy {
    const [dx, dy, k] = SPOTS[i];
    const e = mkEnemy(enemyId++, k, HX + dx, HY + dy);
    if (k === 'elite') e.hp = e.maxHp = 1999;
    home.set(e.id, [e.x, e.y]);
    (e as Enemy & { spot?: number }).spot = i;
    addView(e);
    return e;
  }
  function resetEnemies() {
    for (const v of views.values()) {
      v.s.destroy();
      v.sh.destroy();
    }
    views.clear();
    home.clear();
    respawn.length = 0;
    world.enemies = SPOTS.map((_, i) => spawnAt(i));
  }

  // 乾坤圈的本体（游戏里由 feel.ts 画，这里照着画一个简化版）
  const ringTex = [...RING_SIZES, ...RING_BIG].map((fs) => fs.map(textureFromGrid));
  const ringSprites = new Map<number, Sprite>();

  // ---------- 伪造的模拟 ----------
  let nextId = 5000;
  let clock = 0;
  const later: { at: number; fn: () => void }[] = [];
  const after = (dt: number, fn: () => void) => later.push({ at: clock + dt, fn });
  const ev: SimEvent[] = [];
  const emit = (e: SimEvent) => ev.push(e);
  const enemiesNear = (x: number, y: number, r: number) => world.enemies.filter((e) => Math.hypot(e.x - x, e.y - y) <= r);
  const nearest = (x: number, y: number, skip = new Set<number>(), maxR = 400) => {
    let best: Enemy | null = null;
    let bd = maxR;
    for (const e of world.enemies) {
      if (skip.has(e.id)) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  };
  const markEl = (e: Enemy, el: Element) => {
    e.mark = el;
    e.markT = 2.5;
  };
  const hit = (e: Enemy, by: 'thrust' | 'aura' | 'chain' | 'slam' | 'knife' | 'spike' | 'ring' | 'thunder' | 'zone', dmg = 20) => {
    emit({ t: 'hit', id: e.id, kind: e.kind, x: e.x, y: e.y, dmg, crit: false, by });
    const v = views.get(e.id);
    if (v) v.flash = 0.06;
  };
  const pend = (kind: PendingKind, x: number, y: number, r: number, t: number, tier: number, target?: number, warn = true) => {
    const id = nextId++;
    world.pending.push({ id, owner: 0, kind, x, y, r, t, dmg: 20, target, tier });
    if (warn) emit({ t: 'warn', id, kind, x, y, r, t2: t, tier });
    return id;
  };
  const zone = (kind: 'fireTrail' | 'fireDome' | 'crack' | 'frost', x: number, y: number, x2: number, y2: number, r: number, life: number, tier: number) =>
    world.zones.push({ id: nextId++, owner: 0, kind, x, y, x2, y2, r, t: 0, life, tick: 0, dmg: 5, tier });
  const burn = (e: Enemy, dps = 6) => {
    e.burn = Math.max(e.burn, dps);
    e.burnT = Math.max(e.burnT, 2);
  };
  const freeze = (e: Enemy, t = 1.1) => {
    if (e.frozen <= 0) emit({ t: 'freeze', id: e.id, x: e.x, y: e.y });
    e.frozen = Math.max(e.frozen, t);
  };
  const ringState = new Map<number, { hoverLeft: number; hovered: boolean; tier: number; flame: boolean }>();

  // 每件法宝的一次出手：照着 src/sim/types.ts 的事件格式伪造（带上 kind / tier）。数值大致照着 sim/weapons.ts 的 TUNE 抄
  // （只为了画面像游戏里一样大、一样快；不调用模拟本身）。
  const spear = (tier: number, spirit: string | null, base: number, second: boolean) => {
    const sun = spirit === 'pierce';
    const len = (tier >= 2 ? 114 : 108) * (sun ? 1.08 : 1);
    void second;
    const angles = spirit === 'storm' ? [base - 0.24, base, base + 0.24] : [base];
    const x0 = P.x + 4;
    const y0 = P.y - 10;
    for (const a of angles) {
      const l = a !== base ? len * 0.9 : len; // 梨花枪两侧的枪短一些（TUNE.huojian.side.len）
      const x1 = x0 + Math.cos(a) * l;
      const y1 = y0 + Math.sin(a) * l;
      emit({ t: 'thrust', owner: 0, x0, y0, x1, y1, kind: 'huojian', tier });
      for (const e of world.enemies) {
        const k = Math.max(0, Math.min(1, ((e.x - x0) * (x1 - x0) + (e.y - 6 - y0) * (y1 - y0)) / (l * l)));
        if (Math.hypot(e.x - (x0 + (x1 - x0) * k), e.y - 6 - (y0 + (y1 - y0) * k)) < 11) {
          hit(e, 'thrust');
          burn(e);
          markEl(e, 'fire');
        }
      }
      if (tier >= 3) zone('fireTrail', x0, y0 + 10, x1, y1 + 10, 8, 3.2, tier);
    }
  };
  const FIRE: Record<DemoKind, (tier: number, spirit: string | null) => void> = {
    huojian(tier, spirit) {
      const t = world.enemies[1];
      const base = Math.atan2(t.y - 6 - (P.y - 10), t.x - P.x);
      spear(tier, spirit, base, false);
      // 灵品起两连刺：第二枪隔 0.24 秒补上
      if (tier >= 2) after(0.24, () => spear(tier, spirit, base + 0.05, true));
    },
    qiankun(tier, spirit) {
      const t = world.enemies[2];
      const a = Math.atan2(t.y - 8 - (P.y - 10), t.x - P.x);
      const reach = Math.hypot(t.x - P.x - 6, t.y - 8 - (P.y - 10));
      const full = tier >= 2 ? 120 : 112;
      for (const da of spirit === 'split' ? [-0.5, 0.5] : [0]) {
        const id = nextId++;
        const sx = P.x + 6;
        const sy = P.y - 10;
        // 仙品起会悬停的圈飞到目标那里就停下（TUNE.qiankun：hoverPast 0、hoverMin 30、hoverMax 100）
        const range = tier >= 3 && spirit !== 'split' ? Math.max(30, Math.min(full, 100, reach)) : full;
        world.rings.push({ id, owner: 0, x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a + da) * 160, vy: Math.sin(a + da) * 160, out: 0, returning: false, primary: true, hits: new Set(), life: 6, dmg: 20, range, fireBurst: spirit === 'flame', hover: 0, tier, canHover: tier >= 3 });
        ringState.set(id, { hoverLeft: tier >= 3 ? 1 : 0, hovered: false, tier, flame: spirit === 'flame' });
      }
      emit({ t: 'throw', owner: 0, x: P.x + 6, y: P.y - 10, kind: 'qiankun', tier });
    },
    jiulong(tier, spirit) {
      const r = (tier >= 2 ? 108 : 104) * (spirit === 'wide' ? 1.05 : 1);
      emit({ t: 'aura', owner: 0, x: P.x, y: P.y - 6, r, kind: 'jiulong', tier });
      for (const e of enemiesNear(P.x, P.y - 6, r)) {
        hit(e, 'aura');
        burn(e);
        markEl(e, 'fire');
      }
      if (tier >= 3) zone('fireDome', P.x, P.y, P.x, P.y, r, 2.2, tier);
      // 九道火龙从火罩半径的一半处喷到 1.34 倍（最远 REACH.max − 6 = 139），同 TUNE.jiulong 的 dragonFrom / dragonLen
      if (spirit === 'nine')
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * TAU;
          const far = Math.min(139, r * 1.34);
          emit({ t: 'thrust', owner: 0, x0: P.x + Math.cos(a) * r * 0.5, y0: P.y - 6 + Math.sin(a) * r * 0.5, x1: P.x + Math.cos(a) * far, y1: P.y - 6 + Math.sin(a) * far, kind: 'jiulong', tier });
        }
    },
    leigong(tier, spirit) {
      const n = Math.round(([0, 3, 4, 4, 4][tier] + 1) * (spirit === 'storm' ? 1.25 : 1));
      const used = new Set<number>();
      for (let s = 0; s < (spirit === 'twin' ? 2 : 1); s++) {
        let cur = s === 0 ? world.enemies[0] : nearest(P.x + 60, P.y, used);
        const pts: [number, number][] = [[P.x, P.y - 26]];
        const hops = s === 0 ? n : Math.ceil(n / 3);
        for (let j = 0; j < hops && cur; j++) {
          used.add(cur.id);
          pts.push([cur.x, cur.y - 8]);
          hit(cur, 'chain');
          markEl(cur, 'wood');
          if (tier >= 3) pend('thunder', cur.x, cur.y, 12, 1.2, tier, cur.id);
          cur = nearest(cur.x, cur.y, used, 86);
        }
        emit({ t: 'chain', owner: 0, pts, kind: 'leigong', tier });
      }
    },
    fantian(tier, spirit) {
      const r = [0, 22, 27, 31, 31][tier]; // 同 TUNE.fantian.r
      const spots = spirit === 'triple' ? [world.enemies[1], world.enemies[6], world.enemies[11]] : [world.enemies[2]];
      spots.forEach((t, i) => pend('slam', t.x, t.y, i ? r * 0.8 : r, 0.55 + i * 0.18, tier));
    },
    xinghuang(tier, spirit) {
      P.shield = (tier >= 3 ? 2 : 1) + (spirit === 'lotus' ? 2 : 0);
      emit({ t: 'shieldUp', owner: 0, tier, kind: 'xinghuang' });
      const blocks = P.shield;
      for (let i = 0; i < blocks; i++)
        after(1.0 + i * 0.7, () => {
          if (P.shield <= 0) return;
          P.shield--;
          emit({ t: 'blocked', owner: 0, x: P.x, y: P.y, by: 'shield' });
          if (P.shield === 0) {
            const r = [0, 46, 60, 64, 64][tier];
            emit({ t: 'shieldBreak', owner: 0, x: P.x, y: P.y, r, tier });
            for (const e of enemiesNear(P.x, P.y, r)) hit(e, 'slam');
          }
        });
    },
    zhanxian(tier, spirit) {
      const t = world.enemies[0];
      const n = spirit === 'many' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(t.y - P.y, t.x - P.x) + (i - (n - 1) / 2) * 0.6;
        const side = n > 1 && i !== (n - 1) / 2;
        world.knives.push({ id: nextId++, owner: 0, x: P.x, y: P.y - 14, px: P.x, py: P.y - 14, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, target: t.id, hitsLeft: side ? 2 : [0, 4, 5, 5, 5][tier], hit: new Set(), dmg: 20, life: 5, tier });
      }
      emit({ t: 'throw', owner: 0, x: P.x, y: P.y - 14, kind: 'zhanxian', tier });
    },
    hanbing(tier, spirit) {
      const n = (tier >= 2 ? 4 : 3) * (spirit === 'field' ? 2 : 1);
      const near = world.enemies.filter((e) => e.x > HX);
      for (let i = 0; i < n; i++) {
        const e = near[(i * 3 + Math.floor(clock * 7)) % near.length];
        const extra = i >= near.length;
        const a = Math.random() * TAU;
        pend('spike', e.x + (extra ? Math.cos(a) * 9 : (Math.random() - 0.5) * 6), e.y + (extra ? Math.sin(a) * 6 : (Math.random() - 0.5) * 4), 9, 0.4, tier);
      }
    },
    react() {
      const kinds = Object.keys(REACTIONS) as ReactionKind[];
      const kind = kinds[Math.floor(clock / EVERY.react) % kinds.length];
      const e = world.enemies[Math.floor(Math.random() * 8)];
      markEl(e, REACTIONS[kind].from);
      after(0.25, () => {
        e.mark = null;
        e.markT = 0;
        emit({ t: 'react', id: e.id, x: e.x, y: e.y, kind, owner: 0 });
      });
    },
    status() {
      const els: Element[] = ['metal', 'wood', 'water', 'fire', 'earth'];
      world.enemies.forEach((e, i) => {
        markEl(e, els[i % 5]);
        e.markT = 3.5;
        if (i % 3 === 0) burn(e, 10);
        if (i % 3 === 1) {
          e.bleed = 5;
          e.bleedT = 3.5;
        }
        if (i % 4 === 2) freeze(e, 2.5);
      });
    },
    // 后加的八件：只是「这一步让它出手」，出手和结算都在模拟里（simStep）
    dashen: () => void (fireReq = true),
    huaxue(tier) {
      fireReq = true;
      // 化血：斩完过一会儿，让一只流着血的兵死掉，化成血雾
      if (tier >= 3)
        after(0.75, () => {
          const e = world.enemies.find((x) => x.bleedT > 0 && x.kind !== 'elite');
          if (!e) return;
          (e as Enemy & { doomed?: boolean }).doomed = true;
          hitEnemy(world, e, { dmg: 99999, by: 'bleed', owner: 0, from: e, canCrit: false }, ev);
        });
    },
    dingfeng: () => void (fireReq = true),
    qinglian: () => void (fireReq = true),
    yinyang: () => void (fireReq = true),
    xuanyuan: () => void (fireReq = true),
    wuhuo: () => void (fireReq = true),
    kunxian: () => void (fireReq = true),
    xiangmo: () => void (fireReq = true),
    wuguang: () => void (fireReq = true),
    zanxin: () => void (fireReq = true),
    jinjiao: () => void (fireReq = true),
    yanguang: () => void (fireReq = true),
    wanya: () => void (fireReq = true),
    sihai: () => void (fireReq = true),
    wulu: () => void (fireReq = true),
    miaoshu: () => void (fireReq = true),
    wenhuang: () => void (fireReq = true),
    luobao: () => void (fireReq = true),
    combo() {},
  };

  // ---------- 演示的切换 ----------
  let kindIdx = Math.max(0, ORDER.indexOf((params.get('w') as DemoKind) ?? 'huojian'));
  let tierIdx = Math.min(5, Math.max(1, Number(params.get('t') ?? 1)));
  let auto = params.get('auto') !== '0' && !params.has('w');
  let reps = 0;
  let nextFire = 0.3;
  const gearOf = () => {
    const kind = ORDER[kindIdx];
    const tier = Math.min(4, tierIdx);
    const def = (WEAPONS as Record<string, (typeof WEAPONS)['huojian'] | undefined>)[kind];
    const spirit = tierIdx >= 4 && def ? def.spirits[tierIdx - 4].id : null;
    return { kind, tier, spirit, def };
  };
  function setup() {
    wfx.clear();
    afx.clear();
    afx2.clear();
    for (const s of ringSprites.values()) s.destroy();
    ringSprites.clear();
    ringState.clear();
    world.rings = [];
    world.knives = [];
    world.pending = [];
    world.zones = [];
    later.length = 0;
    P.shield = 0;
    resetEnemies();
    const { kind, tier, spirit } = gearOf();
    P.weapons = kind in WEAPONS ? [{ kind: kind as WeaponKind, tier, spirit, cd: 0 }] : [];
    if (kind === 'combo') P.weapons = COMBOS[tierIdx - 1].map(([k, sp], i): OwnedWeapon => ({ kind: k, tier: 4, spirit: sp, cd: 0.3 + i * 0.4 }));
    P.hp = P.stats.maxHp;
    fireReq = false;
    reps = 0;
    nextFire = clock + 0.35;
    showLabel();
  }
  function fireNow() {
    const { kind, tier, spirit } = gearOf();
    FIRE[kind](tier, spirit);
    reps++;
    nextFire = clock + EVERY[kind];
  }

  // ---------- 标签（像素字） ----------
  const label = new Container();
  screen.addChild(label);
  const help = new Sprite(pixelTextTexture('← → 换法宝  ↑ ↓ 换品阶  空格 再放  P 暂停', { color: 'j', outline: 'k' }));
  help.position.set(6, VIEW_H - help.height - 4);
  screen.addChild(help);
  function showLabel() {
    label.removeChildren().forEach((c) => c.destroy());
    const { kind, tier, def } = gearOf();
    const name = LABEL[kind];
    const comboText = () => COMBOS[tierIdx - 1].map(([k, sp]) => `${WEAPONS[k].name}·${WEAPONS[k].spirits.find((x) => x.id === sp)?.name}`).join(' ');
    const tierText = kind === 'combo' ? comboText() : def ? (tierIdx >= 4 ? `神品 · ${def.spirits[tierIdx - 4].name}` : `${TIER_NAME[tier]}品`) : '';
    const s1 = new Sprite(pixelTextTexture(name, { color: ['f', 'Y'], outline: 'B', scale: 2 }));
    s1.position.set(6, 5);
    label.addChild(s1);
    if (tierText) {
      const s2 = new Sprite(pixelTextTexture(tierText, { color: ['w', 'j'], outline: 'k' }));
      s2.position.set(Math.round(10 + s1.width), 5 + s1.height - s2.height - 1);
      label.addChild(s2);
    }
    const s3 = new Sprite(pixelTextTexture(auto ? '自动轮播' : '手动', { color: 'C', outline: 'N' }));
    s3.position.set(VIEW_W - s3.width - 6, 5);
    label.addChild(s3);
  }

  addEventListener('keydown', (e) => {
    sfx.unlock();
    const k = e.key.toLowerCase();
    // 手动换了法宝或品阶就停在那里，不再自动轮播（P 恢复）
    if (/^(arrow(left|right|up|down)|[adws1-5])$/.test(k)) auto = false;
    if (k === 'arrowright' || k === 'd') {
      kindIdx = (kindIdx + 1) % ORDER.length;
      tierIdx = 1;
      setup();
    } else if (k === 'arrowleft' || k === 'a') {
      kindIdx = (kindIdx + ORDER.length - 1) % ORDER.length;
      tierIdx = 1;
      setup();
    } else if (k === 'arrowup' || k === 'w') {
      tierIdx = Math.min(5, tierIdx + 1);
      setup();
    } else if (k === 'arrowdown' || k === 's') {
      tierIdx = Math.max(1, tierIdx - 1);
      setup();
    } else if (k >= '1' && k <= '5') {
      tierIdx = Number(k);
      setup();
    } else if (k === ' ') fireNow();
    else if (k === 'p') {
      auto = !auto;
      showLabel();
    }
  });

  // ---------- 推进 ----------
  function step(dt: number) {
    clock += dt;
    world.time += dt;
    const { kind } = gearOf();
    // 自动出手与轮播（四件神品一起带的那几组也按 t 轮下去）
    if (clock >= nextFire) {
      const isWeapon = kind in WEAPONS || kind === 'combo';
      if (auto && reps >= (kind === 'combo' ? 2 : isWeapon ? 3 : kind === 'react' ? 10 : 2)) {
        if (isWeapon && tierIdx < 5) tierIdx++;
        else {
          kindIdx = (kindIdx + 1) % ORDER.length;
          tierIdx = 1;
        }
        setup();
      } else fireNow();
    }
    for (let i = later.length - 1; i >= 0; i--)
      if (clock >= later[i].at) {
        const f = later[i].fn;
        later.splice(i, 1);
        f();
      }
    // 青莲仙品起「步步生莲」：结界跟着人走 —— 让哪吒在原地附近慢慢走一个来回，看得出结界跟着走、脚下一步开一朵莲
    const g0 = gearOf();
    const stroll = g0.kind === 'qinglian' && g0.tier >= 3;
    const nx = stroll ? HX + Math.sin(clock * 0.9) * 34 : HX;
    const ny = stroll ? HY + Math.sin(clock * 1.8) * 10 : HY;
    P.moving = stroll;
    if (nx !== P.x) P.facing = nx > P.x ? 1 : -1;
    P.x = nx;
    P.y = ny;
    if (SIM.has(kind)) simStep(dt);
    else fakeStep(dt);
    P.px = P.x;
    P.py = P.y;
    const xh = P.weapons.find((x) => x.kind === 'xinghuang');
    P.lotus = xh && xh.tier >= 3 && P.shield > 0 ? 40 : 0;
    // 事件交给特效（模拟发出的命中也让敌人闪一下白）
    const batch = ev.splice(0);
    for (const e of batch)
      if (e.t === 'hit') {
        const v = views.get(e.id);
        if (v && e.by !== 'burn' && e.by !== 'bleed' && e.by !== 'zone') v.flash = 0.06;
      }
    const t0 = performance.now();
    for (const e of batch) {
      wfx.onEvent(e, world);
      afx.onEvent(e, world);
      afx2.onEvent(e, world);
    }
    // 画面
    sparks.update(dt);
    glows.update(dt);
    wfx.update(dt, world, 1);
    afx.update(dt, world, 1);
    afx2.update(dt, world, 1);
    fxMs = fxMs * 0.95 + (performance.now() - t0) * 0.05;
    fxMax = Math.max(fxMax * 0.995, performance.now() - t0);
    syncViews(dt);
    shake.update(dt);
    const [sx, sy] = shake.offset;
    stage.lookAt(HX + 48, HY - 22, sx, sy);
    stage.update(dt);
  }

  /** 后加的八件：跑模拟里的出手与结算。敌人保持满血（化血、封神的演示里有几只要死 / 是残血），被击退、拽走后慢慢走回原位，死了过一会儿重生。 */
  let fireReq = false;
  function simStep(dt: number) {
    world.tick++;
    const { kind, spirit } = gearOf();
    for (const e of world.enemies) {
      const x = e as Enemy & { doomed?: boolean; spot?: number };
      if (x.doomed) continue;
      // 封神：一半的兵是残血（落点的鞭痕、震波直接把它们抽散）
      const low = kind === 'dashen' && spirit === 'seal' && e.kind !== 'elite' && (x.spot ?? 0) % 2 === 0;
      e.hp = low ? e.maxHp * 0.2 : e.maxHp;
    }
    // 回血类的演示：人不满血（结界、噬魂才有回血可报）
    if (kind === 'qinglian' || kind === 'combo' || (kind === 'huaxue' && spirit === 'soul')) P.hp = P.stats.maxHp * 0.6;
    // 单件演示按节奏出手；四件神品按各自的冷却
    if (kind !== 'combo') for (const wpn of P.weapons) wpn.cd = fireReq ? 0 : Math.max(wpn.cd, 0.5);
    fireReq = false;
    for (const e of world.enemies) {
      e.px = e.x;
      e.py = e.y;
    }
    updateWeapons(world, P, dt, ev);
    updateKnives(world, dt, ev);
    updatePending(world, dt, ev);
    updateZones(world, dt, ev);
    for (const e of world.enemies) if (e.hp > 0) tickStatus(world, e, dt, ev);
    // 击退；拉扯类的区域（旋风、金绳、漩涡）都收完了，再慢慢走回原位
    const pulling = world.zones.some((z) => z.kind === 'whirl' || z.kind === 'rope' || (z.kind === 'water' && !!z.pull));
    for (const e of world.enemies) {
      e.x += e.kx * dt;
      e.y += e.ky * dt;
      const decay = Math.exp(-dt * 9);
      e.kx *= decay;
      e.ky *= decay;
      const h = home.get(e.id);
      if (!h || pulling || e.stun > 0 || Math.hypot(e.kx, e.ky) > 15) continue;
      const dx = h[0] - e.x;
      const dy = h[1] - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const s = Math.min(d, 26 * dt);
        e.x += (dx / d) * s;
        e.y += (dy / d) * s;
      }
    }
    for (const e of world.enemies) if (e.hp <= 0) respawn.push({ at: clock + 1.5, spot: (e as Enemy & { spot?: number }).spot ?? 0 });
    world.enemies = world.enemies.filter((e) => e.hp > 0);
    for (let i = respawn.length - 1; i >= 0; i--)
      if (clock >= respawn[i].at) {
        world.enemies.push(spawnAt(respawn[i].spot));
        respawn.splice(i, 1);
      }
    world.gems = [];
    world.drops = [];
  }

  /** 原来的八件：照着模拟的样子伪造区域、延时效果、乾坤圈、飞刀、敌人的状态计时。 */
  function fakeStep(dt: number) {
    // 地面区域
    for (const z of world.zones) z.t += dt;
    world.zones = world.zones.filter((z) => z.t < z.life);
    // 延时效果
    for (let i = world.pending.length - 1; i >= 0; i--) {
      const q = world.pending[i];
      q.t -= dt;
      if (q.t > 0) continue;
      world.pending.splice(i, 1);
      let x = q.x;
      let y = q.y;
      if (q.target !== undefined) {
        const t = world.enemies.find((e) => e.id === q.target);
        if (t) {
          x = t.x;
          y = t.y;
        }
      }
      emit({ t: 'land', id: q.id, kind: q.kind, x, y, r: q.r, tier: q.tier, ...(q.quake ? { quake: true } : {}) });
      const tier = q.tier ?? 1;
      const spirit = gearOf().spirit;
      for (const e of enemiesNear(x, y, q.r + 4)) {
        if (q.kind === 'slam') {
          hit(e, 'slam');
          markEl(e, 'earth');
          e.stun = 0.8;
        } else if (q.kind === 'spike' || q.kind === 'frost') {
          hit(e, 'spike');
          markEl(e, 'water');
          freeze(e);
        } else hit(e, 'thunder');
      }
      if (q.kind === 'slam' && tier >= 3 && !q.quake) zone('crack', x, y, x, y, q.r * 1.25, 4.5, tier);
      if (q.kind === 'slam' && spirit === 'quake' && !q.quake) {
        const id = nextId++;
        world.pending.push({ id, owner: 0, kind: 'slam', x, y, r: q.r * 2.1, t: 0.3, dmg: 10, tier, quake: true });
      }
      if (q.kind === 'spike' && tier >= 3) {
        zone('frost', x, y, x, y, 22, 3.2, tier);
        pend('frost', x, y, 30, 1, tier);
      }
      if ((q.kind === 'spike' || q.kind === 'frost') && spirit === 'shatter')
        after(1.0, () => {
          const e = enemiesNear(x, y, q.r + 4)[0];
          if (e) emit({ t: 'explode', x: e.x, y: e.y, r: 22 });
        });
    }
    // 乾坤圈：飞出 → （仙品）到最远处悬停旋转 → 折返
    for (let i = world.rings.length - 1; i >= 0; i--) {
      const r = world.rings[i];
      const st = ringState.get(r.id)!;
      r.px = r.x;
      r.py = r.y;
      if (!r.returning) {
        if (r.hover > 0) {
          r.hover -= dt;
          if (r.hover <= 0) {
            r.hover = 0;
            r.returning = true;
          }
          for (const e of enemiesNear(r.x, r.y + 8, 22)) if (Math.random() < 0.012) hit(e, 'ring');
        } else {
          r.out += 160 * dt;
          r.x += r.vx * dt;
          r.y += r.vy * dt;
          for (const e of enemiesNear(r.x, r.y + 8, 14))
            if (!r.hits.has(e.id)) {
              r.hits.add(e.id);
              hit(e, 'ring');
              markEl(e, 'fire');
            }
          if (r.out >= r.range) {
            if (st.hoverLeft > 0 && !st.hovered) {
              st.hovered = true;
              r.hover = st.hoverLeft;
            } else r.returning = true;
            if (r.returning && st.flame) emit({ t: 'aura', owner: 0, x: r.x, y: r.y, r: 62, kind: 'qiankun', tier: 4 });
          }
        }
        if (r.returning && r.fireBurst && st.hovered) emit({ t: 'aura', owner: 0, x: r.x, y: r.y, r: 62, kind: 'qiankun', tier: 4 });
      } else {
        const dx = P.x - r.x;
        const dy = P.y - 10 - r.y;
        const d = Math.hypot(dx, dy) || 1;
        r.x += (dx / d) * 200 * dt;
        r.y += (dy / d) * 200 * dt;
        if (d < 9) {
          world.rings.splice(i, 1);
          ringState.delete(r.id);
        }
      }
    }
    // 斩仙飞刀：追着没打过的敌人来回穿刺
    for (let i = world.knives.length - 1; i >= 0; i--) {
      const k = world.knives[i];
      k.px = k.x;
      k.py = k.y;
      k.life -= dt;
      let t = world.enemies.find((e) => e.id === k.target) ?? null;
      if (!t || k.hit.has(t.id)) {
        t = nearest(k.x, k.y, k.hit, 160);
        if (t) k.target = t.id;
      }
      if (!t || k.life <= 0 || k.hitsLeft <= 0) {
        world.knives.splice(i, 1);
        continue;
      }
      const dx = t.x - k.x;
      const dy = t.y - 8 - k.y;
      const d = Math.hypot(dx, dy) || 1;
      const a = Math.min(1, dt * 8);
      k.vx += ((dx / d) * 150 - k.vx) * a;
      k.vy += ((dy / d) * 150 - k.vy) * a;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      if (d < 9) {
        hit(t, 'knife');
        markEl(t, 'metal');
        if (gearOf().tier >= 3) {
          t.bleed = 4;
          t.bleedT = 3;
        }
        k.hit.add(t.id);
        k.hitsLeft--;
      }
    }
    // 敌人的状态计时
    for (const e of world.enemies) {
      e.px = e.x;
      e.py = e.y;
      e.burnT = Math.max(0, e.burnT - dt);
      if (e.burnT <= 0) e.burn = 0;
      e.frozen = Math.max(0, e.frozen - dt);
      e.stun = Math.max(0, e.stun - dt);
      e.bleedT = Math.max(0, e.bleedT - dt);
      if (e.bleedT <= 0) e.bleed = 0;
      e.markT = Math.max(0, e.markT - dt);
      if (e.markT <= 0) e.mark = null;
    }
  }

  let fxMs = 0; // 特效每帧耗时（毫秒，滑动平均），自查性能用
  let fxMax = 0; // 最近一段时间里最重的一帧（毫秒，慢慢衰减）
  let heroT = 0;
  function syncViews(dt: number) {
    heroT += dt;
    const bare = world.rings.length > 0;
    const fr = bare ? heroTex.idleBare : heroTex.idle;
    hero.texture = fr[Math.floor(heroT * 5) % fr.length];
    hero.position.set(Math.round(P.x), Math.round(P.y));
    hero.zIndex = P.y;
    hero.scale.x = P.facing;
    heroSh.position.set(Math.round(P.x), Math.round(P.y));
    const alive = new Set<number>();
    for (const e of world.enemies) {
      const v = views.get(e.id);
      if (!v) continue;
      alive.add(e.id);
      v.s.position.set(Math.round(e.x), Math.round(e.y));
      v.s.zIndex = e.y;
      v.sh.position.set(Math.round(e.x), Math.round(e.y));
      v.t += dt * (e.frozen > 0 || e.stun > 0 ? 0 : 0.6);
      v.flash = Math.max(0, v.flash - dt);
      const elite = e.kind === 'elite';
      const fi = Math.floor(v.t * 6) % 4;
      v.s.texture = (v.flash > 0 ? (elite ? eliteFlash : soldierFlash) : elite ? eliteTex : soldierTex)[fi];
      v.s.tint = e.frozen > 0 ? 0x9fd8ff : e.burnT > 0 ? (Math.sin(v.t * 30) > 0 ? 0xffc090 : 0xffe0c0) : 0xffffff;
    }
    // 死掉的敌人：精灵收掉（重生时另建）
    for (const [id, v] of views)
      if (!alive.has(id)) {
        v.s.destroy();
        v.sh.destroy();
        views.delete(id);
      }
    const rseen = new Set<number>();
    for (const r of world.rings) {
      rseen.add(r.id);
      let s = ringSprites.get(r.id);
      if (!s) {
        s = new Sprite(ringTex[0][0]);
        s.anchor.set(0.5);
        fx.addChild(s);
        ringSprites.set(r.id, s);
      }
      const g = r.returning ? 1 : Math.min(1, r.out / r.range);
      const size = (g < 0.36 ? 0 : g < 0.72 ? 1 : 2) + ((r.tier ?? 1) >= 3 ? 2 : (r.tier ?? 1) >= 2 ? 1 : 0);
      s.texture = ringTex[size][Math.floor(clock * 20) % 2];
      s.position.set(Math.round(r.x), Math.round(r.y));
    }
    for (const [id, s] of ringSprites)
      if (!rseen.has(id)) {
        s.destroy();
        ringSprites.delete(id);
      }
  }

  setup();
  if (manual) app.ticker.stop();
  else
    app.ticker.add((t) => {
      step(Math.min(0.05, t.deltaMS / 1000));
    });

  // ---------- 截图用的接口 ----------
  const api = {
    get world() {
      return world;
    },
    /** 切到某件法宝的某个品阶（1..5），从头开始。 */
    pick(kind: DemoKind, tier: number) {
      kindIdx = Math.max(0, ORDER.indexOf(kind));
      tierIdx = tier;
      auto = false;
      setup();
    },
    fire: fireNow,
    /** 手动时钟：推进 n 步、每步 dt 秒，然后画一帧。 */
    advance(dt: number, n = 1) {
      for (let i = 0; i < n; i++) step(dt);
      app.renderer.render(app.stage);
    },
    /** 连拍：每隔 every 秒拍一张（画面坐标的 crop 区域，放大 scale 倍），拼成 cols 列的一张图，返回 dataURL。 */
    film(frames: number, every: number, crop: [number, number, number, number], scale = 3, cols = 4, sub = 4) {
      const [cx, cy, cw, ch] = crop;
      const rows = Math.ceil(frames / cols);
      const out = document.createElement('canvas');
      out.width = cols * (cw * scale + 4) + 4;
      out.height = rows * (ch * scale + 4) + 4;
      const g = out.getContext('2d')!;
      g.fillStyle = '#100c14';
      g.fillRect(0, 0, out.width, out.height);
      g.imageSmoothingEnabled = false;
      for (let i = 0; i < frames; i++) {
        for (let s = 0; s < sub; s++) step(every / sub);
        app.renderer.render(app.stage);
        // 画布的后备缓冲是画面的 zoom 倍（render/stage.ts），按画面坐标取的区域要乘上它
        const z = stage.zoom;
        g.drawImage(app.canvas, cx * z, cy * z, cw * z, ch * z, 4 + (i % cols) * (cw * scale + 4), 4 + Math.floor(i / cols) * (ch * scale + 4), cw * scale, ch * scale);
      }
      return out.toDataURL('image/png');
    },
    stats: () => ({ fxMs: fxMs.toFixed(2), fxMax: fxMax.toFixed(2), afx: afx.stats, afx2: afx2.stats, clock: clock.toFixed(2), kind: ORDER[kindIdx], tier: tierIdx, zones: world.zones.length, pending: world.pending.length, rings: world.rings.length, knives: world.knives.length, particles: sparks.count + glows.count }),
  };
  (window as unknown as { __fxlab: typeof api }).__fxlab = api;
  (window as unknown as { __afx: ArtifactFx }).__afx = afx;
  (window as unknown as { __afx2: ArtifactFx2 }).__afx2 = afx2;
  // 量尺寸的脚本（tools/fx-size.mjs）要藏起场景、只留特效再取包围盒，从这里拿到画面的各层
  (window as unknown as { __fxlabStage: typeof stage }).__fxlabStage = stage;
}
