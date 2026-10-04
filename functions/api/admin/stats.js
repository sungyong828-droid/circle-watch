// Cloudflare Pages: /api/admin/stats — 방문자 통계 (관리자 전용)
// 요청 헤더 x-admin-key 가 Pages 비밀값 ADMIN_KEY 와 같을 때만 응답한다.
// 비밀값 설정(사이트 주인이 직접): npx wrangler pages secret put ADMIN_KEY --project-name my-fire-portfolio
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// 길이·내용이 달라도 비교 시간이 같도록 해시끼리 비교
async function sameKey(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY) return json({ error: 'no-key', message: '관리자 비밀값(ADMIN_KEY)이 아직 설정되지 않았어요.' }, 503);
  const key = request.headers.get('x-admin-key') || '';
  if (!key || !(await sameKey(key, env.ADMIN_KEY))) {
    await new Promise((r) => setTimeout(r, 800)); // 무작위 대입 속도 늦추기
    return json({ error: 'denied', message: '관리자 키가 맞지 않아요.' }, 401);
  }
  if (!env.STATS) return json({ error: 'no-db' }, 503);
  const now = Date.now(), today = kstDay(now), from30 = kstDay(now - 29 * 86400000), from7 = kstDay(now - 6 * 86400000);
  const q = (sql, ...args) => env.STATS.prepare(sql).bind(...args).all().then((r) => r.results || []);
  const [days, total, refs7, refsToday, countries, devices, live] = await Promise.all([
    q(`SELECT day, COUNT(*) AS visitors, SUM(views) AS views, SUM(is_new) AS newbies, COUNT(DISTINCT iph) AS ips
       FROM visits WHERE day >= ?1 GROUP BY day ORDER BY day`, from30),
    q(`SELECT COUNT(DISTINCT vid) AS visitors, SUM(views) AS views, MIN(day) AS since FROM visits`),
    q(`SELECT COALESCE(ref, '직접 방문') AS ref, COUNT(*) AS n FROM visits WHERE day >= ?1 AND is_new = 1 GROUP BY 1 ORDER BY n DESC LIMIT 12`, from7),
    q(`SELECT COALESCE(ref, '직접 방문') AS ref, COUNT(*) AS n FROM visits WHERE day = ?1 GROUP BY 1 ORDER BY n DESC LIMIT 8`, today),
    q(`SELECT COALESCE(country, '?') AS country, COUNT(*) AS n FROM visits WHERE day >= ?1 GROUP BY 1 ORDER BY n DESC LIMIT 8`, from7),
    q(`SELECT device, COUNT(*) AS n FROM visits WHERE day >= ?1 GROUP BY 1`, from7),
    q(`SELECT COUNT(*) AS n FROM visits WHERE day = ?1 AND last_at >= ?2`, today, now - 5 * 60000),
  ]);
  // 7일 안에 다시 온 기기(재방문) 비율
  const back = await q(`SELECT COUNT(*) AS n FROM (SELECT vid FROM visits WHERE day >= ?1 GROUP BY vid HAVING COUNT(*) >= 2)`, from7);
  const week = await q(`SELECT COUNT(DISTINCT vid) AS n FROM visits WHERE day >= ?1`, from7);
  return json({ at: new Date(now).toISOString(), today, days, total: total[0] || {}, refs7, refsToday, countries, devices, liveNow: live[0]?.n || 0, week: week[0]?.n || 0, returning: back[0]?.n || 0 });
}
