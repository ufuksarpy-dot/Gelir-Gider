// hesap.js birim testleri. Bütün veriler uydurmadır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../public/hesap.js';

const ayar = (ek = {}) => ({ ...H.VARSAYILAN_AYAR, ...ek });

test('butceAyi: 10 ve sonrası o ay, 9 ve öncesi önceki ay', () => {
  const a = ayar();
  assert.equal(H.butceAyi('2026-10-10', a), '2026-10');
  assert.equal(H.butceAyi('2026-10-09', a), '2026-09');
  assert.equal(H.butceAyi('2026-11-09', a), '2026-10');
  assert.equal(H.butceAyi('2027-01-05', a), '2026-12');
  assert.equal(H.butceAyi('2026-10-31', a), '2026-10');
});

test('butceAyi: başlangıç günü 1 ise takvim ayı', () => {
  const a = ayar({ ay_baslangic_gunu: 1 });
  assert.equal(H.butceAyi('2026-10-01', a), '2026-10');
  assert.equal(H.butceAyi('2026-10-31', a), '2026-10');
  assert.deepEqual(H.ayAraligi('2026-02', a), { bas: '2026-02-01', son: '2026-02-28' });
});

test('ayAraligi: 10 Ekim – 9 Kasım, yıl dönümü', () => {
  assert.deepEqual(H.ayAraligi('2026-10', ayar()), { bas: '2026-10-10', son: '2026-11-09' });
  assert.deepEqual(H.ayAraligi('2026-12', ayar()), { bas: '2026-12-10', son: '2027-01-09' });
});

test('ekleAy ve ekleAyTarih: ay sonu kırpılır', () => {
  assert.equal(H.ekleAy('2026-12', 1), '2027-01');
  assert.equal(H.ekleAy('2026-01', -1), '2025-12');
  assert.equal(H.ekleAyTarih('2026-01-31', 1), '2026-02-28');
  assert.equal(H.ekleAyTarih('2028-01-31', 1), '2028-02-29');
});

test('pazartesi ve haftaGunu', () => {
  assert.equal(H.pazartesi('2026-10-04'), '2026-09-28'); // pazar
  assert.equal(H.pazartesi('2026-10-05'), '2026-10-05'); // pazartesi
  assert.equal(H.haftaGunu('2026-10-08'), 3); // perşembe
});

test('ayHaftalari: hafta perşembesinin bütçe ayına aittir, bazı aylar 5 hafta', () => {
  const a = ayar();
  // Ekim 2026 bütçe ayı: 10 Eki – 9 Kas. Perşembeler: 15, 22, 29 Eki, 5 Kas → 4 hafta.
  assert.deepEqual(H.ayHaftalari('2026-10', a), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  // 8 Eki perşembesi Eylül'e aittir.
  assert.equal(H.haftaAyi('2026-10-05', a), '2026-09');
  // Bir yıl boyunca her hafta tam bir aya düşer ve 4 ya da 5 hafta olur.
  let say = 0;
  for (let ay = '2026-01'; ay <= '2026-12'; ay = H.ekleAy(ay, 1)) {
    const n = H.ayHaftalari(ay, a).length;
    assert.ok(n === 4 || n === 5, `${ay}: ${n}`);
    say += n;
  }
  assert.ok(say === 52 || say === 53);
});

test('kurulum haftası kurulum ayına aittir ve orantılanır', () => {
  const a = ayar({ kurulum_tarihi: '2026-10-11' }); // pazar; haftanın perşembesi 8 Eki (Eylül)
  assert.equal(H.haftaAyi('2026-10-05', a), '2026-10');
  assert.equal(H.ayHaftalari('2026-10', a)[0], '2026-10-05');
  assert.equal(H.haftaOrani('2026-10-05', a), 1 / 7);
  assert.equal(H.haftaOrani('2026-10-12', a), 1);
  assert.equal(H.haftaOrani('2026-09-28', a), 0);
});

test('ayOrani: kurulum ayında kalan gün / toplam gün', () => {
  const a = ayar({ kurulum_tarihi: '2026-10-31' }); // 10 Eki – 9 Kas = 31 gün, kalan 10 gün
  assert.equal(H.ayOrani('2026-10', a), 10 / 31);
  assert.equal(H.ayOrani('2026-11', a), 1);
  assert.equal(H.ayOrani('2026-09', a), 0);
});

test('paraYaz ve paraOku', () => {
  assert.equal(H.paraYaz(123456), '1.234,56 ₺');
  assert.equal(H.paraYaz(150000, { kisa: true }), '1.500 ₺');
  assert.equal(H.paraYaz(-5000, { kisa: true }), '−50 ₺');
  assert.equal(H.paraOku('1.234,56'), 123456);
  assert.equal(H.paraOku('1234,5'), 123450);
  assert.equal(H.paraOku('1234.56'), 123456);
  assert.equal(H.paraOku('1.500'), 150000);
  assert.equal(H.paraOku('12'), 1200);
  assert.equal(H.paraOku('abc'), null);
  assert.equal(H.paraOku(''), null);
});

test('kartNoVarMi: Luhn uyan 15–16 hane reddedilir', () => {
  assert.equal(H.kartNoVarMi('kart 4111 1111 1111 1111 ile'), true);
  assert.equal(H.kartNoVarMi('378282246310005'), true); // 15 hane
  assert.equal(H.kartNoVarMi('4111-1111-1111-1112'), false);
  assert.equal(H.kartNoVarMi('market 250 TL, fiş 12345'), false);
  assert.equal(H.kartNoVarMi('tel 05551234567'), false);
});

test('taksitPaylari: küsurat ilk payda, aylar kırpılır', () => {
  const p = H.taksitPaylari({ tarih: '2026-01-31', tutar: 100001, taksit: 3 });
  assert.deepEqual(p.map((x) => x.tutar), [33335, 33333, 33333]);
  assert.deepEqual(p.map((x) => x.tarih), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(H.butcePayi({ tarih: '2026-01-01', tutar: 5000, taksit: 1 }), 5000);
});

test('sabitVadeleri: periyot, ay sonu, son vade', () => {
  const k = { gun: 31, periyot: 3, ilk_ay: '2026-01' };
  assert.deepEqual(H.sabitVadeleri(k, '2026-01-01', '2026-12-31'), ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
  const kredi = { gun: 15, periyot: 1, ilk_ay: '2026-01', son_vade: '2026-03-15' };
  assert.deepEqual(H.sabitVadeleri(kredi, '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-02-15', '2026-03-15']);
  // Çok eski başlangıç da doğru faza oturur.
  const yillik = { gun: 1, periyot: 12, ilk_ay: '2001-06' };
  assert.deepEqual(H.sabitVadeleri(yillik, '2026-01-01', '2026-12-31'), ['2026-06-01']);
});

test('sela: önce havuz dolar, artan oranla bölünür, toplam korunur', () => {
  assert.deepEqual(H.sela(10000, 0, 30000, { birikim: 50, yatirim: 30, serbest: 20 }), { havuz: 10000, birikim: 0, yatirim: 0, serbest: 0 });
  assert.deepEqual(H.sela(10000, 25000, 30000, { birikim: 50, yatirim: 30, serbest: 20 }), { havuz: 5000, birikim: 2500, yatirim: 1500, serbest: 1000 });
  const s = H.sela(9999, 50000, 30000, { birikim: 33, yatirim: 33, serbest: 34 });
  assert.equal(s.havuz, 0);
  assert.equal(s.havuz + s.birikim + s.yatirim + s.serbest, 9999);
});

// Uydurma bir bütçe
function ornekVeri({ ayar: ekAyar, ...ek } = {}) {
  return {
    ayar: ayar({ kurulum_tarihi: '2026-10-10', havuz_ay: 3, havuz_hesabi: 'havuz', harcama_hesabi: 'vds', birikim_hesabi: 'bir', beklenmeyen: 100000, ...ekAyar }),
    hesaplar: [
      { id: 'vds', ad: 'Vadesiz', tur: 'vadesiz', acilis_bakiye: 1000000 },
      { id: 'havuz', ad: 'Havuz', tur: 'havuz', acilis_bakiye: 5000000 },
      { id: 'bir', ad: 'Birikim', tur: 'birikim', acilis_bakiye: 0 },
      { id: 'kart', ad: 'Kart', tur: 'kart', acilis_bakiye: 0, limit_tutar: 1000000, kesim_gunu: 20, son_odeme_gunu: 30, odeme_hesap_id: 'vds' },
    ],
    kategoriler: [
      { id: 'mkt', ad: 'Market', tur: 'haftalik', limit_tutar: 150000, sira: 1 },
      { id: 'ymk', ad: 'Yemek', tur: 'haftalik', limit_tutar: 50000, sira: 2 },
      { id: 'kyf', ad: 'Kıyafet', tur: 'aylik', limit_tutar: 200000 },
      { id: 'is', ad: 'İş', tur: 'aylik', limit_tutar: 100000, is_gideri: 1 },
    ],
    hedefler: [{ id: 'acil', ad: 'Acil durum', hesap_id: 'bir', hafta_farki: 1 }],
    sabitler: [
      { id: 'kira', ad: 'Kira', tutar: 2000000, gun: 5, periyot: 1, ilk_ay: '2026-01', hesap_id: 'vds' },
      { id: 'sigorta', ad: 'Sigorta', tutar: 1200000, gun: 20, periyot: 12, ilk_ay: '2026-10', hesap_id: 'vds' },
      { id: 'muzik', ad: 'Müzik', tutar: 10000, gun: 15, periyot: 1, ilk_ay: '2026-01', hesap_id: 'kart', otomatik: 1 },
    ],
    islemler: [],
    odemeler: [],
    haftalar: [],
    ayPlanlari: [],
    ...ek,
  };
}

test('aylikIhtiyac: sabit/periyot + haftalık × 52/12 + aylık + beklenmeyen', () => {
  const v = ornekVeri();
  const beklenen = Math.round(2000000 + 1200000 / 12 + 10000 + 200000 * 52 / 12 + 200000 + 100000 + 100000);
  assert.equal(H.aylikIhtiyac(v), beklenen);
  assert.equal(H.havuzHedefi(v), beklenen * 3);
});

test('ayPlani: kovalar, kira bir sonraki takvim ayının 5\'inde, 4 hafta', () => {
  const v = ornekVeri();
  const p = H.ayPlani(v, '2026-10');
  const kova = Object.fromEntries(p.kovalar.map((k) => [k.id, k]));
  // Ekim bütçe ayı 10 Eki – 9 Kas: kira 5 Kas, sigorta 20 Eki, müzik 15 Eki.
  assert.equal(kova.sabit.plan, 2000000 + 1200000 + 10000);
  // Kurulum 10 Eki cumartesi: 5 Eki haftası 2/7 oranıyla Ekim'e, sonra 4 tam hafta.
  assert.equal(kova.haftalik.plan, Math.round(150000 * 2 / 7) + Math.round(50000 * 2 / 7) + 4 * 200000);
  assert.equal(kova.aylik.plan, 200000);
  assert.equal(kova.beklenmeyen.plan, 100000);
  assert.equal(kova.is.plan, 100000);
  assert.equal(H.aylikCekis(v, '2026-10'), p.plan);
});

test('ayPlani gerçekleşen: haftalık, plan dışı, iş, taksit payı', () => {
  const v = ornekVeri({
    islemler: [
      { id: 'a1', tarih: '2026-10-12', tur: 'gider', tutar: 30000, kaynak_id: 'vds', kategori_id: 'mkt', taksit: 1 },
      { id: 'a2', tarih: '2026-10-13', tur: 'gider', tutar: 90000, kaynak_id: 'kart', kategori_id: 'kyf', taksit: 3 },
      { id: 'a3', tarih: '2026-10-14', tur: 'gider', tutar: 5000, kaynak_id: 'vds', kategori_id: 'ymk', plan_disi: 1 },
      { id: 'a4', tarih: '2026-10-15', tur: 'gider', tutar: 7000, kaynak_id: 'vds', kategori_id: 'is' },
      { id: 'a5', tarih: '2026-10-16', tur: 'gider', tutar: 999, kaynak_id: 'vds', kategori_id: 'mkt', silindi: 1 },
    ],
  });
  const ekim = Object.fromEntries(H.ayPlani(v, '2026-10').kovalar.map((k) => [k.id, k]));
  assert.equal(ekim.haftalik.gercek, 30000);
  assert.equal(ekim.aylik.gercek, 30000); // taksidin ilk payı
  assert.equal(ekim.beklenmeyen.gercek, 5000);
  assert.equal(ekim.is.gercek, 7000);
  const kasim = Object.fromEntries(H.ayPlani(v, '2026-11').kovalar.map((k) => [k.id, k]));
  assert.equal(kasim.sabit.gercek, 30000); // 13 Kas'taki 2. pay
  assert.ok(kasim.sabit.kalemler.some((k) => k.kalem === 'taksit:a2:2'));
});

test('kurulum ayı: haftalar ve aylıklar orantılı, kurulumdan önceki vadeler yok', () => {
  const v = ornekVeri({ ayar: { kurulum_tarihi: '2026-10-25' } }); // pazar
  const kova = Object.fromEntries(H.ayPlani(v, '2026-10').kovalar.map((k) => [k.id, k]));
  // Haftalar: 19 Eki (kurulum haftası, 1/7) + 26 Eki + 2 Kas
  assert.equal(kova.haftalik.plan, Math.round(150000 / 7) + Math.round(50000 / 7) + 2 * 200000);
  assert.equal(kova.aylik.plan, Math.round(200000 * 16 / 31));
  assert.equal(kova.sabit.plan, 2000000); // yalnız 5 Kas kirası
});

test('haftaDurumu: günde harcanabilir', () => {
  const v = ornekVeri({ islemler: [{ id: 'x1', tarih: '2026-10-12', tur: 'gider', tutar: 60000, kaynak_id: 'vds', kategori_id: 'mkt' }] });
  const d = H.haftaDurumu(v, '2026-10-12', '2026-10-14'); // çarşamba, 5 gün kaldı
  assert.equal(d.limit, 200000);
  assert.equal(d.kalan, 140000);
  assert.equal(d.kalanGun, 5);
  assert.equal(d.gunluk, 28000);
});

test('bakiyeler ve beklenen bakiyeler', () => {
  const v = ornekVeri({
    islemler: [
      { id: 'g1', tarih: '2026-10-12', tur: 'gider', tutar: 10000, kaynak_id: 'kart', kategori_id: 'mkt' },
      { id: 't1', tarih: '2026-10-12', tur: 'transfer', tutar: 50000, kaynak_id: 'vds', hedef_id: 'bir', hedef_ref: 'acil' },
      { id: 'd1', tarih: '2026-10-12', tur: 'duzeltme', tutar: -100, hedef_id: 'vds' },
    ],
    odemeler: [{ id: 'o1', tur: 'havale', durum: 'bekliyor', tutar: 70000, kaynak_id: 'havuz', hedef_id: 'vds' }],
  });
  const b = H.bakiyeler(v);
  assert.equal(b.get('kart'), -10000);
  assert.equal(b.get('vds'), 1000000 - 50000 - 100);
  assert.equal(b.get('bir'), 50000);
  const bb = H.beklenenBakiyeler(v);
  assert.equal(bb.get('havuz'), 5000000 - 70000);
  assert.equal(bb.get('vds'), 1000000 - 50000 - 100 + 70000);
  assert.equal(H.hedefBirikimleri(v).get('acil'), 50000);
});

test('bakimAdimlari: çekiş, sabit, otomatik, hafta kapanışı, kart', () => {
  const v = ornekVeri({
    islemler: [
      { id: 'k1', tarih: '2026-10-12', tur: 'gider', tutar: 40000, kaynak_id: 'kart', kategori_id: 'mkt' },
      { id: 'k2', tarih: '2026-10-13', tur: 'gider', tutar: 300000, kaynak_id: 'vds', kategori_id: 'ymk' },
    ],
  });
  const s = H.bakimAdimlari(v, '2026-10-22', '2026-10-22T08:00:00.000Z');
  const cekis = s.odemeler.find((o) => o.id === 'cekis:2026-10');
  assert.equal(cekis.tutar, H.aylikCekis(v, '2026-10'));
  assert.equal(cekis.kaynak_id, 'havuz');
  assert.ok(s.ayPlanlari.every((p) => p.ay === '2026-10'));
  // 14 gün ufkundaki sabit ödemeler
  const sabitler = s.odemeler.filter((o) => o.tur === 'sabit').map((o) => o.id).sort();
  assert.deepEqual(sabitler, ['sabit:kira:2026-11-05', 'sabit:muzik:2026-10-15', 'sabit:sigorta:2026-10-20']);
  // Müzik otomatik ve vadesi geçti → işlenir
  assert.deepEqual(s.otomatikler.map((o) => o.odeme_id), ['sabit:muzik:2026-10-15']);
  assert.equal(s.otomatikler[0].islem.kaynak_id, 'kart');
  // 5 Eki ve 12 Eki haftaları kapanır; fark havale olmaz, artan bütçeye yazılır.
  assert.deepEqual(s.haftalar.map((h) => h.pazartesi), ['2026-10-05', '2026-10-12']);
  const h12 = s.haftalar.find((h) => h.pazartesi === '2026-10-12');
  assert.equal(h12.fark, 200000 - 340000);
  assert.equal(s.odemeler.some((o) => o.id.startsWith('hafta:')), false);
  // Kurulum haftası (2/7 gün) +57.143, 12 Eki haftası −140.000 → artan bütçe −82.857 → 19 Eki haftası kısılır.
  const h05 = s.haftalar.find((h) => h.pazartesi === '2026-10-05');
  const acik = -(h05.fark + h12.fark);
  assert.equal(acik, 82857);
  assert.deepEqual(s.kismalar.map((k) => k.pazartesi), ['2026-10-19']);
  const dag = s.kismalar[0].dagilim;
  assert.equal(dag.mkt + dag.ymk, acik);
  assert.ok(dag.mkt > dag.ymk * 2.5 && dag.mkt < dag.ymk * 3.5, 'limitlerle orantılı');
  // Kart kesimi 20 Eki geçti → 30 Eki son ödemeli tahmini ödeme: kart market + aynı bakımda işlenen otomatik müzik
  const kart = s.odemeler.find((o) => o.tur === 'kart');
  assert.equal(kart.id, 'kart:kart:2026-10-30');
  assert.equal(kart.tutar, 40000 + 10000);
  assert.equal(kart.kaynak_id, 'vds');
});

test('bakimAdimlari: tekrar çalışınca aynı şeyi yazmaz', () => {
  const v = ornekVeri();
  const s1 = H.bakimAdimlari(v, '2026-10-21');
  const v2 = { ...v, odemeler: s1.odemeler, haftalar: s1.haftalar, ayPlanlari: s1.ayPlanlari };
  const s2 = H.bakimAdimlari(v2, '2026-10-21');
  assert.equal(s2.odemeler.length, 0);
  assert.equal(s2.haftalar.length, 0);
  assert.equal(s2.ayPlanlari.length, 0);
});

test('maasDurumu: 5 gün erken gelen maaş yaklaşan ayın maaşıdır', () => {
  const v = ornekVeri({ ayar: { kurulum_tarihi: '2026-09-15', maas: { tutar: 6000000 } } });
  assert.equal(H.maasDurumu(v, '2026-10-04').sor, false); // 10 Eki'ye 6 gün var
  assert.equal(H.maasDurumu(v, '2026-10-06').sor, true);
  v.islemler.push({ id: 'm1', tarih: '2026-10-08', tur: 'gelir', tutar: 6000000, hedef_id: 'vds', gelir_kaynagi: 'Maaş' });
  const d = H.maasDurumu(v, '2026-10-12');
  assert.equal(d.ay, '2026-10');
  assert.equal(d.sor, false);
});

test('havuzDurumu: maaşla bitme süresi', () => {
  const v = ornekVeri({ ayar: { maas: { tutar: 1000000 } } });
  const d = H.havuzDurumu(v);
  assert.equal(d.bakiye, 5000000);
  assert.ok(d.maaslaFark < 0);
  assert.equal(d.maaslaKacAy, 5000000 / (d.ihtiyac - 1000000));
});

test('islemDogrula', () => {
  const tamam = { id: 'abc-123456', tarih: '2026-10-12', tur: 'gider', tutar: 100, kaynak_id: 'vds' };
  assert.equal(H.islemDogrula(tamam), null);
  assert.match(H.islemDogrula({ ...tamam, tutar: 0 }), /sıfırdan/);
  assert.match(H.islemDogrula({ ...tamam, notu: '5555 5555 5555 4444' }), /Kart numarası/);
  assert.match(H.islemDogrula({ ...tamam, tur: 'transfer', hedef_id: 'vds' }), /Transfer/);
  assert.equal(H.islemDogrula({ ...tamam, tur: 'duzeltme', tutar: -50, hedef_id: 'vds' }), null);
});
