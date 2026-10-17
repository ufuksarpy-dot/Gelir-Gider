// BANK OF USY — deneme verisi: kurulumdan önce uygulamayı kurcalamak için uydurma, yaklaşık 8 haftalık bir geçmiş.
// Gün gün ilerler (bakım her gün çalışır): haftalık harcamalar, ara sıra hafta sonu aşımı (artan bütçe eksiye düşer,
// sonraki hafta kısılır), her 10'unda maaş + yatırım, ailem ödüyor, artan bütçeden harcama, kart ödemeleri.
// Hiçbir tutar ya da ad gerçek değildir. yerel-api.js çağırır: ara = { istek(yol, yontem, govde, gun), veri(gun) }.
import * as H from './hesap.js';

const GECMIS_GUN = 55; // kurulum en çok 60 gün geriye gidebilir

const KURULUM = (baslangic) => ({
  baslangic,
  ayar: {
    ay_baslangic_gunu: 10, maas: { tutar: 5500000, hesap_id: 'deneme-vadesiz' }, yatirim_tutari: 2000000, beklenmeyen: 150000,
    gelir_kaynaklari: ['Maaş', 'Ek gelir'], harcama_hesabi: 'deneme-vadesiz', yatirim_hesabi: 'deneme-yatirim',
  },
  hesaplar: [
    { id: 'deneme-vadesiz', ad: 'Deneme vadesiz', tur: 'vadesiz', acilis_bakiye: 2500000, sira: 0 },
    { id: 'deneme-kart', ad: 'Deneme kart', tur: 'kart', acilis_bakiye: 0, limit_tutar: 8000000, kesim_gunu: 12, son_odeme_gunu: 22, odeme_hesap_id: 'deneme-vadesiz', sira: 1 },
    { id: 'deneme-yatirim', ad: 'Deneme yatırım', tur: 'yatirim', acilis_bakiye: 8000000, sira: 2 },
  ],
  kategoriler: [
    { id: 'deneme-benzin', ad: 'Benzin', simge: '⛽', tur: 'haftalik', limit_tutar: 150000, sira: 1 },
    { id: 'deneme-yemek', ad: 'Yemek', simge: '🍽️', tur: 'haftalik', limit_tutar: 100000, sira: 2 },
    { id: 'deneme-hsonu', ad: 'Hafta sonu', simge: '🎉', tur: 'haftalik', limit_tutar: 120000, sira: 3 },
    { id: 'deneme-alis', ad: 'Alışveriş', simge: '🛍️', tur: 'aylik', limit_tutar: 300000, sira: 4 },
  ],
  sabitler: [
    { id: 'deneme-spor', ad: 'Spor', tutar: 200000, gun: 25, periyot: 1, ilk_ay: baslangic.slice(0, 7), hesap_id: 'deneme-kart', otomatik: 1 },
    { id: 'deneme-abone', ad: 'Abonelik', tutar: 40000, gun: 5, periyot: 1, ilk_ay: baslangic.slice(0, 7), hesap_id: 'deneme-kart', otomatik: 1 },
    { id: 'deneme-taksit', ad: 'Taksit (ailem ödüyor)', tutar: 100000, gun: 3, periyot: 1, ilk_ay: baslangic.slice(0, 7), son_vade: H.ekleAyTarih(baslangic, 5), hesap_id: 'deneme-kart', otomatik: 1, aile: 1 },
  ],
});

// Haftanın günü (0 = pazartesi) → [kategori, tutar]
const HAFTALIK = { 0: ['deneme-benzin', 70000], 2: ['deneme-yemek', 45000], 4: ['deneme-yemek', 40000], 5: ['deneme-hsonu', 100000], 6: ['deneme-benzin', 65000] };

export function denemeOlustur(ara, bugun) {
  const bas = H.ekleGun(bugun, -GECMIS_GUN);
  ara.istek('/kurulum', 'POST', KURULUM(bas), bas);
  let hafta = 0;
  for (let g = bas; g <= bugun; g = H.ekleGun(g, 1)) {
    const gun = H.haftaGunu(g);
    if (gun === 0 && g !== bas) hafta++;
    const gider = (sonek, kategori, tutar, ek = {}) => ara.istek('/islem', 'POST', { id: `deneme-${g}-${sonek}`, tarih: g, tur: 'gider', tutar, kaynak_id: 'deneme-kart', kategori_id: kategori, ...ek }, g);

    const plan = HAFTALIK[gun];
    if (plan) {
      const [kategori, tutar] = plan;
      // Her üç haftada bir hafta sonu aşılır.
      gider('h', kategori, kategori === 'deneme-hsonu' && hafta % 3 === 2 ? 195000 : tutar);
    }
    const ayGunu = Number(g.slice(8, 10));
    if (ayGunu === 20) gider('a', 'deneme-alis', 180000);
    if (g === H.ekleGun(bas, 10)) gider('aile', 'deneme-alis', 250000, { aile: 1, notu: 'Ailem ödüyor örneği' });
    if (g === H.ekleGun(bas, 30)) gider('artan', H.ARTAN_KATEGORI, 60000, { notu: 'Artan bütçeden' });

    // Maaş: her 10'unda; giderler kalır, yatırım havalesi ertesi gün yapılır.
    if (ayGunu === 10) {
      const v = ara.veri(g);
      const d = H.gelirDagitimi(v, 5500000, { maas: true, tarih: g, gun: g });
      ara.istek('/gelir', 'POST', { islem: { id: `deneme-maas-${g}`, tarih: g, tutar: 5500000, hedef_id: 'deneme-vadesiz', gelir_kaynagi: 'Maaş' }, paylar: { giderler: d.giderler, yatirim: d.yatirim, serbest: d.serbest }, artan_aktarim: d.artan }, g);
    }
    // Bekleyen havale ve kart ödemeleri vadesinde yapılır; aile parası maaşla gelir.
    const v = ara.veri(g);
    for (const o of v.odemeler) {
      if (o.durum !== 'bekliyor' || o.vade > g || o.tur === 'sabit') continue;
      ara.istek(`/odeme/${o.id}/yap`, 'POST', { tutar: o.tutar, tarih: g, islem_id: `deneme-odm-${g}-${o.id.length}${o.tutar % 997}` }, g);
    }
    if (ayGunu === 11) {
      const alacak = H.aileAlacagi(v);
      if (alacak > 0) ara.istek('/islem', 'POST', { id: `deneme-aile-${g}`, tarih: g, tur: 'gelir', tutar: alacak, hedef_id: 'deneme-vadesiz', gelir_kaynagi: 'Aile', aile: 1 }, g);
    }
  }
  // Yatırımın değeri biraz artmış olsun.
  const v = ara.veri(bugun);
  const deger = H.bakiyeler(v).get('deneme-yatirim') || 0;
  ara.istek('/hesap/deneme-yatirim/esitle', 'POST', { bakiye: Math.round(deger * 1.012), islem_id: `deneme-deger-${bugun}` }, bugun);
}
