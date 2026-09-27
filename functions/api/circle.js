// Cloudflare Pages: /api/circle — Circle 공식 USDC·EURC 유통량 (1분 캐시)
import { circleSupply } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  circleSupply(new URL(request.url), caches.default, {}, { waitUntil });
