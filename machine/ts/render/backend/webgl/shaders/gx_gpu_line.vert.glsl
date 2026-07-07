#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_lineStart;
in vec2 a_lineEnd;
in vec3 a_color0;
in vec3 a_color1;
out vec2 v_lineStart;
out vec2 v_lineEnd;
out vec3 v_color0;
out vec3 v_color1;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, 1.0 - (a_position.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_lineStart = a_lineStart;
	v_lineEnd = a_lineEnd;
	v_color0 = a_color0;
	v_color1 = a_color1;
}
