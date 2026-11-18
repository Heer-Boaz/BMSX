precision highp float;

attribute vec2 a_position;
attribute vec2 a_sourceOffset;
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
varying mediump vec2 v_sourceUv;
#else
varying vec2 v_sourceOffset;
#endif

void main() {
	vec2 clip = vec2(
		a_position.x * 2.0 / float(GX_GPU_VRAM_X_ADDRESS_PERIOD) - 1.0,
		a_position.y * 2.0 / float(GX_GPU_VRAM_Y_ADDRESS_PERIOD) - 1.0
	);
	gl_Position = vec4(clip, 0.0, 1.0);
#ifdef GX_GPU_CPU_UPLOAD_SOURCE
	// Upload quads already split at both packed-source and destination wraps.
	v_sourceUv = (a_position + a_sourceOffset)
		/ vec2(float(GX_GPU_VRAM_X_ADDRESS_PERIOD), float(GX_GPU_TRANSFER_HEIGHT));
#else
	v_sourceOffset = a_sourceOffset;
#endif
}
