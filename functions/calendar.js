// Cloudflare Pages: /calendar — 이번 주·다음 주 미국·한국 주요 경제지표 발표 일정(한국 시간) · 지표 쉬운 설명
// 검색으로 들어오는 공개 페이지. 일정은 대시보드 '이번 주 일정'과 같은 자료(네이버 증권 증시 캘린더). 1시간 캐시.
import { SITE, esc, krDay, md, fill, respond } from '../worker/ssr.js';
import { buildCalendar } from '../worker/news-proxy.js';

const ABOUT = [
  ['FOMC 금리 결정', '미국 중앙은행(연준)이 기준금리를 올리거나 내리거나 그대로 두는 회의 결과예요. 1년에 8번 있고, 발표는 한국 시간 새벽 3시쯤이에요. 금리가 내려가면 보통 성장주·코인에 우호적이고, 올라가면 부담이 돼요. 발표 뒤 의장 기자회견 발언도 시장을 크게 움직여요.'],
  ['CPI(소비자물가)', '소비자가 사는 물건·서비스 가격이 1년 전보다 얼마나 올랐는지 보여줘요. 매달 중순 한국 시간 밤 9시 30분(서머타임 해제 땐 10시 30분)에 나와요. 예상보다 높으면 금리 인하 기대가 줄어 주가가 흔들리기 쉬워요.'],
  ['PPI(생산자물가)', '기업이 물건을 만들 때 드는 가격 변화예요. 보통 CPI 하루 이틀 뒤에 나오고, 앞으로 소비자물가가 어떻게 움직일지 미리 보여주는 신호로 봐요.'],
  ['고용보고서(비농업 고용)', '매달 첫째 금요일에 나오는, 농업을 뺀 일자리가 한 달 동안 몇 개 늘었는지예요. 실업률도 같이 나와요. 너무 강하면 금리 인하가 늦어질 수 있고, 너무 약하면 경기 걱정이 커져요.'],
  ['PCE 물가', '연준이 가장 중요하게 보는 물가 지표예요. CPI보다 범위가 넓어서 금리 결정에 직접 쓰여요. 매달 말에 나와요.'],
  ['GDP 성장률', '나라 경제 전체가 얼마나 성장했는지예요. 분기마다 속보치·잠정치·확정치로 세 번 나와요.'],
  ['소매판매', '소비자들이 물건을 얼마나 샀는지예요. 미국 경제의 70% 가까이가 소비라서 경기 흐름을 보는 핵심 지표예요.'],
  ['실업수당 청구', '매주 목요일에 나오는, 새로 실업수당을 신청한 사람 수예요. 고용 시장이 식는지 빨리 보여줘요.'],
  ['한국은행 금리 결정', '한국은행 금융통화위원회의 기준금리 결정이에요. 원·달러 환율과 국내 증시에 영향을 줘요.'],
];
const FAQ = [
  ['경제지표 발표 시각은 한국 시간으로 언제인가요?', '미국 지표는 대부분 한국 시간 밤 9시 30분이나 11시에 나와요(미국 서머타임이 끝나는 11월 첫째 주부터 3월까지는 1시간씩 늦어져요). FOMC 금리 결정은 한국 시간 새벽 3시(서머타임 해제 땐 4시)예요. 이 페이지의 시각은 모두 한국 시간이에요.'],
  ['어떤 지표가 가장 중요한가요?', 'FOMC 금리 결정, CPI(소비자물가), 고용보고서가 시장을 가장 크게 움직여요. 이 세 가지는 이 페이지에서 주황색으로 표시해요.'],
  ['내 보유 종목 실적 발표일도 볼 수 있나요?', '네. Fire Portfolio 대시보드 홈의 "이번 주 일정"에서 경제지표와 함께 내 종목 실적 발표일, 배당 입금일까지 한 번에 보여줘요. 무료이고 가입이 필요 없어요.'],
];
const KST = () => new Date(Date.now() + 9 * 3600000);
function weekOf(offset) {
  const d = KST(), wd = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((wd + 6) % 7) + offset * 7);
  const from = d.toISOString().slice(0, 10);
  return { from, to: new Date(Date.parse(from + 'T12:00:00Z') + 6 * 86400000).toISOString().slice(0, 10) };
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function weekHtml(title, W, events, today) {
  const days = {};
  for (const e of events) (days[e.d] ||= []).push(e);
  const keys = Object.keys(days).sort();
  return `<section class="lp-sec"><h2>${title} <small style="font-weight:600;color:#8a94a3">${md(W.from)} ~ ${md(W.to)}</small></h2>
    ${keys.length ? keys.map((d) => `<h3>${md(d)} (${WD[new Date(d + 'T12:00:00Z').getUTCDay()]})${d === today ? ' · 오늘' : ''}</h3><ul class="dl-news">${days[d].map((e) => `<li><b${e.w >= 3 ? ' style="color:#f2994a"' : ''}>${e.t ? `${esc(e.t)} · ` : ''}${e.n === 'KR' ? '🇰🇷 ' : '🇺🇸 '}${esc(e.k)}</b> <small>${e.v ? `${e.done ? '발표' : '이전'} ${esc(e.v)} · ` : ''}${esc(e.title)}</small></li>`).join('')}</ul>`).join('') : '<p class="lp-note">이 주에는 큰 지표 발표가 없어요.</p>'}
  </section>`;
}

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url), host = url.hostname;
  const cache = caches.default, key = new Request(`${url.origin}/calendar-page?v=1&w=${weekOf(0).from}`);
  const hit = await cache.match(key);
  if (hit) return respond(await hit.text(), 200, host, 900);
  const wd = KST().getUTCDay(), weekend = wd === 6 || wd === 0;
  const A = weekOf(weekend ? 1 : 0), B = weekOf(weekend ? 2 : 1);
  const [a, b] = await Promise.all([buildCalendar(A.from, A.to).catch(() => null), buildCalendar(B.from, B.to).catch(() => null)]);
  const today = KST().toISOString().slice(0, 10);
  const all = [...(a?.events || []), ...(b?.events || [])];
  const big = all.filter((e) => e.w >= 3 && e.d >= today).slice(0, 3);
  const go = '/?ref=page-calendar';
  const body = `<section class="lp-hero">
  <p class="dl-when">${krDay(today)} 기준 · 매일 갱신 · 한국 시간</p>
  <h1>이번 주 미국 경제지표 발표 일정 — CPI·PPI·FOMC·고용보고서</h1>
  <p class="lp-lead">주가를 크게 움직이는 미국·한국 경제지표가 언제 나오는지 한국 시간으로 정리했어요. 발표가 끝난 지표는 실제 발표 값도 함께 보여줘요.${big.length ? ` 다가오는 큰 일정: ${big.map((e) => `${md(e.d)} ${esc(e.k)}`).join(' · ')}.` : ''}</p>
  <p style="margin-top:14px"><a class="lp-cta" href="${go}">내 종목 실적·배당 일정까지 보기 →</a></p>
</section>
${weekHtml(weekend ? '다음 주 일정' : '이번 주 일정', A, a?.events || [], today)}
${weekHtml(weekend ? '그다음 주 일정' : '다음 주 일정', B, b?.events || [], today)}
<section class="lp-sec"><h2>지표 쉽게 이해하기</h2>${ABOUT.map(([k, v]) => `<h3>${esc(k)}</h3><p>${esc(v)}</p>`).join('')}</section>
<section class="lp-sec"><h2>자주 묻는 질문</h2>${FAQ.map(([q, a2]) => `<details class="lp-faq"><summary>${esc(q)}</summary><p>${esc(a2)}</p></details>`).join('')}</section>
<section class="lp-sec lp-end"><a class="lp-cta" href="${go}">🔥 Fire Portfolio 대시보드 열기 →</a><p class="lp-note">자료: 네이버 증권 증시 캘린더. 발표 일정·값은 바뀔 수 있어요. 투자 조언이 아니에요.</p></section>`;
  const title = `이번 주 미국 경제지표 발표 일정(${md(A.from)}~${md(A.to)}) — CPI·PPI·FOMC 한국 시간`;
  const desc = `${md(A.from)}~${md(A.to)} 미국·한국 주요 경제지표 발표 일정을 한국 시간으로 정리했어요. CPI·PPI·FOMC 금리 결정·고용보고서·PCE·소매판매와 발표 값, 지표의 뜻까지 쉽게 설명해요.`;
  const html = fill({ title, desc, body, canon: `${SITE}calendar`, ld: [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url: `${SITE}calendar`, inLanguage: 'ko', dateModified: today },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a2]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a2 } })) },
  ] });
  if (a) waitUntil(cache.put(key, new Response(html, { headers: { 'cache-control': 'public, max-age=3600' } })));
  return respond(html, 200, host, 900);
}
