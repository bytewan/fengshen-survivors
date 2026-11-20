# 《封神幸存者：回响》开发指南

封神题材的 2D 合作肉鸽幸存者，支持 1–4 人网页联机。前端发布到 GitHub Pages 和 COS，电脑、手机均可访问。本指南面向项目维护者，也作为 z managed agents 开发任务的项目说明。

## 工程结构

项目使用 TypeScript、PixiJS 和 Vite，开发环境需要 Node.js 24 或更高版本。

- `src/sim`：固定 60 Hz 的确定性模拟；随机数只使用 `w.rng`。
- `src/game`、`src/render`、`src/art`、`src/audio`：交互、画面、美术和音频。
- `src/net`、`server`：客户端联机逻辑与 Node.js 中继。
- `tools`：数值模拟、浏览器验证、截图和性能分析。

最终游戏的像素美术、场景与动画由代码生成，无需生图模型。第三方字体、音频和特效库保留来源、许可与署名。

## 在 z managed agents 中开发

1. 创建独立的云端 Environment，准备 Node.js 和浏览器测试所需的系统依赖。将游戏 GitHub 仓库挂载到会话工作目录，项目依赖通过 `npm ci` 安装。
2. 任务开始时读取本指南、`docs/design.md` 和 `docs/roadmap.md`。Skills 通过平台配置显式绑定，或按仓库路径读取对应 `SKILL.md`，并在任务中明确需要使用的技能。
3. 按模块划分开发与验证任务。子 agent 有独立上下文，但共享会话文件；分工应明确接口和负责的文件。需要隔离改动时，另建 Git worktree，共享目录本身不提供隔离。
4. 画面检查可交给 GLM-5.3-Flash 子 agent。提供实际截图、场景和检查标准；按钮是否响应、联机状态是否一致，仍通过浏览器操作和测试验证。
5. 每阶段记录改动、验证结果与未解决问题，保存代码提交、日志和截图。Outcome 根据明确的验收条件检查交付物，反馈问题后继续修复。发布按已获授权的目标执行。

模型使用当前账号可用的 API ID。模型名称、Environment 和 GitHub 授权在平台中配置，凭证不写入仓库。任务与平台代码分别维护，游戏依赖安装在本项目环境内。

## 常用命令

在仓库根目录执行：

| 目的 | 命令 |
|---|---|
| 安装锁定版本的依赖 | `npm ci` |
| 启动开发服务器 | `npm run dev` |
| 启动本地中继 | `npm run relay` |
| 启动局域网网页与中继 | `npm run lan` |
| 类型检查 | `npm run typecheck` |
| 自动测试 | `npm test` |
| 生产构建 | `npm run build` |
| 预览构建产物 | `npm run serve:build` |
| 数值模拟 | `node tools/balance.ts 20` |
| 点击遮挡检查 | `node tools/click-probe.mjs` |
| 像素特效截图 | `node tools/pixelfx-shot.mjs thunder --port 5180 --at 0.5,0.8,1.2` |
| 联机验证 | `node tools/net-run.mjs`、`node tools/net-migrate.mjs` |
| 性能分析 | `node tools/perf-probe.mjs` |

浏览器验证工具需要运行中的开发服务器；按工具参数指定实际端口。首次使用 Playwright 时准备 Chromium 及系统依赖。无 GPU 的环境可参考截图脚本中的 SwiftShader 启动参数。截图后检查真实画面，不能仅凭文件生成成功判定验证通过。

临时脚本、截图和日志放在被 Git 忽略的 `scratch/`。云端交付时将需要保留的产物另存至任务输出目录；恢复工作目录需要在创建会话时启用平台 checkpoint，Git 提交仍用于版本管理。

## 调试与验收

- `?bot`：自动操作；`?wave=6`：进入第六波前商店并提供调试灵石。
- `?fxlab`、`?enemylab`：特效与敌人实验页。
- `?online`、`?room=ABCD`：进入联机大厅或指定房间。
- `?perf`：显示帧率与各阶段耗时；`?safe=上,右,下,左`：模拟屏幕安全区。
- `window.__feel`：运行时调试入口，具体字段以实现为准。

功能修改验证开始、战斗、商店、下一波和重开；联机修改分别检查房主与队友。画面精致克制、像素对齐，特效应有完整起落，避免遮挡角色和攻击判定。先保证可玩性与流程完整，再结合试玩调整数值。模拟统计不能代替真实试玩。

开发与评审记录使用中文，代码标识符保持原样。主分支为 `main`；提交说明写清改动和验证。推送与发布需要任务授权，运行脚本不代表已获发布授权。

## 文档与 Skills

| 内容 | 位置 |
|---|---|
| 设计结论、需求与修订 | `docs/design.md` |
| 进度与待办 | `docs/roadmap.md` |
| 联机与局域网 | `docs/netcode.md`、`docs/lan.md` |
| 部署与性能 | `docs/deploy.md`、`docs/perf.md` |
| 剧情与评审记录 | `docs/story/`、`docs/reviews/` |
| 字体、音频与许可 | `docs/fonts.md`、`docs/audio.md`、`public/audio/CREDITS.txt` |
| 像素特效接入 | `docs/pixelfx.md` |

项目技能 `.agents/skills/fengshen-pixelfx/SKILL.md` 规定修仙配色、辉光、节奏和 TypeScript 接入方式。使用时同时读取官方 `.agents/skills/pixelfx/SKILL.md`；项目约束优先。

官方 `pixelfx`、`pixijs` 和 `pixijs-*` 技能保存在 `.agents/skills/`，版本见 `skills-lock.json`，按上游版本更新，不直接修改。当前发布目标是 GitHub Pages 和 COS，不使用官方 pixelfx 中的 Patch 发布流程。
