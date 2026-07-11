precision highp float;

uniform sampler2D u_vram;
uniform vec2 u_texPageBase;
uniform vec2 u_clutBase;
uniform vec2 u_textureWindowAnd;
uniform vec2 u_textureWindowOr;
uniform float u_textureMode;
uniform float u_rawTexture;
uniform float u_blendEnable;
uniform float u_blendMode;
uniform float u_checkMaskBit;
uniform float u_setMaskBit;
uniform float u_ditherEnable;
uniform float u_interlacedRenderWord;
uniform float u_uvPlaneEnable;
uniform vec4 u_uvPlaneBase;
uniform vec4 u_uvPlaneStepX;
uniform vec4 u_uvPlaneStepY;
varying vec4 v_color;
varying vec2 v_texcoord;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);

float bitAnd8(float a, float b) {
	float result = 0.0;
	float bit = 1.0;
	for (int index = 0; index < 8; index += 1) {
		float abit = mod(floor(a / bit), 2.0);
		float bbit = mod(floor(b / bit), 2.0);
		result += bit * floor(abit * bbit + 0.5);
		bit *= 2.0;
	}
	return result;
}

vec2 applyTextureWindow(vec2 texcoord) {
	vec2 coord = floor(texcoord);
	return vec2(
		bitAnd8(coord.x, u_textureWindowAnd.x) + u_textureWindowOr.x,
		bitAnd8(coord.y, u_textureWindowAnd.y) + u_textureWindowOr.y
	);
}

vec2 multiplyMod20(vec2 chunks, float coord) {
	float coordLow = mod(coord, 32.0);
	float coordHigh = floor(coord / 32.0);
	float lowHighProduct = chunks.x * coordHigh;
	float lowTerm = chunks.x * coordLow + mod(lowHighProduct, 32.0) * 32.0;
	float low = mod(lowTerm, 1024.0);
	float carry = floor(lowTerm / 1024.0) + floor(lowHighProduct / 32.0);
	float high = mod(carry + chunks.y * coordLow + mod(chunks.y * coordHigh, 32.0) * 32.0, 1024.0);
	return vec2(low, high);
}

vec2 addMod20(vec2 base, vec2 xProduct, vec2 yProduct) {
	float lowSum = base.x + xProduct.x + yProduct.x;
	return vec2(mod(lowSum, 1024.0), mod(base.y + xProduct.y + yProduct.y + floor(lowSum / 1024.0), 1024.0));
}

vec2 polygonTexcoord() {
	float x = floor(gl_FragCoord.x);
	float y = floor(VRAM_SIZE.y - gl_FragCoord.y);
	vec2 accumulatorU = addMod20(u_uvPlaneBase.xy, multiplyMod20(u_uvPlaneStepX.xy, x), multiplyMod20(u_uvPlaneStepY.xy, y));
	vec2 accumulatorV = addMod20(u_uvPlaneBase.zw, multiplyMod20(u_uvPlaneStepX.zw, x), multiplyMod20(u_uvPlaneStepY.zw, y));
	return floor(vec2(accumulatorU.y, accumulatorV.y) / 4.0);
}

float rawVramWord(vec2 coord) {
	vec2 wrapped = mod(coord, VRAM_SIZE);
	vec2 storageCoord = vec2(wrapped.x, VRAM_SIZE.y - 1.0 - wrapped.y);
	vec4 rawPixel = texture2D(u_vram, (storageCoord + vec2(0.5)) / VRAM_SIZE);
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

float rawStorageVramWord(vec2 storageCoord) {
	vec2 wrapped = mod(storageCoord, VRAM_SIZE);
	vec4 rawPixel = texture2D(u_vram, (wrapped + vec2(0.5)) / VRAM_SIZE);
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

vec3 decodeRgb555To5(float word) {
	return vec3(
		mod(word, 32.0),
		mod(floor(word / 32.0), 32.0),
		mod(floor(word / 1024.0), 32.0)
	);
}

float wordMaskBit(float word) {
	return floor(word / 32768.0);
}

float palette4Index(float word, float u) {
	float subpixel = mod(u, 4.0);
	return mod(floor(word / exp2(subpixel * 4.0)), 16.0);
}

float palette8Index(float word, float u) {
	float subpixel = mod(u, 2.0);
	return mod(floor(word / exp2(subpixel * 8.0)), 256.0);
}

vec4 samplePsxTexture(vec2 texcoord) {
	vec2 sampleCoord = texcoord;
	if (u_uvPlaneEnable > 0.5) {
		sampleCoord = polygonTexcoord();
	}
	vec2 windowed = applyTextureWindow(sampleCoord);
	float textureWord;
	if (u_textureMode < 0.5) {
		vec2 wordCoord = vec2(u_texPageBase.x + floor(windowed.x / 4.0), u_texPageBase.y + windowed.y);
		textureWord = rawVramWord(wordCoord);
		float paletteIndex = palette4Index(textureWord, windowed.x);
		float paletteWord = rawVramWord(vec2(u_clutBase.x + paletteIndex, u_clutBase.y));
		return vec4(decodeRgb555To5(paletteWord), paletteWord == 0.0 ? -1.0 : wordMaskBit(paletteWord));
	}
	if (u_textureMode < 1.5) {
		vec2 wordCoord = vec2(u_texPageBase.x + floor(windowed.x / 2.0), u_texPageBase.y + windowed.y);
		textureWord = rawVramWord(wordCoord);
		float paletteIndex = palette8Index(textureWord, windowed.x);
		float paletteWord = rawVramWord(vec2(u_clutBase.x + paletteIndex, u_clutBase.y));
		return vec4(decodeRgb555To5(paletteWord), paletteWord == 0.0 ? -1.0 : wordMaskBit(paletteWord));
	}
	textureWord = rawVramWord(u_texPageBase + windowed);
	return vec4(decodeRgb555To5(textureWord), textureWord == 0.0 ? -1.0 : wordMaskBit(textureWord));
}

vec3 blendRgb5(vec3 src5, vec3 dst5) {
	if (u_blendMode < 0.5) {
		return floor((src5 + dst5) * 0.5);
	}
	if (u_blendMode < 1.5) {
		return min(src5 + dst5, vec3(31.0));
	}
	if (u_blendMode < 2.5) {
		return max(dst5 - src5, vec3(0.0));
	}
	return min(dst5 + floor(src5 * 0.25), vec3(31.0));
}

float ditherOffset() {
	vec2 pixelCoord = floor(vec2(gl_FragCoord.x - 0.5, VRAM_SIZE.y - gl_FragCoord.y - 0.5));
	float x = mod(pixelCoord.x, 4.0);
	float y = mod(pixelCoord.y, 4.0);
	if (y < 0.5) {
		if (x < 0.5) {
			return -4.0;
		}
		if (x < 1.5) {
			return 0.0;
		}
		if (x < 2.5) {
			return -3.0;
		}
		return 1.0;
	}
	if (y < 1.5) {
		if (x < 0.5) {
			return 2.0;
		}
		if (x < 1.5) {
			return -2.0;
		}
		if (x < 2.5) {
			return 3.0;
		}
		return -1.0;
	}
	if (y < 2.5) {
		if (x < 0.5) {
			return -3.0;
		}
		if (x < 1.5) {
			return 1.0;
		}
		if (x < 2.5) {
			return -4.0;
		}
		return 0.0;
	}
	if (x < 0.5) {
		return 3.0;
	}
	if (x < 1.5) {
		return -1.0;
	}
	if (x < 2.5) {
		return 2.0;
	}
	return -2.0;
}

vec3 modulatedTextureRgb5(vec3 texture5) {
	vec3 vertex8 = floor(v_color.rgb * 255.0);
	vec3 preDither = floor((texture5 * vertex8) / 16.0);
	if (u_ditherEnable > 0.5) {
		preDither += vec3(ditherOffset());
	}
	return clamp(floor(preDither / 8.0), vec3(0.0), vec3(31.0));
}

vec4 encodeRgb555(vec3 color5, float outputMaskBit) {
	float lowByte = mod(color5.r + color5.g * 32.0, 256.0);
	float highByte = floor(color5.g / 8.0) + color5.b * 4.0 + outputMaskBit * 128.0;
	return vec4(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}


void discardActiveInterlacedLine() {
	if (mod(u_interlacedRenderWord, 2.0) < 0.5) {
		return;
	}
	float activeLineLsb = mod(floor(u_interlacedRenderWord * 0.5), 2.0);
	float vramY = floor(VRAM_SIZE.y - gl_FragCoord.y);
	if (mod(vramY, 2.0) == activeLineLsb) {
		discard;
	}
}

void main() {
	discardActiveInterlacedLine();
	vec4 textureColor = samplePsxTexture(v_texcoord);
	if (textureColor.a < -0.5) {
		discard;
	}
	vec3 src5 = textureColor.rgb;
	if (u_rawTexture < 0.5) {
		src5 = modulatedTextureRgb5(textureColor.rgb);
	}
	float dstWord = 0.0;
	if (u_checkMaskBit > 0.5 || u_blendEnable > 0.5) {
		dstWord = rawStorageVramWord(gl_FragCoord.xy - vec2(0.5));
		if (u_checkMaskBit > 0.5 && wordMaskBit(dstWord) > 0.5) {
			discard;
		}
		if (u_blendEnable > 0.5 && textureColor.a > 0.5) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	float outputMaskBit = u_setMaskBit > 0.5 ? 1.0 : textureColor.a;
	gl_FragColor = encodeRgb555(src5, outputMaskBit);
}
