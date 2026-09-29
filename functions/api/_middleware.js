// /api/* 공통 보호
// 1) 다른 웹사이트가 방문자 브라우저를 통해 이 API를 끌어다 쓰지 못하게 막는다(같은 사이트 요청만 허용).
// 2) 한 IP가 짧은 시간에 몰아서 호출하면 잠시 막는다(무료 한도 소진 방지 — 실행 인스턴스별 간이 제한).
// 3) 응답에 보안 헤더를 붙인다.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 90; // 정상 사용(종목 전환·새로고침 포함)보다 넉넉한 값
const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
    if (hits.size > 5000) hits.clear(); // 메모리 보호
    return false;
  }
  h.n += 1;
  return h.n > MAX_PER_WINDOW;
}

export async function onRequest({ request, next }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return new Response('forbidden', { status: 403 });
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (tooMany(ip)) {
    return new Response(JSON.stringify({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }), {
      status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60' },
    });
  }
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('x-robots-tag', 'noindex');
  out.headers.set('cache-control', out.headers.get('cache-control') || 'no-store');
  out.headers.delete('access-control-allow-origin'); // 같은 주소 전용이므로 CORS 허용 안 함
  return out;
}
