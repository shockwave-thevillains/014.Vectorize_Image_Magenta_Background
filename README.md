# 014 · Vectorize Image — Magenta Background

Batch converter gambar raster ke vektor multi-warna (**SVG + EPS**) untuk microstock. Gambar dengan
background magenta `#FF00FF` (atau putih) otomatis dibuat transparan. Output diskalakan ke ≥ 15 MP.

Mesin utama: [`@visioncortex/vtracer`](https://www.npmjs.com/package/@visioncortex/vtracer) (Rust → WebAssembly)
yang berjalan di server Node.js (`server.ts`). Frontend: React + Vite.

> Aplikasi ini **tidak memanggil Gemini / API eksternal apa pun**. `GEMINI_API_KEY` di `.env.example`
> hanya sisa template Google AI Studio dan tidak dibutuhkan.

---

## Cara menjalankan

### Opsi A — Docker (disarankan)

Syarat: Docker Desktop terpasang & running.

```bash
docker compose up -d --build
```

Buka **http://localhost:3000**.

| Perintah | Fungsi |
|---|---|
| `docker compose up -d` | Menyalakan lagi (tanpa build ulang) |
| `docker compose down` | Menghentikan |
| `docker logs vectorize-studio` | Melihat log bila ada error |

Setelah build pertama, aplikasi berjalan sepenuhnya offline di mesin sendiri.

### Opsi B — Node.js langsung

Syarat: Node.js LTS.

```bash
npm install --legacy-peer-deps
npm run dev
```

Buka **http://localhost:3000**.

> `--legacy-peer-deps` **wajib** — tanpa itu `npm install` gagal dengan `ERESOLVE`
> (konflik peer dependency esbuild/vite).

---

## Kenapa sebaiknya dijalankan lokal, bukan di preview AI Studio

Setiap gambar dikirim dari browser ke server vtracer. Di preview AI Studio, server itu ada di
infrastruktur Google, sehingga setiap gambar menyeberang internet. Dijalankan lokal, "upload" hanya dari
browser ke mesin yang sama → praktis instan.

## Perubahan dari versi awal (AI Studio)

| Perubahan | Dampak |
|---|---|
| Browser mengirim **PNG terkompresi**, bukan piksel RGBA mentah ber-base64 | Payload per gambar turun dari ~30 MB menjadi ~200 KB. Output SVG identik (sudah diverifikasi byte-per-byte). |
| Fallback ke ImageTracer **tidak lagi diam-diam** | Bila server vtracer gagal, item diberi badge merah *"Fallback ImageTracer — proses ulang"* dan muncul toast di akhir batch. |
| Server tidak lagi membuat EPS | EPS selalu dibuat ulang di klien setelah SVG diskalakan; versi server dulu dikirim lalu dibuang. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Menjalankan tanpa perlu memasang Node.js. |

## Catatan pemakaian

- **Upscale** (pilihan `1x / 2x / 4x` di UI): default 4x memperbesar gambar 1024 px ke 2400 px sebelum
  tracing — lebih halus di tepi, tapi ~4–6× lebih berat. Uji A/B di zoom 200% sebelum memilih.
- **Badge merah "Fallback ImageTracer"** = gambar itu tidak diproses vtracer. Proses ulang sebelum submit.
- Biarkan tab browser tetap di depan selama batch berjalan (Chrome memperlambat tab latar belakang).
