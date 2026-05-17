precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_surface_id;

const float VDP_RD_SURFACE_SYSTEM = 0.0;
const float VDP_RD_SURFACE_PRIMARY = 1.0;
const float VDP_RD_SURFACE_SECONDARY = 2.0;
const float VDP_DRAW_SURFACE_SOLID = 4.0;

void main() {
	vec4 texColor;
	if (v_surface_id == VDP_RD_SURFACE_PRIMARY) {
		texColor = texture2D(u_texture0, v_texcoord);
	} else if (v_surface_id == VDP_RD_SURFACE_SECONDARY) {
		texColor = texture2D(u_texture1, v_texcoord);
	} else if (v_surface_id == VDP_RD_SURFACE_SYSTEM) {
		texColor = texture2D(u_texture2, v_texcoord);
	} else if (v_surface_id == VDP_DRAW_SURFACE_SOLID) {
		texColor = vec4(1.0);
	} else {
		texColor = vec4(1.0);
	}
	gl_FragColor = texColor * v_color_override;
}
