// BANK OF USY — telefondaki "sunucu". Eskiden Cloudflare Worker'ın yaptığı işler (doğrulama, kayıt, günlük bakım)
// artık telefonda, depo.js'teki belge üzerinde yapılır. Arayüz (app.js) yine `istek(yol, { yontem, govde })` ile konuşur;
// yollar ve cevaplar eskisiyle aynıdır. Hesaplar hesap.js'tedir; burada yalnız okuma, doğrulama ve yazma vardır.
import * as H from './hesap.js';
import { yedekMetni, yedekOku } from './depo.js';
import { denemeOlustur } from './deneme.js';

const TELEFON_GUN = 430; // ekrana verilen hareketlerin geriye dönük süresi; daha eskisi devir olarak katlanır

export class ApiHata extends Error {
  constructor(durum, mesaj) { super(mesaj); this.durum = durum; }
}

// ---------------------------------------------------------------- belge ve satırlar

// Her tablonun alanları ve varsayılanları (eski D1 şemasıyla aynı; hesap.js bu alanları bekler).
const SATIRLAR = {
  hesap: { id: null, ad: null, tur: null, acilis_bakiye: 0, acilis_tarihi: null, limit_tutar: null, kesim_gunu: null, son_odeme_gunu: null, odeme_hesap_id: null, banka: null, sira: 0, aktif: 1, olusturma: null },
  kategori: { id: null, ad: null, simge: null, tur: null, limit_tutar: 0, is_gideri: 0, hizli: 1, sira: 0, aktif: 1 },
  hedef: { id: null, ad: null, hedef_tutar: 0, hesap_id: null, hafta_farki: 0, sira: 0, aktif: 1 },
  islem: { id: null, tarih: null, tur: null, tutar: 0, kaynak_id: null, hedef_id: null, kategori_id: null, taksit: 1, plan_disi: 0, notu: null, gelir_kaynagi: null, hedef_ref: null, odeme_id: null, aile: 0, silindi: 0, olusturma: null, guncelleme: null },
  sabit_kalem: { id: null, ad: null, tutar: 0, gun: 1, periyot: 1, ilk_ay: null, son_vade: null, hesap_id: null, degisken: 0, otomatik: 0, is_gideri: 0, aile: 0, aktif: 1, olusturma: null },
  odeme: { id: null, tur: null, sebep: null, ref_id: null, vade: null, ad: null, tutar: 0, kaynak_id: null, hedef_id: null, hedef_ref: null, durum: 'bekliyor', islem_id: null, olusturma: null, kapanis: null },
  ay_plani: { ay: null, kalem: null, kova: null, ad: null, plan: 0 },
  hafta: { pazartesi: null, ay: null, limitler: null, harcanan: null, fark: 0, odeme_id: null, kapanis: null },
};

// kisma: { pazartesi: { kategori_id: kuruş } } · artan_aktarim: [{ id, tarih, tutar, gelir_id }] (bkz. hesap.js › artanButce)
// ay_sonundan: { pazartesi: 1 } — o haftanın açığı ay sonundan düşülür, sonraki hafta kısılmaz.
export function bosBelge() {
  const b = { surum: 1, ayar: {}, kisma: {}, artan_aktarim: [], ay_sonundan: {} };
  for (const t of Object.keys(SATIRLAR)) b[t] = [];
  return b;
}

function satir(tablo, alanlar) {
  const s = { ...SATIRLAR[tablo] };
  for (const k of Object.keys(s)) if (alanlar[k] !== undefined) s[k] = alanlar[k];
  return s;
}

const simdi = () => new Date().toISOString();

// "INSERT OR IGNORE": aynı kimlik varsa dokunmaz.
function ekleYoksa(B, tablo, alanlar, esit = (a, b) => a.id === b.id) {
  const s = satir(tablo, alanlar);
  if (B[tablo].some((x) => esit(x, s))) return false;
  B[tablo].push(s);
  return true;
}

function sirala(liste, ...alanlar) {
  return [...liste].sort((a, b) => {
    for (const f of alanlar) {
      const x = a[f] ?? '';
      const y = b[f] ?? '';
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
}

function veriYukle(B) {
  return {
    ayar: H.ayarBirlestir(B.ayar),
    hesaplar: sirala(B.hesap, 'sira', 'olusturma'),
    kategoriler: sirala(B.kategori, 'sira', 'ad'),
    hedefler: sirala(B.hedef, 'sira', 'ad'),
    sabitler: sirala(B.sabit_kalem, 'gun', 'ad'),
    islemler: sirala(B.islem.filter((i) => !i.silindi), 'tarih', 'olusturma'),
    odemeler: sirala(B.odeme, 'vade', 'id'),
    haftalar: sirala(B.hafta, 'pazartesi'),
    ayPlanlari: sirala(B.ay_plani, 'ay', 'kova', 'kalem'),
    kismalar: B.kisma || {},
    artanAktarimlari: B.artan_aktarim || [],
    aySonundan: B.ay_sonundan || {},
  };
}

// Ekrana verilecek veri: eski hareketler devir olarak katlanır (hesaplar hızlı kalsın).
function telefonVerisi(veri, gun) {
  const sinir = H.ekleGun(gun, -TELEFON_GUN);
  const eski = [];
  const yeni = [];
  for (const i of veri.islemler) {
    const sonPay = i.taksit > 1 ? H.ekleAyTarih(i.tarih, i.taksit - 1) : i.tarih;
    (i.tarih < sinir && sonPay < sinir ? eski : yeni).push(i);
  }
  const sifir = veri.hesaplar.map((h) => ({ ...h, acilis_bakiye: 0 }));
  const devir = H.bakiyeler({ hesaplar: sifir, islemler: eski });
  const hedefDevir = H.hedefBirikimleri({ hedefler: veri.hedefler, islemler: eski });
  const artanEskiHarcama = eski.filter((i) => i.tur === 'gider' && !i.aile && i.kategori_id === H.ARTAN_KATEGORI).reduce((t, i) => t + H.butcePayi(i), 0);
  return {
    ...veri,
    hesaplar: veri.hesaplar.map((h) => ({ ...h, devir: devir.get(h.id) || 0 })),
    hedefler: veri.hedefler.map((h) => ({ ...h, devir: hedefDevir.get(h.id) || 0 })),
    islemler: yeni,
    artanEskiHarcama,
    aileDevir: H.aileAlacagi({ islemler: eski }),
    odemeler: veri.odemeler.filter((o) => o.durum === 'bekliyor' || o.vade >= H.ekleGun(gun, -120)),
    haftalar: veri.haftalar, // hepsi: artan bütçe bunlardan hesaplanır (yılda 52 satır)
    ayPlanlari: veri.ayPlanlari.filter((p) => p.ay >= H.ekleAy(gun.slice(0, 7), -14)),
    bugun: gun,
  };
}

function islemEkle_(B, i) {
  return ekleYoksa(B, 'islem', {
    ...i, taksit: i.taksit ?? 1, plan_disi: i.plan_disi ? 1 : 0, aile: i.aile ? 1 : 0, silindi: 0, olusturma: i.olusturma || simdi(),
  });
}

function odemeEkle_(B, o) {
  return ekleYoksa(B, 'odeme', { ...o, durum: 'bekliyor', olusturma: o.olusturma || simdi() });
}

// ---------------------------------------------------------------- bakım (uygulama açılınca, günde bir)
// Hafta kapanışı, her 10'unda aylık çekiş, sabit ödemeler, otomatik ödemeler, kart son ödemesi.

function bakim(B, gun, zorla = false) {
  if (!B.ayar.kurulum_tarihi) return false;
  if (!zorla && B.ayar.son_bakim === gun) return false;
  const s = H.bakimAdimlari(veriYukle(B), gun);
  const zaman = simdi();
  for (const p of s.ayPlanlari) ekleYoksa(B, 'ay_plani', p, (a, b) => a.ay === b.ay && a.kalem === b.kalem);
  for (const o of s.odemeler) odemeEkle_(B, o);
  for (const h of s.haftalar) ekleYoksa(B, 'hafta', h, (a, b) => a.pazartesi === b.pazartesi);
  B.kisma ||= {};
  for (const k of s.kismalar || []) if (!B.kisma[k.pazartesi]) B.kisma[k.pazartesi] = k.dagilim;
  for (const a of s.otomatikler) {
    // Otomatik ödeme geri alınmışsa kayıt yeniden canlanır (vadesinde kendiliğinden ödenir; istenmiyorsa "Atla").
    const eski = B.islem.find((i) => i.id === a.islem.id);
    if (eski) Object.assign(eski, { silindi: 0, tutar: a.islem.tutar, guncelleme: zaman });
    else islemEkle_(B, a.islem);
    const o = B.odeme.find((x) => x.id === a.odeme_id && x.durum === 'bekliyor');
    if (o) Object.assign(o, { durum: 'yapildi', islem_id: a.islem.id, kapanis: zaman });
  }
  kartOdemeleriniGuncelle(B, s.kartGuncel);
  B.ayar.son_bakim = gun;
  return true;
}

function kartOdemeleriniGuncelle(B, liste = H.kartOdemeGuncellemeleri(veriYukle(B))) {
  for (const k of liste || []) {
    const o = B.odeme.find((x) => x.id === k.id && x.durum === 'bekliyor');
    if (o) o.tutar = k.tutar;
  }
}

// Sürmekte olan haftanın kısması artan bütçeye göre yeniden hesaplanır (aynı toplamda kullanıcının dağılımı kalır).
function kismaYenile(B, gun) {
  const buHafta = H.pazartesi(gun);
  B.kisma ||= {};
  if (B.hafta.some((h) => h.pazartesi === buHafta)) return;
  const yeni = H.buHaftaKismasi(veriYukle(B), gun);
  const toplamT = (o) => Object.values(o || {}).reduce((t, x) => t + x, 0);
  if (!toplamT(yeni)) delete B.kisma[buHafta];
  else if (toplamT(yeni) !== toplamT(B.kisma[buHafta])) B.kisma[buHafta] = yeni;
}

// Hareket eklenince, düzeltilince ya da silinince: o tarihlerdeki kapanmış haftanın sonucu yeniden hesaplanır
// (limitler donmuş kalır; ör. pazarın harcaması pazartesi girildi), gerekirse bu haftanın kısması ve bekleyen
// kart ödemelerinin tutarı güncellenir.
function sonraDuzelt(B, tarihler, gun) {
  const v = veriYukle(B);
  const toplamT = (o) => Object.values(o).reduce((t, x) => t + Number(x), 0);
  let degisti = false;
  for (const h of B.hafta) {
    const pazar = H.ekleGun(h.pazartesi, 6);
    if (!tarihler.some((t) => t && t >= h.pazartesi && t <= pazar)) continue;
    const harcanan = H.haftaHarcamalari(v, h.pazartesi);
    const fark = toplamT(JSON.parse(h.limitler)) - toplamT(harcanan);
    if (fark !== h.fark) { Object.assign(h, { harcanan: JSON.stringify(harcanan), fark }); degisti = true; }
  }
  if (degisti) kismaYenile(B, gun);
  kartOdemeleriniGuncelle(B);
}

// ---------------------------------------------------------------- doğrulama

const metin = (x, uz = 80) => (x == null || x === '' ? null : String(x).trim().slice(0, uz));
const tam = (x, varsayilan = null) => (x == null || x === '' ? varsayilan : Number.isInteger(Number(x)) ? Number(x) : varsayilan);
const bayrak = (x) => (x ? 1 : 0);

function kartNoKontrol(...alanlar) {
  for (const a of alanlar) if (H.kartNoVarMi(a)) throw new ApiHata(400, 'Kart numarası yazılamaz');
}

function hesapTemizle(id, h) {
  if (!H.HESAP_TURLERI[h.tur]) throw new ApiHata(400, 'Hesap türü geçersiz');
  const ad = metin(h.ad, 40);
  if (!ad) throw new ApiHata(400, 'Hesap adı gerekli');
  kartNoKontrol(ad);
  const kart = h.tur === 'kart';
  const gun = (x) => { const g = tam(x); return g && g >= 1 && g <= 31 ? g : null; };
  return {
    id, ad, tur: h.tur, acilis_bakiye: tam(h.acilis_bakiye, 0), acilis_tarihi: metin(h.acilis_tarihi, 10),
    limit_tutar: kart ? tam(h.limit_tutar) : null, kesim_gunu: kart ? gun(h.kesim_gunu) : null, son_odeme_gunu: kart ? gun(h.son_odeme_gunu) : null,
    odeme_hesap_id: kart ? metin(h.odeme_hesap_id, 64) : null,
    banka: h.banka && H.BANKALAR[h.banka] ? h.banka : null, sira: tam(h.sira, 0), aktif: h.aktif === 0 ? 0 : 1,
  };
}

function kategoriTemizle(id, k) {
  const ad = metin(k.ad, 30);
  if (!ad) throw new ApiHata(400, 'Kategori adı gerekli');
  if (!['haftalik', 'aylik'].includes(k.tur)) throw new ApiHata(400, 'Kategori türü geçersiz');
  const limit = tam(k.limit_tutar, 0);
  if (limit < 0) throw new ApiHata(400, 'Limit eksi olamaz');
  return { id, ad, simge: metin(k.simge, 8), tur: k.is_gideri ? 'aylik' : k.tur, limit_tutar: limit, is_gideri: bayrak(k.is_gideri), hizli: k.hizli === 0 ? 0 : 1, sira: tam(k.sira, 0), aktif: k.aktif === 0 ? 0 : 1 };
}

function hedefTemizle(id, h) {
  const ad = metin(h.ad, 40);
  if (!ad) throw new ApiHata(400, 'Hedef adı gerekli');
  return { id, ad, hedef_tutar: Math.max(0, tam(h.hedef_tutar, 0)), hesap_id: metin(h.hesap_id, 64), hafta_farki: bayrak(h.hafta_farki), sira: tam(h.sira, 0), aktif: h.aktif === 0 ? 0 : 1 };
}

function sabitTemizle(id, s) {
  const ad = metin(s.ad, 40);
  if (!ad) throw new ApiHata(400, 'Ödeme adı gerekli');
  kartNoKontrol(ad);
  const tutar = tam(s.tutar);
  if (!(tutar > 0)) throw new ApiHata(400, 'Tutar gerekli');
  const gun = tam(s.gun);
  if (!(gun >= 1 && gun <= 31)) throw new ApiHata(400, 'Gün 1–31 olmalı');
  const periyot = tam(s.periyot, 1);
  if (![1, 3, 6, 12].includes(periyot)) throw new ApiHata(400, 'Periyot geçersiz');
  if (!/^\d{4}-\d{2}$/.test(s.ilk_ay || '')) throw new ApiHata(400, 'İlk ay geçersiz');
  if (s.son_vade && !/^\d{4}-\d{2}-\d{2}$/.test(s.son_vade)) throw new ApiHata(400, 'Son vade geçersiz');
  return {
    id, ad, tutar, gun, periyot, ilk_ay: s.ilk_ay, son_vade: s.son_vade || null, hesap_id: metin(s.hesap_id, 64),
    degisken: bayrak(s.degisken), otomatik: bayrak(s.otomatik), is_gideri: bayrak(s.is_gideri), aile: bayrak(s.aile), aktif: s.aktif === 0 ? 0 : 1,
  };
}

const TABLOLAR = {
  hesap: { tablo: 'hesap', temizle: hesapTemizle, olusturma: true },
  kategori: { tablo: 'kategori', temizle: kategoriTemizle },
  hedef: { tablo: 'hedef', temizle: hedefTemizle },
  sabit: { tablo: 'sabit_kalem', temizle: sabitTemizle, olusturma: true },
};

// Varsa alanları güncellenir (oluşturma zamanı korunur), yoksa eklenir.
function upsert(B, tur, kayit) {
  const t = TABLOLAR[tur];
  const eski = B[t.tablo].find((x) => x.id === kayit.id);
  if (eski) Object.assign(eski, kayit);
  else B[t.tablo].push(satir(t.tablo, t.olusturma ? { ...kayit, olusturma: simdi() } : kayit));
}

function hesapVarMi(B, ...idler) {
  for (const id of idler.filter(Boolean)) if (!B.hesap.some((h) => h.id === id)) throw new ApiHata(400, 'Hesap bulunamadı');
}

function islemTemizle(g) {
  const i = {
    id: g.id, tarih: g.tarih, tur: g.tur, tutar: g.tutar, kaynak_id: g.kaynak_id || null, hedef_id: g.hedef_id || null,
    kategori_id: g.kategori_id || null, taksit: tam(g.taksit, 1), plan_disi: bayrak(g.plan_disi), notu: metin(g.notu, 200),
    gelir_kaynagi: metin(g.gelir_kaynagi, 30), hedef_ref: metin(g.hedef_ref, 64), odeme_id: null, aile: bayrak(g.aile),
  };
  const hata = H.islemDogrula(i);
  if (hata) throw new ApiHata(400, hata);
  if (i.tur !== 'gider') { i.kategori_id = null; i.taksit = 1; i.plan_disi = 0; }
  if (i.tur === 'gider') i.hedef_id = null;
  if (i.tur === 'gelir' || i.tur === 'duzeltme') i.kaynak_id = null;
  if (i.tur === 'transfer' || i.tur === 'duzeltme') i.aile = 0;
  return i;
}

// ---------------------------------------------------------------- kayıtlar

// Kategori ya da sabit ödeme değişince bu bütçe ayının ve sonrasının dondurulmuş planı silinir:
// plan canlı hesaplanır, ertesi günkü bakımda yeni hâliyle yeniden dondurulur. Geçmiş aylar değişmez.
function planiCoz(B, tur, gun) {
  if (!gun || !['kategori', 'sabit'].includes(tur) || !B.ayar.kurulum_tarihi) return;
  const ay = H.butceAyi(gun, B.ayar);
  B.ay_plani = B.ay_plani.filter((x) => x.ay < ay);
}

function kayitYaz(B, tur, id, govde, gun) {
  const kayit = TABLOLAR[tur].temizle(id, govde);
  upsert(B, tur, kayit);
  planiCoz(B, tur, gun);
  // Bekleyen sabit ödemeler yeni tutarı/hesabı alsın.
  if (tur === 'sabit') {
    for (const o of B.odeme) {
      if (o.tur === 'sabit' && o.ref_id === id && o.durum === 'bekliyor') Object.assign(o, { tutar: kayit.tutar, kaynak_id: kayit.hesap_id, ad: kayit.ad });
    }
    if (!kayit.aktif) B.odeme = B.odeme.filter((o) => !(o.tur === 'sabit' && o.ref_id === id && o.durum === 'bekliyor'));
  }
  return { tamam: true, kayit };
}

function kayitKaldir(B, tur, id, gun) {
  const k = B[TABLOLAR[tur].tablo].find((x) => x.id === id);
  if (k) k.aktif = 0;
  planiCoz(B, tur, gun);
  if (tur === 'sabit') B.odeme = B.odeme.filter((o) => !(o.tur === 'sabit' && o.ref_id === id && o.durum === 'bekliyor'));
  return { tamam: true };
}

const DUZENLENEBILIR_AYARLAR = ['havuz_ay', 'yatirim_tutari', 'sela', 'beklenmeyen', 'maas', 'gelir_kaynaklari', 'harcama_hesabi', 'havuz_hesabi', 'birikim_hesabi', 'yatirim_hesabi', 'ay_baslangic_gunu', 'ozet_kapandi', 'kutlanan_hafta'];

function ayarTemizle(govde) {
  const a = {};
  for (const k of DUZENLENEBILIR_AYARLAR) if (k in govde) a[k] = govde[k];
  if ('havuz_ay' in a) { const n = Number(a.havuz_ay); if (!(n >= 0 && n <= 24)) throw new ApiHata(400, 'Havuz hedefi 0–24 ay olmalı'); a.havuz_ay = n; }
  if ('sela' in a) {
    const s = { birikim: tam(a.sela?.birikim, 0), yatirim: tam(a.sela?.yatirim, 0), serbest: tam(a.sela?.serbest, 0) };
    if (Object.values(s).some((x) => x < 0) || s.birikim + s.yatirim + s.serbest !== 100) throw new ApiHata(400, 'Şelale oranlarının toplamı 100 olmalı');
    a.sela = s;
  }
  if ('yatirim_tutari' in a) { a.yatirim_tutari = tam(a.yatirim_tutari, 0); if (a.yatirim_tutari < 0) throw new ApiHata(400, 'Yatırım tutarı eksi olamaz'); }
  if ('beklenmeyen' in a) { a.beklenmeyen = tam(a.beklenmeyen, 0); if (a.beklenmeyen < 0) throw new ApiHata(400, 'Beklenmeyen payı eksi olamaz'); }
  if ('maas' in a) a.maas = { tutar: Math.max(0, tam(a.maas?.tutar, 0)), hesap_id: metin(a.maas?.hesap_id, 64) };
  if ('gelir_kaynaklari' in a) {
    const l = (Array.isArray(a.gelir_kaynaklari) ? a.gelir_kaynaklari : []).map((x) => metin(x, 30)).filter(Boolean);
    a.gelir_kaynaklari = ['Maaş', ...new Set(l.filter((x) => x !== 'Maaş'))].slice(0, 20);
  }
  if ('ay_baslangic_gunu' in a) { const g = tam(a.ay_baslangic_gunu); if (!(g >= 1 && g <= 28)) throw new ApiHata(400, 'Ay başlangıç günü 1–28 olmalı'); a.ay_baslangic_gunu = g; }
  for (const k of ['harcama_hesabi', 'havuz_hesabi', 'birikim_hesabi', 'yatirim_hesabi']) if (k in a) a[k] = metin(a[k], 64);
  // Arayüz işaretleri: kapatılan aylık özet (bütçe ayı) ve kutlaması gösterilen son hafta (pazartesi).
  if ('ozet_kapandi' in a && !/^\d{4}-\d{2}$/.test(a.ozet_kapandi)) throw new ApiHata(400, 'Ay geçersiz');
  if ('kutlanan_hafta' in a && !/^\d{4}-\d{2}-\d{2}$/.test(a.kutlanan_hafta)) throw new ApiHata(400, 'Hafta geçersiz');
  return a;
}

function ayarGuncelle(B, govde) {
  const a = ayarTemizle(govde);
  // Ay başlangıç günü kurulumdan sonra uygulamadan değişmez (geçiş ayı ayrıca hesaplanmalı).
  if ('ay_baslangic_gunu' in a && B.ayar.kurulum_tarihi && a.ay_baslangic_gunu !== (B.ayar.ay_baslangic_gunu ?? 10)) {
    throw new ApiHata(409, 'Ay başlangıç günü kurulumdan sonra uygulamadan değiştirilemez');
  }
  Object.assign(B.ayar, structuredClone(a));
  return { tamam: true };
}

// ---------------------------------------------------------------- kurulum sihirbazı

// Başlangıç tarihi geçmişte olabilir (en çok 60 gün): açılış bakiyeleri o günün bakiyeleridir,
// o günden bugüne harcamalar sonradan girilir ya da içe aktarılır; bakım o günden bugüne işler.
function kurulum(B, govde, bugunGun) {
  if (B.ayar.kurulum_tarihi) throw new ApiHata(409, 'Kurulum zaten yapılmış');
  let gun = bugunGun;
  if (govde.baslangic != null && govde.baslangic !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(govde.baslangic) || govde.baslangic > bugunGun || govde.baslangic < H.ekleGun(bugunGun, -60)) {
      throw new ApiHata(400, 'Başlangıç tarihi bugün ya da son 60 gün içinde olmalı');
    }
    gun = govde.baslangic;
  }
  const kimlik = (x) => { if (!/^[\w-]{4,64}$/.test(x?.id || '')) throw new ApiHata(400, 'Kimlik geçersiz'); return x.id; };
  // Önce hepsi doğrulanır, sonra yazılır.
  const hesaplar = (govde.hesaplar || []).map((h) => hesapTemizle(kimlik(h), { ...h, acilis_tarihi: gun }));
  if (!hesaplar.length) throw new ApiHata(400, 'En az bir hesap gerekli');
  const kategoriler = (govde.kategoriler || []).map((k) => kategoriTemizle(kimlik(k), k));
  const hedefler = (govde.hedefler || []).map((h) => hedefTemizle(kimlik(h), h));
  const sabitler = (govde.sabitler || []).map((s) => sabitTemizle(kimlik(s), s));
  const a = ayarTemizle(govde.ayar || {});
  const hesapIdleri = new Set(hesaplar.map((h) => h.id));
  for (const k of ['harcama_hesabi', 'havuz_hesabi', 'birikim_hesabi', 'yatirim_hesabi']) {
    if (a[k] && !hesapIdleri.has(a[k])) throw new ApiHata(400, 'Ayarlardaki hesap bulunamadı');
  }
  if (!a.harcama_hesabi) throw new ApiHata(400, 'Harcama hesabı seçilmeli');
  for (const h of hesaplar) upsert(B, 'hesap', h);
  for (const k of kategoriler) upsert(B, 'kategori', k);
  for (const h of hedefler) upsert(B, 'hedef', h);
  for (const s of sabitler) upsert(B, 'sabit', s);
  Object.assign(B.ayar, structuredClone(a), { kurulum_tarihi: gun });
  delete B.taslak;
  bakim(B, bugunGun, true);
  return { tamam: true };
}

// ---------------------------------------------------------------- hareketler

function islemEkle(B, govde) {
  const i = islemTemizle(govde);
  hesapVarMi(B, i.kaynak_id, i.hedef_id);
  islemEkle_(B, { ...i, olusturma: simdi() });
  return { tamam: true, id: i.id };
}

function islemGuncelle(B, id, govde) {
  const eski = B.islem.find((x) => x.id === id);
  if (!eski) throw new ApiHata(404, 'Kayıt bulunamadı');
  const i = islemTemizle({ ...eski, ...govde, id });
  hesapVarMi(B, i.kaynak_id, i.hedef_id);
  Object.assign(eski, {
    tarih: i.tarih, tur: i.tur, tutar: i.tutar, kaynak_id: i.kaynak_id, hedef_id: i.hedef_id, kategori_id: i.kategori_id, taksit: i.taksit,
    plan_disi: i.plan_disi, notu: i.notu, gelir_kaynagi: i.gelir_kaynagi, hedef_ref: eski.hedef_ref ?? i.hedef_ref, aile: i.aile, guncelleme: simdi(),
  });
  return { tamam: true };
}

function islemSil(B, id) {
  const eski = B.islem.find((x) => x.id === id);
  if (!eski) return { tamam: true };
  Object.assign(eski, { silindi: 1, guncelleme: simdi() });
  // Ödemeden doğan kayıt silinirse ödeme yeniden "bekliyor" olur.
  if (eski.odeme_id) {
    const o = B.odeme.find((x) => x.id === eski.odeme_id);
    if (o) Object.assign(o, { durum: 'bekliyor', islem_id: null, kapanis: null });
  }
  // Gelir silinirse ondan doğan, henüz yapılmamış havaleler de silinir.
  if (eski.tur === 'gelir') {
    B.odeme = B.odeme.filter((o) => !(o.id.startsWith(`gelir:${id}:`) && o.durum === 'bekliyor'));
    B.artan_aktarim = (B.artan_aktarim || []).filter((a) => a.gelir_id !== id);
  }
  return { tamam: true };
}

// Gelir + dağıtım payları. Yatırım (ve eski düzende havuz/birikim) payı "yapılacak havale" olur;
// giderler ve serbest pay hesapta kalır. artan_aktarim: maaşla yatırıma aktarılan artan bütçe (eksi olabilir);
// toplam kural: paylar = gelir + artan_aktarim. Serbest pay eksi olabilir (maaş ayın planını karşılamıyorsa).
function gelirEkle(B, govde) {
  const i = islemTemizle({ ...govde.islem, tur: 'gelir', aile: 0 });
  hesapVarMi(B, i.hedef_id);
  const a = H.ayarBirlestir(B.ayar);
  const p = govde.paylar || {};
  const paylar = { havuz: tam(p.havuz, 0), birikim: tam(p.birikim, 0), yatirim: tam(p.yatirim, 0), giderler: tam(p.giderler, 0), serbest: tam(p.serbest, 0) };
  const artan = tam(govde.artan_aktarim, 0);
  if ([paylar.havuz, paylar.birikim, paylar.yatirim, paylar.giderler].some((x) => x < 0)) throw new ApiHata(400, 'Pay eksi olamaz');
  if (Object.values(paylar).reduce((t, x) => t + x, 0) !== i.tutar + artan) throw new ApiHata(400, 'Payların toplamı gelire eşit olmalı');
  const hedefler = { havuz: a.havuz_hesabi, birikim: a.birikim_hesabi, yatirim: a.yatirim_hesabi, serbest: a.harcama_hesabi };
  const adlar = { havuz: 'Gelir havuzuna', birikim: 'Birikime', yatirim: 'Yatırıma', serbest: 'Harcama hesabına (serbest)' };
  islemEkle_(B, { ...i, olusturma: simdi() });
  if (artan) (B.artan_aktarim ||= []).push({ id: `artan:${i.id}`, tarih: i.tarih, tutar: artan, gelir_id: i.id });
  delete paylar.giderler;
  for (const [pay, tutar] of Object.entries(paylar)) {
    const hedef = hedefler[pay];
    if (!(tutar > 0) || !hedef || hedef === i.hedef_id) continue;
    odemeEkle_(B, {
      id: `gelir:${i.id}:${pay}`, tur: 'havale', sebep: 'gelir', ref_id: i.id, vade: i.tarih,
      ad: `${adlar[pay]} · ${i.gelir_kaynagi || 'Gelir'}`, tutar, kaynak_id: i.hedef_id, hedef_id: hedef,
      hedef_ref: pay === 'birikim' ? metin(govde.hedef_ref, 64) : null,
    });
  }
  return { tamam: true, id: i.id };
}

function odemeIslemi(B, id, eylem, govde, gun) {
  const o = B.odeme.find((x) => x.id === id);
  if (!o) throw new ApiHata(404, 'Ödeme bulunamadı');
  const zaman = simdi();
  if (eylem === 'atla') {
    if (o.durum === 'bekliyor') Object.assign(o, { durum: 'atlandi', kapanis: zaman });
    return { tamam: true };
  }
  if (eylem === 'geri') {
    if (o.islem_id) {
      const i = B.islem.find((x) => x.id === o.islem_id);
      if (i) Object.assign(i, { silindi: 1, guncelleme: zaman });
    }
    Object.assign(o, { durum: 'bekliyor', islem_id: null, kapanis: null });
    return { tamam: true };
  }
  if (o.durum !== 'bekliyor') return { tamam: true, zaten: true };
  const tutar = govde.tutar == null ? o.tutar : tam(govde.tutar);
  if (!(tutar > 0)) throw new ApiHata(400, 'Tutar geçersiz');
  const tarih = /^\d{4}-\d{2}-\d{2}$/.test(govde.tarih || '') ? govde.tarih : gun;
  const kaynak = metin(govde.kaynak_id, 64) || o.kaynak_id;
  const islemId = /^[\w:.-]{6,80}$/.test(govde.islem_id || '') ? govde.islem_id : `odm:${crypto.randomUUID()}`;
  const i = o.tur === 'sabit'
    ? { id: islemId, tarih, tur: 'gider', tutar, kaynak_id: kaynak, odeme_id: id, aile: B.sabit_kalem.find((x) => x.id === o.ref_id)?.aile ? 1 : 0 }
    : { id: islemId, tarih, tur: 'transfer', tutar, kaynak_id: kaynak, hedef_id: o.hedef_id, hedef_ref: o.hedef_ref, odeme_id: id };
  if (!i.kaynak_id) throw new ApiHata(400, 'Hangi hesaptan ödendiği seçilmeli');
  hesapVarMi(B, i.kaynak_id, i.hedef_id);
  islemEkle_(B, i);
  Object.assign(o, { durum: 'yapildi', islem_id: islemId, kapanis: zaman });
  return { tamam: true, islem_id: islemId };
}

function hesapEsitle(B, id, govde, gun) {
  const yeni = tam(govde.bakiye);
  if (yeni == null) throw new ApiHata(400, 'Bakiye geçersiz');
  const veri = veriYukle(B);
  if (!veri.hesaplar.some((h) => h.id === id)) throw new ApiHata(404, 'Hesap bulunamadı');
  const fark = yeni - (H.bakiyeler(veri).get(id) || 0);
  if (fark === 0) return { tamam: true, fark: 0 };
  const islemId = /^[\w:.-]{6,80}$/.test(govde.islem_id || '') ? govde.islem_id : `esitle:${id}:${Date.now()}`;
  islemEkle_(B, { id: islemId, tarih: gun, tur: 'duzeltme', tutar: fark, hedef_id: id, notu: 'Bakiye kontrolü' });
  return { tamam: true, fark };
}

// Kısma dağılımını kullanıcı değiştirir: toplam aynı kalır, her kategori kendi limitini aşmaz, kapanmış hafta değişmez.
function kismaDegistir(B, pzt, govde) {
  const eski = B.kisma?.[pzt];
  if (!eski) throw new ApiHata(404, 'Bu haftada kısma yok');
  if (B.hafta.some((h) => h.pazartesi === pzt)) throw new ApiHata(409, 'Hafta kapandı');
  const limitler = H.haftaLimitleri(veriYukle(B), pzt, { kismasiz: true });
  const yeni = {};
  for (const [id, x] of Object.entries(govde.dagilim || {})) {
    const t = tam(x);
    if (!(id in limitler) || t == null || t < 0 || t > limitler[id]) throw new ApiHata(400, 'Kısma geçersiz');
    if (t) yeni[id] = t;
  }
  const toplamT = (o) => Object.values(o).reduce((t, x) => t + x, 0);
  if (toplamT(yeni) !== toplamT(eski)) throw new ApiHata(400, 'Kısılan toplam değişmemeli');
  B.kisma[pzt] = yeni;
  return { tamam: true };
}

// "Ay sonundan düş": yalnız bu bütçe ayının bugüne kadarki haftaları; kapanmış hafta da değişebilir.
// Sürmekte olan haftanın kısması yeniden hesaplanır (açık ay sonuna gidince kısma kalkar, geri alınınca döner).
function aySonundanDegistir(B, pzt, govde, gun) {
  const ayar = H.ayarBirlestir(B.ayar);
  const buHafta = H.pazartesi(gun);
  if (pzt !== H.pazartesi(pzt) || pzt > buHafta || H.haftaAyi(pzt, ayar) !== H.haftaAyi(buHafta, ayar)) throw new ApiHata(409, 'Bu hafta değiştirilemez');
  B.ay_sonundan ||= {};
  if (govde.acik) B.ay_sonundan[pzt] = 1;
  else delete B.ay_sonundan[pzt];
  kismaYenile(B, gun);
  return { tamam: true };
}

// İçe aktarma: hepsi doğrulanır, sonra hepsi birden eklenir (biri hatalıysa hiçbiri). Aynı kimlik varsa atlanır.
function iceAktar(B, govde) {
  const liste = Array.isArray(govde.islemler) ? govde.islemler : [];
  if (!liste.length) throw new ApiHata(400, 'Eklenecek kayıt yok');
  const kategoriler = new Set(B.kategori.map((k) => k.id));
  const temiz = liste.map((g, n) => {
    if (!/^ice-[\w-]{6,60}$/.test(g?.id || '')) throw new ApiHata(400, `${n + 1}. kayıt: kimlik geçersiz`);
    const i = islemTemizle({ ...g, tur: 'gider' });
    if (!i.kategori_id || !(kategoriler.has(i.kategori_id) || i.kategori_id === H.ARTAN_KATEGORI)) throw new ApiHata(400, `${n + 1}. kayıt: kategori seçilmedi`);
    hesapVarMi(B, i.kaynak_id);
    return i;
  });
  let eklenen = 0;
  const zaman = simdi();
  for (const i of temiz) if (islemEkle_(B, { ...i, olusturma: zaman })) eklenen++;
  return { tamam: true, eklenen };
}

// Deneme verisi: yalnız kurulumdan önce; bütün belge uydurmadır, silinince belge boşalır (PIN kalır).
function denemeKur(B, gun) {
  if (B.ayar.kurulum_tarihi) throw new ApiHata(409, 'Kurulum yapılmış; deneme verisi yalnız kurulumdan önce eklenir');
  const ara = {
    istek: (yol, yontem, govde, g) => { bakim(B, g); return yonlendir(B, yol, yontem, structuredClone(govde ?? {}), g); },
    veri: (g) => { bakim(B, g); return telefonVerisi(veriYukle(B), g); },
  };
  denemeOlustur(ara, gun);
  bakim(B, gun);
  B.ayar.deneme = true;
  delete B.taslak;
  return { tamam: true };
}

function denemeSil(B) {
  if (!B.ayar.deneme) throw new ApiHata(409, 'Gerçek kayıtlar silinemez');
  const bos = bosBelge();
  for (const k of Object.keys(B)) delete B[k];
  Object.assign(B, bos);
  return { tamam: true };
}

// ---------------------------------------------------------------- yönlendirme

// Okuma yolları belgeyi değiştirmez; yazma yolları belgenin kopyası üzerinde çalışır.
// Kopya ancak iş hatasız biterse kaydedilir (yarım kalan iş belgeyi bozmaz).
function yonlendir(B, yol, yontem, govde, gun) {
  if (yol === '/durum' && yontem === 'GET') return { kurulum: !!B.ayar.kurulum_tarihi };
  if (yol === '/veri' && yontem === 'GET') return telefonVerisi(veriYukle(B), gun);
  if (yol === '/bakim' && yontem === 'POST') { bakim(B, gun, true); return { tamam: true }; }
  if (yol === '/kurulum' && yontem === 'POST') return kurulum(B, govde, gun);

  let m;
  const eskiTarih = (id) => B.islem.find((x) => x.id === id)?.tarih;
  const sonra = (sonuc, tarihler) => { sonraDuzelt(B, tarihler, gun); return sonuc; };
  if (yol === '/islem' && yontem === 'POST') return sonra(islemEkle(B, govde), [govde?.tarih]);
  if ((m = yol.match(/^\/islem\/([\w:.-]+)$/))) {
    const once = eskiTarih(m[1]);
    if (yontem === 'PUT') return sonra(islemGuncelle(B, m[1], govde), [once, govde?.tarih]);
    if (yontem === 'DELETE') return sonra(islemSil(B, m[1]), [once]);
  }
  if (yol === '/gelir' && yontem === 'POST') return gelirEkle(B, govde);
  if ((m = yol.match(/^\/odeme\/([\w:.-]+)\/(yap|atla|geri)$/)) && yontem === 'POST') return sonra(odemeIslemi(B, m[1], m[2], govde, gun), []);
  if ((m = yol.match(/^\/hesap\/([\w-]+)\/esitle$/)) && yontem === 'POST') return hesapEsitle(B, m[1], govde, gun);
  if ((m = yol.match(/^\/(hesap|kategori|hedef|sabit)\/([\w-]+)$/))) {
    if (yontem === 'PUT') return kayitYaz(B, m[1], m[2], govde, gun);
    if (yontem === 'DELETE') return kayitKaldir(B, m[1], m[2], gun);
  }
  if (yol === '/ayar' && yontem === 'PUT') return ayarGuncelle(B, govde);

  if ((m = yol.match(/^\/kisma\/(\d{4}-\d{2}-\d{2})$/)) && yontem === 'PUT') return kismaDegistir(B, m[1], govde);
  if ((m = yol.match(/^\/hafta\/(\d{4}-\d{2}-\d{2})\/ay-sonundan$/)) && yontem === 'PUT') return aySonundanDegistir(B, m[1], govde, gun);
  if (yol === '/yedek-alindi' && yontem === 'POST') { B.ayar.son_yedek = gun; return { tamam: true }; }
  if (yol === '/ice-aktar' && yontem === 'POST') return sonra(iceAktar(B, govde), (Array.isArray(govde?.islemler) ? govde.islemler : []).map((i) => i?.tarih));
  if (yol === '/ice-aktar/geri' && yontem === 'POST') {
    const tarihler = [];
    for (const id of Array.isArray(govde.idler) ? govde.idler : []) if (typeof id === 'string' && id.startsWith('ice-')) { tarihler.push(eskiTarih(id)); islemSil(B, id); }
    return sonra({ tamam: true }, tarihler);
  }
  if (yol === '/deneme' && yontem === 'POST') return denemeKur(B, gun);
  if (yol === '/deneme' && yontem === 'DELETE') return denemeSil(B);

  // Kurulum sihirbazının yarım kalan taslağı (bakiyeler içerir; belgeyle birlikte şifreli durur).
  if (yol === '/taslak') {
    if (yontem === 'GET') return { taslak: B.taslak ?? null };
    if (yontem === 'PUT') { B.taslak = govde; return { tamam: true }; }
    if (yontem === 'DELETE') { delete B.taslak; return { tamam: true }; }
  }

  throw new ApiHata(404, 'Böyle bir istek yok');
}

// depo: { oku(), yaz(belge) } (depo.js; telefonda sifreliKasa). bugun: denemelerde günü sabitlemek için.
// Kasa kilitliyken her istek 401 döner; arayüz PIN sorar.
export function yerelApi(depo, { bugun = H.bugun } = {}) {
  let belge = null;
  let sira = Promise.resolve(); // istekler sırayla: iki dokunuş aynı anda belgeyi ezmesin

  async function yukle() {
    if (!belge) {
      try {
        belge = (await depo.oku()) || bosBelge();
      } catch (e) {
        if (e.kilitli) throw new ApiHata(401, 'Kilitli');
        throw e;
      }
    }
    return belge;
  }

  function sirayla(fn) {
    const is = sira.then(fn);
    sira = is.catch(() => {});
    return is;
  }

  async function calistir(yol, { yontem = 'GET', govde } = {}) {
    let y;
    try { y = decodeURIComponent(yol); } catch { throw new ApiHata(400, 'Adres okunamadı'); }
    const gun = bugun();
    const B = await yukle();
    // Ekran açılırken günlük bakım (günde bir kez).
    if (y === '/veri' && yontem === 'GET' && B.ayar.kurulum_tarihi && B.ayar.son_bakim !== gun) {
      const kopya = structuredClone(B);
      if (bakim(kopya, gun)) { await depo.yaz(kopya); belge = kopya; }
    }
    if (yontem === 'GET') return structuredClone(yonlendir(belge, y, yontem, {}, gun));
    const kopya = structuredClone(belge);
    const sonuc = yonlendir(kopya, y, yontem, structuredClone(govde ?? {}), gun);
    await depo.yaz(kopya);
    belge = kopya;
    return structuredClone(sonuc);
  }

  return {
    istek: (yol, secenek) => sirayla(() => calistir(yol, secenek)),
    // Yedek ve deneme için: belgenin tamamı.
    belge: () => sirayla(async () => structuredClone(await yukle())),
    // PIN (yalnız şifreli kasada): 'yok' · 'kilitli' · 'acik'
    kasaDurumu: () => depo.durum(),
    pinBelirle: (pin) => sirayla(async () => { await depo.kur(pin, bosBelge()); belge = null; }),
    pinGir: (pin) => sirayla(async () => { await depo.ac(pin); belge = null; }),
    // Yedek: şifreli zarfın dosya metni. Geri yükleme yedeğin PIN'iyle; yanlışsa telefondaki kayıtlar değişmez.
    yedekHazirla: () => sirayla(async () => {
      const zarf = await depo.zarf();
      if (!zarf) throw new ApiHata(404, 'Henüz kayıt yok');
      return yedekMetni(zarf);
    }),
    geriYukle: (metin, pin) => sirayla(async () => {
      const { zarf, tarih } = yedekOku(metin);
      await depo.geriYukle(zarf, pin);
      belge = null;
      // Yüklenen yedeğin alındığı gün "son yedek" sayılır (yedek, kendi alındı işaretinden önce yazıldı).
      const gunu = tarih && !Number.isNaN(Date.parse(tarih)) ? H.bugun(Date.parse(tarih)) : null;
      const B = await yukle();
      if (gunu && !(B.ayar.son_yedek >= gunu)) {
        const kopya = structuredClone(B);
        kopya.ayar.son_yedek = gunu;
        await depo.yaz(kopya);
        belge = kopya;
      }
    }),
    kilitle: () => sirayla(async () => { depo.kilitle(); belge = null; }),
  };
}
