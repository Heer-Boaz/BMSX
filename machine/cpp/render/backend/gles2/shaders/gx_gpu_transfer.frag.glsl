precision highp float;

uniform sampler2D u_source;
uniform sampler2D u_vram;
uniform float u_checkMaskBit;
uniform float u_setMaskBit;
varying vec2 v_texcoord;

const vec2 VRAM_SIZE = vec2(1024.0, 512.0);

float rawSourceLogicalWord(vec2 logicalCoord) {
	vec2 wrapped = mod(logicalCoord, VRAM_SIZE);
	vec2 storage = vec2(wrapped.x, VRAM_SIZE.y - 1.0 - wrapped.y);
	vec4 rawPixel = texture2D(u_source, (storage + vec2(0.5)) / VRAM_SIZE);
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256.0;
}

float rawVramStorageWord(vec2 storageCoord) {
	vec2 wrapped = mod(storageCoord, VRAM_SIZE);
	vec4 rawPixel = texture2D(u_vram, (wrapped + vec2(0.5)) / VRAM_SIZE);
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

float wordMaskBit(float word) {
	return floor(word / 32768.0);
}

vec4 encodeRgb555(vec3 color5, float outputMaskBit) {
	float lowByte = mod(color5.r + color5.g * 32.0, 256.0);
	float highByte = floor(color5.g / 8.0) + color5.b * 4.0 + outputMaskBit * 128.0;
	return vec4(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}

void main() {
	float sourceWord = rawSourceLogicalWord(v_texcoord);
	if (u_checkMaskBit > 0.5) {
		float dstWord = rawVramStorageWord(gl_FragCoord.xy - vec2(0.5));
		if (wordMaskBit(dstWord) > 0.5) {
			discard;
		}
	}
	float outputMaskBit = u_setMaskBit > 0.5 ? 1.0 : wordMaskBit(sourceWord);
	gl_FragColor = encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}
