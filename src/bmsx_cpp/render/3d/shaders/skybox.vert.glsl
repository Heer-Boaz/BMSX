precision mediump float;

attribute vec3 a_position;

uniform mat4 u_view;
uniform mat4 u_projection;

varying vec3 v_texcoord;

void main() {
	v_texcoord = (u_view * vec4(a_position, 0.0)).xyz;
	vec4 pos = u_projection * vec4(a_position, 1.0);
	gl_Position = pos.xyww;
}
