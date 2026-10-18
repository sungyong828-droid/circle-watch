// Cloudflare Pages: /api/filesum?s= — 최근 SEC 공시(8-K·10-Q·10-K) 한국어 3줄 요약 — 공시마다 한 번 만들어 KV 보관
import { handleFileSum } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleFileSum(new URL(request.url), caches.default, {}, { waitUntil }, env);
