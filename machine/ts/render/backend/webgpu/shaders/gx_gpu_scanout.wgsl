struct ScanoutUniforms {
	display_start_word: u32,
	display_mode_word: u32,
	padding: vec2<u32>,
};

@group(0) @binding(0) var<uniform> u: ScanoutUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
	var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
	return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

fn displayStartX() -> u32 {
	return u.display_start_word & 0x3ffu;
}

fn displayStartY() -> u32 {
	return (u.display_start_word >> 10u) & 0x1ffu;
}

fn rawWordAtLogical(x: u32, y: u32) -> u32 {
	let rawPixel = textureLoad(u_vram, vec2<i32>(i32(x & 0x3ffu), i32(y & 0x1ffu)), 0);
	let lowByte = u32(rawPixel.r * 255.0 + 0.5);
	let highByte = u32(rawPixel.g * 255.0 + 0.5);
	return lowByte | (highByte << 8u);
}

fn rgb555ToRgb8(word: u32) -> vec3<f32> {
	let color5 = vec3<f32>(f32(word & 0x1fu), f32((word >> 5u) & 0x1fu), f32((word >> 10u) & 0x1fu));
	return color5 * 8.0 + floor(color5 / 4.0);
}

fn rgb888AtSourcePixel(sourceX: u32, sourceY: u32) -> vec3<f32> {
	let wordX = displayStartX() + ((sourceX * 3u) >> 1u);
	let word0 = rawWordAtLogical(wordX, sourceY);
	let word1 = rawWordAtLogical(wordX + 1u, sourceY);
	let low0 = f32(word0 & 0xffu);
	let high0 = f32(word0 >> 8u);
	let low1 = f32(word1 & 0xffu);
	let high1 = f32(word1 >> 8u);
	if ((sourceX & 1u) == 0u) {
		return vec3<f32>(low0, high0, low1);
	}
	return vec3<f32>(high0, low1, high1);
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
	let sourceX = u32(position.x);
	let sourceY = displayStartY() + u32(position.y);
	var rgb8: vec3<f32>;
	if ((u.display_mode_word & 0x10u) != 0u) {
		rgb8 = rgb888AtSourcePixel(sourceX, sourceY);
	} else {
		rgb8 = rgb555ToRgb8(rawWordAtLogical(displayStartX() + sourceX, sourceY));
	}
	return vec4<f32>(rgb8 / 255.0, 1.0);
}
