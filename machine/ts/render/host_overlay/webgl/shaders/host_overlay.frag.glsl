#version 300 es
precision highp float;

uniform sampler2D u_texture0;
uniform sampler2D u_frame;
uniform sampler2D u_glyph_coverage;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_texture_kind;

out vec4 outputColor;

void main() {
	vec4 texColor = vec4(1.0);
	if (v_texture_kind == 1u) texColor = texture(u_texture0, v_texcoord);
	if (v_texture_kind == 2u) texColor = vec4(texture(u_frame, vec2(v_texcoord.x, 1.0 - v_texcoord.y)).rgb, 1.0);
	if (v_texture_kind == 3u) texColor = texture(u_frame, v_texcoord);
	// Coverage is linear alpha, not filtered RGB multiplied by alpha twice.
	if (v_texture_kind == 5u) texColor = vec4(1.0, 1.0, 1.0, texture(u_glyph_coverage, v_texcoord).a);
	if (v_texture_kind == 4u) {
		texColor = texture(u_frame, vec2(v_texcoord.x, 1.0 - v_texcoord.y));
		// Mesh targets accumulate premultiplied layers; this pass blends straight alpha.
		if (texColor.a > 0.0) texColor.rgb /= texColor.a;
	}
	outputColor = texColor * v_color_override;
}
