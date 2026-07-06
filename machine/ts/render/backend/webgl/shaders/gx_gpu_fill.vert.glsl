#version 300 es
precision mediump float;

in vec2 a_position;
in vec4 a_color;
out vec4 v_color;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, 1.0 - (a_position.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_color = a_color;
}
