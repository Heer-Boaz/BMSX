#version 300 es
precision highp float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_textpage_id;

out vec4 outputColor;
// Frame-shared UBO with ambient
layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta; // x=time, y=delta
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos; // xyz, pad
	vec4 u_ambient_frame; // rgb,intensity
};
// Ambient uniforms kept for future re-enable; disabled for now.
// uniform int u_spriteAmbientEnabled;  // 0/1
// uniform float u_spriteAmbientFactor; // 0..1

const uint ENGINE_ATLAS_ID = 254u;

void main() {
	vec4 texColor;
	switch (v_textpage_id) {
		case 0u: // Use the first texture if textpage ID is 0
			texColor = texture(u_texture0, v_texcoord);
			break;
		case ENGINE_ATLAS_ID:
			texColor = texture(u_texture2, v_texcoord);
			break;
		default: // Default to the secondary textpage for any other textpage ID
			texColor = texture(u_texture1, v_texcoord);
			break;
		}
	texColor *= v_color_override;
	// Ambient sprites disabled; re-enable by restoring the mix below.
	// if (u_spriteAmbientEnabled == 1) {
	// 	float f = clamp(u_spriteAmbientFactor, 0.0, 1.0);
	// 	texColor.rgb *= mix(vec3(1.0), u_ambient_frame.rgb * u_ambient_frame.a, f);
	// }

	outputColor = texColor;
}
