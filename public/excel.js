// BANK OF USY — Excel'e aktar: kayıtlardan sayfalar (salt veri). Excel dosyasını app.js SheetJS ile yazar
// (vendor/xlsx.full.min.js, yalnız aktarırken yüklenir). Bu dosya saftır; Node denemeleri de kullanır.
// Sayfa: { ad, sutunlar: [{ baslik, genislik, bicim: 'para'|'tarih'|undefined }], satirlar: [[...]] }
// Tutarlar ₺ (kuruş / 100) sayı olarak, tarihler 'YYYY-AA-GG' metni olarak gelir; app.js tarihi Excel tarihine çevirir.
import * as H from './hesap.js';

const tl = (k) => (k == null ? null : Math.round(Number(k)) / 100);
const PARA = 'para';
const TARIH = 'tarih';
const s = (baslik, genislik, bicim) => ({ baslik, genislik, bicim });

const TUR_ADI = { gider: 'Harcama', gelir: 'Gelir', transfer: 'Transfer', duzeltme: 'Bakiye düzeltme' };
const KOVA_ADI = { haftalik: 'Haftalık', aylik: 'Aylık', beklenmeyen: 'Beklenmeyen', is: 'İş gideri', artan: H.ARTAN_AD };

export function excelSayfalari(veri, gun) {
  const a = H.ayarBirlestir(veri.ayar);
  const hesap = new Map(veri.hesaplar.map((h) => [h.id, h.ad]));
  const kat = new Map(veri.kategoriler.map((k) => [k.id, k]));
  const odeme = new Map(veri.odemeler.map((o) => [o.id, o]));
  const islemler = [...veri.islemler].sort((x, y) => x.tarih.localeCompare(y.tarih) || String(x.olusturma).localeCompare(String(y.olusturma)));
  const sayfalar = [];

  // 1 · Hareketler
  sayfalar.push({
    ad: 'Hareketler',
    sutunlar: [s('Tarih', 12, TARIH), s('Bütçe ayı', 14), s('Tür', 14), s('Açıklama', 24), s('Kova', 14), s('Hesap', 18), s('Karşı hesap', 18), s('Tutar', 14, PARA), s('Bütçeye düşen', 14, PARA), s('Taksit', 8), s('Plan dışı', 9), s('Ailem ödüyor', 12), s('Not', 30)],
    satirlar: islemler.map((i) => {
      const k = i.kategori_id === H.ARTAN_KATEGORI ? { ad: H.ARTAN_AD } : kat.get(i.kategori_id);
      const o = odeme.get(i.odeme_id);
      const kova = i.tur === 'gider' ? (o ? (o.tur === 'sabit' ? 'Sabit ödeme' : '') : KOVA_ADI[H.giderKovasi(i, kat)] || '') : '';
      const butce = i.tur === 'gider' && !i.aile ? tl(-H.butcePayi(i)) : null;
      return [i.tarih, H.ayAdi(H.butceAyi(i.tarih, a)), TUR_ADI[i.tur], k?.ad || o?.ad || (i.aile ? 'Aileden' : i.gelir_kaynagi) || '', kova,
        hesap.get(i.kaynak_id) || '', hesap.get(i.hedef_id) || '', tl(i.tur === 'gider' ? -i.tutar : i.tutar), butce,
        i.taksit > 1 ? i.taksit : null, i.plan_disi ? 'evet' : '', i.aile ? 'evet' : '', i.notu || ''];
    }),
  });

  // 2 · Haftalar
  sayfalar.push({
    ad: 'Haftalar',
    sutunlar: [s('Pazartesi', 12, TARIH), s('Pazar', 12, TARIH), s('Bütçe ayı', 14), s('Limit', 14, PARA), s('Harcanan', 14, PARA), s('Fark (artan bütçeye)', 18, PARA), s('Kısılan', 12, PARA)],
    satirlar: [...veri.haftalar].sort((x, y) => x.pazartesi.localeCompare(y.pazartesi)).map((h) => {
      const l = Object.values(JSON.parse(h.limitler)).reduce((t, x) => t + x, 0);
      const x = Object.values(JSON.parse(h.harcanan)).reduce((t, y) => t + y, 0);
      const k = veri.kismalar?.[h.pazartesi];
      return [h.pazartesi, H.ekleGun(h.pazartesi, 6), H.ayAdi(h.ay), tl(l), tl(x), tl(h.fark), k ? tl(Object.values(k).reduce((t, y) => t + y, 0)) : null];
    }),
  });

  // 3 · Aylar (bütçe ayları, kova başına plan / gerçekleşen)
  const aylar = [];
  const ilk = H.kurulumAyi(a);
  if (ilk) for (let ay = ilk; ay <= H.butceAyi(gun, a); ay = H.ekleAy(ay, 1)) aylar.push(ay);
  const aySatirlari = [];
  for (const ay of aylar) {
    const p = H.ayPlani(veri, ay);
    for (const k of p.kovalar) aySatirlari.push([H.ayAdi(ay), H.ayAraligiYaz(ay, a), k.ad, tl(k.plan), tl(k.gercek), tl(k.plan - k.gercek)]);
    aySatirlari.push([H.ayAdi(ay), H.ayAraligiYaz(ay, a), 'Toplam', tl(p.plan), tl(p.gercek), tl(p.plan - p.gercek)]);
  }
  sayfalar.push({ ad: 'Aylar', sutunlar: [s('Bütçe ayı', 14), s('Aralık', 22), s('Kova', 20), s('Plan', 14, PARA), s('Gerçekleşen', 14, PARA), s('Kalan', 14, PARA)], satirlar: aySatirlari });

  // 4 · Kategori × Ay (bütçeye düşen pay; ailem ödüyor hariç)
  const katListe = [...veri.kategoriler.filter((k) => k.aktif !== 0 || islemler.some((i) => i.kategori_id === k.id)), { id: H.ARTAN_KATEGORI, ad: H.ARTAN_AD }];
  sayfalar.push({
    ad: 'Kategori × Ay',
    sutunlar: [s('Kategori', 22), ...aylar.map((ay) => s(H.ayAdi(ay), 14, PARA)), s('Toplam', 14, PARA)],
    satirlar: katListe.map((k) => {
      let toplam = 0;
      const hucre = aylar.map((ay) => {
        const { bas, son } = H.ayAraligi(ay, a);
        const t = islemler.filter((i) => i.tur === 'gider' && !i.aile && i.kategori_id === k.id && i.tarih >= bas && i.tarih <= son).reduce((x, i) => x + H.butcePayi(i), 0);
        toplam += t;
        return tl(t);
      });
      return [`${k.ad}${k.is_gideri ? ' (iş)' : ''}`, ...hucre, tl(toplam)];
    }),
  });

  // 5 · Gelir ve yatırım
  const aktarim = new Map((veri.artanAktarimlari || []).map((x) => [x.gelir_id, x.tutar]));
  sayfalar.push({
    ad: 'Gelir ve yatırım',
    sutunlar: [s('Tarih', 12, TARIH), s('Kaynak', 16), s('Yattığı hesap', 18), s('Gelir', 14, PARA), s('Artan bütçeden', 14, PARA), s('Yatırıma', 14, PARA), s('Hesapta kalan', 14, PARA)],
    satirlar: islemler.filter((i) => i.tur === 'gelir').map((i) => {
      const yat = odeme.get(`gelir:${i.id}:yatirim`)?.tutar || 0;
      const art = aktarim.get(i.id) || 0;
      return [i.tarih, i.aile ? 'Aileden' : i.gelir_kaynagi, hesap.get(i.hedef_id) || '', tl(i.tutar), art ? tl(art) : null, yat ? tl(yat) : null, tl(i.tutar + art - yat)];
    }),
  });

  // 6 · Sabit ödemeler
  const durumAdi = { bekliyor: 'Bekliyor', yapildi: 'Ödendi', atlandi: 'Atlandı' };
  const islemHarita = new Map(veri.islemler.map((i) => [i.id, i]));
  const sabit = new Map(veri.sabitler.map((x) => [x.id, x]));
  sayfalar.push({
    ad: 'Sabit ödemeler',
    sutunlar: [s('Vade', 12, TARIH), s('Bütçe ayı', 14), s('Ödeme', 24), s('Plan', 14, PARA), s('Ödenen', 14, PARA), s('Durum', 10), s('Hesap', 18), s('Ailem ödüyor', 12)],
    satirlar: veri.odemeler.filter((o) => o.tur === 'sabit').sort((x, y) => x.vade.localeCompare(y.vade)).map((o) => [
      o.vade, H.ayAdi(H.butceAyi(o.vade, a)), o.ad, tl(o.tutar), islemHarita.has(o.islem_id) ? tl(islemHarita.get(o.islem_id).tutar) : null,
      durumAdi[o.durum], hesap.get(o.kaynak_id) || '', sabit.get(o.ref_id)?.aile ? 'evet' : '']),
  });

  // 7 · Hesaplar (bugünkü bakiye), aileden alacak ve net varlık
  const b = H.bakiyeler(veri);
  const hs = veri.hesaplar.map((h) => [h.ad, H.HESAP_TURLERI[h.tur], H.BANKALAR[h.banka] || '', tl(b.get(h.id) || 0), tl(h.limit_tutar), h.aktif !== 0 ? 'açık' : 'kapalı']);
  const alacak = H.aileAlacagi(veri);
  if (alacak) hs.push(['Aileden alacak', '', '', tl(alacak), null, '']);
  hs.push(['Net varlık', '', '', tl(H.netVarlik(veri)), null, ''], [], [`Bakiyeler ${H.tarihYaz(gun, true)} itibarıyla`]);
  sayfalar.push({ ad: 'Hesaplar', sutunlar: [s('Hesap', 22), s('Tür', 14), s('Banka', 14), s('Bakiye', 16, PARA), s('Limit', 14, PARA), s('Durum', 10)], satirlar: hs });

  // 8 · Yatırım
  const y = H.yatirimOzeti(veri, gun, Math.max(1, aylar.length));
  if (y) {
    sayfalar.push({
      ad: 'Yatırım',
      sutunlar: [s('Bütçe ayı', 16), s('Katkı', 14, PARA)],
      satirlar: [...y.aylar.map((x) => [H.ayAdi(x.ay), tl(x.tutar)]), [], ['Toplam yatırılan', tl(y.yatirilan)], ['Güncel değer', tl(y.deger)], ['Kazanç', tl(y.kazanc)]],
    });
  }
  return sayfalar;
}
