// Cloudflare Pages: /api/flow — 시장 자금 동향(고객예탁금 · 신용융자 · 오늘 투자자별 순매수), 1시간 캐시
import { handleFlow } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleFlow(new URL(request.url), caches.default, {}, { waitUntil });
