// 量法宝画出来多大（用户 2026-11-10：法宝、特效都不能画得过大，参照哪吒约 16×24 像素）。
// 在法宝特效实验页（?fxlab&manual&auto=0）里把地面、道具、光照、人物、敌人都藏起来、换成一块灰底，只留法宝的画面，
// 一帧一帧和灰底逐像素比，把整段出手里亮过的像素合在一起（世界坐标，镜头抖动已扣掉），取包围盒、量离哪吒脚下最远多远。
// 用法（开发服务器开着）：node tools/fx-size.mjs [--port 5232] [--out scratch/size] [--secs 秒] [--tag before] [法宝[:品阶,品阶] ...]
//   不给法宝就量原来的 8 件 × 5 个品阶（4、5 是神品的两个器灵）。每件每个品阶输出一行 JSON：
//   box = 亮过的像素（和灰底差 ≥ 24）相对哪吒脚下的范围 {l 左, r 右, u 上, d 下}，faint = 差 ≥ 8 的（几乎看不见的也算），
//   far = 离脚下最远的亮像素多远，farChest = 离胸口（脚下往上 6）最远多远；
//   另存 <out>/<法宝>-<品阶>[-tag].png：亮过的像素按亮过几帧着色，叠上哪吒（深色）和 REACH 的两圈（索敌 130、效果最远 145），
//   以及这件法宝在模拟里的判定范围（绿线，数值照 src/sim 抄）。
//   后加的 8 件跑模拟：判定范围直接从模拟里取（每帧的 world.zones、knives 里的火鸟，加上出手的 slash / lash / chain 事件），
//   画成淡绿的一片；beyond = 亮过的像素离判定范围（和人物胸口 20 像素以内，手里的法宝算在这里）最远多远，
//   out = 离判定范围 3 像素以外的亮像素有多少个。竖着往上的东西（落下的鞭子、风柱）本来就在地面的判定之上，看 u（上沿）和图。
//   敌人头顶的五行印记（各件通用的小标记，不是法宝的画面）不算进来。
//   --cover：另外量法宝的画面盖住人物多少 —— 留着哪吒（定在同一帧），逐帧和只有哪吒的那一帧比，
//   cover = 哪吒轮廓里被改了色的像素最多占几成，coverSecs = 盖住一成半以上的帧加起来有几秒。
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const port = opt('port', '5232');
const out = opt('out', 'scratch/size');
const secsOpt = Number(opt('secs', '0'));
const tag = opt('tag', '');
const cover = args.includes('--cover');
if (cover) args.splice(args.indexOf('--cover'), 1);
const OLD = ['huojian', 'qiankun', 'jiulong', 'leigong', 'fantian', 'xinghuang', 'zhanxian', 'hanbing'];
const jobs = (args.length ? args : OLD).flatMap((a) => {
  const [k, ts] = a.split(':');
  return (ts ? ts.split(',').map(Number) : [1, 2, 3, 4, 5]).map((t) => [k, t]);
});
/** 实验页里每件多久放一次（fx-lab.ts 的 EVERY），量一整轮再加上收尾。 */
const EVERY = { huojian: 1.5, qiankun: 2.0, jiulong: 2.3, leigong: 1.9, fantian: 2.2, xinghuang: 4.2, zhanxian: 2.6, hanbing: 2.4, dashen: 2.0, huaxue: 1.6, dingfeng: 3.4, qinglian: 6.6, yinyang: 1.8, xuanyuan: 5.2, wuhuo: 2.2, kunxian: 3.0, xiangmo: 2.6, wuguang: 1.6, zanxin: 1.8, jinjiao: 5.4, yanguang: 7.2, wanya: 4.4, sihai: 2.8, wulu: 2.8, miaoshu: 2.4, wenhuang: 3.8, luobao: 3.2 };
const HX = 452;
const HY = 296;
/** 器灵（fx-lab 按 catalog 的 spirits 顺序取：4 是第一个、5 是第二个）。 */
const SPIRIT = { qiankun: ['split', 'flame'], huojian: ['storm', 'pierce'], jiulong: ['nine', 'wide'], leigong: ['twin', 'storm'], fantian: ['triple', 'quake'], xinghuang: ['lotus', 'burst'], zhanxian: ['many', 'behead'], hanbing: ['field', 'shatter'] };

/** 模拟里的判定范围（画绿线用；数值照 src/sim/weapons.ts 的 TUNE、core.ts 的 XINGHUANG 抄，实验页敌人的位置照 fx-lab.ts 的 SPOTS）。 */
function refs(kind, tier) {
  const t = Math.min(4, tier);
  const sp = tier >= 4 ? SPIRIT[kind]?.[tier - 4] : null;
  const c = [];
  if (kind === 'jiulong') {
    const r = [0, 104, 108, 108, 108][t] * (sp === 'wide' ? 1.05 : 1);
    c.push({ x: HX, y: HY - 6, r });
    if (sp === 'nine') c.push({ x: HX, y: HY - 6, r: Math.min(139, r * 1.34) });
  } else if (kind === 'fantian') {
    const r = [0, 22, 27, 31, 31][t];
    const spots = sp === 'triple' ? [[74, 6], [110, -30], [116, 48]] : [[92, -10]];
    spots.forEach(([dx, dy], i) => {
      const rr = i ? r * 0.8 : r;
      c.push({ x: HX + dx, y: HY + dy, r: rr });
      if (t >= 3) c.push({ x: HX + dx, y: HY + dy, r: rr * 1.25 });
      if (sp === 'quake') c.push({ x: HX + dx, y: HY + dy, r: rr * 1.7 });
    });
  } else if (kind === 'xinghuang') {
    c.push({ x: HX, y: HY, r: [0, 46, 60, 64, 64][t] });
    if (t >= 3) c.push({ x: HX, y: HY, r: 40 });
  } else if (kind === 'huojian') {
    const len = (t >= 2 ? 114 : 108) * (sp === 'pierce' ? 1.08 : 1);
    c.push({ x: HX + 4, y: HY - 10, r: len + 11 });
  } else if (kind === 'qiankun') {
    c.push({ x: HX + 6, y: HY - 10, r: 130 });
    if (sp === 'flame') c.push({ x: HX + 6, y: HY - 10, r: 62, note: 'flameR' });
  }
  return c;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = [];
for (const [kind, tier] of jobs) {
  // 每件每个品阶开一个新页面：上一件留下的粒子、旗子之类的不会混进来
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}/?fxlab&manual&auto=0&w=${kind}&t=${tier}`);
  await page.waitForFunction(() => window.__fxlab !== undefined && window.__fxlabStage !== undefined, null, { timeout: 60000 });
  const secs = secsOpt || (EVERY[kind] ?? 2.5) + 2.5;
  const res = await page.evaluate(
    ([kind, tier, secs, HX, HY, refs, cover]) => {
      const L = window.__fxlab;
      const S = window.__fxlabStage;
      const app = S.app;
      const rt = app.stage.children[0].texture; // 场景先 1:1 画进的 480×270 贴图（render/stage.ts）
      S.update = () => {}; // 场景自己的动画（灵光、花瓣、魔气火星）不算
      // 后加的 8 件：出手的事件（化血的斩、打神鞭落下、风雷）先记下来，量判定范围用（量哪吒轮廓那一帧就可能已经出手了）
      const seen = [];
      const orig = window.__afx ? window.__afx.onEvent.bind(window.__afx) : null;
      if (window.__afx)
        window.__afx.onEvent = (e, w) => {
          seen.push(e);
          return orig(e, w);
        };
      L.pick(kind, tier);
      // 藏起场景：地面那几层、光照图、屏幕上的字；floor / entities / fx / glow 里已有的精灵（道具、人物、敌人、影子）。
      // 法宝的画面是之后才建的精灵，或者 WeaponFx 自己的容器（Container）里的东西，留着
      const keep = new Set([S.floor, S.entities, S.fx]);
      for (const c of S.world.children) if (!keep.has(c)) c.visible = false;
      for (const c of S.scene.children) if (c !== S.world && c !== S.glow) c.visible = false;
      const leaves = [];
      for (const layer of [S.floor, S.entities, S.fx, S.glow]) for (const c of layer.children) if ('texture' in c) leaves.push(c);
      const hero = S.entities.children.find((c) => 'texture' in c && c.x === HX && c.y === HY);
      // 灰底（暗描边、亮光、叠加发光都看得出来）
      const Spr = hero.constructor;
      const bd = new Spr(S.tex.dot);
      bd.tint = 0x7a7a7a;
      bd.position.set(-2000, -2000);
      bd.scale.set(6000, 6000);
      S.world.addChildAt(bd, 0);
      const BG = [0x7a, 0x7a, 0x7a];
      const W = 480;
      const H = 270;
      const grab = () => {
        const px = app.renderer.extract.pixels(rt).pixels;
        return px;
      };
      const diff = (px, i) => Math.max(Math.abs(px[i] - BG[0]), Math.abs(px[i + 1] - BG[1]), Math.abs(px[i + 2] - BG[2]));
      // 哪吒的轮廓（比例尺）：只留哪吒画一帧
      for (const c of leaves) c.visible = c === hero;
      L.advance(1 / 60, 1);
      const heroMask = [];
      {
        const px = grab();
        const ox = S.world.position.x;
        const oy = S.world.position.y;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (diff(px, (y * W + x) * 4) >= 24) heroMask.push([x - ox, y - oy]);
      }
      for (const c of leaves) c.visible = cover && c === hero;
      const heroTex = hero.texture;
      const heroSx = hero.scale.x; // 出手时人物会转身朝向目标（scale.x 翻面），量盖住人物时定回原来的朝向
      // 量盖住人物：只有哪吒的那一帧（之后每帧把哪吒定回这一帧的样子再比）
      let heroRef = null;
      let refOx = 0;
      let refOy = 0;
      if (cover) {
        app.renderer.render(app.stage);
        heroRef = grab().slice();
        refOx = Math.round(S.world.position.x);
        refOy = Math.round(S.world.position.y);
      }
      // 逐帧量
      const WW = 960;
      const WH = 540;
      const hit = new Uint16Array(WW * WH);
      const faint = new Uint8Array(WW * WH);
      // 判定范围（世界坐标 = 模拟坐标）：原来 8 件用上面抄的 refs，后加的 8 件每帧从模拟里取
      const foot = new Uint8Array(WW * WH);
      const put = (x, y) => {
        if (x >= 0 && y >= 0 && x < WW && y < WH) foot[y * WW + x] = 1;
      };
      const box2 = (x0, y0, x1, y1, f) => {
        for (let y = Math.floor(Math.min(y0, y1)); y <= Math.ceil(Math.max(y0, y1)); y++) for (let x = Math.floor(Math.min(x0, x1)); x <= Math.ceil(Math.max(x0, x1)); x++) if (f(x, y)) put(x, y);
      };
      const disc = (cx, cy, r) => r > 0 && box2(cx - r, cy - r, cx + r, cy + r, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
      const segD = (px, py, x0, y0, x1, y1) => {
        const vx = x1 - x0;
        const vy = y1 - y0;
        const k = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1e-9)));
        return Math.hypot(px - x0 - vx * k, py - y0 - vy * k);
      };
      const capsule = (x0, y0, x1, y1, r) => box2(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r, (x, y) => segD(x, y, x0, y0, x1, y1) <= r);
      const angD = (a, b) => {
        let d = (a - b) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return d;
      };
      const sector = (cx, cy, a, arc, r) => box2(cx - r, cy - r, cx + r, cy + r, (x, y) => Math.hypot(x - cx, y - cy) <= r && (Math.hypot(x - cx, y - cy) < 1 || Math.abs(angD(Math.atan2(y - cy, x - cx), a)) <= arc));
      for (const c of refs) disc(c.x, c.y, c.r);
      const footWorld = () => {
        const W = L.world;
        for (const z of W.zones) {
          if (z.kind === 'flameWave') sector(z.x, z.y, z.a ?? 0, z.arc ?? 0, z.r);
          else if (z.kind === 'scorch') capsule(z.x, z.y, z.x2, z.y2, z.r);
          else if (z.kind === 'beam') capsule(z.x, z.y, z.x + Math.cos(z.a ?? 0) * (z.len ?? 0), z.y + Math.sin(z.a ?? 0) * (z.len ?? 0), z.r);
          else if (z.kind === 'rope') {
            // 金绳：捆住的那一串（敌人身子一圈，加上相邻两只之间的绳子）
            const held = (z.ids ?? []).map((id) => W.enemies.find((e) => e.id === id)).filter(Boolean);
            held.forEach((e, i) => {
              disc(e.x, e.y - 6, 8);
              if (i) capsule(held[i - 1].x, held[i - 1].y - 6, e.x, e.y - 6, 3);
            });
          } else if (z.kind === 'banner') {
            // 离地焰光旗：旗本身（插在地上的物件，宽 16、高 26）；它管的那一圈不是伤害范围，地火在下面按预警、落地量
            box2(z.x - 2, z.y - 26, z.x + 15, z.y + 1, () => true);
          } else if (z.kind === 'orbit') {
            // 金蛟剪：绕身的那一圈（金蛟咬得到 8 像素），扑出去交剪时剪中的那只身边一圈
            // 圆心在胸口（z.y），半径一伸一缩到 1.35 倍，金蛟咬得到 10 像素
            disc(z.x, z.y, z.r * 1.35 + 10);
            for (const id of z.ids ?? []) {
              const e = W.enemies.find((o) => o.id === id);
              if (e) disc(e.x, e.y - 8, 22);
            }
          } else if (z.kind === 'coin') {
            // 落宝金钱：附着的那只头上（金钱在它头顶、钱声震开 r），飞着的时候金钱本身
            const t = W.enemies.find((e) => e.id === (z.ids ?? [])[0]);
            if (t && !z.nth) {
              disc(t.x, t.y, z.r);
              box2(t.x - 8, t.y - 40, t.x + 8, t.y, () => true);
            } else disc(z.x, z.y - 20, 9);
          } else if (z.kind === 'surge') {
            // 四海瓶：浪头扫过的那一条（涌起的地方到浪头，半宽 r；推着走的敌人在前沿 5 像素、砸下砸得到前面 8 像素）
            const a = z.a ?? 0;
            capsule(z.x2, z.y2, z.x + Math.cos(a) * 9, z.y + Math.sin(a) * 9, z.r + 4);
          } else disc(z.x, z.y, z.r);
        }
        for (const k of W.knives) if (k.kind === 'wuhuo') disc(k.x, k.y, 8); // 火鸟离目标 8 像素就算扑中
        // 再加的 11 件：五光石的石子 / 五色光（模拟里在地面高度、碰到身子就算；画在胸口那么高）
        for (const k of W.knives)
          if (k.kind === 'wuguang') {
            disc(k.x, k.y, 10);
            disc(k.x, k.y - 9, 6);
          }
        // 攒心钉：飞着的金钉（模拟里在胸口高度），和敌人身上钉着的钉子（在那只身上）
        for (const k of W.knives) if (k.kind === 'zanxin') disc(k.x, k.y, 6);
        // 七宝妙树：飞着的宝（模拟里在胸口高度；仙品打中炸开 12 像素）
        for (const k of W.knives) if (k.kind === 'miaoshu') disc(k.x, k.y, k.tier >= 3 ? 14 : 7);
        for (const e of W.enemies) if (e.nails && e.nailT > 0) disc(e.x, e.y - 10, 9);
        // 瘟癀伞：染瘟的敌人身上冒的瘟尘（在那只身上）；伞本身撑在伞下那片的正上方（物件，宽 21、高 14，伞柄末端离地 22）
        for (const e of W.enemies) if (e.plague && e.plagueT > 0) disc(e.x, e.y - 10, 11);
        for (const z of W.zones) if (z.kind === 'umbrella') box2(z.x - 12, z.y - 22 - 14, z.x + 12, z.y - 20, () => true);
      };
      const footEvent = (e) => {
        if (e.t === 'slash') sector(e.x, e.y, e.a, e.arc, e.r);
        else if (e.t === 'lash') {
          const hx = (Math.cos(e.a) * e.len) / 2;
          const hy = (Math.sin(e.a) * e.len) / 2;
          capsule(e.x - hx, e.y - hy, e.x + hx, e.y + hy, 7); // 鞭痕半宽 TUNE.dashen.w
          disc(e.x, e.y, e.ring);
        } else if ((e.t === 'land' || e.t === 'warn') && e.kind === 'geyser') {
          disc(e.x, e.y, e.r + 6); // 离地焰光旗的地火（落点的范围，加上敌人的半个身子）
        } else if (e.t === 'land' && e.kind === 'pestle') {
          disc(e.x, e.y, e.r); // 再加的 11 件：降魔杵每一砸的范围（泰山最后一下的 r 已经放大）
        } else if (e.t === 'chain' && e.pts) {
          // 风雷：第一个点是旋风顶上（天上落下来的那一竖不算判定），之后是挨雷的敌人
          for (let i = 1; i < e.pts.length; i++) {
            disc(e.pts[i][0], e.pts[i][1], 6);
            if (i > 1) capsule(e.pts[i - 1][0], e.pts[i - 1][1], e.pts[i][0], e.pts[i][1], 4);
          }
        }
      };
      const afx = window.__afx;
      if (afx) for (const e of seen) footEvent(e);
      seen.length = 0;
      if (afx) {
        afx.onEvent = (e, w) => {
          footEvent(e);
          return orig(e, w);
        };
      }
      let frames = 0;
      let peak = 0;
      const steps = Math.round(secs * 30);
      // 跑模拟的那几件（后加的 8 件）里敌人会死了重生：新建的敌人精灵和影子也藏起来（按贴图大小、锚点认：小兵 20×24、精英 28×36）
      const isFoe = (c) => {
        const t = c.texture;
        if (!t || !c.anchor) return false;
        const ax = c.anchor.x;
        const ay = c.anchor.y;
        return (t.width === 20 && t.height === 24 && Math.abs(ax - 8 / 20) < 1e-6 && Math.abs(ay - 23 / 24) < 1e-6) || (t.width === 28 && t.height === 36 && Math.abs(ax - 12 / 28) < 1e-6 && Math.abs(ay - 35 / 36) < 1e-6);
      };
      const hideFoes = () => {
        let any = false;
        for (const c of S.entities.children)
          if (c.visible && 'texture' in c && isFoe(c)) {
            c.visible = false;
            any = true;
          }
        for (const c of S.floor.children)
          if (c.visible && 'texture' in c && (c.texture === S.tex.shadow || c.texture === S.tex.smallShadow)) {
            c.visible = false;
            any = true;
          }
        return any;
      };
      // 五行印记（WeaponFx 那一层里锚点在底边中间的 5×5 / 5×6 小精灵）：各件通用的小标记，不算法宝的画面
      const ownLayers = new Set([afx?.layer, afx?.floor, window.__afx2?.layer, window.__afx2?.floor].filter(Boolean));
      const hideMarks = () => {
        let any = false;
        const walk = (node) => {
          for (const c of node.children) {
            if (ownLayers.has(c)) continue;
            if (c.children?.length) walk(c);
            if (!c.visible || !('texture' in c) || !c.anchor || !c.texture) continue;
            if (c.anchor.x === 0.5 && c.anchor.y === 1 && c.texture.width === 5 && (c.texture.height === 6 || c.texture.height === 5)) {
              c.visible = false;
              any = true;
            }
          }
        };
        walk(S.fx);
        return any;
      };
      let coverMax = 0;
      let coverFrames = 0;
      let heroAt = null;
      if (cover) {
        heroAt = new Uint8Array(WW * WH);
        for (const [wx, wy] of heroMask) {
          const x = Math.round(wx);
          const y = Math.round(wy);
          if (x >= 0 && y >= 0 && x < WW && y < WH) heroAt[y * WW + x] = 1;
        }
      }
      for (let s = 0; s < steps; s++) {
        L.advance(1 / 60, 2);
        footWorld();
        let again = hideFoes();
        again = hideMarks() || again;
        if (cover) {
          hero.texture = heroTex;
          hero.scale.x = heroSx;
          hero.tint = 0xffffff;
          hero.alpha = 1;
          hero.visible = true;
          again = true;
        }
        if (again) app.renderer.render(app.stage);
        if (cover) {
          const px = grab();
          let n = 0;
          let c = 0;
          const ox = Math.round(S.world.position.x);
          const oy = Math.round(S.world.position.y);
          for (const [wx, wy] of heroMask) {
            // 镜头会抖：这一帧哪吒在画面上的位置按这一帧的偏移算，参考帧按参考帧的偏移算
            const x = Math.round(wx) + ox;
            const y = Math.round(wy) + oy;
            const rx = Math.round(wx) + refOx;
            const ry = Math.round(wy) + refOy;
            if (x < 0 || y < 0 || x >= W || y >= H || rx < 0 || ry < 0 || rx >= W || ry >= H) continue;
            const i = (y * W + x) * 4;
            const j = (ry * W + rx) * 4;
            n++;
            if (Math.max(Math.abs(px[i] - heroRef[j]), Math.abs(px[i + 1] - heroRef[j + 1]), Math.abs(px[i + 2] - heroRef[j + 2])) >= 24) c++;
          }
          const f = n ? c / n : 0;
          coverMax = Math.max(coverMax, f);
          if (f >= 0.15) coverFrames++;
        }
        frames++;
        const px = grab();
        const ox = Math.round(S.world.position.x);
        const oy = Math.round(S.world.position.y);
        let n = 0;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const d = diff(px, (y * W + x) * 4);
            if (d < 8) continue;
            const wx = x - ox;
            const wy = y - oy;
            if (wx < 0 || wy < 0 || wx >= WW || wy >= WH) continue;
            if (heroAt && heroAt[wy * WW + wx]) continue; // --cover：哪吒自己的像素不算
            faint[wy * WW + wx] = 1;
            if (d >= 24) {
              hit[wy * WW + wx]++;
              n++;
            }
          }
        peak = Math.max(peak, n);
      }
      // 汇总
      const box = { l: 0, r: 0, u: 0, d: 0 };
      const fbox = { l: 0, r: 0, u: 0, d: 0 };
      let far = 0;
      let farChest = 0;
      let any = false;
      let fany = false;
      for (let y = 0; y < WH; y++)
        for (let x = 0; x < WW; x++) {
          const i = y * WW + x;
          if (faint[i]) {
            const dx = x - HX;
            const dy = y - HY;
            if (!fany) {
              fany = true;
              fbox.l = fbox.r = dx;
              fbox.u = fbox.d = dy;
            }
            fbox.l = Math.min(fbox.l, dx);
            fbox.r = Math.max(fbox.r, dx);
            fbox.u = Math.min(fbox.u, dy);
            fbox.d = Math.max(fbox.d, dy);
          }
          if (!hit[i]) continue;
          const dx = x - HX;
          const dy = y - HY;
          if (!any) {
            any = true;
            box.l = box.r = dx;
            box.u = box.d = dy;
          }
          box.l = Math.min(box.l, dx);
          box.r = Math.max(box.r, dx);
          box.u = Math.min(box.u, dy);
          box.d = Math.max(box.d, dy);
          far = Math.max(far, Math.hypot(dx, dy));
          farChest = Math.max(farChest, Math.hypot(dx, dy + 6));
        }
      // 亮过的像素离判定范围多远（判定范围 + 人物胸口 20 像素以内算 0；两遍倒角距离，近似欧氏距离）
      let beyond = -1;
      let outN = 0;
      let anyFoot = false;
      for (let i = 0; i < foot.length && !anyFoot; i++) anyFoot = foot[i] === 1;
      if (anyFoot) {
        const D = new Float32Array(WW * WH);
        for (let y = 0; y < WH; y++)
          for (let x = 0; x < WW; x++) {
            const i = y * WW + x;
            D[i] = foot[i] || Math.hypot(x - HX, y - (HY - 10)) <= 20 ? 0 : 1e9;
          }
        const R2 = Math.SQRT2;
        for (let y = 0; y < WH; y++)
          for (let x = 0; x < WW; x++) {
            const i = y * WW + x;
            let v = D[i];
            if (v === 0) continue;
            if (x > 0) v = Math.min(v, D[i - 1] + 1);
            if (y > 0) {
              v = Math.min(v, D[i - WW] + 1);
              if (x > 0) v = Math.min(v, D[i - WW - 1] + R2);
              if (x < WW - 1) v = Math.min(v, D[i - WW + 1] + R2);
            }
            D[i] = v;
          }
        for (let y = WH - 1; y >= 0; y--)
          for (let x = WW - 1; x >= 0; x--) {
            const i = y * WW + x;
            let v = D[i];
            if (v === 0) continue;
            if (x < WW - 1) v = Math.min(v, D[i + 1] + 1);
            if (y < WH - 1) {
              v = Math.min(v, D[i + WW] + 1);
              if (x < WW - 1) v = Math.min(v, D[i + WW + 1] + R2);
              if (x > 0) v = Math.min(v, D[i + WW - 1] + R2);
            }
            D[i] = v;
          }
        beyond = 0;
        for (let i = 0; i < hit.length; i++)
          if (hit[i]) {
            beyond = Math.max(beyond, D[i]);
            if (D[i] > 3) outN++;
          }
      }
      // 图：取 [HX-210, HX+250] × [HY-175, HY+105]（和游戏里镜头看得到的差不多大），放大 2 倍
      const CX = HX - 210;
      const CY = HY - 175;
      const CW = 460;
      const CH = 280;
      const SC = 2;
      const cv = document.createElement('canvas');
      cv.width = CW * SC;
      cv.height = CH * SC;
      const g = cv.getContext('2d');
      g.fillStyle = '#d8d2c4';
      g.fillRect(0, 0, cv.width, cv.height);
      if (refs.length === 0) {
        g.fillStyle = 'rgba(40,150,70,0.22)';
        for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (foot[(y + CY) * WW + (x + CX)]) g.fillRect(x * SC, y * SC, SC, SC);
      }
      let maxHit = 1;
      for (let i = 0; i < hit.length; i++) maxHit = Math.max(maxHit, hit[i]);
      for (let y = 0; y < CH; y++)
        for (let x = 0; x < CW; x++) {
          const i = (y + CY) * WW + (x + CX);
          if (hit[i]) {
            const k = Math.min(1, 0.25 + (0.75 * Math.log(1 + hit[i])) / Math.log(1 + maxHit));
            g.fillStyle = `rgba(200,60,30,${k.toFixed(3)})`;
            g.fillRect(x * SC, y * SC, SC, SC);
          } else if (faint[i]) {
            g.fillStyle = 'rgba(230,150,90,0.35)';
            g.fillRect(x * SC, y * SC, SC, SC);
          }
        }
      g.fillStyle = 'rgba(30,40,90,0.9)';
      for (const [x, y] of heroMask) g.fillRect((x - CX) * SC, (y - CY) * SC, SC, SC);
      const circle = (x, y, r, col, dash) => {
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.setLineDash(dash ?? []);
        g.beginPath();
        g.arc((x - CX + 0.5) * SC, (y - CY + 0.5) * SC, r * SC, 0, Math.PI * 2);
        g.stroke();
      };
      circle(HX, HY, 130, 'rgba(60,60,60,0.6)', [4, 4]);
      circle(HX, HY, 145, 'rgba(60,60,60,0.8)');
      for (const c of refs) circle(c.x, c.y, c.r, 'rgba(20,140,60,0.95)');
      if (refs.length === 0) {
        // 后加的 8 件：判定范围的边（亮像素画在下面，边压在上面看得清）
        g.fillStyle = 'rgba(20,140,60,0.95)';
        for (let y = 0; y < CH; y++)
          for (let x = 0; x < CW; x++) {
            const i = (y + CY) * WW + (x + CX);
            if (foot[i] && (!foot[i - 1] || !foot[i + 1] || !foot[i - WW] || !foot[i + WW])) g.fillRect(x * SC, y * SC, SC, SC);
          }
      }
      g.fillStyle = '#222';
      g.font = '14px sans-serif';
      g.fillText(`${kind} ${tier}  box l${-box.l} r${box.r} u${-box.u} d${box.d}  far ${far.toFixed(0)}${beyond >= 0 ? `  beyond ${beyond.toFixed(0)} out ${outN}` : ''}`, 6, 16);
      return { box, faint: fbox, far: Math.round(far), farChest: Math.round(farChest), beyond: Math.round(beyond), out: outN, cover: cover ? Math.round(coverMax * 100) / 100 : undefined, coverSecs: cover ? Math.round(((coverFrames * 2) / 60) * 100) / 100 : undefined, peak, frames, png: cv.toDataURL('image/png') };
    },
    [kind, tier, secs, HX, HY, refs(kind, tier), cover],
  );
  const file = `${out}/${kind}-${tier}${tag ? `-${tag}` : ''}.png`;
  await writeFile(file, Buffer.from(res.png.split(',')[1], 'base64'));
  const box = res.box;
  const row = { kind, tier, w: box.r - box.l + 1, h: box.d - box.u + 1, l: -box.l, r: box.r, u: -box.u, d: box.d, far: res.far, farChest: res.farChest, beyond: res.beyond, out: res.out, ...(cover ? { cover: res.cover, coverSecs: res.coverSecs } : {}), faint: { l: -res.faint.l, r: res.faint.r, u: -res.faint.u, d: res.faint.d }, peak: res.peak, file, errs };
  rows.push(row);
  console.log(JSON.stringify(row));
  await page.close();
}
await browser.close();
