precision mediump float;
uniform sampler2D u_texture;
uniform vec4 u_color;
uniform int u_glyph_mode;
uniform float u_screen_range;
varying vec2 v_texcoord;
void main() {
	vec4 sampleColor = texture2D(u_texture, v_texcoord);
	if (u_glyph_mode == 1) sampleColor.rgb = vec3(1.0);
	if (u_glyph_mode == 2) {
		vec3 distance = sampleColor.rgb;
		float median = max(min(distance.r, distance.g), min(max(distance.r, distance.g), distance.b));
		sampleColor = vec4(1.0, 1.0, 1.0, clamp(u_screen_range * (median - 0.5) + 0.5, 0.0, 1.0));
	}
	gl_FragColor = sampleColor * u_color;
}
