// Cloudflare Pages: /api/series — USDC·EURC·USYC 일별 공급량 (DefiLlama, 30분 캐시)
import { handleSeries } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleSeries(new URL(request.url), caches.default, {}, { waitUntil });
