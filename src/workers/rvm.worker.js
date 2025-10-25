import { env, InferenceSession, Tensor } from "onnxruntime-web";

// Оптимизированные настройки ONNX Runtime
env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/";
env.wasm.simd = true;
env.wasm.proxy = true; // Use proxy for better performance
env.logLevel = "warning";

let session = null;
let downsample = 0.25;
let r1 = null, r2 = null, r3 = null, r4 = null;

// Temporal stabilization
let prevMask = null;
const TEMPORAL_ALPHA = 0.65;
let framesSinceReset = 0;
const RESET_INTERVAL = 150;
const EDGE_GAMMA = 0.82;
const FOREGROUND_PUSH = 0.08;
const MIN_FOREGROUND = 0.02;

// Buffer reuse
let tensorCache = {
  inputBuffer: null,
  inputShape: null,
  downsampleTensor: null,
  downsampleBuffer: null,
};

// Pipeline state
let isProcessing = false;
let pendingFrame = null;

// Performance tracking
let perfMetrics = {
  preprocess: 0,
  inference: 0,
  postprocess: 0,
  total: 0
};

// Optimized tensor conversion with buffer reuse
async function imageBitmapToTensor(bitmap) {
  if (typeof Tensor?.fromImageBitmap === "function") {
    const tensor = await Tensor.fromImageBitmap(bitmap, {
      dataType: "float32",
      colorFormat: "RGB",
      tensorFormat: "NCHW",
    });
    return tensor;
  }

  const width = bitmap.width;
  const height = bitmap.height;
  const size = width * height;

  const needsRealloc =
    !tensorCache.inputBuffer ||
    tensorCache.inputShape?.[0] !== height ||
    tensorCache.inputShape?.[1] !== width;

  if (needsRealloc) {
    tensorCache.inputBuffer = new Float32Array(3 * size);
    tensorCache.inputShape = [height, width];
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Cannot get 2d context");

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  const tensorData = tensorCache.inputBuffer;
  const gOffset = size;
  const bOffset = 2 * size;

  for (let i = 0; i < size; i++) {
    const p = i * 4;
    tensorData[i] = pixels[p] / 255.0;
    tensorData[gOffset + i] = pixels[p + 1] / 255.0;
    tensorData[bOffset + i] = pixels[p + 2] / 255.0;
  }

  return new Tensor("float32", tensorData, [1, 3, height, width]);
}

// Temporal stabilization with EMA and periodic resets
function applyTemporalStabilization(maskData, width, height) {
  const size = width * height;
  
  framesSinceReset++;
  
  // Periodic reset to prevent drift/dissolving
  if (framesSinceReset >= RESET_INTERVAL) {
    prevMask = null;
    framesSinceReset = 0;
  }
  
  if (!prevMask || prevMask.length !== size) {
    prevMask = new Float32Array(maskData);
    return maskData;
  }

  const stabilized = new Float32Array(size);
  const alpha = TEMPORAL_ALPHA;
  const beta = 1.0 - alpha;

  for (let i = 0; i < size; i++) {
    stabilized[i] = alpha * maskData[i] + beta * prevMask[i];
  }

  prevMask.set(stabilized);
  return stabilized;
}

// Simple morphological close to reduce flicker
function morphologicalClose(data, width, height, kernelSize = 3) {
  const result = new Float32Array(data.length);
  const halfKernel = Math.floor(kernelSize / 2);
  
  // Dilation
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel; kx++) {
          const nx = x + kx;
          const ny = y + ky;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            maxVal = Math.max(maxVal, data[ny * width + nx]);
          }
        }
      }
      result[y * width + x] = maxVal;
    }
  }
  
  // Erosion (on result of dilation)
  const final = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 1.0;
      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel; kx++) {
          const nx = x + kx;
          const ny = y + ky;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            minVal = Math.min(minVal, result[ny * width + nx]);
          }
        }
      }
      final[y * width + x] = minVal;
    }
  }
  
  return final;
}

// Post-process mask with temporal stabilization and optional morphological filtering
function refineMaskEdges(mask) {
  const len = mask.length;
  for (let i = 0; i < len; i++) {
    let v = mask[i];
    v = Math.pow(v, EDGE_GAMMA);
    if (v < MIN_FOREGROUND) {
      v = v + MIN_FOREGROUND * 0.6;
    }
    v = Math.min(1, v + FOREGROUND_PUSH * v * (1 - v));
    mask[i] = v;
  }
  return mask;
}

function postProcessMask(phaData, width, height, enableMorph = false) {
  const t0 = performance.now();
  
  let processed = applyTemporalStabilization(phaData, width, height);
  
  if (enableMorph) {
    processed = morphologicalClose(processed, width, height, 2); // Small kernel
  }

  processed = refineMaskEdges(processed);

  if (prevMask && prevMask.length === processed.length) {
    prevMask.set(processed);
  }
  
  perfMetrics.postprocess = performance.now() - t0;
  return processed;
}

// Pre-warm model with dummy input
async function prewarmModel(width, height) {
  console.log(`[Worker] Pre-warming model with ${width}x${height} input...`);
  
  const dummyCanvas = new OffscreenCanvas(width, height);
  const ctx = dummyCanvas.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, width, height);
  
  const dummyBitmap = dummyCanvas.transferToImageBitmap();
  const dummyTensor = imageBitmapToTensor(dummyBitmap);
  
  const z = new Float32Array(1);
  const zShape = [1, 1, 1, 1];
  
  const feeds = {
    src: dummyTensor,
    downsample_ratio: tensorCache.downsampleTensor || new Tensor("float32", new Float32Array([downsample]), [1]),
    r1i: new Tensor("float32", z, zShape),
    r2i: new Tensor("float32", z, zShape),
    r3i: new Tensor("float32", z, zShape),
    r4i: new Tensor("float32", z, zShape),
  };
  
  await session.run(feeds);
  dummyBitmap.close();
  
  console.log("[Worker] Model pre-warming complete");
}

async function processBitmap(bitmap) {
  isProcessing = true;
  const frameStart = performance.now();

  try {
    const tPreStart = performance.now();
    const srcTensor = await imageBitmapToTensor(bitmap);
    perfMetrics.preprocess = performance.now() - tPreStart;

    const z = new Float32Array(1);
    const zShape = [1, 1, 1, 1];

    const feeds = {
      src: srcTensor,
      downsample_ratio: tensorCache.downsampleTensor,
      r1i: r1 ?? new Tensor("float32", z, zShape),
      r2i: r2 ?? new Tensor("float32", z, zShape),
      r3i: r3 ?? new Tensor("float32", z, zShape),
      r4i: r4 ?? new Tensor("float32", z, zShape),
    };

    const tInfStart = performance.now();
    const outputs = await session.run(feeds);
    perfMetrics.inference = performance.now() - tInfStart;

    r1 = outputs.r1o;
    r2 = outputs.r2o;
    r3 = outputs.r3o;
    r4 = outputs.r4o;

    const pha = outputs.pha;
    const w = pha.dims[3];
    const h = pha.dims[2];

    const processedPha = postProcessMask(pha.data, w, h, false);
    perfMetrics.total = performance.now() - frameStart;

    self.postMessage(
      {
        type: "result",
        pha: processedPha,
        shape: pha.dims,
        metrics: {
          preprocess: perfMetrics.preprocess,
          inference: perfMetrics.inference,
          postprocess: perfMetrics.postprocess,
          total: perfMetrics.total,
        },
      },
      [processedPha.buffer],
    );
  } catch (error) {
    self.postMessage({ type: "error", message: `Worker error: ${error}` });
    console.error("Worker error:", error);
  } finally {
    bitmap.close();
    isProcessing = false;
  }

  if (pendingFrame) {
    const nextFrame = pendingFrame;
    pendingFrame = null;
    processBitmap(nextFrame);
  }
}

self.onmessage = async (e) => {
  const msg = e.data;

  try {
    if (msg.type === "init") {
      const t0 = performance.now();
      let actualProvider = "wasm"; // Default provider
      
      // Enable SIMD and multithreading for WASM
      env.wasm.simd = true;
      const wantThreads = msg.threads ?? Math.max(2, Math.min(4, self.navigator?.hardwareConcurrency || 2));
      env.wasm.numThreads = self.crossOriginIsolated ? wantThreads : 1;
      
      console.log(`[Worker] Initializing with ${env.wasm.numThreads} threads, SIMD: ${env.wasm.simd}`);
      if (!self.crossOriginIsolated) {
        console.warn("[Worker] Not cross-origin isolated, multithreading disabled");
      }

      try {
        // Load model
        const resp = await fetch(msg.modelUrl, { credentials: "same-origin" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const buf = await resp.arrayBuffer();
        if (buf.byteLength < 100 * 1024) {
          const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 200));
          throw new Error(`File too small (${buf.byteLength} B). Not ONNX: ${head}`);
        }

        // Try execution providers in order: WebGL -> WASM (skip WebGPU for now due to unsupported ops)
        let providers = [];
        
        // WebGPU has issues with some ops (ceil() in AveragePool), skip for now
        // if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        //   providers.push("webgpu");
        //   console.log("[Worker] WebGPU available, trying it first");
        // }
        
        // Add WebGL and WASM
        providers.push("webgl");
        providers.push("wasm");
        
        console.log(`[Worker] Trying providers: ${providers.join(" -> ")}`);

        // Try providers in order
        for (const provider of providers) {
          try {
            session = await InferenceSession.create(buf, {
              executionProviders: [provider],
              graphOptimizationLevel: "all",
              enableCpuMemArena: true,
              enableMemPattern: true,
              enableProfiling: false,
              logSeverityLevel: 2,
            });
            actualProvider = provider;
            console.log(`[Worker] ✓ Using ${provider.toUpperCase()} backend`);
            break;
          } catch (providerError) {
            console.warn(`[Worker] ${provider} failed:`, providerError.message);
            if (provider === providers[providers.length - 1]) {
              throw providerError; // Last provider failed
            }
          }
        }
      } catch (e2) {
        self.postMessage({
          type: "error",
          message: `Failed to load model ${msg.modelUrl}: ${e2.message || e2}`,
        });
        return;
      }

      // Set downsample ratio and cache tensor
      downsample = msg.downsample ?? 0.25;
      tensorCache.downsampleBuffer = new Float32Array([downsample]);
      tensorCache.downsampleTensor = new Tensor(
        "float32",
        tensorCache.downsampleBuffer,
        [1],
      );
      
      r1 = r2 = r3 = r4 = null;
      prevMask = null;

      // Pre-warm model (only if WASM, as WebGL/WebGPU may have issues)
      if (actualProvider === "wasm") {
        try {
          await prewarmModel(256, 256);
        } catch (warmupError) {
          console.warn("[Worker] Model pre-warming failed:", warmupError);
        }
      } else {
        console.log("[Worker] Skipping pre-warming for", actualProvider);
      }

      const initTime = performance.now() - t0;
      console.log(`[Worker] Initialization complete in ${initTime.toFixed(1)}ms`);

      self.postMessage({ 
        type: "ready",
        config: {
          downsample,
          backend: actualProvider,
          threads: env.wasm.numThreads,
          simd: env.wasm.simd,
          initTimeMs: initTime
        }
      });
      return;
    }

    if (msg.type === "reset") {
      r1 = r2 = r3 = r4 = null;
      prevMask = null;
      framesSinceReset = 0;
      tensorCache.inputBuffer = null;
      tensorCache.inputShape = null;
      self.postMessage({ type: "reset-ok" });
      return;
    }

    if (msg.type === "config") {
      let updated = false;
      if (typeof msg.downsample === "number" && !Number.isNaN(msg.downsample)) {
        const clamped = Math.min(0.6, Math.max(0.12, msg.downsample));
        if (Math.abs(clamped - downsample) > 1e-3) {
          downsample = clamped;
          if (!tensorCache.downsampleBuffer) {
            tensorCache.downsampleBuffer = new Float32Array([downsample]);
            tensorCache.downsampleTensor = new Tensor(
              "float32",
              tensorCache.downsampleBuffer,
              [1],
            );
          } else {
            tensorCache.downsampleBuffer[0] = downsample;
          }
          updated = true;
        }
      }

      if (msg.resetState) {
        r1 = r2 = r3 = r4 = null;
        prevMask = null;
        framesSinceReset = 0;
        updated = true;
      }

      if (updated) {
        console.log(
          `[Worker] Downsample updated to ${downsample.toFixed(3)}, state reset: ${Boolean(msg.resetState)}`,
        );
      }

      self.postMessage({
        type: "config-ok",
        config: { downsample, reset: Boolean(msg.resetState) },
      });
      return;
    }

    if (msg.type === "run") {
      if (!session) {
        self.postMessage({ type: "error", message: "Session not initialized" });
        return;
      }

      // Pipeline parallelism: if already processing, queue newest frame
      if (isProcessing) {
        if (pendingFrame) {
          pendingFrame.close();
        }
        pendingFrame = msg.bitmap;
        return;
      }

      processBitmap(msg.bitmap);
      return;
    }
  } catch (error) {
    isProcessing = false;
    self.postMessage({ type: "error", message: `Worker error: ${error}` });
    console.error("Worker error:", error);
  }
};
