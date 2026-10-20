// BANK OF USY — BÜTÜN hesaplar burada. Tarayıcı, Worker ve Node aynı dosyayı kullanır.
// Kurallar:
//  - Tutarlar kuruş cinsinden tam sayıdır.
//  - Tarihler 'YYYY-AA-GG' metnidir ve Türkiye günüdür (UTC+3, yaz saati yok).
//  - Bütçe ayı `ay_baslangic_gunu`nde (varsayılan 10) başlar. Tarihi aya bağlayan her şey butceAyi()'ndan geçer.
//  - Bu dosyadaki fonksiyonlar saftır: veri alır, sonuç döndürür; veritabanına yazmaz.

// Para düzeni (2026-10-17'den beri): gelir havuzu (kumbara) yok. Maaş gelince o bütçe ayının giderleri hesapta kalır,
// ayarlardaki aylık yatırım tutarı (± geçen ayın artan bütçesi) yatırıma havale olur, kalanı serbesttir.
// Haftalık kategorilerde artan/aşım "Artan bütçe"de toplanır (bkz. artanButce). Havuz/şelale kodu eski kurulumlar için durur.
export const VARSAYILAN_AYAR = {
  ay_baslangic_gunu: 10,
  havuz_ay: 0,
  yatirim_tutari: 0,
  sela: { birikim: 50, yatirim: 30, serbest: 20 },
  beklenmeyen: 0,
  maas: { tutar: 0, hesap_id: null },
  gelir_kaynaklari: ['Maaş', 'Ek gelir', 'Komisyon', 'Satış'],
  harcama_hesabi: null,
  havuz_hesabi: null,
  birikim_hesabi: null,
  yatirim_hesabi: null,
  kurulum_tarihi: null,
};

export const KOVALAR = [
  { id: 'sabit', ad: 'Sabit ödemeler' },
  { id: 'haftalik', ad: 'Haftalık bütçeler' },
  { id: 'aylik', ad: 'Aylık harcamalar' },
  { id: 'beklenmeyen', ad: 'Beklenmeyen payı' },
  { id: 'is', ad: 'İş giderleri' },
];

export const HESAP_TURLERI = {
  nakit: 'Nakit', vadesiz: 'Vadesiz', havuz: 'Gelir havuzu', birikim: 'Birikim', yatirim: 'Yatırım', kart: 'Kredi kartı',
};

export const BANKALAR = { garanti: 'Garanti BBVA', yapikredi: 'Yapı Kredi' };

// Haftalık kategorilerden artan paranın harcandığı sanal kategori (kategori tablosunda yok).
export const ARTAN_KATEGORI = 'artan-butce';
export const ARTAN_AD = 'Artan bütçe';

const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUN_ADLARI = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

// ---------------------------------------------------------------- tarih

const iki = (n) => String(n).padStart(2, '0');

export function bugun(simdi = Date.now()) {
  return new Date(simdi + 3 * 3600e3).toISOString().slice(0, 10);
}

function parcala(t) {
  return [Number(t.slice(0, 4)), Number(t.slice(5, 7)), Number(t.slice(8, 10))];
}

export function ayinSonGunu(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function ekleGun(t, n) {
  const [y, m, d] = parcala(t);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function gunFarki(a, b) {
  const [y1, m1, d1] = parcala(a);
  const [y2, m2, d2] = parcala(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400e3);
}

// 'YYYY-AA' ayına n ay ekler.
export function ekleAy(ay, n) {
  const y = Number(ay.slice(0, 4));
  const m = Number(ay.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  return `${yy}-${iki(((m % 12) + 12) % 12 + 1)}`;
}

// Takvim ayında `gun`. gün; ay kısaysa ayın son günü.
export function aydaGun(ay, gun) {
  const y = Number(ay.slice(0, 4));
  const m = Number(ay.slice(5, 7));
  return `${ay}-${iki(Math.min(gun, ayinSonGunu(y, m)))}`;
}

// Tarihe n takvim ayı ekler (31 Ocak + 1 ay = 28/29 Şubat).
export function ekleAyTarih(t, n) {
  return aydaGun(ekleAy(t.slice(0, 7), n), Number(t.slice(8, 10)));
}

export function haftaGunu(t) {
  const [y, m, d] = parcala(t);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = pazartesi
}

export function pazartesi(t) {
  return ekleGun(t, -haftaGunu(t));
}

export function tarihYaz(t, uzun = false) {
  const [y, m, d] = parcala(t);
  const s = `${d} ${AY_ADLARI[m - 1]}`;
  return uzun ? `${s} ${y}, ${GUN_ADLARI[haftaGunu(t)]}` : s;
}

// ---------------------------------------------------------------- bütçe ayı

function baslangicGunu(ayar) {
  const g = Number(ayar?.ay_baslangic_gunu ?? 10);
  return g >= 1 && g <= 28 ? g : 10;
}

// Tarihin bütçe ayı ('YYYY-AA'). Gün >= başlangıç günü ise o takvim ayı, değilse bir önceki.
export function butceAyi(t, ayar) {
  const g = baslangicGunu(ayar);
  const ay = t.slice(0, 7);
  return Number(t.slice(8, 10)) >= g ? ay : ekleAy(ay, -1);
}

export function ayAraligi(ay, ayar) {
  const g = baslangicGunu(ayar);
  const bas = `${ay}-${iki(g)}`;
  const son = ekleGun(`${ekleAy(ay, 1)}-${iki(g)}`, -1);
  return { bas, son };
}

export function ayAdi(ay) {
  return `${AY_ADLARI[Number(ay.slice(5, 7)) - 1]} ${ay.slice(0, 4)}`;
}

export function ayAraligiYaz(ay, ayar) {
  const { bas, son } = ayAraligi(ay, ayar);
  return `${tarihYaz(bas)} – ${tarihYaz(son)}`;
}

export function kurulumAyi(ayar) {
  return ayar?.kurulum_tarihi ? butceAyi(ayar.kurulum_tarihi, ayar) : null;
}

// Hafta, perşembesinin düştüğü bütçe ayına aittir. Kurulum haftası kurulum ayına aittir.
export function haftaAyi(pzt, ayar) {
  const k = ayar?.kurulum_tarihi;
  if (k && pazartesi(k) === pzt) return butceAyi(k, ayar);
  return butceAyi(ekleGun(pzt, 3), ayar);
}

export function ayHaftalari(ay, ayar) {
  const { bas, son } = ayAraligi(ay, ayar);
  const ilk = ayar?.kurulum_tarihi ? pazartesi(ayar.kurulum_tarihi) : null;
  const sonuc = [];
  for (let p = ekleGun(pazartesi(bas), -7); p <= son; p = ekleGun(p, 7)) {
    if (ilk && p < ilk) continue;
    if (haftaAyi(p, ayar) === ay) sonuc.push(p);
  }
  return sonuc;
}

// Haftanın, ait olduğu bütçe ayındaki sırası (1'den). Kurulum ayında ilk hafta kurulum haftasıdır.
export function haftaNo(pzt, ayar) {
  return ayHaftalari(haftaAyi(pzt, ayar), ayar).indexOf(pzt) + 1;
}

// Kurulum haftasında yalnız kalan günler sayılır.
export function haftaOrani(pzt, ayar) {
  const k = ayar?.kurulum_tarihi;
  if (!k) return 1;
  if (pazartesi(k) === pzt) return (7 - haftaGunu(k)) / 7;
  return pzt < pazartesi(k) ? 0 : 1;
}

// Kurulum ayında aylık limitler kalan günlere göre orantılanır.
export function ayOrani(ay, ayar) {
  const k = ayar?.kurulum_tarihi;
  if (!k) return 1;
  const ka = butceAyi(k, ayar);
  if (ay < ka) return 0;
  if (ay > ka) return 1;
  const { bas, son } = ayAraligi(ay, ayar);
  return (gunFarki(k, son) + 1) / (gunFarki(bas, son) + 1);
}

// ---------------------------------------------------------------- para

const sayiBicimi = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tamBicim = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

export function paraYaz(kurus, { kisa = false, isaret = false } = {}) {
  const n = Number(kurus) || 0;
  const mutlak = Math.abs(n);
  const metin = kisa && mutlak % 100 === 0 ? tamBicim.format(mutlak / 100) : sayiBicimi.format(mutlak / 100);
  const on = n < 0 ? '−' : isaret && n > 0 ? '+' : '';
  return `${on}${metin} ₺`;
}

// "1.234,56" · "1234,5" · "1234.56" · "1234" → kuruş. Okunamazsa null.
export function paraOku(metin) {
  if (metin == null) return null;
  let s = String(metin).replace(/[₺\s]/g, '');
  if (!s) return null;
  const eksi = s.startsWith('-') || s.startsWith('−');
  s = s.replace(/^[-−+]/, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [tam, kesir = ''] = s.split('.');
  const k = Number(tam) * 100 + Number((kesir + '00').slice(0, 2));
  return eksi ? -k : k;
}

// Oranla çarpıp kuruşa yuvarlar.
const yuvarla = (x) => Math.round(x);

// ---------------------------------------------------------------- güvenlik: kart numarası

function luhn(rakamlar) {
  let t = 0;
  for (let i = 0; i < rakamlar.length; i++) {
    let d = Number(rakamlar[rakamlar.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    t += d;
  }
  return t % 10 === 0;
}

// Metinde 15–16 haneli, Luhn'a uyan bir sayı (boşluk/tire olabilir) var mı?
export function kartNoVarMi(metin) {
  if (!metin) return false;
  const adaylar = String(metin).match(/\d(?:[ -]?\d){13,22}/g) || [];
  for (const a of adaylar) {
    const r = a.replace(/\D/g, '');
    for (const uz of [15, 16]) {
      for (let i = 0; i + uz <= r.length; i++) if (luhn(r.slice(i, i + uz))) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- yardımcılar

const aktifler = (liste) => (liste || []).filter((x) => x.aktif !== 0 && x.aktif !== false);
const canli = (islemler) => (islemler || []).filter((i) => !i.silindi);
const toplam = (liste, f = (x) => x) => liste.reduce((t, x) => t + (f(x) || 0), 0);

export function ayarBirlestir(ayar) {
  return { ...VARSAYILAN_AYAR, ...(ayar || {}), sela: { ...VARSAYILAN_AYAR.sela, ...(ayar?.sela || {}) }, maas: { ...VARSAYILAN_AYAR.maas, ...(ayar?.maas || {}) } };
}

function haritala(liste) {
  const m = new Map();
  for (const x of liste || []) m.set(x.id, x);
  return m;
}

// ---------------------------------------------------------------- taksit

// Taksitli harcamanın payları: ilk pay küsuratı taşır, sonraki paylar birer ay arayla.
export function taksitPaylari(islem) {
  const n = Math.max(1, Number(islem.taksit) || 1);
  const pay = Math.floor(islem.tutar / n);
  const ilk = islem.tutar - pay * (n - 1);
  const sonuc = [];
  for (let i = 0; i < n; i++) sonuc.push({ sira: i + 1, tarih: ekleAyTarih(islem.tarih, i), tutar: i === 0 ? ilk : pay });
  return sonuc;
}

// Harcamanın bütçeye düşen ilk payı (taksitsizse tamamı).
export function butcePayi(islem) {
  return taksitPaylari(islem)[0].tutar;
}

// ---------------------------------------------------------------- sabit kalemler

// Yeni sabit ödemenin ilk ayı: `baz` gününden (bugün ya da geçmiş başlangıç günü) sonraki ilk vade.
export function sabitIlkAy(gun, baz) {
  const ay = baz.slice(0, 7);
  return aydaGun(ay, Number(gun)) >= baz ? ay : ekleAy(ay, 1);
}

// Kalemin [bas, son] aralığındaki vade tarihleri.
export function sabitVadeleri(kalem, bas, son) {
  const sonuc = [];
  const periyot = Number(kalem.periyot) || 1;
  let ay = kalem.ilk_ay;
  // Aralığın başına yaklaş (çok eski ilk_ay için döngüyü kısalt).
  const fark = (Number(bas.slice(0, 4)) - Number(ay.slice(0, 4))) * 12 + Number(bas.slice(5, 7)) - Number(ay.slice(5, 7));
  if (fark > periyot) ay = ekleAy(ay, Math.floor((fark - 1) / periyot) * periyot);
  for (let i = 0; i < 1000; i++) {
    const vade = aydaGun(ay, Number(kalem.gun));
    if (vade > son) break;
    if (kalem.son_vade && vade > kalem.son_vade) break;
    if (vade >= bas) sonuc.push(vade);
    ay = ekleAy(ay, periyot);
  }
  return sonuc;
}

// ---------------------------------------------------------------- bakiyeler

// Telefona eski hareketler gönderilmez; onların etkisi `devir` olarak gelir.
export function bakiyeler(veri) {
  const b = new Map();
  for (const h of veri.hesaplar || []) b.set(h.id, (Number(h.acilis_bakiye) || 0) + (Number(h.devir) || 0));
  const ekle = (id, x) => { if (id && b.has(id)) b.set(id, b.get(id) + x); };
  for (const i of canli(veri.islemler)) {
    if (i.tur === 'gider') ekle(i.kaynak_id, -i.tutar);
    else if (i.tur === 'gelir') ekle(i.hedef_id, i.tutar);
    else if (i.tur === 'transfer') { ekle(i.kaynak_id, -i.tutar); ekle(i.hedef_id, i.tutar); }
    else if (i.tur === 'duzeltme') ekle(i.hedef_id, i.tutar);
  }
  return b;
}

// Bekleyen havale ve ödemeler yapılınca hesapta kalacak para.
export function beklenenBakiyeler(veri) {
  const b = bakiyeler(veri);
  for (const o of veri.odemeler || []) {
    if (o.durum !== 'bekliyor') continue;
    if (o.kaynak_id && b.has(o.kaynak_id)) b.set(o.kaynak_id, b.get(o.kaynak_id) - o.tutar);
    if (o.tur !== 'sabit' && o.hedef_id && b.has(o.hedef_id)) b.set(o.hedef_id, b.get(o.hedef_id) + o.tutar);
  }
  return b;
}

// Hedefe ayrılan para: hedef_ref'li hareketler (birikime giren +, çıkan −).
export function hedefBirikimleri(veri) {
  const m = new Map();
  for (const h of veri.hedefler || []) m.set(h.id, Number(h.devir) || 0);
  for (const i of canli(veri.islemler)) {
    if (!i.hedef_ref || !m.has(i.hedef_ref)) continue;
    const hedef = (veri.hedefler || []).find((x) => x.id === i.hedef_ref);
    const hesapId = hedef?.hesap_id;
    let x = 0;
    if (i.tur === 'transfer') x = i.hedef_id === hesapId ? i.tutar : i.kaynak_id === hesapId ? -i.tutar : i.tutar;
    else if (i.tur === 'gelir' || i.tur === 'duzeltme') x = i.tutar;
    else if (i.tur === 'gider') x = -i.tutar;
    m.set(i.hedef_ref, m.get(i.hedef_ref) + x);
  }
  return m;
}

// ---------------------------------------------------------------- aylık ihtiyaç ve havuz

// Aylık ihtiyaç = sabit kalemler (periyoda bölünmüş) + haftalık × 52/12 + aylık limitler + beklenmeyen payı.
export function aylikIhtiyac(veri) {
  const ayar = ayarBirlestir(veri.ayar);
  const kat = aktifler(veri.kategoriler);
  const sabit = toplam(aktifler(veri.sabitler).filter((s) => !s.aile), (s) => s.tutar / (Number(s.periyot) || 1));
  const haftalik = toplam(kat.filter((k) => k.tur === 'haftalik'), (k) => k.limit_tutar) * 52 / 12;
  const aylik = toplam(kat.filter((k) => k.tur === 'aylik'), (k) => k.limit_tutar);
  return yuvarla(sabit + haftalik + aylik + (Number(ayar.beklenmeyen) || 0));
}

export function havuzHedefi(veri) {
  const ayar = ayarBirlestir(veri.ayar);
  return aylikIhtiyac(veri) * (Number(ayar.havuz_ay) || 0);
}

// Gelir şelalesi: önce havuz hedefe dolar, artan oranla bölünür. Toplam her zaman gelire eşittir.
export function sela(gelir, havuzBakiye, hedef, oranlar) {
  const havuz = Math.min(gelir, Math.max(0, hedef - havuzBakiye));
  const artan = gelir - havuz;
  const o = oranlar || VARSAYILAN_AYAR.sela;
  const birikim = yuvarla(artan * (Number(o.birikim) || 0) / 100);
  const yatirim = yuvarla(artan * (Number(o.yatirim) || 0) / 100);
  return { havuz, birikim, yatirim, serbest: artan - birikim - yatirim };
}

export function selaHesapla(veri, gelir) {
  const ayar = ayarBirlestir(veri.ayar);
  const bb = beklenenBakiyeler(veri);
  const havuzBakiye = ayar.havuz_hesabi ? bb.get(ayar.havuz_hesabi) || 0 : 0;
  return sela(gelir, havuzBakiye, havuzHedefi(veri), ayar.sela);
}

export function havuzDurumu(veri) {
  const ayar = ayarBirlestir(veri.ayar);
  const bakiye = ayar.havuz_hesabi ? beklenenBakiyeler(veri).get(ayar.havuz_hesabi) || 0 : 0;
  const ihtiyac = aylikIhtiyac(veri);
  const hedef = ihtiyac * (Number(ayar.havuz_ay) || 0);
  const maas = Number(ayar.maas?.tutar) || 0;
  const sonuc = { bakiye, hedef, ihtiyac, maas, kacAy: ihtiyac > 0 ? bakiye / ihtiyac : null, doluluk: hedef > 0 ? bakiye / hedef : null };
  // Maaş gelmeye devam ederse: aylık fark ve havuzun bitme süresi (düzensiz gelir katılmaz).
  sonuc.maaslaFark = maas - ihtiyac;
  sonuc.maaslaKacAy = maas >= ihtiyac ? null : ihtiyac > 0 ? bakiye / (ihtiyac - maas) : null;
  return sonuc;
}

// ---------------------------------------------------------------- harcamaların kovası

// Bir giderin hangi kovaya ve hangi kategoriye düştüğü.
// "Ailem ödüyor" harcaması bütçeye girmez (kart borcunda görünür, aileden alacak olur).
// Artan bütçeden yapılan harcama haftalık kovanın gerçekleşenine yazılır ama haftanın limitinden düşmez.
export function giderKovasi(islem, kategoriler) {
  if (islem.aile) return null;
  if (islem.odeme_id) return null; // sabit ödeme / havale: ayrı sayılır
  if (islem.kategori_id === ARTAN_KATEGORI) return 'artan';
  const k = kategoriler.get(islem.kategori_id);
  if (k?.is_gideri) return 'is';
  if (islem.plan_disi || !k) return 'beklenmeyen';
  return k.tur === 'haftalik' ? 'haftalik' : 'aylik';
}

// ---------------------------------------------------------------- hafta

// Haftanın limitleri. Artan bütçe eksiye düştüyse o haftaya kısma yazılır (bkz. kismaDagit) ve limitten düşülür.
export function haftaLimitleri(veri, pzt, { kismasiz = false } = {}) {
  const ayar = ayarBirlestir(veri.ayar);
  const oran = haftaOrani(pzt, ayar);
  const kisma = kismasiz ? {} : veri.kismalar?.[pzt] || {};
  const l = {};
  for (const k of aktifler(veri.kategoriler)) {
    if (k.tur === 'haftalik' && !k.is_gideri) l[k.id] = Math.max(0, yuvarla(k.limit_tutar * oran) - (Number(kisma[k.id]) || 0));
  }
  return l;
}

export function haftaHarcamalari(veri, pzt) {
  const kat = haritala(veri.kategoriler);
  const son = ekleGun(pzt, 6);
  const h = {};
  for (const i of canli(veri.islemler)) {
    if (i.tur !== 'gider' || i.tarih < pzt || i.tarih > son) continue;
    if (giderKovasi(i, kat) !== 'haftalik') continue;
    h[i.kategori_id] = (h[i.kategori_id] || 0) + butcePayi(i);
  }
  return h;
}

// Haftanın durumu. Kapanmış hafta dondurulmuş değerleri kullanır.
export function haftaDurumu(veri, pzt, gun) {
  const kapali = (veri.haftalar || []).find((h) => h.pazartesi === pzt);
  const limitler = kapali ? JSON.parse(kapali.limitler) : haftaLimitleri(veri, pzt);
  const harcanan = haftaHarcamalari(veri, pzt);
  const kat = haritala(veri.kategoriler);
  const idler = new Set([...Object.keys(limitler), ...Object.keys(harcanan)]);
  const satirlar = [...idler].map((id) => {
    const limit = limitler[id] || 0;
    const h = harcanan[id] || 0;
    return { kategori_id: id, ad: kat.get(id)?.ad || '?', simge: kat.get(id)?.simge || '', limit, harcanan: h, kalan: limit - h };
  }).sort((a, b) => (kat.get(a.kategori_id)?.sira ?? 0) - (kat.get(b.kategori_id)?.sira ?? 0));
  const limit = toplam(satirlar, (s) => s.limit);
  const harcananT = toplam(satirlar, (s) => s.harcanan);
  const son = ekleGun(pzt, 6);
  let kalanGun = 7;
  if (gun) kalanGun = gun > son ? 0 : gun < pzt ? 7 : gunFarki(gun, son) + 1;
  const kalan = limit - harcananT;
  return {
    pazartesi: pzt, pazar: son, kapali: !!kapali, satirlar, limit, harcanan: harcananT, kalan, kalanGun,
    gunluk: kalanGun > 0 ? Math.max(0, Math.floor(kalan / kalanGun)) : 0,
    fark: kapali ? kapali.fark : kalan,
  };
}

// Hafta kapanışı: limitler ve harcamalar dondurulur; net fark (artı ya da eksi) artan bütçeye yazılır.
export function haftaKapanisi(veri, pzt) {
  const limitler = haftaLimitleri(veri, pzt);
  const harcanan = haftaHarcamalari(veri, pzt);
  const fark = toplam(Object.values(limitler)) - toplam(Object.values(harcanan));
  return { limitler, harcanan, fark };
}

// ---------------------------------------------------------------- artan bütçe
// Artan bütçe = kapanan haftaların farkları (o haftaya yazılan kısma geri eklenerek, çünkü kısma
// eski bir açığın ödenmesidir) − artan bütçeden yapılan harcamalar − maaş günü yatırıma aktarılanlar.
// Artıysa harcanabilir; eksiyse sonraki haftanın limitleri kısılır; maaş günü yatırım tutarına eklenir/düşülür.
// "Ay sonundan düş" işaretli haftanın açığı artan bütçeye yazılmaz (sonraki haftayı kısmaz, yatırımdan
// düşmez): para zaten harcandı, yalnız ay sonunda hesapta kalan azalır. Artısı yine artan bütçeye gider.
export function artanButce(veri) {
  let t = 0;
  for (const h of veri.haftalar || []) {
    const k = veri.kismalar?.[h.pazartesi];
    const fark = Number(h.fark);
    t += (veri.aySonundan?.[h.pazartesi] ? Math.max(0, fark) : fark) + (k ? toplam(Object.values(k), Number) : 0);
  }
  for (const i of canli(veri.islemler)) if (i.tur === 'gider' && !i.aile && i.kategori_id === ARTAN_KATEGORI) t -= butcePayi(i);
  t -= Number(veri.artanEskiHarcama) || 0; // telefona gönderilmeyen eski harcamalar (yerel-api)
  for (const a of veri.artanAktarimlari || []) t -= Number(a.tutar);
  return t;
}

// Bu haftanın kısması: kapanan haftalardan kalan açık (eksi artan bütçe). "Ay sonundan düş" değişince yeniden hesaplanır.
export function buHaftaKismasi(veri, gun) {
  const artan = artanButce(veri);
  return artan < 0 ? kismaDagit(veri, pazartesi(gun), -artan) : {};
}

// Bu haftanın açığından sonraki haftaya yazılacak kısmanın tahmini (hafta kapanınca bakım yazar; bkz. bakimAdimlari 3b).
// "Ay sonundan düş" işaretliyse açık sayılmaz. `hepsiHarcanir`: kalan limitler de harcanırsa (ay sonu tahmini böyle
// varsayar) hafta yalnız aşımlar kadar eksiye düşer; yoksa şimdiki net fark (başka kategoride kalan para aşımı kapatır).
export function sonrakiHaftaKismasi(veri, gun, { hepsiHarcanir = false } = {}) {
  const pzt = pazartesi(gun);
  const h = haftaDurumu(veri, pzt, gun);
  if (h.kapali) return {};
  const buKisma = toplam(Object.values(veri.kismalar?.[pzt] || {}), Number);
  const net = hepsiHarcanir ? toplam(h.satirlar, (s) => Math.min(0, s.kalan)) : h.kalan;
  const fark = veri.aySonundan?.[pzt] ? Math.max(0, net) : net;
  const t = artanButce(veri) + fark + buKisma;
  return t < 0 ? kismaDagit(veri, ekleGun(pzt, 7), -t) : {};
}

// Haftanın açığı (limitin üstünde harcanan, net): kapanmışsa dondurulmuş fark, sürüyorsa şimdiki kalan.
export function haftaAcigi(veri, pzt, gun) {
  return Math.max(0, -haftaDurumu(veri, pzt, gun).fark);
}

// Bütçe ayında "ay sonundan düş" işaretli haftaların açıkları toplamı (ay sonu tahmini dökümünde gösterilir).
export function aySonundanDusulen(veri, ay, gun) {
  const ayar = ayarBirlestir(veri.ayar);
  return toplam(ayHaftalari(ay, ayar).filter((p) => veri.aySonundan?.[p] && p <= pazartesi(gun)), (p) => haftaAcigi(veri, p, gun));
}

// Açığı haftalık kategorilere limitleriyle orantılı paylaştırır (tam lira; küsurat en büyük limite).
// Bir kategori kendi limitinden fazla kısılmaz; sığmayan açık artan bütçede kalır.
export function kismaDagit(veri, pzt, acik) {
  const limitler = haftaLimitleri(veri, pzt, { kismasiz: true });
  const idler = Object.keys(limitler).filter((id) => limitler[id] > 0).sort((a, b) => limitler[b] - limitler[a]);
  const top = toplam(idler.map((id) => limitler[id]));
  const hedef = Math.min(Math.max(0, acik), top);
  const d = {};
  if (!hedef) return d;
  let dagitilan = 0;
  for (const id of idler) { d[id] = Math.min(limitler[id], Math.floor((hedef * limitler[id]) / top / 100) * 100); dagitilan += d[id]; }
  for (const id of idler) { // küsurat
    const ek = Math.min(hedef - dagitilan, limitler[id] - d[id]);
    if (ek > 0) { d[id] += ek; dagitilan += ek; }
  }
  return d;
}

// ---------------------------------------------------------------- aile
// "Ailem ödüyor" harcamaları (ve öyle işaretli sabit ödemeler) aileden alacaktır; aileden gelen para (gelir, aile=1) alacağı kapatır.
export function aileAlacagi(veri) {
  let t = 0;
  for (const i of canli(veri.islemler)) {
    if (!i.aile) continue;
    if (i.tur === 'gider') t += i.tutar;
    else if (i.tur === 'gelir') t -= i.tutar;
  }
  return t + (Number(veri.aileDevir) || 0);
}

// ---------------------------------------------------------------- ay planı

// Ayın plan kalemleri (dondurulmamış hali).
export function ayPlanKalemleri(veri, ay) {
  const ayar = ayarBirlestir(veri.ayar);
  const { bas, son } = ayAraligi(ay, ayar);
  const altSinir = ayar.kurulum_tarihi && ayar.kurulum_tarihi > bas ? ayar.kurulum_tarihi : bas;
  const oran = ayOrani(ay, ayar);
  const kalemler = [];
  if (oran === 0) return kalemler;

  for (const s of aktifler(veri.sabitler)) {
    if (s.aile) continue; // ailenin ödediği sabit ödeme bütçeye girmez
    for (const v of sabitVadeleri(s, altSinir, son)) {
      kalemler.push({ kalem: `sabit:${s.id}:${v}`, kova: s.is_gideri ? 'is' : 'sabit', ad: `${s.ad} (${tarihYaz(v)})`, plan: s.tutar });
    }
  }
  const kat = haritala(veri.kategoriler);
  for (const i of canli(veri.islemler)) {
    if (i.tur !== 'gider' || !(i.taksit > 1) || i.aile) continue;
    for (const p of taksitPaylari(i).slice(1)) {
      if (p.tarih < altSinir || p.tarih > son) continue;
      const k = kat.get(i.kategori_id);
      kalemler.push({ kalem: `taksit:${i.id}:${p.sira}`, kova: k?.is_gideri ? 'is' : 'sabit', ad: `${k?.ad || 'Taksit'} ${p.sira}/${i.taksit}`, plan: p.tutar });
    }
  }
  const haftalar = ayHaftalari(ay, ayar);
  for (const k of aktifler(veri.kategoriler)) {
    if (k.tur === 'haftalik' && !k.is_gideri) {
      const plan = toplam(haftalar, (p) => yuvarla(k.limit_tutar * haftaOrani(p, ayar)));
      kalemler.push({ kalem: `kat:${k.id}`, kova: 'haftalik', ad: `${k.ad} (${haftalar.length} hafta)`, plan });
    } else {
      kalemler.push({ kalem: `kat:${k.id}`, kova: k.is_gideri ? 'is' : 'aylik', ad: k.ad, plan: yuvarla(k.limit_tutar * oran) });
    }
  }
  if (Number(ayar.beklenmeyen) > 0) kalemler.push({ kalem: 'beklenmeyen', kova: 'beklenmeyen', ad: 'Beklenmeyen payı', plan: yuvarla(ayar.beklenmeyen * oran) });
  return kalemler;
}

// Aylık çekiş = o bütçe ayının bütün plan kalemleri.
export function aylikCekis(veri, ay) {
  return toplam(ayPlanKalemleri(veri, ay), (k) => k.plan);
}

// Ay planı: kova başına plan ve gerçekleşen. Dondurulmuş plan varsa o kullanılır.
export function ayPlani(veri, ay) {
  const ayar = ayarBirlestir(veri.ayar);
  const { bas, son } = ayAraligi(ay, ayar);
  const donmus = (veri.ayPlanlari || []).filter((p) => p.ay === ay);
  const kalemler = donmus.length ? donmus.map((p) => ({ kalem: p.kalem, kova: p.kova, ad: p.ad, plan: p.plan })) : ayPlanKalemleri(veri, ay);
  const kovalar = {};
  for (const k of KOVALAR) kovalar[k.id] = { ...k, plan: 0, gercek: 0, kalemler: [], hareketler: [] };
  for (const k of kalemler) { kovalar[k.kova].plan += k.plan; kovalar[k.kova].kalemler.push(k); }

  const kat = haritala(veri.kategoriler);
  const sabitler = haritala(veri.sabitler);
  const islemler = haritala(veri.islemler);
  const haftalar = new Set(ayHaftalari(ay, ayar));

  for (const i of canli(veri.islemler)) {
    if (i.tur !== 'gider') continue;
    const kova = giderKovasi(i, kat);
    if (kova === 'haftalik') {
      if (!haftalar.has(pazartesi(i.tarih))) continue;
    } else if (kova) {
      if (i.tarih < bas || i.tarih > son) continue;
    } else continue;
    const hedefKova = kova === 'artan' ? 'haftalik' : kova; // artan bütçe haftalık paradır
    kovalar[hedefKova].gercek += butcePayi(i);
    kovalar[hedefKova].hareketler.push(i);
  }
  // Taksit payları: planla aynı (ödenmiş sayılır).
  for (const i of canli(veri.islemler)) {
    if (i.tur !== 'gider' || !(i.taksit > 1) || i.aile) continue;
    for (const p of taksitPaylari(i).slice(1)) {
      if (p.tarih < bas || p.tarih > son) continue;
      if (ayar.kurulum_tarihi && p.tarih < ayar.kurulum_tarihi) continue;
      kovalar[kat.get(i.kategori_id)?.is_gideri ? 'is' : 'sabit'].gercek += p.tutar;
    }
  }
  // Sabit ödemeler: vadesi bu aya düşen, yapılmış ödemeler.
  for (const o of veri.odemeler || []) {
    if (o.tur !== 'sabit' || o.durum !== 'yapildi' || o.vade < bas || o.vade > son) continue;
    if (sabitler.get(o.ref_id)?.aile) continue;
    const tutar = islemler.get(o.islem_id)?.tutar ?? o.tutar;
    kovalar[sabitler.get(o.ref_id)?.is_gideri ? 'is' : 'sabit'].gercek += tutar;
  }
  const liste = KOVALAR.map((k) => kovalar[k.id]);
  return {
    ay, bas, son, ad: ayAdi(ay), donmus: donmus.length > 0, kovalar: liste,
    plan: toplam(liste, (k) => k.plan), gercek: toplam(liste, (k) => k.gercek),
    haftalar: [...haftalar],
  };
}

// ---------------------------------------------------------------- kart dönemi

// Kartın kesim tarihleri ve son ödeme tarihleri. Son ödeme günü kesimden küçükse ertesi aydadır.
export function kartDonemi(kart, kesimAy) {
  const kesim = aydaGun(kesimAy, Number(kart.kesim_gunu));
  const onceki = aydaGun(ekleAy(kesimAy, -1), Number(kart.kesim_gunu));
  const sog = Number(kart.son_odeme_gunu);
  const sonOdeme = sog > Number(kart.kesim_gunu) ? aydaGun(kesimAy, sog) : aydaGun(ekleAy(kesimAy, 1), sog);
  return { bas: ekleGun(onceki, 1), kesim, sonOdeme };
}

// Dönem borcu tahmini (ekstre okuyucu gelene kadar): dönemdeki peşin harcamalar + döneme düşen taksit payları − iadeler.
export function kartDonemBorcu(veri, kart, donem) {
  let t = 0;
  for (const i of canli(veri.islemler)) {
    if (i.kaynak_id !== kart.id || i.tur !== 'gider') continue;
    for (const p of taksitPaylari(i)) if (p.tarih >= donem.bas && p.tarih <= donem.kesim) t += p.tutar;
  }
  return t;
}

// Ekstre ödemesi: dönem borcu; kartın açılış günü bu dönemdeyse açılıştaki borç da eklenir (o güne kadar
// karta yapılan ödemeler düşülerek). Açılış günü kurulumdaki kartlarda başlangıç günüdür.
export function kartOdemesi(veri, kart, donem) {
  let t = kartDonemBorcu(veri, kart, donem);
  const acilisGunu = kart.acilis_tarihi || ayarBirlestir(veri.ayar).kurulum_tarihi;
  const acilisBorcu = -(Number(kart.acilis_bakiye) || 0);
  if (acilisBorcu > 0 && acilisGunu && acilisGunu >= donem.bas && acilisGunu <= donem.kesim) {
    const odenen = toplam(canli(veri.islemler).filter((i) => i.tur === 'transfer' && i.hedef_id === kart.id && i.tarih <= donem.kesim), (i) => i.tutar);
    t += Math.max(0, acilisBorcu - odenen);
  }
  return t;
}

// Son ödeme gününden dönemi bulur (kesim ayı son ödemenin ayı ya da bir öncesi).
export function sonOdemeDonemi(kart, sonOdeme) {
  for (const ay of [sonOdeme.slice(0, 7), ekleAy(sonOdeme.slice(0, 7), -1)]) {
    const d = kartDonemi(kart, ay);
    if (d.sonOdeme === sonOdeme) return d;
  }
  return null;
}

// ---------------------------------------------------------------- bakım

const odemeKimligi = {
  sabit: (kalemId, vade) => `sabit:${kalemId}:${vade}`,
  cekis: (ay) => `cekis:${ay}`,
  hafta: (pzt) => `hafta:${pzt}`,
  kart: (kartId, sonOdeme) => `kart:${kartId}:${sonOdeme}`,
};
export { odemeKimligi };

// Bugüne kadar yapılması gereken bakım. Worker sonuçları "INSERT OR IGNORE" ile yazar; aynı gün iki kez çalışsa da sonuç aynıdır.
// Dönüş: { ayPlanlari, odemeler, otomatikler: [{odeme_id, islem}], haftalar }
export function bakimAdimlari(veri, gun, simdiIso = new Date().toISOString()) {
  const ayar = ayarBirlestir(veri.ayar);
  const sonuc = { ayPlanlari: [], odemeler: [], otomatikler: [], haftalar: [] };
  const k = ayar.kurulum_tarihi;
  if (!k || gun < k) return sonuc;
  const mevcutOdeme = new Set((veri.odemeler || []).map((o) => o.id));
  const yeniOdeme = (o) => { if (!mevcutOdeme.has(o.id)) { mevcutOdeme.add(o.id); sonuc.odemeler.push({ durum: 'bekliyor', olusturma: simdiIso, hedef_ref: null, ref_id: null, ...o }); } };
  // Uzun süre açılmazsa kaçırmamak için son bakımdan bir hafta öncesine kadar bakılır.
  const altSinir = ayar.son_bakim && ekleGun(ayar.son_bakim, -7) > k ? ekleGun(ayar.son_bakim, -7) : k;

  // 1 · Ay planı ve aylık çekiş
  const donmusAylar = new Set((veri.ayPlanlari || []).map((p) => p.ay));
  for (let ay = butceAyi(k, ayar); ay <= butceAyi(gun, ayar); ay = ekleAy(ay, 1)) {
    if (donmusAylar.has(ay)) continue;
    const kalemler = ayPlanKalemleri(veri, ay);
    for (const x of kalemler) sonuc.ayPlanlari.push({ ay, ...x });
    if (!kalemler.length) sonuc.ayPlanlari.push({ ay, kalem: 'bos', kova: 'beklenmeyen', ad: 'Plan boş', plan: 0 });
    const tutar = toplam(kalemler, (x) => x.plan);
    const { bas } = ayAraligi(ay, ayar);
    if (tutar > 0 && ayar.havuz_hesabi && ayar.harcama_hesabi && ayar.havuz_hesabi !== ayar.harcama_hesabi) {
      yeniOdeme({ id: odemeKimligi.cekis(ay), tur: 'havale', sebep: 'cekis', ref_id: ay, vade: bas > k ? bas : k, ad: `Aylık çekiş · ${ayAdi(ay)}`, tutar, kaynak_id: ayar.havuz_hesabi, hedef_id: ayar.harcama_hesabi });
    }
  }

  // 2 · Sabit ödemeler (14 gün ileriye kadar) ve otomatik olanların işlenmesi
  const ufuk = ekleGun(gun, 14);
  const odemeler = new Map((veri.odemeler || []).map((o) => [o.id, o]));
  for (const s of aktifler(veri.sabitler)) {
    for (const v of sabitVadeleri(s, altSinir, ufuk)) {
      const id = odemeKimligi.sabit(s.id, v);
      yeniOdeme({ id, tur: 'sabit', sebep: 'sabit', ref_id: s.id, vade: v, ad: s.ad, tutar: s.tutar, kaynak_id: s.hesap_id || ayar.harcama_hesabi, hedef_id: null });
      const o = odemeler.get(id) || sonuc.odemeler.find((x) => x.id === id);
      if (s.otomatik && v <= gun && o && o.durum === 'bekliyor') {
        sonuc.otomatikler.push({
          odeme_id: id,
          islem: { id: `oto:${id}`, tarih: v, tur: 'gider', tutar: o.tutar, kaynak_id: o.kaynak_id, hedef_id: null, kategori_id: null, taksit: 1, plan_disi: 0, notu: null, gelir_kaynagi: null, hedef_ref: null, odeme_id: id, aile: s.aile ? 1 : 0, silindi: 0, olusturma: simdiIso },
        });
      }
    }
  }

  // 3 · Hafta kapanışı (pazarı geçmiş haftalar): fark artan bütçeye yazılır (havale yok; para zaten hesapta).
  const kapali = new Set((veri.haftalar || []).map((h) => h.pazartesi));
  for (let p = pazartesi(k); ekleGun(p, 6) < gun; p = ekleGun(p, 7)) {
    if (kapali.has(p)) continue;
    const { limitler, harcanan, fark } = haftaKapanisi(veri, p);
    sonuc.haftalar.push({ pazartesi: p, ay: haftaAyi(p, ayar), limitler: JSON.stringify(limitler), harcanan: JSON.stringify(harcanan), fark, odeme_id: null, kapanis: simdiIso });
  }

  // 3b · Artan bütçe eksideyse bu haftanın limitleri kısılır (haftada bir kez; kullanıcı dağılımı değiştirebilir).
  sonuc.kismalar = [];
  const buHafta = pazartesi(gun);
  if (buHafta >= pazartesi(k) && !veri.kismalar?.[buHafta]) {
    const artan = artanButce({ ...veri, haftalar: [...(veri.haftalar || []), ...sonuc.haftalar] });
    if (artan < 0) {
      const dagilim = kismaDagit(veri, buHafta, -artan);
      if (Object.keys(dagilim).length) sonuc.kismalar.push({ pazartesi: buHafta, dagilim });
    }
  }

  // 4 · Kart son ödemesi: kesimden sonraki gün dönem borcu tahminiyle ödeme oluşur (kesim günü girilen harcama da girsin).
  // Bu bakımda işlenen otomatik ödemeler (karttan abonelik) de döneme katılır. Bekleyen ödemenin tutarı
  // sonradan girilen harcamalarla güncellenir (sonuc.kartGuncel).
  const kartVerisi = { ...veri, islemler: [...(veri.islemler || []), ...sonuc.otomatikler.map((a) => a.islem)] };
  for (const kart of aktifler(veri.hesaplar)) {
    if (kart.tur !== 'kart' || !kart.kesim_gunu || !kart.son_odeme_gunu) continue;
    for (let ay = ekleAy(altSinir.slice(0, 7), -1); ay <= gun.slice(0, 7); ay = ekleAy(ay, 1)) {
      const d = kartDonemi(kart, ay);
      if (d.kesim >= gun || d.kesim < altSinir) continue;
      const tutar = kartOdemesi(kartVerisi, kart, d);
      if (tutar <= 0) continue;
      yeniOdeme({ id: odemeKimligi.kart(kart.id, d.sonOdeme), tur: 'kart', sebep: 'kart', ref_id: kart.id, vade: d.sonOdeme, ad: `${kart.ad} ödemesi (tahmini)`, tutar, kaynak_id: kart.odeme_hesap_id || ayar.harcama_hesabi, hedef_id: kart.id });
    }
  }
  sonuc.kartGuncel = kartOdemeGuncellemeleri(kartVerisi);
  return sonuc;
}

// Bekleyen kart ödemelerinin güncel tutarı (dönemin harcamaları değiştiyse): [{ id, tutar }].
export function kartOdemeGuncellemeleri(veri) {
  const kartlar = haritala(veri.hesaplar);
  const sonuc = [];
  for (const o of veri.odemeler || []) {
    if (o.tur !== 'kart' || o.durum !== 'bekliyor') continue;
    const kart = kartlar.get(o.ref_id);
    const d = kart && sonOdemeDonemi(kart, o.vade);
    if (!d) continue;
    const tutar = kartOdemesi(veri, kart, d);
    if (tutar > 0 && tutar !== o.tutar) sonuc.push({ id: o.id, tutar });
  }
  return sonuc;
}

// ---------------------------------------------------------------- maaş

// Maaş en çok 5 gün erken yatabilir; o zaman yaklaşan bütçe ayının geliri sayılır.
export function maasAyi(tarih, ayar) {
  return butceAyi(ekleGun(tarih, 5), ayar);
}

export function maasDurumu(veri, gun) {
  const ayar = ayarBirlestir(veri.ayar);
  const ay = maasAyi(gun, ayar);
  const gelen = canli(veri.islemler).find((i) => i.tur === 'gelir' && i.gelir_kaynagi === 'Maaş' && maasAyi(i.tarih, ayar) === ay);
  const { bas } = ayAraligi(ay, ayar);
  const beklenen = Number(ayar.maas?.tutar) || 0;
  const kurulumOncesi = ayar.kurulum_tarihi && bas < ayar.kurulum_tarihi && ay === butceAyi(ayar.kurulum_tarihi, ayar);
  return { ay, beklenenGun: bas, beklenen, gelen: gelen || null, sor: beklenen > 0 && !gelen && !kurulumOncesi && gun >= ekleGun(bas, -5) };
}

// ---------------------------------------------------------------- gelir dağıtımı (havuzsuz)
// Maaş: o bütçe ayının planı (giderler) hesapta kalır; yatırım = ayarlardaki tutar + artan bütçe (eksiyse düşer),
// en fazla giderlerden sonra kalan + artı artan bütçe kadar; kalanı serbest.
// Ek gelir: gider ayrılmaz, yatırım varsayılan 0 (kullanıcı ekranda artırır).
// Toplam: giderler + yatirim + serbest = tutar + artan (artan bütçe zaten hesaptaki paradır).
export function gelirDagitimi(veri, tutar, { maas = false, tarih, gun = tarih } = {}) {
  const ayar = ayarBirlestir(veri.ayar);
  const ay = maasAyi(tarih || gun, ayar);
  const giderler = maas ? ayPlani(veri, ay).plan : 0;
  // Açık hafta kısılmışsa o açık zaten bu haftanın limitlerinden kapanıyor: yatırımdan ikinci kez düşülmez.
  const buHafta = pazartesi(gun);
  const kisma = (veri.haftalar || []).some((h) => h.pazartesi === buHafta) ? null : veri.kismalar?.[buHafta];
  const artan = maas ? artanButce(veri) + (kisma ? toplam(Object.values(kisma), Number) : 0) : 0;
  const hedef = maas ? Number(ayar.yatirim_tutari) || 0 : 0;
  const ust = Math.max(0, tutar - giderler + artan);
  const yatirim = Math.min(ust, Math.max(0, hedef + artan));
  return { ay, giderler, artan, hedef, yatirim, serbest: tutar + artan - giderler - yatirim };
}

// ---------------------------------------------------------------- varlık ve yatırım

const sinirliVeri = (veri, tarih) => ({ ...veri, islemler: canli(veri.islemler).filter((i) => i.tarih <= tarih) });

// Net varlık = bütün hesapların bakiyesi (kart borcu eksi) + aileden alacak.
export function netVarlik(veri, tarih) {
  const v = tarih ? sinirliVeri(veri, tarih) : veri;
  const b = bakiyeler(v);
  let t = 0;
  for (const h of aktifler(veri.hesaplar)) t += b.get(h.id) || 0;
  return t + aileAlacagi(v);
}

// Özet'teki üç kutu: yatırım (bütün yatırım hesapları + yatırım görevindeki hesap), banka hesapları, kart borcu.
export function varlikDagilimi(veri) {
  const ayar = ayarBirlestir(veri.ayar);
  const b = bakiyeler(veri);
  const d = { yatirim: 0, hesaplar: 0, kartBorcu: 0 };
  for (const h of aktifler(veri.hesaplar)) {
    const x = b.get(h.id) || 0;
    if (h.tur === 'kart') d.kartBorcu += x;
    else if (h.tur === 'yatirim' || h.id === ayar.yatirim_hesabi) d.yatirim += x;
    else d.hesaplar += x;
  }
  return d;
}

// Biten bütçe ayının özeti (yeni ayın ilk günlerindeki kart): yatırıma giden (yatırım hesaplarına net transfer),
// plan ve gerçekleşen, en çok harcanan 3 kategori (bütçe payı; ailenin ödediği ve sabit ödemeler hariç).
export function ayOzeti(veri, ay) {
  const ayar = ayarBirlestir(veri.ayar);
  const { bas, son } = ayAraligi(ay, ayar);
  const yatirimHesaplari = new Set(aktifler(veri.hesaplar).filter((h) => h.tur === 'yatirim' || h.id === ayar.yatirim_hesabi).map((h) => h.id));
  const kat = haritala(veri.kategoriler);
  let yatirim = 0;
  const kategoriler = new Map();
  for (const i of canli(veri.islemler)) {
    if (i.tarih < bas || i.tarih > son) continue;
    if (i.tur === 'transfer') {
      if (yatirimHesaplari.has(i.hedef_id) && !yatirimHesaplari.has(i.kaynak_id)) yatirim += i.tutar;
      if (yatirimHesaplari.has(i.kaynak_id) && !yatirimHesaplari.has(i.hedef_id)) yatirim -= i.tutar;
    } else if (i.tur === 'gider' && i.kategori_id && kat.has(i.kategori_id) && giderKovasi(i, kat)) {
      kategoriler.set(i.kategori_id, (kategoriler.get(i.kategori_id) || 0) + butcePayi(i));
    }
  }
  const p = ayPlani(veri, ay);
  const enCok = [...kategoriler].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, tutar]) => ({ ad: kat.get(id).ad, simge: kat.get(id).simge || '', tutar }));
  return { ay, ad: ayAdi(ay), bas, son, yatirim, plan: p.plan, gercek: p.gercek, enCok };
}

// Gidişat okları için: bugünkü net varlık, yatırım ve kart borcunun geçen bütçe ayının son gününe göre farkı.
// Kurulum ayındaysak (karşılaştırılacak ay yok) null.
export function gecenAyaGore(veri, gun) {
  const ayar = ayarBirlestir(veri.ayar);
  const onceki = ekleAy(butceAyi(gun, ayar), -1);
  const ka = kurulumAyi(ayar);
  if (!ka || onceki < ka) return null;
  const { son } = ayAraligi(onceki, ayar);
  const simdi = varlikDagilimi(veri);
  const o = varlikDagilimi(sinirliVeri(veri, son));
  return { tarih: son, netVarlik: netVarlik(veri) - netVarlik(veri, son), yatirim: simdi.yatirim - o.yatirim, kartBorcu: simdi.kartBorcu - o.kartBorcu };
}

// Ay sonu tahmini: bütçe ayının son günü (maaştan önce) bütün borçlar ödenmiş sayılırsa elde kalan.
// Kullanılabilir bakiye − kart borcu + aileden alacak − bu ay kalan sabit ödemeler − haftalık ve aylık
// limitlerin kalanı (aşılan kategori 0; limitsiz kategori bir şey eklemez) − beklenmeyen payının kalanı −
// yatırıma bekleyen havaleler. Ailenin ödediği sabit hem borç hem alacak olduğu için hiç sayılmaz.
// Gelecek ayın maaşı erken yattıysa (bkz. maasAyi) tahmin o maaş hiç gelmemiş gibi yapılır: maaş, ondan doğan
// havaleler ve artan bütçe aktarımı sayılmaz (tahmin maaştan önceki günün parasıdır).
export function aySonuTahmini(veri, gun) {
  const ayar = ayarBirlestir(veri.ayar);
  const ay = butceAyi(gun, ayar);
  veri = gelecekMaassiz(veri, ay);
  const { bas, son } = ayAraligi(ay, ayar);
  const { hesaplar, kartBorcu } = varlikDagilimi(veri);
  const kat = haritala(veri.kategoriler);
  const odemeler = new Map((veri.odemeler || []).map((o) => [o.id, o]));
  const kalemler = [];
  const ekle = (ad, tutar, alt) => { if (tutar) kalemler.push(alt?.length ? { ad, tutar, alt } : { ad, tutar }); };
  ekle('Kullanılabilir bakiye', hesaplar);
  ekle('Kart borcu', kartBorcu);
  // Kart borcunda taksitli alışverişin tamamı var; sonraki bütçe aylarına düşen paylar o ayların planındadır.
  let taksitler = 0;
  for (const i of canli(veri.islemler)) {
    if (i.tur !== 'gider' || !(i.taksit > 1) || i.aile) continue;
    for (const p of taksitPaylari(i)) if (p.tarih > son) taksitler += p.tutar;
  }
  ekle('Sonraki aylara düşen taksitler', taksitler);
  ekle('Aileden alacak', aileAlacagi(veri));

  let sabit = 0;
  for (const s of aktifler(veri.sabitler)) {
    if (s.aile) continue;
    for (const v of sabitVadeleri(s, bas, son)) {
      const o = odemeler.get(odemeKimligi.sabit(s.id, v));
      if (o ? o.durum === 'bekliyor' : v >= gun) sabit += s.tutar;
    }
  }
  ekle('Kalan sabit ödemeler', -sabit);

  // Sonraki hafta bu haftanın açığı kadar kısılacaksa o kadar az harcanır ("ay sonundan düş" seçilmişse kısılmaz).
  // Dökümde her kategori için ayrılan para (alt satırlar).
  const ayrilan = new Map();
  const ayir = (id, x) => ayrilan.set(id, (ayrilan.get(id) || 0) + x);
  const buHafta = pazartesi(gun);
  const sonrakiKisma = sonrakiHaftaKismasi(veri, gun, { hepsiHarcanir: true });
  for (const p of ayHaftalari(ay, ayar)) {
    if (p < buHafta) continue;
    if (p === buHafta) for (const s of haftaDurumu(veri, p, gun).satirlar) ayir(s.kategori_id, Math.max(0, s.kalan));
    else for (const [id, l] of Object.entries(haftaLimitleri(veri, p))) ayir(id, l - (p === ekleGun(buHafta, 7) ? Number(sonrakiKisma[id]) || 0 : 0));
  }
  const altSatirlar = (idler, asim = new Map()) => idler.filter((id) => ayrilan.get(id) || asim.get(id))
    .map((id) => ({ ad: kat.get(id)?.ad || '?', tutar: ayrilan.get(id) || 0, asim: asim.get(id) || 0 }));
  const haftalikIdler = [...ayrilan.keys()].sort((a, b) => (kat.get(a)?.sira ?? 0) - (kat.get(b)?.sira ?? 0));
  ekle('Kalan haftalık bütçeler', -toplam(haftalikIdler, (id) => ayrilan.get(id)), altSatirlar(haftalikIdler));

  const oran = ayOrani(ay, ayar);
  const harcanan = new Map();
  let beklenmeyenHarcanan = 0;
  for (const i of canli(veri.islemler)) {
    if (i.tur !== 'gider' || i.tarih < bas || i.tarih > son) continue;
    const kova = giderKovasi(i, kat);
    if (kova === 'aylik') harcanan.set(i.kategori_id, (harcanan.get(i.kategori_id) || 0) + butcePayi(i));
    else if (kova === 'beklenmeyen') beklenmeyenHarcanan += butcePayi(i);
  }
  // Limiti aşılan kategori 0 ayrılır (aşım dökümde gösterilir); limitsiz kategori hiç ayrılmaz.
  const aylikIdler = [];
  const asim = new Map();
  for (const k of aktifler(veri.kategoriler)) {
    if (k.tur !== 'aylik' || k.is_gideri || !(Number(k.limit_tutar) > 0)) continue;
    const kalan = yuvarla(k.limit_tutar * oran) - (harcanan.get(k.id) || 0);
    aylikIdler.push(k.id);
    ayrilan.set(k.id, Math.max(0, kalan));
    if (kalan < 0) asim.set(k.id, -kalan);
  }
  ekle('Kalan aylık bütçeler', -toplam(aylikIdler, (id) => ayrilan.get(id)), altSatirlar(aylikIdler, asim));
  ekle('Kalan beklenmeyen payı', -Math.max(0, yuvarla((Number(ayar.beklenmeyen) || 0) * oran) - beklenmeyenHarcanan));

  const banka = new Set(aktifler(veri.hesaplar).filter((h) => h.tur !== 'kart' && h.tur !== 'yatirim' && h.id !== ayar.yatirim_hesabi).map((h) => h.id));
  const havale = toplam((veri.odemeler || []).filter((o) => o.durum === 'bekliyor' && o.tur === 'havale' && o.vade <= son && banka.has(o.kaynak_id) && o.hedef_id && !banka.has(o.hedef_id)), (o) => o.tutar);
  ekle('Yatırıma gidecek havaleler', -havale);

  return { ay, son, tutar: toplam(kalemler, (x) => x.tutar), kalemler, aySonundan: aySonundanDusulen(veri, ay, gun) };
}

function gelecekMaassiz(veri, ay) {
  const ayar = ayarBirlestir(veri.ayar);
  const maaslar = new Set(canli(veri.islemler).filter((i) => i.tur === 'gelir' && i.gelir_kaynagi === 'Maaş' && maasAyi(i.tarih, ayar) > ay).map((i) => i.id));
  if (!maaslar.size) return veri;
  const odemeler = (veri.odemeler || []).filter((o) => o.sebep === 'gelir' && maaslar.has(o.ref_id));
  const odemeIdleri = new Set(odemeler.map((o) => o.id));
  return {
    ...veri,
    islemler: (veri.islemler || []).filter((i) => !maaslar.has(i.id) && !odemeIdleri.has(i.odeme_id)),
    odemeler: (veri.odemeler || []).filter((o) => !odemeIdleri.has(o.id)),
    artanAktarimlari: (veri.artanAktarimlari || []).filter((a) => !maaslar.has(a.gelir_id)),
  };
}

// Son n bütçe ayının sonundaki net varlık (bu ay için bugün). Kurulumdan öncesi yok.
export function netVarlikSerisi(veri, gun, n = 6) {
  const ayar = ayarBirlestir(veri.ayar);
  const buAy = butceAyi(gun, ayar);
  const sonuc = [];
  for (let i = n - 1; i >= 0; i--) {
    const ay = ekleAy(buAy, -i);
    const son = i === 0 ? gun : ayAraligi(ay, ayar).son;
    if (ayar.kurulum_tarihi && son < ayar.kurulum_tarihi) continue;
    sonuc.push({ ay, tarih: son, tutar: netVarlik(veri, son) });
  }
  return sonuc;
}

// Yatırım hesabı: güncel değer, yatırılan para (açılış + giren − çıkan), kazanç (değer güncellemeleri),
// son n bütçe ayının katkısı, bu yılki toplam ve kaç ay üst üste yatırım yapıldığı.
export function yatirimOzeti(veri, gun, n = 6) {
  const ayar = ayarBirlestir(veri.ayar);
  const id = ayar.yatirim_hesabi;
  const hesap = (veri.hesaplar || []).find((h) => h.id === id);
  if (!hesap) return null;
  const deger = bakiyeler(veri).get(id) || 0;
  let katki = 0;
  const aylik = new Map();
  let buYil = 0;
  for (const i of canli(veri.islemler)) {
    let x = 0;
    if (i.tur === 'transfer') x = i.hedef_id === id ? i.tutar : i.kaynak_id === id ? -i.tutar : 0;
    else if (i.tur === 'gelir' && i.hedef_id === id) x = i.tutar;
    else if (i.tur === 'gider' && i.kaynak_id === id) x = -i.tutar;
    if (!x) continue;
    katki += x;
    const ay = butceAyi(i.tarih, ayar);
    aylik.set(ay, (aylik.get(ay) || 0) + x);
    if (i.tarih.slice(0, 4) === gun.slice(0, 4)) buYil += x;
  }
  const yatirilan = (Number(hesap.acilis_bakiye) || 0) + (Number(hesap.devir) || 0) + katki;
  const buAy = butceAyi(gun, ayar);
  const aylar = [];
  for (let i = n - 1; i >= 0; i--) { const ay = ekleAy(buAy, -i); aylar.push({ ay, tutar: aylik.get(ay) || 0 }); }
  // Seri: bu ay (yapıldıysa) ya da geçen aydan geriye, yatırım yapılan ardışık aylar.
  let seri = 0;
  for (let ay = (aylik.get(buAy) || 0) > 0 ? buAy : ekleAy(buAy, -1); (aylik.get(ay) || 0) > 0; ay = ekleAy(ay, -1)) seri++;
  return { hesap, deger, yatirilan, kazanc: deger - yatirilan, oran: yatirilan > 0 ? (deger - yatirilan) / yatirilan : null, aylar, buAy: aylik.get(buAy) || 0, buYil, seri };
}

// ---------------------------------------------------------------- dikkat

export function dikkatListesi(veri, gun) {
  const ayar = ayarBirlestir(veri.ayar);
  const sonuc = [];
  const b = bakiyeler(veri);
  const hafta = haftaDurumu(veri, pazartesi(gun), gun);
  for (const s of hafta.satirlar) if (s.kalan < 0) sonuc.push({ tur: 'asim', metin: `${s.ad}: bu hafta limit ${paraYaz(-s.kalan, { kisa: true })} aşıldı` });
  for (const h of aktifler(veri.hesaplar)) {
    if (h.tur !== 'kart' || !h.limit_tutar) continue;
    const borc = -(b.get(h.id) || 0);
    if (borc / h.limit_tutar >= 0.8) sonuc.push({ tur: 'limit', metin: `${h.ad}: limitin %${Math.round(borc / h.limit_tutar * 100)}'i dolu` });
  }
  for (const o of veri.odemeler || []) {
    if (o.durum !== 'bekliyor' || o.tur !== 'kart') continue;
    const kalan = gunFarki(gun, o.vade);
    if (kalan > 7) continue;
    const para = b.get(o.kaynak_id) || 0;
    if (para < o.tutar) sonuc.push({ tur: 'kart', metin: `${o.ad}: son ödemeye ${kalan < 0 ? 'süre geçti' : `${kalan} gün`}, hesapta ${paraYaz(o.tutar - para, { kisa: true })} eksik` });
  }
  const hv = havuzDurumu(veri);
  if (ayar.havuz_hesabi && hv.hedef > 0 && hv.bakiye < hv.ihtiyac) sonuc.push({ tur: 'havuz', metin: `Gelir havuzunda bir aylık ihtiyaçtan az para var` });
  return sonuc;
}

// ---------------------------------------------------------------- doğrulama

export function islemDogrula(i) {
  const hata = (m) => m;
  if (!i || typeof i !== 'object') return hata('Kayıt yok');
  if (!/^[\w:.-]{6,80}$/.test(i.id || '')) return hata('Kimlik geçersiz');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.tarih || '')) return hata('Tarih geçersiz');
  if (!['gider', 'gelir', 'transfer', 'duzeltme'].includes(i.tur)) return hata('Tür geçersiz');
  if (!Number.isInteger(i.tutar)) return hata('Tutar geçersiz');
  if (i.tur !== 'duzeltme' && i.tutar <= 0) return hata('Tutar sıfırdan büyük olmalı');
  if (Math.abs(i.tutar) > 1e12) return hata('Tutar çok büyük');
  if (i.tur === 'gider' && !i.kaynak_id) return hata('Hesap seçilmedi');
  if ((i.tur === 'gelir' || i.tur === 'duzeltme') && !i.hedef_id) return hata('Hesap seçilmedi');
  if (i.tur === 'transfer' && (!i.kaynak_id || !i.hedef_id || i.kaynak_id === i.hedef_id)) return hata('Transfer hesapları geçersiz');
  const t = Number(i.taksit ?? 1);
  if (!Number.isInteger(t) || t < 1 || t > 36) return hata('Taksit sayısı geçersiz');
  if (kartNoVarMi(i.notu)) return hata('Kart numarası yazılamaz');
  return null;
}
