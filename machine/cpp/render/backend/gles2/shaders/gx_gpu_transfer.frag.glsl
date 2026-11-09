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
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
varying mediump vec2 v_sourceUv;
#else
varying vec2 v_sourceOffset;

int wrapPeriod(int value, int period) {
	int wrapped = value - (value / period) * period;
	return wrapped < 0 ? wrapped + period : wrapped;
}

vec4 rawSourceLogicalPixel(ivec2 logicalCoord) {
	ivec2 wrapped = ivec2(
		wrapPeriod(logicalCoord.x, GX_GPU_VRAM_X_ADDRESS_PERIOD),
		wrapPeriod(logicalCoord.y, GX_GPU_VRAM_TEXTURE_ROWS));
	return texture2D(
		u_source,
		(vec2(wrapped) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS)));
}
#endif

vec4 rawVramStoragePixel(ivec2 storageCoord) {
	return texture2D(
		u_vram,
		(vec2(storageCoord) + vec2(0.5))
			/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_VRAM_TEXTURE_ROWS)));
}





void main() {
	ivec2 storageCoord = ivec2(gl_FragCoord.xy);
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
	vec4 sourcePixel = texture2D(u_source, v_sourceUv);
#else
	ivec2 destinationLogical = storageCoord;
#ifdef GX_GPU_VRAM_ALIAS
	destinationLogical.y += u_logicalYBase;
#endif
	vec4 sourcePixel = rawSourceLogicalPixel(destinationLogical + ivec2(v_sourceOffset));
#endif
	// RGBA4444 already is the exact word representation used by the target.
	// Bit 15 is the high bit of the red nibble; no RGB555 conversion is needed.
	if (u_checkMaskBit != 0 && rawVramStoragePixel(storageCoord).r >= 0.5) {
		discard;
	}
	if (u_setMaskBit != 0 && sourcePixel.r < 0.5) sourcePixel.r += 8.0 / 15.0;
	gl_FragColor = sourcePixel;
}
