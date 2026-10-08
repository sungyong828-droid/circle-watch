"""종목 로고 받기 → assets/logos/t/{티커}.png (64px, 색 수를 줄여 가볍게), 목록 assets/logo-list.js

받는 범위: S&P 500 + 자주 찾는 종목 + 미국 상장 주식(시가총액 1억 달러 이상) + 미국 ETF 전체 + 한국 코스피·코스닥 전 종목
(한국은 assets/krx.json — 먼저 python tools/fetch_krx.py). 한국 로고 파일 이름은 005930.KS.png 처럼 종목코드.

사이트가 외부 이미지를 직접 불러오지 않도록(보안 정책 img-src 'self') 미리 받아 같이 배포한다.
사용: python tools/fetch_logos.py           (새 종목만 받기)
      python tools/fetch_logos.py --force   (모두 다시 받기)
출처: 종목 목록 github.com/datasets/s-and-p-500-companies · Nasdaq 스크리너 · 한국거래소, 로고 financialmodelingprep.com/image-stock
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'logos', 't')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'}
# S&P 500 밖이지만 자주 찾는 종목·ETF
EXTRA = """MSTR HOOD SOFI RKLB ACHR IONQ RGTI QBTS ARM TSM ASML BABA NIO SHOP SNOW NET MELI SE U RIVN LCID AFRM UPST
DKNG RBLX PINS SNAP SPOT ZM DOCU ROKU TTD MDB TEAM OKTA ZS HUBS CVNA OPEN CHWY ETSY W PATH AI SOUN BBAI
HIMS OSCR CELH ELF ONON BIRK CAVA DUOL APP RDDT ASTS LUNR JOBY CRCL TEM GH CRCA NBIS CRWV CORZ IREN MARA RIOT CLSK
SPY QQQ VOO VTI IVV DIA IWM SCHD JEPI JEPQ VYM DGRO HDV SPYD DIVO QYLD XYLD RYLD MSTY ULTY CONY NVDY TSLY YMAX
TQQQ SQQQ SOXL SOXX SMH ARKK XLK XLF XLE XLV GLD SLV TLT BND O""".split()


SIZE = 64
SYM_OK = re.compile(r'^[A-Z]{1,5}(\.[A-Z])?$')


def get_json(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode('utf-8'))


def tickers():
    req = urllib.request.Request('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv', headers=UA)
    rows = csv.DictReader(io.StringIO(urllib.request.urlopen(req, timeout=30).read().decode('utf-8')))
    sp = [r['Symbol'].strip().upper() for r in rows if r.get('Symbol')]
    us = []
    try:  # 미국 상장 주식(시가총액 1억 달러 이상)
        for r in get_json('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true')['data']['rows']:
            try:
                cap = float(r.get('marketCap') or 0)
            except ValueError:
                cap = 0
            sym = str(r.get('symbol') or '').strip().upper().replace('/', '.')
            if cap >= 1e8 and SYM_OK.match(sym):
                us.append(sym)
    except Exception as e:
        print('nasdaq stocks 실패', e)
    etf = []
    try:  # 미국 ETF
        d = get_json('https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=10000&download=true')['data']
        for r in (d.get('data') or d)['rows']:
            sym = str(r.get('symbol') or '').strip().upper()
            if SYM_OK.match(sym):
                etf.append(sym)
    except Exception as e:
        print('nasdaq etf 실패', e)
    kr = []
    kpath = os.path.join(ROOT, 'assets', 'krx.json')
    if os.path.exists(kpath):  # 한국: 005930.KS / 247540.KQ
        kr = [f'{c}.{m}' for c, _n, m, *_ in json.load(open(kpath, encoding='utf-8'))]
    return list(dict.fromkeys(sp + EXTRA + us + etf + kr)), {'S&P500': len(sp), 'US': len(us), 'ETF': len(etf), 'KR': len(kr)}


def fix_light(im):
    """흰색·아주 밝은 로고(투명 배경)는 화면의 흰 바탕에서 안 보이므로 어두운 배경을 깐다."""
    px = [p for p in im.getdata() if p[3] > 60]
    if not px:
        return im
    lum = sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b, _ in px) / len(px)
    transparent = sum(1 for p in im.getdata() if p[3] < 20) / (im.width * im.height)
    if lum < 205 or transparent < 0.15:
        return im
    bg = Image.new('RGBA', im.size, (28, 36, 50, 255))
    bg.alpha_composite(im)
    return bg


# 윈도우에서 파일 이름으로 쓸 수 없는 이름(CON·PRN·AUX·NUL·COM1… — 티커 CON 등)은 건너뛴다
RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *{f'COM{i}' for i in range(1, 10)}, *{f'LPT{i}' for i in range(1, 10)}}


def fetch(sym):
    dst = os.path.join(OUT, sym + '.png')
    if sym.split('.')[0] in RESERVED:
        return sym, False
    if os.path.exists(dst) and '--force' not in sys.argv:
        return sym, True
    urls = [f'https://financialmodelingprep.com/image-stock/{sym}.png']
    if re.match(r'^[0-9A-Z]{6}\.(KS|KQ)$', sym):  # 한국 종목: 없으면 네이버 증권 로고
        urls.append(f'https://ssl.pstatic.net/imgstock/fn/real/logo/png/stock/Stock{sym[:6]}.png')
    for url in urls:
        got = fetch_one(sym, url, dst)
        if got:
            return sym, True
    return sym, False


def fetch_one(sym, url, dst):
    try:
        req = urllib.request.Request(url, headers=UA)
        data = urllib.request.urlopen(req, timeout=20).read()
        im = Image.open(io.BytesIO(data)).convert('RGBA')
        if im.width < 16 or im.getbbox() is None:
            return False
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
        canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        canvas.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
        # 64색으로 줄여 파일 크기를 1/3 정도로(작게 보이는 아이콘이라 차이가 거의 없다)
        fix_light(canvas).quantize(colors=64, method=Image.Quantize.FASTOCTREE).save(dst, optimize=True)
        return True
    except Exception:
        return False


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    if '--fix-light' in sys.argv:  # 이미 받은 로고 중 밝은 것만 다시 처리
        n = 0
        for f in os.listdir(OUT):
            im = Image.open(os.path.join(OUT, f)).convert('RGBA'); fx = fix_light(im)
            if fx is not im: fx.save(os.path.join(OUT, f), optimize=True); n += 1
        print('fixed', n); sys.exit()
    syms, counts = tickers()
    print('후보', len(syms), counts, flush=True)
    with ThreadPoolExecutor(16) as ex:
        res = list(ex.map(fetch, syms))
    ok = sorted(s for s, good in res if good)
    miss = [s for s, good in res if not good]
    with open(os.path.join(ROOT, 'assets', 'logo-list.js'), 'w', encoding='utf-8') as f:
        f.write('// 자동 생성(tools/fetch_logos.py) — assets/logos/t/ 에 로고가 있는 티커\n')
        f.write(f"window.__LOGOS = '{' '.join(ok)}';\n")
    size = sum(os.path.getsize(os.path.join(OUT, s + '.png')) for s in ok)
    print(f'{counts} + extra {len(EXTRA)} → logos {len(ok)} ({size // 1024} KB), missing {len(miss)}')
