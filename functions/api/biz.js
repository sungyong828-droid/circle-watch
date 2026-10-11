// Cloudflare Pages: /api/biz?s=AAPL | 005930.KS — 자동 정리한 '사업 현황'(tools/biz_auto.py 가 KV에 올린 값)
// 미국은 128칸(bizauto:us:<칸>), 한국은 한 키(bizauto:kr). 손으로 정리한 13개 종목은 앱이 data/biz/*.json 을 먼저 쓴다.
const BUCKETS = 128;
const bucket = (sym) => { let h = 0; for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) % 1000003; return h % BUCKETS; }; // tools/biz_auto.py 와 같은 계산
const out = (obj, status, maxAge) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}` } });

export async function onRequestGet({ request, env }) {
  const s = String(new URL(request.url).searchParams.get('s') || '').trim().toUpperCase();
  const kr = /^[0-9A-Z]{6}(\.(KS|KQ))?$/.test(s);
  if (!kr && !/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return out({ error: 'bad request' }, 400, 60);
  let all = null;
  try { all = await env.SUMS?.get(kr ? 'bizauto:kr' : `bizauto:us:${bucket(s)}`, { type: 'json', cacheTtl: 3600 }); } catch {}
  const B = all?.[kr ? s.slice(0, 6) : s];
  return B ? out(B, 200, 21600) : out({ error: 'none' }, 404, 21600);
}
