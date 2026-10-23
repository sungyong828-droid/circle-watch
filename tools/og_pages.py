"""공개 페이지별 공유 이미지(카카오톡·SNS 링크 미리보기, 1200×630) → assets/og-<slug>.png
매일 바뀌는 숫자는 넣지 않는다(이미지는 캐시돼 오래 남으므로, 틀린 숫자가 보이지 않게 기능·주제만).
사용: python tools/og_pages.py
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
INK, MUTED = (238, 241, 246), (160, 168, 182)

# slug: (색, 작은 제목, 큰 제목(줄바꿈 \n), 한 줄 설명, 칩 목록)
PAGES = {
    'etf-tax': ((110, 168, 255), '미국 ETF 세금 비교 계산기', '어디서 사야\n세금이 적을까?', '같은 S&P500, 계좌마다 남는 돈이 달라요',
                ['미국 직투 (VOO)', '국내 상장 ETF', 'ISA 계좌', '연금저축 세액공제']),
    'grow': ((167, 139, 250), '적립식 배당 시뮬레이터', '매달 사 모으면\n월배당은 얼마?', '여러 종목을 비중대로 · 실제 배당 성장률로',
             ['SCHD · JEPI · 리얼티인컴', '배당 재투자', '월배당 100만원 시점', '이미지로 공유']),
    'dividend-etf': ((79, 209, 165), '배당 ETF 비교', 'SCHD vs JEPI vs\nTIGER 미국배당', '배당률 · 배당 성장 · 1천만원이면 월배당',
                     ['미국 배당 성장 ETF', '커버드콜 월배당', '국내 상장 미국배당', '매일 갱신']),
    'calendar': ((245, 192, 78), '이번 주 경제 일정', 'CPI · FOMC ·\n고용보고서', '주가를 움직이는 발표를 한국 시간으로',
                 ['한국 시간 정리', '발표 값 함께', '지표 쉬운 설명', '내 종목 실적·배당일']),
    'money-flow': ((255, 107, 122), '증시 빚투 지표', '지금 시장\n과열일까?', '신용융자 · 고객예탁금 · 미국 신용잔고',
                   ['빚투 과열 신호', '대기 자금 흐름', '미국 신용잔고 1997~', '쉬운 차트 설명']),
    'bonus': ((110, 168, 255), '성과급 계산기', '통장에 실제로\n얼마 들어올까?', '삼성전자 OPI·TAI · SK하이닉스 PS·PI',
              ['세금·4대보험 공제', '세후 실수령액', '배당 포트폴리오로 연결', '무료 · 가입 없음']),
    'fire': ((255, 138, 101), '퇴사 계산기', '퇴사까지\n얼마나 남았을까?', '보유 주식으로 목표 금액까지 진행률',
             ['목표 진행률', '예상 달성일', '내 수익률 vs 시장', '배당으로 생활비']),
}


def make(slug, accent, small, big, line, chips):
    img = Image.new('RGB', (W, H), BG_TOP)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((760, -260, 1340, 260), fill=accent + (50,))
    img = Image.alpha_composite(img.convert('RGBA'), glow.filter(ImageFilter.GaussianBlur(90)))
    d = ImageDraw.Draw(img)
    icon = Image.open(os.path.join(ROOT, 'assets', 'app-icon.png')).convert('RGBA').resize((92, 92), Image.LANCZOS)
    mask = Image.new('L', (92, 92), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 91, 91), 22, fill=255)
    img.paste(icon, (72, 64), mask)
    d.text((184, 70), 'Fire Portfolio', font=bold(28), fill=MUTED)
    d.text((184, 106), small, font=bold(34), fill=accent)
    y = 196
    for ln in big.split('\n'):
        d.text((72, y), ln, font=bold(70), fill=INK)
        y += 88
    d.text((74, y + 14), line, font=reg(29), fill=MUTED)
    cy = 214
    for c in chips:
        f = bold(26)
        tw = d.textlength(c, font=f)
        x0 = W - 72 - tw - 48
        d.rounded_rectangle((x0, cy, W - 72, cy + 52), 26, fill=(28, 34, 46), outline=tuple(int(v * 0.55) for v in accent), width=2)
        d.text((x0 + 24, cy + 26), c, font=f, fill=INK, anchor='lm')
        cy += 64
    d.text((72, 586), '무료 · 가입 없음', font=reg(25), fill=MUTED, anchor='lm')
    d.text((W - 72, 586), f'my-fire-portfolio.pages.dev/{slug}', font=reg(25), fill=MUTED, anchor='rm')
    out = os.path.join(ROOT, 'assets', f'og-{slug}.png')
    img.convert('RGB').save(out, optimize=True)
    print(out, os.path.getsize(out) // 1024, 'KB')


for slug, args in PAGES.items():
    make(slug, *args)
