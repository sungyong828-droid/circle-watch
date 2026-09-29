// Cloudflare Pages: /api/holders?s=SYM — 기관 보유 현황(13F, Nasdaq 집계 · 6시간 캐시)
import { handleHolders } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleHolders(new URL(request.url), caches.default, {}, { waitUntil });
