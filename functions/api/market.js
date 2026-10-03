// Cloudflare Pages: /api/market — 시장 개요(지수·VIX·금리·달러·비트코인·선물)
import { handleMarket } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleMarket(new URL(request.url), caches.default, {}, { waitUntil });
