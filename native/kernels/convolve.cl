// Convolution: each output pixel is a weighted sum of its neighbours.
//
// Blur, sharpen, emboss and edge detection are all just different weight
// matrices, built on the JS side (server/lib/filters). A separable filter like
// a Gaussian blur runs as two passes: a (k x 1) row kernel then a (1 x k)
// column kernel, which is far cheaper than a single (k x k) pass.
//
// Edges are handled by clamping sample coordinates (the border pixels are
// extended outwards), so no work-item ever reads outside the image.
// bias is added after weighting (e.g. 128 for emboss, so flat areas are grey);
// with absolute set, the magnitude of the result is used (for edge detection,
// where the sum can be negative). The alpha channel is passed through.
__kernel void convolve(__global const uchar4 *src,
                       __global uchar4 *dst,
                       const int width,
                       const int height,
                       __global const float *weights,
                       const int kw,
                       const int kh,
                       const float bias,
                       const int absolute,
                       const int row0)
{
  GUARD_BAND;
  const int rx = kw / 2;
  const int ry = kh / 2;
  float3 acc = (float3)(0.0f, 0.0f, 0.0f);

  for (int j = 0; j < kh; j++) {
    const int sy = clamp(y + j - ry, 0, height - 1);
    for (int k = 0; k < kw; k++) {
      const int sx = clamp(x + k - rx, 0, width - 1);
      acc += convert_float3(src[sy * width + sx].xyz) * weights[j * kw + k];
    }
  }

  if (absolute) acc = fabs(acc);
  acc += bias;
  dst[i] = (uchar4)(convert_uchar3_sat_rte(acc), src[i].w);
}

// The same convolution over float4 buffers, used to smooth the structure
// tensor in the oil paint filter.
__kernel void convolve_f4(__global const float4 *src,
                          __global float4 *dst,
                          const int width,
                          const int height,
                          __global const float *weights,
                          const int kw,
                          const int kh)
{
  GUARD;
  const int rx = kw / 2;
  const int ry = kh / 2;
  float4 acc = (float4)(0.0f);
  for (int j = 0; j < kh; j++) {
    const int sy = clamp(y + j - ry, 0, height - 1);
    for (int k = 0; k < kw; k++) {
      const int sx = clamp(x + k - rx, 0, width - 1);
      acc += src[sy * width + sx] * weights[j * kw + k];
    }
  }
  dst[i] = acc;
}

// Unsharp mask: boosts the difference between the image and a blurred copy of
// it. threshold skips low-contrast detail (so noise isn't sharpened).
__kernel void unsharp(__global const uchar4 *src,
                      __global const uchar4 *blurred,
                      __global uchar4 *dst,
                      const int width,
                      const int height,
                      const float amount,
                      const float threshold)
{
  GUARD;
  const float3 s = to_rgb(src[i]);
  const float3 diff = s - to_rgb(blurred[i]);
  const float mask = threshold > 0.0f ? smoothstep(threshold * 0.5f, threshold, fabs(luma(diff))) : 1.0f;
  dst[i] = from_rgb(s + amount * mask * diff, src[i].w);
}

// Motion blur: averages samples along a line through each pixel. Reading
// from an image lets the texture hardware interpolate between pixels, so the
// line can point in any direction.
__kernel void motion_blur(read_only image2d_t src,
                          __global uchar4 *dst,
                          const int width,
                          const int height,
                          const float dx,
                          const float dy,
                          const int samples)
{
  GUARD;
  const float2 p = (float2)(x + 0.5f, y + 0.5f);
  const float2 d = (float2)(dx, dy);
  float4 acc = (float4)(0.0f);
  for (int s = 0; s < samples; s++) {
    const float t = samples > 1 ? (float)s / (samples - 1) - 0.5f : 0.0f;
    acc += read_imagef(src, LINEAR, p + t * d);
  }
  dst[i] = from_rgba(acc / samples);
}

// Tilt-shift: keeps a horizontal band sharp and blurs progressively above and
// below it, with boosted saturation, so scenes look like miniature models.
__kernel void tilt_shift(__global const uchar4 *src,
                         __global const uchar4 *blur1,
                         __global const uchar4 *blur2,
                         __global uchar4 *dst,
                         const int width,
                         const int height,
                         const float focus,
                         const float band,
                         const float transition,
                         const float saturation)
{
  GUARD;
  const float ny = (y + 0.5f) / height;
  const float m = smoothstep(0.0f, 1.0f, clamp((fabs(ny - focus) - band) / transition, 0.0f, 1.0f));
  const float3 s = to_rgb(src[i]);
  const float3 b1 = to_rgb(blur1[i]);
  const float3 b2 = to_rgb(blur2[i]);
  float3 c = m < 0.5f ? mix(s, b1, m * 2.0f) : mix(b1, b2, m * 2.0f - 1.0f);
  const float l = luma(c);
  c = l + (c - l) * saturation;
  dst[i] = from_rgb(c, src[i].w);
}
