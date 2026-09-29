// Cloudflare Pages: /api/chart?s=JOBY&r=1d — 바이낸스에 없는 종목의 가격 차트 (Yahoo)
import { handleChart } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleChart(new URL(request.url), caches.default, {}, { waitUntil });
