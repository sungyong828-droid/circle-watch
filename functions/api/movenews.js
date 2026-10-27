// Cloudflare Pages: /api/movenews?s=AAPL&d=2026-10-14 — 🔍 크게 움직인 날의 뉴스 (구글 뉴스 날짜 검색, AI 없음)
import { handleMoveNews } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleMoveNews(new URL(request.url), caches.default, {}, { waitUntil });
