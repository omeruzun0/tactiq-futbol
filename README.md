# TactIQ Futbol

Büyük Avrupa ligleri, Süper Lig, Şampiyonlar Ligi ve Avrupa Ligi için **oyun tarzı benzerliği**, **taktiksel reaksiyonlar (ofsayt tuzağı, pres/faul baskısı, düşük blok/korner)** ve **oyuncu bazlı eksik etkisi** ile çalışan kapsamlı futbol analiz ve bahis güvenilirlik uygulaması.

## Özellikler
- **Ücretsiz Güncel Sezon Verisi (ESPN)**: 10 büyük turnuvanın güncel sezon maçları ve detaylı istatistikleri (faul, korner, sarı/kırmızı kart, şut, isabetli şut, ofsayt, topa sahip olma, pas isabeti, ilk yarı skoru).
- **Oyun Tarzı Benzerliği**: Her takımın 12 boyutlu profili çıkarılır; analizde rakibin tarzına en çok benzeyen takımlara karşı oynanan maçlara daha yüksek ağırlık verilir.
- **Hem MS Hem İY Pazarları**: Maç Sonucu, Goller, Faul, Korner, Kart, Şut, İsabetli Şut ve Ofsayt için hem Maç Sonucu (MS) hem İlk Yarı (İY) olasılıkları.
- **Kadro & Oyuncu Etkisi**: Kilit oyuncuları eksik/yedek işaretleyerek olasılıkların anlık yeniden hesaplanması.

## Yerel Çalıştırma
```bash
npm install
npm run dev
```

## Render.com Üzerinde 7/24 Ücretsiz Yayınlama
1. Bu klasörü GitHub'da bir repoya yükleyin.
2. [render.com](https://render.com) üzerinde **New + → Blueprint** seçin ve GitHub reponuzu bağlayın.
3. `render.yaml` otomatik algılanır — **Apply** butonuna basın; birkaç dakika içinde kalıcı `https://tactiq-futbol.onrender.com` adresiniz hazır olur.
