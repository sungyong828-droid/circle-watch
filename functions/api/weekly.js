// Cloudflare Pages: /api/weekly — 지수·종목 최근 1개월 일봉 종가(인스타 카드의 주간 등락용)
import { handleWeekly } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleWeekly(new URL(request.url), caches.default, {}, { waitUntil });
