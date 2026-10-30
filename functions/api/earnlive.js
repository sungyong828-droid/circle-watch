// Cloudflare Pages: /api/earnlive?s=AAPL,MSFT — 최근 7일 새 실적 공시(내 종목만) · 워커가 5분마다 SEC를 확인해 KV에 남긴 것
import { handleEarnLive } from '../../worker/news-proxy.js';

export const onRequestGet = ({ request, waitUntil, env }) =>
  handleEarnLive(new URL(request.url), caches.default, {}, { waitUntil }, env);
