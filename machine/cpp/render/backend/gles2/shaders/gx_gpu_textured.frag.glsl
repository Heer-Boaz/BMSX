#ifdef GX_GPU_FRAMEBUFFER_FETCH_ARM
#extension GL_ARM_shader_framebuffer_fetch : require
#endif

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
precision highp int;
#else
precision mediump float;
precision mediump int;
#endif

#include "gx_gpu_words.glsl"

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

uniform sampler2D u_vram;
#ifndef GX_GPU_FRAMEBUFFER_FETCH_ARM
uniform sampler2D u_destination;
#endif
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
#ifdef GX_GPU_VRAM_ALIAS
uniform int u_logicalYBase;
#endif
varying vec4 v_uvPlaneBase;
varying vec4 v_uvPlaneStepX;
varying vec4 v_uvPlaneStepY;
#if !GX_GPU_FIXED_COLOR_PLANE
varying vec2 v_textureSource;
varying vec2 v_rectangleUv;
uniform highp float u_rasterPhase;
#endif
#if GX_GPU_FIXED_COLOR_PLANE
varying vec4 v_colorPlane[5];
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

ivec2 rawVramWord(ivec2 logicalCoord) {
	ivec2 wrapped = ivec2(
		wrapPeriod(logicalCoord.x, GX_GPU_VRAM_X_ADDRESS_PERIOD),
		wrapPeriod(logicalCoord.y, GX_GPU_VRAM_TEXTURE_ROWS));
	vec4 rawPixel = texture2D(
		u_vram,
		(vec2(wrapped) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS)));
	return gxWordBytes(rawPixel);
}

ivec2 rawStorageVramWord(ivec2 storageCoord) {
#ifdef GX_GPU_FRAMEBUFFER_FETCH_ARM
	vec4 rawPixel = gl_LastFragColorARM;
#else
	vec4 rawPixel = texture2D(
		u_destination,
		(vec2(storageCoord) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS)));
#endif
	return gxWordBytes(rawPixel);
}



ivec2 fixedUv(ivec2 logicalCoord) {
#if !GX_GPU_FIXED_COLOR_PLANE
	if (u_rasterPhase == 0.0) {
		ivec2 uv = ivec2(floor(v_rectangleUv));
		return ivec2(wrapPeriod(uv.x, 256), wrapPeriod(uv.y, 256));
	}
#endif
	return ivec2(gxAttributeByte(v_uvPlaneBase.xz, v_uvPlaneStepX.xz, v_uvPlaneStepY.xz, logicalCoord),
		gxAttributeByte(v_uvPlaneBase.yw, v_uvPlaneStepX.yw, v_uvPlaneStepY.yw, logicalCoord));
}

ivec4 textureColor(ivec2 word) {
	return ivec4(decodeRgb555To5(word), (word.x == 0 && word.y == 0) ? -1 : word.y / 128);
}

ivec4 samplePsxTexture(ivec2 sampleCoord) {
	#if GX_GPU_FIXED_COLOR_PLANE
	ivec2 sourceWords = ivec2(v_colorPlane[4].zw);
#else
	ivec2 sourceWords = ivec2(v_textureSource);
#endif
	ivec2 high = ivec2(sourceWords.x < 0 ? 0 : 1, sourceWords.y < 0 ? 0 : 1);
	ivec2 low = ivec2(sourceWords.x < 0 ? sourceWords.x + 2048 : sourceWords.x,
		sourceWords.y < 0 ? sourceWords.y + 2048 : sourceWords.y);
	ivec2 texPageBase = ivec2((low.x - (low.x / 16) * 16) * 64,
		((low.x / 16) - (low.x / 128) * 8) * 256);
	ivec2 clutBase = ivec2((low.x / 128 + high.x * 16 + high.y * 32) * 16, low.y);
	ivec2 windowed = ivec2(
		applyTextureWindowAxis(sampleCoord.x, u_textureWindowAnd.x, u_textureWindowOr.x),
		applyTextureWindowAxis(sampleCoord.y, u_textureWindowAnd.y, u_textureWindowOr.y)
	);
	if (u_textureMode == 0) {
		ivec2 textureWord = rawVramWord(ivec2(texPageBase.x + windowed.x / 4, texPageBase.y + windowed.y));
		int subpixel = windowed.x - (windowed.x / 4) * 4;
		int selectedByte = subpixel < 2 ? textureWord.x : textureWord.y;
		int shifted = subpixel == 1 || subpixel == 3 ? selectedByte / 16 : selectedByte;
		int paletteIndex = shifted - (shifted / 16) * 16;
		return textureColor(rawVramWord(ivec2(clutBase.x + paletteIndex, clutBase.y)));
	}
	if (u_textureMode == 1) {
		ivec2 textureWord = rawVramWord(ivec2(texPageBase.x + windowed.x / 2, texPageBase.y + windowed.y));
		int paletteIndex = windowed.x - (windowed.x / 2) * 2 == 0 ? textureWord.x : textureWord.y;
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
	return gxColorPlaneBytes(v_colorPlane[0], v_colorPlane[1], v_colorPlane[2],
		v_colorPlane[3], v_colorPlane[4], logicalCoord);
}
#endif

ivec3 modulatedTextureRgb5(ivec3 texture5, ivec3 vertex8, ivec2 logicalCoord) {
	ivec3 preDither = ivec3(texture5.x * (vertex8.x / 16) + texture5.x * (vertex8.x - (vertex8.x / 16) * 16) / 16, texture5.y * (vertex8.y / 16) + texture5.y * (vertex8.y - (vertex8.y / 16) * 16) / 16, texture5.z * (vertex8.z / 16) + texture5.z * (vertex8.z - (vertex8.z / 16) * 16) / 16);
	if (u_ditherEnable != 0) {
		preDither += ivec3(ditherOffset(logicalCoord));
	}
	return ivec3(
		clampColor5(floorDiv8(preDither.x)),
		clampColor5(floorDiv8(preDither.y)),
		clampColor5(floorDiv8(preDither.z))
	);
}



void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
	ivec2 logicalCoord = storageCoord;
#ifdef GX_GPU_VRAM_ALIAS
	logicalCoord.y += u_logicalYBase;
#endif
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
		ivec2 dstWord = rawStorageVramWord(storageCoord);
		if (u_checkMaskBit != 0 && dstWord.y / 128 != 0) {
			discard;
		}
		if (u_blendEnable != 0 && sampled.w != 0) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	int outputMaskBit = u_setMaskBit != 0 ? 1 : sampled.w;
	gl_FragColor = encodeRgb555(src5, outputMaskBit);
}
