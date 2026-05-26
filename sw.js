const CACHE_NAME = 'focus-v5';
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
// Estado de cronómetro vivo
let progressState = null;     // {taskText, startTime, accumulatedMs, timer}
let breakState = null;        // {endTime, duration, timer}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ARCHIVOS)));
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
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// ──────────────────────────────
// Helpers
// ──────────────────────────────
function fmtTime(ms){
  const sec = Math.floor(ms/1000);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  if(h>0) return `${h}h ${m}m`;
  if(m>0) return `${m} min ${s} s`;
  return `${s} s`;
}
function fmtCount(ms){
  if(ms<0) ms=0;
  const sec = Math.floor(ms/1000);
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ──────────────────────────────
// Notificación persistente: PROGRESO (cronómetro vivo)
// ──────────────────────────────
async function updateProgressNotif(){
  if(!progressState) return;
  const elapsed = (Date.now() - progressState.startTime) + progressState.accumulatedMs;
  const title = `⚡ Focus — ${fmtTime(elapsed)} enfocado`;
  const body = `Trabajando en: ${progressState.taskText}\nToca para abrir y pausar.`;
  try{
    await self.registration.showNotification(title, {
      body,
      icon: BASE + 'icon-192.png',
      badge: BASE + 'icon-192.png',
      tag: 'focus-progress',
      silent: true,
      requireInteraction: true,
      renotify: false,
      timestamp: Date.now(),
      data: { type: 'progress' }
    });
  }catch(err){}
}

function startProgress(taskText, startTime, accumulatedMs){
  stopProgress();
  progressState = { taskText, startTime, accumulatedMs };
  updateProgressNotif();
  // Actualizar cada 30 segundos
  progressState.timer = setInterval(updateProgressNotif, 30000);
}

async function stopProgress(){
  if(progressState && progressState.timer) clearInterval(progressState.timer);
  progressState = null;
  // Cerrar la notificación
  try{
    const notifs = await self.registration.getNotifications({tag:'focus-progress'});
    notifs.forEach(n => n.close());
  }catch(err){}
}

// ──────────────────────────────
// Notificación persistente: DESCANSO (cuenta regresiva)
// ──────────────────────────────
async function updateBreakNotif(){
  if(!breakState) return;
  const remaining = breakState.endTime - Date.now();
  if(remaining <= 0){
    await endBreak();
    return;
  }
  const title = `☕ Descanso — ${fmtCount(remaining)} restantes`;
  const body = `Descanso de ${breakState.duration} min. Te avisaré cuando termine.`;
  try{
    await self.registration.showNotification(title, {
      body,
      icon: BASE + 'icon-192.png',
      badge: BASE + 'icon-192.png',
      tag: 'focus-break',
      silent: true,
      requireInteraction: true,
      renotify: false,
      timestamp: Date.now(),
      data: { type: 'break' }
    });
  }catch(err){}
}

function startBreak(endTime, duration){
  stopBreak();
  breakState = { endTime, duration };
  updateBreakNotif();
  // Actualizar cada 30 segundos
  breakState.timer = setInterval(updateBreakNotif, 30000);
}

async function stopBreak(){
  if(breakState && breakState.timer) clearInterval(breakState.timer);
  breakState = null;
  try{
    const notifs = await self.registration.getNotifications({tag:'focus-break'});
    notifs.forEach(n => n.close());
  }catch(err){}
}

async function endBreak(){
  await stopBreak();
  // Notificación fuerte de fin de descanso
  await self.registration.showNotification('⏰ ¡Descanso terminado!', {
    body: '¡Vuelve al trabajo! Toca para abrir Focus.',
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    image: BASE + 'sprites/megaman-urgente.png',
    vibrate: [400, 100, 400, 100, 400, 100, 600],
    requireInteraction: true,
    silent: false,
    tag: 'focus-break-end',
    renotify: true,
    timestamp: Date.now()
  });
  // Notificar a la app si está abierta
  const cli = await self.clients.matchAll({type:'window', includeUncontrolled:true});
  cli.forEach(c => c.postMessage({type:'break_ended'}));
}

// ──────────────────────────────
// Notificaciones programadas (setTimeout)
// ──────────────────────────────
async function mostrarNotif(title, body, urgent, withActions){
  const opts = {
    body,
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    image: BASE + 'sprites/megaman-alerta.png',
    vibrate: urgent ? [300,100,300,100,300,100,500] : [200,100,200],
    requireInteraction: !!urgent,
    silent: false,
    tag: 'focus-' + Date.now(),
    renotify: true,
    timestamp: Date.now()
  };
  if(withActions){
    opts.actions = [
      {action:'si',title:'✅ Sí, trabajando'},
      {action:'no',title:'❌ Me perdí'}
    ];
  }
  await self.registration.showNotification(title, opts);
}

function programar(id, title, body, delayMs, urgent, withActions){
  if(scheduled.has(id)){
    clearTimeout(scheduled.get(id));
    scheduled.delete(id);
  }
  const timer = setTimeout(async () => {
    scheduled.delete(id);
    // Si es break-end, también detener la cuenta regresiva
    if(id === 'focus-break-end'){
      await endBreak();
      return;
    }
    const cli = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const focused = cli.some(c => c.focused);
    if(!focused){
      await mostrarNotif(title, body, urgent, withActions);
    } else {
      cli.forEach(c => c.postMessage({type:'scheduled_fired', id, title, body}));
    }
  }, delayMs);
  scheduled.set(id, timer);
}

function cancelar(id){
  if(scheduled.has(id)){
    clearTimeout(scheduled.get(id));
    scheduled.delete(id);
  }
}

function cancelarTodo(){
  scheduled.forEach(t => clearTimeout(t));
  scheduled.clear();
}

// ──────────────────────────────
// Mensajes desde la app
// ──────────────────────────────
self.addEventListener('message', e => {
  const d = e.data || {};
  if(d.type === 'SCHEDULE'){
    programar(d.id, d.title, d.body, d.delayMs, d.urgent, d.actions);
  } else if(d.type === 'CANCEL'){
    cancelar(d.id);
  } else if(d.type === 'CANCEL_ALL'){
    cancelarTodo();
  } else if(d.type === 'PROGRESS_START'){
    startProgress(d.taskText, d.startTime, d.accumulatedMs || 0);
  } else if(d.type === 'PROGRESS_STOP'){
    stopProgress();
  } else if(d.type === 'BREAK_START'){
    startBreak(d.endTime, d.duration);
  } else if(d.type === 'BREAK_STOP'){
    stopBreak();
  } else if(d.type === 'PING'){
    e.source && e.source.postMessage({type:'PONG'});
  }
});

// ──────────────────────────────
// Periodic Sync
// ──────────────────────────────
self.addEventListener('periodicsync', e => {
  if(e.tag === 'focus-checkin') e.waitUntil(checkinBackground());
});
async function checkinBackground(){
  const cli = await self.clients.matchAll({includeUncontrolled:true, type:'window'});
  if(cli.some(c => c.focused)) return;
  await mostrarNotif('⚡ Focus — Check-in', '¿Sigues con tu tarea?', true, true);
}

// ──────────────────────────────
// Click en notificaciones
// ──────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  e.waitUntil((async () => {
    const cli = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    if(cli.length > 0){
      const c = cli[0];
      await c.focus();
      if(action === 'si') c.postMessage({type:'checkin_ok'});
      else if(action === 'no') c.postMessage({type:'checkin_no'});
    } else {
      await clients.openWindow(BASE + 'index.html');
    }
  })());
});
