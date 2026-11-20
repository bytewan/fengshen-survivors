// 第二章 · 西岐城外 · 十绝阵 的场景：黄昏的旷野。被反复践踏的黄土与残草，地上刻着淡淡的阵纹，场上散着十座阵台（阵眼），
// 北边远处隔着魔气看得见西岐城墙与城楼的剪影；色调赭黄、暗红、灰紫（光照图的暗角压成黄昏的玫瑰灰紫），和第一章的青白玉仙台明显不同。
// 地面、城墙是程序生成的位图（src/art/ch2/ground.ts），阵台的位置和半径取自模拟（sim/ch2/config.ts 的 TEN）：
// 地上刻的阵就是阵亮起来时的判定范围。阵旗、阵亮起来的样子是活的，由 game/ch2/terrain-fx.ts 按模拟状态画，不在这里。
// 空中：顺风飘的尘、偶尔滚过的草屑、两片慢慢挪过的云影。用户口径：克制、背景不要黑、不要光圈。
import { Sprite, type Texture } from 'pixi.js';
import { makeXiqiGround, makeXiqiWall } from '../art/ch2/ground.ts';
import { ROCKS, STAKE } from '../art/ch2/decor.ts';
import { grid } from '../art/pixel.ts';
import { TEN } from '../sim/ch2/config.ts';
import { SceneBag, type SceneBuilder } from './scenes.ts';
import { once, textureFromBitmap, textureFromGrid } from './textures.ts';
import { VIEW_H, VIEW_W } from './view-fit.ts';

/**
 * 城墙的位置：垛口的上沿在场地北沿往外 WALL_CREST 像素（魔气里），墙身往下 WALL_FADE 像素淡没在魔气里；
 * 画在远景层（魔气的底色之上、翻滚的烟团之下），烟团从它前面翻过去。正中一座城楼、两边各一座角楼。
 */
const WALL_CREST = -22;
const WALL_FADE = 26;
const WALL_H = 80;
const WALL_TOP = 40; // 位图里垛口上沿的 y（上面留给城楼）
const TOWERS = [
  { x: 480, big: true },
  { x: 170, big: false },
  { x: 790, big: false },
];

export const xiqiScene: SceneBuilder = (ctx) => {
  const { worldW, worldH, ext: EXT, rnd, floor, entities, fx, glow, tex, cam } = ctx;
  const bag = new SceneBag();
  const size = `${worldW}x${worldH}`;
  const art = once(`xiqi:ground:${size}`, () => {
    const W = worldW + EXT * 2;
    const H = worldH + EXT * 2;
    const g = makeXiqiGround(W, H, { ext: EXT, sites: TEN.sites, r: TEN.r, dais: TEN.dais });
    const wall = makeXiqiWall(W, WALL_H, WALL_TOP, WALL_FADE, TOWERS.map((t) => ({ x: t.x + EXT, big: t.big })));
    return { ground: textureFromBitmap(g), wall: textureFromBitmap(wall) };
  });
  const ground = bag.add(new Sprite(art.ground));
  ground.position.set(-EXT, -EXT);
  const wall = bag.add(new Sprite(art.wall));
  wall.position.set(-EXT, WALL_CREST - WALL_TOP);
  ctx.ground.addChild(ground);
  ctx.horizon.addChild(wall);

  // 黄昏的光：屏幕左上（西边，太阳落下去的那头）暖一点，右下渐渐压成灰紫——乘到画面上，只是一层很淡的斜向渐变
  const dusk = bag.add(
    new Sprite(
      once('xiqi:dusk', () => {
        const w = VIEW_W;
        const h = VIEW_H;
        const data = new Uint8ClampedArray(w * h * 4);
        const warm = [255, 238, 214];
        const cool = [222, 196, 214];
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const t = Math.max(0, Math.min(1, (x / w) * 0.55 + (y / h) * 0.45));
            const k = t * t * (3 - 2 * t);
            data.set([0, 1, 2].map((i) => Math.round(warm[i] + (cool[i] - warm[i]) * k)).concat(255), (y * w + x) * 4);
          }
        return textureFromBitmap({ w, h, data });
      }),
    ),
  );
  dusk.blendMode = 'multiply';
  ctx.light.addChild(dusk);

  // 云影：两片，比第一章的更大、更慢（黄昏的风小）
  const blobTex = once('stage:cloud-shadow', () => {
    const r = 90;
    const data = new Uint8ClampedArray(r * 2 * r * 2 * 4);
    for (let y = 0; y < r * 2; y++)
      for (let x = 0; x < r * 2; x++) {
        const d = Math.hypot(x - r, (y - r) * 1.6) / r;
        if (d < 1) data.set([96, 84, 128, Math.round(255 * (1 - d) ** 1.5 * 0.5)], (y * r * 2 + x) * 4);
      }
    return textureFromBitmap({ w: r * 2, h: r * 2, data });
  });
  const shadows = Array.from({ length: 2 }, (_, i) => {
    const sp = bag.add(new Sprite(blobTex));
    sp.anchor.set(0.5);
    sp.scale.set(2.1 + i * 0.5);
    sp.alpha = 0.75;
    ctx.light.addChild(sp);
    return { sp, x: rnd() * worldW, y: rnd() * worldH, v: 3 + rnd() * 3 };
  });

  // ---------- 道具：镇符桩、碎石（离阵远一点，场心留空） ----------
  const clear = (x: number, y: number, pad: number) =>
    Math.hypot(x - worldW / 2, y - worldH / 2) > 70 && TEN.sites.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > TEN.r + pad);
  const place = (t: Texture, x: number, y: number, parent = entities) => {
    const s = bag.add(new Sprite(t));
    s.anchor.set(0.5, 1);
    s.position.set(Math.round(x), Math.round(y));
    s.zIndex = y;
    parent.addChild(s);
    return s;
  };
  const shadowAt = (x: number, y: number, a = 0.28) => {
    const sh = bag.add(new Sprite(tex.smallShadow));
    sh.anchor.set(0.5);
    sh.alpha = a;
    sh.position.set(Math.round(x), Math.round(y));
    floor.addChild(sh);
  };
  const scatter = (n: number, pad: number, fn: (x: number, y: number) => void) => {
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 40; tries++) {
      const x = 30 + rnd() * (worldW - 60);
      const y = 40 + rnd() * (worldH - 60);
      if (!clear(x, y, pad)) continue;
      fn(x, y);
      placed++;
    }
  };
  const stakeTex = textureFromGrid(STAKE);
  scatter(7, 16, (x, y) => {
    place(stakeTex, x, y);
    shadowAt(x, y, 0.22);
  });
  const rockTex = ROCKS.map(textureFromGrid);
  scatter(10, 8, (x, y) => {
    place(rockTex[rnd() < 0.6 ? 0 : 1], x, y, floor);
  });

  // ---------- 空中：顺风飘的尘、偶尔滚过的草屑 ----------
  const strawTex = once('xiqi:straw', () => [grid(['F.', '.H']), grid(['.F', 'H.']), grid(['FH'])].map(textureFromGrid));
  const dust: { s: Sprite; x: number; y: number; vx: number; vy: number; t: number; life: number; straw: boolean }[] = [];
  const spawnDust = (straw: boolean) => {
    const s = new Sprite(straw ? strawTex[0] : tex.dot);
    if (!straw) {
      s.tint = rnd() < 0.5 ? 0xf7dc7a : rnd() < 0.6 ? 0xffe9a8 : 0xf2814a;
      s.blendMode = 'add';
    }
    (straw ? fx : glow).addChild(s);
    dust.push({
      s,
      x: straw ? cam.x - 12 : cam.x - 20 + rnd() * (VIEW_W + 40),
      y: cam.y + rnd() * VIEW_H,
      vx: straw ? 26 + rnd() * 22 : 5 + rnd() * 7,
      vy: straw ? (rnd() - 0.5) * 6 : -2 - rnd() * 4,
      t: rnd() * 10,
      life: straw ? 30 : 5 + rnd() * 6,
      straw,
    });
  };

  return {
    // 黄昏：中间暖一点，四个角压成玫瑰灰紫
    vignette: { inner: [255, 240, 222], outer: [160, 116, 134] },
    update(dt, _time, shake) {
      let nd = 0;
      let ns = 0;
      for (const d of dust) d.straw ? ns++ : nd++;
      if (nd < 34) spawnDust(false);
      if (ns < 3 && rnd() < 0.012) spawnDust(true);
      for (let i = dust.length - 1; i >= 0; i--) {
        const d = dust[i];
        d.t += dt;
        d.life -= dt;
        d.x += (d.vx + Math.sin(d.t * (d.straw ? 3.1 : 0.8)) * (d.straw ? 8 : 2)) * dt;
        d.y += (d.vy + (d.straw ? Math.sin(d.t * 5.3) * 10 : 0)) * dt;
        const out = d.x < cam.x - 40 || d.x > cam.x + VIEW_W + 40 || d.y < cam.y - 40 || d.y > cam.y + VIEW_H + 40;
        if (d.life <= 0 || out) {
          d.s.destroy();
          dust.splice(i, 1);
          continue;
        }
        if (d.straw) d.s.texture = strawTex[Math.floor(d.t * 9) % 3];
        d.s.position.set(Math.round(d.x), Math.round(d.y));
        if (!d.straw) d.s.alpha = Math.min(1, d.life) * (0.25 + 0.2 * Math.sin(d.t * 3));
      }
      for (const c of shadows) {
        c.x += c.v * dt;
        if (c.x > worldW + 260) c.x = -260;
        c.sp.position.set(Math.round(c.x - cam.x + shake.x), Math.round(c.y - cam.y + shake.y));
      }
    },
    destroy() {
      for (const d of dust) d.s.destroy();
      dust.length = 0;
      bag.destroy();
    },
  };
};
