// Telefon modülünün (yerel-api.js) uçtan uca denemesi: eski sunucu denemelerinin (api-yerel + hafta-kapanis) yerine.
// Veri bellekteki depoda durur; gün `bugun` seçeneğiyle sabitlenir ve ileri alınır. Bütün veriler uydurmadır.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as H from '../public/hesap.js';
import { bellekDeposu } from '../public/depo.js';
import { yerelApi, ApiHata } from '../public/yerel-api.js';

let gun = '2026-10-12';
const depo = bellekDeposu();
const api = yerelApi(depo, { bugun: () => gun });

async function iste(yol, { yontem = 'GET', govde } = {}) {
  try {
    return { durum: 200, j: await api.istek(yol, { yontem, govde }) };
  } catch (e) {
    if (!(e instanceof ApiHata)) throw e;
    return { durum: e.durum, j: { hata: e.message } };
  }
}
const veri = async () => (await iste('/veri')).j;

test('başta belge boş, kurulum yok', async () => {
  const r = await iste('/durum');
  assert.equal(r.durum, 200);
  assert.equal(r.j.kurulum, false);
  assert.equal(await depo.oku(), null); // okuma hiçbir şey yazmaz
});

test('kurulum sihirbazı kaydedilir, ikinci kez yapılamaz', async () => {
  const r = await iste('/kurulum', {
    yontem: 'POST',
    govde: {
      ayar: {
        ay_baslangic_gunu: 10, maas: { tutar: 6000000, hesap_id: 'vds-1' }, gelir_kaynaklari: ['Maaş', 'Ek gelir'], beklenmeyen: 100000, havuz_ay: 3,
        sela: { birikim: 50, yatirim: 30, serbest: 20 }, harcama_hesabi: 'vds-1', havuz_hesabi: 'havuz-1', birikim_hesabi: 'birikim-1', yatirim_hesabi: 'yatirim-1',
      },
      hesaplar: [
        { id: 'vds-1', ad: 'Vadesiz', tur: 'vadesiz', acilis_bakiye: 2000000, banka: 'garanti' },
        { id: 'havuz-1', ad: 'Havuz', tur: 'havuz', acilis_bakiye: 9000000 },
        { id: 'birikim-1', ad: 'Birikim', tur: 'birikim', acilis_bakiye: 0 },
        { id: 'yatirim-1', ad: 'Yatırım', tur: 'yatirim', acilis_bakiye: 0 },
        { id: 'kart-1', ad: 'Kart', tur: 'kart', acilis_bakiye: -50000, limit_tutar: 3000000, kesim_gunu: 15, son_odeme_gunu: 25, odeme_hesap_id: 'vds-1', banka: 'yapikredi' },
      ],
      kategoriler: [
        { id: 'kat-market', ad: 'Market', simge: '🛒', tur: 'haftalik', limit_tutar: 150000 },
        { id: 'kat-yemek', ad: 'Yemek', simge: '🍽️', tur: 'haftalik', limit_tutar: 60000 },
        { id: 'kat-kiyafet', ad: 'Kıyafet', simge: '👕', tur: 'aylik', limit_tutar: 200000 },
        { id: 'kat-is', ad: 'İş', simge: '💼', tur: 'aylik', limit_tutar: 100000, is_gideri: 1 },
      ],
      sabitler: [
        { id: 'sab-kira', ad: 'Kira', tutar: 2500000, gun: 5, periyot: 1, ilk_ay: '2026-10', hesap_id: 'vds-1' },
        { id: 'sab-muzik', ad: 'Müzik', tutar: 9900, gun: 14, periyot: 1, ilk_ay: '2026-10', hesap_id: 'kart-1', otomatik: 1 },
      ],
      hedefler: [{ id: 'hedef-acil', ad: 'Acil durum', hedef_tutar: 0, hesap_id: 'birikim-1', hafta_farki: 1 }],
    },
  });
  assert.equal(r.durum, 200, JSON.stringify(r.j));
  assert.equal((await iste('/kurulum', { yontem: 'POST', govde: { hesaplar: [] } })).durum, 409);
  assert.equal((await iste('/durum')).j.kurulum, true);
});

test('hatalı kurulum yarım kayıt bırakmaz', async () => {
  const api2 = yerelApi(bellekDeposu(), { bugun: () => gun });
  await assert.rejects(api2.istek('/kurulum', { yontem: 'POST', govde: { hesaplar: [{ id: 'vds-1', ad: 'V', tur: 'vadesiz' }], kategoriler: [{ id: 'kat-1', ad: 'K', tur: 'yanlis' }], ayar: { harcama_hesabi: 'vds-1' } } }), /Kategori türü/);
  const b = await api2.belge();
  assert.equal(b.hesap.length, 0);
  assert.equal(b.ayar.kurulum_tarihi, undefined);
});

test('bakım: aylık çekiş, 14 günlük sabit ödemeler', async () => {
  const v = await veri();
  assert.equal(v.ayar.kurulum_tarihi, gun);
  const cekis = v.odemeler.find((o) => o.id === 'cekis:2026-10');
  assert.ok(cekis, 'çekiş yok');
  assert.equal(cekis.kaynak_id, 'havuz-1');
  assert.equal(cekis.hedef_id, 'vds-1');
  const sabit = v.odemeler.filter((o) => o.tur === 'sabit').map((o) => o.id).sort();
  assert.deepEqual(sabit, ['sabit:sab-muzik:2026-10-14']); // kira 5 Kas: 14 günden uzak
  assert.ok(v.ayPlanlari.some((p) => p.ay === '2026-10'));
});

const harcama = { id: 'deneme-gider-1', tarih: '2026-10-12', tur: 'gider', tutar: 50000, kaynak_id: 'vds-1', kategori_id: 'kat-market', taksit: 1 };

test('harcama kaydı; aynı kimlikle ikinci kayıt çift yazmaz; telefona kalıcı yazılır', async () => {
  assert.equal((await iste('/islem', { yontem: 'POST', govde: harcama })).durum, 200);
  assert.equal((await iste('/islem', { yontem: 'POST', govde: harcama })).durum, 200);
  const v = await veri();
  assert.equal(v.islemler.filter((i) => i.id === harcama.id).length, 1);
  assert.equal(H.haftaDurumu(v, '2026-10-12', gun).harcanan, 50000);
  // Uygulama yeniden açılınca (yeni modül, aynı depo) kayıt yerinde.
  const yeniden = yerelApi(depo, { bugun: () => gun });
  assert.ok((await yeniden.istek('/veri')).islemler.some((i) => i.id === harcama.id));
});

test('dönen veri belgeye bağlı değil (ekranda değiştirmek kaydı bozmaz)', async () => {
  const v = await veri();
  v.islemler.find((i) => i.id === harcama.id).tutar = 1;
  v.islemler.length = 0;
  assert.equal((await veri()).islemler.find((i) => i.id === harcama.id).tutar, 50000);
});

test('kart numarası not alanında reddedilir, belge değişmez', async () => {
  const once = await api.belge();
  const r = await iste('/islem', { yontem: 'POST', govde: { ...harcama, id: 'deneme-gider-2', notu: '4111 1111 1111 1111' } });
  assert.equal(r.durum, 400);
  assert.match(r.j.hata, /Kart numarası/);
  assert.deepEqual(await api.belge(), once);
});

test('kartla taksitli harcama: bugün ilk pay, kart borcu tamamı', async () => {
  const i = { id: 'deneme-taksit-1', tarih: gun, tur: 'gider', tutar: 300000, kaynak_id: 'kart-1', kategori_id: 'kat-kiyafet', taksit: 3 };
  assert.equal((await iste('/islem', { yontem: 'POST', govde: i })).durum, 200);
  const v = await veri();
  assert.equal(H.bakiyeler(v).get('kart-1'), -50000 - 300000);
  assert.equal(H.ayPlani(v, '2026-10').kovalar.find((k) => k.id === 'aylik').gercek, 100000);
});

test('gelir + şelale: paylar yapılacak havale olur', async () => {
  let v = await veri();
  const tutar = 1000000;
  const paylar = H.selaHesapla(v, tutar);
  const r = await iste('/gelir', { yontem: 'POST', govde: { islem: { id: 'deneme-gelir-1', tarih: gun, tutar, hedef_id: 'vds-1', gelir_kaynagi: 'Ek gelir' }, paylar, hedef_ref: 'hedef-acil' } });
  assert.equal(r.durum, 200, JSON.stringify(r.j));
  v = await veri();
  const havaleler = v.odemeler.filter((o) => o.ref_id === 'deneme-gelir-1');
  assert.equal(havaleler.reduce((t, o) => t + o.tutar, 0), tutar - paylar.serbest); // serbest pay zaten harcama hesabında
  const hatali = await iste('/gelir', { yontem: 'POST', govde: { islem: { id: 'deneme-gelir-2', tarih: gun, tutar, hedef_id: 'vds-1' }, paylar: { havuz: 1 } } });
  assert.equal(hatali.durum, 400);
});

test('havale "Yaptım": transfer kaydı, bakiyeler değişir; geri alınabilir', async () => {
  let v = await veri();
  const once = H.bakiyeler(v);
  const cekis = v.odemeler.find((o) => o.id === 'cekis:2026-10');
  assert.equal((await iste(`/odeme/${encodeURIComponent(cekis.id)}/yap`, { yontem: 'POST', govde: { tutar: cekis.tutar, tarih: gun, islem_id: 'deneme-odm-1' } })).durum, 200);
  v = await veri();
  const sonra = H.bakiyeler(v);
  assert.equal(sonra.get('havuz-1'), once.get('havuz-1') - cekis.tutar);
  assert.equal(sonra.get('vds-1'), once.get('vds-1') + cekis.tutar);
  assert.equal((await iste(`/odeme/${encodeURIComponent(cekis.id)}/geri`, { yontem: 'POST', govde: {} })).durum, 200);
  v = await veri();
  assert.equal(v.odemeler.find((o) => o.id === cekis.id).durum, 'bekliyor');
  assert.equal(H.bakiyeler(v).get('havuz-1'), once.get('havuz-1'));
  assert.equal((await iste(`/odeme/${encodeURIComponent(cekis.id)}/yap`, { yontem: 'POST', govde: { tutar: cekis.tutar, tarih: gun, islem_id: 'deneme-odm-2' } })).durum, 200);
});

test('bakiye kontrolü: fark düzeltme kaydı olur', async () => {
  let v = await veri();
  const simdi = H.bakiyeler(v).get('vds-1');
  const r = await iste('/hesap/vds-1/esitle', { yontem: 'POST', govde: { bakiye: simdi - 1234, islem_id: 'deneme-esitle-1' } });
  assert.equal(r.j.fark, -1234);
  v = await veri();
  assert.equal(H.bakiyeler(v).get('vds-1'), simdi - 1234);
});

test('silinen harcama hesaplardan düşer', async () => {
  assert.equal((await iste(`/islem/${harcama.id}`, { yontem: 'DELETE' })).durum, 200);
  assert.equal((await veri()).islemler.some((i) => i.id === harcama.id), false);
});

test('ayarlar: şelale toplamı 100 değilse reddedilir; ay başlangıcı değiştirilemez', async () => {
  assert.equal((await iste('/ayar', { yontem: 'PUT', govde: { sela: { birikim: 50, yatirim: 50, serbest: 10 } } })).durum, 400);
  assert.equal((await iste('/ayar', { yontem: 'PUT', govde: { ay_baslangic_gunu: 1 } })).durum, 409);
  assert.equal((await iste('/ayar', { yontem: 'PUT', govde: { beklenmeyen: 150000 } })).durum, 200);
  assert.equal((await veri()).ayar.beklenmeyen, 150000);
});

test('aynı anda iki dokunuş: ikisi de kaydedilir', async () => {
  const a = { ...harcama, id: 'esanli-1', tutar: 100 };
  const b = { ...harcama, id: 'esanli-2', tutar: 200 };
  await Promise.all([api.istek('/islem', { yontem: 'POST', govde: a }), api.istek('/islem', { yontem: 'POST', govde: b })]);
  const v = await veri();
  assert.ok(v.islemler.some((i) => i.id === 'esanli-1') && v.islemler.some((i) => i.id === 'esanli-2'));
  await api.istek('/islem/esanli-1', { yontem: 'DELETE' });
  await api.istek('/islem/esanli-2', { yontem: 'DELETE' });
});

// ---------------------------------------------------------------- günler ilerler (eski hafta-kapanis denemesi)

test('salı: haftalık limiti aşan market harcaması', async () => {
  gun = '2026-10-13';
  assert.equal((await iste('/islem', { yontem: 'POST', govde: { id: 'hk-market-1', tarih: gun, tur: 'gider', tutar: 250000, kaynak_id: 'vds-1', kategori_id: 'kat-market' } })).durum, 200);
  const v = await veri();
  assert.equal(H.haftaDurumu(v, '2026-10-12', gun).kalan, 210000 - 250000);
  assert.ok(H.dikkatListesi(v, gun).some((d) => d.tur === 'asim'));
});

test('15 Eki: otomatik abonelik işlendi, kart kesildi; ödeme tahmini ertesi gün oluşur', async () => {
  gun = '2026-10-15';
  let v = await veri();
  const muzik = v.odemeler.find((o) => o.id === 'sabit:sab-muzik:2026-10-14');
  assert.equal(muzik.durum, 'yapildi');
  assert.ok(v.islemler.some((i) => i.id === muzik.islem_id && i.kaynak_id === 'kart-1'));
  assert.equal(v.odemeler.some((o) => o.id === 'kart:kart-1:2026-10-25'), false); // kesim günü: henüz yok
  // Kesim günü girilen harcama da ekstreye girer.
  await iste('/islem', { yontem: 'POST', govde: { id: 'kesim-gunu-1', tarih: gun, tur: 'gider', tutar: 5000, kaynak_id: 'kart-1', kategori_id: 'kat-kiyafet' } });
  gun = '2026-10-16';
  v = await veri();
  const kart = v.odemeler.find((o) => o.id === 'kart:kart-1:2026-10-25');
  assert.ok(kart, 'kart ödemesi yok');
  // taksidin ilk payı + abonelik + kesim günü harcaması + açılıştaki kart borcu
  assert.equal(kart.tutar, 100000 + 9900 + 5000 + 50000);
  assert.equal(kart.kaynak_id, 'vds-1');
  // Döneme sonradan girilen harcama bekleyen ödemenin tutarını günceller; silinince geri iner.
  await iste('/islem', { yontem: 'POST', govde: { id: 'kesim-gec-1', tarih: '2026-10-10', tur: 'gider', tutar: 2000, kaynak_id: 'kart-1', kategori_id: 'kat-kiyafet' } });
  assert.equal((await veri()).odemeler.find((o) => o.id === kart.id).tutar, kart.tutar + 2000);
  await iste('/islem/kesim-gec-1', { yontem: 'DELETE' });
  await iste('/islem/kesim-gunu-1', { yontem: 'DELETE' });
  assert.equal((await veri()).odemeler.find((o) => o.id === kart.id).tutar, 100000 + 9900 + 50000);
});

test('19 Eki pazartesi: geçen hafta kapandı, aşım artan bütçeye; bu haftanın limitleri kısıldı', async () => {
  gun = '2026-10-19';
  const v = await veri();
  const h = v.haftalar.find((x) => x.pazartesi === '2026-10-12');
  assert.ok(h, 'hafta kapanmadı');
  assert.equal(h.fark, -40000);
  assert.equal(h.ay, '2026-10');
  assert.equal(v.odemeler.some((o) => o.id === 'hafta:2026-10-12'), false); // havale yok
  assert.equal(H.artanButce(v), -40000);
  const k = v.kismalar['2026-10-19'];
  assert.equal(k['kat-market'] + k['kat-yemek'], 40000);
  const l = H.haftaLimitleri(v, '2026-10-19');
  assert.equal(l['kat-market'] + l['kat-yemek'], 210000 - 40000);
  // Kullanıcı dağılımı değiştirir: hepsi yemekten olamaz (yemek limiti 60.000 ama 40.000 sığar), toplam aynı kalmalı.
  assert.equal((await iste('/kisma/2026-10-19', { yontem: 'PUT', govde: { dagilim: { 'kat-yemek': 30000 } } })).durum, 400);
  assert.equal((await iste('/kisma/2026-10-19', { yontem: 'PUT', govde: { dagilim: { 'kat-yemek': 40000 } } })).durum, 200);
  assert.equal(H.haftaLimitleri(await veri(), '2026-10-19')['kat-yemek'], 20000);
  assert.equal((await iste('/kisma/2026-10-26', { yontem: 'PUT', govde: { dagilim: {} } })).durum, 404);
  // Kapanan haftaya sonradan girilen harcama: limitler donmuş kalır, fark ve bu haftanın kısması güncellenir.
  await iste('/islem', { yontem: 'POST', govde: { id: 'hk-gec-1', tarih: '2026-10-14', tur: 'gider', tutar: 1000, kaynak_id: 'vds-1', kategori_id: 'kat-yemek' } });
  let v2 = await veri();
  assert.equal(H.haftaDurumu(v2, '2026-10-12', gun).fark, -41000);
  assert.equal(JSON.parse(v2.haftalar.find((x) => x.pazartesi === '2026-10-12').limitler)['kat-market'], 150000);
  assert.equal(H.artanButce(v2), -41000);
  assert.equal(Object.values(v2.kismalar['2026-10-19']).reduce((t, x) => t + x, 0), 41000);
  // Silinince eski hâline döner (kullanıcının dağılımı toplam değiştiği için yeniden hesaplanmıştı).
  await iste('/islem/hk-gec-1', { yontem: 'DELETE' });
  v2 = await veri();
  assert.equal(H.haftaDurumu(v2, '2026-10-12', gun).fark, -40000);
  assert.equal(Object.values(v2.kismalar['2026-10-19']).reduce((t, x) => t + x, 0), 40000);
});

test('Ekim planı: içindeyken limit değişince bu ayın planı yeniden hesaplanır', async () => {
  const once = H.ayPlani(await veri(), '2026-10').plan;
  assert.equal((await iste('/kategori/kat-market', { yontem: 'PUT', govde: { ad: 'Market', simge: '🛒', tur: 'haftalik', limit_tutar: 175000 } })).durum, 200);
  const v = await veri();
  assert.notEqual(H.ayPlani(v, '2026-10').plan, once);
  assert.equal(H.ayPlani(v, '2026-10').donmus, false); // ertesi günkü bakımda yeniden donar
});

test('10 Kas: yeni bütçe ayı, çekiş havalesi; Ekim haftaları kapandı', async () => {
  gun = '2026-11-10';
  const v = await veri();
  const cekis = v.odemeler.find((o) => o.id === 'cekis:2026-11');
  assert.ok(cekis, 'Kasım çekişi yok');
  const plan = v.ayPlanlari.filter((p) => p.ay === '2026-11');
  assert.equal(cekis.tutar, plan.reduce((t, p) => t + p.plan, 0));
  assert.equal(cekis.vade, '2026-11-10');
  assert.ok(plan.some((p) => p.kalem === 'taksit:deneme-taksit-1:2'));
  assert.ok(plan.some((p) => p.kalem === 'sabit:sab-kira:2026-12-05'));
  assert.equal(plan.find((p) => p.kalem === 'kat:kat-market').plan, H.ayHaftalari('2026-11', v.ayar).length * 175000);
  assert.deepEqual(v.haftalar.map((h) => h.pazartesi), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  assert.equal(v.haftalar.find((h) => h.pazartesi === '2026-11-02').ay, '2026-10'); // perşembesi 5 Kas
  assert.ok(v.odemeler.some((o) => o.id === 'sabit:sab-kira:2026-11-05'));
});

test('bakım tekrar çalışınca bir şey çoğalmaz', async () => {
  const once = await veri();
  assert.equal((await iste('/bakim', { yontem: 'POST', govde: {} })).durum, 200);
  const sonra = await veri();
  assert.equal(sonra.odemeler.length, once.odemeler.length);
  assert.equal(sonra.haftalar.length, once.haftalar.length);
  assert.equal(sonra.ayPlanlari.length, once.ayPlanlari.length);
  assert.equal(sonra.islemler.length, once.islemler.length);
});

test('maaş: 8 Kas\'ta yatan maaş Kasım maaşıdır, kart sorusu kalkar', async () => {
  gun = '2026-11-08';
  let v = await veri();
  assert.equal(H.maasDurumu(v, gun).sor, true);
  const paylar = H.selaHesapla(v, 6000000);
  assert.equal((await iste('/gelir', { yontem: 'POST', govde: { islem: { id: 'hk-maas-1', tarih: gun, tutar: 6000000, hedef_id: 'vds-1', gelir_kaynagi: 'Maaş' }, paylar } })).durum, 200);
  gun = '2026-11-12';
  v = await veri();
  const m = H.maasDurumu(v, gun);
  assert.equal(m.ay, '2026-11');
  assert.equal(m.sor, false);
});

test('olmayan yol 404', async () => {
  assert.equal((await iste('/pin/gir', { yontem: 'POST', govde: {} })).durum, 404);
});
