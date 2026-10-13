// Cloudflare Pages: /api/move — 다른 기기로 옮기기
// 보내는 기기가 코드(예: K7P2Q-9XQM4)로 암호화한 내용과 '코드의 해시'만 받는다. 서버는 코드를 모르니 내용을 열 수 없다.
//  POST { id, d }   → 10분 동안 보관
//  GET  ?id=        → 한 번 꺼내 주고 바로 지운다
const ID_RE = /^[0-9a-f]{64}$/;
const B64_RE = /^[A-Za-z0-9+/=]+$/;
const TTL = 10 * 60000, MAX = 300000, PER_IP_10MIN = 10;

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
async function ipHash(ip, salt) {
  if (!ip) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt || ''}|move|${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if ((request.headers.get('origin') || '') !== url.origin) return json({ error: 'forbidden' }, 403);
  if (!env.STATS) return json({ error: 'unavailable' }, 503);
  const raw = await request.text();
  if (raw.length > MAX + 200) return json({ error: 'too large' }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400); }
  if (!ID_RE.test(b.id || '') || !B64_RE.test(b.d || '') || b.d.length > MAX) return json({ error: 'bad request' }, 400);
  const db = env.STATS, now = Date.now(), iph = await ipHash(request.headers.get('cf-connecting-ip'), env.ADMIN_KEY);
  try {
    await db.prepare('DELETE FROM moves WHERE exp < ?1').bind(now).run();
    const n = iph ? (await db.prepare('SELECT COUNT(*) AS n FROM moves WHERE iph = ?1').bind(iph).first())?.n || 0 : 0;
    if (n >= PER_IP_10MIN) return json({ error: 'too many' }, 429);
    await db.prepare('INSERT OR REPLACE INTO moves (id, d, exp, iph) VALUES (?1, ?2, ?3, ?4)').bind(b.id, b.d, now + TTL, iph).run();
    return json({ ok: true, exp: now + TTL });
  } catch { return json({ error: 'failed' }, 500); }
}

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!env.STATS || !ID_RE.test(id)) return json({ error: 'none' }, 404);
  const db = env.STATS;
  try {
    const r = await db.prepare('SELECT d FROM moves WHERE id = ?1 AND exp >= ?2').bind(id, Date.now()).first();
    if (!r) return json({ error: 'none' }, 404);
    await db.prepare('DELETE FROM moves WHERE id = ?1').bind(id).run();
    return json({ d: r.d });
  } catch { return json({ error: 'failed' }, 500); }
}
