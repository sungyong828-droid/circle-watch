"""공유용(Cloudflare Pages) 배포 폴더 dist 만들기.

방문자가 받는 화면 파일에서 개인 계정 이름(GitHub·Cloudflare Worker 주소)이 드러나지 않게 지운다.
공유 주소에서는 모든 데이터를 같은 주소의 /api 로 받으므로 이 주소들이 필요 없다.
사용:  python build.py  →  npx wrangler pages deploy --project-name yongs-portfolio --branch main
"""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, 'dist')
PRIVATE = re.compile(r'sungyong828', re.I)  # 공개되면 안 되는 식별자

shutil.rmtree(DIST, ignore_errors=True)
os.makedirs(os.path.join(DIST, 'data'))
for f in ['index.html', '_headers']:
    shutil.copy(os.path.join(ROOT, f), os.path.join(DIST, f))
shutil.copytree(os.path.join(ROOT, 'assets'), os.path.join(DIST, 'assets'))
for f in ['faa-joby.json', 'spcx-facts.json']:
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
