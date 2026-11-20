// 角色实验页（网址加 ?herolab）：场景里摆一个角色（默认杨戬）和几只不动的假敌人，直接跑模拟里的出手与结算
// （专属法宝 updateWeapons、宠物 updatePet、神通 castSkill / updateHero、敌人身上的状态 tickStatus），画面和游戏里一模一样；
// 敌人保持有血、被击退之后慢慢走回原位。用来对照用户的美术口径反复改，也方便以后给用户看。
//
// 操作：← → 换演示（法宝 / 神通 / 宠物 / 被动 / 姿势），↑ ↓ 或 1–5 换品阶（4、5 是神品的两个器灵），空格立刻放一次，P 暂停。
// 网址参数：hero=nezha|yangjian|zhao|yunxiao|leizhenzi|mozha|wukong（默认 yangjian）；m=weapon|gaze|dog|rush|poses（gaze 是神通、dog 是宠物、rush 是被动，名字沿用杨戬的）；
// t=1..5；manual 手动时钟（截图脚本用 window.__herolab.advance / film）。
import { Sprite, type Texture } from 'pixi.js';
import { createStage } from '../render/stage.ts';
import { Particles, Shake } from '../render/juice.ts';
import { flashTextureFromGrid, textureFromGrid } from '../render/textures.ts';
import { Sfx } from '../audio/sfx.ts';
import { ARENA, DT } from '../sim/config.ts';
import { HEROES, WEAPONS } from '../sim/catalog.ts';
import { createWorld, spawnEnemy, type World } from '../sim/world.ts';
import { updatePending, updateWeapons } from '../sim/weapons.ts';
import { PET_KINDS, placePet, updatePet } from '../sim/pet.ts';
import { feared, fleeVel } from '../sim/heroes/passives.ts';
import { castSkill, updateHero } from '../sim/heroes/index.ts';
import { freezeEnemy, tickStatus } from '../sim/core.ts';
import type { EnemyKindName, HeroId, PetBranch, SimEvent } from '../sim/types.ts';
import { basePose, heroBare, heroFrames, HERO_POSES, HERO_VIEWS, type HeroPose } from './hero-views.ts';
import { HeroFx } from './heroes/index.ts';
import { PetViews } from './pets/index.ts';
import { EnemyViews } from './enemy-views.ts';

type Mode = 'weapon' | 'gaze' | 'dog' | 'rush' | 'poses';
const MODES: Mode[] = ['weapon', 'gaze', 'dog', 'rush', 'poses'];
const LABEL: Record<Mode, string> = { weapon: '专属法宝', gaze: '神通', dog: '宠物', rush: '被动', poses: '人物的帧' };
/** 假敌人的站位（相对人物；大多在右边，左边也有几只，看得到回锋、天眼扫过的整个扇面）。 */
const SPOTS: [number, number, EnemyKindName][] = [
  [34, -8, 'soldier'],
  [42, 10, 'soldier'],
  [56, -22, 'soldier'],
  [64, 4, 'soldier'],
  [78, -6, 'soldier'],
  [70, 26, 'shieldbearer'],
  [96, -18, 'soldier'],
  [104, 14, 'elite'],
  [-40, 6, 'soldier'],
  [-58, -14, 'soldier'],
  [-30, 30, 'soldier'],
];

export async function startHeroLab(mount: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const manual = params.has('manual');
  const heroId = (HEROES[params.get('hero') as HeroId] ? params.get('hero') : 'yangjian') as HeroId;
  const view = HERO_VIEWS[heroId];
  const stage = await createStage(mount, ARENA.w, ARENA.h);
  const { app, entities, floor, fx } = stage;
  const sfx = new Sfx();
  const shake = new Shake(6, 4, 1.7);
  const sparks = new Particles(fx, stage.tex.dot);
  const glows = new Particles(stage.glow, stage.tex.dot);
  addEventListener('pointerdown', () => sfx.unlock());

  const frames = heroFrames(heroId);
  const tex = Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.map(textureFromGrid)])) as Record<HeroPose, Texture[]>;
  const flash = Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.map(flashTextureFromGrid)])) as Record<HeroPose, Texture[]>;
  const heroS = new Sprite(tex.idle[0]);
  heroS.anchor.set(view.anchor.x / view.w, view.anchor.y / view.h);
  entities.addChild(heroS);
  const heroSh = new Sprite(stage.tex.shadow);
  heroSh.anchor.set(0.5);
  heroSh.alpha = 0.4;
  floor.addChild(heroSh);
  const heroFx = new HeroFx(stage, sparks, glows, shake, sfx, { sprite: (i) => (i === 0 ? heroS : undefined), tex: () => ({ tex, flash }) });
  const petFx = new PetViews(stage, sparks, sfx);
  const enemyViews = new EnemyViews(stage, sparks, glows);

  let mode: Mode = (MODES as string[]).includes(params.get('m') ?? '') ? (params.get('m') as Mode) : 'weapon';
  let tier = Math.max(1, Math.min(5, Number(params.get('t') ?? 1)));
  let world: World;
  let clock = 0;
  let paused = false;
  let flashT = 0;
  let poseI = 0;
  // 站在仙台旁边的青灰石地上（场心的祭台太亮，看不出刀光的对比）
  const HX = ARENA.w / 2 - 170;
  const HY = ARENA.h / 2 + 70;
  const home = new Map<number, [number, number]>();

  function setup() {
    heroFx.clear();
    petFx.clear();
    enemyViews.clear();
    world = createWorld(7, 1, [heroId]);
    world.phase = 'wave';
    const p = world.players[0];
    p.x = p.px = HX;
    p.y = p.py = HY;
    p.facing = 1;
    placePet(p); // 宠物摆回人物身边（开局时它在场地中间）
    const def = WEAPONS[HEROES[heroId].exclusive];
    const t = Math.min(4, tier);
    const spirit = tier >= 4 ? def.spirits[tier - 4].id : null;
    // 孙悟空：神通（法天象地）和被动（火眼金睛）都要看棒子打起来的样子，这两样也带着金箍棒
    const armed = mode === 'weapon' || (heroId === 'wukong' && (mode === 'gaze' || mode === 'rush'));
    p.weapons = armed ? [{ kind: HEROES[heroId].exclusive, tier: t, spirit, cd: 0.3 }] : [];
    p.pet.cd = mode === 'dog' ? 0.5 : 1e12;
    // 宠物的进化：品阶 2、3 当作一阶 / 三阶，4、5 是两条路的三阶
    const branches: PetBranch[] = PET_KINDS[HEROES[heroId].petKind].branches;
    p.pet.stage = tier >= 4 ? 3 : tier - 1;
    p.pet.branch = tier >= 4 ? branches[tier - 4] : tier >= 2 ? branches[0] : null;
    world.enemies = [];
    home.clear();
    // 被动（雷震子「生翅」）：脚下铺一大片红沙，看他踩在上面照样走得快、脚下离地一点滑过去
    world.patches = mode === 'rush' && heroId === 'leizhenzi' ? [{ id: world.nextId++, kind: 'sand', x: HX, y: HY, r: 60, t: 0, life: 1e9 }] : [];
    const ev: SimEvent[] = [];
    for (const [dx, dy, kind] of SPOTS) {
      const e = spawnEnemy(world, kind, HX + dx, HY + dy, ev);
      e.speed = 0;
      e.hp = e.maxHp = 9999;
      home.set(e.id, [e.x, e.y]);
    }
    for (const e of ev) enemyViews.onEvent(e);
    clock = 0;
    poseI = 0;
  }

  /** 推进一步（dt 秒）：只跑这几样的模拟，敌人不动、不打人。 */
  function step(dt: number) {
    if (paused) return;
    clock += dt;
    const w = world;
    const p = w.players[0];
    const ev: SimEvent[] = [];
    let left = dt;
    while (left > 1e-9) {
      const d = Math.min(DT, left);
      left -= d;
      w.time += d;
      const tc = clock - left; // 这一小步结束时的演示时钟（按小步判定「到了第几秒」：一步 dt 拆成几小步时不漏、不重）
      for (const o of [...w.players, ...w.enemies]) {
        o.px = o.x;
        o.py = o.y;
      }
      // 被动（云霄「冰心」）：站着不动，每 2.4 秒把身边的敌人冻住 1.6 秒（冻住的冰壳里亮起冰心）
      if (mode === 'rush' && heroId === 'yunxiao') {
        p.moving = false;
        if (Math.floor(tc / 2.4) !== Math.floor((tc - d) / 2.4) || tc <= d) for (const e of w.enemies) if (Math.hypot(e.x - p.x, e.y - p.y) < 110) freezeEnemy(w, e, p.id, 1.6, ev);
      } else if (mode === 'rush') {
        // 被动（杨戬「乘隙」）：一直绕着小圈跑，暴击就续上加速（演示时每 1.2 秒假装暴击一次）
        const a = tc * 1.6;
        p.x = HX + Math.cos(a) * 34;
        p.y = HY + Math.sin(a) * 20;
        p.moving = true;
        p.facing = -Math.sin(a) >= 0 ? 1 : -1;
        if (Math.floor(tc / 1.2) !== Math.floor((tc - d) / 1.2)) p.rushUntil = w.time + 1;
        if (heroId === 'huiao') p.hp = p.stats.maxHp; // 回响敖丙的被动「龙鳞」：满血时肩头闪冷光
        if (heroId === 'mozha') p.hp = p.stats.maxHp * 0.2; // 魔化哪吒的被动「业火」：残血时身上冒黑焰
        if (heroId === 'huizhao') p.grudge = Math.min(1, (p.grudge ?? 0) + d * 0.45); // 回响赵公明的被动「怨力」：假装一直在挨打，约两秒攒满震一圈
        if (heroId === 'huiyun') for (const e of w.enemies) e.stun = Math.max(e.stun, 0.3); // 回响云霄的被动「截教」：身边的都定住（袖口飘剑气碎光）
      } else p.moving = false;
      // 冲出去的神通（魔化哪吒「火尖枪突进」）：冲完、那条线烧完就回到原位，下一次从原位再冲
      if (p.hualong) {
        // 回响敖丙「化龙」：这几秒绕着敌群游一圈（看白龙的身子沿路摆、扫过的敌人挨打），变回来的时候正好回到原位
        const k = (w.time - p.hualong.t0) / (p.hualong.until - p.hualong.t0);
        const a = k * Math.PI * 2;
        p.x = HX + 46 - Math.cos(a) * 46;
        p.y = HY + Math.sin(a) * 30;
        p.moving = true;
        p.facing = Math.sin(a) >= 0 ? 1 : -1;
      } else if (!p.dash && mode !== 'rush') {
        p.x = HX;
        p.y = HY;
      }
      updateWeapons(w, p, d, ev);
      updatePet(w, p, d, ev);
      const every = heroId === 'wukong' ? 8 : 3.2; // 法天象地一放 6 秒：等它变回来再放
      if (mode === 'gaze' && (Math.floor(tc / every) !== Math.floor((tc - d) / every) || (heroId === 'wukong' && tc <= d))) castSkill(w, p, ev);
      updateHero(w, p, d, ev);
      updatePending(w, d, ev); // 延时落下的（赵公明的定海珠）
      for (const e of w.enemies) {
        tickStatus(w, e, d, ev);
        e.hp = Math.max(e.hp, e.maxHp * 0.6);
        // 被击退之后慢慢走回原位（被黑虎震慑的先往外逃，吓完再走回来）
        const h = home.get(e.id)!;
        const [fx, fy] = feared(w, e) && e.stun <= 0 ? fleeVel({ ...e, speed: 30 }) : [0, 0];
        const back = e.stun > 0 || fx || fy ? 0 : 1.5;
        e.x += (e.kx + fx) * d + (h[0] - e.x) * back * d;
        e.y += (e.ky + fy) * d + (h[1] - e.y) * back * d;
        const decay = Math.exp(-d * 9);
        e.kx *= decay;
        e.ky *= decay;
      }
    }
    for (const e of ev) {
      heroFx.onEvent(e, w);
      petFx.onEvent(e, w);
      enemyViews.onEvent(e);
      if (e.t === 'hurt') flashT = 0.16;
    }
    draw(dt);
  }

  function draw(dt: number) {
    const w = world;
    const p = w.players[0];
    flashT = Math.max(0, flashT - dt);
    let pose: HeroPose;
    if (mode === 'poses') {
      // 每 0.9 秒换一组帧
      const all: HeroPose[] = frames.fly ? [...HERO_POSES, 'fly', 'dive', 'slam'] : HERO_POSES;
      pose = all[Math.floor(clock / 0.9) % all.length];
      poseI = Math.floor(clock * 5);
    } else {
      const base = basePose(p, heroBare(p, heroFx.busy(0)));
      pose = heroFx.pose(0) ?? base;
      poseI = Math.floor(clock * (p.moving ? 10 : 5));
    }
    const set = flashT > 0 ? flash : tex;
    const fr = set[pose] ?? set.idle;
    heroS.texture = fr[poseI % fr.length];
    heroS.scale.x = p.facing;
    heroS.position.set(Math.round(p.x), Math.round(p.y) - Math.round(heroFx.lift(0)));
    heroS.zIndex = Math.round(p.y);
    heroSh.position.set(Math.round(p.x), Math.round(p.y));
    enemyViews.update(dt, w, 1, p.x);
    heroFx.update(dt, w, 1);
    petFx.update(dt, w, 1);
    sparks.update(dt);
    glows.update(dt);
    shake.update(dt);
    stage.lookAt(HX, HY - 12, 0, 0);
    stage.update(dt);
  }

  setup();
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'arrowleft') {
      mode = MODES[(MODES.indexOf(mode) + (k === 'arrowright' ? 1 : MODES.length - 1)) % MODES.length];
      setup();
    } else if (k === 'arrowup' || k === 'arrowdown') {
      tier = Math.max(1, Math.min(5, tier + (k === 'arrowup' ? 1 : -1)));
      setup();
    } else if (/^[1-5]$/.test(k)) {
      tier = Number(k);
      setup();
    } else if (k === ' ') {
      const p = world.players[0];
      const ev: SimEvent[] = [];
      if (mode === 'gaze') castSkill(world, p, ev);
      else for (const x of p.weapons) x.cd = 0;
      for (const e of ev) heroFx.onEvent(e, world);
    } else if (k === 'p') paused = !paused;
  });
  if (manual) app.ticker.stop();
  else app.ticker.add((t) => step(Math.min(0.05, t.deltaMS / 1000)));

  const api = {
    get world() {
      return world;
    },
    /** 切到某个演示的某个品阶，从头开始。 */
    pick(m: Mode, t: number) {
      mode = m;
      tier = t;
      setup();
    },
    /** 手动时钟：推进 n 步、每步 dt 秒，然后画一帧。 */
    advance(dt: number, n = 1) {
      for (let i = 0; i < n; i++) step(dt);
      app.renderer.render(app.stage);
    },
    /** 连拍：每隔 every 秒拍一张（画面坐标的 crop 区域，放大 scale 倍），拼成 cols 列的一张图，返回 dataURL。 */
    film(n: number, every: number, crop: [number, number, number, number], scale = 3, cols = 4, sub = 4) {
      const [cx, cy, cw, ch] = crop;
      const rows = Math.ceil(n / cols);
      const out = document.createElement('canvas');
      out.width = cols * (cw * scale + 4) + 4;
      out.height = rows * (ch * scale + 4) + 4;
      const g = out.getContext('2d')!;
      g.fillStyle = '#100c14';
      g.fillRect(0, 0, out.width, out.height);
      g.imageSmoothingEnabled = false;
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < sub; s++) step(every / sub);
        app.renderer.render(app.stage);
        const z = stage.zoom;
        g.drawImage(app.canvas, cx * z, cy * z, cw * z, ch * z, 4 + (i % cols) * (cw * scale + 4), 4 + Math.floor(i / cols) * (ch * scale + 4), cw * scale, ch * scale);
      }
      return out.toDataURL('image/png');
    },
    stats: () => ({ mode, label: LABEL[mode], tier, clock: clock.toFixed(2), enemies: world.enemies.length }),
  };
  (window as unknown as { __herolab: typeof api }).__herolab = api;
}
