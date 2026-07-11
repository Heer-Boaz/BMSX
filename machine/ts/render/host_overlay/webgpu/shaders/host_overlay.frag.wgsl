@group(0) @binding(1) var host_atlas: texture_2d<f32>;
@group(0) @binding(2) var host_sampler: sampler;

struct FragmentInput {
	@location(0) texcoord: vec2<f32>,
	@location(1) color: vec4<f32>,
	@location(2) @interpolate(flat) texture_kind: u32,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
	var texel = vec4<f32>(1.0);
	if (input.texture_kind != 0u) {
		texel = textureSampleLevel(host_atlas, host_sampler, input.texcoord, 0.0);
	}
	return texel * input.color;
}
