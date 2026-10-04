"""영어 사전 만들기: fragments.tsv(한국어 조각) + en-*.tsv(번역) + extra.tsv(직접 추가) → assets/i18n-en.js

fragments.tsv 는 코드에서 화면 문구를 뽑은 목록(번호·파일·한국어), en-*.tsv 는 같은 번호의 영어.
새 문구를 추가하면 extra.tsv 에 '한국어<TAB>영어'로 적으면 된다.
사용: python i18n/build_dict.py
"""
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ko = {}
for line in open(os.path.join(HERE, 'fragments.tsv'), encoding='utf-8'):
    parts = line.rstrip('\n').split('\t')
    if len(parts) >= 3:
        ko[parts[0]] = parts[2]

d = {}
for f in sorted(glob.glob(os.path.join(HERE, 'en-*.tsv'))):
    for line in open(f, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or '\t' not in line:
            continue
        i, en = line.split('\t', 1)
        if i in ko:
            d[ko[i]] = en.replace('\\n', '\n')

extra = os.path.join(HERE, 'extra.tsv')
if os.path.exists(extra):
    for line in open(extra, encoding='utf-8'):
        line = line.rstrip('\n')
        if line and not line.startswith('#') and '\t' in line:
            k, v = line.split('\t', 1)
            d[k] = v

# 정규식·검색어 같은 코드 조각은 빼기
d = {k: v for k, v in d.items() if not re.search(r'[|\\]|when:30d|const |\.replace\(', k)}

engine = open(os.path.join(HERE, 'engine.js'), encoding='utf-8').read()
out = os.path.join(ROOT, 'assets', 'i18n-en.js')
with open(out, 'w', encoding='utf-8') as f:
    f.write('// 자동 생성 파일 — i18n/build_dict.py 로 다시 만든다. 직접 고치지 말 것.\n')
    f.write('window.__I18N_EN = ' + json.dumps(d, ensure_ascii=False, indent=0) + ';\n')
    f.write(engine)
print(f'{len(d)} entries → {os.path.relpath(out, ROOT)} ({os.path.getsize(out) // 1024} KB)')
