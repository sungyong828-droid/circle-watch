// Cloudflare Pages: /api/semi — 반도체 업황(D램 현물가 + 미국 반도체 지수·대표 종목), 1시간 캐시
import { handleSemi } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleSemi(new URL(request.url), caches.default, {}, { waitUntil }, env);
