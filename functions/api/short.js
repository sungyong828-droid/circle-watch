// Cloudflare Pages: /api/short — 사용자가 추가한 종목의 공매도(FINRA)
import { handleShort } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleShort(new URL(request.url), caches.default, {}, { waitUntil });
