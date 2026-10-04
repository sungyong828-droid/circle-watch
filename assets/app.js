/* Fire Portfolio — 화면 렌더링
 * data/latest.json(수집기 결과)을 그리고, 시세·뉴스·실적·기관 보유는 중계 서버와 각 출처에서 직접 갱신한다. */
(() => {
  'use strict';

  // Cloudflare Pages(공유용 주소)에서는 같은 주소의 /api 중계를 쓰고, GitHub Pages에서는 Worker를 쓴다
  const ON_PAGES = /\.pages\.dev$/.test(location.hostname);
  // 운영 주소인지(테스트 환경 test.my-fire-portfolio.pages.dev 등은 방문 집계 안 함 · 상단에 TEST 표시)
  const IS_PROD = location.hostname === 'my-fire-portfolio.pages.dev';
  if (ON_PAGES && !IS_PROD) document.documentElement.classList.add('is-test');
  const DATA_URL = ON_PAGES ? '/api/data' : 'data/latest.json';
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
    sc.src = 'assets/i18n-en.js?v=8';
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

  const css = getComputedStyle(document.documentElement);
  const C = {
    blue: css.getPropertyValue('--c-blue').trim(),
    orange: css.getPropertyValue('--c-orange').trim(),
    teal: css.getPropertyValue('--c-teal').trim(),
    purple: css.getPropertyValue('--c-purple').trim(),
    ink: css.getPropertyValue('--ink').trim(),
    ink2: css.getPropertyValue('--ink-2').trim(),
    muted: css.getPropertyValue('--muted').trim(),
    faint: css.getPropertyValue('--faint').trim(),
    line: css.getPropertyValue('--line').trim(),
    lineSoft: css.getPropertyValue('--line-soft').trim(),
    surface2: css.getPropertyValue('--surface-2').trim(),
    up: css.getPropertyValue('--up').trim(),
    down: css.getPropertyValue('--down').trim(),
  };

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
    market: `
      <p>미국 증시 전체 분위기예요(Yahoo Finance, 1분마다 새로).</p>
      <ul>
        <li><b>S&P500·나스닥·다우·러셀2000</b>: 대형주·기술주·우량주·중소형주 지수. 내 종목이 시장과 같이 움직였는지 비교해 보세요.</li>
        <li><b>VIX</b>: 공포지수. 20 아래면 안정, 30 넘으면 불안이 큰 시장.</li>
        <li><b>미 10년물 금리</b>: 오르면 성장주(조비·템퍼스 등)에 부담, 서클은 준비금 이자수익이 늘어요.</li>
        <li><b>달러지수·비트코인</b>: 달러 강세는 위험자산에 부담. 비트코인은 서클·암호화폐 심리와 연결돼요.</li>
        <li><b>지수 선물</b>: 미국 정규장이 닫힌 시간에도 거래돼 다음 장 분위기를 미리 보여줘요.</li>
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
    earnday: `
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
        <li><b>보유 종목</b>: 기본 종목(CRCA·CRCL·JOBY·SPCX·TEM)에, 홈의 <b>+ 추가·편집</b>에서 관심 종목으로 추가한 종목도 골라 함께 넣을 수 있어요. 관심 종목에서 빼면 여기 선택 목록에서도 빠져요(이미 저장한 보유 정보는 지우기 전까지 그대로 계산돼요).</li>
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
        <li><b>펀딩비</b>: 선물 가격을 현물(지수)에 맞추려고 롱·숏끼리 주고받는 수수료. 양수면 롱(상승 베팅)이 숏에게 지불 → 상승 베팅이 많다는 뜻.</li>
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
      <p>바이낸스 CRCLUSDT 선물의 가격 추이입니다. 기간을 바꾸면 봉 간격이 달라집니다(1일=15분, 1주=1시간, 1개월=4시간, 3개월=1일). 마지막 점은 실시간 가격입니다.</p>
      <p>선이 <span class="up">빨강</span>이면 기간 시작보다 오른 상태, <span class="down">파랑</span>이면 내린 상태입니다.</p>`,
    short: `
      <p><b>공매도 비율</b> = 그날 서클 주식(CRCL) 거래량 중 공매도(빌린 주식을 파는 거래)로 체결된 비중입니다. 출처는 FINRA 일별 공매도 거래량(Reg SHO)이며, 미국 장 마감 후 저녁(한국 시간 다음 날 아침)에 전날 값이 올라옵니다.</p>
      <ul>
        <li><b>해석 주의</b>: 이 수치엔 시장조성자(마켓메이커)가 매수 주문을 받아주면서 잠깐 하는 공매도가 포함돼, 보통 종목도 40~50%대가 흔합니다. <b>절대 수준보다 평소(1개월 평균) 대비 얼마나 높아졌는지</b>를 보세요.</li>
        <li><b>전체 거래량</b>은 FINRA에 보고된 장외·대체거래소 거래 기준이라, 거래소 전체 거래량보다 작습니다.</li>
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
  const nf = (dp) => new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
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
  function card(id, { title, sub, info, body }) {
    const el = document.getElementById('c-' + id);
    const open = state.openInfo.has(id);
    el.innerHTML = `
      <div class="card-h">
        <div><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
        ${info ? `<button class="info-btn" type="button" data-info="${id}" aria-expanded="${open}" aria-controls="info-${id}" aria-label="${esc(title)} 설명">i</button>` : ''}
      </div>
      ${info ? `<div class="info" id="info-${id}" ${open ? '' : 'hidden'}>${info}</div>` : ''}
      ${body}`;
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
  function draw(id, cfg) {
    if (!window.Chart) return;
    if (EN) { // 캔버스 안 글자는 화면 번역기가 못 보므로 여기서 바꾼다(데이터셋 이름은 코드가 쓰므로 그대로 둔다)
      const cb = cfg.options?.plugins?.tooltip?.callbacks;
      if (cb) for (const k of Object.keys(cb)) { const f = cb[k]; if (typeof f === 'function') cb[k] = (...a) => { const r = f(...a); return Array.isArray(r) ? r.map(T) : T(r); }; }
      for (const sc of Object.values(cfg.options?.scales || {})) { const f = sc?.ticks?.callback; if (f) sc.ticks.callback = (...a) => T(f(...a)); }
    }
    charts[id]?.destroy();
    const cv = document.getElementById('cv-' + id);
    if (cv) charts[id] = new Chart(cv, cfg);
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
    pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: '#141920', tension: 0.25, ...extra,
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
  function drawCandles(id, pts, { compact = false, xf = hm, tip = null, last = null, ind = false } = {}) {
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
            ...tooltip(title, price), enabled: !compact,
            filter: (it) => it.dataset.label === (line ? '종가' : '시가~종가'),
            callbacks: {
              title: (items) => title(items[0]),
              label: (it) => {
                const k = charts[id]?.$V?.[it.dataIndex] || V[it.dataIndex];
                const out = [` 시가 ${price(k.o)} · 고가 ${price(k.h)}`, ` 저가 ${price(k.l)} · 종가 ${price(k.c)}`];
                if (k.v) out.push(` 거래량 ${unit(k.v)}`);
                const mas = it.chart.data.datasets.filter((d) => /^MA/.test(d.label) && d.data[it.dataIndex] != null).map((d) => `${d.label} ${price(d.data[it.dataIndex])}`);
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
            y: { ...axisY(price), beginAtZero: false, min: yLo - yPad, max: yHi + yPad, ticks: { ...axisY(price).ticks, maxTicksLimit: 5 } },
            ...(hasVol ? { vol: { display: false, beginAtZero: true, max: maxVol * 4.5, grid: { display: false } } } : {}),
          },
      },
    });
    if (charts[id]) { charts[id].$V = V; charts[id].$line = line; }
    if (ind) setHtml('ctl-' + id, maOut.map(([n, col, v]) => `<span><i style="background:${col}"></i>MA${n} ${price(v)}</span>`).join('') + (hasVol ? `<span><i class="v"></i>거래량</span>` : ''));
  }
  // 실시간 체결가로 마지막 캔들(종가·고가·저가)만 고친다
  function liveCandle(id, last) {
    const c = charts[id], V = c?.$V;
    if (!V?.length || last == null || !isFinite(last)) return;
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
    const eurcOfficial = current('eurcTotal').v;
    const row = (r, isProduct) => {
      const hl = r.sym === 'USDC' ? ' class="hl"' : '';
      const supply = r.cur === 'EUR' ? eur(r.sym === 'EURC' && eurcOfficial ? eurcOfficial : r.supply) : usd(r.supply);
      const share = isProduct ? '<td class="dim">–</td>' : `<td>${pctPlain(r.share)}<span class="share-bar"><i style="width:${Math.min(100, r.share * 100 / 0.6)}%"></i></span></td>`;
      return `<tr${hl}><td class="name"><b>${r.sym}</b><span>${esc(r.issuer)}</span></td><td>${supply}</td>${share}
        <td class="${cls(r.ch1, 5e-5)}">${r.ch1 == null ? '–' : Math.abs(r.ch1) < 5e-5 ? '0.00%' : pct(r.ch1, Math.abs(r.ch1) < 0.001 ? 2 : 1)}</td><td class="${cls(r.ch7, 5e-5)}">${pct(r.ch7)}</td><td class="${cls(r.ch30, 5e-5)}">${pct(r.ch30)}</td></tr>`;
    };
    const x = delta('usdcShare', { mode: 'pp' });
    card('stables', {
      title: '달러 스테이블코인 공급량',
      sub: '경쟁 코인과 서클 자체 상품 · DefiLlama',
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
      sub: `기간 시작(${fullDay(labels[0])})을 100으로 맞춘 공급량 지수 · DefiLlama`,
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

  function renderTvl() {
    const t = state.data.arcTvl;
    if (!t) return failed('tvl', 'Arc DeFi TVL', state.data.errors?.arcTvl);
    const pts = t.daily.slice();
    const lastSnap = current('tvl');
    const nowTs = Math.floor(Date.parse(lastSnap.t) / 1000);
    if (t.now != null && nowTs > pts.at(-1)[0] + 3600) pts.push([nowTs, t.now]);
    else pts[pts.length - 1] = [pts.at(-1)[0], t.now];
    const labels = pts.map((p) => p[0]);
    card('tvl', {
      title: 'Arc DeFi TVL', sub: '대출·DEX 등에 예치된 자산 · DefiLlama 일별', info: INFO.tvl,
      body: `<div class="headline"><span class="big">${usd(t.now)}</span></div>${deltaLine('tvl')}
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
    card('dex', {
      title: 'Arc DEX 거래액', sub: '일별 · DefiLlama', info: INFO.dex,
      body: `<div class="headline"><span class="big">${usd(x.total24h)}</span><span class="lbl">최근 24시간 · 7일 합계 ${usd(x.total7d)}</span></div>${deltaLine('dex24h')}
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
      label, data: days.map((r) => r[key] || 0), backgroundColor: color, borderColor: '#141920', borderWidth: { top: 2 },
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
          { label: '재방문', data: days.map((r) => r.ret), backgroundColor: col(C.blue), borderColor: '#141920', borderWidth: { top: 2 }, borderSkipped: 'bottom', stack: 's', maxBarThickness: 18 },
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
    card(id, {
      title: `${name} 공매도 비율`, sub: '최근 1개월 · 일별 공매도 거래 비중 · FINRA', info: INFO.short,
      body: `<div class="headline"><span class="lbl">${md(labels.at(-1))} 공매도 비율</span><span class="big">${pctPlain(last.ratio)}</span><span class="lbl">1개월 평균 ${pctPlain(S.avgRatio)}</span></div>
        <div class="delta-line"><span class="${cls(d1)}">${arrow(d1)} ${pp(d1, 1)}</span><span class="when">전 거래일(${prev ? md(labels.at(-2)) : '–'}) 대비 · 공매도 ${shares(last.short)} / 전체 ${shares(last.total)} · 1개월 최고 ${pctPlain(hi.ratio)}(${md(isoToTs(hi.d))}) · 최저 ${pctPlain(lo.ratio)}(${md(isoToTs(lo.d))})</span></div>
        <div class="chart"><canvas id="cv-${id}" role="img" aria-label="${name} 일별 공매도 비율"></canvas></div>
        <div class="legend"><span><i style="background:${C.purple}"></i>일별 공매도 비율</span><span><i class="line" style="background:${C.ink2}"></i>1개월 평균</span></div>
        ${si.length ? `<div class="tbl-wrap"><table>
          <thead><tr><th>공매도 잔고 기준일</th><th>잔고</th><th>직전 대비</th><th>커버 일수</th></tr></thead>
          <tbody>${si.map((r, i) => `<tr${i === 0 ? ' class="today"' : ''}><td>${esc(r.d.slice(5).replace('-', '/'))}</td><td class="strong">${shares(r.qty)}</td>
            <td class="${cls(r.chg)}">${r.chg > 0 ? '+' : ''}${r.chg.toFixed(1)}%</td><td>${r.dtc.toFixed(2)}일</td></tr>`).join('')}</tbody></table></div>
          <p class="note">공매도 잔고는 FINRA가 한 달에 두 번(15일·월말 기준) 발표합니다.</p>` : ''}`,
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
              footer: (items) => { const r = days[items[0].dataIndex]; return `공매도 ${shares(r.short)} / 전체 ${shares(r.total)}`; },
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
  };
  const px = state.px;
  const price = (v) => (v == null || !isFinite(v) ? '–' : '$' + nf(2).format(v));
  const hm = (ms) => new Date(ms).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', hour12: false });
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
  const fundLeft = (T) => { const m = Math.max(0, Math.round((T - Date.now()) / 60000)); return `다음 ${Math.floor(m / 60)}시간 ${m % 60}분 후`; };

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
      return RANGES[range].interval === '1d' ? d.toLocaleDateString(LOC) : d.toLocaleString(LOC, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
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
      note = `${RANGES[r].label} 최고 ${price(Math.max(...k.map((p) => p[3] ?? p[1])))} · 최저 ${price(Math.min(...k.map((p) => p[4] ?? p[1])))} · 시작 ${price(k[0][2] ?? vals[0])} · ${RANGES[r].interval} 캔들`;
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
        <p class="note">${note || '불러오는 중…'}</p>`,
    });
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

  // ---------------------------------------------------------------- 현재 상황 요약 (규칙 기반)
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
        <p class="sum-line">${tags.length ? tags.map((t) => `<span class="${t.tone}">${t.tag}</span>`).join('<i>·</i>') : '뚜렷한 변화 없이 보합'}</p>
        <div class="sum-count"><span class="tone pos">긍정 ${nPos}</span><span class="tone neg">주의 ${nNeg}</span><span class="tone neu">중립 ${items.length - nPos - nNeg}</span></div>
        <ul class="sum-list">${pxLine}${fireLine}${byTone(items).map((i) => `<li><button type="button" data-go="${i.go}"><span class="tone ${i.tone}">${toneName[i.tone]}</span><span class="txt">${i.html}</span>${chevron}</button></li>`).join('')}</ul>`,
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
      d.arcTvl = { ...d.arcTvl, now: arc.tvl, daily };
      L.tvl = arc.tvl;
    },
    async series(d) { // USDC·EURC·USYC 일별 공급량 추이 (DefiLlama를 중계 서버로 — 30분 캐시)
      const j = await getJ(`${NEWS_API}/series`, 25000);
      if (j.error || !j.usdc?.length) throw new Error(j.error || 'series');
      // 같은 동기화에서 '스테이블코인'이 붙여 둔 오늘 값은 남긴다
      const keep = (arr, cur) => { const last = cur?.at(-1); return last && last[0] > arr.at(-1)[0] ? [...arr, last] : arr; };
      d.series = { usdc: keep(j.usdc, d.series?.usdc), eurc: j.eurc?.length ? j.eurc : d.series?.eurc, usyc: j.usyc?.length ? j.usyc : d.series?.usyc };
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
        const j = await getJ(`${NEWS_API}/earnings?s=${s}${earnDay(s) ? '&live=1' : state.syncKind === 'manual' ? '&fresh=1' : ''}`, 25000);
        if (j.error) throw new Error(j.error);
        x.earn = j; x.earnErr = false;
      } catch (e) { x.earnErr = true; if (!x.earn) throw e; }
    },
    async snews(d, L, sym = state.stock) {
      const s = sym, x = st(s);
      if (!isOther(s)) return;
      const j = await getJ(`${NEWS_API}/news?s=${s}${state.syncKind === 'manual' ? '&fresh=1' : ''}`, 25000);
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
      const j = await getJ(`https://data.sec.gov/submissions/CIK${cik}.json`);
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
    async mnews() { const j = await getJ(`${NEWS_API}/mnews${state.syncKind === 'manual' ? '?fresh=1' : ''}`, 20000); if (j.error) throw new Error(j.error); state.mnews = j; },
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
        const j = await getJ(`${NEWS_API}/earnings${earnDay('CRCL') ? '?live=1' : state.syncKind === 'manual' ? '?fresh=1' : ''}`, 25000);
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
      const j = await getJ(`${NEWS_API}/news${state.syncKind === 'manual' ? '?fresh=1' : ''}`, 25000);
      if (j.error) throw new Error(j.error);
      const ownerMap = {};
      for (const f of j.filings || []) (ownerMap[f.d + '|' + f.form] ||= []).push(f.owner);
      d.news = { ...(d.news || {}), official: j.official, kr: j.kr, en: j.en, crypto: j.crypto || [], newsAt: j.at, ownerMap };
    },
    async filings(d) { // SEC EDGAR에서 직접 (서버를 거치지 않음)
      const j = await getJ('https://data.sec.gov/submissions/CIK0001876042.json');
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
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const FIRE_BASE = Object.keys(FIRE_TICKERS), TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
  for (const [sym, m] of Object.entries(readJSON('cw.watch', null)?.custom || {})) if (TICKER_RE.test(sym)) FIRE_TICKERS[sym] ||= `${sym} · ${m?.name || sym}`;
  // 관심 종목에서 뺐어도 보유 정보에 남아 있는 종목은 계속 고를 수 있게
  for (const p of readJSON(FIRE_KEY, null)?.positions || []) if (TICKER_RE.test(p?.ticker || '')) FIRE_TICKERS[p.ticker] ||= p.ticker;
  // 보유 종목 선택지: CRCA → 관심 종목 순서 → 나머지 기본 종목. 관심 종목에서 뺀 종목은 목록에서 빠진다
  // (keep: 이미 그 종목으로 저장된 행은 값이 바뀌지 않도록 그 행에만 남긴다)
  const fireTickerOrder = (keep) => [...new Set(['CRCA', ...WATCH, ...FIRE_BASE, ...(keep ? [keep] : [])])].filter((k) => FIRE_TICKERS[k]);
  const firePicked = (k) => FIRE_BASE.includes(k) || WATCH.includes(k);
  // Nasdaq에서 받는 시세에 따로 요청해야 하는 보유 종목(기본 5종목 외)
  const fireExtraSyms = () => (fireCfg?.positions || []).map((p) => p.ticker).filter((t) => !FIRE_BASE.includes(t));
  // 예전 형식({ticker, shares, avg})은 종목 목록 형식으로 바꿔 읽는다
  const normFire = (F) => {
    if (!F) return null;
    if (!F.positions && F.ticker) F = { ...F, positions: [{ ticker: F.ticker, shares: F.shares, avg: F.avg }] };
    F.positions = (F.positions || []).filter((p) => FIRE_TICKERS[p.ticker] && p.shares > 0 && p.avg > 0);
    return F.positions.length ? F : null;
  };
  let fireCfg = normFire(readJSON(FIRE_KEY, null));
  let fireHist = readJSON(FIRE_HIST, []);
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
  const mktStatus = (s) => ({ 'Pre-Market': '장전', 'Open': '장중', 'Market Open': '장중', 'After-Hours': '장후', 'Closed': '장 마감' }[s] || s || '');

  // 해외주식 양도소득세: 연 250만원 공제 후 22%(지방세 포함) — 이익일 때만
  const taxOf = (gainKrw) => Math.max(0, gainKrw - 2.5e6) * 0.22;

  // overrides: { 티커: 가격 } — 시뮬레이터·24시간 추정에 쓴다
  function fireCalc(overrides = {}) {
    const F = fireCfg, Q = state.quote;
    if (!F || !Q?.fx?.rate) return null;
    const fx = Q.fx.rate;
    const rows = [];
    for (const p of F.positions) {
      const q = Q[p.ticker];
      const price = overrides[p.ticker] ?? q?.price;
      if (price == null) return null;
      rows.push({ ...p, q, px: price, valueUsd: p.shares * price, costUsd: p.shares * p.avg, todayUsd: q?.prevClose != null ? p.shares * (price - q.prevClose) : 0 });
    }
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const valueUsd = sum('valueUsd'), costUsd = sum('costUsd');
    const valueKrw = valueUsd * fx, costKrw = costUsd * (F.buyFx || fx);
    const gainUsd = valueUsd - costUsd, gainKrw = valueKrw - costKrw;
    const tax = taxOf(gainKrw), netKrw = valueKrw - tax;
    const basis = F.afterTax ? netKrw : valueKrw;
    // 목표 금액이 되려면 필요한 원화 평가금액 (세후면 세금을 감안해 역산)
    const needValueKrw = F.afterTax ? Math.max(F.goal, (F.goal - 0.22 * (costKrw + 2.5e6)) / 0.78) : F.goal;
    // 주력 종목(평가금액이 가장 큰 종목)만 오른다고 볼 때의 목표가
    const main = rows.slice().sort((a, b) => b.valueUsd - a.valueUsd)[0];
    const needPx = (needValueKrw / fx - (valueUsd - main.valueUsd)) / main.shares;
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
    setText('hf-div-s', dc ? (ready ? `${EN ? 'Received' : '받은 배당'} ${usd2(dc.recvNet)} · ${EN ? 'recovered' : '원금 회수'} ${(dc.payback * 100).toFixed(1)}%` : (EN ? 'Loading dividends…' : '배당 내역 불러오는 중…')) : (EN ? 'Enter dividend stocks to calculate' : '배당 종목을 넣으면 계산돼요'));
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
  const fireTickerOptions = (sel) => fireTickerOrder(fireSaved(sel) ? sel : null).map((k) => `<option value="${esc(k)}" ${sel === k ? 'selected' : ''}>${esc(FIRE_TICKERS[k])}${firePicked(k) ? '' : ' (관심 종목에서 뺌)'}</option>`).join('');
  // 화면을 연 채로 관심 종목을 추가하면 입력 중인 값은 그대로 두고 선택지만 새로
  function refreshFireTickers() {
    for (const s of document.querySelectorAll('#f-rows .f-ticker')) { const v = s.value; s.innerHTML = fireTickerOptions(v); if ([...s.options].some((o) => o.value === v)) s.value = v; }
  }
  function fireRowHtml(p, i) {
    return `<div class="f-row" data-row="${i}">
      <select class="f-ticker" aria-label="종목">${fireTickerOptions(p.ticker)}</select>
      <input class="f-shares" inputmode="decimal" value="${p.shares ?? ''}" placeholder="보유 수량(주)" aria-label="보유 수량" required>
      <input class="f-avg" inputmode="decimal" value="${p.avg ?? ''}" placeholder="평균 단가($)" aria-label="평균 단가(달러)" required>
      <button type="button" class="f-rm" data-rm="${i}" aria-label="이 종목 삭제" ${fireRows.length < 2 ? 'hidden' : ''}>×</button>
    </div>`;
  }
  function fireForm(open) {
    const F = fireCfg || { goal: 1.5e9, afterTax: false };
    fireRows ||= fireCfg ? fireCfg.positions.map((p) => ({ ...p })) : [{ ticker: 'CRCA' }];
    return `<details class="fire-set" ${open ? 'open' : ''}>
      <summary>${fireCfg ? '보유 정보 수정' : '보유 정보 입력'}</summary>
      <form id="fire-form" autocomplete="off">
        <div class="f-rows-h"><span>보유 종목</span><small>수량 · 평균 단가(달러)</small></div>
        <div id="f-rows">${fireRows.map(fireRowHtml).join('')}</div>
        <button type="button" class="btn-ghost f-add" id="f-add">+ 종목 추가</button>
        <p class="note f-hint">목록에 없는 종목은 홈의 <b>+ 추가·편집</b>에서 관심 종목으로 추가하면 여기서도 고를 수 있어요.</p>
        <label>목표 금액(원)<input id="f-goal" inputmode="numeric" value="${F.goal ?? 1.5e9}" required><small id="f-goal-hint">${wonFull(F.goal ?? 1.5e9)}</small></label>
        <label>평균 매수 환율(원, 선택)<input id="f-fx" inputmode="decimal" value="${F.buyFx ?? ''}" placeholder="비우면 현재 환율로 손익 계산"></label>
        <label class="chk"><input type="checkbox" id="f-tax" ${F.afterTax ? 'checked' : ''}> 세후 기준으로 계산 (해외주식 양도세 22%, 연 250만원 공제)</label>
        <div class="fire-btns"><button type="submit" class="btn-primary">저장</button>${fireCfg ? `<button type="button" id="f-del" class="btn-ghost">${fireConfirmDelete ? '정말 삭제' : '이 기기에서 삭제'}</button>` : ''}</div>
        <p class="note">🔒 입력한 값은 <b>이 기기(브라우저)에만</b> 저장돼요. 서버나 공유 링크로 전송되지 않아서, 같은 링크를 받은 다른 사람에게는 보이지 않아요.</p>
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

  function renderFire() {
    updateFireChip();
    renderHomeFire();
    const el = document.getElementById('c-fire');
    if (!el) return;
    const c = fireCalc();
    if (!fireCfg) {
      card('fire', { title: '퇴사까지', sub: '내 보유 주식으로 목표 금액까지 진행률', info: INFO.fire, body: `<p class="fire-empty">아래에 보유 종목·수량·평균 단가를 입력하면 실시간 시세와 환율로 <b>퇴사까지 몇 %</b>인지 계산해요. 기본 종목(CRCA·CRCL·JOBY·SPCX·TEM)은 물론, 관심 종목으로 직접 추가한 종목도 함께 넣을 수 있어요.</p>` });
      ['c-fire-sim', 'c-fire-hist'].forEach((id) => { const e = document.getElementById(id); if (e) e.hidden = true; });
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
      return `<div class="fire-pos"><b>${logoOf(r.ticker) ? `<img class="fp-logo" src="${logoOf(r.ticker)}" alt="" width="16" height="16">` : ''}${r.ticker}</b><span>${nf(0).format(r.shares)}주 · $${r.px.toFixed(2)} <span class="${cls(r.q?.pct)}">${pct(r.q?.pct, 2)}</span> · ${esc(mktStatus(r.q?.status))}</span><span>${wonFull(r.valueUsd * c.fx)} <span class="${cls(g)}">${pct(g)}</span></span></div>`;
    }).join('');
    card('fire', {
      title: '퇴사까지', sub: `${c.rows.map((r) => `${r.ticker} ${nf(0).format(r.shares)}주`).join(' · ')} · 목표 ${wonFull(F.goal)}${F.afterTax ? ' · 세후 기준' : ''}`, info: INFO.fire,
      body: `
        <div class="fire-hero">
          <div class="fire-pct"><span id="fire-pct">${(pctDone * 100).toFixed(1)}</span><small>%</small></div>
          <div class="fire-remain">목표까지 <b>${(Math.max(0, 1 - pctDone) * 100).toFixed(1)}%</b> 남음 · <b>${wonFull(Math.max(0, c.remainKrw))}</b> 부족</div>
          <div class="fire-bar" role="progressbar" aria-valuenow="${Math.round(pctDone * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100, pctDone * 100)}%"></span>${marks}</div>
          <div class="fire-scale"><span>₩0</span><span>${won(F.goal * 0.5)}</span><span>${won(F.goal)}</span></div>
        </div>
        ${multi ? `<div class="fire-poss">${posHtml}</div>` : ''}
        <div class="ns-grid fire-grid">
          <div><span>평가금액${F.afterTax ? '(세후)' : ''}</span><b>${wonFull(c.basis)}</b><small>${dollar(c.valueUsd)}${F.afterTax ? ` · 세전 ${wonFull(c.valueKrw)}` : ''}</small></div>
          <div><span>평가손익</span><b class="${cls(c.gainKrw)}">${signed(c.gainKrw, wonFull)}</b><small><span class="${cls(c.gainPct)}">${pct(c.gainPct)}</span> · ${signed(c.gainUsd, dollar)}</small></div>
          <div><span>오늘 변동</span><b class="${cls(c.todayKrw)}">${signed(c.todayKrw, wonFull)}</b><small>${multi ? '보유 종목 합계' : `${c.main.ticker} <span class="${cls(c.q?.pct)}">${pct(c.q?.pct, 2)}</span>`} · 전일 종가 대비</small></div>
          ${multi
            ? `<div><span>필요 상승률</span><b class="up">+${(c.needAll * 100).toFixed(0)}%</b><small>보유 종목이 모두 같은 비율로 오를 때</small></div>`
            : `<div><span>${c.main.ticker} 현재가</span><b>$${c.px.toFixed(2)}</b><small>${esc(mktStatus(c.q?.status))} · 평균 $${c.main.avg.toFixed(2)}</small></div>`}
          <div><span>${multi ? `${c.main.ticker}만 오를 때 목표가` : '목표 달성 가격'}</span><b>$${c.needPx.toFixed(2)}</b><small>현재가 대비 <span class="up">+${(c.needPct * 100).toFixed(0)}%</span></small></div>
          <div><span>원·달러 환율</span><b>₩${nf(2).format(c.fx)}</b><small>10원 오르면 ${signed(c.valueUsd * 10, wonFull)}</small></div>
        </div>
        ${est ? `<div class="fire-est"><span class="tone px"><span class="live-dot"></span>24시간 추정</span>
          <div>바이낸스 CRCL <b>$${est.crcl.toFixed(2)}</b> (<span class="${cls(est.move)}">${pct(est.move, 2)}</span>, 정규장 종가 대비)${est.prices.CRCA ? ` → CRCA 추정 <b>$${est.prices.CRCA.toFixed(2)}</b>` : ''} · 달성률 <b>${estC ? (Math.max(0, estC.progress) * 100).toFixed(1) + '%' : '–'}</b></div></div>` : ''}
        <p class="note">시세 ${esc(c.q?.time || '')} · 환율 ${esc(state.quote.fx.source || '')} ${state.quote.fx.time ? hm(Date.parse(state.quote.fx.time)) : ''} 기준${F.buyFx ? '' : ' · 손익은 현재 환율로 환산'}${c.tax > 0 ? ` · 예상 양도세 ${wonFull(c.tax)}` : ''}</p>`,
    });
    // 슬라이더를 끄는 중이면 시뮬레이터는 다시 그리지 않는다
    if (document.activeElement?.id !== 'sim-range') renderFireSim(c);
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
    return `<b>$${p.toFixed(2)}</b><span>${wonFull(s.basis)} · 달성률 <b>${(Math.max(0, s.progress) * 100).toFixed(1)}%</b> · 손익 <span class="${cls(s.gainKrw)}">${signed(s.gainKrw, wonFull)}</span></span>`;
  }
  function renderFireSim(c) {
    const m = c.main;
    const max = Math.max(Math.ceil(c.needPx * 1.25 / 10) * 10, Math.ceil(m.px * 3));
    const p = fireSim ?? m.px;
    const chips = [['현재가', m.px], ['+50%', m.px * 1.5], ['2배', m.px * 2], ['평균 단가', m.avg], ['목표가', Math.ceil(c.needPx * 100) / 100]];
    card('fire-sim', {
      title: '가격 시뮬레이터', sub: `${m.ticker} 가격이 이렇게 되면${c.rows.length > 1 ? ' (다른 종목은 현재가)' : ''} · 현재 환율 기준`, info: INFO.fireSim,
      body: `<div class="sim-top" id="sim-top">${simTopHtml(p)}</div>
        <input type="range" id="sim-range" min="1" max="${max}" step="0.5" value="${p.toFixed(1)}" aria-label="${m.ticker} 가격">
        <div class="sim-scale"><span>$1</span><span>$${max}</span></div>
        <div class="sim-chips">${chips.map(([l, v]) => `<button type="button" data-sim="${v.toFixed(2)}">${l}<small>$${v.toFixed(2)}</small></button>`).join('')}</div>`,
    });
  }

  function renderFireHist() {
    const H = fireHist;
    card('fire-hist', {
      title: '진행률 기록', sub: '이 기기에서 하루 한 번(마지막 값) 기록 · 최대 400일', info: '',
      body: H.length < 2
        ? `<p class="note" style="margin-top:12px">기록이 쌓이는 중이에요. 내일부터 추이 그래프가 보여요. (오늘 ${H[0] ? (H[0].p * 100).toFixed(1) + '%' : '–'})</p>`
        : `<div class="chart short"><canvas id="cv-fire-hist" role="img" aria-label="퇴사 진행률 기록"></canvas></div>`,
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
  const normDiv = (V) => {
    if (!V || !Array.isArray(V.lots)) return null;
    V.lots = V.lots.filter((l) => TICKER_RE.test(l?.t || '') && l.sh > 0 && l.avg > 0 && /^\d{4}-\d{2}-\d{2}$/.test(l.d || ''));
    V.tax = [0, 0.15].includes(V.tax) ? V.tax : 0.15;
    return V.lots.length ? V : null;
  };
  let divCfg = normDiv(readJSON(DIV_KEY, null));
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
    const syms = [...new Set(divCfg.lots.map((l) => l.t))];
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
  function payDateOf(D, ex) {
    if (D.pay?.[ex]) return { pay: D.pay[ex], est: false };
    const lags = Object.entries(D.pay || {}).map(([e, p]) => daysBetween(e, p)).filter((n) => n >= 0 && n < 60).sort((a, b) => a - b);
    // 지급일 자료가 없으면 주기·종류로 추정: 매주 배당 ETF 1일, 월배당 ETF 3일, 그 밖의 ETF 5일, 개별 주식 14일
    const recent = D.events.filter((e) => e.ex > addDays(isoToday(), -120)).length;
    const etf = /ETF|FUND/i.test(D.type || '') || /(ETF|Fund|Trust|ProShares|Direxion|YieldMax|Roundhill|Defiance|GraniteShares|iShares|SPDR|Vanguard|Invesco|Schwab|Ultra)/i.test(D.name || ''); // CRCA처럼 Yahoo가 주식으로 분류한 ETF
    const lag = lags.length ? lags[Math.floor(lags.length / 2)] : recent >= 10 ? 1 : etf ? (recent >= 3 ? 3 : 5) : 14;
    return { pay: addDays(ex, lag), est: true };
  }
  const freqOf = (n) => (n >= 40 ? ['매주 배당', 52] : n >= 10 ? ['월배당', 12] : n >= 3 ? ['분기 배당', 4] : n === 2 ? ['반기 배당', 2] : n === 1 ? ['연 1회', 1] : ['배당 없음', 0]);

  function divCalc() {
    if (!divCfg) return null;
    const today = isoToday(), yearAgo = addDays(today, -365), tax = divCfg.tax;
    const per = {}, received = [], pending = [], missing = [];
    for (const L of divCfg.lots) {
      const D = state.divData[L.t]?.d;
      const P = (per[L.t] ||= { sym: L.t, sh: 0, cost: 0, gross: 0, count: new Set(), D, lots: 0 });
      P.sh += L.sh; P.cost += L.sh * L.avg; P.lots++;
      if (!D) { if (!missing.includes(L.t)) missing.push(L.t); continue; }
      const evs = [...D.events];
      if (D.next?.ex && !evs.some((e) => e.ex === D.next.ex)) evs.push({ ex: D.next.ex, amt: D.next.amt ?? evs.at(-1)?.amt ?? 0, declared: true, pay: D.next.pay });
      for (const e of evs) {
        if (e.ex <= L.d) continue; // 배당락일 전날까지 사야 받는다
        const { pay, est } = e.pay ? { pay: e.pay, est: false } : payDateOf(D, e.ex);
        const row = { sym: L.t, ex: e.ex, pay, est, dps: e.amt, sh: L.sh, gross: e.amt * L.sh };
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
  state.fireTab = loadPref('fireTab', 'fire') === 'div' ? 'div' : 'fire';
  function applyFireTab() {
    for (const b of document.querySelectorAll('[data-ftab]')) b.setAttribute('aria-selected', String(b.dataset.ftab === state.fireTab));
    for (const el of document.querySelectorAll('#view-fire [data-pane]')) el.classList.toggle('pane-off', el.dataset.pane !== state.fireTab);
    if (state.fireTab === 'div') for (const id of ['div-month']) charts[id]?.resize();
    if (state.view === 'fire') document.getElementById('view-title').textContent = viewTitle('fire');
  }
  function renderDiv() {
    renderHomeFire();
    const el = document.getElementById('c-div');
    if (!el) return;
    const mEl = document.getElementById('c-div-month');
    if (!divCfg) {
      card('div', { title: '배당금', sub: '매수한 주식·ETF로 받은 배당과 원금 회수', info: INFO.div, body: `<p class="fire-empty">아래 <b>배당 종목 입력</b>에 종목·수량·평균 단가·<b>매수일</b>을 넣으면, 지금까지 받은 배당금, 원금을 되찾기까지 남은 금액, 월별 배당금을 계산해요. 같은 종목을 여러 번 나눠 샀다면 매수일별로 따로 넣어 주세요.</p>` });
      if (mEl) mEl.hidden = true;
      return;
    }
    const c = divCalc();
    const loading = c.missing.filter((s) => !state.divErr[s]);
    const errs = c.missing.filter((s) => state.divErr[s]);
    const taxLabel = c.tax ? `세후(미국 원천징수 ${Math.round(c.tax * 100)}%)` : '세전';
    const P = Object.values(c.per);
    const rows = P.map((p) => `<tr><td>${logoOf(p.sym) ? `<img class="div-logo" src="${logoOf(p.sym)}" alt="" width="18" height="18" loading="lazy">` : ''}<b>${esc(p.sym)}</b><small>${esc(p.D && !p.D.events.length ? '배당 없음' : p.freqLabel || '–')}${p.yoc != null ? ` · YOC ${pctPlain(p.yoc, 1)}` : ''}${p.lots > 1 ? (EN ? ` · ${p.lots} buys` : ` · 매수 ${p.lots}회`) : ''}</small></td>
        <td>${p.payments ?? 0}회</td><td>${usd2(p.received)}</td><td>${p.annual != null ? usd2(p.annual * (1 - c.tax)) : '–'}</td>
        <td>${p.next ? `${+p.next.ex.slice(5, 7)}/${+p.next.ex.slice(8)}${p.next.est ? '<small>예상</small>' : '<small>확정</small>'}` : '–'}</td></tr>`).join('');
    const bar = Math.min(100, c.payback * 100);
    // 받은 배당이 없을 때 이유: 배당을 안 주는 종목 / 매수일 이후 배당락이 아직 없음
    const noDiv = P.filter((p) => p.D && !p.D.events.length).map((p) => p.sym);
    const notYet = P.filter((p) => p.D && p.D.events.length && !p.payments).map((p) => p.sym);
    const why = [noDiv.length ? (EN ? `${noDiv.join(', ')} ${noDiv.length > 1 ? "don't" : "doesn't"} pay dividends` : `배당을 주지 않는 종목: ${noDiv.join('·')}`) : '', notYet.length ? (EN ? `${notYet.join(', ')}: no ex-dividend date has passed since the buy date yet` : `매수일 이후 아직 배당락일이 없어 받은 배당이 없는 종목: ${notYet.join('·')} (앞으로 받을 배당만 계산)`) : ''].filter(Boolean).join(EN ? ' · ' : ' · ');
    const big = Object.entries(c.byYear).find(([, v]) => state.quote?.fx?.rate && v.gross * state.quote.fx.rate > 2e7 * 0.8);
    card('div', {
      title: '배당금', sub: EN ? `${P.length} stocks · ${c.tax ? 'after 15% US withholding' : 'pre-tax'} · current shares` : `${P.length}종목 · ${taxLabel} 기준 · 현재 보유 수량 기준`, info: INFO.div,
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
        ${c.nextAll ? `<p class="div-next">다음 배당락 <b>${esc(c.nextAll.sym)} ${krDate(c.nextAll.next.ex)}</b>${c.nextAll.next.est ? ' (예상)' : ''} · 주당 ${usd2(c.nextAll.next.amt)} — 그 전날까지 보유해야 받아요</p>` : ''}
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
          ${recent.map((r) => `<tr><td>${r.pay.slice(2).replace(/-/g, '.')}${r.est ? '<small>추정</small>' : ''}</td><td>${esc(r.sym)}</td><td>${usd2(r.dps)}</td><td>${nf(0).format(r.sh)}</td><td>${usd2(r.gross * (1 - c.tax))}</td></tr>`).join('')}
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

  // ---- 입력 폼
  function divRowHtml(r, i) {
    return `<div class="f-row d-row" data-row="${i}">
      <input class="d-t" list="d-tickers" value="${esc(r.t || '')}" placeholder="티커 (예: SCHD)" aria-label="티커" autocapitalize="characters" autocomplete="off" maxlength="8">
      <input class="d-sh" inputmode="decimal" value="${r.sh ?? ''}" placeholder="수량" aria-label="보유 수량">
      <input class="d-avg" inputmode="decimal" value="${r.avg ?? ''}" placeholder="평단($)" aria-label="평균 단가(달러)">
      <input class="d-d" type="date" value="${esc(r.d || '')}" max="${isoToday()}" aria-label="매수일(선택 — 비우면 오늘)">
      <button type="button" class="f-rm" data-drm="${i}" aria-label="이 매수 기록 삭제" ${divRows.length < 2 ? 'hidden' : ''}>×</button>
    </div>`;
  }
  function renderDivSet() {
    const el = document.getElementById('c-div-set');
    if (!el) return;
    divRows = divCfg ? divCfg.lots.map((l) => ({ ...l })) : [{}];
    const tickers = [...new Set([...WATCH, ...Object.keys(FIRE_TICKERS), 'SCHD', 'JEPI', 'JEPQ', 'O', 'VYM', 'QQQ', 'SPY', 'VOO', 'KO', 'AAPL', 'MSFT'])];
    el.innerHTML = `<details class="fire-set" ${divCfg ? '' : 'open'}>
      <summary>${divCfg ? '배당 종목 수정' : '배당 종목 입력'}</summary>
      <form id="div-form" autocomplete="off">
        <div class="f-rows-h"><span>매수 기록</span><small>티커 · 수량 · 평단($) · 매수일(선택)</small></div>
        <div id="d-rows">${divRows.map(divRowHtml).join('')}</div>
        <datalist id="d-tickers">${tickers.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="d-btns"><button type="button" class="btn-ghost f-add" id="d-add">+ 매수 기록 추가</button>${fireCfg ? '<button type="button" class="btn-ghost f-add" id="d-import">🔥 보유 종목 불러오기</button>' : ''}</div>
        <p class="note"><b>매수일은 선택</b>이에요. 넣으면 그날 이후 실제로 받은 배당금까지 계산하고, 비워 두면 오늘 날짜로 저장돼 앞으로 받을 배당금만 계산해요. 같은 종목을 여러 번 나눠 샀다면 매수일별로 한 줄씩 넣어 주세요. 수량은 <b>지금 보유 중인 수량</b>(주식 분할 반영)이에요.</p>
        <label>배당 세금<select id="d-tax"><option value="0.15" ${!divCfg || divCfg.tax === 0.15 ? 'selected' : ''}>세후 — 미국 원천징수 15% 뺀 금액(실제 입금액)</option><option value="0" ${divCfg?.tax === 0 ? 'selected' : ''}>세전 — 세금 빼기 전 금액</option></select></label>
        <div class="fire-btns"><button type="submit" class="btn-primary">저장</button>${divCfg ? `<button type="button" id="d-del" class="btn-ghost">${divConfirmDelete ? '정말 삭제' : '이 기기에서 삭제'}</button>` : ''}</div>
        <p class="note">🔒 입력한 값은 <b>이 기기(브라우저)에만</b> 저장돼요.</p>
      </form>
    </details>`;
  }
  function readDivRows() {
    return [...document.querySelectorAll('#d-rows .d-row')].map((r) => ({
      t: r.querySelector('.d-t').value.trim().toUpperCase(),
      sh: parseFloat(r.querySelector('.d-sh').value.replace(/,/g, '')) || undefined,
      avg: parseFloat(r.querySelector('.d-avg').value.replace(/[,$]/g, '')) || undefined,
      d: r.querySelector('.d-d').value,
    }));
  }
  function saveDivForm() {
    const rows = readDivRows().filter((r) => r.t || r.sh || r.avg || r.d).map((r) => ({ ...r, d: r.d || isoToday() })); // 매수일을 비우면 오늘
    const bad = rows.find((r) => !TICKER_RE.test(r.t) || !(r.sh > 0) || !(r.avg > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r.d) || r.d > isoToday());
    if (!rows.length || bad) { toast('각 줄에 티커·수량·평균 단가를 넣어 주세요(매수일은 오늘 이전만)', true); return; }
    divCfg = { lots: rows, tax: parseFloat(document.getElementById('d-tax')?.value) || 0 };
    writeJSON(DIV_KEY, divCfg);
    divConfirmDelete = false;
    toast('✓ 이 기기에 저장했어요 · 배당 내역 불러오는 중');
    renderDivSet(); renderDiv();
    if (!state.quote) loadQuote().then(renderDiv).catch(() => {});
    loadDividends(true).catch(() => {});
  }
  function deleteDiv() {
    if (!divConfirmDelete) { divConfirmDelete = true; const b = document.getElementById('d-del'); if (b) b.textContent = '정말 삭제'; return; }
    divCfg = null; divConfirmDelete = false; state.divData = {};
    try { localStorage.removeItem(DIV_KEY); localStorage.removeItem(DIV_CACHE); } catch {}
    toast('이 기기에서 배당 정보를 지웠어요');
    renderDivSet(); renderDiv();
  }
  function importFireToDiv() {
    const have = readDivRows().filter((r) => r.t);
    const add = (fireCfg?.positions || []).filter((p) => !have.some((r) => r.t === p.ticker)).map((p) => ({ t: p.ticker, sh: p.shares, avg: +p.avg.toFixed(4), d: '' }));
    if (!add.length) { toast('불러올 새 종목이 없어요'); return; }
    divRows = [...have, ...add];
    document.getElementById('d-rows').innerHTML = divRows.map(divRowHtml).join('');
    toast('🔥 보유 종목을 불러왔어요 · 매수일은 넣어도 되고 비워도 돼요');
  }

  // 시세(보유 종목·경쟁사·환율): Fire 화면이거나 CRCL 외 종목을 보고 있을 때 15초마다
  let quoteInflight = null;
  function loadQuote() { return (quoteInflight ||= fetchQuote().finally(() => { quoteInflight = null; })); }
  async function fetchQuote() {
    try {
      const extra = [...new Set([...WATCH.filter((x) => STOCK_INFO[x]?.custom), ...fireExtraSyms()])];
      const j = await getJ(`${NEWS_API}/quote${extra.length ? `?x=${extra.join(',')}` : ''}`, 15000);
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
    const positions = Object.values(merged).map((m) => ({ ticker: m.ticker, shares: m.shares, avg: m.cost / m.shares }));
    fireCfg = { positions, goal, buyFx: fx > 0 ? fx : null, afterTax: document.getElementById('f-tax')?.checked || false };
    writeJSON(FIRE_KEY, fireCfg);
    fireSim = null;
    fireConfirmDelete = false;
    toast('✓ 이 기기에 저장했어요');
    renderFireSet();
    // 새로 넣은 종목의 시세가 아직 없으면 바로 다시 받는다
    if (!state.quote || positions.some((p) => state.quote[p.ticker]?.price == null)) loadQuote().then(() => { renderFire(); renderSummary(); }).catch(() => renderFire());
    renderFire();
    renderSummary();
  }
  function deleteFire() {
    if (!fireConfirmDelete) { fireConfirmDelete = true; const b = document.getElementById('f-del'); if (b) b.textContent = '정말 삭제'; return; }
    fireCfg = null; fireHist = []; fireSim = null; fireConfirmDelete = false;
    try { localStorage.removeItem(FIRE_KEY); localStorage.removeItem(FIRE_HIST); } catch {}
    toast('이 기기에서 보유 정보를 지웠어요');
    renderFireSet(); renderFire(); renderSummary();
  }

  // ---------------------------------------------------------------- 서클 실적 (뉴스 탭 상단)
  const qLabel = (end) => { const [y, m] = end.split('-'); return `'${y.slice(2)} ${Math.ceil(+m / 3)}Q`; };
  const qLabelLong = (end) => { const [y, m] = end.split('-'); return `${y}년 ${Math.ceil(+m / 3)}분기`; };
  const dday = (iso) => Math.ceil((Date.parse(iso + 'T00:00:00') - new Date(new Date().toDateString()).getTime()) / 86400000);
  const krDate = (iso) => { const d = new Date(iso + 'T00:00:00'); if (EN) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
  const usdS = (v) => (v == null ? '–' : (v < 0 ? '-' : '') + usd(Math.abs(v)));

  function renderEarnings() {
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
        <div class="er-next-h"><span>다음 실적 발표</span>${N.estimated ? '<span class="tone neu">예상일</span>' : '<span class="tone pos">확정</span>'}</div>
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
      sub: last ? `최근 발표 ${last.reportedOn ? md(isoToTs(last.reportedOn)) : ''} · ${qLabelLong(last.end)} · SEC·Nasdaq` : 'SEC·Nasdaq',
      info: INFO.earnings,
      body: `${nextHtml}${tiles}
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
          { label: '준비금 이자수익', data: Q.map((q) => q.reserve ?? q.revenue), backgroundColor: C.blue, stack: 's', borderColor: '#141920', borderWidth: { top: 2 }, borderSkipped: 'bottom', maxBarThickness: 30 },
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
  const SYM_OK = /^[A-Z]{1,5}(\.[A-Z])?$/;
  const WATCH_KEY = 'cw.watch';
  const watchCfg = (() => { const w = readJSON(WATCH_KEY, null); return w?.list?.length ? { list: w.list, custom: w.custom || {} } : { list: BUILTIN.slice(), custom: {} }; })();
  // 추가한 종목의 기본 설정(이름·색·관련어). 로고는 이니셜.
  // 로고: 기본 4종목은 assets/logos, 그 밖의 S&P 500·자주 찾는 종목은 assets/logos/t (tools/fetch_logos.py가 받아 둠)
  const LOGOS = new Set(String(window.__LOGOS || '').split(' ').filter(Boolean));
  const logoPath = (sym) => (LOGOS.has(sym) ? `assets/logos/t/${sym}.png` : null);
  function customInfo(sym, meta = {}) {
    const name = String(meta.name || sym).replace(/,?\s+(Inc|Corp|Corporation|Ltd|Limited|Holdings?|Group|plc|Co|Company|Incorporated)\.?$/i, '').replace(/,?\s+(Inc|Corp|Ltd)\.?$/i, '').trim() || sym;
    const word = name.split(/\s+/)[0].replace(/[^\w&.-]/g, '');
    const hue = [...sym].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 17);
    const short = name.length > 9 ? sym : name;
    return {
      name, short, mark: sym[0], color: `hsl(${hue} 62% 60%)`, logo: logoPath(sym), cik: null, peer: null, peerNote: '', mode: 'growth', custom: true, exchange: meta.exchange || '',
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
    TAB_SETS[sym] ||= [['home', 'Home', 'home'], ['sprice', sym, 'chart'], ['searn', 'Earnings', 'earn'], ['snews', 'News', 'news']];
    if (!FIRE_TICKERS[sym] || FIRE_TICKERS[sym] === sym) FIRE_TICKERS[sym] = `${sym} · ${STOCK_INFO[sym].name}`;
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
    const id = U.sum.slice(2);
    if (!N) { if (document.getElementById(U.sum)) card(id, { title: '공시 · 발표 한눈에', body: '<p class="skeleton">불러오는 중…</p>' }); return; }
    const F = N.filings || [];
    const since = Date.now() - 30 * 86400000;
    const recent = F.filter((f) => Date.parse(f.d) >= since);
    const cnt = (re) => recent.filter((f) => re.test(f.form)).length;
    const last = (re) => F.find((f) => re.test(f.form));
    const k8 = last(/^8-K/), q = last(/^10-[QK]/);
    const off = (N.official || [])[0];
    const unseen = newsItems(sym).filter((i) => i.t > seen[sym].prev && i.level !== 'low').length;
    const upd = (t) => (EN ? `Updated ${ago(t || state.data?.updatedAt)}` : t ? `${ago(t)} 업데이트` : `${ago(state.data?.updatedAt)} 업데이트`);
    card(id, {
      title: '공시 · 발표 한눈에', sub: `공시 ${upd(N.filingsAt)} · 뉴스 ${upd(N.newsAt)}`, info: INFO.news,
      body: `<div class="ns-grid">
          <div><span>최근 8-K(수시공시)</span><b>${k8 ? md(isoToTs(k8.d)) : '–'}</b><small>30일간 ${cnt(/^8-K/)}건</small></div>
          <div><span>최근 실적 보고서</span><b>${q ? md(isoToTs(q.d)) : '–'}</b><small>${q ? esc(formInfo(q.form).label) : ''}</small></div>
          <div><span>내부자 거래 공시</span><b>${cnt(/^4$|^4\/A$/) + cnt(/^144/)}건</b><small>30일 · Form 4 ${cnt(/^4$|^4\/A$/)} · 144 ${cnt(/^144/)}</small></div>
          <div><span>새 소식</span><b>${unseen}건</b><small>지난 방문 이후</small></div>
        </div>
        ${off ? `<a class="ns-top" href="${safeUrl(off.url)}" target="_blank" rel="noopener"><span class="nk related">최신 ${U.name} 발표</span><span class="nt">${esc(off.title)}</span><span class="nm">${esc(off.source)} · ${dayLabel(Date.parse(off.t))}</span></a>` : ''}`,
    });
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
  for (const s of OTHER) TAB_SETS[s] = [['home', 'Home', 'home'], ['sprice', s, 'chart'], ['searn', 'Earnings', 'earn'], ['snews', 'News', 'news']];
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
  const stockParts = (sym) => (sym === 'CRCL' ? ['holders', 'analyst', 'options'] : ['schart', 'searn', 'snews', 'sfilings', 'holders', 'analyst', 'options',
    ...(sym === 'JOBY' ? ['faa', 'facts'] : []), ...(sym === 'SPCX' ? ['sfacts', 'facts'] : []), ...(STOCK_INFO[sym]?.custom ? ['sshort'] : [])]);
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const usdS2 = (v) => (v == null ? '–' : (v < 0 ? '-' : '') + usd(Math.abs(v)));
  const sp = (v) => (v == null || !isFinite(v) ? '–' : `<span class="${cls(v)}">${pct(v)}</span>`);
  const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

  function renderTabbar() {
    const nav = document.getElementById('tabbar');
    if (!nav) return;
    const tabs = TAB_SETS[state.stock];
    nav.style.setProperty('--tabs', tabs.length);
    nav.innerHTML = tabs.map(([v, label, ic]) => `<button type="button" data-tab="${v}" ${v === state.view ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[ic]}</svg><span>${label}</span>${ic === 'news' ? '<b class="tab-badge" id="news-badge" hidden></b>' : ''}</button>`).join('');
    updateNewsBadge();
  }
  const viewAllowed = (v) => v === 'fire' || TAB_SETS[state.stock].some(([t]) => t === v);

  // 종목 시세: 바이낸스 선물이 있는 종목(SPCX·TEM)은 CRCL처럼 바이낸스 값만, 나머지(JOBY)는 Nasdaq + Yahoo 실시간 체결
  function pq(sym) {
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
  function renderStockSwitch() {
    const el = document.getElementById('stock-switch');
    if (!el) return;
    const syms = WATCH;
    if (el.dataset.built !== syms.join(',')) {
      el.innerHTML = syms.map((sym) => `<button type="button" role="tab" class="ss" data-stock="${sym}" style="--sc:${STOCK_INFO[sym].color}" title="${esc(STOCK_INFO[sym].name)}">
        <span class="ss-top">${STOCK_INFO[sym].logo ? `<img class="ss-logo" src="${STOCK_INFO[sym].logo}" alt="" width="20" height="20" decoding="async">` : `<i class="ss-logo ss-letter">${esc(sym[0])}</i>`}<span class="ss-tk">${sym}</span><i class="ss-ed" hidden>실적</i></span>
        <span class="ss-px">–</span><em class="ss-ch flat"></em></button>`).join('');
      el.dataset.built = syms.join(',');
    }
    for (const btn of el.querySelectorAll('.ss[data-stock]')) {
      const sym = btn.dataset.stock, p = stockPx(sym);
      const ed = btn.querySelector('.ss-ed'); if (ed) ed.hidden = !earnDay(sym);
      btn.setAttribute('aria-selected', String(sym === state.stock));
      btn.setAttribute('aria-label', `${STOCK_INFO[sym].name} ${sym} ${p?.price != null ? price(p.price) : ''} ${p?.pct != null ? pct(p.pct, 1) : ''}`);
      btn.querySelector('.ss-px').textContent = p?.price != null ? price(p.price) : '–';
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
    if (!viewAllowed(state.view)) showView('home');
    else document.getElementById('view-title').textContent = viewTitle(state.view);
    fireLoop(state.view === 'fire' || isOther());
    renderStock();
    busyBar(true);
    if (sym === 'CRCL') { try { renderKpis(); renderSummary(); } catch (e) { console.error(e); } } // 미리 받아 둔 값으로 Home 지표·요약도 바로
    syncNow(['quote', ...stockParts(sym)], { sym }).then(() => { if (state.stock === sym) { renderStock(); if (sym === 'CRCL') { renderKpis(); renderSummary(); } } }).catch(() => {}).finally(() => busyBar(false));
  }

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
      last.textContent = price(q.price);
      if (sPrev.sym === sym && sPrev.px != null && q.price !== sPrev.px && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        last.classList.remove('flash-up', 'flash-down'); void last.offsetWidth; last.classList.add(q.price > sPrev.px ? 'flash-up' : 'flash-down');
      }
    }
    sPrev = { sym, px: q.price };
    setHtml('spx-chg', `<span class="${cls(q.pct)}">${arrow(q.pct)} ${q.change >= 0 ? '+' : '-'}$${Math.abs(q.change ?? 0).toFixed(2)} (${pct(q.pct, 2)})</span>`);
    setHtml('spc-last', price(q.price));
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
    setHtml('spx-time', esc(String(q.time || '').replace(/^.*?(\d{1,2}:\d{2} [AP]M ET)$/, '$1')));
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
    drawCandles(id, pts, { compact, xf: range === '1d' || range === 'bn' ? hm : mdLocal, tip, last, ind: !compact });
  }

  const bxRange = () => (RANGES[state.srange] ? state.srange : '1d'); // 바이낸스 캔들은 1일~3개월
  function renderSPriceCard(sym = state.stock) {
    if (BN24[sym]) {
      const X = bxOf(sym);
      card('sprice', {
        title: `${sym} 실시간 주가`, sub: `Binance ${BN24[sym]} 무기한 선물 · 24시간 거래`, info: INFO.sprice(sym),
        body: `
          <div class="px-main"><span class="px-last" id="spx-last">${price(X.t?.last)}</span><span class="px-chg" id="spx-chg"></span></div>
          <div class="px-meta"><span id="spx-via">연결 중…</span><span id="spx-time"></span></div>
          <div class="chart spark"><canvas id="cv-sspark" role="img" aria-label="${sym} 최근 24시간 가격"></canvas></div>
          <div class="px-range" aria-label="24시간 가격 범위"><span id="spx-low">–</span><div class="rb"><i id="spx-rb"></i></div><span id="spx-high">–</span></div>
          <div class="px-stats">
            <div><span>24h 거래대금</span><b id="spx-qv">–</b></div>
            <div><span>펀딩비</span><b id="spx-fund">–</b><small id="spx-next"></small></div>
            <div><span>미결제약정</span><b id="spx-oi">–</b></div>
          </div>
          <button type="button" class="link-btn" data-go="sprice:c-spricechart">가격 차트 · 공매도 · 기관 보유 보기${chevron}</button>`,
      });
      sLine('sspark', X.klines['1d'], { compact: true, sym, range: 'bn' });
      paintStock();
      return;
    }
    const S = STOCK_INFO[sym], q = state.quote?.[sym], ch = st(sym).chart['1d'];
    const pts = ch?.points || [];
    const lo = pts.length ? Math.min(...pts.map((p) => p[1])) : null, hi = pts.length ? Math.max(...pts.map((p) => p[1])) : null;
    const pos = q?.price != null && hi > lo ? (q.price - lo) / (hi - lo) : 0.5;
    const y1 = st(sym).chart['1y'] || ch;
    const stats = sym === 'SPCX'
      ? `<div><span>상장 후 최고</span><b>${price(y1?.high52)}</b></div><div><span>공모가 대비</span><b id="spx-ipo">–</b><small>공모가 ${price(ipoPx())}</small></div>`
      : `<div><span>52주 최고</span><b>${price(y1?.high52)}</b></div><div><span>52주 최저</span><b>${price(y1?.low52)}</b></div>`;
    card('sprice', {
      title: `${sym} 실시간 주가`, sub: `${S.name} · Nasdaq 실시간(장전·장중·장후)`, info: INFO.sprice(sym),
      body: `
        <div class="px-main"><span class="px-last" id="spx-last">${price(q?.price)}</span><span class="px-chg" id="spx-chg"></span></div>
        <div class="px-meta"><span id="spx-via">불러오는 중…</span><span id="spx-time"></span></div>
        <div class="chart spark"><canvas id="cv-sspark" role="img" aria-label="${sym} 오늘 가격"></canvas></div>
        <div class="px-range" aria-label="오늘 가격 범위"><span>${price(lo)}</span><div class="rb"><i style="left:${Math.min(100, Math.max(0, pos * 100))}%"></i></div><span>${price(hi)}</span></div>
        <div class="px-stats">${stats}${S.peer ? `<div><span>경쟁사 ${S.peer[1]}</span><b id="spx-peer">–</b><small>${S.peer[0]}</small></div>` : `<div><span>52주 위치</span><b>${q?.price && y1?.high52 > y1?.low52 ? Math.round(((q.price - y1.low52) / (y1.high52 - y1.low52)) * 100) + '%' : '–'}</b><small>최저 0% · 최고 100%</small></div>`}</div>
        <button type="button" class="link-btn" data-go="sprice:c-spricechart">가격 차트 · 공매도 · 기관 보유 보기${chevron}</button>`,
    });
    sLine('sspark', pts, { compact: true, sym });
    paintStock();
  }

  function renderSPriceChart(sym = state.stock) {
    if (BN24[sym]) {
      const X = bxOf(sym), r = bxRange(), k = X.klines[r];
      let note = '';
      if (k?.length) note = `${RANGES[r].label} 최고 ${price(Math.max(...k.map((p) => p[3] ?? p[1])))} · 최저 ${price(Math.min(...k.map((p) => p[4] ?? p[1])))} · 시작 ${price(k[0][2] ?? k[0][1])} · ${RANGES[r].interval} 캔들`;
      card('spricechart', {
        title: `${sym} 가격 추이`, sub: `Binance ${BN24[sym]} 무기한 선물`, info: INFO.pricechart,
        body: `
          <div class="seg range" role="group" aria-label="기간 선택">${Object.entries(RANGES).map(([key, v]) => `<button type="button" data-srange="${key}" aria-pressed="${key === r}">${v.label}</button>`).join('')}</div>
          ${chartTools('spricechart')}
          <div class="px-main sm"><span class="px-last" id="spc-last">${price(X.t?.last)}</span><span class="px-chg" id="spc-chg"></span></div>
          <div class="chart tall"><canvas id="cv-spricechart" role="img" aria-label="${sym} 가격 추이"></canvas></div>
          <p class="note">${note || '불러오는 중…'}</p>`,
      });
      if (!k) { bxKlines(sym, r).then(() => { if (bxRange() === r && state.stock === sym) renderSPriceChart(sym); }).catch(() => {}); return; }
      sLine('spricechart', k, { range: r === '1d' ? 'bn' : r, sym });
      paintStock();
      return;
    }
    const r = state.srange, ch = st(sym).chart[r];
    const pts = ch?.points || [];
    let note = '';
    if (pts.length) {
      const v = pts.map((p) => p[1]);
      note = `${SRANGES[r]} 최고 ${price(Math.max(...v))} · 최저 ${price(Math.min(...v))} · 시작 ${price(v[0])}${ch.high52 ? ` · 52주 ${price(ch.low52)}~${price(ch.high52)}` : ''}`;
    }
    const q = state.quote?.[sym];
    const chg = pts.length && q?.price ? q.price / (r === '1d' && (q.prevClose || ch.prevClose) ? (q.prevClose || ch.prevClose) : pts[0][1]) - 1 : null;
    card('spricechart', {
      title: `${sym} 가격 추이`, sub: `${STOCK_INFO[sym].name} · Yahoo Finance`, info: '',
      body: `
        <div class="seg range jr" role="group" aria-label="기간 선택">${Object.entries(SRANGES).map(([k, v]) => `<button type="button" data-srange="${k}" aria-pressed="${k === r}">${v}</button>`).join('')}</div>
        ${chartTools('spricechart')}
        <div class="px-main sm"><span class="px-last" id="spc-last">${price(q?.price)}</span><span class="px-chg">${chg == null ? '' : `<span class="${cls(chg)}">${arrow(chg)} ${pct(chg, 2)}</span> <span class="lbl">${SRANGES[r]} 동안</span>`}</span></div>
        <div class="chart tall"><canvas id="cv-spricechart" role="img" aria-label="${sym} 가격 추이"></canvas></div>
        <p class="note">${note || '불러오는 중…'}</p>`,
    });
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
      return `<li><span class="h-rank${rank <= 3 ? ' top3' : ''}" aria-label="${rank}위">${rank}</span><div class="h-name"><b>${esc(inst ? inst[1] : titleCase(r.name))}</b><small>${inst ? esc(titleCase(r.name)) + ' · ' : ''}${r.date ? md(isoToTs(r.date)) + ' 기준' : ''}${old ? ' <i class="h-old">지난 분기</i>' : ''}</small></div>
        <div class="h-sh"><b>${r.soldOut ? '0주' : unit(r.shares) + '주'}</b><small>${shareOf(r) != null && !r.soldOut ? '지분 ' + pctPlain(shareOf(r), 2) : r.value != null ? usd(r.value) : ''}</small></div>
        <div class="h-chg">${chgTxt(r)}</div></li>`;
    }).join('');
    // 다음 13F 마감: 분기 말 + 45일
    const qEnd = latest ? new Date(latest + 'T00:00:00') : null;
    const nextQ = qEnd ? new Date(qEnd.getFullYear(), qEnd.getMonth() + 4, 0) : null;
    const nextDue = nextQ ? new Date(nextQ.getTime() + 45 * 86400000) : null;
    const flow = inc && dec ? (inc.shares || 0) - (dec.shares || 0) : null;
    card(id, {
      title, sub: `${S.short} · 13F 신고 기준 · Nasdaq · ${latest ? md(isoToTs(latest)) + ' 분기 말' : ''}`, info: INFO.holders,
      body: `<div class="ns-grid h-grid">
          <div><span>기관 보유 비율</span><b>${pctPlain(H.ownershipPct)}</b><small>${EN ? `of ${unit(H.sharesOut)} shares outstanding` : `발행 주식 ${unit(H.sharesOut)}주 중`}</small></div>
          <div><span>보유 기관 수</span><b>${H.holders != null ? nf(0).format(H.holders) + '곳' : '–'}</b><small>보유 ${unit(H.totalShares?.shares)}주 · ${usd(H.totalValue)}</small></div>
          <div><span>직전 13F 대비 늘린 곳</span><b class="up">${inc ? nf(0).format(inc.holders) + '곳' : '–'}</b><small>+${unit(inc?.shares)}주${H.newPos ? ` · 신규 ${nf(0).format(H.newPos.holders)}곳` : ''}</small></div>
          <div><span>줄인 곳</span><b class="down">${dec ? nf(0).format(dec.holders) + '곳' : '–'}</b><small>-${unit(dec?.shares)}주${H.soldOut ? ` · 전량 매도 ${nf(0).format(H.soldOut.holders)}곳` : ''}</small></div>
        </div>
        ${flow != null ? `<div class="h-flow"><span>기관 순매수(직전 분기 대비)</span><b class="${cls(flow)}">${flow > 0 ? '+' : ''}${unit(flow)}주</b></div>` : ''}
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
  const MK_MAIN = ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', '^TNX', 'DX-Y.NYB', 'BTC-USD'];
  const mkVal = (x) => (x.price == null ? '–' : x.sym === '^TNX' ? x.price.toFixed(2) + '%' : x.sym === 'BTC-USD' ? '$' + nf(0).format(x.price) : nf(x.price >= 1000 ? 0 : 2).format(x.price));
  function sparkSvg(arr, up) {
    if (!arr || arr.length < 2) return '';
    const mn = Math.min(...arr), mx = Math.max(...arr), w = 60, h = 18;
    const p = arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - (mx > mn ? (v - mn) / (mx - mn) : 0.5) * h).toFixed(1)}`).join(' ');
    return `<svg class="mk-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${p}" fill="none" stroke="${up ? C.up : C.down}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function renderMarket() {
    if (!document.getElementById('c-market')) return;
    const M = state.market, S = marketSession(), by = Object.fromEntries((M?.items || []).map((x) => [x.sym, x]));
    const tiles = MK_MAIN.map((sym) => by[sym]).filter((x) => x && !x.error).map((x) => `<div class="mk-t" title="${esc(x.name)}"><span>${esc(MK_SHORT[x.sym] || x.name)}</span><b>${mkVal(x)}</b><em class="${cls(x.pct)}">${pct(x.pct, 2)}</em>${sparkSvg(x.spark, (x.pct || 0) >= 0)}</div>`).join('');
    const fut = ['ES=F', 'NQ=F'].map((s) => by[s]).filter((x) => x && !x.error && x.pct != null);
    card('market', {
      title: '시장 개요', sub: `<span class="mk-st ${S.k}">${S.label}</span> ${S.next}`, info: INFO.market,
      body: M ? `<div class="mk-grid">${tiles}</div>${fut.length && S.k !== 'open' ? `<p class="mk-fut">지수 선물 ${fut.map((x) => `${esc(x.name.replace(' 선물', ''))} <b class="${cls(x.pct)}">${pct(x.pct, 2)}</b>`).join(' · ')} <small>(장외 시간의 분위기)</small></p>` : ''}` : '<p class="skeleton">불러오는 중…</p>',
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
    if (!kwBoot && fresh.length) toast(`🔔 키워드 속보 · <b>${esc(fresh[0].hit[0])}</b> ${esc(fresh[0].title.slice(0, 60))}`);
    for (const i of items) kwNotified.add(i.key);
    kwNotified = new Set([...kwNotified].slice(-300));
    writeJSON('cw.kwNoti', [...kwNotified]);
    if (state.mnews) kwBoot = false;
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
      title, sub: `${S.short} · 증권사 ${n}곳 · ${V.src === 'Nasdaq' ? 'Nasdaq 집계' : '증권사별 최근 목표가로 계산'}`, info: INFO.analyst,
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
  const ACTION_KO = { Initiated: ['신규', 'neu'], Upgrade: ['상향', 'pos'], Downgrade: ['하향', 'neg'], Reiterated: ['유지', 'neu'], Resumed: ['재개', 'neu'], 'Target Raised': ['목표↑', 'pos'], 'Target Lowered': ['목표↓', 'neg'] };
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
      <ul class="h-list br-list">${rows}</ul><p class="note">출처: Finviz. 목표가 옆 %는 현재가 대비. "A→B"는 이번에 바꾼 의견·목표가예요.</p>`;
  }

  // ---------------------------------------------------------------- 옵션 시장 심리 (CBOE 지연 시세)
  function optTone(O) {
    if (!O?.pcVol && O?.pcVol !== 0) return ['neu', '자료 부족'];
    return O.pcVol < 0.7 ? ['pos', '상승 베팅 우세'] : O.pcVol > 1.0 ? ['neg', '하락 대비 우세'] : ['neu', '균형'];
  }
  function renderOptions(sym = state.stock, id = sym === 'CRCL' ? 'options' : 'soptions') {
    if (!document.getElementById('c-' + id)) return;
    const O = state.options?.[sym], S = STOCK_INFO[sym], title = '옵션 시장 심리';
    if (!O) { card(id, { title, info: INFO.options, body: `<p class="skeleton">${state.optionsErr?.[sym] ? esc(state.optionsErr[sym]) : '불러오는 중…'}</p>` }); return; }
    const [tone, label] = optTone(O), sp0 = O.spot;
    const mv = (x, lbl) => (x ? `<div><span>${lbl}</span><b>±${(x.move * 100).toFixed(1)}%</b><small>${md(isoToTs(x.exp))} 만기(${x.days}일) · ${price(sp0 * (1 - x.move))}~${price(sp0 * (1 + x.move))}</small></div>` : '');
    const strikes = (L, t) => L.map((r) => `<span class="op-k ${t}" title="${md(isoToTs(r.exp))} 만기 · 미결제 ${unit(r.oi)}계약">$${r.k % 1 ? r.k.toFixed(1) : r.k}<small>${unit(r.oi)} · ${md(isoToTs(r.exp))}</small></span>`).join('');
    card(id, {
      title, sub: `${S.short} · CBOE 옵션 시세(약 15분 지연) · 기준가 ${price(sp0)}`, info: INFO.options,
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
  const etDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const etOffset = (iso) => { try { const v = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(iso + 'T12:00:00Z')).find((p) => p.type === 'timeZoneName').value; const m = v.match(/GMT([+-]\d+)/); return m ? `${m[1].startsWith('-') ? '-' : '+'}${String(Math.abs(+m[1])).padStart(2, '0')}:00` : '-05:00'; } catch { return '-05:00'; } };
  const earnOf = (sym) => (sym === 'CRCL' ? state.earnings : st(sym).earn);
  function earnDay(sym) {
    const E = earnOf(sym), A = state.analyst?.[sym]?.street;
    if (!E) return null;
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
        title: `🔔 ${S.short} 실적 발표 ${dday(N.date) <= 0 ? '오늘' : dday(N.date) === 1 ? '내일' : `D-${dday(N.date)}`}`, sub: `${N.quarter ? qLabelLong(N.quarter) + ' 실적 · ' : ''}미국 ${krDate(N.date)}${D.time ? ` · ${D.time === 'BMO' ? '장 시작 전' : '장 마감 후'}` : ' · 시각 미정'}`, info: INFO.earnday,
        body: `${kst ? `<div class="ed-time"><b>한국시간 ${esc(kst)}경</b>${left > 0 ? `<span>${Math.floor(left / 3600000)}시간 ${Math.floor((left % 3600000) / 60000)}분 남음</span>` : '<span>곧 발표</span>'}</div>` : ''}
          <div class="ns-grid er-grid">
            <div><span>예상 EPS</span><b>${N.consensus != null ? '$' + N.consensus.toFixed(2) : '–'}</b><small>${N.low != null ? `범위 $${N.low.toFixed(2)}~$${N.high.toFixed(2)}` : ''}${N.analysts ? ` · ${N.analysts}명` : ''}</small></div>
            <div><span>작년 같은 분기</span><b>${N.lastYearEps != null ? '$' + N.lastYearEps.toFixed(2) : '–'}</b><small>EPS</small></div>
            <div><span>옵션이 보는 변동폭</span><b>${O?.earn ? '±' + (O.earn.move * 100).toFixed(1) + '%' : '–'}</b><small>${O?.earn ? `${price(O.spot * (1 - O.earn.move))} ~ ${price(O.spot * (1 + O.earn.move))}` : '옵션 자료 없음'}</small></div>
            <div><span>최근 ${sur.length}분기 예상 상회</span><b>${sur.length ? `${beats}/${sur.length}` : '–'}</b><small>EPS 기준</small></div>
          </div>
          <p class="ed-check">✅ 볼 것: ${EARN_CHECK[sym] || '매출·EPS가 예상보다 높은지, 다음 분기 가이던스'}</p>`,
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
      title: `📊 ${S.short} 실적 발표 결과`, sub: `${q ? qLabelLong(q.end) : ''} · 발표 ${D.repMs ? new Date(D.repMs).toLocaleString(LOC, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}`, info: INFO.earnday,
      body: `<div class="ns-grid er-grid">
          <div><span>EPS</span><b class="${cls(epsS)}">${eps != null ? '$' + (+eps).toFixed(2) : '–'}</b><small>${epsEst != null ? `예상 $${(+epsEst).toFixed(2)} · ` : ''}${epsS != null ? `<span class="${cls(epsS)}">${epsS >= 0 ? '예상 상회' : '예상 하회'} ${pct(epsS, 0)}</span>` : ''}</small></div>
          <div><span>매출</span><b class="${cls(salesS)}">${fq?.sales ? usd(fq.sales) : usdS2(q?.revenue)}</b><small>${fq?.salesEst ? `예상 ${usd(fq.salesEst)} · <span class="${cls(salesS)}">${salesS >= 0 ? '상회' : '하회'} ${pct(salesS, 1)}</span>` : ''}</small></div>
          <div><span>주가 반응</span><b class="${cls(p?.pct)}">${p?.pct != null ? pct(p.pct, 1) : '–'}</b><small>${price(p?.price)} · ${BN24[sym] || sym === 'CRCL' ? '바이낸스 24시간' : esc(mktStatus(state.quote?.[sym]?.status))}</small></div>
          <div><span>다음 실적</span><b>${D.E.next?.date && D.E.next.date > (q?.end || '') ? md(isoToTs(D.E.next.date)) : '–'}</b><small>${D.E.next?.estimated ? '예상일' : ''}</small></div>
        </div>
        ${k8 ? `<a class="faa-notice good" href="${safeUrl(k8.url)}" target="_blank" rel="noopener">📄 실적 발표 공시(8-K, ${md(isoToTs(k8.d))}) 원문 보기 →</a>` : ''}
        ${news.length ? `<div class="mini-h er-h">실적 관련 소식</div><ul class="nl faa-nl">${news.map((i) => `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener"><span class="nk related">${i.official ? '공식' : '뉴스'}</span><span class="nt">${esc(i.title)}</span>${i.sum ? `<span class="nsum">${esc(i.sum)}</span>` : ''}<span class="nm">${esc(i.source)} · ${dayLabel(i.t)}</span></a></li>`).join('')}</ul>` : ''}
        <p class="ed-check">✅ 이어서 볼 것: ${EARN_CHECK[sym] || '가이던스와 컨퍼런스콜 내용'}</p>`,
    });
  }

  // ---------------------------------------------------------------- 종목 추가·삭제·순서 (이 기기에 저장)
  let watchSearchTimer = null, watchResults = [];
  function saveWatch() { writeJSON(WATCH_KEY, { list: WATCH, custom: watchCfg.custom }); }
  function openWatchSheet() {
    let el = document.getElementById('watch-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'watch-sheet'; el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '종목 관리');
      document.body.appendChild(el);
    }
    el.hidden = false;
    document.body.classList.add('sheet-open');
    renderWatchSheet();
    setTimeout(() => document.getElementById('watch-q')?.focus(), 50);
  }
  function closeWatchSheet() { const el = document.getElementById('watch-sheet'); if (el) el.hidden = true; document.body.classList.remove('sheet-open'); }
  function renderWatchSheet() {
    const el = document.getElementById('watch-sheet');
    if (!el || el.hidden) return;
    const q = document.getElementById('watch-q')?.value || '';
    const rows = WATCH.map((sym, i) => {
      const S = STOCK_INFO[sym];
      return `<li><span class="ws-logo" style="--sc:${S.color}">${S.logo ? `<img src="${S.logo}" alt="" width="22" height="22">` : esc(sym[0])}</span>
        <div class="ws-name"><b>${sym}</b><small>${esc(S.name)}${BUILTIN.includes(sym) ? ' · 기본' : ''}</small></div>
        <button type="button" class="ws-btn" data-wmove="${i}:-1" aria-label="${sym} 위로" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="ws-btn" data-wmove="${i}:1" aria-label="${sym} 아래로" ${i === WATCH.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="ws-btn del" data-wdel="${sym}" aria-label="${sym} 삭제" ${WATCH.length < 2 ? 'disabled' : ''}>삭제</button></li>`;
    }).join('');
    const res = (watchResults || []).map((r) => `<li>${logoPath(r.symbol) ? `<span class="ws-logo"><img src="${logoPath(r.symbol)}" alt="" width="22" height="22" loading="lazy"></span>` : `<span class="ws-logo ws-letter">${esc(String(r.symbol || '?')[0])}</span>`}<div class="ws-name"><b>${esc(r.symbol)}</b><small>${esc(r.name)} · ${esc(r.exchange)}${r.asset === 'ETF' ? ' · ETF' : ''}</small></div>
      ${WATCH.includes(r.symbol) ? '<span class="ws-added">추가됨</span>' : `<button type="button" class="ws-btn add" data-wadd="${esc(r.symbol)}" data-wname="${esc(r.name)}" data-wex="${esc(r.exchange)}">+ 추가</button>`}</li>`).join('');
    const removedBuiltin = BUILTIN.filter((s) => !WATCH.includes(s));
    el.innerHTML = `<div class="sheet-bg" data-wclose="1"></div><div class="sheet-panel">
      <div class="sheet-h"><b>종목 관리</b><button type="button" class="ws-btn" data-wclose="1">완료</button></div>
      <label class="ws-search"><input id="watch-q" type="search" placeholder="티커나 영문 회사명 (예: AAPL, Tesla)" autocomplete="off" value="${esc(q)}"></label>
      ${q ? `<ul class="ws-list">${res || `<li class="empty">${watchResults === null ? '검색 중…' : '검색 결과가 없어요. 영문으로 입력해 보세요.'}</li>`}</ul>` : ''}
      ${removedBuiltin.length && !q ? `<div class="ws-sub">다시 추가하기</div><ul class="ws-list">${removedBuiltin.map((s) => `<li><div class="ws-name"><b>${s}</b><small>${esc(STOCK_INFO[s].name)} · 기본</small></div><button type="button" class="ws-btn add" data-wadd="${s}">+ 추가</button></li>`).join('')}</ul>` : ''}
      <div class="ws-sub">내 종목 <small>위에서부터 홈 상단에 보여요</small></div>
      <ul class="ws-list">${rows}</ul>
      <p class="note">🔒 종목 목록은 이 기기(브라우저)에만 저장돼요. 기본 4종목(CRCL·JOBY·SPCX·TEM)은 전용 화면(FAA 인증·보호예수 등)이 있고, 새로 추가한 종목은 공통 화면(주가·실적·뉴스·공시·공매도·기관·애널리스트·옵션)으로 보여요. 바이낸스에 24시간 주식 선물이 있는 종목은 CRCL처럼 바이낸스 가격으로 표시돼요.</p>
    </div>`;
    const inp = document.getElementById('watch-q');
    if (inp && q) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
  }
  function watchSearch(q) {
    clearTimeout(watchSearchTimer);
    if (!q.trim()) { watchResults = []; renderWatchSheet(); return; }
    watchSearchTimer = setTimeout(async () => {
      watchResults = null; renderWatchSheet();
      try { watchResults = (await getJ(`${NEWS_API}/lookup?q=${encodeURIComponent(q.trim())}`, 10000)).results || []; } catch { watchResults = []; }
      if ((document.getElementById('watch-q')?.value || '') === q) renderWatchSheet();
    }, 300);
  }
  function addWatch(sym, meta = {}) {
    if (!SYM_OK.test(sym) || WATCH.includes(sym)) return;
    if (!BUILTIN.includes(sym)) { watchCfg.custom[sym] = { name: meta.name || sym, exchange: meta.exchange || '' }; registerStock(sym); }
    WATCH.push(sym);
    saveWatch();
    afterWatchChange(sym);
    toast(`✓ ${sym} 추가 · 홈 상단에서 고를 수 있어요`);
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
  function nextEarnHtml(N, extra = '') {
    if (!N?.date) return '';
    const dd = dday(N.date);
    return `
      <div class="er-next">
        <div class="er-next-h"><span>다음 실적 발표</span>${N.estimated ? '<span class="tone neu">예상일</span>' : '<span class="tone pos">확정</span>'}</div>
        <div class="er-next-d"><b>${krDate(N.date)}</b><span class="er-dday">${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '발표 완료'}</span></div>
        <div class="er-next-m">${N.quarter ? qLabelLong(N.quarter) + ' 실적 · ' : ''}예상 EPS <b>${N.consensus != null ? '$' + N.consensus.toFixed(2) : '–'}</b>${N.low != null ? ` (범위 $${N.low.toFixed(2)}~$${N.high.toFixed(2)}${N.analysts ? `, ${N.analysts}명` : ''})` : ''}${N.lastYearEps != null ? ` · 작년 같은 분기 $${N.lastYearEps.toFixed(2)}` : ''}</div>
        ${extra}
      </div>`;
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
      title: '조비 실적', sub: last ? `최근 발표 ${last.reportedOn ? md(isoToTs(last.reportedOn)) : ''} · ${qLabelLong(last.end)} · SEC·Nasdaq` : 'SEC·Nasdaq', info: INFO.jearnings,
      body: `${nextEarnHtml(E.next, '<p class="note">실적 발표 때 주주서한에 <b>FAA 인증 단계별 진행률</b>도 함께 공개돼요.</p>')}
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
      title: `${S.short} 실적`, sub: last ? `최근 발표 ${last.reportedOn ? md(isoToTs(last.reportedOn)) : ''} · ${qLabelLong(last.end)} · SEC·Nasdaq` : 'SEC·Nasdaq', info: INFO.searnings,
      body: `${nextEarnHtml(E.next, lk ? `<p class="note">⚠️ 실적 발표 2거래일 뒤 <b>보호예수 최대 ${unit(lk.shares)}주</b>가 풀려요(${esc(lk.label)}).</p>` : '')}
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
    el.innerHTML = [...own, T.inst, T.short, T.next, T.peer, ...analystTiles(sym)].join('');
  }

  // 규칙 기반 자동 요약 (종목 공통 + 종목별 항목)
  function renderSSummary(sym = state.stock) {
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
        <p class="sum-line">${tags.length ? tags.map((t) => `<span class="${t.tone}">${t.tag}</span>`).join('<i>·</i>') : '뚜렷한 변화 없이 보합'}</p>
        <div class="sum-count"><span class="tone pos">긍정 ${nPos}</span><span class="tone neg">주의 ${nNeg}</span><span class="tone neu">중립 ${items.length - nPos - nNeg}</span></div>
        <ul class="sum-list">${pxLine}${byTone(items).map((i) => `<li><button type="button" data-go="${i.go}"><span class="tone ${i.tone}">${toneName[i.tone]}</span><span class="txt">${i.html}</span>${chevron}</button></li>`).join('')}</ul>`,
    });
  }

  function renderSEarnings(sym = state.stock) {
    if (!isOther(sym)) return;
    if (sym === 'JOBY') renderFaa();
    if (sym === 'SPCX') renderLockup();
    STOCK_INFO[sym].mode === 'burn' ? renderBurnEarnings(sym) : renderGrowthEarnings(sym);
  }
  function renderStock() {
    renderStockSwitch();
    const sym = state.stock;
    if (!isOther(sym)) { for (const j of [() => renderHolders('CRCL', 'holders'), () => renderAnalyst('CRCL'), () => renderInsider('CRCL'), () => renderOptions('CRCL'), () => renderEarnDay('CRCL')]) { try { j(); } catch (e) { console.error(e); } } return; }
    document.getElementById('c-faa').hidden = sym !== 'JOBY';
    document.getElementById('c-lockup').hidden = sym !== 'SPCX';
    const S = STOCK_INFO[sym];
    const jobs = [() => renderSPriceCard(sym), () => renderSKpis(sym), () => renderSSummary(sym), () => renderSPriceChart(sym),
      () => renderShort(shortOf(sym), 'sshort', S.short), () => renderHolders(sym, 'sholders'), () => renderAnalyst(sym), () => renderInsider(sym), () => renderOptions(sym), () => renderEarnDay(sym), () => renderSEarnings(sym),
      () => renderNewsSummary(sym), () => renderNews(sym), updateNewsBadge];
    for (const j of jobs) { try { j(); } catch (e) { console.error(e); } }
  }

  // ---------------------------------------------------------------- 실시간 체결가 (Yahoo Finance 스트림 · 바이낸스 24시간 선물)
  // Nasdaq 시세(15초)는 장 상태·전일 종가를 위한 기본값으로 두고, 체결이 날 때마다 오는 Yahoo 스트림 값으로 바로 덮어쓴다
  // (미국 장전·장중·장후). SPCX·TEM은 바이낸스에도 24시간 거래되는 주식 선물이 있어 밤·주말 흐름을 함께 보여준다.
  const YF_SYMS = ['JOBY', 'SPCX', 'TEM', 'ACHR', 'RKLB', 'GH', 'CRCA', 'CRCL', ...Object.keys(watchCfg.custom).filter((x) => SYM_OK.test(x))];
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
      state.data = S.data; state.quote = S.quote || null; state.earnings = S.earnings || null;
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
  async function prefetchStocks() {
    if (Date.now() - lastPrefetch < 10 * 60000 || document.hidden) return;
    lastPrefetch = Date.now();
    await Promise.all(WATCH.filter((sym) => sym !== state.stock).map((sym) => syncNow(stockParts(sym), { sym, quiet: true }).catch(() => {})));
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
      renderUsdcFlow, renderReserve, renderProducts, renderChains, renderTvl, renderDex, renderArcActivity, renderBorrow, renderArcSupply, renderLending, renderCirbtc, renderAccounts, renderCctp, renderEarnings, () => renderNewsSummary('CRCL'), () => renderNews('CRCL'), updateNewsBadge, renderFire, renderStock, renderMarket, renderKwNews];
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
  const SYNC_SETS = {
    manual: ['market', 'mnews', 'circle', 'cirbtc', 'stables', 'series', 'dex', 'tvl', 'lending', 'accounts', 'activity', 'cctp', 'rates', 'short', 'filings', 'news', 'earnings', 'quote'],
    auto: ['market', 'mnews', 'circle', 'cirbtc', 'stables', 'series', 'dex', 'tvl', 'accounts', 'activity', 'cctp', 'rates', 'short', 'filings', 'news', 'earnings', 'quote'],
    light: ['circle', 'cirbtc', 'quote', 'market', 'mnews'],
  };
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
        await loadData().catch((e) => { if (!state.data) throw e; });
        renderAll(); // 먼저 서버 데이터로 그리고, 아래 동기화가 끝나면 다시 그린다
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
    home: "Fire Portfolio", fire: 'Fire · 퇴사까지',
    crcl: '서클 주가 · 수급', earn: '서클 실적', usdc: 'USDC · 스테이블코인', arc: 'Arc 체인', news: '서클 뉴스 · 공시',
    sprice: '주가 · 수급', searn: '실적', snews: '뉴스 · 공시',
  };
  const viewTitle = (v) => {
    const S = STOCK_INFO[state.stock];
    if (v === 'sprice') return `${S.short} 주가 · 수급`;
    if (v === 'searn') return S.earnTitle;
    if (v === 'snews') return `${S.short} 뉴스 · 공시`;
    if (v === 'fire' && state.fireTab === 'div') return 'Fire · 배당금';
    return VIEW_TITLES[v];
  };
  const scrollMem = {};
  function showView(v, target) {
    if (!VIEW_TITLES[v] || !viewAllowed(v)) v = 'home';
    if (state.view !== v) scrollMem[state.view] = window.scrollY;
    if (v === 'fire' && state.view !== 'fire') state.prevView = state.view; // 🔥를 다시 누르면 돌아갈 화면
    state.view = v;
    document.querySelectorAll('.view').forEach((el) => { el.hidden = el.dataset.view !== v; });
    document.querySelectorAll('[data-tab]').forEach((b) => (b.dataset.tab === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    document.getElementById('view-title').textContent = viewTitle(v);
    try { history.replaceState(null, '', '#' + v); } catch {}
    savePref('view', v);
    for (const c of Object.values(charts)) if (c.canvas?.closest('.view')?.dataset.view === v) c.resize();
    fireLoop(v === 'fire' || isOther());
    if (v === 'fire') { applyFireTab(); renderFire(); renderDiv(); if (!state.quote) loadQuote().then(() => { renderFire(); renderDiv(); }).catch(() => renderFire()); loadDividends().catch(() => {}); }
    if (v === 'earn') renderEarnings();
    if (v === 'searn') renderSEarnings();
    if (v === 'sprice') { renderSPriceChart(); renderShort(shortOf(state.stock), 'sshort', STOCK_INFO[state.stock].short); renderHolders(state.stock, 'sholders'); renderAnalyst(); renderInsider(); renderOptions(); }
    if (v === 'crcl') { renderHolders('CRCL', 'holders'); renderAnalyst('CRCL'); renderInsider('CRCL'); renderOptions('CRCL'); }
    if (v === 'news' || v === 'snews') { markNewsSeen(); renderNewsSummary(); renderNews(); renderKwNews(); } else updateNewsBadge();
    updateFireChip();
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
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'watch-q') { watchSearch(ev.target.value); return; }
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
    const sr = ev.target.closest('[data-srange]');
    if (sr) { state.srange = sr.dataset.srange; savePref('jrange', state.srange); renderSPriceChart(); paintStock(); return; }
    if (ev.target.closest('[data-wedit]')) { openWatchSheet(); return; }
    if (ev.target.closest('[data-wclose]')) { closeWatchSheet(); return; }
    const wa = ev.target.closest('[data-wadd]');
    if (wa) { addWatch(wa.dataset.wadd, { name: wa.dataset.wname, exchange: wa.dataset.wex }); return; }
    const wd = ev.target.closest('[data-wdel]');
    if (wd) { removeWatch(wd.dataset.wdel); return; }
    const wm = ev.target.closest('[data-wmove]');
    if (wm) { const [i, d] = wm.dataset.wmove.split(':').map(Number); moveWatch(i, d); return; }
    const kd = ev.target.closest('[data-kwdel]');
    if (kd) { delKw(kd.dataset.kwdel); return; }
    const ctp = ev.target.closest('[data-ctype]');
    if (ctp) { state.chartType = ctp.dataset.ctype; savePref('chartType', state.chartType); renderPriceChart(); if (isOther()) renderSPriceChart(); return; }
    const ctg = ev.target.closest('[data-ctoggle]');
    if (ctg) {
      const k = ctg.dataset.ctoggle === 'ma' ? 'chartMA' : 'chartVol';
      state[k] = !state[k]; savePref(k, state[k] ? '1' : '0');
      renderPriceChart(); if (isOther()) renderSPriceChart();
      return;
    }
    const bk = ev.target.closest('[data-brokers]');
    if (bk) { state.brokerAll = state.brokerAll === bk.dataset.brokers ? null : bk.dataset.brokers; renderAnalyst(bk.dataset.brokers); return; }
    const ht = ev.target.closest('[data-htab]');
    if (ht) { state.holdTab = ht.dataset.htab; savePref('holdTab', state.holdTab); renderHolders(state.stock); return; }
    const fg = ev.target.closest('[data-ftabgo]');
    if (fg) { state.fireTab = fg.dataset.ftabgo; savePref('fireTab', state.fireTab); showView('fire'); window.scrollTo({ top: 0 }); return; }
    const ft = ev.target.closest('[data-ftab]');
    if (ft) { state.fireTab = ft.dataset.ftab; savePref('fireTab', state.fireTab); applyFireTab(); if (state.fireTab === 'div') { renderDiv(); loadDividends().catch(() => {}); } window.scrollTo({ top: 0 }); return; }
    if (ev.target.closest('#d-add')) { divRows = readDivRows(); divRows.push({}); document.getElementById('d-rows').innerHTML = divRows.map(divRowHtml).join(''); return; }
    const drm = ev.target.closest('[data-drm]');
    if (drm) { divRows = readDivRows(); divRows.splice(+drm.dataset.drm, 1); document.getElementById('d-rows').innerHTML = divRows.map(divRowHtml).join(''); return; }
    if (ev.target.closest('#d-del')) { deleteDiv(); return; }
    if (ev.target.closest('#d-import')) { importFireToDiv(); return; }
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
    const lb = ev.target.closest('#lang-btn');
    if (lb) {
      try { localStorage.setItem('cw.lang', EN ? 'ko' : 'en'); } catch {}
      lb.disabled = true; lb.textContent = '…';
      // ?lang=… 이 붙어 있으면 지운 주소로, 아니면 그대로 새로고침(같은 주소로 replace 하면 # 이동만 되고 새로고침이 안 됨)
      if (location.search) location.replace(location.pathname + location.hash); else location.reload();
      return;
    }
    if (ev.target.closest('[data-welcome-close]')) { savePref('welcomed', '1'); renderWelcome(false); }
  });

  // ---------------------------------------------------------------- 방문 집계(익명) · 공유
  // 공유 주소에서만, 페이지를 열 때 한 번: 기기마다 무작위 ID + 유입 경로만 보낸다(관리자 페이지에서만 조회)
  const SITE_URL = 'https://my-fire-portfolio.pages.dev/';
  function countVisit() {
    if (!ON_PAGES || !IS_PROD || readJSON('cw.noCount', false)) return;
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
      fetch(`/api/hit?v=${vid}&n=${isNew}&d=${dev}${ref ? '&r=' + encodeURIComponent(ref.slice(0, 80)) : ''}`, { cache: 'no-store', keepalive: true }).catch(() => {});
      // 주소창에 붙은 ?ref=… 는 지운다(화면 이동은 #으로 하므로 그대로)
      if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    } catch {}
  }
  // 처음 온 방문자에게만 사용법 안내(닫으면 다시 안 보임). 기존 사용자(저장된 화면이 있는 기기)는 건너뛴다
  function renderWelcome(firstVisit) {
    const el = document.getElementById('c-welcome');
    if (!el) return;
    if (!firstVisit || loadPref('welcomed', '')) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="wc-head"><b>처음 오셨나요? 👋</b><button type="button" class="wc-x" data-welcome-close aria-label="안내 닫기">×</button></div>
      <ul class="wc-list">
        <li><b>종목 칩</b>을 누르면 서클·조비·스페이스X·템퍼스 화면이 바뀌어요.</li>
        <li>아래 <b>탭</b>에서 차트(캔들·이동평균)·실적·뉴스(AI 한 줄 요약)를 볼 수 있어요.</li>
        <li><b>+ 추가·편집</b>으로 아무 미국 주식이나 내 종목에 넣을 수 있어요.</li>
        <li>🔥 <b>Fire</b>에 보유 수량·평단을 넣으면 목표 금액까지 몇 %인지 계산해요(이 기기에만 저장).</li>
        <li>카드 제목 옆 <b>ⓘ</b>를 누르면 지표 설명이 나와요.</li>
      </ul>
      <button type="button" class="btn-primary wc-ok" data-welcome-close>알겠어요</button>`;
  }
  async function shareSite() {
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
  renderTabbar();
  renderStockSwitch();
  updateFireChip();
  { let v0 = location.hash.slice(1).split('&')[0] || loadPref('view', 'home'); v0 = OLD_VIEWS[v0] || v0; showView(viewAllowed(v0) ? v0 : 'home'); }
  if (fromSnap) { try { renderAll(); } catch (e) { console.error(e); } } // 지난번 화면을 즉시
  busyBar(true);
  initPrice();
  // 시세를 다른 데이터보다 먼저 받아 종목 카드·주가가 바로 보이게
  loadQuote().then(() => { renderStockSwitch(); if (isOther()) { renderSPriceCard(); renderSKpis(); } updateFireChip(); renderHomeFire(); }).catch(() => {});
  yConnect();
  for (const sym of WATCH) if (STOCK_INFO[sym]?.custom) checkBinance(sym);
  bConnect();
  for (const sym of Object.keys(BN24)) bxSnapshot(sym).then(() => { renderStockSwitch(); if (state.stock === sym) { renderSPriceCard(); renderSKpis(); } }).catch(() => bStartPoll());
  refresh('auto');
  renderWelcome(firstVisit && !MIGRATED);
  if (MIGRATED) setTimeout(() => toast(EN ? '✓ Moved your data from the old address' : '✓ 예전 주소에서 쓰던 보유 정보·관심 종목을 옮겼어요'), 800);
  countVisit();
  setInterval(() => { if (!document.hidden) refresh('light'); }, LIVE_REFRESH_MS);
  setInterval(() => { if (!document.hidden) refresh('auto'); }, DATA_REFRESH_MS);
  setInterval(() => { if (!document.hidden) { renderStatus(); renderMarket(); if (px.mark) setHtml('px-next', fundLeft(px.mark.next)); } }, 30000);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeWatchSheet(); });
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
