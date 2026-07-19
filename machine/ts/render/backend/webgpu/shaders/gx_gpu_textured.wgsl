struct TexturedUniforms {
	texPageClut: vec4<u32>,
	textureWindow: vec4<u32>,
	params0: vec4<u32>,
	params1: vec4<u32>,
	rasterPhase: f32,
	_padding0: u32,
	_padding1: u32,
	_padding2: u32,
};

@group(0) @binding(0) var<uniform> u: TexturedUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

struct VSIn {
	@location(0) position: vec2<f32>,
	@location(1) color: vec3<f32>,
	@location(2) uvPlaneBase: vec2<u32>,
	@location(3) uvPlaneStepX: vec2<u32>,
	@location(4) uvPlaneStepY: vec2<u32>,
};

struct VSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) color: vec3<f32>,
	@location(1) @interpolate(flat) uvPlaneBase: vec2<u32>,
	@location(2) @interpolate(flat) uvPlaneStepX: vec2<u32>,
	@location(3) @interpolate(flat) uvPlaneStepY: vec2<u32>,
};

struct FixedVSIn {
	@location(0) position: vec2<f32>,
	@location(1) uvPlaneBase: vec2<u32>,
	@location(2) uvPlaneStepX: vec2<u32>,
	@location(3) uvPlaneStepY: vec2<u32>,
	@location(4) colorPlaneBase: vec3<u32>,
	@location(5) colorPlaneStepX: vec3<u32>,
	@location(6) colorPlaneStepY: vec3<u32>,
};

struct FixedVSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) @interpolate(flat) uvPlaneBase: vec2<u32>,
	@location(1) @interpolate(flat) uvPlaneStepX: vec2<u32>,
	@location(2) @interpolate(flat) uvPlaneStepY: vec2<u32>,
	@location(3) @interpolate(flat) colorPlaneBase: vec3<u32>,
	@location(4) @interpolate(flat) colorPlaneStepX: vec3<u32>,
	@location(5) @interpolate(flat) colorPlaneStepY: vec3<u32>,
};

struct TextureColor {
	rgb5: vec3<u32>,
	maskBit: u32,
	transparent: bool,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
	var out: VSOut;
	let rasterPosition = input.position + vec2<f32>(u.rasterPhase);
	let clip = vec2<f32>((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 512.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.color = input.color;
	out.uvPlaneBase = input.uvPlaneBase;
	out.uvPlaneStepX = input.uvPlaneStepX;
	out.uvPlaneStepY = input.uvPlaneStepY;
	return out;
}

@vertex
fn vs_fixed(input: FixedVSIn) -> FixedVSOut {
	var out: FixedVSOut;
	let rasterPosition = input.position + vec2<f32>(u.rasterPhase);
	let clip = vec2<f32>((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 512.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.uvPlaneBase = input.uvPlaneBase;
	out.uvPlaneStepX = input.uvPlaneStepX;
	out.uvPlaneStepY = input.uvPlaneStepY;
	out.colorPlaneBase = input.colorPlaneBase;
	out.colorPlaneStepX = input.colorPlaneStepX;
	out.colorPlaneStepY = input.colorPlaneStepY;
	return out;
}

fn rawVramWord(coord: vec2<u32>) -> u32 {
	let rawPixel = textureLoad(u_vram, vec2<i32>(coord & vec2<u32>(1023u)), 0);
	let bytes = vec2<u32>(rawPixel.rg * vec2<f32>(255.0) + vec2<f32>(0.5));
	return bytes.x | (bytes.y << 8u);
}

fn decodeRgb555To5(word: u32) -> vec3<u32> {
	return vec3<u32>(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
}

fn polygonTexcoord(fragCoord: vec2<u32>, uvPlaneBase: vec2<u32>, uvPlaneStepX: vec2<u32>, uvPlaneStepY: vec2<u32>) -> vec2<u32> {
	let accumulator = uvPlaneBase + uvPlaneStepX * fragCoord.x + uvPlaneStepY * fragCoord.y;
	return (accumulator >> vec2<u32>(12u)) & vec2<u32>(0xffu);
}

fn samplePsxTexture(sampleCoord: vec2<u32>) -> TextureColor {
	let windowed = (sampleCoord & u.textureWindow.xy) | u.textureWindow.zw;
	let pageBase = u.texPageClut.xy;
	let clutBase = u.texPageClut.zw;
	var textureWord: u32;
	if (u.params0.x == 0u) {
		textureWord = rawVramWord(vec2<u32>(pageBase.x + (windowed.x >> 2u), pageBase.y + windowed.y));
		let paletteIndex = (textureWord >> ((windowed.x & 3u) << 2u)) & 0x0fu;
		let paletteWord = rawVramWord(vec2<u32>(clutBase.x + paletteIndex, clutBase.y));
		return TextureColor(decodeRgb555To5(paletteWord), paletteWord >> 15u, paletteWord == 0u);
	}
	if (u.params0.x == 1u) {
		textureWord = rawVramWord(vec2<u32>(pageBase.x + (windowed.x >> 1u), pageBase.y + windowed.y));
		let paletteIndex = (textureWord >> ((windowed.x & 1u) << 3u)) & 0xffu;
		let paletteWord = rawVramWord(vec2<u32>(clutBase.x + paletteIndex, clutBase.y));
		return TextureColor(decodeRgb555To5(paletteWord), paletteWord >> 15u, paletteWord == 0u);
	}
	textureWord = rawVramWord(pageBase + windowed);
	return TextureColor(decodeRgb555To5(textureWord), textureWord >> 15u, textureWord == 0u);
}

fn blendRgb5(src5: vec3<u32>, dst5: vec3<u32>) -> vec3<u32> {
	switch u.params0.w {
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

fn modulatedTextureRgb5(texture5: vec3<u32>, vertex8: vec3<u32>, fragCoord: vec2<u32>) -> vec3<u32> {
	let preDither = vec3<i32>((texture5 * vertex8) >> vec3<u32>(4u));
	let dither = select(0, ditherOffset(fragCoord), u.params1.z != 0u);
	return vec3<u32>(clamp((preDither + vec3<i32>(dither)) >> vec3<i32>(3), vec3<i32>(0), vec3<i32>(31)));
}

fn encodeRgb555(color5: vec3<u32>, outputMaskBit: u32) -> vec4<f32> {
	let word = color5.r | (color5.g << 5u) | (color5.b << 10u) | (outputMaskBit << 15u);
	return vec4<f32>(f32(word & 0xffu) / 255.0, f32(word >> 8u) / 255.0, 0.0, 1.0);
}

fn shadeTextured(vertex8: vec3<u32>, fragCoord: vec2<u32>, texcoord: vec2<u32>) -> vec4<f32> {
	if ((fragCoord.y & 1u) == u.params1.w) { discard; }
	let textureColor = samplePsxTexture(texcoord);
	if (textureColor.transparent) { discard; }
	var src5 = textureColor.rgb5;
	if (u.params0.y == 0u) { src5 = modulatedTextureRgb5(src5, vertex8, fragCoord); }
	if (u.params1.x != 0u || u.params0.z != 0u) {
		let dstWord = rawVramWord(fragCoord);
		if (u.params1.x != 0u && (dstWord & 0x8000u) != 0u) { discard; }
		if (u.params0.z != 0u && textureColor.maskBit != 0u) { src5 = blendRgb5(src5, decodeRgb555To5(dstWord)); }
	}
	let outputMaskBit = select(textureColor.maskBit, 1u, u.params1.y != 0u);
	return encodeRgb555(src5, outputMaskBit);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	let fragCoord = vec2<u32>(input.position.xy);
	let texcoord = polygonTexcoord(fragCoord, input.uvPlaneBase, input.uvPlaneStepX, input.uvPlaneStepY);
	return shadeTextured(vec3<u32>(input.color * vec3<f32>(255.0)), fragCoord, texcoord);
}

@fragment
fn fs_fixed(input: FixedVSOut) -> @location(0) vec4<f32> {
	let fragCoord = vec2<u32>(input.position.xy);
	let colorAccumulator = input.colorPlaneBase + input.colorPlaneStepX * fragCoord.x + input.colorPlaneStepY * fragCoord.y;
	let uvAccumulator = input.uvPlaneBase + input.uvPlaneStepX * fragCoord.x + input.uvPlaneStepY * fragCoord.y;
	let color8 = (colorAccumulator >> vec3<u32>(12u)) & vec3<u32>(0xffu);
	let texcoord = (uvAccumulator >> vec2<u32>(12u)) & vec2<u32>(0xffu);
	return shadeTextured(color8, fragCoord, texcoord);
}
