// Cloudflare Pages: /api/admin/exclude?vid=…&on=1|0 — 이 기기를 방문 통계에서 빼기/다시 넣기 (관리자 전용)
// 빼면 그 기기의 지난 기록까지 통계에서 사라지고, 다시 넣으면 원래대로 보인다(기록 자체는 지우지 않음).
import { denyUnlessAdmin, json, VID_RE } from '../../../worker/admin-auth.js';

export async function onRequestGet({ request, env }) {
  const deny = await denyUnlessAdmin(request, env);
  if (deny) return deny;
  const u = new URL(request.url), vid = u.searchParams.get('vid') || '', on = u.searchParams.get('on') === '1';
  if (!VID_RE.test(vid)) return json({ error: 'bad vid' }, 400);
  if (on) await env.STATS.prepare('INSERT OR IGNORE INTO excluded (vid, at) VALUES (?1, ?2)').bind(vid, Date.now()).run();
  else await env.STATS.prepare('DELETE FROM excluded WHERE vid = ?1').bind(vid).run();
  return json({ ok: true, vid, excluded: on });
}
