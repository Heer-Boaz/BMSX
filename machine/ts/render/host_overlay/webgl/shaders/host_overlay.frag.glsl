#version 300 es
precision highp float;

uniform sampler2D u_texture0;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_texture_kind;

out vec4 outputColor;

void main() {
	vec4 texColor = v_texture_kind == 0u ? vec4(1.0) : texture(u_texture0, v_texcoord);
	outputColor = texColor * v_color_override;
}
