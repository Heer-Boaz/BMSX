precision highp float;
precision highp int;

uniform sampler2D u_source;
uniform sampler2D u_vram;
uniform int u_checkMaskBit;
uniform int u_setMaskBit;
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
uniform ivec4 u_upload;
#endif
#ifdef GX_GPU_VRAM_ALIAS
uniform int u_logicalYBase;
#endif
varying vec2 v_sourceOffset;

int wrapPeriod(int value, int period) {
	int wrapped = value - (value / period) * period;
	return wrapped < 0 ? wrapped + period : wrapped;
}

int rawSourceLogicalWord(ivec2 logicalCoord) {
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
	int logicalX = wrapPeriod(logicalCoord.x - u_upload.x, GX_GPU_VRAM_X_ADDRESS_PERIOD);
	int logicalY = logicalCoord.y - u_upload.y;
	logicalY = logicalY - (logicalY / u_upload.w) * u_upload.w;
	if (logicalY < 0) logicalY += u_upload.w;
	int pixelIndex = logicalY * u_upload.z + logicalX;
	ivec2 wrapped = ivec2(
		wrapPeriod(pixelIndex, GX_GPU_VRAM_X_ADDRESS_PERIOD),
		pixelIndex / GX_GPU_VRAM_X_ADDRESS_PERIOD);
#else
	ivec2 wrapped = ivec2(
		wrapPeriod(logicalCoord.x, GX_GPU_VRAM_X_ADDRESS_PERIOD),
		wrapPeriod(logicalCoord.y, GX_GPU_VRAM_TEXTURE_ROWS));
#endif
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
	vec4 rawPixel = texture2D(
		u_source,
		(vec2(wrapped) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_TRANSFER_HEIGHT)));
#else
	vec4 rawPixel = texture2D(
		u_source,
		(vec2(wrapped) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS)));
#endif
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
	int lowByte = int(rawPixel.r * 255.0 + 0.5);
	int highByte = int(rawPixel.a * 255.0 + 0.5);
	return lowByte + highByte * 256;
#else
	ivec4 nibbles = ivec4(rawPixel * 15.0 + 0.5);
	return nibbles.r * 4096 + nibbles.g * 256 + nibbles.b * 16 + nibbles.a;
#endif
}

int rawVramStorageWord(ivec2 storageCoord) {
	vec4 rawPixel = texture2D(
		u_vram,
		(vec2(storageCoord) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS)));
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
	ivec2 destinationLogical = storageCoord;
#ifdef GX_GPU_VRAM_ALIAS
	destinationLogical.y += u_logicalYBase;
#endif
	int sourceWord = rawSourceLogicalWord(destinationLogical + ivec2(v_sourceOffset));
	if (u_checkMaskBit != 0 && rawVramStorageWord(storageCoord) / 32768 != 0) {
		discard;
	}
	int outputMaskBit = u_setMaskBit != 0 ? 1 : sourceWord / 32768;
	gl_FragColor = encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}
