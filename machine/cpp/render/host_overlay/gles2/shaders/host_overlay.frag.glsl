precision mediump float;
uniform sampler2D u_texture;
uniform vec4 u_color;
uniform bool u_glyph_coverage;
varying vec2 v_texcoord;
void main() {
	vec4 sampleColor = texture2D(u_texture, v_texcoord);
	if (u_glyph_coverage) sampleColor.rgb = vec3(1.0);
	gl_FragColor = sampleColor * u_color;
}
