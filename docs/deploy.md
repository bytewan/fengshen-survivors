# 上线准备（M4）：构建、包体积、添加到主屏幕、中继上线版、部署

> 当前（2026-11-19）：公网入口使用 GitHub Pages + 平台 Java 中继；另支持 `npm run lan` 启动局域网网页和 Node 中继，详见 [公网和局域网联机](lan.md)。下方云服务器与反向代理说明为早期备选部署方案。

> 分支 feat/deploy，2026-11-11 凌晨，**暂拟，待评审确认**。
> 这一轮**只做准备，不上公网**：没买、没注册、没申请任何东西，没往外网推任何东西。下面的配置在用户的 Mac 上都跑通过（「本机试」一节）。
> 真正上线前待决策的事集中在最后一节「★ 待确定的事」。

## 一句话

一台国内的云服务器 + 一个备案过的域名。服务器上用 docker compose 起两样东西：**静态页和反向代理**（Caddy，自动 HTTPS；或者 nginx）、**联机中继**（只在内网）。
玩家打开 `https://域名/` 就能玩；联机时页面自己连 `wss://域名/relay`。单人不连中继，服务器只给它发静态文件。

```
玩家的浏览器 ──https──▶ Caddy 或 nginx（对外只开 80、443）──▶ 静态页（数据卷 /srv/site）
                          └── /relay（WebSocket 升级）──▶ 中继 relay:5300（compose 内网，不对外）
```

| 文件 | 做什么 |
|---|---|
| `deploy/docker-compose.yml` | 正式用的样例：`relay` + `caddy` 或 `nginx`（`.env` 里的 `COMPOSE_PROFILES` 二选一） |
| `deploy/.env.example` | 复制成 `deploy/.env` 填：域名、允许的来源、选哪个反向代理（`.env` 不进 git） |
| `deploy/relay.Dockerfile` | 中继的镜像：`node:24-alpine`，只装 `ws`，非 root，自带健康检查 |
| `deploy/web.Dockerfile` | 静态页的镜像：在 node 里 `npm ci && npm run build` 再预压缩，交给 Caddy 或 nginx（两个 target） |
| `deploy/Caddyfile` | Caddy：自动申请、续期证书；`/relay*` 转中继；压缩、缓存头 |
| `deploy/nginx/` | nginx：`fengshen-site.conf`（公共部分）+ `default.conf.template`（正式 https）+ `local-http.conf.template`（本机试，只有 http） |
| `deploy/site-sync.sh` | 静态页容器起来时把新版本拷进数据卷，**旧版本的 assets 留着**（原因见「更新」） |
| `deploy/push.sh` | 在 Mac 上一条命令：rsync 源码到服务器、在服务器上 `docker compose up -d --build` |
| `deploy/docker-compose.local.yml`、`deploy/local.env` | 本机试：Caddy `https://localhost:5311`、nginx `http://localhost:5312` 一起起 |
| `server/relay.mjs` | 中继（上线版的环境变量、来源白名单、体面退出、日志，见「中继」） |
| `tools/bundle-size.mjs` | 量包体积：dist/ 各类文件多大、打开标题页和进局实际下了什么 |
| `tools/precompress.mjs` | 给 dist/ 的文本文件写 `.gz`、`.br`（镜像里构建时跑） |
| `tools/icons.ts` | 生成「添加到主屏幕」的图标（哪吒待机的第一帧，整数倍放大） |

## 生产构建与包体积

`npm run build` → `dist/`（先跑类型检查）。本机看构建产物：`npx vite preview --port 5242 --strictPort`（加 `--host` 手机也能开；联机要另开 `npm run relay`）。
量包体积：`npm run build && node tools/bundle-size.mjs --port 5242`（预览开着；不带 `--port` 只量 dist/）。

**打开页面先要下多少**（没有缓存、Chrome、1280×720；「传输」按服务器开 gzip 算，字体和音频本来就是压缩过的，按原样算）。改前改后用的是同一份内容（main 的 28eda2b，道具 50 件、杨戬、修仙 pixelfx、劫数与修为都已合进来）：

| | 改前 | 改后 |
|---|---|---|
| **首屏**：标题页出来之前要下的 | 16 个文件，原始 3335 KB，传输约 **2398 KB** | 9 个文件，原始 402 KB，传输约 **206 KB**（Caddy 发 brotli 约 188 KB） |
| 其中脚本 | 12 个，1396 KB（gzip 480 KB）：整个游戏、PixiJS、四个实验页都在入口那一个包里（1037 KB） | 6 个，277 KB（gzip 100 KB）：标题页、设置、致谢、音效，和被存档那一层带进来的整套模拟（gzip 52 KB，见下面「没做的」） |
| 其中字体 | 3 份 1903 KB（书法体、正文体的完整子集 + 像素体，都在 index.html 里预载） | 2 份 89 KB：标题页那 209 个字的「首屏子集」 |
| 标题页出来之后在后台下的 | （无：全在首屏里） | 约 2318 KB：完整的界面字体（0.3 秒后开始）、选角 / 选劫 / 修为页、联机大厅、战斗、PixiJS、像素体（3.2 秒后，开场动画放完） |
| 从标题页进局时还要现下的 | 约 63 KB（WebGL 渲染器等） | 约 44 KB（Pixi 的浏览器扩展、用到的几个 pixelfx 特效） |
| 音频（第一次点击、解锁声音之后才下） | 5426 KB（102 个音效 + 3 首曲子） | 同左（没动） |
| dist/ 合计 | 约 10.1 MB | 约 10.3 MB（多了图标、首屏子集；分包后脚本总量略增） |

做了什么：

- **按需 `import()`**：入口只剩标题页这一层。选角页、选劫页、修为页、联机大厅（连带网络层）、战斗（`feel.ts`，连带 PixiJS 和全部特效）、
  `?art` / `?enemylab` / `?fxlab` / `?herolab` 实验页、过场、pixelfx 的每个特效都是用到才下（`src/main.ts`、`src/game/title.ts`）。
  标题页出来之后在后台按顺序预载（2026-11-12 起标题页一画出来就开始，见下面「首次载入与后台预载」），玩家点下去时多半已经到了；
  没到就等它（载入失败给一句提示）。带调试参数直接进局的（`?bot`、`?wave=`）就地等。
- **字体分首屏 / 完整两份**（`tools/fonts/subset.py`，`docs/fonts.md`）：标题页的字另裁两份各 40 多 KB 的首屏子集，打开页面只预载它们；
  其余的字（2026-11-12 瘦身后书法体 246 KB、正文体 307 KB，见下面「2026-11-12 瘦身」）标题页画出来就在后台下，开设置、致谢、大厅、进局之前都会等它（一般早到了；选角页不等）。
  两份的 `unicode-range` 互不重叠，浏览器按字挑用哪份；标题页上要是出现了首屏子集里没有的字，也只是首屏多下完整的那份，不会显示错。
  像素体（685 KB，只有局里的画布用）不再在首屏预载。核对过：标题、设置、选角的字都是马善政 / 霞鹜文楷画的，没有落到系统字体。
- **压缩与缓存**（部署时）：镜像里预压缩出 `.br`、`.gz`（Caddy 发 brotli，nginx 发 gzip）；带内容哈希的 `assets/` 一年不变（immutable），
  字体、音频、图标缓存一小时，页面和 manifest 每次都问一下有没有新的（没变就 304）。回访的玩家基本不再下载什么。
- **没做的、可以再省的**：
  - **首屏里还有整套模拟（gzip 约 52 KB）**：存档那一层（`src/game/profile.ts`，入口必须有）引用了 `src/sim/jie.ts` 的 `JIE_MAX` 和 `src/sim/xiuwei.ts` 的修为表，
    而这两个文件又 import 了 `world.ts`、`shop.ts`——打包是按 import 关系分块的（试过把 `src/sim` 标成「没有副作用」，结果一个字节都没变），整套模拟就跟进了首包。
    把这两处用到的常量和纯函数挪到不 import `world`、`shop` 的小文件里（例如 `jie-table.ts`、`xiuwei-table.ts`，原文件再 re-export），首屏就回到约 152 KB。
    这两个文件归劫数那条线、第三章还在接，这次没动（★ 合并完各线之后顺手做）。
  - `vite.config.ts` 里没有手工分包：试过把 PixiJS 单独分一包（游戏更新时它不变、缓存能接着用），但 Pixi 的入口把所有渲染器都 re-export 了，
    一分组就把只该按需下的 WebGPU、Canvas 渲染器和 Vite 的预载工具一起拽进了首包。自动分包按实际用到的切，结果是对的（原因写在 `vite.config.ts` 里）。
  - 音频没动：本来就是第一次点击之后才下、先下常用音效、最后才下第一章的三首曲子，别的章的曲子放到前一首时才下（`src/audio/player.ts`、`bank.ts` 的 `MUSIC[曲名].next`）；音乐 96 kbps 立体声 AAC 已经不大，
    再压要从原始素材重编（从有损再转一遍会更糊），归音频那条线（`docs/audio.md`、`tools/audio/build.ts`），而且那时待试听。
    要省的话，音乐降到 64 kbps 大约能省 1.4 MB。
  - 图片：游戏里的美术都是代码画的（没有图片文件），只有 6 张图标共 16 KB。
  - 玩家多了以后可以把静态页放到 CDN（按流量计费），服务器只跑中继（见「需要什么」）。

### 2026-11-12 瘦身（用户「开始瘦身」；音频另在 feat/soften）

`node tools/bundle-size.mjs --port <预览端口>`，同一台机器、同一份内容，前后对比（「传输」按 gzip 估，字体按原样）。量法也改了：
标题页一出来就开始预载，原来按 load 事件分会把预载算进首屏；现在按页面里的 `fs-title` 标记（`src/main.ts`，标题页挂上的那一刻）分。

| | 瘦身前 | 瘦身后 |
|---|---|---|
| ① 首屏（标题页出来之前） | 13 个文件，约 **307 KB**（其中整套模拟一包 113 KB） | 14 个文件，约 **195 KB**（脚本 72 KB、两份首屏字体 107 KB、页面 16 KB） |
| ①′ 标题页出来之后后台预载的 | 50 个文件，约 2701 KB | 48 个文件，约 **1292 KB** |
| ② 打开 `?bot` 直接进一局一共下的 | 84 个文件，约 3010 KB | 81 个文件，约 **1475 KB** |
| dist/ 里的字体 | 2225 KB | 1328 KB（其中 622 KB 是「书法」主题才下的全套书法体） |

做了什么：

- **首屏不带整套模拟**：存档那一层（`src/game/profile.ts`）引了 `src/sim/xiuwei.ts`，而它连着 `shop.ts`、`world.ts`。修为的节点表和纯函数拆到
  `src/sim/xiuwei-table.ts`（不引别的模拟代码），`xiuwei.ts` 原样再导出，存档只引小的那个。标题页上「成就补记」（`achievements.ts`，连着整套模拟）
  等选角那一组预载完、开场动画放完再下。
- **字体按用处收字**（`tools/fonts/subset.py`，`docs/fonts.md`）：书法体只收用书法体显示的字（名字、标题、按钮；923 → 246 KB），
  正文体、像素体只收字符串里的字（原来连注释里的字也收；文楷 510 → 307 KB，像素体原来整份 685 KB → 45 KB）；「其余」两份不再重复带首屏的字。
  书法体缺的字落到文楷，不是方块；`src/game/fonts-cover.test.ts` 核对字符串和各张名字表都收进去了。设置里选「书法」主题时才另下书法体全套。
- **PixiJS 分包**（`vite.config.ts`、`tools/pixi-renderer-only.ts`）：不分组时打包器把 Pixi 的公共部分并进了 WebGPU 渲染器那一包（327 KB），进局前整包都得下，
  看起来像是「下了 WebGPU」。实际 WebGPU、Canvas 两个渲染器独有的代码只有约 50 KB（gzip 约 13 KB）；现在 Pixi 归一包（`pixi-*.js`，gzip 137 KB），
  两个渲染器独有的部分单独成包、走 WebGL（Pixi 的默认偏好）时不下。`tools/perf-probe.mjs`（横屏手机、CPU 降速 4 倍、刷怪最多的场景）前后帧时间一样（中位 4.0 / 4.3 毫秒）。
- 没再动的：标题页的首屏字体（两份共 107 KB，是首屏里最大的一块）——要再省得把标题页的字收得更少，或者标题大字也改成内联轮廓。

## 首次载入与后台预载（2026-11-12，分支 feat/loading）

用户：「用户第一次进来得看到下载的进度」「现在是一次性下载完的么？点击回响要一会才能进入」。

- **不是一次性下载完的**：分包按需加载。慢在两处：用户试玩的是开发服务器（模块不打包，标题页前约 4 MB、87 个请求）；打包版点「回响」时还要现等选角那一包和完整字体，
  后台预载又要等标题页出来 3.2 秒后才开始。
- **首次载入画面**（`index.html` 的 `#boot`）：书法「封神幸存者」、一道从中间往两边展开的金线、一行「初次入阵，正在载入」（来过的不写这行）。字是内联的楷书轮廓（不等字体）。
  进度是真的：构建时 `tools/vite-load-plan.ts` 把首屏各文件（入口脚本连带静态引用的各包、两份首屏字体）的传输字节写进页面（`window.__FS_LOAD`），
  浏览器每下完一个文件（Resource Timing）就记上，金线往那里追（不是匀速假条）。0.3 秒内就好了（有缓存）的不出现；标题页挂上后线走满、淡出。
  开发服务器上模块不打包、算不出清单：按这台设备上一次首屏实际下了多少字节估（第一次按 3.5 MB），走到九成五停住等完成。
- **后台预载**（`src/game/preload.ts`）：标题页一画出来就开始，一组下完再下一组，带宽集中给最先要用的：
  ① 选角、选劫（连带角色表和模拟，gzip 约 140 KB）→ ② 其余的界面字体（约 550 KB）→ ③ 战斗那一包（PixiJS、特效）和像素体 → ④ 联机大厅、修为、图鉴（成就页也在这一包）。
  生产构建里先用 `<link rel="modulepreload">` 只下载、不执行；③④ 的执行放到开场动画放完之后的空闲时刻（PixiJS 那一包执行要占几十毫秒，别让开场动画卡）。
  玩家先点了别的（联机、修为……）就地 import()，不用排队。进度画在标题页左上角：一行「余卷载入中」和一道细金线，全到了淡掉。
- **点「回响」**：选角那一组还没到时，标题先不走，「回响」笔下一道金线随真实进度展开，到了再进；选角页不再等完整字体（完整子集改成 `font-display: swap`：
  字没到先用系统的宋体 / 楷体，到了换成楷书），标题淡出 0.12 秒就叠上选角页。
- **前后时间表**（`scratch/latency.mjs`：打包版、1280×720、无缓存，点击用 force、不等开场动画；三次取中位数）：

  | 情况 | 改前（main 的打包版） | 改后 |
  |---|---|---|
  | 不限速：标题页出来 | 约 0.3 秒 | 约 0.1 秒 |
  | 不限速：刚出标题就点「回响」→ 选角页 | 1.1 秒 | 0.86 秒（按钮上有进度） |
  | 不限速：等 3–5 秒再点 | 0.8 秒 | **0.24 秒** |
  | 限速 4 Mbps：标题页出来 | 0.86 秒 | 0.85 秒 |
  | 限速 4 Mbps：刚出标题就点 | **10.3 秒**（没反应地干等） | 0.9 秒（按钮上有进度） |
  | 限速 4 Mbps：等 3 秒再点 | 0.82 秒 | **0.29 秒** |
  | 限速 4 Mbps：等 5 秒再点 | 0.86 秒 | **0.24 秒** |

  （无头 Chromium 的软件渲染下量的；每组第一次是冷启动，偶尔 1.5–2.7 秒，取中位数。）顺带修了一处：墨痕按钮的小图原来用 GPU 画布转 PNG，
  第一次读回在软件渲染下要 1–2 秒（真机上短得多），改成 CPU 画布（`willReadFrequently`）后可忽略。
- **试玩用的打包版**：`scripts/serve-build.sh`（或 `npm run serve:build`）：类型检查、`vite build` 到 `dist/`、`vite preview --host --port 5181 --strictPort`，
  手机在同一个 Wi-Fi 下打开启动输出里 Network 那一行的地址，试真实的加载速度。和开发服务器（5180）互不相干；端口可以给别的：`scripts/serve-build.sh 5331`。
  联机还要中继（`npm run relay`，5300）。`vite preview` 发 gzip，但每次都问一下有没有新的（no-cache），回访比上线后（带哈希的文件缓存一年）多几个往返。

## 手机上「添加到主屏幕」

- `public/manifest.webmanifest`：名字「封神幸存者：回响」（主屏幕上显示「封神幸存者」）、`display: fullscreen`（不显示浏览器的栏）、`orientation: any`（2026-11-11 起横竖屏都能玩，不锁方向）、
  主题色和底色 `#2c2334`（和页面的底一样，启动画面接得上）、四张图标（`any`、`maskable` 各 192 / 512）。
- 图标：哪吒待机的第一帧（`src/art/sprites/nezha.ts`）按整数倍放大，摆在黛色（`#4a3b4a`）的底上——`node tools/icons.ts` 生成到 `public/icons/`。
  maskable 那两张的每个不透明像素都在中间八成的圆里（安卓裁成圆形、圆角方形都不会切到人物）；另有 iPhone 用的 180 和浏览器标签上的 32。改了哪吒的样子重跑一次。
- `index.html`：manifest、图标、`apple-mobile-web-app-capable` / `-title` / `-status-bar-style`（iPhone 不读 manifest 里的图标和横屏，读这几行）、`description`、
  国内双核浏览器用 webkit 内核（`<meta name="renderer">`）。
- 怎么加：安卓 Chrome → 右上角菜单 →「添加到主屏幕」/「安装应用」；iPhone Safari → 分享 →「添加到主屏幕」。**微信里打开的页面加不了**，要先点右上角「在浏览器打开」。
  横竖屏都能玩，竖着拿时画面等比缩小（docs/design.md「横竖屏与全屏」）。iPhone 的 Safari 不能让网页全屏，想全屏只能「添加到主屏幕」——设置里在 iPhone / iPad 上写着这句；
  从主屏幕打开时刘海、底部横条让开（`viewport-fit=cover` + 安全区）。安卓 Chrome、iPad 在网页里就能全屏（`src/game/fullscreen.ts`）。
- 本机用 Chrome 自己的检查核对过（开发者工具协议 `Page.getAppManifest` / `getInstallabilityErrors`）：manifest 没有错误，没有「不能安装」的原因。

**不做离线缓存（Service Worker），原因**：

1. 游戏还在频繁更新。Service Worker 缓存住的是旧版本，什么时候换新版由浏览器决定（微信、Safari 里尤其不好控制）；写错一次，坏掉的缓存会一直留在玩家手机上，很难撤回。
2. 离线玩的意义不大：联机必须在线；单人要离线就得把约 8 MB 的音频、字体、脚本都缓存下来，第一次打开反而更慢。
3. 「添加到主屏幕」不需要它：iPhone 从来不要求；安卓 Chrome 现在也不强制要求离线能力（上面那条检查在没有 Service Worker 的情况下通过）。
4. 普通的 HTTP 缓存已经够用：带哈希的文件一年不变，回访基本不再下载。

以后游戏稳定了、真想要秒开和离线单人，再加（只在标题页切换新版本，并留一个强制清缓存的开关）。

## 中继（上线版）

`server/relay.mjs` 在局域网里的用法不变（`npm run relay`，端口 5300，不设任何环境变量就和以前一样）。上公网时由 docker compose 设下面这些：

| 环境变量 | 默认 | compose 里 | 说明 |
|---|---|---|---|
| `RELAY_PORT`、`RELAY_HOST` | 5300、0.0.0.0 | 同 | 监听的端口、地址（compose 里只在内网，不映射到宿主机） |
| `RELAY_ORIGINS` | 不限 | `.env` 里填 | 允许哪些网页来连，逗号分隔、要带 `https://`。不在里面的（包括没带来源的）升级 WebSocket 时直接回 403。HTTP 的跨域头也只给它们 |
| `RELAY_MAX_ROOMS` | 500 | 500 | 房间数上限（满了建房报「中继的房间满了」） |
| `RELAY_MAX_CONNS` | 2000 | 2000 | 总连接数上限（超了用 1013 关） |
| `RELAY_MAX_CONNS_PER_IP` | 24 | 24 | 每个 IP 的连接数上限（一家人、一个网吧共用一个出口 IP，别设太小） |
| `RELAY_TRUST_PROXY` | 0 | 1 | 在反向代理后面：按代理加的 `X-Forwarded-For`（最右一个）/ `X-Real-IP` 认来访的 IP。中继直接对外时别开，不然谁都能伪造 IP 绕过上限 |
| `RELAY_BASE` | `/relay` | 同 | 路径前缀：反向代理把 `/relay/...` 原样转过来；不带前缀的也认（局域网里直接连 `:5300`） |
| `RELAY_LAN` | 1 | 0 | 局域网的方便：`/info` 报本机的局域网地址、`/stats` 列出各房间（带房间码）。公网上关掉——房间码是进房的唯一凭据，列出来谁都能进别人的房 |
| `RELAY_LOG` | text | json | 日志格式：`时间 事件 键=值 …`，或一行一个 JSON |
| `RELAY_SHUTDOWN_MS` | 1500 | 同 | 收到 SIGTERM 后先通知房里的人，等多久再关连接 |
| `RELAY_SILENCE_MS`、`RELAY_HOST_GRACE_MS` | 6000、24000 | — | 测试用：多久没动静算掉线、房主掉线后等多久再迁 |

写错了（不是数、来源不是网址……）中继直接起不来、打印哪一个错了，不会悄悄用默认值。

- **地址**：页面是 `https://域名/`（或 http 但用默认的 80 端口）时，客户端连同一个域名的 `wss://域名/relay`（`src/net/link.ts` 的 `relayUrl`）；
  页面在开发服务器的端口上（`http://192.168.1.23:5180/`）照旧连同一台机器的 `:5300`；`?relay=` 照旧优先。连不上时，公网上提示「连不上联机：网络不通，或者正在维护，过一会儿再试」。
- **HTTP**：`/relay/health`（`ok`；正在关的时候 503 `draining`）、`/relay/info`、`/relay/stats`（公网上只有合计：房间数、人数、连接数、每秒进出多少 KB）。
- **体面退出**：`docker stop`、更新时收到 SIGTERM → `/health` 回 503、不接新连接 → 给每个人发 `{t:'bye'}` → 约 1.5 秒后用 1012（服务重启）关连接、退出。
  房间都在中继的内存里，重启之后就没了；客户端收到 bye 直接当「房间没了」，显示「联机在更新，这一局断开了：过一会儿重新建房」，不再白白重连。再按一次 Ctrl-C / 再发一次 SIGTERM 直接退。
- **日志**：一行一个事件，只有中继自己产生的东西（房间码、编号、人数、原因、关闭码），**不记名号、附加信息、游戏内容，也不记 IP**。事件：

| 事件 | 字段 | 什么时候 |
|---|---|---|
| `listen` | host、port、base、origins、trustProxy、lan、各项上限 | 起来了 |
| `create` / `join` / `rejoin` / `leave` | room、member、rooms / size | 建房、进房、带凭据回来、离开 |
| `lost` | room、member、code（`1001` 关页面、`silence` 心跳超时……） | 连接断了（位置留着等他回来） |
| `host` / `host.wait` / `host.back` / `host.none` | room、from、to、why（`closed` `timeout` `left` `abdicate`） | 换房主、房主掉线等他、房主回来了、没人能接手 |
| `room.delete` | room、why（`empty` `idle`） | 删房 |
| `reject` | reason（`origin` `draining` `conns` `per_ip` `rooms`）、origin | 拒绝连接 / 建房（origin 只在来源不对时记，方便查配置写错了没有） |
| `rate` | room、member | 发得太快被限流（每条连接每秒最多记一次） |
| `shutdown` / `closed` / `crash` | signal、rooms、conns / — / msg | 开始关、关完了、崩了（Docker 会自动重启它） |

时间是 UTC（北京时间要加 8 小时）。

## 需要什么（买、办之前先看）

### 服务器

- **国内**（华东、华南这类离玩家近的地域）的云服务器，配置 **2 核 2 GB 起**（中继空闲时约 22 MB 内存、Caddy 约 60 MB；吃内存的是部署时在服务器上构建，`npm ci` + 构建约要 1 GB，1 GB 内存的机器要加 swap）。
  系统选 Ubuntu 24.04 或 Debian 12，硬盘 40 GB 够用。
- 带宽是关键（见下面的估算）：国内云服务器多是「固定带宽」（比如 5 Mbps、10 Mbps，按出方向算）或者轻量服务器的「峰值带宽 + 每月流量包」。
  这个游戏新玩家第一次要下约 8 MB（多数在标题页和第一次点击之后陆续下），固定 3–5 Mbps 时几个人同时进来就要等十几秒到几十秒；**更建议峰值带宽高（30 Mbps 以上）、带流量包的轻量应用服务器**，
  或者以后把静态页放 CDN。
- 安全组（防火墙）只开 22（SSH）、80、443（TCP），要 HTTP/3 再开 UDP 443。中继的 5300 **不要**对外开。

### 域名

- 在国内的注册商（或云厂商）买，做**实名认证**（1–3 个工作日）。后缀 `.com`、`.cn` 都行；可以用子域名，例如 `fs.你的域名.com`。
- 备案下来之后加一条 A 记录指向服务器的公网 IP。

### ICP 备案（国内服务器 + 域名必须有，没有的话云厂商会拦掉 80、443）

1. 前提：域名已实名；有一台这家云厂商的国内服务器（一般要求包年包月、剩余时长三个月以上，用来申请备案的「服务号」）。
2. 在云厂商的备案系统里填：主体（个人：身份证；公司：营业执照 + 负责人身份证）、网站信息（网站名称、域名、内容说明），手机上做人脸核验。
3. 云厂商初审（1–2 个工作日，常要求改几处）→ 工信部短信核验（24 小时内回）→ 省通信管理局审核（各省不一，常见 5–20 个工作日）。**整体一般 2–4 周**。
4. 下来之后：网站底部要显示备案号、链接到 <https://beian.miit.gov.cn/>；30 天内还要去全国互联网安全管理服务平台（<https://beian.mps.gov.cn/>）做**公安联网备案**，
   下来后公安备案号也要显示在底部。（标题页现在没有放这一行的地方，见「★ 待确定的事」。）
5. 网站名称、内容的要求各省口径不一：**个人备案的网站能不能是游戏**、名称能不能带「游戏」这类字，提交前问云厂商的备案客服（他们最清楚当地管局的口径）。

### HTTPS 证书

- **Caddy（推荐，最省事）**：什么都不用做，Caddy 自己去 Let's Encrypt / ZeroSSL 申请、到期前续期。要求备案下来、域名已解析、80 和 443 通。
- **nginx**：用云厂商控制台的免费证书（下载 nginx 格式，放 `deploy/certs/fullchain.pem`、`privkey.pem`）。**免费证书现在多是三个月一换**，到期前要重新申请、换文件、
  `docker compose exec nginx nginx -s reload`。也可以在服务器上用 acme.sh / certbot 自动续，但那就和 Caddy 做的是同一件事了。

### 带宽和流量估算

用 `docs/netcode.md` 里量过的数（四个人的机器人局，压缩后，按「发给一个人」算）：其他人每人收房主的状态**整局平均约 16 KB/s、最激烈的波约 32 KB/s**；
每人发操作约每秒 30 条小帧，算上包头约 3 KB/s（中继转给房主）。单人不连中继，不占这部分。

| | 中继出方向（服务器发出去的） | 折合 |
|---|---|---|
| 一个四人房，平均 | 3 × (16 + 3) ≈ 57 KB/s | 约 0.46 Mbps |
| 一个四人房，最激烈的波 | 3 × (32 + 3) ≈ 105 KB/s | 约 0.84 Mbps |
| 摊到每个在线的联机玩家 | 平均约 14 KB/s，最高约 26 KB/s | 约 0.11 / 0.21 Mbps |

- 5 Mbps（约 625 KB/s）只跑中继：同时约 **24 个联机玩家**（6 个满房）都在最激烈的波也够；平均算能到 40 多个。10 Mbps 翻倍。
- 但同一条带宽还要发静态页：每个新玩家约 8 MB（首屏 0.2 MB + 标题页后台 2.3 MB + 局里 0.05 MB + 第一次点击后的音频 5.4 MB），5 Mbps 下一个人独占也要十几秒。
  所以带宽小的话，静态页最好放 CDN，或者买峰值带宽高的轻量服务器。
- 每月流量（举例）：每月 1000 个新玩家 × 8 MB ≈ 8 GB；平均 10 人同时联机、每天 3 小时 ≈ 10 × 14 KB/s × 3 小时 × 30 天 ≈ 45 GB。合计约 **50–60 GB / 月**，
  轻量服务器的流量包（几百 GB 到几 TB）绰绰有余。

### 大概的费用（2026 年底的价格以云厂商官网为准，这里只是量级）

| 项 | 大概 |
|---|---|
| 国内轻量应用服务器 2 核 2–4 GB | 正常价每月几十元到一百多元；新用户首年活动价常见一两百元一年 |
| 域名 | `.com` 每年几十到一百元；`.cn` 更便宜（首年常有活动价） |
| ICP 备案、公安备案 | 免费（云厂商代办，要有它家的国内服务器） |
| HTTPS 证书 | 免费（Caddy 自动申请，或云厂商的免费证书） |
| CDN（以后要的话） | 国内按流量约两毛钱一 GB，每月 100 GB 约 20 元 |

## 一步步部署（备案下来之后；以 Caddy 为例）

1. **服务器装 Docker**：国内直连 Docker 官方的安装源和 Docker Hub 常常很慢或连不上，照云厂商文档用它的 Docker CE 安装源；
   装好后在 `/etc/docker/daemon.json` 里配一个 Docker Hub 镜像加速（云厂商一般有内网加速地址），`systemctl restart docker`。
   否则构建时拉 `node:24-alpine`、`caddy:2-alpine`、`nginx:1.28-alpine` 会失败。确认：`docker compose version`。
2. **推源码**（在 Mac 上、项目根目录；这个项目没有 git 远端，用 rsync 推，约 15 MB）：先提交、`npm test` 过，然后
   `DEPLOY_HOST=ubuntu@服务器IP sh deploy/push.sh`。第一次会因为服务器上还没有 `.env` 停下来。
3. **在服务器上填配置**：`cd /opt/fengshen/deploy && cp .env.example .env && nano .env`——`SITE_ADDRESS=你的域名`、`RELAY_ORIGINS=https://你的域名`、
   `COMPOSE_PROFILES=caddy`；npm 拉包慢就再写 `NPM_REGISTRY=https://registry.npmmirror.com`。
4. **再推一次**（或者在服务器上 `docker compose up -d --build`）：第一次构建几分钟。`docker compose ps` 三个都是 `Up`、relay 是 `healthy`。
5. **验证**：`curl -I https://你的域名/`（200、`content-encoding: br`）、`curl https://你的域名/relay/health`（`ok`）；手机打开 → 标题页 → 联机 → 建房，另一台手机扫码进房，一起打一波。

用 nginx 的不同之处：`.env` 里 `COMPOSE_PROFILES=nginx`；把证书放到服务器的 `/opt/fengshen/deploy/certs/fullchain.pem`、`privkey.pem`（`push.sh` 不会动这个目录）。

不用 Docker 也行：`npm run build` 后把 `dist/` 拷到服务器（**不加 `--delete`**，留着旧的 assets），nginx 用 `deploy/nginx/fengshen-site.conf`（里面写了要改哪一行）；
中继用 systemd 跑 `node server/relay.mjs`，环境变量照上表，`Restart=always`。

## 更新

- 改完、提交、测试过 → `DEPLOY_HOST=… sh deploy/push.sh`。服务器上 `docker compose up -d --build` 会：
  - 重建静态页的镜像、重启那个容器（几秒）：`site-sync` 把新版本拷进数据卷，**旧版本的 assets 留着**——正在打的玩家，页面还是更新前那一版，
    局里按需加载的脚本（某件法宝第一次放出来的特效、章末的过场）要从旧版本的文件名下载，删了就 404、特效出不来。
  - 中继的代码（`server/relay.mjs`）和依赖没变时，中继的镜像不变、容器不重建，正在打的联机局不受影响。
  - 中继变了就会重启：正在打的联机局都会断（玩家看到「联机在更新……」），**挑人少的时候更新**。
- 回退：本地 `git checkout 上一个好的提交`，再推一次（推完记得切回来）。
- 旧版本的 assets 攒多了想清：`docker compose exec caddy sh -c 'cd /srv/site/assets && for f in *; do [ -e "/app/dist/assets/$f" ] || find "$f" -mtime +7 -delete; done'`
  （只删这一版里没有、而且七天以上没被拷过的；nginx 的把 `caddy` 换成 `nginx`）。一版只多几百 KB 到两 MB，一年不清也就几百 MB。

## 看日志、看状态

- `docker compose logs -f relay`（中继，一行一个 JSON）、`docker compose logs -f caddy`（证书申请、出错）。每个容器的日志最多留 5 个 10 MB 的文件，自动滚动。
- 只看拒绝的：`docker compose logs --no-log-prefix relay | grep '"ev":"reject"'`；装了 jq 的话 `| jq -c 'select(.ev=="create")'`。
- 现在多少人在线：`curl -s https://你的域名/relay/stats` → `{"rooms":[],"total":{"rooms":3,"members":9,"online":8,"conns":8,"inKBs":12.3,"outKBs":30.1}}`。
- CPU、内存：`docker stats`。
- 访问日志默认不记（里面有来访者的 IP）。排查问题时临时打开：Caddyfile 末尾 `# log` 去掉注释后 `docker compose restart caddy`；nginx 改 `fengshen-site.conf` 里的 `access_log`。

## 出问题时

| 现象 | 先看 |
|---|---|
| 打不开页面 | 安全组 80、443 开了没有；`docker compose ps`；`docker compose logs caddy`（证书申请失败多半是域名没解析过来或者没备案被拦） |
| 能打开、联机「连不上联机」 | `curl https://域名/relay/health`；`docker compose logs relay` 里有没有 `reject reason=origin`（`.env` 的 `RELAY_ORIGINS` 和地址栏里的来源一字不差，带 `https://`，有 www 的也要写） |
| 联机经常掉线 | 反向代理的超时（nginx 的 `proxy_read_timeout` 已放到 120 秒）；服务器带宽是不是跑满了（`/relay/stats` 的 `outKBs`） |
| 更新后有人特效出不来 | 看是不是有人清了数据卷 `site`（旧版本的 assets 没了）；让他刷新页面 |
| 构建失败 | 拉基础镜像失败 → Docker Hub 镜像加速；`npm ci` 慢或失败 → `.env` 里 `NPM_REGISTRY`；内存不够 → 加 swap |

## 本机试（不上公网，2026-11-11 在用户的 Mac 上跑过）

- 生产构建 + 预览：`npm run build && npx vite preview --port 5242 --strictPort`。从标题页一路点进局（入回响 → 选角 → 出战，第一次会放开场过场），打完第 1 波进商店，无报错。
- 生产构建 + 本机中继：`RELAY_PORT=5310 npm run relay`，`node tools/net-run.mjs --port 5242 --guests 1 --secs 40 --host "&relay=localhost:5310" --guest "&bot&relay=localhost:5310"`：两人打到第 2 波，无报错。
- docker compose（三个容器：中继、Caddy、nginx）：

  ```
  cd deploy
  docker compose --env-file local.env -f docker-compose.yml -f docker-compose.local.yml up -d --build
  # Caddy：https://localhost:5311/（Caddy 自己的本地 CA 发的证书，浏览器会提示不受信任）
  # nginx：http://localhost:5312/?relay=ws://localhost:5312/relay（只有 http；非默认端口的 http 页面默认连 :5300，所以要带 ?relay=）
  docker compose --env-file local.env -f docker-compose.yml -f docker-compose.local.yml down -v --rmi all   # 试完
  ```

  结果：两个 Playwright 页面各跑一局两人联机——Caddy 那边页面**自己算出** `wss://localhost:5311/relay`（正式上线时就是这条路），nginx 那边带 `?relay=`；
  都是第 1 波 → 商店 → 第 2 波，无报错，往返延迟约 4 毫秒。`docker compose stop relay` 时两边都收到 bye、显示「房间没了 · 联机在更新……」、不再重连。
  另外单独起了一个 nginx 容器挂正式的 https 模板和自签证书：https 200（HTTP/2）、http 301 到 https、`/relay/health` 通；
  页面来源不在白名单里（`https://localhost:5313`）时大厅报连不上、中继日志 `reject reason=origin`。
  把 `push.sh` 的 rsync 结果当成「服务器上的那份」构建了一次镜像，确认能过（一开始的排除规则把 `src/art/` 也排除了，就是这样查出来的）。
- **这台 Mac 上的坑**：Docker Desktop 的 `docker pull`（和 BuildKit 拉基础镜像）一直卡住不动——同一个镜像站用 Node、curl、wget 访问都正常，像是 Docker 里 Go 的网络栈在这里有问题，没深究（不动 Docker Desktop 的设置，也没重启它：上面还跑着别的容器）。
  绕过去的办法：用 Node 脚本从 DaoCloud 镜像站把官方的 `node:24-alpine`、`caddy:2-alpine`、`nginx:1.28-alpine` 下下来（摘要和 Docker Hub 上的一样）、拼成 OCI 包、`docker load` 进去，
  再用 Docker Desktop 自带的构建器（`--builder desktop-linux`）构建。脚本在 `.wt/deploy/scratch/deploy/pull-image.mjs`（没进仓库）。正式的服务器上照「一步步部署」配镜像加速即可，不需要这一步。

## ★ 待确定的事

> **用户 2026-11-11：先不上线**（只在局域网里玩）。服务器、域名、备案都等要上线时再办；这一节的事到那时再定。

1. **服务器放哪**：国内（要备案，微信里分享、国内访问都顺）还是香港（不用备案、马上能上，但国内访问慢一些、晚上可能不稳，微信里打开未备案的域名有被拦的风险）。
   我的建议：**国内 + 备案**。哪家云、什么配置（建议 2 核 2–4 GB、峰值带宽 30 Mbps 以上带流量包的轻量服务器）。
2. **域名**：买哪个、用不用子域名（例如 `fs.xxx.com`）。
3. **备案主体：个人还是公司**（`docs/design.md`「待定」那一行）。个人简单，但游戏类网站能不能用个人备案、网站名称怎么起，要先问云厂商备案客服。
4. **网络游戏相关的资质**：`docs/design.md` 已定「完全免费，不收费、不接广告」，就是为了先不碰版号、实名认证和防沉迷；但对公众开放的网络游戏要不要这些，
   法规上并不只看收不收费——**上线前用户自己判断要不要咨询**（这里只做技术准备）。
5. **HTTPS 用哪种**：Caddy 自动（推荐）还是 nginx + 云厂商的证书（三个月一换）。
6. **备案号放在哪、长什么样**：备案下来后页面底部要有一行备案号（和公安备案号）链接到工信部网站。标题页最下面现在是战绩那一行，要不要在它下面加一行很淡的小字？
   样式要和标题页协调（这次没动标题页的画面）。
7. **要不要一页隐私说明**：游戏不收集任何个人信息（存档在玩家自己的浏览器里，中继只转发、日志不记内容和 IP，访问日志默认关）；正式上线一般还是放一段说明，放在「致谢」里还是单独一页？
8. **中继的上限和更新时机**：房间 500、连接 2000、每 IP 24 是按小服务器给的初值；中继重启会断掉正在打的联机局，更新放在什么时候（比如每天早上）。
9. **静态页要不要上 CDN**：玩家少时不用；同时进来的新玩家多了（或者服务器是小的固定带宽）再上。
10. 微信里分享出去的卡片想要自定义标题、图标，要用微信的 JS-SDK，需要公众号和备案过的域名——以后再说。
