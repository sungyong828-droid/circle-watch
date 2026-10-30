// Cloudflare Pages: /api/istmt?s=AAPL — 💸 실적 흐름도(보도자료 손익계산서 → 없으면 Nasdaq)
import { handleIstmt } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleIstmt(new URL(request.url), caches.default, {}, { waitUntil }, env);
