/// <reference types="vite/client" />
// pixelfx 在游戏里的接口（表现层）：在 TypeScript 里直接播 pixelfx 的像素特效。
//
// pixelfx（https://github.com/patch-gg/pixelfx，MIT，原样放在 vendor/pixelfx/）是一套「用代码画的」像素特效：
// 每个特效每帧往两张缓冲里画——color（像素）和 light（辉光），合成成 RGBA 后我们上传成 Pixi 纹理，放在世界坐标里。
// 用户口径（2026-11-10）：要符合修仙风格，必要时做适当改造。所以游戏里不直接用库的原配色：
// 一律走 src/render/pixelfx-xianxia.ts 里的「修仙版」预设（调色板换成游戏的传统色、辉光压低、去掉光圈类的东西）；
// 需要改形状的，复制到 vendor/pixelfx/src/fx/xianxia/ 下改（我们自己的分类，库里没有），id 写成 'xianxia/<名字>'。
// 放在库的 fx 目录里，是为了让库的工具（render / check / list）照常能用，import 路径也和原作一样，方便对照。
//
// 两种播法：
// - play()：现场画，每帧合成一次、整张上传。能跟着东西走（follow），能随时改位置，特效自己的旋钮都能用。适合持续的、要跟随的、数量少的效果。
// - playBaked()：预先把所有帧画好、裁掉空白、排进图集（pixelfx-pack.ts），播放时只换贴图，几乎不花 CPU，同一个特效的很多份还能合批。
//   适合满场都会出现的一次性效果（命中、消散、拾取）。第一次画要花时间（大的特效上百毫秒），所以开局载入时先 prebake()。
//   两种播法的画面只差在半透明抖动的网点上：库把 4×4 的网点钉在世界坐标上，现场画的网点不跟着特效走，预烘焙的跟着走，
//   所以抖动的边缘会差几个像素，肉眼看不出。位置对齐网点时两者逐像素一致（node tools/pixelfx-shot.mjs <名> --compare 核对）。
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { clearFrame, composite, createFrame, createFx, type FxFrame, type FxInstance, type FxModule, type FxOptions } from '../../vendor/pixelfx/src/core/index.js';
import { bakeAtlas } from './pixelfx-pack.ts';

const LIB = import.meta.glob<FxModule>(['../../vendor/pixelfx/src/fx/*/*.js', '!**/_*.js']);
const loaded = new Map<string, Promise<FxModule>>();

/** 特效的 id：'<分类>/<名字>'，如 'ice/frost-nova'；我们改造过的在 'xianxia/<名字>'。 */
export type FxId = string;

const loaderOf = (id: FxId) => LIB[`../../vendor/pixelfx/src/fx/${id}.js`];

/** 按 id 载入一个特效模块（按需加载，载过的缓存起来）。 */
export function loadFx(id: FxId): Promise<FxModule> {
  let p = loaded.get(id);
  if (!p) {
    const load = loaderOf(id);
    if (!load) return Promise.reject(new Error(`pixelfx：没有这个特效 ${id}`));
    p = load().then((m) => m as FxModule);
    loaded.set(id, p);
  }
  return p;
}

/** 列出所有可用的特效 id（改造过的 xianxia/ 排在前面）。 */
export function listFx(): FxId[] {
  const ids = Object.keys(LIB).map((k) => k.replace('../../vendor/pixelfx/src/fx/', '').replace(/\.js$/, ''));
  return [...ids.filter((i) => i.startsWith('xianxia/')), ...ids.filter((i) => !i.startsWith('xianxia/'))];
}

/** follow 每帧给的位置（世界坐标）；z / flip 可选：跟着改 zIndex（和角色一起按 y 排序时）、左右镜像（只对预烘焙的有用）。 */
export interface FollowAt {
  x: number;
  y: number;
  z?: number;
  flip?: boolean;
}

export interface PlayOptions extends FxOptions {
  /** 每帧问一次位置，跟着它走；返回 null 时特效收尾（循环的淡出，一次性的照常放完）。 */
  follow?: () => FollowAt | null;
  /** 放进容器时的 zIndex（容器开了 sortableChildren 时有用，比如和角色一起按 y 排序）。 */
  z?: number;
  /** 从第几秒开始放（比如转场从合拢的那一刻接着放）。 */
  t0?: number;
  /** 预烘焙的：开头用多少秒淡入（默认 0：第一帧就是满的；循环的状态效果给一点，出现有过程）。 */
  fadeIn?: number;
  /** 整体再乘一个透明度（默认 1）。 */
  alpha?: number;
  /** 现场画的：每秒最多重画几次（默认每帧都画）。库里的特效按 30 帧 / 秒设计，整屏的效果隔帧画能省一半；跟随的位置也只在重画时更新。 */
  fps?: number;
}

export interface FxHandle {
  /** 让它收尾：循环的淡出，一次性的提前结束。 */
  stop(): void;
  /** 放完、已经清理掉了。 */
  readonly done: boolean;
  /** 挪到新位置（世界坐标）。 */
  move(x: number, y: number): void;
}

interface Live {
  fx: FxInstance;
  frame: FxFrame;
  buf: Uint8Array;
  src: BufferImageSource;
  sprite: Sprite;
  ox0: number;
  oy0: number;
  follow?: PlayOptions['follow'];
  handle: { done: boolean };
  every: number; // 隔多久重画一次（秒；0 = 每帧）
  acc: number; // 上次重画之后走了多久
}

/** 一个预先画好的特效：每帧一张贴图（都是图集里的一块；整帧是空的为 null）。 */
export interface Baked {
  textures: (Texture | null)[];
  sources: BufferImageSource[];
  fps: number;
  loop: boolean;
  /** 原点在原画布里的比例位置（精灵的锚点），这样精灵的位置就是特效的原点，镜像也绕着原点翻。 */
  ax: number;
  ay: number;
  /** 图集占的显存（字节）。 */
  bytes: number;
}

interface BakedLive {
  b: Baked | null; // 还没画好时为空，画好了才开始播
  sprite: Sprite;
  t: number;
  x: number;
  y: number;
  follow?: PlayOptions['follow'];
  stopping: number; // 开始收尾的时刻（-1 = 没有）
  handle: { done: boolean };
  fadeIn: number;
  alpha: number;
}

// 画好的图集按 key 存着，跨局、跨图层共用（清场不清它）
const baking = new Map<string, Promise<Baked>>();
const baked = new Map<string, Baked>();

/** 把一个特效画成图集并变成 Pixi 贴图。一般不直接用，走 prebake() / playBaked()。 */
export function bake(mod: FxModule, opts: FxOptions = {}): Baked {
  const a = bakeAtlas(mod, opts);
  const sources = a.pages.map((p) => new BufferImageSource({ resource: p.data, width: p.w, height: p.h, scaleMode: 'nearest', alphaMode: 'premultiply-alpha-on-upload' }));
  const orig = new Rectangle(0, 0, a.w, a.h);
  const textures = a.frames.map((f) => f && new Texture({ source: sources[f.page], frame: new Rectangle(f.x, f.y, f.w, f.h), orig, trim: new Rectangle(f.dx, f.dy, f.w, f.h) }));
  return { textures, sources, fps: a.fps, loop: a.loop, ax: a.ox0 / a.w, ay: a.oy0 / a.h, bytes: a.pixels * 4 };
}

/**
 * 预先画好一个特效（同一个 key 只画一次）。opts 里不要放位置；颜色、种子、旋钮固定在 key 里。
 * 开局载入、波间整理时调，免得战斗中第一次播放时卡一下。
 */
export function prebake(key: string, id: FxId, opts: FxOptions = {}): Promise<Baked> {
  let p = baking.get(key);
  if (!p) {
    p = loadFx(id).then((m) => {
      const b = bake(m, opts);
      baked.set(key, b);
      return b;
    });
    baking.set(key, p);
    p.catch(() => baking.delete(key)); // 失败了（比如 id 写错）下次还能再试
  }
  return p;
}

/** 一口气预画一批（一个接一个，中间让出主线程，不会把画面卡死）。返回一共占了多少显存（字节）。 */
export async function prebakeAll(list: { key: string; id: FxId; opts?: FxOptions }[]): Promise<number> {
  let bytes = 0;
  for (const it of list) {
    bytes += (await prebake(it.key, it.id, it.opts)).bytes;
    await new Promise((r) => setTimeout(r, 0));
  }
  return bytes;
}

/**
 * 一层 pixelfx 特效。把 view 放进世界里的某个容器（比如 stage.fx），每帧调 update(dt)。
 * flat：不另建容器，精灵直接放进 parent（比如 stage.entities，和角色一起按 zIndex 排序：敌人身上的状态、魂散）；
 * 这时 destroy() 只清掉自己的精灵，不动 parent。
 */
export class PixelFxLayer {
  readonly view: Container;
  private lives: Live[] = [];
  private baked: BakedLive[] = [];
  private flat: boolean;

  constructor(parent?: Container, o: { flat?: boolean } = {}) {
    this.flat = !!(o.flat && parent);
    this.view = this.flat ? parent! : new Container();
    if (!this.flat) parent?.addChild(this.view);
  }

  /** 现场画一个特效。o.x / o.y 是世界坐标（特效的原点，通常是脚下或命中点）。 */
  play(mod: FxModule, o: PlayOptions = {}): FxHandle {
    const [w, h] = mod.meta.size;
    const [ox0, oy0] = mod.meta.origin;
    const x = o.x ?? 0;
    const y = o.y ?? 0;
    const { follow, z, t0, fadeIn: _fadeIn, alpha, fps, ...opts } = o;
    const fx = createFx(mod, { ...opts, x: Math.round(x), y: Math.round(y) });
    if (t0) fx.update(t0);
    const frame = createFrame(w, h, Math.round(x) - ox0, Math.round(y) - oy0);
    const buf = new Uint8Array(w * h * 4);
    const src = new BufferImageSource({ resource: buf, width: w, height: h, scaleMode: 'nearest', alphaMode: 'premultiply-alpha-on-upload' });
    const sprite = new Sprite(new Texture({ source: src }));
    sprite.position.set(frame.ox, frame.oy);
    if (z !== undefined) sprite.zIndex = z;
    if (alpha !== undefined) sprite.alpha = alpha;
    this.view.addChild(sprite);
    const handle = { done: false };
    const live: Live = { fx, frame, buf, src, sprite, ox0, oy0, follow, handle, every: fps ? 1 / fps : 0, acc: 0 };
    this.lives.push(live);
    this.draw(live, 0);
    return {
      stop: () => fx.stop(),
      get done() {
        return handle.done;
      },
      move: (nx, ny) => this.place(live, nx, ny),
    };
  }

  /** 按 id 现场画（第一次要等模块载入）。 */
  async playId(id: FxId, o: PlayOptions = {}): Promise<FxHandle> {
    return this.play(await loadFx(id), o);
  }

  /**
   * 播预先画好的特效：同一个 key 只画一次（见 prebake），之后播放只是换贴图。at 给位置（世界坐标）、跟随、zIndex、flip（左右镜像）。
   * 马上返回句柄；还没画好的话，画好了才从头开始播（最好先 prebake，免得第一次卡一下、又晚出来）。
   * 特效的旋钮（颜色、种子、大小）只能在画的时候定，放在 opts 里并体现在 key 上；at 里的 angle 不支持。
   */
  playBaked(key: string, id: FxId, opts: FxOptions, at: PlayOptions = {}): FxHandle {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.visible = false;
    if (at.flip) sprite.scale.x = -1;
    if (at.z !== undefined) sprite.zIndex = at.z;
    this.view.addChild(sprite);
    const handle = { done: false };
    const live: BakedLive = { b: baked.get(key) ?? null, sprite, t: at.t0 ?? 0, x: at.x ?? 0, y: at.y ?? 0, follow: at.follow, stopping: -1, handle, fadeIn: at.fadeIn ?? 0, alpha: at.alpha ?? 1 };
    if (live.b) sprite.anchor.set(live.b.ax, live.b.ay);
    else
      prebake(key, id, opts).then(
        (b) => {
          if (handle.done) return; // 等的时候已经被清掉了
          live.b = b;
          sprite.anchor.set(b.ax, b.ay);
        },
        (e) => {
          console.warn(e);
          live.stopping = 0; // 画不出来：下一帧收掉
        },
      );
    this.baked.push(live);
    return {
      stop: () => {
        if (live.stopping < 0) live.stopping = live.t;
      },
      get done() {
        return handle.done;
      },
      move: (nx, ny) => {
        live.x = nx;
        live.y = ny;
      },
    };
  }

  private place(l: Live, x: number, y: number) {
    l.fx.options.x = Math.round(x);
    l.fx.options.y = Math.round(y);
    l.frame.ox = Math.round(x) - l.ox0;
    l.frame.oy = Math.round(y) - l.oy0;
  }

  private draw(l: Live, dt: number) {
    if (dt > 0) l.fx.update(dt);
    clearFrame(l.frame);
    l.fx.draw(l.frame);
    composite(l.frame, l.buf, null, 1);
    l.src.update();
    l.sprite.position.set(l.frame.ox, l.frame.oy);
  }

  /** 每帧调一次（dt 秒；命中停顿时传 0 就会定住）。 */
  update(dt: number) {
    for (let i = this.lives.length - 1; i >= 0; i--) {
      const l = this.lives[i];
      l.acc += dt;
      // 限了重画次数的（整屏的效果）：攒够一格才重画，位置也只在重画时挪（不重画就挪的话，画面会跟着镜头抖一下再跳回来）
      const due = dt > 0 && (!l.every || l.acc >= l.every - 1e-6);
      if (l.follow) {
        const pos = l.follow();
        if (!pos) l.fx.stop();
        else if (due || !l.every) {
          this.place(l, pos.x, pos.y);
          if (pos.z !== undefined) l.sprite.zIndex = pos.z;
        }
      }
      if (due) {
        this.draw(l, l.acc);
        l.acc = 0;
      }
      if (l.fx.done()) {
        this.drop(l);
        this.lives.splice(i, 1);
      }
    }
    for (let i = this.baked.length - 1; i >= 0; i--) {
      const l = this.baked[i];
      if (l.follow) {
        const pos = l.follow();
        if (pos) {
          l.x = pos.x;
          l.y = pos.y;
          if (pos.z !== undefined) l.sprite.zIndex = pos.z;
          if (pos.flip !== undefined) l.sprite.scale.x = pos.flip ? -1 : 1;
        } else if (l.stopping < 0) l.stopping = l.t;
      }
      const b = l.b;
      if (!b) {
        // 还在画：等着；这时候被叫停就直接收掉
        if (l.stopping >= 0) this.dropBaked(l, i);
        continue;
      }
      const n = b.textures.length;
      let k = Math.floor(l.t * b.fps + 1e-6);
      const fading = l.stopping >= 0 ? Math.max(0, 1 - (l.t - l.stopping) / 0.3) : 1;
      if (b.loop) k %= n;
      if ((!b.loop && k >= n) || fading <= 0) {
        this.dropBaked(l, i);
        continue;
      }
      const tex = b.textures[k];
      l.sprite.visible = !!tex;
      if (tex && l.sprite.texture !== tex) l.sprite.texture = tex;
      l.sprite.alpha = fading * l.alpha * (l.fadeIn > 0 ? Math.min(1, (l.t + 1 / 60) / l.fadeIn) : 1);
      l.sprite.position.set(Math.round(l.x), Math.round(l.y));
      l.t += dt; // 先画这一帧再走时间：第 0 帧也会露面
    }
  }

  private dropBaked(l: BakedLive, i: number) {
    l.sprite.destroy(); // 只销毁精灵；贴图是图集里的，留着给下一次用
    l.handle.done = true;
    this.baked.splice(i, 1);
  }

  private drop(l: Live) {
    const tex = l.sprite.texture; // 先拿到纹理：精灵销毁后 texture 会被置空
    l.sprite.destroy();
    tex.destroy(true);
    l.handle.done = true;
  }

  /** 正在播的个数。 */
  get count() {
    return this.lives.length + this.baked.length;
  }

  /** 全部清掉（换波、重开一局时）。预先画好的图集留着，下次直接用。 */
  clear() {
    for (const l of this.lives) this.drop(l);
    this.lives = [];
    for (const l of this.baked) {
      l.sprite.destroy();
      l.handle.done = true;
    }
    this.baked = [];
  }

  destroy() {
    this.clear();
    if (!this.flat) this.view.destroy();
  }
}

/** 预先画好的图集：有哪些 key、一共占多少显存（字节）。 */
export function bakedStats() {
  let bytes = 0;
  for (const b of baked.values()) bytes += b.bytes;
  return { keys: [...baked.keys()], bytes };
}

/**
 * 清掉预先画好的图集（一般不用；内存紧张、或者要换一套配色时）。
 * 调之前先把各个图层 clear() 掉：还在播的精灵拿着这些贴图。
 */
export function clearBaked() {
  for (const b of baked.values()) {
    for (const t of b.textures) t?.destroy(false);
    for (const s of b.sources) s.destroy();
  }
  baked.clear();
  baking.clear();
}
