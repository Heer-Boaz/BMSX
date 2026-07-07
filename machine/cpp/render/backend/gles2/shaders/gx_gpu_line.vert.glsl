precision highp float;

attribute vec2 a_position;
attribute vec2 a_lineStart;
attribute vec2 a_lineEnd;
attribute vec3 a_color0;
attribute vec3 a_color1;
varying vec2 v_lineStart;
varying vec2 v_lineEnd;
varying vec3 v_color0;
varying vec3 v_color1;

void main() {
	vec2 clip = vec2((a_position.x / 512.0) - 1.0, 1.0 - (a_position.y / 256.0));
	gl_Position = vec4(clip, 0.0, 1.0);
	v_lineStart = a_lineStart;
	v_lineEnd = a_lineEnd;
	v_color0 = a_color0;
	v_color1 = a_color1;
}
