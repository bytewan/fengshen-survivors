// 宠物（哪吒 · 混天绫）的画面：头领着飞的一条小布带、被缠住的敌人身上绑着的红绫。
// 只作用在表现层：读模拟状态（Pet、Enemy.wrapT / wrapMax）和事件（wrap、evolve）。造型、布的动力学与栅格化在 src/art/sprites/pet.ts。
// 用户口径：宠物突出减益、不突出伤害；混天绫要精致、飘逸，任何时候都是一整段、不缩成一点；减速要看得出来；
// 被缠的敌人身上要明显，但不要光圈。2026-11-10 起混天绫一直在飞（模拟见 src/sim/pet.ts，这里不改它怎么飞、何时出手）。
// 同一天用户先说「现在混天绫和蛇一样 要做出布带的效果」，看了对折的长绫又说「不需要红色流动的这个特效」「太大了」
// 「动起来还是应该头在动 而不是中间在动」：所以布头钉在模拟里混天绫的位置上、领着飞，布身按布的动力学跟在后面飘；
// 掠过敌群时不再从布上甩出布条——布本身飘过去就是出手，被缠的敌人身上的红绫在那一刻从布来的那一侧绕上去。
import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import { PALETTE, hexToRgba } from '../art/palette.ts';
import { grid } from '../art/pixel.ts';
import {
  ALPHA,
  ClothBody,
  drawPetCloth,
  drawWrap,
  petWind,
  Pix,
  ribbonStyle,
  SHRED_BIND_FRAMES,
  SHRED_FIRE_FRAMES,
  SHRED_FRAMES,
  wrapLook,
  type ClothEnv,
  type RibbonStyle,
  type WrapLook,
} from '../art/sprites/pet.ts';
import { textureFromGrid } from '../render/textures.ts';
import type { Stage } from '../render/stage.ts';
import type { Particles } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { PET, petKindOf } from '../sim/pet.ts';
import { HERO_VIEWS } from './hero-views.ts';
import type { Enemy, PetBranch, PetMode, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

// ---------- 字符像素缓冲 → 纹理 ----------

/** 调色板字符编码 + 透明度档位 → 打包好的 RGBA（小端：0xAABBGGRR，预乘 alpha）。下标是 (档位 << 7) | 编码。 */
const LUT = new Uint32Array(ALPHA.length * 128);
for (const [k, v] of Object.entries(PALETTE)) {
  const [r, g, b] = hexToRgba(v);
  ALPHA.forEach((al, lv) => {
    const A = Math.round(al * 255);
    const m = (c: number) => Math.round(c * al);
    LUT[(lv << 7) | k.charCodeAt(0)] = ((A << 24) | (m(b) << 16) | (m(g) << 8) | m(r)) >>> 0;
  });
}

/**
 * 一块每帧重画的像素图：在 Pix（字符缓冲）里画，end() 时把画过的那几行转成颜色、只上传这几行。
 * 像素按 Pix.a 的档位带透明度（绸带尾梢用；别的画法都是不透明的 0 档），整体的淡入淡出用精灵的 alpha。
 */
export class PixelLayer {
  readonly pix: Pix;
  readonly sprite: Sprite;
  private rgba: Uint32Array;
  private src: BufferImageSource;
  private py0 = 0; // 上一次转过色的行，这次要先擦掉
  private py1 = -1;
  private px0 = 0;
  private px1 = -1;
  constructor(w: number, h: number) {
    this.pix = new Pix(w, h);
    const bytes = new Uint8Array(w * h * 4);
    this.rgba = new Uint32Array(bytes.buffer);
    this.src = new BufferImageSource({ resource: bytes, width: w, height: h, format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'premultiplied-alpha' });
    this.sprite = new Sprite(new Texture({ source: this.src }));
  }
  /** 清空，左上角放到世界坐标 (ox, oy)。 */
  begin(ox: number, oy: number) {
    this.pix.reset(Math.round(ox), Math.round(oy));
  }
  /** 转色、上传；没画任何东西时隐藏。 */
  end() {
    const P = this.pix;
    const { c, a, w } = P;
    const any = !P.empty();
    // 要处理的范围 = 上次画过的 ∪ 这次画过的
    const y0 = Math.min(this.py0, any ? P.y0 : 1e9);
    const y1 = Math.max(this.py1, any ? P.y1 : -1);
    const x0 = Math.min(this.px0, any ? P.x0 : 1e9);
    const x1 = Math.max(this.px1, any ? P.x1 : -1);
    if (y1 >= y0) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0, i = y * w + x0; x <= x1; x++, i++) {
          const v = c[i];
          this.rgba[i] = v ? LUT[(a[i] << 7) | v] : 0;
        }
      this.src.update(y0 * w, (y1 + 1) * w);
    }
    if (any) {
      this.py0 = P.y0;
      this.py1 = P.y1;
      this.px0 = P.x0;
      this.px1 = P.x1;
    } else {
      this.py0 = this.px0 = 1e9;
      this.py1 = this.px1 = -1;
    }
    this.sprite.position.set(P.ox, P.oy);
    this.sprite.visible = any;
    return any;
  }
}

// ---------- 状态 ----------

/** 一位玩家的混天绫本体。 */
interface Ribbon {
  body: ClothBody;
  env: ClothEnv; // 这一帧的风（petWind 算）
  layer: PixelLayer;
  x: number; // 上一帧画的布头的位置
  y: number;
  t: number;
  mode: PetMode;
  calm: number; // 0..1：飞得多快（平滑过的），快 = 拉直、尾梢抖动
  zb: number; // 排前后的偏移：掠过时排到敌群前面（平滑过渡，不跳）
  sweepHit: boolean; // 这一趟是不是已经缠上过（只在第一下甩、出声）
  sparkle: number;
  ember: number;
  flyCd: number;
}

/** 一只被缠住的敌人身上的红绫。 */
/** 这个人物的混天绫是不是换成了黑绫（回响化身，game/hero-views.ts 的 petTint）。 */
const darkOf = (w: World, owner: number | undefined) => {
  const p = owner === undefined ? undefined : w.players[owner];
  return !!p && HERO_VIEWS[p.hero].petTint === 'dark';
};

interface Wrap {
  id: number;
  /** 黑绫缠的（魔化哪吒）：画成黑红的。 */
  dark?: boolean;
  /** 谁的混天绫缠的（联机时飘带朝他那边的反方向飘；单人是 0）。 */
  owner?: number;
  front: PixelLayer;
  back: PixelLayer;
  look: WrapLook;
  size: number;
  t: number; // 缠上之后过了多久
  from: number; // 混天绫从哪一侧掠过来的（屏幕上：1 右、-1 左）：红绫从这一侧开始绕上去
  shown: boolean; // 已经完整缠上过（再缠一次只是勒紧，不重新绕）
  retight: boolean;
  cinched: boolean; // 绕完、勒紧的那一下已经出过金光
  cinchAt: number; // 这一回缠上之后多久勒紧（头一回：先绕 WIND_ON 秒；已经绑着的再缠一次：马上）
  wrapT: number; // 上一帧的 Enemy.wrapT（变大 = 又被缠了一次）
  strainT: number;
  nextStrain: number;
  tx: number; // 飘带方向（平滑）
  ty: number;
  x: number;
  y: number;
  seed: number;
  shred: number;
  branch: PetBranch | null;
  drawn: boolean;
}

/** 飘落的红绸碎片。 */
interface Shred {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  seed: number;
  set: Texture[];
}

// 每种体型的缓冲大小与脚底锚点在缓冲里的位置
const WRAP_BUF = [
  { w: 48, h: 44, ay: 34 }, // 回响兵、鬼火术士
  { w: 64, h: 60, ay: 48 }, // 回响校尉、阴马骁骑
  { w: 104, h: 100, ay: 80 }, // 首领
];
const sizeOf = (kind: Enemy['kind']) => (kind === 'elite' || kind === 'cavalry' ? 1 : kind === 'boss' ? 2 : 0); // 骑兵个头大，用校尉那一档

/** 本体的缓冲（以布头为中心）：布最长 54 像素，加上半宽、火舌，128 够了。 */
const RIBBON_BUF = 128;
/** 红绫从一侧绕上身要多久（秒）。用户：出现和消失都不要太快，也不要凭空出现。 */
const WIND_ON = 0.22;
const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export class PetFx {
  private ribbons = new Map<number, Ribbon>();
  private wraps = new Map<number, Wrap>();
  private pool: Wrap[][] = [[], [], []];
  private shreds: Shred[] = [];
  private shredPool: Sprite[] = [];
  private shredLayer = new Container();
  private shredTex: Record<'base' | 'bind' | 'fire', Texture[]>;
  private stage: Stage;
  private sparks: Particles;
  private sfx: Sfx;
  private time = 0;
  private frame = 0;

  constructor(stage: Stage, sparks: Particles, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.sfx = sfx;
    const tex = (fs: string[][]) => fs.map((rows) => textureFromGrid(grid(rows)));
    this.shredTex = { base: tex(SHRED_FRAMES), bind: tex(SHRED_BIND_FRAMES), fire: tex(SHRED_FIRE_FRAMES) };
    stage.fx.addChild(this.shredLayer);
  }

  /** 清空（重开一局、一波开始或结束时）。绸带本体留着，下一帧接着飘。 */
  clear() {
    for (const v of this.wraps.values()) this.recycle(v);
    this.wraps.clear();
    for (const s of this.shreds) {
      s.s.visible = false;
      this.shredPool.push(s.s);
    }
    this.shreds = [];
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      // 进化：布慢慢翻一圈
      this.ribbons.get(e.owner)?.body.flip(e.stage % 2 ? 1 : -1);
      this.sfx.play('pet.evolve');
      return;
    }
    if (e.t !== 'wrap') return;
    // 掠过时扫到的敌人：布本身飘过去就是出手，红绫从混天绫掠来的那一侧绕上身（不从布上甩布条出去）
    const r = this.ribbons.get(e.owner);
    const pet = w.players[e.owner]?.pet;
    let j = 0;
    for (const id of e.ids) {
      const en = w.enemies.find((x) => x.id === id);
      if (!en) continue;
      const v = this.wraps.get(id) ?? this.make(en, e.branch);
      v.branch = e.branch;
      v.dark = darkOf(w, e.owner); // 魔化哪吒的黑绫：缠在敌人身上的也是黑红的
      v.owner = e.owner; // 联机：谁的混天绫缠的（飘带朝他那边的反方向飘）
      v.from = (pet?.x ?? e.x) >= en.x ? 1 : -1;
      v.retight = v.shown; // 已经绑着的：原地勒紧一下，不重新绕
      v.cinchAt = v.shown ? 0 : WIND_ON;
      v.cinched = false;
      v.t = 0;
      j++;
    }
    // 这一趟头一回缠上：一声，布身跟着一抽
    if (r && !r.sweepHit && j > 0) {
      r.sweepHit = true;
      this.sfx.play('pet.wrap');
      r.body.kick(Math.random() < 0.5 ? -0.7 : 0.7);
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    if (dt > 0) this.frame++;
    for (const p of w.players) if (petKindOf(p) === 'huntian') this.updateRibbon(p.id, w, dt, alpha); // 只画带混天绫的（别的宠物在 game/pets/）
    this.updateWraps(dt, w, alpha);
    this.updateShreds(dt);
  }

  // ---------- 本体 ----------

  private updateRibbon(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const pet = p.pet;
    const st = ribbonStyle(pet.branch, darkOf(w, id));
    const stageN = Math.min(3, pet.stage);
    const lens = [st.len[stageN]];
    const hx = pet.px + (pet.x - pet.px) * alpha;
    const hy = pet.py + (pet.y - pet.py) * alpha;
    let r = this.ribbons.get(id);
    if (!r) {
      const layer = new PixelLayer(RIBBON_BUF, RIBBON_BUF);
      this.stage.entities.addChild(layer.sprite);
      const env: ClothEnv = { wx: 0, wy: 0, sway: 1, flutter: 0 };
      r = { body: new ClothBody(lens, id + 1), env, layer, x: hx, y: hy, t: Math.random() * 10, mode: pet.mode, calm: 0, zb: 0, sweepHit: false, sparkle: 0, ember: 0, flyCd: 0 };
      r.body.place(hx, hy, -p.facing, -0.5);
      this.ribbons.set(id, r);
    }
    r.body.resize(lens); // 进化时换长度（没变就什么都不做）
    if (Math.hypot(hx - r.x, hy - r.y) > 140) {
      // 重开一局、瞬移：直接摆好，不要从老地方扯过来
      r.body.place(hx, hy, -p.facing, -0.5);
    }
    r.t += dt;
    r.flyCd = Math.max(0, r.flyCd - dt);
    r.x = hx;
    r.y = hy;
    // 一趟掠过开始：一声「呼」
    if (pet.mode === 'sweep' && r.mode !== 'sweep') {
      r.sweepHit = false;
      if (r.flyCd <= 0) {
        this.sfx.play('pet.fly');
        r.flyCd = 1.2;
      }
    }
    r.mode = pet.mode;
    // 风：慢的时候一阵阵往身后、略往上吹，布身大起伏；快的时候拉直、尾梢抖动
    const sp = Math.hypot(pet.vx, pet.vy);
    r.calm += (smooth((sp - 40) / 140) - r.calm) * (1 - Math.exp(-dt * 5));
    petWind(pet.side, pet.vx, pet.vy, r.calm, r.t, r.env);
    r.body.step(dt, hx, hy, r.env);
    // 画
    const L = r.layer;
    L.begin(Math.round(hx) - RIBBON_BUF / 2, Math.round(hy) - RIBBON_BUF / 2);
    drawPetCloth(L.pix, r.body, st, { t: r.t, stage: stageN, flutter: r.env.flutter });
    L.end();
    // 飘在半空：按它正下方的地面排前后；掠过时排到敌群前面（布横扫过去看得清），兜回来时慢慢落回原位
    const zbT = pet.mode === 'sweep' ? 14 : 0;
    r.zb += (zbT - r.zb) * (1 - Math.exp(-dt * (pet.mode === 'sweep' ? 12 : 3)));
    L.sprite.zIndex = Math.round(hy + PET.hover + r.zb);
    // 偶尔从布的后半截落下一粒金色灵光（很淡，不成圈；不从布头落，免得布头像点了一对金眼睛）
    r.sparkle -= dt;
    if (r.sparkle <= 0) {
      r.sparkle = 0.5 + Math.random() * 0.5;
      const T = r.body.tails[Math.floor(Math.random() * r.body.tails.length)];
      const i = Math.floor(T.n / 2) + Math.floor(Math.random() * (T.n - Math.floor(T.n / 2)));
      this.sparks.emit(T.x[i], T.y[i], 1, [0xf7dc7a, 0xffe9a8], [2, 6], [0.5, 0.9], { up: 5, drag: 2 });
    }
    // 火绫：布尾的后段飘出余烬
    if (st.pattern === 'flame') {
      r.ember -= dt;
      while (r.ember <= 0) {
        r.ember += 0.11;
        const T = r.body.tails[Math.floor(Math.random() * r.body.tails.length)];
        const i = Math.min(T.n - 1, Math.floor(T.n * (0.35 + Math.random() * 0.65)));
        this.sparks.emit(T.x[i], T.y[i] - 1, 1, [0xf2814a, 0xf7dc7a, 0xd9452b], [4, 12], [0.35, 0.7], { up: 16, drag: 2.5 });
      }
    }
  }

  // ---------- 被缠住的敌人 ----------

  private make(e: Enemy, branch: PetBranch | null): Wrap {
    const size = sizeOf(e.kind);
    const v = this.pool[size].pop() ?? (() => {
      const b = WRAP_BUF[size];
      const front = new PixelLayer(b.w, b.h);
      const back = new PixelLayer(b.w, b.h);
      return { front, back } as Wrap;
    })();
    Object.assign(v, {
      id: e.id,
      look: wrapLook(e.kind),
      size,
      t: 0,
      from: 1,
      shown: false,
      retight: false,
      cinched: false,
      cinchAt: WIND_ON,
      wrapT: e.wrapT,
      strainT: 0,
      nextStrain: 0.9 + Math.random() * 0.8,
      tx: 0,
      ty: 0,
      x: e.x,
      y: e.y,
      seed: Math.random() * 10,
      shred: 0.2 + Math.random() * 0.3,
      branch,
      owner: undefined,
      drawn: false,
    });
    v.front.sprite.alpha = 1;
    v.back.sprite.alpha = 1;
    this.stage.entities.addChild(v.back.sprite, v.front.sprite);
    this.wraps.set(e.id, v);
    return v;
  }

  private recycle(v: Wrap) {
    v.front.sprite.removeFromParent();
    v.back.sprite.removeFromParent();
    this.pool[v.size].push(v);
  }

  private updateWraps(dt: number, w: World, alpha: number) {
    const p0 = w.players[0];
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (e.wrapT <= 0) continue;
      seen.add(e.id);
      const v = this.wraps.get(e.id) ?? this.make(e, w.players[0]?.pet.branch ?? null);
      // 又被缠了一次（时间被续上）：已经绑着的就原地勒紧一下
      if (e.wrapT > v.wrapT + 0.05 && v.shown) {
        v.t = 0;
        v.retight = true;
        v.cinchAt = 0;
        v.cinched = false;
      }
      v.wrapT = e.wrapT;
      v.t += dt;
      const x = Math.round(e.px + (e.x - e.px) * alpha);
      const y = Math.round(e.py + (e.y - e.py) * alpha);
      // 飘带朝来路的反方向飘（被拖住、走不动的样子）；不动时往身后垂下
      const po = (v.owner !== undefined ? w.players[v.owner] : undefined) ?? p0; // 联机：按缠它的那个人
      const flip: 1 | -1 = (po?.x ?? 0) >= e.x ? 1 : -1;
      let mx = x - v.x;
      let my = y - v.y;
      const m = Math.hypot(mx, my);
      let dx = -flip * 0.9;
      let dy = 0.25;
      if (m > 0.05 && dt > 0) {
        mx /= m;
        my /= m;
        dx = -mx;
        dy = -my * 0.6 + 0.2;
      }
      const kk = 1 - Math.exp(-dt * 4);
      v.tx += (dx - v.tx) * kk;
      v.ty += (dy - v.ty) * kk;
      const tl = Math.hypot(v.tx, v.ty) || 1;
      v.x = x;
      v.y = y;
      // 各个阶段：头一回缠上，红绫从混天绫掠来的那一侧绕上身（先慢后快，绕过身前看得清），松松地绕一圈；
      // 绕完一勒——先松后紧、略微勒过头再回弹，绳结两侧弹出两道短短的勒紧线。已经绑着的再缠一次，只原地勒紧一下
      const t = v.t;
      const reveal = v.shown ? 1 : Math.min(1, (t / WIND_ON) ** 1.5);
      if (reveal >= 1) v.shown = true;
      const tc = t - v.cinchAt;
      const amp = v.retight ? 1.4 : 2.8;
      const tight = tc < 0 ? amp : amp * Math.exp(-tc * 9) * Math.cos(tc * 17);
      const impact = tc < 0 ? 0 : Math.max(0, 1 - tc / 0.14);
      if (tc >= 0 && !v.cinched) {
        // 勒紧的一下：绳结上迸出两粒金色的碎光（慢慢散开、慢慢淡掉）
        v.cinched = true;
        const kb = v.look.bands[v.look.knot];
        this.sparks.emit(x + (v.look.cx + v.look.knotDx) * flip, y + kb.y + kb.ry, 2, [0xf7dc7a, 0xffe9a8], [10, 24], [0.35, 0.55], { drag: 3, up: 6 });
      }
      v.strainT += dt;
      let strain = 0;
      if (v.strainT > v.nextStrain) {
        const k = (v.strainT - v.nextStrain) / 0.2;
        if (k >= 1) {
          v.strainT = 0;
          v.nextStrain = 0.9 + Math.random() * 0.9;
        } else strain = Math.sin(k * Math.PI);
      }
      const LOOSE = Math.min(0.9, Math.max(0.5, e.wrapMax * 0.25));
      const loose = e.wrapT < LOOSE ? 1 - e.wrapT / LOOSE : 0;
      const st = ribbonStyle(v.branch, v.dark);
      const b = WRAP_BUF[v.size];
      // 隔帧重画（错开奇偶，30 次 / 秒够用）；不重画的那帧只跟着敌人挪位置。刚缠上、勒紧的那一小段每帧都画
      const redraw = tc < 0.4 || (this.frame + v.id) % 2 === 0 || !v.drawn;
      if (redraw) {
        v.front.begin(x - b.w / 2, y - b.ay);
        v.back.begin(x - b.w / 2, y - b.ay);
        if (reveal > 0)
          drawWrap(v.front.pix, v.back.pix, v.look, { x, y, flip, t: this.time, reveal, from: v.from, tight, loose, strain, tailX: v.tx / tl, tailY: v.ty / tl, impact, seed: v.seed }, st);
        v.front.end();
        v.back.end();
        v.drawn = true;
      } else {
        v.front.sprite.position.set(Math.round(x - b.w / 2), Math.round(y - b.ay));
        v.back.sprite.position.set(Math.round(x - b.w / 2), Math.round(y - b.ay));
      }
      v.front.sprite.zIndex = y + 0.5;
      v.back.sprite.zIndex = y - 0.5;
      const a = 1 - smooth((loose - 0.45) / 0.55);
      v.front.sprite.alpha = a;
      v.back.sprite.alpha = a;
      // 红绸碎片：缠着的时候时不时飘下一片，挣扎和松开时多一些
      v.shred -= dt * (strain > 0 ? 3 : 1) * (loose > 0.2 ? 2.5 : 1);
      if (v.shred <= 0 && reveal >= 1) {
        v.shred = (0.3 + Math.random() * 0.35) * (v.size ? 0.7 : 1);
        const band = v.look.bands[Math.floor(Math.random() * v.look.bands.length)];
        const sx = x + v.look.cx * flip + (Math.random() - 0.5) * band.rx * 2;
        this.spawnShred(sx, y + band.y + 1, (Math.random() - 0.5) * 10, -4 - Math.random() * 8, st.pattern);
      }
      // 火绫：缠着的敌人身上偶尔窜起火星
      if (st.pattern === 'flame' && reveal >= 1 && Math.random() < dt * 5) {
        const band = v.look.bands[0];
        this.sparks.emit(x + v.look.cx * flip + (Math.random() - 0.5) * band.rx * 1.6, y + band.y, 1, [0xf2814a, 0xf7dc7a], [4, 10], [0.3, 0.55], { up: 18 });
      }
    }
    for (const [id, v] of this.wraps) {
      if (seen.has(id)) continue;
      // 敌人死了：身上的红绫散开成碎片落下
      if (!w.enemies.some((e) => e.id === id) && v.shown) {
        const st = ribbonStyle(v.branch, v.dark);
        for (let k = 0; k < 5 + v.size * 4; k++) {
          const band = v.look.bands[k % v.look.bands.length];
          this.spawnShred(v.x + (Math.random() - 0.5) * band.rx * 2, v.y + band.y, (Math.random() - 0.5) * 50, -15 - Math.random() * 30, st.pattern);
        }
      }
      this.recycle(v);
      this.wraps.delete(id);
    }
  }

  // ---------- 红绸碎片 ----------

  private spawnShred(x: number, y: number, vx: number, vy: number, pattern: RibbonStyle['pattern']) {
    if (this.shreds.length > 90) return;
    const set = pattern === 'scale' ? this.shredTex.bind : pattern === 'flame' ? this.shredTex.fire : this.shredTex.base;
    const s = this.shredPool.pop() ?? new Sprite(set[0]);
    if (!s.parent) this.shredLayer.addChild(s);
    s.visible = true;
    s.alpha = 1;
    this.shreds.push({ s, x, y, vx, vy, t: 0, life: 1 + Math.random() * 0.6, seed: Math.random() * 10, set });
  }

  private updateShreds(dt: number) {
    for (let i = this.shreds.length - 1; i >= 0; i--) {
      const s = this.shreds[i];
      s.t += dt;
      if (s.t >= s.life) {
        s.s.visible = false;
        this.shredPool.push(s.s);
        this.shreds.splice(i, 1);
        continue;
      }
      // 像一片绸子：先被弹开，很快被空气托住，左右飘着慢慢落下
      const k = Math.exp(-dt * 3.5);
      s.vx *= k;
      s.vy = s.vy * k + 26 * dt * (1 - Math.exp(-s.t * 3));
      s.x += (s.vx + Math.sin(s.t * 5 + s.seed) * 7) * dt;
      s.y += s.vy * dt;
      s.s.texture = s.set[Math.floor(s.t * 7 + s.seed) % s.set.length];
      s.s.position.set(Math.round(s.x), Math.round(s.y));
      s.s.alpha = s.t > s.life * 0.55 ? Math.max(0, (s.life - s.t) / (s.life * 0.45)) : 1;
    }
  }
}
