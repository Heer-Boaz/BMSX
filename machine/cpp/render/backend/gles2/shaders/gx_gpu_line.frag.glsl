#ifdef GX_GPU_FRAMEBUFFER_FETCH_ARM
#extension GL_ARM_shader_framebuffer_fetch : require
#endif

precision highp float;
precision highp int;

uniform sampler2D u_vram;
uniform int u_blendEnable;
uniform int u_blendMode;
uniform int u_checkMaskBit;
uniform int u_setMaskBit;
uniform int u_ditherEnable;
uniform int u_skippedLineParity;
varying vec2 v_lineStart;
varying vec2 v_lineEnd;
varying vec3 v_colorBase;
varying vec3 v_colorStep;

int absolute(int value) {
	return value < 0 ? -value : value;
}

int clampByte(int value) {
	return value < 0 ? 0 : (value > 255 ? 255 : value);
}

int clampColor5(int value) {
	return value < 0 ? 0 : (value > 31 ? 31 : value);
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

ivec3 rgb8ToRgb5(ivec3 rgb8, ivec2 logicalCoord) {
	if (u_ditherEnable != 0) {
		int dither = ditherOffset(logicalCoord);
		rgb8 = ivec3(clampByte(rgb8.x + dither), clampByte(rgb8.y + dither), clampByte(rgb8.z + dither));
	}
	return ivec3(rgb8.x / 8, rgb8.y / 8, rgb8.z / 8);
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
	ivec2 pixelCoord = storageCoord;
	if (pixelCoord.y - (pixelCoord.y / 2) * 2 == u_skippedLineParity) {
		discard;
	}
	ivec2 lineStart = ivec2(v_lineStart);
	ivec2 delta = ivec2(v_lineEnd) - lineStart;
	ivec2 absDelta = ivec2(absolute(delta.x), absolute(delta.y));
	int steps = absDelta.x > absDelta.y ? absDelta.x : absDelta.y;
	int stepIndex = 0;
	if (steps == 0) {
		if (pixelCoord.x != lineStart.x || pixelCoord.y != lineStart.y) {
			discard;
		}
	} else if (absDelta.x >= absDelta.y) {
		stepIndex = pixelCoord.x - lineStart.x;
		if (stepIndex < 0 || stepIndex > steps) {
			discard;
		}
		int yDistance = (2 * stepIndex * absDelta.y + steps) / (2 * steps);
		int expectedY = lineStart.y + (delta.y < 0 ? -yDistance : yDistance);
		if (pixelCoord.y != expectedY) {
			discard;
		}
	} else {
		stepIndex = delta.y < 0 ? lineStart.y - pixelCoord.y : pixelCoord.y - lineStart.y;
		if (stepIndex < 0 || stepIndex > steps) {
			discard;
		}
		int xDistance = (2 * stepIndex * delta.x + steps - 1) / (2 * steps);
		if (pixelCoord.x != lineStart.x + xDistance) {
			discard;
		}
	}
	ivec3 colorBase = ivec3(v_colorBase);
	ivec3 colorStep = ivec3(v_colorStep);
	ivec3 rgb8 = ivec3(
		(colorBase.x + stepIndex * colorStep.x) / 4096,
		(colorBase.y + stepIndex * colorStep.y) / 4096,
		(colorBase.z + stepIndex * colorStep.z) / 4096
	);
	ivec3 src5 = rgb8ToRgb5(rgb8, pixelCoord);
	if (u_checkMaskBit != 0 || u_blendEnable != 0) {
		int dstWord = rawStorageVramWord(storageCoord);
		if (u_checkMaskBit != 0 && dstWord / 32768 != 0) {
			discard;
		}
		if (u_blendEnable != 0) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	gl_FragColor = encodeRgb555(src5, u_setMaskBit);
}
