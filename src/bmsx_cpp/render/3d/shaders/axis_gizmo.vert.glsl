precision mediump float;

attribute vec3 a_position;
attribute vec3 a_color;

uniform mat4 u_view;
uniform float u_aspect;
uniform float u_size;
uniform vec2 u_offset;

varying vec3 v_color;

void main() {
	vec3 v = (u_view * vec4(a_position, 0.0)).xyz;
	vec2 p = vec2(v.x / max(1e-6, u_aspect), v.y);
	gl_Position = vec4(u_offset + p * u_size, 0.0, 1.0);
	v_color = a_color;
}
