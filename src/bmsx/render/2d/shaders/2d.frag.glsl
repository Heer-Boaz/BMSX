#version 300 es
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_slot_id;

out vec4 outputColor;

const uint VDP_2D_SLOT_PRIMARY = 0u;
const uint VDP_2D_SLOT_SYSTEM = 2u;
const uint VDP_2D_DRAW_SOLID = 4u;

void main() {
	vec4 texColor;
	if (v_slot_id == VDP_2D_SLOT_PRIMARY) {
		texColor = texture(u_texture0, v_texcoord);
	} else if (v_slot_id == VDP_2D_SLOT_SYSTEM) {
		texColor = texture(u_texture2, v_texcoord);
	} else if (v_slot_id == VDP_2D_DRAW_SOLID) {
		texColor = vec4(1.0);
	} else {
		texColor = texture(u_texture1, v_texcoord);
	}
	outputColor = texColor * v_color_override;
}
