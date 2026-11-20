// 宠物（云霄 · 青鸾）的画面：飞在半空的青鸾（四帧扇翅、掠过时收翅），地上一个小影子；掠过敌群时身下洒下一片冰羽，
// 一根根飘落到沾上的敌人身上；被沾上「寒羽」的敌人肩上一直插着一根小冰羽（偶尔落一粒霜），直到寒羽结束；冻住的那一下迸出几粒冰屑。
// 只作用在表现层：读模拟状态（Pet、Enemy.chillUntil / deepUntil）和事件（feather、evolve）；模拟见 src/sim/pets/qingluan.ts。
// 用户口径：宠物只上减益、减益要看得见；宠物比人物小；不要光圈；出现消失有过程（羽毛飘落约 0.4 秒，肩上的冰羽淡入、最后慢慢淡掉）。
// 进化之后换羽色：冰魄通身转白、尾梢结冰；沧溟转深成黛蓝、尾羽更长（art/sprites/qingluan.ts）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { BIRD_PIVOT, FEATHER, FEATHER_DEEP, FEATHER_RIME, qingluanFrames, type BirdPose } from '../../art/sprites/qingluan.ts';
import { textureFromGrid } from '../../render/textures.ts';
import { LUAN_TONE, tone } from '../../art/sprites/echo-tone.ts';
import type { Grid } from '../../art/pixel.ts';
import { HERO_VIEWS } from '../hero-views.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { applyRot, C, clamp01, headOf, ICE_SPARKS, Pixels, rnd, rotTex } from '../fx.ts';
import { petKindOf, QINGLUAN } from '../../sim/pet.ts';
import type { Enemy, PetBranch, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

interface Bird {
  s: Sprite;
  sh: Sprite;
  t: number;
  face: 1 | -1;
  pitch: number;
  mode: string;
  trailCd: number;
}
/** 一根飘落的冰羽：从 (x0, y0) 飘到 (x1, y1)（沾上的敌人肩上；没有目标的就落在地上淡掉）。 */
interface Plume {
  s: Sprite;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  sway: number;
  stick: boolean;
  look: 'base' | 'rime' | 'deep';
}

const FALL = [0.32, 0.46]; // 羽毛飘落要多久

/** 玄鸾的一帧（按原来那一帧缓存，进化的配色换完再换一遍）。 */
const darkCache = new WeakMap<Grid, Grid>();
function darkLuan(g: Grid): Grid {
  let d = darkCache.get(g);
  if (!d) {
    d = tone(g, LUAN_TONE);
    darkCache.set(g, d);
  }
  return d;
}

export class QingluanFx {
  private birds = new Map<number, Bird>();
  private plumes: Plume[] = [];
  private marks = new Pixels();
  private seen = new Map<number, number>(); // 敌人 id → 第一次看到它沾寒羽的时刻（淡入用）
  private layer = new Container();
  private stage: Stage;
  private sparks: Particles;
  private sfx: Sfx;
  private time = 0;
  private featherTex: Record<'base' | 'rime' | 'deep', Texture[]>;

  constructor(stage: Stage, sparks: Particles, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.sfx = sfx;
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.marks.g);
    this.featherTex = { base: FEATHER.map(textureFromGrid), rime: FEATHER_RIME.map(textureFromGrid), deep: FEATHER_DEEP.map(textureFromGrid) };
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 清空（重开一局、一波开始或结束时）。鸟本身留着，下一帧接着飞。 */
  clear() {
    for (const q of this.plumes) q.s.destroy();
    this.plumes = [];
    this.seen.clear();
    this.marks.flush();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      const p = w.players[e.owner];
      if (!p || petKindOf(p) !== 'qingluan') return;
      this.play('qingluan.evolve', 'pet.evolve');
      // 进化：鸟身上抖落一圈冰羽、几粒冰光（不画圈）
      this.sparks.emit(p.pet.x, p.pet.y, 14, ICE_SPARKS, [12, 40], [0.5, 0.9], { up: 20, drag: 2 });
      for (let i = 0; i < 6; i++) this.spawnPlume(p.pet.x, p.pet.y, p.pet.x + rnd(-16, 16), p.pet.y + QINGLUAN.hover + rnd(-2, 4), false, e.branch);
      return;
    }
    if (e.t !== 'feather') return;
    const p = w.players[e.owner];
    if (!p) return;
    this.play('qingluan.feather', 'pet.wrap', 0.7);
    // 一根冰羽飘到每一只沾上的身上；再多洒两三根落在地上（一片羽毛，不是一根）
    for (const id of e.ids) {
      const en = w.enemies.find((x) => x.id === id);
      if (!en) continue;
      this.spawnPlume(p.pet.x + rnd(-3, 3), p.pet.y + 2, en.x + rnd(-2, 2), en.y - headOf(en.kind) * 0.6, true, e.branch);
    }
    for (let i = 0; i < 2 + Math.min(3, e.ids.length); i++) this.spawnPlume(p.pet.x + rnd(-4, 4), p.pet.y + 2, e.x + rnd(-e.r, e.r), e.y + rnd(-e.r, e.r) * 0.5, false, e.branch);
    for (const id of e.frozen) {
      const en = w.enemies.find((x) => x.id === id);
      if (en) this.sparks.emit(en.x, en.y - headOf(en.kind) * 0.5, 6, ICE_SPARKS, [15, 45], [0.3, 0.55], { drag: 3 });
    }
    if (e.frozen.length) this.play('qingluan.frost', 'hanbing.frost', 0.6);
  }

  private spawnPlume(x0: number, y0: number, x1: number, y1: number, stick: boolean, branch: PetBranch | null) {
    const look = branch === 'rime' ? 'rime' : branch === 'deep' ? 'deep' : 'base';
    const s = new Sprite(this.featherTex[look][0]);
    s.anchor.set(0.5);
    this.stage.entities.addChild(s);
    this.plumes.push({ s, x0, y0, x1, y1, t: 0, dur: rnd(FALL[0], FALL[1]), sway: rnd(0, 6), stick, look });
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    for (const p of w.players) {
      if (petKindOf(p) !== 'qingluan' || p.left) {
        const b = this.birds.get(p.id);
        if (b) b.s.visible = b.sh.visible = false;
        continue;
      }
      this.updateBird(p.id, w, dt, alpha);
    }
    this.updatePlumes(dt);
    this.drawMarks(dt, w, alpha);
  }

  private updateBird(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const pet = p.pet;
    let b = this.birds.get(id);
    if (!b) {
      const s = new Sprite();
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      sh.alpha = 0.25;
      this.stage.entities.addChild(s);
      this.stage.floor.addChild(sh);
      b = { s, sh, t: Math.random() * 3, face: p.facing, pitch: 0, mode: pet.mode, trailCd: 0 };
      this.birds.set(id, b);
    }
    const x = pet.px + (pet.x - pet.px) * alpha;
    const y = pet.py + (pet.y - pet.py) * alpha;
    const sp = Math.hypot(pet.vx, pet.vy);
    b.t += dt;
    if (Math.abs(pet.vx) > 8) b.face = pet.vx > 0 ? 1 : -1;
    // 俯仰：跟着上下的速度轻轻点头（最多约 20°）
    const want = Math.max(-0.35, Math.min(0.35, Math.atan2(pet.vy, Math.abs(pet.vx) + 30) * 0.6));
    b.pitch += (want - b.pitch) * Math.min(1, dt * 8);
    const set = qingluanFrames(pet.branch, Math.min(3, pet.stage));
    // 掠过敌群时收着翅（间或扇一下），平时扇翅：慢慢地扇，回来的时候扇得快一点
    let pose: BirdPose = 'fly';
    let fi: number;
    if (pet.mode === 'sweep' && sp > 140) {
      pose = Math.floor(b.t * 3) % 3 === 2 ? 'fly' : 'dive';
      fi = Math.floor(b.t * 10) % (pose === 'dive' ? 2 : 4);
    } else fi = Math.floor(b.t * (pet.mode === 'return' ? 11 : 7)) % 4;
    // 回响云霄的玄鸾：同一只鸾换成回响色（art/sprites/echo-tone.ts）
    const dark = HERO_VIEWS[p.hero].petTint === 'dark';
    const g0 = set[pose][fi % set[pose].length];
    const g = dark ? darkLuan(g0) : g0;
    const key = `luan${dark ? 'd' : ''}${pet.branch ?? '-'}${Math.min(3, pet.stage)}${pose}${fi}`;
    // 朝左：rotTex 先镜像再转（翅膀、冠羽不会倒过来）
    const ang = b.face > 0 ? b.pitch : Math.PI - b.pitch;
    applyRot(b.s, rotTex(key, g, ang, BIRD_PIVOT.x, BIRD_PIVOT.y, 48, undefined, true));
    b.s.position.set(Math.round(x), Math.round(y));
    b.s.zIndex = Math.round(y + QINGLUAN.hover); // 按正下方的地面排前后
    b.s.visible = b.sh.visible = true;
    b.sh.position.set(Math.round(x), Math.round(y + QINGLUAN.hover));
    b.s.tint = p.miasma > 0 ? 0xe0c8e8 : 0xffffff;
    // 掠过时身后几粒很快淡掉的霜屑
    if (pet.mode === 'sweep' && sp > 120) {
      b.trailCd -= dt;
      if (b.trailCd <= 0) {
        b.trailCd = 0.05;
        this.sparks.emit(x - b.face * 6, y + 2, 1, [C.W, C.Cc], [4, 12], [0.25, 0.45], { g: 30, drag: 2 });
      }
    }
    if (pet.mode === 'sweep' && b.mode !== 'sweep') this.play('qingluan.dive', 'pet.fly', 0.6);
    b.mode = pet.mode;
  }

  /** 飘落的冰羽：边飘边翻、左右摆，落到敌人肩上就收掉（肩上的那一根由 drawMarks 接着画），落在地上的慢慢淡掉。 */
  private updatePlumes(dt: number) {
    for (let i = this.plumes.length - 1; i >= 0; i--) {
      const q = this.plumes[i];
      q.t += dt;
      const k = q.t / q.dur;
      const end = q.stick ? 1 : 1.6;
      if (k >= end) {
        q.s.destroy();
        this.plumes.splice(i, 1);
        continue;
      }
      const u = Math.min(1, k);
      const e = u * u * (3 - 2 * u);
      const x = q.x0 + (q.x1 - q.x0) * e + Math.sin(q.sway + q.t * 14) * 2 * (1 - u);
      const y = q.y0 + (q.y1 - q.y0) * e;
      q.s.position.set(Math.round(x), Math.round(y));
      q.s.zIndex = Math.round(q.y1 + 2);
      q.s.texture = this.featherTex[q.look][Math.sin(q.t * 18 + q.sway) < 0 ? 1 : 0]; // 边飘边翻
      q.s.alpha = Math.min(1, q.t / 0.06) * (k > 1 ? clamp01(1 - (k - 1) / 0.6) : 1);
    }
  }

  /**
   * 寒羽：沾上的敌人肩上一直插着一根小冰羽（斜着、月白的羽轴、天青的羽片；冰魄白、沧溟深），轻轻颤，
   * 刚沾上时 0.15 秒淡入，最后 0.6 秒慢慢淡掉；偶尔从羽上落一粒霜。
   */
  private drawMarks(dt: number, w: World, alpha: number) {
    const px = this.marks;
    const now = w.time;
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.chillUntil === undefined || now >= e.chillUntil) continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      this.quill(e, this.time - t0, e.chillUntil - now, e.deepUntil !== undefined && now < e.deepUntil, alpha);
      if (Math.random() < dt * 1.4) {
        const hd = headOf(e.kind);
        this.sparks.emit(e.x + rnd(-2, 3), e.y - hd * 0.6, 1, e.deepUntil && e.deepUntil > now ? [C.Cc, C.c] : [C.W, C.Cc], [3, 9], [0.4, 0.7], { g: 60, drag: 1 });
      }
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    px.flush();
  }

  /** 一只敌人肩上的那根冰羽（4 像素长，从肩头斜着往后上方翘）。 */
  private quill(e: Enemy, age: number, left: number, deep: boolean, alpha: number) {
    const px = this.marks;
    const x = Math.round(e.px + (e.x - e.px) * alpha) + 2;
    const y = Math.round(e.py + (e.y - e.py) * alpha - headOf(e.kind) * 0.62);
    const a = clamp01(age / 0.15) * clamp01(left / 0.6);
    const wob = Math.round(Math.sin(this.time * 7 + e.id) * 0.6);
    const vane = deep ? C.c : C.Cc;
    const shaft = deep ? C.Cc : C.W;
    px.dot(x, y, shaft, a);
    px.dot(x + 1, y - 1, shaft, a);
    px.dot(x + 2, y - 2 + wob, vane, a);
    px.dot(x + 3, y - 3 + wob, vane, a * 0.85);
    px.dot(x + 1, y - 2, vane, a * 0.8);
    px.dot(x + 2, y - 1, vane, a * 0.6);
    px.dot(x, y + 1, C.n, a * 0.5);
  }
}
