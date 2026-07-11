struct ScanoutUniforms {
	display_rect: vec4<f32>,
	params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: ScanoutUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

struct VSOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
const VRAM_SIZE = vec2<f32>(1024.0, 512.0);

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
	var positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
	var out: VSOut;
	out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
	out.uv = out.position.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
	return out;
}

fn rawWordFromPixel(rawPixel: vec4<f32>) -> f32 {
	let lowByte = floor(rawPixel.r * 255.0 + 0.5);
	let highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

fn rawWordAtLogical(x: f32, y: f32) -> f32 {
	let vramCoord = vec2<f32>(x - floor(x / VRAM_SIZE.x) * VRAM_SIZE.x, y - floor(y / VRAM_SIZE.y) * VRAM_SIZE.y);
	return rawWordFromPixel(textureLoad(u_vram, vec2<i32>(i32(vramCoord.x), i32(vramCoord.y)), 0));
}

fn rgb555ToRgb8(word: f32) -> vec3<f32> {
	let lowByte = word - floor(word / 256.0) * 256.0;
	let highByte = floor(word / 256.0);
	let r5 = lowByte - floor(lowByte / 32.0) * 32.0;
	let g5 = floor(lowByte / 32.0) + (highByte - floor(highByte / 4.0) * 4.0) * 8.0;
	let b5 = floor(highByte / 4.0) - floor(floor(highByte / 4.0) / 32.0) * 32.0;
	let color5 = vec3<f32>(r5, g5, b5);
	return color5 * 8.0 + floor(color5 / 4.0);
}

fn rgb888AtSourcePixel(sourceX: f32, sourceY: f32) -> vec3<f32> {
	let scaledWordX = sourceX * 1.5;
	let wordX = u.display_rect.x + sign(scaledWordX) * floor(abs(scaledWordX));
	let word0 = rawWordAtLogical(wordX, sourceY);
	let word1 = rawWordAtLogical(wordX + 1.0, sourceY);
	let low0 = word0 - floor(word0 / 256.0) * 256.0;
	let high0 = floor(word0 / 256.0);
	let low1 = word1 - floor(word1 / 256.0) * 256.0;
	let high1 = floor(word1 / 256.0);
	if ((sourceX - floor(sourceX / 2.0) * 2.0) < 0.5) {
		return vec3<f32>(low0, high0, low1);
	}
	return vec3<f32>(high0, low1, high1);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	let scaledX = input.uv.x * u.display_rect.z;
	let scaledY = input.uv.y * u.display_rect.w;
	let sourceX = sign(scaledX) * floor(abs(scaledX));
	let sourceY = u.display_rect.y + sign(scaledY) * floor(abs(scaledY));
	var rgb8: vec3<f32>;
	if (u.params.x > 0.5) {
		rgb8 = rgb888AtSourcePixel(sourceX, sourceY);
	} else {
		rgb8 = rgb555ToRgb8(rawWordAtLogical(u.display_rect.x + sourceX, sourceY));
	}
	return vec4<f32>(rgb8 / 255.0, 1.0);
}
