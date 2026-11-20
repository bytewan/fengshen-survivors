// 场景：战场的「环境」那一层（地面、道具、漂浮物、灵光、云影、光照的暗角颜色），每一章一套，按 ChapterDef.scene 的 id 切换。
// 舞台（stage.ts）管画布、魔气、各层容器和镜头；场景只往它给的几层里放东西，换章时整套拆掉、换一套（stage.setScene）。
// 'plaza' 第一章 · 陈塘关：悬在云海上的回响仙台（原来写在 stage.ts 里，原样搬过来）；'xiqi' 第二章 · 西岐城外（scene-xiqi.ts）。
// 第三章：照这两个写一个 SceneBuilder，在 SCENES 里登记。
import { Container, Sprite, type Texture } from 'pixi.js';
import { grid, type Grid } from '../art/pixel.ts';
import { makePlaza } from '../art/plaza.ts';
import { CRYSTAL, FLOAT_TALISMAN, GHOST_FIRE, GRASS, JADE_LANTERN, LOTUS, PILLAR, STELE, SWORD } from '../art/sprites/decor.ts';
import { once, steppedLightTexture, textureFromBitmap, textureFromGrid } from './textures.ts';
import { VIEW_H, VIEW_W } from './view-fit.ts';

/** 舞台交给场景的东西。坐标都是世界坐标（仙台左上角是 0, 0），光照层是屏幕坐标。 */
export interface SceneCtx {
  worldW: number;
  worldH: number;
  /** 地面往魔气带里多铺的那一截：地面贴图从 (-ext, -ext) 开始，交界处只剩魔气的浓淡，没有「地面到此为止」的直线。 */
  ext: number;
  /** 这个场景用的随机数（固定种子：同一个场景每次看起来一样）。 */
  rnd: () => number;
  /** 地面层：在魔气下面。 */
  ground: Container;
  /** 远景层：在魔气的底色之上、翻滚的烟团之下（隔着魔气看得见的远处的东西）。 */
  horizon: Container;
  /** 贴地层（影子、草）、按 y 排序的角色与道具层、角色之上的特效层、加法混合的发光层（世界坐标）。 */
  floor: Container;
  entities: Container;
  fx: Container;
  glow: Container;
  /** 光照图（屏幕空间，乘到世界上）：云影这类放这里，场景自己按镜头挪。 */
  light: Container;
  cam: { x: number; y: number };
  tex: { lightS: Texture; lightM: Texture; dot: Texture; shadow: Texture; smallShadow: Texture };
  addGlow(t: Texture, tint: number, alpha: number): Sprite;
}

export interface Scene {
  /** 光照图的底：中间的颜色、四个角压暗到的颜色（乘到画面上；只压四个角，见 textures.vignetteTexture）。 */
  vignette: { inner: [number, number, number]; outer: [number, number, number] };
  /** 每帧：time 是舞台的累计时间，shake 是这一帧的震屏偏移（光照层里的东西要跟着抖）。 */
  update(dt: number, time: number, shake: { x: number; y: number }): void;
  /** 拆掉这个场景放进各层的东西（共用的纹理不动）。 */
  destroy(): void;
}

export type SceneBuilder = (ctx: SceneCtx) => Scene;

/** 场景放进各层的东西都记在这里，拆的时候一次清掉。 */
export class SceneBag {
  private items: Container[] = [];
  add<T extends Container>(c: T): T {
    this.items.push(c);
    return c;
  }
  destroy() {
    for (const c of this.items) if (!c.destroyed) c.destroy({ children: true });
    this.items = [];
  }
}

// ---------- 第一章 · 陈塘关：回响仙台 ----------

/**
 * 悬在云海上的青白玉仙台：砖缝磨平、偶有嵌金线和暗刻回纹；中央半径约 64 像素的八卦阵法，刻槽嵌金、阵眼发天青光并缓慢呼吸；
 * 周围四根朱漆断柱、四盏白玉石灯，零星的剑冢、灵石、玉碑、漂浮的莲花灯和符箓；空中有灵光和桃花瓣，地面有云影飘过。
 * （原来写在 stage.ts 的 createStage 里；随机数的先后照旧，画出来和原来一模一样。）
 */
export const plazaScene: SceneBuilder = (ctx) => {
  const { worldW, worldH, ext: EXT, rnd, floor, entities, fx, glow, tex, cam } = ctx;
  const bag = new SceneBag();
  const textures = (gs: Grid[]) => gs.map(textureFromGrid);
  const size = `${worldW}x${worldH}`;
  const plaza = once(`stage:plaza:${size}`, () => {
    const p = makePlaza(worldW + EXT * 2, worldH + EXT * 2, 11, EXT + 90);
    return { base: textureFromBitmap(p.base), glow: textureFromBitmap(p.glow), center: p.center, radius: p.radius };
  });
  const ground = bag.add(new Sprite(plaza.base));
  ground.position.set(-EXT, -EXT);
  const formation = bag.add(new Sprite(plaza.glow));
  formation.position.set(-EXT, -EXT);
  formation.blendMode = 'add';
  ctx.ground.addChild(ground, formation);

  // 云影（光照图里，跟着镜头挪）
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
  const cloudShadows = Array.from({ length: 3 }, (_, i) => {
    const sp = bag.add(new Sprite(blobTex));
    sp.anchor.set(0.5);
    sp.scale.set(1.6 + i * 0.4);
    ctx.light.addChild(sp);
    return { sp, x: rnd() * worldW, y: rnd() * worldH, v: 6 + rnd() * 5 };
  });

  // ---------- 道具 ----------
  const place = (g: Grid, x: number, y: number, parent: Container, sort = true) => {
    const s = bag.add(new Sprite(textureFromGrid(g)));
    s.anchor.set(0.5, 1);
    s.position.set(Math.round(x), Math.round(y));
    if (sort) s.zIndex = y;
    parent.addChild(s);
    return s;
  };
  const addGlow = (t: Texture, tint: number, alpha: number) => bag.add(ctx.addGlow(t, tint, alpha));
  const C = { x: plaza.center.x - EXT, y: plaza.center.y - EXT };
  const scatter = (n: number, pad: number, fn: (x: number, y: number) => void) => {
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 30; tries++) {
      const x = 40 + rnd() * (worldW - 80);
      const y = 50 + rnd() * (worldH - 70);
      if (Math.hypot(x - C.x, y - C.y) < plaza.radius + pad + 40) continue;
      fn(x, y);
      placed++;
    }
  };
  const shadowAt = (x: number, y: number, t = tex.smallShadow, a = 0.3) => {
    const sh = bag.add(new Sprite(t));
    sh.anchor.set(0.5);
    sh.alpha = a;
    sh.position.set(Math.round(x), Math.round(y));
    floor.addChild(sh);
  };
  scatter(26, 6, (x, y) => place(GRASS[Math.floor(rnd() * 2)], x, y, floor, false));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const x = C.x + Math.cos(a) * (plaza.radius + 26);
    const y = C.y + Math.sin(a) * (plaza.radius + 14);
    place(PILLAR, x, y, entities);
    shadowAt(x, y, tex.shadow, 0.35);
  }
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
    addGlow(tex.lightS, 0x7cc4c4, 0.2).position.set(x, y - 9);
  }
  scatter(3, 40, (x, y) => {
    place(STELE, x, y, entities);
    shadowAt(x, y, tex.shadow, 0.3);
  });
  scatter(3, 30, (x, y) => {
    const n = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const sx = x + (i - n / 2) * 7 + rnd() * 3;
      const sy = y + (i % 2) * 5;
      place(SWORD, sx, sy, entities);
      addGlow(steppedLightTexture(5, 2), 0x7cc4c4, 0.22).position.set(Math.round(sx + 1), Math.round(sy - 8));
    }
    shadowAt(x, y + 3, tex.shadow, 0.25);
  });
  scatter(4, 26, (x, y) => {
    place(CRYSTAL, x, y, entities);
    shadowAt(x, y);
    addGlow(tex.lightS, rnd() < 0.5 ? 0x7cc4c4 : 0xd47aa0, 0.2).position.set(Math.round(x), Math.round(y - 7));
  });
  const lotusTex = textures(LOTUS);
  const talismanTex = textures(FLOAT_TALISMAN);
  const floaters: { s: Sprite; x: number; y: number; t: number; tx: Texture[]; glow: Sprite; lift: number }[] = [];
  scatter(6, 10, (x, y) => {
    const isLotus = floaters.length % 2 === 0;
    const t = isLotus ? lotusTex : talismanTex;
    const s = bag.add(new Sprite(t[0]));
    s.anchor.set(0.5, 1);
    entities.addChild(s);
    shadowAt(x, y, tex.smallShadow, 0.18);
    floaters.push({ s, x, y, t: rnd() * 10, tx: t, glow: addGlow(tex.lightS, isLotus ? 0xffe9a8 : 0xf7dc7a, 0.18), lift: isLotus ? 16 : 22 });
  });
  const ghostTex = textures(GHOST_FIRE);
  const ghosts = Array.from({ length: 4 }, () => {
    const s = bag.add(new Sprite(ghostTex[0]));
    s.anchor.set(0.5, 1);
    entities.addChild(s);
    return { s, x: 60 + rnd() * (worldW - 120), y: 60 + rnd() * (worldH - 120), t: rnd() * 10, glow: addGlow(tex.lightS, 0x7cc4c4, 0.22) };
  });

  // ---------- 灵光与桃花瓣 ----------
  const motes: { s: Sprite; x: number; y: number; vx: number; vy: number; t: number; life: number; petal: boolean }[] = [];
  const petalTex = once('stage:petals', () => textures([grid(['mw', 'pm']), grid(['m.', 'wm']), grid(['.m', 'mp'])]));
  const spawnMote = (petal: boolean) => {
    const s = new Sprite(petal ? petalTex[Math.floor(rnd() * 3)] : tex.dot);
    if (!petal) {
      s.tint = rnd() < 0.6 ? 0xffe9a8 : 0x7cc4c4;
      s.blendMode = 'add';
    }
    (petal ? fx : glow).addChild(s);
    motes.push({
      s,
      x: cam.x - 20 + rnd() * (VIEW_W + 40),
      y: cam.y + (petal ? -10 : rnd() * VIEW_H),
      vx: petal ? 8 + rnd() * 10 : (rnd() - 0.5) * 4,
      vy: petal ? 10 + rnd() * 8 : -4 - rnd() * 8,
      t: rnd() * 10,
      life: petal ? 30 : 5 + rnd() * 6,
      petal,
    });
  };

  return {
    vignette: { inner: [255, 252, 244], outer: [176, 162, 200] },
    update(dt, time, shake) {
      formation.alpha = 0.6 + 0.3 * Math.sin(time * 1.2);
      for (const f of floaters) {
        f.t += dt;
        const y = f.y - f.lift + Math.sin(f.t * 1.4) * 2.5;
        f.s.texture = f.tx[Math.floor(f.t * 2) % f.tx.length];
        f.s.position.set(Math.round(f.x), Math.round(y));
        f.s.zIndex = f.y;
        f.glow.position.set(Math.round(f.x), Math.round(y - 5));
      }
      for (const g of ghosts) {
        g.t += dt;
        const x = g.x + Math.sin(g.t * 0.4) * 18;
        const y = g.y + Math.cos(g.t * 0.3) * 10 + Math.sin(g.t * 2.2) * 2;
        g.s.texture = ghostTex[Math.floor(g.t * 8) % 3];
        g.s.position.set(Math.round(x), Math.round(y));
        g.s.zIndex = y + 20;
        g.glow.position.set(Math.round(x), Math.round(y - 3));
      }
      let nm = 0;
      let np = 0;
      for (const m of motes) m.petal ? np++ : nm++;
      if (nm < 46) spawnMote(false);
      if (np < 10 && rnd() < 0.02) spawnMote(true);
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.t += dt;
        m.life -= dt;
        m.x += (m.vx + Math.sin(m.t * (m.petal ? 1.7 : 0.9)) * (m.petal ? 10 : 3)) * dt;
        m.y += m.vy * dt;
        const out = m.x < cam.x - 40 || m.x > cam.x + VIEW_W + 40 || m.y < cam.y - 40 || m.y > cam.y + VIEW_H + 40;
        if (m.life <= 0 || out) {
          m.s.destroy();
          motes.splice(i, 1);
          continue;
        }
        m.s.position.set(Math.round(m.x), Math.round(m.y));
        if (!m.petal) m.s.alpha = Math.min(1, m.life) * (0.5 + 0.5 * Math.sin(m.t * 4));
      }
      for (const c of cloudShadows) {
        c.x += c.v * dt;
        if (c.x > worldW + 200) c.x = -200;
        c.sp.position.set(Math.round(c.x - cam.x + shake.x), Math.round(c.y - cam.y + shake.y));
      }
    },
    destroy() {
      for (const m of motes) m.s.destroy();
      motes.length = 0;
      bag.destroy();
    },
  };
};
