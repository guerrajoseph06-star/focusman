const CACHE_NAME = 'focus-v2';
const BASE = self.location.pathname.replace('sw.js', '');

const ARCHIVOS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'sprites/megaman-idle.png',
  BASE + 'sprites/megaman-alerta.png',
  BASE + 'sprites/megaman-celebracion.png',
  BASE + 'sprites/megaman-dormido.png',
  BASE + 'sprites/megaman-urgente.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ARCHIVOS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Notificaciones de check-in desde segundo plano
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  const data = e.notification.data || {};

  if (action === 'si') {
    // Abrir la app si no está abierta
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        if (list.length > 0) {
          list[0].focus();
          list[0].postMessage({ type: 'checkin_ok', taskId: data.taskId });
        } else {
          clients.openWindow(BASE + 'index.html');
        }
      })
    );
  } else if (action === 'no') {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        if (list.length > 0) {
          list[0].focus();
          list[0].postMessage({ type: 'checkin_no', taskId: data.taskId });
        } else {
          clients.openWindow(BASE + 'index.html');
        }
      })
    );
  } else {
    // Click en la notificación directamente → abrir app
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        if (list.length > 0) return list[0].focus();
        return clients.openWindow(BASE + 'index.html');
      })
    );
  }
});

// Notificaciones en segundo plano (Periodic Background Sync)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'focus-checkin') {
    e.waitUntil(mostrarCheckin());
  }
});

async function mostrarCheckin() {
  const clients_list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  // Si la app está abierta y en primer plano, no mostrar notificación del sistema
  const focused = clients_list.some(c => c.focused);
  if (focused) return;

  await self.registration.showNotification('⚡ Focus — ¿Qué estás haciendo?', {
    body: 'Es hora del check-in. ¿Sigues trabajando en tu tarea?',
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    requireInteraction: true,
    tag: 'focus-checkin',
    actions: [
      { action: 'si', title: '✅ Sí, trabajando' },
      { action: 'no', title: '❌ Me perdí' }
    ],
    data: {}
  });
}

// Escuchar mensajes de la app para programar notificaciones
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'PING') {
    e.source.postMessage({ type: 'PONG' });
  }
  if (e.data && e.data.type === 'SCHEDULE_NOTIF') {
    // Notificación programada desde la app (cuando está en background)
    const delay = e.data.delay || 30 * 60 * 1000;
    setTimeout(() => mostrarCheckin(), delay);
  }
});
