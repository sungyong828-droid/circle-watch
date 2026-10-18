// Cloudflare Pages: /api/promises?s= — 회사 약속 추적 — 지난 실적 발표의 약속을 최신 발표로 판정, 발표마다 한 번 만들어 KV 보관
import { handlePromises } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handlePromises(new URL(request.url), caches.default, {}, { waitUntil }, env);
