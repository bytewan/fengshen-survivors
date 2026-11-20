// 回响化身遭遇战的实验页（网址加 ?echolab=zhao 或 ?echolab=yunxiao）：在那一章的场景里摆一个打不死的人物和一位回响，
// 刷怪关掉，用真的模拟循环（world.step）一招一招地放（按招式表依次出），画面全走 echo-fx.ts（也就是游戏里的样子）。
// 截图用：?manual 手动时钟，window.__echolab.advance(dt, n) 推几帧并立刻重画；film(n, every, crop) 连拍拼成一张；
// pick(moves, phase) 从头开始、按这几招依次出（phase 2 = 直接从二阶段开始）；kill() 打倒它；leave() 让这一波结束（它退走）。
// 首领池（sim/bosspool.ts）之后回响也能当章节首领：网址再加 &chief 就按当首领的打法摆（三个阶段，pick 的 phase 可以给 3）。
import { Sprite, type Texture } from 'pixi.js';
import { createStage } from '../render/stage.ts';
import { Particles, Shake } from '../render/juice.ts';
import { textureFromGrid } from '../render/textures.ts';
import { Sfx } from '../audio/sfx.ts';
import { ARENA } from '../sim/config.ts';
import { createWorld, step, type PlayerInput, type SimEvent, type World } from '../sim/world.ts';
import { ECHO, echoEnemy, echoOf, startEcho, type EchoKind, type EchoMove } from '../sim/echo/index.ts';
import { chiefWaveOf, guestWaveOf } from '../sim/bosspool.ts';
import { spawnAt } from '../sim/world.ts';
import { heroFrames, HERO_VIEWS } from './hero-views.ts';
import { EchoFx } from './echo-fx.ts';
import { warnLayer } from './warn-fx.ts';

export async function startEchoLab(mount: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const manual = params.has('manual');
  const q = params.get('echolab');
  const kind = (q === 'yunxiao' || q === 'aobing' ? q : 'zhao') as EchoKind;
  const chief = params.has('chief');
  const wave = chief ? chiefWaveOf(kind) : guestWaveOf(kind);
  const stage = await createStage(mount, ARENA.w, ARENA.h, undefined, wave >= 13 ? 'jiepai' : wave >= 7 ? 'xiqi' : 'plaza');
  const { app } = stage;
  const sfx = new Sfx();
  addEventListener('pointerdown', () => sfx.unlock());
  const particles = new Particles(stage.fx, stage.tex.dot);
  const glows = new Particles(stage.glow, stage.tex.dot);
  const shake = new Shake(6, 4, 1.7);
  warnLayer(stage); // 预警层在法宝的地面效果之后、影子之前（同 feel.ts）
  const fx = new EchoFx(stage, particles, glows, shake, sfx);

  const hero = 'nezha';
  const view = HERO_VIEWS[hero];
  const tex: Texture[] = heroFrames(hero).idle.map(textureFromGrid);
  const heroS = new Sprite(tex[0]);
  heroS.anchor.set(view.anchor.x / view.w, view.anchor.y / view.h);
  stage.entities.addChild(heroS);
  const heroSh = new Sprite(stage.tex.shadow);
  heroSh.anchor.set(0.5);
  heroSh.alpha = 0.4;
  stage.floor.addChild(heroSh);

  const HX = ARENA.w / 2 - 40;
  const HY = ARENA.h / 2 + 20;
  let world: World;
  let clock = 0;
  let moves: EchoMove[] = kind === 'aobing' ? ['ji', 'icelong', 'tide'] : kind === 'yunxiao' ? ['dou', 'river', 'luan'] : ['beads', 'whip', 'tiger'];

  function setup(phase = 1) {
    fx.clear();
    world = createWorld(5, 1, ['nezha']);
    world.wave = wave;
    world.waveLen = 1e9;
    world.spawnAcc = -1e12;
    world.eliteDone = true;
    world.surgeDone = true;
    const p = world.players[0];
    p.x = p.px = HX;
    p.y = p.py = HY;
    p.weapons = [];
    p.pet.cd = 1e12;
    p.stats.maxHp = p.hp = 1e6;
    const ev: SimEvent[] = [];
    startEcho(world, kind, ev, (k, x, y) => spawnAt(world, k, x, y, ev), !chief);
    const f = echoOf(world)!;
    f.queue = [...moves];
    // 站在人物右边一点
    const e = echoEnemy(world)!;
    e.x = e.px = HX + 120;
    e.y = e.py = HY - 10;
    if (phase >= 2) {
      // 直接从这一阶段开始：气血放到这一阶段的线上（当首领时六成、三成；遭遇战一半），底线由模拟每帧自己对
      f.phase = Math.min(phase, chief ? 3 : 2);
      e.hp = Math.ceil(e.maxHp * (chief ? ECHO.chief.phases[f.phase - 2] : ECHO.phaseAt));
      f.state = 'idle';
      f.t = 0;
      f.dur = 0.6;
      e.invuln = 0;
      delete e.hpFloor;
    }
    for (const x of ev) fx.onEvent(x, world);
    clock = 0;
  }

  const idle: PlayerInput = { mx: 0, my: 0, skill: false };
  function tick(dt: number) {
    clock += dt;
    let left = dt;
    while (left > 1e-9) {
      const d = Math.min(1 / 60, left);
      left -= d;
      const p = world.players[0];
      const ev = step(world, [idle]);
      // 人物钉在原地、一直满血（看招式本身，不看人被打飞）
      p.x = HX;
      p.y = HY;
      p.blowX = p.blowY = 0;
      p.hp = p.stats.maxHp;
      p.iframes = 0;
      const f = echoOf(world);
      if (f && !f.queue.length && f.state === 'recover') f.queue = [...moves]; // 一轮放完再从头放
      for (const e of ev) fx.onEvent(e, world);
    }
    draw(dt);
  }

  function draw(dt: number) {
    const p = world.players[0];
    heroS.texture = tex[Math.floor(clock * 5) % tex.length];
    heroS.position.set(Math.round(p.x), Math.round(p.y));
    heroS.zIndex = Math.round(p.y);
    heroSh.position.set(Math.round(p.x), Math.round(p.y));
    fx.update(dt, world, 1);
    particles.update(dt);
    glows.update(dt);
    shake.update(dt);
    stage.lookAt(HX + 40, HY - 12, 0, 0);
    stage.update(dt);
  }

  setup();
  if (manual) app.ticker.stop();
  else app.ticker.add((t) => tick(Math.min(0.05, t.deltaMS / 1000)));

  const api = {
    get world() {
      return world;
    },
    pick(ms: EchoMove[], phase = 1) {
      moves = ms;
      setup(phase);
    },
    advance(dt: number, n = 1) {
      for (let i = 0; i < n; i++) tick(dt);
      app.renderer.render(app.stage);
    },
    kill() {
      const e = echoEnemy(world);
      const f = echoOf(world);
      if (!e || !f) return;
      f.phase = chief ? 3 : 2;
      delete e.hpFloor;
      e.invuln = 0;
      e.hp = 0;
    },
    leave() {
      world.waveLen = world.waveT + 0.01;
    },
    film(n: number, every: number, crop: [number, number, number, number], scale = 3, cols = 4, sub = 4) {
      const [cx, cy, cw, ch] = crop;
      const rows = Math.ceil(n / cols);
      const out = document.createElement('canvas');
      out.width = cols * (cw * scale + 4) + 4;
      out.height = rows * (ch * scale + 4) + 4;
      const g = out.getContext('2d')!;
      g.fillStyle = '#100c14';
      g.fillRect(0, 0, out.width, out.height);
      g.imageSmoothingEnabled = false;
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < sub; s++) tick(every / sub);
        app.renderer.render(app.stage);
        const z = stage.zoom;
        g.drawImage(app.canvas, cx * z, cy * z, cw * z, ch * z, 4 + (i % cols) * (cw * scale + 4), 4 + Math.floor(i / cols) * (ch * scale + 4), cw * scale, ch * scale);
      }
      return out.toDataURL('image/png');
    },
  };
  (window as unknown as { __echolab: typeof api }).__echolab = api;
}
