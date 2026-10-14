# Fokus Offline

Aplikasi Pomodoro Android offline-first menggunakan Expo, React Native, TypeScript, SQLite, notifikasi lokal, dan AsyncStorage. Tidak ada backend.

## Persyaratan

- Node.js LTS
- npm
- Android Studio atau perangkat Android dengan Expo Go
- Untuk APK/AAB: akun Expo (EAS Build) atau Android build environment lokal

## Menjalankan aplikasi

```bash
npm install
npx expo install --check
npx expo start
```

Scan QR dengan Expo Go. Untuk notifikasi dan perilaku Android yang mendekati produksi, uji juga pada development build/perangkat fisik. Notifikasi lokal tersedia tanpa backend.

## Type-check

```bash
npm run typecheck
```

## Membuat Android build

Instal EAS CLI dan login:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile preview
```

Tambahkan `eas.json` jika ingin profil build khusus. Untuk distribusi Google Play, gunakan profil production dan hasil `.aab`.

## Perilaku timer

Timer menyimpan waktu akhir sesi (timestamp), bukan mengandalkan interval JavaScript. Saat aplikasi kembali aktif, sisa waktu dihitung ulang. Android dapat menunda notifikasi karena optimasi baterai atau izin notifikasi yang ditolak. Penyelesaian sesi otomatis saat proses aplikasi dihentikan tidak dijamin; notifikasi lokal dijadwalkan sebagai pengingat.

## Penyimpanan

- SQLite: riwayat sesi yang selesai.
- AsyncStorage: pengaturan dan snapshot sesi aktif agar timer dapat dipulihkan.
- Data tersimpan pada perangkat. Menghapus data aplikasi akan menghapus data lokal.

## Musik lofi

Aplikasi mendukung musik latar lofi (5 track) yang bisa diaktifkan/dinonaktifkan dan dipilih di menu Pengaturan, atau lewat ikon not musik di layar timer. Musik berputar (loop) dan tetap berjalan di background.

File audio ada di `assets/music/track1.wav` … `track5.wav`. Secara bawaan ini adalah pad lembut hasil generate (lihat `scripts/gen-music.js`) agar fitur langsung berfungsi. Ganti dengan track lofi asli bernama sama kapan saja. Untuk membuat ulang placeholder:

```bash
node scripts/gen-music.js
```

## Catatan

File ikon notifikasi pada `app.json` opsional untuk konfigurasi plugin. Jika tidak memiliki file tersebut, hapus opsi `icon` dari konfigurasi plugin atau tambahkan aset ikon PNG putih transparan berukuran 96x96.
# pomov-pomodoro
