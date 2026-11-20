// 赵公明神通「金鞭」的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件（skill / whip）、Player.whip 和 world.gems。
// 一鞭：一条巨大的竹节金鞭虚影在那条线的上方显出来、往后一扬（鞭梢离地不过三十像素，用户：竖着往上的不过约 1.5 个人），
// 地上那条线先暗下来一道影子；然后整条鞭子拍下去，贴着地砸成一条直线 —— 一闪，尘土顺着线往两边掀开，碎石崩起；
// 鞭影在地上停一下，化成往上飘的金屑散掉；地上从脚前往外「拉链」似的裂开一道金缝，缝里是熔金似的光，一明一暗，
// 慢慢暗下去、合上。缝里迸出的金元宝（模拟里是 ingot 的灵石）在这里画：从缝里蹦出来、落在缝边，偶尔一闪。
// 和打神鞭（从云里抽下来、抽一只）分得开：没有云、不从天上来，是贴着地砸出去的一整条线。
// 用户口径：不要光圈；效果不超过判定（金缝就是砸中的那条线，宽不过判定的半宽）；出现和消失都有过程。
import { Container, Sprite, type Texture } from 'pixi.js';
import { grid, outline } from '../../art/pixel.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, GOLD_SPARKS, Pixels, rnd } from '../fx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const DUST = [0x6b5749, 0x776672, 0x4f5652, 0xb3b8a6];

/** 金元宝（9×5：两头的耳朵翘起来、中间鼓起一个圆顶，下面一道赭色的底），描赭边。 */
const INGOT = outline(grid(['y...Y...y', 'yy.YYY.yy', 'byyyfyyyb', '.bbyyybb.', '..BBBBB..']), 'k', { y: 'B', Y: 'B', b: 'B', f: 'B' });

interface Lash {
  owner: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hw: number; // 判定的半宽（金缝不宽过它）
  t: number; // 举鞭之后过了多久
  delay: number; // 举鞭到砸下
  struck: number; // 砸下之后过了多久（-1 = 还没砸）
  life: number; // 金缝多久合上
  crack: [number, number][]; // 金缝的折线（贴地的像素点，从脚前到远端）
  twigs: [number, number][][]; // 缝边的细岔
  motes: number; // 鞭影化开时还要放几粒金屑
}
interface IngotView {
  s: Sprite;
  sh: Sprite;
  age: number;
  x: number;
  y: number;
}

export class JinbianFx {
  private lashes: Lash[] = [];
  private ingots = new Map<number, IngotView>();
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private ingotTex: Texture | null = null;
  private stage: Stage;
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, _glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    stage.floor.addChild(this.under.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  clear() {
    this.lashes = [];
    this.top.flush();
    this.under.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'skill': {
        if (e.kind !== 'jinbian') break;
        const wh = w.players[e.owner]?.whip;
        if (!wh) break;
        this.lashes = this.lashes.filter((l) => l.owner !== e.owner || l.struck >= 0);
        this.lashes.push({ owner: e.owner, x0: wh.x0, y0: wh.y0, x1: wh.x1, y1: wh.y1, hw: wh.w, t: 0, delay: e.dur ?? wh.delay, struck: -1, life: 2.6, crack: [], twigs: [], motes: 0 });
        this.sparks.emit(wh.x0, wh.y0 - 14, 8, GOLD_SPARKS, [10, 30], [0.3, 0.5], { up: 20, drag: 3 });
        this.play('jinbian.raise', 'dashen.fall', 0.8);
        break;
      }
      case 'whip': {
        let l = this.lashes.find((v) => v.owner === e.owner && v.struck < 0);
        if (!l) {
          // 没看到举鞭的那一下（联机时晚到、中途接上）：直接从砸下开始画
          l = { owner: e.owner, x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, hw: e.w, t: 0, delay: 0, struck: -1, life: e.life, crack: [], twigs: [], motes: 0 };
          this.lashes.push(l);
        }
        l.struck = 0;
        l.life = e.life;
        l.x0 = e.x0;
        l.y0 = e.y0;
        l.x1 = e.x1;
        l.y1 = e.y1;
        l.crack = seam(e.x0, e.y0, e.x1, e.y1);
        l.twigs = twigs(l.crack, e.w);
        l.motes = 26;
        // 砸下的那一下：顺着线一闪，尘土往两边掀开，碎石崩起
        const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0) || 1;
        const nx = -(e.y1 - e.y0) / len;
        const ny = (e.x1 - e.x0) / len;
        for (let s = 0; s <= len; s += 7) {
          const x = e.x0 + ((e.x1 - e.x0) * s) / len;
          const y = e.y0 + ((e.y1 - e.y0) * s) / len;
          for (const side of [-1, 1]) this.sparks.emit(x + nx * side * 3, y + ny * side * 3, 1, DUST, [e.w * 2.2, e.w * 3.6], [0.3, 0.55], { dir: Math.atan2(ny * side, nx * side), spread: 0.5, drag: 4.5 });
          if (s % 21 === 0) this.sparks.emit(x, y - 2, 2, [0x4f5652, 0x6d756c, 0x6b5749], [30, 70], [0.35, 0.6], { up: 60, g: 260, drag: 1.5 });
          if (s % 14 === 0) this.sparks.emit(x, y - 2, 1, [C.W, C.f, C.Y], [8, 24], [0.15, 0.3], { up: 16, drag: 3 });
        }
        this.shake.add(0.7);
        this.play('jinbian.strike', 'fantian.land', 1);
        this.play('jinbian.crack', 'zone.crack', 0.7);
        break;
      }
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    for (let i = this.lashes.length - 1; i >= 0; i--) {
      const l = this.lashes[i];
      l.t += dt;
      if (l.struck >= 0) l.struck += dt;
      if ((l.struck < 0 && l.t > l.delay + 0.6) || l.struck > l.life + 0.1) {
        this.lashes.splice(i, 1);
        continue;
      }
      this.drawLash(l, dt);
    }
    this.drawIngots(dt, w, alpha);
    this.top.flush();
    this.under.flush();
  }

  /** 一鞭的样子：举起（地上一道影子）→ 拍下 → 停在地上一下、化成金屑；金缝裂开、明暗、合上。 */
  private drawLash(l: Lash, dt: number) {
    const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) || 1;
    const ux = (l.x1 - l.x0) / len;
    const uy = (l.y1 - l.y0) / len;
    if (l.struck < 0) {
      // 举鞭：前 72% 慢慢扬起（鞭梢离地 18 → 30），最后 28% 加速拍下
      const k = clamp01(l.t / l.delay);
      const up = clamp01(k / 0.72);
      const fall = clamp01((k - 0.72) / 0.28);
      const lift = (1 - fall * fall) * (0.6 + 0.4 * up);
      const zA = 10 * lift;
      const zB = 30 * lift;
      const a = (0.25 + 0.55 * up) * (1 - 0.15 * fall);
      this.rod(l.x0, l.y0, ux, uy, len, zA, zB, a, false);
      // 地上的影子：越落越深
      for (let s = 0; s <= len; s += 1) this.under.dot(l.x0 + ux * s, l.y0 + uy * s, C.k, 0.12 + 0.3 * fall);
      return;
    }
    // 砸下之后：鞭影贴地，先一闪（月白），停 0.22 秒，再 0.35 秒淡掉、化成往上飘的金屑
    const st = l.struck;
    if (st < 0.6) {
      const flash = st < 0.07;
      const a = st < 0.22 ? 0.85 : 0.85 * (1 - (st - 0.22) / 0.38);
      this.rod(l.x0, l.y0, ux, uy, len, 0, 0, a, flash);
      if (st > 0.2 && l.motes > 0) {
        const n = Math.min(l.motes, Math.ceil(dt * 70));
        l.motes -= n;
        for (let j = 0; j < n; j++) {
          const s = rnd(0, len);
          this.sparks.emit(l.x0 + ux * s, l.y0 + uy * s - 1, 1, GOLD_SPARKS, [4, 12], [0.4, 0.8], { up: 22, drag: 2 });
        }
      }
    }
    // 金缝：0.14 秒从脚前拉到远端；缝里熔金的光一明一暗；最后 0.7 秒暗下去合上
    const open = clamp01(st / 0.14);
    const close = clamp01((l.life - st) / 0.7);
    const n = Math.round(l.crack.length * open);
    const glow = close * (0.75 + 0.25 * Math.sin(this.time * 7));
    for (let j = 0; j < n; j++) {
      const [x, y] = l.crack[j];
      const hot = st < 0.25 ? C.W : j % 5 === 0 ? C.f : C.Y;
      // 缝口：熔金的芯（一明一暗），上下两边是裂开的深色缝沿（上沿两像素），偶尔一处缝开得宽一点
      const wide = j % 7 >= 2 && j % 7 <= 4;
      this.under.dot(x, y, close > 0.45 ? hot : C.y, glow);
      this.under.dot(x, y + 1, close > 0.5 ? (wide ? C.Y : C.y) : C.b, glow * (wide ? 0.9 : 0.6));
      this.under.dot(x, y - 1, C.k, 0.85 * close);
      this.under.dot(x, y - 2, C.d, 0.5 * close);
      this.under.dot(x, y + 2, C.k, 0.85 * close);
    }
    for (const tw of l.twigs) {
      const m = Math.round(tw.length * clamp01((st - 0.08) / 0.12));
      for (let j = 0; j < m; j++) this.under.dot(tw[j][0], tw[j][1], j === 0 ? C.b : C.k, (j === 0 ? glow : 0.6) * close);
    }
    // 缝里偶尔迸出一粒金星
    if (st > 0.2 && close > 0.3 && Math.random() < dt * 6) {
      const [x, y] = l.crack[Math.floor(Math.random() * l.crack.length)];
      this.sparks.emit(x, y - 1, 1, [C.Y, C.f], [6, 16], [0.3, 0.5], { up: 26, g: 60, drag: 2 });
    }
  }

  /**
   * 竹节金鞭的虚影：从 (x0, y0)（离地 zA）沿 (ux, uy) 长 len 到鞭梢（离地 zB）的一根直鞭。
   * 鞭身五像素粗：当中三像素的芯（缃、灵光），两边一像素藤黄、外沿再淡一圈琥珀（虚影的边是软的，不是一道硬线）；
   * 每隔 10 像素一道鞭节（七像素宽的一圈琥珀、受光的一边缃金），近端一截乌木的把手和金镡，鞭梢收细、一粒缃金的鞭头。
   * flash：砸下那一下整根月白。
   */
  private rod(x0: number, y0: number, ux: number, uy: number, len: number, zA: number, zB: number, a: number, flash: boolean) {
    const px = this.top;
    // 屏幕上的法线（鞭身的粗细往这个方向铺）：鞭子斜着离地时，屏幕上的方向要算上高度
    const dx = ux * len;
    const dy = uy * len - (zB - zA);
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;
    const ny = dx / L;
    const GRIP = 9;
    for (let s = 0; s <= len; s += 0.5) {
      const k = s / len;
      const z = zA + (zB - zA) * k;
      const cx = x0 + ux * s;
      const cy = y0 + uy * s - z;
      const tip = len - s;
      const joint = s > GRIP + 2 && Math.round(s - GRIP) % 10 === 0 && tip > 4;
      // 粗细：把手 3、鞭身 5、鞭节 7、鞭梢最后 8 像素收到 3
      const half = s < GRIP ? 1 : joint ? 3 : tip < 8 ? 1 + (tip > 4 ? 1 : 0) : 2;
      for (let o = -half; o <= half; o++) {
        const edge = Math.abs(o) === half;
        let col: number;
        let aa = a;
        if (flash) col = o === 0 ? C.W : C.w;
        else if (s < GRIP) col = s > GRIP - 2 ? (o === 0 ? C.Y : C.y) : o === 0 ? C.g : C.d; // 乌木把手、金镡
        else if (joint) col = o < 0 ? C.Y : C.b;
        else if (edge && half >= 2) {
          col = C.b;
          aa = a * 0.55;
        } else col = Math.abs(o) <= 0 ? C.f : Math.abs(o) === 1 && half >= 2 ? C.Y : C.y;
        px.dot(cx + nx * o, cy + ny * o, col, aa);
      }
    }
    // 鞭头一粒
    const tz = zB;
    px.dot(x0 + ux * (len + 1), y0 + uy * (len + 1) - tz, flash ? C.W : C.Y, a);
    px.dot(x0 + ux * (len + 2), y0 + uy * (len + 2) - tz, flash ? C.w : C.y, a * 0.8);
  }

  /** 金元宝（world.gems 里 ingot 的）：从缝里蹦出来（一道小弧）、落在缝边，偶尔一闪；被吸走、捡起时跟着灵石的位置走。 */
  private drawIngots(dt: number, w: World, alpha: number) {
    if (!this.ingotTex) this.ingotTex = textureFromGrid(INGOT);
    const seen = new Set<number>();
    for (const g of w.gems) {
      if (!g.ingot) continue;
      seen.add(g.id);
      let v = this.ingots.get(g.id);
      if (!v) {
        const s = new Sprite(this.ingotTex);
        s.anchor.set(0.5, 1);
        this.stage.entities.addChild(s);
        const sh = new Sprite(this.stage.tex.smallShadow);
        sh.anchor.set(0.5);
        sh.alpha = 0.3;
        sh.scale.set(0.7);
        this.stage.floor.addChild(sh);
        v = { s, sh, age: 0, x: g.x, y: g.y };
        this.ingots.set(g.id, v);
        this.play('jinbian.ingot', 'pickup.hi', 0.3);
      }
      v.age += dt;
      const x = g.px + (g.x - g.px) * alpha;
      const y = g.py + (g.y - g.py) * alpha;
      const hop = v.age < 0.42 ? 13 * Math.sin(Math.PI * (v.age / 0.42)) : Math.sin(this.time * 3 + g.id) * 0.6;
      v.s.position.set(Math.round(x), Math.round(y - hop));
      v.s.zIndex = Math.round(y);
      v.sh.position.set(Math.round(x), Math.round(y));
      v.x = x;
      v.y = y;
      if (v.age > 0.5 && Math.random() < dt * 0.9) this.sparks.emit(x + rnd(-2, 2), y - 4, 1, [C.W, C.f], [2, 6], [0.25, 0.4], { up: 8, drag: 2 });
    }
    for (const [id, v] of this.ingots) {
      if (seen.has(id)) continue;
      // 捡到了（或这一波收走了）：原地迸一撮金屑
      this.sparks.emit(v.x, v.y - 4, 5, GOLD_SPARKS, [12, 34], [0.25, 0.45], { up: 20, drag: 2.5 });
      v.s.destroy();
      v.sh.destroy();
      this.ingots.delete(id);
    }
  }
}

/** 金缝的折线：沿着那条线、左右各抖一两像素（不是一条硬直线），一像素一点。 */
function seam(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const pts: [number, number][] = [];
  let off = 0;
  for (let s = 0; s <= len; s += 1) {
    off = Math.max(-2.4, Math.min(2.4, off + rnd(-0.6, 0.6)));
    const p: [number, number] = [Math.round(x0 + ux * s - uy * off), Math.round(y0 + uy * s + ux * off)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  return pts;
}

/** 缝边的细岔：每隔十几像素从缝上岔出去一道短的（不长过判定的半宽）。 */
function twigs(crack: [number, number][], hw: number): [number, number][][] {
  const out: [number, number][][] = [];
  for (let j = 6; j < crack.length - 4; j += 11 + Math.floor(Math.random() * 6)) {
    const [x, y] = crack[j];
    const [x2, y2] = crack[Math.min(crack.length - 1, j + 2)];
    const side = Math.random() < 0.5 ? -1 : 1;
    let a = Math.atan2(y2 - y, x2 - x) + side * rnd(0.7, 1.2);
    const n = Math.round(rnd(0.4, 0.8) * hw);
    const pts: [number, number][] = [];
    let cx = x;
    let cy = y;
    for (let s = 0; s < n; s++) {
      a += rnd(-0.3, 0.3);
      cx += Math.cos(a);
      cy += Math.sin(a);
      pts.push([Math.round(cx), Math.round(cy)]);
    }
    out.push(pts);
  }
  return out;
}
