// Cloudflare Pages: /api/analyst?s=SYM — 애널리스트 목표가·투자의견 분포, 내부자 매매(Nasdaq 집계, 6시간마다 새로)
import { handleAnalyst } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleAnalyst(new URL(request.url), caches.default, {}, { waitUntil });
