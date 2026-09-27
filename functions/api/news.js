// Cloudflare Pages: /api/news — 구글 뉴스·Circle 발표·Nasdaq 공시 목록 (같은 주소라 CORS 불필요)
import { handleNews } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleNews(new URL(request.url), caches.default, {}, { waitUntil });
