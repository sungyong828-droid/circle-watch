// Cloudflare Pages: /api/calendar?from=&to= — 이번 주 경제 일정(CPI·PPI·FOMC·고용 등, 한국 시간), 3시간 캐시
import { handleCalendar } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleCalendar(new URL(request.url), caches.default, {}, { waitUntil });
