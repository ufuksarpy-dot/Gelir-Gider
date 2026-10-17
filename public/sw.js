// Üretildi: node yayinla.js — elle değiştirme.
// Uygulama dosyaları önbellekte: internet olmadan da açılır. Veri zaten telefonda (depo.js).
const ONBELLEK = 'usy-2f27c33f7823';
const KABUK = ["./","index.html","app.js","hesap.js","depo.js","yerel-api.js","excel.js","ice-aktar.js","deneme.js","vendor/xlsx.full.min.js","manifest.json","icon-180.png","icon-192.png","icon-512.png"];

self.addEventListener('install', (e) => {
  // cache: 'reload' — tarayıcının kendi önbelleğindeki eski dosyayı alma (GitHub Pages 10 dk önbellekletir)
  e.waitUntil(caches.open(ONBELLEK).then((c) => c.addAll(KABUK.map((d) => new Request(d, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((l) => Promise.all(l.filter((k) => k !== ONBELLEK).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
