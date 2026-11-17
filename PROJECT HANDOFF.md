# PROJECT HANDOFF — Rifcazi Budget

Dokumen ini adalah handoff teknis kanonis untuk melanjutkan proyek. Kondisi yang dicatat berdasarkan audit codebase pada 16 November 2026. Untuk perilaku aktual, prioritaskan kode aktif dan verifikasi ulang sebelum mengubahnya; sebagian dokumen lama masih mencerminkan rancangan/perilaku terdahulu.

## 1. Ringkasan Arsitektur Aktif

### Tech stack dan konfigurasi

- Aplikasi mobile React Native CLI bare, bukan proyek Expo.
- React Native \`0.86.2\`, React \`19.2.3\`, TypeScript \`5.8.3\`, Node.js minimal \`22.11.0\`.
- Navigasi React Navigation \`7.x\` (bottom tabs dan native stack).
- Firebase melalui React Native Firebase \`26.3.2\`: Authentication dan Cloud Firestore.
- Babel menggunakan \`module:@react-native/babel-preset\`; Metro memakai konfigurasi default \`@react-native/metro-config\`.
- Android package/application ID \`com.keuangankeluarga\`; Android saat ini \`versionName 1.4.3\`, \`versionCode 10\`. Catatan versi aplikasi di \`src/constants/app.ts\` (\`1.4.1\`, build \`4\`) tidak sinkron dan perlu diselaraskan saat pekerjaan versi berikutnya.
- \`app.json\` hanya mendefinisikan nama aplikasi; tidak ada konfigurasi Expo.
- Audit source tidak menemukan pemakaian \`process.env\`, \`import.meta.env\`, \`EXPO_PUBLIC_*\`, atau \`REACT_APP_*\`. \`.env.example\` karena itu tidak mendefinisikan variabel aplikasi saat ini. Properti signing Gradle bukan variabel runtime aplikasi.

### Struktur folder aktif

\`\`\`text
App.tsx                       entry point dan provider root
src/
  assets/branding/            aset logo/splash
  components/                 header, input, tombol, komponen keuangan/form
  constants/                  versi, warna, spacing, typography
  domain/                     aturan kalkulasi keuangan dan unit tests
  models/                     tipe/model domain dan data Firestore
  navigation/                 root stack dan bottom tabs
  screens/                    layar per fitur
  services/firebase.ts        Firebase Auth/Firestore dan operasi data
  state/                      AuthContext dan BudgetContext
  utils/                      format mata uang dan periode/tanggal
android/, ios/                proyek native
docs/                         dokumentasi dan rancangan lama
\`\`\`

### Screen dan alur navigasi

- \`App.tsx\` membungkus aplikasi dengan \`GestureHandlerRootView\`, \`SafeAreaProvider\`, dan \`AuthProvider\`.
- \`RootNavigator\` menampilkan loading, lalu \`LoginScreen\` jika belum ada profil aktif. Setelah autentikasi, \`BudgetProvider\` membungkus stack berisi \`MainTab\` dan \`Settings\`.
- Bottom tabs saat ini: \`DashboardScreen\` (label Home), \`PemasukanScreen\`, \`BudgetingScreen\`, \`PengeluaranScreen\`, \`HutangPiutangScreen\` (label Hutang), dan \`LaporanScreen\`.
- \`SettingsScreen\` dibuka dari header sebagai screen stack di luar tab.
- Screen yang ada: Login (termasuk reset password), Dashboard (ringkasan/checklist/aktivitas/tutup periode), Pemasukan (income dan pembayaran/pengaturan limit kartu), Budgeting (anggaran/alokasi), Pengeluaran (transaksi), Hutang & Piutang (manajemen hutang sekali bayar/cicilan dan piutang), Laporan, dan Pengaturan (anggota serta master kategori/sumber dana).

Alur ringkas: aplikasi memulihkan sesi Firebase Auth → memuat profil dan household → memastikan periode berjalan/master awal tersedia → berlangganan realtime pada master, daftar periode, data periode terpilih, dan data periode sebelumnya → layar memakai state konteks untuk menampilkan serta memutakhirkan data.

## 2. Skema Data & State Management

### Struktur penyimpanan Firestore

\`\`\`text
users/{uid}
households/{householdId}
  members/{uid}
  activities/{activityId}
  incomeCategories/{categoryId}
  budgetCategories/{categoryId}
  fundSources/{fundSourceId}
  debts/{debtId}
  receivables/{receivableId}
  periods/{YYYY-MM}
    incomes/{incomeId}
    budgets/{budgetId}
    expenses/{expenseId}
    creditLimits/{fundSourceId}
    creditPayments/{paymentId}
\`\`\`

Firestore adalah penyimpanan persisten utama; tidak ditemukan database lokal/SQLite/AsyncStorage untuk transaksi. Jangan anggap dokumen master atau periode dapat diubah skemanya tanpa proses migrasi dan izin eksplisit.

### Model transaksi dan keuangan

- Model TypeScript ada di \`src/models/index.ts\`; operasi baca/tulis dan listener ada di \`src/services/firebase.ts\`.
- Master: household/member, kategori pemasukan, kategori budget, dan sumber dana (\`debit\`, \`credit_card\`, \`cash\`, \`other\`). Master memakai status aktif dan metadata audit.
- Periode memakai ID \`YYYY-MM\` dan status \`active\`, \`closed\`, atau \`archived\`. Periode ditutup manual; status closed membuat data hanya-baca pada UI/operasi yang menerapkan penjagaan periode.
- \`incomes\` menyimpan kategori, nominal, tanggal \`YYYY-MM-DD\`, dan catatan.
- \`budgets\` menyimpan sumber dana, kategori, nominal, realisasi, jenis realisasi (\`transaction\`, \`cash_allocation\`, \`savings_allocation\`) dan status cash/alokasi tabungan.
- \`expenses\` menyimpan referensi/snapshot budget dan sumber dana, nominal, tanggal dan catatan. Field opsional \`creditSettled\`/\`creditSettlementId\` mendukung penandaan penyelesaian transaksi kredit.
- \`creditLimits\` menyimpan plafon serta nilai tersedia/pembukaan limit; \`creditPayments\` menyimpan pembayaran tagihan dan metadata nilai limit sebelumnya untuk pemulihan/pembatalan yang divalidasi.
- Audit umum memakai \`createdBy\`, \`createdAt\`, \`updatedBy\`, \`updatedAt\`. Nominal uang disimpan sebagai angka rupiah bulat (bukan pecahan sen).
- Pembayaran kartu kredit juga ditampilkan sebagai realisasi virtual kategori Tagihan Rutin di Budgeting. Ini bukan dokumen budget atau expense kedua, untuk menghindari penghitungan ganda.
- Koleksi `debts` dan `receivables` tersimpan di bawah `households/{householdId}`:
  - Hutang: pinjaman dana (`cash_loan`) otomatis mencatat pemasukan kategori `Hutang`, sedangkan jadwal termin otomatis membuat budget kategori `Tagihan Rutin` pada masing-masing periode termin (`debtId`, `debtInstallmentIndex`, `debtTotalInstallments`). Realisasi pengeluaran pada budget terkait menyinkronkan status termin (`paid`/`unpaid`) dan status hutang. Percepatan pelunasan (`accelerateDebtPayoff`) menggabungkan sisa tagihan ke termin aktif dan menghapus budget bulan berikutnya. Salin budget dari bulan sebelumnya mengecualikan budget hutang agar tidak terduplikasi.
  - Piutang: pinjaman keluar pada periode berjalan mengurangi `availableDebit` (`totalReceivablesOut`), dan pencatatan pembayaran piutang (`recordReceivablePayment`) otomatis membuat dokumen `Income` kategori `Piutang` pada periode penerimaan untuk memulihkan saldo Debit.

### State global

- \`AuthContext\` (\`src/state/AuthContext.tsx\`): user Firebase, profil household, status loading/error, sign-in dan sign-out.
- \`BudgetContext\` (\`src/state/BudgetContext.tsx\`): household/UID/peran, daftar dan periode terpilih, status read-only, master kategori/sumber dana, data realtime `debts` & `receivables`, \`PeriodData\` periode berjalan dan sebelumnya, status loading/error, serta waktu sinkronisasi terakhir.
- Tidak ada Redux/Zustand/MobX terpasang; state global utama menggunakan React Context. Kalkulasi sebaiknya memakai fungsi domain di \`src/domain/\`, tidak menyisipkan perubahan skema atau logika finansial baru di komponen.

### Aturan bisnis penting saat audit

- Kapasitas Kredit pada ringkasan Budgeting/Pengeluaran menghitung kapasitas periode dari sisa limit periode sebelumnya yang dihitung dari data terbaru ditambah pemulihan limit dari pembayaran periode berjalan.
- Kartu Pengeluaran menghitung sisa kapasitas sebagai kapasitas kredit dikurangi total pengeluaran kredit. Limit aktual yang dapat dipakai pada form transaksi tetap perhitungan tersendiri.
- Pengeluaran Belanja Tak Terduga memakai sumber dana Debit atau Kartu Kredit dan ikut mengurangi pemakaian/budget sumber terkait.
- Pembayaran kartu kredit mengurangi dana Debit dan memulihkan limit; transaksi kredit yang tercakup sampai tanggal pembayaran ditandai agar tidak dihitung dua kali. Perubahan transaksi lama dapat memengaruhi perhitungan periode berikut secara realtime karena data periode sebelumnya ikut disubscribe.
- Alokasi cash dan tabungan memiliki perlakuan berbeda dari transaksi pengeluaran biasa; jaga aturan domain dan tes yang ada.

## 3. Fitur yang Sudah Selesai & Berjalan Normal

Inventaris berdasarkan alur implementasi dan kode yang tersedia (bukan klaim bahwa setiap konfigurasi produksi sudah diverifikasi ulang):

- Login Firebase email/password dengan input username/email dan permintaan reset password.
- Household bersama, role owner/member, profil dan sinkronisasi realtime.
- Periode bulanan, perpindahan periode, penutupan manual, dan pembacaan periode sebelumnya.
- Master kategori pemasukan, kategori budgeting, dan sumber dana.
- Pencatatan pemasukan, budgeting menurut sumber dana, alokasi cash/tabungan, dan realisasi pengeluaran.
- Pengeluaran Debit/Kartu Kredit, termasuk Belanja Tak Terduga, pencarian/filter, dan alur edit/hapus sesuai validasi bisnis.
- Pengaturan limit, pembayaran dan pembatalan pembayaran kartu kredit dengan validasi terkait transaksi.
- Dashboard dan checklist bulanan, laporan ringkasan/tren/alokasi, pengaturan household/master.
- Menu Hutang & Piutang (\`HutangPiutangScreen\`) sebagai bottom tab ke-6: manajemen hutang (sekali bayar/cicilan, jadwal termin, percepatan pelunasan, penyesuaian nominal termin) dan piutang (pencatatan pinjaman, penerimaan cicil/lunas yang otomatis masuk pemasukan).
- Verifikasi fitur Hutang & Piutang pada 17 November 2026: \`npm run typecheck\`, \`npm run lint\`, dan \`npm test -- --runInBand\` lolos; 6 test suites dan 44 tes berhasil. Ini memverifikasi kode lokal, bukan deployment Firebase atau pengujian emulator.
- Perhitungan finansial dipisah ke domain module dan memiliki tes unit/service.
- Aturan keamanan Firestore di \`firestore.rules\` mencakup izin baca/tulis koleksi \`debts\` dan \`receivables\` berbasis member household. Pastikan aturan yang diperbarui di-publish ke Firebase Console (\`firebase deploy --only firestore:rules\` atau unggah manual) sebelum rilis.
- APK Android release dibuat lewat Gradle; konfigurasi Firebase Android memakai \`android/app/google-services.json\`.

## 4. Known Issues / Technical Debt

1. **Risiko kredensial signing release (prioritas keamanan tinggi).** Audit menemukan nilai rahasia signing release literal pada \`android/gradle.properties\` yang terlacak Git. Nilainya sengaja tidak disalin ke dokumen. Perlakukan kredensial sebagai terekspos: lakukan rotasi sesuai prosedur keystore, lalu pindahkan rahasia ke konfigurasi lokal yang di-ignore atau secret CI. Jangan menghapus/mengganti konfigurasi signing tanpa rencana rilis dan izin yang sesuai.
2. **Nomor versi tidak sinkron.** \`package.json\` dan Android Gradle menunjukkan 1.4.3/build 10, sedangkan \`src/constants/app.ts\` menunjukkan 1.4.1/build 4. Tentukan sumber versi yang benar sebelum rilis berikutnya.
3. **Dokumentasi lama tidak seluruhnya sejalan dengan implementasi.** \`README.md\` dan \`docs/ARCHITECTURE.md\` memuat beberapa status/alur historis (misalnya arsip periode otomatis); handoff ini merangkum perilaku aktual yang ditemukan dan harus dijadikan titik awal audit.
4. **Zona waktu.** \`src/utils/period.ts\` memakai waktu lokal perangkat untuk membentuk periode dan tanggal. Belum ada normalisasi zona waktu backend ke Asia/Jakarta; perangkat dengan zona berbeda berpotensi memilih tanggal/periode berbeda. Jangan mengubah perilaku diam-diam—butuh keputusan bisnis dan tes lintas zona.
5. **Validasi lingkungan.** Kode Firebase memerlukan konfigurasi native yang benar. Typecheck/lint/test tidak memverifikasi Firebase project, Firestore Rules deployment, signing release, perangkat Android, ataupun iOS.
6. **Cakupan tes.** Ada unit tests domain/service/utilitas, tetapi audit ini tidak menemukan rangkaian E2E atau verifikasi rules lewat Firebase Emulator Suite.
7. **Artefak rilis lokal.** APK versi 1.3.0–1.4.4 ada sebagai file untracked di root saat audit; pertahankan sebagai artefak lokal dan jangan masukkan ke commit dokumentasi.

## Cara Menjalankan & Build

### Prasyarat

- Node.js \`>=22.11.0\` (lihat \`package.json\`).
- Android: JDK 17, Android Studio/SDK, emulator atau perangkat USB dengan debugging aktif. Ikuti juga persyaratan resmi React Native 0.86 untuk host platform.
- Konfigurasi Firebase Android: \`android/app/google-services.json\` dari Firebase project yang benar. File ini tidak boleh di-commit.
- Berkas release harus ditandatangani keystore produksi. Rahasia signing yang saat ini ada di file Gradle terlacak adalah isu keamanan; bereskan sebelum rilis baru.

### Instalasi dan development

\`\`\`bash
npm ci
npm run typecheck
npm test -- --runInBand
npm start
\`\`\`

Jalankan emulator Android dari Android Studio (atau hubungkan perangkat), biarkan Metro aktif di terminal, lalu dari terminal lain:

\`\`\`bash
npm run android
\`\`\`

### Build APK release

\`\`\`bash
npm run android:apk
\`\`\`

Script tersebut menjalankan \`./gradlew assembleRelease\` dari folder \`android/\`. Output default: \`android/app/build/outputs/apk/release/app-release.apk\`. Nama file tidak otomatis mengikuti nama produk/versi; bila perlu nama versi, salin/rename artefak secara terpisah setelah build dan pastikan nomor versi Android sudah dinaikkan. Jangan commit APK.

### Environment variables

Audit tidak menemukan variabel environment untuk runtime/build JavaScript saat ini. \`.env.example\` mencatat keadaan tersebut; jangan menaruh service key, password, atau nilai rahasia di sana. Konfigurasi \`google-services.json\` dan signing Gradle adalah mekanisme terpisah.

## Histori / catatan handoff sebelumnya

Bagian ini mengarsipkan isi handoff lama agar catatan perubahan terdahulu tetap terbaca. Jika isinya bertentangan dengan bagian arsitektur aktif, gunakan bagian aktif di atas dan periksa kode.

### Salinan catatan \`docs/PROJECT_HANDOFF.md\` sebelum audit (16 November 2026)

- Aplikasi pencatatan dan perencanaan keuangan keluarga berbasis React Native dan Firebase Authentication/Cloud Firestore. Data transaksi per household dan periode \`YYYY-MM\`, tersinkron realtime.
- Periode hanya read-only setelah ditutup manual; jangan tutup/arsipkan otomatis saat bulan berganti.
- Pembayaran kartu kredit tersimpan di \`periods/{periodId}/creditPayments\`; mengurangi Debit, memulihkan limit dan tampil virtual sebagai Tagihan Rutin tanpa dokumen pengeluaran duplikat.
- Pengeluaran kartu kredit sebelum tanggal pembayaran bisa dicatat/diedit selama pembayaran terkait belum tercatat; pembatalan mengikuti validasi limit/keterkaitan transaksi.
- Belanja Tak Terduga dapat menggunakan Debit atau Kartu Kredit. Alokasi Tabungan mengurangi saldo Debit belum dialokasikan tetapi bukan pengeluaran rutin.
- Kapasitas Kredit Budgeting/Pengeluaran berasal dari saldo akhir limit periode sebelumnya (dihitung dari data terkini) ditambah pembayaran periode berjalan; subscribe periode sebelumnya membuat data terlambat memperbarui kapasitas.
- Di tab Kartu Kredit Pengeluaran, Sisa Kapasitas = Kapasitas Kredit dikurangi Total Pengeluaran Kredit; form Belanja Tak Terduga menampilkan limit aktual yang tersedia.
- Deploy Rules harus menggunakan Firebase project yang benar; contoh perintah lama \`firebase deploy --only firestore:rules\`.
- Pemeriksaan pada handoff terdahulu melaporkan \`npm run typecheck\`, \`npm test -- --runInBand\`, dan ESLint pada file yang diubah lolos dengan 32 tes. Ini adalah catatan historis, bukan hasil pemeriksaan audit dokumen ini.
