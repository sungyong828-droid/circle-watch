// Cloudflare Pages: /api/gurus — 수집기가 만든 유명 투자자 13F 포트폴리오(gurus.json)를 대신 받아 준다.
// 13F는 분기에 한 번 바뀌는 자료라 10분 캐시한다.
const SOURCE = 'https://sungyong828-droid.github.io/circle-watch/data/gurus.json';

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/gurus?v=1', request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    const r = await fetch(`${SOURCE}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
    if (!r.ok) return new Response(JSON.stringify({ error: 'gurus ' + r.status }), { status: 502, headers: { 'content-type': 'application/json' } });
    res = new Response(await r.text(), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600' } });
    waitUntil(cache.put(key, res.clone()));
  }
  return res;
}
