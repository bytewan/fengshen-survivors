// M0 第一步：画风试画场景。悬在云海上的一块回响仙台：
// 哪吒（待机 / 移动 / 掷乾坤圈）、回响兵、青白玉地面与发光阵法、剑冢、灵石、玉碑、莲花灯、符箓、鬼火，
// 加上云海、灵光、花瓣、云影和暗角。用户口径：修仙玄幻的神话史诗感，不是历史考古；背景不要黑；人物身上不要光圈。
// 这里只验证「画风过不过关」；手感（伤害、命中停顿、震屏、音效）是第二步的事。
import { Application, Container, Graphics, RenderTexture, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { grid } from '../art/pixel.ts';
import { mulberry32 } from '../art/ground.ts';
import { makeCloudTile, makePlaza } from '../art/plaza.ts';
import { DEFAULT_HAIR, makeNezhaFrames, NEZHA_ANCHOR, NEZHA_H, NEZHA_W, RING_PROJECTILE, type HairStyle, type NezhaPose } from '../art/sprites/nezha.ts';
import { SOLDIER_ANCHOR, SOLDIER_FRAMES, SOLDIER_H, SOLDIER_W } from '../art/sprites/soldier.ts';
import { CRYSTAL, FLOAT_TALISMAN, GHOST_FIRE, GRASS, JADE_LANTERN, LOTUS, PILLAR, STELE, SWORD } from '../art/sprites/decor.ts';
import {
  flashTextureFromGrid,
  steppedLightTexture,
  textureFromBitmap,
  textureFromGrid,
  vignetteTexture,
} from '../render/textures.ts';

export const VIEW_W = 480;
export const VIEW_H = 270;
const WORLD_W = 960;
const WORLD_H = 540;
const MARGIN = 150; // 场地外能看到的云海宽度
const CLIFF = 26; // 仙台下沿露出的崖壁高度

/** 按设备像素取整数倍放大，保证每个游戏像素都是整数个物理像素。 */
function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / VIEW_W, (innerHeight * dpr) / VIEW_H)));
  canvas.style.width = `${(VIEW_W * k) / dpr}px`;
  canvas.style.height = `${(VIEW_H * k) / dpr}px`;
}

interface Light {
  sprite: Sprite;
  x: number;
  y: number;
  base: number; // 基础亮度
  flicker: number; // 闪烁幅度
  seed: number;
}

export async function startArtTrial(mount: HTMLElement) {
  const app = new Application();
  await app.init({
    width: VIEW_W,
    height: VIEW_H,
    antialias: false,
    resolution: 1,
    roundPixels: true,
    background: '#1a1520',
  });
  mount.appendChild(app.canvas);
  fitCanvas(app.canvas);
  addEventListener('resize', () => fitCanvas(app.canvas));

  const rnd = mulberry32(20261109);
  let camX = 0;
  let camY = 0;

  // ---------- 纹理 ----------
  const tex = (gs: ReturnType<typeof grid>[]) => gs.map(textureFromGrid);
  const params = new URLSearchParams(location.search);
  const hair = (['single', 'cluster', 'double', 'round', 'bigsingle', 'backsingle', 'backtwin'].includes(params.get('hair') ?? '') ? params.get('hair') : DEFAULT_HAIR) as HairStyle;
  const NEZHA_FRAMES = makeNezhaFrames(hair);
  const heroTex: Record<NezhaPose, Texture[]> = {
    idle: tex(NEZHA_FRAMES.idle),
    move: tex(NEZHA_FRAMES.move),
    idleBare: tex(NEZHA_FRAMES.idleBare),
    moveBare: tex(NEZHA_FRAMES.moveBare),
    windup: tex(NEZHA_FRAMES.windup),
    throw: tex(NEZHA_FRAMES.throw),
    follow: tex(NEZHA_FRAMES.follow),
  };
  const soldierTex = tex(SOLDIER_FRAMES.walk);
  const soldierFlash = SOLDIER_FRAMES.walk.map(flashTextureFromGrid);
  const ringTex = tex(RING_PROJECTILE);
  const shadowTex = textureFromGrid(grid(['..kkkkkkkk..', 'kkkkkkkkkkkk', '..kkkkkkkk..']));
  const smallShadowTex = textureFromGrid(grid(['.kkkkkk.', 'kkkkkkkk', '.kkkkkk.']));
  const dotTex = textureFromGrid(grid(['W']));
  const lightL = steppedLightTexture(72, 5);
  const lightM = steppedLightTexture(40, 4);
  const lightS = steppedLightTexture(14, 3);

  // ---------- 场景树 ----------
  const world = new Container();
  // 云海：两层可平铺的云，慢速相对滚动（暮色暖云在下、天青冷云在上）
  const cloudFar = new TilingSprite({ texture: textureFromBitmap(makeCloudTile(256, 3, 'far')), width: WORLD_W + MARGIN * 2, height: WORLD_H + MARGIN * 2 });
  const cloudNear = new TilingSprite({ texture: textureFromBitmap(makeCloudTile(256, 9, 'near')), width: WORLD_W + MARGIN * 2, height: WORLD_H + MARGIN * 2 });
  cloudFar.position.set(-MARGIN, -MARGIN);
  cloudNear.position.set(-MARGIN, -MARGIN);
  // 仙台本体
  const plaza = makePlaza(WORLD_W, WORLD_H, 11);
  const ground = new Sprite(textureFromBitmap(plaza.base));
  // 仙台下沿的台基：白玉立面 + 上下金边 + 竖向板缝，底部渐隐进云雾
  const cliff = new Graphics();
  cliff.rect(0, WORLD_H, WORLD_W, 1).fill({ color: 0xe0a83a });
  cliff.rect(0, WORLD_H + 1, WORLD_W, 10).fill({ color: 0xc9bcae });
  cliff.rect(0, WORLD_H + 11, WORLD_W, 1).fill({ color: 0xe0a83a });
  cliff.rect(0, WORLD_H + 12, WORLD_W, 6).fill({ color: 0x8f9787 });
  for (let x = 12; x < WORLD_W; x += 24) cliff.rect(x, WORLD_H + 2, 1, 9).fill({ color: 0x9a8a86 });
  for (let x = 0; x < WORLD_W; x += 48) cliff.rect(x + 20, WORLD_H + 5, 8, 2).fill({ color: 0xf2e8d5 });
  for (let k = 0; k < 4; k++) cliff.rect(0, WORLD_H + 18 + k * 2, WORLD_W, 2).fill({ color: 0x6d756c, alpha: 0.6 - k * 0.14 });
  // 左右和上沿：一像素金边 + 一圈玉边
  cliff.rect(-2, -2, WORLD_W + 4, 2).fill({ color: 0xc9bcae });
  cliff.rect(-2, -2, 2, WORLD_H + 2).fill({ color: 0xc9bcae });
  cliff.rect(WORLD_W, -2, 2, WORLD_H + 2).fill({ color: 0xc9bcae });
  cliff.rect(-3, -3, WORLD_W + 6, 1).fill({ color: 0xe0a83a });
  // 阵法与榜裂里透出的光：单独一层，叠加混合并缓慢呼吸
  const formation = new Sprite(textureFromBitmap(plaza.glow));
  formation.blendMode = 'add';
  const floor = new Container(); // 贴地的零碎：不参与前后排序
  const entities = new Container({ sortableChildren: true });
  const fx = new Container();
  world.addChild(cloudFar, cloudNear, cliff, ground, formation, floor, entities, fx);

  // 光照：屏幕空间的光照图，乘到整个世界上
  const lightRT = RenderTexture.create({ width: VIEW_W, height: VIEW_H });
  lightRT.source.scaleMode = 'nearest';
  const lightScene = new Container();
  lightScene.addChild(new Sprite(vignetteTexture(VIEW_W, VIEW_H, [255, 252, 244], [176, 162, 200])));
  // 云影：几团柔和的暗斑在地面上缓慢飘过
  const blobTex = (() => {
    const r = 90;
    const data = new Uint8ClampedArray(r * 2 * r * 2 * 4);
    for (let y = 0; y < r * 2; y++)
      for (let x = 0; x < r * 2; x++) {
        const d = Math.hypot(x - r, (y - r) * 1.6) / r;
        if (d < 1) data.set([96, 84, 128, Math.round(255 * (1 - d) ** 1.5 * 0.55)], (y * r * 2 + x) * 4);
      }
    return textureFromBitmap({ w: r * 2, h: r * 2, data });
  })();
  const cloudShadows = Array.from({ length: 3 }, (_, i) => {
    const sp = new Sprite(blobTex);
    sp.anchor.set(0.5);
    sp.scale.set(1.6 + i * 0.4);
    lightScene.addChild(sp);
    return { sp, x: rnd() * WORLD_W, y: rnd() * WORLD_H, v: 6 + rnd() * 5 };
  });
  const lightLayer = new Container();
  lightScene.addChild(lightLayer);
  const lightOverlay = new Sprite(lightRT);
  lightOverlay.blendMode = 'multiply';

  // 叠加发光：世界坐标，跟着镜头走，加法混合
  const glow = new Container();
  glow.blendMode = 'add';

  const ui = new Container();
  app.stage.addChild(world, lightOverlay, glow, ui);

  const lights: Light[] = [];
  const addLight = (t: Texture, tint: number, base: number, flicker = 0.05): Light => {
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.tint = tint;
    s.blendMode = 'add';
    lightLayer.addChild(s);
    const l = { sprite: s, x: 0, y: 0, base, flicker, seed: rnd() * 100 };
    lights.push(l);
    return l;
  };
  const addGlow = (t: Texture, tint: number, alpha: number) => {
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.tint = tint;
    s.alpha = alpha;
    glow.addChild(s);
    return s;
  };

  // ---------- 结界：场地边缘一圈天青色虚线，缓慢呼吸 ----------
  const barrier = new Graphics();
  const INSET = 10;
  for (let x = INSET; x < WORLD_W - INSET; x += 6) {
    barrier.rect(x, INSET, 3, 1).rect(x, WORLD_H - INSET, 3, 1);
  }
  for (let y = INSET; y < WORLD_H - INSET; y += 6) {
    barrier.rect(INSET, y, 1, 3).rect(WORLD_W - INSET, y, 1, 3);
  }
  barrier.fill({ color: 0x7cc4c4 });
  fx.addChild(barrier);

  // ---------- 道具 ----------
  const place = (g: ReturnType<typeof grid>, x: number, y: number, parent: Container, sort = true) => {
    const s = new Sprite(textureFromGrid(g));
    s.anchor.set(0.5, 1);
    s.position.set(Math.round(x), Math.round(y));
    if (sort) s.zIndex = y;
    parent.addChild(s);
    return s;
  };
  const C = plaza.center;
  const nearAltar = (x: number, y: number, pad = 18) => Math.hypot(x - C.x, y - C.y) < plaza.radius + pad;
  const scatter = (n: number, pad: number, fn: (x: number, y: number) => void) => {
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 30; tries++) {
      const x = 40 + rnd() * (WORLD_W - 80);
      const y = 50 + rnd() * (WORLD_H - 70);
      if (nearAltar(x, y, pad) || Math.hypot(x - C.x, y - C.y) < 60) continue;
      fn(x, y);
      placed++;
    }
  };
  const shadowAt = (x: number, y: number, t = smallShadowTex, a = 0.3) => {
    const sh = new Sprite(t);
    sh.anchor.set(0.5);
    sh.alpha = a;
    sh.position.set(Math.round(x), Math.round(y));
    floor.addChild(sh);
  };
  // 砖缝里零星的灵草小簇
  scatter(26, 6, (x, y) => place(GRASS[Math.floor(rnd() * 2)], x, y, floor, false));
  // 祭台四角：断柱
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const x = C.x + Math.cos(a) * (plaza.radius + 26);
    const y = C.y + Math.sin(a) * (plaza.radius + 14);
    place(PILLAR, x, y, entities);
    shadowAt(x, y, shadowTex, 0.35);
  }
  // 白玉石灯：祭台正前后左右
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const x = C.x + dx * (plaza.radius + 40);
    const y = C.y + dy * (plaza.radius + 22);
    place(JADE_LANTERN, x, y, entities);
    shadowAt(x, y);
    addGlow(lightS, 0x7cc4c4, 0.3).position.set(x, y - 9);
  }
  // 玉碑
  scatter(3, 40, (x, y) => {
    place(STELE, x, y, entities);
    shadowAt(x, y, shadowTex, 0.3);
  });
  // 剑冢：一簇三四把仙剑，剑刃有一点天青灵光
  scatter(3, 30, (x, y) => {
    const n = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const sx = x + (i - n / 2) * 7 + rnd() * 3;
      const sy = y + (i % 2) * 5;
      place(SWORD, sx, sy, entities);
      addGlow(steppedLightTexture(5, 2), 0x7cc4c4, 0.22).position.set(Math.round(sx + 1), Math.round(sy - 8));
    }
    shadowAt(x, y + 3, shadowTex, 0.25);
  });
  // 灵石晶簇
  scatter(4, 26, (x, y) => {
    place(CRYSTAL, x, y, entities);
    shadowAt(x, y);
    addGlow(lightS, rnd() < 0.5 ? 0x7cc4c4 : 0xd47aa0, 0.3).position.set(Math.round(x), Math.round(y - 7));
  });
  // 漂浮的莲花灯与符箓（会上下浮动）
  const lotusTex = tex(LOTUS);
  const talismanTex = tex(FLOAT_TALISMAN);
  const floaters: { s: Sprite; x: number; y: number; t: number; tx: Texture[]; glow: Sprite; lift: number }[] = [];
  scatter(6, 10, (x, y) => {
    const isLotus = floaters.length % 2 === 0;
    const t = isLotus ? lotusTex : talismanTex;
    const s = new Sprite(t[0]);
    s.anchor.set(0.5, 1);
    entities.addChild(s);
    shadowAt(x, y, smallShadowTex, 0.18);
    floaters.push({ s, x, y, t: rnd() * 10, tx: t, glow: addGlow(lightS, isLotus ? 0xffe9a8 : 0xf7dc7a, 0.3), lift: isLotus ? 16 : 22 });
  });

  // 鬼火：在场上缓慢漂浮
  const ghostTex = tex(GHOST_FIRE);
  const ghosts = Array.from({ length: 4 }, () => {
    const s = new Sprite(ghostTex[0]);
    s.anchor.set(0.5, 1);
    entities.addChild(s);
    const g = { s, x: 60 + rnd() * (WORLD_W - 120), y: 60 + rnd() * (WORLD_H - 120), t: rnd() * 10, glow: addGlow(lightS, 0x7cc4c4, 0.28) };
    return g;
  });

  // ---------- 哪吒 ----------
  const heroShadow = new Sprite(shadowTex);
  heroShadow.anchor.set(0.5);
  heroShadow.alpha = 0.45;
  floor.addChild(heroShadow);
  const hero = {
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    facing: 1,
    pose: 'idle' as NezhaPose,
    poseT: 0,
    animT: 0,
    attackCd: 1.2,
    sprite: new Sprite(heroTex.idle[0]),
  };
  hero.sprite.anchor.set(NEZHA_ANCHOR.x / NEZHA_W, NEZHA_ANCHOR.y / NEZHA_H);
  entities.addChild(hero.sprite);

  // ---------- 回响兵 ----------
  const soldiers = Array.from({ length: 10 }, () => {
    const s = new Sprite(soldierTex[0]);
    s.anchor.set(SOLDIER_ANCHOR.x / SOLDIER_W, SOLDIER_ANCHOR.y / SOLDIER_H);
    entities.addChild(s);
    const sh = new Sprite(smallShadowTex);
    sh.anchor.set(0.5);
    sh.alpha = 0.35;
    floor.addChild(sh);
    const ang = rnd() * Math.PI * 2;
    const dist = 120 + rnd() * 220;
    return {
      s,
      sh,
      x: hero.x + Math.cos(ang) * dist,
      y: hero.y + Math.sin(ang) * dist * 0.7,
      speed: 14 + rnd() * 10,
      t: rnd() * 4,
      flash: 0,
      eye: addGlow(steppedLightTexture(3, 2), 0x7cc4c4, 0.6),
    };
  });

  // ---------- 乾坤圈 ----------
  interface Ring {
    x: number;
    y: number;
    vx: number;
    vy: number;
    out: number;
    returning: boolean;
    t: number;
    s: Sprite;
    trail: Sprite[];
    hist: [number, number][];
    light: Light;
    hit: Set<object>;
  }
  const rings: Ring[] = [];
  const throwRing = () => {
    let best: (typeof soldiers)[number] | null = null;
    let bd = 1e9;
    for (const so of soldiers) {
      const d = Math.hypot(so.x - hero.x, so.y - hero.y);
      if (d < bd) {
        bd = d;
        best = so;
      }
    }
    const tx = best ? best.x : hero.x + hero.facing * 100;
    const ty = best ? best.y - 8 : hero.y - 12;
    const sx = hero.x + hero.facing * 10;
    const sy = hero.y - 13;
    const d = Math.hypot(tx - sx, ty - sy) || 1;
    const s = new Sprite(ringTex[0]);
    s.anchor.set(0.5);
    const trail = [0.45, 0.25, 0.12].map((a) => {
      const t = new Sprite(ringTex[0]);
      t.anchor.set(0.5);
      t.alpha = a;
      t.tint = 0xffd070;
      fx.addChild(t);
      return t;
    });
    fx.addChild(s);
    rings.push({
      x: sx,
      y: sy,
      vx: ((tx - sx) / d) * 270,
      vy: ((ty - sy) / d) * 270,
      out: 0,
      returning: false,
      t: 0,
      s,
      trail,
      hist: [],
      light: addLight(lightS, 0xffd070, 0.5, 0.05),
      hit: new Set(),
    });
  };

  // ---------- 灵光与桃花瓣：在镜头附近生成，缓慢漂移 ----------
  const motes: { s: Sprite; x: number; y: number; vx: number; vy: number; t: number; life: number; petal: boolean }[] = [];
  const petalTex = [grid(['mw', 'pm']), grid(['m.', 'wm']), grid(['.m', 'mp'])].map(textureFromGrid);
  const spawnMote = (petal: boolean) => {
    const s = new Sprite(petal ? petalTex[Math.floor(rnd() * 3)] : dotTex);
    if (!petal) {
      s.tint = rnd() < 0.6 ? 0xffe9a8 : 0x7cc4c4;
      s.blendMode = 'add';
    }
    (petal ? fx : glow).addChild(s);
    motes.push({
      s,
      x: camX - 20 + rnd() * (VIEW_W + 40),
      y: camY + (petal ? -10 : rnd() * VIEW_H),
      vx: petal ? 8 + rnd() * 10 : (rnd() - 0.5) * 4,
      vy: petal ? 10 + rnd() * 8 : -4 - rnd() * 8,
      t: rnd() * 10,
      life: petal ? 30 : 5 + rnd() * 6,
      petal,
    });
  };

  // ---------- 火星 ----------
  const sparks: { s: Sprite; vx: number; vy: number; life: number; max: number }[] = [];
  const spark = (x: number, y: number, color: number, vx: number, vy: number, life: number) => {
    const s = new Sprite(dotTex);
    s.tint = color;
    s.position.set(x, y);
    fx.addChild(s);
    sparks.push({ s, vx, vy, life, max: life });
  };

  // ---------- 输入：键盘 + 浮动摇杆 ----------
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  const stick = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
  const stickBase = new Graphics().circle(0, 0, 18).stroke({ width: 1, color: 0xc9bcae, alpha: 0.5 });
  const stickKnob = new Graphics().circle(0, 0, 7).fill({ color: 0xc9bcae, alpha: 0.5 });
  stickBase.visible = stickKnob.visible = false;
  ui.addChild(stickBase, stickKnob);
  const toView = (e: PointerEvent) => {
    const r = app.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * VIEW_W, ((e.clientY - r.top) / r.height) * VIEW_H] as const;
  };
  app.canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = toView(e);
    if (stick.active) return;
    Object.assign(stick, { active: true, id: e.pointerId, ox: x, oy: y, dx: 0, dy: 0 });
    app.canvas.setPointerCapture(e.pointerId);
  });
  app.canvas.addEventListener('pointermove', (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    const [x, y] = toView(e);
    let dx = x - stick.ox;
    let dy = y - stick.oy;
    const m = Math.hypot(dx, dy);
    if (m > 18) {
      dx = (dx / m) * 18;
      dy = (dy / m) * 18;
    }
    stick.dx = dx;
    stick.dy = dy;
  });
  const endStick = (e: PointerEvent) => {
    if (e.pointerId === stick.id) Object.assign(stick, { active: false, id: -1, dx: 0, dy: 0 });
  };
  app.canvas.addEventListener('pointerup', endStick);
  app.canvas.addEventListener('pointercancel', endStick);

  // ---------- 主循环 ----------
  let time = 0;
  let sparkCd = 0;
  const POSE_LEN: Partial<Record<NezhaPose, number>> = { windup: 0.11, throw: 0.09, follow: 0.16 };

  app.ticker.add((ticker) => {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    time += dt;

    // 移动
    let mx = 0;
    let my = 0;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (stick.active && Math.hypot(stick.dx, stick.dy) > 3) {
      mx = stick.dx / 18;
      my = stick.dy / 18;
    }
    const mm = Math.hypot(mx, my);
    if (mm > 1) {
      mx /= mm;
      my /= mm;
    }
    const moving = mm > 0.15;
    hero.x = Math.max(24, Math.min(WORLD_W - 24, hero.x + mx * 78 * dt));
    hero.y = Math.max(34, Math.min(WORLD_H - 16, hero.y + my * 78 * dt));
    if (mx > 0.1) hero.facing = 1;
    if (mx < -0.1) hero.facing = -1;

    // 姿势：攻击序列优先，其余按是否移动
    hero.attackCd -= dt;
    if (hero.attackCd <= 0 && rings.length === 0) {
      hero.pose = 'windup';
      hero.poseT = 0;
      hero.attackCd = 1.5;
    }
    hero.poseT += dt;
    const len = POSE_LEN[hero.pose];
    if (len !== undefined && hero.poseT >= len) {
      if (hero.pose === 'windup') {
        hero.pose = 'throw';
        throwRing();
      } else if (hero.pose === 'throw') hero.pose = 'follow';
      else hero.pose = moving ? 'move' : 'idle';
      hero.poseT = 0;
    }
    if (hero.pose === 'idle' || hero.pose === 'move') hero.pose = moving ? 'move' : 'idle';
    hero.animT += dt;
    const frames = heroTex[hero.pose];
    const fps = hero.pose === 'move' ? 10 : 5;
    hero.sprite.texture = frames[Math.floor(hero.animT * fps) % frames.length];
    hero.sprite.scale.x = hero.facing;
    hero.sprite.position.set(Math.round(hero.x), Math.round(hero.y));
    hero.sprite.zIndex = hero.y;
    heroShadow.position.set(Math.round(hero.x), Math.round(hero.y));

    // 风火轮火星
    sparkCd -= dt;
    if (sparkCd <= 0) {
      sparkCd = moving ? 0.035 : 0.12;
      const back = -hero.facing;
      spark(
        hero.x + back * (4 + rnd() * 6),
        hero.y - 2 - rnd() * 3,
        rnd() < 0.5 ? 0xf2814a : 0xf7dc7a,
        back * (moving ? 30 : 6) + (rnd() - 0.5) * 10,
        -14 - rnd() * 18,
        0.35 + rnd() * 0.35,
      );
    }

    // 回响兵：朝哪吒缓慢逼近，彼此留出间隔
    for (const so of soldiers) {
      let vx = hero.x - so.x;
      let vy = hero.y - so.y;
      const d = Math.hypot(vx, vy) || 1;
      vx /= d;
      vy /= d;
      if (d < 26) {
        vx = -vx * 0.3;
        vy = -vy * 0.3;
      }
      for (const o of soldiers) {
        if (o === so) continue;
        const ox = so.x - o.x;
        const oy = so.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od < 14 && od > 0) {
          vx += (ox / od) * 0.8;
          vy += (oy / od) * 0.8;
        }
      }
      so.x += vx * so.speed * dt;
      so.y += vy * so.speed * dt;
      so.t += dt;
      so.flash = Math.max(0, so.flash - dt);
      const fi = Math.floor(so.t * 6) % 4;
      so.s.texture = so.flash > 0 ? soldierFlash[fi] : soldierTex[fi];
      so.s.scale.x = hero.x >= so.x ? 1 : -1;
      so.s.alpha = 0.86 + 0.08 * Math.sin(so.t * 7);
      so.s.position.set(Math.round(so.x), Math.round(so.y));
      so.s.zIndex = so.y;
      so.sh.position.set(Math.round(so.x), Math.round(so.y));
      const bob = fi % 2;
      so.eye.position.set(Math.round(so.x + so.s.scale.x * 1), Math.round(so.y - 15 + bob));
    }

    // 乾坤圈：飞出、折返、收回；残影跟随
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      if (!r.returning) {
        r.out += Math.hypot(r.vx, r.vy) * dt;
        if (r.out > 120) r.returning = true;
      } else {
        const dx = hero.x - r.x;
        const dy = hero.y - 13 - r.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = 300;
        r.vx += ((dx / d) * sp - r.vx) * Math.min(1, dt * 8);
        r.vy += ((dy / d) * sp - r.vy) * Math.min(1, dt * 8);
        if (d < 8) {
          r.s.destroy();
          r.trail.forEach((t) => t.destroy());
          r.light.sprite.destroy();
          lights.splice(lights.indexOf(r.light), 1);
          rings.splice(i, 1);
          continue;
        }
      }
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.hist.unshift([r.x, r.y]);
      if (r.hist.length > 10) r.hist.pop();
      const fi = Math.floor(r.t * 20) % 2;
      r.s.texture = ringTex[fi];
      r.s.position.set(Math.round(r.x), Math.round(r.y));
      r.trail.forEach((t, k) => {
        const h = r.hist[Math.min(r.hist.length - 1, (k + 1) * 3)];
        t.texture = ringTex[(fi + k + 1) % 2];
        t.position.set(Math.round(h[0]), Math.round(h[1]));
      });
      r.light.x = r.x;
      r.light.y = r.y;
      for (const so of soldiers) {
        if (r.hit.has(so)) continue;
        if (Math.hypot(so.x - r.x, so.y - 9 - r.y) < 10) {
          r.hit.add(so);
          so.flash = 0.08;
          const d = Math.hypot(so.x - hero.x, so.y - hero.y) || 1;
          so.x += ((so.x - hero.x) / d) * 6;
          so.y += ((so.y - hero.y) / d) * 6;
          for (let k = 0; k < 5; k++)
            spark(so.x, so.y - 10, rnd() < 0.5 ? 0x7cc4c4 : 0xffffff, (rnd() - 0.5) * 70, (rnd() - 0.7) * 60, 0.25 + rnd() * 0.2);
        }
      }
    }

    // 火星
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.destroy();
        sparks.splice(i, 1);
        continue;
      }
      p.vy += 10 * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.alpha = Math.min(1, (p.life / p.max) * 1.5);
    }

    // 鬼火
    for (const g of ghosts) {
      g.t += dt;
      const x = g.x + Math.sin(g.t * 0.4) * 18;
      const y = g.y + Math.cos(g.t * 0.3) * 10 + Math.sin(g.t * 2.2) * 2;
      g.s.texture = ghostTex[Math.floor(g.t * 8) % 3];
      g.s.position.set(Math.round(x), Math.round(y));
      g.s.zIndex = y + 20;
      g.glow.position.set(Math.round(x), Math.round(y - 3));
    }

    // 结界、阵法呼吸；云海滚动
    barrier.alpha = 0.35 + 0.2 * Math.sin(time * 1.6);
    formation.alpha = 0.6 + 0.3 * Math.sin(time * 1.2);
    cloudFar.tilePosition.x = -time * 4;
    cloudFar.tilePosition.y = time * 1.5;
    cloudNear.tilePosition.x = -time * 9;
    cloudNear.tilePosition.y = -time * 2;

    // 漂浮的莲花灯与符箓
    for (const f of floaters) {
      f.t += dt;
      const y = f.y - f.lift + Math.sin(f.t * 1.4) * 2.5;
      f.s.texture = f.tx[Math.floor(f.t * 2) % f.tx.length];
      f.s.position.set(Math.round(f.x), Math.round(y));
      f.s.zIndex = f.y;
      f.glow.position.set(Math.round(f.x), Math.round(y - 5));
    }

    // 灵光与花瓣
    if (motes.filter((m) => !m.petal).length < 46) spawnMote(false);
    if (motes.filter((m) => m.petal).length < 10 && rnd() < 0.02) spawnMote(true);
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.t += dt;
      m.life -= dt;
      m.x += (m.vx + Math.sin(m.t * (m.petal ? 1.7 : 0.9)) * (m.petal ? 10 : 3)) * dt;
      m.y += m.vy * dt;
      const out = m.x < camX - 40 || m.x > camX + VIEW_W + 40 || m.y < camY - 40 || m.y > camY + VIEW_H + 40;
      if (m.life <= 0 || out) {
        m.s.destroy();
        motes.splice(i, 1);
        continue;
      }
      m.s.position.set(Math.round(m.x), Math.round(m.y));
      if (!m.petal) m.s.alpha = Math.min(1, m.life) * (0.5 + 0.5 * Math.sin(m.t * 4));
    }

    // 镜头
    camX = Math.max(-MARGIN, Math.min(WORLD_W + MARGIN - VIEW_W, hero.x - VIEW_W / 2));
    camY = Math.max(-MARGIN, Math.min(WORLD_H + MARGIN - VIEW_H, hero.y - 12 - VIEW_H / 2));
    world.position.set(-Math.round(camX), -Math.round(camY));
    glow.position.copyFrom(world.position);

    // 光照图：云影随风飘过
    for (const c of cloudShadows) {
      c.x += c.v * dt;
      if (c.x > WORLD_W + 200) c.x = -200;
      c.sp.position.set(Math.round(c.x - camX), Math.round(c.y - camY));
    }
    for (const l of lights) {
      l.sprite.position.set(Math.round(l.x - camX), Math.round(l.y - camY));
      l.sprite.alpha = Math.max(0, l.base + l.flicker * Math.sin(time * 9 + l.seed) * Math.sin(time * 3.3 + l.seed * 2));
    }
    app.renderer.render({ container: lightScene, target: lightRT, clear: true, clearColor: '#000000' });

    // 摇杆
    stickBase.visible = stickKnob.visible = stick.active;
    stickBase.position.set(Math.round(stick.ox), Math.round(stick.oy));
    stickKnob.position.set(Math.round(stick.ox + stick.dx), Math.round(stick.oy + stick.dy));
  });

  // 供自动截图和试玩脚本使用
  (window as unknown as { __trial: unknown }).__trial = {
    hero,
    soldiers,
    keys,
    get time() {
      return time;
    },
  };
}
