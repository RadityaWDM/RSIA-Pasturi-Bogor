#!/usr/bin/env node
// Membuat data contoh untuk database khanza dan rsia (PostgreSQL 9.5 di kontainer postgresql95_3).
//   - schema khanza: semua tabel terisi. Tabel inti aplikasi antrean (poliklinik, dokter, jadwal,
//     pasien, reg_periksa, antripoli, booking_registrasi, referensi_mobilejkn_bpjs) dibuat konsisten
//     satu sama lain. Tabel lain diisi data acak yang tetap memenuhi FK, PK, UNIQUE, dan CHECK enum.
//   - schema rsia: master, jadwal, booking, antrean, keluhan, dan notifikasi, yang terhubung ke khanza
//     lewat pasien.no_rkm_medis dan booking.no_rawat = reg_periksa.no_rawat.
//
// Pemakaian:
//   node seed-simrs-pg95.js <awalan-berkas>   (menulis <awalan>-khanza.sql dan <awalan>-rsia.sql)
//   docker exec -i postgresql95_3 psql -U postgres -d khanza -v ON_ERROR_STOP=1 -q < <awalan>-khanza.sql
//   docker exec -i postgresql95_3 psql -U postgres -d rsia -v ON_ERROR_STOP=1 -q < <awalan>-rsia.sql
//
// Deterministik (PRNG seed tetap). Keluaran selalu menghapus isi tabel lebih dulu (TRUNCATE),
// jadi aman dijalankan ulang. Data hanya contoh. Tidak ada data pasien nyata.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

const OUT = process.argv[2];
if (!OUT) {
  console.error('Pemakaian: node seed-simrs-pg95.js <awalan-berkas>');
  process.exit(1);
}

const CONTAINER = 'postgresql95_3';
const DB = 'khanza'; // katalog schema khanza dibaca dari database khanza
const TODAY = '2026-10-31';
const REG_FROM = '2026-09-01';
const REG_TO = '2026-11-15';
const PASIEN_N = 1200;
const FILLER_N = 10;
const N_OVERRIDE = { pegawai: 40 };

// ---------- PRNG dan utilitas ----------
let seed = 20261031 >>> 0;
function rnd() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n, w) => String(n).padStart(w, '0');
const digits = (n) => Array.from({ length: n }, () => ri(0, 9)).join('');
function pickW(pairs) {
  const tot = pairs.reduce((a, p) => a + p[1], 0);
  let r = rnd() * tot;
  for (const [v, w] of pairs) {
    if ((r -= w) < 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Minggu
function daysBetween(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}
function randDate(a, b) {
  const n = (Date.parse(b) - Date.parse(a)) / 86400000;
  return addDays(a, ri(0, n));
}
function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
const hhmm = (min) => pad(Math.floor(min / 60), 2) + ':' + pad(min % 60, 2);
function nextDay(hari, from) {
  let d = from;
  while (HARI[dow(d)] !== hari) d = addDays(d, 1);
  return d;
}
const fit = (s, maxlen) => (maxlen > 0 && s != null ? String(s).slice(0, maxlen) : s);

const HARI = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

// ---------- daftar isi untuk data realistis ----------
const FIRST = ['Siti', 'Ani', 'Dewi', 'Rina', 'Nur', 'Sri', 'Wati', 'Lestari', 'Fitri', 'Ayu', 'Yuli', 'Ratna',
  'Indah', 'Maya', 'Tuti', 'Eka', 'Budi', 'Agus', 'Joko', 'Andi', 'Rizky', 'Dedi', 'Hendra', 'Eko', 'Wahyu',
  'Bambang', 'Slamet', 'Fajar', 'Dimas', 'Rudi', 'Hadi', 'Yusuf', 'Ahmad', 'Rahmat', 'Surya', 'Wawan', 'Iwan',
  'Taufik', 'Deni', 'Ferry'];
const LAST = ['Saputra', 'Wijaya', 'Pratama', 'Hidayat', 'Nugraha', 'Setiawan', 'Maulana', 'Kusuma', 'Susanti',
  'Rahayu', 'Utami', 'Permana', 'Firmansyah', 'Ramadhan', 'Hakim', 'Gunawan', 'Wibowo', 'Purnama', 'Anggraini',
  'Syahputra', 'Hartono', 'Suryadi', 'Mulyani', 'Kurniawan'];
const CITIES = ['Bogor', 'Jakarta', 'Depok', 'Sukabumi', 'Cianjur', 'Bekasi', 'Tangerang'];
const STREETS = ['Raya Pajajaran', 'Sudirman', 'Dramaga', 'Kapten Muslihat', 'Pemuda', 'Mawar', 'Melati',
  'Kenanga', 'Cibinong Raya', 'Ciawi'];
const PEKERJAAN = ['Karyawan Swasta', 'Wiraswasta', 'PNS', 'Ibu Rumah Tangga', 'Pelajar/Mahasiswa', 'Guru',
  'Buruh', 'Petani'];
const KELUHAN_TEXT = [
  'Antrean terlalu lama, nomor sudah lewat tapi belum dipanggil.',
  'Dokter terlambat datang tanpa pemberitahuan.',
  'Kursi tunggu di ruang poli kurang bersih.',
  'Biaya administrasi tidak dijelaskan saat pendaftaran.',
  'Ruang tunggu terlalu panas, mohon ditambahkan kipas.',
  'Notifikasi WA tidak masuk setelah booking.',
  'Petugas loket kurang ramah saat menjelaskan jadwal.',
  'Toilet di lantai dua perlu dibersihkan lebih sering.',
];
const TL_TEXT = [
  'Terima kasih atas masukannya. Kami sedang menelusuri penyebabnya.',
  'Sudah kami teruskan ke unit terkait.',
  'Mohon maaf atas ketidaknyamanannya. Tindakan perbaikan sudah dijadwalkan.',
];
const WORDS = ['Aktif', 'Ya', 'Tidak', 'Baru', 'Lama', 'Umum', 'Contoh data', 'Sesuai', 'Belum', 'Sudah'];

const personName = () => `${pick(FIRST)} ${pick(LAST)}`;
const address = () => `Jl. ${pick(STREETS)} No. ${ri(1, 199)} RT ${pad(ri(1, 12), 3)}/RW ${pad(ri(1, 9), 3)}`;
const phone = () => '08' + digits(10);

// Poliklinik RSIA (kode sama dengan kd_poli di Khanza). Hanya poli yang punya jadwal di data contoh.
const POLIS = [
  { kd: 'OBG01', nm: 'Kandungan (Obgyn)', dur: 20, reg: 50000 },
  { kd: 'ANA01', nm: 'Anak', dur: 15, reg: 50000 },
  { kd: 'UMU01', nm: 'Umum', dur: 15, reg: 30000 },
  { kd: 'GIG01', nm: 'Gigi', dur: 20, reg: 40000 },
  { kd: 'GIZ01', nm: 'Gizi', dur: 30, reg: 30000 },
  { kd: 'LAK01', nm: 'Laktasi', dur: 30, reg: 35000 },
  { kd: 'USG01', nm: 'USG Kandungan', dur: 20, reg: 75000 },
  { kd: 'PSI01', nm: 'Psikologi', dur: 60, reg: 100000 },
];
const POLI = Object.fromEntries(POLIS.map((p) => [p.kd, p]));

// Dokter: jenis (DOKTER, DOKTER_GIGI, TERAPIS) dan gelar dipakai untuk schema rsia.
const DOKTERS = [
  { nama: 'Ayu Lestari', gd: 'dr.', gb: 'Sp.OG', poli: 'OBG01', jenis: 'DOKTER' },
  { nama: 'Rina Puspita', gd: 'dr.', gb: 'Sp.OG', poli: 'OBG01', jenis: 'DOKTER' },
  { nama: 'Hendra Wijaya', gd: 'dr.', gb: 'Sp.A', poli: 'ANA01', jenis: 'DOKTER' },
  { nama: 'Dewi Anggraini', gd: 'dr.', gb: 'Sp.A', poli: 'ANA01', jenis: 'DOKTER' },
  { nama: 'Andi Pratama', gd: 'dr.', gb: '', poli: 'UMU01', jenis: 'DOKTER' },
  { nama: 'Nur Hidayah', gd: 'dr.', gb: '', poli: 'UMU01', jenis: 'DOKTER' },
  { nama: 'Budi Santoso', gd: 'drg.', gb: '', poli: 'GIG01', jenis: 'DOKTER_GIGI' },
  { nama: 'Sri Wahyuni', gd: 'drg.', gb: 'Sp.KG', poli: 'GIG01', jenis: 'DOKTER_GIGI' },
  { nama: 'Maya Sari', gd: '', gb: 'S.Gz', poli: 'GIZ01', jenis: 'TERAPIS' },
  { nama: 'Tuti Handayani', gd: '', gb: 'Konselor Laktasi', poli: 'LAK01', jenis: 'TERAPIS' },
  { nama: 'Yusuf Maulana', gd: 'dr.', gb: 'Sp.OG', poli: 'USG01', jenis: 'DOKTER' },
  { nama: 'Fitri Ramadhani', gd: '', gb: 'M.Psi., Psikolog', poli: 'PSI01', jenis: 'TERAPIS' },
];

// Sesi praktik rutin dokter k: dua hari per minggu. Hari ditentukan dari indeks k.
function sessionsFor(k) {
  const mulai = k % 2 ? '13:00' : '08:00';
  const selesai = k % 2 ? '17:00' : '12:00';
  const a = HARI[(k % 6) + 1];
  const b = HARI[((k + 2) % 6) + 1];
  return [
    { hari: a, mulai, selesai },
    { hari: b, mulai, selesai },
  ];
}

// Pengecualian (dihitung dari hari praktik dokter, supaya tanggalnya memang ada jadwal):
const LIBUR = { k: 0, date: nextDay(sessionsFor(0)[0].hari, '2026-11-02') };
const TAMBAH = { k: 1, date: nextDay(sessionsFor(1)[0].hari, '2026-11-02'), mulai: '08:00', selesai: '11:00' };
const UBAH = { k: 2, date: nextDay(sessionsFor(2)[0].hari, '2026-11-02'), mulai: '09:00', selesai: '12:00' };

function sessionsOn(date) {
  const hari = HARI[dow(date)];
  const out = [];
  DOKTERS.forEach((d, k) => {
    if (LIBUR.k === k && LIBUR.date === date) return;
    if (UBAH.k === k && UBAH.date === date) {
      out.push({ k, poli: d.poli, mulai: UBAH.mulai, selesai: UBAH.selesai });
    } else {
      for (const s of sessionsFor(k)) {
        if (s.hari === hari) out.push({ k, poli: d.poli, mulai: s.mulai, selesai: s.selesai });
      }
    }
    if (TAMBAH.k === k && TAMBAH.date === date) {
      out.push({ k, poli: d.poli, mulai: TAMBAH.mulai, selesai: TAMBAH.selesai });
    }
  });
  return out;
}

// ---------- baca katalog PostgreSQL ----------
function q(sql) {
  const out = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-At', '-F', '\x1f', '-c', sql],
    { encoding: 'utf8', maxBuffer: 1 << 28 }
  );
  return out.split('\n').filter((l) => l.length).map((l) => l.split('\x1f'));
}

const tables = new Map();
for (const [t, c, type, maxlen, nullable, prec, scale] of q(`
  SELECT table_name, column_name, data_type, coalesce(character_maximum_length,0), is_nullable,
    coalesce(numeric_precision,0), coalesce(numeric_scale,0)
  FROM information_schema.columns WHERE table_schema='khanza' ORDER BY table_name, ordinal_position`)) {
  if (!tables.has(t)) tables.set(t, { name: t, cols: [], pk: [], uniq: [], fks: [], enums: {} });
  tables.get(t).cols.push({ name: c, type, maxlen: Number(maxlen), nullable: nullable === 'YES',
    prec: Number(prec), scale: Number(scale) });
}

const listCols = (s) => s.split(',').map((x) => x.trim().replace(/"/g, ''));
for (const [t, ct, def] of q(`
  SELECT cl.relname, co.contype, pg_get_constraintdef(co.oid)
  FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid
  JOIN pg_namespace n ON n.oid=cl.relnamespace
  WHERE n.nspname='khanza' AND co.contype IN ('p','u','f','c')`)) {
  const T = tables.get(t);
  if (ct === 'p') T.pk = listCols(def.match(/\((.*)\)/)[1]);
  else if (ct === 'u') T.uniq.push(listCols(def.match(/\((.*)\)/)[1]));
  else if (ct === 'f') {
    const m = def.match(/FOREIGN KEY \((.*?)\) REFERENCES (?:[\w"]+\.)?"?([^"(]+?)"?\((.*?)\)/);
    T.fks.push({ cols: listCols(m[1]), ref: m[2], refCols: listCols(m[3]) });
  } else if (ct === 'c') {
    const lits = [...def.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    if (!lits.length) continue;
    let best = null;
    let bestIdx = Infinity;
    for (const c of T.cols) {
      const idx = def.search(new RegExp('\\b' + c.name + '\\b'));
      if (idx >= 0 && idx < bestIdx) {
        bestIdx = idx;
        best = c.name;
      }
    }
    if (best && !T.enums[best]) T.enums[best] = lits;
  }
}

// Kolom induk tidak boleh lebih panjang dari kolom anak yang merujuknya, supaya nilai FK tetap muat.
for (const T of tables.values()) {
  for (const f of T.fks) {
    const P = tables.get(f.ref);
    if (!P) continue;
    f.cols.forEach((c, k) => {
      const child = T.cols.find((x) => x.name === c);
      const parent = P.cols.find((x) => x.name === f.refCols[k]);
      if (child && parent && child.maxlen > 0 && parent.maxlen > child.maxlen) parent.maxlen = child.maxlen;
    });
  }
}

// Ketergantungan tambahan untuk tabel yang diisi dari data lain (bukan lewat FK).
const EXTRA_DEPS = {
  dokter: ['pegawai'],
  jadwal: ['dokter', 'poliklinik'],
  reg_periksa: ['pasien', 'dokter', 'poliklinik', 'penjab', 'jadwal'],
  antripoli: ['reg_periksa'],
  booking_registrasi: ['pasien', 'dokter', 'poliklinik', 'penjab'],
  referensi_mobilejkn_bpjs: ['reg_periksa', 'pasien'],
  referensi_mobilejkn_bpjs_taskid: ['referensi_mobilejkn_bpjs', 'reg_periksa'],
  pasien: ['penjab'],
};

function topoOrder(names) {
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const n of names) {
    for (const f of tables.get(n).fks) if (f.ref !== n && tables.has(f.ref)) deps.get(n).add(f.ref);
    for (const d of EXTRA_DEPS[n] || []) if (d !== n) deps.get(n).add(d);
  }
  const order = [];
  let remaining = names.slice();
  let cycleCount = 0;
  while (remaining.length) {
    const placed = new Set(order);
    const ready = remaining.filter((n) => [...deps.get(n)].every((d) => placed.has(d)));
    if (!ready.length) {
      cycleCount = remaining.length;
      order.push(...remaining);
      break;
    }
    order.push(...ready);
    remaining = remaining.filter((n) => !ready.includes(n));
  }
  return { order, cycleCount };
}

// ---------- data dalam memori ----------
const data = new Map();
let clipped = 0; // jumlah nilai yang dipotong agar sesuai panjang kolom
const rowsOf = (t) => data.get(t) || [];
const SIM = { dokter: [], visits: [], bpjs: [] };

// Tabel khusus: mengembalikan baris parsial. Kolom lain diisi generator umum.
const CUSTOM = {
  poliklinik: () =>
    POLIS.map((p) => ({ kd_poli: p.kd, nm_poli: p.nm, registrasi: p.reg, registrasilama: p.reg * 0.6, status: '1' })),

  penjab: () => [
    { kd_pj: 'BPJ', png_jawab: 'BPJS Kesehatan', nama_perusahaan: 'BPJS Kesehatan',
      alamat_asuransi: 'Jl. Letjen Suprapto, Jakarta', no_telp: '021-1500400', attn: 'Peserta JKN', status: '1' },
    { kd_pj: 'UMU', png_jawab: 'Umum/Pribadi', nama_perusahaan: '-', alamat_asuransi: '-',
      no_telp: '-', attn: '-', status: '1' },
    { kd_pj: 'ASU', png_jawab: 'Asuransi Swasta', nama_perusahaan: 'PT Asuransi Contoh',
      alamat_asuransi: 'Jl. Sudirman, Jakarta', no_telp: '021-5550000', attn: 'Bagian Klaim', status: '1' },
  ],

  dokter: () => {
    const pegawai = rowsOf('pegawai');
    SIM.dokter = DOKTERS.map((d, k) => ({ ...d, kd: pegawai[k].nik }));
    return DOKTERS.map((d, k) => ({
      kd_dokter: SIM.dokter[k].kd,
      nm_dokter: fit(`${d.nama}${d.gb ? ', ' + d.gb : ''}`, 50),
      jk: k % 3 === 1 ? 'P' : 'L',
      status: '1',
      email: `dokter${k + 1}@contoh.test`,
    }));
  },

  jadwal: () => {
    const out = [];
    SIM.dokter.forEach((d, k) => {
      for (const s of sessionsFor(k)) {
        out.push({
          kd_dokter: d.kd,
          hari_kerja: s.hari,
          jam_mulai: s.mulai + ':00',
          jam_selesai: s.selesai + ':00',
          kd_poli: d.poli,
          kuota: 30,
        });
      }
    });
    return out;
  },

  pasien: () => {
    const out = [];
    for (let i = 1; i <= PASIEN_N; i++) {
      const kdPj = pickW([['BPJ', 65], ['UMU', 25], ['ASU', 10]]);
      const tglLahir = randDate('1955-01-01', '2025-12-31');
      const umurThn = Math.floor((Date.parse(TODAY) - Date.parse(tglLahir)) / (365.25 * 86400000));
      out.push({
        no_rkm_medis: pad(i, 6),
        nm_pasien: personName(),
        jk: rnd() < 0.5 ? 'L' : 'P',
        tmp_lahir: pick(CITIES),
        tgl_lahir: tglLahir,
        alamat: address(),
        no_tlp: phone(),
        no_ktp: '3271' + digits(12),
        kd_pj: kdPj,
        no_peserta: kdPj === 'BPJ' ? digits(13) : null,
        umur: `${umurThn} Th`,
        tgl_daftar: randDate('2024-01-01', TODAY),
        nm_ibu: personName(),
        namakeluarga: personName(),
        keluarga: pick(['Istri', 'Suami', 'Anak', 'Orang Tua']),
        pekerjaan: pick(PEKERJAAN),
        stts_nikah: pick(['Menikah', 'Belum Menikah', 'Janda']),
        agama: 'Islam',
        gol_darah: pick(['A', 'B', 'AB', 'O']),
        email: `pasien${i}@contoh.test`,
      });
    }
    return out;
  },

  reg_periksa: () => {
    const pasien = rowsOf('pasien');
    const out = [];
    SIM.visits = [];
    for (const date of daysBetween(REG_FROM, REG_TO)) {
      let seqDay = 0;
      const noReg = {};
      for (const ses of sessionsOn(date)) {
        const d = SIM.dokter[ses.k];
        const p = POLI[ses.poli];
        const slots = Math.floor((minutes(ses.selesai) - minutes(ses.mulai)) / p.dur);
        const n = Math.min(slots, ri(4, 10));
        for (let j = 0; j < n; j++) {
          seqDay++;
          noReg[ses.k] = (noReg[ses.k] || 0) + 1;
          const pas = pick(pasien);
          const stts = date < TODAY
            ? pickW([['Sudah', 85], ['Batal', 5], ['Dirawat', 5], ['Belum', 5]])
            : date === TODAY ? pickW([['Sudah', 40], ['Belum', 60]]) : 'Belum';
          const row = {
            no_reg: pad(noReg[ses.k], 3),
            no_rawat: `${date.replace(/-/g, '/')}/${pad(seqDay, 6)}`,
            tgl_registrasi: date,
            jam_reg: hhmm(minutes(ses.mulai) + j * p.dur) + ':00',
            kd_dokter: d.kd,
            no_rkm_medis: pas.no_rkm_medis,
            kd_poli: ses.poli,
            p_jawab: pas.namakeluarga,
            almt_pj: pas.alamat,
            hubunganpj: pas.keluarga,
            biaya_reg: p.reg,
            stts,
            stts_daftar: rnd() < 0.3 ? 'Baru' : 'Lama',
            status_lanjut: 'Ralan',
            kd_pj: pas.kd_pj,
            umurdaftar: ri(1, 80),
            sttsumur: 'Th',
            status_bayar: stts === 'Sudah' || stts === 'Dirawat' ? 'Sudah' : 'Belum',
            status_poli: rnd() < 0.3 ? 'Baru' : 'Lama',
          };
          out.push(row);
          SIM.visits.push({ ...row, k: ses.k, poli_kd: ses.poli });
        }
      }
    }
    return out;
  },

  antripoli: () =>
    SIM.visits
      .filter((v) => v.tgl_registrasi === TODAY)
      .map((v) => ({ kd_dokter: v.kd_dokter, kd_poli: v.kd_poli, status: rnd() < 0.5 ? '1' : '0', no_rawat: v.no_rawat })),

  antriloket: () => [
    { loket: 1, antrian: 12 },
    { loket: 2, antrian: 7 },
    { loket: 3, antrian: 0 },
  ],

  booking_registrasi: () => {
    const pasien = rowsOf('pasien');
    const out = [];
    const future = daysBetween(addDays(TODAY, 1), REG_TO);
    for (let i = 1; i <= 60; i++) {
      const date = pick(future);
      const sessions = sessionsOn(date);
      if (!sessions.length) continue;
      const ses = pick(sessions);
      const pas = pick(pasien);
      out.push({
        tanggal_booking: addDays(date, -ri(1, 14)),
        jam_booking: `${pad(ri(6, 20), 2)}:${pad(ri(0, 59), 2)}:00`,
        no_rkm_medis: pas.no_rkm_medis,
        tanggal_periksa: date,
        kd_dokter: SIM.dokter[ses.k].kd,
        kd_poli: ses.poli,
        no_reg: pad(i, 3),
        kd_pj: pas.kd_pj,
        limit_reg: 30,
        waktu_kunjungan: `${date} ${ses.mulai}:00`,
        status: 'Belum',
      });
    }
    return out;
  },

  referensi_mobilejkn_bpjs: () => {
    const pasienByRkm = new Map(rowsOf('pasien').map((p) => [p.no_rkm_medis, p]));
    const out = [];
    SIM.bpjs = [];
    let n = 0;
    for (const v of SIM.visits) {
      if (v.kd_pj !== 'BPJ' || rnd() < 0.1) continue;
      const pas = pasienByRkm.get(v.no_rkm_medis);
      n++;
      const row = {
        nobooking: v.tgl_registrasi.replace(/-/g, '') + pad(n, 4),
        no_rawat: v.no_rawat,
        nomorkartu: pas.no_peserta,
        nik: pas.no_ktp,
        nohp: pas.no_tlp,
        kodepoli: v.kd_poli,
        pasienbaru: rnd() < 0.5 ? 'Y' : 'N',
        norm: v.no_rkm_medis,
        tanggalperiksa: v.tgl_registrasi,
        kodedokter: v.kd_dokter,
        jampraktek: '08:00-12:00',
        jeniskunjungan: pick(['Rujukan FKTP', 'Kontrol', 'Rujukan Internal']),
        nomorreferensi: '0' + digits(12),
        nomorantrean: `${v.kd_poli}-${pad(n % 100, 3)}`,
        angkaantrean: String(n % 100),
        estimasidilayani: String(Date.parse(`${v.tgl_registrasi}T${v.jam_reg}+07:00`)),
        sisakuotajkn: 10,
        kuotajkn: 30,
        sisakuotanonjkn: 5,
        kuotanonjkn: 10,
        status: v.stts === 'Batal' ? 'Batal' : v.stts === 'Belum' ? 'Belum' : 'Hadir',
        validasi: `${v.tgl_registrasi} 06:00:00`,
        statuskirim: 'Sudah',
      };
      out.push(row);
      SIM.bpjs.push(row);
    }
    return out;
  },

  referensi_mobilejkn_bpjs_taskid: () => {
    const visitByRawat = new Map(SIM.visits.map((v) => [v.no_rawat, v]));
    const out = [];
    for (const b of SIM.bpjs) {
      const v = visitByRawat.get(b.no_rawat);
      const steps = v.tgl_registrasi < TODAY ? 7 : v.tgl_registrasi === TODAY ? 3 : 1;
      for (let t = 1; t <= steps; t++) {
        out.push({
          no_rawat: b.no_rawat,
          taskid: String(t),
          waktu: `${v.tgl_registrasi} ${hhmm(minutes(v.jam_reg) + (t - 1) * 5)}:00`,
        });
      }
    }
    return out;
  },
};

// ---------- generator umum ----------
const WORDS_BY_NAME = {
  nm_poli: () => pick(POLIS).nm,
  stts: () => pick(['Belum', 'Sudah', 'Batal']),
  jk: () => pick(['L', 'P']),
  gol_darah: () => pick(['A', 'B', 'AB', 'O']),
  agama: () => 'Islam',
};

function heuristicText(name, i) {
  if (WORDS_BY_NAME[name]) return WORDS_BY_NAME[name]();
  if (/^nm_|^nama|_nama$/.test(name)) return personName();
  if (/alamat|almt/.test(name)) return address();
  if (/telp|no_hp|nohp|^hp$/.test(name)) return phone();
  if (/email/.test(name)) return `user${i}@contoh.test`;
  if (/ktp|^nik$|_nik$/.test(name)) return digits(16);
  if (/^umur$/.test(name)) return `${ri(1, 80)} Th`;
  if (/^no_rkm_medis$/.test(name)) return pad(i, 6);
  return undefined;
}

function uniqueValue(c, i) {
  const { type, maxlen, name } = c;
  if (/char|text/.test(type)) {
    if (maxlen > 0 && maxlen <= 5) return String(i).slice(-maxlen).padStart(maxlen, '0');
    const pfx = name.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'K';
    return fit(pfx + pad(i, 4), maxlen || 20);
  }
  if (type === 'date') return addDays('2025-01-01', i % 900);
  if (/timestamp/.test(type)) return `2025-01-01 00:00:00`.replace('00:00:00', `${pad(i % 24, 2)}:00:00`);
  if (type === 'time without time zone') return `${pad(i % 24, 2)}:00:00`;
  return i;
}

function genValue(T, c, i, row, keyCols) {
  const { name, type, maxlen } = c;
  const enumVals = T.enums[name];
  const isKey = keyCols.has(name);
  if (c.nullable && !isKey && rnd() < 0.05) return null;
  if (enumVals) return isKey ? enumVals[(i - 1) % enumVals.length] : pick(enumVals);
  if (isKey) return uniqueValue(c, i);
  if (/char|text/.test(type)) {
    const h = heuristicText(name, i);
    if (h !== undefined) return fit(h, maxlen);
    if (name === 'status' || name === 'stts') return fit(pick(['0', '1']), maxlen || 20);
    return fit(pick(WORDS), maxlen);
  }
  if (/^(integer|smallint|bigint)$/.test(type)) return ri(0, 100);
  if (/numeric|double|real/.test(type)) return Math.round(rnd() * 100000) / 100;
  if (type === 'date') {
    return /lahir/.test(name) ? randDate('1960-01-01', '2025-12-31') : randDate('2025-06-01', TODAY);
  }
  if (type === 'time without time zone') return `${pad(ri(0, 23), 2)}:${pad(ri(0, 59), 2)}:00`;
  if (/timestamp/.test(type)) {
    return `${randDate('2025-06-01', TODAY)} ${pad(ri(0, 23), 2)}:${pad(ri(0, 59), 2)}:00`;
  }
  if (type === 'boolean') return rnd() < 0.5;
  if (type === 'bytea') return '\\x00';
  if (/json/.test(type)) return '{}';
  return null;
}

function genTable(T) {
  const custom = CUSTOM[T.name];
  const seeds = custom ? custom() : Array.from({ length: N_OVERRIDE[T.name] || FILLER_N }, () => ({}));
  const keyCols = new Set([...T.pk, ...T.uniq.flat()]);
  const keys = [T.pk, ...T.uniq].filter((k) => k.length);
  const seen = new Map(keys.map((k) => [k.join(','), new Set()]));
  const out = [];
  let dup = 0;
  seeds.forEach((row, idx) => {
    const i = idx + 1;
    for (const f of T.fks) {
      if (f.cols.some((c) => row[c] !== undefined)) continue;
      const parents = rowsOf(f.ref);
      if (!parents.length) {
        f.cols.forEach((c) => (row[c] = null));
        continue;
      }
      const keyish = f.cols.some((c) => keyCols.has(c));
      const p = keyish ? parents[idx % parents.length] : pick(parents);
      f.cols.forEach((c, k) => (row[c] = p[f.refCols[k]]));
    }
    for (const c of T.cols) {
      if (row[c.name] !== undefined) continue;
      row[c.name] = genValue(T, c, i, row, keyCols);
    }
    // Nilai dari tabel khusus harus memenuhi CHECK enum (Khanza memakai huruf besar, mis. 'SUAMI').
    for (const [col, vals] of Object.entries(T.enums)) {
      const v = row[col];
      if (v === null || v === undefined || vals.includes(v)) continue;
      const up = String(v).toUpperCase();
      row[col] = vals.includes(up) ? up : pick(vals);
    }
    // Panjang dan presisi harus sesuai definisi kolom (nilai dipotong atau dibatasi).
    for (const c of T.cols) {
      const v = row[c.name];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && c.maxlen > 0 && v.length > c.maxlen) {
        row[c.name] = v.slice(0, c.maxlen);
        clipped++;
      } else if (typeof v === 'number' && c.prec > 0 && c.scale >= 0) {
        const max = Math.pow(10, c.prec - c.scale) - Math.pow(10, -c.scale);
        if (Math.abs(v) > max) {
          row[c.name] = v < 0 ? -max : max;
          clipped++;
        }
      }
    }
    const sigs = keys.map((k) => [k.join(','), k.map((c) => String(row[c])).join('\x1e')]);
    if (sigs.some(([kn, sig]) => seen.get(kn).has(sig))) {
      dup++;
      return;
    }
    sigs.forEach(([kn, sig]) => seen.get(kn).add(sig));
    out.push(row);
  });
  data.set(T.name, out);
  return dup;
}

// ---------- rsia ----------
function buildRsia() {
  const T = [];
  const add = (table, cols, rows) => T.push({ table, cols, rows });

  // poliklinik dan dokter
  const polis = POLIS.map((p, k) => ({
    id: k + 1, kode: p.kd, durasi_menit: p.dur, bisa_booking: true, aktif: true,
  }));
  const polId = Object.fromEntries(polis.map((p) => [p.kode, p.id]));
  add('poliklinik', ['id', 'kode', 'durasi_menit', 'bisa_booking', 'aktif'], polis);

  const dokters = DOKTERS.map((d, k) => ({
    id: k + 1,
    kd_dokter: SIM.dokter[k].kd,
    jenis_tenaga: d.jenis,
    no_str: `STR-${pad(1000 + k, 6)}`,
    no_sip: `SIP-${pad(k + 1, 4)}/2026`,
    foto_url: null,
    aktif: true,
  }));
  const dokterId = Object.fromEntries(SIM.dokter.map((d, k) => [d.kd, k + 1]));
  add('dokter', ['id', 'kd_dokter', 'jenis_tenaga', 'no_str', 'no_sip', 'foto_url', 'aktif'], dokters);

  add('dokter_poli', ['dokter_id', 'poli_id'], DOKTERS.map((d, k) => ({ dokter_id: k + 1, poli_id: polId[d.poli] })));

  // jadwal rutin dan pengecualian
  const jadwal = [];
  DOKTERS.forEach((d, k) => {
    for (const s of sessionsFor(k)) {
      jadwal.push({
        id: jadwal.length + 1,
        dokter_id: k + 1,
        poli_id: polId[d.poli],
        hari: HARI.indexOf(s.hari),
        jam_mulai: s.mulai + ':00',
        jam_selesai: s.selesai + ':00',
        kuota_per_slot: 2,
        berlaku_dari: '2026-01-01',
        berlaku_sampai: null,
      });
    }
  });
  add('jadwal_praktik', ['id', 'dokter_id', 'poli_id', 'hari', 'jam_mulai', 'jam_selesai', 'kuota_per_slot', 'berlaku_dari', 'berlaku_sampai'], jadwal);
  add('jadwal_pengecualian', ['id', 'dokter_id', 'tanggal', 'jenis', 'jam_mulai', 'jam_selesai', 'kuota_per_slot', 'alasan'], [
    { id: 1, dokter_id: LIBUR.k + 1, tanggal: LIBUR.date, jenis: 'LIBUR', jam_mulai: null, jam_selesai: null, kuota_per_slot: null, alasan: 'Cuti dokter' },
    { id: 2, dokter_id: TAMBAH.k + 1, tanggal: TAMBAH.date, jenis: 'TAMBAHAN', jam_mulai: TAMBAH.mulai + ':00', jam_selesai: TAMBAH.selesai + ':00', kuota_per_slot: 2, alasan: 'Praktik tambahan' },
    { id: 3, dokter_id: UBAH.k + 1, tanggal: UBAH.date, jenis: 'UBAH_JAM', jam_mulai: UBAH.mulai + ':00', jam_selesai: UBAH.selesai + ':00', kuota_per_slot: 2, alasan: 'Jam praktik berubah' },
  ]);

  // penjamin
  const penjamin = [
    { id: 1, kd_pj: 'UMU', jenis: 'UMUM', aktif: true },
    { id: 2, kd_pj: 'BPJ', jenis: 'BPJS', aktif: true },
    { id: 3, kd_pj: 'ASU', jenis: 'ASURANSI', aktif: true },
    { id: 4, kd_pj: null, jenis: 'PERUSAHAAN', aktif: true },
  ];
  add('penjamin', ['id', 'kd_pj', 'jenis', 'aktif'], penjamin);
  const penjaminOf = { UMU: 1, BPJ: 2, ASU: 3 };

  // pasien (sama dengan khanza.pasien)
  const pasienKh = rowsOf('pasien');
  const pasienId = {};
  const pasien = pasienKh.map((p, k) => {
    pasienId[p.no_rkm_medis] = k + 1;
    const dibuat = `${randDate(p.tgl_daftar, TODAY)} 09:00:00+07:00`;
    return {
      id: k + 1,
      no_rkm_medis: p.no_rkm_medis,
      nik: '3572' + pad(k + 1, 12),
      no_wa: phone(),
      setuju_privasi_pada: dibuat,
      dibuat_pada: dibuat,
    };
  });
  add('pasien', ['id', 'no_rkm_medis', 'nik', 'no_wa', 'setuju_privasi_pada', 'dibuat_pada'], pasien);
  const pasienByRkm = new Map(pasienKh.map((p) => [p.no_rkm_medis, p]));

  const pasienPenjamin = [];
  const noKartuByPasien = {};
  pasienKh.forEach((p, k) => {
    const pid = penjaminOf[p.kd_pj];
    const noKartu = p.kd_pj === 'UMU' ? null : p.kd_pj === 'BPJ' ? p.no_peserta : digits(12);
    noKartuByPasien[p.no_rkm_medis] = noKartu;
    pasienPenjamin.push({ id: k + 1, pasien_id: k + 1, penjamin_id: pid, no_kartu: noKartu, aktif_sampai: null });
  });
  add('pasien_penjamin', ['id', 'pasien_id', 'penjamin_id', 'no_kartu', 'aktif_sampai'], pasienPenjamin);

  const pjRows = [];
  const pjByPasien = {};
  pasien.forEach((p) => {
    if (rnd() > 0.15) return;
    const id = pjRows.length + 1;
    pjByPasien[p.id] = id;
    pjRows.push({ id, pasien_id: p.id, nama: personName(), hubungan: pick(['Suami', 'Istri', 'Orang Tua', 'Saudara']), no_hp: phone() });
  });
  add('penanggung_jawab', ['id', 'pasien_id', 'nama', 'hubungan', 'no_hp'], pjRows);

  // booking: satu booking per kunjungan khanza (sebagian walk-in, sebagian daring)
  const bookings = [];
  const active = new Set();
  const visits = [...SIM.visits].sort((a, b) => (a.tgl_registrasi + a.jam_reg).localeCompare(b.tgl_registrasi + b.jam_reg));
  visits.forEach((v, idx) => {
    const id = idx + 1;
    const pid = pasienId[v.no_rkm_medis];
    const did = dokterId[v.kd_dokter];
    const plid = polId[v.kd_poli];
    const tgl = v.tgl_registrasi;
    let status;
    if (v.stts === 'Batal') status = 'BATAL';
    else if (v.stts === 'Sudah' || v.stts === 'Dirawat') status = tgl < TODAY || rnd() < 0.5 ? 'SELESAI' : 'DILAYANI';
    else if (tgl < TODAY) status = 'TIDAK_HADIR';
    else if (tgl === TODAY) status = rnd() < 0.5 ? 'HADIR' : 'TERJADWAL';
    else status = rnd() < 0.04 ? 'BATAL' : 'TERJADWAL';
    let alasan = null;
    if (status === 'BATAL') alasan = 'Dibatalkan oleh pasien';
    const key = `${pid}|${did}|${tgl}`;
    const isActive = ['TERJADWAL', 'HADIR', 'DIPANGGIL', 'DILAYANI'].includes(status);
    if (isActive && active.has(key)) {
      status = 'BATAL';
      alasan = 'Duplikat (dibatalkan sistem)';
    }
    if (['TERJADWAL', 'HADIR', 'DIPANGGIL', 'DILAYANI'].includes(status)) active.add(key);
    const dibuat = `${addDays(tgl, -ri(1, 10))} 08:${pad(ri(0, 59), 2)}:00+07:00`;
    bookings.push({
      id,
      kode: 'B' + pad(id, 9),
      pasien_id: pid,
      dokter_id: did,
      poli_id: plid,
      tanggal: tgl,
      jam: v.jam_reg,
      penjamin_id: penjaminOf[v.kd_pj],
      no_kartu: noKartuByPasien[v.no_rkm_medis],
      no_rujukan: v.kd_pj === 'BPJ' && rnd() < 0.7 ? 'RJK' + digits(12) : null,
      penanggung_jawab_id: pjByPasien[pid] && rnd() < 0.5 ? pjByPasien[pid] : null,
      no_rawat: v.no_rawat,
      kanal: pickW([['WEB', 40], ['WHATSAPP', 25], ['TELEPON', 10], ['WALKIN', 25]]),
      status,
      jumlah_dilewati: status === 'HADIR' && rnd() < 0.05 ? 1 : 0,
      dibuat_pada: dibuat,
      dibatalkan_pada: status === 'BATAL' ? `${addDays(tgl, -1)} 12:00:00+07:00` : null,
      alasan_batal: alasan,
    });
  });
  add('booking', ['id', 'kode', 'pasien_id', 'dokter_id', 'poli_id', 'tanggal', 'jam', 'penjamin_id', 'no_kartu',
    'no_rujukan', 'penanggung_jawab_id', 'no_rawat', 'kanal', 'status', 'jumlah_dilewati', 'dibuat_pada',
    'dibatalkan_pada', 'alasan_batal'], bookings);

  // antrean: nomor per tanggal dan poli, untuk booking yang tidak batal dan sudah lewat/hari ini
  const groups = new Map();
  bookings.forEach((b) => {
    if (!['HADIR', 'DILAYANI', 'DILEWATI', 'SELESAI', 'TIDAK_HADIR'].includes(b.status)) return;
    const k = b.tanggal + '|' + b.poli_id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  });
  const antrean = [];
  const counter = [];
  let antreanId = 0;
  for (const [k, list] of [...groups.entries()].sort()) {
    const [tgl, poli] = k.split('|');
    list.sort((a, b) => a.jam.localeCompare(b.jam) || a.id - b.id);
    list.forEach((b, idx) => {
      const nomor = idx + 1;
      const durasi = POLIS[Number(poli) - 1].dur;
      const jamMulai = minutes(b.jam.slice(0, 5));
      const datang = b.status !== 'TIDAK_HADIR';
      const dipanggil = b.status === 'DILAYANI' || b.status === 'SELESAI';
      antrean.push({
        id: ++antreanId,
        booking_id: b.id,
        tanggal: tgl,
        poli_id: Number(poli),
        nomor,
        waktu_checkin: datang ? `${tgl} ${hhmm(jamMulai - 15)}:00+07:00` : null,
        waktu_panggil: dipanggil ? `${tgl} ${b.jam.slice(0, 5)}:00+07:00` : null,
        waktu_mulai: dipanggil ? `${tgl} ${hhmm(jamMulai + 5)}:00+07:00` : null,
        waktu_selesai: b.status === 'SELESAI' ? `${tgl} ${hhmm(jamMulai + durasi)}:00+07:00` : null,
        jumlah_panggil: dipanggil ? 1 : 0,
        loket: datang ? pick(['Loket 1', 'Loket 2']) : null,
      });
    });
    counter.push({ tanggal: tgl, poli_id: Number(poli), terakhir: list.length });
  }
  add('antrean', ['id', 'booking_id', 'tanggal', 'poli_id', 'nomor', 'waktu_checkin', 'waktu_panggil', 'waktu_mulai',
    'waktu_selesai', 'jumlah_panggil', 'loket'], antrean);
  add('antrean_counter', ['tanggal', 'poli_id', 'terakhir'], counter);

  // keterlambatan dokter (dicatat petugas poli, pengguna id 4)
  const telat = [];
  for (let i = 1; i <= 6; i++) {
    const tgl = randDate(addDays(TODAY, -30), addDays(TODAY, -1));
    const dibuat = `${tgl} 08:${pad(ri(0, 59), 2)}:00+07:00`;
    telat.push({
      id: i,
      dokter_id: ri(1, DOKTERS.length),
      tanggal: tgl,
      menit_terlambat: ri(15, 60),
      alasan: pick(['Operasi darurat', 'Rapat mendadak', 'Urusan keluarga']),
      dicatat_oleh: 4,
      dibuat_pada: dibuat,
      selesai_pada: `${tgl} 10:00:00+07:00`,
    });
  }
  add('keterlambatan_dokter', ['id', 'dokter_id', 'tanggal', 'menit_terlambat', 'alasan', 'dicatat_oleh', 'dibuat_pada', 'selesai_pada'], telat);

  // keluhan
  const kategori = [
    { id: 1, nama: 'Pelayanan Dokter', sla_jam: 24, unit_penanggung_jawab: 'Manajemen Medis' },
    { id: 2, nama: 'Antrean dan Waktu Tunggu', sla_jam: 24, unit_penanggung_jawab: 'Pendaftaran' },
    { id: 3, nama: 'Kebersihan', sla_jam: 24, unit_penanggung_jawab: 'Sarana' },
    { id: 4, nama: 'Biaya dan Administrasi', sla_jam: 48, unit_penanggung_jawab: 'Keuangan' },
    { id: 5, nama: 'Fasilitas', sla_jam: 72, unit_penanggung_jawab: 'Sarana' },
    { id: 6, nama: 'Lainnya', sla_jam: 72, unit_penanggung_jawab: 'CS' },
  ];
  add('keluhan_kategori', ['id', 'nama', 'sla_jam', 'unit_penanggung_jawab'], kategori);

  const keluhan = [];
  const tindak = [];
  for (let i = 1; i <= 40; i++) {
    const withPasien = rnd() < 0.6;
    const b = withPasien ? pick(bookings) : null;
    const status = pickW([['BARU', 20], ['DIPROSES', 30], ['SELESAI', 50]]);
    const dibuat = `${randDate(REG_FROM, TODAY)} ${pad(ri(7, 20), 2)}:${pad(ri(0, 59), 2)}:00+07:00`;
    const respons = status !== 'BARU' ? `${dibuat.slice(0, 10)} 15:00:00+07:00` : null;
    const pas = b ? pasien[b.pasien_id - 1] : null;
    keluhan.push({
      id: i,
      no_tiket: 'KLH' + pad(i, 7),
      kategori_id: ri(1, kategori.length),
      pasien_id: b ? b.pasien_id : null,
      nama_pelapor: pas ? null : personName(),
      kontak: pas ? pas.no_wa : phone(),
      poli_id: b ? b.poli_id : ri(1, polis.length),
      booking_id: b ? b.id : null,
      isi: pick(KELUHAN_TEXT),
      status,
      ditangani_oleh: status !== 'BARU' ? pick([2, 3, 5]) : null,
      dibuat_pada: dibuat,
      respons_pertama_pada: respons,
      selesai_pada: status === 'SELESAI' ? `${addDays(dibuat.slice(0, 10), 1)} 10:00:00+07:00` : null,
    });
    if (status !== 'BARU') {
      for (let t = 1; t <= ri(1, 2); t++) {
        tindak.push({
          id: tindak.length + 1,
          keluhan_id: i,
          oleh: pick([2, 3, 5]),
          isi: pick(TL_TEXT),
          terlihat_pelapor: true,
          dibuat_pada: respons,
        });
      }
    }
  }
  add('keluhan', ['id', 'no_tiket', 'kategori_id', 'pasien_id', 'nama_pelapor', 'kontak', 'poli_id', 'booking_id', 'isi',
    'status', 'ditangani_oleh', 'dibuat_pada', 'respons_pertama_pada', 'selesai_pada'], keluhan);
  add('keluhan_tindak_lanjut', ['id', 'keluhan_id', 'oleh', 'isi', 'terlihat_pelapor', 'dibuat_pada'], tindak);

  // notifikasi WhatsApp
  const notif = [];
  const nid = () => notif.length + 1;
  const sent = (tgl) => (tgl < TODAY || rnd() < 0.8 ? 'TERKIRIM' : 'ANTRI');
  for (const b of bookings) {
    const noTujuan = pasien[b.pasien_id - 1].no_wa;
    const poliNama = POLIS[b.poli_id - 1].nm;
    const add1 = (jenis, isi, status, dibuat) => {
      const id = nid();
      const ok = status === 'TERKIRIM' || status === 'DIBACA';
      notif.push({
        id, booking_id: b.id, keluhan_id: null, no_tujuan: noTujuan, jenis, isi, status,
        provider_msg_id: ok ? `WA${id}` : null, dikirim_pada: status === 'ANTRI' ? null : dibuat,
        dibuat_pada: dibuat,
      });
    };
    const dibuatKonf = b.dibuat_pada;
    add1('KONFIRMASI', `Booking ${b.kode} untuk ${b.tanggal} ${b.jam.slice(0, 5)} di ${poliNama} sudah diterima.`,
      rnd() < 0.5 ? 'DIBACA' : 'TERKIRIM', dibuatKonf);
    if (b.status === 'BATAL') {
      add1('PEMBATALAN', `Booking ${b.kode} dibatalkan.`, 'TERKIRIM', b.dibatalkan_pada);
    }
    if (b.status === 'TIDAK_HADIR') {
      add1('NO_SHOW', `Anda tidak hadir pada ${b.tanggal}. Silakan booking ulang.`, rnd() < 0.2 ? 'GAGAL' : 'TERKIRIM', `${b.tanggal} 17:00:00+07:00`);
    }
    if (['DILAYANI', 'SELESAI'].includes(b.status)) {
      add1('PANGGILAN', `Nomor antrean Anda untuk ${poliNama} dipanggil.`, 'TERKIRIM', `${b.tanggal} ${b.jam.slice(0, 5)}:00+07:00`);
    }
    if (b.status === 'TERJADWAL') {
      const h1 = addDays(b.tanggal, -1);
      add1('PENGINGAT_H1', `Pengingat: besok ${b.tanggal} pukul ${b.jam.slice(0, 5)} di ${poliNama}.`, sent(h1), `${h1} 17:00:00+07:00`);
    }
  }
  for (const k of telat) {
    const pas = pick(pasien);
    const id = nid();
    notif.push({
      id, booking_id: null, keluhan_id: null, no_tujuan: pas.no_wa, jenis: 'DOKTER_TERLAMBAT',
      isi: `Dokter ${DOKTERS[k.dokter_id - 1].nama} terlambat ${k.menit_terlambat} menit. Mohon maaf atas ketidaknyamanannya.`,
      status: 'TERKIRIM', provider_msg_id: `WA${id}`, dikirim_pada: k.dibuat_pada, dibuat_pada: k.dibuat_pada,
    });
  }
  for (const t of tindak) {
    const kel = keluhan[t.keluhan_id - 1];
    if (!kel.pasien_id) continue;
    const id = nid();
    notif.push({
      id, booking_id: null, keluhan_id: kel.id, no_tujuan: pasien[kel.pasien_id - 1].no_wa, jenis: 'BALASAN_KELUHAN',
      isi: `Keluhan ${kel.no_tiket} sudah ditanggapi. ${t.isi}`, status: 'TERKIRIM',
      provider_msg_id: `WA${id}`, dikirim_pada: t.dibuat_pada, dibuat_pada: t.dibuat_pada,
    });
  }
  add('notifikasi_wa', ['id', 'booking_id', 'keluhan_id', 'no_tujuan', 'jenis', 'isi', 'status', 'provider_msg_id',
    'dikirim_pada', 'dibuat_pada'], notif);

  // pengguna staf dan audit (hash kata sandi hanya penanda untuk data contoh)
  const pengguna = [
    { id: 1, username: 'admin', nama: 'Administrator', peran: 'ADMIN' },
    { id: 2, username: 'pendaftaran', nama: 'Petugas Pendaftaran', peran: 'PENDAFTARAN' },
    { id: 3, username: 'cs', nama: 'Customer Service', peran: 'CS' },
    { id: 4, username: 'poli', nama: 'Petugas Poli', peran: 'POLI' },
    { id: 5, username: 'manajemen', nama: 'Manajemen', peran: 'MANAJEMEN' },
  ].map((u) => ({ ...u, password_hash: 'DEV-ONLY-GANTI-SEBELUM-DIPAKAI', aktif: true }));
  add('pengguna', ['id', 'username', 'nama', 'peran', 'password_hash', 'aktif'], pengguna);

  const audit = [];
  for (let i = 1; i <= 150; i++) {
    const b = pick(bookings);
    const after = b.status;
    audit.push({
      id: i,
      pengguna_id: ri(1, 5),
      aksi: 'UBAH_STATUS',
      tabel: 'booking',
      baris_id: b.id,
      sebelum: JSON.stringify({ status: 'TERJADWAL' }),
      sesudah: JSON.stringify({ status: after }),
      waktu: `${b.tanggal} ${pad(ri(7, 20), 2)}:${pad(ri(0, 59), 2)}:00+07:00`,
    });
  }
  add('audit_log', ['id', 'pengguna_id', 'aksi', 'tabel', 'baris_id', 'sebelum', 'sesudah', 'waktu'], audit);

  return T;
}

// ---------- jalankan ----------
const khanzaNames = [...tables.keys()].sort();
const { order, cycleCount } = topoOrder(khanzaNames);

const stats = [];
let totalDup = 0;
for (const name of order) {
  const T = tables.get(name);
  const dup = genTable(T);
  totalDup += dup;
  stats.push({ name, rows: rowsOf(name).length, dup });
}

const rsia = buildRsia();

// ---------- tulis SQL ----------
const qi = (x) => '"' + x + '"';
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function insertSql(schema, table, cols, rows) {
  const out = [];
  for (let s = 0; s < rows.length; s += 200) {
    const chunk = rows.slice(s, s + 200);
    const values = chunk.map((r) => '(' + cols.map((c) => lit(r[c])).join(', ') + ')').join(',\n');
    out.push(`INSERT INTO ${schema}.${qi(table)} (${cols.map(qi).join(', ')}) VALUES\n${values};`);
  }
  return out.join('\n');
}

// Dua berkas: satu untuk database khanza (schema khanza), satu untuk database rsia (schema rsia).
const base = OUT.replace(/\.sql$/i, '');
const OUT_KHANZA = base + '-khanza.sql';
const OUT_RSIA = base + '-rsia.sql';

const header = (db) => [
  `-- Data contoh database ${db}. Dihasilkan oleh seed-simrs-pg95.js. Jangan diedit manual.`,
  'BEGIN;',
  'SET search_path TO public;',
];

const linesKh = header('khanza');
linesKh.push(`TRUNCATE TABLE ${khanzaNames.map((t) => 'khanza.' + qi(t)).join(', ')} RESTART IDENTITY CASCADE;`);
for (const name of order) {
  const rows = rowsOf(name);
  if (!rows.length) continue;
  const cols = tables.get(name).cols.map((c) => c.name);
  linesKh.push(insertSql('khanza', name, cols, rows));
}
linesKh.push('COMMIT;');
fs.writeFileSync(OUT_KHANZA, linesKh.join('\n') + '\n', 'utf8');

// Nama kolom rsia dibuat sama dengan kolom Khanza yang dipetakan (lihat docs/02 bagian 1.4.1).
// Nama di dalam skrip tetap memakai nama lama; pemetaan hanya diterapkan saat menulis SQL.
const RSIA_KOLOM = {
  poliklinik: { kode: 'kd_poli' },
  pasien: { nik: 'no_ktp', no_wa: 'no_tlp' },
  pasien_penjamin: { no_kartu: 'no_peserta' },
  booking: { kode: 'nobooking', tanggal: 'tanggal_periksa', jam: 'jam_booking', no_kartu: 'nomorkartu', no_rujukan: 'nomorreferensi' },
  antrean: { tanggal: 'tgl_registrasi', nomor: 'no_reg' },
};
for (const t of rsia) {
  const m = RSIA_KOLOM[t.table];
  if (!m) continue;
  t.rows = t.rows.map((r) => Object.fromEntries(t.cols.map((c) => [m[c] || c, r[c]])));
  t.cols = t.cols.map((c) => m[c] || c);
}

const linesRsia = header('rsia');
const rsiaNames = rsia.map((t) => t.table);
linesRsia.push(`TRUNCATE TABLE ${rsiaNames.map((t) => 'rsia.' + qi(t)).join(', ')} RESTART IDENTITY CASCADE;`);
for (const t of rsia) {
  if (t.rows.length) linesRsia.push(insertSql('rsia', t.table, t.cols, t.rows));
}
for (const t of rsia) {
  if (t.cols.includes('id')) {
    linesRsia.push(`SELECT setval(pg_get_serial_sequence('rsia.${t.table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM rsia.${t.table}));`);
  }
}
linesRsia.push('COMMIT;');
fs.writeFileSync(OUT_RSIA, linesRsia.join('\n') + '\n', 'utf8');

// ---------- ringkasan ----------
const withRows = stats.filter((s) => s.rows > 0).length;
const totalKh = stats.reduce((a, s) => a + s.rows, 0);
const totalRsia = rsia.reduce((a, t) => a + t.rows.length, 0);
console.log(`Tabel khanza: ${khanzaNames.length} (terisi ${withRows}), baris ${totalKh}`);
console.log(`Ketergantungan siklik yang tidak bisa diurutkan: ${cycleCount} tabel`);
console.log(`Baris duplikat yang dibuang: ${totalDup}`);
console.log(`Nilai yang dipotong agar sesuai kolom: ${clipped}`);
console.log(`Tabel rsia: ${rsia.length}, baris ${totalRsia}`);
for (const t of rsia) console.log(`  rsia.${t.table}: ${t.rows.length}`);
console.log(`Ditulis ke ${OUT_KHANZA} dan ${OUT_RSIA}`);
