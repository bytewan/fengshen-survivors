// 第三章 · 界牌关 · 诛仙阵 的场景：界牌关前的山谷，夜。铺满剑痕的青黑石台，对角的剑台之间暗刻着两道阵线、在场心交成阵心；
// 四角各一座剑台（台上悬着的四把剑是活的，由 game/ch3/terrain-fx.ts 按模拟状态画，不在这里）；北边隔着魔气是黑色的山崖，后面还有更远的山。
// 色调玄青、冷银、暗金：光照图的暗角压成深靛，再乘一层「右上月光、左下更暗」的斜向渐变；比前两章压抑，但最暗处也是青黑，不是黑。
// 地面、山崖是程序生成的位图（src/art/ch3/ground.ts），剑台的位置取自模拟（sim/ch3/config.ts 的 SWORDS）。
// 空中：零星往上飘的剑气碎光（冷银、天青，很淡），地上两片很慢的雾影。用户口径：克制、背景不要黑、不要光圈。
import { Sprite, type Texture } from 'pixi.js';
import { makeJiepaiCliffs, makeJiepaiGround, SEAL_R } from '../art/ch3/ground.ts';
import { STONES, STUBS } from '../art/ch3/decor.ts';
import { SWORDS } from '../sim/ch3/config.ts';
import { SceneBag, type SceneBuilder } from './scenes.ts';
import { once, textureFromBitmap, textureFromGrid } from './textures.ts';
import { VIEW_H, VIEW_W } from './view-fit.ts';

/** 山崖：近崖的崖顶在场地北沿往外 CLIFF_CREST 像素（魔气里），位图里崖顶在 CLIFF_TOP（上面留给尖峰和远山），往下 CLIFF_FADE 淡完。 */
const CLIFF_CREST = -30;
const CLIFF_TOP = 54;
const CLIFF_H = 120;
const CLIFF_FADE = 34;

export const jiepaiScene: SceneBuilder = (ctx) => {
  const { worldW, worldH, ext: EXT, rnd, floor, entities, glow, tex, cam } = ctx;
  const bag = new SceneBag();
  const size = `${worldW}x${worldH}`;
  const art = once(`jiepai:ground:${size}`, () => {
    const W = worldW + EXT * 2;
    const H = worldH + EXT * 2;
    const g = makeJiepaiGround(W, H, { ext: EXT, worldW, worldH, altars: SWORDS.altars, dais: SWORDS.dais });
    const cliffs = makeJiepaiCliffs(W, CLIFF_H, CLIFF_TOP, CLIFF_FADE);
    return { ground: textureFromBitmap(g), cliffs: textureFromBitmap(cliffs) };
  });
  const ground = bag.add(new Sprite(art.ground));
  ground.position.set(-EXT, -EXT);
  const cliffs = bag.add(new Sprite(art.cliffs));
  cliffs.position.set(-EXT, CLIFF_CREST - CLIFF_TOP);
  ctx.ground.addChild(ground);
  ctx.horizon.addChild(cliffs);

  // 夜：月在东北边——屏幕右上亮一点、左下压暗一点，偏冷（乘到画面上，只是一层很淡的斜向渐变）
  const moon = bag.add(
    new Sprite(
      once('jiepai:moon', () => {
        const w = VIEW_W;
        const h = VIEW_H;
        const data = new Uint8ClampedArray(w * h * 4);
        const lit = [246, 250, 255];
        const dim = [200, 208, 232];
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const t = Math.max(0, Math.min(1, (1 - x / w) * 0.55 + (y / h) * 0.45));
            const k = t * t * (3 - 2 * t);
            data.set([0, 1, 2].map((i) => Math.round(lit[i] + (dim[i] - lit[i]) * k)).concat(255), (y * w + x) * 4);
          }
        return textureFromBitmap({ w, h, data });
      }),
    ),
  );
  moon.blendMode = 'multiply';
  ctx.light.addChild(moon);

  // 雾影：两片很慢的冷灰雾影（贴地漫过去）
  const blobTex = once('jiepai:mist-shadow', () => {
    const r = 90;
    const data = new Uint8ClampedArray(r * 2 * r * 2 * 4);
    for (let y = 0; y < r * 2; y++)
      for (let x = 0; x < r * 2; x++) {
        const d = Math.hypot(x - r, (y - r) * 1.8) / r;
        if (d < 1) data.set([120, 130, 160, Math.round(255 * (1 - d) ** 2.2 * 0.4)], (y * r * 2 + x) * 4);
      }
    return textureFromBitmap({ w: r * 2, h: r * 2, data });
  });
  const shadows = Array.from({ length: 2 }, (_, i) => {
    const sp = bag.add(new Sprite(blobTex));
    sp.anchor.set(0.5);
    sp.scale.set(3 + i * 0.7, 2 + i * 0.4);
    sp.alpha = 0.55;
    ctx.light.addChild(sp);
    return { sp, x: rnd() * worldW, y: rnd() * worldH, v: 2.5 + rnd() * 2.5 };
  });

  // ---------- 道具：残剑、碎石（离剑台、阵心、阵线远一点，场心留空） ----------
  const [a0, a1, a2, a3] = SWORDS.altars;
  const offLine = (x: number, y: number, [ax, ay]: [number, number], [bx, by]: [number, number], pad: number) => {
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(x - ax - vx * t, y - ay - vy * t) > pad;
  };
  const clear = (x: number, y: number, pad: number) =>
    Math.hypot(x - worldW / 2, (y - worldH / 2) * 1.25) > SEAL_R + 30 + pad &&
    SWORDS.altars.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > SWORDS.dais + 26 + pad) &&
    offLine(x, y, a0, a2, 10 + pad) &&
    offLine(x, y, a1, a3, 10 + pad);
  const place = (t: Texture, x: number, y: number, parent = entities) => {
    const s = bag.add(new Sprite(t));
    s.anchor.set(0.5, 1);
    s.position.set(Math.round(x), Math.round(y));
    s.zIndex = y;
    parent.addChild(s);
    return s;
  };
  const shadowAt = (x: number, y: number, a = 0.26) => {
    const sh = bag.add(new Sprite(tex.smallShadow));
    sh.anchor.set(0.5);
    sh.alpha = a;
    sh.position.set(Math.round(x), Math.round(y));
    floor.addChild(sh);
  };
  const scatter = (n: number, pad: number, fn: (x: number, y: number) => void) => {
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 40; tries++) {
      const x = 26 + rnd() * (worldW - 52);
      const y = 36 + rnd() * (worldH - 56);
      if (!clear(x, y, pad)) continue;
      fn(x, y);
      placed++;
    }
  };
  const stubTex = STUBS.map(textureFromGrid);
  const stubs: { s: Sprite; t: number; x: number; y: number }[] = [];
  scatter(9, 14, (x, y) => {
    const s = place(stubTex[rnd() < 0.5 ? 0 : 1], x, y);
    shadowAt(x + 1, y, 0.2);
    stubs.push({ s, t: rnd() * 20, x, y });
  });
  const stoneTex = STONES.map(textureFromGrid);
  scatter(12, 6, (x, y) => {
    place(stoneTex[rnd() < 0.6 ? 0 : 1], x, y, floor);
  });

  // ---------- 空中：往上飘的剑气碎光（冷银、天青，很淡）；残剑上偶尔一线寒光 ----------
  const motes: { s: Sprite; x: number; y: number; vx: number; vy: number; t: number; life: number }[] = [];
  const spawnMote = () => {
    const s = new Sprite(tex.dot);
    s.tint = rnd() < 0.55 ? 0xc3ccd2 : rnd() < 0.6 ? 0x7cc4c4 : 0xf2e8d5;
    s.blendMode = 'add';
    glow.addChild(s);
    motes.push({ s, x: cam.x - 20 + rnd() * (VIEW_W + 40), y: cam.y + rnd() * VIEW_H, vx: (rnd() - 0.5) * 3, vy: -3 - rnd() * 5, t: rnd() * 10, life: 4 + rnd() * 6 });
  };
  const glints: { s: Sprite; t: number; life: number }[] = [];

  return {
    // 夜：中间是冷的月白，四个角压成深靛
    vignette: { inner: [224, 232, 246], outer: [104, 112, 150] },
    update(dt, _time, shake) {
      if (motes.length < 26) spawnMote();
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.t += dt;
        m.life -= dt;
        m.x += (m.vx + Math.sin(m.t * 0.9) * 2) * dt;
        m.y += m.vy * dt;
        const out = m.x < cam.x - 40 || m.x > cam.x + VIEW_W + 40 || m.y < cam.y - 40 || m.y > cam.y + VIEW_H + 40;
        if (m.life <= 0 || out) {
          m.s.destroy();
          motes.splice(i, 1);
          continue;
        }
        m.s.position.set(Math.round(m.x), Math.round(m.y));
        m.s.alpha = Math.min(1, m.life) * (0.18 + 0.16 * Math.sin(m.t * 3));
      }
      // 残剑：隔一阵剑柄上闪一下寒光（一个亮点，淡入淡出）
      for (const st of stubs) {
        st.t -= dt;
        if (st.t > 0) continue;
        st.t = 6 + rnd() * 14;
        const s = new Sprite(tex.dot);
        s.tint = 0xffffff;
        s.blendMode = 'add';
        s.position.set(Math.round(st.x + (st.s.texture === stubTex[0] ? 1 : -1)), Math.round(st.y - 5));
        glow.addChild(s);
        glints.push({ s, t: 0, life: 0.7 });
      }
      for (let i = glints.length - 1; i >= 0; i--) {
        const g = glints[i];
        g.t += dt;
        if (g.t >= g.life) {
          g.s.destroy();
          glints.splice(i, 1);
          continue;
        }
        g.s.alpha = Math.sin((g.t / g.life) * Math.PI) * 0.8;
      }
      for (const c of shadows) {
        c.x += c.v * dt;
        if (c.x > worldW + 260) c.x = -260;
        c.sp.position.set(Math.round(c.x - cam.x + shake.x), Math.round(c.y - cam.y + shake.y));
      }
    },
    destroy() {
      for (const m of motes) m.s.destroy();
      motes.length = 0;
      for (const g of glints) g.s.destroy();
      glints.length = 0;
      bag.destroy();
    },
  };
};
