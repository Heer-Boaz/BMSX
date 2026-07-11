#version 300 es
precision highp float;

in vec2 a_corner;

in vec2 i_origin;
in vec2 i_axis_x;
in vec2 i_axis_y;
in vec2 i_uv0;
in vec2 i_uv1;
in uint i_texture_kind;
in vec4 i_color;

layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta;
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos;
	vec4 u_ambient_frame;
};

out vec2 v_texcoord;
out vec4 v_color_override;
flat out uint v_texture_kind;

void main() {
	vec2 cornerPosition = i_origin + i_axis_x * a_corner.x + i_axis_y * a_corner.y;
	vec2 clipSpace = ((cornerPosition / u_logicalSize) * 2.0 - 1.0) * vec2(1.0, -1.0);
	gl_Position = vec4(clipSpace, 0.0, 1.0);
	v_texcoord = mix(i_uv0, i_uv1, a_corner);
	v_color_override = i_color;
	v_texture_kind = i_texture_kind;
}
