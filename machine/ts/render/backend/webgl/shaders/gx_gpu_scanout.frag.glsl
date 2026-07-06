#version 300 es
precision mediump float;

uniform sampler2D u_vram;
in vec2 v_texcoord;
out vec4 outputColor;

void main() {
	vec4 rawPixel = texture(u_vram, v_texcoord);
	float lowByte = floor(rawPixel.r * 255.0 + 0.5);
	float highByte = floor(rawPixel.g * 255.0 + 0.5);
	float r5 = mod(lowByte, 32.0);
	float g5 = floor(lowByte / 32.0) + mod(highByte, 4.0) * 8.0;
	float b5 = mod(floor(highByte / 4.0), 32.0);
	vec3 color5 = vec3(r5, g5, b5);
	vec3 rgb8 = color5 * 8.0 + floor(color5 / 4.0);
	outputColor = vec4(rgb8 / 255.0, 1.0);
}
