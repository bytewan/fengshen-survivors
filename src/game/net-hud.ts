// 联机时叠在战斗画面上的一层（DOM）：队友的小血条、角上的一行联机状态（延迟、流量）、正中的提示
// （房主暂停了、房主掉线等他回来、接手房主、连接断了在重连……），以及万宝阁里「谁还没出战」。
// 单人时不挂。跟着画布矩形走（canvas-overlay.ts），字号同战斗界面；不接点击（pointer-events: none）。
// 字压在战场上：浅字加一圈墨色的软描边，不加底框（用户口径：不要「框」）；提示用的是四边都软的墨底（ink-band.ts）。
import { followCanvas, hudAbove } from './canvas-overlay.ts';
import { FONT_TEXT, FONT_TITLE } from './fonts.ts';
import { band, featherCss } from './ink-band.ts';

const INK = '26,21,32';

const CSS = `
#nethud { position: fixed; pointer-events: none; z-index: 8; font-family: ${FONT_TEXT}; font-size: 16px; line-height: 1.2; color: #f2e8d5; user-select: none; -webkit-user-select: none;
  --ol: 0 0 .09em rgba(${INK},.95), 0 0 .09em rgba(${INK},.95), 0 0 .2em rgba(${INK},.8), 0 .07em .1em rgba(${INK},.85); text-shadow: var(--ol); }
#nethud * { box-sizing: border-box; }
/* 队友：贴着左边、在气血 / 真气 / 等级那一组下面，一人一行：名字、一条细血条 */
/* 战斗界面左上那一组（气血、真气、等级，真气满时下面还有一行按键提示）到 6em 左右为止，队友排在它下面 */
#nethud .mates { position: absolute; left: calc(.8em + max(0px, var(--sal) - var(--gl, 0px))); top: 6.6em; display: grid; grid-template-columns: auto 3.8em; column-gap: .4em; row-gap: .22em; align-items: center; }
/* 战斗界面顶上那一排挪到画布上面时（竖屏，canvas-overlay.ts 的 hudAbove）：队友直接排在画布的左上角 */
#nethud.above .mates { top: .6em; }
#nethud .mates > * { font-size: .8em; }
#nethud .mates .n { white-space: nowrap; max-width: 6em; overflow: hidden; text-overflow: clip; }
#nethud .mates .bar { position: relative; height: .42em; padding: max(1px, .06em); background: rgba(${INK},.8); clip-path: polygon(0 50%, .24em 0, calc(100% - .24em) 0, 100% 50%, calc(100% - .24em) 100%, .24em 100%); }
#nethud .mates .bar i { position: absolute; inset: max(1px, .06em); transform-origin: left center; background: linear-gradient(#f0694b, #c9402d 42%, #8f2620); clip-path: polygon(0 50%, .2em 0, calc(100% - .2em) 0, 100% 50%, calc(100% - .2em) 100%, .2em 100%); }
#nethud .mates .off { opacity: .45; }
#nethud .mates .st { grid-column: 2; font-size: .9em; color: #c9bcae; white-space: nowrap; }
/* 角上一行状态：很淡、很小 */
#nethud .info { position: absolute; left: calc(.8em + max(0px, var(--sal) - var(--gl, 0px))); bottom: calc(.5em + max(0px, var(--sab) - var(--gb, 0px))); font-size: .72em; color: #d9cdbb; opacity: .7; white-space: nowrap; }
/* 提示：四边都软的墨底，放在人物下面一点（人物在画面正中，别压住他；上面是波次横幅和首领血条） */
#nethud .note { position: absolute; left: 0; right: 0; top: 63%; display: flex; justify-content: center; opacity: 0; transition: opacity .35s; }
#nethud .note.on { opacity: 1; }
#nethud .note > span { display: block; padding: .7em 4.2em .78em; text-align: center; white-space: nowrap; background: ${band(INK, 0.84, 24)}; ${featherCss('.45em')} }
#nethud .note b { display: block; font-family: ${FONT_TITLE}; font-weight: normal; font-size: 1.45em; letter-spacing: .2em; padding-left: .2em; }
#nethud .note small { display: block; margin-top: .25em; font-size: .9em; color: #d9cdbb; letter-spacing: .06em; }
/* 万宝阁里：谁还没出战。盖在货架下面那两行操作提示上（等人的时候这句更要紧），底色就是万宝阁的底色，左右两头淡出 */
#nethud .ready { position: absolute; left: 15.2em; bottom: 0; height: 2.95em; display: none; }
#nethud .ready.on { display: flex; }
#nethud .ready > span { display: flex; align-items: center; height: 100%; min-width: 26em; padding: 0 5em 0 1.1em; white-space: nowrap; font-size: .9em; letter-spacing: .04em; text-shadow: none;
  background: linear-gradient(90deg, rgba(46,36,51,0), rgb(46,36,51) .7em, rgb(46,36,51) calc(100% - 3.2em), rgba(46,36,51,0)); }
#nethud .ready em { font-style: normal; color: #f7dc7a; }
`;

export interface MateView {
  name: string;
  hp: number; // 0..1
  alive: boolean;
  online: boolean;
  /** 血条下面的一行小字：倒地几秒、出局、托管……空 = 不显示。 */
  status: string;
}

export interface NetHudState {
  mates: MateView[];
  info: string;
  /** 正中的提示：null 不显示。 */
  note: { title: string; sub?: string } | null;
  /** 万宝阁里谁还没出战（null 不显示）。 */
  /** 万宝阁里：自己按了出战没有、谁已经按了、谁还没按（null 不显示）。 */
  ready: { me: boolean; done: string[]; wait: string[] } | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function mountNetHud() {
  if (!document.querySelector('style[data-nethud]')) {
    const s = document.createElement('style');
    s.dataset.nethud = '';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const el = document.createElement('div');
  el.id = 'nethud';
  el.innerHTML = `<div class="mates"></div><div class="info"></div><div class="note"><span><b></b><small></small></span></div><div class="ready"><span></span></div>`;
  document.body.appendChild(el);
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  const mates = $('.mates');
  const info = $('.info');
  const note = $('.note');
  const noteB = $('.note b');
  const noteS = $('.note small');
  const ready = $('.ready');
  const readyT = $('.ready span');
  const follower = followCanvas(el, (f) => {
    el.classList.toggle('above', hudAbove(f));
    const gaps = { l: f.left, t: f.top, r: innerWidth - (f.left + f.width), b: innerHeight - (f.top + f.height) };
    for (const [k, g] of Object.entries(gaps)) el.style.setProperty(`--g${k}`, `${Math.max(0, g).toFixed(1)}px`);
  });
  let lastMates = '';
  let lastInfo = '';
  let lastNote = '';
  let lastReady = '';
  return {
    update(s: NetHudState) {
      const mk = JSON.stringify(s.mates.map((m) => [m.name, Math.round(m.hp * 100), m.alive, m.online, m.status]));
      if (mk !== lastMates) {
        lastMates = mk;
        mates.innerHTML = s.mates
          .map((m) => {
            const st = m.status;
            return `<span class="n${m.online ? '' : ' off'}">${esc(m.name)}</span><div class="bar${m.online ? '' : ' off'}"><i style="transform:scaleX(${Math.max(0, Math.min(1, m.hp)).toFixed(3)})"></i></div>${st ? `<span class="st">${st}</span>` : ''}`;
          })
          .join('');
      }
      if (s.info !== lastInfo) info.textContent = lastInfo = s.info;
      const nk = s.note ? `${s.note.title}|${s.note.sub ?? ''}` : '';
      if (nk !== lastNote) {
        lastNote = nk;
        if (s.note) {
          noteB.textContent = s.note.title;
          noteS.textContent = s.note.sub ?? '';
          noteS.style.display = s.note.sub ? 'block' : 'none';
        }
        note.classList.toggle('on', !!s.note);
      }
      const rk = s.ready ? JSON.stringify(s.ready) : '';
      if (rk !== lastReady) {
        lastReady = rk;
        // 自己按了出战：等谁；自己还没按：谁已经出战在等你（都没按就不显示，不吵）
        const r = s.ready;
        const text = !r ? '' : r.me ? (r.wait.length ? `等同伴出战：<em>${r.wait.map(esc).join('、')}</em>` : '') : r.done.length ? `<em>${r.done.map(esc).join('、')}</em>已出战 · 等你` : '';
        ready.classList.toggle('on', !!text);
        if (text) readyT.innerHTML = text;
      }
    },
    setVisible(v: boolean) {
      el.style.visibility = v ? 'visible' : 'hidden';
    },
    dispose() {
      follower.dispose();
      el.remove();
    },
  };
}

export type NetHud = ReturnType<typeof mountNetHud>;
