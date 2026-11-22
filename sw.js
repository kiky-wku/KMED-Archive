// 공부하니 : 푸시 알림 받기 (화면 캐시는 하지 않음)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: '공부하니', body: e.data?.text() || '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || '공부하니', {
      body: d.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '#/home', id: d.id },
    });
    try { const n = await self.registration.getNotifications(); await self.navigator.setAppBadge?.(n.length); } catch { /* 무시 */ }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data?.url || '#/home').replace(/^\.?\/?/, '');
  const id = e.notification.data?.id;
  const target = new URL(self.registration.scope + hash + (id ? (hash.includes('?') ? '&' : '?') + 'nid=' + id : '')).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = list.find((w) => w.url.startsWith(self.registration.scope));
    if (c) { await c.focus(); c.postMessage({ type: 'open', hash: '#' + hash.replace(/^#/, ''), id: e.notification.data?.id }); return; }
    await self.clients.openWindow(target);
  })());
});
