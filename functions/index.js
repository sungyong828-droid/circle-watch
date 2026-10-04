// Cloudflare Pages: 첫 화면(/) — 방문 국가를 <html data-cc="KR">로 넣어, 앱이 첫 화면부터 언어를 정할 수 있게 한다.
// (국가는 Cloudflare가 접속 IP로 판단한 값. VPN을 쓰면 그 나라로 보일 수 있다.)
// Functions 응답에는 _headers 가 적용되지 않으므로, build.py 가 _headers 에서 만든 보안 헤더를 직접 붙인다.
// 테스트 환경(운영 주소가 아닌 곳)은 검색에 노출되지 않게 noindex 를 붙인다.
import { SITE_HEADERS, PROD_HOST } from '../worker/site-headers.js';

export async function onRequestGet({ request, env }) {
  const res = await env.ASSETS.fetch(request);
  const cc = /^[A-Z]{2}$/.test(String(request.cf?.country || '')) ? request.cf.country : '';
  const host = new URL(request.url).hostname;
  const out = cc ? new HTMLRewriter().on('html', { element(el) { el.setAttribute('data-cc', cc); } }).transform(res) : res;
  const r = new Response(out.body, out);
  for (const [k, v] of Object.entries(SITE_HEADERS)) r.headers.set(k, v);
  r.headers.set('cache-control', 'no-cache'); // 나라마다 내용(data-cc)이 달라 공유 캐시에 남기지 않는다
  r.headers.append('vary', 'cf-ipcountry');
  if (host !== PROD_HOST) r.headers.set('x-robots-tag', 'noindex, nofollow');
  return r;
}
