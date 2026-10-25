// Cloudflare Pages: /api/push — 폰 알림(웹 푸시) 구독
//  GET               → { key } 알림용 공개 키(VAPID_JWK 비밀값이 없으면 { key: null } — 앱이 버튼을 숨긴다)
//  POST { sub, t, e, lang }  → 구독 저장(90일, 앱을 열 때마다 연장). t: { 종목: { p: 목표가, dir: 'up'|'down' } }, e: 실적 발표 알림 받을 종목
//  POST { endpoint, off: true } → 구독 지우기
// 서버에는 푸시 주소·목표가·종목 이름만 둔다. 보유 수량·평단·금액은 받지 않는다.
import { PUSH_HOST_RE, vapidPublic } from '../../worker/webpush.js';

const SYM_RE = /^([A-Z]{1,5}(\.[A-Z])?|[0-9A-Z]{6}\.(KS|KQ))$/;
const TTL_SEC = 90 * 86400;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
async function idOf(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fp-push|' + endpoint));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet({ env }) {
  let key = null;
  try { if (env.VAPID_JWK) key = vapidPublic(JSON.parse(env.VAPID_JWK)); } catch {}
  return json({ key });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if ((request.headers.get('origin') || '') !== url.origin) return json({ error: 'forbidden' }, 403);
  if (!env.SUMS || !env.VAPID_JWK) return json({ error: 'unavailable' }, 503);
  const raw = await request.text();
  if (raw.length > 20000) return json({ error: 'too large' }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400); }
  const endpoint = String(b.sub?.endpoint || b.endpoint || '');
  if (endpoint.length > 1000 || !PUSH_HOST_RE.test(endpoint)) return json({ error: 'bad endpoint' }, 400);
  const id = await idOf(endpoint);
  if (b.off) { await env.SUMS.delete('push:' + id); return json({ ok: true }); }
  const keys = b.sub?.keys || {};
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth || '')) return json({ error: 'bad keys' }, 400);
  const t = {};
  for (const [sym, T] of Object.entries(b.t || {}).slice(0, 40)) {
    const p = Number(T?.p);
    if (SYM_RE.test(sym) && p > 0 && isFinite(p)) t[sym] = { p, dir: T.dir === 'down' ? 'down' : 'up' };
  }
  const e = [...new Set((Array.isArray(b.e) ? b.e : []).filter((s) => typeof s === 'string' && /^[A-Z]{1,5}(\.[A-Z])?$/.test(s)))].slice(0, 40);
  const rec = { sub: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, t, e, lang: b.lang === 'en' ? 'en' : 'ko', at: Date.now() };
  await env.SUMS.put('push:' + id, JSON.stringify(rec), { expirationTtl: TTL_SEC });
  return json({ ok: true, n: Object.keys(t).length, e: e.length });
}
