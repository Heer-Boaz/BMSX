struct TexturedUniforms {
	texPageClut: vec4<f32>,
	textureWindow: vec4<f32>,
	params0: vec4<f32>,
	params1: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: TexturedUniforms;
@group(0) @binding(1) var u_vram: texture_2d<f32>;
@group(0) @binding(2) var u_sampler: sampler;

struct VSIn {
	@location(0) position: vec2<f32>,
	@location(1) color: vec3<f32>,
	@location(2) texcoord: vec2<f32>,
};

struct VSOut {
	@builtin(position) position: vec4<f32>,
	@location(0) color: vec3<f32>,
	@location(1) texcoord: vec2<f32>,
};

const VRAM_SIZE = vec2<f32>(1024.0, 512.0);

@vertex
fn vs_main(input: VSIn) -> VSOut {
	var out: VSOut;
	let rasterPosition = input.position + vec2<f32>(0.5);
	let clip = vec2<f32>((rasterPosition.x / 512.0) - 1.0, 1.0 - (rasterPosition.y / 256.0));
	out.position = vec4<f32>(clip, 0.0, 1.0);
	out.color = input.color;
	out.texcoord = input.texcoord;
	return out;
}

fn bitAnd8(a: f32, b: f32) -> f32 {
	var result = 0.0;
	var bit = 1.0;
	for (var index = 0; index < 8; index = index + 1) {
		let abit = floor(a / bit) - floor(floor(a / bit) / 2.0) * 2.0;
		let bbit = floor(b / bit) - floor(floor(b / bit) / 2.0) * 2.0;
		result += bit * floor(abit * bbit + 0.5);
		bit *= 2.0;
	}
	return result;
}

fn applyTextureWindow(texcoord: vec2<f32>) -> vec2<f32> {
	let coord = floor(texcoord);
	return vec2<f32>(bitAnd8(coord.x, u.textureWindow.x) + u.textureWindow.z, bitAnd8(coord.y, u.textureWindow.y) + u.textureWindow.w);
}

fn rawVramWord(coord: vec2<f32>) -> f32 {
	let wrapped = coord - floor(coord / VRAM_SIZE) * VRAM_SIZE;
	let rawPixel = textureSample(u_vram, u_sampler, (wrapped + vec2<f32>(0.5)) / VRAM_SIZE);
	let lowByte = floor(rawPixel.r * 255.0 + 0.5);
	let highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
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

fn wordMaskBit(word: f32) -> f32 { return floor(word / 32768.0); }

fn palette4Index(word: f32, textureU: f32) -> f32 {
	let subpixel = textureU - floor(textureU / 4.0) * 4.0;
	let divisor = pow(2.0, subpixel * 4.0);
	return floor(word / divisor) - floor(floor(word / divisor) / 16.0) * 16.0;
}

fn palette8Index(word: f32, textureU: f32) -> f32 {
	let subpixel = textureU - floor(textureU / 2.0) * 2.0;
	let divisor = pow(2.0, subpixel * 8.0);
	return floor(word / divisor) - floor(floor(word / divisor) / 256.0) * 256.0;
}

fn samplePsxTexture(texcoord: vec2<f32>) -> vec4<f32> {
	let windowed = applyTextureWindow(texcoord);
	let pageBase = u.texPageClut.xy;
	let clutBase = u.texPageClut.zw;
	var textureWord: f32;
	if (u.params0.x < 0.5) {
		let wordCoord = vec2<f32>(pageBase.x + floor(windowed.x / 4.0), pageBase.y + windowed.y);
		textureWord = rawVramWord(wordCoord);
		let paletteIndex = palette4Index(textureWord, windowed.x);
		let paletteWord = rawVramWord(vec2<f32>(clutBase.x + paletteIndex, clutBase.y));
		let alpha = select(wordMaskBit(paletteWord), -1.0, paletteWord == 0.0);
		return vec4<f32>(decodeRgb555To5(paletteWord), alpha);
	}
	if (u.params0.x < 1.5) {
		let wordCoord = vec2<f32>(pageBase.x + floor(windowed.x / 2.0), pageBase.y + windowed.y);
		textureWord = rawVramWord(wordCoord);
		let paletteIndex = palette8Index(textureWord, windowed.x);
		let paletteWord = rawVramWord(vec2<f32>(clutBase.x + paletteIndex, clutBase.y));
		let alpha = select(wordMaskBit(paletteWord), -1.0, paletteWord == 0.0);
		return vec4<f32>(decodeRgb555To5(paletteWord), alpha);
	}
	textureWord = rawVramWord(pageBase + windowed);
	let alpha = select(wordMaskBit(textureWord), -1.0, textureWord == 0.0);
	return vec4<f32>(decodeRgb555To5(textureWord), alpha);
}

fn blendRgb5(src5: vec3<f32>, dst5: vec3<f32>) -> vec3<f32> {
	let mode = u.params0.w;
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

fn modulatedTextureRgb5(texture5: vec3<f32>, vertexColor: vec3<f32>, fragCoord: vec2<f32>) -> vec3<f32> {
	let vertex8 = floor(vertexColor * 255.0);
	var preDither = floor((texture5 * vertex8) / 16.0);
	if (u.params1.z > 0.5) { preDither += vec3<f32>(ditherOffset(vec2<f32>(fragCoord.x - 0.5, fragCoord.y - 0.5))); }
	return clamp(floor(preDither / 8.0), vec3<f32>(0.0), vec3<f32>(31.0));
}

fn encodeRgb555(color5: vec3<f32>, outputMaskBit: f32) -> vec4<f32> {
	let packedLow = color5.r + color5.g * 32.0;
	let lowByte = packedLow - floor(packedLow / 256.0) * 256.0;
	let highByte = floor(color5.g / 8.0) + color5.b * 4.0 + outputMaskBit * 128.0;
	return vec4<f32>(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}

fn activeInterlacedLine(fragCoord: vec2<f32>) -> bool {
	if ((u.params1.w - floor(u.params1.w / 2.0) * 2.0) < 0.5) { return false; }
	let activeLineLsb = floor(u.params1.w * 0.5) - floor(floor(u.params1.w * 0.5) / 2.0) * 2.0;
	let vramY = floor(fragCoord.y);
	return (vramY - floor(vramY / 2.0) * 2.0) == activeLineLsb;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
	if (activeInterlacedLine(input.position.xy)) { discard; }
	let textureColor = samplePsxTexture(input.texcoord);
	if (textureColor.a < -0.5) { discard; }
	var src5 = textureColor.rgb;
	if (u.params0.y < 0.5) { src5 = modulatedTextureRgb5(textureColor.rgb, input.color, input.position.xy); }
	var dstWord = 0.0;
	if (u.params1.x > 0.5 || u.params0.z > 0.5) {
		dstWord = rawStorageVramWord(input.position.xy - vec2<f32>(0.5));
		if (u.params1.x > 0.5 && wordMaskBit(dstWord) > 0.5) { discard; }
		if (u.params0.z > 0.5 && textureColor.a > 0.5) { src5 = blendRgb5(src5, decodeRgb555To5(dstWord)); }
	}
	let outputMaskBit = select(textureColor.a, 1.0, u.params1.y > 0.5);
	return encodeRgb555(src5, outputMaskBit);
}
