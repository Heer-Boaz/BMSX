precision mediump float;

uniform sampler2D u_texture;
uniform int u_useTexture;

varying vec2 v_uv;
varying vec4 v_color;

void main() {
	vec4 color = v_color;
	if (u_useTexture != 0) {
		color *= texture2D(u_texture, v_uv);
	}
	gl_FragColor = color;
}
