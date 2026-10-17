// Cloudflare Pages: /money-flow — 빚투(신용융자)·고객예탁금·미국 신용잔고로 본 증시 과열 신호 · 지표 쉬운 설명
// 검색으로 들어오는 공개 페이지. 숫자는 대시보드 '시장 자금 동향'과 같은 자료(/api/flow · data/us-margin.json). 1시간 캐시.
import { SITE, esc, nf, pctS, krDay, md, fill, respond } from '../worker/ssr.js';

const jo = (v) => (v == null ? '–' : v >= 10000 ? `${(v / 1e4).toFixed(1)}조원` : `${nf(v)}억원`); // 억원 단위 입력
const usT = (m) => (m == null ? '–' : `${(m / 1e6).toFixed(2)}조 달러`); // 백만 달러 입력
const FAQ = [
  ['신용융자 잔고가 뭔가요?', '증권사에서 돈을 빌려 주식을 산 금액(빚투)이에요. 늘어나면 빚을 내서라도 오를 거라고 보는 사람이 많다는 뜻이고, 너무 빨리 늘면 과열 신호로 봐요. 주가가 크게 빠지면 담보가 부족해져 증권사가 강제로 파는 반대매매가 나와 하락이 더 커질 수 있어요.'],
  ['고객예탁금은 뭔가요?', '주식을 사려고 증권 계좌에 넣어 두고 아직 쓰지 않은 현금이에요. 늘면 주식을 살 여력이 많아진다는 뜻이고, 줄면 돈이 증시에서 빠져나가고 있다는 뜻이에요.'],
  ['미국 신용잔고(마진 부채)는 왜 보나요?', '미국 투자자들이 증권사에서 빌린 돈의 합계예요(FINRA 집계, 매달 발표). 역사적으로 2000년·2007년·2021년처럼 사상 최고치를 크게 넘어선 뒤 증시 조정이 온 적이 많아서 대표적인 과열 지표로 써요.'],
  ['이 지표만 보고 사고팔아도 되나요?', '아니요. 빚투가 많다는 건 위험이 쌓였다는 신호일 뿐, 언제 떨어질지는 알려 주지 않아요. 금리·실적·수급과 함께 참고용으로 보세요. 투자 조언이 아니에요.'],
];
function verdict(R) {
  const n = R.length, L = R[n - 1], back = (k) => R[Math.max(0, n - 1 - k)];
  const rank = (arr, v) => arr.filter((x) => x <= v).length / arr.length;
  const cr = R.map((r) => r[2]), ratio = R.map((r) => r[2] / r[1]);
  const c = { cr: L[2], dep: L[1], cr60: L[2] / back(60)[2] - 1, cr250: L[2] / back(250)[2] - 1, dep60: L[1] / back(60)[1] - 1, crPct: rank(cr, L[2]), ratioPct: rank(ratio, L[2] / L[1]), years: Math.max(1, Math.round(n / 245)) };
  let sc = 0;
  sc += c.crPct >= 0.9 ? 2 : c.crPct >= 0.75 ? 1 : 0;
  sc += c.cr60 >= 0.1 ? 2 : c.cr60 >= 0.05 ? 1 : 0;
  sc += c.cr250 >= 0.3 ? 2 : c.cr250 >= 0.15 ? 1 : 0;
  sc += c.ratioPct >= 0.9 ? 2 : c.ratioPct >= 0.75 ? 1 : 0;
  sc += c.dep60 <= -0.05 ? 1 : 0;
  c.lv = sc >= 5 ? ['🔴', '과열 · 위험해 보여요'] : sc >= 3 ? ['🟠', '주의 · 빚투가 꽤 늘었어요'] : sc >= 1 ? ['🟡', '보통 · 조금 뜨거운 편'] : ['🟢', '안정 · 빚투가 적어요'];
  return c;
}
function chart(series, label, color, fmt, w = 640, h = 170) {
  const P = series.filter((p) => p[1] != null);
  if (P.length < 2) return '';
  const v = P.map((p) => p[1]), lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const X = (i) => (i / (P.length - 1)) * w, Y = (y) => h - 22 - ((y - lo) / r) * (h - 40);
  const line = P.map((p, i) => `${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label)}" style="display:block">
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="0" y="${h - 4}" font-size="12" fill="#8a94a3">${esc(String(P[0][0]).slice(0, 7).replace('-', '.'))}</text><text x="${w}" y="${h - 4}" font-size="12" fill="#8a94a3" text-anchor="end">${esc(String(P.at(-1)[0]).slice(0, 7).replace('-', '.'))}</text>
    <text x="${w}" y="14" font-size="12" fill="#8a94a3" text-anchor="end">최고 ${esc(fmt(hi))} · 최저 ${esc(fmt(lo))}</text></svg>`;
}

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url), host = url.hostname;
  const cache = caches.default, key = new Request(`${url.origin}/money-flow-page?v=1`);
  const hit = await cache.match(key);
  if (hit) return respond(await hit.text(), 200, host, 900);
  const [F, H] = await Promise.all([
    fetch(`${url.origin}/api/flow`, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${url.origin}/data/us-margin.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const go = '/?ref=page-money-flow#flow';
  if (!F?.rows?.length) return respond(fill({ title: '증시 자금 동향 — 신용융자·고객예탁금', desc: '빚투 과열 신호', canon: `${SITE}money-flow`, ld: null, body: `<section class="lp-hero"><h1>잠시 후 다시 열어 주세요</h1><p class="lp-lead">자료를 받지 못했어요.</p><a class="lp-cta" href="${go}">대시보드 열기 →</a></section>` }), 503, host);
  const R = F.rows, c = verdict(R), last = R.at(-1)[0];
  const us = [...new Map([...(H?.rows || []), ...(F.us || [])].map((x) => [x[0], x])).values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const uL = us.at(-1), uMax = us.slice(0, -1).reduce((m, x) => Math.max(m, x[1]), 0), uY = us.find((x) => x[0] === `${+uL?.[0].slice(0, 4) - 1}${uL?.[0].slice(4)}`);
  const usAth = uL && uL[1] >= uMax;
  const I = F.inv?.KOSPI;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const body = `<section class="lp-hero">
  <p class="dl-when">${krDay(today)} 기준 · 매일 갱신 · 국내 자료는 ${md(last)} 집계</p>
  <h1>증시 빚투 지표 — 신용융자 잔고·고객예탁금으로 본 과열 신호</h1>
  <p class="lp-lead">빚내서 산 주식(신용융자)과 주식 살 대기 자금(고객예탁금), 미국 신용잔고를 매일 정리해 지금 시장이 얼마나 뜨거운지 보여줘요.</p>
  <div class="dl-grid">
    <div><span>지금 분위기</span><b>${c.lv[0]} ${esc(c.lv[1])}</b><small>신용융자 최근 ${c.years}년 중 상위 ${Math.max(1, Math.round((1 - c.crPct) * 100))}%</small></div>
    <div><span>신용융자 잔고</span><b>${jo(c.cr)}</b><small>3개월 ${pctS(c.cr60)} · 1년 ${pctS(c.cr250)}</small></div>
    <div><span>고객예탁금</span><b>${jo(c.dep)}</b><small>3개월 ${pctS(c.dep60)}</small></div>
    <div><span>미국 신용잔고</span><b>${uL ? usT(uL[1]) : '–'}</b><small>${uL ? `${uL[0].replace('-', '.')} · ${usAth ? '사상 최고' : `최고 대비 ${pctS(uL[1] / uMax - 1)}`}${uY ? ` · 1년 ${pctS(uL[1] / uY[1] - 1)}` : ''}` : ''}</small></div>
  </div>
  <p style="margin-top:14px"><a class="lp-cta" href="${go}">차트로 자세히 보기 →</a></p>
</section>
<section class="lp-sec"><h2>신용융자 잔고 (최근 1년)</h2><div class="dl-chart">${chart(R.slice(-250).map((r) => [r[0], r[2]]), '신용융자 잔고', '#f04452', jo)}</div>
  <p class="lp-note">증권사에서 빌린 돈으로 산 주식 금액이에요. 빠르게 늘면 과열, 갑자기 꺾이면 반대매매·청산 구간인 경우가 많아요.</p></section>
<section class="lp-sec"><h2>고객예탁금 (최근 1년)</h2><div class="dl-chart">${chart(R.slice(-250).map((r) => [r[0], r[1]]), '고객예탁금', '#3fbf7f', jo)}</div>
  <p class="lp-note">증권 계좌에 넣어 둔 현금이에요. 늘면 살 여력이 많아지고, 줄면 돈이 빠져나가는 중이에요.</p></section>
${us.length ? `<section class="lp-sec"><h2>미국 신용잔고 (FINRA, 2015년부터)</h2><div class="dl-chart">${chart(us.filter((x) => x[0] >= '2015-01'), '미국 신용잔고', '#f2994a', usT)}</div>
  <p class="lp-note">미국 투자자들이 증권사에서 빌린 돈의 합계예요. 2000년·2007년·2021년처럼 사상 최고치를 크게 넘어선 뒤 조정이 온 적이 많아요.</p></section>` : ''}
${I ? `<section class="lp-sec"><h2>오늘 코스피 투자자별 순매수</h2><p>개인 <b>${I.p > 0 ? '+' : ''}${jo(I.p)}</b> · 외국인 <b>${I.f > 0 ? '+' : ''}${jo(I.f)}</b> · 기관 <b>${I.i > 0 ? '+' : ''}${jo(I.i)}</b></p><p class="lp-note">외국인·기관이 팔 때 개인만 크게 사고 신용융자까지 늘면, 개인의 빚투로 버티는 장일 수 있어요.</p></section>` : ''}
<section class="lp-sec"><h2>자주 묻는 질문</h2>${FAQ.map(([q, a]) => `<details class="lp-faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
<section class="lp-sec lp-end"><a class="lp-cta" href="${go}">🔥 Fire Portfolio 대시보드 열기 →</a><p class="lp-note">자료: 금융투자협회 집계(네이버 증권), FINRA. 국내 자료는 하루 늦게 발표돼요. 투자 조언이 아니에요.</p></section>`;
  const title = `증시 빚투 지표 — 신용융자 ${jo(c.cr)}·고객예탁금 ${jo(c.dep)} (${md(last)})`;
  const desc = `신용융자 잔고 ${jo(c.cr)}(1년 ${pctS(c.cr250)}), 고객예탁금 ${jo(c.dep)}, 미국 신용잔고 ${uL ? usT(uL[1]) : '–'}. 빚투 과열 신호와 지표의 뜻을 매일 쉽게 정리해요. 지금 판단: ${c.lv[1]}.`;
  const html = fill({ title, desc, body, canon: `${SITE}money-flow`, ld: [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url: `${SITE}money-flow`, inLanguage: 'ko', dateModified: today },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] });
  waitUntil(cache.put(key, new Response(html, { headers: { 'cache-control': 'public, max-age=3600' } })));
  return respond(html, 200, host, 900);
}
