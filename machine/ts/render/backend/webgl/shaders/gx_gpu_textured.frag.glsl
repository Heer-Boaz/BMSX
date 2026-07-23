#version 300 es
precision highp float;
precision highp int;

#ifndef GX_GPU_FIXED_COLOR_PLANE
#define GX_GPU_FIXED_COLOR_PLANE 0
#endif

uniform sampler2D u_vram;
uniform uvec2 u_textureWindowAnd;
uniform uvec2 u_textureWindowOr;
uniform uint u_textureMode;
uniform uint u_rawTexture;
uniform uint u_blendEnable;
uniform uint u_blendMode;
uniform uint u_checkMaskBit;
uniform uint u_setMaskBit;
uniform uint u_ditherEnable;
uniform uint u_skippedLineParity;
flat in uvec2 v_uvPlaneBase;
flat in uvec2 v_uvPlaneStepX;
flat in uvec2 v_uvPlaneStepY;
flat in uvec4 v_textureSource;
#if GX_GPU_FIXED_COLOR_PLANE
flat in uvec3 v_colorPlaneBase;
flat in uvec3 v_colorPlaneStepX;
flat in uvec3 v_colorPlaneStepY;
#else
in vec3 v_color;
#endif
out vec4 outputColor;

struct TextureColor {
	uvec3 rgb5;
	uint maskBit;
	bool transparent;
};

uint rawVramWord(uvec2 logicalCoord) {
	uvec2 wrapped = logicalCoord & uvec2(1023u);
	vec4 rawPixel = texelFetch(u_vram, ivec2(wrapped), 0);
	uvec2 bytes = uvec2(rawPixel.rg * 255.0 + 0.5);
	return bytes.x | (bytes.y << 8u);
}

uint rawStorageVramWord(ivec2 storageCoord) {
	vec4 rawPixel = texelFetch(u_vram, storageCoord & ivec2(1023), 0);
	uvec2 bytes = uvec2(rawPixel.rg * 255.0 + 0.5);
	return bytes.x | (bytes.y << 8u);
}

uvec3 decodeRgb555To5(uint word) {
	return uvec3(word & 0x1fu, (word >> 5u) & 0x1fu, (word >> 10u) & 0x1fu);
}

TextureColor textureColor(uint word) {
	return TextureColor(decodeRgb555To5(word), word >> 15u, word == 0u);
}

TextureColor samplePsxTexture(uvec2 sampleCoord) {
	uvec2 texPageBase = v_textureSource.xy;
	uvec2 clutBase = v_textureSource.zw;
	uvec2 windowed = (sampleCoord & u_textureWindowAnd) | u_textureWindowOr;
	if (u_textureMode == 0u) {
		uint textureWord = rawVramWord(uvec2(texPageBase.x + (windowed.x >> 2u), texPageBase.y + windowed.y));
		uint paletteIndex = (textureWord >> ((windowed.x & 3u) << 2u)) & 0x0fu;
		return textureColor(rawVramWord(uvec2(clutBase.x + paletteIndex, clutBase.y)));
	}
	if (u_textureMode == 1u) {
		uint textureWord = rawVramWord(uvec2(texPageBase.x + (windowed.x >> 1u), texPageBase.y + windowed.y));
		uint paletteIndex = (textureWord >> ((windowed.x & 1u) << 3u)) & 0xffu;
		return textureColor(rawVramWord(uvec2(clutBase.x + paletteIndex, clutBase.y)));
	}
	return textureColor(rawVramWord(texPageBase + windowed));
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

uvec3 modulatedTextureRgb5(uvec3 texture5, uvec3 vertex8, ivec2 logicalCoord) {
	ivec3 preDither = ivec3((texture5 * vertex8) >> uvec3(4u));
	if (u_ditherEnable != 0u) {
		preDither += ivec3(ditherOffset(logicalCoord));
	}
	return uvec3(clamp(preDither >> ivec3(3), ivec3(0), ivec3(31)));
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
	uvec2 uvAccumulator = v_uvPlaneBase + v_uvPlaneStepX * uint(logicalCoord.x) + v_uvPlaneStepY * uint(logicalCoord.y);
	TextureColor sampled = samplePsxTexture((uvAccumulator >> uvec2(12u)) & uvec2(0xffu));
	if (sampled.transparent) {
		discard;
	}
	uvec3 src5 = sampled.rgb5;
	if (u_rawTexture == 0u) {
#if GX_GPU_FIXED_COLOR_PLANE
		uvec3 colorAccumulator = v_colorPlaneBase + v_colorPlaneStepX * uint(logicalCoord.x) + v_colorPlaneStepY * uint(logicalCoord.y);
		src5 = modulatedTextureRgb5(src5, (colorAccumulator >> uvec3(12u)) & uvec3(0xffu), logicalCoord);
#else
		src5 = modulatedTextureRgb5(src5, uvec3(v_color * 255.0), logicalCoord);
#endif
	}
	if (u_checkMaskBit != 0u || u_blendEnable != 0u) {
		uint dstWord = rawStorageVramWord(storageCoord);
		if (u_checkMaskBit != 0u && (dstWord & 0x8000u) != 0u) {
			discard;
		}
		if (u_blendEnable != 0u && sampled.maskBit != 0u) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	uint outputMaskBit = u_setMaskBit != 0u ? 1u : sampled.maskBit;
	outputColor = encodeRgb555(src5, outputMaskBit);
}
