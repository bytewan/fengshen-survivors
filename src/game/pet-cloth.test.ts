// 混天绫本体的布（src/art/sprites/pet.ts 的 ClothBody / drawPetCloth）与被缠敌人身上的红绫（drawWrap）：
// 用户口径「任何时候都是一整段、不缩成一个点」「不打结」——不管怎么飞（慢飘、急冲、急转、掉帧、进化换长度），
// 每一节都是定长、弯折不超过上限、没有 NaN；画出来的布总是一整段，不会缩成一团。
// 2026-11-10 用户「太大了」「动起来还是应该头在动 而不是中间在动」「不需要红色流动的这个特效」：
// 布比人物小、布头钉在混天绫的位置上领着飞；平时大多正面朝外，翻面不沿着布一直往尾梢走，转急弯时才被带着翻；
// 被缠的敌人身上的红绫从混天绫掠来的那一侧绕上去。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOTH, ClothBody, drawPetCloth, drawWrap, petWind, Pix, ribbonStyle, ROLL, STAND, wrapLook, type ClothEnv } from '../art/sprites/pet.ts';

const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const env0 = (): ClothEnv => ({ wx: 0, wy: 0, sway: 1, flutter: 0 });

/** 每条布：布头跟着混天绫，每一节都是定长，弯折不超过上限，坐标都是有限数。 */
function checkBody(body: ClothBody, hx: number, hy: number, where: string) {
  for (const T of body.tails) {
    assert.ok(Math.abs(T.x[0] - hx) < 1e-3 && Math.abs(T.y[0] - hy) < 1e-3, `${where}：布头没跟着混天绫`);
    for (let i = 1; i < T.n; i++) {
      assert.ok(Number.isFinite(T.x[i]) && Number.isFinite(T.y[i]) && Number.isFinite(T.vx[i]) && Number.isFinite(T.rl[i]), `${where}：第 ${i} 点不是有限数`);
      const d = Math.hypot(T.x[i] - T.x[i - 1], T.y[i] - T.y[i - 1]);
      assert.ok(Math.abs(d - T.seg) < 1e-3, `${where}：第 ${i} 节长 ${d.toFixed(3)}，应为 ${T.seg.toFixed(3)}`);
      if (i >= 2) {
        const a0 = Math.atan2(T.y[i - 1] - T.y[i - 2], T.x[i - 1] - T.x[i - 2]);
        const a1 = Math.atan2(T.y[i] - T.y[i - 1], T.x[i] - T.x[i - 1]);
        const u = i / (T.n - 1);
        const cap = CLOTH.bendRoot + (CLOTH.bendTip - CLOTH.bendRoot) * u;
        assert.ok(Math.abs(wrap(a1 - a0)) <= cap + 1e-3, `${where}：第 ${i} 节折了 ${wrap(a1 - a0).toFixed(3)}，超过 ${cap.toFixed(3)}`);
      }
    }
  }
}

/** 画出来的像素：有多少、外接框多大。 */
function drawn(pix: Pix) {
  let n = 0;
  for (let i = 0; i < pix.c.length; i++) if (pix.c[i]) n++;
  return { n, w: pix.x1 - pix.x0 + 1, h: pix.y1 - pix.y0 + 1 };
}

test('大小：一条布，未进化约 36–42 × 3–3.5 像素，第 3 阶也不超过 54 × 4.5（人物约 16 × 24）', () => {
  for (const branch of [null, 'bind', 'fire'] as const) {
    const st = ribbonStyle(branch);
    assert.equal(st.len.length, 4);
    assert.ok(st.len[0] >= 36 && st.len[0] <= 42, `${branch ?? 'base'} 未进化长 ${st.len[0]}`);
    assert.ok(st.width[0] >= 3 && st.width[0] <= 3.6, `${branch ?? 'base'} 未进化宽 ${st.width[0]}`);
    assert.ok(st.len[3] <= 54 && st.width[3] <= 4.5, `${branch ?? 'base'} 第 3 阶 ${st.len[3]} × ${st.width[3]}`);
    for (let k = 1; k < 4; k++) assert.ok(st.len[k] >= st.len[k - 1] && st.width[k] >= st.width[k - 1], `${branch ?? 'base'} 进化不应变小`);
  }
});

test('慢飘、急冲、急转、掉帧、原地不动：布头钉在混天绫上，每一节定长、不打死结、没有 NaN', () => {
  for (const branch of [null, 'bind', 'fire'] as const) {
    const st = ribbonStyle(branch);
    const body = new ClothBody([st.len[0]]);
    const env = env0();
    let x = 200;
    let y = 150;
    body.place(x, y, -1, -0.5);
    let t = 0;
    let vx = 0;
    let vy = 0;
    let calm = 0;
    for (let f = 0; f < 1200; f++) {
      // 0–4 秒在身后慢飘；4–8 秒急冲、急转（最快 230 像素 / 秒，每秒转 7 弧度）；中间夹几帧掉帧和停住不动
      const dt = f % 97 === 0 ? 0.1 : f % 89 === 0 ? 0 : 1 / 60;
      t += dt;
      if (t < 4) {
        vx = Math.cos(t * 1.15) * 20;
        vy = Math.sin(t * 2.3) * 12;
      } else {
        const h = t * 7;
        vx = Math.cos(h) * 230;
        vy = Math.sin(h) * 230;
      }
      x += vx * dt;
      y += vy * dt;
      const k = Math.min(1, Math.max(0, (Math.hypot(vx, vy) - 40) / 140));
      calm += (k - calm) * 0.1;
      petWind(-1, vx, vy, calm, t, env);
      body.step(dt, x, y, env);
      if (f % 30 === 0) body.kick(f % 60 ? 1 : -1);
      checkBody(body, x, y, `${branch ?? 'base'} 第 ${f} 帧`);
    }
  }
});

test('进化换长度：重新取点后接着飘，长度对、布头不动', () => {
  const st = ribbonStyle('fire');
  const body = new ClothBody([st.len[0]]);
  const env: ClothEnv = { wx: -25, wy: -5, sway: 1, flutter: 0 };
  body.place(100, 100, -1, 0);
  for (let f = 0; f < 120; f++) body.step(1 / 60, 100, 100, env);
  for (const stage of [1, 2, 3]) {
    body.resize([st.len[stage]]);
    assert.equal(body.tails[0].len, st.len[stage]);
    body.flip(1);
    for (let f = 0; f < 60; f++) body.step(1 / 60, 100, 100, env);
    checkBody(body, 100, 100, `第 ${stage} 阶`);
  }
});

test('画出来总是一整段：慢的时候舒展，快的时候拉直，都不会缩成一团', () => {
  for (const branch of [null, 'bind', 'fire'] as const) {
    for (const stage of [0, 3]) {
      const st = ribbonStyle(branch);
      const L = st.len[stage];
      const body = new ClothBody([L]);
      const env = env0();
      body.place(200, 150, -1, -0.4);
      const pix = new Pix(128, 128);
      let x = 200;
      for (let f = 0; f < 360; f++) {
        const fast = f > 180;
        const vx = fast ? 200 : 0;
        x += (vx * 1) / 60;
        petWind(-1, vx, 0, fast ? 1 : 0, f / 60, env);
        body.step(1 / 60, x, 150, env);
        if (f % 60 !== 59) continue;
        pix.reset(Math.round(x) - 64, 150 - 64);
        drawPetCloth(pix, body, st, { t: f / 60, stage, flutter: env.flutter });
        const d = drawn(pix);
        assert.ok(Math.max(d.w, d.h) >= L * 0.55, `${branch ?? 'base'}${stage} 第 ${f} 帧：只铺开了 ${Math.max(d.w, d.h)} 像素`);
        assert.ok(d.n >= L * 2, `${branch ?? 'base'}${stage} 第 ${f} 帧：只画了 ${d.n} 个像素`);
        // 布头那一头：剪口处的布和布身一样宽（不收成一个尖）
        assert.ok(d.n <= L * 7, `${branch ?? 'base'}${stage} 第 ${f} 帧：画了 ${d.n} 个像素，太占地方`);
      }
    }
  }
});

/** 在身后慢慢飘（不转急弯）n 帧，每帧回调。 */
function drift(body: ClothBody, frames: number, each: (f: number) => void) {
  const env = env0();
  let x = 200;
  let y = 150;
  for (let f = 0; f < frames; f++) {
    const t = f / 60;
    const vx = Math.cos(t * 1.15) * 18;
    const vy = Math.sin(t * 2.3) * 10;
    x += vx / 60;
    y += vy / 60;
    petWind(-1, vx, vy, 0, t, env);
    body.step(1 / 60, x, y, env);
    each(f);
  }
}

test('平时大多正面朝外；翻面处只在原地挪，不沿着布一直往尾梢走', () => {
  const idle = ROLL.idle;
  ROLL.idle = [1e9, 1e9]; // 这一段不让它自己翻那一圈
  try {
    const st = ribbonStyle(null);
    const body = new ClothBody([st.len[0]]);
    body.place(200, 150, -1, -0.5);
    const T = body.tails[0];
    let front = 0;
    let all = 0;
    let lo = 1;
    let hi = 0;
    let headBack = 0;
    drift(body, 60 * 8, (f) => {
      // 从布头往尾梢找第一处翻过去的地方（正面变反面的那一道翻转处）：记下它在布长的哪儿
      let neck = -1;
      for (let s = 0; s <= T.len; s += 0.5) {
        const c = Math.cos(T.twist(s, body.t, 0));
        all++;
        if (c > 0) front++;
        else if (s / T.len < 0.4) headBack++;
        if (neck < 0 && c <= 0) neck = s / T.len;
      }
      if (f > 60 && neck >= 0) {
        lo = Math.min(lo, neck);
        hi = Math.max(hi, neck);
      }
    });
    assert.ok(front / all >= 0.7, `空闲时正面朝外只占 ${((front / all) * 100).toFixed(0)}%`);
    assert.equal(headBack, 0, '布头那一截（前四成）在空闲时翻到了反面');
    // 尾梢翻过去的时候，翻转处从尾尖往里走到 STAND.at 附近停住，翻回来时再退回尾尖；
    // 不会越过 STAND.at 往布头走，也不会一路走到尾梢、再从布头冒出下一个（那是传送带）
    const reach = STAND.wander + STAND.w / 2 + 0.05;
    assert.ok(lo >= STAND.at - reach, `翻面处跑到了布长的 ${lo.toFixed(2)}，应在 ${STAND.at - reach} 以后`);
    assert.ok(hi > lo, '尾梢一直没翻过');
  } finally {
    ROLL.idle = idle;
  }
});

test('转急弯时布头被带着翻过去，之后回到正面朝外；空闲时隔几秒自己慢慢翻一圈', () => {
  const st = ribbonStyle(null);
  const body = new ClothBody([st.len[0]]);
  const env = env0();
  body.place(200, 150, -1, 0);
  let x = 200;
  let y = 150;
  let a = 0;
  let most = 0;
  // 205 像素 / 秒穿过去、每秒转 7 弧度兜回来（掠过敌群的那一趟）
  for (let f = 0; f < 50; f++) {
    a += f > 12 ? 7 / 60 : 0;
    x += (Math.cos(a) * 205) / 60;
    y += (Math.sin(a) * 205) / 60;
    petWind(-1, Math.cos(a) * 205, Math.sin(a) * 205, 1, f / 60, env);
    body.step(1 / 60, x, y, env);
    most = Math.max(most, Math.abs(wrap(body.roll)));
  }
  assert.ok(most > Math.PI / 2, `急转弯时布头只翻了 ${most.toFixed(2)} 弧度`);
  // 停下来慢飘两秒：回到正面
  for (let f = 0; f < 120; f++) {
    petWind(-1, 0, 0, 0, f / 60, env);
    body.step(1 / 60, x, y, env);
  }
  assert.ok(Math.abs(wrap(body.roll)) < 0.05, `急转弯以后没翻回正面：${wrap(body.roll).toFixed(2)}`);
  // 慢慢飘的时候不被带着翻；但过几秒会自己慢慢翻一圈
  const quiet = new ClothBody([st.len[0]]);
  quiet.place(200, 150, -1, -0.5);
  let moved = 0;
  drift(quiet, 60 * 12, () => (moved = Math.max(moved, Math.abs(quiet.roll))));
  assert.ok(moved > Math.PI, '空闲十几秒都没有自己翻过一圈');
});

test('被缠的敌人：红绫从混天绫掠来的那一侧绕上去，绕完是整整一圈', () => {
  const look = wrapLook('soldier');
  const st = ribbonStyle(null);
  const front = new Pix(48, 44);
  const back = new Pix(48, 44);
  const pose = { x: 24, y: 34, flip: 1 as const, t: 0, reveal: 0, from: -1, tight: 2, loose: 0, strain: 0, tailX: -1, tailY: 0, impact: 0, seed: 1 };
  /** front 层上画在中线左右两边的像素数。 */
  const sides = (reveal: number, from: number) => {
    front.reset(0, 0);
    back.reset(0, 0);
    drawWrap(front, back, look, { ...pose, reveal, from }, st);
    const ax = pose.x + look.cx * pose.flip;
    let l = 0;
    let r = 0;
    for (let y = 0; y < front.h; y++)
      for (let x = 0; x < front.w; x++) if (front.c[y * front.w + x]) (x < ax ? l++ : x > ax ? r++ : 0);
    return { l, r };
  };
  const early = sides(0.25, -1);
  assert.ok(early.l > 0 && early.l > early.r * 2, `从左边来：刚开始绕时应该大多在左边（左 ${early.l}、右 ${early.r}）`);
  const mirror = sides(0.25, 1);
  assert.ok(mirror.r > 0 && mirror.r > mirror.l * 2, `从右边来：刚开始绕时应该大多在右边（左 ${mirror.l}、右 ${mirror.r}）`);
  const none = sides(0, -1);
  assert.equal(none.l + none.r, 0, '还没开始绕就画出来了');
  const done = sides(1, -1);
  assert.ok(done.l > 4 && done.r > 4, `绕完应该两边都有（左 ${done.l}、右 ${done.r}）`);
});
