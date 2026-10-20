# BANK OF USY — kişisel bütçe uygulaması

> **Bu dosya ne?** BANK OF USY'nin el kitabı: ne yaptığı, para kuralları, telefona kurulum, yedek ve yeni sürüm yayını.
> Teknik çalışma notları `CLAUDE.md`'de. Dosyada ve kodda kimsenin kişisel bilgisi yoktur; hesaplar, bakiyeler,
> limitler ve PIN kurulumda **telefonda** girilen değerlerdir ve yalnız o telefonda durur.

---

## Kısaca

- iPhone'da **Safari › Paylaş › Ana Ekrana Ekle** ile uygulama gibi açılan bir web uygulaması (PWA). GitHub Pages'te yayınlanır.
- **Sunucu yok.** Bütün kayıtlar telefonun içinde (IndexedDB), **4 haneli PIN'le şifreli** durur. İnternet olmadan da çalışır.
- Uygulamayı ana ekrandan silmek ya da telefon değiştirmek kayıtları götürür: **tek koruma şifreli yedek dosyasıdır** (aşağıda).
- Yeni sürüm yayınlanınca telefon onu kendiliğinden alır (sayfa bir kez yenilenir, PIN yeniden sorulur). Sürüm numarası Ayarlar'ın başlığında.

---

## Claude için en önemli kurallar

1. **Kullanıcının girdiği rakamlar gerçek veridir.** Örnek veri koyma, üzerine yazma, "temizlemek" için silme. Gerçek rakam koda, teste, depoya girmez; denemeler uydurma veriyle.
2. **PIN'i Claude girmez ve belirlemez.** Kart numarası (Luhn kontrolü), CVV, banka şifresi istenmez, tutulmaz.
3. **Uygulama para göndermez.** Havaleler "yapılacak" listesidir; kullanıcı bankadan yapıp "Ödendi" der.
4. **Hesaplar tek yerde:** `public/hesap.js`. Arayüz (`app.js`) yalnız gösterir. Yeni kural → birim testi.
5. **Ay 10'unda başlar.** Tarihi aya bağlayan her hesap `butceAyi()`'dan geçer; `getMonth()` kullanılmaz. Tarihler Türkiye gününe göre.
6. **Tutarlar kuruş cinsinden tam sayı.** Ekranda tam lira görünür (`app.js › tamLira`); tuş takımı, düzenleme kutuları ve Excel kuruşludur.
7. **Dışarıya dönük her iş için önce onay:** GitHub'a gönderme (= yayın), silme.
8. **Gerçek ekstreler teste girmez**; ekstre okuyucu yazılırken yalnız biçim öğrenilir.

---

## Ne yapar

| Bölüm | Ne işe yarar |
|---|---|
| **Özet** | Tepede **kullanılabilir bakiye** (banka hesapları + nakit) ve **ay sonu tahmini** (dokununca döküm); altında net varlık · yatırım · kart borcu (geçen bütçe ayının sonuna göre ↑/↓). Yeni bütçe ayının ilk 5 günü geçen ayın **özet kartı** (yatırıma giden, plana göre, en çok harcanan 3 kategori; × ile kapanır). Haftalık kart (sağa sola kaydırılır: bu bütçe ayının haftaları, "Ekim · 2. hafta"; açılışta bu hafta, altta noktalar; geçmiş haftada harcanan ve farkın nereye gittiği, gelecek haftada limitler ve kısılacak tutar; "günde X ₺"), artan bütçe, maaş/aile kartları, 14 günlük yapılacaklar, son hareketler. |
| **Dokunma** | Yapılacaklar'da ödemeye **basılı tut** = Ödendi/Yaptım (kart ödemesi hariç; "Geri al"). −/+ basılı tutulunca hızlanır. Ay ekranında yatay kaydırma = önceki/sonraki ay. **Sol kenardan sağa çek** = geri. Formlardaki tutar kutuları telefon klavyesi yerine uygulamanın tuş takımını açar. Hafta bütçenin altında kapanınca ve maaşta yatırım ayrılınca kısa ✦ kutlama. |
| **Hızlı kayıt** | **Yeni kayıt** → tutarı tuşla → kategoriye dokun = kaydedildi (5 sn "Geri al"). Hesap/kart seçimi (son kullanılan önce gelir), taksit, plan dışı, "Ailem ödüyor", not ve tarih. Gelir ve hesaplar arası transfer de buradan. |
| **Haftalık bütçe** | Kategori başına haftalık limit; hafta pazartesi–pazar. Hafta kapanınca her kategorinin farkı (artı ya da eksi) **Artan bütçe**'ye gider. Artan bütçe eksiye düşerse sonraki haftanın limitleri **kısılır** (limitlere oranla; ekranda ± ile değiştirilebilir). Açık olan haftada **"Açığı ay sonundan düş"** (aç/kapa düğmesi; yanıyorsa seçili, yeniden dokunmak geri alır): o haftanın açığı artan bütçeye yazılmaz, sonraki hafta kısılmaz, yatırımdan düşmez; yalnız ay sonunda elde kalan azalır. Bu ayın geçmiş haftalarında da açılıp kapatılabilir. |
| **Ay planı** | Bütçe ayı 10'undan ertesi ayın 9'una. **Gider grupları**: sabit ödemeler (+ kart taksit payları) · haftalık bütçeler · aylık harcamalar · beklenmeyen payı · iş giderleri (boş grup gizlenir). Plan / gerçekleşen yan yana, haftalar listesi. |
| **Maaş** | Beklenen maaş ayarlarda. Özet'te "Maaş geldi mi?" → **maaş dağıtımı**: ayın giderleri hesapta kalır, **aylık yatırım** (ayarlardaki tutar ± artan bütçe; ekranda −/+) yatırıma havale olur, kalanı serbest. |
| **Ailem ödüyor** | Böyle işaretlenen harcama/sabit ödeme bütçeye girmez, kart borcuna girer ve **aileden alacak** olur; aile ödeyince "Geldi" ile kapanır (gelir sayılmaz). |
| **Sabit ödemeler** | Tutar, gün, periyot (aylık · 3 · 6 · yıllık), hesap, **son vade** (taksit bitince kendiliğinden durur), değişken, **otomatik** (karttan kendiliğinden çekilir; vadesinde işlenir, yapılacaklarda görünmez). |
| **Cüzdan** | Hesaplar ve kartlar (bakiye kontrolü: bankadaki rakamı yaz, fark "bakiye düzeltme" olur, bütçeye girmez) · birikim hedefleri · **yatırım ekranı** (değer, toplam yatırılan, kazanç %, aylık katkı; değer elle güncellenir). |
| **Ayarlar** | Kategoriler, sabit ödemeler, maaş ve aylık yatırım, hesapların görevi (harcama · maaş · yatırım hesabı), yedek, Excel, içe aktar, kilitle. |
| **Yedek** | Ayarlar › Yedek al: PIN'le şifreli dosya; iPhone'da paylaş menüsü → Dosyalar'a Kaydet (iCloud Drive / OneDrive). Ayda bir hatırlatma. |
| **Excel'e aktar** | Okunabilir döküm (hareketler, haftalar, aylar, kategoriler, gelir, sabitler, hesaplar); telefonda üretilir. |
| **İçe aktar** | Hazır hareket listesi (ör. banka listesinden Claude'un hazırladığı dosya); önce özet, sonra hepsi ya da hiçbiri. Biçim `public/ice-aktar.js` başında (tutar KURUŞ). |
| **Deneme verisi** | Kurulumdan önce uydurma veriyle gezinmek için; tek dokunuşla silinir. |
| **PIN** | 4 hane; veriyi şifreler (PBKDF2-SHA256 600.000 tur → AES-GCM). Yanlışta bekleme yok. Uygulama 5 dakikadan uzun arkada kalınca yeniden sorar. |

### Bütçe ayı (10'undan 9'una)
- **Bütçe ayı** = ayın 10'u → ertesi ayın 9'u. Adını başladığı aydan alır: *10 Ekim – 9 Kasım = "Ekim"*. Maaş birkaç gün erken yatarsa da o ayın geliridir.
- **Hafta**, perşembesinin düştüğü bütçe ayına aittir (bazı aylarda 5 hafta). "1. hafta": 10'u pazartesi–perşembeyse içinde 10'u olan hafta, cuma–pazarsa ertesi pazartesi başlayan hafta.
- **Sabit ödeme**, vadesinin düştüğü bütçe ayına yazılır (ayın 5'inde ödenen bir önceki bütçe ayındandır).
- **Kurulum ayı**: başlangıç günü → ilk 9'u. İlk hafta ve aylık limitler kalan günlere göre orantılanır (ör. salı başlanırsa ilk hafta limitin 6/7'si).
- **Geçmiş başlangıç**: kurulumda en çok 60 gün geriye gidilebilir; bakiyeler o günün bakiyesidir, o günden bu yana olanlar sonradan girilir ya da içe aktarılır.

### Para kuralları (kısa)
- **Gelir havuzu yok.** Maaşta ayın planı hesapta kalır, aylık yatırım havale olur, kalanı serbesttir. Ek gelirde gider ayrılmaz.
- **Artan bütçe** ay sonunda ayrıca havale olmaz: bir sonraki maaştaki yatırıma eklenir (eksiyse düşülür).
- **Kartla harcama** o gün bütçeden düşer, kart borcunu artırır. Kart ödemesi gider değil, bankadan karta **transfer**dir.
- **Taksit**: ilk pay alışveriş günü kategorisinden düşer, sonraki paylar düştükleri bütçe ayının sabit ödemelerine yazılır.
- **Plan dışı** işaretli harcama beklenmeyen payından düşer. **İş gideri** işaretli kategori kişisel bütçeye karışmaz.
- **Dondurma**: kapanan haftanın limitleri donar; o haftaya sonradan girilen, düzeltilen ya da silinen harcama haftanın farkını (ve artan bütçeyi, bu haftanın kısmasını) günceller; ayın planı ay başında donar. Bir kategori ya da sabit ödeme değişirse **içinde bulunulan ayın ve sonrasının** planı yeniden hesaplanır; geçmiş aylar değişmez.
- **Ay sonu tahmini** (bütçe ayının son günü, maaştan önce): kullanılabilir bakiye − kart borcu + aileden alacak − kalan sabit ödemeler − haftalık ve aylık limitlerin kalanı (aşılan kategori 0, limitsiz kategori bir şey eklemez) − beklenmeyen payının kalanı − yatırıma bekleyen havaleler. Limit içindeki harcama tahmini değiştirmez (o para zaten ayrılmış); limit üstü, limitsiz kategori ve plan dışı harcama lirası lirasına düşürür. Kurulum ayında aylık limitler kalan günlere göre orantılıdır. Bu haftanın aşımı sonraki haftadan kısılacaksa (kalan limitlerin de harcanacağı varsayılarak) o hafta o kadar az harcanmış sayılır; "Açığı ay sonundan düş" seçilince kısma olmadığı için tahmin açık kadar düşer. Dökümün altında "İçinde ay sonundan düşülen açıklar" gösterilir. Haftalık bütçeler gün payıyla sayılır: bugünden ay sonuna kadarki günler, hafta hangi aya ait olursa olsun (ör. ayın son 3 günü sonraki ayın haftasındaysa o haftanın 3/7'si; bu haftada kalan para kalan günlere bölünür). Taksitli alışverişin kart borcundaki sonraki aylara düşen payları geri eklenir (yalnız bu ayın payı düşer; sonrakiler o ayların planında). Dökümde haftalık ve aylık satırların altında her kategori için ayrılan para (aşılan kategoride aşım) görünür. Gelecek ayın maaşı erken yatarsa tahmin o maaş (ve ondan doğan yatırım havalesi) yokmuş gibi hesaplanır.
- **Kart son ödemesi** (ekstre okuyucu gelene kadar): kesimden sonraki gün dönem harcamaları (kesim günü dahil; kurulumdaki kart borcu ilk ekstreye eklenir) "tahmini" ödeme olarak çıkar; ödeme beklerken döneme sonradan girilen harcamayla tutarı güncellenir; **Ödendi** derken bankanın istediği tutar yazılır.
- **Yatırım** değeri bakiye kontrolüyle elle güncellenir; uygulama fiyat çekmez, yatırım önerisi vermez.

---

## Mimari

```
bank-of-usy\
  public\                  yayınlanan uygulama (GitHub Pages bu klasörü yayınlar)
    index.html             görünüm ve tema (:root renkleri; hep koyu, siyah + altın)
    app.js                 arayüz; hesap yapmaz. istek(yol, {yontem, govde}) → yerel-api
    yerel-api.js           telefondaki "sunucu": /veri, /islem, /gelir, /kurulum, /kisma, /ice-aktar … ;
                           yazmalar belgenin kopyasında yapılır, hatasızsa kaydedilir; günlük bakım günde bir
    hesap.js               BÜTÜN hesaplar (saf; Node testleri de bunu kullanır)
    depo.js                IndexedDB (tek belge) + PIN'le şifreli kasa + yedek dosyası
    excel.js · ice-aktar.js · deneme.js
    vendor\xlsx.full.min.js  SheetJS (yalnız Excel'e aktarırken yüklenir)
    sw.js · manifest.json · icon-*.png   yayinla.js üretir
  yayinla.js               manifest + service worker (önbellek adı içerikten) + simgeler
  sunucu.js                yalnız yerel deneme: node sunucu.js → http://localhost:8787
  test\*.test.js           npm test (node --test); bütün veriler uydurma
  .github\workflows\yayin.yml   main'e her gönderimde public\ klasörünü Pages'e yayınlar
```

**Güvenlik:** Kod herkese açık depoda, içinde kişisel veri yok. Veri telefondan çıkmaz; diskteki belge ve yedek dosyası PIN'le şifrelidir.
PIN unutulursa veri de yedek de açılamaz ("PIN sıfırla" yok) — PIN kâğıda yazılıp telefondan ayrı saklanır.

---

## Telefona kurulum (kullanıcı yapar)

1. iPhone'da **Safari** ile uygulamanın adresini aç (Chrome'dan eklenen uygulama gibi açılmaz).
2. **Paylaş** → **Ana Ekrana Ekle** → **Ekle**. Safari'yi kapat, **ana ekrandaki simgeden** aç.
3. **PIN belirle** (4 rakam, iki kez).
4. **Kurulum sihirbazı** (6 adım): Gelir (başlangıç günü, beklenen maaş) · Hesaplar (o günkü bakiyeler; kartlarda borç, limit, kesim, son ödeme, ödendiği hesap; hesapların görevi) · Haftalık bütçe (kategoriler, haftalık/aylık, limit) · Sabit ödemeler · Yatırım (aylık tutar) · Kontrol.
   İstenirse önce "deneme verisiyle dene".
5. Kurulumdan sonra ilk iş: **Ayarlar › Yedek al**.

**Bilgisayarda kurup telefona taşımak** da olur: sihirbaz bilgisayarda doldurulur, yedek alınır, dosya telefona gönderilir,
telefonda PIN ekranındaki **"Yeni telefon mu? Yedekten geri yükle"** ile yüklenir. Bilgisayardaki tarayıcı kopyası sonra silinir.

### Yedek ve yeni telefon
- **Yedek al:** Ayarlar › Yedek al › Kaydet → Dosyalar'a Kaydet. Dosya PIN'le şifreli JSON'dur (`BANK OF USY yedek <tarih>.json`).
- **Geri yükle:** yeni telefonda uygulamayı ekle → PIN ekranında "Yedekten geri yükle" → dosyayı seç → yedeğin PIN'i. Telefondaki veri tamamen yedekle değişir;
  yedeği aldıktan sonra girilen kayıtlar kaybolur.

---

## Yeni sürüm yayını (Claude yapar, kullanıcı onaylar)

1. Değişiklik → `npm test` (hepsi geçmeli).
2. `public/app.js`'teki `SURUM`'u artır (ör. 1.7 → 1.8) — Ayarlar başlığında görünür.
3. `node yayinla.js` (sw.js önbellek adı içerikten değişir; yeni dosya eklendiyse `yayinla.js › KABUK` listesine ekle).
4. Yerelde dene: `node sunucu.js` → http://localhost:8787 (telefon boyutu 375×812; uydurma veri).
5. Commit → **kullanıcıya sor** → `git push origin main`. GitHub Actions ("Yayın") 1–2 dakikada yayınlar; durumu Actions sekmesinde.
6. Telefon yeni sürümü bir sonraki açılışta ya da öne gelişte alır.

### Sıfırdan yayın kurmak (bir kez)
1. GitHub'da boş, herkese açık bir depo aç (README ekleme).
2. `git remote add origin https://github.com/<kullanıcı>/<depo>.git` → `git push -u origin main`.
3. Depo › **Settings › Pages › Source: GitHub Actions**. İlk çalışma Pages kapalıyken başladıysa Actions'ta **Re-run all jobs**.
4. Adres: `https://<kullanıcı>.github.io/<depo>/`.

---

## Tuzaklar

| Tuzak | Ne olur | Çözüm |
|---|---|---|
| Tarayıcıda denerken eski service worker | eski dosyalar gelir | sayfada kayıtları sil (`navigator.serviceWorker.getRegistrations()` → `unregister`, `caches.delete`) |
| Uygulama sekmesi açıkken `indexedDB.deleteDatabase` | asılı kalır | silmeyi aynı kökenli başka bir sayfada yap (ör. `/manifest.json`) |
| Claude uygulamasının tarayıcı penceresi | uygulama yeniden başlayınca verisi silinebilir | pencerede iş bitince yedek al; kalıcı veri orada tutulmaz |
| Pencereden indirilen dosya | `<uuid>.tmp` adıyla iner | içi tamdır; doğru adla yeniden adlandır |
| iPhone'da `navigator.share` | dokunuştan geç çağrılırsa açılmaz | dosyayı önceden hazırla, dokunuşta hemen paylaş |
| Kodda takvim ayı (`getMonth()`) | 1–9 arası kayıtlar yanlış aya düşer | her zaman `butceAyi()` |
| İlk hafta limiti ayardakinden küçük | kurulum haftası kalan günlere orantılı | hata değil; sonraki haftalar tam limit |
| Otomatik ödemeyi "Geri al" | ertesi gün bakımda yeniden işlenir | ödenmeyecekse **Atla** |
| Windows'ta Georgia rakamları | eski usul (inen) görünür | iPhone'da New York düz rakamdır |
| Bash heredoc içinde `node -e` | düzenli ifadelerde `\` kaybolabilir | uzun düzenlemeyi dosyaya yazıp çalıştır |
| Para tutarına Türkçe ek (`₺'ye`) | ek yanlış düşer | eksiz kur ("… ₺ için") |

---

## 🚧 Yapılacaklar

- **Kart ekstresi okuyucu:** PDF'i Dosyalar'dan seçip telefonda okumak (pdf.js); Garanti BBVA (Bonus) ve Yapı Kredi biçimleri, mutabakat ve bulgular
  (çift çekim, faiz/vergi, abonelik tutarı değişti, kayıtsız harcama…). O zamana kadar kart son ödemesi uygulamadaki kayıtlardan tahmin edilir.
- Hisse ve altın gibi birden çok yatırım hesabını yatırım ekranında ayrı ayrı göstermek.
