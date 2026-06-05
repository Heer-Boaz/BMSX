precision highp float;

uniform sampler2D u_texture;
varying vec2 v_texcoord;

void main() {
	vec4 color = texture2D(u_texture, v_texcoord);
	gl_FragColor = vec4(color.rgb, 1.0);
}
