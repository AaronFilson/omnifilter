'use strict';

// Converts between the base64 data URLs the client sends and the raw RGBA
// pixels the GPU filters work on. Decoding and encoding are done by sharp
// (libvips), which runs off the main thread so large photos don't block the
// server.

const sharp = require('sharp');

const JPEG_QUALITY = 90;

// A small compressed file can expand to gigabytes of pixels (a "decompression
// bomb"), so images are limited by pixel count and by side length. sharp
// checks the pixel count from the file header, before decoding anything.
// 50 megapixels covers phone and most camera photos; raise it with
// OMNIFILTER_MAX_PIXELS if the GPU has the memory.
const MAX_PIXELS = Number(process.env.OMNIFILTER_MAX_PIXELS) || 50e6;
// Very long images are refused too. (Filters that need textures larger than
// the device allows run on a scaled-down copy; see gpu_filters.js.)
const MAX_SIDE = 16384;

exports.MAX_PIXELS = MAX_PIXELS;
exports.MAX_SIDE = MAX_SIDE;

const DATA_URL = /^data:(image\/[\w.+-]+);base64,/;

function readError(err) {
  if (/pixel limit/.test(err.message)) {
    return new Error('images can be at most ' + MAX_PIXELS / 1e6 + ' megapixels');
  }
  return new Error('Unsupported or corrupt image (' + err.message + ')');
}

// Whether a string looks like an image data URL (without decoding it).
exports.isImageDataUrl = (value) => typeof value === 'string' && DATA_URL.test(value);

// Resolves with { mime, width, height, data } where data is width * height * 4
// bytes of RGBA. mime is the format the result should be saved in: JPEGs stay
// JPEGs, and anything else (PNG, WebP, GIF, ...) becomes a PNG so transparency
// survives. Rejects if the data URL isn't an image sharp can decode.
exports.decodeDataUrl = function(dataUrl) {
  const match = DATA_URL.exec(dataUrl);
  if (!match) {
    return Promise.reject(new Error('Expected a base64 image data URL'));
  }
  const bytes = Buffer.from(dataUrl.slice(match[0].length), 'base64');

  const image = sharp(bytes, { limitInputPixels: MAX_PIXELS });
  return image.metadata()
    .then((meta) => {
      if (Math.max(meta.width, meta.height) > MAX_SIDE) {
        throw new Error('images can be at most ' + MAX_SIDE + ' pixels wide or tall');
      }
    }, (err) => {
      throw readError(err);
    })
    .then(() => image
      .rotate() // apply the EXIF orientation, so phone photos stay upright
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then((result) => ({
        mime: match[1] === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        width: result.info.width,
        height: result.info.height,
        data: result.data
      }), (err) => {
        throw readError(err);
      }));
};

// Inverse of decodeDataUrl.
exports.encodeDataUrl = function(image) {
  const pipeline = sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 }
  });
  const encoded = image.mime === 'image/jpeg' ?
    pipeline.jpeg({ quality: JPEG_QUALITY }) : pipeline.png();
  return encoded.toBuffer()
    .then((bytes) => 'data:' + image.mime + ';base64,' + bytes.toString('base64'));
};
