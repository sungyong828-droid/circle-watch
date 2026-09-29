// Circle Watch 뉴스 중계 Worker
// 구글 뉴스 RSS·Nasdaq 공시 목록은 브라우저에서 직접 받을 수 없어(CORS), 이 Worker가 대신 받아 JSON으로 돌려준다.
// GET /news → { at, official, kr, en, filings }   (3분 캐시)

const ALLOWED_ORIGINS = [
  'https://sungyong828-droid.github.io',
  'http://localhost:8765',
  'https://circle-watch.pages.dev',
];
const CACHE_SECONDS = 180;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const DAY_MS = 86400000;

const decodeXml = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rssTag = (it, t) => { const m = it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decodeXml(m[1]).trim() : ''; };
const rssItems = (xml) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => it);

// 구글은 Cloudflare 주소 일부를 간헐적으로 막는다(503) → 몇 번 다시 시도
async function fetchText(url, tries = 2) {
  let status = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(5000) });
      if (res.ok) return await res.text();
      status = res.status;
    } catch (e) { status = e.name === 'TimeoutError' ? 'timeout' : e.message; }
    if (i < tries - 1) await sleep(300);
  }
  throw new Error(`${new URL(url).host} ${status}`);
}

async function googleNews(q, lang) {
  const loc = lang === 'ko' ? 'hl=ko&gl=KR&ceid=KR:ko' : 'hl=en-US&gl=US&ceid=US:en';
  const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`);
  return rssItems(xml).map((it) => {
    const source = rssTag(it, 'source');
    let title = rssTag(it, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { t: new Date(rssTag(it, 'pubDate')).toISOString(), title, source, url: rssTag(it, 'link') };
  });
}

// 구글이 끝내 막히면 Bing 뉴스로 대체 (Bing은 OR 검색을 못 해서 검색어 여러 개를 합친다)
async function bingNews(queries, lang) {
  const loc = lang === 'ko' ? '&setlang=ko&cc=KR' : '&setlang=en&cc=US';
  const out = [];
  const xmls = await Promise.all(queries.map((q) => fetchText(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss${loc}`, 1).catch(() => '')));
  for (const xml of xmls) {
    out.push(...rssItems(xml).map((it) => ({
      t: new Date(rssTag(it, 'pubDate')).toISOString(),
      title: rssTag(it, 'title'),
      source: rssTag(it, 'News:Source') || 'Bing 뉴스',
      url: rssTag(it, 'link'),
    })));
  }
  if (!out.length) throw new Error('bing 결과 없음');
  return out;
}

function dedupe(list, max = 40) {
  const seen = new Set();
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 40);
  const cutoff = Date.now() - 30 * DAY_MS;
  return list
    .filter((n) => n.title && Date.parse(n.t) >= cutoff)
    .sort((a, b) => b.t.localeCompare(a.t))
    .filter((n) => { const k = key(n.title); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

async function nasdaqFilings(sym = 'CRCL') {
  const res = await fetch(`https://api.nasdaq.com/api/company/${sym}/sec-filings?limit=100&sortColumn=filed&sortOrder=desc&IsQuoteMedia=true`, {
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json, text/plain, */*', origin: 'https://www.nasdaq.com', referer: 'https://www.nasdaq.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('nasdaq ' + res.status);
  const rows = (await res.json())?.data?.rows || [];
  return rows.map((r) => {
    const [m, d, y] = r.filed.split('/');
    return { d: `${y}-${m}-${d}`, form: r.formType, owner: r.reportingOwner || '' };
  });
}

// 종목별 뉴스 검색어 · 공식 발표 판별 · 업계 뉴스 종류
const NEWS_CFG = {
  CRCL: {
    kr: 'CRCL OR "써클 인터넷" OR (써클 USDC) OR (서클 USDC) OR (써클 스테이블코인) when:30d',
    krBing: ['써클 USDC', '써클 CRCL', '서클 USDC'],
    en: '"Circle Internet" OR CRCL OR (Circle USDC stablecoin) when:30d',
    enBing: ['"Circle Internet"', 'CRCL stock', 'Circle USDC'],
    bw: '"Circle" site:businesswire.com when:60d',
    bwBing: ['"Circle Internet Group" Business Wire', 'Circle announces USDC'],
    site: 'site:circle.com when:60d',
    officialSource: /^(circle investor relations|circle\.com|businesswire\.com|business wire)$/i,
    officialTitle: /USDC|EURC|\bArc\b|Circle Internet|^Circle (?!Pharma|K\b|Health)|(with|in|and|by|from|,) Circle\b/,
    officialExclude: /Circle (Pharma|K\b|Health|Model)|(Donor|Harraden) Circle|\b[Tt]erms\b|full-stack platform/,
    officialStrip: /^Circle Internet Group, Inc\. - /,
    industry: 'crypto',
  },
  JOBY: {
    kr: '"조비 에비에이션" OR 조비에비에이션 OR (조비 에어택시) OR (조비 UAM) OR (조비 eVTOL) when:30d',
    krBing: ['조비 에비에이션', '조비 에어택시'],
    en: '"Joby Aviation" OR (Joby eVTOL) OR (Joby "air taxi") when:30d',
    enBing: ['"Joby Aviation"', 'Joby air taxi'],
    bw: '"Joby" site:businesswire.com when:90d',
    bwBing: ['"Joby Aviation" Business Wire', 'Joby Aviation announces'],
    site: 'site:jobyaviation.com when:90d',
    officialSource: /^(joby aviation|joby aero|jobyaviation\.com|ir\.jobyaviation\.com|businesswire\.com|business wire)$/i,
    officialTitle: /\bJoby\b/,
    officialExclude: /\b[Tt]erms\b|[Pp]rivacy/,
    officialStrip: /^Joby Aero, Inc\. - |^Joby Aviation, Inc\. - /,
    industry: 'uam',
  },
};
const STOCKS = Object.keys(NEWS_CFG);
// 검색 뉴스(구글·Bing)는 누구나 올릴 수 있는 사이트가 섞이므로: 도박·성인·대출 광고 차단 + 제목에 종목 관련어가 있어야 통과
const JUNK_RE = /카지노|슬롯|바카라|토토|먹튀|도박|베팅|배팅|홀덤|릴게임|성인|야동|대출 ?(문의|상담)|casino|slots?|baccarat|betting|gambl|porn|escort|onlyfans|viagra/i;
const RELEVANT = {
  CRCL: /서클|써클|Circle|CRCL|USDC|EURC|스테이블코인|stablecoin/i,
  JOBY: /조비|Joby|JOBY/i,
};
// 공시 목록 페이지("4 - 09/23/2026 - Joby Aero, Inc.")처럼 기사 아닌 항목
const FILING_PAGE_RE = /^(\d+|8-K|10-[QK]|S-\d|SC ?13[DG]|144|DEF ?14A|424B\d?)(\/A)?\s*-\s*\d{2}\/\d{2}\/\d{4}/i;
const cleanNews = (list, sym) => list.filter((n) => !JUNK_RE.test(n.title) && !JUNK_RE.test(n.source || '') && !SPAM_RE.test(n.title) && RELEVANT[sym].test(n.title));
const pickSym = (url) => { const s = (url.searchParams.get('s') || 'CRCL').toUpperCase(); return STOCKS.includes(s) ? s : 'CRCL'; };

// 구글 → (실패 시) Bing 순서로 시도하고, 어느 쪽에서 받았는지 표시
async function withFallback(primary, fallback, label, notes) {
  try { return await primary(); } catch (e) {
    notes.push(`${label}: ${e.message}`);
    if (!fallback) throw e;
    const r = await fallback();
    notes.push(`${label}: Bing 대체`);
    return r;
  }
}

// ---------------------------------------------------------------- 암호화폐 뉴스 (신뢰 매체 RSS만)
// 검색 결과가 아니라 검증된 전문 매체의 공식 RSS만 받아 스팸·가짜 기사 유입을 막는다.
// needKw: 암호화폐 외 기사도 섞인 매체는 제목에 관련 키워드가 있을 때만 수집
// (제외: DL News — 피드 갱신 중단, coindeskkorea.com — 광고성 사이트로 바뀜, 블록체인투데이 — 홍보성 글 다수)
const CRYPTO_FEEDS = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', lang: 'en', host: 'coindesk.com' },
  { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph', lang: 'en', host: 'cointelegraph.com' },
  { url: 'https://decrypt.co/feed', source: 'Decrypt', lang: 'en', host: 'decrypt.co' },
  { url: 'https://www.theblock.co/rss.xml', source: 'The Block', lang: 'en', host: 'theblock.co' },
  { url: 'https://www.blockmedia.co.kr/feed', source: '블록미디어', lang: 'ko', host: 'blockmedia.co.kr' },
  { url: 'https://www.tokenpost.kr/rss', source: '토큰포스트', lang: 'ko', host: 'tokenpost.kr', needKw: true },
];
// 광고·보도자료·과장 홍보·프리세일 등 스팸성 문구
const SPAM_RE = /sponsored|press release|partner content|advertorial|paid (post|content)|presale|pre-sale|giveaway|free (crypto|tokens?)|airdrop (claim|now|live)|guaranteed|\b\d{3,}x\b|price prediction|how to buy|best (crypto|coins?) to buy|\[(ad|pr|광고|홍보|보도자료)\]|보도자료|협찬|광고|에어드랍 (받|참여)|무료 (코인|토큰)|폭등 예정|지금 사야/i;
const CRYPTO_KW = /비트코인|이더리움|코인|가상자산|암호화폐|블록체인|스테이블|디지털자산|디지털 자산|거래소|업비트|빗썸|코인베이스|바이낸스|토큰|NFT|디파이|DeFi|XRP|리플|솔라나|USDC|USDT|테더|서클|CBDC|웹3|Web3|채굴|ETF|BTC|ETH/i;

// 도심항공교통(UAM)·eVTOL 업계 뉴스: 전문 매체 RSS만 (FlightGlobal은 에어택시 관련 기사만)
const UAM_FEEDS = [
  { url: 'https://evtolinsights.com/feed/', source: 'eVTOL Insights', lang: 'en', host: 'evtolinsights.com' },
  { url: 'https://www.urbanairmobilitynews.com/feed/', source: 'Urban Air Mobility News', lang: 'en', host: 'urbanairmobilitynews.com' },
  { url: 'https://www.flightglobal.com/rss', source: 'FlightGlobal', lang: 'en', host: 'flightglobal.com', needKw: true },
];
const UAM_KW = /eVTOL|air taxi|air-taxi|advanced air mobility|urban air mobility|\bAAM\b|\bUAM\b|vertiport|Joby|Archer|Beta Technologies|Vertical Aerospace|EHang|Wisk|Lilium|Eve Air|Volocopter|도심항공|에어택시|버티포트/i;

async function cryptoFeed(f, kw = CRYPTO_KW) {
  const xml = await fetchText(f.url, 2);
  const cutoff = Date.now() - 3 * DAY_MS;
  return rssItems(xml).map((it) => {
    const cats = [...it.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((m) => decodeXml(m[1]));
    const t = Date.parse(rssTag(it, 'pubDate') || rssTag(it, 'dc:date'));
    return { t: isFinite(t) ? new Date(t).toISOString() : '', title: rssTag(it, 'title').replace(/<[^>]+>/g, '').trim(), source: f.source, url: rssTag(it, 'link'), lang: f.lang, cats: cats.join(' ') };
  }).filter((n) => {
    if (!n.title || !n.t || Date.parse(n.t) < cutoff) return false;
    let host = '';
    try { const u = new URL(n.url); if (u.protocol !== 'https:' && u.protocol !== 'http:') return false; host = u.hostname; } catch { return false; }
    if (!(host === f.host || host.endsWith('.' + f.host))) return false; // 매체 자기 도메인 링크만
    if (SPAM_RE.test(n.title) || SPAM_RE.test(n.cats)) return false;
    if (f.needKw && !kw.test(n.title)) return false;
    return true;
  }).map(({ cats, ...n }) => n);
}

async function industryNews(feeds, kw) {
  const res = await Promise.allSettled(feeds.map((f) => cryptoFeed(f, kw)));
  const all = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return { list: dedupe(all, 40), failed: feeds.filter((_, i) => res[i].status === 'rejected').map((f) => f.source) };
}

async function cryptoNews() {
  const res = await Promise.allSettled(CRYPTO_FEEDS.map((f) => cryptoFeed(f)));
  const all = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const ko = dedupe(all.filter((n) => n.lang === 'ko'), 25);
  const en = dedupe(all.filter((n) => n.lang === 'en'), 30);
  const failed = CRYPTO_FEEDS.filter((_, i) => res[i].status === 'rejected').map((f) => f.source);
  return { list: [...ko, ...en].sort((a, b) => b.t.localeCompare(a.t)), failed };
}

async function buildNews(sym = 'CRCL') {
  const C = NEWS_CFG[sym];
  const notes = [];
  const settle = async (p) => { try { return { ok: true, v: await p } } catch (e) { return { ok: false, e } } };
  // 모든 출처를 동시에 요청하고, 14초 안에 못 받은 항목은 비워 둔다(마지막 성공 결과로 채워짐)
  const deadline = (p) => Promise.race([p, sleep(14000).then(() => { throw new Error('시간 초과'); })]);
  const industry = C.industry === 'crypto' ? cryptoNews() : industryNews(UAM_FEEDS, UAM_KW);
  const [kr, en, bw, site, filings, crypto] = await Promise.all([
    settle(deadline(withFallback(() => googleNews(C.kr, 'ko'), () => bingNews(C.krBing, 'ko'), 'kr', notes))),
    settle(deadline(withFallback(() => googleNews(C.en, 'en'), () => bingNews(C.enBing, 'en'), 'en', notes))),
    settle(deadline(withFallback(() => googleNews(C.bw, 'en'),
      () => bingNews(C.bwBing, 'en').then((l) => l.map((n) => ({ ...n, source: /business ?wire/i.test(n.source) ? 'businesswire.com' : n.source }))), 'bw', notes))),
    settle(deadline(withFallback(() => googleNews(C.site, 'en'), null, 'site', notes))),
    settle(deadline(nasdaqFilings(sym))),
    settle(deadline(industry)),
  ]);
  const v = (r) => (r.ok ? r.v : []);
  // 공식 발표: 회사 IR·자사 사이트·Business Wire만, 이름만 같은 다른 회사는 제외
  const official = dedupe([...v(bw), ...v(site)]
    .filter((n) => C.officialSource.test(n.source) && C.officialTitle.test(n.title) && !C.officialExclude.test(n.title) && !FILING_PAGE_RE.test(n.title))
    .map((n) => ({ ...n, title: n.title.replace(C.officialStrip, '') })), 30);
  const officialTitles = new Set(official.map((n) => n.title));
  return {
    at: new Date().toISOString(),
    official,
    kr: dedupe(cleanNews(v(kr), sym)),
    en: dedupe(cleanNews(v(en), sym).filter((n) => !officialTitles.has(n.title))),
    filings: v(filings),
    crypto: crypto.ok ? crypto.v.list : [], // CRCL: 암호화폐 · JOBY: UAM 업계
    industry: C.industry,
    cryptoFailed: crypto.ok ? crypto.v.failed : ['all'],
    failed: Object.entries({ kr, en, bw, site, filings, crypto }).filter(([, r]) => !r.ok).map(([k]) => k),
    notes,
  };
}

// 이번에 비어 있는 항목은 마지막으로 성공한 결과로 채운다(최대 7일)
function mergeLastGood(cur, last) {
  if (!last) return cur;
  const stale = [];
  for (const k of ['official', 'kr', 'en', 'filings', 'crypto']) {
    if (!cur[k]?.length && last[k]?.length) { cur[k] = last[k]; stale.push(k); }
  }
  if (stale.length) cur.stale = { keys: stale, at: last.at };
  return cur;
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

// Circle 공식 USDC·EURC 유통량: Circle API는 IP당 요청 제한이 엄격해서(429, 약 20분 대기)
// 1분 캐시로 몇 번을 눌러도 Circle에는 1분에 한 번만 묻고, 막히면 마지막 성공 값(최대 1일)을 돌려준다.
async function circleSupply(url, cache, cors, ctx) {
  const key = new Request(`${url.origin}/circle`);
  const lastKey = new Request(`${url.origin}/circle-last-good`);
  let res = await cache.match(key);
  if (!res) {
    let body, stale = false;
    try {
      const r = await fetch('https://api.circle.com/v1/stablecoins', { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('circle ' + r.status);
      const j = await r.json();
      body = JSON.stringify({ at: new Date().toISOString(), data: (j.data || []).filter((x) => x.symbol === 'USDC' || x.symbol === 'EURC') });
      ctx.waitUntil(cache.put(lastKey, new Response(body, { headers: { 'cache-control': 'public, max-age=86400' } })));
    } catch (e) {
      const last = await cache.match(lastKey);
      if (!last) return json({ error: String(e.message || e) }, cors, 502);
      body = JSON.stringify({ ...(await last.json()), stale: true, error: String(e.message || e) });
      stale = true;
    }
    res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${stale ? 30 : 60}` } });
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

const json = (obj, headers = {}, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

// ---------------------------------------------------------------- 서클 실적 (분기)
// Nasdaq: 최근 4분기 손익계산서 · EPS 실적/예상 · 다음 발표일(Zacks 추정)
// SEC XBRL: 더 오래된 분기와 준비금 이자수익(가능할 때만 — 막히면 Nasdaq만으로)
const NASDAQ_HEADERS = { 'user-agent': BROWSER_UA, accept: 'application/json, text/plain, */*', origin: 'https://www.nasdaq.com', referer: 'https://www.nasdaq.com/' };
const nasdaqJson = async (path) => {
  const r = await fetch(`https://api.nasdaq.com/api/${path}`, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('nasdaq ' + r.status);
  return (await r.json()).data;
};
// "$701,315"(천 달러) → 701315000, "($1,234)"·"-$1,234" → 음수, "--" → null
const money = (s) => {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || t === '--' || t === 'N/A') return null;
  const neg = /^\(|^-/.test(t);
  const n = parseFloat(t.replace(/[^0-9.]/g, ''));
  return isFinite(n) ? (neg ? -n : n) * 1000 : null;
};
const mdy = (s) => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
// "Jun 2026" → 해당 분기 말일 "2026-06-30"
const qtrEnd = (s) => { const m = String(s || '').match(/([A-Z][a-z]{2}) (\d{4})/); if (!m) return null; const mo = MON[m[1]]; const last = new Date(Date.UTC(+m[2], mo, 0)).getUTCDate(); return `${m[2]}-${String(mo).padStart(2, '0')}-${last}`; };

const EARN_CFG = {
  CRCL: {
    cik: '0001876042',
    flows: { revenue: 'Revenues', reserve: 'InterestAndDividendIncomeOperating', otherRevenue: 'RevenueFromContractWithCustomerExcludingAssessedTax', opIncome: 'OperatingIncomeLoss', netIncome: 'NetIncomeLoss', eps: 'EarningsPerShareDiluted' },
  },
  JOBY: {
    cik: '0001819848',
    flows: { revenue: 'RevenueFromContractWithCustomerExcludingAssessedTax', opIncome: 'OperatingIncomeLoss', netIncome: 'NetIncomeLoss', eps: 'EarningsPerShareDiluted', rnd: 'ResearchAndDevelopmentExpense', sga: 'SellingGeneralAndAdministrativeExpense' },
    instants: { cash: 'CashAndCashEquivalentsAtCarryingValue', sti: 'ShortTermInvestments' },
    ytd: { ocf: 'NetCashProvidedByUsedInOperatingActivities', capex: 'PaymentsToAcquirePropertyPlantAndEquipment' },
  },
};

async function secQuarterly(sym = 'CRCL') {
  const E = EARN_CFG[sym];
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${E.cik}.json`, {
    headers: { 'user-agent': 'CircleWatch personal dashboard (https://circle-watch.pages.dev)', accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('sec ' + r.status);
  const g = (await r.json()).facts['us-gaap'];
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  const series = (concept) => {
    const u = g[concept]?.units; if (!u) return {};
    const vals = u[Object.keys(u)[0]];
    const q = {}, fy = {};
    for (const v of vals) {
      if (!v.start) continue;
      const d = days(v.start, v.end);
      if (d >= 80 && d <= 100) q[v.end] = v.val;
      else if (d >= 350 && d <= 380) fy[v.end] = v.val;
    }
    // 4분기 = 연간 − 1~3분기 (10-K에는 4분기 단독 수치가 없음)
    for (const [end, total] of Object.entries(fy)) {
      if (q[end] != null) continue;
      const y = +end.slice(0, 4), mo = end.slice(5, 7);
      const prev = [`${y}-03-31`, `${y}-06-30`, `${y}-09-30`].filter(() => mo === '12');
      if (prev.length === 3 && prev.every((p) => q[p] != null)) q[end] = total - prev.reduce((s, p) => s + q[p], 0);
    }
    return q;
  };
  // 분기 말 잔액(현금 등)
  const instant = (concept) => {
    const u = g[concept]?.units; if (!u) return {};
    const out = {};
    for (const v of u[Object.keys(u)[0]]) if (!v.start && /10-[QK]/.test(v.form || '')) out[v.end] = v.val;
    return out;
  };
  // 현금흐름표는 연초부터 누적(YTD)이라 직전 누적과의 차이로 분기 값을 만든다
  const ytdQuarterly = (concept) => {
    const u = g[concept]?.units; if (!u) return {};
    const byStart = {};
    for (const v of u[Object.keys(u)[0]]) if (v.start) (byStart[v.start] ||= {})[v.end] = v.val;
    const q = {};
    for (const [start, ends] of Object.entries(byStart)) {
      let prevEnd = start, prevVal = 0;
      for (const end of Object.keys(ends).sort()) {
        const gap = days(prevEnd, end);
        if (gap >= 80 && gap <= 100 && q[end] == null) q[end] = ends[end] - prevVal;
        prevEnd = end; prevVal = ends[end];
      }
    }
    return q;
  };
  const out = {};
  for (const [k, c] of Object.entries(E.flows || {})) out[k] = series(c);
  for (const [k, c] of Object.entries(E.instants || {})) out[k] = instant(c);
  for (const [k, c] of Object.entries(E.ytd || {})) out[k] = ytdQuarterly(c);
  return out;
}

export async function buildEarnings(sym = 'CRCL') {
  const [fin, sur, dt, fc, sec] = await Promise.allSettled([
    nasdaqJson(`company/${sym}/financials?frequency=2`),
    nasdaqJson(`company/${sym}/earnings-surprise`),
    nasdaqJson(`analyst/${sym}/earnings-date`),
    nasdaqJson(`analyst/${sym}/earnings-forecast`),
    secQuarterly(sym),
  ]);
  const Q = {}; // 분기 말일 → 값
  const put = (end, k, v) => { if (end && v != null && isFinite(v)) (Q[end] ||= { end })[k] = v; };

  if (sec.status === 'fulfilled') {
    const s = sec.value;
    for (const [k, map] of Object.entries(s)) for (const [end, v] of Object.entries(map)) put(end, k, k === 'eps' && v === 0 ? null : v);
  }
  if (fin.status === 'fulfilled') {
    const t = fin.value?.incomeStatementTable;
    const cols = Object.entries(t?.headers || {}).filter(([k]) => k !== 'value1').map(([k, v]) => [k, mdy(v)]);
    const row = (name) => t?.rows?.find((r) => r.value1 === name);
    const map = { revenue: 'Total Revenue', cost: 'Cost of Revenue', grossProfit: 'Gross Profit', opIncome: 'Operating Income', netIncome: 'Net Income' };
    for (const [key, name] of Object.entries(map)) {
      const r = row(name);
      if (r) for (const [col, end] of cols) put(end, key, money(r[col])); // Nasdaq 값이 있으면 SEC 값을 덮어쓴다(4분기 포함)
    }
  }
  const surprises = [];
  if (sur.status === 'fulfilled') {
    for (const r of sur.value?.earningsSurpriseTable?.rows || []) {
      const end = qtrEnd(r.fiscalQtrEnd);
      const item = { end, reported: mdy(r.dateReported), eps: +r.eps, consensus: parseFloat(r.consensusForecast), surprise: parseFloat(r.percentageSurprise) / 100 };
      surprises.push(item);
      put(end, 'eps', item.eps);
      put(end, 'consensus', item.consensus);
      if (Q[end]) Q[end].reportedOn = item.reported;
    }
  }
  let next = null;
  if (dt.status === 'fulfilled') {
    const text = dt.value?.reportText || '';
    const m = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const cons = text.match(/consensus EPS forecast for the quarter is \$(-?\d+(?:\.\d+)?)/);
    const ly = text.match(/same quarter last year was \$(-?\d+(?:\.\d+)?)/);
    const n = text.match(/based on\s+(\d+) analysts/);
    next = {
      date: m ? mdy(m[1]) : null,
      estimated: /estimated|algorithm/i.test(text),
      consensus: cons ? +cons[1] : null,
      lastYearEps: ly ? +ly[1] : null,
      analysts: n ? +n[1] : null,
    };
  }
  if (fc.status === 'fulfilled' && next) {
    const r0 = fc.value?.quarterlyForecast?.rows?.[0];
    if (r0) Object.assign(next, { quarter: qtrEnd(r0.fiscalEnd), high: +r0.highEPSForecast, low: +r0.lowEPSForecast, analysts: next.analysts ?? +r0.noOfEstimates });
  }
  // 현금 소진 = 영업현금흐름 + 설비투자(음수면 현금이 빠져나감)
  for (const q of Object.values(Q)) {
    if (q.ocf != null) q.burn = q.ocf - (q.capex || 0);
    if (q.cash != null || q.sti != null) q.liquidity = (q.cash || 0) + (q.sti || 0);
  }
  const quarters = Object.values(Q).filter((q) => q.revenue != null || q.netIncome != null).filter((q) => q.netIncome != null || q.revenue != null).sort((a, b) => a.end.localeCompare(b.end)).slice(-8);
  if (!quarters.length && !next) throw new Error('실적 데이터를 받지 못했습니다');
  return {
    at: new Date().toISOString(),
    quarters,
    surprises,
    next,
    symbol: sym,
    sources: { nasdaq: fin.status === 'fulfilled', sec: sec.status === 'fulfilled' },
  };
}

// 실적은 자주 바뀌지 않아 6시간 캐시 (발표일 전후에도 충분)
export async function handleEarnings(url, cache, cors, ctx) {
  const sym = pickSym(url);
  const key = new Request(`${url.origin}/earnings?s=${sym}`);
  let res = await cache.match(key);
  if (!res) {
    try {
      const body = JSON.stringify(await buildEarnings(sym));
      res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=21600' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    } catch (e) {
      return json({ error: String(e.message || e) }, cors, 502);
    }
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

// ---------------------------------------------------------------- 주식 시세 · 환율 (Fire 탭)
// Nasdaq: 장전·장중·장후 실시간 체결가와 정규장 종가 / Yahoo: 원·달러 환율 (실패 시 open.er-api 일별 환율)
const QUOTE_SYMBOLS = { CRCA: 'etf', CRCL: 'stocks', JOBY: 'stocks', ACHR: 'stocks' };
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };

async function nasdaqQuote(sym, cls) {
  const d = await nasdaqJson(`quote/${sym}/info?assetclass=${cls}`);
  const p = d?.primaryData || {}, s = d?.secondaryData || {};
  const price = num(p.lastSalePrice);
  const change = num(p.netChange);
  const status = d?.marketStatus || '';
  // 장전·장후에는 secondaryData가 정규장 종가, 정규장 중에는 전일 종가 = 현재가 − 변동
  const regularClose = /pre|after|closed/i.test(status) ? num(s.lastSalePrice) ?? (price != null && change != null ? price - change : null) : null;
  const prevClose = price != null && change != null ? price - change : null;
  return {
    symbol: sym, name: d?.companyName || sym, price, change, pct: num(p.percentageChange) / 100,
    prevClose, regularClose, status, time: p.lastTradeTimestamp || '', realtime: !!p.isRealTime,
  };
}

async function usdKrw() {
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1m&range=1d', { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('yahoo ' + r.status);
    const m = (await r.json()).chart.result[0].meta;
    return { rate: m.regularMarketPrice, prevClose: m.chartPreviousClose ?? m.previousClose ?? null, time: new Date(m.regularMarketTime * 1000).toISOString(), source: 'Yahoo Finance(실시간)' };
  } catch {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return { rate: j.rates.KRW, prevClose: null, time: new Date(j.time_last_update_unix * 1000).toISOString(), source: 'ExchangeRate-API(일별)' };
  }
}

export async function buildQuote() {
  const [crca, crcl, joby, achr, fx] = await Promise.allSettled([
    nasdaqQuote('CRCA', QUOTE_SYMBOLS.CRCA), nasdaqQuote('CRCL', QUOTE_SYMBOLS.CRCL),
    nasdaqQuote('JOBY', QUOTE_SYMBOLS.JOBY), nasdaqQuote('ACHR', QUOTE_SYMBOLS.ACHR), usdKrw(),
  ]);
  const v = (r) => (r.status === 'fulfilled' ? r.value : null);
  const out = { at: new Date().toISOString(), CRCA: v(crca), CRCL: v(crcl), JOBY: v(joby), ACHR: v(achr), fx: v(fx) };
  if (!out.CRCA && !out.fx) throw new Error('시세를 받지 못했습니다');
  return out;
}

// 실시간성이 중요해서 10초만 캐시
export async function handleQuote(url, cache, cors, ctx) {
  const key = new Request(`${url.origin}/quote`);
  let res = await cache.match(key);
  if (!res) {
    try {
      const body = JSON.stringify(await buildQuote());
      res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=10' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    } catch (e) {
      return json({ error: String(e.message || e) }, cors, 502);
    }
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

// ---------------------------------------------------------------- 가격 차트 (Yahoo, 바이낸스에 없는 종목용)
const CHART_SYMBOLS = ['JOBY', 'ACHR', 'CRCL', 'CRCA'];
const CHART_RANGES = { '1d': ['5m', '1d'], '1w': ['30m', '5d'], '1m': ['1h', '1mo'], '3m': ['1d', '3mo'], '1y': ['1d', '1y'] };
export async function handleChart(url, cache, cors, ctx) {
  const sym = (url.searchParams.get('s') || '').toUpperCase();
  const range = url.searchParams.get('r') || '1d';
  if (!CHART_SYMBOLS.includes(sym) || !CHART_RANGES[range]) return json({ error: 'bad request' }, cors, 400);
  const key = new Request(`${url.origin}/chart?s=${sym}&r=${range}`);
  let res = await cache.match(key);
  if (!res) {
    try {
      const [interval, rng] = CHART_RANGES[range];
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${rng}&includePrePost=${range === '1d'}`, { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('yahoo ' + r.status);
      const j = (await r.json()).chart.result[0];
      const ts = j.timestamp || [], cl = j.indicators?.quote?.[0]?.close || [];
      const points = ts.map((t, i) => [t * 1000, cl[i]]).filter((p) => p[1] != null);
      const m = j.meta || {};
      const body = JSON.stringify({ at: new Date().toISOString(), symbol: sym, range, points, prevClose: m.chartPreviousClose ?? m.previousClose ?? null, high52: m.fiftyTwoWeekHigh ?? null, low52: m.fiftyTwoWeekLow ?? null });
      res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${range === '1d' ? 60 : 900}` } });
      ctx.waitUntil(cache.put(key, res.clone()));
    } catch (e) {
      return json({ error: String(e.message || e) }, cors, 502);
    }
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

// 뉴스 응답 (Worker와 Cloudflare Pages Functions가 함께 쓴다)
export async function handleNews(url, cache, cors, ctx) {
  const sym = pickSym(url);
  const suffix = sym === 'CRCL' ? '' : `?s=${sym}`; // CRCL은 기존 캐시 키 유지
  const cacheKey = new Request(`${url.origin}/news${suffix}`);
  const lastKey = new Request(`${url.origin}/news-last-good${suffix}`);
  // fresh(새로고침 버튼)여도 1분 안에 받아 둔 결과가 있으면 그대로 쓴다
  let res = await cache.match(cacheKey);
  if (res && url.searchParams.has('fresh')) {
    const at = Date.parse((await res.clone().json()).at || 0);
    if (!(Date.now() - at < 60000)) res = null;
  }
  if (!res) {
    let data;
    try {
      data = await buildNews(sym);
    } catch (e) {
      data = { at: new Date().toISOString(), official: [], kr: [], en: [], filings: [], failed: ['all'], notes: [String(e.message || e)] };
    }
    const lastRes = await cache.match(lastKey);
    const last = lastRes ? await lastRes.json() : null;
    data = mergeLastGood(data, last);
    if (!data.kr.length && !data.en.length && !data.official.length) return json({ error: '뉴스 출처를 모두 받지 못했습니다', notes: data.notes }, cors, 502);
    const body = JSON.stringify(data);
    res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${CACHE_SECONDS}` } });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    if (!data.stale) ctx.waitUntil(cache.put(lastKey, new Response(body, { headers: { 'cache-control': 'public, max-age=604800' } })));
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

export { circleSupply };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!['/news', '/circle', '/earnings', '/quote', '/chart'].includes(url.pathname)) return new Response('Portfolio proxy · GET /news, /circle, /earnings, /quote, /chart', { headers: cors });
    // 등록된 화면에서 온 요청만 받는다
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('forbidden', { status: 403 });
    const cache = caches.default;
    if (url.pathname === '/circle') return circleSupply(url, cache, cors, ctx);
    if (url.pathname === '/earnings') return handleEarnings(url, cache, cors, ctx);
    if (url.pathname === '/quote') return handleQuote(url, cache, cors, ctx);
    if (url.pathname === '/chart') return handleChart(url, cache, cors, ctx);
    return handleNews(url, cache, cors, ctx);
  },
};
