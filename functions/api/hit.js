// Cloudflare Pages: /api/hit — 방문 1회 기록 (익명 통계, 관리자 페이지 /admin 에서만 조회)
// 저장하는 것: 날짜(한국 시간), 기기마다 무작위로 만든 ID, 유입 경로(사이트 주소), 국가, 휴대폰/PC 구분,
//             IP를 비밀값과 섞은 해시(원래 IP·쿠키·개인 정보는 저장하지 않음)
const VID_RE = /^[a-z0-9]{16,40}$/;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor/i;

const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

// 유입 경로: 다른 사이트 주소(호스트만) 또는 공유 링크의 ?ref= 값
function cleanRef(s) {
  s = String(s || '').toLowerCase().trim().slice(0, 80);
  return /^[a-z0-9가-힣._-]{1,80}$/.test(s) ? s.replace(/^www\./, '').replace(/^m\./, '') : '';
}

async function ipHash(ip, day, salt) {
  if (!salt || !ip) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${day}|${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet({ request, env }) {
  const done = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  const url = new URL(request.url);
  const vid = url.searchParams.get('v') || '';
  if (!env.STATS || !VID_RE.test(vid) || BOT_RE.test(request.headers.get('user-agent') || '')) return done;
  if (url.hostname !== 'my-fire-portfolio.pages.dev') return done; // 테스트 환경 방문은 집계하지 않는다
  const now = Date.now(), day = kstDay(now);
  const ref = cleanRef(url.searchParams.get('r'));
  const device = url.searchParams.get('d') === 'm' ? 'm' : 'd';
  const isNew = url.searchParams.get('n') === '1' ? 1 : 0;
  const country = String(request.cf?.country || '').slice(0, 2) || null;
  const iph = await ipHash(request.headers.get('cf-connecting-ip'), day, env.ADMIN_KEY);
  try {
    await env.STATS.prepare(
      `INSERT INTO visits (day, vid, first_at, last_at, views, is_new, ref, country, device, iph)
       VALUES (?1, ?2, ?3, ?3, 1, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(day, vid) DO UPDATE SET views = views + 1, last_at = ?3, ref = COALESCE(visits.ref, excluded.ref)`,
    ).bind(day, vid, now, isNew, ref || null, country, device, iph).run();
  } catch {}
  return done;
}
