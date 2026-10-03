// Cloudflare Pages: /api/lookup — 종목 검색(종목 추가 화면)
import { handleLookup } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleLookup(new URL(request.url), caches.default, {}, { waitUntil });
