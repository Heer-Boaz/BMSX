@group(0) @binding(1) var host_atlas: texture_2d<f32>;
@group(0) @binding(2) var host_sampler: sampler;
@group(0) @binding(3) var glyph_sampler: sampler;
@group(1) @binding(0) var frame_texture: texture_2d<f32>;

struct FragmentInput {
	@location(0) texcoord: vec2<f32>,
	@location(1) color: vec4<f32>,
	@location(2) @interpolate(flat) texture_kind: u32,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
	var texel = vec4<f32>(1.0);
	if (input.texture_kind == 1u) {
		texel = textureSampleLevel(host_atlas, host_sampler, input.texcoord, 0.0);
	}
	if (input.texture_kind == 2u) {
		texel = vec4<f32>(textureSampleLevel(frame_texture, host_sampler, input.texcoord, 0.0).rgb, 1.0);
	}
	if (input.texture_kind == 3u) {
		texel = textureSampleLevel(frame_texture, host_sampler, input.texcoord, 0.0);
	}
	if (input.texture_kind == 5u) {
		texel = vec4<f32>(1.0, 1.0, 1.0, textureSampleLevel(host_atlas, glyph_sampler, input.texcoord, 0.0).a);
	}
	if (input.texture_kind == 4u) {
		texel = textureSampleLevel(frame_texture, host_sampler, input.texcoord, 0.0);
		if (texel.a > 0.0) { texel = vec4<f32>(texel.rgb / texel.a, texel.a); }
	}
	return texel * input.color;
}
