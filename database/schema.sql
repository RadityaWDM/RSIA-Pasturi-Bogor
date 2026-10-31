-- RSIA Pasutri Bogor: rancangan tabel database (PostgreSQL 9.5 atau lebih baru)
-- Cakupan: hanya CREATE TABLE beserta PK, FK, UNIQUE, CHECK, dan INDEX yang diperlukan.
-- Tidak memuat trigger, fungsi, view, extension, atau data awal (seed).

-- Semua tabel dibuat di schema tersendiri, bukan public, agar terpisah dari aplikasi lain di database yang sama.
CREATE SCHEMA IF NOT EXISTS rsia;
SET search_path TO rsia;

-- ========== MASTER ==========
CREATE TABLE poliklinik (
  id            SMALLSERIAL PRIMARY KEY,
  kode          VARCHAR(5)  NOT NULL UNIQUE,
  nama          VARCHAR(80) NOT NULL UNIQUE,
  durasi_menit  SMALLINT    NOT NULL CHECK (durasi_menit BETWEEN 5 AND 120),
  bisa_booking  BOOLEAN     NOT NULL DEFAULT TRUE,
  aktif         BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE dokter (
  id             SERIAL PRIMARY KEY,
  nama_lengkap   VARCHAR(120) NOT NULL,
  gelar_depan    VARCHAR(20),
  gelar_belakang VARCHAR(60),
  jenis_tenaga   VARCHAR(20) NOT NULL DEFAULT 'DOKTER'
                 CHECK (jenis_tenaga IN ('DOKTER','DOKTER_GIGI','TERAPIS')),
  no_str         VARCHAR(30) UNIQUE,
  no_sip         VARCHAR(40),
  foto_url       TEXT,
  aktif          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dokter_poli (
  dokter_id INT      NOT NULL REFERENCES dokter(id),
  poli_id   SMALLINT NOT NULL REFERENCES poliklinik(id),
  PRIMARY KEY (dokter_id, poli_id)
);

-- ========== JADWAL ==========
CREATE TABLE jadwal_praktik (
  id              SERIAL PRIMARY KEY,
  dokter_id       INT      NOT NULL,
  poli_id         SMALLINT NOT NULL,
  hari            SMALLINT NOT NULL CHECK (hari BETWEEN 0 AND 6),
  jam_mulai       TIME     NOT NULL,
  jam_selesai     TIME     NOT NULL,
  kuota_per_slot  SMALLINT NOT NULL DEFAULT 2 CHECK (kuota_per_slot > 0),
  berlaku_dari    DATE     NOT NULL DEFAULT CURRENT_DATE,
  berlaku_sampai  DATE,
  FOREIGN KEY (dokter_id, poli_id) REFERENCES dokter_poli(dokter_id, poli_id),
  CHECK (jam_selesai > jam_mulai),
  CHECK (berlaku_sampai IS NULL OR berlaku_sampai >= berlaku_dari),
  UNIQUE (dokter_id, hari, jam_mulai, berlaku_dari)
);

CREATE TABLE jadwal_pengecualian (
  id             SERIAL PRIMARY KEY,
  dokter_id      INT  NOT NULL REFERENCES dokter(id),
  tanggal        DATE NOT NULL,
  jenis          VARCHAR(10) NOT NULL CHECK (jenis IN ('LIBUR','TAMBAHAN','UBAH_JAM')),
  jam_mulai      TIME,
  jam_selesai    TIME,
  kuota_per_slot SMALLINT CHECK (kuota_per_slot > 0),
  alasan         VARCHAR(200),
  UNIQUE (dokter_id, tanggal, jenis),
  CHECK (jenis = 'LIBUR' OR (jam_mulai IS NOT NULL AND jam_selesai > jam_mulai)),
  CHECK (jenis = 'LIBUR' OR kuota_per_slot IS NOT NULL)
);
-- Pada satu tanggal hanya boleh ada satu pengecualian jam (UBAH_JAM atau TAMBAHAN)
CREATE UNIQUE INDEX uq_pengecualian_jam ON jadwal_pengecualian (dokter_id, tanggal)
  WHERE jenis <> 'LIBUR';

-- ========== PENJAMIN ==========
CREATE TABLE penjamin (
  id    SMALLSERIAL PRIMARY KEY,
  jenis VARCHAR(10) NOT NULL CHECK (jenis IN ('UMUM','BPJS','ASURANSI','PERUSAHAAN')),
  nama  VARCHAR(100) NOT NULL,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (jenis, nama)
);

-- ========== PASIEN ==========
CREATE TABLE pasien (
  id                  BIGSERIAL PRIMARY KEY,
  no_rkm_medis        VARCHAR(15) UNIQUE,
  nik                 CHAR(16) NOT NULL UNIQUE CHECK (nik ~ '^[0-9]{16}$'),
  nama_lengkap        VARCHAR(120) NOT NULL,
  no_wa               VARCHAR(16) NOT NULL CHECK (no_wa ~ '^(\+62|62|0)8[0-9]{8,12}$'),
  setuju_privasi_pada TIMESTAMPTZ NOT NULL,
  dibuat_pada         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pasien_penjamin (
  id           BIGSERIAL PRIMARY KEY,
  pasien_id    BIGINT   NOT NULL REFERENCES pasien(id),
  penjamin_id  SMALLINT NOT NULL REFERENCES penjamin(id),
  no_kartu     VARCHAR(30),
  aktif_sampai DATE,
  UNIQUE (pasien_id, penjamin_id, no_kartu)
);

CREATE TABLE penanggung_jawab (
  id         BIGSERIAL PRIMARY KEY,
  pasien_id  BIGINT NOT NULL REFERENCES pasien(id),
  nama       VARCHAR(120) NOT NULL,
  hubungan   VARCHAR(20)  NOT NULL,
  no_hp      VARCHAR(16)
);

-- ========== BOOKING & ANTREAN ==========
CREATE TABLE booking (
  id                  BIGSERIAL PRIMARY KEY,
  kode                VARCHAR(10) NOT NULL UNIQUE,
  pasien_id           BIGINT   NOT NULL REFERENCES pasien(id),
  dokter_id           INT      NOT NULL,
  poli_id             SMALLINT NOT NULL,
  tanggal             DATE     NOT NULL,
  jam                 TIME     NOT NULL,
  penjamin_id         SMALLINT NOT NULL REFERENCES penjamin(id),
  no_kartu            VARCHAR(30),
  no_rujukan          VARCHAR(40),
  penanggung_jawab_id BIGINT REFERENCES penanggung_jawab(id),
  no_rawat            VARCHAR(17) UNIQUE,
  kanal               VARCHAR(10) NOT NULL DEFAULT 'WEB'
                      CHECK (kanal IN ('WEB','WHATSAPP','TELEPON','WALKIN')),
  status              VARCHAR(12) NOT NULL DEFAULT 'TERJADWAL'
                      CHECK (status IN ('TERJADWAL','HADIR','DIPANGGIL','DILAYANI','DILEWATI',
                                        'SELESAI','TIDAK_HADIR','BATAL')),
  jumlah_dilewati     SMALLINT NOT NULL DEFAULT 0 CHECK (jumlah_dilewati BETWEEN 0 AND 2),
  dibuat_pada         TIMESTAMPTZ NOT NULL DEFAULT now(),
  dibatalkan_pada     TIMESTAMPTZ,
  alasan_batal        VARCHAR(200),
  FOREIGN KEY (dokter_id, poli_id) REFERENCES dokter_poli(dokter_id, poli_id)
);
-- Cegah booking ganda: satu pasien, satu dokter, satu hari
CREATE UNIQUE INDEX uq_booking_aktif ON booking (pasien_id, dokter_id, tanggal)
  WHERE status IN ('TERJADWAL','HADIR','DIPANGGIL','DILAYANI');
CREATE INDEX ix_booking_slot ON booking (dokter_id, tanggal, jam);
CREATE INDEX ix_booking_tgl  ON booking (tanggal, status);

CREATE TABLE antrean (
  id             BIGSERIAL PRIMARY KEY,
  booking_id     BIGINT NOT NULL UNIQUE REFERENCES booking(id),
  tanggal        DATE   NOT NULL,
  poli_id        SMALLINT NOT NULL REFERENCES poliklinik(id),
  nomor          SMALLINT NOT NULL,
  waktu_checkin  TIMESTAMPTZ,
  waktu_panggil  TIMESTAMPTZ,
  waktu_mulai    TIMESTAMPTZ,
  waktu_selesai  TIMESTAMPTZ,
  jumlah_panggil SMALLINT NOT NULL DEFAULT 0,
  loket          VARCHAR(10),
  UNIQUE (tanggal, poli_id, nomor)
);

CREATE TABLE antrean_counter (
  tanggal   DATE NOT NULL,
  poli_id   SMALLINT NOT NULL REFERENCES poliklinik(id),
  terakhir  SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tanggal, poli_id)
);

CREATE TABLE keterlambatan_dokter (
  id               BIGSERIAL PRIMARY KEY,
  dokter_id        INT  NOT NULL REFERENCES dokter(id),
  tanggal          DATE NOT NULL,
  menit_terlambat  SMALLINT NOT NULL CHECK (menit_terlambat > 0),
  alasan           VARCHAR(200),
  dicatat_oleh     INT,
  dibuat_pada      TIMESTAMPTZ NOT NULL DEFAULT now(),
  selesai_pada     TIMESTAMPTZ,
  UNIQUE (dokter_id, tanggal, dibuat_pada)
);

-- ========== KELUHAN & MASUKAN ==========
CREATE TABLE keluhan_kategori (
  id                    SMALLSERIAL PRIMARY KEY,
  nama                  VARCHAR(60) NOT NULL UNIQUE,
  sla_jam               SMALLINT NOT NULL DEFAULT 24,
  unit_penanggung_jawab VARCHAR(60)
);

CREATE TABLE keluhan (
  id                   BIGSERIAL PRIMARY KEY,
  no_tiket             VARCHAR(12) NOT NULL UNIQUE,
  kategori_id          SMALLINT NOT NULL REFERENCES keluhan_kategori(id),
  pasien_id            BIGINT REFERENCES pasien(id),
  nama_pelapor         VARCHAR(120),
  kontak               VARCHAR(16),
  poli_id              SMALLINT REFERENCES poliklinik(id),
  booking_id           BIGINT REFERENCES booking(id),
  isi                  TEXT NOT NULL CHECK (length(isi) >= 10),
  status               VARCHAR(10) NOT NULL DEFAULT 'BARU'
                       CHECK (status IN ('BARU','DIPROSES','SELESAI')),
  ditangani_oleh       INT,
  dibuat_pada          TIMESTAMPTZ NOT NULL DEFAULT now(),
  respons_pertama_pada TIMESTAMPTZ,
  selesai_pada         TIMESTAMPTZ
);
CREATE INDEX ix_keluhan_status ON keluhan (status, dibuat_pada);

CREATE TABLE keluhan_tindak_lanjut (
  id               BIGSERIAL PRIMARY KEY,
  keluhan_id       BIGINT NOT NULL REFERENCES keluhan(id) ON DELETE CASCADE,
  oleh             INT,
  isi              TEXT NOT NULL,
  terlihat_pelapor BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat_pada      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== NOTIFIKASI WHATSAPP ==========
CREATE TABLE notifikasi_wa (
  id              BIGSERIAL PRIMARY KEY,
  booking_id      BIGINT REFERENCES booking(id),
  keluhan_id      BIGINT,
  no_tujuan       VARCHAR(16) NOT NULL,
  jenis           VARCHAR(20) NOT NULL CHECK (jenis IN
                  ('KONFIRMASI','PENGINGAT_H1','PANGGILAN','PANGGIL_ULANG','DILEWATI','NO_SHOW',
                   'DOKTER_TERLAMBAT','DOKTER_HADIR','PEMBATALAN','BALASAN_KELUHAN','DARURAT')),
  isi             TEXT NOT NULL,
  status          VARCHAR(10) NOT NULL DEFAULT 'ANTRI'
                  CHECK (status IN ('ANTRI','TERKIRIM','DIBACA','GAGAL')),
  provider_msg_id VARCHAR(80),
  dikirim_pada    TIMESTAMPTZ,
  dibuat_pada     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_wa_status ON notifikasi_wa (status, dibuat_pada);

-- ========== PENGGUNA STAF & AUDIT ==========
CREATE TABLE pengguna (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(40) NOT NULL UNIQUE,
  nama          VARCHAR(100) NOT NULL,
  peran         VARCHAR(15) NOT NULL
                CHECK (peran IN ('PENDAFTARAN','POLI','CS','MANAJEMEN','ADMIN')),
  password_hash TEXT NOT NULL,
  aktif         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  pengguna_id INT REFERENCES pengguna(id),
  aksi        VARCHAR(40) NOT NULL,
  tabel       VARCHAR(40) NOT NULL,
  baris_id    BIGINT,
  sebelum     JSONB,
  sesudah     JSONB,
  waktu       TIMESTAMPTZ NOT NULL DEFAULT now()
);
