"""종목 '사업 현황' 자동 정리 → Cloudflare KV(SUMS)에 올린다. 배포 없이 갱신된다.

  python tools/biz_auto.py            # 만들고 KV에 올리기
  python tools/biz_auto.py --dry      # 만들기만(tools/cache/biz_auto_*.json 확인용)

- 미국: SEC XBRL frames(한 번에 모든 상장사의 분기 값) → 매출·영업이익·순이익·EPS·현금성 자산, 최근 6개 분기.
  frames 하나로 수천 개 회사를 받으므로 요청이 몇십 번뿐이다. 회사 소개(한국어)·한글 이름은 S&P 500 + 화제 종목만 네이버 증권에서.
- 한국: 시가총액 상위 100 + 화제 종목 — 네이버 증권 분기 실적(매출액·영업이익·당기순이익), 회사 소개는 WiseReport(FnGuide) '기업 개요'.
- 손으로 확인해 넣은 13개 종목(data/biz)은 앱이 그 파일을 먼저 쓰므로 여기 값은 쓰이지 않는다.
- KV 키: bizauto:us:<0~127 칸> · bizauto:kr · bizauto:meta  (한 번에 130번 쓰기 · 무료 한도 하루 1,000번 안)
"""
import datetime
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'cache')
os.makedirs(CACHE, exist_ok=True)
NS = 'a8b6d687f1e140d38b1d720e20afb360'
SEC_UA = {'User-Agent': 'FirePortfolio dashboard (https://my-fire-portfolio.pages.dev)'}
BR_UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'}
DRY = '--dry' in sys.argv
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception: pass

# 요즘 많이 이야기되는 미국 종목(S&P 500 밖 포함) — 회사 소개·한글 이름까지 붙인다
HOT_US = ['CRCL', 'JOBY', 'ACHR', 'TEM', 'SPCX', 'SOFI', 'HOOD', 'IONQ', 'RGTI', 'QBTS', 'RKLB', 'ASTS', 'OKLO', 'SMR', 'NBIS', 'CRWV', 'HIMS', 'RDDT',
          'MSTR', 'COIN', 'UPST', 'AFRM', 'SOUN', 'BBAI', 'LUNR', 'CELH', 'RIVN', 'LCID', 'SNOW', 'NET', 'DDOG', 'CRWD', 'APP', 'CVNA', 'DKNG', 'CAVA',
          'DUOL', 'ROKU', 'PATH', 'AI', 'U', 'ELF', 'SERV', 'RXRX', 'PLUG', 'FRVO', 'SHFS', 'CEG', 'VST', 'GEV', 'ANET', 'SMCI', 'MU', 'TSM']
# 한국 화제 종목(시총 100위 밖일 수 있는 것)
HOT_KR = ['086520', '247540', '196170', '028300', '277810', '042700', '007660', '012450', '034020', '064350', '010120', '298040', '079550', '272210']


def get(url, headers=None, timeout=30, pause=0.12):
    time.sleep(pause)
    req = urllib.request.Request(url, headers=headers or BR_UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def cached(name, fn, days=30):
    p = os.path.join(CACHE, name)
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < days * 86400:
        return json.load(open(p, encoding='utf-8'))
    v = fn()
    json.dump(v, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    return v


def sentences(text, n=2, cap=230):
    t = re.sub(r'<br\s*/?>', ' ', text or '')
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t))).strip()
    parts = re.split(r'(?<=다\.)\s+|(?<=음\.)\s+|(?<=함\.)\s+|(?<=[.])\s+(?=[가-힣A-Z])', t)
    out = ''
    for s in parts[:n]:
        if len(out) + len(s) > cap and out:
            break
        out += (' ' if out else '') + s
    return out[:cap].strip()


GICS_KO = {'Information Technology': '정보기술', 'Health Care': '헬스케어', 'Financials': '금융', 'Consumer Discretionary': '경기소비재',
           'Communication Services': '커뮤니케이션 서비스', 'Industrials': '산업재', 'Consumer Staples': '필수소비재', 'Energy': '에너지',
           'Utilities': '유틸리티', 'Real Estate': '부동산', 'Materials': '소재'}


def josa(word, a='은', b='는'):
    for ch in reversed(word or ''):
        if '가' <= ch <= '힣':
            return a if (ord(ch) - 0xAC00) % 28 else b
        if ch.isalnum():
            return b if ch.lower() in 'aeiouy' else a
    return b


BUCKETS = 128


def bucket(sym):  # functions/api/biz.js 의 bucket()과 같은 계산이어야 한다
    h = 0
    for ch in sym:
        h = (h * 31 + ord(ch)) % 1000003
    return h % BUCKETS


def q_of(end):  # 'YYYY-MM-DD' 분기 말 → 'YYYYQn'
    y, m = int(end[:4]), int(end[5:7])
    return f'{y}Q{(m - 1) // 3 + 1}'


MONTHS = {1: '1~3월', 2: '4~6월', 3: '7~9월', 4: '10~12월'}
MON_EN = {1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec'}


def lb(q):
    y, n = q[:4], int(q[5])
    return {'ko': f'{y}년 {MONTHS[n]}', 'en': f'{MON_EN[n]} {y}'}


# ---------------------------------------------------------------- 미국
def sp500():
    def f():
        t = get('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies').decode('utf-8')
        i = t.find('id="constituents"')
        tb = t[i:t.find('</table>', i)]
        out = []
        for r in re.findall(r'(?s)<tr[^>]*>(.*?)</tr>', tb)[1:]:
            c = [html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'(?s)<td[^>]*>(.*?)</td>', r)]
            if len(c) >= 4:
                out.append({'sym': c[0], 'name': c[1], 'sector': c[2], 'sub': c[3]})
        return out
    return cached('sp500.json', f, days=7)


def us_numbers():
    tick = json.loads(get('https://www.sec.gov/files/company_tickers.json', SEC_UA))
    cik2t = {}  # cik → [(앱 티커, 회사명)] — 보통주 여러 종류(GOOGL·GOOG, BRK.B)도 같은 실적으로
    for v in tick.values():
        t = v['ticker']
        if not re.fullmatch(r'[A-Z]{1,5}(-[A-Z])?', t):
            continue
        cik2t.setdefault(int(v['cik_str']), []).append((t.replace('-', '.'), v['title']))
    today = datetime.date.today()
    qs = []
    y, n = today.year, (today.month - 1) // 3 + 1
    for _ in range(7):
        n -= 1
        if n == 0:
            y, n = y - 1, 4
        qs.append(f'CY{y}Q{n}')
    qs = list(reversed(qs))  # 오래된 → 최근
    REV = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense']
    data = {}  # cik → q → dict

    def frame(concept, period, unit='USD'):
        try:
            return json.loads(get(f'https://data.sec.gov/api/xbrl/frames/us-gaap/{concept}/{unit}/{period}.json', SEC_UA)).get('data', [])
        except Exception:
            return []
    for p in qs:
        q = p[2:6] + 'Q' + p[-1]
        for rank, c in enumerate(REV):
            for r in frame(c, p):
                d = data.setdefault(r['cik'], {}).setdefault(q, {})
                if 'rev' not in d or rank < d.get('_rr', 9):
                    d['rev'], d['_rr'], d['accn'] = r['val'], rank, r['accn']
        for key, c, unit in [('op', 'OperatingIncomeLoss', 'USD'), ('net', 'NetIncomeLoss', 'USD'), ('eps', 'EarningsPerShareDiluted', 'USD-per-shares')]:
            for r in frame(c, p, unit):
                d = data.setdefault(r['cik'], {}).setdefault(q, {})
                d[key] = r['val']
                d.setdefault('accn', r['accn'])
        for r in frame('CashAndCashEquivalentsAtCarryingValue', p + 'I'):
            data.setdefault(r['cik'], {}).setdefault(q, {})['cash'] = r['val']
        print('  SEC', p, 'done')
    return data, cik2t


def naver_us(sym):
    """네이버 증권: 한글 이름 · 회사 소개(한국어)"""
    try:
        ac = json.loads(get('https://ac.stock.naver.com/ac?q=' + urllib.parse.quote(sym) + '&target=stock'))
        it = next((x for x in ac.get('items', []) if x.get('nationCode') == 'USA' and x.get('code') == sym), None)
        if not it:
            return None
        ov = json.loads(get(f"https://api.stock.naver.com/stock/{it['reutersCode']}/overview"))
        return {'ko': it['name'], 'desc': sentences(ov.get('summary') or '')}
    except Exception:
        return None


def build_us():
    S = sp500()
    meta = {x['sym']: x for x in S}
    want = list(dict.fromkeys([x['sym'] for x in S] + HOT_US))
    desc = cached('us_desc.json', lambda: {}, days=3650)
    miss = [s for s in want if s not in desc]
    print(f'  네이버 회사 소개: {len(want)}개 중 새로 {len(miss)}개')
    for i, s in enumerate(miss):
        desc[s] = naver_us(s)
        if i % 50 == 49:
            json.dump(desc, open(os.path.join(CACHE, 'us_desc.json'), 'w', encoding='utf-8'), ensure_ascii=False)
            print('   ', i + 1)
    json.dump(desc, open(os.path.join(CACHE, 'us_desc.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    data, cik2t = us_numbers()
    out = {}
    for cik, qd in data.items():
        if cik not in cik2t:
            continue
        qs = sorted(qd)[::-1]
        rows = []
        for q in qs:
            d = qd[q]
            if d.get('rev') is None and d.get('op') is None and d.get('net') is None:
                continue
            m = lambda v: None if v is None else round(v / 1e6, 2)
            accn = d.get('accn', '')
            rows.append({'q': q, 'lb': lb(q), 'url': f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}/" if accn else None,
                         'rev': m(d.get('rev')), 'op': m(d.get('op')),
                         'k': {k: v for k, v in {'net': m(d.get('net')), 'eps': d.get('eps'), 'cash': m(d.get('cash'))}.items() if v is not None}})
        if len(rows) < 2:
            continue
        # 최근 실적이 1년 넘게 없으면(상장폐지·보고 중단) 뺀다
        if rows[0]['q'] < (datetime.date.today() - datetime.timedelta(days=300)).strftime('%YQ') + '1':
            continue
        has_op = any(r['op'] is not None for r in rows[:2])
        if not has_op:  # 영업이익을 따로 안 내는 회사(은행·보험 등)는 순이익을 큰 이익 칸에
            for r in rows:
                r['op'] = r['k'].pop('net', None)
        for sym, title in cik2t[cik][:3]:
          Dn = desc.get(sym) or {}
          M = meta.get(sym)
          B = {'sym': sym, 'auto': True, 'cur': 'USD',
               'src': {'ko': 'SEC 분기 재무제표(XBRL) 자동 정리' + (' · 회사 소개: 네이버 증권' if Dn.get('desc') else ''), 'en': 'SEC quarterly financials (XBRL), compiled automatically'},
               'profit': {'ko': '영업이익', 'en': 'Operating income'} if has_op else {'ko': '순이익', 'en': 'Net income'},
               'kpi': ([{'k': 'net', 'ko': '순이익', 'en': 'Net income', 'f': 'usdM'}] if has_op else []) + [
                   {'k': 'eps', 'ko': '주당순이익(EPS)', 'en': 'EPS (diluted)', 'f': 'px'}, {'k': 'cash', 'ko': '현금성 자산', 'en': 'Cash & equivalents', 'f': 'usdM'}],
               'seg': [], 'q': rows[:6]}
          if Dn.get('ko') or M:
              B['name'] = {'ko': Dn.get('ko') or (M or {}).get('name') or title, 'en': (M or {}).get('name') or title}
          nm = Dn.get('ko') or (M or {}).get('name') or ''
          ko = Dn.get('desc') or (f"{nm}{josa(nm)} S&P 500에 속한 {GICS_KO.get(M['sector'], M['sector'])} 업종 회사예요." if M else '')
          en = f"{M['name']} — {M['sector']} · {M['sub']}." if M else ''
          if ko or en:
              B['easy'] = {'ko': ko or en, 'en': en or ko}
          out[sym] = B
    print(f'  미국 {len(out)}개 회사')
    return out


# ---------------------------------------------------------------- 한국
def build_kr():
    L = json.load(open(os.path.join(ROOT, 'assets', 'krx.json'), encoding='utf-8'))
    stocks = [r for r in L if len(r) < 5 or r[4] != 'E']
    top = [r for r in sorted(stocks, key=lambda r: -(r[3] or 0))[:100]]
    pick = {r[0]: r for r in top}
    for c in HOT_KR:
        r = next((x for x in stocks if x[0] == c), None)
        if r:
            pick[c] = r
    desc = cached('kr_desc.json', lambda: {}, days=3650)
    out = {}
    for code, r in pick.items():
        name, mk = r[1], r[2]
        try:
            F = json.loads(get(f'https://m.stock.naver.com/api/stock/{code}/finance/quarter'))['financeInfo']
        except Exception:
            continue
        per = [p for p in F.get('trTitleList', []) if p.get('isConsensus') != 'Y']
        rowsd = {x['title']: x['columns'] for x in F.get('rowList', [])}
        num = lambda t, k: (lambda v: None if v in (None, '', '-') else float(str(v).replace(',', '')))((rowsd.get(t, {}).get(k) or {}).get('value'))
        rows = []
        for p in per[::-1]:
            k = p['key']
            q = f'{k[:4]}Q{(int(k[4:6]) - 1) // 3 + 1}'
            rev, op, net = num('매출액', k), num('영업이익', k), num('당기순이익', k)
            if rev is None and op is None:
                continue
            jo = lambda v: None if v is None else round(v / 1e4, 3)
            rows.append({'q': q, 'lb': lb(q), 'rev': jo(rev), 'op': jo(op), 'k': {'net': jo(net)} if net is not None else {}})
        if len(rows) < 2:
            continue
        if code not in desc:
            try:
                t = get(f'https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}').decode('utf-8', 'ignore')
                m = re.search(r'(?s)class="cmp_comment">(.*?)</ul>', t)
                desc[code] = sentences(m.group(1), 2) if m else ''
            except Exception:
                desc[code] = ''
        B = {'sym': code, 'auto': True, 'cur': 'KRW', 'name': {'ko': name, 'en': name},
             'src': {'ko': '네이버 증권 분기 실적(FnGuide) 자동 정리' + (' · 회사 소개: WiseReport' if desc[code] else ''), 'en': 'Naver Finance quarterly results (FnGuide), compiled automatically'},
             'profit': {'ko': '영업이익', 'en': 'Operating profit'},
             'kpi': [{'k': 'net', 'ko': '순이익', 'en': 'Net income', 'f': 'krwJo'}], 'seg': [], 'q': rows[:6],
             'url': f'https://m.stock.naver.com/domestic/stock/{code}/finance/quarter'}
        if desc[code]:
            B['easy'] = {'ko': desc[code].replace('동사는', f'{name}{josa(name)}', 1), 'en': ''}
        out[code] = B
    json.dump(desc, open(os.path.join(CACHE, 'kr_desc.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'  한국 {len(out)}개 회사')
    return out


def kv_put(items):
    f = os.path.join(CACHE, 'kv_bulk.json')
    json.dump(items, open(f, 'w', encoding='utf-8'), ensure_ascii=False)
    cmd = f'npx wrangler kv bulk put "{f}" --namespace-id {NS} --remote'
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(r.stdout[-400:], r.stderr[-400:])
    return r.returncode == 0


def main():
    print('미국 정리 중…')
    us = build_us()
    print('한국 정리 중…')
    kr = build_kr()
    shards = {}
    for sym, B in us.items():
        shards.setdefault(bucket(sym), {})[sym] = B  # 128칸으로 나눠 키 하나를 작게(서버가 빨리 읽게) · 쓰기 횟수도 128번
    items = [{'key': f'bizauto:us:{k}', 'value': json.dumps(v, ensure_ascii=False, separators=(',', ':'))} for k, v in sorted(shards.items())]
    items.append({'key': 'bizauto:kr', 'value': json.dumps(kr, ensure_ascii=False, separators=(',', ':'))})
    meta = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'us': len(us), 'kr': len(kr)}
    items.append({'key': 'bizauto:meta', 'value': json.dumps(meta)})
    for it in items:
        json.dump(json.loads(it['value']), open(os.path.join(CACHE, f"biz_auto_{it['key'].replace(':', '_')}.json"), 'w', encoding='utf-8'), ensure_ascii=False)
    print('키', len(items), '· 가장 큰 키', max(len(it['value'].encode()) for it in items) // 1024, 'KB')
    if DRY:
        print('(--dry) KV에 올리지 않았어요')
        return
    print('KV 올리기:', 'OK' if kv_put(items) else '실패')


if __name__ == '__main__':
    main()
