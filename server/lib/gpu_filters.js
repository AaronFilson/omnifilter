'use strict';

// Runs image filters on the GPU through the native OpenCL addon
// (native/omnifilter.cpp). The kernels live in native/kernels/*.cl and the
// filter definitions, which describe each filter as a pipeline of kernel
// passes, in server/lib/filters/.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const native = require('bindings')('omnifilter');
const definitions = require('./filters');
const deviceChoice = require('./device_choice');

const KERNEL_DIR = path.join(__dirname, '..', '..', 'native', 'kernels');

// Which OpenCL device to use: 'auto' (the best GPU, else any device), 'gpu',
// 'cpu', a device index, or part of a device's name. See device_choice.js,
// and `npm run devices` for the list.
const DEVICE_SETTING = process.env.OMNIFILTER_DEVICE || 'auto';

const registry = new Map();
for (const def of definitions) {
  if (registry.has(def.name)) throw new Error('Duplicate filter name: ' + def.name);
  registry.set(def.name, def);
}

var device = null;  // the chosen device's description, once initialised
var skipped = [];   // devices tried first that failed, as 'name: reason'

// common.cl first, then the rest alphabetically, as one program. The #line
// markers make compile errors point at the right file and line.
function kernelSource() {
  const files = fs.readdirSync(KERNEL_DIR).filter((f) => f.endsWith('.cl'))
    .sort((a, b) => (a === 'common.cl' ? -1 : b === 'common.cl' ? 1 : a.localeCompare(b)));
  return files.map((f) => '#line 1 "' + f + '"\n' + fs.readFileSync(path.join(KERNEL_DIR, f), 'utf8'))
    .join('\n');
}

// Compiles the kernels for the best device that matches OMNIFILTER_DEVICE,
// moving on to the next if a device fails (e.g. its compiler rejects them).
function ensureInit() {
  if (device) return;
  const all = native.devices();
  const choices = deviceChoice.candidates(all, DEVICE_SETTING);
  if (!choices.length) {
    throw new Error(all.length ?
      'No OpenCL device matches OMNIFILTER_DEVICE=' + DEVICE_SETTING + '; found ' +
        all.map((d) => d.index + ': ' + d.name + ' (' + d.type + ')').join(', ') :
      'No OpenCL devices found; is an OpenCL driver installed?');
  }
  const source = kernelSource();
  const failures = [];
  for (const choice of choices) {
    try {
      native.init(source, choice.index);
      device = native.deviceInfo();
      device.index = choice.index;
      skipped = failures;
      return;
    } catch (e) {
      failures.push(choice.name + ': ' + e.message);
    }
  }
  throw new Error('No OpenCL device could run the filters:\n' + failures.join('\n'));
}

// Fills in defaults and clamps values to each parameter's declared range.
// raw comes straight from the request body, so anything that isn't a plain
// number or string (objects, arrays) falls back to the default.
function normalizeParams(def, raw) {
  raw = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const p of def.params || []) {
    const value = Object.prototype.hasOwnProperty.call(raw, p.name) ? raw[p.name] : undefined;
    if (p.type === 'select') {
      out[p.name] = p.options.some((o) => o.value === value) ? value : p.default;
    } else {
      const n = typeof value === 'number' || (typeof value === 'string' && value !== '') ?
        Number(value) : NaN;
      out[p.name] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default;
    }
  }
  return out;
}

exports.has = (name) => typeof name === 'string' && registry.has(name);

exports.normalizeParams = (name, raw) => normalizeParams(registry.get(name), raw);

// The same for a list of parameter declarations (see range() and choice()).
exports.normalizeValues = (params, raw) => normalizeParams({ params: params }, raw);

// Why a filter can't run on the current device at all (e.g. it samples
// textures and the device has no image support), or null if it can.
function unsupportedReason(def) {
  if (def.run || !device) return null;
  const plan = def.plan(16, 16, normalizeParams(def, {})).native();
  return deviceChoice.unsupportedReason(deviceChoice.planNeeds(plan, 16, 16), device);
}

// What the client needs to show the filters and their controls. Filters the
// device can't run are marked available: false.
exports.list = () => {
  try {
    ensureInit();
  } catch (e) {
    // No usable device: list the filters anyway; applying them will explain.
  }
  return definitions.map((d) => {
    const reason = unsupportedReason(d);
    return Object.assign({
      name: d.name,
      label: d.label,
      group: d.group,
      description: d.description,
      params: d.params || []
    }, reason ? { available: false, unavailableReason: reason } : {});
  });
};

// The native plan a filter would run (for tests and debugging).
exports.plan = (name, width, height, params) => {
  const def = registry.get(name);
  return def.plan(width, height, normalizeParams(def, params)).native();
};

const resize = (rgba, width, height, toWidth, toHeight) =>
  sharp(rgba, { raw: { width: width, height: height, channels: 4 } })
    .resize(toWidth, toHeight, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();

// The size to run a filter at, and its plan for that size. Filters with a
// working size run on a scaled-down copy of big photos, and so does any
// filter whose buffers or textures wouldn't fit the device at full size.
function sizedPlan(def, width, height, p) {
  const target = def.workingSize ? def.workingSize(p) : Infinity;
  const scale = Math.min(1, target / Math.max(width, height));
  var w = Math.max(1, Math.round(width * scale));
  var h = Math.max(1, Math.round(height * scale));
  for (let attempt = 0; attempt < 8; attempt++) {
    const plan = def.plan(w, h, p).native();
    const needs = deviceChoice.planNeeds(plan, w, h);
    const fit = deviceChoice.fitScale(needs, device);
    if (fit >= 1) return { width: w, height: h, plan: plan };
    if (fit === 0) {
      throw new Error(def.label + ' ' + deviceChoice.unsupportedReason(needs, device));
    }
    // Shrink a little more than needed, since some buffers don't scale exactly.
    w = Math.max(1, Math.floor(w * fit * 0.97));
    h = Math.max(1, Math.floor(h * fit * 0.97));
    if (attempt === 0) {
      console.log(def.label + ': running at ' + w + 'x' + h + ' to fit ' + device.name);
    }
  }
  throw new Error(def.label + ' is too large for ' + device.name);
}

async function runPlan(def, rgba, width, height, p) {
  ensureInit();
  const sized = sizedPlan(def, width, height, p);
  if (sized.width === width && sized.height === height) {
    return native.filter(rgba, width, height, sized.plan);
  }
  const small = await resize(rgba, width, height, sized.width, sized.height);
  const out = await native.filter(small, sized.width, sized.height, sized.plan);
  return resize(out, sized.width, sized.height, width, height);
}

// Resolves with a new Buffer of filtered RGBA pixels.
exports.apply = (name, rgba, width, height, params) => {
  const def = registry.get(name);
  if (!def) return Promise.reject(new Error('Unknown filter: ' + name));
  try {
    const p = normalizeParams(def, params);
    if (def.run) return def.run({ rgba: rgba, width: width, height: height, params: p });
    return runPlan(def, rgba, width, height, p);
  } catch (e) {
    return Promise.reject(e);
  }
};

// Runs a hand-built Plan (see filters/plan.js), for tests and experiments.
exports.runPlan = (rgba, width, height, plan) => {
  try {
    ensureInit();
    return native.filter(rgba, width, height, plan.native());
  } catch (e) {
    return Promise.reject(e);
  }
};

// The chosen device: its description from the addon plus its index, and
// skipped, the devices tried first that failed.
exports.deviceInfo = () => {
  ensureInit();
  return Object.assign({}, device, { skipped: skipped });
};

// Every OpenCL device, whether or not it's the one in use.
exports.devices = () => native.devices();

exports.kernels = () => {
  ensureInit();
  return native.kernels();
};
