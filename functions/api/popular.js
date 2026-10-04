// Cloudflare Pages: /api/popular — 다른 방문자들이 관심 종목에 많이 추가한 티커(최근 30일, 3대 이상 기기)
// 기기 하나뿐인 종목은 누가 넣었는지 짐작될 수 있어 보여 주지 않는다. 1시간 저장.
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const MIN_DEVICES = 3;

export async function onRequestGet({ request, env, waitUntil }) {
  const key = new Request(new URL('/api/popular?v=1', request.url).toString());
  const hit = await caches.default.match(key);
  if (hit) return hit;
  let items = [];
  if (env.STATS) {
    try {
      const r = await env.STATS.prepare(
        `SELECT sym, COUNT(*) AS n FROM picks WHERE day >= ?1 AND vid NOT IN (SELECT vid FROM excluded)
         GROUP BY sym HAVING n >= ?2 ORDER BY n DESC, sym LIMIT 12`,
      ).bind(kstDay(Date.now() - 29 * 86400000), MIN_DEVICES).all();
      items = (r.results || []).map((x) => ({ sym: x.sym, n: x.n }));
    } catch {}
  }
  const res = new Response(JSON.stringify({ at: new Date().toISOString(), items }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
  waitUntil(caches.default.put(key, res.clone()));
  return res;
}
