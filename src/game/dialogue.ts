// 对白（DOM，叠在画布的矩形上）：画面下方一条半透明的对白框——书法体名字牌、文楷正文、说话人的像素头像，
// 打字机效果；点击 / 空格 / 回车推进（正在打字时先把这一句打完），右上角的小签可以跳过。旁白没有名字牌和头像。
// 另有「解锁变异角色」的提示卡，和战斗中不打断战斗的对白气泡（跟着说话人，几秒后淡出）。台词本身在 story.ts。
//
// 字（用户 2026-11-10）：楷书一路——名字、解锁的角色名用书法体 var(--font-title)，其余用 var(--font-text)；
// 字号是 uiBaseFontPx(画布矩形高度) 的倍数（这一层的 font-size 就是它，里面用 em；见 canvas-overlay.ts）。
// 不要「框」：墨底四边都是软的（左右渐隐、上下羽化，见 ink-band.ts），收边的细金线压在羽化区里面。
// 看不见的时候不接指针事件：对白框、跳过、提示卡只有显示出来才点得到，平时点的是底下的战场（摇杆）。
// 这一层叠在万宝阁上面（z-index 6 > 5）：透明的对白框要是接点击，就会挡住万宝阁底下那一排按钮（用户 2026-11-10「选择奖励点不动」）。
// 改这里之后跑 node tools/click-probe.mjs 体检。
import { dialogueBelow, followCanvas } from './canvas-overlay.ts';
import { FONT_TEXT, FONT_TITLE } from './fonts.ts';
import { band, featherCss, hairlinesCss } from './ink-band.ts';
import { PALETTE } from '../art/palette.ts';
import type { Grid } from '../art/pixel.ts';
import type { Sfx } from '../audio/sfx.ts';

export interface Line {
  who: string | null; // null = 旁白
  text: string;
  face?: Grid; // 说话人的像素头像
  color?: string; // 名字牌的颜色
  cue?: string; // 这一句出现时交给调用方的画面提示
}

const DARK = '20,15,25';
const GOLD = '224,168,58';
/** 气泡的尖：从气泡的羽化区里长出来。尖和羽化的墨底叠在一起的那一截按墨底的浓淡补齐，叠起来处处一样浓（a）。 */
const BUB_F = 0.28; // 气泡上下羽化的高度（em）
const tipFill = (a: number, dir: 'down' | 'up') => {
  const n = 6;
  const stops: string[] = [];
  for (let i = 0; i <= n; i++) {
    const m = 0.5 + 0.5 * Math.cos((Math.PI * i) / n); // 这一处墨底的遮罩：1 → 0
    const b = a * m;
    const t = Math.max(0, (a - b) / (1 - b));
    stops.push(`rgba(${DARK},${t.toFixed(3)}) calc(${BUB_F}em * ${(i / n).toFixed(2)})`);
  }
  return `linear-gradient(${dir === 'down' ? '180deg' : '0deg'}, ${stops.join(', ')}, rgba(${DARK},${a}))`;
};

const CSS = `
#dlg { position: fixed; pointer-events: none; z-index: 6; font-family: ${FONT_TEXT}; font-size: 16px; line-height: 1.2; font-weight: normal; font-synthesis: none; color: #f2e8d5; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
#dlg * { box-sizing: border-box; }

#dlg .box { position: absolute; left: 3%; right: 3%; bottom: 5%; isolation: isolate; cursor: pointer; opacity: 0; transform: translateY(6%); transition: opacity .45s ease-out, transform .45s ease-out; }
#dlg .box.on { opacity: 1; transform: none; pointer-events: auto; }
/* 竖屏（画布下面空出一大块，canvas-overlay.ts 的 dialogueBelow）：对白框放到画布下面的空处，不压画面；「跳过」照旧贴在框的右上方 */
#dlg.below .box { top: calc(100% + .7em); bottom: auto; left: 2%; right: 2%; }
#dlg .box::before, #dlg .box::after { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; }
#dlg .box::before { background: ${band(DARK, 0.86, 11)}; ${featherCss('.45em')} }
#dlg .box::after { ${hairlinesCss(GOLD, 0.65, '.45em', '5%', 22)} }
#dlg .row { display: flex; align-items: center; gap: .9em; padding: .82em 8% .95em; }
#dlg canvas { display: block; flex: none; image-rendering: pixelated; image-rendering: crisp-edges; }
#dlg .faceSlot:empty { display: none; }
#dlg .faceSlot canvas { opacity: .96; }
#dlg .col { flex: 1; min-width: 0; min-height: 5.4em; display: flex; flex-direction: column; justify-content: center; }
#dlg .who { font-family: ${FONT_TITLE}; font-size: 1.4em; line-height: 1.15; letter-spacing: .18em; margin-bottom: .15em; white-space: nowrap; text-shadow: 0 .05em 0 #1a1520; }
#dlg .txt { font-size: 1.15em; line-height: 1.55; letter-spacing: .04em; white-space: pre-wrap; text-wrap: balance; text-shadow: 0 .06em 0 #1a1520; }
#dlg .who + .txt { min-height: 3.1em; }
#dlg .txt.narr { color: #d5c8b6; }
#dlg .txt .rest { visibility: hidden; }
/* 「这一句说完了」的小三角：自己画，不靠字体里有没有这个符号。不占行宽（右边距抵掉自己的宽），
   一行字刚好排满时它探进右边的留白里，不会自己折到下一行、把对白框撑高一截 */
#dlg .txt i { display: inline-block; width: .56em; height: .4em; margin: 0 -.96em 0 .4em; vertical-align: .08em; background: #e0a83a; clip-path: polygon(0 0, 100% 0, 50% 100%); animation: dlgblink 1.1s steps(2) infinite; }
@keyframes dlgblink { 50% { opacity: 0; } }
/* 跳过：和对白框同底的小签，贴在框的右上方（压着框上沿的羽化）；手机上够大好点 */
#dlg .skip { position: absolute; right: 8%; bottom: calc(100% - .1em); display: flex; align-items: center; justify-content: center; min-height: max(2.1em, 32px); padding: 0 1.6em; letter-spacing: .14em; text-indent: .14em; white-space: nowrap; color: #e6dac6; cursor: pointer; background: ${band(DARK, 0.82, 24)}; ${featherCss('.32em')} text-shadow: 0 .06em 0 #1a1520; }
#dlg .skip::after { content: ''; width: .34em; height: .56em; margin-left: .5em; background: currentColor; clip-path: polygon(0 0, 100% 50%, 0 100%); opacity: .85; }
#dlg .skip:hover { color: #fff3d6; }
@media (pointer: coarse) { #dlg .skip { min-height: max(2.4em, 40px); padding: 0 1.9em; } }

#dlg .bub { position: absolute; left: 0; top: 0; isolation: isolate; width: max-content; max-width: calc(var(--w, 100vw) * .9); opacity: 0; transition: opacity .35s ease-out; font-size: 1.05em; line-height: 1.4; letter-spacing: .05em; white-space: pre-wrap; text-wrap: balance; text-align: center;
  padding: .36em 1.6em .44em; text-shadow: 0 .06em 0 #1a1520; }
#dlg .bub.on { opacity: 1; }
#dlg .bub::before { content: ''; position: absolute; inset: 0; z-index: -1; background: ${band(DARK, 0.8, 16)}; ${featherCss(`${BUB_F}em`)} }
/* 尖：底边藏在气泡下沿的羽化里，露出来的部分宽 .8em、高 .4em */
#dlg .bub::after { content: ''; position: absolute; left: var(--tip, 50%); top: calc(100% - ${BUB_F}em); width: 1.36em; height: ${BUB_F + 0.4}em; margin-left: -.68em; background: ${tipFill(0.8, 'down')}; clip-path: polygon(0 0, 100% 0, 50% 100%); }
#dlg .bub.below::after { top: auto; bottom: calc(100% - ${BUB_F}em); background: ${tipFill(0.8, 'up')}; clip-path: polygon(50% 0, 100% 100%, 0 100%); }

#dlg .card { position: absolute; left: 0; right: 0; top: 20%; display: flex; justify-content: center; opacity: 0; transition: opacity .6s ease-out; cursor: pointer; }
#dlg .card.on { opacity: 1; pointer-events: auto; }
#dlg .card .band { position: relative; padding: 1em 5.5em 1.2em; text-align: center; background: ${band(DARK, 0.88, 22)}; ${featherCss('.5em')} }
#dlg .card .band::before { content: ''; position: absolute; inset: 0; pointer-events: none; ${hairlinesCss(GOLD, 0.75, '.5em', '8%', 25)} }
#dlg .card .pic canvas { margin: 0 auto .25em; }
#dlg .card .lbl { font-size: 1.05em; letter-spacing: .3em; padding-left: .3em; white-space: nowrap; color: #d5c8b6; text-shadow: 0 .06em 0 #1a1520; }
#dlg .card .nm { font-family: ${FONT_TITLE}; font-size: 2.5em; line-height: 1.25; letter-spacing: .3em; padding-left: .3em; white-space: nowrap; color: #d9452b; text-shadow: 0 .05em 0 #1a1520; }
`;

/**
 * 把一张像素网格（或它的一块）画成 canvas：按原尺寸画，再用 CSS 放大到每格 scale 个 CSS 像素。
 * scale 取成整数个设备像素，放大之后每一格一样宽。
 */
function gridCanvas(g: Grid, scale: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = g.w;
  cv.height = g.h;
  const ctx = cv.getContext('2d')!;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const ch = g.rows[y]?.[x];
      if (!ch || ch === '.' || ch === ' ') continue;
      ctx.fillStyle = PALETTE[ch];
      ctx.fillRect(x, y, 1, 1);
    }
  const dpr = window.devicePixelRatio || 1;
  const s = Math.max(1, Math.round(scale * dpr)) / dpr;
  cv.style.width = `${g.w * s}px`;
  cv.style.height = `${g.h * s}px`;
  return cv;
}

export function mountDialogue(sfx?: Sfx) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'dlg';
  el.innerHTML = `<div class="box"><div class="skip">跳过</div><div class="row"><div class="faceSlot"></div><div class="col"><div class="who"></div><div class="txt"></div></div></div></div><div class="card"><div class="band"><div class="pic"></div><div class="lbl"></div><div class="nm"></div></div></div><div class="bub"></div>`;
  document.body.appendChild(el);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const box = $('.box');
  const who = $('.who');
  const txt = $('.txt');
  const faceSlot = $('.faceSlot');
  const skip = $('.skip');
  const card = $('.card');
  const cardPic = $('.card .pic');
  const bub = $('.bub');

  let lines: Line[] = [];
  let idx = -1;
  let shown = 0; // 这一句打出了几个字
  let acc = 0;
  let timer: number | null = null;
  let auto = false;
  let autoT = 0;
  let done: (() => void) | null = null;
  let onLine: ((l: Line, i: number) => void) | null = null;
  let blipN = 0;
  const CPS = 18; // 每秒打几个字
  // 气泡：大小只在换字或画布变了的时候量，位置变了才写
  let bubOn = false;
  let bubUntil = 0;
  let bubW = 0;
  let bubH = 0;
  let bubLast = '';
  let cardArt: Grid | null = null;

  const face = () => {
    const l = lines[idx];
    faceSlot.textContent = '';
    if (l?.face) faceSlot.append(gridCanvas(l.face, follower.fit.base * 0.21)); // 头像约三行字高
  };
  const art = () => {
    cardPic.textContent = '';
    // 解锁的角色立绘：跟着字号走，但不超过画面高度的三成（矮的画面上卡片不出框）
    if (cardArt) cardPic.append(gridCanvas(cardArt, Math.min(follower.fit.base * 0.25, (follower.fit.height * 0.3) / cardArt.h)));
  };
  const measureBubble = () => {
    bubW = bub.offsetWidth;
    bubH = bub.offsetHeight;
    bubLast = '';
  };
  const follower = followCanvas(
    el,
    (f) => {
      el.classList.toggle('below', dialogueBelow(f));
      if (lines.length) face();
      if (cardArt) art();
      if (bubOn) measureBubble();
    },
    // 这一层被移出页面（一局拆掉）：停掉打字机、摘掉按键监听
    () => {
      if (timer !== null) cancelAnimationFrame(timer);
      timer = null;
      lines = [];
      removeEventListener('keydown', onKey, true);
      closeCard?.();
    },
  );

  // 没打出来的字也先排进去（只是看不见），这样换行位置从第一个字起就定了，打字时不会跳行
  const rest = document.createElement('span');
  rest.className = 'rest';
  const mark = document.createElement('i');
  const render = () => {
    const l = lines[idx];
    if (!l) return;
    const full = shown >= l.text.length;
    txt.textContent = l.text.slice(0, shown);
    rest.textContent = l.text.slice(shown);
    txt.append(rest);
    if (full) txt.append(mark);
  };
  const showLine = (i: number) => {
    idx = i;
    shown = 0;
    acc = 0;
    autoT = 0;
    const l = lines[i];
    who.textContent = l.who ?? '';
    who.style.display = l.who ? '' : 'none';
    who.style.color = l.color ?? '#f2e8d5';
    txt.classList.toggle('narr', !l.who);
    face();
    render();
    onLine?.(l, i);
  };
  const finish = () => {
    if (timer !== null) cancelAnimationFrame(timer);
    timer = null;
    box.classList.remove('on');
    removeEventListener('keydown', onKey, true);
    const d = done;
    done = null;
    lines = [];
    idx = -1;
    setTimeout(() => d?.(), 450);
  };
  const advance = () => {
    const l = lines[idx];
    if (!l) return;
    if (shown < l.text.length) {
      shown = l.text.length;
      render();
      return;
    }
    if (idx + 1 < lines.length) showLine(idx + 1);
    else finish();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!lines.length) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter' || k === 'j') {
      e.preventDefault();
      e.stopPropagation(); // 别让空格同时放出神通
      advance();
    } else if (k === 'escape') {
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
  };
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // 不漏给战场（不起摇杆）
    advance();
  });
  skip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // 也不算点了对白框
    finish();
  });
  let last = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    const l = lines[idx];
    if (l) {
      if (shown < l.text.length) {
        acc += dt * CPS;
        const before = shown;
        while (acc >= 1 && shown < l.text.length) {
          acc -= 1;
          shown++;
        }
        if (shown !== before) {
          render();
          if (++blipN % 2 === 0 && l.text[shown - 1] !== '…') sfx?.play('dialogue.blip', 0.5);
        }
      } else if (auto) {
        autoT += dt;
        if (autoT > 1.8) advance();
      }
    }
    if (lines.length) timer = requestAnimationFrame(tick);
  };

  // 解锁提示卡开着时的收起函数（重开一局时也要能收）
  let closeCard: (() => void) | null = null;

  return {
    get open() {
      return lines.length > 0;
    },
    /** 放一段对白，放完（或跳过）后 resolve。auto：自己往下翻（机器人模式截图用）。 */
    play(ls: Line[], opts: { auto?: boolean; onLine?: (l: Line, i: number) => void } = {}): Promise<void> {
      follower.refit();
      lines = ls;
      auto = !!opts.auto;
      onLine = opts.onLine ?? null;
      showLine(0);
      requestAnimationFrame(() => {
        if (lines.length) box.classList.add('on');
      });
      addEventListener('keydown', onKey, true);
      last = 0;
      timer = requestAnimationFrame(tick);
      return new Promise((res) => (done = res));
    },
    /** 立刻收起（重开一局时）。 */
    close() {
      if (lines.length) finish();
      closeCard?.();
      bub.classList.remove('on');
      bubOn = false;
      bubUntil = 0;
    },
    /** 战斗中的对白气泡：不打断战斗，seconds 秒后淡出。位置每帧用 bubbleAt 给。 */
    bubble(text: string, seconds = 3.6) {
      follower.refit();
      bub.textContent = text;
      bubUntil = performance.now() + seconds * 1000;
      bub.classList.add('on');
      bubOn = true;
      measureBubble();
    },
    /**
     * 气泡尖指着说话人：(x, top) 是头顶、(x, foot) 是脚底（游戏像素）。说话人太靠上时（会压到顶上的血条）改到脚下。
     * 说话人不在了就传 null，气泡提前淡出。
     */
    bubbleAt(x: number | null, top = 0, foot = top) {
      if (!bubOn) return;
      if (x === null || performance.now() > bubUntil) {
        bubOn = false;
        bub.classList.remove('on');
        return;
      }
      const { unit, base, width } = follower.fit;
      const pad = base * 0.45;
      const left = Math.round(Math.max(pad, Math.min(width - bubW - pad, x * unit - bubW / 2)));
      let y = Math.round(top * unit - bubH - base * 0.5);
      const below = y < base * 3.9; // 顶上是首领的名字和血条
      if (below) y = Math.round(foot * unit + base * 0.6);
      const tip = Math.round(Math.max(pad * 2, Math.min(bubW - pad * 2, x * unit - left)));
      const key = `${left},${y},${tip},${below}`;
      if (key === bubLast) return;
      bubLast = key;
      bub.classList.toggle('below', below);
      bub.style.setProperty('--tip', `${tip}px`);
      bub.style.transform = `translate(${left}px, ${y}px)`;
    },
    /** 「解锁变异角色」提示卡：淡入、停一会儿、淡出；点一下，或按空格 / 回车 / Esc 提前收起。 */
    unlockCard(label: string, name: string, picture?: Grid, seconds = 2.8): Promise<void> {
      follower.refit();
      cardArt = picture ?? null;
      art();
      $('.card .lbl').textContent = label;
      $('.card .nm').textContent = name;
      requestAnimationFrame(() => closeCard && card.classList.add('on'));
      return new Promise((res) => {
        const onCardKey = (e: KeyboardEvent) => {
          const k = e.key.toLowerCase();
          if (k !== ' ' && k !== 'enter' && k !== 'j' && k !== 'escape') return;
          e.preventDefault();
          e.stopPropagation(); // 别让空格同时放出神通
          if (!e.repeat) close();
        };
        const onCardDown = (e: PointerEvent) => {
          e.preventDefault();
          e.stopPropagation();
          close();
        };
        const close = () => {
          if (closeCard !== close) return;
          closeCard = null;
          clearTimeout(t);
          removeEventListener('keydown', onCardKey, true);
          card.removeEventListener('pointerdown', onCardDown);
          card.classList.remove('on');
          setTimeout(res, 600);
        };
        closeCard = close;
        const t = setTimeout(close, seconds * 1000);
        addEventListener('keydown', onCardKey, true);
        card.addEventListener('pointerdown', onCardDown);
      });
    },
    /** 摘掉监听（这一层被移出页面时也会自己摘，调不调都行）。 */
    dispose() {
      follower.dispose();
    },
  };
}
