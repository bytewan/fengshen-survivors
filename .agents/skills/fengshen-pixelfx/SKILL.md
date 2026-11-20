---
name: fengshen-pixelfx
description: 在《封神幸存者：回响》里做或改像素特效（法宝、功法、命中、拾取、状态、首领招式、转场……）时先看这份，再配合通用的 pixelfx skill 用。它规定这个游戏对特效的要求（只用传统色调色板、辉光压低、不要光圈、修仙题材、节奏不要快），说明仓库里 pixelfx 副本的位置、在 TypeScript 里怎么播（src/render/pixelfx.ts）、怎么把现成特效改造成修仙版。觉得某个特效不够精致、一闪而过、不够修仙时也用它。
---

# 这个游戏里的 pixelfx

通用的做法（怎么找现成的、起稿、渲染、看、改，画笔 API，质量清单）在官方的 **pixelfx skill** 里
（`.agents/skills/pixelfx/SKILL.md`，用 `npx skills add patch-gg/pixelfx --skill pixelfx` 装的原版，不要改它）。
这份只讲这个游戏特有的东西；两边说法不一样时以这份为准。评估和接入的来龙去脉见 `docs/pixelfx.md`。

## 和官方 skill 不一样的地方

| 官方 skill 说 | 在这个项目里 |
|---|---|
| 先 `git clone` 一份 pixelfx | 不用。库已经在 `vendor/pixelfx/`（来源、提交号见 `vendor/pixelfx/ORIGIN.md`），工具只用 Node 自带模块，不用安装。 |
| `node tools/render.mjs …`（在 pixelfx 目录里跑） | 在仓库根目录跑 `node tools/pixelfx.mjs render|list|check|presets …`，它会带上修仙配色；库自己的工具在 `vendor/pixelfx/tools/`。 |
| 第 2 节：用 canvas / ImageData 把特效画进游戏 | 用 `src/render/pixelfx.ts` 的 `PixelFxLayer`（Pixi 纹理，见下面「在游戏里用」）。 |
| 第 2 节：角色动作（act）用库自带的小人 | 游戏有自己的人物，只读它的时间（`mod.act` 里的 windup、hits 的 t 和 freeze）来对齐出手和命中停顿。 |
| 配色用库的 `PAL` | 只用游戏调色板，见下面的规矩。 |
| 质量表里「软、没劲 → 缩短总时长」 | 可以加快起手、加主帧，但总时长不要缩到一闪而过（用户多次说过「太快」「看不清」）。 |
| 第 5 节：Publish it on Patch | 当前发布目标为 GitHub Pages 和 COS，不使用 Patch 发布流程，无需安装 `pch`。 |

## 东西在哪

- `vendor/pixelfx/`：上游的原样副本。每个特效是一个文件 `vendor/pixelfx/src/fx/<分类>/<名字>.js`。上游的文件一律不改。
- 我们自己加的：`vendor/pixelfx/src/fx/xianxia/`（按修仙风格改造的特效），`vendor/pixelfx/src/core/index.d.ts`（类型）。
- 游戏这边：
  - `src/render/pixelfx.ts`：TypeScript 接口 `PixelFxLayer`（现场画 / 预烘焙）、`loadFx`、`listFx`。
  - `src/render/pixelfx-xianxia.ts`：修仙色阶 `XRAMP`（暗 → 亮）、火花色阶 `XSPARK`（亮 → 暗）、辉光默认值 `LIGHT`、预设 `XFX`。
  - `tools/pixelfx.mjs`：搜索、用修仙配色渲染连拍图、检查。
  - `tools/pixelfx-lab.html` + `tools/pixelfx-shot.mjs`：在 Pixi 里按游戏比例预览、截图。
- 写 Pixi 代码（纹理、精灵、混合模式、性能）先看官方的 **pixijs skill**（`.agents/skills/pixijs/SKILL.md`，它会指到对应的专项 skill）。

## 这个游戏的规矩（每个特效都要守）

1. **颜色只用 `src/art/palette.ts`。** 主色阶用 `XRAMP`，火花用 `XSPARK`；地面专用的 `q u x z` 不进特效。
2. **辉光压低。** `light` 默认 `LIGHT`（0.35），最多 0.6；半径超过 40 像素的 `p.glow` 要收小或去掉。
3. **不要光圈。** 法阵圈、圣光环、冲击波圆环、人物和武器身上的光晕都不要。带这些的特效要改造（见「改造成修仙版」）。
   例外：敌人的攻击预警用淡红光的地面光区（用户 2026-11-10 定），那是游戏自己画的，不走 pixelfx。
4. **修仙题材。** 雷是天雷 / 五雷（金白、青白、紫青），火是三昧真火（朱砂 → 缃），魂和灵气是天青，烟是云气。
   不要西式圣光、十字、科幻、符文魔法阵。可以加修仙的物件：黄符、阵旗、剑气、莲花、云纹。
5. **节奏不要快。** 出现和消失都要有过程。一次性的命中约 0.4–0.8 秒，大招 1.5–3 秒，慢慢收尾。
   法宝等级越高，特效越华丽，到高等级要有质变。
6. **尺寸和人物相称。** 画面是 480×270 像素放大显示，特效的 1 像素就是游戏的 1 像素；人物约 16–24 像素高。从天而降的天雷这类可以高。
7. **只在表现层用**（`src/game`、`src/render`），不进 `src/sim`（模拟要确定）。特效里的随机走 `seed`，不用 `Math.random`。

## 常用命令（仓库根目录）

```bash
node tools/pixelfx.mjs list frost                 # 按 id、名字、标签、描述搜；可以给几个词
node tools/pixelfx.mjs presets                    # 已有的修仙版预设
node tools/pixelfx.mjs render ice/frost-nova      # 库里的 id：原配色
node tools/pixelfx.mjs render thunder hitSpark    # XFX 预设名：修仙配色（--raw 看原配色，--all 每一帧）
node tools/pixelfx.mjs check                      # 检查 xianxia 分类；也可以给 id
node tools/pixelfx.mjs stats                      # 每个预设预烘焙后占多少显存、画一次多久
node tools/pixelfx-shot.mjs thunder --port 5180 --at 0.5,0.8,1.2   # 在实验页里把特效定在这几个时刻截图（--baked 用预烘焙播）
node tools/pixelfx-shot.mjs thunder --port 5180 --compare          # 逐像素核对预烘焙和现场画
```

连拍图在 `scratch/pfx/records/…/contact.png`，实验页截图在 `scratch/pfx/`，逐张检查轮廓、配色、遮挡和动作连续性。在 z managed agents 中，将图片交给配置了图像输入能力的 GLM-5.3-Flash 子 agent，并附上对应场景、采样时间和检查标准。
实验页：开发服务器上的 `/tools/pixelfx-lab.html?fx=<预设名或 id>`（`&raw` 原配色，`&dark` 暗背景，`&baked` 用预烘焙播）。
`vendor/pixelfx/docs/CATALOG.md` 按分类列了全部特效。

## 在游戏里用（TypeScript）

```ts
import { PixelFxLayer, prebakeAll } from '../render/pixelfx.ts';
import { XFX } from '../render/pixelfx-xianxia.ts';

const pfx = new PixelFxLayer(stage.fx); // 放进世界坐标的某个容器
// 每帧调 pfx.update(dt)（命中停顿时传 0 就定住）；换波、重开一局时调 pfx.clear()

// 满场都会出现的一次性效果（命中、消散、拾取）：预烘焙。每帧裁掉空白排进一张图集，同一个 key 只画一次，之后播放只是换贴图。
// 画一次要十几到上百毫秒，所以开局载入时先画好：
await prebakeAll([{ key: 'hitSpark', id: XFX.hitSpark.id, opts: XFX.hitSpark.opts }]);
pfx.playBaked('hitSpark', XFX.hitSpark.id, XFX.hitSpark.opts, { x, y }); // 马上返回；at 里可以给 follow、z、flip、fadeIn、t0

// 要跟着东西走的、循环的（灼烧、护体）：现场画；follow 返回 null 时收尾
const h = await pfx.playId(XFX.burning.id, { ...XFX.burning.opts, x: e.x, y: e.y, follow: () => (e.hp > 0 ? e : null) });
h.stop(); // 循环的淡出，一次性的提前结束
```

- 位置给世界坐标，对的是特效的原点（`meta.origin`，一般是脚下或命中点）。
- 预烘焙还是现场画：小而常见的一次性效果预烘焙（一个零点几 MB 显存）；和画面一样高的大特效（天雷符一个 6 MB）、要跟随的、
  每次颜色或大小都不一样的，现场画。颜色、种子、大小这些旋钮预烘焙时就定死了，要几种就用几个 key。`node tools/pixelfx.mjs stats` 看占用。
- 有 `drawBack` 的特效（分前后两层）现在合在一张贴图里画。需要人物夹在中间时，再给 `PixelFxLayer` 加前后两层。
- 要和角色一起按 y 排序（敌人身上的状态、魂散、脚下的金莲）：`new PixelFxLayer(stage.entities, { flat: true })`，精灵直接放进 entities，
  `at.z` / `follow` 返回的 `z` 定 zIndex（人物的 zIndex 是脚下的 y：比它大一点在前面、小一点在后面）；`follow` 还能给 `flip`（跟着转身）。
  `fadeIn`（预烘焙的开头淡入）、`t0`（从第几秒开始）、`fps`（现场画的限帧）见 `src/render/pixelfx.ts`。
- 要「被打的人」的剪影（魂散这类 `meta.actor` 的特效）：`src/render/pixelfx-actor.ts` 的 `actorOf(网格, 锚点)`，敌人的表是 `FOE_ART`（体型、命中点高低也在里面）。

## 战斗里已经接了哪些（2026-11-11）

战斗里的修仙版特效都在 `src/game/xfx.ts`（`XianxiaFx`：按事件放、按种类封顶、开局后台预烘焙），`feel.ts` 里只有创建、喂事件、更新三处。
接了什么、换下了什么、哪些比过没接和原因，见 `docs/pixelfx.md`「接进战斗」。再接新的照它的做法：

1. 先在真游戏里和现在的画面比（`?bot` 摆好场景、同一串随机数；比较的截图脚本在 fx-wire 分支的 scratch），**比现在好才换**，换了就把旧的去掉，不叠两层；
   法宝本身的出手调过很多轮，只在明显更好时才换。
2. 满场都会出现的一律预烘焙（加进 `xfx.ts` 的 `bakeList`），在 `XFX_CAP` 里给它一个同屏上限，满了退回原来的画法。
3. 原来的画法在别的模块里时，给那个模块加一个钩子让出来（例：`EnemyViews.onDeath`、`WeaponFx.skipStatus`、`DropsFx.onLoot`），不要在两处各画一份。
4. 联机：只用事件和镜像世界里有的字段；画在谁身上看事件的 owner。
5. 加了预设记得跑 `node --test src/render/pixelfx-xianxia.test.ts`（每个预设颜色层的不透明像素都要在调色板里）。

## 改造成修仙版

现成特效的形状不合规矩（有光圈、太西式、太大）时：

1. 复制到 `vendor/pixelfx/src/fx/xianxia/<名字>.js`（小写、连字符，拼音或英文都行）。import 路径和原作保持一样
   （同在 `src/fx/<分类>/` 这一层：`../../core/index.js`、`../<原分类>/_lib.js`）。
2. 文件头写清楚改自哪个特效、改了什么。原文件头的作者署名（如 Sprite Fusion / Hugo Duprez，MIT）原样保留。
3. 改：去掉光圈，换成修仙的物件，收小辉光，新加的颜色做成选项（默认值取调色板里的色）。
   样例：`xianxia/tianlei` 把雷击的地面法阵圈换成一张立在地上的黄符，雷落时符纸化成火星和纸灰。
4. 渲染、看、改，至少三轮（质量清单见官方 skill 第 3 节的表）。
5. `node tools/pixelfx.mjs check xianxia/<名字>`，修到全过。
6. 在 `src/render/pixelfx-xianxia.ts` 的 `XFX` 里加一条预设：id、opts，和一句 note（用途、改了什么）。
7. 在实验页里按游戏比例看一遍（浅色地面和 `&dark` 都看）。

## 新做一个

按官方 skill 第 3 节和 `vendor/pixelfx/docs/AUTHORING.md` 做，文件放在 `xianxia` 分类：
`cd vendor/pixelfx && node tools/new.mjs xianxia/<名字>`（循环的加 `--loop`）。
先用一句话说清楚是什么、怎么动、用什么色阶、多长时间，例如：
「金光咒：一道金光从脚下升起，两侧符箓碎片打着旋飘散，脚下留一片很淡的云气，0.8 秒收完」。
方向没定时写 3–5 个真正不同的稿，都渲染出来比较，挑最好的两三个给用户看。做完同样要检查、加预设、在实验页里看。

## 许可

pixelfx 是 MIT（`vendor/pixelfx/LICENSE`、`vendor/pixelfx/NOTICE.md`）。游戏发布时带着 `public/licenses/pixelfx-LICENSE.txt`，致谢页列了它。改造过的文件要保留原作者的署名。
