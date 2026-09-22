# Belanja Tak Terduga langsung

Di Pengeluaran, pilih Belanja Tak Terduga beserta sumber dananya, isi nominal,
tanggal, dan catatan. Alokasi manual di Budgeting tidak diperlukan lagi.

- Debit memakai pemasukan dikurangi budget Debit reguler dan penggunaan Belanja Tak Terduga.
- Kartu kredit memakai limit periode kartu tersebut dikurangi budget reguler dan penggunaan Belanja Tak Terduga kartu yang sama.
- Budget sistem selalu mengikuti realisasi. Menghapus transaksi menurunkan keduanya dan mengembalikan dana tersedia.
- Saat suatu periode dibuka, sisa alokasi sistem lama dilepas otomatis. ID budget, transaksi, dan realisasi dipertahankan. Penyesuaian disimpan melalui transaksi Firebase.
- Laporan tetap menampilkan rincian penggunaan untuk evaluasi.

## Memasang pembaruan

1. Buka Firebase Console pada proyek aplikasi, lalu Firestore Database → Rules.
2. Salin seluruh isi `firestore.rules` dari proyek ini dan tekan Publish. Perubahan ini diperlukan untuk membuat budget sistem beserta transaksi pertamanya secara bersamaan.
3. Pasang APK release terbaru pada kedua perangkat sebagai pembaruan aplikasi.
4. Buka periode aktif dan coba satu transaksi Belanja Tak Terduga. Pastikan dana tersedia berkurang sesuai nominal, dan kembali ketika transaksi dihapus.

File rules lokal tidak otomatis terpasang di Firebase ketika APK dibangun.
Pencatatan memerlukan koneksi internet untuk memvalidasi saldo terbaru.

## Catatan implementasi

Semua perubahan data periode dari versi ini memperbarui dokumen periode secara atomik.
Pencatatan langsung membaca dokumen tersebut sebelum menghitung dana dari server;
Firestore mengulang transaksi jika ada perubahan bersamaan. Pengujian unit
menggunakan fixture transaksi dengan optimistic retry; pengujian tersebut bukan
pengujian Firestore Emulator atau dua perangkat fisik.
