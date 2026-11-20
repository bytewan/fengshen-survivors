// 剧情过场播放器：按 story.ts 的数据表一镜一镜地播。每个镜头是一幅动起来的像素画（PixiJS，画法在 cutscene-shots.ts），
// 上面叠一层 DOM 的字（楷书一路：旁白、对白用 var(--font-text)，章节名大字用 var(--font-title)）。
//
//   const r = await playCutscene('ch1-intro', { sfx });   // 'done' 播完 / 'skipped' 跳过
//
// 怎么播：
//  - 画面和游戏一样是像素画、一个画面像素 = 整数个物理像素，铺满整个窗口：16:9 的那块里竖着至少 270 个画面像素
//    （1080p 是 480×270 放大 4 倍，720p 是 640×360 放大 2 倍，手机横屏 844×390@3 是 633×293 放大 4 倍）；
//    每个镜头的主体都在正中 480×270 的「安全框」里，更宽、更高的窗口多出来的只是天、云、墙、雾，不留黑边。
//  - 镜头之间交叉淡入淡出（进章节名那一下先压暗），画面里的镜头缓慢推移（分层视差，整像素移动）。
//  - 旁白竖排，从右往左一列一列「写」出来，每个字淡入；对白是下方一行字幕；章节名是书法大字，从左往右写出来、盖朱印。
//  - 点一下 / 空格 / 回车：字还没出完就一下子出完，出完了就进下一镜；右上角「跳过」（Esc 也行）。字出完停一会儿自己往下走。
//  - 播完或跳过：整层淡出，然后彻底清理——Pixi 应用（含 WebGL 上下文）、所有纹理、DOM、样式、按键 / 窗口监听都拆掉。
//
// 调用方要做的：播放期间别让游戏往下走（模拟别推进、别出怪），暂停面板关掉（pause.setEnabled(false)，不然切到后台会弹出来）；
// 播完再接着走。过场自己铺满整个窗口、接住所有指针和按键：按键压进外围界面的按键栈（front-ui.pushKeys），
// 播放期间所有按键都归过场，不会漏给游戏（空格放神通）或暂停面板（Esc）。
// 哪一章放哪一段：story.ts 的 CHAPTER_CUTSCENES（第一章：开场 'ch1-intro'，结尾 'ch1-end'）。
// 另有波间旁白 showWaveLine（本文件末尾）：每波打完在战场上淡入淡出一行字，台词是 story.ts 的 waveLine(wave)。
import { Application, RenderTexture, Sprite, Texture } from 'pixi.js';
import type { Sfx } from '../audio/sfx.ts';
import { FONT_TEXT, FONT_TITLE, loadFonts } from './fonts.ts';
import { pushKeys } from './front-ui.ts';
import { uiBaseFontPx, canvasRect } from './ui-scale.ts';
import { CUTSCENES, CUTSCENE_MUSIC, type CutBeat, type CutsceneId } from './story.ts';
import { SHOTS, ShotKit, SAFE_H, SAFE_W, type Shot } from './cutscene-shots.ts';
import type { HeroId } from '../sim/types.ts';
import { makeSeal } from '../art/title.ts';
import { heroCutLine } from './hero-views.ts';

export type { CutsceneId };

export interface CutsceneOptions {
  /** 音效（可选）：镜头里的几处音效（落地、写字……）。不给就没声音。 */
  sfx?: Sfx;
  /** 挂在哪里，默认 document.body。 */
  parent?: HTMLElement;
  /** 层级，默认 9（标题页是 8，转屏提示是 10）。 */
  zIndex?: number;
  /** 能不能跳过（默认能）。 */
  skippable?: boolean;
  /** 每进一镜调一次（第几镜、镜头名）。 */
  onBeat?: (i: number, shot: string) => void;
  /** 调试：在 window.__cut 上挂 seek / freeze（实验页截图用）。 */
  debug?: boolean;
  /** 玩家操控的角色：要画「玩家」的镜头（第三章结尾的门缝镜头）画他（ShotKit.hero）；不给 = 哪吒。前两章的过场讲的是哪吒的旧事，照旧画哪吒。 */
  hero?: HeroId;
}

export type CutsceneResult = 'done' | 'skipped';

// ---------- 版面：像素格 ----------

interface Fit {
  dpr: number;
  /** 一个画面像素是几个物理像素（整数）、几个 CSS 像素。 */
  k: number;
  u: number;
  /** 画布有多少画面像素（铺满窗口，最后一列 / 一行可能露不全）。 */
  aw: number;
  ah: number;
  /** 画布左上角（CSS 像素，≤ 0：多出来的不到一个画面像素两边各分一半）。 */
  ox: number;
  oy: number;
  /** 安全框（480×270）在画布里的左上角（画面像素）。 */
  fx: number;
  fy: number;
}

function fitNow(): Fit {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(innerWidth * dpr));
  const H = Math.max(1, Math.round(innerHeight * dpr));
  const frameH = Math.min(H, (W * 9) / 16);
  const k = Math.max(1, Math.floor(frameH / SAFE_H + 1e-6));
  const aw = Math.max(SAFE_W, Math.ceil(W / k));
  const ah = Math.max(SAFE_H, Math.ceil(H / k));
  return {
    dpr,
    k,
    u: k / dpr,
    aw,
    ah,
    ox: -Math.floor((aw * k - W) / 2) / dpr,
    oy: -Math.floor((ah * k - H) / 2) / dpr,
    fx: Math.floor((aw - SAFE_W) / 2),
    fy: Math.floor((ah - SAFE_H) / 2),
  };
}

// ---------- 样式 ----------

const INK = '26,21,32';
const CSS = `
#fs-cut { position: fixed; inset: 0; overflow: hidden; background: #1a1520; opacity: 0; transition: opacity .8s ease-out; cursor: pointer;
  touch-action: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
#fs-cut.on { opacity: 1; }
#fs-cut.out { opacity: 0; transition: opacity var(--out, .9s) ease-in; pointer-events: none; }
#fs-cut canvas { position: absolute; display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
#fs-cut .frame { position: absolute; pointer-events: none; font-family: ${FONT_TEXT}; font-weight: normal; font-synthesis: none; color: #f2e8d5; line-height: 1.2; }
#fs-cut .frame * { box-sizing: border-box; }
#fs-cut .ch { display: inline-block; opacity: 0; transition: opacity .7s ease-out, transform .7s ease-out; }
#fs-cut .ch.on { opacity: 1; transform: none !important; }
#fs-cut .gone { opacity: 0 !important; transition: opacity .45s ease-in !important; }

/* 旁白：竖排，从右往左；字与字之间留得松一些，列与列之间再宽一点；不画框，只给字压一圈很淡的墨影，铺在什么底上都看得清 */
#fs-cut .narr { position: absolute; writing-mode: vertical-rl; text-orientation: upright; font-size: 1.42em; line-height: 1; letter-spacing: .36em; white-space: nowrap;
  text-shadow: 0 0 .22em rgba(${INK},.78), 0 .05em 0 rgba(${INK},.92), 0 0 .6em rgba(${INK},.32); transition: opacity .45s; }
#fs-cut .narr p { margin: 0; padding: 0; }
#fs-cut .narr p + p { margin-block-start: .95em; }
#fs-cut .narr .ch { transform: translateY(-.18em); }

/* 对白：下方一行字幕；名字是书法体，压在一条两头渐隐的淡墨底上 */
#fs-cut .sub { position: absolute; left: 0; right: 0; bottom: 4.5%; display: flex; flex-direction: column; align-items: center; opacity: 0; transition: opacity .5s ease-out; }
#fs-cut .sub.on { opacity: 1; }
#fs-cut .sub.top { bottom: auto; top: 5%; }
#fs-cut .sub .band { position: relative; z-index: 0; display: flex; align-items: baseline; justify-content: center; padding: .62em 4.4em .7em; }
/* 底只铺在伪元素上（上下也渐隐）：渐隐的遮罩不碰字 */
#fs-cut .sub .band::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--band);
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 24%, #000 76%, transparent); mask-image: linear-gradient(180deg, transparent, #000 24%, #000 76%, transparent); }
#fs-cut .sub .who { font-family: ${FONT_TITLE}; font-size: 1.22em; line-height: 1.2; letter-spacing: .24em; margin-right: .75em; white-space: nowrap; text-shadow: 0 .06em 0 rgba(${INK},.9); }
#fs-cut .sub .line { font-size: 1.36em; line-height: 1.45; letter-spacing: .1em; padding-left: .1em; white-space: nowrap; text-shadow: 0 .06em 0 rgba(${INK},.95), 0 0 .2em rgba(${INK},.6); }
#fs-cut .sub .ch { transform: translateY(.14em); }
#fs-cut .sub .line br { display: none; }
/* 竖屏窄：一行放不下的那几句（别的角色在过场里说的那一句更长）原来从两边出画——名字挪到上面一行，话照写的地方分行、再长就折行；横屏不变（暂拟，待评审确认） */
@media (orientation: portrait) {
  #fs-cut .sub .band { flex-direction: column; align-items: center; box-sizing: border-box; width: max-content; max-width: 100vw; padding: .62em 1.2em .7em; }
  #fs-cut .sub .who { margin-right: 0; padding-left: .24em; }
  #fs-cut .sub .line { white-space: normal; text-align: center; text-wrap: balance; font-size: 1.25em; letter-spacing: .03em; padding-left: .03em; }
  #fs-cut .sub .line br { display: inline; }
  /* 竖屏上安全框只是中间一条，底下那一行字正好压在站在框底的主角身上：挪到框的下面（那里只有地面） */
  #fs-cut .sub:not(.top) { bottom: auto; top: 100%; }
}
#fs-cut .sub .line.aside { display: block; white-space: normal; max-width: min(30em, 70vw); text-align: center; text-wrap: balance; color: #e6dac6; }

/* 章节名：书法大字，金色只铺在字形里，乌色描边、玄色投影（同标题页的大字，不用任何发光）；从左往右「写」出来，再盖一方朱印 */
@property --cut-p { syntax: '<percentage>'; inherits: false; initial-value: 100%; }
#fs-cut .card { position: absolute; left: 0; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: opacity .6s; }
#fs-cut .card .small { font-family: ${FONT_TITLE}; font-size: 1.7em; line-height: 1.2; letter-spacing: .7em; padding-left: .7em; color: #c9bcae; white-space: nowrap; text-shadow: 0 .06em 0 rgba(${INK},.95);
  opacity: 0; transform: translateY(.3em); transition: opacity 1s ease-out, transform 1s ease-out; margin-bottom: .45em; }
#fs-cut .card.on .small { opacity: 1; transform: none; }
#fs-cut .card .row { display: flex; align-items: flex-end; justify-content: center; }
/* h1 的盒子四边多留一圈（描边、投影都在盒子里面），写字的遮罩才不会把描边切出一道直边 */
#fs-cut .card h1 { position: relative; z-index: 0; margin: -.14em -.26em -.26em -.14em; padding: .14em .26em .26em .26em; font-family: ${FONT_TITLE}; font-weight: normal; font-size: var(--ts); line-height: 1.15; letter-spacing: .12em; white-space: nowrap; color: #2e2433;
  -webkit-mask-image: linear-gradient(90deg, #000 var(--cut-p), transparent calc(var(--cut-p) + 16%)); mask-image: linear-gradient(90deg, #000 var(--cut-p), transparent calc(var(--cut-p) + 16%)); --cut-p: -16%; }
#fs-cut .card.on h1 { animation: cut-write var(--write, 1.6s) .35s cubic-bezier(.45,.1,.3,1) both; }
@keyframes cut-write { from { --cut-p: -16%; } to { --cut-p: 100%; } }
#fs-cut .card h1 .fill { display: inline-block; background: linear-gradient(180deg, #fff3d6 10%, #f7dc7a 38%, #e0a83a 68%, #b06a28 95%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
#fs-cut .card h1::before, #fs-cut .card h1::after { content: attr(data-text); position: absolute; left: .26em; top: .14em; z-index: -1; color: #2e2433; -webkit-text-fill-color: #2e2433; -webkit-text-stroke: .075em #2e2433; }
#fs-cut .card h1::after { z-index: -2; color: #1a1520; -webkit-text-fill-color: #1a1520; -webkit-text-stroke: .075em #1a1520; transform: translateY(.055em); opacity: .6; }
#fs-cut .card .seal { flex: none; width: var(--sw); height: var(--sh); margin-left: calc(var(--ts) * .16); margin-bottom: calc(var(--ts) * .08); background: var(--seal) 0 0 / 100% 100% no-repeat; image-rendering: pixelated;
  display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: ${FONT_TITLE}; font-size: calc(var(--ts) * .3); line-height: 1.02; color: #f2e8d5; opacity: 0; }
#fs-cut .card.on .seal { animation: cut-stamp .32s var(--stamp, 2.1s) cubic-bezier(.3,1.4,.5,1) both; }
@keyframes cut-stamp { from { opacity: 0; transform: scale(1.7) rotate(-6deg); } to { opacity: 1; transform: none; } }

/* 「点一下继续」：字出完后右下角一枚慢慢明灭的小三角（自己画，不靠字体） */
#fs-cut .more { position: absolute; right: 5%; bottom: 6%; width: .62em; height: .46em; background: #e0a83a; clip-path: polygon(0 0, 100% 0, 50% 100%); opacity: 0; transition: opacity .5s; }
#fs-cut .more.on { opacity: .85; animation: cut-blink 1.6s ease-in-out infinite; }
@keyframes cut-blink { 50% { opacity: .25; } }

/* 跳过：右上角一枚小签，两头渐隐的淡墨底；手机上够大好点（安全区让开刘海） */
#fs-cut .skip { position: absolute; top: max(.7em, var(--sat)); right: max(.9em, var(--sar)); display: flex; align-items: center; justify-content: center;
  min-height: max(2.3em, 34px); padding: 0 1.7em; font-family: ${FONT_TEXT}; font-size: var(--fs); letter-spacing: .2em; text-indent: .2em; white-space: nowrap; color: #e6dac6; cursor: pointer;
  background: var(--band-s); text-shadow: 0 .06em 0 rgba(${INK},.9); opacity: 0; transition: opacity .6s, color .2s; border: 0; margin: 0; font-weight: normal; }
#fs-cut .skip.on { opacity: .82; }
#fs-cut .skip:hover, #fs-cut .skip:focus-visible { color: #fff3d6; opacity: 1; outline: none; }
#fs-cut .skip::after { content: ''; width: .36em; height: .58em; margin-left: .45em; background: currentColor; clip-path: polygon(0 0, 100% 50%, 0 100%); opacity: .85; }
@media (pointer: coarse) { #fs-cut .skip { min-height: max(2.6em, 42px); padding: 0 2em; } }
`;

/** 章节名大字的尺寸：--ts（大字字号）按所在层的基准字号算成像素；印是大字的 0.42 × 0.84。窗口变了再算一次。 */
function sizeCard(el: HTMLElement) {
  const base = parseFloat(getComputedStyle(el).fontSize) || 16;
  const ts = Math.round(base * Number(el.dataset.ts ?? 4.6));
  el.style.setProperty('--ts', `${ts}px`);
  el.style.setProperty('--sw', `${Math.round(ts * 0.42)}px`);
  el.style.setProperty('--sh', `${Math.round(ts * 0.84)}px`);
}

/** 两头渐隐的一条淡墨底：中间实、两头按余弦淡出。 */
function band(a: number, edge: number) {
  const n = 6;
  const s: string[] = [];
  const at = (i: number) => (a * (0.5 - 0.5 * Math.cos((Math.PI * i) / n))).toFixed(3);
  for (let i = 0; i <= n; i++) s.push(`rgba(${INK},${at(i)}) ${((edge * i) / n).toFixed(1)}%`);
  for (let i = n; i >= 0; i--) s.push(`rgba(${INK},${at(i)}) ${(100 - (edge * i) / n).toFixed(1)}%`);
  return `linear-gradient(90deg, ${s.join(', ')})`;
}

// ---------- 字 ----------

/** 旁白按标点分成几列（标点本身不画：竖排的诗句不加标点，靠分列断句）。 */
export function narrColumns(text: string): string[] {
  return text
    .split(/[，。、；：！？\n]+/)
    .map((s) => s.replace(/[「」『』“”]/g, '').trim())
    .filter(Boolean);
}

/** 把一行字拆成一个个可以单独淡入的字（span.ch），返回这些 span。 */
function spell(el: HTMLElement, text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const c of [...text]) {
    const s = document.createElement('span');
    s.className = 'ch';
    s.textContent = c;
    el.appendChild(s);
    out.push(s);
  }
  return out;
}

interface TextView {
  el: HTMLElement;
  chars: HTMLElement[];
  /** 每秒出几个字。 */
  cps: number;
  /** 大字：不按字出，整块一起「写」（CSS 动画），需要这么久。 */
  whole?: number;
}

// ---------- 播放 ----------

/**
 * 旁白怎么排：'vertical' 竖排（从右往左一列列写出来，标点处分列、不画标点）；'subtitle' 和对白一样是画面下方的一行横排字幕。
 * 现在用竖排（项目 的选择，用户还没看过）；不喜欢就改成 'subtitle'，别的不用动。
 */
const NARR_STYLE: 'vertical' | 'subtitle' = 'vertical';

const FADE = 1.15; // 镜头之间交叉淡入淡出（秒）
const DIP = 0.85; // 压暗再亮起，每一半（秒）
const NARR_CPS = 7.5;
const SAY_CPS = 11;

interface Live {
  name: string;
  kit: ShotKit;
  shot: Shot;
  t: number;
  rt: RenderTexture;
  spr: Sprite;
}

let playing: Promise<CutsceneResult> | null = null;

/**
 * 播一段过场。返回的 Promise 在整层淡出、清理完之后 resolve：'done' 播完，'skipped' 中途跳过。
 * 同一时间只播一段（再调一次会等前一段结束后再播）。
 */
export function playCutscene(id: CutsceneId, opts: CutsceneOptions = {}): Promise<CutsceneResult> {
  const run = async () => run1(id, opts);
  playing = (playing ?? Promise.resolve('done' as CutsceneResult)).then(run, run);
  return playing;
}

async function run1(id: CutsceneId, opts: CutsceneOptions): Promise<CutsceneResult> {
  const beats = CUTSCENES[id];
  if (!beats?.length) return 'done';
  await loadFonts();
  const music = CUTSCENE_MUSIC[id];
  if (music) opts.sfx?.music(music); // 这一段过场换的曲子（story.ts）；放完之后放什么由调用方定
  const skippable = opts.skippable ?? true;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'fs-cut';
  root.style.zIndex = String(opts.zIndex ?? 9);
  root.style.setProperty('--band', band(0.62, 26));
  root.style.setProperty('--band-s', band(0.7, 30));
  const frame = document.createElement('div');
  frame.className = 'frame';
  const more = document.createElement('i');
  more.className = 'more';
  frame.appendChild(more);
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'skip';
  skip.textContent = '跳过';
  if (!skippable) skip.style.display = 'none';
  (opts.parent ?? document.body).appendChild(root);

  // ---- Pixi ----
  let fit = fitNow();
  const app = new Application();
  try {
    await app.init({ width: fit.aw, height: fit.ah, antialias: false, resolution: 1, roundPixels: true, background: '#1a1520', autoStart: false, preference: 'webgl' });
  } catch (e) {
    // 建不起 WebGL（上下文太多、显卡出错）：过场不放了，别把玩家卡在这里
    console.warn('过场建不起画布，跳过', e);
    root.remove();
    style.remove();
    return 'skipped';
  }
  const canvas = app.canvas;
  root.append(canvas, frame, skip);
  const dark = new Sprite(Texture.WHITE);
  dark.tint = 0x1a1520;
  dark.alpha = 0;

  const place = () => {
    Object.assign(canvas.style, { width: `${fit.aw * fit.u}px`, height: `${fit.ah * fit.u}px`, left: `${fit.ox}px`, top: `${fit.oy}px` });
    const fl = fit.ox + fit.fx * fit.u;
    const ft = fit.oy + fit.fy * fit.u;
    Object.assign(frame.style, { left: `${fl}px`, top: `${ft}px`, width: `${SAFE_W * fit.u}px`, height: `${SAFE_H * fit.u}px`, fontSize: `${uiBaseFontPx(SAFE_H * fit.u)}px` });
    root.style.setProperty('--fs', `${Math.max(14, Math.round(uiBaseFontPx(SAFE_H * fit.u) * 0.95))}px`);
    dark.width = fit.aw;
    dark.height = fit.ah;
  };
  place();

  // ---- 镜头 ----
  const build = (name: string, t = 0): Live => {
    const make = SHOTS[name];
    if (!make) throw new Error(`没有这个镜头：${name}`);
    const kit = new ShotKit(fit.aw, fit.ah, fit.fx, fit.fy);
    if (opts.hero) kit.hero = opts.hero;
    const shot = make(kit);
    const rt = RenderTexture.create({ width: fit.aw, height: fit.ah });
    rt.source.scaleMode = 'nearest';
    const spr = new Sprite(rt);
    const L: Live = { name, kit, shot, t: 0, rt, spr };
    // 快进到 t（窗口变了重建、调试跳转时）：按 1/30 秒一步推进，画面状态和一路播过来一样
    while (L.t < t - 1e-6) {
      const d = Math.min(1 / 30, t - L.t);
      L.t += d;
      shot.update(d, L.t);
    }
    if (t <= 0) shot.update(0, 0);
    return L;
  };
  // 换下来的镜头的纹理：每帧销毁几张（一帧里销毁几十张会卡一下）
  const graveyard: Texture[] = [];
  const drop = (L: Live | null) => {
    if (!L) return;
    L.spr.removeFromParent();
    L.spr.destroy();
    graveyard.push(L.rt);
    L.shot.root.destroy({ children: true });
    L.kit.destroy(graveyard);
  };
  const bury = (n: number) => {
    for (let k = 0; k < n && graveyard.length; k++) graveyard.pop()!.destroy(true);
  };

  let i = 0; // 第几镜
  let cur: Live | null = null;
  let prev: Live | null = null; // 正在淡出的上一镜
  let fade = 1; // 交叉淡入的进度（0..1）
  let dip: 'none' | 'down' | 'up' = 'none';
  let dipT = 0;
  let bt = 0; // 这一镜开始后过了多久（字的计时，压暗那半段不算）
  let text: TextView | null = null;
  let textShownAll = false; // 点了一下：字一下子全出
  let doneT = -1; // 字出完的时刻（bt）
  let finished: ((r: CutsceneResult) => void) | null = null;
  let ending = false;
  let frozen = false;

  const beat = () => beats[i];
  const textAt = (b: CutBeat) => b.at ?? 0.9;
  /** 这一镜的对白：本机玩家的角色说的那一句按角色取（story.ts 的 heroSay），别的照写。 */
  const sayOf = (b: CutBeat): { who: string; text: string; color: string; breaks: number[] } | null => {
    const own = b.heroSay ? heroCutLine(opts.hero ?? 'nezha', b.heroSay) : null;
    const s = own ?? (b.say ? { ...b.say, color: '' } : null);
    if (!s) return null;
    // 名字牌的颜色：魔化哪吒朱砂；哪吒藤黄（第一章的过场一直是这个颜色）；别的角色用他对白里的名字牌颜色
    const color = s.who === '魔化哪吒' ? '#d9452b' : s.who === '哪吒' || !s.color ? '#e0a83a' : s.color;
    // breaks：写的地方在第几个字前面换行（去掉换行之后的下标）
    const parts = s.text.split('\n');
    const breaks: number[] = [];
    parts.slice(0, -1).reduce((n, part) => (breaks.push(n + [...part].length), n + [...part].length), 0);
    return { who: s.who, text: parts.join(''), color, breaks };
  };
  const charCount = (b: CutBeat) => (b.narr ? narrColumns(b.narr).join('').length : sayOf(b) ? [...sayOf(b)!.text].length : 0);
  const holdOf = (b: CutBeat) => b.hold ?? Math.min(4.6, Math.max(2.2, 1.5 + charCount(b) * 0.1));

  /** 这一镜的字（建好 DOM、全都藏着；按时间一个个亮起来）。 */
  const makeText = (b: CutBeat, shot: Shot): TextView | null => {
    if (b.narr && NARR_STYLE === 'subtitle') {
      const el = document.createElement('div');
      el.className = shot.sub === 'top' ? 'sub top' : 'sub';
      const bandEl = document.createElement('div');
      bandEl.className = 'band';
      const ln = document.createElement('div');
      ln.className = 'line aside';
      const chars = spell(ln, b.narr.replace(/\n/g, ''));
      bandEl.appendChild(ln);
      el.appendChild(bandEl);
      frame.appendChild(el);
      return { el, chars, cps: NARR_CPS };
    }
    if (b.narr) {
      const el = document.createElement('div');
      el.className = 'narr';
      const chars: HTMLElement[] = [];
      for (const col of narrColumns(b.narr)) {
        const p = document.createElement('p');
        chars.push(...spell(p, col));
        el.appendChild(p);
      }
      const at = shot.narrAt ?? { x: 0.84, y: 0.14 };
      el.style.top = `${(at.y * 100).toFixed(2)}%`;
      frame.appendChild(el);
      fitNarr(el, at);
      return { el, chars, cps: NARR_CPS };
    }
    const say = sayOf(b);
    if (say) {
      const el = document.createElement('div');
      el.className = shot.sub === 'top' ? 'sub top' : 'sub';
      const bandEl = document.createElement('div');
      bandEl.className = 'band';
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = say.who;
      who.style.color = say.color;
      const ln = document.createElement('div');
      ln.className = 'line';
      const chars = spell(ln, say.text);
      // 写的地方的换行：竖屏上照它分行（.sub .line br 只在竖屏显示），横屏一行排完；不算进逐字出现的字里
      say.breaks.forEach((at) => chars[at]?.before(document.createElement('br')));
      bandEl.append(who, ln);
      el.appendChild(bandEl);
      frame.appendChild(el);
      return { el, chars, cps: SAY_CPS };
    }
    if (b.title) {
      const el = document.createElement('div');
      el.className = 'card';
      const big = b.title.big;
      // 大字的字号（CSS 像素，按安全框的基准字号取）：--ts 一定要是像素值，描边、印的大小都按它乘
      el.dataset.ts = String(big.length <= 3 ? 4.6 : 3.4);
      el.style.setProperty('--seal', `url("${sealUrl()}")`);
      const write = 0.35 * big.length + 0.6;
      el.style.setProperty('--write', `${write.toFixed(2)}s`);
      el.style.setProperty('--stamp', `${(write + 0.45).toFixed(2)}s`);
      el.innerHTML = `${b.title.small ? `<div class="small"></div>` : ''}<div class="row"><h1></h1><div class="seal"><span>回</span><span>响</span></div></div>`;
      if (b.title.small) (el.querySelector('.small') as HTMLElement).textContent = b.title.small;
      const h1 = el.querySelector('h1') as HTMLElement;
      h1.dataset.text = big;
      h1.innerHTML = `<span class="fill"></span>`;
      (h1.firstChild as HTMLElement).textContent = big;
      frame.appendChild(el);
      sizeCard(el);
      return { el, chars: [], cps: 1, whole: write + 0.8 };
    }
    return null;
  };

  /** 竖排旁白：x 是几列字的中心（相对安全框的宽）；最长的一列放不下（到安全框底边还差一点）就把字整体缩小。 */
  const fitNarr = (el: HTMLElement, at: { x: number; y: number; h?: number }) => {
    el.style.fontSize = '';
    const room = frame.clientHeight * (at.h ?? 1 - at.y - 0.06);
    const h = el.offsetHeight;
    if (h > room && h > 0) el.style.fontSize = `${(1.42 * room) / h}em`;
    el.style.left = `${Math.round(at.x * frame.clientWidth - el.offsetWidth / 2)}px`;
  };

  const startBeat = (n: number, t = 0) => {
    i = n;
    bt = t;
    textShownAll = false;
    doneT = -1;
    more.classList.remove('on');
    if (text) {
      const old = text.el;
      old.classList.add('gone');
      setTimeout(() => old.remove(), 500);
    }
    const b = beat();
    if (!cur) throw new Error('no shot');
    text = makeText(b, cur.shot);
    opts.onBeat?.(n, b.shot);
  };

  /** 进第 n 镜：建新镜头，和上一镜交叉淡入（或先压暗再亮起）。 */
  const goTo = (n: number) => {
    const b = beats[n];
    const next = build(b.shot);
    drop(prev);
    prev = cur;
    cur = next;
    if (next.shot.enter === 'dip' && prev) {
      dip = 'down';
      dipT = 0;
      cur.spr.alpha = 0;
    } else {
      fade = prev ? 0 : 1;
      cur.spr.alpha = prev ? 0 : 1;
    }
    app.stage.removeChildren();
    if (prev) app.stage.addChild(prev.spr);
    app.stage.addChild(cur.spr, dark);
    startBeat(n);
  };

  const finish = (r: CutsceneResult) => {
    if (ending) return;
    ending = true;
    more.classList.remove('on');
    skip.classList.remove('on');
    root.style.setProperty('--out', r === 'skipped' ? '.55s' : '1s');
    root.classList.add('out');
    setTimeout(() => finished?.(r), r === 'skipped' ? 580 : 1050);
  };

  /** 点一下 / 按键：字没出完就全出；出完了进下一镜。 */
  const advance = () => {
    if (ending || !cur) return;
    if (dip !== 'none' || fade < 1) return; // 换镜头的那一下不接（免得连点跳过两镜）
    const b = beat();
    if (text && doneT < 0) {
      textShownAll = true;
      return;
    }
    if (bt < textAt(b) + 0.3) {
      textShownAll = true;
      return;
    }
    next();
  };
  const next = () => {
    if (i + 1 < beats.length) goTo(i + 1);
    else finish('done');
  };

  // ---- 每帧 ----
  const typeText = () => {
    const b = beat();
    if (!text) {
      if (doneT < 0 && bt >= textAt(b)) doneT = bt;
      return;
    }
    if (text.whole !== undefined) {
      if (bt >= textAt(b) || textShownAll) {
        if (!text.el.classList.contains('on')) text.el.classList.add('on');
        if (doneT < 0) doneT = textShownAll ? bt : textAt(b) + text.whole;
      }
      return;
    }
    if ((bt >= textAt(b) || textShownAll) && !text.el.classList.contains('on')) text.el.classList.add('on');
    const n = textShownAll ? text.chars.length : Math.max(0, Math.floor((bt - textAt(b)) * text.cps + (bt >= textAt(b) ? 1 : 0)));
    let changed = false;
    for (let k = 0; k < Math.min(n, text.chars.length); k++)
      if (!text.chars[k].classList.contains('on')) {
        text.chars[k].classList.add('on');
        changed = true;
      }
    if (changed && opts.sfx && n % 3 === 1 && (b.say || b.heroSay)) opts.sfx.play('dialogue.blip', 0.35);
    if (n >= text.chars.length && doneT < 0) doneT = bt;
  };

  const stepAll = (dt: number) => {
    if (!cur) return;
    // 压暗再亮起
    if (dip === 'down') {
      dipT += dt;
      dark.alpha = Math.min(1, dipT / DIP);
      if (dipT >= DIP) {
        drop(prev);
        prev = null;
        dip = 'up';
        dipT = 0;
        cur.spr.alpha = 1;
      }
    } else if (dip === 'up') {
      dipT += dt;
      dark.alpha = Math.max(0, 1 - dipT / DIP);
      if (dipT >= DIP) {
        dip = 'none';
        dark.alpha = 0;
      }
    }
    if (prev && dip === 'none') {
      fade = Math.min(1, fade + dt / FADE);
      const e = fade * fade * (3 - 2 * fade);
      cur.spr.alpha = e;
      if (fade >= 1) {
        drop(prev);
        prev = null;
      }
    }
    for (const L of [prev, cur]) {
      if (!L) continue;
      if (L === cur && dip === 'down') continue; // 压暗那半段，新镜头还没开始
      L.t += dt;
      L.shot.update(dt, L.t);
      L.kit.sfxTick(L.t, opts.sfx);
    }
    if (dip !== 'down') bt += dt;
    typeText();
    const b = beat();
    if (doneT >= 0) {
      if (bt > doneT + 0.6 && !more.classList.contains('on') && !ending) more.classList.add('on');
      const minT = cur.shot.minT ?? 0;
      if (bt >= doneT + holdOf(b) && cur.t >= minT && !ending) next();
    }
  };

  const render = () => {
    bury(6);
    for (const L of [prev, cur]) {
      if (!L) continue;
      if (!L.spr.parent || L.spr.alpha <= 0.001) continue;
      app.renderer.render({ container: L.shot.root, target: L.rt, clear: true, clearColor: '#1a1520' });
    }
    app.render();
  };

  // ---- 窗口变了：重摆、重建镜头（快进到原来的时刻） ----
  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(() => {
      const f = fitNow();
      if (f.aw === fit.aw && f.ah === fit.ah && f.k === fit.k && f.dpr === fit.dpr) {
        fit = f;
        place();
        return;
      }
      fit = f;
      app.renderer.resize(fit.aw, fit.ah);
      place();
      const rebuild = (L: Live | null) => {
        if (!L) return null;
        const nl = build(L.name, L.t);
        nl.spr.alpha = L.spr.alpha;
        drop(L);
        return nl;
      };
      cur = rebuild(cur);
      prev = rebuild(prev);
      app.stage.removeChildren();
      if (prev) app.stage.addChild(prev.spr);
      if (cur) app.stage.addChild(cur.spr);
      app.stage.addChild(dark);
      if (text?.el.classList.contains('card')) sizeCard(text.el);
      // 字的位置（竖排旁白按安全框的宽摆）
      if (text && cur && beat().narr) fitNarr(text.el, cur.shot.narrAt ?? { x: 0.84, y: 0.14 });
    }, 120);
  };

  // ---- 输入 ----
  const onPointer = (e: PointerEvent) => {
    if (e.button > 0) return;
    e.preventDefault();
    advance();
  };
  const onSkip = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    opts.sfx?.play('ui.click');
    finish('skipped');
  };
  const handled = new WeakSet<KeyboardEvent>();
  const onKeyStack = (e: KeyboardEvent): 'consume' | 'pass' => {
    if (handled.has(e)) return 'consume';
    handled.add(e);
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return 'pass'; // 刷新、开发者工具之类照常
    if (e.repeat) return 'consume';
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter' || k === 'j') advance();
    else if (k === 'escape' && skippable) finish('skipped');
    return 'consume'; // 其余的键也都拦下：播放期间不给游戏
  };
  // 外围界面的按键栈（标题、暂停用的那一个）：压在最上面，暂停面板就收不到 Esc；
  // 栈没挂上的页面（实验页）由下面这个监听兜底（同一个按键不会处理两次）
  const popKeys = pushKeys(onKeyStack);
  const onKeyWin = (e: KeyboardEvent) => {
    const v = onKeyStack(e);
    if (v === 'consume') {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else e.stopImmediatePropagation();
  };
  addEventListener('keydown', onKeyWin, true);
  addEventListener('resize', onResize);
  root.addEventListener('pointerdown', onPointer);
  skip.addEventListener('pointerdown', (e) => e.stopPropagation());
  skip.addEventListener('click', onSkip);
  const noMenu = (e: Event) => e.preventDefault();
  root.addEventListener('contextmenu', noMenu);

  // ---- 调试 ----
  if (opts.debug) {
    (window as unknown as { __cut: unknown }).__cut = {
      /** 跳到第 n 镜、镜头开始后 t 秒（字按时间出到那里）。 */
      seek(n: number, t: number) {
        drop(prev);
        prev = null;
        drop(cur);
        cur = null;
        fade = 1;
        dip = 'none';
        dark.alpha = 0;
        cur = build(beats[n].shot, t);
        app.stage.removeChildren();
        app.stage.addChild(cur.spr, dark);
        cur.spr.alpha = 1;
        startBeat(n, t);
        typeText();
        render();
      },
      freeze(v: boolean) {
        frozen = v;
      },
      get state() {
        return { beat: i, shot: beats[i]?.shot, t: cur?.t ?? 0, bt, fit };
      },
    };
  }

  // ---- 开始 ----
  try {
    goTo(0);
    render();
  } catch (e) {
    console.error('过场出错，提前收场', e);
    finish('skipped');
  }
  requestAnimationFrame(() => {
    root.classList.add('on');
    if (skippable) setTimeout(() => !ending && skip.classList.add('on'), 700);
  });
  let raf = 0;
  let last = performance.now();
  let broken = false;
  // 电脑上窗口小到放不下画面时，页面盖着一层「窗口太小了」（index.html 的 #rotate，同一个条件）：这时过场停着等。
  // 手机竖着拿不再盖提示，过场照常放（画面等比缩小、居中）
  const portrait = matchMedia('(pointer: fine) and (max-width: 479px), (pointer: fine) and (max-height: 269px)');
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (broken || portrait.matches) return;
    try {
      if (!frozen && !ending) stepAll(dt);
      else if (ending && cur) {
        // 淡出那一下画面还在动
        cur.t += dt;
        cur.shot.update(dt, cur.t);
      }
      render();
    } catch (e) {
      // 某个镜头出了错：不卡住玩家，直接收场
      broken = true;
      console.error('过场出错，提前收场', e);
      finish('skipped');
    }
  };
  raf = requestAnimationFrame(loop);

  const result = await new Promise<CutsceneResult>((res) => (finished = res));

  // ---- 清理 ----
  cancelAnimationFrame(raf);
  clearTimeout(resizeT);
  popKeys();
  removeEventListener('keydown', onKeyWin, true);
  removeEventListener('resize', onResize);
  drop(prev);
  drop(cur);
  prev = cur = null;
  bury(Infinity);
  app.stage.removeChildren();
  dark.destroy();
  // Pixi 的全局资源池（合批、滤镜用的临时纹理）：游戏自己的 Pixi 应用还在的时候（收尾过场）不能清，会把它的也清掉；
  // 只有这一页上没有别的 Pixi 画布时（开场过场放在建局之前）才清（官方的做法：拆掉一个应用、之后再建新的，要清）
  const solo = !document.querySelector('#stage canvas');
  app.destroy({ removeView: true, releaseGlobalResources: solo }, { children: true });
  root.remove();
  style.remove();
  if (opts.debug) delete (window as unknown as { __cut?: unknown }).__cut;
  return result;
}

let sealCache = '';
function sealUrl(): string {
  if (sealCache) return sealCache;
  const b = makeSeal(21, 42, 11);
  const c = document.createElement('canvas');
  c.width = b.w;
  c.height = b.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.w, b.h), 0, 0);
  sealCache = c.toDataURL('image/png');
  return sealCache;
}

// ---------- 波间旁白 ----------

const LINE_CSS = `
#fs-wline { position: fixed; pointer-events: none; z-index: 5; display: flex; justify-content: center; font-family: ${FONT_TEXT}; font-weight: normal; font-synthesis: none; color: #f2e8d5; }
#fs-wline .band { position: relative; padding: .5em 4.5em .62em; white-space: nowrap; font-size: 1.22em; line-height: 1.4; letter-spacing: .14em; text-indent: .14em; background: var(--band);
  text-shadow: 0 .06em 0 rgba(${INK},.95), 0 0 .2em rgba(${INK},.55);
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 24%, #000 76%, transparent); mask-image: linear-gradient(180deg, transparent, #000 24%, #000 76%, transparent); }
`;

export interface WaveLineOptions {
  /** 先等多久再出（秒），默认 0：可以等「平 定」横幅淡下去再出。 */
  delay?: number;
  /** 这一行停多久（秒，不含淡入淡出），默认按字数 1.4–2.4 秒。 */
  hold?: number;
  /** 离画布上沿多远（画布高度的比例），默认 0.7（画面下方三成处，不压人物、不压上面的横幅）。 */
  top?: number;
}

/**
 * 波间旁白：在战场上淡入一行字，停一两秒再淡出，然后 resolve（可以 await 它再打开万宝阁）。
 * 不接指针事件、不拦按键，不影响操作；字号跟着画布矩形（uiBaseFontPx），叠在画布上。同时只显示一行（新的顶掉旧的）。
 *   on 'waveEnd'：const t = waveLine(e.wave); if (t) narr = showWaveLine(t, { delay: 0.9 });
 *   on 'shopOpen'：等 narr 放完再打开万宝阁（或者不等，把 waveLine(wave) 直接写在万宝阁的标题下面）。
 */
export function showWaveLine(text: string, o: WaveLineOptions = {}): Promise<void> {
  document.getElementById('fs-wline')?.remove();
  if (!document.querySelector('style[data-fs-wline]')) {
    const s = document.createElement('style');
    s.dataset.fsWline = '';
    s.textContent = LINE_CSS;
    document.head.appendChild(s);
  }
  const el = document.createElement('div');
  el.id = 'fs-wline';
  el.style.setProperty('--band', band(0.66, 24));
  const b = document.createElement('div');
  b.className = 'band';
  b.textContent = text;
  el.appendChild(b);
  const r = canvasRect();
  const top = o.top ?? 0.7;
  Object.assign(el.style, { left: `${r.left}px`, width: `${r.width}px`, top: `${r.top + r.height * top}px`, fontSize: `${uiBaseFontPx(r.height)}px`, opacity: '0' });
  document.body.appendChild(el);
  // 太长放不下：先把两头淡出的墨底收窄（竖屏的画面窄），还放不下再整体缩小（一律不换行）
  const room = r.width * 0.94;
  if (b.offsetWidth > room) b.style.padding = '.5em 1.8em .62em';
  if (b.offsetWidth > room) el.style.fontSize = `${(uiBaseFontPx(r.height) * room) / b.offsetWidth}px`;
  el.style.transform = 'translateY(-50%)';
  const delay = (o.delay ?? 0) * 1000;
  const hold = (o.hold ?? Math.min(2.4, Math.max(1.4, [...text].length * 0.09))) * 1000;
  const fadeIn = 700;
  const fadeOut = 900;
  const total = fadeIn + hold + fadeOut;
  const a = el.animate(
    [
      { opacity: 0, transform: 'translateY(-38%)' },
      { opacity: 1, transform: 'translateY(-50%)', offset: fadeIn / total },
      { opacity: 1, transform: 'translateY(-50%)', offset: (fadeIn + hold) / total },
      { opacity: 0, transform: 'translateY(-56%)' },
    ],
    { duration: total, delay, easing: 'ease-in-out', fill: 'both' },
  );
  return a.finished.then(
    () => el.remove(),
    () => el.remove(),
  );
}
