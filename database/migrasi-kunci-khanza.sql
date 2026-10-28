-- Migrasi: kunci ke Khanza dan pengurangan data pasien (untuk database yang sudah berisi schema rsia lama)
-- Target: PostgreSQL 18, database simrs_dev, schema rsia.
--
-- PERINGATAN: kolom tanggal_lahir, jenis_kelamin, agama, dan alamat dihapus. Datanya hilang.
-- Ambil cadangan dulu, misalnya: pg_dump -n rsia simrs_dev > rsia-sebelum-migrasi.sql
--
-- Dijalankan sekali, dalam satu transaksi. Aman dijalankan ulang untuk bagian yang sudah ada.
-- Jika database kosong (belum pernah diisi schema.sql), jalankan schema.sql saja, bukan file ini.

BEGIN;
SET search_path TO rsia;

-- 1. pasien.no_rm menjadi pasien.no_rkm_medis (kunci ke pasien.no_rkm_medis di Khanza)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rsia' AND table_name = 'pasien' AND column_name = 'no_rm')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rsia' AND table_name = 'pasien' AND column_name = 'no_rkm_medis') THEN
    ALTER TABLE rsia.pasien RENAME COLUMN no_rm TO no_rkm_medis;
  END IF;
END $$;

ALTER TABLE rsia.pasien ADD COLUMN IF NOT EXISTS no_rkm_medis VARCHAR(15);
ALTER TABLE rsia.pasien ALTER COLUMN no_rkm_medis TYPE VARCHAR(15);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pasien_no_rkm_medis ON rsia.pasien (no_rkm_medis);

-- 2. Data demografis tidak disalin lagi. Dibaca dari Khanza memakai no_rkm_medis.
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS tanggal_lahir;
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS jenis_kelamin;
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS agama;
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS alamat;

-- 3. booking.no_rawat: kunci ke reg_periksa.no_rawat di Khanza, kosong sampai booking terdaftar
ALTER TABLE rsia.booking ADD COLUMN IF NOT EXISTS no_rawat VARCHAR(17);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_no_rawat ON rsia.booking (no_rawat);

COMMIT;
