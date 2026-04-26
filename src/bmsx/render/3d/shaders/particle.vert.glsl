#version 300 es
precision mediump float;

layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_instancePosSize; // xyz = position, w = size
layout(location = 2) in vec4 a_color;
layout(location = 3) in vec4 a_uvRect; // u0, v0, u1, v1
layout(location = 4) in float a_textpage_id;

uniform mat4 u_viewProjection;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;

out vec4 v_color;
out vec2 v_texcoord;
flat out int v_textpage_id;

void main() {
	vec3 worldPos = a_instancePosSize.xyz +
		(u_cameraRight * a_pos.x + u_cameraUp * a_pos.y) * a_instancePosSize.w;
	gl_Position = u_viewProjection * vec4(worldPos, 1.0);
	v_color = a_color;
	v_texcoord = mix(a_uvRect.xy, a_uvRect.zw, a_pos + vec2(0.5));
	v_textpage_id = int(a_textpage_id + 0.5);
}
