#version 300 es
precision highp float;

uniform sampler2D u_texture0;
uniform sampler2D u_frame;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_texture_kind;

out vec4 outputColor;

void main() {
	vec4 texColor = vec4(1.0);
	if (v_texture_kind == 1u) texColor = texture(u_texture0, v_texcoord);
	if (v_texture_kind == 2u) texColor = vec4(texture(u_frame, vec2(v_texcoord.x, 1.0 - v_texcoord.y)).rgb, 1.0);
	outputColor = texColor * v_color_override;
}
