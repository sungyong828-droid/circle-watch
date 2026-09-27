// Circle Watch 뉴스 중계 Worker
// 구글 뉴스 RSS·Nasdaq 공시 목록은 브라우저에서 직접 받을 수 없어(CORS), 이 Worker가 대신 받아 JSON으로 돌려준다.
// GET /news → { at, official, kr, en, filings }   (3분 캐시)

const ALLOWED_ORIGINS = [
  'https://sungyong828-droid.github.io',
  'http://localhost:8765',
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

async function nasdaqFilings() {
  const res = await fetch('https://api.nasdaq.com/api/company/CRCL/sec-filings?limit=100&sortColumn=filed&sortOrder=desc&IsQuoteMedia=true', {
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

const Q = {
  kr: 'CRCL OR "써클 인터넷" OR (써클 USDC) OR (서클 USDC) OR (써클 스테이블코인) when:30d',
  krBing: ['써클 USDC', '써클 CRCL', '서클 USDC'],
  en: '"Circle Internet" OR CRCL OR (Circle USDC stablecoin) when:30d',
  enBing: ['"Circle Internet"', 'CRCL stock', 'Circle USDC'],
};

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

async function buildNews() {
  const notes = [];
  const settle = async (p) => { try { return { ok: true, v: await p } } catch (e) { return { ok: false, e } } };
  // 모든 출처를 동시에 요청하고, 14초 안에 못 받은 항목은 비워 둔다(마지막 성공 결과로 채워짐)
  const deadline = (p) => Promise.race([p, sleep(14000).then(() => { throw new Error('시간 초과'); })]);
  const [kr, en, bw, site, filings] = await Promise.all([
    settle(deadline(withFallback(() => googleNews(Q.kr, 'ko'), () => bingNews(Q.krBing, 'ko'), 'kr', notes))),
    settle(deadline(withFallback(() => googleNews(Q.en, 'en'), () => bingNews(Q.enBing, 'en'), 'en', notes))),
    settle(deadline(withFallback(() => googleNews('"Circle" site:businesswire.com when:60d', 'en'), null, 'bw', notes))),
    settle(deadline(withFallback(() => googleNews('site:circle.com when:60d', 'en'), null, 'site', notes))),
    settle(deadline(nasdaqFilings())),
  ]);
  const v = (r) => (r.ok ? r.v : []);
  // 출처는 IR·circle.com·Business Wire만, 이름만 같은 다른 회사(Circle K 등)는 제외
  const official = dedupe([...v(bw), ...v(site)]
    .filter((n) => /^(circle investor relations|circle\.com|businesswire\.com|business wire)$/i.test(n.source)
      && /USDC|EURC|\bArc\b|Circle Internet|^Circle (?!Pharma|K\b|Health)|(with|in|and|by|from|,) Circle\b/.test(n.title)
      && !/Circle (Pharma|K\b|Health|Model)|(Donor|Harraden) Circle|\b[Tt]erms\b/.test(n.title))
    .map((n) => ({ ...n, title: n.title.replace(/^Circle Internet Group, Inc\. - /, '') })), 30);
  const officialTitles = new Set(official.map((n) => n.title));
  return {
    at: new Date().toISOString(),
    official,
    kr: dedupe(v(kr)),
    en: dedupe(v(en).filter((n) => !officialTitles.has(n.title))),
    filings: v(filings),
    failed: Object.entries({ kr, en, bw, site, filings }).filter(([, r]) => !r.ok).map(([k]) => k),
    notes,
  };
}

// 이번에 비어 있는 항목은 마지막으로 성공한 결과로 채운다(최대 7일)
function mergeLastGood(cur, last) {
  if (!last) return cur;
  const stale = [];
  for (const k of ['official', 'kr', 'en', 'filings']) {
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

const json = (obj, headers = {}, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname !== '/news') return new Response('Circle Watch news proxy · GET /news', { headers: cors });
    // 등록된 화면(GitHub Pages·로컬)에서 온 요청만 받는다
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('forbidden', { status: 403 });

    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/news`);
    const lastKey = new Request(`${url.origin}/news-last-good`);
    // fresh(새로고침 버튼)여도 1분 안에 받아 둔 결과가 있으면 그대로 쓴다
    let res = await cache.match(cacheKey);
    if (res && url.searchParams.has('fresh')) {
      const at = Date.parse((await res.clone().json()).at || 0);
      if (!(Date.now() - at < 60000)) res = null;
    }
    if (!res) {
      let data;
      try {
        data = await buildNews();
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
  },
};
