// 标题页：进游戏先看到它。背景是云海之上的封神榜裂缝（画法在 src/art/title.ts），书法体大字「封神幸存者」+ 朱印「回响」，
// 七个墨痕按钮：回响（开始）、联机、修为、图鉴、成就、设置、致谢——同宽、沿画面的中轴排成一列（手机横屏排成四个、三个两行）。
// 回响之后进选角（select.ts），选好了把整层压暗、交给游戏。
// 右上角另有一颗「全屏」（2026-11-12 用户：「加一个按钮可以开启全屏，隐藏浏览器的地址栏这些」）；
// 左上角一行小字和一道金线是后台预载的进度（preload.ts），全部到了就淡掉。
//
// 启动流程（main.ts）：const fe = await runFrontEnd(); await startFeelPrototype(...); fe.done();
//   runFrontEnd 一调用就同步挂上这一层；玩家选好角色时返回（此时整层已经压暗、背景动画停了），游戏在这层后面建好画布，
//   fe.done() 再把这层淡出、移除。
// 开场动画（背景亮起、大字「写」出来、盖印、按钮依次浮出，约 3 秒）只在打开页面后的第一次放；
// 从局里回到标题时直接是最后的样子，只做半秒淡入。
//
// 背景是像素画：一个画面像素 = 整数个物理像素（像素画才清晰），画面铺满整个窗口——16:9 的那块画面矩形里竖着至少
// 270 个画面像素（和战斗画面差不多粗细），更宽、更高的窗口多出来的只是天和云海，不留黑边。
// 背景动画限 30 帧（动得都很慢，用不着 60 帧，也省电）；标签页切到后台时浏览器自己会停。
import { createTitleScene, makeSeal, titleLayout, type Painter, type TitleScene } from '../art/title.ts';
import type { Bitmap } from '../art/ground.ts';
import type { HeroId } from '../sim/types.ts';
import { CHAPTER_NAME } from '../sim/catalog.ts';
import { FONT_TITLE, loadFonts } from './fonts.ts';
import { loadProfile, formatTime, riftDue } from './profile.ts';
import { C, bitmapUrl, inkButton, inkWidth, injectCss, isTall, mountLayer, navKeys, pushKeys, snapPx, toast, uiSfx, unlockOnGesture, wait, type Layer, type UiFit } from './front-ui.ts';
import { bindSfx, openSettings } from './settings.ts';
import { openCredits } from './credits.ts';
import { autoFullscreen, isFullscreen, onFullscreenChange, setFullscreen, showFullscreenToggle, showHomeScreenHint } from './fullscreen.ts';
import { allReady, ensure, isReady, onProgress, progress, whenReady } from './preload.ts';
import type { NetSession } from '../net/session.ts';
import { openLobby } from './lobby.ts';

// ---------- 把场景画到 Canvas2D ----------

class CanvasPainter implements Painter {
  private cache = new WeakMap<Bitmap, HTMLCanvasElement>();
  private ctx: CanvasRenderingContext2D;
  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }
  private src(b: Bitmap) {
    let c = this.cache.get(b);
    if (!c) {
      c = document.createElement('canvas');
      c.width = b.w;
      c.height = b.h;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.w, b.h), 0, 0);
      this.cache.set(b, c);
    }
    return c;
  }
  image(b: Bitmap, x: number, y: number, alpha = 1, add = false, src?: { x: number; y: number; w: number; h: number }) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
    if (src) ctx.drawImage(this.src(b), src.x, src.y, src.w, src.h, x, y, src.w, src.h);
    else ctx.drawImage(this.src(b), x, y);
  }
  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1, add = false) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
}

export interface BackdropGrid {
  /** 一个画面像素是几个物理像素（整数）、几个 CSS 像素。 */
  k: number;
  u: number;
  /** 这张画有多少画面像素（铺满窗口，最后一列 / 一行可能露不全）。 */
  aw: number;
  ah: number;
  /** 画布左上角相对窗口的位置（CSS 像素，≤ 0：多出来的不到一个画面像素两边各分一半）。 */
  ox: number;
  oy: number;
}

/**
 * 背景画的像素格。k 取「16:9 的画面矩形里竖着至少有 270 个画面像素」的最大整数：1080p 是 4（480×270），
 * 720p 是 2（640×360），手机 844×390@3 是 4（633×293）。画面铺满整个窗口。
 */
export function backdropGrid(f: UiFit): BackdropGrid {
  const W = Math.round(f.w * f.dpr);
  const H = Math.round(f.h * f.dpr);
  const frameH = Math.min(H, (W * 9) / 16);
  const k = Math.max(1, Math.floor(frameH / 270 + 1e-6));
  const aw = Math.ceil(W / k);
  const ah = Math.ceil(H / k);
  return { k, u: k / f.dpr, aw, ah, ox: -Math.floor((aw * k - W) / 2) / f.dpr, oy: -Math.floor((ah * k - H) / 2) / f.dpr };
}

/** 标题页的背景：一张铺满窗口的像素画布，场景随窗口大小重建。 */
export class TitleBackdrop {
  readonly canvas = document.createElement('canvas');
  scene!: TitleScene;
  private ctx = this.canvas.getContext('2d')!;
  private painter = new CanvasPainter(this.ctx);
  private raf = 0;
  private last = 0;
  private acc = 0;
  private size = '';
  running = false;
  private showScroll = true;

  constructor(f: UiFit) {
    this.canvas.className = 'bg px';
    this.resize(f);
  }

  private pending = 0;
  /** 窗口变了：重建场景。拖动窗口时会连着来很多次，等停下 160 毫秒再建（第一次立即建）。 */
  resize(f: UiFit) {
    const g = backdropGrid(f);
    const key = `${g.aw}x${g.ah}x${g.k}/${f.dpr}`;
    if (key === this.size) return;
    clearTimeout(this.pending);
    if (this.size) {
      this.pending = window.setTimeout(() => this.rebuild(g, key), 160);
      return;
    }
    this.rebuild(g, key);
  }

  private rebuild(g: BackdropGrid, key: string) {
    this.size = key;
    this.canvas.width = g.aw;
    this.canvas.height = g.ah;
    Object.assign(this.canvas.style, { width: `${g.aw * g.u}px`, height: `${g.ah * g.u}px`, left: `${g.ox}px`, top: `${g.oy}px` });
    this.scene = createTitleScene(g.aw, g.ah);
    this.scene.setShowScroll(this.showScroll);
    if (!this.showScroll) for (let i = 0; i < 30; i++) this.scene.update(1 / 30); // 换了尺寸重建时直接是隐去的样子
    this.painter = new CanvasPainter(this.ctx);
    this.draw();
  }

  private draw() {
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.scene.draw(this.painter);
  }

  /** 榜与光束显不显（选角时隐去）。 */
  setShowScroll(v: boolean) {
    this.showScroll = v;
    this.scene.setShowScroll(v);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      if (this.acc < 1 / 30 - 0.002) return;
      this.scene.update(this.acc);
      this.acc = 0;
      this.draw();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.pending);
  }
}

// ---------- 样式 ----------

const CSS = `
#fs-front .bg { position: absolute; }
#fs-front .bg.intro { animation: fs-bgin 1.6s ease-out both; }
@keyframes fs-bgin { from { opacity: 0; } }
#fs-front .title { position: absolute; inset: 0; transition: opacity .3s; }
/* 开着设置 / 致谢：大字、菜单、战绩都隐去，卷轴后面只留云海和榜（不然卷轴两边会露出半个字、半个按钮） */
#fs-front .title.under { opacity: 0; pointer-events: none; }
#fs-front .logo { position: absolute; left: 0; right: 0; display: flex; justify-content: center; align-items: flex-end; pointer-events: none; }
#fs-front .logo h1 { position: relative; z-index: 0; margin: 0; font-family: ${FONT_TITLE}; font-weight: normal; font-size: var(--ts); line-height: 1.15; letter-spacing: .06em; padding-left: .06em; white-space: nowrap; color: ${C.wu}; }
/* 金字：渐变只铺在字形里（放在里层的 span 上，才能压在描边上面） */
#fs-front .logo h1 .fill { display: inline-block; background: linear-gradient(180deg, #fff3d6 10%, ${C.xiang} 38%, ${C.teng} 68%, ${C.hupo} 95%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
/* 描边与投影：同一行字垫在后面，一层粗描边（乌）、一层往下错开的投影（玄），不用任何发光 */
#fs-front .logo h1::before, #fs-front .logo h1::after { content: attr(data-text); position: absolute; left: .06em; top: 0; z-index: -1; color: ${C.wu}; -webkit-text-fill-color: ${C.wu}; -webkit-text-stroke: calc(var(--ts) * .075) ${C.wu}; }
#fs-front .logo h1::after { z-index: -2; color: ${C.xuan}; -webkit-text-fill-color: ${C.xuan}; -webkit-text-stroke: calc(var(--ts) * .075) ${C.xuan}; transform: translateY(calc(var(--ts) * .055)); opacity: .5; }
#fs-front .logo .seal { position: relative; flex: none; width: var(--sw); height: var(--shh); margin-left: calc(var(--ts) * .14); margin-bottom: calc(var(--ts) * -.02); background: var(--seal) 0 0 / 100% 100% no-repeat; image-rendering: pixelated;
  display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: ${FONT_TITLE}; font-size: var(--sf); line-height: 1.02; color: ${C.yuebai}; }
/* 菜单：同宽的按钮沿中轴排成一列，间距一样 */
#fs-front .menu { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; }
/* 一列放不下（手机横屏：大字和最下面那行战绩之间放不下七个按钮）：排成两行，上四下三，同宽、间距一样，下一行居中（宽度由 layout 定成四个按钮那么宽） */
#fs-front .menu.grid { flex-direction: row; flex-wrap: wrap; justify-content: center; margin: 0 auto; }
/* 右上角的「全屏」：和菜单同样的墨痕按钮；iPhone 上点开是一张小纸条，写怎么从主屏幕全屏 */
#fs-front .fsb { position: absolute; }
#fs-front .fsnote { position: absolute; width: max-content; max-width: min(17em, calc(100% - 2em)); padding: .5em 1em .55em; color: ${C.wu}; background: ${C.yuebai}; box-shadow: inset 0 0 0 var(--p) ${C.gao}, 0 var(--p) 0 0 ${C.cang}; line-height: 1.6; letter-spacing: .04em; text-wrap: balance; animation: fs-rise .35s ease-out both; }
/* 左上角：后台预载的进度（一行小字、一道从左往右展开的金线，两头淡出），全部到了就淡掉；开场动画放完才露面，有缓存时根本不出来 */
#fs-front .pre { position: absolute; display: flex; flex-direction: column; gap: .3em; font-size: .78em; letter-spacing: .14em; color: ${C.yuebai}; text-shadow: 0 var(--p) 0 rgba(26,21,32,.55); pointer-events: none; opacity: 0; animation: fs-pre-in .8s 3s ease-out forwards; transition: opacity .9s; }
#fs-front .pre i { position: relative; display: block; width: 7.5em; height: 2px; background: linear-gradient(90deg, rgba(242,232,213,.22), rgba(242,232,213,.22) 70%, rgba(242,232,213,0)); }
#fs-front .pre i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, ${C.teng}, ${C.xiang} 85%, rgba(247,220,122,0)); transform-origin: 0 50%; transform: scaleX(var(--pp, 0)); transition: transform .5s ease-out; }
#fs-front .pre.done { animation: none; opacity: 0; }
@keyframes fs-pre-in { to { opacity: .8; } }
/* 点「回响」时选角页还没下完：墨痕的下沿里一道金线随进度从中间展开（压在墨上才看得清），字轻轻地呼吸 */
#fs-front .ink .ld { position: absolute; left: 18%; right: 18%; bottom: calc((var(--tap) - var(--bh)) / 2 + var(--p) * 2); height: 2px; background: linear-gradient(90deg, rgba(247,220,122,0), ${C.xiang} 15%, ${C.xiang} 85%, rgba(247,220,122,0)); transform: scaleX(var(--lp, 0)); transition: transform .3s ease-out; pointer-events: none; }
#fs-front .ink.wait .lb { animation: fs-breath 1.3s ease-in-out infinite; }
@keyframes fs-breath { 50% { opacity: .5; } }
/* 竖屏（.tall）窄：战绩一行放不下就按「最远…」「最快通关…」「最高连斩…」几块折成几行，不伸出窗口 */
#fs-front .tall .foot { flex-wrap: wrap; row-gap: .1em; padding: 0 .8em; }
#fs-front .foot { position: absolute; left: 0; right: 0; bottom: calc(.45em + var(--sab)); display: flex; justify-content: center; gap: 1.6em; white-space: nowrap; color: ${C.xuan}; letter-spacing: .04em; text-shadow: 0 var(--p) 0 rgba(242,232,213,.7); pointer-events: none; }

/* 开场：背景先亮，大字从左往右「写」出来，朱印盖上，按钮依次浮出；随便按一下就跳到最后 */
@property --fs-p { syntax: '<percentage>'; inherits: false; initial-value: 100%; }
#fs-front .title.intro h1 { -webkit-mask-image: linear-gradient(90deg, #000 var(--fs-p), transparent calc(var(--fs-p) + 14%)); mask-image: linear-gradient(90deg, #000 var(--fs-p), transparent calc(var(--fs-p) + 14%)); animation: fs-write 1.5s .5s cubic-bezier(.4,.1,.3,1) both; }
@keyframes fs-write { from { --fs-p: -14%; opacity: .2; } 30% { opacity: 1; } to { --fs-p: 100%; } }
#fs-front .title.intro .seal { animation: fs-stamp .3s 1.85s cubic-bezier(.3,1.4,.5,1) both; }
@keyframes fs-stamp { from { opacity: 0; transform: scale(1.7) rotate(-6deg); } }
#fs-front .title.intro .menu > *, #fs-front .title.intro .foot { animation: fs-rise .7s ease-out both; }
#fs-front .title.intro .menu > :nth-child(1) { animation-delay: 2.15s; }
#fs-front .title.intro .menu > :nth-child(2) { animation-delay: 2.27s; }
#fs-front .title.intro .menu > :nth-child(3) { animation-delay: 2.39s; }
#fs-front .title.intro .menu > :nth-child(4) { animation-delay: 2.51s; }
#fs-front .title.intro .menu > :nth-child(5) { animation-delay: 2.63s; }
#fs-front .title.intro .menu > :nth-child(6) { animation-delay: 2.75s; }
#fs-front .title.intro .menu > :nth-child(7) { animation-delay: 2.87s; }
#fs-front .title.intro .fsb { animation: fs-rise .7s 2.9s ease-out both; }
#fs-front .title.intro .foot { animation-delay: 2.97s; }
@keyframes fs-rise { from { opacity: 0; transform: translateY(.25em); } }
#fs-front .title.skip *, #fs-front .title.skip { animation-delay: 0s !important; animation-duration: .01s !important; }
#fs-front .title.leave { animation: fs-out .45s ease-in forwards; pointer-events: none; }
@keyframes fs-out { to { opacity: 0; } }
#fs-front .title.back { animation: fs-in .5s ease-out both; }
@keyframes fs-in { from { opacity: 0; } }
#fs-front .curtain { position: absolute; inset: 0; background: ${C.xuan}; opacity: 0; pointer-events: none; transition: opacity .7s ease-in; }
#fs-front .curtain.on { opacity: 1; pointer-events: auto; }
@media (prefers-reduced-motion: reduce) {
  #fs-front .title.intro h1, #fs-front .title.intro .seal, #fs-front .title.intro .menu > *, #fs-front .title.intro .foot, #fs-front .title.intro .fsb, #fs-front .bg.intro { animation-duration: .01s; animation-delay: 0s; }
}
`;

export interface FrontEnd {
  hero: HeroId;
  /** 从「联机」大厅开的局：联机的这一局（交给游戏）。单人没有。 */
  net?: NetSession;
  /** 单人选的劫数（选劫页，jie-pick.ts）；联机的在 net 里。 */
  jie?: number;
  /** 游戏建好了：把标题这一层淡出、移除。 */
  done(): Promise<void>;
}

/** 开场动画放过了没有（打开页面后只放一次；回到标题时不再放）。 */
let introPlayed = false;

const sealCache = new Map<string, string>();
const sealUrl = (w: number, h: number) => {
  const key = `${w}x${h}`;
  let u = sealCache.get(key);
  if (!u) sealCache.set(key, (u = bitmapUrl(makeSeal(w, h, 11))));
  return u;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 标题页 → 选角（或「联机」大厅）。一调用就同步挂上标题页；玩家选好角色（或联机开局）时返回。room：网址带着 ?room=，直接进那个房。 */
export async function runFrontEnd(opts: { room?: string; online?: boolean } = {}): Promise<FrontEnd> {
  injectCss('fs-title', CSS);
  const sfx = uiSfx();
  bindSfx(sfx);
  unlockOnGesture(sfx);
  sfx.resumeMusic(); // 上一局是在暂停面板里回到标题的：配乐别还停着
  sfx.music('shop'); // 标题页的音乐（解锁音频之前先记下，解锁后才放）
  const intro = !introPlayed && !opts.room && !opts.online;
  introPlayed = true;
  const layer = mountLayer('fs-front', 8, true);
  const back = new TitleBackdrop(layer.fit);
  if (intro) back.canvas.classList.add('intro');
  layer.ui.appendChild(back.canvas);
  back.start();
  const curtain = document.createElement('div');
  curtain.className = 'curtain';

  const title = document.createElement('div');
  title.className = intro ? 'title intro' : 'title back';
  title.innerHTML = `<div class="logo"><h1 data-text="封神幸存者"><span class="fill">封神幸存者</span></h1><div class="seal"><span>回</span><span>响</span></div></div><div class="menu"></div><div class="foot"></div>`;
  layer.ui.append(title, curtain);
  const logo = title.querySelector('.logo') as HTMLElement;
  const menu = title.querySelector('.menu') as HTMLElement;
  const foot = title.querySelector('.foot') as HTMLElement;

  // 七个按钮同宽（都是两个字；开始那一颗原来叫「入回响」，用户 11-12 改成「回响」），字都在按钮正中。「修为」：局外成长（xiuwei.ts）；
  // 「图鉴」：见过的角色、法宝、道具、功法、敌人、首领（codex.ts）；「成就」：达成的与未达成的成就（2026-11-12 从图鉴里挪出来，codex.ts 的 openAchievements）
  const w = inkWidth('回响', '联机', '修为', '图鉴', '成就', '设置', '致谢');
  const start = inkButton('回响', { primary: true, w });
  const online = inkButton('联机', { w });
  const xiuwei = inkButton('修为', { w });
  const codex = inkButton('图鉴', { w });
  const achieve = inkButton('成就', { w });
  const settings = inkButton('设置', { w });
  const credits = inkButton('致谢', { w });
  const items = [start, online, xiuwei, codex, achieve, settings, credits];
  menu.append(...items);
  let menuGrid = false; // 排成两行了（手机横屏）

  // 全屏（fullscreen.ts）：支持网页全屏的（电脑、安卓、iPad）点了进 / 出全屏，字跟着换；iPhone 的 Safari 不支持，点开是一张纸条写怎么办；
  // 从主屏幕打开的本来就没有浏览器的栏，不出这颗
  const canFs = showFullscreenToggle();
  const fsb = canFs || showHomeScreenHint() ? inkButton(canFs && isFullscreen() ? '还原' : '全屏', { w: inkWidth('全屏') }) : null;
  let fsNote: HTMLElement | null = null;
  let offFs = () => {};
  if (fsb) {
    fsb.classList.add('fsb');
    fsb.setAttribute('aria-label', canFs ? '全屏' : '怎样全屏');
    title.appendChild(fsb);
    if (canFs) offFs = onFullscreenChange((on) => (fsb.querySelector('.lb')!.textContent = on ? '还原' : '全屏'));
  }

  // 后台预载的进度（左上角）：已经全到了就不出
  const pre = document.createElement('div');
  pre.className = 'pre';
  pre.setAttribute('aria-hidden', 'true');
  pre.innerHTML = '<span>余卷载入中</span><i></i>';
  let offPre = () => {};
  if (!allReady()) {
    title.appendChild(pre);
    const upd = () => {
      pre.style.setProperty('--pp', progress().toFixed(3));
      if (!allReady()) return;
      offPre();
      setTimeout(() => {
        pre.classList.add('done');
        setTimeout(() => pre.remove(), 1000);
      }, 500); // 线走满了再淡
    };
    offPre = onProgress(upd);
    upd();
  }

  const layout = (f: UiFit) => {
    back.resize(f);
    const g = backdropGrid(f);
    const L = titleLayout(g.aw, g.ah);
    const y = (art: number) => g.oy + art * g.u; // 画面像素 → 窗口里的 CSS 像素
    const horizon = y(L.horizon);
    const scrollBottom = y(L.scroll.y + L.scroll.h + 8);
    // 大字：五个字加朱印约 6.4 个字宽，窄窗口按宽度收
    const ts = Math.round(Math.min(f.h * 0.15, f.w * 0.11));
    const sw = Math.max(6, Math.round((ts * 0.42) / f.p));
    const sh = Math.max(12, Math.round((ts * 0.84) / f.p));
    title.style.setProperty('--ts', `${ts}px`);
    title.style.setProperty('--sw', `${sw * f.p}px`);
    title.style.setProperty('--shh', `${sh * f.p}px`);
    title.style.setProperty('--sf', `${Math.round(ts * 0.36)}px`);
    title.style.setProperty('--seal', `url("${sealUrl(sw, sh)}")`);
    title.dataset.achTop = String(Math.round(scrollBottom)); // 成就弹窗（achieve-toast.ts）摆在天上那幅榜的下面，不压着它
    // 右上角的「全屏」、它的纸条，左上角的预载进度：让开刘海、圆角
    const edge = f.p * 3;
    if (fsb) {
      fsb.style.right = `${snapPx(f.safe.right + edge, f)}px`;
      fsb.style.top = `${snapPx(f.safe.top + edge, f)}px`;
    }
    if (fsNote) placeNote(f);
    pre.style.left = `${snapPx(f.safe.left + f.base * 0.9, f)}px`;
    pre.style.top = `${snapPx(f.safe.top + f.base * 0.7, f)}px`;
    const logoTop = Math.round(scrollBottom + (horizon - scrollBottom) * 0.5 - ts * 0.72);
    logo.style.top = `${logoTop}px`;
    // 菜单放在地平线下面的云海上；矮窗口里往上让一让，给最下面那行战绩留出地方。
    // 一列放不下（往上让到大字下面了）就排成两行、每行三个（菜单 .grid），方向键左右上下都能走
    const gap = f.p * 3;
    const footTop = f.h - f.safe.bottom - f.base * (isTall(f) ? 4.6 : 2.2); // 竖屏的战绩可能折成两三行（见 .tall .foot）
    const logoBottom = logoTop + ts * 1.25;
    menuGrid = logoBottom + gap * 2 + f.tap * items.length + gap * (items.length - 1) > footTop;
    const perRow = 4;
    const rows = menuGrid ? Math.ceil(items.length / perRow) : items.length;
    const menuH = f.tap * rows + gap * (rows - 1);
    menu.classList.toggle('grid', menuGrid);
    menu.style.gap = menuGrid ? `${gap * 2}px ${gap * 4}px` : `${gap}px`;
    // 两行时整块定成四个按钮那么宽：上一行四个、下一行三个居中
    menu.style.width = menuGrid ? `${start.offsetWidth * perRow + gap * 4 * (perRow - 1)}px` : '';
    menu.style.top = `${snapPx(Math.max(logoBottom + gap, Math.min(horizon + f.h * 0.06, footTop - menuH)), f)}px`;
  };
  layer.onFit = layout;
  layout(layer.fit);

  // 战绩：有了才显示一行
  const p = loadProfile();
  if (p.best.chapter) {
    const bits = [`最远 ${CHAPTER_NAME[p.best.chapter] ?? `第 ${p.best.chapter} 章`} · 第 ${p.best.wave} 波`];
    if (p.best.clearTime !== null) bits.push(`最快通关 ${formatTime(p.best.clearTime)}`);
    if (p.best.combo) bits.push(`最高连斩 ${p.best.combo}`);
    foot.innerHTML = bits.map((b) => `<span>${esc(b)}</span>`).join('');
  }
  // 隐藏角色孙悟空：通关过一次之后，天上多一道很细的金色裂缝，点它放一段过场、解锁（wukong-rift.ts；没通关过的不下这一块）
  if (riftDue(p))
    void import('./wukong-rift.ts')
      .then((m) => m.mountRift({ layer, title, sfx, busy: () => busy, setBusy: (v) => void (busy = v), refocus: () => start.focus({ preventScroll: true }) }))
      .catch((e) => console.error(e));
  // 成就（achievements.ts）：按存档里的进度对一遍——老存档第一次打开时补记、不弹窗；之后新达成的在右上角弹出。表和判定用到才下，不进首屏；
  // 它连带整套模拟（约 110 KB），第一次打开页面时等选角那一组预载完、开场动画放完再下（preload.ts），别和首屏、选角抢带宽
  void (intro ? Promise.all([whenReady('select'), wait(3400)]) : Promise.resolve())
    .then(() => import('./achievements.ts'))
    .then((m) => m.reconcile())
    .catch((e) => console.error(e));

  // 淡入放完就把 back 去掉（留着的话，它填充着 opacity，开设置时的隐去就没有过渡了）
  title.addEventListener('animationend', (e) => e.animationName === 'fs-in' && title.classList.remove('back'));

  // 开场动画：随便按一下就跳到最后
  let introDone = !intro;
  const finishIntro = () => {
    if (introDone) return;
    introDone = true;
    title.classList.add('skip');
    setTimeout(() => title.classList.remove('intro', 'skip'), 60);
  };
  const introTimer = intro ? setTimeout(finishIntro, 3300) : 0;
  title.addEventListener('pointerdown', () => finishIntro(), { capture: true });

  let busy = false;
  let popKeys = () => {};
  const keys = (e: KeyboardEvent) => {
    if (!introDone) {
      finishIntro();
      return 'consume' as const;
    }
    if (busy) return 'consume' as const;
    if (navKeys(e, items, menuGrid ? 'both' : 'v')) return 'consume' as const;
  };
  popKeys = pushKeys(keys);
  setTimeout(() => start.focus({ preventScroll: true }), 50);

  const click = () => sfx.play('ui.click');

  /** iPhone 上「全屏」的纸条：摆在按钮下面、右边对齐；点哪儿都收起。 */
  const placeNote = (f: UiFit) => {
    if (!fsNote || !fsb) return;
    fsNote.style.right = `${snapPx(f.safe.right + f.p * 3, f)}px`;
    fsNote.style.top = `${snapPx(f.safe.top + f.p * 3 + f.tap + f.p * 2, f)}px`;
  };
  const closeNote = () => {
    if (!fsNote) return;
    const n = fsNote;
    fsNote = null;
    n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).finished.then(() => n.remove());
  };
  fsb?.addEventListener('click', () => {
    if (busy) return;
    finishIntro();
    click();
    if (canFs) {
      void setFullscreen(!isFullscreen());
      return;
    }
    if (fsNote) return closeNote();
    fsNote = document.createElement('div');
    fsNote.className = 'fsnote';
    fsNote.textContent = 'Safari 不能让网页全屏。点分享 → 添加到主屏幕，从主屏幕打开即是全屏';
    title.appendChild(fsNote);
    placeNote(layer.fit);
    setTimeout(closeNote, 9000);
    setTimeout(() => addEventListener('pointerdown', closeNote, { once: true, capture: true }), 0);
  });

  return new Promise<FrontEnd>((resolve) => {
    const leaveTitle = async () => {
      title.classList.remove('back');
      title.classList.add('leave');
      await wait(450);
      title.style.display = 'none';
    };
    const backToTitle = () => {
      title.style.display = '';
      title.classList.remove('leave');
      void title.offsetWidth;
      title.classList.add('back');
      start.focus({ preventScroll: true });
    };
    start.addEventListener('click', async () => {
      if (busy) return;
      autoFullscreen(); // 手机上第一次点：顺手全屏（fullscreen.ts；要在点击里同步调）
      finishIntro();
      busy = true;
      click();
      // 选角、选劫页连带角色表，不进首包（docs/deploy.md「包体积」）：标题页一出来就在后台下（preload.ts），一般早到了。
      // 还没到：标题先不走，「回响」笔下一道金线随真实进度展开，到了再进（不是点了没反应）
      const need = ensure('select') as Promise<[typeof import('./select.ts'), typeof import('./jie-pick.ts')]>;
      if (!isReady('select')) {
        start.classList.add('wait');
        const ld = document.createElement('i');
        ld.className = 'ld';
        start.appendChild(ld);
        const upd = () => ld.style.setProperty('--lp', progress(['select']).toFixed(3));
        const off = onProgress(upd);
        upd();
        await need.catch(() => null);
        off();
        upd();
        await wait(160); // 让线走满
        ld.remove();
        start.classList.remove('wait');
      }
      // 完整的界面字体：一般也早到了；没到就不等（最多等一眨眼），选角页先用系统字，到了自己换成楷书（fonts.ts 的 swap）
      await Promise.race([loadFonts(), wait(120)]);
      back.setShowScroll(false);
      const leaving = leaveTitle();
      const mods = await need
        .then(([a, b]) => ({ showSelect: a.showSelect, showJiePick: b.showJiePick }))
        .catch((e) => {
          console.error(e);
          toast('选角页未能载入，请检查网络后刷新重试');
          return null;
        });
      // 标题淡出一小段就叠上选角页（选角页自己淡入），不等标题完全淡完
      if (mods) await wait(120);
      else await leaving;
      // 选角 → 选劫（jie-pick.ts）；选劫页按「返回」回到选角
      for (;;) {
        const hero = mods ? await mods.showSelect(layer, sfx) : null;
        if (!mods || !hero) {
          back.setShowScroll(true);
          backToTitle();
          busy = false;
          return;
        }
        const jie = await mods.showJiePick(layer, sfx);
        if (jie === null) continue;
        await handOff(hero, undefined, jie);
        return;
      }
    });
    /** 选好了（或联机开局了）：压暗、停掉背景，交给游戏。 */
    const handOff = async (hero: HeroId, net?: NetSession, jie?: number) => {
      clearTimeout(introTimer);
      offPre();
      offFs();
      curtain.classList.add('on');
      sfx.music(null);
      await wait(720);
      back.stop();
      popKeys();
      resolve({
        hero,
        net,
        jie,
        async done() {
          layer.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, easing: 'ease-out', fill: 'forwards' });
          await wait(820);
          layer.dispose();
        },
      });
    };
    // 联机：大厅（lobby.ts）里建房 / 进房，房主开局时交给游戏
    const openOnline = async (room?: string) => {
      if (busy) return;
      finishIntro();
      busy = true;
      click();
      title.classList.add('under');
      // 大厅是首屏必需界面：标题已显示时，不再额外下载脚本才能进入。
      void loadFonts();
      sfx.music('calm');
      const net = await openLobby({ layer, sfx, room });
      if (!net) {
        sfx.music('shop');
        title.classList.remove('under');
        busy = false;
        online.focus({ preventScroll: true });
        return;
      }
      await handOff(net.slots.find((x) => x.id === net.link.me)?.hero ?? 'nezha', net);
    };
    online.addEventListener('click', () => {
      if (!busy) autoFullscreen(); // 同「回响」
      void openOnline();
    });
    if (opts.room || opts.online) setTimeout(() => void openOnline(opts.room), 0);
    xiuwei.addEventListener('click', async () => {
      if (busy) return;
      finishIntro();
      busy = true;
      click();
      title.classList.add('under');
      // 修为页（连带修为树的数据）点了才下，和选角一样（main.ts 在标题页出来之后也会在后台先下好）
      const xw = await Promise.all([import('./xiuwei.ts'), loadFonts()])
        .then(([m]) => m)
        .catch((e) => {
          console.error(e);
          toast('修为页未能载入，请检查网络后刷新重试');
          return null;
        });
      if (xw) {
        sfx.music('calm'); // 修为页：安静的古筝独奏，关上换回标题页的曲子
        await xw.openXiuwei({ layer, sfx });
        sfx.music('shop');
      }
      title.classList.remove('under');
      busy = false;
      xiuwei.focus({ preventScroll: true });
    });
    codex.addEventListener('click', async () => {
      if (busy) return;
      finishIntro();
      busy = true;
      click();
      title.classList.add('under');
      // 图鉴页（连带角色表、法宝和敌人的图、整套模拟的表）点了才下，和修为页一样（main.ts 在标题页出来之后也会在后台先下好）
      const cx = await Promise.all([import('./codex.ts'), loadFonts()])
        .then(([m]) => m)
        .catch((e) => {
          console.error(e);
          toast('图鉴未能载入，请检查网络后刷新重试');
          return null;
        });
      if (cx) await cx.openCodex({ layer, sfx });
      title.classList.remove('under');
      busy = false;
      codex.focus({ preventScroll: true });
    });
    achieve.addEventListener('click', async () => {
      if (busy) return;
      finishIntro();
      busy = true;
      click();
      title.classList.add('under');
      // 成就页和图鉴是同一包（codex.ts），点了才下（preload.ts 在后台也会先下好）
      const cx = await Promise.all([import('./codex.ts'), loadFonts()])
        .then(([m]) => m)
        .catch((e) => {
          console.error(e);
          toast('成就页未能载入，请检查网络后刷新重试');
          return null;
        });
      if (cx) await cx.openAchievements({ layer, sfx });
      title.classList.remove('under');
      busy = false;
      achieve.focus({ preventScroll: true });
    });
    settings.addEventListener('click', async () => {
      if (busy) return;
      finishIntro();
      busy = true;
      click();
      title.classList.add('under');
      await loadFonts(); // 完整的界面字体（标题页出来就在下，一般早到了；没到就等它，不然面板上的字先是空白）
      await openSettings({ layer, context: 'title', sfx });
      title.classList.remove('under');
      busy = false;
      settings.focus({ preventScroll: true });
    });
    credits.addEventListener('click', async () => {
      if (busy) return;
      finishIntro();
      busy = true;
      click();
      title.classList.add('under');
      await loadFonts();
      sfx.music('ending'); // 致谢页放结局的曲子（笛子），关上换回标题页的曲子
      await openCredits({ layer, sfx });
      sfx.music('shop');
      title.classList.remove('under');
      busy = false;
      credits.focus({ preventScroll: true });
    });
  });
}

export type { Layer };
