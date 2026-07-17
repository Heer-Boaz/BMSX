#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_sourceOffset;
out vec2 v_sourceOffset;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, 1.0 - (a_position.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_sourceOffset = a_sourceOffset;
}
