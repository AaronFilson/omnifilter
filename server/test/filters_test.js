// Runs every registered filter, checks the registry and parameter handling,
// and the LUT and ONNX helpers.
const fs = require('fs');
const path = require('path');
const expect = require('chai').expect;
const gpu = require(__dirname + '/../lib/gpu_filters');
const lut = require(__dirname + '/../lib/filters/lut');
const neuralModels = require(__dirname + '/../lib/filters/neural_models');
const { makeSpatialDimsDynamic } = require(__dirname + '/../lib/onnx_dynamic');
const ref = require(__dirname + '/reference');

const W = 64;
const H = 40;

// Smooth gradients, an edge and a little noise, in a limited tonal range so
// that auto adjustments have something to do.
function testImage(width, height) {
  const noise = ref.randomImage(width, height, 3);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = 40 + (x < width / 2 ? 20 : 140) + (noise[o] % 16);
      data[o + 1] = 50 + Math.floor(120 * y / height) + (noise[o + 1] % 16);
      data[o + 2] = 60 + Math.floor(80 * (x + y) / (width + height)) + (noise[o + 2] % 16);
      data[o + 3] = 255;
    }
  }
  return data;
}

const filters = gpu.list();
const isNeural = (f) => f.group === 'Neural style';
// Filters the device can run as OpenCL plans. Some devices can't run them all
// (e.g. texture filters on a device without image support); those are skipped.
const runsOnDevice = (f) => !isNeural(f) && f.available !== false;

describe('filter registry', () => {
  it('has uniquely named, fully described filters', () => {
    expect(filters.length).to.be.at.least(50);
    expect(new Set(filters.map((f) => f.name)).size).to.equal(filters.length);
    for (const f of filters) {
      expect(f.label, f.name).to.be.a('string').that.is.not.empty;
      expect(f.group, f.name).to.be.a('string').that.is.not.empty;
      expect(f.description, f.name).to.be.a('string').that.is.not.empty;
    }
  });

  it('declares sensible parameters', () => {
    for (const f of filters) {
      for (const p of f.params) {
        if (p.type === 'select') {
          expect(p.options.map((o) => o.value), f.name + '.' + p.name).to.include(p.default);
        } else {
          expect(p.type, f.name + '.' + p.name).to.equal('range');
          expect(p.default, f.name + '.' + p.name).to.be.within(p.min, p.max);
          expect(p.step, f.name + '.' + p.name).to.be.above(0);
        }
      }
    }
  });

  it('only uses kernels that exist', () => {
    const kernels = new Set(gpu.kernels());
    for (const f of filters.filter((x) => !isNeural(x))) {
      for (const pass of gpu.plan(f.name, W, H).passes) {
        expect(kernels.has(pass.kernel), f.name + ' uses ' + pass.kernel).to.equal(true);
      }
    }
  });

  it('fills in defaults and clamps parameters', () => {
    expect(gpu.normalizeParams('blur', {})).to.eql({ radius: 0.67 });
    expect(gpu.normalizeParams('blur', { radius: 99 })).to.eql({ radius: 5 });
    expect(gpu.normalizeParams('blur', { radius: 'abc' })).to.eql({ radius: 0.67 });
    expect(gpu.normalizeParams('sobel', { style: 'nope', strength: -5 })).to.eql({ strength: 0.5, style: 'neon' });
  });
});

describe('every filter', function() {
  this.timeout(120000);
  const src = testImage(W, H);

  for (const f of filters) {
    it(f.name + ' runs, changes the image and is deterministic', async function() {
      if (f.available === false) this.skip();
      const a = await gpu.apply(f.name, src, W, H, {});
      const b = await gpu.apply(f.name, src, W, H, {});
      expect(a.length).to.equal(src.length);
      expect(ref.compare(a, src).max, 'unchanged').to.be.above(0);
      expect(ref.compare(a, b).max, 'not deterministic').to.equal(0);
    });
  }

  it('runs at the extremes of every parameter', async () => {
    for (const f of filters.filter(runsOnDevice)) {
      const settings = [
        Object.fromEntries(f.params.filter((p) => p.type === 'range').map((p) => [p.name, p.min])),
        Object.fromEntries(f.params.filter((p) => p.type === 'range').map((p) => [p.name, p.max]))
      ];
      for (const p of f.params.filter((x) => x.type === 'select')) {
        for (const o of p.options) settings.push({ [p.name]: o.value });
      }
      for (const params of settings) {
        const out = await gpu.apply(f.name, src, W, H, params).catch((e) => {
          throw new Error(f.name + ' ' + JSON.stringify(params) + ': ' + e.message);
        });
        expect(out.length).to.equal(src.length);
      }
    }
  });

  it('handles a 1x1 image', async () => {
    for (const f of filters.filter(runsOnDevice)) {
      const out = await gpu.apply(f.name, new Uint8Array([10, 20, 30, 255]), 1, 1, {});
      expect(out.length, f.name).to.equal(4);
    }
  });

  it('runs filters with a working size on a smaller copy and returns full size', async () => {
    const big = testImage(900, 500);
    const out = await gpu.apply('cartoon', big, 900, 500, { detail: 600 });
    expect(out.length).to.equal(big.length);
  });

  it('runs concurrent requests without mixing up results', async () => {
    const images = [1, 2, 3, 4, 5, 6].map((seed) => ref.randomImage(40, 30, seed));
    const outs = await Promise.all(images.map((image) => gpu.apply('sharpen', image, 40, 30, {})));
    const expected = await Promise.all(images.map((image) => gpu.apply('sharpen', image, 40, 30, {})));
    outs.forEach((out, i) => expect(ref.compare(out, expected[i]).max).to.equal(0));
  });

  it('rejects an unknown filter and mismatched pixel data', async () => {
    const fail = (promise) => promise.then(() => { throw new Error('should have rejected'); }, (e) => e.message);
    expect(await fail(gpu.apply('nope', src, W, H))).to.match(/Unknown filter/);
    expect(await fail(gpu.apply('blur', src, W + 1, H))).to.match(/width \* height \* 4/);
  });
});

describe('.cube LUT parsing', () => {
  const cube = (size, entries) => ['TITLE "Test"', 'LUT_3D_SIZE ' + size, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1']
    .concat(entries).join('\n');

  it('parses a LUT, red varying fastest', () => {
    const entries = [];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) entries.push(`${r} ${g} ${b * 0.5}`);
    const parsed = lut.parseCube(cube(2, entries));
    expect(parsed.size).to.equal(2);
    expect(parsed.title).to.equal('Test');
    expect(Array.from(parsed.table.slice(4, 8))).to.eql([1, 0, 0, 1]);
    expect(Array.from(parsed.table.slice(28, 32))).to.eql([1, 1, 0.5, 1]);
  });

  it('rejects malformed files', () => {
    expect(() => lut.parseCube(cube(2, ['0 0 0']))).to.throw(/Expected 8/);
    expect(() => lut.parseCube('LUT_1D_SIZE 16')).to.throw(/1D/);
    expect(() => lut.parseCube(cube(200, []))).to.throw(/between 2 and 65/);
  });
});

describe('ONNX model patching', function() {
  this.timeout(60000);
  const modelPath = path.join(neuralModels.MODEL_DIR, neuralModels.STYLES[0].file);
  let ort = null;
  try {
    ort = require('onnxruntime-node');
  } catch (e) {
    ort = null;
  }

  it('lets a fixed-size style model run at any size', async function() {
    if (!ort || !fs.existsSync(modelPath)) return this.skip();
    const patched = makeSpatialDimsDynamic(fs.readFileSync(modelPath), 'input1', 'output1');
    const session = await ort.InferenceSession.create(patched, { logSeverityLevel: 3 });
    const input = new ort.Tensor('float32', new Float32Array(3 * 48 * 64).fill(128), [1, 3, 48, 64]);
    const out = await session.run({ input1: input });
    expect(out.output1.dims).to.eql([1, 3, 48, 64]);
  });

  it('refuses a model without the named input and output', () => {
    // A minimal ModelProto: graph (7) containing one input (11) named "x".
    const name = Buffer.from([0x0a, 0x01, 0x78]);
    const input = Buffer.concat([Buffer.from([0x5a, name.length]), name]);
    const model = Buffer.concat([Buffer.from([0x3a, input.length]), input]);
    expect(() => makeSpatialDimsDynamic(model, 'input1', 'output1')).to.throw(/no input/);
  });
});
