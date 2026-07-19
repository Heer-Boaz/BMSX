#version 300 es
precision highp float;
precision highp int;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

uniform sampler2D u_vram;
uniform uint u_blendEnable;
uniform uint u_blendMode;
uniform uint u_checkMaskBit;
uniform uint u_setMaskBit;
uniform uint u_ditherEnable;
uniform uint u_skippedLineParity;
#if GX_GPU_FIXED_COLOR_PLANE
flat in uvec3 v_colorPlaneBase;
flat in uvec3 v_colorPlaneStepX;
flat in uvec3 v_colorPlaneStepY;
#else
in vec4 v_color;
#endif
out vec4 outputColor;

uint rawStorageVramWord(ivec2 storageCoord) {
	vec4 rawPixel = texelFetch(u_vram, storageCoord & ivec2(1023), 0);
	uvec2 bytes = uvec2(rawPixel.rg * 255.0 + 0.5);
	return bytes.x | (bytes.y << 8u);
}

uvec3 decodeRgb555To5(uint word) {
	return uvec3(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
}

uvec3 blendRgb5(uvec3 src5, uvec3 dst5) {
	switch (u_blendMode) {
		case 0u: return (src5 + dst5) >> uvec3(1u);
		case 1u: return min(src5 + dst5, uvec3(31u));
		case 2u: return uvec3(max(ivec3(dst5) - ivec3(src5), ivec3(0)));
		default: return min(dst5 + (src5 >> uvec3(2u)), uvec3(31u));
	}
}

int ditherOffset(ivec2 coord) {
	switch (((coord.y & 3) << 2) | (coord.x & 3)) {
		case 0: return -4;
		case 1: return 0;
		case 2: return -3;
		case 3: return 1;
		case 4: return 2;
		case 5: return -2;
		case 6: return 3;
		case 7: return -1;
		case 8: return -3;
		case 9: return 1;
		case 10: return -4;
		case 11: return 0;
		case 12: return 3;
		case 13: return -1;
		case 14: return 2;
		default: return -2;
	}
}

uvec3 rgb8ToRgb5(uvec3 rgb8, ivec2 logicalCoord) {
	if (u_ditherEnable != 0u) {
		rgb8 = uvec3(clamp(ivec3(rgb8) + ivec3(ditherOffset(logicalCoord)), ivec3(0), ivec3(255)));
	}
	return rgb8 >> uvec3(3u);
}

vec4 encodeRgb555(uvec3 color5, uint outputMaskBit) {
	uint word = color5.r | (color5.g << 5u) | (color5.b << 10u) | (outputMaskBit << 15u);
	return vec4(float(word & 0xffu) / 255.0, float(word >> 8u) / 255.0, 0.0, 1.0);
}

void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
	ivec2 logicalCoord = storageCoord;
	if (uint(logicalCoord.y & 1) == u_skippedLineParity) {
		discard;
	}
#if GX_GPU_FIXED_COLOR_PLANE
	uvec3 colorAccumulator = v_colorPlaneBase + v_colorPlaneStepX * uint(logicalCoord.x) + v_colorPlaneStepY * uint(logicalCoord.y);
	uvec3 src5 = rgb8ToRgb5((colorAccumulator >> uvec3(12u)) & uvec3(0xffu), logicalCoord);
#else
	uvec3 src5 = rgb8ToRgb5(uvec3(v_color.rgb * 255.0), logicalCoord);
#endif
	if (u_checkMaskBit != 0u || u_blendEnable != 0u) {
		uint dstWord = rawStorageVramWord(storageCoord);
		if (u_checkMaskBit != 0u && (dstWord & 0x8000u) != 0u) {
			discard;
		}
		if (u_blendEnable != 0u) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	outputColor = encodeRgb555(src5, u_setMaskBit);
}
