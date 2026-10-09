'use strict';

// Helpers for describing a filter as a pipeline of OpenCL kernel passes.
// A filter's plan() builds a Plan, which the native addon runs entirely on
// the device (see native/omnifilter.cpp for the format).

// Kernel argument constructors.
const buf = (name) => ({ buf: name });
const img = (name, options) => Object.assign({ img: name }, options);
const img3d = (name, size) => ({ img3d: name, size: size });
const int = (n) => ({ int: Math.round(n) });
const float = (x) => ({ float: x });
const data = (array) => ({ data: array });

class Plan {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.buffers = [];
    this.passes = [];
    this.current = 'src';
    this.count = 0;
    this.ping = null;
  }

  // Declares a device buffer and returns its name. options.init uploads a
  // typed array; options.zero fills it with zeros (e.g. for counters).
  buffer(bytes, options) {
    options = options || {};
    const name = 'b' + this.count++;
    this.buffers.push({ name: name, bytes: bytes, init: options.init, zero: !!options.zero });
    return name;
  }

  // A buffer for one RGBA image, the same size as the input.
  rgba() {
    return this.buffer(this.width * this.height * 4);
  }

  // A buffer of one float4 per pixel.
  float4s() {
    return this.buffer(this.width * this.height * 16);
  }

  // Adds a pass with explicit arguments. options.global / options.local set
  // the work sizes (default: one work-item per pixel).
  pass(kernel, args, options) {
    options = options || {};
    this.passes.push({ kernel: kernel, args: args, global: options.global, local: options.local, band: options.band });
    return this;
  }

  // Runs a standard image kernel, (src, dst, width, height, ...extra), from
  // one named buffer into another.
  apply(kernel, input, output) {
    const extra = Array.prototype.slice.call(arguments, 3);
    return this.pass(kernel, [buf(input), buf(output), int(this.width), int(this.height)].concat(extra));
  }

  // Runs a standard image kernel on the current image. Results alternate
  // between two scratch buffers, so a long chain of steps uses little memory;
  // copy anything you need to keep with apply() into your own buffer.
  step(kernel) {
    const out = this.scratch();
    this.apply.apply(this, [kernel, this.current, out].concat(Array.prototype.slice.call(arguments, 1)));
    this.current = out;
    return this;
  }

  // Like step(), but the kernel reads the current image as a texture:
  // (image2d src, dst, width, height, ...extra).
  sample(kernel) {
    const out = this.scratch();
    const extra = Array.prototype.slice.call(arguments, 1);
    this.pass(kernel, [img(this.current), buf(out), int(this.width), int(this.height)].concat(extra));
    this.current = out;
    return this;
  }

  // Launches the most recent pass in bands of `rows` rows (see the band
  // option in native/omnifilter.cpp), for kernels heavy enough to trip the
  // OS's GPU watchdog on big images.
  band(rows) {
    this.passes[this.passes.length - 1].band = rows;
    return this;
  }

  scratch() {
    if (!this.ping) this.ping = [this.rgba(), this.rgba()];
    return this.current === this.ping[0] ? this.ping[1] : this.ping[0];
  }

  native() {
    return { buffers: this.buffers, passes: this.passes, output: this.current };
  }
}

// Normalized 1D Gaussian weights for a standard deviation in pixels.
function gaussianWeights(sigma) {
  const radius = Math.min(127, Math.ceil(sigma * 3));
  const weights = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    weights[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += weights[i + radius];
  }
  return weights.map((w) => w / sum);
}

// Convolves the current image with a kw x kh weight matrix. bias is added
// afterwards (0-255 scale); with absolute, the magnitude is used.
function convolve(plan, weights, kw, kh, bias, absolute) {
  return plan.step('convolve', data(weights), int(kw), int(kh), float(bias || 0), int(absolute ? 1 : 0),
    int(0)).band(256);
}

// Blurs the current image with two separable passes (rows, then columns).
function gaussian(plan, sigma) {
  if (sigma < 0.3) return plan;
  const w = gaussianWeights(sigma);
  convolve(plan, w, w.length, 1);
  return convolve(plan, w, 1, w.length);
}

// Converts a size given as a percentage of the image's shorter side to pixels.
function px(width, height, percent) {
  return Math.min(width, height) * percent / 100;
}

// Filter parameter declarations; the client renders these as controls.
function range(name, label, min, max, defaultValue, step) {
  return { name: name, label: label, type: 'range', min: min, max: max, step: step || 1, default: defaultValue };
}

// options: [[value, label], ...]
function choice(name, label, options, defaultValue) {
  return {
    name: name,
    label: label,
    type: 'select',
    options: options.map((o) => ({ value: o[0], label: o[1] })),
    default: defaultValue === undefined ? options[0][0] : defaultValue
  };
}

module.exports = {
  range: range,
  choice: choice,
  Plan: Plan,
  buf: buf,
  img: img,
  img3d: img3d,
  int: int,
  float: float,
  data: data,
  gaussianWeights: gaussianWeights,
  convolve: convolve,
  gaussian: gaussian,
  px: px
};
