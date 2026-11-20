// 联机大厅（DOM，卷轴面板，和设置、致谢同一套外围界面）：标题页的「联机」→ 这里。
//   第一页：名号、「建房」、房间码 +「进房」。网址带 ?room=ABCD 时直接进那个房（刷新页面也回到原来的位置）。
//   房间页：房间码、分享链接、名单（每人的角色、准备了没有、谁是房主、掉线了没有）、
//          其他人「准备 / 取消准备」，房主「开始」（连着的人都准备好了才能开；一个人也能开）、「离开」。
// 房主按「开始」：给房里每个人发「开局」（种子 + 人物分配），自己和别人都 resolve 一个 NetSession 交给游戏。
// 这一局已经在打的时候进房：房主会说「等到商店」，到了商店把你加进去（中途加入只能在商店阶段）。
// 角色：房间页上一排「角色」按钮（能选的角色都在：哪吒、杨戬），名单里写着每人选的角色。同一房间不能重复：
// 别人选了的变暗、按不了（角色都被选完了——人比角色多——才允许重复）；两个人同时选了同一个，后进房的那个自动换成没人选的。
// 房主开局时、中途有人进来时再按 sim/heroes/index.ts 的 pickFreeHero 兜一次底。记住上次选的（这台设备上）。
import type { Sfx } from '../audio/sfx.ts';
import { Link, relayHttp, relayUrl } from '../net/link.ts';
import { inviteUrl } from '../net/invite.ts';
import { CODE_CHARS, PROTOCOL, parseMsg, type HostMsg, type Member, type MemberMeta, type Slot } from '../net/protocol.ts';
import { NetSession } from '../net/session.ts';
import { HEROES } from '../sim/catalog.ts';
import { HERO_IDS, allowedHeroes, pickFreeHero } from '../sim/heroes/index.ts';
import { makeQr } from './qr.ts';
import { JIE_TIERS, clampJie } from '../sim/jie.ts';
import { loadJie, loadXiuwei, setLastJie, unlockedJie, unlocks } from './profile.ts';
import { sealedItems } from './achievements.ts';
import type { HeroId } from '../sim/types.ts';
import { C, P, cellsEven, centerIn, inkButton, inkWidth, injectCss, isCompact, isTall, isTyping, navKeys, pushKeys, refitWithin, scrollPanel, type Layer, type ScrollPanel, type UiFit } from './front-ui.ts';

const PANEL_W = 25;

const CSS = `
.fs-ui .lob { display: flex; flex-direction: column; align-items: center; gap: .55em; }
.fs-ui .lob .row { display: flex; align-items: center; justify-content: center; gap: ${P(6)}; }
.fs-ui .lob .lab { color: ${C.wu}; letter-spacing: .12em; white-space: nowrap; }
.fs-ui .lob .field { width: 7.6em; height: var(--tap); margin: 0; padding: 0 .55em; font: inherit; color: ${C.wu}; background: #fbf5e8; border: 0; border-radius: 0; outline: none;
  box-shadow: inset 0 0 0 var(--p) ${C.yinshu}; -webkit-user-select: text; user-select: text; -webkit-appearance: none; appearance: none; text-align: center; letter-spacing: .08em; }
.fs-ui .lob .field:focus { box-shadow: inset 0 0 0 var(--p) ${C.zhu}; }
.fs-ui .lob .field::placeholder { color: ${C.yinshu}; letter-spacing: .12em; }
.fs-ui .lob .field.code { letter-spacing: .4em; text-indent: .4em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
.fs-ui .lob .note { color: ${C.cang}; text-align: center; max-width: 20em; }
.fs-ui .lob .or { color: ${C.yinshu}; letter-spacing: .3em; text-indent: .3em; }
/* 房间页 */
/* 房间码用正文的文楷（书法体的拉丁字母是连笔的，N、M 认不出来）：大字、字距拉开、朱色 */
.fs-ui .lob .code-big { font-family: var(--font-text); font-size: 2.5em; line-height: 1.15; letter-spacing: .45em; text-indent: .45em; color: ${C.zhu}; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fs-ui .lob .share { display: flex; justify-content: center; max-width: 100%; }
.fs-ui .lob .url { min-width: 0; max-width: 100%; padding: .15em .7em; font-size: .92em; color: ${C.cang}; background: #fbf5e8; box-shadow: inset 0 0 0 var(--p) ${C.gao}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; -webkit-user-select: all; user-select: all; font-family: var(--font-text); }
.fs-ui.compact .lob .share { display: none; }
.fs-ui .lob .roster { display: grid; grid-template-columns: 1.4em minmax(5.5em, auto) minmax(3em, auto) 5.2em; column-gap: .8em; row-gap: .25em; align-items: center; min-width: 17em; }
.fs-ui .lob .roster > span { white-space: nowrap; overflow: hidden; }
.fs-ui .lob .roster .no { color: ${C.yinshu}; text-align: right; }
.fs-ui .lob .roster .nm { color: ${C.xuan}; }
.fs-ui .lob .roster .nm.me::after { content: '（你）'; color: ${C.cang}; }
.fs-ui .lob .roster .hr { color: ${C.cang}; }
.fs-ui .lob .roster .st { text-align: right; color: ${C.cang}; }
.fs-ui .lob .roster .st.host { color: ${C.zhu}; }
.fs-ui .lob .roster .st.ok { color: ${C.shiqing}; }
.fs-ui .lob .roster .st.off { color: ${C.yinshu}; }
.fs-ui .lob .roster .empty { grid-column: 2 / -1; color: ${C.gao}; }
.fs-ui .lob .rule { align-self: stretch; }
/* 劫数（房主选，sim/jie.ts）：标签、房主的按钮（点一下换下一劫）、称号；其他人只看得到文字 */
.fs-ui .lob .row.jie { gap: .8em; }
.fs-ui .lob .row.jie .jt { color: ${C.cang}; white-space: nowrap; min-width: 7em; }
/* 角色：选中的那个字是藤黄（朱色那一笔和别的按钮一样只表示焦点，不然焦点在另一格时两格都是红的，分不清哪个是选中的）；别人选了的变暗（aria-disabled） */
.fs-ui .lob .heroes .ink.on .lb { color: ${C.teng}; }
/* 角色多于三个：按钮排成两行（同宽、对齐；列数、纸的宽度在 layoutHeroes 里按列出来的按钮算），「角色」两个字在左边跨着所有行居中 */
.fs-ui .lob .row.heroes.grid { display: grid; grid-template-columns: auto repeat(var(--cols, 2), auto); column-gap: ${P(6)}; row-gap: ${P(4)}; align-items: center; justify-items: center; }
.fs-ui .lob .row.heroes.grid .lab { grid-row: 1 / span 2; }
.fs-ui .lob .row.heroes.grid.stack { grid-template-columns: repeat(var(--cols, 2), auto); }
.fs-ui .lob .row.heroes.grid.stack .lab { grid-column: 1 / -1; }
/* 竖屏（.tall）：纸两边的留白收窄一点，角色按钮排得下两列 */
.fs-ui.tall .scroll .paper:has(> .lob) { padding-left: .9em; padding-right: .9em; }
.fs-ui .lob .qr { display: flex; flex-direction: column; align-items: center; gap: .3em; }
.fs-ui .lob .qr canvas { image-rendering: pixelated; box-shadow: 0 0 0 var(--p) ${C.gao}; }
.fs-ui.compact .lob .qr .note { display: none; }
.fs-ui.compact .lob { gap: .3em; }
/* 手机横屏：名单行距收紧（角色、劫数两行之外，四个人的名单也要放得下） */
.fs-ui.compact .lob .roster { row-gap: 0; line-height: 1.4; }
.fs-ui.compact .lob .code-big { font-size: 2.1em; }
`;

/** 这台设备上记住的名号（不进存档码）。 */
const NAME_KEY = 'fs.v1.netName';
/** 这台设备上记住的联机角色（不进存档码）。 */
const HERO_KEY = 'fs.v1.netHero';
function loadHero(): HeroId {
  try {
    const v = localStorage.getItem(HERO_KEY) as HeroId | null;
    if (v && HEROES[v]) return v;
  } catch {
    // 本地存储用不了（隐私模式）：就用哪吒
  }
  return 'nezha';
}
function saveHero(h: HeroId) {
  try {
    localStorage.setItem(HERO_KEY, h);
  } catch {
    // 存不下就算了
  }
}
/** 这个标签页上次在哪个房间、凭据是什么（刷新页面时回到原来的位置；sessionStorage，关了标签页就没了）。 */
const SESSION_KEY = 'fs.net.session';
const DEFAULT_NAMES = ['青云', '玄机', '赤霄', '白鹤', '流云', '惊雷', '长风', '明月', '清泉', '松鹤', '云鹿', '丹霞'];

function loadName(): string {
  try {
    const v = localStorage.getItem(NAME_KEY);
    if (v) return v;
  } catch {
    /* 隐私模式 */
  }
  return DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
}
function saveName(v: string) {
  try {
    localStorage.setItem(NAME_KEY, v);
  } catch {
    /* 隐私模式 */
  }
}
function loadSession(): { room: string; token: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return v && typeof v.room === 'string' && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}
function saveSession(v: { room: string; token: string } | null) {
  try {
    if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* 隐私模式 */
  }
}

/** 房间码：只留房间码里会出现的字符，转大写，最多 4 个。 */
const cleanCode = (s: string) =>
  [...s.toUpperCase()]
    .filter((c) => CODE_CHARS.includes(c))
    .slice(0, 4)
    .join('');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * 分享链接：页面本来的地址加 ?room=。页面是用 localhost 打开的（电脑上自己玩），手机要用电脑的局域网地址才进得来，
 * 问一下中继这台机器的局域网地址拼上去。带着 ?relay= 的也一并带上。
 */
async function shareUrl(room: string, relay: string): Promise<string> {
  const u = new URL(location.href);
  let lanHost: string | undefined;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) {
    try {
      const info = (await (await fetch(`${relayHttp(relay)}/info`, { cache: 'no-store', signal: AbortSignal.timeout(2000) })).json()) as { lan?: string[] };
      lanHost = info.lan?.[0];
    } catch {
      /* 问不到就用原来的 */
    }
  }
  return inviteUrl(location.href, room, lanHost);
}

export interface LobbyOptions {
  layer: Layer;
  sfx: Sfx;
  /** 网址带着 ?room=：直接进这个房。 */
  room?: string;
}

/** 打开联机大厅。开局时 resolve 一个 NetSession（交给游戏），返回 / 离开时 resolve null。 */
export async function openLobby(o: LobbyOptions): Promise<NetSession | null> {
  injectCss('fs-lobby', CSS);
  const { layer, sfx } = o;
  const relay = relayUrl();
  const link = new Link(relay);
  let browserLan = new URLSearchParams(location.search).get('transport') === 'rtc';
  let forceRelay = new URLSearchParams(location.search).get('transport') === 'relay';
  let directError = '';
  let hero: HeroId = loadHero();
  let name = loadName();
  let ready = false;
  // 劫数：房主开房时选（按房主自己的解锁进度），开局时随「开局」发给所有人；修为：各带各的，随名单交给房主（sim/xiuwei.ts）
  let jie = Math.min(unlockedJie(), clampJie(loadJie().last));
  const meta = (): MemberMeta => ({ hero, ready, v: PROTOCOL, xw: loadXiuwei().nodes, jie, un: unlocks(), sl: sealedItems(), ...((link.room ? link.directMode : browserLan) ? { rtc: 1 as const } : !forceRelay ? { rtc: 2 as const } : {}) });

  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.style.background = 'rgba(26,21,32,.32)';
  layer.ui.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' });
  let panel: ScrollPanel = scrollPanel(PANEL_W);
  /** 这一页自己要排的东西（房间页的角色按钮；第一页没有）：place 里量完部件之后、居中之前调。 */
  let onPlace: ((f: UiFit) => void) | null = null;
  layer.ui.appendChild(panel.el);

  const place = (f: UiFit) => {
    panel.el.style.setProperty('--tap', `${f.tap}px`);
    refitWithin(panel.paper, f);
    onPlace?.(f);
    panel.paper.style.maxHeight = `${f.h - f.p * 16}px`;
    centerIn(panel.el, f);
  };
  const refit = layer.onFit;
  layer.onFit = (f) => {
    refit?.(f);
    place(f);
  };

  let focusables: HTMLElement[] = [];
  let onKey: (e: KeyboardEvent) => 'consume' | 'pass' = () => 'consume';
  let view: 'entry' | 'room' = 'entry';
  /** 上一份名单里（除了自己）连着的人：有人进来、走了各响一声。进房时记下当时的名单当底；不在房间那一页时是 null。 */
  let rosterSeen: Set<number> | null = null;
  let finish: (v: NetSession | null) => void = () => {};
  const done = new Promise<NetSession | null>((r) => (finish = r));
  let closing = false;
  const offs: (() => void)[] = [];

  const close = async (result: NetSession | null) => {
    if (closing) return;
    closing = true;
    popKeys();
    for (const f of offs) f();
    if (!result) {
      saveSession(null);
      link.close();
    }
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await panel.close();
    veil.remove();
    layer.onFit = refit;
    finish(result);
  };

  /** 换一页：卷起来、换内容、再展开。 */
  let swapping: Promise<void> = Promise.resolve();
  const swap = (build: () => void, first = false) =>
    (swapping = swapping.then(async () => {
      if (closing) return;
      if (!first) {
        await panel.close();
        panel = scrollPanel(PANEL_W);
        layer.ui.appendChild(panel.el);
      }
      panel.paper.innerHTML = '';
      build();
      place(layer.fit);
      await panel.open();
      focusables[0]?.focus({ preventScroll: true });
    }));

  // ---------- 第一页：建房 / 进房 ----------
  const entry = () => {
    view = 'entry';
    onPlace = null;
    rosterSeen = null;
    const p = panel.paper;
    const lan = new URLSearchParams(location.search).get('network') === 'lan';
    p.insertAdjacentHTML('beforeend', `<h2>${lan ? '局域网联机' : '联机'}</h2>`);
    const box = document.createElement('div');
    box.className = 'lob';
    const w = inkWidth('建房', '进房', '返回');
    // 名号
    const nameRow = document.createElement('div');
    nameRow.className = 'row';
    nameRow.innerHTML = '<span class="lab">名号</span>';
    const nameIn = document.createElement('input');
    nameIn.className = 'field';
    nameIn.maxLength = 8;
    nameIn.value = name;
    nameIn.spellcheck = false;
    nameIn.autocomplete = 'off';
    nameIn.enterKeyHint = 'done';
    nameIn.addEventListener('input', () => {
      name = [...nameIn.value].slice(0, 8).join('');
    });
    nameRow.appendChild(nameIn);
    // 建房
    const create = inkButton('建房', { primary: true, w, onClick: () => void go('create') });
    const createRow = document.createElement('div');
    createRow.className = 'row';
    createRow.appendChild(create);
    const or = document.createElement('div');
    or.className = 'or';
    or.textContent = '或者';
    // 房间码 + 进房
    const joinRow = document.createElement('div');
    joinRow.className = 'row';
    const codeIn = document.createElement('input');
    codeIn.className = 'field code';
    codeIn.maxLength = 4;
    codeIn.placeholder = '房间码';
    codeIn.spellcheck = false;
    codeIn.autocomplete = 'off';
    codeIn.autocapitalize = 'characters';
    codeIn.enterKeyHint = 'go';
    codeIn.value = o.room ? cleanCode(o.room) : '';
    codeIn.addEventListener('input', () => {
      const c = cleanCode(codeIn.value);
      if (c !== codeIn.value) codeIn.value = c;
    });
    const join = inkButton('进房', { w, onClick: () => void go('join', codeIn.value) });
    joinRow.append(codeIn, join);
    const status = document.createElement('div');
    status.className = 'err';
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = lan
      ? browserLan ? '浏览器通过局域网直连，最多四人。设备需在同一网络，建房服务只交换连接信息。' : '连接房主电脑的中继，最多四人。玩家需在同一局域网，房主保持程序运行。'
      : '一人建房，其他玩家通过分享链接或房间码加入，最多四人，无需同一 Wi-Fi。';
    const lanHelp = document.createElement('details');
    lanHelp.className = 'note';
    const summary = document.createElement('summary');
    summary.textContent = lan ? '无法连接？' : '也可以在局域网里玩';
    const explanation = document.createElement('p');
    explanation.textContent = lan
      ? '使用房主提供的内网网址。无法连接时检查电脑网络设置；部分 Wi-Fi 会限制设备之间连接。'
      : '由一台电脑启动局域网游戏，再把内网网址发给同一网络的玩家。所有人用浏览器加入；局域网房间与这里的公网房间分开。';
    lanHelp.append(summary, explanation);
    lanHelp.addEventListener('toggle', () => place(layer.fit));
    box.append(nameRow, createRow, or, joinRow, status, note, lanHelp);
    const bar = document.createElement('div');
    bar.className = 'bar';
    const back = inkButton('返回', { w, onClick: () => (sfx.play('ui.click'), void close(null)) });
    const lanButton = !lan ? inkButton('局域网', { w: inkWidth('局域网'), onClick: () => (sfx.play('ui.click'), void swap(lanSetup)) }) : null;
    const publicButton = browserLan ? inkButton('公网', { w, onClick: () => {
      browserLan = false; forceRelay = true;
      const u = new URL(location.href); u.searchParams.delete('network'); u.searchParams.set('transport', 'relay'); u.searchParams.delete('create');
      history.replaceState(null, '', u.href);
      void swap(entry);
    } }) : null;
    if (lanButton) bar.appendChild(lanButton);
    if (publicButton) bar.appendChild(publicButton);
    bar.appendChild(back);
    p.append(box, bar);
    focusables = [create, codeIn, join, back, nameIn, summary];
    if (lanButton) focusables.push(lanButton);
    if (publicButton) focusables.push(publicButton);

    let busy = false;
    const go = async (what: 'create' | 'join', code = '') => {
      if (busy) return;
      name = [...nameIn.value.trim()].slice(0, 8).join('') || loadName();
      nameIn.value = name;
      saveName(name);
      if (what === 'join' && code.length !== 4) {
        status.className = 'err';
        status.textContent = '房间码是四个字';
        sfx.play('ui.denied');
        codeIn.focus();
        return;
      }
      busy = true;
      sfx.play('ui.click');
      status.className = 'hint';
      status.textContent = '正在连中继…';
      try {
        if (what === 'create') await link.create(name, meta());
        else {
          const prev = loadSession();
          await link.join(code, name, meta(), prev?.room === code ? prev.token : undefined);
        }
        saveSession({ room: link.room, token: link.token });
        void swap(room);
      } catch (e) {
        status.className = 'err';
        status.textContent = (e as Error).message;
        sfx.play('ui.denied');
      } finally {
        busy = false;
      }
    };
    onKey = (e) => {
      const k = e.key;
      if (k === 'Escape') {
        void close(null);
        return 'consume';
      }
      if (k === 'Enter' && document.activeElement === codeIn) {
        void go('join', codeIn.value);
        return 'consume';
      }
      if (k === 'Enter' && document.activeElement === nameIn) {
        create.focus({ preventScroll: true });
        return 'consume';
      }
      if (isTyping(e) && !['ArrowUp', 'ArrowDown'].includes(k)) return 'pass';
      navKeys(e, focusables, 'both');
      return 'consume';
    };
    // 网址带着房间码：直接进
    if (o.room && cleanCode(o.room).length === 4) {
      const code = cleanCode(o.room);
      o.room = undefined;
      setTimeout(() => void go('join', code), 0);
    } else if (browserLan && new URLSearchParams(location.search).get('create') === '1') {
      const u = new URL(location.href); u.searchParams.delete('create'); history.replaceState(null, '', u.href);
      setTimeout(() => void go('create'), 0);
    }
  };

  /** Pages 提供清楚的内网入口；房主程序提供真正的网页和中继。 */
  function lanSetup() {
    onPlace = null;
    const p = panel.paper;
    p.insertAdjacentHTML('beforeend', '<h2>局域网</h2>');
    const box = document.createElement('div');
    box.className = 'lob';
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = '房主直接在浏览器建房，把链接发给同一网络的玩家。建房服务只交换连接信息，游戏数据通过局域网直连。';
    const guide = document.createElement('a');
    guide.className = 'note';
    guide.textContent = '局域网使用说明';
    guide.href = 'https://github.com/bytewan/fengshen-survivors/blob/main/docs/lan.md';
    guide.target = '_blank';
    guide.rel = 'noopener';
    const field = document.createElement('input');
    field.className = 'field';
    field.style.width = '100%';
    field.type = 'url';
    field.setAttribute('aria-label', '房主网址');
    field.placeholder = 'http://192.168.1.10:5181/';
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.enterKeyHint = 'go';
    const status = document.createElement('div');
    status.className = 'err';
    const connect = () => {
      try {
        if (!field.value.trim()) throw new Error('请输入房主提供的内网网址');
        const value = field.value.trim();
        const u = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
        if (u.protocol !== 'http:' || u.username || u.password) throw new Error('请使用房主提供的 http:// 内网网址');
        u.searchParams.set('network', 'lan');
        if (!u.searchParams.has('room')) u.searchParams.set('online', '');
        if (!u.searchParams.has('relay')) u.searchParams.set('relay', `ws://${u.hostname}:5300`);
        location.assign(u.href);
      } catch (e) {
        status.textContent = (e as Error).message;
        field.focus();
      }
    };
    const bar = document.createElement('div');
    bar.className = 'bar';
    const create = inkButton('建房', { primary: true, w: inkWidth('建房', '返回'), onClick: () => {
      if (typeof RTCPeerConnection === 'undefined') { status.textContent = '当前浏览器无法使用局域网直连，请换用新版浏览器'; return; }
      browserLan = true;
      const u = new URL(location.href);
      u.searchParams.set('network', 'lan'); u.searchParams.set('transport', 'rtc'); u.searchParams.set('create', '1');
      history.replaceState(null, '', u.href);
      void swap(entry);
    } });
    const go = inkButton('连接', { w: inkWidth('连接', '返回'), onClick: connect });
    const back = inkButton('返回', { w: inkWidth('连接', '返回'), onClick: () => void swap(entry) });
    bar.append(create, back);
    const advanced = document.createElement('details');
    const summary = document.createElement('summary'); summary.className = 'note'; summary.textContent = '使用房主电脑提供的内网网址';
    advanced.append(summary, field, go);
    advanced.addEventListener('toggle', () => place(layer.fit));
    box.append(note, guide, advanced, status);
    p.append(box, bar);
    focusables = [create, back, guide, summary, field, go];
    onKey = e => {
      if (e.key === 'Escape') { void swap(entry); return 'consume'; }
      if (e.key === 'Enter' && document.activeElement === field) { connect(); return 'consume'; }
      if (isTyping(e)) return 'pass';
      navKeys(e, focusables, 'both');
      return 'consume';
    };
  }

  // ---------- 房间页 ----------
  let renderRoster: () => void = () => {};
  let waitText = '';
  const room = () => {
    view = 'room';
    rosterSeen = new Set(link.members.filter((m) => m.on && m.id !== link.me).map((m) => m.id)); // 进房那一刻的名单当底：之后有人进、有人走才响
    const p = panel.paper;
    p.insertAdjacentHTML('beforeend', '<h2>房间</h2>');
    const box = document.createElement('div');
    box.className = 'lob';
    const code = document.createElement('div');
    code.className = 'code-big';
    code.textContent = link.room;
    const share = document.createElement('div');
    share.className = 'share';
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = `…/?room=${link.room}`;
    // 二维码：手机用相机扫一下就进房（不用在手机上敲地址）。按「二维码」在名单的位置上显示，再按一次回到名单
    const qrBox = document.createElement('div');
    qrBox.className = 'qr';
    qrBox.style.display = 'none';
    const drawQr = (u: string) => {
      const q = makeQr(u);
      qrBox.innerHTML = '';
      if (!q) return;
      const quiet = 4;
      const n = q.size + quiet * 2;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d')!;
      g.fillStyle = C.yuebai;
      g.fillRect(0, 0, n, n);
      g.fillStyle = C.xuan;
      for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) g.fillRect(x + quiet, y + quiet, 1, 1);
      // 一格取整数个物理像素（像素画才清晰，扫码也更稳），整个码大约 8 个字宽
      const f = layer.fit;
      const k = Math.max(2, Math.floor((f.base * (isCompact(f) ? 6.5 : 8) * f.dpr) / n)) / f.dpr;
      c.style.width = c.style.height = `${n * k}px`;
      const cap = document.createElement('div');
      cap.className = 'note';
      cap.textContent = '手机扫码加入房间';
      qrBox.append(c, cap);
    };
    void shareUrl(link.room, relay).then((u) => {
      url.textContent = u;
      drawQr(u);
    });
    const qrBtn = inkButton('二维码', {
      onClick: () => {
        sfx.play('ui.click');
        const show = qrBox.style.display === 'none';
        qrBox.style.display = show ? '' : 'none';
        list.style.display = show ? 'none' : '';
        status.style.display = show ? 'none' : ''; // 二维码下面那句说明顶替它（不然卷轴放不下，按钮被挤到轴后面）
        (qrBtn.querySelector('.lb') as HTMLElement).textContent = show ? '名单' : '二维码';
        place(layer.fit);
      },
      w: inkWidth('二维码'),
    });
    const copy = inkButton('复制', {
      onClick: async () => {
        let ok = false;
        try {
          await navigator.clipboard.writeText(url.textContent ?? '');
          ok = true;
        } catch {
          // 局域网的 http 页面没有剪贴板接口：退回老办法
          const ta = document.createElement('textarea');
          ta.value = url.textContent ?? '';
          document.body.appendChild(ta);
          ta.select();
          try {
            ok = document.execCommand('copy');
          } catch {
            ok = false;
          }
          ta.remove();
        }
        status.className = ok ? 'ok' : 'err';
        status.textContent = ok ? '链接已复制，发送给朋友即可加入' : '没能自动复制：请长按链接手动复制';
        sfx.play(ok ? 'lobby.copy' : 'ui.denied');
      },
    });
    // 地址单独一行（手机上的紧凑版面里不显示：放不下，也用不着——有「复制」和二维码），按钮在下一行
    const acts = document.createElement('div');
    acts.className = 'row acts';
    acts.append(copy, qrBtn);
    share.append(url);
    const rule = document.createElement('div');
    rule.className = 'rule';
    const list = document.createElement('div');
    list.className = 'roster';
    const status = document.createElement('div');
    status.className = 'hint';
    // 角色：一排按钮，选中的那个字是藤黄；别人选了的变暗（还有没人选的角色时按不了）。只列这个房间能选的
    // （房主没解锁的回响化身、隐藏角色不列，连名字都不露），同宽——按列出来的名字里最长的取
    const heroRow = document.createElement('div');
    heroRow.className = 'row heroes';
    heroRow.innerHTML = '<span class="lab">角色</span>';
    const heroLab = heroRow.firstElementChild as HTMLElement;
    let heroBtns: HTMLButtonElement[] = [];
    let heroW = 0; // 按钮的宽（em）
    /** 列出 can 这几位的按钮；名单没变就不动（返回 false）。按钮的宽度是造的时候定的，所以名单变了整排重做。 */
    const listHeroes = (can: readonly HeroId[]) => {
      if (can.length === heroBtns.length && can.every((id, i) => heroBtns[i].dataset.hero === id)) return false;
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.hero;
      for (const b of heroBtns) b.remove();
      heroW = inkWidth(...can.map((h) => HEROES[h].name));
      heroBtns = can.map((id) => {
        const b = inkButton(HEROES[id].name, { w: heroW, onClick: () => chooseHero(id) });
        b.dataset.hero = id;
        heroRow.appendChild(b);
        return b;
      });
      if (focused) heroBtns.find((b) => b.dataset.hero === focused)?.focus({ preventScroll: true });
      return true;
    };
    /**
     * 排角色按钮（名单变了、窗口变了都重排）：三个以内一行，多了排成两行；纸跟着放宽到排得下
     * （回响化身的名字有五个字，四个首发角色加上解锁了的几位，原来 25em 的纸两列都放不下）；
     * 窗口太窄、放宽了也排不下那么多列（手机竖屏），就按排得下的列数多排几行。
     */
    const layoutHeroes = (f: UiFit) => {
      const n = heroBtns.length;
      if (!n) return;
      const bw = cellsEven(heroW, f) * f.p;
      const gap = f.p * 6;
      const side = heroLab.offsetWidth + gap; // 「角色」两个字占的那一列
      const want = n > 3 ? Math.ceil(n / 2) : n;
      const pad = panel.paper.offsetWidth - box.clientWidth; // 纸两边的留白
      panel.setWidth(Math.max(PANEL_W, (side + want * bw + (want - 1) * gap + pad) / f.base + 0.5));
      let cols = Math.max(1, Math.min(want, Math.floor((box.clientWidth - side + gap) / (bw + gap))));
      // 竖屏的纸窄：「角色」挪到按钮上面单独一行（.stack），按钮就能多排一列（不然八个角色一列排八行，纸要滑）
      const colsTop = Math.max(1, Math.min(want, Math.floor((box.clientWidth + gap) / (bw + gap))));
      const stack = isTall(f) && colsTop > cols;
      if (stack) cols = colsTop;
      heroRow.classList.toggle('stack', stack);
      heroRow.classList.toggle('grid', cols < n || stack);
      heroRow.style.setProperty('--cols', String(cols));
      heroLab.style.gridRow = stack ? '' : `1 / span ${Math.ceil(n / cols)}`;
    };
    onPlace = layoutHeroes;
    // 劫数这一行：房主点按钮换（只在解锁了的几劫里转），其他人看房主选的
    const jieRow = document.createElement('div');
    jieRow.className = 'row jie';
    const jieLab = document.createElement('span');
    jieLab.className = 'lab';
    jieLab.textContent = '劫数';
    const jieBtn = inkButton(JIE_TIERS[jie - 1].name, {
      w: inkWidth('劫一'),
      onClick: () => {
        if (!link.isHost) return;
        const top = unlockedJie();
        if (top <= 1) {
          sfx.play('ui.denied');
          return;
        }
        jie = (jie % top) + 1;
        setLastJie(jie);
        sfx.play('ui.click');
        link.setMeta(meta(), name);
        renderRoster();
      },
    });
    const jieTxt = document.createElement('span');
    jieTxt.className = 'jt';
    jieRow.append(jieLab, jieBtn, jieTxt);
    box.append(code, share, acts, rule, heroRow, list, qrBox, jieRow, status);
    const connectionInfo = document.createElement('details');
    const connectionLabel = document.createElement('summary'); connectionLabel.className = 'note'; connectionLabel.textContent = '连接信息';
    const connectionText = document.createElement('textarea');
    connectionText.readOnly = true; connectionText.setAttribute('aria-label', '连接信息');
    connectionText.style.cssText = 'width:100%;height:120px;font:12px/1.4 system-ui;resize:vertical';
    connectionInfo.append(connectionLabel, connectionText);
    connectionInfo.addEventListener('toggle', () => place(layer.fit));
    const publicRow = document.createElement('div'); publicRow.className = 'row';
    const usePublic = inkButton('公网联机', { w: inkWidth('公网联机'), onClick: () => {
      if (!link.isHost || (!link.directMode && !link.autoDirect)) return;
      browserLan = false; forceRelay = true;
      const u = new URL(location.href); u.searchParams.delete('network'); u.searchParams.set('transport', 'relay'); history.replaceState(null, '', u.href);
      const next = { ...meta() }; delete next.rtc;
      link.setMeta(next, name);
      directError = '';
    } });
    publicRow.appendChild(usePublic);
    box.append(connectionInfo, publicRow);
    const bar = document.createElement('div');
    bar.className = 'bar';
    const w = inkWidth('取消准备', '离开');
    const main = inkButton('准备', { primary: true, w, onClick: () => onMain() });
    const leave = inkButton('离开', { w, onClick: () => (sfx.play('ui.click'), void close(null)) });
    bar.append(main, leave);
    p.append(box, bar);
    focusables = [main, leave, ...heroBtns, jieBtn, copy, qrBtn];

    const others = () => link.members.filter((m) => m.on && m.id !== link.me);
    /** 别人（连着的）选了的角色。 */
    const takenByOthers = () => others().map((m) => (m.meta.hero ?? 'nezha') as HeroId);
    /** 这个房间能选的角色：按房主的解锁（回响化身、隐藏角色都看；自己是房主看自己的存档，别人看房主名单上带的那一份；房主换了人就跟着变）。 */
    const pool = () => allowedHeroes(link.isHost ? unlocks() : (link.members.find((m) => m.host)?.meta.un ?? []));
    const chooseHero = (id: HeroId) => {
      if (!pool().includes(id)) {
        sfx.play('ui.denied');
        return;
      }
      const taken = takenByOthers();
      if (id !== hero && taken.includes(id) && pickFreeHero(taken, id, pool()) !== id) {
        // 别人选了，而且还有没人选的：不能重复
        sfx.play('ui.denied');
        status.className = 'err';
        status.textContent = `${HEROES[id].name}已经有人选了`;
        return;
      }
      if (id === hero) return;
      hero = id;
      saveHero(id);
      sfx.play('ui.click');
      link.setMeta(meta(), name);
      renderRoster();
    };
    const allReady = () => link.directReady && others().every((m) => m.meta.ready && m.meta.v === PROTOCOL);
    renderRoster = () => {
      if (browserLan !== link.directMode) {
        browserLan = link.directMode;
        const u = new URL(location.href);
        if (browserLan) { u.searchParams.set('network', 'lan'); u.searchParams.set('transport', 'rtc'); }
        else { u.searchParams.delete('network'); if (forceRelay) u.searchParams.set('transport', 'relay'); else u.searchParams.delete('transport'); }
        history.replaceState(null, '', u.href);
        void shareUrl(link.room, relay).then(u => { url.textContent = u; drawQr(u); });
      }
      connectionInfo.style.display = link.directMode || link.autoDirect ? '' : 'none';
      publicRow.style.display = (link.directMode || link.autoDirect) && link.isHost ? '' : 'none';
      (usePublic.querySelector('.lb') as HTMLElement).textContent = link.autoDirect ? '使用中继' : '公网联机';
      connectionText.value = JSON.stringify({ browser: navigator.userAgent, peers: link.directDiagnostics }, null, 2);
      // 两个人选了同一个角色（同时按的）：后进房的那个换成没人选的
      const mine = link.members.find((m) => m.id === link.me);
      const earlier = others().filter((m) => !mine || m.order < mine.order || m.host).map((m) => (m.meta.hero ?? 'nezha') as HeroId);
      const can = pool();
      const fix = pickFreeHero(earlier, hero, can);
      if (fix !== hero) {
        hero = fix;
        link.setMeta(meta(), name);
      }
      const taken = takenByOthers();
      const relaid = listHeroes(can); // 房主没解锁的回响化身、隐藏角色不列（连名字都不露）；房主换了人，能选的跟着变
      for (const b of heroBtns) {
        const id = b.dataset.hero as HeroId;
        b.classList.toggle('on', id === hero);
        b.setAttribute('aria-disabled', String(id !== hero && taken.includes(id) && pickFreeHero(taken, id, can) !== id));
      }
      focusables = [main, leave, ...heroBtns, jieBtn, copy, qrBtn];
      if (link.directMode || link.autoDirect) focusables.push(connectionLabel, connectionText);
      if (publicRow.style.display !== 'none') focusables.push(usePublic);
      if (relaid) place(layer.fit); // 按钮换了：重排、纸重新定宽、重新居中
      const ms = [...link.members].sort((a, b) => (a.host === b.host ? a.order - b.order : a.host ? -1 : 1));
      const rows: string[] = [];
      ms.forEach((m: Member, i) => {
        const st = !m.on ? ['掉线', 'off'] : m.host ? ['房主', 'host'] : m.meta.ready ? ['已准备', 'ok'] : ['还没准备', ''];
        const heroName = HEROES[(m.meta.hero ?? 'nezha') as HeroId]?.name ?? '哪吒';
        rows.push(`<span class="no">${i + 1}</span><span class="nm${m.id === link.me ? ' me' : ''}">${esc(m.name)}</span><span class="hr">${esc(heroName)}</span><span class="st ${st[1]}">${st[0]}</span>`);
      });
      // 手机横屏上卷轴放不下四行空位（还有角色、劫数两行）：空位只留一行「等人进来…」；手机竖屏（角色按钮多排了几行）也一样
      const f0 = layer.fit;
      const upTo = isCompact(f0) || (isTall(f0) && f0.h / f0.base < 52) ? Math.min(4, ms.length + 1) : 4;
      for (let i = ms.length; i < upTo; i++) rows.push(`<span class="no">${i + 1}</span><span class="empty">等人进来…</span>`);
      list.innerHTML = rows.join('');
      // 劫数：房主看自己选的（能换），其他人看房主名单上写的
      const shown = link.isHost ? jie : clampJie(link.members.find((m) => m.host)?.meta.jie);
      const t = JIE_TIERS[shown - 1];
      (jieBtn.querySelector('.lb') as HTMLElement).textContent = t.name;
      jieBtn.style.display = link.isHost ? '' : 'none';
      jieBtn.setAttribute('aria-disabled', String(unlockedJie() <= 1));
      jieTxt.textContent = link.isHost ? `${t.title}${unlockedJie() > 1 ? ' · 点一下换' : ' · 通关后解锁下一劫'}` : `${t.name} · ${t.title}（房主定）`;
      // 按钮：房主「开始」，其他人「准备 / 取消准备」
      const label = main.querySelector('.lb') as HTMLElement;
      if (link.isHost) {
        label.textContent = '开始';
        main.setAttribute('aria-disabled', allReady() ? 'false' : 'true');
      } else {
        label.textContent = ready ? '取消准备' : '准备';
        main.setAttribute('aria-disabled', link.directReady ? 'false' : 'true');
      }
      const vs = link.members.filter((m) => m.on && m.meta.v !== undefined && m.meta.v !== PROTOCOL);
      if (link.state === 'lost') status.textContent = '和中继的连接断了，正在重连…';
      else if (waitText) status.textContent = waitText;
      else if (vs.length) status.textContent = `${vs.map((m) => m.name).join('、')}的游戏版本和你的不一样，刷新一下页面再进`;
      else if (link.directMode && !link.directReady) {
        const ds = link.directDiagnostics;
        status.textContent = ds.some(p => p.gathering === 'complete' && p.local === 0)
          ? '浏览器没有提供可用的内网地址，请检查 VPN 或代理设置'
          : ds.some(p => p.signaling === 'have-local-offer' || p.signaling === 'new')
            ? '正在交换连接信息，请等待队友回应'
            : directError || '已交换连接信息，正在建立内网连接；无法连接时可改用公网联机';
      }
      else if (link.isHost) status.textContent = others().length ? (allReady() ? '人都准备好了，可以开始' : '等大家按「准备」') : '一个人也能开始；把链接发给朋友，进来的人会出现在上面';
      else status.textContent = ready ? '等房主开始' : '准备好了就按「准备」';
      status.className = waitText || link.state === 'lost' || vs.length ? 'err' : 'hint';
    };
    const onMain = () => {
      if (!link.directReady) { sfx.play('ui.denied'); return; }
      if (link.isHost) {
        if (!allReady()) {
          sfx.play('ui.denied');
          status.className = 'err';
          status.textContent = '还有人没准备好';
          return;
        }
        sfx.play('lobby.start');
        // 开局：人物分配按「房主第一、其余按进房顺序」，只算连着的人
        const ms = [link.members.find((m) => m.id === link.me)!, ...others().sort((a, b) => a.order - b.order)];
        // 角色不重复（还有没人选的时候）：按这个顺序，先到先得（pickFreeHero）。各人的修为随名单带上（sim/xiuwei.ts），劫数随开局发给所有人
        const used: HeroId[] = [];
        const can = allowedHeroes(unlocks()); // 能选哪些按房主（自己）的解锁
        const slots: Slot[] = ms.map((m) => {
          const h = pickFreeHero(used, (m.meta.hero ?? 'nezha') as HeroId, can);
          used.push(h);
          return { id: m.id, name: m.name, hero: h, xw: m.meta.xw, sl: m.meta.sl };
        });
        const msg: Extract<HostMsg, { t: 'start' }> = { t: 'start', seed: Date.now() & 0xffff, slots, v: PROTOCOL, jie };
        link.send(JSON.stringify(msg));
        void close(new NetSession(link, msg));
        return;
      }
      ready = !ready;
      sfx.play(ready ? 'lobby.ready' : 'ui.click');
      link.setMeta(meta(), name);
      renderRoster();
    };
    onKey = (e) => {
      if (e.key === 'Escape') {
        void close(null);
        return 'consume';
      }
      navKeys(e, focusables, 'both');
      return 'consume';
    };
    renderRoster();
    // 刚进房：告诉房主「我在大厅里」——这一局已经在打的话，房主会让我等到商店（或者我原来就在这一局里，直接接回去）
    if (!link.isHost) link.send(JSON.stringify({ t: 'hello' }));
  };

  // ---------- 网络 ----------
  offs.push(
    link.on('transport', () => { if (link.directReady) directError = ''; if (view === 'room') renderRoster(); }),
    link.on('error', (code, message) => { if (code === 'direct') { directError = message; if (view === 'room') renderRoster(); } }),
    link.on('roster', () => {
      if (view !== 'room') return;
      // 有人进房、有人走（掉线）：各响一声（名字见 docs/audio.md「联机大厅」）；和上一份名单比，第一份的底是进房那一刻记下的（room()）
      const on = new Set(link.members.filter((m) => m.on && m.id !== link.me).map((m) => m.id));
      if (rosterSeen) {
        if ([...on].some((id) => !rosterSeen!.has(id))) sfx.play('lobby.join');
        else if ([...rosterSeen].some((id) => !on.has(id))) sfx.play('lobby.leave');
      }
      rosterSeen = on;
      renderRoster();
    }),
    link.on('state', () => view === 'room' && renderRoster()),
    link.on('host', () => {
      // 房主换人了（原来的房主走了）：新房主是自己的话，「准备」变成「开始」
      if (link.isHost) ready = false;
      if (view === 'room') renderRoster();
    }),
    link.on('gone', (why) => {
      waitText = why;
      if (view === 'room') renderRoster();
    }),
    link.on('data', (from, text) => {
      if (from !== link.host) return;
      const m = parseMsg<HostMsg>(text);
      if (!m) return;
      if (m.t === 'start') {
        if (m.v !== PROTOCOL) { waitText = '房主版本不同，请双方刷新后重新建房'; if (view === 'room') renderRoster(); return; }
        // 房主开局了（或者把中途进来的我加进了这一局）。人物分配里没有我（房主按开始的那一刻我才进来）：等商店
        if (m.slots.some((s) => s.id === link.me)) void close(new NetSession(link, m));
        else {
          waitText = '这一局刚开打：等到万宝阁（商店）就把你加进去';
          if (view === 'room') renderRoster();
        }
      } else if (m.t === 'wait') {
        waitText = m.why === 'full' ? '这一局人满了，等这一局打完' : '这一局正在打：等到万宝阁（商店）就把你加进去';
        if (view === 'room') renderRoster();
      }
    }),
  );

  const popKeys = pushKeys((e) => (closing ? 'consume' : onKey(e)));
  void swap(entry, true);
  return done;
}
