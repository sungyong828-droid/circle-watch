// Cloudflare Pages: /api/bigtech — 빅테크 AI 설비투자(SEC) + 나스닥100·빅테크 주가, 1시간 캐시
import { handleBigtech } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleBigtech(new URL(request.url), caches.default, {}, { waitUntil });
