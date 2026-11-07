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
uniform int u_blendEnable;
uniform int u_blendMode;
uniform int u_checkMaskBit;
uniform int u_setMaskBit;
uniform int u_ditherEnable;
uniform int u_skippedLineParity;
#ifdef GX_GPU_VRAM_ALIAS
uniform int u_logicalYBase;
#endif
#if GX_GPU_FIXED_COLOR_PLANE
varying vec4 v_colorPlane[5];
#else
varying vec4 v_color;
#endif

int clampByte(int value) {
	return value < 0 ? 0 : (value > 255 ? 255 : value);
}

int clampColor5(int value) {
	return value < 0 ? 0 : (value > 31 ? 31 : value);
}

ivec2 rawStorageVramWord(ivec2 storageCoord) {
#ifdef GX_GPU_FRAMEBUFFER_FETCH_ARM
	vec4 rawPixel = gl_LastFragColorARM;
#else
	vec2 texcoord = (vec2(storageCoord) + vec2(0.5))
		/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS));
	vec4 rawPixel = texture2D(u_vram, texcoord);
#endif
	return gxWordBytes(rawPixel);
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

ivec3 rgb8ToRgb5(ivec3 rgb8, ivec2 logicalCoord) {
	if (u_ditherEnable != 0) {
		int dither = ditherOffset(logicalCoord);
		rgb8 = ivec3(clampByte(rgb8.x + dither), clampByte(rgb8.y + dither), clampByte(rgb8.z + dither));
	}
	return ivec3(rgb8.x / 8, rgb8.y / 8, rgb8.z / 8);
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
#if GX_GPU_FIXED_COLOR_PLANE
	ivec3 src5 = rgb8ToRgb5(fixedColor8(logicalCoord), logicalCoord);
#else
	ivec3 src5 = rgb8ToRgb5(ivec3(v_color.rgb * 255.0), logicalCoord);
#endif
	if (u_checkMaskBit != 0 || u_blendEnable != 0) {
		ivec2 dstWord = rawStorageVramWord(storageCoord);
		if (u_checkMaskBit != 0 && dstWord.y / 128 != 0) {
			discard;
		}
		if (u_blendEnable != 0) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	gl_FragColor = encodeRgb555(src5, u_setMaskBit);
}
