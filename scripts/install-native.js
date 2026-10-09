#!/usr/bin/env node
'use strict';

// Installs the native OpenCL addon (run by `npm install`).
//
// CI builds the addon for each platform whenever its source changes and
// publishes the binaries on the repository's "native-prebuilds" release
// (.github/workflows/prebuilds.yml), named by a hash of the source. This
// script downloads the binary that matches this checkout's source, checks
// its SHA-256 and that it loads, and otherwise compiles the addon with
// node-gyp, which needs a C++ compiler and the OpenCL headers.
//
//   OMNIFILTER_BUILD_FROM_SOURCE=1   always compile
//   OMNIFILTER_PREBUILD_URL=...      where to download from (see DEFAULT_URL)
//   node scripts/install-native.js --key   prints this source's key

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['native/omnifilter.cpp', 'binding.gyp'];
const DEFAULT_URL = 'https://github.com/AaronFilson/omnifilter/releases/download/native-prebuilds';
const PLATFORM = process.platform + '-' + process.arch;

// Identifies the native source. Line endings are normalised so a Windows
// checkout gets the same key.
function sourceKey() {
  const hash = crypto.createHash('sha256');
  for (const file of SOURCES) {
    hash.update(file + '\0' + fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n') + '\0');
  }
  return hash.digest('hex').slice(0, 16);
}

const assetName = (key, platform) => 'omnifilter-' + key + '-' + platform + '.node';

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return Buffer.from(await res.arrayBuffer());
}

// Whether a binary loads here, checked in a child process so a crash can't
// take down the install. Returns null if it does, or the error.
function loadError(file) {
  const check = 'const a = require(' + JSON.stringify(file) + ');' +
    'if (typeof a.filter !== "function" || typeof a.devices !== "function") throw new Error("not the addon");';
  const result = spawnSync(process.execPath, ['-e', check], { encoding: 'utf8' });
  return result.status === 0 ? null : (result.stderr || 'exit code ' + result.status);
}

// A binary that only fails to load because the OpenCL runtime (libOpenCL,
// OpenCL.dll) is missing is still the right one: compiling wouldn't help.
const missingOpenCL = (error) => /OpenCL/i.test(error) ||
  (process.platform === 'win32' && /specified module could not be found/i.test(error));

async function tryPrebuilt() {
  const base = (process.env.OMNIFILTER_PREBUILD_URL || DEFAULT_URL).replace(/\/$/, '');
  const name = assetName(sourceKey(), PLATFORM);
  let binary;
  let expected;
  try {
    [binary, expected] = await Promise.all([download(base + '/' + name), download(base + '/' + name + '.sha256')]);
  } catch (e) {
    console.log('omnifilter: no prebuilt addon for ' + PLATFORM + ' (' + e.message + ')');
    return false;
  }
  const actual = crypto.createHash('sha256').update(binary).digest('hex');
  if (expected.toString().trim().split(/\s+/)[0] !== actual) {
    console.log('omnifilter: the prebuilt addon failed its checksum; compiling instead');
    return false;
  }
  const dir = path.join(ROOT, 'prebuilds', PLATFORM);
  const file = path.join(dir, 'omnifilter.node');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, binary);
  const error = loadError(file);
  if (error && missingOpenCL(error)) {
    console.log('omnifilter: installed the prebuilt addon for ' + PLATFORM + ', but no OpenCL runtime was found. ' +
      'Filters need one: it comes with GPU drivers, or install pocl.');
    return true;
  }
  if (error) {
    fs.rmSync(file);
    console.log('omnifilter: the prebuilt addon does not load on this system; compiling instead');
    return false;
  }
  console.log('omnifilter: installed the prebuilt addon for ' + PLATFORM);
  return true;
}

function compile() {
  console.log('omnifilter: compiling the native addon');
  // npm puts its bundled node-gyp on the PATH for install scripts.
  const result = spawnSync('node-gyp', ['rebuild'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error('\nomnifilter: compiling the native addon failed. It needs a C++ compiler and the OpenCL ' +
      'headers; see "Requirements" in README.md.');
    process.exit(result.status || 1);
  }
}

async function main() {
  if (process.argv.includes('--key')) return console.log(sourceKey());
  // A local build wins over a prebuilt one (see server/lib/native.js), so
  // drop any stale one first.
  fs.rmSync(path.join(ROOT, 'build'), { recursive: true, force: true });
  if (process.env.OMNIFILTER_BUILD_FROM_SOURCE || !(await tryPrebuilt())) compile();
}

module.exports = { sourceKey: sourceKey, assetName: assetName };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
