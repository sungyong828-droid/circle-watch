"""한국 상장 종목 목록(코스피·코스닥 + ETF) → assets/krx.json  [[종목코드, 이름, 'KS'|'KQ', 시가총액(억원), 'E'(ETF일 때)], ...]

종목 추가 화면에서 '삼성'처럼 회사명 일부나 '005930' 같은 종목코드로 찾을 때 쓴다(검색은 휴대폰 안에서).
사용: python tools/fetch_krx.py   (상장·폐지가 있으면 가끔 다시 실행)
출처: 한국거래소 KIND 상장법인목록, 시가총액은 네이버 증권(검색 결과를 큰 회사부터 보여 주려고)
"""
import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'}
MARKETS = [('stockMkt', 'KS'), ('kosdaqMkt', 'KQ')]


def market(kind):
    url = f'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType={kind}'
    html = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode('euc-kr', 'replace')
    out = []
    for row in re.findall(r'<tr>(.*?)</tr>', html, re.S)[1:]:
        cells = [re.sub(r'<[^>]+>', '', c).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) >= 3 and re.fullmatch(r'[0-9A-Z]{6}', cells[2]):
            out.append((cells[2], cells[0]))
    return out


def caps():
    out = {}
    for mk in ('KOSPI', 'KOSDAQ'):
        for page in range(1, 40):
            url = f'https://m.stock.naver.com/api/stocks/marketValue/{mk}?page={page}&pageSize=100'
            try:
                j = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode('utf-8'))
            except Exception:
                break
            st = j.get('stocks') or []
            for x in st:
                try:
                    out[x['itemCode']] = int(str(x.get('marketValue') or '0').replace(',', ''))
                except ValueError:
                    pass
            if len(st) < 100:
                break
    return out


def etfs():
    """상장 ETF(네이버 증권 ETF 목록) — 모두 유가증권시장(.KS)에서 거래"""
    raw = urllib.request.urlopen(urllib.request.Request('https://finance.naver.com/api/sise/etfItemList.nhn', headers=UA), timeout=60).read()
    try:
        j = json.loads(raw.decode('euc-kr'))
    except Exception:
        j = json.loads(raw.decode('utf-8'))
    return [[x['itemcode'], x['itemname'], 'KS', int(x.get('marketSum') or 0), 'E'] for x in j['result']['etfItemList'] if re.fullmatch(r'[0-9A-Z]{6}', x.get('itemcode', ''))]


def load():
    cap = caps()
    rows = []
    for kind, suf in MARKETS:
        rows += [[code, name, suf, cap.get(code, 0)] for code, name in market(kind)]
    have = {r[0] for r in rows}
    rows += [r for r in etfs() if r[0] not in have]
    rows.sort(key=lambda r: r[0])
    return rows


if __name__ == '__main__':
    rows = load()
    path = os.path.join(ROOT, 'assets', 'krx.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
    etf = sum(1 for r in rows if len(r) > 4)
    ks = sum(1 for r in rows if r[2] == 'KS' and len(r) < 5)
    print(f'코스피 {ks} + 코스닥 {len(rows) - ks - etf} + ETF {etf} = {len(rows)} → assets/krx.json ({os.path.getsize(path) // 1024} KB)')
