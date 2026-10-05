// Cloudflare Pages: /api/admin/feedback?id=…&status=done|new|hidden — 문의 처리 상태 바꾸기 (관리자 전용)
// 글을 지우지는 않는다(숨김만). 목록은 /api/admin/stats 에 함께 온다.
import { denyUnlessAdmin, json } from '../../../worker/admin-auth.js';

const STATUS = ['new', 'done', 'hidden'];

export async function onRequestGet({ request, env }) {
  const deny = await denyUnlessAdmin(request, env);
  if (deny) return deny;
  const u = new URL(request.url);
  const id = parseInt(u.searchParams.get('id'), 10), status = u.searchParams.get('status');
  if (!(id > 0) || !STATUS.includes(status)) return json({ error: 'bad request' }, 400);
  await env.STATS.prepare('UPDATE feedback SET status = ?2 WHERE id = ?1').bind(id, status).run();
  return json({ ok: true, id, status });
}
