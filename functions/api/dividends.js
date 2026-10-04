// Cloudflare Pages: /api/dividends — 종목 배당 내역(배당락일·주당 배당금·지급일·분할), Fire 배당금 계산용
import { handleDividends } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleDividends(new URL(request.url), caches.default, {}, { waitUntil });
