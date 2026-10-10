"""공유용(Cloudflare Pages) 배포 폴더 dist 만들기.

방문자가 받는 화면 파일에서 개인 계정 이름(GitHub·Cloudflare Worker 주소)이 드러나지 않게 지운다.
공유 주소에서는 모든 데이터를 같은 주소의 /api 로 받으므로 이 주소들이 필요 없다.
사용:  python build.py  →  npx wrangler pages deploy --project-name my-fire-portfolio --branch main
"""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, 'dist')
PRIVATE = re.compile(r'sungyong828', re.I)  # 공개되면 안 되는 식별자

# 영어 사전(assets/i18n-en.js)을 먼저 새로 만든다
import subprocess
subprocess.run([sys.executable, os.path.join(ROOT, 'i18n', 'build_dict.py')], check=True)

shutil.rmtree(DIST, ignore_errors=True)
os.makedirs(os.path.join(DIST, 'data'))
for f in ['index.html', 'admin.html', '_headers', 'robots.txt']:
    shutil.copy(os.path.join(ROOT, f), os.path.join(DIST, f))
shutil.copytree(os.path.join(ROOT, 'assets'), os.path.join(DIST, 'assets'))
for f in ['faa-joby.json', 'spcx-facts.json', 'tem-kpis.json']:
    shutil.copy(os.path.join(ROOT, 'data', f), os.path.join(DIST, 'data', f))

app = os.path.join(DIST, 'assets', 'app.js')
s = open(app, encoding='utf-8').read()
s = re.sub(r"const NEWS_API = ON_PAGES \? '/api' : '[^']*';", "const NEWS_API = '/api';", s)
s = re.sub(r"const DATA_FALLBACK = '[^']*';", "const DATA_FALLBACK = '';", s)
open(app, 'w', encoding='utf-8').write(s)

hdr = os.path.join(DIST, '_headers')
h = open(hdr, encoding='utf-8').read()
h = re.sub(r'\s+https://[\w.-]*sungyong828[\w.-]*', '', h)
open(hdr, 'w', encoding='utf-8').write(h)

# 검색·공유용 소개 페이지(/about · /crcl · /joby · /spcx · /tem)와 사이트맵
import datetime
import landing
slugs = landing.build(DIST)
today = datetime.date.today().isoformat()
urls = [('', '1.0')] + [(s, '0.8') for s in slugs if s != 'feedback'] + [('daily', '0.8'), ('stablecoin', '0.9')]  # 문의 페이지는 검색에 안 내보냄 · /daily 는 서버 페이지
# /daily 서버 페이지(functions/daily)가 쓰는 틀
import json as _djson
with open(os.path.join(ROOT, 'worker', 'daily-tpl.js'), 'w', encoding='utf-8') as _f:
    _f.write('// 자동 생성(build.py ← landing.daily_template) — /daily 서버 페이지의 머리·바닥글 틀\nexport const DAILY_TPL = ' + _djson.dumps(landing.daily_template(), ensure_ascii=False) + ';\n')
lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
lines += [f'  <url><loc>{landing.SITE}{u}</loc><lastmod>{today}</lastmod><changefreq>daily</changefreq><priority>{pr}</priority></url>' for u, pr in urls]
lines += ['</urlset>', '']
with open(os.path.join(DIST, 'sitemap.xml'), 'w', encoding='utf-8') as f:
    f.write(chr(10).join(lines))
# 소개·관리자 페이지도 대시보드와 같은 style.css 버전을 쓰게 맞춘다(예전 버전이 캐시에 남아 화면이 어긋나지 않게)
sv = re.search(r'assets/style\.css\?v=(\d+)', open(os.path.join(DIST, 'index.html'), encoding='utf-8').read())
if sv:
    for fn in os.listdir(DIST):
        if fn.endswith('.html') and fn != 'index.html':
            fp = os.path.join(DIST, fn)
            t = open(fp, encoding='utf-8').read()
            t2 = re.sub(r'assets/style\.css\?v=\d+', 'assets/style.css?v=' + sv.group(1), t)
            if t2 != t:
                open(fp, 'w', encoding='utf-8').write(t2)
# 보안 문의 안내(security.txt · RFC 9116) — 연락처는 공개 블로그
wk = os.path.join(DIST, '.well-known')
os.makedirs(wk, exist_ok=True)
exp = (datetime.date.today() + datetime.timedelta(days=330)).isoformat()
with open(os.path.join(wk, 'security.txt'), 'w', encoding='utf-8') as f:
    f.write(f'Contact: https://blog.naver.com/ky828\nExpires: {exp}T00:00:00.000Z\nPreferred-Languages: ko, en\nCanonical: {landing.SITE}.well-known/security.txt\n')
# 앱의 '새로 업데이트됐어요' 카드(CHANGELOG 다음 배포 칸 또는 최근 버전) → assets/whatsnew.js
import json as _wjson
wn = landing.whatsnew()
for d in (os.path.join(ROOT, 'assets'), os.path.join(DIST, 'assets')):
    with open(os.path.join(d, 'whatsnew.js'), 'w', encoding='utf-8') as f:
        f.write('// 자동 생성(build.py ← CHANGELOG.md) — 직접 고치지 말 것\n')
        f.write('window.__WHATSNEW = ' + _wjson.dumps(wn, ensure_ascii=False) + ';\n')
ix = os.path.join(DIST, 'index.html')  # 알림 내용이 바뀔 때마다 새로 받게
t = open(ix, encoding='utf-8').read()
open(ix, 'w', encoding='utf-8').write(re.sub(r'assets/whatsnew\.js\?v=\w+', 'assets/whatsnew.js?v=' + (wn['id'] if wn else '0'), t))
# IndexNow(네이버·Bing 등에 새 페이지 알림) 소유 확인 파일
key = open(os.path.join(ROOT, 'indexnow.key'), encoding='utf-8').read().strip()
with open(os.path.join(DIST, key + '.txt'), 'w', encoding='utf-8') as f:
    f.write(key)

# 첫 화면(/)은 Functions(functions/index.js)가 보내므로 _headers 의 "/*" 보안 헤더를 JS로도 만들어 둔다
def site_headers(text):
    out, on = {}, False
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if not line.startswith((' ', '\t')):
            on = line.strip() == '/*'
            continue
        if on and ':' in line:
            k, v = line.strip().split(':', 1)
            out[k.strip()] = v.strip()
    return out
import json as _json
hdrs = site_headers(open(hdr, encoding='utf-8').read())
with open(os.path.join(ROOT, 'worker', 'site-headers.js'), 'w', encoding='utf-8') as f:
    f.write('// 자동 생성(build.py) — _headers 의 "/*" 보안 헤더. functions/index.js 가 첫 화면 응답에 붙인다.\n')
    f.write("export const PROD_HOST = 'my-fire-portfolio.pages.dev';\n")
    f.write('export const SITE_HEADERS = ' + _json.dumps(hdrs, ensure_ascii=False, indent=2) + ';\n')

# 최종 확인: dist 어디에도 개인 식별자가 남아 있으면 배포하지 않는다
leaks = []
for dp, _, files in os.walk(DIST):
    for f in files:
        p = os.path.join(dp, f)
        try:
            if PRIVATE.search(open(p, encoding='utf-8', errors='ignore').read()):
                leaks.append(os.path.relpath(p, DIST))
        except OSError:
            pass
if leaks:
    sys.exit('개인 식별자가 남아 있어요: ' + ', '.join(leaks))
print('dist 준비 완료 (개인 식별자 없음)')
