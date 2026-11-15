// Cloudflare Pages: /api/data — 서버 수집기(GitHub Actions)가 만든 latest.json을 대신 받아 준다.
// 화면에서 GitHub 주소가 드러나지 않게 하려는 중계이며, 1분 캐시한다.
const SOURCE = 'https://sungyong828-droid.github.io/circle-watch/data/latest.json';
// 15분 간격 기록(snapshots)은 수집기가 8일치(800개)를 보관하지만 화면은 '직전 값'과 '24시간 전 값'만 쓴다
// → 마지막 기록 기준 26시간치만 보낸다(전체 623KB 중 387KB가 이 기록이었다)
const KEEP_MS = 26 * 3600 * 1000;
export function slimData(text) {
  try {
    const d = JSON.parse(text);
    const S = d.snapshots;
    if (Array.isArray(S) && S.length) {
      const last = Date.parse(S.at(-1)?.t);
      if (last) d.snapshots = S.filter((s) => Date.parse(s.t) >= last - KEEP_MS);
    }
    return JSON.stringify(d);
  } catch {
    return text; // 형식이 이상하면 받은 그대로
  }
}

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/data?v=2', request.url).toString());
  let res = await cache.match(key);
  if (!res) {
    const r = await fetch(`${SOURCE}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
    if (!r.ok) return new Response(JSON.stringify({ error: 'data ' + r.status }), { status: 502, headers: { 'content-type': 'application/json' } });
    res = new Response(slimData(await r.text()), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
    waitUntil(cache.put(key, res.clone()));
  }
  return res;
}
