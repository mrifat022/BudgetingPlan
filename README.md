# Budgeting Plan

Aplikasi perencanaan keuangan keluarga berbasis React Native. Fokus utamanya adalah alur bulanan:

`Pemasukan → Budgeting → Realisasi → Laporan`

Data disimpan per `household` dan tersinkron realtime melalui Cloud Firestore, sehingga dua akun di dua perangkat Android melihat perubahan yang sama.

## Status MVP

- Login privat menggunakan Firebase Authentication (email/password dengan UI username).
- Household dua pengguna dan audit `createdBy` / `updatedBy`.
- Periode bulanan otomatis dengan arsip periode lama.
- Master kategori pemasukan, kategori budgeting, dan sumber dana.
- Pemasukan per periode.
- Budgeting per kategori, sumber dana, transaksi, dan alokasi cash.
- Realisasi bertahap yang wajib terhubung ke budget.
- Validasi atomik agar dua perangkat tidak dapat melewati sisa budget.
- Laporan per kategori, per sumber dana, detail item, dan belum terealisasi.
- Salin budget bulan sebelumnya.

Rancangan lengkap, user flow, wireframe, model, dan tahapan implementasi ada di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Menjalankan proyek

Persyaratan lokal mengikuti React Native 0.86: Node.js 22+, JDK 17, Android Studio/SDK, dan perangkat atau emulator Android.

```bash
npm install
npm run typecheck
npm test -- --runInBand
```

### 1. Siapkan Firebase

1. Buat Firebase project.
2. Tambahkan Android app dengan package `com.keuangankeluarga`.
3. Unduh `google-services.json` ke `android/app/google-services.json` (file ini diabaikan Git).
4. Aktifkan Authentication → Email/Password.
5. Buat Cloud Firestore.
6. Deploy rules:

```bash
firebase use <project-id>
firebase deploy --only firestore
```

Setelah mengaktifkan riwayat aktivitas, deploy ulang `firestore.rules` sebelum mencoba menyimpan data dari APK. Log disimpan di `households/{householdId}/activities` bersama transaksi data dan ditampilkan hanya untuk periode aktif; saat bulan berganti, daftar aktivitas dimulai dari kosong tanpa menghapus riwayat bulan sebelumnya. Tanpa aturan terbaru, Firestore akan menolak penyimpanan.

### 2. Buat dua akun privat

Karena tidak ada registrasi publik, buat akun dari Firebase Console → Authentication. Agar pengguna dapat masuk dengan username `andi`, gunakan email alias `andi@budgeting-plan.local`. Email asli juga tetap bisa dipakai langsung di field Username.

Catat UID kedua akun, misalnya `UID_A` dan `UID_B`.

### 3. Hubungkan akun ke household

Buat dokumen berikut sekali saja melalui Firestore Console:

```text
households/keluarga-utama
  name: "Keluarga Utama"
  ownerId: "UID_A"

households/keluarga-utama/members/UID_A
  displayName: "Andi"
  role: "owner"

households/keluarga-utama/members/UID_B
  displayName: "Sari"
  role: "member"

users/UID_A
  username: "andi"
  displayName: "Andi"
  householdId: "keluarga-utama"
  role: "owner"
  active: true

users/UID_B
  username: "sari"
  displayName: "Sari"
  householdId: "keluarga-utama"
  role: "member"
  active: true
```

Saat login pertama, aplikasi membuat periode bulan berjalan serta master default secara otomatis.

Pada awal setiap periode, buka halaman **Budgeting** dan isi limit tersedia untuk setiap
sumber dana berjenis Kartu Kredit. Limit disimpan di
`households/{householdId}/periods/{YYYY-MM}/creditLimits/{fundSourceId}`, sehingga sisa limit
bulan sebelumnya tidak dianggap sebagai saldo dan tidak ikut terbawa ke bulan baru.

### 4. Jalankan Android

```bash
npm run android
```

Tanpa `google-services.json`, proyek tetap dapat dikompilasi untuk pemeriksaan kode, tetapi aplikasi akan menampilkan instruksi konfigurasi Firebase pada Login.

## Membuat APK

Debug APK:

```bash
cd android
./gradlew assembleDebug
```

Hasil: `android/app/build/outputs/apk/debug/app-debug.apk`.

Release produksi memerlukan keystore pribadi. Jangan gunakan debug keystore untuk distribusi:

1. Buat/upload keystore dan simpan kredensial di `~/.gradle/gradle.properties` atau CI secret.
2. Tambahkan signing config release di `android/app/build.gradle`.
3. Jalankan `npm run android:apk`.
4. Ambil `android/app/build/outputs/apk/release/app-release.apk`.

## Catatan keamanan

- Rules hanya memberi akses household kepada UID yang memiliki dokumen member.
- `users` tidak dapat diubah dari aplikasi.
- Master dihapus secara soft-delete (`active: false`) supaya laporan lama tetap utuh.
- Nilai nama kategori dan sumber dana disalin ke transaksi sebagai snapshot agar rename master tidak mengubah histori.
- Pengeluaran dibuat dengan Firestore transaction bersama pembaruan `realizedAmount` budget.
