# ERD – RSIA Pasutri Bogor

Render dengan editor yang mendukung Mermaid (GitHub, VS Code + ekstensi Mermaid).

```mermaid
erDiagram
  poliklinik ||--o{ dokter_poli : memiliki
  dokter ||--o{ dokter_poli : praktik_di
  dokter_poli ||--o{ jadwal_praktik : dijadwalkan
  dokter ||--o{ jadwal_pengecualian : cuti_libur
  dokter ||--o{ keterlambatan_dokter : terlambat
  pasien ||--o{ pasien_penjamin : punya
  penjamin ||--o{ pasien_penjamin : jenis
  pasien ||--o{ penanggung_jawab : didampingi
  pasien ||--o{ booking : membuat
  dokter_poli ||--o{ booking : dituju
  penjamin ||--o{ booking : dipakai
  penanggung_jawab ||--o{ booking : bertanggung_jawab
  booking ||--o| antrean : menghasilkan
  poliklinik ||--o{ antrean : nomor_per_poli
  booking ||--o{ notifikasi_wa : memicu
  keluhan_kategori ||--o{ keluhan : digolongkan
  pasien |o--o{ keluhan : melapor
  booking |o--o{ keluhan : terkait
  keluhan ||--o{ keluhan_tindak_lanjut : ditanggapi
  keluhan ||--o{ notifikasi_wa : dibalas
  pengguna ||--o{ audit_log : melakukan
  jadwal_pengecualian { int id PK
    date tanggal
    varchar jenis
    time jam_mulai
    time jam_selesai
    smallint kuota_per_slot }
  booking { bigint id PK
    varchar kode UK
    date tanggal
    time jam
    enum status
    varchar kanal }
  pasien { bigint id PK
    char nik UK
    varchar no_wa
    timestamptz setuju_privasi_pada }
  jadwal_praktik { int id PK
    smallint hari
    time jam_mulai
    time jam_selesai
    smallint kuota_per_slot }
  antrean { bigint id PK
    smallint nomor
    timestamptz waktu_checkin
    timestamptz waktu_mulai }
  keluhan { bigint id PK
    varchar no_tiket UK
    varchar status
    timestamptz dibuat_pada }
```

## Keputusan desain

| Masalah di website | Keputusan database |
|---|---|
| Hari "tidak tersedia" baru diketahui setelah pasien memilih | `jadwal_praktik` per dokter per hari; UI hanya menawarkan slot yang ada. Cuti lewat `jadwal_pengecualian`. |
| Booking ganda dan slot penuh | Indeks unik parsial `uq_booking_aktif` + trigger `cek_kuota_slot` dengan advisory lock (aman saat dua pasien klik bersamaan). |
| Jadwal bentrok dua sesi dokter | `EXCLUDE USING gist` pada `jadwal_praktik`. Bentrok dihitung hanya bila rentang `berlaku_dari`–`berlaku_sampai` juga bertemu, sehingga jadwal baru bisa menggantikan jadwal lama tanpa menghapus riwayat. |
| Libur, jam berubah, dan praktik tambahan pada satu tanggal | `jadwal_pengecualian` dengan jenis `LIBUR`, `UBAH_JAM`, dan `TAMBAHAN`. Trigger `cek_kuota_slot` membaca ketiganya. `UBAH_JAM` dan `TAMBAHAN` menggantikan jam rutin dan wajib mengisi `kuota_per_slot`; satu tanggal hanya boleh punya satu pengecualian jam. |
| Slot tidak punya ukuran, jam booking bebas | Slot dimulai pada `jam_mulai` praktik dan berulang setiap `poliklinik.durasi_menit`. Trigger menolak jam yang tidak kelipatan durasi dan slot yang selesai lewat jam tutup. Jadwal rutin juga dicocokkan dengan `poli_id` booking. |
| Booking dibatalkan lalu diaktifkan lagi melewati kuota | Trigger `trg_kuota_aktifkan` memeriksa kuota saat status kembali dari `BATAL`. |
| Data dokter tidak konsisten ("Sp.A" vs "Sp. A.") | Nama, `gelar_depan`, `gelar_belakang` dipisah; `jenis_tenaga` membedakan dokter, dokter gigi, terapis. |
| Penjamin hanya pilihan tanpa detail | `penjamin` (master) + `pasien_penjamin` (no. kartu) + `booking.no_rujukan`. |
| NIK/HP tanpa validasi | `CHECK` regex di level database, bukan hanya di form. |
| Nomor antrean terlewat, tidak jelas siapa memanggil siapa | Status `DILEWATI` dan `jumlah_dilewati` (1x boleh dipanggil ulang, 2x menjadi tidak hadir). View `v_antrean_berikutnya` menetapkan urutan per dokter (jam booking, lalu nomor). Panggilan di luar urutan wajib beralasan dan masuk `audit_log`. |
| Antrean terasa sangat lama karena dokter terlambat tanpa kabar | Tabel `keterlambatan_dokter`: memicu WhatsApp ke seluruh pasien dokter itu, menggeser estimasi, dan menjadi data untuk dashboard manajemen. |
| Keluhan tanpa tindak lanjut | `keluhan` + `keluhan_tindak_lanjut` + `keluhan_kategori.sla_jam`; view `v_keluhan_sla`. |
| Manajemen tanpa data | View `v_kpi_harian` menghitung no-show, waktu tunggu, kanal dari `booking` dan `antrean`. |
| Data pribadi sensitif | `setuju_privasi_pada` (bukti persetujuan UU PDP) dan `audit_log` untuk akses/ubah data. |

## Batasan

- Rekam medis, farmasi, dan billing tidak masuk cakupan; tetap di SIMRS.
- Skema belum diuji pada PostgreSQL sungguhan (belum ada instance di komputer ini). Jalankan `psql -f schema.sql` pada database kosong untuk memeriksanya.
