precision highp float;
precision highp int;

uniform sampler2D u_source;
uniform sampler2D u_vram;
uniform int u_checkMaskBit;
uniform int u_setMaskBit;
varying vec2 v_sourceOffset;

int wrap1024(int value) {
	int wrapped = value - (value / 1024) * 1024;
	return wrapped < 0 ? wrapped + 1024 : wrapped;
}

int rawSourceLogicalWord(ivec2 logicalCoord) {
	ivec2 wrapped = ivec2(wrap1024(logicalCoord.x), wrap1024(logicalCoord.y));
	vec4 rawPixel = texture2D(u_source, (vec2(wrapped) + vec2(0.5)) / 1024.0);
	int lowByte = int(rawPixel.r * 255.0 + 0.5);
	int highByte = int(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256;
}

int rawVramStorageWord(ivec2 storageCoord) {
	vec4 rawPixel = texture2D(u_vram, (vec2(storageCoord) + vec2(0.5)) / 1024.0);
	int lowByte = int(rawPixel.r * 255.0 + 0.5);
	int highByte = int(rawPixel.g * 255.0 + 0.5);
	return lowByte + highByte * 256;
}

ivec3 decodeRgb555To5(int word) {
	return ivec3(
		word - (word / 32) * 32,
		(word / 32) - (word / 1024) * 32,
		(word / 1024) - (word / 32768) * 32
	);
}

vec4 encodeRgb555(ivec3 color5, int outputMaskBit) {
	int word = color5.x + color5.y * 32 + color5.z * 1024 + outputMaskBit * 32768;
	int highByte = word / 256;
	int lowByte = word - highByte * 256;
	return vec4(float(lowByte) / 255.0, float(highByte) / 255.0, 0.0, 1.0);
}

void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
	ivec2 destinationLogical = storageCoord;
	int sourceWord = rawSourceLogicalWord(destinationLogical + ivec2(v_sourceOffset));
	if (u_checkMaskBit != 0 && rawVramStorageWord(storageCoord) / 32768 != 0) {
		discard;
	}
	int outputMaskBit = u_setMaskBit != 0 ? 1 : sourceWord / 32768;
	gl_FragColor = encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}
