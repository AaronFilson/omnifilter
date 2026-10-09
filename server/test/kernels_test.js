// Checks OpenCL kernels against the plain JavaScript versions in reference.js.
const expect = require('chai').expect;
const gpu = require(__dirname + '/../lib/gpu_filters');
const P = require(__dirname + '/../lib/filters/plan');
const M = require(__dirname + '/../lib/filters/matrices');
const lut = require(__dirname + '/../lib/filters/lut');
const ref = require(__dirname + '/reference');

const { Plan, buf, img3d, data, int, float } = P;

// Odd sizes catch work-items that run off the edge of the image; the tall
// image is taller than the band sizes, so banded launches are covered too.
const W = 61;
const H = 37;
const TALL_W = 23;
const TALL_H = 300;

function run(build, src, width, height) {
  const plan = new Plan(width, height);
  build(plan);
  return gpu.runPlan(src, width, height, plan);
}

// GPU floats round half-to-even and may fuse multiply-adds, so allow 1 level.
function expectClose(gpuOut, refOut, tolerance) {
  const diff = ref.compare(gpuOut, refOut);
  expect(diff.max, diff.count + ' bytes differ').to.be.at.most(tolerance === undefined ? 1 : tolerance);
}

describe('OpenCL kernels match the reference implementations', function() {
  this.timeout(30000);
  const src = ref.randomImage(W, H, 7);
  const tall = ref.randomImage(TALL_W, TALL_H, 11);

  it('convolve (weights, bias, absolute value, banded)', async () => {
    const weights = new Float32Array(15).map((v, i) => Math.sin(i) * 0.3);
    const out = await run((p) => P.convolve(p, weights, 5, 3, 20, true), tall, TALL_W, TALL_H);
    expectClose(out, ref.convolve(tall, TALL_W, TALL_H, weights, 5, 3, 20, true));
  });

  it('Gaussian blur (two separable passes)', async () => {
    const w = P.gaussianWeights(2.5);
    const once = ref.convolve(src, W, H, w, w.length, 1, 0, false);
    const out = await run((p) => P.gaussian(p, 2.5), src, W, H);
    // The GPU rounds to bytes between the passes too.
    expectClose(out, ref.convolve(once, W, H, w, 1, w.length, 0, false));
  });

  it('color_matrix (sepia, hue rotation, brightness and contrast)', async () => {
    for (const m of [M.sepia(0.8), M.hueRotate(70), M.multiply(M.brightness(0.1), M.contrast(0.3))]) {
      const out = await run((p) => p.step('color_matrix', data(m)), src, W, H);
      expectClose(out, ref.colorMatrix(src, W, H, m));
    }
  });

  it('point operations', async () => {
    expectClose(await run((p) => p.step('gamma_correct', float(1.7)), src, W, H), ref.gamma(src, W, H, 1.7));
    expectClose(await run((p) => p.step('threshold', float(0.45)), src, W, H), ref.threshold(src, W, H, 0.45));
    expectClose(await run((p) => p.step('posterize', int(5)), src, W, H), ref.posterize(src, W, H, 5));
    expectClose(await run((p) => p.step('solarize', float(0.6)), src, W, H), ref.solarize(src, W, H, 0.6));
  });

  it('sobel', async () => {
    for (const mode of [0, 1]) {
      expectClose(await run((p) => p.step('sobel', float(2), int(mode)), src, W, H), ref.sobel(src, W, H, 2, mode));
    }
  });

  it('median (radix select, banded)', async () => {
    for (const r of [1, 2]) {
      const out = await run((p) => p.step('median', int(r), int(0)).band(64), tall, TALL_W, TALL_H);
      expectClose(out, ref.median(tall, TALL_W, TALL_H, r), 0);
    }
  });

  it('kuwahara (banded)', async () => {
    const out = await run((p) => p.step('kuwahara', int(3), int(0)).band(64), tall, TALL_W, TALL_H);
    expectClose(out, ref.kuwahara(tall, TALL_W, TALL_H, 3));
  });

  it('bilateral', async () => {
    const out = await run((p) => p.step('bilateral', int(3), float(1.5), float(0.15), int(0)).band(16), src, W, H);
    expectClose(out, ref.bilateral(src, W, H, 3, 1.5, 0.15));
  });

  it('pixelate (block averages, partial edge blocks)', async () => {
    const block = 8;
    const out = await run((p) => {
      const bx = Math.ceil(W / block);
      const by = Math.ceil(H / block);
      const avg = p.buffer(bx * by * 16);
      p.pass('block_average', [buf('src'), buf(avg), int(W), int(H), int(block), int(bx), int(by)], { global: [bx, by] });
      const dst = p.rgba();
      p.pass('pixelate_fill', [buf(avg), buf(dst), int(W), int(H), int(block), int(bx)]);
      p.current = dst;
    }, src, W, H);
    expectClose(out, ref.pixelate(src, W, H, block));
  });

  it('histogram equalization (atomic histogram + parallel scan)', async () => {
    const out = await gpu.apply('equalize', src, W, H, { amount: 100 });
    // A luma value right on a bin boundary can round differently in float32.
    expectClose(out, ref.equalize(src, W, H, 1), 3);
  });

  it('auto levels (per channel and linked)', async () => {
    for (const mode of ['colour', 'contrast']) {
      const out = await gpu.apply('auto_levels', src, W, H, { mode: mode, clip: 1 });
      expectClose(out, ref.autoLevels(src, W, H, 0.01, mode === 'contrast'), 2);
    }
  });

  it('an identity 3D LUT leaves colours unchanged (3D texture path)', async () => {
    const identity = lut.bake((c) => c, 17);
    const out = await run((p) => {
      const name = p.buffer(identity.table.byteLength, { init: identity.table });
      p.step('lut3d', img3d(name, identity.size), int(identity.size), float(1));
    }, src, W, H);
    expectClose(out, src, 2);
  });

  it('distortions at zero strength leave the image unchanged (texture coordinates)', async () => {
    const cases = [['swirl', { angle: 0 }], ['pinch_bulge', { amount: 0 }], ['lens', { amount: 0 }],
      ['chromatic_aberration', { amount: 0 }]];
    for (const [name, params] of cases) {
      expectClose(await gpu.apply(name, src, W, H, params), src, 1);
    }
  });
});
