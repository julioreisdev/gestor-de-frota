// Service Worker mínimo — habilita PWA install sem caching agressivo.
// Estratégia: network-only com fallback offline pra index (suficiente pra rodar
// o app em telas onde a sessão Supabase ainda está em cache). Nada de cachear
// rotas dinâmicas ou queries — evita servir dado velho.

const VERSION = 'gf-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(APP_SHELL)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Só intercepta GET do mesmo origin
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Network-first: tenta rede, cai pro cache se falhar (modo offline).
  event.respondWith(
    fetch(req).then((res) => {
      // só guarda no cache se é app-shell
      if (APP_SHELL.includes(url.pathname.replace(location.pathname.replace(/index\.html$/, ''), './'))) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
