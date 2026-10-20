// Ay sonu tahmininin isabeti (2026-10-20 sınaması): erken maaş, aşım + kalan limit. Bütün veriler uydurmadır.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as H from '../public/hesap.js';
import { bellekDeposu } from '../public/depo.js';
import { yerelApi } from '../public/yerel-api.js';

async function kur(baslangic) {
  const g = { gun: '2026-10-20' };
  const api = yerelApi(bellekDeposu(), { bugun: () => g.gun });
  const iste = (yol, yontem = 'GET', govde) => api.istek(yol, { yontem, govde });
  await iste('/kurulum', 'POST', {
    baslangic,
    ayar: { ay_baslangic_gunu: 10, maas: { tutar: 6000000, hesap_id: 'v-tahm' }, yatirim_tutari: 1500000, harcama_hesabi: 'v-tahm', yatirim_hesabi: 'y-tahm' },
    hesaplar: [
      { id: 'v-tahm', ad: 'Deneme vadesiz', tur: 'vadesiz', acilis_bakiye: 3000000 },
      { id: 'k-tahm', ad: 'Deneme kart', tur: 'kart', acilis_bakiye: 0, limit_tutar: 5000000, kesim_gunu: 12, son_odeme_gunu: 22, odeme_hesap_id: 'v-tahm' },
      { id: 'y-tahm', ad: 'Deneme yatırım', tur: 'yatirim', acilis_bakiye: 0 },
    ],
    kategoriler: [
      { id: 'yemek', ad: 'Yemek', tur: 'haftalik', limit_tutar: 140000, sira: 1 },
      { id: 'gezme', ad: 'Gezme', tur: 'haftalik', limit_tutar: 140000, sira: 2 },
      { id: 'diger', ad: 'Diğer', tur: 'aylik', limit_tutar: 120000, sira: 3 },
    ],
    sabitler: [],
  });
  let n = 0;
  const gider = (tutar, kategori_id) => iste('/islem', 'POST', { id: `tahmin-${++n}`, tarih: g.gun, tur: 'gider', tutar, kaynak_id: 'k-tahm', kategori_id });
  const tahmin = async () => H.aySonuTahmini(await iste('/veri'), g.gun).tutar;
  return { g, iste, gider, tahmin };
}

test('aylık limit içindeki harcama tahmini değiştirmez, limit üstü lirası lirasına düşürür', async () => {
  const o = await kur('2026-10-19'); // kurulum ayı: Diğer limiti 1.200 × 22/31
  const bas = await o.tahmin();
  await o.gider(50000, 'diger');
  assert.equal(await o.tahmin(), bas);
  const limit = Math.round(120000 * 22 / 31);
  await o.gider(limit - 50000 + 30000, 'diger'); // 300 aşar
  assert.equal(await o.tahmin(), bas - 30000);
});

test('bir kategori aşılıp diğerinde para kalınca: kalanı harcamak tahmini yükseltmez', async () => {
  const o = await kur('2026-10-19'); // artan bütçe 0
  const bas = await o.tahmin();
  await o.gider(170000, 'yemek'); // 300 aşım → sonraki hafta kısılır, ay sonu değişmez
  assert.equal(await o.tahmin(), bas);
  await o.gider(140000, 'gezme');
  assert.equal(await o.tahmin(), bas);
});

test('gelecek ayın maaşı erken yatınca tahmin maaştan önceki günü gösterir', async () => {
  const o = await kur('2026-10-19');
  o.g.gun = '2026-11-06';
  const once = await o.tahmin();
  const v = await o.iste('/veri');
  const d = H.gelirDagitimi(v, 6000000, { maas: true, tarih: o.g.gun, gun: o.g.gun });
  assert.equal(d.ay, '2026-11');
  await o.iste('/gelir', 'POST', { islem: { id: 'maas-erken-1', tarih: o.g.gun, tur: 'gelir', tutar: 6000000, hedef_id: 'v-tahm', gelir_kaynagi: 'Maaş', taksit: 1 }, paylar: { giderler: d.giderler, yatirim: d.yatirim, serbest: d.serbest }, artan_aktarim: d.artan });
  assert.equal(await o.tahmin(), once);
  const havale = (await o.iste('/veri')).odemeler.find((x) => x.sebep === 'gelir' && x.durum === 'bekliyor');
  await o.iste(`/odeme/${encodeURIComponent(havale.id)}/yap`, 'POST', {});
  assert.equal(await o.tahmin(), once);
  o.g.gun = '2026-11-10'; // yeni ayda maaş sayılır
  assert.ok(await o.tahmin() > once);
});

test('taksitli alışverişte tahminden yalnız bu ayın payı düşer', async () => {
  const o = await kur('2026-10-19');
  const bas = await o.tahmin();
  await o.iste('/islem', 'POST', { id: 'tahmin-taksit', tarih: o.g.gun, tur: 'gider', tutar: 300000, kaynak_id: 'k-tahm', kategori_id: 'diger', taksit: 3, plan_disi: 1 });
  const t = H.aySonuTahmini(await o.iste('/veri'), o.g.gun);
  assert.equal(t.tutar, bas - 100000);
  assert.equal(t.kalemler.find((k) => k.ad === 'Sonraki aylara düşen taksitler').tutar, 200000);
});

test('dökümde her kategori için ayrılan para; aşılan kategori 0 ve aşımı', async () => {
  const o = await kur('2026-10-19');
  await o.gider(30000, 'yemek');
  const limit = Math.round(120000 * 22 / 31);
  await o.gider(limit + 34100, 'diger');
  const t = H.aySonuTahmini(await o.iste('/veri'), o.g.gun);
  const haftalik = t.kalemler.find((k) => k.ad === 'Kalan haftalık bütçeler');
  // 3 hafta + 9 Kas (Kasım haftasının Ekim'e düşen 1 günü: 1/7)
  assert.deepEqual(haftalik.alt.map((x) => [x.ad, x.tutar]), [['Yemek', 140000 * 3 - 30000 + 20000], ['Gezme', 140000 * 3 + 20000]]);
  assert.equal(-haftalik.tutar, haftalik.alt.reduce((a, x) => a + x.tutar, 0));
  assert.ok(!t.kalemler.some((k) => k.ad === 'Kalan aylık bütçeler')); // tek aylık kategori aşıldı
});

test('ay sınırındaki hafta gün payıyla: son günler sonraki ayın haftasında, ay başı önceki ayın haftasında', async () => {
  const o = await kur('2026-10-19');
  const haftalik = async () => -((H.aySonuTahmini(await o.iste('/veri'), o.g.gun).kalemler.find((k) => k.ad === 'Kalan haftalık bütçeler') || { tutar: 0 }).tutar);
  o.g.gun = '2026-12-07'; // Kasım ayının son 3 günü (7–9 Ara) Aralık haftasında
  assert.equal(await haftalik(), Math.round(280000 * 3 / 7));
  o.g.gun = '2027-01-05'; // Aralık'ın son haftası 4–10 Oca; ay 9 Oca'da biter → bugünden 5 gün (5–9 Oca), 6 kalan günden
  assert.equal(await haftalik(), 2 * Math.round(140000 * 5 / 6));
  // Ocak başı: 4 Oca haftası (Aralık'a ait) bugün biter, kalan parası sayılır; 4 tam hafta; 8 Şub haftasının 2/7'si.
  o.g.gun = '2027-01-10';
  assert.equal(await haftalik(), 280000 + 4 * 280000 + 2 * Math.round(140000 * 2 / 7));
});
