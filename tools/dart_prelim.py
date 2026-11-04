"""한국 종목 '영업(잠정)실적(공정공시)' → Cloudflare KV(SUMS). GitHub Actions(.github/workflows/dart-prelim.yml)가 3시간마다 돌린다.

  python tools/dart_prelim.py          # 최근 3일 공시를 확인해 새 것만 읽고, 바뀐 KV 칸만 올리기
  python tools/dart_prelim.py --dry    # 받기만(tools/cache/dart_prelim.json 확인용)

회사가 분기보고서(약 45일 뒤)보다 먼저 내는 잠정 실적이다. 정해진 공시 서식이라 표를 그대로 읽는다:
  실적기간(당기) · 단위(원·천원·백만원·억원) · 매출액·영업이익·법인세비용차감전계속사업이익·당기순이익의 당해실적 / 전기실적 / 전년동기실적
검산: 회사가 적은 증감율(%)과 다시 계산한 값이 0.6%p 넘게 다르면 그 공시는 쓰지 않는다. 연결 기준이 있으면 연결, [기재정정]은 앞 공시를 대신한다.
KV 키: krprelim:<0~31 칸> — 칸마다 { '005930.KS': { … } } (서버 krPrelimOf가 같은 칸 계산으로 읽는다)
"""
import datetime
import hashlib
import html
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
from biz_auto import CACHE, ROOT, kv_put  # noqa: E402

DRY = '--dry' in sys.argv
DART = 'https://opendart.fss.or.kr/api'
PB = 32  # KV 칸 수(worker/news-proxy.js krPrelimOf와 같아야 한다)
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def dart_key():
    k = os.environ.get('DART_KEY', '').strip()
    p = os.path.join(os.path.expanduser('~'), '.fire-portfolio', 'dart_key.txt')
    if not k and os.path.exists(p):
        k = open(p, encoding='utf-8').read().strip()
    if not re.fullmatch(r'[0-9a-f]{40}', k):
        sys.exit('DART 인증키가 없어요')
    return k


KEY = dart_key()


def get(path, params, raw=False):
    time.sleep(0.1)
    url = f'{DART}/{path}?' + urllib.parse.urlencode({'crtfc_key': KEY, **params})
    for i in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                b = r.read()
            if raw and b[:1] == b'{':  # 문서 대신 오류 JSON(한도 초과 등)
                j = json.loads(b)
                if j.get('status') == '020':
                    raise LimitError()
                raise RuntimeError(f"DART {path.split('.')[0]} {j.get('status')}")
            j = b if raw else json.loads(b)
            if not raw and j.get('status') == '020':
                raise LimitError()
            return j
        except LimitError:
            raise
        except Exception as e:  # 주소(키)는 남기지 않는다
            if i == 2:
                raise RuntimeError(f'DART {path.split(".")[0]} 접속 실패: {type(e).__name__}') from None
            time.sleep(3)


class LimitError(RuntimeError):
    """DART 하루 요청 한도 초과"""


def pbucket(sym):
    h = 0
    for ch in sym:
        h = (h * 31 + ord(ch)) % 1000003
    return h % PB


def num(s):
    t = str(s or '').replace(',', '').replace(' ', '').strip()
    if t in ('', '-'):
        return None
    m = re.fullmatch(r'\(?(-?\d+(?:\.\d+)?)\)?', t)
    if not m:
        return None
    v = float(m.group(1))
    return -abs(v) if t.startswith('(') else v


UNIT = {'원': 1, '천원': 1e3, '백만원': 1e6, '억원': 1e8, '조원': 1e12}
ROWS = {'rev': r'^(매출액|영업수익|수익\(매출액\)|매출)$', 'op': r'^영업이익', 'pretax': r'^법인세비용차감전', 'net': r'^당기순이익', 'ctrl': r'^지배기업'}


def parse(doc):
    """잠정실적 서식 → { start, end, unit, rev:{cur,prev,ya}, … } · 못 읽거나 검산 실패면 None"""
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', doc, re.S | re.I):
        cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', c))).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S | re.I)]
        if any(cells):
            rows.append(cells)
    per = next((r for r in rows if r and r[0] == '당기실적' and len(r) >= 4), None)
    um = re.search(r'단위\s*:\s*(원|천원|백만원|억원|조원)', doc)
    if not per or not um or not re.fullmatch(r'\d{4}-\d\d-\d\d', per[1] or '') or not re.fullmatch(r'\d{4}-\d\d-\d\d', per[3] or ''):
        return None
    d0, d1 = per[1], per[3]
    gap = (datetime.date.fromisoformat(d1) - datetime.date.fromisoformat(d0)).days
    if not 80 <= gap <= 100:  # 한 분기(3개월)짜리 공시만 — 월간 판매 실적·누계만 낸 공시는 건너뛴다
        return 'skip'
    u = UNIT[um.group(1)]
    out = {'start': d0, 'end': d1, 'unit': um.group(1)}
    for k, rx in ROWS.items():
        r = next((r for r in rows if len(r) >= 9 and re.match(rx, r[0].replace(' ', '')) and r[1] == '당해실적'), None)
        if not r:
            continue
        cur, prev, ya = num(r[2]), num(r[3]), num(r[6])
        if cur is None:
            continue
        # 검산: 회사가 적은 증감율과 다시 계산한 값. 표에 적힌 자릿수(예: 0.94조원)만큼의 반올림 오차는 허용한다
        dec = max([len(t.split('.')[1]) for t in (r[2], r[3], r[6]) if '.' in str(t)] or [0])
        half = 0.5 * 10 ** -dec
        for base, stated in ((prev, num(r[4])), (ya, num(r[7]))):
            if base and base > 0 and cur > 0 and stated is not None:
                allow = max(0.6, abs(stated) * 0.005 + 100 * half * (1 / base + cur / base ** 2))
                if abs((cur / base - 1) * 100 - stated) > allow:
                    return None
        out[k] = {'cur': round(cur * u), 'prev': None if prev is None else round(prev * u), 'ya': None if ya is None else round(ya * u)}
    return out if 'rev' in out and 'op' in out else None


def main():
    krx = json.load(open(os.path.join(ROOT, 'assets', 'krx.json'), encoding='utf-8'))
    syms = {c: f'{c}.{mk}' for c, _n, mk, *rest in krx if 'E' not in rest}
    sp = os.path.join(CACHE, 'dart_prelim.json')
    S = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {'seen': [], 'data': {}}
    seen = set(S['seen'])
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()
    # 처음 돌 때(기록이 없을 때)는 지난 45일치를 한 번에 — 이번 분기 잠정 실적을 다 채운다. 그 뒤엔 최근 3일만
    bgn = (today - datetime.timedelta(days=3 if S['seen'] else 45)).strftime('%Y%m%d')
    found, page = [], 1
    while True:
        j = get('list.json', {'bgn_de': bgn, 'end_de': today.strftime('%Y%m%d'), 'pblntf_ty': 'I', 'page_count': 100, 'page_no': page})
        if j.get('status') == '013':
            break
        if j.get('status') != '000':
            raise RuntimeError(f"DART list {j.get('status')} {j.get('message')}")
        found += [x for x in j.get('list', []) if '영업(잠정)실적' in x.get('report_nm', '') and x.get('stock_code', '').strip() in syms]
        if page >= int(j.get('total_page') or 1):
            break
        page += 1
    found.sort(key=lambda x: x['rcept_no'])  # 오래된 것부터 → 정정·연결이 뒤에서 덮어쓴다
    print(f'잠정실적 공시 {len(found)}건 (새 공시 {sum(1 for x in found if x["rcept_no"] not in seen)}건)')
    changed = set()
    for x in found:
        rno = x['rcept_no']
        if rno in seen:
            continue
        try:
            z = zipfile.ZipFile(io.BytesIO(get('document.xml', {'rcept_no': rno}, raw=True)))
            doc = z.read(z.namelist()[0]).decode('utf-8', errors='replace')
        except LimitError:
            print('DART 하루 요청 한도 초과 — 나머지는 다음 실행에서 읽어요')
            break
        except Exception as e:
            print('  읽기 실패(다음 실행에 다시)', x['corp_name'], type(e).__name__)
            continue
        seen.add(rno)
        p = parse(doc)
        if p == 'skip':
            continue
        if not p:
            print('  서식 해석·검산 실패(건너뜀)', x['corp_name'], x['report_nm'].strip())
            continue
        sym = syms[x['stock_code'].strip()]
        cons = '연결' in x['report_nm']
        old = S['data'].get(sym)
        # 같은 분기에 연결 기준이 이미 있으면 별도 기준은 쓰지 않는다
        if old and old['end'] == p['end'] and old.get('cons') and not cons:
            continue
        # [기재정정]: 같은 분기 숫자가 앞 공시와 0.5% 안에서 같으면(단위만 '조원'으로 바꾼 정정 등) 더 자세한 앞 공시 값을 그대로 둔다.
        # 다르면 정정 값을 쓴다(정정이 맞는 숫자)
        if old and old['end'] == p['end'] and '정정' in x['report_nm']:
            keys = [k for k in ROWS if k in p and k in old]
            same = keys and all(abs(p[k]['cur'] - old[k]['cur']) <= abs(old[k]['cur']) * 0.005 + 1 for k in keys)
            if same:
                continue
        S['data'][sym] = {**p, 'cons': cons, 'd': x['rcept_dt'][:4] + '-' + x['rcept_dt'][4:6] + '-' + x['rcept_dt'][6:], 'rno': rno, 'name': x['corp_name']}
        changed.add(pbucket(sym))
        print(f'  {x["corp_name"]} {p["end"]} 매출 {p["rev"]["cur"]:,} 영업이익 {p["op"]["cur"]:,} ({"연결" if cons else "별도"})')
    # 120일 지난 잠정 실적은 지운다(그 분기는 분기보고서·네이버 실적으로 대신한다)
    cut = (today - datetime.timedelta(days=120)).isoformat()
    for sym in [s for s, v in S['data'].items() if v['d'] < cut]:
        changed.add(pbucket(sym))
        del S['data'][sym]
    S['seen'] = sorted(seen)[-5000:]
    json.dump(S, open(sp, 'w', encoding='utf-8'), ensure_ascii=False)
    if DRY or not changed:
        print('KV에 올리지 않았어요' + (' (--dry)' if DRY else ' (바뀐 칸 없음)'))
        return
    items = []
    for b in sorted(changed):
        shard = {s: v for s, v in S['data'].items() if pbucket(s) == b}
        items.append({'key': f'krprelim:{b}', 'value': json.dumps(shard, ensure_ascii=False, separators=(',', ':'))})
    print(f'KV 칸 {len(items)}개 올리기')
    if not kv_put(items):
        sys.exit(1)


if __name__ == '__main__':
    main()
