# Project Handoff — Rifcazi Budget

## Ringkasan

Aplikasi pencatatan dan perencanaan keuangan keluarga berbasis React Native dan Firebase Authentication/Cloud Firestore. Data transaksi disimpan per household dan per periode `YYYY-MM`; perubahan disinkronkan secara realtime.

## Perilaku penting

- Periode hanya menjadi read-only setelah ditutup secara manual. Jangan mengarsipkan atau menutup periode secara otomatis hanya karena bulan berganti.
- Pembayaran kartu kredit disimpan di `periods/{periodId}/creditPayments`. Pembayaran mengurangi saldo Debit, memulihkan limit kartu, dan ditampilkan sebagai realisasi virtual kategori **Tagihan Rutin** tanpa membuat transaksi pengeluaran ganda.
- Pengeluaran kartu kredit dibatasi oleh tanggal pembayaran. Transaksi sebelum tanggal pembayaran masih dapat dicatat/diedit selama pembayaran terkait belum tercatat; pembatalan pembayaran mengikuti validasi limit dan keterkaitan transaksi.
- Belanja Tak Terduga dapat dicatat langsung dari dana Debit atau Kartu Kredit. Penggunaan BTT masuk ke perhitungan pemakaian sumber dana masing-masing.
- Alokasi Tabungan dicatat sebagai alokasi Debit, tetapi tidak dihitung sebagai pengeluaran rutin.

## Kapasitas kartu kredit

Di kartu ringkasan Budgeting dan Pengeluaran, **Kapasitas Kredit** adalah kapasitas pemakaian sepanjang periode, bukan plafon bank. Perhitungannya memakai saldo limit akhir periode sebelumnya (dihitung dari data yang ada saat ini) ditambah pembayaran kartu kredit yang memulihkan limit pada periode berjalan. Karena data periode sebelumnya disubscribe realtime, transaksi lama yang baru dicatat/diedit ikut memperbarui saldo awal periode berjalan.

Pada tab Kartu Kredit di halaman Pengeluaran, **Sisa Kapasitas Kredit** dihitung sebagai `Kapasitas Kredit - Total Pengeluaran Kredit`. Angka “limit tersedia” di form Belanja Tak Terduga tetap menunjukkan limit aktual yang dapat digunakan saat ini, bukan kapasitas kumulatif.

## Firestore dan rilis

- Perubahan operasi transaksi serta penutupan periode divalidasi oleh `firestore.rules`. Setelah memperbarui aplikasi, tinjau lalu deploy rules ke Firebase project yang benar dengan `firebase deploy --only firestore:rules`.
- `package.json` dan konfigurasi Android saat handoff menunjukkan versi `1.4.3` / `versionCode 10`. Periksa dan samakan nomor versi sebelum membuat APK rilis baru.
- Jangan commit `google-services.json`, keystore, atau rahasia Firebase. APK lokal di root repository adalah artefak rilis dan tidak disertakan dalam commit kode ini.

## Pemeriksaan

Pemeriksaan terakhir untuk perubahan aplikasi: `npm run typecheck`, `npm test -- --runInBand`, dan ESLint pada file yang diubah. Semua 32 tes Jest lulus.
