import * as tf from "@tensorflow/tfjs";

let ready = false;
let kernels = null;
let initPromise = null;

const makeKernel = (values, size) =>
  tf.tensor4d(values, [size, size, 1, 1], "float32");

export async function initMaskRefiner() {
  if (ready) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (tf.getBackend() !== "webgl") {
      await tf.setBackend("webgl");
    }
    await tf.ready();

    const smoothKernel = makeKernel(
      [
        1 / 16, 2 / 16, 1 / 16,
        2 / 16, 4 / 16, 2 / 16,
        1 / 16, 2 / 16, 1 / 16,
      ],
      3,
    );
    const closeKernel = makeKernel(
      [
        0, 1, 0,
        1, 1, 1,
        0, 1, 0,
      ],
      3,
    );

    kernels = {
      smoothKernel: tf.keep(smoothKernel),
      closeKernel: tf.keep(closeKernel),
    };
    ready = true;
  })();

  return initPromise;
}

export function refineMask(maskArray, width, height) {
  if (!ready || !kernels) {
    throw new Error("MaskRefiner is not initialized");
  }

  return tf.tidy(() => {
    const input = tf.tensor(maskArray, [1, height, width, 1], "float32");
    let output = tf.depthwiseConv2d(input, kernels.closeKernel, 1, "same");
    output = tf.maximum(output, input);
    output = tf.depthwiseConv2d(output, kernels.smoothKernel, 1, "same");
    output = tf.clipByValue(output, 0, 1);
    const data = output.dataSync();
    return new Float32Array(data);
  });
}
