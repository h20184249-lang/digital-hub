/* DIGITAL HUB BD — Real Web Push Service Worker Handler */
/* Loaded via Workbox importScripts so PWA offline caching & Web Push stay unified cleanly. */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'DIGITAL HUB BD',
      body: event.data.text() || 'New notification from DIGITAL HUB BD.',
    };
  }

  const title = payload.title || 'DIGITAL HUB BD';
  const targetUrl = (payload.data && payload.data.url) || payload.url || '/';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/pwa-192x192.png',
    tag: payload.tag || 'digitalhub-alert',
    renotify: true,
    requireInteraction: Boolean(payload.requireInteraction),
    data: {
      url: targetUrl,
      orderId: payload.orderId || (payload.data && payload.data.orderId) || '',
      category: payload.category || (payload.data && payload.data.category) || 'system',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const rawUrl = typeof data.url === 'string' && data.url ? data.url : '/';
  const absoluteTarget = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (!client.url.startsWith(self.location.origin)) continue;
          try {
            await client.focus();
          } catch {
            // Focus best-effort
          }
          client.postMessage({
            type: 'DIGITAL_HUB_PUSH_NAVIGATE',
            url: rawUrl,
            orderId: data.orderId || '',
          });
          if ('navigate' in client && typeof client.navigate === 'function') {
            try {
              await client.navigate(absoluteTarget);
            } catch {
              // SPA will handle postMessage navigation cleanly
            }
          }
          return client;
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(absoluteTarget);
        }
        return undefined;
      })
  );
});
