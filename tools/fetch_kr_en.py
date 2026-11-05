"""한국 상장 종목 영어 이름 → assets/krx-en.json  {"005930": "Samsung Electronics", ...}

영어 화면(?lang=en)에서 한국 종목을 '삼성전자' 대신 'Samsung Electronics'로 보여 줄 때 쓴다(영어 화면에서만 받는다).
사용: python tools/fetch_kr_en.py   (fetch_krx.py로 목록을 새로 받은 뒤 함께 실행. 이미 받은 이름은 건너뛴다 — 처음부터 받으려면 --all)
출처: Yahoo Finance 차트 자료의 회사 이름(longName)
"""
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'}
OUT = os.path.join(ROOT, 'assets', 'krx-en.json')
TAIL = re.compile(r',?\s+(Co\.?,?\s*Ltd\.?|Co\.?|Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation|Company|Holdings?\s+Co\.?,?\s*Ltd\.?)$', re.I)


def clean(n):
    n = re.sub(r'\s+', ' ', n or '').strip()
    for _ in range(2):
        n = TAIL.sub('', n).strip().rstrip(',')
    return n


def one(code, mk):
    for i in range(3):
        try:
            url = f'https://query1.finance.yahoo.com/v8/finance/chart/{code}.{mk}?range=1d&interval=1d'
            m = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20))['chart']['result'][0]['meta']
            n = clean(m.get('longName') or '')
            return code, n if n and re.search(r'[A-Za-z]', n) and not re.search(r'[가-힣]', n) else None
        except Exception as e:
            if '404' in str(e):
                return code, None
            time.sleep(2 + i * 3)
    return code, None


def main():
    krx = json.load(open(os.path.join(ROOT, 'assets', 'krx.json'), encoding='utf-8'))
    have = {} if '--all' in sys.argv or not os.path.exists(OUT) else json.load(open(OUT, encoding='utf-8'))
    todo = [(c, mk) for c, _n, mk, *_ in krx if c not in have]
    print(f'받을 종목 {len(todo)}개 (이미 있음 {len(have)}개)')
    with ThreadPoolExecutor(6) as ex:
        for i, (c, n) in enumerate(ex.map(lambda a: one(*a), todo), 1):
            if n:
                have[c] = n
            if i % 500 == 0:
                print(f'  {i}/{len(todo)}')
    live = {c for c, *_ in krx}
    have = {c: n for c, n in sorted(have.items()) if c in live}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(have, f, ensure_ascii=False, separators=(',', ':'))
    print(f'영어 이름 {len(have)}개 → assets/krx-en.json ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()
