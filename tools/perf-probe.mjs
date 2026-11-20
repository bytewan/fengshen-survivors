// 低端手机性能的测量（结果和量法写在 docs/perf.md）。
//
// Playwright + CDP 的 CPU 降速（Emulation.setCPUThrottlingRate）模拟低端安卓，按手机横屏 / 竖屏、电脑的尺寸跑几个最重的场景，
// 记每一帧主线程花的时间（Pixi 时钟一帧的 update：feel.ts 的整帧 + 提交渲染）、帧间隔、长任务、JS 堆、纹理张数、显示对象数、
// 每帧的 WebGL 绘制次数与贴图上传次数；--profile 时整段测量窗口录一份 CPU 采样，按函数、按文件汇总（找热点）。
//
//   node tools/perf-probe.mjs [--port 5252] [--scenes boss1,yao,boss3,horde,swarm,net,arti,artiswarm,aobing,echo] [--sizes phoneL,phoneP,desk] [--rates 4,6]
//                             [--secs 20] [--warm 5] [--runs 1] [--paths /] [--q "&xx=1"] [--hz 60] [--quality high|low|auto] [--profile] [--soft]
//                             [--out scratch/perf/probe]
//
// - 开发服务器要开着（npx vite --port <端口> --strictPort）；联机场景（net）会自己在 --relay-port（默认 5353）起一个中继，量完关掉。
// - --paths：同一个服务器上的几份代码轮流量（比如 `/,/scratch/perf-base/`：当前工作区和改动前的快照），同一时刻前后对比；
//   快照的做法见 docs/perf.md「怎么量」。--runs N 时按「第 1 轮各份、第 2 轮各份……」交错着跑，最后每份取各轮的中位数。
// - 用真显卡（ANGLE Metal）：降速只作用在页面的主线程上，显卡那边不降；--soft 改用软件渲染（SwiftShader，显卡的活也压到 CPU 上）。
// - --hz 60（默认）：这台 Mac 的屏幕是 120 Hz，无头 Chromium 的 requestAnimationFrame 也跟着 120 次 / 秒；手机大多是 60 Hz，
//   所以在页面里把 requestAnimationFrame 卡成离上一次不到 12.5 毫秒就再等一个同步（隔一个同步回调一次，就是 60 Hz；一帧没做完，下一次最早在 25 毫秒）。
//   --hz 0 不卡。
// - 场景都开 ?bot（机器人替人打，种子固定为 7，模拟逐帧可复现），Math.random 也换成固定种子；进了波次之后人物锁血（不会打完就陨落），
//   之后才开始降速、预热 --warm 秒、量 --secs 秒。首领战的首领不锁血：机器人在量的这段时间里打不死它（量完会报首领还剩多少血）。
// - 输出：每一份一行汇总，另存 JSON（--out 前缀 + .json）；--profile 时另存 .cpuprofile，打印自身耗时最多的函数和文件。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(`--${k}`);
const PORT = Number(arg('port', 5252));
const RELAY_PORT = Number(arg('relay-port', 5353));
const SECS = Number(arg('secs', 20));
const WARM = Number(arg('warm', 5));
const RUNS = Number(arg('runs', 1));
const HZ = Number(arg('hz', 60));
const PROFILE = flag('profile');
const SOFT = flag('soft');
const EXTRA = arg('q', '');
const OUT = arg('out', 'scratch/perf/probe');
const PATHS = arg('paths', '/').split(',');
/** 画质档（设置里的「画质」，src/render/quality.ts）：high / low / auto。默认 high（和改动前那份可比；掉帧时装饰粒子照样会自己往下压）。 */
const QUALITY = arg('quality', 'high');
/** 首领战量哪一段：3（默认）= 进了波次就把首领的血压到第三阶段的门槛下面（量的是最重的最后一段，之后首领的血不低于一成五，量的时候打不死）；1 = 从开场量起。 */
const BOSS_PHASE = Number(arg('boss-phase', 3));

export const SIZES = {
  /** 手机横屏（iPhone 13 / 大多数安卓的横屏宽高）。 */
  phoneL: { w: 844, h: 390, dpr: 3, mobile: true, label: '手机横屏 844×390@3' },
  /** 手机竖屏。 */
  phoneP: { w: 390, h: 844, dpr: 3, mobile: true, label: '手机竖屏 390×844@3' },
  desk: { w: 1280, h: 720, dpr: 1, mobile: false, label: '电脑 1280×720' },
};
const ARTI = [
  ['wanya', 4, 'sky'],
  ['wenhuang', 4, 'five'],
  ['sihai', 4, 'four'],
  ['jinjiao', 4, 'four'],
];
export const SCENES = {
  boss1: { q: '?bot&wave=6', label: '第一章首领（魔化哪吒）' },
  yao: { q: '?bot&wave=12', label: '第二章首领（姚天君 + 十阵）' },
  boss3: { q: '?bot&wave=18', label: '第三章首领' },
  horde: { q: '?bot&wave=15&jie=5', label: '敌人最多（第三章第 3 波 · 劫五）' },
  /** 压力：同上，但敌人一直补到 280 只（模拟的同屏上限；刷在 250–320 像素外往人物身上涌）——打不动的玩家在劫五会遇到的满场。 */
  swarm: { q: '?bot&wave=15&jie=5', fill: 280, label: '满场 280 只（第三章第 3 波 · 劫五，一直补怪）' },
  /** 首领池里的敖丙（第一章首领，`?boss=aobing`）：冰龙、海浪、化龙、怒潮三面浪；同样压到第三阶段量。 */
  aobing: { q: '?bot&wave=6&boss=aobing', label: '第一章首领敖丙（第 6 波，第三阶段）' },
  /** 第 4 波：回响化身的遭遇战和刷怪并存（劫五）。 */
  echo: { q: '?bot&wave=4&jie=5', label: '第 4 波遭遇战 + 刷怪（劫五）' },
  /** 装满新法宝（2026-11-11 晚合进来的 11 件里画面最满的四件，都是神品）：万鸦壶 · 遮天、瘟癀伞 · 五瘟、四海瓶 · 四海、金蛟剪 · 四蛟。 */
  arti: { q: '?bot&wave=15&jie=5', loadout: ARTI, label: '装满新法宝（第三章第 3 波 · 劫五）' },
  artiswarm: { q: '?bot&wave=15&jie=5', loadout: ARTI, fill: 280, label: '装满新法宝 + 满场 280 只' },
  net: { host: '?online&bot&wave=15&jie=5', guest: '&bot', label: '两人联机 · 跟随者（第三章第 3 波 · 劫五）' },
};
const sceneIds = arg('scenes', 'boss1,yao,boss3,horde,swarm,net').split(',');
const sizeIds = arg('sizes', 'phoneL,phoneP,desk').split(',');
const rates = arg('rates', '4,6').split(',').map(Number);

const gpuArgs = SOFT
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const ARGS = [...gpuArgs, '--autoplay-policy=no-user-gesture-required'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (path) => `http://localhost:${PORT}${path === '/' ? '/' : path.endsWith('/') ? path + 'index.html' : path}`;

/** 页面里先装好的东西：固定种子的 Math.random、60 Hz 的 rAF、WebGL 计数、长任务。 */
function initScript({ seed, hz, q }) {
  try {
    localStorage.setItem('fs.v1.quality', q);
    localStorage.removeItem('fs.v1.autoQuality');
  } catch {}
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (hz > 0) {
    // 离上一次回调不到 3/4 个 60 Hz 帧（12.5 毫秒）就再等一个同步：120 Hz 的屏幕上就是隔一个同步回调一次（60 Hz）；
    // 一帧没做完时下一次回调最早在 25 毫秒（120 Hz 的下一个同步），算掉帧。（原来按「偶数个同步」卡，屏幕的实际刷新率不是正好 120 时奇偶会漂，误判掉帧）
    const raf = window.requestAnimationFrame.bind(window);
    const minGap = (1000 / hz) * 0.75;
    let last = -1e9;
    window.requestAnimationFrame = (cb) => {
      const f = (t) => {
        // 同一个同步里的几个回调一起放（last === t）；离上一次放行的同步不到 minGap 的整个同步都跳过
        if (t !== last && t - last < minGap) return raf(f);
        last = t;
        cb(t);
      };
      return raf(f);
    };
  }
  const pp = (window.__pp = { draws: 0, uploads: 0, longs: [], frames: null });
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = C.prototype;
    for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const f = P[k];
      if (f)
        P[k] = function (...x) {
          pp.draws++;
          return f.apply(this, x);
        };
    }
    for (const k of ['texImage2D', 'texSubImage2D']) {
      const f = P[k];
      P[k] = function (...x) {
        pp.uploads++;
        return f.apply(this, x);
      };
    }
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (pp.on) pp.longs.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: false });
  } catch {}
}

/** 进了波次之后：人物锁血；把 Pixi 时钟的 update 换成计时的那一份（每帧主线程的活 + 帧间隔 + 这一帧的绘制次数）。 */
async function arm(page, bossPhase = BOSS_PHASE, fill = 0, path = '/', loadout = null) {
  await page.evaluate(async ([bossPhase, fill, path, loadout]) => {
    const f = window.__feel;
    const pp = window.__pp;
    // 指定的法宝（[种类, 品阶, 器灵]）：换掉机器人在商店里买的那一套
    if (loadout) f.world.players[0].weapons = loadout.map(([kind, tier, spirit]) => ({ kind, tier, spirit: spirit ?? null, cd: 0.3 }));
    // 锁血：联机时房主这边锁所有人。首领战（bossPhase 3）：首领的血先压到第三阶段的门槛下面（三位首领的门槛都在三成上下），之后不低于一成五
    let pushed = bossPhase < 3;
    pp.lock = setInterval(() => {
      const w = window.__feel?.world;
      if (!w || window.__feel?.net?.()?.role === 'guest') return;
      for (const p of w.players) {
        if (p.stats.maxHp < 1e6) p.stats.maxHp = 1e6;
        p.hp = p.stats.maxHp;
      }
      const b = w.boss && w.phase === 'wave' ? w.enemies.find((e) => e.kind === 'boss') : null;
      if (!b) return;
      if (!pushed && w.boss.state !== 'intro') {
        b.hp = Math.min(b.hp, b.maxHp * 0.25);
        pushed = true;
      }
      if (pushed && bossPhase >= 3 && b.hp < b.maxHp * 0.15) b.hp = b.maxHp * 0.15;
    }, 16);
    if (fill > 0) {
      // 补怪：找到游戏正在用的那一份模块（开发服务器给改过的模块加 ?t=，直接 import 可能拿到另一份实例）
      const mod = (frag) => {
        const hit = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(frag)).pop();
        return import(hit ?? frag);
      };
      const W = await mod(`${path}src/sim/world.ts`);
      const E = await mod(`${path}src/sim/enemies.ts`);
      pp.fill = setInterval(() => {
        const w = window.__feel.world;
        if (w.phase !== 'wave') return;
        w.waveT = Math.min(w.waveT, w.waveLen * 0.8); // 这一波不结束
        const q = w.players[0];
        let n = 0;
        while (w.enemies.length < fill && n++ < 40) {
          const a = Math.random() * Math.PI * 2;
          const d = 250 + Math.random() * 70;
          W.spawnEnemy(w, E.spawnKind(w), q.x + Math.cos(a) * d, q.y + Math.sin(a) * d * 0.7, []);
        }
      }, 16);
    }
    const tk = f.stage.app.ticker;
    const upd = tk.update.bind(tk);
    pp.work = [];
    pp.gap = [];
    pp.draw = [];
    pp.up = [];
    pp.on = false;
    let last = 0;
    tk.update = (t) => {
      const d0 = pp.draws;
      const u0 = pp.uploads;
      const t0 = performance.now();
      upd(t);
      const t1 = performance.now();
      if (pp.on) {
        pp.work.push(t1 - t0);
        if (last) pp.gap.push(t0 - last);
        pp.draw.push(pp.draws - d0);
        pp.up.push(pp.uploads - u0);
      }
      last = t0;
    };
  }, [bossPhase, fill, path, loadout]);
}

function countTree(root) {
  // 在页面里跑：数显示对象（全部 / 看得见的）
  let all = 0;
  let vis = 0;
  const walk = (c, v) => {
    all++;
    const on = v && c.visible && c.alpha > 0;
    if (on) vis++;
    const ch = c.children;
    if (ch) for (let i = 0; i < ch.length; i++) walk(ch[i], on);
  };
  walk(root, true);
  return { all, vis };
}

async function collect(page, cdp) {
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  const r = await page.evaluate((countSrc) => {
    const pp = window.__pp;
    pp.on = false;
    const count = new Function(`return (${countSrc})`)();
    const f = window.__feel;
    const st = f.stage;
    const w = f.world;
    const boss = w.enemies.find((e) => e.kind === 'boss');
    const tree = count(st.scene);
    const s = f.stats();
    return {
      work: pp.work,
      gap: pp.gap,
      draw: pp.draw,
      up: pp.up,
      longs: pp.longs,
      tree,
      textures: st.app.renderer.texture.managedTextures.length,
      zoom: st.zoom,
      canvas: [st.app.canvas.width, st.app.canvas.height],
      enemies: w.enemies.length,
      particles: s.particles,
      phase: w.phase,
      wave: w.wave,
      bossHp: boss ? Math.round((boss.hp / boss.maxHp) * 100) : null,
      bossPhase: w.boss ? w.boss.phase : null,
      paused: s.paused,
      cine: s.cine,
      faults: s.faults,
      jsHeap: performance.memory ? performance.memory.usedJSHeapSize : 0,
      tier: f.quality ? `${f.quality.tier}${f.quality.setting === 'auto' ? '(自动)' : ''} 装饰${f.quality.decor.toFixed(2)}` : '',
    };
  }, countTree.toString());
  r.heapMB = heap ? +(heap.usedSize / 1048576).toFixed(1) : +(r.jsHeap / 1048576).toFixed(1);
  return r;
}

const pct = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0);
function summarize(r, secs) {
  const w = [...r.work].sort((x, y) => x - y);
  const g = [...r.gap].sort((x, y) => x - y);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    frames: w.length,
    fps: +(w.length / secs).toFixed(1),
    p50: +pct(w, 0.5).toFixed(2),
    p95: +pct(w, 0.95).toFixed(2),
    p99: +pct(w, 0.99).toFixed(2),
    mean: +mean(w).toFixed(2),
    max: +(w[w.length - 1] ?? 0).toFixed(1),
    gap50: +pct(g, 0.5).toFixed(1),
    gap95: +pct(g, 0.95).toFixed(1),
    /** 帧间隔超过 20 毫秒（60 Hz 下至少掉了一帧）的比例。 */
    drop: +((g.filter((x) => x > 20).length / Math.max(1, g.length)) * 100).toFixed(1),
    /** 帧间隔超过 50 毫秒（明显一顿）的次数。 */
    hitch: g.filter((x) => x > 50).length,
    longTasks: r.longs.length,
    longMax: Math.max(0, ...r.longs),
    draws: +mean(r.draw).toFixed(1),
    uploads: +mean(r.up).toFixed(1),
    heapMB: r.heapMB,
    textures: r.textures,
    objects: r.tree.all,
    visible: r.tree.vis,
    enemies: r.enemies,
    particles: r.particles,
    zoom: r.zoom,
    canvas: r.canvas.join('×'),
    end: `${r.tier ? r.tier + ' · ' : ''}${r.phase}${r.wave}${r.bossHp !== null ? ` 首领${r.bossHp}% 第${r.bossPhase}阶段` : ''}${r.paused ? ' 暂停' : ''}${r.cine ? ' ' + r.cine : ''}`,
    faults: Object.keys(r.faults ?? {}).length ? r.faults : undefined,
  };
}

// ---------- CPU 采样的汇总 ----------
function analyzeProfile(prof, top = 25) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const short = (u) => (u ? u.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace(/^\/node_modules\/\.vite\/deps\//, 'deps/') : '');
  const key = (n) => {
    const cf = n.callFrame;
    return `${cf.functionName || '(anon)'} ${short(cf.url)}:${cf.lineNumber + 1}`;
  };
  const self = new Map();
  const incl = new Map();
  const file = new Map();
  let total = 0;
  const dts = prof.timeDeltas;
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (dts[i + 1] ?? dts[i] ?? 0) / 1000; // 毫秒
    const leaf = byId.get(prof.samples[i]);
    const k = key(leaf);
    if (leaf.callFrame.functionName === '(idle)' || leaf.callFrame.functionName === '(program)') {
      self.set(k, (self.get(k) ?? 0) + dt);
      continue;
    }
    total += dt;
    self.set(k, (self.get(k) ?? 0) + dt);
    const f = short(leaf.callFrame.url) || leaf.callFrame.functionName;
    file.set(f, (file.get(f) ?? 0) + dt);
    const seen = new Set();
    for (let id = leaf.id; id !== undefined; id = parent.get(id)) {
      const kk = key(byId.get(id));
      if (seen.has(kk)) continue;
      seen.add(kk);
      incl.set(kk, (incl.get(kk) ?? 0) + dt);
    }
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { total, self: sorted(self).slice(0, top), incl: sorted(incl).filter(([k]) => /\/src\//.test(k)).slice(0, top), files: sorted(file).slice(0, top) };
}

// ---------- 一次测量 ----------
async function newPage(browser, size, path, q) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: size.mobile,
    hasTouch: size.mobile,
  });
  await ctx.addInitScript(initScript, { seed: 12345, hz: HZ, q: QUALITY });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!/GL Driver|WebGL|GroupMarkerNotSet|Unable to decode audio|swiftshader|Failed to load resource/i.test(t)) errs.push(t.slice(0, 200));
  });
  await page.goto(base(path) + q);
  return { ctx, page, errs };
}

let relay = null;
async function startRelay() {
  if (relay) return;
  relay = spawn(process.execPath, ['server/relay.mjs'], { env: { ...process.env, RELAY_PORT: String(RELAY_PORT), RELAY_HOST: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`http://127.0.0.1:${RELAY_PORT}/health`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(100);
  }
  throw new Error('中继没起来');
}

async function measureOnce(sceneId, sizeId, rate, path) {
  const scene = SCENES[sceneId];
  const size = SIZES[sizeId];
  const browsers = [];
  const launch = async () => {
    const b = await chromium.launch({ args: ARGS });
    browsers.push(b);
    return b;
  };
  try {
    let page;
    let ctx;
    let errs;
    if (sceneId === 'net') {
      await startRelay();
      const rq = `&relay=127.0.0.1:${RELAY_PORT}`;
      // 房主：不降速、电脑尺寸；跟随者：要量的那一边
      const H = await newPage(await launch(), SIZES.desk, path, scene.host + rq + EXTRA);
      await H.page.locator('button.ink', { hasText: '建房' }).click({ timeout: 30000 });
      await H.page.locator('.code-big').waitFor({ timeout: 15000 });
      const code = (await H.page.locator('.code-big').textContent()).trim();
      const G = await newPage(await launch(), size, path, `?room=${code}${scene.guest}${rq}${EXTRA}`);
      await G.page.locator('.code-big').waitFor({ timeout: 30000 });
      await G.page.locator('button.ink', { hasText: '准备' }).click();
      await H.page.waitForFunction(() => document.querySelectorAll('.fs-ui .lob .st.ok').length >= 1, null, { timeout: 15000 });
      await H.page.locator('button.ink', { hasText: '开始' }).click();
      await G.page.waitForFunction(() => window.__feel?.net?.()?.ready, null, { timeout: 60000 });
      await H.page.waitForFunction(() => window.__feel?.world?.phase === 'wave', null, { timeout: 180000 });
      await arm(H.page); // 房主这边锁血
      ({ page, ctx, errs } = G);
    } else {
      ({ page, ctx, errs } = await newPage(await launch(), size, path, scene.q + EXTRA));
    }
    await page.waitForFunction(() => window.__feel !== undefined, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__feel.world.phase === 'wave', null, { timeout: 180000 });
    await arm(page, BOSS_PHASE, scene.fill ?? 0, path === '/' ? '/' : path.replace(/index\.html$/, ''), scene.loadout ?? null);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await cdp.send('Performance.enable');
    await sleep(WARM * 1000);
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    if (PROFILE) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
    }
    await page.evaluate(() => {
      const pp = window.__pp;
      pp.work.length = pp.gap.length = pp.draw.length = pp.up.length = pp.longs.length = 0;
      pp.on = true;
    });
    const t0 = Date.now();
    await sleep(SECS * 1000);
    const secs = (Date.now() - t0) / 1000;
    const prof = PROFILE ? (await cdp.send('Profiler.stop')).profile : null;
    const raw = await collect(page, cdp);
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const per = (k) => +(((m1[k] - m0[k]) * 1000) / Math.max(1, raw.work.length)).toFixed(2);
    const sum = summarize(raw, secs);
    // 主线程上每帧平均：脚本、样式、排版（CDP 的累计值，含界面 DOM 的活；不只是 Pixi 那一帧）
    sum.script = per('ScriptDuration');
    sum.style = per('RecalcStyleDuration');
    sum.layout = per('LayoutDuration');
    sum.task = per('TaskDuration');
    if (errs.length) sum.errors = errs.slice(0, 3);
    return { sum, prof };
  } finally {
    for (const b of browsers) await b.close().catch(() => {});
  }
}

// ---------- 主程序 ----------
const results = [];
mkdirSync(dirname(OUT), { recursive: true });
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};
const fmt = (s) =>
  `中位 ${s.p50} p95 ${s.p95} p99 ${s.p99} 毫秒 · ${s.fps} 帧/秒 掉帧 ${s.drop}% 顿 ${s.hitch} · 长任务 ${s.longTasks}（最长 ${s.longMax}） · 绘制 ${s.draws}/帧 上传 ${s.uploads}/帧 · 堆 ${s.heapMB} MB 纹理 ${s.textures} 对象 ${s.objects}（可见 ${s.visible}） · 敌 ${s.enemies} 粒 ${s.particles} · 脚本 ${s.script} 样式 ${s.style} 排版 ${s.layout} 任务 ${s.task} 毫秒/帧 · ${s.canvas} · ${s.end}`;
try {
  for (const sceneId of sceneIds)
    for (const sizeId of sizeIds)
      for (const rate of rates) {
        const per = new Map(PATHS.map((p) => [p, []]));
        for (let run = 0; run < RUNS; run++)
          for (const path of PATHS) {
            const tag = `${sceneId} ${sizeId} ×${rate}${PATHS.length > 1 ? ' ' + path : ''}${RUNS > 1 ? ` #${run + 1}` : ''}`;
            try {
              const { sum, prof } = await measureOnce(sceneId, sizeId, rate, path);
              per.get(path).push(sum);
              console.log(`${tag}: ${fmt(sum)}${sum.errors ? ' 报错 ' + JSON.stringify(sum.errors) : ''}${sum.faults ? ' 出错 ' + JSON.stringify(sum.faults) : ''}`);
              if (prof) {
                const name = `${OUT}-${sceneId}-${sizeId}-x${rate}${PATHS.length > 1 ? '-' + path.replace(/\W+/g, '') : ''}-${run + 1}.cpuprofile`;
                writeFileSync(name, JSON.stringify(prof));
                const a = analyzeProfile(prof);
                console.log(`  CPU 采样（${(a.total / 1000).toFixed(1)} 秒在忙）→ ${name}`);
                console.log('  自身耗时最多的函数：');
                for (const [k, v] of a.self.slice(0, 18)) console.log(`    ${((v / a.total) * 100).toFixed(1).padStart(5)}%  ${k}`);
                console.log('  按文件（自身耗时）：');
                for (const [k, v] of a.files.slice(0, 18)) console.log(`    ${((v / a.total) * 100).toFixed(1).padStart(5)}%  ${k}`);
                console.log('  游戏代码的函数（含调用的，占忙的时间）：');
                for (const [k, v] of a.incl.slice(0, 22)) console.log(`    ${((v / a.total) * 100).toFixed(1).padStart(5)}%  ${k}`);
              }
            } catch (e) {
              console.log(`${tag}: 失败 ${e.message.slice(0, 300)}`);
            }
          }
        for (const [path, list] of per) {
          if (!list.length) continue;
          const keys = ['p50', 'p95', 'p99', 'mean', 'fps', 'drop', 'hitch', 'longTasks', 'draws', 'uploads', 'heapMB', 'textures', 'objects', 'script', 'task'];
          const med = Object.fromEntries(keys.map((k) => [k, median(list.map((s) => s[k]))]));
          results.push({ scene: sceneId, size: sizeId, rate, path, runs: list, median: med });
          if (RUNS > 1) console.log(`== ${sceneId} ${sizeId} ×${rate} ${path} 中位数：${JSON.stringify(med)}`);
        }
      }
} finally {
  relay?.kill();
  writeFileSync(`${OUT}.json`, JSON.stringify({ at: new Date().toISOString(), args: argv, results }, null, 1));
  console.log(`→ ${OUT}.json`);
}
