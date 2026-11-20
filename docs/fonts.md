# 字体

用户口径的变化：

- 2026-11-09：所有的字不要规整的系统字体，先全部换成像素体；有些地方可以高清，但得符合修仙。
- 2026-11-10（试玩后）：「第一章那个字体（书法标题）就不错，尝试下类似的字体而不是像素」。所以**界面的字改成楷书一路**，像素体只留给画布里的像素字。

| 用途 | 字体 | 许可 | 文件 |
|---|---|---|---|
| 大标题、章节名、首领名、横幅、主要按钮 | 马善政楷书 Ma Shan Zheng（<https://github.com/google/fonts/tree/main/ofl/mashanzheng>） | SIL OFL 1.1 | `public/fonts/ma-shan-zheng-subset.woff2`（子集）+ `ma-shan-zheng-title.woff2`（首屏子集） |
| 正文、说明、数字、标签（默认） | 霞鹜文楷 LXGW WenKai Medium v1.530（<https://github.com/lxgw/LxgwWenKai>）：和书法标题同是楷书一路，小字也清楚 | SIL OFL 1.1（保留字体名条款允许裁成网页字体子集） | `public/fonts/lxgw-wenkai-medium-subset.woff2`（子集）+ `lxgw-wenkai-medium-title.woff2`（首屏子集） |
| 画布里的像素字（相生飘字、掉落奖励等，`src/render/pixel-text.ts`） | 缝合像素字体 Fusion Pixel Font 12px 等比简体（TakWolf，v2026.10.25，<https://github.com/TakWolf/fusion-pixel-font>） | SIL OFL 1.1 | `public/fonts/fusion-pixel-12-zh_hans.woff2`（子集，2026-11-12 起；原来整份） |

规则：

- 界面（DOM）代码一律用 `src/game/fonts.ts` 的 CSS 变量：正文 `var(--font-text)`，标题 `var(--font-title)`；不要直接写字体名，不要用系统字体，也不要再给界面用像素体。
- **字体主题**可以在设置里切换，方便对比：`kai`（默认）= 标题书法 + 正文文楷；`brush` = 全部书法体。`applyFontTheme()` 立即生效。
- 折行（外围界面在 `src/game/front-ui.ts` 的 `.fs-ui` 上统一设好）：正文只在标点、空格处折（`word-break: keep-all`，一句放不下时才在任意处折），最后一行不留孤零零的一两个字（`text-wrap: pretty`），折到行首的开括号收掉左边的半格空（`text-spacing-trim: trim-start`，各行左边线才齐）；数字和量词之间用不折行的空格（`\u00a0`），「约斩 80 只」不会拆在两行。
- 像素体只在画布里用，必须按 12px 原尺寸画、关掉平滑、整数倍放大。战斗画面是 480×270 的像素画布，里面的字（伤害数字、相生飘字、奖励文字）仍是像素字；要高清就得另加一层界面叠在画布上。
- **子集怎么裁**（`tools/fonts/subset.py`；2026-11-12 瘦身后，数字见 `docs/deploy.md`「2026-11-12 瘦身」）：三套都只收会显示出来的字。改了界面文字、加了新字之后，跑一次 `.venv/bin/python -I tools/fonts/subset.py`。源字体放在 `scratch/downloads/{mashan,wenkai,fusion}/`（不进 git）。
  - 正文体、像素体：`src/**/*.ts`（不含测试）里字符串的字（不算注释）、`server/*.mjs` 里发给大厅的话、`index.html` 的界面字、`public/audio/CREDITS.txt`。正文体是最后的后备，缺字就是方块，所以宁多勿少。
  - 书法体：只收用书法体显示的字——名字表（`name` / `title` / `who` 字段、一行一个的「键: '短名'」、短名数组、`L(id, 名字, …)` 这类位置参数）、`inkButton('…')` 的字、`<h1> <h2> <b>` 里的短字，以及用到书法体的界面文件里四个字以内、不带句读的短字符串。没收到的字落到文楷（字体栈 书法体 → 文楷），不是方块。
  - 设置里「字体主题：书法」（正文也用书法体）要全套：另有 `ma-shan-zheng-full.woff2`（字体名 `FS Brush Full`），只在选了这个主题时才下。
  - 兜底：`src/game/fonts-cover.test.ts` 读 `subset.py` 写的 `tools/fonts/chars.gen.json`，核对源码字符串的字都在正文体 / 像素体里、各张名字表（角色、法宝、道具、敌人、首领、功法、成就、修为……）的名字都在书法体里；新加的名字表用位置参数之类的新写法时，在 `subset.py` 的书法体规则里补一条。
- **首屏子集**（2026-11-11，分支 feat/deploy，`docs/deploy.md`「包体积」）：标题页那几行字（`src/game/title.ts` 里字符串的字、章节名、`index.html` 里「窗口太小了」和操作提示、ASCII、常用标点，约 200 个字）另裁两份 `*-title.woff2`（各约 40 KB）。打开页面只预载这两份，完整子集（几百 KB）和像素体等标题页出来之后再下（`src/main.ts`）；进局、过场、实验页之前等 `loadFonts()`（完整的界面字体）和 `loadPixelFont()`。两份的 `unicode-range` 互不重叠（完整那份写成「首屏以外的所有码位」），由 `subset.py` 写进 `src/game/fonts.gen.ts`，`src/game/fonts.ts` 拿它写 `@font-face`；浏览器按字挑用哪一份，标题页上的字不在首屏子集里也不会出错，只是首屏会多下完整的那份。**跑完 `subset.py` 要把 `public/fonts/` 下的六份 woff2、`src/game/fonts.gen.ts` 和 `tools/fonts/chars.gen.json` 一起提交。**「其余」那两份不再带首屏的字（unicode-range 互不重叠，首屏的字只从首屏那份取）。
- 字体下完之前就要露面的几行字——`index.html` 里的首次载入画面「封神幸存者」「初次入阵，正在载入」（2026-11-12 起，原来是「载入中」）、手机竖着打开时的转屏提示「请横屏游玩 / 把手机横过来」——不靠字体文件，是内联的楷书轮廓（SVG 路径），用 `.venv/bin/python -I tools/fonts/boot-glyphs.py` 从源字体导出（用法见脚本开头）。改了这几行字要重导一次、贴回 `index.html`。`index.html` 里只预载两份首屏子集（`<link rel="preload">`），地址要和 `src/game/fonts.ts` 的 `@font-face` 一致。
- 三个字体的许可原文在 `public/fonts/LICENSE-*.txt`，随游戏一起发布；致谢页要列出它们。
