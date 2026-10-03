// Cloudflare Pages: /api/options — 옵션 시장 심리(CBOE 지연 시세 요약, 15분마다)
import { handleOptions } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleOptions(new URL(request.url), caches.default, {}, { waitUntil });
