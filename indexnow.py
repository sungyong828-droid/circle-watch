"""배포 후 실행: 사이트 주소들을 IndexNow로 알린다(네이버·Bing·Yandex 등이 서로 공유).
사용: python indexnow.py
"""
import json
import os
import urllib.request

import landing

ROOT = os.path.dirname(os.path.abspath(__file__))
key = open(os.path.join(ROOT, 'indexnow.key'), encoding='utf-8').read().strip()
urls = [landing.SITE] + [landing.SITE + s for s in ['about', *landing.STOCKS]]
body = json.dumps({'host': 'my-fire-portfolio.pages.dev', 'key': key, 'keyLocation': f'{landing.SITE}{key}.txt', 'urlList': urls}).encode()
for ep in ['https://api.indexnow.org/indexnow', 'https://searchadvisor.naver.com/indexnow']:
    req = urllib.request.Request(ep, data=body, headers={'Content-Type': 'application/json; charset=utf-8'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(ep, r.status)
    except urllib.error.HTTPError as e:
        print(ep, e.code, e.read()[:200])
    except Exception as e:
        print(ep, 'error', e)
