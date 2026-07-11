#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_srcResolution;
uniform float u_fragscale;
uniform int u_device_quantize_mode;

in vec2 v_texcoord;
out vec4 outputColor;

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

float psxDitherOffset4x4(vec2 pix){
	return float(int(bayer4x4_raw(pix) * 0.5)) - 4.0;
}

vec3 quantize_rgb777_output(vec3 sRGB, vec2 pix){
	vec3 thr = vec3(
		bayer4x4_0_1(pix),
		bayer4x4_0_1(pix + vec2(1.0, 2.0)),
		bayer4x4_0_1(pix + vec2(2.0, 1.0))
	);
	return quantize_ordered_conditional(sRGB, vec3(127.0), thr);
}

vec3 quantize_rgb555_psx(vec3 sRGB, vec2 pix){
	vec3 v = (sRGB * 255.0 + vec3(psxDitherOffset4x4(pix))) * 0.125;
	return vec3(float(int(v.r)), float(int(v.g)), float(int(v.b))) * (1.0 / 31.0);
}

void main(){
	vec2 dst = gl_FragCoord.xy - vec2(0.5);
	vec2 uvp = (dst + vec2(0.5)) / (u_srcResolution * u_fragscale);
	vec2 srcMax = u_srcResolution - vec2(1.0);
	vec2 srcXY = uvp * srcMax;
	vec2 sPix = vec2(float(int(srcXY.x + 0.5)), float(int(srcXY.y + 0.5)));

	vec3 color = texture(u_texture, v_texcoord).rgb;
	vec3 sigS = linear_to_srgb(color);
	if (u_device_quantize_mode == 1) {
		sigS = quantize_rgb555_psx(sigS, sPix);
	} else if (u_device_quantize_mode == 2) {
		sigS = quantize_rgb777_output(sigS, sPix);
	} else if (u_device_quantize_mode == 3) {
		sigS = quantize_msx10_343(sigS, sPix);
	}
	color = srgb_to_linear(sigS);

	outputColor = vec4(color, 1.0);
}
