"""한국 종목 '비싼가 싼가'용 분기 재무 → Cloudflare KV(SUMS). GitHub Actions(.github/workflows/dart-sync.yml)가 매일 돌린다 — PC가 꺼져 있어도 된다.
(Cloudflare 서버에서는 DART가 접속을 막지만 GitHub 서버에서는 된다 — 2026-11-03 확인)
이 PC의 작업 스케줄러 'FirePortfolio DART'는 2026-11-03에 껐다(GitHub Actions로 옮김). PC에서 직접 돌려도 결과는 같다.

  python tools/dart_sync.py          # 받아서 KV에 올리기(PC에서 직접 돌려도 된다)
  python tools/dart_sync.py --dry    # 받기만(tools/cache/valkr_*.json 확인용)
  python tools/dart_sync.py --cached # DART에 묻지 않고 받아 둔 것만으로 정리해 올리기(DART가 응답을 끊었을 때)
  분기 보고서가 나오는 5·8·11·3월에 값이 바뀐다. 새 보고서가 없는 날은 바뀐 KV 칸이 없어 아무것도 올리지 않는다.

- DART 인증키: 환경 변수 DART_KEY 또는 %USERPROFILE%\\.fire-portfolio\\dart_key.txt (저장소 밖 — 깃에 올리지 않는다)
- 상장사 전체(ETF 제외): 다중회사 주요계정(fnlttMultiAcnt, 한 번에 100개 회사) 5년 × 4개 보고서 → 매출액·당기순이익(연결 우선)
  분기·반기 보고서의 당기 금액 = 그 3개월, 4분기 = 사업보고서(1년) − 1~3분기
  지난 보고서(200일 넘은 분기)는 받아 둔 것(tools/cache/dart_multi.json)을 쓰고 30일에 한 번만 다시 받는다 — 매일 받는 건 최근 두세 분기뿐
- 발행주식수(보통주 − 자기주식): 회사별 주식총수 현황(stockTotqySttus) — 새 보고서가 나왔을 때만 다시 받는다
- KV 키: valkr:<0~127 칸>(biz_auto 와 같은 칸 계산) · valkr:meta — 한 번에 129번 쓰기(무료 한도 하루 1,000번 안)
- 서버(worker/news-proxy.js handleValuation)는 이 값 + Yahoo 주가로 PER·PSR을 계산한다
- 💸 돈의 흐름(자세히): 회사별 전체 재무제표(fnlttSinglAcntAll) 최근 분기 손익 — 매출·매출원가·매출총이익·판관비·영업이익·법인세·순이익
  새 보고서가 나온 회사만 다시 받는다(tools/cache/dart_is.json). 사업보고서(1년)면 4분기 = 1년 − 3분기 누적. KV 키 iskr:<칸>

실적 철(보고서가 몰리는 5·8·11·3월 중순)에 멈추지 않게(2026-11-13 고침 — 그전엔 12번 중 7번이 끝까지 못 갔다):
- 회사별 요청은 4개씩 동시에 받되(DART_WORKERS) 전체로는 1분에 300번까지만 보낸다(DART_GAP — 1분에 천 번을 넘기면 DART가 그 주소의 접속을 한동안 끊는다)
- 연달아 20곳이 실패하면(DART가 응답을 끊음) 몇 시간씩 붙들지 않고 그 자리에서 멈춘다
- 접속 끊김·깨진 응답은 종류와 상관없이 3번까지 다시 받고, 그래도 안 되는 회사는 건너뛰어 다음 실행에 다시 받는다('자료 없음'으로 적어 두지 않는다)
- 시간(DART_BUDGET_MIN)·하루 요청 한도가 다 되면 받은 만큼은 KV에 올린다(다 받을 때까지 기다리지 않는다). 나머지는 다음 실행이 이어서 받는다
- 새 보고서의 손익이 아직 DART에 안 올라온 회사는 지난 분기 값을 그대로 두고 3일 뒤에 다시 받는다(5번까지)
"""
import concurrent.futures as cf
import datetime
import io
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from biz_auto import CACHE, ROOT, bucket, kv_put  # noqa: E402  같은 KV·같은 칸 계산

DRY = '--dry' in sys.argv
CACHED = '--cached' in sys.argv  # DART에 묻지 않고 받아 둔 것(tools/cache)만으로 정리해 올린다 — DART가 응답을 끊었을 때 받은 데까지라도 반영하려고
DART = 'https://opendart.fss.or.kr/api'


def dump(obj, path):
    json.dump(obj, open(path, 'w', encoding='utf-8'), separators=(',', ':'))
WORKERS = max(1, min(8, int(os.environ.get('DART_WORKERS', '4'))))
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


# GitHub Actions는 5시간 40분이면 강제로 끊는다(받던 것도 저장 못 함) → 그 전에 스스로 멈추고 저장한다. 다음 실행이 이어서 받는다
T_END = time.time() + float(os.environ.get('DART_BUDGET_MIN', '240')) * 60
CALLS = [0]


class OutOfTime(RuntimeError):
    """이번 실행에 쓸 시간을 다 씀"""


class DartLimit(RuntimeError):
    """하루 요청 한도(인증키당 2만 번) 초과 — 이번 실행은 멈춘다(받은 만큼은 저장)"""


# 요청 간격: 여러 개를 동시에 받아도 전체로는 0.2초에 하나(1분에 300번)만 보낸다 — 한국에서 직접 돌리면 응답이 빨라 1분에 천 번을 넘기고, 그러면 DART가 한동안 응답을 끊는다
GAP = float(os.environ.get('DART_GAP', '0.2'))
_LOCK, _NEXT = threading.Lock(), [0.0]


def _wait_turn():
    with _LOCK:
        now = time.time()
        t = max(now, _NEXT[0])
        _NEXT[0] = t + GAP
    if t > now:
        time.sleep(t - now)


class DartDown(RuntimeError):
    """DART가 응답을 끊음(연달아 실패) — 이번 실행은 멈춘다(받은 만큼은 저장)"""


HALT = [None]  # 멈추기로 했으면 그 이유 — 이미 줄 서 있던 요청도 바로 그만둔다


def call(path, params, raw=False):
    if HALT[0]:
        raise HALT[0]
    if time.time() > T_END:  # 어느 단계에서든 시간이 다 되면 바로 멈춘다(요청 하나가 끝난 뒤가 아니라 시작하기 전에)
        raise OutOfTime('이번 실행에 쓸 시간을 다 썼어요')
    _wait_turn()
    url = f'{DART}/{path}?' + urllib.parse.urlencode({'crtfc_key': KEY, **params})
    why = ''
    for i in range(3):
        CALLS[0] += 1
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                b = r.read()
            if raw:
                return b
            j = json.loads(b)
        except Exception as e:  # 접속 끊김·시간 초과·중간에 잘린 응답·깨진 JSON — 종류와 상관없이 다시(주소·키는 남기지 않는다)
            why = type(e).__name__
            if i < 2:
                time.sleep(3 * (i + 1))
            continue
        st = j.get('status')
        if st == '013':  # 자료 없음
            return []
        # 요청 한도 초과: '자료 없음'으로 넘어가면 멀쩡한 값을 빈 값으로 덮어쓰게 된다 → 바로 멈춘다
        if st == '020':
            raise DartLimit('DART 하루 요청 한도 초과 — 내일 다시 받아요')
        if st != '000':
            raise RuntimeError(f"DART {path.split('.')[0]} {st} {j.get('message')}")
        return j.get('list') or []
    raise RuntimeError(f"DART {path.split('.')[0]} 접속 실패: {why}")


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


# 손익계산서 항목: 표준 계정 ID가 먼저, 없으면(회사 자체 계정) 이름으로
IS_MAP = {
    'rev': (('ifrs-full_Revenue',), r'^(매출액|수익\(매출액\)|영업수익|매출)$'),
    'cost': (('ifrs-full_CostOfSales',), r'^(매출원가|영업원가)$'),
    'gross': (('ifrs-full_GrossProfit',), r'^매출총이익(\(손실\))?$'),
    'sga': (('dart_TotalSellingGeneralAdministrativeExpenses', 'dart_TotalSellingGeneralAdministrativeExpense'), r'^판매비와관리비$'),
    'op': (('dart_OperatingIncomeLoss',), r'^영업이익(\(손실\))?$'),
    'pretax': (('ifrs-full_ProfitLossBeforeTax',), r'^법인세비용차감전(순이익|계속사업이익)(\(손실\))?$'),
    'tax': (('ifrs-full_IncomeTaxExpenseContinuingOperations', 'ifrs-full_IncomeTaxExpenseContinuingOperation'), r'^법인세비용(\(수익\))?$'),
    'net': (('ifrs-full_ProfitLoss',), r'^(당기|분기|반기)순이익(\(손실\))?$'),
}


def is_detail(corp, y, rc, col='thstrm_amount'):
    """한 보고서의 손익 항목(원). 연결이 있으면 연결, 없으면 별도.
    접속 실패(RuntimeError)는 그대로 올려 보낸다 — '자료 없음'({})과 섞이면 못 받은 회사를 빈 값으로 적어 두게 된다"""
    for fs in ('CFS', 'OFS'):
        L = call('fnlttSinglAcntAll.json', {'corp_code': corp, 'bsns_year': y, 'reprt_code': rc, 'fs_div': fs})
        rows = [x for x in L if x.get('sj_div') in ('IS', 'CIS')]
        if not rows:
            continue
        out = {}
        for k, (ids, rx) in IS_MAP.items():
            hit = next((x for x in rows if x.get('account_id') in ids), None)
            if hit is None:  # 표준 계정이 아니면 이름으로(같은 이름이 여러 번이면 첫 줄)
                hit = next((x for x in rows if not str(x.get('account_id', '')).startswith(('ifrs', 'dart')) and re.match(rx, re.sub(r'\s', '', x.get('account_nm', '')))), None)
            v = num(hit and hit.get(col))
            if v is not None:
                out[k] = v
        out['fs'] = fs
        return out
    return {}


def num(s):
    t = str(s or '').replace(',', '').strip()
    if not t or t == '-':
        return None
    try:
        return float(t)
    except ValueError:
        return None


def run_all(todo, fn, apply, save, label):
    """회사별 요청을 여러 개씩 동시에. 한 회사가 실패하면 그 회사만 건너뛴다(다음 실행에 다시).
    시간·요청 한도가 다 되면 받은 만큼 저장하고 그 이유(예외)를 돌려준다 — 다 받았으면 None"""
    stop, done, bad, streak = None, 0, 0, 0
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(fn, s): s for s in todo}
        for f in cf.as_completed(futs):
            s = futs[f]
            try:
                res = f.result()
            except cf.CancelledError:
                continue
            except (OutOfTime, DartLimit, DartDown) as e:
                if stop is None:
                    stop = HALT[0] = e
                    for x in futs:
                        x.cancel()
                continue
            except Exception as e:  # 이 회사만 건너뛴다
                bad += 1
                streak += 1
                if bad <= 20:
                    print('  ', s, e if isinstance(e, RuntimeError) else type(e).__name__)
                # 연달아 20곳이 실패하면 DART가 응답을 끊은 것 — 몇 시간씩 붙들고 있지 않고 받은 만큼만 올리고 끝낸다
                if streak >= 20 and stop is None:
                    stop = HALT[0] = DartDown(f'DART가 응답하지 않아요(연달아 {streak}곳 실패)')
                    for x in futs:
                        x.cancel()
                continue
            apply(s, res)
            done += 1
            streak = 0
            if done % 200 == 0:
                save()
                print(f'  {label} {done}/{len(todo)}', flush=True)
    save()
    print(f'  {label}: 받음 {done} · 건너뜀 {bad} · 남음 {len(todo) - done - bad}' + (f' — {stop}' if stop else ''), flush=True)
    return stop


def fetch_multi(corps, corp2sym, syms, today):
    """5년 × 4개 보고서의 매출·순이익 → { 'YYYY-코드': {'at': 받은 날, 'rows': [[종목, 항목, 값, 연결·별도], …]} }
    지난 보고서는 받아 둔 것을 쓴다(정정 공시에 대비해 30일에 한 번만 다시). 최근 200일 안에 끝난 분기는 매번 다시 받는다"""
    mp = os.path.join(CACHE, 'dart_multi.json')
    multi = json.load(open(mp, encoding='utf-8')) if os.path.exists(mp) else {}
    d_today = datetime.date.fromisoformat(today)
    y0 = d_today.year
    periods = [(y, rc, f'{y}-{md}') for y in range(y0 - 4, y0 + 1) for rc, md in RPT if f'{y}-{md}' < today]

    def batch(args):
        y, rc, part = args
        rows = []
        for it in call('fnlttMultiAcnt.json', {'corp_code': ','.join(part), 'bsns_year': y, 'reprt_code': rc}):
            sym = corp2sym.get(it.get('corp_code')) or syms.get(it.get('stock_code', '').strip())
            if not sym or it.get('sj_div') not in ('IS', 'CIS'):
                continue
            nm = re.sub(r'\s', '', it.get('account_nm', ''))
            k = 'revenue' if REV.match(nm) else 'netIncome' if NI.match(nm) else None
            v = num(it.get('thstrm_amount'))
            if k and v is not None:
                rows.append([sym, k, v, it.get('fs_div')])
        return rows

    down = False
    for y, rc, end in periods:
        key = f'{y}-{rc}'
        c = multi.get(key)
        old = (d_today - datetime.date.fromisoformat(end)).days > 200
        if c and (CACHED or down or old and c.get('at', '') >= (d_today - datetime.timedelta(days=30)).isoformat()):
            print(f'  {end} 보고서: 받아 둔 값 {len(c["rows"])}개')
            continue
        if CACHED:
            sys.exit(f'{end} 보고서를 받아 둔 게 없어요 — --cached 없이 먼저 돌려 주세요')
        parts = [(y, rc, corps[i:i + 100]) for i in range(0, len(corps), 100)]
        with cf.ThreadPoolExecutor(WORKERS) as ex:
            futs = [ex.submit(batch, a) for a in parts]
            try:
                rows = [r for f in futs for r in f.result()]  # 순서 유지(연결·별도 고르는 규칙이 순서를 본다)
            except (OutOfTime, DartLimit):
                for f in futs:
                    f.cancel()
                dump(multi, mp)
                raise
            except Exception as e:
                for f in futs:
                    f.cancel()
                if not c:  # 받아 둔 것도 없으면 이번 실행은 끝(일부만 받은 값으로 덮어쓰지 않는다)
                    dump(multi, mp)
                    raise RuntimeError(f'{end} 보고서를 못 받았어요 — {e if isinstance(e, RuntimeError) else type(e).__name__}') from None
                print(f'  {end} 보고서: 이번엔 못 받아 지난번 값을 써요 — {e if isinstance(e, RuntimeError) else type(e).__name__}')
                down = True  # DART가 응답하지 않는다 → 나머지 보고서도 받아 둔 값으로(하나하나 기다리지 않는다)
                continue
        # 안전장치: 지난번보다 값이 크게 줄었으면(접속 문제로 덜 받음) 지난번 값을 그대로 둔다
        if c and len(rows) < len(c['rows']) * 0.9:
            print(f'  {end} 보고서: 값 {len(rows)}개 — 지난번({len(c["rows"])}개)보다 크게 줄어 지난번 값을 써요')
            continue
        multi[key] = {'at': today, 'rows': rows}
        dump(multi, mp)
        print(f'  {end} 보고서: 값 {len(rows)}개', flush=True)
    return periods, multi, down


def main():
    krx = json.load(open(os.path.join(ROOT, 'assets', 'krx.json'), encoding='utf-8'))
    syms = {c: f'{c}.{mk}' for c, _n, mk, *rest in krx if 'E' not in rest}  # ETF 제외
    codes = corp_codes()
    corp2sym = {codes[c]: s for c, s in syms.items() if c in codes}
    print(f'상장사 {len(syms)}개 중 DART 고유번호 {len(corp2sym)}개 · 동시에 {WORKERS}개씩')
    corps = sorted(corp2sym)
    today = datetime.date.today().isoformat()
    periods, multi, down = fetch_multi(corps, corp2sym, syms, today)
    if down:
        HALT[0] = DartDown('DART가 응답하지 않아요')
    fin = {}  # sym → {'q': {'revenue': {}, 'netIncome': {}}, 'fy': {...}}
    latest = {}  # sym → 가장 최근에 자료가 있는 보고서 (연도, 코드, 말일)
    for y, rc, end in periods:
        for sym, k, v, fs in (multi.get(f'{y}-{rc}') or {}).get('rows', []):
            F = fin.setdefault(sym, {'q': {'revenue': {}, 'netIncome': {}}, 'fy': {'revenue': {}, 'netIncome': {}}, 'fs': {}})
            # 연결(CFS)이 있으면 연결, 없으면 별도(OFS)
            slot = (k, end)
            if F['fs'].get(slot) == 'CFS' and fs != 'CFS':
                continue
            F['fs'][slot] = fs
            (F['fy'] if rc == '11011' else F['q'])[k][end] = v
            latest[sym] = max(latest.get(sym, (0, '', '')), (y, rc, end), key=lambda x: x[2])
    for F in fin.values():  # 4분기 = 1년 − 1~3분기
        for k in ('revenue', 'netIncome'):
            for end, total in F['fy'][k].items():
                y = end[:4]
                p = [f'{y}-03-31', f'{y}-06-30', f'{y}-09-30']
                if all(e in F['q'][k] for e in p):
                    F['q'][k][end] = total - sum(F['q'][k][e] for e in p)
    inv = {s: c for c, s in corp2sym.items()}
    have = [s for s in fin if fin[s]['q']['revenue'] and s in inv]
    newq = max((latest[s][2] for s in have), default='')
    print(f'재무가 있는 회사 {len(have)}개 · 가장 최근 분기 {newq}: {sum(1 for s in have if latest[s][2] == newq)}개')

    # 발행주식수(보통주 − 자기주식): 이전에 받은 보고서와 같으면 다시 받지 않는다
    sp = os.path.join(CACHE, 'dart_shares.json')
    shares = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    # 새 보고서의 주식 수가 DART에 아직 안 올라온 회사(실적 철엔 수백 곳)는 이틀 뒤에 다시 묻는다 — 매일 같은 요청을 되풀이하지 않게
    wait_from = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()

    def need_share(s):
        c, end = shares.get(s) or {}, latest[s][2]
        t = c.get('try') or {}
        return c.get('at') != end and not (t.get('end') == end and t.get('at', '') > wait_from)

    todo = [] if CACHED else [s for s in have if need_share(s)]
    print(f'발행주식수 받기: {len(todo)}개 회사', flush=True)

    def get_share(s):
        y, rc, end = latest[s]
        L = call('stockTotqySttus.json', {'corp_code': inv[s], 'bsns_year': y, 'reprt_code': rc})
        c = next((x for x in L if '보통주' in (x.get('se') or '')), None)
        n = num(c and c.get('istc_totqy'))
        return (end, n - (num(c.get('tesstk_co')) or 0)) if n and n > 0 else None

    def put_share(s, r):
        if r:
            shares[s] = {'n': r[1], 'at': r[0]}
        else:  # 아직 없음 → 지난 값을 그대로 두고 물어본 날만 적어 둔다
            shares[s] = {**(shares.get(s) or {}), 'try': {'end': latest[s][2], 'at': today}}

    stop = run_all(todo, get_share, put_share, lambda: json.dump(shares, open(sp, 'w', encoding='utf-8')), '발행주식수')

    # 💸 돈의 흐름(자세히): 새 보고서가 나온 회사만 전체 손익을 다시 받는다
    ip = os.path.join(CACHE, 'dart_is.json')
    isc = json.load(open(ip, encoding='utf-8')) if os.path.exists(ip) else {}
    if isc.get('_v') != 2:
        # 예전 기록: 접속이 끊겨 못 받은 회사도 '손익 없음'으로 적혀 있을 수 있다 → 손익 없음으로 적힌 회사는 한 번 다시 받는다
        isc = {s: c for s, c in isc.items() if not s.startswith('_') and c.get('v')}
        isc['_v'] = 2
    retry_after = (datetime.date.today() - datetime.timedelta(days=3)).isoformat()

    def need_is(s):
        c, end = isc.get(s) or {}, latest[s][2]
        if c.get('end') == end:
            return False
        t = c.get('try') or {}
        return not (t.get('end') == end and (t.get('n', 0) >= 5 or t.get('at', '') > retry_after))

    def get_is(s):
        y, rc, end = latest[s]
        d = is_detail(inv[s], y, rc)
        if rc == '11011' and d:  # 사업보고서는 1년 값 — 4분기 = 1년 − 3분기 누적
            c3 = is_detail(inv[s], y, '11014', 'thstrm_add_amount')
            d = {k: d[k] - c3[k] for k in d if k != 'fs' and k in c3} | {'fs': d['fs']} if c3 else {}
        return end, d

    def put_is(s, r):
        end, d = r
        old = isc.get(s) or {}
        if d.get('rev', 0) > 0 and d.get('op') is not None and d.get('net') is not None:
            isc[s] = {'end': end, 'v': d}
        elif old.get('v') and old.get('end') != end:
            # 새 보고서의 손익이 아직 없거나 못 읽음 → 지난 분기 값을 그대로 두고 3일 뒤에 다시(5번까지)
            t = old.get('try') or {}
            isc[s] = {'end': old['end'], 'v': old['v'], 'try': {'end': end, 'at': today, 'n': (t.get('n', 0) + 1) if t.get('end') == end else 1}}
        else:
            isc[s] = {'end': end, 'v': None}

    if stop is None and not CACHED:
        todo = [s for s in have if need_is(s)]
        print(f'손익 자세히 받기: {len(todo)}개 회사', flush=True)
        stop = run_all(todo, get_is, put_is, lambda: json.dump(isc, open(ip, 'w', encoding='utf-8')), '손익 자세히')

    is_out = {}
    for s, c in isc.items():
        if s.startswith('_') or not c.get('v') or s not in fin:
            continue
        end = c['end']
        ya = f'{int(end[:4]) - 1}{end[4:]}'
        is_out[s] = {'end': end, **{k: round(v) if isinstance(v, float) else v for k, v in c['v'].items()}, 'prevRev': round(fin[s]['q']['revenue'][ya]) if ya in fin[s]['q']['revenue'] else None}
    out = {}
    for s, F in fin.items():
        q = {k: {e: round(v) for e, v in sorted(F['q'][k].items())[-20:]} for k in ('revenue', 'netIncome')}
        sh = shares.get(s) or {}
        if q['revenue'] and sh.get('n'):
            out[s] = {'q': q, 'sh': sh['n'], 'shAt': sh['at']}
    shards = {}
    for s, v in out.items():
        shards.setdefault(bucket(s), {})[s] = v
    items = [{'key': f'valkr:{k}', 'value': json.dumps(v, separators=(',', ':'))} for k, v in sorted(shards.items())]
    is_shards = {}
    for s, v in is_out.items():
        is_shards.setdefault(bucket(s), {})[s] = v
    items += [{'key': f'iskr:{k}', 'value': json.dumps(v, separators=(',', ':'))} for k, v in sorted(is_shards.items())]
    print(f'손익 자세히: 회사 {len(is_out)}개 (가장 최근 분기 {newq}: {sum(1 for v in is_out.values() if v["end"] == newq)}개)')
    json.dump(out, open(os.path.join(CACHE, 'valkr_all.json'), 'w', encoding='utf-8'))
    print(f'회사 {len(out)}개 · 키 {len(items) + 1}개 · 가장 큰 키 {max(len(it["value"]) for it in items) // 1024}KB · DART 요청 {CALLS[0]}번')
    if stop:
        print(f'이번엔 여기까지: {stop} · 받은 만큼만 올리고 나머지는 다음 실행에서 이어서 받아요')
    if DRY:
        print('(--dry) KV에 올리지 않았어요')
        return
    # 지난번에 올린 값과 같은 칸은 다시 올리지 않는다(KV 쓰기 한도 절약 — 매일 돌아도 새 보고서가 없으면 0번)
    import hashlib
    hp = os.path.join(CACHE, 'dart_kv_hash.json')
    old = json.load(open(hp, encoding='utf-8')) if os.path.exists(hp) else {}
    # 안전장치: 이번에 받은 회사 수가 지난번보다 10% 넘게 줄었으면(접속 문제로 덜 받은 것) 올리지 않는다
    if old.get('_n') and len(out) < old['_n'] * 0.9 or old.get('_is') and len(is_out) < old['_is'] * 0.9:
        sys.exit(f'받은 회사 수가 지난번보다 크게 줄었어요(재무 {len(out)}/{old.get("_n")} · 손익 {len(is_out)}/{old.get("_is")}) — KV에 올리지 않았어요')
    h = {it['key']: hashlib.sha1(it['value'].encode('utf-8')).hexdigest() for it in items}
    items = [it for it in items if old.get(it['key']) != h[it['key']]]
    if not items:
        print('바뀐 칸이 없어 KV에 올리지 않았어요')
        return
    items.append({'key': 'valkr:meta', 'value': json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'n': len(out)})})
    print(f'바뀐 칸 {len(items) - 1}개 올리기')
    ok = kv_put(items)
    if ok:
        json.dump({**old, **h, '_n': len(out), '_is': len(is_out)}, open(hp, 'w', encoding='utf-8'))
    print('KV 올리기:', 'OK' if ok else '실패')
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except (OutOfTime, DartLimit, DartDown) as e:
        # 실패가 아니다 — 받은 만큼 저장했고(Actions 캐시) 다음 실행이 이어서 받는다(첫 단계가 끝나기 전이라 KV는 그대로)
        print(f'이번엔 여기까지: {e} · 다음 실행에서 이어서 받아요')
