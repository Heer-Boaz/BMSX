precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_slot_id;

const float VDP_2D_SLOT_PRIMARY = 0.0;
const float VDP_2D_SLOT_SYSTEM = 2.0;
const float VDP_2D_DRAW_SOLID = 4.0;

void main() {
	vec4 texColor;
	if (v_slot_id == VDP_2D_SLOT_PRIMARY) {
		texColor = texture2D(u_texture0, v_texcoord);
	} else if (v_slot_id == VDP_2D_SLOT_SYSTEM) {
		texColor = texture2D(u_texture2, v_texcoord);
	} else if (v_slot_id == VDP_2D_DRAW_SOLID) {
		texColor = vec4(1.0);
	} else {
		texColor = texture2D(u_texture1, v_texcoord);
	}
	gl_FragColor = texColor * v_color_override;
}
