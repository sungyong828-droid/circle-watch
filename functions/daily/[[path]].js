// Cloudflare Pages: /daily — '오늘의 스테이블코인' 기록 (SNS 일간 카드와 같은 숫자·글을 날짜별 페이지로)
// 내용은 KV(SUMS)의 daily:YYYY-MM-DD · daily:index 에 있다(promo/sns/publish-daily.mjs 가 매일 올림). 배포 없이 매일 쌓인다.
// 머리·바닥글은 소개 페이지와 같은 틀(worker/daily-tpl.js, build.py 가 만듦)을 쓴다.
import { SITE, esc, nf, usdKo, pctS, ppS, pctP, tone, krDay, md, fill, respond } from '../../worker/ssr.js';

function spark(series, w = 120, h = 44) {
  const v = (series || []).map((p) => p[1]).filter((x) => x != null);
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1, up = v.at(-1) >= v[0];
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - ((y - lo) / r) * (h - 6) - 3).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="USDC 유통량 최근 30일"><polyline points="${pts}" fill="none" stroke="${up ? '#f0616d' : '#5b9bff'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function dayPage(D, index) {
  const N = D.n || {}, i = index.findIndex((x) => x.day === D.day);
  const newer = i > 0 ? index[i - 1] : null, older = i >= 0 && i < index.length - 1 ? index[i + 1] : null;
  const go = `./?ref=daily-${D.day.replace(/-/g, '')}`;
  const tile = (k, v, s) => `<div><span>${k}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  const body = `<section class="lp-hero">
  <p class="dl-when">${krDay(D.day)} · 💵 오늘의 스테이블코인</p>
  <h1>${esc(D.headline)}</h1>
  <p class="lp-lead">${esc(D.comment)}</p>
  <div class="dl-hero-num"><div><span class="dl-when">USDC 유통량 · 서클 공식</span><b>${usdKo(N.usdc)}</b>
    <span class="dl-when"><span class="${tone(N.usdcD1)}">1일 ${pctS(N.usdcD1, 2)}</span> · <span class="${tone(N.usdcD7)}">7일 ${pctS(N.usdcD7, 2)}</span></span></div>${spark(D.series30)}</div>
  <a class="lp-cta" href="${go}#usdc">실시간 USDC 대시보드 열기 →</a>
</section>
<section class="lp-sec"><h2>오늘의 숫자</h2><div class="dl-grid">
  ${tile('스테이블코인 전체', usdKo(N.total), N.usdtShare != null ? `USDT ${pctP(N.usdtShare)} · USDC ${pctP(N.share)}` : '')}
  ${tile('USDC 점유율', pctP(N.share), `<span class="${tone(N.shareD7)}">7일 ${ppS(N.shareD7)}</span>`)}
  ${tile('서클(CRCL) 주가', N.crcl != null ? '$' + nf(N.crcl, 2) : '–', `<span class="${tone(N.crclD1)}">1일 ${pctS(N.crclD1)}</span>`)}
  ${tile('CRCL 공매도 비율', pctP(N.short), N.shortAvg != null ? `1개월 평균 ${pctP(N.shortAvg)}` : '')}
  ${tile('Arc 예치금(TVL)', usdKo(N.arcTvl), N.dex24h != null ? `DEX 24시간 ${usdKo(N.dex24h)}` : '')}
  ${tile('미 국채 13주 금리', N.tbill != null ? (N.tbill * 100).toFixed(2) + '%' : '–', '준비금 이자 수익의 기준')}
</div><p class="lp-note">숫자는 그날 아침 기준이에요. 지금 숫자는 <a href="${go}#usdc">대시보드</a>에서 실시간으로 볼 수 있어요.</p></section>
${(D.news || []).length ? `<section class="lp-sec"><h2>오늘의 뉴스</h2><ul class="dl-news">${D.news.map((n) => `<li>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener nofollow">` : '<a>'}${esc(n.title)}<small>${esc(n.source || '')}</small></a></li>`).join('')}</ul></section>` : ''}
<section class="lp-sec"><div class="dl-nav">${older ? `<a href="daily/${older.day}">← ${md(older.day)} ${esc(older.headline).slice(0, 24)}</a>` : '<span></span>'}<a href="daily">전체 기록</a>${newer ? `<a href="daily/${newer.day}">${md(newer.day)} →</a>` : '<span></span>'}</div></section>
<section class="lp-sec lp-end"><a class="lp-cta" href="${go}">🔥 Fire Portfolio 대시보드 열기 →</a>
<p class="lp-note">매일 아침 인스타그램·X <b>@myfireportfolio</b>에도 올려요. 투자 조언이 아닌 데이터 정리예요. 데이터: 서클 공식 API·DefiLlama·Nasdaq·FINRA·미 재무부.</p></section>`;
  const title = `${krDay(D.day).replace(/ \(.\)$/, '')} 스테이블코인 — ${D.headline}`;
  const desc = `USDC 유통량 ${usdKo(N.usdc)}(1일 ${pctS(N.usdcD1, 2)}), 스테이블코인 전체 ${usdKo(N.total)}, USDC 점유율 ${pctP(N.share)}, 서클(CRCL) $${nf(N.crcl, 2)}. ${D.comment}`.slice(0, 300);
  return fill({ title, desc, body, canon: `${SITE}daily/${D.day}`, ld: { '@context': 'https://schema.org', '@type': 'Article', headline: D.headline, datePublished: D.day, dateModified: D.day, inLanguage: 'ko', description: desc, url: `${SITE}daily/${D.day}`, author: { '@type': 'Organization', name: 'Fire Portfolio' }, publisher: { '@type': 'Organization', name: 'Fire Portfolio' } } });
}

function indexPage(index) {
  const body = `<section class="lp-hero">
  <h1>오늘의 스테이블코인 기록</h1>
  <p class="lp-lead">매일 아침 USDC 유통량과 점유율, 서클(CRCL) 주가·공매도, 그날의 주요 뉴스를 한 장으로 정리해요. 날짜를 누르면 그날의 숫자를 볼 수 있어요.</p>
  <a class="lp-cta" href="./?ref=daily-index#usdc">실시간 USDC 대시보드 열기 →</a>
</section>
<section class="lp-sec"><h2>날짜별 기록</h2>${index.length ? `<ul class="dl-list">${index.map((x) => `<li><a href="daily/${x.day}"><time datetime="${x.day}">${x.day.slice(2).replace(/-/g, '.')}</time><b>${esc(x.headline)}${x.usdc ? `<small>USDC ${usdKo(x.usdc)}</small>` : ''}</b></a></li>`).join('')}</ul>` : '<p class="lp-note">첫 기록을 준비하고 있어요.</p>'}</section>
<section class="lp-sec lp-end"><p class="lp-note">인스타그램·X <b>@myfireportfolio</b>에서도 매일 받아볼 수 있어요. 투자 조언이 아닌 데이터 정리예요.</p></section>`;
  const title = '오늘의 스테이블코인 — 매일 USDC 유통량·점유율·서클(CRCL) 정리';
  const desc = '매일 아침 USDC 유통량과 스테이블코인 점유율, 서클(CRCL) 주가·공매도, 주요 뉴스를 날짜별로 정리한 기록이에요.';
  return fill({ title, desc, body, canon: `${SITE}daily`, ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url: `${SITE}daily`, inLanguage: 'ko' } });
}

export async function onRequestGet({ request, env, params }) {
  const host = new URL(request.url).hostname;
  const seg = [].concat(params.path || []).filter(Boolean);
  const index = (await env.SUMS?.get('daily:index', 'json').catch(() => null)) || [];
  if (!seg.length) return respond(indexPage(index), 200, host);
  const day = seg[0];
  const D = seg.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(day) ? await env.SUMS?.get('daily:' + day, 'json').catch(() => null) : null;
  if (!D) return respond(fill({ title: '기록을 찾지 못했어요', desc: '오늘의 스테이블코인 기록', canon: `${SITE}daily`, ld: {}, body: `<section class="lp-hero"><h1>그날의 기록이 없어요</h1><p class="lp-lead">날짜를 다시 확인해 주세요.</p><a class="lp-cta" href="daily">전체 기록 보기 →</a></section>` }), 404, host);
  return respond(dayPage(D, index), 200, host);
}
