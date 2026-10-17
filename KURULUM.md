# BANK OF USY — kişisel bütçe uygulaması

> ⚠️ **Bu el kitabı eski (Cloudflare) yapıyı anlatıyor.** 2026-10-17'den beri uygulama telefonda çalışan yapıya
> taşınıyor: veri yalnızca telefonda (`public/depo.js`, `public/yerel-api.js`), sunucu yok. Worker, D1, anahtarlar
> ve Excel görevi kaldırıldı. Taşıma bitince bu dosya yeniden yazılacak; o zamana kadar plan
> `..\DEVAM-NOTU.md` (bölüm 3b) dosyasında.

> **Bu dosya ne?** Telefonda çalışan kişisel bütçe uygulaması BANK OF USY'nin el kitabı, tasarım tarifi ve sıfırdan kurulum adımları.
> BANK OF KLC tarifinden uyarlandı (değişenler en altta: "KLC'den farklar").
> **Nasıl kullanılır?** Kod `bank-of-usy` klasöründe (bu dosyanın bir kopyası orada `KURULUM.md` adıyla). Claude Code'u o klasörde aç ve
> *"KURULUM.md'yi oku, BANK OF USY'yi benim için kur"* de. Claude aşağıdaki adımları senin hesabınla yapar.
>
> Dosyada ve kodda kimsenin kişisel bilgisi yoktur. Hesaplar, bakiyeler, kartlar, limitler ve anahtarlar kurulumda **senin** girdiğin değerlerdir.

---

## 🚧 Yapılacaklar

| Konu | Durum |
|---|---|
| **Kart ekstresi okuyucu** (Garanti BBVA · Yapı Kredi): `ekstre-oku.js`, `ekstre.js`, `migrations/0002_ekstre.sql`, ekstre kuralları, bulgular ekranı, `test/ekstre.test.js`, haftalık görevde ekstre adımı | **Yapılacak.** Gerçek ekstre PDF'leri gelince yazılacak. O zamana kadar kart son ödemesi uygulamadaki kayıtlardan tahmin edilir; kartın "Ekstre bankası" seçimi şimdiden kaydedilir. |
| Geri kalan her şey | **Yazıldı ve yerelde denendi** (24 birim testi, 27 adımlık iki uçtan uca deneme, 11 yayın denetimi, telefon boyutunda arayüz). |
| Canlı kurulum (Cloudflare, telefon, Drive, haftalık görev) | **Yapılmadı.** Aşağıdaki "Kurulum" adımları 2–8; senin Cloudflare hesabınla yapılır. |

Aşağıda 🚧 ile işaretli satırlar ekstre okuyucuya bağlıdır ve henüz çalışmaz.

---

## ⚠️ Claude için en önemli kurallar

1. **Kullanıcının girdiği rakamlar gerçek veridir.** Asla örnek veri koyma, üzerine yazma, "temizlemek" için silme.
2. **Canlı veriye toplu değişiklikten önce yedek al:** `npx wrangler d1 export bank-of-usy --remote --output .wrangler/yedek-<tarih>.sql`.
   Mümkünse yedeği yerel kopyaya kur (`npx wrangler d1 execute bank-of-usy --local --file <yedek>`) ve değişikliği önce orada dene.
3. **PIN'i Claude girmez ve belirlemez.** Kart numarası, CVV, banka şifresi istenmez, yazılmaz. Link ve anahtarlar notlara, mesaja yazılmaz.
4. **Uygulama para göndermez.** Havaleler "yapılacak" listesidir; kullanıcı bankadan yapıp "Yaptım" der.
5. **Hesaplar tek yerde:** `public/hesap.js` (telefon, Worker ve Node aynı dosyayı kullanır). Arayüz yalnız gösterir.
6. **Şema değişikliği yeni dosyayla:** `migrations/0003_….sql`; uygulanmış migration dosyası değiştirilmez.
7. **Yayın sırası:** `npm test` → `node yayinla.js` → `npx wrangler deploy` → `node test/canli-kontrol.js`.
8. **Gerçek ekstreler teste girmez.** Ekstre okuyucuyu yazarken gerçek PDF'ten biçim öğrenilir; test verisi her zaman uydurmadır (işyeri adı, tutar, tarih kopyalanmaz).
9. **Ay 10'unda başlar.** Tarihi aya bağlayan her hesap `hesap.js`'teki tek fonksiyondan (`butceAyi(tarih)`) geçer; takvim ayı (`getMonth()`) doğrudan kullanılmaz.

---

## Ne yapar

| Bölüm | Ne işe yarar |
|---|---|
| **Hızlı harcama** | Ortadaki **+** → tutarı tuşla → kategori kutucuğuna dokun = kaydedildi (5 sn "Geri al"). Kart seçilirse taksit, plan dışı işareti, not, tarih. |
| **Haftalık bütçe** | Kategori başına haftalık limit (market, yemek, benzin…). Hafta pazartesi–pazar; "günde X ₺ harcayabilirsin". Hafta kapanınca artan birikime, aşım birikimden ("yapılacak havale"). |
| **Ay planı** | Bütçe ayı **10'undan ertesi ayın 9'una** kadar. 5 kova: Sabit ödemeler (+ kart taksit payları) · Haftalık bütçeler · Aylık harcamalar (kıyafet, ev eşyası…) · Beklenmeyen payı · İş giderleri. Plan / gerçekleşen yan yana. |
| **Gelir havuzu + şelale** | Maaş ve ek gelirler (komisyon, satış, serbest iş…) önce **gelir havuzunu** hedefe doldurur (hedef = aylık ihtiyaç × N ay), artan oranla bölünür: birikim · yatırım · serbest (varsayılan %50 · %30 · %20). Her bütçe ayının ilk günü (10'u) havuzdan harcama hesabına "aylık çekiş". "Havuz kaç ay yeter" ve "yeni gelir gelmezse" tahmini. |
| **Maaş** | Beklenen maaş (tutar, gün = 10) ayarlarda durur. Özet'te "Maaş geldi mi?" kartı: **Geldi** → tutar dolu gelir formu → şelale. Maaş 10'undan önce yatarsa (hafta sonu, bayram) aynı bütçe ayının geliri sayılır. |
| **Ek gelir** | + › Gelir › kaynak seç (Ek gelir, Komisyon, Satış…) → şelale. Düzensiz gelir "yeni gelir gelmezse" tahminine katılmaz; maaş katılır. |
| **Sabit ödemeler** | Kira, aidat, faturalar, abonelikler, kredi taksiti: tutar, gün, periyot (aylık · 3 · 6 · yıllık), hesap, değişken mi, **otomatik** mi (kart aboneliği gibi; vadesinde kendiliğinden işlenir). |
| **Yaklaşan ve havaleler** | Özet'te 14 günlük ödemeler ve yapılacak havaleler; "Yaptım/Ödendi" ile kayıt olur, geri alınabilir. |
| **Cüzdan** | Hesaplar (bakiye kontrolü: bankadaki rakamı yaz, fark düzeltme kaydı olur) · Kartlar · Birikim hedefleri · **Yatırım hesabı**. |
| 🚧 **Kart ekstresi kontrolü** | **Garanti BBVA (Bonus)** ve **Yapı Kredi (World)** ekstre PDF'leri Drive'daki **Ekstreler** klasörüne konur; bilgisayar okur, satırları kategorilere ayırır, kayıtlarla eşleştirir, kuralları çalıştırır (aşağıda). Bulgular Cüzdan › Kartlar ve Özet › Dikkat'te. |
| **Excel arşivi** | Her pazartesi bilgisayar Drive'a yazar: kapanan her hafta için bir dosya + yılın arşivi (Hareketler, Haftalar, Aylar, Kategori × Ay, Gelir ve şelale, Sabit ödemeler, Hesaplar, Ekstreler, Bulgular). "Aylar" bütçe aylarıdır (10–9). Excel salt okunurdur. |
| **Çevrimdışı** | İnternet yokken girilen kayıt telefonda bekler, bağlanınca gönderilir; kimlik telefonda üretildiği için çift kayıt olmaz. |

### Bütçe ayı (10'undan 9'una)
- **Bütçe ayı** = ayın 10'u 00:00 → ertesi ayın 9'u 23:59. Adını başladığı ayın adından alır: *10 Ekim – 9 Kasım = "Ekim"*.
- Başlangıç günü ayarlarda `ay_baslangic_gunu` (varsayılan **10**, 1–28 arası). Kurulumda belirlenir; sonradan değiştirmek için Claude'a söylenir (geçiş ayı ayrıca hesaplanır).
- **Hafta**, perşembesinin düştüğü bütçe ayına aittir (bazı bütçe aylarında 5 hafta).
- **Sabit ödeme**, vade tarihinin düştüğü bütçe ayına yazılır: ayın 5'inde ödenen kira bir önceki takvim ayının bütçesindendir.
- **Kart taksit payı**: ilk pay alışveriş günü kendi kategorisinden düşer; sonraki paylar birer ay arayla (31 Ocak → 28 Şubat) "Sabit ödemeler" kovasına, düştükleri bütçe ayına yazılır.
- **Kurulum ayı**: kurulum günü → ilk 9'u. İlk hafta ve aylık limitler kalan günlere göre orantılanır.

### Para modeli (kısa)
- **Aylık ihtiyaç** = sabit kalemler (yıllık olan 1/12…) + haftalık limitler × 52/12 + aylık limitler + beklenmeyen payı. Havuz hedefi bunun N katı (varsayılan 3).
- **Aylık çekiş** (her 10'unda) = o bütçe ayının sabit vadeleri + taksit payları + (hafta sayısı × haftalık limit) + aylık limitler + iş giderleri + beklenmeyen payı.
- **Maaş ve ek gelir** aynı yoldan geçer: havuz → şelale. Havuz dolu olduğu için maaşın birkaç gün erken/geç yatması çekişi etkilemez.
- **Kartla harcama** o gün bütçeden düşer, kart borcunu artırır. Ekstre ödemesi gider değil, bankadan karta **transfer**dir (çift sayım yok).
- **Taksit**: her ay o aya düşen pay sayılır. **Tutarlar** veritabanında kuruş cinsinden tam sayıdır.
- **Puan**: Bonus / Worldpuan ile ödenen kısım gider değildir; ekstrede eksi satır olarak gelir, ödemeyle karışmaması için ayrı ("puan kullanımı") işaretlenir.
- **Plan dışı** işaretli harcama kendi kategorisinden değil, **beklenmeyen payından** düşer.
- **İş giderleri**: kategoride "İş gideri" işaretliyse kişisel bütçeye karışmaz, ayrı kovada izlenir (iş kategorileri aylıktır).
- **Aylık kategorilerde** artan para harcama hesabında kalır; birikime yalnız haftalık fark taşınır.
- **Dondurma**: ayın planı ayın ilk günü, haftanın limit ve harcaması hafta kapanınca dondurulur. Sonradan limit değişse ya da eski tarihli kayıt girilse geçmiş bozulmaz.
- **Kart son ödemesi** (ekstre okuyucu gelene kadar): kesim günü geçince dönemdeki kart harcamaları + döneme düşen taksit payları "tahmini" ödeme olarak çıkar; **Ödendi** derken bankanın istediği tutar yazılır.
- **Yatırım**: şelalenin yatırım payı "yapılacak havale" olarak yatırım hesabına gider. Yatırım hesabının değeri bakiye kontrolüyle elle güncellenir (uygulama piyasa fiyatı çekmez, yatırım önerisi vermez).

### 🚧 Kart ekstresi kuralları (sabit; aynı ekstre her seferinde aynı bulguyu verir)
Çift çekim (aynı yer, aynı tutar, 2 gün içinde) · tanımadık işyeri (ilk ekstre taban sayılır) · faiz ve vergi satırları · kısmi ödeme (yalnız asgari ödendiyse kalan borcun aylık faizi) ·
abonelik tutarı değişti / alışılmışın dışında tutar · yıllık kart ücreti (BSMV dahil) · nakit avans · taksit uyuşmazlığı · limit doluluğu %80 üstü ·
uygulamada kaydı olmayan harcamalar ("Hepsini ekle") · yurt dışı işlem ücreti · kategori sıçraması (önceki 3 ekstreye göre) · iki müzik aboneliği ·
kategorisi belli olmayan satırlar · bankanın ekstredeki notları · süresi dolan puan uyarısı (ekstrede yazıyorsa). Ayrıca son ödemeye 7 gün kala hesaplardaki para yetmiyorsa telefonda uyarı çıkar.
Okuyucunun tanıdığı bankalar: **Garanti BBVA (Bonus)** ve **Yapı Kredi (World)**. Başka bankanın ekstresini Claude okuyup aynı biçimde JSON yazar (aşağıda).
Her ekstre **mutabakatla** doğrulanır: önceki borç + satırlar = ekstre borcu; tutmazsa yüklenmez.

---

## Mimari ve güvenlik

- **Cloudflare Worker + D1** (ücretsiz planda yeter): Worker hem API'yi hem telefon arayüzünü sunar; D1 tek doğru kaynaktır.
- **Telefon uygulaması (PWA)**: iPhone'da Safari › Paylaş › **Ana Ekrana Ekle** ile uygulama gibi açılır (Android'de Chrome › Ana ekrana ekle).
- **Kapı**: adresin içinde uzun bir **link anahtarı** vardır (`/<anahtar>/`); bilmeyen "Bu adres geçerli değil" görür.
- **PIN**: ilk açılışta telefonda belirlenir (4–6 rakam), sunucuda PBKDF2 özeti durur; oturum 30 gün; 5 yanlışta 15 dk kilit.
- **Bilgisayar anahtarı** (`ARSIV_ANAHTAR`): Excel arşivi (🚧 ve ekstre yükleyici) bununla bağlanır; okur ve arşiv kaydı yazar, başka hiçbir kaydı değiştiremez. Telefon API'sini açmaz.
- **Yerel deneme anahtarları** ayrıdır (`.dev.vars`, `yerel-` ile başlar): gerçek link hiçbir denemede görünmez. Gün değiştirme (`x-bugun`) yalnız yerelde çalışır.
- Bütün yanıtlarda `Referrer-Policy: no-referrer` (link başka siteye sızmaz), sıkı CSP, `X-Frame-Options: DENY`. Oturum çerezi `HttpOnly; Secure; SameSite=Strict`; başka siteden gelen yazma isteği reddedilir.
- **Tutulmayanlar**: kart numarası (15–16 haneli Luhn uyan sayı not alanında bile reddedilir), CVV, şifreler. Ekstre PDF'i Drive'da kalır, sunucuya yalnız satırlar gider.

---

## Klasör

```
bank-of-usy\
  KURULUM.md                 bu dosya
  package.json               npm betikleri ve bağımlılıklar (wrangler, exceljs; 🚧 pdfjs-dist ekstreyle gelecek)
  wrangler.jsonc             Worker + D1 + statik dosyalar (database_id kurulumda yazılır; sır yok)
  migrations\0001_ilk.sql    şema: hesap · kategori · hedef · islem · sabit_kalem · odeme · ay_plani · hafta · ayar · arsiv_kaydi
  migrations\0002_ekstre.sql 🚧 ekstre · ekstre_satiri · bulgu (hesap.banka ve kategori.is_gideri zaten 0001'de)
  src\worker.js              API, kapı (link + PIN), tembel bakım (günde bir: hafta kapanışı, 10'unda aylık çekiş, sabit ödemeler, otomatik ödemeler, kart son ödemesi), 🚧 ekstre yükleme
  public\hesap.js            BÜTÜN hesaplar (butceAyi, şelale, ay planı, bakım adımları…) ve 🚧 ekstre kuralları (tarayıcı + Worker + Node)
  public\app.js              telefon arayüzü · public\index.html görünüm ve simgeler · sw.js, manifest.json, icon-*.png (yayinla.js üretir)
  yayinla.js                 manifest + service worker (önbellek adı içerikten) + simgeler (saf Node ile çizilir, ek program gerekmez)
  anahtar.js                 link ve bilgisayar anahtarı: üret · Cloudflare'e yükle · telefon linkini göster · PIN sıfırla; yerel deneme anahtarları
  yerel-ayar.js              bu bilgisayara özel ayarları okur: .adres, .klasor, anahtarlar, .dev.vars (paylaşılmaz)
  arsivle.js                 Excel arşivi (exceljs)
  haftalik.js                pazartesi görevi: (🚧 ekstre.js →) arsivle.js
  ekstre-oku.js · ekstre.js  🚧 ekstre PDF okuyucu (pdfjs-dist; garanti · yapikredi) ve yükleyici
  gorev-kur.ps1              Windows görevi: her pazartesi 07:00 haftalik.js (pencere açmaz)
  test\hesap.test.js         24 birim testi (uydurma veriyle; bütçe ayı sınırları 9/10, 5 haftalı ay, kurulum ayı orantısı, bakım dahil)
  test\ekstre.test.js        🚧 okuyucu testleri (uydurma, iki bankanın biçimini taklit eden metin)
  test\api-yerel.js · test\hafta-kapanis-yerel.js   yerel uçtan uca denemeler (19 + 8 adım; deneme PIN'i test\api-yerel-pin.js)
  test\yerel-sifirla.sql     YALNIZ yerel deneme veritabanını boşaltır
  test\canli-kontrol.js      yayından sonra 11 denetim (veri yazmaz)
```
Kurulumda oluşan, **paylaşılmayan** dosyalar: `.anahtar` · `.arsiv-anahtari` · `.dev.vars` · `.adres` · `.klasor` · `.wrangler\` · `*.log` (hepsi `.gitignore`'da).

---

## Kurulum (yaklaşık 20 dakika)

### 0 · Gerekenler
- Windows bilgisayar, **Node.js 22 ya da üstü** (`node -v`).
- Ücretsiz **Cloudflare** hesabı (e-posta ile açılır).
- Telefon: iPhone'da **Safari** (Chrome'dan ana ekrana eklenen uygulama gibi çalışmaz).
- **Google Drive masaüstü** (Excel arşivi ve ekstre klasörü için).
- 🚧 Ekstre okuyucu için: Garanti ve Yapı Kredi'den **en az birer, tercihen 2–3 gerçek ekstre PDF'i** (Claude biçimi bunlardan öğrenir; PDF'ler bilgisayarda kalır).

### 1 · Kod ve paketler
Proje **kısa bir yolda** olmalı (Windows'ta uzun klasör yolu yerel veritabanını bozar; aşağıda "Tuzaklar"). Şu anki yer `C:\Users\ufuks\GelirGider\bank-of-usy` yeterince kısa; yerel deneme orada sorunsuz çalıştı.
```bash
cd C:\Users\ufuks\GelirGider\bank-of-usy
npm install
npm test
```
24 testin hepsi geçmeli. `npm install` sonunda "allow-scripts … esbuild / workerd" uyarısı çıkabilir; zararsızdır.

### 2 · Cloudflare'e bağlan
```bash
npx wrangler login
```
Tarayıcı açılır, Cloudflare hesabına izin verilir. Kontrol: `npx wrangler whoami`.

### 3 · Veritabanı
```bash
npx wrangler d1 create bank-of-usy
```
Çıktıdaki `database_id` değerini `wrangler.jsonc` içindeki `BURAYA_D1_KIMLIGI` yerine yaz. Sonra şemayı kur:
```bash
npx wrangler d1 migrations apply bank-of-usy --remote
```

### 4 · Yayın
```bash
node yayinla.js
npx wrangler deploy
```
Hesapta ilk kez Worker yayınlanıyorsa Cloudflare bir **workers.dev alt alan adı** seçmeni ister (Claude etkileşimsiz çalışıyorsa bu seçimi Cloudflare panelinde Workers & Pages bölümünden yap, sonra deploy'u tekrarla).
Deploy çıktısındaki adresi (ör. `https://bank-of-usy.<alt-alan>.workers.dev`) proje klasöründe **`.adres`** adlı dosyaya tek satır olarak yaz.

### 5 · Anahtarlar
```bash
node anahtar.js
node anahtar.js --yukle
node anahtar.js --goster
```
Birincisi link anahtarını ve bilgisayar anahtarını üretir (zaten varsa dokunmaz; yerel deneme anahtarlarını `.dev.vars`'a ayrı yazar), ikincisi ikisini Cloudflare'e sır olarak yükler, üçüncüsü **telefon linkini** gösterir. Linki kimseyle paylaşma.
Link sızarsa: `node anahtar.js --yeni --yukle` (eski link çalışmaz olur, telefonda yeniden "Ana Ekrana Ekle").
PIN unutulursa: `node anahtar.js --pin-sifirla` (telefonda açınca yeni PIN belirlenir; veriler yerinde kalır).

### 6 · Denetim
```bash
node test/canli-kontrol.js
```
11 denetimin hepsi ✔ olmalı. Sırları yükledikten hemen sonra birkaç saniye 403/404 görmek normaldir; betik kendisi üç kez dener.

### 7 · Telefona ekleme ve ilk kurulum (bunu kullanıcı yapar)
1. Linki iPhone'da **Safari**'de aç → Paylaş → **Ana Ekrana Ekle**.
2. Simgeden aç → **PIN** belirle (iki kez).
3. **Kurulum sihirbazı**, 6 adım:
   - **Gelir**: beklenen net maaş ve ek gelir kaynaklarının adları (Ek gelir, Komisyon, Satış…). Bütçe ayı 10'unda başlar.
   - **Hesaplar**: nakit, Garanti ve Yapı Kredi vadesizleri, gelir havuzu, birikim, **yatırım**, kredi kartları (Bonus, World); bugünkü **gerçek bakiyeler** (kartta bugünkü borç, limit, kesim ve son ödeme günü, ödendiği hesap, ekstre bankası). Hesapların görevi: harcama hesabı (her 10'unda çekiş oraya gelir), maaşın yattığı hesap, havuz, birikim, yatırım.
   - **Haftalık bütçe**: kategoriler ve haftalık limitler; aylık kategoriler (kıyafet, ev eşyası); beklenmeyen payı; "İş gideri" işaretli kategoriler.
   - **Sabit ödemeler**: kira, aidat, faturalar, abonelikler, taksitler (gün, tutar, değişken mi, otomatik mi).
   - **Havuz ve birikim**: havuz hedefi kaç aylık gider, şelale oranları (birikim · yatırım · serbest, toplam 100), birikim hedefleri ("hafta farkı buraya" işaretli bir hedef).
   - **Kontrol**: aylık ihtiyaç, havuz hedefi, bu bütçe ayının planı (kurulum günü → ilk 9'u). İlk hafta kalan günlere göre sayılır.
   Sihirbaz yarıda kalırsa telefonda taslak olarak durur; uygulama yeniden açılınca kaldığı yerden sürer.
4. 🚧 Kartların ekstresini otomatik okutmak için (seçim şimdiden kaydedilir, okuma ekstre okuyucuyla gelir): Cüzdan › Kartlar › karta dokun › **Ekstre bankası** (Garanti BBVA / Yapı Kredi). Kartın ödendiği vadesizde de aynı banka seçilirse ekstre ödemesi o hesaptan önerilir.

### 8 · Excel arşivi ve ekstre klasörü
1. Drive'da bir **Bütçe** klasörü ve içinde **Ekstreler** klasörü aç.
2. Bütçe klasörünün bilgisayardaki yolunu proje klasöründe **`.klasor`** dosyasına tek satır yaz (ör. `G:\My Drive\Bütçe`).
3. Haftalık görevi kur (her pazartesi 07:00; bilgisayar kapalıysa açılınca çalışır; pencere açmaz):
   ```bash
   powershell -ExecutionPolicy Bypass -File gorev-kur.ps1
   ```
   Kaldırmak için sona `-Kaldir` eklenir. Günlük: `arsiv.log` (🚧 `ekstre.log`).
4. Hemen denemek için: `node arsivle.js` (Excel'i yazar) ya da `node haftalik.js` (görevin yaptığının aynısı). 🚧 `node ekstre.js --kuru` · `node ekstre.js`.
   Arşiv: `Bütçe\BANK OF USY <yıl>.xlsx` (her çalışmada yeniden yazılır) ve `Bütçe\Haftalar\<yıl>\Hafta <pazartesi> – <pazar>.xlsx` (her hafta bir kez).

### 9 · Yerel deneme (geliştirme için)
```bash
node anahtar.js
npx wrangler d1 migrations apply bank-of-usy --local
npx wrangler dev --local --port 8787
npx wrangler d1 execute bank-of-usy --local --file test/yerel-sifirla.sql
node test/api-yerel.js
node test/hafta-kapanis-yerel.js
node arsivle.js --yerel --bugun 2026-11-12
node test/canli-kontrol.js --yerel
```
`wrangler dev` açıkken ikinci pencerede çalıştırılır. `api-yerel.js` **boş** yerel veritabanı ister (`yerel-sifirla.sql` boşaltır; **asla `--remote` ile çalıştırılmaz**) ve yalnız yerelde geçerli bir deneme PIN'i kullanır. `hafta-kapanis-yerel.js` ondan sonra aynı veritabanıyla günü ileri alarak hafta kapanışını, kart kesimini ve yeni ayın çekişini dener. Excel çıktısı `./_arsiv-deneme/` klasörüne yazılır.
Tarayıcıda yerel arayüz: `http://127.0.0.1:8787/<.dev.vars'taki LINK_ANAHTAR>/`.

---

## Günlük kullanım

- **Harcama**: + → tutar → kategori. Kartla ödediysen kartı seç (taksit seçeneği çıkar).
- **Maaş**: Özet'teki "Maaş geldi mi?" kartında **Geldi** → tutarı kontrol et → **Şelaleyi gör** → **Onayla ve dağıt**.
- **Ek gelir**: + › Gelir → tutar ve kaynak → **Şelaleyi gör** (paylar düzenlenebilir) → **Onayla ve dağıt**. Paylar "yapılacak havale" olur.
- **Havaleler / ödemeler**: Özet'teki listeden aç → bankadan yaptıktan sonra **Yaptım / Ödendi** (tutar, hesap, tarih değiştirilebilir) ya da **Atla**. Hemen ardından çıkan **Geri al** ile ya da Hareketler'den kaydı silerek ödeme yeniden "yapılacak" olur.
- **Kayıt düzeltme**: Özet › Son hareketler › **Tümü** → kayda dokun → düzenle ya da sil.
- **Bakiye kontrolü**: Cüzdan › hesaba dokun → bankadaki rakamı yaz → **Eşitle**. Yatırım hesabında da aynısı (güncel değer).
- 🚧 **Ekstre**: PDF'i bankanın uygulamasından indir (Garanti BBVA › Kartlar › Ekstre; Yapı Kredi › Kartlarım › Ekstre), Drive › Bütçe › Ekstreler'e kaydet (ad önerisi: `YYYY-AA-GG Garanti ekstresi.pdf`, `YYYY-AA-GG YapiKredi ekstresi.pdf`).
  Pazartesi sabahı okunur. Bulgulara dokunup "Hallettim / İtiraz ettim / Sorun değil" de. Kategorisi belli olmayan satıra dokunup kategoriyi seç; o işyeri bir dahaki sefere kendiliğinden gelir.
  Son ödemeden sonra yalnız asgari ödendiyse Claude'a söyle: `node ekstre.js --dosya "<pdf>" --odenen <ödenen tutar>` kısmi ödeme bulgusunu (kalan borcun faizi) ekler.

---

## Kendine uyarlama

| İstek | Nereden |
|---|---|
| Limitler, beklenmeyen payı, şelale oranları, havuz hedefi, beklenen maaş | Uygulamada Ayarlar |
| Kategori ekle / "İş gideri" işareti / hızlı girişte göster | Ayarlar › Kategoriler |
| Sabit ödeme, abonelik (otomatik), yıllık ödeme | Ay › Sabit kalemleri düzenle (ya da Ayarlar › Sabit ödemeler) |
| Hesapların görevi (harcama, maaş, havuz, birikim, yatırım) | Ayarlar › Hesapların görevi |
| PIN unuttum | `node anahtar.js --pin-sifirla` |
| Maaş günü değişti | `ay_baslangic_gunu` ayarı; Claude'a söyle (geçiş ayını o hesaplar, önce yedek alır) |
| 🚧 Başka bankanın ekstresi | Claude PDF'i okur ve **aynı adla `.json`** yazar: `{banka, kesim, son_odeme, onceki_borc, borc, asgari, limit_tutar, kullanilabilir, kalan_taksit, faiz_alisveris, faiz_gecikme, faiz_nakit, sonraki_kesim, sonraki_son_odeme, duyurular:[], satirlar:[{tarih, aciklama, tutar, taksit_no, taksit_sayisi, taksit_toplam, doviz, sanal, puan}]}` (tutarlar kuruş, ödemeler eksi; `puan`: puanla ödenen satır). `ekstre.js` JSON'u PDF'e tercih eder. Kalıcı çözüm: `ekstre-oku.js`'e okuyucu eklemek ve banka kodunu uygulamadaki seçime eklemek (`app.js` › Ekstre bankası). |
| 🚧 İşyeri → kategori kuralları | `public/hesap.js` › `KATEGORI_KURALLARI` (ekstre okuyucuyla gelecek) |
| Ad, renk, simge | `public/index.html` (`:root` renkleri), `yayinla.js` (`AD`, `KISA_AD`, simge renkleri ve harfleri) → `node yayinla.js --ikon` (ek program gerekmez) |

---

## Tuzaklar

| Tuzak | Ne olur | Çözüm |
|---|---|---|
| Proje uzun bir klasör yolunda (Masaüstü › İndirilenler › … gibi) | yerel denemede `wrangler d1 … --local` "internal error" verir (Windows 260 karakter sınırı) | projeyi kısa yola taşı: `C:\Projeler\bank-of-usy` |
| Kodda takvim ayı kullanmak (`getMonth()`, `strftime('%m')`) | 1–9 arası kayıtlar yanlış aya düşer | her zaman `butceAyi()`; SQL'de ay sütunu kayıtla birlikte yazılır |
| Ayın 9'u gece yarısı | UTC/yerel saat farkıyla kayıt yanlış bütçe ayına geçer | tarihler `Europe/Istanbul` gününe göre hesaplanır |
| Sırları yükledikten hemen sonra deneme | birkaç saniye her istek 403 | 10 sn bekle, tekrar dene |
| iPhone'da Chrome'dan "Ana Ekrana Ekle" | uygulama gibi açılmaz, hep tarayıcıya atar | Safari kullan |
| Windows'ta `process.exit()` + açık fetch | Node çöker, çıkış kodu 127 (görev "hata" der) | `process.exitCode` kullan |
| `wrangler d1 execute --command "…"` | Windows kabuğu tırnakları bozar | SQL'i dosyaya yaz, `--file` (+ `--json`) |
| `wrangler dev`'i durdurmak | `workerd.exe` arkada kalır, eski kod cevap verir (yazılırken gerçekten oldu) | komut satırında `bank-of-usy` geçen node/workerd süreçlerini kapat |
| `.dev.vars` değişti | çalışan `wrangler dev` eski anahtarları kullanır | `wrangler dev`'i kapat (yukarıdaki gibi) ve yeniden başlat |
| Arayüz değişti ama telefonda eski hali | service worker eski dosyaları önbellekten verir | `node yayinla.js` (önbellek adı içerikten değişir) → `npx wrangler deploy`; telefonda uygulamayı kapatıp aç |
| Otomatik ödemeyi "Geri al" | ertesi gün bakımda yeniden işlenir (otomatik olduğu için) | ödenmeyecekse **Atla** |
| `test/yerel-sifirla.sql` | `--remote` ile çalışırsa BÜTÜN canlı veri silinir | yalnız `--local`; canlıda önce yedek (kural 2) |
| Yerel D1 `database_id`'ye bağlı | id değişince yerel veritabanı boş ("no such table") | `npx wrangler d1 migrations apply bank-of-usy --local` |
| `node --test test/` | MODULE_NOT_FOUND | `npm test` (`node --test test/*.test.js`) |
| PowerShell 5.1 + Türkçe harf | BOM'suz `.ps1` bozulur | `.ps1` dosyaları ASCII |
| 🚧 pdfjs-dist 6'da `doc.destroy()` | "not a function" | yükleme görevini kapat (`gorev.destroy()`) |
| 🚧 Puanla ödeme satırı ödeme sanılır | kart borcu az, harcama eksik görünür | okuyucu puan satırını `puan: true` işaretler; mutabakatta ayrı toplanır |
| Excel dosyası açıkken arşiv | o dosya yazılamaz (çıkış kodu 2) | sonraki çalışmada kendiliğinden yeniden dener |
| Excel'de sayı biçimi | 1,500.00 görünebilir | açan cihazın ayarına uyar; Türkçe cihazda 1.500,00 |
| Para tutarına Türkçe ek (`₺'ye`) | "lira" diye okunur, ek yanlış düşer | metinde eksiz kur ("… ₺ için") |

---

## KLC'den farklar

| Konu | BANK OF KLC | BANK OF USY |
|---|---|---|
| Ad, Worker, veritabanı | bank-of-klc | **bank-of-usy** |
| Ay | takvim ayı (1'i) | **bütçe ayı 10'undan 9'una** (`ay_baslangic_gunu`), çekiş her 10'unda |
| Gelir | maaş "Gelir" olarak elle | **beklenen maaş** + "Maaş geldi mi?" kartı; düzensiz ek gelir ayrı kaynak, tahmine katılmaz |
| Ekstre okuyucu | İş Bankası (Maximum), Enpara | **Garanti BBVA (Bonus), Yapı Kredi (World)**; puan satırları ayrı |
| Kurulum sihirbazı | 5 adım | 6 adım (başa **Gelir** eklendi) |
| Bölümler | hepsi | hepsi (ekstre, Excel arşivi, iş giderleri, yatırım) korunuyor |
