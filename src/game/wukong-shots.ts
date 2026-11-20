// 隐藏角色孙悟空的解锁过场（一镜，约 8 秒；数据在 story.ts 的 CUTSCENES.wukong，播放器是 cutscene.ts）：
// 云海之上的玉台，天上那道很细的金色裂缝颤了颤、撕开——缝里是白金的光，金屑往下掉；一根金箍棒先掉下来，越落越快，
// 「咚」地插在台上（地面崩开几道细缝、尘土掀起来，画面一震，棒子还在颤）；一只猴子跟着从缝里翻出来，在半空翻两个跟头，
// 落在棒子旁边，东张西望，挠挠头：「俺老孙……这是到了哪一年？」裂缝慢慢合上，只剩几粒金屑飘下来。
// 画法和别的镜头一样：静的是位图，裂缝、地上的细缝每帧画进一块像素缓冲；人物、棒子用游戏里的精灵（一个画面像素 = 游戏里一个像素）。
// 用户口径：不要光圈（缝里的光只在缝里，往下落的是金屑，不画光晕）；出现消失有过程（裂缝撕开、合上都是慢慢的）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { makeCloudBank } from '../art/title.ts';
import { bayer, blank, mulberry32, put, sky, valueNoise, type Bitmap } from '../art/cutscene/common.ts';
import { lined, rotSprite } from '../art/sprites/fx.ts';
import { makeWukongFrames, makeWukongScratch, STAFF_SEL, staffUp, WUKONG_ANCHOR, WUKONG_H, WUKONG_W } from '../art/sprites/wukong.ts';
import { CLOUD_FAR, CLOUD_MID, cloudNear, ease, easeOut, Motes, type Shot, type ShotKit } from './cutscene-shots.ts';

const T_TEAR = 0.9; // 裂缝开始撕开
const T_OPEN = 1.6; // 撕到最大
const T_STAFF = 1.7; // 金箍棒从缝里出来
const T_PLANT = 2.3; // 插在台上
const T_OUT = 2.75; // 猴子翻出来
const T_LAND = 3.75; // 落地
const T_CLOSE = 6.2; // 裂缝开始合上
const T_GONE = 7.6; // 合上了

/** 裂缝的形状：一条略带折的竖线（相对缝顶的横向偏移，按行），两头尖、中间宽。 */
function crackPath(len: number, rnd: () => number): number[] {
  const xs: number[] = [];
  let x = 0;
  for (let y = 0; y <= len; y++) {
    if (y % 5 === 0) x += Math.round((rnd() - 0.45) * 2);
    xs.push(x + Math.round(y * 0.18)); // 往右下斜一点
  }
  return xs;
}

/**
 * 云海里冒出来的一座石峰的顶（猴子落脚的地方）：平顶（透视压扁的椭圆，浅石、受光的后沿缟白、几道裂纹），
 * 四面往下是石壁（左边受光的石灰、右边背光的苍石，一道道横的石纹），往下收进云里。w 宽、d 顶面的进深、h 石壁多高。
 * 返回位图和顶面正中（人站的那一点）在位图里的位置。
 */
function makePeak(w: number, d: number, h: number, seed: number): { b: Bitmap; top: { x: number; y: number } } {
  const b = blank(w, d + h + 2);
  const n = valueNoise(seed, 6, w, d + h + 2);
  const edge = valueNoise(seed + 7, 9, w, 8); // 轮廓的起伏：不是一个规整的圆台
  const rnd = mulberry32(seed + 1);
  const cxp = w / 2;
  for (let x = 0; x < w; x++) {
    const t = (x + 0.5 - cxp) / cxp;
    if (Math.abs(t) >= 1) continue;
    const r = Math.sqrt(1 - t * t);
    const wob = (edge(x, 2) - 0.5) * 4; // 前后沿各自起伏几个像素
    const back = Math.round(d / 2 - (d / 2) * r * 0.85 + (edge(x, 6) - 0.5) * 3);
    const rim = Math.round(d / 2 + (d / 2) * r + wob * r);
    if (rim <= back) continue;
    // 顶面：缟（亮）/ 银鼠，受光的后沿月白，几块苍色的石斑
    for (let y = back; y < rim; y++) {
      const v = n(x, y);
      const ch = y === back ? 'w' : v > 0.7 ? 'w' : v < 0.2 ? 'h' : v < 0.45 ? 'i' : 'j';
      put(b, x, y, ch);
    }
    put(b, x, rim, 'w'); // 前沿受光的一道
    // 石壁：越往两边越矮（往下收进云里），左边受光（银鼠）、右边背光（苍、黛），一道道横的石纹
    const side = Math.round(h * (0.35 + 0.65 * r) + (n(x, 40) - 0.5) * 8);
    for (let y = rim + 1; y <= rim + side; y++) {
      const k = (t + 1) / 2 + (n(x * 2, y) - 0.5) * 0.35; // 0 左（亮）… 1 右（暗）
      let ch = k < 0.35 ? 'i' : k < 0.66 ? 'h' : 'g';
      if ((y - rim) % 5 === 0 && rnd() < 0.7) ch = k < 0.5 ? 'h' : 'g';
      // 往下越来越淡进云里：底下一截按有序抖动跳着画
      const fadeK = (y - rim) / Math.max(1, side);
      if (fadeK > 0.65 && bayer(x, y) < (fadeK - 0.65) / 0.35) continue;
      put(b, x, y, ch);
    }
  }
  // 顶面上几道细裂纹（暗半档）
  for (let i = 0; i < 4; i++) {
    let x = Math.round(cxp + (rnd() - 0.5) * w * 0.6);
    let y = Math.round(d / 2 + (rnd() - 0.5) * d * 0.4);
    for (let s = 0; s < 6; s++) {
      put(b, x, y, 'h');
      x += rnd() < 0.5 ? 1 : -1;
      y += rnd() < 0.3 ? 1 : 0;
    }
  }
  return { b, top: { x: Math.round(cxp), y: Math.round(d / 2 + 1) } };
}

/** 这一镜推近一档：整幅画按 2 倍画（一个画面像素是别的镜头的两个），人物、棒子看得清楚。 */
const Z = 2;

export function shotWukongRift(k: ShotKit): Shot {
  // 画在一块缩小一半的「近景」画布上（W / Z × H / Z），整体放大 Z 倍；安全框也按一半算（240×135，居中）
  const W = Math.ceil(k.W / Z);
  const H = Math.ceil(k.H / Z);
  const fy = Math.round((H - 135) / 2);
  const cx = Math.round(W / 2);
  const root = new Container();
  const scene = new Container(); // 插地、落地时整体一震
  scene.scale.set(Z);
  root.addChild(scene);
  const horizon = fy + 74;
  k.sprite(k.tex(sky(W, H, horizon, [[0, 'g'], [0.15, 'h'], [0.42, 'i'], [0.7, 'j'], [0.93, 'w']])), 0, 0, scene);
  const far = k.tiling(k.tex(makeCloudBank(320, 40, 171, CLOUD_FAR)), W, scene);
  const mid = k.tiling(k.tex(makeCloudBank(320, 100, 172, CLOUD_MID)), W, scene);
  // 天上的裂缝：一块每帧重画的像素图
  const LEN = 30;
  const path = crackPath(LEN, k.rnd);
  const CW = 24;
  const crackX = cx + 22; // 缝顶
  const crackY = fy + 6;
  const crackC = k.canvas(CW, LEN + 2, scene);
  crackC.sprite.position.set(crackX - (CW >> 1), crackY);
  const flecks = new Motes(scene, false, k.rnd);
  // 云海里冒出来的一座石峰（近景）：棒子插在峰顶，猴子落在旁边
  const peak = makePeak(104, 16, 30, 175);
  const staffX = cx + 4;
  const groundY = fy + 104; // 站的那一行（峰顶正中）
  k.sprite(k.tex(peak.b), staffX + 8 - peak.top.x, groundY - peak.top.y, scene);
  // 地上的细缝（插地的那一下崩开）
  const cracksC = k.canvas(48, 16, scene);
  cracksC.sprite.position.set(staffX - 24, groundY - 8);
  const nearTop = groundY + 20;
  const nearH = Math.max(50, H - nearTop + 10);
  // 金箍棒：落下时略斜、越落越正（几档转好的），插进台里
  const staff = staffUp(33);
  const staffT: Texture[] = [0.55, 0.4, 0.26, 0.13, 0].map((a) => k.grid(lined(rotSprite(staff, a, 1, 16.5).g, 'k', STAFF_SEL)));
  const staffS = new Sprite(staffT[0]);
  staffS.anchor.set(0.5, 1);
  staffS.visible = false;
  scene.addChild(staffS);
  // 猴子：翻跟头（八个角度）、落地、站着、挠头
  const F = makeWukongFrames();
  const idleT = F.idleBare.map((g) => k.grid(g));
  const spinT = Array.from({ length: 8 }, (_, i) => k.grid(rotSprite(F.idleBare[0], (i / 8) * Math.PI * 2, WUKONG_ANCHOR.x, WUKONG_ANCHOR.y - 16).g));
  const crouchT = k.grid(F.windup[0]);
  const scratchT = makeWukongScratch().map((g) => k.grid(g));
  const monkey = new Sprite(idleT[0]);
  monkey.anchor.set(WUKONG_ANCHOR.x / WUKONG_W, WUKONG_ANCHOR.y / WUKONG_H);
  monkey.visible = false;
  scene.addChild(monkey);
  const dust = new Motes(scene, false, k.rnd);
  const near = k.tiling(k.tex(makeCloudBank(320, nearH, 174, cloudNear(nearH))), W, scene);
  const landX = staffX + 17;
  let shakeT = 0;
  let planted = false;
  let landed = false;
  let fleckCd = 0;
  k.cue(T_TEAR, 'jinbian.crack', 0.45);
  k.cue(T_STAFF, 'zhanxian.fly', 0.4);
  k.cue(T_PLANT, 'fantian.land', 0.55);
  k.cue(T_OUT + 0.05, 'pet.fly', 0.45);
  k.cue(T_LAND, 'dinghai.land', 0.3);
  k.cue(T_CLOSE + 0.3, 'qiankun.hover', 0.25);

  /** 画裂缝：open 0..1（0 是一道细细的金线，1 是撕开的口子），a 浓淡。 */
  const drawCrack = (open: number, a: number) => {
    crackC.clear();
    const b = crackC.b;
    if (a <= 0.01) {
      crackC.upload();
      return;
    }
    const A = Math.round(255 * Math.min(1, a));
    for (let y = 0; y <= LEN; y++) {
      const u = y / LEN;
      const xc = (CW >> 1) + path[y] - 2;
      const prof = Math.sin(Math.PI * u) ** 0.7;
      const half = open * 3.6 * prof; // 口子的半宽
      if (half < 0.6) {
        // 合着的时候：一道一像素的金线，两头更淡
        if (prof > 0.15) put(b, xc, y, prof > 0.5 ? 'Y' : 'y', Math.round(A * (0.55 + 0.45 * prof)));
        continue;
      }
      const h = Math.round(half);
      for (let x = -h - 1; x <= h + 1; x++) {
        const d = Math.abs(x) / (h + 1);
        const ch = d < 0.35 ? 'W' : d < 0.6 ? 'f' : d < 0.85 ? 'Y' : 'y';
        put(b, xc + x, y, Math.abs(x) === h + 1 ? 'b' : ch, Math.abs(x) === h + 1 ? Math.round(A * 0.6) : A);
      }
    }
    crackC.upload();
  };

  /** 地上的细缝：从棒子脚下往两边崩开（open 0..1）。 */
  const drawGroundCracks = (open: number, a: number) => {
    cracksC.clear();
    const b = cracksC.b;
    if (a > 0.01) {
      const A = Math.round(255 * a);
      const rays: [number, number][] = [
        [-1, 0.1],
        [1, -0.05],
        [-0.8, 0.35],
        [0.9, 0.3],
        [-0.4, 0.5],
      ];
      for (const [dx, dy] of rays) {
        const L = 18 * open * (0.6 + 0.4 * Math.abs(dx));
        for (let s = 0; s < L; s++) {
          const x = Math.round(24 + dx * s + Math.sin(s * 1.7) * 0.6);
          const y = Math.round(8 + dy * s * 0.6);
          put(b, x, y, s < 4 ? 'g' : 'h', A);
        }
      }
    }
    cracksC.upload();
  };

  return {
    root,
    minT: T_GONE,
    update(dt, t) {
      far.y = horizon - 6;
      mid.y = horizon + 8;
      near.y = nearTop;
      far.tilePosition.x = -Math.floor(t * 1.1);
      mid.tilePosition.x = -Math.floor(t * 2.4);
      near.tilePosition.x = -Math.floor(t * 4.6);
      // 裂缝：先颤一颤（一像素的金线亮暗几下），再撕开；最后慢慢合上、淡掉
      let open = 0;
      let ca = 0.85;
      if (t < T_TEAR) {
        ca = 0.7 + 0.15 * Math.sin(t * 17);
      } else if (t < T_CLOSE) open = easeOut((t - T_TEAR) / (T_OPEN - T_TEAR)) * (1 - 0.08 * Math.sin(t * 3));
      else {
        const u = (t - T_CLOSE) / (T_GONE - T_CLOSE);
        open = 1 - ease(u * 1.4);
        ca = 0.85 * (1 - ease((u - 0.55) / 0.45));
      }
      drawCrack(Math.max(0, open), ca);
      // 金屑：撕开的时候往下掉一阵，平时偶尔一两粒
      fleckCd -= dt;
      if (fleckCd <= 0) {
        const burst = t > T_TEAR && t < T_CLOSE;
        fleckCd = burst ? 0.08 : 0.5;
        if (burst || k.rnd() < 0.4) {
          const yy = crackY + 6 + k.rnd() * (LEN - 12);
          flecks.emit(crackX + path[Math.round(yy - crackY)] - 2 + (k.rnd() - 0.5) * 4 * open, yy, (k.rnd() - 0.5) * 6, 6 + k.rnd() * 6, 2.5 + k.rnd() * 1.5, k.rnd() < 0.5 ? 'Y' : 'f', 2.5);
        }
      }
      flecks.update(dt);
      // 金箍棒：从缝里出来，越落越快，插在台上（插进去的那一截被台面挡住：精灵的下沿压在台面下 3 像素），插住了还在颤
      if (t >= T_STAFF) {
        staffS.visible = true;
        const u = Math.min(1, (t - T_STAFF) / (T_PLANT - T_STAFF));
        const x0 = crackX + path[LEN >> 1];
        const y0 = crackY + (LEN >> 1);
        const x = x0 + (staffX - x0) * u;
        const y = y0 + (groundY + 3 - y0) * u * u;
        staffS.texture = staffT[Math.min(staffT.length - 1, Math.floor(u * staffT.length))];
        let wob = 0;
        if (u >= 1) {
          const since = t - T_PLANT;
          wob = since < 0.45 ? Math.round(Math.sin(since * 60) * (1 - since / 0.45)) : 0;
        }
        staffS.position.set(Math.round(x) + wob, Math.round(y));
        staffS.alpha = Math.min(1, (t - T_STAFF) / 0.12);
        if (u >= 1 && !planted) {
          planted = true;
          shakeT = 0.28;
          for (let i = 0; i < 14; i++) dust.emit(staffX + (k.rnd() - 0.5) * 10, groundY - 1, (k.rnd() - 0.5) * 40, -6 - k.rnd() * 10, 0.7 + k.rnd() * 0.6, k.rnd() < 0.5 ? 'j' : 'i', 1);
        }
      }
      drawGroundCracks(planted ? easeOut((t - T_PLANT) / 0.2) : 0, planted ? 1 - ease((t - T_PLANT - 3.5) / 1.5) : 0);
      // 猴子：从缝里翻出来、翻两个跟头落在棒子旁边，蹲一下站起来，东张西望，挠头
      if (t >= T_OUT) {
        monkey.visible = true;
        const u = Math.min(1, (t - T_OUT) / (T_LAND - T_OUT));
        const x0 = crackX + path[LEN - 6];
        const y0 = crackY + LEN - 4;
        const x = x0 + (landX - x0) * easeOut(u);
        const y = y0 + (groundY - y0) * u * u - Math.sin(Math.PI * u) * 10; // 先往上一蹿再落下
        monkey.position.set(Math.round(x), Math.round(y));
        if (u < 1) {
          monkey.texture = spinT[Math.floor(u * 16) % 8]; // 翻两个跟头
          monkey.scale.x = 1;
        } else {
          if (!landed) {
            landed = true;
            shakeT = Math.max(shakeT, 0.12);
            for (let i = 0; i < 10; i++) dust.emit(landX + (k.rnd() - 0.5) * 12, groundY, (k.rnd() - 0.5) * 30, -4 - k.rnd() * 6, 0.6 + k.rnd() * 0.5, k.rnd() < 0.5 ? 'j' : 'i', 1);
          }
          const since = t - T_LAND;
          if (since < 0.32) {
            monkey.texture = crouchT; // 蹲一下
            monkey.scale.x = -1;
          } else if (since < 1.05) {
            // 东张西望：朝棒子看一眼、回头看身后、再看回来
            monkey.texture = idleT[Math.floor(t * 5) % idleT.length];
            monkey.scale.x = since < 0.55 ? -1 : since < 0.8 ? 1 : -1;
          } else if (since < 2.5) {
            monkey.texture = scratchT[Math.floor(t * 6) % 2]; // 挠头
            monkey.scale.x = -1;
          } else {
            monkey.texture = idleT[Math.floor(t * 5) % idleT.length];
            monkey.scale.x = -1;
          }
        }
      }
      dust.update(dt);
      // 一震：整体上下抖一两个像素，很快停住
      if (shakeT > 0) {
        shakeT -= dt;
        scene.y = shakeT > 0 ? (Math.floor(t * 40) % 2 ? Z : -Z) : 0;
      }
    },
  };
}
