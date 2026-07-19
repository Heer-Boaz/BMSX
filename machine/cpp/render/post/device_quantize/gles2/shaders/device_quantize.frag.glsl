precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_quantize_lut;
uniform vec2 u_resolution;

varying vec2 v_texcoord;

float bayer4x4_raw(ivec2 pixel){
	vec2 w = mod(vec2(pixel), vec2(4.0));
	vec2 lo = mod(w, vec2(2.0));
	vec2 hi = (w - lo) * 0.5;
	return abs(lo.x - lo.y) * 8.0 + lo.y * 4.0 + abs(hi.x - hi.y) * 2.0 + hi.y;
}

float quantize_lut_row(ivec2 pixel){
	return (bayer4x4_raw(pixel) + 0.5) * (1.0 / 16.0);
}

float quantize_lut_column(float channel){
	return (channel * 255.0 + 0.5) * (1.0 / 256.0);
}

void main(){
	ivec2 logicalPixel = ivec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
	vec3 color = texture2D(u_texture, v_texcoord).rgb;
	float lutRow = quantize_lut_row(logicalPixel);
	gl_FragColor = vec4(
		texture2D(u_quantize_lut, vec2(quantize_lut_column(color.r), lutRow)).r,
		texture2D(u_quantize_lut, vec2(quantize_lut_column(color.g), lutRow)).g,
		texture2D(u_quantize_lut, vec2(quantize_lut_column(color.b), lutRow)).b,
		1.0
	);
}
