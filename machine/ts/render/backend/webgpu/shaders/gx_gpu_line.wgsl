struct PrimitiveUniforms {
	blendEnabled: u32,
	blendMode: u32,
	checkMaskBit: u32,
	setMaskBit: u32,
	ditherEnabled: u32,
	skippedLineParity: u32,
	rasterPhase: f32,
	destinationYBase: u32,
};

override gxGpuVramXAddressPeriod: u32;
override gxGpuVramYAddressPeriod: u32;
override gxGpuVramTextureRowMask: i32;

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
	@location(0) @interpolate(flat) lineStart: vec2<i32>,
	@location(1) @interpolate(flat) lineEnd: vec2<i32>,
	@location(2) @interpolate(flat) colorBase: vec3<i32>,
	@location(3) @interpolate(flat) colorStep: vec3<i32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
	var out: VSOut;
	let clip = vec2<f32>(
		(input.position.x / (f32(gxGpuVramXAddressPeriod) * 0.5)) - 1.0,
		1.0 - (input.position.y / (f32(gxGpuVramYAddressPeriod) * 0.5)));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.lineStart = vec2<i32>(input.lineStart);
	out.lineEnd = vec2<i32>(input.lineEnd);
	let color0 = vec3<i32>(input.color0 * vec3<f32>(255.0) + vec3<f32>(0.5));
	let colorDelta = vec3<i32>(input.color1 * vec3<f32>(255.0) + vec3<f32>(0.5)) - color0;
	let delta = out.lineEnd - out.lineStart;
	let steps = max(abs(delta.x), abs(delta.y));
	out.colorBase = color0 * 4096 + vec3<i32>(2048);
	out.colorStep = vec3<i32>(0);
	if (steps > 0) {
		out.colorStep = sign(colorDelta) * (abs(colorDelta) * vec3<i32>(4096) / vec3<i32>(steps));
	}
	return out;
}

fn rawVramWord(coord: vec2<i32>) -> u32 {
	let rawPixel = textureLoad(u_vram, coord & vec2<i32>(i32(gxGpuVramXAddressPeriod - 1u), gxGpuVramTextureRowMask), 0);
	let bytes = vec2<u32>(rawPixel.rg * vec2<f32>(255.0) + vec2<f32>(0.5));
	return bytes.x | (bytes.y << 8u);
}

fn decodeRgb555To5(word: u32) -> vec3<u32> {
	return vec3<u32>(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
}

fn blendRgb5(src5: vec3<u32>, dst5: vec3<u32>) -> vec3<u32> {
	switch u.blendMode {
		case 0u: { return (src5 + dst5) >> vec3<u32>(1u); }
		case 1u: { return min(src5 + dst5, vec3<u32>(31u)); }
		case 2u: { return vec3<u32>(max(vec3<i32>(dst5) - vec3<i32>(src5), vec3<i32>(0))); }
		default: { return min(dst5 + (src5 >> vec3<u32>(2u)), vec3<u32>(31u)); }
	}
}

fn ditherOffset(coord: vec2<u32>) -> i32 {
	switch ((coord.y & 3u) << 2u) | (coord.x & 3u) {
		case 0u: { return -4; }
		case 1u: { return 0; }
		case 2u: { return -3; }
		case 3u: { return 1; }
		case 4u: { return 2; }
		case 5u: { return -2; }
		case 6u: { return 3; }
		case 7u: { return -1; }
		case 8u: { return -3; }
		case 9u: { return 1; }
		case 10u: { return -4; }
		case 11u: { return 0; }
		case 12u: { return 3; }
		case 13u: { return -1; }
		case 14u: { return 2; }
		default: { return -2; }
	}
}

fn rgb8ToRgb5(color8: vec3<u32>, fragCoord: vec2<u32>) -> vec3<u32> {
	if (u.ditherEnabled == 0u) {
		return color8 >> vec3<u32>(3u);
	}
	let dithered = clamp(vec3<i32>(color8) + vec3<i32>(ditherOffset(fragCoord)), vec3<i32>(0), vec3<i32>(255));
	return vec3<u32>(dithered) >> vec3<u32>(3u);
}

fn encodeRgb555(color5: vec3<u32>, outputMaskBit: u32) -> vec4<f32> {
	let word = color5.r | (color5.g << 5u) | (color5.b << 10u) | (outputMaskBit << 15u);
	return vec4<f32>(f32(word & 0xffu) / 255.0, f32(word >> 8u) / 255.0, 0.0, 1.0);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	let fragCoord = vec2<u32>(input.position.xy) + vec2<u32>(0u, u.destinationYBase);
	if ((fragCoord.y & 1u) == u.skippedLineParity) {
		discard;
	}
	let pixelCoord = vec2<i32>(input.position.xy - vec2<f32>(0.5)) + vec2<i32>(0, i32(u.destinationYBase));
	let delta = input.lineEnd - input.lineStart;
	let absDelta = abs(delta);
	let steps = max(absDelta.x, absDelta.y);
	var stepIndex = 0;
	if (steps == 0) {
		if (any(pixelCoord != input.lineStart)) { discard; }
	} else if (absDelta.x >= absDelta.y) {
		stepIndex = pixelCoord.x - input.lineStart.x;
		if (stepIndex < 0 || stepIndex > steps) { discard; }
		let yDistance = (2 * stepIndex * absDelta.y + steps) / (2 * steps);
		let expectedY = input.lineStart.y + select(yDistance, -yDistance, delta.y < 0);
		if (pixelCoord.y != expectedY) { discard; }
	} else {
		stepIndex = select(pixelCoord.y - input.lineStart.y, input.lineStart.y - pixelCoord.y, delta.y < 0);
		if (stepIndex < 0 || stepIndex > steps) { discard; }
		let xDistance = (2 * stepIndex * delta.x + steps - 1) / (2 * steps);
		if (pixelCoord.x != input.lineStart.x + xDistance) { discard; }
	}
	let color8 = vec3<u32>((input.colorBase + vec3<i32>(stepIndex) * input.colorStep) / vec3<i32>(4096));
	var src5 = rgb8ToRgb5(color8, fragCoord);
	if (u.checkMaskBit != 0u || u.blendEnabled != 0u) {
		let dstWord = rawVramWord(vec2<i32>(fragCoord));
		if (u.checkMaskBit != 0u && (dstWord & 0x8000u) != 0u) { discard; }
		if (u.blendEnabled != 0u) { src5 = blendRgb5(src5, decodeRgb555To5(dstWord)); }
	}
	return encodeRgb555(src5, u.setMaskBit);
}
