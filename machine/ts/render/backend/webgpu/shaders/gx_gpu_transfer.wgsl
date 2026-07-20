struct TransferUniforms {
	params: vec4<u32>,
	upload: vec4<u32>,
};

@group(0) @binding(0) var<uniform> u: TransferUniforms;
@group(0) @binding(1) var u_source: texture_2d<f32>;
@group(0) @binding(2) var u_vram: texture_2d<f32>;
@group(0) @binding(3) var u_sampler: sampler;

struct VSIn {
	@location(0) position: vec2<f32>,
	@location(1) sourceOffset: vec2<f32>,
};

struct VSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) @interpolate(flat) sourceOffset: vec2<i32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
	var out: VSOut;
	let clip = vec2<f32>((input.position.x / 512.0) - 1.0, 1.0 - (input.position.y / 512.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.sourceOffset = vec2<i32>(input.sourceOffset);
	return out;
}

fn rawWord(texture: texture_2d<f32>, coord: vec2<i32>) -> u32 {
	let rawPixel = textureLoad(texture, coord & vec2<i32>(1023), 0);
	let bytes = vec2<u32>(rawPixel.rg * vec2<f32>(255.0) + vec2<f32>(0.5));
	return bytes.x | (bytes.y << 8u);
}

fn rawUploadWord(destination: vec2<i32>) -> u32 {
	let logicalX = u32(destination.x - i32(u.upload.x)) & 1023u;
	let logicalY = u32(destination.y - i32(u.upload.y)) & (u.upload.w - 1u);
	let pixelIndex = logicalY * u.upload.z + logicalX;
	return rawWord(u_source, vec2<i32>(i32(pixelIndex & 1023u), i32(pixelIndex >> 10u)));
}

fn decodeRgb555To5(word: u32) -> vec3<u32> {
	return vec3<u32>(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
}

fn encodeRgb555(color5: vec3<u32>, outputMaskBit: u32) -> vec4<f32> {
	let word = color5.r | (color5.g << 5u) | (color5.b << 10u) | (outputMaskBit << 15u);
	return vec4<f32>(f32(word & 0xffu) / 255.0, f32(word >> 8u) / 255.0, 0.0, 1.0);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	let destination = vec2<i32>(input.position.xy);
	let sourceWord = rawWord(u_source, destination + input.sourceOffset);
	if (u.params.x != 0u && (rawWord(u_vram, destination) & 0x8000u) != 0u) { discard; }
	let outputMaskBit = select(sourceWord >> 15u, 1u, u.params.y != 0u);
	return encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}

@fragment
fn fs_cpu_upload(input: VSOut) -> @location(0) vec4<f32> {
	let destination = vec2<i32>(input.position.xy);
	let sourceWord = rawUploadWord(destination);
	if (u.params.x != 0u && (rawWord(u_vram, destination) & 0x8000u) != 0u) { discard; }
	let outputMaskBit = select(sourceWord >> 15u, 1u, u.params.y != 0u);
	return encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}
