precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_srcResolution;
uniform float u_fragscale;
uniform int u_device_quantize_mode;

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

float bayer4x4_raw(vec2 pix){
	vec2 w = mod(pix, vec2(4.0));
	vec2 lo = mod(w, vec2(2.0));
	vec2 hi = (w - lo) * 0.5;
	return abs(lo.x - lo.y) * 8.0 + lo.y * 4.0 + abs(hi.x - hi.y) * 2.0 + hi.y;
}

float bayer4x4_0_1(vec2 pix){
	return (bayer4x4_raw(pix) + 0.5) * (1.0 / 16.0);
}

vec3 quantize_ordered_conditional(vec3 sRGB, vec3 levels, vec3 thr){
	vec3 v = sRGB * levels;
	vec3 q = vec3(float(int(v.r)), float(int(v.g)), float(int(v.b)));
	q += step(thr, v - q);
	return q / levels;
}

vec3 quantize_msx10_343(vec3 sRGB, vec2 pix){
	return quantize_ordered_conditional(sRGB, vec3(7.0, 15.0, 7.0), vec3(bayer4x4_0_1(pix)));
}

vec3 quantize_rgb565(vec3 sRGB, vec2 pix){
	return quantize_ordered_conditional(sRGB, vec3(31.0, 63.0, 31.0), vec3(bayer4x4_0_1(pix)));
}

void main(){
	vec2 dst = gl_FragCoord.xy - vec2(0.5);
	vec2 uvp = (dst + vec2(0.5)) / (u_srcResolution * u_fragscale);
	vec2 srcMax = u_srcResolution - vec2(1.0);
	vec2 srcXY = uvp * srcMax;
	vec2 sPix = vec2(float(int(srcXY.x + 0.5)), float(int(srcXY.y + 0.5)));

	vec3 color = texture2D(u_texture, v_texcoord).rgb;
	vec3 sigS = linear_to_srgb(color);
	if (u_device_quantize_mode == 1) {
		sigS = quantize_rgb565(sigS, sPix);
	} else if (u_device_quantize_mode == 2) {
		sigS = quantize_msx10_343(sigS, sPix);
	}
	color = srgb_to_linear(sigS);

	gl_FragColor = vec4(color, 1.0);
}
