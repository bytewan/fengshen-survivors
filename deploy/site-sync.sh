#!/bin/sh
# 静态页容器起来时跑一次：把镜像里这一版的文件（/app/dist）拷进数据卷（/srv/site），新的盖掉旧的，旧版本的 assets 留着。
#
# 为什么不整个换掉：正在打的玩家，页面还是更新前那一版；局里按需加载的脚本（某件法宝的特效、过场）要从旧版本的文件名下载，
# 删了就 404、特效出不来。assets/ 下的文件名带内容哈希，新旧版本互不覆盖；一版只多几百 KB 到 2 MB，攒很久也不占多少地方
# （要清：docs/deploy.md「更新」）。index.html、manifest、字体、音频这些不带哈希的直接盖成新的。
#
# 用法：site-sync [源目录] [目标目录]；nginx 镜像里放在 /docker-entrypoint.d/，不带参数，用下面的默认值。
set -eu
SRC="${1:-/app/dist}"
DEST="${2:-/srv/site}"
mkdir -p "$DEST"
cp -a "$SRC/." "$DEST/"
echo "site-sync: $(find "$SRC" -type f | wc -l | tr -d ' ') 个文件 → $DEST；assets 里现在共 $(find "$DEST/assets" -type f 2>/dev/null | wc -l | tr -d ' ') 个（含旧版本的）"
