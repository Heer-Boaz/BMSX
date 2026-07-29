#version 300 es
precision highp float;
precision highp int;

in vec2 a_position;
in vec2 a_sourceOffset;
flat out ivec2 v_sourceOffset;

void main() {
	vec2 clip = vec2(
		(a_position.x / (float(GX_GPU_VRAM_X_ADDRESS_PERIOD) * 0.5)) - 1.0,
		(a_position.y / (float(GX_GPU_VRAM_Y_ADDRESS_PERIOD) * 0.5)) - 1.0
	);
	gl_Position = vec4(clip, 0.0, 1.0);
	v_sourceOffset = ivec2(a_sourceOffset);
}
