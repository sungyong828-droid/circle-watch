// Cloudflare Pages: /api/quote — CRCA·CRCL 실시간 시세와 원·달러 환율 (10초 캐시)
import { handleQuote } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleQuote(new URL(request.url), caches.default, {}, { waitUntil });
