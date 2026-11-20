// 标题页天上的金色裂缝（隐藏角色孙悟空；用户 11-11 确认的设计）：通关过一次（第三章首领倒下，任意劫）之后，标题页的天上多一道很细的金色裂缝——
// 不提示、不闪，只是偶尔落下一两粒金屑；点到它 → 放一段约 8 秒的过场（cutscene 'wukong'，画面在 wukong-shots.ts，点了才下）→
// 解锁孙悟空（profile.unlock）→ 解锁提示卡 → 裂缝合上，以后不再出现（选角、图鉴、联机大厅里他就不再是问号剪影）。
// 这一块整个是按需下的：title.ts 只在 profile.riftDue 为真时 import() 它、调一次 mountRift（没通关过的玩家一个字节都不下）。
//
// 画法：一张很小的像素画布（和标题页的背景同一个像素格：一个画面像素 = 背景的一个像素，见 title.ts 的 backdropGrid），
// 摆在榜的右边那片天上（避开榜、大字、菜单）；缝是一道一像素宽、略带折的金线，慢慢明暗（十几秒一个来回，不闪），
// 隔几秒落下一两粒金屑、飘一小段淡掉。点的范围比缝大一圈（缝太细，手机上点不中）。叠在标题那一层里，标题隐去（开设置、进选角）时跟着隐去。
import type { Sfx } from '../audio/sfx.ts';
import { BANK } from '../audio/bank.ts';
import { heroFrames } from './hero-views.ts';
import { backdropGrid } from './title.ts';
import { titleLayout } from '../art/title.ts';
import { PALETTE, hexToRgba } from '../art/palette.ts';
import { FONT_TITLE, loadFonts } from './fonts.ts';
import { band, featherCss, hairlinesCss } from './ink-band.ts';
import { unlock, WUKONG_UNLOCK } from './profile.ts';
import { UNLOCK_WUKONG } from './story.ts';
import { injectCss, pushKeys, toast, wait, type Layer, type UiFit } from './front-ui.ts';
import type { Grid } from '../art/pixel.ts';

/** 标题页交给这里的东西。 */
export interface RiftHost {
  layer: Layer;
  /** 标题那一层（大字、菜单、战绩）：裂缝挂在它里面，放过场时把它隐去（.under）。 */
  title: HTMLElement;
  sfx: Sfx;
  /** 标题页这时在忙（开着设置、致谢、修为……）：点裂缝不算。 */
  busy(): boolean;
  setBusy(v: boolean): void;
  /** 回到标题页之后把焦点放回菜单。 */
  refocus(): void;
}

/** 缝本身：14 行，每行相对缝顶的横向偏移（略往右下斜、中间折一下）。 */
const PATH = [0, 0, 1, 1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 3];
const CW = 9; // 画布宽（画面像素）
const CH = 44; // 画布高：缝在最上面，下面留给落下来的金屑
const rgb = (ch: string) => hexToRgba(PALETTE[ch]);

const CSS = `
#fs-front .wk-rift { position: absolute; pointer-events: none; image-rendering: pixelated; animation: fs-wk-in 2.4s 1.2s ease-out both; }
@keyframes fs-wk-in { from { opacity: 0; } }
#fs-front .wk-hit { position: absolute; padding: 0; margin: 0; border: 0; background: transparent; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#fs-front .wk-hit:focus { outline: none; }
#fs-front .wk-card { position: absolute; left: 0; right: 0; top: 24%; display: flex; justify-content: center; opacity: 0; transition: opacity .6s ease-out; cursor: pointer; z-index: 3; }
#fs-front .wk-card.on { opacity: 1; }
#fs-front .wk-card .band { position: relative; padding: 1em 5.5em 1.2em; text-align: center; background: ${band('20,15,25', 0.88, 22)}; ${featherCss('.5em')} }
#fs-front .wk-card .band::before { content: ''; position: absolute; inset: 0; pointer-events: none; ${hairlinesCss('224,168,58', 0.75, '.5em', '8%', 25)} }
#fs-front .wk-card canvas { display: block; margin: 0 auto .25em; image-rendering: pixelated; }
#fs-front .wk-card .lbl { font-size: 1.05em; letter-spacing: .3em; padding-left: .3em; white-space: nowrap; color: #d5c8b6; text-shadow: 0 .06em 0 #1a1520; }
#fs-front .wk-card .nm { font-family: ${FONT_TITLE}; font-size: 2.5em; line-height: 1.25; letter-spacing: .3em; padding-left: .3em; white-space: nowrap; color: #e0a83a; text-shadow: 0 .05em 0 #1a1520; }
`;

/** 裂缝在背景画上的位置（画面像素，缝顶）：榜右边那片天的正中、和榜差不多高。 */
function riftAt(aw: number, ah: number): { x: number; y: number } {
  const L = titleLayout(aw, ah);
  const right = L.scroll.x + L.scroll.w;
  return { x: Math.round(right + (aw - right) * 0.5), y: Math.round(L.scroll.y + 2) };
}

/** 一粒往下飘的金屑。 */
interface Fleck {
  x: number;
  y: number;
  vx: number;
  t: number;
  life: number;
}

/** 挂上裂缝。返回 dispose（摘掉；放完过场、解锁之后自己会摘）。 */
export function mountRift(h: RiftHost): { dispose(): void } {
  injectCss('fs-wk-rift', CSS);
  const { layer, title, sfx } = h;
  const cv = document.createElement('canvas');
  cv.className = 'wk-rift';
  cv.width = CW;
  cv.height = CH;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(CW, CH);
  const hit = document.createElement('button');
  hit.type = 'button';
  hit.className = 'wk-hit';
  hit.tabIndex = -1; // 不进按键的顺序：秘密就是秘密
  hit.setAttribute('aria-label', '天上的裂缝');
  title.append(cv, hit);

  // ---- 摆位置（窗口变了跟着挪；和背景画同一个像素格） ----
  const place = (f: UiFit) => {
    const g = backdropGrid(f);
    const at = riftAt(g.aw, g.ah);
    Object.assign(cv.style, { left: `${g.ox + (at.x - (CW >> 1)) * g.u}px`, top: `${g.oy + at.y * g.u}px`, width: `${CW * g.u}px`, height: `${CH * g.u}px` });
    // 点的范围：缝的上下左右各宽出约 8 个画面像素（至少 40 个 CSS 像素见方：手指点得中）
    const w = Math.max(40, 18 * g.u);
    const hh = Math.max(44, 26 * g.u);
    Object.assign(hit.style, { left: `${g.ox + at.x * g.u - w / 2}px`, top: `${g.oy + (at.y + 7) * g.u - hh / 2}px`, width: `${w}px`, height: `${hh}px` });
  };
  const prevFit = layer.onFit;
  const onFit = (f: UiFit) => {
    prevFit?.(f);
    place(f);
  };
  layer.onFit = onFit;
  place(layer.fit);

  // ---- 画：一道金线慢慢明暗；隔几秒落下一两粒金屑 ----
  const flecks: Fleck[] = [];
  let fleckCd = 2 + Math.random() * 3;
  let t = 0;
  let last = performance.now();
  let raf = 0;
  let alive = true;
  let tear = 0; // 点中之后：缝先亮一下、撕开一点（0..1），再交给过场
  const px = (x: number, y: number, ch: string, a: number) => {
    if (x < 0 || y < 0 || x >= CW || y >= CH || a <= 0) return;
    const c = rgb(ch);
    const i = (y * CW + x) * 4;
    const al = Math.round(255 * Math.min(1, a));
    if (al <= img.data[i + 3]) return;
    img.data[i] = c[0];
    img.data[i + 1] = c[1];
    img.data[i + 2] = c[2];
    img.data[i + 3] = al;
  };
  const draw = () => {
    img.data.fill(0);
    const glow = 0.68 + 0.18 * Math.sin((t / 13) * Math.PI * 2) + 0.3 * tear; // 十几秒一个来回，不闪
    const x0 = (CW >> 1) - 1;
    PATH.forEach((dx, y) => {
      const u = y / (PATH.length - 1);
      const prof = Math.sin(Math.PI * u) ** 0.6; // 两头淡、中间亮
      px(x0 + dx, y, prof > 0.75 ? 'f' : prof > 0.4 ? 'Y' : 'y', glow * (0.35 + 0.65 * prof));
      if (tear > 0 && prof > 0.3) {
        // 撕开：缝两边各亮出一像素
        px(x0 + dx - 1, y, 'Y', tear * prof);
        px(x0 + dx + 1, y, 'y', tear * prof * 0.8);
      }
    });
    for (const f of flecks) {
      const a = Math.min(1, f.t / 0.4, (f.life - f.t) / 1.2) * 0.9;
      px(Math.round(f.x), Math.round(f.y), Math.floor(f.t * 3) % 2 ? 'Y' : 'f', a);
    }
    ctx.putImageData(img, 0, 0);
  };
  const tick = (now: number) => {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    if (!cv.isConnected) return dispose(); // 标题页整层拆掉了（开局）
    const dt = Math.min(0.1, (now - last) / 1000);
    if (dt < 1 / 20) return; // 动得很慢：二十帧就够
    last = now;
    t += dt;
    fleckCd -= dt;
    if (fleckCd <= 0) {
      fleckCd = 2.5 + Math.random() * 4;
      const n = Math.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const y = 4 + Math.floor(Math.random() * 7);
        flecks.push({ x: (CW >> 1) - 1 + PATH[y], y: y + 1, vx: (Math.random() - 0.5) * 1.2, t: -i * 0.5, life: 2.8 + Math.random() * 1.2 });
      }
    }
    for (let i = flecks.length - 1; i >= 0; i--) {
      const f = flecks[i];
      f.t += dt;
      if (f.t < 0) continue;
      f.x += (f.vx + Math.sin(f.t * 2.3) * 0.8) * dt;
      f.y += 7 * dt;
      if (f.t >= f.life || f.y >= CH) flecks.splice(i, 1);
    }
    draw();
  };
  draw();
  raf = requestAnimationFrame(tick);

  function dispose() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    cv.remove();
    hit.remove();
    if (layer.onFit === onFit) layer.onFit = prevFit;
  }

  // ---- 点中：缝亮一下、撕开一点 → 过场 → 解锁 → 提示卡 ----
  hit.addEventListener('click', async () => {
    if (!alive || h.busy()) return;
    h.setBusy(true);
    sfx.play(BANK['wukong.rift'] ? 'wukong.rift' : 'jinbian.crack', 0.7); // 名字表里还没有它的素材：先借金鞭的「金缝裂开」（docs/audio.md）
    for (const k of [0.35, 0.7, 1]) {
      tear = k;
      draw();
      await wait(90);
    }
    title.classList.add('under');
    const mod = await Promise.all([import('./cutscene.ts'), loadFonts()])
      .then(([m]) => m)
      .catch((e) => {
        console.error(e);
        return null;
      });
    dispose();
    if (mod) await mod.playCutscene('wukong', { sfx });
    else toast('过场没载入：网络不通？角色照样解锁了');
    unlock(WUKONG_UNLOCK);
    await unlockCard(layer, sfx, UNLOCK_WUKONG.label, UNLOCK_WUKONG.name, heroFrames('wukong').idle[0]);
    title.classList.remove('under');
    h.setBusy(false);
    h.refocus();
  });

  return { dispose };
}

/** 解锁提示卡（和局里的那张同一个样子：一道墨色的横带、上下两道金线，立绘、小字、书法大字）：点一下、按键或 3.2 秒后收起。 */
function unlockCard(layer: Layer, sfx: Sfx, label: string, name: string, picture: Grid): Promise<void> {
  sfx.play('ui.levelup');
  const card = document.createElement('div');
  card.className = 'wk-card';
  const bandEl = document.createElement('div');
  bandEl.className = 'band';
  const cv = document.createElement('canvas');
  cv.width = picture.w;
  cv.height = picture.h;
  const ctx = cv.getContext('2d')!;
  const im = ctx.createImageData(picture.w, picture.h);
  picture.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      im.data.set(rgb(ch), (y * picture.w + x) * 4);
    }),
  );
  ctx.putImageData(im, 0, 0);
  const s = Math.max(2, Math.round(Math.min(layer.fit.base * 0.25, (layer.fit.h * 0.3) / picture.h) * layer.fit.dpr)) / layer.fit.dpr;
  cv.style.width = `${picture.w * s}px`;
  cv.style.height = `${picture.h * s}px`;
  const lbl = document.createElement('div');
  lbl.className = 'lbl';
  lbl.textContent = label;
  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = name;
  bandEl.append(cv, lbl, nm);
  card.appendChild(bandEl);
  layer.ui.appendChild(card);
  requestAnimationFrame(() => card.classList.add('on'));
  return new Promise((res) => {
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      popKeys();
      card.classList.remove('on');
      setTimeout(() => {
        card.remove();
        res();
      }, 600);
    };
    const timer = setTimeout(close, 3200);
    const popKeys = pushKeys(() => {
      close();
      return 'consume';
    });
    card.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      close();
    });
  });
}
