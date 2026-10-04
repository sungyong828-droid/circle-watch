"""배포: 테스트 환경에 먼저 올려 확인한 뒤 실제 사이트에 올린다.

  python deploy.py test   → https://test.my-fire-portfolio.pages.dev  (테스트 환경)
  python deploy.py prod   → https://my-fire-portfolio.pages.dev       (실제 사이트, 확인 질문 있음)

- 두 곳 모두 같은 코드(dist)·같은 서버 기능(/api)을 쓰고, 데이터 출처도 같다.
- 테스트 환경은 방문 집계를 하지 않고, 검색에 노출되지 않으며(noindex), 화면 위에 '🧪 TEST'가 보인다.
- 보유 정보·관심 종목은 주소마다 따로 저장되므로 테스트 환경에서는 처음엔 비어 있다(테스트 값으로 확인).
- prod 는 방금 test 에 올린 것과 같은 커밋인지 확인하고, 다르면 한 번 더 묻는다.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT = 'my-fire-portfolio'
MARK = os.path.join(ROOT, '.wrangler', 'last-test-commit')


def run(cmd, **kw):
    print('$', ' '.join(cmd))
    return subprocess.run(cmd, cwd=ROOT, check=True, shell=(os.name == 'nt'), **kw)


def head():
    try:
        sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        return sha + ('+변경' if dirty else '')
    except Exception:
        return '?'


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
    run(['npx', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', PROJECT, '--branch', branch, '--commit-dirty=true'])
    if target == 'test':
        os.makedirs(os.path.dirname(MARK), exist_ok=True)
        open(MARK, 'w', encoding='utf-8').write(ver)
        print(f'\n✅ 테스트 환경: https://test.{PROJECT}.pages.dev  (버전 {ver})')
    else:
        print(f'\n✅ 실제 사이트: https://{PROJECT}.pages.dev  (버전 {ver})')


if __name__ == '__main__':
    main()
