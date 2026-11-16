# Standar Kerja Proyek Rifcazi Budget

## Wajib sebelum merencanakan fitur

Selalu baca root \`PROJECT HANDOFF.md\` sebelum menganalisis atau merencanakan penambahan/perubahan fitur. Cocokkan setiap asumsi dengan implementasi aktif; bila handoff dan kode berbeda, laporkan perbedaannya dan klarifikasi sebelum perubahan berdampak besar.

## Konvensi kode

- Komponen React, screen, provider/context: PascalCase (\`BudgetingScreen.tsx\`, \`BudgetProvider\`). Nama file screen mengikuti nama screen dan dikelompokkan dalam folder fitur.
- Modul utilitas, domain, layanan, constants, dan hook: camelCase; custom hook memakai awalan \`use\` (\`useBudget\`). Tipe/interface memakai PascalCase.
- Pertahankan pemisahan yang ada: UI di \`src/screens\`/\`src/components\`, kalkulasi murni di \`src/domain\`, akses backend di \`src/services\`, state lintas layar di \`src/state\`, tipe di \`src/models\`, format/tanggal di \`src/utils\`.
- Styling memakai \`StyleSheet.create\` dan token yang sudah ada di \`src/constants\` jika sesuai. Ikuti gaya format file terdekat; jangan melakukan format ulang massal.
- Gunakan komponen UI yang sudah ada sebelum membuat pola baru. Pertahankan aksesibilitas dan layout mobile.

## Angka, IDR, tanggal, dan zona waktu

- Nominal uang disimpan dan dihitung sebagai integer rupiah; jangan memakai floating point untuk pecahan rupiah. Pertahankan validasi jumlah positif pada alur yang mensyaratkannya.
- Format rupiah melalui \`formatRupiah\`/utilitas yang sudah tersedia dan locale \`id-ID\`; jangan membuat formatter lokal dengan separator berbeda.
- ID periode selalu \`YYYY-MM\`; tanggal transaksi disimpan sebagai string \`YYYY-MM-DD\`. Validasi melalui utilitas periode yang ada.
- Zona tanggal saat ini mengikuti waktu lokal perangkat. Jangan memperkenalkan UTC/Asia-Jakarta conversion atau mengubah semantik tanggal/periode tanpa persetujuan eksplisit, keputusan domain, dan pengujian khusus zona waktu.

## Guardrails wajib

- DILARANG mengubah skema database/storage yang sudah berjalan: koleksi/path, nama/tipe field, format ID, aturan persistensi, atau menambahkan migrasi. Perlu izin eksplisit pengguna dan rencana kompatibilitas/migrasi terlebih dahulu.
- DILARANG mengubah atau men-deploy Firestore Rules, mengubah project Firebase, atau menjalankan operasi yang mengubah data produksi tanpa izin eksplisit.
- DILARANG mengganti React Navigation, mekanisme React Context untuk state global, atau library inti tanpa izin eksplisit.
- DILARANG melakukan refactoring besar, menghapus perilaku lama, atau mengubah rumus keuangan di luar cakupan yang diminta tanpa izin eksplisit.
- Jangan pernah menyalin/menampilkan/commit password, signing key, token, kredensial Firebase, \`google-services.json\`, atau keystore. Jika ditemukan, hindari menampilkannya dan beri tahu pengguna secara aman.
- Pertahankan perubahan pengguna dan artefak lokal yang tidak terkait. Jangan menghapus APK/berkas lokal tanpa permintaan eksplisit.
- Untuk perubahan kode yang diizinkan, jalankan pemeriksaan relevan (\`npm run typecheck\`, \`npm run lint\`, dan tes terkait) dan laporkan hasil aktual. Jangan memperbaiki error di luar cakupan diam-diam.

