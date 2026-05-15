#version 300 es
precision mediump float;

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec4 a_color;

uniform mat4 u_model;
uniform mat3 u_normalMatrix;
uniform mat4 u_viewProjection;

out vec2 v_uv;
out vec3 v_normal;
out vec3 v_worldPos;
out vec4 v_color;

void main() {
	vec4 world = u_model * vec4(a_position, 1.0);
	v_uv = a_uv;
	v_color = a_color;
	v_worldPos = world.xyz;
	v_normal = normalize(u_normalMatrix * a_normal);
	gl_Position = u_viewProjection * world;
}
