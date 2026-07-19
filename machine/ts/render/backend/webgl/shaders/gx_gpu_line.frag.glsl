#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_vram;
uniform uint u_blendEnable;
uniform uint u_blendMode;
uniform uint u_checkMaskBit;
uniform uint u_setMaskBit;
uniform uint u_ditherEnable;
uniform uint u_skippedLineParity;
flat in ivec2 v_lineStart;
flat in ivec2 v_lineEnd;
flat in ivec3 v_colorBase;
flat in ivec3 v_colorStep;
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
	ivec2 pixelCoord = storageCoord;
	if (uint(pixelCoord.y & 1) == u_skippedLineParity) {
		discard;
	}
	ivec2 delta = v_lineEnd - v_lineStart;
	ivec2 absDelta = abs(delta);
	int steps = max(absDelta.x, absDelta.y);
	int stepIndex = 0;
	if (steps == 0) {
		if (any(notEqual(pixelCoord, v_lineStart))) {
			discard;
		}
	} else if (absDelta.x >= absDelta.y) {
		stepIndex = pixelCoord.x - v_lineStart.x;
		if (stepIndex < 0 || stepIndex > steps) {
			discard;
		}
		int yDistance = (2 * stepIndex * absDelta.y + steps) / (2 * steps);
		int expectedY = v_lineStart.y + (delta.y < 0 ? -yDistance : yDistance);
		if (pixelCoord.y != expectedY) {
			discard;
		}
	} else {
		stepIndex = delta.y < 0 ? v_lineStart.y - pixelCoord.y : pixelCoord.y - v_lineStart.y;
		if (stepIndex < 0 || stepIndex > steps) {
			discard;
		}
		int xDistance = (2 * stepIndex * delta.x + steps - 1) / (2 * steps);
		if (pixelCoord.x != v_lineStart.x + xDistance) {
			discard;
		}
	}
	uvec3 src5 = rgb8ToRgb5(uvec3((v_colorBase + stepIndex * v_colorStep) / 4096), pixelCoord);
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
