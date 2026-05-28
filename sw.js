const CACHE_NAME = 'focus-v7';
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

const scheduled = new Map();
let progressState = null;
let breakState = null;
let pulseState = null;        // {intervalMs, timer}
let distractionState = null;  // {taskText, startTime, stage, timer}
let idleState = null;         // {intervalMs, timer, count}

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
async function isFocused(){
  const cli = await self.clients.matchAll({type:'window',includeUncontrolled:true});
  return cli.some(c => c.focused);
}

// ──────────────────────────────
// PROGRESO (cronómetro vivo)
// ──────────────────────────────
async function updateProgressNotif(){
  if(!progressState) return;
  const elapsed = (Date.now() - progressState.startTime) + progressState.accumulatedMs;
  try{
    await self.registration.showNotification(`⚡ Focus — ${fmtTime(elapsed)} enfocado`, {
      body: `Trabajando en: ${progressState.taskText}\nToca para abrir y pausar.`,
      icon: BASE + 'icon-192.png',
      badge: BASE + 'icon-192.png',
      tag: 'focus-progress',
      silent: true,
      requireInteraction: true,
      renotify: false,
      timestamp: Date.now()
    });
  }catch(err){}
}
function startProgress(taskText, startTime, accumulatedMs){
  stopProgress();
  progressState = { taskText, startTime, accumulatedMs };
  updateProgressNotif();
  progressState.timer = setInterval(updateProgressNotif, 30000);
}
async function stopProgress(){
  if(progressState?.timer) clearInterval(progressState.timer);
  progressState = null;
  try{
    const ns = await self.registration.getNotifications({tag:'focus-progress'});
    ns.forEach(n => n.close());
  }catch(err){}
}

// ──────────────────────────────
// DESCANSO (cuenta regresiva)
// ──────────────────────────────
async function updateBreakNotif(){
  if(!breakState) return;
  const remaining = breakState.endTime - Date.now();
  if(remaining <= 0){ await endBreak(); return; }
  try{
    await self.registration.showNotification(`☕ Descanso — ${fmtCount(remaining)} restantes`, {
      body: `Descanso de ${breakState.duration} min. Te avisaré cuando termine.`,
      icon: BASE + 'icon-192.png',
      badge: BASE + 'icon-192.png',
      tag: 'focus-break',
      silent: true,
      requireInteraction: true,
      renotify: false,
      timestamp: Date.now()
    });
  }catch(err){}
}
function startBreak(endTime, duration){
  stopBreak();
  breakState = { endTime, duration };
  updateBreakNotif();
  breakState.timer = setInterval(updateBreakNotif, 30000);
}
async function stopBreak(){
  if(breakState?.timer) clearInterval(breakState.timer);
  breakState = null;
  try{
    const ns = await self.registration.getNotifications({tag:'focus-break'});
    ns.forEach(n => n.close());
  }catch(err){}
}
async function endBreak(){
  await stopBreak();
  await self.registration.showNotification('⏰ ¡Descanso terminado!', {
    body: '¡Vuelve al trabajo! Toca para abrir Focus.',
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    image: BASE + 'sprites/megaman-urgente.png',
    vibrate: [400,100,400,100,400,100,600,100,800],
    requireInteraction: true,
    silent: false,
    tag: 'focus-break-end',
    renotify: true,
    timestamp: Date.now()
  });
  const cli = await self.clients.matchAll({type:'window',includeUncontrolled:true});
  cli.forEach(c => c.postMessage({type:'break_ended'}));
}

// ──────────────────────────────
// PULSO cada X min (vibración + breve notif)
// ──────────────────────────────
async function firePulse(){
  if(!pulseState) return;
  // No pulsar si la app está en primer plano
  if(await isFocused()) return;
  const elapsed = progressState ? ((Date.now() - progressState.startTime) + progressState.accumulatedMs) : 0;
  await self.registration.showNotification('💓 Sigues enfocado', {
    body: progressState
      ? `Llevas ${fmtTime(elapsed)} en: ${progressState.taskText}\n¡No te distraigas!`
      : '¡Sigue así! No te distraigas.',
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    vibrate: [150,80,150,80,300],
    requireInteraction: false,
    silent: false,
    tag: 'focus-pulse',
    renotify: true,
    timestamp: Date.now()
  });
}
function startPulse(intervalMin){
  stopPulse();
  if(!intervalMin || intervalMin <= 0) return;
  const ms = intervalMin * 60 * 1000;
  pulseState = { intervalMs: ms };
  pulseState.timer = setInterval(firePulse, ms);
}
function stopPulse(){
  if(pulseState?.timer) clearInterval(pulseState.timer);
  pulseState = null;
}

// ──────────────────────────────
// DISTRACCIÓN ESCALONADA
// Cuando el user sale de la app: 30s suave, 90s fuerte, 3min ALARMA, después c/3min
// ──────────────────────────────
async function fireDistraction(stage){
  // Si el user volvió, parar
  if(await isFocused()){ stopDistraction(); return; }

  const taskText = distractionState?.taskText || 'tu tarea';
  let title, body, vibrate, image;
  if(stage === 1){
    title = '👀 ¿Dónde fuiste?';
    body = `¡Vuelve a Focus! Estabas trabajando en: ${taskText}`;
    vibrate = [200,100,200,100,400];
    image = BASE + 'sprites/megaman-alerta.png';
  } else if(stage === 2){
    title = '⚠️ ¡PILAS! ¡Te distrajiste!';
    body = `¡VUELVE YA al trabajo! Tarea: ${taskText}`;
    vibrate = [400,100,400,100,400,100,600];
    image = BASE + 'sprites/megaman-alerta.png';
  } else {
    title = '🚨 ¡ALARMA! ¡VUELVE!';
    body = `Llevas ${stage*3-6}+ min distraído. ¡FOCUS! Tarea: ${taskText}`;
    vibrate = [800,200,800,200,800,200,1000,200,1000];
    image = BASE + 'sprites/megaman-urgente.png';
  }
  await self.registration.showNotification(title, {
    body,
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    image,
    vibrate,
    requireInteraction: true,
    silent: false,
    tag: 'focus-distract',
    renotify: true,
    timestamp: Date.now()
  });
}
function startDistraction(taskText){
  stopDistraction();
  distractionState = { taskText, startTime: Date.now(), stage: 0 };
  // 30s
  const t1 = setTimeout(() => {
    if(!distractionState) return;
    distractionState.stage = 1;
    fireDistraction(1);
  }, 30000);
  // 90s
  const t2 = setTimeout(() => {
    if(!distractionState) return;
    distractionState.stage = 2;
    fireDistraction(2);
  }, 90000);
  // 3min, después cada 3 min
  const t3 = setTimeout(() => {
    if(!distractionState) return;
    distractionState.stage = 3;
    fireDistraction(3);
    distractionState.recurring = setInterval(() => {
      if(!distractionState) return;
      distractionState.stage++;
      fireDistraction(distractionState.stage);
    }, 180000);
  }, 180000);
  distractionState.timers = [t1, t2, t3];
}
function stopDistraction(){
  if(distractionState){
    distractionState.timers?.forEach(t => clearTimeout(t));
    if(distractionState.recurring) clearInterval(distractionState.recurring);
    distractionState = null;
  }
  // Cerrar notif de distracción visible
  self.registration.getNotifications({tag:'focus-distract'}).then(ns => ns.forEach(n => n.close())).catch(()=>{});
}

// ──────────────────────────────
// IDLE: recordatorio cuando NO usas la app
// ──────────────────────────────
async function fireIdle(){
  if(!idleState) return;
  if(await isFocused()){ stopIdle(); return; }
  idleState.count = (idleState.count||0) + 1;
  const mins = idleState.count * (idleState.intervalMs/60000);
  await self.registration.showNotification('👀 ¿Qué estás haciendo?', {
    body: `Llevas un rato sin usar Focus. ¿Estás estudiando? Registra una tarea o márcate un descanso.`,
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    image: BASE + 'sprites/megaman-alerta.png',
    vibrate: [250,100,250,100,400],
    requireInteraction: true,
    silent: false,
    tag: 'focus-idle',
    renotify: true,
    timestamp: Date.now()
  });
}
function startIdle(intervalMin){
  stopIdle();
  if(!intervalMin || intervalMin <= 0) return;
  const ms = intervalMin * 60 * 1000;
  idleState = { intervalMs: ms, count: 0 };
  idleState.timer = setInterval(fireIdle, ms);
}
function stopIdle(){
  if(idleState?.timer) clearInterval(idleState.timer);
  idleState = null;
  self.registration.getNotifications({tag:'focus-idle'}).then(ns=>ns.forEach(n=>n.close())).catch(()=>{});
}

// ──────────────────────────────
// Notificaciones programadas (one-shot)
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
  if(scheduled.has(id)){ clearTimeout(scheduled.get(id)); scheduled.delete(id); }
  const timer = setTimeout(async () => {
    scheduled.delete(id);
    if(id === 'focus-break-end'){ await endBreak(); return; }
    if(await isFocused()){
      const cli = await self.clients.matchAll({type:'window',includeUncontrolled:true});
      cli.forEach(c => c.postMessage({type:'scheduled_fired', id, title, body}));
    } else {
      await mostrarNotif(title, body, urgent, withActions);
    }
  }, delayMs);
  scheduled.set(id, timer);
}
function cancelar(id){
  if(scheduled.has(id)){ clearTimeout(scheduled.get(id)); scheduled.delete(id); }
}
function cancelarTodo(){
  scheduled.forEach(t => clearTimeout(t));
  scheduled.clear();
}

// ──────────────────────────────
// Mensajes
// ──────────────────────────────
self.addEventListener('message', e => {
  const d = e.data || {};
  if(d.type === 'SCHEDULE') programar(d.id, d.title, d.body, d.delayMs, d.urgent, d.actions);
  else if(d.type === 'CANCEL') cancelar(d.id);
  else if(d.type === 'CANCEL_ALL') cancelarTodo();
  else if(d.type === 'PROGRESS_START') startProgress(d.taskText, d.startTime, d.accumulatedMs || 0);
  else if(d.type === 'PROGRESS_STOP') stopProgress();
  else if(d.type === 'BREAK_START') startBreak(d.endTime, d.duration);
  else if(d.type === 'BREAK_STOP') stopBreak();
  else if(d.type === 'PULSE_START') startPulse(d.intervalMin);
  else if(d.type === 'PULSE_STOP') stopPulse();
  else if(d.type === 'DISTRACTION_START') startDistraction(d.taskText);
  else if(d.type === 'DISTRACTION_STOP') stopDistraction();
  else if(d.type === 'IDLE_START') startIdle(d.intervalMin);
  else if(d.type === 'IDLE_STOP') stopIdle();
  else if(d.type === 'PING') e.source && e.source.postMessage({type:'PONG'});
});

// ──────────────────────────────
// Periodic Sync (respaldo)
// ──────────────────────────────
self.addEventListener('periodicsync', e => {
  if(e.tag === 'focus-checkin') e.waitUntil(checkinBackground());
});
async function checkinBackground(){
  if(await isFocused()) return;
  await mostrarNotif('⚡ Focus — Check-in', '¿Sigues con tu tarea?', true, true);
}

// ──────────────────────────────
// Click en notificaciones
// ──────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  e.waitUntil((async () => {
    const cli = await self.clients.matchAll({type:'window',includeUncontrolled:true});
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
