// 관리자 API 공통: 요청 헤더 x-admin-key 가 Pages 비밀값 ADMIN_KEY 와 같은지 확인한다.
// 비밀값 설정(사이트 주인이 직접): npx wrangler pages secret put ADMIN_KEY --project-name my-fire-portfolio
export const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜
export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const VID_RE = /^[a-z0-9]{16,40}$/;

// 길이·내용이 달라도 비교 시간이 같도록 해시끼리 비교
async function sameKey(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// 통과하면 null, 아니면 돌려줄 오류 응답
export async function denyUnlessAdmin(request, env) {
  if (!env.ADMIN_KEY) return json({ error: 'no-key', message: '관리자 비밀값(ADMIN_KEY)이 아직 설정되지 않았어요.' }, 503);
  const key = request.headers.get('x-admin-key') || '';
  if (!key || !(await sameKey(key, env.ADMIN_KEY))) {
    await new Promise((r) => setTimeout(r, 800)); // 무작위 대입 속도 늦추기
    return json({ error: 'denied', message: '관리자 키가 맞지 않아요.' }, 401);
  }
  if (!env.STATS) return json({ error: 'no-db' }, 503);
  return null;
}
