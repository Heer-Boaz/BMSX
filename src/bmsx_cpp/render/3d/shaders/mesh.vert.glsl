attribute vec3 a_position;
attribute vec2 a_uv;
attribute vec4 a_color;

uniform mat4 u_model;
uniform mat4 u_viewProjection;

varying vec2 v_uv;
varying vec4 v_color;

void main() {
	v_uv = a_uv;
	v_color = a_color;
	gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
}
