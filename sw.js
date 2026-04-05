const CACHE = 'jp-news-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title || '📰 今日の日本語ニュース', {
    body: data.body || '今日の学習コンテンツが更新されました！',
    icon: '/icon-192.png',
    tag: 'daily-news',
    renotify: true,
    data: { url: '/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_DAILY') {
    scheduleDailyNotification(e.data.hour, e.data.minute);
  }
});

function scheduleDailyNotification(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    self.registration.showNotification('📰 今日の日本語ニュース', {
      body: '今日の学習コンテンツが更新されました！タップして確認しましょう。',
      icon: '/icon-192.png',
      tag: 'daily-news',
      renotify: true,
      data: { url: '/' }
    });
    scheduleDailyNotification(hour, minute);
  }, next - now);
}
