import './style.css';

// DOM
const video = document.getElementById('cam');
const maskCanvas = document.getElementById('mask');
const previewCanvas = document.getElementById('preview');
const statsDiv = document.getElementById('stats');

const resSlider = document.getElementById('resSlider');
const dsSlider = document.getElementById('dsSlider');
const thrSlider = document.getElementById('thrSlider');
const cadenceCb = document.getElementById('cadence');

const inResSpan = document.getElementById('inRes');
const dsValSpan = document.getElementById('dsVal');
const thrValSpan = document.getElementById('thrVal');

const reinitBtn = document.getElementById('reinit');
const resetBtn = document.getElementById('reset');

// Параметры
let targetShort = Number(resSlider.value);
let downsample = Number(dsSlider.value);
let threads = Number(thrSlider.value);
let cadence2 = cadenceCb.checked;

// UI
resSlider.oninput = () => {
  targetShort = Number(resSlider.value);
  inResSpan.textContent = resSlider.value;
};
dsSlider.oninput = () => {
  downsample = Number(dsSlider.value);
  dsValSpan.textContent = dsSlider.value;
};
thrSlider.oninput = () => {
  threads = Number(thrSlider.value);
  thrValSpan.textContent = thrSlider.value;
};
cadenceCb.onchange = () => {
  cadence2 = cadenceCb.checked;
};

// Worker
const worker = new Worker(new URL('./rvm.worker.js', import.meta.url), { type: 'module' });

let ready = false;
let emaLatencyMs = 25;

reinitBtn.onclick = () => {
  ready = false;
  statsDiv.textContent = 'Reinitializing...';
  worker.postMessage({
    type: 'init',
    modelUrl: '/models/rvm_resnet50_fp32.onnx', // убедись, что файл есть!
    downsample,
    threads,
  });
};

resetBtn.onclick = () => {
  worker.postMessage({ type: 'reset' });
  statsDiv.textContent = 'State reset';
};

worker.onmessage = (e) => {
  const msg = e.data;

  if (msg.type === 'ready') {
    ready = true;
    statsDiv.textContent = 'Ready! Processing...';
    return;
  }
  if (msg.type === 'reset-ok') return;

  if (msg.type === 'error') {
    statsDiv.textContent = `ERROR: ${msg.message}`;
    console.error('Worker error:', msg.message);
    return;
  }
  if (msg.type !== 'result') return;

  const pha = new Float32Array(msg.pha);
  const dims = msg.shape;
  const h = dims[2], w = dims[3];
  const timeMs = msg.timeMs;

  emaLatencyMs = 0.9 * emaLatencyMs + 0.1 * timeMs;

  renderMask(pha, w, h);
  renderPreview(pha, w, h);

  statsDiv.textContent =
    `Latency: ${timeMs.toFixed(1)}ms (EMA: ${emaLatencyMs.toFixed(1)}ms) | ` +
    `Resolution: ${w}×${h} | DS: ${downsample} | Threads: ${threads}`;
};

function renderMask(pha, w, h) {
  const ctx = maskCanvas.getContext('2d');
  maskCanvas.width = w;
  maskCanvas.height = h;

  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;

  for (let i = 0; i < w * h; i++) {
    const alpha = Math.max(0, Math.min(255, Math.round(pha[i] * 255)));
    data[i * 4] = alpha;
    data[i * 4 + 1] = alpha;
    data[i * 4 + 2] = alpha;
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function renderPreview(pha, w, h) {
  const ctx = previewCanvas.getContext('2d');
  previewCanvas.width = w;
  previewCanvas.height = h;

  // фон (blur)
  ctx.filter = 'blur(12px)';
  ctx.drawImage(video, 0, 0, w, h);
  ctx.filter = 'none';

  // foreground с альфой по маске
  const fgCanvas = document.createElement('canvas');
  fgCanvas.width = w;
  fgCanvas.height = h;
  const fgCtx = fgCanvas.getContext('2d');

  fgCtx.drawImage(video, 0, 0, w, h);
  const fgData = fgCtx.getImageData(0, 0, w, h);
  const fgPixels = fgData.data;

  for (let i = 0; i < w * h; i++) {
    fgPixels[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(pha[i] * 255)));
  }
  fgCtx.putImageData(fgData, 0, 0);

  ctx.drawImage(fgCanvas, 0, 0);
}

function calcScaledSize(videoWidth, videoHeight, targetShortSide) {
  let w = videoWidth;
  let h = videoHeight;


  if (videoWidth < videoHeight) {
    const scale = targetShortSide / videoWidth;
    w = Math.round(videoWidth * scale);
    h = Math.round(videoHeight * scale);
  } else {
    const scale = targetShortSide / videoHeight;
    w = Math.round(videoWidth * scale);
    h = Math.round(videoHeight * scale);
  }
  return { w, h };
}

// Главный цикл
const offscreen = new OffscreenCanvas(16, 16);
const offscreenCtx = offscreen.getContext('2d');
let frameCount = 0;

function processLoop() {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;

  if (!vw || !vh) {
    requestAnimationFrame(processLoop);
    return;
  }

  const { w, h } = calcScaledSize(vw, vh, targetShort);
  offscreen.width = w;
  offscreen.height = h;
  offscreenCtx.drawImage(video, 0, 0, w, h);

  if (ready) {
    if (!cadence2 || frameCount++ % 2 === 0) {
      const bitmap = offscreen.transferToImageBitmap();
      worker.postMessage({ type: 'run', bitmap }, [bitmap]);
    }
  }
  requestAnimationFrame(processLoop);
}

// Init
async function init() {
  try {
    statsDiv.textContent = 'Requesting camera access...';

    if (!window.isSecureContext) throw new Error('Insecure context! Use HTTPS или localhost');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia not available');

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;

    await new Promise((resolve) => {
      if (video.readyState >= 2) resolve();
      else video.onloadedmetadata = () => resolve();
    });
    await video.play();

    statsDiv.textContent = 'Loading model...';

    worker.postMessage({
      type: 'init',
      modelUrl: '/models/rvm_resnet50_fp32.onnx',
      downsample,
      threads,
    });

    processLoop();
  } catch (err) {
    statsDiv.textContent = `Error: ${err}`;
    console.error('Init error:', err);
  }
}

window.addEventListener('error', (e) => {
  if (statsDiv) statsDiv.textContent = `JS error: ${e.message}`;
});

init();
