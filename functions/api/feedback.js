// Cloudflare Pages: POST /api/feedback — 고객 문의·개선 제안 받기 (관리자 페이지에서만 조회)
// 도배 막기(여러 겹):
//  1) 같은 사이트 화면에서만(Origin 확인) · 봇 차단 · 글자 수 제한 · 링크 3개 이상 금지
//  2) 숨은 칸(사람에겐 안 보임)에 값이 있거나, 화면을 연 지 3초 안에 보내면 사람이 아닌 것으로 본다
//  3) 같은 IP(해시)·같은 기기: 10분에 3건, 하루 8건까지 / 사이트 전체: 하루 150건까지
//  4) 같은 내용은 7일 안에 다시 받지 않는다
const VID_RE = /^[a-z0-9]{16,40}$/;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|python|curl|wget|httpclient|okhttp|go-http/i;
const KINDS = ['idea', 'bug', 'question', 'etc'];
const PER_10MIN = 3, PER_DAY = 8, SITE_PER_DAY = 150;

const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮]/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  if (origin !== url.origin) return json({ error: 'forbidden' }, 403);
  if (BOT_RE.test(request.headers.get('user-agent') || '')) return json({ error: 'forbidden' }, 403);
  if (!env.STATS) return json({ error: '지금은 받을 수 없어요. 잠시 후 다시 시도해 주세요.' }, 503);
  const raw = await request.text();
  if (raw.length > 6000) return json({ error: '내용이 너무 길어요.' }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: '잘못된 요청이에요.' }, 400); }

  const kind = KINDS.includes(b.kind) ? b.kind : 'etc';
  const msg = clean(b.msg, 1000), contact = clean(b.contact, 100), page = clean(b.page, 40).replace(/[^\w#./-]/g, '');
  const lang = b.lang === 'en' ? 'en' : 'ko', vid = VID_RE.test(b.vid || '') ? b.vid : null;
  const elapsed = Number(b.t) || 0;
  // 사람이 아닌 것 같으면 '받았어요'라고만 답하고 저장하지 않는다(봇이 우회 방법을 알기 어렵게)
  if (b.hp || elapsed < 3000 || elapsed > 3 * 86400000) return json({ ok: true });
  if (msg.length < 5) return json({ error: '내용을 5자 이상 적어 주세요.' }, 400);
  if ((msg.match(/https?:\/\/|www\./gi) || []).length >= 3) return json({ error: '링크가 너무 많아요. 링크는 2개까지만 넣어 주세요.' }, 400);

  const now = Date.now(), day = kstDay(now), db = env.STATS;
  const iph = await sha(`fb|${env.ADMIN_KEY || ''}|${day}|${request.headers.get('cf-connecting-ip') || ''}`);
  const hash = await sha(msg.toLowerCase().replace(/\s+/g, ' '));
  try {
    const [mine, recent, site, dup] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE day = ?1 AND (iph = ?2 OR (?3 IS NOT NULL AND vid = ?3))').bind(day, iph, vid).first(),
      db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE at >= ?1 AND (iph = ?2 OR (?3 IS NOT NULL AND vid = ?3))').bind(now - 10 * 60000, iph, vid).first(),
      db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE day = ?1').bind(day).first(),
      db.prepare('SELECT 1 AS y FROM feedback WHERE hash = ?1 AND at >= ?2 LIMIT 1').bind(hash, now - 7 * 86400000).first(),
    ]);
    if (dup) return json({ error: '같은 내용을 이미 받았어요. 고마워요!' }, 409);
    if ((recent?.n || 0) >= PER_10MIN) return json({ error: '조금 전에 여러 번 보내셨어요. 10분 뒤에 다시 보내 주세요.' }, 429);
    if ((mine?.n || 0) >= PER_DAY) return json({ error: '오늘은 더 보낼 수 없어요. 내일 다시 보내 주세요.' }, 429);
    if ((site?.n || 0) >= SITE_PER_DAY) return json({ error: '오늘 받을 수 있는 양을 넘었어요. 내일 다시 보내 주세요.' }, 429);
    await db.prepare(
      'INSERT INTO feedback (at, day, kind, msg, contact, page, lang, vid, iph, hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)',
    ).bind(now, day, kind, msg, contact || null, page || null, lang, vid, iph, hash).run();
  } catch {
    return json({ error: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, 500);
  }
  return json({ ok: true });
}
