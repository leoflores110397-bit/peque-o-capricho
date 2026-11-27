// Service worker: permite instalar la app y abrirla aunque no haya internet.
// Al cambiar cualquier archivo de la app, subir este número para que se actualice.
const VERSION = 'pc-v5';
const ARCHIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/config.js', 'js/calculos.js', 'js/importar.js', 'js/acceso.js', 'js/estado.js', 'js/ui.js', 'js/tema.js',
  'js/api/index.js', 'js/api/demo.js', 'js/api/supabase.js',
  'js/views/vender.js', 'js/views/hoy.js', 'js/views/caja.js', 'js/views/stock.js',
  'js/views/tickets.js', 'js/views/historial.js', 'js/views/mas.js',
  'icons/logo-96.png', 'icons/logo-192.png', 'icons/logo-512.png', 'icons/favicon.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];
// librerías y tipografías de afuera que se guardan la primera vez que se usan
const EXTERNOS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'actualizar') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // la base de datos y los archivos de Supabase siempre van directo a internet
  if (url.origin !== location.origin && !EXTERNOS.includes(url.hostname)) return;

  if (EXTERNOS.includes(url.hostname)) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const guardado = await c.match(req);
      if (guardado) return guardado;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // archivos de la app: primero lo guardado (rápido y sin internet), y se actualiza por detrás
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const clave = req.mode === 'navigate' ? 'index.html' : req;
    const guardado = await c.match(clave, { ignoreSearch: true });
    const red = fetch(req).then((res) => {
      if (res.ok && req.mode !== 'navigate') c.put(req, res.clone());
      return res;
    }).catch(() => guardado);
    return guardado || red;
  }));
});
