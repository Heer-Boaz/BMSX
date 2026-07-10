struct PrimitiveUniforms {
	params0: vec4<f32>,
	params1: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: PrimitiveUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

struct VSIn {
	@location(0) position: vec2<f32>,
	@location(1) lineStart: vec2<f32>,
	@location(2) lineEnd: vec2<f32>,
	@location(3) color0: vec3<f32>,
	@location(4) color1: vec3<f32>,
};

struct VSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) lineStart: vec2<f32>,
	@location(1) lineEnd: vec2<f32>,
	@location(2) colorBase: vec3<f32>,
	@location(3) colorStep: vec3<f32>,
};

const VRAM_SIZE = vec2<f32>(1024.0, 512.0);

@vertex
fn vs_main(input: VSIn) -> VSOut {
	var out: VSOut;
	let clip = vec2<f32>((input.position.x / 512.0) - 1.0, 1.0 - (input.position.y / 256.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.lineStart = input.lineStart;
	out.lineEnd = input.lineEnd;
	let color0 = floor(input.color0 * 255.0 + 0.5);
	let colorDelta = floor(input.color1 * 255.0 + 0.5) - color0;
	let steps = max(abs(input.lineEnd.x - input.lineStart.x), abs(input.lineEnd.y - input.lineStart.y));
	out.colorBase = color0 * 4096.0 + 2048.0;
	out.colorStep = vec3<f32>(0.0);
	if (steps > 0.0) {
		out.colorStep = sign(colorDelta) * floor(abs(colorDelta) * 4096.0 / steps);
	}
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
	return vec3<f32>(word - floor(word / 32.0) * 32.0, floor(word / 32.0) - floor(word / 1024.0) * 32.0, floor(word / 1024.0) - floor(word / 32768.0) * 32.0);
}

fn maskBit(word: f32) -> f32 { return floor(word / 32768.0); }

fn blendRgb5(src5: vec3<f32>, dst5: vec3<f32>) -> vec3<f32> {
	let mode = u.params0.y;
	if (mode < 0.5) { return floor((src5 + dst5) * 0.5); }
	if (mode < 1.5) { return min(src5 + dst5, vec3<f32>(31.0)); }
	if (mode < 2.5) { return max(dst5 - src5, vec3<f32>(0.0)); }
	return min(dst5 + floor(src5 * 0.25), vec3<f32>(31.0));
}

fn ditherOffset(coord: vec2<f32>) -> f32 {
	let pixelCoord = floor(coord);
	let x = pixelCoord.x - floor(pixelCoord.x / 4.0) * 4.0;
	let y = pixelCoord.y - floor(pixelCoord.y / 4.0) * 4.0;
	if (y < 0.5) { if (x < 0.5) { return -4.0; } if (x < 1.5) { return 0.0; } if (x < 2.5) { return -3.0; } return 1.0; }
	if (y < 1.5) { if (x < 0.5) { return 2.0; } if (x < 1.5) { return -2.0; } if (x < 2.5) { return 3.0; } return -1.0; }
	if (y < 2.5) { if (x < 0.5) { return -3.0; } if (x < 1.5) { return 1.0; } if (x < 2.5) { return -4.0; } return 0.0; }
	if (x < 0.5) { return 3.0; } if (x < 1.5) { return -1.0; } if (x < 2.5) { return 2.0; } return -2.0;
}

fn rgbToRgb5(rgb: vec3<f32>, fragCoord: vec2<f32>) -> vec3<f32> {
	var rgb8 = rgb;
	if (u.params1.x > 0.5) { rgb8 = clamp(rgb8 + vec3<f32>(ditherOffset(vec2<f32>(fragCoord.x - 0.5, fragCoord.y - 0.5))), vec3<f32>(0.0), vec3<f32>(255.0)); }
	return floor(rgb8 / 8.0);
}

fn encodeRgb555(color5: vec3<f32>, outputMaskBit: f32) -> vec4<f32> {
	let packedLow = color5.r + color5.g * 32.0;
	let lowByte = packedLow - floor(packedLow / 256.0) * 256.0;
	let highByte = floor(color5.g / 8.0) + color5.b * 4.0 + outputMaskBit * 128.0;
	return vec4<f32>(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}

fn activeInterlacedLine(fragCoord: vec2<f32>) -> bool {
	if ((u.params1.y - floor(u.params1.y / 2.0) * 2.0) < 0.5) { return false; }
	let activeLineLsb = floor(u.params1.y * 0.5) - floor(floor(u.params1.y * 0.5) / 2.0) * 2.0;
	let vramY = floor(fragCoord.y);
	return (vramY - floor(vramY / 2.0) * 2.0) == activeLineLsb;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	if (activeInterlacedLine(input.position.xy)) { discard; }
	let pixelCoord = vec2<i32>(floor(input.position.xy - vec2<f32>(0.5)));
	let lineStart = vec2<i32>(input.lineStart);
	let delta = vec2<i32>(input.lineEnd) - lineStart;
	let absDelta = abs(delta);
	let steps = max(absDelta.x, absDelta.y);
	var stepIndex: i32 = 0;
	if (steps == 0) {
		if (any(pixelCoord != lineStart)) { discard; }
	} else if (absDelta.x >= absDelta.y) {
		stepIndex = pixelCoord.x - lineStart.x;
		if (stepIndex < 0 || stepIndex > steps) { discard; }
		let yDistance = (2 * stepIndex * absDelta.y + steps) / (2 * steps);
		let expectedY = lineStart.y + select(yDistance, -yDistance, delta.y < 0);
		if (pixelCoord.y != expectedY) { discard; }
	} else {
		stepIndex = select(pixelCoord.y - lineStart.y, lineStart.y - pixelCoord.y, delta.y < 0);
		if (stepIndex < 0 || stepIndex > steps) { discard; }
		let xDistance = (2 * stepIndex * delta.x + steps - 1) / (2 * steps);
		if (pixelCoord.x != lineStart.x + xDistance) { discard; }
	}
	let rgb8 = floor((input.colorBase + f32(stepIndex) * input.colorStep) / 4096.0);
	var src5 = rgbToRgb5(rgb8, input.position.xy);
	var dstWord = 0.0;
	if (u.params0.z > 0.5 || u.params0.x > 0.5) {
		dstWord = rawStorageVramWord(input.position.xy - vec2<f32>(0.5));
		if (u.params0.z > 0.5 && maskBit(dstWord) > 0.5) { discard; }
		if (u.params0.x > 0.5) { src5 = blendRgb5(src5, decodeRgb555To5(dstWord)); }
	}
	return encodeRgb555(src5, u.params0.w);
}
