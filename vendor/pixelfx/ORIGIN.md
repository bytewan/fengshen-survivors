# pixelfx（第三方库，原样引入）

- 上游：<https://github.com/patch-gg/pixelfx>，提交 `044e12a45dc9cc312cec50ee606dfc98afe5adc2`（2026-11-09），2026-11-10 引入。
- 许可：MIT（见同目录 `LICENSE`）。`NOTICE.md` 里列的上游致谢（Sprite Fusion 的 Hugo Duprez、Hollow Crown，均为 MIT）一并保留。
- 用途：244 个「用代码画的」像素特效 + 一套做特效的方法（起稿 → 渲染 → 看 → 改）。游戏里经 `src/render/pixelfx.ts` 直接在 TypeScript 里用。
- 只拿了 `src/`、`tools/`、`docs/AUTHORING.md`、`docs/CATALOG.md`、`README.md`、`LICENSE`、`NOTICE.md`、`package.json`；没拿演示用的大 GIF、网页画廊（`gallery/` 里的字体不是 MIT）和 CI 配置。
- 上游自带的 skill（`skills/pixelfx/SKILL.md`）不放在这里：官方原版用 `npx skills add patch-gg/pixelfx --skill pixelfx` 装在 `.agents/skills/pixelfx/`，项目自己的规矩在 `.agents/skills/fengshen-pixelfx/`。官方 skill 末尾的「Publish it on Patch」一节（装命令行工具、把游戏公开发布）和 `README.md` 末尾的「Publish your game on Patch」在这个项目里不适用，除非用户自己明确要求。
- 我们加的（更新上游时保留这几样，其余整个替换）：
  - `src/fx/xianxia/`：按修仙风格改造过的特效（上游没有这个分类）。从库里复制一个特效过来改，文件头写清改自哪个、改了什么；import 路径和原作一样，库的工具照常能用。
  - `src/core/index.d.ts`：类型声明（游戏用 TypeScript）。
  - 本文件、`.gitignore`（渲染输出 `records/` 不进库）。
- 上游的文件一律不改。
- 工具（在这个目录里跑，只用 Node 自带模块）：`node tools/render.mjs <分类/名字>` 出连拍图到 `records/`；`node tools/list.mjs <关键词>` 查特效；`node tools/check.mjs <分类/名字>` 检查画出界、循环接缝等。

- 本项目保留上游作者与许可；随附说明、包描述和画廊元信息已做项目适配。
