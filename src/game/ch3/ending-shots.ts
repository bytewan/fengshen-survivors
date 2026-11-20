// 第三章结尾的过场镜头（播放器 cutscene.ts，登记在 cutscene-shots.ts 的 SHOTS）：
//   gate      —— 诛仙阵的阵心（夜里，两边是黑色的山崖），四把剑斜插在阵心的石刻四周；阵心上方的空中裂开一道竖着的门缝，缝里透出封神榜的金光，
//                慢慢张开；玩家操控的角色（ShotKit.hero：哪吒、杨戬……）站在近处看着那道缝。
//   gate-look —— 门缝开着，缝里的金光里站着一个人的剪影（背对着），回头看了一眼（剪影，不露脸），又转回去；
//   gate-hold —— 门缝还开着，剪影走进金光里不见了，金光的碎屑往外飘。
// 画法同别的镜头：静的部分是调色板颜色的位图，动的部分（门缝、剪影、碎光）每帧画；位置取整；不画发光的圆圈（门缝的光是一道竖的缝和往外散的碎光）。
// 只从 cutscene-shots.ts 拿类型（运行时不互相引用）。山崖、阵心的地面也给第三章的开场用（ch3/intro-shots.ts：同一个地方，开战之前）。
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { blank, put, sky, valueNoise, mulberry32, type Bitmap } from '../../art/cutscene/common.ts';
import type { Grid } from '../../art/pixel.ts';
import { SWORD_FRAMES, SWORD_S, swordDir } from '../../art/ch3/decor.ts';
import { PALETTE } from '../../art/palette.ts';
import { HERO_VIEWS, heroFrames } from '../hero-views.ts';
import type { Shot, ShotKit } from '../cutscene-shots.ts';

const hex = (ch: string) => parseInt(PALETTE[ch].slice(1), 16);
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** 两边的山崖（透明底）：左右各一面黑色的崖壁（崖顶受月光一线雾蓝），中间让出山谷；后面一排更淡的远山。崖面是成片的深浅（斜着拉长一点，像岩层），不画线。 */
export function cliffs(W: number, H: number, top: number, cx: number, seed: number): Bitmap {
  const b = blank(W, H);
  const n1 = valueNoise(seed, 38, W, 4);
  const n2 = valueNoise(seed + 1, 9, W, 4);
  const far = valueNoise(seed + 2, 60, W, 4);
  const rock = valueNoise(seed + 3, 8, W * 1.5 + 8, H + 8);
  for (let x = 0; x < W; x++) {
    // 远山：一排低的、淡的（雾蓝）
    const fy = Math.round(top + 70 + (far(x, 1) - 0.5) * 30);
    for (let y = fy; y < H; y++) put(b, x, y, y === fy ? 'X' : 'J', 150);
    // 近崖：离山谷越远越高（两边高、中间是谷口）
    const d = Math.abs(x - cx);
    const rise = Math.max(0, (d - 70) / (W / 2 - 70));
    const cy = Math.round(top + 120 - rise ** 0.8 * 150 + (n1(x, 1) - 0.5) * 26 + (n2(x, 2) - 0.5) * 7);
    for (let y = Math.max(0, cy); y < H; y++) {
      // 竖着拉长取样：暗一档的是一道道竖的岩缝（稀疏、长短不一），不是成片的斑
      const v = rock(x * 1.4, Math.max(0, y - cy) * 0.45 + 4);
      put(b, x, y, y === cy ? 'J' : y === cy + 1 ? 'X' : y === cy + 2 ? 'V' : v < 0.17 ? 'K' : 'O');
    }
  }
  return b;
}

/** 阵心的石台（近处的地面）：青黑石往下铺满，中间一圈扁的刻槽（阵心），零星几道旧剑痕（近大远小：压得很扁）。 */
export function floor(W: number, H: number, y0: number, cx: number, cy: number): Bitmap {
  const b = blank(W, H);
  const n = valueNoise(77, 26, W, H * 2.5 + 2); // 竖着压扁 2.5 倍取样（近大远小）
  for (let y = y0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = n(x, y * 2.5);
      put(b, x, y, y < y0 + 2 ? 'X' : v < 0.14 ? 'O' : v > 0.86 ? 'X' : 'V');
    }
  // 旧剑痕：中间宽、两头尖的一道槽（暗一档），下唇一线亮；离阵心远一点
  const rnd = mulberry32(91);
  for (let k = 0; k < Math.round(W / 34); k++) {
    const sx = Math.round(rnd() * W);
    const sy = Math.round(y0 + 8 + rnd() * (H - y0 - 12));
    if (Math.abs(sx - cx) < 150 && Math.abs(sy - cy) < 28) continue;
    const L = 6 + Math.round(rnd() * 10) + Math.round(((sy - y0) / (H - y0)) * 6); // 近处的长一点
    const slope = (rnd() - 0.5) * 0.5;
    for (let i = -L; i <= L; i++) {
      const u = i / L;
      const x = sx + i;
      const y = Math.round(sy + slope * i);
      if (y <= y0 + 2 || y >= H) continue;
      put(b, x, y, 'O');
      if (Math.abs(u) < 0.6) put(b, x, y + 1, 'X');
    }
  }
  // 阵心的刻槽：两圈扁椭圆（近大远小：竖半径很扁）
  for (const [rx, ry] of [
    [120, 17],
    [100, 13],
  ]) {
    const N = Math.ceil(2 * Math.PI * rx);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      if (y < y0 + 1) continue;
      put(b, x, y, 'K');
      if (Math.sin(a) > 0) put(b, x, y + 1, 'T');
    }
  }
  // 中间那块圆石（门缝就在它正上方）
  for (let y = -5; y <= 4; y++)
    for (let x = -22; x <= 22; x++) {
      const d = (x / 22) ** 2 + (y / 5) ** 2;
      if (d <= 1) put(b, cx + x, cy + y, d > 0.8 ? 'U' : y < -1 ? 'X' : 'V');
    }
  return b;
}

/** 门那边的人（剪影）：背对着站在金光里；look 时头往右转过来一点（只看得出一个侧过来的轮廓，不露脸）。逆光：边上一线暗金。 */
function figure(look: boolean): Grid {
  const rows = look
    ? ['..kkk.', '.kkkkU', '.kkkk.', '..kk..', '.kkkk.', 'kkkkkk', 'kkkkkk', 'Ukkkkk', '.kkkk.', '.kkkk.', '.kkkk.', '.kkkkU', '.kk.kk', '.kk.kk', '.kk.kk', '.kk.kk']
    : ['..kkk.', '.kkkkk', '.kkkkk', '..kk..', '.kkkk.', 'kkkkkk', 'kkkkkk', 'Ukkkkk', '.kkkk.', '.kkkk.', '.kkkk.', '.kkkkU', '.kk.kk', '.kk.kk', '.kk.kk', '.kk.kk'];
  return { w: 6, h: rows.length, rows };
}

/**
 * 门缝的镜头。phase：'open' 缝慢慢张开；'look' 缝开着，缝里的人回头看一眼；'hold' 人走进金光里不见了，金屑往外飘。
 */
export function shotGate(k: ShotKit, phase: 'open' | 'look' | 'hold'): Shot {
  const { W, H, cx, fy } = k;
  const root = new Container();
  const horizon = fy + 168;
  k.sprite(
    k.tex(
      sky(W, H, horizon, [
        [0, 'N'],
        [0.35, 'K'],
        [0.66, 'O'],
        [0.9, 'V'],
      ]),
    ),
    0,
    0,
    root,
  );
  // 星：零星几点（冷银），慢慢明灭
  const stars = new Graphics();
  root.addChild(stars);
  const rnd = mulberry32(331);
  const starPts = Array.from({ length: Math.round(W / 9) }, () => ({ x: Math.round(rnd() * W), y: Math.round(rnd() * (horizon - 60)), ph: rnd() * 6, b: rnd() }));
  k.sprite(k.tex(cliffs(W, H, fy, cx, 41)), 0, 0, root);
  const seamX = cx;
  const floorY = fy + 186; // 地面的上沿
  const sealY = fy + 206; // 阵心（中间那块圆石）
  k.sprite(k.tex(floor(W, H, floorY, cx, sealY)), 0, 0, root);
  // 门缝后面那一竖淡淡的金光（只是一道竖的光，不是圆的光晕）、门缝本身、缝里的人：每帧画
  const glow = new Graphics();
  glow.blendMode = 'add';
  root.addChild(glow);
  const seam = new Graphics();
  root.addChild(seam);
  const fig = [figure(false), figure(true)].map((g) => k.grid(g));
  const figS = new Sprite(fig[0]);
  figS.anchor.set(0.5, 1);
  root.addChild(figS);
  const seamMask = new Graphics();
  root.addChild(seamMask);
  figS.mask = seamMask;
  // 四把剑斜插在阵心四周（近大远小：后面两把小一点、淡一点）
  const swords = [
    { x: cx - 112, y: sealY + 6, a: Math.PI / 2 + 0.45, s: 0, near: true },
    { x: cx + 108, y: sealY + 8, a: Math.PI / 2 - 0.4, s: 2, near: true },
    { x: cx - 58, y: sealY - 12, a: Math.PI / 2 + 0.25, s: 1, near: false },
    { x: cx + 64, y: sealY - 11, a: Math.PI / 2 - 0.3, s: 3, near: false },
  ];
  for (const sw of swords) {
    const g = SWORD_FRAMES[sw.s][swordDir(sw.a)][0];
    const s = k.sprite(k.grid(g), sw.x - SWORD_S / 2, sw.y - SWORD_S / 2 - 4, root);
    s.alpha = sw.near ? 1 : 0.8;
  }
  // 玩家操控的角色：站在近处的左下，看着那道缝（朝右的待机帧）
  const view = HERO_VIEWS[k.hero];
  const heroT = heroFrames(k.hero).idle.map((g) => k.grid(g));
  const hero = new Sprite(heroT[0]);
  hero.anchor.set(view.anchor.x / view.w, view.anchor.y / view.h);
  hero.position.set(cx - 78, fy + 250);
  root.addChild(hero);
  // 金屑：从缝里往外飘的一粒一粒（缃、灵光），慢慢淡掉
  const motes: { s: Sprite; x: number; y: number; vx: number; vy: number; t: number; life: number }[] = [];
  const mote = () => {
    const s = new Sprite(Texture.WHITE);
    s.width = s.height = 1;
    s.tint = hex(Math.random() < 0.6 ? 'Y' : 'f');
    s.blendMode = 'add';
    root.addChild(s);
    const y = seamTop + Math.random() * (seamBot - seamTop);
    motes.push({ s, x: seamX + (Math.random() - 0.5) * 4, y, vx: (Math.random() - 0.5) * 18, vy: -3 - Math.random() * 6, t: 0, life: 2 + Math.random() * 2.5 });
  };
  const seamTop = fy + 44;
  const seamBot = sealY - 6;
  k.cue(0.2, phase === 'open' ? 'boss.miasma' : 'qiankun.hover', 0.3);
  if (phase === 'look') k.cue(2.2, 'dialogue.blip', 0.4);
  return {
    root,
    narrAt: { x: 0.86, y: 0.12, h: 0.6 }, // 上沿让开「跳过」

    minT: phase === 'look' ? 5 : 4,
    update(dt, t) {
      stars.clear();
      for (const p of starPts) stars.rect(p.x, p.y, 1, 1).fill({ color: hex(p.b < 0.3 ? 'Z' : 'T'), alpha: 0.35 + 0.35 * Math.sin(t * 1.3 + p.ph) * (0.5 + p.b * 0.5) });
      // 缝张开的程度：open 镜头里从无到有（约三秒），后面两镜一直开着、微微呼吸
      const open = phase === 'open' ? ease((t - 0.6) / 3) : 1;
      const breathe = 1 + 0.06 * Math.sin(t * 1.7);
      const maxW = 9 * open * breathe; // 缝最宽处的半宽
      seam.clear();
      seamMask.clear();
      glow.clear();
      if (open > 0.01) {
        for (let y = seamTop; y <= seamBot; y++) {
          const u = (y - seamTop) / (seamBot - seamTop);
          // 上下两头尖、中间偏下最宽（像一道竖着裂开的缝）
          const hw = maxW * Math.sin(Math.min(1, u * 1.08) * Math.PI) ** 0.8;
          const n = Math.max(0, Math.round(hw));
          for (let x = -n; x <= n; x++) {
            const edge = Math.abs(x) >= n - 0.5;
            seam.rect(seamX + x, y, 1, 1).fill({ color: hex(edge ? 'y' : Math.abs(x) < n * 0.45 ? 'W' : 'Y') });
          }
          if (n > 0) seamMask.rect(seamX - n + 1, y, n * 2 - 1, 1).fill({ color: 0xffffff });
          // 缝两边一竖淡淡的金光（一层层往外淡，只有几像素宽，不是一圈）
          const a = 0.16 * open * Math.sin(u * Math.PI);
          if (a > 0.01) for (let j = 1; j <= 5; j++) glow.rect(seamX - n - j, y, 1, 1).fill({ color: hex('y'), alpha: a * (1 - j / 6) }).rect(seamX + n + j, y, 1, 1).fill({ color: hex('y'), alpha: a * (1 - j / 6) });
        }
        // 缝脚下的阵心石上映出一点金
        glow.rect(seamX - 10, sealY - 3, 21, 2).fill({ color: hex('Y'), alpha: 0.18 * open });
      }
      // 缝里的人（门那边，远远的）：站在缝最宽的那一段里；look 镜头里在 2.2–3.6 秒回头（剪影，不露脸）；hold 镜头里慢慢退进金光（变淡、变小）
      const figY = Math.round(seamTop + (seamBot - seamTop) * 0.62);
      if (phase === 'open') figS.visible = false;
      else {
        figS.visible = true;
        const turned = phase === 'look' && t > 2.2 && t < 3.7;
        figS.texture = fig[turned ? 1 : 0];
        const back = phase === 'hold' ? ease((t - 0.5) / 3) : 0;
        figS.position.set(seamX, Math.round(figY - back * 6));
        figS.scale.set(1 - back * 0.3);
        figS.alpha = 1 - back;
      }
      hero.texture = heroT[Math.floor(t * 4) % heroT.length];
      if (open > 0.3 && Math.random() < dt * (phase === 'hold' ? 22 : 12)) mote();
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.t += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.vx *= Math.exp(-dt * 0.8);
        if (m.t >= m.life) {
          m.s.destroy();
          motes.splice(i, 1);
          continue;
        }
        m.s.alpha = Math.sin((m.t / m.life) * Math.PI) * 0.8;
        m.s.position.set(Math.round(m.x), Math.round(m.y));
      }
    },
  };
}
