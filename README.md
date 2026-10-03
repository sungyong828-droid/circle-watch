# Yong's Portfolio

**공유용 주소: https://yongs-portfolio.pages.dev** (Cloudflare Pages · 예전 주소 circle-watch.pages.dev는 여기로 자동 이동)

휴대폰에서 보는 개인용 주식 대시보드. 홈 상단에서 종목을 고르면 화면과 하단 탭이 바뀝니다.

- **CRCL (서클 인터넷 그룹)**: 주가·공매도·기관 보유, USDC·EURC·USYC·cirBTC, Arc 체인, 실적, 뉴스·공시
- **JOBY (조비 에비에이션)**: 주가·공매도·기관 보유, FAA 형식 인증 현황 + 실적(현금 버틸 기간), 뉴스·공시(FAA 인증·UAM 업계)
- **SPCX (스페이스X)**: 주가·공매도·기관 보유, 보호예수(락업) 해제 일정 + 실적, 뉴스·공시(우주 업계)
- **TEM (템퍼스 AI)**: 주가·공매도·기관 보유, 실적(성장률·이익률), 뉴스·공시(헬스케어 AI)
- 뉴스마다 **AI 한 줄 요약**(Cloudflare Workers AI가 기사 앞부분을 읽고 한국어로 요약)
- **Fire** (상단 🔥 칩): 보유 종목 합계로 목표 금액까지 진행률. 보유 정보는 그 기기의 브라우저에만 저장되고 저장소·서버에는 올라가지 않습니다.

## 구조

| 파일 | 역할 |
|---|---|
| `collector/collect.mjs` | 데이터 수집기. DefiLlama·Circle API·Arc/Ethereum RPC·Arc 탐색기에서 모아 `data/latest.json`을 만든다 |
| `index.html`, `assets/` | 화면. `data/latest.json`을 그리고, USDC·EURC·cirBTC는 1분마다 직접 조회(LIVE) |
| `.github/workflows/update.yml` | GitHub Actions가 15분마다 수집기를 돌리고 GitHub Pages로 배포 |

| 항목 | 출처 |
|---|---|
| 스테이블코인 공급량·점유율, USDC/EURC/USYC 추이 | DefiLlama stablecoins API |
| USDC·EURC 현재 유통량, 체인별 분포 | Circle 공식 `api.circle.com/v1/stablecoins` |
| Arc TVL, DEX 거래액, 대출(Morpho Blue·Aave V4) | DefiLlama API |
| cirBTC(Arc·Ethereum), Arc 위 USDC·EURC | 온체인 `totalSupply` (Arc·Ethereum RPC) |
| CCTP 체인별 흐름 | Arc 온체인 CCTP V2 이벤트 직접 집계 |
| 일별 활성 계정 | Arc 탐색기(Blockscout) 통계 API |

## 처음 한 번만 설정 (약 10분)

1. **GitHub 저장소 만들기** — github.com 로그인 → 오른쪽 위 `+` → *New repository*
   - 이름: `circle-watch` (원하는 이름 가능)
   - **Public** 선택 (무료 계정은 Public 저장소만 Pages 사용 가능. 공개 시장 데이터뿐이라 민감한 내용 없음)
   - README 추가 등은 체크하지 않고 *Create repository*
2. **코드 올리기** — 이 폴더에서:
   ```bash
   git init -b main
   git add .
   git commit -m "Circle Watch"
   git remote add origin https://github.com/<내아이디>/circle-watch.git
   git push -u origin main
   ```
   (처음 push 때 브라우저로 GitHub 로그인 창이 뜹니다.)
3. **Pages 켜기** — 저장소 *Settings → Pages → Build and deployment → Source* 를 **GitHub Actions** 로 변경
4. **첫 실행** — *Actions* 탭 → `collect-and-deploy` → *Run workflow* (2~3분 소요)
5. **휴대폰에서 열기** — `https://<내아이디>.github.io/circle-watch/`
   - iPhone Safari: 공유 → *홈 화면에 추가* / Android Chrome: ⋮ → *홈 화면에 추가* 하면 앱처럼 열립니다.

이후엔 15분마다 자동으로 수집·배포됩니다. 매월 1일에 `.github/keepalive` 파일이 자동 커밋되는데, 예약 실행이 60일 무활동으로 꺼지는 것을 막기 위한 것입니다.

## 로컬에서 보기

```bash
node collector/collect.mjs
python -m http.server 8765
```
→ http://localhost:8765

## 참고

- "직전 수집 대비 / 24시간 전 대비" 변화율은 수집 때마다 쌓이는 스냅샷(최근 약 8일치)으로 계산합니다. 처음 배포 직후에는 비교할 이전 수집이 적습니다.
- 수집 중 일부 소스가 실패하면 그 항목은 직전 값을 유지하고, 화면 상단에 `일부 실패`로 표시됩니다.
- 투자 조언이 아닌 개인 모니터링용입니다.

## 뉴스 중계 Worker (Cloudflare)

구글 뉴스·Nasdaq 공시 목록은 브라우저에서 직접 받을 수 없어서, Cloudflare Worker가 대신 받아 JSON으로 돌려줍니다.

- 주소: `https://circle-watch-news.sungyong828.workers.dev/news` (이 대시보드 주소에서 온 요청만 응답)
- 코드: `worker/news-proxy.js` · 설정: `worker/wrangler.toml`
- 3분 캐시 · 새로고침 버튼은 1분 넘은 캐시를 다시 받음
- 구글이 막히면 Bing 뉴스로 대체, 그래도 비면 마지막 성공 결과(최대 7일)를 사용
- 수정 후 다시 배포: `cd worker && npx wrangler deploy`

## 공유용 주소 (Cloudflare Pages)

`https://yongs-portfolio.pages.dev` 는 개인 계정 이름이 드러나지 않는 공유용 주소입니다. AI·KV 연결은 저장소 루트의 `wrangler.toml`에 있습니다.

- 화면 파일(`index.html`, `assets/`)과 중계 기능(`functions/api/`)이 함께 올라갑니다.
  - `/api/data`: 서버 수집기 결과(GitHub Pages의 `data/latest.json`)를 대신 받아 줌
  - `/api/news`, `/api/circle`, `/api/earnings`, `/api/quote`, `/api/chart`, `/api/holders`: 뉴스·유통량·실적·시세·차트·기관 보유 중계 (`worker/news-proxy.js` 코드를 같이 씀)
- 서버 수집 데이터는 `/api/data`가 자동으로 받아 오므로 따로 배포할 필요가 없습니다.
- **화면 코드를 고쳤을 때만** 다시 올립니다:
  ```bash
  python build.py   # dist 생성 + 화면 파일에서 개인 계정 주소 제거(남아 있으면 중단)
  npx wrangler pages deploy --project-name yongs-portfolio --branch main
  ```

## 뉴스 한 줄 요약 (Workers AI)

- Worker(`worker/news-proxy.js`)가 기사 원문 앞부분을 받아 `@cf/qwen/qwen3.8-27b`로 한국어 한 문장 요약을 만들고, KV(`PORTFOLIO_SUMS`)에 종목별로 35일 보관한다.
- 5분마다 cron이 종목 하나씩 돌아가며 새 기사 최대 8개를 요약한다. 새로고침으로 뉴스를 새로 받을 때도 빠진 요약을 4개씩 채운다.
- 원문을 못 받으면(유료 기사·차단) 제목만으로 풀어 쓴다. 한자·가나가 섞이는 등 품질이 낮으면 버리고 다음에 다시 만든다.
- 무료 한도(하루 10,000 뉴런) 안에서 동작한다.

## 기관 보유(13F)

`/holders?s=SYM` — Nasdaq의 13F 집계(상위 보유 40곳, 많이 산/판 곳 8곳, 늘림·줄임·신규·전량 매도 수). 6시간 캐시.

## 자동 확인 (예전에 손으로 갱신하던 자료)

Worker cron(3시간마다, `17 */3 * * *`)이 SEC를 직접 읽어 KV `facts`에 저장하고 `/facts`로 내보낸다.

- **조비 FAA 인증 %**: 새 실적 8-K(item 2.02)가 나오면 첨부 주주서한(99.2)의 차트 글자("DATA AS OF … JOBY 100% 97% … FAA …")를 읽어 단계별 Joby/FAA %로 바꾼다. 차트 글자 순서 두 가지를 모두 처리하고(2025년 3분기~2026년 2분기 서한 4개로 검증), 범위·순서 검증을 통과할 때만 화면에 "자동 반영"으로 쓴다. 못 읽으면 FAA 카드에 알림이 뜬다 → 그때만 `data/faa-joby.json`을 손으로 고친다.
- **형식 인증 취득**: 뉴스·공식 발표 제목에 형식 인증 취득 소식이 나오면 FAA 카드 맨 위에 알린다.
- **스페이스X 보호예수**: 상장 후 새 8-K에 보호예수 면제·조기 해제 문구가 있거나 추가 매도 등록(S-1·S-3·424B)이 나오면 보호예수 카드에 알림. 실적 연동 해제일은 발표 전엔 예정일+2거래일, 발표 뒤엔 실제 발표일+2거래일로 계산. 일정 자체가 바뀌면 `data/spcx-facts.json`을 고친다.

## 보안

공유 링크로 누구나 볼 수 있다는 전제로 다음을 적용했습니다.

| 위험 | 대응 |
|---|---|
| 외부 데이터(뉴스 제목 등)에 스크립트가 섞여 오는 공격(XSS) | 외부 문자열은 모두 이스케이프, 링크는 http(s)만 허용, CSP로 인라인 스크립트 실행 자체를 차단 (`_headers`) |
| CDN 파일 변조 | Chart.js·Pretendard에 SRI 무결성 해시 |
| 다른 사이트에 몰래 끼워 넣기(클릭재킹) | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| 다른 웹사이트가 `/api`를 끌어다 쓰기 | 같은 사이트 요청만 허용(`Sec-Fetch-Site`), CORS 미허용, GET만 허용 |
| `/api` 반복 호출로 무료 한도(하루 10만 건) 소진 | 결과를 캐시해 외부 호출은 1분에 1회로 제한. 한도가 소진돼도 과금은 없고, 화면은 서버 원본 데이터·직접 조회로 계속 동작(뉴스만 서버 수집본으로 대체) |
| 방문 주소 유출 | `Referrer-Policy: no-referrer`, 검색엔진 색인 금지 |
| 비밀 값 유출 | 화면·저장소에 API 키나 토큰 없음 (Cloudflare 로그인 정보는 이 PC에만 있음) |
