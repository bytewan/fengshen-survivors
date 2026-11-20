// 成就弹窗（用户 11-12：「在达成成就的时候会在右上角出一个成就弹窗」；样子 暂拟，待评审确认）。
// 一笔横着的浓墨（像素画，art/title.ts 的 makeInkStroke，左右翻过来：笔锋在右、飞白往左散开），右端压一方朱印（白文「成就」），
// 墨上写成就名（书法体）、一句说明、奖励。不画框、不画光圈：墨痕本身就是底。
// 出现：墨从右往左刷出来、整块略往左滑进，朱印随后「盖」下去；停 SHOW.hold 秒；淡出时往右退一点。同时达成几个就排队，一个一个出。
// 位置：画面矩形的右上角，往下让开右上角已有的东西（战斗界面右上那组斩敌 / 灵石、连斩字、万宝阁的顶栏），手机上摆在暂停钮的左边；
// 竖屏时画面在窗口中间，弹窗贴着窗口顶（安全区以内），不压画面。整层不接点击（pointer-events: none），不挡按钮。
// 标题页、选角、商店、局里都是这一层（z-index 比各个界面都高）。
import { makeInkStroke, makeSeal } from '../art/title.ts';
import { FONT_TEXT, FONT_TITLE } from './fonts.ts';
import { C, bitmapUrl, injectCss, isCompact, isTall, mountLayer, snapPx, uiSfx, type Layer, type UiFit } from './front-ui.ts';
import { rewardText, type AchDef } from './achievements.ts';

/** 节奏（秒）：刷出来、停、淡出。 */
export const SHOW = { in: 0.55, hold: 3.5, out: 0.85 };

const CSS = `
#fs-ach { pointer-events: none; }
#fs-ach .ach { position: absolute; width: var(--aw); height: var(--ah); font-family: ${FONT_TEXT}; color: ${C.yuebai}; }
#fs-ach .ach .ac-ink { position: absolute; inset: 0; background: var(--ink) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; transform: scaleX(-1); opacity: .94;
  -webkit-mask-image: linear-gradient(270deg, transparent, #000 18%); mask-image: linear-gradient(270deg, transparent, #000 18%); } /* 飞白那头（翻过来在左）淡进底色，不留硬边 */
#fs-ach .ach .ac-seal { position: absolute; right: var(--sr); top: calc(50% - var(--ss) / 2); width: var(--ss); height: var(--ss); background: var(--seal) 0 0 / 100% 100% no-repeat; image-rendering: pixelated;
  display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: ${FONT_TITLE}; font-size: 1em; line-height: 1.02; color: ${C.yuebai}; }
#fs-ach .ach .ac-tx { position: absolute; right: calc(var(--sr) + var(--ss) + .7em); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: flex-end; text-align: right; white-space: nowrap; }
#fs-ach .ach .ac-nm { font-family: ${FONT_TITLE}; font-size: 1.45em; line-height: 1.15; letter-spacing: .1em; margin-right: -.1em; color: ${C.xiang}; text-shadow: 0 .06em 0 ${C.zhe}; }
#fs-ach .ach .ac-ds { font-size: .86em; line-height: 1.45; color: ${C.gao}; letter-spacing: .03em; }
#fs-ach .ach .ac-rw { font-size: .86em; line-height: 1.45; color: ${C.teng}; letter-spacing: .03em; }
@media (prefers-reduced-motion: reduce) { #fs-ach .ach * { animation: none !important; } }
`;

let layer: Layer | null = null;
const queue: AchDef[] = [];
let busy = false;
/** 正在显示的那一块（窗口变了要重新摆）。 */
let cur: { el: HTMLElement; place: (f: UiFit) => void } | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 弹出这些成就（排在已经在排队的后面）。 */
export function showAchievements(defs: readonly AchDef[]) {
  queue.push(...defs);
  if (!busy) void run();
}

async function run() {
  busy = true;
  try {
    while (queue.length) await showOne(queue.shift()!);
  } finally {
    busy = false;
    cur = null;
    layer?.dispose();
    layer = null;
  }
}

/** 右上角要让开的东西（看得见的才算）。 */
const OBSTACLES = ['#hud .trw', '#hud .combo', '#inter .beam'];

function visibleRect(sel: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  }
  return r;
}

function showOne(d: AchDef): Promise<void> {
  injectCss('fs-ach', CSS);
  layer ??= mountLayer('fs-ach', 12);
  const L = layer;
  const el = document.createElement('div');
  el.className = 'ach';
  el.setAttribute('role', 'status');
  el.innerHTML = `<i class="ac-ink"></i><div class="ac-tx"><b class="ac-nm"></b><span class="ac-ds"></span>${d.reward ? '<span class="ac-rw"></span>' : ''}</div><i class="ac-seal"><b>成</b><b>就</b></i>`;
  (el.querySelector('.ac-nm') as HTMLElement).textContent = d.name;
  (el.querySelector('.ac-ds') as HTMLElement).textContent = d.desc;
  if (d.reward) (el.querySelector('.ac-rw') as HTMLElement).textContent = rewardText(d.reward);
  L.ui.appendChild(el);
  const tx = el.querySelector('.ac-tx') as HTMLElement;

  // 量好字的宽，墨按格子现画一笔（宽 = 字 + 朱印 + 两头留的笔锋和飞白），朱印也按格子画
  let painted = '';
  const place = (f: UiFit) => {
    // 手机横屏（紧版面）上整块收小两成：画面矮，弹窗别盖住半个战场
    const k = isCompact(f) ? 0.8 : 1;
    el.style.fontSize = `${k}em`;
    const em = f.base * k;
    const cells = (v: number) => Math.max(2, Math.round(v / f.p));
    const ss = cells(em * 2.5) * f.p; // 朱印的边长
    const sr = cells(em * 1.1) * f.p; // 朱印离右端（笔锋那头）
    const textW = tx.getBoundingClientRect().width;
    const maxW = f.w - f.safe.left - f.safe.right - em;
    const aw = Math.min(maxW, cells(textW + ss + sr + em * 0.7 + em * 4) * f.p); // 左边留出飞白的那一截（字不压在飞白上）
    const ah = cells(Math.max(em * 4.2, tx.getBoundingClientRect().height + em * 1.1)) * f.p;
    const key = `${aw}x${ah}@${f.p}`;
    if (key !== painted) {
      painted = key;
      el.style.setProperty('--ink', `url("${bitmapUrl(makeInkStroke(Math.round(aw / f.p), Math.round(ah / f.p), 77 + (d.id.length * 13) % 50, 'ink', 0.16, 0.1))}")`);
      el.style.setProperty('--seal', `url("${bitmapUrl(makeSeal(Math.round(ss / f.p), Math.round(ss / f.p), 5 + d.id.length))}")`);
    }
    el.style.setProperty('--aw', `${aw}px`);
    el.style.setProperty('--ah', `${ah}px`);
    el.style.setProperty('--ss', `${ss}px`);
    el.style.setProperty('--sr', `${sr}px`);
    // 右上角：画面矩形的右上（竖屏贴窗口顶），往下让开右上角已有的东西
    const fr = f.frame;
    const tall = isTall(f);
    let right = Math.min(fr.left + fr.width, f.w - f.safe.right) - em * 0.4;
    let top = (tall ? f.safe.top : Math.max(fr.top, f.safe.top)) + em * 0.5;
    // 手机上右上角的暂停钮：弹窗摆在它左边（不往下让：竖屏时下面紧挨着战斗界面的波次）；左边放不下（万宝阁里暂停钮在顶栏中间）才往下让
    const pb = visibleRect('#fs-pause .pbtn');
    if (pb && pb.left < right && pb.top < f.h * 0.3) {
      if (pb.left - em * 0.3 - aw >= f.safe.left + em * 0.3) right = pb.left - em * 0.3;
      else top = Math.max(top, pb.bottom + em * 0.25);
    }
    const left = right - aw;
    // 页面自己要求的最低位置（data-ach-top：标题页天上那幅榜的下沿）
    for (const e of document.querySelectorAll<HTMLElement>('[data-ach-top]')) if (e.isConnected && getComputedStyle(e).display !== 'none') top = Math.max(top, Number(e.dataset.achTop) || 0);
    for (const sel of OBSTACLES) {
      const r = visibleRect(sel);
      if (r && r.right > left && r.left < right && r.top < top + ah && r.bottom > top - em) top = Math.max(top, r.bottom + em * 0.25);
    }
    el.style.left = `${snapPx(left, f)}px`;
    el.style.top = `${snapPx(top, f)}px`;
  };
  place(L.fit);
  cur = { el, place };
  L.onFit = (f) => cur?.place(f);

  const ink = el.querySelector('.ac-ink') as HTMLElement;
  const seal = el.querySelector('.ac-seal') as HTMLElement;
  const ms = (s: number) => s * 1000;
  // 进来：墨从右往左刷开（ink 翻过来了，所以裁的是它自己的左边 → 屏幕上的右边先出来），整块略往左滑；朱印随后盖下去；字淡入
  el.animate([{ opacity: 0, transform: 'translateX(1.2em)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: ms(SHOW.in), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
  ink.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: ms(SHOW.in + 0.15), easing: 'cubic-bezier(.3,.6,.2,1)', fill: 'both' });
  tx.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: ms(SHOW.in * 0.5), easing: 'ease-out', fill: 'both' });
  seal.animate(
    [
      { opacity: 0, transform: 'scale(1.35) rotate(-6deg)' },
      { opacity: 1, transform: 'scale(.96) rotate(0deg)', offset: 0.7 },
      { opacity: 1, transform: 'scale(1) rotate(0deg)' },
    ],
    { duration: 380, delay: ms(SHOW.in * 0.55), easing: 'ease-out', fill: 'both' },
  );
  try {
    uiSfx().play('ui.levelup');
  } catch {
    /* 音频没起来无妨 */
  }
  return (async () => {
    await sleep(ms(SHOW.in + SHOW.hold));
    await el.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(.8em)' }], { duration: ms(SHOW.out), easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
    el.remove();
    await sleep(180);
  })();
}

/** 调试 / 截图：不写存档，只弹（window.__ach.demo()）。 */
export function demoToasts(defs: readonly AchDef[]) {
  showAchievements(defs);
}
