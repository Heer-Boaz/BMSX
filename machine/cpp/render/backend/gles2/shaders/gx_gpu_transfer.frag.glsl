#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
precision highp int;
#else
precision mediump float;
precision mediump int;
#endif

#include "gx_gpu_words.glsl"

uniform sampler2D u_source;
uniform sampler2D u_vram;
uniform int u_checkMaskBit;
uniform int u_setMaskBit;
#ifdef GX_GPU_VRAM_ALIAS
uniform int u_logicalYBase;
#endif
varying vec2 v_sourceOffset;

int wrapPeriod(int value, int period) {
	int wrapped = value - (value / period) * period;
	return wrapped < 0 ? wrapped + period : wrapped;
}

ivec2 rawSourceLogicalWord(ivec2 logicalCoord) {
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
	ivec2 wrapped = ivec2(wrapPeriod(logicalCoord.x, GX_GPU_VRAM_X_ADDRESS_PERIOD),
		wrapPeriod(logicalCoord.y, GX_GPU_TRANSFER_HEIGHT));
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
	return ivec2(lowByte, highByte);
#else
	return gxWordBytes(rawPixel);
#endif
}

ivec2 rawVramStorageWord(ivec2 storageCoord) {
	vec4 rawPixel = texture2D(
		u_vram,
		(vec2(storageCoord) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS)));
	return gxWordBytes(rawPixel);
}





void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
	ivec2 destinationLogical = storageCoord;
#ifdef GX_GPU_VRAM_ALIAS
	destinationLogical.y += u_logicalYBase;
#endif
	ivec2 sourceWord = rawSourceLogicalWord(destinationLogical + ivec2(v_sourceOffset));
	if (u_checkMaskBit != 0 && rawVramStorageWord(storageCoord).y / 128 != 0) {
		discard;
	}
	int outputMaskBit = u_setMaskBit != 0 ? 1 : sourceWord.y / 128;
	gl_FragColor = encodeRgb555(decodeRgb555To5(sourceWord), outputMaskBit);
}
