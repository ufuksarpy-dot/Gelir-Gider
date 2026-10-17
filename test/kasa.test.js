// Şifreli kasa (depo.js › sifreliKasa) ve PIN akışı. Bütün veriler uydurmadır.
// Türetme turu denemede düşük tutulur (hız için); telefonda PBKDF2_TUR kullanılır.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bellekDeposu, sifreliKasa, pinGecerli, PBKDF2_TUR } from '../public/depo.js';
import { yerelApi, ApiHata } from '../public/yerel-api.js';
import * as H from '../public/hesap.js';

const TUR = 1000;
const gun = () => '2026-10-17';
const kurulum = {
  ayar: { harcama_hesabi: 'deneme-vds' },
  hesaplar: [{ id: 'deneme-vds', ad: 'Deneme vadesiz', tur: 'vadesiz', acilis_bakiye: 123456 }],
};

test('PIN tam 4 rakam olmalı; telefonda türetme turu yüksek', () => {
  assert.equal(pinGecerli('1234'), true);
  for (const p of ['123', '12345', 'abcd', '12 4', 1234, null]) assert.equal(pinGecerli(p), false, String(p));
  assert.ok(PBKDF2_TUR >= 600000);
});

test('ilk açılış: kasa yok → PIN belirlenir → açık; ikinci kez belirlenemez', async () => {
  const kasa = sifreliKasa(bellekDeposu(), { tur: TUR });
  const api = yerelApi(kasa, { bugun: gun });
  assert.equal(await api.kasaDurumu(), 'yok');
  await assert.rejects(api.pinBelirle('12'), /4 rakam/);
  await api.pinBelirle('4821');
  assert.equal(await api.kasaDurumu(), 'acik');
  assert.equal((await api.istek('/durum')).kurulum, false);
  await assert.rejects(api.pinBelirle('1111'), /zaten/);
});

test('kayıtlar diske şifreli yazılır; düz metin görünmez', async () => {
  const ham = bellekDeposu();
  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await api.pinBelirle('4821');
  await api.istek('/kurulum', { yontem: 'POST', govde: kurulum });
  const zarf = await ham.oku();
  assert.equal(zarf.bicim, 'bank-of-usy-kasa');
  assert.equal(zarf.tur, TUR);
  const bayt = Buffer.from(zarf.veri).toString('latin1');
  assert.ok(!bayt.includes('Deneme vadesiz') && !bayt.includes('123456') && !bayt.includes('4821'));
  assert.ok(!JSON.stringify({ ...zarf, veri: null, iv: null, tuz: null }).includes('Deneme'));
});

test('uygulama yeniden açılınca kilitli; yanlış PIN açmaz, doğru PIN açar', async () => {
  const ham = bellekDeposu();
  const ilk = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await ilk.pinBelirle('4821');
  await ilk.istek('/kurulum', { yontem: 'POST', govde: kurulum });

  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  assert.equal(await api.kasaDurumu(), 'kilitli');
  await assert.rejects(api.istek('/veri'), (e) => e instanceof ApiHata && e.durum === 401);
  await assert.rejects(api.pinGir('0000'), (e) => e.pinHatasi && /PIN yanlış/.test(e.message));
  await assert.rejects(api.pinGir('48'), (e) => e.pinHatasi);
  // Bekleme yok: yanlış denemelerden hemen sonra doğru PIN açar.
  await api.pinGir('4821');
  const v = await api.istek('/veri');
  assert.equal(v.hesaplar[0].ad, 'Deneme vadesiz');
});

test('kilitle: bellekteki kayıtlar bırakılır, PIN yeniden sorulur, yazılanlar kalır', async () => {
  const ham = bellekDeposu();
  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await api.pinBelirle('4821');
  await api.istek('/kurulum', { yontem: 'POST', govde: kurulum });
  await api.istek('/islem', { yontem: 'POST', govde: { id: 'deneme-gider-1', tarih: '2026-10-17', tur: 'gider', tutar: 5000, kaynak_id: 'deneme-vds' } });
  await api.kilitle();
  assert.equal(await api.kasaDurumu(), 'kilitli');
  await assert.rejects(api.istek('/veri'), (e) => e.durum === 401);
  await assert.rejects(api.istek('/islem', { yontem: 'POST', govde: { id: 'deneme-gider-2', tarih: '2026-10-17', tur: 'gider', tutar: 1, kaynak_id: 'deneme-vds' } }), (e) => e.durum === 401);
  await api.pinGir('4821');
  const v = await api.istek('/veri');
  assert.deepEqual(v.islemler.map((i) => i.id), ['deneme-gider-1']);
});

test('her yazmada yeni iv; tuz aynı kalır', async () => {
  const ham = bellekDeposu();
  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await api.pinBelirle('4821');
  const a = await ham.oku();
  await api.istek('/kurulum', { yontem: 'POST', govde: kurulum });
  const b = await ham.oku();
  assert.notDeepEqual(Buffer.from(a.iv), Buffer.from(b.iv));
  assert.deepEqual(Buffer.from(a.tuz), Buffer.from(b.tuz));
});

test('sihirbaz taslağı şifreli belgede durur, kurulumla silinir', async () => {
  const ham = bellekDeposu();
  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await api.pinBelirle('4821');
  assert.equal((await api.istek('/taslak')).taslak, null);
  await api.istek('/taslak', { yontem: 'PUT', govde: { adim: 2, maas: '48000' } });
  assert.deepEqual((await api.istek('/taslak')).taslak, { adim: 2, maas: '48000' });
  assert.ok(!Buffer.from((await ham.oku()).veri).toString('latin1').includes('48000'));
  await api.istek('/kurulum', { yontem: 'POST', govde: kurulum });
  assert.equal((await api.istek('/taslak')).taslak, null);
});

// ---------------------------------------------------------------- yedek

async function doluApi(ham = bellekDeposu()) {
  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await api.pinBelirle('4821');
  await api.istek('/kurulum', { yontem: 'POST', govde: kurulum });
  await api.istek('/islem', { yontem: 'POST', govde: { id: 'deneme-gider-1', tarih: '2026-10-17', tur: 'gider', tutar: 5000, kaynak_id: 'deneme-vds' } });
  return api;
}

test('yedek dosyası şifreli: içinde düz kayıt ve PIN yok', async () => {
  const metin = await (await doluApi()).yedekHazirla();
  const d = JSON.parse(metin);
  assert.equal(d.bicim, 'bank-of-usy-yedek');
  for (const x of ['Deneme vadesiz', '123456', '4821', 'deneme-gider-1']) assert.ok(!metin.includes(x), x);
  assert.ok(!Buffer.from(d.kasa.veri, 'base64').toString('latin1').includes('Deneme vadesiz'));
});

test('yeni telefona geri yükleme: doğru PIN ile bütün kayıtlar gelir', async () => {
  const metin = await (await doluApi()).yedekHazirla();
  const ham = bellekDeposu();
  const yeni = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  assert.equal(await yeni.kasaDurumu(), 'yok');
  await assert.rejects(yeni.geriYukle(metin, '0000'), /PIN yanlış/);
  assert.equal(await yeni.kasaDurumu(), 'yok'); // yanlış PIN hiçbir şey yazmaz
  await yeni.geriYukle(metin, '4821');
  assert.equal(await yeni.kasaDurumu(), 'acik');
  const v = await yeni.istek('/veri');
  assert.deepEqual(v.islemler.map((i) => i.id), ['deneme-gider-1']);
  assert.match(v.ayar.son_yedek, /^\d{4}-\d{2}-\d{2}$/); // yedeğin alındığı gün
  // Uygulama yeniden açılınca aynı PIN'le açılır.
  const tekrar = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await tekrar.pinGir('4821');
  assert.equal((await tekrar.istek('/veri')).hesaplar[0].ad, 'Deneme vadesiz');
});

test('dolu telefona geri yükleme: kayıtlar yedektekilerle değişir; PIN yedeğin PIN\'i olur', async () => {
  const eski = await doluApi();
  const metin = await eski.yedekHazirla();
  const ham = bellekDeposu();
  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await api.pinBelirle('1357');
  await api.istek('/kurulum', { yontem: 'POST', govde: { ...kurulum, hesaplar: [{ ...kurulum.hesaplar[0], ad: 'Başka hesap' }] } });
  await api.geriYukle(metin, '4821');
  assert.equal((await api.istek('/veri')).hesaplar[0].ad, 'Deneme vadesiz');
  const tekrar = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await assert.rejects(tekrar.pinGir('1357'), /PIN yanlış/);
  await tekrar.pinGir('4821');
});

test('bozuk ya da başka dosya reddedilir, kayıtlar değişmez', async () => {
  const api = await doluApi();
  const once = await api.istek('/veri');
  await assert.rejects(api.geriYukle('merhaba', '4821'), /yedeği değil/);
  await assert.rejects(api.geriYukle(JSON.stringify({ bicim: 'baska' }), '4821'), /yedeği değil/);
  const metin = JSON.parse(await api.yedekHazirla());
  metin.kasa.veri = Buffer.from('bozuk veri').toString('base64');
  await assert.rejects(api.geriYukle(JSON.stringify(metin), '4821'), /PIN yanlış/); // çözülemeyen veri
  assert.deepEqual(await api.istek('/veri'), once);
});

test('yedek alındı işareti: son yedek günü yazılır', async () => {
  const api = await doluApi();
  assert.equal((await api.istek('/veri')).ayar.son_yedek, undefined);
  await api.istek('/yedek-alindi', { yontem: 'POST', govde: {} });
  assert.equal((await api.istek('/veri')).ayar.son_yedek, '2026-10-17');
});

// ---------------------------------------------------------------- deneme verisi ve içe aktarma

test('deneme verisi: yalnız kurulumdan önce; silinince belge boşalır, PIN kalır', async () => {
  const ham = bellekDeposu();
  const api = yerelApi(sifreliKasa(ham, { tur: TUR }), { bugun: gun });
  await api.pinBelirle('4821');
  await api.istek('/deneme', { yontem: 'POST', govde: {} });
  const v = await api.istek('/veri');
  assert.equal(v.ayar.deneme, true);
  assert.ok(v.islemler.length > 30);
  assert.ok(v.islemler.every((i) => i.id.startsWith('deneme-') || i.id.startsWith('oto:') || i.id.startsWith('odm:')), 'yalnız deneme kayıtları');
  assert.ok(v.haftalar.length >= 7);
  assert.ok(v.odemeler.some((o) => o.id.startsWith('gelir:deneme-maas-')));
  assert.ok(Object.keys(v.kismalar).length >= 1, 'hafta sonu aşımı kısma doğurur');
  assert.ok(H.yatirimOzeti(v, gun()).kazanc > 0);
  await assert.rejects(api.istek('/deneme', { yontem: 'POST', govde: {} }), (e) => e.durum === 409);
  await api.istek('/deneme', { yontem: 'DELETE' });
  const bos = await api.istek('/veri');
  assert.equal(bos.ayar.kurulum_tarihi, null);
  assert.equal(bos.islemler.length, 0);
  assert.equal(await api.kasaDurumu(), 'acik');
  // Gerçek kurulumdan sonra deneme verisi silinemez.
  await api.istek('/kurulum', { yontem: 'POST', govde: kurulum });
  await assert.rejects(api.istek('/deneme', { yontem: 'DELETE' }), (e) => e.durum === 409);
});

test('içe aktarma: eşleştirme, eksik kategori, çift kayıt yok, geri alınır', async () => {
  const { iceAktarOku, iceAktarIslemleri } = await import('../public/ice-aktar.js');
  const api = await doluApi();
  await api.istek('/kategori/deneme-benzin', { yontem: 'PUT', govde: { ad: 'Benzin', tur: 'haftalik', limit_tutar: 100000 } });
  await api.istek('/hesap/deneme-bonus', { yontem: 'PUT', govde: { ad: 'Deneme Bonus', tur: 'kart', limit_tutar: 1000000 } });
  const dosya = JSON.stringify({ bicim: 'bank-of-usy-ice-aktar', surum: 1, aciklama: 'Deneme listesi', hareketler: [
    { tarih: '2026-10-14', tutar: 42500, aciklama: 'Akaryakıt', kategori: 'benzin', hesap: 'Bonus' },
    { tarih: '2026-10-14', tutar: 42500, aciklama: 'Akaryakıt', kategori: 'Benzin', hesap: 'Bonus' }, // aynı gün ikinci kez: ayrı kayıt
    { tarih: '2026-10-15', tutar: 12000, aciklama: 'Bilinmeyen yer', kategori: 'Yok böyle' },
    { tarih: '2026-10-16', tutar: 30000, aciklama: 'Hediye', kategori: 'Artan bütçe', aile: true },
  ] });
  let v = await api.istek('/veri');
  const s = iceAktarOku(dosya, v);
  assert.equal(s.satirlar[0].kategori_id, 'deneme-benzin');
  assert.equal(s.satirlar[0].hesap_id, 'deneme-bonus'); // "Bonus" → "Deneme Bonus"
  assert.notEqual(s.satirlar[0].id, s.satirlar[1].id);
  assert.equal(s.satirlar[2].kategori_id, null); // ekranda sorulur
  assert.equal(s.satirlar[3].kategori_id, H.ARTAN_KATEGORI);
  const islemler = iceAktarIslemleri(s, 'deneme-vds');
  await assert.rejects(api.istek('/ice-aktar', { yontem: 'POST', govde: { islemler } }), /kategori seçilmedi/);
  assert.equal((await api.istek('/veri')).islemler.length, v.islemler.length); // hiçbiri eklenmedi
  islemler[2].kategori_id = 'deneme-benzin';
  assert.equal((await api.istek('/ice-aktar', { yontem: 'POST', govde: { islemler } })).eklenen, 4);
  v = await api.istek('/veri');
  assert.equal(H.aileAlacagi(v), 30000);
  // Aynı dosya yeniden: hepsi "zaten var".
  assert.ok(iceAktarOku(dosya, v).satirlar.every((x) => x.var));
  await api.istek('/ice-aktar/geri', { yontem: 'POST', govde: { idler: islemler.map((i) => i.id) } });
  assert.equal((await api.istek('/veri')).islemler.filter((i) => i.id.startsWith('ice-')).length, 0);
  assert.throws(() => iceAktarOku('{"bicim":"baska"}', v), /içe aktarma dosyası değil/);
  assert.throws(() => iceAktarOku(JSON.stringify({ bicim: 'bank-of-usy-ice-aktar', hareketler: [{ tarih: '2026-10-14', tutar: 4.25 }] }), v), /kuruş/);
});
