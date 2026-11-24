# Video Wallpaper — Orca için video arka plan

[Orca](https://github.com/stablyai/orca)'nın arka planında döngüde oynayan bir video gösterir. Kenar
paneller (çalışma alanı listesi, dosya paneli, sekme/başlık çubuğu) ve orta sohbet alanı ayrı ayrı
saydamlaştırılabilir. Videolar bilgisayardan dosya olarak ya da URL ile (YouTube dahil) eklenir ve bir
kütüphaneden tek dokunuşla değiştirilir.

*English: an Orca plugin that plays a looping video behind Orca, with separate transparency for the side
panels and the center chat area, and a library of videos added from a file or a URL (YouTube included).
Windows only. The panel is in Turkish.*

## Gereksinimler

- Windows 10/11
- Orca 1.4.246 veya üstü (varsayılan kullanıcı kurulumu: `%LOCALAPPDATA%\Programs\orca`)
- [ffmpeg](https://ffmpeg.org), [yt-dlp](https://github.com/yt-dlp/yt-dlp) ve [Node.js](https://nodejs.org).
  Eksik olanları panel `winget` ile tek düğmeyle kurabilir.

## Kurulum

```sh
orca plugin install ReL4xi0n/orca-video-wallpaper
```

Orca, eklentiyi etkinleştirmeden önce onay ister (aşağıdaki "Eklentinin yetkileri"ne bakın) ve onay
için bir parmak izi verir:

```sh
orca plugin install ReL4xi0n/orca-video-wallpaper --approve <parmak-izi>
```

Sonra paneli açın: sağ kenar çubuğunda **Video Wallpaper**.

### İlk kullanım

1. Panelde **Eksik araç** uyarısı varsa **Kur (winget)** düğmesine basın.
2. **Kısayollar ayarlı değil** uyarısında **Kısayolları ayarla** düğmesine basın. Masaüstü, Başlat menüsü
   ve görev çubuğundaki Orca kısayolları, Orca'yı saydamlık başlatıcısıyla açacak şekilde ayarlanır.
3. **Videolarım**'ın yanındaki **+** düğmesine basın; bilgisayardan bir dosya seçin ya da bir bağlantı
   yapıştırın. Video kütüphaneye kapak resmiyle eklenir ve hemen uygulanır. Bir karta dokunmak o videoya
   geçer; kartın sağ altındaki çöp kutusu (onay sorarak) videoyu siler. **Boş** kartı videoyu kapatır,
   Orca normal görünür.
4. Orca ayarlarında tema olarak **Video Background**'u seçin ve **arka plan opaklığını** 1'in altına
   çekin. Orta alan videoyu ancak o zaman gösterir.
5. Orca'yı kapatıp kısayoldan yeniden açın. Kenar panel saydamlığı bu açılıştan itibaren çalışır.

## Nasıl çalışır

Üç parça vardır. Eklenti, ilk açılışta eksik olanları `~/orca-video-theme` klasörüne kendisi kurar.

| Parça | Yer | Görevi |
| --- | --- | --- |
| Eklenti | bu depo | Panel (`panel/`, HTML) ve arka plan işçisi (`src/`): videoları indirir, dönüştürür, kütüphanede tutar, temayı günceller. |
| Video teması | `~/orca-video-theme/theme` | Orca'nın resmi tema arka plan özelliği (`background.videoPath`). Yalnızca veri, kod çalıştırmaz. |
| Saydamlık başlatıcısı | `~/orca-video-theme/tools` | Orca'yı açar ve kenar panellere saydamlık stili ekler. |

Orca'nın kendi tema arka planı yalnızca uygulamanın en arkasında görünür; paneller opak kalır. Panelleri
saydamlaştırmak için başlatıcı Orca'yı kendi alt süreci olarak `--remote-debugging-pipe` ile açar ve
sayfaya küçük bir CSS stili ekler (`assets/tools/inject.js`). Saydamlık değerleri
`~/orca-video-theme/config.json` dosyasından canlı okunur.

Videolar Orca'nın sınırlarına göre dönüştürülür: H.264 MP4, sessiz, en fazla 58 saniye, yaklaşık 7 MB,
30 fps. Video yalnızca Orca penceresi odaktayken oynar, diğer zamanlarda kapak resmi görünür.

## Güvenlik

- **Ağ portu açılmaz.** Başlatıcı `--remote-debugging-port` yerine `--remote-debugging-pipe` kullanır.
  Orca'yı kontrol eden kanal yalnızca başlatıcı sürecinde bulunur; aynı bilgisayardaki başka bir program
  (yerel yapay zekâ ajanları dahil) bu kanala bağlanamaz.
- **Enjekte edilen stil bir kez okunur.** `inject.js` yalnızca Orca açılırken okunur. Orca çalışırken
  dosyaya yazılan kod Orca'ya ulaşmaz. Canlı izlenen tek dosya `config.json`'dur ve oradan yalnızca 0–100
  arasına kırpılan iki sayı alınır.
- **Kısayollar dikkatle değiştirilir.** Yalnızca hedefi `Orca.exe` olan ya da bu başlatıcıyı gösteren
  `Orca.lnk` kısayollarına dokunulur. Kısayol yerinde düzenlendiği için görev çubuğu gruplaması korunur.
  Paneldeki **Kısayolları eski haline getir** düğmesi her şeyi geri alır.
- **Komutlar kabuksuz çalışır.** ffmpeg, yt-dlp ve diğer araçlar `cmd.exe` üzerinden değil, doğrudan
  başlatılır. Böylece dosya adları ve URL'ler komut olarak yorumlanamaz.

### Eklentinin yetkileri

Eklenti `trusted-worker` türündedir: kendi kodunu ayrı bir Node.js sürecinde, sizin kullanıcı
hesabınızın yetkileriyle çalıştırır. Bunu şunlar için kullanır:

- `~/orca-video-theme` klasörünü okumak ve yazmak,
- ffmpeg ve yt-dlp'yi çalıştırmak, eksik araçları `winget` ile kurmak (yalnızca düğmeye basıldığında),
- dosya seçme penceresini ve kısayol işlemlerini PowerShell ile yapmak,
- temayı `orca plugin install` ile yeniden kurmak.

Eklentinin Orca'ya özel bir yetkisi yoktur (`capabilities: []`): sohbetlerinize, çalışma alanlarınıza
veya terminallerinize erişmez. Kurmadan önce `src/` klasöründeki kodu okuyabilirsiniz.

## Kaldırma

1. Panelde **Kısayolları eski haline getir** düğmesine basın.
2. `orca plugin uninstall local.video-wallpaper` (tema) ve eklentinin kendisini Orca'dan kaldırın.
3. İsterseniz `~/orca-video-theme` klasörünü silin (video kütüphaneniz bu klasörde).

## Telif

Eklediğiniz videoların kullanım hakkı size aittir. Bu depo hiçbir video içermez.

## Geliştirme

```sh
orca plugin types .                # tür tanımlarını .orca/types/ içine yazar
orca plugin validate .
orca plugin test .                 # işçi testleri (src/worker.test.ts), geçici bir ev klasöründe
orca plugin shot local.video-wallpaper-studio --panel video-wallpaper-studio   # panelin ekran görüntüsü
node scripts/bundle-assets.mjs     # assets/ değişince src/bundled.ts'i yeniden üretir
```

Orca işçiyi kısaltılmış bir ortamla (`LOCALAPPDATA`, `APPDATA` yok) çalıştırır; klasör yolları bu
yüzden `src/paths.ts`'te ev klasöründen türetilir ve başlatılan programlara tamamlanmış ortam verilir.
Panel, kütüphane klasöründeki resimleri doğrudan yükleyemediği için kapaklar işçiden `data:` adresi
olarak gelir.

`assets/` klasörü tema ve başlatıcı dosyalarının okunabilir kaynağıdır. İşçi kendi kurulum klasörünü
okuyamadığı için bu dosyalar `src/bundled.ts` içine gömülür;
`node scripts/bundle-assets.mjs --check` ikisinin aynı olduğunu doğrular.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
