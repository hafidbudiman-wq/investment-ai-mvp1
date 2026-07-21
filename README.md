# Investment AI — MVP 1

Fondasi aplikasi analisis investasi untuk menyimpan, memeriksa, dan menampilkan histori laporan keuangan perusahaan Indonesia.

## Fitur awal

- Dashboard KPI dan tren keuangan
- Daftar emiten
- Form input laporan keuangan manual
- Status draft dan approved
- Prisma schema untuk PostgreSQL
- Seed contoh ICBP
- Halaman upload PDF sebagai fondasi ekstraksi berikutnya
- Health check API di `/api/health`

## Menjalankan di laptop

1. Install Node.js 20 atau lebih baru dan Docker Desktop.
2. Salin `.env.example` menjadi `.env`.
3. Jalankan PostgreSQL:

```bash
docker compose up -d
```

4. Install dependency dan siapkan database:

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
```

5. Jalankan aplikasi:

```bash
npm run dev
```

Buka `http://localhost:3000`.

## Deploy Railway

1. Buat project baru dari repository GitHub ini.
2. Tambahkan layanan PostgreSQL.
3. Pastikan variable `DATABASE_URL` tersedia.
4. Build command: `npm run build`
5. Start command: `npm run start`
6. Jalankan migration produksi melalui Railway shell:

```bash
npx prisma migrate deploy
npm run db:seed
```

## Batas MVP 1

Belum mencakup rekomendasi buy/sell, nilai intrinsik, chatbot RAG, maupun ekstraksi PDF otomatis. Fokusnya adalah financial database yang akurat dan bisa diaudit.
