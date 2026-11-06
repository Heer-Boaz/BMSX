precision highp float;
attribute vec2 a_position;
attribute vec2 a_texcoord;
attribute vec4 a_color;
uniform vec2 u_resolution;
varying vec2 v_texcoord;
varying vec4 v_color;
void main() {
	vec2 clip = ((a_position / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0);
	gl_Position = vec4(clip, 0.0, 1.0);
	v_texcoord = a_texcoord;
	v_color = a_color;
}
