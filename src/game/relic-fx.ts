// 灵物、符箓、丹药的画面（表现层）：M3 新加的、有自己机制的那些（机制在 sim/relics.ts）。
// 读模拟状态（Player.relic、Enemy.revealUntil）和事件（relic），只作用在表现层；接口仿照 technique-fx.ts：onEvent / update / clear，
// 另外自己认得「换了一局」（world 换了），到时自己清空（feel.ts 只要喂事件、每帧调 update）。
// 用户口径：小、克制，人物和武器身上不画发光圆圈 / 光圈 / 光晕，用像素小精灵、细线；出现和消失都要有过程，不要一闪而过。
// 地面是浅色的玉台：一像素的浅色粒子在上面几乎看不见，所以要看得清的那几粒用「小尘」（两三像素、描一圈同色系深色边的小精灵）。
// 几处借了 pixelfx 的修仙预设（src/render/pixelfx-xianxia.ts）：风雷羽的紫翎落雷 stormHit、九龙玉佩的龙气 jadeDragon、金刚琢砸中 zhuoLand、
// 引雷符的小天雷 thunderDrop 和金雷纹 zapHitGold、黄符化去、噬心蛊、燃魂香、混元伞、夔牛鼓（xianxia/relic-charm）—— 开局时预先画好。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { grid, outline, type Grid } from '../art/pixel.ts';
import { GEM } from '../art/sprites/icons.ts';
import { textureFromGrid } from '../render/textures.ts';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import { PixelFxLayer, prebakeAll, type FxHandle } from '../render/pixelfx.ts';
import { XFX } from '../render/pixelfx-xianxia.ts';
import { pixelTextTexture } from '../render/pixel-text.ts';
import type { Sfx } from '../audio/sfx.ts';
import { BANK } from '../audio/bank.ts';
import { RELIC } from '../sim/catalog.ts';
import type { Enemy, Player, ReactionKind, RelicEvent, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { foeLooks, type FoeViewKind } from './enemy-views.ts';
import { puffSet } from './fx.ts';
import { MirrorFx } from './relic-mirror.ts';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const TAU = Math.PI * 2;
const GOLD = [0xf7dc7a, 0xe0a83a, 0xb06a28];
const DUST = [0x9a8a86, 0x6b5a62, 0x4a3b4a];

// ---------------------------------------------------------------- 像素图

/** 小尘：一两个像素的芯，外面描一圈同色系的深色（不是玄色描边：软一些，还是看得清）。key → [芯, 边]。 */
const MOTE: Record<string, [string[], string]> = {
  gold: [['Y'], 'b'], // 入定的金尘、金刚琢的金屑
  gold2: [['fY'], 'b'],
  dust: [['j'], 'h'], // 石屑、鼓震起的尘
  earth: [['b'], 'B'], // 遁地的土块
  earth2: [['yb'], 'B'],
  cloud: [['ww'], 'i'], // 踏云的云丝
  cloud2: [['w'], 'i'],
  wind: [['wwj'], 'i'], // 神行的风丝（拉长）
  petal: [['mw'], 'm'], // 桃木簪的桃花瓣（月白芯、桃红边：魔气是深紫的，浅色的瓣才看得见）
  petal2: [['w'], 'm'],
  scale: [['oe'], 'R'], // 逆鳞崩起的鳞屑
  ember: [['o'], 'r'], // 鼓劲的火星、燃魂的火
  demon: [['m'], 'P'], // 噬心蛊、燃魂香被噬去的血气
  qi: [['C'], 'n'], // 回灵符、凝神丹收进来的灵气
  qi2: [['W'], 'c'],
  ink: [['p'], 'P'], // 混元伞下散掉的鬼火
  pearl: [['w'], 'j'],
  // 九龙玉佩的龙息（按相生着色）
  frost: [['W'], 'c'],
  conduct: [['L'], 'v'],
  ignite: [['Y'], 'e'],
  lava: [['o'], 'B'],
  pierce: [['W'], 'y'],
  jade: [['L'], 'v'],
  // 照妖镜的镜光碎点、定颜珠的闪光
  mirror: [['W'], 'C'],
  glint: [['.W.', 'WfW', '.W.'], 'y'],
};
/** 星芒（定颜珠打中定住的敌人、凝神丹收完那一下）：一点 → 十字 → 八角 → 十字 → 一点，缃描边。 */
const TWINKLE = [['W'], ['.W.', 'WfW', '.W.'], ['W...W', '.fWf.', '.WWW.', '.fWf.', 'W...W'], ['.W.', 'WfW', '.W.'], ['f']].map((r) => outline(pad(grid(r)), 'y'));
/** 九龙玉佩炸开的小尘：跟着触发的那种相生走（凝霜冰、导雷青绿、引燃火、熔岩赭红、淬锋金白），中间几缕玉色的龙气。 */
const BREATH: Record<ReactionKind, string> = { frost: 'frost', conduct: 'conduct', ignite: 'ignite', lava: 'lava', pierce: 'pierce' };

/**
 * 金刚琢：一枚金镯，转着飞（三帧：正面的椭圆、侧过来一半、立成一道边，来回换着显得在转）。
 * 藤黄、缃的环身，受光的上沿一点白，赭色描边（浅色地面上也看得清）；中间是空的（原来是一圈套一圈的银环，看着像准星）。
 */
const ZHUO = [
  ['..BBBBB..', '.BYfYyyB.', 'By.....bB', '.BbyyybB.', '..BBBBB..'],
  ['..BBB..', '.BYfyB.', 'By...bB', '.BbybB.', '..BBB..'],
  ['.B.', 'BfB', 'ByB', 'BbB', '.B.'],
].map((r) => pad(grid(r)));
// ---------------------------------------------------------------- 状态

interface Fade {
  s: Sprite | Graphics;
  t: number;
  life: number;
  fadeIn: number;
  fadeOut: number;
  vy?: number;
  frames?: Texture[];
  fps?: number;
  peak?: number;
  /** 跟着人物走（相对人物脚下的偏移）：伞、飘字 */
  owner?: number;
  dx?: number;
  dy?: number;
  pop?: number; // 弹开：前 pop 秒从 0.4 倍长到原大
  delay?: number; // 晚几秒才出现
}
interface Fly {
  s: Sprite;
  t: number;
  dur: number;
  x0: number;
  y0: number;
  id: number; // 飞向的敌人（跟着它走）
  x1: number;
  y1: number;
  frames: Texture[];
  trail: number; // 距下一粒拖尾的金屑
  echo: Sprite[]; // 身后两道残影（转着飞的镯子拖出一点弧）
}
/** 一粒小尘（或一个小东西）：有速度、阻力、重力，落到 ground 就停，最后一段慢慢淡掉。 */
interface Mote {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  t: number;
  life: number;
  fadeIn: number;
  ground: number;
}
interface Timed {
  h: FxHandle;
  end: number;
}
interface MoteOpts {
  g?: number;
  drag?: number;
  fadeIn?: number;
  ground?: number;
  delay?: number;
}

export class RelicFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private hero: ((owner: number) => Sprite | undefined) | null;
  private layer = new Container();
  private pfx: PixelFxLayer;
  private fades: Fade[] = [];
  private flies: Fly[] = [];
  private motes: Mote[] = [];
  private timed: Timed[] = [];
  private mirrorFx: MirrorFx;
  private revealed = new Map<number, [number, number, number, number]>();
  private world: World | null = null;
  private byId = new Map<number, Enemy>();
  private ixTick = -1;
  private alpha = 1;
  private clock = 0;
  private acc = new Map<string, number>(); // 持续效果的小尘按「每秒几粒」攒着发
  private lowWas = new Map<number, boolean>(); // 逆鳞：上一帧是不是已经在低血
  private dunWas = new Map<number, boolean>(); // 遁地符：上一帧是不是还在地下
  private tops: Partial<Record<FoeViewKind, number>> = {};
  private moteTex: Record<string, Texture> = {};
  private zhuoTex: Texture[];
  private gemTex: Texture;
  private twinkleTex: Texture[];
  /** 调试：每种 relic 事件收到过几次（截图脚本、控制台看接没接上）。 */
  readonly seen: Record<string, number> = {};

  /** hero：每个人物的精灵（遁地符要把人物画淡）；不给就不画淡。 */
  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx, hero?: (owner: number) => Sprite | undefined) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.hero = hero ?? null;
    for (const [k, [rows, edge]] of Object.entries(MOTE)) this.moteTex[k] = textureFromGrid(outline(pad(grid(rows)), edge));
    this.zhuoTex = ZHUO.map(textureFromGrid);
    this.gemTex = textureFromGrid(GEM);
    this.twinkleTex = TWINKLE.map(textureFromGrid);
    stage.fx.addChild(this.layer);
    this.mirrorFx = new MirrorFx(this.layer);
    this.pfx = new PixelFxLayer(stage.fx);
    for (const [k, v] of Object.entries(foeLooks())) this.tops[k as FoeViewKind] = v.top;
    // 用到的 pixelfx 预设先画好（一个接一个、中间让出主线程）；画不出来就只是少了那几处点缀
    void prebakeAll(Object.entries(PFX).map(([key, x]) => ({ key: `relic.${key}`, id: x.id, opts: x.opts }))).catch((e) => console.warn('relic-fx 预烘焙', e));
    // 调试：控制台里 __relicFx 看状态、手动放效果（scratch 里的截图脚本用它）
    (globalThis as unknown as { __relicFx?: RelicFx }).__relicFx = this;
  }

  /** 名字表（docs/audio.md）里有素材就放它，没有就放 fallback（现有的相近的声音）。 */
  private play(name: string, fallback?: string, vol = 1) {
    const n = BANK[name] ? name : fallback;
    if (n) this.sfx.play(n, vol);
  }

  /** 清空（换了一局时）。 */
  clear() {
    for (const f of this.fades) f.s.destroy();
    this.fades = [];
    for (const f of this.flies) {
      f.s.destroy();
      for (const g of f.echo) g.destroy();
    }
    this.flies = [];
    for (const m of this.motes) m.s.destroy();
    this.motes = [];
    this.mirrorFx.clear();
    this.timed = [];
    this.pfx.clear();
    this.acc.clear();
    this.lowWas.clear();
    this.dunWas.clear();
  }

  private fade(s: Sprite | Graphics, life: number, fadeIn: number, fadeOut: number, more: Partial<Fade> = {}) {
    s.alpha = fadeIn > 0 || more.delay ? 0 : (more.peak ?? 1);
    this.fades.push({ s, t: -(more.delay ?? 0), life, fadeIn, fadeOut, ...more });
  }

  /** 放一段逐帧的小动画（星芒、云团、尘团）：frames 按 life 均分着播，最后一段淡掉。 */
  private anim(frames: Texture[], x: number, y: number, life: number, o: { fadeOut?: number; peak?: number; delay?: number; vy?: number } = {}) {
    const s = this.sprite(frames[0], x, y);
    this.fade(s, life, 0.03, o.fadeOut ?? life * 0.4, { frames, fps: frames.length / life, peak: o.peak, delay: o.delay, vy: o.vy });
  }

  private sprite(tex: Texture, x: number, y: number, ax = 0.5, ay = 0.5) {
    const s = new Sprite(tex);
    s.anchor.set(ax, ay);
    s.position.set(Math.round(x), Math.round(y));
    this.layer.addChild(s);
    return s;
  }

  /** 放一粒小尘：kind 是 MOTE 里的一种（或直接给贴图），(vx, vy) 像素 / 秒。 */
  private mote(kind: string | Texture, x: number, y: number, vx: number, vy: number, life: number, o: MoteOpts = {}) {
    const s = this.sprite(typeof kind === 'string' ? this.moteTex[kind] : kind, x, y);
    s.alpha = 0;
    this.motes.push({ s, x, y, vx, vy, g: o.g ?? 0, drag: o.drag ?? 2, t: -(o.delay ?? 0), life, fadeIn: o.fadeIn ?? 0.06, ground: o.ground ?? 1e9 });
  }

  /** 一圈往外迸的小尘（角度、快慢都错开，不成一个圈）。 */
  private burst(kinds: string[], x: number, y: number, n: number, speed: [number, number], life: [number, number], o: MoteOpts & { up?: number } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.4, 0.4);
      const sp = rnd(speed[0], speed[1]);
      this.mote(pick(kinds), x, y, Math.cos(a) * sp, Math.sin(a) * sp * 0.7 - (o.up ?? 0), rnd(life[0], life[1]), o);
    }
  }

  /** 人物此刻（插值后）的脚下位置。 */
  private at(p: Player): [number, number] {
    return [p.px + (p.x - p.px) * this.alpha, p.py + (p.y - p.py) * this.alpha];
  }

  private enemyAt(id: number): [number, number] | null {
    const e = this.byId.get(id);
    if (!e || e.hp <= 0) return null;
    return [e.px + (e.x - e.px) * this.alpha, e.py + (e.y - e.py) * this.alpha];
  }

  private top(e: Enemy | undefined) {
    return e ? (e.kind === 'boss' ? 36 : (this.tops[e.kind as FoeViewKind] ?? 22)) : 22;
  }

  private indexEnemies(w: World) {
    if (this.ixTick === w.tick && this.byId.size === w.enemies.length) return;
    this.byId.clear();
    for (const e of w.enemies) this.byId.set(e.id, e);
    this.ixTick = w.tick;
  }

  /** 按「每秒 rate 粒」攒着发：返回这一帧该发几粒。 */
  private due(key: string, rate: number, dt: number) {
    const v = (this.acc.get(key) ?? 0) + rate * dt;
    const n = Math.floor(v);
    this.acc.set(key, v - n);
    return n;
  }

  onEvent(e: SimEvent, w: World) {
    if (w !== this.world) {
      this.clear();
      this.world = w;
    }
    // 一波开始 / 结束不清场：开波时的乾坤袋、噬心蛊、夔牛鼓和波末的冰心玉壶都排在 waveStart / waveEnd 之前发，清了就看不见了；
    // 上一波留下的都很短，跟着敌人的（小黄符、镜子、金刚琢）敌人一清就自己收掉
    if (e.t !== 'relic') return;
    this.indexEnemies(w);
    this.relic(e, w);
  }

  private relic(e: RelicEvent, w: World) {
    this.seen[e.kind] = (this.seen[e.kind] ?? 0) + 1;
    switch (e.kind) {
      case 'zhuo':
        this.zhuo(e);
        break;
      case 'jadedragon':
        this.breath(e);
        break;
      case 'mirror':
        this.mirror(e, w);
        break;
      case 'umbrella':
        this.umbrella(e);
        break;
      case 'pouch':
        this.pouch(e);
        break;
      case 'stormfeather':
        this.storm(e);
        break;
      case 'cloudshoe':
        // 踏云：脚下两侧各鼓起一团祥云（月白、天青边）慢慢散开，几缕云丝往后拖
        for (const side of [-1, 1]) this.anim(puffSet(4, 'snow', side > 0 ? 2 : 1), e.x + side * 5, e.y - 2, 0.6, { peak: 0.9, vy: -4 });
        this.burst(['cloud', 'cloud2'], e.x, e.y - 1, 5, [12, 26], [0.4, 0.6], { drag: 3 });
        break;
      case 'dingyan':
        this.glint(e);
        break;
      case 'icevase':
        this.label(e.owner, `无伤 +${e.v ?? 0}`, ['w', 'C'], 'n', 1.8);
        this.burst(['qi2', 'qi'], e.x, e.y - 14, 8, [10, 22], [0.6, 0.9], { up: 10, drag: 2 });
        this.play('relic.icevase', 'react.frost', 0.5);
        break;
      case 'gu':
        this.label(e.owner, `-${e.v ?? 0}`, ['m', 'p'], 'P', 1.2);
        this.onHero('guBite', e);
        this.play('relic.gu', 'huaxue.drain', 0.6);
        break;
      case 'drum':
        this.drum(e);
        break;
      case 'incense':
        this.onHero('incenseCurl', e);
        this.play('relic.incense', 'huaxue.drain', 0.5);
        break;
      case 'dingshen':
        this.dingshen(e);
        break;
      case 'yinlei':
        this.yinlei(e);
        break;
      case 'dundi':
        this.dirt(e.x, e.y, 12);
        for (const side of [-1, 1]) this.anim(puffSet(5, 'stone', side > 0 ? 3 : 1), e.x + side * 5, e.y - 3, 0.65, { peak: 0.8, vy: -3 });
        this.play('relic.dundi', 'fantian.land', 0.4);
        break;
      case 'shenxing':
        for (let i = 0; i < 6; i++) this.mote('wind', e.x + rnd(-6, 6), e.y - rnd(1, 10), rnd(-30, 30), 0, rnd(0.3, 0.45), { drag: 3 });
        break;
      case 'zhaobao':
        this.onHero('talismanBurnLow', e);
        break;
      case 'huiling':
        this.gather(e.owner, ['qi', 'qi2'], 12);
        this.play('relic.huiling', 'pet.evolve', 0.35);
        break;
      case 'ningshen':
        this.gather(e.owner, ['qi2', 'gold'], 10);
        break;
    }
  }

  // ---------- 一次性的 ----------

  /** 金刚琢印：一枚小银镯从人物头顶飞起、转着砸到身边的敌人身上（每只一枚，最多四枚），拖一串金屑；砸中处迸石屑。 */
  private zhuo(e: RelicEvent) {
    const pts = (e.pts ?? []).slice(0, 4);
    const ids = e.ids ?? [];
    pts.forEach(([x1, y1], i) => {
      const echo = [0.4, 0.18].map((a) => {
        const g = this.sprite(this.zhuoTex[0], e.x, e.y - 30);
        g.visible = false;
        g.alpha = a;
        return g;
      });
      const s = this.sprite(this.zhuoTex[0], e.x, e.y - 30);
      s.visible = false;
      this.flies.push({ s, t: -i * 0.06, dur: 0.3, x0: e.x, y0: e.y - 30, id: ids[i] ?? -1, x1, y1, frames: this.zhuoTex, trail: 0, echo });
    });
    this.sparks.emit(e.x, e.y - 30, 6, GOLD, [12, 26], [0.3, 0.45], { drag: 3 });
    this.play('relic.zhuo', 'xinghuang.block', 0.6);
  }

  /** 金刚琢砸中：石屑往外崩、落地，金屑上飘，一点震屏。 */
  private zhuoLand(x: number, y: number) {
    this.pfx.playBaked('relic.zhuoLand', PFX.zhuoLand.id, PFX.zhuoLand.opts, { x, y: y + 1 });
    this.shake.add(0.08);
    this.play('relic.zhuo.land', 'fantian.land', 0.35);
  }

  /** 九龙玉佩：那只敌人身上吐出一口龙息 —— 一小团按相生着色的小尘往外散开，中间三缕玉色的龙气往上一卷。 */
  private breath(e: RelicEvent) {
    const t = this.byId.get(e.id ?? -1);
    const y = e.y - this.top(t) * 0.45;
    const r = e.r ?? RELIC.jadedragon.r;
    const k = BREATH[e.react ?? 'ignite'];
    // 相生的五行色碎屑往外散开，一缕玉色的龙气盘旋着升起（pixelfx jadeDragon）
    this.burst([k, k, 'jade'], e.x, y, 7, [r * 1.6, r * 2.6], [0.4, 0.6], { drag: 4.5 });
    this.pfx.playBaked('relic.jadeDragon', PFX.jadeDragon.id, PFX.jadeDragon.opts, { x: e.x, y: this.chestY(e.y, t), flip: Math.random() < 0.5 });
    this.play('relic.jadedragon', 'react.conduct', 0.35);
  }

  /** 照妖镜：古镜在人物肩侧浮现、一束镜光照过去、照出原形和破绽（relic-mirror.ts）。 */
  private mirror(e: RelicEvent, w: World) {
    const owner = e.owner;
    const id = e.id ?? -1;
    let last: [number, number, number] = [e.x, e.y, this.top(this.byId.get(id))];
    this.mirrorFx.cast({
      hero: () => {
        const p = this.world?.players[owner] ?? w.players[owner];
        return p && p.alive && !p.left ? this.at(p) : null;
      },
      foe: () => {
        const q = this.enemyAt(id);
        if (q) last = [q[0], q[1], this.top(this.byId.get(id))];
        return last;
      },
    });
    this.play('relic.mirror', 'yinyang.beam', 0.4);
  }

  /** 混元伞：头顶上面一点撑开一把小伞（弹开、停一下、慢慢淡掉），鬼火在伞下散成几点墨紫，伞沿抖下两粒珍珠。 */
  private umbrella(e: RelicEvent) {
    this.onHero('umbrellaOpen', e);
    this.play('relic.umbrella', 'xinghuang.block', 0.5);
  }

  /** 乾坤袋：几粒灵石从人物腰间蹦出来、落回脚边化掉，头顶飘一个「+n」。 */
  private pouch(e: RelicEvent) {
    const n = Math.min(6, e.v ?? 1);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rnd(-0.9, 0.9);
      const sp = rnd(40, 70);
      this.mote(this.gemTex, e.x, e.y - 10, Math.cos(a) * sp, Math.sin(a) * sp, 0.85, { g: 220, drag: 1, delay: i * 0.06, ground: e.y + rnd(-1, 3) });
    }
    this.label(e.owner, `+${e.v ?? 0}`, ['w', 'C'], 'n', 1.2);
    this.play('relic.pouch', 'pickup', 0.6);
  }

  /** 风雷羽：头顶浮出一枚紫翎，一道紫白的雷劈到那只胸口，紫翎打着旋飘落（pixelfx stormHit）。 */
  private storm(e: RelicEvent) {
    const t = this.byId.get(e.id ?? -1);
    this.pfx.playBaked('relic.stormHit', PFX.stormHit.id, PFX.stormHit.opts, { x: e.x, y: this.chestY(e.y, t), flip: Math.random() < 0.5 });
    this.shake.add(0.03);
    this.play('relic.stormfeather', 'leigong.strike', 0.3);
  }

  /** 预设按胸口离脚 11 像素画（回响兵）：高个子的敌人把原点往上挪，胸口对上。 */
  private chestY(y: number, t: Enemy | undefined) {
    return Math.round(y - Math.max(0, this.top(t) * 0.5 - 11));
  }

  /** 定颜珠：打中定住的敌人时，那一处闪一下金白的小星（同一只隔一会儿才闪一次，模拟里限过）。 */
  private glint(e: RelicEvent) {
    const t = this.byId.get(e.id ?? -1);
    const y = e.y - this.top(t) * 0.7;
    this.anim(this.twinkleTex, e.x + rnd(-3, 3), y, 0.45, { vy: -6 });
    for (let i = 0; i < 2; i++) this.mote('petal2', e.x + rnd(-4, 4), y + 3, rnd(-12, 12), -rnd(6, 12), rnd(0.4, 0.55), { drag: 2, delay: 0.05 + i * 0.06 });
  }

  /** 夔牛鼓：擂一通 —— 脚下往两边震起一层尘、几粒朱砂火星，一下很轻的震屏和鼓声。 */
  private drum(e: RelicEvent) {
    this.onHero('drumBeat', e);
    this.shake.add(0.05);
    this.play('relic.drum', 'drum', 0.7);
  }

  /**
   * 定身符：一张小黄符从人物身上飞起、烧掉。定住的敌人额头贴的小黄符、头顶转的三粒小金星（stunSeal）由 xfx.ts 画——
   * 那边给所有晕住、定住的敌人贴（2026-11-11 fx-wire），这里再贴一张就叠两层了。
   */
  private dingshen(e: RelicEvent) {
    this.onHero('talismanBurn', e);
    this.play('relic.dingshen', 'kunxian.bind', 0.5);
  }

  /** 引雷符：黄符烧掉，一道小天雷落在人物身上（thunderDrop），劈到的敌人身上各闪一下金雷纹。 */
  private yinlei(e: RelicEvent) {
    this.onHero('talismanBurn', e);
    this.pfx.playBaked('relic.thunderDrop', PFX.thunderDrop.id, PFX.thunderDrop.opts, { x: e.x, y: e.y });
    for (const id of (e.ids ?? []).slice(0, 10)) {
      const t = this.byId.get(id);
      if (t) this.pfx.playBaked('relic.zapHitGold', PFX.zapHitGold.id, PFX.zapHitGold.opts, { x: t.x, y: t.y - this.top(t) * 0.5 });
    }
    this.shake.add(0.22);
    this.play('relic.yinlei', 'leigong.strike', 0.8);
  }

  /** 遁地 / 冒出来：脚下的土块崩起来再落下。 */
  private dirt(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rnd(-1.2, 1.2);
      const sp = rnd(30, 65);
      this.mote(pick(['earth', 'earth2', 'dust']), x + rnd(-4, 4), y - 1, Math.cos(a) * sp, Math.sin(a) * sp, rnd(0.45, 0.65), { g: 260, drag: 1, ground: y + rnd(0, 3) });
    }
  }

  /** 回灵符 / 凝神丹：几粒灵光从四周收进人物身上。 */
  private gather(owner: number, kinds: string[], n: number) {
    const p = this.world?.players[owner];
    if (!p) return;
    const [x, y] = this.at(p);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU);
      const r = rnd(16, 26);
      const T = 0.5;
      this.mote(pick(kinds), x + Math.cos(a) * r, y - 12 + Math.sin(a) * r * 0.7, (-Math.cos(a) * r) / T, (-Math.sin(a) * r * 0.7) / T, T, { drag: 0, delay: i * 0.025 });
    }
    // 收完：胸口一颗星芒（跟着人物走）
    const s = this.sprite(this.twinkleTex[0], x, y - 12);
    this.fade(s, 0.4, 0.03, 0.2, { frames: this.twinkleTex, fps: this.twinkleTex.length / 0.4, delay: 0.5 + n * 0.025, owner, dx: 0, dy: -12 });
  }

  /** 人物头顶飘一行像素字（填色、描边），跟着人物、慢慢往上飘再淡去。 */
  private label(owner: number, text: string, color: string[], edge: string, life: number) {
    const p = this.world?.players[owner];
    if (!p) return;
    const [x, y] = this.at(p);
    const s = this.sprite(pixelTextTexture(text, { color, outline: edge, outline8: false }), x, y - 34, 0.5, 1);
    this.fade(s, life, 0.12, 0.45, { owner, dx: 0, dy: -34, vy: -7 });
  }

  /** 在人物身上放一个一次性的 pixelfx 预设（跟着人物走；人物不在了就停在最后的位置）。 */
  private onHero(key: keyof typeof PFX, e: RelicEvent) {
    let last = { x: e.x, y: e.y };
    this.pfx.playBaked(`relic.${key}`, PFX[key].id, PFX[key].opts, { follow: () => (last = this.heroFeet(e.owner) ?? last) });
  }

  private heroFeet(owner: number) {
    const p = this.world?.players[owner];
    if (!p || !p.alive || p.left) return null;
    const [x, y] = this.at(p);
    return { x, y };
  }

  private followEnemy(id: number, dy: number) {
    return () => {
      const q = this.enemyAt(id);
      return q ? { x: q[0], y: q[1] + dy } : null;
    };
  }

  // ---------- 每帧 ----------

  update(dt: number, w: World, alpha: number) {
    if (w !== this.world) {
      this.clear();
      this.world = w;
    }
    this.alpha = alpha;
    this.clock += dt;
    this.indexEnemies(w);
    const fighting = w.phase === 'wave';
    for (const p of w.players) if (fighting && p.alive && !p.left) this.states(p, dt);
    this.dressHeroes(w);
    this.updateShards(w, dt);
    // 金刚琢：转着飞过去、砸下（落点跟着敌人走，敌人死了就落在最后的位置），一路拖几粒金屑
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.t += dt;
      if (f.t < 0) continue;
      f.s.visible = true;
      const q = this.enemyAt(f.id);
      if (q) [f.x1, f.y1] = q;
      const k = clamp01(f.t / f.dur);
      const along = (q: number): [number, number] => [f.x0 + (f.x1 - f.x0) * q, f.y0 + (f.y1 - 8 - f.y0) * q - Math.sin(q * Math.PI) * 12];
      const [x, y] = along(k);
      f.s.position.set(Math.round(x), Math.round(y));
      f.s.texture = f.frames[[0, 1, 2, 1][Math.floor(f.t * 20) % 4]];
      f.echo.forEach((g, j) => {
        const q = k - (j + 1) * 0.09;
        g.visible = q > 0;
        const [gx, gy] = along(Math.max(0, q));
        g.position.set(Math.round(gx), Math.round(gy));
        g.texture = f.frames[[0, 1, 2, 1][(Math.floor(f.t * 20) + 3 - j) % 4]];
      });
      f.trail -= dt;
      if (f.trail <= 0) {
        // 拖尾：一像素的金屑落在镯子身后（不画在镯子里，免得像个准星）
        f.trail = 0.03;
        const bx = f.x0 + (f.x1 - f.x0) * Math.max(0, k - 0.12);
        const by = f.y0 + (f.y1 - 8 - f.y0) * Math.max(0, k - 0.12) - Math.sin(Math.max(0, k - 0.12) * Math.PI) * 12;
        this.sparks.emit(bx, by, 1, GOLD, [2, 6], [0.2, 0.3], { drag: 2 });
      }
      if (k >= 1) {
        this.zhuoLand(f.x1, f.y1);
        f.s.destroy();
        for (const g of f.echo) g.destroy();
        this.flies.splice(i, 1);
      }
    }
    // 淡入淡出的精灵与线（伞、镜光、黄符、雷、飘字）
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i];
      f.t += dt;
      if (f.t < 0) continue;
      const peak = f.peak ?? 1;
      const a = f.t < f.fadeIn ? f.t / f.fadeIn : f.t > f.life - f.fadeOut ? (f.life - f.t) / f.fadeOut : 1;
      f.s.alpha = Math.max(0, a) * peak;
      if (f.frames && f.s instanceof Sprite) f.s.texture = f.frames[Math.min(f.frames.length - 1, Math.floor(f.t * (f.fps ?? 8)))];
      if (f.owner !== undefined) {
        const p = w.players[f.owner];
        if (p) {
          const [x, y] = this.at(p);
          f.dy = (f.dy ?? 0) + (f.vy ?? 0) * dt;
          f.s.position.set(Math.round(x + (f.dx ?? 0)), Math.round(y + (f.dy ?? 0)));
        }
      } else if (f.vy) f.s.y += f.vy * dt;
      if (f.pop) {
        const k = clamp01(f.t / f.pop);
        f.s.scale.set(0.4 + 0.6 * (1 - (1 - k) * (1 - k)));
      }
      if (f.t >= f.life) {
        f.s.destroy();
        this.fades.splice(i, 1);
      }
    }
    // 小尘（和蹦出来又落下的灵石）
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.t += dt;
      if (m.t < 0) continue;
      const k = Math.exp(-m.drag * dt);
      m.vx *= k;
      m.vy = m.vy * k + m.g * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y >= m.ground) {
        m.y = m.ground;
        m.vy = 0;
        m.vx *= 0.5;
      }
      const left = m.life - m.t;
      m.s.alpha = Math.min(m.fadeIn > 0 ? clamp01(m.t / m.fadeIn) : 1, clamp01(left / (m.life * 0.45)));
      m.s.position.set(Math.round(m.x), Math.round(m.y));
      if (left <= 0) {
        m.s.destroy();
        this.motes.splice(i, 1);
      }
    }
    // 定身符的小黄符、魔气：到点收尾
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      if (t.h.done) this.timed.splice(i, 1);
      else if (this.clock >= t.end) {
        t.h.stop();
        this.timed.splice(i, 1);
      }
    }
    this.pfx.update(dt);
  }

  /**
   * 持续的状态（每个活着的人物，每帧）：风火蒲团入定（脚下浮起淡淡的金尘）、桃木簪在魔气里（脚边飘起桃花瓣）、
   * 踏云履 / 神行符在加速（脚边往后拖的云丝、风丝）、逆鳞在低血（背上时不时崩起一粒朱砂鳞屑）、夔牛鼓在鼓劲（肩头冒火星）、遁地（脚下的土）。
   */
  private states(p: Player, dt: number) {
    const [x, y] = this.at(p);
    const r = p.relics;
    const st = p.relic;
    const id = p.id;
    if (r.cushion && p.still >= RELIC.cushion.still) {
      // 入定：刚坐定时慢慢浓起来（0.6 秒）；金尘在脚下一圈浮起、往上飘着化掉（一粒一粒的小尘，不画圈）
      const k = clamp01((p.still - RELIC.cushion.still) / 0.6);
      for (let n = this.due(`cushion${id}`, 9 * k, dt); n > 0; n--) {
        const a = rnd(0, TAU);
        this.mote(Math.random() < 0.3 ? 'gold2' : 'gold', x + Math.cos(a) * rnd(6, 10), y + 1 + Math.sin(a) * rnd(2, 3.5), 0, -rnd(5, 9), rnd(1, 1.5), { drag: 0.5, fadeIn: 0.3 });
      }
    }
    if (r.hairpin && p.miasma > 0) {
      for (let n = this.due(`pin${id}`, 5, dt); n > 0; n--) {
        const a = rnd(0, TAU);
        this.mote(Math.random() < 0.5 ? 'petal' : 'petal2', x + Math.cos(a) * 4, y - rnd(2, 10), Math.cos(a) * rnd(10, 18), -rnd(2, 6), rnd(0.7, 1), { drag: 1.2, fadeIn: 0.1 });
      }
    }
    if (st && p.moving && (st.cloud > 0 || st.run > 0)) {
      const back = -p.facing;
      const cloud = st.cloud > 0;
      for (let n = this.due(`run${id}`, cloud ? 12 : 10, dt); n > 0; n--) {
        this.mote(cloud ? (Math.random() < 0.5 ? 'cloud' : 'cloud2') : 'wind', x + back * rnd(3, 7), y - rnd(0, cloud ? 3 : 10), back * rnd(12, 25), 0, rnd(0.3, 0.45), { drag: 3, fadeIn: 0.04 });
      }
    }
    const low = !!r.scale && p.hp < p.stats.maxHp * RELIC.scale.hp;
    if (low && !this.lowWas.get(id)) for (let i = 0; i < 5; i++) this.scaleBit(x, y);
    this.lowWas.set(id, low);
    if (low) for (let n = this.due(`scale${id}`, 2, dt); n > 0; n--) this.scaleBit(x, y);
    if (r.drum && st && st.drum < RELIC.drum.beat) {
      for (let n = this.due(`drum${id}`, 2.5, dt); n > 0; n--) this.mote('ember', x + rnd(-5, 5), y - rnd(12, 20), 0, -rnd(10, 16), rnd(0.45, 0.6), { drag: 1 });
    }
    const dun = !!st && st.dun > 0;
    if (dun) for (let n = this.due(`dun${id}`, 10, dt); n > 0; n--) this.mote(Math.random() < 0.5 ? 'earth' : 'dust', x + rnd(-6, 6), y, rnd(-6, 6), -rnd(4, 10), rnd(0.3, 0.5), { drag: 2 });
    if (!dun && this.dunWas.get(id)) this.dirt(x, y, 8); // 冒出来
    this.dunWas.set(id, dun);
  }

  /** 逆鳞：背上崩起一粒朱砂鳞屑，翻一下落地。 */
  private scaleBit(x: number, y: number) {
    const a = -Math.PI / 2 + rnd(-0.8, 0.8);
    const sp = rnd(25, 40);
    this.mote('scale', x + rnd(-4, 4), y - rnd(10, 16), Math.cos(a) * sp, Math.sin(a) * sp, rnd(0.55, 0.75), { g: 160, drag: 1, ground: y + rnd(0, 3) });
  }

  /** 遁地符：人物遁在地下的时候画淡（只是看着淡，打不着是模拟里的无敌）。 */
  private dressHeroes(w: World) {
    if (!this.hero) return;
    for (const p of w.players) {
      if (!p.relic || p.relic.dun <= 0 || !p.alive) continue;
      const s = this.hero(p.id);
      if (s) s.alpha = 0.32 + 0.1 * Math.sin(this.clock * 9);
    }
  }

  /** 照妖镜照出原形的敌人：胸口的破绽留到照的效果过去（relic-mirror.ts 画）。 */
  private updateShards(w: World, dt: number) {
    const marks = this.revealed;
    marks.clear();
    for (const e of w.enemies) {
      if (e.revealUntil === undefined || e.hp <= 0) continue;
      const left = e.revealUntil - w.time;
      if (left <= 0 || RELIC.mirror.t - left < 0.62) continue; // 镜光照到之前先不裂（relic-mirror.ts 的 T_ARRIVE）
      const x = e.px + (e.x - e.px) * this.alpha;
      const y = e.py + (e.y - e.py) * this.alpha;
      marks.set(e.id, [x, y, this.top(e), left]);
    }
    this.mirrorFx.update(dt, marks);
  }
}

/** 给一个网格四周各补一圈透明，好让 outline 描得下边。 */
function pad(g: Grid): Grid {
  const blank = '.'.repeat(g.w + 2);
  return { w: g.w + 2, h: g.h + 2, rows: [blank, ...g.rows.map((r) => `.${r}.`), blank] };
}

/** 用到的 pixelfx 修仙预设（key → 预设；开局预先画好，key 前面加 relic.）。 */
const PFX = {
  talismanBurn: XFX.talismanBurn,
  talismanBurnLow: XFX.talismanBurnLow,
  guBite: XFX.guBite,
  incenseCurl: XFX.incenseCurl,
  umbrellaOpen: XFX.umbrellaOpen,
  drumBeat: XFX.drumBeat,
  stormHit: XFX.stormHit,
  jadeDragon: XFX.jadeDragon,
  zhuoLand: XFX.zhuoLand,
  zapHitGold: XFX.zapHitGold,
  thunderDrop: XFX.thunderDrop,
};
