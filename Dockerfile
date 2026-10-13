# Vectorize Multi-Color Studio — jalan 100% lokal, tanpa server Google.
FROM node:22-slim

WORKDIR /app

# Install dependensi dulu (layer di-cache selama package.json tidak berubah).
# --legacy-peer-deps wajib: tanpa itu npm gagal dengan ERESOLVE (konflik peer esbuild/vite).
COPY package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Salin source lalu build frontend ke /app/dist
COPY . .
RUN npx vite build

# Mode production: server.ts menyajikan /app/dist + endpoint /api/vectorize
ENV NODE_ENV=production
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
