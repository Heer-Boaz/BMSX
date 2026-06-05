#version 300 es
precision highp float;

uniform sampler2D u_texture;

in vec2 v_texcoord;
out vec4 outputColor;

void main() {
	vec4 color = texture(u_texture, v_texcoord);
	outputColor = vec4(color.rgb, 1.0);
}
