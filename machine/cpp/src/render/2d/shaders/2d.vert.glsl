precision highp float;

attribute vec2 a_corner;

attribute vec2 i_origin;
attribute vec2 i_axis_x;
attribute vec2 i_axis_y;
attribute vec2 i_uv0;
attribute vec2 i_uv1;
attribute float i_slot_id;
attribute vec4 i_color;

uniform float u_scale;
uniform vec2 u_logical_size;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_slot_id;

void main() {
	vec2 pos = i_origin + i_axis_x * a_corner.x + i_axis_y * a_corner.y;
	vec2 scaledPosition = pos * u_scale;
	vec2 clipSpace = ((scaledPosition / u_logical_size) * 2.0 - 1.0) * vec2(1.0, -1.0);

	gl_Position = vec4(clipSpace, 0.0, 1.0);
	v_texcoord = mix(i_uv0, i_uv1, a_corner);
	v_color_override = i_color;
	v_slot_id = i_slot_id;
}
