// 서버에서 그리는 소개 페이지(/daily · /stablecoin) 공통: 숫자 표기 · 틀 채우기 · 응답 헤더
import { SITE_HEADERS, PROD_HOST } from './site-headers.js';
import { DAILY_TPL } from './daily-tpl.js';

export const SITE = 'https://my-fire-portfolio.pages.dev/';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nf = (v, d = 0) => (v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const usdKo = (v) => (v == null ? '–' : v >= 1e12 ? `${nf(v / 1e12, 2)}조 달러` : v >= 1e10 ? `${nf(v / 1e8)}억 달러` : v >= 1e8 ? `${nf(v / 1e8, 1)}억 달러` : `${nf(v / 1e4)}만 달러`);
export const pctS = (v, d = 1) => (v == null || !isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`);
export const ppS = (v, d = 2) => (v == null || !isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%p`);
export const pctP = (v, d = 1) => (v == null || !isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`);
export const tone = (v) => (v == null || Math.abs(v) < 1e-9 ? 'flat' : v > 0 ? 'up' : 'down');
const WD = '일월화수목금토';
export const krDay = (d) => { const t = new Date(d + 'T12:00:00Z'); return `${t.getUTCFullYear()}년 ${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일 (${WD[t.getUTCDay()]})`; };
export const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

// 소개 페이지와 같은 머리·바닥글 틀(build.py가 만든 DAILY_TPL)에 제목·설명·본문·구조화 데이터를 넣는다
export function fill({ title, desc, body, canon, ld }) {
  return DAILY_TPL.replaceAll('%%TITLE%%', esc(title)).replaceAll('%%DESC%%', esc(desc)).replace('%%BODY%%', body)
    .replaceAll('%%CANON%%', canon).replace('%%LD%%', [].concat(ld).filter(Boolean).map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n'));
}
// Functions 응답에는 _headers 가 안 붙으므로 보안 헤더를 직접, 테스트 환경은 검색 제외
export function respond(html, status, host, maxAge = 300) {
  const r = new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': status === 200 ? `public, max-age=${maxAge}` : 'no-store' } });
  for (const [k, v] of Object.entries(SITE_HEADERS)) r.headers.set(k, v);
  if (host !== PROD_HOST) r.headers.set('x-robots-tag', 'noindex, nofollow');
  return r;
}
