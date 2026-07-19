precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_source_pixel_scale;
uniform vec3 u_quantize_levels;

varying vec2 v_texcoord;

float linear_to_srgb_channel(float c) {
	if (c <= 0.0031308) return c * 12.92;
	return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 linear_to_srgb(vec3 c) {
	return vec3(
		linear_to_srgb_channel(c.r),
		linear_to_srgb_channel(c.g),
		linear_to_srgb_channel(c.b)
	);
}

float srgb_to_linear_channel(float c) {
	if (c <= 0.04045) return c / 12.92;
	return pow((c + 0.055) / 1.055, 2.4);
}

vec3 srgb_to_linear(vec3 c) {
	return vec3(
		srgb_to_linear_channel(c.r),
		srgb_to_linear_channel(c.g),
		srgb_to_linear_channel(c.b)
	);
}

float bayer4x4_raw(ivec2 pixel){
	vec2 w = mod(vec2(pixel), vec2(4.0));
	vec2 lo = mod(w, vec2(2.0));
	vec2 hi = (w - lo) * 0.5;
	return abs(lo.x - lo.y) * 8.0 + lo.y * 4.0 + abs(hi.x - hi.y) * 2.0 + hi.y;
}

float bayer4x4_0_1(ivec2 pixel){
	return (bayer4x4_raw(pixel) + 0.5) * (1.0 / 16.0);
}

vec3 quantize_ordered_conditional(vec3 sRGB, vec3 levels, vec3 thr){
	vec3 v = sRGB * levels;
	vec3 q = vec3(float(int(v.r)), float(int(v.g)), float(int(v.b)));
	q += step(thr, v - q);
	return q / levels;
}

void main(){
	ivec2 sourcePixel = ivec2(gl_FragCoord.xy * u_source_pixel_scale + vec2(0.5));

	vec3 color = texture2D(u_texture, v_texcoord).rgb;
	vec3 sigS = linear_to_srgb(color);
	sigS = quantize_ordered_conditional(sigS, u_quantize_levels, vec3(bayer4x4_0_1(sourcePixel)));
	color = srgb_to_linear(sigS);

	gl_FragColor = vec4(color, 1.0);
}
