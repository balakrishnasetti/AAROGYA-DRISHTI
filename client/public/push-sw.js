self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Aarogya Drishti', body: 'You have a new care update.' };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Aarogya Drishti', {
      body: payload.body || 'You have a new care update.',
      tag: payload.tag || 'care-update',
      data: { url: payload.url || '/' },
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(destination);
        return existing.focus();
      }
      return self.clients.openWindow(destination);
    }),
  );
});
