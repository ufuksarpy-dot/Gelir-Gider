// BANK OF USY — telefon arayüzü. Hesap yapmaz: bütün hesaplar hesap.js'te, kayıtlar telefonda (yerel-api.js → depo.js).
import * as H from './hesap.js';
import { telefonDeposu, sifreliKasa, yedekOku } from './depo.js';
import { yerelApi, ApiHata } from './yerel-api.js';
import { excelSayfalari } from './excel.js';
import { iceAktarOku, iceAktarIslemleri } from './ice-aktar.js';

// ================================================================ durum ve yardımcılar

const D = {
  veri: null,
  ekran: 'ozet',
  ay: null,           // Ay ekranında gösterilen bütçe ayı
  hareketAy: null,    // Hareketler ekranının ayı
  pin: null,          // { mod, girilen, ilk, mesaj }
  giris: null,        // hızlı giriş durumu
  sihirbaz: null,
};

const $ = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = (k, o = {}) => (o.tam ? H.paraYaz(Math.round(k / 100) * 100, { kisa: true, ...o }) : H.paraYaz(k, { kisa: true, ...o }));
const bugun = () => H.bugun();
const kimlik = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const aktif = (l) => (l || []).filter((x) => x.aktif !== 0);
const kurusMetin = (k) => (k == null || k === '' ? '' : (Number(k) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

function hesapAdi(id) {
  return D.veri?.hesaplar.find((h) => h.id === id)?.ad || '—';
}
function kategori(id) {
  return D.veri?.kategoriler.find((k) => k.id === id);
}
function ayar() {
  return H.ayarBirlestir(D.veri?.ayar);
}
function gunMetni(vade) {
  const f = H.gunFarki(bugun(), vade);
  if (f === 0) return 'bugün';
  if (f === 1) return 'yarın';
  if (f > 1) return `${f} gün sonra`;
  return `${-f} gün geçti`;
}
function secenekler(liste, secili, bos) {
  return (bos != null ? `<option value="">${e(bos)}</option>` : '') +
    liste.map(([d, a]) => `<option value="${e(d)}"${String(d) === String(secili ?? '') ? ' selected' : ''}>${e(a)}</option>`).join('');
}
function hesapSecenekleri(filtre, secili, bos) {
  return secenekler(aktif(D.veri?.hesaplar).filter(filtre || (() => true)).map((h) => [h.id, h.ad]), secili, bos);
}
const harcanabilir = (h) => ['nakit', 'vadesiz', 'kart'].includes(h.tur);

// ================================================================ veri (telefonda)

// Sunucu yok: istekler telefondaki modüle gider. Yollar ve cevaplar eski API'yle aynı.
// Kayıtlar PIN'le şifreli durur; PIN girilmeden hiçbir istek cevap vermez (401 → PIN ekranı).
const API = yerelApi(sifreliKasa(telefonDeposu()));
const istek = (yol, secenek) => API.istek(yol, secenek);

async function yenile() {
  D.veri = await istek('/veri');
}

// Yazdıktan sonra ekranı güncel veriyle çiz.
async function yazVeCiz(yol, yontem, govde) {
  const r = await istek(yol, { yontem, govde });
  await yenile();
  ciz();
  return r;
}

function hataGoster(err) {
  if (err instanceof ApiHata && err.durum === 401) { pinAc('gir'); return; }
  bildirim(err instanceof ApiHata ? err.message : 'Kaydedilemedi. Tekrar dene.');
  console.error(err);
}

async function guvenli(fn) {
  try { await fn(); } catch (err) { hataGoster(err); }
}

// ================================================================ katmanlar: sayfa ve bildirim

function sayfaAc(html, { tam = false } = {}) {
  const k = $('#katman');
  k.innerHTML = `<div class="perde" data-eylem="kapat"></div><div class="sayfa${tam ? ' tam' : ''}" role="dialog"><div class="tutamak"></div>${html}</div>`;
  requestAnimationFrame(() => { $('.perde', k)?.classList.add('acik'); $('.sayfa', k)?.classList.add('acik'); });
  document.body.style.overflow = 'hidden';
  return $('.sayfa', k);
}

function sayfaKapat() {
  const k = $('#katman');
  const s = $('.sayfa', k);
  if (!s) return;
  s.classList.remove('acik');
  $('.perde', k)?.classList.remove('acik');
  document.body.style.overflow = '';
  D.giris = null;
  setTimeout(() => { if (!$('.sayfa.acik', k)) k.innerHTML = ''; }, 250);
}

const sayfaBaslik = (b) => `<h3><span>${e(b)}</span><button class="kapat" data-eylem="kapat" aria-label="Kapat">×</button></h3>`;

let bildirimZamani;
function bildirim(metin, eylem) {
  $('.bildirim')?.remove();
  clearTimeout(bildirimZamani);
  const el = document.createElement('div');
  el.className = 'bildirim';
  el.innerHTML = `<span>${e(metin)}</span>${eylem ? `<button>${e(eylem.ad)}</button>` : ''}`;
  if (eylem) $('button', el).addEventListener('click', () => { el.remove(); eylem.fn(); });
  document.body.append(el);
  bildirimZamani = setTimeout(() => el.remove(), eylem ? 5000 : 3500);
}

// ================================================================ açılış

let swKayitli = false;

// Çevrimdışı çalışma + otomatik güncelleme. Yeni sürüm etkinleşince sayfa bir kez yenilenir (yoksa telefon
// eski kodu açık tutar); ilk kurulumda (henüz denetleyen yokken) yenileme yok. iPhone uygulamayı çoğu zaman
// arkada tuttuğu için öne gelince de yeni sürüme bakılır. Yenilenince PIN yeniden sorulur.
function swKaydet() {
  if (swKayitli || !('serviceWorker' in navigator)) return;
  swKayitli = true;
  if (navigator.serviceWorker.controller) {
    let yenilendi = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (yenilendi) return;
      yenilendi = true;
      location.reload();
    });
  }
  navigator.serviceWorker.register('sw.js').then((k) => {
    k.update();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) k.update().catch(() => {}); });
  }).catch(() => {});
}

async function basla() {
  swKaydet();
  let d;
  try {
    const kasa = await API.kasaDurumu();
    if (kasa === 'yok') return pinAc('belirle');
    if (kasa === 'kilitli') return pinAc('gir');
    d = await istek('/durum');
  } catch (err) {
    console.error(err);
    $('#uyg').innerHTML = `<div class="kilit"><div class="monogram">USY</div><p class="soluk">Telefondaki kayıtlar açılamadı.</p><button class="btn ana" data-eylem="yeniden">Tekrar dene</button></div>`;
    return;
  }
  if (!d.kurulum) return guvenli(sihirbazAc);
  try { await yenile(); } catch (err) { return hataGoster(err); }
  anaEkran();
}

function anaEkran() {
  D.pin = null;
  $('#menu').hidden = false;
  if (!D.ay) D.ay = H.butceAyi(bugun(), ayar());
  ciz();
}

function ciz() {
  if (!D.veri) return;
  const ekranlar = { ozet: ozetCiz, ay: ayCiz, cuzdan: cuzdanCiz, ayarlar: ayarlarCiz, hareketler: hareketlerCiz, sabitler: sabitlerCiz, kategoriler: kategorilerCiz };
  $('#uyg').innerHTML = (ekranlar[D.ekran] || ozetCiz)();
  const ana = { hareketler: 'ozet', sabitler: 'ay', kategoriler: 'ayarlar' }[D.ekran] || D.ekran;
  for (const b of $$('#menu [data-ekran]')) b.classList.toggle('secili', b.dataset.ekran === ana);
}

function ekranaGit(ekran) {
  D.ekran = ekran;
  ciz();
  window.scrollTo(0, 0);
}

// ================================================================ PIN
// 4 rakam; dördüncü rakamda kendiliğinden denenir. PIN kayıtları şifreleyen anahtarı açar (depo.js › sifreliKasa).
// Yanlış denemede bekleme yok. Uygulama 5 dakikadan uzun arka planda kalırsa yeniden sorulur.

const PIN_UZUNLUK = 4;
const KILIT_SURESI = 5 * 60e3;

function pinAc(mod, mesaj = '') {
  $('#menu').hidden = true;
  sayfaKapat();
  D.veri = null;
  D.pin = { mod, girilen: '', ilk: '', mesaj, bekliyor: false, salla: false };
  pinCiz();
}

function pinCiz() {
  const p = D.pin;
  const baslik = { belirle: 'PIN belirle', tekrar: 'PIN\'i tekrar gir', gir: 'Hoş geldin', yedek: 'Yedeğin PIN\'i' }[p.mod];
  const alt = p.bekliyor ? 'Açılıyor…' : { belirle: '4 rakam', tekrar: 'Aynı 4 rakam', gir: 'PIN\'ini gir', yedek: 'Yedeği alırken kullandığın PIN' }[p.mod];
  const noktalar = Array.from({ length: PIN_UZUNLUK }, (_, i) => `<i class="${i < p.girilen.length ? 'dolu' : ''}"></i>`).join('');
  let uyari = '';
  if (p.mod === 'belirle' || p.mod === 'tekrar') uyari = '<p class="kucuk uyari pin-not">PIN\'i unutursan kayıtlar da yedek de açılmaz. Bir kâğıda yaz, telefondan ayrı sakla.</p>';
  if (p.mod === 'belirle') uyari += `<label class="bag altin">Yeni telefon mu? Yedekten geri yükle${yedekGirdisi()}</label>`;
  if (p.mod === 'yedek') uyari = '<button class="bag soluk" data-eylem="yedek-vazgec">Vazgeç</button>';
  $('#uyg').innerHTML = `<div class="kilit">
    <div class="monogram">USY</div>
    <div style="text-align:center"><div class="serif" style="font-size:20px">${baslik}</div><div class="soluk kucuk">${alt}</div></div>
    <div class="noktalar${p.salla ? ' salla' : ''}">${noktalar}</div>
    <div class="kucuk kotu" style="min-height:20px">${e(p.mesaj)}</div>
    <div class="pin-tuslar">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-eylem="pin-tus" data-t="${n}">${n}</button>`).join('')}
      <span></span>
      <button data-eylem="pin-tus" data-t="0">0</button>
      <button class="metin" data-eylem="pin-tus" data-t="sil">Sil</button>
    </div>${uyari}</div>`;
  p.salla = false;
}

function pinTus(t) {
  const p = D.pin;
  if (!p || p.bekliyor) return;
  if (t === 'sil') p.girilen = p.girilen.slice(0, -1);
  else if (p.girilen.length < PIN_UZUNLUK) p.girilen += t;
  p.mesaj = '';
  pinCiz();
  if (p.girilen.length === PIN_UZUNLUK) guvenli(pinGonder);
}

async function pinGonder() {
  const p = D.pin;
  if (p.mod === 'belirle') { D.pin = { ...p, mod: 'tekrar', girilen: '', ilk: p.girilen }; return pinCiz(); }
  if (p.mod === 'tekrar' && p.girilen !== p.ilk) {
    D.pin = { ...p, mod: 'belirle', girilen: '', ilk: '', mesaj: 'İki PIN aynı değil, baştan.', salla: true };
    return pinCiz();
  }
  p.bekliyor = true;
  pinCiz();
  try {
    if (p.mod === 'tekrar') await API.pinBelirle(p.girilen);
    else if (p.mod === 'yedek') await API.geriYukle(D.yedekMetin, p.girilen);
    else await API.pinGir(p.girilen);
  } catch (err) {
    if (!err.pinHatasi) throw err;
    Object.assign(p, { girilen: '', bekliyor: false, mesaj: err.message, salla: true });
    return pinCiz();
  }
  const yedekten = p.mod === 'yedek';
  D.pin = null;
  D.yedekMetin = null;
  if (yedekten) D.ekran = 'ozet';
  await basla();
  if (yedekten) bildirim('Yedek yüklendi');
}

// ================================================================ YEDEK
// Yedek = telefondaki şifreli kayıtların dosyası (PIN'siz açılmaz). iPhone'da paylaş menüsüyle Dosyalar'a
// (OneDrive / iCloud Drive) kaydedilir. Geri yükleme yedeğin PIN'iyle; telefondaki kayıtların yerine geçer.

const YEDEK_HATIRLATMA_GUN = 30;

// Dosya seçici: etiketin (label) içinde durur, dokununca telefonun dosya seçicisi açılır.
const yedekGirdisi = () => '<input type="file" accept=".json,application/json" data-dosya="yedek" hidden>';

async function yedekAl() {
  const metin = await API.yedekHazirla();
  const dosya = new File([metin], `BANK OF USY yedek ${bugun()}.json`, { type: 'application/json' });
  const kb = Math.max(1, Math.round(metin.length / 1024));
  dosyaSayfasi({ baslik: 'Yedek al', dosya, ozet: `${kb} KB · PIN'le şifreli`, sonra: yedekAlindi });
}

// Hazır dosyayı kaydetme sayfası (yedek, Excel). Paylaşım dokunuşun içinde hemen başlamalı
// (iPhone başka türlü izin vermez); bu yüzden dosya önceden hazırlanır, "Kaydet" yalnız paylaşır.
function dosyaSayfasi({ baslik, dosya, ozet, sonra }) {
  D.paylas = { dosya, sonra };
  sayfaAc(`${sayfaBaslik(baslik)}
    <div class="kart"><div class="ikili"><span><b>Dosya hazır</b><br><span class="soluk kucuk">${e(ozet)}</span></span><span class="altin" style="font-size:22px">☁</span></div></div>
    <p class="soluk kucuk">"Kaydet"e dokun; açılan menüde <b>Dosyalara Kaydet</b>'i seç, sonra <b>OneDrive</b> ya da <b>iCloud Drive</b> klasörünü. OneDrive'a kaydedersen bilgisayarına da iner.</p>
    <button class="btn ana tam" data-eylem="dosya-paylas">Kaydet</button>`);
}

function dosyaPaylas() {
  const p = D.paylas;
  if (!p) return;
  if (navigator.canShare?.({ files: [p.dosya] })) {
    navigator.share({ files: [p.dosya], title: p.dosya.name })
      .then(() => guvenli(p.sonra))
      .catch((err) => { if (err?.name !== 'AbortError') dosyaIndir(p); });
  } else {
    dosyaIndir(p);
  }
}

function dosyaIndir(p) {
  const url = URL.createObjectURL(p.dosya);
  const a = document.createElement('a');
  a.href = url;
  a.download = p.dosya.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  guvenli(p.sonra);
}

async function yedekAlindi() {
  D.paylas = null;
  await istek('/yedek-alindi', { yontem: 'POST', govde: {} });
  sayfaKapat();
  await yenile();
  ciz();
  bildirim('Yedek kaydedildi');
}

function yedekYukleAc() {
  sayfaAc(`${sayfaBaslik('Yedekten geri yükle')}
    <p class="uyari kucuk">Telefondaki bütün kayıtlar yedektekilerle değişir. Bu geri alınamaz.</p>
    <p class="soluk kucuk">Yedek dosyasını seç (OneDrive ya da iCloud Drive'da "BANK OF USY yedek ….json"), sonra yedeğin PIN'ini gir.</p>
    <label class="btn ana tam" style="display:block;text-align:center">Yedek dosyasını seç${yedekGirdisi()}</label>`);
}

async function yedekDosyasiSecildi(girdi) {
  const f = girdi.files?.[0];
  girdi.value = '';
  if (!f) return;
  const metin = await f.text();
  try { yedekOku(metin); } catch (err) { return bildirim(err.message); }
  D.yedekMetin = metin;
  pinAc('yedek');
}

// ================================================================ EXCEL, İÇE AKTARMA, DENEME VERİSİ

// SheetJS yalnız aktarırken yüklenir (açılışı yavaşlatmasın).
let xlsxSozu = null;
function xlsxYukle() {
  if (window.XLSX) return Promise.resolve();
  xlsxSozu ||= new Promise((coz, red) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = coz;
    s.onerror = () => { xlsxSozu = null; red(new ApiHata(500, 'Excel aracı yüklenemedi')); };
    document.head.append(s);
  });
  return xlsxSozu;
}

const EXCEL_TARIH = (t) => (Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86400e3;

function excelKitabi(sayfalar) {
  const X = window.XLSX;
  const kitap = X.utils.book_new();
  for (const s of sayfalar) {
    const satirlar = s.satirlar.map((r) => r.map((x, j) => (s.sutunlar[j]?.bicim === 'tarih' && x ? EXCEL_TARIH(x) : x)));
    const aoa = [s.sutunlar.map((c) => c.baslik), ...satirlar];
    const ws = X.utils.aoa_to_sheet(aoa);
    s.sutunlar.forEach((c, j) => {
      if (!c.bicim) return;
      for (let i = 1; i < aoa.length; i++) {
        const h = ws[X.utils.encode_cell({ r: i, c: j })];
        if (h?.t === 'n') h.z = c.bicim === 'tarih' ? 'dd.mm.yyyy' : '#,##0.00 "₺"';
      }
    });
    ws['!cols'] = s.sutunlar.map((c) => ({ wch: c.genislik || 12 }));
    if (aoa.length > 1) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: s.sutunlar.length - 1 } }) };
    X.utils.book_append_sheet(kitap, ws, s.ad.slice(0, 31));
  }
  return X.write(kitap, { type: 'array', bookType: 'xlsx' });
}

async function excelAktar() {
  bildirim('Excel hazırlanıyor…');
  await xlsxYukle();
  const sayfalar = excelSayfalari(D.veri, bugun());
  const dosya = new File([excelKitabi(sayfalar)], `BANK OF USY ${bugun()}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  dosyaSayfasi({
    baslik: "Excel'e aktar", dosya, ozet: `${sayfalar.length} sayfa · şifresiz, okumak için`,
    sonra: async () => { D.paylas = null; sayfaKapat(); bildirim('Excel kaydedildi'); },
  });
}

// İçe aktarma: Claude'un banka listesinden hazırladığı dosya. Önce özet, eksik kategoriler sorulur, sonra hepsi birden eklenir.
async function iceAktarSecildi(girdi) {
  const f = girdi.files?.[0];
  girdi.value = '';
  if (!f) return;
  let sonuc;
  try { sonuc = iceAktarOku(await f.text(), D.veri); } catch (err) { return bildirim(err.message); }
  D.ice = { sonuc, hesap: sonGiderHesabi() };
  sayfaAc('<div id="ice"></div>', { tam: true });
  iceAktarCiz();
}

function iceAktarCiz() {
  const { sonuc, hesap } = D.ice;
  const yeni = sonuc.satirlar.filter((s) => !s.var);
  const eksik = yeni.filter((s) => !s.kategori_id).length;
  const toplam = yeni.reduce((t, s) => t + s.tutar, 0);
  const katSecenek = [...aktif(D.veri.kategoriler).map((k) => [k.id, `${k.simge || ''} ${k.ad}`]), [H.ARTAN_KATEGORI, `✦ ${H.ARTAN_AD}`]];
  const tarihler = yeni.map((s) => s.tarih).sort();
  $('#ice').innerHTML = `${sayfaBaslik('İçe aktar')}
    ${sonuc.aciklama ? `<div class="etiket-k">${e(sonuc.aciklama)}</div>` : ''}
    <div class="buyuk">${paraParca(toplam)}</div>
    <div class="soluk kucuk">${yeni.length} yeni kayıt${tarihler.length ? ` · ${e(H.tarihYaz(tarihler[0]))} – ${e(H.tarihYaz(tarihler.at(-1)))}` : ''}${yeni.length < sonuc.satirlar.length ? ` · ${sonuc.satirlar.length - yeni.length} kayıt zaten var, atlanır` : ''}</div>
    ${yeni.some((s) => !s.hesap_id) ? `<label class="alan" style="margin-top:12px"><span>Hesabı yazmayan kayıtlar</span><select data-ice-hesap>${hesapSecenekleri(harcanabilir, hesap)}</select></label>` : ''}
    ${eksik ? `<p class="uyari kucuk">${eksik} kaydın kategorisi belli değil; aşağıda seç.</p>` : ''}
    <div class="kart ince" style="margin-top:10px">${yeni.map((s) => `<div class="satir">
      <span class="ad"><b>${e(s.aciklama || 'Harcama')}</b><span>${e(H.tarihYaz(s.tarih))}${s.hesap_id ? ` · ${e(hesapAdi(s.hesap_id))}` : ''}${s.taksit > 1 ? ` · ${s.taksit} taksit` : ''}${s.aile ? ' · ailem ödüyor' : ''}</span>
        <select data-ice-id="${e(s.id)}" style="margin-top:6px;padding:6px 30px 6px 10px${s.kategori_id ? '' : ';border-color:var(--uyari)'}">${secenekler(katSecenek, s.kategori_id, 'Kategori seç')}</select></span>
      <span class="tutar">${para(-s.tutar)}</span></div>`).join('') || '<div class="bos">Eklenecek yeni kayıt yok.</div>'}</div>
    ${yeni.length ? `<button class="btn ana tam" data-eylem="ice-ekle">${yeni.length} kaydı ekle</button>` : ''}`;
}

async function iceAktarEkle() {
  const { sonuc, hesap } = D.ice;
  const eksik = sonuc.satirlar.filter((s) => !s.var && !s.kategori_id).length;
  if (eksik) return bildirim(`${eksik} kaydın kategorisi seçilmedi`);
  const islemler = iceAktarIslemleri(sonuc, hesap);
  sayfaKapat();
  const r = await yazVeCiz('/ice-aktar', 'POST', { islemler });
  D.ice = null;
  const idler = islemler.map((i) => i.id);
  bildirim(`${r.eklenen} kayıt eklendi`, { ad: 'Geri al', fn: () => guvenli(async () => { await yazVeCiz('/ice-aktar/geri', 'POST', { idler }); bildirim('Geri alındı'); }) });
}

async function denemeKur() {
  bildirim('Deneme verisi hazırlanıyor…');
  await istek('/deneme', { yontem: 'POST', govde: {} });
  D.sihirbaz = null;
  await yenile();
  D.ekran = 'ozet';
  anaEkran();
  bildirim('Deneme verisi hazır');
}

async function denemeSil() {
  await istek('/deneme', { yontem: 'DELETE' });
  D.veri = null;
  D.ekran = 'ozet';
  D.ay = null;
  sayfaKapat();
  await basla();
  bildirim('Deneme verisi silindi');
}

function yedekHatirlatmasi(a, gun) {
  if (a.deneme) return `<div class="kart uyari-kart"><b class="uyari">Deneme verisi</b>
    <div class="soluk kucuk">Gördüğün her şey uydurma. Gerçek kuruluma başlamak için sil.</div>
    <button class="btn tam" data-eylem="deneme-sil" style="margin-top:10px">Deneme verisini sil</button></div>`;
  if (!a.kurulum_tarihi) return '';
  const gecen = a.son_yedek ? H.gunFarki(a.son_yedek, gun) : null;
  if (gecen != null && gecen < YEDEK_HATIRLATMA_GUN) return '';
  return `<div class="kart uyari-kart"><b class="uyari">${gecen == null ? 'Henüz yedek almadın' : `Son yedeğin ${gecen} gün önce`}</b>
    <div class="soluk kucuk">Uygulamayı silmek ya da telefon değiştirmek kayıtları götürür; yedek tek koruma.</div>
    <button class="btn ana tam" data-eylem="yedek-al" style="margin-top:10px">Şimdi yedek al</button></div>`;
}

async function kilitle() {
  await API.kilitle();
  pinAc('gir');
}

// Arka planda geçen süre: 5 dakikayı geçince kilitlenir.
let gizlenmeZamani = null;
function arkaPlanKontrol() {
  if (document.hidden) { gizlenmeZamani = Date.now(); return 'gizli'; }
  const sure = gizlenmeZamani ? Date.now() - gizlenmeZamani : 0;
  gizlenmeZamani = null;
  if (D.pin) return 'pin';
  if (sure >= KILIT_SURESI) { guvenli(kilitle); return 'kilit'; }
  return 'acik';
}

// ================================================================ ÖZET

function ozetCiz() {
  const v = D.veri;
  const gun = bugun();
  const a = ayar();
  const pzt = H.pazartesi(gun);
  const hafta = H.haftaDurumu(v, pzt, gun);
  const maas = H.maasDurumu(v, gun);
  const dikkat = H.dikkatListesi(v, gun);
  const ufuk = H.ekleGun(gun, 14);
  const yapilacak = v.odemeler.filter((o) => o.durum === 'bekliyor' && o.vade <= ufuk).sort((x, y) => x.vade.localeCompare(y.vade));
  const son = [...v.islemler].sort(hareketSirasi).slice(0, 6);
  const b = H.bakiyeler(v);
  const hesaplar = aktif(v.hesaplar);
  const yat = H.yatirimOzeti(v, gun);
  const alacak = H.aileAlacagi(v);
  const artan = H.artanButce(v);
  const kisma = v.kismalar?.[pzt];
  const kismaToplam = kisma ? Object.values(kisma).reduce((t, x) => t + x, 0) : 0;

  let html = `<header class="ust"><h1>BANK OF USY</h1><small>${e(H.tarihYaz(gun, true))}</small></header>`;

  // Net varlık: hesaplar + yatırım − kart borcu + aileden alacak
  const { yatirim: yatirimToplam, hesaplar: nakit, kartBorcu } = H.varlikDagilimi(v);
  const bekleyenYatirim = v.odemeler.filter((o) => o.durum === 'bekliyor' && o.hedef_id && o.hedef_id === a.yatirim_hesabi).reduce((t, o) => t + o.tutar, 0);
  let alt = '';
  if (yat?.buAy > 0) alt = `<div class="iyi kucuk">▲ ${para(yat.buAy)} bu ay yatırıma ayrıldı</div>`;
  else if (bekleyenYatirim > 0) alt = `<div class="soluk kucuk">${para(bekleyenYatirim)} yatırıma gönderilmeyi bekliyor</div>`;
  html += `<section class="hero">
    <div class="etiket-k">Net varlık</div>
    <div class="buyuk">${paraParca(H.netVarlik(v))}</div>${alt}
    ${cizgiGrafik(H.netVarlikSerisi(v, gun).map((x) => x.tutar))}
    <div class="ucluk">
      <div><div class="etiket-k">Yatırım</div><div class="serif">${para(yatirimToplam, { tam: true })}</div></div>
      <div><div class="etiket-k">Hesaplar</div><div class="serif">${para(nakit, { tam: true })}</div></div>
      <div><div class="etiket-k">Kart borcu</div><div class="serif ${kartBorcu < 0 ? 'uyari' : ''}">${para(kartBorcu, { tam: true })}</div></div>
    </div>
    ${yat && yat.buYil > 0 ? `<div class="soluk kucuk" style="margin-top:10px">Bu yıl yatırıma ${para(yat.buYil, { tam: true })}${yat.seri > 1 ? ` · ${yat.seri} ay üst üste` : ''}</div>` : ''}
  </section>`;

  if (maas.sor) {
    html += `<div class="kart"><div class="ikili"><span><b>Maaş geldi mi?</b><br><span class="kucuk soluk">${e(H.ayAdi(maas.ay))} maaşı · ${para(maas.beklenen)}</span></span>
      <button class="cip secili" data-eylem="maas-geldi">Geldi</button></div></div>`;
  }
  if (alacak > 0) {
    html += `<div class="kart"><div class="ikili"><span><b>Aileden alacak</b><br><span class="kucuk soluk">${para(alacak)} · gelir sayılmaz</span></span>
      <button class="cip secili" data-eylem="aile-geldi">Geldi</button></div></div>`;
  }

  html += yedekHatirlatmasi(a, gun);

  const kalanRenk = hafta.kalan < 0 ? 'kotu' : '';
  html += `<div class="kart">
    <div class="ikili"><span class="etiket-k">Bu hafta günde</span><span class="buyuk-orta ${kalanRenk}">${para(hafta.gunluk)}</span></div>
    <div class="soluk kucuk">kalan <b class="sayi ${kalanRenk}">${para(hafta.kalan)}</b> / ${para(hafta.limit)} · ${hafta.kalanGun} gün</div>
    ${hafta.satirlar.map((s) => kategoriCubugu(s)).join('')}
    <div class="ikili ayrac"><span>${e(H.ARTAN_AD)}</span><span class="serif ${artan > 0 ? 'iyi' : artan < 0 ? 'uyari' : 'soluk'}">${para(artan, { isaret: true })}</span></div>
    ${kisma && kismaToplam ? `<button class="bag uyari" data-eylem="kisma">Bu hafta ${para(kismaToplam)} kısıldı · dağılımı gör</button>` : ''}
  </div>`;

  // Kategori aşımı çubuklarda görünüyor; burada yalnız diğer uyarılar (aynı bilgi iki kez gösterilmez).
  for (const d of dikkat.filter((x) => x.tur !== 'asim')) html += `<div class="dikkat${d.tur === 'kart' ? ' kotu' : ''}">${e(d.metin)}</div>`;

  html += `<h2>Yapılacaklar</h2><div class="kart ince">`;
  html += yapilacak.length ? yapilacak.map(odemeSatiri).join('') : `<div class="bos">14 gün içinde ödeme ya da havale yok.</div>`;
  html += `</div>`;

  if (a.havuz_hesabi) {
    const hv = H.havuzDurumu(v);
    const dol = hv.doluluk == null ? 0 : Math.min(1, Math.max(0, hv.doluluk));
    html += `<h2>Gelir havuzu</h2><div class="kart">
      <div class="ikili"><b class="sayi">${para(hv.bakiye)}</b><span class="soluk kucuk">hedef ${para(hv.hedef)}</span></div>
      <div class="cubuk"><i style="width:${(dol * 100).toFixed(1)}%"></i></div>
      <div class="kucuk soluk" style="margin-top:8px">Hiç gelir gelmezse <b>${ayMetni(hv.kacAy)}</b> yeter · aylık ihtiyaç ${para(hv.ihtiyac)}</div>
    </div>`;
  }

  html += `<h2 class="ikili"><span>Son hareketler</span><button class="kucuk-btn" data-ekran="hareketler">Tümü</button></h2><div class="kart ince">`;
  html += son.length ? son.map(hareketSatiri).join('') : `<div class="bos">Henüz kayıt yok. Ortadaki + ile başla.</div>`;
  html += `</div>`;
  return html;
}

// Büyük tutar: kuruşlar küçük, ₺ altın.
function paraParca(k) {
  const m = H.paraYaz(k, { kisa: true }).replace(' ₺', '');
  const [tam, kesir] = m.split(',');
  return `${e(tam)}${kesir ? `<span class="kesir">,${e(kesir)}</span>` : ''} <span class="tl">₺</span>`;
}

// İnce altın çizgi grafik (en az iki nokta). Yalnız gidişatı gösterir; eksen yok.
function cizgiGrafik(degerler) {
  if (degerler.length < 2) return '';
  const G = 300, Y = 46, p = 4;
  const min = Math.min(...degerler), max = Math.max(...degerler);
  const ara = max - min || 1;
  const nk = degerler.map((d, i) => [p + (i * (G - 2 * p)) / (degerler.length - 1), p + (Y - 2 * p) * (1 - (d - min) / ara)]);
  const son = nk.at(-1);
  return `<svg class="grafik" viewBox="0 0 ${G} ${Y}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${nk.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="var(--ana)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    <circle cx="${son[0].toFixed(1)}" cy="${son[1].toFixed(1)}" r="3" fill="var(--ana)"/></svg>`;
}

function ayMetni(x) {
  if (x == null || !isFinite(x)) return '—';
  if (x < 1) return `${Math.max(0, Math.round(x * 30))} gün`;
  return `${x.toFixed(1).replace('.', ',')} ay`;
}

function kategoriCubugu(s) {
  const oran = s.limit > 0 ? s.harcanan / s.limit : s.harcanan > 0 ? 2 : 0;
  const sinif = oran > 1 ? 'asim' : oran > 0.85 ? 'yakin' : '';
  return `<div style="margin-top:12px"><div class="ikili kucuk"><span>${e(s.simge)} ${e(s.ad)}</span>
    <span class="sayi"><b class="${s.kalan < 0 ? 'kotu' : ''}">${para(s.harcanan)}</b> <span class="soluk">/ ${para(s.limit)}</span></span></div>
    <div class="cubuk ${sinif}"><i style="width:${Math.min(100, oran * 100).toFixed(1)}%"></i></div></div>`;
}

const ODEME_SIMGE = { sabit: '📄', havale: '🔁', kart: '💳' };

function odemeSatiri(o) {
  const gecti = o.vade < bugun();
  const yon = o.tur === 'sabit' ? hesapAdi(o.kaynak_id) : `${hesapAdi(o.kaynak_id)} → ${hesapAdi(o.hedef_id)}`;
  return `<button class="satir" data-eylem="odeme" data-id="${e(o.id)}">
    <span class="simge">${ODEME_SIMGE[o.tur] || '•'}</span>
    <span class="ad"><b>${e(o.ad)}</b><span class="${gecti ? 'kotu' : ''}">${e(gunMetni(o.vade))}</span> <span>· ${e(yon)}</span></span>
    <span class="tutar">${para(o.tutar)}</span></button>`;
}

function hareketSirasi(a, b) {
  return b.tarih.localeCompare(a.tarih) || String(b.olusturma || '').localeCompare(String(a.olusturma || ''));
}

function hareketSatiri(i) {
  const v = D.veri;
  let simge = '•', ad = '', alt = H.tarihYaz(i.tarih), tutar = '', sinif = '';
  if (i.tur === 'gider') {
    const k = i.kategori_id === H.ARTAN_KATEGORI ? { ad: H.ARTAN_AD, simge: '✦' } : kategori(i.kategori_id);
    const o = i.odeme_id && v.odemeler.find((x) => x.id === i.odeme_id);
    simge = k?.simge || (i.odeme_id ? '📄' : '💸');
    ad = k?.ad || o?.ad || 'Ödeme';
    alt += ` · ${hesapAdi(i.kaynak_id)}`;
    if (i.taksit > 1) alt += ` · ${i.taksit} taksit`;
    if (i.plan_disi) alt += ' · plan dışı';
    if (i.aile) alt += ' · ailem ödüyor';
    tutar = para(-i.tutar);
  } else if (i.tur === 'gelir') {
    simge = i.aile ? '👪' : '💰'; ad = i.aile ? 'Aileden' : i.gelir_kaynagi || 'Gelir'; alt += ` · ${hesapAdi(i.hedef_id)}`; tutar = para(i.tutar, { isaret: true }); sinif = 'iyi';
  } else if (i.tur === 'transfer') {
    const o = i.odeme_id && v.odemeler.find((x) => x.id === i.odeme_id);
    simge = o?.tur === 'kart' ? '💳' : '🔁';
    ad = o?.ad || `${hesapAdi(i.kaynak_id)} → ${hesapAdi(i.hedef_id)}`;
    if (o) alt += ` · ${hesapAdi(i.kaynak_id)} → ${hesapAdi(i.hedef_id)}`;
    tutar = para(i.tutar);
  } else {
    simge = '⚖️'; ad = `Bakiye düzeltme · ${hesapAdi(i.hedef_id)}`; tutar = para(i.tutar, { isaret: true });
  }
  if (i.notu) alt += ` · ${i.notu}`;
  return `<button class="satir" data-eylem="islem" data-id="${e(i.id)}"><span class="simge">${e(simge)}</span>
    <span class="ad"><b>${e(ad)}</b><span>${e(alt)}</span></span><span class="tutar ${sinif}">${tutar}</span></button>`;
}

// ---------------------------------------------------------------- ödeme / havale

function odemeAc(id) {
  const o = D.veri.odemeler.find((x) => x.id === id);
  if (!o) return;
  const fiil = o.tur === 'havale' ? 'Yaptım' : 'Ödendi';
  const aciklama = o.tur === 'havale'
    ? 'Bu havaleyi bankadan yap, sonra "Yaptım" de. Uygulama para göndermez.'
    : o.tur === 'kart' ? 'Tutar uygulamadaki kayıtlardan tahmindir; bankanın istediği tutarı yaz.' : 'Ödedikten sonra "Ödendi" de; tutar değiştirilebilir.';
  sayfaAc(`${sayfaBaslik(o.ad)}
    <p class="soluk kucuk">${e(aciklama)} Vade: ${e(H.tarihYaz(o.vade, true))} (${e(gunMetni(o.vade))}).</p>
    <form data-form="odeme" data-id="${e(o.id)}">
      <label class="alan"><span>Tutar</span><input name="tutar" inputmode="decimal" value="${e(kurusMetin(o.tutar))}" required></label>
      <div class="yan">
        <label class="alan"><span>${o.tur === 'sabit' ? 'Hangi hesaptan' : 'Gönderen'}</span><select name="kaynak_id">${hesapSecenekleri(null, o.kaynak_id)}</select></label>
        ${o.hedef_id ? `<label class="alan"><span>Alan</span><input value="${e(hesapAdi(o.hedef_id))}" disabled></label>` : ''}
      </div>
      <label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${bugun()}" required></label>
      <div class="btnlar"><button type="button" class="btn" data-eylem="odeme-atla" data-id="${e(o.id)}">Atla</button><button class="btn ana">${fiil}</button></div>
    </form>`);
}

async function odemeYap(form) {
  const id = form.dataset.id;
  const tutar = H.paraOku(form.tutar.value);
  if (!(tutar > 0)) return bildirim('Tutarı kontrol et');
  const islemId = `odm:${kimlik()}`; // her deneme yeni kimlik: geri alınıp yeniden yapılan ödeme silinmiş kayda çarpmaz
  await istek(`/odeme/${encodeURIComponent(id)}/yap`, { yontem: 'POST', govde: { tutar, tarih: form.tarih.value, kaynak_id: form.kaynak_id.value, islem_id: islemId } });
  sayfaKapat();
  await yenile();
  ciz();
  bildirim('Kaydedildi', { ad: 'Geri al', fn: () => guvenli(() => yazVeCiz(`/odeme/${encodeURIComponent(id)}/geri`, 'POST', {})) });
}

async function odemeAtla(id) {
  await istek(`/odeme/${encodeURIComponent(id)}/atla`, { yontem: 'POST', govde: {} });
  sayfaKapat();
  await yenile();
  ciz();
  bildirim('Atlandı', { ad: 'Geri al', fn: () => guvenli(() => yazVeCiz(`/odeme/${encodeURIComponent(id)}/geri`, 'POST', {})) });
}

// ================================================================ HIZLI GİRİŞ (+)

// Harcamada son kullanılan hesap (kart) önceden seçili gelir; yoksa ilk kredi kartı, o da yoksa harcama hesabı.
function sonGiderHesabi() {
  const v = D.veri;
  const uygun = new Set(aktif(v.hesaplar).filter(harcanabilir).map((h) => h.id));
  const son = [...v.islemler].filter((i) => i.tur === 'gider' && !i.odeme_id && uygun.has(i.kaynak_id))
    .sort((x, y) => String(y.olusturma || '').localeCompare(String(x.olusturma || '')))[0];
  return son?.kaynak_id || aktif(v.hesaplar).find((h) => h.tur === 'kart')?.id || ayar().harcama_hesabi;
}

function girisAc(ilk = {}) {
  const a = ayar();
  D.giris = {
    sekme: 'gider', tutar: '', hesap: sonGiderHesabi(), taksit: 1, plan_disi: false, aile: false, notu: '', tarih: bugun(),
    kaynak: 'Maaş', gelirHesap: a.maas?.hesap_id || a.harcama_hesabi, transferKaynak: a.harcama_hesabi, transferHedef: '', ayrinti: false,
    ...ilk,
  };
  sayfaAc('<div id="giris"></div>', { tam: true });
  girisCiz();
}

function tutarGoster(s) {
  if (!s) return '0';
  const [tamK, kesir] = s.split(',');
  const t = Number(tamK || 0).toLocaleString('tr-TR');
  return kesir != null ? `${t},${kesir}` : t;
}

function girisCiz() {
  const g = D.giris;
  const el = $('#giris');
  if (!g || !el) return;
  const v = D.veri;
  const a = ayar();
  const sekme = (id, ad) => `<button data-eylem="giris-sekme" data-s="${id}" class="${g.sekme === id ? 'secili' : ''}">${ad}</button>`;
  let html = `${sayfaBaslik('Yeni kayıt')}<div class="sekmeler">${sekme('gider', 'Harcama')}${sekme('gelir', 'Gelir')}${sekme('transfer', 'Transfer')}</div>
    <div class="ekran-tutar ${g.tutar ? '' : 'bos-tutar'}">${tutarGoster(g.tutar)} ₺</div>
    <div class="tus-takimi">${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'sil'].map((t) => `<button data-eylem="tus" data-t="${t}">${t === 'sil' ? '⌫' : t}</button>`).join('')}</div>`;

  if (g.sekme === 'gider') {
    const hesaplar = aktif(v.hesaplar).filter(harcanabilir);
    const secili = hesaplar.find((h) => h.id === g.hesap);
    html += `<div class="cipler">${hesaplar.map((h) => `<button class="cip ${h.id === g.hesap ? 'secili' : ''}" data-eylem="giris-hesap" data-id="${e(h.id)}">${h.tur === 'kart' ? '💳 ' : ''}${e(h.ad)}</button>`).join('')}</div>
      <div class="cipler">
        ${secili?.tur === 'kart' ? `<select data-alan="taksit" style="width:auto;padding:6px 30px 6px 12px;border-radius:99px">${secenekler([1, 2, 3, 4, 5, 6, 8, 9, 10, 12].map((n) => [n, n === 1 ? 'Peşin' : `${n} taksit`]), g.taksit)}</select>` : ''}
        <button class="cip ${g.plan_disi ? 'secili' : ''}" data-eylem="giris-plandisi">Plan dışı</button>
        <button class="cip ${g.aile ? 'secili' : ''}" data-eylem="giris-aile">Ailem ödüyor</button>
        <button class="cip ${g.ayrinti ? 'secili' : ''}" data-eylem="giris-ayrinti">Not · tarih</button>
      </div>
      ${g.aile ? '<p class="soluk kucuk" style="margin:-4px 4px 8px">Bütçene girmez; kart borcunda görünür, aileden alacak olur.</p>' : ''}
      ${g.ayrinti ? `<div class="yan"><label class="alan"><input data-alan="notu" placeholder="Not" value="${e(g.notu)}" maxlength="200"></label>
        <label class="alan"><input type="date" data-alan="tarih" value="${e(g.tarih)}"></label></div>` : ''}
      <div class="kat-izgara">${aktif(v.kategoriler).filter((k) => k.hizli !== 0).sort((x, y) => (x.sira - y.sira) || x.ad.localeCompare(y.ad, 'tr'))
        .map((k) => `<button data-eylem="giris-kategori" data-id="${e(k.id)}"><span class="e">${e(k.simge || '•')}</span>${e(k.ad)}${k.is_gideri ? '<small>iş</small>' : ''}</button>`).join('')}
        <button data-eylem="giris-kategori" data-id="${H.ARTAN_KATEGORI}"><span class="e altin">✦</span>${e(H.ARTAN_AD)}<small>${para(H.artanButce(v), { tam: true })}</small></button></div>
      <p class="soluk kucuk" style="text-align:center">Tutarı yaz, kategoriye dokun: kaydedilir.</p>`;
  } else if (g.sekme === 'gelir') {
    html += `<div class="cipler">${a.gelir_kaynaklari.map((k) => `<button class="cip ${k === g.kaynak ? 'secili' : ''}" data-eylem="giris-kaynak" data-k="${e(k)}">${e(k)}</button>`).join('')}</div>
      <div class="yan"><label class="alan"><span>Yattığı hesap</span><select data-alan="gelirHesap">${hesapSecenekleri((h) => h.tur !== 'kart', g.gelirHesap)}</select></label>
      <label class="alan"><span>Tarih</span><input type="date" data-alan="tarih" value="${e(g.tarih)}"></label></div>
      <label class="alan"><input data-alan="notu" placeholder="Not (isteğe bağlı)" value="${e(g.notu)}" maxlength="200"></label>
      <button class="btn ana tam" data-eylem="sela-gor">${a.havuz_hesabi ? 'Şelaleyi gör' : 'Dağıtımı gör'}</button>`;
  } else {
    html += `<div class="yan"><label class="alan"><span>Gönderen</span><select data-alan="transferKaynak">${hesapSecenekleri(null, g.transferKaynak)}</select></label>
      <label class="alan"><span>Alan</span><select data-alan="transferHedef">${hesapSecenekleri(null, g.transferHedef, 'Seç')}</select></label></div>
      <div class="yan"><label class="alan"><span>Tarih</span><input type="date" data-alan="tarih" value="${e(g.tarih)}"></label>
      <label class="alan"><span>Not</span><input data-alan="notu" value="${e(g.notu)}" maxlength="200"></label></div>
      <p class="soluk kucuk">Kendi hesapların arasında para (ör. kart borcu ödemesi). Gider sayılmaz.</p>
      <button class="btn ana tam" data-eylem="transfer-kaydet">Kaydet</button>`;
  }
  el.innerHTML = html;
}

function girisTus(t) {
  const g = D.giris;
  if (t === 'sil') g.tutar = g.tutar.slice(0, -1);
  else if (t === ',') { if (!g.tutar.includes(',')) g.tutar = (g.tutar || '0') + ','; }
  else {
    const [tamK, kesir] = g.tutar.split(',');
    if (kesir != null && kesir.length >= 2) return;
    if (kesir == null && (tamK || '').length >= 9) return;
    g.tutar = g.tutar === '0' ? t : g.tutar + t;
  }
  girisCiz();
}

function girisTutari() {
  const k = H.paraOku(D.giris.tutar);
  if (!(k > 0)) { bildirim('Önce tutarı yaz'); return null; }
  return k;
}

async function giderKaydet(kategoriId) {
  const g = D.giris;
  const tutar = girisTutari();
  if (!tutar) return;
  if (!g.hesap) return bildirim('Hesap seç');
  const k = kategoriId === H.ARTAN_KATEGORI ? { ad: H.ARTAN_AD } : kategori(kategoriId);
  const hesap = D.veri.hesaplar.find((h) => h.id === g.hesap);
  const islem = {
    id: kimlik(), tarih: g.tarih || bugun(), tur: 'gider', tutar, kaynak_id: g.hesap, kategori_id: kategoriId,
    taksit: hesap?.tur === 'kart' ? Number(g.taksit) || 1 : 1, plan_disi: g.plan_disi ? 1 : 0, aile: g.aile ? 1 : 0, notu: g.notu || null, olusturma: new Date().toISOString(),
  };
  const hata = H.islemDogrula(islem);
  if (hata) return bildirim(hata);
  sayfaKapat();
  await yazVeCiz('/islem', 'POST', islem);
  bildirim(`${k?.ad || 'Harcama'} · ${para(tutar)} kaydedildi`, { ad: 'Geri al', fn: () => guvenli(() => islemGeriAl(islem.id)) });
}

async function islemGeriAl(id) {
  await yazVeCiz(`/islem/${encodeURIComponent(id)}`, 'DELETE');
  bildirim('Geri alındı');
}

async function transferKaydet() {
  const g = D.giris;
  const tutar = girisTutari();
  if (!tutar) return;
  const islem = { id: kimlik(), tarih: g.tarih || bugun(), tur: 'transfer', tutar, kaynak_id: g.transferKaynak, hedef_id: g.transferHedef, notu: g.notu || null, taksit: 1, olusturma: new Date().toISOString() };
  const hata = H.islemDogrula(islem);
  if (hata) return bildirim(hata);
  sayfaKapat();
  await yazVeCiz('/islem', 'POST', islem);
  bildirim('Transfer kaydedildi', { ad: 'Geri al', fn: () => guvenli(() => islemGeriAl(islem.id)) });
}

// ---------------------------------------------------------------- gelir şelalesi

// Gelir sekmesinden devam: eski kurulumda (havuz varsa) şelale, yoksa dağıtım.
function gelirDevam() {
  const g = D.giris;
  if (ayar().havuz_hesabi) return selaGor();
  const tutar = girisTutari();
  if (!tutar) return;
  if (!g.gelirHesap) return bildirim('Yattığı hesabı seç');
  dagitimAc({ tutar, kaynak: g.kaynak, hesap: g.gelirHesap, tarih: g.tarih || bugun(), notu: g.notu });
}

function selaGor() {
  const g = D.giris;
  const tutar = girisTutari();
  if (!tutar) return;
  if (!g.gelirHesap) return bildirim('Yattığı hesabı seç');
  const a = ayar();
  const s = H.selaHesapla(D.veri, tutar);
  const hv = H.havuzDurumu(D.veri);
  const hedefler = aktif(D.veri.hedefler);
  const varsayilanHedef = hedefler.find((h) => h.hafta_farki)?.id || hedefler[0]?.id || '';
  const satir = (ad, ad2, alan, deger, hesap) => `<label class="alan"><span>${ad} <span class="soluk">${hesap ? `→ ${e(hesapAdi(hesap))}` : ad2}</span></span>
    <input inputmode="decimal" data-pay="${alan}" value="${e(kurusMetin(deger))}"></label>`;
  D.sela = { islem: { id: kimlik(), tarih: g.tarih || bugun(), tur: 'gelir', tutar, hedef_id: g.gelirHesap, gelir_kaynagi: g.kaynak, notu: g.notu || null, taksit: 1 } };
  sayfaAc(`${sayfaBaslik(`${g.kaynak} · ${para(tutar)}`)}
    <p class="soluk kucuk">Havuz şu an ${para(hv.bakiye)}, hedef ${para(hv.hedef)}. Önce havuz dolar; artan %${a.sela.birikim} birikim · %${a.sela.yatirim} yatırım · %${a.sela.serbest} serbest bölünür. Paylar düzenlenebilir.</p>
    <form data-form="sela">
      ${satir('Havuz payı', '', 'havuz', s.havuz, a.havuz_hesabi)}
      ${satir('Birikim payı', '', 'birikim', s.birikim, a.birikim_hesabi)}
      ${hedefler.length ? `<label class="alan"><span>Birikim hedefi</span><select name="hedef_ref">${secenekler(hedefler.map((h) => [h.id, h.ad]), varsayilanHedef, '—')}</select></label>` : ''}
      ${satir('Yatırım payı', '', 'yatirim', s.yatirim, a.yatirim_hesabi)}
      ${satir('Serbest pay', '', 'serbest', s.serbest, a.harcama_hesabi)}
      <div class="ikili kucuk" style="margin:4px 4px 0"><span class="soluk">Toplam</span><b id="sela-toplam" class="sayi">${para(tutar)}</b></div>
      <p class="soluk kucuk">Payların her biri "yapılacak havale" olur; bankadan yapınca "Yaptım" dersin. Para zaten o hesaptaysa havale çıkmaz.</p>
      <button class="btn ana tam">Onayla ve dağıt</button>
    </form>`, { tam: true });
}

function selaToplami(form) {
  return $$('[data-pay]', form).reduce((t, i) => t + (H.paraOku(i.value) || 0), 0);
}

async function selaOnayla(form) {
  const islem = D.sela.islem;
  const paylar = {};
  for (const i of $$('[data-pay]', form)) {
    const k = H.paraOku(i.value || '0');
    if (k == null || k < 0) return bildirim('Payları kontrol et');
    paylar[i.dataset.pay] = k;
  }
  const t = paylar.havuz + paylar.birikim + paylar.yatirim + paylar.serbest;
  if (t !== islem.tutar) return bildirim(`Payların toplamı ${para(t)}; gelir ${para(islem.tutar)} olmalı`);
  const govde = { islem, paylar, hedef_ref: form.hedef_ref?.value || null };
  sayfaKapat();
  await yazVeCiz('/gelir', 'POST', govde);
  bildirim(`${islem.gelir_kaynagi} kaydedildi, paylar havale listesinde`, { ad: 'Geri al', fn: () => guvenli(() => islemGeriAl(islem.id)) });
}

// ---------------------------------------------------------------- gelir dağıtımı (havuzsuz düzen)
// Maaş: o ayın giderleri hesapta kalır, yatırım tutarı (± artan bütçe) yatırıma havale olur, kalanı serbest.
// Yatırım − / + ile 1.000'er ₺ değişir. Ek gelirde gider ayrılmaz, yatırım 0'dan başlar.

const YATIRIM_ADIM = 100000;

function dagitimAc(g) {
  const maas = g.kaynak === 'Maaş';
  const d = H.gelirDagitimi(D.veri, g.tutar, { maas, tarih: g.tarih, gun: bugun() });
  D.dagitim = { maas, d, yatirim: d.yatirim, islem: { id: kimlik(), tarih: g.tarih, tur: 'gelir', tutar: g.tutar, hedef_id: g.hesap, gelir_kaynagi: g.kaynak, notu: g.notu || null, taksit: 1 } };
  sayfaAc('<div id="dagitim"></div>', { tam: true });
  dagitimCiz();
}

function dagitimUst() {
  const { d, islem } = D.dagitim;
  return Math.max(0, islem.tutar - d.giderler + d.artan);
}

function dagitimCiz() {
  const { maas, d, yatirim, islem } = D.dagitim;
  const a = ayar();
  const serbest = islem.tutar + d.artan - d.giderler - yatirim;
  const satir = (sol, sag) => `<div class="dagit-satir">${sol}${sag}</div>`;
  $('#dagitim').innerHTML = `${sayfaBaslik(islem.gelir_kaynagi)}
    <div class="etiket-k">${maas ? 'Maaş yattı' : 'Gelir'} · ${e(hesapAdi(islem.hedef_id))} · ${e(H.tarihYaz(islem.tarih))}</div>
    <div class="buyuk">${paraParca(islem.tutar)}</div>
    <div class="kart" style="margin-top:12px">
      ${maas ? satir(`<span><span class="soluk">Bu ayın giderleri</span><br><span class="soluk kucuk">${e(H.ayAdi(d.ay))} planı · hesapta kalır</span></span>`, `<span class="serif">${para(-d.giderler, { tam: true })}</span>`) : ''}
      ${d.artan ? satir(`<span><span class="soluk">${e(H.ARTAN_AD)}</span><br><span class="soluk kucuk">geçen haftalardan ${d.artan > 0 ? 'artan' : 'eksik'}</span></span>`, `<span class="serif ${d.artan > 0 ? 'iyi' : 'uyari'}">${para(d.artan, { isaret: true, tam: true })}</span>`) : ''}
      ${satir(`<span><b class="altin">Yatırıma</b><br><span class="soluk kucuk">1.000'er ₺ değişir</span></span>`,
        `<span class="pm"><button data-eylem="dagitim-eksi" aria-label="Azalt">−</button><span class="buyuk-orta">${para(yatirim, { tam: true })}</span><button data-eylem="dagitim-arti" aria-label="Artır">+</button></span>`)}
      ${satir('<span class="soluk">Serbest kalan</span>', `<span class="serif ${serbest < 0 ? 'uyari' : ''}">${para(serbest, { tam: true })}</span>`)}
    </div>
    ${serbest < 0 ? '<div class="dikkat">Gelir bu ayın planını karşılamıyor.</div>' : ''}
    ${yatirim > 0 && !a.yatirim_hesabi ? '<div class="dikkat">Yatırım hesabı seçilmedi (Ayarlar › Hesapların görevi); havale oluşmaz.</div>' : ''}
    <p class="soluk kucuk">Yatırım payı "yapılacak havale" olur. Bankadan gönderince Yaptım dersin.</p>
    <button class="btn ana tam" data-eylem="dagitim-onayla">${yatirim > 0 ? 'Onayla ve yatırıma ayır' : 'Onayla'}</button>`;
}

function dagitimDegistir(yon) {
  const x = D.dagitim;
  x.yatirim = Math.min(dagitimUst(), Math.max(0, Math.round((x.yatirim + yon * YATIRIM_ADIM) / YATIRIM_ADIM) * YATIRIM_ADIM));
  dagitimCiz();
}

async function dagitimOnayla() {
  const { d, yatirim, islem } = D.dagitim;
  const serbest = islem.tutar + d.artan - d.giderler - yatirim;
  sayfaKapat();
  await yazVeCiz('/gelir', 'POST', { islem, paylar: { giderler: d.giderler, yatirim, serbest }, artan_aktarim: d.artan });
  bildirim(yatirim > 0 ? `${para(yatirim, { tam: true })} yatırım havalesi listede` : `${islem.gelir_kaynagi} kaydedildi`, { ad: 'Geri al', fn: () => guvenli(() => islemGeriAl(islem.id)) });
}

// ---------------------------------------------------------------- kısma (artan bütçe eksideyken)

const KISMA_ADIM = 10000;

function kismaAc() {
  const pzt = H.pazartesi(bugun());
  const k = D.veri.kismalar?.[pzt];
  if (!k) return;
  const limitler = H.haftaLimitleri(D.veri, pzt, { kismasiz: true });
  // Geçen hafta aşan kategoriler (sebep)
  const onceki = H.haftaDurumu(D.veri, H.ekleGun(pzt, -7), bugun());
  const asanlar = onceki.satirlar.filter((s) => s.kalan < 0).map((s) => `${s.ad} ${para(-s.kalan)}`);
  D.kisma = { pzt, limitler, dagilim: { ...k }, toplam: Object.values(k).reduce((t, x) => t + x, 0), sebep: asanlar.length ? `Geçen hafta ${asanlar.join(', ')} aştı.` : '' };
  sayfaAc('<div id="kisma"></div>');
  kismaCiz();
}

function kismaCiz() {
  const K = D.kisma;
  const kisilan = Object.values(K.dagilim).reduce((t, x) => t + x, 0);
  const tamam = kisilan === K.toplam;
  $('#kisma').innerHTML = `${sayfaBaslik(`${para(K.toplam)} geridesin`)}
    ${K.sebep ? `<div class="uyari kucuk">${e(K.sebep)}</div>` : ''}
    <p class="soluk kucuk">Bu haftanın limitlerinden kısıldı. Dağılımı − / + ile değiştir (100'er ₺).</p>
    <div class="kart">${Object.entries(K.limitler).map(([id, limit]) => {
      const x = K.dagilim[id] || 0;
      return `<div class="dagit-satir"><span>${e(kategori(id)?.ad || '?')}<br><span class="soluk kucuk">${para(limit)} → ${para(limit - x)}</span></span>
        <span class="pm"><button data-eylem="kisma-eksi" data-id="${e(id)}" aria-label="Azalt">−</button><span class="serif">${para(x)}</span><button data-eylem="kisma-arti" data-id="${e(id)}" aria-label="Artır">+</button></span></div>`;
    }).join('')}
      <div class="dagit-satir"><span class="soluk">Kısılan</span><span class="${tamam ? 'altin' : 'uyari'}">${para(kisilan)} / ${para(K.toplam)}${tamam ? ' ✓' : ''}</span></div></div>
    <button class="btn ana tam" data-eylem="kisma-onayla"${tamam ? '' : ' disabled'}>Planı onayla</button>`;
}

function kismaDegistir(id, yon) {
  const K = D.kisma;
  const x = K.dagilim[id] || 0;
  K.dagilim[id] = Math.min(K.limitler[id], Math.max(0, x + yon * KISMA_ADIM));
  kismaCiz();
}

async function kismaOnayla() {
  const K = D.kisma;
  sayfaKapat();
  await yazVeCiz(`/kisma/${K.pzt}`, 'PUT', { dagilim: K.dagilim });
  bildirim('Bu haftanın limitleri güncellendi');
}

// ---------------------------------------------------------------- aileden gelen para

function aileAc() {
  const a = ayar();
  const alacak = H.aileAlacagi(D.veri);
  sayfaAc(`${sayfaBaslik('Aileden geldi')}
    <p class="soluk kucuk">Gelir sayılmaz, dağıtılmaz; aileden alacağını kapatır. Alacak: ${para(alacak)}.</p>
    <form data-form="aile">
      <label class="alan"><span>Gelen tutar</span><input name="tutar" inputmode="decimal" value="${e(kurusMetin(alacak))}" required></label>
      <div class="yan"><label class="alan"><span>Yattığı hesap</span><select name="hedef_id">${hesapSecenekleri((h) => h.tur !== 'kart', a.maas?.hesap_id || a.harcama_hesabi)}</select></label>
      <label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${bugun()}" required></label></div>
      <button class="btn ana tam">Kaydet</button>
    </form>`);
}

async function aileKaydet(form) {
  const tutar = H.paraOku(form.tutar.value);
  if (!(tutar > 0)) return bildirim('Tutarı kontrol et');
  const islem = { id: kimlik(), tarih: form.tarih.value, tur: 'gelir', tutar, hedef_id: form.hedef_id.value, gelir_kaynagi: 'Aile', aile: 1, taksit: 1 };
  sayfaKapat();
  await yazVeCiz('/islem', 'POST', islem);
  bildirim(`Aileden ${para(tutar)} kaydedildi`, { ad: 'Geri al', fn: () => guvenli(() => islemGeriAl(islem.id)) });
}

// ================================================================ AY

function ayCiz() {
  const v = D.veri;
  const a = ayar();
  const p = H.ayPlani(v, D.ay);
  const kalan = p.plan - p.gercek;
  const ilkAy = H.kurulumAyi(a);
  let html = `<header class="ust"><h1>Ay planı</h1><small>${p.donmus ? 'plan donduruldu' : 'plan canlı'}</small></header>
    <div class="ay-secici"><button data-eylem="ay-onceki" ${ilkAy && D.ay <= ilkAy ? 'disabled' : ''}>‹</button>
      <div><b>${e(p.ad)}</b><div class="soluk kucuk">${e(H.ayAraligiYaz(D.ay, a))}</div></div>
      <button data-eylem="ay-sonraki">›</button></div>
    <div class="kart"><div class="ikili"><span class="soluk kucuk">Gerçekleşen / plan</span><span class="soluk kucuk">Aylık çekiş = plan</span></div>
      <div class="ikili"><span class="buyuk sayi">${para(p.gercek)}</span><span class="sayi">/ ${para(p.plan)}</span></div>
      <div class="cubuk ${p.gercek > p.plan ? 'asim' : ''}"><i style="width:${p.plan ? Math.min(100, p.gercek / p.plan * 100).toFixed(1) : 0}%"></i></div>
      <div class="kucuk ${kalan < 0 ? 'kotu' : 'soluk'}" style="margin-top:6px">${kalan >= 0 ? `Plandan ${para(kalan)} kaldı` : `Plan ${para(-kalan)} aşıldı`}</div></div>
    <h2>Kovalar</h2><div class="kart ince">`;
  for (const k of p.kovalar) {
    const oran = k.plan ? k.gercek / k.plan : k.gercek ? 2 : 0;
    html += `<details class="kova"><summary class="satir"><span class="ad"><b>${e(k.ad)}</b>
      <div class="cubuk ${oran > 1 ? 'asim' : oran > 0.85 ? 'yakin' : ''}"><i style="width:${Math.min(100, oran * 100).toFixed(1)}%"></i></div></span>
      <span class="tutar">${para(k.gercek)} <span class="soluk">/ ${para(k.plan)}</span></span></summary>
      <div class="alt-liste">${k.kalemler.length ? k.kalemler.filter((x) => x.plan || x.kalem !== 'bos').map((x) => `<div class="ikili"><span>${e(x.ad)}</span><span class="sayi">${para(x.plan)}</span></div>`).join('') : '<div class="soluk">Plan kalemi yok</div>'}
      ${k.hareketler.length ? `<div class="soluk kucuk" style="margin-top:8px">${k.hareketler.length} harcama · ${para(k.hareketler.reduce((t, i) => t + H.butcePayi(i), 0))}</div>` : ''}</div></details>`;
  }
  html += `</div><h2>Haftalar</h2><div class="kart ince">`;
  for (const pzt of p.haftalar) {
    const h = H.haftaDurumu(v, pzt, bugun());
    const durum = h.kapali ? (h.fark >= 0 ? `<span class="iyi">${para(h.fark, { isaret: true })} artan bütçeye</span>` : `<span class="uyari">${para(h.fark)} artan bütçeden</span>`) : pzt <= bugun() ? 'sürüyor' : 'gelecek';
    html += `<div class="satir"><span class="ad"><b>${e(H.tarihYaz(pzt))} – ${e(H.tarihYaz(h.pazar))}</b><span>${durum}</span></span>
      <span class="tutar">${para(h.harcanan)} <span class="soluk">/ ${para(h.limit)}</span></span></div>`;
  }
  if (!p.haftalar.length) html += `<div class="bos">Bu ayda hafta yok.</div>`;
  html += `</div><button class="btn tam" data-ekran="sabitler" style="margin-top:8px">Sabit kalemleri düzenle</button>`;
  return html;
}

// ================================================================ HAREKETLER

function hareketlerCiz() {
  const v = D.veri;
  const a = ayar();
  if (!D.hareketAy) D.hareketAy = H.butceAyi(bugun(), a);
  const { bas, son } = H.ayAraligi(D.hareketAy, a);
  const liste = v.islemler.filter((i) => i.tarih >= bas && i.tarih <= son).sort(hareketSirasi);
  let html = `<header class="ust"><h1>Hareketler</h1><button class="kucuk-btn" data-ekran="ozet">‹ Özet</button></header>
    <div class="ay-secici"><button data-eylem="hareket-onceki">‹</button><div><b>${e(H.ayAdi(D.hareketAy))}</b><div class="soluk kucuk">${e(H.ayAraligiYaz(D.hareketAy, a))}</div></div><button data-eylem="hareket-sonraki">›</button></div>`;
  if (!liste.length) return `${html}<div class="kart"><div class="bos">Bu ayda kayıt yok.</div></div>`;
  let gun = null;
  for (const i of liste) {
    if (i.tarih !== gun) { if (gun) html += '</div>'; gun = i.tarih; html += `<h2>${e(H.tarihYaz(gun, true))}</h2><div class="kart ince">`; }
    html += hareketSatiri(i);
  }
  return `${html}</div>`;
}

function islemAc(id) {
  const i = D.veri.islemler.find((x) => x.id === id);
  if (!i) return;
  const v = D.veri;
  const kaynakli = i.odeme_id ? '<p class="soluk kucuk">Bu kayıt bir ödemeden/havaleden geldi. Silersen ödeme yeniden "yapılacak" olur.</p>' : '';
  let alanlar = `<div class="yan"><label class="alan"><span>Tutar</span><input name="tutar" inputmode="decimal" value="${e(kurusMetin(i.tutar))}" required></label>
    <label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${e(i.tarih)}" required></label></div>`;
  if (i.tur === 'gider') {
    const kart = v.hesaplar.find((h) => h.id === i.kaynak_id)?.tur === 'kart';
    alanlar += `${i.odeme_id ? '' : `<label class="alan"><span>Kategori</span><select name="kategori_id">${secenekler([...aktif(v.kategoriler).map((k) => [k.id, `${k.simge || ''} ${k.ad}`]), [H.ARTAN_KATEGORI, `✦ ${H.ARTAN_AD}`]], i.kategori_id)}</select></label>`}
      <div class="yan"><label class="alan"><span>Hesap</span><select name="kaynak_id">${hesapSecenekleri(harcanabilir, i.kaynak_id)}</select></label>
      ${kart ? `<label class="alan"><span>Taksit</span><select name="taksit">${secenekler([1, 2, 3, 4, 5, 6, 8, 9, 10, 12].map((n) => [n, n === 1 ? 'Peşin' : `${n} taksit`]), i.taksit)}</select></label>` : ''}</div>
      ${i.odeme_id ? '' : `<label class="anahtar"><span>Plan dışı (beklenmeyen payından)</span><input type="checkbox" name="plan_disi" ${i.plan_disi ? 'checked' : ''}></label>
      <label class="anahtar"><span>Ailem ödüyor (bütçeye girmez, aileden alacak)</span><input type="checkbox" name="aile" ${i.aile ? 'checked' : ''}></label>`}`;
  } else if (i.tur === 'gelir') {
    alanlar += `<div class="yan"><label class="alan"><span>Kaynak</span><select name="gelir_kaynagi">${secenekler(ayar().gelir_kaynaklari.map((k) => [k, k]), i.gelir_kaynagi)}</select></label>
      <label class="alan"><span>Hesap</span><select name="hedef_id">${hesapSecenekleri((h) => h.tur !== 'kart', i.hedef_id)}</select></label></div>
      <p class="soluk kucuk">Şelale payları değişmez; gerekirse havaleleri Özet'te düzelt.</p>`;
  } else if (i.tur === 'transfer') {
    alanlar += `<div class="yan"><label class="alan"><span>Gönderen</span><select name="kaynak_id">${hesapSecenekleri(null, i.kaynak_id)}</select></label>
      <label class="alan"><span>Alan</span><select name="hedef_id">${hesapSecenekleri(null, i.hedef_id)}</select></label></div>`;
  }
  alanlar += `<label class="alan"><span>Not</span><input name="notu" value="${e(i.notu || '')}" maxlength="200"></label>`;
  sayfaAc(`${sayfaBaslik('Kaydı düzenle')}${kaynakli}<form data-form="islem" data-id="${e(i.id)}" data-tur="${e(i.tur)}">${alanlar}
    <div class="btnlar"><button type="button" class="btn tehlike" data-eylem="islem-sil" data-id="${e(i.id)}">Sil</button>${i.tur === 'duzeltme' ? '' : '<button class="btn ana">Kaydet</button>'}</div></form>`);
}

async function islemKaydet(form) {
  const id = form.dataset.id;
  const tutar = H.paraOku(form.tutar.value);
  if (!(tutar > 0)) return bildirim('Tutarı kontrol et');
  const govde = { tutar, tarih: form.tarih.value, notu: form.notu.value || null };
  for (const ad of ['kategori_id', 'kaynak_id', 'hedef_id', 'gelir_kaynagi']) if (form[ad]) govde[ad] = form[ad].value;
  if (form.taksit) govde.taksit = Number(form.taksit.value);
  if (form.plan_disi) govde.plan_disi = form.plan_disi.checked ? 1 : 0;
  if (form.aile) govde.aile = form.aile.checked ? 1 : 0;
  if (H.kartNoVarMi(govde.notu)) return bildirim('Kart numarası yazılamaz');
  await istek(`/islem/${encodeURIComponent(id)}`, { yontem: 'PUT', govde });
  sayfaKapat();
  await yenile();
  ciz();
  bildirim('Güncellendi');
}

async function islemSil(id) {
  if (!confirm('Bu kayıt silinsin mi?')) return;
  sayfaKapat();
  await yazVeCiz(`/islem/${encodeURIComponent(id)}`, 'DELETE');
  bildirim('Silindi');
}

// ================================================================ CÜZDAN

function cuzdanCiz() {
  const v = D.veri;
  const b = H.bakiyeler(v);
  const hb = H.hedefBirikimleri(v);
  const hesaplar = aktif(v.hesaplar);
  const grup = (baslik, liste, satir) => liste.length ? `<h2>${baslik}</h2><div class="kart ince">${liste.map(satir).join('')}</div>` : '';
  const simge = { nakit: '💵', vadesiz: '🏦', havuz: '🌊', birikim: '🐖', yatirim: '📈', kart: '💳' };
  const hesapSatiri = (h) => `<button class="satir" data-eylem="hesap" data-id="${e(h.id)}"><span class="simge">${simge[h.tur]}</span>
    <span class="ad"><b>${e(h.ad)}</b><span>${e(H.HESAP_TURLERI[h.tur])}${h.banka ? ` · ${e(H.BANKALAR[h.banka])}` : ''}</span></span><span class="tutar">${para(b.get(h.id) || 0)}</span></button>`;
  const kartSatiri = (h) => {
    const bor = -(b.get(h.id) || 0);
    const oran = h.limit_tutar ? bor / h.limit_tutar : 0;
    return `<button class="satir" data-eylem="hesap" data-id="${e(h.id)}"><span class="simge">💳</span>
      <span class="ad"><b>${e(h.ad)}</b><span>${h.kesim_gunu ? `Kesim ${h.kesim_gunu} · son ödeme ${h.son_odeme_gunu}` : 'Kesim günü yok'}${h.banka ? ` · ${e(H.BANKALAR[h.banka])}` : ''}</span>
      ${h.limit_tutar ? `<div class="cubuk ${oran >= 0.8 ? 'asim' : oran > 0.6 ? 'yakin' : ''}"><i style="width:${Math.min(100, oran * 100).toFixed(1)}%"></i></div>` : ''}</span>
      <span class="tutar">${para(bor)}${h.limit_tutar ? `<div class="soluk kucuk">/ ${para(h.limit_tutar)}</div>` : ''}</span></button>`;
  };
  const hedefSatiri = (h) => {
    const t = hb.get(h.id) || 0;
    const oran = h.hedef_tutar ? t / h.hedef_tutar : 0;
    return `<button class="satir" data-eylem="hedef" data-id="${e(h.id)}"><span class="simge">🎯</span><span class="ad"><b>${e(h.ad)}${h.hafta_farki ? '<span class="etiket">hafta farkı</span>' : ''}</b>
      ${h.hedef_tutar ? `<div class="cubuk"><i style="width:${Math.min(100, oran * 100).toFixed(1)}%"></i></div>` : `<span>${e(hesapAdi(h.hesap_id))}</span>`}</span>
      <span class="tutar">${para(t)}${h.hedef_tutar ? `<div class="soluk kucuk">/ ${para(h.hedef_tutar)}</div>` : ''}</span></button>`;
  };
  const alacak = H.aileAlacagi(v);
  return `<header class="ust"><h1>Cüzdan</h1><small>net ${para(H.netVarlik(v))}</small></header>
    ${grup('Hesaplar', hesaplar.filter((h) => ['nakit', 'vadesiz'].includes(h.tur)), hesapSatiri)}
    ${grup('Birikim ve yatırım', hesaplar.filter((h) => ['havuz', 'birikim', 'yatirim'].includes(h.tur)), hesapSatiri)}
    ${grup('Kartlar', hesaplar.filter((h) => h.tur === 'kart'), kartSatiri)}
    ${alacak ? `<h2>Aile</h2><div class="kart ince"><button class="satir" data-eylem="aile-geldi"><span class="simge">👪</span>
      <span class="ad"><b>Aileden alacak</b><span>Ailem ödüyor işaretli harcamalar · gelince "Geldi"</span></span><span class="tutar">${para(alacak)}</span></button></div>` : ''}
    ${grup('Birikim hedefleri', aktif(v.hedefler), hedefSatiri)}
    <div class="btnlar"><button class="btn" data-eylem="hesap-duzenle">+ Hesap</button><button class="btn" data-eylem="hedef-duzenle">+ Hedef</button></div>`;
}

function hesapAc(id) {
  const v = D.veri;
  const h = v.hesaplar.find((x) => x.id === id);
  if (!h) return;
  const bakiye = H.bakiyeler(v).get(id) || 0;
  const kart = h.tur === 'kart';
  const hareketler = v.islemler.filter((i) => i.kaynak_id === id || i.hedef_id === id).sort(hareketSirasi).slice(0, 15);
  const yat = id === ayar().yatirim_hesabi ? H.yatirimOzeti(v, bugun()) : null;
  const ust = yat ? yatirimOzetiCiz(yat)
    : `<div class="kart"><div class="soluk kucuk">${kart ? 'Uygulamaya göre borç' : 'Uygulamaya göre bakiye'}</div><div class="buyuk sayi">${para(kart ? -bakiye : bakiye)}</div></div>`;
  sayfaAc(`${sayfaBaslik(h.ad)}${ust}
    <form data-form="esitle" data-id="${e(id)}" data-kart="${kart ? 1 : 0}">
      <label class="alan"><span>${yat ? 'Güncel değeri yaz' : kart ? 'Bankadaki güncel borç' : 'Bankadaki rakam'}</span><input name="bakiye" inputmode="decimal" placeholder="${e(kurusMetin(kart ? -bakiye : bakiye))}" required></label>
      <p class="soluk kucuk">${yat ? 'Uygulama fiyat çekmez, öneri vermez; değeri sen yazarsın. Fark kazanç olarak sayılır.' : 'Fark, "bakiye düzeltme" kaydı olur.'}</p>
      <div class="btnlar"><button type="button" class="btn" data-eylem="hesap-duzenle" data-id="${e(id)}">Düzenle</button><button class="btn ana">${yat ? 'Değeri güncelle' : 'Eşitle'}</button></div>
    </form>
    <h2>Son hareketler</h2><div class="kart ince">${hareketler.length ? hareketler.map(hareketSatiri).join('') : '<div class="bos">Hareket yok</div>'}</div>`, { tam: true });
}

// Yatırım hesabı: portföy değeri, kazanç, son 6 ayın katkısı.
function yatirimOzetiCiz(y) {
  const max = Math.max(1, ...y.aylar.map((a) => a.tutar));
  const kazanc = y.kazanc;
  return `<div class="etiket-k">Portföy değeri</div>
    <div class="buyuk">${paraParca(y.deger)}</div>
    ${y.yatirilan > 0 ? `<div class="${kazanc >= 0 ? 'iyi' : 'uyari'} kucuk">${kazanc >= 0 ? '▲' : '▼'} ${para(Math.abs(kazanc), { tam: true })} ${kazanc >= 0 ? 'kazanç' : 'kayıp'}${y.oran != null ? ` · %${(Math.abs(y.oran) * 100).toFixed(1).replace('.', ',')}` : ''}</div>` : ''}
    <div class="kart" style="margin-top:12px"><div class="etiket-k">Aylık katkı</div>
      <div class="cubuklar">${y.aylar.map((a, i) => `<i class="${i === y.aylar.length - 1 ? 'son' : ''}" style="height:${Math.max(0, (a.tutar / max) * 100).toFixed(0)}%"></i>`).join('')}</div>
      <div class="cubuk-ay">${y.aylar.map((a) => `<span>${e(H.ayAdi(a.ay).slice(0, 3))}</span>`).join('')}</div>
      <div class="dagit-satir"><span class="soluk">Toplam yatırılan</span><span class="serif">${para(y.yatirilan, { tam: true })}</span></div>
      ${y.buYil > 0 ? `<div class="dagit-satir"><span class="soluk">Bu yıl</span><span class="serif">${para(y.buYil, { tam: true })}${y.seri > 1 ? ` · ${y.seri} ay üst üste` : ''}</span></div>` : ''}
    </div>`;
}

async function hesapEsitle(form) {
  let k = H.paraOku(form.bakiye.value);
  if (k == null) return bildirim('Rakamı kontrol et');
  if (form.dataset.kart === '1') k = -k;
  const r = await istek(`/hesap/${encodeURIComponent(form.dataset.id)}/esitle`, { yontem: 'POST', govde: { bakiye: k, islem_id: `esitle:${kimlik()}` } });
  sayfaKapat();
  await yenile();
  ciz();
  bildirim(r.fark ? `Düzeltme: ${para(r.fark, { isaret: true })}` : 'Bakiye zaten tutuyor');
}

function hesapDuzenle(id) {
  const v = D.veri;
  const h = id ? v.hesaplar.find((x) => x.id === id) : { tur: 'vadesiz', ad: '' };
  const yeni = !id;
  sayfaAc(`${sayfaBaslik(yeni ? 'Yeni hesap' : 'Hesabı düzenle')}
    <form data-form="hesap" data-id="${e(id || '')}">
      <label class="alan"><span>Ad</span><input name="ad" value="${e(h.ad)}" maxlength="40" required></label>
      <label class="alan"><span>Tür</span><select name="tur" data-eylem-degis="hesap-tur" ${yeni ? '' : 'disabled'}>${secenekler(Object.entries(H.HESAP_TURLERI), h.tur)}</select></label>
      <div id="hesap-ek">${hesapEkAlanlari(h, yeni)}</div>
      <div class="btnlar">${yeni ? '' : `<button type="button" class="btn tehlike" data-eylem="hesap-kaldir" data-id="${e(id)}">Kaldır</button>`}<button class="btn ana">Kaydet</button></div>
    </form>`, { tam: true });
}

function hesapEkAlanlari(h, yeni) {
  const kart = h.tur === 'kart';
  let html = '';
  if (yeni) html += `<label class="alan"><span>${kart ? 'Bugünkü borç' : 'Bugünkü bakiye'}</span><input name="acilis" inputmode="decimal" placeholder="0"></label>`;
  if (kart) {
    html += `<label class="alan"><span>Limit</span><input name="limit_tutar" inputmode="decimal" value="${e(kurusMetin(h.limit_tutar))}"></label>
      <div class="yan"><label class="alan"><span>Kesim günü</span><input name="kesim_gunu" type="number" min="1" max="31" value="${e(h.kesim_gunu ?? '')}"></label>
      <label class="alan"><span>Son ödeme günü</span><input name="son_odeme_gunu" type="number" min="1" max="31" value="${e(h.son_odeme_gunu ?? '')}"></label></div>
      <label class="alan"><span>Ödendiği hesap</span><select name="odeme_hesap_id">${hesapSecenekleri((x) => x.tur === 'vadesiz' || x.tur === 'nakit', h.odeme_hesap_id, 'Harcama hesabı')}</select></label>`;
  }
  if (kart || h.tur === 'vadesiz') {
    html += `<label class="alan"><span>${kart ? 'Ekstre bankası 🚧 (okuyucu yakında)' : 'Banka'}</span><select name="banka">${secenekler(Object.entries(H.BANKALAR), h.banka, '—')}</select></label>`;
  }
  return html;
}

async function hesapKaydet(form) {
  const id = form.dataset.id || kimlik();
  const eski = D.veri.hesaplar.find((x) => x.id === form.dataset.id);
  const tur = eski?.tur || form.tur.value;
  const govde = { ...(eski || {}), ad: form.ad.value, tur };
  if (!eski) {
    const a = H.paraOku(form.acilis?.value || '0') ?? 0;
    govde.acilis_bakiye = tur === 'kart' ? -a : a;
    govde.sira = D.veri.hesaplar.length;
  }
  delete govde.devir;
  if (tur === 'kart') {
    govde.limit_tutar = H.paraOku(form.limit_tutar.value);
    govde.kesim_gunu = Number(form.kesim_gunu.value) || null;
    govde.son_odeme_gunu = Number(form.son_odeme_gunu.value) || null;
    govde.odeme_hesap_id = form.odeme_hesap_id.value || null;
  }
  if (form.banka) govde.banka = form.banka.value || null;
  await istek(`/hesap/${encodeURIComponent(id)}`, { yontem: 'PUT', govde });
  sayfaKapat();
  await yenile();
  ciz();
  bildirim('Kaydedildi');
}

// ---------------------------------------------------------------- hedefler

function hedefDuzenle(id) {
  const h = id ? D.veri.hedefler.find((x) => x.id === id) : { ad: '', hedef_tutar: 0, hesap_id: ayar().birikim_hesabi };
  sayfaAc(`${sayfaBaslik(id ? 'Hedefi düzenle' : 'Yeni hedef')}
    <form data-form="hedef" data-id="${e(id || '')}">
      <label class="alan"><span>Ad</span><input name="ad" value="${e(h.ad)}" maxlength="40" required></label>
      <label class="alan"><span>Hedef tutar</span><input name="hedef_tutar" inputmode="decimal" value="${e(kurusMetin(h.hedef_tutar || ''))}"></label>
      <label class="alan"><span>Hesap</span><select name="hesap_id">${hesapSecenekleri((x) => x.tur !== 'kart', h.hesap_id, '—')}</select></label>
      <label class="anahtar"><span>Hafta farkı buraya</span><input type="checkbox" name="hafta_farki" ${h.hafta_farki ? 'checked' : ''}></label>
      <div class="btnlar">${id ? `<button type="button" class="btn tehlike" data-eylem="hedef-kaldir" data-id="${e(id)}">Kaldır</button>` : ''}<button class="btn ana">Kaydet</button></div>
    </form>`);
}

async function hedefKaydet(form) {
  const id = form.dataset.id || kimlik();
  const eski = D.veri.hedefler.find((x) => x.id === id);
  const govde = { ...(eski || {}), ad: form.ad.value, hedef_tutar: H.paraOku(form.hedef_tutar.value || '0') || 0, hesap_id: form.hesap_id.value || null, hafta_farki: form.hafta_farki.checked ? 1 : 0 };
  delete govde.devir;
  await istek(`/hedef/${encodeURIComponent(id)}`, { yontem: 'PUT', govde });
  // Hafta farkını yalnız bir hedef alır.
  if (govde.hafta_farki) {
    for (const h of aktif(D.veri.hedefler)) {
      if (h.id !== id && h.hafta_farki) { const x = { ...h, hafta_farki: 0 }; delete x.devir; await istek(`/hedef/${encodeURIComponent(h.id)}`, { yontem: 'PUT', govde: x }); }
    }
  }
  sayfaKapat();
  await yenile();
  ciz();
}

// ================================================================ SABİT ÖDEMELER

const PERIYOTLAR = [[1, 'Her ay'], [3, '3 ayda bir'], [6, '6 ayda bir'], [12, 'Yılda bir']];

function sabitlerCiz() {
  const liste = aktif(D.veri.sabitler).sort((a, b) => a.gun - b.gun || a.ad.localeCompare(b.ad, 'tr'));
  const aylik = liste.reduce((t, s) => t + s.tutar / s.periyot, 0);
  return `<header class="ust"><h1>Sabit ödemeler</h1><button class="kucuk-btn" data-ekran="ay">‹ Ay</button></header>
    <div class="bilgi kucuk">Aylık karşılığı ${para(Math.round(aylik))}. Vadesi ayın 1–9'u arasında olan ödeme bir önceki bütçe ayından ödenir.</div>
    <div class="kart ince">${liste.length ? liste.map((s) => `<button class="satir" data-eylem="sabit" data-id="${e(s.id)}"><span class="simge">📄</span>
      <span class="ad"><b>${e(s.ad)}${s.otomatik ? '<span class="etiket">otomatik</span>' : ''}${s.degisken ? '<span class="etiket">değişken</span>' : ''}${s.is_gideri ? '<span class="etiket">iş</span>' : ''}${s.aile ? '<span class="etiket">ailem ödüyor</span>' : ''}</b>
      <span>${e(PERIYOTLAR.find((p) => p[0] === s.periyot)?.[1] || '')}, ${s.gun}'${ekGetir(s.gun)} · ${e(hesapAdi(s.hesap_id))}${s.son_vade ? ` · son ${e(H.tarihYaz(s.son_vade))}` : ''}</span></span>
      <span class="tutar">${para(s.tutar)}</span></button>`).join('') : '<div class="bos">Sabit ödeme yok.</div>'}</div>
    <button class="btn ana tam" data-eylem="sabit" style="margin-top:8px">+ Sabit ödeme</button>`;
}

// "5'i", "10'u", "20'si" … (Türkçe ünlü uyumu)
function ekGetir(n) {
  const son = n % 10;
  const onlar = n % 100 - son;
  if (son === 0) return { 10: 'u', 20: 'si', 30: 'u' }[onlar] || 'u';
  return { 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u' }[son];
}

function sonrakiAylar(n = 12) {
  const l = [];
  const ay = bugun().slice(0, 7);
  for (let i = 0; i < n; i++) { const a = H.ekleAy(ay, i); l.push([a, H.ayAdi(a)]); }
  return l;
}

// Sihirbazda `baz` başlangıç günüdür: geçmiş bir gün seçildiyse o günden bugüne düşen vadeler de oluşur.
function ilkAyHesapla(gun, periyot, secilen, baz = bugun()) {
  if (Number(periyot) > 1 && secilen) return secilen;
  return H.sabitIlkAy(gun, baz);
}

function sabitDuzenle(id) {
  const s = id ? D.veri.sabitler.find((x) => x.id === id) : { ad: '', tutar: '', gun: '', periyot: 1, hesap_id: ayar().harcama_hesabi };
  sayfaAc(`${sayfaBaslik(id ? 'Sabit ödemeyi düzenle' : 'Yeni sabit ödeme')}
    <form data-form="sabit" data-id="${e(id || '')}">
      <label class="alan"><span>Ad</span><input name="ad" value="${e(s.ad)}" maxlength="40" required placeholder="Kira, aidat, internet…"></label>
      <div class="yan"><label class="alan"><span>Tutar</span><input name="tutar" inputmode="decimal" value="${e(kurusMetin(s.tutar))}" required></label>
      <label class="alan"><span>Ayın kaçı</span><input name="gun" type="number" min="1" max="31" value="${e(s.gun)}" required></label></div>
      <div class="yan"><label class="alan"><span>Periyot</span><select name="periyot">${secenekler(PERIYOTLAR, s.periyot)}</select></label>
      <label class="alan"><span>Sıradaki ödeme ayı</span><select name="ilk_ay">${secenekler(sonrakiAylar(), s.ilk_ay && s.periyot > 1 ? H.sabitVadeleri(s, bugun(), H.ekleGun(bugun(), 400))[0]?.slice(0, 7) : '', 'Otomatik')}</select></label></div>
      <label class="alan"><span>Hangi hesaptan</span><select name="hesap_id">${hesapSecenekleri(harcanabilir, s.hesap_id)}</select></label>
      <label class="alan"><span>Son vade (kredi gibi biterse)</span><input type="date" name="son_vade" value="${e(s.son_vade || '')}"></label>
      <label class="anahtar"><span>Değişken tutar (fatura gibi)</span><input type="checkbox" name="degisken" ${s.degisken ? 'checked' : ''}></label>
      <label class="anahtar"><span>Otomatik (karttan/talimatla kendiliğinden ödenir)</span><input type="checkbox" name="otomatik" ${s.otomatik ? 'checked' : ''}></label>
      <label class="anahtar"><span>İş gideri</span><input type="checkbox" name="is_gideri" ${s.is_gideri ? 'checked' : ''}></label>
      <label class="anahtar"><span>Ailem ödüyor (bütçeye girmez, her vadede aileden alacak)</span><input type="checkbox" name="aile" ${s.aile ? 'checked' : ''}></label>
      <div class="btnlar">${id ? `<button type="button" class="btn tehlike" data-eylem="sabit-kaldir" data-id="${e(id)}">Kaldır</button>` : ''}<button class="btn ana">Kaydet</button></div>
    </form>`, { tam: true });
}

async function sabitKaydet(form) {
  const id = form.dataset.id || kimlik();
  const eski = D.veri.sabitler.find((x) => x.id === id);
  const tutar = H.paraOku(form.tutar.value);
  if (!(tutar > 0)) return bildirim('Tutarı kontrol et');
  const gun = Number(form.gun.value);
  const periyot = Number(form.periyot.value);
  let ilk_ay = eski?.ilk_ay;
  if (!eski || form.ilk_ay.value || Number(eski.periyot) !== periyot) ilk_ay = ilkAyHesapla(gun, periyot, form.ilk_ay.value);
  const govde = {
    ad: form.ad.value, tutar, gun, periyot, ilk_ay, hesap_id: form.hesap_id.value || null, son_vade: form.son_vade.value || null,
    degisken: form.degisken.checked ? 1 : 0, otomatik: form.otomatik.checked ? 1 : 0, is_gideri: form.is_gideri.checked ? 1 : 0, aile: form.aile.checked ? 1 : 0,
  };
  await istek(`/sabit/${encodeURIComponent(id)}`, { yontem: 'PUT', govde });
  sayfaKapat();
  await istek('/bakim', { yontem: 'POST', govde: {} });
  await yenile();
  ciz();
  bildirim('Kaydedildi');
}

// ================================================================ AYARLAR

function ayarlarCiz() {
  const v = D.veri;
  const a = ayar();
  const kat = aktif(v.kategoriler);
  const haftalik = kat.filter((k) => k.tur === 'haftalik' && !k.is_gideri).reduce((t, k) => t + k.limit_tutar, 0);
  const rol = (ad, alan, deger, filtre) => `<label class="alan"><span>${ad}</span><select name="${alan}">${hesapSecenekleri(filtre, deger, '—')}</select></label>`;
  return `<header class="ust"><h1>Ayarlar</h1><small>v${e(SURUM)}</small></header>
    <div class="kart ince">
      <button class="satir" data-ekran="kategoriler"><span class="simge">🏷️</span><span class="ad"><b>Kategoriler ve limitler</b><span>Haftalık toplam ${para(haftalik)}</span></span><span class="soluk">›</span></button>
      <button class="satir" data-ekran="sabitler"><span class="simge">📄</span><span class="ad"><b>Sabit ödemeler</b><span>${aktif(v.sabitler).length} kalem</span></span><span class="soluk">›</span></button>
      <button class="satir" data-ekran="cuzdan"><span class="simge">🎯</span><span class="ad"><b>Hesaplar ve hedefler</b><span>Cüzdan'da</span></span><span class="soluk">›</span></button>
    </div>
    <form data-form="ayar">
      <h2>Para akışı</h2><div class="kart">
        <div class="yan"><label class="alan"><span>Beklenen net maaş</span><input name="maas" inputmode="decimal" value="${e(kurusMetin(a.maas.tutar))}"></label>
        <label class="alan"><span>Aylık yatırım</span><input name="yatirim_tutari" inputmode="decimal" value="${e(kurusMetin(a.yatirim_tutari))}"></label></div>
        <label class="alan"><span>Beklenmeyen payı (ay)</span><input name="beklenmeyen" inputmode="decimal" value="${e(kurusMetin(a.beklenmeyen))}"></label>
        ${a.havuz_hesabi ? `<label class="alan"><span>Havuz hedefi: kaç aylık ihtiyaç</span><input name="havuz_ay" type="number" min="0" max="24" step="0.5" value="${e(a.havuz_ay)}"></label>
        <div class="soluk kucuk" style="margin:0 4px 6px">Şelale (toplam 100): birikim · yatırım · serbest</div>
        <div class="yan"><input name="sela_birikim" type="number" min="0" max="100" value="${a.sela.birikim}"><input name="sela_yatirim" type="number" min="0" max="100" value="${a.sela.yatirim}"><input name="sela_serbest" type="number" min="0" max="100" value="${a.sela.serbest}"></div>` : ''}
        <label class="alan" style="margin-top:12px"><span>Gelir kaynakları (virgülle)</span><input name="kaynaklar" value="${e(a.gelir_kaynaklari.join(', '))}"></label>
        <div class="soluk kucuk">Aylık ihtiyaç ${para(H.aylikIhtiyac(v))}. Maaş gelince bu ayın giderleri hesapta kalır, aylık yatırım (± artan bütçe) yatırıma havale olur.</div>
      </div>
      <h2>Hesapların görevi</h2><div class="kart">
        ${rol('Harcama hesabı', 'harcama_hesabi', a.harcama_hesabi, (h) => h.tur === 'vadesiz' || h.tur === 'nakit')}
        ${rol('Maaşın yattığı hesap', 'maas_hesap', a.maas.hesap_id, (h) => h.tur !== 'kart')}
        ${rol('Yatırım', 'yatirim_hesabi', a.yatirim_hesabi, (h) => h.tur !== 'kart')}
        ${a.havuz_hesabi ? rol('Gelir havuzu', 'havuz_hesabi', a.havuz_hesabi, (h) => h.tur !== 'kart') : ''}
        ${a.birikim_hesabi ? rol('Birikim', 'birikim_hesabi', a.birikim_hesabi, (h) => h.tur !== 'kart') : ''}
      </div>
      <button class="btn ana tam">Kaydet</button>
    </form>
    <h2>Yedek ve dosyalar</h2><div class="kart ince">
      <button class="satir" data-eylem="yedek-al"><span class="simge">☁️</span><span class="ad"><b>Yedek al</b><span>${a.son_yedek ? `Son yedek ${e(H.tarihYaz(a.son_yedek))}` : 'Henüz yedek yok'} · OneDrive / iCloud</span></span><span class="soluk">›</span></button>
      <button class="satir" data-eylem="yedek-yukle"><span class="simge">↺</span><span class="ad"><b>Yedekten geri yükle</b><span>Telefondaki kayıtların yerine geçer</span></span><span class="soluk">›</span></button>
      <button class="satir" data-eylem="excel"><span class="simge">📊</span><span class="ad"><b>Excel'e aktar</b><span>Bütün kayıtlar, okumak için (şifresiz)</span></span><span class="soluk">›</span></button>
      <label class="satir"><span class="simge">📥</span><span class="ad"><b>İçe aktar</b><span>Claude'un banka listesinden hazırladığı dosya</span></span><span class="soluk">›</span><input type="file" accept=".json,application/json" data-dosya="ice" hidden></label>
      ${a.deneme ? '<button class="satir" data-eylem="deneme-sil"><span class="simge">🧪</span><span class="ad"><b>Deneme verisini sil</b><span>Uydurma kayıtlar silinir, kuruluma dönülür</span></span><span class="soluk">›</span></button>' : ''}
    </div>
    <h2>Uygulama</h2><div class="kart">
      <div class="kucuk soluk">Bütçe ayı her ayın <b>${a.ay_baslangic_gunu}</b>'unda başlar (${e(H.ayAraligiYaz(H.butceAyi(bugun(), a), a))}). Değiştirmek için Claude'a söyle.</div>
      <div class="kucuk soluk" style="margin-top:6px">Kurulum: ${a.kurulum_tarihi ? e(H.tarihYaz(a.kurulum_tarihi, true)) : '—'}</div>
      <div class="kucuk soluk" style="margin-top:6px">🚧 Kart ekstresi okuyucu (Garanti, Yapı Kredi) yapılacak.</div>
      <div class="btnlar"><button class="btn" data-eylem="yenile">Yenile</button><button class="btn" data-eylem="kilitle">Kilitle</button></div>
    </div>`;
}

async function ayarKaydet(form) {
  const yatirim = H.paraOku(form.yatirim_tutari.value || '0');
  if (yatirim == null || yatirim < 0) return bildirim('Aylık yatırımı kontrol et');
  const govde = {
    maas: { tutar: H.paraOku(form.maas.value || '0') || 0, hesap_id: form.maas_hesap.value || null },
    yatirim_tutari: yatirim,
    beklenmeyen: H.paraOku(form.beklenmeyen.value || '0') || 0,
    gelir_kaynaklari: form.kaynaklar.value.split(',').map((x) => x.trim()).filter(Boolean),
    harcama_hesabi: form.harcama_hesabi.value || null, yatirim_hesabi: form.yatirim_hesabi.value || null,
  };
  // Eski (havuzlu) kurulum alanları yalnız ekrandaysa
  if (form.sela_birikim) {
    govde.sela = { birikim: Number(form.sela_birikim.value), yatirim: Number(form.sela_yatirim.value), serbest: Number(form.sela_serbest.value) };
    if (govde.sela.birikim + govde.sela.yatirim + govde.sela.serbest !== 100) return bildirim('Şelale oranlarının toplamı 100 olmalı');
    govde.havuz_ay = Number(form.havuz_ay.value);
  }
  if (form.havuz_hesabi) govde.havuz_hesabi = form.havuz_hesabi.value || null;
  if (form.birikim_hesabi) govde.birikim_hesabi = form.birikim_hesabi.value || null;
  await istek('/ayar', { yontem: 'PUT', govde });
  await yenile();
  ciz();
  bildirim('Ayarlar kaydedildi');
}

// ---------------------------------------------------------------- kategoriler

function kategorilerCiz() {
  const kat = aktif(D.veri.kategoriler).sort((a, b) => a.sira - b.sira || a.ad.localeCompare(b.ad, 'tr'));
  const grup = (baslik, liste, birim) => `<h2>${baslik}</h2><div class="kart ince">${liste.length ? liste.map((k) => `<button class="satir" data-eylem="kategori" data-id="${e(k.id)}">
    <span class="simge">${e(k.simge || '•')}</span><span class="ad"><b>${e(k.ad)}${k.hizli === 0 ? '<span class="etiket">gizli</span>' : ''}</b></span><span class="tutar">${para(k.limit_tutar)} <span class="soluk kucuk">${birim}</span></span></button>`).join('') : '<div class="bos">Yok</div>'}</div>`;
  return `<header class="ust"><h1>Kategoriler</h1><button class="kucuk-btn" data-ekran="ayarlar">‹ Ayarlar</button></header>
    ${grup('Haftalık', kat.filter((k) => k.tur === 'haftalik' && !k.is_gideri), '/ hafta')}
    ${grup('Aylık', kat.filter((k) => k.tur === 'aylik' && !k.is_gideri), '/ ay')}
    ${grup('İş giderleri', kat.filter((k) => k.is_gideri), '/ ay')}
    <button class="btn ana tam" data-eylem="kategori" style="margin-top:8px">+ Kategori</button>`;
}

function kategoriDuzenle(id) {
  const k = id ? D.veri.kategoriler.find((x) => x.id === id) : { ad: '', simge: '', tur: 'haftalik', limit_tutar: '', hizli: 1, sira: D.veri.kategoriler.length };
  sayfaAc(`${sayfaBaslik(id ? 'Kategoriyi düzenle' : 'Yeni kategori')}
    <form data-form="kategori" data-id="${e(id || '')}">
      <div class="yan"><label class="alan" style="flex:0 0 76px"><span>Simge</span><input name="simge" value="${e(k.simge || '')}" maxlength="8"></label>
      <label class="alan"><span>Ad</span><input name="ad" value="${e(k.ad)}" maxlength="30" required></label></div>
      <div class="yan"><label class="alan"><span>Tür</span><select name="tur">${secenekler([['haftalik', 'Haftalık'], ['aylik', 'Aylık']], k.tur)}</select></label>
      <label class="alan"><span>Limit</span><input name="limit_tutar" inputmode="decimal" value="${e(kurusMetin(k.limit_tutar))}"></label></div>
      <label class="anahtar"><span>İş gideri (kişisel bütçeye karışmaz, aylık sayılır)</span><input type="checkbox" name="is_gideri" ${k.is_gideri ? 'checked' : ''}></label>
      <label class="anahtar"><span>Hızlı girişte göster</span><input type="checkbox" name="hizli" ${k.hizli !== 0 ? 'checked' : ''}></label>
      <label class="alan"><span>Sıra</span><input name="sira" type="number" value="${e(k.sira ?? 0)}"></label>
      <div class="btnlar">${id ? `<button type="button" class="btn tehlike" data-eylem="kategori-kaldir" data-id="${e(id)}">Kaldır</button>` : ''}<button class="btn ana">Kaydet</button></div>
    </form>`);
}

async function kategoriKaydet(form) {
  const id = form.dataset.id || kimlik();
  const govde = {
    ad: form.ad.value, simge: form.simge.value, tur: form.tur.value, limit_tutar: H.paraOku(form.limit_tutar.value || '0') || 0,
    is_gideri: form.is_gideri.checked ? 1 : 0, hizli: form.hizli.checked ? 1 : 0, sira: Number(form.sira.value) || 0,
  };
  await istek(`/kategori/${encodeURIComponent(id)}`, { yontem: 'PUT', govde });
  sayfaKapat();
  await yenile();
  ciz();
}

// ================================================================ KURULUM SİHİRBAZI

const SIHIRBAZ_ADIMLARI = ['Gelir', 'Hesaplar', 'Haftalık bütçe', 'Sabit ödemeler', 'Yatırım', 'Kontrol'];

const ONERILEN_KATEGORILER = [
  ['🛒', 'Market', 'haftalik'], ['🍽️', 'Dışarıda yemek', 'haftalik'], ['⛽', 'Ulaşım', 'haftalik'], ['☕', 'Kahve', 'haftalik'], ['🎬', 'Eğlence', 'haftalik'],
  ['👕', 'Kıyafet', 'aylik'], ['🏠', 'Ev eşyası', 'aylik'], ['💊', 'Sağlık', 'aylik'], ['💈', 'Kişisel bakım', 'aylik'], ['🎁', 'Hediye', 'aylik'],
  ['💼', 'İş', 'aylik', 1],
];
const ONERILEN_SABITLER = ['Kira', 'Aidat', 'Elektrik', 'Su', 'Doğalgaz', 'İnternet', 'Telefon', 'Kredi taksiti', 'Sigorta', 'Abonelik'];
const HESAP_SABLONLARI = { nakit: 'Nakit', vadesiz: 'Vadesiz hesap', birikim: 'Birikim', yatirim: 'Yatırım', kart: 'Kredi kartı' };

// Yarım kalan sihirbaz taslağı bakiyeler içerdiği için kayıtlarla birlikte şifreli durur (/taslak).
async function sihirbazAc() {
  $('#menu').hidden = true;
  const { taslak } = await istek('/taslak');
  D.sihirbaz = taslak || {
    adim: 0,
    baslangic: bugun(),
    maas: '',
    yatirim: '',
    kaynaklar: 'Maaş, Ek gelir, Komisyon, Satış',
    hesaplar: [],
    roller: {},
    kategoriler: ONERILEN_KATEGORILER.map(([simge, ad, tur, is], i) => ({ id: kimlik(), simge, ad, tur, limit: '', is_gideri: is ? 1 : 0, sira: i })),
    beklenmeyen: '',
    sabitler: [],
    hedefler: [],
  };
  sihirbazCiz();
}

function sihirbazKaydetTaslak() {
  guvenli(() => istek('/taslak', { yontem: 'PUT', govde: D.sihirbaz }));
}

function sihirbazCiz() {
  const S = D.sihirbaz;
  const ad = SIHIRBAZ_ADIMLARI[S.adim];
  let govde = '';
  if (S.adim === 0) govde = sAdimGelir(S);
  if (S.adim === 1) govde = sAdimHesaplar(S);
  if (S.adim === 2) govde = sAdimKategoriler(S);
  if (S.adim === 3) govde = sAdimSabitler(S);
  if (S.adim === 4) govde = sAdimYatirim(S);
  if (S.adim === 5) govde = sAdimKontrol(S);
  $('#uyg').innerHTML = `<header class="ust"><h1>Kurulum</h1><small>${S.adim + 1} / ${SIHIRBAZ_ADIMLARI.length}</small></header>
    <div class="adimlar">${SIHIRBAZ_ADIMLARI.map((_, i) => `<i class="${i <= S.adim ? 'tamam' : ''}"></i>`).join('')}</div>
    <h2 style="margin-top:4px">${e(ad)}</h2>
    <form id="sihirbaz" data-form="sihirbaz">${govde}
      <div class="btnlar">${S.adim > 0 ? '<button type="button" class="btn" data-eylem="s-geri">Geri</button>' : ''}
      <button class="btn ana">${S.adim === SIHIRBAZ_ADIMLARI.length - 1 ? 'Kurulumu bitir' : 'İleri'}</button></div>
    </form>`;
  window.scrollTo(0, 0);
}

const sGirdi = (ad, deger, ek = '') => `<input name="${ad}" value="${e(deger ?? '')}" ${ek}>`;

function sAdimGelir(S) {
  return `<div class="bilgi kucuk">Bütçe ayı her ayın <b>10</b>'unda başlar ve ertesi ayın 9'unda biter: maaş gününe göre. Maaş birkaç gün erken yatarsa da o ayın geliri sayılır.</div>
    <div class="kart">
      <label class="alan"><span>Başlangıç günü (en çok 60 gün geriye)</span>${sGirdi('baslangic', S.baslangic, `type="date" min="${H.ekleGun(bugun(), -60)}" max="${bugun()}"`)}</label>
      <p class="soluk kucuk" style="margin-top:-6px">Geçmiş bir gün seçersen bakiyeleri o günkü hâliyle yaz; o günden bu yana harcamalar sonradan eklenir.</p>
      <label class="alan"><span>Beklenen net maaş</span>${sGirdi('maas', S.maas, 'inputmode="decimal" placeholder="0"')}</label>
      <label class="alan"><span>Gelir kaynakları (virgülle; düzensiz ek gelirler için)</span>${sGirdi('kaynaklar', S.kaynaklar)}</label>
      <p class="soluk kucuk">Maaş gelince o ayın giderleri hesapta kalır, aylık yatırım tutarı yatırıma havale olur, kalanı serbesttir.</p>
    </div>
    <button type="button" class="bag altin" data-eylem="deneme-kur" style="width:100%;text-align:center">Önce deneme verisiyle dene</button>`;
}

function sAdimHesaplar(S) {
  const blok = (h, i) => {
    const kart = h.tur === 'kart';
    const odemeHesaplari = S.hesaplar.filter((x) => x.tur === 'vadesiz' || x.tur === 'nakit');
    return `<div class="kart"><div class="ikili"><b>${e(H.HESAP_TURLERI[h.tur])}</b><button type="button" class="kucuk-btn" data-eylem="s-sil" data-liste="hesaplar" data-i="${i}">Kaldır</button></div>
      <div class="yan" style="margin-top:8px"><label class="alan"><span>Ad</span>${sGirdi(`h${i}_ad`, h.ad, 'maxlength="40" required')}</label>
      <label class="alan"><span>${kart ? 'Borç' : 'Bakiye'} (${e(H.tarihYaz(S.baslangic || bugun()))})</span>${sGirdi(`h${i}_bakiye`, h.bakiye, 'inputmode="decimal" placeholder="0"')}</label></div>
      ${kart ? `<div class="yan"><label class="alan"><span>Limit</span>${sGirdi(`h${i}_limit`, h.limit, 'inputmode="decimal"')}</label>
        <label class="alan"><span>Kesim günü</span>${sGirdi(`h${i}_kesim`, h.kesim, 'type="number" min="1" max="31"')}</label>
        <label class="alan"><span>Son ödeme</span>${sGirdi(`h${i}_sonodeme`, h.sonodeme, 'type="number" min="1" max="31"')}</label></div>
        <div class="yan"><label class="alan"><span>Ödendiği hesap</span><select name="h${i}_odeme">${secenekler(odemeHesaplari.map((x) => [x.id, x.ad || HESAP_SABLONLARI[x.tur]]), h.odeme, 'Harcama hesabı')}</select></label>
        <label class="alan"><span>Ekstre bankası 🚧</span><select name="h${i}_banka">${secenekler(Object.entries(H.BANKALAR), h.banka, '—')}</select></label></div>` : ''}
      ${h.tur === 'vadesiz' ? `<label class="alan"><span>Banka</span><select name="h${i}_banka">${secenekler(Object.entries(H.BANKALAR), h.banka, '—')}</select></label>` : ''}
    </div>`;
  };
  const rol = (etiket, alan, filtre) => {
    const l = S.hesaplar.filter(filtre);
    return `<label class="alan"><span>${etiket}</span><select name="rol_${alan}">${secenekler(l.map((x) => [x.id, x.ad || HESAP_SABLONLARI[x.tur]]), S.roller[alan], '—')}</select></label>`;
  };
  return `<div class="bilgi kucuk">Başlangıç günündeki (${e(H.tarihYaz(S.baslangic || bugun()))}) <b>gerçek</b> bakiyeleri yaz (kartta borç). Kart numarası, şifre istenmez.</div>
    ${S.hesaplar.map(blok).join('') || '<div class="kart"><div class="bos">Aşağıdan hesap ekle.</div></div>'}
    <div class="cipler">${Object.entries(HESAP_SABLONLARI).map(([t, a]) => `<button type="button" class="cip" data-eylem="s-hesap-ekle" data-tur="${t}">+ ${e(a)}</button>`).join('')}</div>
    ${S.hesaplar.length ? `<h2>Hesapların görevi</h2><div class="kart">
      ${rol('Harcama hesabı', 'harcama', (x) => x.tur === 'vadesiz' || x.tur === 'nakit')}
      ${rol('Maaşın yattığı hesap', 'maas', (x) => x.tur !== 'kart')}
      ${rol('Yatırım', 'yatirim', (x) => x.tur !== 'kart')}</div>` : ''}`;
}

function sAdimKategoriler(S) {
  return `<div class="bilgi kucuk">Haftalık kategoriler pazartesi–pazar sayılır; artan para "Artan bütçe"de toplanır, aşım sonraki haftanın limitlerinden kısılır. Aylıklar bütçe ayı boyunca. Kullanmadığını kaldır.</div>
    <div class="kart">${S.kategoriler.map((k, i) => `<div class="yan" style="align-items:center;margin-bottom:8px">
      ${sGirdi(`k${i}_simge`, k.simge, 'style="flex:0 0 52px;text-align:center" maxlength="8"')}
      ${sGirdi(`k${i}_ad`, k.ad, 'maxlength="30" required')}
      <select name="k${i}_tur" style="flex:0 0 104px">${secenekler([['haftalik', 'Haftalık'], ['aylik', k.is_gideri ? 'Aylık · iş' : 'Aylık']], k.tur)}</select>
      ${sGirdi(`k${i}_limit`, k.limit, 'inputmode="decimal" placeholder="Limit" style="flex:0 0 92px"')}
      <button type="button" class="kapat" style="flex:0 0 32px" data-eylem="s-sil" data-liste="kategoriler" data-i="${i}">×</button></div>`).join('')}
      <button type="button" class="kucuk-btn" data-eylem="s-kategori-ekle">+ Kategori</button></div>
    <div class="kart"><label class="alan"><span>Beklenmeyen payı (aylık; plan dışı harcamalar buradan)</span>${sGirdi('beklenmeyen', S.beklenmeyen, 'inputmode="decimal" placeholder="0"')}</label></div>`;
}

function sAdimSabitler(S) {
  const hesaplar = S.hesaplar.filter((x) => ['nakit', 'vadesiz', 'kart'].includes(x.tur)).map((x) => [x.id, x.ad]);
  return `<div class="bilgi kucuk">Kira, aidat, faturalar, abonelikler, kredi taksiti. Faturalar için ortalama tutarı yaz ve "değişken" işaretle. Karttan kendiliğinden çekilen abonelik "otomatik"tir.</div>
    ${S.sabitler.map((s, i) => `<div class="kart"><div class="ikili"><b>${e(s.ad || 'Sabit ödeme')}</b><button type="button" class="kucuk-btn" data-eylem="s-sil" data-liste="sabitler" data-i="${i}">Kaldır</button></div>
      <div class="yan" style="margin-top:8px"><label class="alan"><span>Ad</span>${sGirdi(`s${i}_ad`, s.ad, 'maxlength="40" required')}</label>
      <label class="alan"><span>Tutar</span>${sGirdi(`s${i}_tutar`, s.tutar, 'inputmode="decimal" required')}</label></div>
      <div class="yan"><label class="alan"><span>Ayın kaçı</span>${sGirdi(`s${i}_gun`, s.gun, 'type="number" min="1" max="31" required')}</label>
      <label class="alan"><span>Periyot</span><select name="s${i}_periyot">${secenekler(PERIYOTLAR, s.periyot || 1)}</select></label></div>
      <div class="yan"><label class="alan"><span>Hesap</span><select name="s${i}_hesap">${secenekler(hesaplar, s.hesap || S.roller.harcama)}</select></label>
      <label class="alan"><span>Sıradaki ay (3/6/12 ay için)</span><select name="s${i}_ilk">${secenekler(sonrakiAylar(), s.ilk, 'Otomatik')}</select></label></div>
      <label class="alan"><span>Son vade (taksit, kredi gibi biterse; sonra kendiliğinden durur)</span>${sGirdi(`s${i}_sonvade`, s.sonvade, 'type="date"')}</label>
      <div class="cipler">
        <label class="cip"><input type="checkbox" name="s${i}_degisken" ${s.degisken ? 'checked' : ''}> değişken</label>
        <label class="cip"><input type="checkbox" name="s${i}_otomatik" ${s.otomatik ? 'checked' : ''}> otomatik</label>
        <label class="cip"><input type="checkbox" name="s${i}_is" ${s.is_gideri ? 'checked' : ''}> iş gideri</label>
        <label class="cip"><input type="checkbox" name="s${i}_aile" ${s.aile ? 'checked' : ''}> ailem ödüyor</label></div></div>`).join('')}
    <div class="cipler">${ONERILEN_SABITLER.map((a) => `<button type="button" class="cip" data-eylem="s-sabit-ekle" data-ad="${e(a)}">+ ${e(a)}</button>`).join('')}
      <button type="button" class="cip" data-eylem="s-sabit-ekle" data-ad="">+ Diğer</button></div>`;
}

function sAdimYatirim(S) {
  return `<div class="bilgi kucuk">Her maaşta bu ayın giderleri hesapta kalır; buradaki tutar yatırıma havale olur. Haftalardan artan para (artan bütçe) ay sonunda bu tutara eklenir, eksikse düşülür. Maaş günü ekranda değiştirebilirsin.</div>
    <div class="kart">
      <label class="alan"><span>Aylık yatırım</span>${sGirdi('yatirim', S.yatirim, 'inputmode="decimal" placeholder="0"')}</label>
      ${S.roller.yatirim ? '' : '<p class="uyari kucuk">Yatırım hesabı seçilmedi (Hesaplar adımı): havale oluşmaz.</p>'}
    </div>`;
}

// Taslaktan sunucuya gidecek kurulum verisi.
function sihirbazVerisi(S) {
  const k = (x) => H.paraOku(x || '0') || 0;
  const hesaplar = S.hesaplar.map((h, i) => ({
    id: h.id, ad: h.ad || HESAP_SABLONLARI[h.tur], tur: h.tur, acilis_bakiye: h.tur === 'kart' ? -k(h.bakiye) : k(h.bakiye),
    limit_tutar: h.tur === 'kart' ? k(h.limit) || null : null, kesim_gunu: Number(h.kesim) || null, son_odeme_gunu: Number(h.sonodeme) || null,
    odeme_hesap_id: h.odeme || null, banka: h.banka || null, sira: i,
  }));
  const kategoriler = S.kategoriler.map((x, i) => ({ id: x.id, ad: x.ad, simge: x.simge, tur: x.is_gideri ? 'aylik' : x.tur, limit_tutar: k(x.limit), is_gideri: x.is_gideri ? 1 : 0, hizli: 1, sira: i }));
  const sabitler = S.sabitler.map((s) => ({
    id: s.id, ad: s.ad, tutar: k(s.tutar), gun: Number(s.gun), periyot: Number(s.periyot) || 1, ilk_ay: ilkAyHesapla(s.gun, s.periyot, s.ilk, S.baslangic || bugun()),
    son_vade: s.sonvade || null, hesap_id: s.hesap || S.roller.harcama || null, degisken: s.degisken ? 1 : 0, otomatik: s.otomatik ? 1 : 0, is_gideri: s.is_gideri ? 1 : 0, aile: s.aile ? 1 : 0,
  }));
  const hedefler = S.hedefler.map((h, i) => ({ id: h.id, ad: h.ad, hedef_tutar: k(h.hedef), hesap_id: h.hesap || S.roller.birikim || null, hafta_farki: h.hafta_farki ? 1 : 0, sira: i }));
  const ayarlar = {
    ay_baslangic_gunu: 10, maas: { tutar: k(S.maas), hesap_id: S.roller.maas || null },
    gelir_kaynaklari: S.kaynaklar.split(',').map((x) => x.trim()).filter(Boolean),
    beklenmeyen: k(S.beklenmeyen), havuz_ay: 0, yatirim_tutari: k(S.yatirim),
    harcama_hesabi: S.roller.harcama || null, yatirim_hesabi: S.roller.yatirim || null,
  };
  return { baslangic: S.baslangic || bugun(), ayar: ayarlar, hesaplar, kategoriler, sabitler, hedefler };
}

function sAdimKontrol(S) {
  const g = sihirbazVerisi(S);
  const bas = g.baslangic;
  const veri = { ...g, ayar: { ...g.ayar, kurulum_tarihi: bas }, islemler: [], odemeler: [], haftalar: [], ayPlanlari: [] };
  const ay = H.butceAyi(bas, veri.ayar);
  const p = H.ayPlani(veri, ay);
  const tamAy = H.ayPlani({ ...veri, ayar: { ...veri.ayar, kurulum_tarihi: null } }, H.ekleAy(ay, 1)).plan;
  const hafta = H.haftaDurumu(veri, H.pazartesi(bugun()), bugun());
  const kalan = veri.ayar.maas.tutar - tamAy - veri.ayar.yatirim_tutari;
  return `<div class="bilgi kucuk">Başlangıç ${e(H.tarihYaz(bas, true))}. Bu bütçe ayı ${e(H.ayAraligiYaz(ay, veri.ayar))}; ilk hafta ve aylık limitler kalan günlere göre sayılır.</div>
    <div class="kart">
      <div class="ikili"><span>Beklenen maaş</span><b class="serif">${para(veri.ayar.maas.tutar)}</b></div>
      <div class="ikili"><span>Tam bir ayın giderleri</span><b class="serif">${para(tamAy)}</b></div>
      <div class="ikili"><span>Aylık yatırım</span><b class="serif altin">${para(veri.ayar.yatirim_tutari)}</b></div>
      <div class="ikili ayrac"><span>Maaştan serbest kalan</span><b class="serif ${kalan < 0 ? 'uyari' : ''}">${para(kalan)}</b></div>
      <div class="ikili"><span>Bu hafta harcanabilir</span><b class="serif">${para(hafta.limit)}</b></div>
    </div>
    <h2>${e(H.ayAdi(ay))} planı</h2>
    <div class="kart ince">${p.kovalar.map((k) => `<div class="satir"><span class="ad"><b>${e(k.ad)}</b></span><span class="tutar">${para(k.plan)}</span></div>`).join('')}
      <div class="satir"><span class="ad"><b>Toplam</b></span><span class="tutar">${para(p.plan)}</span></div></div>
    ${kalan < 0 ? '<div class="dikkat">Maaş, giderleri ve yatırımı karşılamıyor.</div>' : ''}`;
}

// Formdaki değerleri taslağa al (yeniden çizmeden önce, yoksa yazılanlar kaybolur).
function sihirbazTopla() {
  const S = D.sihirbaz;
  const f = $('#sihirbaz');
  if (!f) return;
  const d = (ad) => f.elements[ad];
  const v = (ad) => d(ad)?.value ?? '';
  const c = (ad) => !!d(ad)?.checked;
  if (S.adim === 0) { S.baslangic = v('baslangic') || bugun(); S.maas = v('maas'); S.kaynaklar = v('kaynaklar'); }
  if (S.adim === 1) {
    S.hesaplar.forEach((h, i) => {
      h.ad = v(`h${i}_ad`); h.bakiye = v(`h${i}_bakiye`);
      if (h.tur === 'kart') { h.limit = v(`h${i}_limit`); h.kesim = v(`h${i}_kesim`); h.sonodeme = v(`h${i}_sonodeme`); h.odeme = v(`h${i}_odeme`); }
      if (d(`h${i}_banka`)) h.banka = v(`h${i}_banka`);
    });
    for (const r of ['harcama', 'maas', 'yatirim']) if (d(`rol_${r}`)) S.roller[r] = v(`rol_${r}`);
  }
  if (S.adim === 2) {
    S.kategoriler.forEach((k, i) => { k.simge = v(`k${i}_simge`); k.ad = v(`k${i}_ad`); k.tur = v(`k${i}_tur`); k.limit = v(`k${i}_limit`); });
    S.beklenmeyen = v('beklenmeyen');
  }
  if (S.adim === 3) {
    S.sabitler.forEach((s, i) => {
      s.ad = v(`s${i}_ad`); s.tutar = v(`s${i}_tutar`); s.gun = v(`s${i}_gun`); s.periyot = Number(v(`s${i}_periyot`)) || 1;
      s.hesap = v(`s${i}_hesap`); s.ilk = v(`s${i}_ilk`); s.sonvade = v(`s${i}_sonvade`); s.degisken = c(`s${i}_degisken`); s.otomatik = c(`s${i}_otomatik`); s.is_gideri = c(`s${i}_is`); s.aile = c(`s${i}_aile`);
    });
  }
  if (S.adim === 4) S.yatirim = v('yatirim');
  sihirbazKaydetTaslak();
}

function rolleriTamamla(S, ekleme = false) {
  const tek = (filtre) => { const l = S.hesaplar.filter(filtre); return l.length ? l[0].id : ''; };
  const tur = (id) => S.hesaplar.find((h) => h.id === id)?.tur;
  // Hesap eklenirken: harcama/maaş nakde oturmuşsa ve vadesiz eklendiyse vadesize geç.
  if (ekleme && tek((x) => x.tur === 'vadesiz')) {
    if (tur(S.roller.harcama) === 'nakit') { if (S.roller.maas === S.roller.harcama) S.roller.maas = ''; S.roller.harcama = ''; }
  }
  for (const r of Object.keys(S.roller)) if (S.roller[r] && !tur(S.roller[r])) S.roller[r] = ''; // silinen hesap
  S.roller.harcama ||= tek((x) => x.tur === 'vadesiz') || tek((x) => x.tur === 'nakit');
  S.roller.maas ||= S.roller.harcama;
  S.roller.yatirim ||= tek((x) => x.tur === 'yatirim');
}

function sihirbazDogrula(S) {
  const sayi = (x) => x === '' || x == null || H.paraOku(x) != null;
  if (S.adim === 0) {
    if (!S.baslangic || S.baslangic > bugun() || S.baslangic < H.ekleGun(bugun(), -60)) return 'Başlangıç günü bugün ya da son 60 gün içinde olmalı';
    if (!sayi(S.maas)) return 'Maaş tutarını kontrol et';
  }
  if (S.adim === 1) {
    if (!S.hesaplar.some((h) => h.tur === 'vadesiz' || h.tur === 'nakit')) return 'En az bir vadesiz hesap ya da nakit ekle';
    for (const h of S.hesaplar) {
      if (!sayi(h.bakiye) || (h.tur === 'kart' && !sayi(h.limit))) return `${h.ad || 'Hesap'}: rakamı kontrol et`;
      if (H.kartNoVarMi(h.ad)) return 'Kart numarası yazılamaz';
    }
    if (!S.roller.harcama) return 'Harcama hesabını seç';
  }
  if (S.adim === 2) {
    if (!S.kategoriler.length) return 'En az bir kategori gerekli';
    for (const k of S.kategoriler) if (!k.ad || !sayi(k.limit)) return `${k.ad || 'Kategori'}: adı ve limiti kontrol et`;
    if (!sayi(S.beklenmeyen)) return 'Beklenmeyen payını kontrol et';
  }
  if (S.adim === 3) {
    for (const s of S.sabitler) {
      if (!s.ad || !(H.paraOku(s.tutar) > 0) || !(Number(s.gun) >= 1 && Number(s.gun) <= 31)) return `${s.ad || 'Sabit ödeme'}: ad, tutar ve günü kontrol et`;
    }
  }
  if (S.adim === 4 && !sayi(S.yatirim)) return 'Yatırım tutarını kontrol et';
  return null;
}

async function sihirbazIleri() {
  sihirbazTopla();
  const S = D.sihirbaz;
  const hata = sihirbazDogrula(S);
  if (hata) return bildirim(hata);
  if (S.adim === 1) rolleriTamamla(S);
  if (S.adim < SIHIRBAZ_ADIMLARI.length - 1) {
    S.adim++;
    if (S.adim === 1) rolleriTamamla(S);
    sihirbazKaydetTaslak();
    return sihirbazCiz();
  }
  const btn = $('#sihirbaz button.ana');
  if (btn) btn.disabled = true;
  try {
    await istek('/kurulum', { yontem: 'POST', govde: sihirbazVerisi(S) });
  } catch (err) {
    if (btn) btn.disabled = false;
    return hataGoster(err);
  }
  D.sihirbaz = null;
  await yenile();
  anaEkran();
  bildirim('Kurulum tamam. İyi bütçeler!');
}

function sihirbazEylem(eylem, el) {
  sihirbazTopla();
  const S = D.sihirbaz;
  if (eylem === 's-geri') S.adim = Math.max(0, S.adim - 1);
  if (eylem === 's-sil') { S[el.dataset.liste].splice(Number(el.dataset.i), 1); if (el.dataset.liste === 'hesaplar') rolleriTamamla(S); }
  if (eylem === 's-hesap-ekle') { S.hesaplar.push({ id: kimlik(), tur: el.dataset.tur, ad: HESAP_SABLONLARI[el.dataset.tur], bakiye: '' }); rolleriTamamla(S, el.dataset.tur === 'vadesiz'); }
  if (eylem === 's-kategori-ekle') S.kategoriler.push({ id: kimlik(), simge: '', ad: '', tur: 'haftalik', limit: '', sira: S.kategoriler.length });
  if (eylem === 's-sabit-ekle') S.sabitler.push({ id: kimlik(), ad: el.dataset.ad, tutar: '', gun: '', periyot: el.dataset.ad === 'Sigorta' ? 12 : 1, degisken: ['Elektrik', 'Su', 'Doğalgaz'].includes(el.dataset.ad) });
  if (eylem === 's-hedef-ekle') S.hedefler.push({ id: kimlik(), ad: '', hedef: '', hafta_farki: S.hedefler.length === 0 });
  sihirbazKaydetTaslak();
  sihirbazCiz();
}

// ================================================================ olaylar

// Ayarlar başlığında görünür; her yayında elle artırılır (1.0 → 1.1 …).
const SURUM = '1.2';

const EYLEMLER = {
  kapat: () => sayfaKapat(),
  yeniden: () => basla(),
  giris: () => girisAc(),
  'pin-tus': (el) => pinTus(el.dataset.t),
  'maas-geldi': () => { const m = H.maasDurumu(D.veri, bugun()); girisAc({ sekme: 'gelir', kaynak: 'Maaş', tutar: m.beklenen ? kurusMetin(m.beklenen).replace(/\./g, '') : '' }); },
  odeme: (el) => odemeAc(el.dataset.id),
  'odeme-atla': (el) => guvenli(() => odemeAtla(el.dataset.id)),
  islem: (el) => islemAc(el.dataset.id),
  'islem-sil': (el) => guvenli(() => islemSil(el.dataset.id)),
  tus: (el) => girisTus(el.dataset.t),
  'giris-sekme': (el) => { D.giris.sekme = el.dataset.s; girisCiz(); },
  'giris-hesap': (el) => { D.giris.hesap = el.dataset.id; D.giris.taksit = 1; girisCiz(); },
  'giris-plandisi': () => { D.giris.plan_disi = !D.giris.plan_disi; girisCiz(); },
  'giris-ayrinti': () => { D.giris.ayrinti = !D.giris.ayrinti; girisCiz(); },
  'giris-kaynak': (el) => {
    D.giris.kaynak = el.dataset.k;
    if (el.dataset.k === 'Maaş' && ayar().maas?.hesap_id) D.giris.gelirHesap = ayar().maas.hesap_id;
    girisCiz();
  },
  'giris-kategori': (el) => guvenli(() => giderKaydet(el.dataset.id)),
  'transfer-kaydet': () => guvenli(transferKaydet),
  'sela-gor': () => gelirDevam(),
  'dagitim-arti': () => dagitimDegistir(1),
  'dagitim-eksi': () => dagitimDegistir(-1),
  'dagitim-onayla': () => guvenli(dagitimOnayla),
  kisma: () => kismaAc(),
  'kisma-arti': (el) => kismaDegistir(el.dataset.id, 1),
  'kisma-eksi': (el) => kismaDegistir(el.dataset.id, -1),
  'kisma-onayla': () => guvenli(kismaOnayla),
  'aile-geldi': () => aileAc(),
  'giris-aile': () => { D.giris.aile = !D.giris.aile; girisCiz(); },
  'ay-onceki': () => { D.ay = H.ekleAy(D.ay, -1); ciz(); },
  'ay-sonraki': () => { D.ay = H.ekleAy(D.ay, 1); ciz(); },
  'hareket-onceki': () => { D.hareketAy = H.ekleAy(D.hareketAy, -1); ciz(); },
  'hareket-sonraki': () => { D.hareketAy = H.ekleAy(D.hareketAy, 1); ciz(); },
  hesap: (el) => hesapAc(el.dataset.id),
  'hesap-duzenle': (el) => hesapDuzenle(el.dataset.id),
  'hesap-kaldir': (el) => guvenli(async () => { if (!confirm('Hesap kaldırılsın mı? Geçmiş kayıtlar kalır.')) return; await istek(`/hesap/${encodeURIComponent(el.dataset.id)}`, { yontem: 'DELETE' }); sayfaKapat(); await yenile(); ciz(); }),
  hedef: (el) => hedefDuzenle(el.dataset.id),
  'hedef-duzenle': () => hedefDuzenle(null),
  'hedef-kaldir': (el) => guvenli(async () => { await istek(`/hedef/${encodeURIComponent(el.dataset.id)}`, { yontem: 'DELETE' }); sayfaKapat(); await yenile(); ciz(); }),
  sabit: (el) => sabitDuzenle(el.dataset.id),
  'sabit-kaldir': (el) => guvenli(async () => { if (!confirm('Sabit ödeme kaldırılsın mı?')) return; await istek(`/sabit/${encodeURIComponent(el.dataset.id)}`, { yontem: 'DELETE' }); sayfaKapat(); await yenile(); ciz(); }),
  kategori: (el) => kategoriDuzenle(el.dataset.id),
  'kategori-kaldir': (el) => guvenli(async () => { if (!confirm('Kategori kaldırılsın mı? Geçmiş kayıtlar kalır.')) return; await istek(`/kategori/${encodeURIComponent(el.dataset.id)}`, { yontem: 'DELETE' }); sayfaKapat(); await yenile(); ciz(); }),
  yenile: () => guvenli(async () => { await istek('/bakim', { yontem: 'POST', govde: {} }); await yenile(); ciz(); bildirim('Güncel'); }),
  kilitle: () => guvenli(kilitle),
  'yedek-al': () => guvenli(yedekAl),
  'dosya-paylas': () => dosyaPaylas(),
  excel: () => guvenli(excelAktar),
  'ice-ekle': () => guvenli(iceAktarEkle),
  'deneme-kur': () => guvenli(denemeKur),
  'deneme-sil': () => guvenli(denemeSil),
  'yedek-yukle': () => yedekYukleAc(),
  'yedek-vazgec': () => { D.yedekMetin = null; D.pin = null; guvenli(basla); },
};

const FORMLAR = {
  odeme: odemeYap,
  sela: selaOnayla,
  aile: aileKaydet,
  islem: islemKaydet,
  esitle: hesapEsitle,
  hesap: hesapKaydet,
  hedef: hedefKaydet,
  sabit: sabitKaydet,
  ayar: ayarKaydet,
  kategori: kategoriKaydet,
  sihirbaz: sihirbazIleri,
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-eylem], [data-ekran]');
  if (!el || el.disabled) return;
  if (el.dataset.ekran) { ev.preventDefault(); sayfaKapat(); return ekranaGit(el.dataset.ekran); }
  const eylem = el.dataset.eylem;
  if (eylem.startsWith('s-')) { ev.preventDefault(); return sihirbazEylem(eylem, el); }
  const f = EYLEMLER[eylem];
  if (f) { ev.preventDefault(); f(el); }
});

document.addEventListener('submit', (ev) => {
  const f = FORMLAR[ev.target.dataset.form];
  if (!f) return;
  ev.preventDefault();
  const btn = ev.submitter;
  if (btn) btn.disabled = true;
  guvenli(() => f(ev.target)).finally(() => { if (btn?.isConnected) btn.disabled = false; });
});

// Hızlı girişteki alanlar ve şelale toplamı
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.alan && D.giris) D.giris[t.dataset.alan] = t.value;
  if (t.dataset.pay) { const f = t.closest('form'); const x = $('#sela-toplam'); if (x) x.textContent = para(selaToplami(f)); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.dosya === 'yedek') return guvenli(() => yedekDosyasiSecildi(t));
  if (t.dataset.dosya === 'ice') return guvenli(() => iceAktarSecildi(t));
  if (t.dataset.iceId && D.ice) { const s = D.ice.sonuc.satirlar.find((x) => x.id === t.dataset.iceId); if (s) s.kategori_id = t.value || null; return iceAktarCiz(); }
  if ('iceHesap' in t.dataset && D.ice) { D.ice.hesap = t.value; return; }
  if (t.dataset.alan && D.giris) { D.giris[t.dataset.alan] = t.value; if (t.tagName === 'SELECT') girisCiz(); }
  if (t.dataset.eylemDegis === 'hesap-tur') $('#hesap-ek').innerHTML = hesapEkAlanlari({ tur: t.value }, true);
});

// Uygulama öne gelince: 5 dakikadan uzun arkadaysa PIN sorulur; değilse gün değiştiyse günlük bakım çalışır
// (hafta kapanışı, 10'unda çekiş, otomatik ödemeler).
document.addEventListener('visibilitychange', () => {
  if (arkaPlanKontrol() !== 'acik') return;
  if (D.veri && !D.giris && !$('.sayfa')) guvenli(async () => { await yenile(); ciz(); });
});

basla();
