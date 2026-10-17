// Havuzsuz para düzeni (2026-10-17 kararları): geçmiş başlangıç, ailem ödüyor, artan bütçe, maaş dağıtımı, yatırım özeti.
// Telefon modülü bellekteki depoyla çalışır; gün sabitlenip ileri alınır. Bütün veriler uydurmadır.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as H from '../public/hesap.js';
import { bellekDeposu } from '../public/depo.js';
import { yerelApi, ApiHata } from '../public/yerel-api.js';

let gun = '2026-10-17';
const api = yerelApi(bellekDeposu(), { bugun: () => gun });
async function iste(yol, { yontem = 'GET', govde } = {}) {
  try { return { durum: 200, j: await api.istek(yol, { yontem, govde }) }; } catch (e) {
    if (!(e instanceof ApiHata)) throw e;
    return { durum: e.durum, j: { hata: e.message } };
  }
}
const veri = async () => (await iste('/veri')).j;
const gider = (id, tutar, ek = {}) => ({ id, tarih: gun, tur: 'gider', tutar, kaynak_id: 'h-kart', kategori_id: 'benzin', ...ek });

const KURULUM = {
  baslangic: '2026-10-13',
  ayar: { ay_baslangic_gunu: 10, maas: { tutar: 5000000, hesap_id: 'h-vds' }, yatirim_tutari: 2000000, harcama_hesabi: 'h-vds', yatirim_hesabi: 'h-yat' },
  hesaplar: [
    { id: 'h-vds', ad: 'Deneme vadesiz', tur: 'vadesiz', acilis_bakiye: 1000000 },
    { id: 'h-yat', ad: 'Deneme yatırım', tur: 'yatirim', acilis_bakiye: 500000 },
    { id: 'h-kart', ad: 'Deneme kart', tur: 'kart', acilis_bakiye: 0, limit_tutar: 5000000, kesim_gunu: 12, son_odeme_gunu: 22, odeme_hesap_id: 'h-vds' },
  ],
  kategoriler: [
    { id: 'benzin', ad: 'Benzin', tur: 'haftalik', limit_tutar: 100000, sira: 1 },
    { id: 'yemek', ad: 'Yemek', tur: 'haftalik', limit_tutar: 50000, sira: 2 },
  ],
  sabitler: [
    { id: 'taksit-aile', ad: 'Deneme taksit', tutar: 30000, gun: 3, periyot: 1, ilk_ay: '2026-11', son_vade: '2027-01-03', hesap_id: 'h-kart', otomatik: 1, aile: 1 },
    { id: 'spor', ad: 'Spor', tutar: 100000, gun: 29, periyot: 1, ilk_ay: '2026-10', hesap_id: 'h-kart', otomatik: 1 },
  ],
};

test('başlangıç tarihi geçmişte olabilir (en çok 60 gün)', async () => {
  const api2 = yerelApi(bellekDeposu(), { bugun: () => gun });
  await assert.rejects(api2.istek('/kurulum', { yontem: 'POST', govde: { ...KURULUM, baslangic: '2026-08-01' } }), /60 gün/);
  await assert.rejects(api2.istek('/kurulum', { yontem: 'POST', govde: { ...KURULUM, baslangic: '2026-10-18' } }), /60 gün/);
  assert.equal((await iste('/kurulum', { yontem: 'POST', govde: KURULUM })).durum, 200);
  const v = await veri();
  assert.equal(v.ayar.kurulum_tarihi, '2026-10-13');
  assert.equal(v.hesaplar.find((h) => h.id === 'h-vds').acilis_tarihi, '2026-10-13');
  assert.equal(v.ayar.son_bakim, '2026-10-17'); // bakım bugüne kadar işledi
  assert.equal(v.ayar.yatirim_tutari, 2000000);
  assert.equal(v.odemeler.some((o) => o.sebep === 'cekis'), false); // havuz yok → çekiş yok
});

test('geçmiş tarihli harcama (başlangıçtan sonra) haftaya sayılır', async () => {
  assert.equal((await iste('/islem', { yontem: 'POST', govde: gider('gecmis-benzin', 40000, { tarih: '2026-10-14' }) })).durum, 200);
  const v = await veri();
  assert.equal(H.haftaDurumu(v, '2026-10-12', gun).satirlar.find((s) => s.kategori_id === 'benzin').harcanan, 40000);
});

test('ailem ödüyor: bütçeye girmez, kart borcunda görünür, alacak olur; aile ödeyince kapanır', async () => {
  const once = await veri();
  const hafta = H.haftaDurumu(once, '2026-10-12', gun).harcanan;
  const ayGercek = H.ayPlani(once, '2026-10').gercek;
  assert.equal((await iste('/islem', { yontem: 'POST', govde: gider('aile-alisveris', 200000, { aile: 1 }) })).durum, 200);
  let v = await veri();
  assert.equal(H.haftaDurumu(v, '2026-10-12', gun).harcanan, hafta);
  assert.equal(H.ayPlani(v, '2026-10').gercek, ayGercek);
  assert.equal(H.bakiyeler(v).get('h-kart'), H.bakiyeler(once).get('h-kart') - 200000);
  assert.equal(H.aileAlacagi(v), 200000);
  await iste('/islem', { yontem: 'POST', govde: { id: 'aileden-gelen', tarih: gun, tur: 'gelir', tutar: 200000, hedef_id: 'h-vds', gelir_kaynagi: 'Aile', aile: 1 } });
  v = await veri();
  assert.equal(H.aileAlacagi(v), 0);
  assert.equal(H.bakiyeler(v).get('h-vds'), H.bakiyeler(once).get('h-vds') + 200000);
  assert.equal(v.odemeler.some((o) => o.ref_id === 'aileden-gelen'), false); // aile parası dağıtılmaz
});

test('ailenin sabit ödemesi: planda yok, vadesinde kendiliğinden alacak olur', async () => {
  const v = await veri();
  assert.equal(H.ayPlanKalemleri(v, '2026-10').some((k) => k.kalem.startsWith('sabit:taksit-aile')), false);
  assert.ok(H.ayPlanKalemleri(v, '2026-10').some((k) => k.kalem.startsWith('sabit:spor')));
  assert.equal(H.aylikIhtiyac(v), 100000 + Math.round(150000 * 52 / 12));
});

test('artan bütçe: hafta kapanınca fark toplanır, harcanabilir, ay planında haftalık kovaya yazılır', async () => {
  gun = '2026-10-19';
  let v = await veri();
  // Kurulum haftası 13–18 Eki: 6/7 gün → limit 128.571, benzin 40.000 harcandı → +88.571
  const h = v.haftalar.find((x) => x.pazartesi === '2026-10-12');
  assert.equal(h.fark, Math.round(100000 * 6 / 7) + Math.round(50000 * 6 / 7) - 40000);
  assert.equal(H.artanButce(v), h.fark);
  assert.equal(v.kismalar['2026-10-19'], undefined); // artıdayken kısma yok
  await iste('/islem', { yontem: 'POST', govde: gider('artan-harcama', 30000, { kategori_id: H.ARTAN_KATEGORI }) });
  v = await veri();
  assert.equal(H.artanButce(v), h.fark - 30000);
  assert.equal(H.haftaDurumu(v, '2026-10-19', gun).harcanan, 0); // haftanın limitinden düşmez
  assert.equal(H.ayPlani(v, '2026-10').kovalar.find((k) => k.id === 'haftalik').gercek, 40000 + 30000);
});

test('artan bütçe eksiye düşerse sonraki haftanın limitleri kısılır; ödenince artan bütçe sıfırlanır', async () => {
  await iste('/islem', { yontem: 'POST', govde: gider('asim-1', 300000) }); // 19–25 Eki: limit 150.000, harcanan 300.000
  gun = '2026-10-26';
  let v = await veri();
  const once = H.artanButce(v);
  assert.ok(once < 0);
  const k = v.kismalar['2026-10-26'];
  assert.equal(k.benzin + k.yemek, -once);
  // 26 Eki haftası kısılmış limit kadar harcanırsa artan bütçe 0'a döner.
  const l = H.haftaLimitleri(v, '2026-10-26');
  await iste('/islem', { yontem: 'POST', govde: gider('tam-limit', l.benzin) });
  await iste('/islem', { yontem: 'POST', govde: gider('tam-limit-2', l.yemek, { kategori_id: 'yemek' }) });
  gun = '2026-11-02';
  v = await veri();
  assert.equal(H.artanButce(v), 0);
});

test('kısılan hafta sürerken maaş gelirse açık yatırımdan ikinci kez düşülmez', () => {
  const v = {
    ayar: { kurulum_tarihi: '2026-10-05', ay_baslangic_gunu: 10, yatirim_tutari: 1000000 },
    hesaplar: [], kategoriler: [{ id: 'benzin', ad: 'B', tur: 'haftalik', limit_tutar: 100000 }], sabitler: [], islemler: [], odemeler: [], ayPlanlari: [],
    haftalar: [{ pazartesi: '2026-10-05', fark: -30000 }],
    kismalar: { '2026-10-12': { benzin: 30000 } },
  };
  assert.equal(H.artanButce(v), -30000);
  const d = H.gelirDagitimi(v, 5000000, { maas: true, tarih: '2026-10-13', gun: '2026-10-13' });
  assert.equal(d.artan, 0);
  assert.equal(d.yatirim, 1000000);
  // Hafta kapandıktan sonra (kısma ödendi) gelen maaşta artık sayılmaz.
  const kapandi = { ...v, haftalar: [...v.haftalar, { pazartesi: '2026-10-12', fark: 0 }] };
  assert.equal(H.gelirDagitimi(kapandi, 5000000, { maas: true, tarih: '2026-10-20', gun: '2026-10-20' }).artan, 0);
});

test('maaş dağıtımı: giderler kalır, yatırım = tutar + artan bütçe, kalanı serbest; artan bütçe aktarılır', async () => {
  gun = '2026-11-09'; // 2 Kas haftası kapanır (harcama yok → +150.000)
  let v = await veri();
  const artan = H.artanButce(v);
  assert.equal(artan, 150000);
  gun = '2026-11-10';
  v = await veri();
  const d = H.gelirDagitimi(v, 5000000, { maas: true, tarih: gun });
  assert.equal(d.ay, '2026-11');
  assert.equal(d.giderler, H.ayPlani(v, '2026-11').plan);
  assert.equal(d.artan, 150000);
  assert.equal(d.yatirim, 2000000 + 150000);
  assert.equal(d.giderler + d.yatirim + d.serbest, 5000000 + d.artan);
  // Yatırım ekranda değiştirilir (20.000 yerine 1.000 ₺ eksik gibi).
  const yatirim = d.yatirim - 100000;
  const govde = { islem: { id: 'maas-kasim', tarih: gun, tutar: 5000000, hedef_id: 'h-vds', gelir_kaynagi: 'Maaş' }, paylar: { giderler: d.giderler, yatirim, serbest: d.serbest + 100000 }, artan_aktarim: d.artan };
  assert.equal((await iste('/gelir', { yontem: 'POST', govde: { ...govde, artan_aktarim: 0 } })).durum, 400); // toplam tutmaz
  assert.equal((await iste('/gelir', { yontem: 'POST', govde })).durum, 200);
  v = await veri();
  assert.equal(H.artanButce(v), 0);
  const havale = v.odemeler.find((o) => o.id === 'gelir:maas-kasim:yatirim');
  assert.equal(havale.tutar, yatirim);
  assert.equal(havale.hedef_id, 'h-yat');
  assert.equal(v.odemeler.some((o) => o.ref_id === 'maas-kasim' && o.id !== havale.id), false); // serbest/giderler hesapta kalır
  // Ek gelir: gider ayrılmaz, yatırım varsayılan 0.
  const ek = H.gelirDagitimi(v, 100000, { maas: false, tarih: gun });
  assert.deepEqual([ek.giderler, ek.artan, ek.yatirim, ek.serbest], [0, 0, 0, 100000]);
});

test('maaş silinirse artan bütçe aktarımı da geri alınır', async () => {
  await iste('/islem/maas-kasim', { yontem: 'DELETE' });
  assert.equal(H.artanButce(await veri()), 150000);
  // yeniden gir (sonraki denemeler için)
  const v = await veri();
  const d = H.gelirDagitimi(v, 5000000, { maas: true, tarih: gun });
  await iste('/gelir', { yontem: 'POST', govde: { islem: { id: 'maas-kasim-2', tarih: gun, tutar: 5000000, hedef_id: 'h-vds', gelir_kaynagi: 'Maaş' }, paylar: { giderler: d.giderler, yatirim: d.yatirim, serbest: d.serbest }, artan_aktarim: d.artan } });
});

test('yatırım özeti ve net varlık', async () => {
  let v = await veri();
  const havale = v.odemeler.find((o) => o.id === 'gelir:maas-kasim-2:yatirim');
  await iste(`/odeme/${encodeURIComponent(havale.id)}/yap`, { yontem: 'POST', govde: { tutar: havale.tutar, tarih: gun, islem_id: 'yatirim-kasim' } });
  await iste('/hesap/h-yat/esitle', { yontem: 'POST', govde: { bakiye: 500000 + havale.tutar + 120000, islem_id: 'deger-guncelleme' } }); // değer arttı
  v = await veri();
  const y = H.yatirimOzeti(v, gun);
  assert.equal(y.yatirilan, 500000 + havale.tutar);
  assert.equal(y.kazanc, 120000);
  assert.equal(y.buAy, havale.tutar);
  assert.equal(y.seri, 1);
  assert.equal(y.aylar.at(-1).ay, '2026-11');
  const b = H.bakiyeler(v);
  assert.equal(H.netVarlik(v), b.get('h-vds') + b.get('h-yat') + b.get('h-kart') + H.aileAlacagi(v));
  const seri = H.netVarlikSerisi(v, gun);
  assert.deepEqual(seri.map((x) => x.ay), ['2026-10', '2026-11']); // kurulumdan öncesi yok
  assert.equal(seri.at(-1).tutar, H.netVarlik(v));
});

test('ayarlar: aylık yatırım tutarı değiştirilir, eksi olamaz', async () => {
  assert.equal((await iste('/ayar', { yontem: 'PUT', govde: { yatirim_tutari: -1 } })).durum, 400);
  assert.equal((await iste('/ayar', { yontem: 'PUT', govde: { yatirim_tutari: 2500000 } })).durum, 200);
  assert.equal((await veri()).ayar.yatirim_tutari, 2500000);
});

test('Excel sayfaları: bütün kayıtlar, ailem ödüyor ve artan bütçe görünür', async () => {
  const { excelSayfalari } = await import('../public/excel.js');
  const v = await veri();
  const s = excelSayfalari(v, gun);
  assert.deepEqual(s.map((x) => x.ad), ['Hareketler', 'Haftalar', 'Aylar', 'Kategori × Ay', 'Gelir ve yatırım', 'Sabit ödemeler', 'Hesaplar', 'Yatırım']);
  for (const x of s) for (const r of x.satirlar) assert.ok(r.length <= x.sutunlar.length, `${x.ad}: fazla sütun`);
  const har = s[0];
  assert.equal(har.satirlar.length, v.islemler.length);
  const aile = har.satirlar.find((r) => r[11] === 'evet' && r[2] === 'Harcama');
  assert.equal(aile[8], null); // bütçeye düşmez
  assert.ok(har.satirlar.some((r) => r[3] === H.ARTAN_AD && r[4] === H.ARTAN_AD));
  const net = s[6].satirlar.find((r) => r[0] === 'Net varlık');
  assert.equal(net[3], H.netVarlik(v) / 100);
  const maas = s[4].satirlar.find((r) => r[1] === 'Maaş');
  assert.equal(maas[3] + (maas[4] || 0) - (maas[5] || 0), maas[6]);
});

test('geçmiş başlangıç: başlangıçla bugün arasındaki sabit vade oluşur, son vadeli kalem biter', async () => {
  const g = { gun: '2026-10-18' };
  const api2 = yerelApi(bellekDeposu(), { bugun: () => g.gun });
  await api2.istek('/kurulum', { yontem: 'POST', govde: {
    baslangic: '2026-10-13',
    ayar: { ay_baslangic_gunu: 10, maas: { tutar: 5000000, hesap_id: 'v-1111' }, harcama_hesabi: 'v-1111' },
    hesaplar: [{ id: 'v-1111', ad: 'Deneme vadesiz', tur: 'vadesiz', acilis_bakiye: 1000000 }],
    kategoriler: [{ id: 'k-1111', ad: 'Benzin', tur: 'haftalik', limit_tutar: 100000 }],
    sabitler: [
      { id: 's-park', ad: 'Deneme park', tutar: 100000, gun: 16, periyot: 1, ilk_ay: H.sabitIlkAy(16, '2026-10-13'), hesap_id: 'v-1111' },
      { id: 's-tek', ad: 'Deneme tek taksit', tutar: 200000, gun: 10, periyot: 1, ilk_ay: H.sabitIlkAy(10, '2026-10-13'), son_vade: '2026-11-10', hesap_id: 'v-1111' },
    ],
  } });
  let v = await api2.istek('/veri');
  assert.ok(v.odemeler.some((o) => o.id === 'sabit:s-park:2026-10-16' && o.durum === 'bekliyor'));
  g.gun = '2027-01-20';
  v = await api2.istek('/veri');
  assert.deepEqual(v.odemeler.filter((o) => o.ref_id === 's-tek').map((o) => o.vade), ['2026-11-10']);
});
