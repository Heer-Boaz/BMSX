#version 300 es
precision highp float;

uniform sampler2D u_vram;
uniform float u_blendEnable;
uniform float u_blendMode;
uniform float u_checkMaskBit;
uniform float u_setMaskBit;
uniform float u_ditherEnable;
uniform float u_interlacedRenderWord;
in vec2 v_lineStart;
in vec2 v_lineEnd;
in vec3 v_color0;
in vec3 v_color1;
out vec4 outputColor;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);

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

float maskBit(float word) {
	return floor(word / 32768.0);
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

vec3 rgbToRgb5(vec3 rgb) {
	vec3 rgb8 = floor(rgb * 255.0);
	if (u_ditherEnable > 0.5) {
		rgb8 = clamp(rgb8 + vec3(ditherOffset()), vec3(0.0), vec3(255.0));
	}
	return floor(rgb8 / 8.0);
}

vec4 encodeRgb555(vec3 color5, float outputMaskBit) {
	float lowByte = mod(color5.r + color5.g * 32.0, 256.0);
	float highByte = floor(color5.g / 8.0) + color5.b * 4.0 + outputMaskBit * 128.0;
	return vec4(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}

float lineAxisT(vec2 pixelCoord, vec2 delta, vec2 absDelta) {
	if (absDelta.x >= absDelta.y) {
		return (pixelCoord.x - v_lineStart.x) / delta.x;
	}
	return (pixelCoord.y - v_lineStart.y) / delta.y;
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
	vec2 pixelCoord = vec2(gl_FragCoord.x - 0.5, VRAM_SIZE.y - gl_FragCoord.y - 0.5);
	vec2 delta = v_lineEnd - v_lineStart;
	vec2 absDelta = abs(delta);
	float major = max(absDelta.x, absDelta.y);
	float t = 0.0;

	if (major < 0.5) {
		if (abs(pixelCoord.x - v_lineStart.x) > 0.25 || abs(pixelCoord.y - v_lineStart.y) > 0.25) {
			discard;
		}
	} else {
		t = lineAxisT(pixelCoord, delta, absDelta);
		if (t < -0.0001 || t > 1.0001) {
			discard;
		}
		vec2 lineCoord = v_lineStart + delta * t;
		if (absDelta.x >= absDelta.y) {
			if (abs(pixelCoord.y - floor(lineCoord.y + 0.5)) > 0.25) {
				discard;
			}
		} else if (abs(pixelCoord.x - floor(lineCoord.x + 0.5)) > 0.25) {
			discard;
		}
	}

	vec3 src5 = rgbToRgb5(mix(v_color0, v_color1, clamp(t, 0.0, 1.0)));
	float dstWord = 0.0;
	if (u_checkMaskBit > 0.5 || u_blendEnable > 0.5) {
		dstWord = rawStorageVramWord(gl_FragCoord.xy - vec2(0.5));
		if (u_checkMaskBit > 0.5 && maskBit(dstWord) > 0.5) {
			discard;
		}
		if (u_blendEnable > 0.5) {
			src5 = blendRgb5(src5, decodeRgb555To5(dstWord));
		}
	}
	outputColor = encodeRgb555(src5, u_setMaskBit);
}
