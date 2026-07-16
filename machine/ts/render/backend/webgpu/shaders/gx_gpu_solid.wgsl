struct PrimitiveUniforms {
	params0: vec4<f32>,
	params1: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: PrimitiveUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

struct VSIn {
	@location(0) position: vec2<f32>,
	@location(1) color: vec4<f32>,
};

struct VSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) color: vec4<f32>,
	@location(1) @interpolate(flat) logicalRowOrigin: u32,
};

struct FixedVSIn {
	@location(0) position: vec2<f32>,
	@location(1) colorPlaneBase: vec3<u32>,
	@location(2) colorPlaneStepX: vec3<u32>,
	@location(3) colorPlaneStepY: vec3<u32>,
};

struct FixedVSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) @interpolate(flat) colorPlaneBase: vec3<u32>,
	@location(1) @interpolate(flat) colorPlaneStepX: vec3<u32>,
	@location(2) @interpolate(flat) colorPlaneStepY: vec3<u32>,
	@location(3) @interpolate(flat) logicalRowOrigin: u32,
};

const VRAM_SIZE = vec2<f32>(1024.0, 512.0);
const VRAM_ROW_COUNT = 512u;

@vertex
fn vs_main(input: VSIn, @builtin(instance_index) bandIndex: u32) -> VSOut {
	var out: VSOut;
	let logicalRowOrigin = bandIndex * VRAM_ROW_COUNT;
	let rasterPosition = input.position + vec2<f32>(0.5, 0.5 - f32(logicalRowOrigin));
	let clip = vec2<f32>((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.color = input.color;
	out.logicalRowOrigin = logicalRowOrigin;
	return out;
}

@vertex
fn vs_fixed(input: FixedVSIn, @builtin(instance_index) bandIndex: u32) -> FixedVSOut {
	var out: FixedVSOut;
	let logicalRowOrigin = bandIndex * VRAM_ROW_COUNT;
	let rasterPosition = input.position + vec2<f32>(0.5, 0.5 - f32(logicalRowOrigin));
	let clip = vec2<f32>((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.colorPlaneBase = input.colorPlaneBase;
	out.colorPlaneStepX = input.colorPlaneStepX;
	out.colorPlaneStepY = input.colorPlaneStepY;
	out.logicalRowOrigin = logicalRowOrigin;
	return out;
}

fn rawStorageVramWord(storageCoord: vec2<f32>) -> f32 {
	let wrapped = storageCoord - floor(storageCoord / VRAM_SIZE) * VRAM_SIZE;
	let rawPixel = textureSample(u_vram, u_sampler, (wrapped + vec2<f32>(0.5)) / VRAM_SIZE);
	let lowByte = floor(rawPixel.r * 255.0 + 0.5);
	let highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

fn decodeRgb555To5(word: f32) -> vec3<f32> {
	return vec3<f32>(
		word - floor(word / 32.0) * 32.0,
		floor(word / 32.0) - floor(word / 1024.0) * 32.0,
		floor(word / 1024.0) - floor(word / 32768.0) * 32.0,
	);
}

fn maskBit(word: f32) -> f32 {
	return floor(word / 32768.0);
}

fn blendRgb5(src5: vec3<f32>, dst5: vec3<f32>) -> vec3<f32> {
	let mode = u.params0.y;
	if (mode < 0.5) {
		return floor((src5 + dst5) * 0.5);
	}
	if (mode < 1.5) {
		return min(src5 + dst5, vec3<f32>(31.0));
	}
	if (mode < 2.5) {
		return max(dst5 - src5, vec3<f32>(0.0));
	}
	return min(dst5 + floor(src5 * 0.25), vec3<f32>(31.0));
}

fn ditherOffset(coord: vec2<f32>) -> f32 {
	let pixelCoord = floor(coord);
	let x = pixelCoord.x - floor(pixelCoord.x / 4.0) * 4.0;
	let y = pixelCoord.y - floor(pixelCoord.y / 4.0) * 4.0;
	if (y < 0.5) {
		if (x < 0.5) { return -4.0; }
		if (x < 1.5) { return 0.0; }
		if (x < 2.5) { return -3.0; }
		return 1.0;
	}
	if (y < 1.5) {
		if (x < 0.5) { return 2.0; }
		if (x < 1.5) { return -2.0; }
		if (x < 2.5) { return 3.0; }
		return -1.0;
	}
	if (y < 2.5) {
		if (x < 0.5) { return -3.0; }
		if (x < 1.5) { return 1.0; }
		if (x < 2.5) { return -4.0; }
		return 0.0;
	}
	if (x < 0.5) { return 3.0; }
	if (x < 1.5) { return -1.0; }
	if (x < 2.5) { return 2.0; }
	return -2.0;
}

fn rgb8ToRgb5(color8: vec3<f32>, fragCoord: vec2<f32>) -> vec3<f32> {
	var rgb8 = color8;
	if (u.params1.x > 0.5) {
		rgb8 = clamp(rgb8 + vec3<f32>(ditherOffset(vec2<f32>(fragCoord.x - 0.5, fragCoord.y - 0.5))), vec3<f32>(0.0), vec3<f32>(255.0));
	}
	return floor(rgb8 / 8.0);
}

fn encodeRgb555(color5: vec3<f32>, outputMaskBit: f32) -> vec4<f32> {
	let lowByte = (color5.r + color5.g * 32.0) - floor((color5.r + color5.g * 32.0) / 256.0) * 256.0;
	let highByte = floor(color5.g / 8.0) + color5.b * 4.0 + outputMaskBit * 128.0;
	return vec4<f32>(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}

fn activeInterlacedLine(fragCoord: vec2<f32>) -> bool {
	if ((u.params1.y - floor(u.params1.y / 2.0) * 2.0) < 0.5) {
		return false;
	}
	let activeLineLsb = floor(u.params1.y * 0.5) - floor(floor(u.params1.y * 0.5) / 2.0) * 2.0;
	let vramY = floor(fragCoord.y);
	return (vramY - floor(vramY / 2.0) * 2.0) == activeLineLsb;
}

fn shadeSolid(color8: vec3<f32>, fragCoord: vec2<f32>) -> vec4<f32> {
	if (activeInterlacedLine(fragCoord)) {
		discard;
	}
	var src5 = rgb8ToRgb5(color8, fragCoord);
	var dstWord = 0.0;
	if (u.params0.z > 0.5 || u.params0.x > 0.5) {
		dstWord = rawStorageVramWord(fragCoord - vec2<f32>(0.5));
		if (u.params0.z > 0.5 && maskBit(dstWord) > 0.5) {
			discard;
		}
		if (u.params0.x > 0.5) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	return encodeRgb555(src5, u.params0.w);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	let logicalFragCoord = input.position.xy + vec2<f32>(0.0, f32(input.logicalRowOrigin));
	return shadeSolid(floor(input.color.rgb * 255.0), logicalFragCoord);
}

@fragment
fn fs_fixed(input: FixedVSOut) -> @location(0) vec4<f32> {
	let logicalFragCoord = input.position.xy + vec2<f32>(0.0, f32(input.logicalRowOrigin));
	let pixel = vec2<u32>(u32(logicalFragCoord.x), u32(logicalFragCoord.y));
	let accumulator = input.colorPlaneBase + input.colorPlaneStepX * pixel.x + input.colorPlaneStepY * pixel.y;
	let color8 = vec3<f32>((accumulator >> vec3<u32>(12u)) & vec3<u32>(0xffu));
	return shadeSolid(color8, logicalFragCoord);
}
