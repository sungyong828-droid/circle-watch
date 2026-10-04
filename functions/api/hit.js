// Cloudflare Pages: /api/hit — 방문 1회 기록 (익명 통계, 관리자 페이지 /admin 에서만 조회)
// 저장하는 것: 날짜(한국 시간), 기기마다 무작위로 만든 ID, 유입 경로(사이트 주소), 국가, 휴대폰/PC 구분, 화면 언어,
//             IP를 비밀값과 섞은 해시(원래 IP·쿠키·개인 정보는 저장하지 않음)
// 같은 주소로 두 가지를 더 받는다(둘 다 그날 방문 기록이 있는 기기만):
//   ?k=u&u=비트 — 그날 연 화면·쓴 기능(어떤 종목·금액인지는 보내지 않음)
//   ?k=e&m=메시지 — 화면 오류(관리자 페이지의 '화면 오류'에 모아 보임)
const VID_RE = /^[a-z0-9]{16,40}$/;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor/i;
const PER_IP_DEVICES = 30; // 한 IP에서 하루에 새로 세는 기기 수 상한(무작위 ID로 숫자 부풀리기 방지 · 회사·통신사 공용 IP는 넉넉히)
const MAX_ERR_ROWS = 300;   // 하루 오류 종류 상한

const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

// 유입 경로: 다른 사이트 주소(호스트만) 또는 공유 링크의 ?ref= 값
function cleanRef(s) {
  s = String(s || '').toLowerCase().trim().slice(0, 80);
  return /^[a-z0-9가-힣._-]{1,80}$/.test(s) ? s.replace(/^www\./, '').replace(/^m\./, '') : '';
}
// 오류 메시지: 주소의 ?뒤·숫자 ID를 지우고 글자 수 제한(개인 정보·무한히 다른 문구 방지)
function cleanErr(s) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/[^\s)]+/g, (u) => u.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, ''))
    .replace(/\b[0-9a-f]{12,}\b/gi, '…').replace(/\s+/g, ' ').trim().slice(0, 160);
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
  const now = Date.now(), day = kstDay(now), kind = url.searchParams.get('k') || '';
  const db = env.STATS;
  try {
    if (kind === 'u') {
      const bits = Math.max(0, Math.min(0xfffff, parseInt(url.searchParams.get('u'), 10) || 0));
      if (bits) await db.prepare('UPDATE visits SET used = used | ?3, last_at = ?4 WHERE day = ?1 AND vid = ?2').bind(day, vid, bits, now).run();
      return done;
    }
    if (kind === 'e') {
      const msg = cleanErr(url.searchParams.get('m'));
      if (!msg) return done;
      await db.prepare(
        `INSERT INTO errors (day, msg, n, last_at)
         SELECT ?1, ?2, 1, ?3 WHERE EXISTS (SELECT 1 FROM visits WHERE day = ?1 AND vid = ?4)
           AND (SELECT COUNT(*) FROM errors WHERE day = ?1) < ${MAX_ERR_ROWS}
         ON CONFLICT(day, msg) DO UPDATE SET n = n + 1, last_at = ?3`,
      ).bind(day, msg, now, vid).run();
      return done;
    }
    const ref = cleanRef(url.searchParams.get('r'));
    const device = url.searchParams.get('d') === 'm' ? 'm' : 'd';
    const lang = url.searchParams.get('l') === 'en' ? 'en' : url.searchParams.get('l') === 'ko' ? 'ko' : null;
    const isNew = url.searchParams.get('n') === '1' ? 1 : 0;
    const country = String(request.cf?.country || '').slice(0, 2) || null;
    const iph = await ipHash(request.headers.get('cf-connecting-ip'), day, env.ADMIN_KEY);
    // 이미 오늘 기록이 있는 기기는 조회수만 늘리고, 새 기기는 같은 IP에서 하루 상한까지만 센다
    await db.prepare(
      `INSERT INTO visits (day, vid, first_at, last_at, views, is_new, ref, country, device, iph, lang)
       SELECT ?1, ?2, ?3, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE ?8 IS NULL OR (SELECT COUNT(*) FROM visits WHERE day = ?1 AND iph = ?8) < ${PER_IP_DEVICES}
         OR EXISTS (SELECT 1 FROM visits WHERE day = ?1 AND vid = ?2)
       ON CONFLICT(day, vid) DO UPDATE SET views = MIN(views + 1, 500), last_at = ?3, ref = COALESCE(visits.ref, excluded.ref), lang = COALESCE(excluded.lang, visits.lang)`,
    ).bind(day, vid, now, isNew, ref || null, country, device, iph, lang).run();
  } catch {}
  return done;
}
