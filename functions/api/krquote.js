// Cloudflare Pages: /api/krquote?s=005930.KS,247540.KQ — 한국 종목 실시간 시세(네이버 증권, 8초 캐시)
import { handleKrQuote } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleKrQuote(new URL(request.url), caches.default, {}, { waitUntil });
