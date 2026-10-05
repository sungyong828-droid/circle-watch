// Cloudflare Pages: /api/feargreed — 공포·탐욕 지수(주식: CNN · 코인: alternative.me), 15분 캐시
import { handleFearGreed } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleFearGreed(new URL(request.url), caches.default, {}, { waitUntil });
