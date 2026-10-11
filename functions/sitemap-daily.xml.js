// Cloudflare Pages: /sitemap-daily.xml — '오늘의 스테이블코인' 날짜별 기록(/daily/YYYY-MM-DD) 사이트맵
// 기록은 배포 없이 KV(SUMS)의 daily:index 에 매일 쌓이므로, 빌드 때 만드는 sitemap.xml 대신 여기서 그때그때 만든다. robots.txt 에 등록.
import { SITE } from '../worker/ssr.js';
import { PROD_HOST } from '../worker/site-headers.js';

export async function onRequestGet({ request, env }) {
  const host = new URL(request.url).hostname;
  const index = (await env.SUMS?.get('daily:index', 'json').catch(() => null)) || [];
  const days = index.map((x) => x?.day).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ''));
  const url = (loc, lastmod, pr) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>${pr > 0.7 ? 'daily' : 'monthly'}</changefreq><priority>${pr}</priority></url>`;
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url(`${SITE}daily`, days[0] || null, 0.8), ...days.map((d) => url(`${SITE}daily/${d}`, d, 0.6)), '</urlset>', ''].join('\n');
  return new Response(xml, { headers: {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'x-robots-tag': host === PROD_HOST ? 'noindex' : 'noindex, nofollow', // 사이트맵 파일 자체는 검색 결과에 안 나오게
  } });
}
