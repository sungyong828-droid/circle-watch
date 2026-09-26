# Circle Watch

Circle(CRCL)의 USDC·EURC·USYC·cirBTC와 Arc 체인 현황을 휴대폰에서 보는 개인용 대시보드.

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
