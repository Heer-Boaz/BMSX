precision mediump float;

varying vec4 v_color;

void main() {
	vec3 color5 = floor((v_color.rgb * 255.0) / 8.0);
	float lowByte = mod(color5.r + color5.g * 32.0, 256.0);
	float highByte = floor(color5.g / 8.0) + color5.b * 4.0;
	gl_FragColor = vec4(lowByte / 255.0, highByte / 255.0, 0.0, 1.0);
}
