// Ratio-scaled downscale (compute).
//
// Two paths, selected from the actual input/output dimensions:
//
//  * Exact integer 2:1 (in == 2*out on both axes): a half-phase 4-tap Keys
//    cubic peaking kernel [-A, 0.5+A, 0.5+A, -A] (A = 0.10) with a
//    libplacebo-style anti-ringing clamp. At 2:1 the output sample sits exactly
//    between two source texels, so every interpolating low-pass (box, bilinear,
//    Lanczos) has its output-Nyquist response pinned near w0 ~= 0.5 (k(1)=0
//    lands on tap +-2). A small in-band peak is the only way to lift that band;
//    the clamp keeps step ringing at 0. H(0.5) is exactly 0, so the
//    input-Nyquist anti-aliasing null is preserved.
//
//  * Everything else: the ratio-scaled fractional-coverage box. Each output
//    texel covers the source rectangle [lo, hi) in source texel units (texel k
//    spans [k, k+1]); integer source texels overlapping that rectangle
//    contribute by their overlap fraction on each axis, so the filter is a true
//    area average at any ratio rather than a single phase-dependent bilinear
//    tap.
//
// All auto-downscale paths use per-axis ratios in (1.0, 1.67), i.e. < 2, so at
// most 3 source texels are touched per axis; the loops are dynamic so the
// filter stays correct for any ratio.
//
// Averaging happens in linear light because the input is sRGB-encoded (the
// renderer copies the video into a non-`-srgb` rgba16float texture). Filtering
// the encoded values directly would darken the result and reintroduce the
// aliasing this filter is meant to remove. Alpha is averaged linearly.

@group(0) @binding(0) var tex_in: texture_2d<f32>;
@group(0) @binding(1) var tex_out: texture_storage_2d<rgba16float, write>;

fn srgb_to_linear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, c <= vec3f(0.0031308));
}

// Half-phase 4-tap Keys cubic centered on `2*out + 0.5`: taps -1..2 with
// weights [-A, 0.5+A, 0.5+A, -A]. A = 0.10 yields output-Nyquist retention
// ~0.70 (vs ~0.49 for the box) with a ~7.8% unclamped step overshoot, which
// the anti-ringing clamp removes. A = 0.0625 is Catmull-Rom.
const A_SHARP: f32 = 0.10;
const W_SHARP: f32 = 0.5 + A_SHARP;

fn sharp_weight(o: i32) -> f32 {
  return select(W_SHARP, -A_SHARP, o == -1 || o == 2);
}

fn sharp2x(gid: vec2u, max_x: i32, max_y: i32) -> vec4f {
  let base = vec2i(i32(gid.x) * 2, i32(gid.y) * 2);

  var acc = vec3f(0.0);
  var acc_alpha = 0.0;
  var vmin = vec3f(1e30);
  var vmax = vec3f(-1e30);

  for (var j: i32 = -1; j <= 2; j = j + 1) {
    let wy = sharp_weight(j);
    for (var i: i32 = -1; i <= 2; i = i + 1) {
      let pixel = textureLoad(
        tex_in,
        vec2i(clamp(base.x + i, 0, max_x), clamp(base.y + j, 0, max_y)),
        0,
      );
      let lin = srgb_to_linear(pixel.rgb);
      vmin = min(vmin, lin);
      vmax = max(vmax, lin);
      let w = sharp_weight(i) * wy;
      acc = acc + lin * w;
      acc_alpha = acc_alpha + pixel.a * w;
    }
  }

  // Anti-ringing: keep the sharpened value inside the local tap range. On a
  // monotone step this forces overshoot/undershoot to 0; on a smooth grating
  // the clamp is inactive, so the passband gain is preserved. The clamp also
  // keeps `acc` non-negative, so `linear_to_srgb`'s pow is well-defined.
  acc = clamp(acc, vmin, vmax);
  return vec4f(linear_to_srgb(acc), acc_alpha);
}

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) gid: vec3u) {
  let out_dims = textureDimensions(tex_out);
  if (gid.x >= out_dims.x || gid.y >= out_dims.y) {
    return;
  }

  let in_dims = textureDimensions(tex_in);
  let max_x = i32(in_dims.x) - 1;
  let max_y = i32(in_dims.y) - 1;

  if (in_dims.x == 2u * out_dims.x && in_dims.y == 2u * out_dims.y) {
    textureStore(tex_out, gid.xy, sharp2x(gid.xy, max_x, max_y));
    return;
  }

  let in_size = vec2f(in_dims);
  let out_size = vec2f(out_dims);
  let ratio = in_size / out_size;

  // Continuous source-space center of this output texel and its footprint.
  let center = (vec2f(gid.xy) + vec2f(0.5)) * ratio;
  let lo = center - ratio * 0.5;
  let hi = center + ratio * 0.5;

  var acc = vec3f(0.0);
  var acc_alpha = 0.0;

  let kx0 = i32(floor(lo.x));
  let kx1 = min(i32(ceil(hi.x)) - 1, max_x);
  let ky0 = i32(floor(lo.y));
  let ky1 = min(i32(ceil(hi.y)) - 1, max_y);

  for (var ky = ky0; ky <= ky1; ky = ky + 1) {
    let wy = max(0.0, min(hi.y, f32(ky + 1)) - max(lo.y, f32(ky))) / ratio.y;
    if (wy <= 0.0) {
      continue;
    }
    for (var kx = kx0; kx <= kx1; kx = kx + 1) {
      let wx = max(0.0, min(hi.x, f32(kx + 1)) - max(lo.x, f32(kx))) / ratio.x;
      if (wx <= 0.0) {
        continue;
      }
      // Weights already sum to 1, so clamp-to-edge needs no renormalization.
      let pixel = textureLoad(tex_in, vec2i(clamp(kx, 0, max_x), clamp(ky, 0, max_y)), 0);
      let w = wx * wy;
      acc = acc + srgb_to_linear(pixel.rgb) * w;
      acc_alpha = acc_alpha + pixel.a * w;
    }
  }

  textureStore(tex_out, gid.xy, vec4f(linear_to_srgb(acc), acc_alpha));
}
