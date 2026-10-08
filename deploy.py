"""배포: 테스트 환경에 먼저 올려 확인한 뒤 실제 사이트에 올린다.

  python deploy.py test   → https://test.my-fire-portfolio.pages.dev  (테스트 환경)
  python deploy.py prod   → https://my-fire-portfolio.pages.dev       (실제 사이트, 확인 질문 있음)

- 두 곳 모두 같은 코드(dist)·같은 서버 기능(/api)을 쓰고, 데이터 출처도 같다.
- 테스트 환경은 방문 집계를 하지 않고, 검색에 노출되지 않으며(noindex), 화면 위에 '🧪 TEST'가 보인다.
- 보유 정보·관심 종목은 주소마다 따로 저장되므로 테스트 환경에서는 처음엔 비어 있다(테스트 값으로 확인).
- prod 는 방금 test 에 올린 것과 같은 커밋인지 확인하고, 다르면 한 번 더 묻는다.

버전 기록(prod 배포 때 자동):
- 버전 이름 v연.월.일-N(한국 날짜, 그날 N번째)을 정해 Cloudflare 배포 메시지에 붙인다(대시보드 배포 목록에 보임).
- CHANGELOG.md 의 '## 다음 배포' 칸을 이 버전 이름·날짜·'이 버전 보기' 주소로 바꾸고(비어 있으면 커밋 제목으로 채움),
  배포한 커밋에 같은 이름의 git 태그를 붙여 GitHub 에 올린다.
- GitHub CLI(gh)가 설치·로그인돼 있으면 GitHub Releases 에도 같은 내용으로 만든다.
"""
import datetime
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT = 'my-fire-portfolio'
MARK = os.path.join(ROOT, '.wrangler', 'last-test-commit')
CHANGELOG = os.path.join(ROOT, 'CHANGELOG.md')
NEXT_H = '## 다음 배포'
NEXT_NOTE = '<!-- 다음 실제 배포에 들어갈 변경을 여기에 적는다. 비워 두면 커밋 제목으로 채운다. -->'


def run(cmd, capture=False, check=True):
    print('$', ' '.join(cmd))
    r = subprocess.run(cmd, cwd=ROOT, check=False, shell=(os.name == 'nt'), capture_output=capture,
                       text=True, encoding='utf-8', errors='replace')
    if capture:
        print(r.stdout, end='')
        if r.stderr:
            print(r.stderr, end='', file=sys.stderr)
    if check and r.returncode != 0:
        sys.exit(f'실패: {" ".join(cmd)}')
    return r


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout.strip()


def head():
    try:
        return git('rev-parse', '--short', 'HEAD') + ('+변경' if git('status', '--porcelain') else '')
    except Exception:
        return '?'


def kst_today():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()


def next_version():
    d = kst_today().strftime('%Y.%m.%d')
    nums = [int(m.group(1)) for t in git('tag', '-l', f'v{d}-*').split() if (m := re.match(rf'v{re.escape(d)}-(\d+)$', t))]
    return f'v{d}-{max(nums, default=0) + 1}'


def pending_notes(text):
    """CHANGELOG 의 '다음 배포' 칸 내용(안내 주석 제외)"""
    i = text.find(NEXT_H)
    if i < 0:
        return ''
    body = text[i + len(NEXT_H):]
    j = body.find('\n## ')
    body = body if j < 0 else body[:j]
    return body.replace(NEXT_NOTE, '').strip()


def commit_notes():
    last = git('describe', '--tags', '--abbrev=0', '--match', 'v20*')
    rng = f'{last}..HEAD' if last else 'HEAD~10..HEAD'
    subs = [s for s in git('log', rng, '--format=%s').splitlines() if s and not s.startswith('Release v')]
    return '\n'.join(f'- {s}' for s in reversed(subs)) or '- 작은 수정'


def record_release(ver, sha, url):
    text = open(CHANGELOG, encoding='utf-8').read() if os.path.exists(CHANGELOG) else f'# 업데이트 기록\n\n{NEXT_H}\n\n{NEXT_NOTE}\n'
    notes = pending_notes(text) or commit_notes()
    link = f'[이 버전 보기]({url}) · ' if url else ''
    entry = f'## {ver} — {kst_today().isoformat()}\n\n{link}커밋 `{sha}`\n\n{notes}\n'
    i = text.find(NEXT_H)
    if i < 0:
        text = text.rstrip() + f'\n\n{NEXT_H}\n\n{NEXT_NOTE}\n\n{entry}'
    else:
        rest = text[i + len(NEXT_H):]
        j = rest.find('\n## ')
        tail = '' if j < 0 else rest[j + 1:]
        text = text[:i] + f'{NEXT_H}\n\n{NEXT_NOTE}\n\n{entry}\n' + tail
    open(CHANGELOG, 'w', encoding='utf-8', newline='\n').write(text)
    return notes


def publish_release(ver, sha, url, notes):
    run(['git', 'add', 'CHANGELOG.md'], check=False)
    run(['git', 'commit', '-m', f'Release {ver}', '-m', f'Deployed {sha} to https://{PROJECT}.pages.dev'], check=False)
    run(['git', 'tag', '-a', ver, sha, '-m', f'{ver}\n\n{notes}\n\n{url}'], check=False)
    if run(['git', 'push', 'origin', 'HEAD'], check=False).returncode or run(['git', 'push', 'origin', ver], check=False).returncode:
        print('⚠ GitHub 에 올리지 못했어요. 나중에 git push origin HEAD --tags 로 올려 주세요.')
        return
    if shutil.which('gh') and subprocess.run(['gh', 'auth', 'status'], capture_output=True, shell=(os.name == 'nt')).returncode == 0:
        body = os.path.join(ROOT, '.wrangler', 'release-notes.md')
        open(body, 'w', encoding='utf-8').write(f'{notes}\n\n{url}\n')
        run(['gh', 'release', 'create', ver, '--title', ver, '--notes-file', body], check=False)


def main():
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # 윈도우 터미널에서도 한글·이모지 출력
    except Exception: pass
    target = (sys.argv[1] if len(sys.argv) > 1 else '').lower()
    if target not in ('test', 'prod'):
        sys.exit(__doc__)
    run([sys.executable, 'build.py'])
    ver = head()
    if target == 'prod':
        tested = open(MARK, encoding='utf-8').read().strip() if os.path.exists(MARK) else ''
        if tested != ver and '--yes' not in sys.argv:
            ans = input(f'테스트 환경에 마지막으로 올린 버전({tested or "없음"})과 지금({ver})이 달라요. 그래도 실제 사이트에 배포할까요? [y/N] ')
            if ans.strip().lower() != 'y':
                sys.exit('취소했어요.')
    branch = 'main' if target == 'prod' else 'test'
    cmd = ['npx', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', PROJECT, '--branch', branch, '--commit-dirty=true']
    if target == 'test':
        run(cmd)
        os.makedirs(os.path.dirname(MARK), exist_ok=True)
        open(MARK, 'w', encoding='utf-8').write(ver)
        print(f'\n✅ 테스트 환경: https://test.{PROJECT}.pages.dev  (버전 {ver})')
        return
    rel = next_version()
    sha = ver.replace('+변경', '')
    r = run(cmd + ['--commit-message', f'{rel} ({sha})'], capture=True)
    m = re.search(rf'https://[0-9a-f]{{8}}\.{PROJECT}\.pages\.dev', r.stdout or '')
    url = m.group(0) if m else ''
    notes = record_release(rel, sha, url)
    # CHANGELOG에 버전이 붙었으니 /updates·업데이트 알림을 새 버전 이름으로 다시 만들어 한 번 더 올린다
    run([sys.executable, 'build.py'])
    run(cmd + ['--commit-message', f'{rel} ({sha})'], capture=True)
    publish_release(rel, sha, url, notes)
    print(f'\n✅ 실제 사이트: https://{PROJECT}.pages.dev  (버전 {rel} · 커밋 {ver}{" · 이 버전 보기 " + url if url else ""})')


if __name__ == '__main__':
    main()
