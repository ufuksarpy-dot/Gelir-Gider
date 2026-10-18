// Haftanın ay içindeki sırası ve "açığı ay sonundan düş" (2026-10-18 kararları). Bütün veriler uydurmadır.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as H from '../public/hesap.js';
import { bellekDeposu } from '../public/depo.js';
import { yerelApi, ApiHata } from '../public/yerel-api.js';

const ayar = (ek = {}) => ({ ...H.VARSAYILAN_AYAR, ...ek });

test('haftaNo: perşembe kuralıyla bütçe ayının kaçıncı haftası', () => {
  const a = ayar();
  assert.equal(H.haftaNo('2026-10-12', a), 1); // 10 Eki cumartesi → ertesi pazartesi 1. hafta
  assert.equal(H.haftaNo('2026-11-02', a), 4);
  assert.equal(H.haftaNo('2026-10-05', a), 5); // Eylül'ün 5. haftası (10 Eyl perşembe → 7 Eyl 1. hafta)
  assert.equal(H.haftaNo('2026-12-07', a), 1); // 10 Ara perşembe → o hafta
  assert.equal(H.haftaNo('2027-01-04', a), 5); // Aralık'a sayılır
  assert.equal(H.haftaNo('2027-01-11', a), 1); // 10 Oca pazar → ertesi pazartesi
  assert.equal(H.haftaNo('2026-10-19', ayar({ kurulum_tarihi: '2026-10-13' })), 2);
  assert.equal(H.haftaNo('2026-10-12', ayar({ kurulum_tarihi: '2026-10-13' })), 1); // kurulum haftası
});

let gun = '2026-10-14';
const api = yerelApi(bellekDeposu(), { bugun: () => gun });
async function iste(yol, { yontem = 'GET', govde } = {}) {
  try { return { durum: 200, j: await api.istek(yol, { yontem, govde }) }; } catch (e) {
    if (!(e instanceof ApiHata)) throw e;
    return { durum: e.durum, j: { hata: e.message } };
  }
}
const veri = async () => (await iste('/veri')).j;
const gider = (id, tutar, ek = {}) => ({ id, tarih: gun, tur: 'gider', tutar, kaynak_id: 'h-kart', kategori_id: 'benzin', ...ek });
const isaretle = (pzt, acik) => iste(`/hafta/${pzt}/ay-sonundan`, { yontem: 'PUT', govde: { acik } });

const KURULUM = {
  baslangic: '2026-10-13',
  ayar: { ay_baslangic_gunu: 10, maas: { tutar: 5000000, hesap_id: 'h-vds' }, yatirim_tutari: 2000000, harcama_hesabi: 'h-vds', yatirim_hesabi: 'h-yat' },
  hesaplar: [
    { id: 'h-vds', ad: 'Deneme vadesiz', tur: 'vadesiz', acilis_bakiye: 3000000 },
    { id: 'h-yat', ad: 'Deneme yatırım', tur: 'yatirim', acilis_bakiye: 500000 },
    { id: 'h-kart', ad: 'Deneme kart', tur: 'kart', acilis_bakiye: 0, limit_tutar: 5000000, kesim_gunu: 12, son_odeme_gunu: 22, odeme_hesap_id: 'h-vds' },
  ],
  kategoriler: [
    { id: 'benzin', ad: 'Benzin', tur: 'haftalik', limit_tutar: 100000, sira: 1 },
    { id: 'yemek', ad: 'Yemek', tur: 'haftalik', limit_tutar: 50000, sira: 2 },
  ],
  sabitler: [],
};

test('kurulum; ilk hafta tam limit kadar harcanır (fark 0)', async () => {
  assert.equal((await iste('/kurulum', { yontem: 'POST', govde: KURULUM })).durum, 200);
  const l = H.haftaLimitleri(await veri(), '2026-10-12');
  await iste('/islem', { yontem: 'POST', govde: gider('ilk-hafta', l.benzin + l.yemek) });
});

test('sürmekte olan haftanın açığı ay sonundan düşülürse sonraki hafta kısılmaz', async () => {
  gun = '2026-10-21';
  await iste('/islem', { yontem: 'POST', govde: gider('asim-hafta', 200000) }); // limit 150.000 → açık 50.000
  let v = await veri();
  assert.equal(H.haftaAcigi(v, '2026-10-19', gun), 50000);
  const once = H.aySonuTahmini(v, gun).tutar;
  assert.equal((await isaretle('2026-10-19', true)).durum, 200);
  v = await veri();
  // İşaretsizken sonraki hafta 50.000 kısılacağı için tahmin o kadar yüksekti; işaretlenince kısma yok, tahmin düşer.
  assert.equal(H.aySonuTahmini(v, gun).tutar, once - 50000);
  assert.deepEqual(H.sonrakiHaftaKismasi(v, gun), {});
  assert.equal(H.aySonuTahmini(v, gun).aySonundan, 50000);
  gun = '2026-10-26';
  v = await veri();
  assert.equal(H.artanButce(v), 0);
  assert.equal(v.kismalar['2026-10-26'], undefined);
  assert.equal(H.aySonuTahmini(v, gun).aySonundan, 50000);
});

test('geri alınınca bu hafta kısılır; yeniden işaretlenince kısma kalkar', async () => {
  assert.equal((await isaretle('2026-10-19', false)).durum, 200);
  let v = await veri();
  assert.equal(H.artanButce(v), -50000);
  const k = v.kismalar['2026-10-26'];
  assert.equal(k.benzin + (k.yemek || 0), 50000);
  assert.equal(H.aySonuTahmini(v, gun).aySonundan, 0);
  await isaretle('2026-10-19', true);
  v = await veri();
  assert.equal(v.kismalar['2026-10-26'], undefined);
  assert.equal(H.artanButce(v), 0);
  await isaretle('2026-10-19', false); // kısma geri gelir (sonraki deneme için)
});

test('kapanmış haftada sonradan işaretlenirse kısmayla biriken para artan bütçeye geçer', async () => {
  const l = H.haftaLimitleri(await veri(), '2026-10-26'); // kısılmış limitler
  await iste('/islem', { yontem: 'POST', govde: gider('kisik-hafta', l.benzin + l.yemek) });
  gun = '2026-11-02';
  let v = await veri();
  assert.equal(H.artanButce(v), 0); // açık kısmayla ödendi
  assert.equal((await isaretle('2026-10-19', true)).durum, 200);
  v = await veri();
  assert.equal(H.artanButce(v), 50000);
  assert.equal(v.kismalar['2026-11-02'], undefined);
});

test('yalnız bu bütçe ayının bugüne kadarki haftaları işaretlenebilir', async () => {
  assert.equal((await isaretle('2026-11-09', true)).durum, 409); // gelecek
  assert.equal((await isaretle('2026-10-05', true)).durum, 409); // Eylül
  assert.equal((await isaretle('2026-10-20', true)).durum, 409); // pazartesi değil
  assert.equal((await isaretle('2026-10-12', true)).durum, 200); // açığı yok, zararsız
});
