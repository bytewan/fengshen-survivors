# 联机中继的镜像（server/relay.mjs，只依赖 ws）。docker-compose.yml 里用；单独构建：
#   docker build -f deploy/relay.Dockerfile -t fengshen-relay .        （在仓库根目录跑，构建上下文是整个仓库，
#                                                                     只拷 deploy/relay.Dockerfile.dockerignore 放行的几个文件）
# 配置全走环境变量（docs/deploy.md「中继」）；默认监听 0.0.0.0:5300，放在反向代理后面，不直接对外。
# 国内拉 npm 慢的话：--build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /deps
ARG NPM_REGISTRY=
COPY package-lock.json ./
# 只装 ws，版本照仓库的 package-lock.json（不装 pixi.js 那些前端的依赖）
RUN WS="$(node -p "require('./package-lock.json').packages['node_modules/ws'].version")" \
 && echo '{"private":true}' > package.json \
 && if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm install --no-audit --no-fund --omit=dev "ws@${WS}" \
 && node -e "require('ws'); console.log('ws', require('ws/package.json').version)"

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    RELAY_PORT=5300 \
    RELAY_HOST=0.0.0.0
COPY --from=deps /deps/node_modules/ws node_modules/ws
COPY server/relay.mjs server/relay.mjs
USER node
EXPOSE 5300
# 健康检查：/health 回 ok（收到 SIGTERM、正在关的时候回 503）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.RELAY_PORT||5300)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# docker stop 发 SIGTERM：中继先告诉房里的人「要关了」，约 1.5 秒后关连接、退出（docker 默认等 10 秒）
STOPSIGNAL SIGTERM
CMD ["node", "server/relay.mjs"]
