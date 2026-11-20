# GitHub Pages 与 Java 中继

游戏前端由 GitHub Pages 托管，中继集成在现有 platform-agent-biz 的 Java 服务内，由平台集群运行。游戏计算在房主浏览器，中继只管理房间和转发消息。

## 前端发布

1. GitHub 账号为 `bytewan`，仓库名为 `fengshen-survivors`，默认分支为 main。工作流自动适配仓库路径。
2. 在 Settings → Pages 中将 Source 设为 GitHub Actions。
3. 在 Settings → Secrets and variables → Actions → Variables 中设置 VITE_RELAY_URL，拟填写 `wss://agent-runtime.bigmodel.cn/v1/agents/fengshen/relay`（需先完成入口路由并验证）。这是公开地址，不要填写密钥。
4. 仓库路径自动计算。独立域名位于根路径时，将 GAME_BASE_PATH 设为 `/`；其他自定义路径必须以 `/` 开始和结束。
5. 执行 Publish game 工作流。它安装依赖、运行测试、构建前端，再发布 dist。

已统一字体、音频、致谢和图标路径；manifest 的启动地址、scope 和图标相对于自身位置解析。分享房间链接保留仓库路径和中继覆盖参数。

## 本地验证

```sh
GAME_BASE_PATH=/fengshen-survivors/ VITE_RELAY_URL=wss://agent-runtime.bigmodel.cn/v1/agents/fengshen/relay npm run build
GAME_BASE_PATH=/fengshen-survivors/ node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5181 --strictPort
```

打开 `http://127.0.0.1:5181/fengshen-survivors/`。本地中继试玩可加 `?relay=ws://127.0.0.1:5300/fengshen/relay`，该覆盖只适用于 HTTP 页面。公网 HTTPS 页面只接受 wss。

## 后端

Platform Agent 仓库中的 `platform-agent-biz/src/main/java/com/platform/agent/fengshen` 保存 Java 中继，`deploy/fengshen-java` 保存 Nacos 配置和网关接入说明。中继使用现有 Java 进程、镜像与 9203 端口，不需要独立 Node 服务。后台公网地址必须使用实际服务域名，GitLab 仓库地址不是服务入口。

中继来源白名单填写 GitHub Pages 的 origin（本次为 `https://bytewan.github.io`），不包含仓库路径；使用独立域名时填写该域名的 origin。

Java 平台保留五个副本，Redis 保存房间元数据并限制总房间和连接数，游戏数据直接在副本间转发。初始目标为 100 房间、400 玩家连接。重启会断开该实例上的连接，前端可重连恢复身份；房主迁移按现有客户端存档重开本波，不保证发布期间对局无缝继续。

## 发布范围

公开游戏源码、必要资源和素材许可。构建产物由工作流生成，不提交 node_modules、环境配置、密钥、本机备份或临时素材。第三方素材的作者和许可证保持完整。

## 本次入口配置

Pages 地址为 `https://bytewan.github.io/fengshen-survivors/`。用户给出的后端入口是 `agent-runtime.bigmodel.cn/v1/agents`；游戏使用独立子路径 `/v1/agents/fengshen/relay`，需要在网关中把该子路径及其 /info 请求转给现有 Java 服务的游戏中继，保留路径并支持 WebSocket Upgrade。现有 `/v1/agents/**` 到 Java 平台的路由继续使用。

该入口尚未完成公网联机验证。前端发布由 GitHub Actions 执行，后端需由平台部署流程另行发布并启用 Nacos 配置。
