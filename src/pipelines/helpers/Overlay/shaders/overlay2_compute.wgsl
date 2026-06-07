@group(0) @binding(0) var tex_diff: texture_2d<f32>;
@group(0) @binding(1) var tex_origin: texture_2d<f32>;
@group(0) @binding(2) var tex_out: texture_storage_2d<rgba16float, write>;

@compute
@workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) pixel: vec3u) {
  let dim: vec2u = textureDimensions(tex_out);
  if (pixel.x >= dim.x || pixel.y >= dim.y) {
    return;
  }
  let color_origin: vec4f = textureLoad(tex_origin, pixel.xy, 0);
  let color_addon: vec4f = textureLoad(tex_diff, pixel.xy, 0);
  textureStore(tex_out, pixel.xy, clamp(color_origin + color_addon, vec4f(0.0), vec4f(1.0)));
}
