// Cloudflare Pages: /stablecoin — 스테이블코인 시장 한눈에(발행사 순위·USDC 추이·체인별 분포·서클 수익 구조·쉬운 설명)
// 숫자는 대시보드와 같은 데이터(/api/data)를 서버에서 바로 채워 넣는다 → 검색엔진도 숫자를 읽는다. 10분 캐시.
import { SITE, esc, nf, usdKo, pctS, ppS, pctP, tone, krDay, md, fill, respond } from '../worker/ssr.js';

const CHAIN_KO = { ETH: '이더리움', SOL: '솔라나', BASE: '베이스', ARB: '아비트럼', HYPEREVM: '하이퍼리퀴드(HyperEVM)', POLYGON: '폴리곤', AVAX: '아발란체', OP: '옵티미즘', TRON: '트론', NOBLE: '노블(코스모스)', SUI: '수이', APTOS: '앱토스', STELLAR: '스텔라', ALGO: '알고랜드', NEAR: '니어', ARC: 'Arc(서클)', UNICHAIN: '유니체인', WORLDCHAIN: '월드체인', LINEA: '리니아', SEI: '세이', ZKSYNC: 'zkSync', CELO: '셀로' };
const FAQ = [
  ['스테이블코인이 뭔가요?', '가격이 1달러처럼 법정화폐에 고정되도록 만든 디지털 화폐예요. 발행사가 맡긴 돈만큼 현금·단기 국채 같은 준비금을 쌓아 두고, 원하면 1:1로 돌려주는 구조라 가격이 거의 움직이지 않아요. 코인 거래, 해외 송금, 결제에 많이 쓰여요.'],
  ['USDT와 USDC는 뭐가 다른가요?', 'USDT는 테더(Tether)가, USDC는 미국 상장사 서클(Circle, CRCL)이 발행해요. 둘 다 1달러를 따라가지만, USDC는 미국 규제 아래에서 준비금을 현금과 단기 미 국채로 두고 정기적으로 회계 법인 확인을 받아 공개하는 점을 강점으로 내세워요. 발행량은 USDT가 더 크고, USDC는 2위예요.'],
  ['서클은 어떻게 돈을 버나요?', 'USDC를 발행하면서 받은 달러를 단기 미 국채 등에 넣어 두고 그 이자로 돈을 벌어요. 그래서 USDC 유통량이 늘수록, 금리가 높을수록 수익이 커져요. 다만 이자 수익의 상당 부분은 코인베이스 같은 유통 파트너와 나눠요.'],
  ['USDC 유통량은 왜 중요한가요?', '서클 매출의 대부분이 USDC 준비금에서 나오는 이자라서, 유통량이 서클 실적을 가늠하는 가장 직접적인 숫자예요. 이 페이지와 대시보드에서 매일 변화를 볼 수 있어요.'],
  ['데이터는 어디서 가져오나요?', '서클 공식 API(USDC·EURC 발행량·체인별 분포), DefiLlama(스테이블코인 전체·발행사별), 미 재무부(단기 국채 금리)에서 가져와요. 지연·오류가 있을 수 있고 투자 조언이 아니에요.'],
];

function lineChart(series, w = 640, h = 180) {
  const pts0 = (series || []).filter((p) => p[1] != null);
  if (pts0.length < 2) return '';
  const v = pts0.map((p) => p[1]), lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const X = (i) => (i / (pts0.length - 1)) * w, Y = (y) => h - 22 - ((y - lo) / r) * (h - 40);
  const line = pts0.map((p, i) => `${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const d0 = new Date(pts0[0][0] * 1000).toISOString().slice(0, 10), d1 = new Date(pts0.at(-1)[0] * 1000).toISOString().slice(0, 10);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="USDC 유통량 추이" style="display:block">
    <polygon points="0,${h - 22} ${line} ${w},${h - 22}" fill="rgba(91,155,255,.12)"/>
    <polyline points="${line}" fill="none" stroke="#5b9bff" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="0" y="${h - 4}" font-size="12" fill="#8a94a3">${d0.slice(0, 7).replace('-', '.')}</text><text x="${w}" y="${h - 4}" font-size="12" fill="#8a94a3" text-anchor="end">${d1.slice(0, 7).replace('-', '.')}</text>
    <text x="${w}" y="14" font-size="12" fill="#8a94a3" text-anchor="end">최고 ${usdKo(hi)} · 최저 ${usdKo(lo)}</text></svg>`;
}

function page(D, dailyLatest) {
  const S = D.stables || {}, rows = (S.rows || []).filter((r) => r.supply > 0).sort((a, b) => b.supply - a.supply);
  const prev = (r, k) => (r[k] != null ? r.supply / (1 + r[k]) : r.supply);
  const total = S.totalUsd ?? rows.reduce((a, r) => a + r.supply, 0);
  const tot1 = rows.reduce((a, r) => a + r.supply, 0) / rows.reduce((a, r) => a + prev(r, 'ch1'), 0) - 1;
  const tot7 = rows.reduce((a, r) => a + r.supply, 0) / rows.reduce((a, r) => a + prev(r, 'ch7'), 0) - 1;
  const usdt = rows.find((r) => r.sym === 'USDT'), usdc = rows.find((r) => r.sym === 'USDC');
  const C = D.circle || {}, ser = D.series?.usdc || [];
  const usdcNow = C.usdcTotal ?? usdc?.supply;
  const at = (days) => ser.filter(([t]) => t * 1000 <= Date.now() - days * 86400e3 + 3600e3).at(-1)?.[1];
  const y1 = at(365), d30 = at(30), d7 = at(7);
  const chains = (C.usdcChains || []).map((c) => ({ name: CHAIN_KO[String(c.chain).toUpperCase()] || c.chain, v: c.amount ?? c.usd ?? 0 })).filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
  const chainTot = chains.reduce((a, c) => a + c.v, 0) || 1;
  const rate = D.rates?.latest?.[1];
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const KW = /stablecoin|usdc|usdt|tether|circle|스테이블|테더|서클|genius/i;
  const news = [...(D.news?.kr || []), ...(D.news?.en || []), ...(D.news?.official || [])].filter((n) => KW.test(n.title || '')).sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, 6);
  const go = '/?ref=page-stablecoin';
  const body = `<section class="lp-hero">
  <p class="dl-when">${krDay(today)} 기준 · 매일 갱신</p>
  <h1>스테이블코인 시가총액 · USDC 유통량 한눈에</h1>
  <p class="lp-lead">USDT·USDC 등 달러 스테이블코인이 지금 얼마나 발행됐는지, 누가 얼마나 차지하는지, 서클(CRCL)의 USDC는 어디서 얼마나 쓰이는지 매일 숫자로 정리해요.</p>
  <div class="dl-grid">
    <div><span>달러 스테이블코인 전체</span><b>${usdKo(total)}</b><small><span class="${tone(tot1)}">1일 ${pctS(tot1, 2)}</span> · <span class="${tone(tot7)}">7일 ${pctS(tot7, 2)}</span></small></div>
    <div><span>USDC 유통량(서클 공식)</span><b>${usdKo(usdcNow)}</b><small><span class="${tone(d7 ? usdcNow / d7 - 1 : null)}">7일 ${pctS(d7 ? usdcNow / d7 - 1 : null, 2)}</span></small></div>
    <div><span>USDT 점유율</span><b>${pctP(usdt?.share)}</b><small>${usdKo(usdt?.supply)}</small></div>
    <div><span>USDC 점유율</span><b>${pctP(usdc?.share ?? S.usdcShare)}</b><small>2위 · 서클 발행</small></div>
  </div>
  <p style="margin-top:14px"><a class="lp-cta" href="${go}#usdc">실시간 USDC 대시보드 열기 →</a></p>
</section>
<section class="lp-sec"><h2>발행사 순위</h2>
  <div class="div-scroll"><table class="dl-tbl"><thead><tr><th>#</th><th>코인 · 발행사</th><th>발행량</th><th>점유율</th><th>1일</th><th>7일</th><th>30일</th></tr></thead><tbody>
  ${rows.slice(0, 11).map((r, i) => `<tr${r.sym === 'USDC' ? ' class="hl"' : ''}><td>${i + 1}</td><td><b>${esc(r.sym)}</b><small>${esc(String(r.issuer || '').split(' · ')[0])}</small></td><td>${usdKo(r.supply)}</td><td>${pctP(r.share)}</td><td class="${tone(r.ch1)}">${pctS(r.ch1)}</td><td class="${tone(r.ch7)}">${pctS(r.ch7)}</td><td class="${tone(r.ch30)}">${pctS(r.ch30)}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="lp-note">달러에 연동된 주요 스테이블코인 기준(DefiLlama). 서클은 유로 스테이블코인 EURC(${usdKo((S.products || []).find((p) => p.sym === 'EURC')?.supply)} 상당)와 토큰화 머니마켓펀드 USYC도 발행해요.</p>
</section>
<section class="lp-sec"><h2>USDC 유통량 추이</h2>
  <div class="dl-chart">${lineChart(ser.slice(-400))}</div>
  <div class="dl-grid" style="margin-top:8px">
    <div><span>1년 전 대비</span><b class="${tone(y1 ? usdcNow / y1 - 1 : null)}">${pctS(y1 ? usdcNow / y1 - 1 : null)}</b><small>${y1 ? `${usdKo(y1)} → ${usdKo(usdcNow)}` : ''}</small></div>
    <div><span>최근 30일</span><b class="${tone(d30 ? usdcNow / d30 - 1 : null)}">${pctS(d30 ? usdcNow / d30 - 1 : null)}</b><small>${d30 ? `순${usdcNow >= d30 ? '발행' : '소각'} ${usdKo(Math.abs(usdcNow - d30))}` : ''}</small></div>
  </div>
</section>
<section class="lp-sec"><h2>USDC는 어느 블록체인에 있나</h2>
  <ul class="dl-bars">${chains.slice(0, 8).map((c) => `<li><span>${esc(c.name)}</span><i style="width:${Math.max(2, (c.v / chains[0].v) * 100)}%"></i><b>${pctP(c.v / chainTot)}</b></li>`).join('')}</ul>
  <p class="lp-note">서클 공식 API의 체인별 발행량 기준. 결제·송금이 많은 체인일수록 비중이 커요.</p>
</section>
<section class="lp-sec"><h2>서클은 USDC로 어떻게 돈을 버나</h2>
  <div class="dl-grid">
    <div><span>미 국채 13주 금리</span><b>${rate != null ? (rate * 100).toFixed(2) + '%' : '–'}</b><small>준비금 이자의 기준(미 재무부)</small></div>
    <div><span>단순 계산한 연 이자 규모</span><b>${rate != null && usdcNow ? usdKo(usdcNow * rate) : '–'}</b><small>USDC 유통량 × 금리</small></div>
  </div>
  <p class="lp-note">USDC를 발행하며 받은 달러를 단기 국채 등에 넣어 이자를 벌어요. 실제 매출은 준비금 구성·시점에 따라 다르고, 이자의 상당 부분을 코인베이스 등 유통 파트너와 나눠요. 위 숫자는 이해를 돕기 위한 단순 계산이에요.</p>
</section>
${news.length ? `<section class="lp-sec"><h2>최근 스테이블코인 뉴스</h2><ul class="dl-news">${news.map((n) => `<li><a href="${esc(n.url || '#')}" target="_blank" rel="noopener nofollow">${esc(n.title)}<small>${esc(n.source || '')} · ${md(String(n.t).slice(0, 10))}</small></a></li>`).join('')}</ul></section>` : ''}
<section class="lp-sec"><h2>매일 정리해 드려요</h2>
  <p class="lp-lead" style="font-size:15px">${dailyLatest ? `최근 기록: <a href="/daily/${dailyLatest.day}">${md(dailyLatest.day)} · ${esc(dailyLatest.headline)}</a><br>` : ''}<a href="/daily">오늘의 스테이블코인 기록 전체 보기 →</a> · 인스타그램·X <b>@myfireportfolio</b></p>
</section>
<section class="lp-sec"><h2>자주 묻는 질문</h2>${FAQ.map(([q, a]) => `<details class="lp-faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
<section class="lp-sec lp-end"><a class="lp-cta" href="${go}">🔥 Fire Portfolio 대시보드 열기 →</a><p class="lp-note">서클(CRCL) 주가·공매도·기관 보유, Arc 체인 지표도 함께 볼 수 있어요. 무료 · 가입 없음 · 투자 조언 아님.</p></section>`;
  const title = '스테이블코인 시가총액·USDC 유통량 — USDT·USDC 점유율과 발행사 순위';
  const desc = `달러 스테이블코인 전체 ${usdKo(total)}, USDT 점유율 ${pctP(usdt?.share)}, USDC 유통량 ${usdKo(usdcNow)}(점유율 ${pctP(usdc?.share ?? S.usdcShare)}). 발행사 순위, USDC 1년 추이, 체인별 분포, 서클 수익 구조를 매일 정리해요.`;
  return fill({ title, desc, body, canon: `${SITE}stablecoin`, ld: [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url: `${SITE}stablecoin`, inLanguage: 'ko', dateModified: today },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] });
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url), host = url.hostname;
  const cache = caches.default, key = new Request(`${url.origin}/stablecoin?v=1`);
  const hit = await cache.match(key);
  if (hit) return respond(await hit.text(), 200, host, 600);
  const r = await fetch(`${url.origin}/api/data`, { headers: { accept: 'application/json' } }).catch(() => null);
  const D = r?.ok ? await r.json().catch(() => null) : null;
  if (!D?.stables) return respond(fill({ title: '스테이블코인 한눈에', desc: '스테이블코인 시가총액·USDC 유통량', canon: `${SITE}stablecoin`, ld: null, body: '<section class="lp-hero"><h1>잠시 후 다시 열어 주세요</h1><p class="lp-lead">데이터를 받지 못했어요.</p><a class="lp-cta" href="/?ref=page-stablecoin#usdc">대시보드 열기 →</a></section>' }), 503, host);
  const idx = (await env.SUMS?.get('daily:index', 'json').catch(() => null)) || [];
  const html = page(D, idx[0]);
  waitUntil(cache.put(key, new Response(html, { headers: { 'cache-control': 'public, max-age=600' } })));
  return respond(html, 200, host, 600);
}
