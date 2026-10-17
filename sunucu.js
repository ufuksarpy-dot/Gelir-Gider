// Yerel deneme sunucusu: public/ klasörünü http://localhost:8787 adresinde verir (yalnız bu bilgisayar).
// Canlıda sunucu yok; bu dosya yalnız geliştirme için. Çalıştır: node sunucu.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const KOK = join(import.meta.dirname, 'public');
const PORT = Number(process.env.PORT) || 8787;
const TURLER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

createServer(async (istek, yanit) => {
  const yol = decodeURIComponent(new URL(istek.url, 'http://x').pathname);
  const dosya = normalize(join(KOK, yol.endsWith('/') ? `${yol}index.html` : yol));
  if (!dosya.startsWith(KOK)) { yanit.writeHead(403).end(); return; }
  try {
    const icerik = await readFile(dosya);
    yanit.writeHead(200, { 'Content-Type': TURLER[extname(dosya)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(icerik);
  } catch {
    yanit.writeHead(404).end('Yok');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`BANK OF USY yerel: http://localhost:${PORT}/`));
