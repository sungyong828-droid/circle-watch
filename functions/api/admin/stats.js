// Cloudflare Pages: /api/admin/stats — 방문자 통계 (관리자 전용)
// 제외 목록(excluded)에 있는 기기(관리자 기기 등)는 지난 기록까지 모든 숫자에서 뺀다.
// ?vid=… 를 주면 그 기기의 기록·제외 여부도 함께 돌려준다(관리자 화면의 '이 기기' 설명용).
import { denyUnlessAdmin, json, kstDay, VID_RE, LOCK_FAILS, LOCK_MS } from '../../../worker/admin-auth.js';

export async function onRequestGet({ request, env }) {
  const deny = await denyUnlessAdmin(request, env);
  if (deny) return deny;
  const now = Date.now(), DAY = 86400000;
  const today = kstDay(now), from30 = kstDay(now - 29 * DAY), from7 = kstDay(now - 6 * DAY), from14 = kstDay(now - 13 * DAY);
  const q = (sql, ...args) => env.STATS.prepare(sql).bind(...args).all().then((r) => r.results || []);
  const EX = 'vid NOT IN (SELECT vid FROM excluded)';
  const [days, total, refs7, refsToday, countries, devices, live, back, week, prevWeek, exN, refs30, langs, hours, errs, fails] = await Promise.all([
    q(`SELECT day, COUNT(*) AS visitors, SUM(views) AS views, SUM(is_new) AS newbies, COUNT(DISTINCT iph) AS ips
       FROM visits WHERE day >= ?1 AND ${EX} GROUP BY day ORDER BY day`, from30),
    q(`SELECT COUNT(DISTINCT vid) AS visitors, SUM(views) AS views, MIN(day) AS since FROM visits WHERE ${EX}`),
    q(`SELECT COALESCE(ref, '직접 방문') AS ref, COUNT(*) AS n FROM visits WHERE day >= ?1 AND is_new = 1 AND ${EX} GROUP BY 1 ORDER BY n DESC LIMIT 12`, from7),
    q(`SELECT COALESCE(ref, '직접 방문') AS ref, COUNT(*) AS n FROM visits WHERE day = ?1 AND ${EX} GROUP BY 1 ORDER BY n DESC LIMIT 8`, today),
    q(`SELECT COALESCE(country, '?') AS country, COUNT(*) AS n FROM visits WHERE day >= ?1 AND ${EX} GROUP BY 1 ORDER BY n DESC LIMIT 8`, from7),
    q(`SELECT device, COUNT(*) AS n FROM visits WHERE day >= ?1 AND ${EX} GROUP BY 1`, from7),
    q(`SELECT COUNT(*) AS n FROM visits WHERE day = ?1 AND last_at >= ?2 AND ${EX}`, today, now - 5 * 60000),
    q(`SELECT COUNT(*) AS n FROM (SELECT vid FROM visits WHERE day >= ?1 AND ${EX} GROUP BY vid HAVING COUNT(*) >= 2)`, from7),
    q(`SELECT COUNT(DISTINCT vid) AS n, COALESCE(SUM(is_new), 0) AS newbies FROM visits WHERE day >= ?1 AND ${EX}`, from7),
    q(`SELECT COUNT(DISTINCT vid) AS n, COALESCE(SUM(is_new), 0) AS newbies FROM visits WHERE day >= ?1 AND day < ?2 AND ${EX}`, from14, from7),
    q(`SELECT COUNT(*) AS n FROM excluded`),
    // 최근 30일 유입 경로별 방문(그날 처음 들어온 경로) · 신규 — 관리자 화면에서 검색·블로그·SNS 등으로 묶어 보여 준다
    q(`SELECT COALESCE(ref, '직접 방문') AS ref, COUNT(*) AS n, SUM(is_new) AS newbies FROM visits WHERE day >= ?1 AND ${EX} GROUP BY 1 ORDER BY n DESC LIMIT 300`, from30),
    q(`SELECT COALESCE(lang, '?') AS lang, COUNT(*) AS n FROM visits WHERE day >= ?1 AND ${EX} GROUP BY 1`, from7),
    // 처음 연 시각(한국 시간)별 — 최근 7일
    q(`SELECT CAST(((first_at / 1000 + 32400) % 86400) / 3600 AS INTEGER) AS h, COUNT(*) AS n FROM visits WHERE day >= ?1 AND ${EX} GROUP BY 1`, from7),
    q(`SELECT msg, SUM(n) AS n, MAX(last_at) AS last_at, COUNT(*) AS days FROM errors WHERE day >= ?1 GROUP BY msg ORDER BY n DESC LIMIT 15`, from7),
    q(`SELECT day, COUNT(*) AS ips, SUM(n) AS n, MAX(last_at) AS last_at, SUM(n >= ?2 AND ?3 - last_at < ?4) AS locked FROM auth_fail WHERE day >= ?1 GROUP BY day ORDER BY day DESC`, from7, LOCK_FAILS, now, LOCK_MS),
  ]);
  // 인기 종목(관심 종목에 새로 추가한 티커 · 최근 30일 · 기기 수) — 관리자 화면은 1대도 보여 준다(공개 /api/popular 는 3대 이상만)
  const [picks, pickDev] = await Promise.all([
    q(`SELECT sym, COUNT(*) AS n, SUM(day >= ?2) AS week FROM picks WHERE day >= ?1 AND ${EX} GROUP BY sym ORDER BY n DESC, sym LIMIT 25`, from30, from7),
    q(`SELECT COUNT(DISTINCT vid) AS n FROM picks WHERE day >= ?1 AND ${EX}`, from30),
  ]).catch(() => [[], []]);
  // 고객 문의(숨긴 글 제외 최근 60건 + 상태별 개수)
  const [fb, fbN] = await Promise.all([
    q(`SELECT id, at, kind, msg, contact, page, lang, status FROM feedback WHERE status != 'hidden' ORDER BY id DESC LIMIT 60`),
    q(`SELECT status, COUNT(*) AS n FROM feedback GROUP BY status`),
  ]).catch(() => [[], []]);
  // 오래된 기록 정리(오류·틀린 키는 30일만 보관)
  try { await env.STATS.prepare('DELETE FROM errors WHERE day < ?1').bind(from30).run(); await env.STATS.prepare('DELETE FROM auth_fail WHERE day < ?1').bind(from30).run(); } catch {}
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
  return json({
    at: new Date(now).toISOString(), today, days, total: total[0] || {}, refs7, refsToday, countries, devices,
    liveNow: live[0]?.n || 0, week: week[0]?.n || 0, weekNew: week[0]?.newbies || 0, prevWeek: prevWeek[0]?.n || 0, prevWeekNew: prevWeek[0]?.newbies || 0,
    returning: back[0]?.n || 0, excludedDevices: exN[0]?.n || 0,
    picks, pickDevices: pickDev[0]?.n || 0,
    feedback: fb, feedbackCount: Object.fromEntries(fbN.map((r) => [r.status, r.n])),
    refs30, langs, hours, errors: errs, authFails: fails, lockRule: { fails: LOCK_FAILS, minutes: LOCK_MS / 60000 },
    me,
  });
}
