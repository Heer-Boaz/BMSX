precision highp float;
uniform sampler2D u_t0;
uniform int u_textureEnabled;
uniform int u_textureFlipY;
uniform int u_lightingMode;
uniform vec4 u_c1[16];
varying vec2 v_uv0;
varying vec4 v_color;
varying vec3 v_normal;
void main() {
	gl_FragColor = v_color;
	if (u_textureEnabled != 0) {
		vec2 sampleUv = u_textureFlipY != 0 ? vec2(v_uv0.x, 1.0 - v_uv0.y) : v_uv0;
		gl_FragColor *= texture2D(u_t0, sampleUv);
	}
	if (u_lightingMode != 0) {
		vec3 n = normalize(v_normal);
		vec3 l = normalize(u_c1[0].xyz);
		float ndl = max(dot(n, l), 0.0);
		gl_FragColor *= u_c1[1] + u_c1[2] * ndl;
	}
	if (gl_FragColor.a <= 0.0) {
		discard;
	}
}
