// Cloudflare Pages: /api/etfkit?s=SYM — 고배당 ETF 점검(1년 주가·분배금 → 총수익), 6시간 캐시
import { handleEtfKit } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleEtfKit(new URL(request.url), caches.default, {}, { waitUntil });
