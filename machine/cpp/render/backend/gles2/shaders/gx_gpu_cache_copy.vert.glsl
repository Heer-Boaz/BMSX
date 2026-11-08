precision highp float;
attribute vec2 a_position;
uniform vec4 u_region;
varying mediump vec2 v_uv;
void main() {
	gl_Position = vec4(a_position, 0.0, 1.0);
	v_uv = u_region.xy + (a_position * 0.5 + 0.5) * u_region.zw;
}
