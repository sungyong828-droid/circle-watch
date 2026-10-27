"""한국 종목 '비싼가 싼가'용 분기 재무 → Cloudflare KV(SUMS). 이 PC에서 돌린다(DART는 해외·클라우드 서버 접속을 막음).

  python tools/dart_sync.py          # 받아서 KV에 올리기
  python tools/dart_sync.py --dry    # 받기만(tools/cache/valkr_*.json 확인용)
  윈도우 작업 스케줄러가 매주 월요일 아침에 돌린다(PC가 켜져 있을 때). 분기 보고서가 나오는 5·8·11·3월에 값이 바뀐다.

- DART 인증키: 환경 변수 DART_KEY 또는 %USERPROFILE%\\.fire-portfolio\\dart_key.txt (저장소 밖 — 깃에 올리지 않는다)
- 상장사 전체(ETF 제외): 다중회사 주요계정(fnlttMultiAcnt, 한 번에 100개 회사) 5년 × 4개 보고서 → 매출액·당기순이익(연결 우선)
  분기·반기 보고서의 당기 금액 = 그 3개월, 4분기 = 사업보고서(1년) − 1~3분기
- 발행주식수(보통주 − 자기주식): 회사별 주식총수 현황(stockTotqySttus) — 새 보고서가 나왔을 때만 다시 받는다
- KV 키: valkr:<0~127 칸>(biz_auto 와 같은 칸 계산) · valkr:meta — 한 번에 129번 쓰기(무료 한도 하루 1,000번 안)
- 서버(worker/news-proxy.js handleValuation)는 이 값 + Yahoo 주가로 PER·PSR을 계산한다
"""
import datetime
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from biz_auto import CACHE, ROOT, bucket, kv_put  # noqa: E402  같은 KV·같은 칸 계산

DRY = '--dry' in sys.argv
DART = 'https://opendart.fss.or.kr/api'
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception: pass


def dart_key():
    k = os.environ.get('DART_KEY', '').strip()
    p = os.path.join(os.path.expanduser('~'), '.fire-portfolio', 'dart_key.txt')
    if not k and os.path.exists(p):
        k = open(p, encoding='utf-8').read().strip()
    if not re.fullmatch(r'[0-9a-f]{40}', k):
        sys.exit(f'DART 인증키가 없어요: 환경 변수 DART_KEY 또는 {p} 에 넣어 주세요')
    return k


KEY = dart_key()


def call(path, params, raw=False, pause=0.08):
    time.sleep(pause)
    url = f'{DART}/{path}?' + urllib.parse.urlencode({'crtfc_key': KEY, **params})
    for i in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                b = r.read()
            if raw:
                return b
            j = json.loads(b)
            if j.get('status') == '013':  # 자료 없음
                return []
            if j.get('status') == '020':  # 요청 제한 초과 — 잠시 쉬었다가
                time.sleep(30)
                continue
            if j.get('status') != '000':
                raise RuntimeError(f"DART {path.split('.')[0]} {j.get('status')} {j.get('message')}")  # 주소(키)는 넣지 않는다
            return j.get('list') or []
        except (urllib.error.URLError, TimeoutError) as e:
            if i == 2:
                raise RuntimeError(f"DART {path.split('.')[0]} 접속 실패: {type(e).__name__}") from None
            time.sleep(3)
    return []


def corp_codes():
    p = os.path.join(CACHE, 'dart_codes.json')
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < 30 * 86400:
        return json.load(open(p, encoding='utf-8'))
    z = zipfile.ZipFile(io.BytesIO(call('corpCode.xml', {}, raw=True)))
    xml = z.read(z.namelist()[0]).decode('utf-8')
    m = {}
    for blk in xml.split('</list>'):
        sc = re.search(r'<stock_code>\s*(\d{5}[0-9A-Z])\s*</stock_code>', blk)
        cc = sc and re.search(r'<corp_code>(\d{8})</corp_code>', blk)
        if cc:
            m[sc.group(1)] = cc.group(1)
    json.dump(m, open(p, 'w', encoding='utf-8'))
    return m


RPT = [('11013', '03-31'), ('11012', '06-30'), ('11014', '09-30'), ('11011', '12-31')]  # 1분기·반기·3분기·사업보고서
REV = re.compile(r'^(매출액|수익\(매출액\)|영업수익|매출)$')
NI = re.compile(r'^당기순이익(\(손실\))?$')


def num(s):
    t = str(s or '').replace(',', '').strip()
    if not t or t == '-':
        return None
    try:
        return float(t)
    except ValueError:
        return None


def main():
    krx = json.load(open(os.path.join(ROOT, 'assets', 'krx.json'), encoding='utf-8'))
    syms = {c: f'{c}.{mk}' for c, _n, mk, *rest in krx if 'E' not in rest}  # ETF 제외
    codes = corp_codes()
    corp2sym = {codes[c]: s for c, s in syms.items() if c in codes}
    print(f'상장사 {len(syms)}개 중 DART 고유번호 {len(corp2sym)}개')
    corps = sorted(corp2sym)
    today = datetime.date.today().isoformat()
    y0 = datetime.date.today().year
    fin = {}  # sym → {'q': {'revenue': {}, 'netIncome': {}}, 'fy': {...}}
    latest = {}  # sym → 가장 최근에 자료가 있는 보고서 (연도, 코드, 말일)
    for y in range(y0 - 4, y0 + 1):
        for rc, md in RPT:
            end = f'{y}-{md}'
            if end >= today:
                continue
            n = 0
            for i in range(0, len(corps), 100):
                for it in call('fnlttMultiAcnt.json', {'corp_code': ','.join(corps[i:i + 100]), 'bsns_year': y, 'reprt_code': rc}):
                    sym = corp2sym.get(it.get('corp_code')) or syms.get(it.get('stock_code', '').strip())
                    if not sym or it.get('sj_div') not in ('IS', 'CIS'):
                        continue
                    nm = re.sub(r'\s', '', it.get('account_nm', ''))
                    k = 'revenue' if REV.match(nm) else 'netIncome' if NI.match(nm) else None
                    v = num(it.get('thstrm_amount'))
                    if not k or v is None:
                        continue
                    F = fin.setdefault(sym, {'q': {'revenue': {}, 'netIncome': {}}, 'fy': {'revenue': {}, 'netIncome': {}}, 'fs': {}})
                    # 연결(CFS)이 있으면 연결, 없으면 별도(OFS)
                    slot = (k, end)
                    if F['fs'].get(slot) == 'CFS' and it.get('fs_div') != 'CFS':
                        continue
                    F['fs'][slot] = it.get('fs_div')
                    (F['fy'] if rc == '11011' else F['q'])[k][end] = v
                    latest[sym] = max(latest.get(sym, (0, '', '')), (y, rc, end), key=lambda x: x[2])
                    n += 1
            print(f'  {end} 보고서: 값 {n}개')
    for F in fin.values():  # 4분기 = 1년 − 1~3분기
        for k in ('revenue', 'netIncome'):
            for end, total in F['fy'][k].items():
                y = end[:4]
                p = [f'{y}-03-31', f'{y}-06-30', f'{y}-09-30']
                if all(e in F['q'][k] for e in p):
                    F['q'][k][end] = total - sum(F['q'][k][e] for e in p)
    # 발행주식수(보통주 − 자기주식): 이전에 받은 보고서와 같으면 다시 받지 않는다
    sp = os.path.join(CACHE, 'dart_shares.json')
    shares = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    inv = {s: c for c, s in corp2sym.items()}
    todo = [s for s in fin if fin[s]['q']['revenue'] and shares.get(s, {}).get('at') != latest[s][2]]
    print(f'발행주식수 받기: {len(todo)}개 회사')
    for i, s in enumerate(todo):
        y, rc, end = latest[s]
        try:
            L = call('stockTotqySttus.json', {'corp_code': inv[s], 'bsns_year': y, 'reprt_code': rc})
        except RuntimeError as e:
            print('  ', s, e)
            continue
        c = next((x for x in L if '보통주' in (x.get('se') or '')), None)
        n = num(c and c.get('istc_totqy'))
        if n and n > 0:
            shares[s] = {'n': n - (num(c.get('tesstk_co')) or 0), 'at': end}
        if i % 200 == 199:
            json.dump(shares, open(sp, 'w', encoding='utf-8'))
            print(f'  {i + 1}/{len(todo)}')
    json.dump(shares, open(sp, 'w', encoding='utf-8'))
    out = {}
    for s, F in fin.items():
        q = {k: {e: round(v) for e, v in sorted(F['q'][k].items())[-20:]} for k in ('revenue', 'netIncome')}
        if q['revenue'] and s in shares:
            out[s] = {'q': q, 'sh': shares[s]['n'], 'shAt': shares[s]['at']}
    shards = {}
    for s, v in out.items():
        shards.setdefault(bucket(s), {})[s] = v
    items = [{'key': f'valkr:{k}', 'value': json.dumps(v, separators=(',', ':'))} for k, v in sorted(shards.items())]
    items.append({'key': 'valkr:meta', 'value': json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'n': len(out)})})
    json.dump(out, open(os.path.join(CACHE, 'valkr_all.json'), 'w', encoding='utf-8'))
    print(f'회사 {len(out)}개 · 키 {len(items)}개 · 가장 큰 키 {max(len(it["value"]) for it in items) // 1024}KB')
    if DRY:
        print('(--dry) KV에 올리지 않았어요')
        return
    ok = kv_put(items)
    print('KV 올리기:', 'OK' if ok else '실패')
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
