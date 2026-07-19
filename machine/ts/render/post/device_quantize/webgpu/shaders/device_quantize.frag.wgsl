@group(0) @binding(0) var u_texture: texture_2d<f32>;
@group(0) @binding(1) var u_quantize_lut: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

const BAYER_4X4 = array<u32, 16>(
	0u, 8u, 2u, 10u,
	12u, 4u, 14u, 6u,
	3u, 11u, 1u, 9u,
	15u, 7u, 13u, 5u,
);

fn bayer4x4Raw(pixel: vec2<u32>) -> u32 {
	let index = (pixel.x & 3u) | ((pixel.y & 3u) << 2u);
	return BAYER_4X4[index];
}

@fragment
fn main(@builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
	let logicalPixel = vec2<u32>(position.xy);
	let threshold = i32(bayer4x4Raw(logicalPixel));
	let color = textureSample(u_texture, u_sampler, uv).rgb;
	let inputByte = vec3<i32>(color * 255.0 + vec3<f32>(0.5));
	return vec4<f32>(
		textureLoad(u_quantize_lut, vec2<i32>(inputByte.r, threshold), 0).r,
		textureLoad(u_quantize_lut, vec2<i32>(inputByte.g, threshold), 0).g,
		textureLoad(u_quantize_lut, vec2<i32>(inputByte.b, threshold), 0).b,
		1.0,
	);
}
