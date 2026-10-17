// Cloudflare Pages: /dividend-etf — 배당 ETF 비교(SCHD·VYM·DGRO·JEPI·JEPQ · 국내 상장 미국배당다우존스·커버드콜)
// 검색으로 들어오는 공개 페이지. 숫자는 대시보드 배당금 계산과 같은 자료(/api/dividends · 최근 1년 실제 배당). 6시간 캐시.
import { SITE, esc, krDay, fill, respond } from '../worker/ssr.js';

const GROUPS = [
  ['미국 배당 성장 ETF', '오래 배당을 늘려 온 우량 기업에 나눠 투자해요. 배당률은 중간이지만 배당이 해마다 늘어나는 편이에요.', [
    ['SCHD', '슈왑 미국 배당 ETF', '다우존스 미국 배당 100 지수. 10년 넘게 배당을 준 기업 중 재무가 튼튼한 100곳.'],
    ['VYM', '뱅가드 고배당 ETF', '배당률이 높은 미국 대형주 약 500곳에 넓게 투자.'],
    ['DGRO', '아이셰어즈 배당 성장 ETF', '5년 이상 배당을 늘려 온 기업. 배당률은 낮지만 성장 위주.'],
  ]],
  ['커버드콜(월배당) ETF', '주식을 들고 콜옵션을 팔아 받은 돈을 매달 나눠 줘요. 배당률이 높은 대신 주가가 크게 오를 때 덜 오르고, 배당 금액이 달마다 바뀌어요.', [
    ['JEPI', 'JP모간 프리미엄 인컴 ETF', 'S&P500 저변동 주식 + 콜옵션 매도. 월배당.'],
    ['JEPQ', 'JP모간 나스닥 프리미엄 인컴 ETF', '나스닥100 주식 + 콜옵션 매도. 월배당, JEPI보다 성장주 비중이 커요.'],
  ]],
  ['국내 상장 미국 배당 ETF', '원화로 한국 증권사에서 사는 ETF예요. SCHD와 같은 지수를 따라가는 상품이 많고, 매달 분배금을 줘요. ISA·연금저축에서도 살 수 있어요.', [
    ['458730.KS', 'TIGER 미국배당다우존스', 'SCHD와 같은 다우존스 미국 배당 100 지수. 월분배.'],
    ['446720.KS', 'SOL 미국배당다우존스', 'SCHD와 같은 지수. 월분배.'],
    ['489250.KS', 'KODEX 미국배당다우존스', 'SCHD와 같은 지수. 월분배.'],
    ['441640.KS', 'KODEX 미국배당커버드콜액티브', '미국 배당주 + 콜옵션 매도. 월분배, 배당률이 높은 편.'],
  ]],
];
const FAQ = [
  ['SCHD와 TIGER 미국배당다우존스는 뭐가 다른가요?', '둘 다 다우존스 미국 배당 100 지수를 따라가요. SCHD는 미국 증권거래소에서 달러로 사고 분기마다 배당을 주며, 배당에서 미국 세금 15%가 빠지고 팔 때 이익은 250만원 공제 뒤 22% 양도세예요. TIGER·SOL·KODEX 미국배당다우존스는 한국에서 원화로 사고 매달 분배금을 주며, 분배금·매매차익에 15.4%가 붙지만 ISA·연금저축 안에서 사면 세금을 크게 줄일 수 있어요.'],
  ['JEPI·JEPQ 같은 커버드콜 ETF는 괜찮은가요?', '배당률이 높아 매달 현금 흐름을 원할 때 많이 써요. 다만 콜옵션을 팔아서 주가가 크게 오를 때 덜 오르고, 하락장에서는 똑같이 빠질 수 있어요. 배당 금액도 매달 달라요. 오래 모아 갈 돈이라면 배당 성장 ETF와 섞는 경우가 많아요.'],
  ['표의 배당률은 어떻게 계산했나요?', '최근 1년 동안 실제로 준 배당(배당락일 기준)을 더해 지금 주가로 나눴어요. 배당 성장률은 최근 1년 배당을 5년 전(자료가 짧으면 3년 전) 1년 배당과 비교한 연평균 증가율이에요. 1천만원 넣으면 받는 월배당은 세금(미국 15%, 국내 15.4%)을 뺀 금액이에요.'],
  ['내 종목을 섞어서 계산해 볼 수 있나요?', '네. Fire Portfolio 대시보드의 적립식 배당 시뮬레이터에서 여러 ETF를 비중대로 넣고 매달 넣을 돈과 기간을 정하면, 몇 년 뒤 평가금액과 월배당을 그래프로 보여줘요. 무료이고 가입이 필요 없어요.'],
];
function stat(j, kr) {
  const ev = j?.events || [], now = Date.now(), y = (k) => ev.filter((e) => { const a = (now - Date.parse(e.ex)) / 86400000; return a >= k * 365 && a < (k + 1) * 365; }).reduce((s, e) => s + e.amt, 0);
  const ttm = y(0), n = ev.filter((e) => (now - Date.parse(e.ex)) / 86400000 < 365).length, y5 = y(5), y3 = y(3);
  const [base, yrs] = y5 > 0 ? [y5, 5] : y3 > 0 ? [y3, 3] : [0, 0];
  const price = j?.price;
  if (!(price > 0)) return null;
  const yld = ttm / price;
  return { price, yld, n, growth: base > 0 && ttm > 0 ? (ttm / base) ** (1 / yrs) - 1 : null, yrs, mon: (1e7 * yld * (1 - (kr ? 0.154 : 0.15))) / 12 };
}
const pctP = (v, d = 1) => (v == null || !isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`);
const won = (v) => (v == null ? '–' : `${Math.round(v / 1000) * 1000 >= 10000 ? (Math.round(v / 100) * 100).toLocaleString('ko-KR') : Math.round(v).toLocaleString('ko-KR')}원`);
const freq = (n) => (n >= 10 ? '월배당' : n >= 3 ? '분기' : n >= 1 ? `연 ${n}회` : '–');

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url), host = url.hostname;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const cache = caches.default, key = new Request(`${url.origin}/dividend-etf-page?v=1&d=${today}`);
  const hit = await cache.match(key);
  if (hit) return respond(await hit.text(), 200, host, 1800);
  const syms = GROUPS.flatMap((g) => g[2].map((x) => x[0]));
  const data = Object.fromEntries(await Promise.all(syms.map(async (s) => [s, await fetch(`${url.origin}/api/dividends?s=${encodeURIComponent(s)}`, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)])));
  const S = Object.fromEntries(syms.map((s) => [s, stat(data[s], s.endsWith('.KS'))]));
  const ok = Object.values(S).filter(Boolean).length;
  const go = '/?ref=page-dividend-etf#grow';
  const px = (s, v) => (s.endsWith('.KS') ? `${Math.round(v).toLocaleString('ko-KR')}원` : `$${v.toFixed(2)}`);
  const tbl = (rows) => `<div class="dl-tbl-wrap"><table class="dl-tbl"><thead><tr><th>ETF</th><th>배당률</th><th>배당 주기</th><th>배당 성장(연)</th><th>1천만원 → 월배당(세후)</th></tr></thead><tbody>
    ${rows.map(([s, n]) => { const x = S[s]; return `<tr><td><b>${esc(s.endsWith('.KS') ? n : s)}</b><small>${esc(s.endsWith('.KS') ? s.slice(0, 6) : n)}${x ? ` · ${px(s, x.price)}` : ''}</small></td><td>${x ? pctP(x.yld, 2) : '–'}</td><td>${x ? freq(x.n) : '–'}</td><td>${x?.growth != null ? `${pctP(x.growth)}<small>${x.yrs}년 평균</small>` : '–'}</td><td><b>${x ? won(x.mon) : '–'}</b></td></tr>`; }).join('')}
  </tbody></table></div>`;
  const rank = syms.filter((s) => S[s]).sort((a, b) => S[b].yld - S[a].yld);
  const growTop = syms.filter((s) => S[s]?.growth != null).sort((a, b) => S[b].growth - S[a].growth)[0];
  const nameOf = (s) => GROUPS.flatMap((g) => g[2]).find((x) => x[0] === s)?.[1] || s;
  const short = (s) => (s.endsWith('.KS') ? nameOf(s) : s);
  const body = `<section class="lp-hero">
  <p class="dl-when">${krDay(today)} 기준 · 매일 갱신 · 최근 1년 실제 배당</p>
  <h1>배당 ETF 비교 — SCHD·JEPI·JEPQ vs 국내 상장 미국배당다우존스</h1>
  <p class="lp-lead">많이 찾는 미국·국내 배당 ETF의 배당률, 배당 주기, 배당 성장률과 1천만원을 넣으면 매달 받는 배당(세후)을 한 표로 정리했어요.${rank.length ? ` 지금 배당률이 가장 높은 건 ${esc(short(rank[0]))}(${pctP(S[rank[0]].yld, 2)})${growTop ? `, 배당이 가장 빨리 늘고 있는 건 ${esc(short(growTop))}(연 ${pctP(S[growTop].growth)})` : ''}이에요.` : ''}</p>
  <p style="margin-top:14px"><a class="lp-cta" href="${go}">📈 섞어서 적립식으로 계산해 보기 →</a></p>
</section>
${GROUPS.map(([h, d, rows]) => `<section class="lp-sec"><h2>${esc(h)}</h2><p class="lp-note">${esc(d)}</p>${tbl(rows.map(([s, n]) => [s, n]))}<ul class="dl-news">${rows.map(([s, n, about]) => `<li><b>${esc(s.endsWith('.KS') ? n : `${s} · ${n}`)}</b> <small>${esc(about)}</small></li>`).join('')}</ul></section>`).join('\n')}
<section class="lp-sec"><h2>어떤 걸 고를까?</h2>
  <p><b>오래 모아 배당을 키우고 싶다면</b> SCHD·DGRO 같은 배당 성장 ETF가 잘 맞아요. 지금 배당률은 낮아도 10년 뒤 받는 배당이 커져요.</p>
  <p><b>지금 매달 현금이 필요하다면</b> JEPI·JEPQ·국내 커버드콜처럼 배당률이 높은 월배당 ETF를 많이 써요. 대신 주가 상승은 덜 따라가요.</p>
  <p><b>세금을 줄이고 싶다면</b> 같은 지수를 따라가는 국내 상장 ETF(TIGER·SOL·KODEX 미국배당다우존스)를 ISA·연금저축에서 사는 방법이 있어요. 어느 계좌가 유리한지는 <a href="etf-tax">미국 ETF 세금 비교 계산기</a>로 확인해 보세요.</p>
</section>
<section class="lp-sec"><h2>자주 묻는 질문</h2>${FAQ.map(([q, a]) => `<details class="lp-faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
<section class="lp-sec lp-end"><a class="lp-cta" href="${go}">🔥 Fire Portfolio에서 적립식 배당 시뮬레이션 →</a><p class="lp-note"><a href="portfolio">배당 포트폴리오 계산기</a> · <a href="grow">적립식 배당 시뮬레이터</a> · <a href="etf-tax">미국 ETF 세금 비교</a></p><p class="lp-note">자료: Yahoo Finance(배당 기록·주가). 배당은 바뀔 수 있고 과거 배당이 미래를 보장하지 않아요. 투자 조언이 아니에요.</p></section>`;
  const title = `배당 ETF 비교 — SCHD·JEPI·JEPQ·TIGER 미국배당다우존스 배당률·월배당 (${today.slice(5).replace('-', '/')})`;
  const desc = `SCHD·VYM·DGRO·JEPI·JEPQ와 국내 상장 TIGER·SOL·KODEX 미국배당다우존스의 최근 1년 배당률, 배당 주기, 배당 성장률, 1천만원 투자 시 월배당(세후)을 매일 비교해요.`;
  const html = fill({ title, desc, body, canon: `${SITE}dividend-etf`, ld: [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url: `${SITE}dividend-etf`, inLanguage: 'ko', dateModified: today },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] });
  if (ok >= syms.length - 2) waitUntil(cache.put(key, new Response(html, { headers: { 'cache-control': 'public, max-age=21600' } })));
  return respond(html, 200, host, 1800);
}
