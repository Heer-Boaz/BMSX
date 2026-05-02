#version 300 es
precision highp float;

in vec2 a_corner;

in vec2 i_origin;
in vec2 i_axis_x;
in vec2 i_axis_y;
in vec2 i_uv0;
in vec2 i_uv1;
in uint i_textpage_id;
in vec4 i_color;

uniform float u_scale;

// Frame-shared UBO (std140). Only first fields are used in this shader.
layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta; // x=time, y=delta, z,w unused
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos; // xyz, w pad
	vec4 u_ambient_frame; // rgb,intensity (kept for block parity with FS)
};

out vec2 v_texcoord;
out vec4 v_color_override;
flat out uint v_textpage_id;

void main() {
	vec2 pos = i_origin + i_axis_x * a_corner.x + i_axis_y * a_corner.y;
	vec2 scaledPosition = pos * u_scale;
	vec2 clipSpace = ((scaledPosition / u_logicalSize) * 2.0 - 1.0) * vec2(1.0, -1.0);

	gl_Position = vec4(clipSpace, 0.0, 1.0);
	v_texcoord = mix(i_uv0, i_uv1, a_corner);
	v_color_override = i_color;
	v_textpage_id = i_textpage_id;
}
