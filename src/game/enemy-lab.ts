// 敌人实验页（网址加 ?enemylab）：把第一章的 8 种敌人摆在几个「站」里，用真的模拟循环演示行走、蓄力、出手、受击、死亡，
// 画面全走 enemy-views / enemy-fx（也就是合并进 feel.ts 之后的样子）。每个站有一个打不死的哪吒当靶子。
// 截图用：window.__lab.pause(true) 定住；window.__lab.advance(秒) 按模拟步长往前推几帧并立刻重画（软件渲染很慢，按真实时间等不准）。
// ?enemylab=cavalry 只摆一种（镜头对准它），?seed= 换随机种子。
// ?enemylab=ch2 摆第二章的三种（落魂幡手带两只回响兵、红沙傀儡、风吼妖）；?enemylab=bannerman 等只摆其中一种。
// ?enemylab=ch3 摆第三章的三种（飞剑灵、截教门徒、一对阵图傀儡），在界牌关的场景里；?enemylab=flysword 等只摆其中一种。
// ?enemylab=elites 摆各章的精英（回响校尉、东海夜叉、带着三只回响兵的金光力士、截教剑侍）；?enemylab=yecha / lishi / jianshi 只摆一种
// （力士在西岐城外、剑侍在界牌关的场景里）；?enemylab=affixes 摆五条词缀（各一只带一条的回响校尉，外加一只带两条的金光力士）；
// ?enemylab=gallery 把四种精英 × 不带 / 五条词缀排成一张对照表（都定住不动，看身上的词缀色、点缀和血条左边的字）。
import { Sprite, type Texture } from 'pixi.js';
import { createStage, VIEW_H, VIEW_W } from '../render/stage.ts';
import { Particles, Shake } from '../render/juice.ts';
import { flashTextureFromGrid, textureFromGrid } from '../render/textures.ts';
import { DEFAULT_HAIR, makeNezhaFrames, NEZHA_ANCHOR, NEZHA_H, NEZHA_W } from '../art/sprites/nezha.ts';
import { Sfx } from '../audio/sfx.ts';
import { ARENA, DT } from '../sim/config.ts';
import { hitEnemy } from '../sim/core.ts';
import { createWorld, spawnEnemy, step, type Enemy, type EnemyKindName, type PlayerInput, type SimEvent, type World } from '../sim/world.ts';
import { EnemyViews } from './enemy-views.ts';
import { EnemyFx } from './enemy-fx.ts';
import { EliteFx } from './elites/fx.ts';
import { AffixFx } from './elites/affix-fx.ts';
import { spawnElite } from '../sim/elites/index.ts';
import type { EliteAffix, EliteKind } from '../sim/elites/types.ts';
import { Ch2FoeFx } from './ch2/foe-fx.ts';
import { Ch3FoeFx } from './ch3/foe-fx.ts';

/** 一个演示站：靶子站在 (hx, hy)，敌人从 (sx, sy) 出来；script 按这一轮过了多久决定打它一下、打死它。 */
interface Station {
  kind: EnemyKindName;
  /** 精英：哪一种、带哪几条词缀（kind 是 'elite' 时；不给 = 回响校尉、不带词缀）。 */
  elite?: EliteKind;
  affixes?: EliteAffix[];
  /** 站名（同一种摆了好几只时区分，?enemylab=名字 也认它）。 */
  name?: string;
  /** 自己摆（对照表）：返回摆出来的敌人；摆了就不按 kind 刷。 */
  make?(w: World, ev: SimEvent[]): number[];
  /** 不画靶子（对照表）。 */
  noHero?: boolean;
  hx: number;
  hy: number;
  sx: number;
  sy: number;
  w: World; // 每一站一个自己的世界（一个靶子），站与站互不干扰
  views: EnemyViews;
  fx: EnemyFx;
  fx2: Ch2FoeFx;
  fx3: Ch3FoeFx;
  efx: EliteFx;
  afx: AffixFx;
  /** 和它一起刷的（落魂幡手要有被增益的同伴）。 */
  with?: EnemyKindName[];
  ids: number[]; // 这一站现在场上的敌人（分魂鬼分裂后是两只小鬼）
  t: number; // 这一轮过了多久
  gone: number; // 敌人都没了之后过了多久（-1 = 还在）
  script(st: Station, w: World, ev: SimEvent[]): void;
}

const CX = ARENA.w / 2;
const CY = ARENA.h / 2;

export async function startEnemyLab(mount: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const only = params.get('enemylab') ?? '';
  const seed = Number(params.get('seed') ?? 9);
  // 第二章的敌人摆在第二章的场景（西岐城外）里看
  const ch2Kinds = ['ch2', 'bannerman', 'golem', 'windfiend', 'lishi'];
  const ch3Kinds = ['ch3', 'flysword', 'disciple', 'puppet', 'jianshi'];
  const stage = await createStage(mount, ARENA.w, ARENA.h, undefined, ch2Kinds.includes(only) ? 'xiqi' : ch3Kinds.includes(only) ? 'jiepai' : 'plaza');
  const sfx = new Sfx();
  addEventListener('pointerdown', () => sfx.unlock());
  addEventListener('keydown', () => sfx.unlock());
  const particles = new Particles(stage.fx, stage.tex.dot);
  const glows = new Particles(stage.glow, stage.tex.dot);
  const shake = new Shake(6, 4, 1.7);

  // ---------- 演示站 ----------
  const hitFrom = (w: World, e: Enemy, x: number, y: number, dmg = 3) => {
    const ev: SimEvent[] = [];
    hitEnemy(w, e, { dmg, by: 'ring', owner: 0, from: { x, y }, canCrit: false }, ev);
    return ev;
  };
  const live = (w: World, st: Station) => st.ids.map((id) => w.enemies.find((e) => e.id === id && e.hp > 0)).filter((e): e is Enemy => !!e);
  // 每一站的演示脚本：隔一会儿打一下（看受击闪白），到时候打死（看死亡），没了就再刷一只
  const every = (st: Station, period: number, at: number) => Math.floor((st.t - at) / period) !== Math.floor((st.t - at - DT) / period) && st.t > at;
  const basic = (hitEvery: number, killAt: number) => (st: Station, w: World, ev: SimEvent[]) => {
    const es = live(w, st);
    for (const e of es) {
      if (every(st, hitEvery, 0.8)) ev.push(...hitFrom(w, e, st.hx, st.hy - 8));
      if (st.t >= killAt && st.t - DT < killAt) ev.push(...hitFrom(w, e, st.hx, st.hy - 8, 1e6));
    }
  };
  const all: Omit<Station, 'w' | 'views' | 'fx' | 'fx2' | 'fx3' | 'efx' | 'afx' | 'ids' | 't' | 'gone'>[] = [
    { kind: 'spearman', hx: CX - 205, hy: CY - 80, sx: CX - 150, sy: CY - 80, script: basic(1.6, 7.5) },
    {
      kind: 'shieldbearer',
      hx: CX - 60,
      hy: CY - 80,
      sx: CX - 6,
      sy: CY - 80,
      // 盾兵：正面、背后轮流挨打（正面挡下亮符、伤害小；背后全额闪白）
      script(st, w, ev) {
        for (const e of live(w, st)) {
          if (every(st, 1.2, 0.6)) ev.push(...hitFrom(w, e, e.x + Math.cos(e.face ?? Math.PI) * 30, e.y - 7, 12));
          if (every(st, 1.2, 1.2)) ev.push(...hitFrom(w, e, e.x - Math.cos(e.face ?? Math.PI) * 30, e.y - 7, 12));
          if (st.t >= 8 && st.t - DT < 8) ev.push(...hitFrom(w, e, e.x - 30, e.y, 1e6));
        }
      },
    },
    { kind: 'bomber', hx: CX + 100, hy: CY - 80, sx: CX + 195, sy: CY - 70, script: () => {} },
    {
      kind: 'splitter',
      hx: CX - 205,
      hy: CY + 5,
      sx: CX - 150,
      sy: CY + 5,
      // 分魂鬼：打死分成两只，过一会儿再把两只小鬼打死
      script(st, w, ev) {
        const es = live(w, st);
        if (st.t >= 2.6 && st.t - DT < 2.6) for (const e of es) ev.push(...hitFrom(w, e, st.hx, st.hy - 8, 1e6));
        for (const x of ev) if (x.t === 'foeSplit' && st.ids.includes(x.id)) st.ids.push(...x.ids);
        if (st.t >= 4.4 && st.t - DT < 4.4) for (const e of live(w, st)) if (e.kind === 'splitling') ev.push(...hitFrom(w, e, st.hx, st.hy - 8, 1e6));
      },
    },
    { kind: 'soldier', hx: CX - 60, hy: CY + 5, sx: CX - 5, sy: CY - 5, script: basic(1.3, 6) },
    { kind: 'caster', hx: CX + 100, hy: CY + 5, sx: CX + 215, sy: CY + 5, script: basic(1.5, 7) },
    {
      kind: 'cavalry',
      hx: CX + 165,
      hy: CY + 95,
      sx: CX - 15,
      sy: CY + 95,
      // 骑兵：冲完、喘完一口气就打死它，再从起点来一次
      script(st, w, ev) {
        for (const e of live(w, st)) {
          if (every(st, 2.5, 0.5)) ev.push(...hitFrom(w, e, st.hx, st.hy - 8));
          if ((e.act === 'rest' && (e.actT ?? 0) < 0.25) || st.t > 9) ev.push(...hitFrom(w, e, e.x + 20, e.y, 1e6));
        }
      },
    },
    { kind: 'elite', hx: CX - 205, hy: CY + 100, sx: CX - 135, sy: CY + 100, script: basic(0.9, 6) },
  ];
  // 第二章的三种（?enemylab=ch2）：幡手带两只回响兵（看得见魂光连过去）；傀儡走一段留下红沙、打死散一片；风吼妖绕到侧面冲过去把人吹开
  const ch2: typeof all = [
    { kind: 'bannerman', with: ['soldier', 'soldier'], hx: CX - 170, hy: CY - 50, sx: CX - 90, sy: CY - 70, script: basic(1.4, 9) },
    { kind: 'golem', hx: CX + 70, hy: CY - 50, sx: CX + 175, sy: CY - 40, script: basic(1.2, 8) },
    { kind: 'windfiend', hx: CX - 40, hy: CY + 75, sx: CX + 90, sy: CY + 30, script: basic(2.2, 10) },
  ];
  // 第三章的三种（?enemylab=ch3）：飞剑灵绕着靶子、瞄准射来、射空掉头；门徒掷会拐弯的剑气；一对傀儡连着剑气线压过来（打掉一只线就断）
  const ch3: typeof all = [
    { kind: 'flysword', hx: CX - 150, hy: CY - 40, sx: CX - 60, sy: CY - 80, script: basic(1.6, 11) },
    { kind: 'disciple', hx: CX + 110, hy: CY - 60, sx: CX + 190, sy: CY - 40, script: basic(1.5, 10) },
    {
      kind: 'puppet',
      hx: CX - 20,
      hy: CY + 95,
      sx: CX + 90,
      sy: CY + 60,
      // 傀儡：补上的另一只摆到它下面（两只竖着一排、线横着压向靶子），打一阵后打掉一只（线断），再打掉另一只
      script(st, w, ev) {
        const es = live(w, st);
        if (st.t < 0.05 && es.length === 2) {
          es[1].x = es[1].px = es[0].x + 4;
          es[1].y = es[1].py = es[0].y + 60;
        }
        if (st.t >= 7 && st.t - DT < 7 && es[1]) ev.push(...hitFrom(w, es[1], st.hx, st.hy - 8, 1e6));
        if (st.t >= 9.5 && st.t - DT < 9.5) for (const e of es) ev.push(...hitFrom(w, e, st.hx, st.hy - 8, 1e6));
        for (const e of es) if (every(st, 1.4, 0.8)) ev.push(...hitFrom(w, e, st.hx, st.hy - 8));
      },
    },
  ];
  // 各章的精英（?enemylab=elites）：校尉照常走过来；夜叉潜进水里游到靶子脚下冒出来、贴近了拍浪；力士给身边的三只回响兵套金光（打它们先被挡下）；
  // 剑侍的三柄剑轮流射向靶子
  const elites: typeof all = [
    { kind: 'elite', name: 'xiaowei', hx: CX - 190, hy: CY - 70, sx: CX - 120, sy: CY - 70, script: basic(0.9, 8) },
    { kind: 'elite', name: 'yecha', elite: 'yecha', hx: CX + 60, hy: CY - 70, sx: CX + 180, sy: CY - 60, script: basic(1.1, 12) },
    { kind: 'elite', name: 'lishi', elite: 'lishi', with: ['soldier', 'soldier', 'soldier'], hx: CX - 190, hy: CY + 70, sx: CX - 110, sy: CY + 70, script: basic(2.2, 14) },
    { kind: 'elite', name: 'jianshi', elite: 'jianshi', hx: CX + 60, hy: CY + 75, sx: CX + 160, sy: CY + 60, script: basic(1.4, 14) },
  ];
  // 五条词缀（?enemylab=affixes）：各一只带一条的回响校尉（反震那只走到靶子身边挨打才震；召唤那只三秒后叫兵；分魂那只到时打死它），外加带两条的金光力士
  const affixes: typeof all = [
    { kind: 'elite', name: 'swift', affixes: ['swift'], hx: CX - 200, hy: CY - 80, sx: CX - 110, sy: CY - 80, script: basic(1.2, 9) },
    { kind: 'elite', name: 'armor', affixes: ['armor'], hx: CX - 20, hy: CY - 80, sx: CX + 60, sy: CY - 80, script: basic(0.6, 10) },
    { kind: 'elite', name: 'split', affixes: ['split'], hx: CX + 160, hy: CY - 80, sx: CX + 230, sy: CY - 70, script: basic(1, 5) },
    { kind: 'elite', name: 'recoil', affixes: ['recoil'], hx: CX - 200, hy: CY + 70, sx: CX - 150, sy: CY + 70, script: basic(0.8, 10) },
    { kind: 'elite', name: 'summon', affixes: ['summon'], hx: CX - 20, hy: CY + 70, sx: CX + 80, sy: CY + 60, script: basic(1.5, 12) },
    { kind: 'elite', name: 'two', elite: 'lishi', affixes: ['armor', 'split'], hx: CX + 160, hy: CY + 80, sx: CX + 225, sy: CY + 80, script: basic(1, 12) },
  ];
  // 对照表（?enemylab=gallery）：一行一种精英，一列一种词缀色（不带、迅捷、坚甲、分魂、反震、召唤），都定住不动、朝右
  const GALLERY_KINDS: EliteKind[] = ['xiaowei', 'yecha', 'lishi', 'jianshi'];
  const GALLERY_AFFIXES: (EliteAffix | null)[] = [null, 'swift', 'armor', 'split', 'recoil', 'summon'];
  const gallery: typeof all = [
    {
      kind: 'elite',
      name: 'gallery',
      noHero: true,
      hx: CX + 40,
      hy: CY,
      sx: CX,
      sy: CY,
      script: () => {},
      make(w, ev) {
        const ids: number[] = [];
        GALLERY_KINDS.forEach((k, r) => {
          GALLERY_AFFIXES.forEach((a, c) => {
            const e = spawnElite(w, k, CX - 140 + c * 56, CY - 78 + r * 58, ev, a ? [a] : []);
            e.x = e.px = CX - 140 + c * 56;
            e.y = e.py = CY - 78 + r * 58;
            e.speed = 0;
            e.cd = e.cd2 = e.callCd = 1e9;
            ids.push(e.id);
          });
        });
        // 靶子挪到画面右边很远的地方：大家都朝右站着
        w.players[0].x = w.players[0].px = CX + 1500;
        return ids;
      },
    },
  ];
  const groups = only === 'ch2' ? ch2 : only === 'ch3' ? ch3 : only === 'elites' ? elites : only === 'affixes' ? affixes : only === 'gallery' ? gallery : null;
  const chosen = groups ?? (only ? [...all, ...ch2, ...ch3, ...elites, ...affixes].filter((s) => (s.name ?? s.kind) === only) : all);
  const stations: Station[] = chosen.map((s, i) => ({
    ...s,
    w: createWorld(seed + i, 1),
    views: new EnemyViews(stage, particles, glows),
    fx: new EnemyFx(stage, particles, glows, shake, sfx),
    fx2: new Ch2FoeFx(stage, particles, glows, shake, sfx),
    fx3: new Ch3FoeFx(stage, particles, glows, shake, sfx),
    efx: new EliteFx(stage, particles, glows, shake, sfx),
    afx: null as unknown as AffixFx,
    ids: [],
    t: 0,
    gone: 0.5,
  }));
  for (const st of stations) st.afx = new AffixFx(stage, particles, glows, shake, sfx, st.views);
  if (only && !groups && stations[0]) {
    // 只摆一种：挪到镜头正中（骑兵的站要宽一点）
    const s = stations[0];
    const dx = CX + 40 - s.hx;
    const dy = CY - s.hy;
    s.hx += dx;
    s.sx += dx;
    s.hy += dy;
    s.sy += dy;
  }

  // ---------- 世界：每一站一个打不死的哪吒，刷怪关掉 ----------
  const quiet = (st: Station) => {
    const w = st.w;
    w.wave = 3;
    w.waveLen = 1e9;
    w.spawnAcc = -1e12;
    w.eliteDone = true;
    w.surgeDone = true;
    const p = w.players[0];
    p.x = p.px = st.hx;
    p.y = p.py = st.hy;
    p.weapons = [];
    p.pet.cd = 1e12;
    p.pet.x = p.pet.px = -9999;
    p.hp = p.stats.maxHp = 1e9;
    p.facing = st.sx >= st.hx ? 1 : -1;
  };
  stations.forEach(quiet);

  // 靶子哪吒
  const frames = makeNezhaFrames(DEFAULT_HAIR);
  const heroTex: Texture = textureFromGrid(frames.idle[0]);
  const heroFlash: Texture = flashTextureFromGrid(frames.idle[0]);
  const heroes = stations.map((st) => {
    const s = new Sprite(heroTex);
    s.visible = !st.noHero;
    s.anchor.set(NEZHA_ANCHOR.x / NEZHA_W, NEZHA_ANCHOR.y / NEZHA_H);
    s.position.set(st.hx, st.hy);
    s.zIndex = st.hy;
    s.scale.x = st.sx >= st.hx ? 1 : -1;
    stage.entities.addChild(s);
    const sh = new Sprite(stage.tex.shadow);
    sh.anchor.set(0.5);
    sh.alpha = 0.4;
    sh.position.set(st.hx, st.hy);
    sh.visible = !st.noHero;
    stage.floor.addChild(sh);
    return { s, flash: 0 };
  });

  const idle: PlayerInput = { mx: 0, my: 0, skill: false };
  let simTime = 0;

  /** 推进一个模拟步长：每一站的脚本、模拟、事件分发。 */
  function tick() {
    stations.forEach((st, si) => tickStation(st, si));
    simTime += DT;
  }
  function tickStation(st: Station, si: number) {
    const w = st.w;
    const extra: SimEvent[] = [];
    st.t += DT;
    const es = live(w, st);
    if (!es.length) {
      st.gone = st.gone < 0 ? 0 : st.gone + DT;
      if (st.gone > 1.2 && st.make) {
        st.ids = st.make(w, extra);
        st.t = 0;
        st.gone = -1;
      } else if (st.gone > 1.2) {
        const e = st.kind === 'elite' && (st.elite || st.affixes) ? spawnElite(w, st.elite ?? 'xiaowei', st.sx, st.sy, extra, st.affixes ?? []) : spawnEnemy(w, st.kind, st.sx, st.sy, extra);
        e.x = e.px = st.sx;
        e.y = e.py = st.sy;
        e.cd = 0.4;
        st.ids = [e.id];
        (st.with ?? []).forEach((k, n) => {
          const o = spawnEnemy(w, k, st.sx + 14 + n * 12, st.sy + 18 - n * 30, extra);
          st.ids.push(o.id);
        });
        st.t = 0;
        st.gone = -1;
      }
    } else st.script(st, w, extra);
    const ev = [...extra, ...step(w, [idle])];
    for (const x of ev) if ((x.t === 'foeSplit' || x.t === 'affixSplit' || x.t === 'eliteCall') && st.ids.includes(x.id)) for (const id of x.ids) if (!st.ids.includes(id)) st.ids.push(id);
    // 阵图傀儡第一帧补上的另一只也归这一站
    for (const x of ev) if (x.t === 'tetherOn') for (const id of [x.a, x.b]) if (!st.ids.includes(id) && (st.ids.includes(x.a) || st.ids.includes(x.b))) st.ids.push(id);
    for (const e of ev) {
      st.views.onEvent(e);
      st.fx.onEvent(e, w);
      st.fx2.onEvent(e, w);
      st.fx3.onEvent(e, w);
      st.efx.onEvent(e, w);
      st.afx.onEvent(e, w);
      if (e.t === 'hurt') heroes[si].flash = 0.16;
      if (e.t === 'kill') {
        const elite = e.kind === 'elite';
        glows.emit(e.x, e.y - 8, elite ? 34 : 9, [0x7cc4c4, 0x3f8a9e, 0xffffff], [20, elite ? 120 : 60], [0.3, 0.7], { up: 20, drag: 3 });
        particles.emit(e.x, e.y - 8, elite ? 16 : 4, 0xffffff, [60, 140], [0.08, 0.18]);
      }
      if (e.t === 'hit') particles.emit(e.x, e.y - 9, 1, [0xffffff, 0xf7dc7a], [30, 70], [0.1, 0.2]);
    }
  }

  /** 表现层推进 dt 秒（alpha：插值）。 */
  function render(dt: number, alpha: number) {
    for (const st of stations) {
      st.views.update(dt, st.w, alpha, st.hx);
      st.fx.update(dt, st.w, alpha);
      st.fx2.update(dt, st.w, alpha);
      st.fx3.update(dt, st.w, alpha);
      st.efx.update(dt, st.w, alpha);
      st.afx.update(dt, st.w, alpha, st.hx);
    }
    particles.update(dt);
    glows.update(dt);
    heroes.forEach((h) => {
      h.flash = Math.max(0, h.flash - dt);
      h.s.texture = h.flash > 0 ? heroFlash : heroTex;
      h.s.tint = h.flash > 0 ? 0xff9a8a : 0xffffff;
    });
    shake.update(dt);
    const [sx, sy] = shake.offset;
    const focus = only && !groups && stations[0] ? stations[0] : null;
    stage.lookAt(focus ? focus.hx - 40 : CX, focus ? focus.hy - 6 : CY + 8, sx, sy);
    stage.update(dt);
  }

  let paused = false;
  let acc = 0;
  stage.app.ticker.add((t) => {
    if (paused) return;
    const dt = Math.min(0.1, t.deltaMS / 1000);
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 6) {
      tick();
      acc -= DT;
      n++;
    }
    render(dt, Math.min(1, acc / DT));
  });

  (window as unknown as { __lab: unknown }).__lab = {
    get worlds() {
      return stations.map((st) => st.w);
    },
    pause(v: boolean) {
      paused = v;
    },
    /** 往前推 seconds 秒（按模拟步长），并立刻重画一帧。 */
    advance(seconds: number) {
      const n = Math.max(1, Math.round(seconds / DT));
      for (let i = 0; i < n; i++) {
        tick();
        render(DT, 1);
      }
      stage.app.render();
    },
    /** 重新开始（换个种子）。 */
    reset(s = seed) {
      stations.forEach((st, i) => {
        st.views.clear();
        st.fx.clear();
        st.fx2.clear();
        st.fx3.clear();
        st.efx.clear();
        st.afx.clear();
        st.w = createWorld(s + i, 1);
        quiet(st);
        st.ids = [];
        st.t = 0;
        st.gone = 0.5;
      });
      simTime = 0;
    },
    stats: () => ({ time: simTime.toFixed(2), enemies: stations.flatMap((st) => st.w.enemies.map((e) => `${e.kind}:${e.act ?? '-'}`)).join(' '), fps: Math.round(stage.app.ticker.FPS), view: [VIEW_W, VIEW_H] }),
  };
}
