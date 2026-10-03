// Cloudflare Pages: /api/brief — 오늘의 브리핑(AI)
import { handleBrief } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleBrief(new URL(request.url), caches.default, {}, { waitUntil }, env);
