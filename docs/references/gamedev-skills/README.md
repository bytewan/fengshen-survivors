# 外部参考：awesome-gamedev-agent-skills（节选）

来源：https://github.com/gamedev-skills/awesome-gamedev-agent-skills （Apache-2.0，许可证见同目录 `LICENSE`），2026-11-09 取自 `main` 分支。

只取了对《封神幸存者：回响》有用的 9 个 `SKILL.md`，原样保存，作为对应里程碑动手前的参考，不是本项目的约定。和 `docs/design.md` 冲突时以设计文档为准。

| 文件 | 用在哪 | 要注意的适配 |
|---|---|---|
| `pixijs-rendering.md` | 全程（渲染层） | 版本正好是 8.22，与本项目一致 |
| `game-feel.md` | M0 手感原型 | 它说命中停顿可以调时间缩放；本项目是房主权威、固定步长，**命中停顿和震屏只能作用在表现层，不能停模拟** |
| `create-game-assets.md` | M0 起的美术流程 | 资产清单、预览图的做法可以借鉴；它的脚本依赖 Python 和 Pillow，本项目用 `tools/` 下的 TypeScript 工具实现同样的检查 |
| `audio-design.md` | 声音 | 示例是 Godot 和 Unity，合成部分要自己写 WebAudio |
| `performance-optimization.md` | M1 起 | 房主手机要跑全部模拟，先定帧预算 |
| `tower-defense.md` | M1、M4 调波次和经济 | — |
| `input-systems.md` | 摇杆、手柄 | — |
| `save-systems.md` | 存档码 | 存档要带版本号，逐版迁移 |
| `prototype-fast.md` | M0 | — |

这个仓库在联机方面只有 Godot 和 Roblox 的引擎专用内容，网页上的房主权威加中继需要自己设计。
