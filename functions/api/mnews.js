// Cloudflare Pages: /api/mnews — 시장 전체 뉴스(키워드 속보용)
import { handleMarketNews } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleMarketNews(new URL(request.url), caches.default, {}, { waitUntil }, env);
