#ifdef GX_GPU_FRAMEBUFFER_FETCH_ARM
#extension GL_ARM_shader_framebuffer_fetch : require
#endif

precision highp float;
precision highp int;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

uniform sampler2D u_vram;
uniform ivec2 u_textureWindowAnd;
uniform ivec2 u_textureWindowOr;
uniform int u_textureMode;
uniform int u_rawTexture;
uniform int u_blendEnable;
uniform int u_blendMode;
uniform int u_checkMaskBit;
uniform int u_setMaskBit;
uniform int u_ditherEnable;
uniform int u_skippedLineParity;
varying vec2 v_uvPlaneBase;
varying vec2 v_uvPlaneStepX;
varying vec2 v_uvPlaneStepY;
varying vec4 v_textureSource;
#if GX_GPU_FIXED_COLOR_PLANE
varying vec3 v_colorPlaneBase;
varying vec3 v_colorPlaneStepX;
varying vec3 v_colorPlaneStepY;
#else
varying vec3 v_color;
#endif

int floorDiv8(int value) {
	return value < 0 ? -((-value + 7) / 8) : value / 8;
}

int wrapPeriod(int value, int period) {
	int wrapped = value - (value / period) * period;
	return wrapped < 0 ? wrapped + period : wrapped;
}

int clampColor5(int value) {
	return value < 0 ? 0 : (value > 31 ? 31 : value);
}

int bitAnd5(int a, int b) {
	int result = 0;
	int bit = 1;
	for (int index = 0; index < 5; index += 1) {
		int aQuotient = a / bit;
		int bQuotient = b / bit;
		int aBit = aQuotient - (aQuotient / 2) * 2;
		int bBit = bQuotient - (bQuotient / 2) * 2;
		result += bit * aBit * bBit;
		bit *= 2;
	}
	return result;
}

int applyTextureWindowAxis(int coord, int andMask, int orMask) {
	int wrapped = wrapPeriod(coord, 256);
	int low = wrapped - (wrapped / 8) * 8;
	return low + (bitAnd5(wrapped / 8, andMask / 8) + orMask / 8) * 8;
}

int rawVramWord(ivec2 logicalCoord) {
	ivec2 wrapped = ivec2(wrapPeriod(logicalCoord.x, 1024), wrapPeriod(logicalCoord.y, 1024));
	vec4 rawPixel = texture2D(u_vram, (vec2(wrapped) + vec2(0.5)) / 1024.0);
	ivec4 nibbles = ivec4(rawPixel * 15.0 + 0.5);
	return nibbles.r * 4096 + nibbles.g * 256 + nibbles.b * 16 + nibbles.a;
}

int rawStorageVramWord(ivec2 storageCoord) {
#ifdef GX_GPU_FRAMEBUFFER_FETCH_ARM
	vec4 rawPixel = gl_LastFragColorARM;
#else
	vec4 rawPixel = texture2D(u_vram, (vec2(storageCoord) + vec2(0.5)) / 1024.0);
#endif
	ivec4 nibbles = ivec4(rawPixel * 15.0 + 0.5);
	return nibbles.r * 4096 + nibbles.g * 256 + nibbles.b * 16 + nibbles.a;
}

ivec3 decodeRgb555To5(int word) {
	return ivec3(
		word - (word / 32) * 32,
		(word / 32) - (word / 1024) * 32,
		(word / 1024) - (word / 32768) * 32
	);
}

ivec2 fixedUv(ivec2 logicalCoord) {
	ivec2 accumulator = ivec2(v_uvPlaneBase) + ivec2(v_uvPlaneStepX) * logicalCoord.x + ivec2(v_uvPlaneStepY) * logicalCoord.y;
	ivec2 fixedValue = accumulator / 4096;
	return fixedValue - (fixedValue / 256) * 256;
}

ivec4 textureColor(int word) {
	return ivec4(decodeRgb555To5(word), word == 0 ? -1 : word / 32768);
}

ivec4 samplePsxTexture(ivec2 sampleCoord) {
	ivec2 texPageBase = ivec2(v_textureSource.xy);
	ivec2 clutBase = ivec2(v_textureSource.zw);
	ivec2 windowed = ivec2(
		applyTextureWindowAxis(sampleCoord.x, u_textureWindowAnd.x, u_textureWindowOr.x),
		applyTextureWindowAxis(sampleCoord.y, u_textureWindowAnd.y, u_textureWindowOr.y)
	);
	if (u_textureMode == 0) {
		int textureWord = rawVramWord(ivec2(texPageBase.x + windowed.x / 4, texPageBase.y + windowed.y));
		int subpixel = windowed.x - (windowed.x / 4) * 4;
		int shifted = subpixel == 0 ? textureWord : (subpixel == 1 ? textureWord / 16 : (subpixel == 2 ? textureWord / 256 : textureWord / 4096));
		int paletteIndex = shifted - (shifted / 16) * 16;
		return textureColor(rawVramWord(ivec2(clutBase.x + paletteIndex, clutBase.y)));
	}
	if (u_textureMode == 1) {
		int textureWord = rawVramWord(ivec2(texPageBase.x + windowed.x / 2, texPageBase.y + windowed.y));
		int paletteIndex = windowed.x - (windowed.x / 2) * 2 == 0 ? textureWord - (textureWord / 256) * 256 : textureWord / 256;
		return textureColor(rawVramWord(ivec2(clutBase.x + paletteIndex, clutBase.y)));
	}
	return textureColor(rawVramWord(texPageBase + windowed));
}

ivec3 blendRgb5(ivec3 src5, ivec3 dst5) {
	if (u_blendMode == 0) {
		return ivec3((src5.x + dst5.x) / 2, (src5.y + dst5.y) / 2, (src5.z + dst5.z) / 2);
	}
	if (u_blendMode == 1) {
		return ivec3(clampColor5(src5.x + dst5.x), clampColor5(src5.y + dst5.y), clampColor5(src5.z + dst5.z));
	}
	if (u_blendMode == 2) {
		return ivec3(clampColor5(dst5.x - src5.x), clampColor5(dst5.y - src5.y), clampColor5(dst5.z - src5.z));
	}
	return ivec3(clampColor5(dst5.x + src5.x / 4), clampColor5(dst5.y + src5.y / 4), clampColor5(dst5.z + src5.z / 4));
}

int ditherOffset(ivec2 coord) {
	int x = coord.x - (coord.x / 4) * 4;
	int y = coord.y - (coord.y / 4) * 4;
	if (y == 0) {
		if (x == 0) return -4;
		if (x == 1) return 0;
		if (x == 2) return -3;
		return 1;
	}
	if (y == 1) {
		if (x == 0) return 2;
		if (x == 1) return -2;
		if (x == 2) return 3;
		return -1;
	}
	if (y == 2) {
		if (x == 0) return -3;
		if (x == 1) return 1;
		if (x == 2) return -4;
		return 0;
	}
	if (x == 0) return 3;
	if (x == 1) return -1;
	if (x == 2) return 2;
	return -2;
}

#if GX_GPU_FIXED_COLOR_PLANE
ivec3 fixedColor8(ivec2 logicalCoord) {
	ivec3 accumulator = ivec3(v_colorPlaneBase) + ivec3(v_colorPlaneStepX) * logicalCoord.x + ivec3(v_colorPlaneStepY) * logicalCoord.y;
	ivec3 fixedValue = accumulator / 4096;
	return fixedValue - (fixedValue / 256) * 256;
}
#endif

ivec3 modulatedTextureRgb5(ivec3 texture5, ivec3 vertex8, ivec2 logicalCoord) {
	ivec3 preDither = ivec3(texture5.x * vertex8.x / 16, texture5.y * vertex8.y / 16, texture5.z * vertex8.z / 16);
	if (u_ditherEnable != 0) {
		preDither += ivec3(ditherOffset(logicalCoord));
	}
	return ivec3(
		clampColor5(floorDiv8(preDither.x)),
		clampColor5(floorDiv8(preDither.y)),
		clampColor5(floorDiv8(preDither.z))
	);
}

vec4 encodeRgb555(ivec3 color5, int outputMaskBit) {
	int word = color5.x + color5.y * 32 + color5.z * 1024 + outputMaskBit * 32768;
	int highNibble = word / 4096;
	int midHighNibble = (word / 256) - highNibble * 16;
	int midLowNibble = (word / 16) - (word / 256) * 16;
	int lowNibble = word - (word / 16) * 16;
	return vec4(highNibble, midHighNibble, midLowNibble, lowNibble) / 15.0;
}

void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
	ivec2 logicalCoord = storageCoord;
	if (logicalCoord.y - (logicalCoord.y / 2) * 2 == u_skippedLineParity) {
		discard;
	}
	ivec4 sampled = samplePsxTexture(fixedUv(logicalCoord));
	if (sampled.w < 0) {
		discard;
	}
	ivec3 src5 = sampled.xyz;
	if (u_rawTexture == 0) {
#if GX_GPU_FIXED_COLOR_PLANE
		src5 = modulatedTextureRgb5(src5, fixedColor8(logicalCoord), logicalCoord);
#else
		src5 = modulatedTextureRgb5(src5, ivec3(v_color * 255.0), logicalCoord);
#endif
	}
	if (u_checkMaskBit != 0 || u_blendEnable != 0) {
		int dstWord = rawStorageVramWord(storageCoord);
		if (u_checkMaskBit != 0 && dstWord / 32768 != 0) {
			discard;
		}
		if (u_blendEnable != 0 && sampled.w != 0) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	int outputMaskBit = u_setMaskBit != 0 ? 1 : sampled.w;
	gl_FragColor = encodeRgb555(src5, outputMaskBit);
}
