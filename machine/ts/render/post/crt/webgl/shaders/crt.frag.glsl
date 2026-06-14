#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_srcResolution;
uniform float u_fragscale;

uniform float u_time;
uniform float u_random;

uniform bool u_enableNoise;
uniform bool u_enableColorBleed;
uniform bool u_enableScanlines;
uniform bool u_enableBlur;
uniform bool u_enableGlow;
uniform bool u_enableFringing;
uniform bool u_enableAperture;

uniform float u_noiseIntensity;
uniform vec3 u_colorBleed;
uniform float u_blurIntensity;
uniform vec3 u_glowColor;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

const float APERTURE_STRENGTH = 0.08;
const float FRINGING_BASE_PX       = 0.8;
const float FRINGING_QUAD_COEF     = 2.5;
const float FRINGING_CONTRAST_COEF = 0.4;
const float FRINGING_MIX           = 0.11;

const float FRINGING_OFFSET = 0.5;
const float BLUR_FOOTPRINT_PX = 0.5;
const float K_NORM = 1.0 / 256.0;

const float BLACK_CUTOFF = 0.015;
const float BLACK_SOFT   = 0.060;

in vec2 v_texcoord;
out vec4 outputColor;


float hashNoise(vec2 uv, float t){
	vec2 wrappedUV = mod(uv, vec2(1024.0));
	float wrappedT = mod(t, 4096.0);
	vec3 p = vec3(wrappedUV * 0.1, wrappedT * 0.0001);
	p = fract(p * vec3(12.9898, 78.233, 43758.5453));
	p += dot(p, p.yzx + 19.19);
	return fract((p.x + p.y) * p.z);
}

struct BlurContrast { vec3 blurred; float contrast; };

BlurContrast applyBlurAndContrast(vec2 uv, vec2 texel, float footprintPx){
	vec2 stepUV = texel * footprintPx;
	vec3 accum = vec3(0.0);
	float centerLum = 0.0;
	float neighLum = 0.0;
	vec3 s;

	// Unrolled 5x5 kernel to keep GLES2 fast without array indexing.
	s = texture(u_texture, uv + vec2(-2.0, -2.0) * stepUV).rgb;
	accum += s * 1.0;
	s = texture(u_texture, uv + vec2(-1.0, -2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture(u_texture, uv + vec2(0.0, -2.0) * stepUV).rgb;
	accum += s * 6.0;
	s = texture(u_texture, uv + vec2(1.0, -2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture(u_texture, uv + vec2(2.0, -2.0) * stepUV).rgb;
	accum += s * 1.0;

	s = texture(u_texture, uv + vec2(-2.0, -1.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture(u_texture, uv + vec2(-1.0, -1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv + vec2(0.0, -1.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv + vec2(1.0, -1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv + vec2(2.0, -1.0) * stepUV).rgb;
	accum += s * 4.0;

	s = texture(u_texture, uv + vec2(-2.0, 0.0) * stepUV).rgb;
	accum += s * 6.0;
	s = texture(u_texture, uv + vec2(-1.0, 0.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv).rgb;
	accum += s * 36.0;
	centerLum = dot(s, LUMA);
	s = texture(u_texture, uv + vec2(1.0, 0.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv + vec2(2.0, 0.0) * stepUV).rgb;
	accum += s * 6.0;

	s = texture(u_texture, uv + vec2(-2.0, 1.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture(u_texture, uv + vec2(-1.0, 1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv + vec2(0.0, 1.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv + vec2(1.0, 1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture(u_texture, uv + vec2(2.0, 1.0) * stepUV).rgb;
	accum += s * 4.0;

	s = texture(u_texture, uv + vec2(-2.0, 2.0) * stepUV).rgb;
	accum += s * 1.0;
	s = texture(u_texture, uv + vec2(-1.0, 2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture(u_texture, uv + vec2(0.0, 2.0) * stepUV).rgb;
	accum += s * 6.0;
	s = texture(u_texture, uv + vec2(1.0, 2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture(u_texture, uv + vec2(2.0, 2.0) * stepUV).rgb;
	accum += s * 1.0;

	accum *= K_NORM;

	BlurContrast bc;
	bc.blurred = accum;
	bc.contrast = abs(centerLum - (neighLum * 0.125));
	return bc;
}

const float SCANLINE_DEPTH = 0.07;

vec3 applyScanlines(vec3 colorLinear, vec2 uv, vec2 srcPxRes){
	float row   = floor(uv.y * srcPxRes.y);
	float phase = cos(3.14159265359 * row);

	float lum = dot(colorLinear, LUMA);
	float A   = mix(SCANLINE_DEPTH, 0.12, lum);

	float m = 1.0 - A * (0.5 - 0.5 * phase);
	m      /= (1.0 - 0.5 * A);

	float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	return colorLinear * (1.0 + k * (m - 1.0));
}

vec3 applyApertureMask(vec3 colorLinear, vec2 uv, vec2 srcPxRes){
	float x = floor(uv.x * srcPxRes.x);
	float p = mod(x, 3.0);
	float r = step(0.0, 1.0 - abs(p - 0.0));
	float g = step(0.0, 1.0 - abs(p - 1.0));
	float b = step(0.0, 1.0 - abs(p - 2.0));
	vec3 mask = vec3(1.0) + APERTURE_STRENGTH * (vec3(r, g, b) * 2.0 - 1.0);

	float lum = dot(colorLinear, LUMA);
	float k   = smoothstep(0.0, 0.25, lum);
	k = sqrt(k);
	return colorLinear * (1.0 + k * (mask - 1.0));
}

vec3 applyFringing(vec3 color, vec2 uv, vec2 texel, float contrast, float mixAmount){
	vec2 dUV = uv - vec2(FRINGING_OFFSET);
	float d  = length(dUV) / length(vec2(0.5));
	vec2 dir = (d > 0.0) ? (dUV / d) : vec2(1.0, 0.0);

	float shiftPx = FRINGING_BASE_PX
					+ FRINGING_QUAD_COEF * (d * d)
					+ FRINGING_CONTRAST_COEF * contrast;

	vec2 shiftUV = dir * (shiftPx * texel);

	float r = texture(u_texture, uv + shiftUV).r;
	float g = texture(u_texture, uv).g;
	float b = texture(u_texture, uv - shiftUV).b;
	vec3 fringed = vec3(r, g, b);

	return mix(color, fringed, mixAmount);
}

vec3 applyNoise(vec3 color, vec2 uv, vec2 srcPxRes){
	float y_src    = uv.y * srcPxRes.y;
	float lineNoise= hashNoise(vec2(0.0, floor(y_src) + u_time * 30.0), 0.0) - 0.5;
	float pixNoise = hashNoise(uv * srcPxRes + vec2(u_random), u_time) - 0.5;
	float lum      = dot(color, LUMA);
	float n        = mix(pixNoise, lineNoise, 0.35);
	float k        = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	float amp      = u_noiseIntensity * mix(0.2, 1.0, 1.0 - lum);
	return color * (n * amp * k);
}

void main(){
	vec2 srcPxRes = u_srcResolution * u_fragscale;
	vec2 texel    = 1.0 / srcPxRes;

	vec3 color = texture(u_texture, v_texcoord).rgb;

	if (u_enableColorBleed) color += u_colorBleed;

	BlurContrast bc;
	if (u_enableBlur || u_enableFringing || u_enableAperture || u_enableScanlines) {
		bc = applyBlurAndContrast(v_texcoord, texel, BLUR_FOOTPRINT_PX);
	} else {
		bc.blurred = color;
		bc.contrast = 0.0;
	}

	float edge = smoothstep(0.01, 0.05, bc.contrast);

	if (u_enableBlur) {
		float blurK = mix(0.25, 1.0, 1.0 - edge) * u_blurIntensity;
		color = mix(color, bc.blurred, blurK);
	}

	if (u_enableFringing) {
		float mixK = FRINGING_MIX * edge;
		color = applyFringing(color, v_texcoord, texel, bc.contrast, mixK);
	}

	if (u_enableScanlines) {
		vec3 s = applyScanlines(color, v_texcoord, srcPxRes);
		color = mix(s, color, edge);
	}

	if (u_enableAperture) {
		vec3 a = applyApertureMask(color, v_texcoord, srcPxRes);
		color = mix(a, color, edge);
	}

	if (u_enableGlow) {
		float b = dot(color, LUMA);
		float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, b);
		color += u_glowColor * b * k;
	}

	if (u_enableNoise) color += applyNoise(color, v_texcoord, srcPxRes);

	float lumFinal = dot(color, LUMA);
	float keep     = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lumFinal);
	color *= keep;

outputColor = vec4(color, 1.0);
}
