// Cloudflare Pages: /api/facts — 자동 확인한 조비 FAA 인증 %·스페이스X 보호예수 관련 공시 (Worker cron이 3시간마다 갱신)
import { handleFacts } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleFacts(new URL(request.url), caches.default, {}, { waitUntil }, env);
