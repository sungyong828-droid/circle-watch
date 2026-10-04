// 관리자 API 공통: 요청 헤더 x-admin-key 가 Pages 비밀값 ADMIN_KEY 와 같은지 확인한다.
// 비밀값 설정(사이트 주인이 직접): npx wrangler pages secret put ADMIN_KEY --project-name my-fire-portfolio
// 키를 여러 번 틀린 IP는 잠시 잠근다(무작위 대입 방지). 틀린 기록은 IP 해시로만 남고 관리자 페이지 '보안'에 보인다.
export const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜
export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const VID_RE = /^[a-z0-9]{16,40}$/;
export const LOCK_FAILS = 8;           // 이만큼 틀리면
export const LOCK_MS = 30 * 60000;     // 마지막으로 틀린 뒤 30분 잠금

// 길이·내용이 달라도 비교 시간이 같도록 해시끼리 비교
async function sameKey(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function ipHash(request, env, day) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`auth|${env.ADMIN_KEY}|${day}|${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 통과하면 null, 아니면 돌려줄 오류 응답
export async function denyUnlessAdmin(request, env) {
  if (!env.ADMIN_KEY) return json({ error: 'no-key', message: '관리자 비밀값(ADMIN_KEY)이 아직 설정되지 않았어요.' }, 503);
  if (!env.STATS) return json({ error: 'no-db' }, 503);
  const now = Date.now(), day = kstDay(now), iph = await ipHash(request, env, day);
  let fail = null;
  try { fail = await env.STATS.prepare('SELECT n, last_at FROM auth_fail WHERE day = ?1 AND iph = ?2').bind(day, iph).first(); } catch {}
  if (fail && fail.n >= LOCK_FAILS && now - fail.last_at < LOCK_MS) {
    const min = Math.ceil((LOCK_MS - (now - fail.last_at)) / 60000);
    return json({ error: 'locked', message: `관리자 키를 여러 번 틀려 ${min}분 동안 잠겼어요.` }, 429);
  }
  const key = request.headers.get('x-admin-key') || '';
  if (!key || !(await sameKey(key, env.ADMIN_KEY))) {
    try {
      await env.STATS.prepare(
        `INSERT INTO auth_fail (day, iph, n, last_at) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(day, iph) DO UPDATE SET n = n + 1, last_at = ?3`,
      ).bind(day, iph, now).run();
    } catch {}
    await new Promise((r) => setTimeout(r, 800)); // 무작위 대입 속도 늦추기
    const left = LOCK_FAILS - ((fail?.n || 0) + 1);
    return json({ error: 'denied', message: left > 0 ? `관리자 키가 맞지 않아요. (${left}번 더 틀리면 30분 잠김)` : '관리자 키를 여러 번 틀려 30분 동안 잠겼어요.' }, 401);
  }
  return null;
}
