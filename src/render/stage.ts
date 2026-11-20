// 场景舞台：画布、各层容器、魔气、光照图、暗角、镜头。战场的「环境」（地面、道具、漂浮物、灵光、云影）是一个场景（scenes.ts），
// 每一章一套，按章节表的场景 id 切换（setScene）：'plaza' 第一章悬在云海上的回响仙台，'xiqi' 第二章西岐城外，'jiepai' 第三章界牌关前的山谷。
// 只管「环境」，不管角色和战斗；角色由调用方放进 entities / fx。
//
// 画面怎么上屏（2026-11-10）：整个场景（scene）先 1:1 画进一张 480×270 的贴图，再把这张图按整数倍 r 最近邻放大，
// 画到画布的后备缓冲上（canvas.width / height = 480r × 270r），最后由浏览器把画布平滑地缩到页面上的大小——
// 画面按 16:9 尽量铺满窗口，不再限定整数倍，像素也不会大小不匀（算法见 view-fit.ts）。
// 所以 app.stage 上只有那张放大用的图；游戏里的东西都在 scene 底下。
import { Application, Container, Matrix, RenderTexture, Sprite, TilingSprite, type RenderOptions, type Texture } from 'pixi.js';
import { grid, type Grid } from '../art/pixel.ts';
import { mulberry32, type Bitmap } from '../art/ground.ts';
import { PALETTE, hexToRgba } from '../art/palette.ts';
import { makeMiasma, makeMiasmaPuffs } from '../art/plaza.ts';
import { MIASMA } from '../sim/config.ts';
import { once, steppedLightTexture, textureFromBitmap, textureFromGrid, vignetteTexture } from './textures.ts';
import { setLowRes, VIEW_H, VIEW_W, viewFit, type ViewFit } from './view-fit.ts';
import { quality } from './quality.ts';
import { safeBox } from './safe-area.ts';
import { plazaScene, type Scene, type SceneBuilder, type SceneCtx } from './scenes.ts';
import { warmShaders } from './warmup.ts';
import './sort-children.ts'; // 按 y 排前后改用插入排序（结果一样、不分配内存）
import { xiqiScene } from './scene-xiqi.ts';
import { jiepaiScene } from './scene-jiepai.ts';

export { VIEW_H, VIEW_W } from './view-fit.ts';
/** 场景 id → 搭场景的函数（章节表 chapters.ts 的 ChapterDef.scene）。没登记的 id 用第一章的仙台。 */
export const SCENES: Record<string, SceneBuilder> = { plaza: plazaScene, xiqi: xiqiScene, jiepai: jiepaiScene };
// 镜头始终以人物为中心、不夹边（用户：越过边缘视角也要居中）。所以魔气和云海要铺到魔气外沿再往外半个屏幕
const MARGIN = MIASMA.depth + VIEW_W / 2 + 16;
/** 画面的底色（场景贴图和画布都用它清屏）。 */
const BACKGROUND = '#140f19';
/**
 * 场景画进贴图时整体往上挪 1/1024 像素。WebGL 往贴图里画时 y 轴是倒过来的，roundPixels 对恰好落在半像素上的点
 * （锚点 0.5、高度为奇数的影子之类）取整的方向和直接画到画布上相反，这些东西会整体低一像素；
 * 挪这一点点，它们就和原来一样往上取整。不在半像素上的点不受影响。
 */
const SCENE_NUDGE = new Matrix(1, 0, 0, 1, 0, -1 / 1024);
/** 角色脚下的影子（大的、小的）：tex.shadow / smallShadow 用的就是这两张网格（敌人的影子另排成一张图集画在一层里，enemy-views.ts）。 */
export const SHADOW = grid(['..kkkkkkkk..', 'kkkkkkkkkkkk', '..kkkkkkkk..']);
export const SMALL_SHADOW = grid(['.kkkkkk.', 'kkkkkkkk', '.kkkkkk.']);

/**
 * 把画布摆进窗口：按 16:9 尽量铺满（不限整数倍），返回这次的摆法（后备缓冲该放大几倍见 fit.r）。
 * 铺的是扣掉安全区（刘海、圆角、底部横条）的那一块（safe-area.ts），#stage 的内边距是同一块，画布在里面居中。
 * 竖着拿手机时就是横屏的画面等比缩小：宽度占满，上下露出页面的底。
 * 画布由浏览器平滑缩放，所以把 image-rendering 设回 auto（页面样式里写的 pixelated 会让非整数倍的像素大小不匀）。
 */
export function fitCanvas(canvas: HTMLCanvasElement): ViewFit {
  const box = safeBox();
  const fit = viewFit(box.width, box.height, window.devicePixelRatio || 1);
  canvas.style.width = `${fit.cssW}px`;
  canvas.style.height = `${fit.cssH}px`;
  canvas.style.imageRendering = 'auto';
  return fit;
}

export interface Stage {
  app: Application;
  /** 画面里的全部内容（world、光照、glow、screen 都在它底下）：每帧先画进 480×270 的贴图，再整数倍放大到画布。 */
  scene: Container;
  /** 画布的后备缓冲相对 480×270 放大了几倍（整数，随窗口大小变）。直接从 app.canvas 上取像素时，坐标要乘它。 */
  readonly zoom: number;
  world: Container; // 跟着镜头走的世界
  floor: Container; // 贴地层（影子、灵石），不排序
  entities: Container; // 按 y 排序的角色与道具
  fx: Container; // 角色之上的特效（普通混合）
  glow: Container; // 角色之上的发光（加法混合），世界坐标
  screen: Container; // 屏幕空间的最上层（闪屏、摇杆）
  worldW: number;
  worldH: number;
  cam: { x: number; y: number };
  tex: { lightS: Texture; lightM: Texture; dot: Texture; shadow: Texture; smallShadow: Texture };
  addGlow(t: Texture, tint: number, alpha: number): Sprite;
  textures(gs: Grid[]): Texture[];
  /** 镜头对准 (x, y)，shake 是表现层的抖动偏移（像素）。 */
  lookAt(x: number, y: number, shakeX?: number, shakeY?: number): void;
  /** 魔焰焚城：魔气从四边往里压了多深（世界像素，左右 ix、上下 iy）。 */
  setMiasmaInset(ix: number, iy: number): void;
  /** 魔气马上要再往里推：前沿翻涌、火星变多（0..1）。 */
  setMiasmaAgitation(k: number): void;
  /** 换场景（章节表的场景 id）：拆掉现在的地面、道具、漂浮物，搭新的一套。同一个 id 不重搭。 */
  setScene(id: string): void;
  /** 现在的场景 id。 */
  readonly sceneId: string;
  update(dt: number): void;
  /** 拆掉这个舞台：停主循环、销毁场景和渲染器、移除画布和窗口监听。共用的纹理（见 textures.ts 的 once）留着给下一局。 */
  destroy(): void;
}

// ---------- 魔焰焚城的魔气前沿 ----------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** 前沿条的宽度：分界线两侧各 FRONT/2 像素，外侧是满浓度、内侧是透明。 */
const FRONT = 200;
/** 圆角：能站的地方四个角按这个半径收圆，魔气从角上斜着漫进来，不留方方正正的「框」。 */
const CORNER_R = 96;
const CORNER_W = CORNER_R + FRONT / 2;
/**
 * 一条直的魔气前沿（给魔焰焚城往里推的魔气用）：浓度剖面、噪声打散、抖动量化、底色渐变，全都和 plaza.makeMiasma 一样，
 * 所以推进来的魔气和场外原有的魔气看不出接缝。orient 'v'：前沿竖着，外侧（满浓度）在左；'h'：前沿横着，外侧在上。
 */
/** 平滑插值的格点值噪声（[0,1]），cell 越大越平缓。 */
function valueNoise(rnd: () => number, cell: number, w: number, h: number) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g1 = Array.from({ length: gw * gh }, rnd);
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const fx = u / cell;
    const fy = v / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fade(fx - ix);
    const ty = fade(fy - iy);
    const at = (i: number, j: number) => g1[(iy + j) * gw + (ix + i)];
    const a = at(0, 0) + (at(1, 0) - at(0, 0)) * tx;
    const b = at(0, 1) + (at(1, 1) - at(0, 1)) * tx;
    return a + (b - a) * ty;
  };
}

function makeMiasmaFront(len: number, seed: number, orient: 'v' | 'h', depth: number): { density: Bitmap; base: Bitmap } {
  const rnd = mulberry32(seed);
  // 两层噪声：40 像素一格的细碎起伏（同场外原有的魔气），再叠一层 120 像素一格的大起伏——
  // 前沿一段段往里探出魔气的「舌头」，不会是一条直线
  const n1 = valueNoise(rnd, 40, FRONT, len);
  const n2 = valueNoise(rnd, 120, FRONT, len);
  const noise = (u: number, v: number) => n1(u, v) + (n2(u * 0.25, v) - 0.5) * 1.3;
  const inner = 44;
  const full = depth * 0.7;
  const cA = hexToRgba(PALETTE.P);
  const cB = hexToRgba(PALETTE.d);
  const cC = hexToRgba(PALETTE.k);
  const LEVELS = 14;
  const W = orient === 'v' ? FRONT : len;
  const H = orient === 'v' ? len : FRONT;
  const density = new Uint8ClampedArray(W * H * 4);
  const base = new Uint8ClampedArray(W * H * 4);
  const mix = (a: number[], b: number[], k: number) => a.map((v, n) => Math.round(v + (b[n] - v) * k));
  for (let v = 0; v < len; v++)
    for (let u = 0; u < FRONT; u++) {
      const out = FRONT / 2 - u - 0.5; // 正 = 在魔气里（离分界线多远）
      let t = (out + inner) / (full + inner) + (noise(u, v) - 0.5) * 0.4;
      if (t <= 0) continue;
      t = Math.min(1, t);
      const sm = t * t * (3 - 2 * t);
      const x = orient === 'v' ? u : v;
      const y = orient === 'v' ? v : u;
      const av = sm * 0.99 * LEVELS;
      const lo = Math.floor(av);
      const q = (av - lo > BAYER[(y % 4) * 4 + (x % 4)] ? lo + 1 : lo) / LEVELS;
      if (q <= 0) continue;
      const i = (y * W + x) * 4;
      density.set([255, 255, 255, Math.round(q * 255)], i);
      const c = sm < 0.5 ? mix(cA, cB, sm * 2) : mix(cB, cC, (sm - 0.5) * 2);
      base.set([c[0], c[1], c[2], Math.round(Math.min(1, q * 1.05) * 255)], i);
    }
  return { density: { w: W, h: H, data: density }, base: { w: W, h: H, data: base } };
}

/**
 * 左上角的圆角魔气（其余三个角镜像）：像素 (x, y) 离圆心（右下角）的距离超过 CORNER_R 的部分按同样的剖面变浓；
 * 靠近两条直边的地方淡掉，和直的前沿条接得上、看不出接缝。
 */
function makeMiasmaCorner(seed: number, depth: number): { density: Bitmap; base: Bitmap } {
  const rnd = mulberry32(seed);
  const n1 = valueNoise(rnd, 40, CORNER_W, CORNER_W);
  const inner = 44;
  const full = depth * 0.7;
  const cA = hexToRgba(PALETTE.P);
  const cB = hexToRgba(PALETTE.d);
  const cC = hexToRgba(PALETTE.k);
  const LEVELS = 14;
  const S = CORNER_W;
  const density = new Uint8ClampedArray(S * S * 4);
  const base = new Uint8ClampedArray(S * S * 4);
  const mix = (a: number[], b: number[], k: number) => a.map((v, n) => Math.round(v + (b[n] - v) * k));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = S - 0.5 - x;
      const v = S - 0.5 - y;
      const out = Math.hypot(u, v) - CORNER_R;
      const edge = Math.min(u, v);
      const wgt = Math.max(0, Math.min(1, edge / 40));
      let t = ((out + inner) / (full + inner) + (n1(x, y) - 0.5) * 0.4) * (wgt * wgt * (3 - 2 * wgt));
      if (t <= 0) continue;
      t = Math.min(1, t);
      const sm = t * t * (3 - 2 * t);
      const av = sm * 0.99 * LEVELS;
      const lo = Math.floor(av);
      const q = (av - lo > BAYER[(y % 4) * 4 + (x % 4)] ? lo + 1 : lo) / LEVELS;
      if (q <= 0) continue;
      const i = (y * S + x) * 4;
      density.set([255, 255, 255, Math.round(q * 255)], i);
      const c = sm < 0.5 ? mix(cA, cB, sm * 2) : mix(cB, cC, (sm - 0.5) * 2);
      base.set([c[0], c[1], c[2], Math.round(Math.min(1, q * 1.05) * 255)], i);
    }
  return { density: { w: S, h: S, data: density }, base: { w: S, h: S, data: base } };
}

export async function createStage(mount: HTMLElement, worldW: number, worldH: number, seed = 20261109, sceneId = 'plaza'): Promise<Stage> {
  const app = new Application();
  setLowRes(quality.tier === 'low'); // 画质档（quality.ts）：低档的后备缓冲少放大一档
  let zoom = viewFit(safeBox().width, safeBox().height, window.devicePixelRatio || 1).r;
  await app.init({ width: VIEW_W * zoom, height: VIEW_H * zoom, antialias: false, resolution: 1, roundPixels: true, background: BACKGROUND });
  const canvas = app.canvas; // 先拿住：拆掉（app.destroy）之后 app.canvas 会报错
  mount.appendChild(canvas);
  fitCanvas(canvas);
  warmShaders(app.renderer); // 局里才第一次用到的着色器先编好，免得打着打着顿一下（warmup.ts）

  // ---------- 场景 → 480×270 的贴图 → 整数倍放大到画布 ----------
  const scene = new Container();
  const sceneRT = RenderTexture.create({ width: VIEW_W, height: VIEW_H });
  sceneRT.source.scaleMode = 'nearest';
  const view = new Sprite(sceneRT);
  view.scale.set(zoom);
  app.stage.addChild(view);
  app.stage.eventMode = 'none'; // 不用 Pixi 的指针事件（输入都走 DOM），不让它每次指针移动都来做命中检测
  // 凡是「把 app.stage 画到画布上」的地方（主循环自动画的、实验页手动画的）都先把场景画进贴图，调用方不用管这一步。
  // app.stage.visible = false 时两步都跳过（万宝阁盖着时不画战场）。
  const renderer = app.renderer;
  // 原版的 render 每次都从原型上取（不在这里先存下来）：自查脚本事后给原型打的补丁（计时）照样生效
  const proto = Object.getPrototypeOf(renderer) as { render(options: RenderOptions | Container, deprecated?: { renderTexture: unknown }): void };
  const draw = (options: RenderOptions | Container, deprecated?: { renderTexture: unknown }) => proto.render.call(renderer, options, deprecated);
  renderer.render = ((options: RenderOptions | Container, deprecated?: { renderTexture: unknown }) => {
    const container = options instanceof Container ? options : options.container;
    const toCanvas = options instanceof Container ? !deprecated : !options.target;
    if (container === app.stage && toCanvas && container.visible) draw({ container: scene, target: sceneRT, clear: true, clearColor: BACKGROUND, transform: SCENE_NUDGE });
    draw(options, deprecated);
  }) as typeof renderer.render;
  /** 窗口变了：画布重新摆；需要的放大倍数变了就改后备缓冲的大小，并马上补画一帧（改大小会清空画布）。 */
  const refit = () => {
    const fit = fitCanvas(canvas);
    if (fit.r === zoom) return;
    zoom = fit.r;
    renderer.resize(VIEW_W * zoom, VIEW_H * zoom);
    view.scale.set(zoom);
    app.render();
  };
  // 转屏、手机浏览器的地址栏出来 / 收起（visualViewport 的 resize）、进出全屏都会改窗口大小。
  // 有的手机转屏时 resize 来得早、那一刻量到的还是旧的宽高，所以停下来之后再量两次
  let later: number[] = [];
  const onResize = () => {
    refit();
    for (const t of later) clearTimeout(t);
    later = [120, 400].map((ms) => window.setTimeout(refit, ms));
  };
  addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  addEventListener('orientationchange', onResize);

  const rnd = mulberry32(seed);
  const textures = (gs: Grid[]) => gs.map(textureFromGrid);
  // 下面这些纹理每一局都一模一样（固定种子、固定尺寸）：整个会话只生成一次（textures.ts 的 once），再开一局直接拿。
  const tex = once('stage:tex', () => ({
    lightS: steppedLightTexture(8, 2), // 道具的辉光只留一小点（用户：不要光圈）
    lightM: steppedLightTexture(40, 4),
    dot: textureFromGrid(grid(['W'])),
    shadow: textureFromGrid(SHADOW),
    smallShadow: textureFromGrid(SMALL_SHADOW),
  }));
  const size = `${worldW}x${worldH}`;

  // ---------- 世界层 ----------
  // 世界层是一个渲染组（Pixi 8 的 render group）：镜头每帧挪的只是这一组整体的变换（在显卡上乘），
  // 不用每帧把底下几千个精灵的变换重算一遍、顶点重写一遍——只有自己动了的才重算（docs/perf.md）。
  const world = new Container({ isRenderGroup: true });
  // 地面往魔气带里多铺一截，交界处只剩魔气的浓淡，没有「地面到此为止」的直线
  const EXT = MIASMA.depth + 24;
  // 场景的地面（在魔气下面）：每一章的场景往这里放地面贴图（scenes.ts）
  const groundLayer = new Container();
  // 远景（在魔气的底色之上、翻滚的烟团之下）：隔着魔气看得见的东西（第二章北边的城墙剪影）
  const horizonLayer = new Container();
  // 魔气：底色渐变 + 两层翻滚的烟团；烟团用浓度图当遮罩露出来，所以没有直线边。
  // 底色和浓度图都画进 RenderTexture：魔焰焚城往里压时，把「原来的魔气 + 四条带软前沿的浓度条 + 靠外的满浓度区」
  // 用 GPU 画进去（几块精灵），不在 CPU 上逐像素算；烟团层的贴图位置不变，所以推进来的魔气和场外的接得上。
  const MW = worldW + MARGIN * 2;
  const MH = worldH + MARGIN * 2;
  const baseRT = RenderTexture.create({ width: MW, height: MH });
  baseRT.source.scaleMode = 'nearest';
  const densRT = RenderTexture.create({ width: MW, height: MH });
  densRT.source.scaleMode = 'nearest';
  const miasmaBase = new Sprite(baseRT);
  miasmaBase.position.set(-MARGIN, -MARGIN);
  // 前沿条只要盖住仙台那一段（再往外原本就是满浓度的魔气）
  const SPAN = 100;
  /** 一对位图（浓度图 + 底色图）各建一张纹理。 */
  const pair = (b: { density: Bitmap; base: Bitmap }) => ({ density: textureFromBitmap(b.density), base: textureFromBitmap(b.base) });
  const miasma = once(`stage:miasma:${size}`, () => ({
    orig: pair(makeMiasma(worldW, worldH, MIASMA.depth, MARGIN)),
    fronts: {
      l: pair(makeMiasmaFront(worldH + SPAN * 2, 31, 'v', MIASMA.depth)),
      r: pair(makeMiasmaFront(worldH + SPAN * 2, 37, 'v', MIASMA.depth)),
      t: pair(makeMiasmaFront(worldW + SPAN * 2, 41, 'h', MIASMA.depth)),
      b: pair(makeMiasmaFront(worldW + SPAN * 2, 43, 'h', MIASMA.depth)),
    },
    corner: pair(makeMiasmaCorner(47, MIASMA.depth)),
    solidK: textureFromBitmap({ w: 1, h: 1, data: new Uint8ClampedArray(hexToRgba(PALETTE.k)) }),
    solidW: textureFromBitmap({ w: 1, h: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }),
    puffFar: textureFromBitmap(makeMiasmaPuffs(192, 61, 'far')),
    puffNear: textureFromBitmap(makeMiasmaPuffs(160, 73, 'near')),
  }));
  const mkLayer = (key: 'density' | 'base', solid: Texture) => {
    const c = new Container();
    c.addChild(new Sprite(miasma.orig[key]));
    const strips = (['l', 'r', 't', 'b'] as const).map((k) => {
      const sp = new Sprite(miasma.fronts[k][key]);
      sp.visible = false;
      c.addChild(sp);
      return sp;
    });
    const solids = [0, 1, 2, 3].map(() => {
      const sp = new Sprite(solid);
      sp.visible = false;
      c.addChild(sp);
      return sp;
    });
    const corners = [0, 1, 2, 3].map((k) => {
      const sp = new Sprite(miasma.corner[key]);
      sp.visible = false;
      sp.scale.set(k % 2 ? -1 : 1, k >= 2 ? -1 : 1); // 左上、右上、左下、右下
      c.addChild(sp);
      return sp;
    });
    return { c, strips, solids, corners };
  };
  const mBase = mkLayer('base', miasma.solidK);
  const mDens = mkLayer('density', miasma.solidW);
  let inset = { x: -1, y: -1 };
  let agitation = 0;
  /** 把缩进画进两张 RenderTexture。wob：前沿翻涌的位移（像素）。 */
  const drawMiasma = (ix: number, iy: number, wob: number[]) => {
    for (const L of [mBase, mDens]) {
      const on = ix > 0.5 || iy > 0.5;
      const [l, r, t, b] = L.strips;
      const [sl, sr, st, sb] = L.solids;
      for (const sp of [...L.strips, ...L.solids, ...L.corners]) sp.visible = on;
      if (on) {
        // 坐标都是相对 RenderTexture 左上角（世界坐标 -MARGIN, -MARGIN）
        const lx = Math.round(MARGIN + ix - FRONT / 2 + wob[0]);
        const rx = Math.round(MARGIN + worldW - ix + FRONT / 2 + wob[1]);
        const ty = Math.round(MARGIN + iy - FRONT / 2 + wob[2]);
        const by = Math.round(MARGIN + worldH - iy + FRONT / 2 + wob[3]);
        l.position.set(lx, MARGIN - SPAN);
        r.position.set(rx, MARGIN - SPAN);
        r.scale.x = -1;
        t.position.set(MARGIN - SPAN, ty);
        b.position.set(MARGIN - SPAN, by);
        b.scale.y = -1;
        sl.position.set(0, 0);
        sl.scale.set(Math.max(0, lx), MH);
        sr.position.set(rx, 0);
        sr.scale.set(Math.max(0, MW - rx), MH);
        st.position.set(0, 0);
        st.scale.set(MW, Math.max(0, ty));
        sb.position.set(0, by);
        sb.scale.set(MW, Math.max(0, MH - by));
        // 圆角：圆心在能站的地方往里 CORNER_R 处；推得越深越明显（刚开始推时淡一些，免得一下子冒出来）
        const cx0 = MARGIN + ix + CORNER_R;
        const cx1 = MARGIN + worldW - ix - CORNER_R;
        const cy0 = MARGIN + iy + CORNER_R;
        const cy1 = MARGIN + worldH - iy - CORNER_R;
        const ca = Math.max(0, Math.min(1, Math.min(ix, iy * 1.8) / 40));
        L.corners.forEach((sp, k) => {
          const cx = k % 2 ? cx1 + CORNER_W : cx0 - CORNER_W;
          const cy = k >= 2 ? cy1 + CORNER_W : cy0 - CORNER_W;
          sp.position.set(Math.round(cx + (k % 2 ? 0 : 0) + (k % 2 ? wob[1] : wob[0])), Math.round(cy + (k >= 2 ? wob[3] : wob[2])));
          sp.alpha = ca;
        });
      }
      app.renderer.render({ container: L.c, target: L === mBase ? baseRT : densRT, clear: true, clearColor: [0, 0, 0, 0] });
    }
  };
  const puffs = new Container();
  const puffFar = new TilingSprite({ texture: miasma.puffFar, width: worldW + MARGIN * 2, height: worldH + MARGIN * 2 });
  const puffNear = new TilingSprite({ texture: miasma.puffNear, width: worldW + MARGIN * 2, height: worldH + MARGIN * 2 });
  puffFar.position.set(-MARGIN, -MARGIN);
  puffNear.position.set(-MARGIN, -MARGIN);
  puffNear.alpha = 0.7;
  puffs.addChild(puffFar, puffNear);
  const puffMask = new Sprite(densRT);
  puffMask.position.set(-MARGIN, -MARGIN);
  puffs.mask = puffMask;
  const floor = new Container();
  const entities = new Container({ sortableChildren: true });
  const fx = new Container();
  // 云海和台基边线不再画：仙台外全被魔气吞没（用户：交界处不要分明）
  world.addChild(groundLayer, miasmaBase, horizonLayer, puffs, puffMask, floor, entities, fx);

  // ---------- 光照图（屏幕空间，乘到世界上） ----------
  const lightRT = RenderTexture.create({ width: VIEW_W, height: VIEW_H });
  lightRT.source.scaleMode = 'nearest';
  const lightScene = new Container();
  const vignette = new Sprite();
  lightScene.addChild(vignette);
  const lightOverlay = new Sprite(lightRT);
  lightOverlay.blendMode = 'multiply';

  const glow = new Container();
  glow.blendMode = 'add';
  // 辉光层跟着镜头走，同样包一层渲染组（只挪这一层）。混合方式留在 glow 自己身上：渲染组的根不往下传混合方式，
  // 所以根是外面这一层、glow 是它唯一的孩子，底下的精灵照旧从 glow 继承加法混合
  const glowRoot = new Container({ isRenderGroup: true });
  glowRoot.addChild(glow);
  const screen = new Container();
  scene.addChild(world, lightOverlay, glowRoot, screen);

  const addGlow = (t: Texture, tint: number, alpha: number) => {
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.tint = tint;
    s.alpha = alpha;
    glow.addChild(s);
    return s;
  };

  // 结界虚线已去掉：仙台的边界由魔气表现（用户提议）

  // ---------- 场景（按章切换，scenes.ts） ----------
  const cam = { x: 0, y: 0 };
  let current: Scene | null = null;
  let currentId = '';
  /** 第一个场景接着用舞台的随机数（和原来的先后一样，第一章看起来和以前一模一样）；换过去的场景各用自己的固定种子。 */
  let sceneRnd: () => number = rnd;
  const setScene = (id: string) => {
    if (id === currentId) return;
    current?.destroy();
    currentId = id;
    const ctx: SceneCtx = { worldW, worldH, ext: EXT, rnd: sceneRnd, ground: groundLayer, horizon: horizonLayer, floor, entities, fx, glow, light: lightScene, cam, tex, addGlow };
    current = (SCENES[id] ?? SCENES.plaza)(ctx);
    vignette.texture = vignetteTexture(VIEW_W, VIEW_H, current.vignette.inner, current.vignette.outer);
    sceneRnd = mulberry32(seed + 7919 * [...id].reduce((a, c) => a + c.charCodeAt(0), 0));
  };
  setScene(sceneId);

  const embers: { s: Sprite; t: number; life: number; v: number; seed: number }[] = [];
  const spawnEmber = (x: number, y: number) => {
    const s = new Sprite(tex.dot);
    s.tint = rnd() < 0.55 ? 0xd9452b : rnd() < 0.5 ? 0xd47aa0 : 0x8a4a7a;
    s.blendMode = 'add';
    s.position.set(Math.round(x), Math.round(y));
    glow.addChild(s);
    return { s, t: 0, life: 1.2 + rnd() * 1.6, v: 6 + rnd() * 12, seed: rnd() * 10 };
  };
  let time = 0;
  let shake = { x: 0, y: 0 };
  drawMiasma(0, 0, [0, 0, 0, 0]);
  inset = { x: 0, y: 0 };
  // 画质档（quality.ts）：低档不画魔气里翻滚的烟团（省一遍离屏贴图 + 遮罩），后备缓冲少放大一档；换档时马上重摆画布
  const applyQuality = () => {
    const low = quality.tier === 'low';
    setLowRes(low);
    puffs.visible = puffMask.visible = !low;
    refit();
  };
  applyQuality();
  const offQuality = quality.onChange(applyQuality);
  return {
    app,
    scene,
    get zoom() {
      return zoom;
    },
    world,
    floor,
    entities,
    fx,
    glow,
    screen,
    worldW,
    worldH,
    cam,
    tex,
    addGlow,
    textures,
    setScene,
    get sceneId() {
      return currentId;
    },
    setMiasmaInset(ix, iy) {
      ix = Math.max(0, ix);
      iy = Math.max(0, iy);
      if (Math.abs(ix - inset.x) < 0.25 && Math.abs(iy - inset.y) < 0.25) return;
      inset = { x: ix, y: iy };
      if (agitation <= 0.01) drawMiasma(ix, iy, [0, 0, 0, 0]);
    },
    setMiasmaAgitation(k) {
      const was = agitation;
      agitation = Math.max(0, Math.min(1, k));
      if (was > 0.01 && agitation <= 0.01) drawMiasma(Math.max(0, inset.x), Math.max(0, inset.y), [0, 0, 0, 0]);
    },
    lookAt(x, y, sx = 0, sy = 0) {
      cam.x = x - VIEW_W / 2;
      cam.y = y - VIEW_H / 2;
      shake = { x: sx, y: sy };
      world.position.set(-Math.round(cam.x) + Math.round(sx), -Math.round(cam.y) + Math.round(sy));
      glowRoot.position.copyFrom(world.position);
    },
    update(dt) {
      time += dt;
      puffFar.tilePosition.set(time * 3, Math.sin(time * 0.2) * 8 - time * 2);
      puffNear.tilePosition.set(-time * 6, time * 4 + Math.sin(time * 0.35) * 6);
      // 魔气里升起的火星：只在镜头内、且在魔气里（魔焰焚城压进来的也算）的位置生成；推进前的预警时更多
      const ix = Math.max(0, inset.x);
      const iy = Math.max(0, inset.y);
      for (let n = 0; n < 1 + Math.round(agitation * 3); n++) {
        if (rnd() > 0.6 + agitation * 0.4) continue;
        const x = cam.x + rnd() * VIEW_W;
        const y = cam.y + rnd() * VIEW_H;
        const edge = agitation > 0 ? 40 : 6; // 预警时前沿附近也冒火星
        if (x < ix - 6 + edge * agitation || y < iy - 6 + edge * agitation || x > worldW - ix + 6 - edge * agitation || y > worldH - iy + 6 - edge * agitation) embers.push(spawnEmber(x, y));
      }
      // 前沿翻涌：预警时前沿来回涌动（重画遮罩）
      if (agitation > 0.01 && (ix > 0.5 || iy > 0.5)) {
        const a = agitation * 4;
        drawMiasma(ix, iy, [Math.sin(time * 5.1) * a, -Math.sin(time * 4.3 + 1) * a, Math.sin(time * 4.7 + 2) * a * 0.7, -Math.sin(time * 5.5 + 3) * a * 0.7]);
      }
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.t += dt;
        e.s.x += Math.sin(e.t * 2 + e.seed) * 6 * dt;
        e.s.y -= e.v * dt;
        e.s.alpha = Math.max(0, Math.sin((e.t / e.life) * Math.PI));
        if (e.t >= e.life) {
          e.s.destroy();
          embers.splice(i, 1);
        }
      }
      current?.update(dt, time, shake); // 场景：漂浮物、灵光、云影……（scenes.ts）
      if (app.stage.visible) app.renderer.render({ container: lightScene, target: lightRT, clear: true, clearColor: '#000000' }); // 画面盖着时（万宝阁）不用画
    },
    destroy() {
      removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      removeEventListener('orientationchange', onResize);
      for (const t of later) clearTimeout(t);
      app.ticker.stop();
      current?.destroy();
      current = null;
      offQuality();
      // 场景不挂在 app.stage 底下，要自己销毁；精灵用的纹理不动（共用的那些下一局还要用）
      for (const c of [scene, mBase.c, mDens.c, lightScene]) c.destroy({ children: true });
      // 这一局自己的几张渲染贴图
      for (const t of [sceneRT, baseRT, densRT, lightRT]) t.destroy(true);
      // 开发版 Pixi 销毁渲染器时会警告两句「纹理还绑在着色器上」（它自己的销毁顺序），无害。
      // releaseGlobalResources：清掉 Pixi 的全局池（批次、临时贴图……），免得旧渲染器的东西被下一局的渲染器拿去用（传 true 也是这个意思，这里写明）
      app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    },
  };
}
