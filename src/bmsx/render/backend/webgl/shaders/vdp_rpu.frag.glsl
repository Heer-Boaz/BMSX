#version 300 es
precision highp float;
uniform sampler2D u_t0;
uniform int u_textureEnabled;
uniform int u_textureFlipY;
uniform int u_lightingMode;
uniform vec4 u_c1[16];
in vec2 v_uv0;
in vec4 v_color;
in vec3 v_normal;
out vec4 outColor;
void main() {
	outColor = v_color;
	if (u_textureEnabled != 0) {
		vec2 sampleUv = u_textureFlipY != 0 ? vec2(v_uv0.x, 1.0 - v_uv0.y) : v_uv0;
		outColor *= texture(u_t0, sampleUv);
	}
	if (u_lightingMode != 0) {
		vec3 n = normalize(v_normal);
		vec3 l = normalize(u_c1[0].xyz);
		float ndl = max(dot(n, l), 0.0);
		outColor *= u_c1[1] + u_c1[2] * ndl;
	}
	if (outColor.a <= 0.0) {
		discard;
	}
}
