# Catalyst — Web App (PWA)

Versi web dari aplikasi Catalyst yang **bisa dipasang (install) seperti aplikasi** dan
**bisa menambah / mengubah / menghapus data**, tersinkron dengan aplikasi Android karena memakai
backend yang sama: Google Apps Script Web App + Spreadsheet.

Tidak ada server sendiri. Semua data diambil & dikirim langsung ke URL Apps Script kamu.
Tampilannya memakai tema "Candy Pastel" yang sama dengan aplikasi HP (terang / gelap / otomatis).

## Cara pakai

1. Buka web-nya (mis. URL hosting statis kamu, atau jalankan lokal).
2. Hubungkan dengan salah satu cara:
   - **File** — pakai file `catalyst-config-*.json` yang diekspor dari aplikasi
     (Pengaturan → Backup & Pindah → Bagikan). Paling mudah.
   - **Tempel** — salin isi file config lalu tempel.
   - **Manual** — isi URL Web App + Webhook Secret sendiri.
3. Pasang ke perangkat:
   - **Android / Chrome / Edge**: tombol **Pasang** di Home atau Pengaturan, atau menu ⋮ → *Instal aplikasi*.
   - **iPhone / iPad (Safari)**: tombol Bagikan → *Tambahkan ke Layar Utama*.

## Fitur

| Halaman | Isi |
|---|---|
| Home | Saldo total & per akun, pemasukan/pengeluaran bulan ini, transaksi bulan ini + cari & filter |
| Riwayat | Semua transaksi per bulan (dikelompokkan per hari), cari & filter, download laporan PDF/CSV |
| Statistik | Arus kas harian/mingguan/bulanan, pengeluaran per kategori, merchant teratas, dibanding bulan lalu |
| Money | Budget bulanan (+ salin dari bulan lalu), goal tabungan (+ tombol Tabung), transaksi berulang |
| Pengaturan | Tema, sembunyikan saldo, pasang aplikasi, notifikasi Telegram, laporan, putuskan koneksi |

### Tampilan PC / Windows (layar ≥ 1024 px)

- **Sidebar kiri** menggantikan navigasi bawah, dengan menu Riwayat sendiri dan tombol *Catat cepat*.
- Isi **memenuhi layar**: Home punya hero lebar, kartu akun dalam grid, dan panel ringkasan
  (bulan ini, budget, goal, jadwal berikutnya) di samping daftar transaksi.
- **Riwayat dalam bentuk tabel** (jam, keterangan, kategori, akun, jumlah), dikelompokkan per hari.
- Statistik dengan grafik lebih besar, Money 3 kolom di layar ≥ 1440 px, Pengaturan 2 kolom.
- Form transaksi dua kolom di dialog lebar.
- **Layar penuh**: tombol di sidebar / Pengaturan, atau tekan <kbd>F</kbd> (<kbd>Esc</kbd> untuk keluar).
- **Pintasan keyboard**: <kbd>N</kbd> catat, <kbd>/</kbd> cari, <kbd>R</kbd> sinkron,
  <kbd>1</kbd>–<kbd>5</kbd> pindah halaman, <kbd>Enter</kbd> buka baris tabel yang dipilih.
- Di HP tampilannya tetap seperti aplikasi (navigasi bawah).

Tombol **+** di tengah: catat pengeluaran, catat pemasukan, atau pindah saldo antar akun.
Ketuk transaksi untuk mengubah atau menghapusnya (transfer diubah/dihapus sepasang).

Shortcut ikon (tekan lama ikon aplikasi di Android): *Catat Pengeluaran*, *Catat Pemasukan*, *Pindah Saldo*.

### Yang sengaja tidak ada di web

Scan struk & bukti transfer (kamera/screenshot + Gemini), scan & tampilkan QR, kunci PIN/biometrik,
pengingat harian, notifikasi pencatatan berhasil, backup Google Drive, dan pengaturan bot Telegram.
Semua itu tetap di aplikasi HP.

## Cara sinkron bekerja

- Validasi mengikuti aplikasi: jumlah harus > 0, pengeluaran & transfer tidak boleh melebihi saldo
  akun, budget unik per kategori + bulan, deadline goal tidak boleh lewat.
- Transaksi dari web tercatat dengan `sumber = "web"`. ID dibuat di browser, jadi menekan **Simpan**
  lagi setelah gagal tidak membuat data dobel.
- **Transaksi berulang & auto-debit goal tetap dijalankan oleh aplikasi HP** (supaya tidak dobel).
  Web hanya mengatur jadwalnya. Mengubah jadwal yang sudah ada: hapus lalu buat jadwal baru.
- **Tabung** ke goal = pindah saldo dari akun sumber ke akun `Tabungan <nama goal>`, sama seperti di aplikasi.
- Notifikasi Telegram untuk transaksi baru: memakai bot dari file config (kalau ada token & chat id),
  atau bot yang sudah didaftarkan di Apps Script. Bisa dimatikan di Pengaturan.
- Peringatan budget 80%/100% dan milestone goal hanya dikirim dari aplikasi HP.
- Agar **hapus dari web juga hilang di HP**, pakai aplikasi Android versi terbaru (sinkronisasi
  sekarang ikut menghapus transaksi & jadwal berulang yang sudah tidak ada di Sheet).
- Offline: web tetap bisa dibuka dan menampilkan data terakhir, tapi menyimpan perubahan butuh internet.

## Catatan teknis

- Request memakai `Content-Type: text/plain` agar tidak memicu CORS preflight
  (Apps Script tidak menangani OPTIONS).
- Backend (`apps-script/Code.gs`) harus versi yang punya action `dashboardData`/`list`, `save`, `update`,
  `delete`, `transfer`, `budget*`, `goal*`, `recurring*`. Tidak perlu deploy ulang Apps Script untuk web ini.
- File PWA: `manifest.webmanifest`, `sw.js` (service worker), dan ikon di `icons/`.
  Service worker hanya meng-cache file aplikasi & library CDN, **tidak pernah** meng-cache data dari Apps Script.
- Setiap kali mengubah file web, naikkan `CACHE_VERSION` di `sw.js` supaya cache lama dibersihkan.
- Install butuh HTTPS (atau `localhost` saat uji coba).

## Hosting

Cukup file statis, bisa di-host gratis di:
- **Vercel / Netlify / Cloudflare Pages**: deploy folder ini (tanpa build step).
- **GitHub Pages**: push folder ini ke repo, aktifkan Pages.
- **Lokal**: jalankan server statis, mis. `npx serve .`, lalu buka `http://localhost:3000`.
  (Membuka `index.html` langsung lewat `file://` tetap jalan, tapi tidak bisa di-install.)

## Keamanan & keterbatasan

Penting untuk dipahami sebelum meng-host web ini secara publik:

- **Secret = akses penuh.** `WEBHOOK_SECRET` adalah secret yang sama dengan aplikasi Android dan memberi
  akses **baca sekaligus tulis** ke backend. Siapa pun yang memegang URL + secret bisa mengubah datamu.
- **Tersimpan apa adanya di browser.** URL, secret, (kalau ada) token bot Telegram dari file config, dan
  salinan data terakhir disimpan di `localStorage`. Jangan hubungkan di perangkat bersama / yang tidak
  kamu percaya. Tombol **Putuskan koneksi** menghapus semuanya dari browser tersebut.
- **Risiko hosting publik.** Kalau situs terkena XSS, isi `localStorage` bisa terbaca. Semua teks dari
  data di-escape sebelum ditampilkan, tapi tetap hindari memasang script pihak ketiga tambahan.
- **Saran:** kalau secret pernah bocor, ganti lewat aplikasi (Pengaturan → rotasi secret).
