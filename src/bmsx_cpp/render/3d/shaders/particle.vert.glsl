precision mediump float;

attribute vec3 a_position;
attribute vec2 a_uv;
attribute float a_textpage_id;
attribute vec4 a_color;
attribute float a_ambient_mode;
attribute float a_ambient_factor;

uniform mat4 u_viewProjection;

varying vec2 v_texcoord;
varying vec4 v_color;
varying float v_textpage_id;
varying float v_ambient_mode;
varying float v_ambient_factor;

void main() {
	gl_Position = u_viewProjection * vec4(a_position, 1.0);
	v_texcoord = a_uv;
	v_color = a_color;
	v_textpage_id = a_textpage_id;
	v_ambient_mode = a_ambient_mode;
	v_ambient_factor = a_ambient_factor;
}
