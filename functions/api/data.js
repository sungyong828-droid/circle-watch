// Cloudflare Pages: /api/data — 서버 수집기(GitHub Actions)가 만든 latest.json을 대신 받아 준다.
// 화면에서 GitHub 주소가 드러나지 않게 하려는 중계이며, 1분 캐시한다.
const SOURCE = 'https://sungyong828-droid.github.io/circle-watch/data/latest.json';

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/data', request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    const r = await fetch(`${SOURCE}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
    if (!r.ok) return new Response(JSON.stringify({ error: 'data ' + r.status }), { status: 502, headers: { 'content-type': 'application/json' } });
    res = new Response(await r.text(), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
    waitUntil(cache.put(key, res.clone()));
  }
  return res;
}
