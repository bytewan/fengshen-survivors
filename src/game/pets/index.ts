
// 宠物画面：按宠物的种类分派（种类跟着角色走，见 sim/pet.ts）。混天绫照旧走 game/pet-fx.ts，哮天犬在 pets/xiaotian-fx.ts，黑虎在 pets/heihu-fx.ts，青鸾在 pets/qingluan-fx.ts，雷鹏在 pets/leipeng-fx.ts，毫毛猴在 pets/maohou-fx.ts。
// 和别的特效模块同一个接口（onEvent / update / clear），feel.ts 只构造这一个。
// 加一种宠物：写它的画面模块（同样三个方法），在这里构造、按种类把事件和每帧的推进交给它。
import type { Stage } from '../../render/stage.ts';
import type { Particles } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { petKindOf } from '../../sim/pet.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { PetFx } from '../pet-fx.ts';
import { XiaotianFx } from './xiaotian-fx.ts';
import { HeihuFx } from './heihu-fx.ts';
import { QingluanFx } from './qingluan-fx.ts';
import { LeipengFx } from './leipeng-fx.ts';
import { MaohouFx } from './maohou-fx.ts';
import { BishuiFx } from './bishui-fx.ts';

export class PetViews {
  private huntian: PetFx;
  private xiaotian: XiaotianFx;
  private heihu: HeihuFx;
  private qingluan: QingluanFx;
  private leipeng: LeipengFx;
  private maohou: MaohouFx;
  private bishui: BishuiFx;

  constructor(stage: Stage, sparks: Particles, sfx: Sfx) {
    this.huntian = new PetFx(stage, sparks, sfx);
    this.xiaotian = new XiaotianFx(stage, sparks, sfx);
    this.heihu = new HeihuFx(stage, sparks, sfx);
    this.qingluan = new QingluanFx(stage, sparks, sfx);
    this.leipeng = new LeipengFx(stage, sparks, sfx);
    this.maohou = new MaohouFx(stage, sparks, sfx);
    this.bishui = new BishuiFx(stage, sparks, sfx); // 回响敖丙 · 避水兽
  }

  clear() {
    this.huntian.clear();
    this.xiaotian.clear();
    this.heihu.clear();
    this.qingluan.clear();
    this.leipeng.clear();
    this.maohou.clear();
    this.bishui.clear();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      // 进化：只交给这只宠物自己的画面（两边都会放进化的音效）
      const p = w.players[e.owner];
      const kind = p ? petKindOf(p) : 'huntian';
      (kind === 'xiaotian' ? this.xiaotian : kind === 'heihu' ? this.heihu : kind === 'qingluan' ? this.qingluan : kind === 'leipeng' ? this.leipeng : kind === 'maohou' ? this.maohou : kind === 'bishui' ? this.bishui : this.huntian).onEvent(e, w);
      return;
    }
    if (e.t === 'wrap') this.huntian.onEvent(e, w);
    else if (e.t === 'bite') this.xiaotian.onEvent(e, w);
    else if (e.t === 'roar' || e.t === 'broke') this.heihu.onEvent(e, w);
    else if (e.t === 'feather') this.qingluan.onEvent(e, w);
    else if (e.t === 'stoop' || e.t === 'zap' || e.t === 'twitch') this.leipeng.onEvent(e, w);
    else if (e.t === 'hair' || e.t === 'tease' || e.t === 'impEnd') this.maohou.onEvent(e, w);
    else if (e.t === 'splash') this.bishui.onEvent(e, w);
  }

  update(dt: number, w: World, alpha: number) {
    this.huntian.update(dt, w, alpha);
    this.xiaotian.update(dt, w, alpha);
    this.heihu.update(dt, w, alpha);
    this.qingluan.update(dt, w, alpha);
    this.leipeng.update(dt, w, alpha);
    this.maohou.update(dt, w, alpha);
    this.bishui.update(dt, w, alpha);
  }
}
