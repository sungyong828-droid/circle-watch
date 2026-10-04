"""종목 로고 받기: S&P 500 + 자주 찾는 종목·ETF → assets/logos/t/{티커}.png (96px), 목록 assets/logo-list.js

사이트가 외부 이미지를 직접 불러오지 않도록(보안 정책 img-src 'self') 미리 받아 같이 배포한다.
사용: python tools/fetch_logos.py   (S&P 500 구성이 바뀌면 다시 실행)
출처: 종목 목록 github.com/datasets/s-and-p-500-companies, 로고 financialmodelingprep.com/image-stock
"""
import csv
import io
import os
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


def tickers():
    req = urllib.request.Request('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv', headers=UA)
    rows = csv.DictReader(io.StringIO(urllib.request.urlopen(req, timeout=30).read().decode('utf-8')))
    sp = [r['Symbol'].strip().upper() for r in rows if r.get('Symbol')]
    return list(dict.fromkeys(sp + EXTRA)), len(sp)


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


def fetch(sym):
    dst = os.path.join(OUT, sym + '.png')
    if os.path.exists(dst) and '--force' not in sys.argv:
        return sym, True
    try:
        req = urllib.request.Request(f'https://financialmodelingprep.com/image-stock/{sym}.png', headers=UA)
        data = urllib.request.urlopen(req, timeout=20).read()
        im = Image.open(io.BytesIO(data)).convert('RGBA')
        if im.width < 16 or im.getbbox() is None:
            return sym, False
        im.thumbnail((96, 96), Image.LANCZOS)
        canvas = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
        canvas.alpha_composite(im, ((96 - im.width) // 2, (96 - im.height) // 2))
        fix_light(canvas).save(dst, optimize=True)
        return sym, True
    except Exception:
        return sym, False


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    if '--fix-light' in sys.argv:  # 이미 받은 로고 중 밝은 것만 다시 처리
        n = 0
        for f in os.listdir(OUT):
            im = Image.open(os.path.join(OUT, f)).convert('RGBA'); fx = fix_light(im)
            if fx is not im: fx.save(os.path.join(OUT, f), optimize=True); n += 1
        print('fixed', n); sys.exit()
    syms, n_sp = tickers()
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(fetch, syms))
    ok = sorted(s for s, good in res if good)
    miss = [s for s, good in res if not good]
    with open(os.path.join(ROOT, 'assets', 'logo-list.js'), 'w', encoding='utf-8') as f:
        f.write('// 자동 생성(tools/fetch_logos.py) — assets/logos/t/ 에 로고가 있는 티커\n')
        f.write(f"window.__LOGOS = '{' '.join(ok)}';\n")
    size = sum(os.path.getsize(os.path.join(OUT, s + '.png')) for s in ok)
    print(f'S&P 500 {n_sp} + extra {len(EXTRA)} → logos {len(ok)} ({size // 1024} KB), missing {len(miss)}: {" ".join(miss[:40])}')
