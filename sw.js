// 공부하니 : 푸시 알림 + 오프라인
//  앱 파일은 인터넷 먼저(항상 최신), 안 되면 저장본
//  CDN 라이브러리(버전 고정)는 저장본 먼저
//  PDF 는 앱이 직접 Cache Storage(kmed-pdf-v1)에 넣고 꺼냄
const APP = 'kmed-app-v1';
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/__pdf/')) return;
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(APP); c.put(req, res.clone()); }
        return res;
      } catch {
        const c = await caches.open(APP);
        return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match(new URL('./', self.registration.scope).href) : undefined) || Response.error();
      }
    })());
    return;
  }
  if (CDN.test(req.url)) {
    e.respondWith((async () => {
      const c = await caches.open(APP);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    })());
  }
});

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
