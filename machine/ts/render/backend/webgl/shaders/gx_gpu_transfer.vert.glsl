#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texcoord;
out vec2 v_texcoord;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, 1.0 - (a_position.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_texcoord = a_texcoord;
}
