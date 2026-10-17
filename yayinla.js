// Yayından önce: manifest.json, sw.js (önbellek adı içerikten) ve uygulama simgeleri (yoksa) üretilir.
//   node yayinla.js          → manifest + service worker (+ eksik simgeler)
//   node yayinla.js --ikon   → simgeleri de yeniden çiz
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const KOK = join(import.meta.dirname, 'public');
const AD = 'BANK OF USY';
const KISA_AD = 'USY';
const RENK_UST = [24, 24, 28];    // #18181c
const RENK_ALT = [12, 13, 16];    // #0c0d10
const ALTIN = [212, 178, 106];    // #d4b26a
const SIMGELER = [180, 192, 512];

// ---------------------------------------------------------------- simge (saf Node PNG)

// Harfler ince çizgiyle, yuvarlak hatlarla çizilir: her harf 0–1 kutusunda nokta dizileri (çizgi parçaları).
const yay = (cx, cy, rx, ry, a0, a1, n = 48) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
});
const HARFLER = {
  U: [[[0, 0], [0, 0.62]], yay(0.5, 0.62, 0.5, 0.38, 180, 0), [[1, 0.62], [1, 0]]],
  S: [yay(0.5, 0.26, 0.46, 0.26, -35, -270), yay(0.5, 0.74, 0.5, 0.26, -90, 145)],
  Y: [[[0, 0], [0.5, 0.48]], [[1, 0], [0.5, 0.48]], [[0.5, 0.48], [0.5, 1]]],
};

// Çizgi: yol boyunca yuvarlak "damgalar" basılır (4× çizilip küçültüldüğü için kenarlar yumuşak).
function cizgiCiz(tuval, W, yol, kalinlik, renk) {
  const r = kalinlik / 2;
  for (let p = 0; p < yol.length - 1; p++) {
    const [x1, y1] = yol[p];
    const [x2, y2] = yol[p + 1];
    const adim = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (r / 2)));
    for (let s = 0; s <= adim; s++) {
      const cx = x1 + ((x2 - x1) * s) / adim;
      const cy = y1 + ((y2 - y1) * s) / adim;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (x < 0 || y < 0 || x >= W || y >= W || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const i = (y * W + x) * 3;
          for (let k = 0; k < 3; k++) tuval[i + k] = renk[k];
        }
      }
    }
  }
}

function yaziCiz(tuval, W, metin, harfG, harfY, aralik, merkezY, kalinlik, renk) {
  const toplam = metin.length * harfG + (metin.length - 1) * aralik;
  let x0 = (W - toplam) / 2;
  const y0 = merkezY - harfY / 2;
  for (const harf of metin) {
    for (const yol of HARFLER[harf]) cizgiCiz(tuval, W, yol.map(([x, y]) => [x0 + x * harfG, y0 + y * harfY]), kalinlik, renk);
    x0 += harfG + aralik;
  }
}

function simgeCiz(boyut) {
  const OS = 4; // kenar yumuşatma için 4× çizip küçült
  const W = boyut * OS;
  const tuval = new Float32Array(W * W * 3);
  for (let y = 0; y < W; y++) {
    const t = y / (W - 1);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) tuval[i + k] = RENK_UST[k] * (1 - t) + RENK_ALT[k] * t;
    }
  }
  // İnce altın halka ve ortada USY (PIN ekranındaki monogram gibi).
  cizgiCiz(tuval, W, yay(W / 2, W / 2, W * 0.36, W * 0.36, 0, 360, 360), W * 0.008, ALTIN);
  yaziCiz(tuval, W, 'USY', W * 0.13, W * 0.2, W * 0.045, W / 2, W * 0.022, ALTIN);
  const piksel = Buffer.alloc(boyut * (boyut * 4 + 1));
  for (let y = 0; y < boyut; y++) {
    piksel[y * (boyut * 4 + 1)] = 0; // filtre yok
    for (let x = 0; x < boyut; x++) {
      const t = [0, 0, 0];
      for (let dy = 0; dy < OS; dy++) for (let dx = 0; dx < OS; dx++) {
        const i = ((y * OS + dy) * W + (x * OS + dx)) * 3;
        for (let k = 0; k < 3; k++) t[k] += tuval[i + k];
      }
      const o = y * (boyut * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) piksel[o + k] = Math.round(t[k] / (OS * OS));
      piksel[o + 3] = 255;
    }
  }
  return pngYaz(boyut, boyut, piksel);
}

const CRC_TABLO = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLO[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function parca(tur, veri) {
  const uz = Buffer.alloc(4);
  uz.writeUInt32BE(veri.length);
  const tv = Buffer.concat([Buffer.from(tur, 'ascii'), veri]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tv));
  return Buffer.concat([uz, tv, crc]);
}
function pngYaz(g, y, ham) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(g, 0);
  ihdr.writeUInt32BE(y, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    parca('IHDR', ihdr),
    parca('IDAT', deflateSync(ham, { level: 9 })),
    parca('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- manifest ve service worker

const ikonZorla = process.argv.includes('--ikon');
for (const b of SIMGELER) {
  const yol = join(KOK, `icon-${b}.png`);
  if (ikonZorla || !existsSync(yol)) {
    writeFileSync(yol, simgeCiz(b));
    console.log(`simge yazıldı: icon-${b}.png`);
  }
}

const manifest = {
  name: AD,
  short_name: KISA_AD,
  lang: 'tr',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#0c0d10',
  theme_color: '#0c0d10',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};
writeFileSync(join(KOK, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const KABUK = ['./', 'index.html', 'app.js', 'hesap.js', 'depo.js', 'yerel-api.js', 'excel.js', 'ice-aktar.js', 'deneme.js', 'vendor/xlsx.full.min.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const ozet = createHash('sha256');
for (const d of KABUK.slice(1)) ozet.update(readFileSync(join(KOK, d)));
const surum = ozet.digest('hex').slice(0, 12);

const sw = `// Üretildi: node yayinla.js — elle değiştirme.
// Uygulama dosyaları önbellekte: internet olmadan da açılır. Veri zaten telefonda (depo.js).
const ONBELLEK = 'usy-${surum}';
const KABUK = ${JSON.stringify(KABUK)};

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
`;
writeFileSync(join(KOK, 'sw.js'), sw);
console.log(`manifest.json ve sw.js yazıldı (önbellek usy-${surum})`);
