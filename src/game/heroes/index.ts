// 角色的画面（神通、专属法宝、被动）：按事件分派给各角色自己的模块，和别的特效模块同一个接口（onEvent / update / clear），
// feel.ts 只构造这一个。另外它告诉 feel.ts 两件事：人物这一帧要不要换出招的姿势（pose），手里的法宝在不在手上（busy）。
//   哪吒：神通「三头六臂」、乾坤圈的画面原样留在 feel.ts / fx.ts，这里什么都不做。
//   杨戬：三尖两刃刀（sanjian-fx.ts）、天眼（gaze-fx.ts）、被动「乘隙」的残影（这里）。
//   赵公明：定海珠（dinghai-fx.ts）、金鞭和金元宝（jinbian-fx.ts）；被动「招财」不另画（拾到的灵石数字照常飘）。
//   云霄：混元金斗（dou-fx.ts；被吸进斗里的敌人由 enemy-views.ts 照 dou-pose.ts 画）、九曲黄河（river-fx.ts）、被动「冰心」（这里）。
//   雷震子：黄金棍（staff-fx.ts）、神通「风雷翅」和被动「生翅」（wing-fx.ts：飞着的时候人物换 fly / dive / slam 的帧、往上画 lift 那么高）。
//   魔化哪吒（回响化身）：黑焰轮、火尖枪突进、被动「业火」身上的黑焰（heiyan-fx.ts）；回响赵公明：缚龙索、钉头七箭、被动「怨力」（huizhao-fx.ts）；
//   回响云霄：乾坤图、黄河阵 · 削顶、被动「截教」（huiyun-fx.ts）；回响敖丙：游龙戟、化龙、被动「龙鳞」（youlong-fx.ts）。
//   孙悟空：如意金箍棒（jingu-fx.ts）、法天象地（faxiang-fx.ts：人物换成一档一档放大的帧）；被动「火眼金睛」（这里：打中精英、首领时眼里一闪金光）。
// 加一个角色：写他的法宝、神通的画面模块（同样三个方法），在这里构造、转发事件；出手的姿势在 POSES 里登记；
// 人物帧、对白这些在 game/hero-views.ts。
import type { Sprite } from 'pixi.js';
import { Sprite as PixiSprite } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import type { HeroPose } from '../hero-views.ts';
import { C, headOf, Pixels } from '../fx.ts';
import { REACH } from '../../sim/config.ts';
import { GazeFx } from './gaze-fx.ts';
import { SanjianFx } from './sanjian-fx.ts';
import { DinghaiFx } from './dinghai-fx.ts';
import { JinbianFx } from './jinbian-fx.ts';
import { DouFx } from './dou-fx.ts';
import { RiverFx } from './river-fx.ts';
import { StaffFx } from './staff-fx.ts';
import { WingFx } from './wing-fx.ts';
import { HeiyanFx } from './heiyan-fx.ts';
import { HuizhaoFx } from './huizhao-fx.ts';
import { HuiyunFx } from './huiyun-fx.ts';
import { YoulongFx } from './youlong-fx.ts';
import { JinguFx } from './jingu-fx.ts';
import { FaxiangFx, type FaxiangHook } from './faxiang-fx.ts';

/** 出手时人物换的姿势（一段一段接着放）：事件 → [姿势, 秒]。 */
function posesFor(e: SimEvent): [HeroPose, number][] | null {
  switch (e.t) {
    case 'cleave':
      return e.back ? [['windup', 0.12]] : [['throw', 0.13]];
    case 'stab':
      return [['follow', 0.16]];
    case 'chop':
      return [
        ['windup', 0.06],
        ['throw', 0.14],
      ];
    case 'staff':
      // 雷震子掷出黄金棍：举棍、掷出、收手（弹起再砸的那几下棍子不在手里，不换姿势）
      return e.seq === 1
        ? [
            ['windup', 0.07],
            ['throw', 0.14],
            ['follow', 0.12],
          ]
        : null;
    case 'loong':
      // 回响敖丙放出冰龙：戟往前一递，收势
      return [
        ['throw', 0.16],
        ['follow', 0.12],
      ];
    case 'staffSweep':
      // 孙悟空横扫一圈：手臂往外伸，棒子由特效绕着身子转
      return [['follow', 0.26]];
    case 'staffSmash':
      // 竖劈：举过头顶、劈下去
      return [
        ['windup', 0.05],
        ['throw', 0.2],
      ];
    case 'dou':
      // 云霄放出金斗：剑指朝前一点，收手
      return e.act === 'cast'
        ? [
            ['throw', 0.22],
            ['follow', 0.14],
          ]
        : null;
    case 'skill':
      // 赵公明「金鞭」：举鞭（和鞭影扬起一起），砸下，收势；云霄「九曲黄河」：掐诀举到面前，再朝前一点
      if (e.kind === 'jinbian') return [['windup', (e.dur ?? 0.34) - 0.04], ['throw', 0.2], ['follow', 0.16]];
      // 回响赵公明「钉头七箭」：举鞭一指（钉符），收势
      if (e.kind === 'dingtou') return [['windup', 0.3], ['follow', 0.2]];
      // 回响云霄「黄河阵 · 削顶」：掐诀举到面前，再朝前一点（同云霄的九曲黄河）
      if (e.kind === 'xueding') return [['windup', 0.45], ['throw', 0.22], ['follow', 0.14]];
      // 魔化哪吒「火尖枪突进」：端枪蓄力（地上那道线烧过去）、冲出去、收枪
      if (e.kind === 'tujin') return [['windup', e.dur ?? 0.32], ['throw', 0.26], ['follow', 0.22]];
      // 回响敖丙「化龙」：举戟（化成水雾之前的那一下）
      if (e.kind === 'hualong') return [['windup', 0.18]];
      // 孙悟空「法天象地」：两手举起（身形长起来），长足那一下往下一踏
      if (e.kind === 'faxiang') return [['windup', 0.3], ['throw', 0.18]];
      return e.kind === 'huanghe'
        ? [
            ['windup', 0.5],
            ['throw', 0.22],
            ['follow', 0.14],
          ]
        : null;
    default:
      return null;
  }
}
/** 出手姿势按人分：这几种事件带着放出它的那个人（owner）。 */
const posed = (e: SimEvent): e is Extract<SimEvent, { t: 'cleave' | 'stab' | 'chop' | 'dou' | 'skill' | 'staff' | 'staffSweep' | 'staffSmash' | 'loong' }> =>
  e.t === 'loong' || e.t === 'cleave' || e.t === 'stab' || e.t === 'chop' || e.t === 'dou' || e.t === 'skill' || e.t === 'staff' || e.t === 'staffSweep' || e.t === 'staffSmash';

interface Ghost {
  s: Sprite;
  t: number;
}

export interface HeroFxOpts {
  /** 第 i 个人物的精灵（被动的残影要照着它的这一帧画）。没有就不画残影。 */
  sprite: (owner: number) => Sprite | undefined;
  /** 这个角色的人物纹理（孙悟空「法天象地」按纹理换成放大的那一张；不给就不放大）。 */
  tex?: FaxiangHook['tex'];
}

export class HeroFx {
  private sanjian: SanjianFx;
  private gaze: GazeFx;
  private dinghai: DinghaiFx;
  private jinbian: JinbianFx;
  private dou: DouFx;
  private river: RiverFx;
  private staff: StaffFx;
  private wing: WingFx;
  private jingu: JinguFx;
  private faxiang: FaxiangFx;
  private chill = new Pixels(); // 冰心：她身边冻住的敌人，冰壳里亮起的一点
  private heiyan: HeiyanFx;
  private huizhao: HuizhaoFx;
  private huiyun: HuiyunFx;
  private youlong: YoulongFx;
  private glints: { owner: number; t: number }[] = []; // 火眼金睛：打中精英、首领时眼里的那一闪
  private poses = new Map<number, { q: [HeroPose, number][]; t: number }>();
  private ghosts: Ghost[] = [];
  private ghostCd = new Map<number, number>();
  private rushing = new Map<number, boolean>();
  private stage: Stage;
  private sparks: Particles;
  private opts: HeroFxOpts;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx, opts: HeroFxOpts) {
    this.stage = stage;
    this.sparks = sparks;
    this.opts = opts;
    this.sanjian = new SanjianFx(stage, sparks, glows, shake, sfx);
    this.gaze = new GazeFx(stage, sparks, glows, shake, sfx);
    this.dinghai = new DinghaiFx(stage, sparks, glows, shake, sfx);
    this.jinbian = new JinbianFx(stage, sparks, glows, shake, sfx);
    this.dou = new DouFx(stage, sparks, glows, shake, sfx);
    this.river = new RiverFx(stage, sparks, glows, shake, sfx);
    this.staff = new StaffFx(stage, sparks, glows, shake, sfx);
    this.wing = new WingFx(stage, sparks, glows, shake, sfx);
    this.jingu = new JinguFx(stage, sparks, glows, shake, sfx);
    this.faxiang = new FaxiangFx(stage, sparks, glows, shake, sfx, { sprite: opts.sprite, tex: opts.tex });
    stage.fx.addChild(this.chill.g);
    this.heiyan = new HeiyanFx(stage, sparks, glows, shake, sfx, { sprite: (o) => opts.sprite(o) });
    this.huizhao = new HuizhaoFx(stage, sparks, glows, shake, sfx);
    this.huiyun = new HuiyunFx(stage, sparks, glows, shake, sfx);
    this.youlong = new YoulongFx(stage, sparks, glows, shake, sfx, { sprite: (o) => opts.sprite(o) }); // 回响敖丙：游龙戟、化龙、龙鳞
  }

  /** 这一帧人物该换的出招姿势（没有 = 照常）。 */
  pose(owner: number): HeroPose | null {
    const fly = this.wing.pose(owner); // 风雷翅飞着：腾空、俯冲、砸下的帧盖过别的出手姿势
    if (fly) return fly;
    const p = this.poses.get(owner);
    return p && p.q.length ? p.q[0][0] : null;
  }

  /** 手里的法宝是不是正由特效画着（人物这时用空手的帧）。 */
  busy(owner: number): boolean {
    return this.sanjian.busy(owner) || this.jingu.busy(owner) || this.staff.busy(owner);
  }

  /** 人物离地多高（像素；雷震子「风雷翅」腾空、俯冲，被动「生翅」滑着）。 */
  lift(owner: number): number {
    return this.wing.lift(owner);
  }

  /** 人物正飞在半空（神通给的无敌：不闪）。 */
  airborne(owner: number): boolean {
    return this.wing.airborne(owner);
  }

  clear() {
    this.sanjian.clear();
    this.gaze.clear();
    this.dinghai.clear();
    this.jinbian.clear();
    this.dou.clear();
    this.river.clear();
    this.staff.clear();
    this.wing.clear();
    this.jingu.clear();
    this.faxiang.clear();
    this.glints = [];
    this.chill.flush();
    this.heiyan.clear();
    this.huizhao.clear();
    this.huiyun.clear();
    this.youlong.clear();
    this.poses.clear();
    for (const g of this.ghosts) g.s.destroy();
    this.ghosts = [];
  }

  onEvent(e: SimEvent, w: World) {
    this.sanjian.onEvent(e, w);
    this.gaze.onEvent(e, w);
    this.dinghai.onEvent(e, w);
    this.jinbian.onEvent(e, w);
    this.dou.onEvent(e, w);
    this.river.onEvent(e, w);
    this.staff.onEvent(e, w);
    this.wing.onEvent(e, w);
    this.heiyan.onEvent(e, w);
    this.huizhao.onEvent(e, w);
    this.huiyun.onEvent(e, w);
    this.youlong.onEvent(e, w);
    this.jingu.onEvent(e, w);
    this.faxiang.onEvent(e, w);
    this.huoyan(e, w);
    const seq = posesFor(e);
    if (seq && posed(e)) this.poses.set(e.owner, { q: seq.map(([p, t]) => [p, t] as [HeroPose, number]), t: 0 });
  }

  update(dt: number, w: World, alpha: number) {
    for (const [owner, p] of this.poses) {
      if (!p.q.length) {
        this.poses.delete(owner);
        continue;
      }
      p.q[0][1] -= dt;
      if (p.q[0][1] <= 0) p.q.shift();
    }
    this.sanjian.update(dt, w, alpha);
    this.gaze.update(dt, w, alpha);
    this.dinghai.update(dt, w, alpha);
    this.jinbian.update(dt, w, alpha);
    this.dou.update(dt, w, alpha);
    this.river.update(dt, w, alpha);
    this.staff.update(dt, w, alpha);
    this.wing.update(dt, w, alpha);
    this.heiyan.update(dt, w, alpha);
    this.huizhao.update(dt, w, alpha);
    this.huiyun.update(dt, w, alpha);
    this.youlong.update(dt, w, alpha); // 放在人物画完之后：化龙时把人物的精灵藏起来
    this.jingu.update(dt, w, alpha);
    this.faxiang.update(dt, w, alpha); // 放在别的后面：人物这一帧的帧已经换好（feel 先画人物、再调这里），这里再换成放大的那一张
    this.rush(dt, w);
    this.bingxin(w, alpha);
    this.drawGlints(dt, w, alpha);
  }

  /**
   * 被动「火眼金睛」（打精英、首领更疼）：孙悟空打中精英、首领的那一下，他眼里一闪金光——眼睛那一格亮一下，两边各迸一粒金星，
   * 0.25 秒淡掉；同一个人 0.6 秒内只闪一次（打得勤的时候不一直闪）。不画圈。
   */
  private huoyan(e: SimEvent, w: World) {
    if (e.t !== 'hit' || (e.kind !== 'elite' && e.kind !== 'boss')) return;
    for (const p of w.players) {
      if (p.hero !== 'wukong' || !p.alive) continue;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > (REACH.max + 20) ** 2) continue;
      if (this.glints.some((g) => g.owner === p.id && g.t < 0.6)) continue;
      this.glints.push({ owner: p.id, t: 0 });
    }
  }

  private drawGlints(dt: number, w: World, alpha: number) {
    const px = this.chill;
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const g = this.glints[i];
      g.t += dt;
      if (g.t > 0.6) {
        this.glints.splice(i, 1);
        continue;
      }
      const p = w.players[g.owner];
      if (!p || g.t > 0.25) continue;
      const s = this.opts.sprite(p.id);
      const k = 1 - g.t / 0.25;
      // 眼睛在画面上的位置：脚底往上约 25 像素、朝前 3 像素（法天象地期间按放大的倍数往上挪）
      const big = s ? Math.abs(s.scale.y) * (s.texture.height / 44) : 1;
      const x = Math.round(p.px + (p.x - p.px) * alpha + p.facing * 3 * big);
      const y = Math.round(p.py + (p.y - p.py) * alpha - 25 * big);
      px.dot(x, y, C.f, k);
      px.dot(x - 2, y - 1, C.Y, k * 0.7);
      px.dot(x + 2, y - 1, C.Y, k * 0.7);
    }
  }

  /**
   * 被动「冰心」（冻住的敌人受到她的伤害更高）：云霄身边（她的法宝够得着的地方）冻住的敌人，冰壳正中亮起一点冰心——
   * 一粒月白、四周四点天青，慢慢明灭（不画圈）。离她远的、没冻住的不画。
   */
  private bingxin(w: World, alpha: number) {
    const px = this.chill;
    for (const p of w.players) {
      if (p.hero !== 'yunxiao' || !p.alive) continue;
      for (const e of w.enemies) {
        if (e.frozen <= 0 || e.hp <= 0 || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > REACH.seek * REACH.seek) continue;
        const x = Math.round(e.px + (e.x - e.px) * alpha);
        const y = Math.round(e.py + (e.y - e.py) * alpha - headOf(e.kind) * 0.5);
        const a = Math.min(1, e.frozen / 0.4) * (0.55 + 0.45 * Math.sin(w.time * 5 + e.id));
        px.dot(x, y, C.W, a);
        px.dot(x - 1, y, C.Cc, a * 0.6);
        px.dot(x + 1, y, C.Cc, a * 0.6);
        px.dot(x, y - 1, C.Cc, a * 0.6);
        px.dot(x, y + 1, C.Cc, a * 0.6);
      }
    }
    px.flush();
  }

  /**
   * 被动「乘隙」（暴击后加速）：跑着的时候身后拖几道淡淡的银色残影（照着人物这一帧的剪影，很快淡掉），
   * 刚乘上隙的那一下脚下溅起几粒银金碎光。不加光圈。
   */
  private rush(dt: number, w: World) {
    for (const p of w.players) {
      const on = p.rushUntil !== undefined && w.time < p.rushUntil && p.alive;
      const was = this.rushing.get(p.id) ?? false;
      this.rushing.set(p.id, on);
      if (on && !was) this.sparks.emit(p.x, p.y, 6, [C.W, C.j, C.Y], [20, 50], [0.2, 0.35], { up: 10, drag: 3 });
      if (!on || !p.moving) continue;
      const cd = (this.ghostCd.get(p.id) ?? 0) - dt;
      this.ghostCd.set(p.id, cd);
      if (cd > 0) continue;
      this.ghostCd.set(p.id, 0.05);
      const src = this.opts.sprite(p.id);
      if (!src) continue;
      const g = new PixiSprite(src.texture);
      g.anchor.copyFrom(src.anchor);
      g.scale.copyFrom(src.scale);
      g.position.copyFrom(src.position);
      g.zIndex = src.zIndex - 1;
      g.tint = 0x9ab0d8;
      g.alpha = 0.42;
      this.stage.entities.addChild(g);
      this.ghosts.push({ s: g, t: 0 });
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const k = g.t / 0.26;
      if (k >= 1) {
        g.s.destroy();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.s.alpha = 0.42 * (1 - k) * (1 - k);
    }
  }
}
