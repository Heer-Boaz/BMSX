precision highp float;

attribute vec2 a_position;
attribute vec4 a_color;
attribute vec2 a_texcoord;
varying vec4 v_color;
varying vec2 v_texcoord;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, 1.0 - (a_position.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_color = a_color;
	v_texcoord = a_texcoord;
}
