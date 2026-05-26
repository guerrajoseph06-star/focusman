const CACHE_NAME = 'focus-v3';
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

// Almacén de notificaciones programadas
const scheduled = new Map();

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

// ──────────────────────────────
// Mostrar notificación
// ──────────────────────────────
async function mostrarNotif(title, body, urgent, withActions) {
  const opts = {
    body,
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    image: BASE + 'sprites/megaman-alerta.png',
    vibrate: urgent ? [300, 100, 300, 100, 300, 100, 500] : [200, 100, 200],
    requireInteraction: !!urgent,
    silent: false,
    tag: 'focus-' + Date.now(),
    renotify: true,
    timestamp: Date.now()
  };
  if (withActions) {
    opts.actions = [
      { action: 'si', title: '✅ Sí, trabajando' },
      { action: 'no', title: '❌ Me perdí' }
    ];
  }
  await self.registration.showNotification(title, opts);
}

// ──────────────────────────────
// Programación de notificaciones (setTimeout)
// ──────────────────────────────
function programar(id, title, body, delayMs, urgent, withActions) {
  // Cancelar la anterior si existía
  if (scheduled.has(id)) {
    clearTimeout(scheduled.get(id));
    scheduled.delete(id);
  }
  const timer = setTimeout(async () => {
    scheduled.delete(id);
    // Verificar si la app está abierta en primer plano
    const cli = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = cli.some(c => c.focused);
    if (!focused) {
      await mostrarNotif(title, body, urgent, withActions);
    } else {
      // Notificar a la app por mensaje
      cli.forEach(c => c.postMessage({ type: 'scheduled_fired', id, title, body }));
    }
  }, delayMs);
  scheduled.set(id, timer);
}

function cancelar(id) {
  if (scheduled.has(id)) {
    clearTimeout(scheduled.get(id));
    scheduled.delete(id);
  }
}

function cancelarTodo() {
  scheduled.forEach(t => clearTimeout(t));
  scheduled.clear();
}

// ──────────────────────────────
// Mensajes desde la app
// ──────────────────────────────
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'SCHEDULE') {
    programar(d.id, d.title, d.body, d.delayMs, d.urgent, d.actions);
  } else if (d.type === 'CANCEL') {
    cancelar(d.id);
  } else if (d.type === 'CANCEL_ALL') {
    cancelarTodo();
  } else if (d.type === 'PING') {
    e.source && e.source.postMessage({ type: 'PONG' });
  }
});

// ──────────────────────────────
// Periodic Background Sync (respaldo)
// ──────────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'focus-checkin') {
    e.waitUntil(checkinBackground());
  }
});

async function checkinBackground() {
  const cli = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (cli.some(c => c.focused)) return;
  await mostrarNotif('⚡ Focus — Check-in', '¿Sigues con tu tarea? Toca para responder.', true, true);
}

// ──────────────────────────────
// Click en notificaciones
// ──────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;

  e.waitUntil((async () => {
    const cli = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cli.length > 0) {
      const c = cli[0];
      await c.focus();
      if (action === 'si') c.postMessage({ type: 'checkin_ok' });
      else if (action === 'no') c.postMessage({ type: 'checkin_no' });
    } else {
      const url = BASE + 'index.html' + (action ? ('#' + action) : '');
      await clients.openWindow(url);
    }
  })());
});
