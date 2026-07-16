#version 300 es
precision highp float;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

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
uniform float u_rasterRowOrigin;
#if GX_GPU_FIXED_COLOR_PLANE
in vec4 v_uvPlane01;
in vec4 v_uvPlane23;
in vec2 v_uvPlane4;
in vec4 v_colorPlane0;
in vec4 v_colorPlane1;
in vec4 v_colorPlane2;
in vec3 v_colorPlane3;
#else
in vec4 v_color;
in vec2 v_texcoord;
in float v_uvPlaneEnable;
in vec4 v_uvPlane01;
in vec4 v_uvPlane23;
in vec2 v_uvPlane4;
#endif
out vec4 outputColor;

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

float rawVramWord(vec2 coord) {
	vec2 wrapped = mod(coord, VRAM_SIZE);
	vec2 storageCoord = vec2(wrapped.x, VRAM_SIZE.y - 1.0 - wrapped.y);
	vec4 rawPixel = texture(u_vram, (storageCoord + vec2(0.5)) / VRAM_SIZE);
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

float rawStorageVramWord(vec2 storageCoord) {
	vec2 wrapped = mod(storageCoord, VRAM_SIZE);
	vec4 rawPixel = texture(u_vram, (wrapped + vec2(0.5)) / VRAM_SIZE);
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

vec4 samplePsxTexture() {
#if GX_GPU_FIXED_COLOR_PLANE
	vec4 plane01 = floor(v_uvPlane01 + 0.5);
	vec4 plane23 = floor(v_uvPlane23 + 0.5);
	vec2 plane4 = floor(v_uvPlane4 + 0.5);
	vec2 carry = floor(plane01.xy / 16.0);
	carry = floor((plane01.zw + carry) / 16.0);
	carry = floor((plane23.xy + carry) / 16.0);
	vec2 digit3 = plane23.zw + carry;
	carry = floor(digit3 / 16.0);
	vec2 digit4 = plane4 + carry;
	vec2 sampleCoord = mod(digit3, 16.0) + mod(digit4, 16.0) * 16.0;
#else
	vec2 sampleCoord = v_texcoord;
	if (v_uvPlaneEnable > 0.5) {
		vec4 plane01 = floor(v_uvPlane01 + 0.5);
		vec4 plane23 = floor(v_uvPlane23 + 0.5);
		vec2 plane4 = floor(v_uvPlane4 + 0.5);
		vec2 carry = floor(plane01.xy / 16.0);
		carry = floor((plane01.zw + carry) / 16.0);
		carry = floor((plane23.xy + carry) / 16.0);
		vec2 digit3 = plane23.zw + carry;
		carry = floor(digit3 / 16.0);
		vec2 digit4 = plane4 + carry;
		sampleCoord = mod(digit3, 16.0) + mod(digit4, 16.0) * 16.0;
	}
#endif
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
	vec2 pixelCoord = floor(vec2(gl_FragCoord.x - 0.5, VRAM_SIZE.y - gl_FragCoord.y - 0.5 + u_rasterRowOrigin));
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

#if GX_GPU_FIXED_COLOR_PLANE
vec3 fixedColor8() {
	vec4 plane0 = floor(v_colorPlane0 + 0.5);
	vec4 plane1 = floor(v_colorPlane1 + 0.5);
	vec4 plane2 = floor(v_colorPlane2 + 0.5);
	vec3 plane3 = floor(v_colorPlane3 + 0.5);
	vec3 digit0 = plane0.xyz;
	vec3 digit1 = vec3(plane0.w, plane1.xy) + floor(digit0 / 16.0);
	vec3 digit2 = vec3(plane1.zw, plane2.x) + floor(digit1 / 16.0);
	vec3 digit3 = plane2.yzw + floor(digit2 / 16.0);
	vec3 digit4 = plane3 + floor(digit3 / 16.0);
	return mod(digit3, 16.0) + mod(digit4, 16.0) * 16.0;
}
#endif

vec3 modulatedTextureRgb5(vec3 texture5) {
#if GX_GPU_FIXED_COLOR_PLANE
	vec3 vertex8 = fixedColor8();
#else
	vec3 vertex8 = floor(v_color.rgb * 255.0);
#endif
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
	float vramY = floor(VRAM_SIZE.y - gl_FragCoord.y + u_rasterRowOrigin);
	if (mod(vramY, 2.0) == activeLineLsb) {
		discard;
	}
}

void main() {
	discardActiveInterlacedLine();
	vec4 textureColor = samplePsxTexture();
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
	outputColor = encodeRgb555(src5, outputMaskBit);
}
