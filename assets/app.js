/* Circle Watch — 화면 렌더링
 * data/latest.json(수집기 결과)을 그리고, 일부 값은 1분마다 Circle API·RPC에서 직접 갱신한다. */
(() => {
  'use strict';

  const DATA_URL = 'data/latest.json';
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
  };

  const state = {
    data: null,
    live: null,
    basis: loadPref('basis', 'prev'),
    openInfo: new Set(),
    cctpAll: false,
  };
  const charts = {};

  // ---------------------------------------------------------------- 설명(ⓘ)
  const INFO = {
    short: `
      <p><b>공매도 비율</b> = 그날 CRCL 거래량 중 공매도(빌린 주식을 파는 거래)로 체결된 비중입니다. 출처는 FINRA 일별 공매도 거래량(Reg SHO)이며, 미국 장 마감 후 저녁(한국 시간 다음 날 아침)에 전날 값이 올라옵니다.</p>
      <ul>
        <li><b>해석 주의</b>: 이 수치엔 시장조성자(마켓메이커)가 매수 주문을 받아주면서 잠깐 하는 공매도가 포함돼, 보통 종목도 40~50%대가 흔합니다. <b>절대 수준보다 평소(1개월 평균) 대비 얼마나 높아졌는지</b>를 보세요.</li>
        <li><b>전체 거래량</b>은 FINRA에 보고된 장외·대체거래소 거래 기준이라, 거래소 전체 거래량보다 작습니다.</li>
        <li><b>공매도 잔고</b>: 아직 되갚지 않은 공매도 주식 수(월 2회 발표). 늘면 하락에 베팅하는 물량이 쌓이는 중입니다.</li>
        <li><b>커버 일수</b> = 공매도 잔고 ÷ 하루 평균 거래량. 공매도 세력이 전부 되사는 데 며칠 걸리는지로, 높을수록 급등(숏 스퀴즈) 때 되사기 압력이 큽니다.</li>
      </ul>`,
    stables: `
      <p><b>달러 스테이블코인 공급량</b>은 1달러에 가치를 고정한 토큰이 시장에 얼마나 풀려 있는지 보여줍니다. 1토큰 ≈ $1이므로 공급량 = 시가총액입니다.</p>
      <p><b>USDC 점유율</b> = USDC 공급량 ÷ 전체 달러 스테이블코인 공급량(DefiLlama 집계). Circle 매출의 대부분은 USDC 준비금(단기국채·현금)에서 나오는 이자라서, <b>USDC 유통량과 점유율은 CRCL 실적의 가장 직접적인 선행지표</b>입니다.</p>
      <ul>
        <li><b>7일 / 30일</b>: 7일·30일 전 대비 공급량 변화율. <span class="up">빨강=증가</span>, <span class="down">파랑=감소</span>.</li>
        <li><b>USYC</b>: Circle의 토큰화 단기국채 머니마켓펀드(이자가 붙는 토큰). 기관 담보·예치 수요를 보여줍니다.</li>
        <li><b>EURC</b>: Circle의 유로 스테이블코인(€ 기준, Circle 공식 발행량).</li>
        <li><b>BUIDL</b>: BlackRock 토큰화 MMF — USYC와 비교용.</li>
      </ul>
      <p>USYC·BUIDL은 점유율 계산에 포함되지만 결제용 스테이블코인과 성격이 달라 아래에 따로 표시합니다.</p>`,
    usdc: `
      <p>시장에 유통 중인 <b>USDC 총량</b>입니다. 헤드라인 숫자는 Circle 공식 API의 현재 값(1분마다 갱신), 차트는 DefiLlama 일별 추이입니다.</p>
      <p>USDC가 1개 발행될 때마다 Circle은 $1를 준비금으로 보관하고 그 이자를 수익으로 가져갑니다. 대략 <b>Circle 준비금 수익 ≈ 평균 유통량 × 단기금리</b>이므로(여기서 Coinbase 등 유통 파트너 몫이 차감), 유통량 추세가 곧 매출 추세입니다.</p>`,
    eurc: `
      <p>Circle이 발행한 <b>유로 스테이블코인 EURC</b>의 총 유통량(€)입니다. 헤드라인은 Circle 공식 API 현재 값, 차트는 DefiLlama 일별 추이입니다.</p>
      <p>유럽 MiCA 규제 하에서 허가받은 유로 스테이블코인으로, USDC 외 사업 다각화 지표로 볼 수 있습니다.</p>`,
    products: `
      <p>Circle 자체 상품인 <b>USYC(토큰화 MMF)</b>와 <b>EURC(유로 코인)</b>의 성장 속도를 비교합니다.</p>
      <p>규모가 크게 달라서 두 상품 모두 <b>기간 첫날 공급량을 100</b>으로 맞춘 지수로 그렸습니다. 예) 지수 600 = 시작 시점 대비 6배.</p>
      <p>USYC는 거래소·기관이 담보나 대기자금으로 쓰는 경우가 많아 크게 출렁일 수 있습니다.</p>`,
    chains: `
      <p>Circle 공식 API 기준 <b>체인별 USDC 유통량</b> 상위 목록입니다. 어떤 블록체인에서 USDC가 많이 쓰이는지, Arc가 어느 위치까지 올라왔는지 확인할 수 있습니다.</p>`,
    tvl: `
      <p><b>TVL(Total Value Locked)</b>은 Arc 체인 위 DeFi 서비스(대출·DEX 등)에 예치된 자산의 달러 합계입니다(DefiLlama 일별).</p>
      <p>DefiLlama 기본 기준이라 <b>빌려 나간 금액은 제외</b>된 순수 예치 잔액입니다. Arc는 Circle이 직접 만든 L1 블록체인으로, TVL이 늘수록 Arc 생태계에 돈이 모이고 있다는 뜻입니다.</p>`,
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
      <p><b>cirBTC</b>는 Circle이 발행하는 래핑 비트코인으로, 실제 BTC를 1:1로 보관하고 발행합니다(8자리 소수, 준비금은 Chainlink 준비금 증명으로 공개).</p>
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
      <p><b>CCTP(Cross-Chain Transfer Protocol)</b>는 Circle의 공식 USDC 브리지입니다. 한 체인에서 USDC를 소각하고 다른 체인에서 같은 양을 새로 발행하는 방식이라, 래핑 토큰 없이 네이티브 USDC가 이동합니다.</p>
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
    const snaps = state.data?.snapshots || [];
    const liveMap = { usdcTotal: 'usdcTotal', eurcTotal: 'eurcTotal', arcUsdc: 'arcUsdc', arcEurc: 'arcEurc', cirbtc: 'cirbtc', cirbtcArc: 'cirbtcArc', cirbtcEth: 'cirbtcEth' };
    if (state.live && liveMap[key] && state.live[liveMap[key]] != null) return { v: state.live[liveMap[key]], t: state.live.at, live: true };
    const last = snaps.at(-1);
    return { v: last?.[key], t: last?.t, live: false };
  }
  function base(key, curT) {
    const snaps = (state.data?.snapshots || []).filter((s) => s[key] != null);
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
    const d = state.data;

    const tiles = [
      { k: 'USDC 유통량', key: 'usdcTotal', f: usd, live: true },
      { k: 'USDC 점유율', key: 'usdcShare', f: (v) => pctPlain(v, 2), mode: 'pp' },
      { k: 'EURC 유통량', key: 'eurcTotal', f: eur, live: true },
      { k: 'cirBTC 공급', key: 'cirbtc', f: (v) => btc(v), live: true },
      { k: 'Arc DeFi TVL', key: 'tvl', f: usd },
      { k: 'Arc 차입 잔액', key: 'borrow', f: usd },
      { k: 'Arc DEX 24시간', key: 'dex24h', f: usd },
      { k: 'CCTP 순유입 24h', key: 'cctpNet', f: usd, abs: true },
    ];
    document.getElementById('kpis').innerHTML = tiles.map((t) => {
      const x = delta(t.key, { mode: t.mode });
      let dh = x.html;
      if (t.abs) { // 순유입은 부호가 바뀔 수 있어 변화율 대신 증감액
        const b = x.c.v != null ? base(t.key, x.c.t) : null;
        const diff = b && b.v != null ? x.c.v - b.v : null;
        dh = `<span class="${cls(diff, 1)}">${arrow(diff)} ${diff == null ? '–' : (diff > 0 ? '+' : '') + usd(diff)}</span>`;
      }
      return `<div class="kpi"><div class="k">${t.k}${x.c.live ? '<span class="live-dot" title="실시간"></span>' : ''}</div>
        <div class="v">${t.f(x.c.v)}</div><div class="d">${dh}</div></div>`;
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
        <td class="${cls(r.ch7, 5e-5)}">${pct(r.ch7)}</td><td class="${cls(r.ch30, 5e-5)}">${pct(r.ch30)}</td></tr>`;
    };
    const x = delta('usdcShare', { mode: 'pp' });
    card('stables', {
      title: '달러 스테이블코인 공급량',
      sub: '경쟁 코인과 Circle 자체 상품 · DefiLlama',
      info: INFO.stables,
      body: `
        <div class="headline"><span class="lbl">USDC 점유율</span><span class="big">${pctPlain(x.c.v)}</span>${x.html.replace('class="', 'style="font:500 13px var(--mono)" class="')}</div>
        <div class="delta-line"><span class="when">${x.when} · 전체 달러 스테이블코인 ${usd(s.totalUsd)}</span></div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>달러 스테이블코인</th><th>공급량</th><th>점유율</th><th>7일</th><th>30일</th></tr></thead>
          <tbody>${s.rows.map((r) => row(r, false)).join('')}
            <tr class="sub-h"><th>Circle 자체 상품 · 비교</th><th>공급량</th><th></th><th>7일</th><th>30일</th></tr>
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
    if (!s?.usyc?.length) return failed('products', 'Circle 자체 상품: USYC · EURC', state.data.errors?.series);
    const eMap = new Map(s.eurc.map((p) => [p[0], p[1]]));
    const joined = s.usyc.filter((p) => eMap.has(p[0]) && p[1] > 0 && eMap.get(p[0]) > 0);
    const b0u = joined[0][1], b0e = eMap.get(joined[0][0]);
    const labels = joined.map((p) => p[0]);
    const usycNow = state.data.stables?.products?.find((p) => p.sym === 'USYC')?.supply ?? joined.at(-1)[1];
    card('products', {
      title: 'Circle 자체 상품: USYC · EURC',
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
    const c = state.live?.usdcChains || state.data.circle?.usdcChains;
    if (!c?.length) return failed('chains', '체인별 USDC 유통량', state.data.errors?.circle);
    const top = c.slice(0, 10);
    const max = top[0].amount;
    const arc = c.find((x) => x.chain === 'ARC');
    const rank = arc ? c.findIndex((x) => x.chain === 'ARC') + 1 : null;
    const name = (k) => ({ ETH: 'Ethereum', SOL: 'Solana', BASE: 'Base', ARB: 'Arbitrum', ARC: 'Arc', AVAX: 'Avalanche', MATIC: 'Polygon', POLY: 'Polygon', OP: 'OP Mainnet', APTOS: 'Aptos', ALGO: 'Algorand', XLM: 'Stellar', SUI: 'Sui', NOBLE: 'Noble', HBAR: 'Hedera', WORLDCHAIN: 'World Chain', UNI: 'Unichain', LINEA: 'Linea', SEI: 'Sei', CELO: 'Celo', HYPEREVM: 'HyperEVM', ZKS: 'ZKsync', NEAR: 'NEAR', SONIC: 'Sonic', PLASMA: 'Plasma', MONAD: 'Monad', INK: 'Ink', XDC: 'XDC', CODEX: 'Codex', PLUME: 'Plume', BNB: 'BNB Chain' }[k] || k);
    card('chains', {
      title: '체인별 USDC 유통량',
      sub: 'Circle 공식 API · 상위 10개 체인',
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
          <thead><tr><th>날짜</th><th>Morpho 차입</th><th>Aave V4 차입</th><th>차입 합계</th><th>전일 대비</th><th>예치 잔액</th><th>이용률</th></tr></thead>
          <tbody>${rows.map((r, i) => {
            const prev = days[days.length - 2 - i];
            const ch = prev && prev.borrow ? r.borrow / prev.borrow - 1 : null;
            return `<tr${i === 0 ? ' class="today"' : ''}><td>${md(r.d)}${i === 0 ? ' <span class="dim" style="font-size:11px">현재</span>' : ''}</td><td>${usd(r.morphoB)}</td><td>${usd(r.aaveB)}</td>
              <td class="strong">${usd(r.borrow)}</td><td class="${cls(ch)}">${ch == null ? '–' : (ch > 0 ? '+' : '') + (ch * 100).toFixed(0) + '%'}</td>
              <td>${usd(r.tvl)}</td><td>${pctPlain(r.util)}</td></tr>`;
          }).join('')}</tbody></table></div>`,
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
      title: 'cirBTC 공급량', sub: 'Circle 래핑 비트코인 · 체인별 온체인 발행량', info: INFO.cirbtc,
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
        <div class="delta-line">${x.html}<span class="when">${lastWeek ? `${lastWeek.d} 시작 주 · 활성 ${nf(0).format(lastWeek.active)} 중 재방문 ${nf(0).format(lastWeek.active - lastWeek.new)}` : ''}</span></div>
        ${lastDone ? `<p class="note" style="margin-top:4px">${lastDone.d.slice(5).replace('-', '/')} 활성 ${nf(0).format(lastDone.active)} (신규 ${nf(0).format(lastDone.new)}) · 누적 계정 ${nf(0).format(A.totals?.accounts || 0)}</p>` : ''}
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

  function renderShort() {
    const S = state.data.short;
    if (!S?.daily?.length) return failed('short', 'CRCL 공매도 비율', state.data.errors?.short);
    const days = S.daily;
    const last = days.at(-1), prev = days.at(-2);
    const d1 = prev ? last.ratio - prev.ratio : null;
    const labels = days.map((r) => isoToTs(r.d));
    const shares = (v) => (v == null ? '–' : unit(v) + '주');
    const hi = days.reduce((a, r) => (r.ratio > a.ratio ? r : a)), lo = days.reduce((a, r) => (r.ratio < a.ratio ? r : a));
    const si = (S.interest || []).slice(-3).reverse();
    card('short', {
      title: 'CRCL 공매도 비율', sub: '최근 1개월 · 일별 공매도 거래 비중 · FINRA', info: INFO.short,
      body: `<div class="headline"><span class="lbl">${md(labels.at(-1))} 공매도 비율</span><span class="big">${pctPlain(last.ratio)}</span><span class="lbl">1개월 평균 ${pctPlain(S.avgRatio)}</span></div>
        <div class="delta-line"><span class="${cls(d1)}">${arrow(d1)} ${pp(d1, 1)}</span><span class="when">전 거래일(${prev ? md(labels.at(-2)) : '–'}) 대비 · 공매도 ${shares(last.short)} / 전체 ${shares(last.total)} · 1개월 최고 ${pctPlain(hi.ratio)}(${md(isoToTs(hi.d))}) · 최저 ${pctPlain(lo.ratio)}(${md(isoToTs(lo.d))})</span></div>
        <div class="chart"><canvas id="cv-short" role="img" aria-label="CRCL 일별 공매도 비율"></canvas></div>
        <div class="legend"><span><i style="background:${C.purple}"></i>일별 공매도 비율</span><span><i class="line" style="background:${C.ink2}"></i>1개월 평균</span></div>
        ${si.length ? `<div class="tbl-wrap"><table>
          <thead><tr><th>공매도 잔고 기준일</th><th>잔고</th><th>직전 대비</th><th>커버 일수</th></tr></thead>
          <tbody>${si.map((r, i) => `<tr${i === 0 ? ' class="today"' : ''}><td>${r.d.slice(5).replace('-', '/')}</td><td class="strong">${shares(r.qty)}</td>
            <td class="${cls(r.chg)}">${r.chg > 0 ? '+' : ''}${r.chg.toFixed(1)}%</td><td>${r.dtc.toFixed(2)}일</td></tr>`).join('')}</tbody></table></div>
          <p class="note">공매도 잔고는 FINRA가 한 달에 두 번(15일·월말 기준) 발표합니다.</p>` : ''}`,
    });
    draw('short', {
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

  function renderStatus() {
    const d = state.data;
    const errs = Object.keys(d.errors || {});
    const age = (Date.now() - Date.parse(d.updatedAt)) / 60000;
    const stale = age > 90;
    document.getElementById('status').innerHTML =
      `${when(d.updatedAt)} 수집${stale ? ` <span class="warn">· ${Math.round(age / 60)}시간 전 (수집 지연)</span>` : ''}` +
      (state.live ? ` · 실시간 ${when(state.live.at)}` : '') +
      (errs.length ? ` <span class="warn">· 일부 실패: ${errs.join(', ')}</span>` : '');
    document.getElementById('live-pill').hidden = !state.live;
  }

  function renderAll() {
    if (!state.data) return;
    const jobs = [renderStatus, renderKpis, renderShort, renderStables,
      () => seriesCard('usdc', { title: 'USDC 전체 유통량', sub: '추이 DefiLlama 일별 · 현재 값 Circle 공식', key: 'usdcTotal', fmt: usd, series: state.data.series?.usdc, color: C.blue, info: INFO.usdc }),
      () => seriesCard('eurc', { title: 'EURC 전체 유통량', sub: '유로 스테이블코인 · 추이 DefiLlama 일별 · 현재 값 Circle 공식', key: 'eurcTotal', fmt: eur, series: state.data.series?.eurc, color: C.purple, info: INFO.eurc }),
      renderProducts, renderChains, renderTvl, renderDex, renderBorrow, renderArcSupply, renderLending, renderCirbtc, renderAccounts, renderCctp];
    for (const j of jobs) {
      try { j(); } catch (e) { console.error(e); }
    }
  }

  // ---------------------------------------------------------------- 데이터 로딩
  async function loadData() {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('data ' + res.status);
    state.data = await res.json();
  }

  async function rpcSupply(urls, token, decimals) {
    for (const u of urls) {
      try {
        const r = await fetch(u, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data: '0x18160ddd' }, 'latest'] }),
          signal: AbortSignal.timeout(10000),
        });
        const j = await r.json();
        if (j.result && j.result !== '0x') return Number(BigInt(j.result)) / 10 ** decimals;
      } catch {}
    }
    return null;
  }

  async function loadLive() {
    const [circle, arcBtc, ethBtc] = await Promise.all([
      fetch(LIVE.circle, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null),
      rpcSupply(LIVE.arcRpc, LIVE.arcCirbtc, 8),
      rpcSupply(LIVE.ethRpc, LIVE.ethCirbtc, 8),
    ]);
    const live = { at: new Date().toISOString() };
    if (circle?.data) {
      const pick = (s) => circle.data.find((x) => x.symbol === s);
      const u = pick('USDC'), e = pick('EURC');
      const onChain = (c, n) => Number(c?.chains?.find((x) => x.chain === n)?.amount ?? NaN);
      if (u) {
        live.usdcTotal = Number(u.totalAmount);
        live.arcUsdc = onChain(u, 'ARC');
        live.usdcChains = u.chains.map((x) => ({ chain: x.chain, amount: Number(x.amount) })).sort((a, b) => b.amount - a.amount);
      }
      if (e) { live.eurcTotal = Number(e.totalAmount); live.arcEurc = onChain(e, 'ARC'); }
    }
    if (arcBtc != null) live.cirbtcArc = arcBtc;
    if (ethBtc != null) live.cirbtcEth = ethBtc;
    if (arcBtc != null && ethBtc != null) live.cirbtc = arcBtc + ethBtc;
    for (const k of Object.keys(live)) if (typeof live[k] === 'number' && !isFinite(live[k])) delete live[k];
    const got = Object.keys(live).length > 1;
    state.live = got ? live : state.live;
  }

  let busy = false;
  async function refresh({ data = true } = {}) {
    if (busy) return;
    busy = true;
    const btn = document.getElementById('refresh');
    btn.classList.add('spin');
    try {
      if (data || !state.data) await loadData().catch((e) => { if (!state.data) throw e; });
      await loadLive().catch(() => {});
      renderAll();
    } catch (e) {
      document.getElementById('status').innerHTML = `<span class="warn">데이터를 불러오지 못했습니다 (${esc(e.message)}). 새로고침을 눌러 다시 시도하세요.</span>`;
    } finally {
      btn.classList.remove('spin');
      busy = false;
    }
  }

  // ---------------------------------------------------------------- 이벤트
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
    const b = ev.target.closest('[data-basis]');
    if (b) {
      state.basis = b.dataset.basis;
      savePref('basis', state.basis);
      document.querySelectorAll('[data-basis]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderAll();
      return;
    }
    if (ev.target.closest('#cctp-more')) { state.cctpAll = !state.cctpAll; renderCctp(); return; }
    if (ev.target.closest('#refresh')) refresh();
  });
  document.querySelectorAll('[data-basis]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.basis === state.basis)));

  refresh();
  setInterval(() => { if (!document.hidden) refresh({ data: false }); }, LIVE_REFRESH_MS);
  setInterval(() => { if (!document.hidden) refresh(); }, DATA_REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
