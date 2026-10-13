import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { convertPixels, convertBuffer } from '@visioncortex/vtracer';
import { convertSvgToEps } from './src/lib/epsConverter';
import { extractColorsFromSvg, filterWhitePathsInSvg, filterMagentaPathsInSvg } from './src/lib/vectorizer';
import { bakeTransformsWithSvgPath } from './src/lib/svgTransformBaker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// High body limits for base64 high-resolution imagery
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: '@visioncortex/vtracer (Rust/WASM)',
    version: '1.0.0-alpha.4',
    multiColorSupported: true,
    transparencySupported: true,
    colorSnappingSupported: true,
  });
});

// High-Fidelity Multi-Color Vectorization Endpoint
app.post('/api/vectorize', async (req, res) => {
  const startTime = Date.now();
  try {
    const { imageBase64, rawRgbaBase64, width, height, config, fileName = 'vector_output' } = req.body;

    if (!imageBase64 && !rawRgbaBase64) {
      return res.status(400).json({ success: false, error: 'Data gambar tidak ditemukan' });
    }

    const cfg = config || {};
    const isMonochrome = cfg.preset === 'monochrome';
    const isPoster = cfg.preset === 'posterized';

    const selectedMode = cfg.curveStyle || cfg.mode || 'polygon';
    const isPolygon = selectedMode === 'polygon';

    const effectiveColorCount = cfg.mergedColorCount || cfg.snappedColorCount || cfg.maxColors || 12;

    const vtracerOptions: any = {
      preset: isMonochrome ? 'bw' : (isPoster ? 'poster' : 'photo'),
      clustering: isMonochrome ? 'bw' : 'color-cluster',
      hierarchical: 'stacked',
      mode: selectedMode,
      colorPrecision: cfg.colorPrecision ?? 8,
      filterSpeckle: cfg.filterSpeckle ?? 12,
      cornerThreshold: cfg.cornerThreshold ?? (isPolygon ? 28 : 55),
      lengthThreshold: cfg.lengthThreshold ?? (isPolygon ? 10 : 4),
      pathPrecision: cfg.pathPrecision ?? 2,
      maxColors: Math.max(2, Math.min(64, effectiveColorCount)),
    };

    if (cfg.lockedPalette && Array.isArray(cfg.lockedPalette) && cfg.lockedPalette.length > 0) {
      vtracerOptions.palette = cfg.lockedPalette;
    } else if (cfg.snappedPalette && Array.isArray(cfg.snappedPalette) && cfg.snappedPalette.length > 0) {
      vtracerOptions.palette = cfg.snappedPalette;
    }

    let rawSvg = '';

    if (rawRgbaBase64 && width && height) {
      const rgbaBuffer = Buffer.from(rawRgbaBase64, 'base64');
      const rgbaArray = new Uint8Array(rgbaBuffer);
      rawSvg = convertPixels(rgbaArray, width, height, vtracerOptions);
    } else {
      const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const imgBuffer = Buffer.from(cleanBase64, 'base64');
      rawSvg = convertBuffer(new Uint8Array(imgBuffer), vtracerOptions);
    }

    if (!rawSvg || !rawSvg.includes('<svg')) {
      throw new Error('Gagal menghasilkan kurva vektor SVG dari gambar.');
    }

    rawSvg = bakeTransformsWithSvgPath(rawSvg);

    const isMagentaMode = (cfg.bgMode ?? 'magenta') === 'magenta';
    const isWhiteMode = cfg.bgMode === 'white';
    const isBgRemoval = cfg.removeBackground !== false;

    if (isMagentaMode && isBgRemoval) {
      rawSvg = filterMagentaPathsInSvg(rawSvg, cfg.magentaTolerance ?? 14);
    } else if (isWhiteMode && cfg.keepInnerWhite === false) {
      rawSvg = filterWhitePathsInSvg(rawSvg, cfg.whiteTolerance ?? 242);
    }

    const w = width || 600;
    const h = height || 600;

    if (!rawSvg.includes('viewBox')) {
      rawSvg = rawSvg.replace('<svg ', `<svg viewBox="0 0 ${w} ${h}" `);
    }
    if (!rawSvg.includes('preserveAspectRatio')) {
      rawSvg = rawSvg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
    }

    rawSvg = rawSvg.replace(/<svg\s+([^>]+)>/i, (match) => {
      let clean = match;
      clean = clean.replace(/\bwidth=["'][^"']+["']/gi, 'width="100%"');
      clean = clean.replace(/\bheight=["'][^"']+["']/gi, 'height="100%"');
      if (!clean.includes('width=')) clean = clean.replace('<svg', '<svg width="100%"');
      if (!clean.includes('height=')) clean = clean.replace('<svg', '<svg height="100%"');
      return clean;
    });

    // PERF: EPS tidak lagi dibuat di server. Klien selalu membuat ulang EPS
    // setelah SVG diskalakan ke target MP, jadi EPS server dulu dikirim lalu dibuang.
    const palette = extractColorsFromSvg(rawSvg);
    const pathMatches = rawSvg.match(/<path\b/gi);
    const pathCount = pathMatches ? pathMatches.length : 0;
    const svgBytes = Buffer.byteLength(rawSvg, 'utf8');
    const processingTimeMs = Date.now() - startTime;

    let qualityScore: 'optimal' | 'good' | 'warning' = 'optimal';
    let qualityMessage = 'Kualitas sangat rapi dan ukuran berkas optimal.';
    if (pathCount > 80 || svgBytes > 150000) {
      qualityScore = 'warning';
      qualityMessage = `Jumlah path agak tinggi (${pathCount} path, ${(svgBytes/1024).toFixed(0)} KB). Disarankan aktifkan Color Snapping atau naikkan Filter Bintik.`;
    } else if (pathCount > 35) {
      qualityScore = 'good';
      qualityMessage = 'Kualitas baik dan detail lengkap.';
    }

    return res.json({
      success: true,
      svgString: rawSvg,
      width: w,
      height: h,
      pathCount,
      colorCount: palette.length || cfg.maxColors || 12,
      palette,
      svgSize: svgBytes,
      processingTimeMs,
      engineUsed: '@visioncortex/vtracer (Rust/WASM)',
      engineVersion: 'v1.0.0-alpha.4',
      activeMode: selectedMode,
      warnings: [],
      rawColorCount: cfg.rawColorCount,
      mergedColorCount: cfg.mergedColorCount || palette.length,
      actualUpscaleFactor: cfg.actualUpscaleFactor,
      hasTransparency: Boolean(cfg.makeWhiteTransparent),
      colorSnappingUsed: Boolean(cfg.colorSnapping !== false),
      qualityScore,
      qualityMessage,
    });
  } catch (err: any) {
    console.error('Vectorizer Server Error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Gagal memproses vektorisasi pada server.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vectorize Multi-Color Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
