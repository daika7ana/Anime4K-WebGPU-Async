@group(0) @binding(0) var tex_in: texture_2d<f32>; // final frame (post-enhancement)
@group(0) @binding(1) var tex_stats: texture_2d<f32>; // 5x5 local max luma stats
@group(0) @binding(2) var samp_stats: sampler;
@group(0) @binding(3) var tex_out: texture_storage_2d<rgba16float, write>; // output texture

// Function to calculate luminance
fn get_luma(rgba: vec4<f32>) -> f32 {
    return dot(rgba, vec4<f32>(0.299, 0.587, 0.114, 0.0));
}

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) pixel: vec3u) {
  // OOB check
  let dim_out: vec2u = textureDimensions(tex_out);
  if (pixel.x >= dim_out.x || pixel.y >= dim_out.y) {
    return;
  }

  // Input and output share dimensions; stats may be captured at a different
  // resolution, so sample them with normalized coordinates.
  let color: vec4f = textureLoad(tex_in, vec2u(pixel.x, pixel.y), 0);
  let luma: f32 = get_luma(color);
  let uv: vec2f = (vec2f(pixel.xy) + vec2f(0.5)) / vec2f(dim_out);
  let stats_luma: f32 = textureSampleLevel(tex_stats, samp_stats, uv, 0.0).x;
  let new_luma: f32 = min(luma, stats_luma);
  let luma_diff: f32 = luma - new_luma;
  let new_color: vec4f = color - vec4f(luma_diff, luma_diff, luma_diff, 0.0);

  textureStore(tex_out, vec2u(pixel.x, pixel.y), new_color);
}
