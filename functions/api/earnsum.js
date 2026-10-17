// Cloudflare Pages: /api/earnsum?s= — 실적 발표 AI 3줄 요약(발표 뒤 10일, 종목·분기마다 한 번 만들어 KV 보관)
import { handleEarnSum } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleEarnSum(new URL(request.url), caches.default, {}, { waitUntil }, env);
