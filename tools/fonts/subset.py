"""字体子集化：按源码里会显示出来的字，把三套字体各裁成只含这些字的 woff2（docs/fonts.md「子集怎么裁」）。

2026-11-12 瘦身（用户：「开始瘦身」）：原来三套都按「src/ 下所有 .ts 里出现过的字」裁（连注释里的字也算），像素体干脆整份发布。现在分开收：
- 正文体（霞鹜文楷 Medium，完整 TTF 约 25 MB）→ lxgw-wenkai-medium-subset.woff2：字符串里的字（跳过注释；src/ 下的 .ts 不含测试、
  server/ 下中继发给大厅的话、index.html 的界面字、致谢文本），即一切可能显示出来的字。正文体是后备字体，缺了字就是方块，所以宁多勿少。
- 像素体（缝合像素 12px 简体）→ fusion-pixel-12-zh_hans.woff2：同正文体那一套字（画布里的字从哪张表来都有可能）。原来整份 685 KB。
- 书法体（马善政楷书）→ ma-shan-zheng-subset.woff2：只收用书法体（var(--font-title)）显示的字——名字表（name / title / who 字段、
  一行一个的「键: '短名'」、短名数组）、墨痕按钮的字（inkButton('…')）、<h1> <h2> <b> 里的短字，以及用到书法体的界面文件里四个字以内、
  不带句读的短字符串。没收到的字落到正文体（字体栈是 书法体 → 文楷），不会是方块；名字表由 src/game/fonts-cover.test.ts 兜底核对。
- 设置里「字体主题：书法」（正文也用书法体）要书法体的全套字：另裁 ma-shan-zheng-full.woff2（字体名 FS Brush Full），只在选了这个主题时才下。
- 首屏子集（2026-11-11，docs/deploy.md「包体积」）：标题页那几行字（src/game/title.ts 里字符串的字、章节名、index.html 里「窗口太小了」和操作提示、
  ASCII 和常用标点）另裁两份很小的 *-title.woff2，打开页面先只下它们；其余的等标题页出来之后再下。
  首屏和其余两份的 unicode-range 互不重叠（其余那份写成「首屏以外的所有字」），写进 src/game/fonts.gen.ts，src/game/fonts.ts 拿它写 @font-face。
- 三套各收了哪些字写进 tools/fonts/chars.gen.json（测试读它核对）。
用法：.venv/bin/python -I tools/fonts/subset.py   （改了界面文字、加了新字之后重跑一次）
      提交 public/fonts/ 下的六份 woff2 和 src/game/fonts.gen.ts、tools/fonts/chars.gen.json。
源字体放在 scratch/downloads/{fusion,mashan,wenkai}/（不进 git；来源见 docs/fonts.md）。
"""
import json
import pathlib
import re

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'scratch' / 'downloads'
OUT = ROOT / 'public' / 'fonts'
GEN = ROOT / 'src' / 'game' / 'fonts.gen.ts'
ASCII = {chr(c) for c in range(0x20, 0x7F)}
PUNCT = set('「」『』·、，。！？：；（）——…《》〈〉“”‘’～·×◆◇○●')

def ts_strings(src: str) -> str:
    """TS 源码里字符串（'…'、"…"、`…`）的内容，跳过注释。模板字符串里的 ${…} 也算进去（里面的字多半也是字符串）。"""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif c in '\'"`':
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 1
                elif c != '`' and src[j] == '\n':
                    break
                j += 1
            out.append(src[i + 1 : j])
            i = j + 1
        else:
            i += 1
    return ''.join(out)


def html_title_texts(src: str) -> str:
    """index.html 里标题页出来时就要排版的字：电脑上窗口太小时的「窗口太小了 / 把窗口拉大一些」（#rotate .d），
    和底部的操作提示（#hint：进了局才亮，但平时是透明的、一直在排版，浏览器照样会为它下字体）。
    载入提示、手机的转屏提示是内联的字形轮廓，不用字体。"""
    out = []
    for pat in (r'<div class="d">(.*?)</div>', r'<div id="hint">(.*?)</div>'):
        m = re.search(pat, src, flags=re.S)
        if m:
            out.append(re.sub(r'<[^>]+>', '', m.group(1)))
    return ''.join(out)


# ---------- 三套字体各收哪些字 ----------
SENT = set('，。；：！？、')


def strings_of(src: str) -> list[str]:
    """TS 源码里的字符串，跳过注释；样式字符串里的 /* 注释 */ 也去掉。"""
    return [re.sub(r'/\*.*?\*/', '', x, flags=re.S) for x in ts_string_list(src)]


def ts_string_list(src: str) -> list[str]:
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif c in '\'"`':
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 1
                elif c != '`' and src[j] == '\n':
                    break
                j += 1
            out.append(src[i + 1 : j])
            i = j + 1
        else:
            i += 1
    return out


wide = lambda s: {ch for ch in s if ord(ch) > 0x7F}
han = lambda s: [ch for ch in s if '\u4e00' <= ch <= '\u9fff']
SOURCES = [p for p in (ROOT / 'src').rglob('*.ts') if not p.name.endswith('.test.ts')]

# 正文体 / 像素体：一切可能显示出来的字
chars = set(ASCII) | PUNCT
for p in SOURCES:
    for x in strings_of(p.read_text(encoding='utf-8')):
        chars |= wide(x)
for p in (ROOT / 'server').glob('*.mjs'):  # 中继发给大厅的话（房间满了之类）
    if not p.name.endswith('.test.mjs'):
        for x in strings_of(p.read_text(encoding='utf-8')):
            chars |= wide(x)
chars |= wide(re.sub(r'<svg.*?</svg>', '', (ROOT / 'index.html').read_text(encoding='utf-8'), flags=re.S))  # 内联的字形轮廓不算
credits = ROOT / 'public' / 'audio' / 'CREDITS.txt'
if credits.exists():
    chars |= wide(credits.read_text(encoding='utf-8'))
text = ''.join(sorted(chars))

# 书法体：用书法体显示的字
NAME_FIELD = re.compile(r"""\b(name|title|who|nm|realm|short)\s*:\s*(['"`])([^'"`\n]{1,12})\2""")
INK_LABEL = re.compile(r"""inkButton\(\s*(['"`])([^'"`\n]{1,12})\1""")
HEADING = re.compile(r"""<(h1|h2|b)[^>]*>([^<$]{1,12})</\1>""")
RECORD_VALUE = re.compile(r"""^\s*(?:'[^']*'|[\w$]+)\s*:\s*'([^'\n]{1,8})',?\s*(?://.*)?$""", re.M)
POS_NAME = re.compile(r"""\b\w+\(\s*(?:'[^'\n]*'|\d+),\s*'([^'\n]{1,6})'""")  # 用位置参数写名字的表：L(id, 名字, …)、jie(2, '二劫渡尽', …)、boss('nezha', '业火熄灭', …)
INLINE_VALUE = re.compile(r"""[{,]\s*\w+:\s*'([^'\n]{1,4})'""")  # 写在一行里的短名表 { root: '根', shen: '身', … }
SHORT_ARRAY = re.compile(r"""=\s*\[((?:\s*'[^'\n]{1,6}',?)+)\s*\]""")
BRUSH_FILES = re.compile(r'FONT_TITLE|FONT_BRUSH|font-title|font-brush')
brush_chars = set(ASCII) | PUNCT
for p in SOURCES:
    src = p.read_text(encoding='utf-8')
    for rx, g in ((NAME_FIELD, 3), (INK_LABEL, 2), (HEADING, 2), (RECORD_VALUE, 1), (SHORT_ARRAY, 1), (POS_NAME, 1), (INLINE_VALUE, 1)):
        for m in rx.finditer(src):
            brush_chars |= wide(m.group(g)) - SENT
    if BRUSH_FILES.search(src):  # 用到书法体的界面文件：四个字以内、不带句读的短字符串（按钮、标签、印上的字）
        for x in strings_of(src):
            for seg in re.split(r'\$\{[^}]*\}|<[^>]*>', x):
                w = wide(seg)
                if w and len(han(seg)) <= 4 and not (w & SENT):
                    brush_chars |= w
brush_chars &= chars


# ---------- 首屏子集的字 ----------
title_chars = set(ASCII) | PUNCT
title_chars.update(c for c in re.sub(r'/\*.*?\*/', '', ts_strings((ROOT / 'src' / 'game' / 'title.ts').read_text(encoding='utf-8')), flags=re.S) if ord(c) > 0x7F)  # 样式字符串里的 /* 注释 */ 不算
m = re.search(r'export const CHAPTER_NAME = \[([^\]]*)\]', (ROOT / 'src' / 'sim' / 'catalog.ts').read_text(encoding='utf-8'))
if m:
    title_chars.update(c for c in m.group(1) if ord(c) > 0x7F)  # 标题页底下那行战绩里的章节名
title_chars.update('分秒')  # 战绩里的「最快通关 12 分 34 秒」（profile.ts 的 formatTime）
title_chars.update(c for c in html_title_texts((ROOT / 'index.html').read_text(encoding='utf-8')) if ord(c) > 0x7F)
title_chars &= chars
brush_chars |= title_chars
brush_text = ''.join(sorted(brush_chars))
title_text = ''.join(sorted(title_chars))


def ranges(cps: list[int]) -> list[tuple[int, int]]:
    out = []
    for cp in sorted(cps):
        if out and cp == out[-1][1] + 1:
            out[-1] = (out[-1][0], cp)
        else:
            out.append((cp, cp))
    return out


def css_range(rs: list[tuple[int, int]]) -> str:
    return ', '.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in rs)


title_rs = ranges([ord(c) for c in title_chars])
# 完整那份：首屏以外的所有码位（和首屏那份互不重叠：document.fonts.load('…', '封神') 才只会去下首屏那份）
rest_rs = []
prev = 0
for a, b in title_rs:
    if a > prev:
        rest_rs.append((prev, a - 1))
    prev = b + 1
if prev <= 0x10FFFF:
    rest_rs.append((prev, 0x10FFFF))
probe = next(c for c in sorted(brush_chars - title_chars) if 0x4E00 <= ord(c) <= 0x9FFF)  # 两套的「其余」那份里都有的字

OUT.mkdir(parents=True, exist_ok=True)


def cut(src: pathlib.Path, dst: pathlib.Path, what: str) -> None:
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    font = subset.load_font(str(src), opts)
    s = subset.Subsetter(opts)
    s.populate(text=what)
    s.subset(font)
    subset.save_font(font, str(dst), opts)


MASHAN = SRC / 'mashan' / 'MaShanZheng-Regular.ttf'
WENKAI = SRC / 'wenkai' / 'LXGWWenKai-Medium.ttf'
# 「其余」那两份不必再带首屏的字（unicode-range 互不重叠，首屏的字只从首屏那份取）
rest_of = lambda cs: ''.join(sorted(set(cs) - title_chars))
cut(MASHAN, OUT / 'ma-shan-zheng-subset.woff2', rest_of(brush_text))
cut(MASHAN, OUT / 'ma-shan-zheng-title.woff2', title_text)
cut(MASHAN, OUT / 'ma-shan-zheng-full.woff2', text)  # 字体主题「书法」才用
cut(WENKAI, OUT / 'lxgw-wenkai-medium-subset.woff2', rest_of(text))
cut(WENKAI, OUT / 'lxgw-wenkai-medium-title.woff2', title_text)
cut(SRC / 'fusion' / 'fusion-pixel-12px-proportional-zh_hans.otf.woff2', OUT / 'fusion-pixel-12-zh_hans.woff2', text)
(ROOT / 'tools' / 'fonts' / 'chars.gen.json').write_text(
    json.dumps({'_': '由 tools/fonts/subset.py 生成，不要手改', 'text': text, 'brush': brush_text, 'title': title_text}, ensure_ascii=False, indent=0) + '\n', encoding='utf-8'
)

GEN.write_text(
    '// 由 tools/fonts/subset.py 生成（改了界面文字、加了新字之后重跑），不要手改。\n'
    '// 标题页那几行字另裁了很小的「首屏」子集（public/fonts/*-title.woff2）：打开页面先只下它们，完整的子集等标题页出来之后再下（src/game/fonts.ts）。\n'
    f'/** 首屏子集里的字（CSS unicode-range，{len(title_chars)} 个字）。 */\n'
    f"export const TITLE_RANGE = '{css_range(title_rs)}';\n"
    '/** 完整子集的 unicode-range：首屏以外的所有码位（两份互不重叠）。 */\n'
    f"export const REST_RANGE = '{css_range(rest_rs)}';\n"
    '/** 完整子集里有、首屏子集里没有的一个字：document.fonts.load 用它把完整子集下下来。 */\n'
    f"export const FULL_PROBE = '{probe}';\n",
    encoding='utf-8',
)
print(f'{len(chars)} 个字（书法体 {len(brush_chars)} 个，首屏 {len(title_chars)} 个）；', ', '.join(f'{f.name} {f.stat().st_size // 1024} KB' for f in sorted(OUT.glob('*.woff2'))), f'；{GEN.relative_to(ROOT)}')
