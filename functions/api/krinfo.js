// Cloudflare Pages: /api/krinfo?s=005930.KS — 한국 종목 투자 지표·투자자별 매매·애널리스트·분기 실적(네이버 증권, 30분 캐시)
import { handleKrInfo } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil }) =>
  handleKrInfo(new URL(request.url), caches.default, {}, { waitUntil });
