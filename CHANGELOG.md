# Fire Portfolio 업데이트 기록

실제 사이트(https://my-fire-portfolio.pages.dev)에 배포할 때마다 한 줄씩 쌓이는 기록이에요.

- **버전 이름**: `v연.월.일-그날 몇 번째` (예: `v2026.10.05-1`). GitHub 저장소의 **Tags**에서 같은 이름으로 그 시점 코드를 볼 수 있어요.
- **이 버전 보기**: Cloudflare가 배포마다 남겨 두는 고정 주소예요. 그때 화면을 그대로 열어 볼 수 있어요(블로그 캡처용). 이 주소에서는 방문 집계를 하지 않고, 화면 위에 TEST 표시가 떠요.
- 공개 '업데이트 소식' 페이지(/updates)에는 v2026.10.05-1 이후의 새 기능·화면 변경만 나가요. 줄 끝에 `<!-- internal -->`를 붙인 항목과 그 전 기록은 이 파일에만 남아요.
- 배포는 `python deploy.py test`로 먼저 확인한 뒤 `python deploy.py prod`로 올려요. prod 배포 때 아래 **다음 배포** 칸이 새 버전 이름으로 바뀌고 태그가 붙어요.

## 다음 배포

<!-- 다음 실제 배포에 들어갈 변경을 여기에 적는다. 비워 두면 커밋 제목으로 채운다. -->

## v2026.10.09-3 — 2026-10-09

[이 버전 보기](https://a4827565.my-fire-portfolio.pages.dev) · 커밋 `de51b53`

- 🛠️ 관리자: 인기 종목을 종목명(미국·한국)으로, 유입 채널(검색·블로그·SNS) 요약과 블로그 글별 유입, 검색 노출 점검(사이트맵·RSS) 추가, '많이 쓰는 화면' 제거, '새로 시작' 표시를 '비교 기록 없음'으로. <!-- internal -->

## v2026.10.09-2 — 2026-10-09

[이 버전 보기](https://293d2f22.my-fire-portfolio.pages.dev) · 커밋 `61fad2e`

**새 기능**
- 💼 **성과급 계산기 소개 페이지**(/bonus): 삼성전자 OPI·TAI, SK하이닉스 PS·PI 계산 방법과 자주 묻는 질문. 누르면 계산기로 바로 열려요.
- 🧮 **배당 포트폴리오 계산기 소개 페이지**(/portfolio): "이 돈이면 한 달 배당 얼마?"를 계산하는 방법과 자주 묻는 질문.

**개선**
- 🔎 검색 결과에 보이는 사이트 설명을 지금 기능(한국 주식·배당·성과급·퇴사 계산기)에 맞게 바꿨어요. <!-- internal -->
- 📡 업데이트 소식 RSS(/rss.xml)를 만들어 네이버에 새 소식이 더 빨리 수집되게 했어요. <!-- internal -->

## v2026.10.09-1 — 2026-10-09

[이 버전 보기](https://aed18b6a.my-fire-portfolio.pages.dev) · 커밋 `006e420`

**새 기능**
- 🔄 **당겨서 새로고침**: 화면 맨 위에서 아래로 쭉 당기면 모든 데이터를 새로 받아요. 홈 화면에 추가한 앱에서도 돼요.
- 🇰🇷 **시장 개요에 한국 시장**: 코스피·코스닥(실시간), 원·달러 환율, 그리고 밤사이 한국 증시 분위기를 보여주는 EWY(미국 상장 한국 ETF)와 한국 장 상태.
- 🔍 **배당 포트폴리오 종목 검색**: '종목 찾아 추가'에서 티커나 종목명을 치면 바로 목록이 떠서 골라 넣어요. 한국 종목은 코드 대신 종목명으로 보여요.
- 📈 **대표 배당 종목 배당률**: 월배당·고배당·커버드콜·국내 배당 목록에 종목마다 최근 1년 배당률을 함께 보여줘요.
- 🔔 **속보 알림 새 디자인**: 키워드 속보가 화면 위에 큼직한 카드로 떠요. 누르면 기사, 여러 건이면 '더 보기'로 모아 봐요.

**개선**
- 📱 한국 종목(특히 이름이 긴 ETF)을 추가했을 때 제목·퇴사까지 보유 종목·배당 표가 깨지던 화면을 정리했어요.
- 📄 한국 종목 애널리스트 리포트를 휴대폰에서 누르면 리서치 목록이 아니라 그 리포트 원문으로 바로 열려요.
- 🔢 숫자 칸에 0이 있을 때 숫자를 치면 앞의 0이 자동으로 지워져요. 포트폴리오 비중은 1% 단위(정수)로 넣어요.
- 😱 공포·탐욕 세부 지표 설명 문장을 끝까지 알기 쉽게 다듬었어요.
- 💱 펀딩비가 8시간마다 정산되는 비율이라는 걸 함께 표시해요.
- 📰 뉴스가 거의 없는 한국 ETF 때문에 위에 '일부 항목 실패'가 뜨던 문제를 고쳤어요.

<!-- EN
- 🔄 **Pull to refresh** from the top of any screen (works in the home-screen app too).
- 🇰🇷 **Korea in Market overview**: KOSPI/KOSDAQ (live), USD/KRW and EWY for an overnight read.
- 🔍 **Dividend planner search**: type a ticker or name and pick from the list; Korean stocks show by name.
- 📈 Past-year yield shown for each suggested dividend stock.
- 🔔 Redesigned breaking-news alert card.
- 📱 Fixed broken layouts with long Korean ETF names; research reports open directly on mobile; leading zeros removed in number fields.
-->

## v2026.10.08-1 — 2026-10-08

[이 버전 보기](https://5589f85c.my-fire-portfolio.pages.dev) · 커밋 `8b4aa3a`

**새 기능**
- 🇰🇷 **한국 주식·ETF 추가**: 종목 추가에서 회사명(예: "삼성", "데일리커버드콜")이나 종목코드(005930)로 코스피·코스닥 종목과 ETF를 찾아 넣을 수 있어요. 실시간 시세(원)·차트·뉴스에 투자 지표(PER·PBR·배당수익률·목표주가), 외국인·기관·개인 매매, 애널리스트 의견·리포트, 분기 실적까지 보여줘요.
- 🔥 **퇴사까지·배당금에 한국 종목**: 삼성전자, 국내 커버드콜 ETF 같은 한국 종목도 넣어 원으로 계산해요(배당소득세 15.4%).
- 💼 **성과급 계산기**: Fire의 세 번째 탭. 삼성전자(OPI·TAI)·SK하이닉스(PS·PI) 성과급과 세금·4대보험을 뗀 실수령액을 계산해요.
- 🧮 **배당 포트폴리오 짜보기**: 투자금과 종목·비중을 넣으면 현재가로 몇 주를 살 수 있는지, 1년·한 달 배당이 얼마인지 계산해요. 월배당·고배당·커버드콜·국내 배당 종목을 설명과 함께 골라 넣고, 비중 합계도 바로 알려줘요.
- 🎉 **업데이트 알림**: 새 기능이 생기면 홈 맨 위에서 한 번 알려 줘요. 전체 기록은 '업데이트 소식' 페이지에서.

**개선**
- 🏠 홈 위쪽을 퇴사까지 · 배당금 · 성과급 세 칸으로.
- 🏷️ 종목 로고 약 1만 개로 확대(미국 주식·ETF, 한국 코스피·코스닥).
- 🔄 사이트를 처음 열 때 공포·탐욕 지수 등 모든 데이터를 최신으로 새로 받아요.
- 🔍 종목 검색칸의 글자를 다 지워도 입력칸이 닫히지 않아요.
- 🔥 홈에 퇴사까지·배당금·성과급 칸이 생겨 오른쪽 위 Fire 버튼은 뺐어요.
- 🌐 영어 화면에서도 한국 종목 이름은 그대로, 원화 금액은 ₩(조·억 → T·B)로 보여줘요.
- 🔒 문의 API(/api/feedback)에 읽기 요청이 오면 화면 대신 "허용 안 됨(405)"으로 답하도록. <!-- internal -->

<!-- EN
- 🇰🇷 **Korean stocks & ETFs**: search KOSPI/KOSDAQ by name or 6-digit code — live price (KRW), chart, news, key metrics, investor flows, analyst views and quarterly results.
- 🔥 Korean stocks can now be added to the FIRE and dividend tabs (in KRW, 15.4% dividend tax).
- 💼 **Bonus calculator**: a third Fire tab estimating Samsung (OPI·TAI) and SK hynix (PS·PI) bonuses after tax and social insurance.
- 🧮 **Dividend portfolio planner**: enter an amount, tickers and weights to see how many shares you can buy and the yearly/monthly dividends.
- 🎉 **Update notice**: new features are announced once at the top of Home.
- 🏷️ About 10,000 logos (US stocks, ETFs and Korean stocks); fresh data on first load; search box no longer closes when cleared.
-->

## v2026.10.05-2 — 2026-10-05

[이 버전 보기](https://cc443e0b.my-fire-portfolio.pages.dev) · 커밋 `4e0709e`

**개선**
- 🔒 문의 API(/api/feedback)에 읽기 요청이 오면 화면 대신 "허용 안 됨(405)"으로 답하도록. <!-- internal -->

## v2026.10.05-1 — 2026-10-05

[이 버전 보기](https://5841d789.my-fire-portfolio.pages.dev) · 커밋 `6262e31`

**새 기능**
- 🏠 **공포·탐욕 지수**(Home, 시장 개요 아래): 미국 주식(CNN Fear & Greed)과 코인(Crypto Fear & Greed)을 반원 게이지로 나란히. 전일·1주·1개월·1년 전 비교와 추이선, CNN을 이루는 7개 세부 지표(시장 모멘텀·주가 강도·시장 폭·풋/콜 비율·VIX·안전자산 선호·정크본드 수요)의 점수와 실제 값.
- 🏦 **기관 추정 평단**: 기관 보유 목록에 기관별 `평단≈`, 최근 분기에 기관이 새로 산 주식의 평균 매입가와 지금 주가 대비 수익률, 상위 기관 가중 평균 평단(13F 주식 수 변화 × 분기 평균 거래가로 추정).
- 💬 **문의·개선 제안 페이지**(/feedback): 사이트 맨 아래 링크. 보낸 글은 관리자 페이지에서만 봐요. 도배 방지(10분 3건·하루 8건, 같은 글 7일 중복 금지 등).
- 💡 **쉬운 설명**: 카드 제목 옆 `💡 설명`을 누르면 처음 보는 사람도 이해할 수 있는 설명이 펼쳐져요(USDC·Arc 화면 전체, 공매도, 기관 보유, 공포·탐욕). USDC·Arc 화면 맨 위에는 "서클은 어떻게 돈을 버나요?", "Arc는 뭔가요?" 소개.

**개선**
- 📉 **공매도 비율 바로잡기**: FINRA 원본과 숫자가 정확히 같음을 확인. 다만 이 비율은 '장외 거래 중' 비중이라 이름을 바꾸고, **그날 전체 거래량 대비 비율**(예: 63.5% → 전체 대비 약 26.5%)과 공매도 잔고의 발행 주식 대비 %를 함께 표시.
- 💵 **USDC·Arc 값 검증**: 서클 공식 API·미 재무부·DefiLlama·Arc 탐색기 값과 일치 확인. 스테이블코인 비교표의 USDC도 서클 공식 유통량으로 통일.
- 📱 **줄바꿈 정리**: 한국어 단어가 중간에서 끊기지 않게, 긴 기관·증권사 이름은 "…" 대신 두 줄로, 날짜·"기준"이 따로 떨어지지 않게.

## v2026.10.04-9 — 2026-10-04

[이 버전 보기](https://8a53658e.my-fire-portfolio.pages.dev) · 커밋 `d1d86bf`

- 🔥 **많이 추가한 종목**: 종목 추가 창에 "다른 사람들이 많이 추가한 종목"(최근 30일, 3명 이상) — 누르면 바로 추가. 관리자 페이지에는 전체 인기 종목 순위.
- 🖼️ 배당금 계산기 소개 페이지(/dividend) 전용 공유 미리보기 이미지.

## v2026.10.04-8 — 2026-10-04

[이 버전 보기](https://30eb2afd.my-fire-portfolio.pages.dev) · 커밋 `4171c0b`

- 🔎 **검색용 소개 페이지**: /dividend(배당금 계산기), /fire(퇴사 계산기), /en(영어 소개).
- 📊 **관리자 페이지 확장**: 지난주 대비 증감, 시간대별 방문, 많이 쓰는 화면·기능, 화면 오류 모음, 서비스 상태 확인, 유입 추적 링크 만들기, CSV 내려받기.
- 🔒 **보안 강화**: 관리자 키 8회 오류 시 30분 잠금, 방문 수 부풀리기 방지, AI 요약 사용량 상한, 뉴스 서버 호출 제한, security.txt.
- 예전 GitHub 주소의 사본은 새 주소로 이동.

## v2026.10.04-7 — 2026-10-04

[이 버전 보기](https://e6fbc729.my-fire-portfolio.pages.dev) · 커밋 `64868c6`

- 📷 **거래 내역 사진으로 넣기**: 증권 앱(도미노 등) 거래 화면 캡처를 고르면 매수·매도 기록을 이 기기 안에서 읽어 자동 입력. 종목마다 따로 거래 내역 관리, 고른 연도로 날짜 고정.
- 🎨 **디자인 새로 고침**: Pretendard 숫자 서체, 둥근 카드, 유리 느낌 머리·탭.
- 🏷️ S&P 500 종목 로고, 한국 밖에서 들어오면 영어로 시작, 관리자 새로고침 버튼·이 기기 집계 제외, 테스트 환경.
- 뉴스 키워드 형광 표시 제거.

## v2026.10.04-6 — 2026-10-04

[이 버전 보기](https://0edbb268.my-fire-portfolio.pages.dev) · 커밋 `51e3ac2`

- 💰 매주 배당(MSTY 등)까지 빠짐없이 계산, 지급일 추정 개선, Home에 '퇴사까지 · 배당금' 두 칸.

## v2026.10.04-5 — 2026-10-04

[이 버전 보기](https://425e92fc.my-fire-portfolio.pages.dev) · 커밋 `39e40d3`

- Fire 화면을 **🔥 퇴사까지 | 💰 배당금** 탭으로 나눔, 매수일은 선택(비우면 오늘).

## v2026.10.04-4 — 2026-10-04

[이 버전 보기](https://16bb6fde.my-fire-portfolio.pages.dev) · 커밋 `1f3a205`

- 💰 **배당금 계산기** 첫 버전: 지금까지 받은 배당금, 원금 회수율, 월별·연도별 배당, YOC, 다음 배당일, 세후 15%.

## v2026.10.04-3 — 2026-10-04

[이 버전 보기](https://ea26f2fc.my-fire-portfolio.pages.dev) · 커밋 `2af48b1`

- 네이버 서치어드바이저 소유 확인.

## v2026.10.04-2 — 2026-10-04

[이 버전 보기](https://6b2d0f93.my-fire-portfolio.pages.dev) · 커밋 `7201330`

- 🏠 새 주소 **my-fire-portfolio.pages.dev**로 이사. 예전 주소는 자동으로 넘어오고, 쓰던 보유 정보·관심 종목도 옮겨 줌.

## v2026.10.04-1 — 2026-10-04

[이 버전 보기](https://55ab491b.my-fire-portfolio.pages.dev) · 커밋 `8617f26`

- 🔥 **Fire Portfolio**로 이름을 바꾸고 새 아이콘(불꽃 + 성장 그래프).

---

## 그 전 기록 (Circle Watch → Yong's Portfolio 시절)

이때는 다른 주소(circle-watch.pages.dev → yongs-portfolio.pages.dev)였고, 따로 버전 이름을 붙이지 않았어요.

- **10/04** 홍보 준비: 검색·공유 태그, 소개 페이지(/about·/crcl·/joby·/spcx·/tem), 사이트맵, 공유 버튼, 익명 방문 집계와 관리자 페이지, 한국어/영어 전환.
- **10/03** 속도 개선(저장된 화면 즉시 표시), 증권사별 의견·옵션 심리·실적 당일 모드, 관심 종목 추가, 시장 개요·키워드 속보, 차트 이동평균·거래량.
- **09/29** Yong's Portfolio로 확장: 조비(FAA 인증 진행률)·스페이스X(보호예수)·템퍼스 AI, 기관 보유, 뉴스 AI 한 줄 요약, 실시간 체결가, 캔들 차트.
- **09/28** 🔥 Fire 탭(보유 주식 기준 퇴사 목표 진행률) 추가.
- **09/27** 뉴스·공시 실시간 중계, 공유용 주소, 보안 헤더.
- **09/26** **Circle Watch** 시작: 서클(CRCL) 주가·USDC·Arc 모니터링 대시보드, 휴대폰 중심 화면.
