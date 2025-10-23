import { env, InferenceSession, Tensor, LogLevel } from 'onnxruntime-web';

// ЛОКАЛЬНЫЕ wasm-файлы (скопируй их в public/ort)
env.wasm.wasmPaths = '/ort/';
env.wasm.simd = true;
env.wasm.proxy = false;
env.logLevel = 'warning'; // можно 'verbose' для отладки

let session = null;
let downsample = 0.25;
let r1 = null, r2 = null, r3 = null, r4 = null;

function imageBitmapToTensor(bitmap) {
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2d context');

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  const tensorData = new Float32Array(1 * 3 * height * width);

  let rOffset = 0;
  let gOffset = height * width;
  let bOffset = 2 * height * width;

  for (let i = 0; i < height * width; i++) {
    const p = i * 4;
    tensorData[rOffset++] = pixels[p] / 255.0;
    tensorData[gOffset++] = pixels[p + 1] / 255.0;
    tensorData[bOffset++] = pixels[p + 2] / 255.0;
  }
  return new Tensor('float32', tensorData, [1, 3, height, width]);
}

self.onmessage = async (e) => {
  const msg = e.data;

  try {
    if (msg.type === 'init') {
      const wantThreads = msg.threads ?? Math.min(4, self.navigator?.hardwareConcurrency || 2);
      env.wasm.numThreads = (self.crossOriginIsolated ? wantThreads : 1);

      try {
        // Явный префетч с проверкой
        const resp = await fetch(msg.modelUrl, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const buf = await resp.arrayBuffer();
        if (buf.byteLength < 100 * 1024) {
          const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 200));
          throw new Error(`Файл слишком мал (${buf.byteLength} B). Похоже не ONNX: ${head}`);
        }

        session = await InferenceSession.create(buf, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
      } catch (e2) {
        self.postMessage({ type: 'error', message: `Не удалось загрузить модель ${msg.modelUrl}: ${e2.message || e2}` });
        return;
      }

      downsample = msg.downsample ?? 0.25;
      r1 = r2 = r3 = r4 = null;

      self.postMessage({ type: 'ready' });
      return;
    }

    if (msg.type === 'reset') {
      r1 = r2 = r3 = r4 = null;
      self.postMessage({ type: 'reset-ok' });
      return;
    }

    if (msg.type === 'run') {
      if (!session) {
        self.postMessage({ type: 'error', message: 'Session not initialized' });
        return;
      }

      const t0 = performance.now();

      const srcTensor = imageBitmapToTensor(msg.bitmap);

      // Начальные состояния 1×1×1×1 — чаще всего совместимы с RVM экспортами
      const z = new Float32Array(1);
      const zShape = [1, 1, 1, 1];

      const feeds = {
        src: srcTensor,
        downsample_ratio: new Tensor('float32', new Float32Array([downsample]), [1]),
        r1i: r1 ?? new Tensor('float32', z, zShape),
        r2i: r2 ?? new Tensor('float32', z, zShape),
        r3i: r3 ?? new Tensor('float32', z, zShape),
        r4i: r4 ?? new Tensor('float32', z, zShape),
      };

      const outputs = await session.run(feeds);
      r1 = outputs.r1o;
      r2 = outputs.r2o;
      r3 = outputs.r3o;
      r4 = outputs.r4o;

      const pha = outputs.pha;

      const t1 = performance.now();

      self.postMessage(
        { type: 'result', pha: pha.data, shape: pha.dims, timeMs: t1 - t0 },
        [pha.data.buffer]
      );

      msg.bitmap.close();
      return;
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: `Worker error: ${error}` });
    console.error('Worker error:', error);
  }
};
