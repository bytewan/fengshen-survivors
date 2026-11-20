// 修仙版预设的规矩（docs/pixelfx-presets.md、skill fengshen-pixelfx）：不透明的像素一律在游戏调色板里；
// 接进战斗用的 actor（游戏精灵的剪影）格式对、魂散按它画得出来。整屏的几个（换章云海、氛围）画一遍要几百毫秒，这里不画。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearFrame, createFrame, createFx, type FxModule, type FxOptions } from '../../vendor/pixelfx/src/core/index.js';
import { bakeAtlas } from './pixelfx-pack.ts';
import { XFX } from './pixelfx-xianxia.ts';
import { PALETTE } from '../art/palette.ts';
import { BODY, FOE_ART, actorOf } from './pixelfx-actor.ts';

const load = async (id: string) => (await import(new URL(`../../vendor/pixelfx/src/fx/${id}.js`, import.meta.url).href)) as FxModule;
const IN_PALETTE = new Set(Object.values(PALETTE).map((h) => parseInt(h.slice(1), 16)));

/**
 * 一个特效从头放到尾，每一帧的颜色层（不含辉光：辉光是叠加的光，本来就会把颜色提亮）里，不透明又不在调色板里的像素有几个；
 * each(frame, 原点 x, 原点 y) 每帧回调一次。量法同 scratch 里的调色板体检。
 */
function scan(mod: FxModule, opts: FxOptions, each?: (C: Uint32Array, w: number, ox: number, oy: number) => void) {
  const meta = { fps: 30, duration: 1, ...mod.meta };
  const [W, H] = meta.size;
  const [OX, OY] = meta.origin;
  const fx = createFx(mod, { ...opts, x: OX, y: OY });
  const frame = createFrame(W, H);
  const n = Math.round(meta.duration * meta.fps) + (meta.loop ? 0 : 1);
  let off = 0;
  for (let i = 0; i < n; i++) {
    if (i) fx.update(1 / meta.fps);
    clearFrame(frame);
    fx.draw(frame);
    const C = frame.color;
    for (let j = 0; j < C.length; j++) {
      const c = C[j];
      if (c >>> 24 !== 255) continue;
      if (!IN_PALETTE.has(((c & 255) << 16) | (((c >>> 8) & 255) << 8) | ((c >>> 16) & 255))) off++;
    }
    each?.(C, W, OX, OY);
  }
  return off;
}

const FULLSCREEN = new Set(['chapterClouds', 'ambientPetals', 'ambientSand', 'ambientMist']);

test('XFX 的每个预设（整屏的除外）：不透明的像素全在游戏调色板里', async () => {
  for (const [name, p] of Object.entries(XFX)) {
    if (FULLSCREEN.has(name)) continue;
    assert.equal(scan(await load(p.id), p.opts), 0, `${name}（${p.id}）有调色板外的像素`);
  }
});

test('actorOf：剪影的格子和颜色对得上精灵，脚底在 (0, 0)', () => {
  const f = FOE_ART.soldier!;
  const a = actorOf(f.g, f.a);
  assert.equal(a.mask.w, f.g.w);
  assert.equal(a.mask.h, f.g.h);
  assert.equal(a.x, -f.a.x);
  assert.equal(a.y, -f.a.y);
  let on = 0;
  for (let y = 0; y < f.g.h; y++)
    for (let x = 0; x < f.g.w; x++) {
      const ch = f.g.rows[y][x];
      const i = y * f.g.w + x;
      if (ch === '.' || ch === ' ') {
        assert.equal(a.mask.data[i], 0);
        continue;
      }
      on++;
      assert.equal(a.mask.data[i], 1);
      // 库的颜色整数是 R、G、B、A 依次在内存里（小端：0xAABBGGRR）
      const c = a.pixels[i];
      const hex = parseInt(PALETTE[ch].slice(1), 16);
      assert.equal(((c & 255) << 16) | (((c >>> 8) & 255) << 8) | ((c >>> 16) & 255), hex);
      assert.equal(c >>> 24, 255);
    }
  assert.ok(on > 50);
});

test('魂散：每种要散成魂的敌人都画得出来（有内容、最后一帧收干净），按体型摆的状态每种体型都画得出来', async () => {
  const soul = await load(XFX.soulScatter.id);
  for (const [kind, f] of Object.entries(FOE_ART)) {
    if (!f || f.soul === false) continue;
    const a = bakeAtlas(soul, { ...XFX.soulScatter.opts, actor: actorOf(f.g, f.a), height: f.rise });
    assert.ok(a.frames.some((fr) => fr && fr.w * fr.h > 40), `${kind} 的魂散是空的`);
    assert.equal(a.frames[a.frames.length - 1], null, `${kind} 的魂散最后一帧没收干净`);
    assert.equal(scan(soul, { ...XFX.soulScatter.opts, actor: actorOf(f.g, f.a), height: f.rise }), 0, `${kind} 的魂散有调色板外的像素`);
  }
  for (const name of ['frozen', 'chilled', 'stunSeal']) {
    const m = await load(XFX[name].id);
    for (const body of Object.values(BODY)) assert.ok(bakeAtlas(m, { ...XFX[name].opts, body }).frames.some((fr) => fr), `${name} ${body} 是空的`);
  }
});

test('蟠桃回血 glow: 0：没有盖在身上的那团桃红软光（身子正中一圈的颜色层里没有半透明的像素）', async () => {
  const m = await load(XFX.peachHeal.id);
  const soft = (glow: number) => {
    let n = 0;
    scan(m, { ...XFX.peachHeal.opts, glow }, (C, w, ox, oy) => {
      // 相对原点（脚下）：身子正中（往上 8–16 像素、左右 4 像素以内）
      for (let Y = -16; Y <= -8; Y++)
        for (let X = -4; X <= 4; X++) {
          const a = C[(oy + Y) * w + ox + X] >>> 24;
          if (a > 0 && a < 255) n++;
        }
    });
    return n;
  };
  assert.ok(soft(1) > 50, '原来的软光应该在');
  assert.equal(soft(0), 0);
});
