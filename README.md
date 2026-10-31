# Prototipe Sistem Layanan RSIA Pasutri Bogor

Prototipe demo untuk manajemen RS. Buka `index.html` dengan klik dua kali, tanpa server atau instalasi.

> **Status pencocokan Excel: SUDAH** (`Leads_Outreach_IT.xlsx`, baris No. 5 "RSIA Pasutri Bogor"). Excel ini berupa daftar leads outreach, sehingga kolom masalahnya ada di satu sel "Problem Terindikasi". Hasil pencocokannya di bagian 2.

## 1. Isi folder

| Berkas | Fungsi |
|---|---|
| `index.html` | Prototipe interaktif (3 peran: Pasien, Staf, Manajemen). |
| `database/schema.sql` | Rancangan database PostgreSQL 9.5+ di schema `rsia`: 19 tabel dengan PK, FK, UNIQUE, CHECK, dan index. Tanpa trigger, fungsi, dan view; aturan kuota dan nomor antrean dijaga aplikasi. Belum dijalankan di server 9.5. Versi lama dijalankan di PostgreSQL 18.6. |
| `database/migrasi-kunci-khanza.sql` | Migrasi sekali jalan untuk database yang sudah berisi skema lama: menambah kolom kunci ke Khanza (`pasien.no_rkm_medis`, `booking.no_rawat`) dan **menghapus** kolom demografis pasien. Ambil cadangan dulu. Diuji di PostgreSQL 18.6 dengan skema lama. |
| `database/ERD.md` | Diagram relasi entitas (Mermaid) dan alasan desain. |
| `Analisis-Kebutuhan-dan-Rekomendasi.md` | Analisis kebutuhan, kesenjangan Khanza, perbandingan opsi, keputusan, dan rencana tindak lanjut. |
| `demo/rsia-pasutri-demo.mp4` | Video demo 9,5 menit (1280×720, tanpa suara, dengan kursor dan teks penjelasan): sisi pasien, staf, dan manajemen. |
| `demo/rekam-demo.mjs` | Skrip perekam video (Playwright + Chrome). Jalankan ulang bila prototipe berubah. |
| `Leads_Outreach_IT.xlsx` | Data sumber dari Anda. **Berisi data prospek lain, jangan dibagikan ke pihak RS.** |

## 2. Pencocokan Excel dengan website

Konteks dari Excel: prioritas Tinggi, status **Dibalas** (22 Okt 2026). Kontak: dr. Dhoni Suhendra, MKK (Direktur Operasional). Solusi yang ditawarkan di Excel: sistem antrean online (nomor + estimasi + notifikasi WA), jadwal dokter terintegrasi, dashboard antrean poli, perbaikan website.

### Cocok (Excel dan website sama)

| Masalah di Excel | Bukti di website | Fitur prototipe |
|---|---|---|
| Form booking tidak memberi jam dan nomor antrean | Kolom "Nomor Antrian" kosong, tanpa pesan sukses atau estimasi | Kode booking, nomor antrean, estimasi waktu, pesan WhatsApp |
| Jadwal dokter tidak terintegrasi | Halaman Dokter (27 entri) tanpa jadwal praktik | Jadwal Dokter + Kelola Jadwal sebagai satu sumber |

### Hanya di Excel (ulasan Google Maps, 473 ulasan, rating 4,1)

| Masalah | Fitur prototipe |
|---|---|
| Sistem nomor pendaftaran error, pendaftaran ditulis manual | Nomor dibuat sistem berurutan, form walk-in sebagai cadangan |
| Antrean dobel (luar dan dalam) | Online dan walk-in memakai satu urutan per poli; Layar Antrean |
| Antre dokter kandungan hingga ±2 jam | Estimasi tunggu, dashboard waktu tunggu per poli (data contoh menampilkan Obgyn terlama) |

### Hanya di website (tidak ada di Excel)

Validasi form lemah (hanya NIK wajib), BPJS/Asuransi tanpa no. kartu dan rujukan, tidak bisa ubah/batal booking, halaman Komentar wajib login dan tanpa tiket, gelar dokter tidak seragam, poli penunjang (Anestesi, Radiologi, Patologi) ikut jadi pilihan booking, konten placeholder dan statistik statis.

### Selisih yang belum terselesaikan (periksa sebelum presentasi)

| Klaim Excel | Hasil cek 22 Okt 2026 | Tindakan |
|---|---|---|
| Link "Kontak" di website error 404 | `kontak.php` membuka normal (HTTP 200) | Kemungkinan sudah diperbaiki atau linknya lain. Jangan dipakai sebagai bukti sebelum dicek ulang. |
| Nama dokter diketik manual | Dokter, hari, dan jam berupa dropdown bertingkat. Daftarnya terisi lewat skrip dan tidak mencantumkan jam penuh/terisi | Teks Excel perlu dikoreksi menjadi "dropdown tanpa kuota dan tanpa nomor antrean". |
| Jumlah karyawan 23 (Apollo) | Wajar diragukan untuk RS dengan 27 tenaga medis di halaman Dokter saja | Konfirmasi ke PIC, mempengaruhi skala dan harga. |
| LinkedIn dr. Dhoni berstatus "Open to Work" (catatan Excel) | Belum diperiksa | Pastikan masih menjabat sebelum menyebut jabatan. |

## 3. Isi prototipe

- **Pasien / Keluarga:** Beranda, Booking Poliklinik (5 langkah), Cek/Ubah Booking, Jadwal Dokter, Layar Antrean, Keluhan & Masukan (kirim + lacak tiket).
- **Staf Pendaftaran:** Antrean Hari Ini (kartu per dokter, check-in, panggil, lewati, panggil ulang, no-show, tandai dokter terlambat, daftar walk-in), Daftar Booking, Kelola Jadwal, Inbox Keluhan, Log WhatsApp, Jejak Aktivitas.
- **Manajemen:** Dashboard KPI (kunjungan, no-show, waktu tunggu total dan per poli, kanal, penjamin, keluhan dan SLA) dan peta Masalah → Solusi.

Coba alur: booking sebagai Pasien → Staf: daftarkan walk-in dan panggil antrean → Layar Antrean → Log WhatsApp → Dashboard.

### Antrean terlewat dan antrean lama: apa yang ditangani

| Masalah | Aturan di prototipe | Batasan |
|---|---|---|
| Nomor terlewat atau ganda | Nomor dibuat sistem, urut per poli per hari, online dan walk-in satu urutan | Saat ini hanya terbukti di prototipe. Di backend, nomor harus dibuat lewat `antrean_counter` dalam satu transaksi, dan belum dibuat |
| Pasien dipanggil tapi tidak ada | Status **Dilewati**: WhatsApp ke pasien, boleh dipanggil ulang 1 kali, kedua kalinya dianggap tidak hadir | Batas 1 kali ulang adalah usulan, perlu disetujui RS |
| Siapa dipanggil lebih dulu | Per dokter, berdasarkan **jam booking** lalu nomor, hanya yang sudah check-in. Dokter yang masih melayani tidak bisa dipanggil lagi | Pasien datang awal tidak mendapat prioritas; aturan ini perlu dikonfirmasi |
| Memanggil di luar urutan | Wajib mengisi alasan; tercatat di Jejak Aktivitas | Hanya mencatat, tidak melarang |
| Dokter datang terlambat | Staf tandai 15/30/60 menit: semua pasien dokter itu menerima WhatsApp, estimasi bergeser, banner di Layar Antrean | Keterlambatan dicatat manual oleh staf |
| Antrean lama secara umum | Kuota per slot, estimasi tunggu, dashboard waktu tunggu dan keterlambatan | **Belum terbukti mengurangi waktu tunggu.** Angka di dashboard adalah data contoh. Ukur dulu kondisi sekarang selama 1–2 minggu |

## 4. Yang nyata dan yang contoh

- **Nyata:** 15 nama dokter dan poli (dari 27 entri di website), alamat, kontak, daftar poli di form, serta ringkasan ulasan Google dari Excel.
- **Contoh:** semua jadwal dan jam praktik, kuota slot (2 pasien/slot), pasien, antrean, keluhan, dan angka dashboard, termasuk waktu tunggu Obgyn yang sengaja dibuat lebih lama. Jangan dipresentasikan sebagai data RS.
- **Disederhanakan:** WhatsApp hanya simulasi. Data tidak tersimpan setelah halaman dimuat ulang.
- **Belum dimasukkan:** 12 tenaga penunjang (anestesi, radiologi, patologi, terapis, 3 dokter umum/gigi tambahan).

## 5a. Jawaban PIC (WhatsApp, 23 Okt 2026)

| Pertanyaan yang dikirim | Jawaban | Artinya |
|---|---|---|
| 1. Pendaftaran dan antrean dicatat pakai apa? | "Sistem Khanza" | Tidak berbasis kertas atau Excel. Pendaftaran dan antrean sudah ada di SIMRS Khanza. |
| 2. Sudah ada sistem pendaftaran atau SIMRS? | "Sistem rs sistem khanza" | Konfirmasi: SIMRS yang berjalan adalah Khanza. |
| 3. Berapa dokter dan sesi? BPJS dan umum dipisah? | "tidak dipisah" | Hanya bagian kedua yang terjawab: antrean BPJS dan umum **satu urutan**. Jumlah dokter dan sesi **belum terjawab**. |
| 4. Siapa yang mengurus website? | "IT" | Ada tim IT internal. Kemungkinan merekalah yang memegang Khanza dan website. |

Dampak: sistem diposisikan sebagai lapisan di atas Khanza (booking, WhatsApp, Layar Antrean, dashboard), bukan pengganti. Keluhan "nomor error" kemungkinan terjadi di dalam alur Khanza, bukan karena pencatatan manual. Rancangan antrean per poli per hari sudah sesuai dengan antrean yang tidak dipisah BPJS/umum. Belum diketahui: apakah booking di website masuk ke Khanza otomatis atau diketik ulang. Detail tabel dan API Khanza belum terkonfirmasi, tanyakan ke tim IT.

## 5. Pertanyaan untuk PIC (sesuai langkah berikutnya di Excel)

Kontak WhatsApp marketing dari balasan 22 Okt: **0858-9258-8119**.

1. Apakah RS memakai SIMRS? Apa namanya dan apakah ada API atau ekspor data?
2. Berapa jumlah dokter dan sesi praktik per hari, serta kuota pasien per sesi?
3. Siapa yang mengelola website saat ini (internal atau vendor)?
4. Apakah sudah memakai WhatsApp Business (API resmi)?
5. Poli spesialis dengan BPJS: apakah booking online menerima rujukan berjenjang?
6. Siapa yang menjawab keluhan, dan berapa target respons (prototipe memakai 24 jam)?

## 6. Rencana lanjutan (usulan)

1. Kirim alur sistem antrean (dari prototipe) ke PIC lewat WhatsApp, sekaligus tanyakan butir bagian 5.
2. Ganti data contoh dengan jadwal asli.
3. Bangun backend (rancangan di `database/`) dan integrasi WhatsApp.
