// Cloudflare Pages: /api/news?s=SYM — 구글 뉴스·회사 공식 발표·Nasdaq 공시 목록 + AI 한 줄 요약 (같은 주소라 CORS 불필요)
import { handleNews } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleNews(new URL(request.url), caches.default, {}, { waitUntil }, env);
