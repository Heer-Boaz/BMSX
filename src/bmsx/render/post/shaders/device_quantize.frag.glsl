#version 300 es
precision highp float;

// Device framebuffer quantize/dither pass (linear -> sRGB -> quantize -> linear).

uniform sampler2D u_texture;  // offscreen scene (linear)
uniform vec2 u_srcResolution; // base "logical" resolution (e.g., 256x212)
uniform float u_fragscale;    // integer upscale (e.g., 2.0)
uniform uint u_dither_type;   // 1=rgb555_psx, 2=rgb565, 3=msx10_343

in vec2 v_texcoord;
out vec4 outputColor;

// --- Exact sRGB transfer functions (IEC 61966-2-1) ---
vec3 linear_to_srgb(vec3 c) {
	c = max(c, vec3(0.0));
	bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
	vec3 lo = c * 12.92;
	vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
	return mix(hi, lo, vec3(cutoff));
}

vec3 srgb_to_linear(vec3 c) {
	c = max(c, vec3(0.0));
	bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
	vec3 lo = c / 12.92;
	vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
	return mix(hi, lo, vec3(cutoff));
}

// --- RGB565 ordered dither (4x4 Bayer matrix) ---
const float B4[16] = float[16](
	0.0,  8.0,  2.0, 10.0,
	12.0, 4.0, 14.0, 6.0,
	3.0, 11.0, 1.0,  9.0,
	15.0, 7.0, 13.0, 5.0
);

float bayer4x4_0_1(ivec2 p){
	ivec2 w = p & ivec2(3);
	int idx = w.x + (w.y << 2);
	return (B4[idx] + 0.5) / 16.0;
}

// vec3 quantize_msx2_rgb343_luma(vec3 sRGB, ivec2 pix) {
//   vec3 levels = vec3(7.0, 15.0, 7.0);            // RGB343 = 0..7/15/7 → 8/16/8 levels → 1024 colors

//   float thr = bayer4x4_0_1(pix);      // 0..1

//   vec3 q0 = quantize_levels(sRGB, levels);
//   vec3 q1 = quantize_levels(sRGB + (1.0 / levels), levels); // candidate one step up

//   float l  = dot(sRGB, LUMA);
//   float l0 = dot(q0, LUMA);
//   float l1 = dot(q1, LUMA);

//   // threshold decides whether we push brightness up
//   // (robust version: compare l against interpolated threshold between l0 and l1)
//   float cut = mix(l0, l1, thr);
//   return (l > cut) ? q1 : q0;
// }

// vec3 limit_rgb333(vec3 sRGB) {
//   vec3 levels = vec3(7.0, 7.0, 7.0);
//   return quantize_levels(sRGB, levels);
// }

vec3 quantize_ordered_conditional(vec3 sRGB, vec3 levels, float thr){
	vec3 v = clamp(sRGB, 0.0, 1.0) * levels;
	vec3 q = floor(v);
	vec3 f = fract(v);
	q += step(vec3(thr), f);
	return q / levels;
}

vec3 quant565_error_gated(vec3 sRGB, ivec2 p){
	vec3 lv = vec3(31.0, 63.0, 31.0);
	vec3 s = clamp(sRGB, 0.0, 1.0);
	vec3 v = s * lv;
	vec3 qRound = floor(v + 0.5) / lv;

	vec3 e = abs(s - qRound);
	float err = dot(e, vec3(0.299, 0.587, 0.114));
	float gate = smoothstep(0.003, 0.012, err);

	float thr = bayer4x4_0_1(p);
	vec3 qOrdered = (floor(v) + step(vec3(thr), fract(v))) / lv;
	return mix(qRound, qOrdered, vec3(gate));
}

// MSX 10-bit 3:4:3 quantize with conditional ordered rounding.
vec3 quantize_msx10_343(vec3 sRGB, ivec2 pix){
	vec3 levels = vec3(7.0, 15.0, 7.0);
	float thr = bayer4x4_0_1(pix);
	return quantize_ordered_conditional(sRGB, levels, thr);
}

// vec3 quantize_msx10_343(vec3 sRGB, ivec2 pix){
//   vec3 levels = vec3(7.0, 15.0, 7.0);

//   float tr = bayer4x4_0_1(pix);
//   float tg = bayer4x4_0_1(pix + ivec2(1,0));
//   float tb = bayer4x4_0_1(pix + ivec2(0,1));
//   vec3  thr = vec3(tr,tg,tb);

//   vec3 x = clamp(sRGB, 0.0, 1.0);
//   return floor(x * levels + thr) / levels;
// }

// PSX 4x4 signed dither offsets (8-bit domain)
const int PSX_DITHER[16] = int[16](
	-4,  0, -3,  1,
	2, -2,  3, -1,
	-3,  1, -4,  0,
	3, -1,  2, -2
);

int psxIdx(ivec2 p){
	ivec2 w = p & ivec2(3);
	return w.x + (w.y << 2);
}

// sRGB (0..1) -> PSX dithered RGB555 in sRGB (0..1), emulator-style
vec3 quantize_rgb555_psx(vec3 sRGB, ivec2 pix){
	int off = PSX_DITHER[psxIdx(pix)];

	// work in 8-bit domain like the real thing
	vec3 v8 = sRGB * 255.0 + float(off);

	// saturate to 0..255
	v8 = clamp(v8, 0.0, 255.0);

	// trunc to 5-bit via >>3 (divide by 8, floor)
	vec3 v5 = floor(v8 / 8.0);          // 0..31

	// back to normalized sRGB-like 0..1 at 5-bit precision
	return v5 / 31.0;
}

void main(){
	vec2 dst    = gl_FragCoord.xy - vec2(0.5);
	vec2 uvp    = (dst + vec2(0.5)) / (u_srcResolution * u_fragscale);
	vec2 srcMax = u_srcResolution - vec2(1.0);
	vec2 srcXY  = uvp * srcMax;
	ivec2 sPix  = ivec2(floor(srcXY + vec2(0.5)));

	vec3 color = texture(u_texture, v_texcoord).rgb; // linear
	vec3 sigS  = linear_to_srgb(color);

	if (u_dither_type == 1u) {
	sigS = quantize_rgb555_psx(sigS, sPix);
	} else if (u_dither_type == 2u) {
	sigS = quant565_error_gated(sigS, sPix);
	} else if (u_dither_type == 3u) {
	sigS = quantize_msx10_343(sigS, sPix);
	}

	color = srgb_to_linear(sigS);
	outputColor = vec4(color, 1.0);
}
