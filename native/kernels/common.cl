// Helpers shared by every kernel file. server/lib/gpu_filters.js concatenates
// this file first, then the others in alphabetical order, into one program.
//
// Conventions used throughout:
// - Images are RGBA, 8 bits per channel, stored row by row in a buffer.
// - Most kernels run one work-item per output pixel, with the global size
//   set to (width, height), and start with GUARD.
// - Colour maths is done in floats from 0 to 1.

#define PI 3.14159265358979f

// Declares x, y and i (the pixel index) and skips work-items outside the image.
#define GUARD \
  const int x = get_global_id(0); \
  const int y = get_global_id(1); \
  if (x >= width || y >= height) return; \
  const int i = y * width + x;

// For heavy kernels that may be launched in bands of rows (see `band` in
// native/omnifilter.cpp): their last argument, row0, is the band's first row.
#define GUARD_BAND \
  const int x = get_global_id(0); \
  const int y = get_global_id(1) + row0; \
  if (x >= width || y >= height) return; \
  const int i = y * width + x;

// Samplers for kernels that read images (textures). Coordinates are in
// pixels, with pixel centres at (x + 0.5, y + 0.5); reads past the edge
// return the nearest edge pixel. LINEAR makes the texture hardware blend the
// four nearest pixels (bilinear interpolation) for free.
const sampler_t LINEAR = CLK_NORMALIZED_COORDS_FALSE | CLK_ADDRESS_CLAMP_TO_EDGE | CLK_FILTER_LINEAR;
const sampler_t NEAREST = CLK_NORMALIZED_COORDS_FALSE | CLK_ADDRESS_CLAMP_TO_EDGE | CLK_FILTER_NEAREST;

float3 to_rgb(uchar4 p) {
  return convert_float3(p.xyz) * (1.0f / 255.0f);
}

uchar4 from_rgb(float3 c, uchar alpha) {
  return (uchar4)(convert_uchar3_sat_rte(c * 255.0f), alpha);
}

uchar4 from_rgba(float4 c) {
  return convert_uchar4_sat_rte(c * 255.0f);
}

// Rec. 709 luma: perceived brightness.
float luma(float3 c) {
  return dot(c, (float3)(0.2126f, 0.7152f, 0.0722f));
}

// Luma as an integer 0-255, for histograms.
int luma_bin(uchar4 p) {
  return clamp((int)(0.2126f * p.x + 0.7152f * p.y + 0.0722f * p.z + 0.5f), 0, 255);
}

// Reads a pixel, clamping coordinates to the image (extends the border).
uchar4 pixel_at(__global const uchar4 *img, int x, int y, int width, int height) {
  return img[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
}

float3 rgb_at(__global const uchar4 *img, int x, int y, int width, int height) {
  return to_rgb(pixel_at(img, x, y, width, height));
}

float3 hsv_to_rgb(float h, float s, float v) {
  float3 k = fmod((float3)(5.0f, 3.0f, 1.0f) + h * 6.0f, 6.0f);
  return v - v * s * clamp(min(k, 4.0f - k), 0.0f, 1.0f);
}

// Replaces the luma of a colour, keeping its chroma (via Y'CbCr, BT.709).
float3 with_luma(float3 c, float new_y) {
  float y = luma(c);
  float cb = (c.z - y) / 1.8556f;
  float cr = (c.x - y) / 1.5748f;
  float r = new_y + 1.5748f * cr;
  float b = new_y + 1.8556f * cb;
  float g = (new_y - 0.2126f * r - 0.0722f * b) / 0.7152f;
  return (float3)(r, g, b);
}

// A cheap, well-mixed integer hash for deterministic pseudo-randomness.
uint hash3(uint x, uint y, uint seed) {
  uint h = x * 374761393u + y * 668265263u + seed * 2246822519u;
  h = (h ^ (h >> 13)) * 1274126177u;
  return h ^ (h >> 16);
}
