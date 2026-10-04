// Cloudflare Pages: /api/admin/stats — 방문자 통계 (관리자 전용)
// 제외 목록(excluded)에 있는 기기(관리자 기기 등)는 지난 기록까지 모든 숫자에서 뺀다.
// ?vid=… 를 주면 그 기기의 기록·제외 여부도 함께 돌려준다(관리자 화면의 '이 기기' 설명용).
import { denyUnlessAdmin, json, kstDay, VID_RE } from '../../../worker/admin-auth.js';

export async function onRequestGet({ request, env }) {
  const deny = await denyUnlessAdmin(request, env);
  if (deny) return deny;
  const now = Date.now(), today = kstDay(now), from30 = kstDay(now - 29 * 86400000), from7 = kstDay(now - 6 * 86400000);
  const q = (sql, ...args) => env.STATS.prepare(sql).bind(...args).all().then((r) => r.results || []);
  const EX = 'vid NOT IN (SELECT vid FROM excluded)';
  const [days, total, refs7, refsToday, countries, devices, live, back, week, exN] = await Promise.all([
    q(`SELECT day, COUNT(*) AS visitors, SUM(views) AS views, SUM(is_new) AS newbies, COUNT(DISTINCT iph) AS ips
       FROM visits WHERE day >= ?1 AND ${EX} GROUP BY day ORDER BY day`, from30),
    q(`SELECT COUNT(DISTINCT vid) AS visitors, SUM(views) AS views, MIN(day) AS since FROM visits WHERE ${EX}`),
    q(`SELECT COALESCE(ref, '직접 방문') AS ref, COUNT(*) AS n FROM visits WHERE day >= ?1 AND is_new = 1 AND ${EX} GROUP BY 1 ORDER BY n DESC LIMIT 12`, from7),
    q(`SELECT COALESCE(ref, '직접 방문') AS ref, COUNT(*) AS n FROM visits WHERE day = ?1 AND ${EX} GROUP BY 1 ORDER BY n DESC LIMIT 8`, today),
    q(`SELECT COALESCE(country, '?') AS country, COUNT(*) AS n FROM visits WHERE day >= ?1 AND ${EX} GROUP BY 1 ORDER BY n DESC LIMIT 8`, from7),
    q(`SELECT device, COUNT(*) AS n FROM visits WHERE day >= ?1 AND ${EX} GROUP BY 1`, from7),
    q(`SELECT COUNT(*) AS n FROM visits WHERE day = ?1 AND last_at >= ?2 AND ${EX}`, today, now - 5 * 60000),
    q(`SELECT COUNT(*) AS n FROM (SELECT vid FROM visits WHERE day >= ?1 AND ${EX} GROUP BY vid HAVING COUNT(*) >= 2)`, from7),
    q(`SELECT COUNT(DISTINCT vid) AS n FROM visits WHERE day >= ?1 AND ${EX}`, from7),
    q(`SELECT COUNT(*) AS n FROM excluded`),
  ]);
  // 이 기기(관리자 화면을 연 기기)
  let me = null;
  const vid = new URL(request.url).searchParams.get('vid') || '';
  if (VID_RE.test(vid)) {
    const [m, ex] = await Promise.all([
      q(`SELECT COUNT(*) AS days, COALESCE(SUM(views), 0) AS views, MAX(day) AS last FROM visits WHERE vid = ?1`, vid),
      q(`SELECT 1 AS y FROM excluded WHERE vid = ?1`, vid),
    ]);
    me = { vid, days: m[0]?.days || 0, views: m[0]?.views || 0, last: m[0]?.last || null, excluded: ex.length > 0 };
  }
  return json({ at: new Date(now).toISOString(), today, days, total: total[0] || {}, refs7, refsToday, countries, devices, liveNow: live[0]?.n || 0, week: week[0]?.n || 0, returning: back[0]?.n || 0, excludedDevices: exN[0]?.n || 0, me });
}
