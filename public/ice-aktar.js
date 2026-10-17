// BANK OF USY — içe aktarma dosyası (Claude'un banka listesinden hazırladığı harcamalar). Saf: okur, eşleştirir; yazmaz.
// Dosya (JSON):
//   { "bicim": "bank-of-usy-ice-aktar", "surum": 1, "aciklama": "Garanti Bonus 13–20 Ekim",
//     "hareketler": [ { "tarih": "2026-10-14", "tutar": 42500, "aciklama": "Akaryakıt",
//                       "kategori": "Benzin", "hesap": "Bonus", "taksit": 1, "aile": false } ] }
// tutar kuruştur (425,00 ₺ → 42500). kategori ve hesap uygulamadaki adlarla eşleştirilir (büyük/küçük harf fark etmez);
// eşleşmeyen kategori ekranda sorulur. Kimlik içerikten üretilir: aynı dosya ikinci kez yüklenirse kayıt çift olmaz.
import * as H from './hesap.js';

export const ICE_BICIM = 'bank-of-usy-ice-aktar';
const EN_COK = 2000;

const kucuk = (x) => String(x ?? '').trim().toLocaleLowerCase('tr');

// FNV-1a (32 bit): kısa, kararlı kimlik için.
function ozet(metin) {
  let h = 0x811c9dc5;
  for (const c of metin) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function iceAktarOku(metin, veri) {
  let d;
  try { d = JSON.parse(metin); } catch { throw new Error('Bu bir içe aktarma dosyası değil'); }
  if (d?.bicim !== ICE_BICIM || !Array.isArray(d.hareketler)) throw new Error('Bu bir içe aktarma dosyası değil');
  if (!d.hareketler.length) throw new Error('Dosyada kayıt yok');
  if (d.hareketler.length > EN_COK) throw new Error(`Bir dosyada en çok ${EN_COK} kayıt olabilir`);

  const kategoriler = new Map();
  for (const k of (veri.kategoriler || []).filter((x) => x.aktif !== 0)) kategoriler.set(kucuk(k.ad), k.id);
  kategoriler.set(kucuk(H.ARTAN_AD), H.ARTAN_KATEGORI);
  const hesaplar = new Map();
  for (const h of (veri.hesaplar || []).filter((x) => x.aktif !== 0 && ['nakit', 'vadesiz', 'kart'].includes(x.tur))) hesaplar.set(kucuk(h.ad), h.id);
  const hesapBul = (ad) => {
    if (!ad) return null;
    const a = kucuk(ad);
    if (hesaplar.has(a)) return hesaplar.get(a);
    const parca = [...hesaplar.keys()].filter((x) => x.includes(a)); // "Bonus" → "Garanti Bonus"
    return parca.length === 1 ? hesaplar.get(parca[0]) : null;
  };
  const mevcut = new Set((veri.islemler || []).map((i) => i.id));
  const sayac = new Map();

  const satirlar = d.hareketler.map((x, n) => {
    const yer = `${n + 1}. kayıt`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x?.tarih || '')) throw new Error(`${yer}: tarih geçersiz`);
    if (!Number.isInteger(x.tutar) || x.tutar <= 0) throw new Error(`${yer}: tutar kuruş olarak pozitif tam sayı olmalı`);
    const aciklama = String(x.aciklama ?? '').trim().slice(0, 80);
    if (H.kartNoVarMi(aciklama)) throw new Error(`${yer}: kart numarası yazılamaz`);
    const taksit = x.taksit == null ? 1 : Number(x.taksit);
    if (!Number.isInteger(taksit) || taksit < 1 || taksit > 36) throw new Error(`${yer}: taksit geçersiz`);
    const anahtar = `${x.tarih}|${x.tutar}|${kucuk(aciklama)}`;
    const sira = (sayac.get(anahtar) || 0) + 1;
    sayac.set(anahtar, sira);
    const id = `ice-${x.tarih}-${ozet(`${anahtar}|${sira}`)}`;
    return {
      id, tarih: x.tarih, tutar: x.tutar, aciklama, taksit, aile: !!x.aile,
      kategori_id: kategoriler.get(kucuk(x.kategori)) || null, hesap_id: hesapBul(x.hesap), var: mevcut.has(id),
    };
  });
  return { aciklama: String(d.aciklama || '').slice(0, 80), satirlar };
}

// Eklenecek kayıtlar (zaten olanlar atlanır). Hesabı belli olmayanlara varsayılan hesap verilir.
export function iceAktarIslemleri(sonuc, varsayilanHesap) {
  return sonuc.satirlar.filter((s) => !s.var).map((s) => ({
    id: s.id, tarih: s.tarih, tur: 'gider', tutar: s.tutar, kaynak_id: s.hesap_id || varsayilanHesap, kategori_id: s.kategori_id,
    taksit: s.taksit, aile: s.aile ? 1 : 0, notu: s.aciklama || null,
  }));
}
