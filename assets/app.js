/* Circle Watch — 화면 렌더링
 * data/latest.json(수집기 결과)을 그리고, 일부 값은 1분마다 Circle API·RPC에서 직접 갱신한다. */
(() => {
  'use strict';

  // Cloudflare Pages(공유용 주소)에서는 같은 주소의 /api 중계를 쓰고, GitHub Pages에서는 Worker를 쓴다
  const ON_PAGES = /\.pages\.dev$/.test(location.hostname);
  const DATA_URL = ON_PAGES ? '/api/data' : 'data/latest.json';
  const NEWS_API = ON_PAGES ? '/api' : 'https://circle-watch-news.sungyong828.workers.dev';
  const DATA_FALLBACK = 'https://sungyong828-droid.github.io/circle-watch/data/latest.json'; // /api/data가 막혔을 때만
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
      <p>수치는 조비가 분기 실적 발표 때 주주서한에 공개하는 값이라, 다음 발표 전까지는 그대로예요. 새 실적 발표가 나오면 이 카드 위에 알림이 떠요.</p>`,
    jearnings: `
      <p>조비는 아직 에어택시 상업 운항 전이라 <b>적자가 정상</b>입니다. 그래서 매출·이익보다 <b>현금이 얼마나 남았고, 얼마나 빨리 쓰는지</b>가 더 중요해요.</p>
      <ul>
        <li><b>현금·단기투자</b>: 현금 + 1년 안에 현금화할 수 있는 투자.</li>
        <li><b>분기 현금 소진</b>: 영업활동 현금흐름 + 설비투자. 최근 2분기 평균으로 "몇 년 버틸 수 있는지"를 계산해요(추가 투자 유치가 없다고 가정).</li>
        <li><b>매출</b>: 2025년 3분기부터 인수한 헬기 여객 사업(Blade) 매출이 포함돼요.</li>
        <li><b>EPS</b>: 적자라 음수예요. 예상보다 손실이 적으면 "양호".</li>
      </ul>`,
    fire: `
      <p>보유한 주식의 <b>현재 원화 평가금액 ÷ 목표 금액</b>으로 퇴사(경제적 자유) 목표까지 얼마나 왔는지 보여줍니다.</p>
      <ul>
        <li><b>평가금액</b> = 보유 수량 × 실시간 주가(Nasdaq, 장전·장중·장후 포함) × 실시간 원·달러 환율.</li>
        <li><b>평가손익</b>: 매수 금액(수량 × 평균 단가)과 비교. 평균 매수 환율을 입력하지 않으면 현재 환율로 환산합니다.</li>
        <li><b>목표 달성 가격</b>: 지금 환율이 그대로일 때 목표 금액이 되는 주가.</li>
        <li><b>24시간 추정</b>: 미국 장이 닫힌 주말·야간에도 바이낸스에서 24시간 거래되는 CRCL 가격으로, 다음 장 시작 시 예상 가격을 계산합니다(CRCA는 하루 수익률 2배 가정). 실제 개장가와 다를 수 있습니다.</li>
        <li><b>세후 기준</b>(선택): 해외주식 양도소득세(연 250만원 공제 후 22%)를 뺀 금액으로 계산합니다. 실제 세금은 다른 해외주식 손익·환율에 따라 달라집니다.</li>
      </ul>
      <p>⚠️ CRCA는 CRCL 하루 수익률의 2배를 따라가는 레버리지 ETF라, 오래 보유하면 등락이 반복될 때 CRCL 수익률의 2배와 차이가 나고(변동성 손실), 운용보수가 매일 빠집니다. 투자 조언이 아닌 개인 계산 도구입니다.</p>
      <p>🔒 보유 정보는 이 기기의 브라우저에만 저장됩니다.</p>`,
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

  const dtf = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
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
    Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
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
      ticks: { maxTicksLimit: 4, padding: 6, callback: (v) => fmt(v).replace(/\.0(?=[조억만])/, '') },
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
    }).join('');
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
    '1d': { label: '1일', interval: '15m', limit: 96 },
    '1w': { label: '1주', interval: '1h', limit: 168 },
    '1m': { label: '1개월', interval: '4h', limit: 180 },
    '3m': { label: '3개월', interval: '1d', limit: 90 },
  };
  const px = state.px;
  const price = (v) => (v == null || !isFinite(v) ? '–' : '$' + nf(2).format(v));
  const hm = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
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
    const k = await bnGet(`klines?symbol=${BN.sym}&interval=${r.interval}&limit=${r.limit}`);
    px.klines[range] = k.map((x) => [x[0], +x[4]]); // [시작 시각(ms), 종가]
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
    const sw = document.querySelector('[data-stock="CRCL"] .ss-px');
    if (sw) sw.innerHTML = `${price(t.last)} <em class="${cls(t.pct)}">${pct(t.pct, 1)}</em>`;
    setHtml('pc-last', price(t.last));
    const k = px.klines[state.range];
    if (k?.length) {
      const ch = t.last / k[0][1] - 1;
      setHtml('pc-chg', `<span class="${cls(ch)}">${arrow(ch)} ${pct(ch, 2)}</span> <span class="lbl">${RANGES[state.range].label} 동안</span>`);
    }
    for (const id of ['spark', 'pricechart']) {
      const c = charts[id];
      if (!c) continue;
      const ds = c.data.datasets[0];
      ds.data[ds.data.length - 1] = t.last;
      c.update('none');
    }
  }

  function drawPriceLine(id, k, { compact = false, range = '1d' } = {}) {
    if (!k?.length) return;
    const labels = k.map((p) => p[0]);
    const data = k.map((p) => p[1]);
    if (px.t) data[data.length - 1] = px.t.last;
    const col = data.at(-1) >= data[0] ? C.up : C.down;
    const xf = range === '1d' ? hm : mdLocal;
    const tip = (it) => {
      const d = new Date(labels[it.dataIndex]);
      return RANGES[range].interval === '1d' ? d.toLocaleDateString('ko-KR') : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    };
    draw(id, {
      type: 'line',
      data: { labels, datasets: [lineDs('CRCL', data, col, { fill: 'start', backgroundColor: areaFill(col), pointRadius: endPoint(data.length, compact ? 3 : 4), borderWidth: compact ? 1.6 : 2, tension: 0.2 })] },
      options: {
        interaction,
        plugins: { ...noLegend, tooltip: { ...tooltip(tip, price), enabled: !compact } },
        scales: compact
          ? { x: { display: false }, y: { display: false, grace: '8%' } }
          : { x: axisX(labels, xf, 5), y: { ...axisY(price), grace: '5%' } },
      },
    });
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
        <button type="button" class="link-btn" data-go="crcl:c-pricechart">가격 차트 자세히 보기<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>`,
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
      note = `${RANGES[r].label} 최고 ${price(Math.max(...vals))} · 최저 ${price(Math.min(...vals))} · 시작 ${price(vals[0])} · ${RANGES[r].interval} 봉`;
    }
    card('pricechart', {
      title: 'CRCL 가격 추이',
      sub: 'Binance CRCLUSDT 무기한 선물',
      info: INFO.pricechart,
      body: `
        <div class="seg range" role="group" aria-label="기간 선택">${Object.entries(RANGES).map(([key, v]) => `<button type="button" data-range="${key}" aria-pressed="${key === r}">${v.label}</button>`).join('')}</div>
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
      if (off || k8) add('neu', 'news:c-news', `${fresh8k ? `<b>8-K 공시</b>(${md(isoToTs(k8.d))}) · ` : ''}${off ? `최신 발표: ${esc(off.title.length > 48 ? off.title.slice(0, 47) + '…' : off.title)}` : ''}`, fresh8k ? '신규 8-K 공시' : null, 1);
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
        <ul class="sum-list">${pxLine}${fireLine}${items.map((i) => `<li><button type="button" data-go="${i.go}"><span class="tone ${i.tone}">${toneName[i.tone]}</span><span class="txt">${i.html}</span>${chevron}</button></li>`).join('')}</ul>`,
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
    async series(d) { // USDC·EURC·USYC 일별 공급량 추이
      const start = Date.UTC(2025, 5, 1) / 1000;
      const get = async (id) => (await getJ(`https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${id}`, 25000))
        .map((p) => [Number(p.date), Object.values(p.totalCirculating || {})[0] || 0]).filter(([t]) => t >= start);
      const [usdc, eurc, usyc] = await Promise.all([get(2), get(50), get(237)]);
      if (usdc.length) d.series = { usdc, eurc, usyc };
    },
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
      const add = [], addJ = [];
      for (let ms = Date.parse(S.daily.at(-1).d + 'T00:00:00Z') + 86400000; ms <= Date.now(); ms += 86400000) {
        const wd = new Date(ms).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        const day = fmt(ms);
        const r = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${day.replaceAll('-', '')}.txt`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
        if (!r?.ok) continue;
        const lines = (await r.text()).split('\n');
        const pick = (sym) => { const l = lines.find((x) => x.split('|')[1] === sym); if (!l) return null; const [, , sv, sev, tv] = l.split('|'); return { d: day, short: +sv, exempt: +sev, total: +tv, ratio: +sv / +tv }; };
        const c = pick('CRCL'), jb = pick('JOBY');
        if (c) add.push(c);
        if (jb) addJ.push(jb);
      }
      const cutoff = Date.now() / 1000 - 31 * 86400;
      const merge = (base, extra) => {
        const daily = [...(base?.daily || []), ...extra].filter((r, i, a) => isoToTs(r.d) >= cutoff && a.findIndex((x) => x.d === r.d) === i);
        const sumS = daily.reduce((a, r) => a + r.short, 0), sumT = daily.reduce((a, r) => a + r.total, 0);
        return { ...base, daily, avgRatio: sumT ? sumS / sumT : 0 };
      };
      if (addJ.length && S.joby) S.joby = merge(S.joby, addJ);
      if (!add.length) { d.short = { ...S }; return; }
      d.short = { ...merge(S, add), joby: S.joby };
      L.shortRatio = d.short.daily.at(-1).ratio;
    },
    async quote() { await loadQuote(); }, // Fire·JOBY 시세·환율
    // ---- JOBY (조비를 선택했을 때만 받는다)
    async faa() { state.faa = await getJ(`data/faa-joby.json?t=${Math.floor(Date.now() / 600000)}`); },
    async jchart() {
      await Promise.all([loadJChart('1d'), state.jrange !== '1d' ? loadJChart(state.jrange) : null, state.jchart['1y'] ? null : loadJChart('1y').catch(() => {})]);
    },
    async jearn() {
      try {
        const j = await getJ(`${NEWS_API}/earnings?s=JOBY`, 25000);
        if (j.error) throw new Error(j.error);
        state.jearn = j; state.jearnErr = false;
      } catch (e) { state.jearnErr = true; if (!state.jearn) throw e; }
    },
    async jnews() {
      const j = await getJ(`${NEWS_API}/news?s=JOBY${state.syncKind === 'manual' ? '&fresh=1' : ''}`, 25000);
      if (j.error) throw new Error(j.error);
      const ownerMap = {};
      for (const f of j.filings || []) (ownerMap[f.d + '|' + f.form] ||= []).push(f.owner);
      const cur = state.jnews || {};
      const fallback = (j.filings || []).map((f) => ({ ...f, url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001819848&type=&dateb=&owner=include&count=40' }));
      state.jnews = { ...cur, official: j.official, kr: j.kr, en: j.en, crypto: j.crypto || [], newsAt: j.at, ownerMap, filings: cur.filings || fallback };
    },
    async jfilings() { // SEC EDGAR에서 직접
      const j = await getJ('https://data.sec.gov/submissions/CIK0001819848.json');
      const r = j.filings.recent, list = [];
      for (let i = 0; i < Math.min(100, r.form.length); i++) {
        const acc = r.accessionNumber[i];
        list.push({ d: r.filingDate[i], form: r.form[i], owner: '', desc: r.primaryDocDescription[i], items: r.items?.[i] || '', url: `https://www.sec.gov/Archives/edgar/data/1819848/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}` });
      }
      state.jnews = { ...(state.jnews || {}), filings: list, filingsAt: new Date().toISOString() };
    },
    async earnings() { // 분기 실적·다음 발표일 (서버에서 6시간 캐시)
      try {
        const j = await getJ(`${NEWS_API}/earnings`, 25000);
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
  const SYNC_NAMES = { circle: '서클 유통량', cirbtc: 'cirBTC', stables: '스테이블코인', series: '공급량 추이', dex: 'DEX', tvl: 'TVL', lending: '대출', accounts: '활성 계정', activity: 'Arc 활동', cctp: 'CCTP', rates: '국채 금리', short: '공매도', filings: 'SEC 공시', news: '뉴스', earnings: '실적', quote: '주가·환율', faa: 'FAA 인증', jchart: '조비 차트', jearn: '조비 실적', jnews: '조비 뉴스', jfilings: '조비 공시' };

  // parts: 동기화할 항목 이름 목록
  async function syncNow(parts) {
    const d = state.data;
    if (!d) return { ok: 0, fail: [] };
    const L = {};
    const res = await Promise.allSettled(parts.map((p) => SYNC[p](d, L)));
    const fail = parts.filter((p, i) => res[i].status === 'rejected');
    const t = new Date().toISOString();
    for (const [k, v] of Object.entries(L)) if (v != null && isFinite(v)) state.live[k] = { v, t };
    if (parts.length > 2) { state.syncedAt = t; state.syncFail = fail; pushLocalSnap(); }
    return { ok: parts.length - fail.length, fail };
  }

  // ---------------------------------------------------------------- Fire (퇴사 목표 진행률 · 포트폴리오 전체)
  // 보유 정보는 이 기기(브라우저)에만 저장한다. 코드·서버·링크에는 개인 보유 현황이 들어가지 않는다.
  const FIRE_KEY = 'cw.fire', FIRE_HIST = 'cw.fireHist';
  const FIRE_TICKERS = { CRCA: 'CRCA · ProShares Ultra CRCL (2배)', CRCL: 'CRCL · 서클 인터넷 그룹', JOBY: 'JOBY · 조비 에비에이션' };
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
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
  function updateFireChip(c = fireCfg ? fireCalc() : null) {
    const el = document.getElementById('fire-chip');
    if (!el) return;
    el.innerHTML = `<span aria-hidden="true">🔥</span><b>${c ? (Math.max(0, c.progress) * 100).toFixed(1) + '%' : 'Fire'}</b>`;
    el.setAttribute('aria-label', c ? `퇴사까지 ${(Math.max(0, c.progress) * 100).toFixed(1)}% · Fire 열기` : 'Fire 열기');
    el.setAttribute('aria-current', state.view === 'fire' ? 'page' : 'false');
  }

  function fireRowHtml(p, i) {
    return `<div class="f-row" data-row="${i}">
      <select class="f-ticker" aria-label="종목">${Object.entries(FIRE_TICKERS).map(([k, l]) => `<option value="${k}" ${p.ticker === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
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
    const el = document.getElementById('c-fire');
    if (!el) return;
    const c = fireCalc();
    if (!fireCfg) {
      card('fire', { title: '퇴사까지', sub: '내 보유 주식으로 목표 금액까지 진행률', info: INFO.fire, body: `<p class="fire-empty">아래에 보유 종목·수량·평균 단가를 입력하면 실시간 시세와 환율로 <b>퇴사까지 몇 %</b>인지 계산해요. 여러 종목(CRCA·CRCL·JOBY)을 함께 넣을 수 있어요.</p>` });
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
      return `<div class="fire-pos"><b>${r.ticker}</b><span>${nf(0).format(r.shares)}주 · $${r.px.toFixed(2)} <span class="${cls(r.q?.pct)}">${pct(r.q?.pct, 2)}</span> · ${esc(mktStatus(r.q?.status))}</span><span>${wonFull(r.valueUsd * c.fx)} <span class="${cls(g)}">${pct(g)}</span></span></div>`;
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

  // 시세(CRCA·CRCL·JOBY·ACHR·환율): Fire·JOBY 화면을 보고 있을 때 15초마다
  async function loadQuote() {
    try {
      const j = await getJ(`${NEWS_API}/quote`, 15000);
      if (j.error) throw new Error(j.error);
      state.quote = j;
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
      loadQuote().then(() => { renderFire(); renderSummary(); renderStockSwitch(); if (state.stock === 'JOBY') { paintJoby(); renderJSummary(); } }).catch(() => {});
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
    if (!state.quote) loadQuote().then(() => { renderFire(); renderSummary(); }).catch(() => renderFire());
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
  const krDate = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
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
  // 종목별 뉴스 화면 설정. 필터는 겹칠 수 있다(예: 서클 관련이면서 국내 기사).
  const NEWS_UI = {
    CRCL: {
      name: '서클', view: 'news', list: 'c-news', sum: 'c-newssum', badge: 'news-badge', seenKey: 'newsSeen', filterKey: 'newsFilter',
      relRe: /서클|써클|Circle|CRCL/i, getN: () => state.data?.news,
      filters: [['all', '전체'], ['filing', '공시'], ['related', '서클 관련'], ['kr', '국내 뉴스'], ['en', '해외 뉴스'], ['industry', '암호화폐']],
      badges: { related: '서클', kr: '국내', en: '해외', industry: '코인' },
    },
    JOBY: {
      name: '조비', view: 'jnews', list: 'c-jnews', sum: 'c-jnewssum', badge: 'news-badge', seenKey: 'jnewsSeen', filterKey: 'jnewsFilter',
      relRe: /조비|Joby|JOBY/i, getN: () => state.jnews,
      filters: [['all', '전체'], ['filing', '공시'], ['related', '조비 관련'], ['faa', 'FAA 인증'], ['kr', '국내 뉴스'], ['en', '해외 뉴스'], ['industry', 'UAM 업계']],
      badges: { related: '조비', kr: '국내', en: '해외', industry: 'UAM' },
    },
  };
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
      items.push({ kind, base, lang, t: Date.parse(n.t), title: n.title, source: n.source + (base === 'industry' && lang !== 'ko' ? ' · 해외' : ''), url: n.url, level: base === 'official' ? 'hi' : 'mid', official: base === 'official', faa: FAA_RE.test(n.title) });
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
    if (diff === 0) return '오늘';
    if (diff === 1) return '어제';
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
  };
  const timeLabel = (it) => {
    if (it.dateOnly) return '';
    const m = Math.round((Date.now() - it.t) / 60000);
    if (m < 60) return `${Math.max(1, m)}분 전`;
    if (m < 24 * 60) return `${Math.floor(m / 60)}시간 전`;
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
    const upd = (t) => (t ? `${ago(t)} 업데이트` : `${ago(state.data?.updatedAt)} 업데이트`);
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
        <span class="nm">${esc(i.source)}${timeLabel(i) ? ' · ' + timeLabel(i) : ''}</span></a></li>`;
    }).join('');
    el.innerHTML = `
      <div class="nf" role="group" aria-label="뉴스 종류">${U.filters.map(([k, label]) => `<button type="button" data-nf="${k}" aria-pressed="${k === f}">${label}<small>${counts[k]}</small></button>`).join('')}</div>
      ${f === 'filing' ? `<label class="nf-opt"><input type="checkbox" id="major-only" ${state.majorOnly ? 'checked' : ''}> 주요 공시만 보기 <small>(임원 지분변동 Form 4·매도예정 144 숨김)</small></label>` : ''}
      <ul class="nl">${rows || '<li class="empty">표시할 항목이 없습니다.</li>'}</ul>
      <p class="note">제목을 누르면 원문이 새 창으로 열립니다. 공시는 SEC EDGAR, 뉴스는 구글 뉴스·전문 매체 RSS에서 새로고침 때마다 받습니다.</p>`;
  }

  // ---------------------------------------------------------------- 종목 선택 · 하단 탭 (Yong's Portfolio)
  const STOCK_INFO = {
    CRCL: { name: '서클 인터넷 그룹', short: '서클' },
    JOBY: { name: '조비 에비에이션', short: '조비' },
  };
  const ICONS = {
    home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M4 19h16M6 15l4-5 3 3 5-7"/>',
    earn: '<path d="M5 20V10M10 20V5M15 20v-8M20 20V8"/>',
    usdc: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.3c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.5 5.8 4.4 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-2.9-1.7M12 6v1.7m0 8.6V18"/>',
    arc: '<path d="M4 19a8 8 0 0 1 16 0M8 19a4 4 0 0 1 8 0"/>',
    news: '<path d="M5 5h11v14H6a1 1 0 0 1-1-1zM16 9h3v9a1 1 0 0 1-1 1h-2M8 9h5M8 12h5M8 15h3"/>',
  };
  const TAB_SETS = {
    CRCL: [['home', 'Home', 'home'], ['crcl', 'CRCL', 'chart'], ['earn', 'Earnings', 'earn'], ['usdc', 'USDC', 'usdc'], ['arc', 'Arc', 'arc'], ['news', 'News', 'news']],
    JOBY: [['home', 'Home', 'home'], ['jprice', 'JOBY', 'chart'], ['jearn', 'Earnings', 'earn'], ['jnews', 'News', 'news']],
  };
  state.stock = STOCK_INFO[loadPref('stock', 'CRCL')] ? loadPref('stock', 'CRCL') : 'CRCL';
  state.jchart = {};
  state.jrange = loadPref('jrange', '1d');

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

  function stockPx(sym) {
    if (sym === 'CRCL' && px.t) return { price: px.t.last, pct: px.t.pct, live: true };
    const q = state.quote?.[sym];
    return q ? { price: q.price, pct: q.pct, live: false } : null;
  }
  function renderStockSwitch() {
    const el = document.getElementById('stock-switch');
    if (!el) return;
    el.innerHTML = Object.entries(STOCK_INFO).map(([sym, s]) => {
      const p = stockPx(sym);
      return `<button type="button" role="tab" data-stock="${sym}" aria-selected="${sym === state.stock}">
        <span class="ss-tk">${sym}</span><span class="ss-nm">${s.name}</span>
        <span class="ss-px">${p?.price != null ? price(p.price) : '–'} <em class="${cls(p?.pct)}">${p?.pct != null ? pct(p.pct, 1) : ''}</em></span></button>`;
    }).join('');
  }
  function setStock(sym) {
    if (!STOCK_INFO[sym] || sym === state.stock) return;
    state.stock = sym;
    savePref('stock', sym);
    document.getElementById('home-crcl').hidden = sym !== 'CRCL';
    document.getElementById('home-joby').hidden = sym !== 'JOBY';
    renderTabbar();
    renderStockSwitch();
    if (!viewAllowed(state.view)) showView('home');
    if (sym === 'JOBY') {
      fireLoop(true);
      renderJoby();
      if (!state.jearn || !state.jnews) syncNow(['quote', 'faa', 'jchart', 'jearn', 'jnews', 'jfilings']).then(renderJoby).catch(() => {});
    } else if (state.view !== 'fire') fireLoop(false);
  }

  // ---------------------------------------------------------------- JOBY: 시세 · 차트
  const JRANGES = { '1d': '1일', '1w': '1주', '1m': '1개월', '3m': '3개월', '1y': '1년' };
  async function loadJChart(r) {
    const j = await getJ(`${NEWS_API}/chart?s=JOBY&r=${r}`, 15000);
    if (j.error) throw new Error(j.error);
    state.jchart[r] = j;
  }
  let jPrevLast = null;
  function paintJoby() {
    const q = state.quote?.JOBY;
    if (!q) return;
    const last = document.getElementById('jpx-last');
    if (last) {
      last.textContent = price(q.price);
      if (jPrevLast != null && q.price !== jPrevLast && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        last.classList.remove('flash-up', 'flash-down'); void last.offsetWidth; last.classList.add(q.price > jPrevLast ? 'flash-up' : 'flash-down');
      }
    }
    jPrevLast = q.price;
    setHtml('jpx-chg', `<span class="${cls(q.pct)}">${arrow(q.pct)} ${q.change >= 0 ? '+' : '-'}$${Math.abs(q.change ?? 0).toFixed(2)} (${pct(q.pct, 2)})</span>`);
    setHtml('jpx-via', `<span class="live-dot"></span>${esc(mktStatus(q.status))} · 15초마다 갱신`);
    setHtml('jpx-time', esc(String(q.time || '').replace(/^.*?(\d{1,2}:\d{2} [AP]M ET)$/, '$1')));
    setHtml('jpc-last', price(q.price));
    const a = state.quote?.ACHR;
    if (a) setHtml('jpx-achr', `$${a.price?.toFixed(2)} <span class="${cls(a.pct)}">${pct(a.pct, 1)}</span>`);
    for (const id of ['jspark', 'jpricechart']) {
      const c = charts[id];
      if (!c) continue;
      const ds = c.data.datasets[0];
      if (state.jrange === '1d' || id === 'jspark') { ds.data[ds.data.length - 1] = q.price; c.update('none'); }
    }
  }
  function jLine(id, pts, { compact = false, range = '1d', prevClose = null } = {}) {
    if (!pts?.length) return;
    const labels = pts.map((p) => p[0]);
    const data = pts.map((p) => p[1]);
    const q = state.quote?.JOBY;
    if (q?.price && range === '1d') data[data.length - 1] = q.price;
    const base = range === '1d' && (q?.prevClose || prevClose) ? (q?.prevClose || prevClose) : data[0];
    const col = data.at(-1) >= base ? C.up : C.down;
    const xf = range === '1d' ? hm : mdLocal;
    const tip = (it) => { const d = new Date(labels[it.dataIndex]); return range === '1d' || range === '1w' ? d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString('ko-KR'); };
    draw(id, {
      type: 'line',
      data: { labels, datasets: [lineDs('JOBY', data, col, { fill: 'start', backgroundColor: areaFill(col), pointRadius: endPoint(data.length, compact ? 3 : 4), borderWidth: compact ? 1.6 : 2, tension: 0.2 })] },
      options: {
        interaction,
        plugins: { ...noLegend, tooltip: { ...tooltip(tip, price), enabled: !compact } },
        scales: compact ? { x: { display: false }, y: { display: false, grace: '8%' } } : { x: axisX(labels, xf, 5), y: { ...axisY(price), grace: '5%' } },
      },
    });
  }

  function renderJPriceCard() {
    const q = state.quote?.JOBY, ch = state.jchart['1d'];
    const pts = ch?.points || [];
    const lo = pts.length ? Math.min(...pts.map((p) => p[1])) : null, hi = pts.length ? Math.max(...pts.map((p) => p[1])) : null;
    const pos = q?.price != null && hi > lo ? (q.price - lo) / (hi - lo) : 0.5;
    const y1 = state.jchart['1y'] || state.jchart['1d'];
    card('jprice', {
      title: 'JOBY 실시간 주가', sub: '조비 에비에이션 · Nasdaq 실시간(장전·장중·장후)', info: INFO.jprice,
      body: `
        <div class="px-main"><span class="px-last" id="jpx-last">${price(q?.price)}</span><span class="px-chg" id="jpx-chg"></span></div>
        <div class="px-meta"><span id="jpx-via">불러오는 중…</span><span id="jpx-time"></span></div>
        <div class="chart spark"><canvas id="cv-jspark" role="img" aria-label="JOBY 오늘 가격"></canvas></div>
        <div class="px-range" aria-label="오늘 가격 범위"><span>${price(lo)}</span><div class="rb"><i style="left:${Math.min(100, Math.max(0, pos * 100))}%"></i></div><span>${price(hi)}</span></div>
        <div class="px-stats">
          <div><span>52주 최고</span><b>${price(y1?.high52)}</b></div>
          <div><span>52주 최저</span><b>${price(y1?.low52)}</b></div>
          <div><span>경쟁사 Archer</span><b id="jpx-achr">–</b><small>ACHR</small></div>
        </div>
        <button type="button" class="link-btn" data-go="jprice:c-jpricechart">가격 차트 자세히 보기<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>`,
    });
    jLine('jspark', pts, { compact: true, prevClose: ch?.prevClose });
    paintJoby();
  }

  function renderJPriceChart() {
    const r = state.jrange, ch = state.jchart[r];
    const pts = ch?.points || [];
    let note = '';
    if (pts.length) {
      const v = pts.map((p) => p[1]);
      note = `${JRANGES[r]} 최고 ${price(Math.max(...v))} · 최저 ${price(Math.min(...v))} · 시작 ${price(v[0])}${ch.high52 ? ` · 52주 ${price(ch.low52)}~${price(ch.high52)}` : ''}`;
    }
    const q = state.quote?.JOBY;
    const chg = pts.length && q?.price ? q.price / (r === '1d' && (q.prevClose || ch.prevClose) ? (q.prevClose || ch.prevClose) : pts[0][1]) - 1 : null;
    card('jpricechart', {
      title: 'JOBY 가격 추이', sub: '조비 에비에이션 · Yahoo Finance', info: '',
      body: `
        <div class="seg range jr" role="group" aria-label="기간 선택">${Object.entries(JRANGES).map(([k, v]) => `<button type="button" data-jrange="${k}" aria-pressed="${k === r}">${v}</button>`).join('')}</div>
        <div class="px-main sm"><span class="px-last" id="jpc-last">${price(q?.price)}</span><span class="px-chg">${chg == null ? '' : `<span class="${cls(chg)}">${arrow(chg)} ${pct(chg, 2)}</span> <span class="lbl">${JRANGES[r]} 동안</span>`}</span></div>
        <div class="chart tall"><canvas id="cv-jpricechart" role="img" aria-label="JOBY 가격 추이"></canvas></div>
        <p class="note">${note || '불러오는 중…'}</p>`,
    });
    if (!ch) { loadJChart(r).then(() => { if (state.jrange === r) renderJPriceChart(); }).catch(() => {}); return; }
    jLine('jpricechart', pts, { range: r, prevClose: ch.prevClose });
  }

  // ---------------------------------------------------------------- JOBY: FAA 형식 인증 현황
  function faaUpdateNotice() {
    const F = state.faa, fl = state.jnews?.filings || [];
    if (!F) return '';
    const er = fl.find((f) => /^8-K/.test(f.form) && /2\.02/.test(f.items || ''));
    if (er && Date.parse(er.d) > Date.parse(F.source.date) + 3 * 86400000) {
      return `<a class="faa-notice" href="${safeUrl(er.url)}" target="_blank" rel="noopener">🔔 ${md(isoToTs(er.d))}에 새 실적 발표가 나왔어요. 아래 인증 수치는 이전 주주서한(${esc(F.asOf)}) 기준이라 갱신이 필요해요 →</a>`;
    }
    return '';
  }
  function renderFaa() {
    const F = state.faa;
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
        ${faaNews.length ? `<div class="mini-h er-h">최근 FAA·인증 관련 소식</div><ul class="nl faa-nl">${faaNews.map((i) => `<li><a href="${safeUrl(i.url)}" target="_blank" rel="noopener"><span class="nk related">${i.official ? '공식' : '뉴스'}</span><span class="nt">${esc(i.title)}</span><span class="nm">${esc(i.source)} · ${dayLabel(i.t)}</span></a></li>`).join('')}</ul>` : ''}
        <p class="note"><a href="${safeUrl(F.source.url)}" target="_blank" rel="noopener">출처: ${esc(F.source.label)}</a> · ${esc(F.caveat || '')}</p>`,
    });
  }

  // ---------------------------------------------------------------- JOBY: 실적 (적자 성장 기업 — 현금·소진 속도가 핵심)
  function jRunway(E = state.jearn) {
    const Q = (E?.quarters || []).filter((q) => q.liquidity != null);
    const last = Q.at(-1);
    const burns = (E?.quarters || []).filter((q) => q.burn != null).slice(-2).map((q) => -q.burn);
    const burn = burns.length ? burns.reduce((a, b) => a + b, 0) / burns.length : null;
    return last && burn > 0 ? { liq: last.liquidity, end: last.end, burn, quarters: last.liquidity / burn } : null;
  }
  function renderJEarnings() {
    const E = state.jearn;
    if (!E) { card('jearnings', { title: '조비 실적', info: INFO.jearnings, body: `<p class="skeleton">${state.jearnErr ? '실적을 불러오지 못했습니다. 새로고침으로 다시 시도하세요.' : '실적 불러오는 중…'}</p>` }); return; }
    const Q = E.quarters || [];
    const last = Q.at(-1), prev = Q.at(-2);
    const N = E.next;
    const dd = N?.date ? dday(N.date) : null;
    const sur = (E.surprises || []).find((s) => s.end === last?.end);
    const rw = jRunway();
    const usdS2 = (v) => (v == null ? '–' : (v < 0 ? '-' : '') + usd(Math.abs(v)));
    const sp = (v) => (v == null ? '–' : `<span class="${cls(v)}">${pct(v)}</span>`);
    const nextHtml = N?.date ? `
      <div class="er-next">
        <div class="er-next-h"><span>다음 실적 발표</span>${N.estimated ? '<span class="tone neu">예상일</span>' : '<span class="tone pos">확정</span>'}</div>
        <div class="er-next-d"><b>${krDate(N.date)}</b><span class="er-dday">${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '발표 완료'}</span></div>
        <div class="er-next-m">${N.quarter ? qLabelLong(N.quarter) + ' 실적 · ' : ''}예상 EPS <b>${N.consensus != null ? '$' + N.consensus.toFixed(2) : '–'}</b>${N.low != null ? ` (범위 $${N.low.toFixed(2)}~$${N.high.toFixed(2)}${N.analysts ? `, ${N.analysts}명` : ''})` : ''}${N.lastYearEps != null ? ` · 작년 같은 분기 $${N.lastYearEps.toFixed(2)}` : ''}</div>
        <p class="note">실적 발표 때 주주서한에 <b>FAA 인증 단계별 진행률</b>도 함께 공개돼요.</p>
      </div>` : '';
    card('jearnings', {
      title: '조비 실적', sub: last ? `최근 발표 ${last.reportedOn ? md(isoToTs(last.reportedOn)) : ''} · ${qLabelLong(last.end)} · SEC·Nasdaq` : 'SEC·Nasdaq', info: INFO.jearnings,
      body: `${nextHtml}
        ${last ? `<div class="ns-grid er-grid">
          <div><span>현금·단기투자</span><b>${usdS2(last.liquidity)}</b><small>${rw ? `최근 2분기 평균 소진 ${usd(rw.burn)} → 약 <b>${(rw.quarters / 4).toFixed(1)}년</b> 버틸 수 있음` : '–'}</small></div>
          <div><span>분기 현금 소진</span><b class="down">${usdS2(last.burn)}</b><small>영업현금흐름 + 설비투자 · 전분기 ${usdS2(prev?.burn)}</small></div>
          <div><span>매출</span><b>${usdS2(last.revenue)}</b><small>전분기 ${sp(last.revenue != null && prev?.revenue ? last.revenue / prev.revenue - 1 : null)} · 헬기 여객(Blade) 포함</small></div>
          <div><span>순손실</span><b class="down">${usdS2(last.netIncome)}</b><small>영업손실 ${usdS2(last.opIncome)}</small></div>
          <div><span>EPS(주당순이익)</span><b>${last.eps != null ? '$' + last.eps.toFixed(2) : '–'}</b><small>${sur ? `예상 $${sur.consensus.toFixed(2)} · ${sur.surprise >= 0 ? '예상보다 양호' : '예상보다 부진'} ${sp(sur.eps >= 0 ? sur.surprise : -sur.surprise)}` : '예상치 없음'}</small></div>
          <div><span>연구개발비</span><b>${usdS2(last.rnd)}</b><small>인증·생산 준비 비용 · 판관비 ${usdS2(last.sga)}</small></div>
        </div>` : ''}
        <div class="mini-h er-h">현금·단기투자 잔고</div>
        <div class="chart short"><canvas id="cv-jer-cash" role="img" aria-label="분기별 현금 잔고"></canvas></div>
        <div class="pair er-pair">
          <div><div class="mini-h er-h">분기 순손실</div><div class="chart"><canvas id="cv-jer-ni" role="img" aria-label="분기별 순손실"></canvas></div></div>
          <div><div class="mini-h er-h">분기 매출</div><div class="chart"><canvas id="cv-jer-rev" role="img" aria-label="분기별 매출"></canvas></div></div>
        </div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>분기</th><th>매출</th><th>순손실</th><th>현금 소진</th><th>EPS</th></tr></thead>
          <tbody>${Q.slice().reverse().map((q, i) => `<tr${i === 0 ? ' class="today"' : ''}><td>${qLabel(q.end)}</td><td>${usdS2(q.revenue)}</td><td class="${q.netIncome < 0 ? 'down' : ''}">${usdS2(q.netIncome)}</td><td>${usdS2(q.burn)}</td><td>${q.eps != null ? '$' + q.eps.toFixed(2) : '–'}${q.consensus != null ? `<span class="dim" style="display:block;font-size:10.5px">예상 ${q.consensus.toFixed(2)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="note">조비는 아직 상업 운항 전이라 적자가 정상이에요. <b>현금이 몇 년 버틸 수 있는지</b>와 <b>FAA 인증 속도</b>가 핵심 지표예요. 2025년 3분기부터 매출에 헬기 여객 사업(Blade) 인수분이 포함돼요.</p>`,
    });
    const labels = Q.map((q) => qLabel(q.end));
    const tipQ = (it) => qLabelLong(Q[it.dataIndex].end);
    const CQ = Q.filter((q) => q.liquidity != null);
    draw('jer-cash', {
      type: 'bar',
      data: { labels: CQ.map((q) => qLabel(q.end)), datasets: [{ label: '현금·단기투자', data: CQ.map((q) => q.liquidity), backgroundColor: C.teal, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 30 }] },
      options: { interaction, plugins: { ...noLegend, tooltip: tooltip((it) => qLabelLong(CQ[it.dataIndex].end), usd) }, scales: { x: axisX(CQ.map((q) => qLabel(q.end)), (v) => v, 8), y: axisY(usd, { beginAtZero: true }) } },
    });
    draw('jer-ni', {
      type: 'bar',
      data: { labels, datasets: [{ label: '순손익', data: Q.map((q) => q.netIncome), backgroundColor: Q.map((q) => (q.netIncome < 0 ? C.orange : C.teal)), borderRadius: 3, borderSkipped: false, maxBarThickness: 18 }] },
      options: { interaction, plugins: { ...noLegend, tooltip: tooltip(tipQ, usdS2) }, scales: { x: axisX(labels, (v) => v, 4), y: axisY((v) => usdS2(v)) } },
    });
    draw('jer-rev', {
      type: 'bar',
      data: { labels, datasets: [{ label: '매출', data: Q.map((q) => q.revenue), backgroundColor: C.blue, borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: 'bottom', maxBarThickness: 18 }] },
      options: { interaction, plugins: { ...noLegend, tooltip: tooltip(tipQ, usdS2) }, scales: { x: axisX(labels, (v) => v, 4), y: axisY(usd, { beginAtZero: true }) } },
    });
  }

  // ---------------------------------------------------------------- JOBY: Home 핵심 지표 · 요약
  function renderJKpis() {
    const el = document.getElementById('jkpis');
    if (!el) return;
    const F = state.faa, s5 = F?.stages?.find((s) => s.n === 5), s4 = F?.stages?.find((s) => s.n === 4);
    const S = state.data?.short?.joby, sd = S?.daily || [];
    const a = sd.at(-1), b = sd.at(-2);
    const si = S?.interest?.at(-1);
    const rw = jRunway();
    const E = state.jearn, last = E?.quarters?.at(-1), N = E?.next;
    const q = state.quote?.JOBY, ar = state.quote?.ACHR;
    const tile = (k, v, d, go) => `<button type="button" class="kpi" data-go="${go}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></button>`;
    el.innerHTML = [
      tile('FAA 5단계(최종)', s5 ? `${s5.joby}%` : '–', s5 ? `<span class="flat">FAA 측 ${s5.faa}% · ${esc(F.asOf.slice(5).replace('-', '/'))} 기준</span>` : '', 'jearn:c-faa'),
      tile('FAA 4단계(시험·분석)', s4 ? `${s4.joby}%` : '–', s4 ? `<span class="flat">FAA 측 ${s4.faa}%</span>` : '', 'jearn:c-faa'),
      tile('현금·단기투자', last?.liquidity != null ? usd(last.liquidity) : '–', rw ? `<span class="flat">약 ${(rw.quarters / 4).toFixed(1)}년치</span>` : '', 'jearn:c-jearnings'),
      tile('분기 현금 소진', last?.burn != null ? usd(-last.burn) : '–', `<span class="flat">${last ? qLabel(last.end) : ''}</span>`, 'jearn:c-jearnings'),
      tile('조비 공매도 비율', a ? pctPlain(a.ratio) : '–', a && b ? `<span class="${cls(a.ratio - b.ratio)}">${arrow(a.ratio - b.ratio)} ${pp(a.ratio - b.ratio, 1)}</span>` : '', 'jprice:c-jshort'),
      tile('공매도 잔고', si ? unit(si.qty) + '주' : '–', si ? `<span class="flat">커버 ${si.dtc.toFixed(1)}일 · ${si.chg > 0 ? '+' : ''}${si.chg.toFixed(1)}%</span>` : '', 'jprice:c-jshort'),
      tile('다음 실적 발표', N?.date ? `D-${Math.max(0, dday(N.date))}` : '–', N?.date ? `<span class="flat">${md(isoToTs(N.date))}${N.estimated ? ' (예상)' : ''}</span>` : '', 'jearn:c-jearnings'),
      tile('경쟁사 Archer', ar?.price != null ? price(ar.price) : '–', ar ? `<span class="${cls(ar.pct)}">${arrow(ar.pct)} ${pct(ar.pct, 1)}</span> <span class="flat">vs JOBY ${q ? pct(q.pct, 1) : '–'}</span>` : '', 'jprice:c-jpricechart'),
    ].join('');
  }

  function renderJSummary() {
    if (!document.getElementById('c-jsummary')) return;
    const items = [];
    const add = (tone, go, html, tag, weight = 1) => items.push({ tone, go, html, tag, weight });
    const F = state.faa, s5 = F?.stages?.find((s) => s.n === 5);
    if (s5) {
      const h = F.history || [], dj = h.length > 1 ? h.at(-1).s5[0] - h.at(-2).s5[0] : null;
      add(dj > 0 ? 'pos' : 'neu', 'jearn:c-faa', `FAA 인증 <b>5단계(최종)</b> Joby ${s5.joby}% · FAA ${s5.faa}%${dj != null ? ` · 직전 서한 대비 +${dj}%p` : ''} · 다음: ${esc(F.next || '')}`, dj > 0 ? 'FAA 인증 진전' : null, 3);
    }
    const rw = jRunway();
    if (rw) {
      const yrs = rw.quarters / 4;
      const t = yrs >= 2 ? 'pos' : yrs < 1 ? 'neg' : 'neu';
      add(t, 'jearn:c-jearnings', `현금·단기투자 <b>${usd(rw.liq)}</b> · 최근 2분기 평균 소진 ${usd(rw.burn)} → 약 ${yrs.toFixed(1)}년치`, t === 'pos' ? '현금 여유' : t === 'neg' ? '현금 부족 우려' : null, 2);
    }
    const S = state.data?.short?.joby;
    if (S?.daily?.length) {
      const last = S.daily.at(-1), diff = last.ratio - S.avgRatio;
      const t = diff > 0.05 ? 'neg' : diff < -0.05 ? 'pos' : 'neu';
      const si = S.interest?.at(-1);
      add(t, 'jprice:c-jshort', `공매도 비율 <b>${pctPlain(last.ratio)}</b>(${md(isoToTs(last.d))}) · 1개월 평균 ${pctPlain(S.avgRatio)}보다 ${Math.abs(diff * 100).toFixed(1)}%p ${diff >= 0 ? '높음' : '낮음'}${si ? ` · 잔고 ${si.chg > 0 ? '+' : ''}${si.chg.toFixed(1)}%` : ''}`, t === 'neg' ? '공매도 비중↑' : t === 'pos' ? '공매도 비중↓' : null, 2);
    }
    const N = state.jnews;
    if (N) {
      const off = N.official?.[0];
      const k8 = N.filings?.find((f) => /^8-K/.test(f.form));
      const fresh8k = k8 && Date.now() - Date.parse(k8.d) < 3 * 86400000;
      if (off) add('neu', 'jnews:c-jnews', `${fresh8k ? `<b>8-K 공시</b>(${md(isoToTs(k8.d))}) · ` : ''}최신 발표: ${esc(off.title.length > 48 ? off.title.slice(0, 47) + '…' : off.title)}`, fresh8k ? '신규 8-K 공시' : null, 1);
    }
    const E = state.jearn?.next;
    if (E?.date) add('neu', 'jearn:c-jearnings', `다음 실적 발표 <b>${krDate(E.date)}</b>${E.estimated ? '(예상)' : ''} · D-${Math.max(0, dday(E.date))} · 예상 EPS ${E.consensus != null ? '$' + E.consensus.toFixed(2) : '–'}`, null, 0);
    const q = state.quote?.JOBY;
    const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    const pxLine = `<li><button type="button" data-go="jprice:c-jpricechart"><span class="tone px"><span class="live-dot"></span>주가</span>
      <span class="txt">JOBY <b>${price(q?.price)}</b> · 오늘 ${q ? `<span class="${cls(q.pct)}">${pct(q.pct, 1)}</span>` : '–'} · ${esc(mktStatus(q?.status))}</span>${chevron}</button></li>`;
    const tags = items.filter((i) => i.tag).sort((a, b) => b.weight - a.weight).slice(0, 3);
    const nPos = items.filter((i) => i.tone === 'pos').length, nNeg = items.filter((i) => i.tone === 'neg').length;
    const toneName = { pos: '긍정', neg: '주의', neu: '중립' };
    card('jsummary', {
      title: '현재 상황 요약', sub: '조비 에비에이션 · 규칙 기반 자동 요약', info: INFO.summary,
      body: `
        <p class="sum-line">${tags.length ? tags.map((t) => `<span class="${t.tone}">${t.tag}</span>`).join('<i>·</i>') : '뚜렷한 변화 없이 보합'}</p>
        <div class="sum-count"><span class="tone pos">긍정 ${nPos}</span><span class="tone neg">주의 ${nNeg}</span><span class="tone neu">중립 ${items.length - nPos - nNeg}</span></div>
        <ul class="sum-list">${pxLine}${items.map((i) => `<li><button type="button" data-go="${i.go}"><span class="tone ${i.tone}">${toneName[i.tone]}</span><span class="txt">${i.html}</span>${chevron}</button></li>`).join('')}</ul>`,
    });
  }

  function renderJoby() {
    if (state.stock !== 'JOBY') return;
    const jobs = [renderStockSwitch, renderJPriceCard, renderJKpis, renderJSummary, renderJPriceChart,
      () => renderShort(state.data?.short?.joby, 'jshort', '조비'), renderFaa, renderJEarnings,
      () => renderNewsSummary('JOBY'), () => renderNews('JOBY'), updateNewsBadge];
    for (const j of jobs) { try { j(); } catch (e) { console.error(e); } }
  }

  // ---------------------------------------------------------------- 상태 표시
  function ago(t) {
    const ms = typeof t === 'number' ? t : Date.parse(t);
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 ${m % 60}분 전`;
  }
  function renderStatus() {
    const d = state.data;
    if (!d) return;
    if (manualRunning) return; // 새로고침 중에는 '업데이트 중…' 유지
    const fails = state.syncFail || [];
    document.getElementById('status').innerHTML = state.syncedAt
      ? `<span class="live-dot"></span>${ago(state.syncedAt)} 업데이트` + (fails.length ? ` · <span class="warn">일부 항목 실패</span>` : '')
      : '불러오는 중…';
  }

  function renderAll() {
    if (!state.data) return;
    const jobs = [renderStatus, renderSummary, renderKpis, renderShort, renderStables,
      () => seriesCard('usdc', { title: 'USDC 전체 유통량', sub: '추이 DefiLlama 일별 · 현재 값 서클 공식', key: 'usdcTotal', fmt: usd, series: state.data.series?.usdc, color: C.blue, info: INFO.usdc }),
      () => seriesCard('eurc', { title: 'EURC 전체 유통량', sub: '유로 스테이블코인 · 추이 DefiLlama 일별 · 현재 값 서클 공식', key: 'eurcTotal', fmt: eur, series: state.data.series?.eurc, color: C.purple, info: INFO.eurc }),
      renderUsdcFlow, renderReserve, renderProducts, renderChains, renderTvl, renderDex, renderArcActivity, renderBorrow, renderArcSupply, renderLending, renderCirbtc, renderAccounts, renderCctp, renderEarnings, () => renderNewsSummary('CRCL'), () => renderNews('CRCL'), updateNewsBadge, renderFire, renderStockSwitch, renderJoby];
    for (const j of jobs) {
      try { j(); } catch (e) { console.error(e); }
    }
  }

  // ---------------------------------------------------------------- 데이터 로딩
  async function loadData() {
    let res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
    if (ON_PAGES && !res?.ok) res = await fetch(`${DATA_FALLBACK}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
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
    manual: ['circle', 'cirbtc', 'stables', 'dex', 'tvl', 'lending', 'accounts', 'activity', 'cctp', 'rates', 'short', 'filings', 'news', 'earnings', 'quote'],
    auto: ['circle', 'cirbtc', 'stables', 'dex', 'tvl', 'accounts', 'activity', 'cctp', 'rates', 'short', 'filings', 'news', 'earnings', 'quote'],
    light: ['circle', 'cirbtc', 'quote'],
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
      const jobyParts = state.stock === 'JOBY' && kind !== 'light' ? ['faa', 'jchart', 'jearn', 'jnews', 'jfilings'] : [];
      const r = await syncNow([...SYNC_SETS[kind], ...jobyParts]);
      renderAll();
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
      if (kind === 'manual') { manualRunning = false; setRefreshUi('fail'); toast('업데이트 실패 · 인터넷 연결을 확인하세요', true); }
      document.getElementById('status').innerHTML = '<span class="warn">데이터를 불러오지 못했어요 · 새로고침을 눌러 다시 시도하세요</span>';
    } finally {
      busy = false;
      if (manualQueued) { manualQueued = false; refresh('manual'); }
    }
  }

  // ---------------------------------------------------------------- 화면 전환 (하단 탭)
  const VIEW_TITLES = {
    home: "Yong's Portfolio", fire: 'Fire · 퇴사까지',
    crcl: '서클 주가 · 공매도', earn: '서클 실적', usdc: 'USDC · 스테이블코인', arc: 'Arc 체인', news: '서클 뉴스 · 공시',
    jprice: '조비 주가 · 공매도', jearn: '조비 실적 · FAA 인증', jnews: '조비 뉴스 · 공시',
  };
  const scrollMem = {};
  function showView(v, target) {
    if (!VIEW_TITLES[v] || !viewAllowed(v)) v = 'home';
    if (state.view !== v) scrollMem[state.view] = window.scrollY;
    state.view = v;
    document.querySelectorAll('.view').forEach((el) => { el.hidden = el.dataset.view !== v; });
    document.querySelectorAll('[data-tab]').forEach((b) => (b.dataset.tab === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    document.getElementById('view-title').textContent = VIEW_TITLES[v];
    try { history.replaceState(null, '', '#' + v); } catch {}
    savePref('view', v);
    for (const c of Object.values(charts)) if (c.canvas?.closest('.view')?.dataset.view === v) c.resize();
    fireLoop(v === 'fire' || state.stock === 'JOBY');
    if (v === 'fire') { renderFire(); if (!state.quote) loadQuote().then(renderFire).catch(() => renderFire()); }
    if (v === 'earn') renderEarnings();
    if (v === 'jearn') { renderFaa(); renderJEarnings(); }
    if (v === 'jprice') { renderJPriceChart(); renderShort(state.data?.short?.joby, 'jshort', '조비'); }
    if (v === 'news' || v === 'jnews') { markNewsSeen(); renderNewsSummary(); renderNews(); } else updateNewsBadge();
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
  });
  document.addEventListener('input', (ev) => {
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
    if (go) { const [v, target] = go.dataset.go.split(':'); showView(v, target); return; }
    const tab = ev.target.closest('[data-tab]');
    if (tab) {
      if (tab.dataset.tab === state.view) window.scrollTo({ top: 0, behavior: 'smooth' });
      else showView(tab.dataset.tab);
      return;
    }
    const stk = ev.target.closest('[data-stock]');
    if (stk) { setStock(stk.dataset.stock); return; }
    const jr = ev.target.closest('[data-jrange]');
    if (jr) { state.jrange = jr.dataset.jrange; savePref('jrange', state.jrange); renderJPriceChart(); return; }
    if (ev.target.closest('#f-add')) { fireRows = readFireRows(); fireRows.push({ ticker: 'JOBY' }); document.getElementById('f-rows').innerHTML = fireRows.map(fireRowHtml).join(''); return; }
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
  });

  if (!RANGES[state.range]) state.range = '1d';
  if (!JRANGES[state.jrange]) state.jrange = '1d';
  updateBasisBtn();
  renderFireSet();
  document.getElementById('home-crcl').hidden = state.stock !== 'CRCL';
  document.getElementById('home-joby').hidden = state.stock !== 'JOBY';
  renderTabbar();
  renderStockSwitch();
  updateFireChip();
  { const v0 = location.hash.slice(1).split('&')[0] || loadPref('view', 'home'); showView(viewAllowed(v0) ? v0 : 'home'); }
  initPrice();
  refresh('auto');
  setInterval(() => { if (!document.hidden) refresh('light'); }, LIVE_REFRESH_MS);
  setInterval(() => { if (!document.hidden) refresh('auto'); }, DATA_REFRESH_MS);
  setInterval(() => { if (!document.hidden) { renderStatus(); if (px.mark) setHtml('px-next', fundLeft(px.mark.next)); } }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { disconnectWs(); return; }
    loadPxSnapshot().then(schedulePaint).catch(() => {});
    connectWs();
    refresh('auto');
  });
})();
