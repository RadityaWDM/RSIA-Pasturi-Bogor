-- RSIA Pasutri Bogor: rancangan database (PostgreSQL 18, minimal 17)
-- Cakupan: pasien, dokter & jadwal, booking, antrean, notifikasi WhatsApp, keluhan, audit.
-- Catatan: rancangan awal untuk prototipe. Belum mencakup rekam medis, farmasi, dan billing (SIMRS yang ada).

-- Semua objek dibuat di schema tersendiri, bukan public, agar terpisah dari aplikasi lain di database yang sama.
CREATE SCHEMA IF NOT EXISTS rsia;
SET search_path TO rsia;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ========== MASTER ==========
CREATE TABLE poliklinik (
  id            SMALLSERIAL PRIMARY KEY,
  kode          VARCHAR(5)  NOT NULL UNIQUE,        -- prefiks nomor antrean: A, B, C
  nama          VARCHAR(80) NOT NULL UNIQUE,
  durasi_menit  SMALLINT    NOT NULL CHECK (durasi_menit BETWEEN 5 AND 120),
  bisa_booking  BOOLEAN     NOT NULL DEFAULT TRUE,  -- Anestesi/Radiologi/Patologi: penunjang, FALSE
  aktif         BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE dokter (
  id            SERIAL PRIMARY KEY,
  nama_lengkap  VARCHAR(120) NOT NULL,              -- tanpa gelar
  gelar_depan   VARCHAR(20),                        -- dr., drg.
  gelar_belakang VARCHAR(60),                       -- Sp.OG, Sp.A, M.Kes (format baku)
  jenis_tenaga  VARCHAR(20) NOT NULL DEFAULT 'DOKTER'
                CHECK (jenis_tenaga IN ('DOKTER','DOKTER_GIGI','TERAPIS')),
  no_str        VARCHAR(30) UNIQUE,                 -- Surat Tanda Registrasi
  no_sip        VARCHAR(40),
  foto_url      TEXT,
  aktif         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dokter_poli (
  dokter_id INT      NOT NULL REFERENCES dokter(id),
  poli_id   SMALLINT NOT NULL REFERENCES poliklinik(id),
  PRIMARY KEY (dokter_id, poli_id)
);

-- Jadwal berulang mingguan
CREATE TABLE jadwal_praktik (
  id          SERIAL PRIMARY KEY,
  dokter_id   INT      NOT NULL,
  poli_id     SMALLINT NOT NULL,
  hari        SMALLINT NOT NULL CHECK (hari BETWEEN 0 AND 6),   -- 0=Minggu
  jam_mulai   TIME NOT NULL,
  jam_selesai TIME NOT NULL,
  kuota_per_slot SMALLINT NOT NULL DEFAULT 2 CHECK (kuota_per_slot > 0),
  berlaku_dari DATE NOT NULL DEFAULT CURRENT_DATE,
  berlaku_sampai DATE,
  FOREIGN KEY (dokter_id, poli_id) REFERENCES dokter_poli(dokter_id, poli_id),
  CHECK (jam_selesai > jam_mulai),
  -- satu dokter tidak boleh punya dua jadwal tumpang tindih di hari yang sama
  -- pada rentang berlaku yang sama; jadwal lama dan baru boleh berdampingan bila rentangnya tidak bertemu
  EXCLUDE USING gist (
    dokter_id WITH =, hari WITH =,
    tsrange(('2000-01-01'::date + jam_mulai), ('2000-01-01'::date + jam_selesai)) WITH &&,
    daterange(berlaku_dari, berlaku_sampai, '[]') WITH &&
  )
);

-- Cuti / libur / perubahan jadwal sesaat
-- LIBUR: tidak ada praktik. UBAH_JAM: ganti jam praktik pada tanggal itu. TAMBAHAN: praktik di luar jadwal rutin.
CREATE TABLE jadwal_pengecualian (
  id         SERIAL PRIMARY KEY,
  dokter_id  INT  NOT NULL REFERENCES dokter(id),
  tanggal    DATE NOT NULL,
  jenis      VARCHAR(10) NOT NULL CHECK (jenis IN ('LIBUR','TAMBAHAN','UBAH_JAM')),
  jam_mulai  TIME, jam_selesai TIME,
  kuota_per_slot SMALLINT CHECK (kuota_per_slot > 0),  -- wajib untuk UBAH_JAM dan TAMBAHAN
  alasan     VARCHAR(200),
  UNIQUE (dokter_id, tanggal, jenis),
  CHECK (jenis = 'LIBUR' OR (jam_mulai IS NOT NULL AND jam_selesai > jam_mulai)),
  CHECK (jenis = 'LIBUR' OR kuota_per_slot IS NOT NULL)
);
-- Pada satu tanggal hanya boleh ada satu pengecualian jam (UBAH_JAM atau TAMBAHAN)
CREATE UNIQUE INDEX uq_pengecualian_jam ON jadwal_pengecualian (dokter_id, tanggal)
  WHERE jenis <> 'LIBUR';

CREATE TABLE penjamin (
  id    SMALLSERIAL PRIMARY KEY,
  jenis VARCHAR(10) NOT NULL CHECK (jenis IN ('UMUM','BPJS','ASURANSI','PERUSAHAAN')),
  nama  VARCHAR(100) NOT NULL,                      -- mis. BPJS Kesehatan, Prudential
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (jenis, nama)
);

-- ========== PASIEN ==========
-- Identitas minimal saja. Data demografis (tanggal lahir, jenis kelamin, agama, alamat)
-- tidak disalin: dibaca langsung dari database Khanza memakai no_rkm_medis.
CREATE TABLE pasien (
  id            BIGSERIAL PRIMARY KEY,
  no_rkm_medis  VARCHAR(15) UNIQUE,                 -- kunci ke pasien.no_rkm_medis di Khanza; NULL sampai pasien terdaftar
  nik           CHAR(16) NOT NULL UNIQUE CHECK (nik ~ '^[0-9]{16}$'),
  nama_lengkap  VARCHAR(120) NOT NULL,              -- untuk pencocokan booking; tampilan di layar disamarkan
  no_wa         VARCHAR(16) NOT NULL CHECK (no_wa ~ '^(\+62|62|0)8[0-9]{8,12}$'),
  setuju_privasi_pada TIMESTAMPTZ NOT NULL,         -- bukti persetujuan (UU PDP)
  dibuat_pada   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pasien_penjamin (
  id           BIGSERIAL PRIMARY KEY,
  pasien_id    BIGINT   NOT NULL REFERENCES pasien(id),
  penjamin_id  SMALLINT NOT NULL REFERENCES penjamin(id),
  no_kartu     VARCHAR(30),                         -- BPJS 13 digit / no. polis
  aktif_sampai DATE,
  UNIQUE (pasien_id, penjamin_id, no_kartu)
);

CREATE TABLE penanggung_jawab (
  id         BIGSERIAL PRIMARY KEY,
  pasien_id  BIGINT NOT NULL REFERENCES pasien(id),
  nama       VARCHAR(120) NOT NULL,
  hubungan   VARCHAR(20)  NOT NULL,                 -- Suami, Istri, Orang tua, ...
  no_hp      VARCHAR(16)
);

-- ========== BOOKING & ANTREAN ==========
CREATE TYPE status_booking AS ENUM
  ('TERJADWAL','HADIR','DIPANGGIL','DILAYANI','DILEWATI','SELESAI','TIDAK_HADIR','BATAL');

CREATE TABLE booking (
  id            BIGSERIAL PRIMARY KEY,
  kode          VARCHAR(10) NOT NULL UNIQUE,        -- PST-AB12
  pasien_id     BIGINT   NOT NULL REFERENCES pasien(id),
  dokter_id     INT      NOT NULL,
  poli_id       SMALLINT NOT NULL,
  tanggal       DATE     NOT NULL,
  jam           TIME     NOT NULL,
  penjamin_id   SMALLINT NOT NULL REFERENCES penjamin(id),
  no_kartu      VARCHAR(30),
  no_rujukan    VARCHAR(40),                        -- wajib bila BPJS + poli spesialis
  penanggung_jawab_id BIGINT REFERENCES penanggung_jawab(id),
  no_rawat      VARCHAR(17) UNIQUE,                 -- kunci ke reg_periksa.no_rawat di Khanza; NULL sampai booking terdaftar di Khanza
  kanal         VARCHAR(10) NOT NULL DEFAULT 'WEB'
                CHECK (kanal IN ('WEB','WHATSAPP','TELEPON','WALKIN')),
  status        status_booking NOT NULL DEFAULT 'TERJADWAL',
  jumlah_dilewati SMALLINT NOT NULL DEFAULT 0 CHECK (jumlah_dilewati BETWEEN 0 AND 2),
                                                    -- 1x dilewati boleh dipanggil ulang; 2x = TIDAK_HADIR
  dibuat_pada   TIMESTAMPTZ NOT NULL DEFAULT now(),
  dibatalkan_pada TIMESTAMPTZ,
  alasan_batal  VARCHAR(200),
  FOREIGN KEY (dokter_id, poli_id) REFERENCES dokter_poli(dokter_id, poli_id)
);
-- Cegah booking ganda: satu pasien, satu dokter, satu hari
CREATE UNIQUE INDEX uq_booking_aktif ON booking (pasien_id, dokter_id, tanggal)
  WHERE status IN ('TERJADWAL','HADIR','DIPANGGIL','DILAYANI');
CREATE INDEX ix_booking_slot   ON booking (dokter_id, tanggal, jam) WHERE status <> 'BATAL';
CREATE INDEX ix_booking_tgl    ON booking (tanggal, status);

-- Kuota dan grid slot ditegakkan di database (aman dari race condition).
-- Slot dimulai pada jam_mulai praktik lalu berulang setiap durasi_menit poli (mis. 08:00, 08:20, 08:40 untuk 20 menit).
CREATE FUNCTION cek_kuota_slot() RETURNS trigger AS $$
DECLARE kuota INT; terpakai INT; x RECORD; durasi INT; ws TIME; we TIME;
BEGIN
  IF EXISTS (SELECT 1 FROM jadwal_pengecualian e WHERE e.dokter_id = NEW.dokter_id
              AND e.tanggal = NEW.tanggal AND e.jenis = 'LIBUR') THEN
    RAISE EXCEPTION 'Dokter libur/cuti pada tanggal tersebut'; END IF;

  -- Pengecualian UBAH_JAM atau TAMBAHAN pada tanggal ini menggantikan jadwal rutin
  SELECT e.jam_mulai, e.jam_selesai, e.kuota_per_slot INTO x
    FROM jadwal_pengecualian e
   WHERE e.dokter_id = NEW.dokter_id AND e.tanggal = NEW.tanggal AND e.jenis IN ('UBAH_JAM','TAMBAHAN');
  IF FOUND THEN
    ws := x.jam_mulai; we := x.jam_selesai; kuota := x.kuota_per_slot;
  ELSE
    SELECT j.jam_mulai, j.jam_selesai, j.kuota_per_slot INTO ws, we, kuota FROM jadwal_praktik j
     WHERE j.dokter_id = NEW.dokter_id AND j.poli_id = NEW.poli_id AND j.hari = EXTRACT(DOW FROM NEW.tanggal)
       AND NEW.jam >= j.jam_mulai AND NEW.jam < j.jam_selesai
       AND NEW.tanggal >= j.berlaku_dari AND (j.berlaku_sampai IS NULL OR NEW.tanggal <= j.berlaku_sampai)
     LIMIT 1;
  END IF;
  IF kuota IS NULL THEN RAISE EXCEPTION 'Dokter tidak praktik pada hari/jam tersebut'; END IF;
  IF NEW.jam < ws OR NEW.jam >= we THEN RAISE EXCEPTION 'Di luar jam praktik pada tanggal tersebut'; END IF;

  -- Grid slot: jam harus kelipatan durasi poli dari awal praktik, dan slot harus selesai sebelum jam tutup
  SELECT p.durasi_menit INTO durasi FROM poliklinik p WHERE p.id = NEW.poli_id;
  IF (EXTRACT(EPOCH FROM (NEW.jam - ws))::INT / 60) % durasi <> 0 THEN
    RAISE EXCEPTION 'Jam % tidak sesuai slot % menit mulai pukul %', NEW.jam, durasi, ws; END IF;
  IF NEW.jam + durasi * INTERVAL '1 minute' > we THEN
    RAISE EXCEPTION 'Slot pada jam % melewati jam selesai praktik %', NEW.jam, we; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.dokter_id || NEW.tanggal::text || NEW.jam::text));
  SELECT count(*) INTO terpakai FROM booking b
   WHERE b.dokter_id = NEW.dokter_id AND b.tanggal = NEW.tanggal AND b.jam = NEW.jam
     AND b.status <> 'BATAL' AND b.id IS DISTINCT FROM NEW.id;
  IF terpakai >= kuota THEN RAISE EXCEPTION 'Slot penuh'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = rsia;
CREATE TRIGGER trg_kuota BEFORE INSERT OR UPDATE OF dokter_id, tanggal, jam ON booking
  FOR EACH ROW WHEN (NEW.status <> 'BATAL') EXECUTE FUNCTION cek_kuota_slot();
-- Booking yang dibatalkan lalu diaktifkan kembali juga harus lolos cek kuota
CREATE TRIGGER trg_kuota_aktifkan BEFORE UPDATE OF status ON booking
  FOR EACH ROW WHEN (OLD.status = 'BATAL' AND NEW.status <> 'BATAL') EXECUTE FUNCTION cek_kuota_slot();

CREATE TABLE antrean (
  id            BIGSERIAL PRIMARY KEY,
  booking_id    BIGINT NOT NULL UNIQUE REFERENCES booking(id),
  tanggal       DATE   NOT NULL,
  poli_id       SMALLINT NOT NULL REFERENCES poliklinik(id),
  nomor         SMALLINT NOT NULL,                  -- tampil: A-001
  waktu_checkin TIMESTAMPTZ,
  waktu_panggil TIMESTAMPTZ,
  waktu_mulai   TIMESTAMPTZ,
  waktu_selesai TIMESTAMPTZ,
  jumlah_panggil SMALLINT NOT NULL DEFAULT 0,
  loket         VARCHAR(10),
  UNIQUE (tanggal, poli_id, nomor)
);

-- Urutan panggil per dokter: jam booking lalu nomor antrean, hanya pasien yang sudah check-in.
-- Pemanggil di luar urutan wajib mengisi alasan (dicatat di audit_log, aksi PANGGIL_LUAR_URUTAN).
CREATE VIEW v_antrean_berikutnya AS
SELECT DISTINCT ON (b.dokter_id, b.tanggal)
       b.dokter_id, b.tanggal, b.id AS booking_id, b.jam, a.nomor
FROM booking b JOIN antrean a ON a.booking_id = b.id
WHERE b.status = 'HADIR'
ORDER BY b.dokter_id, b.tanggal, b.jam, a.nomor;

-- Keterlambatan dokter: pemicu notifikasi WhatsApp ke semua pasien dokter itu di hari tersebut
-- dan penyesuaian estimasi (menit_terlambat ditambahkan ke estimasi dilayani).
CREATE TABLE keterlambatan_dokter (
  id          BIGSERIAL PRIMARY KEY,
  dokter_id   INT  NOT NULL REFERENCES dokter(id),
  tanggal     DATE NOT NULL,
  menit_terlambat SMALLINT NOT NULL CHECK (menit_terlambat > 0),
  alasan      VARCHAR(200),
  dicatat_oleh INT,
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now(),
  selesai_pada TIMESTAMPTZ,                         -- diisi saat dokter hadir
  UNIQUE (dokter_id, tanggal, dibuat_pada)
);

-- Nomor antrean diberikan database secara atomik: online dan walk-in satu urutan.
-- Menjawab keluhan "sistem nomor error, ditulis manual" dan "antrean dobel luar-dalam".
CREATE TABLE antrean_counter (
  tanggal DATE NOT NULL,
  poli_id SMALLINT NOT NULL REFERENCES poliklinik(id),
  terakhir SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tanggal, poli_id)
);
CREATE FUNCTION ambil_nomor_antrean(p_tanggal DATE, p_poli SMALLINT) RETURNS SMALLINT AS $$
  INSERT INTO antrean_counter (tanggal, poli_id, terakhir) VALUES (p_tanggal, p_poli, 1)
  ON CONFLICT (tanggal, poli_id) DO UPDATE SET terakhir = antrean_counter.terakhir + 1
  RETURNING terakhir;
$$ LANGUAGE sql SET search_path = rsia;

-- ========== NOTIFIKASI WHATSAPP ==========
CREATE TABLE notifikasi_wa (
  id          BIGSERIAL PRIMARY KEY,
  booking_id  BIGINT REFERENCES booking(id),
  keluhan_id  BIGINT,
  no_tujuan   VARCHAR(16) NOT NULL,
  jenis       VARCHAR(20) NOT NULL CHECK (jenis IN
              ('KONFIRMASI','PENGINGAT_H1','PANGGILAN','PANGGIL_ULANG','DILEWATI','NO_SHOW',
               'DOKTER_TERLAMBAT','DOKTER_HADIR','PEMBATALAN','BALASAN_KELUHAN','DARURAT')),
  isi         TEXT NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'ANTRI' CHECK (status IN ('ANTRI','TERKIRIM','DIBACA','GAGAL')),
  provider_msg_id VARCHAR(80),
  dikirim_pada TIMESTAMPTZ,
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_wa_status ON notifikasi_wa (status, dibuat_pada);

-- ========== KELUHAN & MASUKAN ==========
CREATE TABLE keluhan_kategori (
  id SMALLSERIAL PRIMARY KEY,
  nama VARCHAR(60) NOT NULL UNIQUE,
  sla_jam SMALLINT NOT NULL DEFAULT 24,
  unit_penanggung_jawab VARCHAR(60)
);

CREATE TABLE keluhan (
  id            BIGSERIAL PRIMARY KEY,
  no_tiket      VARCHAR(12) NOT NULL UNIQUE,        -- KLH-0001
  kategori_id   SMALLINT NOT NULL REFERENCES keluhan_kategori(id),
  pasien_id     BIGINT REFERENCES pasien(id),       -- NULL bila anonim
  nama_pelapor  VARCHAR(120),
  kontak        VARCHAR(16),
  poli_id       SMALLINT REFERENCES poliklinik(id),
  booking_id    BIGINT REFERENCES booking(id),
  isi           TEXT NOT NULL CHECK (length(isi) >= 10),
  status        VARCHAR(10) NOT NULL DEFAULT 'BARU' CHECK (status IN ('BARU','DIPROSES','SELESAI')),
  ditangani_oleh INT,
  dibuat_pada   TIMESTAMPTZ NOT NULL DEFAULT now(),
  respons_pertama_pada TIMESTAMPTZ,
  selesai_pada  TIMESTAMPTZ
);
CREATE INDEX ix_keluhan_status ON keluhan (status, dibuat_pada);

CREATE TABLE keluhan_tindak_lanjut (
  id         BIGSERIAL PRIMARY KEY,
  keluhan_id BIGINT NOT NULL REFERENCES keluhan(id) ON DELETE CASCADE,
  oleh       INT,
  isi        TEXT NOT NULL,
  terlihat_pelapor BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = catatan internal
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== PENGGUNA STAF & AUDIT ==========
CREATE TABLE pengguna (
  id        SERIAL PRIMARY KEY,
  username  VARCHAR(40) NOT NULL UNIQUE,
  nama      VARCHAR(100) NOT NULL,
  peran     VARCHAR(15) NOT NULL CHECK (peran IN ('PENDAFTARAN','POLI','CS','MANAJEMEN','ADMIN')),
  password_hash TEXT NOT NULL,
  aktif     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  pengguna_id INT REFERENCES pengguna(id),
  aksi       VARCHAR(40) NOT NULL,                  -- UBAH_JADWAL, BATAL_BOOKING, LIHAT_PASIEN,
                                                    -- PANGGIL, DILEWATI, PANGGIL_LUAR_URUTAN, DOKTER_TERLAMBAT
  tabel      VARCHAR(40) NOT NULL,
  baris_id   BIGINT,
  sebelum    JSONB, sesudah JSONB,
  waktu      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== VIEW UNTUK DASHBOARD MANAJEMEN ==========
CREATE VIEW v_kpi_harian AS
SELECT b.tanggal,
       count(*) FILTER (WHERE b.status <> 'BATAL')                                   AS total_booking,
       count(*) FILTER (WHERE b.status = 'TIDAK_HADIR')                              AS tidak_hadir,
       round(100.0 * count(*) FILTER (WHERE b.status = 'TIDAK_HADIR')
             / NULLIF(count(*) FILTER (WHERE b.status IN ('SELESAI','TIDAK_HADIR')),0), 1) AS persen_no_show,
       round(avg(EXTRACT(EPOCH FROM (a.waktu_mulai - a.waktu_checkin))/60)
             FILTER (WHERE a.waktu_mulai IS NOT NULL), 1)                             AS rata_tunggu_menit,
       count(*) FILTER (WHERE b.kanal = 'WEB')                                       AS via_web,
       count(*) FILTER (WHERE b.jumlah_dilewati > 0)                                 AS pernah_dilewati
FROM booking b LEFT JOIN antrean a ON a.booking_id = b.id
GROUP BY b.tanggal;

CREATE VIEW v_keluhan_sla AS
SELECT k.id, k.no_tiket, c.nama AS kategori, k.status, k.dibuat_pada,
       (k.status <> 'SELESAI' AND now() - k.dibuat_pada > make_interval(hours => c.sla_jam)) AS lewat_sla
FROM keluhan k JOIN keluhan_kategori c ON c.id = k.kategori_id;

-- ========== SEED RINGKAS ==========
INSERT INTO poliklinik (kode,nama,durasi_menit,bisa_booking) VALUES
 ('A','Kebidanan & Kandungan',20,TRUE),('B','Anak',20,TRUE),('C','Dokter Umum',15,TRUE),
 ('D','Gigi',30,TRUE),('E','Penyakit Dalam',20,TRUE),('F','Laktasi',30,TRUE),
 ('G','Rehabilitasi Medik',30,TRUE),('H','Anestesi',20,FALSE),('I','Radiologi',20,FALSE),('J','Patologi Klinik',20,FALSE);
INSERT INTO penjamin (jenis,nama) VALUES ('UMUM','Umum / Pribadi'),('BPJS','BPJS Kesehatan'),('ASURANSI','Asuransi Swasta');
INSERT INTO keluhan_kategori (nama,sla_jam,unit_penanggung_jawab) VALUES
 ('Antrean / waktu tunggu',24,'Pendaftaran'),('Jadwal dokter tidak sesuai',24,'Pendaftaran'),
 ('Pendaftaran / booking',24,'Pendaftaran'),('Biaya & penjamin',48,'Kasir & Penjamin'),
 ('Fasilitas & kebersihan',48,'Umum & Rumah Tangga'),('Sikap petugas',24,'SDM'),('Lainnya',72,'Customer Service');
