// Cloudflare Pages: /api/vote — 실적 발표 예측 투표(익명)
//  GET  ?k=CRCL:2026-09-30            → { up, down }
//  POST { k, v: 1|0, vid }            → 내 표 저장(같은 기기는 덮어씀) 후 { up, down }
// 테스트 주소에서 온 표는 't:' 를 붙여 따로 센다(실제 집계에 섞이지 않게)
const K_RE = /^([A-Z][A-Z0-9.-]{0,9}|[0-9A-Z]{6}\.(KS|KQ)):\d{4}-\d{2}-\d{2}$/;
const VID_RE = /^[a-z0-9]{16,40}$/;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|python|curl|wget|httpclient|okhttp|go-http/i;
const PER_IP = 20; // 한 IP에서 한 종목 투표에 넣을 수 있는 기기 수(공용 IP 고려)

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const keyOf = (url, k) => (url.hostname === 'my-fire-portfolio.pages.dev' ? k : 't:' + k);
async function ipHash(ip, salt) {
  if (!ip) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt || ''}|vote|${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function counts(db, k) {
  const { results } = await db.prepare('SELECT v, COUNT(*) AS n FROM votes WHERE k = ?1 GROUP BY v').bind(k).all();
  const o = { up: 0, down: 0 };
  for (const r of results || []) o[r.v ? 'up' : 'down'] = r.n;
  return o;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), k = url.searchParams.get('k') || '';
  if (!env.STATS || !K_RE.test(k)) return json({ up: 0, down: 0 });
  try { return json(await counts(env.STATS, keyOf(url, k))); } catch { return json({ up: 0, down: 0 }); }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if ((request.headers.get('origin') || '') !== url.origin || BOT_RE.test(request.headers.get('user-agent') || '')) return json({ error: 'forbidden' }, 403);
  if (!env.STATS) return json({ error: 'unavailable' }, 503);
  const raw = await request.text();
  if (raw.length > 400) return json({ error: 'too long' }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400); }
  if (!K_RE.test(b.k || '') || !VID_RE.test(b.vid || '') || ![0, 1].includes(b.v)) return json({ error: 'bad request' }, 400);
  // 이미 발표가 끝난 분기(분기 말일에서 100일 넘게 지남)에는 새로 받지 않는다
  if (Date.now() - Date.parse(b.k.split(':')[1] + 'T00:00:00Z') > 100 * 86400000) return json({ error: 'closed' }, 400);
  const db = env.STATS, k = keyOf(url, b.k), iph = await ipHash(request.headers.get('cf-connecting-ip'), env.ADMIN_KEY);
  try {
    await db.prepare(
      `INSERT INTO votes (k, vid, v, at, iph) SELECT ?1, ?2, ?3, ?4, ?5
         WHERE ?5 IS NULL OR (SELECT COUNT(*) FROM votes WHERE k = ?1 AND iph = ?5) < ${PER_IP}
           OR EXISTS (SELECT 1 FROM votes WHERE k = ?1 AND vid = ?2)
       ON CONFLICT(k, vid) DO UPDATE SET v = ?3, at = ?4`,
    ).bind(k, b.vid, b.v, Date.now(), iph).run();
    return json(await counts(db, k));
  } catch { return json({ error: 'failed' }, 500); }
}
