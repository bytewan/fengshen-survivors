// 波次之间的整理界面「万宝阁」（DOM 盖在画布上，不透明）：宠物进化 → 悟功法 → 升级选属性 → 商店。
// 只读模拟状态、只发指令（Command），自己不改任何状态；联机时同样的指令发给房主即可。
//
// 版面（2026-11-10 起）：内容横着排在画布的 CSS 矩形里（画布按 16:9 铺满窗口，放大倍数可以不是整数），基准字号取
// ui-scale.ts 的 uiBaseFontPx(矩形高度)，其余尺寸都是它的倍数（em）。不再用「和画布同一个整数倍的 CSS zoom」：
// 1080p 上是 28 像素的字、名册两列全显示；手机横屏上是 14 像素的字、名册用页签。墙和横梁的底色铺满整个窗口。
// 竖着用整个窗口的高：窗口比 16:9 高（16:10 全屏、平板）时画布上下有空边，万宝阁整屏不透明，横梁照样贴着窗口上沿，
// 多宝格往下铺满——不然上面是一大块横梁的红、下面空着一截墙。横着仍按画布（手机的刘海、圆角让在画布外面）。
// 像素图（宝物图标、回纹、牙子）固定按整数个设备像素放大（pixel-url.ts 的 pixelUnit），所以不糊、每个像素一样大。
//
// 用户反馈（2026-11-09）：「锁定没生效」——其实是「锁定」两个字太小、点偏就点到卡片本体直接买下了。
// 所以卡片本体不能买；每格下面是大的「购买」按钮和印章样式的「锁」，锁住的格子盖一个朱砂印。
// 点卡片本体（或法宝位的一格）只看详情：卡片上放不下的说明、提示行在详情里都有；卖法宝的按钮也在详情里（看说明和卖分开）。
//
// 键盘：方向键 / WASD 或数字键选卡，回车（空格、J）按下选中的按钮，↑ 看选中那张卡的详情，L 锁定，R 刷新 / 换一批，F 出战。
// 万宝阁开着时这些键不漏给战斗（方向键是移动、空格是神通）；Esc / P 照常给暂停。
// 回车只按「已经选中」的按钮：刚打开时什么都没选中，打完一波手还按着空格也不会误选；选中的按钮自己换了位置
// （买走一件后跳到下一件、换了一批货）之后的一小会儿不接回车，免得连按两下多买一件。
// 指针也一样怕连点：同一个按钮连点两下只算一下（ONCE），换了一步之后的一小会儿不接按钮（STEP_GUARDED）。
// 手柄先不做（docs/design.md 的「操作」一行是目标）。
import { CHAPTER_NAME, HEROES, chapterOf, waveInChapter } from '../sim/catalog.ts';
import { rerollCost } from '../sim/shop.ts';
import { techDue } from '../sim/techniques.ts';
import type { Command, Player, ShopOffer } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import type { Sfx } from '../audio/sfx.ts';
import { BRACKET, CORNER, DIAMOND, FRET, GEM, STAND, flipT, tint } from '../art/sprites/icons.ts';
import { portraitFrames } from './hero-views.ts';
import type { HeroId } from '../sim/types.ts';
import type { Grid } from '../art/pixel.ts';
import { gridUrl, pixelUnit, stripUrl } from './pixel-url.ts';
import { interCss, latticeUrl, type StyleUrls } from './intermission-style.ts';
import { canvasRect, uiBaseFontPx } from './ui-scale.ts';
import { safeInsets } from '../render/safe-area.ts';
import { uiFit } from './front-ui.ts';
import { paused } from './pause.ts';
import {
  bagHtml,
  canBuy,
  gem,
  heroHtml,
  keycap,
  offerIcon,
  offerKey,
  offerView,
  petHtml,
  petView,
  slotDetailHtml,
  slotsHtml,
  soldView,
  statView,
  statsHtml,
  wuxingHtml,
  type CardView,
} from './intermission-view.ts';
import { techNotesHtml, techView, techsHtml } from './intermission-view.ts';
import type { TechniqueId } from '../sim/types.ts';
import { BANK } from '../audio/bank.ts';

/** 竖屏（.tall）时多宝格一行几格：三格以内排一行，四格两行两列，五格三列。 */
const tallCols = (n: number) => (n <= 3 ? n : n === 4 ? 2 : 3);

type Mode = 'pet' | 'tech' | 'level' | 'shop';
const STEP_NAME: Record<Mode, string> = { pet: '进化', tech: '功法', level: '升级', shop: '商店' };
const MODES: Mode[] = ['pet', 'tech', 'level', 'shop'];
type Tab = 'a' | 'b' | 'c' | 'd';

/** 版面最少要这么多个基准字号见方（再小——只会是特别小的窗口——就把字缩下去，保住版面）。 */
const MIN_W_EM = 45.5;
const MIN_H_EM = 25.5;
/**
 * 竖屏（手机竖着拿，.tall）：横着排要 45.5 个字宽，字会小到看不清，改成上下排——名册在上、多宝格在下排成两列 / 三列。
 * 这时最少要这么多个字宽、字高（iPhone 13 竖屏是 14 像素的字，和横屏一样大）。
 */
const TALL_W_EM = 26;
const TALL_H_EM = 40;
/** 选中的按钮被界面自己挪动之后，多久不接「按下」（毫秒）。 */
const GUARD_MS = 350;
/** 同一个按钮在这么短的时间里点两下（双击、手抖）只算一下（毫秒）。 */
const DOUBLE_MS = 300;
/** 连点两下只算一下的按钮：买、选属性、进化、悟功法、卖出（第一下待确认，第二下要隔开一点才算确认）。 */
const ONCE = new Set(['buy', 'pick', 'evolve', 'learn', 'sell']);
/** 换了一步（进化 → 功法 → 升级 → 商店）之后的一小会儿不接的按钮：上一步的连点不落到新摆上来的按钮上。 */
const STEP_GUARDED = new Set(['buy', 'lock', 'pick', 'evolve', 'learn', 'reroll', 'rerollLevel', 'ready']);

interface CardRef {
  el: HTMLElement;
  niche: HTMLElement;
  info: HTMLElement;
  act: HTMLElement;
  key: string | null;
  icon: Grid | null; // 这一格最后摆着的宝物（买走时让它「被拿走」）
  offer: ShopOffer | null; // 这一格最后摆着的货（空了之后据此写「已售」还是「未选」）
  detail: string; // 详情（提示框里的全文）
  gen: number; // 上次量「放不放得下」时的版面
  more: boolean; // 说明或提示行被截短 / 收起了（详情里有全文）
  rich: boolean; // 详情里有卡片上没写的东西（各品阶、另一个器灵）
  tight: boolean; // 「购买 + 价钱」放不下，只写「买」
  anim: string; // 正在播的入场类：in / swap
  animT: number;
}

/** 键盘选中的是哪个按钮（DOM 重画之后据此把焦点还回去）。 */
type Focus = { z: 'card'; i: number } | { z: 'bar'; act: string } | { z: 'slot'; i: number } | { z: 'sell' };
type Dir = 'l' | 'r' | 'u' | 'd';
const DIRS: Record<string, Dir> = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ArrowUp: 'u', w: 'u', ArrowDown: 'd', s: 'd' };

/** 提示框里现在是什么：一句提示（data-tip）、一张卡的详情、一件已有法宝的详情。sticky = 点出来的，点别处才收。 */
type Pop = { kind: 'tip'; anchor: HTMLElement; sticky: boolean } | { kind: 'card'; i: number; sticky: boolean } | { kind: 'slot'; i: number; sticky: boolean };

function styleUrls(): StyleUrls {
  const corners: StyleUrls['corners'] = {};
  for (const ch of ['b', 'j', 'C', 'm', 'Y', 'e', 'g', 'y']) {
    const [tl, tr, bl, br] = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ].map(([h, v]) => gridUrl(tint(flipT(CORNER, h, v), ch)));
    corners[ch] = [tl, tr, bl, br];
  }
  // 左上角的小立绘：每个角色一条待机帧（按 Player.hero 换 class，见 heroHtml）
  const hero = Object.fromEntries(
    (Object.keys(HEROES) as HeroId[]).map((id) => {
      const fs = portraitFrames(id);
      const st = stripUrl(fs);
      return [id, { url: st.url, w: st.w, h: st.h, n: fs.length }];
    }),
  ) as StyleUrls['hero'];
  return {
    corners,
    bracket: [gridUrl(tint(BRACKET, 'B', 'b')), gridUrl(tint(flipT(BRACKET, true, false), 'B', 'b'))],
    fret: gridUrl(tint(FRET, 'r')),
    stand: gridUrl(STAND),
    gem: gridUrl(GEM),
    diamond: gridUrl(tint(DIAMOND, 'b')),
    dot: gridUrl(tint(DIAMOND, 'w')),
    hero,
  };
}

const SKELETON = `
<header class="beam"><div class="beam-in"><div class="plaque">万宝阁</div><div class="title"></div><div class="steps"></div><div class="ls"><span>灵石</span>${gem()}<b></b></div></div></header>
<div class="body"><div class="frame">
<aside class="side">
  <div class="hero"></div>
  <div class="tabs"><button data-act="tab" data-tab="a">法宝</button><button data-act="tab" data-tab="b">属性</button><button data-act="tab" data-tab="c">宠物</button><button data-act="tab" data-tab="d">功法</button></div>
  <div class="page pa"><div class="slots"></div><i class="dv"></i><div class="wx"></div><i class="dv pax"></i><div class="techs pax"></div></div>
  <div class="page pb"><div class="stats"></div><i class="dv"></i><div class="bag"></div><i class="dv pbx"></i><div class="pet pbx"></div></div>
  <div class="page pc"><div class="pet"></div></div>
  <div class="page ptk"><div class="tknotes"></div></div>
</aside>
<main class="main">
  <div class="cards"></div>
  <div class="bar"></div>
</main>
</div></div>
<div class="pop"></div>`;

export function mountIntermission(send: (c: Command) => void, sfx?: Sfx) {
  const style = document.createElement('style');
  style.textContent = interCss(styleUrls());
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'inter';
  const beamx = document.createElement('div');
  beamx.className = 'beamx';
  const ui = document.createElement('div');
  ui.className = 'ui';
  ui.innerHTML = SKELETON;
  root.append(beamx, ui);
  document.body.appendChild(root);
  const $ = (s: string) => ui.querySelector(s) as HTMLElement;
  const el = {
    title: $('.title'),
    ls: $('.ls'),
    lsNum: $('.ls b'),
    hero: $('.hero'),
    tabs: $('.tabs'),
    pa: $('.pa'),
    slots: $('.slots'),
    wx: $('.wx'),
    stats: $('.stats'),
    pets: [...ui.querySelectorAll('.pet')] as HTMLElement[],
    techs: [...ui.querySelectorAll('.techs')] as HTMLElement[], // 已悟的功法：两列时在「法宝」那一栏底下，页签时单独一页
    tknotes: $('.tknotes'), // 页签时「功法」那一页：已悟功法的说明
    bag: $('.bag'),
    steps: $('.steps'),
    cards: $('.cards'),
    bar: $('.bar'),
    pop: $('.pop'),
  };

  // ---------- 只在内容变了时才改 DOM ----------
  const shown = new WeakMap<Element, string>();
  const set = (e: Element, html: string) => {
    if (shown.get(e) === html) return false;
    e.innerHTML = html;
    shown.set(e, html);
    return true;
  };

  // ---------- 界面状态（只属于界面，不进模拟） ----------
  let me = 0;
  let world: World | null = null;
  let mode: Mode | '' = '';
  let steps: Mode[] = [];
  let tab: Tab = 'a';
  let armed = -1; // 详情里的「卖出」按了一次、等确认的法宝位
  let armedTimer = 0;
  let cards: CardRef[] = [];
  let sig = '';
  let lastLs = -1;
  let lastRerolls = -1;
  let lastLevelKey = '';
  let lastTechKey = '';
  let openTimer = 0;
  let layout = { key: '', theme: '', base: 16 };
  let layoutDirty = true; // 窗口 / 画布变了，下一次重画前重新量
  let layoutGen = 0; // 版面每变一次 +1，卡片据此重新量一次说明放不放得下
  let titleKey = '';
  let rosterKey = '';
  let bagKey = '';
  let pop: Pop | null = null;
  let popShown = '';
  let still: { x: number; y: number } | null = null; // 刚点了一下把详情收起：鼠标没挪开之前，不因为「悬停」又弹出一个来
  let focusWant: Focus | null = null;
  let kb = false; // 最近一次操作是不是键盘（是才在重画之后把焦点还回去）
  let lastCard = 0;
  let focusKey: string | null = null; // 选中的那张卡在选中时摆的是什么货（重画之后货没变，就不必拦下一次回车）
  let guardUntil = 0; // 这之前不接回车和快捷键（见文件头的说明）
  let stepAt = 0; // 这一步摆上来的时刻（指针的连点，见 STEP_GUARDED）
  let lastAct = { k: '', t: 0 }; // 上一次点的按钮（指针和键盘都算，见 ONCE）
  let leaving = 0; // 点了出战之后的一小会儿：按键不再拦，还给战斗
  let closing = false;
  let closeTimer = 0;
  let ro: ResizeObserver | null = null;

  // ---------- 版面：横着排在画布的矩形里、竖着用整个窗口的高，尺寸跟着基准字号走 ----------
  function fit() {
    const theme = document.documentElement.dataset.fontTheme ?? '';
    if (!layoutDirty && theme === layout.theme) return;
    layoutDirty = false;
    if (!ro && typeof ResizeObserver !== 'undefined') {
      const cv = document.querySelector('#stage canvas');
      if (cv) {
        ro = new ResizeObserver(() => (layoutDirty = true));
        ro.observe(cv);
      }
    }
    const dpr = window.devicePixelRatio || 1;
    const r = canvasRect();
    const coarse = matchMedia('(pointer: coarse)').matches;
    const h = innerHeight; // 竖着用整个窗口（见文件头）；字号仍按画布的高取，和战斗界面一样大
    const sf = safeInsets(); // 横梁的字、底栏让开刘海和底部横条（横梁的底色照样铺到窗口上沿）
    const key = [r.left, r.width, r.height, h, dpr, coarse, theme, sf.top, sf.bottom].join(',');
    if (key === layout.key) return;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const usable = h - sf.top - sf.bottom;
    const ub = uiBaseFontPx(r.height);
    // 竖屏（见 TALL_W_EM）：横着排会把字压到不到九成大时才改成上下排；平板竖着拿（够宽）照旧横着排
    const tall = usable > r.width * 1.2 && r.width / MIN_W_EM < ub * 0.92;
    const base = tall ? Math.min(ub, r.width / TALL_W_EM, usable / TALL_H_EM) : Math.min(ub, r.width / MIN_W_EM, usable / MIN_H_EM);
    const we = r.width / base;
    const he = usable / base;
    // 名册：又宽又高时两列全显示（法宝五行功法 | 属性行囊宠物），不然用页签；再矮一档（手机横屏）各处收紧
    const cols = !tall && we >= 58 && he >= 33;
    const compact = !cols && he < (tall ? 44 : 30); // 竖屏里矮一些的（iPhone SE）也收紧
    const ln = pixelUnit(base / 13, dpr);
    const us = pixelUnit(base / 10.5, dpr);
    const ug = pixelUnit(base * 0.105, dpr);
    // 手机上按钮不小于 32 个 CSS 像素；竖屏（上下排，高度宽裕）不小于 40
    const tap = coarse ? Math.max(tall ? 40 : 32, base * 1.9) : base * 1.9;
    const lockw = Math.max(coarse ? 32 : 0, tap * 0.9); // 「锁」比按钮高度窄一点，给「购买 + 价钱」多留些地方
    // 手机上暂停的小牌在万宝阁里挪到灵石框左边（pause.ts 的 placeButton：宽 max(按钮高, 36)，离灵石框 8 像素）：
    // 横梁上的步骤给它让出这么宽，再空出 0.4 个字（.ls 本来就和步骤隔着 0.9 个字的间距）
    const pz = coarse ? Math.max(0, Math.max(uiFit().tap, 36) + 8 + base * 0.4 - base * 0.9) : 0;
    layout = { key, theme, base };
    Object.assign(ui.style, { left: `${snap(r.left)}px`, top: '0px', width: `${snap(r.width)}px`, height: `${snap(h)}px` });
    root.style.fontSize = `${base}px`;
    const vars: Record<string, string> = {
      '--em': `${base}px`,
      '--ln': `${ln}px`,
      '--us': `${us}px`,
      '--ug': `${ug}px`,
      '--tap': `${snap(tap)}px`,
      '--lockw': `${snap(lockw)}px`,
      '--pz': `${snap(pz)}px`,
      '--tileh': coarse ? `${snap(tap)}px` : '0px',
      '--rl': `${snap(r.left)}px`,
      '--st': `${snap(sf.top)}px`,
      '--sb': `${snap(sf.bottom)}px`,
      '--minfs': `${Math.min(14, base)}px`,
      '--lattice': latticeUrl(us * 16, ln),
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.classList.toggle('tall', tall);
    root.classList.toggle('cols', cols);
    root.classList.toggle('tabs-on', !cols);
    root.classList.toggle('compact', compact);
    root.classList.toggle('coarse', coarse);
    root.classList.toggle('keys', !coarse); // 按键提示只在有键盘的设备上显示
    // 龛里宝物的大小跟着卡片的高度走（龛连几座大约占卡片的四分之一），再取成整数个设备像素。竖屏时多宝格排成几行，按一行的高算
    const rows = tall ? Math.ceil((Number(el.cards.style.getPropertyValue('--n')) || 4) / tallCols(Number(el.cards.style.getPropertyValue('--n')) || 4)) : 1;
    const cardH = (el.cards.clientHeight || h * 0.7) / rows;
    const u = pixelUnit(Math.max(base * 0.17, Math.min(base * 0.36, (cardH * 0.235 - base * 0.8) / 20)), dpr);
    root.style.setProperty('--u', `${u}px`);
    sig = ''; // 版面变了，内容按新尺寸重排一次
    layoutGen++;
  }
  const onResize = () => {
    if (gone()) return;
    layoutDirty = true;
  };
  addEventListener('resize', onResize);

  // ---------- 卡片 ----------
  function buildCards(n: number) {
    el.cards.style.setProperty('--n', String(n));
    el.cards.style.setProperty('--cols', String(Math.max(4, n))); // 修为多出第 5 格时按 5 格分（intermission-style.ts）
    el.cards.style.setProperty('--tcols', String(tallCols(n))); // 竖屏（.tall）时一行几格
    if (root.classList.contains('tall')) layoutDirty = true; // 竖屏时格数变了，行数跟着变，龛里宝物的大小要重新量
    el.cards.classList.toggle('c5', n > 4);
    el.cards.classList.remove('tight');
    el.cards.innerHTML = Array.from({ length: n }, () => `<div class="card"><div class="niche"></div><div class="info"></div><div class="act"></div></div>`).join('');
    cards = [...el.cards.children].map((c) => ({
      el: c as HTMLElement,
      niche: c.children[0] as HTMLElement,
      info: c.children[1] as HTMLElement,
      act: c.children[2] as HTMLElement,
      key: null,
      icon: null,
      offer: null,
      detail: '',
      gen: -1,
      more: false,
      rich: false,
      tight: false,
      anim: '',
      animT: 0,
    }));
    cards.forEach((c, i) => playCard(c, 'in', i * 90));
    if (pop?.kind === 'card') hidePop();
  }
  function playCard(c: CardRef, anim: 'in' | 'swap', delay: number) {
    c.el.classList.remove('in', 'swap');
    void c.el.offsetWidth; // 重新触发动画
    c.anim = anim;
    c.el.style.setProperty('--d', `${delay}ms`);
    c.el.classList.add(anim);
    clearTimeout(c.animT);
    c.animT = window.setTimeout(() => {
      c.el.classList.remove(anim);
      c.anim = '';
    }, delay + 1100);
  }
  const cardClass = (c: CardRef, cls: string) => `card ${cls}${c.more ? ' more' : ''}${c.anim ? ` ${c.anim}` : ''}`;
  function setCard(c: CardRef, v: Pick<CardView, 'niche' | 'info' | 'act' | 'detail' | 'rich'>, cls: string) {
    set(c.niche, v.niche);
    const changed = set(c.info, v.info);
    c.detail = v.detail;
    c.rich = !!v.rich;
    if (set(c.act, v.act) || changed || c.gen !== layoutGen) {
      c.gen = layoutGen;
      c.more = c.tight = false;
      const bare = cardClass(c, cls);
      if (c.el.className !== bare) c.el.className = bare;
      fitCard(c);
    }
    const want = cardClass(c, cls);
    if (c.el.className !== want) c.el.className = want;
  }
  /**
   * 一张卡放不下时怎么收：说明优先。先从后往前收起可有可无的提示行，还放不下才把说明按行截短（至少留一行）。
   * 一定要看到的那行（碎片进度、器灵二选一）始终留着。被收起 / 截短的内容在详情里都有（点卡片本体，或把鼠标停在说明上）。
   * 按钮那一行先填好再量；「购买 + 价钱」放不下时只写「买」——同一排的卡一起改（见 renderShop），免得有的写「购买」有的写「买」。
   */
  function fitCard(c: CardRef) {
    const buy = c.act.querySelector('.buy') as HTMLElement | null;
    if (buy) {
      el.cards.classList.remove('tight'); // 按「购买」两个字都在的样子量
      // 按实际宽度加起来量（scrollWidth 是取整的，差不到一像素会让价钱贴着按钮的右边）
      const cs = getComputedStyle(buy);
      const kids = [...buy.children] as HTMLElement[];
      const need = kids.reduce((sum, e) => sum + e.getBoundingClientRect().width, 0) + (parseFloat(cs.columnGap) || 0) * Math.max(0, kids.length - 1) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      c.tight = need > buy.clientWidth + 0.01;
    }
    const info = c.info;
    const ds = info.querySelector('.ds') as HTMLElement | null;
    const opt = [...info.querySelectorAll('.nt:not(.must)')] as HTMLElement[];
    // 从头量：先把上一次的截短、收起撤掉（窗口变大了——比如竖屏转回横屏——收起的要能放回来）
    if (ds) {
      ds.classList.remove('clamp', 'gone');
      ds.style.removeProperty('-webkit-line-clamp');
    }
    for (const o of opt) o.classList.remove('off');
    // 伸出去多少（按实际的矩形量，不按取整的 scrollHeight：差不到一像素也会让沉底的提示行和别的卡错开）
    const over = () => {
      let bottom = -Infinity;
      for (const k of info.children) bottom = Math.max(bottom, k.getBoundingClientRect().bottom);
      return bottom - info.getBoundingClientRect().bottom;
    };
    const FIT = 0.25;
    if (!ds || over() <= FIT) return;
    c.more = true;
    for (let i = opt.length - 1; i >= 0 && over() > FIT; i--) opt[i].classList.add('off');
    if (over() <= FIT) return;
    const lh = parseFloat(getComputedStyle(ds).lineHeight) || 1;
    let lines = Math.max(1, Math.round(ds.offsetHeight / lh));
    const clamp = (n: number) => {
      lines = n;
      ds.classList.add('clamp');
      ds.style.setProperty('-webkit-line-clamp', String(n));
    };
    clamp(Math.max(1, lines - Math.ceil(over() / lh)));
    while (over() > FIT && lines > 1) clamp(lines - 1);
    // 一行都放不下（竖屏两行两列的小卡）：说明整段收起，点卡片看详情
    if (over() > FIT) ds.classList.add('gone');
  }

  /** 撤掉 clampToFit 加的截短（和它带上的全文提示）。 */
  function unclamp(items: HTMLElement[]) {
    for (const e of items) {
      e.classList.remove('clamp');
      e.style.removeProperty('-webkit-line-clamp');
      if (e.dataset.clamped) {
        delete e.dataset.clamped;
        delete e.dataset.tip;
      }
    }
  }
  /** 把一组文字块按行截短，直到 box 不再溢出；截过的块带上 data-tip（全文），悬停 / 点一下能看全。 */
  function clampToFit(box: HTMLElement, items: HTMLElement[]) {
    unclamp(items);
    const st = items.map((e) => {
      const lh = parseFloat(getComputedStyle(e).lineHeight) || 1;
      return { e, n: Math.max(1, Math.round(e.offsetHeight / lh)) };
    });
    for (let guard = 0; guard < 40 && box.scrollHeight - box.clientHeight > 1; guard++) {
      const t = st.filter((s) => s.n > 1).sort((a, b) => b.n - a.n)[0];
      if (!t) break;
      t.n--;
      t.e.classList.add('clamp');
      t.e.style.setProperty('-webkit-line-clamp', String(t.n));
      t.e.dataset.clamped = '1';
      t.e.dataset.tip = t.e.textContent ?? '';
    }
  }

  // ---------- 提示框 / 详情 ----------
  function popAnchor(p: Pop): HTMLElement | null {
    if (p.kind === 'tip') return p.anchor.isConnected ? p.anchor : null;
    if (p.kind === 'card') return cards[p.i]?.el ?? null;
    return el.slots.querySelector(`button.tile[data-i="${p.i}"]`);
  }
  function drawPop() {
    if (!pop) return;
    const a = popAnchor(pop);
    const html = pop.kind === 'tip' ? '' : pop.kind === 'card' ? (cards[pop.i]?.detail ?? '') : world ? slotDetailHtml(world, world.players[me], pop.i, pop.sticky, armed === pop.i) : '';
    const text = pop.kind === 'tip' ? (pop.anchor.dataset.tip ?? '') : '';
    if (!a || !a.offsetParent || !(html || text)) return hidePop();
    const want = pop.kind === 'tip' ? `t:${text}` : html;
    if (popShown !== want) {
      if (pop.kind === 'tip') el.pop.textContent = text;
      else el.pop.innerHTML = html;
      popShown = want;
    }
    const cls = `pop on${pop.sticky ? ' pin' : ''}${pop.kind === 'tip' ? '' : ' wide'}`;
    if (el.pop.className !== cls) el.pop.className = cls;
    // 位置：提示在下方（放不下就上方）；详情在旁边（卡片的右边，放不下就左边），不压住点的那一格
    const ur = ui.getBoundingClientRect();
    const r = (pop.kind === 'card' ? cards[pop.i].info : a).getBoundingClientRect();
    const pw = el.pop.offsetWidth;
    const ph = el.pop.offsetHeight;
    const gap = layout.base * 0.4;
    let x: number;
    let y: number;
    if (pop.kind === 'tip') {
      x = r.left - ur.left;
      y = r.bottom - ur.top + gap * 0.6;
      if (y + ph > ur.height - 2) y = r.top - ur.top - ph - gap * 0.6;
    } else {
      const ar = a.getBoundingClientRect();
      x = ar.right - ur.left + gap;
      if (x + pw > ur.width - 2) x = ar.left - ur.left - gap - pw;
      y = r.top - ur.top;
    }
    el.pop.style.left = `${Math.round(Math.max(2, Math.min(ur.width - pw - 2, x)))}px`;
    el.pop.style.top = `${Math.round(Math.max(2, Math.min(ur.height - ph - 2, y)))}px`;
  }
  function setPop(p: Pop) {
    const slotChange = (pop?.kind === 'slot' && pop.sticky) || (p.kind === 'slot' && p.sticky);
    if (pop?.kind === 'slot' && (p.kind !== 'slot' || p.i !== pop.i)) disarm();
    pop = p;
    popShown = '';
    drawPop();
    if (slotChange) sig = ''; // 法宝格上「详情开着」的标记要重画
  }
  function hidePop() {
    if (!pop) return;
    const slot = pop.kind === 'slot';
    pop = null;
    popShown = '';
    el.pop.className = 'pop';
    if (slot) {
      disarm(); // 详情收起，「待确认卖出」也一起撤销
      sig = '';
    }
  }
  function disarm() {
    clearTimeout(armedTimer);
    armed = -1;
  }
  const isSticky = (kind: Pop['kind'], i: number) => !!pop && pop.sticky && pop.kind === kind && pop.kind !== 'tip' && pop.i === i;

  // 鼠标：悬停就显示（已有法宝的详情、被截短的卡片说明、各处的提示）；点出来的详情开着时不跟着鼠标换
  ui.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch' || pop?.sticky) return;
    const t = ev.target as HTMLElement;
    const tile = t.closest('button.tile') as HTMLElement | null;
    const info = tile ? null : t.closest('.card .info');
    const ci = info ? cards.findIndex((c) => c.info === info) : -1;
    if (still && Math.hypot(ev.clientX - still.x, ev.clientY - still.y) < 4) return; // 刚点了收起、鼠标还没动（内容重画也会触发悬停）
    still = null;
    if (tile) return setPop({ kind: 'slot', i: Number(tile.dataset.i), sticky: false });
    if (ci >= 0 && cards[ci].detail && (cards[ci].more || cards[ci].rich)) return setPop({ kind: 'card', i: ci, sticky: false });
    const tip = t.closest('[data-tip]') as HTMLElement | null;
    if (tip) return setPop({ kind: 'tip', anchor: tip, sticky: false });
    hidePop();
  });
  ui.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'touch' && pop && !pop.sticky) hidePop();
  });
  // 按下：点了别处，点出来的详情 / 提示就收起（点的还是同一处的，留给下面的 click 去开关）；
  // 手指点一下带提示的地方，提示留着，直到再点别处（手指没有悬停）
  root.addEventListener('pointerdown', (ev) => {
    kb = false;
    const t = ev.target as HTMLElement;
    if (el.pop.contains(t)) return;
    const tip = t.closest('[data-tip]') as HTMLElement | null;
    if (pop?.sticky) {
      const tile = t.closest('button.tile') as HTMLElement | null;
      const same =
        pop.kind === 'tip' ? tip === pop.anchor : pop.kind === 'slot' ? !!tile && Number(tile.dataset.i) === pop.i : !!cards[pop.i]?.el.contains(t) && !t.closest('.act');
      const wasTip = pop.kind === 'tip';
      if (!same || wasTip) {
        hidePop();
        still = { x: ev.clientX, y: ev.clientY };
      }
      if (same && wasTip) return; // 再点一下同一个提示：收起
    }
    if (ev.pointerType === 'touch' && tip && !tip.closest('button')) setPop({ kind: 'tip', anchor: tip, sticky: true });
  });

  // ---------- 点击：只有按钮能点；卡片本体、法宝位的一格只开详情 ----------
  const play = (name: string) => sfx?.play(name);
  root.addEventListener('click', (ev) => {
    if (!world || closing) return;
    const t0 = ev.target as HTMLElement;
    const t = t0.closest('[data-act]') as HTMLElement | null;
    if (!t) {
      if (el.pop.contains(t0)) {
        // 点详情本身（不是里面的按钮）：收起
        still = { x: ev.clientX, y: ev.clientY };
        return hidePop();
      }
      const ce = t0.closest('.card');
      const ci = ce && !t0.closest('.act') ? cards.findIndex((c) => c.el === ce) : -1;
      if (ci >= 0 && cards[ci].detail) {
        if (isSticky('card', ci)) {
          hidePop();
          still = { x: ev.clientX, y: ev.clientY };
        } else setPop({ kind: 'card', i: ci, sticky: true });
      }
      return;
    }
    const act = t.dataset.act ?? '';
    // 按点下去的时刻算（不是处理到这一下的时刻）：画面卡住时两下连点会挤在一起处理，按处理的时刻量会以为隔得很开
    const now = ev.timeStamp || performance.now();
    // 刚换了一步：双击上一步最后那张卡的第二下，不会落到新摆上来的「购买」「选这项」上
    if (STEP_GUARDED.has(act) && now - stepAt < GUARD_MS) return;
    if (ONCE.has(act)) {
      // 同一个按钮连点两下只算一下：不会连选两项属性，「卖出」也不会一双击就确认
      const k = `${act}:${t.dataset.i ?? t.dataset.b ?? t.dataset.id ?? ''}`;
      if (k === lastAct.k && now - lastAct.t < DOUBLE_MS) return;
      lastAct = { k, t: now };
    }
    const p = world.players[me];
    const i = Number(t.dataset.i);
    switch (act) {
      case 'buy': {
        const o = p.shop[i];
        if (o && canBuy(p, o)) {
          send({ t: 'buy', player: me, slot: i });
          play('ui.buy');
        } else play('ui.denied');
        break;
      }
      case 'lock':
        if (!p.shop[i]) return;
        send({ t: 'lock', player: me, slot: i });
        play('ui.lock');
        break;
      case 'reroll':
        if (p.lingshi >= rerollCost(world, p)) {
          send({ t: 'reroll', player: me });
          play('ui.reroll');
        } else play('ui.denied');
        break;
      case 'rerollLevel':
        if (p.lingshi >= 2 + p.level) {
          send({ t: 'rerollLevel', player: me });
          play('ui.reroll');
        } else play('ui.denied');
        break;
      case 'ready':
        send({ t: 'ready', player: me });
        play('ui.ready');
        // 界面要等模拟开了波才收起（下一帧）：这中间按的空格也要算数，所以现在就不再拦按键、把焦点放掉
        leaving = performance.now() + 500;
        focusWant = null;
        (document.activeElement as HTMLElement | null)?.blur?.();
        hidePop();
        break;
      case 'pick':
        send({ t: 'pick', player: me, index: i });
        play('ui.click');
        break;
      case 'evolve':
        send({ t: 'evolve', player: me, branch: t.dataset.b as 'bind' | 'fire' });
        play('ui.click');
        break;
      case 'learn':
        send({ t: 'learn', player: me, id: t.dataset.id as TechniqueId });
        play(BANK['tech.learn'] ? 'tech.learn' : 'ui.levelup'); // 悟得一门（tech.learn 还没有素材时借解锁那一声）
        break;
      case 'slot':
        // 法宝位的一格：只开 / 关详情，不卖（用户在手机上想看说明，点两下就把法宝卖了）
        if (isSticky('slot', i)) {
          hidePop();
          still = { x: ev.clientX, y: ev.clientY };
        } else {
          setPop({ kind: 'slot', i, sticky: true });
          if (kb && el.pop.querySelector('.sell')) focusTo({ z: 'sell' });
        }
        play('ui.click');
        break;
      case 'sell':
        // 详情里的「卖出」：要再点一次确认，免得手一滑卖掉
        clearTimeout(armedTimer);
        if (armed === i) {
          send({ t: 'sell', player: me, weapon: i });
          play('ui.buy');
          hidePop();
          if (kb) focusWant = { z: 'slot', i: Math.max(0, i - 1) }; // 卖掉了：焦点回到前一格
        } else {
          armed = i;
          play('ui.click');
          armedTimer = window.setTimeout(() => {
            armed = -1;
            sig = '';
          }, 3000);
        }
        break;
      case 'tab':
        tab = (t.dataset.tab as Tab) ?? 'a';
        play('ui.click');
        break;
    }
    sig = '';
  });

  // ---------- 键盘 ----------
  const mainBtn = (i: number) => (cards[i] && !cards[i].el.classList.contains('sold') ? (cards[i].act.querySelector('.buy, .pick') as HTMLElement | null) : null);
  const availableCards = () => cards.map((_, i) => (mainBtn(i) ? i : -1)).filter((i) => i >= 0);
  const barButtons = () => [...el.bar.querySelectorAll('button')] as HTMLElement[];
  const tiles = () => (el.slots.offsetParent ? ([...el.slots.querySelectorAll('button.tile')] as HTMLElement[]) : []);
  function elFor(f: Focus): HTMLElement | null {
    if (f.z === 'card') return mainBtn(f.i);
    if (f.z === 'bar') return el.bar.querySelector(`[data-act="${f.act}"]`);
    if (f.z === 'slot') return tiles()[f.i] ?? null;
    return el.pop.querySelector('.sell');
  }
  /** 现在焦点在哪个按钮上（不在万宝阁的按钮上就是 null）。「锁」算在它那张卡上。 */
  function focusNow(): Focus | null {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !root.contains(a)) return null;
    const ci = cards.findIndex((c) => c.act.contains(a));
    if (ci >= 0) return { z: 'card', i: ci };
    if (el.bar.contains(a) && a.dataset.act) return { z: 'bar', act: a.dataset.act };
    if (a.classList.contains('tile')) return { z: 'slot', i: tiles().indexOf(a) };
    if (a.classList.contains('sell')) return { z: 'sell' };
    return null;
  }
  function focusTo(f: Focus | null) {
    const e = f ? elFor(f) : null;
    if (!f || !e) return false;
    focusWant = f;
    if (f.z === 'card') {
      lastCard = f.i;
      focusKey = cards[f.i]?.key ?? null;
    }
    e.focus({ preventScroll: true });
    return true;
  }
  /** 底栏默认的按钮：出战（没有就第一个）。 */
  function barDefault(): Focus | null {
    const bs = barButtons();
    const b = bs.find((x) => x.dataset.act === 'ready') ?? bs[0];
    return b?.dataset.act ? { z: 'bar', act: b.dataset.act } : null;
  }
  function move(cur: Focus | null, dir: Dir) {
    const av = availableCards();
    const firstCard = (): Focus | null => (av.length ? { z: 'card', i: av.includes(lastCard) ? lastCard : av[0] } : barDefault());
    if (!cur) return void focusTo(firstCard()); // 还没选中：先落在卡片上
    if (cur.z === 'card') {
      if (dir === 'u') {
        // 往上：开 / 关这张卡的详情（各品阶、被截短的说明）
        if (isSticky('card', cur.i)) hidePop();
        else if (cards[cur.i]?.detail) setPop({ kind: 'card', i: cur.i, sticky: true });
        return;
      }
      if (pop?.sticky) hidePop();
      if (dir === 'l') {
        const prev = [...av].reverse().find((j) => j < cur.i);
        if (prev !== undefined) focusTo({ z: 'card', i: prev });
        else if (tiles().length) focusTo({ z: 'slot', i: Math.min(1, tiles().length - 1) }); // 最左一张再往左：到名册的法宝位
      } else if (dir === 'r') {
        const next = av.find((j) => j > cur.i);
        if (next !== undefined) focusTo({ z: 'card', i: next });
      } else focusTo(barDefault());
    } else if (cur.z === 'bar') {
      const bs = barButtons();
      const at = bs.findIndex((b) => b.dataset.act === cur.act);
      if (dir === 'u') focusTo(firstCard());
      else if (dir === 'l' || dir === 'r') {
        const b = bs[at + (dir === 'r' ? 1 : -1)];
        if (b?.dataset.act) focusTo({ z: 'bar', act: b.dataset.act });
      }
    } else if (cur.z === 'slot') {
      if (pop?.sticky) hidePop();
      const n = tiles().length;
      const to = dir === 'l' ? (cur.i % 2 ? cur.i - 1 : -1) : dir === 'r' ? (cur.i % 2 === 0 && cur.i + 1 < n ? cur.i + 1 : -2) : dir === 'u' ? cur.i - 2 : cur.i + 2;
      if (to === -2) focusTo(firstCard()); // 右边一列再往右：回到卡片
      else if (to >= 0 && to < n) focusTo({ z: 'slot', i: to });
    } else if (pop?.kind === 'slot') {
      // 在详情的「卖出」上按方向键：收起详情，回到那一格
      const i = pop.i;
      hidePop();
      focusTo({ z: 'slot', i });
    }
  }
  const onKey = (ev: KeyboardEvent) => {
    if (gone() || !root.classList.contains('on') || closing || paused || !world) return;
    if (performance.now() < leaving) return; // 已经点了出战：按键还给战斗（一出战就按空格，要能放出神通）
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const dir = DIRS[k];
    const press = k === 'Enter' || k === ' ' || k === 'j';
    const digit = /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
    const hot = k === 'l' || k === 'r' || k === 'f';
    if (!dir && !press && digit < 0 && !hot) return; // 别的键（Esc / P 暂停、Tab）照常
    // 这些键归万宝阁，不漏给战斗（方向键是移动，空格 / J 是神通）
    ev.stopPropagation();
    ev.preventDefault();
    if (ev.repeat) return; // 按住不放的不算（比如上一波按着方向键进来的）
    kb = true;
    const cur = focusNow();
    if (dir) return move(cur, dir);
    if (digit >= 0) {
      if (pop?.sticky) hidePop();
      return void focusTo({ z: 'card', i: digit });
    }
    // 刚打开 / 刚换了货 / 选中的按钮刚换了位置：先不接「按下」（按键按下去的时刻算，画面卡住时排着队的按键也拦得住）
    if ((ev.timeStamp || performance.now()) < guardUntil) return;
    if (press) {
      // 只按「已经选中」的按钮：什么都没选中时按空格 / 回车不做事。按下之后马上拦一小会儿——
      // 不等重画（画面卡的时候两下回车可能都落在重画之前，第二下会把同一个按钮再按一次）
      const a = document.activeElement as HTMLElement | null;
      if (a && a.tagName === 'BUTTON' && root.contains(a)) {
        a.click();
        guardUntil = Math.max(guardUntil, performance.now() + GUARD_MS);
      }
      return;
    }
    if (k === 'l') {
      if (cur?.z === 'card') (cards[cur.i]?.act.querySelector('.lock') as HTMLElement | null)?.click(); // 锁的是选中的那张卡
    } else if (k === 'r') (el.bar.querySelector('[data-act="reroll"], [data-act="rerollLevel"]') as HTMLElement | null)?.click();
    else (el.bar.querySelector('[data-act="ready"]') as HTMLElement | null)?.click();
  };
  // 空格在按钮上松开时浏览器会再点它一次：按下时已经处理过了，这里拦掉（松开事件本身照常传给战斗，免得按键卡住）
  const onKeyUp = (ev: KeyboardEvent) => {
    if (gone() || !root.classList.contains('on') || closing || paused) return;
    if (ev.key === ' ' && root.contains(document.activeElement)) ev.preventDefault();
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  root.addEventListener('focusin', () => {
    const f = focusNow();
    if (f) {
      focusWant = f;
      if (f.z === 'card') {
        lastCard = f.i;
        focusKey = cards[f.i]?.key ?? null;
      }
    }
  });
  /**
   * 重画之后把焦点还给同一格的按钮；那一格没了（买走 / 卖掉）就挪到旁边最近的一格，再没有就到底栏。
   * 焦点是界面自己挪的，所以接下来的一小会儿不接「按下」（连按两下回车，不会把下一件也买了）；
   * 商店里还是同一张卡、货也没变（只是锁上 / 解锁、钱够不够变了）时不用拦。
   */
  function restoreFocus() {
    if (!kb || !focusWant || closing) return;
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a) && (a as HTMLElement).offsetParent) return; // 焦点还在
    let f: Focus | null = focusWant;
    const same = mode === 'shop' && f.z === 'card' && !!elFor(f) && cards[f.i]?.key === focusKey;
    if (!elFor(f)) {
      const av = availableCards();
      const from = f.z === 'card' ? f.i : -1;
      const next = av.find((j) => j > from) ?? [...av].reverse().find((j) => j < from);
      f = f.z === 'sell' && pop?.kind === 'slot' ? { z: 'slot', i: pop.i } : next !== undefined ? { z: 'card', i: next } : barDefault();
    }
    if (!focusTo(f)) focusWant = null;
    else if (!same) guardUntil = performance.now() + GUARD_MS;
  }

  // ---------- 这一层不在了（回到标题时 feel.ts 把 #inter 拆掉）：把挂在窗口上的监听收干净 ----------
  function dispose() {
    removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    mo.disconnect();
    ro?.disconnect();
    ro = null;
    clearTimeout(armedTimer);
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  }
  function gone() {
    if (root.isConnected) return false;
    dispose();
    return true;
  }
  // feel.ts 结束一局时是直接把 #inter 从页面上拿掉的：一拿掉就收监听，不等下一次按键
  const mo = new MutationObserver(() => void gone());
  mo.observe(document.body, { childList: true });

  // ---------- 每帧 ----------
  function finishHide() {
    clearTimeout(closeTimer);
    closing = false;
    root.classList.remove('on', 'closing');
    mode = '';
    sig = '';
  }
  function open(p: Player) {
    root.classList.add('on');
    steps = [...(p.petOffer ? (['pet'] as Mode[]) : []), ...(p.techOffer ? (['tech'] as Mode[]) : []), ...(p.pendingLevels > 0 ? (['level'] as Mode[]) : []), 'shop'];
    tab = 'a';
    disarm();
    hidePop();
    lastLs = -1;
    lastRerolls = -1;
    lastLevelKey = '';
    lastTechKey = '';
    focusWant = null;
    kb = false;
    lastCard = 0;
    leaving = 0;
    guardUntil = performance.now() + 500; // 整屏淡入的这半秒不接回车和快捷键
    lastAct = { k: '', t: 0 };
    layoutDirty = true;
    root.classList.remove('open');
    void root.offsetWidth;
    root.classList.add('open');
    clearTimeout(openTimer);
    openTimer = window.setTimeout(() => root.classList.remove('open'), 1400);
  }

  function signature(w: World, p: Player) {
    return JSON.stringify([
      w.wave,
      w.cleared,
      p.lingshi,
      p.level,
      Math.floor(p.xp),
      Math.ceil(p.hp),
      p.pendingLevels,
      p.levelOffers,
      p.petOffer,
      p.techOffer,
      p.techs,
      p.pet.stage,
      p.pet.branch,
      p.shop,
      p.locked,
      p.weapons.map((x) => [x.kind, x.tier, x.spirit]),
      p.frags,
      p.relics,
      p.charms,
      p.stats,
      p.rerolls,
      tab,
      armed,
      pop?.kind === 'slot' && pop.sticky ? pop.i : -1,
    ]);
  }

  /** 底栏左边：一句提示；下面一行小字——有键盘的设备上是按键说明，触屏上是「点哪里看详情」。 */
  const barNote = (hint: string, dim: boolean, n: number, verb: string, shop = false) => {
    const kg = (html: string) => `<span class="kg">${html}</span>`;
    const keys = kg(`${keycap('←')}${keycap('→')}${n > 1 ? `或 ${keycap('1')}–${keycap(String(n))}` : ''}选卡`) + kg(`${keycap('回车')}${verb}`) + (shop ? kg(`${keycap('↑')}详情`) + kg(`${keycap('L')}锁定`) : '');
    return `<div class="note"><span class="nh${dim ? ' dim' : ''}">${hint}</span><span class="nk">${keys}</span>${shop ? '<span class="nt2">点选卡片或法宝格，查看详情</span>' : ''}</div>`;
  };

  function renderShop(w: World, p: Player) {
    const rerolled = lastRerolls >= 0 && p.rerolls !== lastRerolls;
    lastRerolls = p.rerolls;
    let k = 0;
    p.shop.forEach((o, i) => {
      const c = cards[i];
      if (!c) return;
      const key = offerKey(o);
      if (o) {
        const v = offerView(p, o, i);
        // 换了货（刷新、下一波进货）就让新货重新摆上来；锁住的格子不动，一眼看出锁住了
        if (c.key !== null && (c.key !== key || (rerolled && !p.locked[i]))) playCard(c, 'swap', k++ * 80);
        c.icon = offerIcon(o);
        c.offer = o;
        setCard(c, v, `t${v.tier} ${v.cls}`);
      } else {
        // 空格：买走的写「已售」；器灵二选一里没选的那个（另一个觉醒之后它随之下架）写「未选」
        const prev = c.offer;
        const had = prev?.cat === 'spirit' ? p.weapons.find((x) => x.kind === prev.kind) : null;
        const passed = prev?.cat === 'spirit' && !!had?.spirit && had.spirit !== prev.spirit;
        setCard(c, soldView(c.key ? c.icon : null, passed ? '未选' : '已售'), 'sold');
        c.icon = null;
      }
      c.key = key;
    });
    // 有一张写不下「购买 + 价钱」，这一排就都只写「买」（各卡的按钮写法一致）
    el.cards.classList.toggle('tight', cards.some((c) => c.tight));
    const rp = rerollCost(w, p); // 修为「利市」「玄坛赐福」（sim/xiuwei.ts）；功法「五鬼搬运」前几次免费（sim/techniques.ts）
    set(
      el.bar,
      barNote('锁定之货，刷新与下一波皆保留', true, cards.length, '购买', true) +
        `<button class="reroll" data-act="reroll" aria-disabled="${p.lingshi < rp}"><span class="bl">刷新</span>${rp ? `${gem()}<span class="pr">${rp}</span>` : '<span class="pr">免费</span>'}${keycap('R')}</button>` +
        `<button class="ready" data-act="ready"><span class="bl">出战</span>${keycap('F')}</button>`,
    );
  }

  function renderLevel(p: Player) {
    // 选完一项（还剩几次变了）或换了一批：新的一组重新摆上来。键盘上紧接着的回车不算——新的一组可能碰巧和上一组
    // 某一格一样，按钮没换就不会走 restoreFocus 的拦法，这里直接拦（免得连按两下回车选了两项）
    const key = JSON.stringify([p.pendingLevels, p.levelOffers]);
    const changed = lastLevelKey !== '' && key !== lastLevelKey;
    lastLevelKey = key;
    if (changed && kb) guardUntil = performance.now() + GUARD_MS;
    p.levelOffers.forEach((o, i) => {
      const c = cards[i];
      if (!c) return;
      const v = statView(p, o, i);
      if (changed) playCard(c, 'swap', i * 80);
      setCard(c, v, `t${v.tier} k-stat`);
      c.key = v.key;
    });
    const cost = 2 + p.level;
    set(
      el.bar,
      barNote(`选一项属性${p.pendingLevels > 1 ? ` · 还有 ${p.pendingLevels} 次` : ''}`, false, cards.length, '选定') +
        `<button class="reroll" data-act="rerollLevel" aria-disabled="${p.lingshi < cost}"><span class="bl">换一批</span>${gem()}<span class="pr">${cost}</span>${keycap('R')}</button>`,
    );
  }

  /** 悟功法：三张卡（和进化卡、升级卡同一套样式），选一门；一波跨过两个门槛时悟完一门再出下一组。 */
  function renderTech(p: Player) {
    (p.techOffer ?? []).forEach((id, i) => {
      const c = cards[i];
      if (!c) return;
      const v = techView(p, id, i);
      setCard(c, v, 't0 k-tech');
      c.key = v.key;
    });
    const left = techDue(p);
    set(el.bar, barNote(`悟一门功法，本局常驻${left > 1 ? ` · 还有 ${left} 门` : ''}`, false, cards.length, '选定'));
  }

  function renderPet(p: Player) {
    (p.petOffer ?? []).forEach((b, i) => {
      const c = cards[i];
      if (!c) return;
      const v = petView(p, b, i);
      setCard(c, v, `t0 k-pet`);
      c.key = v.key;
    });
    set(el.bar, barNote(p.pet.branch ? `${HEROES[p.hero].pet}循此路再进化一次` : '二路择一，此后循之进化', false, cards.length, '选定'));
  }

  /**
   * 名册里要量着排的几块：五行加成放不下就少写几行；宠物、功法的说明放不下就按行截短（截短的带提示）；
   * 行囊（灵物很多、或者手机上「属性」那一页）放不下就把多出来的图标收进一枚「+N」（提示里列出收起的那些）。
   */
  function fitRoster(p: Player) {
    const full = wuxingHtml(p, 5);
    const key = `${layoutGen}|${tab}|${full}|${shown.get(el.techs[0]) ?? ''}|${shown.get(el.slots) ?? ''}`;
    if (key !== rosterKey) {
      rosterKey = key;
      let mb = 5;
      set(el.wx, full);
      // 加成一行行少写；都去掉了还放不下（竖屏的名册矮），最后连「差」那一行也不写（-1）
      while (mb > -1 && el.pa.scrollHeight - el.pa.clientHeight > 1) set(el.wx, wuxingHtml(p, --mb));
    }
    const pb = el.bag.closest('.page') as HTMLElement;
    const bkey = `${layoutGen}|${tab}|${shown.get(el.bag) ?? ''}|${shown.get(el.pets[0]) ?? ''}`;
    if (bkey !== bagKey && pb.offsetParent) {
      bagKey = bkey;
      el.bag.innerHTML = shown.get(el.bag) ?? ''; // 收起过的图标先全摆回来再量
      const pet = el.pets.find((x) => pb.contains(x) && x.offsetParent) ?? null; // 两列时宠物在「属性」那一栏底下
      const pageFits = () => pb.scrollHeight - pb.clientHeight <= 1;
      const petFits = () => !pet || pet.scrollHeight - pet.clientHeight <= 1;
      if (pet) {
        // 两列：灵物先收到两行，给宠物留地方；宠物的说明再按行截短；还放不下才接着收
        const pds = [...pet.querySelectorAll('.pd')] as HTMLElement[];
        unclamp(pds);
        const its = el.bag.querySelector('.its') as HTMLElement;
        const it = its.querySelector('.it') as HTMLElement | null;
        const two = it ? it.offsetHeight * 2 + (parseFloat(getComputedStyle(its).rowGap) || 0) + 1 : Infinity;
        collapseBag(() => petFits() || its.offsetHeight <= two);
        clampToFit(pet, pds);
        collapseBag(() => petFits() && pageFits());
      }
      collapseBag(pageFits);
    }
    for (const pet of el.pets) if (pet.offsetParent) clampToFit(pet, [...pet.querySelectorAll('.pd')] as HTMLElement[]);
    if (el.tknotes.offsetParent) clampToFit(el.tknotes, [...el.tknotes.querySelectorAll('.tn')] as HTMLElement[]);
  }

  /** 行囊的图标从后往前收进「+N」，直到 fits()；每次收图标最多的那一类，每类至少留一个。 */
  function collapseBag(fits: () => boolean) {
    const rows = [...el.bag.querySelectorAll('.its')] as HTMLElement[];
    for (let guard = 0; guard < 40 && !fits(); guard++) {
      const vis = rows.map((r) => [...r.querySelectorAll('.it:not(.mo):not(.off)')] as HTMLElement[]);
      let k = -1;
      vis.forEach((v, j) => {
        if (v.length > 1 && (k < 0 || v.length > vis[k].length)) k = j;
      });
      if (k < 0) return;
      const row = rows[k];
      let chip = row.querySelector('.mo') as HTMLElement | null;
      // 「+N」自己也占一格：第一次收两个才腾得出地方
      const n = chip ? 1 : Math.min(2, vis[k].length - 1);
      for (let m = 1; m <= n; m++) vis[k][vis[k].length - m].classList.add('off');
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'it mo';
        row.appendChild(chip);
      }
      const off = [...row.querySelectorAll('.it.off')] as HTMLElement[];
      chip.textContent = `+${off.length}`;
      chip.dataset.tip = `还有 ${off.length} 样：${off.map((e) => e.dataset.nm).join('、')}`;
    }
  }

  return {
    get open() {
      return root.classList.contains('on') && !closing;
    },
    /** 收起（出战）：淡出约 0.4 秒，期间不再接点击和按键，战斗画面从底下露出来。 */
    hide() {
      if (!root.classList.contains('on') || closing) return;
      closing = true;
      root.classList.remove('open');
      root.classList.add('closing');
      hidePop();
      disarm();
      focusWant = null;
      // 焦点不留在正在淡出的按钮上：一出战就按空格，要能放出神通
      const a = document.activeElement as HTMLElement | null;
      if (a && root.contains(a)) a.blur();
      closeTimer = window.setTimeout(finishHide, 420);
    },
    /** 这一局结束、界面拆掉时调用（不调也行：#inter 被移出页面后，监听会自己收掉）。 */
    dispose,
    /** 按当前状态重画（内容没变就不动 DOM）。 */
    render(w: World, idx = 0) {
      me = idx;
      world = w;
      const p = w.players[idx];
      if (closing) finishHide(); // 收起途中又进了商店（不会发生，保险）
      if (!root.classList.contains('on')) open(p);
      fit();
      const s = signature(w, p);
      if (s === sig) return;
      sig = s;
      const m: Mode = p.petOffer ? 'pet' : p.techOffer ? 'tech' : p.pendingLevels > 0 ? 'level' : 'shop';
      // 一波跨过两个门槛时悟两门：第二组三选一换上来，卡片重新入场
      // 一波跨过两个宠物进化门槛时接连进化两次（sim/shop.ts 的 petEvolveOffer）：第二次只剩已选的那条路，卡片也要重摆
      const techKey = m === 'tech' ? JSON.stringify(p.techOffer) : m === 'pet' ? `pet${p.pet.stage}` : '';
      if (m !== mode || techKey !== lastTechKey) {
        mode = m;
        lastTechKey = techKey;
        if (!steps.includes(m)) steps = MODES.filter((x) => x === m || steps.includes(x));
        buildCards(m === 'pet' ? (p.petOffer?.length ?? 0) : m === 'tech' ? (p.techOffer?.length ?? 0) : m === 'level' ? p.levelOffers.length : p.shop.length);
        lastRerolls = -1;
        lastLevelKey = '';
        // 换了一步（升级 → 商店）：不把「选中」带过去，免得顺手多按一下回车就买了东西；这一步要重新选
        focusWant = null;
        lastCard = 0;
        stepAt = performance.now();
        guardUntil = stepAt + GUARD_MS;
      }
      // 横梁：章节、步骤、灵石。章节名放不下（手机上四步都有时）就去掉最前面的「第几章」
      const stepsHtml = steps.map((x, i) => `<span class="${x === m ? 'cur' : i < steps.indexOf(m) ? 'done' : ''}">${STEP_NAME[x]}</span>`).join('<i></i>');
      set(el.steps, stepsHtml);
      const chap = CHAPTER_NAME[w.cleared || chapterOf(w.wave)];
      const title = w.cleared ? `${chap} · 平定` : `${chap} · 第 ${waveInChapter(w.wave)} 波 · 平定`;
      const tkey = `${layoutGen}|${title}|${stepsHtml}|${String(p.lingshi).length}`;
      if (tkey !== titleKey) {
        titleKey = tkey;
        set(el.title, title);
        const parts = title.split(' · ');
        if (parts.length > 2 && el.title.scrollWidth > el.title.clientWidth + 1) set(el.title, parts.slice(1).join(' · '));
      }
      if (lastLs >= 0 && p.lingshi !== lastLs) {
        const d = document.createElement('span');
        const diff = p.lingshi - lastLs;
        d.className = `delta${diff > 0 ? ' up' : ''}`;
        d.textContent = `${diff > 0 ? '+' : ''}${diff}`;
        el.ls.appendChild(d);
        setTimeout(() => d.remove(), 1200);
        el.lsNum.classList.remove('flash');
        void el.lsNum.offsetWidth;
        el.lsNum.classList.add('flash');
      }
      lastLs = p.lingshi;
      el.lsNum.textContent = String(p.lingshi);
      // 左侧
      set(el.hero, heroHtml(p));
      for (const x of ['a', 'b', 'c', 'd']) root.classList.toggle(`tab-${x}`, tab === x);
      el.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      set(el.slots, slotsHtml(p, pop?.kind === 'slot' && pop.sticky ? pop.i : -1));
      set(el.stats, statsHtml(p));
      const ph = petHtml(p);
      el.pets.forEach((x) => set(x, ph));
      const th = techsHtml(p);
      el.techs.forEach((x) => set(x, th));
      set(el.tknotes, techNotesHtml(p));
      set(el.bag, bagHtml(p));
      fitRoster(p);
      // 右侧
      if (m === 'shop') renderShop(w, p);
      else if (m === 'level') renderLevel(p);
      else if (m === 'tech') renderTech(p);
      else renderPet(p);
      // 开着的详情跟着状态更新（待确认卖出、价钱）；重画之后把键盘的焦点还回去
      if (pop) drawPop();
      restoreFocus();
    },
  };
}
