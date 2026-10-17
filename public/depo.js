// BANK OF USY — veri telefonda: bütün kayıtlar IndexedDB'de tek bir belge olarak durur.
// Sunucu, bulut, hesap yok. Uygulamayı ana ekrandan silmek veriyi de siler; tek koruma yedektir.
//
// Belge: { surum, ayar: {anahtar: değer}, hesap: [], kategori: [], hedef: [], islem: [], sabit_kalem: [],
//          odeme: [], ay_plani: [], hafta: [] } — satırların alanları eski D1 şemasıyla aynı
//          (bkz. yerel-api.js'teki SATIRLAR). Tutarlar kuruş, tarihler 'YYYY-AA-GG' (Türkiye günü).
// Tek belge olduğu için her yazma bütündür: ya hepsi kaydedilir ya hiçbiri.
// Belge diske PIN'le şifrelenmiş olarak yazılır (aşağıda sifreliKasa).

const AD = 'bank-of-usy';
const SURUM = 1;
const DEPO = 'belge';
const ANAHTAR = 'veri';

let baglanti;

function ac() {
  if (baglanti) return baglanti;
  baglanti = new Promise((coz, red) => {
    const istek = indexedDB.open(AD, SURUM);
    istek.onupgradeneeded = () => istek.result.createObjectStore(DEPO);
    istek.onsuccess = () => coz(istek.result);
    istek.onerror = () => { baglanti = null; red(istek.error); };
  });
  return baglanti;
}

async function islem(kip, fn) {
  const db = await ac();
  return new Promise((coz, red) => {
    const tx = db.transaction(DEPO, kip);
    let sonuc;
    const istek = fn(tx.objectStore(DEPO));
    istek.onsuccess = () => { sonuc = istek.result; };
    tx.oncomplete = () => coz(sonuc);
    tx.onerror = () => red(tx.error);
    tx.onabort = () => red(tx.error || new Error('Kaydedilemedi'));
  });
}

// Telefondaki depo. iOS ana ekran uygulamasında veriyi zaten silmez; yine de kalıcılık istenir.
export function telefonDeposu() {
  try { navigator.storage?.persist?.(); } catch { /* yok say */ }
  return {
    oku: () => islem('readonly', (d) => d.get(ANAHTAR)).then((x) => x ?? null),
    yaz: (belge) => islem('readwrite', (d) => d.put(belge, ANAHTAR)),
  };
}

// ---------------------------------------------------------------- şifreli kasa
// Belge telefonda şifreli durur: anahtar 4 haneli PIN'den türetilir (PBKDF2-SHA256), belge AES-GCM ile şifrelenir.
// PIN hiçbir yere yazılmaz; anahtar yalnız uygulama açıkken bellekte durur. Yanlış PIN şifreyi çözemez.
// PIN unutulursa kayıtlar açılmaz (sunucu yok, sıfırlama yok) — yedek de aynı PIN'le açılır.
// Zarf: { bicim, surum, tur, tuz, iv, veri } — tuz/iv/veri ikili (IndexedDB bunları olduğu gibi saklar).

const BICIM = 'bank-of-usy-kasa';
export const PBKDF2_TUR = 600000;
const kodla = new TextEncoder();
const coz = new TextDecoder();

export const pinGecerli = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);

function hata(mesaj, alanlar) {
  return Object.assign(new Error(mesaj), alanlar);
}

async function anahtarTuret(pin, tuz, tur) {
  const ham = await crypto.subtle.importKey('raw', kodla.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: tuz, iterations: tur }, ham, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function zarfCoz(anahtar, zarf) {
  const acik = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: zarf.iv }, anahtar, zarf.veri);
  return JSON.parse(coz.decode(acik));
}

// ham: { oku, yaz } — zarfı saklayan depo (telefonDeposu ya da bellekDeposu).
export function sifreliKasa(ham, { tur = PBKDF2_TUR } = {}) {
  let anahtar = null;
  let meta = null; // { tur, tuz } — açık zarfın türetme bilgisi

  async function zarfYaz(belge) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const veri = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, anahtar, kodla.encode(JSON.stringify(belge)));
    await ham.yaz({ bicim: BICIM, surum: 1, tur: meta.tur, tuz: meta.tuz, iv, veri });
  }

  return {
    // 'yok' (ilk açılış: PIN belirlenecek) · 'kilitli' (PIN sorulacak) · 'acik'
    async durum() {
      if (!(await ham.oku())) return 'yok';
      return anahtar ? 'acik' : 'kilitli';
    },
    // İlk açılış: PIN belirlenir, ilk belge şifreli yazılır.
    async kur(pin, ilkBelge) {
      if (!pinGecerli(pin)) throw hata('PIN 4 rakam olmalı', { pinHatasi: true });
      if (await ham.oku()) throw hata('PIN zaten belirlenmiş', { pinHatasi: true });
      meta = { tur, tuz: crypto.getRandomValues(new Uint8Array(16)) };
      anahtar = await anahtarTuret(pin, meta.tuz, meta.tur);
      await zarfYaz(ilkBelge);
    },
    async ac(pin) {
      const zarf = await ham.oku();
      if (!zarf) throw hata('Henüz PIN yok', { pinHatasi: true });
      if (zarf.bicim !== BICIM) throw hata('Kayıtlar okunamadı', { pinHatasi: true });
      if (!pinGecerli(pin)) throw hata('PIN yanlış', { pinHatasi: true });
      const a = await anahtarTuret(pin, zarf.tuz, zarf.tur);
      try { await zarfCoz(a, zarf); } catch { throw hata('PIN yanlış', { pinHatasi: true }); }
      anahtar = a;
      meta = { tur: zarf.tur, tuz: zarf.tuz };
    },
    kilitle() { anahtar = null; meta = null; },
    async oku() {
      const zarf = await ham.oku();
      if (!zarf) return null;
      if (!anahtar) throw hata('Kilitli', { kilitli: true });
      return zarfCoz(anahtar, zarf);
    },
    async yaz(belge) {
      if (!anahtar) throw hata('Kilitli', { kilitli: true });
      await zarfYaz(belge);
    },
    // Yedek: şifreli zarfın kendisi (PIN'siz okunamaz).
    zarf: () => ham.oku(),
    // Yedekten geri yükleme: önce yedeğin PIN'iyle çözülür (yanlışsa hiçbir şey değişmez), sonra telefondaki
    // kayıtların yerine yazılır. Bundan sonra PIN, yedeğin PIN'idir.
    async geriYukle(zarf, pin) {
      if (zarf?.bicim !== BICIM) throw hata('Bu bir BANK OF USY yedeği değil', { pinHatasi: true });
      if (!pinGecerli(pin)) throw hata('PIN yanlış', { pinHatasi: true });
      const a = await anahtarTuret(pin, zarf.tuz, zarf.tur);
      let belge;
      try { belge = await zarfCoz(a, zarf); } catch { throw hata('PIN yanlış', { pinHatasi: true }); }
      if (!belge || typeof belge !== 'object' || !belge.ayar || !Array.isArray(belge.islem)) throw hata('Yedek bozuk', { pinHatasi: true });
      await ham.yaz(zarf);
      anahtar = a;
      meta = { tur: zarf.tur, tuz: zarf.tuz };
    },
  };
}

// ---------------------------------------------------------------- yedek dosyası
// Dosya JSON metnidir; içindeki kayıtlar şifreli kalır (tuz, iv, veri base64).

const YEDEK_BICIM = 'bank-of-usy-yedek';

function b64(tampon) {
  const b = new Uint8Array(tampon instanceof ArrayBuffer ? tampon : tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + tampon.byteLength));
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64den = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function yedekMetni(zarf, tarih = new Date().toISOString()) {
  return JSON.stringify({ bicim: YEDEK_BICIM, surum: 1, tarih, kasa: { bicim: zarf.bicim, surum: zarf.surum, tur: zarf.tur, tuz: b64(zarf.tuz), iv: b64(zarf.iv), veri: b64(zarf.veri) } });
}

// Yedek metninden zarf (şifre çözülmez). Biçim tutmazsa hata.
export function yedekOku(metin) {
  let d;
  try { d = JSON.parse(metin); } catch { throw hata('Bu bir BANK OF USY yedeği değil', { pinHatasi: true }); }
  const k = d?.kasa;
  if (d?.bicim !== YEDEK_BICIM || !k?.tuz || !k?.iv || !k?.veri) throw hata('Bu bir BANK OF USY yedeği değil', { pinHatasi: true });
  try {
    return { zarf: { bicim: k.bicim, surum: k.surum, tur: Number(k.tur), tuz: b64den(k.tuz), iv: b64den(k.iv), veri: b64den(k.veri).buffer }, tarih: d.tarih || null };
  } catch {
    throw hata('Yedek bozuk', { pinHatasi: true });
  }
}

// Denemeler için bellekte duran depo (Node'da IndexedDB yok).
export function bellekDeposu(ilk = null) {
  let x = ilk ? structuredClone(ilk) : null;
  return {
    oku: async () => (x ? structuredClone(x) : null),
    yaz: async (belge) => { x = structuredClone(belge); },
  };
}
