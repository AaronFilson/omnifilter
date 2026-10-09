'use strict';

// Neural style transfer: repaints the photo in the style of a famous artwork
// using small pretrained neural networks ("fast neural style", Johnson et
// al. 2016), from the ONNX model zoo.
//
// These don't run as OpenCL kernels. A neural network is millions of learned
// weights arranged as layers of convolutions; writing that by hand would mean
// re-implementing a deep-learning framework. Instead the models are stored in
// the standard ONNX format and run with ONNX Runtime, Microsoft's open-source
// inference engine, which picks fast implementations for the hardware.
//
// The filters only appear when the onnxruntime-node package (an optional
// dependency) loads and the model files have been downloaded with
// `npm run fetch-models`.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { range } = require('./plan');
const { makeSpatialDimsDynamic } = require('../onnx_dynamic');

const { STYLES, MODEL_DIR } = require('./neural_models');

const GROUP = 'Neural style';

let ort = null;
try {
  ort = require('onnxruntime-node');
} catch (e) {
  ort = null;
}

const sessions = new Map();

// The published models declare a fixed 224x224 input; patch that so they
// accept any size, then cache the session.
function session(file) {
  if (!sessions.has(file)) {
    const model = makeSpatialDimsDynamic(fs.readFileSync(path.join(MODEL_DIR, file)), 'input1', 'output1');
    sessions.set(file, ort.InferenceSession.create(model, { logSeverityLevel: 3 }));
  }
  return sessions.get(file);
}

async function stylize(file, rgba, width, height, params) {
  // Work at a reduced size: the network's cost grows with pixel count, and
  // the style's brush strokes are sized in network pixels anyway. Sizes are
  // multiples of 4 because the network downsamples twice by 2.
  const scale = Math.min(1, params.detail / Math.max(width, height));
  const ww = Math.max(16, Math.round(width * scale / 4) * 4);
  const wh = Math.max(16, Math.round(height * scale / 4) * 4);
  const small = await sharp(rgba, { raw: { width: width, height: height, channels: 4 } })
    .removeAlpha().resize(ww, wh, { fit: 'fill' }).raw().toBuffer();

  // Interleaved RGB bytes -> planar float tensor [1, 3, height, width], 0-255.
  const plane = ww * wh;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = small[i * 3];
    input[plane + i] = small[i * 3 + 1];
    input[2 * plane + i] = small[i * 3 + 2];
  }
  const s = await session(file);
  const result = await s.run({ input1: new ort.Tensor('float32', input, [1, 3, wh, ww]) });
  const output = result.output1;
  const [, , oh, ow] = output.dims;
  const outPlane = ow * oh;
  const styled = Buffer.alloc(outPlane * 3);
  for (let i = 0; i < outPlane; i++) {
    for (let c = 0; c < 3; c++) {
      styled[i * 3 + c] = Math.min(255, Math.max(0, Math.round(output.data[c * outPlane + i])));
    }
  }

  // Back to full size, then blend with the original.
  const full = await sharp(styled, { raw: { width: ow, height: oh, channels: 3 } })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const t = params.strength / 100;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.round(rgba[i * 4 + c] + (full[i * 3 + c] - rgba[i * 4 + c]) * t);
    }
    out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return out;
}

module.exports = !ort ? [] : STYLES
  .filter((style) => fs.existsSync(path.join(MODEL_DIR, style.file)))
  .map((style) => ({
    name: style.name,
    label: style.label,
    group: GROUP,
    description: 'Neural style transfer (fast neural style), run with ONNX Runtime.',
    params: [
      range('detail', 'Detail (working size, px)', 256, 1600, 1024, 32),
      range('strength', 'Strength (%)', 0, 100, 100)
    ],
    run: (job) => stylize(style.file, job.rgba, job.width, job.height, job.params)
  }));
