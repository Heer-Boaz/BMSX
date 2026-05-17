#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

in vec2 v_texcoord;
flat in uint v_surface_id;
flat in uint v_color;

out vec4 outputColor;

const uint VDP_RD_SURFACE_SYSTEM = 0u;
const uint VDP_RD_SURFACE_PRIMARY = 1u;
const uint VDP_RD_SURFACE_SECONDARY = 2u;
const uint VDP_DRAW_SURFACE_SOLID = 4u;

void main() {
	vec4 texColor;
	switch (v_surface_id) {
		case VDP_RD_SURFACE_PRIMARY:
			texColor = texture(u_texture0, v_texcoord);
			break;
		case VDP_RD_SURFACE_SECONDARY:
			texColor = texture(u_texture1, v_texcoord);
			break;
		case VDP_RD_SURFACE_SYSTEM:
			texColor = texture(u_texture2, v_texcoord);
			break;
		case VDP_DRAW_SURFACE_SOLID:
			texColor = vec4(1.0);
			break;
		default:
			texColor = vec4(1.0);
			break;
	}
	vec4 color = vec4(
		float((v_color >> 16u) & 0xffu),
		float((v_color >> 8u) & 0xffu),
		float(v_color & 0xffu),
		float((v_color >> 24u) & 0xffu)
	) * (1.0 / 255.0);
	outputColor = texColor * color;
}
