#version 300 es
precision mediump float;

uniform sampler2D u_vram;
in vec2 v_texcoord;
out vec4 outputColor;

void main() {
	outputColor = texture(u_vram, v_texcoord);
}
