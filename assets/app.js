/* Fire Portfolio — 화면 렌더링
 * data/latest.json(수집기 결과)을 그리고, 시세·뉴스·실적·기관 보유는 중계 서버와 각 출처에서 직접 갱신한다. */
(() => {
  'use strict';
  // 예전 GitHub Pages 사본으로 들어오면 새 주소로 보낸다(같은 화면이 두 주소에 있으면 검색 순위가 나뉜다). data/ 파일은 그대로 제공된다
  if (/\.github\.io$/.test(location.hostname)) { location.replace('https://my-fire-portfolio.pages.dev/' + (location.search || '?ref=old-github') + location.hash); return; }

  // Cloudflare Pages(공유용 주소)에서는 같은 주소의 /api 중계를 쓰고, GitHub Pages에서는 Worker를 쓴다
  const ON_PAGES = /\.pages\.dev$/.test(location.hostname);
  // 운영 주소인지(테스트 환경 test.my-fire-portfolio.pages.dev 등은 방문 집계 안 함 · 상단에 TEST 표시)
  const IS_PROD = location.hostname === 'my-fire-portfolio.pages.dev';
  if (ON_PAGES && !IS_PROD) document.documentElement.classList.add('is-test');
  // 화면 오류 보고(reportErr)는 시작 코드의 오류도 잡도록 맨 앞에서 건다
  window.addEventListener('error', (e) => reportErr(e.message, e.filename ? `${e.filename}:${e.lineno}` : ''));
  window.addEventListener('unhandledrejection', (e) => reportErr('promise: ' + (e.reason?.message || e.reason)));
  const DATA_URL = ON_PAGES ? '/api/data' : 'data/latest.json';
  const SITE_API = ON_PAGES ? '/api' : null; // 이 사이트 서버(Pages Functions)에만 있는 기능: 투표·기기 옮기기
  const MOVE_CODE = (location.hash.match(/^#move=([A-Za-z0-9-]{10,14})$/) || [])[1] || null; // QR로 열었을 때(화면 이동 전에 읽어 둔다)
  const NEWS_API = ON_PAGES ? '/api' : 'https://circle-watch-news.sungyong828.workers.dev';
  const DATA_FALLBACK = 'https://sungyong828-droid.github.io/circle-watch/data/latest.json'; // /api/data가 막혔을 때만
  // 예전 주소(yongs-portfolio.pages.dev/move)에서 넘어온 이 기기의 데이터(보유 정보·관심 종목·키워드·설정)를 받는다.
  // 주소의 # 뒤라 서버로는 전송되지 않고, 이 기기에 아직 없는 값만 채운다(관리자 키·화면 캐시는 받지 않음).
  const MIGRATED = (() => {
    const m = location.hash.match(/^#migrate=([A-Za-z0-9_-]{1,300000})$/);
    if (!m) return 0;
    let n = 0, fire = false;
    try {
      const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
      const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
      for (const [k, v] of Object.entries(data || {})) {
        if (!/^cw\.[\w.-]{1,40}$/.test(k) || /^cw\.(adminKey|snapshot\.v1)$/.test(k) || typeof v !== 'string' || v.length > 100000) continue;
        if (localStorage.getItem(k) == null) { localStorage.setItem(k, v); n++; if (k === 'cw.fire') fire = true; }
      }
    } catch {}
    try { history.replaceState(null, '', location.pathname + (fire ? '#fire' : '#home')); } catch {}
    return n;
  })();
  // 언어: ?lang= 링크 → 이 기기 저장값 → 브라우저 언어(한국어가 아니면 영어). 검색 로봇은 한국어로 본다.
  const LANG = (() => {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (q === 'ko' || q === 'en') { localStorage.setItem('cw.lang', q); return q; }
      const saved = localStorage.getItem('cw.lang');
      if (saved === 'ko' || saved === 'en') return saved;
      if (/bot|crawl|spider|slurp|lighthouse|inspectiontool/i.test(navigator.userAgent)) return 'ko';
      if (/^ko\b/i.test(navigator.language || '')) return 'ko'; // 휴대폰·브라우저가 한국어면 한국어
      // 접속 국가(첫 화면을 보낼 때 서버가 <html data-cc>로 넣음): 한국이면 한국어, 그 밖은 영어
      const cc = document.documentElement.dataset.cc || '';
      return cc === 'KR' ? 'ko' : 'en';
    } catch { return 'ko'; }
  })();
  const EN = LANG === 'en', LOC = EN ? 'en-US' : 'ko-KR';
  // 영어 보기: 사전·번역기를 불러오고, 번역이 끝날 때까지(최대 1.5초) 한국어가 잠깐 보이지 않게 가린다
  const T = (x) => (EN && typeof x === 'string' && window.__tr ? window.__tr(x) : x);
  if (EN) {
    document.documentElement.lang = 'en';
    document.documentElement.classList.add('i18n-wait');
    setTimeout(() => document.documentElement.classList.remove('i18n-wait'), 1500);
    const sc = document.createElement('script');
    sc.src = 'assets/i18n-en.js?v=26';
    document.head.appendChild(sc);
    document.title = "Fire Portfolio · US stock dashboard for financial independence (FIRE) — Circle, Joby, SpaceX, Tempus";
  }
  const DATA_REFRESH_MS = 5 * 60 * 1000;
  const LIVE_REFRESH_MS = 60 * 1000;
  const LIVE = {
    circle: 'https://api.circle.com/v1/stablecoins',
    arcRpc: ['https://rpc.mainnet.arc.io', 'https://rpc.blockdaemon.mainnet.arc.io'],
    ethRpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    arcCirbtc: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0',
    ethCirbtc: '0x72dfb2e44f59c5ad2bafe84314e5b99a7cd5075e',
  };

  // 차트 색(CSS 토큰) — 다크·라이트 전환 때 readC()로 다시 읽는다
  const C = {};
  const readC = () => {
    const css = getComputedStyle(document.documentElement), v = (k) => css.getPropertyValue(k).trim();
    Object.assign(C, { blue: v('--c-blue'), orange: v('--c-orange'), teal: v('--c-teal'), purple: v('--c-purple'), ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), faint: v('--faint'),
      line: v('--line'), lineSoft: v('--line-soft'), surface: v('--surface'), surface2: v('--surface-2'), up: v('--up'), down: v('--down') });
  };
  readC();

  const state = {
    data: null,
    live: {},
    syncedAt: null,
    usdcChains: null,
    basis: loadPref('basis', 'prev'),
    openInfo: new Set(),
    cctpAll: false,
    view: 'home',
    range: loadPref('range', '1d'),
    px: { t: null, mark: null, oi: null, klines: {}, via: null, at: 0 },
  };
  const charts = {};

  // ---------------------------------------------------------------- 설명(ⓘ)
  const INFO = {
    jprice: `
      <p><b>조비 에비에이션(JOBY)</b>의 실시간 주가입니다(Nasdaq 제공, 장전·장중·장후 거래 포함). 15초마다 갱신돼요.</p>
      <ul>
        <li>JOBY는 바이낸스에서 24시간 거래되지 않아, 미국 장이 닫힌 주말·새벽에는 마지막 거래 가격이 보여요.</li>
        <li><b>경쟁사 Archer(ACHR)</b>: 같은 전기 에어택시(eVTOL) 업체. 두 종목이 같이 움직이면 업계 전체 이슈, 반대로 움직이면 회사별 이슈일 가능성이 커요.</li>
      </ul>`,
    faa: `
      <p>조비가 에어택시로 승객을 태우려면 FAA(미국 연방항공청)의 <b>형식 인증(Type Certificate)</b>을 받아야 하고, 이 과정은 5단계로 나뉩니다.</p>
      <ul>
        <li><b>1단계 인증 기준</b> → <b>2단계 적합성 입증 방법</b> → <b>3단계 인증 계획</b>: 서류로 "무엇을 어떻게 증명할지" 합의하는 단계(완료).</li>
        <li><b>4단계 시험·분석</b>: 부품·시스템 시험 결과를 FAA에 제출하고 검토받는 단계.</li>
        <li><b>5단계 실증·검증</b>: FAA 기준대로 만든 기체로 FAA 조종사가 직접 인증 비행(TIA)을 하는 마지막 단계. 끝나면 형식 인증이 나와요.</li>
        <li><b>Joby / FAA</b>: Joby가 제출한 비율과 FAA가 검토·승인한 비율. FAA 쪽 숫자가 실제 진척에 더 가깝습니다.</li>
      </ul>
      <p>수치는 조비가 분기 실적 발표 때 주주서한에 공개하는 값이라 다음 발표 전까지는 그대로예요. 새 주주서한이 SEC에 올라오면 <b>서버가 3시간 안에 차트 숫자를 자동으로 읽어 반영</b>하고(출처에 "자동 반영" 표시), 읽지 못하면 이 카드 위에 알림이 떠요. 형식 인증 취득 뉴스가 나오면 그것도 바로 알려 줘요.</p>`,
    jearnings: `
      <p>조비는 아직 에어택시 상업 운항 전이라 <b>적자가 정상</b>입니다. 그래서 매출·이익보다 <b>현금이 얼마나 남았고, 얼마나 빨리 쓰는지</b>가 더 중요해요.</p>
      <ul>
        <li><b>현금·단기투자</b>: 현금 + 1년 안에 현금화할 수 있는 투자.</li>
        <li><b>분기 현금 소진</b>: 영업활동 현금흐름 + 설비투자. 최근 2분기 평균으로 "몇 년 버틸 수 있는지"를 계산해요(추가 투자 유치가 없다고 가정).</li>
        <li><b>매출</b>: 2025년 3분기부터 인수한 헬기 여객 사업(Blade) 매출이 포함돼요.</li>
        <li><b>EPS</b>: 적자라 음수예요. 예상보다 손실이 적으면 "양호".</li>
      </ul>`,
    sprice: (sym) => BN24[sym] ? INFO.price.replaceAll('CRCLUSDT', BN24[sym]).replace('미국 증시(NYSE)', '미국 증시(Nasdaq)').replace('실제 NYSE 주가', '실제 Nasdaq 주가') : `
      <p><b>${STOCK_INFO[sym].name}(${sym})</b>의 실시간 주가입니다. 미국 장전·장중·장후에는 <b>체결될 때마다 바로</b> 바뀌어요(Yahoo Finance 실시간 스트림). 스트림이 끊기면 Nasdaq 시세로 15초마다 갱신돼요.</p>
      <ul>
        ${BN24[sym] ? `<li><b>바이낸스 24시간</b>: 바이낸스의 ${sym}USDT 주식 선물(TradFi) 가격이에요. 미국 장이 닫힌 밤·주말에도 거래돼 다음 장 분위기를 미리 볼 수 있어요. 선물이라 실제 주가와 조금 차이가 나요("주가와 차이").</li>` : '<li>바이낸스에서 24시간 거래되지 않아, 미국 장이 닫힌 주말·새벽에는 마지막 거래 가격이 보여요.</li>'}
        ${STOCK_INFO[sym].peer ? `<li><b>경쟁사 ${STOCK_INFO[sym].peer[1]}(${STOCK_INFO[sym].peer[0]})</b>: ${STOCK_INFO[sym].peerNote}. 두 종목이 같이 움직이면 업계 전체 이슈, 반대로 움직이면 회사별 이슈일 가능성이 커요.</li>` : ''}
        ${sym === 'SPCX' ? '<li><b>공모가 대비</b>: 2026년 6월 상장 때 공모가($135)와 비교. 상장 1년이 안 돼 "52주" 대신 상장 후 최고가를 보여줘요.</li>' : ''}
      </ul>`,
    bonus: `
      <p><b>성과급 계산법</b>(2026년 기준 · 지급률은 회사 공지에 맞게 바꿔 넣으세요)</p>
      <ul>
        <li><b>삼성전자</b>: OPI = 연봉 × 지급률(최대 50%, 1월 지급) · TAI = 월 기본급 × 지급률(최대 100%, 상·하반기) · DS 부문 특별성과급은 영업이익 연동으로 상한이 없어 공지된 금액을 직접 넣어요.</li>
        <li><b>SK하이닉스</b>: PS = 월 기본급 × 지급률(2026년 2,964%, 영업이익 10% 재원) · PI = 월 기본급 × 지급률(상·하반기). 월 기본급은 보통 연봉 ÷ 20이에요. PS는 현금과 자사주로 나눠 받아요.</li>
        <li><b>세금</b>: 성과급은 근로소득이라 연봉과 합쳐 누진세율이 적용돼요. '성과급이 있을 때 − 없을 때' 1년 세금 차이(지방소득세 10% 포함)로 계산해서, 높은 세율 구간에 걸리는 만큼 떼는 비율이 커져요.</li>
        <li><b>4대보험</b>(근로자 부담): 건강보험 3.595% · 장기요양 = 건강보험료 × 13.14% · 고용보험 0.9%. 국민연금은 전년도 소득 기준이라 이번 성과급으로 바로 늘지 않아요.</li>
      </ul>
      <p>입력값은 이 기기에만 저장돼요. 실제 지급 때 떼는 금액(간이세액표)은 다를 수 있고 연말정산에서 정산돼요.</p>`,
    divsim: `
      <p>투자금을 종목별 비중대로 나눠 <b>현재가로 몇 주를 살 수 있는지</b>(소수점 주식 없이) 계산하고, 그 수량으로 <b>최근 1년 동안 실제로 나온 배당</b>을 받는다고 가정해 1년·한 달 배당을 보여줘요.</p>
      <ul>
        <li>원화 투자금은 지금 환율로 달러로 바꿔 계산해요(환전 수수료 제외).</li>
        <li>배당은 미국 원천징수 15%를 뺀 세후 금액이에요. 국내 금융소득이 연 2,000만원을 넘으면 종합과세 대상이 될 수 있어요.</li>
        <li>상장 1년이 안 된 ETF는 지금까지 낸 배당을 1년으로 늘려 계산해요.</li>
      </ul>`,
    krprice: `
      <p><b>한국 종목</b>의 시세예요. 네이버 증권 실시간 시세를 15초마다 받아요(원 단위).</p>
      <ul>
        <li><b>정규장</b>: 09:00~15:30. 장이 끝난 뒤에는 넥스트레이드(NXT) <b>시간외 가격</b>도 함께 보여줘요.</li>
        <li><b>차트</b>: Yahoo Finance 일봉·분봉. <b>투자 지표·투자자별 매매·애널리스트·분기 실적</b>은 네이버 증권 자료예요.</li>
        <li><b>공매도</b>: 한국거래소가 종목별 공매도 자료를 로그인한 사람에게만 보여줘서 아직 표시하지 못해요.</li>
        <li>Fire(퇴사까지·배당금)에도 넣을 수 있어요. 한국 종목은 원으로 계산하고 배당소득세 15.4%를 적용해요.</li>
      </ul>`,
    feargreed: EN ? `
      <p>The <b>Fear &amp; Greed Index</b> sums up investor mood as one number from 0 (extreme fear) to 100 (extreme greed): 0–24 extreme fear · 25–44 fear · 45–55 neutral · 56–75 greed · 76–100 extreme greed.</p>
      <ul>
        <li><b>US stocks (CNN)</b>: an equal-weighted average of 7 indicators — market momentum, stock price strength, breadth, put/call ratio, volatility (VIX), safe-haven demand and junk bond demand. It moves intraday.</li>
        <li><b>Crypto (alternative.me)</b>: built from bitcoin volatility, volume, social media, bitcoin dominance and Google Trends. Updates once a day (00:00 UTC).</li>
        <li>Markets often bounce after extreme fear and cool off after extreme greed, so many read it <b>contrarian</b>. Use it as context, not as a buy/sell signal on its own.</li>
      </ul>
      <p>Refreshed every 15 minutes. Sources: CNN Business Fear &amp; Greed Index, alternative.me Crypto Fear &amp; Greed Index.</p>` : `
      <p><b>공포·탐욕 지수</b>는 투자자들의 심리를 0(극단적 공포)~100(극단적 탐욕) 숫자 하나로 나타낸 거예요. 0~24 극단적 공포 · 25~44 공포 · 45~55 중립 · 56~75 탐욕 · 76~100 극단적 탐욕.</p>
      <ul>
        <li><b>미국 주식(CNN)</b>: 시장 모멘텀·주가 강도·시장 폭·풋/콜 비율·변동성(VIX)·안전자산 선호·정크본드 수요, 7개 지표를 같은 비중으로 평균해요. 장중에도 바뀌어요.</li>
        <li><b>코인(alternative.me)</b>: 비트코인 변동성·거래량·SNS 언급·비트코인 점유율·구글 검색 추세로 계산해요. 하루 한 번(한국 시간 오전 9시) 바뀌어요.</li>
        <li>극단적 공포 때 많이 떨어져 있다가 반등하거나, 극단적 탐욕 때 과열됐다가 조정받는 경우가 많아 <b>반대로 보는 지표</b>로도 써요. 단독으로 사고팔 근거로 쓰기보다는 분위기 참고용이에요.</li>
      </ul>
      <p>15분마다 새로 받아요. 출처: CNN Business Fear &amp; Greed Index, alternative.me Crypto Fear &amp; Greed Index.</p>`,
    market: `
      <p>미국 증시 전체 분위기예요(Yahoo Finance, 1분마다 새로).</p>
      <ul>
        <li><b>S&P500·나스닥·다우·러셀2000</b>: 대형주·기술주·우량주·중소형주 지수. 내 종목이 시장과 같이 움직였는지 비교해 보세요.</li>
        <li><b>VIX</b>: 공포지수. 20 아래면 안정, 30 넘으면 불안이 큰 시장.</li>
        <li><b>미 10년물 금리</b>: 오르면 성장주(조비·템퍼스 등)에 부담, 서클은 준비금 이자수익이 늘어요.</li>
        <li><b>달러지수·비트코인</b>: 달러 강세는 위험자산에 부담. 비트코인은 서클·암호화폐 심리와 연결돼요.</li>
        <li><b>지수 선물</b>: 미국 정규장이 닫힌 시간에도 거래돼 다음 장 분위기를 미리 보여줘요.</li>
        <li><b>🇰🇷 한국</b>: 코스피·코스닥(네이버 증권 실시간), 원·달러 환율, EWY(미국 증시에 상장된 한국 ETF). 한국 장이 닫힌 밤에는 EWY 등락이 다음 날 한국 증시 분위기를 미리 보여줘요(코스피200 야간선물은 무료로 받을 수 있는 자료가 없어 EWY로 대신해요).</li>
        <li><b>장 상태</b>: 미국 동부 시각 기준 장전(04:00~09:30)·정규장(09:30~16:00)·장후(16:00~20:00). 미국 공휴일은 구분하지 못해요.</li>
      </ul>`,
    kw: `
      <p>등록한 단어가 들어간 기사만 모아 최신순으로 보여줘요. 시장 전체 뉴스(CNBC·MarketWatch·연합뉴스·한국경제)와 내 종목 뉴스를 모두 찾아요.</p>
      <ul>
        <li>단어는 영어·한국어 모두 되고 대소문자는 구분하지 않아요(예: FOMC, 금리, tariff).</li>
        <li>앱을 보고 있을 때 새 키워드 기사가 들어오면 화면 아래에 알림이 떠요.</li>
        <li>키워드 목록은 이 기기에만 저장돼요.</li>
      </ul>`,
    options: `
      <p>옵션 거래로 본 <b>시장 참가자들의 기대</b>예요(CBOE 지연 시세, 약 15분 늦음).</p>
      <ul>
        <li><b>풋/콜 거래량 비율</b>: 오늘 풋(하락 대비) 거래량 ÷ 콜(상승 베팅) 거래량. 0.7 아래면 상승 베팅 우세, 1 넘으면 하락 대비 우세로 봐요.</li>
        <li><b>내재변동성(IV30)</b>: 옵션 가격에 들어 있는 앞으로 30일 변동성 예상(연율). 높을수록 큰 움직임을 예상.</li>
        <li><b>예상 변동폭</b>: 현재가에 가장 가까운 행사가의 콜+풋 가격 합 ÷ 주가. 그 만기까지 시장이 예상하는 위아래 움직임(대략 68% 확률 범위)이에요. 실적 발표가 들어간 만기는 실적 반응 크기를 가늠할 수 있어요.</li>
        <li><b>맥스 페인</b>: 만기 때 옵션 매수자들이 가장 많이 잃는 가격. 만기 무렵 주가가 이 근처로 끌린다는 속설이 있어요(참고용).</li>
        <li><b>미결제가 많이 쌓인 가격</b>: 콜이 많으면 저항, 풋이 많으면 지지로 보는 경우가 많아요.</li>
      </ul>`,
    prom: EN ? `
      <p>AI reads the company's <b>last two earnings releases</b> (SEC 8-K) and checks whether what it promised last time — guidance, launches, approvals, production — happened in the latest one.</p>
      <ul><li>✅ Done · ⏳ On track (kept or raised) · ⚠️ Delayed or cut · ❔ Not mentioned this time</li><li>🆕 New promises from the latest release — check them next quarter.</li><li>📰 Company press releases after the latest release update the status (done, delayed, or real progress such as a first test flight).</li></ul>
      <p>Built once per release from the original filings only. AI can misread; the links go to the originals.</p>` : `
      <p>회사의 <b>최근 두 번의 실적 발표문</b>(SEC 8-K 첨부 보도자료·주주서한)을 AI가 읽고, 지난번에 하겠다고 한 일(가이던스·출시·승인·생산 등)이 이번 발표에서 어떻게 됐는지 확인해요.</p>
      <ul><li>✅ 지켰어요 · ⏳ 진행 중(목표 유지·상향) · ⚠️ 늦어지거나 줄었어요 · ❔ 이번 발표에 언급 없음</li><li>🆕 이번 발표에서 새로 한 약속 — 다음 분기에 다시 확인해요.</li><li>📰 실적 발표 뒤에 나온 회사 보도자료로 완료·지연·진행 소식(예: 시범 비행 시작)을 반영해요.</li></ul>
      <p>실적 발표마다 한 번, 공시 원문만 근거로 만들어요. AI가 잘못 읽을 수 있으니 중요한 건 아래 원문 링크로 확인하세요.</p>`,
    fsum: EN ? `
      <p>The company's recent SEC filings — <b>8-K</b> (major events), <b>10-Q</b> (quarterly report), <b>10-K</b> (annual report) — summarized by AI in 3 lines each (in Korean).</p>
      <p>Each filing is summarized once from the original text (for 10-Q/10-K, the management discussion section). Last 6 months, up to 6 filings.</p>` : `
      <p>회사가 미국 SEC에 낸 최근 공시를 AI가 <b>한국어 3줄</b>로 정리했어요.</p>
      <ul><li><b>8-K</b>: 실적 발표·계약·임원 변동 같은 중요한 일이 생기면 4영업일 안에 내는 수시 공시</li><li><b>10-Q / 10-K</b>: 분기·연간 보고서 — 경영진이 직접 설명하는 부분(MD&A)을 읽어요</li></ul>
      <p>공시마다 한 번, 원문만 근거로 만들어요. 최근 6개월, 최대 6건.</p>`,
    earnday: EN ? `
      <p>This card appears only from <b>the day before to the day of</b> an earnings release and for <b>36 hours</b> after it.</p>
      <ul>
        <li><b>Before</b>: release time (KST), countdown, EPS estimate, the move implied by options, and how often recent quarters beat.</li>
        <li><b>After</b>: actual vs expected EPS and revenue, price reaction, the earnings 8-K, plus earnings news with AI summaries.</li>
        <li>During this window, earnings, analyst and news data refresh <b>every minute</b> (the server updates every 2–5 min).</li>
      </ul>
      <p>Release time is from Finviz (BMO = before open, AMC = after close). Until the company confirms the date, it's an estimate and may change.</p>` : `
      <p>실적 발표 <b>전날~당일</b>과 발표 후 <b>36시간</b> 동안만 나타나는 카드예요.</p>
      <ul>
        <li><b>발표 전</b>: 발표 시각(한국시간), 남은 시간, 예상 EPS, 옵션이 예상하는 실적 반응 폭, 최근 분기 예상 상회 횟수.</li>
        <li><b>발표 후</b>: EPS·매출 실제 vs 예상, 주가 반응, 실적 공시(8-K) 원문, 실적 관련 뉴스와 AI 요약.</li>
        <li>이 기간에는 실적·애널리스트·뉴스를 <b>1분마다</b> 새로 확인해요(서버는 2~5분마다 갱신).</li>
      </ul>
      <p>발표 시각은 Finviz 기준(BMO = 장 시작 전, AMC = 장 마감 후)이에요. 회사가 날짜를 공지하기 전엔 예상일이라 바뀔 수 있어요.</p>`,
    analyst: `
      <p>증권사 애널리스트들이 낸 <b>투자의견</b>(매수·보유·매도)과 <b>12개월 목표주가</b>를 모은 값이에요(Nasdaq 집계, 매월 갱신).</p>
      <ul>
        <li><b>매수 우위·중립·매도 우위</b>: (매수 − 매도) ÷ 전체 증권사 수로 판단해요. 40% 이상이면 매수 우위.</li>
        <li><b>평균 목표가와 현재가</b>: 평균 목표가가 현재가보다 높을수록 증권사들이 더 오를 여지가 있다고 본다는 뜻이에요. 현재가가 목표가를 넘으면 "목표가 초과".</li>
        <li><b>목표가 범위</b>: 가장 낮게 본 곳과 가장 높게 본 곳. 범위가 넓을수록 전망이 엇갈린다는 뜻이에요.</li>
      </ul>
      <p>⚠️ 목표가는 주가를 뒤늦게 따라가는 경우가 많아 참고용이에요.</p>`,
    insider: `
      <p>회사 <b>임원·이사·10% 이상 대주주</b>가 자기 회사 주식을 사고판 기록이에요. 미국은 거래 후 2영업일 안에 SEC에 <b>Form 4</b>로 신고해야 해요(Nasdaq 집계).</p>
      <ul>
        <li><b>장내 매수</b>: 내부자가 자기 돈으로 시장에서 산 것 — 가장 의미 있는 신호예요.</li>
        <li><b>매도</b>: 세금·생활비·분산 목적도 많아 하나하나에 큰 의미를 두지 않아요. 여러 임원이 한꺼번에 많이 팔면 주의.</li>
        <li><b>자동 매도/매수</b>: 미리 신고한 거래 계획(10b5-1)에 따라 정해진 날 자동으로 거래된 것.</li>
        <li><b>스톡옵션 행사</b>: 받은 옵션을 주식으로 바꾼 것(매매 판단과 무관).</li>
      </ul>`,
    holders: `
      <p>블랙록·뱅가드·JP모건 같은 <b>기관 투자자</b>가 이 종목을 얼마나 갖고 있는지입니다. 미국은 운용자산 1억 달러 이상 기관이 분기마다 <b>13F 보고서</b>로 보유 주식을 신고해야 해요(Nasdaq 집계).</p>
      <ul>
        <li><b>기관 보유 비율</b>: 발행 주식 중 기관이 가진 비율. 높을수록 큰손 수급 영향이 커요.</li>
        <li><b>직전 13F 대비</b>: 지난 분기 신고보다 주식을 늘린/줄인 기관 수와 주식 수. 늘린 곳이 많으면 기관 매수 우위로 봐요.</li>
        <li><b>상위 보유</b>: 보유 금액 순. <b>주요 금융사</b>: 이름이 알려진 대형 금융사만. <b>많이 산/판 곳</b>: 직전 분기 대비 주식 수 변화 순. 왼쪽 숫자는 순위예요(주요 금융사도 전체 보유 금액 기준 순위, 1~3위는 금색).</li>
        <li><b>지분</b>: 그 기관의 보유 주식 ÷ 발행 주식 수(Nasdaq 기준).</li>
        ${EN ? '<li><b>avg≈ (estimate)</b>: 13F filings have no purchase prices, so shares added in a quarter are priced at that quarter’s volume-weighted average price and older shares at the prior year’s average — a <b>rough</b> figure. <b>Avg price institutions paid last quarter</b> covers only shares bought or added in that quarter, so it’s fairly reliable: below today’s price means recent buyers are in profit, above means at a loss. Pre-IPO investors (VCs, strategic partners) paid far less.</li>' : `<li><b>평단≈ (추정)</b>: 13F에는 매입 가격이 없어서, 분기마다 늘린 주식은 그 분기의 평균 거래가(거래량 가중)로, 그 전부터 들고 있던 주식은 직전 1년 평균 거래가로 계산한 <b>대략적인 값</b>이에요. <b>최근 분기 기관 매입 평균가</b>는 그 분기에 새로 사거나 늘린 주식의 평균가라 비교적 정확하고, 지금 주가보다 낮으면 최근에 산 기관들이 수익, 높으면 손실 중이라는 뜻이에요. 상장 전 투자자(벤처캐피털·전략적 투자 회사)는 실제 평단이 훨씬 낮아요.</li>`}
      </ul>
      <p>⚠️ 분기 말 기준이고 45일 뒤에 신고하므로 <b>최대 4개월 늦은 정보</b>예요. 그 사이 사고판 것은 반영되지 않고, 공매도·옵션 포지션은 빠져 있어요.</p>`,
    lockup: `
      <p><b>보호예수(락업)</b>는 상장 전부터 주식을 가진 임직원·투자자가 상장 후 일정 기간 주식을 팔지 못하게 한 약속이에요. 풀리는 날엔 팔 수 있는 주식이 한꺼번에 늘어 <b>주가에 부담</b>이 될 수 있어요.</p>
      <ul>
        <li>스페이스X는 한 번에 풀지 않고 <b>여러 번 나눠서</b> 풉니다(투자설명서 424B4 기준). 일부는 날짜가 아니라 <b>실적 발표 2거래일 뒤</b>에 풀려요 — 이 날짜는 다음 실적 발표 예정일로 계산한 추정치예요.</li>
        <li>표시된 수량은 <b>최대</b> 해제 물량이에요. 실제로 시장에 파는 양은 훨씬 적을 수 있어요.</li>
        <li><b>추가 해제 조건</b>: 첫 실적 발표일까지 10거래일 중 5일 이상 종가가 공모가보다 30% 높으면(= $175.5 이상) 4.56억 주를 더 풀 수 있었는데, 종가가 $108~125여서 풀리지 않았어요.</li>
        <li>일론 머스크 보유분(64억 주)은 상장 366일 뒤인 2027년 6월 12일까지 묶여 있어요.</li>
        <li><b>자동 확인</b>: 서버가 3시간마다 스페이스X의 새 SEC 공시를 읽어, 보호예수 면제·조기 해제 문구나 주식 추가 매도 등록이 나오면 이 카드 위에 알림을 띄워요. 관련 뉴스도 함께 보여줘요.</li>
      </ul>`,
    searnings: `
      <p>분기마다 발표하는 <b>실적</b>입니다(미국 SEC 제출 재무제표 + Nasdaq 집계).</p>
      <ul>
        <li><b>매출·전년 대비</b>: 작년 같은 분기와 비교한 성장률이 성장주의 핵심 지표예요.</li>
        <li><b>매출총이익률</b>: (매출 − 매출원가) ÷ 매출. 높을수록 팔수록 남는 구조예요.</li>
        <li><b>영업이익·순이익</b>: 적자 → 흑자로 바뀌면 "흑자 전환"으로 표시해요.</li>
        <li><b>EPS와 예상</b>: 애널리스트 평균 예상치(Nasdaq·Zacks)와 비교해요. Nasdaq EPS는 일회성 비용을 뺀 조정 기준일 수 있어요.</li>
        <li><b>다음 실적 발표</b>: 회사가 공지하기 전에는 과거 패턴으로 추정한 날짜라 "예상일"로 표시돼요.</li>
      </ul>`,
    fire: `
      <p>보유한 주식의 <b>현재 원화 평가금액 ÷ 목표 금액</b>으로 퇴사(경제적 자유) 목표까지 얼마나 왔는지 보여줍니다.</p>
      <ul>
        <li><b>보유 종목</b>: 기본 종목과 관심 종목은 목록에서 고르고, 그 밖의 미국·한국 종목은 <b>🔍 검색</b>으로 찾아 넣어요. <b>📥 한 번에 넣기</b>로 증권 앱 보유 종목 캡처나 CSV 파일에서 수량·평단을 한꺼번에 채울 수도 있어요(사진·파일은 이 기기 안에서만 읽어요).</li>
        <li><b>평가금액</b> = 보유 수량 × 실시간 주가(Nasdaq, 장전·장중·장후 포함) × 실시간 원·달러 환율.</li>
        <li><b>평가손익</b>: 매수 금액(수량 × 평균 단가)과 비교. 평균 매수 환율을 입력하지 않으면 현재 환율로 환산합니다.</li>
        <li><b>목표 달성 가격</b>: 지금 환율이 그대로일 때 목표 금액이 되는 주가.</li>
        <li><b>24시간 추정</b>: 미국 장이 닫힌 주말·야간에도 바이낸스에서 24시간 거래되는 CRCL 가격으로, 다음 장 시작 시 예상 가격을 계산합니다(CRCA는 하루 수익률 2배 가정). 실제 개장가와 다를 수 있습니다.</li>
        <li><b>세후 기준</b>(선택): 해외주식 양도소득세(연 250만원 공제 후 22%)를 뺀 금액으로 계산합니다. 실제 세금은 다른 해외주식 손익·환율에 따라 달라집니다.</li>
      </ul>
      <p>⚠️ CRCA는 CRCL 하루 수익률의 2배를 따라가는 레버리지 ETF라, 오래 보유하면 등락이 반복될 때 CRCL 수익률의 2배와 차이가 나고(변동성 손실), 운용보수가 매일 빠집니다. 투자 조언이 아닌 개인 계산 도구입니다.</p>
      <p>🔒 보유 정보는 이 기기의 브라우저에만 저장됩니다.</p>`,
    div: `
      <p>매수 기록(종목·수량·평균 단가·<b>매수일</b>)과 각 종목의 실제 배당 내역으로 <b>지금까지 받은 배당금</b>과 <b>원금 회수</b> 정도를 계산해요.</p>
      <ul>
        <li><b>받을 자격</b>: 배당락일 <b>전날까지</b> 산 주식만 그 배당을 받아요(미국은 다음 날 결제). 매수일보다 뒤에 배당락일이 온 배당만 셉니다.</li>
        <li><b>받은 배당금</b>: 지급일이 지난 배당 × 그 매수 기록의 수량. 지급일은 Nasdaq 자료를 쓰고, 없으면 그 종목의 보통 지급 간격으로 추정해요.</li>
        <li><b>세후</b>: 미국 주식·ETF 배당은 지급 때 15%가 미국에서 원천징수돼 계좌에 85%가 들어와요(한·미 조세조약). 국내 상장 ETF나 다른 나라 주식은 세율이 다를 수 있어요.</li>
        <li><b>원금 회수</b>: 받은 배당금(세후) ÷ 매수 금액. 남은 금액을 연 예상 배당으로 나눠 '지금 속도면 몇 년'을 계산해요(배당이 늘거나 줄면 달라져요).</li>
        <li><b>연 예상 배당</b>: 최근 1년 동안 실제로 나온 주당 배당 × 지금 수량. <b>배당률</b>은 이 값 ÷ 평가금액, <b>YOC</b>(Yield on Cost)는 이 값 ÷ 매수 금액이에요.</li>
        <li><b>수량</b>: 주당 배당금은 주식 분할이 반영된 값이라, 지금 보유 중인 수량(분할 반영)으로 넣어야 맞아요. 판 주식은 빼고 남은 수량으로 넣어 주세요.</li>
        <li><b>금융소득종합과세</b>: 한 해 이자·배당이 2,000만원을 넘으면 다른 소득과 합쳐 과세될 수 있어요. 가까워지면 알려 드려요.</li>
        <li>원화 금액은 <b>현재 환율</b>로 바꾼 값이라 실제 입금 때 환율과 달라요.</li>
      </ul>
      <p>🔒 매수 기록은 이 기기의 브라우저에만 저장돼요. 투자 조언이 아닌 개인 계산 도구예요.</p>`,
    divMonth: `
      <p>지급일 기준으로 <b>최근 12개월 동안 받은 배당</b>(초록)과 <b>앞으로 12개월 예상</b>(회색)을 보여줘요.</p>
      <ul>
        <li><b>예상</b>: 최근 1년의 배당 일정과 금액이 그대로 반복된다고 보고 지금 수량으로 계산해요. 이미 발표된 다음 배당이 있으면 그 금액을 써요.</li>
        <li><b>연도별</b>: 해마다 실제로 받은 배당(지급일 기준) 합계예요.</li>
      </ul>`,
    fireSim: `
      <p>슬라이더를 움직이거나 버튼을 눌러, 주가가 그 값이 되면 <b>평가금액·달성률·손익</b>이 어떻게 되는지 확인할 수 있습니다(현재 환율 기준).</p>`,
    earnings: `
      <p>서클이 분기마다 발표하는 <b>실적</b>입니다(미국 SEC 제출 재무제표 + Nasdaq 집계).</p>
      <ul>
        <li><b>매출(총수익)</b>: 서클은 '총수익 및 준비금 수익'으로 보고합니다. 대부분(약 95%)이 USDC 준비금에서 나오는 <b>준비금 이자수익</b>이고, 나머지가 구독·서비스·거래 수수료 같은 <b>기타 매출</b>입니다.</li>
        <li><b>순이익·순이익률</b>: 모든 비용과 세금을 뺀 이익. 매출의 절반가량은 Coinbase 등에 주는 유통 비용으로 나갑니다.</li>
        <li><b>EPS(주당순이익)</b>와 <b>시장 예상</b>: 발표 전 애널리스트 평균 예상치와 비교합니다. 실적이 예상을 넘으면(상회) 보통 주가에 긍정적입니다.</li>
        <li><b>다음 실적 발표</b>: 서클이 날짜를 공식 공지하기 전에는 과거 발표 패턴으로 추정한 날짜(Zacks)이며 "예상일"로 표시됩니다. 보통 미국 장 마감 전 오전(한국 시간 저녁~밤)에 발표합니다.</li>
      </ul>`,
    news: `
      <p>서클 관련 <b>공시 · 서클 공식 발표 · 국내/해외 뉴스</b>를 모아 최신순으로 보여줍니다. 서버가 15분마다 새로 모읍니다.</p>
      <ul>
        <li><b>공시</b>: 미국 SEC EDGAR에서 새로고침 때마다 직접 받습니다(실패하면 서버가 모아 둔 목록). 주요 공시 = 8-K(합병·경영진 변경·실적 발표 등 중요한 일이 생기면 4영업일 내 제출), 10-Q(분기), 10-K(연간), 증권 발행(S-1·424B) 등.</li>
        <li><b>내부자 거래</b>: Form 4 = 임원·대주주가 주식을 사고판 뒤 2영업일 내 신고, Form 144 = 내부자가 주식을 팔 예정이라는 사전 신고. 매도가 몰리면 수급 부담 신호로 봅니다.</li>
        <li><b>○○ 관련</b>: 회사 공식 발표(Business Wire·회사 사이트)와, 제목에 회사 이름이 들어간 뉴스를 모았어요. 국내/해외 뉴스는 언어별 보기라 같은 기사가 겹칠 수 있어요.</li>
        <li><b>FAA 인증</b>(조비): FAA·인증·TIA·eIPP 같은 인증 관련 단어가 들어간 공시·뉴스만 모은 보기.</li>
        <li><b>한 줄 요약</b>: 기사 제목 아래 회색 글씨는 AI(Cloudflare Workers AI)가 기사 앞부분을 읽고 만든 한국어 요약이에요. 기사 원문을 못 받은 경우엔 제목만으로 풀어 쓴 것이라, 중요한 내용은 원문을 확인하세요. 새 기사는 요약이 붙기까지 몇 분 걸려요.</li>
        <li><b>업계 뉴스</b>: 조비 = UAM 전문 매체(eVTOL Insights·Urban Air Mobility News·FlightGlobal), 스페이스X = 우주 전문 매체(SpaceNews·NASASpaceflight·Spaceflight Now), 템퍼스 = 의료 전문 매체(STAT·MedCity News·Fierce Healthcare)의 AI·유전체·암 진단 기사만 받아요.</li>
        <li><b>암호화폐</b>: 서클 외 암호화폐 시장 전반 뉴스. 스팸·가짜 기사를 막기 위해 검색 대신 <b>검증된 전문 매체의 공식 RSS만</b> 받습니다(CoinDesk·Cointelegraph·Decrypt·The Block·블록미디어·토큰포스트). 매체 자기 도메인 링크만 허용하고, 광고·보도자료·프리세일·"100배" 같은 홍보성 문구가 있는 기사와 3일 지난 기사는 뺍니다.</li>
        <li><b>국내/해외 뉴스</b>: 구글 뉴스 검색 결과(최근 30일). 구글 뉴스는 휴대폰에서 직접 받을 수 없어, 개인 중계 서버(Cloudflare Worker)를 거쳐 새로고침 때마다 받습니다(최대 3분 캐시, 새로고침 버튼은 캐시 없이). 같은 제목은 하나로 합쳤습니다.</li>
        <li><b>NEW</b>: 지난번 이 탭을 본 이후 새로 올라온 항목. 하단 탭의 숫자도 같은 기준입니다(내부자 거래 공시 제외).</li>
      </ul>`,
    usdcflow: `
      <p>하루 동안 USDC가 <b>새로 발행된 양 − 소각(상환)된 양</b>입니다. DefiLlama 일별 공급량의 전날 대비 차이로 계산합니다.</p>
      <ul>
        <li><span class="up">빨강</span> = 순발행: 누군가 달러를 맡기고 USDC를 새로 받아감 → 서클 준비금 증가 → 이자수익 증가</li>
        <li><span class="down">파랑</span> = 순소각: USDC를 달러로 돌려받음 → 준비금 감소</li>
      </ul>
      <p>유통량 그 자체보다 <b>방향과 속도</b>를 빨리 알아챌 수 있는 지표입니다.</p>`,
    reserve: `
      <p>서클 매출의 대부분은 USDC 준비금(단기 미국 국채·현금)에서 나오는 이자입니다. 이 카드는 <b>USDC 유통량 × 미국 13주 국채 금리</b>로 연간 준비금 이자수익을 대략 추정합니다.</p>
      <ul>
        <li>금리는 미 재무부가 매일 발표하는 13주 T-bill 금리(쿠폰 환산)입니다.</li>
        <li><b>총액 기준</b>입니다. 실제로는 준비금 일부가 현금이라 수익률이 약간 낮고, Coinbase 등 유통 파트너에게 상당 부분을 나눠 줍니다(유통 비용). 그래서 서클 순수익은 이보다 작습니다.</li>
        <li><b>금리 민감도</b>: 금리가 0.25%p 내려가면 연간 수익이 얼마나 줄어드는지, USDC가 $10억 늘면 얼마나 느는지 보여줍니다. 서클 주가(CRCL)가 금리 인하 뉴스에 민감한 이유입니다.</li>
      </ul>`,
    arcactivity: `
      <p>Arc 체인에서 하루 동안 처리된 <b>트랜잭션 수</b>와 사용자들이 낸 <b>수수료(가스비) 합계</b>입니다(Arc 탐색기 통계).</p>
      <p>Arc는 수수료를 USDC로 받습니다. 트랜잭션·수수료가 꾸준히 늘면 서클이 만든 체인이 실제로 쓰이고 있다는 신호입니다. 에어드롭 기대감으로 인한 일시적 급증인지 함께 보세요.</p>`,
    price: `
      <p>바이낸스 <b>CRCLUSDT 무기한 선물</b>(TradFi 주식 선물)의 실시간 체결가입니다. 바이낸스와 직접 연결(WebSocket)해 거래가 체결될 때마다 바로 바뀝니다.</p>
      <ul>
        <li>미국 증시(NYSE) 휴장 시간·주말에도 24시간 거래되므로, 다음 날 개장가를 미리 가늠하는 용도로 쓸 수 있습니다. 실제 NYSE 주가와 약간 차이가 날 수 있습니다.</li>
        <li><b>24시간 변동</b>: 24시간 전 가격 대비 등락률(<span class="up">빨강=상승</span>, <span class="down">파랑=하락</span>).</li>
        <li><b>펀딩비</b>: 선물 가격을 현물(지수)에 맞추려고 롱·숏끼리 주고받는 수수료. 양수면 롱(상승 베팅)이 숏에게 지불 → 상승 베팅이 많다는 뜻. 표시 값은 <b>8시간마다 한 번</b> 정산되는 비율이에요(예: +0.0050% = 1만 달러어치 포지션이면 8시간에 0.5달러). 바이낸스 앱의 '펀딩비'와 같은 값이에요.</li>
        <li><b>미결제약정</b>: 아직 청산되지 않은 선물 포지션 규모(달러 환산). 늘면 새 자금이 들어오는 중입니다.</li>
      </ul>`,
    summary: `
      <p>아래 카드들의 숫자를 정해진 규칙으로 읽어 <b>자동으로 만든 요약</b>입니다(AI 해석이나 투자 조언이 아닙니다).</p>
      <ul>
        <li><span class="tone pos">긍정</span> 서클 실적·주가에 우호적으로 볼 수 있는 변화 (예: USDC 유통량 증가, Arc 사용 증가)</li>
        <li><span class="tone neg">주의</span> 부담이 될 수 있는 변화 (예: 공매도 비중 상승, Arc에서 자금 순유출)</li>
        <li><span class="tone neu">중립</span> 뚜렷한 방향이 없는 상태</li>
      </ul>
      <p>각 줄을 누르면 해당 카드로 이동합니다.</p>`,
    pricechart: `
      <p><b>캔들/라인</b>: 캔들은 시가·고가·저가·종가를 한 막대로(빨강 상승·파랑 하락), 라인은 종가만 이어요. <b>이동평균</b>: 최근 5·20·60·120개 캔들 종가 평균(노랑·분홍·초록·보라) — 주가가 이평선 위에 있으면 상승 추세로 봐요. <b>거래량</b>: 아래쪽 막대. 차트를 누르면 그 캔들의 값이 나와요.</p>
      <p>바이낸스 CRCLUSDT 선물의 가격 추이입니다. 기간을 바꾸면 봉 간격이 달라집니다(1일=15분, 1주=1시간, 1개월=4시간, 3개월=1일). <b>1년</b>은 바이낸스 선물이 상장한 지 1년이 안 돼 실제 주가(정규장, Yahoo) 주봉으로 그립니다. 마지막 점은 실시간 가격입니다.</p>
      <p>선이 <span class="up">빨강</span>이면 기간 시작보다 오른 상태, <span class="down">파랑</span>이면 내린 상태입니다.</p>`,
    short: `
      ${EN ? `<p><b>Short volume ratio</b> = the share of that day’s <b>off-exchange (FINRA-reported) volume</b> that was short sales. Source: FINRA daily Reg SHO short volume (CNMS file), posted the evening after each US session. Figures match FINRA’s raw file to the share.</p>
      <p>⚠️ <b>It does not mean “60% of all trading was short”.</b> FINRA’s file only covers trades reported off-exchange (dark pools, broker internalization), which is smaller than total volume across all exchanges. So the card also shows the <b>ratio to total market volume</b> (on-exchange short sales aren’t published, so that figure can be a bit low).</p>` : `<p><b>공매도 비율</b> = 그날 <b>장외(FINRA에 신고된) 거래</b> 중 공매도(빌린 주식을 파는 거래)로 체결된 비중입니다. 출처는 FINRA 일별 공매도 거래량(Reg SHO, CNMS 파일)이며, 미국 장 마감 후 저녁(한국 시간 다음 날 아침)에 전날 값이 올라옵니다. 숫자는 FINRA 원본 파일과 한 주 단위까지 같아요.</p>
      <p>⚠️ <b>"그날 거래의 60%가 공매도"라는 뜻은 아니에요.</b> FINRA 파일은 거래소 밖(장외·다크풀·증권사 내부 체결)에서 신고된 거래만 담고 있어서, 모든 거래소를 합친 전체 거래량보다 작습니다. 그래서 화면에 <b>그날 전체 거래량 대비 비율</b>도 함께 보여줘요(거래소 안에서 체결된 공매도는 공개되지 않아 이 값은 실제보다 조금 낮을 수 있어요).</p>`}
      <ul>
        <li><b>해석 주의</b>: 이 수치엔 시장조성자(마켓메이커)가 매수 주문을 받아주면서 잠깐 하는 공매도가 포함돼, 보통 종목도 40~50%대가 흔합니다. <b>절대 수준보다 평소(1개월 평균) 대비 얼마나 높아졌는지</b>를 보세요.</li>
        ${EN ? '<li><b>Off-exchange</b> is volume reported to FINRA (off-exchange and ATS); <b>total volume</b> is all exchanges combined (Yahoo).</li>' : '<li><b>장외 집계</b>는 FINRA에 보고된 장외·대체거래소 거래량, <b>전체 거래량</b>은 모든 거래소 합계(Yahoo)예요.</li>'}
        <li><b>공매도 잔고</b>: 아직 되갚지 않은 공매도 주식 수(월 2회 발표). 늘면 하락에 베팅하는 물량이 쌓이는 중입니다.</li>
        <li><b>커버 일수</b> = 공매도 잔고 ÷ 하루 평균 거래량. 공매도 세력이 전부 되사는 데 며칠 걸리는지로, 높을수록 급등(숏 스퀴즈) 때 되사기 압력이 큽니다.</li>
      </ul>`,
    stables: `
      <p><b>달러 스테이블코인 공급량</b>은 1달러에 가치를 고정한 토큰이 시장에 얼마나 풀려 있는지 보여줍니다. 1토큰 ≈ $1이므로 공급량 = 시가총액입니다.</p>
      <p><b>USDC 점유율</b> = USDC 공급량 ÷ 전체 달러 스테이블코인 공급량(DefiLlama 집계). 서클 매출의 대부분은 USDC 준비금(단기국채·현금)에서 나오는 이자라서, <b>USDC 유통량과 점유율은 서클 실적의 가장 직접적인 선행지표</b>입니다.</p>
      <ul>
        <li><b>1일 / 7일 / 30일</b>: 하루·7일·30일 전 대비 공급량 변화율. <span class="up">빨강=증가</span>, <span class="down">파랑=감소</span>.</li>
        <li><b>USYC</b>: 서클의 토큰화 단기국채 머니마켓펀드(이자가 붙는 토큰). 기관 담보·예치 수요를 보여줍니다.</li>
        <li><b>EURC</b>: 서클의 유로 스테이블코인(€ 기준, 서클 공식 발행량).</li>
        <li><b>BUIDL</b>: BlackRock 토큰화 MMF — USYC와 비교용.</li>
      </ul>
      <p>USYC·BUIDL은 점유율 계산에 포함되지만 결제용 스테이블코인과 성격이 달라 아래에 따로 표시합니다.</p>`,
    usdc: `
      <p>시장에 유통 중인 <b>USDC 총량</b>입니다. 헤드라인 숫자는 서클 공식 API의 현재 값(1분마다 갱신), 차트는 DefiLlama 일별 추이입니다.</p>
      <p>USDC가 1개 발행될 때마다 서클은 $1를 준비금으로 보관하고 그 이자를 수익으로 가져갑니다. 대략 <b>서클 준비금 수익 ≈ 평균 유통량 × 단기금리</b>이므로(여기서 Coinbase 등 유통 파트너 몫이 차감), 유통량 추세가 곧 매출 추세입니다.</p>`,
    eurc: `
      <p>서클이 발행한 <b>유로 스테이블코인 EURC</b>의 총 유통량(€)입니다. 헤드라인은 서클 공식 API 현재 값, 차트는 DefiLlama 일별 추이입니다.</p>
      <p>유럽 MiCA 규제 하에서 허가받은 유로 스테이블코인으로, USDC 외 사업 다각화 지표로 볼 수 있습니다.</p>`,
    products: `
      <p>서클 자체 상품인 <b>USYC(토큰화 MMF)</b>와 <b>EURC(유로 코인)</b>의 성장 속도를 비교합니다.</p>
      <p>규모가 크게 달라서 두 상품 모두 <b>기간 첫날 공급량을 100</b>으로 맞춘 지수로 그렸습니다. 예) 지수 600 = 시작 시점 대비 6배.</p>
      <p>USYC는 거래소·기관이 담보나 대기자금으로 쓰는 경우가 많아 크게 출렁일 수 있습니다.</p>`,
    chains: `
      <p>서클 공식 API 기준 <b>체인별 USDC 유통량</b> 상위 목록입니다. 어떤 블록체인에서 USDC가 많이 쓰이는지, Arc가 어느 위치까지 올라왔는지 확인할 수 있습니다.</p>`,
    tvl: `
      <p><b>TVL(Total Value Locked)</b>은 Arc 체인 위 DeFi 서비스(대출·DEX 등)에 예치된 자산의 달러 합계입니다(DefiLlama 일별).</p>
      <p>DefiLlama 기본 기준이라 <b>빌려 나간 금액은 제외</b>된 순수 예치 잔액입니다. Arc는 서클이 직접 만든 L1 블록체인으로, TVL이 늘수록 Arc 생태계에 돈이 모이고 있다는 뜻입니다.</p>`,
    dex: `
      <p>Arc 위 탈중앙화 거래소(Uniswap 등)에서 하루 동안 체결된 <b>거래 금액 합계</b>입니다(DefiLlama).</p>
      <p>헤드라인은 최근 24시간, 막대는 UTC 기준 하루 합계입니다. 거래가 많을수록 Arc가 실제로 "쓰이고" 있다는 신호이며, 가스비(USDC)도 함께 늘어납니다.</p>`,
    borrow: `
      <p>Arc의 대출 프로토콜(<b>Morpho Blue</b>, <b>Aave V4</b>)에서 사용자들이 빌려간 금액의 합계(차입 잔액)입니다.</p>
      <p>차입이 늘어난다는 건 USDC를 담보로 맡기고 빌리는 실제 금융 수요가 생기고 있다는 뜻입니다. 막대는 날짜별(UTC) 마지막 값이며, 오늘 막대는 현재 값입니다.</p>`,
    arcsupply: `
      <p>Arc 체인 위에 존재하는 <b>USDC와 EURC의 총량</b>(온체인 totalSupply)입니다. 과거는 날짜별(UTC 하루 끝) 값, 마지막 점은 현재 값입니다.</p>
      <p>USDC는 Arc의 가스(수수료) 토큰이기도 해서, 이 숫자는 <b>Arc로 들어온 달러 규모</b>를 가장 직접적으로 보여줍니다. 규모가 달라 두 개의 작은 차트로 나눴습니다.</p>`,
    lending: `
      <p>Arc 대출 시장의 일별 현황입니다(DefiLlama, Morpho Blue + Aave V4).</p>
      <ul>
        <li><b>차입</b>: 빌려 나간 금액.</li>
        <li><b>예치 잔액</b>: 예치된 자산 중 빌려 나가지 않고 남은 금액(DefiLlama TVL, 담보 포함).</li>
        <li><b>이용률</b> = 차입 ÷ (예치 잔액 + 차입). 총 예치 중 몇 %가 대출로 나가 있는지입니다. 높을수록 자금이 활발히 쓰인다는 뜻입니다.</li>
        <li><b>마일스톤</b>: 차입 합계가 각 금액을 처음 넘은 날. 초록 = 달성, 점선 = 다음 목표.</li>
      </ul>`,
    cirbtc: `
      <p><b>cirBTC</b>는 서클이 발행하는 래핑 비트코인으로, 실제 BTC를 1:1로 보관하고 발행합니다(8자리 소수, 준비금은 Chainlink 준비금 증명으로 공개).</p>
      <p>Arc와 Ethereum 컨트랙트의 발행량(totalSupply)을 날짜별로 조회해 그렸고, 마지막 점은 현재 공급량입니다. 늘어나면 BTC를 맡기고 cirBTC를 받아간(발행) 것, 줄면 BTC로 돌려받은(소각) 것입니다. 체인 간 이동이 있으면 한쪽이 줄고 다른 쪽이 늘 수 있어 <b>합계</b>를 함께 봅니다.</p>`,
    accounts: `
      <p>Arc에서 <b>하루 1회 이상 트랜잭션을 보낸 계정 수</b>입니다(Arc 탐색기 Blockscout 통계).</p>
      <ul>
        <li><b>신규</b>: 그날 처음 등장한 계정.</li>
        <li><b>재방문</b>: 활성 계정 − 신규 계정(이전에도 쓴 적 있는 계정).</li>
        <li><b>주간 재방문 비율</b>: 가장 최근에 끝난 한 주 동안 활성 계정 중 재방문 계정 비율. 에어드롭 파밍 같은 1회성 유입인지, 계속 돌아오는 실사용자인지 가늠하는 지표입니다.</li>
        <li><b>회색 막대</b>: 탐색기가 아직 집계 중인 잠정값(보통 다음 수집 때 확정되며 더 커집니다).</li>
      </ul>`,
    cctp: `
      <p><b>CCTP(Cross-Chain Transfer Protocol)</b>는 서클의 공식 USDC 브리지입니다. 한 체인에서 USDC를 소각하고 다른 체인에서 같은 양을 새로 발행하는 방식이라, 래핑 토큰 없이 네이티브 USDC가 이동합니다.</p>
      <p>최근 24시간 동안 Arc 온체인 이벤트를 직접 집계했습니다.</p>
      <ul>
        <li><span style="color:var(--c-blue)">■</span> <b>Arc로 유입</b>: 다른 체인에서 소각 → Arc에서 발행된 USDC.</li>
        <li><span style="color:var(--c-orange)">■</span> <b>Arc에서 유출</b>: Arc에서 소각 → 다른 체인으로 보낸 USDC.</li>
        <li><b>순유입</b> = 유입 − 유출. 음수면 Arc에서 돈이 빠져나가는 중입니다.</li>
      </ul>`,
  };

  // ---------------------------------------------------------------- 포맷
  const NF = new Map();
  const nf = (dp) => { let f = NF.get(dp); if (!f) NF.set(dp, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }))); return f; };
  function unit(v) {
    if (v == null || !isFinite(v)) return '–';
    if (v === 0) return '0';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (EN) { // 영어: K · M · B · T
      for (const [n, u] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (a >= n) return s + nf(a / n >= 100 ? 0 : 1).format(a / n) + u;
      return s + nf(a < 10 ? 2 : 0).format(a);
    }
    if (a >= 1e12) return s + nf(a >= 1e13 ? 0 : 1).format(a / 1e12) + '조';
    if (a >= 1e11) return s + nf(0).format(a / 1e8) + '억';
    if (a >= 1e8) return s + nf(1).format(a / 1e8) + '억';
    if (a >= 1e7) return s + nf(0).format(a / 1e4) + '만';
    if (a >= 1e4) return s + nf(a >= 1e6 ? 0 : 1).format(a / 1e4) + '만';
    return s + nf(a < 10 ? 2 : 0).format(a);
  }
  const usd = (v) => (v == null ? '–' : (v < 0 ? '-$' : '$') + unit(Math.abs(v)));
  const eur = (v) => (v == null ? '–' : '€' + unit(v));
  const btc = (v, dp = 0) => (v == null ? '–' : '₿' + nf(dp).format(v));
  const pct = (v, dp = 1) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '' : '') + (v * 100).toFixed(dp) + '%');
  const pctPlain = (v, dp = 1) => (v == null ? '–' : (v * 100).toFixed(dp) + '%');
  const pp = (v, dp = 2) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + (v * 100).toFixed(dp) + '%p');
  const cls = (v, eps = 1e-6) => (v == null || !isFinite(v) || Math.abs(v) < eps ? 'flat' : v > 0 ? 'up' : 'down');
  const arrow = (v) => (v == null || !isFinite(v) || Math.abs(v) < 1e-6 ? '–' : v > 0 ? '▲' : '▼');
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#'); // javascript: 같은 주소 차단
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const dtf = new Intl.DateTimeFormat(LOC, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const when = (t) => (t ? dtf.format(new Date(t)) : '–');
  const md = (ts) => { const d = new Date(ts * 1000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const ym = (ts) => { const d = new Date(ts * 1000); return `'${String(d.getUTCFullYear()).slice(2)}.${d.getUTCMonth() + 1}`; };
  const fullDay = (ts) => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`; };
  const isoToTs = (s) => Date.parse(s + 'T00:00:00Z') / 1000;

  function loadPref(k, dflt) { try { return localStorage.getItem('cw.' + k) || dflt; } catch { return dflt; } }
  function savePref(k, v) { try { localStorage.setItem('cw.' + k, v); } catch {} }

  // ---------------------------------------------------------------- 비교 기준(스냅샷)
  function current(key) {
    const last = (state.data?.snapshots || []).at(-1);
    const lv = state.live[key];
    if (lv && (!last?.t || Date.parse(lv.t) >= Date.parse(last.t))) return { v: lv.v, t: lv.t, live: true };
    return { v: last?.[key], t: last?.t, live: false };
  }
  // 서버가 늦어도 '직전/24시간 전 대비'가 맞도록, 동기화할 때마다 이 기기에 값을 기록해 둔다
  const SNAP_KEYS = ['usdcShare', 'usdcTotal', 'eurcTotal', 'arcUsdc', 'arcEurc', 'usycSupply', 'dex24h', 'tvl', 'borrow', 'util', 'cirbtc', 'cirbtcArc', 'cirbtcEth', 'cctpNet', 'shortRatio'];
  let localSnaps = [];
  try { localSnaps = JSON.parse(localStorage.getItem('cw.snaps') || '[]'); } catch {}
  function pushLocalSnap() {
    const last = localSnaps.at(-1);
    if (last && Date.now() - Date.parse(last.t) < 10 * 60 * 1000) localSnaps.pop(); // 10분 안의 기록은 최신 값으로 덮는다
    const snap = { t: new Date().toISOString() };
    for (const k of SNAP_KEYS) { const c = current(k); if (c.live && c.v != null) snap[k] = c.v; }
    if (Object.keys(snap).length < 3) return;
    const cutoff = Date.now() - 8 * 86400000;
    localSnaps = localSnaps.filter((x) => Date.parse(x.t) >= cutoff).concat(snap).slice(-800);
    try { localStorage.setItem('cw.snaps', JSON.stringify(localSnaps)); } catch {}
  }
  function base(key, curT) {
    const snaps = [...(state.data?.snapshots || []), ...localSnaps].filter((s) => s[key] != null).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const ct = Date.parse(curT);
    const older = snaps.filter((s) => Date.parse(s.t) < ct - 60 * 1000);
    if (!older.length) return null;
    if (state.basis === 'prev') return { v: older.at(-1)[key], t: older.at(-1).t };
    const target = ct - 24 * 3600 * 1000;
    let best = older[0];
    for (const s of older) if (Math.abs(Date.parse(s.t) - target) < Math.abs(Date.parse(best.t) - target)) best = s;
    return { v: best[key], t: best.t };
  }
  // 변화율(또는 %p) + "언제 수집 · 언제 대비" 문구
  function delta(key, { mode = 'pct' } = {}) {
    const c = current(key);
    const b = c.v != null ? base(key, c.t) : null;
    let d = null;
    if (b && b.v != null && c.v != null) d = mode === 'pp' ? c.v - b.v : b.v ? c.v / b.v - 1 : null;
    const txt = d == null ? '–' : mode === 'pp' ? pp(d) : pct(d, Math.abs(d) < 0.001 ? 2 : 1);
    // 24시간 전 스냅샷이 아직 없으면(배포 직후) 가장 오래된 수집과 비교했다고 밝힌다
    const short = b && state.basis === '24h' && Date.parse(c.t) - Date.parse(b.t) < 20 * 3600 * 1000;
    const basisName = state.basis === 'prev' ? '직전' : short ? '가장 오래된 수집' : '24시간 전';
    const w = b ? `${when(c.t)} ${c.live ? '실시간' : '수집'} · ${basisName}(${when(b.t)}) 대비` : `${when(c.t)} ${c.live ? '실시간' : '수집'} · 비교할 이전 수집 없음`;
    return { c, d, html: `<span class="${cls(d)}">${arrow(d)} ${txt}</span>`, when: w };
  }
  const deltaLine = (key, opts) => { const x = delta(key, opts); return `<div class="delta-line">${x.html}<span class="when">${x.when}</span></div>`; };

  // ---------------------------------------------------------------- 카드 틀
  // 카드 제목 아래에 늘 보이는 "쉽게 말하면" 한 줄(ⓘ를 누르지 않아도 처음 보는 사람이 이해할 수 있게)
  const EASY = {
    stables: "달러와 1:1로 바꿀 수 있는 '디지털 달러'들의 시장이에요. USDC가 서클이 만든 것이고, 점유율이 오르면 서클이 경쟁에서 이기고 있다는 뜻이에요.",
    usdc: '서클이 발행한 디지털 달러(USDC)가 지금 세상에 얼마나 풀려 있는지예요. 서클은 이만큼의 진짜 달러를 국채 등에 맡겨 이자를 버는데, 이게 매출의 대부분이라 이 숫자가 늘면 서클 매출도 늘어요.',
    usdcflow: '하루 동안 새로 만들어진 USDC(발행)에서 없어진 USDC(소각)를 뺀 값이에요. 플러스면 사람들이 달러를 맡기고 USDC를 더 받아 간 것, 마이너스면 USDC를 다시 달러로 바꿔 간 거예요.',
    reserve: 'USDC 뒤에는 같은 금액의 달러가 있고, 서클은 그 돈으로 미국 국채 이자를 받아요. 금리가 내리면 이자 수입이 줄고, USDC가 늘면 늘어요. 코인베이스 등 파트너와 나누기 전 금액이라 서클 실제 수입은 이보다 적어요.',
    eurc: 'USDC의 유로 버전이에요. 1유로 = 1 EURC. 아직 작지만 서클의 유럽 사업이 얼마나 크는지 보여줘요.',
    products: 'USDC 말고 서클이 직접 만든 다른 상품이에요. USYC는 국채 펀드를 코인으로 만든 것(이자가 붙는 달러), EURC는 유로 코인이에요.',
    chains: "USDC는 여러 블록체인(인터넷 위의 여러 '도로') 위에서 쓰여요. 어느 도로에 USDC가 많은지, 서클이 직접 만든 Arc가 몇 위인지 보여줘요.",
    tvl: "Arc는 서클이 직접 만든 블록체인이에요. TVL은 사람들이 Arc 위 금융 서비스(예금·대출·환전소)에 맡겨 둔 돈의 합계로, 은행으로 치면 '예금 잔액'이에요.",
    dex: "Arc 위의 '무인 환전소(DEX)'에서 하루 동안 사고판 금액이에요. 많을수록 Arc가 실제로 많이 쓰인다는 뜻이에요.",
    arcactivity: 'Arc에서 하루에 처리된 거래(송금·환전 등) 건수와 사람들이 낸 수수료예요. 수수료는 USDC로 내요.',
    borrow: 'Arc 위 대출 서비스에서 사람들이 빌려 간 돈의 합계예요. 빌리는 사람이 늘면 진짜 금융 수요가 생기고 있다는 신호예요.',
    lending: "맡긴 돈 중 몇 %가 대출로 나가 있는지(이용률)예요. 은행의 '예금 대비 대출 비율'과 비슷해요.",
    arcsupply: "Arc 위에 올라와 있는 USDC·EURC의 양이에요. Arc로 들어온 '돈의 크기'를 가장 직접적으로 보여줘요.",
    cirbtc: "서클이 진짜 비트코인을 맡아 두고 같은 양으로 발행한 '블록체인용 비트코인'이에요. 늘면 비트코인을 맡긴 사람이 늘었다는 뜻이에요.",
    cctp: '다른 블록체인에서 Arc로 들어온 USDC와 Arc에서 빠져나간 USDC예요. 플러스면 Arc로 돈이 모이는 중이에요.',
    accounts: "하루 동안 Arc를 쓴 지갑(계정) 수예요. '재방문'이 많을수록 한 번 쓰고 떠나는 게 아니라 계속 쓰는 사람이 많다는 뜻이에요.",
  };
  EASY.holders = EASY.sholders = "블랙록·뱅가드 같은 큰 기관(펀드)들이 이 주식을 얼마나 들고 있는지예요. 기관이 늘리면 큰손이 사 모으는 중이라는 뜻이고, '평단≈'은 기관들이 대략 얼마에 샀는지 추정한 값이에요.";
  // easy: 처음 보는 사람용 '💡 설명' — 제목 바로 옆 칩을 누르면 머리 아래에 펼쳐진다(자동 새로고침으로 다시 그려도 펼친 상태 유지)
  function card(id, { title, sub, info, easy, body, share }) {
    const el = document.getElementById('c-' + id);
    const open = state.openInfo.has(id);
    const ez = easy ?? EASY[id], ezOpen = state.openMore.has('easy:' + id);
    el.innerHTML = `
      <div class="card-h">
        <div class="card-hl"><div class="card-tt"><h3>${title}</h3>${ez ? `<button type="button" class="easy-btn" data-easy="${id}" aria-expanded="${ezOpen}" aria-controls="easy-${id}"><span aria-hidden="true">💡</span>${EN ? 'What’s this?' : '설명'}</button>` : ''}</div>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
        ${info ? `<button class="info-btn" type="button" data-info="${id}" aria-expanded="${open}" aria-controls="info-${id}" aria-label="${esc(title)} 설명">i</button>` : ''}
      </div>
      ${ez ? `<div class="easy-panel" id="easy-${id}" ${ezOpen ? '' : 'hidden'}>${ez}</div>` : ''}
      ${info ? `<div class="info" id="info-${id}" ${open ? '' : 'hidden'}>${info}</div>` : ''}
      ${body}${share ? `<button type="button" class="share-card-btn" data-sharecard="${share}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>${EN ? 'Share as image' : '이미지로 공유'}</button>` : ''}`;
    for (const d of el.querySelectorAll('details.more')) if (!d.querySelector(':scope > .more-close')) d.insertAdjacentHTML('beforeend', `<button type="button" class="more-close">${EN ? 'Collapse' : '접기'}</button>`);
    return el;
  }
  const failed = (id, title, msg) => card(id, { title, body: `<p class="err">데이터를 불러오지 못했습니다${msg ? ': ' + esc(msg) : ''}. 다음 수집 때 다시 시도합니다.</p>` });

  // ---------------------------------------------------------------- Chart.js 공통
  if (window.Chart) {
    Chart.defaults.color = C.muted;
    Chart.defaults.font.family = "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
    Chart.defaults.font.size = 10.5;
    Chart.defaults.animation = false;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.layout.padding = { right: 4 };
  }
  function axisX(labels, fmt, maxTicks = 6) {
    return {
      grid: { display: false },
      border: { color: C.line },
      ticks: { autoSkip: true, maxTicksLimit: maxTicks, maxRotation: 0, callback: (v) => fmt(labels[v]) },
    };
  }
  function axisY(fmt, extra = {}) {
    return {
      position: 'right',
      grid: { color: C.lineSoft, drawTicks: false },
      border: { display: false },
      ticks: { maxTicksLimit: 4, padding: 6, callback: (v) => fmt(v).replace(/\.0(?=[조억만KMBT])/, '') },
      ...extra,
    };
  }
  function tooltip(titleFmt, valFmt) {
    return {
      backgroundColor: C.surface2,
      borderColor: C.line,
      borderWidth: 1,
      titleColor: C.ink,
      bodyColor: C.ink2,
      titleFont: { family: 'Pretendard Variable, sans-serif', size: 12, weight: '600' },
      bodyFont: { size: 11.5 },
      padding: 10,
      boxWidth: 8, boxHeight: 8, boxPadding: 4, usePointStyle: true,
      callbacks: {
        title: (items) => titleFmt(items[0]),
        label: (it) => ` ${it.dataset.label}: ${valFmt(it.raw, it)}`,
      },
    };
  }
  const pendingCharts = {};
  function draw(id, cfg, after) {
    if (!window.Chart) return;
    if (EN) { // 캔버스 안 글자는 화면 번역기가 못 보므로 여기서 바꾼다(데이터셋 이름은 코드가 쓰므로 그대로 둔다)
      const cb = cfg.options?.plugins?.tooltip?.callbacks;
      if (cb) for (const k of Object.keys(cb)) { const f = cb[k]; if (typeof f === 'function') cb[k] = (...a) => { const r = f(...a); return Array.isArray(r) ? r.map(T) : T(r); }; }
      for (const sc of Object.values(cfg.options?.scales || {})) { const f = sc?.ticks?.callback; if (f) sc.ticks.callback = (...a) => T(f(...a)); }
    }
    charts[id]?.destroy();
    delete charts[id];
    const cv = document.getElementById('cv-' + id);
    if (!cv) return;
    if (cv.closest('.view')?.hidden) { pendingCharts[id] = { cfg, after }; return; }
    delete pendingCharts[id];
    charts[id] = new Chart(cv, cfg);
    after?.(charts[id]);
  }
  function flushCharts() {
    for (const [id, { cfg, after }] of Object.entries(pendingCharts)) {
      const cv = document.getElementById('cv-' + id);
      if (!cv) { delete pendingCharts[id]; continue; }
      if (cv.closest('.view')?.hidden) continue;
      delete pendingCharts[id];
      charts[id] = new Chart(cv, cfg);
      after?.(charts[id]);
    }
  }
  function areaFill(color) {
    return (ctx) => {
      const { chart } = ctx;
      const { ctx: g, chartArea } = chart;
      if (!chartArea) return color + '33';
      const grad = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      grad.addColorStop(0, color + '55');
      grad.addColorStop(1, color + '05');
      return grad;
    };
  }
  const lineDs = (label, data, color, extra = {}) => ({
    label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0,
    pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: C.surface, tension: 0.25, ...extra,
  });
  // 마지막 점만 강조
  const endPoint = (n, r = 4) => (ctx) => (ctx.dataIndex === n - 1 ? r : 0);

  const interaction = { mode: 'index', intersect: false };
  const noLegend = { legend: { display: false } };

  // ---------------------------------------------------------------- 캔들 차트 (+ 이동평균선 · 거래량 · 캔들/라인 전환)
  // Chart.js 범위 막대 두 겹으로 캔들을 그린다: 가는 막대 = 심지(저가~고가), 굵은 막대 = 몸통(시가~종가). 상승 빨강 · 하락 파랑
  // pts: [[시각(ms), 종가, 시가, 고가, 저가, 거래량], …] — 시가·고가·저가가 없으면 종가로 대신.
  // pts.pre: 화면에는 안 보이는 앞쪽 캔들(이동평균 계산용)
  const ohlc = (p) => { const c = p[1], o = p[2] ?? c; return { t: p[0], c, o, h: p[3] ?? Math.max(o, c), l: p[4] ?? Math.min(o, c), v: p[5] ?? null }; };
  function candleParts(K) {
    return {
      wick: K.map((k) => [k.l, k.h]),
      body: K.map((k) => {
        const lo = Math.min(k.o, k.c), hi = Math.max(k.o, k.c), min = (k.h - k.l || k.c * 0.002) * 0.06; // 시가=종가면 얇은 가로선
        return hi - lo < min ? [lo - min / 2, hi + min / 2] : [lo, hi];
      }),
      col: K.map((k) => (k.c >= k.o ? C.up : C.down)),
    };
  }
  const MA_SET = [[5, '#f2c94c'], [20, '#ff7eb6'], [60, '#4fd1a5'], [120, '#9b8cff']];
  state.chartType = loadPref('chartType', 'candle');
  state.chartMA = loadPref('chartMA', '1') === '1';
  state.chartVol = loadPref('chartVol', '1') === '1';
  // 차트 위 도구: 캔들/라인 · 이동평균 · 거래량 (모든 종목 공통, 이 기기에 기억)
  const chartTools = (id) => `<div class="ct-bar" role="group" aria-label="차트 보기 설정">
      <button type="button" data-ctype="candle" aria-pressed="${state.chartType !== 'line'}">캔들</button><button type="button" data-ctype="line" aria-pressed="${state.chartType === 'line'}">라인</button>
      <i class="ct-sep"></i>
      <button type="button" data-ctoggle="ma" aria-pressed="${state.chartMA}">이동평균</button><button type="button" data-ctoggle="vol" aria-pressed="${state.chartVol}">거래량</button>
    </div><div class="ct-legend" id="ctl-${id}"></div>`;
  function drawCandles(id, pts, { compact = false, xf = hm, tip = null, last = null, ind = false, fmt = price } = {}) { // fmt: 가격 표시(한국 종목은 원)
    if (!pts?.length) return;
    const pre = (pts.pre || []).map(ohlc), V = pts.map(ohlc), all = [...pre, ...V];
    if (last != null && isFinite(last)) { const k = V.at(-1); k.c = last; k.h = Math.max(k.h, last); k.l = Math.min(k.l, last); }
    const labels = V.map((k) => k.t), D = candleParts(V);
    const line = ind && state.chartType === 'line';
    const title = tip || ((it) => new Date(labels[it.dataIndex]).toLocaleString(LOC, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }));
    const ds = [];
    if (line) {
      const col = V.at(-1).c >= V[0].o ? C.up : C.down;
      ds.push(lineDs('종가', V.map((k) => k.c), col, { fill: 'start', backgroundColor: areaFill(col), pointRadius: endPoint(V.length, 3), borderWidth: 2, tension: 0.15, order: 1 }));
    } else {
      ds.push({ label: '저가~고가', data: D.wick, backgroundColor: D.col.slice(), borderWidth: 0, barThickness: compact ? 1 : 1.3, grouped: false, order: 2 });
      ds.push({ label: '시가~종가', data: D.body, backgroundColor: D.col.slice(), borderWidth: 0, barPercentage: 0.72, categoryPercentage: 1, maxBarThickness: 16, grouped: false, order: 1 });
    }
    // 이동평균: 앞쪽 캔들까지 포함해 계산하고 화면 구간만 그린다
    const maOut = [];
    if (ind && state.chartMA) {
      for (const [n, col] of MA_SET) {
        if (all.length < n + 2) continue;
        const ma = [];
        let sum = 0;
        for (let i = 0; i < all.length; i++) { sum += all[i].c; if (i >= n) sum -= all[i - n].c; ma.push(i >= n - 1 ? sum / n : null); }
        const shown = ma.slice(pre.length);
        if (!shown.some((x) => x != null)) continue;
        ds.push({ type: 'line', label: `MA${n}`, data: shown, borderColor: col, backgroundColor: col, borderWidth: 1.3, pointRadius: 0, pointHoverRadius: 0, tension: 0.2, spanGaps: true, order: 0 });
        maOut.push([n, col, shown.at(-1)]);
      }
    }
    const hasVol = ind && state.chartVol && V.some((k) => k.v > 0);
    if (hasVol) ds.push({ type: 'bar', label: '거래량', data: V.map((k) => k.v || 0), backgroundColor: V.map((k) => (k.c >= k.o ? C.up : C.down) + '55'), yAxisID: 'vol', barPercentage: 0.72, categoryPercentage: 1, maxBarThickness: 16, grouped: false, order: 3 });
    const maxVol = hasVol ? Math.max(...V.map((k) => k.v || 0)) : 0;
    // 세로축을 실제 가격 범위(캔들·이동평균)에 맞춰 빈 공간 없이
    const yLo = Math.min(...V.map((k) => k.l)), yHi = Math.max(...V.map((k) => k.h)), yPad = (yHi - yLo) * 0.08 || yHi * 0.01; // 캔들 기준(멀리 떨어진 이평선은 잘림)
    draw(id, {
      type: 'bar',
      data: { labels, datasets: ds },
      options: {
        interaction,
        plugins: {
          ...noLegend,
          tooltip: {
            ...tooltip(title, fmt), enabled: !compact,
            filter: (it) => it.dataset.label === (line ? '종가' : '시가~종가'),
            callbacks: {
              title: (items) => title(items[0]),
              label: (it) => {
                const k = charts[id]?.$V?.[it.dataIndex] || V[it.dataIndex];
                const out = [` 시가 ${fmt(k.o)} · 고가 ${fmt(k.h)}`, ` 저가 ${fmt(k.l)} · 종가 ${fmt(k.c)}`];
                if (k.v) out.push(` 거래량 ${unit(k.v)}`);
                const mas = it.chart.data.datasets.filter((d) => /^MA/.test(d.label) && d.data[it.dataIndex] != null).map((d) => `${d.label} ${fmt(d.data[it.dataIndex])}`);
                if (mas.length) out.push(' ' + mas.join(' · '));
                return out;
              },
            },
          },
        },
        scales: compact
          ? { x: { display: false }, y: { display: false, beginAtZero: false, grace: '6%' } }
          : {
            x: axisX(labels, xf, 5),
            y: { ...axisY(fmt), beginAtZero: false, min: yLo - yPad, max: yHi + yPad, ticks: { ...axisY(fmt).ticks, maxTicksLimit: 5 } },
            ...(hasVol ? { vol: { display: false, beginAtZero: true, max: maxVol * 4.5, grid: { display: false } } } : {}),
          },
      },
    });
    if (charts[id]) { charts[id].$V = V; charts[id].$line = line; } else if (pendingCharts[id]) pendingCharts[id].after = (c) => { c.$V = V; c.$line = line; };
    if (ind) setHtml('ctl-' + id, maOut.map(([n, col, v]) => `<span><i style="background:${col}"></i>MA${n} ${fmt(v)}</span>`).join('') + (hasVol ? `<span><i class="v"></i>거래량</span>` : ''));
  }
  // 실시간 체결가로 마지막 캔들(종가·고가·저가)만 고친다
  function liveCandle(id, last) {
    const c = charts[id], V = c?.$V;
    if (!V?.length || last == null || !isFinite(last) || c.canvas?.closest('.view')?.hidden) return;
    const i = V.length - 1, k = V[i];
    k.c = last; k.h = Math.max(k.h, last); k.l = Math.min(k.l, last);
    if (c.$line) { c.data.datasets[0].data[i] = last; c.update('none'); return; }
    const D = candleParts([k]), [w, b] = c.data.datasets;
    w.data[i] = D.wick[0]; b.data[i] = D.body[0];
    w.backgroundColor[i] = D.col[0]; b.backgroundColor[i] = D.col[0];
    const vd = c.data.datasets.find((d) => d.label === '거래량');
    if (vd) vd.backgroundColor[i] = D.col[0] + '55';
    c.update('none');
  }
  // 보여줄 구간만 남기고 앞쪽은 pts.pre로(이동평균 계산용)
  function splitView(all, keep) {
    const cut = Math.max(0, all.length - keep), view = all.slice(cut);
    view.pre = all.slice(0, cut);
    return view;
  }
  // Yahoo 차트: 서버는 앞쪽 기간까지 보내므로 기간에 맞게 자른다(1일 = 마지막 거래일)
  function yahooView(points, r) {
    if (!points?.length) return points || [];
    const last = points.at(-1)[0];
    let from;
    if (r === '1d') { const d = etDate(last); from = points.findIndex((p) => etDate(p[0]) === d); }
    else { const days = { '1w': 7, '1m': 31, '3m': 92, '1y': 366 }[r] || 31; from = points.findIndex((p) => p[0] >= last - days * 86400000); }
    return splitView(points, points.length - Math.max(0, from));
  }

  // ---------------------------------------------------------------- 섹션 렌더
  function renderKpis() {
    const tiles = [
      { k: 'USDC 유통량', key: 'usdcTotal', f: usd, go: 'usdc:c-usdc' },
      { k: 'USDC 점유율', key: 'usdcShare', f: (v) => pctPlain(v, 2), mode: 'pp', go: 'usdc:c-stables' },
      { k: '서클 공매도 비율', key: 'shortRatio', f: (v) => pctPlain(v), mode: 'pp', go: 'crcl:c-short' },
      { k: '연 준비금 수익(추정)', key: 'reserve', go: 'usdc:c-reserve' },
      { k: 'USDC 7일 순발행', key: 'netMint7', go: 'usdc:c-usdcflow' },
      { k: 'EURC 유통량', key: 'eurcTotal', f: eur, go: 'usdc:c-eurc' },
      { k: 'cirBTC 공급', key: 'cirbtc', f: (v) => btc(v), go: 'arc:c-cirbtc' },
      { k: 'Arc DeFi TVL', key: 'tvl', f: usd, go: 'arc:c-tvl' },
      { k: 'Arc 차입 잔액', key: 'borrow', f: usd, go: 'arc:c-borrow' },
      { k: 'Arc DEX 24시간', key: 'dex24h', f: usd, go: 'arc:c-dex' },
      { k: 'CCTP 순유입 24h', key: 'cctpNet', f: usd, abs: true, go: 'arc:c-cctp' },
      { k: 'Arc 위 USDC', key: 'arcUsdc', f: usd, go: 'arc:c-arcsupply' },
    ];
    document.getElementById('kpis').innerHTML = tiles.map((t) => {
      const x = delta(t.key, { mode: t.mode });
      let dh = x.html;
      if (t.key === 'reserve') {
        const r = reserveEstimate();
        x.c = { v: r?.annual, live: x.c.live };
        t.f = usd;
        dh = `<span class="flat">금리 ${r ? (r.rate * 100).toFixed(2) + '%' : '–'} 기준</span>`;
      }
      if (t.key === 'netMint7') {
        const f = usdcNetMint();
        const s7 = f.slice(-7).reduce((a, p) => a + p[1], 0), p7 = f.slice(-14, -7).reduce((a, p) => a + p[1], 0);
        x.c = { v: s7, live: false };
        t.f = (v) => (v < 0 ? '-' : '+') + usd(Math.abs(v));
        dh = `<span class="flat">직전 7일 ${(p7 < 0 ? '-' : '+') + usd(Math.abs(p7))}</span>`;
      }
      if (t.key === 'shortRatio') { // 일별 데이터라 전 거래일 대비로 표시
        const sd = state.data.short?.daily || [];
        const a = sd.at(-1), b = sd.at(-2);
        x.c = { v: a?.ratio, live: false };
        const dd = a && b ? a.ratio - b.ratio : null;
        dh = `<span class="${cls(dd)}">${arrow(dd)} ${pp(dd, 1)}</span>`;
      }
      if (t.abs) { // 순유입은 부호가 바뀔 수 있어 변화율 대신 증감액
        const b = x.c.v != null ? base(t.key, x.c.t) : null;
        const diff = b && b.v != null ? x.c.v - b.v : null;
        dh = `<span class="${cls(diff, 1)}">${arrow(diff)} ${diff == null ? '–' : (diff > 0 ? '+' : '') + usd(diff)}</span>`;
      }
      return `<button type="button" class="kpi" data-go="${t.go}"><div class="k">${t.k}${x.c.live ? '<span class="live-dot" title="실시간"></span>' : ''}</div>
        <div class="v">${t.f(x.c.v)}</div><div class="d">${dh}</div></button>`;
    }).join('') + analystTiles('CRCL').join('');
  }

  function renderStables() {
    const s = state.data.stables;
    if (!s) return failed('stables', '달러 스테이블코인 공급량', state.data.errors?.stables);
    const eurcOfficial = current('eurcTotal').v, usdcOfficial = current('usdcTotal').v, shareNow = current('usdcShare').v;
    // EURC 목록 값은 달러 환산이 섞여(서클 공식보다 ~17% 큼) 증감률에 환율 변동이 들어간다 → 유로 단위 일별 기록으로 다시 계산
    const eurcCh = (() => {
      const S = state.data.series?.eurc, last = S?.at(-1);
      if (!last || Date.now() / 1000 - last[0] > 3 * 86400) return null;
      const at = (n) => { const p = S.findLast((q) => q[0] <= last[0] - n * 86400); return p?.[1] > 0 ? last[1] / p[1] - 1 : null; };
      return { ch1: at(1), ch7: at(7), ch30: at(30) };
    })();
    const row = (r, isProduct) => {
      if (r.sym === 'EURC' && eurcCh) r = { ...r, ...eurcCh };
      const hl = r.sym === 'USDC' ? ' class="hl"' : '';
      const off = r.sym === 'USDC' && usdcOfficial;
      const supply = r.cur === 'EUR' ? eur(r.sym === 'EURC' && eurcOfficial ? eurcOfficial : r.supply) : usd(off ? usdcOfficial : r.supply);
      const sh = off && shareNow != null ? shareNow : r.share;
      const share = isProduct ? '<td class="dim">–</td>' : `<td>${pctPlain(sh)}<span class="share-bar"><i style="width:${Math.min(100, sh * 100 / 0.6)}%"></i></span></td>`;
      return `<tr${hl}><td class="name"><b>${r.sym}</b><span>${esc(r.issuer)}</span></td><td>${supply}</td>${share}
        <td class="${cls(r.ch1, 5e-5)}">${r.ch1 == null ? '–' : Math.abs(r.ch1) < 5e-5 ? '0.00%' : pct(r.ch1, Math.abs(r.ch1) < 0.001 ? 2 : 1)}</td><td class="${cls(r.ch7, 5e-5)}">${pct(r.ch7)}</td><td class="${cls(r.ch30, 5e-5)}">${pct(r.ch30)}</td></tr>`;
    };
    const x = delta('usdcShare', { mode: 'pp' });
    card('stables', {
      title: '달러 스테이블코인 공급량',
      sub: '경쟁 코인과 서클 자체 상품 · DefiLlama (USDC는 서클 공식 값)',
      info: INFO.stables,
      body: `
        <div class="headline"><span class="lbl">USDC 점유율</span><span class="big">${pctPlain(x.c.v)}</span>${x.html.replace('class="', 'style="font:500 13px var(--mono)" class="')}</div>
        <div class="delta-line"><span class="when">${x.when} · 전체 달러 스테이블코인 ${usd(s.totalUsd)}</span></div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>달러 스테이블코인</th><th>공급량</th><th>점유율</th><th>1일</th><th>7일</th><th>30일</th></tr></thead>
          <tbody>${s.rows.map((r) => row(r, false)).join('')}
            <tr class="sub-h"><th>서클 자체 상품 · 비교</th><th>공급량</th><th></th><th>1일</th><th>7일</th><th>30일</th></tr>
            ${s.products.map((r) => row(r, true)).join('')}
          </tbody></table></div>`,
    });
  }

  function seriesCard(id, { title, sub, key, fmt, series, color, info }) {
    if (!series?.length) return failed(id, title, state.data.errors?.series);
    const x = delta(key);
    const pts = series.slice();
    const liveNow = x.c.v;
    const nowTs = Math.floor(Date.parse(x.c.t) / 1000);
    if (liveNow != null && nowTs > pts.at(-1)[0]) pts.push([nowTs, liveNow]);
    const labels = pts.map((p) => p[0]);
    card(id, {
      title, sub, info,
      body: `<div class="headline"><span class="big">${fmt(liveNow)}</span></div>${deltaLine(key)}
        <div class="chart"><canvas id="cv-${id}" role="img" aria-label="${esc(title)} 추이"></canvas></div>`,
    });
    draw(id, {
      type: 'line',
      data: { labels, datasets: [lineDs(title, pts.map((p) => p[1]), color, { fill: 'start', backgroundColor: areaFill(color), pointRadius: endPoint(pts.length), pointBackgroundColor: color })] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => fullDay(labels[it.dataIndex]), (v) => fmt(v)) },
        scales: { x: axisX(labels, ym, 5), y: axisY(fmt) },
      },
    });
  }

  function renderProducts() {
    const s = state.data.series;
    if (!s?.usyc?.length) return failed('products', '서클 자체 상품: USYC · EURC', state.data.errors?.series);
    const eMap = new Map(s.eurc.map((p) => [p[0], p[1]]));
    const joined = s.usyc.filter((p) => eMap.has(p[0]) && p[1] > 0 && eMap.get(p[0]) > 0);
    const b0u = joined[0][1], b0e = eMap.get(joined[0][0]);
    const labels = joined.map((p) => p[0]);
    const usycNow = state.data.stables?.products?.find((p) => p.sym === 'USYC')?.supply ?? joined.at(-1)[1];
    card('products', {
      title: '서클 자체 상품: USYC · EURC',
      sub: `기간 시작(${fullDay(labels[0])})을 100으로 맞춘 공급량 지수 · DefiLlama · USYC 10/15부터 CoinGecko`,
      info: INFO.products,
      body: `<div class="headline"><span class="big" style="font-size:clamp(20px,5.6vw,26px)">USYC ${usd(usycNow)} · EURC ${eur(current('eurcTotal').v)}</span><span class="lbl">현재 공급량</span></div>
        <div class="chart"><canvas id="cv-products" role="img" aria-label="USYC와 EURC 공급량 지수"></canvas></div>
        <div class="legend"><span><i class="line" style="background:${C.teal}"></i>USYC (토큰화 MMF)</span><span><i class="line" style="background:${C.purple}"></i>EURC (유로)</span></div>`,
    });
    draw('products', {
      type: 'line',
      data: {
        labels,
        datasets: [
          lineDs('USYC', joined.map((p) => (p[1] / b0u) * 100), C.teal, { pointRadius: endPoint(joined.length) }),
          lineDs('EURC', joined.map((p) => (eMap.get(p[0]) / b0e) * 100), C.purple, { pointRadius: endPoint(joined.length) }),
        ],
      },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => fullDay(labels[it.dataIndex]), (v) => v.toFixed(1)) },
        scales: { x: axisX(labels, ym, 5), y: axisY((v) => v.toFixed(0), { beginAtZero: true }) },
      },
    });
  }

  function renderChains() {
    const c = state.usdcChains || state.data.circle?.usdcChains;
    if (!c?.length) return failed('chains', '체인별 USDC 유통량', state.data.errors?.circle);
    const top = c.slice(0, 10);
    const max = top[0].amount;
    const arc = c.find((x) => x.chain === 'ARC');
    const rank = arc ? c.findIndex((x) => x.chain === 'ARC') + 1 : null;
    const name = (k) => ({ ETH: 'Ethereum', SOL: 'Solana', BASE: 'Base', ARB: 'Arbitrum', ARC: 'Arc', AVAX: 'Avalanche', MATIC: 'Polygon', POLY: 'Polygon', OP: 'OP Mainnet', APTOS: 'Aptos', ALGO: 'Algorand', XLM: 'Stellar', SUI: 'Sui', NOBLE: 'Noble', HBAR: 'Hedera', WORLDCHAIN: 'World Chain', UNI: 'Unichain', LINEA: 'Linea', SEI: 'Sei', CELO: 'Celo', HYPEREVM: 'HyperEVM', ZKS: 'ZKsync', NEAR: 'NEAR', SONIC: 'Sonic', PLASMA: 'Plasma', MONAD: 'Monad', INK: 'Ink', XDC: 'XDC', CODEX: 'Codex', PLUME: 'Plume', BNB: 'BNB Chain' }[k] || k);
    card('chains', {
      title: '체인별 USDC 유통량',
      sub: '서클 공식 API · 상위 10개 체인',
      info: INFO.chains,
      body: `${arc ? `<div class="headline"><span class="lbl">Arc 순위</span><span class="big">${rank}위</span><span class="lbl">${usd(arc.amount)}</span></div>` : ''}
        <div class="chain-list">${top.map((x) => `<div class="chain-row"><span class="cn">${esc(name(x.chain))}</span><span class="cb"><i style="width:${(x.amount / max) * 100}%;${x.chain === 'ARC' ? `background:${C.teal}` : ''}"></i></span><span class="cv">${usd(x.amount)}</span></div>`).join('')}</div>`,
    });
  }

  // 하루 새 ±30% 넘게 바뀐 값은 사흘 이어질 때까지 반영하지 않고 직전 확정값을 쓴다(collector/collect.mjs cleanArcTvl과 같은 규칙).
  // DefiLlama가 새 풀을 편입하거나 가격을 잘못 잡으면 하루에 크게 튄다(2026-10-19 Uniswap V4 Arc $4M→$271M, 거래액은 그대로).
  function cleanArcTvl(daily, now) {
    const pts = daily.slice();
    if (now != null && pts.length) { if (Date.now() / 1000 - pts.at(-1)[0] < 86400) pts[pts.length - 1] = [pts.at(-1)[0], now]; else pts.push([Math.floor(Date.now() / 1000), now]); }
    let i = -1;
    for (let k = pts.length - 1; k > 0; k--) if (pts[k - 1][1] > 0 && Math.abs(pts[k][1] / pts[k - 1][1] - 1) >= 0.3) { i = k; break; }
    if (i < 1 || pts.length - i >= 3 || pts[i - 1][1] < 1e7) return { now, daily };
    return { now: pts[i - 1][1], daily: daily.filter((p) => p[0] < pts[i][0]), held: { raw: now, from: pts[i][0], prev: pts[i - 1][1], prevAt: pts[i - 1][0] } };
  }
  function renderTvl() {
    const t = state.data.arcTvl;
    if (!t) return failed('tvl', 'Arc DeFi TVL', state.data.errors?.arcTvl);
    const pts = t.daily.slice();
    const lastSnap = current('tvl');
    const nowTs = Math.floor(Date.parse(lastSnap.t) / 1000);
    if (t.now != null && nowTs > pts.at(-1)[0] + 3600) pts.push([nowTs, t.now]);
    else pts[pts.length - 1] = [pts.at(-1)[0], t.now];
    const labels = pts.map((p) => p[0]);
    // 하루 새 ±30% 넘게 변하면 실제 자금 이동보다 DefiLlama 집계 변화(새 풀 편입·가격 오류·누락 후 복구)인 경우가 많다 — 확인 필요로 표시
    const H = t.held;
    card('tvl', {
      title: 'Arc DeFi TVL', sub: '대출·DEX 등에 예치된 자산 · DefiLlama 일별', info: INFO.tvl,
      body: `<div class="headline"><span class="big">${usd(t.now)}</span></div>${deltaLine('tvl')}
        ${H ? `<p class="note">${EN ? `Confirmed value as of ${md(H.prevAt)}. DefiLlama's latest figure (${usd(H.raw)}, ${pct(H.raw / H.prev - 1, 0)} in a day) jumped too far in one day to trust yet — it's added once it holds for 3 days.` : `${md(H.prevAt)} 확정값이에요. DefiLlama 최신 값(${usd(H.raw)}, 하루 ${pct(H.raw / H.prev - 1, 0)})은 하루 새 너무 크게 바뀌어 집계 오류일 수 있어서, 사흘 이어지면 반영해요.`}</p>` : ''}
        <div class="chart"><canvas id="cv-tvl" role="img" aria-label="Arc TVL 추이"></canvas></div>`,
    });
    draw('tvl', {
      type: 'line',
      data: { labels, datasets: [lineDs('TVL', pts.map((p) => p[1]), C.blue, { fill: 'start', backgroundColor: areaFill(C.blue), pointRadius: endPoint(pts.length), tension: 0.15 })] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => fullDay(labels[it.dataIndex]), usd) },
        scales: { x: axisX(labels, md), y: axisY(usd, { beginAtZero: true }) },
      },
    });
  }

  function renderDex() {
    const x = state.data.arcDex;
    if (!x) return failed('dex', 'Arc DEX 거래액', state.data.errors?.arcDex);
    const pts = x.daily.slice(-14);
    const labels = pts.map((p) => p[0]);
    const top = (x.top || []).slice(0, 4);
    // 24시간 값이 최근 7일 중간값의 3배 이상이면 급증 표시 — 실제 거래 몰림인지 집계 오류인지 확인 전
    const prev7 = x.daily.slice(-8, -1).map((p) => p[1]).sort((a, b) => a - b), med = prev7[3];
    const spike = prev7.length === 7 && med > 0 && x.total24h >= med * 3 ? x.total24h / med : 0;
    card('dex', {
      title: 'Arc DEX 거래액', sub: '일별 · DefiLlama', info: INFO.dex,
      body: `<div class="headline"><span class="big">${usd(x.total24h)}</span><span class="lbl">최근 24시간 · 7일 합계 ${usd(x.total7d)}</span></div>${deltaLine('dex24h')}
        ${spike ? `<p class="note">⚠️ ${EN ? `Spike, checking: about ${spike.toFixed(1)}× the usual level (7-day median ${usd(med)}). It may be a real burst of trading or a DefiLlama counting error, so watch whether it continues.` : `급증, 확인 중: 평소(최근 7일 중간값 ${usd(med)})의 약 ${spike.toFixed(1)}배예요. 실제로 거래가 몰린 건지 DefiLlama 집계 오류인지 아직 몰라요. 며칠 이어지는지 함께 보세요.`}</p>` : ''}
        <div class="chart"><canvas id="cv-dex" role="img" aria-label="Arc DEX 일별 거래액"></canvas></div>
        ${top.length ? `<p class="note">24시간 상위: ${top.map((p) => `${esc(p.name)} ${usd(p.v)}`).join(' · ')}</p>` : ''}`,
    });
    draw('dex', {
      type: 'bar',
      data: { labels, datasets: [{ label: '거래액', data: pts.map((p) => p[1]), backgroundColor: C.orange, hoverBackgroundColor: C.orange + 'cc', borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 26 }] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => fullDay(labels[it.dataIndex]) + ' (UTC)', usd) },
        scales: { x: axisX(labels, md, 7), y: axisY(usd, { beginAtZero: true }) },
      },
    });
  }

  // 메인넷 이전 테스트성 값($1 등)을 빼고, 차입이 의미 있게 이어지는 구간만 쓴다
  function lendingDays() {
    const all = state.data.lending?.days || [];
    let i = all.length;
    while (i > 0 && all[i - 1].borrow >= 1000) i--;
    return all.slice(i);
  }

  function renderBorrow() {
    const L = state.data.lending;
    if (!L?.days?.length) return failed('borrow', 'Arc 대출 차입 잔액 추이', state.data.errors?.lending);
    const days = lendingDays().slice(-12);
    const labels = days.map((r) => r.d);
    const last = L.days.at(-1);
    card('borrow', {
      title: 'Arc 대출 차입 잔액 추이', sub: '프로토콜별 일별 · DefiLlama', info: INFO.borrow,
      body: `<div class="headline"><span class="lbl">차입 잔액</span><span class="big">${usd(last.borrow)}</span></div>${deltaLine('borrow')}
        <div class="chart"><canvas id="cv-borrow" role="img" aria-label="프로토콜별 차입 잔액"></canvas></div>
        <div class="legend"><span><i style="background:${C.blue}"></i>Morpho Blue</span><span><i style="background:${C.teal}"></i>Aave V4</span></div>`,
    });
    const bar = (label, key, color) => ({
      label, data: days.map((r) => r[key] || 0), backgroundColor: color, borderColor: C.surface, borderWidth: { top: 2 },
      borderSkipped: 'bottom', maxBarThickness: 26, stack: 's',
    });
    draw('borrow', {
      type: 'bar',
      data: { labels, datasets: [bar('Morpho Blue', 'morphoB', C.blue), { ...bar('Aave V4', 'aaveB', C.teal), borderRadius: { topLeft: 4, topRight: 4 } }] },
      options: {
        interaction,
        plugins: {
          ...noLegend,
          tooltip: {
            ...tooltip((it) => fullDay(labels[it.dataIndex]), usd),
            callbacks: {
              title: (items) => fullDay(labels[items[0].dataIndex]),
              label: (it) => ` ${it.dataset.label}: ${usd(it.raw)}`,
              footer: (items) => `합계 ${usd(days[items[0].dataIndex].borrow)}`,
            },
          },
        },
        scales: { x: { ...axisX(labels, md, 7), stacked: true }, y: { ...axisY(usd, { beginAtZero: true }), stacked: true } },
      },
    });
  }

  function renderLending() {
    const L = state.data.lending;
    if (!L?.days?.length) return failed('lending', 'Arc 대출 시장', state.data.errors?.lending);
    const days = lendingDays();
    const last = days.at(-1);
    const x = delta('util', { mode: 'pp' });
    const miles = L.milestones || [];
    const nextIdx = miles.findIndex((m) => !m.day);
    const shown = miles.slice(0, Math.max(nextIdx + 1, 1)).slice(-5);
    const next = nextIdx >= 0 ? miles[nextIdx] : null;
    const ago3 = days.length >= 4 ? days[days.length - 4] : days[0];
    const avg3 = (last.borrow - ago3.borrow) / Math.max(1, Math.round((last.d - ago3.d) / 86400));
    const rows = days.slice(-12).reverse();
    card('lending', {
      title: 'Arc 대출 시장', sub: '일별 예치·차입·이용률 · Aave V4 · Morpho · DefiLlama', info: INFO.lending,
      body: `<div class="headline"><span class="lbl">이용률</span><span class="big">${pctPlain(x.c.v)}</span></div>
        <div class="delta-line">${x.html}<span class="when">${x.when}</span></div>
        <div class="miles">${shown.map((m) => m.day
          ? `<div class="mile done"><div class="mv">${usd(m.v)}</div><div class="md">${md(m.day)} 돌파</div></div>`
          : `<div class="mile next"><div class="mv">${usd(m.v)}</div><div class="md">다음 단계 · ${pctPlain(last.borrow / m.v)} 도달</div></div>`).join('')}</div>
        ${next ? `<div class="progress" role="progressbar" aria-valuenow="${Math.round((last.borrow / next.v) * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, (last.borrow / next.v) * 100)}%"></i></div>
        <div class="prog-note">현재 차입 <b>${usd(last.borrow)}</b> · 다음 단계 ${usd(next.v)}까지 ${usd(next.v - last.borrow)} 남음 · 최근 3일 하루 평균 ${avg3 >= 0 ? '' : '-'}${usd(Math.abs(avg3))} ${avg3 >= 0 ? '증가' : '감소'}${avg3 > 0 ? ` · 이 속도면 약 ${Math.ceil((next.v - last.borrow) / avg3)}일` : ''}</div>` : ''}
        <div class="tbl-wrap"><table>
          <thead><tr><th>날짜</th><th class="opt">Morpho 차입</th><th class="opt">Aave V4 차입</th><th>차입 합계</th><th>전일 대비</th><th class="opt">예치 잔액</th><th>이용률</th></tr></thead>
          <tbody>${rows.map((r, i) => {
            const prev = days[days.length - 2 - i];
            const ch = prev && prev.borrow ? r.borrow / prev.borrow - 1 : null;
            return `<tr${i === 0 ? ' class="today"' : ''}><td>${md(r.d)}${i === 0 ? ' <span class="dim" style="font-size:11px">현재</span>' : ''}</td><td class="opt">${usd(r.morphoB)}</td><td class="opt">${usd(r.aaveB)}</td>
              <td class="strong">${usd(r.borrow)}</td><td class="${cls(ch)}">${ch == null ? '–' : (ch > 0 ? '+' : '') + (ch * 100).toFixed(0) + '%'}</td>
              <td class="opt">${usd(r.tvl)}</td><td>${pctPlain(r.util)}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="note only-narrow">프로토콜별 차입·예치 잔액 열은 화면을 가로로 돌리거나 넓은 화면에서 보입니다.</p>`,
    });
  }

  function renderArcSupply() {
    const o = state.data.onchain;
    if (!o?.days?.length) return failed('arcsupply', 'Arc 위 USDC · EURC', state.data.errors?.onchain);
    const from = isoToTs('2026-09-01');
    const days = o.days.filter((r) => isoToTs(r.d) >= from);
    const u = current('arcUsdc'), e = current('arcEurc');
    const nowTs = Math.floor(Date.parse(u.t) / 1000);
    const labels = days.map((r) => isoToTs(r.d) + 86399).concat(nowTs);
    const uData = days.map((r) => r.arcUsdc).concat(u.v);
    const eData = days.map((r) => r.arcEurc).concat(e.v);
    const xE = delta('arcEurc');
    card('arcsupply', {
      title: 'Arc 위 USDC · EURC', sub: '온체인 totalSupply · 일별(UTC 하루 끝) + 현재', info: INFO.arcsupply,
      body: `<div class="headline"><span class="big">${usd(u.v)}</span><span class="lbl">Arc 위 USDC</span></div>${deltaLine('arcUsdc')}
        <div class="pair">
          <div><div class="mini-h">USDC</div><div class="chart"><canvas id="cv-arcusdc" role="img" aria-label="Arc 위 USDC"></canvas></div></div>
          <div><div class="mini-h">EURC <span class="mini-v">${eur(e.v)}</span> <span class="${cls(xE.d)}" style="font:11.5px var(--mono)">${xE.d == null ? '' : pct(xE.d)}</span></div><div class="chart"><canvas id="cv-arceurc" role="img" aria-label="Arc 위 EURC"></canvas></div></div>
        </div>`,
    });
    const tip = (it) => (it.dataIndex === labels.length - 1 ? '현재 · ' + when(u.t) : fullDay(labels[it.dataIndex]) + ' 마감');
    const mini = (id, data, color, fmt) => draw(id, {
      type: 'line',
      data: { labels, datasets: [lineDs(id === 'arcusdc' ? 'USDC' : 'EURC', data, color, { pointRadius: endPoint(data.length, 3.5), tension: 0.2 })] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip(tip, fmt) },
        scales: { x: axisX(labels, md, 3), y: axisY(fmt, { beginAtZero: true }) },
      },
    });
    mini('arcusdc', uData, C.blue, usd);
    mini('arceurc', eData, C.purple, eur);
  }

  function renderCirbtc() {
    const o = state.data.onchain;
    if (!o?.days?.length) return failed('cirbtc', 'cirBTC 공급량', state.data.errors?.onchain);
    const days = o.days;
    const a = current('cirbtcArc'), e = current('cirbtcEth');
    const tot = (a.v ?? 0) + (e.v ?? 0);
    const nowTs = Math.floor(Date.parse(a.t) / 1000);
    const labels = days.map((r) => isoToTs(r.d) + 86399).concat(nowTs);
    const arc = days.map((r) => r.arcBtc).concat(a.v);
    const eth = days.map((r) => r.ethBtc).concat(e.v);
    const sum = arc.map((v, i) => v + eth[i]);
    card('cirbtc', {
      title: 'cirBTC 공급량', sub: '서클 래핑 비트코인 · 체인별 온체인 발행량', info: INFO.cirbtc,
      body: `<div class="headline"><span class="big">${btc(tot)}</span><span class="lbl">Arc ${btc(a.v, 1)} · Ethereum ${btc(e.v, 1)}</span></div>${deltaLine('cirbtc')}
        <div class="chart"><canvas id="cv-cirbtc" role="img" aria-label="cirBTC 체인별 공급량"></canvas></div>
        <div class="legend"><span><i class="line" style="background:${C.orange}"></i>합계</span><span><i class="line" style="background:${C.teal}"></i>Arc</span><span><i class="line" style="background:${C.purple}"></i>Ethereum</span></div>`,
    });
    draw('cirbtc', {
      type: 'line',
      data: {
        labels,
        datasets: [
          lineDs('합계', sum, C.orange, { pointRadius: endPoint(sum.length), stepped: false, tension: 0 }),
          lineDs('Arc', arc, C.teal, { pointRadius: endPoint(arc.length), tension: 0 }),
          lineDs('Ethereum', eth, C.purple, { pointRadius: endPoint(eth.length), tension: 0 }),
        ],
      },
      options: {
        interaction,
        plugins: { ...noLegend, tooltip: tooltip((it) => (it.dataIndex === labels.length - 1 ? '현재 · ' + when(a.t) : fullDay(labels[it.dataIndex]) + ' 마감'), (v) => btc(v, 1)) },
        scales: { x: axisX(labels, md, 5), y: axisY((v) => '₿' + unit(v), { beginAtZero: true }) },
      },
    });
  }

  function renderAccounts() {
    const A = state.data.accounts;
    if (!A?.daily?.length) return failed('accounts', '일별 활성 계정', state.data.errors?.accounts);
    const days = A.daily.slice(-30);
    const labels = days.map((r) => isoToTs(r.d));
    const lastWeek = A.weeks?.filter((w) => !w.approx).at(-1);
    const x = delta('retRatio', { mode: 'pp' });
    const lastDone = A.daily.filter((r) => !r.approx).at(-1);
    card('accounts', {
      title: '일별 활성 계정', sub: '재방문과 신규 · Arc 탐색기(Blockscout)', info: INFO.accounts,
      body: `<div class="headline"><span class="lbl">주간 재방문 비율</span><span class="big">${pctPlain(lastWeek?.retRatio)}</span></div>
        <div class="delta-line">${x.html}<span class="when">${lastWeek ? `${esc(lastWeek.d)} 시작 주 · 활성 ${nf(0).format(lastWeek.active)} 중 재방문 ${nf(0).format(lastWeek.active - lastWeek.new)}` : ''}</span></div>
        ${lastDone ? `<p class="note" style="margin-top:4px">${esc(lastDone.d.slice(5).replace('-', '/'))} 활성 ${nf(0).format(lastDone.active)} (신규 ${nf(0).format(lastDone.new)}) · 누적 계정 ${nf(0).format(A.totals?.accounts || 0)}</p>` : ''}
        <div class="chart"><canvas id="cv-accounts" role="img" aria-label="일별 활성 계정"></canvas></div>
        <div class="legend"><span><i style="background:${C.blue}"></i>재방문 계정</span><span><i style="background:${C.orange}"></i>신규 계정</span><span><i style="background:${C.faint}"></i>집계 중(잠정)</span></div>`,
    });
    const col = (c) => days.map((r) => (r.approx ? C.faint : c));
    draw('accounts', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '재방문', data: days.map((r) => r.ret), backgroundColor: col(C.blue), borderColor: C.surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', stack: 's', maxBarThickness: 18 },
          { label: '신규', data: days.map((r) => r.new), backgroundColor: days.map((r) => (r.approx ? C.faint + 'aa' : C.orange)), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: 'bottom', stack: 's', maxBarThickness: 18 },
        ],
      },
      options: {
        interaction,
        plugins: {
          ...noLegend,
          tooltip: {
            ...tooltip(() => '', (v) => nf(0).format(v)),
            callbacks: {
              title: (items) => fullDay(labels[items[0].dataIndex]) + (days[items[0].dataIndex].approx ? ' (집계 중)' : ''),
              label: (it) => ` ${it.dataset.label}: ${nf(0).format(it.raw)}`,
              footer: (items) => `활성 합계 ${nf(0).format(days[items[0].dataIndex].active)}`,
            },
          },
        },
        scales: { x: { ...axisX(labels, md, 6), stacked: true }, y: { ...axisY(unit, { beginAtZero: true }), stacked: true } },
      },
    });
  }

  function renderCctp() {
    const c = state.data.cctp;
    if (!c?.rows) return failed('cctp', '체인별 CCTP 흐름', state.data.errors?.cctp);
    const rows = c.rows.filter((r) => r.in + r.out >= 1);
    const LIMIT = 8;
    let shown = rows;
    if (!state.cctpAll && rows.length > LIMIT) {
      const rest = rows.slice(LIMIT - 1);
      shown = rows.slice(0, LIMIT - 1).concat({ name: `기타 ${rest.length}개`, in: rest.reduce((s, r) => s + r.in, 0), out: rest.reduce((s, r) => s + r.out, 0) });
    }
    const max = Math.max(...shown.map((r) => Math.max(r.in, r.out)), 1);
    const w = (v) => `${Math.max(0.5, (v / max) * 100) * 0.62}%`; // 숫자 라벨 자리를 남긴다
    card('cctp', {
      title: '체인별 CCTP 흐름', sub: '최근 24시간 · Arc 온체인 이벤트 직접 집계', info: INFO.cctp,
      body: `<div class="headline"><span class="lbl">순유입</span><span class="big ${cls(c.net, 1)}">${c.net > 0 ? '+' : ''}${usd(c.net)}</span><span class="lbl">유입 ${usd(c.totalIn)} · 유출 ${usd(c.totalOut)}</span></div>
        ${deltaLine('cctpNet').replace(/<span class="(up|down|flat)">[^<]*<\/span>/, '')}
        <div class="legend"><span><i style="background:${C.blue}"></i>Arc로 유입</span><span><i style="background:${C.orange}"></i>Arc에서 유출</span></div>
        <div class="flow">${shown.map((r) => `
          <div class="fname" title="${esc(r.name)}">${esc(r.name)}</div>
          <div class="bars" role="img" aria-label="${esc(r.name)}: 유출 ${usd(r.out)}, 유입 ${usd(r.in)}">
            <div class="side out">${r.out > 0 ? `<span class="amt">${usd(r.out)}</span><span class="bar" style="width:${w(r.out)}"></span>` : ''}</div>
            <div class="side in">${r.in > 0 ? `<span class="bar" style="width:${w(r.in)}"></span><span class="amt">${usd(r.in)}</span>` : ''}</div>
          </div>`).join('')}</div>
        <div class="flow-axis"><span></span><div><span>← Arc에서 나감</span><span>Arc로 들어옴 →</span></div></div>
        ${rows.length > LIMIT ? `<button class="more-btn" type="button" id="cctp-more">${state.cctpAll ? '상위 체인만 보기' : `전체 ${rows.length}개 체인 보기`}</button>` : ''}
        <p class="note">블록 ${nf(0).format(c.fromBlock)} ~ ${nf(0).format(c.toBlock)} · CCTP V2 DepositForBurn(유출)·MintAndWithdraw(유입) 이벤트</p>`,
    });
  }

  function renderShort(S = state.data?.short, id = 'short', name = '서클') {
    if (!S?.daily?.length) return failed(id, `${name} 공매도 비율`, state.data?.errors?.short);
    const days = S.daily;
    const last = days.at(-1), prev = days.at(-2);
    const d1 = prev ? last.ratio - prev.ratio : null;
    const labels = days.map((r) => isoToTs(r.d));
    const shares = (v) => (v == null ? '–' : unit(v) + '주');
    const hi = days.reduce((a, r) => (r.ratio > a.ratio ? r : a)), lo = days.reduce((a, r) => (r.ratio < a.ratio ? r : a));
    const si = (S.interest || []).slice(-3).reverse();
    const sym = id === 'short' ? 'CRCL' : state.stock, sOut = state.holders?.[sym]?.sharesOut;
    const ofAll = last.vol ? last.short / last.vol : null;
    card(id, {
      title: `${name} 공매도 비율`, sub: '최근 1개월 · 장외(FINRA 집계) 거래 중 공매도 비중', info: INFO.short,
      easy: EN ? 'Short selling means borrowing shares to sell now and buying them back later — a bet that the price falls. A high ratio means more bets on a drop, but routine market-maker trades are mixed in, so 40–60% is common.' : '공매도는 주식을 빌려서 먼저 팔고, 나중에 사서 갚는 거래예요. 주가가 내려야 돈을 버는 거래라 비중이 높으면 하락에 거는 사람이 많다는 뜻이지만, 시장 조성자(증권사)의 일상적인 거래도 섞여 있어 40~60%는 흔한 수준이에요.',
      body: `
        <div class="headline"><span class="lbl">${md(labels.at(-1))} 장외 거래 중 공매도</span><span class="big">${pctPlain(last.ratio)}</span><span class="lbl">1개월 평균 ${pctPlain(S.avgRatio)}</span></div>
        <div class="delta-line"><span class="${cls(d1)}">${arrow(d1)} ${pp(d1, 1)}</span><span class="when">전 거래일(${prev ? md(labels.at(-2)) : '–'}) 대비 · 공매도 ${shares(last.short)} / 장외 집계 ${shares(last.total)}${ofAll != null ? ` · <b>${EN ? `≈ ${pctPlain(ofAll)} of total volume (${shares(last.vol)})` : `그날 전체 거래량(${shares(last.vol)}) 대비 약 ${pctPlain(ofAll)}`}</b>` : ''} · 1개월 최고 ${pctPlain(hi.ratio)}(${md(isoToTs(hi.d))}) · 최저 ${pctPlain(lo.ratio)}(${md(isoToTs(lo.d))})</span></div>
        <div class="chart"><canvas id="cv-${id}" role="img" aria-label="${name} 일별 공매도 비율"></canvas></div>
        <div class="legend"><span><i style="background:${C.purple}"></i>일별 공매도 비율</span><span><i class="line" style="background:${C.ink2}"></i>1개월 평균</span></div>
        ${si.length ? `<div class="tbl-wrap"><table>
          <thead><tr><th>잔고 기준일</th><th>잔고</th>${sOut ? '<th>발행 대비</th>' : ''}<th>직전 대비</th><th>커버 일수</th></tr></thead>
          <tbody>${si.map((r, i) => `<tr${i === 0 ? ' class="today"' : ''}><td>${esc(r.d.slice(5).replace('-', '/'))}</td><td class="strong">${shares(r.qty)}</td>${sOut ? `<td>${pctPlain(r.qty / sOut, 1)}</td>` : ''}
            <td class="${cls(r.chg)}">${r.chg > 0 ? '+' : ''}${r.chg.toFixed(1)}%</td><td>${r.dtc.toFixed(2)}일</td></tr>`).join('')}</tbody></table></div>
          <p class="note">${EN ? '<b>Short interest</b> = shares sold short and not yet bought back (FINRA, twice a month: mid-month and month-end). <b>Days to cover</b> = days of average volume needed to buy them all back — the longer, the easier a “short squeeze” when the price rises.' : '<b>공매도 잔고</b> = 아직 갚지 않고 남아 있는 공매도 주식 수(FINRA가 한 달에 두 번, 15일·월말 기준 발표). <b>커버 일수</b> = 하루 평균 거래량으로 그 잔고를 다 사서 갚는 데 걸리는 날 수 — 길수록 주가가 오를 때 급하게 사들이는 \'숏 스퀴즈\'가 나기 쉬워요.'}</p>` : ''}`,
    });
    draw(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: '공매도 비율', data: days.map((r) => r.ratio), backgroundColor: C.purple, hoverBackgroundColor: C.purple + 'cc', borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: 'bottom', maxBarThickness: 22, order: 2 },
          { type: 'line', label: '1개월 평균', data: days.map(() => S.avgRatio), borderColor: C.ink2, borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0, order: 1 },
        ],
      },
      options: {
        interaction,
        plugins: {
          ...noLegend,
          tooltip: {
            ...tooltip(() => '', (v) => pctPlain(v)),
            callbacks: {
              title: (items) => fullDay(labels[items[0].dataIndex]),
              label: (it) => ` ${it.dataset.label}: ${pctPlain(it.raw)}`,
              footer: (items) => { const r = days[items[0].dataIndex]; return `공매도 ${shares(r.short)} / 장외 집계 ${shares(r.total)}${r.vol ? ` · 전체 거래량 대비 ${pctPlain(r.short / r.vol)}` : ''}`; },
            },
          },
        },
        scales: { x: axisX(labels, md, 7), y: axisY((v) => Math.round(v * 100) + '%', { beginAtZero: true, suggestedMax: 0.8 }) },
      },
    });
  }

  // ---------------------------------------------------------------- CRCL 실시간 주가 (Binance CRCLUSDT 무기한 선물)
  const BN = {
    rest: 'https://fapi.binance.com/fapi/v1',
    ws: 'wss://fstream.binance.com/market/stream?streams=crclusdt@aggTrade/crclusdt@ticker/crclusdt@markPrice@1s',
    sym: 'CRCLUSDT',
  };
  const RANGES = {
    '1d': { label: '1일', interval: '30m', limit: 48 },
    '1w': { label: '1주', interval: '2h', limit: 84 },
    '1m': { label: '1개월', interval: '8h', limit: 90 },
    '3m': { label: '3개월', interval: '1d', limit: 90 },
    '1y': { label: '1년', interval: '1w', limit: 53, yahoo: true }, // 바이낸스 선물은 1년이 안 돼 실제 주가(Yahoo 주봉)로
  };
  const yahooYear = async (sym) => { const j = await getJ(`${NEWS_API}/chart?s=${sym}&r=1y`, 15000); if (j.error) throw new Error(j.error); return yahooView(j.points, '1y'); };
  const px = state.px;
  const price = (v) => (v == null || !isFinite(v) ? '–' : '$' + nf(2).format(v));
  const HM_FMT = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit', hour12: false });
  const hm = (ms) => HM_FMT.format(new Date(ms));
  const mdLocal = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  async function bnGet(path) {
    const r = await fetch(`${BN.rest}/${path}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('binance ' + r.status);
    return r.json();
  }
  async function loadPxSnapshot() {
    const [t, m, oi] = await Promise.all([
      bnGet(`ticker/24hr?symbol=${BN.sym}`),
      bnGet(`premiumIndex?symbol=${BN.sym}`),
      bnGet(`openInterest?symbol=${BN.sym}`).catch(() => null),
    ]);
    px.t = { last: +t.lastPrice, open: +t.openPrice, high: +t.highPrice, low: +t.lowPrice, pct: +t.priceChangePercent / 100, qv: +t.quoteVolume, E: t.closeTime };
    px.mark = { mark: +m.markPrice, index: +m.indexPrice, fund: +m.lastFundingRate, next: m.nextFundingTime };
    if (oi) px.oi = +oi.openInterest;
    px.at = Date.now();
    px.err = null;
  }
  async function loadKlines(range) {
    const r = RANGES[range];
    if (r.yahoo) { px.klines[range] = await yahooYear('CRCL'); return; }
    const k = await bnGet(`klines?symbol=${BN.sym}&interval=${r.interval}&limit=${r.limit + 120}`);
    px.klines[range] = splitView(k.map((x) => [x[0], +x[4], +x[1], +x[2], +x[3], +x[5]]), r.limit); // [시작 시각(ms), 종가, 시가, 고가, 저가, 거래량]
  }

  // WebSocket으로 체결마다 갱신, 끊기면 5초 폴링으로 대체하고 재연결
  let ws = null, wsRetry = 0, wsTimer = null, pollTimer = null, wsWatch = null;
  // 연결은 됐는데 데이터가 끊기면(15초 무소식) 다시 연결한다
  const armWatch = () => { clearTimeout(wsWatch); wsWatch = setTimeout(() => { try { ws?.close(); } catch {} }, 15000); };
  function connectWs() {
    if (ws || document.hidden || !('WebSocket' in window)) return;
    try { ws = new WebSocket(BN.ws); } catch { startPoll(); return; }
    ws.onopen = () => { armWatch(); };
    ws.onmessage = (ev) => {
      armWatch();
      if (px.via !== 'ws') { wsRetry = 0; px.via = 'ws'; px.err = null; stopPoll(); }
      let d;
      try { d = JSON.parse(ev.data).data; } catch { return; }
      if (!d) return;
      if (d.e === 'aggTrade') {
        if (!px.t) return;
        const last = +d.p;
        px.t = { ...px.t, last, pct: px.t.open ? last / px.t.open - 1 : px.t.pct, high: Math.max(px.t.high, last), low: Math.min(px.t.low, last), E: d.T };
      } else if (d.e === '24hrTicker') px.t = { last: +d.c, open: +d.o, high: +d.h, low: +d.l, pct: +d.P / 100, qv: +d.q, E: d.E };
      else if (d.e === 'markPriceUpdate') px.mark = { mark: +d.p, index: +d.i, fund: +d.r, next: d.T };
      px.at = Date.now();
      schedulePaint();
    };
    ws.onclose = () => {
      ws = null;
      clearTimeout(wsWatch);
      if (px.via === 'ws') px.via = 'rest';
      if (document.hidden) return;
      startPoll();
      clearTimeout(wsTimer);
      wsTimer = setTimeout(connectWs, Math.min(30000, 2000 * 2 ** wsRetry++));
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function disconnectWs() {
    clearTimeout(wsTimer);
    clearTimeout(wsWatch);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    stopPoll();
  }
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try { await loadPxSnapshot(); if (px.via !== 'ws') px.via = 'rest'; schedulePaint(); } catch {}
    }, 5000);
  }
  function stopPoll() { clearInterval(pollTimer); pollTimer = null; }

  let paintQueued = false, lastPaint = 0, prevLast = null;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    setTimeout(() => requestAnimationFrame(() => { paintQueued = false; lastPaint = Date.now(); paintPx(); }), Math.max(0, 600 - (Date.now() - lastPaint)));
  }
  const fundLeft = (T) => { const m = Math.max(0, Math.round((T - Date.now()) / 60000)); return `8시간마다 정산 · 다음 ${Math.floor(m / 60)}시간 ${m % 60}분 후`; };

  function paintPx() {
    const t = px.t;
    setHtml('px-via', px.err && !t ? '<span class="warn">바이낸스 연결 실패 · 다시 시도 중</span>' : px.via === 'ws' ? '<span class="live-dot"></span>실시간 체결' : px.via === 'rest' ? '5초마다 갱신' : '연결 중…');
    if (!t) return;
    const lastEl = document.getElementById('px-last');
    if (lastEl) {
      lastEl.textContent = price(t.last);
      if (prevLast != null && t.last !== prevLast && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        lastEl.classList.remove('flash-up', 'flash-down');
        void lastEl.offsetWidth;
        lastEl.classList.add(t.last > prevLast ? 'flash-up' : 'flash-down');
      }
    }
    prevLast = t.last;
    const chg = t.last - t.open;
    setHtml('px-chg', `<span class="${cls(t.pct)}">${arrow(t.pct)} ${chg >= 0 ? '+' : '-'}$${Math.abs(chg).toFixed(2)} (${pct(t.pct, 2)})</span>`);
    const pos = t.high > t.low ? (t.last - t.low) / (t.high - t.low) : 0.5;
    const rb = document.getElementById('px-range');
    if (rb) rb.style.left = `${Math.min(100, Math.max(0, pos * 100))}%`;
    setHtml('px-low', price(t.low));
    setHtml('px-high', price(t.high));
    setHtml('px-qv', usd(t.qv));
    if (px.mark) {
      setHtml('px-fund', `<span class="${cls(px.mark.fund)}">${px.mark.fund > 0 ? '+' : ''}${(px.mark.fund * 100).toFixed(4)}%</span>`);
      setHtml('px-next', fundLeft(px.mark.next));
    }
    if (px.oi != null) setHtml('px-oi', usd(px.oi * (px.mark?.mark || t.last)));
    setHtml('px-time', hm(t.E || px.at) + ' 기준');
    setHtml('sum-px', price(t.last));
    setHtml('sum-pxchg', `<span class="${cls(t.pct)}">${pct(t.pct, 1)}</span>`);
    const sw = document.querySelector('[data-stock="CRCL"]');
    if (sw) { const a = sw.querySelector('.ss-px'), b = sw.querySelector('.ss-ch'); if (a) a.textContent = price(t.last); if (b) { b.className = `ss-ch ${cls(t.pct)}`; b.textContent = pct(t.pct, 1); } }
    setHtml('pc-last', price(t.last));
    const k = px.klines[state.range];
    if (k?.length) {
      const ch = t.last / k[0][1] - 1;
      setHtml('pc-chg', `<span class="${cls(ch)}">${arrow(ch)} ${pct(ch, 2)}</span> <span class="lbl">${RANGES[state.range].label} 동안</span>`);
    }
    for (const id of ['spark', 'pricechart']) liveCandle(id, t.last);
  }

  function drawPriceLine(id, k, { compact = false, range = '1d' } = {}) {
    if (!k?.length) return;
    const tip = (it) => {
      const d = new Date(k[it.dataIndex][0]);
      return /^1[dw]$/.test(RANGES[range].interval) ? d.toLocaleDateString(LOC) : d.toLocaleString(LOC, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    };
    drawCandles(id, k, { compact, xf: range === '1d' ? hm : mdLocal, tip, last: px.t?.last, ind: !compact });
  }

  function renderPriceCard() {
    card('price', {
      title: 'CRCL 실시간 주가',
      sub: 'Binance CRCLUSDT 무기한 선물 · 24시간 거래',
      info: INFO.price,
      body: `
        <div class="px-main"><span class="px-last" id="px-last">${price(px.t?.last)}</span><span class="px-chg" id="px-chg"></span></div>
        <div class="px-meta"><span id="px-via">연결 중…</span><span id="px-time"></span></div>
        <div class="chart spark"><canvas id="cv-spark" role="img" aria-label="CRCL 최근 24시간 가격"></canvas></div>
        <div class="px-range" aria-label="24시간 가격 범위"><span id="px-low">–</span><div class="rb"><i id="px-range"></i></div><span id="px-high">–</span></div>
        <div class="px-stats">
          <div><span>24h 거래대금</span><b id="px-qv">–</b></div>
          <div><span>펀딩비</span><b id="px-fund">–</b><small id="px-next"></small></div>
          <div><span>미결제약정</span><b id="px-oi">–</b></div>
        </div>
        ${tgtHost('CRCL')}
        <button type="button" class="link-btn" data-go="crcl:c-pricechart">가격 차트 · 공매도 · 기관 보유 보기<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>`,
    });
    drawPriceLine('spark', px.klines['1d'], { compact: true });
    paintPx();
  }

  function renderPriceChart() {
    const r = state.range;
    const k = px.klines[r];
    let note = '';
    if (k?.length) {
      const vals = k.map((p) => p[1]);
      note = `${RANGES[r].label} 최고 ${price(Math.max(...k.map((p) => p[3] ?? p[1])))} · 최저 ${price(Math.min(...k.map((p) => p[4] ?? p[1])))} · 시작 ${price(k[0][2] ?? vals[0])} · ${RANGES[r].yahoo ? (EN ? 'weekly · actual stock price (regular session, Yahoo)' : '주봉 · 실제 주가(정규장, Yahoo)') : RANGES[r].interval + ' 캔들'}`;
    }
    card('pricechart', {
      title: 'CRCL 가격 추이',
      sub: 'Binance CRCLUSDT 무기한 선물',
      info: INFO.pricechart,
      body: `
        <div class="seg range" role="group" aria-label="기간 선택">${Object.entries(RANGES).map(([key, v]) => `<button type="button" data-range="${key}" aria-pressed="${key === r}">${v.label}</button>`).join('')}</div>
        ${chartTools('pricechart')}
        <div class="px-main sm"><span class="px-last" id="pc-last">${price(px.t?.last)}</span><span class="px-chg" id="pc-chg"></span></div>
        <div class="chart tall"><canvas id="cv-pricechart" role="img" aria-label="CRCL 가격 추이"></canvas></div>
        <p class="note">${note || '불러오는 중…'}</p>
        <div id="osc-pricechart"></div>`,
    });
    paintOsc('CRCL', 'osc-pricechart');
    if (!k) {
      loadKlines(r).then(() => { if (state.range === r) renderPriceChart(); }).catch(() => {});
      return;
    }
    drawPriceLine('pricechart', k, { range: r });
    paintPx();
  }

  async function initPrice() {
    renderPriceCard();
    renderPriceChart();
    try {
      await Promise.all([loadPxSnapshot(), loadKlines('1d'), state.range !== '1d' ? loadKlines(state.range) : null]);
      if (!px.via) px.via = 'rest';
    } catch (e) {
      px.err = e.message;
    }
    renderPriceCard();
    renderPriceChart();
    if (state.data) renderSummary();
    connectWs();
    if (px.err) startPoll();
  }

  // ---------------------------------------------------------------- 과매수·과매도(RSI 14일) — 일봉(Yahoo, 정규장) 1년치로 계산
  const dailyLoad = {};
  function ensureDaily(sym) {
    const x = st(sym);
    if (x.daily && Date.now() - x.dailyAt < 1800000) return Promise.resolve(x.daily);
    return (dailyLoad[sym] ||= getJ(`${NEWS_API}/chart?s=${sym}&r=3m`, 15000)
      .then((j) => { if (j.error) throw new Error(j.error); x.daily = j.points || []; x.dailyAt = Date.now(); return x.daily; })
      .finally(() => { delete dailyLoad[sym]; }));
  }
  function rsiOf(c, n = 14) {
    if (c.length < n + 1) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function oscHtml(sym) {
    const P = st(sym).daily;
    if (!P?.length) return `<p class="note">${EN ? 'Loading overbought/oversold…' : '과매수·과매도 계산 중…'}</p>`;
    const pts = P.filter((p) => p[1] != null), closes = pts.map((p) => p[1]);
    const live = sym === 'CRCL' ? px.t?.last : pq(sym)?.price;
    // 오늘 캔들이 있으면 마지막 종가를 실시간 가격으로(장중 상태 반영)
    if (live && pts.length && etDate(pts.at(-1)[0]) === etDate()) closes[closes.length - 1] = live;
    const rsiRaw = rsiOf(closes), rsi = rsiRaw == null ? null : Math.round(rsiRaw); // 보이는 숫자와 구간 판정을 맞춘다
    if (rsi == null) return `<p class="note">${EN ? 'Not enough price history yet for RSI (needs 15 trading days).' : '상장한 지 얼마 안 돼 RSI를 계산할 거래일이 아직 부족해요(15일 필요).'}</p>`;
    const last = closes.at(-1), m20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
    const yr = pts.filter((p) => p[0] >= pts.at(-1)[0] - 365 * 86400000);
    const hi = Math.max(...yr.map((p) => p[3] ?? p[1]), last), lo = Math.min(...yr.map((p) => p[4] ?? p[1]), last);
    const pos = hi > lo ? (last - lo) / (hi - lo) : null;
    const up14 = closes.slice(-15).reduce((n, v, i, a) => n + (i && v > a[i - 1] ? 1 : 0), 0);
    const [lab, tone, tip] = rsi >= 70 ? [EN ? 'Overbought' : '과매수', 'hot', EN ? 'Rose a lot in a short time — pullbacks or pauses are common from here.' : '짧은 기간에 많이 올랐어요. 숨 고르기(조정)가 나오기 쉬운 구간이에요.']
      : rsi >= 60 ? [EN ? 'Warming up' : '다소 과열', 'warm', EN ? 'Buyers in control lately; not extreme yet.' : '최근 사는 힘이 더 강해요. 아직 극단은 아니에요.']
        : rsi <= 30 ? [EN ? 'Oversold' : '과매도', 'cold', EN ? 'Fell a lot in a short time — rebounds are common from here.' : '짧은 기간에 많이 내렸어요. 반등이 나오기 쉬운 구간이에요.']
          : rsi <= 40 ? [EN ? 'Cooling' : '다소 침체', 'cool', EN ? 'Sellers in control lately; not extreme yet.' : '최근 파는 힘이 더 강해요. 아직 극단은 아니에요.']
            : [EN ? 'Neutral' : '중립', 'mid', EN ? 'Neither overheated nor oversold.' : '과열도 침체도 아닌 보통 상태예요.'];
    return `<div class="osc">
        <div class="osc-h"><b>${EN ? 'Overbought / oversold' : '과매수 · 과매도'}</b><small>RSI 14${EN ? '-day' : '일'} · ${EN ? 'daily, regular session' : '일봉(정규장) 기준'}</small></div>
        <div class="osc-row"><span class="osc-v ${tone}">${Math.round(rsi)}</span><span class="osc-l ${tone}">${lab}</span></div>
        <div class="osc-bar" role="img" aria-label="RSI ${Math.round(rsi)}"><i class="z1"></i><i class="z2"></i><i class="z3"></i><em style="left:${Math.min(100, Math.max(0, rsi)).toFixed(1)}%"></em></div>
        <div class="osc-scale"><span>0</span><span>30 ${EN ? 'oversold' : '과매도'}</span><span>70 ${EN ? 'overbought' : '과매수'}</span><span>100</span></div>
        <p class="osc-tip">${tip}</p>
        <div class="osc-facts">
          ${m20 ? `<span>${EN ? 'vs 20-day avg' : '20일 평균보다'} <b class="${cls(last / m20 - 1)}">${pct(last / m20 - 1, 1)}</b></span>` : ''}
          ${pos != null ? `<span>${EN ? '52-week range' : '52주 범위 중'} <b>${Math.round(pos * 100)}%</b> ${EN ? 'position' : '위치'}</span>` : ''}
          <span>${EN ? 'Up days (last 14)' : '최근 14일 중 오른 날'} <b>${up14}${EN ? '' : '일'}</b></span>
        </div>
        <p class="note">${EN ? 'RSI compares recent gains with recent losses on a 0–100 scale. It shows how stretched the move is, not where the price goes next.' : 'RSI는 최근 14일 동안 오른 폭과 내린 폭을 비교한 0~100 점수예요. 70 이상은 과매수, 30 이하는 과매도로 봐요. 얼마나 쏠렸는지를 보여줄 뿐 앞으로의 방향을 알려주진 않아요.'}</p>
      </div>`;
  }
  function paintOsc(sym, elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = oscHtml(sym);
    if (!st(sym).daily || Date.now() - st(sym).dailyAt > 1800000) ensureDaily(sym).then(() => { const e = document.getElementById(elId); if (e && (sym === 'CRCL' || state.stock === sym)) e.innerHTML = oscHtml(sym); }).catch(() => { const e = document.getElementById(elId); if (e) e.innerHTML = ''; });
  }

  // ---------------------------------------------------------------- 결과를 이미지 카드로 공유(퇴사까지·배당금·성과급)
  // 그리는 코드는 assets/share-card.js — 버튼을 누를 때만 받아서 첫 로딩에는 영향이 없다
  function shareCardData(kind) {
    const tag = EN ? 'Free FIRE & dividend dashboard · no sign-up' : '퇴사를 위한 주식 대시보드 · 무료 · 가입 없음';
    if (kind === 'fire') {
      const c = fireCfg && state.quote ? (() => { try { return fireCalc(); } catch { return null; } })() : null;
      if (!c) return null;
      const p = Math.max(0, c.progress);
      return { kind, tag, title: EN ? '🔥 Road to FIRE' : '🔥 퇴사까지', bar: Math.min(1, p),
        hero: { label: EN ? 'Progress to my goal' : '목표까지 진행률', value: `${(p * 100).toFixed(1)}%`, money: false },
        lines: [
          { label: EN ? 'Current value' : '현재 평가액', value: wonFull(c.basis), money: true },
          { label: EN ? 'Goal' : '목표 금액', value: wonFull(c.F.goal), money: true },
          { label: EN ? 'Left to go' : '남은 금액', value: wonFull(Math.max(0, c.remainKrw)), money: true },
          { label: EN ? 'Return' : '수익률', value: pct(c.gainPct, 1), money: false },
        ] };
    }
    if (kind === 'div') {
      const c = divCfg ? (() => { try { return divCalc(); } catch { return null; } })() : null;
      if (!c || !c.recvNet) return null;
      const fx = state.quote?.fx?.rate;
      return { kind, tag, title: EN ? '💰 My dividends' : '💰 내 배당금', bar: Math.min(1, c.payback),
        hero: { label: EN ? 'Dividends received (after tax)' : '지금까지 받은 배당(세후)', value: usd2(c.recvNet), sub: fx ? (EN ? `≈ ${manwon(c.recvNet * fx)} in KRW` : `원화로 약 ${manwon(c.recvNet * fx)}`) : '', money: true,
          alt: { label: EN ? 'Cost recovered by dividends' : '배당으로 원금 회수', value: pctPlain(c.payback, 1), money: false } },
        lines: [
          { label: EN ? 'Monthly average' : '월 평균 배당', value: usd2(c.monthly), money: true },
          { label: EN ? 'Yearly (est.)' : '연 예상 배당', value: usd2(c.annualNet), money: true },
          { label: EN ? 'Cost recovered' : '원금 회수', value: pctPlain(c.payback, 1), money: false },
          { label: EN ? 'Yield on cost' : '투자금 대비 배당률', value: c.yoc != null ? pctPlain(c.yoc, 2) : '–', money: false },
        ] };
    }
    if (kind === 'week') {
      const fc = fireCfg ? (() => { try { return fireCalc(); } catch { return null; } })() : null, W = weekData(fc);
      if (!W.ok) return null;
      const best = W.movers?.[0], worst = W.movers?.at(-1);
      return { kind, tag, title: EN ? '📅 My week in review' : '📅 이번 주 내 포트폴리오', bar: W.p1 != null ? Math.min(1, Math.max(0, W.p1)) : null,
        hero: W.r != null ? { label: EN ? 'Return this week' : '이번 주 수익률', value: pct(W.r, 1), money: false } : { label: EN ? 'Dividends this week' : '이번 주 받은 배당', value: usd2(W.divNet || 0), money: true, alt: { label: EN ? 'Dividends this week' : '이번 주 받은 배당', value: `${W.divGot?.length || 0}${EN ? ' payouts' : '건'}`, money: false } },
        lines: [
          W.r != null && { label: EN ? 'Value change' : '평가금액 변화', value: signed(W.v1 - W.v0, wonFull), money: true },
          W.p1 != null && { label: EN ? 'FIRE progress' : '퇴사까지 진행률', value: `${(W.p1 * 100).toFixed(1)}% (${W.p1 - W.p0 >= 0 ? '+' : ''}${((W.p1 - W.p0) * 100).toFixed(1)}%p)`, money: false },
          best && best.r > 0 && { label: EN ? 'Top gainer' : '가장 많이 오른 종목', value: `${nameOfSym(best.sym)} ${pct(best.r, 1)}`, money: false },
          worst && worst.r < 0 && { label: EN ? 'Biggest decliner' : '가장 많이 내린 종목', value: `${nameOfSym(worst.sym)} ${pct(worst.r, 1)}`, money: false },
          W.divGot?.length && { label: EN ? 'Dividends this week' : '이번 주 받은 배당', value: usd2(W.divNet), money: true },
        ].filter(Boolean).slice(0, 4) };
    }
    if (kind === 'bench') {
      const c = fireCfg && state.quote ? (() => { try { return fireCalc(); } catch { return null; } })() : null, rg = BENCH_RANGES[state.benchRange] ? state.benchRange : '3m', R = c ? benchCalc(c, benchFrom(rg)) : null;
      if (!R) return null;
      const lbl = EN ? BENCH_RANGES[rg][2] : BENCH_RANGES[rg][1];
      return { kind, tag, title: EN ? '📊 My stocks vs the market' : '📊 내 종목 vs 시장', bar: null,
        hero: { label: EN ? `My stocks · ${lbl}` : `내 종목 수익률 · ${lbl}`, value: pct(R.my, 1), money: false },
        lines: [
          { label: 'S&P500' + (EN ? ' (KRW)' : '(원화)'), value: pct(R.sp, 1), money: false },
          { label: EN ? 'KOSPI' : '코스피', value: pct(R.ks, 1), money: false },
          { label: EN ? 'vs S&P500' : 'S&P500 대비', value: `${R.my - R.sp >= 0 ? '+' : ''}${((R.my - R.sp) * 100).toFixed(1)}%p`, money: false },
        ] };
    }
    if (kind === 'recap') {
      const D = recapData(), R = D.R;
      const lines = [R?.per.length > 1 && { label: EN ? 'Best stock' : '올해의 종목', value: `${krTk(R.per[0].t) ? fireName(R.per[0].t) : R.per[0].t} ${pct(R.per[0].r, 1)}`, money: false },
        D.div && { label: EN ? 'Dividends' : '받은 배당', value: usd2(D.div.usd), money: true },
        D.prog && { label: EN ? 'FIRE progress' : '퇴사 진행률', value: `${(D.prog.to * 100).toFixed(1)}%`, money: false },
        R && { label: 'S&P500', value: pct(R.sp, 1), money: false }].filter(Boolean).slice(0, 4);
      if (!R && !lines.length) return null;
      return { kind, tag, title: EN ? `🎁 My ${D.Y} in review` : `🎁 ${D.Y}년 투자 결산`, bar: D.prog ? Math.min(1, D.prog.to) : null,
        hero: R ? { label: EN ? `${D.Y} return` : `${D.Y}년 내 종목 수익률`, value: pct(R.my, 1), money: false } : { label: EN ? 'Dividends' : '올해 받은 배당', value: usd2(D.div?.usd || 0), money: true, alt: { label: EN ? 'Payouts' : '배당 받은 횟수', value: `${D.div?.n || 0}`, money: false } },
        lines };
    }
    if (kind === 'etax') {
      const T = etaxCalc(), short = { direct: EN ? 'US-listed' : '미국 직투', kr: EN ? 'Korea-listed' : '국내 상장', isa: 'ISA', pen: EN ? 'Pension' : '연금저축' };
      const base = T.list[0].final;
      return { kind, tag, title: EN ? '🧮 Where to buy US ETFs' : '🧮 미국 ETF 어디서 살까', bar: null,
        hero: { label: EN ? `Keeps the most after tax · ${T.N} years` : `세금 떼고 가장 많이 남는 곳 · ${T.N}년`, value: short[T.best.k], money: false },
        lines: [...T.list].sort((a, b) => b.final - a.final).map((r) => ({ label: short[r.k], value: r.k === 'direct' ? wonFull(r.final) : `${wonFull(r.final)} (${signed(r.final - base, wonFull)})`, money: true })) };
    }
    if (kind === 'grow') {
      const R = growCalc();
      if (!R) return null;
      const L = R.last, mix = R.P.map((h) => `${h.name} ${Math.round(h.k * 100)}%`).join(' · ');
      return { kind, tag, title: EN ? '📈 Monthly investing plan' : '📈 적립식 배당 시뮬레이션', bar: null,
        hero: { label: EN ? `Monthly dividend in ${R.years} years${growCfg.tax ? ' (after tax)' : ''}` : `${R.years}년 뒤 한 달 배당${growCfg.tax ? '(세후)' : ''}`, value: wonFull(L.mon), money: true,
          alt: { label: EN ? 'Value vs invested' : '넣은 돈 대비 평가금액', value: `${(L.val / L.inv).toFixed(2)}${EN ? 'x' : '배'}`, money: false } },
        lines: [
          { label: EN ? 'Stocks' : '종목 구성', value: mix.length > 34 ? `${R.P.map((h) => h.name).slice(0, 4).join('·')}${R.P.length > 4 ? ` +${R.P.length - 4}` : ''}` : mix, money: false },
          { label: EN ? 'Every month' : '매달 넣는 돈', value: wonFull((+growCfg.monthly || 0) * 1e4), money: true },
          { label: EN ? `Value after ${R.years}y` : `${R.years}년 뒤 평가금액`, value: wonFull(L.val), money: true },
          R.hit100 != null ? { label: EN ? '₩1M monthly dividend' : '월배당 100만원', value: EN ? `Year ${R.hit100}` : `${R.hit100}년 차`, money: false } : { label: EN ? 'Dividend growth' : '배당 성장(연)', value: pctPlain(R.gD, 1), money: false },
        ] };
    }
    if (kind === 'bonus') {
      const R = bonusCalc();
      if (!R.ready) return null;
      const CO = BONUS_CO[bonusCfg.co] || BONUS_CO.custom;
      return { kind, tag, title: EN ? '💼 Bonus take-home' : '💼 성과급 실수령액', bar: Math.min(1, R.netRatio),
        hero: { label: `${CO.name} ${EN ? 'take-home (est.)' : '실수령액(추정)'}`, value: manwon(R.net), money: true,
          alt: { label: EN ? 'Take-home ratio' : '세후 실수령 비율', value: pctPlain(R.netRatio, 0), money: false } },
        lines: [
          { label: EN ? 'Before tax' : '세전 성과급', value: manwon(R.B), money: true },
          { label: EN ? 'Tax & insurance' : '세금·4대보험', value: manwon(R.taxInc + R.insT), money: true },
          { label: EN ? 'Take-home ratio' : '세후 실수령 비율', value: pctPlain(R.netRatio, 0), money: false },
        ] };
    }
    return null;
  }
  async function openShare(kind, btn, opt) {
    const d = shareCardData(kind);
    if (d && opt?.title) d.title = opt.title;
    if (!d) { toast(EN ? 'Fill in the numbers first' : '먼저 값을 넣어 계산해 주세요', true); return; }
    if (btn) btn.disabled = true;
    try {
      const m = await import('./share-card.js?v=4');
      await m.openShareCard(d, {
        title: EN ? 'Share as image' : '이미지로 공유', close: EN ? 'Close' : '닫기', hide: EN ? 'Hide amounts (show % only)' : '금액 가리기 (퍼센트만 보여요)',
        save: EN ? 'Save image' : '이미지 저장', share: EN ? 'Share' : '공유하기', saved: EN ? 'Saved' : '이미지를 저장했어요',
        noShare: EN ? 'Sharing isn’t supported here — the image was saved instead' : '이 브라우저는 바로 공유가 안 돼서 이미지로 저장했어요',
        shareText: 'https://my-fire-portfolio.pages.dev/?ref=share-card', done: (msg) => toast(msg),
      });
      markUse('share');
    } catch (e) { console.error(e); toast(EN ? 'Could not make the image' : '이미지를 만들지 못했어요', true); }
    finally { if (btn) btn.disabled = false; }
  }

  // ---------------------------------------------------------------- 현재 상황 요약 (규칙 기반)
  // 목록 공통: 위 칩(전체·긍정·주의·중립)으로 골라 보고, 앞 4개만 펼친 뒤 나머지는 접어 둔다(고른 보기는 이번 방문 동안만 기억)
  const SUM_FOLD = 4;
  const sumTone = {};
  function sumListHtml(id, fixed, items) {
    const toneName = { pos: EN ? 'Positive' : '긍정', neg: EN ? 'Watch' : '주의', neu: EN ? 'Neutral' : '중립' };
    const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    const f = sumTone[id] || 'all';
    const n = { pos: 0, neg: 0, neu: 0 };
    for (const i of items) n[i.tone]++;
    const list = byTone(items).filter((i) => f === 'all' || i.tone === f);
    const row = (i) => `<li><button type="button" data-go="${i.go}"><span class="tone ${i.tone}">${toneName[i.tone]}</span><span class="txt">${i.html}</span>${chevron}</button></li>`;
    const head = list.slice(0, SUM_FOLD), rest = list.slice(SUM_FOLD), key = `sum-${id}-${f}`;
    const chips = [['all', EN ? 'All' : '전체', items.length], ['pos', toneName.pos, n.pos], ['neg', toneName.neg, n.neg], ['neu', toneName.neu, n.neu]];
    return `<div class="sum-count" role="group" aria-label="${EN ? 'Filter' : '골라 보기'}">${chips.map(([k, l, c]) => `<button type="button" class="tone ${k === 'all' ? 'all' : k}" data-sumtone="${id}:${k}" aria-pressed="${f === k}"${c || k === 'all' ? '' : ' disabled'}>${l} ${c}</button>`).join('')}</div>
        <ul class="sum-list">${f === 'all' ? fixed : ''}${head.map(row).join('')}${list.length ? '' : `<li class="sum-empty">${EN ? 'Nothing here right now.' : '지금은 해당 항목이 없어요.'}</li>`}</ul>
        ${rest.length ? `<details class="more sum-more" data-more="${key}" ${state.openMore.has(key) ? 'open' : ''}><summary><span>${EN ? `Show ${rest.length} more` : `${rest.length}개 더 보기`}</span></summary><ul class="sum-list">${rest.map(row).join('')}</ul></details>` : ''}`;
  }
  const TONE_ORDER = { pos: 0, neg: 1, neu: 2 };
  const byTone = (items) => items.map((it, i) => ({ it, i })).sort((a, b) => (TONE_ORDER[a.it.tone] - TONE_ORDER[b.it.tone]) || (b.it.weight - a.it.weight) || (a.i - b.i)).map((x) => x.it);
  function renderSummary() {
    const d = state.data;
    if (!d) return;
    const items = [];
    const sp = (v, dp = 1) => `<span class="${cls(v, 5e-5)}">${pct(v, dp)}</span>`;
    const add = (tone, go, html, tag, weight = 1) => items.push({ tone, go, html, tag, weight });

    const usdcRow = d.stables?.rows?.find((r) => r.sym === 'USDC');
    const usdtRow = d.stables?.rows?.find((r) => r.sym === 'USDT');
    if (usdcRow) {
      const t = usdcRow.ch30 > 0.01 ? 'pos' : usdcRow.ch30 < -0.01 ? 'neg' : 'neu';
      const vsT = usdtRow && usdcRow.ch30 != null && usdtRow.ch30 != null
        ? (usdcRow.ch30 > usdtRow.ch30 ? ' · USDT보다 빠르게 성장' : ' · USDT보다 성장 느림') : '';
      add(t, 'usdc:c-usdc', `USDC 유통량 <b>${usd(current('usdcTotal').v)}</b> · 7일 ${sp(usdcRow.ch7)} · 30일 ${sp(usdcRow.ch30)} · 점유율 ${pctPlain(usdcRow.share)}${vsT}`,
        t === 'pos' ? 'USDC 증가세' : t === 'neg' ? 'USDC 감소세' : null, 3);
    }

    const flow = usdcNetMint();
    if (flow.length > 14) {
      const s7 = flow.slice(-7).reduce((a, p) => a + p[1], 0), p7 = flow.slice(-14, -7).reduce((a, p) => a + p[1], 0);
      const t = s7 > 5e8 ? 'pos' : s7 < -5e8 ? 'neg' : 'neu';
      const sg = (v) => `<span class="${cls(v, 1)}">${v < 0 ? '-' : '+'}${usd(Math.abs(v))}</span>`;
      add(t, 'usdc:c-usdcflow', `USDC 7일 순발행 ${sg(s7)} · 직전 7일 ${sg(p7)}`, t === 'pos' ? 'USDC 순발행' : t === 'neg' ? 'USDC 순소각' : null, 2);
    }
    const rv = reserveEstimate();
    if (rv) add('neu', 'usdc:c-reserve', `준비금 이자수익 추정 연 <b>${usd(rv.annual)}</b> · 13주 국채 ${(rv.rate * 100).toFixed(2)}% 기준`, null, 0);

    const S = d.short;
    if (S?.daily?.length) {
      const last = S.daily.at(-1), diff = last.ratio - S.avgRatio;
      const t = diff > 0.05 ? 'neg' : diff < -0.05 ? 'pos' : 'neu';
      const si = S.interest?.at(-1);
      add(t, 'crcl:c-short', `공매도 비율 <b>${pctPlain(last.ratio)}</b>(${md(isoToTs(last.d))}) · 1개월 평균 ${pctPlain(S.avgRatio)}보다 ${Math.abs(diff * 100).toFixed(1)}%p ${diff >= 0 ? '높음' : '낮음'}${si ? ` · 잔고 ${esc(si.d.slice(5).replace('-', '/'))} ${si.chg > 0 ? '+' : ''}${si.chg.toFixed(1)}%` : ''}`,
        t === 'neg' ? '공매도 비중↑' : t === 'pos' ? '공매도 비중↓' : null, 2);
    }

    const ld = lendingDays();
    if (ld.length >= 2) {
      const a = ld.at(-1), b = ld.at(-2), ch = b.borrow ? a.borrow / b.borrow - 1 : 0;
      const t = ch > 0.1 ? 'pos' : ch < -0.1 ? 'neg' : 'neu';
      add(t, 'arc:c-lending', `Arc 대출 차입 <b>${usd(a.borrow)}</b> · 전일 대비 ${sp(ch, 0)} · 이용률 ${pctPlain(a.util)}`,
        t === 'pos' ? (ch > 0.3 ? 'Arc 대출 급증' : 'Arc 대출 증가') : t === 'neg' ? 'Arc 대출 감소' : null, 2);
    }

    const tv = d.arcTvl;
    if (tv?.daily?.length > 8) {
      const ago7 = tv.daily.at(-8)[1], ch = ago7 ? tv.now / ago7 - 1 : null;
      const t = ch > 0.05 ? 'pos' : ch < -0.05 ? 'neg' : 'neu';
      add(t, 'arc:c-tvl', `Arc TVL <b>${usd(tv.now)}</b> · 7일 ${sp(ch)} · DEX 24시간 ${usd(d.arcDex?.total24h)}`,
        t === 'pos' ? 'Arc TVL 증가' : t === 'neg' ? 'Arc TVL 감소' : null, 1);
    }

    const cc = d.cctp;
    if (cc?.rows) {
      const out = cc.net < 0;
      const top = cc.rows.slice().sort((a, b) => (out ? b.out - a.out : b.in - a.in))[0];
      const t = cc.net < -1e7 ? 'neg' : cc.net > 1e7 ? 'pos' : 'neu';
      add(t, 'arc:c-cctp', `CCTP 24시간 순${out ? '유출' : '유입'} <b>${usd(Math.abs(cc.net))}</b>${top ? ` · 최대 ${out ? '유출' : '유입'} ${esc(top.name)} ${usd(out ? top.out : top.in)}` : ''}`,
        t === 'neg' ? 'Arc 자금 순유출' : t === 'pos' ? 'Arc 자금 순유입' : null, 1);
    }

    const oc = d.onchain;
    if (oc?.days?.length > 7) {
      const now = (current('cirbtcArc').v ?? 0) + (current('cirbtcEth').v ?? 0);
      const w = oc.days.at(-7), ago7 = (w.arcBtc || 0) + (w.ethBtc || 0), ch = ago7 ? now / ago7 - 1 : null;
      const t = ch > 0.05 ? 'pos' : ch < -0.05 ? 'neg' : 'neu';
      add(t, 'arc:c-cirbtc', `cirBTC <b>${btc(now)}</b> · 7일 ${sp(ch)}`, t === 'pos' ? 'cirBTC 증가' : t === 'neg' ? 'cirBTC 감소' : null, 1);
    }

    const A = d.accounts;
    const lastDay = A?.daily?.filter((r) => !r.approx).at(-1);
    const lastWeek = A?.weeks?.filter((w) => !w.approx).at(-1);
    if (lastDay) add('neu', 'arc:c-accounts', `Arc 활성 계정 <b>${nf(0).format(lastDay.active)}</b>(${esc(lastDay.d.slice(5).replace('-', '/'))}) · 신규 ${nf(0).format(lastDay.new)}${lastWeek ? ` · 주간 재방문 ${pctPlain(lastWeek.retRatio)}` : ''}`, null, 0);

    const N = d.news;
    if (N) {
      const off = N.official?.[0];
      const k8 = N.filings?.find((f) => /^8-K/.test(f.form));
      const fresh8k = k8 && Date.now() - Date.parse(k8.d) < 3 * 86400000;
      for (const it of analystSummary('CRCL')) add(...it);
      if (off || fresh8k) add('neu', 'news:c-news', `${fresh8k ? `<b>8-K 공시</b>(${md(isoToTs(k8.d))}) · ` : ''}${off ? `최신 발표: ${esc(off.title.length > 48 ? off.title.slice(0, 47) + '…' : off.title)}` : ''}`, fresh8k ? '신규 8-K 공시' : null, 1);
    }

    const tags = items.filter((i) => i.tag).sort((a, b) => b.weight - a.weight).slice(0, 3);
    const nPos = items.filter((i) => i.tone === 'pos').length, nNeg = items.filter((i) => i.tone === 'neg').length;
    const toneName = { pos: '긍정', neg: '주의', neu: '중립' };
    const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    const pxLine = `<li><button type="button" data-go="crcl:c-pricechart"><span class="tone px"><span class="live-dot"></span>주가</span>
      <span class="txt">CRCL <b id="sum-px">${price(px.t?.last)}</b> · 24시간 <span id="sum-pxchg">${px.t ? `<span class="${cls(px.t.pct)}">${pct(px.t.pct, 1)}</span>` : '–'}</span></span>${chevron}</button></li>`;
    const fc = fireCfg ? fireCalc() : null;
    const fireLine = fc ? `<li><button type="button" data-go="fire:c-fire"><span class="tone px">🔥 Fire</span>
      <span class="txt">퇴사까지 <b>${(Math.max(0, fc.progress) * 100).toFixed(1)}%</b> · ${wonFull(fc.basis)} / ${wonFull(fc.F.goal)}</span>${chevron}</button></li>` : '';
    card('summary', {
      title: '현재 상황 요약',
      sub: `${state.syncedAt ? ago(state.syncedAt) : ago(d.updatedAt)} 업데이트 기준 · 규칙 기반 자동 요약`,
      info: INFO.summary,
      body: `
        <p class="sum-line">${tags.length ? tags.map((t) => `<span class="${t.tone}">${t.tag}</span>`).join('') : '뚜렷한 변화 없이 보합'}</p>
        ${sumListHtml('summary', pxLine + fireLine, items)}`,
    });
  }

  // ---------------------------------------------------------------- 추가 지표
  // USDC 일별 순발행(발행 − 소각): DefiLlama 일별 공급량의 하루 차이
  function usdcNetMint() {
    const s = state.data.series?.usdc || [];
    const out = [];
    for (let i = 1; i < s.length; i++) out.push([s[i][0], s[i][1] - s[i - 1][1]]);
    return out;
  }
  function renderUsdcFlow() {
    const flow = usdcNetMint().slice(-30);
    if (!flow.length) return failed('usdcflow', 'USDC 일별 순발행', state.data.errors?.series);
    const sum = (n) => flow.slice(-n).reduce((a, p) => a + p[1], 0);
    const s7 = sum(7), s30 = sum(30);
    const up = flow.filter((p) => p[1] > 0).length;
    const labels = flow.map((p) => p[0]);
    const signed = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${usd(Math.abs(v))}`;
    card('usdcflow', {
      title: 'USDC 일별 순발행', sub: '발행 − 소각 · DefiLlama 일별 공급량 차이', info: INFO.usdcflow,
      body: `<div class="headline"><span class="lbl">최근 7일</span><span class="big ${cls(s7, 1)}">${signed(s7)}</span><span class="lbl">하루 평균 ${signed(s7 / 7)}</span></div>
        <div class="delta-line"><span class="when">30일 합계 ${signed(s30)} · 30일 중 ${up}일 순발행 · 최근(${md(labels.at(-1))}, 집계 중) ${signed(flow.at(-1)[1])}</span></div>
        <div class="chart"><canvas id="cv-usdcflow" role="img" aria-label="USDC 일별 순발행"></canvas></div>
        <div class="legend"><span><i style="background:${C.up}"></i>순발행(증가)</span><span><i style="background:${C.down}"></i>순소각(감소)</span></div>`,
    });
    draw('usdcflow', {
      type: 'bar',
      data: { labels, datasets: [{ label: '순발행', data: flow.map((p) => p[1]), backgroundColor: flow.map((p) => (p[1] >= 0 ? C.up : C.down)), borderRadius: 3, borderSkipped: false, maxBarThickness: 16 }] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => fullDay(labels[it.dataIndex]), (v) => signed(v)) },
        scales: { x: axisX(labels, md, 6), y: axisY((v) => (v < 0 ? '-' : '') + usd(Math.abs(v))) },
      },
    });
  }

  // 서클 준비금 이자수익 추정: USDC 유통량 × 13주 국채 금리
  function reserveEstimate() {
    const r = state.data.rates?.latest;
    const u = current('usdcTotal');
    if (!r || u.v == null) return null;
    return { rate: r[1], rateDay: r[0], usdc: u.v, annual: u.v * r[1], t: u.t };
  }
  function renderReserve() {
    const x = reserveEstimate();
    const R = state.data.rates;
    if (!x || !R?.daily?.length) return failed('reserve', '서클 준비금 이자수익 추정', state.data.errors?.rates);
    const labels = R.daily.map((p) => isoToTs(p[0]));
    const r90 = R.daily[0][1];
    const flow7 = usdcNetMint().slice(-7).reduce((a, p) => a + p[1], 0);
    card('reserve', {
      title: '서클 준비금 이자수익 추정', sub: `USDC 유통량 × 미국 ${R.tenor} 국채 금리 · 연환산`, info: INFO.reserve,
      body: `<div class="headline"><span class="lbl">연간</span><span class="big">${usd(x.annual)}</span><span class="lbl">분기 ${usd(x.annual / 4)} · 하루 ${usd(x.annual / 365)}</span></div>
        <div class="delta-line"><span class="when">USDC ${usd(x.usdc)} × 금리 ${(x.rate * 100).toFixed(2)}% (${x.rateDay.slice(5).replace('-', '/')} 기준) · 유통 파트너 몫 차감 전</span></div>
        <div class="px-stats">
          <div><span>금리 0.25%p 인하 시</span><b class="down">-${usd(x.usdc * 0.0025)}</b><small>연간</small></div>
          <div><span>USDC $10억 증가 시</span><b class="up">+${usd(1e9 * x.rate)}</b><small>연간</small></div>
          <div><span>최근 7일 순발행 효과</span><b class="${cls(flow7, 1)}">${flow7 >= 0 ? '+' : '-'}${usd(Math.abs(flow7 * x.rate))}</b><small>연간</small></div>
        </div>
        <div class="mini-h" style="margin-top:14px;font-size:12px;color:var(--muted)">미국 ${R.tenor} 국채 금리 · 최근 90일 (${(r90 * 100).toFixed(2)}% → ${(x.rate * 100).toFixed(2)}%)</div>
        <div class="chart short"><canvas id="cv-reserve" role="img" aria-label="국채 금리 추이"></canvas></div>`,
    });
    draw('reserve', {
      type: 'line',
      data: { labels, datasets: [lineDs(`${R.tenor} 금리`, R.daily.map((p) => p[1]), C.teal, { pointRadius: endPoint(labels.length), tension: 0.1 })] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => fullDay(labels[it.dataIndex]), (v) => (v * 100).toFixed(2) + '%') },
        scales: { x: axisX(labels, md, 5), y: { ...axisY((v) => (v * 100).toFixed(2) + '%'), grace: '10%' } },
      },
    });
  }

  // Arc 네트워크 활동: 일별 트랜잭션 수 · 수수료(USDC)
  function renderArcActivity() {
    const A = state.data.arcActivity;
    if (!A?.daily?.length) return failed('arcactivity', 'Arc 네트워크 활동', state.data.errors?.arcActivity);
    const days = A.daily;
    const labels = days.map((r) => isoToTs(r.d));
    const done = days.filter((r) => !r.approx);
    const last = done.at(-1), prev = done.at(-2);
    const fee30 = done.reduce((s, r) => s + r.fee, 0);
    const ch = last && prev && prev.txns ? last.txns / prev.txns - 1 : null;
    card('arcactivity', {
      title: 'Arc 네트워크 활동', sub: '일별 트랜잭션 · 수수료(USDC) · Arc 탐색기', info: INFO.arcactivity,
      body: `<div class="headline"><span class="lbl">${last ? md(isoToTs(last.d)) : ''} 트랜잭션</span><span class="big">${last ? unit(last.txns) : '–'}</span><span class="lbl">수수료 ${usd(last?.fee)}</span></div>
        <div class="delta-line"><span class="${cls(ch)}">${arrow(ch)} ${pct(ch)}</span><span class="when">전일 대비 · 30일 수수료 합계 ${usd(fee30)} · 건당 평균 $${last && last.txns ? (last.fee / last.txns).toFixed(4) : '–'}</span></div>
        <div class="pair">
          <div><div class="mini-h">트랜잭션 수</div><div class="chart"><canvas id="cv-arctx" role="img" aria-label="Arc 일별 트랜잭션"></canvas></div></div>
          <div><div class="mini-h">수수료 (USDC)</div><div class="chart"><canvas id="cv-arcfee" role="img" aria-label="Arc 일별 수수료"></canvas></div></div>
        </div>
        <p class="note">회색 막대는 탐색기가 아직 집계 중인 오늘 값입니다.</p>`,
    });
    const mini = (id, key, color, fmt) => draw(id, {
      type: 'bar',
      data: { labels, datasets: [{ label: key === 'txns' ? '트랜잭션' : '수수료', data: days.map((r) => r[key]), backgroundColor: days.map((r) => (r.approx ? C.faint : color)), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: 'bottom', maxBarThickness: 12 }] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => fullDay(labels[it.dataIndex]) + (days[it.dataIndex].approx ? ' (집계 중)' : ''), fmt) },
        scales: { x: axisX(labels, md, 3), y: axisY(fmt, { beginAtZero: true }) },
      },
    });
    mini('arctx', 'txns', C.blue, (v) => unit(v));
    mini('arcfee', 'fee', C.teal, usd);
  }

  // ---------------------------------------------------------------- 브라우저 직접 동기화
  // 새로고침을 누르면 서버 수집(15분 간격)을 기다리지 않고 각 출처에서 지금 값을 받아온다.
  const CCTP = {
    tm: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    mt: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
    usdc: '3600000000000000000000000000000000000000',
    depositForBurn: '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5',
    mintAndWithdraw: '0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63',
    messageReceived: '0xff48c13eda96b1cceacc6b9edeedc9e9db9d6226afbc30146b720c19d3addb1c',
  };
  const DOMAINS = {
    0: 'Ethereum', 1: 'Avalanche', 2: 'OP Mainnet', 3: 'Arbitrum', 4: 'Noble', 5: 'Solana', 6: 'Base', 7: 'Polygon PoS', 8: 'Sui', 9: 'Aptos',
    10: 'Unichain', 11: 'Linea', 12: 'Codex', 13: 'Sonic', 14: 'World Chain', 15: 'Monad', 16: 'Sei', 17: 'BNB Chain', 18: 'XDC', 19: 'HyperEVM',
    21: 'Ink', 22: 'Plume', 25: 'Starknet', 26: 'Arc', 27: 'Stellar', 28: 'EDGE', 29: 'Injective', 30: 'Morph', 31: 'Pharos', 32: 'Cronos', 33: 'Plasma', 37: 'X Layer',
  };
  const hexN = (n) => '0x' + n.toString(16);
  async function getJ(url, ms = 15000) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }
  async function rpcJson(urls, method, params) {
    let err;
    for (const u of urls) {
      try {
        const r = await fetch(u, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        return j.result;
      } catch (e) { err = e; }
    }
    throw err;
  }
  async function supplyOf(urls, token, decimals) {
    const r = await rpcJson(urls, 'eth_call', [{ to: token, data: '0x18160ddd' }, 'latest']);
    return r && r !== '0x' ? Number(BigInt(r)) / 10 ** decimals : null;
  }
  function parseCctp(logs) {
    const word = (data, i) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64));
    const out = [];
    const byTx = {};
    for (const l of logs) (byTx[l.transactionHash] ||= []).push(l);
    for (const list of Object.values(byTx)) {
      list.sort((a, b) => parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
      const src = (i) => {
        for (let j = i + 1; j < list.length; j++) if (list[j].topics[0] === CCTP.messageReceived) return Number(word(list[j].data, 0));
        for (let j = i - 1; j >= 0; j--) if (list[j].topics[0] === CCTP.messageReceived) return Number(word(list[j].data, 0));
        return -1;
      };
      list.forEach((l, i) => {
        const b = parseInt(l.blockNumber, 16);
        if (l.topics[0] === CCTP.depositForBurn && l.topics[1]?.toLowerCase().endsWith(CCTP.usdc)) {
          out.push([b, 1, Number(word(l.data, 2)), Number(word(l.data, 0)) / 1e6]);
        } else if (l.topics[0] === CCTP.mintAndWithdraw && l.topics[2]?.toLowerCase().endsWith(CCTP.usdc)) {
          out.push([b, 0, src(i), Number(word(l.data, 0) + word(l.data, 1)) / 1e6]);
        }
      });
    }
    return out;
  }

  // 각 항목: (data, 결과값 모음) → data의 해당 섹션을 최신값으로 교체
  let circleBlockedUntil = 0; // Circle API 직접 조회가 429로 막혔을 때 쉬는 시각
  const SYNC = {
    async circle(d, L) {
      // Circle API는 IP당 제한이 엄격해(429 → 약 20분 대기) Worker의 1분 캐시를 먼저 쓰고, 직접 조회는 예비로만
      let j = null;
      try { j = await getJ(`${NEWS_API}/circle`, 20000); } catch {}
      if (!j?.data && Date.now() > circleBlockedUntil) {
        try { j = await getJ(LIVE.circle); } catch (e) {
          if (String(e.message) === '429') circleBlockedUntil = Date.now() + 20 * 60000;
        }
      }
      if (!j?.data) {
        // 직전 값이 30분 안이면 실패로 치지 않고 그 값을 계속 쓴다
        const lv = state.live.usdcTotal;
        if (lv && Date.now() - Date.parse(lv.t) < 30 * 60000) return;
        throw new Error('circle');
      }
      const pick = (s) => j.data.find((x) => x.symbol === s);
      const u = pick('USDC'), e = pick('EURC');
      const on = (c, n) => Number(c?.chains?.find((x) => x.chain === n)?.amount ?? NaN);
      if (u) {
        L.usdcTotal = Number(u.totalAmount);
        L.arcUsdc = on(u, 'ARC');
        state.usdcChains = u.chains.map((x) => ({ chain: x.chain, amount: Number(x.amount) })).sort((a, b) => b.amount - a.amount);
      }
      if (e) { L.eurcTotal = Number(e.totalAmount); L.arcEurc = on(e, 'ARC'); }
    },
    async cirbtc(d, L) {
      const [a, e] = await Promise.all([supplyOf(LIVE.arcRpc, LIVE.arcCirbtc, 8), supplyOf(LIVE.ethRpc, LIVE.ethCirbtc, 8)]);
      if (a != null) L.cirbtcArc = a;
      if (e != null) L.cirbtcEth = e;
      if (a != null && e != null) L.cirbtc = a + e;
    },
    async stables(d, L) {
      if (!d.stables?.rows?.[0]?.id) return;
      const j = await getJ('https://stablecoins.llama.fi/stablecoins?includePrices=true', 25000);
      const byId = Object.fromEntries(j.peggedAssets.map((a) => [a.id, a]));
      const val = (o) => (o ? Object.values(o)[0] || 0 : 0);
      const totalUsd = j.peggedAssets.reduce((s, a) => s + (a.circulating?.peggedUSD || 0), 0);
      const upd = (r) => {
        const a = byId[r.id];
        if (!a) return r;
        const cur = val(a.circulating), w = val(a.circulatingPrevWeek), m = val(a.circulatingPrevMonth), dd = val(a.circulatingPrevDay);
        return { ...r, supply: cur, share: r.cur === 'EUR' ? null : cur / totalUsd, ch1: dd ? cur / dd - 1 : null, ch7: w ? cur / w - 1 : null, ch30: m ? cur / m - 1 : null };
      };
      const rows = d.stables.rows.map(upd), products = d.stables.products.map(upd);
      d.stables = { ...d.stables, totalUsd, rows, products, usdcShare: rows.find((r) => r.sym === 'USDC')?.share };
      L.usdcShare = d.stables.usdcShare;
      const usdcNow = byId['2'] ? val(byId['2'].circulating) : null;
      if (usdcNow && d.series?.usdc?.length) {
        const today = Math.floor(Date.now() / 86400000) * 86400;
        const usdc = d.series.usdc.slice();
        if (usdc.at(-1)[0] === today) usdc[usdc.length - 1] = [today, usdcNow];
        else if (usdc.at(-1)[0] < today) usdc.push([today, usdcNow]);
        d.series = { ...d.series, usdc };
      }
      L.usycSupply = products.find((p) => p.sym === 'USYC')?.supply;
    },
    async dex(d, L) {
      const j = await getJ('https://api.llama.fi/overview/dexs/Arc?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true');
      const today = Math.floor(Date.now() / 86400000) * 86400;
      const daily = (j.totalDataChart || []).filter(([t]) => t < today).slice(-30);
      const top = (j.protocols || []).filter((p) => p.total24h > 0).sort((a, b) => b.total24h - a.total24h).slice(0, 6).map((p) => ({ name: p.displayName || p.name, v: p.total24h }));
      d.arcDex = { ...d.arcDex, total24h: j.total24h, total7d: j.total7d, total30d: j.total30d, change1d: j.change_1d, top, ...(daily.length ? { daily } : {}) };
      L.dex24h = j.total24h;
    },
    async tvl(d, L) {
      const [j, hist] = await Promise.all([getJ('https://api.llama.fi/v2/chains'), getJ('https://api.llama.fi/v2/historicalChainTvl/Arc').catch(() => null)]);
      const arc = j.find((c) => c.name === 'Arc');
      if (!arc) return;
      let daily = d.arcTvl?.daily || [];
      if (Array.isArray(hist) && hist.length) {
        const first = hist.findIndex((p) => p.tvl > 1e5);
        daily = hist.slice(Math.max(0, first - 1)).map((p) => [p.date, p.tvl]);
      }
      d.arcTvl = cleanArcTvl(daily, arc.tvl);
      L.tvl = d.arcTvl.now;
    },
    async series(d) { // USDC·EURC·USYC 일별 공급량 추이 (DefiLlama를 중계 서버로 — 30분 캐시)
      const j = await getJ(`${NEWS_API}/series`, 25000);
      if (j.error || !j.usdc?.length) throw new Error(j.error || 'series');
      // 같은 동기화에서 '스테이블코인'이 붙여 둔 오늘 값은 남긴다
      const keep = (arr, cur) => { const last = cur?.at(-1); return last && last[0] > arr.at(-1)[0] ? [...arr, last] : arr; };
      // 중계 서버 기록이 수집기 기록보다 짧으면(예: CoinGecko가 워커를 막아 USYC가 10/14에서 끊김) 더 최근까지 있는 쪽을 쓴다
      const newer = (a, b) => (a?.length && (a.at(-1)[0] >= (b?.at(-1)?.[0] ?? 0)) ? a : b);
      d.series = { usdc: keep(j.usdc, d.series?.usdc), eurc: newer(j.eurc, d.series?.eurc), usyc: newer(j.usyc, d.series?.usyc) };
    },
    async facts() { state.facts = await getJ(`${NEWS_API}/facts`, 15000); }, // FAA %·보호예수 공시 자동 확인 결과
    async rates(d) { // 미 재무부 13주 국채 금리
      const now = new Date();
      const years = now.getUTCMonth() < 3 ? [now.getUTCFullYear() - 1, now.getUTCFullYear()] : [now.getUTCFullYear()];
      const rows = [];
      for (const y of years) {
        const r = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_bill_rates&field_tdr_date_value=${y}&page&_format=csv`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error('treasury ' + r.status);
        const lines = (await r.text()).trim().split(/\r?\n/);
        const col = lines[0].split(',').map((h) => h.replace(/"/g, '')).indexOf('13 WEEKS COUPON EQUIVALENT');
        for (const l of lines.slice(1)) {
          const c = l.split(','), [m, dd, yy] = c[0].split('/'), v = parseFloat(c[col]);
          if (isFinite(v)) rows.push([`${yy}-${m}-${dd}`, v / 100]);
        }
      }
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      if (rows.length) d.rates = { tenor: '13주', latest: rows.at(-1), daily: rows.slice(-90) };
    },
    async short(d, L) { // FINRA 일별 공매도: 서버에 없는 최근 거래일만 추가로 받는다
      const S = d.short;
      if (!S?.daily?.length) return;
      const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
      const add = [], addO = {};
      for (let ms = Date.parse(S.daily.at(-1).d + 'T00:00:00Z') + 86400000; ms <= Date.now(); ms += 86400000) {
        const wd = new Date(ms).getUTCDay();
        if (wd === 0 || wd === 6 || ms + 22 * 3600000 > Date.now()) continue; // 당일 파일은 미국 저녁에 올라온다
        const day = fmt(ms);
        const r = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${day.replaceAll('-', '')}.txt`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
        if (!r?.ok) continue;
        const lines = (await r.text()).split('\n');
        const pick = (sym) => { const l = lines.find((x) => x.split('|')[1] === sym); if (!l) return null; const [, , sv, sev, tv] = l.split('|'); return { d: day, short: +sv, exempt: +sev, total: +tv, ratio: +sv / +tv }; };
        const c = pick('CRCL');
        if (c) add.push(c);
        for (const s of BUILTIN_OTHER) { const r = pick(s); if (r) (addO[s] ||= []).push(r); }
      }
      const cutoff = Date.now() / 1000 - 31 * 86400;
      const merge = (base, extra) => {
        const daily = [...(base?.daily || []), ...extra].filter((r, i, a) => isoToTs(r.d) >= cutoff && a.findIndex((x) => x.d === r.d) === i);
        const sumS = daily.reduce((a, r) => a + r.short, 0), sumT = daily.reduce((a, r) => a + r.total, 0);
        return { ...base, daily, avgRatio: sumT ? sumS / sumT : 0 };
      };
      const by = { ...(S.by || (S.joby ? { JOBY: S.joby } : {})) };
      for (const s of BUILTIN_OTHER) if (addO[s]?.length && by[s]) by[s] = merge(by[s], addO[s]);
      if (!add.length) { d.short = { ...S, by, joby: by.JOBY }; return; }
      d.short = { ...merge(S, add), by, joby: by.JOBY };
      L.shortRatio = d.short.daily.at(-1).ratio;
    },
    async quote() { await loadQuote(); }, // 종목 카드·Fire 시세·환율
    // ---- 선택한 종목만 받는다 (sym을 먼저 잡아 두어 도중에 종목을 바꿔도 섞이지 않게)
    async faa() { state.faa = await getJ(`data/faa-joby.json?t=${Math.floor(Date.now() / 600000)}`); },
    async temk() { state.temk = await getJ(`data/tem-kpis.json?t=${Math.floor(Date.now() / 600000)}`); },
    async biz(d, L, sym = state.stock) {
      const k = bizKey(sym), S = (state.biz ||= {});
      if (BIZ_KEYS.has(k)) { S[k] = await getJ(`data/biz/${k}.json?t=${Math.floor(Date.now() / 600000)}`); return; }
      if (!bizAuto(sym)) return;
      if (S[k] && Date.now() - (S[k]._t || 0) < 6 * 3600000) return; // 6시간 안에 받은 건 그대로
      try { S[k] = { ...(await getJ(`${NEWS_API}/biz?s=${encodeURIComponent(sym)}`, 12000)), _t: Date.now() }; bizSave(k, S[k]); }
      catch (e) { if (/^404$/.test(e.message)) { S[k] = null; bizSave(k, null); } else if (!S[k]) throw e; }
    },
    async sfacts() { state.spcx = await getJ(`data/spcx-facts.json?t=${Math.floor(Date.now() / 600000)}`); },
    async schart(d, L, sym = state.stock) {
      const s = sym, x = st(s);
      if (!isOther(s)) return;
      if (BN24[s]) { await Promise.all([bxSnapshot(s), bxKlines(s, '1d'), bxRange() !== '1d' && s === state.stock ? bxKlines(s, bxRange()) : null]); return; }
      const fresh = (r) => x.chart[r] && Date.now() - Date.parse(x.chart[r].at || 0) < 3600000; // 1주 이상 차트·52주 값은 1시간마다 새로
      await Promise.all([loadSChart(s, '1d'), state.srange !== '1d' && !fresh(state.srange) ? loadSChart(s, state.srange) : null, fresh('1y') ? null : loadSChart(s, '1y').catch(() => {})]);
    },
    async searn(d, L, sym = state.stock) {
      const s = sym, x = st(s);
      if (!isOther(s)) return;
      try {
        const j = await getJ(`${NEWS_API}/earnings?s=${s}${earnDay(s) ? '&live=1' : freshSync() ? '&fresh=1' : ''}`, 25000);
        if (j.error) throw new Error(j.error);
        x.earn = j; x.earnErr = false;
      } catch (e) { x.earnErr = true; if (!x.earn) throw e; }
    },
    async etfdiv(d, L, sym = state.stock) { // ETF: 분배금(배당) 기록 — 서버 캐시
      if (!isOther(sym) || isKR(sym) || !isEtf(sym)) return;
      const x = st(sym);
      if (x.etfDiv && Date.now() - x.etfDivAt < 3 * 3600000) return;
      const j = await getJ(`${NEWS_API}/dividends?s=${sym}`, 20000);
      if (j.error) throw new Error(j.error);
      x.etfDiv = j; x.etfDivAt = Date.now();
    },
    async krinfo(d, L, sym = state.stock) { // 한국 종목: 투자 지표·투자자별 매매·애널리스트·분기 실적(서버 30분 캐시)
      if (!isKR(sym)) return;
      const j = await getJ(`${NEWS_API}/krinfo?s=${sym}`, 20000);
      if (j.error) throw new Error(j.error);
      st(sym).krinfo = j;
    },
    async snews(d, L, sym = state.stock) {
      const s = sym, x = st(s);
      if (!isOther(s)) return;
      const j = await getJ(`${NEWS_API}/news?s=${s}${freshSync() ? '&fresh=1' : ''}`, 25000);
      if (j.error) throw new Error(j.error);
      const ownerMap = {};
      for (const f of j.filings || []) (ownerMap[f.d + '|' + f.form] ||= []).push(f.owner);
      const cur = x.news || {};
      const fallback = (j.filings || []).map((f) => ({ ...f, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${STOCK_INFO[s].cik}&type=&dateb=&owner=include&count=40` }));
      x.news = { ...cur, official: j.official, kr: j.kr, en: j.en, crypto: j.crypto || [], newsAt: j.at, ownerMap, filings: cur.filings || fallback };
    },
    async sfilings(d, L, sym = state.stock) { // SEC EDGAR에서 직접
      const s = sym, x = st(s), cik = STOCK_INFO[s]?.cik || x.earn?.cik;
      if (!isOther(s) || !cik) return;
      let j;
      try { j = await getJ(`https://data.sec.gov/submissions/CIK${cik}.json`); } catch (e) { if (x.news?.filings?.length) return; throw e; }
      const r = j.filings.recent, list = [];
      for (let i = 0; i < Math.min(100, r.form.length); i++) {
        const acc = r.accessionNumber[i];
        list.push({ d: r.filingDate[i], form: r.form[i], owner: '', desc: r.primaryDocDescription[i], items: r.items?.[i] || '', url: `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}` });
      }
      x.news = { ...(x.news || {}), filings: list, filingsAt: new Date().toISOString() };
    },
    async options(d, L, sym = state.stock) { // 옵션 시장 심리(CBOE) — 실적 발표일을 넘겨 실적 포함 만기 변동폭도 계산
      const e = earnOf(sym)?.next?.date || '';
      try {
        const j = await getJ(`${NEWS_API}/options?s=${sym}&e=${e}`, 20000);
        if (j.error) throw new Error(j.error);
        (state.options ||= {})[sym] = j;
        if (state.optionsErr) delete state.optionsErr[sym];
      } catch (er) { (state.optionsErr ||= {})[sym] = String(er.message || er); if (!state.options?.[sym] && !/옵션이 없어요/.test(er.message)) throw er; }
    },
    async market() { const j = await getJ(`${NEWS_API}/market`, 15000); if (j.error) throw new Error(j.error); state.market = j; },
    async feargreed() { const j = await getJ(`${NEWS_API}/feargreed${freshSync() ? '?fresh=1' : ''}`, 15000); if (j.error) throw new Error(j.error); state.fg = j; }, // 공포·탐욕 지수(서버 15분 캐시)
    async mnews() { const j = await getJ(`${NEWS_API}/mnews${freshSync() ? '?fresh=1' : ''}`, 20000); if (j.error) throw new Error(j.error); state.mnews = j; },
    async sshort(d, L, sym = state.stock) { // 추가한 종목의 공매도(FINRA, 서버 3시간마다)
      const j = await getJ(`${NEWS_API}/short?s=${sym}`, 20000);
      if (j.error) throw new Error(j.error);
      st(sym).short = j;
    },
    async analyst(d, L, sym = state.stock) { // 애널리스트 목표가·투자의견·내부자 매매 — 서버 3시간마다(실적 발표 무렵 5분)
      try {
        const j = await getJ(`${NEWS_API}/analyst?s=${sym}${earnDay(sym) ? '&live=1' : ''}`, 20000);
        if (j.error) throw new Error(j.error);
        (state.analyst ||= {})[sym] = j;
      } catch (e) { if (!state.analyst?.[sym]) throw e; }
    },
    async holders(d, L, sym = state.stock) { // 기관 보유(13F) — 서버 6시간 캐시
      const s = sym;
      try {
        const j = await getJ(`${NEWS_API}/holders?s=${s}`, 20000);
        if (j.error) throw new Error(j.error);
        state.holders[s] = j;
      } catch (e) { if (!state.holders[s]) throw e; }
    },
    async earnings() { // 분기 실적·다음 발표일 (서버에서 6시간 캐시)
      try {
        const j = await getJ(`${NEWS_API}/earnings${earnDay('CRCL') ? '?live=1' : freshSync() ? '?fresh=1' : ''}`, 25000);
        if (j.error) throw new Error(j.error);
        state.earnings = j;
        state.earningsErr = false;
        try { renderEarnings(); } catch {}
      } catch (e) {
        state.earningsErr = true;
        if (!state.earnings) throw e;
      }
    },
    async news(d) { // 구글 뉴스·서클 발표: Cloudflare Worker가 중계 (새로고침 버튼은 캐시 없이)
      if (!NEWS_API || NEWS_API.startsWith('WORKER')) return;
      const j = await getJ(`${NEWS_API}/news${freshSync() ? '?fresh=1' : ''}`, 25000);
      if (j.error) throw new Error(j.error);
      const ownerMap = {};
      for (const f of j.filings || []) (ownerMap[f.d + '|' + f.form] ||= []).push(f.owner);
      d.news = { ...(d.news || {}), official: j.official, kr: j.kr, en: j.en, crypto: j.crypto || [], newsAt: j.at, ownerMap };
    },
    async filings(d) { // SEC EDGAR에서 직접 (서버를 거치지 않음)
      // SEC가 가끔 직접 요청을 막는다 — 서버(/news)가 받아 둔 공시 목록이 있으면 그걸로 두고 실패로 치지 않는다
      let j;
      try { j = await getJ('https://data.sec.gov/submissions/CIK0001876042.json'); } catch (e) { if (d.news?.filings?.length) return; throw e; }
      const r = j.filings.recent;
      const owners = {};
      for (const f of d.news?.filings || []) (owners[f.d + '|' + f.form] ||= []).push(f.owner);
      const list = [];
      for (let i = 0; i < Math.min(100, r.form.length); i++) {
        const acc = r.accessionNumber[i];
        list.push({
          d: r.filingDate[i], form: r.form[i], owner: (owners[r.filingDate[i] + '|' + r.form[i]] || []).shift() || '',
          desc: r.primaryDocDescription[i], items: r.items?.[i] || '',
          url: `https://www.sec.gov/Archives/edgar/data/1876042/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}`,
        });
      }
      if (list.length) d.news = { ...(d.news || {}), filings: list, filingsAt: new Date().toISOString(), filingsSrc: 'SEC EDGAR' };
    },
    async lending(d, L) { // 1.4MB라 새로고침 버튼을 눌렀을 때만
      if (!d.lending?.days?.length) return;
      const j = await getJ('https://api.llama.fi/lite/protocols2?b=2', 30000);
      const get = (name) => j.protocols.find((p) => p.name === name)?.chainTvls || {};
      const m = get('Morpho Blue'), a = get('Aave V4');
      const row = { morphoT: m.Arc?.tvl || 0, morphoB: m['Arc-borrowed']?.tvl || 0, aaveT: a.Arc?.tvl || 0, aaveB: a['Arc-borrowed']?.tvl || 0 };
      row.borrow = row.morphoB + row.aaveB;
      row.tvl = row.morphoT + row.aaveT;
      row.util = row.borrow + row.tvl > 0 ? row.borrow / (row.borrow + row.tvl) : 0;
      const today = Math.floor(Date.now() / 86400000) * 86400;
      const days = d.lending.days.slice();
      if (days.at(-1).d === today) days[days.length - 1] = { ...days.at(-1), ...row };
      else days.push({ d: today, ...row });
      d.lending = { ...d.lending, days };
      L.borrow = row.borrow;
      L.util = row.util;
    },
    async accounts(d, L) {
      const b = 'https://explorer.arc.io/stats-service/api/v1/lines';
      const [a, n, aw, nw] = await Promise.all([
        getJ(`${b}/activeAccounts?resolution=DAY`), getJ(`${b}/newAccounts?resolution=DAY`),
        getJ(`${b}/activeAccounts?resolution=WEEK`), getJ(`${b}/newAccounts?resolution=WEEK`),
      ]);
      const nm = Object.fromEntries(n.chart.map((p) => [p.date, Number(p.value)]));
      const daily = a.chart.map((p) => { const act = Number(p.value), nn = nm[p.date] ?? 0; return { d: p.date, active: act, new: Math.min(nn, act), ret: Math.max(act - nn, 0), approx: !!p.is_approximate }; });
      const wm = Object.fromEntries(nw.chart.map((p) => [p.date, Number(p.value)]));
      const weeks = aw.chart.map((p) => { const act = Number(p.value), nn = wm[p.date] ?? 0; return { d: p.date, active: act, new: nn, retRatio: act ? Math.max(act - nn, 0) / act : 0, approx: !!p.is_approximate }; }).slice(-8);
      d.accounts = { ...d.accounts, daily, weeks };
    },
    async activity(d, L) {
      const b = 'https://explorer.arc.io/stats-service/api/v1/lines';
      const [tx, fee] = await Promise.all([getJ(`${b}/newTxns?resolution=DAY`), getJ(`${b}/txnsFee?resolution=DAY`)]);
      const fm = Object.fromEntries(fee.chart.map((p) => [p.date, Number(p.value)]));
      d.arcActivity = { daily: tx.chart.map((p) => ({ d: p.date, txns: Number(p.value), fee: fm[p.date] ?? 0, approx: !!p.is_approximate })).slice(-30) };
    },
    async cctp(d, L) { // 서버 수집 이후 새 블록만 추가로 읽는다
      const c = d.cctp;
      if (!c?.events) return;
      const latest = Number(await rpcJson(LIVE.arcRpc, 'eth_blockNumber', []));
      const start = latest - Math.round(86400 / (c.blockTime || 0.5));
      let from = (c.syncedTo || c.toBlock) + 1;
      let events = c.events.slice();
      if (from < start) { from = start; events = []; } // 24시간 넘게 벌어졌으면 처음부터 다시 집계
      const filter = { address: [CCTP.tm, CCTP.mt], topics: [[CCTP.depositForBurn, CCTP.mintAndWithdraw, CCTP.messageReceived]] };
      while (from <= latest) {
        let done = false;
        for (const [url, span] of [['https://rpc.blockdaemon.mainnet.arc.io', 45000], ['https://rpc.mainnet.arc.io', 4900]]) {
          const to = Math.min(from + span - 1, latest);
          try {
            const logs = await rpcJson([url], 'eth_getLogs', [{ ...filter, fromBlock: hexN(from), toBlock: hexN(to) }]);
            events.push(...parseCctp(logs));
            from = to + 1;
            done = true;
            break;
          } catch {}
        }
        if (!done) throw new Error('cctp logs');
      }
      const kept = events.filter((e) => e[0] >= start);
      const by = {};
      for (const [, dir, dom, amt] of kept) {
        const r = (by[dom] ||= { domain: dom, name: DOMAINS[dom] || `도메인 ${dom}`, in: 0, out: 0, nIn: 0, nOut: 0 });
        if (dir === 0) { r.in += amt; r.nIn++; } else { r.out += amt; r.nOut++; }
      }
      const rows = Object.values(by).sort((a, b) => b.in + b.out - (a.in + a.out));
      const totalIn = rows.reduce((s, r) => s + r.in, 0), totalOut = rows.reduce((s, r) => s + r.out, 0);
      d.cctp = { ...c, fromBlock: start, toBlock: latest, syncedTo: latest, events: kept, rows, totalIn, totalOut, net: totalIn - totalOut };
      L.cctpNet = totalIn - totalOut;
    },
  };
  const SYNC_NAMES = { circle: '서클 유통량', cirbtc: 'cirBTC', stables: '스테이블코인', series: '공급량 추이', dex: 'DEX', tvl: 'TVL', lending: '대출', accounts: '활성 계정', activity: 'Arc 활동', cctp: 'CCTP', rates: '국채 금리', short: '공매도', filings: 'SEC 공시', news: '뉴스', earnings: '실적', quote: '주가·환율', faa: 'FAA 인증', sfacts: '보호예수 일정', facts: '자동 확인 자료', schart: '가격 차트', searn: '종목 실적', snews: '종목 뉴스', sfilings: '종목 공시', holders: '기관 보유', analyst: '애널리스트·내부자', options: '옵션 심리', sshort: '공매도', market: '시장 개요', mnews: '시장 뉴스' };

  // parts: 동기화할 항목 이름 목록
  // 항목마다 도착하는 대로 화면에 반영한다(느린 항목 하나 때문에 전체가 늦어지지 않게). quiet: 화면 갱신 없이 받아만 두기
  let renderTimer = null;
  function scheduleRenderAll() { clearTimeout(renderTimer); renderTimer = setTimeout(renderAll, 120); }
  async function syncNow(parts, { sym, quiet = false } = {}) {
    const d = state.data;
    if (!d) return { ok: 0, fail: [] };
    const L = {};
    const flush = () => { const t = new Date().toISOString(); for (const [k, v] of Object.entries(L)) if (v != null && isFinite(v)) state.live[k] = { v, t }; };
    const res = await Promise.allSettled(parts.map((p) => Promise.resolve()
      .then(() => SYNC[p](d, L, sym ?? state.stock))
      .then(() => { if (!quiet) { flush(); scheduleRenderAll(); } })));
    const fail = parts.filter((p, i) => res[i].status === 'rejected');
    flush();
    if (parts.length > 2 && !quiet) { state.syncedAt = new Date().toISOString(); state.syncFail = fail; pushLocalSnap(); }
    saveSnapshot();
    return { ok: parts.length - fail.length, fail };
  }

  // ---------------------------------------------------------------- Fire (퇴사 목표 진행률 · 포트폴리오 전체)
  // 보유 정보는 이 기기(브라우저)에만 저장한다. 코드·서버·링크에는 개인 보유 현황이 들어가지 않는다.
  const FIRE_KEY = 'cw.fire', FIRE_HIST = 'cw.fireHist';
  const FIRE_TICKERS = { CRCA: 'CRCA · ProShares Ultra CRCL (2배)', CRCL: 'CRCL · 서클 인터넷 그룹', JOBY: 'JOBY · 조비 에비에이션', SPCX: 'SPCX · 스페이스X', TEM: 'TEM · 템퍼스 AI' };
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  // 👀 예시로 둘러보기: 이 탭에서만 예시 포트폴리오로 화면을 채운다(내 저장 정보는 읽지도 바꾸지도 않음). ?demo=1 링크로도 켠다
  const DEMO = (() => {
    try {
      const q = new URLSearchParams(location.search).get('demo');
      if (q === '1') sessionStorage.setItem('cw.demo', '1');
      if (q === '0') sessionStorage.removeItem('cw.demo');
      return sessionStorage.getItem('cw.demo') === '1';
    } catch { return false; }
  })();
  const DEMO_BLOCK = new Set(['cw.memo', 'cw.fire', 'cw.fireHist', 'cw.div', 'cw.fireMile', 'cw.visit', 'cw.pxDay', 'cw.targets', 'cw.votes', 'cw.acct', 'cw.fininc', 'cw.rebal']);
  const DEMO_FIRE = { positions: [{ ticker: 'CRCL', shares: 400, avg: 72, n: '서클 인터넷 그룹' }, { ticker: 'JOBY', shares: 3000, avg: 6.2, n: '조비 에비에이션' }, { ticker: 'SCHD', shares: 800, avg: 26.5, n: 'Schwab US Dividend Equity ETF' }, { ticker: '005930.KS', shares: 150, avg: 62000, n: '삼성전자' }], goal: 1e9, buyFx: 1350, afterTax: false };
  const DEMO_DIV = { hold: [{ t: 'SCHD', sh: 800, avg: 26.5, d: '2024-03-04' }, { t: 'O', sh: 300, avg: 54, d: '2024-06-03' }, { t: 'JEPI', sh: 400, avg: 55, d: '2025-01-13' }, { t: 'KO', sh: 100, avg: 60, d: '2024-09-03' }], tax: 0.15 };
  const writeJSON = (k, v) => { if (DEMO && DEMO_BLOCK.has(k)) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const readSaved = (k, d) => (DEMO && DEMO_BLOCK.has(k) ? ({ 'cw.fire': DEMO_FIRE, 'cw.div': DEMO_DIV })[k] ?? d : readJSON(k, d));
  // 미국 티커 또는 한국 종목(종목코드.KS/.KQ)
  const FIRE_BASE = Object.keys(FIRE_TICKERS), TICKER_RE = /^([A-Z]{1,5}(\.[A-Z])?|[0-9A-Z]{6}\.(KS|KQ))$/;
  const krTk = (s) => /^[0-9A-Z]{6}\.(KS|KQ)$/.test(String(s || ''));
  const I18N_KEEP = (window.__i18nKeepSet ||= new Set()); // 영어 보기에서 그대로 둘 한국 종목 이름
  const keepName = (n) => { if (n && /[가-힣]/.test(n)) I18N_KEEP.add(String(n)); return n; };
  // 보유 종목 선택지 이름: 미국 'TSLA · 테슬라', 한국 '삼성전자 · 005930'
  const fireLabel = (t, n) => (!n || n === t ? t : krTk(t) ? `${keepName(n)} · ${t.slice(0, 6)}` : `${t} · ${n}`);
  for (const [sym, m] of Object.entries(readJSON('cw.watch', null)?.custom || {})) if (TICKER_RE.test(sym)) FIRE_TICKERS[sym] ||= krTk(sym) ? `${m?.name || sym} · ${sym.slice(0, 6)}` : `${sym} · ${m?.name || sym}`;
  // 관심 종목에서 뺐어도 보유 정보에 남아 있는 종목은 계속 고를 수 있게
  for (const p of readSaved(FIRE_KEY, null)?.positions || []) if (TICKER_RE.test(p?.ticker || '')) FIRE_TICKERS[p.ticker] ||= fireLabel(p.ticker, p.n);
  // 보유 종목 선택지: CRCA → 관심 종목 순서 → 나머지 기본 종목. 관심 종목에서 뺀 종목은 목록에서 빠진다
  // (keep: 이미 그 종목으로 저장된 행은 값이 바뀌지 않도록 그 행에만 남긴다)
  const fireName = (t) => (krTk(t) ? keepName(STOCK_INFO[t]?.short || state.divData?.[t]?.d?.name || (FIRE_TICKERS[t] || t).split(' · ')[0].replace(/\.K[SQ]$/, '')) : t);
  const fireTickerOrder = (keep) => [...new Set(['CRCA', ...WATCH, ...FIRE_BASE, ...(keep ? [keep] : [])])].filter((k) => FIRE_TICKERS[k]);
  const firePicked = (k) => FIRE_BASE.includes(k) || WATCH.includes(k);
  // Nasdaq에서 받는 시세에 따로 요청해야 하는 보유 종목(기본 5종목 외)
  const fireExtraSyms = () => (fireCfg?.positions || []).map((p) => p.ticker).filter((t) => !FIRE_BASE.includes(t) && !krTk(t));
  // 예전 형식({ticker, shares, avg})은 종목 목록 형식으로 바꿔 읽는다
  const normFire = (F) => {
    if (!F) return null;
    if (!F.positions && F.ticker) F = { ...F, positions: [{ ticker: F.ticker, shares: F.shares, avg: F.avg }] };
    F.positions = (F.positions || []).filter((p) => FIRE_TICKERS[p.ticker] && p.shares > 0 && p.avg > 0);
    return F.positions.length ? F : null;
  };
  let fireCfg = normFire(structuredClone(readSaved(FIRE_KEY, null)));
  let fireHist = readSaved(FIRE_HIST, []) || [];
  let fireSim = null; // 시뮬레이터 가격(주력 종목)
  let fireConfirmDelete = false;
  let fireRows = null; // 입력 폼 편집 중인 종목 목록

  // 설정 링크(#fire&shares=..&avg=..&goal=..)로 한 번에 입력 — 저장 후 주소에서 바로 지운다
  (function importFireFromHash() {
    const h = location.hash.slice(1);
    if (!h.startsWith('fire&')) return;
    const p = new URLSearchParams(h.slice(5));
    const n = (k) => { const v = parseFloat(p.get(k)); return isFinite(v) && v > 0 ? v : null; };
    if (n('shares') && n('avg')) {
      const ticker = FIRE_TICKERS[p.get('ticker') || ''] ? p.get('ticker') : 'CRCA';
      fireCfg = normFire({ positions: [{ ticker, shares: n('shares'), avg: n('avg') }], goal: n('goal') || 1.5e9, buyFx: n('fx'), afterTax: false });
      writeJSON(FIRE_KEY, fireCfg);
    }
    try { history.replaceState(null, '', location.pathname + '#fire'); } catch {}
  })();

  // ₩2억 4,712만 처럼 억·만 단위로 자세히
  const wonFull = (v) => {
    if (v == null || !isFinite(v)) return '–';
    if (EN) return (v < 0 ? '-₩' : '₩') + unit(Math.abs(v));
    const a = Math.abs(v), sg = v < 0 ? '-' : '';
    let eok = Math.floor(a / 1e8), man = Math.round((a - eok * 1e8) / 1e4);
    if (man >= 10000) { eok += 1; man -= 10000; }
    return sg + '₩' + (eok ? `${eok}억${man ? ' ' + nf(0).format(man) + '만' : ''}` : `${nf(0).format(man)}만`);
  };
  const won = (v) => (v == null || !isFinite(v) ? '–' : (v < 0 ? '-₩' : '₩') + unit(Math.abs(v)));
  const dollar = (v, dp = 0) => (v == null || !isFinite(v) ? '–' : (v < 0 ? '-$' : '$') + nf(dp).format(Math.abs(v)));
  const signed = (v, f) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '-' : '') + f(Math.abs(v)).replace(/^-/, ''));
  const mktStatus = (s) => ({ KR_OPEN: '한국 장중', KR_CLOSE: '한국 장 마감', 'Pre-Market': '장전', 'Open': '장중', 'Market Open': '장중', 'After-Hours': '장후', 'Closed': '장 마감' }[s] || s || '');

  // 해외주식 양도소득세: 연 250만원 공제 후 22%(지방세 포함) — 이익일 때만
  const taxOf = (gainKrw) => Math.max(0, gainKrw - 2.5e6) * 0.22;

  // overrides: { 티커: 가격 } — 시뮬레이터·24시간 추정에 쓴다
  function fireCalc(overrides = {}) {
    const F = fireCfg, Q = state.quote;
    if (!F || !Q?.fx?.rate) return null;
    const fx = Q.fx.rate;
    const rows = [];
    for (const p of F.positions) {
      const kr = krTk(p.ticker), q = kr ? state.krq?.[p.ticker] : Q[p.ticker];
      const price = overrides[p.ticker] ?? q?.price;
      if (price == null) return null;
      const f = kr ? 1 / fx : 1; // 한국 종목: 가격·평단이 원
      rows.push({ ...p, q, kr, px: price, valueUsd: p.shares * price * f, costUsd: p.shares * p.avg * f, todayUsd: q?.prevClose != null ? p.shares * (price - q.prevClose) * f : 0 });
    }
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const valueUsd = sum('valueUsd'), costUsd = sum('costUsd');
    const costOf = (r) => (r.kr ? r.shares * r.avg : r.costUsd * (F.buyFx || fx));
    const valueKrw = valueUsd * fx, costKrw = rows.reduce((s, r) => s + costOf(r), 0);
    const gainUsd = valueUsd - costUsd, gainKrw = valueKrw - costKrw;
    // 해외주식 양도세는 미국 종목 이익에만(국내 상장주식 소액주주는 비과세)
    const usGainKrw = rows.filter((r) => !r.kr).reduce((s, r) => s + r.valueUsd * fx - costOf(r), 0);
    const tax = taxOf(usGainKrw), netKrw = valueKrw - tax;
    const basis = F.afterTax ? netKrw : valueKrw;
    // 목표 금액이 되려면 필요한 원화 평가금액 (세후면 세금을 감안해 역산)
    const needValueKrw = F.afterTax ? Math.max(F.goal, (F.goal - 0.22 * (costKrw + 2.5e6)) / 0.78) : F.goal;
    // 주력 종목(평가금액이 가장 큰 종목)만 오른다고 볼 때의 목표가
    const main = rows.slice().sort((a, b) => b.valueUsd - a.valueUsd)[0];
    const needPx = ((needValueKrw / fx - (valueUsd - main.valueUsd)) / main.shares) * (main.kr ? fx : 1); // 주력 종목 통화로
    return {
      F, rows, main, q: main.q, px: main.px, fx, valueUsd, valueKrw, costUsd, costKrw, gainUsd, gainKrw, gainPct: gainUsd / costUsd,
      tax, netKrw, basis, progress: basis / F.goal, remainKrw: F.goal - basis, needPx, needPct: needPx / main.px - 1,
      needAll: needValueKrw / valueKrw - 1, todayKrw: sum('todayUsd') * fx,
    };
  }

  // 주말·야간: 24시간 거래되는 바이낸스 CRCL로 CRCA·CRCL 추정 (CRCA는 하루 수익률 2배 가정). JOBY는 현재가 그대로.
  function fireEstimate() {
    const Q = state.quote, b = px.t?.last;
    if (!Q?.CRCL || !b || !fireCfg?.positions.some((p) => p.ticker === 'CRCA' || p.ticker === 'CRCL')) return null;
    const crclClose = Q.CRCL.regularClose ?? Q.CRCL.prevClose, crcaClose = Q.CRCA?.regularClose ?? Q.CRCA?.prevClose;
    if (!crclClose) return null;
    const r = b / crclClose - 1;
    return { crcl: b, move: r, prices: { CRCL: b, ...(crcaClose ? { CRCA: crcaClose * (1 + 2 * r) } : {}) } };
  }

  function recordFireHistory(c) {
    if (!c) return;
    if (DEMO && fireHist.length < 2) {
      fireHist = Array.from({ length: 60 }, (_, i) => { const p = c.progress * (0.82 + 0.18 * (i / 59)) * (1 + 0.025 * Math.sin(i / 4)); return { d: addDays(isoToday(), i - 59), p: +p.toFixed(5), v: Math.round(p * c.F.goal) }; });
      return;
    }
    const d = new Date(), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const row = { d: key, p: +c.progress.toFixed(5), v: Math.round(c.basis) };
    if (fireHist.at(-1)?.d === key) fireHist[fireHist.length - 1] = row; else fireHist.push(row);
    fireHist = fireHist.slice(-400);
    writeJSON(FIRE_HIST, fireHist);
  }

  // 헤더의 🔥 버튼: 보유 정보가 있는 기기에서만 진행률을 보여준다
  // 홈 상단 '퇴사까지 · 배당금' 두 칸(값만 바꾼다)
  function renderHomeFire() {
    if (!document.getElementById('home-fire')) return;
    const fc = fireCfg ? fireCalc() : null;
    document.querySelector('.hf-fire')?.classList.toggle('hf-empty', !fireCfg);
    document.querySelector('.hf-div')?.classList.toggle('hf-empty', !divCfg);
    setText('hf-fire-v', fc ? `${(Math.max(0, fc.progress) * 100).toFixed(1)}%` : fireCfg ? '…' : (EN ? '+ Set up' : '+ 입력하기'));
    setText('hf-fire-s', fc ? `${EN ? 'Goal' : '목표'} ${wonFull(fc.F.goal)} · ${EN ? 'left' : '남은'} ${(Math.max(0, 1 - fc.progress) * 100).toFixed(1)}%` : (EN ? 'Enter holdings to calculate' : '보유 정보를 넣으면 계산돼요'));
    const dc = divCfg ? divCalc() : null;
    const ready = dc && !dc.missing.length;
    const dv = document.getElementById('hf-div-v');
    const dHtml = dc ? (ready ? `${usd2(dc.monthly)}<small>${EN ? '/mo' : '/월'}</small>` : '…') : (EN ? '+ Set up' : '+ 입력하기');
    if (dv && dv.innerHTML !== dHtml) dv.innerHTML = dHtml;
    // 세금: 올해 실현 손익을 넣었으면 예상 양도세, 아니면 절세 계좌 마감까지
    try {
      const has = manIn(taxCfg.amt) > 0, T = has ? taxCalc() : null, A = acctCalc();
      setText('hf-tax-v', has ? (T.tax > 0 ? wonFull(T.tax) : (EN ? 'No tax' : '세금 없음')) : (EN ? 'Calculate' : '계산하기'));
      setText('hf-tax-s', has ? (T.tax > 0 ? (EN ? 'Est. capital gains tax' : '예상 양도세') : `${EN ? 'Tax-free room' : '공제 남음'} ${wonFull(T.room)}`) : A.dd >= 0 ? `${EN ? 'Gains tax · accounts' : '양도세·절세 계좌'} D-${A.dd}` : (EN ? 'Gains tax · accounts' : '양도세·절세 계좌'));
      document.querySelector('.hf-tax')?.classList.toggle('hf-empty', !has);
    } catch {}
    setText('hf-div-s', dc ? (ready ? `${EN ? 'Got' : '받은'} ${usd2(dc.recvNet)} · ${EN ? 'back' : '회수'} ${(dc.payback * 100).toFixed(1)}%` : (EN ? 'Loading dividends…' : '배당 내역 불러오는 중…')) : (EN ? 'Enter dividend stocks to calculate' : '배당 종목을 넣으면 계산돼요'));
    try { renderSince(fc); } catch (e) { console.error(e); }
    try { renderWelcome(); } catch (e) { console.error(e); }
    try { checkMilestone(fc); } catch (e) { console.error(e); }
  }


  // ---------------------------------------------------------------- 💸 시장 자금 동향(국내 증시): 빚투(신용융자) · 대기 자금(고객예탁금) · 투자자별 매매 → 과열 신호
  // 자료: 네이버 증권(금융투자협회 집계, 하루 늦게 나옴) · 서버 1시간 캐시 · 이 기기에도 저장해 두고 바로 그린다
  const FLOW_CACHE = 'cw.flowCache';
  state.flow = readJSON(FLOW_CACHE, null);
  let flowLoading = null, flowMemo = null;
  function loadFlow(force) {
    if (flowLoading) return flowLoading;
    if (!force && state.flow?.rows?.length && Date.now() - Date.parse(state.flow.got || 0) < 30 * 60000) return Promise.resolve(state.flow);
    flowLoading = getJ(`${NEWS_API}/flow`, 15000)
      .then((j) => { if (j?.rows?.length) { state.flow = { ...j, got: new Date().toISOString() }; writeJSON(FLOW_CACHE, state.flow); } return state.flow; })
      .finally(() => { flowLoading = null; });
    return flowLoading;
  }
  const jo = (v) => (v == null || !isFinite(v) ? '–' : Math.abs(v) >= 10000 ? `${(v / 1e4).toFixed(1)}${EN ? 'T' : '조'}` : `${nf(0).format(v)}${EN ? '00M' : '억'}`); // 억원 → 조
  const joS = (v) => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '-' : '') + jo(Math.abs(v)));
  function flowCalc(F = state.flow) {
    if (!F?.rows?.length) return null;
    if (flowMemo?.at === F.at) return flowMemo.v;
    const R = F.rows, n = R.length, L = R[n - 1];
    const back = (k) => R[Math.max(0, n - 1 - k)];
    const rank = (arr, v) => arr.filter((x) => x <= v).length / arr.length;
    const cr = R.map((r) => r[2]), ratio = R.map((r) => r[2] / r[1]);
    const crMax = R.reduce((m, r) => (r[2] > m[2] ? r : m), R[0]);
    const c = {
      date: L[0], dep: L[1], cr: L[2], ratio: L[2] / L[1],
      cr20: L[2] / back(20)[2] - 1, cr60: L[2] / back(60)[2] - 1, cr250: L[2] / back(250)[2] - 1,
      dep60: L[1] / back(60)[1] - 1, dep250: L[1] / back(250)[1] - 1,
      crPct: rank(cr, L[2]), ratioPct: rank(ratio, L[2] / L[1]), crMax, fromMax: L[2] / crMax[2] - 1,
      ratioAvg: ratio.reduce((a, b) => a + b, 0) / ratio.length, years: Math.max(1, Math.round(n / 245)),
    };
    // 점수: 빚투 규모(5년 중 위치) · 늘어나는 속도 · 예탁금 대비 비율 · 대기 자금 감소
    let sc = 0; const why = [];
    const top = (p) => Math.max(1, Math.round((1 - p) * 100));
    if (c.crPct >= 0.9) { sc += 2; why.push(EN ? `Margin loans are near a ${c.years}-year high (top ${top(c.crPct)}%)` : `빚내서 산 주식(신용융자)이 최근 ${c.years}년 중 상위 ${top(c.crPct)}% 수준이에요`); }
    else if (c.crPct >= 0.75) { sc += 1; why.push(EN ? `Margin loans are on the high side (top ${top(c.crPct)}%)` : `신용융자가 최근 ${c.years}년 중 높은 편이에요(상위 ${top(c.crPct)}%)`); }
    if (c.cr60 >= 0.1) { sc += 2; why.push(EN ? `Margin loans grew ${pct(c.cr60, 1)} in 3 months — fast` : `최근 3개월 동안 신용융자가 ${pctPlain(c.cr60, 1)} 늘었어요(빠른 증가)`); }
    else if (c.cr60 >= 0.05) { sc += 1; why.push(EN ? `Margin loans grew ${pct(c.cr60, 1)} in 3 months` : `최근 3개월 동안 신용융자가 ${pctPlain(c.cr60, 1)} 늘었어요`); }
    if (c.cr250 >= 0.3) { sc += 2; why.push(EN ? `Margin loans are up ${pct(c.cr250, 0)} from a year ago` : `1년 전보다 신용융자가 ${pctPlain(c.cr250, 0)} 늘었어요(빚투가 빠르게 쌓임)`); }
    else if (c.cr250 >= 0.15) { sc += 1; why.push(EN ? `Margin loans are up ${pct(c.cr250, 0)} from a year ago` : `1년 전보다 신용융자가 ${pctPlain(c.cr250, 0)} 늘었어요`); }
    if (c.fromMax <= -0.08 && c.crPct >= 0.75) why.push(EN ? `Still ${pct(c.fromMax, 0)} below the ${c.crMax[0].slice(0, 7)} peak, but high` : `${+c.crMax[0].slice(5, 7)}월 최고치(${jo(c.crMax[2])})보다는 ${pctPlain(-c.fromMax, 0)} 줄었지만 여전히 높아요`);
    if (c.ratioPct >= 0.9) { sc += 2; why.push(EN ? `Debt relative to cash waiting to invest is in the top ${top(c.ratioPct)}%` : `대기 자금 대비 빚 비율이 ${c.years}년 중 상위 ${top(c.ratioPct)}%예요`); }
    else if (c.ratioPct >= 0.75) { sc += 1; why.push(EN ? 'Debt-to-cash ratio is on the high side' : '대기 자금 대비 빚 비율이 높은 편이에요'); }
    if (c.dep60 <= -0.05) { sc += 1; why.push(EN ? `Cash waiting to invest fell ${pctPlain(-c.dep60, 1)} in 3 months` : `주식 사려고 넣어 둔 돈(예탁금)은 3개월 새 ${pctPlain(-c.dep60, 1)} 줄었어요`); }
    else if (c.dep60 >= 0.05) why.push(EN ? `Cash waiting to invest rose ${pct(c.dep60, 1)} — fuel for buying` : `주식 사려고 넣어 둔 돈(예탁금)이 3개월 새 ${pctPlain(c.dep60, 1)} 늘었어요(살 여력 ↑)`);
    const lv = sc >= 5 ? { k: 'hot', e: '🔴', t: EN ? 'Overheated — looks risky' : '과열 · 위험위험해 보여요', d: EN ? 'A lot of borrowed money is in the market. If prices drop sharply, forced selling can make the fall worse.' : '빚내서 투자한 돈이 많이 쌓였어요. 주가가 크게 빠지면 반대매매(강제 매도)로 하락이 더 커질 수 있어요.' }
      : sc >= 3 ? { k: 'warn', e: '🟠', t: EN ? 'Caution — leverage is building' : '주의 · 빚투가 꽤 늘었어요', d: EN ? 'Borrowed money is rising. Be careful about chasing prices.' : '빚내서 사는 사람이 늘고 있어요. 무리한 추격 매수는 조심할 때예요.' }
      : sc >= 1 ? { k: 'mid', e: '🟡', t: EN ? 'Normal — a little warm' : '보통 · 조금 뜨거운 편', d: EN ? 'No strong overheating signal yet.' : '아직 뚜렷한 과열 신호는 크지 않아요.' }
      : { k: 'calm', e: '🟢', t: EN ? 'Calm — little leverage' : '안정 · 빚투가 적어요', d: EN ? 'Not much borrowed money in the market.' : '빚내서 투자하는 돈이 많지 않아요.' };
    if (c.cr60 <= -0.1) why.push(EN ? 'Margin loans dropped fast — often after forced selling (a fear phase)' : '신용융자가 빠르게 줄었어요 — 반대매매·청산이 나온 뒤일 수 있어요(공포 구간)');
    const v = { ...c, sc, why, lv };
    flowMemo = { at: F.at, v };
    return v;
  }
  const invLine = (I, name) => (I ? `<span class="fl-inv-k">${name}</span>${[['p', EN ? 'Retail' : '개인'], ['f', EN ? 'Foreign' : '외국인'], ['i', EN ? 'Institutions' : '기관']].map(([k, l]) => `<span>${l} <b class="${cls(I[k])}">${joS(I[k])}</b></span>`).join('')}` : '');
  function renderFlowCard() {
    const el = document.getElementById('c-flow');
    if (!el) return;
    const F = state.flow, c = flowCalc(F);
    if (!c) { card('flow', { title: EN ? '💸 Market money flow' : '💸 시장 자금 동향', body: `<p class="skeleton">${EN ? 'Loading…' : '불러오는 중…'}</p>` }); return; }
    const I = F.inv?.KOSPI;
    card('flow', {
      title: EN ? '💸 Market money flow' : '💸 시장 자금 동향', sub: EN ? `Korean stocks · borrowed money & cash on the sidelines · ${c.date.slice(5).replace('-', '/')}` : `국내 증시 · 빚투와 대기 자금으로 본 분위기 · ${+c.date.slice(5, 7)}/${+c.date.slice(8)} 기준`,
      easy: EN ? 'Shows how much people borrow to buy stocks and how much cash is waiting to invest. When borrowing piles up fast, the market tends to be overheated.' : '사람들이 빚을 내서 주식을 얼마나 샀는지, 주식 사려고 넣어 둔 돈이 얼마인지 보여줘요. 빚투가 빠르게 쌓이면 시장이 과열됐다는 신호로 봐요.',
      body: `<div class="fl-verdict lv-${c.lv.k}"><span class="fl-e" aria-hidden="true">${c.lv.e}</span><div><b>${c.lv.t}</b><small>${esc(c.why[0] || c.lv.d)}</small></div></div>
        <div class="fl-grid">
          <div><span>${EN ? 'Margin loans' : '신용융자(빚투)'}</span><b>${jo(c.cr)}</b><small>${EN ? '3 mo' : '3개월'} <em class="${cls(c.cr60)}">${pct(c.cr60, 1)}</em></small></div>
          <div><span>${EN ? 'Cash waiting' : '고객예탁금'}</span><b>${jo(c.dep)}</b><small>${EN ? '3 mo' : '3개월'} <em class="${cls(c.dep60)}">${pct(c.dep60, 1)}</em></small></div>
          <div><span>${EN ? 'Debt ÷ cash' : '빚투 비율'}</span><b>${(c.ratio * 100).toFixed(1)}%</b><small>${EN ? 'avg' : '평균'} ${(c.ratioAvg * 100).toFixed(0)}%</small></div>
        </div>
        ${I ? `<p class="fl-inv">${EN ? 'Today' : '오늘'} ${invLine(I, EN ? 'KOSPI' : '코스피')}</p>` : ''}
        ${(() => { const US = usMarginStat(); if (!US) { loadUsMargin()?.then(renderFlowCard); return ''; } return `<p class="fl-inv"><span class="fl-inv-k">💳 ${EN ? 'US margin debt' : '미국 신용잔고'}</span><span><b>${usT(US.L[1])}</b> · ${US.L[0].replace('-', '.')}</span><span class="${US.ath ? 'up' : ''}">${US.ath ? (EN ? 'record high' : '사상 최고') : `${EN ? 'vs record' : '최고 대비'} ${pct(US.L[1] / US.prevMax[1] - 1, 0)}`}</span></p>`; })()}
        <button type="button" class="link-btn" data-go="flow">${EN ? 'What it means · charts' : '무슨 뜻인지 · 차트 자세히 보기'}${chevron}</button>`,
    });
  }
  const FLOW_RANGES = { '1y': [245, EN ? '1Y' : '1년'], '3y': [735, EN ? '3Y' : '3년'], all: [99999, EN ? '5Y' : '5년'] };
  function flowChart(id, R, ds, yfmt, tip) {
    const labels = R.map((r) => Date.parse(r[0] + 'T12:00:00') / 1000);
    const yr = (t) => { const d = new Date(t * 1000); return R.length > 300 ? `'${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}` : `${d.getMonth() + 1}/${d.getDate()}`; };
    draw(id, {
      type: 'line', data: { labels, datasets: ds },
      options: { interaction, plugins: { legend: { display: ds.length > 1, labels: { boxWidth: 10, boxHeight: 2, font: { size: 11 } } }, tooltip: tooltip((it) => R[it.dataIndex][0], tip) }, scales: { x: axisX(labels, yr, 5), y: axisY(yfmt) } },
    });
  }
  function renderFlowView() {
    if (!document.getElementById('c-flowsum')) return;
    const F = state.flow, c = flowCalc(F);
    if (!c) { card('flowsum', { title: EN ? 'Market money flow' : '시장 자금 동향', body: `<p class="skeleton">${EN ? 'Loading…' : '불러오는 중…'}</p>` }); return; }
    const rg = FLOW_RANGES[state.flowRange] ? state.flowRange : '3y', R = F.rows.slice(-FLOW_RANGES[rg][0]);
    const rgBtns = `<div class="seg range fl-rg" role="group">${Object.entries(FLOW_RANGES).map(([k, [, l]]) => `<button type="button" data-flowrange="${k}" aria-pressed="${k === rg}">${l}</button>`).join('')}</div>`;
    const ma = (arr, k) => arr.map((_, i) => (i < k - 1 ? null : arr.slice(i - k + 1, i + 1).reduce((a, b) => a + b, 0) / k));
    const all = F.rows, crAll = all.map((r) => r[2]), ma60 = ma(crAll, 60).slice(-R.length);
    card('flowsum', {
      title: EN ? '💸 Market money flow — the verdict' : '💸 지금 시장 분위기', sub: EN ? `Korean stocks · as of ${c.date} · KOFIA data via Naver` : `국내 증시 · ${c.date} 기준 · 금융투자협회 자료(네이버 증권)`,
      body: `<div class="fl-verdict big lv-${c.lv.k}"><span class="fl-e" aria-hidden="true">${c.lv.e}</span><div><b>${c.lv.t}</b><small>${c.lv.d}</small></div></div>
        <div class="fl-meter" aria-label="${EN ? 'Heat score' : '과열 점수'} ${c.sc}"><i style="left:${{ calm: 12.5, mid: 37.5, warn: 62.5, hot: 87.5 }[c.lv.k] + Math.min(10, Math.max(-10, ((c.sc % 2) - 0.5) * 8))}%"></i><span>${EN ? 'Calm' : '안정'}</span><span>${EN ? 'Normal' : '보통'}</span><span>${EN ? 'Caution' : '주의'}</span><span>${EN ? 'Hot' : '과열'}</span></div>
        <ul class="fl-why">${c.why.map((w) => `<li>${esc(w)}</li>`).join('') || `<li>${EN ? 'No notable signals.' : '눈에 띄는 신호가 없어요.'}</li>`}</ul>
        <p class="note">${EN ? 'Scored from margin-loan size (vs the last 5 years), how fast it grew over 3 and 12 months, debt vs cash on the sidelines, and cash outflows. One indicator can’t time tops or bottoms — not investment advice.' : '신용융자 규모(최근 5년과 비교)·3개월과 1년 증가 속도·예탁금 대비 빚 비율·대기 자금 감소를 점수로 매겼어요. 지표 하나로 고점·저점을 맞힐 수는 없어요. 투자 조언이 아니에요.'}</p>`,
    });
    card('flowcr', {
      title: EN ? '🏦 Margin loans (buying on credit)' : '🏦 신용융자 잔고 — 빚내서 산 주식', sub: `${jo(c.cr)} · ${EN ? '1Y' : '1년'} ${pct(c.cr250, 1)} · ${EN ? 'peak' : '최고'} ${jo(c.crMax[2])} (${c.crMax[0].slice(2).replace(/-/g, '.')})`,
      body: `${rgBtns}<div class="chart"><canvas id="cv-flowcr" role="img" aria-label="${EN ? 'Margin loan balance' : '신용융자 잔고'}"></canvas></div>
        <div class="fl-explain"><b>💡 ${EN ? 'What is it?' : '이게 뭐예요?'}</b><p>${EN ? 'Money investors borrowed from brokers to buy stocks. Rising = more people betting on gains with debt. When it rises too fast the market is often overheated, and when prices fall, brokers force-sell (margin calls), which can deepen the drop.' : '증권사에서 돈을 빌려 주식을 산 금액이에요(빚투). 늘어나면 빚을 내서라도 오를 거라고 베팅하는 사람이 많다는 뜻이에요. 너무 빨리 늘면 과열 신호이고, 주가가 크게 빠지면 담보가 부족해져 증권사가 강제로 파는 <b>반대매매</b>가 나와 하락이 더 커질 수 있어요.'}</p>
        <p class="fl-how">${EN ? 'Dashed line = 60-day average. Above it and rising fast = heating up.' : '점선은 60일 평균이에요. 평균선 위에서 가파르게 오르면 과열, 갑자기 꺾이면 반대매매·청산 구간인 경우가 많아요.'}</p></div>`,
    });
    flowChart('flowcr', R, [lineDs(EN ? 'Margin loans' : '신용융자', R.map((r) => r[2]), C.red || '#f04452', { borderWidth: 2 }), lineDs(EN ? '60-day avg' : '60일 평균', ma60, C.muted, { borderWidth: 1.5, borderDash: [5, 4] })], (v) => jo(v), (v) => jo(v));
    card('flowdep', {
      title: EN ? '💵 Investor deposits (cash on the sidelines)' : '💵 고객예탁금 — 주식 사려고 넣어 둔 돈', sub: `${jo(c.dep)} · ${EN ? '3 mo' : '3개월'} ${pct(c.dep60, 1)} · ${EN ? '1Y' : '1년'} ${pct(c.dep250, 1)}`,
      body: `<div class="chart"><canvas id="cv-flowdep" role="img" aria-label="${EN ? 'Investor deposits' : '고객예탁금'}"></canvas></div>
        <div class="fl-explain"><b>💡 ${EN ? 'What is it?' : '이게 뭐예요?'}</b><p>${EN ? 'Cash sitting in brokerage accounts, ready to buy stocks. Rising = more buying power (fuel for the market). Falling = money leaving the market.' : '증권 계좌에 넣어 두고 아직 주식을 사지 않은 현금이에요. 늘면 주식을 살 여력(시장의 연료)이 많아진다는 뜻이고, 줄면 돈이 증시에서 빠져나가고 있다는 뜻이에요.'}</p></div>`,
    });
    flowChart('flowdep', R, [lineDs(EN ? 'Deposits' : '고객예탁금', R.map((r) => r[1]), C.teal || '#3fbf7f', { fill: 'start', backgroundColor: areaFill(C.teal || '#3fbf7f') })], (v) => jo(v), (v) => jo(v));
    card('flowratio', {
      title: EN ? '⚖️ Debt ÷ cash ratio' : '⚖️ 빚투 비율 — 대기 자금 대비 빚', sub: `${(c.ratio * 100).toFixed(1)}% · ${EN ? `${c.years}-yr avg` : `${c.years}년 평균`} ${(c.ratioAvg * 100).toFixed(1)}%`,
      body: `<div class="chart"><canvas id="cv-flowratio" role="img" aria-label="${EN ? 'Debt to cash ratio' : '빚투 비율'}"></canvas></div>
        <div class="fl-explain"><b>💡 ${EN ? 'How to read' : '어떻게 봐요?'}</b><p>${EN ? 'Margin loans divided by investor deposits. High = the market leans on borrowed money more than on spare cash, so it is more fragile.' : '신용융자 ÷ 고객예탁금이에요. 높을수록 여윳돈보다 빚에 기대 오르는 장이라 작은 충격에도 흔들리기 쉬워요. 평균선(점선)보다 한참 위면 조심할 때예요.'}</p></div>`,
    });
    const ratioR = R.map((r) => (r[2] / r[1]) * 100);
    flowChart('flowratio', R, [lineDs(EN ? 'Ratio' : '빚투 비율', ratioR, C.orange, { borderWidth: 2 }), lineDs(EN ? 'Average' : '평균', R.map(() => c.ratioAvg * 100), C.muted, { borderWidth: 1.2, borderDash: [5, 4] })], (v) => v.toFixed(0) + '%', (v) => (+v).toFixed(1) + '%');
    const IK = F.inv?.KOSPI, IQ = F.inv?.KOSDAQ;
    const US = usMarginStat();
    if (!US) loadUsMargin()?.then(() => { if (state.view === 'flow') renderFlowView(); renderFlowCard(); });
    if (US) {
      const UR = US.U.filter((x) => x[0] >= '2015-01');
      card('flowus', {
        title: EN ? '💳 US margin debt (FINRA)' : '💳 미국 신용잔고 — 미국판 빚투', sub: `${usT(US.L[1])} · ${US.L[0].replace('-', '.')} · ${US.ath ? (EN ? 'record high' : '사상 최고') : `${EN ? 'vs record' : '최고 대비'} ${pct(US.L[1] / US.prevMax[1] - 1, 0)}`}${US.yoy != null ? ` · ${EN ? '1Y' : '1년'} ${pct(US.yoy, 0)}` : ''}`,
        body: `<div class="chart"><canvas id="cv-flowus" role="img" aria-label="${EN ? 'US margin debt' : '미국 신용잔고'}"></canvas></div>
          <div class="fl-explain"><b>💡 ${EN ? 'What is it?' : '이게 뭐예요?'}</b><p>${EN ? 'Money US investors borrowed from brokers (FINRA, monthly, about 3 weeks late). Past record highs in 2000, 2007 and 2021 were followed by corrections — a classic overheating gauge.' : '미국 투자자들이 증권사에서 빌린 돈의 합계예요(FINRA, 매달 약 3주 늦게 발표). 2000년·2007년·2021년처럼 사상 최고치를 크게 넘어선 뒤 조정이 온 적이 많아서 대표적인 과열 지표로 봐요.'}${US.vs21 != null ? (EN ? ` Now ${pct(US.vs21, 0)} vs the 2021 peak.` : ` 지금은 2021년 고점보다 ${pct(US.vs21, 0)} 수준이에요.`) : ''}</p></div>`,
      });
      const labels = UR.map((x) => Date.parse(x[0] + '-15T12:00:00Z') / 1000);
      draw('flowus', { type: 'line', data: { labels, datasets: [lineDs(EN ? 'Margin debt' : '신용잔고', UR.map((x) => x[1]), C.orange, { fill: 'start', backgroundColor: areaFill(C.orange) })] },
        options: { interaction, plugins: { ...noLegend, tooltip: tooltip((it) => UR[it.dataIndex][0].replace('-', '.'), (v) => usT(v)) }, scales: { x: axisX(labels, (t) => `'${String(new Date(t * 1000).getUTCFullYear()).slice(2)}`, 6), y: axisY((v) => (EN ? `$${(v / 1e6).toFixed(1)}T` : `${(v / 1e6).toFixed(1)}조$`)) } } });
    }
    card('flowinv', {
      title: EN ? '👥 Who bought today' : '👥 오늘 누가 샀을까 — 투자자별 순매수', sub: IK ? `${IK.d.slice(4, 6)}/${IK.d.slice(6)} · ${EN ? 'KRW, net buy' : '순매수 금액'}` : '',
      body: `${IK || IQ ? `<div class="fl-invs">${IK ? `<p>${invLine(IK, EN ? 'KOSPI' : '코스피')}</p>` : ''}${IQ ? `<p>${invLine(IQ, EN ? 'KOSDAQ' : '코스닥')}</p>` : ''}</div>` : `<p class="note">${EN ? 'No data yet today.' : '아직 오늘 자료가 없어요.'}</p>`}
        <div class="fl-explain"><b>💡 ${EN ? 'How to read' : '어떻게 봐요?'}</b><p>${EN ? 'Net buying (+) means that group bought more than it sold. When retail buys heavily while foreigners and institutions sell — especially with rising margin loans — the market is often running on retail leverage.' : '+는 판 것보다 산 게 많다는 뜻(순매수)이에요. 외국인·기관이 팔 때 개인만 크게 사고, 신용융자까지 늘고 있다면 개인의 빚투로 버티는 장일 수 있어요.'}</p></div>`,
    });
    card('flowguide', {
      title: EN ? '📚 More money-flow terms' : '📚 함께 알아 두면 좋은 자금 지표',
      body: `<dl class="fl-dl">
        <dt>${EN ? 'Unsettled receivables (미수금)' : '위탁매매 미수금'}</dt><dd>${EN ? 'Stocks bought without paying in full (due in 2 days). If unpaid, the broker sells them — another source of forced selling.' : '돈을 다 내지 않고 산 주식 대금이에요(2일 안에 갚아야 해요). 못 갚으면 증권사가 바로 팔아 버려서(반대매매) 하락장에 매물이 쏟아질 수 있어요.'}</dd>
        <dt>${EN ? 'Forced selling (반대매매)' : '반대매매'}</dt><dd>${EN ? 'When collateral falls below the required level, brokers sell your stock at market price. Spikes usually show up after sharp drops.' : '빌린 돈의 담보(주식) 가치가 기준 아래로 떨어지면 증권사가 시장가로 강제로 파는 거예요. 급락 직후에 크게 늘어요.'}</dd>
        <dt>${EN ? 'Futures margin deposits (선물예수금)' : '선물·옵션 예수금'}</dt><dd>${EN ? 'Cash parked for futures and options trading — a rough gauge of short-term speculative appetite.' : '선물·옵션을 하려고 넣어 둔 돈이에요. 단기 투기 심리를 대략 보여줘요.'}</dd>
        <dt>${EN ? 'Fear & Greed' : '공포·탐욕 지수'}</dt><dd>${EN ? 'US market sentiment on the Home screen. Read it together with this page.' : '홈 화면의 미국 증시 심리 지표예요. 이 화면과 같이 보면 분위기를 더 정확히 알 수 있어요.'}</dd>
      </dl><p class="note">${EN ? 'Source: Korea Financial Investment Association data via Naver Securities (published with a one-day lag). Not investment advice.' : '자료: 금융투자협회 집계(네이버 증권), 하루 늦게 발표돼요. 투자 조언이 아니에요.'}</p>`,
    });
  }


  // ---------------------------------------------------------------- 🥧 내 포트폴리오 비중 · 환율 효과(퇴사까지 화면)
  // 종목별 평가금액 비중 도넛 + 한 종목 쏠림 경고. 미국 종목 손익을 '주가로 번 돈'과 '환율로 번 돈'으로 나눈다(평균 매수 환율이 있을 때)
  const MIX_COLORS = ['#f2994a', '#5b8def', '#3fbf7f', '#c86bf2', '#f5c542', '#f04452', '#3ec6d6', '#9aa4b2'];
  function renderFireMix(c) {
    const el = document.getElementById('c-firemix');
    if (!el) return;
    if (!c || c.rows.length < 1) { el.hidden = true; return; }
    el.hidden = false;
    const fx = c.fx, rows = c.rows.map((r) => ({ t: r.ticker, kr: r.kr, krw: r.valueUsd * fx })).sort((a, b) => b.krw - a.krw), tot = rows.reduce((a, r) => a + r.krw, 0) || 1;
    const top = rows[0], topShare = top.krw / tot;
    const us = c.rows.filter((r) => !r.kr), bfx = c.F.buyFx;
    const stockFx = bfx ? us.reduce((a, r) => a + r.shares * (r.px - r.avg) * bfx, 0) : null, fxFx = bfx ? us.reduce((a, r) => a + r.shares * r.px * (fx - bfx), 0) : null;
    const name = (t) => (krTk(t) ? fireName(t) : t);
    card('firemix', {
      title: EN ? '🥧 Portfolio mix · FX effect' : '🥧 내 포트폴리오 비중 · 환율 효과', sub: EN ? `${rows.length} holdings · by current value (KRW)` : `${rows.length}종목 · 지금 평가금액(원화) 기준`,
      easy: EN ? 'Shows how much of your money sits in each stock, and splits your US-stock gain into what came from the stock price and what came from the exchange rate.' : '내 돈이 종목별로 얼마씩 들어 있는지, 그리고 미국 주식에서 번(잃은) 돈이 주가 때문인지 환율 때문인지 나눠서 보여줘요.',
      body: `<div class="mx-wrap"><div class="chart mx-chart"><canvas id="cv-firemix" role="img" aria-label="${EN ? 'Holdings mix' : '종목 비중'}"></canvas></div>
        <ul class="mx-list">${rows.map((r, i) => `<li><i style="background:${MIX_COLORS[i % MIX_COLORS.length]}"></i><b>${esc(name(r.t))}</b><span>${pctPlain(r.krw / tot, 0)}</span><small>${wonFull(r.krw)}</small></li>`).join('')}</ul></div>
        ${topShare >= 0.5 && rows.length > 1 ? `<p class="mx-warn">⚠ ${EN ? `${esc(name(top.t))} is ${pctPlain(topShare, 0)} of your portfolio — if it falls 30%, your total drops about ${pctPlain(topShare * 0.3, 0)}.` : `${esc(name(top.t))} 비중이 ${pctPlain(topShare, 0)}예요. 이 종목이 30% 빠지면 전체가 약 ${pctPlain(topShare * 0.3, 0)} 빠져요.`}</p>` : ''}
        ${us.length ? (bfx ? `<div class="mx-fx"><div><span>${EN ? 'From stock prices' : '주가로 번 돈'}</span><b class="${cls(stockFx)}">${signed(stockFx, wonFull)}</b><small>${EN ? 'at your average buy FX' : '평균 매수 환율 기준'}</small></div><div><span>${EN ? 'From the exchange rate' : '환율로 번 돈'}</span><b class="${cls(fxFx)}">${signed(fxFx, wonFull)}</b><small>${EN ? `₩${nf(0).format(bfx)} → ₩${nf(0).format(fx)}` : `${nf(0).format(bfx)}원 → ${nf(0).format(fx)}원`}</small></div></div>`
          : `<p class="note">💱 ${EN ? 'Enter your average buy exchange rate in the holdings form below to split gains into stock vs. FX.' : '아래 보유 정보에 <b>평균 매수 환율</b>을 넣으면 미국 주식 손익을 \'주가로 번 돈\'과 \'환율로 번 돈\'으로 나눠 보여드려요.'}</p>`) : ''}`,
    });
    draw('firemix', { type: 'doughnut', data: { labels: rows.map((r) => name(r.t)), datasets: [{ data: rows.map((r) => r.krw), backgroundColor: rows.map((_, i) => MIX_COLORS[i % MIX_COLORS.length]), borderWidth: 0 }] },
      options: { cutout: '62%', plugins: { ...noLegend, tooltip: { callbacks: { label: (it) => ` ${it.label}: ${pctPlain(it.raw / tot, 1)} · ${wonFull(it.raw)}` } } } } });
  }

  // ---------------------------------------------------------------- 🧾 해외주식 양도세 절세 계산기(Fire · 네 번째 탭)
  // 올해 판 종목의 이익·손실(직접 입력) + 퇴사까지 보유 종목의 평가손익 → 예상 세금, 공제 250만원을 다 쓰는 익절, 손실 종목 매도 효과
  const TAX_KEY = 'cw.tax', TAX_DED = 2.5e6, TAX_RATE = 0.22;
  let taxCfg = Object.assign({ gain: '', loss: '' }, readJSON(TAX_KEY, {}) || {});
  if (taxCfg.pl == null) { // 예전(이익·손실 두 칸) 값 → 순손익 하나로
    const n = (parseFloat(String(taxCfg.gain).replace(/[,\s]/g, '')) || 0) - (parseFloat(String(taxCfg.loss).replace(/[,\s]/g, '')) || 0);
    taxCfg = { pl: n < 0 ? 'loss' : 'gain', amt: n ? String(Math.abs(n)) : '' };
  }
  function taxDeadline() { // 올해 매도 마감(미국 결제 T+1): 12/31이 평일이면 12/30, 아니면 그 전 마지막 평일의 하루 전 평일
    const y = new Date().getFullYear(); let d = new Date(Date.UTC(y, 11, 31));
    const back = () => { do { d = new Date(d.getTime() - 86400000); } while ([0, 6].includes(d.getUTCDay())); };
    while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() - 86400000);
    back();
    return d.toISOString().slice(0, 10);
  }
  function taxCalc() {
    const a = (parseFloat(String(taxCfg.amt ?? '').replace(/[,\s]/g, '')) || 0) * 1e4, g = taxCfg.pl === 'loss' ? 0 : a, l = taxCfg.pl === 'loss' ? a : 0;
    const real = g - l, taxable = Math.max(0, real - TAX_DED), tax = taxable * TAX_RATE, room = Math.max(0, TAX_DED - Math.max(0, real));
    const c = fireCfg ? (() => { try { return fireCalc(); } catch { return null; } })() : null;
    const pos = (c?.rows || []).filter((r) => !r.kr).map((r) => { const bfx = c.F.buyFx || c.fx, per = r.px * c.fx - r.avg * bfx; return { t: r.ticker, sh: r.shares, per, un: per * r.shares }; });
    let left = room;
    const gains = pos.filter((x) => x.un > 0).sort((a, b) => b.un - a.un).map((x) => { const n = left > 0 && x.per > 0 ? Math.min(Math.floor(x.sh), Math.floor(left / x.per)) : 0; const amt = n * x.per; left -= amt; return { ...x, n, amt }; }).filter((x) => x.n > 0);
    const losses = pos.filter((x) => x.un < 0).sort((a, b) => a.un - b.un).map((x) => ({ ...x, cut: Math.min(-x.un, taxable) * TAX_RATE }));
    return { g, l, real, taxable, tax, room, gains, losses, pos, noFx: c && !c.F.buyFx, hasFire: !!c };
  }
  function taxOutHtml() {
    const T = taxCalc(), dl = taxDeadline(), dd = daysBetween(isoToday(), dl);
    const sh = (n) => nf(n % 1 ? 2 : 0).format(n);
    return `<div class="tx-sum2">
        <div><span>${EN ? 'Net realized this year' : '올해 실현 손익'}</span><b class="${cls(T.real)}">${signed(T.real, wonFull)}</b><small>${EN ? 'gains and losses netted' : '이익·손실을 합친 금액'}</small></div>
        <div><span>${EN ? 'Estimated tax' : '예상 양도세'}</span><b>${T.tax > 0 ? wonFull(T.tax) : (EN ? 'None' : '없음')}</b><small>${EN ? `(net − ₩2.5M) × 22%` : '(손익 − 250만원) × 22%'}</small></div>
      </div>
      ${T.room > 0 ? `<div class="tx-tip ok"><b>💡 ${EN ? `You can still realize ${wonFull(T.room)} of gains tax-free this year` : `올해 ${wonFull(T.room)}까지는 이익을 실현해도 세금이 없어요`}</b>
        <p>${EN ? 'Selling a winner and buying it back raises your cost basis, so you owe less tax when you finally sell.' : '오른 종목을 이만큼 팔고 바로 다시 사면(익절 후 재매수) 평단이 올라가서, 나중에 팔 때 낼 세금이 줄어요.'}</p>
        ${T.gains.length ? `<ul>${T.gains.map((x) => `<li><b>${esc(x.t)}</b> ${sh(x.n)}${EN ? ' sh' : '주'} ${EN ? 'sell & rebuy' : '팔고 다시 사기'} → <span class="up">${EN ? 'realize' : '이익'} ${wonFull(x.amt)}</span></li>`).join('')}</ul>` : T.hasFire ? `<p class="note">${EN ? 'None of your holdings is in profit right now.' : '지금 이익 중인 보유 종목이 없어요.'}</p>` : ''}</div>` : ''}
      ${T.taxable > 0 && T.losses.length ? `<div class="tx-tip"><b>✂️ ${EN ? 'Losses can cut this year’s tax' : '손실 종목을 팔면 올해 세금이 줄어요'}</b>
        <ul>${T.losses.map((x) => `<li><b>${esc(x.t)}</b> ${EN ? 'unrealized' : '평가손실'} <span class="down">${wonFull(x.un)}</span> → ${EN ? 'tax' : '세금'} <b class="up">−${wonFull(x.cut)}</b></li>`).join('')}</ul>
        <p class="note">${EN ? 'Korea has no 30-day wash-sale rule like the US, so you can buy back right away — but check with your broker or a tax advisor.' : '국내 세법엔 미국 같은 30일 재매수 제한이 없어서 팔고 바로 다시 사도 손실로 인정돼요(증권사·세무사 확인 권장).'}</p></div>` : ''}
      ${!T.hasFire ? `<p class="note">${EN ? 'Add your holdings in Road to FIRE to see stock-by-stock suggestions.' : '퇴사까지에 보유 종목을 넣으면 종목별로 얼마나 팔면 되는지 계산해 드려요.'}</p>` : T.noFx ? `<p class="note">${EN ? 'Using today’s FX for your cost — enter your average buy FX in Road to FIRE for exact numbers.' : '매수 환율을 몰라 지금 환율로 계산했어요. 퇴사까지에 평균 매수 환율을 넣으면 더 정확해요(양도세는 매수·매도 때 환율로 계산해요).'}</p>` : ''}
      <div class="tx-dl"><b>⏰ ${EN ? 'Sell by' : '올해 매도 마감'} ${+dl.slice(5, 7)}/${+dl.slice(8)}${EN ? ' (US time)' : '(미국 시간)'}${dd >= 0 ? ` · D-${dd}` : ''}</b><small>${EN ? 'US trades settle T+1; sales settling in the new year count for next year. Confirm with your broker. File in May.' : '미국 주식은 결제일(T+1) 기준이라 이날까지 팔아야 올해 손익으로 잡혀요. 증권사 공지를 꼭 확인하세요. 신고는 다음 해 5월이고, 증권사 신고 대행을 쓰면 편해요.'}</small></div>`;
  }
  function renderTax() {
    const el = document.getElementById('c-tax');
    if (!el) return;
    card('tax', {
      title: EN ? '🧾 Overseas stock capital gains tax' : '🧾 해외주식 양도세 절세 계산기', sub: EN ? 'Korea · ₩2.5M yearly deduction · 22%' : '연 250만원 공제 · 22%(지방세 포함) · 추정',
      easy: EN ? 'Gains from selling US stocks are taxed 22% above ₩2.5M a year, netted against losses. See how much you can realize tax-free and how selling losers cuts the tax.' : '미국 주식을 팔아 번 돈은 1년에 250만원까지는 세금이 없고, 넘는 부분에 22%가 붙어요. 같은 해 손실과 합쳐서 계산해요. 올해 세금 없이 얼마나 익절할 수 있는지, 손실 종목을 팔면 세금이 얼마나 줄어드는지 보여줘요.',
      body: `<div class="tx-in2">
          <span class="tx-lb">${EN ? 'Overseas stocks realized this year (net)' : '올해 해외주식 실현 손익(합계)'}</span>
          <div class="tx-row"><div class="seg tx-pl" role="group" aria-label="${EN ? 'Gain or loss' : '수익 또는 손실'}">${[['gain', EN ? 'Gain' : '수익'], ['loss', EN ? 'Loss' : '손실']].map(([k, l]) => `<button type="button" data-taxpl="${k}" aria-pressed="${taxCfg.pl === k}">${l}</button>`).join('')}</div>
          <div class="bn-in"><input inputmode="numeric" id="tax-amt" value="${esc(String(taxCfg.amt ?? ''))}" placeholder="0" aria-label="${EN ? 'Amount' : '금액'}"><em>${EN ? '×10k ₩' : '만원'}</em></div></div>
          <small class="tx-help">${EN ? 'Your broker app shows this under “overseas capital gains” or “realized P&L”. Using several brokers? Add them up.' : '증권사 앱의 \'해외주식 양도세 계산\'·\'실현손익\' 메뉴에서 올해 합계를 보면 돼요. 증권사가 여러 곳이면 합쳐서 넣어요.'}</small>
        </div>
        <div id="tax-out">${taxOutHtml()}</div>
        <p class="note">${EN ? 'Estimate only — fees and the exact FX on trade dates change the result. Korean-listed stocks (non-major holders) aren’t taxed and are excluded. Not tax advice.' : '추정치예요. 수수료·거래일 환율에 따라 달라져요. 국내 상장주식(대주주 아님)은 양도세가 없어 뺐어요. 세무 조언이 아니에요. 입력값은 이 기기에만 저장돼요.'}</p>`,
    });
  }

  // ---------------------------------------------------------------- 🤖 실적 발표 AI 3줄 요약(발표 뒤 10일) — 서버가 종목·분기마다 한 번 만들어 둔다
  state.earnsum = {};
  function earnSumBlock(sym) {
    if (isKR(sym)) return '';
    const E = earnOf(sym), qL = (E?.quarters || []).at(-1), sL = (E?.surprises || []).find((y) => y.reported);
    const last = sL && (!qL?.reportedOn || sL.end > qL.end) ? { end: sL.end, reportedOn: sL.reported } : qL;
    if (!last?.reportedOn || daysBetween(last.reportedOn, isoToday()) > 10) return '';
    const S = state.earnsum[sym];
    if (!S || (S.pending && Date.now() - S.t > 20000) || (S.q && S.q !== last.end)) {
      state.earnsum[sym] = { ...(S || {}), t: Date.now(), loading: true };
      getJ(`${NEWS_API}/earnsum?s=${sym}`, 25000).then((j) => { state.earnsum[sym] = { ...j, t: Date.now() }; for (const el of document.querySelectorAll(`.es-box[data-es="${CSS.escape(sym)}"]`)) el.outerHTML = earnSumBlock(sym); }).catch(() => { state.earnsum[sym] = { none: true, t: Date.now() }; });
    }
    const X = state.earnsum[sym];
    if (X?.lines?.length) return `<div class="es-box" data-es="${esc(sym)}"><b>🤖 ${EN ? 'AI summary' : 'AI 3줄 요약'} · ${qLabelLong(X.q)}</b><ul>${X.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><small>${EN ? 'Written by AI from the reported numbers and news around the release — may contain mistakes.' : '실적 숫자와 발표 무렵 뉴스로 AI가 정리했어요. 틀릴 수 있어요.'}</small></div>`;
    if (X?.none) return `<div class="es-box" data-es="${esc(sym)}" hidden></div>`;
    return `<div class="es-box loading" data-es="${esc(sym)}"><b>🤖 ${EN ? 'AI summary' : 'AI 3줄 요약'}</b><small>${EN ? 'Writing the summary…' : '요약을 만드는 중…'}</small></div>`;
  }

  // ---------------------------------------------------------------- 🎯 회사 약속 추적 · 📄 공시 한국어 요약 — 서버(/promises·/filesum)가 SEC 원문을 읽고 AI가 한 번 만들어 둔 것
  // 공시 요약은 한 번 부를 때마다 서버가 하나씩 만들어서, 덜 만들어졌으면(more) 몇 번 더 부른다.
  state.prom = {}; state.fsum = {};
  function loadAiCard(kind, sym) {
    const S = state[kind], X = S[sym];
    if (X?.loading || (X && !X.again && Date.now() - X.t < 15 * 60000)) return;
    const tries = (X?.tries || 0) + 1;
    S[sym] = { ...(X || {}), t: Date.now(), loading: true, again: false, tries };
    // AI가 만드는 동안 응답이 1분 넘게 걸릴 수 있다 — 시간 초과면 받은 것까지 두고 다시 부른다
    getJ(`${NEWS_API}/${kind === 'prom' ? 'promises' : 'filesum'}?s=${encodeURIComponent(sym)}`, 90000)
      .then((j) => { S[sym] = { ...j, t: Date.now(), tries }; })
      .catch(() => { S[sym] = { ...(X || {}), loading: false, err: true, pending: kind === 'prom' && !X?.items, more: kind === 'fsum' && !X?.list ? true : X?.more, t: Date.now(), tries }; })
      .then(() => {
        const Y = S[sym];
        if (Y.err && tries >= 8 && !Y.items && !Y.list) Y.none = true;
        if (tries < 8 && ((kind === 'fsum' && Y.more) || (kind === 'prom' && (Y.pending || Y.checking) && !Y.budget))) { Y.again = true; setTimeout(() => { if (state.stock === sym || sym === 'CRCL') { loadAiCard(kind, sym); } }, kind === 'prom' ? 20000 : 3000); }
        renderAiCards(sym);
      });
  }
  const P_BADGE = { check: ['⏰', '기한 지남 · 확인 필요', 'Past due · unconfirmed'], done: ['✅', '지켰어요', 'Done'], on: ['⏳', '진행 중', 'On track'], late: ['⚠️', '늦어지거나 줄었어요', 'Delayed/cut'], unknown: ['❔', '언급 없음', 'Not mentioned'], new: ['🆕', '새 약속', 'New'] };
  // 기한 글자('2026-09-16'·'2026-Q3'·'2026-H2'·'2026') → 그 기간의 마지막 날. 못 읽으면 null(판정 안 함)
  function promDueEnd(due) {
    const t = String(due || '').trim(), y = (t.match(/(20\d\d)/) || [])[1];
    if (!y || new Set(t.match(/20\d\d/g)).size > 1) return null; // '2026년 말 또는 2027년 초'처럼 두 해가 섞이면 판정하지 않는다
    let m;
    if ((m = t.match(/^(20\d\d)-(\d\d)-(\d\d)$/))) return t;
    if ((m = t.match(/Q([1-4])|([1-4])\s*분기/i))) return `${y}-${['03-31', '06-30', '09-30', '12-31'][(+(m[1] || m[2])) - 1]}`;
    if (/H1|상반기/i.test(t)) return `${y}-06-30`;
    if (/H2|하반기/i.test(t)) return `${y}-12-31`;
    if (/^(FY\s*)?20\d\d(년)?( 말| 연말)?$/i.test(t)) return `${y}-12-31`;
    return null;
  }
  function promHtml(sym) {
    const X = state.prom[sym];
    if (!X || X.loading && !X.items) return `<p class="skeleton">${EN ? 'Reading the earnings releases…' : '실적 발표문을 읽는 중…'}</p>`;
    if (!X.items?.length) return X.pending ? `<p class="skeleton">${EN ? 'AI is comparing the last two earnings releases… (up to a minute)' : 'AI가 지난 두 번의 실적 발표를 비교하는 중이에요… (1분쯤 걸려요)'}</p>` : '';
    // 상태 = 실적 발표 기준 판단 → 그 뒤 회사 보도자료로 확인된 변화(upd) → 기한이 지났는데 확인이 안 되면 '확인 필요'
    const st = (x) => x.upd?.status || (['on', 'unknown', 'new'].includes(x.status) && promDueEnd(x.due) && promDueEnd(x.due) < isoToday() ? 'check' : x.status);
    const old = X.items.filter((x) => x.status !== 'new'), nw = X.items.filter((x) => x.status === 'new');
    const cnt = ['done', 'on', 'check', 'late', 'unknown'].map((k) => [k, old.filter((x) => st(x) === k).length]).filter(([, n]) => n);
    const asOf = EN ? ` · as of ${md(isoToTs(X.cur.d))} release` : ` · ${md(isoToTs(X.cur.d))} 발표 기준`;
    const row = (x) => { const k = st(x), B = P_BADGE[k]; return `<li class="pm-i pm-${k}"><span class="pm-b">${B[0]} ${EN ? B[2] : B[1]}${['on', 'unknown'].includes(k) && !x.upd ? asOf : ''}</span><b data-noi18n>${esc(x.goal)}</b>${x.due ? `<em data-noi18n>${EN ? 'Due' : '기한'} ${esc(x.due)}</em>` : ''}${x.upd ? `<small class="pm-upd">📰 ${md(isoToTs(x.upd.d))} ${x.upd.status === 'on' ? (EN ? 'progress' : '진행 소식') : (EN ? 'press release' : '보도자료')}: <a href="${safeUrl(x.upd.url)}" target="_blank" rel="noopener" data-noi18n>${esc(x.upd.title)}</a></small>` : ''}${x.note ? `<small data-noi18n>${x.upd ? `${EN ? `As of the ${md(isoToTs(X.cur.d))} release` : `${md(isoToTs(X.cur.d))} 실적 발표 때`}: ` : ''}${esc(x.note)}</small>` : ''}</li>`; };
    return `<div class="pm-sum">${cnt.map(([k, n]) => `<span class="pm-c pm-${k}">${P_BADGE[k][0]} ${EN ? P_BADGE[k][2] : P_BADGE[k][1]} <b>${n}</b></span>`).join('')}</div>
      ${old.length ? `<ul class="pm-list">${old.map(row).join('')}</ul>` : ''}
      ${nw.length ? `<div class="mini-h er-h">${EN ? 'New promises in the latest release' : '이번 발표에서 새로 한 약속'}</div><ul class="pm-list">${nw.map(row).join('')}</ul>` : ''}
      <p class="note">${EN ? `Judged by AI from the two releases (text in Korean), then updated with the company's press releases up to ${md(isoToTs(X.checked || X.cur.d))}. It can be wrong — check the originals` : `AI가 두 실적 발표문으로 판단하고, ${md(isoToTs(X.checked || X.cur.d))}까지 나온 회사 보도자료로 바뀐 것·진행 소식을 반영했어요. 틀릴 수 있으니 원문으로 확인하세요`} · <a href="${safeUrl(X.prev.url)}" target="_blank" rel="noopener">${EN ? 'Previous' : '지난 발표'} ${md(isoToTs(X.prev.d))}</a> · <a href="${safeUrl(X.cur.url)}" target="_blank" rel="noopener">${EN ? 'Latest' : '최신 발표'} ${md(isoToTs(X.cur.d))}</a></p>`;
  }
  function fsumHtml(sym) {
    const X = state.fsum[sym];
    if (!X || !X.list && (X.loading || X.more)) return `<p class="skeleton">${EN ? 'Loading filings — summaries can take a minute the first time…' : '공시 불러오는 중… 처음엔 AI 요약에 1분쯤 걸려요'}</p>`;
    if (!X.list?.length) return '';
    const kind = (f) => (/^10-Q/.test(f.form) ? (EN ? 'Quarterly report' : '분기 보고서') : /^10-K/.test(f.form) ? (EN ? 'Annual report' : '연간 보고서') : /^20-F/.test(f.form) ? (EN ? 'Annual report' : '연간 보고서') : (EN ? f.en : f.ko).join(' · ') || (EN ? 'Current report' : '수시 공시'));
    return `<ul class="fs-list">${X.list.map((f) => `<li><div class="fs-h"><span class="fs-k">${esc(f.form)}</span><b>${esc(kind(f))}</b><span class="fs-d">${md(isoToTs(f.d))}</span><a href="${safeUrl(f.url)}" target="_blank" rel="noopener">${EN ? 'Original' : '원문'} →</a></div>
      ${f.lines ? `<ul class="fs-l" data-noi18n>${f.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : `<small class="fs-wait">${EN ? 'Summary in progress…' : '요약 만드는 중…'}</small>`}</li>`).join('')}</ul>
      <p class="note">${EN ? 'AI summaries (in Korean) of the SEC originals — may contain mistakes.' : 'SEC 원문을 AI가 한국어로 줄였어요. 틀릴 수 있으니 중요한 건 원문으로 확인하세요.'}</p>`;
  }
  function renderAiCards(sym = state.stock) {
    const pre = isOther(sym) ? 's' : '', ids = [`${pre}prom`, `${pre}fsum`];
    const off = isKR(sym) || isEtf(sym);
    for (const id of ids) { const el = document.getElementById('c-' + id); if (el) el.hidden = off; }
    if (off) return;
    loadAiCard('prom', sym); loadAiCard('fsum', sym);
    const P = state.prom[sym], F = state.fsum[sym], name = esc(ttlName(sym));
    const pEl = document.getElementById(`c-${ids[0]}`), fEl = document.getElementById(`c-${ids[1]}`);
    if (pEl) { pEl.hidden = !!(P && !P.loading && !P.items?.length && !P.pending); if (!pEl.hidden) card(ids[0], { title: EN ? '🎯 Promise tracker' : '🎯 회사 약속 추적', sub: P?.items ? (EN ? `${name}promises from the ${md(isoToTs(P.prev.d))} earnings release → status as of ${md(isoToTs(P.checked || P.cur.d))}` : `${name}${md(isoToTs(P.prev.d))} 실적 발표 때 한 약속 → ${md(isoToTs(P.checked || P.cur.d))} 기준 상태`) : (EN ? 'Did the company do what it said?' : '회사가 말한 대로 하고 있을까?'), info: INFO.prom, body: promHtml(sym) }); }
    if (fEl) { fEl.hidden = !!(F && !F.loading && !F.list?.length && !F.more); if (!fEl.hidden) card(ids[1], { title: EN ? '📄 SEC filings in Korean' : '📄 미국 공시 한국어 요약', sub: EN ? `${name}recent 8-K · 10-Q · 10-K, 3 lines each` : `${name}최근 8-K·10-Q·10-K를 3줄로`, info: INFO.fsum, body: fsumHtml(sym) }); }
  }

  // ---------------------------------------------------------------- 🇺🇸 미국 신용잔고(FINRA, 월별) — 예전 기록은 사이트 파일, 최근 12개월은 서버(/flow)
  let usMarginP = null;
  // 한 번만 받는다(실패해도 다시 그리기를 반복하지 않게) — 받은 뒤에만 then으로 다시 그린다
  const loadUsMargin = () => (usMarginP ? null : (usMarginP = fetch('data/us-margin.json', { cache: 'force-cache' }).then((r) => r.json()).then((j) => { state.usMargin = j.rows || []; }).catch(() => { state.usMargin = []; })));
  function usMarginSeries() {
    const m = new Map([...(state.usMargin || []), ...(state.flow?.us || [])].map((x) => [x[0], x]));
    return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  function usMarginStat() {
    const U = usMarginSeries();
    if (U.length < 13) return null;
    const L = U.at(-1), prevMax = U.slice(0, -1).reduce((a, x) => (x[1] > a[1] ? x : a), U[0]), y = U.find((x) => x[0] === `${+L[0].slice(0, 4) - 1}${L[0].slice(4)}`);
    const p21 = U.filter((x) => x[0] >= '2021-01' && x[0] <= '2021-12').reduce((a, x) => (x[1] > a[1] ? x : a), ['', 0]);
    return { U, L, ath: L[1] >= prevMax[1], prevMax, yoy: y ? L[1] / y[1] - 1 : null, vs21: p21[1] ? L[1] / p21[1] - 1 : null };
  }
  const usT = (m) => (m == null ? '–' : EN ? `$${(m / 1e6).toFixed(2)}T` : `${(m / 1e6).toFixed(2)}조 달러`);


  // 공유 링크(#grow&g=… · #etftax&e=…)는 설정을 읽기 전에 해석한다(아래 SHARED_IN 과 같은 값)
  const SHARED_IN_PRE = (() => { const m = location.hash.match(/^#(grow|etftax)&[ge]=([A-Za-z0-9_-]{4,3000})$/); if (!m) return null; try { const r = atob(m[2].replace(/-/g, '+').replace(/_/g, '/')); const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(r, (c) => c.charCodeAt(0)))); return o && typeof o === 'object' ? { kind: m[1], o } : null; } catch { return null; } })();
  // ---------------------------------------------------------------- 📈 적립식 배당 시뮬레이터(배당금 · 세 번째 보기)
  // 여러 종목을 비중대로 매달 사 모으면 N년 뒤 평가금액·월배당이 얼마인지. 종목마다 실제 배당 기록(최근 5년)으로 배당 성장률을 따로 계산해 각각 굴린 뒤 더한다
  const GROW_KEY = 'cw.grow', GROW_MAX = 10;
  const GROW_PICKS = ['SCHD', 'JEPI', 'O', 'VOO', 'QQQ', 'KO', '005930.KS'];
  let growCfg = Object.assign({ rows: [{ t: 'SCHD', w: 50 }, { t: 'JEPI', w: 30 }, { t: 'O', w: 20 }], start: 1000, monthly: 50, years: 10, drip: true, gP: 6, gD: null, tax: true }, readJSON(GROW_KEY, {}) || {});
  if (!Array.isArray(growCfg.rows)) growCfg.rows = [];
  if (growCfg.t) { if (!growCfg.rows.length) growCfg.rows = [{ t: growCfg.t, w: 100 }]; delete growCfg.t; } // 예전(한 종목) 설정 옮기기
  state.growData = {};
  if (SHARED_IN_PRE?.kind === 'grow') { const o = SHARED_IN_PRE.o; if (Array.isArray(o.r)) growCfg = { rows: o.r.filter((x) => Array.isArray(x) && TICKER_RE.test(x[0])).slice(0, 10).map(([t, w, n]) => ({ t, w, ...(n ? { n: String(n).slice(0, 40) } : {}) })), start: o.s, monthly: o.m, years: o.y, drip: !!o.d, gP: o.p, gD: o.g ?? null, tax: !!o.x }; }
  let growSearchOpen = false, growResults = [], growSearchTimer = null;
  const growSave = () => writeJSON(GROW_KEY, growCfg);
  const growName = (r) => (krTk(r.t) ? (EN ? (r.t === '005930.KS' ? 'Samsung' : r.t.slice(0, 6)) : r.n || state.growData[r.t]?.name || fireName(r.t) || r.t.slice(0, 6)) : r.t);
  function growInfo(t) {
    const D = state.growData[t];
    if (!D || D.error || !(D.price > 0)) return null;
    const ev2 = D.events || [], now = Date.now(), y = (k) => ev2.filter((e) => { const a = (now - Date.parse(e.ex)) / 86400000; return a >= k * 365 && a < (k + 1) * 365; }).reduce((s2, e) => s2 + e.amt, 0);
    // 비교할 해의 배당 기록이 1년 내내 있어야(상장 첫해처럼 일부만 있으면 성장률이 부풀려진다) 그 해를 기준으로 쓴다
    const first = ev2.length ? Math.min(...ev2.map((e) => Date.parse(e.ex))) : now, full = (k) => (now - first) / 86400000 >= (k + 1) * 365 - 45;
    const ttm = y(0), y5 = full(5) ? y(5) : 0, y3 = full(3) ? y(3) : 0;
    const cagr = ttm > 0 && y5 > 0 ? (ttm / y5) ** (1 / 5) - 1 : ttm > 0 && y3 > 0 ? (ttm / y3) ** (1 / 3) - 1 : null;
    const n = ev2.filter((e) => (now - Date.parse(e.ex)) / 86400000 < 365).length;
    return { ttm, price: D.price, yld: ttm / D.price, cagr: cagr == null ? null : Math.max(-0.05, Math.min(0.15, cagr)), n, kr: krTk(t) };
  }
  function growLoad() {
    for (const r of growCfg.rows) {
      const t = r.t;
      if (state.growData[t] || state.growData[t + ':loading']) continue;
      state.growData[t + ':loading'] = true;
      getJ(`${NEWS_API}/dividends?s=${encodeURIComponent(t)}`, 15000)
        .then((j) => { state.growData[t] = j.error ? { error: true } : j; })
        .catch(() => { state.growData[t] = { error: true }; })
        .finally(() => { delete state.growData[t + ':loading']; if (!growCfg.rows.some((x) => state.growData[x.t + ':loading'])) renderGrow(); });
    }
  }
  function growCalc() {
    const fx = state.quote?.fx?.rate, rows = growCfg.rows.filter((r) => r.t);
    if (!rows.length || rows.some((r) => state.growData[r.t + ':loading'] || !state.growData[r.t])) return null;
    const H = rows.map((r) => ({ r, I: growInfo(r.t) })).filter((h) => h.I && (h.I.kr || fx));
    const wSum = H.reduce((a, h) => a + Math.max(0, +h.r.w || 0), 0);
    if (!H.length || !(wSum > 0)) return null;
    const gP = (+growCfg.gP || 0) / 100, over = growCfg.gD == null || growCfg.gD === '' ? null : (+growCfg.gD || 0) / 100;
    const years = Math.max(1, Math.min(40, Math.round(+growCfg.years || 10))), start = (+growCfg.start || 0) * 1e4, add = (+growCfg.monthly || 0) * 1e4;
    const P = H.map(({ r, I }) => {
      const k = Math.max(0, +r.w || 0) / wSum, toCur = (v) => (I.kr ? v : v / fx), toW = (v) => (I.kr ? v : v * fx);
      return { t: r.t, name: growName(r), k, I, toCur, toW, p: I.price, D: I.ttm, gD: over ?? I.cagr ?? 0.05, tax: growCfg.tax ? (I.kr ? 0.154 : 0.15) : 0, sh: toCur(start * k) / I.price, cash: 0, cum: 0 };
    });
    const snap = (y, inv) => ({ y, inv, val: P.reduce((a, h) => a + h.toW(h.sh * h.p + h.cash), 0), mon: P.reduce((a, h) => a + h.toW(h.sh * h.D / 12 * (1 - h.tax)), 0), cum: P.reduce((a, h) => a + h.toW(h.cum), 0) });
    let inv = start, hit100 = null;
    const out = [snap(0, inv)];
    for (let m = 1; m <= years * 12; m++) {
      inv += add;
      for (const h of P) {
        h.sh += h.toCur(add * h.k) / h.p;
        const net = h.sh * h.D / 12 * (1 - h.tax);
        h.cum += net; if (growCfg.drip) h.sh += net / h.p; else h.cash += net;
        h.p *= (1 + gP) ** (1 / 12);
      }
      if (m % 12 === 0) {
        for (const h of P) h.D *= 1 + h.gD;
        const S = snap(m / 12, inv);
        if (hit100 == null && S.mon >= 1e6) hit100 = m / 12;
        out.push(S);
      }
    }
    const yld = P.reduce((a, h) => a + h.k * h.I.yld, 0), gD = P.reduce((a, h) => a + h.k * h.gD, 0);
    return { P, rows: out, last: out.at(-1), yld, gD, gP, hit100, years, skipped: rows.filter((r) => !H.some((h) => h.r === r)).map(growName) };
  }
  function growWeightHtml() {
    const t = Math.round(growCfg.rows.reduce((a, r) => a + (+r.w || 0), 0));
    if (!growCfg.rows.length) return '';
    if (t === 100) return `<span class="ok">✓ ${EN ? 'Weights total 100%' : '비중 합계 100%'}</span>`;
    return `<span class="warn">${EN ? `Weights total ${t}%` : `비중 합계 ${t}%`}</span> <small>${EN ? 'Scaled to 100% in the calculation' : '계산할 때 비율대로 100%에 맞춰요'}</small>`;
  }
  function growRowsHtml() {
    return growCfg.rows.map((r, i) => {
      const I = growInfo(r.t), D = state.growData[r.t], kr = krTk(r.t), nm = growName(r);
      const meta = D?.error ? `<small class="warn">${EN ? 'No data' : '자료를 못 받았어요'}</small>` : I ? `<small class="gr-meta">${EN ? 'yield' : '배당률'} ${pctPlain(I.yld, 1)} · ${!I.ttm ? (EN ? 'no dividend' : '배당 없음') : I.cagr != null ? `${EN ? 'growth' : '성장'} ${pctPlain(I.cagr, 1)}${EN ? '/yr' : '/년'}` : (EN ? 'growth 5% assumed' : '성장 5% 가정')}</small>` : `<small>${EN ? 'Loading…' : '불러오는 중…'}</small>`;
      return `<div class="sim-row gr-row" data-t="${esc(r.t)}"><div class="sim-tw">${logoPath(r.t) ? `<img class="sim-logo" src="${logoPath(r.t)}" alt="" width="26" height="26" loading="lazy">` : `<span class="sim-logo ws-letter">${esc(String(nm || '?')[0])}</span>`}<div class="sim-nm"><b>${esc(nm)}</b>${kr ? `<small>${r.t.slice(0, 6)}</small>` : ''}${meta}</div></div><div class="bn-in"><input class="gr-w" data-growi="${i}" inputmode="numeric" maxlength="3" value="${esc(String(r.w ?? ''))}" aria-label="${esc(nm)} ${EN ? 'weight' : '비중'}"><em>%</em></div><button type="button" class="f-rm" data-growrm="${i}" aria-label="${EN ? 'Remove' : '이 종목 빼기'}">×</button></div>`;
    }).join('');
  }
  function growResHtml() {
    const q = document.getElementById('gr-q')?.value.trim() || '';
    if (!q) return `<li class="empty">${EN ? 'Search by ticker or company name' : '미국은 티커나 회사명(리얼티인컴), 한국은 종목명이나 종목코드로 찾아요'}</li>`;
    if (growResults === null) return `<li class="empty">${EN ? 'Searching…' : '검색 중…'}</li>`;
    const have = new Set(growCfg.rows.map((r) => r.t));
    return growResults.filter((r) => TICKER_RE.test(r.symbol)).slice(0, 12).map((r) => { const kr = krTk(r.symbol), nm = r.name || r.symbol; return `<li>${logoPath(r.symbol) ? `<span class="ws-logo"><img src="${logoPath(r.symbol)}" alt="" width="22" height="22" loading="lazy"></span>` : `<span class="ws-logo ws-letter">${esc(String((kr ? nm : r.symbol) || '?')[0])}</span>`}<div class="ws-name"><b>${esc(kr ? nm : r.symbol)}</b><small>${esc(kr ? `${r.exchange === 'KOSDAQ' ? '코스닥' : '코스피'} · ${r.symbol.slice(0, 6)}${r.etf ? ' · ETF' : ''}` : r.kr && !EN && r.kr !== nm ? `${r.kr} · ${nm}` : nm)}</small></div>${have.has(r.symbol) ? `<em class="sim-added">✓ ${EN ? 'Added' : '추가됨'}</em>` : `<button type="button" class="ws-btn add" data-growres="${esc(r.symbol)}" data-n="${esc(kr ? nm : '')}">+ ${EN ? 'Add' : '추가'}</button>`}</li>`; }).join('') || `<li class="empty">${EN ? 'No matches' : '찾는 종목이 없어요'}</li>`;
  }
  function growSearch(q) {
    clearTimeout(growSearchTimer);
    const paint = () => { const el = document.getElementById('gr-res'); if (el) el.innerHTML = growResHtml(); };
    if (!q.trim()) { growResults = []; paint(); return; }
    growSearchTimer = setTimeout(async () => {
      growResults = null; paint();
      const r = await findSyms(q);
      if ((document.getElementById('gr-q')?.value || '') !== q) return;
      growResults = r; paint();
    }, 250);
  }
  function growAdd(t, n) {
    if (!TICKER_RE.test(t) || growCfg.rows.some((r) => r.t === t)) return;
    if (growCfg.rows.length >= GROW_MAX) { toast(EN ? `Up to ${GROW_MAX} stocks` : `종목은 ${GROW_MAX}개까지 넣을 수 있어요`, true); return; }
    // 새 종목은 1/n 비중, 나머지는 원래 비율대로 줄여 합계 100%를 맞춘다
    const nw = Math.round(100 / (growCfg.rows.length + 1)), tot = growCfg.rows.reduce((a, r) => a + (+r.w || 0), 0);
    if (tot > 0) { for (const r of growCfg.rows) r.w = Math.round(((+r.w || 0) / tot) * (100 - nw)); }
    growCfg.rows.push({ t, w: growCfg.rows.length ? nw : 100, ...(n ? { n } : {}) });
    const gap = 100 - growCfg.rows.reduce((a, r) => a + (+r.w || 0), 0);
    if (gap && growCfg.rows.length > 1) { const big = growCfg.rows.reduce((a, r) => ((+r.w || 0) > (+a.w || 0) ? r : a)); big.w = (+big.w || 0) + gap; }
    growSave();
  }
  function renderGrow() {
    const el = document.getElementById('c-grow');
    if (!el) return;
    growLoad();
    if (!state.quote) loadQuote().then(renderGrow).catch(() => {});
    const R = growCalc(), have = new Set(growCfg.rows.map((r) => r.t));
    card('grow', {
      title: EN ? '📈 Monthly investing simulator' : '📈 적립식 배당 시뮬레이터', sub: EN ? 'Buy a mix of stocks every month → value and monthly dividends N years later' : '여러 종목을 비중대로 매달 사 모으면 N년 뒤 평가금액·월배당은?',
      easy: EN ? 'Pick stocks and weights, then how much you put in each month. Each stock grows its dividend at its own real 5-year pace. Assumptions, not a forecast.' : '종목과 비중, 매달 넣을 돈을 정하면 종목마다 실제 배당 기록으로 배당이 늘어나는 속도를 따로 계산해서, 몇 년 뒤 평가금액과 한 달 배당을 보여줘요. 가정에 따른 계산이지 예측이 아니에요.',
      share: R ? 'grow' : null,
      body: `<div class="gr-picks" role="group" aria-label="${EN ? 'Quick add' : '빠르게 넣기'}">${GROW_PICKS.map((x) => `<button type="button" class="chip-btn sm" data-growpick="${esc(x)}" aria-pressed="${have.has(x)}">${have.has(x) ? '✓ ' : '+ '}${esc(growName({ t: x }))}</button>`).join('')}</div>
        <div class="sim-rows gr-rows" id="gr-rows">${growRowsHtml()}</div>
        ${growSearchOpen ? `<div class="sim-search"><div class="ws-search sim-q"><input id="gr-q" type="search" placeholder="${EN ? 'Ticker or name (e.g. SCHD, Realty Income)' : '티커나 종목명 (예: SCHD, 리얼티인컴, 삼성전자)'}" aria-label="${EN ? 'Search stocks' : '종목 검색'}" autocomplete="off" autocapitalize="off" enterkeyhint="search"><button type="button" class="sim-qx" data-growclose="1" aria-label="${EN ? 'Close search' : '검색 닫기'}">×</button></div><ul class="ws-list sim-res" id="gr-res">${growResHtml()}</ul></div>` : ''}
        <p class="sim-wsum" id="gr-wsum">${growWeightHtml()}</p>
        <div class="sim-act"><button type="button" class="btn-ghost sm" data-growadd="1" aria-pressed="${growSearchOpen}">🔍 ${EN ? 'Find & add' : '종목 찾아 추가'}</button><button type="button" class="btn-ghost sm" data-groweq="1"${growCfg.rows.length > 1 ? '' : ' disabled'}>${EN ? 'Equal weights' : '비중 똑같이'}</button></div>
        <div class="bn-grid gr-in">
          <label class="bn-f"><span>${EN ? 'Start with' : '처음 넣는 돈'}</span><div class="bn-in"><input inputmode="numeric" data-grow="start" value="${esc(String(growCfg.start))}"><em>${EN ? '×10k ₩' : '만원'}</em></div></label>
          <label class="bn-f"><span>${EN ? 'Every month' : '매달 넣는 돈'}</span><div class="bn-in"><input inputmode="numeric" data-grow="monthly" value="${esc(String(growCfg.monthly))}"><em>${EN ? '×10k ₩' : '만원'}</em></div></label>
          <label class="bn-f"><span>${EN ? 'Years' : '기간'}</span><div class="bn-in"><input inputmode="numeric" data-grow="years" value="${esc(String(growCfg.years))}"><em>${EN ? 'yrs' : '년'}</em></div></label>
          <label class="bn-f"><span>${EN ? 'Price growth / yr' : '주가 상승률(연)'}</span><div class="bn-in"><input inputmode="decimal" data-grow="gP" value="${esc(String(growCfg.gP))}"><em>%</em></div></label>
          <label class="bn-f gr-gd"><span>${EN ? 'Dividend growth / yr' : '배당 성장률(연)'}</span><div class="bn-in"><input inputmode="decimal" data-grow="gD" value="${esc(growCfg.gD == null ? '' : String(growCfg.gD))}" placeholder="${EN ? 'auto' : '자동'}"><em>%</em></div><small>${EN ? 'Blank = each stock’s own 5-year record' : '비우면 종목마다 최근 5년 실제 기록으로'}</small></label>
          <div class="gr-chk"><label class="chk"><input type="checkbox" data-grow="drip" ${growCfg.drip ? 'checked' : ''}> ${EN ? 'Reinvest dividends' : '배당 다시 사기(재투자)'}</label><label class="chk"><input type="checkbox" data-grow="tax" ${growCfg.tax ? 'checked' : ''}> ${EN ? 'After tax' : '세후(배당세 뺌)'}</label></div>
        </div>
        <div id="gr-out">${growOutHtml(R)}</div>${growCfg.rows.length ? linkBtn('grow') : ''}`,
    });
    if (R) drawGrow(R);
  }
  function growOutHtml(R) {
    if (!growCfg.rows.length) return `<p class="note">${EN ? 'Add at least one stock.' : '종목을 하나 이상 넣어 주세요.'}</p>`;
    if (!R) return growCfg.rows.some((r) => !state.growData[r.t] || state.growData[r.t + ':loading']) ? `<p class="skeleton">${EN ? 'Loading dividend history…' : '배당 기록 불러오는 중…'}</p>` : `<p class="note">${EN ? 'Set weights above 0%.' : '비중을 0%보다 크게 넣어 주세요.'}</p>`;
    const L = R.last, mk = [5, 10, 20, 30].filter((y) => y < R.years).map((y) => R.rows.find((r) => r.y === y)).filter(Boolean);
    return `<p class="gr-info">${EN ? 'Portfolio yield' : '포트폴리오 배당률'} ${pctPlain(R.yld, 2)} · ${EN ? 'dividend growth' : '배당 성장'} ${pctPlain(R.gD, 1)}${EN ? '/yr (weighted)' : '/년(비중 평균)'}</p>
      ${R.skipped.length ? `<p class="note warn">${esc(R.skipped.join(', '))} ${EN ? 'left out (no data)' : '— 자료를 못 받아 빼고 계산했어요'}</p>` : ''}
      <div class="gr-sum">
        <div><span>${R.years}${EN ? 'y later · value' : '년 뒤 평가금액'}</span><b>${wonFull(L.val)}</b><small>${EN ? 'invested' : '넣은 돈'} ${wonFull(L.inv)}</small></div>
        <div><span>${EN ? 'Monthly dividend' : '한 달 배당'}${growCfg.tax ? (EN ? ' (after tax)' : '(세후)') : ''}</span><b class="up">${wonFull(L.mon)}</b><small>${EN ? 'total received' : '그동안 받은 배당'} ${wonFull(L.cum)}</small></div>
      </div>
      <div class="chart gr-chart"><canvas id="cv-grow" role="img" aria-label="${EN ? 'Projection' : '적립식 시뮬레이션'}"></canvas></div>
      ${mk.length ? `<ul class="gr-mk">${mk.map((r) => `<li><b>${r.y}${EN ? 'y' : '년'}</b><span>${wonFull(r.val)}</span><small>${EN ? 'monthly div' : '월배당'} ${wonFull(r.mon)}</small></li>`).join('')}</ul>` : ''}
      ${R.P.length > 1 ? `<ul class="gr-mix">${R.P.map((h) => `<li><b>${esc(h.name)}</b><span>${pctPlain(h.k, 0)}</span><small>${EN ? 'monthly div' : '월배당'} ${wonFull(h.toW(h.sh * h.D / 12 * (1 - h.tax)))}</small></li>`).join('')}</ul>` : ''}
      <p class="note">${R.hit100 != null ? (EN ? `🎯 Monthly dividend passes ₩1M in year ${R.hit100}. ` : `🎯 ${R.hit100}년 차에 월배당 100만원을 넘어요. `) : ''}${EN ? 'Assumes constant price and dividend growth and today’s exchange rate. Past dividends don’t guarantee future ones.' : '주가·배당이 매년 같은 비율로 오르고 환율은 지금 그대로라고 가정했어요. 과거 배당이 미래를 보장하지 않아요.'}</p>`;
  }
  function growRefresh() {
    const R = growCalc(), o = document.getElementById('gr-out'), w = document.getElementById('gr-wsum');
    if (w) w.innerHTML = growWeightHtml();
    if (o) { o.innerHTML = growOutHtml(R); if (R) drawGrow(R); }
    const b = document.querySelector('#c-grow .share-card-btn');
    if (b) b.hidden = !R;
  }
  function drawGrow(R) {
    const labels = R.rows.map((r) => r.y);
    draw('grow', { type: 'line', data: { labels, datasets: [
      lineDs(EN ? 'Value' : '평가금액', R.rows.map((r) => r.val), C.teal || '#3fbf7f', { fill: 'start', backgroundColor: areaFill(C.teal || '#3fbf7f') }),
      lineDs(EN ? 'Invested' : '넣은 돈', R.rows.map((r) => r.inv), C.muted, { borderDash: [5, 4], borderWidth: 1.5 }),
      lineDs(EN ? 'Monthly dividend' : '월배당', R.rows.map((r) => r.mon), C.orange, { yAxisID: 'y1', borderWidth: 2 }),
    ] }, options: { interaction, plugins: { legend: { display: true, labels: { boxWidth: 10, boxHeight: 2, font: { size: 11 } } }, tooltip: tooltip((it) => `${labels[it.dataIndex]}${EN ? 'y' : '년'}`, (v) => wonFull(v)) },
      scales: { x: axisX(labels, (y) => `${y}${EN ? 'y' : '년'}`, 6), y: axisY((v) => manwon(v)), y1: { ...axisY((v) => manwon(v)), position: 'left', grid: { display: false } } } } });
  }

  // ---------------------------------------------------------------- 🧮 미국 ETF 세금 비교(세금 탭): 미국 직투 · 국내 상장 · ISA · 연금저축
  // 같은 지수(S&P500)를 같은 수익률로 산다고 보고, 계좌별 세금 규칙만 다르게 적용해 세후 결과를 나란히
  const ETAX_KEY = 'cw.etax';
  let etaxCfg = Object.assign({ yearly: 600, years: 10, g: 8, y: 1.3, low: true, age: 'u70', isa: 'gen' }, readJSON(ETAX_KEY, {}) || {});
  if (SHARED_IN_PRE?.kind === 'etftax') { const o = SHARED_IN_PRE.o; etaxCfg = { yearly: o.c, years: o.n, g: o.g, y: o.y, low: !!o.l, age: ['u70', 'u80', 'o80'].includes(o.a) ? o.a : 'u70', isa: o.i === 'low' ? 'low' : 'gen' }; }
  function etaxCalc() {
    const C = (+etaxCfg.yearly || 0) * 1e4, N = Math.max(1, Math.min(40, Math.round(+etaxCfg.years || 10))), g = (+etaxCfg.g || 0) / 100, y = (+etaxCfg.y || 0) / 100;
    // 한 계좌 시뮬레이션: divTax(배당에 매년), final(v, basis, contrib) → 마지막 세금
    const run = (contribOf, divTax, finalTax) => {
      let V = 0, B = 0, paid = 0, put = 0;
      for (let k = 0; k < N; k++) { const c = contribOf(k); V += c; B += c; put += c; const d = V * y, dt = d * divTax; paid += dt; V = V * (1 + g) + d - dt; B += d - dt; }
      const ft = Math.max(0, finalTax(V, B, put)); paid += ft;
      return { V: V - ft, paid, put };
    };
    const direct = run(() => C, 0.15, (V, B) => (V - B - 2.5e6) * 0.22);
    const kr = run(() => C, 0.154, (V, B) => (V - B) * 0.154);
    // ISA: 연 2천만·총 1억 한도, 넘는 돈은 일반 국내 상장 계좌로
    const isaCap = (k) => Math.max(0, Math.min(C, 2e7, 1e8 - Math.min(C, 2e7) * k));
    const isaFree = etaxCfg.isa === 'low' ? 4e6 : 2e6;
    const isaA = run(isaCap, 0, (V, B, put) => (V - put - isaFree) * 0.099), isaB = run((k) => C - isaCap(k), 0.154, (V, B) => (V - B) * 0.154);
    const isa = { V: isaA.V + isaB.V, paid: isaA.paid + isaB.paid, put: isaA.put + isaB.put, over: C > 2e7 || C * N > 1e8, short: N < 3 };
    // 연금저축: 연 1,800만 납입 한도(세액공제는 600만까지) · 받을 때 연금소득세 · 세액공제는 매년 돌려받음(재투자 안 함)
    const penCap = Math.min(C, 1.8e7), credRate = etaxCfg.low ? 0.165 : 0.132, penRate = { u70: 0.055, u80: 0.044, o80: 0.033 }[etaxCfg.age] || 0.055;
    const penA = run(() => penCap, 0, (V, B, put) => { const credited = Math.min(penCap, 6e6) * N; return (V - (put - credited)) * penRate; }), penB = run(() => C - penCap, 0.154, (V, B) => (V - B) * 0.154);
    const credit = Math.min(penCap, 6e6) * credRate * N;
    const pen = { V: penA.V + penB.V, paid: penA.paid + penB.paid, put: penA.put + penB.put, credit };
    const list = [
      ['direct', EN ? 'US-listed (e.g. VOO)' : '미국 직투(VOO 등)', direct, EN ? '15% US tax on dividends · 22% on gains over ₩2.5M when you sell' : '배당 15%(미국) · 팔 때 이익 250만원 넘는 부분 22%'],
      ['kr', EN ? 'Korea-listed ETF' : '국내 상장 ETF(TIGER·KODEX 등)', kr, EN ? '15.4% on distributions and on gains' : '분배금·매매차익 모두 15.4%(배당소득세)'],
      ['isa', EN ? 'ISA account' : 'ISA 계좌(국내 상장 ETF)', isa, EN ? `No tax until maturity; ₩${etaxCfg.isa === 'low' ? '4' : '2'}M tax-free then 9.9%` : `만기(3년 이상)까지 세금 없음 · 이익 ${etaxCfg.isa === 'low' ? '400' : '200'}만원 비과세, 넘는 부분 9.9%`],
      ['pen', EN ? 'Pension savings' : '연금저축(국내 상장 ETF)', pen, EN ? `Tax credit ${pctPlain(credRate, 1)} on up to ₩6M/yr · ${pctPlain(penRate, 1)} when you draw after 55` : `연 600만원까지 세액공제 ${pctPlain(credRate, 1)} · 55세 이후 연금으로 받을 때 ${pctPlain(penRate, 1)}`],
    ].map(([k, name, r, rule]) => ({ k, name, rule, final: r.V + (r.credit || 0), tax: r.paid, credit: r.credit || 0, put: r.put, x: r }));
    const best = list.reduce((a, b) => (b.final > a.final ? b : a));
    return { list, best, N, C, isa, put: C * N };
  }
  function etaxOutHtml() {
    const T = etaxCalc(), base = T.list[0].final;
    return `<ul class="et-list">${T.list.map((r) => `<li class="${r === T.best ? 'best' : ''}"><div class="et-h"><b>${esc(r.name)}</b>${r === T.best ? `<em>${EN ? 'Best' : '가장 유리'}</em>` : ''}</div>
        <div class="et-v"><b>${wonFull(r.final)}</b>${r.k !== 'direct' ? `<small class="${cls(r.final - base)}">${EN ? 'vs US-listed' : '직투보다'} ${signed(r.final - base, wonFull)}</small>` : ''}</div>
        <small class="et-r">${esc(r.rule)} · ${EN ? 'tax' : '세금'} ${wonFull(r.tax)}${r.credit ? ` · ${EN ? 'credits' : '세액공제'} +${wonFull(r.credit)}` : ''}</small></li>`).join('')}</ul>
      ${T.isa.over ? `<p class="note">${EN ? 'ISA limits: ₩20M a year, ₩100M total — the excess is counted as a regular Korea-listed account.' : 'ISA 한도(연 2천만원·총 1억원)를 넘는 돈은 일반 국내 상장 계좌로 계산했어요.'}</p>` : ''}
      ${T.isa.short ? `<p class="note">${EN ? 'ISA needs at least 3 years to get the tax benefit.' : 'ISA는 3년 이상 유지해야 비과세 혜택을 받아요.'}</p>` : ''}
      <p class="note">${EN ? `Total invested ${wonFull(T.put)}. Same index return for all; fees, FX and the ₩20M financial-income threshold are ignored. Pension money is locked until 55 (early withdrawal is taxed 16.5%). Not tax advice.` : `모두 같은 지수·같은 수익률로 가정했고, 총 넣은 돈은 ${wonFull(T.put)}이에요. 수수료·환율, 금융소득 2천만원 초과 종합과세는 뺐어요. 연금저축은 55세 전에 빼면 16.5%가 붙어요. 직투는 매년 250만원씩 나눠 익절하면 세금을 더 줄일 수 있어요. 세무 조언이 아니에요.`}</p>`;
  }
  function renderEtfTax() {
    if (!document.getElementById('c-etftax')) return;
    const f = (k, label, unit, mode = 'decimal') => `<label class="bn-f"><span>${label}</span><div class="bn-in"><input inputmode="${mode}" data-etax="${k}" value="${esc(String(etaxCfg[k]))}"><em>${unit}</em></div></label>`;
    card('etftax', {
      title: EN ? '🧮 US ETF tax: which account wins?' : '🧮 미국 ETF 세금 비교 — 어디서 사야 유리할까', sub: EN ? 'US-listed vs Korea-listed vs ISA vs pension' : '미국 직투 vs 국내 상장 vs ISA vs 연금저축 · 같은 S&P500 기준',
      easy: EN ? 'The same S&P 500 fund is taxed differently depending on where you buy it. Enter how much you invest a year and for how long to compare what you keep after tax.' : '같은 S&P500 ETF라도 어디서(어떤 계좌로) 사느냐에 따라 세금이 달라요. 1년에 넣을 돈과 기간을 넣으면 세금을 떼고 남는 돈을 나란히 비교해요.',
      body: `<div class="bn-grid et-in">${f('yearly', EN ? 'Invest per year' : '1년에 넣는 돈', EN ? '×10k ₩' : '만원', 'numeric')}${f('years', EN ? 'Years' : '기간', EN ? 'yrs' : '년', 'numeric')}${f('g', EN ? 'Price growth / yr' : '주가 상승률(연)', '%')}${f('y', EN ? 'Dividend yield' : '배당률', '%')}</div>
        <div class="et-opts">
          <label class="chk"><input type="checkbox" data-etax="low" ${etaxCfg.low ? 'checked' : ''}> ${EN ? 'Salary ≤ ₩55M (16.5% pension credit)' : '총급여 5,500만원 이하(연금 세액공제 16.5%)'}</label>
          <label class="chk"><input type="checkbox" data-etax="isa" ${etaxCfg.isa === 'low' ? 'checked' : ''}> ${EN ? 'ISA low-income type (₩4M tax-free)' : 'ISA 서민형(400만원 비과세)'}</label>
          <label class="et-age"><span>${EN ? 'Pension tax by age' : '연금 받을 나이'}</span><select data-etax="age">${[['u70', EN ? 'Under 70 · 5.5%' : '70세 미만 · 5.5%'], ['u80', EN ? '70–79 · 4.4%' : '70~79세 · 4.4%'], ['o80', EN ? '80+ · 3.3%' : '80세 이상 · 3.3%']].map(([k, l]) => `<option value="${k}" ${etaxCfg.age === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div id="et-out">${etaxOutHtml()}</div>${linkBtn('etax')}`,
      share: 'etax',
    });
  }


  // ---------------------------------------------------------------- 🔗 계산 조건을 링크로 공유(#grow&g=… · #etftax&e=…) — 받은 사람은 같은 조건으로 열린다(본인 설정은 값을 고칠 때만 저장)
  const b64e = (o) => { const b = new TextEncoder().encode(JSON.stringify(o)); let t = ''; for (const x of b) t += String.fromCharCode(x); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const b64d = (t) => { try { const r = atob(t.replace(/-/g, '+').replace(/_/g, '/')); return JSON.parse(new TextDecoder().decode(Uint8Array.from(r, (c) => c.charCodeAt(0)))); } catch { return null; } };
  const SHARED_IN = (() => {
    const m = location.hash.match(/^#(grow|etftax)&[ge]=([A-Za-z0-9_-]{4,3000})$/);
    if (!m) return null;
    const o = b64d(m[2]);
    try { history.replaceState(null, '', location.pathname + location.search + '#' + m[1]); } catch {}
    return o && typeof o === 'object' ? { kind: m[1], o } : null;
  })();
  async function shareLink(kind, btn) {
    const url = kind === 'grow'
      ? `${location.origin}/?ref=share-link#grow&g=${b64e({ r: growCfg.rows.map((r) => [r.t, +r.w || 0, r.n || '']), s: +growCfg.start || 0, m: +growCfg.monthly || 0, y: +growCfg.years || 10, d: growCfg.drip ? 1 : 0, p: +growCfg.gP || 0, g: growCfg.gD == null || growCfg.gD === '' ? null : +growCfg.gD, x: growCfg.tax ? 1 : 0 })}`
      : `${location.origin}/?ref=share-link#etftax&e=${b64e({ c: +etaxCfg.yearly || 0, n: +etaxCfg.years || 10, g: +etaxCfg.g || 0, y: +etaxCfg.y || 0, l: etaxCfg.low ? 1 : 0, a: etaxCfg.age, i: etaxCfg.isa })}`;
    const title = kind === 'grow' ? (EN ? 'My monthly investing plan' : '적립식 배당 시뮬레이션') : (EN ? 'US ETF tax comparison' : '미국 ETF 세금 비교');
    if (btn) btn.disabled = true;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: `${title} · Fire Portfolio`, url }); } catch {} return; }
      await navigator.clipboard.writeText(url);
      toast(EN ? 'Link copied — whoever opens it sees the same inputs' : '링크를 복사했어요. 받은 사람도 같은 조건으로 열려요');
    } catch { prompt(EN ? 'Copy this link' : '이 링크를 복사하세요', url); }
    finally { if (btn) btn.disabled = false; }
  }
  const linkBtn = (kind) => `<button type="button" class="btn-ghost sm link-btn" data-sharelink="${kind}">🔗 ${EN ? 'Share these inputs as a link' : '이 조건 링크로 공유'}</button>`;

  // ---------------------------------------------------------------- 🏦 절세 계좌 한도 트래커(세금 탭): 올해 ISA·연금저축·IRP에 넣은 돈 → 남은 한도와 더 돌려받을 수 있는 세금
  const ACCT_KEY = 'cw.acct', THIS_YEAR = new Date().getFullYear();
  let acctCfg = (() => { const a = readJSON(ACCT_KEY, null); return a && a.y === THIS_YEAR ? a : { y: THIS_YEAR, isa: '', pen: '', irp: '' }; })();
  const yearEndBiz = () => { let d = new Date(Date.UTC(THIS_YEAR, 11, 31)); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() - 86400000); return d.toISOString().slice(0, 10); };
  const manIn = (v) => Math.max(0, parseFloat(String(v ?? '').replace(/[,\s]/g, '')) || 0);
  function acctCalc() {
    const isa = manIn(acctCfg.isa), pen = manIn(acctCfg.pen), irp = manIn(acctCfg.irp), rate = etaxCfg.low ? 0.165 : 0.132;
    const penOk = Math.min(pen, 600), elig = Math.min(penOk + irp, 900);
    const morePen = Math.max(0, Math.min(600 - penOk, 900 - elig)), moreIrp = Math.max(0, 900 - elig - morePen);
    return { isa, pen, irp, rate, elig, isaLeft: Math.max(0, 2000 - isa), refund: elig * 1e4 * rate, more: (900 - elig) * 1e4 * rate, morePen, moreIrp, dd: daysBetween(isoToday(), yearEndBiz()) };
  }
  function acctOutHtml() {
    const A = acctCalc(), bar = (v, max) => `<div class="ac-bar"><i style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%"></i></div>`;
    const man = (v) => wonFull(v * 1e4);
    return `<ul class="ac-list">
        <li><div class="ac-h"><b>ISA</b><span>${man(A.isa)} / ${man(2000)}</span></div>${bar(A.isa, 2000)}<small>${A.isaLeft ? (EN ? `${man(A.isaLeft)} of this year’s limit left (unused limit carries over to next year)` : `올해 한도 ${man(A.isaLeft)} 남았어요(못 채운 한도는 다음 해로 넘어가요)`) : (EN ? 'This year’s limit is full' : '올해 한도를 다 채웠어요')}</small></li>
        <li><div class="ac-h"><b>${EN ? 'Pension savings' : '연금저축'}</b><span>${man(Math.min(A.pen, 600))} / ${man(600)}</span></div>${bar(A.pen, 600)}<small>${EN ? 'Tax credit up to ₩6M a year' : '세액공제는 연 600만원까지'}</small></li>
        <li><div class="ac-h"><b>${EN ? 'Pension + IRP' : '연금저축 + IRP'}</b><span>${man(A.elig)} / ${man(900)}</span></div>${bar(A.elig, 900)}<small>${EN ? 'Combined credit limit ₩9M' : '둘을 합쳐 900만원까지 세액공제'}</small></li>
      </ul>
      <div class="gr-sum ac-sum">
        <div><span>${EN ? 'Refund so far' : '지금까지 돌려받을 세금'}</span><b class="up">${wonFull(A.refund)}</b><small>${EN ? 'credit' : '세액공제'} ${pctPlain(A.rate, 1)}</small></div>
        <div><span>${EN ? 'If you fill the rest' : '한도를 다 채우면 더'}</span><b>${A.more > 0 ? '+' + wonFull(A.more) : '–'}</b><small>${A.more > 0 ? (EN ? `${A.morePen ? `pension +${man(A.morePen)}` : ''}${A.morePen && A.moreIrp ? ' · ' : ''}${A.moreIrp ? `IRP +${man(A.moreIrp)}` : ''}` : `${A.morePen ? `연금저축 +${man(A.morePen)}` : ''}${A.morePen && A.moreIrp ? ' · ' : ''}${A.moreIrp ? `IRP +${man(A.moreIrp)}` : ''}`) : (EN ? 'All filled 🎉' : '다 채웠어요 🎉')}</small></div>
      </div>
      <p class="note">${A.dd >= 0 ? `⏰ ${EN ? `Contributions count for this year until ${krDate(yearEndBiz())} (D-${A.dd}). Transfers on the last day can be late, so leave a few days.` : `올해 공제를 받으려면 ${krDate(yearEndBiz())}까지 넣어야 해요(D-${A.dd}). 마지막 날은 이체가 몰리니 며칠 여유 있게 넣으세요.`} ` : ''}${EN ? 'Moving a matured ISA into a pension adds a 10% credit (up to ₩3M). Credit rate follows the salary option in the tax comparison below.' : 'ISA 만기 자금을 연금계좌로 옮기면 옮긴 돈의 10%(최대 300만원)를 추가로 공제받아요. 공제율은 아래 세금 비교의 총급여 선택을 따라가요.'}</p>`;
  }
  function renderAcct() {
    if (!document.getElementById('c-acct')) return;
    const f = (k, label) => `<label class="bn-f"><span>${label}</span><div class="bn-in"><input inputmode="numeric" data-acct="${k}" value="${esc(String(acctCfg[k] ?? ''))}" placeholder="0"><em>${EN ? '×10k ₩' : '만원'}</em></div></label>`;
    card('acct', {
      title: EN ? `🏦 Tax-saving account limits ${THIS_YEAR}` : `🏦 ${THIS_YEAR}년 절세 계좌 한도`, sub: EN ? 'ISA · pension savings · IRP — what’s left this year' : 'ISA · 연금저축 · IRP에 올해 얼마 넣었나요?',
      easy: EN ? 'Enter how much you put into each account this year. We show the limit left and how much more tax you’d get back by filling it before year-end.' : '올해 계좌마다 넣은 돈을 적으면 남은 한도와, 연말까지 채우면 연말정산에서 더 돌려받는 세금을 보여줘요. 1월이 되면 새해 기준으로 비워져요.',
      body: `<div class="bn-grid ac-in">${f('isa', 'ISA')}${f('pen', EN ? 'Pension savings' : '연금저축')}${f('irp', 'IRP')}</div><div id="ac-out">${acctOutHtml()}</div>`,
    });
  }

  // ---------------------------------------------------------------- 💸 금융소득 2천만원 게이지(세금 탭): 올해 받은(받을) 배당(세전) + 이자 → 종합과세 기준까지 얼마나 남았나
  const FIN_KEY = 'cw.fininc';
  let finCfg = (() => { const a = readJSON(FIN_KEY, null); return a && a.y === THIS_YEAR ? a : { y: THIS_YEAR, other: '' }; })();
  function finCalc() {
    const fx = state.quote?.fx?.rate, c = divCfg && fx ? (() => { try { return divCalc(); } catch { return null; } })() : null, Y = String(THIS_YEAR);
    const got = c ? (c.byYear[Y]?.gross || 0) * fx : 0, soon = c ? c.pending.filter((r) => r.pay?.startsWith(Y)).reduce((a, r) => a + r.gross, 0) * fx : 0;
    const other = manIn(finCfg.other) * 1e4, tot = got + soon + other;
    return { has: !!c, got, soon, other, tot, left: 2e7 - tot, ratio: tot / 2e7 };
  }
  function finOutHtml() {
    const F = finCalc(), tone = F.ratio >= 1 ? 'hot' : F.ratio >= 0.7 ? 'warm' : 'ok';
    return `<div class="fi-gauge ${tone}"><div class="fi-bar"><i style="width:${Math.min(100, F.ratio * 100).toFixed(1)}%"></i><em style="left:70%"></em></div>
        <div class="fi-num"><b>${wonFull(F.tot)}</b><span>/ ${wonFull(2e7)}</span></div>
        <p class="fi-msg">${F.ratio >= 1 ? (EN ? '🔴 Over ₩20M — the excess is added to your other income and taxed at your bracket (file in May).' : '🔴 2천만원을 넘었어요. 넘는 부분은 다른 소득과 합쳐 누진세율로 계산돼요(5월 종합소득세 신고).') : F.ratio >= 0.7 ? (EN ? `🟠 ${wonFull(F.left)} left before ₩20M — consider buying more inside ISA or pension accounts.` : `🟠 2천만원까지 ${wonFull(F.left)} 남았어요. 더 사려면 ISA·연금계좌 안에서 사는 걸 고려해 보세요.`) : (EN ? `🟢 Plenty of room — ${wonFull(F.left)} left.` : `🟢 여유 있어요. 2천만원까지 ${wonFull(F.left)} 남았어요.`)}</p></div>
      <ul class="fi-list">
        <li><span>${EN ? 'Dividends received (before tax)' : '올해 받은 배당(세전)'}</span><b>${F.has ? wonFull(F.got) : '–'}</b></li>
        <li><span>${EN ? 'Still to come this year' : '올해 더 받을 배당(예정)'}</span><b>${F.has ? wonFull(F.soon) : '–'}</b></li>
        <li><span>${EN ? 'Interest & other' : '이자·다른 계좌 배당'}</span><b>${wonFull(F.other)}</b></li>
      </ul>
      ${F.has ? '' : `<p class="note">${EN ? 'Enter your holdings in the Dividends tab and they’re added automatically.' : '배당금 탭에 보유 종목을 넣으면 배당이 자동으로 더해져요.'}</p>`}
      <p class="note">${EN ? 'Counts dividends and interest before tax, by payment date. Dividends inside ISA/pension accounts don’t count; gains from US-listed stocks are taxed separately (not included). Gains on Korea-listed overseas ETFs do count.' : '세전 배당·이자를 입금일 기준으로 더해요. ISA·연금계좌 안의 배당은 빠지고, 미국 직투 매매차익은 따로(양도세) 계산돼 들어가지 않아요. 국내 상장 해외 ETF를 팔아 생긴 이익은 들어가요.'}</p>`;
  }
  function renderFinInc() {
    if (!document.getElementById('c-fininc')) return;
    card('fininc', {
      title: EN ? '💸 ₩20M financial income gauge' : '💸 금융소득 2천만원 게이지', sub: EN ? `${THIS_YEAR} dividends + interest · before tax` : `${THIS_YEAR}년 배당 + 이자 · 세전 기준`,
      easy: EN ? 'In Korea, if dividends and interest go over ₩20M in a year, the excess is taxed at your income-tax bracket. This shows how close you are.' : '1년 배당·이자(금융소득)가 2천만원을 넘으면, 넘는 부분은 월급 등 다른 소득과 합쳐 더 높은 세율로 세금을 내요(금융소득종합과세). 올해 얼마나 가까운지 보여줘요.',
      body: `<label class="bn-f fi-in"><span>${EN ? 'Interest & dividends from other accounts' : '예금 이자·다른 계좌 배당(올해)'}</span><div class="bn-in"><input inputmode="numeric" data-fin="other" value="${esc(String(finCfg.other ?? ''))}" placeholder="0"><em>${EN ? '×10k ₩' : '만원'}</em></div></label><div id="fi-out">${finOutHtml()}</div>`,
    });
  }

  // ---------------------------------------------------------------- ⚖️ 리밸런싱 도우미(퇴사까지): 목표 비중 + 이번 달 넣을 돈 → 어떤 종목을 몇 주 사면 비중이 맞나(팔지 않고 사기만)
  const REBAL_KEY = 'cw.rebal';
  let rebalCfg = Object.assign({ t: {}, cash: 100 }, readJSON(REBAL_KEY, {}) || {});
  let rebalLast = null;
  function rebalCalc(c) {
    if (!c?.rows?.length || !c.fx) return null;
    const rows = c.rows.filter((r) => r.shares > 0 && r.valueUsd > 0).map((r) => ({ t: r.ticker, cur: r.valueUsd * c.fx, px: (r.valueUsd * c.fx) / r.shares }));
    const tot0 = rows.reduce((a, r) => a + r.cur, 0);
    if (!rows.length || !(tot0 > 0)) return null;
    for (const r of rows) { r.now = r.cur / tot0; const v = rebalCfg.t[r.t]; r.w = v == null || v === '' ? Math.round(r.now * 100) : Math.max(0, +v || 0); }
    const wSum = rows.reduce((a, r) => a + r.w, 0) || 1, cash = manIn(rebalCfg.cash) * 1e4, T = tot0 + cash;
    for (const r of rows) { r.tg = r.w / wSum; r.need = Math.max(0, r.tg * T - r.cur); r.n = 0; }
    const D = rows.reduce((a, r) => a + r.need, 0);
    if (D > 0) for (const r of rows) r.n = Math.floor((cash * (r.need / D)) / r.px);
    let left = cash - rows.reduce((a, r) => a + r.n * r.px, 0);
    for (let k = 0; k < 500; k++) { // 남은 돈으로 아직 모자란 종목을 한 주씩 더
      const gap = (r) => r.tg * T - (r.cur + r.n * r.px);
      const pick = rows.filter((r) => r.px <= left && gap(r) > r.px * 0.5).sort((a, b) => gap(b) - gap(a))[0];
      if (!pick) break;
      pick.n++; left -= pick.px;
    }
    const T1 = tot0 + cash - left;
    for (const r of rows) { r.buy = r.n * r.px; r.after = (r.cur + r.buy) / T1; }
    return { rows: rows.sort((a, b) => b.tg - a.tg), cash, left, wSum, over: rows.filter((r) => r.now - r.tg > 0.05) };
  }
  function rebalOutHtml(c) {
    const R = rebalCalc(c);
    rebalLast = R;
    if (!R) return '';
    const buys = R.rows.filter((r) => r.n > 0), nm = (t) => (krTk(t) ? fireName(t) : t);
    return `${R.cash > 0 ? (buys.length ? `<ul class="rb-buy">${buys.map((r) => `<li><b>${esc(nm(r.t))}</b><span>${nf(0).format(r.n)}${EN ? ' sh' : '주'}</span><small>≈ ${wonFull(r.buy)}</small></li>`).join('')}</ul>` : `<p class="note">${EN ? 'This amount isn’t enough for even one share of the stocks that are under target.' : '이 금액으로는 목표보다 모자란 종목을 한 주도 살 수 없어요.'}</p>`) : ''}
      <div class="div-scroll"><table class="div-tbl rb-tbl"><thead><tr><th>${EN ? 'Stock' : '종목'}</th><th>${EN ? 'Now' : '지금'}</th><th>${EN ? 'Target' : '목표'}</th><th>${EN ? 'After' : '산 뒤'}</th></tr></thead><tbody>
        ${R.rows.map((r) => `<tr><td><b>${esc(nm(r.t))}</b></td><td>${pctPlain(r.now, 1)}</td><td>${pctPlain(r.tg, 1)}</td><td class="${Math.abs(r.after - r.tg) < Math.abs(r.now - r.tg) ? 'up' : ''}">${pctPlain(r.after, 1)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">${R.cash > 0 ? (EN ? `Left over ${wonFull(R.left)}. ` : `남는 돈 ${wonFull(R.left)}. `) : ''}${R.over.length ? (EN ? `${R.over.map((r) => nm(r.t)).join(', ')} is well over target — buying alone may take a while to fix it. ` : `${R.over.map((r) => esc(nm(r.t))).join(', ')}은(는) 목표보다 5%p 넘게 많아요. 사기만 해서는 맞추는 데 시간이 걸려요. `) : ''}${EN ? 'Buys only (no selling, so no tax). Whole shares at today’s price.' : '팔지 않고 사기만 해서 맞춰요(세금 걱정 없음). 지금 가격, 1주 단위 기준이에요.'}</p>`;
  }
  function renderRebal(c) {
    const el = document.getElementById('c-rebal');
    if (!el) return;
    if (!c?.rows?.length) { el.hidden = true; return; }
    el.hidden = false;
    const rows = c.rows.filter((r) => r.shares > 0 && r.valueUsd > 0), tot = rows.reduce((a, r) => a + r.valueUsd, 0) || 1, nm = (t) => (krTk(t) ? fireName(t) : t);
    card('rebal', {
      title: EN ? '⚖️ Rebalancing helper' : '⚖️ 리밸런싱 도우미', sub: EN ? 'Set target weights → what to buy with this month’s money' : '목표 비중을 정하면 이번 달 넣을 돈으로 뭘 몇 주 살지 알려줘요',
      easy: EN ? 'Pick the mix you want (e.g. 60/40). With the money you add this month, we tell you which stocks to buy and how many shares to get closer to it — without selling.' : '원하는 비중(예: 6:4)을 정해 두면, 이번 달 넣을 돈으로 어떤 종목을 몇 주 사야 그 비중에 가까워지는지 알려줘요. 팔지 않으니 세금이 생기지 않아요.',
      body: `<div class="rb-in">${rows.map((r) => `<label class="rb-row"><b>${esc(nm(r.ticker))}</b><small>${EN ? 'now' : '지금'} ${pctPlain(r.valueUsd / tot, 0)}</small><div class="bn-in"><input inputmode="numeric" maxlength="3" data-rebal="${esc(r.ticker)}" value="${esc(String(rebalCfg.t[r.ticker] ?? Math.round((r.valueUsd / tot) * 100)))}" aria-label="${esc(nm(r.ticker))} ${EN ? 'target' : '목표 비중'}"><em>%</em></div></label>`).join('')}</div>
        <label class="bn-f rb-cash"><span>${EN ? 'Money to add this month' : '이번 달 넣을 돈'}</span><div class="bn-in"><input inputmode="numeric" data-rebal-cash="1" value="${esc(String(rebalCfg.cash ?? ''))}"><em>${EN ? '×10k ₩' : '만원'}</em></div></label>
        <div id="rb-out">${rebalOutHtml(c)}</div>`,
    });
  }
  function rebalRefresh() {
    const c = fireCfg && state.quote ? (() => { try { return fireCalc(); } catch { return null; } })() : null, o = document.getElementById('rb-out');
    if (o) o.innerHTML = rebalOutHtml(c);
  }


  // ---------------------------------------------------------------- 📊 내 수익률 vs 시장(퇴사까지): 지금 보유 종목·수량 그대로 들고 있었다면 vs S&P500(원화 환산)·코스피
  // 종목·지수마다 일봉 1년치(/chart r=3m)를 한 번 받아 날짜를 맞추고, 같은 기간 수익률을 비교한다. 중간 매매·배당은 넣지 않는다(가격 수익률).
  const BENCH_RANGES = { '1m': [31, '1개월', '1M'], '3m': [92, '3개월', '3M'], '6m': [183, '6개월', '6M'], '1y': [366, '1년', '1Y'], ytd: [0, '올해', 'YTD'] };
  state.bench = {}; state.benchRange = loadPref('benchRange', '3m');
  const benchSyms = (c) => [...new Set([...(c?.rows || []).filter((r) => r.shares > 0).map((r) => r.ticker), '^GSPC', '^KS11', 'KRW=X'])];
  function benchLoad(c, done) {
    let pend = 0;
    for (const sym of benchSyms(c)) {
      if (state.bench[sym]) continue;
      state.bench[sym] = { loading: true }; pend++;
      getJ(`${NEWS_API}/chart?s=${encodeURIComponent(sym)}&r=3m`, 15000)
        .then((j) => { const m = new Map(); for (const p of j.points || []) if (p[1] != null) m.set(new Date(p[0]).toISOString().slice(0, 10), p[1]); state.bench[sym] = j.error || !m.size ? { err: true } : { m, t: Date.now() }; })
        .catch(() => { state.bench[sym] = { err: true }; })
        .finally(() => { if (--pend === 0) done?.(); });
    }
    return pend;
  }
  // from~to(포함) 사이: 날짜별 내 포트폴리오(원화) · S&P500(원화 환산) · 코스피, 기간 수익률, 종목별 수익률
  function benchCalc(c, from, to = isoToday()) {
    const H = (c?.rows || []).filter((r) => r.shares > 0), B = state.bench, fx = B['KRW=X']?.m, sp = B['^GSPC']?.m, ks = B['^KS11']?.m;
    if (!H.length || !fx || !sp || !ks) return null;
    const ok = H.filter((r) => B[r.ticker]?.m), miss = H.filter((r) => !B[r.ticker]?.m).map((r) => r.ticker);
    if (!ok.length) return null;
    const days = [...new Set([...sp.keys(), ...ks.keys(), ...ok.flatMap((r) => [...B[r.ticker].m.keys()])])].filter((d) => d >= from && d <= to).sort();
    const last = {}, ff = (k, m, d) => { const v = m.get(d); if (v != null) last[k] = v; return last[k]; };
    // 기간 시작 전 마지막 값으로 시작값을 채운다(시작일이 휴장일이어도)
    for (const [k, m] of [['fx', fx], ['sp', sp], ['ks', ks], ...ok.map((r) => [r.ticker, B[r.ticker].m])]) { const prev = [...m.keys()].filter((d) => d < from).sort().at(-1); if (prev) last[k] = m.get(prev); }
    const rows = [];
    for (const d of days) {
      const X = ff('fx', fx, d), S = ff('sp', sp, d), K = ff('ks', ks, d);
      const px = ok.map((r) => ff(r.ticker, B[r.ticker].m, d));
      if (X == null || S == null || K == null || px.some((v) => v == null)) continue; // 모든 종목 가격이 생긴 날부터
      rows.push({ d, my: ok.reduce((a, r, i) => a + r.shares * px[i] * (r.kr ? 1 : X), 0), sp: S * X, ks: K, px, X });
    }
    if (rows.length < 2) return null;
    const a = rows[0], z = rows.at(-1), R = (k) => z[k] / a[k] - 1;
    const per = ok.map((r, i) => ({ t: r.ticker, r: (z.px[i] * (r.kr ? 1 : z.X)) / (a.px[i] * (r.kr ? 1 : a.X)) - 1 })).sort((x, y) => y.r - x.r);
    return { rows, start: a.d, end: z.d, my: R('my'), sp: R('sp'), ks: R('ks'), per, miss, late: a.d > from };
  }
  const benchFrom = (rg) => (rg === 'ytd' ? `${new Date().getFullYear()}-01-01` : addDays(isoToday(), -BENCH_RANGES[rg][0]));
  function renderBench(c) {
    const el = document.getElementById('c-bench');
    if (!el) return;
    if (!c?.rows?.some((r) => r.shares > 0)) { el.hidden = true; return; }
    el.hidden = false;
    if (benchLoad(c, () => { const c2 = fireCfg && state.quote ? (() => { try { return fireCalc(); } catch { return null; } })() : null; renderBench(c2); })) { if (!el.innerHTML) card('bench', { title: EN ? '📊 My return vs the market' : '📊 내 수익률 vs 시장', body: `<p class="skeleton">${EN ? 'Loading prices…' : '가격 기록 불러오는 중…'}</p>` }); return; }
    const rg = BENCH_RANGES[state.benchRange] ? state.benchRange : '3m', R = benchCalc(c, benchFrom(rg));
    const nm = (t) => (krTk(t) ? fireName(t) : t);
    const gap = R ? R.my - R.sp : null;
    card('bench', {
      title: EN ? '📊 My return vs the market' : '📊 내 수익률 vs 시장',
      sub: EN ? 'Current holdings over the period · in KRW' : '지금 보유 종목·수량 그대로 들고 있었다면 · 원화 기준',
      easy: EN ? 'We take the stocks and share counts you hold now and replay their prices over the period, then compare with the S&P 500 (converted to won) and the KOSPI. Trades in between and dividends are not included.' : '지금 갖고 있는 종목과 수량을 그대로 들고 있었다고 보고 기간 동안의 가격 변화를 계산해, 같은 기간 S&P500(원화로 환산)·코스피와 비교해요. 중간에 사고판 것과 배당은 넣지 않았어요.',
      share: R ? 'bench' : null,
      body: R ? `<p class="bm-verdict">${gap >= 0 ? '🎉 ' : ''}${EN ? `${gap >= 0 ? 'Ahead of' : 'Behind'} the S&P 500 by <b class="${cls(gap)}">${Math.abs(gap * 100).toFixed(1)}%p</b>` : `S&P500보다 <b class="${cls(gap)}">${Math.abs(gap * 100).toFixed(1)}%p</b> ${gap >= 0 ? '앞서고 있어요' : '뒤처져 있어요'}`}</p>
        <div class="seg range bm-rg" role="group">${Object.entries(BENCH_RANGES).map(([k, v]) => `<button type="button" data-benchrange="${k}" aria-pressed="${k === rg}">${EN ? v[2] : v[1]}</button>`).join('')}</div>
        <div class="bm-sum">
          <div class="me"><span>${EN ? 'My stocks' : '내 종목'}</span><b class="${cls(R.my)}">${pct(R.my, 1)}</b></div>
          <div><span>${EN ? 'S&P 500 (KRW)' : 'S&P500(원화)'}</span><b class="${cls(R.sp)}">${pct(R.sp, 1)}</b></div>
          <div><span>${EN ? 'KOSPI' : '코스피'}</span><b class="${cls(R.ks)}">${pct(R.ks, 1)}</b></div>
        </div>
        <div class="chart bm-chart"><canvas id="cv-bench" role="img" aria-label="${EN ? 'Return comparison' : '수익률 비교'}"></canvas></div>
        ${R.per.length > 1 ? `<p class="bm-per">${EN ? 'Best' : '가장 많이 오른 종목'} <b>${esc(nm(R.per[0].t))} <span class="${cls(R.per[0].r)}">${pct(R.per[0].r, 1)}</span></b> · ${EN ? 'worst' : '가장 약한 종목'} <b>${esc(nm(R.per.at(-1).t))} <span class="${cls(R.per.at(-1).r)}">${pct(R.per.at(-1).r, 1)}</span></b></p>` : ''}
        <p class="note">${EN ? `${R.start} → ${R.end}.` : `${R.start} → ${R.end} 기준.`}${R.late ? (EN ? ' Starts later because a holding listed recently.' : ' 최근 상장한 종목이 있어 그 종목 가격이 생긴 날부터 비교했어요.') : ''}${R.miss.length ? (EN ? ` Left out (no price history): ${R.miss.map(nm).join(', ')}.` : ` 가격 기록을 못 받아 뺀 종목: ${R.miss.map(nm).join(', ')}.`) : ''} ${EN ? 'Price return only — trades and dividends not included.' : '가격 수익률이라 중간 매매·배당은 들어가지 않아요.'}</p>`
        : `<p class="note">${EN ? 'Not enough price history for this period yet.' : '이 기간의 가격 기록이 아직 부족해요.'}</p>`,
    });
    if (R) {
      const lab = R.rows.map((x) => x.d), a = R.rows[0];
      draw('bench', { type: 'line', data: { labels: lab, datasets: [
        lineDs(EN ? 'My stocks' : '내 종목', R.rows.map((x) => (x.my / a.my - 1) * 100), C.orange, { borderWidth: 2.4 }),
        lineDs('S&P500', R.rows.map((x) => (x.sp / a.sp - 1) * 100), C.blue, { borderWidth: 1.6 }),
        lineDs(EN ? 'KOSPI' : '코스피', R.rows.map((x) => (x.ks / a.ks - 1) * 100), C.teal, { borderWidth: 1.6 }),
      ] }, options: { interaction, plugins: { legend: { display: true, labels: { boxWidth: 10, boxHeight: 2, font: { size: 11 } } }, tooltip: tooltip((it) => lab[it.dataIndex], (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`) },
        scales: { x: axisX(lab, (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`, 5), y: axisY((v) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`) } } });
    }
  }

  // ---------------------------------------------------------------- 🔔 알림함: 목표가 도달 · 실적 발표 · 배당 입금 · 새 공시를 한곳에(최근 7일). 열면 모두 읽음
  const NOTI_KEY = 'cw.notiSeen';
  let notiSeen = readJSON(NOTI_KEY, {}) || {};
  const FORM_KO = { '8-K': '주요 사항 공시', '10-Q': '분기 보고서', '10-K': '연간 보고서' };
  function notiItems() {
    const out = [], now = Date.now(), wk = 7 * 864e5;
    for (const [sym, T] of Object.entries(targets)) if (T.hit && now - T.hit < wk) out.push({ id: `tgt:${sym}:${T.hit}`, t: T.hit, ic: '🎯', title: EN ? `${nameOfSym(sym)} hit your target ${pxS(sym, T.p)}` : `${nameOfSym(sym)} 목표가 ${pxS(sym, T.p)} 도달`, sub: `${EN ? 'at' : '도달 가격'} ${pxS(sym, T.hitPx)}`, go: { sym, v: 'chart' } });
    for (const sym of WATCH) {
      let D = null; try { D = earnDay(sym); } catch {}
      if (!D) continue;
      if (D.phase === 'pre' && D.N?.date) out.push({ id: `ep:${sym}:${D.N.date}`, t: Date.parse(D.N.date + 'T00:00:00Z'), ic: '🔔', title: EN ? `${nameOfSym(sym)} reports ${dday(D.N.date) <= 0 ? 'today' : 'tomorrow'}` : `${nameOfSym(sym)} 실적 발표 ${dday(D.N.date) <= 0 ? '오늘' : '내일'}`, sub: D.time ? (D.time === 'BMO' ? (EN ? 'before the US open' : '미국 장 시작 전') : (EN ? 'after the US close' : '미국 장 마감 뒤')) : (EN ? 'time TBD' : '시간 미정'), go: { sym, v: 'earn' } });
      else if (D.phase === 'post') { const sur = (D.E.surprises || []).find((x) => x.end === D.lastQ?.end), eps = D.fq?.eps ?? sur?.eps, est = D.fq?.epsEst ?? sur?.consensus; out.push({ id: `er:${sym}:${D.lastQ?.end}`, t: D.repMs || now, ic: '📊', title: EN ? `${nameOfSym(sym)} earnings are out` : `${nameOfSym(sym)} 실적 발표됨`, sub: eps != null && est != null ? (EN ? `EPS $${(+eps).toFixed(2)} vs $${(+est).toFixed(2)} expected` : `EPS $${(+eps).toFixed(2)} · 예상 $${(+est).toFixed(2)} ${eps >= est ? '상회' : '하회'}`) : (EN ? 'See the results' : '결과 보기'), go: { sym, v: 'earn' } }); }
    }
    const c = divCfg ? (() => { try { return divCalc(); } catch { return null; } })() : null;
    if (c) {
      const today = isoToday();
      for (const r of c.received) if (r.pay >= addDays(today, -3)) out.push({ id: `dv:${r.sym}:${r.pay}`, t: Date.parse(r.pay + 'T09:00:00+09:00'), ic: '💰', title: EN ? `${fireName(r.sym)} dividend paid` : `${fireName(r.sym)} 배당 입금`, sub: `${usd2(r.gross * (1 - c.tax))} · ${krDate(r.pay)}`, go: { tab: 'div' } });
      for (const x of divCalendar(c)) if (x.pay <= addDays(today, 2)) out.push({ id: `dn:${x.sym}:${x.pay}`, t: Date.parse(x.pay + 'T09:00:00+09:00'), ic: '💰', title: EN ? `${fireName(x.sym)} dividend coming` : `${fireName(x.sym)} 배당 입금 예정`, sub: `${usd2(x.net)}${x.est ? (EN ? ' (est.)' : ' (예상)') : ''} · ${krDate(x.pay)}`, go: { tab: 'div' } });
    }
    for (const sym of WATCH) {
      if (isKR(sym)) continue;
      const fl = (sym === 'CRCL' ? state.data?.news?.filings : st(sym).news?.filings) || [];
      for (const f of fl.slice(0, 6)) {
        const form = (String(f.form).match(/^(8-K|10-Q|10-K)/) || [])[1], t = Date.parse(f.d);
        if (form && now - t < 3 * 864e5) out.push({ id: `fl:${sym}:${f.form}:${f.d}`, t, ic: '📄', title: EN ? `${nameOfSym(sym)} filed a ${form}` : `${nameOfSym(sym)} 새 공시 · ${FORM_KO[form]}`, sub: `${f.form} · ${md(isoToTs(f.d.slice(0, 10)))}`, go: { sym, v: 'news' } });
      }
    }
    const seen = new Set();
    return out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id))).sort((a, b) => b.t - a.t).slice(0, 30);
  }
  function updateBell() {
    const b = document.getElementById('bell-n');
    if (!b) return;
    let n = 0; try { n = notiItems().filter((x) => !notiSeen[x.id]).length; } catch {}
    b.textContent = n > 9 ? '9+' : String(n);
    b.hidden = !n;
    document.getElementById('bell-btn')?.setAttribute('aria-label', EN ? `Notifications${n ? `, ${n} new` : ''}` : `알림${n ? ` 새 소식 ${n}개` : ''}`);
  }
  function goTarget(go) {
    if (go.tab) { state.fireTab = go.tab; savePref('fireTab', go.tab); showView('fire'); window.scrollTo({ top: 0 }); return; }
    if (go.sym && WATCH.includes(go.sym)) setStock(go.sym);
    const ic = { chart: 'chart', earn: 'earn', news: 'news' }[go.v];
    const t = TAB_SETS[state.stock].find(([, , i]) => i === ic);
    showView(t ? t[0] : 'home');
    window.scrollTo({ top: 0 });
  }
  function openBell() {
    let el = document.getElementById('nt-sheet');
    if (!el) { el = document.createElement('div'); el.id = 'nt-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el); }
    el.setAttribute('aria-label', EN ? 'Notifications' : '알림');
    const L = notiItems(), ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 0 ? (EN ? 'upcoming' : '예정') : m < 60 ? (EN ? `${Math.max(1, m)}m ago` : `${Math.max(1, m)}분 전`) : m < 1440 ? (EN ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 60)}시간 전`) : (EN ? `${Math.round(m / 1440)}d ago` : `${Math.round(m / 1440)}일 전`); };
    el.innerHTML = `<div class="sheet-bg" data-ntclose="1"></div><div class="sheet-panel nt-panel">
      <div class="sheet-h"><b>🔔 ${EN ? 'Notifications' : '알림'}</b><button type="button" class="ws-btn" data-ntclose="1">${EN ? 'Close' : '닫기'}</button></div>
      ${L.length ? `<ul class="nt-list">${L.map((x, i) => `<li><button type="button" class="nt-row${notiSeen[x.id] ? '' : ' new'}" data-ntgo="${i}"><span class="nt-ic" aria-hidden="true">${x.ic}</span><span class="nt-tx"><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></span><em>${ago(x.t)}</em></button></li>`).join('')}</ul>`
        : `<p class="nt-empty">${EN ? 'Nothing new this week. Targets you hit, earnings, dividends and new filings for your stocks show up here.' : '최근 7일 동안 새 소식이 없어요. 목표가 도달·실적 발표·배당 입금·새 공시가 생기면 여기에 모여요.'}</p>`}
    </div>`;
    el._items = L;
    el.hidden = false; document.body.classList.add('sheet-open');
    for (const x of L) notiSeen[x.id] = Date.now(); // 열면 모두 읽음
    for (const [k, v] of Object.entries(notiSeen)) if (Date.now() - v > 30 * 864e5) delete notiSeen[k];
    writeJSON(NOTI_KEY, notiSeen); updateBell();
  }
  function closeBell() { const el = document.getElementById('nt-sheet'); if (el) el.hidden = true; document.body.classList.remove('sheet-open'); }

  // ---------------------------------------------------------------- 📢 실적 시즌 카드(홈 맨 위): 내 종목 중 오늘·내일 발표하거나 방금 발표한 종목만 자동으로, 누르면 그 종목 실적 화면
  function renderSeason() {
    const el = document.getElementById('c-season');
    if (!el) return;
    const rows = [];
    for (const sym of WATCH) { let D = null; try { D = earnDay(sym); } catch {} if (D) rows.push({ sym, D }); }
    el.hidden = !rows.length;
    if (!rows.length) return;
    const line = ({ sym, D }) => {
      if (D.phase === 'pre') {
        const when = dday(D.N.date) <= 0 ? (EN ? 'Today' : '오늘') : (EN ? 'Tomorrow' : '내일');
        const t = D.time ? (D.time === 'BMO' ? (EN ? 'before open' : '장 시작 전') : (EN ? 'after close' : '장 마감 뒤')) : (EN ? 'time TBD' : '시간 미정');
        return `<span class="ss-tag pre">${when}</span><span class="se-m">${t}${D.N.consensus != null ? ` · ${EN ? 'EPS est.' : '예상 EPS'} $${D.N.consensus.toFixed(2)}` : ''}</span>`;
      }
      const sur = (D.E.surprises || []).find((x) => x.end === D.lastQ?.end), eps = D.fq?.eps ?? sur?.eps, est = D.fq?.epsEst ?? sur?.consensus, s2 = eps != null && est ? (eps - est) / Math.abs(est) : null, p = stockPx(sym);
      return `<span class="ss-tag post">${EN ? 'Out' : '발표됨'}</span><span class="se-m">${s2 != null ? `EPS <b class="${cls(s2)}">${s2 >= 0 ? (EN ? 'beat' : '상회') : (EN ? 'miss' : '하회')} ${pct(s2, 0)}</b> · ` : ''}${EN ? 'stock' : '주가'} <b class="${cls(p?.pct)}">${p?.pct != null ? pct(p.pct, 1) : '–'}</b></span>`;
    };
    card('season', {
      title: EN ? '📢 Earnings in your stocks' : '📢 내 종목 실적 발표',
      sub: EN ? 'Tap a stock for the full results' : '누르면 그 종목 실적 화면으로 가요',
      body: `<ul class="se-list">${rows.map((r) => `<li><button type="button" class="se-row" data-segoto="${esc(r.sym)}"><b>${esc(nameOfSym(r.sym))}</b>${line(r)}<i aria-hidden="true">›</i></button></li>`).join('')}</ul>`,
    });
  }

  // ---------------------------------------------------------------- 🎁 연말 결산(12월~1월 중순 홈 맨 위 · ?recap=1로 미리 보기): 올해 수익률·배당·퇴사 진행·절세를 한 장으로, 이미지 공유
  const RECAP_FORCE = /[?&]recap=1\b/.test(location.search);
  const recapYear = () => { const d = new Date(); return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); };
  const recapOpen = () => { if (RECAP_FORCE) return true; const d = new Date(); return d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 15); };
  function recapData() {
    const Y = recapYear(), out = { Y };
    const c = fireCfg && state.quote ? (() => { try { return fireCalc(); } catch { return null; } })() : null;
    if (c) { benchLoad(c, () => renderRecap()); out.R = benchCalc(c, `${Y}-01-01`, `${Y}-12-31`); }
    const H = fireHist.filter((h) => h.d?.startsWith(String(Y)));
    if (H.length >= 2) out.prog = { from: H[0].p, to: H.at(-1).p, since: H[0].d };
    const dc = divCfg ? (() => { try { return divCalc(); } catch { return null; } })() : null, fx = state.quote?.fx?.rate;
    if (dc?.byYear?.[Y]) out.div = { usd: dc.byYear[Y].gross * (1 - dc.tax), krw: fx ? dc.byYear[Y].gross * (1 - dc.tax) * fx : null, n: dc.byYear[Y].n };
    if (acctCfg.y === Y) { const A = acctCalc(); if (A.isa || A.elig) out.acct = A; }
    if (manIn(taxCfg.amt) > 0 && Y === new Date().getFullYear()) out.tax = taxCalc();
    return out;
  }
  function renderRecap() {
    const el = document.getElementById('c-recap');
    if (!el) return;
    if (!recapOpen()) { el.hidden = true; return; }
    const D = recapData(), nm = (t) => (krTk(t) ? fireName(t) : t), R = D.R;
    const tiles = [
      R && `<div class="rc-hero"><span>${EN ? `${D.Y} return (my stocks)` : `${D.Y}년 내 종목 수익률`}</span><b class="${cls(R.my)}">${pct(R.my, 1)}</b><small>S&P500 ${pct(R.sp, 1)} · ${EN ? 'KOSPI' : '코스피'} ${pct(R.ks, 1)}</small></div>`,
      R?.per.length > 1 && `<div><span>${EN ? 'Best stock' : '올해의 종목'}</span><b>${esc(nm(R.per[0].t))}</b><small class="${cls(R.per[0].r)}">${pct(R.per[0].r, 1)}</small></div>`,
      D.div && `<div><span>${EN ? 'Dividends received' : '올해 받은 배당(세후)'}</span><b>${usd2(D.div.usd)}</b><small>${D.div.krw ? `≈ ${wonFull(D.div.krw)} · ` : ''}${D.div.n}${EN ? ' payouts' : '번'}</small></div>`,
      D.prog && `<div><span>${EN ? 'FIRE progress' : '퇴사 진행률'}</span><b>${(D.prog.to * 100).toFixed(1)}%</b><small>${(D.prog.from * 100).toFixed(1)}% → ${EN ? `since ${D.prog.since}` : `${krDate(D.prog.since)}부터`}</small></div>`,
      D.acct && `<div><span>${EN ? 'Tax credit back' : '연말정산 환급(예상)'}</span><b>${wonFull(D.acct.refund)}</b><small>ISA ${wonFull(D.acct.isa * 1e4)} · ${EN ? 'pension' : '연금'} ${wonFull(D.acct.elig * 1e4)}</small></div>`,
      D.tax && `<div><span>${EN ? 'Capital gains tax' : '해외주식 양도세(예상)'}</span><b>${D.tax.tax > 0 ? wonFull(D.tax.tax) : (EN ? 'None' : '없음')}</b><small>${EN ? 'net realized' : '실현 손익'} ${signed(D.tax.real, wonFull)}</small></div>`,
    ].filter(Boolean);
    el.hidden = !tiles.length;
    if (!tiles.length) return;
    card('recap', {
      title: EN ? `🎁 My ${D.Y} in review` : `🎁 ${D.Y}년 내 투자 결산`, sub: EN ? 'Your year on one page' : '올 한 해를 한 장으로',
      share: 'recap',
      body: `<div class="rc-grid">${tiles.join('')}</div><p class="note">${EN ? 'Return assumes your current holdings over the year (price only). Dividends from the Dividends tab, tax from the Tax tab.' : '수익률은 지금 보유 종목·수량을 1년 내내 들고 있었다고 본 가격 수익률이에요. 배당은 배당금 탭, 절세·양도세는 세금 탭에 넣은 값이에요.'}</p>`,
    });
  }

  // ---------------------------------------------------------------- 🇰🇷 한국 종목 다음 실적 발표일(네이버 증권 캘린더, 앞으로 6주)
  state.krNext = {};
  function krNextEarn(sym) {
    const code = sym.slice(0, 6), X = state.krNext[code];
    if (!X) {
      state.krNext[code] = { loading: true };
      const from = isoToday(), to = addDays(from, 41);
      getJ(`${NEWS_API}/calendar?from=${from}&to=${to}&kr=${code}&macro=0`, 12000)
        .then((j) => { state.krNext[code] = { e: (j.events || []).find((e) => e.kind === 'earn' && e.code === code) || null }; if (state.stock === sym) renderKrEarn(sym); })
        .catch(() => { state.krNext[code] = { e: null }; });
      return '';
    }
    const e = X.e;
    if (!e) return '';
    const dd = daysBetween(isoToday(), e.d);
    return `<div class="er-next kr-next"><div class="er-next-h"><span>${EN ? 'Next earnings' : '다음 실적 발표'}</span><span class="tone neu">${EN ? 'scheduled' : '예정'}</span></div><div class="er-next-d"><b>${krDate(e.d)}</b><span class="er-dday">${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : ''}</span></div><div class="er-next-m">${esc(e.k)} · ${EN ? 'Naver Securities calendar' : '네이버 증권 증시 캘린더'}</div></div>`;
  }

  // ---------------------------------------------------------------- 🎯 목표가: 종목 주가 카드에서 정해 두면, 도달했을 때 알려 주고 홈 '바뀐 것'에 보여 준다(이 기기에만 저장)
  const TGT_KEY = 'cw.targets';
  let targets = DEMO ? { CRCL: { p: 120, dir: 'up', at: Date.now() }, JOBY: { p: 8, dir: 'up', at: Date.now() } } : readJSON(TGT_KEY, {}) || {};
  const tgtCur = (sym) => (isKR(sym) ? (EN ? '₩' : '원') : '$');
  function tgtHtml(sym) {
    const T = targets[sym], x = pxOf(sym);
    if (!T) return `<button type="button" class="tgt-set" data-tgt="${esc(sym)}">🎯 ${EN ? 'Set a target price' : '목표가 정해 두기'}<small>${EN ? 'We’ll tell you when it gets there' : '도달하면 알려 드려요'}</small></button>`;
    const left = x ? T.p / x - 1 : null;
    return `<div class="tgt-line${T.hit ? ' hit' : ''}"><span class="tgt-l">🎯 ${EN ? 'Target' : '목표가'} <b>${pxS(sym, T.p)}</b></span><span class="tgt-left">${T.hit ? (EN ? 'Reached ✓' : '도달 ✓') : left != null ? `<span class="${cls(left)}">${pct(left, 1)}</span> ${EN ? 'to go' : '남음'}` : ''}</span><button type="button" class="tgt-ed" data-tgt="${esc(sym)}">${EN ? 'Edit' : '수정'}</button></div>`;
  }
  const tgtHost = (sym) => `<div class="tgt-host" data-tgthost="${esc(sym)}">${tgtHtml(sym)}</div>`;
  function openTgt(sym) {
    const host = document.querySelector(`[data-tgthost="${CSS.escape(sym)}"]`);
    if (!host) return;
    host.innerHTML = `<div class="tgt-form"><span aria-hidden="true">🎯</span><div class="bn-in"><input id="tgt-in" inputmode="decimal" value="${targets[sym]?.p ?? ''}" placeholder="${EN ? 'Target price' : '목표 가격'}" aria-label="${EN ? 'Target price' : '목표 가격'}"><em>${tgtCur(sym)}</em></div>
      <button type="button" class="btn-primary sm" data-tgtsave="${esc(sym)}">${EN ? 'Save' : '저장'}</button>${targets[sym] ? `<button type="button" class="btn-ghost sm" data-tgtdel="${esc(sym)}">${EN ? 'Remove' : '지우기'}</button>` : ''}<button type="button" class="btn-ghost sm" data-tgtx="${esc(sym)}">${EN ? 'Cancel' : '취소'}</button></div>`;
    document.getElementById('tgt-in')?.focus();
  }
  function paintTgt(sym) { const host = document.querySelector(`[data-tgthost="${CSS.escape(sym)}"]`); if (host && !host.querySelector('#tgt-in')) { const h = tgtHtml(sym); if (host.innerHTML !== h) host.innerHTML = h; } }
  function saveTgt(sym, del) {
    if (del) delete targets[sym];
    else {
      const v = parseFloat((document.getElementById('tgt-in')?.value || '').replace(/[,\s$₩원]/g, '')), x = pxOf(sym);
      if (!(v > 0)) { toast(EN ? 'Enter a price' : '가격을 숫자로 넣어 주세요', true); return; }
      targets[sym] = { p: v, dir: x && v < x ? 'down' : 'up', at: Date.now() };
      toast(EN ? `✓ Target ${pxS(sym, v)} saved` : `✓ 목표가 ${pxS(sym, v)} · 도달하면 알려 드려요`);
      markUse('watch');
    }
    writeJSON(TGT_KEY, targets);
    const host = document.querySelector(`[data-tgthost="${CSS.escape(sym)}"]`); if (host) host.innerHTML = tgtHtml(sym);
  }
  function checkTargets() {
    for (const [sym, T] of Object.entries(targets)) {
      const x = pxOf(sym);
      if (!T.hit && x > 0 && (T.dir === 'down' ? x <= T.p : x >= T.p)) {
        T.hit = Date.now(); T.hitPx = x;
        writeJSON(TGT_KEY, targets);
        toast(EN ? `🎯 ${nameOfSym(sym)} hit your target ${pxS(sym, T.p)}` : `🎯 ${nameOfSym(sym)} 목표가 ${pxS(sym, T.p)} 도달!`);
      }
      paintTgt(sym);
    }
  }

  // ---------------------------------------------------------------- 📅 주간 리포트(금요일 오후 4시~월요일): 이번 주(월요일엔 지난주) 내 포트폴리오 · 주요 소식 · 이미지로 공유
  const PXDAY_KEY = 'cw.pxDay';
  let pxDay = readSaved(PXDAY_KEY, {}) || {}, pxDaySavedAt = 0;
  function recordPxDay(px) {
    const d = isoToday();
    pxDay[d] = { ...(pxDay[d] || {}), ...px };
    for (const k of Object.keys(pxDay).sort().slice(0, -21)) delete pxDay[k];
    writeJSON(PXDAY_KEY, pxDay);
  }
  const FORCE_WEEK = /[?&]week=1\b/.test(location.search);
  const weekOpen = () => { if (FORCE_WEEK || DEMO) return true; const d = new Date(Date.now() + 9 * 3600000), wd = d.getUTCDay(); return wd === 6 || wd === 0 || wd === 1 || (wd === 5 && d.getUTCHours() >= 16); };
  const weekMon = () => new Date(Date.now() + 9 * 3600000).getUTCDay() === 1; // 월요일엔 '지난주' 요약
  const weekKey = () => { const d = new Date(Date.now() + 9 * 3600000 - (weekMon() ? 86400000 : 0)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  function weekData(fc) {
    const today = isoToday(), wkAgo = addDays(today, -7), out = {};
    if (DEMO && fc && fireHist.length < 2) recordFireHistory(fc);
    const base = (list) => list.filter((d) => d <= wkAgo).at(-1) || list.find((d) => daysBetween(d, today) >= 3) || null;
    if (fc && fireHist.length) {
      const hd = base(fireHist.map((r) => r.d)), h = hd && fireHist.find((r) => r.d === hd);
      if (h?.v > 0) Object.assign(out, { from: hd, v0: h.v, v1: fc.basis, p0: h.p, p1: fc.progress, r: fc.basis / h.v - 1 });
    }
    const now = {};
    for (const sym of mySyms()) { const x = pxOf(sym); if (x > 0) now[sym] = x; }
    const pd = base(Object.keys(pxDay).sort()), P0 = DEMO ? visit.prev?.v?.px || {} : pd ? pxDay[pd] : null;
    if (P0) { out.movers = Object.keys(now).filter((sym) => P0[sym] > 0).map((sym) => ({ sym, r: now[sym] / P0[sym] - 1 })).filter((m) => Math.abs(m.r) >= 0.001).sort((a, b) => b.r - a.r); out.from ||= pd; }
    const c = divCfg ? (() => { try { return divCalc(); } catch { return null; } })() : null;
    if (c && !c.missing?.length) {
      out.divGot = c.received.filter((r) => r.pay > wkAgo && r.pay <= today);
      out.divNet = out.divGot.reduce((a, r) => a + r.gross, 0) * (1 - c.tax);
      out.divNext = divCalendar(c).filter((x) => { const n = daysBetween(today, x.pay); return n >= 1 && n <= 7; });
    }
    out.earnNext = WATCH.filter((sym) => !isKR(sym)).map((sym) => ({ sym, d: earnOf(sym)?.next?.date })).filter((x) => x.d && dday(x.d) >= 1 && dday(x.d) <= 7);
    out.news = weekNews(wkAgo);
    out.ok = out.r != null || out.movers?.length >= 2 || out.divGot?.length;
    return out;
  }
  // 이번 주 내 종목 주요 소식: 종목마다 1개(회사 발표·AI 요약 있는 것 먼저), 최대 3개
  function weekNews(fromIso) {
    const since = Date.parse(fromIso + 'T00:00:00+09:00'), out = [];
    for (const sym of WATCH) {
      if (!NEWS_UI[sym]) continue;
      let L = [];
      try { L = newsItems(sym).filter((i) => i.kind === 'related' && i.t >= since && i.t <= Date.now() + 3600000); } catch {}
      const best = L.sort((a, b) => (b.base === 'official') - (a.base === 'official') || !!b.sum - !!a.sum || b.t - a.t)[0];
      if (best) out.push({ sym, ...best });
    }
    return out.sort((a, b) => (b.base === 'official') - (a.base === 'official') || b.t - a.t).slice(0, 3);
  }
  let weekAt = 0;
  function renderWeek(fc) {
    const el = document.getElementById('c-week');
    if (!el) return;
    if (!weekOpen() || loadPref('weekClosed', '') === weekKey()) { el.hidden = true; return; }
    if (Date.now() - weekAt < 5000) return;
    weekAt = Date.now();
    const W = weekData(fc);
    if (!W.ok && !(W.news?.length && W.movers?.length)) { el.hidden = true; return; }
    const top = (W.movers || []).filter((m) => m.r > 0).slice(0, 2), low = (W.movers || []).filter((m) => m.r < 0).slice(-2).reverse();
    const chips = (L) => L.map((m) => `<span class="wk-chip"><span>${esc(nameOfSym(m.sym))}</span><b class="${cls(m.r)}">${pct(m.r, 1)}</b></span>`).join('');
    const from = W.from ? `${+W.from.slice(5, 7)}/${+W.from.slice(8)}` : '', to = `${+isoToday().slice(5, 7)}/${+isoToday().slice(8)}`;
    const nxt = [...(W.earnNext || []).map((x) => `${esc(nameOfSym(x.sym))} ${EN ? 'earnings' : '실적'} ${+x.d.slice(5, 7)}/${+x.d.slice(8)}`), ...(W.divNext || []).slice(0, 3).map((x) => `${esc(fireName(x.sym))} ${EN ? 'dividend' : '배당'} ${+x.pay.slice(5, 7)}/${+x.pay.slice(8)}`)];
    el.innerHTML = `<div class="sc-head"><div><h3>📅 ${weekMon() ? (EN ? 'Last week in review' : '지난주 내 포트폴리오') : EN ? 'My week in review' : '이번 주 내 포트폴리오'}</h3><p class="sub">${from ? `${from} ~ ${to} · ` : ''}${EN ? 'Friday evening to Monday' : '매주 금요일 저녁~월요일에 보여요'}</p></div><button type="button" class="sc-x" data-weekclose="1" aria-label="${EN ? 'Dismiss' : '닫기'}">×</button></div>
      ${W.r != null ? `<div class="wk-top"><div><span>${weekMon() ? (EN ? 'Last week' : '지난주 수익률') : EN ? 'This week' : '이번 주 수익률'}</span><b class="${cls(W.r)}">${pct(W.r, 1)}</b><small>${signed(W.v1 - W.v0, wonFull)}</small></div><div><span>${EN ? 'FIRE progress' : '퇴사까지 진행률'}</span><b>${(W.p1 * 100).toFixed(1)}%</b><small class="${cls(W.p1 - W.p0)}">${W.p1 - W.p0 >= 0 ? '+' : ''}${((W.p1 - W.p0) * 100).toFixed(1)}%p</small></div></div>` : ''}
      <ul class="sc-list">
        ${top.length ? `<li><span class="sc-i" aria-hidden="true">🔺</span><div><b>${EN ? 'Top gainers' : '가장 많이 오른 종목'}</b><div class="sc-chips">${chips(top)}</div></div></li>` : ''}
        ${low.length ? `<li><span class="sc-i" aria-hidden="true">🔻</span><div><b>${EN ? 'Biggest decliners' : '가장 많이 내린 종목'}</b><div class="sc-chips">${chips(low)}</div></div></li>` : ''}
        ${W.divGot?.length ? `<li><span class="sc-i" aria-hidden="true">💰</span><div><b>${EN ? 'Dividends received' : '받은 배당'} <span class="up">${usd2(W.divNet)}</span></b><small>${[...new Set(W.divGot.map((r) => fireName(r.sym)))].map(esc).join(' · ')}</small></div></li>` : ''}
        ${W.news?.length ? `<li><span class="sc-i" aria-hidden="true">📰</span><div><b>${EN ? 'Key news' : '내 종목 주요 소식'}</b><ul class="wk-news">${W.news.map((n) => `<li><a href="${safeUrl(n.url)}" target="_blank" rel="noopener"><span><i class="wk-sym">${esc(nameOfSym(n.sym))}</i>${esc(n.title)}</span>${n.sum ? `<small>${esc(n.sum)}</small>` : ''}</a></li>`).join('')}</ul></div></li>` : ''}
        ${nxt.length ? `<li><span class="sc-i" aria-hidden="true">📅</span><div><b>${weekMon() ? (EN ? 'This week' : '이번 주 일정') : EN ? 'Next week' : '다음 주 일정'}</b><small>${nxt.join(' · ')}</small></div></li>` : ''}
      </ul>
      <button type="button" class="share-card-btn" data-sharecard="week"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>${EN ? 'Share as image' : '이미지로 공유'}</button>`;
    el.hidden = false;
  }


  // ---------------------------------------------------------------- 📅 이번 주 일정(홈 맨 위): 경제지표(CPI·PPI·FOMC…) · 내 종목 실적 · 배당 입금
  // 하루에 한 번(그날 처음 들어왔을 때) 보여 준다. 토·일에는 다음 주 일정을 보여 준다
  const SCHED_W = (() => {
    const d = new Date(Date.now() + 9 * 3600000), wd = d.getUTCDay(), next = wd === 6 || wd === 0;
    d.setUTCDate(d.getUTCDate() - ((wd + 6) % 7) + (next ? 7 : 0));
    const from = d.toISOString().slice(0, 10);
    return { from, to: new Date(Date.parse(from + 'T12:00:00Z') + 6 * 86400000).toISOString().slice(0, 10), next };
  })();
  const SCHED_DAY = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜
  const schedShow = DEMO || loadPref('schedDay', '') !== SCHED_DAY;
  let schedClosed = false, schedMarked = false, schedLoading = null;
  state.sched = readJSON('cw.schedCache', null);
  if (state.sched?.from !== SCHED_W.from) state.sched = null;
  function loadSched() {
    if (!schedShow || schedLoading) return schedLoading;
    if (state.sched && Date.now() - Date.parse(state.sched.got || 0) < 3 * 3600000) return Promise.resolve(state.sched);
    const krc = mySyms().filter(isKR).map((x) => x.slice(0, 6)).slice(0, 30).join(',');
    schedLoading = getJ(`${NEWS_API}/calendar?from=${SCHED_W.from}&to=${SCHED_W.to}${krc ? `&kr=${krc}` : ''}`, 12000)
      .then((j) => { if (Array.isArray(j?.events)) { state.sched = { ...j, from: SCHED_W.from, got: new Date().toISOString() }; writeJSON('cw.schedCache', state.sched); } })
      .catch(() => {}).finally(() => { schedLoading = null; renderSched(); });
    return schedLoading;
  }
  const SCHED_EN = { 'FOMC 금리 결정': 'FOMC rate decision', 'CPI(소비자물가)': 'CPI (inflation)', 'PPI(생산자물가)': 'PPI (producer prices)', '고용보고서(비농업 고용)': 'Jobs report (payrolls)', 'PCE 물가': 'PCE inflation', 'GDP 성장률': 'GDP', '소매판매': 'Retail sales', 'ISM 제조업 지수': 'ISM manufacturing', '실업수당 청구': 'Jobless claims', '한국은행 금리 결정': 'Bank of Korea rate decision', '한국 소비자물가': 'Korea CPI', '한국 수출': 'Korea exports' };
  function renderSched() {
    const el = document.getElementById('c-sched');
    if (!el) return;
    if (!schedShow || schedClosed) { el.hidden = true; return; }
    const { from, to } = SCHED_W, today = isoToday(), items = [];
    for (const e of (state.sched?.events || []).filter((x) => x.kind)) { // 한국 종목 실적·배당(네이버)
      const sym = mySyms().find((x) => isKR(x) && x.startsWith(e.code));
      items.push({ d: e.d, t: '', w: e.w, html: `<span class="sd-ic" aria-hidden="true">${e.kind === 'earn' ? '📊' : '💰'}</span><button type="button" class="sd-nm sd-go" ${sym ? `data-sincego="${esc(sym)}:earn"` : ''}><b>${esc(e.k)}</b>${e.v ? `<small>${EN ? 'per share' : '주당'} ${esc(e.v)}</small>` : ''}</button>` });
    }
    for (const e of (state.sched?.events || []).filter((x) => !x.kind)) items.push({ d: e.d, t: e.t, w: e.w, html: `<span class="sd-ic sd-flag">${e.n === 'KR' ? (EN ? 'KR' : '한국') : (EN ? 'US' : '미국')}</span><span class="sd-nm"><b>${esc(EN ? SCHED_EN[e.k] || e.k : e.k)}</b>${e.v ? `<small>${e.done ? (EN ? 'actual' : '발표') : (EN ? 'prev' : '이전')} ${esc(e.v)}</small>` : ''}</span>` });
    for (const sym of mySyms()) {
      if (isKR(sym) || !STOCK_INFO[sym]) continue;
      const N = earnOf(sym)?.next;
      if (N?.date && N.date >= from && N.date <= to) items.push({ d: N.date, t: EN ? 'US date' : '미국 날짜', w: 2, html: `<span class="sd-ic" aria-hidden="true">📊</span><button type="button" class="sd-nm sd-go" data-sincego="${esc(sym)}:earn"><b>${esc(nameOfSym(sym))} ${EN ? 'earnings' : '실적 발표'}</b><small>${N.consensus != null ? `${EN ? 'est. EPS' : '예상 EPS'} $${N.consensus.toFixed(2)}` : ''}</small></button>` });
    }
    const c = divCfg ? (() => { try { return divCalc(); } catch { return null; } })() : null;
    if (c) for (const x of divCalendar(c)) if (x.pay >= from && x.pay <= to) items.push({ d: x.pay, t: '', w: 1, html: `<span class="sd-ic" aria-hidden="true">💰</span><button type="button" class="sd-nm sd-go" data-ftabgo="div"><b>${esc(fireName(x.sym))} ${EN ? 'dividend paid' : '배당 입금'}</b><small>${usd2(x.net)}${x.declared ? '' : (EN ? ' · est.' : ' · 예상')}</small></button>` });
    if (!items.length) { el.hidden = true; return; }
    const days = {};
    for (const x of items) (days[x.d] ||= []).push(x);
    const wdName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short' });
    const html = `<div class="sc-head"><div><h3>📅 ${SCHED_W.next ? (EN ? 'Next week' : '다음 주 일정') : (EN ? 'This week' : '이번 주 일정')}</h3><p class="sub">${+from.slice(5, 7)}/${+from.slice(8)} ~ ${+to.slice(5, 7)}/${+to.slice(8)} · ${EN ? 'Korea time' : '한국 시간'}</p></div><button type="button" class="sc-x" data-schedclose="1" aria-label="${EN ? 'Dismiss' : '닫기'}">×</button></div>
      <div class="sd-days">${Object.keys(days).sort().map((d) => `<div class="sd-day${d < today ? ' past' : ''}${d === today ? ' today' : ''}"><div class="sd-dh"><b>${+d.slice(5, 7)}/${+d.slice(8)}</b><span>${wdName(d)}</span>${d === today ? `<em>${EN ? 'Today' : '오늘'}</em>` : ''}</div>
        <ul>${days[d].sort((a, b) => (a.t < b.t ? -1 : 1)).map((x) => `<li class="w${x.w}"><span class="sd-t">${esc(x.t)}</span>${x.html}</li>`).join('')}</ul></div>`).join('')}</div>
      <p class="note sd-note">${EN ? 'CPI · PPI = inflation, FOMC = US rate decision. Stocks often swing on these days. Shown once a day.' : 'CPI·PPI는 물가, FOMC는 미국 금리 결정이에요. 발표 날엔 주가가 크게 움직일 수 있어요. 이 카드는 하루에 한 번 보여요.'}</p>`;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
    if (!schedMarked && !DEMO) { schedMarked = true; savePref('schedDay', SCHED_DAY); } // 오늘 한 번 봤으면 오늘은 다시 안 보임(내일 또 보임)
  }

  // ---------------------------------------------------------------- 방문 기록(이 기기에만)
  // 이 기기에만 기록: 3시간 넘게 쉬었다 오면 새 방문으로 보고, 지난 방문 때 마지막으로 본 값(평가금액·주가)과 비교한다
  const VISIT_KEY = 'cw.visit', VISIT_GAP = 3 * 3600000;
  const visit = (() => {
    const now = Date.now();
    let V = readSaved(VISIT_KEY, null);
    if (DEMO) V = { prev: { t: now - 2 * 86400000, seen: now - 2 * 86400000, v: { demo: true, px: {} } }, cur: { t: now, seen: now, v: {} } };
    if (!V?.cur?.t) V = { prev: null, cur: { t: now, seen: now, v: {} } };
    else if (now - (V.cur.seen || V.cur.t) > VISIT_GAP) V = { prev: V.cur, cur: { t: now, seen: now, v: {} } };
    V.cur.v ||= {};
    return V;
  })();
  let visitSavedAt = 0, sinceAt = 0;
  function saveVisit(force) {
    const now = Date.now();
    if (!force && now - visitSavedAt < 20000) return;
    visitSavedAt = now; visit.cur.seen = now;
    writeJSON(VISIT_KEY, visit);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveVisit(true); });
  const mySyms = () => [...new Set([...WATCH, ...(fireCfg?.positions || []).map((p) => p.ticker), ...(divCfg?.hold || []).map((h) => h.t)])];
  const pxOf = (sym) => { try { return (isKR(sym) ? state.krq?.[sym]?.price : null) ?? (STOCK_INFO[sym] ? stockPx(sym)?.price : null) ?? state.quote?.[sym]?.price ?? null; } catch { return null; } };
  const nameOfSym = (sym) => (STOCK_INFO[sym] ? symLabel(sym) : fireName(sym));
  // 방문 기록(주간 리포트용 가격 · 목표가 확인) + 이번 주 일정 카드 — 홈이 갱신될 때마다(3초에 한 번)
  function renderSince(fc) {
    const now = Date.now();
    if (now - sinceAt < 3000) return;
    sinceAt = now;
    // 지금 값 기록(다음 방문 때 비교할 값)
    const V = visit.cur.v, P = visit.prev;
    if (fc) { V.fire = Math.round(fc.basis); V.prog = +fc.progress.toFixed(5); }
    V.px ||= {};
    for (const sym of mySyms()) { const x = pxOf(sym); if (x > 0) V.px[sym] = x; }
    if (P?.v?.demo) { // 예시: 이틀 전 값을 종목마다 조금씩 다르게
      if (fc && P.v.fire == null) { P.v.fire = Math.round(fc.basis * 0.965); P.v.prog = fc.progress * 0.965; }
      for (const [sym, x] of Object.entries(V.px)) if (P.v.px[sym] == null) { let h = 0; for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 997; P.v.px[sym] = x / (1 + ((h % 21) - 8) / 100); }
    }
    saveVisit();
    if (now - pxDaySavedAt > 60000) { pxDaySavedAt = now; recordPxDay(V.px); }
    checkTargets();
    try { renderWeek(fc); } catch (e) { console.error(e); }
    try { renderSched(); } catch (e) { console.error(e); }
    try { renderSeason(); } catch (e) { console.error(e); }
    try { renderRecap(); } catch (e) { console.error(e); }
    try { updateBell(); } catch (e) { console.error(e); }
  }

  // ---------------------------------------------------------------- 🎉 퇴사 목표 달성 축하(5·10·20…100%) — 처음 넣었을 때·목표를 바꿨을 때는 조용히 지금 위치만 기록
  const MILE_KEY = 'cw.fireMile', MILES = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  let mileShown = false;
  function checkMilestone(c) {
    if (DEMO || !c || !fireCfg || mileShown || !(c.progress >= 0)) return; // 예시 포트폴리오에선 축하 창 없음
    const hit = MILES.filter((m) => c.progress * 100 >= m).at(-1) || 0, M = readJSON(MILE_KEY, null);
    if (!M || M.goal !== fireCfg.goal) { writeJSON(MILE_KEY, { m: hit, goal: fireCfg.goal }); return; }
    if (hit <= M.m) return;
    writeJSON(MILE_KEY, { m: hit, goal: fireCfg.goal });
    mileShown = true;
    setTimeout(() => showMilestone(hit, c), 1200);
  }
  function showMilestone(m, c) {
    if (document.querySelector('.sheet:not([hidden]), .sc-sheet')) { setTimeout(() => showMilestone(m, c), 4000); return; } // 다른 창이 열려 있으면 닫힌 뒤에
    const first = fireHist[0]?.d, days = first ? daysBetween(first, isoToday()) : 0;
    const el = document.createElement('div');
    el.className = 'ms-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    const done = m >= 100;
    el.innerHTML = `<div class="ms-panel">
      <div class="ms-confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 6) * 0.15}s;--c:${['#f2994a', '#3fbf7f', '#5b8def', '#f04452', '#f5c542'][i % 5]}"></i>`).join('')}</div>
      <div class="ms-emoji" aria-hidden="true">${done ? '🎊' : '🎉'}</div>
      <b class="ms-title">${done ? (EN ? 'You reached your FIRE goal!' : '퇴사 목표 달성!') : (EN ? `${m}% of the way to FIRE!` : `퇴사 목표 ${m}% 달성!`)}</b>
      <p class="ms-sub">${EN ? `${wonFull(c.basis)} of your ${wonFull(c.F.goal)} goal.` : `목표 ${wonFull(c.F.goal)} 중 <b>${wonFull(c.basis)}</b>까지 왔어요.`}${days >= 7 ? (EN ? ` Day ${days} since you started tracking.` : ` 기록을 시작한 지 ${days}일째예요.`) : ''}</p>
      <div class="ms-bar"><i style="width:${Math.min(100, c.progress * 100).toFixed(1)}%"></i></div>
      <div class="ms-btns"><button type="button" class="ms-share" data-msshare="${m}">📤 ${EN ? 'Share' : '이미지로 공유'}</button><button type="button" class="ms-close" data-msclose="1">${EN ? 'Close' : '닫기'}</button></div>
    </div>`;
    document.body.appendChild(el);
    markUse('fire');
  }
  function setText(id, t) { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; }
  function updateFireChip(c = fireCfg ? fireCalc() : null) {
    const el = document.getElementById('fire-chip');
    if (!el) return;
    el.innerHTML = c ? `<span aria-hidden="true">🔥</span><span class="fc-l">퇴사까지</span><b>${(Math.max(0, c.progress) * 100).toFixed(1)}%</b>` : `<span aria-hidden="true">🔥</span><b>Fire</b>`;
    el.setAttribute('aria-label', c ? `퇴사까지 ${(Math.max(0, c.progress) * 100).toFixed(1)}% · Fire 열기` : 'Fire 열기');
    el.setAttribute('aria-current', state.view === 'fire' ? 'page' : 'false');
  }

  const fireSaved = (k) => !!fireCfg?.positions.some((p) => p.ticker === k);
  const fireTickerOptions = (sel) => fireTickerOrder(fireSaved(sel) ? sel : null).map((k) => `<option value="${esc(k)}" ${sel === k ? 'selected' : ''}>${esc(FIRE_TICKERS[k])}${firePicked(k) || fireSaved(k) ? '' : ' (관심 종목에서 뺌)'}</option>`).join('');
  // 화면을 연 채로 관심 종목을 추가하면 입력 중인 값은 그대로 두고 선택지만 새로
  function refreshFireTickers() {
    for (const s of document.querySelectorAll('#f-rows .f-ticker')) { const v = s.value; s.innerHTML = fireTickerOptions(v); if ([...s.options].some((o) => o.value === v)) s.value = v; }
  }
  function fireRowHtml(p, i) {
    return `<div class="f-row" data-row="${i}">
      <select class="f-ticker" aria-label="종목">${fireTickerOptions(p.ticker)}</select>
      <input class="f-shares" inputmode="decimal" value="${p.shares ?? ''}" placeholder="보유 수량(주)" aria-label="보유 수량" required>
      <input class="f-avg" inputmode="decimal" value="${p.avg ?? ''}" placeholder="${krTk(p.ticker) ? '평균 단가(원)' : '평균 단가($)'}" aria-label="평균 단가" required>
      <button type="button" class="f-rm" data-rm="${i}" aria-label="이 종목 삭제" ${fireRows.length < 2 ? 'hidden' : ''}>×</button>
    </div>`;
  }
  function fireForm(open) {
    const F = fireCfg || { goal: 1.5e9, afterTax: false };
    fireRows ||= fireCfg ? fireCfg.positions.map((p) => ({ ...p })) : [{ ticker: 'CRCA' }];
    return `<details class="fire-set" ${open ? 'open' : ''}>
      <summary>${fireCfg ? '보유 정보 수정' : '보유 정보 입력'}</summary>
      <form id="fire-form" autocomplete="off">
        ${holdImportBtn('fire')}
        <div class="f-rows-h"><span>보유 종목</span><small>수량 · 평균 단가(달러)</small></div>
        <div id="f-rows">${fireRows.map(fireRowHtml).join('')}</div>
        <div class="d-btns"><button type="button" class="btn-ghost f-add" id="f-add">+ 종목 추가</button><button type="button" class="btn-ghost f-add" data-hiopen="fire" data-himode0="search">🔍 다른 종목 검색해서 넣기</button></div>
        <label>목표 금액(원)<input id="f-goal" inputmode="numeric" value="${F.goal ?? 1.5e9}" required><small id="f-goal-hint">${wonFull(F.goal ?? 1.5e9)}</small></label>
        <label>평균 매수 환율(원, 선택)<input id="f-fx" inputmode="decimal" value="${F.buyFx ?? ''}" placeholder="비우면 현재 환율로 손익 계산"></label>
        <label class="chk"><input type="checkbox" id="f-tax" ${F.afterTax ? 'checked' : ''}> 세후 기준으로 계산 (해외주식 양도세 22%, 연 250만원 공제)</label>
        <div class="fire-btns"><button type="submit" class="btn-primary">저장</button>${fireCfg ? `<button type="button" id="f-del" class="btn-ghost">${fireConfirmDelete ? '정말 삭제' : '이 기기에서 삭제'}</button>` : ''}</div>
        <p class="note">🔒 입력한 값은 <b>이 기기(브라우저)에만</b> 저장돼요. 서버나 공유 링크로 전송되지 않아서, 같은 링크를 받은 다른 사람에게는 보이지 않아요.</p>
        ${moveBtn()}
      </form>
    </details>`;
  }
  // 폼에 입력된 종목 목록을 읽는다(행 추가·삭제 전에 입력값 보존)
  function readFireRows() {
    return [...document.querySelectorAll('#f-rows .f-row')].map((r) => ({
      ticker: r.querySelector('.f-ticker').value,
      shares: parseFloat(r.querySelector('.f-shares').value.replace(/,/g, '')) || undefined,
      avg: parseFloat(r.querySelector('.f-avg').value.replace(/,/g, '')) || undefined,
    }));
  }

  // ---- 퇴사 후 생활비: 배당이 생활비를 얼마나 덮는지 · 4% 법칙 기준 필요 자산 · 배당만으로 생활하려면
  const LIFE_KEY = 'cw.life';
  let lifeCfg = Object.assign({ monthly: 300 }, readJSON(LIFE_KEY, {}) || {});
  function lifeHtml() {
    const m = +lifeCfg.monthly || 0, fx = state.quote?.fx?.rate;
    const c = fireCfg && state.quote ? (() => { try { return fireCalc(); } catch { return null; } })() : null;
    const d = divCfg ? (() => { try { return divCalc(); } catch { return null; } })() : null;
    if (m <= 0) return '<p class="note">한 달 생활비를 넣어 주세요.</p>';
    const yearNeed = m * 1e4 * 12, rule4 = yearNeed / 0.04;
    const divMonthKrw = d && fx ? d.monthly * fx : null, cover = divMonthKrw != null ? divMonthKrw / (m * 1e4) : null;
    const netYld = d && d.value ? d.annualNet / d.value : null, needDiv = netYld ? yearNeed / netYld : null;
    const have = c?.basis ?? null;
    return `<div class="ns-grid h-grid">
        <div><span>배당이 생활비를 덮는 비율</span><b class="${cover >= 1 ? 'up' : ''}">${cover != null ? pctPlain(Math.min(cover, 9.99), 0) : '–'}</b><small>${divMonthKrw != null ? (EN ? `Dividends ${manwon(divMonthKrw)}/mo vs living costs ${manwon(m * 1e4)}` : `월 배당 ${manwon(divMonthKrw)} / 생활비 ${manwon(m * 1e4)}`) : '배당금 탭에 종목을 넣으면 계산돼요'}</small></div>
        <div><span>4% 법칙 기준 필요 자산</span><b>${manwon(rule4)}</b><small>${have != null ? (EN ? `${(rule4 / have).toFixed(1)}x your current value · goal ${manwon(fireCfg?.goal || 0)}` : `지금 평가액의 ${(rule4 / have).toFixed(1)}배 · 목표 ${manwon(fireCfg?.goal || 0)}`) : '연 생활비 × 25'}</small></div>
        <div><span>배당만으로 생활하려면</span><b>${needDiv ? manwon(needDiv) : '–'}</b><small>${netYld ? (EN ? `at your holdings' after-tax yield of ${pctPlain(netYld, 2)}` : `지금 배당 종목의 세후 배당률 ${pctPlain(netYld, 2)} 기준`) : '배당 종목을 넣으면 계산돼요'}</small></div>
        <div><span>목표 금액으로 버틸 수 있는 생활비</span><b>${fireCfg?.goal ? manwon((fireCfg.goal * 0.04) / 12) : '–'}</b><small>목표의 4%를 매년 쓴다고 보면 · 월 기준</small></div>
      </div>
      <div class="life-acts"><button type="button" class="btn-ghost sm" data-ftabgo="div">💰 배당금 탭 열기</button><button type="button" class="btn-ghost sm" data-lifesim="${Math.round(m)}">${EN ? `🎯 Build a ${manwon(m * 1e4)}/mo dividend portfolio` : `🎯 월 ${m >= 1 ? nf(0).format(m) + '만원' : ''} 배당 포트폴리오 짜보기`}</button></div>
      <p class="note">4% 법칙: 모은 돈의 4%씩 매년 꺼내 쓰면 오래 버틸 수 있다는 미국 연구에서 나온 어림 기준이에요(물가·세금·수익률에 따라 달라요). 배당 비율은 최근 1년 배당이 이어진다고 본 값이에요.</p>`;
  }
  function renderFireLife() {
    if (!document.getElementById('c-firelife')) return;
    card('firelife', {
      title: '🏝️ 퇴사 후 생활비, 배당으로 될까?', sub: '한 달 생활비를 넣으면 배당·4% 법칙과 비교해요',
      easy: '퇴사 후 매달 필요한 생활비를 기준으로, 지금 받는 배당이 그 중 얼마를 덮는지, 모은 돈으로 몇 년을 버틸 수 있는지(4% 법칙), 배당만으로 생활하려면 얼마가 필요한지 보여줘요.',
      body: `<label class="bn-f"><span>한 달 생활비</span><div class="bn-in"><input inputmode="numeric" id="life-monthly" value="${esc(String(lifeCfg.monthly ?? ''))}" aria-label="한 달 생활비"><em>만원</em></div></label>
        <div id="life-out">${lifeHtml()}</div>`,
    });
  }
  function renderFire() {
    try { renderFireLife(); } catch (e) { console.error(e); }
    updateFireChip();
    renderHomeFire();
    const el = document.getElementById('c-fire');
    if (!el) return;
    const c = fireCalc();
    if (!fireCfg) {
      card('fire', { title: '퇴사까지', sub: '내 보유 주식으로 목표 금액까지 진행률', info: INFO.fire, body: `<p class="fire-empty">아래에 보유 종목·수량·평균 단가를 입력하면 실시간 시세와 환율로 <b>퇴사까지 몇 %</b>인지 계산해요. 기본 종목(CRCA·CRCL·JOBY·SPCX·TEM)은 물론, 관심 종목으로 직접 추가한 종목도 함께 넣을 수 있어요.</p>` });
      ['c-fire-sim', 'c-fire-hist', 'c-firemix'].forEach((id) => { const e = document.getElementById(id); if (e) e.hidden = true; });
      return;
    }
    ['c-fire-sim', 'c-fire-hist'].forEach((id) => { const e = document.getElementById(id); if (e) e.hidden = false; });
    if (!c) {
      card('fire', { title: '퇴사까지', sub: '시세 불러오는 중…', info: INFO.fire, body: `<p class="skeleton">${state.quoteErr ? '시세를 불러오지 못했습니다. 새로고침으로 다시 시도하세요.' : '실시간 시세·환율 불러오는 중…'}</p>` });
      return;
    }
    recordFireHistory(c);
    const F = c.F, pctDone = Math.max(0, c.progress), multi = c.rows.length > 1;
    const est = fireEstimate();
    const estC = est ? fireCalc(est.prices) : null;
    const marks = [0.25, 0.5, 0.75].map((m) => `<i style="left:${m * 100}%"></i>`).join('');
    const posHtml = c.rows.map((r) => {
      const g = r.valueUsd / r.costUsd - 1;
      const nm = r.kr ? keepName(STOCK_INFO[r.ticker]?.name || state.divData?.[r.ticker]?.d?.name || fireName(r.ticker)) : r.ticker;
      return `<div class="fire-pos"><div class="fp-h"><b>${logoOf(r.ticker) ? `<img class="fp-logo" src="${logoOf(r.ticker)}" alt="" width="16" height="16">` : ''}${esc(nm)}</b><span class="fp-v">${wonFull(r.valueUsd * c.fx)} <span class="${cls(g)}">${pct(g)}</span></span></div><div class="fp-d">${nf(0).format(r.shares)}주 · ${pxS(r.ticker, r.px)} <span class="${cls(r.q?.pct)}">${pct(r.q?.pct, 2)}</span> · ${esc(mktStatus(r.q?.status))}</div></div>`;
    }).join('');
    card('fire', {
      share: 'fire',
      title: '퇴사까지', sub: `${c.rows.map((r) => `${esc(fireName(r.ticker))} ${nf(0).format(r.shares)}주`).join(' · ')} · 목표 ${wonFull(F.goal)}${F.afterTax ? ' · 세후 기준' : ''}`, info: INFO.fire,
      body: `
        <div class="fire-hero">
          <div class="fire-pct"><span id="fire-pct">${(pctDone * 100).toFixed(1)}</span><small>%</small></div>
          <div class="fire-remain">목표까지 <b>${(Math.max(0, 1 - pctDone) * 100).toFixed(1)}%</b> 남음 · <b>${wonFull(Math.max(0, c.remainKrw))}</b> 부족</div>
          ${fireEtaHtml(fireEta(fireHist, F.goal), true)}
          <div class="fire-bar" role="progressbar" aria-valuenow="${Math.round(pctDone * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100, pctDone * 100)}%"></span>${marks}</div>
          <div class="fire-scale"><span>₩0</span><span>${won(F.goal * 0.5)}</span><span>${won(F.goal)}</span></div>
        </div>
        ${multi ? `<div class="fire-poss">${posHtml}</div>` : ''}
        <div class="ns-grid fire-grid">
          <div><span>평가금액${F.afterTax ? '(세후)' : ''}</span><b>${wonFull(c.basis)}</b><small>${dollar(c.valueUsd)}${F.afterTax ? ` · 세전 ${wonFull(c.valueKrw)}` : ''}</small></div>
          <div><span>평가손익</span><b class="${cls(c.gainKrw)}">${signed(c.gainKrw, wonFull)}</b><small><span class="${cls(c.gainPct)}">${pct(c.gainPct)}</span> · ${signed(c.gainUsd, dollar)}</small></div>
          <div><span>오늘 변동</span><b class="${cls(c.todayKrw)}">${signed(c.todayKrw, wonFull)}</b><small>${multi ? '보유 종목 합계' : `${esc(fireName(c.main.ticker))} <span class="${cls(c.q?.pct)}">${pct(c.q?.pct, 2)}</span>`} · 전일 종가 대비</small></div>
          ${multi
            ? `<div><span>필요 상승률</span><b class="up">+${(c.needAll * 100).toFixed(0)}%</b><small>보유 종목이 모두 같은 비율로 오를 때</small></div>`
            : `<div><span>${c.main.ticker} 현재가</span><b>$${c.px.toFixed(2)}</b><small>${esc(mktStatus(c.q?.status))} · 평균 $${c.main.avg.toFixed(2)}</small></div>`}
          <div><span>${multi ? `${esc(fireName(c.main.ticker))}만 오를 때 목표가` : '목표 달성 가격'}</span><b>${pxS(c.main.ticker, c.needPx)}</b><small>현재가 대비 <span class="up">+${(c.needPct * 100).toFixed(0)}%</span></small></div>
          <div><span>원·달러 환율</span><b>₩${nf(2).format(c.fx)}</b><small>10원 오르면 ${signed(c.valueUsd * 10, wonFull)}</small></div>
        </div>
        ${est ? `<div class="fire-est"><span class="tone px"><span class="live-dot"></span>24시간 추정</span>
          <div>바이낸스 CRCL <b>$${est.crcl.toFixed(2)}</b> (<span class="${cls(est.move)}">${pct(est.move, 2)}</span>, 정규장 종가 대비)${est.prices.CRCA ? ` → CRCA 추정 <b>$${est.prices.CRCA.toFixed(2)}</b>` : ''} · 달성률 <b>${estC ? (Math.max(0, estC.progress) * 100).toFixed(1) + '%' : '–'}</b></div></div>` : ''}
        <p class="note">시세 ${esc(c.q?.time || '')} · 환율 ${esc(state.quote.fx.source || '')} ${state.quote.fx.time ? hm(Date.parse(state.quote.fx.time)) : ''} 기준${F.buyFx ? '' : ' · 손익은 현재 환율로 환산'}${c.tax > 0 ? ` · 예상 양도세 ${wonFull(c.tax)}` : ''}</p>`,
    });
    // 슬라이더를 끄는 중이면 시뮬레이터는 다시 그리지 않는다
    if (document.activeElement?.id !== 'sim-range') renderFireSim(c);
    try { renderFireMix(c); } catch (e) { console.error(e); }
    try { renderRebal(c); } catch (e) { console.error(e); }
    try { renderBench(c); } catch (e) { console.error(e); }
    // 양도세 탭: 시세가 들어오면 보유 종목별 계산을 다시(입력 중엔 건드리지 않음)
    if (state.fireTab === 'tax' && !document.activeElement?.closest?.('#c-tax')) { const o = document.getElementById('tax-out'); if (o) { const h = taxOutHtml(); if (o.innerHTML !== h) o.innerHTML = h; } }
    renderFireHist();
  }

  function renderFireSet() {
    const el = document.getElementById('c-fire-set');
    if (!el) return;
    fireRows = null;
    el.innerHTML = fireForm(!fireCfg);
  }

  function simTopHtml(p) {
    const c0 = fireCalc();
    if (!c0) return '';
    const s = fireCalc({ [c0.main.ticker]: p });
    return `<b>${pxS(c0.main.ticker, p)}</b><span>${wonFull(s.basis)} · 달성률 <b>${(Math.max(0, s.progress) * 100).toFixed(1)}%</b> · 손익 <span class="${cls(s.gainKrw)}">${signed(s.gainKrw, wonFull)}</span></span>`;
  }
  function renderFireSim(c) {
    const m = c.main;
    const max = Math.max(Math.ceil(c.needPx * 1.25 / 10) * 10, Math.ceil(m.px * 3));
    const p = fireSim ?? m.px;
    const chips = [['현재가', m.px], ['+50%', m.px * 1.5], ['2배', m.px * 2], ['평균 단가', m.avg], ['목표가', Math.ceil(c.needPx * 100) / 100]];
    card('fire-sim', {
      title: '가격 시뮬레이터', sub: `${esc(fireName(m.ticker))} 가격이 이렇게 되면${c.rows.length > 1 ? ' (다른 종목은 현재가)' : ''} · 현재 환율 기준`, info: INFO.fireSim,
      body: `<div class="sim-top" id="sim-top">${simTopHtml(p)}</div>
        <input type="range" id="sim-range" min="1" max="${max}" step="${m.kr ? 10 : 0.5}" value="${p.toFixed(1)}" aria-label="${m.ticker} 가격">
        <div class="sim-scale"><span>${pxS(m.ticker, 1)}</span><span>${pxS(m.ticker, max)}</span></div>
        <div class="sim-chips">${chips.map(([l, v]) => `<button type="button" data-sim="${v.toFixed(2)}">${l}<small>${pxS(m.ticker, v)}</small></button>`).join('')}</div>`,
    });
  }

  // 예상 달성일 — 최근 180일 평가금액 기록의 로그 추세(복리 속도)로, 오늘 값에서 목표까지 남은 기간을 어림한다
  function fireEta(H, goal) {
    const today = isoToday(), R = H.filter((r) => r.v > 0 && daysBetween(r.d, today) <= 180);
    if (R.length && R.at(-1).v >= goal) return { done: true };
    if (R.length < 5 || daysBetween(R[0].d, R.at(-1).d) < 14) return { wait: true };
    const xs = R.map((r) => daysBetween(R[0].d, r.d)), ys = R.map((r) => Math.log(r.v)), n = R.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const k = sxy / sxx, yr = Math.exp(k * 365) - 1, span = xs.at(-1);
    if (!(k > 0)) return { down: true, yr, span };
    const days = Math.log(goal / R.at(-1).v) / k;
    return { days, date: addDays(R.at(-1).d, Math.round(days)), yr, span };
  }
  function fireEtaHtml(E, short) {
    if (!E || E.wait) return short ? '' : `<p class="note fire-eta-wait">${EN ? 'An estimated FIRE date appears once you have 14+ days of records.' : '기록이 14일 넘게 쌓이면 예상 달성일이 보여요.'}</p>`;
    if (E.done) return short ? '' : `<div class="fire-eta"><span>${EN ? 'Goal' : '목표'}</span><b>${EN ? 'Reached 🎊' : '달성 🎊'}</b></div>`;
    const basis = EN ? `last ${E.span} days, ${pct(E.yr, 0)}/yr pace` : `최근 ${E.span}일 기록 · 연 ${pct(E.yr, 0)} 속도`;
    if (E.down) return short ? '' : `<div class="fire-eta"><span>${EN ? 'At this pace' : '지금 속도면'}</span><b>${EN ? 'No estimate' : '예상 어려움'}</b><small>${basis} — ${EN ? 'the trend is down, so no date is shown.' : '줄어드는 추세라 날짜를 계산하지 않았어요.'}</small></div>`;
    const m = Math.max(1, Math.round(E.days / 30.44)), Y = Math.floor(m / 12), M = m % 12;
    const far = m > 600, [yy, mm] = E.date.split('-').map(Number);
    const when = far ? (EN ? '50+ years' : '50년 넘게') : EN ? `~${new Date(Date.UTC(yy, mm - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}` : `${yy}년 ${mm}월쯤`;
    const dur = EN ? [Y && `${Y} yr`, M && `${M} mo`].filter(Boolean).join(' ') : [Y && `${Y}년`, M && `${M}개월`].filter(Boolean).join(' ');
    if (short) return far ? '' : `<div class="fire-eta-line">${EN ? `At this pace: <b>${when}</b> (${dur})` : `지금 속도면 <b>${when}</b> 달성 (${dur} 뒤)`}</div>`;
    return `<div class="fire-eta"><span>${EN ? 'At this pace' : '지금 속도면'}</span><b>${when}</b><small>${far ? '' : `${EN ? 'in about' : '약'} ${dur} · `}${basis} · ${EN ? 'swings a lot with stock prices' : '주가에 따라 크게 달라져요'}</small></div>`;
  }

  function renderFireHist() {
    const H = fireHist;
    card('fire-hist', {
      title: '진행률 기록', sub: '이 기기에서 하루 한 번(마지막 값) 기록 · 최대 400일', info: '',
      body: H.length < 2
        ? `<p class="note" style="margin-top:12px">기록이 쌓이는 중이에요. 내일부터 추이 그래프가 보여요. (오늘 ${H[0] ? (H[0].p * 100).toFixed(1) + '%' : '–'})</p>`
        : `${fireCfg ? fireEtaHtml(fireEta(H, fireCfg.goal)) : ''}<div class="chart short"><canvas id="cv-fire-hist" role="img" aria-label="퇴사 진행률 기록"></canvas></div>`,
    });
    if (H.length < 2) return;
    const labels = H.map((r) => Date.parse(r.d + 'T12:00:00') / 1000);
    draw('fire-hist', {
      type: 'line',
      data: { labels, datasets: [lineDs('달성률', H.map((r) => r.p), C.orange, { fill: 'start', backgroundColor: areaFill(C.orange), pointRadius: endPoint(H.length), tension: 0.2 })] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip((it) => H[it.dataIndex].d, (v, it) => `${(v * 100).toFixed(1)}% (${won(H[it.dataIndex].v)})`) },
        scales: { x: axisX(labels, (t) => { const d = new Date(t * 1000); return `${d.getMonth() + 1}/${d.getDate()}`; }, 5), y: axisY((v) => (v * 100).toFixed(0) + '%', { beginAtZero: true }) },
      },
    });
  }


  // ---------------------------------------------------------------- 배당금 (Fire 화면) — 받은 배당·원금 회수·월별 배당
  // 매수 기록(종목·수량·평단·매수일)은 이 기기에만 저장한다. 배당 내역은 서버(/dividends: Yahoo 배당락일·주당 배당금 + Nasdaq 지급일).
  // 받을 자격: 매수일 다음 날 이후에 배당락일이 온 배당(미국 T+1 결제 — 배당락 전날까지 사면 받음).
  // 주당 배당금은 주식 분할이 반영된 값이라, 수량은 '지금 보유 중인 수량(분할 반영)'으로 넣어야 맞다.
  const DIV_KEY = 'cw.div', DIV_CACHE = 'cw.divCache3';
  try { localStorage.removeItem('cw.divCache'); localStorage.removeItem('cw.divCache2'); } catch {} // 매수일 기준으로 잘라 저장하던 예전 캐시
  // 거래 내역 → 지금 수량·평단(평균 단가 방식: 매수는 원가에 더하고, 매도는 그때 평단만큼 뺀다)
  const holdFromTrades = (trades) => {
    let sh = 0, cost = 0;
    for (const x of [...trades].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))) {
      if (x.sell) { const out = Math.min(x.sh, sh); cost -= sh ? cost * (out / sh) : 0; sh -= out; } else { sh += x.sh; cost += x.sh * x.price; }
    }
    return { sh: Math.round(sh * 10000) / 10000, avg: sh > 0 ? Math.round((cost / sh) * 10000) / 10000 : 0 };
  };
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const normDiv = (V) => {
    if (!V) return null;
    if (!Array.isArray(V.hold) && Array.isArray(V.lots)) { // 예전 형식(줄마다 매수 기록) → 종목별로 묶기
      const g = {};
      for (const l of V.lots) if (TICKER_RE.test(l?.t || '') && l.sh > 0 && l.avg > 0 && ISO_RE.test(l.d || '')) (g[l.t] ||= []).push(l);
      V.hold = Object.entries(g).map(([t, ls]) => (ls.length === 1 && !ls[0].sell
        ? { t, sh: ls[0].sh, avg: ls[0].avg, d: ls[0].d }
        : { t, trades: ls.map((l) => ({ d: l.d, sh: l.sh, price: l.avg, ...(l.sell ? { sell: true } : {}) })) }));
      delete V.lots;
    }
    if (!Array.isArray(V.hold)) return null;
    V.hold = V.hold.filter((h) => TICKER_RE.test(h?.t || '')).map((h) => {
      const trades = (h.trades || []).filter((x) => ISO_RE.test(x?.d || '') && x.sh > 0 && x.price > 0).map((x) => ({ d: x.d, sh: x.sh, price: x.price, ...(x.sell ? { sell: true } : {}) }));
      if (trades.length) return { t: h.t, ...holdFromTrades(trades), trades };
      return h.sh > 0 && h.avg > 0 ? { t: h.t, sh: h.sh, avg: h.avg, d: ISO_RE.test(h.d || '') ? h.d : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) } : null; // (todayIso는 아래에서 정의돼 여기선 못 씀)
    }).filter(Boolean);
    V.tax = [0, 0.15].includes(V.tax) ? V.tax : 0.15;
    return V.hold.length ? V : null;
  };
  // 계산용: 종목 → 매수·매도 기록(거래 내역이 없으면 '그날 한 번에 산 것' 한 줄)
  const divLots = () => (divCfg?.hold || []).flatMap((h) => (h.trades?.length
    ? h.trades.map((x) => ({ t: h.t, sh: x.sh, avg: x.price, d: x.d, ...(x.sell ? { sell: true } : {}) }))
    : [{ t: h.t, sh: h.sh, avg: h.avg, d: h.d }]));
  let divCfg = normDiv(structuredClone(readSaved(DIV_KEY, null)));
  let divRows = null, divConfirmDelete = false;
  state.divData = readJSON(DIV_CACHE, {}) || {}; // { SYM: { t: 받은 시각, d: 서버 응답 } } — 다음 방문 때 바로 그린다
  state.divErr = {};
  const isoToday = () => todayIso();
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  const usd2 = (v) => (v == null || !isFinite(v) ? '–' : (v < 0 ? '-$' : '$') + nf(Math.abs(v) >= 1000 ? 0 : 2).format(Math.abs(v)));
  const krwOf = (v) => { const fx = state.quote?.fx?.rate; return fx && v != null ? wonFull(v * fx) : ''; };
  const monKey = (iso) => iso.slice(0, 7);

  async function loadDividends(force = false) {
    if (!divCfg) return;
    const syms = [...new Set(divCfg.hold.map((h) => h.t))];
    await Promise.all(syms.map(async (s) => {
      const c = state.divData[s];
      if (!force && c && Date.now() - c.t < 6 * 3600000) return;
      try {
        const j = await getJ(`${NEWS_API}/dividends?s=${s}`, 20000);
        if (j.error) throw new Error(j.error);
        j.events = j.events || []; // 30년치 전부 보관(매수일을 앞당겨도 예전 배당이 빠지지 않게)
        state.divData[s] = { t: Date.now(), d: j };
        delete state.divErr[s];
      } catch (e) { state.divErr[s] = String(e.message || e); }
    }));
    for (const k of Object.keys(state.divData)) if (!syms.includes(k)) delete state.divData[k];
    writeJSON(DIV_CACHE, state.divData);
    renderDiv();
  }

  // 지급일: Nasdaq에 있으면 그대로, 없으면 그 종목의 보통 간격(배당락→지급)으로 추정
  const LAG_MEMO = new WeakMap();
  function payDateOf(D, ex) {
    if (D.pay?.[ex]) return { pay: D.pay[ex], est: false };
    const mk = D.pay || D.events, hit = LAG_MEMO.get(mk);
    if (hit && hit.day === isoToday()) return { pay: addDays(ex, hit.lag), est: true };
    const lags = Object.entries(D.pay || {}).map(([e, p]) => daysBetween(e, p)).filter((n) => n >= 0 && n < 60).sort((a, b) => a - b);
    // 지급일 자료가 없으면 주기·종류로 추정: 매주 배당 ETF 1일, 월배당 ETF 3일, 그 밖의 ETF 5일, 개별 주식 14일
    const cut = addDays(isoToday(), -120), recent = D.events.filter((e) => e.ex > cut).length;
    const etf = /ETF|FUND/i.test(D.type || '') || /(ETF|Fund|Trust|ProShares|Direxion|YieldMax|Roundhill|Defiance|GraniteShares|iShares|SPDR|Vanguard|Invesco|Schwab|Ultra)/i.test(D.name || ''); // CRCA처럼 Yahoo가 주식으로 분류한 ETF
    const kr = krTk(D.symbol || ''), krEtf = kr && (/ETF|FUND/i.test(D.type || '') || /^(TIGER|KODEX|SOL|ACE|RISE|PLUS|HANARO|KIWOOM|TIME|KOSEF|ARIRANG|KBSTAR|WON|1Q|BNK|DAISHIN|FOCUS|TREX|UNICORN|마이티|에셋플러스)\b/i.test(D.name || ''));
    const lag = lags.length ? lags[Math.floor(lags.length / 2)] : kr ? (krEtf ? 3 : 45) : recent >= 10 ? 1 : etf ? (recent >= 3 ? 3 : 5) : 14;
    LAG_MEMO.set(mk, { lag, day: isoToday() });
    return { pay: addDays(ex, lag), est: true };
  }
  const freqOf = (n) => (n >= 40 ? ['매주 배당', 52] : n >= 10 ? ['월배당', 12] : n >= 3 ? ['분기 배당', 4] : n === 2 ? ['반기 배당', 2] : n === 1 ? ['연 1회', 1] : ['배당 없음', 0]);

  // 한국 종목 배당(원)은 지금 환율로 달러로 바꿔 합계에 넣고, 세후일 때는 국내 배당소득세 15.4%가 되도록 금액을 맞춘다
  function divView(sym) {
    const raw = state.divData[sym]?.d;
    if (!raw || !krTk(sym)) return raw;
    const fx = state.quote?.fx?.rate;
    if (!fx) return null;
    const k = (divCfg?.tax ? (1 - 0.154) / (1 - divCfg.tax) : 1) / fx;
    return { ...raw, kr: true, fx, adj: k * fx, price: raw.price != null ? raw.price / fx : null, events: raw.events.map((e) => ({ ...e, amt: e.amt * k })), next: raw.next ? { ...raw.next, amt: raw.next.amt != null ? raw.next.amt * k : null } : null };
  }
  let divMemo = { k: null, v: null };
  function divCalc() {
    if (!divCfg) return null;
    const k = `${isoToday()}|${state.quote?.fx?.rate}|${JSON.stringify(divCfg)}|${Object.entries(state.divData).map(([s, x]) => s + ':' + x.t).join(',')}`;
    if (divMemo.k === k) return divMemo.v;
    const v = divCalcNow();
    divMemo = { k, v };
    return v;
  }
  function divCalcNow() {
    const today = isoToday(), yearAgo = addDays(today, -365), tax = divCfg.tax;
    const per = {}, received = [], pending = [], missing = [];
    const byT = {};
    for (const L of divLots()) (byT[L.t] ||= []).push(L);
    for (const [sym, lots] of Object.entries(byT)) {
      lots.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      // 원가(평균 단가 방식): 매수는 더하고, 매도는 그때의 평균 단가만큼 뺀다
      let sh = 0, cost = 0;
      for (const L of lots) {
        if (L.sell) { const out = Math.min(L.sh, sh); cost -= sh ? cost * (out / sh) : 0; sh -= out; }
        else { sh += L.sh; cost += L.sh * L.avg * (krTk(sym) ? 1 / (state.quote?.fx?.rate || NaN) : 1); }
      }
      const D = divView(sym);
      const P = (per[sym] = { sym, sh, cost, gross: 0, count: new Set(), D, lots: lots.filter((l) => !l.sell).length, sells: lots.filter((l) => l.sell).length });
      if (!D) { missing.push(sym); continue; }
      // 배당락일 전날까지 가진 수량(그 전에 판 수량은 뺀다. 배당락일 당일 이후에 팔아도 그 배당은 받는다)
      const heldAt = (ex) => Math.max(0, lots.reduce((n, L) => (L.d < ex ? n + (L.sell ? -L.sh : L.sh) : n), 0));
      const evs = [...D.events];
      if (D.next?.ex && !evs.some((e) => e.ex === D.next.ex)) evs.push({ ex: D.next.ex, amt: D.next.amt ?? evs.at(-1)?.amt ?? 0, declared: true, pay: D.next.pay });
      for (const e of evs) {
        const held = heldAt(e.ex);
        if (!(held > 0)) continue;
        const { pay, est } = e.pay ? { pay: e.pay, est: false } : payDateOf(D, e.ex);
        const row = { sym, ex: e.ex, pay, est, dps: e.amt, sh: held, gross: e.amt * held };
        if (pay <= today && e.ex <= today) { received.push(row); P.gross += row.gross; P.count.add(e.ex); }
        else pending.push(row);
      }
    }
    // 종목별: 최근 1년 주당 배당(TTM)·주기·다음 배당
    let annualGross = 0, value = 0;
    for (const P of Object.values(per)) {
      const D = P.D;
      const price = D?.price ?? null;
      if (price) value += price * P.sh; else value += P.cost;
      if (!D) continue;
      const ttmEv = D.events.filter((e) => e.ex > yearAgo && e.ex <= today);
      const [freqLabel, freq] = freqOf(ttmEv.length);
      P.ttm = ttmEv.reduce((s, e) => s + e.amt, 0);
      P.freqLabel = freqLabel; P.freq = freq;
      P.annual = P.ttm * P.sh;
      P.yoc = P.cost ? P.annual / P.cost : null;
      P.yield = price ? P.ttm / price : null;
      P.price = price;
      annualGross += P.annual;
      const last = D.events.at(-1);
      if (D.next?.ex && D.next.ex >= today) P.next = { ex: D.next.ex, pay: D.next.pay, amt: D.next.amt, est: false };
      else if (last && freq) { let ex = last.ex; while (ex <= today) ex = addDays(ex, Math.round(365 / freq)); P.next = { ex, amt: last.amt, est: true }; }
      P.lastAmt = last?.amt ?? null;
      P.received = P.gross * (1 - tax);
      P.payments = P.count.size;
    }
    const cost = Object.values(per).reduce((s, P) => s + P.cost, 0);
    const recvGross = received.reduce((s, r) => s + r.gross, 0), recvNet = recvGross * (1 - tax);
    const pendNet = pending.filter((r) => r.ex <= today).reduce((s, r) => s + r.gross, 0) * (1 - tax); // 배당락은 지났고 지급만 남은 것
    const annualNet = annualGross * (1 - tax);
    const remaining = Math.max(0, cost - recvNet);
    // 월별: 최근 12개월 받은 것 + 앞으로 12개월 예상(최근 1년 일정이 반복된다고 보고 지금 수량으로)
    const months = [];
    const d0 = new Date(); d0.setDate(1);
    for (let i = -11; i <= 12; i++) { const d = new Date(d0.getFullYear(), d0.getMonth() + i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const past = Object.fromEntries(months.map((m) => [m, 0])), fut = Object.fromEntries(months.map((m) => [m, 0]));
    for (const r of received) if (past[monKey(r.pay)] != null) past[monKey(r.pay)] += r.gross * (1 - tax);
    for (const r of pending) if (fut[monKey(r.pay)] != null) fut[monKey(r.pay)] += r.gross * (1 - tax);
    for (const P of Object.values(per)) {
      const D = P.D; if (!D) continue;
      for (const e of D.events.filter((x) => x.ex > yearAgo && x.ex <= today)) {
        const ex1 = addDays(e.ex, 364), pay1 = addDays(payDateOf(D, e.ex).pay, 364);
        if (pending.some((r) => r.sym === P.sym && Math.abs(daysBetween(r.ex, ex1)) < 20)) continue; // 이미 발표된 배당과 겹치면 건너뜀
        if (pay1 > isoToday() && fut[monKey(pay1)] != null) fut[monKey(pay1)] += e.amt * P.sh * (1 - tax);
      }
    }
    // 연도별 받은 배당
    const byYear = {};
    for (const r of received) { const y = r.pay.slice(0, 4); (byYear[y] ||= { gross: 0, n: 0 }); byYear[y].gross += r.gross; byYear[y].n++; }
    const nextAll = Object.values(per).filter((P) => P.next).sort((a, b) => (a.next.ex < b.next.ex ? -1 : 1))[0] || null;
    return {
      per, received: received.sort((a, b) => (a.pay < b.pay ? 1 : -1)), pending, missing, cost, value, recvGross, recvNet, pendNet, annualGross, annualNet,
      monthly: annualNet / 12, remaining, payback: cost ? recvNet / cost : 0, years: annualNet > 0 ? remaining / annualNet : null,
      yoc: cost ? annualGross / cost : null, yld: value ? annualGross / value : null, months, past, fut, byYear, nextAll, tax,
      payments: received.length,
    };
  }

  // Fire 화면 위 탭: 퇴사까지 / 배당금 — 카드의 data-pane으로 보이기·숨기기(선택은 이 기기에 기억)
  state.fireTab = ['div', 'bonus'].includes(loadPref('fireTab', 'fire')) ? loadPref('fireTab', 'fire') : 'fire';
  state.divSub = loadPref('divSub', 'mine') === 'sim' ? 'sim' : 'mine'; // 배당금 탭 안: 내 배당금 · 포트폴리오 짜보기
  const setDivSub = (v) => { state.divSub = ['sim', 'grow'].includes(v) ? v : 'mine'; savePref('divSub', state.divSub); };
  function applyFireTab() {
    for (const b of document.querySelectorAll('[data-ftab]')) b.setAttribute('aria-selected', String(b.dataset.ftab === state.fireTab));
    for (const el of document.querySelectorAll('#view-fire [data-pane]')) el.classList.toggle('pane-off', el.dataset.pane !== state.fireTab);
    for (const el of document.querySelectorAll('#view-fire [data-dpane]')) el.classList.toggle('sub-off', el.dataset.dpane !== state.divSub);
    for (const b of document.querySelectorAll('[data-dsub]')) b.setAttribute('aria-selected', String(b.dataset.dsub === state.divSub));
    if (state.fireTab === 'div') for (const id of ['div-month', 'sim-month']) charts[id]?.resize();
    if (state.view === 'fire') { document.getElementById('view-title').textContent = viewTitle('fire'); markUse(state.fireTab); }
  }
  // ---- 배당 캘린더: 앞으로 3개월 입금 예정(발표된 배당 + 최근 1년 일정이 반복된다고 본 예상) — 지급일 기준, 세후
  function divCalendar(c) {
    const today = isoToday(), end = addDays(today, 92), out = [];
    for (const r of c.pending) if (r.pay >= today && r.pay <= end) out.push({ sym: r.sym, ex: r.ex, pay: r.pay, est: r.est, declared: c.per[r.sym]?.D?.next?.ex === r.ex, net: r.gross * (1 - c.tax) });
    for (const P of Object.values(c.per)) {
      const D = P.D; if (!D || !(P.sh > 0)) continue;
      const yr = D.events.filter((x) => x.ex > addDays(today, -365) && x.ex <= today);
      // 매주·매달 주는 종목은 금액이 자주 바뀌어서, 작년 같은 때 금액 대신 최근 3회 평균으로 본다
      const recentAvg = yr.length >= 10 ? yr.slice(-3).reduce((a, e) => a + e.amt, 0) / Math.min(3, yr.length) : null;
      for (const e of yr) {
        const ex1 = addDays(e.ex, 364), pay1 = addDays(payDateOf(D, e.ex).pay, 364);
        if (pay1 < today || pay1 > end) continue;
        if (c.pending.some((r) => r.sym === P.sym && Math.abs(daysBetween(r.ex, ex1)) < (recentAvg ? 3 : 20))) continue;
        out.push({ sym: P.sym, ex: ex1, pay: pay1, est: true, declared: false, net: (recentAvg ?? e.amt) * P.sh * (1 - c.tax) });
      }
    }
    return out.sort((a, b) => (a.pay < b.pay ? -1 : a.pay > b.pay ? 1 : 0));
  }
  function renderDivCal(c) {
    const el = document.getElementById('c-divcal');
    if (!el) return;
    const L = c ? divCalendar(c) : [];
    el.hidden = !L.length;
    if (!L.length) return;
    const fx = state.quote?.fx?.rate, mTot = {};
    for (const x of L) { const m = x.pay.slice(0, 7); (mTot[m] ||= { n: 0, v: 0 }); mTot[m].n++; mTot[m].v += x.net; }
    const total = L.reduce((a, x) => a + x.net, 0);
    // 월별로 묶어 그린다(앞의 몇 건만 바로 보이고 나머지는 접어 둔다)
    const monL = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString(LOC, { month: 'short' }), cntL = (n) => (EN ? `${n} payout${n === 1 ? '' : 's'}` : `${n}건`);
    const groups = (xs, cont) => { const by = {}; for (const x of xs) (by[x.pay.slice(0, 7)] ||= []).push(x); return Object.entries(by).map(([m, ys], i) => `<div class="dc-month"><div class="dc-mh"><b>${monL(m)}${cont && i === 0 && ys.length < mTot[m].n ? ' <small>(이어서)</small>' : ''}</b><span>${cntL(mTot[m].n)} · ${usd2(mTot[m].v)}</span></div>
          <ul class="dc-list">${ys.map((x) => `<li><time>${+x.pay.slice(5, 7)}/${+x.pay.slice(8)}<small>${new Date(x.pay + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short' })}</small></time><div><b>${esc(fireName(x.sym))}</b><small>${EN ? 'ex-div' : '배당락'} ${+x.ex.slice(5, 7)}/${+x.ex.slice(8)}</small></div><span class="dc-amt">${usd2(x.net)}<em class="${x.declared ? 'ok' : 'est'}">${x.declared ? '확정' : '예상'}</em></span></li>`).join('')}</ul></div>`).join(''); };
    const FIRST = 4, head = L.slice(0, FIRST), rest = L.slice(FIRST);
    card('divcal', {
      title: '📅 배당 캘린더', sub: EN ? `Next 3 months · by pay date · after tax · ${cntL(L.length)}` : `앞으로 3개월 입금 예정 · 지급일 기준 · 세후 · ${L.length}건`,
      easy: '지금 가진 수량으로 언제 배당이 들어올지 미리 보는 달력이에요. "확정"은 회사가 발표한 배당이고, "예상"은 작년 같은 때 준 배당이 올해도 비슷하게 나온다고 보고 계산한 거예요.',
      body: `<div class="dc-sum"><span>3개월 합계(예상 포함)</span><b>${usd2(total)}</b>${fx ? `<small>${manwon(total * fx)}</small>` : ''}</div>
        ${groups(head, false)}
        ${rest.length ? `${more('divcal', `${EN ? `Show ${rest.length} more` : `나머지 ${rest.length}건 더 보기`} · ${[...new Set(rest.map((x) => monL(x.pay.slice(0, 7))))].join('·')}`)}${groups(rest, true)}</details>` : ''}
        <p class="note">배당락일 전날까지 그 수량을 들고 있어야 받아요. 지급일을 발표하지 않은 배당은 그 종목의 보통 지급 간격으로 추정했어요.</p>`,
    });
  }
  function renderDiv() {
    renderHomeFire();
    try { renderDivCal(divCfg ? divCalc() : null); } catch (e) { console.error(e); }
    const el = document.getElementById('c-div');
    if (!el) return;
    const mEl = document.getElementById('c-div-month');
    if (!divCfg) {
      card('div', { title: '배당금', sub: '매수한 주식·ETF로 받은 배당과 원금 회수', info: INFO.div, body: `<p class="fire-empty">위 <b>배당 종목 입력</b>에 종목·수량·평균 단가·<b>매수일</b>을 넣으면, 지금까지 받은 배당금, 원금을 되찾기까지 남은 금액, 월별 배당금을 계산해요. 같은 종목을 여러 번 나눠 샀다면 매수일별로 따로 넣어 주세요.</p>` });
      if (mEl) mEl.hidden = true;
      return;
    }
    const c = divCalc();
    const P0 = Object.values(c.per);
    const loading = c.missing.filter((s) => !state.divErr[s]);
    const errs = c.missing.filter((s) => state.divErr[s]);
    const taxLabel = c.tax ? (P0.some((p) => krTk(p.sym)) ? '세후(미국 15% · 국내 15.4%)' : `세후(미국 원천징수 ${Math.round(c.tax * 100)}%)`) : '세전';
    const P = Object.values(c.per);
    const rows = P.map((p) => `<tr><td>${logoOf(p.sym) ? `<img class="div-logo" src="${logoOf(p.sym)}" alt="" width="18" height="18" loading="lazy">` : ''}<b>${esc(krTk(p.sym) ? (p.D?.name || p.sym.slice(0, 6)) : p.sym)}</b><small>${krTk(p.sym) ? `${p.sym.slice(0, 6)} · ` : ''}${esc(p.D && !p.D.events.length ? '배당 없음' : p.freqLabel || '–')}${p.yoc != null ? ` · YOC ${pctPlain(p.yoc, 1)}` : ''}${p.lots > 1 ? (EN ? ` · ${p.lots} buys` : ` · 매수 ${p.lots}회`) : ''}${p.sells ? (EN ? ` · ${p.sells} sells` : ` · 매도 ${p.sells}회`) : ''}${p.sh <= 0 ? (EN ? ' · sold out' : ' · 전량 매도') : ` · ${nf(p.sh % 1 ? 2 : 0).format(p.sh)}${EN ? ' sh' : '주'}`}</small></td>
        <td>${p.payments ?? 0}회</td><td>${krTk(p.sym) && p.D?.fx ? wonPx(p.received * p.D.fx) : usd2(p.received)}</td><td>${p.annual != null ? (krTk(p.sym) && p.D?.fx ? wonPx(p.annual * (1 - c.tax) * p.D.fx) : usd2(p.annual * (1 - c.tax))) : '–'}</td>
        <td>${p.next ? `${+p.next.ex.slice(5, 7)}/${+p.next.ex.slice(8)}${p.next.est ? '<small>예상</small>' : '<small>확정</small>'}` : '–'}</td></tr>`).join('');
    const bar = Math.min(100, c.payback * 100);
    // 받은 배당이 없을 때 이유: 배당을 안 주는 종목 / 매수일 이후 배당락이 아직 없음
    const noDiv = P.filter((p) => p.D && !p.D.events.length).map((p) => fireName(p.sym));
    const notYet = P.filter((p) => p.D && p.D.events.length && !p.payments).map((p) => fireName(p.sym));
    const why = [noDiv.length ? (EN ? `${noDiv.join(', ')} ${noDiv.length > 1 ? "don't" : "doesn't"} pay dividends` : `배당을 주지 않는 종목: ${noDiv.join('·')}`) : '', notYet.length ? (EN ? `${notYet.join(', ')}: no ex-dividend date has passed since the buy date yet` : `매수일 이후 아직 배당락일이 없어 받은 배당이 없는 종목: ${notYet.join('·')} (앞으로 받을 배당만 계산)`) : ''].filter(Boolean).join(EN ? ' · ' : ' · ');
    const big = Object.entries(c.byYear).find(([, v]) => state.quote?.fx?.rate && v.gross * state.quote.fx.rate > 2e7 * 0.8);
    card('div', {
      share: 'div',
      title: '배당금', sub: EN ? `${P.length} stocks · ${c.tax ? `after tax (US 15%${P.some((x) => krTk(x.sym)) ? ' · KR 15.4%' : ''})` : 'pre-tax'} · current shares` : `${P.length}종목 · ${taxLabel} 기준 · 현재 보유 수량 기준`, info: INFO.div,
      body: `${loading.length ? `<p class="skeleton">배당 내역 불러오는 중… (${esc(loading.join(', '))})</p>` : ''}
        ${errs.length ? `<p class="err">배당 내역을 받지 못한 종목: ${esc(errs.join(', '))} — 티커를 확인해 주세요.</p>` : ''}
        <div class="div-hero">
          <span>지금까지 받은 배당금</span>
          <b>${usd2(c.recvNet)}</b><small>${krwOf(c.recvNet)} · ${EN ? `${c.payments} payments` : `총 ${c.payments}회`}${c.pendNet > 0 ? ` · ${EN ? 'awaiting payment' : '지급 대기'} ${usd2(c.pendNet)}` : ''}</small>
        </div>
        ${why ? `<p class="note" data-noi18n>${esc(why)}</p>` : ''}
        <div class="div-pb">
          <div class="div-pb-h"><span>원금 회수</span><b>${(c.payback * 100).toFixed(1)}%</b></div>
          <div class="fire-bar" role="progressbar" aria-valuenow="${Math.round(bar)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${bar}%"></span></div>
          <p class="div-pb-n" data-noi18n>${c.remaining > 0 ? (EN
            ? `<b>${usd2(c.remaining)}</b>${krwOf(c.remaining) ? ` (${krwOf(c.remaining)})` : ''} more of your ${usd2(c.cost)} principal to go${c.years != null ? ` · about <b>${c.years < 1 ? Math.max(1, Math.round(c.years * 12)) + ' months' : c.years.toFixed(1) + ' years'}</b> at the current pace` : ''}`
            : `원금 ${usd2(c.cost)} 중 <b>${usd2(c.remaining)}</b>${krwOf(c.remaining) ? ` (${krwOf(c.remaining)})` : ''}를 더 받으면 회수 완료${c.years != null ? ` · 지금 배당 속도면 <b>약 ${c.years < 1 ? Math.max(1, Math.round(c.years * 12)) + '개월' : c.years.toFixed(1) + '년'}</b>` : ''}`)
          : (EN ? '🎉 Dividends alone have recovered your full principal' : '🎉 배당만으로 원금을 모두 회수했어요')}</p>
        </div>
        <div class="ns-grid div-grid">
          <div><span>연 예상 배당</span><b>${usd2(c.annualNet)}</b><small>${krwOf(c.annualNet) || '최근 1년 배당 기준'}</small></div>
          <div><span>월 평균</span><b>${usd2(c.monthly)}</b><small>${krwOf(c.monthly) || '연 예상 ÷ 12'}</small></div>
          <div><span>배당률(현재가)</span><b>${c.yld != null ? pctPlain(c.yld, 2) : '–'}</b><small>최근 1년 배당 ÷ 평가금액</small></div>
          <div><span>투자금 대비(YOC)</span><b>${c.yoc != null ? pctPlain(c.yoc, 2) : '–'}</b><small>최근 1년 배당 ÷ 매수 금액</small></div>
        </div>
        ${c.nextAll ? `<p class="div-next">다음 배당락 <b>${esc(fireName(c.nextAll.sym))} ${krDate(c.nextAll.next.ex)}</b>${c.nextAll.next.est ? ' (예상)' : ''} · 주당 ${c.nextAll.D?.kr && c.nextAll.D.adj ? wonPx(c.nextAll.next.amt * c.nextAll.D.fx / c.nextAll.D.adj) : usd2(c.nextAll.next.amt)} — 그 전날까지 보유해야 받아요</p>` : ''}
        ${big ? `<p class="note warn-note">⚠️ ${big[0]}년 배당이 ${krwOf(big[1].gross)}(세전)예요. 이자·배당 등 금융소득이 한 해 2,000만원을 넘으면 금융소득종합과세 대상이 될 수 있어요.</p>` : ''}
        ${more('div:per', EN ? `By stock · ${P.length}` : `종목별 보기 · ${P.length}종목`)}
          <div class="div-scroll"><table class="div-tbl"><thead><tr><th>종목</th><th>받은 횟수</th><th>받은 금액</th><th>연 예상</th><th>다음 배당락</th></tr></thead><tbody>${rows}</tbody></table></div>
        </details>`,
    });
    renderDivMonth(c);
  }

  function renderDivMonth(c) {
    const el = document.getElementById('c-div-month');
    if (!el) return;
    el.hidden = false;
    const recent = c.received.slice(0, 30);
    const years = Object.entries(c.byYear).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const thisMonth = monKey(isoToday());
    card('div-month', {
      title: '월별 배당금', sub: `최근 12개월 받은 배당 · 앞으로 12개월 예상 · ${c.tax ? '세후' : '세전'}`, info: INFO.divMonth,
      body: `<div class="chart"><canvas id="cv-div-month" role="img" aria-label="월별 배당금"></canvas></div>
        <p class="note">초록 = 받은 배당(지급일 기준), 회색 = 예상(최근 1년 배당 일정이 반복된다고 보고 지금 수량으로 계산). 지급일을 모르는 배당은 그 종목의 보통 지급 간격으로 추정해요.</p>
        ${years.length ? `<div class="div-years">${years.map(([y, v]) => `<div><span>${y}년</span><b>${usd2(v.gross * (1 - c.tax))}</b><small>${v.n}${EN ? 'x' : '회'}${krwOf(v.gross * (1 - c.tax)) ? ' · ' + krwOf(v.gross * (1 - c.tax)) : ''}</small></div>`).join('')}</div>` : ''}
        ${recent.length ? `${more('div:hist', EN ? `Dividend history · latest ${recent.length}` : `받은 배당 내역 · 최근 ${recent.length}건`)}
          <div class="div-scroll"><table class="div-tbl"><thead><tr><th>지급일</th><th>종목</th><th>주당</th><th>수량</th><th>받은 금액</th></tr></thead><tbody>
          ${recent.map((r) => `<tr><td>${r.pay.slice(2).replace(/-/g, '.')}${r.est ? '<small>추정</small>' : ''}</td><td>${esc(fireName(r.sym))}</td><td>${c.per[r.sym]?.D?.kr && c.per[r.sym].D.adj ? wonPx(r.dps * c.per[r.sym].D.fx / c.per[r.sym].D.adj) : usd2(r.dps)}</td><td>${nf(0).format(r.sh)}</td><td>${usd2(r.gross * (1 - c.tax))}</td></tr>`).join('')}
          </tbody></table></div></details>` : '<p class="note">아직 받은 배당이 없어요.</p>'}`,
    });
    const labels = c.months;
    draw('div-month', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '받은 배당', data: labels.map((m) => (m <= thisMonth ? c.past[m] || null : null)), backgroundColor: C.teal, borderRadius: 3, stack: 's' },
          { label: '예상', data: labels.map((m) => (m >= thisMonth ? c.fut[m] || null : null)), backgroundColor: 'rgba(139,149,165,0.45)', borderRadius: 3, stack: 's' },
        ],
      },
      options: {
        interaction,
        plugins: { ...noLegend, tooltip: tooltip((it) => { const [y, m] = labels[it.dataIndex].split('-'); return EN ? `${y}-${m}` : `${y}년 ${+m}월`; }, (v) => `${usd2(v)}${krwOf(v) ? ' · ' + krwOf(v) : ''}`) },
        scales: { x: { ...axisX(labels, (m) => `${+m.slice(5)}${EN ? '' : '월'}`, 12), stacked: true }, y: { ...axisY((v) => '$' + nf(0).format(v)), stacked: true, beginAtZero: true } },
      },
    });
  }

  // ---- 입력 폼: 한 줄 = 한 종목(티커 · 수량 · 평단 · [거래 내역]).
  // [거래 내역]을 누르면 그 종목의 거래 창: 맨 위 '📷 사진으로 넣기', 아래 캘린더로 직접 넣기·지금 넣은 거래 목록.
  // 거래 내역이 있으면 수량·평단은 거래 내역으로 계산되고(평균 단가 방식), 배당은 배당락일 전날 보유 수량으로 계산한다.
  const fmtSh = (v) => nf(v % 1 ? 2 : 0).format(v);
  function divRowHtml(r, i) {
    const n = r.trades?.length || 0;
    const ds = n ? r.trades.map((x) => x.d).sort() : [];
    const label = n ? `거래 ${n}건` : r.d ? `매수일 ${r.d.slice(2).replace(/-/g, '.')}` : '거래 내역';
    return `<div class="f-row d-row" data-row="${i}">
      <input class="d-t" list="d-tickers" value="${esc(krTk(r.t) ? `${r.t}` : r.t || '')}" placeholder="티커·종목코드 (예: SCHD, 005930)" aria-label="티커 또는 종목코드" autocapitalize="characters" autocomplete="off" maxlength="24">
      <input class="d-sh" inputmode="decimal" value="${r.sh ?? ''}" placeholder="수량" aria-label="보유 수량" ${n ? 'readonly title="거래 내역으로 계산돼요"' : ''}>
      <input class="d-avg" inputmode="decimal" value="${n && r.avg != null ? r.avg.toFixed(2) : r.avg ?? ''}" placeholder="평단($)" aria-label="평균 단가(달러)" ${n ? 'readonly title="거래 내역으로 계산돼요"' : ''}>
      <button type="button" class="d-tx${n || r.d ? ' has' : ''}" data-dtx="${i}" aria-label="거래 내역 넣기"><span>📅 ${label}</span>${n ? `<small>${ds[0].slice(2).replace(/-/g, '.')} ~ ${ds.at(-1).slice(2).replace(/-/g, '.')}</small>` : '<small>선택 · 사진으로도 넣어요</small>'}</button>
      <button type="button" class="f-rm" data-drm="${i}" aria-label="이 종목 줄 삭제" ${divRows.length < 2 ? 'hidden' : ''}>×</button>
    </div>`;
  }
  function renderDivSet() {
    const el = document.getElementById('c-div-set');
    if (!el) return;
    divRows = divCfg ? divCfg.hold.map((h) => ({ ...h, trades: h.trades ? h.trades.map((x) => ({ ...x })) : undefined })) : [{}];
    const tickers = [...new Set([...WATCH, ...Object.keys(FIRE_TICKERS), 'SCHD', 'JEPI', 'JEPQ', 'O', 'VYM', 'QQQ', 'SPY', 'VOO', 'KO', 'AAPL', 'MSFT', 'MSTY', 'ULTY'])];
    el.innerHTML = `<details class="fire-set" ${divCfg ? '' : 'open'}>
      <summary>${divCfg ? '배당 종목 수정' : '배당 종목 입력'}</summary>
      <form id="div-form" autocomplete="off">
        ${holdImportBtn('div')}
        <div class="f-rows-h"><span>보유 종목</span><small>티커 · 수량 · 평단($) · 거래 내역</small></div>
        <div id="d-rows">${divRows.map(divRowHtml).join('')}</div>
        <datalist id="d-tickers">${tickers.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="d-btns"><button type="button" class="btn-ghost f-add" id="d-add">+ 종목 추가</button><button type="button" class="btn-ghost f-add" data-hiopen="div" data-himode0="search">🔍 종목 검색해서 넣기</button>${fireCfg ? '<button type="button" class="btn-ghost f-add" id="d-import">🔥 보유 종목 불러오기</button>' : ''}</div>
        <p class="note"><b>거래 내역은 선택</b>이에요. <b>📅 거래 내역</b>을 누르면 증권 앱 거래 화면 <b>사진으로 한 번에</b> 넣거나 캘린더로 직접 넣을 수 있어요. 거래 내역을 넣으면 그날들 이후 실제로 받은 배당금까지 계산하고 수량·평단도 자동으로 채워져요. 비워 두면 오늘 산 것으로 보고 앞으로 받을 배당금만 계산해요.</p>
        <label>배당 세금<select id="d-tax"><option value="0.15" ${!divCfg || divCfg.tax === 0.15 ? 'selected' : ''}>세후 — 미국 원천징수 15% 뺀 금액(실제 입금액)</option><option value="0" ${divCfg?.tax === 0 ? 'selected' : ''}>세전 — 세금 빼기 전 금액</option></select></label>
        <div class="fire-btns"><button type="submit" class="btn-primary">저장</button>${divCfg ? `<button type="button" id="d-del" class="btn-ghost">${divConfirmDelete ? '정말 삭제' : '이 기기에서 삭제'}</button>` : ''}</div>
        <p class="note">🔒 입력한 값은 <b>이 기기(브라우저)에만</b> 저장돼요.</p>
        ${moveBtn()}
      </form>
    </details>`;
  }
  // 화면의 입력값(티커·수량·평단)을 divRows에 반영(거래 내역은 divRows에만 있다)
  function syncRowsFromDom() {
    for (const el of document.querySelectorAll('#d-rows .d-row')) {
      const r = divRows[+el.dataset.row];
      if (!r) continue;
      r.t = el.querySelector('.d-t').value.trim().toUpperCase();
      if (!r.trades?.length) {
        r.sh = parseFloat(el.querySelector('.d-sh').value.replace(/,/g, '')) || undefined;
        r.avg = parseFloat(el.querySelector('.d-avg').value.replace(/[,$]/g, '')) || undefined;
      }
    }
    return divRows;
  }
  const paintRows = () => { document.getElementById('d-rows').innerHTML = divRows.map(divRowHtml).join(''); };
  async function saveDivForm() {
    syncRowsFromDom();
    for (const r of divRows) if (r.t && !TICKER_RE.test(r.t)) r.t = await resolveTicker(r.t); // 005930·삼성전자 → 005930.KS
    const rows = divRows.filter((r) => r.t || r.sh || r.avg || r.trades?.length);
    const okTrade = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d || '') && x.d <= isoToday() && x.sh > 0 && x.price > 0;
    const bad = rows.find((r) => !TICKER_RE.test(r.t || '') || (r.trades?.length ? !r.trades.every(okTrade) : !(r.sh > 0) || !(r.avg > 0) || (r.d && r.d > isoToday())));
    if (!rows.length || bad) { toast(bad && !TICKER_RE.test(bad.t || '') ? '티커를 확인해 주세요' : '각 줄에 수량·평균 단가를 넣거나 거래 내역을 넣어 주세요', true); return; }
    const hold = rows.map((r) => (r.trades?.length
      ? { t: r.t, ...holdFromTrades(r.trades), trades: [...r.trades].sort((a, b) => (a.d < b.d ? -1 : 1)) }
      : { t: r.t, sh: r.sh, avg: r.avg, d: r.d || isoToday() })); // 거래 내역이 없으면 오늘 산 것으로
    divCfg = { hold, tax: parseFloat(document.getElementById('d-tax')?.value) || 0 };
    writeJSON(DIV_KEY, divCfg);
    divConfirmDelete = false;
    toast('✓ 이 기기에 저장했어요 · 배당 내역 불러오는 중');
    syncHeldToWatch();
    renderDivSet(); renderDiv();
    if (!state.quote) loadQuote().then(renderDiv).catch(() => {});
    loadDividends(true).catch(() => {});
  }
  function deleteDiv() {
    if (DEMO) { toast(EN ? 'This is the sample view — nothing to delete' : '예시 화면이라 지울 내용이 없어요', true); return; }
    if (!divConfirmDelete) { divConfirmDelete = true; const b = document.getElementById('d-del'); if (b) b.textContent = '정말 삭제'; return; }
    divCfg = null; divConfirmDelete = false; state.divData = {};
    try { localStorage.removeItem(DIV_KEY); localStorage.removeItem(DIV_CACHE); } catch {}
    toast('이 기기에서 배당 정보를 지웠어요');
    renderDivSet(); renderDiv();
  }

  // ---- 거래 내역 창(종목 한 줄 전용)
  let txIdx = null, txDraft = [], ocrRows = null;
  function openTxSheet(i) {
    syncRowsFromDom();
    const r = divRows[i];
    if (!TICKER_RE.test(r?.t || '')) { toast('먼저 이 줄의 티커를 넣어 주세요', true); document.querySelector(`#d-rows .d-row[data-row="${i}"] .d-t`)?.focus(); return; }
    txIdx = i; txDraft = (r.trades || []).map((x) => ({ ...x })); ocrRows = null;
    let el = document.getElementById('tx-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tx-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '거래 내역');
      document.body.appendChild(el);
    }
    el.hidden = false;
    document.body.classList.add('sheet-open');
    const Y = new Date().getFullYear();
    el.innerHTML = `<div class="sheet-bg" data-txclose="1"></div><div class="sheet-panel oc-panel">
      <div class="sheet-h"><b>📅 거래 내역 · ${esc(r.t)}</b><button type="button" class="ws-btn" data-txclose="1">닫기</button></div>
      <section class="tx-box tx-photo">
        <b>📷 거래 내역 사진으로 넣기</b>
        <p class="note">증권 앱(예: 도미노)에서 <b>${esc(r.t)}</b> → <b>거래</b> 화면을 캡처해 골라 주세요. 여러 장을 한 번에 골라도 되고, 겹친 부분은 한 번만 넣어요. 사진은 이 기기 안에서만 읽어요.</p>
        <div class="tx-photo-row"><label class="tx-f"><span>거래 연도</span><select id="oc-y" aria-label="거래 연도"><option value="">자동 인식</option>${[0, 1, 2, 3].map((k) => `<option value="${Y - k}">${Y - k}년</option>`).join('')}</select></label>
          <label class="btn-primary oc-pick">사진 고르기<input type="file" id="oc-file" accept="image/*" multiple hidden></label></div>
        <p class="note oc-y-note" id="oc-y-note">자동: 날짜 순서를 보고 해를 넘긴 거래는 작년으로 넣어요.</p>
        <p class="oc-status" id="oc-status">처음 한 번은 글자 읽기 엔진(약 7MB)을 받느라 시간이 걸려요.</p>
        <div id="oc-result"></div>
      </section>
      <section class="tx-box">
        <b>캘린더로 직접 넣기</b>
        <div class="tx-manual">
          <label class="tx-f tx-f-d"><span>거래일</span><input type="date" id="tx-d" max="${isoToday()}" value="${esc(r.d && !r.trades?.length ? r.d : '')}"></label>
          <label class="tx-f"><span>${EN ? 'Type' : '구분'}</span><select id="tx-side"><option value="buy">매수</option><option value="sell">매도</option></select></label>
          <label class="tx-f"><span>수량</span><input id="tx-sh" inputmode="decimal" placeholder="주" value="${!r.trades?.length && r.sh ? r.sh : ''}"></label>
          <label class="tx-f"><span>가격</span><input id="tx-p" inputmode="decimal" placeholder="$" value="${!r.trades?.length && r.avg ? r.avg : ''}"></label>
          <button type="button" class="btn-ghost" id="tx-add">+ 추가</button>
        </div>
      </section>
      <section class="tx-box"><div id="tx-list"></div></section>
      <button type="button" class="btn-primary oc-add" id="tx-done">완료</button>
    </div>`;
    paintTxList();
  }
  function closeTxSheet() { const el = document.getElementById('tx-sheet'); if (el) el.hidden = true; document.body.classList.remove('sheet-open'); txIdx = null; }
  function paintTxList() {
    const el = document.getElementById('tx-list');
    if (!el) return;
    const L = [...txDraft].map((x, i) => ({ ...x, i })).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.i - a.i));
    const H = holdFromTrades(txDraft);
    el.innerHTML = L.length
      ? `<div class="tx-sum">${EN ? `<b>${L.length} trades</b><span>Shares held <b>${fmtSh(H.sh)}</b> · Avg cost <b>${H.sh ? '$' + H.avg.toFixed(2) : '–'}</b></span>` : `<b>넣은 거래 ${L.length}건</b><span>남은 수량 <b>${fmtSh(H.sh)}주</b> · 평단 <b>${H.sh ? '$' + H.avg.toFixed(2) : '–'}</b></span>`}</div>
        <div class="div-scroll"><table class="div-tbl tx-tbl"><thead><tr><th>날짜</th><th>${EN ? 'Type' : '구분'}</th><th>수량</th><th>가격</th><th></th></tr></thead><tbody>
        ${L.map((x) => `<tr><td>${x.d.slice(2).replace(/-/g, '.')}</td><td class="${x.sell ? 'down' : 'up'}">${x.sell ? '매도' : '매수'}</td><td>${fmtSh(x.sh)}</td><td>$${x.price.toFixed(2)}</td><td><button type="button" class="tx-rm" data-txrm="${x.i}" aria-label="이 거래 삭제">×</button></td></tr>`).join('')}
        </tbody></table></div><button type="button" class="btn-ghost tx-clear" id="tx-clear">거래 내역 모두 지우기</button>`
      : '<p class="note">아직 넣은 거래가 없어요. 사진으로 넣거나 캘린더로 직접 넣어 주세요. 한 번에 샀다면 매수일·수량·가격 한 줄만 넣으면 돼요.</p>';
  }
  function addManualTrade() {
    const d = document.getElementById('tx-d')?.value || '', sh = parseFloat((document.getElementById('tx-sh')?.value || '').replace(/,/g, '')), p = parseFloat((document.getElementById('tx-p')?.value || '').replace(/[,$]/g, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > isoToday() || !(sh > 0) || !(p > 0)) { toast('날짜·수량·가격을 넣어 주세요(날짜는 오늘 이전)', true); return; }
    txDraft.push({ d, sh, price: p, ...(document.getElementById('tx-side')?.value === 'sell' ? { sell: true } : {}) });
    document.getElementById('tx-sh').value = ''; document.getElementById('tx-p').value = '';
    paintTxList();
  }
  function finishTx() {
    const r = divRows[txIdx];
    if (!r) { closeTxSheet(); return; }
    if (txDraft.length) { r.trades = txDraft.map((x) => ({ ...x })); Object.assign(r, holdFromTrades(r.trades)); delete r.d; }
    else { delete r.trades; }
    paintRows();
    closeTxSheet();
    const det = document.querySelector('#c-div-set details'); if (det) det.open = true;
    toast(txDraft.length ? (EN ? `✓ ${r.t}: ${txDraft.length} trades · ${fmtSh(r.sh)} shares · tap Save below` : `✓ ${r.t} 거래 ${txDraft.length}건 · 수량 ${fmtSh(r.sh)}주로 채웠어요 · 아래 저장을 눌러 주세요`) : (EN ? 'Trade history cleared · tap Save' : '거래 내역을 비웠어요 · 저장을 눌러 주세요'));
  }
  async function runOcr(files) {
    const st = document.getElementById('oc-status'), out = document.getElementById('oc-result');
    if (!files?.length || !window.__tradeOcr) return;
    out.innerHTML = '';
    st.textContent = '글자 읽기 엔진 준비 중…';
    try {
      const rows = await window.__tradeOcr.readShots(files, (m) => {
        if (m.status === 'image') st.textContent = `사진 읽는 중… ${Math.round(m.progress * files.length) + 1}/${files.length}`;
        else if (/load|initializ/i.test(m.status || '')) st.textContent = `글자 읽기 엔진 준비 중… ${Math.round((m.progress || 0) * 100)}%`;
      });
      ocrRows = window.__tradeOcr.assignYears(rows, ocrYear());
      if (rows.length) markUse('ocr');
      renderOcrResult();
    } catch (e) {
      st.textContent = `읽지 못했어요: ${e.message || e}`;
    }
  }
  function ocrYear() { return parseInt(document.getElementById('oc-y')?.value, 10) || null; }
  function paintYearNote() {
    const n = document.getElementById('oc-y-note'), y = ocrYear();
    if (n) n.innerHTML = y ? (EN ? `Every trade read will be dated <b>${y}</b>.` : `읽은 거래는 모두 <b>${y}년</b> 날짜로 넣어요.`) : '자동: 날짜 순서를 보고 해를 넘긴 거래는 작년으로 넣어요.';
  }
  function applyOcrYear() {
    paintYearNote();
    if (!ocrRows?.length) return;
    // 표에서 고친 체크는 그대로 두고 날짜만 다시 매긴다
    const off = new Set([...document.querySelectorAll('#oc-result .oc-on')].filter((c) => !c.checked).map((c) => c.dataset.i));
    window.__tradeOcr.assignYears(ocrRows, ocrYear());
    renderOcrResult();
    off.forEach((i) => { const c = document.querySelector(`#oc-result .oc-on[data-i="${i}"]`); if (c) c.checked = false; });
  }
  function renderOcrResult() {
    const st = document.getElementById('oc-status'), out = document.getElementById('oc-result');
    const R = ocrRows || [];
    if (!R.length) { st.textContent = '거래 내역을 찾지 못했어요. 증권 앱의 거래 화면 캡처인지 확인해 주세요.'; return; }
    const buys = R.filter((r) => r.side === 'buy'), sells = R.filter((r) => r.side === 'sell');
    const net = buys.reduce((n, r) => n + r.sh, 0) - sells.reduce((n, r) => n + r.sh, 0);
    const today = isoToday(), bad = (r) => !r.ok || !r.d || r.d > today;
    const warn = R.filter(bad).length;
    st.innerHTML = EN
      ? `Read <b>${R.length} trades</b> · ${buys.length} buys · ${sells.length} sells · net <b>${fmtSh(net)} sh</b>${warn ? ` · <span class="warn">⚠ ${warn} to check</span>` : ''}`
      : `<b>${R.length}건</b>을 읽었어요 · 매수 ${buys.length}건 · 매도 ${sells.length}건 · 매수−매도 <b>${fmtSh(net)}주</b>${warn ? ` · <span class="warn">⚠ 확인 필요 ${warn}건</span>` : ''}`;
    out.innerHTML = `<div class="div-scroll oc-scroll"><table class="div-tbl oc-tbl"><thead><tr><th></th><th>날짜</th><th>${EN ? 'Type' : '구분'}</th><th>수량</th><th>가격</th><th>금액</th></tr></thead><tbody>
      ${R.map((r, i) => `<tr class="${bad(r) ? 'oc-warn' : ''}"><td><input type="checkbox" class="oc-on" data-i="${i}" checked aria-label="넣기"></td>
        <td><input type="date" class="oc-d" data-i="${i}" value="${esc(r.d || '')}" max="${isoToday()}" aria-label="날짜"></td>
        <td class="${r.side === 'buy' ? 'up' : 'down'}">${r.side === 'buy' ? '매수' : '매도'}</td><td>${nf(r.sh % 1 ? 4 : 0).format(r.sh)}</td><td>$${r.price.toFixed(2)}</td><td>$${nf(2).format(r.amount)}${bad(r) ? '<small>⚠ 확인</small>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">⚠ 표시는 날짜를 못 읽었거나 오늘 이후 날짜이거나, 금액 ÷ 가격이 딱 떨어지지 않은 줄이에요. 날짜를 고치거나 체크를 빼 주세요. 수량은 금액 ÷ 가격으로 계산했어요.</p>
      <label class="chk oc-replace"><input type="checkbox" id="oc-replace" ${txDraft.length ? '' : 'checked'}> 지금 넣어 둔 거래 내역은 지우고 이 기록으로 바꾸기</label>
      <button type="button" class="btn-primary oc-add" id="oc-add">${EN ? `Add ${R.length} trades to history` : `${R.length}건 거래 내역에 넣기`}</button>`;
  }
  function addOcrRows() {
    const pick = [];
    for (const cb of document.querySelectorAll('#oc-result .oc-on')) {
      if (!cb.checked) continue;
      const r = ocrRows[+cb.dataset.i], d = document.querySelector(`#oc-result .oc-d[data-i="${cb.dataset.i}"]`)?.value || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('날짜가 빈 줄이 있어요. 날짜를 넣거나 체크를 빼 주세요', true); return; }
      if (d > isoToday()) { toast(`${d}: 오늘 이후 날짜예요. 연도를 확인하거나 날짜를 고쳐 주세요`, true); return; }
      pick.push({ d, sh: r.sh, price: r.price, ...(r.side === 'sell' ? { sell: true } : {}) });
    }
    if (!pick.length) { toast('넣을 줄을 골라 주세요', true); return; }
    txDraft = document.getElementById('oc-replace')?.checked ? pick : [...txDraft, ...pick];
    ocrRows = null;
    document.getElementById('oc-result').innerHTML = '';
    document.getElementById('oc-status').innerHTML = EN ? `✓ Added <b>${pick.length} trades</b> below. Check them and tap <b>Done</b>.` : `✓ <b>${pick.length}건</b>을 아래 거래 내역에 넣었어요. 확인하고 <b>완료</b>를 눌러 주세요.`;
    paintTxList();
    document.getElementById('tx-list')?.scrollIntoView({ block: 'nearest' });
  }
  function importFireToDiv() {
    syncRowsFromDom();
    const have = divRows.filter((r) => r.t);
    const add = (fireCfg?.positions || []).filter((p) => !have.some((r) => r.t === p.ticker)).map((p) => ({ t: p.ticker, sh: p.shares, avg: +p.avg.toFixed(4) }));
    if (!add.length) { toast('불러올 새 종목이 없어요'); return; }
    divRows = [...have, ...add];
    paintRows();
    toast('🔥 보유 종목을 불러왔어요 · 거래 내역은 넣어도 되고 비워도 돼요');
  }

  // ---- 🧩 홈 화면 편집: 홈 구역 순서·숨기기, 아래 탭의 USDC·Arc 숨기기(이 기기에 저장)
  const HOME_SECTIONS = [
    ['fire', () => (EN ? '🔥 My money' : '🔥 내 돈 요약'), ['home-fire'], () => (EN ? 'FIRE · Dividends · Tax' : '퇴사까지 · 배당금 · 세금')],
    ['stocks', () => (EN ? '📈 My stocks' : '📈 내 종목'), ['ss-head', 'ss-folders', 'stock-switch', 'home-crcl', 'home-stock']],
    ['market', () => (EN ? '📊 Market' : '📊 시장'), ['mk-tabs', 'c-market', 'c-feargreed', 'c-flow'], () => (EN ? 'Overview · Fear & Greed · Money flow' : '개요 · 공포탐욕 · 자금 동향')],
  ];
  const DEFAULT_ORDER = ['fire', 'market', 'stocks'];
  // 휴대폰 홈: 시장 개요·공포탐욕·자금 동향을 탭 하나로(넓은 화면은 셋 다 보임)
  const MK_TABS = [['market', 'c-market', () => (EN ? '📊 Overview' : '📊 시장 개요')], ['fg', 'c-feargreed', () => (EN ? '😨 Fear & Greed' : '😨 공포·탐욕')], ['flow', 'c-flow', () => (EN ? '💸 Money flow' : '💸 자금 동향')]];
  function applyMkTab() {
    const cur = MK_TABS.some((x) => x[0] === loadPref('mktab', 'market')) ? loadPref('mktab', 'market') : 'market';
    const el = document.getElementById('mk-tabs');
    if (el) el.innerHTML = MK_TABS.map(([k, , l]) => `<button type="button" role="tab" data-mktab="${k}" aria-selected="${k === cur}">${l()}</button>`).join('');
    for (const [k, id] of MK_TABS) document.getElementById(id)?.classList.toggle('mk-off', k !== cur);
  }
  // 휴대폰 홈: 선택한 종목의 핵심 지표·현재 상황 요약은 접어 두고 버튼으로 펼친다
  function applyHsMore() {
    const open = loadPref('hsmore', '0') === '1';
    for (const id of ['home-crcl', 'home-stock']) document.getElementById(id)?.classList.toggle('hs-open', open);
    for (const b of document.querySelectorAll('[data-hsmore]')) { b.setAttribute('aria-expanded', String(open)); b.innerHTML = `${open ? (EN ? 'Hide key metrics & summary' : '핵심 지표·현재 상황 요약 접기') : (EN ? 'Show key metrics & summary' : '핵심 지표·현재 상황 요약 보기')} <span aria-hidden="true">${open ? '▴' : '▾'}</span>`; }
  }
  function homeLayout() {
    const L = readJSON('cw.homeLayout', null) || {};
    const order = (L.order || []).filter((k) => HOME_SECTIONS.some((x) => x[0] === k));
    // 새로 생긴 구역은 기본 순서에서 바로 앞 구역 뒤에 끼워 넣는다
    DEFAULT_ORDER.forEach((k, i) => { if (order.includes(k)) return; const prev = DEFAULT_ORDER.slice(0, i).reverse().find((x) => order.includes(x)); order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k); });
    return { order, off: (L.off || []).filter((k) => HOME_SECTIONS.some((x) => x[0] === k)), tabs: true }; // USDC·Arc 탭은 항상 보임
  }
  function applyHomeLayout() {
    const L = homeLayout();
    L.order.forEach((k, i) => { for (const id of HOME_SECTIONS.find((x) => x[0] === k)[2]) { const el = document.getElementById(id); if (el) { el.style.order = String(10 + i); el.classList.toggle('hl-off', L.off.includes(k)); } } });
    const he = document.getElementById('home-edit'); if (he) he.style.order = '99';
    const ch = document.getElementById('ch-card'); if (ch) { ch.style.order = '98'; ch.classList.remove('hl-off'); } // 돼용의 투자 채널은 항상 맨 아래
    applyMkTab(); applyHsMore();
    TAB_SETS.CRCL = CRCL_TABS.filter(([v]) => L.tabs || !['usdc', 'arc'].includes(v));
    renderTabbar();
    if (state.view && !viewAllowed(state.view)) showView('home');
  }
  function saveHomeLayout(L) { writeJSON('cw.homeLayout', L); applyHomeLayout(); paintHomeEdit(); }
  function paintHomeEdit() {
    const el = document.getElementById('he-sheet');
    if (!el || el.hidden) return;
    const L = homeLayout();
    el.innerHTML = `<div class="sheet-bg" data-heclose="1"></div><div class="sheet-panel he-panel">
      <div class="sheet-h"><b>🧩 ${EN ? 'Customize Home' : '홈 화면 편집'}</b><button type="button" class="ws-btn" data-heclose="1">${EN ? 'Done' : '완료'}</button></div>
      <p class="note">${EN ? 'Reorder or hide sections. Saved on this device.' : '자주 보는 건 위로, 안 보는 건 숨겨요. 이 기기에 저장돼요.'}</p>
      <ul class="he-list">${L.order.map((k, i) => { const S = HOME_SECTIONS.find((x) => x[0] === k), on = !L.off.includes(k); return `<li class="${on ? '' : 'off'}"><span class="he-nm"><b>${S[1]()}</b>${S[3] ? `<small>${S[3]()}</small>` : ''}</span>
        <label class="he-sw"><input type="checkbox" data-heon="${k}" ${on ? 'checked' : ''}><span>${on ? (EN ? 'Shown' : '보이기') : (EN ? 'Hidden' : '숨김')}</span></label>
        <button type="button" class="ws-btn" data-hemove="${k}:-1" aria-label="${EN ? 'Move up' : '위로'}" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="ws-btn" data-hemove="${k}:1" aria-label="${EN ? 'Move down' : '아래로'}" ${i === L.order.length - 1 ? 'disabled' : ''}>▼</button></li>`; }).join('')}</ul>
      <button type="button" class="btn-ghost he-reset" data-hereset="1">↺ ${EN ? 'Reset to default' : '처음 상태로'}</button>
    </div>`;
  }
  function openHomeEdit() {
    let el = document.getElementById('he-sheet');
    if (!el) { el = document.createElement('div'); el.id = 'he-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', EN ? 'Customize Home' : '홈 화면 편집'); document.body.appendChild(el); }
    el.hidden = false; document.body.classList.add('sheet-open');
    paintHomeEdit();
  }
  function closeHomeEdit() { const el = document.getElementById('he-sheet'); if (el) el.hidden = true; document.body.classList.remove('sheet-open'); }

  // ---- 👀 예시로 둘러보기 위쪽 띠
  function renderDemoBar() {
    if (!DEMO) return;
    const bar = document.createElement('div');
    bar.className = 'demo-bar'; bar.id = 'demo-bar';
    bar.innerHTML = `<span><b>👀 ${EN ? 'Sample portfolio' : '예시 포트폴리오로 보는 중'}</b><small>${EN ? 'Nothing is saved' : '내 정보엔 저장되지 않아요'}</small></span><button type="button" data-demo="off">${EN ? 'Start with mine' : '내 정보로 시작'}</button>`;
    document.querySelector('header.top')?.after(bar);
  }

  // ---- 🔄 다른 기기로 옮기기 — assets/move.js(누를 때만 받음). 코드로 암호화해 10분만 서버에 두고, 받으면 바로 지운다
  const MOVE_KEYS = ['cw.memo', 'cw.theme', 'cw.fire', 'cw.fireHist', 'cw.div', 'cw.divSim', 'cw.watch', 'cw.life', 'cw.bonus', 'cw.kw', 'cw.votes', 'cw.fireMile', 'cw.targets', 'cw.homeLayout', 'cw.pxDay', 'cw.tax', 'cw.grow', 'cw.etax', 'cw.acct', 'cw.fininc', 'cw.rebal'];
  function moveBtn() { return SITE_API ? `<button type="button" class="move-open" data-moveopen="send">🔄 ${EN ? 'Move to another device' : '다른 기기로 옮기기'}<small>${EN ? 'Phone ↔ PC with a short code' : '폰 ↔ PC, 짧은 코드로'}</small></button>` : ''; }
  async function openMove(tab, code) {
    if (DEMO) { toast(EN ? 'Turn off the sample view first' : '예시 화면을 끈 뒤에 써 주세요', true); return; }
    if (!SITE_API) { toast(EN ? 'Available on the live site' : '실제 사이트에서 쓸 수 있어요', true); return; }
    try {
      const m = await import('./move.js?v=2');
      m.openMove({
        EN, esc, toast, api: SITE_API, keys: MOVE_KEYS,
        summary: (data) => {
          const J = (k) => { try { return JSON.parse(data[k]); } catch { return null; } };
          const f = J('cw.fire')?.positions?.length || 0, d = J('cw.div')?.hold?.length || 0, w = J('cw.watch')?.list?.length || 0, h = J('cw.fireHist')?.length || 0;
          return [f && (EN ? `${f} FIRE holdings` : `퇴사까지 보유 종목 ${f}개`), d && (EN ? `${d} dividend stocks` : `배당 종목 ${d}개`), w && (EN ? `${w} watchlist stocks` : `관심 종목 ${w}개`), h > 1 && (EN ? `${h} days of progress history` : `진행률 기록 ${h}일`)].filter(Boolean);
        },
        loadQr: () => new Promise((ok, no) => { if (window.qrcode) return ok(window.qrcode); const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'; sc.onload = () => ok(window.qrcode); sc.onerror = no; document.head.appendChild(sc); }),
        done: () => { markUse('fireSet'); setTimeout(() => location.reload(), 900); },
      }, { tab, code });
    } catch (e) { console.error(e); toast(EN ? 'Could not open' : '화면을 열지 못했어요', true); }
  }

  // ---- 보유 종목 한 번에 넣기(CSV · 증권 앱 캡처 · 검색) → 퇴사까지·배당금의 수량·평단
  // 화면·읽기 코드는 assets/hold-import.js — 버튼을 누를 때만 받아서 첫 로딩에는 영향이 없다
  function holdImportBtn(from) {
    return `<button type="button" class="hi-open" data-hiopen="${from}"><b>📥 CSV·캡처·검색으로 한 번에 넣기</b><small>증권 앱 보유 종목 화면이나 CSV 파일로 수량·평단을 채워요</small></button>`;
  }
  async function holdSearch(q) {
    q = String(q || '').trim();
    if (!q) return [];
    const R = /[가-힣ㄱ-ㅎ]/.test(q) || /^\d/.test(q) ? await krUsSearch(q) : (await getJ(`${NEWS_API}/lookup?q=${encodeURIComponent(q)}`, 10000).catch(() => null))?.results || [];
    return R.filter((r) => TICKER_RE.test(r.symbol || '')).map((r) => (r.code
      ? { symbol: r.symbol, title: r.name, sub: `${r.etf ? 'ETF' : r.exchange === 'KOSDAQ' ? '코스닥' : '코스피'} · ${r.code}`, label: r.name, name: r.name }
      : { symbol: r.symbol, title: r.symbol, sub: [r.kr && r.kr !== r.name && !EN ? r.kr : '', r.name, r.asset === 'ETF' ? 'ETF' : ''].filter(Boolean).join(' · '), label: (!EN && r.kr) || r.name || r.symbol, name: r.name, kr: r.kr }));
  }
  function holdNow(t) {
    const f = fireCfg?.positions.find((p) => p.ticker === t), d = divCfg?.hold.find((h) => h.t === t);
    const one = (x) => `${fmtSh(x.sh)}${EN ? ' sh' : '주'} · ${EN ? 'avg' : '평단'} ${pxS(t, x.avg)}`;
    const F = f && one({ sh: f.shares, avg: f.avg }), D = d && one(d);
    if (F && D && F === D) return F;
    return [F && `${EN ? 'FIRE' : '퇴사까지'} ${F}`, D && `${EN ? 'Dividends' : '배당금'} ${D}`].filter(Boolean).join(' / ');
  }
  const holdName = (t) => (krTk(t) ? fireName(t) : STOCK_INFO[t]?.name || (FIRE_TICKERS[t] || '').split(' · ')[1] || t);
  async function openHoldImport(from, btn, mode) {
    if (btn) btn.disabled = true;
    try {
      const m = await import('./hold-import.js?v=9');
      m.openHoldImport({
        EN, esc, toast, TICKER_RE, krTk, resolveTicker, krName, search: holdSearch, held: holdNow, nameOf: holdName, apply: applyHoldImport,
        fx: async () => { if (!state.quote?.fx?.rate) await loadQuote().catch(() => {}); return state.quote?.fx?.rate || null; },
        markUse: () => markUse('hold'), hasFire: !!fireCfg, hasDiv: !!divCfg,
        knownNames: () => Object.entries(FIRE_TICKERS).map(([t, l]) => [t, [...String(l).split(' · '), STOCK_INFO[t]?.name || ''].filter((x) => /[가-힣]/.test(x))]).filter(([, ns]) => ns.length),
        known: () => new Set([...WATCH, ...BUILTIN, ...FIRE_BASE, ...(fireCfg?.positions || []).map((p) => p.ticker), ...(divCfg?.hold || []).map((h) => h.t)]),
      }, { from, mode });
    } catch (e) { console.error(e); toast(EN ? 'Could not open the import screen' : '불러오기 화면을 열지 못했어요', true); }
    finally { if (btn) btn.disabled = false; }
  }
  // list: [{ t, name, sh, avg }] (평단: 미국 종목 달러 · 한국 종목 원) · replace면 저장된 종목을 이 목록으로 바꾼다
  function applyHoldImport(list, { fire, div, replace }) {
    setTimeout(() => syncHeldToWatch(), 0);
    const done = [];
    let newFire = false, txAdj = 0;
    if (fire) {
      for (const r of list) FIRE_TICKERS[r.t] ||= fireLabel(r.t, r.name);
      const base = replace || !fireCfg ? [] : fireCfg.positions.map((p) => ({ ...p }));
      for (const r of list) {
        const p = base.find((x) => x.ticker === r.t), n = r.name && r.name !== r.t ? { n: r.name } : {};
        if (p) Object.assign(p, { shares: r.sh, avg: r.avg }, n); else base.push({ ticker: r.t, shares: r.sh, avg: r.avg, ...n });
      }
      newFire = !fireCfg;
      fireCfg = normFire({ ...(fireCfg || { goal: 1.5e9, buyFx: null, afterTax: false }), positions: base });
      writeJSON(FIRE_KEY, fireCfg);
      fireSim = null; fireConfirmDelete = false;
      renderFireSet();
      // 받는 중인 시세에는 새 종목이 없을 수 있어서, 그게 끝난 뒤 새 종목까지 다시 받는다
      Promise.resolve(quoteInflight).catch(() => {}).then(loadQuote).then(() => { renderFire(); renderSummary(); renderHomeFire(); }).catch(() => renderFire());
      renderFire(); renderSummary();
      markUse('fireSet');
      done.push(EN ? 'FIRE' : '퇴사까지');
    }
    if (div) {
      const today = isoToday(), base = replace || !divCfg ? [] : divCfg.hold.map((h) => ({ ...h, trades: h.trades?.map((x) => ({ ...x })) }));
      for (const r of list) {
        const i = base.findIndex((h) => h.t === r.t);
        if (i < 0) { base.push({ t: r.t, sh: r.sh, avg: r.avg, d: today }); continue; }
        const h = base[i];
        if (!h.trades?.length) { base[i] = { ...h, sh: r.sh, avg: r.avg }; continue; }
        // 거래 내역이 있는 종목: 지난 기록(받은 배당 계산)은 그대로 두고, 차이만큼 오늘 매수·매도를 더한다
        const H = holdFromTrades(h.trades), diff = Math.round((r.sh - H.sh) * 10000) / 10000;
        if (Math.abs(diff) < 1e-4) continue;
        const px = diff > 0 ? (r.sh * r.avg - H.sh * H.avg) / diff : r.avg;
        if (px > 0) { h.trades.push({ d: today, sh: Math.abs(diff), price: Math.round(px * 10000) / 10000, ...(diff < 0 ? { sell: true } : {}) }); Object.assign(h, holdFromTrades(h.trades)); }
        else base[i] = { t: r.t, sh: r.sh, avg: r.avg, d: h.trades.map((x) => x.d).sort()[0] };
        txAdj++;
      }
      divCfg = normDiv({ hold: base, tax: divCfg?.tax ?? 0.15 });
      writeJSON(DIV_KEY, divCfg);
      divConfirmDelete = false;
      renderDivSet(); renderDiv();
      if (!state.quote) loadQuote().then(renderDiv).catch(() => {});
      loadDividends(true).catch(() => {});
      markUse('divSet');
      done.push(EN ? 'dividends' : '배당금');
    }
    renderHomeFire();
    toast(EN
      ? `✓ ${list.length} holdings saved to ${done.join(' & ')}${newFire ? ' · set your goal in Road to FIRE' : ''}`
      : `✓ ${list.length}종목을 ${done.join('·')}에 반영했어요${newFire ? ' · 목표 금액은 퇴사까지에서 정해 주세요' : ''}${txAdj ? ` · 거래 내역이 있는 ${txAdj}종목은 차이만큼 오늘 거래로 더했어요` : ''}`);
  }

  // ---------------------------------------------------------------- 💼 성과급 계산기 (Fire · 세 번째 탭)
  // 회사별 지급 구조(2026년 기사·노사 합의 기준, 지급률은 사내 공지로 바꿔 넣는다):
  //  - 삼성전자: OPI = 연봉 × 지급률(최대 50%, 연 1회) · TAI = 월 기본급 × 지급률(최대 100%, 상·하반기) · DS 특별성과급(상한 없음, 금액 직접 입력)
  //  - SK하이닉스: PS = 월 기본급(연봉 ÷ 20) × 지급률(2026년 2,964%) · PI = 월 기본급 × 지급률(상·하반기). PS는 현금·자사주로 나눠 지급
  // 세금·4대보험(근로자 부담, 2026): 소득세는 '성과급이 있을 때 − 없을 때' 연간 세금 차이(연말정산 기준) + 지방세 10%,
  //  건강보험 3.595%(보수 상한) · 장기요양 = 건강보험료 × 13.14% · 고용보험 0.9%. 국민연금은 전년도 소득 기준이라 이번 성과급으로 바로 늘지 않는다.
  const BONUS_KEY = 'cw.bonus';
  const BONUS_CO = {
    samsung: { name: EN ? 'Samsung' : '삼성전자', fields: [['opi', 'OPI(초과이익성과급)', '연봉의 %', 50, 50], ['taiH1', 'TAI 상반기(목표달성장려금)', '월 기본급의 %', 100, 100], ['taiH2', 'TAI 하반기', '월 기본급의 %', 100, 100]], special: true, stockLabel: null },
    hynix: { name: EN ? 'SK hynix' : 'SK하이닉스', fields: [['ps', 'PS(초과이익분배금)', '월 기본급의 %', 2964, null], ['piH1', 'PI 상반기(생산성 격려금)', '월 기본급의 %', 150, 150], ['piH2', 'PI 하반기', '월 기본급의 %', 150, 150]], special: false, stockLabel: 'PS 중 자사주 비율' },
    custom: { name: '직접 입력', fields: [], special: false, stockLabel: null },
  };
  let bonusCfg = Object.assign({ co: 'samsung', salary: 10000, base: null, deps: 1, rates: {}, special: 0, amount: 0, stockPct: 50 }, readJSON(BONUS_KEY, {}) || {});
  // 원 금액을 '6억 1,234만원'처럼
  const manwon = (v) => {
    if (v == null || !isFinite(v)) return '–';
    if (EN) return `₩${nf(0).format(Math.round(v))}`;
    const sign = v < 0 ? '-' : '', a = Math.abs(v), eok = Math.floor(a / 1e8), man = Math.round((a - eok * 1e8) / 1e4);
    return sign + (eok ? `${nf(0).format(eok)}억${man ? ` ${nf(0).format(man)}만원` : '원'}` : `${nf(0).format(man)}만원`);
  };
  // 근로소득공제(한도 2,000만원)
  const earnedDed = (G) => Math.min(2e7, G <= 5e6 ? G * 0.7 : G <= 15e6 ? 3.5e6 + (G - 5e6) * 0.4 : G <= 45e6 ? 7.5e6 + (G - 15e6) * 0.15 : G <= 1e8 ? 1.2e7 + (G - 45e6) * 0.05 : 1.475e7 + (G - 1e8) * 0.02);
  const TAX_BR = [[1.4e7, 0.06], [5e7, 0.15], [8.8e7, 0.24], [1.5e8, 0.35], [3e8, 0.38], [5e8, 0.4], [1e9, 0.42], [Infinity, 0.45]];
  function progTax(T) { let tax = 0, lo = 0; for (const [hi, r] of TAX_BR) { if (T <= lo) break; tax += (Math.min(T, hi) - lo) * r; lo = hi; } return tax; }
  function laborCredit(calc, G) {
    const c = calc <= 1.3e6 ? calc * 0.55 : 715000 + (calc - 1.3e6) * 0.3;
    const cap = G <= 3.3e7 ? 740000 : G <= 7e7 ? Math.max(660000, 740000 - (G - 3.3e7) * 0.008) : G <= 1.2e8 ? Math.max(500000, 660000 - (G - 7e7) * 0.5) : Math.max(200000, 500000 - (G - 1.2e8) * 0.5);
    return Math.min(c, cap);
  }
  const HEALTH = 0.03595, LTC = 0.1314, EMPLOY = 0.009, HEALTH_CAP_Y = (4591740 / 0.03595) * 12, PENSION_CAP_Y = 6370000 * 12, PENSION = 0.0475;
  const insOn = (G) => { const h = Math.min(G, HEALTH_CAP_Y) * HEALTH; return { health: h, ltc: h * LTC, employ: G * EMPLOY }; };
  // 연간 근로소득세(결정세액, 지방세 제외) — 기본공제(본인·부양가족 1인 150만원)와 4대보험 공제만 반영한 단순 계산
  function incomeTax(G, deps) {
    const ins = insOn(G), pension = Math.min(G, PENSION_CAP_Y) * PENSION;
    const T = Math.max(0, G - earnedDed(G) - 1.5e6 * Math.max(1, deps) - pension - ins.health - ins.ltc - ins.employ);
    const calc = progTax(T);
    return Math.max(0, calc - laborCredit(calc, G) - 130000);
  }
  function bonusCalc(c = bonusCfg) {
    const CO = BONUS_CO[c.co] || BONUS_CO.custom;
    const salary = Math.max(0, +c.salary || 0) * 1e4, base = Math.max(0, +(c.base ?? 0) || 0) * 1e4 || salary / 20;
    const items = [];
    for (const [k, label, unitTxt] of CO.fields) {
      const r = Math.max(0, +(c.rates?.[k] ?? CO.fields.find((f) => f[0] === k)[3]) || 0) / 100;
      const amt = (k === 'opi' ? salary : base) * r;
      if (amt > 0) items.push({ k, label, amt, rate: r, unitTxt });
    }
    if (CO.special && +c.special > 0) items.push({ k: 'special', label: 'DS 특별성과급', amt: +c.special * 1e4 });
    if (c.co === 'custom' && +c.amount > 0) items.push({ k: 'amount', label: '성과급', amt: +c.amount * 1e4 });
    const B = items.reduce((a, x) => a + x.amt, 0);
    if (!(salary > 0) || !(B > 0)) return { items, B, salary, base, ready: false };
    const deps = Math.max(1, Math.round(+c.deps || 1));
    const taxInc = (incomeTax(salary + B, deps) - incomeTax(salary, deps)) * 1.1; // 지방소득세 10% 포함
    const i0 = insOn(salary), i1 = insOn(salary + B);
    const ins = { health: i1.health - i0.health, ltc: i1.ltc - i0.ltc, employ: i1.employ - i0.employ };
    const insT = ins.health + ins.ltc + ins.employ, net = B - taxInc - insT;
    const marginal = TAX_BR.find(([hi]) => (salary + B) - earnedDed(salary + B) <= hi)?.[1] ?? 0.45;
    const psItem = items.find((x) => x.k === 'ps');
    const stock = c.co === 'hynix' && psItem ? psItem.amt * Math.min(100, Math.max(0, +c.stockPct || 0)) / 100 : 0;
    return { items, B, salary, base, ready: true, taxInc, ins, insT, net, eff: (taxInc + insT) / B, marginal, stock, netRatio: net / B };
  }
  function renderBonus() {
    const el = document.getElementById('c-bonus');
    if (!el) return;
    const c = bonusCfg, CO = BONUS_CO[c.co] || BONUS_CO.custom, R = bonusCalc(c);
    const fx = state.quote?.fx?.rate;
    const field = (k, label, unitTxt, def, max) => `<label class="bn-f"><span>${label}</span><div class="bn-in"><input inputmode="decimal" data-bnrate="${k}" value="${esc(String(c.rates?.[k] ?? def))}" aria-label="${esc(label)}"><em>%</em></div><small>${unitTxt}${max ? ` · 최대 ${max}%` : ''}</small></label>`;
    card('bonus', {
      share: R.ready ? 'bonus' : null,
      title: '💼 성과급 계산기', sub: '삼성전자 · SK하이닉스 성과급 세후 실수령액 추정',
      easy: '연봉과 지급률을 넣으면 성과급이 얼마인지, 세금·4대보험을 떼고 실제로 얼마를 받는지 계산해요. 맨 아래 버튼으로 이 돈을 배당주에 넣으면 배당을 얼마나 받는지도 바로 이어서 볼 수 있어요.',
      info: INFO.bonus,
      body: `<div class="bn-co" role="group" aria-label="회사 선택">${Object.entries(BONUS_CO).map(([k, v]) => `<button type="button" data-bnco="${k}" aria-pressed="${c.co === k}">${v.name}</button>`).join('')}</div>
        <div class="bn-grid">
          <label class="bn-f"><span>연봉 <small>(성과급 제외)</small></span><div class="bn-in"><input inputmode="numeric" id="bn-salary" value="${esc(String(c.salary ?? ''))}" aria-label="연봉(만원)"><em>만원</em></div><small>${manwon((+c.salary || 0) * 1e4)}</small></label>
          ${c.co !== 'custom' ? `<label class="bn-f"><span>월 기본급</span><div class="bn-in"><input inputmode="numeric" id="bn-base" value="${esc(c.base == null ? '' : String(c.base))}" placeholder="${nf(0).format(Math.round((+c.salary || 0) / 20))}" aria-label="월 기본급(만원)"><em>만원</em></div><small>비우면 연봉 ÷ 20 · 급여명세서 기본급이 정확</small></label>` : ''}
          ${CO.fields.map(([k, l, u, d, m]) => field(k, l, u, d, m)).join('')}
          ${CO.special ? `<label class="bn-f"><span>DS 특별성과급 <small>(선택)</small></span><div class="bn-in"><input inputmode="numeric" id="bn-special" value="${esc(String(c.special || ''))}" placeholder="0" aria-label="특별성과급(만원)"><em>만원</em></div><small>영업이익 연동·상한 없음 → 공지된 1인 금액</small></label>` : ''}
          ${c.co === 'custom' ? `<label class="bn-f"><span>성과급 금액</span><div class="bn-in"><input inputmode="numeric" id="bn-amount" value="${esc(String(c.amount || ''))}" aria-label="성과급(만원)"><em>만원</em></div><small>세전 금액</small></label>` : ''}
          ${CO.stockLabel ? `<label class="bn-f"><span>${CO.stockLabel}</span><div class="bn-in"><input inputmode="numeric" id="bn-stock" value="${esc(String(c.stockPct ?? 50))}" aria-label="${CO.stockLabel}"><em>%</em></div><small>2026년 합의: 현금 50% · 자사주 50%</small></label>` : ''}
          <label class="bn-f"><span>본인 포함 부양가족</span><div class="bn-in"><input inputmode="numeric" id="bn-deps" value="${esc(String(c.deps || 1))}" aria-label="부양가족 수"><em>명</em></div><small>1인당 150만원 기본공제</small></label>
        </div>
        ${R.ready ? `<div class="bn-out">
          <div class="bn-hero"><span>예상 실수령액</span><b>${manwon(R.net)}</b><small>세전 ${manwon(R.B)}의 ${pctPlain(R.netRatio, 1)}${fx ? ` · 약 ${usd(R.net / fx)}` : ''}</small></div>
          <ul class="bn-rows">
            ${R.items.map((x) => `<li><span>${esc(x.label)}${x.rate != null ? ` <small>${pctPlain(x.rate, 0)} × ${x.k === 'opi' ? '연봉' : '월 기본급'}</small>` : ''}</span><b>${manwon(x.amt)}</b></li>`).join('')}
            <li class="bn-sum"><span>세전 합계</span><b>${manwon(R.B)}</b></li>
            <li class="bn-minus"><span>소득세 + 지방소득세 <small>최고 세율 구간 ${pctPlain(R.marginal * 1.1, 1)}</small></span><b>−${manwon(R.taxInc)}</b></li>
            <li class="bn-minus"><span>건강·장기요양·고용보험</span><b>−${manwon(R.insT)}</b></li>
            <li class="bn-net"><span>실수령액 <small>떼는 비율 ${pctPlain(R.eff, 1)}</small></span><b>${manwon(R.net)}</b></li>
            ${R.stock ? `<li><span>그중 자사주로 받는 몫 <small>현금은 약 ${manwon(R.net - R.stock * R.netRatio)}</small></span><b>${manwon(R.stock * R.netRatio)}</b></li>` : ''}
          </ul>
          <p class="note">연말정산 기준 추정이에요. 지급하는 달에는 간이세액표로 떼서 금액이 다를 수 있고, 차이는 연말정산에서 정산돼요. 다른 공제(카드·연금저축·주택 등)가 있으면 세금이 줄어요. 지급률·기본급은 사내 공지와 급여명세서로 확인해 주세요.</p>
          <button type="button" class="btn-primary bn-go" data-bngo="1">💰 이 돈으로 배당 포트폴리오 짜보기 →</button>
        </div>` : `<p class="note">${c.co === 'custom' ? '연봉과 성과급 금액을 넣어 주세요.' : '연봉과 지급률을 넣으면 바로 계산돼요.'}</p>`}`,
    });
  }
  let bonusTimer = null;
  function readBonusForm() {
    const v = (id) => { const x = document.getElementById(id); return x ? x.value.replace(/[,\s]/g, '') : undefined; };
    const num = (s) => (s === '' || s == null ? null : parseFloat(s));
    const c = bonusCfg;
    if (v('bn-salary') !== undefined) c.salary = num(v('bn-salary')) ?? 0;
    if (v('bn-base') !== undefined) c.base = num(v('bn-base'));
    if (v('bn-special') !== undefined) c.special = num(v('bn-special')) ?? 0;
    if (v('bn-amount') !== undefined) c.amount = num(v('bn-amount')) ?? 0;
    if (v('bn-stock') !== undefined) c.stockPct = num(v('bn-stock')) ?? 0;
    if (v('bn-deps') !== undefined) c.deps = num(v('bn-deps')) ?? 1;
    c.rates = c.rates || {};
    for (const x of document.querySelectorAll('[data-bnrate]')) c.rates[x.dataset.bnrate] = num(x.value.replace(/[,\s]/g, '')) ?? 0;
    writeJSON(BONUS_KEY, c);
  }
  // 입력하는 동안에는 결과만 바꾼다(입력칸을 다시 그리면 커서가 빠지므로)
  function bonusInput() {
    readBonusForm();
    renderHomeFire();
    clearTimeout(bonusTimer);
    bonusTimer = setTimeout(() => {
      const a = document.activeElement, id = a?.id, rate = a?.dataset?.bnrate, pos = a?.selectionStart;
      renderBonus();
      const b = id ? document.getElementById(id) : rate ? document.querySelector(`[data-bnrate="${rate}"]`) : null;
      if (b) { b.focus({ preventScroll: true }); try { b.setSelectionRange(pos, pos); } catch {} }
    }, 350);
  }

  // ---------------------------------------------------------------- 🧮 배당 포트폴리오 짜보기 (배당금 탭)
  // 투자금과 종목·비중을 넣으면 현재가로 몇 주 살 수 있는지, 그만큼 들고 있으면 배당을 얼마나 받는지(최근 1년 배당 기준) 계산한다.
  const SIM_KEY = 'cw.divSim';
  let simCfg = Object.assign({ amount: 40000, unit: 'manwon', rows: [{ t: 'SCHD', w: 40 }, { t: 'JEPI', w: 30 }, { t: 'O', w: 30 }] }, readJSON(SIM_KEY, {}) || {});
  simCfg.rows = (simCfg.rows || []).filter((r) => r?.t).map((r) => ({ ...r, w: Math.round(+r.w || 0) })); // 빈 줄 정리·비중 정수
  state.simData = {};
  state.simErr = {};
  // 많이 알려진 배당 종목(눌러서 하나씩 추가) — [티커, 이름, 무엇을 따라가는지]
  const SIM_CATALOG = [
    ['us-month', '🇺🇸 월배당', [
      ['JEPI', 'JPMorgan Equity Premium Income', 'S&P500 우량주 + 콜옵션 매도(커버드콜)로 매달 분배'],
      ['JEPQ', 'JPMorgan Nasdaq Equity Premium Income', '나스닥100 기술주 + 커버드콜, 매달 분배'],
      ['O', '리얼티인컴', '상가·물류 건물을 빌려주는 리츠, 매달 배당하는 회사'],
      ['MAIN', 'Main Street Capital', '중소기업에 대출·투자하는 회사(BDC), 매달 배당'],
      ['SPHD', 'Invesco S&P 500 High Div Low Vol', 'S&P500 중 배당 높고 덜 출렁이는 50종목, 매달 분배'],
      ['DIVO', 'Amplify CWP Enhanced Dividend Income', '배당 우량주 + 일부 커버드콜, 매달 분배'],
      ['STAG', 'STAG Industrial', '미국 물류창고 리츠, 매달 배당'],
    ]],
    ['us-high', '🇺🇸 고배당 ETF', [
      ['SCHD', 'Schwab U.S. Dividend Equity', '10년 넘게 배당한 재무 우량 미국 기업 100곳(다우존스 미국배당100), 분기 배당'],
      ['VYM', 'Vanguard High Dividend Yield', '배당 높은 미국 대형주 400여 곳, 분기 배당'],
      ['HDV', 'iShares Core High Dividend', '이익이 탄탄한 고배당 75종목, 분기 배당'],
      ['DGRO', 'iShares Core Dividend Growth', '5년 넘게 배당을 늘려 온 기업, 분기 배당'],
      ['VIG', 'Vanguard Dividend Appreciation', '10년 넘게 배당을 늘려 온 기업, 분기 배당'],
      ['NOBL', 'ProShares S&P 500 Dividend Aristocrats', '25년 넘게 배당을 늘린 S&P500 배당귀족, 분기 배당'],
      ['SPYD', 'SPDR Portfolio S&P 500 High Dividend', 'S&P500 중 배당수익률 상위 80종목을 같은 비중으로'],
    ]],
    ['us-cc', '🇺🇸 커버드콜', [
      ['QYLD', 'Global X Nasdaq 100 Covered Call', '나스닥100 전체에 콜옵션을 팔아 높은 분배(주가 상승은 제한)'],
      ['XYLD', 'Global X S&P 500 Covered Call', 'S&P500 커버드콜, 매달 분배'],
      ['RYLD', 'Global X Russell 2000 Covered Call', '중소형주(러셀2000) 커버드콜, 매달 분배'],
      ['MSTY', 'YieldMax MSTR Option Income', '스트래티지(MSTR) 한 종목 옵션 수익, 분배가 크고 변동도 커요'],
      ['NVDY', 'YieldMax NVDA Option Income', '엔비디아 한 종목 옵션 수익으로 분배'],
      ['ULTY', 'YieldMax Ultra Option Income', '변동성 큰 여러 종목 옵션 수익, 매주 분배'],
    ]],
    ['kr-div', '🇰🇷 국내 배당 ETF', [
      ['458730.KS', 'TIGER 미국배당다우존스', 'SCHD와 같은 지수(미국배당100)를 원화로, 매달 분배'],
      ['446720.KS', 'SOL 미국배당다우존스', 'SCHD와 같은 지수를 원화로, 매달 분배'],
      ['161510.KS', 'PLUS 고배당주', '국내 배당 높은 기업 30곳, 매달 분배'],
      ['0105E0.KS', 'SOL 코리아고배당', '국내 고배당 기업, 매달 분배'],
      ['329200.KS', 'TIGER 리츠부동산인프라', '국내 상장 리츠·인프라 펀드 모음, 분기 분배'],
    ]],
    ['kr-cc', '🇰🇷 국내 커버드콜', [
      ['498400.KS', 'KODEX 200타겟위클리커버드콜', '코스피200 + 매주 콜옵션 매도, 매달 분배'],
      ['486290.KS', 'TIGER 미국나스닥100타겟데일리커버드콜', '나스닥100 + 매일 콜옵션 매도, 매달 분배'],
      ['494300.KS', 'KODEX 미국나스닥100데일리커버드콜OTM', '나스닥100 + 매일 외가격 콜 매도(상승 여지 남김)'],
      ['472150.KS', 'TIGER 배당커버드콜액티브', '국내 배당주 + 커버드콜, 매달 분배'],
      ['441640.KS', 'KODEX 미국배당커버드콜액티브', '미국 배당주 + 커버드콜, 매달 분배'],
    ]],
    ['kr-stock', '🇰🇷 국내 배당주', [
      ['005930.KS', '삼성전자', '반도체·스마트폰, 분기 배당'],
      ['105560.KS', 'KB금융', '은행 지주회사, 분기 배당'],
      ['055550.KS', '신한지주', '은행 지주회사, 분기 배당'],
      ['086790.KS', '하나금융지주', '은행 지주회사, 분기 배당'],
      ['017670.KS', 'SK텔레콤', '통신사, 분기 배당'],
      ['033780.KS', 'KT&G', '담배·인삼, 반기·연 배당'],
    ]],
  ];
  for (const c of SIM_CATALOG) for (const x of c[2]) if (krTk(x[0])) keepName(x[1]);
  let simSearchOpen = false, simResults = [], simSearchTimer = null;
  const catYld = {}; // 대표 종목 최근 1년 배당률(세전)
  const simYield = (d) => { if (!d?.price || !d.events?.length) return null; const cut = addDays(isoToday(), -365); const sum = d.events.filter((e) => e.ex > cut).reduce((a, e) => a + e.amt, 0); return sum > 0 ? sum / d.price : null; };
  const catYldTxt = (t) => (!(t in catYld) ? '<small>배당률 불러오는 중…</small>' : catYld[t] == null ? '' : `최근 1년 배당률 <b>${pctPlain(catYld[t], 1)}</b>`);
  async function loadCatYields(cat) {
    const C = SIM_CATALOG.find((c) => c[0] === cat);
    if (!C) return;
    await Promise.all(C[2].map(async ([t]) => {
      if (!(t in catYld)) {
        try {
          let d = state.simData[t]?.d || state.divData[t]?.d;
          if (!d) { const j = await getJ(`${NEWS_API}/dividends?s=${t}`, 20000); if (j.error) throw new Error(j.error); d = j; state.simData[t] = { t: Date.now(), d: j }; }
          catYld[t] = simYield(d);
        } catch { catYld[t] = null; }
      }
      const el = document.querySelector(`[data-yld="${t}"]`); if (el) el.innerHTML = catYldTxt(t);
    }));
  }
  const simRowName = (r) => r.n || simCatName(r.t) || state.simData[r.t]?.d?.name || '';
  // 미국은 영문 티커·회사명(서버 검색), 한국은 한글 이름·종목코드(휴대폰 안 목록)
  async function findSyms(q) {
    const korean = /[가-힣ㄱ-ㅎ]/.test(q) || /^\s*\d/.test(q);
    if (korean) return krUsSearch(q);
    try { return (await getJ(`${NEWS_API}/lookup?q=${encodeURIComponent(q.trim())}`, 10000)).results || []; } catch { return []; }
  }
  function simResHtml() {
    const q = document.getElementById('sim-q')?.value.trim() || '';
    if (!q) return '<li class="empty">미국은 티커나 영문·한글 회사명(테슬라), 한국은 종목명이나 종목코드로 찾아요</li>';
    if (simResults === null) return '<li class="empty">검색 중…</li>';
    const have = new Set(simCfg.rows.map((r) => r.t));
    const res = simResults.filter((r) => TICKER_RE.test(r.symbol)).slice(0, 12);
    return res.map((r) => { const kr = krTk(r.symbol), nm = r.name || r.symbol; return `<li>${logoPath(r.symbol) ? `<span class="ws-logo"><img src="${logoPath(r.symbol)}" alt="" width="22" height="22" loading="lazy"></span>` : `<span class="ws-logo ws-letter">${esc(String((kr ? nm : r.symbol) || '?')[0])}</span>`}<div class="ws-name"><b>${esc(kr ? nm : r.symbol)}</b><small>${esc(kr ? `${r.exchange === 'KOSDAQ' ? '코스닥' : '코스피'} · ${r.symbol.slice(0, 6)}${r.etf ? ' · ETF' : ''}` : r.kr && !EN && r.kr !== nm ? `${r.kr} · ${nm}` : nm)}</small></div>${have.has(r.symbol) ? '<em class="sim-added">✓ 추가됨</em>' : `<button type="button" class="ws-btn add" data-simres="${esc(r.symbol)}" data-n="${esc(nm)}">+ 추가</button>`}</li>`; }).join('') || '<li class="empty">찾는 종목이 없어요</li>';
  }
  function simSearch(q) {
    clearTimeout(simSearchTimer);
    const paint = () => { const el = document.getElementById('sim-res'); if (el) el.innerHTML = simResHtml(); };
    if (!q.trim()) { simResults = []; paint(); return; }
    simSearchTimer = setTimeout(async () => {
      simResults = null; paint();
      const r = await findSyms(q);
      if ((document.getElementById('sim-q')?.value || '') !== q) return;
      simResults = r; paint();
    }, 250);
  }
  // 예전에 코드로만 저장된 한국 종목 줄은 이름을 채운다
  let simNameTried = false;
  async function fillSimNames() {
    const miss = simCfg.rows.filter((r) => krTk(r.t) && !simRowName(r));
    if (!miss.length || simNameTried) return;
    simNameTried = true;
    for (const r of miss) r.n = (await krName(r.t)) || undefined;
    writeJSON(SIM_KEY, simCfg); renderDivSim();
  }
  const simCatName = (t) => SIM_CATALOG.flatMap((c) => c[2]).find((x) => x[0] === t)?.[1];
  let simCat = null; // 펼친 분류
  async function loadSimData() {
    const syms = [...new Set(simCfg.rows.map((r) => r.t).filter((t) => TICKER_RE.test(t)))];
    await Promise.all(syms.map(async (s) => {
      const c = state.simData[s] || (state.divData[s] ? { t: state.divData[s].t, d: state.divData[s].d } : null);
      if (c && Date.now() - c.t < 3 * 3600000) { state.simData[s] = c; return; }
      try {
        const j = await getJ(`${NEWS_API}/dividends?s=${s}`, 20000);
        if (j.error) throw new Error(j.error);
        state.simData[s] = { t: Date.now(), d: j };
        delete state.simErr[s];
      } catch (e) { state.simErr[s] = String(e.message || e); }
    }));
  }
  // 최근 1년 주당 배당(세전). 상장 1년이 안 된 종목은 지금까지 낸 배당을 1년으로 늘려 계산
  function trailingDps(D) {
    const ev = (D?.events || []).slice().sort((a, b) => a.ex.localeCompare(b.ex));
    if (!ev.length) return { dps: 0, n: 0, months: [] };
    const from = addDays(isoToday(), -365), last = ev.filter((e) => e.ex > from);
    let dps = last.reduce((a, e) => a + e.amt, 0);
    const first = ev[0].ex;
    if (first > from) { const days = Math.max(30, daysBetween(first, isoToday())); dps = dps * Math.min(4, 365 / days); }
    const months = Array(12).fill(0);
    for (const e of last) months[+e.ex.slice(5, 7) - 1] += e.amt;
    return { dps, n: last.length, months };
  }
  function simCalc() {
    const fx = state.quote?.fx?.rate;
    const amt = +simCfg.amount || 0;
    const budget = simCfg.unit === 'usd' ? amt : fx ? (amt * 1e4) / fx : null; // 달러로 계산
    const rows = simCfg.rows.filter((r) => r.t);
    const wSum = rows.reduce((a, r) => a + Math.max(0, +r.w || 0), 0) || 1;
    const out = rows.map((r) => {
      const D = state.simData[r.t]?.d, kr = krTk(r.t), f = kr ? (fx ? 1 / fx : null) : 1; // f: 달러로 바꾸는 값
      const px = D?.price, pxUsd = px != null && f ? px * f : null;
      const share = Math.max(0, +r.w || 0) / wSum, alloc = budget != null ? budget * share : null;
      const qty = pxUsd && alloc != null ? Math.floor(alloc / pxUsd) : null;
      const cost = qty != null ? qty * pxUsd : null;
      const T = trailingDps(D), dpsUsd = f ? T.dps * f : 0, taxK = kr ? 0.846 : 0.85;
      const yearGross = qty != null ? qty * dpsUsd : null;
      return { ...r, D, kr, px, share, alloc, qty, cost, dps: T.dps, n: T.n, months: T.months.map((m) => (qty || 0) * m * (f || 0) * taxK / 0.85), yearGross, yearNet: yearGross != null ? yearGross * taxK : null, yld: px && T.dps ? T.dps / px : null, err: state.simErr[r.t], name: D?.name || simCatName(r.t) };
    });
    const tot = (k) => out.reduce((a, r) => a + (r[k] || 0), 0);
    const months = Array(12).fill(0); for (const r of out) r.months.forEach((m, i) => { months[i] += m * 0.85; });
    const wTot = rows.reduce((a, r) => a + (+r.w || 0), 0);
    const cost = tot('cost');
    return { fx, budget, wTot, rows: out, cost, left: budget != null ? budget - cost : null, yearGross: tot('yearGross'), yearNet: tot('yearNet'), months, yld: cost ? tot('yearGross') / cost : null, ready: out.length && out.every((r) => r.px != null) };
  }
  function renderDivSim() {
    const el = document.getElementById('c-divsim');
    if (!el) return;
    fillSimNames();
    const S = simCalc(), fx = S.fx, krw = (v) => (fx && v != null ? manwon(v * fx) : '–');
    const MON = EN ? ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const mMax = Math.max(1e-9, ...S.months);
    const warn = fx && S.yearGross * fx > 2e7;
    card('divsim', {
      title: '🧮 배당 포트폴리오 짜보기', sub: '투자금 · 종목 · 비중 → 살 수 있는 주식과 예상 배당',
      easy: '가진 돈으로 배당주를 산다면 지금 가격으로 몇 주를 살 수 있고, 그만큼 들고 있으면 1년에 배당을 얼마나 받는지 계산해요. 실제 보유 종목과는 따로 저장돼요.',
      info: INFO.divsim,
      body: `<div class="sim-amt">
          <label class="bn-f"><span>투자금</span><div class="bn-in"><input inputmode="decimal" id="sim-amount" value="${esc(String(simCfg.amount ?? ''))}" aria-label="투자금"><em>${simCfg.unit === 'usd' ? '달러' : '만원'}</em></div>
          <small>${simCfg.unit === 'usd' ? (fx ? `≈ ${manwon((+simCfg.amount || 0) * fx)} · ${EN ? `FX ₩${nf(0).format(fx)}` : `환율 ${nf(0).format(fx)}원`}` : '') : `${manwon((+simCfg.amount || 0) * 1e4)}${fx ? ` ≈ ${usd((+simCfg.amount || 0) * 1e4 / fx)} · ${EN ? `FX ₩${nf(0).format(fx)}` : `환율 ${nf(0).format(fx)}원`}` : ''}`}</small></label>
          <div class="sim-unit" role="group" aria-label="단위">${[['manwon', '원'], ['usd', '$']].map(([k, l]) => `<button type="button" data-simunit="${k}" aria-pressed="${simCfg.unit === k}">${l}</button>`).join('')}</div>
        </div>
        <div class="sim-cats" role="group" aria-label="많이 찾는 배당 종목">${SIM_CATALOG.map(([k, l]) => `<button type="button" class="chip-btn sm" data-simcat="${k}" aria-pressed="${simCat === k}">${l}</button>`).join('')}</div>
        ${simCat ? (() => { const C = SIM_CATALOG.find((c) => c[0] === simCat); const have = new Set(simCfg.rows.map((r) => r.t)); return `<ul class="sim-pick">${C[2].map(([t, n, d]) => `<li>${logoPath(t) ? `<img src="${logoPath(t)}" alt="" width="24" height="24" loading="lazy">` : `<span class="ws-letter">${esc((krTk(t) ? n : t)[0])}</span>`}
            <div class="sp-main"><div class="sp-h"><b>${esc(krTk(t) ? n : t)}</b><small>${esc(krTk(t) ? t.slice(0, 6) : n)}</small></div><span>${esc(d)}</span><em class="sim-yld" data-yld="${esc(t)}">${catYldTxt(t)}</em></div>
            <div class="sp-act">${have.has(t) ? '<em class="sim-added">✓ 추가됨</em>' : `<button type="button" class="sp-add" data-simpick="${esc(t)}" aria-label="${esc(krTk(t) ? n : t)} 추가">+ 추가</button>`}</div></li>`).join('')}</ul>`; })() : ''}
        <div class="sim-rows">${simCfg.rows.map((r, i) => { const nm = simRowName(r), kr = krTk(r.t); return `<div class="sim-row" data-simrow="${i}" data-t="${esc(r.t)}"><div class="sim-tw">${logoPath(r.t) ? `<img class="sim-logo" src="${logoPath(r.t)}" alt="" width="26" height="26" loading="lazy">` : `<span class="sim-logo ws-letter">${esc(String((kr ? nm : r.t) || '?')[0])}</span>`}<div class="sim-nm"><b>${esc(kr ? nm || r.t.slice(0, 6) : r.t)}</b><small>${esc(kr ? `${r.t.slice(0, 6)} · ${r.t.endsWith('.KQ') ? '코스닥' : '코스피'}` : nm)}</small></div></div><div class="bn-in"><input class="sim-w" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${esc(String(r.w ?? ''))}" aria-label="${esc(kr ? nm : r.t)} 비중"><em>%</em></div><button type="button" class="f-rm" data-simrm="${i}" aria-label="이 종목 빼기">×</button></div>`; }).join('')}</div>
        ${simSearchOpen ? `<div class="sim-search"><div class="ws-search sim-q"><input id="sim-q" type="search" placeholder="티커나 종목명 (예: SCHD, 리얼티인컴, 삼성전자)" aria-label="종목 검색" autocomplete="off" autocapitalize="off" enterkeyhint="search"><button type="button" class="sim-qx" data-simclose="1" aria-label="검색 닫기">×</button></div><ul class="ws-list sim-res" id="sim-res">${simResHtml()}</ul></div>` : ''}
        <p class="sim-wsum" id="sim-wsum">${simWeightHtml()}</p>
        <div class="sim-act"><button type="button" class="btn-ghost sm" data-simadd="1" aria-pressed="${simSearchOpen}">🔍 종목 찾아 추가</button><button type="button" class="btn-ghost sm" data-simeq="1">비중 똑같이</button><button type="button" class="btn-ghost sm sim-reset" data-simreset="1"${simCfg.rows.length ? '' : ' disabled'}>↺ 초기화</button><button type="button" class="btn-primary sim-run" data-simrun="1">계산하기</button></div>
        ${S.rows.some((r) => r.px != null || r.err) ? `<div class="div-scroll"><table class="div-tbl sim-tbl"><thead><tr><th>종목</th><th>현재가</th><th>살 수 있는 주식</th><th>투자액</th><th>연 배당(세후)</th><th>배당률</th></tr></thead><tbody>
          ${S.rows.map((r) => `<tr><td><b>${esc(r.kr ? (r.name || r.t) : r.t)}</b>${r.err ? `<small class="warn">찾지 못했어요</small>` : r.name ? `<small>${esc(r.kr ? r.t.slice(0, 6) : r.name).slice(0, 26)}</small>` : ''}</td><td>${r.px != null ? pxS(r.t, r.px) : '–'}</td><td>${r.qty != null ? nf(0).format(r.qty) + '주' : '–'}</td><td>${r.cost != null ? usd2(r.cost) : '–'}<small>${pctPlain(r.share, 0)}</small></td><td>${r.yearNet != null ? usd2(r.yearNet) : '–'}<small>${r.n ? `${r.n}회 · 주당 ${pxS(r.t, r.dps)}` : '배당 없음'}</small></td><td>${r.yld != null ? pctPlain(r.yld, 1) : '–'}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
        ${S.ready ? `<div class="sim-sum">
            <div><span>1년 예상 배당(세후)</span><b>${usd2(S.yearNet)}</b><small>${krw(S.yearNet)}</small></div>
            <div><span>한 달 평균</span><b>${usd2(S.yearNet / 12)}</b><small>${krw(S.yearNet / 12)}</small></div>
            <div><span>포트폴리오 배당률</span><b>${pctPlain(S.yld, 2)}</b><small>세전 · 최근 1년 배당 기준</small></div>
            <div><span>실제 투자액 · 남는 돈</span><b>${usd2(S.cost)}</b><small>남는 돈 ${usd2(S.left)}</small></div>
          </div>
          <div class="sim-goal">
            <div class="sim-goal-h"><b>🎯 목표 월배당으로 거꾸로 계산</b><small>지금 고른 종목·비중 그대로</small></div>
            <label class="bn-f"><span>한 달에 받고 싶은 배당(세후)</span><div class="bn-in"><input inputmode="numeric" id="sim-goal" value="${esc(String(simCfg.goal ?? 200))}" aria-label="목표 월배당"><em>만원</em></div></label>
            <div id="sim-goal-out">${simGoalHtml(S)}</div>
          </div>
          <div class="sim-months" aria-label="월별 예상 배당">${S.months.map((m, i) => `<div title="${i + 1}월 ${usd2(m)}"><i style="height:${Math.max(2, (m / mMax) * 100)}%"></i><span>${MON[i]}</span></div>`).join('')}</div>
          <p class="note">월별 막대는 최근 1년 배당락일이 있던 달 기준(세후)이에요. 배당은 바뀔 수 있고 과거 배당이 미래를 보장하지 않아요. 세후는 미국 원천징수 15%, 국내 배당소득세 15.4%를 뺀 금액이에요.${warn ? ' <b class="warn">⚠ 연 배당이 2,000만원을 넘으면 금융소득종합과세 대상이 될 수 있어요.</b>' : ''}</p>` : `<p class="note">${S.rows.length ? '계산하기를 누르면 현재가와 최근 1년 배당을 받아 와요.' : '종목을 추가해 주세요.'}</p>`}`,
    });
  }
  // 목표 월배당 → 필요한 투자금(지금 포트폴리오의 세후 배당률로 나눔)
  function simGoalHtml(S = simCalc()) {
    const g = +(simCfg.goal ?? 200) || 0, fx = S.fx;
    if (!S.ready || !S.cost || !S.yearNet || !fx) return '<p class="note">계산하기를 먼저 누르면 바로 보여요.</p>';
    if (g <= 0) return '<p class="note">받고 싶은 금액을 넣어 주세요.</p>';
    const netYld = S.yearNet / S.cost, needUsd = (g * 1e4 * 12) / fx / netYld, needKrw = needUsd * fx;
    const now = simCfg.unit === 'usd' ? (+simCfg.amount || 0) * fx : (+simCfg.amount || 0) * 1e4;
    return `<div class="sim-goal-r"><span>필요한 투자금</span><b>${manwon(needKrw)}</b><small>${EN ? `≈ ${usd(needUsd)} · at ${pctPlain(netYld, 2)} after-tax yield${now ? ` · ${(needKrw / now).toFixed(1)}x your current amount` : ''}` : `≈ ${usd(needUsd)} · 세후 배당률 ${pctPlain(netYld, 2)} 기준${now ? ` · 지금 투자금의 ${(needKrw / now).toFixed(1)}배` : ''}`}</small></div>
      <button type="button" class="btn-ghost sm" data-simgoal="${Math.ceil(needKrw / 1e4)}">이 금액으로 다시 계산하기</button>
      <p class="note">최근 1년 배당이 그대로 이어진다고 보고 계산했어요. 배당은 줄거나 늘 수 있고, 주가가 바뀌면 필요한 금액도 달라져요.</p>`;
  }
  function simWeightHtml() {
    const tot = simCfg.rows.filter((r) => r.t).reduce((a, r) => a + (+r.w || 0), 0), t = Math.round(tot);
    if (!simCfg.rows.some((r) => r.t)) return '';
    if (t === 100) return '<span class="ok">✓ 비중 합계 100%</span>';
    const gap = Math.abs(t - 100);
    if (EN) return `<span class="warn">Weight total ${t}% · ${gap}% ${t > 100 ? 'over' : 'short'}</span> <small>Scaled to 100% when you calculate</small>`;
    return `<span class="warn">비중 합계 ${t}% · ${gap}% ${t > 100 ? '넘어요' : '모자라요'}</span> <small>계산할 때 비율대로 100%에 맞춰요</small>`;
  }
  function paintSimWeight() { const el = document.getElementById('sim-wsum'); if (el) el.innerHTML = simWeightHtml(); }
  // 비중 합계가 100%가 아니면 입력한 비율대로 100%에 맞춘다(마지막 종목이 반올림 차이를 가져감)
  // 정수 %로: 비율대로 나눈 뒤 남는 1%씩은 소수점 아래가 큰 종목부터
  function normalizeSimWeights() {
    const rows = simCfg.rows.filter((r) => r.t), tot = rows.reduce((a, r) => a + Math.max(0, +r.w || 0), 0);
    if (!rows.length || (tot === 100 && rows.every((r) => Number.isInteger(+r.w)))) return false;
    const raw = rows.map((r) => (tot > 0 ? (Math.max(0, +r.w || 0) / tot) * 100 : 100 / rows.length)), fl = raw.map(Math.floor);
    let left = 100 - fl.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
    rows.forEach((r, i) => { r.w = fl[i]; });
    return tot;
  }
  function readSimForm() {
    const a = document.getElementById('sim-amount');
    if (a) simCfg.amount = parseFloat(a.value.replace(/[,\s]/g, '')) || 0;
    const rows = [];
    for (const r of document.querySelectorAll('.sim-row')) { const t = r.dataset.t, old = simCfg.rows.find((x) => x.t === t); rows.push({ t, n: old?.n, w: parseInt(r.querySelector('.sim-w').value, 10) || 0 }); }
    if (document.querySelector('.sim-row')) simCfg.rows = rows;
    writeJSON(SIM_KEY, simCfg);
  }
  async function runSim() {
    readSimForm();
    markUse('divsim');
    for (const r of simCfg.rows) if (r.t && !TICKER_RE.test(r.t)) r.t = await resolveTicker(r.t); // 005930·삼성전자 → 005930.KS
    const bad = simCfg.rows.find((r) => r.t && !TICKER_RE.test(r.t));
    if (bad) { renderDivSim(); toast(`${esc(bad.t)}: 티커(예: SCHD)나 종목코드(예: 005930)로 넣어 주세요`, true); return; }
    const was = normalizeSimWeights();
    if (was !== false && Math.round(was) !== 100) toast(EN ? `Weights added up to ${Math.round(was)}%, so they were scaled to 100%` : `비중 합계가 ${Math.round(was)}%라서 입력한 비율대로 100%에 맞췄어요`);
    writeJSON(SIM_KEY, simCfg);
    const btn = document.querySelector('[data-simrun]'); if (btn) { btn.disabled = true; btn.textContent = '계산 중…'; }
    if (!state.quote?.fx || simCfg.rows.some((r) => krTk(r.t))) await loadQuote().catch(() => {});
    await loadSimData();
    renderDivSim();
    // 계산 결과(표·합계)가 보이도록 아래로 이동 — 헤더 높이만큼 띄운다
    const res = document.querySelector('#c-divsim .sim-tbl')?.closest('.div-scroll') || document.querySelector('#c-divsim .sim-sum');
    if (res) window.scrollTo({ top: Math.max(0, res.getBoundingClientRect().top + window.scrollY - (document.querySelector('.top')?.offsetHeight || 60) - 12), behavior: 'smooth' });
  }
  // 성과급 → 배당 포트폴리오: 실수령액을 투자금으로 넣고 배당금 탭으로
  function bonusToSim() {
    const R = bonusCalc();
    if (!R.ready) return;
    simCfg.unit = 'manwon'; simCfg.amount = Math.floor(R.net / 1e4);
    writeJSON(SIM_KEY, simCfg);
    state.fireTab = 'div'; savePref('fireTab', 'div'); setDivSub('sim'); applyFireTab(); renderDiv();
    renderDivSim();
    runSim();
  }

  // 시세(보유 종목·경쟁사·환율): Fire 화면이거나 CRCL 외 종목을 보고 있을 때 15초마다
  let quoteInflight = null;
  function loadQuote() { return (quoteInflight ||= fetchQuote().finally(() => { quoteInflight = null; })); }
  async function fetchQuote() {
    try {
      const extra = [...new Set([...WATCH.filter((x) => STOCK_INFO[x]?.custom && US_SYM.test(x)), ...fireExtraSyms()])];
      const kr = [...new Set([...WATCH.filter(isKR), ...(fireCfg?.positions || []).map((p) => p.ticker).filter(isKR)])].slice(0, 20);
      const krP = kr.length ? getJ(`${NEWS_API}/krquote?s=${kr.join(',')}`, 10000).then((k) => { if (!k.error) state.krq = { ...(state.krq || {}), ...k }; }).catch(() => {}) : null;
      const j = await getJ(`${NEWS_API}/quote${extra.length ? `?x=${extra.join(',')}` : ''}`, 15000);
      await krP;
      if (j.error) throw new Error(j.error);
      state.quote = j;
      for (const sym of Object.keys(live)) applyLive(sym); // 방금 들어온 실시간 체결가가 더 최신이면 유지
      state.quoteErr = false;
    } catch (e) {
      state.quoteErr = true;
      if (!state.quote) throw e;
    }
  }
  let fireTimer = null;
  function fireLoop(on) {
    clearInterval(fireTimer);
    if (!on) return;
    fireTimer = setInterval(() => {
      if (document.hidden) return;
      loadQuote().then(() => { renderFire(); renderSummary(); renderStockSwitch(); if (isOther()) { paintStock(); renderSSummary(); } }).catch(() => {});
    }, 15000);
  }

  function saveFireForm() {
    const v = (id) => document.getElementById(id)?.value.trim().replace(/,/g, '');
    const rows = readFireRows();
    const goal = parseFloat(v('f-goal')), fx = parseFloat(v('f-fx'));
    if (!rows.length || rows.some((r) => !(r.shares > 0) || !(r.avg > 0)) || !(goal > 0)) { toast('각 종목의 수량·평균 단가와 목표 금액을 숫자로 입력해 주세요', true); return; }
    // 같은 종목을 두 번 넣으면 수량·평균 단가를 합친다
    const merged = {};
    for (const r of rows) {
      const m = (merged[r.ticker] ||= { ticker: r.ticker, shares: 0, cost: 0 });
      m.shares += r.shares; m.cost += r.shares * r.avg;
    }
    const nameOf = (t) => fireCfg?.positions.find((p) => p.ticker === t)?.n;
    const positions = Object.values(merged).map((m) => ({ ticker: m.ticker, shares: m.shares, avg: m.cost / m.shares, ...(nameOf(m.ticker) ? { n: nameOf(m.ticker) } : {}) }));
    fireCfg = { positions, goal, buyFx: fx > 0 ? fx : null, afterTax: document.getElementById('f-tax')?.checked || false };
    writeJSON(FIRE_KEY, fireCfg);
    fireSim = null;
    fireConfirmDelete = false;
    toast('✓ 이 기기에 저장했어요');
    syncHeldToWatch();
    renderFireSet();
    // 새로 넣은 종목의 시세가 아직 없으면 바로 다시 받는다
    if (!state.quote || positions.some((p) => state.quote[p.ticker]?.price == null)) loadQuote().then(() => { renderFire(); renderSummary(); }).catch(() => renderFire());
    renderFire();
    renderSummary();
  }
  function deleteFire() {
    if (DEMO) { toast(EN ? 'This is the sample view — nothing to delete' : '예시 화면이라 지울 내용이 없어요', true); return; }
    if (!fireConfirmDelete) { fireConfirmDelete = true; const b = document.getElementById('f-del'); if (b) b.textContent = '정말 삭제'; return; }
    fireCfg = null; fireHist = []; fireSim = null; fireConfirmDelete = false;
    try { localStorage.removeItem(FIRE_KEY); localStorage.removeItem(FIRE_HIST); } catch {}
    toast('이 기기에서 보유 정보를 지웠어요');
    renderFireSet(); renderFire(); renderSummary();
  }

  // ---------------------------------------------------------------- 서클 실적 (뉴스 탭 상단)
  const qLabel = (end) => { const [y, m] = end.split('-'); return `'${y.slice(2)} ${Math.ceil(+m / 3)}Q`; };
  const qLabelLong = (end) => { const [y, m] = end.split('-'); return EN ? `Q${Math.ceil(+m / 3)} ${y}` : `${y}년 ${Math.ceil(+m / 3)}분기`; };
  const dday = (iso) => Math.ceil((Date.parse(iso + 'T00:00:00') - new Date(new Date().toDateString()).getTime()) / 86400000);
  const krDate = (iso) => { const d = new Date(iso + 'T00:00:00'); if (EN) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
  const usdS = (v) => (v == null ? '–' : (v < 0 ? '-' : '') + usd(Math.abs(v)));

  function renderEarnings() {
    try { renderAiCards('CRCL'); } catch (e) { console.error(e); }
    const E = state.earnings;
    if (!E) {
      card('earnings', { title: '서클 실적', sub: '분기 실적 · 다음 발표일', info: INFO.earnings, body: `<p class="skeleton">${state.earningsErr ? '실적 데이터를 불러오지 못했습니다. 새로고침으로 다시 시도하세요.' : '실적 불러오는 중…'}</p>` });
      return;
    }
    const Q = E.quarters || [];
    const last = Q.at(-1), prev = Q.at(-2);
    const yearAgo = last ? Q.find((q) => q.end === `${+last.end.slice(0, 4) - 1}${last.end.slice(4)}`) : null;
    const chg = (a, b) => (a != null && b ? a / b - 1 : null);
    const N = E.next;
    const dd = N?.date ? dday(N.date) : null;
    const sp = (v) => (v == null ? '' : `<span class="${cls(v)}">${pct(v)}</span>`);
    // 기준값이 음수면 변화율이 왜곡되므로 흑자/적자 전환으로 표시
    const spTurn = (a, b) => (a == null || b == null ? '–' : b < 0 && a >= 0 ? '<span class="up">흑자 전환</span>' : b >= 0 && a < 0 ? '<span class="down">적자 전환</span>' : b < 0 ? '적자 지속' : sp(chg(a, b)));
    const lastSur = (E.surprises || []).find((s) => s.end === last?.end);

    const nextHtml = N?.date ? `
      <div class="er-next">
        <div class="er-next-h"><span>다음 실적 발표</span>${N.estimated ? '<span class="tone neu">예상일</span>' : '<span class="tone pos">확정</span>'}</div>${N.confirmedBy ? `<a class="er-src" href="${safeUrl(N.confirmedBy.url)}" target="_blank" rel="noopener">📢 ${+N.confirmedBy.on.slice(5, 7)}/${+N.confirmedBy.on.slice(8)} 회사 발표로 확정 · ${esc(N.confirmedBy.title.slice(0, 80))}</a>` : ''}
        <div class="er-next-d"><b>${krDate(N.date)}</b><span class="er-dday">${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '발표 완료'}</span></div>
        <div class="er-next-m">${N.quarter ? qLabelLong(N.quarter) + ' 실적 · ' : ''}예상 EPS <b>${N.consensus != null ? '$' + N.consensus.toFixed(2) : '–'}</b>${N.low != null ? ` (범위 $${N.low.toFixed(2)}~$${N.high.toFixed(2)}${N.analysts ? `, ${N.analysts}명` : ''})` : ''}${N.lastYearEps != null ? ` · 작년 같은 분기 $${N.lastYearEps.toFixed(2)}` : ''}</div>
        ${N.estimated ? '<p class="note">서클이 날짜를 공식 발표하기 전까지는 과거 발표 패턴으로 추정한 날짜입니다(Zacks).</p>' : ''}
      </div>` : '';

    const tiles = last ? `
      <div class="ns-grid er-grid">
        <div><span>매출(총수익)</span><b>${usdS(last.revenue)}</b><small>전년 ${sp(chg(last.revenue, yearAgo?.revenue)) || '–'} · 전분기 ${sp(chg(last.revenue, prev?.revenue)) || '–'}</small></div>
        <div><span>준비금 이자수익</span><b>${usdS(last.reserve)}</b><small>${last.reserve && last.revenue ? `매출의 ${pctPlain(last.reserve / last.revenue, 0)}` : 'USDC 준비금 이자'}</small></div>
        <div><span>순이익</span><b class="${last.netIncome < 0 ? 'down' : ''}">${usdS(last.netIncome)}</b><small>순이익률 ${last.netIncome != null && last.revenue ? pctPlain(last.netIncome / last.revenue) : '–'} · 전년 ${spTurn(last.netIncome, yearAgo?.netIncome)}</small></div>
        <div><span>EPS(주당순이익)</span><b>${last.eps != null ? '$' + last.eps.toFixed(2) : '–'}</b><small>${lastSur ? `예상 $${lastSur.consensus.toFixed(2)} · ${lastSur.surprise >= 0 ? '상회' : '하회'} ${sp(lastSur.surprise)}` : '예상치 없음'}</small></div>
      </div>` : '';

    card('earnings', {
      title: '서클 실적',
      sub: (last ? `최근 발표 ${last.reportedOn ? md(isoToTs(last.reportedOn)) : ''} · ${qLabelLong(last.end)} · SEC·Nasdaq` : 'SEC·Nasdaq') + repDoc('CRCL'),
      info: INFO.earnings,
      body: `${earnSumBlock('CRCL')}${nextHtml}${voteBlock('CRCL')}${tiles}
        <div class="mini-h er-h">분기 매출 구성</div>
        <div class="chart"><canvas id="cv-er-rev" role="img" aria-label="분기별 매출"></canvas></div>
        <div class="legend"><span><i style="background:${C.blue}"></i>준비금 이자수익</span><span><i style="background:${C.teal}"></i>기타 매출</span></div>
        <div class="pair er-pair">
          <div><div class="mini-h er-h">분기 순이익</div><div class="chart"><canvas id="cv-er-ni" role="img" aria-label="분기별 순이익"></canvas></div></div>
          <div><div class="mini-h er-h">EPS 실적 vs 예상</div><div class="chart"><canvas id="cv-er-eps" role="img" aria-label="EPS 실적과 예상"></canvas></div></div>
        </div>
        <div class="legend"><span><i style="background:${C.purple}"></i>EPS 실적</span><span><i class="line" style="background:${C.ink2}"></i>시장 예상</span></div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>분기</th><th>매출</th><th>전년 대비</th><th>순이익</th><th>EPS</th></tr></thead>
          <tbody>${Q.slice().reverse().map((q, i) => {
            const ya = Q.find((x) => x.end === `${+q.end.slice(0, 4) - 1}${q.end.slice(4)}`);
            const y = chg(q.revenue, ya?.revenue);
            return `<tr${i === 0 ? ' class="today"' : ''}><td>${qLabel(q.end)}</td><td class="strong">${usdS(q.revenue)}</td><td class="${cls(y)}">${y == null ? '–' : pct(y)}</td>
              <td class="${q.netIncome < 0 ? 'down' : ''}">${usdS(q.netIncome)}</td><td>${q.eps != null ? '$' + q.eps.toFixed(2) : '–'}${q.consensus != null ? `<span class="dim" style="display:block;font-size:10.5px">예상 ${q.consensus.toFixed(2)}</span>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="note">EPS 칸 아래 회색 숫자는 발표 전 시장 예상치. '25 2Q 적자는 상장(IPO) 관련 일회성 비용 영향입니다.</p>`,
    });

    const labels = Q.map((q) => qLabel(q.end));
    const tipQ = (it) => qLabelLong(Q[it.dataIndex].end);
    draw('er-rev', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '준비금 이자수익', data: Q.map((q) => q.reserve ?? q.revenue), backgroundColor: C.blue, stack: 's', borderColor: C.surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', maxBarThickness: 30 },
          { label: '기타 매출', data: Q.map((q) => (q.reserve != null ? Math.max(0, q.revenue - q.reserve) : 0)), backgroundColor: C.teal, stack: 's', borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 30 },
        ],
      },
      options: {
        interaction,
        plugins: { ...noLegend, tooltip: { ...tooltip(tipQ, usdS), callbacks: { title: (items) => tipQ(items[0]), label: (it) => ` ${it.dataset.label}: ${usdS(it.raw)}`, footer: (items) => `매출 합계 ${usdS(Q[items[0].dataIndex].revenue)}` } } },
        scales: { x: { ...axisX(labels, (v) => v, 5), stacked: true }, y: { ...axisY(usd, { beginAtZero: true }), stacked: true } },
      },
    });
    draw('er-ni', {
      type: 'bar',
      data: { labels, datasets: [{ label: '순이익', data: Q.map((q) => q.netIncome), backgroundColor: Q.map((q) => (q.netIncome < 0 ? C.orange : C.teal)), borderRadius: 3, borderSkipped: false, maxBarThickness: 18 }] },
      options: {
        interaction, plugins: { ...noLegend, tooltip: tooltip(tipQ, usdS) },
        scales: { x: { ...axisX(labels, (v) => v, 4) }, y: axisY((v) => usdS(v)) },
      },
    });
    const S = (E.surprises || []).slice().sort((a, b) => a.end.localeCompare(b.end));
    const sl = S.map((s) => qLabel(s.end));
    draw('er-eps', {
      type: 'bar',
      data: {
        labels: sl,
        datasets: [
          { type: 'bar', label: 'EPS 실적', data: S.map((s) => s.eps), backgroundColor: C.purple, borderRadius: 3, maxBarThickness: 18, order: 2 },
          { type: 'line', label: '시장 예상', data: S.map((s) => s.consensus), borderColor: C.ink2, backgroundColor: C.ink2, borderWidth: 0, pointRadius: 5, pointStyle: 'line', pointBorderWidth: 3, showLine: false, order: 1 },
        ],
      },
      options: {
        interaction,
        plugins: { ...noLegend, tooltip: { ...tooltip((it) => qLabelLong(S[it.dataIndex].end), (v) => '$' + (+v).toFixed(2)), callbacks: { title: (items) => qLabelLong(S[items[0].dataIndex].end), label: (it) => ` ${it.dataset.label}: $${(+it.raw).toFixed(2)}`, footer: (items) => `예상 대비 ${pct(S[items[0].dataIndex].surprise)}` } } },
        scales: { x: { ...axisX(sl, (v) => v, 4) }, y: axisY((v) => '$' + (+v).toFixed(2), { beginAtZero: true }) },
      },
    });
  }

  // ---------------------------------------------------------------- 뉴스 · 공시 (종목별)
  // 공시 종류: [한글 설명, 중요도(hi/mid/low)]
  const FORMS = {
    '8-K': ['주요 사항 보고(수시공시)', 'hi'], '10-Q': ['분기 보고서', 'hi'], '10-K': ['연간 보고서', 'hi'],
    'S-1': ['증권 신고서', 'hi'], 'S-3': ['증권 발행 등록', 'hi'], '424B': ['투자설명서(증권 발행)', 'hi'],
    'S-3ASR': ['증권 발행 등록(자동 효력)', 'hi'], 'D': ['사모 증권 발행 신고', 'mid'],
    'SC 13D': ['5% 이상 대주주 보고(경영 참여 목적)', 'hi'], 'SCHEDULE 13D': ['5% 이상 대주주 보고(경영 참여 목적)', 'hi'],
    'SC 13G': ['5% 이상 대주주 보고', 'mid'], 'SCHEDULE 13G': ['5% 이상 대주주 보고', 'mid'],
    'DEF 14A': ['주주총회 안건(위임장)', 'mid'], 'S-8': ['임직원 주식보상 등록', 'mid'], '11-K': ['임직원 저축제도 연간 보고', 'low'],
    '144': ['내부자 주식 매도 예정 신고', 'low'], '4': ['임원·대주주 지분 변동', 'low'], '3': ['임원·대주주 최초 지분 보고', 'low'],
    '5': ['임원·대주주 연간 지분 보고', 'low'],
  };
  // 8-K 보고 항목 번호 → 내용
  const ITEMS_8K = {
    '1.01': '중요 계약 체결', '1.02': '중요 계약 해지', '2.01': '자산 인수·처분', '2.02': '실적 발표', '2.03': '채무 발생',
    '2.05': '구조조정', '3.02': '미등록 증권 발행', '3.03': '주주 권리 변경', '5.02': '임원·이사 변동', '5.03': '정관 변경',
    '5.07': '주총 결과', '7.01': '공정공시(Reg FD)', '8.01': '기타 중요 사항',
  };
  const itemsKo = (items) => (items || '').split(',').map((x) => ITEMS_8K[x.trim()]).filter(Boolean).join(', ');
  function formInfo(form) {
    const amend = /\/A$/.test(form);
    const base = form.replace(/\/A$/, '');
    const hit = FORMS[base] || (base.startsWith('424B') ? FORMS['424B'] : null) || [base + ' 공시', 'mid'];
    return { label: hit[0] + (amend ? ' (정정)' : ''), level: hit[1] };
  }
  const FAA_RE = /FAA|type certif|형식 ?인증|인증|certification|\bTIA\b|for-credit|Part 1(35|41|45)|eIPP|airworth|감항/i;
  // 종목 설정 (CRCL은 전용 화면, 나머지는 공통 틀)
  const STOCK_INFO = {
    CRCL: { name: '서클 인터넷 그룹', short: '서클', mark: 'C', color: '#3f7ef6', logo: 'assets/logos/CRCL.svg' },
    JOBY: {
      name: '조비 에비에이션', short: '조비', mark: 'J', color: '#2e8cf0', logo: 'assets/logos/JOBY.png', cik: '0001819848', peer: ['ACHR', 'Archer'], peerNote: '같은 전기 에어택시(eVTOL) 업체',
      mode: 'burn', earnTitle: '조비 실적 · FAA 인증', industry: 'UAM 업계', industryBadge: 'UAM', relBadge: '조비', relRe: /조비|Joby|JOBY/i,
    },
    SPCX: {
      name: '스페이스X', short: '스페이스X', mark: 'X', color: '#aab4c3', logo: 'assets/logos/SPCX.png', cik: '0001181412', peer: ['RKLB', 'Rocket Lab'], peerNote: '상장된 우주 발사체 업체',
      mode: 'growth', earnTitle: '스페이스X 실적 · 보호예수', industry: '우주 업계', industryBadge: '우주', relBadge: 'SpaceX', relRe: /스페이스X|스페이스엑스|SpaceX|SPCX|스타링크|Starlink|스타십|Starship/i,
      earnNote: '스페이스X는 2026년 6월 상장이라 SEC 분기 자료가 일부 분기만 있어요(1분기 = 상반기 − 2분기로 계산). 스타십·스타링크 위성 등 <b>설비투자가 매우 커서</b> 영업으로 번 현금보다 투자에 쓰는 돈이 훨씬 많아요. 매출 성장과 이익률 개선이 핵심이에요.',
    },
    TEM: {
      name: '템퍼스 AI', short: '템퍼스', mark: 'T', color: '#8b7cf6', logo: 'assets/logos/TEM.png', cik: '0001717115', peer: ['GH', 'Guardant'], peerNote: '액체생검·암 유전체 검사 업체',
      mode: 'growth', earnTitle: '템퍼스 실적', industry: '헬스케어 AI', industryBadge: '헬스AI', relBadge: '템퍼스', relRe: /템퍼스|Tempus|\bTEM\b/,
      earnNote: '템퍼스는 유전체 검사(Genomics)와 의료 데이터·AI 서비스(Data and services)로 돈을 벌어요. <b>매출 성장률</b>과 <b>흑자 전환 여부</b>가 핵심이에요. EPS는 Nasdaq 집계(조정 기준)라 회계상 순이익과 다를 수 있어요.',
    },
  };
  // 관심 종목: 기본 4종목 + 사용자가 추가한 종목(이 기기에만 저장). 순서도 사용자가 정한다.
  const BUILTIN = ['CRCL', 'JOBY', 'SPCX', 'TEM'];
  const BUILTIN_OTHER = ['JOBY', 'SPCX', 'TEM']; // 서버 수집기가 공매도를 모으는 종목
  // 한국 종목: 종목코드.KS(코스피)·.KQ(코스닥). 시세는 네이버 증권(원), 차트는 Yahoo, 미국 전용 자료(공매도·13F·애널리스트·옵션·SEC 실적)는 없다
  const KR_RE = /^[0-9A-Z]{6}\.(KS|KQ)$/, US_SYM = /^[A-Z]{1,5}(\.[A-Z])?$/;
  const isKR = (s) => KR_RE.test(String(s || ''));
  const SYM_OK = /^([A-Z]{1,5}(\.[A-Z])?|[0-9A-Z]{6}\.(KS|KQ))$/;
  const wonPx = (v) => (v == null || !isFinite(v) ? '–' : EN ? `${v < 0 ? '-' : ''}₩${nf(0).format(Math.abs(Math.round(v)))}` : nf(0).format(Math.round(v)) + '원');
  const pxS = (sym, v) => (isKR(sym) ? wonPx(v) : price(v));
  const ttlName = (sym) => (isKR(sym) && (STOCK_INFO[sym]?.name || '').length > 9 ? '' : symLabel(sym) + ' '); // 카드 제목 앞 이름(긴 한국 이름은 부제로)
  const symLabel = (sym) => (isKR(sym) ? STOCK_INFO[sym]?.short || sym.slice(0, 6) : sym);
  const WATCH_KEY = 'cw.watch';
  const watchCfg = (() => { const w = readJSON(WATCH_KEY, null); return w?.list?.length ? { list: w.list, custom: w.custom || {}, folders: w.folders || [] } : { list: BUILTIN.slice(), custom: {}, folders: [] }; })();
  // 추가한 종목의 기본 설정(이름·색·관련어). 로고는 이니셜.
  // 로고: 기본 4종목은 assets/logos, 그 밖의 S&P 500·자주 찾는 종목은 assets/logos/t (tools/fetch_logos.py가 받아 둠)
  const LOGOS = new Set(String(window.__LOGOS || '').split(' ').filter(Boolean));
  const logoPath = (sym) => (LOGOS.has(sym) ? `assets/logos/t/${sym}.png` : null);
  const ETF_NAME = /\b(ETF|ETN|Fund|Trust|Shares)\b|iShares|SPDR|ProShares|Direxion|YieldMax|Invesco QQQ/i;
  const isEtf = (sym) => !isKR(sym) && !!(STOCK_INFO[sym]?.etf || state.quote?.[sym]?.asset === 'etf' || st(sym).etfDiv?.type === 'ETF');
  function customInfo(sym, meta = {}) {
    if (isKR(sym)) {
      const name = String(meta.name || sym.slice(0, 6)), hue = [...sym].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 17);
      const short = name.length > 9 ? name.slice(0, 9).trim() + '…' : name;
      keepName(name); keepName(short);
      return {
        name, short, mark: name[0], color: `hsl(${hue} 62% 60%)`, logo: logoPath(sym), cik: null, peer: null, peerNote: '', mode: 'growth', custom: true, kr: true,
        exchange: meta.exchange || (sym.endsWith('.KQ') ? 'KOSDAQ' : 'KOSPI'), earnTitle: `${short} 실적`, industry: null, industryBadge: '', relBadge: short,
        relRe: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), earnNote: '',
      };
    }
    const name = String(meta.name || sym).replace(/,?\s+(Inc|Corp|Corporation|Ltd|Limited|Holdings?|Group|plc|Co|Company|Incorporated)\.?$/i, '').replace(/,?\s+(Inc|Corp|Ltd)\.?$/i, '').trim() || sym;
    const word = name.split(/\s+/)[0].replace(/[^\w&.-]/g, '');
    const hue = [...sym].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 17);
    const short = name.length > 9 ? sym : name;
    return {
      name, short, mark: sym[0], color: `hsl(${hue} 62% 60%)`, logo: logoPath(sym), cik: null, peer: null, peerNote: '', mode: 'growth', custom: true, exchange: meta.exchange || '',
      etf: /ETF|ETN/i.test(meta.asset || '') || ETF_NAME.test(String(meta.name || '')),
      earnTitle: `${short} 실적`, industry: null, industryBadge: '', relBadge: sym.length > 4 ? sym.slice(0, 4) : sym,
      relRe: new RegExp(`${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || sym}|\\b${sym.replace('.', '\\.')}\\b`, 'i'), earnNote: '',
    };
  }
  for (const [sym, meta] of Object.entries(watchCfg.custom)) if (SYM_OK.test(sym) && !STOCK_INFO[sym]) STOCK_INFO[sym] = customInfo(sym, meta);
  let WATCH = watchCfg.list.filter((x, i, a) => STOCK_INFO[x] && a.indexOf(x) === i);
  if (!WATCH.length) WATCH = BUILTIN.slice();
  const OTHER = Object.keys(STOCK_INFO).filter((x) => x !== 'CRCL');
  const isOther = (s = state.stock) => s !== 'CRCL' && !!STOCK_INFO[s];
  state.st = {};
  const st = (sym) => (state.st[sym] ||= { chart: {}, earn: null, earnErr: false, news: null });
  // 종목별 뉴스 화면 설정. 필터는 겹칠 수 있다(예: 서클 관련이면서 국내 기사).
  const NEWS_UI = {
    CRCL: {
      name: '서클', view: 'news', list: 'c-news', sum: 'c-newssum', badge: 'news-badge', seenKey: 'newsSeen', filterKey: 'newsFilter',
      relRe: /서클|써클|Circle|CRCL/i, getN: () => state.data?.news,
      filters: [['all', '전체'], ['filing', '공시'], ['related', '서클 관련'], ['kr', '국내 뉴스'], ['en', '해외 뉴스'], ['industry', '암호화폐']],
      badges: { related: '서클', kr: '국내', en: '해외', industry: '코인' },
    },
  };
  const newsUIFor = (sym) => {
    const S = STOCK_INFO[sym];
    return {
      name: S.short, view: 'snews', list: 'c-snews', sum: 'c-snewssum', badge: 'news-badge',
      seenKey: sym === 'JOBY' ? 'jnewsSeen' : `newsSeen.${sym}`, filterKey: sym === 'JOBY' ? 'jnewsFilter' : `newsFilter.${sym}`,
      relRe: S.relRe, getN: () => st(sym).news,
      filters: [['all', '전체'], ['filing', '공시'], ['related', `${S.short} 관련`], ...(sym === 'JOBY' ? [['faa', 'FAA 인증']] : []), ['kr', '국내 뉴스'], ['en', '해외 뉴스'], ...(S.industry ? [['industry', S.industry]] : [])],
      badges: { related: S.relBadge, kr: '국내', en: '해외', industry: S.industryBadge },
    };
  };
  for (const sym of OTHER) NEWS_UI[sym] = newsUIFor(sym);
  state.majorOnly = loadPref('majorOnly', '1') === '1';
  const seen = {};
  for (const [sym, U] of Object.entries(NEWS_UI)) {
    let at = Number(loadPref(U.seenKey, '0')) || 0;
    if (!at) { at = Date.now(); savePref(U.seenKey, String(at)); } // 첫 방문엔 전부 NEW로 띄우지 않는다
    seen[sym] = { at, prev: at };
    U.filter = loadPref(U.filterKey, 'all');
    if (U.filter === 'official') U.filter = 'related';
  }
  const curUI = () => NEWS_UI[state.stock] || NEWS_UI.CRCL;
  // 실행 중에 종목을 추가할 때 화면·뉴스·Fire 설정을 등록
  function registerStock(sym) {
    if (!STOCK_INFO[sym]) STOCK_INFO[sym] = customInfo(sym, watchCfg.custom[sym]);
    if (!OTHER.includes(sym) && sym !== 'CRCL') OTHER.push(sym);
    if (!NEWS_UI[sym]) {
      NEWS_UI[sym] = newsUIFor(sym);
      const U = NEWS_UI[sym], at = Date.now();
      savePref(U.seenKey, String(at)); seen[sym] = { at, prev: at }; U.filter = 'all';
    }
    TAB_SETS[sym] ||= tabsFor(sym);
    if (!FIRE_TICKERS[sym] || FIRE_TICKERS[sym] === sym) FIRE_TICKERS[sym] = isKR(sym) ? `${STOCK_INFO[sym].name} · ${sym.slice(0, 6)}` : `${sym} · ${STOCK_INFO[sym].name}`;
    refreshFireTickers();
  }

  function newsItems(sym = state.stock) {
    const U = NEWS_UI[sym], N = U.getN();
    if (!N) return [];
    const items = [];
    const usedOwner = {};
    for (const f of N.filings || []) {
      const fi = formInfo(f.form);
      const ok = f.d + '|' + f.form;
      usedOwner[ok] = (usedOwner[ok] || 0) + 1;
      if (!f.owner && N.ownerMap?.[ok]) f.owner = N.ownerMap[ok][usedOwner[ok] - 1] || '';
      const owner = f.owner ? ` · ${f.owner.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : '';
      // 8-K는 같은 날 나온 공식 발표를 붙여 무슨 내용인지 보이게 한다
      const rel = /^8-K/.test(f.form) ? (N.official || []).find((o) => Math.abs(Date.parse(o.t) - Date.parse(f.d + 'T20:00:00Z')) < 1.2 * 86400000) : null;
      const [fy, fm, fd] = f.d.split('-').map(Number); // 제출일 그대로(현지 날짜로 바꾸지 않음)
      const it = itemsKo(f.items);
      const title = `${fi.label}${it ? ' · ' + it : ''}${owner}${rel ? ' — ' + rel.title : ''}`;
      items.push({ kind: 'filing', t: new Date(fy, fm - 1, fd, 12).getTime(), dateOnly: true, title, source: `SEC · Form ${f.form}`, url: f.url, form: f.form, level: fi.level, faa: !!rel && FAA_RE.test(rel.title) });
    }
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 40);
    const seenT = new Set();
    const push = (n, base, lang) => {
      const k = key(n.title);
      if (seenT.has(k)) return;
      seenT.add(k);
      // 회사 공식 발표이거나 제목에 회사 이름이 있으면 '○○ 관련'으로 분류
      const related = base === 'official' || U.relRe.test(n.title);
      const kind = related ? 'related' : base;
      items.push({ kind, base, lang, t: Date.parse(n.t), title: n.title, sum: n.sum || '', source: n.source + (base === 'industry' && lang !== 'ko' ? ' · 해외' : ''), url: n.url, level: base === 'official' ? 'hi' : 'mid', official: base === 'official', faa: FAA_RE.test(n.title) });
    };
    for (const n of N.official || []) push(n, 'official', 'en');
    for (const n of N.kr || []) push(n, 'kr', 'ko');
    for (const n of N.en || []) push(n, 'en', 'en');
    for (const n of N.crypto || []) push(n, 'industry', n.lang);
    return items.sort((a, b) => b.t - a.t);
  }
  // 필터: 겹칠 수 있는 보기 (국내/해외는 언어 기준)
  const newsMatch = (i, f) => {
    if (f === 'all') return i.kind !== 'filing' || i.level !== 'low';
    if (f === 'filing') return i.kind === 'filing';
    if (f === 'related') return i.kind === 'related';
    if (f === 'faa') return i.faa;
    if (f === 'kr') return i.kind !== 'filing' && i.base !== 'industry' && i.lang === 'ko';
    if (f === 'en') return i.kind !== 'filing' && i.base !== 'industry' && !i.official && i.lang !== 'ko';
    if (f === 'industry') return i.base === 'industry';
    return false;
  };
  const unseenCount = (sym = state.stock) => newsItems(sym).filter((i) => i.t > seen[sym].at && i.level !== 'low').length;

  function updateNewsBadge() {
    const b = document.getElementById('news-badge');
    if (!b) return;
    const U = curUI();
    const n = state.view === U.view ? 0 : unseenCount();
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = n === 0;
  }
  function markNewsSeen() {
    const s = seen[state.stock];
    s.prev = s.at;
    s.at = Date.now();
    savePref(curUI().seenKey, String(s.at));
    updateNewsBadge();
  }

  const dayLabel = (ms) => {
    const d = new Date(ms), today = new Date();
    const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (EN) return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (diff === 0) return '오늘';
    if (diff === 1) return '어제';
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
  };
  const timeLabel = (it) => {
    if (it.dateOnly) return '';
    const m = Math.round((Date.now() - it.t) / 60000);
    if (m < 60) return EN ? `${Math.max(1, m)}m ago` : `${Math.max(1, m)}분 전`;
    if (m < 24 * 60) return EN ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 60)}시간 전`;
    return hm(it.t);
  };

  function renderNewsSummary(sym = state.stock) {
    const U = NEWS_UI[sym], N = U.getN();
    const id = U.sum.slice(2), title = EN ? 'New items · filings summary' : '새 소식 · 공시 요약';
    if (!N) { if (document.getElementById(U.sum)) card(id, { title, body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const F = N.filings || [];
    const since = Date.now() - 30 * 86400000;
    const recent = F.filter((f) => Date.parse(f.d) >= since);
    const cnt = (re) => recent.filter((f) => re.test(f.form)).length;
    const k8 = F.find((f) => /^8-K/.test(f.form)), rep = F.find((f) => /^10-[QK]/.test(f.form));
    const off = (N.official || [])[0];
    const unseen = newsItems(sym).filter((i) => i.t > seen[sym].prev && i.level !== 'low').length;
    const ins = cnt(/^4$|^4\/A$/) + cnt(/^144/);
    const upd = (t) => (EN ? `Updated ${ago(t || state.data?.updatedAt)}` : t ? `${ago(t)} 업데이트` : `${ago(state.data?.updatedAt)} 업데이트`);
    const goEarn = sym === 'CRCL' ? 'earn:c-earnings' : 'searn:c-searnings', goIns = sym === 'CRCL' ? 'crcl:c-insider' : 'sprice:c-sinsider';
    card(id, {
      title, sub: `${F.length ? `공시 ${upd(N.filingsAt)} · ` : ''}뉴스 ${upd(N.newsAt)}`, info: INFO.news,
      body: `<div class="ns-grid n2">
          <div><span>새 소식</span><b>${unseen}건</b><small>지난 방문 이후</small></div>
          ${F.length ? `<div><span>최근 8-K(수시공시)</span><b>${k8 ? md(isoToTs(k8.d)) : '–'}</b><small>30일간 ${cnt(/^8-K/)}건</small></div>` : `<div><span>회사 발표</span><b>${(N.official || []).length}건</b><small>최근 모은 것</small></div>`}
        </div>
        ${off ? `<a class="ns-top" href="${safeUrl(off.url)}" target="_blank" rel="noopener"><span class="nk related">최신 ${U.name} 발표</span><span class="nt">${esc(off.title)}</span><span class="nm">${esc(off.source)} · ${dayLabel(Date.parse(off.t))}</span></a>` : ''}
        ${F.length ? `<div class="ns-go">
          <button type="button" class="ns-go-b" data-go="${goEarn}"><span class="ns-go-h">📊 ${EN ? 'Earnings reports' : '실적 보고서'}</span><b>${rep ? esc(formInfo(rep.form).label) : '–'}</b>${rep ? `<em>${EN ? `Filed ${md(isoToTs(rep.d))}` : `${md(isoToTs(rep.d))} 제출`}</em>` : ''}<small>${EN ? 'Open Earnings' : '실적 탭에서 보기'} ›</small></button>
          <button type="button" class="ns-go-b" data-go="${goIns}"><span class="ns-go-h">👤 ${EN ? 'Insider filings' : '내부자 거래'}</span><b>${EN ? `${ins} filings` : `${ins}건`}</b><em>${EN ? 'Last 30 days' : '최근 30일'}</em><small>${EN ? 'See details' : '자세히 보기'} ›</small></button>
        </div>` : ''}`,
    });
  }

  // 실적 카드 부제에 붙일 최근 분기·연간 보고서(10-Q·10-K) 원문 링크
  function repDoc(sym) {
    const F = NEWS_UI[sym]?.getN()?.filings || [], r = F.find((f) => /^10-[QK]/.test(f.form));
    return r ? ` · <a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${esc(r.form.replace('/A', ''))} 원문(${md(isoToTs(r.d))})</a>` : '';
  }

  function renderNews(sym = state.stock) {
    const U = NEWS_UI[sym];
    const el = document.getElementById(U.list);
    if (!el) return;
    const all = newsItems(sym);
    const f = U.filter;
    let list = all.filter((i) => newsMatch(i, f));
    if (f === 'filing' && state.majorOnly) list = list.filter((i) => i.level !== 'low');
    const counts = Object.fromEntries(U.filters.map(([k]) => [k, all.filter((i) => newsMatch(i, k)).length]));
    let lastDay = '';
    const rows = list.slice(0, 80).map((i) => {
      const dl = dayLabel(i.t);
      const head = dl !== lastDay ? `<li class="nd">${dl}</li>` : '';
      lastDay = dl;
      const isNew = i.t > seen[sym].prev && seen[sym].prev > 0;
      const kindCls = i.kind === 'filing' ? `filing ${i.level}` : i.kind;
      const kindTxt = i.kind === 'filing' ? i.form : i.official ? '공식' : U.badges[i.kind];
      return `${head}<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">
        <span class="nk ${kindCls}${i.official ? ' official' : ''}">${esc(kindTxt)}</span>
        <span class="nt">${isNew ? '<i class="new">NEW</i>' : ''}${i.faa && sym === 'JOBY' ? '<i class="faa-tag">FAA</i>' : ''}${esc(i.title)}</span>
        ${i.sum ? `<span class="nsum">${esc(i.sum)}</span>` : ''}
        <span class="nm">${esc(i.source)}${timeLabel(i) ? ' · ' + timeLabel(i) : ''}</span></a></li>`;
    }).join('');
    el.innerHTML = `
      <div class="nf" role="group" aria-label="뉴스 종류">${U.filters.map(([k, label]) => `<button type="button" data-nf="${k}" aria-pressed="${k === f}">${label}<small>${counts[k]}</small></button>`).join('')}</div>
      ${f === 'filing' ? `<label class="nf-opt"><input type="checkbox" id="major-only" ${state.majorOnly ? 'checked' : ''}> 주요 공시만 보기 <small>(임원 지분변동 Form 4·매도예정 144 숨김)</small></label>` : ''}
      <ul class="nl">${rows || '<li class="empty">표시할 항목이 없습니다.</li>'}</ul>
      <p class="note">제목을 누르면 원문이 새 창으로 열립니다. 공시는 SEC EDGAR, 뉴스는 구글 뉴스·전문 매체 RSS에서 새로고침 때마다 받습니다. 회색 한 줄 요약은 AI가 기사 앞부분을 읽고 만든 것이라 틀릴 수 있어요.</p>`;
  }

  // ---------------------------------------------------------------- 종목 선택 · 하단 탭 (Fire Portfolio)
  // CRCL은 전용 화면, 나머지 종목(JOBY·SPCX·TEM)은 같은 틀(sprice·searn·snews)에 종목별 설정으로 그린다.
  const ICONS = {
    home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M4 19h16M6 15l4-5 3 3 5-7"/>',
    earn: '<path d="M5 20V10M10 20V5M15 20v-8M20 20V8"/>',
    usdc: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.3c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.5 5.8 4.4 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-2.9-1.7M12 6v1.7m0 8.6V18"/>',
    arc: '<path d="M4 19a8 8 0 0 1 16 0M8 19a4 4 0 0 1 8 0"/>',
    news: '<path d="M5 5h11v14H6a1 1 0 0 1-1-1zM16 9h3v9a1 1 0 0 1-1 1h-2M8 9h5M8 12h5M8 15h3"/>',
  };
  const TAB_SETS = {
    CRCL: [['home', 'Home', 'home'], ['crcl', 'CRCL', 'chart'], ['usdc', 'USDC', 'usdc'], ['arc', 'Arc', 'arc'], ['earn', 'Earnings', 'earn'], ['news', 'News', 'news']],
  };
  const CRCL_TABS = TAB_SETS.CRCL.slice();
  const tabsFor = (s) => (isKR(s) ? [['home', 'Home', 'home'], ['sprice', symLabel(s).replace('…', ''), 'chart'], ['searn', '실적', 'earn'], ['snews', 'News', 'news']] : [['home', 'Home', 'home'], ['sprice', s, 'chart'], ['searn', STOCK_INFO[s]?.etf ? '분배금' : 'Earnings', 'earn'], ['snews', 'News', 'news']]);
  for (const s of OTHER) TAB_SETS[s] = tabsFor(s);
  const OLD_VIEWS = { jprice: 'sprice', jearn: 'searn', jnews: 'snews' }; // 예전 주소(#jprice 등) 호환
  // 종목 바로가기 링크(?s=JOBY)로 들어오면 그 종목부터 보여준다
  const linkStock = (new URLSearchParams(location.search).get('s') || '').toUpperCase();
  if (WATCH.includes(linkStock)) savePref('stock', linkStock);
  state.stock = WATCH.includes(loadPref('stock', 'CRCL')) ? loadPref('stock', 'CRCL') : WATCH[0];
  state.srange = loadPref('jrange', '1d');
  state.holders = {};
  state.analyst = {};
  state.holdTab = loadPref('holdTab', 'top');
  const shortOf = (sym) => state.data?.short?.by?.[sym] || (sym === 'JOBY' ? state.data?.short?.joby : null) || st(sym).short || null;
  const stockParts = (sym) => (sym === 'CRCL' ? ['holders', 'analyst', 'options'] : isKR(sym) ? ['schart', 'snews', 'krinfo', ...(BIZ_KEYS.has(bizKey(sym)) || bizAuto(sym) ? ['biz'] : [])] : ['schart', 'searn', 'snews', 'sfilings', 'holders', 'analyst', 'options', ...(BIZ_KEYS.has(sym) || bizAuto(sym) ? ['biz'] : []),
    ...(sym === 'JOBY' ? ['faa', 'facts'] : []), ...(sym === 'SPCX' ? ['sfacts', 'facts'] : []), ...(sym === 'TEM' ? ['temk', 'facts'] : []), ...(STOCK_INFO[sym]?.custom ? ['sshort'] : []), 'etfdiv']);
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const usdS2 = (v) => (v == null ? '–' : (v < 0 ? '-' : '') + usd(Math.abs(v)));
  const sp = (v) => (v == null || !isFinite(v) ? '–' : `<span class="${cls(v)}">${pct(v)}</span>`);
  const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

  function renderTabbar() {
    const nav = document.getElementById('tabbar');
    if (!nav) return;
    const tabs = TAB_SETS[state.stock], sym = state.stock, S = STOCK_INFO[sym] || {};
    const btn = ([v, label, ic]) => `<button type="button" data-tab="${v}" ${v === state.view ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[ic]}</svg><span>${label}</span>${ic === 'news' ? '<b class="tab-badge" id="news-badge" hidden></b>' : ''}</button>`;
    // 종목 묶음 안에서는 위에 종목 이름이 있으니 탭 이름은 짧게(차트·실적·뉴스)
    const short = ([v, label, ic]) => [v, ic === 'chart' ? (EN ? 'Chart' : '차트') : ic === 'earn' ? (label === '분배금' ? label : EN ? 'Earnings' : '실적') : ic === 'news' ? (EN ? 'News' : '뉴스') : label, ic];
    const rest = tabs.filter(([v]) => v !== 'home').map(short), nm = isKR(sym) ? (S.name || sym).replace(/\s+/g, '') : sym === 'CRCA' ? 'CRCL' : sym;
    nav.classList.add('tb2');
    nav.style.setProperty('--tabs', rest.length);
    nav.style.setProperty('--sc', S.color || 'var(--accent)');
    // 아래 탭 = [지금 보는 종목 줄(이름·가격 · 바꾸기)] + [Home · 차트 · 실적 · 뉴스 …] — 이미지 없이 글자로만(로고가 없거나 늦게 떠도 깨지지 않게)
    nav.classList.add('tb3');
    nav.classList.remove('tb2');
    nav.style.setProperty('--tabs', tabs.length);
    nav.style.setProperty('--sc', /^#|^rgb/.test(S.color || '') ? S.color : 'var(--accent)');
    const full = isKR(sym) ? S.name || sym : sym === 'CRCA' ? 'CRCL' : sym; // 미국은 티커만, 한국은 종목명
    nav.innerHTML = `<button type="button" class="tb-now" data-stocksheet="1" aria-label="${EN ? `Stock screens: ${esc(full)} — change stock` : `종목 화면: ${esc(full)} — 종목 바꾸기`}"><i class="tb-dot" aria-hidden="true"></i><span class="tb-cap">${EN ? 'Viewing' : '지금 종목'}</span><b class="tb-nm">${esc(full)}</b><span class="tb-px" id="tb-px"></span><span class="tb-sw">${EN ? 'Change' : '바꾸기'} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></span></button><div class="tb-row">${tabs.map(([v, label, ic]) => btn([v, v === 'home' ? label : short([v, label, ic])[1], ic])).join('')}</div>`;
    updateTbNow();
    updateNewsBadge();
  }
  function updateTbNow() {
    const el = document.getElementById('tb-px');
    if (!el) return;
    const p = stockPx(state.stock), dot = document.querySelector('.tb-dot');
    if (dot) dot.className = `tb-dot ${p?.pct > 0 ? 'up' : p?.pct < 0 ? 'down' : ''}`; // 오르면 빨강 · 내리면 파랑
    const html = p?.price != null ? `${pxS(state.stock, p.price)} <em class="${cls(p.pct)}">${p.pct != null ? pct(p.pct, 1) : ''}</em>` : '';
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  const viewAllowed = (v) => v === 'fire' || v === 'flow' || v === 'mkt' || TAB_SETS[state.stock].some(([t]) => t === v);

  // 종목 시세: 바이낸스 선물이 있는 종목(SPCX·TEM)은 CRCL처럼 바이낸스 값만, 나머지(JOBY)는 Nasdaq + Yahoo 실시간 체결
  function pq(sym) {
    if (isKR(sym)) return state.krq?.[sym] || null;
    if (BN24[sym]) {
      const t = bx[sym]?.t;
      return t ? { price: t.last, pct: t.pct, change: t.last - t.open, prevClose: t.open, status: 'BN24', time: t.E } : null;
    }
    return state.quote?.[sym] || null;
  }
  const statusLabel = (q) => (q?.status === 'BN24' ? '바이낸스 24시간' : mktStatus(q?.status));
  function stockPx(sym) {
    if (sym === 'CRCL' && px.t) return { price: px.t.last, pct: px.t.pct, live: true };
    const q = pq(sym);
    return q ? { price: q.price, pct: q.pct, live: !!BN24[sym] } : null;
  }
  // 종목 선택: 모든 종목이 한눈에 보이는 격자 칩(한 줄 4개, 종목이 늘면 줄이 늘어남).
  // 15초마다 시세를 바꿀 때 버튼을 새로 만들지 않고 값만 바꾼다(누르는 순간 버튼이 바뀌어 터치가 씹히지 않게).
  const logoOf = (t) => STOCK_INFO[t === 'CRCA' ? 'CRCL' : t]?.logo || logoPath(t) || '';
  // ---- 내 종목 폴더(탭): 전체 · 보유(퇴사까지·배당금에 넣은 종목, 자동) · 내가 만든 폴더. 종목은 한 줄로 옆으로 넘기고 '모두 보기'로 펼친다
  watchCfg.folders = (watchCfg.folders || []).filter((f) => f?.id && f.name && Array.isArray(f.syms)).slice(0, 12);
  const heldSet = () => new Set([...(fireCfg?.positions || []).map((p) => p.ticker), ...(divCfg?.hold || []).map((h) => h.t)]);
  function curFolder() {
    const f = loadPref('folder', 'all');
    if (f === 'hold') return WATCH.some((x) => heldSet().has(x)) ? 'hold' : 'all';
    return watchCfg.folders.some((x) => x.id === f) ? f : 'all';
  }
  function folderSyms(f = curFolder()) {
    if (f === 'hold') { const H = heldSet(); return WATCH.filter((x) => H.has(x)); }
    const F = watchCfg.folders.find((x) => x.id === f);
    return F ? WATCH.filter((x) => F.syms.includes(x)) : WATCH;
  }
  const ssExpanded = () => loadPref('ssExpand', innerWidth >= 900 ? '1' : '0') === '1';
  function renderFolders(n) {
    const el = document.getElementById('ss-folders');
    if (!el) return;
    const f = curFolder(), H = heldSet(), nHold = WATCH.filter((x) => H.has(x)).length;
    const chip = (id, label, cnt, user) => `<button type="button" role="tab" class="fd" data-folder="${esc(id)}" aria-selected="${f === id}"${user ? ' data-noi18n="1"' : ''}>${label}<small>${cnt}</small></button>`;
    const html = chip('all', EN ? 'All' : '전체', WATCH.length) + (nHold ? chip('hold', EN ? 'Holdings' : '보유', nHold) : '')
      + watchCfg.folders.map((x) => chip(x.id, esc(x.name), WATCH.filter((y) => x.syms.includes(y)).length, true)).join('')
      + (watchCfg.folders.some((x) => x.id === f) ? `<button type="button" class="fd fd-act" data-fedit="${esc(f)}">✎ ${EN ? 'Edit' : '편집'}</button>` : '')
      + `<button type="button" class="fd fd-act" data-fnew="1">＋ ${EN ? 'Folder' : '폴더'}</button>`;
    if (el.innerHTML !== html) el.innerHTML = html;
    const tg = document.getElementById('ss-toggle');
    if (tg) { tg.hidden = n <= 4 && !ssExpanded(); const t = ssExpanded() ? (EN ? 'One row ▴' : '한 줄로 ▴') : (EN ? `All ${n} ▾` : `모두 보기 ${n} ▾`); if (tg.textContent !== t) tg.textContent = t; }
  }
  function ssScrollToActive() {
    const el = document.getElementById('stock-switch'), b = el?.querySelector('.ss[aria-selected="true"]');
    if (!b || !el.classList.contains('ss-row')) return;
    if (b.offsetLeft < el.scrollLeft || b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, b.offsetLeft - 24);
  }
  // 보유 종목(퇴사까지·배당금)은 내 종목에도 자동으로 넣는다('보유' 폴더에 보이게, 예: CRCA)
  // 한 번 넣은 종목은 기억해 두고, 사용자가 내 종목에서 빼면 다시 넣지 않는다
  function syncHeldToWatch(boot) {
    if (DEMO) return;
    const done = new Set(readJSON('cw.heldAdded', []) || []), add = [];
    for (const t of heldSet()) {
      if (WATCH.includes(t) || done.has(t) || !SYM_OK.test(t)) continue;
      if (!BUILTIN.includes(t)) {
        const lab = String(FIRE_TICKERS[t] || '').split(' · '), nm = (krTk(t) ? lab[0] : lab[1]) || t;
        watchCfg.custom[t] = { name: nm, exchange: krTk(t) ? (t.endsWith('.KQ') ? 'KOSDAQ' : 'KOSPI') : '' };
        registerStock(t);
      }
      WATCH.push(t); done.add(t); add.push(t);
    }
    if (!add.length) return;
    writeJSON('cw.heldAdded', [...done]);
    saveWatch();
    if (boot) { for (const t of add) liveSubscribe(t); return; } // 처음 그릴 때는 이어지는 시작 과정이 시세·자료를 받는다
    const sw = document.getElementById('stock-switch'); if (sw) sw.dataset.built = '';
    for (const t of add) afterWatchChange(t);
  }
  let fdEdit = null, fdConfirm = false;
  function openFolderSheet(id) {
    const F = watchCfg.folders.find((x) => x.id === id);
    fdEdit = F ? id : null; fdConfirm = false;
    if (!F && watchCfg.folders.length >= 12) { toast(EN ? 'Up to 12 folders' : '폴더는 12개까지 만들 수 있어요', true); return; }
    let el = document.getElementById('fd-sheet');
    if (!el) { el = document.createElement('div'); el.id = 'fd-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el); }
    el.setAttribute('aria-label', F ? (EN ? 'Edit folder' : '폴더 편집') : (EN ? 'New folder' : '새 폴더'));
    el.hidden = false; document.body.classList.add('sheet-open');
    el.innerHTML = `<div class="sheet-bg" data-fclose="1"></div><div class="sheet-panel fd-panel">
      <div class="sheet-h"><b>📁 ${F ? (EN ? 'Edit folder' : '폴더 편집') : (EN ? 'New folder' : '새 폴더')}</b><button type="button" class="ws-btn" data-fclose="1">${EN ? 'Close' : '닫기'}</button></div>
      <label class="fd-name"><span>${EN ? 'Folder name' : '폴더 이름'}</span><input id="fd-name" maxlength="12" value="${esc(F?.name || '')}" placeholder="${EN ? 'e.g. Watching, Dividend picks' : '예: 관심 종목, 눈여겨볼 종목, 배당주'}" autocomplete="off"></label>
      <div class="fd-sub"><b>${EN ? 'Stocks in this folder' : '넣을 종목'}</b><small>${EN ? 'from My stocks' : '내 종목 중에서 골라요 · 여러 폴더에 넣어도 돼요'}</small></div>
      <ul class="fd-list">${WATCH.map((x) => { const S = STOCK_INFO[x]; return `<li><label><input type="checkbox" value="${esc(x)}" ${F?.syms.includes(x) ? 'checked' : ''}><span class="ws-logo" style="--sc:${S.color}">${S.logo ? `<img src="${S.logo}" alt="" width="20" height="20">` : esc((S.mark || symLabel(x))[0])}</span><span class="fd-nm"><b>${esc(symLabel(x))}</b><small>${esc(S.name || '')}</small></span></label></li>`; }).join('')}</ul>
      <p class="note">${EN ? 'Not listed? Add it first with <b>＋ Add · Edit</b>.' : '목록에 없는 종목은 먼저 <b>＋ 추가·편집</b>으로 내 종목에 넣어 주세요.'}</p>
      <div class="fd-btns"><button type="button" class="btn-primary" data-fsave="1">${EN ? 'Save' : '저장'}</button>${F ? `<button type="button" class="btn-ghost" data-fdel="1">${EN ? 'Delete folder' : '폴더 삭제'}</button>` : ''}</div>
    </div>`;
    if (!F) setTimeout(() => document.getElementById('fd-name')?.focus(), 50);
  }
  function closeFolderSheet() { const el = document.getElementById('fd-sheet'); if (el) el.hidden = true; document.body.classList.remove('sheet-open'); }
  function saveFolder() {
    const name = (document.getElementById('fd-name')?.value || '').trim().slice(0, 12);
    if (!name) { toast(EN ? 'Name the folder' : '폴더 이름을 넣어 주세요', true); document.getElementById('fd-name')?.focus(); return; }
    const syms = [...document.querySelectorAll('#fd-sheet .fd-list input:checked')].map((i) => i.value);
    let F = watchCfg.folders.find((x) => x.id === fdEdit);
    if (F) Object.assign(F, { name, syms });
    else { F = { id: 'f' + Date.now().toString(36), name, syms }; watchCfg.folders.push(F); }
    saveWatch(); savePref('folder', F.id);
    closeFolderSheet();
    const sw = document.getElementById('stock-switch'); if (sw) sw.dataset.built = '';
    renderStockSwitch();
    toast(EN ? `✓ “${name}” · ${syms.length} stocks` : `✓ '${name}' 폴더 · 종목 ${syms.length}개`);
  }
  function deleteFolder() {
    if (!fdConfirm) { fdConfirm = true; const b = document.querySelector('[data-fdel]'); if (b) b.textContent = EN ? 'Really delete' : '정말 삭제'; return; }
    watchCfg.folders = watchCfg.folders.filter((x) => x.id !== fdEdit);
    saveWatch(); savePref('folder', 'all');
    closeFolderSheet();
    const sw = document.getElementById('stock-switch'); if (sw) sw.dataset.built = '';
    renderStockSwitch();
    toast(EN ? 'Folder deleted (stocks stay in My stocks)' : '폴더를 지웠어요(종목은 내 종목에 그대로 있어요)');
  }
  function renderStockSwitch() {
    const el = document.getElementById('stock-switch');
    if (!el) return;
    const syms = folderSyms(), key = `${curFolder()}|${ssExpanded() ? 'g' : 'r'}|${syms.join(',')}`;
    renderFolders(syms.length);
    if (el.dataset.built !== key) {
      el.classList.toggle('ss-row', !ssExpanded());
      el.innerHTML = !syms.length ? `<p class="ss-empty">${EN ? 'No stocks in this folder yet — tap <b>✎ Edit</b> to add some.' : '이 폴더에 아직 종목이 없어요. <b>✎ 편집</b>에서 넣어 주세요.'}</p>` : syms.map((sym) => `<button type="button" role="tab" class="ss" data-stock="${sym}" style="--sc:${STOCK_INFO[sym].color}" title="${esc(STOCK_INFO[sym].name)}">
        <span class="ss-top">${STOCK_INFO[sym].logo ? `<img class="ss-logo" src="${STOCK_INFO[sym].logo}" alt="" width="20" height="20" decoding="async">` : `<i class="ss-logo ss-letter">${esc(STOCK_INFO[sym].mark || sym[0])}</i>`}<span class="ss-tk">${esc(symLabel(sym))}</span></span>
        <span class="ss-px">–</span><span class="ss-bot"><em class="ss-ch flat"></em><i class="ss-ed" hidden data-noi18n><b></b>${EN ? 'Earn' : '실적'}</i></span></button>`).join('');
      el.dataset.built = key;
      requestAnimationFrame(ssScrollToActive);
    }
    updateTbNow();
    for (const btn of el.querySelectorAll('.ss[data-stock]')) {
      const sym = btn.dataset.stock, p = stockPx(sym);
      // 실적 발표 전날·당일·직후: 등락률 옆에 작은 '실적' 태그(당일은 점이 깜빡임)
      const ed = btn.querySelector('.ss-ed'), D = earnDay(sym);
      if (ed) {
        ed.hidden = !D;
        const today = D?.phase === 'pre' && earnOf(sym)?.next?.date === etDate();
        ed.classList.toggle('live', !!today); ed.classList.toggle('done', D?.phase === 'post');
        ed.title = !D ? '' : D.phase === 'post' ? (EN ? 'Earnings just released' : '실적 발표됨') : today ? (EN ? 'Earnings today' : '오늘 실적 발표') : (EN ? 'Earnings tomorrow' : '내일 실적 발표');
      }
      btn.setAttribute('aria-selected', String(sym === state.stock));
      btn.setAttribute('aria-label', `${STOCK_INFO[sym].name} ${sym} ${p?.price != null ? pxS(sym, p.price) : ''} ${p?.pct != null ? pct(p.pct, 1) : ''}`);
      btn.querySelector('.ss-px').textContent = p?.price != null ? pxS(sym, p.price) : '–';
      const ch = btn.querySelector('.ss-ch');
      ch.className = `ss-ch ${cls(p?.pct)}`;
      ch.textContent = p?.pct != null ? pct(p.pct, 1) : '';
    }
  }
  function setStock(sym) {
    if (!STOCK_INFO[sym] || !WATCH.includes(sym) || sym === state.stock) return;
    state.stock = sym;
    savePref('stock', sym);
    document.getElementById('home-crcl').hidden = isOther(sym);
    document.getElementById('home-stock').hidden = !isOther(sym);
    renderTabbar();
    renderStockSwitch();
    ssScrollToActive();
    if (state.view === 'home') pulseTabGroup();
    if (!viewAllowed(state.view)) showView('home');
    else document.getElementById('view-title').textContent = viewTitle(state.view);
    fireLoop(state.view === 'fire' || isOther());
    renderStock();
    busyBar(true);
    if (sym === 'CRCL') { try { renderKpis(); renderSummary(); } catch (e) { console.error(e); } } // 미리 받아 둔 값으로 Home 지표·요약도 바로
    syncNow(['quote', ...stockParts(sym)], { sym }).then(() => { if (state.stock === sym) { renderStock(); if (sym === 'CRCL') { renderKpis(); renderSummary(); } } }).catch(() => {}).finally(() => busyBar(false));
  }


  // 아래 탭의 종목 이름을 누르면: 내 종목 목록에서 바로 바꾸기(지금 보던 화면 종류는 유지)
  function openStockSheet() {
    let el = document.getElementById('sw-sheet');
    if (!el) { el = document.createElement('div'); el.id = 'sw-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el); }
    el.setAttribute('aria-label', EN ? 'Change stock' : '종목 바꾸기');
    const row = (x) => { const p = stockPx(x), nm = isKR(x) ? STOCK_INFO[x].name : x; return `<button type="button" class="sw-row${x === state.stock ? ' on' : ''}" data-swpick="${esc(x)}">${logoOf(x) ? `<img src="${logoOf(x)}" alt="" width="26" height="26">` : `<i class="ss-letter">${esc((STOCK_INFO[x].mark || x)[0])}</i>`}<span><b>${esc(nm)}</b><small>${esc(isKR(x) ? x.slice(0, 6) : STOCK_INFO[x].short || '')}</small></span><em class="${cls(p?.pct)}">${p?.pct != null ? pct(p.pct, 2) : ''}</em></button>`; };
    el.innerHTML = `<div class="sheet-bg" data-swclose="1"></div><div class="sheet-panel sw-panel">
      <div class="sheet-h"><b>${EN ? 'Which stock’s screens?' : '어떤 종목 화면을 볼까요?'}</b><button type="button" class="ws-btn" data-swclose="1">${EN ? 'Close' : '닫기'}</button></div>
      <p class="note sw-note">${EN ? 'The tabs next to Home (chart · earnings · news) switch to the stock you pick here. Home stays the same.' : '아래 Home 옆의 탭(차트·실적·뉴스)이 여기서 고른 종목 화면으로 바뀌어요. Home은 그대로예요.'}</p>
      <div class="sw-list">${WATCH.map(row).join('')}</div></div>`;
    el.hidden = false; document.body.classList.add('sheet-open');
  }
  function closeStockSheet() { const el = document.getElementById('sw-sheet'); if (el) el.hidden = true; document.body.classList.remove('sheet-open'); }
  function pickStockFromSheet(sym) {
    const kind = { crcl: 'chart', sprice: 'chart', earn: 'earn', searn: 'earn', news: 'news', snews: 'news' }[state.view];
    closeStockSheet();
    setStock(sym);
    if (kind) { const t = TAB_SETS[state.stock].find(([, , ic]) => ic === kind); if (t) showView(t[0]); }
    window.scrollTo({ top: 0 });
  }
  // 홈에서 종목을 고르면 아래 종목 묶음을 잠깐 반짝여 '여기가 이 종목 화면'임을 알려준다
  function pulseTabGroup() { const g = document.querySelector('.tabbar .tb-now'); if (!g) return; g.classList.remove('tb-pulse'); void g.offsetWidth; g.classList.add('tb-pulse'); }

  // ---------------------------------------------------------------- 종목: 시세 · 차트
  const SRANGES = { '1d': '1일', '1w': '1주', '1m': '1개월', '3m': '3개월', '1y': '1년' };
  async function loadSChart(sym, r) {
    const j = await getJ(`${NEWS_API}/chart?s=${sym}&r=${r}`, 15000);
    if (j.error) throw new Error(j.error);
    j.points = yahooView(j.points, r);
    st(sym).chart[r] = j;
  }
  const ipoPx = () => state.spcx?.ipo?.price ?? null;
  let sPrev = { sym: null, px: null };
  function paintStock() {
    const sym = state.stock;
    if (!isOther(sym)) return;
    const q = pq(sym);
    if (!q) { if (BN24[sym]) setHtml('spx-via', bx[sym]?.err ? '<span class="warn">바이낸스 연결 실패 · 다시 시도 중</span>' : '연결 중…'); return; }
    const last = document.getElementById('spx-last');
    if (last) {
      last.textContent = pxS(sym, q.price);
      if (sPrev.sym === sym && sPrev.px != null && q.price !== sPrev.px && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        last.classList.remove('flash-up', 'flash-down'); void last.offsetWidth; last.classList.add(q.price > sPrev.px ? 'flash-up' : 'flash-down');
      }
    }
    sPrev = { sym, px: q.price };
    setHtml('spx-chg', `<span class="${cls(q.pct)}">${arrow(q.pct)} ${q.change >= 0 ? '+' : '-'}${isKR(sym) ? wonPx(Math.abs(q.change ?? 0)) : '$' + Math.abs(q.change ?? 0).toFixed(2)} (${pct(q.pct, 2)})</span>`);
    setHtml('spc-last', pxS(sym, q.price));
    if (BN24[sym]) {
      // CRCL 가격 카드와 같은 항목: 24시간 범위·거래대금·펀딩비·미결제약정
      const X = bx[sym], t = X.t;
      setHtml('spx-via', X.via === 'ws' ? '<span class="live-dot"></span>실시간 체결' : X.via === 'rest' ? '5초마다 갱신' : '연결 중…');
      setHtml('spx-time', hm(t.E || X.at) + ' 기준');
      const pos = t.high > t.low ? (t.last - t.low) / (t.high - t.low) : 0.5;
      const rb = document.getElementById('spx-rb');
      if (rb) rb.style.left = `${Math.min(100, Math.max(0, pos * 100))}%`;
      setHtml('spx-low', price(t.low));
      setHtml('spx-high', price(t.high));
      setHtml('spx-qv', usd(t.qv));
      if (X.mark) {
        setHtml('spx-fund', `<span class="${cls(X.mark.fund)}">${X.mark.fund > 0 ? '+' : ''}${(X.mark.fund * 100).toFixed(4)}%</span>`);
        setHtml('spx-next', fundLeft(X.mark.next));
      }
      if (X.oi != null) setHtml('spx-oi', usd(X.oi * (X.mark?.mark || t.last)));
      const k = X.klines[bxRange()];
      if (k?.length) { const ch = t.last / k[0][1] - 1; setHtml('spc-chg', `<span class="${cls(ch)}">${arrow(ch)} ${pct(ch, 2)}</span> <span class="lbl">${RANGES[bxRange()].label} 동안</span>`); }
      for (const id of ['sspark', 'spricechart']) liveCandle(id, t.last);
      return;
    }
    setHtml('spx-via', `<span class="live-dot"></span>${esc(mktStatus(q.status))} · ${isLive(sym) ? '실시간 체결' : '15초마다 갱신'}`);
    setHtml('spx-time', isKR(sym) ? esc((q.time ? new Date(q.time).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) + (EN ? ' KST' : ' 기준') : '') + (q.after?.price && q.status !== 'KR_OPEN' ? ` · ${EN ? 'after-hours' : '시간외'} ${wonPx(q.after.price)}` : ''))
      : esc(String(q.time || '').replace(/^.*?(\d{1,2}:\d{2} [AP]M ET)$/, '$1')));
    const S = STOCK_INFO[sym], pr = S.peer ? state.quote?.[S.peer[0]] : null;
    if (pr) setHtml('spx-peer', `$${pr.price?.toFixed(2)} <span class="${cls(pr.pct)}">${pct(pr.pct, 1)}</span>`);
    if (sym === 'SPCX' && ipoPx()) setHtml('spx-ipo', `<span class="${cls(q.price / ipoPx() - 1)}">${pct(q.price / ipoPx() - 1, 1)}</span>`);
    for (const id of ['sspark', 'spricechart']) if (state.srange === '1d' || id === 'sspark') liveCandle(id, q.price);
  }
  // range: '1d'·'1w'… (Yahoo 캔들) 또는 'bn'(바이낸스 1일)
  function sLine(id, pts, { compact = false, range = '1d', sym = state.stock } = {}) {
    if (!pts?.length) return;
    const q = pq(sym);
    const intraday = range === '1d' || range === 'bn' || range === '1w';
    const tip = (it) => { const d = new Date(pts[it.dataIndex][0]); return intraday ? d.toLocaleString(LOC, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString(LOC); };
    // 바이낸스는 24시간 이어지므로 어느 기간이든 마지막 캔들에 현재가 반영, Yahoo는 오늘(1일) 캔들만
    const last = BN24[sym] || range === '1d' || range === 'bn' ? q?.price : null;
    drawCandles(id, pts, { compact, xf: range === '1d' || range === 'bn' ? hm : mdLocal, tip, last, ind: !compact, fmt: (v) => pxS(sym, v) });
  }

  const bxRange = () => (RANGES[state.srange] ? state.srange : '1d'); // 바이낸스 캔들은 1일~3개월
  function renderSPriceCard(sym = state.stock) {
    if (BN24[sym]) {
      const X = bxOf(sym);
      card('sprice', {
        title: `${sym} 실시간 주가`, sub: `Binance ${BN24[sym]} 무기한 선물 · 24시간 거래`, info: INFO.sprice(sym),
        body: `
          <div class="px-main"><span class="px-last" id="spx-last">${pxS(sym, X.t?.last)}</span><span class="px-chg" id="spx-chg"></span></div>
          <div class="px-meta"><span id="spx-via">연결 중…</span><span id="spx-time"></span></div>
          <div class="chart spark"><canvas id="cv-sspark" role="img" aria-label="${sym} 최근 24시간 가격"></canvas></div>
          <div class="px-range" aria-label="24시간 가격 범위"><span id="spx-low">–</span><div class="rb"><i id="spx-rb"></i></div><span id="spx-high">–</span></div>
          <div class="px-stats">
            <div><span>24h 거래대금</span><b id="spx-qv">–</b></div>
            <div><span>펀딩비</span><b id="spx-fund">–</b><small id="spx-next"></small></div>
            <div><span>미결제약정</span><b id="spx-oi">–</b></div>
          </div>
          ${tgtHost(sym)}
          <button type="button" class="link-btn" data-go="sprice:c-spricechart">가격 차트 · 공매도 · 기관 보유 보기${chevron}</button>`,
      });
      sLine('sspark', X.klines['1d'], { compact: true, sym, range: 'bn' });
      paintStock();
      return;
    }
    const S = STOCK_INFO[sym], q = isKR(sym) ? pq(sym) : state.quote?.[sym], ch = st(sym).chart['1d'];
    const pts = ch?.points || [];
    const lo = pts.length ? Math.min(...pts.map((p) => p[1])) : null, hi = pts.length ? Math.max(...pts.map((p) => p[1])) : null;
    const pos = q?.price != null && hi > lo ? (q.price - lo) / (hi - lo) : 0.5;
    const y1 = st(sym).chart['1y'] || ch;
    const stats = sym === 'SPCX'
      ? `<div><span>상장 후 최고</span><b>${pxS(sym, y1?.high52)}</b></div><div><span>공모가 대비</span><b id="spx-ipo">–</b><small>공모가 ${pxS(sym, ipoPx())}</small></div>`
      : `<div><span>52주 최고</span><b>${pxS(sym, y1?.high52)}</b></div><div><span>52주 최저</span><b>${pxS(sym, y1?.low52)}</b></div>`;
    card('sprice', {
      title: `${ttlName(sym)}실시간 주가`, sub: isKR(sym) ? `${S.name} · ${S.exchange === 'KOSDAQ' ? '코스닥' : '코스피'} ${sym.slice(0, 6)} · 네이버 증권 실시간` : `${S.name} · Nasdaq 실시간(장전·장중·장후)`, info: isKR(sym) ? INFO.krprice : INFO.sprice(sym),
      body: `
        <div class="px-main"><span class="px-last" id="spx-last">${pxS(sym, q?.price)}</span><span class="px-chg" id="spx-chg"></span></div>
        <div class="px-meta"><span id="spx-via">불러오는 중…</span><span id="spx-time"></span></div>
        <div class="chart spark"><canvas id="cv-sspark" role="img" aria-label="${sym} 오늘 가격"></canvas></div>
        <div class="px-range" aria-label="오늘 가격 범위"><span>${pxS(sym, lo)}</span><div class="rb"><i style="left:${Math.min(100, Math.max(0, pos * 100))}%"></i></div><span>${pxS(sym, hi)}</span></div>
        <div class="px-stats">${stats}${S.peer ? `<div><span>경쟁사 ${S.peer[1]}</span><b id="spx-peer">–</b><small>${S.peer[0]}</small></div>` : `<div><span>52주 위치</span><b>${q?.price && y1?.high52 > y1?.low52 ? Math.round(((q.price - y1.low52) / (y1.high52 - y1.low52)) * 100) + '%' : '–'}</b><small>최저 0% · 최고 100%</small></div>`}</div>
        ${tgtHost(sym)}
        <button type="button" class="link-btn" data-go="sprice:c-spricechart">${isKR(sym) ? '가격 차트 보기' : '가격 차트 · 공매도 · 기관 보유 보기'}${chevron}</button>`,
    });
    sLine('sspark', pts, { compact: true, sym });
    paintStock();
  }

  function renderSPriceChart(sym = state.stock) {
    if (BN24[sym]) {
      const X = bxOf(sym), r = bxRange(), k = X.klines[r];
      let note = '';
      if (k?.length) note = `${RANGES[r].label} 최고 ${pxS(sym, Math.max(...k.map((p) => p[3] ?? p[1])))} · 최저 ${pxS(sym, Math.min(...k.map((p) => p[4] ?? p[1])))} · 시작 ${pxS(sym, k[0][2] ?? k[0][1])} · ${RANGES[r].yahoo ? (EN ? 'weekly · actual stock price (regular session, Yahoo)' : '주봉 · 실제 주가(정규장, Yahoo)') : RANGES[r].interval + ' 캔들'}`;
      card('spricechart', {
        title: `${sym} 가격 추이`, sub: `Binance ${BN24[sym]} 무기한 선물`, info: INFO.pricechart,
        body: `
          <div class="seg range" role="group" aria-label="기간 선택">${Object.entries(RANGES).map(([key, v]) => `<button type="button" data-srange="${key}" aria-pressed="${key === r}">${v.label}</button>`).join('')}</div>
          ${chartTools('spricechart')}
          <div class="px-main sm"><span class="px-last" id="spc-last">${pxS(sym, X.t?.last)}</span><span class="px-chg" id="spc-chg"></span></div>
          <div class="chart tall"><canvas id="cv-spricechart" role="img" aria-label="${sym} 가격 추이"></canvas></div>
          <p class="note">${note || '불러오는 중…'}</p>
          <div id="osc-spricechart"></div>`,
      });
      paintOsc(sym, 'osc-spricechart');
      if (!k) { bxKlines(sym, r).then(() => { if (bxRange() === r && state.stock === sym) renderSPriceChart(sym); }).catch(() => { const n = document.querySelector('#c-spricechart .note'); if (n && bxRange() === r) n.textContent = EN ? 'Could not load this range — tap refresh to try again.' : '이 기간 자료를 받지 못했어요 · 새로고침을 눌러 다시 시도해 주세요.'; }); return; }
      sLine('spricechart', k, { range: r === '1d' ? 'bn' : r, sym });
      paintStock();
      return;
    }
    const r = state.srange, ch = st(sym).chart[r];
    const pts = ch?.points || [];
    let note = '';
    if (pts.length) {
      const v = pts.map((p) => p[1]);
      note = `${SRANGES[r]} 최고 ${pxS(sym, Math.max(...v))} · 최저 ${pxS(sym, Math.min(...v))} · 시작 ${pxS(sym, v[0])}${ch.high52 ? ` · 52주 ${pxS(sym, ch.low52)}~${pxS(sym, ch.high52)}` : ''}`;
    }
    const q = state.quote?.[sym];
    const chg = pts.length && q?.price ? q.price / (r === '1d' && (q.prevClose || ch.prevClose) ? (q.prevClose || ch.prevClose) : pts[0][1]) - 1 : null;
    card('spricechart', {
      title: `${ttlName(sym)}가격 추이`, sub: `${STOCK_INFO[sym].name} · Yahoo Finance`, info: '',
      body: `
        <div class="seg range jr" role="group" aria-label="기간 선택">${Object.entries(SRANGES).map(([k, v]) => `<button type="button" data-srange="${k}" aria-pressed="${k === r}">${v}</button>`).join('')}</div>
        ${chartTools('spricechart')}
        <div class="px-main sm"><span class="px-last" id="spc-last">${pxS(sym, q?.price)}</span><span class="px-chg">${chg == null ? '' : `<span class="${cls(chg)}">${arrow(chg)} ${pct(chg, 2)}</span> <span class="lbl">${SRANGES[r]} 동안</span>`}</span></div>
        <div class="chart tall"><canvas id="cv-spricechart" role="img" aria-label="${sym} 가격 추이"></canvas></div>
        <p class="note">${note || '불러오는 중…'}</p>
        <div id="osc-spricechart"></div>`,
    });
    paintOsc(sym, 'osc-spricechart');
    if (!ch) { loadSChart(sym, r).then(() => { if (state.srange === r && state.stock === sym) renderSPriceChart(sym); }).catch(() => {}); return; }
    sLine('spricechart', pts, { range: r, sym });
  }

  // ---------------------------------------------------------------- 기관 보유 현황 (13F)
  // 널리 알려진 기관은 한글 이름을 같이 보여준다. major: '주요 금융사' 보기에 넣을지
  const INSTITUTIONS = [
    [/blackrock/i, '블랙록', 1], [/vanguard/i, '뱅가드', 1], [/state street/i, '스테이트 스트리트', 1], [/^fmr\b|fidelity/i, '피델리티', 1],
    [/jpmorgan|j\.p\. ?morgan/i, 'JP모건', 1], [/morgan stanley/i, '모건스탠리', 1], [/goldman/i, '골드만삭스', 1], [/citadel/i, '시타델', 1],
    [/ark invest/i, '아크 인베스트(캐시 우드)', 1], [/bank of america|merrill/i, '뱅크오브아메리카', 1], [/\bubs\b/i, 'UBS', 1], [/geode/i, '지오드 캐피털', 1],
    [/capital (research|world|international)/i, '캐피털 그룹', 1], [/norges/i, '노르웨이 국부펀드', 1], [/public investment fund/i, '사우디 국부펀드(PIF)', 1],
    [/charles schwab/i, '찰스 슈왑', 1], [/northern trust/i, '노던 트러스트', 1], [/invesco/i, '인베스코', 1], [/t\. ?rowe/i, 'T. 로우 프라이스', 1],
    [/wellington/i, '웰링턴', 1], [/citigroup/i, '씨티그룹', 1], [/wells fargo/i, '웰스파고', 1], [/barclays/i, '바클레이즈', 1], [/deutsche bank/i, '도이체방크', 1],
    [/jane street/i, '제인 스트리트', 1], [/susquehanna/i, '서스퀘하나', 1], [/two sigma/i, '투 시그마', 1], [/millennium/i, '밀레니엄', 1],
    [/d\. ?e\. shaw/i, 'D.E. 쇼', 1], [/renaissance/i, '르네상스', 1], [/baillie gifford/i, '베일리 기포드', 1], [/softbank/i, '소프트뱅크', 1],
    [/marshall wace/i, '마셜 웨이스', 0], [/\bidg\b/i, 'IDG 캐피털', 0], [/valor/i, '밸러 에퀴티', 0], [/vy capital/i, 'Vy 캐피털', 0],
    [/gigafund/i, '기가펀드', 0], [/a16z|andreessen/i, '안드리센 호로위츠(a16z)', 0], [/sc us \(ttgp\)|sequoia/i, '세쿼이아 캐피털', 0], [/bamco|baron capital/i, '배런 캐피털', 0], [/d1 capital/i, 'D1 캐피털', 0], [/founders fund/i, '파운더스 펀드', 0], [/toyota/i, '도요타', 0], [/coatue/i, '코투', 0], [/tiger global/i, '타이거 글로벌', 0],
  ];
  const instOf = (name) => INSTITUTIONS.find(([re]) => re.test(name || ''));
  const titleCase = (s) => String(s || '').replace(/\s*\/[a-z]{2,3}\/?\s*$/i, '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bLlc\b/g, 'LLC').replace(/\bL\.p\./g, 'L.P.').replace(/\bInc\b/g, 'Inc');
  const HOLD_TABS = [['top', '상위 보유'], ['major', '주요 금융사'], ['buy', '많이 산 곳'], ['sell', '많이 판 곳']];

  function renderHolders(sym = state.stock, id = sym === 'CRCL' ? 'holders' : 'sholders') {
    if (!document.getElementById('c-' + id)) return;
    const H = state.holders[sym], S = STOCK_INFO[sym];
    const title = '기관 보유 현황';
    if (!H) { card(id, { title, info: INFO.holders, body: '<p class="skeleton">기관 보유 현황 불러오는 중…</p>' }); return; }
    const latest = H.top.reduce((m, r) => (r.date > m ? r.date : m), '');
    const tab = HOLD_TABS.some(([k]) => k === state.holdTab) ? state.holdTab : 'top';
    let rows = tab === 'buy' ? H.buyers : tab === 'sell' ? H.sellers : tab === 'major' ? H.top.filter((r) => instOf(r.name)?.[2]) : H.top.slice(0, 12);
    if (tab === 'major' && !rows.length) rows = [];
    const shareOf = (r) => (H.sharesOut && r.shares != null ? r.shares / H.sharesOut : null);
    const inc = H.increased, dec = H.decreased;
    const chgTxt = (r) => (r.isNew ? '<span class="h-new">신규</span>' : r.soldOut ? '<span class="h-out">전량 매도</span>'
      : r.chg == null ? '–' : `<span class="${cls(r.chg)}">${r.chg > 0 ? '+' : ''}${unit(r.chg)}주</span>${r.chgPct != null ? `<small class="${cls(r.chgPct)}">${pct(r.chgPct, 1)}</small>` : ''}`);
    const list = rows.map((r, i) => {
      const inst = instOf(r.name);
      const old = r.date && latest && r.date < latest;
      // 순위: 상위 보유·주요 금융사는 전체 보유 금액 순위, 많이 산/판 곳은 그 목록 안의 순위
      const rank = tab === 'top' || tab === 'major' ? H.top.indexOf(r) + 1 : i + 1;
      return `<li><span class="h-rank${rank <= 3 ? ' top3' : ''}" aria-label="${rank}위">${rank}</span><div class="h-name"><b>${esc(inst ? inst[1] : titleCase(r.name))}</b><small>${inst ? esc(titleCase(r.name)) + ' · ' : ''}${r.date ? `<span class="nw">${md(isoToTs(r.date))} 기준${old ? ' <i class="h-old">지난 분기</i>' : ''}</span>` : ''}</small></div>
        <div class="h-sh"><b>${r.soldOut ? '0주' : unit(r.shares) + '주'}</b><small>${shareOf(r) != null && !r.soldOut ? '지분 ' + pctPlain(shareOf(r), 2) : r.value != null ? usd(r.value) : ''}</small>${r.est != null ? `<small class="h-est" title="추정 평단(대략)">평단≈${price(r.est)}</small>` : ''}</div>
        <div class="h-chg">${chgTxt(r)}</div></li>`;
    }).join('');
    // 다음 13F 마감: 분기 말 + 45일
    const qEnd = latest ? new Date(latest + 'T00:00:00') : null;
    const nextQ = qEnd ? new Date(qEnd.getFullYear(), qEnd.getMonth() + 4, 0) : null;
    const nextDue = nextQ ? new Date(nextQ.getTime() + 45 * 86400000) : null;
    const flow = inc && dec ? (inc.shares || 0) - (dec.shares || 0) : null;
    // 기관 추정 평단(13F에는 매입가가 없어 분기별 평균 거래가로 근사) vs 지금 주가
    const E = H.est, nowPx = state.quote?.[sym]?.price ?? E?.last;
    const vsNow = (v) => (v && nowPx ? `<b class="${cls(nowPx - v)}">${pct(nowPx / v - 1, 1)}</b>` : '');
    const qName = (q) => { const m = +q.to.slice(5, 7); return EN ? `Q${Math.ceil(m / 3)} ${q.to.slice(0, 4)}` : `${q.to.slice(2, 4)}년 ${Math.ceil(m / 3)}분기(${+q.from.slice(5, 7)}~${m}월)`; };
    const estHtml = E ? `<div class="h-est-box">
        ${E.q?.vwap ? `<div><span>${EN ? 'Avg price institutions paid last quarter' : '최근 분기 기관 매입 평균가'} <small>${esc(qName(E.q))} · ${EN ? `${unit(E.q.added)} sh newly bought or added` : `새로 사거나 늘린 ${unit(E.q.added)}주`}</small></span><b>≈ ${price(E.q.vwap)}</b><em>${EN ? 'vs. current price' : '지금 주가 대비'} ${vsNow(E.q.vwap)}</em></div>` : ''}
        <div><span>${EN ? `Est. avg cost, top ${E.holders}` : `상위 ${E.holders}곳 추정 평단`} <small>${EN ? 'share-weighted · assumes bought within the past year' : '보유 주식 가중 평균 · 최근 1년 매입 가정'}</small></span><b>≈ ${price(E.avg)}</b><em>${EN ? 'vs. current price' : '지금 주가 대비'} ${vsNow(E.avg)}</em></div>
        <p class="note h-est-note">${EN ? 'Institutions don’t disclose what they paid. This is a <b>rough</b> estimate: shares added each quarter × that quarter’s average price. Pre-IPO investors and long-time holders likely paid much less.'  : '기관이 실제로 얼마에 샀는지는 공개되지 않아요. 분기마다 늘린 주식 수 × 그 분기 평균 거래가로 <b>대략</b> 계산한 값이에요. 상장 전부터 투자한 회사·벤처캐피털이나 몇 년째 들고 있는 기관은 실제 평단이 훨씬 낮을 수 있어요.'}</p>
      </div>` : '';
    card(id, {
      title, sub: `${S.short} · 13F 신고 기준 · Nasdaq · ${latest ? md(isoToTs(latest)) + ' 분기 말' : ''}`, info: INFO.holders,
      body: `<div class="ns-grid h-grid">
          <div><span>기관 보유 비율</span><b>${pctPlain(H.ownershipPct)}</b><small>${EN ? `of ${unit(H.sharesOut)} shares outstanding` : `발행 주식 ${unit(H.sharesOut)}주 중`}</small></div>
          <div><span>보유 기관 수</span><b>${H.holders != null ? nf(0).format(H.holders) + '곳' : '–'}</b><small>보유 ${unit(H.totalShares?.shares)}주 · ${usd(H.totalValue)}</small></div>
          <div><span>직전 13F 대비 늘린 곳</span><b class="up">${inc ? nf(0).format(inc.holders) + '곳' : '–'}</b><small>+${unit(inc?.shares)}주${H.newPos ? ` · 신규 ${nf(0).format(H.newPos.holders)}곳` : ''}</small></div>
          <div><span>줄인 곳</span><b class="down">${dec ? nf(0).format(dec.holders) + '곳' : '–'}</b><small>-${unit(dec?.shares)}주${H.soldOut ? ` · 전량 매도 ${nf(0).format(H.soldOut.holders)}곳` : ''}</small></div>
        </div>
        ${flow != null ? `<div class="h-flow"><span>기관 순매수(직전 분기 대비)</span><b class="${cls(flow)}">${flow > 0 ? '+' : ''}${unit(flow)}주</b></div>` : ''}
        ${estHtml}
        ${more(id + ':more', `기관별 보유 목록 ${H.top.length}곳 보기`)}
        <div class="nf h-tabs" role="group" aria-label="기관 목록 보기">${HOLD_TABS.map(([k, l]) => `<button type="button" data-htab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
        <ul class="h-list">${list || '<li class="empty">해당하는 기관이 없어요.</li>'}</ul>
        <p class="note">13F는 운용자산 1억 달러 이상 기관이 분기가 끝나고 45일 안에 내는 보유 보고서라 <b>최대 4개월 전 기준</b>이에요. 공매도·옵션 포지션은 빠져 있고, 일부 기관은 신고가 늦어 이전 분기 값이 보여요(지난 분기 표시).${nextDue ? ` 다음 신고 마감: ${nextDue.getMonth() + 1}/${nextDue.getDate()}경(${nextQ.getMonth() + 1}/${nextQ.getDate()} 기준).` : ''}</p></details>`,
    });
  }

  // ---------------------------------------------------------------- 시장 개요 · 장 상태
  // 미국 동부 시각으로 장전(04:00)·정규장(09:30)·장후(16:00~20:00) 판단(공휴일은 구분 못 함)
  function marketSession(ms = Date.now()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(ms).map((x) => [x.type, x.value]));
    const mins = (+p.hour % 24) * 60 + +p.minute;
    const left = (to) => { const m = to - mins; return m >= 60 ? (EN ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}시간 ${m % 60}분`) : (EN ? `${m}m` : `${m}분`); };
    if (EN) {
      if (p.weekday === 'Sat' || p.weekday === 'Sun') return { k: 'closed', label: 'Weekend — closed', next: 'Trading resumes Monday pre-market' };
      if (mins < 240) return { k: 'closed', label: 'Closed', next: `Pre-market in ${left(240)}` };
      if (mins < 570) return { k: 'pre', label: 'Pre-market', next: `Opens in ${left(570)}` };
      if (mins < 960) return { k: 'open', label: 'Market open', next: `Closes in ${left(960)}` };
      if (mins < 1200) return { k: 'post', label: 'After-hours', next: `After-hours ends in ${left(1200)}` };
      return { k: 'closed', label: 'Closed', next: p.weekday === 'Fri' ? 'Trading resumes Monday pre-market' : `Pre-market in ${left(240 + 1440)}` };
    }
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return { k: 'closed', label: '주말 휴장', next: '월요일 장전부터 다시 거래' };
    if (mins < 240) return { k: 'closed', label: '장 마감', next: `장전 시작까지 ${left(240)}` };
    if (mins < 570) return { k: 'pre', label: '장전 거래 중', next: `정규장 개장까지 ${left(570)}` };
    if (mins < 960) return { k: 'open', label: '정규장 거래 중', next: `마감까지 ${left(960)}` };
    if (mins < 1200) return { k: 'post', label: '장후 거래 중', next: `장후 종료까지 ${left(1200)}` };
    return { k: 'closed', label: '장 마감', next: p.weekday === 'Fri' ? '월요일 장전부터 다시 거래' : `장전 시작까지 ${left(240 + 1440)}` };
  }
  const MK_SHORT = { '^GSPC': 'S&P500', '^IXIC': '나스닥', '^DJI': '다우', '^RUT': '러셀', '^VIX': 'VIX', '^TNX': '10년물', 'DX-Y.NYB': '달러', 'BTC-USD': 'BTC' };
  const MK_KR = ['^KS11', '^KQ11', 'KRW=X', 'EWY'];
  const MK_KR_SHORT = { '^KS11': '코스피', '^KQ11': '코스닥', 'KRW=X': '원·달러', EWY: 'EWY' };
  // 한국 장: 서울 시각 기준 NXT 프리마켓 08:00~08:50 · 정규장 09:00~15:30 · 애프터마켓 15:30~20:00 (공휴일은 구분 못 함)
  function krSession(ms = Date.now()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(ms).map((x) => [x.type, x.value]));
    const mins = (+p.hour % 24) * 60 + +p.minute;
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return { k: 'closed', label: '주말 휴장' };
    if (mins >= 480 && mins < 540) return { k: 'pre', label: '장전 거래' };
    if (mins >= 540 && mins < 930) return { k: 'open', label: '정규장 거래 중' };
    if (mins >= 930 && mins < 1200) return { k: 'post', label: '시간외 거래' };
    return { k: 'closed', label: '장 마감' };
  }
  const MK_MAIN = ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', '^TNX', 'DX-Y.NYB', 'BTC-USD'];
  const mkVal = (x) => (x.price == null ? '–' : x.sym === 'KRW=X' ? wonPx(x.price) : x.sym === 'EWY' ? '$' + x.price.toFixed(2) : x.sym === '^TNX' ? x.price.toFixed(2) + '%' : x.sym === 'BTC-USD' ? '$' + nf(0).format(x.price) : nf(x.price >= 1000 ? 0 : 2).format(x.price));
  function sparkSvg(arr, up) {
    if (!arr || arr.length < 2) return '';
    const mn = Math.min(...arr), mx = Math.max(...arr), w = 60, h = 18;
    const p = arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - (mx > mn ? (v - mn) / (mx - mn) : 0.5) * h).toFixed(1)}`).join(' ');
    return `<svg class="mk-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${p}" fill="none" stroke="${up ? C.up : C.down}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function renderMarket() {
    if (!document.getElementById('c-market')) return;
    const M = state.market, S = marketSession(), by = Object.fromEntries((M?.items || []).map((x) => [x.sym, x]));
    const tiles = MK_MAIN.map((sym) => by[sym]).filter((x) => x && !x.error).map((x) => `<button type="button" class="mk-t" data-mkgo="${esc(x.sym)}" title="${esc(x.name)}"><span>${esc(MK_SHORT[x.sym] || x.name)}</span><b>${mkVal(x)}</b><em class="${cls(x.pct)}">${pct(x.pct, 2)}</em>${sparkSvg(x.spark, (x.pct || 0) >= 0)}</button>`).join('');
    const fut = ['ES=F', 'NQ=F'].map((s) => by[s]).filter((x) => x && !x.error && x.pct != null);
    let K = krSession();
    const kst = by['^KS11']?.status; // 네이버 장 상태 — 시각상 정규장인데 닫혀 있으면 휴장일(공휴일)
    const kday = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10), kt = by['^KS11']?.time;
    if ((K.k === 'open' && kst && kst !== 'OPEN') || (K.k === 'post' && kt && kday(kt) !== kday(Date.now()))) K = { k: 'closed', label: '오늘 휴장' };
    const krTiles = MK_KR.map((sym) => by[sym]).filter((x) => x && !x.error).map((x) => `<button type="button" class="mk-t" data-mkgo="${esc(x.sym)}" title="${esc(x.name)}"><span>${esc(MK_KR_SHORT[x.sym] || x.name)}</span><b>${mkVal(x)}</b><em class="${cls(x.pct)}">${pct(x.pct, 2)}</em>${sparkSvg(x.spark, (x.pct || 0) >= 0)}</button>`).join('');
    const ewy = by.EWY;
    card('market', {
      title: '시장 개요', sub: `<span class="mk-st ${S.k}">${S.label}</span> ${S.next} <span class="mk-hint">· ${EN ? 'tap for chart' : '누르면 차트'}</span>`, info: INFO.market,
      body: M ? `<div class="mk-grid">${tiles}</div>${fut.length && S.k !== 'open' ? `<p class="mk-fut">지수 선물 ${fut.map((x) => `${esc(x.name.replace(' 선물', ''))} <b class="${cls(x.pct)}">${pct(x.pct, 2)}</b>`).join(' · ')} <small>(장외 시간의 분위기)</small></p>` : ''}
        ${krTiles ? `<div class="mk-sec"><b>🇰🇷 한국</b><span class="mk-st ${K.k}">${K.label}</span></div><div class="mk-grid">${krTiles}</div>${K.k !== 'open' && ewy && !ewy.error && ewy.pct != null ? `<p class="mk-fut">EWY <b class="${cls(ewy.pct)}">${pct(ewy.pct, 2)}</b> <small>미국장에서 거래되는 한국 ETF — 밤사이 한국 증시 분위기(야간선물 대신 참고)</small></p>` : ''}` : ''}` : '<p class="skeleton">불러오는 중…</p>',
    });
  }


  // ---------------------------------------------------------------- 📈 지수·환율 차트(시장 개요 칸을 누르면): 기간별 차트 · 기간 등락 · 52주 범위 · 쉬운 설명
  const MK_ABOUT = {
    '^GSPC': ['S&P500', '미국 대형주 500개를 시가총액만큼 담은 지수예요. 미국 증시 전체 흐름을 볼 때 가장 많이 써요.', 'The 500 largest US companies, weighted by size — the go-to gauge of the US market.'],
    '^IXIC': ['나스닥 종합', '나스닥 거래소에 상장된 기업 전체 지수예요. 애플·엔비디아 같은 기술주 비중이 커요.', 'Every Nasdaq-listed company — heavy in tech like Apple and Nvidia.'],
    '^DJI': ['다우존스', '미국을 대표하는 우량 대기업 30개 지수예요. 주가가 높은 종목일수록 비중이 커요.', '30 blue-chip US companies, weighted by share price.'],
    '^RUT': ['러셀2000', '미국 중소형주 2,000개 지수예요. 금리·경기에 민감해서 위험 선호를 볼 때 써요.', '2,000 smaller US companies — sensitive to rates and the economy.'],
    '^VIX': ['VIX(공포지수)', 'S&P500 옵션으로 계산한 앞으로 30일 변동성 예상치예요. 20 아래면 차분, 30 위면 불안한 시장이에요.', 'Expected 30-day S&P 500 volatility. Below 20 is calm; above 30 is fearful.'],
    '^TNX': ['미국 10년물 국채 금리', '미국 정부가 10년 동안 돈을 빌릴 때 내는 이자율이에요. 오르면 성장주·부동산에 부담이 돼요.', 'The 10-year US Treasury yield. Rising yields weigh on growth stocks.'],
    'DX-Y.NYB': ['달러 인덱스', '유로·엔·파운드 등 주요 6개 통화 대비 달러 가치예요. 오르면 달러가 강해진 거예요.', 'The dollar against six major currencies. Up means a stronger dollar.'],
    'BTC-USD': ['비트코인', '대표 암호화폐예요. 24시간 거래되고, 위험자산 분위기를 빨리 보여줘요.', 'The largest cryptocurrency, trading 24/7 — a quick read on risk appetite.'],
    '^KS11': ['코스피', '유가증권시장에 상장된 한국 기업 전체 지수예요. 삼성전자·SK하이닉스 비중이 커요.', 'All KOSPI-listed Korean companies — Samsung and SK hynix weigh heavily.'],
    '^KQ11': ['코스닥', '코스닥 시장 전체 지수예요. 바이오·2차전지·IT 중소형주가 많아요.', 'Korea’s KOSDAQ market — biotech, batteries and smaller tech.'],
    'KRW=X': ['원·달러 환율', '1달러를 사는 데 필요한 원화예요. 오르면(원화 약세) 미국 주식의 원화 평가금액이 늘어요.', 'Won per dollar. Up (weaker won) lifts the won value of US stocks.'],
    EWY: ['EWY', '미국 증시에 상장된 한국 주식 ETF예요. 한국 장이 닫힌 밤에 한국 증시 분위기를 미리 볼 수 있어요.', 'A US-listed ETF of Korean stocks — a read on Korea while its market is closed.'],
  };
  const MK_RANGES = { '1d': '1일', '1w': '1주', '1m': '1개월', '3m': '3개월', '1y': '1년', '5y': '5년' };
  state.mkc = {};
  state.mkSym = loadPref('mksym', '^GSPC'); state.mkRange = loadPref('mkrange', '1m');
  const mkFmt = (sym, v) => (v == null ? '–' : sym === 'KRW=X' ? `${nf(1).format(v)}${EN ? '' : '원'}` : sym === '^TNX' ? v.toFixed(2) + '%' : sym === 'EWY' ? '$' + v.toFixed(2) : sym === 'BTC-USD' ? '$' + nf(0).format(v) : nf(v >= 1000 ? 0 : 2).format(v));
  function mkSlice(points, r) {
    if (!points?.length) return [];
    if (r === '5y') { // 5년은 월봉으로 묶는다(주봉 260개는 너무 가늘다)
      const M = new Map();
      for (const p of points) { const d = new Date(p[0]), k = d.getFullYear() * 12 + d.getMonth(), m = M.get(k); if (!m) M.set(k, [p[0], p[1], p[2] ?? p[1], p[3] ?? p[1], p[4] ?? p[1], p[5] || 0]); else { m[1] = p[1]; m[3] = Math.max(m[3], p[3] ?? p[1]); m[4] = Math.min(m[4], p[4] ?? p[1]); m[5] += p[5] || 0; } }
      return [...M.values()];
    }
    if (r === '1d') { // 마지막 거래 구간: 3시간 넘게 비는 곳에서 끊는다(24시간 거래는 최근 24시간)
      const last = points.at(-1)[0]; let i = points.length - 1;
      while (i > 0 && points[i][0] - points[i - 1][0] < 3 * 3600e3 && last - points[i - 1][0] <= 24 * 3600e3) i--;
      return splitView(points, points.length - i);
    }
    const days = { '1w': 7, '1m': 31, '3m': 92, '1y': 366 }[r], from = points.findIndex((p) => p[0] >= points.at(-1)[0] - days * 86400000);
    return splitView(points, points.length - Math.max(0, from)); // 앞쪽은 이동평균 계산용(pts.pre)
  }
  function renderMkChart() {
    if (!document.getElementById('c-mkchart')) return;
    const all = [...MK_MAIN, ...MK_KR], sym = all.includes(state.mkSym) ? state.mkSym : '^GSPC', r = MK_RANGES[state.mkRange] ? state.mkRange : '1m';
    const srv = r === '5y' ? '1y' : r, key = sym + '|' + srv, C0 = state.mkc[key], M = (state.market?.items || []).find((x) => x.sym === sym);
    if (!C0) {
      state.mkc[key] = { loading: true };
      getJ(`${NEWS_API}/chart?s=${encodeURIComponent(sym)}&r=${srv}`, 15000).then((j) => { state.mkc[key] = j.error ? { error: true } : j; }).catch(() => { state.mkc[key] = { error: true }; }).finally(() => { if (state.view === 'mkt') renderMkChart(); });
    }
    const A = MK_ABOUT[sym] || [sym, '', ''], P = C0?.points ? mkSlice(C0.points, r) : [], first = P[0]?.[1], last = P.at(-1)?.[1];
    const chg = first && last ? last / first - 1 : null, hi = P.length ? Math.max(...P.map((p) => p[3] ?? p[1])) : null, lo = P.length ? Math.min(...P.map((p) => p[4] ?? p[1])) : null;
    const nm = (x) => MK_SHORT[x] || MK_KR_SHORT[x] || x;
    card('mkchart', {
      title: `📈 ${EN ? A[0].replace('코스피', 'KOSPI').replace('코스닥', 'KOSDAQ') : A[0]}`, sub: EN ? 'Yahoo Finance · may be delayed ~15 min' : 'Yahoo Finance · 15분 정도 늦을 수 있어요',
      body: `<button type="button" class="mkc-back" data-mkback="1">← ${EN ? 'Back to market overview' : '시장 개요로 돌아가기'}</button><div class="mkc-pick" role="tablist">${all.map((x) => `<button type="button" class="chip-btn sm" data-mkgo="${esc(x)}" aria-pressed="${x === sym}">${esc(nm(x))}</button>`).join('')}</div>
        <div class="mkc-head"><b>${M ? mkVal(M) : mkFmt(sym, last)}</b>${M?.pct != null ? `<em class="${cls(M.pct)}">${pct(M.pct, 2)} ${EN ? 'today' : '오늘'}</em>` : ''}</div>
        <div class="seg range mkc-rg" role="group">${Object.entries(MK_RANGES).map(([k, l]) => `<button type="button" data-mkrange="${k}" aria-pressed="${k === r}">${EN ? { '1d': '1D', '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', '5y': '5Y' }[k] : l}</button>`).join('')}</div>
        ${P.length ? chartTools('mkchart') : ''}<div class="chart mkc-chart">${C0?.error ? `<p class="note">${EN ? 'Couldn’t load the chart. Try again later.' : '차트를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'}</p>` : P.length ? '<canvas id="cv-mkchart" role="img"></canvas>' : `<p class="skeleton">${EN ? 'Loading…' : '불러오는 중…'}</p>`}</div>
        ${P.length ? `<div class="mkc-stats"><div><span>${EN ? `${r.toUpperCase()} change` : `${MK_RANGES[r]} 변화`}</span><b class="${cls(chg)}">${pct(chg, 2)}</b></div><div><span>${EN ? 'High' : '기간 최고'}</span><b>${mkFmt(sym, hi)}</b></div><div><span>${EN ? 'Low' : '기간 최저'}</span><b>${mkFmt(sym, lo)}</b></div>${C0.high52 && C0.low52 ? `<div><span>${EN ? '52-week range' : '52주 범위'}</span><b>${mkFmt(sym, C0.low52)} ~ ${mkFmt(sym, C0.high52)}</b></div>` : ''}</div>` : ''}
        <p class="mkc-about">${esc(EN ? A[2] : A[1])}</p>`,
    });
    document.querySelector('.mkc-pick [aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (P.length) {
      const intra = r === '1d' || r === '1w', d2 = (n) => String(n).padStart(2, '0');
      const xf = r === '1d' ? hm : r === '5y' || r === '1y' ? (t) => { const x = new Date(t); return `${String(x.getFullYear()).slice(2)}.${x.getMonth() + 1}`; } : mdLocal;
      const tip = (it) => { const x = new Date(P[it.dataIndex][0]); return `${x.getFullYear()}.${x.getMonth() + 1}${r === '5y' ? '' : `.${x.getDate()}`}${intra ? ` ${d2(x.getHours())}:${d2(x.getMinutes())}` : ''}`; };
      drawCandles('mkchart', P, { xf, tip, ind: true, fmt: (v) => mkFmt(sym, v) });
    }
  }

  // ---------------------------------------------------------------- 공포·탐욕 지수 (주식: CNN · 코인: alternative.me)
  const FG_RATE = { 'extreme fear': '극단적 공포', fear: '공포', neutral: '중립', greed: '탐욕', 'extreme greed': '극단적 탐욕' };
  const fgCls = (v) => (v == null ? '' : v < 25 ? 'fg-xf' : v < 45 ? 'fg-f' : v <= 55 ? 'fg-n' : v <= 75 ? 'fg-g' : 'fg-xg');
  const FG_EN = { 'extreme fear': 'Extreme fear', fear: 'Fear', neutral: 'Neutral', greed: 'Greed', 'extreme greed': 'Extreme greed' };
  const fgRate = (r, v) => { const k = String(r || '').toLowerCase() || (v == null ? '' : v < 25 ? 'extreme fear' : v < 45 ? 'fear' : v <= 55 ? 'neutral' : v <= 75 ? 'greed' : 'extreme greed'); return (EN ? FG_EN : FG_RATE)[k] || '–'; };
  // CNN 7개 지표: 이름 · 쉬운 설명 · 원래 값 표시
  const FG_IND = [
    ['market_momentum_sp500', '시장 모멘텀', 'S&P500이 최근 125일 평균보다 얼마나 위에 있나', (y, R) => `S&P500 ${nf(0).format(y)}${R.sp125 ? ` · 125일 평균 ${nf(0).format(R.sp125)}` : ''}`],
    ['stock_price_strength', '주가 강도', '52주 신고가 종목 수 − 신저가 종목 수(뉴욕증시)', (y) => `순 신고가 ${y > 0 ? '+' : ''}${y.toFixed(1)}%`],
    ['stock_price_breadth', '시장 폭', '오르는 종목 거래량 − 내리는 종목 거래량(맥클렐런 지수)', (y) => nf(0).format(y)],
    ['put_call_options', '풋/콜 비율', '하락에 거는 옵션(풋) ÷ 상승에 거는 옵션(콜), 5일 평균 — 높을수록 하락에 대비하는 사람이 많다는 뜻(공포)', (y) => y.toFixed(2)],
    ['market_volatility_vix', '변동성(VIX)', 'VIX가 50일 평균보다 높을수록 시장이 불안해하는 상태(공포)', (y, R) => `VIX ${y.toFixed(1)}${R.vix50 ? ` · 50일 평균 ${R.vix50.toFixed(1)}` : ''}`],
    ['safe_haven_demand', '안전자산 선호', '최근 20일 주식 수익률 − 국채 수익률 — 낮을수록 주식을 팔고 국채로 피신하는 중(공포)', (y) => `${y > 0 ? '+' : ''}${y.toFixed(2)}%p`],
    ['junk_bond_demand', '정크본드 수요', '위험 회사채와 우량 회사채의 금리 차 — 차이가 벌어질수록 위험을 피하는 분위기(공포)', (y) => `금리 차 ${y.toFixed(2)}%p`],
  ];
  function fgGauge(v, label) {
    // 반원 게이지(0 왼쪽 → 100 오른쪽) + 바늘
    const a = Math.PI * (1 - Math.max(0, Math.min(100, v ?? 50)) / 100), cx = 60, cy = 58, r = 46;
    const seg = (from, to, c) => { const p = (t) => [cx + r * Math.cos(Math.PI * (1 - t / 100)), cy - r * Math.sin(Math.PI * (1 - t / 100))]; const [x1, y1] = p(from), [x2, y2] = p(to); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" class="${c}"/>`; };
    return `<svg class="fg-gauge" viewBox="0 0 120 66" role="img" aria-label="${esc(label)} ${v ?? '–'}">
      <g class="fg-arc">${seg(0, 24.5, 'fg-xf')}${seg(25.5, 44.5, 'fg-f')}${seg(45.5, 54.5, 'fg-n')}${seg(55.5, 74.5, 'fg-g')}${seg(75.5, 100, 'fg-xg')}</g>
      ${v == null ? '' : `<line x1="${cx}" y1="${cy}" x2="${(cx + (r - 10) * Math.cos(a)).toFixed(1)}" y2="${(cy - (r - 10) * Math.sin(a)).toFixed(1)}" class="fg-needle"/><circle cx="${cx}" cy="${cy}" r="3.5" class="fg-hub"/>`}</svg>`;
  }
  function fgSpark(hist) {
    if (!hist?.length) return '';
    const W = 120, H = 26, n = hist.length, x = (i) => (i / Math.max(1, n - 1)) * W, y = (v) => H - (v / 100) * H;
    return `<svg class="fg-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="fg-mid"/><polyline points="${hist.map((p, i) => `${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/></svg>`;
  }
  function renderFearGreed() {
    if (!document.getElementById('c-feargreed')) return;
    const G = state.fg, C = G?.cnn, K = G?.crypto;
    if (!G) { card('feargreed', { title: '공포·탐욕 지수', info: INFO.feargreed, body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const ch = (now, was) => (now == null || was == null ? '' : `<em class="${cls(now - was)}">${now - was > 0 ? '+' : ''}${Math.round(now - was)}</em>`);
    const side = (X, name, src, rows, span) => X ? `<div class="fg-side">
        <div class="fg-h"><b>${name}</b><small>${src}</small></div>
        ${fgGauge(X.score, name)}
        <div class="fg-score ${fgCls(X.score)}"><b>${Math.round(X.score)}</b><span>${fgRate(X.rating, X.score)}</span></div>
        <ul class="fg-prev">${rows.filter(([, v]) => v != null).map(([k, v]) => `<li><span>${k}</span><b class="${fgCls(v)}">${Math.round(v)}</b>${ch(X.score, v)}</li>`).join('')}</ul>
        ${fgSpark(X.hist)}<small class="fg-span">${span}</small>
      </div>` : `<div class="fg-side"><div class="fg-h"><b>${name}</b><small>${src}</small></div><p class="adm-dim">지금은 불러오지 못했어요.</p></div>`;
    const ind = C?.ind ? FG_IND.filter(([k]) => C.ind[k]).map(([k, name, desc, fmt]) => {
      const I = C.ind[k];
      return `<li><div class="fg-in"><b>${name}</b><small>${desc}</small></div>
        <div class="fg-iv"><span class="fg-bar"><i class="${fgCls(I.score)}" style="width:${Math.max(3, I.score)}%"></i></span><b class="${fgCls(I.score)}">${fgRate(I.rating, I.score)}</b><small>${I.y != null ? esc(fmt(I.y, C.ref || {})) : ''}</small></div></li>`;
    }).join('') : '';
    card('feargreed', {
      title: '공포·탐욕 지수', sub: `${EN ? 'Stocks: CNN · Crypto: alternative.me' : '주식 CNN · 코인 alternative.me'}${C?.t ? `<span class="sub-when">${md(Date.parse(C.t) / 1000)} ${new Date(C.t).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })}${EN ? '' : ' 기준'}</span>` : ''}`, info: INFO.feargreed,
      easy: `시장 사람들의 '기분 온도계'예요. 0에 가까울수록 겁을 먹고 파는 분위기(공포), 100에 가까울수록 들떠서 사는 분위기(탐욕)예요. "남들이 겁낼 때 사라"는 말처럼 반대로 활용하는 사람도 많아요.`,
      body: `
        <div class="fg-two">
          ${side(C, '미국 주식', 'CNN Fear & Greed', [['전일', C?.prev?.close], ['1주 전', C?.prev?.w1], ['1개월 전', C?.prev?.m1], ['1년 전', C?.prev?.y1]], '최근 1년')}
          ${side(K, '코인', 'Crypto Fear & Greed', [['어제', K?.prev?.d1], ['1주 전', K?.prev?.w1], ['1개월 전', K?.prev?.m1]], '최근 30일')}
        </div>
        ${ind ? `${more('feargreed:ind', 'CNN 세부 지표 7개 보기')}<ul class="fg-ind">${ind}</ul><p class="note">CNN 지수는 이 7개 지표를 각각 0~100점으로 바꿔 평균한 값이에요. 막대가 왼쪽일수록 공포, 오른쪽일수록 탐욕. 지표마다 갱신 시각이 달라요(장 마감 기준).</p></details>` : ''}`,
    });
  }

  // ---------------------------------------------------------------- 키워드 속보 (News 탭)
  const KW_KEY = 'cw.kw';
  state.kw = readJSON(KW_KEY, null) || (EN ? ['FOMC', 'CPI', 'rate cut', 'tariff', 'stablecoin', 'FAA', 'Starship', 'earnings'] : ['FOMC', 'CPI', '금리', '관세', 'stablecoin', '스테이블코인', 'FAA', 'Starship']);
  let kwNotified = new Set(readJSON('cw.kwNoti', [])), kwBoot = true;
  function kwItems() {
    const kws = state.kw.filter(Boolean);
    if (!kws.length) return [];
    const pool = [];
    for (const n of state.mnews?.items || []) pool.push({ t: Date.parse(n.t), title: n.title, sum: n.sum || '', source: n.source, url: n.url, tag: '시장' });
    for (const sym of WATCH) { if (!NEWS_UI[sym]) continue; for (const i of newsItems(sym)) if (i.kind !== 'filing') pool.push({ t: i.t, title: i.title, sum: i.sum || '', source: i.source, url: i.url, tag: sym }); }
    const cutoff = Date.now() - 48 * 3600000, seenT = new Set(), out = [];
    for (const n of pool.sort((a, b) => b.t - a.t)) {
      if (!(n.t >= cutoff)) continue;
      const key = n.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 50);
      if (seenT.has(key)) continue;
      const text = `${n.title} ${n.sum}`.toLowerCase();
      const hit = kws.filter((w) => text.includes(w.toLowerCase()));
      if (!hit.length) continue;
      seenT.add(key);
      out.push({ ...n, hit, key });
    }
    return out.slice(0, 25);
  }
  const hl = (s) => esc(s); // 키워드 형광 표시는 하지 않는다(사용자 요청)
  function renderKwNews() {
    const items = kwItems(), kws = state.kw;
    for (const id of ['kwnews', 'skwnews']) {
      if (!document.getElementById('c-' + id)) continue;
      card(id, {
        title: '키워드 속보', sub: '시장 전체·내 종목 뉴스 중 등록한 단어가 들어간 기사 · 최근 48시간', info: INFO.kw,
        body: `<div class="kw-chips">${kws.map((w) => `<span class="kw-chip">${esc(w)}<button type="button" data-kwdel="${esc(w)}" aria-label="${esc(w)} 삭제">×</button></span>`).join('')}
            <form class="kw-add" data-kwform="1"><input name="kw" maxlength="30" placeholder="+ 키워드 추가" aria-label="키워드 추가" autocomplete="off"></form></div>
          <ul class="nl kw-list">${items.map((i, n) => `${n === 5 ? `</ul>${more(id + ':more', `키워드 기사 ${items.length - 5}건 더 보기`)}<ul class="nl kw-list">` : ''}<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener"><span class="nk ${i.tag === '시장' ? 'industry' : 'related'}">${esc(i.tag)}</span>
            <span class="nt">${hl(i.title, i.hit)}</span>${i.sum ? `<span class="nsum">${hl(i.sum, i.hit)}</span>` : ''}<span class="nm">${esc(i.source)} · ${dayLabel(i.t)} ${timeLabel(i)}</span></a></li>`).join('') || '<li class="empty">최근 48시간 동안 키워드가 들어간 기사가 없어요.</li>'}</ul>${items.length > 5 ? '</details>' : ''}`,
      });
    }
    // 화면을 보는 중 새 키워드 기사가 들어오면 알림 띠(처음 불러올 때는 알리지 않음)
    const fresh = items.filter((i) => !kwNotified.has(i.key) && Date.now() - i.t < 3 * 3600000);
    if (!kwBoot && fresh.length) newsAlert(fresh[0], fresh.length - 1);
    for (const i of items) kwNotified.add(i.key);
    kwNotified = new Set([...kwNotified].slice(-300));
    writeJSON('cw.kwNoti', [...kwNotified]);
    if (state.mnews) kwBoot = false;
  }
  // 속보 알림 카드: 헤더 아래로 내려와 10초 뒤 사라짐(누르면 기사, × 닫기, 여러 건이면 키워드 속보로 이동)
  let naTimer = null;
  function closeNewsAlert() { const el = document.getElementById('news-alert'); if (!el) return; el.classList.remove('show'); clearTimeout(naTimer); setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 300); }
  function newsAlert(i, more = 0) {
    let el = document.getElementById('news-alert');
    if (!el) { el = document.createElement('div'); el.id = 'news-alert'; el.className = 'news-alert'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    const m = Math.max(0, Math.round((Date.now() - i.t) / 60000)), when = EN ? (m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`) : m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
    el.style.setProperty('--na-top', `${Math.round(document.querySelector('.top')?.getBoundingClientRect().bottom || 64)}px`);
    el.innerHTML = `<div class="na-top"><span class="na-badge">${EN ? '🔔 Breaking' : '🔔 속보'}</span><span class="na-kw">${esc(i.hit[0])}</span>${i.tag && i.tag !== '시장' ? `<span class="na-tag">${esc(symLabel(i.tag))}</span>` : ''}<span class="na-time">${when}</span><button type="button" class="na-x" data-naclose="1" aria-label="알림 닫기">×</button></div>
      <a class="na-body" href="${safeUrl(i.url)}" target="_blank" rel="noopener" data-naopen="1"><b class="na-title nt">${esc(i.title)}</b>${i.sum ? `<span class="na-sum nsum">${esc(i.sum)}</span>` : ''}<span class="na-src">${esc(i.source || '')} · ${EN ? 'Open article' : '기사 열기'} ›</span></a>
      ${more > 0 ? `<button type="button" class="na-more" data-nago="1">${EN ? `${more} more keyword ${more > 1 ? 'stories' : 'story'}` : `키워드 기사 ${more}건 더 보기`}</button>` : ''}<i class="na-bar"></i>`;
    el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    try { navigator.vibrate?.(20); } catch {}
    clearTimeout(naTimer); naTimer = setTimeout(closeNewsAlert, 10000);
  }
  function addKw(w) {
    w = String(w || '').trim().slice(0, 30);
    if (!w || state.kw.some((x) => x.toLowerCase() === w.toLowerCase())) return;
    state.kw = [...state.kw, w].slice(0, 20);
    writeJSON(KW_KEY, state.kw);
    renderKwNews();
  }
  function delKw(w) { state.kw = state.kw.filter((x) => x !== w); writeJSON(KW_KEY, state.kw); renderKwNews(); }

  // ---------------------------------------------------------------- 자세한 항목 접기·펼치기 (다시 그려도 펼친 상태 유지)
  state.openMore = new Set();
  const more = (key, label) => `<details class="more" data-more="${key}" ${state.openMore.has(key) ? 'open' : ''}><summary><span>${label}</span></summary>`;

  // ---------------------------------------------------------------- 애널리스트 의견 · 내부자 매매 (Nasdaq 집계)
  const curPrice = (sym) => stockPx(sym)?.price ?? state.quote?.[sym]?.price ?? null;
  const CONS_KO = { 'Strong Buy': '강력 매수', Buy: '매수', Outperform: '시장수익률 상회', Neutral: '보유(중립)', Hold: '보유(중립)', Underperform: '시장수익률 하회', Sell: '매도', 'Strong Sell': '강력 매도' };
  function analystView(sym) {
    const A = state.analyst?.[sym];
    let T = A?.target, src = 'Nasdaq';
    if (!T) { // 상장 직후(SPCX) 등: 증권사별 최근 의견으로 직접 계산
      const L = brokerLatest(sym), ts = L.map((b) => lastTarget(b.target)).filter((v) => v > 0);
      if (!ts.length) return null;
      const buy = L.filter((b) => BUY_RE.test(nowRating(b.rating))).length, sell = L.filter((b) => SELL_RE.test(nowRating(b.rating))).length;
      T = { mean: ts.reduce((a, b) => a + b, 0) / ts.length, low: Math.min(...ts), high: Math.max(...ts), buy, sell, hold: L.length - buy - sell };
      src = 'Finviz';
    }
    const n = T.buy + T.hold + T.sell, px0 = curPrice(sym);
    const score = n ? (T.buy - T.sell) / n : 0; // +1 전부 매수 · -1 전부 매도
    const label = score >= 0.4 ? '매수 우위' : score <= -0.2 ? '매도 우위' : '중립';
    return { A, T, n, src, px: px0, up: px0 ? T.mean / px0 - 1 : null, label, tone: score >= 0.4 ? 'pos' : score <= -0.2 ? 'neg' : 'neu', cons: src === 'Nasdaq' ? CONS_KO[A.history?.at(-1)?.consensus] || '' : '' };
  }
  function renderAnalyst(sym = state.stock, id = sym === 'CRCL' ? 'analyst' : 'sanalyst') {
    if (!document.getElementById('c-' + id)) return;
    const A = state.analyst?.[sym], V = analystView(sym), S = STOCK_INFO[sym];
    const title = '애널리스트 의견';
    if (!A) { card(id, { title, info: INFO.analyst, body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    if (!V) { card(id, { title, sub: `${S.short} · Nasdaq 집계`, info: INFO.analyst, body: `<p class="note" style="margin-top:12px">아직 애널리스트 목표가 집계가 없어요. 집계가 나오면 자동으로 보여요.</p>${brokersHtml(sym) ? `${more(id + ':more', '증권사별 의견 보기')}${brokersHtml(sym)}</details>` : ''}` }); return; }
    const { T, n, px: p0, up } = V;
    const w = (k) => (n ? (T[k] / n) * 100 : 0);
    const span = T.high - T.low || 1, at = (v) => Math.min(100, Math.max(0, ((v - T.low) / span) * 100));
    const H = (A.history || []).filter((h) => h.target);
    const first = H[0];
    card(id, {
      title, sub: `${S.short} · 증권사 ${n}곳 · ${V.src === 'Nasdaq' ? 'Nasdaq 집계' : '증권사별 최근 목표가로 계산'}${A.at ? ` · ${asOf(A.at)}` : ''}`, info: INFO.analyst,
      body: `<div class="an-head"><span class="tone ${V.tone}">${V.label}</span>${V.cons ? `<span class="an-cons">종합 의견 <b>${esc(V.cons)}</b></span>` : ''}</div>
        <div class="an-bar" role="img" aria-label="매수 ${T.buy} 보유 ${T.hold} 매도 ${T.sell}">
          ${T.buy ? `<i class="b" style="width:${w('buy')}%"><b>매수 ${T.buy}</b></i>` : ''}${T.hold ? `<i class="h" style="width:${w('hold')}%"><b>보유 ${T.hold}</b></i>` : ''}${T.sell ? `<i class="s" style="width:${w('sell')}%"><b>매도 ${T.sell}</b></i>` : ''}
        </div>
        <div class="ns-grid er-grid">
          <div><span>평균 목표가</span><b>${price(T.mean)}</b><small>${up != null ? `현재가 ${price(p0)} 대비 <span class="${cls(up)}">${pct(up, 1)}</span>` : ''}</small></div>
          <div><span>목표가 범위</span><b>${price(T.low)} ~ ${price(T.high)}</b><small>가장 낮은 곳 · 가장 높은 곳</small></div>
        </div>
        ${more(id + ':more', `목표가 범위·추이${brokerLatest(sym).length ? ` · 증권사별 의견 ${brokerLatest(sym).length}곳` : ''} 보기`)}
        <div class="an-range" aria-label="목표가 범위와 현재가">
          <div class="an-track"><i class="an-mean" style="left:${at(T.mean)}%" title="평균 목표가"></i>${p0 != null ? `<i class="an-now ${cls(up)}" style="left:${at(p0)}%" title="현재가"></i>` : ''}</div>
          <div class="an-lab"><span>${price(T.low)}</span><span>◆ 평균 · ● 현재가</span><span>${price(T.high)}</span></div>
        </div>
        ${H.length > 1 ? `<div class="mini-h er-h">평균 목표가 추이 (월별)</div><div class="chart short"><canvas id="cv-${id}" role="img" aria-label="평균 목표가 추이"></canvas></div>` : ''}
        <p class="note">증권사들이 낸 투자의견·12개월 목표주가의 집계예요(${V.src}). ${first && H.length > 1 ? `${md(isoToTs(first.d))} ${price(first.target)} → 지금 ${price(T.mean)}. ` : ''}목표가는 자주 늦게 바뀌고 증권사마다 차이가 커서 참고용이에요.</p>
        ${brokersHtml(sym)}</details>`,
    });
    if (H.length > 1) {
      const labels = H.map((h) => isoToTs(h.d));
      draw(id, {
        type: 'line',
        data: { labels, datasets: [lineDs('평균 목표가', H.map((h) => h.target), C.purple, { pointRadius: 2.5, borderWidth: 2, tension: 0.2 })] },
        options: {
          interaction,
          plugins: { ...noLegend, tooltip: { ...tooltip((it) => `${md(labels[it.dataIndex])} · 매수 ${H[it.dataIndex].buy} · 보유 ${H[it.dataIndex].hold} · 매도 ${H[it.dataIndex].sell}`, price) } },
          scales: { x: axisX(labels, md, 6), y: { ...axisY(price), beginAtZero: false, grace: '8%' } },
        },
      });
    }
  }

  // ---------------------------------------------------------------- 증권사별 의견 (Finviz)
  const BUY_RE = /buy|outperform|overweight|positive|accumulate|\badd\b/i, SELL_RE = /sell|underperform|underweight|negative|reduce/i;
  const RATING_KO = (r) => String(r || '').replace(/Strong Buy/gi, '강력 매수').replace(/\bBuy\b/gi, '매수').replace(/Outperform/gi, '시장 상회').replace(/Overweight/gi, '비중 확대')
    .replace(/Market Perform|Mkt Perform/gi, '시장 수익률').replace(/Sector Perform/gi, '업종 수익률').replace(/Equal-?Weight/gi, '비중 유지').replace(/Sector Weight/gi, '업종 비중').replace(/Sector Outperform/gi, '업종 상회').replace(/Sector Underperform/gi, '업종 하회').replace(/Speculative Buy/gi, '투기적 매수').replace(/Long-Term Buy/gi, '장기 매수').replace(/Peer Perform/gi, '동종 수익률')
    .replace(/Neutral/gi, '중립').replace(/\bHold\b/gi, '보유').replace(/Underperform/gi, '시장 하회').replace(/Underweight/gi, '비중 축소').replace(/Strong Sell/gi, '강력 매도').replace(/\bSell\b/gi, '매도')
    .replace(/Positive/gi, '긍정').replace(/Negative/gi, '부정');
  const ACTION_KO = { Initiated: ['신규', 'neu'], Upgrade: ['상향', 'pos'], Downgrade: ['하향', 'neg'], Reiterated: ['유지', 'neu'], Resumed: ['재개', 'neu'], 'Target Raised': ['목표↑', 'pos'], 'Target Lowered': ['목표↓', 'neg'], 'Target Set': ['목표가', 'neu'] };
  const lastTarget = (t) => { const m = String(t || '').match(/\$([\d,.]+)\s*$/); return m ? +m[1].replace(/,/g, '') : null; };
  const nowRating = (r) => String(r || '').split('→').pop().trim();
  // 증권사마다 가장 최근 의견 하나(1년 이내)
  function brokerLatest(sym) {
    const out = new Map();
    for (const b of state.analyst?.[sym]?.street?.brokers || []) if (!out.has(b.firm) && Date.now() - Date.parse(b.d) < 365 * 86400000) out.set(b.firm, b);
    return [...out.values()];
  }
  function brokersHtml(sym) {
    const all = state.analyst?.[sym]?.street?.brokers || [];
    if (!all.length) return '';
    const p0 = curPrice(sym), showAll = state.brokerAll === sym;
    const list = showAll ? all.slice(0, 30) : brokerLatest(sym).slice(0, 10);
    const rows = list.map((b) => {
      const [act, tone] = ACTION_KO[b.action] || [b.action, 'neu'];
      const tg = lastTarget(b.target), up = tg && p0 ? tg / p0 - 1 : null;
      return `<li><div class="h-name"><b>${esc(b.firm)}</b><small>${md(isoToTs(b.d))} · <span class="tone ${tone} sm">${esc(act)}</span></small></div>
        <div class="h-sh"><b class="br-rate ${BUY_RE.test(nowRating(b.rating)) ? 'up' : SELL_RE.test(nowRating(b.rating)) ? 'down' : ''}">${esc(RATING_KO(b.rating))}</b></div>
        <div class="h-chg">${tg ? `<b>${esc(b.target.replace(/\s*→\s*/, '→'))}</b><small class="${cls(up)}">${up != null ? pct(up, 0) : ''}</small>` : '<small>목표가 없음</small>'}</div></li>`;
    }).join('');
    return `<div class="mini-h er-h br-h"><span>${showAll ? '의견 변경 기록(최근순)' : '증권사별 최근 의견'}</span><button type="button" class="chip-btn sm" data-brokers="${sym}">${showAll ? '증권사별로 보기' : '전체 기록 보기'}</button></div>
      <ul class="h-list br-list">${rows}</ul><p class="note">출처: ${esc(state.analyst?.[sym]?.street?.brokerSrc || 'Finviz')}. 목표가 옆 %는 현재가 대비. "A→B"는 이번에 바꾼 의견·목표가예요. '목표↑·목표↓'는 의견은 그대로 두고 목표가만 바꾼 거예요.</p>`;
  }

  // ---------------------------------------------------------------- 옵션 시장 심리 (CBOE 지연 시세)
  function optTone(O) {
    if (!O?.pcVol && O?.pcVol !== 0) return ['neu', '자료 부족'];
    return O.pcVol < 0.7 ? ['pos', '상승 베팅 우세'] : O.pcVol > 1.0 ? ['neg', '하락 대비 우세'] : ['neu', '균형'];
  }
  // 자료를 받은 시각(이 기기 시간) — '10/17 15:30 기준'
  const asOf = (iso) => { const t = Date.parse(iso || ''); if (!t) return ''; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${EN ? '' : ' 기준'}`; };
  function renderOptions(sym = state.stock, id = sym === 'CRCL' ? 'options' : 'soptions') {
    if (!document.getElementById('c-' + id)) return;
    const O = state.options?.[sym], S = STOCK_INFO[sym], title = '옵션 시장 심리';
    if (!O) { card(id, { title, info: INFO.options, body: `<p class="skeleton">${state.optionsErr?.[sym] ? esc(state.optionsErr[sym]) : '불러오는 중…'}</p>` }); return; }
    const [tone, label] = optTone(O), sp0 = O.spot;
    const mv = (x, lbl) => (x ? `<div><span>${lbl}</span><b>±${(x.move * 100).toFixed(1)}%</b><small>${md(isoToTs(x.exp))} 만기(${x.days}일) · ${price(sp0 * (1 - x.move))}~${price(sp0 * (1 + x.move))}</small></div>` : '');
    const strikes = (L, t) => L.map((r) => `<span class="op-k ${t}" title="${md(isoToTs(r.exp))} 만기 · 미결제 ${unit(r.oi)}계약">$${r.k % 1 ? r.k.toFixed(1) : r.k}<small>${unit(r.oi)} · ${md(isoToTs(r.exp))}</small></span>`).join('');
    card(id, {
      title, sub: `${S.short} · CBOE 옵션 시세(약 15분 지연) · 기준가 ${price(sp0)}${O.at ? ` · ${asOf(O.at)}` : ''}`, info: INFO.options,
      body: `<div class="an-head"><span class="tone ${tone}">${label}</span><span class="an-cons">풋/콜 거래량 비율 <b>${O.pcVol != null ? O.pcVol.toFixed(2) : '–'}</b></span></div>
        <div class="ns-grid er-grid">
          <div><span>내재변동성(IV30)</span><b>${O.iv30 != null ? O.iv30.toFixed(1) + '%' : '–'}</b><small>앞으로 30일 연간 변동성 예상${O.iv30Chg ? ` · 전일 ${O.iv30Chg > 0 ? '+' : ''}${O.iv30Chg.toFixed(1)}%p` : ''}</small></div>
          <div><span>풋/콜 미결제 비율</span><b>${O.pcOI != null ? O.pcOI.toFixed(2) : '–'}</b><small>콜 ${unit(O.callOI)} · 풋 ${unit(O.putOI)}계약</small></div>
          ${mv(O.near, '가장 가까운 만기 예상 변동폭')}${mv(O.month, '한 달 예상 변동폭')}
          ${O.earn ? mv(O.earn, '실적 발표 포함 만기 예상 변동폭') : ''}
          ${O.maxPain ? `<div><span>맥스 페인</span><b>${price(O.maxPain.strike)}</b><small>${md(isoToTs(O.maxPain.exp))} 만기 · 현재가 대비 <span class="${cls(O.maxPain.strike / sp0 - 1)}">${pct(O.maxPain.strike / sp0 - 1, 1)}</span></small></div>` : ''}
        </div>
        ${O.topCalls?.length ? `<div class="mini-h er-h">미결제가 많이 쌓인 가격(60일 이내 만기)</div><div class="op-row"><span class="op-l up">콜</span>${strikes(O.topCalls, 'up')}</div><div class="op-row"><span class="op-l down">풋</span>${strikes(O.topPuts, 'down')}</div>` : ''}
        ${O.unusual?.length ? `<div class="mini-h er-h">오늘 거래가 몰린 옵션(거래량 > 미결제 1.5배)</div><ul class="op-un">${O.unusual.map((u) => `<li><span class="${u.type === 'C' ? 'up' : 'down'}">${u.type === 'C' ? '콜' : '풋'} ${price(u.k)}</span><span>${md(isoToTs(u.exp))} 만기</span><span>거래 ${unit(u.vol)} · 미결제 ${unit(u.oi)}</span></li>`).join('')}</ul>` : ''}
        <p class="note">옵션 가격으로 계산한 시장의 기대치예요. 실제 움직임과 다를 수 있고, 거래가 적은 종목은 수치가 들쭉날쭉해요.</p>`,
    });
  }
  function optionsSummaryItem(sym) {
    const O = state.options?.[sym];
    if (!O || O.pcVol == null) return null;
    const [tone, label] = optTone(O), E = O.earn;
    const t = tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : 'neu';
    return [t, sym === 'CRCL' ? 'crcl:c-options' : 'sprice:c-soptions', `옵션 풋/콜 ${O.pcVol.toFixed(2)}(${label}) · IV30 ${O.iv30 != null ? O.iv30.toFixed(0) + '%' : '–'}${E && E.days <= 21 ? ` · 실적 포함 만기 예상 변동폭 <b>±${(E.move * 100).toFixed(0)}%</b>` : ''}`, t === 'pos' ? '옵션 상승 베팅' : t === 'neg' ? '옵션 하락 대비' : null, 1];
  }

  // ---------------------------------------------------------------- 실적 발표 당일 모드
  // 발표 전날~당일(미국 날짜): 일정·시각·예상치·옵션이 보는 변동폭 / 발표 후 36시간: 실제 vs 예상·주가 반응·공시·관련 뉴스
  const ET_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const etDate = (ms = Date.now()) => ET_FMT.format(ms);
  const etOffset = (iso) => { try { const v = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(iso + 'T12:00:00Z')).find((p) => p.type === 'timeZoneName').value; const m = v.match(/GMT([+-]\d+)/); return m ? `${m[1].startsWith('-') ? '-' : '+'}${String(Math.abs(+m[1])).padStart(2, '0')}:00` : '-05:00'; } catch { return '-05:00'; } };
  const earnOf = (sym) => (sym === 'CRCL' ? state.earnings : st(sym).earn);
  // 같은 자료로 짧은 시간에 여러 번 부르면(종목 칩·카드마다) 앞 결과를 쓴다
  const EARN_DAY_MEMO = new Map();
  // ---- 🗳️ 실적 예측 투표(익명): 발표 전 '예상보다 좋을까?' → 발표 뒤 실제 결과·내 적중 여부. 키 = '종목:분기 말일'
  const VOTE_KEY = 'cw.votes';
  let myVotes = readJSON(VOTE_KEY, {}) || {};
  state.votes = {};
  function voteVid() {
    let v = localStorage.getItem('cw.vid');
    if (/^[a-z0-9]{16,40}$/.test(v || '')) return v;
    v = localStorage.getItem('cw.vvid');
    if (!/^[a-z0-9]{16,40}$/.test(v || '')) { v = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24); try { localStorage.setItem('cw.vvid', v); } catch {} }
    return v;
  }
  function voteFetch(k) {
    const c = state.votes[k];
    if (!SITE_API || (c && (c.loading || Date.now() - c.t < 300000))) return;
    state.votes[k] = { up: 0, down: 0, ...(c || {}), loading: true, t: Date.now() };
    getJ(`${SITE_API}/vote?k=${encodeURIComponent(k)}`, 8000)
      .then((j) => { state.votes[k] = { up: j.up || 0, down: j.down || 0, t: Date.now() }; paintVote(k); })
      .catch(() => { state.votes[k] = { ...state.votes[k], loading: false }; });
  }
  function voteBox(k) {
    const i = k.lastIndexOf(':'), sym = k.slice(0, i), q = k.slice(i + 1), E = earnOf(sym), mine = myVotes[k]?.v, c = state.votes[k];
    const tot = c ? c.up + c.down : 0, upP = tot ? Math.round((c.up / tot) * 100) : 0;
    const crowd = tot ? `<div class="vote-bar" aria-hidden="true"><i style="width:${upP}%"></i></div><small class="vote-n">👍 ${EN ? 'Beat' : '기대 이상'} ${upP}% · 👎 ${EN ? 'Miss' : '기대 이하'} ${100 - upP}% · ${tot}${EN ? ` vote${tot === 1 ? '' : 's'}` : '명 참여'}</small>` : '';
    const rep = (E?.quarters || []).find((x) => x.end === q && x.reportedOn);
    if (rep) {
      if (mine == null && !tot) return `<div class="vote-box" data-vk="${esc(k)}" hidden></div>`;
      const sur = (E.surprises || []).find((x) => x.end === q);
      const beat = sur?.eps != null && sur?.consensus != null ? sur.eps >= sur.consensus : null;
      if (beat != null && mine != null && myVotes[k].r == null) { myVotes[k].r = (mine === 1) === beat ? 1 : 0; writeJSON(VOTE_KEY, myVotes); }
      const rec = Object.values(myVotes).filter((x) => x.r != null);
      const hit = mine == null || beat == null ? '' : (mine === 1) === beat ? `<span class="vote-hit up">✓ ${EN ? 'You called it' : '내 예측 적중'}</span>` : `<span class="vote-hit down">✗ ${EN ? 'Not this time' : '이번엔 빗나갔어요'}</span>`;
      return `<div class="vote-box done" data-vk="${esc(k)}"><div class="vote-q"><b>🗳️ ${EN ? 'Prediction poll' : '예측 투표 결과'} · ${qLabelLong(q)}</b>${hit}</div>
        ${beat != null ? `<p class="vote-res">${EN ? 'Actual' : '실제'} <b class="${beat ? 'up' : 'down'}">${beat ? (EN ? 'beat' : '예상 상회') : (EN ? 'missed' : '예상 하회')}</b> · EPS $${sur.eps.toFixed(2)} ${EN ? 'vs est.' : '/ 예상'} $${sur.consensus.toFixed(2)}${mine != null ? ` · ${EN ? 'my pick' : '내 선택'} ${mine ? '👍' : '👎'}` : ''}</p>` : ''}
        ${crowd}${rec.length >= 2 ? `<small class="vote-rec">${EN ? 'My hit rate' : '내 적중률'} <b>${rec.filter((x) => x.r).length}/${rec.length}</b></small>` : ''}</div>`;
    }
    return `<div class="vote-box" data-vk="${esc(k)}"><div class="vote-q"><b>🗳️ ${EN ? 'Will this report beat expectations?' : '이번 실적, 예상보다 좋을까요?'}</b><small>${EN ? 'Anonymous · see the result and whether you were right after the report' : '익명 투표 · 발표 뒤 결과와 적중 여부를 알려 드려요'}</small></div>
      <div class="vote-btns"><button type="button" data-vote="${esc(k)}|1" aria-pressed="${mine === 1}">👍 ${EN ? 'Beat' : '기대 이상'}</button><button type="button" data-vote="${esc(k)}|0" aria-pressed="${mine === 0}">👎 ${EN ? 'Miss' : '기대 이하'}</button></div>
      ${mine != null ? crowd || `<small class="vote-n">${EN ? 'Counting…' : '집계 중…'}</small>` : `<small class="vote-n">${EN ? 'Vote to see what others think' : '투표하면 다른 사람들 생각도 보여요'}</small>`}</div>`;
  }
  // 실적 카드·발표 카드에 붙는 투표 칸: 최근 발표(30일 안) 결과 + 다음 발표(30일 안) 투표
  function voteBlock(sym) {
    if (!SITE_API || isKR(sym)) return '';
    const E = earnOf(sym);
    if (!E) return '';
    const out = [], last = (E.quarters || []).at(-1), N = E.next;
    if (last?.end && last.reportedOn && daysBetween(last.reportedOn, isoToday()) <= 30) { const k = `${sym}:${last.end}`; out.push(voteBox(k)); voteFetch(k); }
    const nk = N?.date && /^\d{4}-\d{2}-\d{2}$/.test(N.quarter || N.date) ? `${sym}:${N.quarter || N.date}` : null;
    if (nk && dday(N.date) >= 0 && dday(N.date) <= 30 && (!last || (N.quarter || N.date) > last.end)) { out.push(voteBox(nk)); if (myVotes[nk]) voteFetch(nk); }
    return out.join('');
  }
  function paintVote(k) { for (const el of document.querySelectorAll(`.vote-box[data-vk="${CSS.escape(k)}"]`)) el.outerHTML = voteBox(k); }
  async function castVote(k, v) {
    myVotes[k] = { v, at: Date.now() };
    writeJSON(VOTE_KEY, myVotes);
    paintVote(k);
    try {
      const r = await fetch(`${SITE_API}/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, v, vid: voteVid() }) });
      const j = await r.json();
      if (r.ok && !j.error) { state.votes[k] = { up: j.up || 0, down: j.down || 0, t: Date.now() }; paintVote(k); toast(EN ? '✓ Vote saved — check back after the report' : '✓ 투표했어요 · 발표 뒤 결과를 알려 드려요'); }
      else throw new Error(j.error || r.status);
    } catch { toast(EN ? 'Could not save your vote' : '투표를 저장하지 못했어요. 잠시 후 다시 눌러 주세요', true); }
  }
  function earnDay(sym) {
    const E = earnOf(sym), A = state.analyst?.[sym]?.street;
    if (!E) return null;
    const m = EARN_DAY_MEMO.get(sym), now = Date.now();
    if (m && m.E === E && m.A === A && now - m.t < 5000) return m.v;
    const v = earnDayNow(sym, E, A);
    EARN_DAY_MEMO.set(sym, { E, A, t: now, v });
    return v;
  }
  function earnDayNow(sym, E, A) {
    const force = location.search.match(/earnday=([A-Z.]+):(pre|post)/);
    const N = E.next, Q = E.quarters || [], lastQ = Q.at(-1), fq = A?.quarters?.at(-1);
    const repMs = Math.max(fq?.at || 0, lastQ?.reportedOn ? Date.parse(lastQ.reportedOn + 'T21:00:00Z') : 0);
    // 발표 시각: Finviz 'Nov 11 AMC'의 날짜가 다음 발표일과 같을 때만 믿는다
    let time = null;
    if (N?.date && A?.earnings) { const [mo, dd] = A.earnings.split(' '); const d = new Date(N.date + 'T12:00:00Z'); if (d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) === mo && d.getUTCDate() === +dd) time = A.earningsTime; }
    const base = { E, A, N, lastQ, fq, time, repMs };
    if (force?.[1] === sym) return { ...base, phase: force[2] };
    if (repMs && Date.now() - repMs < 36 * 3600000 && Date.now() >= repMs - 3600000) return { ...base, phase: 'post' };
    if (N?.date && (N.date === etDate() || N.date === etDate(Date.now() + 86400000))) return { ...base, phase: 'pre' };
    return null;
  }
  const EARN_CHECK = {
    CRCL: 'USDC 유통량·준비금 이자수익, 금리 민감도, 유통 비용(Coinbase 등) 비중, 다음 분기 가이던스',
    JOBY: '주주서한의 <b>FAA 인증 단계별 %</b>(서버가 자동으로 읽어 반영), 현금 소진 속도, 상업 운항 일정',
    SPCX: '스타링크 매출 성장, 설비투자 규모 — 발표 <b>2거래일 뒤 보호예수 최대 13억 주 해제</b>(3분기)',
    TEM: '매출 성장률, 흑자 유지 여부, 유전체 검사 건수·데이터 사업 성장',
  };
  function renderEarnDay(sym = state.stock) {
    const id = sym === 'CRCL' ? 'earnday' : 'searnday', el = document.getElementById('c-' + id);
    if (!el) return;
    const D = earnDay(sym);
    el.hidden = !D;
    if (!D) return;
    const S = STOCK_INFO[sym], N = D.N, O = state.options?.[sym];
    if (D.phase === 'pre') {
      const at = N?.date && D.time ? Date.parse(`${N.date}T${D.time === 'BMO' ? '08:00' : '16:05'}:00${etOffset(N.date)}`) : null;
      const left = at ? at - Date.now() : null;
      const kst = at ? new Date(at).toLocaleString(LOC, { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
      const sur = (D.E.surprises || []).slice(0, 4);
      const beats = sur.filter((x) => x.eps >= x.consensus).length;
      card(id, {
        title: EN ? `🔔 ${S.short} earnings ${dday(N.date) <= 0 ? 'today' : dday(N.date) === 1 ? 'tomorrow' : `D-${dday(N.date)}`}` : `🔔 ${S.short} 실적 발표 ${dday(N.date) <= 0 ? '오늘' : dday(N.date) === 1 ? '내일' : `D-${dday(N.date)}`}`,
        sub: EN ? `${N.quarter ? qLabelLong(N.quarter) + ' earnings · ' : ''}US ${krDate(N.date)} · ${D.time ? (D.time === 'BMO' ? 'before open' : 'after close') : 'time TBD'}` : `${N.quarter ? qLabelLong(N.quarter) + ' 실적 · ' : ''}미국 ${krDate(N.date)}${D.time ? ` · ${D.time === 'BMO' ? '장 시작 전' : '장 마감 후'}` : ' · 시각 미정'}`, info: INFO.earnday,
        body: `${kst ? `<div class="ed-time"><b>한국시간 ${esc(kst)}경</b>${left > 0 ? `<span>${Math.floor(left / 3600000)}시간 ${Math.floor((left % 3600000) / 60000)}분 남음</span>` : '<span>곧 발표</span>'}</div>` : ''}
          <div class="ns-grid er-grid">
            <div><span>예상 EPS</span><b>${N.consensus != null ? '$' + N.consensus.toFixed(2) : '–'}</b><small>${N.low != null ? `범위 $${N.low.toFixed(2)}~$${N.high.toFixed(2)}` : ''}${N.analysts ? (EN ? ` · ${N.analysts} analysts` : ` · ${N.analysts}명`) : ''}</small></div>
            <div><span>작년 같은 분기</span><b>${N.lastYearEps != null ? '$' + N.lastYearEps.toFixed(2) : '–'}</b><small>EPS</small></div>
            <div><span>옵션이 보는 변동폭</span><b>${O?.earn ? '±' + (O.earn.move * 100).toFixed(1) + '%' : '–'}</b><small>${O?.earn ? `${price(O.spot * (1 - O.earn.move))} ~ ${price(O.spot * (1 + O.earn.move))}` : '옵션 자료 없음'}</small></div>
            <div><span>${EN ? `Beat in last ${sur.length} qtrs` : `최근 ${sur.length}분기 예상 상회`}</span><b>${sur.length ? `${beats}/${sur.length}` : '–'}</b><small>EPS 기준</small></div>
          </div>
          <p class="ed-check">✅ 볼 것: ${EARN_CHECK[sym] || '매출·EPS가 예상보다 높은지, 다음 분기 가이던스'}</p>${memoRemind(sym)}${voteBlock(sym)}`,
      });
      return;
    }
    // 발표 후
    const fq = D.fq, q = D.lastQ, sur = (D.E.surprises || []).find((x) => x.end === q?.end);
    const eps = fq?.eps ?? sur?.eps ?? q?.eps, epsEst = fq?.epsEst ?? sur?.consensus;
    const epsS = eps != null && epsEst ? (eps - epsEst) / Math.abs(epsEst) : null;
    const salesS = fq?.sales && fq?.salesEst ? fq.sales / fq.salesEst - 1 : null;
    const p = stockPx(sym);
    const fl = (sym === 'CRCL' ? state.data?.news?.filings : st(sym).news?.filings) || [];
    const k8 = fl.find((f) => /^8-K/.test(f.form) && /2\.02/.test(f.items || '') && Date.now() - Date.parse(f.d) < 4 * 86400000);
    const EN_RE = /earnings|results|quarter|revenue|guidance|EPS|실적|분기|매출|어닝/i;
    const news = newsItems(sym).filter((i) => i.kind !== 'filing' && EN_RE.test(i.title) && Date.now() - i.t < 2 * 86400000).slice(0, 4);
    card(id, {
      title: EN ? `📊 ${S.short} earnings results` : `📊 ${S.short} 실적 발표 결과`, sub: `${q ? qLabelLong(q.end) : ''} · ${EN ? 'released' : '발표'} ${D.repMs ? new Date(D.repMs).toLocaleString(LOC, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}`, info: INFO.earnday,
      body: `<div class="ns-grid er-grid">
          <div><span>EPS</span><b class="${cls(epsS)}">${eps != null ? '$' + (+eps).toFixed(2) : '–'}</b><small>${epsEst != null ? `예상 $${(+epsEst).toFixed(2)} · ` : ''}${epsS != null ? `<span class="${cls(epsS)}">${epsS >= 0 ? '예상 상회' : '예상 하회'} ${pct(epsS, 0)}</span>` : ''}</small></div>
          <div><span>매출</span><b class="${cls(salesS)}">${fq?.sales ? usd(fq.sales) : usdS2(q?.revenue)}</b><small>${fq?.salesEst ? `예상 ${usd(fq.salesEst)} · <span class="${cls(salesS)}">${salesS >= 0 ? '상회' : '하회'} ${pct(salesS, 1)}</span>` : ''}</small></div>
          <div><span>주가 반응</span><b class="${cls(p?.pct)}">${p?.pct != null ? pct(p.pct, 1) : '–'}</b><small>${price(p?.price)} · ${BN24[sym] || sym === 'CRCL' ? '바이낸스 24시간' : esc(mktStatus(state.quote?.[sym]?.status))}</small></div>
          <div><span>다음 실적</span><b>${D.E.next?.date && D.E.next.date > (q?.end || '') ? md(isoToTs(D.E.next.date)) : '–'}</b><small>${D.E.next?.estimated ? '예상일' : ''}</small></div>
        </div>
        ${k8 ? `<a class="faa-notice good" href="${safeUrl(k8.url)}" target="_blank" rel="noopener">📄 실적 발표 공시(8-K, ${md(isoToTs(k8.d))}) 원문 보기 →</a>` : ''}
        ${news.length ? `<div class="mini-h er-h">실적 관련 소식</div><ul class="nl faa-nl">${news.map((i) => `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener"><span class="nk related">${i.official ? '공식' : '뉴스'}</span><span class="nt">${esc(i.title)}</span>${i.sum ? `<span class="nsum">${esc(i.sum)}</span>` : ''}<span class="nm">${esc(i.source)} · ${dayLabel(i.t)}</span></a></li>`).join('')}</ul>` : ''}
        ${earnSumBlock(sym)}<p class="ed-check">✅ 이어서 볼 것: ${EARN_CHECK[sym] || '가이던스와 컨퍼런스콜 내용'}</p>${memoRemind(sym)}${voteBlock(sym)}`,
    });
  }

  // ---------------------------------------------------------------- 🧮 물타기·불타기 계산기 (종목 시세 탭)
  // 입력값은 화면에만 두고(저장 안 함), 보유 정보(퇴사까지·배당금)에 그 종목이 있으면 수량·평단을 미리 채운다.
  const calcIn = {}; // 종목 → { sh, avg, bp, bq, goal } (입력 중인 글자 그대로)
  const numOf = (v) => { const n = parseFloat(String(v ?? '').replace(/[,\s$₩원주]/g, '')); return isFinite(n) ? n : null; };
  const moneyOf = (sym, v) => (isKR(sym) ? wonFull(v) : usd2(v));
  const pxIn = (sym, v) => (v == null || !isFinite(v) ? '' : isKR(sym) ? String(Math.round(v)) : String(+v.toFixed(v >= 1 ? 2 : 4)));
  function myPos(sym) {
    const f = fireCfg?.positions?.find((p) => p.ticker === sym);
    if (f) return { sh: f.shares, avg: f.avg };
    const d = divCfg?.hold?.find((h) => h.t === sym);
    return d?.sh > 0 ? { sh: d.sh, avg: d.avg } : null;
  }
  function avgCalc(sym) {
    const I = calcIn[sym] || {}, sh = numOf(I.sh) || 0, avg = numOf(I.avg) || 0, bp = numOf(I.bp), bq = numOf(I.bq) || 0, x = pxOf(sym);
    if (!(bp > 0) || !(bq > 0) || (sh > 0 && !(avg > 0))) return null;
    const cost0 = sh * avg, add = bp * bq, sh1 = sh + bq, avg1 = (cost0 + add) / sh1;
    return { sh, avg, bp, bq, x, add, sh1, avg1, cost1: cost0 + add, dAvg: sh > 0 ? avg1 / avg - 1 : null, r0: sh > 0 && x ? x / avg - 1 : null, r1: x ? x / avg1 - 1 : null, mode: !(sh > 0) ? 'new' : bp < avg ? 'down' : bp > avg ? 'up' : 'same' };
  }
  function avgOutHtml(sym) {
    const R = avgCalc(sym), I = calcIn[sym] || {};
    if (!R) return `<p class="avc-empty">${EN ? 'Enter the buy price and how many shares you’d add.' : '추가로 살 가격과 수량을 넣으면 바로 계산돼요.'}</p>`;
    const tag = R.mode === 'down' ? `<span class="avc-tag down">${EN ? 'Averaging down' : '물타기'}</span>` : R.mode === 'up' ? `<span class="avc-tag up">${EN ? 'Averaging up' : '불타기'}</span>` : '';
    const unit = EN ? ' sh' : '주';
    return `<div class="avc-hero"><span>${tag}${EN ? 'New average cost' : '새 평단'}</span><b>${pxS(sym, R.avg1)}</b>${R.dAvg != null ? `<small class="${cls(R.dAvg)}">${EN ? 'vs now ' : '지금보다 '}${pct(R.dAvg, 1)}</small>` : ''}</div>
      <ul class="avc-rows">
        <li><span>${EN ? 'Cash needed' : '추가로 필요한 돈'}</span><b>${moneyOf(sym, R.add)}${!isKR(sym) && krwOf(R.add) ? ` <small class="muted">(${krwOf(R.add)})</small>` : ''}</b></li>
        <li><span>${EN ? 'Shares after' : '합친 수량'}</span><b>${fmtSh(R.sh1)}${unit}</b></li>
        <li><span>${EN ? 'Total invested' : '총 투자금'}</span><b>${moneyOf(sym, R.cost1)}</b></li>
        ${R.x ? `<li><span>${EN ? `Return at ${pxS(sym, R.x)}` : `지금 가격(${pxS(sym, R.x)}) 기준 수익률`}</span><b>${R.r0 != null ? `<span class="${cls(R.r0)}">${pct(R.r0, 1)}</span> → ` : ''}<span class="${cls(R.r1)}">${pct(R.r1, 1)}</span></b></li>
        <li><span>${EN ? 'Break-even' : '본전까지'}</span><b>${R.r1 >= 0 ? (EN ? 'Already in profit' : '이미 수익 중') : `${EN ? 'needs ' : ''}<span class="up">${pct(R.avg1 / R.x - 1, 1)}</span>${EN ? '' : ' 오르면'}`}</b></li>` : ''}
      </ul>`;
  }
  // 목표 평단까지 몇 주: sh·(avg−T) = q·(T−bp)
  function acGoalHtml(sym) {
    const I = calcIn[sym] || {}, sh = numOf(I.sh) || 0, avg = numOf(I.avg) || 0, bp = numOf(I.bp), T = numOf(I.goal);
    if (!(T > 0)) return EN ? 'Enter a target average to see how many shares it takes at the buy price.' : '목표 평단을 넣으면 위의 \'살 가격\'으로 몇 주 더 사야 하는지 알려 드려요.';
    if (!(sh > 0 && avg > 0 && bp > 0)) return EN ? 'Fill in shares, average cost and buy price first.' : '위에 지금 수량·평단·살 가격을 먼저 넣어 주세요.';
    if (!((T - avg) * (T - bp) < 0)) return EN ? 'Not reachable at this buy price — the target must be between your average and the buy price.' : '이 가격으로는 만들 수 없어요. 목표 평단은 지금 평단과 살 가격 사이여야 해요.';
    const need = Math.ceil((sh * (avg - T)) / (T - bp) - 1e-9);
    return EN ? `Buy <b>${fmtSh(need)} sh</b> at ${pxS(sym, bp)} — <b>${moneyOf(sym, need * bp)}</b>` : `${pxS(sym, bp)}에 <b>${fmtSh(need)}주</b> 더 사면 돼요 — <b>${moneyOf(sym, need * bp)}</b> 필요`;
  }
  function renderAvgCalc(sym = state.stock) {
    const id = sym === 'CRCL' ? 'avgcalc' : 'savgcalc', el = document.getElementById('c-' + id);
    if (!el) return;
    if (el.dataset.sym === sym && el.dataset.en === String(EN) && el.childElementCount) { // 입력 칸은 그대로 두고 결과만(현재가 반영)
      const I = calcIn[sym], x = pxOf(sym), bpIn = el.querySelector('input[data-ac="bp"]');
      if (I && !I.bp && x && bpIn && document.activeElement !== bpIn) { I.bp = pxIn(sym, x); bpIn.value = I.bp; } // 처음엔 시세가 아직 없었던 경우
      acPaint(sym, el);
      return;
    }
    if (!calcIn[sym]) { const P = myPos(sym), x = pxOf(sym); calcIn[sym] = { sh: P ? String(P.sh) : '', avg: P ? pxIn(sym, P.avg) : '', bp: pxIn(sym, x), bq: '', goal: '' }; }
    const I = calcIn[sym], cur = isKR(sym) ? '원' : '$', mine = myPos(sym);
    const f = (k, label, ph, em) => `<label class="avc-f"><span>${label}</span><span class="avc-in"><input data-ac="${k}" data-sym="${esc(sym)}" inputmode="decimal" value="${esc(I[k] || '')}" placeholder="${ph}" aria-label="${label}"><em>${em}</em></span></label>`;
    el.dataset.sym = sym; el.dataset.en = String(EN);
    card(id, {
      title: EN ? '🧮 Average-down calculator' : '🧮 물타기·불타기 계산기',
      sub: mine ? (EN ? 'Filled in from your holdings · nothing is saved' : '내 보유 정보로 채웠어요 · 계산만 하고 저장하지 않아요') : (EN ? 'What happens to your average cost if you buy more' : '더 사면 평균 단가가 어떻게 바뀌는지 바로 계산'),
      body: `<div class="avc-grid">
          <div class="avc-sec">${EN ? 'What I hold now' : '지금 보유'}</div>
          ${f('sh', EN ? 'Shares' : '수량', EN ? 'e.g. 100' : '예: 100', EN ? 'sh' : '주')}
          ${f('avg', EN ? 'Average cost' : '평단', EN ? 'avg' : '평균 단가', cur)}
          <div class="avc-sec">${EN ? 'Buy more' : '추가 매수'}</div>
          ${f('bp', EN ? 'Buy price' : '살 가격', EN ? 'price' : '가격', cur)}
          ${f('bq', EN ? 'Shares to buy' : '살 수량', EN ? 'e.g. 50' : '예: 50', EN ? 'sh' : '주')}
          <div class="avc-quick"><button type="button" class="chip-btn" data-acnow="${esc(sym)}">${EN ? 'Current price' : '지금 가격'}</button>${[-5, -10, -20].map((d) => `<button type="button" class="chip-btn" data-acdrop="${d}" data-sym="${esc(sym)}">${d}%</button>`).join('')}</div>
        </div>
        <div class="avc-out" aria-live="polite">${avgOutHtml(sym)}</div>
        <div class="avc-goal"><b>🎯 ${EN ? 'Target average' : '평단을 얼마까지 맞추려면?'}</b>
          <span class="avc-in"><input data-ac="goal" data-sym="${esc(sym)}" inputmode="decimal" value="${esc(I.goal || '')}" placeholder="${EN ? 'target average cost' : '목표 평단'}" aria-label="${EN ? 'Target average cost' : '목표 평단'}"><em>${cur}</em></span>
          <div class="avc-goal-out">${acGoalHtml(sym)}</div></div>
        <p class="note">${EN ? 'Fees and taxes are not included. Not investment advice.' : '수수료·세금은 빼고 계산해요. 투자 권유가 아니에요.'}</p>`,
    });
  }
  function acInput(t) {
    const sym = t.dataset.sym;
    if (!sym) return;
    (calcIn[sym] ||= {})[t.dataset.ac] = t.value;
    acPaint(sym, t.closest('.calc-card'));
  }
  function acPaint(sym, el) {
    if (!el) return;
    const o = el.querySelector('.avc-out'), g = el.querySelector('.avc-goal-out');
    if (o) o.innerHTML = avgOutHtml(sym);
    if (g) g.innerHTML = acGoalHtml(sym);
  }
  function acSetBuy(sym, v) {
    (calcIn[sym] ||= {}).bp = pxIn(sym, v);
    const inp = document.querySelector(`.calc-card input[data-ac="bp"][data-sym="${CSS.escape(sym)}"]`);
    if (inp) { inp.value = calcIn[sym].bp; acInput(inp); }
  }

  // ---------------------------------------------------------------- 📝 투자 메모 (종목 시세 탭 · 실적 발표 카드에서 다시 보여 줌)
  // 왜 샀는지·언제 팔지를 종목별로 이 기기에만 저장한다(cw.memo: { 종목: { why, exit, at } })
  const MEMO_KEY = 'cw.memo';
  let memos = readSaved(MEMO_KEY, {}) || {}, memoEdit = null;
  const memoOf = (sym) => { const m = memos[sym]; return m && (m.why || m.exit) ? m : null; };
  function renderMemo(sym = state.stock) {
    const id = sym === 'CRCL' ? 'memo' : 'smemo', el = document.getElementById('c-' + id);
    if (!el) return;
    const key = `${sym}|${memoEdit === sym}|${memos[sym]?.at || 0}|${EN}`;
    if (el.dataset.key === key) return; // 다시 그릴 게 없으면 그대로(쓰는 중인 글자 보호)
    el.dataset.key = key;
    const M = memoOf(sym), name = esc(nameOfSym(sym));
    const title = EN ? '📝 My investment memo' : '📝 내 투자 메모';
    if (memoEdit === sym) {
      card(id, { title, sub: EN ? 'Saved only on this device' : '이 기기에만 저장돼요', body: `<div class="memo-form">
          <label>${EN ? `Why I bought ${name}` : `${name}을(를) 산 이유`}<textarea id="memo-why" maxlength="600" placeholder="${EN ? 'e.g. USDC supply keeps growing; Arc launch could add fee revenue' : '예: USDC 유통량이 계속 늘고, Arc 출시로 수수료 수익이 생길 것 같아서'}">${esc(M?.why || '')}</textarea></label>
          <label>${EN ? 'When I’d sell' : '팔 기준'}<textarea id="memo-exit" maxlength="600" placeholder="${EN ? 'e.g. If USDC shrinks two quarters in a row, or above $250' : '예: USDC가 두 분기 연속 줄면, 또는 250달러 넘으면 절반 정리'}">${esc(M?.exit || '')}</textarea></label>
          <div class="memo-btns"><button type="button" class="btn-primary" data-memosave="${esc(sym)}">${EN ? 'Save' : '저장'}</button><button type="button" class="btn-ghost" data-memox="1">${EN ? 'Cancel' : '취소'}</button>${M ? `<button type="button" class="btn-ghost" data-memodel="${esc(sym)}">${EN ? 'Delete' : '지우기'}</button>` : ''}</div>
        </div>` });
      return;
    }
    if (!M) {
      card(id, { title, sub: EN ? 'Your own reasons, shown again at earnings time' : '실적 발표 때 다시 보여 드려요', body: `<button type="button" class="memo-start" data-memoedit="${esc(sym)}">✏️ ${EN ? 'Write why I bought it and when I’d sell' : '산 이유·팔 기준 적어 두기'}<small>${EN ? 'Saved only on this device' : '이 기기에만 저장돼요'}</small></button>` });
      return;
    }
    card(id, { title, sub: EN ? 'Shown again on earnings day' : '실적 발표 때 다시 보여 드려요', body: `<div class="memo-view">
        ${M.why ? `<div class="memo-b"><span>${EN ? 'Why I bought' : '산 이유'}</span><p>${esc(M.why)}</p></div>` : ''}
        ${M.exit ? `<div class="memo-b"><span>${EN ? 'When I’d sell' : '팔 기준'}</span><p>${esc(M.exit)}</p></div>` : ''}
        <div class="memo-meta"><span>${M.at ? (EN ? `Written ${new Date(M.at).toLocaleDateString(LOC)}` : `${new Date(M.at).toLocaleDateString(LOC)}에 적음`) : ''}</span><button type="button" class="chip-btn sm" data-memoedit="${esc(sym)}">${EN ? 'Edit' : '수정'}</button></div>
      </div>` });
  }
  function saveMemo(sym) {
    const why = (document.getElementById('memo-why')?.value || '').trim().slice(0, 600), exit = (document.getElementById('memo-exit')?.value || '').trim().slice(0, 600);
    if (why || exit) memos[sym] = { why, exit, at: Date.now() }; else delete memos[sym];
    writeJSON(MEMO_KEY, memos);
    memoEdit = null;
    renderMemo(sym);
    try { renderEarnDay(sym); } catch {}
    toast(why || exit ? (EN ? '✓ Memo saved' : '✓ 메모를 저장했어요') : (EN ? 'Memo cleared' : '메모를 지웠어요'));
  }
  // 실적 발표 카드에 붙는 '내가 적어 둔 메모'
  function memoRemind(sym) {
    const M = memoOf(sym);
    if (!M) return '';
    return `<div class="memo-remind"><b>📝 ${EN ? 'Your memo — check it against the results' : '내가 적어 둔 메모 — 이번 실적과 맞는지 확인해 보세요'}</b>${M.why ? `<p><em>${EN ? 'Why I bought' : '산 이유'}</em> ${esc(M.why)}</p>` : ''}${M.exit ? `<p><em>${EN ? 'When I’d sell' : '팔 기준'}</em> ${esc(M.exit)}</p>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- 종목 추가·삭제·순서 (이 기기에 저장)
  let watchSearchTimer = null, watchResults = [];
  function saveWatch() { writeJSON(WATCH_KEY, { list: WATCH, custom: watchCfg.custom, folders: watchCfg.folders }); }
  function openWatchSheet() {
    let el = document.getElementById('watch-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'watch-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '종목 관리');
      document.body.appendChild(el);
    }
    el.hidden = false;
    document.body.classList.add('sheet-open');
    loadPopular();
    renderWatchSheet();
    setTimeout(() => document.getElementById('watch-q')?.focus(), 50);
  }
  function closeWatchSheet() {
    const el = document.getElementById('watch-sheet');
    if (el) el.hidden = true;
    document.body.classList.remove('sheet-open');
    clearTimeout(watchSearchTimer); watchResults = []; // 다음에 열 때는 빈 검색칸으로
    const q = document.getElementById('watch-q'); if (q) q.value = '';
  }
  function renderWatchSheet() {
    const el = document.getElementById('watch-sheet');
    if (!el || el.hidden) return;
    const q = document.getElementById('watch-q')?.value || '';
    const typing = document.activeElement?.id === 'watch-q'; // 다시 그린 뒤에도 입력칸에 커서를 둔다(글자를 다 지운 경우 포함)
    const rows = WATCH.map((sym, i) => {
      const S = STOCK_INFO[sym];
      return `<li><span class="ws-logo" style="--sc:${S.color}">${S.logo ? `<img src="${S.logo}" alt="" width="22" height="22">` : esc(sym[0])}</span>
        <div class="ws-name">${S.kr ? `<b>${esc(S.name)}</b><small>${S.exchange === 'KOSDAQ' ? '코스닥' : '코스피'} · ${sym.slice(0, 6)}</small>` : `<b>${sym}</b><small>${esc(S.name)}${BUILTIN.includes(sym) ? ' · 기본' : ''}</small>`}</div>
        <button type="button" class="ws-btn" data-wmove="${i}:-1" aria-label="${sym} 위로" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="ws-btn" data-wmove="${i}:1" aria-label="${sym} 아래로" ${i === WATCH.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="ws-btn del" data-wdel="${sym}" aria-label="${sym} 삭제" ${WATCH.length < 2 ? 'disabled' : ''}>삭제</button></li>`;
    }).join('');
    const res = (watchResults || []).map((r) => `<li>${logoPath(r.symbol) ? `<span class="ws-logo"><img src="${logoPath(r.symbol)}" alt="" width="22" height="22" loading="lazy"></span>` : `<span class="ws-logo ws-letter">${esc(String((r.code ? r.name : r.symbol) || '?')[0])}</span>`}<div class="ws-name">${r.code ? `<b>${esc(r.name)}</b><small>${r.etf ? 'ETF' : r.exchange === 'KOSDAQ' ? '코스닥' : '코스피'} · ${esc(r.code)}</small>` : `<b>${esc(r.symbol)}</b><small>${esc([r.kr && r.kr !== r.name && !EN ? r.kr : '', r.name, r.exchange, r.asset === 'ETF' ? 'ETF' : ''].filter(Boolean).join(' · '))}</small>`}</div>
      ${WATCH.includes(r.symbol) ? '<span class="ws-added">추가됨</span>' : `<button type="button" class="ws-btn add" data-wadd="${esc(r.symbol)}" data-wname="${esc(r.name)}" data-wex="${esc(r.exchange)}" data-wasset="${esc(r.asset || '')}"${r.kr ? ' data-wkr="1"' : ''}>+ 추가</button>`}</li>`).join('');
    const removedBuiltin = BUILTIN.filter((s) => !WATCH.includes(s));
    el.innerHTML = `<div class="sheet-bg" data-wclose="1"></div><div class="sheet-panel">
      <div class="sheet-h"><b>종목 관리</b><button type="button" class="ws-btn" data-wclose="1">완료</button></div>
      <label class="ws-search"><input id="watch-q" type="search" placeholder="${EN ? 'Ticker, company or KRX code (e.g. AAPL, Tesla, 005930)' : '티커·회사명·종목코드 (예: AAPL, 테슬라, 삼성, 005930)'}" autocomplete="off" value="${esc(q)}"></label>
      ${q ? `<ul class="ws-list">${res || `<li class="empty">${watchResults === null ? '검색 중…' : '검색 결과가 없어요. 미국 종목은 티커·영문·한글 회사명(테슬라), 한국 종목은 회사명·종목코드로 찾아 보세요.'}</li>`}</ul>` : ''}
      ${!q ? popularHtml() : ''}
      ${removedBuiltin.length && !q ? `<div class="ws-sub">다시 추가하기</div><ul class="ws-list">${removedBuiltin.map((s) => `<li><div class="ws-name"><b>${s}</b><small>${esc(STOCK_INFO[s].name)} · 기본</small></div><button type="button" class="ws-btn add" data-wadd="${s}">+ 추가</button></li>`).join('')}</ul>` : ''}
      <div class="ws-sub">내 종목 <small>위에서부터 홈 상단에 보여요</small></div>
      <ul class="ws-list">${rows}</ul>
      <p class="note">🔒 종목 목록은 이 기기(브라우저)에 저장돼요. '많이 추가한 종목' 순위를 위해 새로 추가한 티커 이름만 익명으로 모으고, 수량·금액 같은 보유 정보는 보내지 않아요. 기본 4종목(CRCL·JOBY·SPCX·TEM)은 전용 화면(FAA 인증·보호예수 등)이 있고, 새로 추가한 종목은 공통 화면(주가·실적·뉴스·공시·공매도·기관·애널리스트·옵션)으로 보여요. 바이낸스에 24시간 주식 선물이 있는 종목은 CRCL처럼 바이낸스 가격으로 표시돼요.</p>
    </div>`;
    const inp = document.getElementById('watch-q');
    if (inp && (q || typing)) { inp.focus({ preventScroll: true }); inp.setSelectionRange(q.length, q.length); }
  }
  // 인기 종목 순위: 관심 종목에 '새로 추가한' 티커 이름만 익명으로 보낸다(기본 4종목·수량·금액·보유 정보는 보내지 않음).
  // 목록이 바뀌었을 때와 하루 한 번만. 서버는 3대 이상 기기가 추가한 종목만 공개 순위(/api/popular)에 보여 준다.
  function sendPicks() {
    try {
      if (!IS_PROD) return;
      const list = WATCH.filter((x) => !BUILTIN.includes(x) && SYM_OK.test(x)).slice(0, 30).sort().join(',');
      const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const sig = `${day}|${list}`;
      if (localStorage.getItem('cw.picksSent') === sig) return;
      countVisit().then((vid) => {
        if (!vid) return;
        fetch(`/api/hit?k=w&v=${vid}&s=${encodeURIComponent(list)}`, { cache: 'no-store', keepalive: true })
          .then(() => { try { localStorage.setItem('cw.picksSent', sig); } catch {} }).catch(() => {});
      });
    } catch {}
  }
  let popular = null; // null = 아직 안 받음
  function loadPopular() {
    if (popular) return;
    popular = [];
    getJ(`${NEWS_API}/popular`, 8000).then(async (j) => {
      const L = (j.items || []).filter((x) => SYM_OK.test(x.sym));
      // 한국 종목은 코드 대신 종목명으로 보이게 상장 목록에서 이름을 찾아 둔다
      // 영어 화면은 영어 이름(서버가 Yahoo에서 찾음), 못 찾으면 한글 이름
      if (L.some((x) => isKR(x.sym))) await Promise.all(L.filter((x) => isKR(x.sym)).map(async (x) => {
        if (EN) { try { x.name = ((await getJ(`${NEWS_API}/lookup?q=${encodeURIComponent(x.sym)}`, 6000)).results || []).find((r) => r.symbol === x.sym)?.name; } catch {} }
        x.name ||= await krName(x.sym);
      }));
      popular = L; renderWatchSheet();
    }).catch(() => {});
  }
  function popularHtml() {
    const list = (popular || []).filter((x) => !WATCH.includes(x.sym)).slice(0, 8);
    if (!list.length) return '';
    return `<div class="ws-sub">🔥 다른 사람들이 많이 추가한 종목 <small>최근 30일</small></div>
      <ul class="ws-list ws-pop">${list.map((x) => `<li>${logoPath(x.sym) ? `<span class="ws-logo"><img src="${logoPath(x.sym)}" alt="" width="22" height="22" loading="lazy"></span>` : `<span class="ws-logo ws-letter">${esc((x.name || x.sym)[0])}</span>`}
        <div class="ws-name"><b>${esc(isKR(x.sym) ? x.name || x.sym.slice(0, 6) : x.sym)}</b><small>${isKR(x.sym) ? `${x.sym.endsWith('.KQ') ? '코스닥' : '코스피'} · ${x.sym.slice(0, 6)} · ` : ''}${x.n}명이 추가</small></div><button type="button" class="ws-btn add" data-wpop="${esc(x.sym)}">+ 추가</button></li>`).join('')}</ul>`;
  }
  // 인기 종목에서 추가: 회사 이름을 찾아서 넣는다
  async function addPopular(sym, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    let meta = {};
    if (isKR(sym)) { addWatch(sym, { name: await krName(sym) || sym.slice(0, 6), exchange: sym.endsWith('.KQ') ? 'KOSDAQ' : 'KOSPI' }); return; }
    try {
      const r = (await getJ(`${NEWS_API}/lookup?q=${encodeURIComponent(sym)}`, 8000)).results || [];
      const m = r.find((x) => x.symbol === sym);
      if (m) meta = { name: m.name, exchange: m.exchange };
    } catch {}
    addWatch(sym, meta);
  }
  // 한국 상장 종목 목록(assets/krx.json · tools/fetch_krx.py) — 한글이나 숫자로 찾을 때 처음 한 번 받는다
  let krxList = null;
  const loadKrx = () => (krxList ||= fetch('assets/krx.json?v=2', { cache: 'force-cache' }).then((r) => r.json()).catch(() => { krxList = null; return []; }));
  const krName = async (sym) => (await loadKrx()).find((r) => `${r[0]}.${r[2]}` === sym)?.[1] || null;
  // 배당·포트폴리오 입력칸: 미국 티커는 그대로, 6자리 종목코드나 한글 회사명은 한국 종목으로 바꾼다
  async function resolveTicker(raw) {
    const t = String(raw || '').trim().toUpperCase();
    if (!t || TICKER_RE.test(t)) return t;
    if (/^[0-9A-Z]{6}$/.test(t) || /[가-힣]/.test(t)) {
      const L = await loadKrx(), q = t.replace(/\s+/g, '');
      const hit = L.find((r) => r[0] === t) || L.find((r) => r[1].toUpperCase().replace(/\s+/g, '') === q) || krSearch(L, t).find((r) => r.score <= 1);
      if (hit) return Array.isArray(hit) ? `${hit[0]}.${hit[2]}` : hit.symbol;
      if (/[가-힣]/.test(t)) { const U = await usKrSearch(t), u = U.find((r) => r.kr.replace(/\s+/g, '') === q) || (U.length === 1 ? U[0] : null); if (u) return u.symbol; }
    }
    return t;
  }
  // 한글로 찾기: 한국 종목(휴대폰 안 목록)과 미국 종목(테슬라→TSLA, 서버가 네이버 증권에서 찾음)을 함께 보여준다
  const usKrSearch = async (q) => (/[가-힣ㄱ-ㅎ]/.test(q) ? (await getJ(`${NEWS_API}/lookup?q=${encodeURIComponent(q.trim())}`, 10000).catch(() => null))?.results || [] : []);
  async function krUsSearch(q) {
    const t = q.trim().replace(/\s+/g, '');
    const [kr, us] = await Promise.all([loadKrx().then((L) => krSearch(L, q)), usKrSearch(q)]);
    const sc = (n) => { n = String(n || '').replace(/\s+/g, ''); return n === t ? 0 : n.startsWith(t) ? 1 : 2; };
    const U = us.map((r) => ({ ...r, score: sc(r.kr), us: true }));
    // 같은 점수면 미국 종목을 먼저(마이크로 → 마이크로소프트가 소형 코스닥 종목보다 위)
    return [...U, ...kr].sort((a, b) => a.score - b.score || (b.us ? 1 : 0) - (a.us ? 1 : 0)).slice(0, 25);
  }
  function krSearch(list, q) {
    const t = q.trim().toUpperCase().replace(/\s+/g, ''), out = [];
    for (const [code, name, mk, cap, kind] of list) {
      const n = name.toUpperCase().replace(/\s+/g, '');
      const score = n === t ? 0 : code === t ? 0 : n.startsWith(t) ? 1 : code.startsWith(t) ? 1.5 : n.includes(t) ? 2 : -1;
      if (score >= 0) out.push({ symbol: `${code}.${mk}`, name, exchange: mk === 'KQ' ? 'KOSDAQ' : 'KOSPI', code, score, cap: cap || 0, etf: kind === 'E' });
    }
    return out.sort((a, b) => a.score - b.score || b.cap - a.cap).slice(0, 25);
  }
  function watchSearch(q) {
    clearTimeout(watchSearchTimer);
    if (!q.trim()) { watchResults = []; renderWatchSheet(); return; }
    watchSearchTimer = setTimeout(async () => {
      watchResults = null; renderWatchSheet();
      const korean = /[가-힣ㄱ-ㅎ]/.test(q) || /^\s*\d/.test(q);
      if (korean) { watchResults = await krUsSearch(q); if ((document.getElementById('watch-q')?.value || '') === q) renderWatchSheet(); return; }
      try { watchResults = (await getJ(`${NEWS_API}/lookup?q=${encodeURIComponent(q.trim())}`, 10000)).results || []; } catch { watchResults = []; }
      if ((document.getElementById('watch-q')?.value || '') === q) renderWatchSheet();
    }, 300);
  }
  function addWatch(sym, meta = {}) {
    if (!SYM_OK.test(sym) || WATCH.includes(sym)) return;
    if (!BUILTIN.includes(sym)) { watchCfg.custom[sym] = { name: meta.name || sym, exchange: meta.exchange || '' }; registerStock(sym); }
    WATCH.push(sym);
    const F = watchCfg.folders.find((x) => x.id === curFolder());
    if (F && !F.syms.includes(sym)) F.syms.push(sym);
    saveWatch();
    afterWatchChange(sym);
    toast(`✓ ${esc(symLabel(sym))} 추가 · 홈 상단에서 고를 수 있어요`);
  }
  function removeWatch(sym) {
    if (WATCH.length < 2) return;
    WATCH = WATCH.filter((s) => s !== sym);
    saveWatch();
    if (state.stock === sym) setStock(WATCH[0]);
    afterWatchChange();
  }
  function moveWatch(i, d) {
    const j = i + d;
    if (j < 0 || j >= WATCH.length) return;
    [WATCH[i], WATCH[j]] = [WATCH[j], WATCH[i]];
    saveWatch();
    afterWatchChange();
  }
  function afterWatchChange(added) {
    const sw = document.getElementById('stock-switch');
    if (sw) sw.dataset.built = '';
    renderStockSwitch();
    renderWatchSheet();
    refreshFireTickers(); // Fire 보유 종목 선택지도 관심 종목에 맞춘다
    sendPicks();
    if (added) {
      liveSubscribe(added);
      checkBinance(added);
      loadQuote().then(renderStockSwitch).catch(() => {});
      syncNow(stockParts(added), { sym: added, quiet: true }).then(() => { renderStockSwitch(); if (state.stock === added) renderStock(); }).catch(() => {});
    }
  }
  // 바이낸스에 24시간 주식 선물이 있으면 CRCL처럼 바이낸스 가격으로
  let bnEquities = null;
  async function checkBinance(sym) {
    if (BN24[sym] || !STOCK_INFO[sym]?.custom) return;
    try {
      bnEquities ||= (async () => {
        const c = readJSON('cw.bnEq', null);
        if (c && Date.now() - c.at < 86400000) return new Set(c.list);
        const j = await bnGet('exchangeInfo');
        const list = j.symbols.filter((x) => x.status === 'TRADING' && /TRADIFI/i.test(x.contractType || '') && x.symbol.endsWith('USDT')).map((x) => x.symbol);
        writeJSON('cw.bnEq', { at: Date.now(), list });
        return new Set(list);
      })();
      const set = await bnEquities;
      if (set.has(sym + 'USDT')) { BN24[sym] = sym + 'USDT'; bDisconnect(); bConnect(); bxSnapshot(sym).then(() => { renderStockSwitch(); if (state.stock === sym) renderStock(); }).catch(() => {}); }
    } catch {}
  }
  function liveSubscribe(sym) {
    if (isKR(sym)) return; // 한국 종목은 네이버 시세(15초)로
    if (!YF_SYMS.includes(sym)) YF_SYMS.push(sym);
    try { if (yws?.readyState === 1) yws.send(JSON.stringify({ subscribe: [sym] })); } catch {}
  }

  const REL_KO = (r) => String(r || '').replace(/Chief Executive Officer|CEO/i, 'CEO').replace(/Chief Financial Officer|CFO/i, 'CFO').replace(/^Officer$/i, '임원').replace(/^Director$/i, '이사').replace(/Beneficial Owner.*|10% Owner/i, '대주주').replace(/President/i, '사장');
  const TX_KO = (t) => ({ 'Automatic Sell': '자동 매도', Sell: '매도', 'Sell (Non Open Market)': '매도(장외)', Buy: '매수', 'Automatic Buy': '자동 매수', 'Option Execute': '스톡옵션 행사', Gift: '증여', Disposition: '처분', Acquisition: '취득', 'Acquisition (Non Open Market)': '취득(장외)', 'Disposition (Non Open Market)': '처분(장외)' }[t] || t || '');
  function renderInsider(sym = state.stock, id = sym === 'CRCL' ? 'insider' : 'sinsider') {
    if (!document.getElementById('c-' + id)) return;
    const I = state.analyst?.[sym]?.insider, S = STOCK_INFO[sym];
    const title = '내부자 매매';
    if (!I) { card(id, { title, info: INFO.insider, body: `<p class="skeleton">${state.analyst?.[sym] ? '내부자 매매 자료가 없어요.' : '불러오는 중…'}</p>` }); return; }
    const sh = (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${unit(Math.abs(v))}주`);
    const rows = (I.recent || []).slice(0, 8).map((r) => {
      const sell = /sell|dispos/i.test(r.type), buy = /buy|acqui/i.test(r.type) && !/option/i.test(r.type);
      return `<li><div class="h-name"><b>${esc(titleCase(r.name))}</b><small>${esc(REL_KO(r.rel))} · ${r.d ? md(isoToTs(r.d)) : ''}</small></div>
        <div class="h-sh"><b class="${sell ? 'down' : buy ? 'up' : ''}">${esc(TX_KO(r.type))}</b><small>${r.price ? price(r.price) : ''}</small></div>
        <div class="h-chg"><span class="${sell ? 'down' : buy ? 'up' : ''}">${sell ? '-' : buy ? '+' : ''}${unit(r.shares)}주</span><small>보유 ${unit(r.held)}주</small></div></li>`;
    }).join('');
    card(id, {
      title, sub: `${S.short} · 임원·이사·대주주의 실제 매매(SEC Form 4) · Nasdaq 집계`, info: INFO.insider,
      body: `<div class="tbl-wrap"><table class="ins-tbl">
          <thead><tr><th></th><th>최근 3개월</th><th>최근 12개월</th></tr></thead>
          <tbody>
            <tr><td>장내 매수</td><td>${I.buys?.m3 ?? '–'}건 <small>${sh(I.bought?.m3)}</small></td><td>${I.buys?.m12 ?? '–'}건 <small>${sh(I.bought?.m12)}</small></td></tr>
            <tr><td>매도</td><td>${I.sells?.m3 ?? '–'}건 <small>${sh(I.sold?.m3 != null ? -I.sold.m3 : null)}</small></td><td>${I.sells?.m12 ?? '–'}건 <small>${sh(I.sold?.m12 != null ? -I.sold.m12 : null)}</small></td></tr>
            <tr class="today"><td>순매매</td><td class="${cls(I.net?.m3)}">${sh(I.net?.m3)}</td><td class="${cls(I.net?.m12)}">${sh(I.net?.m12)}</td></tr>
          </tbody></table></div>
        ${more(id + ':more', `최근 거래${(I.recent || []).length ? ` ${Math.min(8, I.recent.length)}건` : ''} 보기`)}
        ${rows ? `<ul class="h-list ins-list">${rows}</ul>` : ''}
        <p class="note">임원 매도는 세금·분산 목적이 많고, <b>자동 매도</b>는 미리 정해 둔 계획(10b5-1)에 따른 것이라 의미가 작아요. 반대로 <b>장내 매수</b>는 회사 전망을 좋게 본다는 신호로 여겨져요. 스톡옵션 행사는 매매 의사와 무관해요.</p></details>`,
    });
  }

  // ---------------------------------------------------------------- JOBY: FAA 형식 인증 현황
  // 기본값은 data/faa-joby.json(검증해 넣은 값), 서버가 새 주주서한에서 자동으로 읽은 값이 더 새로우면 그걸 쓴다
  function faaData() {
    const F = state.faa, A = state.facts?.faa;
    if (!F || !A?.ok || !(A.asOf > F.asOf)) return F;
    const stages = F.stages.map((s) => {
      const [j, f] = A.stages[s.n] || [s.joby, s.faa];
      return { ...s, joby: j, faa: f, status: j === 100 && f === 100 ? 'done' : s.n <= 3 ? s.status : 'active' };
    });
    const [y, m, d] = A.asOf.split('-').map(Number);
    const history = [...(F.history || []), { label: `${m}/${d} 서한`, asOf: A.asOf, s5: A.stages[5] }];
    return { ...F, stages, history, asOf: A.asOf, auto: true, source: { label: `Joby 주주서한(${md(isoToTs(A.filed))}) · 자동 반영`, date: A.filed, url: A.url } };
  }
  // 형식 인증(Type Certificate) 취득 소식이 뉴스·발표에 나오면 바로 알려 준다(인증 %보다 빠름)
  const TC_RE = /type certificat|형식 ?인증/i, TC_WIN_RE = /\b(award|receiv|grant|earn|secur|obtain|win|wins|won)|취득|획득|받았|받아|승인/i, TC_NOT_RE = /stage|단계|progress|진행|toward|path|plan|expect|예상|목표/i;
  function faaUpdateNotice() {
    const F = faaData(), A = state.facts?.faa, fl = st('JOBY').news?.filings || [];
    if (!F) return '';
    const tc = newsItems('JOBY').find((i) => i.kind !== 'filing' && TC_RE.test(i.title) && TC_WIN_RE.test(i.title) && !TC_NOT_RE.test(i.title) && Date.now() - i.t < 14 * 86400000);
    const tcHtml = tc ? `<a class="faa-notice good" href="${safeUrl(tc.url)}" target="_blank" rel="noopener">🎉 형식 인증 취득 소식: ${esc(tc.title)} (${esc(tc.source)}) →</a>` : '';
    if (A && !A.ok && A.filed > F.source.date) {
      return tcHtml + `<a class="faa-notice" href="${safeUrl(A.url)}" target="_blank" rel="noopener">🔔 ${md(isoToTs(A.filed))} 새 주주서한이 나왔는데 인증 차트 숫자를 자동으로 읽지 못했어요. Claude에게 "FAA 수치 업데이트해줘"라고 말해 주세요 →</a>`;
    }
    const er = fl.find((f) => /^8-K/.test(f.form) && /2\.02/.test(f.items || ''));
    if (!A && er && Date.parse(er.d) > Date.parse(F.source.date) + 3 * 86400000) {
      return tcHtml + `<a class="faa-notice" href="${safeUrl(er.url)}" target="_blank" rel="noopener">🔔 ${md(isoToTs(er.d))}에 새 실적 발표가 나왔어요. 서버가 곧 인증 수치를 자동으로 읽어 반영해요(최대 3시간) →</a>`;
    }
    return tcHtml;
  }
  function renderFaa() {
    const F = faaData();
    if (!F) { card('faa', { title: 'FAA 형식 인증 현황', body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const cur = [...F.stages].reverse().find((s) => s.status === 'active') || F.stages.at(-1);
    const bars = F.stages.map((s) => {
      const done = s.status === 'done';
      return `<div class="faa-stage ${s.status}">
        <div class="faa-sh"><span class="faa-n">${done ? '✓' : s.n}</span><b>${s.n}단계 · ${esc(s.name)}</b><small>${esc(s.en)}</small></div>
        <div class="faa-bars">
          <div><span>Joby</span><i><em style="width:${s.joby}%"></em></i><b>${s.joby}%</b></div>
          <div><span>FAA</span><i><em class="f" style="width:${s.faa}%"></em></i><b>${s.faa}%</b></div>
        </div>
        ${s.note ? `<p class="faa-note">${esc(s.note)}</p>` : ''}
      </div>`;
    }).join('');
    const h = F.history || [];
    const trend = h.length > 1 ? `<div class="faa-trend">5단계 추이 <small>(Joby/FAA)</small> ${h.map((x) => `<span>${esc(x.label)} <b>${x.s5[0]}%</b>/${x.s5[1]}%</span>`).join('<i>→</i>')}</div>` : '';
    const ms = F.milestones.map((m) => `<li class="${m.done ? 'done' : 'todo'}"><span class="faa-dot"></span><div><b>${esc(m.date)}</b> ${m.url ? `<a href="${safeUrl(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>` : esc(m.title)}${m.note ? `<small>${esc(m.note)}</small>` : ''}</div></li>`).join('');
    const faaNews = newsItems('JOBY').filter((i) => i.faa && i.kind !== 'filing').slice(0, 3);
    card('faa', {
      title: 'FAA 형식 인증 현황', sub: `${esc(F.asOf)} 기준 · ${esc(F.source.label)}`, info: INFO.faa,
      body: `${faaUpdateNotice()}
        <div class="faa-hero"><span class="faa-big">${cur.n}<small>/5단계</small></span><div><b>${esc(cur.name)} 진행 중${cur.n === 5 ? ' · 마지막 단계' : ''}</b><span>Joby ${cur.joby}% · FAA ${cur.faa}% 완료${F.stages.filter((x) => x.status === 'active').length > 1 ? ' · 4단계와 함께 진행' : ''}</span></div></div>
        <div class="faa-stages">${bars}</div>
        ${trend}
        <div class="mini-h er-h">주요 이정표</div>
        <ul class="faa-ms">${ms}</ul>
        ${faaNews.length ? `<div class="mini-h er-h">최근 FAA·인증 관련 소식</div><ul class="nl faa-nl">${faaNews.map((i) => `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener"><span class="nk related">${i.official ? '공식' : '뉴스'}</span><span class="nt">${esc(i.title)}</span>${i.sum ? `<span class="nsum">${esc(i.sum)}</span>` : ''}<span class="nm">${esc(i.source)} · ${dayLabel(i.t)}</span></a></li>`).join('')}</ul>` : ''}
        <p class="note"><a href="${safeUrl(F.source.url)}" target="_blank" rel="noopener">출처: ${esc(F.source.label)}</a> · ${esc(F.caveat || '')}</p>`,
    });
  }

  // ---------------------------------------------------------------- JOBY: 진척 타임라인(확인해 넣은 주요 이정표 + 회사 보도자료 자동 분류)
  const JT_CAT = { all: ['전체', ''], cert: ['인증', '🛂'], flight: ['비행', '✈️'], ops: ['상업 운항', '🏙️'], prod: ['생산', '🏭'], partner: ['협력', '🤝'], etc: ['기타', '📰'] };
  let jtCat = 'all';
  function renderJobyTimeline() {
    const F = faaData(), P = state.facts?.jobyPR || [];
    if (!F && !P.length) { card('jobytl', { title: '조비 진척 타임라인', body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    const curated = (F?.milestones || []).filter((m) => m.done && /^\d{4}-/.test(m.date)).map((m) => ({ d: m.date, title: m.title, url: m.url, cat: /인증|TIA|FAA/.test(m.title) ? 'cert' : /비행/.test(m.title) ? 'flight' : /운항|사업/.test(m.title) ? 'ops' : 'etc', star: true }));
    const items = [...curated, ...P.filter((p) => !curated.some((c) => c.d === p.d || key(c.title) === key(p.title)))].sort((a, b) => (a.d < b.d ? 1 : -1));
    const shown = items.filter((x) => jtCat === 'all' || x.cat === jtCat).slice(0, 24);
    const upcoming = (F?.milestones || []).filter((m) => !m.done);
    const cnt = (k) => (k === 'all' ? items.length : items.filter((x) => x.cat === k).length);
    let lastY = '';
    card('jobytl', {
      title: '조비 진척 타임라인', sub: EN ? `Verified milestones ⭐ + ${P.length} company press releases, auto-sorted` : `확인한 주요 이정표 ⭐ + 회사 보도자료 ${P.length}건 자동 분류`,
      easy: '조비가 실제로 어디까지 왔는지 시간순으로 모았어요. ⭐는 직접 확인해 넣은 핵심 이정표, 나머지는 회사 공식 보도자료 제목을 분야별로 자동 분류한 거예요.',
      body: `${upcoming.length ? `<div class="mini-h er-h">앞으로 남은 큰 단계</div><ul class="faa-ms">${upcoming.map((m) => `<li class="todo"><span class="faa-dot"></span><div><b>${esc(m.title)}</b>${m.note ? ` <small class="dim">${esc(m.note)}</small>` : ''}</div></li>`).join('')}</ul>` : ''}
        <div class="jt-cats" role="group" aria-label="분야">${Object.entries(JT_CAT).filter(([k]) => cnt(k)).map(([k, [l, i]]) => `<button type="button" class="chip-btn sm" data-jtcat="${k}" aria-pressed="${jtCat === k}">${i} ${l} ${cnt(k)}</button>`).join('')}</div>
        <ul class="faa-ms jt-list">${shown.map((x) => { const y = x.d.slice(0, 4), yh = y !== lastY ? `<li class="jt-y">${y}</li>` : ''; lastY = y; return `${yh}<li class="done"><span class="faa-dot"></span><div><b>${+x.d.slice(5, 7)}/${+x.d.slice(8, 10)}</b> <span class="jt-c">${JT_CAT[x.cat]?.[1] || ''} ${JT_CAT[x.cat]?.[0] || ''}</span>${x.star ? ' ⭐' : ''}<br>${x.url ? `<a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</div></li>`; }).join('') || '<li class="empty">이 분야 소식이 아직 없어요.</li>'}</ul>
        <p class="note">보도자료 제목은 회사가 낸 원문(영어) 그대로예요. 분야는 제목의 단어로 자동 분류해서 가끔 어긋날 수 있어요.</p>`,
    });
  }

  // ---------------------------------------------------------------- TEM: 템퍼스 사업 현황(분기 실적 발표 기준)
  // 기본값은 data/tem-kpis.json(확인해 넣은 값), 서버가 새 실적 발표에서 자동으로 읽은 분기가 더 새로우면 맨 앞에 더한다
  const temQ = (q) => (EN ? `Q${q.slice(5)} '${q.slice(2, 4)}` : `'${q.slice(2, 4)} ${q.slice(5)}분기`);
  function temData() {
    const M = state.temk; if (!M?.quarters?.length) return null;
    const A = state.facts?.tem, Q = [...M.quarters];
    if (A?.ok && A.q && !Q.some((x) => x.q === A.q) && A.q > Q[0].q) Q.unshift({ ...A, auto: true, highlights: [] });
    const L = Q[0], ya = Q.find((x) => x.q === `${+L.q.slice(0, 4) - 1}${L.q.slice(4)}`), pv = Q[1];
    const g = (k) => (ya?.[k] && L[k] != null ? L[k] / ya[k] - 1 : null);
    return { M, Q, L, pv, yoy: { revenue: g('revenue'), diagnostics: g('diagnostics'), dataApps: g('dataApps') } };
  }
  function renderTempus() {
    const T = temData();
    if (!T) { card('tempus', { title: '템퍼스 사업 현황', body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const { M, Q, L, pv, yoy } = T, G = M.guidance;
    const dShare = L.diagnostics != null && L.revenue ? L.diagnostics / L.revenue : null;
    const bars = [...Q].reverse(), mx = Math.max(...bars.map((x) => x.revenue || 0)) || 1;
    const usdM = (v) => (v == null ? '–' : `$${v >= 100 ? v.toFixed(0) : v.toFixed(1)}M`);
    card('tempus', {
      title: '템퍼스 사업 현황', sub: EN ? `${temQ(L.q)} earnings (${md(isoToTs(L.filed))}) · SEC${L.auto ? ' · auto-updated' : ''}` : `${temQ(L.q)} 실적 발표(${md(isoToTs(L.filed))}) 기준 · SEC${L.auto ? ' · 자동 반영' : ''}`,
      easy: '템퍼스는 신약을 직접 만들지 않아요. 병원에서 암 환자의 유전자 검사를 해 주고(진단), 그 과정에서 쌓인 개인 정보를 지운 의료 데이터를 제약사에 팔거나 AI 모델을 만들어 제공해요(데이터·앱). 검사가 늘수록 데이터가 쌓이고, 데이터가 쌓일수록 제약사에 팔 것이 많아지는 구조예요.',
      body: `<div class="tem-mix">${dShare != null ? `<div class="tem-bar"><i style="width:${(dShare * 100).toFixed(1)}%"></i><em style="width:${((1 - dShare) * 100).toFixed(1)}%"></em></div>
          <div class="tem-leg"><span><i></i>${EN ? 'Diagnostics (genomic testing)' : '진단(유전자 검사)'} ${usdM(L.diagnostics)} · ${Math.round(dShare * 100)}%</span><span><i class="d"></i>${EN ? 'Data & apps' : '데이터·앱'} ${usdM(L.dataApps)} · ${Math.round((1 - dShare) * 100)}%</span></div>` : ''}</div>
        <div class="ns-grid h-grid">
          <div><span>분기 매출</span><b>${usdM(L.revenue)}</b><small>${yoy.revenue != null ? `전년 대비 <span class="${cls(yoy.revenue)}">${pct(yoy.revenue, 0)}</span>` : ''}</small></div>
          <div><span>데이터·앱 매출</span><b>${usdM(L.dataApps)}</b><small>${yoy.dataApps != null ? `전년 대비 <span class="${cls(yoy.dataApps)}">${pct(yoy.dataApps, 0)}</span>` : ''}${L.insightsGrowth != null ? ` · ${EN ? 'data licensing' : '데이터 라이선스'} +${Math.round(L.insightsGrowth * 100)}%` : ''}</small></div>
          <div><span>종양 검사 건수 증가율</span><b>${L.oncologyGrowth != null ? `+${Math.round(L.oncologyGrowth * 100)}%` : '–'}</b><small>${pv?.oncologyGrowth != null ? `직전 분기 +${Math.round(pv.oncologyGrowth * 100)}%` : '전년 같은 분기 대비'}</small></div>
          <div><span>MRD(재발 감시) 검사</span><b>${L.mrdTests != null ? nf(0).format(L.mrdTests) + '건' : '–'}</b><small>${pv?.mrdTests != null ? `직전 분기 ${nf(0).format(pv.mrdTests)}건` : '분기 검사 건수'}</small></div>
          <div><span>조정 EBITDA</span><b class="${cls(L.adjEbitda)}">${L.adjEbitda != null ? (L.adjEbitda < 0 ? '-' : '+') + usdM(Math.abs(L.adjEbitda)) : '–'}</b><small>${pv?.adjEbitda != null ? `직전 분기 ${pv.adjEbitda < 0 ? '-' : '+'}${usdM(Math.abs(pv.adjEbitda))}` : ''}</small></div>
          <div><span>올해 회사 전망</span><b>${G ? `$${(G.revenueLow / 1000).toFixed(3)}~${(G.revenueHigh / 1000).toFixed(3)}B` : '–'}</b><small>${G ? (EN ? `revenue · adj. EBITDA ~$${G.adjEbitda}M` : `매출 · 조정 EBITDA 약 $${G.adjEbitda}M`) : ''}</small></div>
        </div>
        <div class="mini-h er-h">분기별 매출과 수익성</div>
        <div class="tem-chart">${bars.map((x) => { const h = (v) => `${Math.max(2, ((v || 0) / mx) * 100)}%`; return `<div class="tem-col" title="${temQ(x.q)} 매출 ${usdM(x.revenue)}"><b>${usdM(x.revenue)}</b><div class="tem-stack"><i style="height:${h(x.diagnostics)}"></i><em style="height:${h(x.dataApps)}"></em></div><span>${temQ(x.q).replace('분기', 'Q')}</span><small class="${cls(x.adjEbitda)}">${x.adjEbitda != null ? (x.adjEbitda < 0 ? '−' : '+') + Math.abs(x.adjEbitda).toFixed(1) : '–'}</small></div>`; }).join('')}</div>
        <p class="note">막대: 진단(파랑) + 데이터·앱(주황) 매출 · 아래 숫자: 조정 EBITDA(백만 달러)</p>
        <div class="mini-h er-h">분기별 진척</div>
        <ul class="faa-ms tem-ms">${Q.slice(0, 4).map((x) => `<li class="done"><span class="faa-dot"></span><div><b>${temQ(x.q)}</b> <a href="${safeUrl(x.url)}" target="_blank" rel="noopener">원문</a>${x.highlights?.length ? `<ul class="tem-hl">${x.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '<p class="note">세부 진척은 정리 중이에요</p>'}</div></li>`).join('')}</ul>
        <p class="note">숫자는 회사가 분기마다 SEC에 내는 실적 발표문 기준이에요. 새 발표가 나오면 매출·사업별 매출·조정 EBITDA·검사 지표는 자동으로 반영되고, 진척 소식은 확인 후 더해요. 투자 조언이 아니에요.</p>`,
    });
  }

  // ---------------------------------------------------------------- 종목별 사업 현황(data/biz/<종목>.json — 회사 실적 발표문에서 확인해 넣은 값)
  // 관리자 '인기 종목' 가운데 ETF를 뺀 종목. 파일을 더하면 여기에도 이름을 더한다(build.py가 목록이 맞는지 검사)
  const BIZ_KEYS = new Set(['000270', '000660', '005380', '005930', '086280', 'FRVO', 'GOOGL', 'PANW', 'PLTR', 'PLUG', 'RXRX', 'SHFS', 'TSLA']);
  const bizKey = (sym) => (isKR(sym) ? String(sym).slice(0, 6) : sym);
  // 자동 정리(SEC 재무제표·네이버 분기 실적)를 붙일 종목: 기본 종목(전용 화면이 있음)·ETF는 빼고
  const bizAuto = (sym) => !BUILTIN.includes(sym) && !isEtf(sym) && (isKR(sym) || US_SYM.test(sym));
  // 본 종목의 사업 현황은 이 기기에 30종목까지 저장해 두고, 다시 열면 기다리지 않고 바로 그린다(뒤에서 새로 받음)
  const BIZ_LS = 'cw.bizCache';
  function bizSave(k, v) {
    try {
      const m = readJSON(BIZ_LS, {}) || {};
      m[k] = { t: Date.now(), v };
      const keys = Object.keys(m).sort((a, b) => m[b].t - m[a].t);
      for (const x of keys.slice(30)) delete m[x];
      writeJSON(BIZ_LS, m);
    } catch {}
  }
  function bizLoadCached(k) {
    const S = (state.biz ||= {});
    if (k in S) return;
    const c = (readJSON(BIZ_LS, {}) || {})[k];
    if (c && Date.now() - c.t < 14 * 86400000) S[k] = c.v ? { ...c.v, _t: c.t } : null;
  }
  const BIZ_COLORS = ['#5b9bff', 'var(--accent, #f2994a)', '#3fbf7f', '#b48cff'];
  const tx = (o) => (o ? (EN ? o.en : o.ko) ?? '' : '');
  function bizFmt(B, v, f, u) {
    if (v == null) return '–';
    const sg = v < 0 ? '-' : '', a = Math.abs(v);
    const money = () => (B.cur === 'KRW'
      ? (a < 1 ? (EN ? `${sg}₩${nf(0).format(a * 1000)}B` : `${sg}${nf(0).format(a * 1e4)}억원`) : (EN ? `${sg}₩${a.toFixed(1).replace(/\.0$/, '')}T` : `${sg}${a.toFixed(1).replace(/\.0$/, '')}조원`))
      : a >= 1000 ? `${sg}$${(a / 1000).toFixed(a >= 1e4 ? 1 : 2)}B` : `${sg}$${a >= 100 ? a.toFixed(0) : a >= 1 ? a.toFixed(1) : a.toFixed(2)}M`);
    const num = f === 'px' ? `${sg}$${a.toFixed(2)}` : f === 'n' ? nf(0).format(v) : f === 'd1' ? v.toFixed(1) : f === 'd2' ? v.toFixed(2) : f === 'pctN' ? `${nf(0).format(v)}%` : f === 'pct1' ? `${v.toFixed(1)}%` : money();
    const unit = tx(u);
    return unit ? `${num}${/^[A-Za-z]/.test(unit) ? ' ' : ''}${unit}` : num;
  }
  const bizQ = (B, x) => (x.lb ? tx(x.lb) : EN ? `Q${x.q.slice(5)} '${x.q.slice(2, 4)}` : `'${x.q.slice(2, 4)} ${x.q.slice(5)}분기`);
  const BIZ_MON = ['1~3월', '4~6월', '7~9월', '10~12월'];
  const bizQs = (B, x) => (B.auto ? (EN ? `Q${x.q.slice(5)} '${x.q.slice(2, 4)}` : `'${x.q.slice(2, 4)} ${BIZ_MON[+x.q.slice(5) - 1]}`) : x.lb ? tx(x.lb).replace(/분기$/, 'Q').replace(/^FY(\d\d) (\d)Q$/, '$2Q FY$1') : EN ? `Q${x.q.slice(5)} '${x.q.slice(2, 4)}` : `'${x.q.slice(2, 4)} ${x.q.slice(5)}Q`);
  function renderBiz(sym = state.stock) {
    const el = document.getElementById('c-biz'), k = bizKey(sym);
    if (!el) return;
    const curated = BIZ_KEYS.has(k);
    if (!curated && bizAuto(sym)) bizLoadCached(k);
    el.hidden = !curated && !(bizAuto(sym) && state.biz?.[k]);
    if (el.hidden) return;
    const B = state.biz?.[k], name = (B?.name && tx(B.name)) || STOCK_INFO[sym]?.short || STOCK_INFO[sym]?.name || symLabel(sym);
    const title = EN ? `${esc(name)} business snapshot` : `${esc(name)} 사업 현황`;
    if (!B?.q?.length) { card('biz', { title, body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const Q = B.q, L = Q[0], pv = Q[1], ya = Q.find((x) => x.q === `${+L.q.slice(0, 4) - 1}${L.q.slice(4)}`);
    const g = (a, b) => (a != null && b ? a / Math.abs(b) - (b < 0 ? -1 : 1) : null);
    const chg = (a, b) => (a != null && b != null && b > 0 && a > 0 ? a / b - 1 : null);
    const hasRev = L.rev != null, bar = B.bar || null;
    const nx = !isKR(sym) ? earnOf(sym)?.next?.date : null, today = isoToday();
    const stale = L.filed && daysBetween(L.filed, today) > 98;
    // 최근 발표(분기 실적 뒤에 나온 인도량·잠정 실적 등)
    const flash = (B.flash || []).filter((f) => !L.filed || f.d > L.filed).map((f) => `<div class="biz-flash"><em class="biz-new">${EN ? 'Latest' : '최근'}</em><b>${md(isoToTs(f.d))}</b> ${esc(tx(f))}${f.url ? ` <a href="${safeUrl(f.url)}" target="_blank" rel="noopener">${EN ? 'Source' : '원문'}</a>` : ''}</div>`).join('');
    // 사업별 매출 비중(최근 분기)
    const segs = (B.seg || []).filter((s) => L.seg?.[s.k] != null), segSum = segs.reduce((a, s) => a + L.seg[s.k], 0);
    const mix = segs.length > 1 && segSum > 0 ? `<div class="tem-mix biz-mix"><div class="biz-bar">${segs.map((s, i) => `<i style="width:${((L.seg[s.k] / segSum) * 100).toFixed(1)}%;background:${BIZ_COLORS[i % 4]}"></i>`).join('')}</div>
        <div class="tem-leg biz-leg">${segs.map((s, i) => `<span><i style="background:${BIZ_COLORS[i % 4]}"></i>${esc(tx(s))} ${bizFmt(B, L.seg[s.k])} · ${Math.round((L.seg[s.k] / segSum) * 100)}%</span>`).join('')}</div></div>` : '';
    // 숫자 칸: 매출 · 이익 · 회사별 핵심 지표
    const vsTxt = (cur, base, isYa, pp) => { if (cur == null || base == null) return ''; const d = pp ? cur - base : chg(cur, base); if (d == null) return ''; const t = pp ? `${d >= 0 ? '+' : ''}${d.toFixed(1)}%p` : d >= 9 ? `${nf(0).format(1 + d)}${EN ? 'x' : '배'}` : pct(d, 0); return `${isYa ? (EN ? 'YoY ' : '전년 대비 ') : (EN ? 'QoQ ' : '직전 분기 대비 ')}<span class="${cls(d)}">${t}</span>`; };
    const tiles = [];
    if (hasRev) tiles.push([EN ? 'Quarterly revenue' : '분기 매출', bizFmt(B, L.rev), ya ? vsTxt(L.rev, ya.rev, true) : vsTxt(L.rev, pv?.rev, false), '']);
    if (L.op != null) {
      const mg = hasRev && L.rev ? L.op / L.rev : null;
      const prevOp = ya?.op ?? pv?.op, prevLbl = ya ? (EN ? 'a year ago' : '1년 전') : (EN ? 'prior quarter' : '직전 분기');
      tiles.push([tx(B.profit), bizFmt(B, L.op), [mg != null ? `${EN ? 'margin' : '이익률'} ${(mg * 100).toFixed(mg > -1 && mg < 1 && Math.abs(mg) < 0.1 ? 1 : 0)}%` : '', prevOp != null ? `${prevLbl} ${bizFmt(B, prevOp)}` : ''].filter(Boolean).join(' · '), cls(L.op)]);
    }
    for (const K of B.kpi || []) {
      const v = L.k?.[K.k]; if (v == null) continue;
      const kyv = L.ky?.[K.k], yv = ya?.k?.[K.k], pvv = pv?.k?.[K.k];
      const sm = kyv != null ? `${EN ? 'YoY ' : '전년 대비 '}<span class="${cls(kyv)}">${K.pp ? `${kyv >= 0 ? '+' : ''}${kyv.toFixed(1)}%p` : pct(kyv, 1)}</span>`
        : yv != null && (K.pp || (yv > 0 && v > 0)) ? vsTxt(v, yv, true, K.pp) : pvv != null ? (K.pp || (pvv > 0 && v > 0) ? vsTxt(v, pvv, false, K.pp) : `${EN ? 'prior quarter' : '직전 분기'} ${bizFmt(B, pvv, K.f, K.u)}`) : '';
      tiles.push([tx(K), bizFmt(B, v, K.f, K.u), sm, '']);
    }
    // 분기별 막대(사업별로 쌓기) + 아래 이익
    const CQ = [...Q].reverse().filter((x) => (bar ? x.k?.[bar.k] : x.rev) != null);
    const valOf = (x) => (bar ? x.k[bar.k] : x.rev), mx = Math.max(...CQ.map(valOf)) || 1;
    const stack = !bar && !B.segLatestOnly && segs.length > 1;
    const chart = CQ.length > 1 ? `<div class="mini-h er-h">${bar ? `${EN ? 'Quarterly' : '분기별'} ${esc(tx(bar))}${EN ? ' & ' : '과 '}${esc(tx(B.profit))}` : EN ? 'Quarterly revenue & profit' : '분기별 매출과 이익'}</div>
        <div class="tem-chart biz-chart">${CQ.map((x) => { const h = (v) => `${Math.max(2, ((v || 0) / mx) * 100)}%`; return `<div class="tem-col"><b>${bizFmt(B, valOf(x)).replace(/억원$|조원$/, (m) => m[0])}</b><div class="tem-stack biz-stack">${stack && x.seg ? (B.seg || []).map((s, i) => { const sx = (B.seg || []).reduce((a, t) => a + (x.seg[t.k] || 0), 0) || 1; return `<i style="height:${(((x.seg[s.k] || 0) / sx) * (valOf(x) / mx) * 100).toFixed(2)}%;background:${BIZ_COLORS[i % 4]}"></i>`; }).join('') : `<i style="height:${h(valOf(x))};background:${BIZ_COLORS[0]}"></i>`}</div><span>${bizQs(B, x)}</span><small class="${cls(x.op)}">${x.op != null ? bizFmt(B, x.op).replace(/억원$|조원$/, (m) => m[0]) : '–'}</small></div>`; }).join('')}</div>
        <p class="note">${stack ? `${EN ? 'Bars' : '막대'}: ${(B.seg || []).map((s, i) => `<span class="biz-dot" style="background:${BIZ_COLORS[i % 4]}"></span>${esc(tx(s))}`).join(' + ')} · ` : ''}${EN ? 'number below' : '아래 숫자'}: ${esc(tx(B.profit))}</p>` : '';
    const hlQ = Q.filter((x) => x.hl?.length).slice(0, 4);
    const sub = `${B.auto ? `<span class="biz-auto">${EN ? 'Auto' : '자동 정리'}</span>` : ''}${bizQ(B, L)} ${EN ? 'results' : '실적'}${L.filed ? ` (${md(isoToTs(L.filed))})` : ''} · ${esc(tx(B.src))}${nx && nx >= today ? ` · ${EN ? 'next' : '다음 실적'} ${md(isoToTs(nx))}` : ''}`;
    card('biz', {
      title, sub, easy: esc(tx(B.easy)),
      body: `${flash}${mix}
        <div class="ns-grid h-grid biz-n${tiles.length <= 4 ? tiles.length : tiles.length <= 6 ? 3 : 4}">${tiles.map(([l, v, s, c]) => `<div><span>${esc(l)}</span><b class="${c}">${v}</b><small>${s || '&nbsp;'}</small></div>`).join('')}</div>
        ${B.guide ? `<p class="biz-guide">🎯 <b>${EN ? 'Company outlook' : '회사 전망'}</b> ${esc(tx(B.guide))}</p>` : ''}
        ${chart}
        ${hlQ.length ? `<div class="mini-h er-h">${EN ? 'What happened each quarter' : '분기별 주요 소식'}</div>
        <ul class="faa-ms tem-ms">${hlQ.map((x) => `<li class="done"><span class="faa-dot"></span><div><b>${bizQ(B, x)}</b>${x.url ? ` <a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${EN ? 'Source' : '원문'}</a>` : ''}<ul class="tem-hl">${x.hl.map((h) => `<li>${esc(tx(h))}</li>`).join('')}</ul></div></li>`).join('')}</ul>` : ''}
        <p class="note">${stale ? `${EN ? 'A newer quarter may already be out — it will be added after review. ' : '새 분기 실적이 나왔을 수 있어요 — 확인 후 더할게요. '}` : ''}${B.fy ? esc(tx(B.fy)) + '. ' : ''}${B.auto ? (EN ? 'Compiled automatically from reported quarterly financials and refreshed weekly. Business mix and quarterly highlights are hand-checked for featured stocks only. Not investment advice.' : '회사가 공시한 분기 재무제표를 자동으로 정리했고 매주 새로 받아요. 사업별 비중·분기별 소식은 대표 종목만 직접 확인해 정리해요. 투자 조언이 아니에요.') : EN ? 'Figures are from the company’s own earnings releases (see Source); new quarters are added after review. Not investment advice.' : '숫자는 회사가 낸 실적 발표 기준이에요(원문 링크). 새 분기는 확인 후 더해요. 투자 조언이 아니에요.'}</p>`,
    });
  }

  // ---------------------------------------------------------------- SPCX: 보호예수(락업) 해제 일정
  const addTradingDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); let k = 0; while (k < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) k++; } return d.toISOString().slice(0, 10); };
  // 실적 발표에 연동된 해제일은 다음 실적 발표 예정일 + 2거래일로 추정
  function lockupEvents() {
    const F = state.spcx;
    if (!F) return [];
    const E = st('SPCX').earn, N = E?.next;
    return F.lockup.map((e) => {
      if (e.date) return { ...e, est: false };
      const done = (E?.quarters || []).find((q) => q.end === e.quarter && q.reportedOn) || (E?.surprises || []).find((q) => q.end === e.quarter && q.reported);
      if (done) return { ...e, date: addTradingDays(done.reportedOn || done.reported, 2), est: false }; // 이미 발표된 분기: 실제 발표일 기준
      if (N?.date && N.quarter === e.quarter) return { ...e, date: addTradingDays(N.date, 2), est: true };
      return { ...e, date: null, est: true };
    });
  }
  // 보호예수 관련 새 공시(면제·조기 해제·추가 매도 등록)·뉴스가 있으면 카드 위에 알림
  const LOCK_NEWS_RE = /lock-?up|보호예수|락업|의무보유|secondary offering|추가 매도|블록딜|block trade/i;
  function lockupNotice() {
    const F = state.spcx, L = (state.facts?.spcxLock || []).filter((x) => x.d > (F?.asOf || ''));
    const fl = L.map((x) => `<a class="faa-notice" href="${safeUrl(x.url)}" target="_blank" rel="noopener">🔔 ${md(isoToTs(x.d))} ${x.kind === 'lockup' ? '보호예수 변경 관련 공시' : '주식 추가 매도·발행 등록 공시'}(Form ${esc(x.form)}) — 아래 일정이 바뀌었을 수 있어요 →${x.snippet ? `<small>${esc(x.snippet.slice(0, 180))}…</small>` : ''}</a>`).join('');
    const nw = newsItems('SPCX').filter((i) => i.kind !== 'filing' && LOCK_NEWS_RE.test(i.title) && Date.now() - i.t < 14 * 86400000).slice(0, 3);
    return fl + (nw.length ? `<div class="mini-h er-h">최근 보호예수 관련 뉴스</div><ul class="nl faa-nl">${nw.map((i) => `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener"><span class="nk related">뉴스</span><span class="nt">${esc(i.title)}</span>${i.sum ? `<span class="nsum">${esc(i.sum)}</span>` : ''}<span class="nm">${esc(i.source)} · ${dayLabel(i.t)}</span></a></li>`).join('')}</ul>` : '');
  }
  const nextLockup = () => { const t = todayIso(); return lockupEvents().filter((e) => !e.skipped && e.date && e.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0] || null; };
  function renderLockup() {
    const F = state.spcx;
    if (!F) { card('lockup', { title: '보호예수 해제 일정', body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const ev = lockupEvents(), t = todayIso(), nx = nextLockup();
    const q = pq('SPCX'), ip = F.ipo;
    const done = ev.filter((e) => !e.skipped && e.date && e.date < t).reduce((s, e) => s + e.shares, 0);
    const left = ev.filter((e) => !e.skipped && !(e.date && e.date < t)).reduce((s, e) => s + e.shares, 0);
    const dd = nx ? dday(nx.date) : null;
    const dLabel = (e) => (e.date ? `${md(isoToTs(e.date))}${e.est ? '(예상)' : ''}` : '실적 발표 후');
    const list = ev.map((e) => {
      const isDone = e.date && e.date < t;
      const k = e.skipped ? 'skip' : isDone ? 'done' : e === nx || (nx && e.date === nx.date && e.shares === nx.shares) ? 'next' : 'todo';
      return `<li class="${k}"><span class="faa-dot"></span><div><b>${dLabel(e)}</b> ${esc(e.label)} <span class="lk-sh">${e.skipped ? '0주' : '최대 ' + unit(e.shares) + '주'}</span>${e.note ? `<small>${esc(e.note)}</small>` : ''}</div></li>`;
    }).join('');
    card('lockup', {
      title: '보호예수 해제 일정', sub: `${md(isoToTs(ip.date))} 상장 · 공모가 ${price(ip.price)} · 투자설명서 기준`, info: INFO.lockup,
      body: `${lockupNotice()}${nx ? `<div class="lk-next">
          <div class="er-next-h"><span>다음 해제</span><span class="tone ${dd <= 7 ? 'neg' : 'neu'}">${dd === 0 ? '오늘' : `D-${dd}`}</span></div>
          <div class="er-next-d"><b>${krDate(nx.date)}${nx.est ? ' (예상)' : ''}</b><span class="er-dday">${unit(nx.shares)}주</span></div>
          <div class="er-next-m">${esc(nx.label)}${q?.price ? ` · 현재가로 약 <b>${usd(nx.shares * q.price)}</b>` : ''}${nx.note ? ` · ${esc(nx.note)}` : ''}</div>
        </div>` : ''}
        <div class="ns-grid er-grid">
          <div><span>공모가 대비</span><b class="${cls(q?.price ? q.price / ip.price - 1 : null)}">${q?.price ? pct(q.price / ip.price - 1, 1) : '–'}</b><small>${price(ip.price)} → ${price(q?.price)}</small></div>
          <div><span>공모 주식 수</span><b>${unit(ip.shares)}주</b><small>${esc(ip.exchange)}</small></div>
          <div><span>지금까지 해제</span><b>${unit(done)}주</b><small>보호예수 풀린 최대 물량</small></div>
          <div><span>앞으로 해제</span><b>${unit(left)}주</b><small>머스크 보유분 ${unit(6.4e9)}주 포함</small></div>
        </div>
        <ul class="faa-ms lk-ms">${list}</ul>
        <p class="note">${esc(F.caveat)} 일론 머스크 의결권 약 ${pctPlain(ip.muskVoting)}. <a href="${safeUrl(ip.source.url)}" target="_blank" rel="noopener">출처: ${esc(ip.source.label)}</a></p>`,
    });
  }

  // ---------------------------------------------------------------- 실적: 적자 성장 기업(JOBY) — 현금·소진 속도가 핵심
  function sRunway(E) {
    const Q = (E?.quarters || []).filter((q) => q.liquidity != null);
    const last = Q.at(-1);
    const burns = (E?.quarters || []).filter((q) => q.burn != null).slice(-2).map((q) => -q.burn);
    const burn = burns.length ? burns.reduce((a, b) => a + b, 0) / burns.length : null;
    return last && burn > 0 ? { liq: last.liquidity, end: last.end, burn, quarters: last.liquidity / burn } : null;
  }
  function nextEarnHtml(N, extra = '', sym) {
    if (!N?.date) return sym ? earnSumBlock(sym) + voteBlock(sym) : '';
    const dd = dday(N.date);
    return `${sym ? earnSumBlock(sym) : ''}
      <div class="er-next">
        <div class="er-next-h"><span>다음 실적 발표</span>${N.estimated ? '<span class="tone neu">예상일</span>' : '<span class="tone pos">확정</span>'}</div>${N.confirmedBy ? `<a class="er-src" href="${safeUrl(N.confirmedBy.url)}" target="_blank" rel="noopener">📢 ${+N.confirmedBy.on.slice(5, 7)}/${+N.confirmedBy.on.slice(8)} 회사 발표로 확정 · ${esc(N.confirmedBy.title.slice(0, 80))}</a>` : ''}
        <div class="er-next-d"><b>${krDate(N.date)}</b><span class="er-dday">${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '발표 완료'}</span></div>
        <div class="er-next-m">${N.quarter ? qLabelLong(N.quarter) + ' 실적 · ' : ''}예상 EPS <b>${N.consensus != null ? '$' + N.consensus.toFixed(2) : '–'}</b>${N.low != null ? ` (범위 $${N.low.toFixed(2)}~$${N.high.toFixed(2)}${N.analysts ? `, ${N.analysts}명` : ''})` : ''}${N.lastYearEps != null ? ` · 작년 같은 분기 $${N.lastYearEps.toFixed(2)}` : ''}</div>
        ${extra}
      </div>${sym ? voteBlock(sym) : ''}`;
  }
  const earnSkeleton = (sym, id) => card(id, { title: `${STOCK_INFO[sym].short} 실적`, info: INFO.searnings, body: `<p class="skeleton">${st(sym).earnErr ? '실적을 불러오지 못했습니다. 새로고침으로 다시 시도하세요.' : '실적 불러오는 중…'}</p>` });
  const epsCell = (q) => `${q.eps != null ? '$' + q.eps.toFixed(2) : '–'}${q.consensus != null ? `<span class="dim" style="display:block;font-size:10.5px">예상 ${q.consensus.toFixed(2)}</span>` : ''}`;

  function renderBurnEarnings(sym = 'JOBY') {
    const E = st(sym).earn;
    if (!E) return earnSkeleton(sym, 'searnings');
    const Q = E.quarters || [];
    const last = Q.at(-1), prev = Q.at(-2);
    const sur = (E.surprises || []).find((s) => s.end === last?.end);
    const rw = sRunway(E);
    card('searnings', {
      title: '조비 실적', sub: (last ? `최근 발표 ${last.reportedOn ? md(isoToTs(last.reportedOn)) : ''} · ${qLabelLong(last.end)} · SEC·Nasdaq` : 'SEC·Nasdaq') + repDoc(sym), info: INFO.jearnings,
      body: `${nextEarnHtml(E.next, '<p class="note">실적 발표 때 주주서한에 <b>FAA 인증 단계별 진행률</b>도 함께 공개돼요.</p>', sym)}
        ${last ? `<div class="ns-grid er-grid">
          <div><span>현금·단기투자</span><b>${usdS2(last.liquidity)}</b><small>${rw ? `최근 2분기 평균 소진 ${usd(rw.burn)} → 약 <b>${(rw.quarters / 4).toFixed(1)}년</b> 버틸 수 있음` : '–'}</small></div>
          <div><span>분기 현금 소진</span><b class="down">${usdS2(last.burn)}</b><small>영업현금흐름 + 설비투자 · 전분기 ${usdS2(prev?.burn)}</small></div>
          <div><span>매출</span><b>${usdS2(last.revenue)}</b><small>전분기 ${sp(last.revenue != null && prev?.revenue ? last.revenue / prev.revenue - 1 : null)} · 헬기 여객(Blade) 포함</small></div>
          <div><span>순손실</span><b class="down">${usdS2(last.netIncome)}</b><small>영업손실 ${usdS2(last.opIncome)}</small></div>
          <div><span>EPS(주당순이익)</span><b>${last.eps != null ? '$' + last.eps.toFixed(2) : '–'}</b><small>${sur ? `예상 $${sur.consensus.toFixed(2)} · ${sur.surprise >= 0 ? '예상보다 양호' : '예상보다 부진'} ${sp(sur.eps >= 0 ? sur.surprise : -sur.surprise)}` : '예상치 없음'}</small></div>
          <div><span>연구개발비</span><b>${usdS2(last.rnd)}</b><small>인증·생산 준비 비용 · 판관비 ${usdS2(last.sga)}</small></div>
        </div>` : ''}
        <div class="mini-h er-h">현금·단기투자 잔고</div>
        <div class="chart short"><canvas id="cv-ser-cash" role="img" aria-label="분기별 현금 잔고"></canvas></div>
        <div class="pair er-pair">
          <div><div class="mini-h er-h">분기 순손실</div><div class="chart"><canvas id="cv-ser-ni" role="img" aria-label="분기별 순손실"></canvas></div></div>
          <div><div class="mini-h er-h">분기 매출</div><div class="chart"><canvas id="cv-ser-rev" role="img" aria-label="분기별 매출"></canvas></div></div>
        </div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>분기</th><th>매출</th><th>순손실</th><th>현금 소진</th><th>EPS</th></tr></thead>
          <tbody>${Q.slice().reverse().map((q, i) => `<tr${i === 0 ? ' class="today"' : ''}><td>${qLabel(q.end)}</td><td>${usdS2(q.revenue)}</td><td class="${q.netIncome < 0 ? 'down' : ''}">${usdS2(q.netIncome)}</td><td>${usdS2(q.burn)}</td><td>${epsCell(q)}</td></tr>`).join('')}</tbody></table></div>
        <p class="note">조비는 아직 상업 운항 전이라 적자가 정상이에요. <b>현금이 몇 년 버틸 수 있는지</b>와 <b>FAA 인증 속도</b>가 핵심 지표예요. 2025년 3분기부터 매출에 헬기 여객 사업(Blade) 인수분이 포함돼요.</p>`,
    });
    const labels = Q.map((q) => qLabel(q.end));
    const tipQ = (it) => qLabelLong(Q[it.dataIndex].end);
    const CQ = Q.filter((q) => q.liquidity != null);
    draw('ser-cash', {
      type: 'bar',
      data: { labels: CQ.map((q) => qLabel(q.end)), datasets: [{ label: '현금·단기투자', data: CQ.map((q) => q.liquidity), backgroundColor: C.teal, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 30 }] },
      options: { interaction, plugins: { ...noLegend, tooltip: tooltip((it) => qLabelLong(CQ[it.dataIndex].end), usd) }, scales: { x: axisX(CQ.map((q) => qLabel(q.end)), (v) => v, 8), y: axisY(usd, { beginAtZero: true }) } },
    });
    niRevCharts(Q, labels, tipQ);
  }
  function niRevCharts(Q, labels, tipQ) {
    draw('ser-ni', {
      type: 'bar',
      data: { labels, datasets: [{ label: '순손익', data: Q.map((q) => q.netIncome), backgroundColor: Q.map((q) => (q.netIncome < 0 ? C.orange : C.teal)), borderRadius: 3, borderSkipped: false, maxBarThickness: 18 }] },
      options: { interaction, plugins: { ...noLegend, tooltip: tooltip(tipQ, usdS2) }, scales: { x: axisX(labels, (v) => v, 4), y: axisY((v) => usdS2(v)) } },
    });
    draw('ser-rev', {
      type: 'bar',
      data: { labels, datasets: [{ label: '매출', data: Q.map((q) => q.revenue), backgroundColor: C.blue, borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: 'bottom', maxBarThickness: 18 }] },
      options: { interaction, plugins: { ...noLegend, tooltip: tooltip(tipQ, usdS2) }, scales: { x: axisX(labels, (v) => v, 4), y: axisY(usd, { beginAtZero: true }) } },
    });
  }

  // ---------------------------------------------------------------- 실적: 성장 기업(SPCX·TEM) — 매출 성장·이익률 중심
  const yoyQ = (Q, q) => { if (!q) return null; const ya = Q.find((x) => x.end === `${+q.end.slice(0, 4) - 1}${q.end.slice(4)}`); return q.revenue != null && ya?.revenue ? q.revenue / ya.revenue - 1 : null; };
  const gmQ = (q) => (!q?.revenue ? null : q.grossProfit != null ? q.grossProfit / q.revenue : q.cost != null ? (q.revenue - q.cost) / q.revenue : null);
  function renderGrowthEarnings(sym) {
    const S = STOCK_INFO[sym], E = st(sym).earn;
    if (!E) return earnSkeleton(sym, 'searnings');
    const Q = E.quarters || [];
    const last = Q.at(-1), prev = Q.at(-2);
    const sur = (E.surprises || []).find((s) => s.end === last?.end);
    const yoy = yoyQ(Q, last), qoq = last?.revenue != null && prev?.revenue ? last.revenue / prev.revenue - 1 : null;
    const g = gmQ(last), gPrev = gmQ(prev);
    const opm = last?.opIncome != null && last.revenue ? last.opIncome / last.revenue : null;
    const turn = prev?.netIncome != null && last?.netIncome != null ? (prev.netIncome < 0 && last.netIncome > 0 ? '<span class="up">흑자 전환</span>' : prev.netIncome > 0 && last.netIncome < 0 ? '<span class="down">적자 전환</span>' : '') : '';
    const Y = E.ytd;
    const ytdLbl = Y ? `${+Y.start.slice(5, 7)}~${+Y.end.slice(5, 7)}월` : '';
    const cashSmall = sym === 'SPCX' && Y ? `올해 ${ytdLbl} 영업현금흐름 ${usdS2(Y.ocf)} · 설비투자 ${usd(Y.capex)}` : last?.burn != null ? `분기 잉여현금흐름 ${usdS2(last.burn)}` : '';
    const lk = sym === 'SPCX' ? lockupEvents().find((e) => e.quarter && e.quarter === E.next?.quarter) : null;
    card('searnings', {
      title: `${S.short} 실적`, sub: (last ? `최근 발표 ${last.reportedOn ? md(isoToTs(last.reportedOn)) : ''} · ${qLabelLong(last.end)} · SEC·Nasdaq` : 'SEC·Nasdaq') + repDoc(sym), info: INFO.searnings,
      body: `${nextEarnHtml(E.next, lk ? `<p class="note">⚠️ 실적 발표 2거래일 뒤 <b>보호예수 최대 ${unit(lk.shares)}주</b>가 풀려요(${esc(lk.label)}).</p>` : '', sym)}
        ${last ? `<div class="ns-grid er-grid">
          <div><span>매출</span><b>${usdS2(last.revenue)}</b><small>전년 같은 분기 대비 ${sp(yoy)} · 전분기 ${sp(qoq)}</small></div>
          <div><span>매출총이익률</span><b>${g != null ? pctPlain(g) : '–'}</b><small>${g != null && gPrev != null ? `전분기 ${pctPlain(gPrev)} → <span class="${cls(g - gPrev)}">${pp(g - gPrev, 1)}</span>` : '매출 − 매출원가'}</small></div>
          <div><span>영업이익</span><b class="${cls(last.opIncome)}">${usdS2(last.opIncome)}</b><small>영업이익률 ${opm != null ? pctPlain(opm) : '–'}</small></div>
          <div><span>순이익</span><b class="${cls(last.netIncome)}">${usdS2(last.netIncome)}</b><small>${turn || `전분기 ${usdS2(prev?.netIncome)}`}</small></div>
          <div><span>EPS(주당순이익)</span><b>${last.eps != null ? '$' + last.eps.toFixed(2) : '–'}</b><small>${sur ? `예상 $${sur.consensus.toFixed(2)} · ${sur.eps >= sur.consensus ? '예상보다 양호' : '예상보다 부진'}` : '예상치 없음'}</small></div>
          <div><span>현금·단기투자</span><b>${usdS2(last.liquidity ?? last.cash)}</b><small>${cashSmall}</small></div>
        </div>` : ''}
        <div class="pair er-pair">
          <div><div class="mini-h er-h">분기 매출</div><div class="chart"><canvas id="cv-ser-rev" role="img" aria-label="분기별 매출"></canvas></div></div>
          <div><div class="mini-h er-h">분기 순이익</div><div class="chart"><canvas id="cv-ser-ni" role="img" aria-label="분기별 순이익"></canvas></div></div>
        </div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>분기</th><th>매출</th><th>전년 대비</th><th>순이익</th><th>EPS</th></tr></thead>
          <tbody>${Q.slice().reverse().map((q, i) => { const y = yoyQ(Q, q); return `<tr${i === 0 ? ' class="today"' : ''}><td>${qLabel(q.end)}</td><td class="strong">${usdS2(q.revenue)}</td><td class="${cls(y)}">${y == null ? '–' : pct(y)}</td><td class="${cls(q.netIncome)}">${usdS2(q.netIncome)}</td><td>${epsCell(q)}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="note">${S.earnNote}</p>`,
    });
    const labels = Q.map((q) => qLabel(q.end));
    niRevCharts(Q, labels, (it) => { const q = Q[it.dataIndex], y = yoyQ(Q, q); return qLabelLong(q.end) + (y != null ? ` · 전년 대비 ${pct(y)}` : ''); });
  }

  // ---------------------------------------------------------------- 종목 Home: 핵심 지표 · 요약
  const tile = (k, v, d, go) => `<button type="button" class="kpi" data-go="${go}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></button>`;
  function commonTiles(sym) {
    const S = STOCK_INFO[sym], sh = shortOf(sym), sd = sh?.daily || [];
    const a = sd.at(-1), b = sd.at(-2);
    const N = st(sym).earn?.next, H = state.holders[sym];
    const q = pq(sym), pr = S.peer ? state.quote?.[S.peer[0]] : null;
    return {
      short: tile(`${S.short} 공매도 비율`, a ? pctPlain(a.ratio) : '–', a && b ? `<span class="${cls(a.ratio - b.ratio)}">${arrow(a.ratio - b.ratio)} ${pp(a.ratio - b.ratio, 1)}</span> <span class="flat">평균 ${pctPlain(sh.avgRatio)}</span>` : '', 'sprice:c-sshort'),
      inst: tile('기관 보유 비율', H ? pctPlain(H.ownershipPct) : '–', H ? `<span class="flat">늘림 ${nf(0).format(H.increased?.holders || 0)} · 줄임 ${nf(0).format(H.decreased?.holders || 0)}곳</span>` : '', 'sprice:c-sholders'),
      next: tile('다음 실적 발표', N?.date ? `D-${Math.max(0, dday(N.date))}` : '–', N?.date ? `<span class="flat">${md(isoToTs(N.date))}${N.estimated ? ' (예상)' : ''}</span>` : '', 'searn:c-searnings'),
      peer: !S.peer ? tile('오늘 등락', q ? `<span class="${cls(q.pct)}">${pct(q.pct, 1)}</span>` : '–', `<span class="flat">${price(q?.price)}</span>`, 'sprice:c-spricechart') : tile(`경쟁사 ${S.peer[1]}`, pr?.price != null ? price(pr.price) : '–', pr ? `<span class="${cls(pr.pct)}">${arrow(pr.pct)} ${pct(pr.pct, 1)}</span> <span class="flat">vs ${sym} ${q ? pct(q.pct, 1) : '–'}</span>` : '', 'sprice:c-spricechart'),
    };
  }
  // ---- ETF: 분배금(배당) 요약 — 최근 1년 분배율·주기·최근 분배금·다음 배당락
  function etfStats(sym) {
    const D = st(sym).etfDiv;
    if (!D?.events) return null;
    const ev = D.events, cut = addDays(isoToday(), -365), yr = ev.filter((e) => e.ex > cut);
    const ttm = yr.reduce((a, e) => a + e.amt, 0), px = pq(sym)?.price || D.price;
    const n = yr.length, freq = n >= 40 ? '매주' : n >= 10 ? '매달' : n >= 3 ? '분기' : n ? '연·반기' : '분배 없음';
    const last = ev.at(-1), prev = ev.at(-2);
    return { ttm, yld: px && ttm ? ttm / px : null, n, freq, last, prev, next: D.next || null, px };
  }
  function etfTiles(sym) {
    const E = etfStats(sym);
    const nx = E?.next, dn = nx?.ex ? dday(nx.ex) : null;
    return [
      tile('분배율(최근 1년)', E?.yld != null ? pctPlain(E.yld, 1) : '–', E ? `<span class="flat">1년 ${usd2(E.ttm)} · ${E.freq}</span>` : '<span class="flat">분배 기록 불러오는 중</span>', 'searn:c-searnings'),
      tile('최근 분배금', E?.last ? `$${E.last.amt.toFixed(E.last.amt < 1 ? 4 : 2)}` : '–', E?.last ? `<span class="flat">${md(isoToTs(E.last.ex))} 배당락</span>${E.prev ? ` <span class="${cls(E.last.amt - E.prev.amt)}">${pct(E.last.amt / E.prev.amt - 1, 0)}</span>` : ''}` : '', 'searn:c-searnings'),
      tile('다음 배당락', dn != null && dn >= 0 ? (dn === 0 ? '오늘' : `D-${dn}`) : '–', nx?.ex ? `<span class="flat">${md(isoToTs(nx.ex))}${nx.est ? ' (예상)' : ''}${nx.amt ? ` · $${(+nx.amt).toFixed(nx.amt < 1 ? 4 : 2)}` : ''}</span>` : '<span class="flat">발표 전</span>', 'searn:c-searnings'),
      tile('1년 분배 횟수', E ? `${E.n}회` : '–', E ? `<span class="flat">${E.freq} 분배</span>` : '', 'searn:c-searnings'),
    ];
  }
  function renderEtfDist(sym) {
    const S = STOCK_INFO[sym], E = etfStats(sym), D = st(sym).etfDiv;
    if (!E) { card('searnings', { title: `${S.short} 분배금`, body: '<p class="skeleton">분배금 기록 불러오는 중…</p>' }); return; }
    const rows = D.events.slice(-12).reverse();
    card('searnings', {
      title: `${S.short} 분배금 기록`, sub: `${esc(S.name)} · 배당락일 기준 · Yahoo Finance`,
      easy: 'ETF는 회사가 아니라서 매출·이익 같은 실적이 없어요. 대신 갖고 있는 주식·옵션에서 나온 수익을 주기적으로 나눠 주는데(분배금), 그 기록이에요. 분배율은 최근 1년 동안 받은 분배금 ÷ 지금 가격이에요.',
      body: `<div class="ns-grid h-grid">
          <div><span>분배율(최근 1년)</span><b>${E.yld != null ? pctPlain(E.yld, 1) : '–'}</b><small>세전 · 1년 ${usd2(E.ttm)}</small></div>
          <div><span>분배 주기</span><b>${E.freq}</b><small>최근 1년 ${E.n}회</small></div>
          <div><span>최근 분배금</span><b>${E.last ? `$${E.last.amt.toFixed(E.last.amt < 1 ? 4 : 2)}` : '–'}</b><small>${E.last ? `${md(isoToTs(E.last.ex))} 배당락` : ''}</small></div>
          <div><span>다음 배당락</span><b>${E.next?.ex ? md(isoToTs(E.next.ex)) : '–'}</b><small>${E.next?.ex ? (E.next.est ? '예상' : '확정') : '발표 전'}</small></div>
        </div>
        <div class="div-scroll"><table class="div-tbl"><thead><tr><th>배당락일</th><th>주당 분배금</th><th>직전 대비</th></tr></thead><tbody>
          ${rows.map((e, i) => { const p = rows[i + 1]; return `<tr><td>${e.ex.slice(2).replace(/-/g, '.')}</td><td>$${e.amt.toFixed(e.amt < 1 ? 4 : 2)}</td><td>${p ? `<span class="${cls(e.amt - p.amt)}">${pct(e.amt / p.amt - 1, 0)}</span>` : '–'}</td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="note">분배금은 운용 성과에 따라 달라지고, 분배율이 높아도 주가가 떨어지면 원금이 줄 수 있어요. 실제로 받은 금액(세후)은 🔥 Fire → 💰 배당금에 종목을 넣으면 계산해 줘요.</p>`,
    });
  }
  // 애널리스트 평균 목표가 · 내부자 3개월 순매매 칸(모든 종목 공통)
  function analystTiles(sym) {
    const V = analystView(sym), I = state.analyst?.[sym]?.insider, go = sym === 'CRCL' ? 'crcl:c-analyst' : 'sprice:c-sanalyst';
    const net = I?.net?.m3;
    return [
      tile('애널리스트 목표가', V ? price(V.T.mean) : '–', V ? `<span class="${cls(V.up)}">${pct(V.up, 0)}</span> <span class="flat">${V.label} · ${V.n}곳</span>` : `<span class="flat">${state.analyst?.[sym] ? '집계 없음' : ''}</span>`, go),
      tile('내부자 순매매(3개월)', net != null ? `<span class="${cls(net)}">${net > 0 ? '+' : net < 0 ? '-' : ''}${unit(Math.abs(net))}주</span>` : '–', I ? `<span class="flat">매수 ${I.buys?.m3 ?? 0} · 매도 ${I.sells?.m3 ?? 0}건</span>` : '', sym === 'CRCL' ? 'crcl:c-insider' : 'sprice:c-sinsider'),
    ];
  }
  function analystSummary(sym) {
    const out = [], V = analystView(sym), go = sym === 'CRCL' ? 'crcl:c-analyst' : 'sprice:c-sanalyst';
    const oi = optionsSummaryItem(sym);
    if (oi) out.push(oi);
    if (V && V.up != null) {
      const t = V.up >= 0.15 && V.tone !== 'neg' ? 'pos' : V.up < 0 || V.tone === 'neg' ? 'neg' : 'neu';
      out.push([t, go, `애널리스트 ${V.n}곳 <b>${V.label}</b>(매수 ${V.T.buy}·보유 ${V.T.hold}·매도 ${V.T.sell}) · 평균 목표가 ${price(V.T.mean)}, 현재가보다 ${Math.abs(V.up * 100).toFixed(0)}% ${V.up >= 0 ? '높음' : '낮음'}`, t === 'pos' ? '목표가 여유' : V.up < 0 ? '목표가 초과' : null, 1]);
    }
    const I = state.analyst?.[sym]?.insider;
    if (I?.net?.m3 != null && (I.buys?.m3 || I.sells?.m3)) {
      const b = I.buys?.m3 || 0, sl = I.sells?.m3 || 0;
      const t = b > sl ? 'pos' : sl >= 10 && b === 0 ? 'neg' : 'neu';
      out.push([t, sym === 'CRCL' ? 'crcl:c-insider' : 'sprice:c-sinsider', `내부자 3개월 장내 매수 ${b}건 · 매도 ${sl}건 · 순매매 ${I.net.m3 > 0 ? '+' : I.net.m3 < 0 ? '-' : ''}${unit(Math.abs(I.net.m3))}주`, t === 'pos' ? '내부자 매수' : t === 'neg' ? '내부자 매도 지속' : null, 1]);
    }
    return out;
  }
  function renderSKpis(sym = state.stock) {
    if (isKR(sym)) return;
    const el = document.getElementById('skpis');
    if (!el) return;
    const T = commonTiles(sym), E = st(sym).earn, Q = E?.quarters || [], last = Q.at(-1);
    let own = [];
    if (sym === 'JOBY') {
      const F = faaData(), s5 = F?.stages?.find((s) => s.n === 5), s4 = F?.stages?.find((s) => s.n === 4);
      const rw = sRunway(E);
      own = [
        tile('FAA 5단계(최종)', s5 ? `${s5.joby}%` : '–', s5 ? `<span class="flat">FAA 측 ${s5.faa}% · ${esc(F.asOf.slice(5).replace('-', '/'))} 기준</span>` : '', 'searn:c-faa'),
        tile('FAA 4단계(시험·분석)', s4 ? `${s4.joby}%` : '–', s4 ? `<span class="flat">FAA 측 ${s4.faa}%</span>` : '', 'searn:c-faa'),
        tile('현금·단기투자', last?.liquidity != null ? usd(last.liquidity) : '–', rw ? `<span class="flat">약 ${(rw.quarters / 4).toFixed(1)}년치</span>` : '', 'searn:c-searnings'),
        tile('분기 현금 소진', last?.burn != null ? usd(-last.burn) : '–', `<span class="flat">${last ? qLabel(last.end) : ''}</span>`, 'searn:c-searnings'),
      ];
    } else if (sym === 'TEM' && temData()) {
      const { L, yoy } = temData();
      own = [
        tile('분기 매출', usd(L.revenue * 1e6), `<span class="flat">${temQ(L.q)}</span>${yoy.revenue != null ? ` <span class="${cls(yoy.revenue)}">${pct(yoy.revenue, 0)}</span>` : ''}`, 'searn:c-tempus'),
        tile('데이터·앱 매출', L.dataApps != null ? usd(L.dataApps * 1e6) : '–', `${yoy.dataApps != null ? `<span class="${cls(yoy.dataApps)}">${pct(yoy.dataApps, 0)}</span> ` : ''}<span class="flat">제약사 데이터 라이선스 등</span>`, 'searn:c-tempus'),
        tile('종양 검사 증가율', L.oncologyGrowth != null ? `<span class="up">+${Math.round(L.oncologyGrowth * 100)}%</span>` : '–', `<span class="flat">전년 같은 분기 대비 건수</span>`, 'searn:c-tempus'),
        tile('조정 EBITDA', L.adjEbitda != null ? `<span class="${cls(L.adjEbitda)}">${L.adjEbitda < 0 ? '-' : '+'}${usd(Math.abs(L.adjEbitda) * 1e6)}</span>` : '–', `<span class="flat">${EN ? (L.adjEbitda > 0 ? 'profitable' : 'loss') : L.adjEbitda > 0 ? '흑자' : '적자'} · ${temQ(L.q)}</span>`, 'searn:c-tempus'),
      ];
    } else if (sym === 'SPCX') {
      const q = pq('SPCX'), ip = ipoPx(), nx = nextLockup(), yoy = yoyQ(Q, last);
      own = [
        tile('공모가 대비', q?.price && ip ? `<span class="${cls(q.price / ip - 1)}">${pct(q.price / ip - 1, 1)}</span>` : '–', ip ? `<span class="flat">공모가 ${price(ip)} · 6/12 상장</span>` : '', 'searn:c-lockup'),
        tile('다음 보호예수 해제', nx ? (dday(nx.date) === 0 ? '오늘' : `D-${dday(nx.date)}`) : '–', nx ? `<span class="flat">${md(isoToTs(nx.date))}${nx.est ? '(예상)' : ''} · ${unit(nx.shares)}주</span>` : '', 'searn:c-lockup'),
        tile('분기 매출', last?.revenue != null ? usd(last.revenue) : '–', `<span class="flat">${last ? qLabel(last.end) : ''}</span>${yoy != null ? ` <span class="${cls(yoy)}">${pct(yoy, 0)}</span>` : ''}`, 'searn:c-searnings'),
        tile('분기 순이익', last?.netIncome != null ? `<span class="${cls(last.netIncome)}">${usdS2(last.netIncome)}</span>` : '–', `<span class="flat">영업이익 ${usdS2(last?.opIncome)}</span>`, 'searn:c-searnings'),
      ];
    } else {
      const yoy = yoyQ(Q, last), g = gmQ(last);
      own = [
        tile('매출 성장률', yoy != null ? `<span class="${cls(yoy)}">${pct(yoy, 0)}</span>` : '–', `<span class="flat">전년 같은 분기 대비 · ${last ? usd(last.revenue) : ''}</span>`, 'searn:c-searnings'),
        tile('매출총이익률', g != null ? pctPlain(g) : '–', `<span class="flat">${last ? qLabel(last.end) : ''}</span>`, 'searn:c-searnings'),
        tile('분기 순이익', last?.netIncome != null ? `<span class="${cls(last.netIncome)}">${usdS2(last.netIncome)}</span>` : '–', `<span class="flat">${last ? qLabel(last.end) : ''}${Q.at(-2)?.netIncome < 0 && last?.netIncome > 0 ? ' · 흑자 전환' : ''}</span>`, 'searn:c-searnings'),
        tile('현금·단기투자', last ? usd(last.liquidity ?? last.cash) : '–', `<span class="flat">분기 현금흐름 ${usdS2(last?.burn)}</span>`, 'searn:c-searnings'),
      ];
    }
    if (isEtf(sym)) { el.innerHTML = [...etfTiles(sym), T.short, T.peer].join(''); return; }
    el.innerHTML = [...own, T.inst, T.short, T.next, T.peer, ...analystTiles(sym)].join('');
  }

  // 규칙 기반 자동 요약 (종목 공통 + 종목별 항목)
  // ---- 한국 종목 카드
  const krNumTxt = (s) => { const n = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
  const eok = (v) => (v == null ? '–' : Math.abs(v) >= 1e4 ? `${(v / 1e4).toFixed(Math.abs(v) >= 1e5 ? 0 : 1)}조` : `${nf(0).format(v)}억`); // 억원 단위 값
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const KR_RATING = (m) => (m == null ? '–' : m >= 4.5 ? '강력 매수' : m >= 3.5 ? '매수' : m >= 2.5 ? '중립' : m >= 1.5 ? '매도' : '강력 매도');
  function renderKrKpis(sym) {
    const el = document.getElementById('skpis'), K = st(sym).krinfo;
    if (!el) return;
    if (!K) { el.innerHTML = '<p class="skeleton">투자 지표 불러오는 중…</p>'; return; }
    const T = K.totals || {}, v = (k) => T[k]?.value || '–', q = pq(sym), E = K.etf;
    const up = K.consensus?.target && q?.price ? K.consensus.target / q.price - 1 : null;
    const tiles = K.type === 'etf' && E ? [
      tile('시가총액', E.marketValue || '–', `<span class="flat">${esc(keepName(E.issuerName) || '')}</span>`, 'sprice:c-spricechart'),
      tile('분배수익률', E.dividendYieldTtm != null ? `${E.dividendYieldTtm}%` : '–', '<span class="flat">최근 1년</span>', 'sprice:c-spricechart'),
      tile('총보수', E.totalFee != null ? `${E.totalFee}%` : v('fundPay'), '<span class="flat">연</span>', 'sprice:c-spricechart'),
      tile('1년 수익률', E.returnRate1y != null ? `<span class="${cls(E.returnRate1y)}">${E.returnRate1y > 0 ? '+' : ''}${E.returnRate1y}%</span>` : '–', `<span class="flat">3개월 ${E.returnRate3m ?? '–'}%</span>`, 'sprice:c-spricechart'),
      tile('NAV', E.nav ? `${E.nav}원` : v('nav'), E.deviationRate != null ? `<span class="flat">괴리율 ${E.deviationSign || ''}${E.deviationRate}%</span>` : '', 'sprice:c-spricechart'),
      tile('52주 범위', `${v('lowPriceOf52Weeks')}~`, `<span class="flat">${v('highPriceOf52Weeks')}원</span>`, 'sprice:c-spricechart'),
    ] : [
      tile('시가총액', v('marketValue'), '', 'sprice:c-spricechart'),
      tile('PER', v('per'), `<span class="flat">추정 ${v('cnsPer')}</span>`, 'searn:c-searnings'),
      tile('PBR', v('pbr'), `<span class="flat">BPS ${v('bps')}</span>`, 'sprice:c-spricechart'),
      tile('배당수익률', v('dividendYieldRatio'), `<span class="flat">주당 ${v('dividend')}</span>`, 'sprice:c-spricechart'),
      tile('외국인 보유', v('foreignRate'), '<span class="flat">외국인 한도 대비</span>', 'sprice:c-sholders'),
      tile('목표주가', K.consensus?.target ? wonPx(K.consensus.target) : '–', up != null ? `<span class="${cls(up)}">${pct(up, 1)}</span> <span class="flat">${KR_RATING(K.consensus.mean)}</span>` : '', 'sprice:c-sanalyst'),
    ];
    el.innerHTML = tiles.join('');
  }
  function renderKrDeal(sym) {
    const K = st(sym).krinfo, S = STOCK_INFO[sym];
    if (!K) { card('sholders', { title: '투자자별 매매', body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const D = (K.deal || []).slice(0, 10), sum = (k, n) => D.slice(0, n).reduce((a, d) => a + (d[k] || 0), 0);
    const sh = (v) => (v == null ? '–' : `<span class="${cls(v)}">${v > 0 ? '+' : ''}${unit(v)}주</span>`);
    card('sholders', {
      title: '투자자별 매매 · 외국인 보유', sub: `${esc(S.name)} · 순매수(산 주식 − 판 주식) · 네이버 증권`,
      easy: '하루 동안 외국인·기관(연기금·펀드 등)·개인이 이 종목을 얼마나 사고팔았는지예요. +면 판 것보다 산 게 많다는 뜻이고, 외국인·기관이 꾸준히 사면 큰손이 모으는 중이라고 봐요.',
      body: D.length ? `<div class="ns-grid h-grid kr3">
          <div><span>외국인 5일</span><b>${sh(sum('foreign', 5))}</b><small>보유율 ${D[0].hold != null ? D[0].hold.toFixed(2) + '%' : '–'}</small></div>
          <div><span>기관 5일</span><b>${sh(sum('organ', 5))}</b><small>연기금·투신·은행 등</small></div>
          <div><span>개인 5일</span><b>${sh(sum('indiv', 5))}</b><small>${D.length}일 기록</small></div>
        </div>
        <div class="div-scroll"><table class="div-tbl kr-deal"><thead><tr><th>날짜</th><th>외국인</th><th>기관</th><th>개인</th><th>보유율</th></tr></thead><tbody>
          ${D.map((d) => `<tr><td>${+d.d.slice(5, 7)}/${+d.d.slice(8)}</td><td>${sh(d.foreign)}</td><td>${sh(d.organ)}</td><td>${sh(d.indiv)}</td><td>${d.hold != null ? d.hold.toFixed(2) + '%' : '–'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="note">한국 주식은 미국처럼 기관별 보유 보고서(13F)가 없어서, 대신 매일 발표되는 투자자별 매매와 외국인 보유율을 보여줘요.</p>` : '<p class="note">투자자별 매매 자료가 없어요.</p>',
    });
  }
  function renderKrAnalyst(sym) {
    const K = st(sym).krinfo, C = K?.consensus, q = pq(sym), R = K?.researches || [];
    if (!K) { card('sanalyst', { title: '애널리스트 의견', body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const up = C?.target && q?.price ? C.target / q.price - 1 : null;
    card('sanalyst', {
      title: '애널리스트 의견', sub: `증권사 컨센서스 · 리포트 · 네이버 증권${C?.date ? ` · ${C.date.slice(5).replace('-', '/')} 기준` : ''}`,
      easy: '증권사 애널리스트들이 이 종목을 사라고 하는지(매수) 팔라고 하는지와, 평균적으로 주가가 얼마까지 갈 거라고 보는지(목표주가)예요.',
      body: C || R.length ? `${C ? `<div class="ns-grid h-grid">
          <div><span>투자의견</span><b>${KR_RATING(C.mean)}</b><small>${C.mean != null ? (EN ? `${C.mean.toFixed(2)} / 5` : `5점 만점 ${C.mean.toFixed(2)}`) : ''}</small></div>
          <div><span>평균 목표주가</span><b>${C.target ? wonPx(C.target) : '–'}</b><small>${up != null ? `현재가 대비 <span class="${cls(up)}">${pct(up, 1)}</span>` : ''}</small></div>
        </div>` : ''}
        ${R.length ? `<ul class="kr-rs" data-noi18n>${R.map((r) => `<li><a href="${IS_MOBILE ? `https://m.stock.naver.com/investment/research/company/${encodeURIComponent(r.id)}` : `https://finance.naver.com/research/company_read.naver?nid=${encodeURIComponent(r.id)}`}" target="_blank" rel="noopener"><b>${esc(r.title)}</b><small>${esc(r.broker || '')} · ${r.date ? r.date.slice(2).replace(/-/g, '.') : ''}</small></a></li>`).join('')}</ul>` : ''}` : `<p class="note">${K.type === 'etf' ? 'ETF는 애널리스트 의견이 없어요.' : '애널리스트 자료가 없어요.'}</p>`,
    });
  }
  function renderKrEarn(sym) {
    const K = st(sym).krinfo, F = K?.finance, S = STOCK_INFO[sym];
    if (!document.getElementById('c-searnings')) return;
    if (!K) { card('searnings', { title: `${esc(ttlName(sym))}실적`, body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    if (!F?.periods?.length) { card('searnings', { title: `${esc(ttlName(sym))}실적`, body: `<p class="note">${K.type === 'etf' ? 'ETF는 회사 실적이 없어요. 위 투자 지표에서 분배수익률·총보수·수익률을 확인하세요.' : '실적 자료가 없어요.'}</p>` }); return; }
    const Rw = F.rows, cell = (t, k, f) => { const v = Rw[t]?.[k]; return v == null ? '–' : f(v); };
    const growth = (t, k, i) => { const prev = F.periods[i - 4]; const a = Rw[t]?.[k], b = prev ? Rw[t]?.[prev.key] : null; return a != null && b ? ` <small class="${cls(a / b - 1)}">${pct(a / b - 1, 0)}</small>` : ''; };
    card('searnings', {
      title: `${esc(ttlName(sym))}분기 실적`, sub: '연결 기준 · 단위 억원(조) · 네이버 증권(FnGuide)',
      easy: '분기마다 회사가 얼마를 팔고(매출액) 얼마를 남겼는지(영업이익·순이익)예요. (예상)은 아직 발표 전이라 증권사 예상치 평균(컨센서스)이에요.',
      body: `${krNextEarn(sym)}<div class="div-scroll"><table class="div-tbl kr-earn"><thead><tr><th>분기</th><th>매출액</th><th>영업이익</th><th>이익률</th><th>순이익</th></tr></thead><tbody>
        ${F.periods.map((pd, i) => `<tr${pd.cns ? ' class="kr-cns"' : ''}><td>${esc(pd.title.replace(/\.$/, ''))}${pd.cns ? '<small>예상</small>' : ''}</td><td>${cell('매출액', pd.key, eok)}${growth('매출액', pd.key, i)}</td><td>${cell('영업이익', pd.key, (v) => `<span class="${cls(v)}">${eok(v)}</span>`)}</td><td>${cell('영업이익률', pd.key, (v) => v.toFixed(1) + '%')}</td><td>${cell('당기순이익', pd.key, eok)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">작은 숫자는 1년 전 같은 분기 대비. 한국 종목은 실적 발표일 자동 알림(실적 당일 모드)은 아직 없어요.</p>`,
    });
  }
  function renderSSummary(sym = state.stock) {
    if (isKR(sym)) return;
    if (!document.getElementById('c-ssummary') || !isOther(sym)) return;
    const S = STOCK_INFO[sym], items = [];
    const add = (tone, go, html, tag, weight = 1) => items.push({ tone, go, html, tag, weight });
    const E = st(sym).earn, Q = E?.quarters || [], last = Q.at(-1);
    if (sym === 'JOBY') {
      const F = faaData(), s5 = F?.stages?.find((s) => s.n === 5);
      if (s5) {
        const h = F.history || [], dj = h.length > 1 ? h.at(-1).s5[0] - h.at(-2).s5[0] : null;
        add(dj > 0 ? 'pos' : 'neu', 'searn:c-faa', `FAA 인증 <b>5단계(최종)</b> Joby ${s5.joby}% · FAA ${s5.faa}%${dj != null ? ` · 직전 서한 대비 +${dj}%p` : ''} · 다음: ${esc(F.next || '')}`, dj > 0 ? 'FAA 인증 진전' : null, 3);
      }
      const rw = sRunway(E);
      if (rw) {
        const yrs = rw.quarters / 4, t = yrs >= 2 ? 'pos' : yrs < 1 ? 'neg' : 'neu';
        add(t, 'searn:c-searnings', `현금·단기투자 <b>${usd(rw.liq)}</b> · 최근 2분기 평균 소진 ${usd(rw.burn)} → 약 ${yrs.toFixed(1)}년치`, t === 'pos' ? '현금 여유' : t === 'neg' ? '현금 부족 우려' : null, 2);
      }
    } else if (sym === 'SPCX') {
      const nx = nextLockup();
      if (nx) {
        const d = dday(nx.date), t = d <= 14 ? 'neg' : 'neu';
        add(t, 'searn:c-lockup', `보호예수 해제 <b>${krDate(nx.date)}${nx.est ? '(예상)' : ''}</b> · D-${d} · 최대 ${unit(nx.shares)}주(${esc(nx.label)})`, d <= 14 ? '보호예수 해제 임박' : null, 3);
      }
      const q = pq('SPCX'), ip = ipoPx();
      if (q?.price && ip) { const r = q.price / ip - 1; add(r >= 0 ? 'pos' : 'neg', 'searn:c-lockup', `공모가 ${price(ip)} 대비 <b class="${cls(r)}">${pct(r, 1)}</b>`, r < 0 ? '공모가 하회' : null, 1); }
    }
    if (sym !== 'JOBY' && last) {
      const yoy = yoyQ(Q, last), prev = Q.at(-2);
      const turn = prev?.netIncome < 0 && last.netIncome > 0;
      const t = turn || (yoy != null && yoy > 0.2) ? 'pos' : yoy != null && yoy < 0 ? 'neg' : 'neu';
      add(t, 'searn:c-searnings', `${qLabelLong(last.end)} 매출 <b>${usd(last.revenue)}</b>${yoy != null ? `(전년 대비 ${pct(yoy, 0)})` : ''} · 순이익 ${usdS2(last.netIncome)}${turn ? ' · <b>흑자 전환</b>' : ''}`, turn ? '흑자 전환' : yoy > 0.2 ? '고성장' : yoy < 0 ? '매출 감소' : null, 2);
    }
    const sh = shortOf(sym);
    if (sh?.daily?.length) {
      const l = sh.daily.at(-1), diff = l.ratio - sh.avgRatio;
      const t = diff > 0.05 ? 'neg' : diff < -0.05 ? 'pos' : 'neu';
      const si = sh.interest?.at(-1);
      add(t, 'sprice:c-sshort', `공매도 비율 <b>${pctPlain(l.ratio)}</b>(${md(isoToTs(l.d))}) · 1개월 평균 ${pctPlain(sh.avgRatio)}보다 ${Math.abs(diff * 100).toFixed(1)}%p ${diff >= 0 ? '높음' : '낮음'}${si ? ` · 잔고 ${si.chg > 0 ? '+' : ''}${si.chg.toFixed(1)}%` : ''}`, t === 'neg' ? '공매도 비중↑' : t === 'pos' ? '공매도 비중↓' : null, 2);
    }
    for (const it of analystSummary(sym)) add(...it);
    const H = state.holders[sym];
    if (H?.increased && H?.decreased) {
      const r = (H.increased.holders || 0) / Math.max(1, H.decreased.holders || 0);
      const t = r >= 1.3 ? 'pos' : r <= 0.77 ? 'neg' : 'neu';
      add(t, 'sprice:c-sholders', `기관 보유 <b>${pctPlain(H.ownershipPct)}</b> · 직전 13F 대비 늘린 곳 ${nf(0).format(H.increased.holders)} · 줄인 곳 ${nf(0).format(H.decreased.holders)}`, t === 'pos' ? '기관 매수 우위' : t === 'neg' ? '기관 매도 우위' : null, 1);
    }
    const N = st(sym).news;
    if (N) {
      const off = N.official?.[0];
      const k8 = N.filings?.find((f) => /^8-K/.test(f.form));
      const fresh8k = k8 && Date.now() - Date.parse(k8.d) < 3 * 86400000;
      if (off || fresh8k) add('neu', 'snews:c-snews', `${fresh8k ? `<b>8-K 공시</b>(${md(isoToTs(k8.d))})${off ? ' · ' : ''}` : ''}${off ? `최신 발표: ${esc(off.title.length > 48 ? off.title.slice(0, 47) + '…' : off.title)}` : ''}`, fresh8k ? '신규 8-K 공시' : null, 1);
    }
    const NE = E?.next;
    if (NE?.date) add('neu', 'searn:c-searnings', `다음 실적 발표 <b>${krDate(NE.date)}</b>${NE.estimated ? '(예상)' : ''} · D-${Math.max(0, dday(NE.date))} · 예상 EPS ${NE.consensus != null ? '$' + NE.consensus.toFixed(2) : '–'}`, null, 0);
    const q = pq(sym);
    const pxLine = `<li><button type="button" data-go="sprice:c-spricechart"><span class="tone px"><span class="live-dot"></span>주가</span>
      <span class="txt">${sym} <b>${price(q?.price)}</b> · ${BN24[sym] ? '24시간' : '오늘'} ${q ? `<span class="${cls(q.pct)}">${pct(q.pct, 1)}</span>` : '–'} · ${esc(statusLabel(q))}</span>${chevron}</button></li>`;
    const tags = items.filter((i) => i.tag).sort((a, b) => b.weight - a.weight).slice(0, 3);
    const nPos = items.filter((i) => i.tone === 'pos').length, nNeg = items.filter((i) => i.tone === 'neg').length;
    const toneName = { pos: '긍정', neg: '주의', neu: '중립' };
    card('ssummary', {
      title: '현재 상황 요약', sub: `${S.name} · 규칙 기반 자동 요약`, info: INFO.summary,
      body: `
        <p class="sum-line">${tags.length ? tags.map((t) => `<span class="${t.tone}">${t.tag}</span>`).join('') : '뚜렷한 변화 없이 보합'}</p>
        ${sumListHtml('ssummary', pxLine, items)}`,
    });
  }

  function renderSEarnings(sym = state.stock) {
    try { renderBiz(sym); } catch (e) { console.error(e); }
    try { renderAiCards(sym); } catch (e) { console.error(e); }
    if (isKR(sym)) { renderKrEarn(sym); return; }
    if (!isOther(sym)) return;
    if (sym === 'JOBY') { renderFaa(); renderJobyTimeline(); }
    if (sym === 'SPCX') renderLockup();
    if (sym === 'TEM') renderTempus();
    if (isEtf(sym)) { renderEtfDist(sym); return; }
    STOCK_INFO[sym].mode === 'burn' ? renderBurnEarnings(sym) : renderGrowthEarnings(sym);
  }
  function renderStock() {
    renderStockSwitch();
    const sym = state.stock;
    for (const j of [() => renderAvgCalc(sym), () => renderMemo(sym)]) { try { j(); } catch (e) { console.error(e); } }
    if (!isOther(sym)) { for (const j of [() => renderHolders('CRCL', 'holders'), () => renderAnalyst('CRCL'), () => renderInsider('CRCL'), () => renderOptions('CRCL'), () => renderEarnDay('CRCL')]) { try { j(); } catch (e) { console.error(e); } } return; }
    document.getElementById('c-faa').hidden = sym !== 'JOBY';
    document.getElementById('c-lockup').hidden = sym !== 'SPCX';
    const ct = document.getElementById('c-tempus'); if (ct) ct.hidden = sym !== 'TEM';
    const cj = document.getElementById('c-jobytl'); if (cj) cj.hidden = sym !== 'JOBY';
    const S = STOCK_INFO[sym], kr = isKR(sym);
    for (const id of ['c-sshort', 'c-sinsider', 'c-soptions', 'c-ssummary']) { const el = document.getElementById(id); if (el) el.hidden = kr; }
    for (const id of ['c-sanalyst', 'c-sholders', 'skpis']) { const el = document.getElementById(id); if (el) el.hidden = false; }
    const etf = !kr && isEtf(sym);
    for (const id of ['c-sanalyst', 'c-sholders', 'c-sinsider']) { const el = document.getElementById(id); if (el && etf) el.hidden = true; }
    const kh = document.querySelector('#home-stock .group-h'); if (kh) kh.hidden = false;
    if (kr) {
      document.getElementById('c-searnday').hidden = true;
      for (const j of [() => renderSPriceCard(sym), () => renderSPriceChart(sym), () => renderKrKpis(sym), () => renderKrDeal(sym), () => renderKrAnalyst(sym), () => renderBiz(sym), () => renderKrEarn(sym), () => renderNewsSummary(sym), () => renderNews(sym), updateNewsBadge]) { try { j(); } catch (e) { console.error(e); } }
      return;
    }
    const jobs = [() => renderSPriceCard(sym), () => renderSKpis(sym), () => renderSSummary(sym), () => renderSPriceChart(sym),
      () => renderShort(shortOf(sym), 'sshort', S.short), () => renderHolders(sym, 'sholders'), () => renderAnalyst(sym), () => renderInsider(sym), () => renderOptions(sym), () => renderEarnDay(sym), () => renderSEarnings(sym),
      () => renderNewsSummary(sym), () => renderNews(sym), updateNewsBadge];
    for (const j of jobs) { try { j(); } catch (e) { console.error(e); } }
  }

  // ---------------------------------------------------------------- 실시간 체결가 (Yahoo Finance 스트림 · 바이낸스 24시간 선물)
  // Nasdaq 시세(15초)는 장 상태·전일 종가를 위한 기본값으로 두고, 체결이 날 때마다 오는 Yahoo 스트림 값으로 바로 덮어쓴다
  // (미국 장전·장중·장후). SPCX·TEM은 바이낸스에도 24시간 거래되는 주식 선물이 있어 밤·주말 흐름을 함께 보여준다.
  const YF_SYMS = ['JOBY', 'SPCX', 'TEM', 'ACHR', 'RKLB', 'GH', 'CRCA', 'CRCL', ...Object.keys(watchCfg.custom).filter((x) => US_SYM.test(x))];
  const live = {}; // 티커 → { price, pct, change, at }
  let yws = null, ywsTries = 0, ywsTimer = null;
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // Yahoo가 보내는 protobuf 메시지를 필요한 칸만 읽는다(1 티커, 2 가격, 3 시각, 8 등락률%, 12 등락액)
  function pbRead(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = {};
    let i = 0;
    const varint = () => { let r = 0n, sh = 0n; for (;;) { const x = buf[i++]; r |= BigInt(x & 0x7f) << sh; if (!(x & 0x80) || i >= buf.length) break; sh += 7n; } return r; };
    while (i < buf.length) {
      const key = Number(varint()), f = key >> 3, w = key & 7;
      if (w === 0) out[f] = varint();
      else if (w === 5) { out[f] = dv.getFloat32(i, true); i += 4; }
      else if (w === 1) { out[f] = dv.getFloat64(i, true); i += 8; }
      else if (w === 2) { const n = Number(varint()); out[f] = new TextDecoder().decode(buf.subarray(i, i + n)); i += n; }
      else break;
    }
    return out;
  }
  function applyLive(sym) {
    const L = live[sym];
    if (!L || Date.now() - L.at > 20000) return;
    state.quote ||= {};
    const q = (state.quote[sym] ||= { symbol: sym, price: L.price }); // Nasdaq 시세보다 먼저 오면 체결가로 먼저 채운다 // 20초 넘게 체결이 없으면 Nasdaq 값을 그대로 쓴다
    q.price = L.price;
    if (L.pct != null && isFinite(L.pct)) q.pct = L.pct;
    if (L.change != null && isFinite(L.change)) q.change = L.change;
  }
  const isLive = (sym) => live[sym] && Date.now() - live[sym].at < 90000;
  function onYahoo(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type !== 'pricing' || !m.message) return;
    let p;
    try { p = pbRead(b64(m.message)); } catch { return; }
    const sym = p[1], price = p[2];
    if (!YF_SYMS.includes(sym) || !(price > 0)) return;
    live[sym] = { price, pct: p[8] != null ? p[8] / 100 : null, change: p[12] ?? null, at: Date.now() };
    applyLive(sym);
    scheduleLivePaint();
  }
  function yConnect() {
    if (yws || document.hidden || !('WebSocket' in window)) return;
    try { yws = new WebSocket('wss://streamer.finance.yahoo.com/?version=2'); } catch { return; }
    yws.onopen = () => { ywsTries = 0; yws.send(JSON.stringify({ subscribe: YF_SYMS })); };
    yws.onmessage = onYahoo;
    yws.onerror = () => { try { yws?.close(); } catch {} };
    yws.onclose = () => { yws = null; if (!document.hidden) { clearTimeout(ywsTimer); ywsTimer = setTimeout(yConnect, Math.min(60000, 2000 * 2 ** ywsTries++)); } };
  }
  function yDisconnect() { clearTimeout(ywsTimer); if (yws) { yws.onclose = null; try { yws.close(); } catch {} yws = null; } }

  // 바이낸스 TradFi 주식 선물이 있는 종목(SPCX·TEM): CRCL과 같은 구조로 바이낸스 값만 쓴다(24시간 거래)
  const BN24 = { SPCX: 'SPCXUSDT', TEM: 'TEMUSDT' };
  const bx = {}; // 티커 → { t, mark, oi, klines, via, at, err }
  const bxOf = (sym) => (bx[sym] ||= { t: null, mark: null, oi: null, klines: {}, via: null, at: 0, err: null });
  async function bxSnapshot(sym) {
    const s = BN24[sym], X = bxOf(sym);
    try {
      const [t, m, oi] = await Promise.all([bnGet(`ticker/24hr?symbol=${s}`), bnGet(`premiumIndex?symbol=${s}`), bnGet(`openInterest?symbol=${s}`).catch(() => null)]);
      X.t = { last: +t.lastPrice, open: +t.openPrice, high: +t.highPrice, low: +t.lowPrice, pct: +t.priceChangePercent / 100, qv: +t.quoteVolume, E: t.closeTime };
      X.mark = { mark: +m.markPrice, index: +m.indexPrice, fund: +m.lastFundingRate, next: m.nextFundingTime };
      if (oi) X.oi = +oi.openInterest;
      X.at = Date.now(); X.err = null;
      if (!X.via) X.via = 'rest';
    } catch (e) { X.err = e.message; throw e; }
  }
  async function bxKlines(sym, range) {
    const r = RANGES[range];
    if (r.yahoo) { bxOf(sym).klines[range] = await yahooYear(sym); return; }
    const k = await bnGet(`klines?symbol=${BN24[sym]}&interval=${r.interval}&limit=${r.limit + 120}`);
    bxOf(sym).klines[range] = splitView(k.map((x) => [x[0], +x[4], +x[1], +x[2], +x[3], +x[5]]), r.limit);
  }
  let bws = null, bwsTries = 0, bwsTimer = null, bwsWatch = null, bPollTimer = null;
  const bArm = () => { clearTimeout(bwsWatch); bwsWatch = setTimeout(() => { try { bws?.close(); } catch {} }, 15000); };
  function bConnect() {
    if (bws || document.hidden || !('WebSocket' in window)) return;
    const streams = Object.values(BN24).map((s) => s.toLowerCase()).flatMap((s) => [`${s}@aggTrade`, `${s}@ticker`, `${s}@markPrice@1s`]).join('/');
    try { bws = new WebSocket(`wss://fstream.binance.com/market/stream?streams=${streams}`); } catch { bStartPoll(); return; }
    bws.onopen = () => { bArm(); };
    bws.onmessage = (ev) => {
      bArm();
      let d;
      try { d = JSON.parse(ev.data).data; } catch { return; }
      const sym = d?.s && Object.keys(BN24).find((k) => BN24[k] === d.s);
      if (!sym) return;
      const X = bxOf(sym);
      if (X.via !== 'ws') { bwsTries = 0; X.via = 'ws'; X.err = null; }
      if (d.e === 'aggTrade') {
        if (!X.t) return;
        const last = +d.p;
        X.t = { ...X.t, last, pct: X.t.open ? last / X.t.open - 1 : X.t.pct, high: Math.max(X.t.high, last), low: Math.min(X.t.low, last), E: d.T };
      } else if (d.e === '24hrTicker') X.t = { last: +d.c, open: +d.o, high: +d.h, low: +d.l, pct: +d.P / 100, qv: +d.q, E: d.E };
      else if (d.e === 'markPriceUpdate') X.mark = { mark: +d.p, index: +d.i, fund: +d.r, next: d.T };
      X.at = Date.now();
      if (Object.values(bx).every((x) => x.via === 'ws')) bStopPoll();
      scheduleLivePaint();
    };
    bws.onerror = () => { try { bws?.close(); } catch {} };
    bws.onclose = () => {
      bws = null;
      clearTimeout(bwsWatch);
      for (const X of Object.values(bx)) if (X.via === 'ws') X.via = 'rest';
      if (document.hidden) return;
      bStartPoll();
      clearTimeout(bwsTimer);
      bwsTimer = setTimeout(bConnect, Math.min(30000, 2000 * 2 ** bwsTries++));
    };
  }
  // 웹소켓이 끊기면 5초마다 REST로 대신 받는다
  function bStartPoll() {
    if (bPollTimer) return;
    bPollTimer = setInterval(() => { for (const sym of Object.keys(BN24)) bxSnapshot(sym).then(scheduleLivePaint).catch(() => scheduleLivePaint()); }, 5000);
  }
  function bStopPoll() { clearInterval(bPollTimer); bPollTimer = null; }
  function bDisconnect() { clearTimeout(bwsTimer); clearTimeout(bwsWatch); bStopPoll(); if (bws) { bws.onclose = null; try { bws.close(); } catch {} bws = null; } }

  // 체결이 몰려도 화면은 한 프레임에 한 번만 다시 그린다(Fire 카드는 2초에 한 번)
  let livePaintQueued = false, lastFirePaint = 0;
  function scheduleLivePaint() {
    if (livePaintQueued) return;
    livePaintQueued = true;
    requestAnimationFrame(() => {
      livePaintQueued = false;
      renderStockSwitch();
      paintStock();
      if (state.view === 'fire' && Date.now() - lastFirePaint > 2000) { lastFirePaint = Date.now(); renderFire(); } else updateFireChip();
    });
  }

  // ---------------------------------------------------------------- 마지막 화면 저장(다시 열면 바로 보이게) · 다른 종목 미리 받기
  const SNAP_KEY = 'cw.snapshot.v1';
  let snapTimer = null;
  const pickKeys = (o, keys) => (o ? Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]])) : {});
  function saveSnapshot() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      if (!state.data) return;
      const snap = {
        at: state.syncedAt || new Date().toISOString(), data: state.data, quote: state.quote, earnings: state.earnings,
        holders: state.holders, analyst: state.analyst, options: state.options, market: state.market, mnews: state.mnews, faa: state.faa, spcx: state.spcx, facts: state.facts,
        st: Object.fromEntries(Object.entries(state.st).map(([k, x]) => [k, { earn: x.earn, news: x.news, short: x.short, chart: pickKeys(x.chart, ['1d', '1y']) }])),
        px: { t: px.t, mark: px.mark, oi: px.oi, klines: pickKeys(px.klines, ['1d']) },
        bx: Object.fromEntries(Object.entries(bx).map(([k, x]) => [k, { t: x.t, mark: x.mark, oi: x.oi, klines: pickKeys(x.klines, ['1d']) }])),
      };
      try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); }
      catch { // 저장 공간이 모자라면 뉴스를 빼고 다시
        try { for (const x of Object.values(snap.st)) x.news = null; localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch { try { localStorage.removeItem(SNAP_KEY); } catch {} }
      }
    }, 1500);
  }
  function loadSnapshot() {
    try {
      const S = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
      if (!S?.data || !(Date.now() - Date.parse(S.at) < 3 * 86400000)) return false;
      state.data = S.data; fixArcTvl(state.data); state.quote = S.quote || null; state.earnings = S.earnings || null;
      state.holders = S.holders || {}; state.analyst = S.analyst || {}; state.options = S.options || {}; state.market = S.market || null; state.mnews = S.mnews || null; state.faa = S.faa || null; state.spcx = S.spcx || null; state.facts = S.facts || null;
      for (const [k, x] of Object.entries(S.st || {})) Object.assign(st(k), { earn: x.earn || null, news: x.news || null, short: x.short || null, chart: x.chart || {} });
      if (S.px) { px.t = S.px.t; px.mark = S.px.mark; px.oi = S.px.oi; Object.assign(px.klines, S.px.klines || {}); }
      for (const [k, x] of Object.entries(S.bx || {})) Object.assign(bxOf(k), { t: x.t, mark: x.mark, oi: x.oi, klines: x.klines || {} });
      state.syncedAt = S.at;
      return true;
    } catch { return false; }
  }
  // 지금 안 보는 종목도 뒤에서 받아 둔다 → 종목을 바꾸면 바로 보임(10분마다)
  let lastPrefetch = 0;
  const prefetchParts = (sym) => (isKR(sym) ? ['schart', 'snews', 'krinfo'] : ['schart', 'searn', 'snews']);
  async function prefetchStocks() {
    if (Date.now() - lastPrefetch < 10 * 60000 || document.hidden) return;
    lastPrefetch = Date.now();
    // 다른 종목은 종목 칩·키워드 속보에 필요한 것(가격·실적 일정·뉴스)만 미리 받고, 나머지는 그 종목을 열 때 받는다.
    // 한꺼번에 몰아 보내지 않게 3종목씩 나눠서(서버의 IP당 요청 제한 · 무료 한도 보호)
    const L = WATCH.filter((sym) => sym !== state.stock && sym !== 'CRCL');
    for (let i = 0; i < L.length; i += 3) await Promise.all(L.slice(i, i + 3).map((sym) => syncNow(prefetchParts(sym), { sym, quiet: true }).catch(() => {})));
  }
  // 화면 맨 위 얇은 진행 막대: 처음 불러올 때·종목을 바꿀 때
  let busyCount = 0;
  function busyBar(on) {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    const bar = document.getElementById('top-progress');
    if (bar && !manualRunning) bar.hidden = busyCount === 0;
  }

  // ---------------------------------------------------------------- 상태 표시
  function ago(t) {
    const ms = typeof t === 'number' ? t : Date.parse(t);
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (EN) return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
    return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 ${m % 60}분 전`;
  }
  function renderStatus() {
    const d = state.data;
    if (!d) return;
    if (manualRunning) return; // 새로고침 중에는 '업데이트 중…' 유지
    if (state.booting) { document.getElementById('status').innerHTML = '<span class="spin-dot"></span>최신 값 받는 중…'; return; }
    const fails = state.syncFail || [];
    document.getElementById('status').innerHTML = state.syncedAt
      ? `<span class="live-dot"></span>${EN ? `Updated ${ago(state.syncedAt)}` : `${ago(state.syncedAt)} 업데이트`}` + (fails.length ? ` · <span class="warn">일부 항목 실패</span>` : '')
      : '불러오는 중…';
  }

  function renderAll() {
    if (!state.data) return;
    const jobs = [renderStatus, renderSummary, renderKpis, renderShort, renderStables,
      () => seriesCard('usdc', { title: 'USDC 전체 유통량', sub: '추이 DefiLlama 일별 · 현재 값 서클 공식', key: 'usdcTotal', fmt: usd, series: state.data.series?.usdc, color: C.blue, info: INFO.usdc }),
      () => seriesCard('eurc', { title: 'EURC 전체 유통량', sub: '유로 스테이블코인 · 추이 DefiLlama 일별 · 현재 값 서클 공식', key: 'eurcTotal', fmt: eur, series: state.data.series?.eurc, color: C.purple, info: INFO.eurc }),
      renderUsdcFlow, renderReserve, renderProducts, renderChains, renderTvl, renderDex, renderArcActivity, renderBorrow, renderArcSupply, renderLending, renderCirbtc, renderAccounts, renderCctp, renderEarnings, () => renderNewsSummary('CRCL'), () => renderNews('CRCL'), updateNewsBadge, renderFire, renderStock, renderMarket, renderFearGreed, renderKwNews];
    for (const j of jobs) {
      try { j(); } catch (e) { console.error(e); }
    }
  }

  // ---------------------------------------------------------------- 데이터 로딩
  async function loadData() {
    let res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
    if (ON_PAGES && !res?.ok && DATA_FALLBACK) res = await fetch(`${DATA_FALLBACK}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) throw new Error('data ' + (res?.status || 'network'));
    state.data = await res.json();
    fixArcTvl(state.data);
  }
  // 서버 자료(수집기가 아직 옛 규칙이거나 저장된 화면)에도 같은 규칙을 적용한다
  function fixArcTvl(d) {
    const t = d?.arcTvl;
    if (!t?.daily?.length || t.held) return;
    const c = cleanArcTvl(t.daily, t.now);
    if (!c.held) return;
    d.arcTvl = { ...t, ...c };
    for (const s of d.snapshots || []) if (Date.parse(s.t) / 1000 >= c.held.from && s.tvl != null) s.tvl = c.held.prev;
  }

  let busy = false, toastTimer = null;
  function toast(msg, warn = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.innerHTML = msg;
    el.classList.toggle('warn', warn);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }
  // kind: 'manual'(새로고침 버튼: 전 항목) · 'auto'(5분·화면 복귀: 무거운 대출 제외) · 'light'(1분: Circle·cirBTC)
  const freshSync = () => state.syncKind === 'manual' || state.syncKind === 'boot'; // 서버 저장값 대신 새로 받기
  const SYNC_SETS = {
    manual: ['market', 'feargreed', 'mnews', 'circle', 'cirbtc', 'stables', 'series', 'dex', 'tvl', 'lending', 'accounts', 'activity', 'cctp', 'rates', 'short', 'filings', 'news', 'earnings', 'quote'],
    auto: ['market', 'feargreed', 'mnews', 'circle', 'cirbtc', 'stables', 'series', 'dex', 'tvl', 'accounts', 'activity', 'cctp', 'rates', 'short', 'filings', 'news', 'earnings', 'quote'],
    light: ['circle', 'cirbtc', 'quote', 'market', 'mnews'],
  };
  // 처음 열 때: 느린 외부 사이트(DefiLlama·Arc 체인·미 재무부)는 서버가 15분마다 모아 둔 값(data.json)이 있으니 기다리지 않는다.
  // 핵심 항목(주가·서클·시장·뉴스·실적)만 받으면 '최신 값 받는 중'을 끝내고, 서버 값이 20분 넘게 묵었을 때만 느린 것들을 뒤에서 조용히 받는다.
  const SLOW_PARTS = ['stables', 'cirbtc', 'dex', 'tvl', 'lending', 'accounts', 'activity', 'cctp', 'rates'];
  SYNC_SETS.boot = SYNC_SETS.manual.filter((p) => !SLOW_PARTS.includes(p));
  function bootSlow() {
    const age = Date.now() - Date.parse(state.data?.updatedAt || 0);
    if (!(age > 20 * 60000)) return;
    syncNow(SLOW_PARTS, { quiet: true }).then(() => renderAll()).catch(() => {});
  }
  let manualRunning = false, manualQueued = false, doneTimer = null;
  function setRefreshUi(mode) { // 'loading' | 'done' | 'fail' | 'idle'
    const btn = document.getElementById('refresh');
    const bar = document.getElementById('top-progress');
    clearTimeout(doneTimer);
    btn.classList.remove('loading', 'done', 'fail');
    if (mode !== 'idle') btn.classList.add(mode);
    btn.setAttribute('aria-busy', String(mode === 'loading'));
    btn.setAttribute('aria-label', mode === 'loading' ? '업데이트 중' : '지금 새로고침');
    if (bar) bar.hidden = mode !== 'loading';
    if (mode === 'loading') document.getElementById('status').innerHTML = '<span class="spin-dot"></span>업데이트 중…';
    if (mode === 'done' || mode === 'fail') doneTimer = setTimeout(() => setRefreshUi('idle'), 1500);
  }
  function manualRefresh() {
    try { navigator.vibrate?.(12); } catch {}
    if (manualRunning) return; // 이미 진행 중이면 그대로 둔다
    manualRunning = true;
    setRefreshUi('loading');
    if (busy) { manualQueued = true; return; } // 자동 갱신이 끝나면 이어서 실행
    refresh('manual');
  }
  async function refresh(kind = 'auto') {
    if (busy) return;
    busy = true;
    try {
      if (kind !== 'light' || !state.data) {
        const had = !!state.data;
        await loadData().catch((e) => { if (!state.data) throw e; });
        if (!had || kind === 'boot') renderAll(); // 처음엔 서버 데이터로 먼저 그린다(이미 화면이 있으면 동기화가 끝난 뒤 한 번만 그린다)
        Promise.all([loadKlines('1d'), state.range !== '1d' ? loadKlines(state.range) : null])
          .then(() => { renderPriceCard(); renderPriceChart(); }).catch(() => {});
        if (kind === 'manual') loadPxSnapshot().then(schedulePaint).catch(() => {});
      }
      state.syncKind = kind;
      const ed = earnDay(state.stock);
      const stockP = kind !== 'light' ? stockParts(state.stock) : ed ? (state.stock === 'CRCL' ? ['earnings', 'analyst', 'news'] : ['searn', 'analyst', 'snews']) : [];
      const r = await syncNow([...SYNC_SETS[kind], ...stockP]);
      if (state.booting) { state.booting = false; busyBar(false); }
      renderAll();
      if (kind === 'boot') bootSlow();
      if (kind === 'boot' && MOVE_CODE) openMove('recv', MOVE_CODE);
      if (kind !== 'light') setTimeout(prefetchStocks, 1500);
      if (kind === 'manual') {
        const now = new Date(), t = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
        manualRunning = false;
        setRefreshUi(r.fail.length ? 'fail' : 'done');
        renderStatus();
        toast(r.fail.length
          ? `업데이트 ${t} · 일부 항목을 받지 못했어요(${r.fail.map((f) => SYNC_NAMES[f]).join(', ')}) · 이전 값을 보여줘요`
          : `✓ 업데이트 완료 · ${t}`, r.fail.length > 0);
      }
    } catch (e) {
      if (state.booting) { state.booting = false; busyBar(false); }
      if (kind === 'manual') { manualRunning = false; setRefreshUi('fail'); toast('업데이트 실패 · 인터넷 연결을 확인하세요', true); }
      document.getElementById('status').innerHTML = '<span class="warn">데이터를 불러오지 못했어요 · 새로고침을 눌러 다시 시도하세요</span>';
    } finally {
      busy = false;
      if (manualQueued) { manualQueued = false; refresh('manual'); }
    }
  }

  // ---------------------------------------------------------------- 화면 전환 (하단 탭)
  const VIEW_TITLES = {
    home: "Fire Portfolio", fire: 'Fire · 퇴사까지', flow: '시장 자금 동향', mkt: '지수·환율 차트',
    crcl: '서클 주가 · 수급', earn: '서클 실적', usdc: 'USDC · 스테이블코인', arc: 'Arc 체인', news: '서클 뉴스 · 공시',
    sprice: '주가 · 수급', searn: '실적', snews: '뉴스 · 공시',
  };
  const viewTitle = (v) => {
    const S = STOCK_INFO[state.stock];
    const nm = isKR(state.stock) ? S.name : S.short; // 한국 종목은 전체 이름(길면 화면에서 … 처리)
    if (v === 'sprice') return `${nm} 주가 · 수급`;
    if (v === 'searn') return isKR(state.stock) ? `${nm} 실적` : isEtf(state.stock) ? `${S.short} 분배금` : S.earnTitle;
    if (v === 'snews') return `${nm} 뉴스 · 공시`;
    if (v === 'fire' && state.fireTab === 'div') return 'Fire · 배당금';
    if (v === 'fire' && state.fireTab === 'bonus') return 'Fire · 성과급 계산기';
    return VIEW_TITLES[v];
  };
  const scrollMem = {};
  function showView(v, target) {
    if (!VIEW_TITLES[v] || !viewAllowed(v)) v = 'home';
    if (state.view !== v) scrollMem[state.view] = window.scrollY;
    if (v === 'fire' && state.view !== 'fire') state.prevView = state.view; // 🔥를 다시 누르면 돌아갈 화면
    if (v === 'fire' && (fireCfg || divCfg) && !DEMO) savePref('startV', '1');
    state.view = v;
    document.querySelectorAll('.view').forEach((el) => { el.hidden = el.dataset.view !== v; });
    document.querySelectorAll('[data-tab]').forEach((b) => (b.dataset.tab === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    document.getElementById('tabbar')?.classList.toggle('tb-on', v !== 'home' && !!document.querySelector(`.tb-row [data-tab="${v}"]`));
    document.getElementById('view-title').textContent = viewTitle(v);
    try { history.replaceState(null, '', '#' + v); } catch {}
    savePref('view', v);
    flushCharts();
    for (const c of Object.values(charts)) if (c.canvas?.closest('.view')?.dataset.view === v) c.resize();
    fireLoop(v === 'fire' || isOther());
    if (v === 'fire') { applyFireTab(); renderFire(); renderDiv(); renderDivSim(); renderBonus(); renderTax(); renderFinInc(); renderAcct(); renderEtfTax(); if (state.divSub === 'grow') renderGrow(); if (!state.quote) loadQuote().then(() => { renderFire(); renderDiv(); }).catch(() => renderFire()); loadDividends().catch(() => {}); }
    if (v === 'earn') renderEarnings();
    if (v === 'searn') renderSEarnings();
    if (v === 'mkt') renderMkChart();
    if (v === 'flow') { renderFlowView(); loadFlow().then(() => { renderFlowView(); renderFlowCard(); }).catch(() => {}); }
    if (v === 'sprice' && isKR(state.stock)) { renderSPriceChart(); renderKrDeal(state.stock); renderKrAnalyst(state.stock); }
    else if (v === 'sprice') { renderSPriceChart(); renderShort(shortOf(state.stock), 'sshort', STOCK_INFO[state.stock].short); renderHolders(state.stock, 'sholders'); renderAnalyst(); renderInsider(); renderOptions(); }
    if (v === 'crcl') { renderHolders('CRCL', 'holders'); renderAnalyst('CRCL'); renderInsider('CRCL'); renderOptions('CRCL'); }
    if (v === 'news' || v === 'snews') { markNewsSeen(); renderNewsSummary(); renderNews(); renderKwNews(); } else updateNewsBadge();
    updateFireChip();
    if (v !== 'fire') markUse(v);
    if (target) {
      const el = document.getElementById(target);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - document.querySelector('.top').offsetHeight - 10;
        window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
        el.classList.remove('pulse-card');
        void el.offsetWidth;
        el.classList.add('pulse-card');
      }
    } else {
      window.scrollTo({ top: scrollMem[v] || 0, behavior: 'instant' });
    }
  }
  function updateBasisBtn() {
    document.getElementById('basis').textContent = `비교 · ${state.basis === 'prev' ? '직전' : '24h'}`;
  }

  // ---------------------------------------------------------------- 이벤트
  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'fire-form') { ev.preventDefault(); saveFireForm(); }
    if (ev.target.id === 'div-form') { ev.preventDefault(); saveDivForm(); }
    if (ev.target.dataset?.kwform) { ev.preventDefault(); addKw(ev.target.elements.kw.value); }
  });
  // 화면 맨 위에서 아래로 당기면 새로고침 — 홈 화면에 추가한 앱 모드에도 동작, 브라우저 기본 당김은 CSS(overscroll-behavior)로 끔
  (() => {
    const TH = 70, MAX = 120;
    let y0 = null, x0 = 0, dy = 0, armed = false, el = null;
    const ind = () => {
      if (!el) { el = document.createElement('div'); el.className = 'ptr'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = '<i class="ptr-ic"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg></i><span>당겨서 새로고침</span>'; document.body.appendChild(el); }
      el.style.top = `${Math.round(document.querySelector('.top')?.getBoundingClientRect().bottom || 60)}px`;
      return el;
    };
    const reset = () => { dy = 0; armed = false; if (el) { el.classList.remove('on', 'armed'); el.style.setProperty('--ptr-y', '0px'); } };
    document.addEventListener('touchstart', (e) => {
      y0 = null;
      if (e.touches.length !== 1 || window.scrollY > 2 || document.body.classList.contains('sheet-open') || e.target.closest?.('input, textarea, select, canvas, .div-scroll, .news-alert')) return;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; armed = false;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      const d = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
      if (!dy && dx > Math.abs(d)) { y0 = null; return; } // 옆으로 넘기는 동작
      if (d <= 0 || window.scrollY > 2) { if (dy) reset(); return; }
      dy = Math.min(MAX, d * 0.55);
      const p = Math.min(1, dy / TH), x = ind();
      x.classList.add('on'); x.style.setProperty('--ptr-y', `${dy}px`); x.style.setProperty('--ptr-p', p);
      if ((p >= 1) !== armed) {
        armed = p >= 1; x.classList.toggle('armed', armed);
        x.querySelector('span').textContent = armed ? '놓으면 새로고침' : '당겨서 새로고침';
        if (armed) try { navigator.vibrate?.(8); } catch {}
      }
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (y0 == null) return;
      y0 = null;
      if (!armed) { reset(); return; }
      const x = ind(); x.classList.add('spin'); x.querySelector('span').textContent = '새로고침 중…';
      x.style.setProperty('--ptr-y', `${TH}px`);
      manualRefresh();
      setTimeout(() => { x.classList.remove('spin'); reset(); }, 1100);
    }, { passive: true });
    document.addEventListener('touchcancel', () => { y0 = null; reset(); }, { passive: true });
  })();
  // 숫자 입력칸: 0이 들어 있는 채로 숫자를 치면 앞의 0을 지운다(0에 10을 치면 "010"이 아니라 "10"), 0만 있으면 누를 때 전체 선택
  const isNumInput = (t) => t instanceof HTMLInputElement && (t.inputMode === 'numeric' || t.inputMode === 'decimal' || t.type === 'number');
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!isNumInput(t)) return;
    const v = t.value, nv = v.replace(/^(-?)0+(?=\d)/, '$1');
    if (nv === v) return;
    const pos = Math.max(0, (t.selectionStart ?? nv.length) - (v.length - nv.length));
    t.value = nv;
    try { t.setSelectionRange(pos, pos); } catch {}
  }, true);
  document.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (isNumInput(t) && /^0([.,]0*)?$/.test(t.value.trim())) setTimeout(() => { try { t.select(); } catch {} }, 0);
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'watch-q') { watchSearch(ev.target.value); return; }
    if (ev.target.dataset?.ac) { acInput(ev.target); return; }
    if (ev.target.closest?.('#c-bonus')) { bonusInput(); return; }
    if (ev.target.id === 'life-monthly') { lifeCfg.monthly = parseInt(ev.target.value.replace(/\D/g, ''), 10) || 0; writeJSON(LIFE_KEY, lifeCfg); const o = document.getElementById('life-out'); if (o) o.innerHTML = lifeHtml(); return; }
    if (ev.target.id === 'sim-q') { simSearch(ev.target.value); return; }
    if (ev.target.id === 'sim-goal') { simCfg.goal = parseInt(ev.target.value.replace(/\D/g, ''), 10) || 0; writeJSON(SIM_KEY, simCfg); const o = document.getElementById('sim-goal-out'); if (o) o.innerHTML = simGoalHtml(); return; }
    if (ev.target.classList?.contains('sim-w')) { // 비중은 0~100 정수만
      let v = ev.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      if (+v > 100) v = '100';
      if (v !== ev.target.value) ev.target.value = v;
    }
    if (ev.target.closest?.('#c-divsim')) { readSimForm(); paintSimWeight(); return; }
    if (ev.target.id === 'sim-range') {
      fireSim = parseFloat(ev.target.value);
      const t = document.getElementById('sim-top');
      if (t) t.innerHTML = simTopHtml(fireSim);
    } else if (ev.target.id === 'f-goal') {
      const h = document.getElementById('f-goal-hint');
      const g = parseFloat(ev.target.value.replace(/,/g, ''));
      if (h) h.textContent = g > 0 ? wonFull(g) : '';
    }
  });
  document.addEventListener('click', (ev) => {
    const ez = ev.target.closest('[data-easy]');
    if (ez) {
      const id = ez.dataset.easy, panel = document.getElementById('easy-' + id);
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      ez.setAttribute('aria-expanded', String(open));
      open ? state.openMore.add('easy:' + id) : state.openMore.delete('easy:' + id);
      return;
    }
    const info = ev.target.closest('[data-info]');
    if (info) {
      const id = info.dataset.info;
      const panel = document.getElementById('info-' + id);
      const open = panel.hidden;
      panel.hidden = !open;
      info.setAttribute('aria-expanded', String(open));
      open ? state.openInfo.add(id) : state.openInfo.delete(id);
      return;
    }
    const go = ev.target.closest('[data-go]');
    if (go) {
      // 🔥 Fire 버튼: Fire 화면에서 다시 누르면 직전 화면으로
      if (go.id === 'fire-chip' && state.view === 'fire') { showView(state.prevView && viewAllowed(state.prevView) ? state.prevView : 'home'); return; }
      // 왼쪽 위 개미 로고: 홈으로(이미 홈이면 맨 위로)
      if (go.dataset.go === 'home' && state.view === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const [v, target] = go.dataset.go.split(':');
      if (v === 'fire' && target === 'c-fire' && state.fireTab !== 'fire') { state.fireTab = 'fire'; savePref('fireTab', 'fire'); }
      showView(v, target);
      return;
    }
    const tab = ev.target.closest('[data-tab]');
    if (tab) {
      if (tab.dataset.tab === state.view) window.scrollTo({ top: 0, behavior: 'smooth' });
      else showView(tab.dataset.tab);
      return;
    }
    const stk = ev.target.closest('[data-stock]');
    if (stk) { setStock(stk.dataset.stock); return; }
    const stn = ev.target.closest('[data-sumtone]');
    if (stn) { const [id, t] = stn.dataset.sumtone.split(':'); sumTone[id] = sumTone[id] === t ? 'all' : t; if (id === 'summary') renderSummary(); else renderSSummary(); return; }
    if (ev.target.closest('[data-stocksheet]')) { openStockSheet(); return; }
    if (ev.target.closest('#bell-btn')) { openBell(); return; }
    if (ev.target.closest('[data-ntclose]')) { closeBell(); return; }
    const ntg = ev.target.closest('[data-ntgo]');
    if (ntg) { const x = document.getElementById('nt-sheet')?._items?.[+ntg.dataset.ntgo]; closeBell(); if (x) goTarget(x.go); return; }
    const seg = ev.target.closest('[data-segoto]');
    if (seg) { goTarget({ sym: seg.dataset.segoto, v: 'earn' }); return; }
    const bmr = ev.target.closest('[data-benchrange]');
    if (bmr) { state.benchRange = bmr.dataset.benchrange; savePref('benchRange', state.benchRange); const c = fireCfg && state.quote ? (() => { try { return fireCalc(); } catch { return null; } })() : null; renderBench(c); return; }
    if (ev.target.closest('[data-swclose]')) { closeStockSheet(); return; }
    const swp = ev.target.closest('[data-swpick]');
    if (swp) { pickStockFromSheet(swp.dataset.swpick); return; }
    const mkt = ev.target.closest('[data-mktab]');
    if (mkt) { savePref('mktab', mkt.dataset.mktab); applyMkTab(); return; }
    if (ev.target.closest('[data-hsmore]')) { savePref('hsmore', loadPref('hsmore', '0') === '1' ? '0' : '1'); applyHsMore(); return; }
    const mkg = ev.target.closest('[data-mkgo]');
    if (mkg) { state.mkSym = mkg.dataset.mkgo; savePref('mksym', state.mkSym); if (state.view === 'mkt') renderMkChart(); else { showView('mkt'); window.scrollTo({ top: 0 }); } return; }
    if (ev.target.closest('[data-mkback]')) { savePref('mktab', 'market'); applyMkTab(); showView('home'); requestAnimationFrame(() => { const el = document.getElementById('mk-tabs'); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - document.querySelector('.top').offsetHeight - 10 }); }); return; }
    const mkr = ev.target.closest('[data-mkrange]');
    if (mkr) { state.mkRange = mkr.dataset.mkrange; savePref('mkrange', state.mkRange); renderMkChart(); return; }
    const tpl = ev.target.closest('[data-taxpl]');
    if (tpl) { taxCfg.pl = tpl.dataset.taxpl; writeJSON(TAX_KEY, taxCfg); for (const b of document.querySelectorAll('[data-taxpl]')) b.setAttribute('aria-pressed', String(b.dataset.taxpl === taxCfg.pl)); const o = document.getElementById('tax-out'); if (o) o.innerHTML = taxOutHtml(); renderHomeFire(); return; }
    const slb = ev.target.closest('[data-sharelink]');
    if (slb) { shareLink(slb.dataset.sharelink, slb); return; }
    const scb = ev.target.closest('[data-sharecard]');
    if (scb) { openShare(scb.dataset.sharecard, scb); return; }
    const dsb = ev.target.closest('[data-dsub]');
    if (dsb) { setDivSub(dsb.dataset.dsub); applyFireTab(); if (state.divSub === 'sim') renderDivSim(); else if (state.divSub === 'grow') renderGrow(); else renderDiv(); markUse(state.divSub === 'sim' ? 'divsim' : 'div'); return; }
    const gpk = ev.target.closest('[data-growpick]');
    if (gpk) { const t = gpk.dataset.growpick, i = growCfg.rows.findIndex((r) => r.t === t); if (i >= 0) growCfg.rows.splice(i, 1); else growAdd(t); growSave(); renderGrow(); return; }
    const grm = ev.target.closest('[data-growrm]');
    if (grm) { growCfg.rows.splice(+grm.dataset.growrm, 1); growSave(); renderGrow(); return; }
    const grs = ev.target.closest('[data-growres]');
    if (grs) { growAdd(grs.dataset.growres, grs.dataset.n || ''); growSearchOpen = false; growResults = []; renderGrow(); return; }
    if (ev.target.closest('[data-growadd]')) { growSearchOpen = !growSearchOpen; growResults = []; renderGrow(); document.getElementById('gr-q')?.focus(); return; }
    if (ev.target.closest('[data-growclose]')) { growSearchOpen = false; renderGrow(); return; }
    if (ev.target.closest('[data-groweq]')) { const n = growCfg.rows.length, b = Math.floor(100 / n); growCfg.rows.forEach((r, i) => { r.w = b + (i < 100 - b * n ? 1 : 0); }); growSave(); renderGrow(); return; }
    const mc = ev.target.closest('.more-close');
    if (mc) { const d = mc.closest('details.more'); if (d) { d.open = false; const y = d.getBoundingClientRect().top; if (y < 70) window.scrollBy({ top: y - 90 }); } return; }
    const sr = ev.target.closest('[data-srange]');
    if (sr) { state.srange = sr.dataset.srange; savePref('jrange', state.srange); renderSPriceChart(); paintStock(); return; }
    if (ev.target.closest('[data-wedit]')) { openWatchSheet(); return; }
    if (ev.target.closest('[data-wclose]')) { closeWatchSheet(); return; }
    const wp = ev.target.closest('[data-wpop]');
    if (wp) { addPopular(wp.dataset.wpop, wp); return; }
    const wa = ev.target.closest('[data-wadd]');
    if (wa) { if (wa.dataset.wkr) addPopular(wa.dataset.wadd, wa); else addWatch(wa.dataset.wadd, { name: wa.dataset.wname, exchange: wa.dataset.wex, asset: wa.dataset.wasset }); return; } // 한글로 찾은 미국 종목은 영문 회사명을 찾아서 넣는다
    const wd = ev.target.closest('[data-wdel]');
    if (wd) { removeWatch(wd.dataset.wdel); return; }
    const wm = ev.target.closest('[data-wmove]');
    if (wm) { const [i, d] = wm.dataset.wmove.split(':').map(Number); moveWatch(i, d); return; }
    const kd = ev.target.closest('[data-kwdel]');
    if (kd) { delKw(kd.dataset.kwdel); return; }
    const ctp = ev.target.closest('[data-ctype]');
    if (ctp) { state.chartType = ctp.dataset.ctype; savePref('chartType', state.chartType); renderPriceChart(); if (isOther()) renderSPriceChart(); if (state.view === 'mkt') renderMkChart(); return; }
    const ctg = ev.target.closest('[data-ctoggle]');
    if (ctg) {
      const k = ctg.dataset.ctoggle === 'ma' ? 'chartMA' : 'chartVol';
      state[k] = !state[k]; savePref(k, state[k] ? '1' : '0');
      renderPriceChart(); if (isOther()) renderSPriceChart(); if (state.view === 'mkt') renderMkChart();
      return;
    }
    const bk = ev.target.closest('[data-brokers]');
    if (bk) { state.brokerAll = state.brokerAll === bk.dataset.brokers ? null : bk.dataset.brokers; renderAnalyst(bk.dataset.brokers); return; }
    const ht = ev.target.closest('[data-htab]');
    if (ht) { state.holdTab = ht.dataset.htab; savePref('holdTab', state.holdTab); renderHolders(state.stock); return; }
    const fg = ev.target.closest('[data-ftabgo]');
    if (fg) { state.fireTab = fg.dataset.ftabgo; savePref('fireTab', state.fireTab); showView('fire'); window.scrollTo({ top: 0 }); return; }
    const ft = ev.target.closest('[data-ftab]');
    if (ft) { state.fireTab = ft.dataset.ftab; savePref('fireTab', state.fireTab); applyFireTab(); if (state.fireTab === 'div') { renderDiv(); renderDivSim(); loadDividends().catch(() => {}); } if (state.fireTab === 'bonus') renderBonus(); if (state.fireTab === 'tax') { renderTax(); renderFinInc(); renderAcct(); renderEtfTax(); } if (state.fireTab === 'div' && state.divSub === 'grow') renderGrow(); window.scrollTo({ top: 0 }); return; }
    // 성과급 계산기
    const bco = ev.target.closest('[data-bnco]');
    if (bco) { readBonusForm(); bonusCfg.co = bco.dataset.bnco; writeJSON(BONUS_KEY, bonusCfg); renderBonus(); return; }
    if (ev.target.closest('[data-bngo]')) { bonusToSim(); return; }
    // 배당 포트폴리오 짜보기
    const su = ev.target.closest('[data-simunit]');
    if (su) {
      readSimForm();
      const fx = state.quote?.fx?.rate, to = su.dataset.simunit;
      if (to !== simCfg.unit && fx) simCfg.amount = to === 'usd' ? Math.round(((+simCfg.amount || 0) * 1e4) / fx) : Math.round(((+simCfg.amount || 0) * fx) / 1e4);
      simCfg.unit = to; writeJSON(SIM_KEY, simCfg); renderDivSim(); return;
    }
    const scat = ev.target.closest('[data-simcat]');
    if (scat) { readSimForm(); simCat = simCat === scat.dataset.simcat ? null : scat.dataset.simcat; renderDivSim(); if (simCat) loadCatYields(simCat); return; }
    const spick = ev.target.closest('[data-simpick]');
    if (spick) {
      readSimForm();
      const t = spick.dataset.simpick, rows = simCfg.rows.filter((r) => r.t);
      if (!rows.some((r) => r.t === t)) {
        const left = Math.round(100 - rows.reduce((a, r) => a + (+r.w || 0), 0));
        simCfg.rows = [...rows, { t, n: simCatName(t) || undefined, w: left > 0 ? left : 0 }];
      }
      writeJSON(SIM_KEY, simCfg); renderDivSim(); return;
    }
    if (ev.target.closest('[data-simeq]')) { readSimForm(); const rows = simCfg.rows.filter((r) => r.t); rows.forEach((r) => { r.w = 0; }); simCfg.rows = rows; normalizeSimWeights(); writeJSON(SIM_KEY, simCfg); renderDivSim(); return; }
    if (ev.target.closest('[data-simadd]')) { readSimForm(); simSearchOpen = !simSearchOpen; simResults = []; renderDivSim(); document.getElementById('sim-q')?.focus(); return; }
    const ls = ev.target.closest('[data-lifesim]');
    if (ls) { simCfg.goal = +ls.dataset.lifesim; writeJSON(SIM_KEY, simCfg); state.fireTab = 'div'; savePref('fireTab', 'div'); setDivSub('sim'); applyFireTab(); renderDiv(); renderDivSim(); setTimeout(() => document.getElementById('sim-goal')?.closest('.sim-goal')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) || document.getElementById('c-divsim')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150); return; }
    const jc = ev.target.closest('[data-jtcat]');
    if (jc) { jtCat = jc.dataset.jtcat; renderJobyTimeline(); return; }
    const sg = ev.target.closest('[data-simgoal]');
    if (sg) { readSimForm(); simCfg.unit = 'manwon'; simCfg.amount = +sg.dataset.simgoal; writeJSON(SIM_KEY, simCfg); runSim(); return; }
    if (ev.target.closest('[data-simclose]')) { readSimForm(); simSearchOpen = false; renderDivSim(); return; }
    if (ev.target.closest('[data-simreset]')) {
      if (!simCfg.rows.length || !confirm(EN ? 'Remove all tickers from the planner?' : '추가한 종목을 모두 지울까요? (투자금은 그대로 둬요)')) return;
      simCfg.rows = []; simCat = null; simSearchOpen = true; simResults = []; writeJSON(SIM_KEY, simCfg); renderDivSim();
      document.getElementById('c-divsim')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      toast(EN ? 'Cleared — add tickers again' : '종목을 모두 지웠어요. 분류에서 고르거나 검색해 다시 넣어 주세요');
      return;
    }
    const sres = ev.target.closest('[data-simres]');
    if (sres) {
      readSimForm();
      const t = sres.dataset.simres, rows = simCfg.rows.filter((r) => r.t);
      if (!rows.some((r) => r.t === t)) {
        const left = Math.round(100 - rows.reduce((a, r) => a + (+r.w || 0), 0));
        simCfg.rows = [...rows, { t, n: sres.dataset.n || undefined, w: left > 0 ? left : 0 }];
        keepName(sres.dataset.n);
      }
      simSearchOpen = false; writeJSON(SIM_KEY, simCfg); renderDivSim();
      document.querySelector(`.sim-row[data-t="${t}"] .sim-w`)?.focus();
      return;
    }
    const srm = ev.target.closest('[data-simrm]');
    if (srm) { readSimForm(); simCfg.rows.splice(+srm.dataset.simrm, 1); writeJSON(SIM_KEY, simCfg); renderDivSim(); return; }
    if (ev.target.closest('[data-simrun]')) { runSim(); return; }
    if (ev.target.closest('[data-naclose]')) { closeNewsAlert(); return; }
    if (ev.target.closest('[data-naopen]')) { closeNewsAlert(); return; }
    if (ev.target.closest('[data-nago]')) { closeNewsAlert(); const o = isOther(); showView(o ? 'snews' : 'news', o ? 'c-skwnews' : 'c-kwnews'); return; }
    if (ev.target.closest('#d-add')) { syncRowsFromDom(); divRows.push({}); paintRows(); return; }
    const drm = ev.target.closest('[data-drm]');
    if (drm) { syncRowsFromDom(); divRows.splice(+drm.dataset.drm, 1); paintRows(); return; }
    if (ev.target.closest('#d-del')) { deleteDiv(); return; }
    const dtx = ev.target.closest('[data-dtx]');
    if (dtx) { openTxSheet(+dtx.dataset.dtx); return; }
    if (ev.target.closest('[data-txclose]')) { closeTxSheet(); return; }
    if (ev.target.closest('#oc-add')) { addOcrRows(); return; }
    if (ev.target.closest('#tx-add')) { addManualTrade(); return; }
    if (ev.target.closest('#tx-done')) { finishTx(); return; }
    if (ev.target.closest('#tx-clear')) { txDraft = []; paintTxList(); return; }
    const txrm = ev.target.closest('[data-txrm]');
    if (txrm) { txDraft.splice(+txrm.dataset.txrm, 1); paintTxList(); return; }
    if (ev.target.closest('#d-import')) { importFireToDiv(); return; }
    const dm = ev.target.closest('[data-demo]');
    if (dm) { try { dm.dataset.demo === 'on' ? sessionStorage.setItem('cw.demo', '1') : sessionStorage.removeItem('cw.demo'); } catch {} markUse('home'); location.href = location.pathname + (dm.dataset.demo === 'on' ? '#home' : '#home'); location.reload(); return; }
    const stb = ev.target.closest('[data-start]');
    if (stb) {
      const k = stb.dataset.start;
      if (k === 'watch') { openWatchSheet(); return; }
      state.fireTab = 'fire'; savePref('fireTab', 'fire'); showView('fire'); window.scrollTo({ top: 0 });
      if (k === 'hold') openHoldImport('fire', null, 'shot');
      return;
    }
    const fdb = ev.target.closest('[data-folder]');
    if (fdb) { savePref('folder', fdb.dataset.folder); renderStockSwitch(); const fs = folderSyms(); if (fs.length && !fs.includes(state.stock)) setStock(fs[0]); return; } // 폴더를 바꾸면 그 폴더 첫 종목을 보여 준다
    if (ev.target.closest('[data-fnew]')) { openFolderSheet(null); return; }
    const fde = ev.target.closest('[data-fedit]');
    if (fde) { openFolderSheet(fde.dataset.fedit); return; }
    if (ev.target.closest('[data-fclose]')) { closeFolderSheet(); return; }
    if (ev.target.closest('[data-fsave]')) { saveFolder(); return; }
    if (ev.target.closest('[data-fdel]')) { deleteFolder(); return; }
    if (ev.target.closest('[data-sstoggle]')) { savePref('ssExpand', ssExpanded() ? '0' : '1'); renderStockSwitch(); return; }
    if (ev.target.closest('[data-homeedit]')) { openHomeEdit(); return; }
    if (ev.target.closest('[data-heclose]')) { closeHomeEdit(); return; }
    const hem = ev.target.closest('[data-hemove]');
    if (hem) { const [k, d] = hem.dataset.hemove.split(':'), L = homeLayout(), i = L.order.indexOf(k), j = i + +d; if (j >= 0 && j < L.order.length) { [L.order[i], L.order[j]] = [L.order[j], L.order[i]]; saveHomeLayout(L); } return; }
    if (ev.target.closest('[data-hereset]')) { saveHomeLayout({}); return; }
    if (ev.target.closest('[data-weekclose]')) { savePref('weekClosed', weekKey()); document.getElementById('c-week').hidden = true; return; }
    const tg = ev.target.closest('[data-tgt]');
    if (tg) { openTgt(tg.dataset.tgt); return; }
    const tgs = ev.target.closest('[data-tgtsave]');
    if (tgs) { saveTgt(tgs.dataset.tgtsave); return; }
    const tgd = ev.target.closest('[data-tgtdel]');
    if (tgd) { saveTgt(tgd.dataset.tgtdel, true); return; }
    const tgx = ev.target.closest('[data-tgtx]');
    if (tgx) { const host = document.querySelector(`[data-tgthost="${CSS.escape(tgx.dataset.tgtx)}"]`); if (host) host.innerHTML = tgtHtml(tgx.dataset.tgtx); return; }
    const frg = ev.target.closest('[data-flowrange]');
    if (frg) { state.flowRange = frg.dataset.flowrange; savePref('flowRange', state.flowRange); renderFlowView(); return; }
    const vb = ev.target.closest('[data-vote]');
    if (vb) { const [k, v] = vb.dataset.vote.split('|'); castVote(k, +v); return; }
    const mo = ev.target.closest('[data-moveopen]');
    if (mo) { ev.preventDefault(); openMove(mo.dataset.moveopen); return; }
    if (ev.target.closest('[data-schedclose]')) { schedClosed = true; renderSched(); return; }
    const sgo = ev.target.closest('[data-sincego]');
    if (sgo) {
      const [sym, kind] = sgo.dataset.sincego.split(':');
      if (WATCH.includes(sym) && state.stock !== sym) setStock(sym);
      if (kind === 'stock') { document.getElementById('stock-switch')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      showView(sym === 'CRCL' ? kind : 's' + kind); window.scrollTo({ top: 0 });
      return;
    }
    const mss = ev.target.closest('[data-msshare]');
    if (mss) { const m = +mss.dataset.msshare; openShare('fire', mss, { title: m >= 100 ? (EN ? '🎊 FIRE goal reached!' : '🎊 퇴사 목표 달성!') : (EN ? `🎉 ${m}% to FIRE!` : `🎉 퇴사 목표 ${m}% 달성`) }); document.querySelector('.ms-sheet')?.remove(); return; }
    if (ev.target.closest('[data-msclose]') || ev.target.classList?.contains('ms-sheet')) { document.querySelector('.ms-sheet')?.remove(); return; }
    const hio = ev.target.closest('[data-hiopen]');
    if (hio) { openHoldImport(hio.dataset.hiopen, hio, hio.dataset.himode0); return; }
    if (ev.target.closest('#f-add')) { fireRows = readFireRows(); fireRows.push({ ticker: fireTickerOrder().find((k) => !fireRows.some((r) => r.ticker === k)) || 'CRCA' }); document.getElementById('f-rows').innerHTML = fireRows.map(fireRowHtml).join(''); return; }
    const rmBtn = ev.target.closest('[data-rm]');
    if (rmBtn) { fireRows = readFireRows(); fireRows.splice(+rmBtn.dataset.rm, 1); document.getElementById('f-rows').innerHTML = fireRows.map(fireRowHtml).join(''); return; }
    const simBtn = ev.target.closest('[data-sim]');
    if (simBtn) { fireSim = parseFloat(simBtn.dataset.sim); const c = fireCalc(); if (c) renderFireSim(c); return; }
    if (ev.target.closest('#f-del')) { deleteFire(); return; }
    const nf = ev.target.closest('[data-nf]');
    if (nf) { const U = curUI(); U.filter = nf.dataset.nf; savePref(U.filterKey, U.filter); renderNews(); return; }
    if (ev.target.id === 'major-only') { state.majorOnly = ev.target.checked; savePref('majorOnly', state.majorOnly ? '1' : '0'); renderNews(); return; }
    const rg = ev.target.closest('[data-range]');
    if (rg) { state.range = rg.dataset.range; savePref('range', state.range); renderPriceChart(); return; }
    if (ev.target.closest('#basis')) {
      state.basis = state.basis === 'prev' ? '24h' : 'prev';
      savePref('basis', state.basis);
      updateBasisBtn();
      renderAll();
      return;
    }
    if (ev.target.closest('#cctp-more')) { state.cctpAll = !state.cctpAll; renderCctp(); return; }
    if (ev.target.closest('#refresh')) manualRefresh();
    if (ev.target.closest('#share-btn')) shareSite();
    const acn = ev.target.closest('[data-acnow]'); if (acn) { const x = pxOf(acn.dataset.acnow); if (x) acSetBuy(acn.dataset.acnow, x); else toast(EN ? 'Price not loaded yet' : '아직 시세를 받는 중이에요', true); return; }
    const acd = ev.target.closest('[data-acdrop]'); if (acd) { const x = pxOf(acd.dataset.sym); if (x) acSetBuy(acd.dataset.sym, x * (1 + acd.dataset.acdrop / 100)); else toast(EN ? 'Price not loaded yet' : '아직 시세를 받는 중이에요', true); return; }
    const mme = ev.target.closest('[data-memoedit]'); if (mme) { memoEdit = mme.dataset.memoedit; renderMemo(memoEdit); document.getElementById('memo-why')?.focus(); return; }
    const mms = ev.target.closest('[data-memosave]'); if (mms) { saveMemo(mms.dataset.memosave); return; }
    if (ev.target.closest('[data-memox]')) { const s0 = memoEdit; memoEdit = null; if (s0) renderMemo(s0); return; }
    const mmd = ev.target.closest('[data-memodel]'); if (mmd) { const s0 = mmd.dataset.memodel; delete memos[s0]; writeJSON(MEMO_KEY, memos); memoEdit = null; renderMemo(s0); try { renderEarnDay(s0); } catch {} toast(EN ? 'Memo deleted' : '메모를 지웠어요'); return; }
    if (ev.target.closest('#theme-btn')) { setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); return; }
    const lb = ev.target.closest('#lang-btn');
    if (lb) {
      try { localStorage.setItem('cw.lang', EN ? 'ko' : 'en'); } catch {}
      lb.disabled = true; lb.textContent = '…';
      // ?lang=… 이 붙어 있으면 지운 주소로, 아니면 그대로 새로고침(같은 주소로 replace 하면 # 이동만 되고 새로고침이 안 됨)
      if (location.search) location.replace(location.pathname + location.hash); else location.reload();
      return;
    }
    if (ev.target.closest('[data-welcome-close]')) { savePref('welcomed', '1'); savePref('startClosed', '1'); startShow = false; renderWelcome(); }
    if (ev.target.closest('[data-news-close]')) { savePref('seenNews', window.__WHATSNEW?.id || ''); const n = document.getElementById('c-whatsnew'); if (n) n.hidden = true; }
  });

  // ---------------------------------------------------------------- 방문 집계(익명) · 공유
  // 공유 주소에서만, 페이지를 열 때 한 번: 기기마다 무작위 ID + 유입 경로만 보낸다(관리자 페이지에서만 조회)
  const SITE_URL = 'https://my-fire-portfolio.pages.dev/';
  // 한 번만 보낸다(시작할 때 · 또는 그 전에 오류가 나면 오류 보고와 함께). 시작 코드보다 먼저 불릴 수 있어 window에 둔다
  function countVisit() {
    if (window.__fpVisit) return window.__fpVisit;
    const noCount = (() => { try { return JSON.parse(localStorage.getItem('cw.noCount')) === true; } catch { return false; } })();
    if (!ON_PAGES || !IS_PROD || noCount) return (window.__fpVisit = Promise.resolve(false));
    try {
      let vid = localStorage.getItem('cw.vid'), isNew = 0;
      if (!/^[a-z0-9]{16,40}$/.test(vid || '')) {
        vid = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
        localStorage.setItem('cw.vid', vid); isNew = 1;
      }
      const qs = new URLSearchParams(location.search);
      let ref = qs.get('ref') || qs.get('utm_source') || '';
      if (!ref && document.referrer) { try { const h = new URL(document.referrer).hostname; if (h !== location.hostname) ref = h; } catch {} }
      const dev = matchMedia('(pointer: coarse)').matches ? 'm' : 'd';
      window.__fpVisit = fetch(`/api/hit?v=${vid}&n=${isNew}&d=${dev}&l=${LANG}${ref ? '&r=' + encodeURIComponent(ref.slice(0, 80)) : ''}`, { cache: 'no-store', keepalive: true }).then(() => vid, () => false);
      // 주소창에 붙은 ?ref=… 는 지운다(화면 이동은 #으로 하므로 그대로)
      if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    } catch { window.__fpVisit = Promise.resolve(false); }
    return window.__fpVisit;
  }
  // 그날 처음 연 화면·처음 쓴 기능만 비트 하나로 알린다(종목·금액 같은 값은 보내지 않음) → 관리자 페이지 '많이 쓰는 화면·기능'
  // 순서는 functions/api/admin/stats.js 의 USE_BITS 와 같아야 한다
  function markUse(name) {
    try {
      const BITS = ['home', 'crcl', 'earn', 'usdc', 'arc', 'news', 'fire', 'div', 'sprice', 'searn', 'snews', 'fireSet', 'divSet', 'watch', 'ocr', 'share', 'blog', 'bonus', 'divsim', 'kr', 'sns', 'hold'];
      const i = BITS.indexOf(name);
      if (i < 0 || !IS_PROD) return;
      const U = (window.__fpUse ||= { day: '', sent: 0, pend: 0, t: null });
      const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      if (U.day !== day) { const m = String(localStorage.getItem('cw.useSent') || '').split(':'); U.day = day; U.sent = m[0] === day ? +m[1] || 0 : 0; }
      const b = 1 << i;
      if ((U.sent | U.pend) & b) return;
      U.pend |= b;
      clearTimeout(U.t);
      U.t = setTimeout(() => countVisit().then((vid) => {
        if (!vid || !U.pend) return;
        const bits = U.pend; U.pend = 0; U.sent |= bits;
        try { localStorage.setItem('cw.useSent', `${U.day}:${U.sent}`); } catch {}
        fetch(`/api/hit?k=u&v=${vid}&u=${bits}`, { cache: 'no-store', keepalive: true }).catch(() => {});
      }), 1200);
    } catch {}
  }
  // 화면 오류는 관리자 페이지 '화면 오류'에 모은다(운영 주소만 · 한 번 열 때 최대 3건 · 네트워크 끊김 같은 흔한 일은 빼고)
  function reportErr(msg, file) {
    try {
      if (!IS_PROD) return;
      const E = (window.__fpErr ||= { n: 0, seen: new Set() });
      msg = String(msg || '').slice(0, 300);
      if (!msg || E.n >= 3 || E.seen.has(msg)) return;
      if (/Failed to fetch|Load failed|NetworkError|network error|AbortError|aborted|timed? ?out|ResizeObserver loop|^Script error\.?$|WebSocket|ChunkLoad/i.test(msg)) return;
      if (file && !/^https:\/\/my-fire-portfolio\.pages\.dev\//.test(file)) return; // 확장 프로그램·다른 사이트 스크립트
      E.seen.add(msg); E.n++;
      const where = file ? ' @' + String(file).split('/').pop().split('?')[0] : '';
      countVisit().then((vid) => { if (vid) fetch(`/api/hit?k=e&v=${vid}&m=${encodeURIComponent((msg + where).slice(0, 200))}`, { cache: 'no-store', keepalive: true }).catch(() => {}); });
    } catch {}
  }
  // 처음 온 방문자에게만 사용법 안내(닫으면 다시 안 보임). 기존 사용자(저장된 화면이 있는 기기)는 건너뛴다
  // 새로 업데이트된 내용(assets/whatsnew.js ← CHANGELOG): 전에 와 본 사람에게 업데이트마다 한 번 보여준다. 처음 온 사람은 사용법 안내만
  function renderWhatsNew(firstVisit) {
    const el = document.getElementById('c-whatsnew'), W = window.__WHATSNEW;
    if (!el) return;
    if (!W?.items?.length) { el.hidden = true; return; }
    if (firstVisit) { savePref('seenNews', W.id); el.hidden = true; return; }
    if (loadPref('seenNews', '') === W.id) { el.hidden = true; return; }
    const items = EN && W.en?.length ? W.en : W.items;
    el.hidden = false;
    el.innerHTML = `<div class="wc-head"><b>🎉 ${EN ? 'What’s new' : '새로 업데이트됐어요'}${W.ver ? ` <small>${esc(W.ver)}</small>` : ''}</b><button type="button" class="wc-x" data-news-close aria-label="${EN ? 'Close' : '닫기'}">×</button></div>
      <ul class="wn-list">${items.slice(0, 7).map((x) => `<li>${x}</li>`).join('')}</ul>
      <div class="wn-act"><a class="btn-ghost sm" href="updates?ref=whatsnew">${EN ? 'All updates' : '업데이트 소식 전체 보기'} →</a><button type="button" class="btn-primary wc-ok" data-news-close>${EN ? 'Got it' : '확인'}</button></div>`;
  }
  let startShow = false;
  function renderWelcome(firstVisit) {
    const el = document.getElementById('c-welcome');
    if (!el) return;
    if (firstVisit !== undefined) startShow = !DEMO && !loadPref('startClosed', '') && (firstVisit || (!fireCfg && !divCfg && !loadPref('welcomed', '')));
    const steps = [
      ['watch', WATCH.some((x) => !BUILTIN.includes(x)), EN ? 'Add your stocks' : '내 종목 추가하기', EN ? 'Any US or Korean stock on Home' : '관심 있는 미국·한국 주식을 홈에 넣어요', EN ? 'Add' : '추가하기'],
      ['hold', !!(fireCfg || divCfg), EN ? 'Enter your holdings' : '보유 종목 넣기', EN ? 'One broker screenshot or a CSV does it' : '증권 앱 캡처 한 장이나 CSV면 끝나요', EN ? 'Enter' : '넣기'],
      ['view', !!loadPref('startV', ''), EN ? 'See FIRE & dividends' : '퇴사까지·배당금 보기', EN ? 'How far to your goal, monthly dividends' : '목표까지 몇 %인지, 한 달 배당이 얼마인지', EN ? 'View' : '보기'],
    ];
    const done = steps.filter((x) => x[1]).length;
    if (!startShow || done === 3) { el.hidden = true; return; }
    el.hidden = false;
    const html = `<div class="wc-head"><b>${EN ? '👋 New here? Three steps to your own dashboard' : '👋 처음 오셨나요? 3단계면 내 대시보드가 돼요'}</b><button type="button" class="wc-x" data-welcome-close aria-label="${EN ? 'Close' : '안내 닫기'}">×</button></div>
      <button type="button" class="demo-go" data-demo="on"><b>👀 ${EN ? 'Look around with a sample portfolio' : '예시 포트폴리오로 먼저 둘러보기'}</b><small>${EN ? 'Every screen filled with sample holdings · nothing is saved' : '예시 보유 종목으로 모든 화면을 채워요 · 저장은 안 돼요'}</small></button>
      <ol class="st-list">${steps.map(([k, ok, t, d, b], n) => `<li class="${ok ? 'ok' : ''}"><span class="st-n">${ok ? '✓' : n + 1}</span><div><b>${t}</b><small>${d}</small></div>${ok ? '' : `<button type="button" class="chip-btn sm" data-start="${k}">${b}</button>`}</li>`).join('')}</ol>
      <div class="st-bar" aria-label="${done}/3"><i style="width:${(done / 3) * 100}%"></i></div>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  async function shareSite() {
    markUse('share');
    // 보고 있는 종목 화면으로 바로 열리는 링크(기본 종목일 때)
    const s = BUILTIN.includes(state.stock) && state.stock !== 'CRCL' ? `s=${state.stock}&` : '';
    const name = STOCK_INFO[state.stock]?.name || '';
    const data = { title: 'Fire Portfolio', text: `${s ? `${name}(${state.stock}) 실시간 주가·차트·뉴스 — ` : ''}퇴사를 위한 미국 주식 실시간 대시보드 · 서클·조비·스페이스X·템퍼스, 관심 종목 추가도 돼요`, url: `${SITE_URL}?${s}ref=share` };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(data.url);
      toast('✓ 링크를 복사했어요');
    } catch (e) { if (e?.name !== 'AbortError') toast(`링크: ${esc(SITE_URL)}`); }
  }

  if (!RANGES[state.range]) state.range = '1d';
  if (!SRANGES[state.srange]) state.srange = '1d';
  // ---------------------------------------------------------------- 🌙/☀️ 다크·라이트 모드 (assets/theme.js가 처음 테마를 붙임)
  function paintThemeBtn() {
    const b = document.getElementById('theme-btn'), light = document.documentElement.dataset.theme === 'light';
    if (!b) return;
    b.setAttribute('aria-checked', String(light));
    b.setAttribute('aria-label', light ? (EN ? 'Switch to dark mode' : '다크 모드로 바꾸기') : (EN ? 'Switch to light mode' : '라이트 모드로 바꾸기'));
    b.title = EN ? 'Dark / light mode' : '다크·라이트 모드 바꾸기';
  }
  function setTheme(t) {
    const old = { ...C };
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('cw.theme', t); } catch {}
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f3f5f8' : '#0d1015');
    readC();
    paintThemeBtn();
    if (window.Chart) Chart.defaults.color = C.muted;
    // 이미 그린 차트: 옛 테마 색으로 적힌 값만 새 색으로 바꿔 다시 그린다
    const swap = new Map(Object.keys(C).filter((k) => old[k] && old[k] !== C[k]).map((k) => [old[k], C[k]]));
    const walk = (o, d = 0) => {
      if (!o || typeof o !== 'object' || d > 6) return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === 'string' && swap.has(v)) o[k] = swap.get(v);
        else if (v && typeof v === 'object' && !(v instanceof Element) && !ArrayBuffer.isView(v)) walk(v, d + 1);
      }
    };
    for (const ch of Object.values(charts)) {
      try { walk(ch.config.options); for (const ds of ch.config.data.datasets || []) for (const k of Object.keys(ds)) if (k !== 'data') { const v = ds[k]; if (typeof v === 'string' && swap.has(v)) ds[k] = swap.get(v); else if (v && typeof v === 'object') walk(v); } ch.update('none'); } catch {}
    }
    try { renderAll(); renderStock(); } catch (e) { console.error(e); }
  }
  paintThemeBtn();
  { const lb = document.getElementById('lang-btn'); if (lb) { lb.textContent = EN ? 'KO' : 'EN'; lb.setAttribute('aria-label', EN ? '한국어로 보기' : 'View in English'); lb.setAttribute('lang', EN ? 'ko' : 'en'); } }
  const firstVisit = (() => { try { return !localStorage.getItem('cw.snapshot.v1'); } catch { return false; } })();
  const fromSnap = loadSnapshot();
  state.booting = true;
  updateBasisBtn();
  renderFireSet();
  renderDivSet();
  renderHomeFire();
  if (divCfg) loadDividends().catch(() => {});
  document.getElementById('home-crcl').hidden = isOther();
  document.getElementById('home-stock').hidden = !isOther();
  renderDemoBar();
  syncHeldToWatch(true);
  applyHomeLayout();
  state.flowRange = loadPref('flowRange', '3y');
  try { renderFlowCard(); } catch (e) { console.error(e); }
  setTimeout(loadSched, 1200);
  setTimeout(() => loadFlow().then(() => { renderFlowCard(); if (state.view === 'flow') renderFlowView(); }).catch(() => {}), 1800);
  renderStockSwitch();
  updateFireChip();
  {
    let v0 = location.hash.slice(1).split('&')[0] || loadPref('view', 'home'); v0 = OLD_VIEWS[v0] || v0;
    if (v0 === 'tax' || v0 === 'etftax') { // /etf-tax 소개 페이지에서 바로 열기
      state.fireTab = 'tax'; savePref('fireTab', 'tax');
      if (v0 === 'etftax') setTimeout(() => document.getElementById('c-etftax')?.scrollIntoView({ block: 'start' }), 600);
      v0 = 'fire';
    }
    if (v0 === 'grow') { state.fireTab = 'div'; savePref('fireTab', 'div'); setDivSub('grow'); v0 = 'fire'; }
    if (SHARED_IN) setTimeout(() => { toast(EN ? 'Opened with the shared inputs — edit any value to save them as yours' : '공유받은 조건으로 열었어요. 값을 고치면 내 설정으로 저장돼요'); document.getElementById(SHARED_IN.kind === 'grow' ? 'c-grow' : 'c-etftax')?.scrollIntoView({ block: 'start' }); }, 900);
    if (['dividend', 'quit', 'bonus', 'portfolio'].includes(v0)) { // 소개 페이지(/dividend · /fire · /bonus · /portfolio)에서 바로 열기
      state.fireTab = v0 === 'quit' ? 'fire' : v0 === 'bonus' ? 'bonus' : 'div'; savePref('fireTab', state.fireTab);
      if (v0 === 'portfolio' || v0 === 'dividend') setDivSub(v0 === 'portfolio' ? 'sim' : 'mine');
      if (v0 === 'portfolio') setTimeout(() => document.getElementById('c-divsim')?.scrollIntoView({ block: 'start' }), 600);
      v0 = 'fire';
    }
    showView(viewAllowed(v0) ? v0 : 'home');
  }
  if (fromSnap) { try { renderAll(); } catch (e) { console.error(e); } } // 지난번 화면을 즉시
  busyBar(true);
  initPrice();
  // 시세를 다른 데이터보다 먼저 받아 종목 카드·주가가 바로 보이게
  loadQuote().then(() => { renderStockSwitch(); if (isOther()) { renderSPriceCard(); renderSKpis(); } updateFireChip(); renderHomeFire(); }).catch(() => {});
  yConnect();
  for (const sym of WATCH) if (STOCK_INFO[sym]?.custom) checkBinance(sym);
  bConnect();
  for (const sym of Object.keys(BN24)) bxSnapshot(sym).then(() => { renderStockSwitch(); if (state.stock === sym) { renderSPriceCard(); renderSKpis(); } }).catch(() => bStartPoll());
  refresh('boot');
  renderWelcome(firstVisit && !MIGRATED);
  if (!DEMO) renderWhatsNew(firstVisit && !MIGRATED && !loadPref('welcomed', '') && !loadPref('seenNews', ''));
  if (MIGRATED) setTimeout(() => toast(EN ? '✓ Moved your data from the old address' : '✓ 예전 주소에서 쓰던 보유 정보·관심 종목을 옮겼어요'), 800);
  countVisit();
  if (fireCfg?.positions?.length) markUse('fireSet');
  if (divCfg?.hold?.length) markUse('divSet');
  if (WATCH.some((x) => STOCK_INFO[x]?.custom)) markUse('watch');
  if (WATCH.some(isKR)) markUse('kr');
  sendPicks();
  document.addEventListener('click', (ev) => {
    if (ev.target.closest?.('a[href*="blog.naver.com"]')) markUse('blog');
    if (ev.target.closest?.('a[href*="instagram.com/myfireportfolio"], a[href*="x.com/myfireportfolio"]')) markUse('sns');
    const fb = ev.target.closest?.('a.fl-fb');
    if (fb) fb.href = `feedback?from=${encodeURIComponent(state.view)}${EN ? '&lang=en' : ''}`; // 어느 화면에서 문의했는지 함께
  }, true);
  setInterval(() => { if (!document.hidden) refresh('light'); }, LIVE_REFRESH_MS);
  setInterval(() => { if (!document.hidden) refresh('auto'); }, DATA_REFRESH_MS);
  setInterval(() => { if (!document.hidden) { renderStatus(); renderMarket(); if (px.mark) setHtml('px-next', fundLeft(px.mark.next)); } }, 30000);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { closeWatchSheet(); closeTxSheet(); closeFolderSheet(); closeHomeEdit(); }
    if (ev.key === 'Enter' && ev.target?.id === 'tgt-in') { const b = document.querySelector('[data-tgtsave]'); if (b) saveTgt(b.dataset.tgtsave); }
    if (ev.key === 'Enter' && ev.target?.id === 'fd-name') saveFolder();
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'gr-q') { growSearch(ev.target.value); return; }
    const aci = ev.target.dataset?.acct;
    if (aci) { acctCfg[aci] = ev.target.value; acctCfg.y = THIS_YEAR; writeJSON(ACCT_KEY, acctCfg); const o = document.getElementById('ac-out'); if (o) o.innerHTML = acctOutHtml(); return; }
    if (ev.target.dataset?.fin) { finCfg.other = ev.target.value; finCfg.y = THIS_YEAR; writeJSON(FIN_KEY, finCfg); const o = document.getElementById('fi-out'); if (o) o.innerHTML = finOutHtml(); return; }
    const rbi = ev.target.dataset?.rebal;
    if (rbi) { rebalCfg.t[rbi] = ev.target.value.replace(/[^0-9]/g, ''); writeJSON(REBAL_KEY, rebalCfg); rebalRefresh(); return; }
    if (ev.target.dataset?.rebalCash) { rebalCfg.cash = ev.target.value; writeJSON(REBAL_KEY, rebalCfg); rebalRefresh(); return; }
    const gw = ev.target.dataset?.growi;
    if (gw != null) { const r = growCfg.rows[+gw]; if (r) { r.w = ev.target.value.replace(/[^0-9]/g, ''); growSave(); growRefresh(); } return; }
    const gi = ev.target.dataset?.grow;
    if (gi && ev.target.type !== 'checkbox') { growCfg[gi] = ev.target.value === '' && gi === 'gD' ? null : ev.target.value; growSave(); growRefresh(); return; }
    const ei = ev.target.dataset?.etax;
    if (ei && ev.target.type !== 'checkbox' && ev.target.tagName !== 'SELECT') { etaxCfg[ei] = ev.target.value; writeJSON(ETAX_KEY, etaxCfg); const o = document.getElementById('et-out'); if (o) o.innerHTML = etaxOutHtml(); return; }
    if (ev.target.id === 'tax-amt') { taxCfg.amt = ev.target.value; writeJSON(TAX_KEY, taxCfg); renderHomeFire(); const o = document.getElementById('tax-out'); if (o) o.innerHTML = taxOutHtml(); }
  });
  document.addEventListener('change', (ev) => {
    const gc = ev.target.dataset?.grow;
    if (gc && ev.target.type === 'checkbox') { growCfg[gc] = ev.target.checked; growSave(); growRefresh(); return; }
    const ec = ev.target.dataset?.etax;
    if (ec && (ev.target.type === 'checkbox' || ev.target.tagName === 'SELECT')) { etaxCfg[ec] = ec === 'isa' ? (ev.target.checked ? 'low' : 'gen') : ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; writeJSON(ETAX_KEY, etaxCfg); const o = document.getElementById('et-out'); if (o) o.innerHTML = etaxOutHtml(); const a = document.getElementById('ac-out'); if (a) a.innerHTML = acctOutHtml(); return; }
    const heo = ev.target.closest?.('[data-heon]');
    if (heo) { const L = homeLayout(), k = heo.dataset.heon; L.off = heo.checked ? L.off.filter((x) => x !== k) : [...new Set([...L.off, k])]; saveHomeLayout(L); return; }
    if (ev.target.dataset?.hetabs) { const L = homeLayout(); L.tabs = ev.target.checked; saveHomeLayout(L); return; }
    if (ev.target.id === 'oc-file') runOcr(ev.target.files);
    if (ev.target.id === 'oc-y') applyOcrYear();
    if (ev.target.classList?.contains('f-ticker')) { const a = ev.target.closest('.f-row')?.querySelector('.f-avg'); if (a) a.placeholder = krTk(ev.target.value) ? '평균 단가(원)' : '평균 단가($)'; }
  });
  // USDC·Arc 화면 맨 위 소개: 접은 상태를 기억한다
  for (const d of document.querySelectorAll('details.intro-card')) {
    if (loadPref('intro.' + d.dataset.intro, '') === 'closed') d.open = false;
    const lab = () => { const s = d.querySelector('summary small'); if (s) s.textContent = T(d.open ? '접기' : '펼치기'); };
    lab();
    d.addEventListener('toggle', () => { savePref('intro.' + d.dataset.intro, d.open ? 'open' : 'closed'); lab(); });
  }
  document.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!(d instanceof HTMLElement) || !d.matches('details.more')) return;
    d.open ? state.openMore.add(d.dataset.more) : state.openMore.delete(d.dataset.more);
    if (d.open) for (const cv of d.querySelectorAll('canvas')) charts[cv.id.replace(/^cv-/, '')]?.resize();
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { disconnectWs(); yDisconnect(); bDisconnect(); return; }
    loadPxSnapshot().then(schedulePaint).catch(() => {});
    connectWs();
    yConnect();
    bConnect();
    refresh('auto');
  });
})();
