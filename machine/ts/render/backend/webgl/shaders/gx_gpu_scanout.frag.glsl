#version 300 es
precision highp float;

uniform sampler2D u_vram;
uniform float u_displayModeWord;
uniform vec2 u_displayStart;
in vec2 v_texcoord;
out vec4 outputColor;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);
const float DISPLAY_MODE_RGB24_BIT = 16.0;

float rawWordFromPixel(vec4 rawPixel) {
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

float rawWordAtLogical(float x, float y) {
	vec2 texcoord = vec2((x + 0.5) / VRAM_SIZE.x, 1.0 - (y + 0.5) / VRAM_SIZE.y);
	return rawWordFromPixel(texture(u_vram, texcoord));
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

vec3 rgb888AtDisplayPixel() {
	float outputX = floor(v_texcoord.x * VRAM_SIZE.x - u_displayStart.x);
	float sourceY = floor((1.0 - v_texcoord.y) * VRAM_SIZE.y);
	float wordX = u_displayStart.x + floor(outputX * 1.5);
	float word0 = rawWordAtLogical(wordX, sourceY);
	float word1 = rawWordAtLogical(wordX + 1.0, sourceY);
	float low0 = mod(word0, 256.0);
	float high0 = floor(word0 / 256.0);
	float low1 = mod(word1, 256.0);
	float high1 = floor(word1 / 256.0);
	if (mod(outputX, 2.0) < 0.5) {
		return vec3(low0, high0, low1);
	}
	return vec3(high0, low1, high1);
}

void main() {
	vec3 rgb8;
	if (mod(floor(u_displayModeWord / DISPLAY_MODE_RGB24_BIT), 2.0) > 0.5) {
		rgb8 = rgb888AtDisplayPixel();
	} else {
		rgb8 = rgb555ToRgb8(rawWordFromPixel(texture(u_vram, v_texcoord)));
	}
	outputColor = vec4(rgb8 / 255.0, 1.0);
}
