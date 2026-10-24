// Perekam video demo RSIA Pasutri Bogor.
// Pakai: node rekam.mjs [--dry]   (--dry = uji cepat tanpa rekaman)
// Butuh: playwright-core + Google Chrome. Keluaran: webm di folder OUT.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const DRY = process.argv.includes('--dry');
const SPEED = DRY ? 8 : 1;
const INDEX = process.env.INDEX || 'C:/Claude/RSIA Pasutri Bogor/index.html';
const OUT = process.env.OUT || path.resolve('out');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--force-device-scale-factor=1'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ...(DRY ? {} : { recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } }),
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });

/* ---------- overlay (kursor, teks bawah, sorotan, kartu judul) ---------- */
const OVERLAY = () => {
  const st = document.createElement('style');
  st.textContent = `
  body{padding-bottom:132px}
  .toast{bottom:150px!important;font-size:16px!important}
  #dm-cap{position:fixed;left:0;right:0;bottom:0;z-index:99990;background:rgba(6,20,24,.96);color:#fff;padding:14px 40px 18px;display:flex;gap:22px;align-items:center;min-height:108px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;border-top:3px solid #13a89f}
  #dm-cap .lab{flex:none;background:#13a89f;color:#032a28;font-weight:800;font-size:13px;letter-spacing:.08em;padding:8px 13px;border-radius:8px;text-transform:uppercase;white-space:nowrap}
  #dm-cap .lab.staf{background:#ffb020}#dm-cap .lab.mgmt{background:#ff7aa8}
  #dm-cap .txt{font-size:24px;line-height:1.36;font-weight:600;transition:opacity .25s}
  #dm-cur{position:fixed;left:0;top:0;z-index:99999;width:32px;height:32px;pointer-events:none;transition:transform .9s cubic-bezier(.45,.05,.25,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  #dm-cur svg{transition:transform .12s;transform-origin:4px 2px}
  #dm-cur.press svg{transform:scale(.78)}
  .dm-rip{position:fixed;z-index:99998;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #ff3d7f;pointer-events:none;animation:dmrip .65s ease-out forwards}
  @keyframes dmrip{to{transform:scale(4.5);opacity:0}}
  #dm-hl{position:fixed;z-index:99980;border:3px solid #ffb020;border-radius:12px;pointer-events:none;box-shadow:0 0 0 6px rgba(255,176,32,.28);transition:opacity .3s;opacity:0}
  #dm-title{position:fixed;inset:0;z-index:99995;background:linear-gradient(135deg,#093a37,#0e8a83);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:'Plus Jakarta Sans',system-ui,sans-serif;transition:opacity .8s;padding:40px}
  #dm-title h1{font-size:52px;margin:0 0 14px;line-height:1.15;color:#fff}
  #dm-title p{font-size:24px;margin:6px 0;opacity:.92}
  #dm-title .pill{margin-top:26px;background:rgba(255,255,255,.16);padding:8px 18px;border-radius:99px;font-size:16px}
  #dm-title ul{list-style:none;padding:0;margin:22px 0 0;font-size:24px;text-align:left}
  #dm-title li{margin:10px 0}
  #dm-modal{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);z-index:99970;background:#fff;color:#102a30;border-radius:16px;padding:26px 30px;width:600px;box-shadow:0 20px 60px rgba(0,0,0,.45);font-family:'Plus Jakarta Sans',system-ui,sans-serif}
  #dm-modal small{color:#5a6f75;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:12px}
  #dm-modal p{margin:10px 0 16px;font-size:18px;line-height:1.4}
  #dm-modal .ans{border:2px solid #0e8a83;border-radius:10px;padding:12px 14px;font-size:18px;min-height:48px;background:#f3f9f9}
  `;
  document.head.appendChild(st);
  const cap = document.createElement('div'); cap.id = 'dm-cap'; cap.innerHTML = '<span class="lab">Demo</span><span class="txt"></span>'; document.body.appendChild(cap);
  const cur = document.createElement('div'); cur.id = 'dm-cur'; cur.style.transform = 'translate(640px,330px)';
  cur.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24"><path d="M3 2l7.5 18 2.6-7.4L20.5 10z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>'; document.body.appendChild(cur);
  const hl = document.createElement('div'); hl.id = 'dm-hl'; document.body.appendChild(hl);
  let pos = [640, 330];
  window.dm = {
    cap(text, label, kind) {
      const l = cap.querySelector('.lab'), t = cap.querySelector('.txt');
      t.style.opacity = 0;
      setTimeout(() => { t.textContent = text; t.style.opacity = 1; if (label) { l.textContent = label; l.className = 'lab ' + (kind || ''); } }, 220);
    },
    move(x, y) { pos = [x, y]; cur.style.transform = `translate(${x - 4}px,${y - 2}px)`; },
    press() {
      cur.classList.add('press'); setTimeout(() => cur.classList.remove('press'), 160);
      const r = document.createElement('div'); r.className = 'dm-rip'; r.style.left = pos[0] + 'px'; r.style.top = pos[1] + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700);
    },
    hl(x, y, w, h, ms) { hl.style.left = x - 6 + 'px'; hl.style.top = y - 6 + 'px'; hl.style.width = w + 12 + 'px'; hl.style.height = h + 12 + 'px'; hl.style.opacity = 1; setTimeout(() => hl.style.opacity = 0, ms); },
    title(html) { cur.style.opacity = 0; let t = document.getElementById('dm-title'); if (!t) { t = document.createElement('div'); t.id = 'dm-title'; document.body.appendChild(t); } t.style.opacity = 1; t.style.pointerEvents = 'auto'; t.innerHTML = html; },
    untitle() { cur.style.opacity = 1; const t = document.getElementById('dm-title'); if (t) { t.style.opacity = 0; t.style.pointerEvents = 'none'; } },
    modal(msg, ans, ms) {
      const m = document.createElement('div'); m.id = 'dm-modal'; m.innerHTML = `<small>Pesan dari sistem</small><p></p><div class="ans"></div>`;
      m.querySelector('p').textContent = msg; m.querySelector('.ans').textContent = ans; document.body.appendChild(m); setTimeout(() => m.remove(), ms);
    },
  };
  window.prompt = msg => { const a = window.__ans || ''; window.dm.modal(msg, a, 4200); return a; };
};

/* ---------- helper aksi ---------- */
let seq = 0;
const cap = async (text, label, kind, hold) => {
  seq++; console.log(`[${seq}] ${label || ''} ${text.slice(0, 60)}`);
  await page.evaluate(([t, l, k]) => dm.cap(t, l, k), [text, label, kind]);
  await sleep(hold ?? Math.max(2800, text.length * 62));
  if (process.env.SHOTS && process.env.SHOTS.split(',').includes(String(seq))) await page.screenshot({ path: path.join(OUT, `shot-${seq}.png`) });
};
let LAB = 'Sisi Pasien', KIND = '';
const say = (text, hold) => cap(text, LAB, KIND, hold);
const target = async sel => {
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 10000 });
  await el.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(800);
  return el;
};
const moveTo = async (sel, dx = 0, dy = 0) => {
  const el = await target(sel); const b = await el.boundingBox();
  const x = b.x + Math.min(b.width / 2, 170) + dx, y = b.y + b.height / 2 + dy;
  await page.evaluate(([x, y]) => dm.move(x, y), [x, y]); await sleep(1000);
  return { el, x, y };
};
const click = async (sel, after = 800) => {
  const { el, x, y } = await moveTo(sel);
  await page.evaluate(() => dm.press()); await sleep(170);
  await el.click(); await sleep(after);
};
const typeIn = async (sel, text, delay = 65) => {
  const { el } = await moveTo(sel); await page.evaluate(() => dm.press()); await el.click();
  await el.pressSequentially(text, { delay: delay / SPEED }); await sleep(500);
};
const fillIn = async (sel, val) => { const { el } = await moveTo(sel); await page.evaluate(() => dm.press()); await el.click(); await el.fill(val); await sleep(500); };
const pickSel = async (sel, val) => { const { el } = await moveTo(sel); await page.evaluate(() => dm.press()); await el.selectOption(val); await sleep(600); };
const glow = async (sel, ms = 2600) => {
  const el = await target(sel); const b = await el.boundingBox();
  await page.evaluate(([x, y, w, h, ms]) => dm.hl(x, y, w, h, ms), [b.x, b.y, b.width, b.height, ms]); await sleep(300);
};
const nav = key => click(`#hdr [data-act=tab][data-v=${key}]`);
const snav = key => click(`.side [data-act=tab][data-v=${key}]`);
const role = r => click(`#roles [data-act=role][data-v=${r}]`, 1200);
const scrollTop = async () => { await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await sleep(900); };
const answer = a => page.evaluate(a => { window.__ans = a; }, a);

try {
  await page.goto('file:///' + INDEX.replace(/^\/+/, ''));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(OVERLAY);

  /* ---- judul + penyiapan data contoh (tersembunyi di balik kartu judul) ---- */
  await page.evaluate(() => dm.title(`<h1>Demo Sistem Antrean &amp; Booking<br>RSIA Pasutri Bogor</h1><p>Alur lengkap dari sisi pasien, staf pendaftaran, dan manajemen</p><div class="pill">Prototipe · seluruh data pada demo adalah data contoh</div>`));
  const info = await page.evaluate(() => {
    const today = iso(TODAY);
    const d1 = dok(1), date = dates(d1)[0];
    const sl = slotsOf(d1).filter(t => date != today || t > nowHM());
    DB.bookings = DB.bookings.filter(b => !(b.dokterId == 1 && b.date == date));
    const fill = (t, n) => { for (let i = 0; i < n; i++) DB.bookings.push(mkBooking({ nama: 'Pasien ' + t + i, date, time: t, dokterId: 1, poli: 'OBG', channel: 'Web', queue: nextQ('OBG', date) })); };
    fill(sl[1], 2); fill(sl[2], 1);
    DB.bookings = DB.bookings.filter(b => !(b.dokterId == 8 && b.date == today));
    const names = ['Ani Wijaya', 'Budi Hartono', 'Citra Lestari', 'Dewi Anggraini'], times = ['09:00', '09:15', '09:30', '09:45'], ch = ['Web', 'WhatsApp', 'Web', 'Telepon'];
    names.forEach((n, i) => DB.bookings.push(mkBooking({ nama: n, date: today, time: times[i], dokterId: 8, poli: 'UMU', channel: ch[i], status: 'Terjadwal', queue: nextQ('UMU', today) })));
    const busy = DOK.filter(d => d.id != 1 && d.id != 8 && dokQueue(d.id).some(b => ['Terjadwal', 'Hadir'].includes(b.status)));
    return { date, slotFull: sl[1], slotOne: sl[2], late: busy[0].id, lateName: busy[0].nama, walk: busy[1].id };
  });
  console.log('setup', JSON.stringify(info));
  await sleep(4200);
  await page.evaluate(() => dm.untitle()); await sleep(900);

  /* =============== SISI PASIEN =============== */
  LAB = 'Sisi Pasien'; KIND = '';
  await say('Ini beranda pasien. Pasien bisa mendaftar dari rumah, tanpa antre di loket.');
  await glow('.hero .search', 2400);
  await say('Di kanan terlihat kondisi layanan hari ini: jumlah dokter yang praktik dan pasien yang sedang menunggu.');
  await moveTo('.status');
  await glow('.status', 2400);
  await say('Pasien juga bisa langsung memilih poliklinik yang dibutuhkan.');
  await moveTo('.polis .poli:nth-child(2)');
  await nav('dokter');
  await say('Menu Jadwal Dokter menampilkan hari dan jam praktik setiap dokter. Di website lama, jadwal ini tidak ditampilkan.');
  await typeIn('#dq', 'Anak');
  await say('Pasien bisa mencari dokter atau poli dengan mengetik, lalu langsung menekan tombol Booking.', 3200);
  await glow('.dgrid .card:first-child', 2200);

  await nav('booking');
  await say('Kita mulai booking. Langkah 1: pilih poliklinik, misalnya Kebidanan dan Kandungan.');
  await click('.poli[data-act=bpoli][data-v=OBG]', 900);
  await say('Langkah 2: pilih dokter. Hari praktik setiap dokter terlihat jelas.');
  await click('.dcard[data-act=bdok][data-v="1"]', 900);
  await say('Langkah 3: pilih tanggal. Hanya tanggal ketika dokter praktik yang bisa dipilih.');
  await click('.dchip[data-act=bdate]', 900);
  await say('Jam yang penuh dicoret dan tidak bisa dipilih. Tiap jam punya kuota agar pasien tidak menumpuk di waktu yang sama.', 4200);
  await glow('.slot.full', 3000);
  await click('.slot[data-act=btime]:has-text("sisa 1")', 900);
  await say('Di samping, ringkasan booking dan perkiraan jumlah pasien di depan langsung terlihat.');
  await glow('.sum', 2600);
  await click('[data-act=next]', 1000);
  await say('Langkah 4: data pasien. Jika ada isian kosong atau salah, sistem langsung memberi tahu.');
  await click('[data-act=tovalid]', 1200);
  await glow('.err', 2200);
  await say('Untuk pembayaran BPJS, sistem meminta nomor kartu dan nomor rujukan. Di form lama, keduanya tidak ada.');
  await click('[data-act=penj][data-v=BPJS]', 900);
  await say('Data diisi sesuai identitas. NIK harus 16 digit, dan nomor WhatsApp dipakai untuk semua notifikasi.');
  await typeIn('#f_nama', 'Sari Wulandari');
  await typeIn('#f_nik', '3271045512950003', 45);
  await fillIn('#f_lahir', '1995-12-15');
  await typeIn('#f_wa', '081234567890');
  await typeIn('#f_noBpjs', '0001234567890', 45);
  await typeIn('#f_rujukan', '0123R0010-1022Y000123', 45);
  await say('Penanggung jawab dan persetujuan kebijakan privasi juga dicatat.');
  await typeIn('#f_pj', 'Rudi Hartono');
  await pickSel('#f_hub', 'Suami');
  await click('[data-f=setuju]', 700);
  await click('[data-act=tovalid]', 1200);
  await say('Langkah 5: periksa kembali semua data sebelum dikonfirmasi.');
  await click('[data-act=confirm]', 1500);
  await say('Booking berhasil. Pasien mendapat kode booking, nomor antrean, dan estimasi waktu dilayani.');
  await glow('.kode', 2400);
  await glow('.info3', 2400);
  await say('Pesan konfirmasi juga dikirim otomatis ke WhatsApp pasien, berisi semua detail tadi.');
  await moveTo('.phone'); await glow('.phone', 2600);
  const code = await page.evaluate(() => S.book.done.id);
  await click('[data-act=gocek]', 1200);
  await say('Di Cek Booking, pasien memantau status: terjadwal, hadir, dipanggil, hingga selesai.');
  await glow('.tl', 2400);
  await say('Dari sini pasien juga bisa mengubah jadwal atau membatalkan sendiri, tanpa perlu menelepon.');
  await glow('.actions', 2400);

  await nav('layar');
  await say('Layar Antrean untuk TV ruang tunggu dan ponsel pasien. Nomor yang sedang dilayani dan berikutnya terlihat jelas.');
  await glow('.tv', 2600);
  await say('Booking online dan pasien yang datang langsung memakai satu urutan nomor, sehingga tidak ada antrean ganda.');
  await nav('keluhan');
  await say('Jika ada keluhan, pasien mengirim masukan dan langsung mendapat nomor tiket.');
  await pickSel('#kk', 'Antrean / waktu tunggu');
  await typeIn('#kn', 'Sari Wulandari');
  await typeIn('#kc', '081234567890');
  await typeIn('#km', 'Antre dokter kandungan terasa lama dan saya tidak tahu sudah sampai nomor berapa.', 40);
  await click('[data-act=kirimk]', 1200);
  const ticket = await page.evaluate(() => S.keluh.ok);
  await glow('.card .note', 2400);
  await say('Tiket ini bisa dilacak kapan saja. Saat ini statusnya masih Baru dan belum ada balasan.');
  await typeIn('#kt', ticket);
  await click('[data-act=lacak]', 1200);
  await glow('.card:nth-child(2)', 2400);

  /* =============== SISI STAF =============== */
  LAB = 'Sisi Staf'; KIND = 'staf';
  await scrollTop();
  await role('staf');
  await say('Sekarang sisi staf pendaftaran. Satu layar menampilkan antrean seluruh poli hari ini.');
  await glow('.grid.g4', 2600);
  await say('Ringkasan di atas: total pasien, yang sudah hadir, yang dilewati, dan yang selesai.');
  await moveTo('.drgrid');
  await say('Setiap dokter punya antrean sendiri. Pasien dipanggil berurutan menurut jam booking, bukan menurut siapa yang tiba lebih dulu.', 5200);
  const card8 = '.drs:has([data-act=calldok][data-v="8"])';
  await glow(card8, 2600);
  await say('Contoh dokter ini punya empat pasien: Ani 09.00, Budi 09.15, Citra 09.30, dan Dewi 09.45. Tetapi Citra dan Dewi tiba lebih dulu. Staf melakukan check-in.', 6500);
  const chk = n => click(`tbody tr:has-text("${n}") [data-act=setst][data-v=Hadir]`, 900);
  await chk('Citra Lestari'); await chk('Dewi Anggraini'); await chk('Ani Wijaya'); await chk('Budi Hartono');
  await say('Staf menekan Panggil berikutnya. Sistem memanggil Ani lebih dulu karena jam bookingnya paling awal, dan WhatsApp panggilan terkirim otomatis.', 6200);
  await click('[data-act=calldok][data-v="8"]', 1500);
  await glow(card8, 2400);
  await say('Ani tidak ada di ruang tunggu. Staf menekan Tidak muncul. Nomornya dilewati, bukan hilang.');
  await click('tbody tr:has-text("Ani Wijaya") [data-act=skip]', 1500);
  await glow('tbody tr:has-text("Ani Wijaya")', 2600);
  await say('Pasien diberi tahu lewat WhatsApp dan masih boleh dipanggil ulang satu kali.');
  await say('Antrean berlanjut ke Budi. Staf memulai pemeriksaan, lalu menyelesaikannya.');
  await click('[data-act=calldok][data-v="8"]', 1300);
  await click('tbody tr:has-text("Budi Hartono") [data-act=setst][data-v=Dilayani]', 1100);
  await click('tbody tr:has-text("Budi Hartono") [data-act=setst][data-v=Selesai]', 1200);
  await say('Jika perlu mendahulukan pasien tertentu, misalnya ibu hamil dengan keluhan, staf boleh memanggilnya, tetapi sistem meminta alasan.', 6000);
  await answer('Ibu hamil tua, kondisi tidak nyaman bila menunggu lama');
  await click('tbody tr:has-text("Dewi Anggraini") [data-act=callrow]', 1500);
  await say('Alasan itu tercatat dan bisa diaudit nanti. Setelah itu Dewi diperiksa seperti biasa.', 4500);
  await click('tbody tr:has-text("Dewi Anggraini") [data-act=setst][data-v=Dilayani]', 1000);
  await click('tbody tr:has-text("Dewi Anggraini") [data-act=setst][data-v=Selesai]', 1200);
  await say('Ani akhirnya tiba. Staf memanggil ulang. Ini kesempatan terakhir sebelum dianggap tidak hadir.');
  await click('tbody tr:has-text("Ani Wijaya") [data-act=setst][data-v=Dipanggil]', 1300);
  await click('tbody tr:has-text("Ani Wijaya") [data-act=setst][data-v=Dilayani]', 1000);
  await click('tbody tr:has-text("Ani Wijaya") [data-act=setst][data-v=Selesai]', 1200);

  const cardLate = `.drs:has([data-act=calldok][data-v="${info.late}"])`;
  await say(`Dokter lain, ${info.lateName.split(',')[0]}, datang terlambat. Staf menekan tombol keterlambatan 30 menit.`, 4800);
  await click(`[data-act=telat][data-id="${info.late}"][data-v="30"]`, 1500);
  await glow(cardLate, 2400);
  await say('Semua pasien dokter ini otomatis diberi tahu lewat WhatsApp, dan estimasi tunggu mereka ikut bergeser.', 4800);
  await say('Pasien yang datang langsung didaftarkan staf, dengan nomor dari urutan yang sama seperti booking online.');
  await typeIn('#wn', 'Pak Hendra');
  await pickSel('#wd', String(info.walk));
  await click('[data-act=walkin]', 1400);

  await snav('wa');
  await say('Semua pesan WhatsApp otomatis tercatat di sini: konfirmasi, panggilan, nomor dilewati, dan dokter terlambat.', 5000);
  await glow('.tbl', 2600);
  await snav('audit');
  await say('Setiap panggilan, pelewatan, dan keterlambatan dokter juga tercatat di Jejak Aktivitas. Ini dasar untuk menelusuri keluhan seperti "nomor saya terlewat".', 6800);
  await glow('.tbl', 2600);
  await snav('bookmasuk');
  await say(`Di Daftar Booking, booking pasien tadi (${code}) sudah masuk, lengkap dengan kanal pendaftaran Web.`, 5000);
  await glow(`tr:has-text("${code}")`, 3000);
  await snav('jadwal');
  await say('Di Kelola Jadwal, staf mengubah hari praktik dokter di satu tempat. Contoh: dokter mulai praktik hari Sabtu.', 5200);
  await click('tr:has-text("dr. Sukoco") input[data-v="6"]', 1200);
  await say('Perubahan langsung dipakai oleh form booking pasien, tanpa perlu mengubah halaman lain.', 4200);
  await click('tr:has-text("dr. Sukoco") input[data-v="6"]', 900);
  await snav('inbox');
  await say(`Keluhan pasien tadi (${ticket}) masuk ke Inbox Keluhan. Staf mengambil tiket, membalas, lalu menutupnya.`, 5200);
  const tk = `.tk:has-text("${ticket}")`;
  await glow(tk, 2200);
  await click(`${tk} [data-act=tkt][data-v=Diproses]`, 1100);
  await answer('Terima kasih, Bu Sari. Kami sudah menambahkan layar nomor antrean dan notifikasi WhatsApp agar posisi antrean mudah dipantau.');
  await click(`${tk} [data-act=reply]`, 1500);
  await sleep(2500);
  await click(`${tk} [data-act=tkt][data-v=Selesai]`, 1200);
  await say('Target respons 1×24 jam dipantau. Tiket yang lewat batas ditandai merah supaya tidak terlupakan.', 4800);

  /* ---- kembali ke pasien ---- */
  LAB = 'Sisi Pasien'; KIND = '';
  await scrollTop();
  await role('pasien');
  await nav('layar');
  await say('Kembali ke sisi pasien. Layar Antrean sekarang memperlihatkan keadaan terbaru, termasuk dokter yang terlambat.', 5200);
  await glow('.tv', 2800);
  await nav('keluhan');
  await typeIn('#kt', ticket);
  await click('[data-act=lacak]', 1300);
  await say('Pasien melihat balasan atas keluhannya, dan statusnya sudah Selesai. Alurnya tuntas dari awal sampai akhir.', 5200);
  await glow('.card:nth-child(2)', 2600);

  /* =============== SISI MANAJEMEN =============== */
  LAB = 'Sisi Manajemen'; KIND = 'mgmt';
  await scrollTop();
  await role('manajemen');
  await say('Sekarang sisi manajemen. Dashboard merangkum layanan tanpa perlu menunggu laporan manual.');
  await glow('.grid.g4', 2800);
  await say('Empat angka utama: jumlah kunjungan, tingkat pasien tidak hadir, rata-rata waktu tunggu, dan keluhan yang masih terbuka.', 5800);
  await moveTo('.cols'); await glow('.cols', 2200);
  await say('Tren booking harian membantu menyiapkan jumlah staf dan dokter sesuai hari sibuk.');
  const wtp = '.card:has(h2:text("Waktu tunggu per poli"))';
  await moveTo(wtp); await glow(wtp, 3000);
  await say('Waktu tunggu per poli menunjukkan di mana antrean paling lama. Angka dashboard ini data contoh.', 4800);
  const tc = '.card:has(h2:text("Keterlambatan dokter"))';
  await moveTo(tc); await glow(tc, 3000);
  await say('Kartu keterlambatan dokter mengungkap penyebab antrean lama yang selama ini tidak tercatat.', 4800);
  await scrollTop();
  await click('[data-act=range][data-v="14"]', 1200);
  await say('Rentang waktu bisa diubah, misalnya ke 14 hari terakhir.');
  await snav('masalah');
  await say('Terakhir, Masalah ke Solusi: temuan dari website dan ulasan Google dipetakan ke fitur yang menjawabnya.', 5200);
  await page.evaluate(() => scrollTo({ top: 520, behavior: 'smooth' })); await sleep(2500);
  await page.evaluate(() => scrollTo({ top: 1100, behavior: 'smooth' })); await sleep(2500);

  /* ---- penutup ---- */
  await scrollTop();
  await say('Ringkasnya: antrean tertib karena nomor tidak ganda, terlihat lewat layar dan WhatsApp, dan terukur lewat dashboard.', 5200);
  await page.evaluate(() => dm.title(`<h1>RSIA Pasutri Bogor</h1><p>Prototipe sistem antrean &amp; booking online</p><ul><li>✓ Tertib: nomor berurutan, tanpa antrean ganda</li><li>✓ Terlihat: Layar Antrean dan notifikasi WhatsApp</li><li>✓ Terukur: dashboard waktu tunggu, no-show, dan keterlambatan</li></ul><div class="pill">Data demo adalah data contoh. Dampak pada waktu tunggu perlu diuji dengan data nyata.</div>`));
  await sleep(7000);
  console.log('SELESAI, langkah:', seq);
} catch (e) {
  console.log('GAGAL pada langkah', seq, e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(OUT, 'gagal.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  const v = page.video();
  await ctx.close();
  if (v) console.log('VIDEO', await v.path());
  await browser.close();
}
