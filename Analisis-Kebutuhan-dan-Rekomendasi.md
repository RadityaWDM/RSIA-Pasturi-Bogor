# Analisis Kebutuhan dan Rekomendasi: Sistem Antrean RSIA Pasutri Bogor

Disusun 23 Okt 2026 sebagai Forward Deployed Engineer / System Analyst.
Kasus: rumah sakit memakai Khanza dan butuh sistem antrean baru. Kasus nyata yang dipakai: RSIA Pasutri Bogor.

> Dokumen ini membedakan tiga tingkat keyakinan: **[Fakta]** ada buktinya, **[Dugaan]** masuk akal tapi belum dibuktikan, **[Belum tahu]** harus ditanyakan. Jangan menganggap dugaan sebagai fakta saat bicara dengan klien.

---

## 1. Ringkasan dan rekomendasi

**Rekomendasi: bangun lapisan baru yang terhubung ke Khanza (opsi D). Jangan ubah kode Khanza, dan jangan menggantinya.**

Alasan utama:
1. Khanza bukan sekadar sistem antrean. Ia SIMRS lengkap (pendaftaran, rekam medis, farmasi, bridging BPJS). Mengganti seluruhnya jauh melampaui kebutuhan dan berisiko besar.
2. Khanza berlisensi yang melarang pihak lain mengambil keuntungan darinya tanpa izin pembuatnya. Mengubah Khanza sebagai pekerjaan berbayar berpotensi melanggar lisensi. Produk terpisah yang hanya terhubung ke Khanza lebih aman, **tetapi ini perlu dicek ke pembuat Khanza atau penasihat hukum.**
3. Kebutuhan yang belum terpenuhi (booking online, WhatsApp, layar antrean, dashboard) adalah teknologi web, bukan teknologi desktop Khanza.
4. Penyebab sebenarnya dari "nomor error" dan "antre 2 jam" **belum diketahui**. Membangun apa pun sebelum diagnosis adalah berjudi. Karena itu langkah pertama adalah diagnosis, bukan koding.

Satu hal yang harus diluruskan ke klien: "Khanza" bukan sistem antrean. Antrean hanya salah satu modulnya. Yang dibahas adalah melengkapi atau memperbaiki fungsi antrean dan pendaftaran, bukan mengganti Khanza.

---

## 2. Apa yang kita tahu (bukti)

| # | Temuan | Sumber | Tingkat |
|---|---|---|---|
| 1 | RS memakai Khanza untuk pendaftaran dan antrean; antrean BPJS dan umum satu urutan; website dikelola tim IT | Balasan WhatsApp PIC, 23 Okt 2026 | Fakta (jawaban singkat, perlu konfirmasi) |
| 2 | Ulasan Google (473 ulasan, rating 4,1): nomor pendaftaran error sehingga ditulis manual; antrean dobel luar-dalam; antre dokter kandungan hingga ±2 jam | Data lead, mengutip Google Maps | Fakta untuk isi ulasan; **penyebabnya belum diketahui** |
| 3 | Form booking website: hanya NIK wajib, tanpa validasi, BPJS/asuransi tanpa nomor kartu dan rujukan, tanpa konfirmasi atau nomor antrean, tanpa ubah atau batal | Pembacaan website 22 Okt 2026 | Fakta |
| 4 | Halaman Dokter tanpa jadwal praktik; Komentar wajib login dan tanpa tiket | Website | Fakta |
| 5 | Khanza gratis dan open source, dipakai di "lebih dari 1000 RS", punya modul antrean loket, poli, apotek, anjungan pasien mandiri, bridging BPJS (termasuk Mobile JKN), dan aplikasi web | [Repositori GitHub](https://github.com/mas-elkhanza/SIMRS-Khanza) | Fakta (modul diambil dari nama folder, bukan dari dokumentasi) |
| 6 | Lisensi Aladdin Free Public License: dilarang memperjualbelikan atau mengambil untung dalam bentuk apa pun tanpa izin pembuatnya | Repositori yang sama | Fakta; arti hukumnya perlu dikonfirmasi |
| 7 | Arsitektur client-server; komponen web berbasis PHP dengan database MySQL atau sejenisnya (MariaDB) | Studi akademis (sumber sekunder) | Dugaan kuat |
| 8 | Studi di rumah sakit lain: antarmuka padat dan butuh waktu belajar, kecepatan menurun di jam sibuk, staf bergantung pada IT karena tidak ada panduan, sebagian dokter kembali ke kertas | Studi kepuasan pengguna registrasi Khanza (lihat bagian 11) | Dugaan: studi kecil di RS lain, bukan di RSIA Pasutri |
| 9 | Pendaftaran online di RS lain yang memakai SIMRS sering sepi pemakainya; pendaftaran lewat WhatsApp gagal ketika petugas harus meneruskan dan mengetik ulang setiap permintaan | Studi RSUD SLG Kediri dan RSGM Jember | Dugaan, tapi berguna sebagai peringatan desain |
| 10 | Dokumentasi API resmi Khanza, skema tabel, dan apakah ada modul booking online | Tidak ditemukan | **Belum tahu** |

Catatan jujur: bukti kelemahan Khanza di nomor 8 dan 9 berasal dari studi kecil di rumah sakit lain, bukan RSIA Pasutri. Saya tidak menemukan studi yang mengukur waktu tunggu antrean Khanza di jam sibuk. Jadi "Khanza lambat" belum boleh dikatakan sebagai fakta tentang RSIA Pasutri.

---

## 3. Pemangku kepentingan dan masalah mereka

| Pihak | Masalah yang terindikasi | Yang mereka butuhkan |
|---|---|---|
| Pasien dan keluarga | Tidak tahu giliran, menunggu lama tanpa kabar, bingung memilih jadwal, nomor terlewat | Booking yang jelas, estimasi tunggu, kabar lewat WhatsApp, bisa melacak nomor |
| Staf pendaftaran | Nomor error lalu menulis manual, antrean dobel, harus menjawab pertanyaan berulang | Nomor yang tidak mungkin dobel, mode cadangan saat sistem macet, satu layar kerja |
| Dokter dan perawat poli | Pasien datang tidak berurutan, tidak ada tanda pasien sudah siap | Antrean per dokter yang jelas dan urut |
| Tim IT | Menjadi pusat dukungan; tidak ingin sistem inti terganggu | Perubahan terkontrol, akses terbatas, tanpa risiko bagi Khanza |
| Manajemen | Tidak punya data waktu tunggu, no-show, keterlambatan dokter; keluhan hanya terlihat dari ulasan Google | Dashboard dan laporan yang dapat dipercaya |

---

## 4. Kebutuhan

Prioritas memakai MoSCoW. **Semua kebutuhan perlu dikonfirmasi ke klien**; ini turunan dari bukti di atas, bukan permintaan resmi klien.

### Fungsional
| ID | Kebutuhan | Prioritas | Dasar |
|---|---|---|---|
| F1 | Nomor antrean berurutan, tidak mungkin ganda, satu urutan untuk online dan walk-in | Must | Ulasan Google, jawaban PIC (BPJS dan umum satu urutan) |
| F2 | Mode darurat bila sistem inti tidak tersedia, dan sinkron setelah pulih | Must | Ulasan: "nomor error, ditulis manual" |
| F3 | Booking online dengan jadwal dokter nyata, kuota per slot, validasi data, dan data penjamin (BPJS + rujukan) | Must | Temuan website |
| F4 | Konfirmasi dan estimasi tunggu lewat WhatsApp | Should | Form lama tanpa konfirmasi |
| F5 | Layar antrean per poli (TV dan ponsel) | Should | Ulasan: pasien tidak tahu giliran |
| F6 | Status Dilewati dengan panggil ulang terbatas, dan panggilan di luar urutan wajib beralasan | Should | Keluhan nomor terlewat |
| F7 | Peringatan dokter terlambat kepada pasien | Should | Dugaan penyebab antre lama |
| F8 | Ubah dan batalkan booking mandiri | Should | Temuan website |
| F9 | Keluhan berbentuk tiket dengan SLA | Could | Halaman Komentar wajib login |
| F10 | Dashboard: waktu tunggu per poli, no-show, kanal, keterlambatan, SLA keluhan | Should | Manajemen tidak punya data |
| F11 | Jejak audit semua pemanggilan dan perubahan | Should | Dasar menelusuri keluhan |

### Non-fungsional
- **Ketersediaan:** gangguan sistem baru tidak boleh menghentikan pendaftaran. Target dan jam sibuk perlu disepakati.
- **Keamanan dan data pribadi:** NIK dan data kesehatan termasuk data pribadi sensitif (UU PDP). Persetujuan, enkripsi, dan pembatasan akses wajib. Khanza **tidak boleh** dibuka langsung ke internet.
- **Kinerja:** responsif di jam sibuk. Angka target belum bisa ditetapkan sebelum ada data baseline.
- **Kemudahan pakai:** staf pendaftaran harus bisa memakai tanpa pelatihan panjang. Pelajaran dari studi Khanza: antarmuka padat dan tanpa panduan membuat staf bergantung pada IT.
- **Dapat dirawat:** tidak boleh rusak saat Khanza diperbarui.

### Keluaran yang diinginkan klien (usulan, belum dikonfirmasi)
1. Pasien mendapat nomor antrean dan kabar lewat WhatsApp.
2. Layar antrean di ruang tunggu.
3. Waktu tunggu dokter kandungan turun dibanding sekarang. **Targetnya belum bisa disebut angka sebelum baseline diukur.**
4. Tidak ada lagi pendaftaran manual karena nomor error.
5. Laporan bulanan untuk manajemen.

---

## 5. Analisis kesenjangan Khanza terhadap kebutuhan

| Kebutuhan | Yang diketahui tentang Khanza | Kesenjangan | Status |
|---|---|---|---|
| F1 Nomor tidak ganda | Ada modul antrean loket dan poli | Penyebab nomor error belum diketahui; bisa konfigurasi, beban, jaringan, atau alur kerja | **Belum tahu** |
| F2 Mode darurat | Tidak ada informasinya | Kemungkinan tidak ada | Belum tahu |
| F3 Booking online | Repositori tidak mencantumkan modul booking secara jelas; RS punya `pendaftaran.php` sendiri di website | Tidak jelas apakah booking website masuk ke Khanza otomatis | **Belum tahu, sangat penting** |
| F4 WhatsApp | Tidak ditemukan modul bawaan | Kemungkinan perlu tambahan | Dugaan |
| F5 Layar antrean | Ada modul antrean poli (dari nama folder) | Mungkin sudah ada; kualitas dan pemakaiannya belum dicek | Belum tahu |
| F6/F7 Dilewati dan dokter terlambat | Tidak ada informasinya | Kemungkinan tidak ada | Belum tahu |
| F10 Dashboard | Ada modul laporan, tetapi studi menilai laporan keuangan di satu RS kurang efektif | Dashboard waktu tunggu dan keterlambatan belum dipastikan | Belum tahu |
| Antarmuka dan kecepatan | Studi: padat, lambat di jam sibuk | Belum diukur di RSIA Pasutri | Dugaan |

**Kesimpulan kesenjangan:** kita belum bisa menyatakan apa kekurangan Khanza di RSIA Pasutri. Yang bisa dikatakan hanyalah bagian mana yang belum dibuktikan ada atau tidak. Itu sebabnya diagnosis harus mendahului pembangunan.

---

## 6. Opsi dan penilaian

| | A. Atur ulang dan optimalkan Khanza | B. Ubah atau kembangkan kode Khanza | C. Bangun sistem baru berdiri sendiri | **D. Lapisan baru terhubung ke Khanza** |
|---|---|---|---|---|
| Intinya | Perbaiki konfigurasi, jaringan, pelatihan, aktifkan modul yang ada | Tambah fitur di dalam Khanza | Ganti pendaftaran dan antrean seluruhnya | Aplikasi web terpisah; Khanza tetap pusat data |
| Risiko ke operasional RS | Rendah | **Tinggi** | **Sangat tinggi** | Rendah-sedang (tahap baca-saja rendah) |
| Risiko lisensi | Tidak ada | **Tinggi** (kerja berbayar di atas Khanza) | Rendah | Sedang, perlu konfirmasi |
| Cocok untuk WhatsApp, booking web, layar, dashboard | Tidak | Sulit (aplikasi desktop) | Ya | Ya |
| Risiko nomor ganda | Tidak ada | Rendah | **Tinggi** (data dobel jika jalan berdampingan) | Rendah bila nomor tetap satu sumber |
| Beban kerja staf | Sama | Sama | Naik (migrasi, pelatihan, data ganda) | Sedang |
| Tahan terhadap pembaruan Khanza | Ya | **Tidak** (rawan rusak) | Ya | Sedang (bergantung skema yang dibaca) |
| Biaya dan waktu | Paling murah dan cepat | Sedang-tinggi | Paling tinggi | Sedang, bertahap |
| Menjawab penyebab error | Hanya bila penyebabnya konfigurasi | Tidak jelas | Tidak jelas | Hanya membuat dampaknya lebih kecil dan terlihat |

### Keputusan: D, dengan A sebagai langkah paling awal
- **A dilakukan dulu** karena bisa saja sebagian besar masalah bisa diselesaikan dengan konfigurasi dan pelatihan. Itu hasil terbaik untuk klien dan terhormat bila terbukti.
- **D untuk kebutuhan yang memang tidak ada di Khanza** (booking dan WhatsApp, layar, dashboard, dilewati, keterlambatan dokter).
- **B dihindari** karena risiko lisensi dan pembaruan.
- **C tidak direkomendasikan** kecuali Khanza terbukti tidak bisa dihubungkan sama sekali.

### Yang akan mengubah keputusan
| Temuan nanti | Keputusan berubah menjadi |
|---|---|
| Modul antrean dan booking Khanza ternyata sudah memadai, masalah hanya konfigurasi atau jaringan | Cukup A, ditambah layar dan WhatsApp ringan |
| IT melarang akses data Khanza | Sistem berdiri sendiri sementara (C terbatas) dengan alur kerja ketat agar tidak mengetik dua kali |
| Pembuat Khanza atau penasihat hukum menyatakan hubungan ke Khanza bermasalah | Hubungan hanya lewat file ekspor atau antarmuka resmi |
| Penyebab error ada di server atau jaringan | Perbaikan infrastruktur menjadi prasyarat, di luar lingkup kita |

---

## 7. Rancangan solusi (opsi D)

- **Khanza tetap pusat** untuk data pasien dan nomor antrean.
- **Aplikasi baru** (server terpisah, sistem yang sudah kita buat sebagai prototipe) menangani booking web, WhatsApp, layar antrean, status dilewati, peringatan dokter terlambat, jejak audit, dan dashboard.
- **Jalur ke Khanza:** aplikasi baru membaca detail langsung dari database Khanza, tanpa replika, lewat akun read-only. Keputusan ini perlu disetujui tim IT. Tidak membuka Khanza ke internet.
- **Mode tahan gangguan:** jika koneksi ke Khanza putus, tetap bisa memberi nomor sementara dan disinkronkan setelah pulih, dengan penandaan jelas.
- **Prinsip nomor antrean:** satu sumber. Jika sumber nomor kita pindahkan ke aplikasi baru, itu keputusan bersama dengan IT, bukan default.

Prototipe yang sudah ada (`index.html`) dan rancangan database (`database/`) adalah bahan peragaan. Rancangan database itu perlu disesuaikan lagi dengan skema Khanza sebelum dipakai nyata.

---

## 8. Rencana tindak lanjut

### Fase 0, Penemuan dan diagnosis (perkiraan 2 minggu)
| Kegiatan | Hasil |
|---|---|
| Dikenalkan ke tim IT; wawancara teknis (lihat bagian 9) | Gambaran Khanza, versi, jaringan, server, dan batas akses |
| Pengamatan langsung di loket pendaftaran 2–3 hari, termasuk jam sibuk | Alur kerja nyata, di mana nomor error, bagaimana antrean dobel terjadi |
| Minta log error Khanza dan data waktu tunggu 1 bulan (atau ukur manual 1–2 minggu) | **Baseline** waktu tunggu per poli |
| Cek lisensi dengan pembuat Khanza atau penasihat hukum | Kepastian boleh atau tidak membangun di sekitarnya |
| Wawancara manajemen dan staf poli | Prioritas, target, dan definisi sukses |
| **Keputusan:** A cukup atau lanjut D | Dokumen keputusan |

### Fase 1, Baca-saja (perkiraan 4–6 minggu setelah Fase 0)
Layar antrean dan dashboard dari data Khanza tanpa mengubahnya. Risiko terkecil, nilai terlihat cepat.

### Fase 2, Booking, WhatsApp, dilewati, dokter terlambat
Booking web dengan jadwal nyata, penulisan balik ke Khanza lewat jalur yang disetujui IT, dan WhatsApp (perlu akun dan izin template pesan resmi).

### Fase 3, Penguatan dan uji coba
Mode darurat, pemantauan, uji beban jam sibuk, pelatihan, uji coba terbatas di satu poli (usulan: Kebidanan dan Kandungan karena keluhannya paling berat) lalu diperluas.

### Ukuran keberhasilan (usulan, disepakati setelah baseline)
- Waktu tunggu rata-rata per poli (check-in sampai dipanggil), terutama Kebidanan.
- Jumlah kejadian nomor error atau pendaftaran manual per bulan.
- Persentase pasien tidak hadir.
- Persentase booking lewat online dan WhatsApp.
- Jumlah keluhan antrean, dan waktu respons keluhan.

---

## 9. Pertanyaan untuk digali

### Untuk tim IT (teknis)
1. Versi Khanza yang dipakai, dan kapan terakhir diperbarui?
2. Server dan database: satu mesin atau terpisah, berapa pengguna bersamaan, dan berapa beban baca yang aman di jam sibuk?
3. "Nomor error" itu seperti apa: pesan error, kapan terjadi (jam sibuk?), di komputer mana, seberapa sering?
4. Apakah ada log error dan data waktu pendaftaran yang bisa diminta?
5. Apakah modul antrean poli, anjungan pasien mandiri, dan layar antrean Khanza dipakai? Kalau tidak, kenapa?
6. Website `pendaftaran.php`: dibuat siapa, apakah datanya masuk Khanza otomatis atau diketik ulang petugas?
7. Apakah IT mengizinkan akses baca ke database atau perlu jalur lain? Siapa yang menyetujui?
8. Jaringan dan perangkat: apakah ada TV di ruang tunggu, kiosk, dan koneksi internet yang stabil?

### Untuk manajemen
1. Apa definisi sukses: waktu tunggu berapa menit, atau keluhan turun berapa persen?
2. Poli mana yang paling prioritas?
3. Siapa pengambil keputusan, dan bagaimana proses persetujuan (IT, direksi)?
4. Anggaran dan model kerja sama yang diinginkan?
5. Apakah RS sudah memakai WhatsApp Business API?

### Untuk staf pendaftaran dan poli
1. Ceritakan hari paling kacau: apa yang terjadi saat nomor error?
2. Bagaimana pasien BPJS dan umum dilayani, dan kapan nomor dipanggil di luar urutan?
3. Berapa dokter dan sesi per hari, dan kuota per sesi?

---

## 10. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Lisensi Khanza melarang mengambil untung | Proyek terhenti atau sengketa | Konfirmasi tertulis ke pembuat Khanza atau penasihat hukum di Fase 0; hindari mengubah kode Khanza |
| Penyebab error di luar sistem kita (server, jaringan) | Sistem baru dianggap gagal | Diagnosis lebih dulu; sepakati batas tanggung jawab di awal |
| IT menolak atau menunda akses | Jadwal mundur | Libatkan IT sejak hari pertama; posisikan sebagai membantu IT, bukan mengambil alih |
| Skema Khanza berubah saat pembaruan | Integrasi rusak | Gunakan lapisan penerjemah tunggal; uji setiap pembaruan |
| Dua sumber nomor antrean | Antrean dobel muncul lagi | Satu sumber; keputusan bersama IT |
| Data pribadi bocor | Pelanggaran UU PDP dan reputasi | Enkripsi, akses terbatas, jejak audit, tanpa membuka Khanza ke internet |
| WhatsApp butuh izin dan biaya resmi | Notifikasi tertunda | Mulai pengajuan akun dan template sejak Fase 0 |
| Pendaftaran online sepi pemakai (seperti di RS lain) | Manfaat tidak terasa | Ajak pasien lewat WhatsApp dan petugas loket; ukur kanal setiap bulan |
| Staf menolak atau kembali ke cara lama | Data tidak lengkap | Pelatihan singkat, antarmuka sederhana, libatkan staf sejak awal |
| Aturan BPJS (rujukan berjenjang, kuota Mobile JKN) | Booking tidak sah atau bentrok | Pelajari aturan di Fase 0; sinkron dengan kuota Mobile JKN |

---

## 11. Sumber

- [Repositori SIMRS Khanza (GitHub)](https://github.com/mas-elkhanza/SIMRS-Khanza): lisensi, modul, statistik. Modul dibaca dari nama folder, bukan dokumentasi.
- Studi kepuasan pengguna registrasi Khanza, dan studi lain di rumah sakit lain (dikumpulkan dari pencarian; **teks lengkap belum dibaca, ukuran sampel tidak diketahui**): [jurnal 1](https://ejournal.unigamalang.ac.id/index.php/RDOS/article/download/681/379/1938), [jurnal 2](https://ejournal.stiesia.ac.id/kreanova/article/download/5343/858/7572), [jurnal 3](https://journal.univawalbros.ac.id/index.php/jham/article/download/916/v7n1/4364).
- Kuota Mobile JKN dan transfer data dari SIMRS di satu rumah sakit: [jurnal Politeknik Kebumen](https://jurnal.politeknik-kebumen.ac.id/jurpikat/article/download/2028/978).
- Percakapan WhatsApp dengan PIC RSIA Pasutri (23 Okt 2026) dan pembacaan website rsiapasutri.co.id (22 Okt 2026).

---

## 12. Keterbatasan analisis ini

- Jawaban PIC sangat singkat dan baru empat poin.
- Bukti kelemahan Khanza berasal dari studi di rumah sakit lain.
- Tidak ada akses ke sistem Khanza RSIA Pasutri, ke log, atau ke data waktu tunggu nyata.
- Belum ada konfirmasi bahwa klien memang menginginkan sistem baru; bisa saja kebutuhannya cukup dipenuhi dengan optimalisasi Khanza.
- Perkiraan waktu fase adalah usulan kasar, belum dihitung dari ukuran pekerjaan sebenarnya.
