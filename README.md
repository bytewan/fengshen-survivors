# 封神幸存者：回响

封神题材的网页合作幸存者游戏，支持单人和 1–4 人联机，电脑、手机均可通过浏览器游玩。美术由像素网格、程序绘制和代码动画生成。

## 在线游玩

[国内 COS 入口](https://agent-runtime.bigmodel.cn/fengshen-survivors/) · [GitHub Pages 入口](https://bytewan.github.io/fengshen-survivors/)。公网联机点「联机」建房，再分享房间链接，不要求同一个 Wi-Fi。测试中继的网络可达性会影响联机，单人游戏不依赖中继。

## 局域网游玩

所有人打开在线游戏。房主点「联机」→「局域网」→「建房」，分享链接或二维码；其他玩家打开并准备，房主开始。双方都只需要浏览器，游戏数据通过局域网直连。设备需在能互相访问的同一网络，建房服务仍需可达。

也可以在没有可用建房服务时运行独立内网程序。房主电脑安装 Node.js 24 或更新版本，下载源码，在项目目录执行：

```sh
npm ci
npm run lan
```

打开终端打印的内网网址，建房后分享链接或二维码。其他玩家只需要浏览器，设备需在能够互相访问的局域网中。房主保持电脑和程序运行，Ctrl+C 结束。

[端口配置与连接排障](docs/lan.md)

## 开发

```sh
npm run dev
npm run relay
```

类型检查：`npm run typecheck`；测试：`npm test`；构建：`npm run build`。

[开发说明](DEVELOPMENT.md) · [联机实现与验证记录](docs/netcode.md)
