# Catat Keuangan — Dashboard Web

Dashboard web read-only yang **tersinkron dengan aplikasi Android** karena memakai
backend yang sama: Google Apps Script Web App + Spreadsheet.

Tidak ada server sendiri. Semua data diambil langsung dari URL Apps Script kamu.
Config (URL + Secret) hanya disimpan di `localStorage` browser.

## Cara pakai

1. Buka `index.html` di browser (klik dua kali, atau host di mana saja — lihat di bawah).
2. Hubungkan dengan salah satu cara:
   - **Impor File JSON** — pakai file `catat-keuangan-config-*.json` yang diekspor dari
     aplikasi (Pengaturan → Backup & Pindah → Bagikan). Ini cara paling mudah & otomatis sinkron.
   - **Tempel JSON** — salin isi file config lalu tempel.
   - **Manual** — isi URL Web App + Webhook Secret sendiri.
3. Dashboard akan menampilkan saldo, arus kas (harian/mingguan/bulanan), kategori,
   budget, goal, transaksi berulang, dan riwayat transaksi — semua dari data yang sama
   dengan aplikasi.

## Fitur

- KPI: saldo total, pemasukan/pengeluaran/jumlah transaksi bulan ini
- Saldo per akun
- Grafik arus kas (Harian / Mingguan / Bulanan) + navigasi bulan
- Pengeluaran per kategori (donut)
- Progress Budget & Goal
- Daftar transaksi berulang aktif
- Tabel riwayat + pencarian + filter (tipe & akun)
- Sembunyikan saldo (toggle mata)

## Catatan teknis

- Request memakai `Content-Type: text/plain` agar tidak memicu CORS preflight
  (Apps Script tidak menangani OPTIONS). Apps Script Web App membalas dengan respons
  yang bisa dibaca lintas-origin untuk request sederhana ini.
- Dashboard ini **read-only** (hanya menampilkan). Untuk menambah/ubah transaksi,
  tetap lewat aplikasi Android.
- Backend (`apps-script/Code.gs`) harus sudah versi terbaru yang punya action
  `list`, `budgetList`, `goalList`, `recurringList`. Kalau backend lama, bagian
  budget/goal/recurring akan kosong tapi transaksi & saldo tetap tampil.

## Hosting (opsional)

Cukup file statis, bisa di-host gratis di:
- **GitHub Pages**: push folder ini ke repo, aktifkan Pages.
- **Netlify / Vercel / Cloudflare Pages**: drag & drop folder.
- **Lokal**: buka langsung `index.html`, atau jalankan server statis:
  ```
  npx serve .
  ```

Karena hanya butuh URL + Secret untuk connect, dashboard yang di-host bisa dipakai
di HP/laptop mana pun selama punya file config-nya.
