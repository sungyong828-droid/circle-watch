// Cloudflare Pages: /api/valuation?s=AAPL — 💰 비싼가 싼가 · 🆚 경쟁사 비교 (SEC 재무제표 + Yahoo 주가, AI 없음)
import { handleValuation } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleValuation(new URL(request.url), caches.default, {}, { waitUntil });
