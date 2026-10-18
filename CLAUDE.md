# BANK OF USY — Claude için proje notları

Kişisel bütçe uygulaması; iPhone'da Safari › Ana Ekrana Ekle ile kullanılan statik PWA. **Sunucu yok**:
bütün veri telefonda (IndexedDB), PIN'le şifreli. Bu dosyada kişisel bilgi yoktur ve olmamalıdır;
kullanıcının rakamları ve ilerleme notu depo DIŞINDA (`..\DEVAM-NOTU.md`) durur. `KURULUM.md` el kitabıdır
(ne yapar, para kuralları, telefona kurulum, yedek, yayın); yeni özellikte onu da güncelle.

## Çalışma şekli
- Kullanıcıyla Türkçe, sade dille konuş; teknik terimi açıkla. Kullanıcı kod yazmıyor.
- "Önce konuşalım / planlayalım" der: plan onaylanmadan kod yazma; sorular tek mesajda, numaralı.
- Ekran değişikliğinden önce taslak göster. Tasarım: **özel bankacılık** (hep koyu, siyah + ince altın,
  serifli büyük rakamlar). Kullanım kuralları: `..\KULLANICI-DOSTU.md` (klavyesiz, "Geri al", sadelik).
- Dışarıya dönük her iş (GitHub'a gönderme, yayın, silme) için önce onay al.
- Gerçek kişi verisi koda, denemelere, depoya girmez; denemeler uydurma veriyle.

## Yapı
| Dosya | Görev |
|---|---|
| `public/hesap.js` | BÜTÜN hesaplar (saf). Bütçe ayı `butceAyi()` — ay 10'unda başlar; `getMonth()` kullanma. Tutarlar kuruş (tam sayı). Tarihler 'YYYY-AA-GG', Türkiye günü. |
| `public/yerel-api.js` | Telefondaki "sunucu": eski Worker yolları (`/veri`, `/islem`, `/gelir`, `/kurulum`, `/kisma/:pzt`, `/ice-aktar`, `/deneme`…). Yazmalar belgenin kopyasında yapılır, hatasızsa kaydedilir; istekler sırayla. Günlük bakım `/veri`'de günde bir. |
| `public/depo.js` | IndexedDB (tek belge) + `sifreliKasa` (PIN → PBKDF2 600.000 → AES-GCM) + yedek dosyası (`yedekMetni`/`yedekOku`). |
| `public/app.js` | Arayüz; hesap yapmaz. `istek(yol, {yontem, govde})` → yerel-api. |
| `public/excel.js` | Excel sayfaları (saf). Dosyayı app.js SheetJS ile yazar (`public/vendor/xlsx.full.min.js`, 0.20.3, yalnız aktarırken yüklenir). |
| `public/ice-aktar.js` | İçe aktarma dosyası biçimi ve eşleştirme (biçim dosyanın başında; tutar KURUŞ). |
| `public/deneme.js` | Deneme verisi (yalnız kurulumdan önce). |
| `public/index.html` | Görünüm ve tema (`:root` renkleri). |
| `yayinla.js` | manifest + `sw.js` (önbellek adı içerikten) + simgeler. Yeni dosya eklenince `KABUK` listesine ekle. |
| `sunucu.js` | Yalnız yerel deneme: `node sunucu.js` → http://localhost:8787 |
| `test/*.test.js` | `npm test` (node --test). |

Para düzeni: gelir havuzu yok (eski havuz/şelale kodu eski kurulumlar için duruyor). Maaşta
`gelirDagitimi` (ayın planı kalır, `yatirim_tutari` ± artan bütçe yatırıma). Haftalık fark
`artanButce`'ye; eksiye düşünce `kismaDagit` sonraki haftayı kısar; `aySonundan[pzt]` işaretli haftanın açığı sayılmaz (`/hafta/:pzt/ay-sonundan`). `aile` işaretli gider/sabit
bütçeye girmez → `aileAlacagi`. `ARTAN_KATEGORI = 'artan-butce'` sanal kategori.

## Kurallar
- Hesap mantığı `hesap.js`'te; arayüz yalnız gösterir. Yeni kural → birim denemesi.
- Kimlikler `^[\w:.-]{6,80}$` (en az 6 karakter); hesap/kategori kimliği `^[\w-]{4,64}$`.
- Kart numarası (Luhn), CVV, banka şifresi tutulmaz. Uygulama para göndermez; havaleler "yapılacak".
- Yayından önce: `npm test` → `node yayinla.js`.

## Tuzaklar (yaşandı)
- Tarayıcıda denerken eski service worker eski dosyayı verir: sayfada önce kayıtları sil
  (`navigator.serviceWorker.getRegistrations()` → `unregister`, `caches.delete`).
- Uygulama sekmesi IndexedDB'yi açık tuttuğu için `indexedDB.deleteDatabase` asılı kalır:
  silmeyi uygulamanın açık olmadığı aynı kökenli bir sayfada yap (ör. `/manifest.json`).
- Önizleme sunucusu oturum klasöründeki `.claude/launch.json` ile başlar (ad: `bank-of-usy`).
- Bash heredoc içinde `node -e`/betik yazarken düzenli ifadelerdeki `\` kaybolabiliyor;
  uzun düzenlemeleri dosyaya yazıp çalıştır, sonra `grep` ile kontrol et.
- iPhone'da `navigator.share` dokunuşun içinde hemen çağrılmalı: dosyayı önceden hazırla.
- Windows'ta Georgia eski usul (inen) rakam gösterir; iPhone'da New York düz rakamdır.
