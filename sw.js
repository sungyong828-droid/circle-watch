// Fire Portfolio 서비스 워커 — 폰 알림(웹 푸시) + 인터넷이 끊겼을 때 안내 한 장. 화면 파일은 저장(캐시)하지 않아서 업데이트는 지금처럼 바로 보인다.
// 앱(안드로이드)으로 열었을 때 인터넷이 끊겨 있으면 빈 화면 대신 '연결 없음' 안내만 보여 준다(그 한 장만 저장 — 화면 파일은 저장하지 않음)
const OFFLINE = 'fp-offline-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(OFFLINE).then((c) => c.addAll(['/offline', '/assets/app-icon.png'])).catch(() => {})); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // 화면 이동(페이지 열기)만 — 나머지 요청은 브라우저가 평소처럼
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline').then((r) => r || Response.error())));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Fire Portfolio', {
    body: m.body || '',
    icon: '/assets/app-icon.png',
    badge: '/assets/favicon.png',
    tag: m.tag || undefined,
    data: { url: m.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if (new URL(c.url).origin === self.location.origin && 'focus' in c) { await c.focus(); if ('navigate' in c) c.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});
