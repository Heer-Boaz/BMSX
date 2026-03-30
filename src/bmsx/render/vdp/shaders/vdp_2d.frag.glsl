#version 300 es
precision highp float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

in vec2 v_texcoord;
in vec4 v_color_override;
in float v_priority;
flat in uint v_atlas_id;

out vec4 outputColor;
layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta; // x=time, y=delta
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos; // xyz, pad
	vec4 u_ambient_frame; // rgb,intensity
};

const uint ENGINE_ATLAS_ID = 254u;

void main() {
	vec4 texColor;
	switch (v_atlas_id) {
		case 0u:
			texColor = texture(u_texture0, v_texcoord);
			break;
		case ENGINE_ATLAS_ID:
			texColor = texture(u_texture2, v_texcoord);
			break;
		default:
			texColor = texture(u_texture1, v_texcoord);
			break;
	}
	texColor *= v_color_override;
	outputColor = texColor;
	gl_FragDepth = v_priority;
}
