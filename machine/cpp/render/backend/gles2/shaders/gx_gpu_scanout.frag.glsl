precision highp float;

uniform sampler2D u_vram;
uniform sampler2D u_display2_vram;
uniform vec4 u_display;
uniform vec4 u_display2;
uniform vec2 u_display2_size;
uniform vec4 u_interlace;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);

float rawWordFromPixel(vec4 rawPixel) {
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

float rawWordAtLogical(float x, float y) {
	vec2 vramCoord = mod(vec2(x, y), VRAM_SIZE);
	vec2 texcoord = vec2((vramCoord.x + 0.5) / VRAM_SIZE.x, 1.0 - (vramCoord.y + 0.5) / VRAM_SIZE.y);
	return rawWordFromPixel(texture2D(u_vram, texcoord));
}

float display2RawWordAtLogical(float x, float y) {
	vec2 vramCoord = mod(vec2(x, y), VRAM_SIZE);
	vec2 texcoord = vec2((vramCoord.x + 0.5) / VRAM_SIZE.x, 1.0 - (vramCoord.y + 0.5) / VRAM_SIZE.y);
	return rawWordFromPixel(texture2D(u_display2_vram, texcoord));
}

vec3 rgb555ToRgb8(float word) {
	float lowByte = mod(word, 256.0);
	float highByte = floor(word / 256.0);
	float r5 = mod(lowByte, 32.0);
	float g5 = floor(lowByte / 32.0) + mod(highByte, 4.0) * 8.0;
	float b5 = mod(floor(highByte / 4.0), 32.0);
	vec3 color5 = vec3(r5, g5, b5);
	return color5 * 8.0 + floor(color5 / 4.0);
}

vec3 rgb888AtSourcePixel(float sourceX, float sourceY) {
	float wordX = u_display.x + floor(sourceX * 1.5);
	float word0 = rawWordAtLogical(wordX, sourceY);
	float word1 = rawWordAtLogical(wordX + 1.0, sourceY);
	float low0 = mod(word0, 256.0);
	float high0 = floor(word0 / 256.0);
	float low1 = mod(word1, 256.0);
	float high1 = floor(word1 / 256.0);
	if (mod(sourceX, 2.0) < 0.5) {
		return vec3(low0, high0, low1);
	}
	return vec3(high0, low1, high1);
}

vec4 composeDisplay2(vec4 primary, float outputX, float outputY) {
	if (u_display2.z < 0.5 || outputX >= u_display2_size.x || outputY >= u_display2_size.y) {
		return primary;
	}
	float word = display2RawWordAtLogical(u_display2.x + outputX, u_display2.y + outputY);
	if (word < 32768.0) {
		return primary;
	}
	return vec4(rgb555ToRgb8(word) / 255.0, 1.0);
}

void main() {
#if defined(GX_GPU_INTERLACED_WEAVE)
	float fieldHeight = u_interlace.x;
	float outputY = floor(u_interlace.y - gl_FragCoord.y);
	float field = mod(outputY, 2.0);
	float fieldLine = floor(outputY / 2.0);
	float storedY = field * fieldHeight + fieldHeight - 1.0 - fieldLine;
	vec4 primary = texture2D(u_vram, vec2(gl_FragCoord.x / u_interlace.z, (storedY + 0.5) / u_interlace.y));
	gl_FragColor = composeDisplay2(primary, floor(gl_FragCoord.x), outputY);
#elif defined(GX_GPU_INTERLACED_FIELD)
	if (u_interlace.w > 0.5) {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
		return;
	}
	float sourceX = floor(gl_FragCoord.x);
	float fieldLine = floor(u_interlace.x - (gl_FragCoord.y - u_interlace.z * u_interlace.x));
	float sourceY = u_display.y + u_interlace.z * (u_interlace.y - 1.0) + fieldLine * u_interlace.y;
	vec3 rgb8;
	if (u_display.w > 0.5) {
		rgb8 = rgb888AtSourcePixel(sourceX, sourceY);
	} else {
		rgb8 = rgb555ToRgb8(rawWordAtLogical(u_display.x + sourceX, sourceY));
	}
	gl_FragColor = vec4(rgb8 / 255.0, 1.0);
#else
	float sourceX = floor(gl_FragCoord.x);
	float outputY = floor(u_display.z - gl_FragCoord.y);
	if (u_display2.w > 0.5) {
		gl_FragColor = composeDisplay2(vec4(0.0, 0.0, 0.0, 1.0), sourceX, outputY);
		return;
	}
	float sourceY = u_display.y + outputY;
	vec3 rgb8;
	if (u_display.w > 0.5) {
		rgb8 = rgb888AtSourcePixel(sourceX, sourceY);
	} else {
		rgb8 = rgb555ToRgb8(rawWordAtLogical(u_display.x + sourceX, sourceY));
	}
	gl_FragColor = composeDisplay2(vec4(rgb8 / 255.0, 1.0), sourceX, outputY);
#endif
}
