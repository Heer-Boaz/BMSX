#version 300 es
precision highp float;

uniform sampler2D u_texture0;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_slot_id;

out vec4 outputColor;

void main() {
	float keepInstanceLayout = float(v_slot_id) * 0.0;
	outputColor = texture(u_texture0, v_texcoord) * v_color_override + vec4(keepInstanceLayout);
}
