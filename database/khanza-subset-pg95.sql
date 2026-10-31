-- Subset skema SIMRS Khanza untuk PostgreSQL 9.5
-- Sumber: SIMRS-Khanza/sik.sql (MySQL/MariaDB), tabel yang dipakai aplikasi antrean.
--
-- Isi: tabel, primary key, foreign key, unique, check (dari enum), dan index yang umum.
-- Tidak ada: trigger, stored procedure, function, view, dan data.
--
-- Hanya kolom yang tercantum di docs/03-simrs-khanza.md (bagian 2.6.1) yang dibuat.
-- Kolom pribadi (NIK, alamat, telepon, email, nomor kartu) sengaja tidak dibuat.
-- Tabel yang dirujuk tetapi tidak termasuk (kelurahan, pegawai, spesialis, dll.)
-- membuat FK-nya ikut dihilangkan.
--
-- Cara pakai: jalankan di database yang kosong, dengan user yang punya hak CREATE.
--   psql -d <database> -f khanza-subset-pg95.sql
--
-- Catatan konversi dari MySQL:
--   * enum -> varchar + CHECK
--   * double -> double precision, int(n) -> integer, datetime -> timestamp
--   * KEY -> CREATE INDEX (PostgreSQL tidak membuat index otomatis untuk kolom FK)
--   * latin1 -> ikuti encoding database (disarankan UTF8)

BEGIN;

CREATE SCHEMA khanza;
SET search_path TO khanza;

-- ========== MASTER ==========

CREATE TABLE poliklinik (
  kd_poli   CHAR(5)     NOT NULL,
  nm_poli   VARCHAR(50),
  status    VARCHAR(1)  NOT NULL CHECK (status IN ('0','1')),
  CONSTRAINT poliklinik_pkey PRIMARY KEY (kd_poli)
);
CREATE INDEX idx_poliklinik_nm_poli ON poliklinik (nm_poli);

CREATE TABLE dokter (
  kd_dokter  VARCHAR(20)  NOT NULL,
  nm_dokter  VARCHAR(50),
  jk         VARCHAR(1)   CHECK (jk IN ('L','P')),
  status     VARCHAR(1)   NOT NULL CHECK (status IN ('0','1')),
  CONSTRAINT dokter_pkey PRIMARY KEY (kd_dokter)
);
CREATE INDEX idx_dokter_nm_dokter ON dokter (nm_dokter);

CREATE TABLE penjab (
  kd_pj      CHAR(3)      NOT NULL,
  png_jawab  VARCHAR(30)  NOT NULL,
  CONSTRAINT penjab_pkey PRIMARY KEY (kd_pj)
);

CREATE TABLE pasien (
  no_rkm_medis  VARCHAR(15)  NOT NULL,
  nm_pasien     VARCHAR(40),
  CONSTRAINT pasien_pkey PRIMARY KEY (no_rkm_medis)
);
CREATE INDEX idx_pasien_nm_pasien ON pasien (nm_pasien);

CREATE TABLE jadwal (
  kd_dokter    VARCHAR(20)  NOT NULL,
  hari_kerja   VARCHAR(7)   NOT NULL DEFAULT 'SENIN'
               CHECK (hari_kerja IN ('SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','AKHAD')),
  jam_mulai    TIME         NOT NULL DEFAULT '00:00:00',
  jam_selesai  TIME,
  kd_poli      CHAR(5),
  kuota        INTEGER,
  CONSTRAINT jadwal_pkey PRIMARY KEY (kd_dokter, hari_kerja, jam_mulai),
  CONSTRAINT jadwal_kd_dokter_fkey FOREIGN KEY (kd_dokter)
    REFERENCES dokter (kd_dokter) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT jadwal_kd_poli_fkey FOREIGN KEY (kd_poli)
    REFERENCES poliklinik (kd_poli) ON UPDATE CASCADE
);
CREATE INDEX idx_jadwal_kd_poli ON jadwal (kd_poli);

-- ========== KUNJUNGAN ==========

CREATE TABLE reg_periksa (
  no_rawat       VARCHAR(17)  NOT NULL,
  no_reg         VARCHAR(8),
  tgl_registrasi DATE,
  jam_reg        TIME,
  kd_dokter      VARCHAR(20),
  no_rkm_medis   VARCHAR(15),
  kd_poli        CHAR(5),
  stts           VARCHAR(20)  CHECK (stts IN ('Belum','Sudah','Batal','Berkas Diterima','Dirujuk','Meninggal','Dirawat','Pulang Paksa')),
  status_lanjut  VARCHAR(5)   NOT NULL CHECK (status_lanjut IN ('Ralan','Ranap')),
  kd_pj          CHAR(3)      NOT NULL,
  CONSTRAINT reg_periksa_pkey PRIMARY KEY (no_rawat),
  CONSTRAINT reg_periksa_kd_poli_fkey FOREIGN KEY (kd_poli)
    REFERENCES poliklinik (kd_poli) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT reg_periksa_kd_dokter_fkey FOREIGN KEY (kd_dokter)
    REFERENCES dokter (kd_dokter) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT reg_periksa_kd_pj_fkey FOREIGN KEY (kd_pj)
    REFERENCES penjab (kd_pj) ON UPDATE CASCADE,
  CONSTRAINT reg_periksa_no_rkm_medis_fkey FOREIGN KEY (no_rkm_medis)
    REFERENCES pasien (no_rkm_medis) ON UPDATE CASCADE
);
-- no_reg bukan kunci dan tidak unik (lihat docs/03-simrs-khanza.md bagian 2.6.2).
-- Index ini dipakai untuk pencarian antrean per tanggal dan poli, serta cek duplikat no_reg.
CREATE INDEX idx_reg_periksa_tgl_poli_noreg ON reg_periksa (tgl_registrasi, kd_poli, no_reg);
CREATE INDEX idx_reg_periksa_no_rkm_medis ON reg_periksa (no_rkm_medis);
CREATE INDEX idx_reg_periksa_kd_dokter ON reg_periksa (kd_dokter);
CREATE INDEX idx_reg_periksa_kd_pj ON reg_periksa (kd_pj);

CREATE TABLE booking_registrasi (
  no_rkm_medis     VARCHAR(15)  NOT NULL,
  tanggal_periksa  DATE         NOT NULL,
  kd_dokter        VARCHAR(20),
  kd_poli          CHAR(5),
  no_reg           VARCHAR(8),
  status           VARCHAR(20)  CHECK (status IN ('Terdaftar','Belum','Batal','Dokter Berhalangan')),
  CONSTRAINT booking_registrasi_pkey PRIMARY KEY (no_rkm_medis, tanggal_periksa),
  CONSTRAINT booking_registrasi_kd_dokter_fkey FOREIGN KEY (kd_dokter)
    REFERENCES dokter (kd_dokter) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT booking_registrasi_kd_poli_fkey FOREIGN KEY (kd_poli)
    REFERENCES poliklinik (kd_poli) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT booking_registrasi_no_rkm_medis_fkey FOREIGN KEY (no_rkm_medis)
    REFERENCES pasien (no_rkm_medis) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_booking_registrasi_kd_dokter ON booking_registrasi (kd_dokter);
CREATE INDEX idx_booking_registrasi_kd_poli ON booking_registrasi (kd_poli);

-- ========== ANTREAN ==========

-- Di Khanza tabel ini tidak punya primary key (MyISAM). Dibuat sama, hanya index.
CREATE TABLE antripoli (
  kd_dokter  VARCHAR(20),
  kd_poli    CHAR(5),
  status     VARCHAR(1) CHECK (status IN ('0','1')),
  no_rawat   VARCHAR(17) NOT NULL
);
CREATE INDEX idx_antripoli_no_rawat ON antripoli (no_rawat);
CREATE INDEX idx_antripoli_kd_poli_status ON antripoli (kd_poli, status);

CREATE TABLE antriloket (
  loket    INTEGER NOT NULL,
  antrian  INTEGER NOT NULL
);
CREATE INDEX idx_antriloket_loket_antrian ON antriloket (loket, antrian);

-- ========== BPJS MOBILE JKN ==========

CREATE TABLE referensi_mobilejkn_bpjs (
  nobooking          VARCHAR(15)  NOT NULL,
  no_rawat           VARCHAR(17),
  norm               VARCHAR(15),
  kodepoli           VARCHAR(15),
  kodedokter         VARCHAR(20),
  tanggalperiksa     DATE,
  nomorantrean       VARCHAR(15)  NOT NULL,
  angkaantrean       VARCHAR(5)   NOT NULL,
  estimasidilayani   VARCHAR(15)  NOT NULL,
  status             VARCHAR(10)  NOT NULL CHECK (status IN ('Belum','Checkin','Batal','Gagal')),
  CONSTRAINT referensi_mobilejkn_bpjs_pkey PRIMARY KEY (nobooking),
  CONSTRAINT referensi_mobilejkn_bpjs_no_rawat_key UNIQUE (no_rawat),
  CONSTRAINT referensi_mobilejkn_bpjs_norm_fkey FOREIGN KEY (norm)
    REFERENCES pasien (no_rkm_medis) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_referensi_mobilejkn_bpjs_norm ON referensi_mobilejkn_bpjs (norm);
CREATE INDEX idx_referensi_mobilejkn_bpjs_tanggal_poli ON referensi_mobilejkn_bpjs (tanggalperiksa, kodepoli);

CREATE TABLE referensi_mobilejkn_bpjs_taskid (
  no_rawat  VARCHAR(17) NOT NULL,
  taskid    VARCHAR(2)  NOT NULL CHECK (taskid IN ('1','2','3','4','5','6','7','99')),
  waktu     TIMESTAMP,
  CONSTRAINT referensi_mobilejkn_bpjs_taskid_pkey PRIMARY KEY (no_rawat, taskid),
  CONSTRAINT referensi_mobilejkn_bpjs_taskid_no_rawat_fkey FOREIGN KEY (no_rawat)
    REFERENCES reg_periksa (no_rawat) ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
