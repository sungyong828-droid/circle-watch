"""배당금 계산기 소개 페이지(/dividend) 공유 이미지 만들기 → assets/og-dividend.png (1200×630)
카카오톡·블로그·SNS에 링크를 붙일 때 보이는 미리보기. 막대는 예시 모양일 뿐 실제 보유 데이터가 아니다.
사용: python tools/og_dividend.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 630
FONTS = 'C:/Windows/Fonts'
bold = lambda s: ImageFont.truetype(f'{FONTS}/NotoSansKR-Bold.ttf', s)
med = lambda s: ImageFont.truetype(f'{FONTS}/NotoSansKR-Medium.ttf', s)
reg = lambda s: ImageFont.truetype(f'{FONTS}/NotoSansKR-Regular.ttf', s)

BG_TOP, BG_BOT = (13, 16, 21), (20, 25, 34)
INK, MUTED, FAINT = (238, 241, 246), (160, 168, 182), (110, 118, 132)
ORANGE, GOLD, PANEL, LINE = (242, 153, 74), (246, 200, 92), (19, 24, 33), (40, 48, 62)

img = Image.new('RGB', (W, H), BG_TOP)
d = ImageDraw.Draw(img)
for y in range(H):  # 세로 그라데이션
    t = y / H
    d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
# 오른쪽 위 은은한 주황 빛
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((760, -260, 1340, 260), fill=(242, 153, 74, 46))
img = Image.alpha_composite(img.convert('RGBA'), glow.filter(ImageFilter.GaussianBlur(90)))
d = ImageDraw.Draw(img)

# 아이콘 + 제목
icon = Image.open(os.path.join(ROOT, 'assets', 'app-icon.png')).convert('RGBA').resize((150, 150), Image.LANCZOS)
mask = Image.new('L', (150, 150), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 149, 149), 34, fill=255)
img.paste(icon, (72, 66), mask)
d.text((252, 62), 'Fire Portfolio', font=bold(30), fill=MUTED)
d.text((250, 96), '미국 주식 배당금 계산기', font=bold(62), fill=INK)
d.text((252, 182), '지금까지 받은 배당 · 원금 회수율 · 월별 배당', font=reg(30), fill=MUTED)

# 왼쪽 패널: 월별 배당 막대(예시 모양) + 원금 회수 진행 막대
px, py, pw, ph = 72, 262, 620, 290
d.rounded_rectangle((px, py, px + pw, py + ph), 18, fill=PANEL, outline=LINE, width=2)
d.text((px + 28, py + 22), '월별 받은 배당', font=med(24), fill=INK)
d.text((px + pw - 28, py + 26), '세후 · 배당락일 기준', font=reg(19), fill=FAINT, anchor='ra')
bars = [0.32, 0.38, 0.35, 0.46, 0.52, 0.49, 0.6, 0.66, 0.63, 0.74, 0.82, 0.93]
bx0, by0, bw, gap, bh = px + 34, py + 210, 36, 11, 136
for i, v in enumerate(bars):
    x = bx0 + i * (bw + gap)
    h = int(bh * v)
    d.rounded_rectangle((x, by0 - h, x + bw, by0), 6, fill=ORANGE if i == len(bars) - 1 else (150, 98, 54))  # 이번 달만 진하게
d.line([(px + 28, by0 + 2), (px + pw - 28, by0 + 2)], fill=LINE, width=2)
# 원금 회수율 막대
d.text((px + 28, by0 + 22), '원금 회수', font=med(21), fill=MUTED)
tx0, tx1, ty = px + 150, px + pw - 30, by0 + 34
d.rounded_rectangle((tx0, ty - 8, tx1, ty + 8), 8, fill=(36, 43, 56))
d.rounded_rectangle((tx0, ty - 8, tx0 + int((tx1 - tx0) * 0.47), ty + 8), 8, fill=GOLD)

# 오른쪽: 기능 칩
chips = ['실제 받은 배당금', '원금 회수율 · YOC', '주배당 · 월배당 ETF', '캡처로 거래 내역 입력', '다음 배당일 · 세후 15%']
cy = py
for c in chips:
    f = bold(27)
    tw = d.textlength(c, font=f)
    d.rounded_rectangle((740, cy, 740 + tw + 44, cy + 50), 25, fill=(28, 34, 46), outline=(56, 66, 84), width=2)
    d.text((762, cy + 25), c, font=f, fill=INK, anchor='lm')
    cy += 60

d.text((72, 590), '무료 · 가입 없음 · 입력값은 내 기기에만', font=reg(26), fill=MUTED, anchor='lm')
d.text((W - 72, 590), 'my-fire-portfolio.pages.dev/dividend', font=reg(26), fill=MUTED, anchor='rm')

out = os.path.join(ROOT, 'assets', 'og-dividend.png')
img.convert('RGB').save(out, optimize=True)
print(out, os.path.getsize(out) // 1024, 'KB')
