"""首屏用的字形：把几个字从书法体（马善政楷书）或正文体（霞鹜文楷）里导成 SVG 路径，直接写进 index.html。

载入提示、手机竖着拿时的转屏提示出现在字体文件下完之前（转屏提示盖在载入提示上面），所以不能靠 @font-face——
把这几个字的轮廓内联成 SVG，任何设备上都是同一副楷书，也不用等字体。改了提示文字后重跑，把输出贴进 index.html。
用法：.venv/bin/python -I tools/fonts/boot-glyphs.py [--font brush|text] [--gap 字距（em）] [--scale 缩放] [文字，默认「载入中」]
  首次载入画面（index.html 的 #boot）：
    封神幸存者：           --font brush --gap .06
    初次入阵，正在载入：   --font text --gap .1 --scale .1（显示只有十几像素，坐标再缩短一位）
  请横屏游玩：     --font brush --gap .3
  把手机横过来：   --font text --gap .12
源字体放在 scratch/downloads/{mashan,wenkai}/（不进 git；来源见 docs/fonts.md）。
"""
import argparse
import pathlib
import re
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONTS = {
    'brush': ROOT / 'scratch' / 'downloads' / 'mashan' / 'MaShanZheng-Regular.ttf',
    'text': ROOT / 'scratch' / 'downloads' / 'wenkai' / 'LXGWWenKai-Medium.ttf',
}
SCALE_DEFAULT = 0.25  # 字体的 1000 单位缩到 250：坐标短一位，index.html 小一些；显示出来只有几十像素，看不出差别

ap = argparse.ArgumentParser()
ap.add_argument('--font', choices=FONTS, default='brush')
ap.add_argument('--gap', type=float, default=0.24, help='字距，em 的几分之几')
ap.add_argument('--scale', type=float, default=SCALE_DEFAULT, help='字体单位缩到几分之几（越小坐标越短）')
ap.add_argument('text', nargs='?', default='载入中')
a = ap.parse_args()
SCALE = a.scale

font = TTFont(str(FONTS[a.font]), lazy=True)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm
ascent = font['OS/2'].sTypoAscender  # 汉字的字身框是 -120..880：基线放在 880，整个字身框就是 SVG 的高
gap = a.gap * upm * SCALE

paths = []
x = 0.0
for ch in a.text:
    name = cmap[ord(ch)]
    pen = SVGPathPen(glyphs, ntos=lambda v: str(int(round(v))))
    # y 轴朝下，基线放在 ascent 处
    glyphs[name].draw(TransformPen(pen, (SCALE, 0, 0, -SCALE, x, ascent * SCALE)))
    paths.append(pen.getCommands())
    x += glyphs[name].width * SCALE + gap
width = int(round(x - gap))
height = int(round(upm * SCALE))
d = re.sub(r'\s+', ' ', ''.join(paths)).strip()
print(f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{a.text}"><path d="{d}"/></svg>')
print(f'{len(d)} 字节的路径', file=sys.stderr)
