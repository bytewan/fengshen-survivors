// 云霄神通「九曲黄河」的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟：skill 事件（kind 'huanghe'）、
// riverSlam 事件、Player.river（卷着谁）。卷着的敌人的位置模拟每帧都给好了（沿椭圆转着收向中心），敌人照常由 enemy-views.ts 画。
// 脚下铺开一圈浑黄的河水（0.35 秒从中心铺到边），水上三道往中心卷的漩涡纹慢慢转（逆时针，和敌人被卷的方向一样），
// 岸边断续的白浪；卷着的敌人脚下不时溅起一点泥水。到时一起砸下：中心掀起一团泥浪、水珠往四周甩，漩涡收进中心，
// 水面往外推开一道断续的浪，再慢慢退干（0.5 秒）。不画光圈；竖着往上的水不过约 1.5 个人高。
import { Container, Sprite, type Texture } from 'pixi.js';
import { riverBody, riverReveal, riverSwirl } from '../../art/sprites/huanghe.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { FLAT } from '../../sim/heroes/yunxiao.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { C, clamp01, easeOut, Pixels, rnd, Ts } from '../fx.ts';

const TAU = Math.PI * 2;
const OPEN = 0.35; // 铺开要多久
const DRAIN = 0.55; // 砸下之后退干要多久
/** 泥水溅起来的颜色（浅黄、白浪、琥珀）。 */
const MUD = [0xb39e7d, 0xf2e8d5, 0xc8b07a, 0xb06a28];

interface River {
  owner: number;
  x: number;
  y: number;
  r: number;
  R: number; // 贴图按的半径（取整到 4，同样大小的共用一套贴图）
  t: number;
  dur: number;
  slam: number; // 砸下之后过了多久（< 0 = 还没砸）
  body: Sprite;
  swirl: Sprite;
  bodyFr: Texture[];
  revealFr: Texture[];
  swirlFr: Texture[];
  splashCd: number;
}

export class RiverFx {
  private rivers: River[] = [];
  private top = new Pixels();
  private layer = new Container();
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  clear() {
    for (const r of this.rivers) {
      r.body.destroy();
      r.swirl.destroy();
    }
    this.rivers = [];
    this.top.flush();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'waveEnd' || e.t === 'waveStart') {
      this.clear();
      return;
    }
    if (e.t === 'skill' && e.kind === 'huanghe') {
      const R = Math.max(40, Math.round(e.radius / 4) * 4);
      const seed = 2 + (e.owner % 3);
      const bodyFr = Ts(`riverB${R}${seed}`, () => [riverBody(R, seed)]);
      const revealFr = Ts(`riverR${R}${seed}`, () => {
        const b = riverBody(R, seed);
        return [0.2, 0.4, 0.6, 0.8, 0.92].map((k) => riverReveal(b, k));
      });
      const swirlFr = Ts(`riverS${R}${seed}`, () => riverSwirl(R, seed, 16));
      const body = new Sprite(revealFr[0]);
      body.anchor.set(0.5);
      body.alpha = 0;
      const swirl = new Sprite(swirlFr[0]);
      swirl.anchor.set(0.5);
      swirl.alpha = 0;
      this.stage.floor.addChild(body, swirl);
      this.rivers.push({ owner: e.owner, x: e.x, y: e.y, r: e.radius, R, t: 0, dur: e.dur ?? 1.9, slam: -1, body, swirl, bodyFr, revealFr, swirlFr, splashCd: 0 });
      this.play('huanghe.rise', 'xuanyuan.vortex', 1);
      // 铺开：脚下涌起一圈泥水
      for (let i = 0; i < 14; i++) {
        const a = rnd(0, TAU);
        this.sparks.emit(e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 4, 1, MUD, [30, 70], [0.35, 0.6], { dir: a, spread: 0.2, up: 30, g: 160, drag: 2 });
      }
      this.shake.add(0.08);
      return;
    }
    if (e.t === 'riverSlam') {
      const rv = this.rivers.find((x) => x.owner === e.owner && x.slam < 0);
      if (rv) rv.slam = 0;
      this.play('huanghe.slam', 'xuanyuan.pool', 1);
      this.play('huanghe.crash', 'fantian.land', 0.7);
      this.shake.add(0.16);
      // 中心掀起一团泥浪：水珠往四周甩（不高过约 1.5 个人）
      for (let i = 0; i < 26; i++) {
        const a = rnd(0, TAU);
        const sp = rnd(40, 95);
        this.sparks.emit(e.x + rnd(-4, 4), e.y - rnd(0, 6), 1, MUD, [sp, sp], [0.45, 0.8], { dir: -Math.PI / 2 + Math.cos(a) * 1.1, spread: 0.1, g: 230, drag: 1.2 });
      }
      // 砸在每一只身上：一小团泥水
      for (const id of e.ids) {
        const en = w.enemies.find((x) => x.id === id);
        if (en) this.sparks.emit(en.x, en.y, 5, MUD, [20, 50], [0.3, 0.55], { up: 35, g: 200, drag: 1.5 });
      }
    }
  }

  update(dt: number, w: World, _alpha: number) {
    this.time += dt;
    const px = this.top;
    for (let i = this.rivers.length - 1; i >= 0; i--) {
      const rv = this.rivers[i];
      rv.t += dt;
      // 模拟里这一圈没了（主人倒下、波末）却没砸：跟着退掉
      const p = w.players[rv.owner];
      if (rv.slam < 0 && (!p?.river || p.river.t0 > w.time) && rv.t > 0.2) rv.slam = 0;
      if (rv.slam >= 0) rv.slam += dt;
      if (rv.slam > DRAIN) {
        rv.body.destroy();
        rv.swirl.destroy();
        this.rivers.splice(i, 1);
        continue;
      }
      const open = clamp01(rv.t / OPEN);
      const fi = Math.min(rv.revealFr.length - 1, Math.floor(open * rv.revealFr.length));
      rv.body.texture = open < 1 ? rv.revealFr[fi] : rv.bodyFr[0];
      const drain = rv.slam >= 0 ? easeOut(rv.slam / DRAIN) : 0;
      rv.body.alpha = 0.9 * Math.min(1, open * 2) * (1 - drain);
      rv.body.position.set(Math.round(rv.x), Math.round(rv.y));
      // 漩涡：转得先快后慢（砸下时一下收进中心）
      const spin = rv.t * (1.6 - 0.4 * clamp01(rv.t / rv.dur));
      const f = Math.floor((spin / (TAU / 3)) * rv.swirlFr.length) % rv.swirlFr.length;
      rv.swirl.texture = rv.swirlFr[(f + rv.swirlFr.length) % rv.swirlFr.length];
      const sk = rv.slam >= 0 ? 1 - easeOut(rv.slam / 0.25) : 1;
      rv.swirl.scale.set(Math.max(0.05, sk));
      rv.swirl.alpha = clamp01((rv.t - OPEN * 0.6) / 0.25) * (rv.slam >= 0 ? clamp01(1 - rv.slam / 0.25) : 1);
      rv.swirl.position.set(Math.round(rv.x), Math.round(rv.y));
      // 卷着的敌人脚下不时溅起一点泥水
      if (rv.slam < 0 && p?.river) {
        rv.splashCd -= dt;
        if (rv.splashCd <= 0) {
          rv.splashCd = 0.07;
          const ids = p.river.ids;
          if (ids.length) {
            const en = w.enemies.find((x) => x.id === ids[Math.floor(Math.random() * ids.length)]);
            if (en) this.sparks.emit(en.x + rnd(-3, 3), en.y, 2, MUD, [10, 30], [0.25, 0.45], { up: 22, g: 160, drag: 2 });
          }
        }
      }
      // 砸下之后：水面往外推开一道断续的浪（推到岸边就散），不是一个圈
      if (rv.slam >= 0) {
        const k = easeOut(rv.slam / DRAIN);
        const rr = rv.r * (0.25 + 0.7 * k);
        const n = Math.round(TAU * rr * 0.9);
        const a = (1 - k) * 0.9;
        for (let j = 0; j < n; j++) {
          const ang = (j / n) * TAU;
          if (Math.sin(ang * 11 + rv.x) < -0.1) continue;
          px.dot(rv.x + Math.cos(ang) * rr, rv.y + Math.sin(ang) * rr * FLAT, j % 3 ? C.w : 0xc8b07a, a);
        }
      }
    }
    px.flush();
    void this.glows;
  }
}
