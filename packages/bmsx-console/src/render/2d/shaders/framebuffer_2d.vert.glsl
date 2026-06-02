#version 300 es
precision mediump float;

in vec2 a_position;
in vec2 a_texcoord;

uniform highp vec2 u_resolution;
uniform float u_scale;

out vec2 v_texcoord;

void main() {
	vec2 scaledPosition = a_position * u_scale;
	vec2 clipSpace = ((scaledPosition / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0);
	gl_Position = vec4(clipSpace, 0.0, 1.0);
	v_texcoord = a_texcoord;
}
