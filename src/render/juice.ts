// 打击感工具：全部只作用在表现层，不回写模拟（房主权威 + 固定步长，模拟不能被表现层停下）。
// 参数分档参考 docs/references/gamedev-skills/game-feel.md 的小 / 中 / 大三档。
import { Container, ParticleContainer, Sprite, Texture, type IParticle } from 'pixi.js';
import { quality } from './quality.ts';

/** 震屏：累积「创伤值」，位移 = 创伤²，平滑衰减（不是每帧随机抖）。 */
/** 震屏的门槛（Shake.add）：minor 以下不震，major 以上不受间隔限制，gap 是中等震动之间的最短间隔（秒）。 */
export const SHAKE = { minor: 0.45, major: 0.7, gap: 2.5 };

export class Shake {
  trauma = 0;
  private t = 0;
  private maxX: number;
  private maxY: number;
  private decay: number;
  constructor(maxX = 6, maxY = 4, decay = 1.7) {
    this.maxX = maxX;
    this.maxY = maxY;
    this.decay = decay;
  }
  /**
   * 震一下。用户 2026-11-12：「从姚天君开始屏幕就在晃……不应该一直晃，只有特殊时候才能触发屏幕晃」——
   * 原来一百来处（法宝命中、挨打、首领每一招、地形……）都在加一点，叠起来就是一直在抖。现在一处管住：
   * 小于 SHAKE.minor 的一律不震；中等的（精英倒下、首领换阶段、神通……）两次之间至少隔 SHAKE.gap 秒；
   * SHAKE.major 以上的（首领倒下、被打倒、神通的大招）照震。调用的地方不用改。
   */
  add(a: number) {
    if (a < SHAKE.minor) return;
    if (a < SHAKE.major && this.t - this.last < SHAKE.gap) return;
    this.last = this.t;
    this.trauma = Math.min(1, this.trauma + a);
  }
  private last = -99;
  update(dt: number) {
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    this.t += dt;
  }
  get offset(): [number, number] {
    const s = this.trauma * this.trauma;
    return [Math.round(this.maxX * s * Math.sin(this.t * 41)), Math.round(this.maxY * s * Math.sin(this.t * 53 + 1.3))];
  }
}

/** 命中停顿：只冻结画面（表现层不推进），模拟照常跑；冻结结束后画面追上。只保留最晚的那个结束时间。 */
export class HitStop {
  private until = 0;
  trigger(now: number, seconds: number) {
    this.until = Math.max(this.until, now + seconds);
  }
  frozen(now: number) {
    return now < this.until;
  }
}

/**
 * 一层粒子同时最多活这么多。平常的重场面（两三百只敌人、四件神品）每层两千多粒，够用；
 * 掉帧时一帧里要补跑好几步模拟、一下子喷出平时几倍的粒子，粒子越多越卡、越卡喷得越多——所以要有个顶。
 * 过了 SOFT 之后新喷的按剩余的份额打折，到 MAX 就不再加。
 */
const PARTICLE_MAX = 3200;
const PARTICLE_SOFT = 2400;

/** 一粒粒子。字段名照 Pixi 的 IParticle（ParticleContainer 每帧直接读这些字段去画），外加自己的运动参数。 */
class Dot implements IParticle {
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  readonly anchorX = 0;
  readonly anchorY = 0;
  readonly rotation = 0;
  /** 颜色和透明度打包在一起：0xAABBGGRR。 */
  color = 0xffffffff;
  readonly texture: Texture;
  /** 颜色部分（0x00BBGGRR）。 */
  bgr = 0xffffff;
  vx = 0;
  vy = 0;
  g = 0;
  drag = 0;
  life = 0;
  max = 0;
  constructor(texture: Texture) {
    this.texture = texture;
  }
}

/**
 * 一像素粒子：火星、魂雾、碎光。
 * 整层粒子画在一个 Pixi 的 ParticleContainer 里：一次绘制、粒子不是场景里的节点。原来每粒是一个精灵，
 * 重场面里几千个精灵光是每帧被 Pixi 逐个收集、算变换、拼批次就要好几毫秒；现在每粒只是往缓冲里写几个数。
 * 画出来的一样（同样对齐到整像素、同样的混合方式）；这一层在父容器里的前后位置是它第一次用到时的位置。
 */
export class Particles {
  private live: Dot[] = [];
  private free: Dot[] = [];
  private parent: Container;
  private tex: Texture;
  private box: ParticleContainer | null = null;
  /** 不变的那部分（贴图坐标、旋转：每粒都一样）已经传上去了几粒：粒子变多了才要再传（docs/perf.md）。 */
  private staticN = 0;
  /** 上一次上屏的时间：好一阵没画之后 Pixi 可能回收了这层的缓冲，要整份重传。 */
  private lastDraw = -1e9;
  constructor(parent: Container, tex: Texture) {
    this.parent = parent;
    this.tex = tex;
  }
  /** 粒子比传过不变部分的多了：下次画之前把不变的那部分也传上去。 */
  private grow() {
    if (this.live.length <= this.staticN) return;
    this.staticN = this.live.length;
    this.box?.update();
  }
  emit(x: number, y: number, n: number, color: number | number[], speed: [number, number], life: [number, number], opts: { up?: number; g?: number; drag?: number; spread?: number; dir?: number; scale?: number } = {}) {
    const live = this.live;
    // 画质（quality.ts）：低档、或者掉帧了，成团迸出的装饰粒子少一些；一次三粒以内的（预警、拖尾这种一粒一粒冒的）照旧。
    // 倍率是 1 的时候（高档、不掉帧）这里什么都不做，也不多取随机数，画面和原来一模一样
    const k = quality.decor;
    if (k < 1 && n > 3) {
      const want = 3 + (n - 3) * k;
      n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    }
    const over = live.length + n - PARTICLE_SOFT;
    if (over > 0) {
      // 快到顶了：这一批按剩下的份额打折（小数部分按概率取整，零星的一两粒不会被一刀切掉）
      const room = Math.max(0, PARTICLE_MAX - live.length) / (PARTICLE_MAX - PARTICLE_SOFT);
      const want = n * Math.min(1, room);
      n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    }
    if (n > 0 && !this.box) {
      // 第一次用到时才挂上去（和原来第一粒精灵挂上去的时机一样：排在这之前已经在父容器里的东西上面）
      // 位置、大小、颜色每帧都在变；贴图坐标和旋转不变，但粒子在数组里的位置会变，所以每帧也一并重传（见 update）
      this.box = new ParticleContainer({ texture: this.tex, particles: live, dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false } });
      this.box.onRender = () => {
        const now = performance.now();
        if (now - this.lastDraw > 500) {
          // 好一阵没画（万宝阁里）：Pixi 可能回收了这层的缓冲，重建的缓冲里没有不变的那部分
          this.box!.update();
          this.staticN = this.live.length;
        }
        this.lastDraw = now;
      };
      this.parent.addChild(this.box);
    }
    for (let i = 0; i < n; i++) {
      const d = this.free.pop() ?? new Dot(this.tex);
      d.scaleX = d.scaleY = opts.scale ?? 1;
      const c = Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color;
      d.bgr = ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
      d.color = (0xff000000 | d.bgr) >>> 0;
      const a = opts.dir !== undefined ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2) : Math.random() * Math.PI * 2;
      const sp = speed[0] + Math.random() * (speed[1] - speed[0]);
      const l = life[0] + Math.random() * (life[1] - life[0]);
      d.x = Math.round(x);
      d.y = Math.round(y);
      d.vx = Math.cos(a) * sp;
      d.vy = Math.sin(a) * sp - (opts.up ?? 0);
      d.g = opts.g ?? 0;
      d.drag = opts.drag ?? 2;
      d.life = d.max = l;
      live.push(d);
    }
    if (n > 0) this.grow(); // 多了粒子：下次画之前把不变的那部分也传上去（命中停顿时不走 update，这里也要说一声）
  }
  update(dt: number) {
    // 从后往前过一遍：死掉的回收，活着的原样往数组尾部收拢，最后整体挪回开头（先后顺序不变，每帧只挪一次）
    const live = this.live;
    const n = live.length;
    let w = n;
    for (let i = n - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.free.push(p);
        continue;
      }
      live[--w] = p;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const alpha = Math.min(1, (p.life / p.max) * 1.6);
      p.color = (((alpha * 255 + 0.5) << 24) | p.bgr) >>> 0;
    }
    if (w > 0) {
      live.copyWithin(0, w);
      live.length -= w;
    }
    // 不变的那部分（贴图坐标、旋转）每粒都一样，排位变了也不用重传；只有粒子比传过的多了才传（grow）。
    // 长时间没画（万宝阁里）之后 Pixi 会回收这层的缓冲，再画时整份重传（onRender 里）
    this.grow();
  }
  get count() {
    return this.live.length;
  }
}

/** 伤害飘字：弹出时略放大再回落，上浮减速，最后淡出。同屏数量有上限，避免糊成一片。 */
export class DamageNumbers {
  private live: { c: Container; vy: number; t: number; life: number; base: number }[] = [];
  private pool: Container[] = [];
  private parent: Container;
  private glyphs: Record<'normal' | 'crit' | 'skill' | 'corrode', Texture[]>;
  private max: number;
  constructor(parent: Container, glyphs: Record<'normal' | 'crit' | 'skill' | 'corrode', Texture[]>, max = 48) {
    this.parent = parent;
    this.glyphs = glyphs;
    this.max = max;
  }
  spawn(x: number, y: number, value: number, style: 'normal' | 'crit' | 'skill' | 'corrode') {
    if (this.live.length >= this.max) {
      const old = this.live.shift()!;
      old.c.visible = false;
      this.pool.push(old.c);
    }
    const c = this.pool.pop() ?? new Container();
    const digits = String(Math.round(value));
    const gw = 4; // 字距
    // 每一位一个精灵，留在容器里下次接着用（重场面里一帧要换上百个数字，不反复新建销毁）
    for (let i = 0; i < digits.length; i++) {
      const t = this.glyphs[style][digits.charCodeAt(i) - 48] ?? Texture.EMPTY;
      let s = c.children[i] as Sprite | undefined;
      if (s) {
        s.texture = t;
        s.visible = true;
      } else {
        s = new Sprite(t);
        c.addChild(s);
      }
      s.x = i * gw;
    }
    for (let i = digits.length; i < c.children.length; i++) c.children[i].visible = false;
    const base = style === 'crit' ? 2 : 1; // 神通一次打中几十只，数字用小号，免得满屏都是
    c.pivot.set((digits.length * gw + 1) / 2, 7);
    c.position.set(Math.round(x + (Math.random() - 0.5) * 6), Math.round(y));
    c.scale.set(base);
    c.visible = true;
    c.alpha = 1;
    if (!c.parent) this.parent.addChild(c);
    this.live.push({ c, vy: -38 - Math.random() * 10, t: 0, life: style === 'normal' ? 0.5 : 0.75, base });
  }
  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const n = this.live[i];
      n.t += dt;
      if (n.t >= n.life) {
        n.c.visible = false;
        this.pool.push(n.c);
        this.live.splice(i, 1);
        continue;
      }
      n.vy *= Math.exp(-5 * dt);
      n.c.y += n.vy * dt;
      // 前 0.07 秒放大到 1.5 倍再回落（整数倍缩放，像素不糊）
      n.c.scale.set(n.t < 0.07 ? n.base + (n.base >= 2 ? 1 : 1) : n.base);
      n.c.alpha = n.t > n.life - 0.15 ? (n.life - n.t) / 0.15 : 1;
    }
  }
}
