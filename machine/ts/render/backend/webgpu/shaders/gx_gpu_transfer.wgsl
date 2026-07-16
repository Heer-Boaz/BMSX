struct TransferUniforms {
	params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: TransferUniforms;
@group(0) @binding(1) var u_source: texture_2d<f32>;
@group(0) @binding(2) var u_vram: texture_2d<f32>;
@group(0) @binding(3) var u_sampler: sampler;

struct VSIn { @location(0) position: vec2<f32>, @location(1) texcoord: vec2<f32> };
struct VSOut { @builtin(position) position: vec4<f32>, @location(0) texcoord: vec2<f32> };
const VRAM_SIZE = vec2<f32>(1024.0, 512.0);

@vertex
fn vs_main(input: VSIn) -> VSOut {
	var out: VSOut;
	let clip = vec2<f32>((input.position.x / 512.0) - 1.0, 1.0 - (input.position.y / 256.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	// Transfer vertices carry texel edges; compensate raster pixel-center interpolation.
	out.texcoord = input.texcoord - vec2<f32>(0.5);
	return out;
}

fn rawSourceLogicalWord(logicalCoord: vec2<f32>) -> f32 {
	let wrapped = logicalCoord - floor(logicalCoord / VRAM_SIZE) * VRAM_SIZE;
	let rawPixel = textureSample(u_source, u_sampler, (wrapped + vec2<f32>(0.5)) / VRAM_SIZE);
	let lowByte = floor(rawPixel.r * 255.0 + 0.5);
	let highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

fn rawVramStorageWord(storageCoord: vec2<f32>) -> f32 {
	let wrapped = storageCoord - floor(storageCoord / VRAM_SIZE) * VRAM_SIZE;
	let rawPixel = textureSample(u_vram, u_sampler, (wrapped + vec2<f32>(0.5)) / VRAM_SIZE);
	let lowByte = floor(rawPixel.r * 255.0 + 0.5);
	let highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

fn decodeRgb555To5(word: f32) -> vec3<f32> {
	return vec3<f32>(word - floor(word / 32.0) * 32.0, floor(word / 32.0) - floor(word / 1024.0) * 32.0, floor(word / 1024.0) - floor(word / 32768.0) * 32.0);
}
fn wordMaskBit(word: f32) -> f32 { return floor(word / 32768.0); }
fn encodeRgb555(color5: vec3<f32>, outputMaskBit: f32) -> vec4<f32> {
	let packedLow = color5.r + color5.g * 32.0;
	let lowByte = packedLow - floor(packedLow / 256.0) * 256.0;
	let highByte = floor(color5.g / 8.0) + color5.b * 4.0 + outputMaskBit * 128.0;
	return vec4<f32>(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	let sourceWord = rawSourceLogicalWord(input.texcoord);
	if (u.params.x > 0.5) {
		let dstWord = rawVramStorageWord(input.position.xy - vec2<f32>(0.5));
		if (wordMaskBit(dstWord) > 0.5) { discard; }
	}
	let outputMaskBit = select(wordMaskBit(sourceWord), 1.0, u.params.y > 0.5);
	return encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}
