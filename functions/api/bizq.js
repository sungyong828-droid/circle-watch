// Cloudflare Pages: /api/bizq?s=TSLA | 005930 — 사업 현황 새 분기 자동 정리(손으로 정리한 data/biz 파일보다 새 분기가 나왔을 때)
import { handleBizQ } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleBizQ(new URL(request.url), caches.default, {}, { waitUntil }, env);
