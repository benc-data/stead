self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stead is offline</title><body style="font:16px system-ui;background:#f7f7f1;color:#214936;padding:2rem"><h1>You’re offline</h1><p>Reconnect to view your household finances.</p><p><a href="/">Try again</a></p></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )));
});
