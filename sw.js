// Fire Portfolio 서비스 워커 — 폰 알림(웹 푸시)만 받는다. 화면 파일을 저장(캐시)하지 않아서 업데이트는 지금처럼 바로 보인다.
self.addEventListener('install', () => self.skipWaiting());
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
