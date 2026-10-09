#!/usr/bin/env node
'use strict';

// Downloads the neural style transfer models (about 6.7 MB each) into
// models/, verifying each file's SHA-256. Run with `npm run fetch-models`.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { STYLES, MODEL_DIR } = require('../server/lib/filters/neural_models');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function fetchModel(style) {
  const target = path.join(MODEL_DIR, style.file);
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === style.sha256) {
    console.log('ok       ' + style.file);
    return;
  }
  const res = await fetch(style.url);
  if (!res.ok) throw new Error(style.file + ': HTTP ' + res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha256(bytes) !== style.sha256) throw new Error(style.file + ': checksum mismatch, not saved');
  fs.writeFileSync(target + '.tmp', bytes);
  fs.renameSync(target + '.tmp', target);
  console.log('fetched  ' + style.file + ' (' + (bytes.length / 1e6).toFixed(1) + ' MB)');
}

(async () => {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  for (const style of STYLES) await fetchModel(style);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
