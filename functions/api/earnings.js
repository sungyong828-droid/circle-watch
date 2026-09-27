// Cloudflare Pages: /api/earnings — 서클 분기 실적·EPS 예상치·다음 실적 발표일 (6시간 캐시)
import { handleEarnings } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleEarnings(new URL(request.url), caches.default, {}, { waitUntil });
