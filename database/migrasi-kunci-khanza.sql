-- Migrasi: kunci ke Khanza dan pengurangan data pasien (untuk database yang sudah berisi schema rsia lama)
-- Target: PostgreSQL 9.5 atau lebih baru (tidak memakai IF NOT EXISTS pada ADD COLUMN atau CREATE INDEX, karena belum ada di 9.5).
--
-- PERINGATAN: kolom tanggal_lahir, jenis_kelamin, agama, alamat, dan nama_lengkap dihapus. Datanya hilang.
-- Ambil cadangan dulu, misalnya: pg_dump -n rsia rsia > rsia-sebelum-migrasi.sql
--
-- Dijalankan sekali, dalam satu transaksi. Aman dijalankan ulang: setiap langkah mengecek dulu.
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rsia' AND table_name = 'pasien' AND column_name = 'no_rkm_medis') THEN
    ALTER TABLE rsia.pasien ADD COLUMN no_rkm_medis VARCHAR(15);
  END IF;
END $$;

ALTER TABLE rsia.pasien ALTER COLUMN no_rkm_medis TYPE VARCHAR(15);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'rsia' AND tablename = 'pasien' AND indexdef LIKE '%(no_rkm_medis)%') THEN
    CREATE UNIQUE INDEX uq_pasien_no_rkm_medis ON rsia.pasien (no_rkm_medis);
  END IF;
END $$;

-- 2. Data demografis dan nama tidak disalin lagi. Dibaca dari Khanza memakai no_rkm_medis.
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS tanggal_lahir;
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS jenis_kelamin;
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS agama;
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS alamat;
ALTER TABLE rsia.pasien DROP COLUMN IF EXISTS nama_lengkap;

-- 3. booking.no_rawat: kunci ke reg_periksa.no_rawat di Khanza, kosong sampai booking terdaftar
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rsia' AND table_name = 'booking' AND column_name = 'no_rawat') THEN
    ALTER TABLE rsia.booking ADD COLUMN no_rawat VARCHAR(17);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'rsia' AND tablename = 'booking' AND indexdef LIKE '%(no_rawat)%') THEN
    CREATE UNIQUE INDEX uq_booking_no_rawat ON rsia.booking (no_rawat);
  END IF;
END $$;

COMMIT;
