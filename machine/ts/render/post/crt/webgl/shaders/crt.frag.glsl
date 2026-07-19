#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_srcResolution;
uniform vec2 u_srcTexel;

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
const float K_NORM = 1.0 / 256.0;
const float ONE_THIRD = 1.0 / 3.0;
const float TWO_THIRDS = 2.0 / 3.0;

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

struct BlurContrast { vec3 center; vec3 blurred; float contrast; };

// Nearest filtering collapses the half-texel 5x5 binomial taps into these
// exact 3x3 phase-dependent weights.
BlurContrast applyBlurAndContrast(vec2 uv, vec2 sourcePixel){
	vec2 upperHalf = step(vec2(0.5), fract(sourcePixel));
	vec2 blurBefore = mix(vec2(5.0), vec2(1.0), upperHalf);
	vec2 blurAfter = mix(vec2(1.0), vec2(5.0), upperHalf);
	vec2 contrastBefore = vec2(1.0) - upperHalf;
	vec2 contrastAfter = upperHalf;
	vec3 blurred = vec3(0.0);
	vec3 neighborhood = vec3(0.0);
	vec3 left;
	vec3 center;
	vec3 right;

	left = texture(u_texture, uv - u_srcTexel).rgb;
	center = texture(u_texture, uv + vec2(0.0, -u_srcTexel.y)).rgb;
	right = texture(u_texture, uv + vec2(u_srcTexel.x, -u_srcTexel.y)).rgb;
	blurred += (left * blurBefore.x + center * 10.0 + right * blurAfter.x) * blurBefore.y;
	neighborhood += (left * contrastBefore.x + center * 2.0 + right * contrastAfter.x) * contrastBefore.y;

	left = texture(u_texture, uv + vec2(-u_srcTexel.x, 0.0)).rgb;
	center = texture(u_texture, uv).rgb;
	vec3 centerColor = center;
	right = texture(u_texture, uv + vec2(u_srcTexel.x, 0.0)).rgb;
	blurred += (left * blurBefore.x + center * 10.0 + right * blurAfter.x) * 10.0;
	neighborhood += (left * contrastBefore.x + center * 2.0 + right * contrastAfter.x) * 2.0;

	left = texture(u_texture, uv + vec2(-u_srcTexel.x, u_srcTexel.y)).rgb;
	center = texture(u_texture, uv + vec2(0.0, u_srcTexel.y)).rgb;
	right = texture(u_texture, uv + u_srcTexel).rgb;
	blurred += (left * blurBefore.x + center * 10.0 + right * blurAfter.x) * blurAfter.y;
	neighborhood += (left * contrastBefore.x + center * 2.0 + right * contrastAfter.x) * contrastAfter.y;

	BlurContrast bc;
	bc.center = centerColor;
	bc.blurred = blurred * K_NORM;
	bc.contrast = abs(dot(centerColor, LUMA) - dot(neighborhood - centerColor, LUMA) * 0.125);
	return bc;
}

const float SCANLINE_DEPTH = 0.07;

vec3 applyScanlines(vec3 colorLinear, float sourceY){
	float phase = 1.0 - 2.0 * step(0.5, fract(sourceY * 0.5));

	float lum = dot(colorLinear, LUMA);
	float A   = mix(SCANLINE_DEPTH, 0.12, lum);

	float m = 1.0 - A * (0.5 - 0.5 * phase);
	m      /= (1.0 - 0.5 * A);

	float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	return colorLinear * (1.0 + k * (m - 1.0));
}

vec3 applyApertureMask(vec3 colorLinear, float sourceX){
	float p = fract(sourceX * ONE_THIRD);
	float greenOrBlue = step(ONE_THIRD, p);
	float blue = step(TWO_THIRDS, p);
	vec3 apertureChannel = vec3(1.0 - greenOrBlue, greenOrBlue - blue, blue);
	vec3 maskDelta = APERTURE_STRENGTH * (apertureChannel * 2.0 - 1.0);

	float lum = dot(colorLinear, LUMA);
	float k   = smoothstep(0.0, 0.25, lum);
	k = sqrt(k);
	return colorLinear * (1.0 + k * maskDelta);
}

vec3 applyFringing(vec3 color, vec2 uv, float centerGreen, float contrast, float mixAmount){
	vec2 dUV = uv - vec2(FRINGING_OFFSET);
	float d  = length(dUV) / length(vec2(0.5));
	vec2 dir = (d > 0.0) ? (dUV / d) : vec2(1.0, 0.0);

	float shiftPx = FRINGING_BASE_PX
					+ FRINGING_QUAD_COEF * (d * d)
					+ FRINGING_CONTRAST_COEF * contrast;

	vec2 shiftUV = dir * (shiftPx * u_srcTexel);

	float r = texture(u_texture, uv + shiftUV).r;
	float b = texture(u_texture, uv - shiftUV).b;
	vec3 fringed = vec3(r, centerGreen, b);

	return mix(color, fringed, mixAmount);
}

vec3 applyNoise(vec3 color, vec2 sourcePixel){
	float lineNoise= hashNoise(vec2(0.0, float(int(sourcePixel.y)) + u_time * 30.0), 0.0) - 0.5;
	float pixNoise = hashNoise(sourcePixel + vec2(u_random), u_time) - 0.5;
	float lum      = dot(color, LUMA);
	float n        = mix(pixNoise, lineNoise, 0.35);
	float k        = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	float amp      = u_noiseIntensity * mix(0.2, 1.0, 1.0 - lum);
	return color * (n * amp * k);
}

void main(){
	vec2 sourcePixel = v_texcoord * u_srcResolution;
	BlurContrast bc;
	if (u_enableBlur || u_enableFringing || u_enableAperture || u_enableScanlines) {
		bc = applyBlurAndContrast(v_texcoord, sourcePixel);
	} else {
		bc.center = texture(u_texture, v_texcoord).rgb;
		bc.blurred = bc.center;
		bc.contrast = 0.0;
	}
	vec3 color = bc.center;

	if (u_enableColorBleed) color += u_colorBleed;

	float edge = smoothstep(0.01, 0.05, bc.contrast);

	if (u_enableBlur) {
		float blurK = mix(0.25, 1.0, 1.0 - edge) * u_blurIntensity;
		color = mix(color, bc.blurred, blurK);
	}

	if (u_enableFringing) {
		float mixK = FRINGING_MIX * edge;
		color = applyFringing(color, v_texcoord, bc.center.g, bc.contrast, mixK);
	}

	if (u_enableScanlines) {
		vec3 s = applyScanlines(color, sourcePixel.y);
		color = mix(s, color, edge);
	}

	if (u_enableAperture) {
		vec3 a = applyApertureMask(color, sourcePixel.x);
		color = mix(a, color, edge);
	}

	if (u_enableGlow) {
		float b = dot(color, LUMA);
		float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, b);
		color += u_glowColor * b * k;
	}

	if (u_enableNoise) color += applyNoise(color, sourcePixel);

	float lumFinal = dot(color, LUMA);
	float keep     = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lumFinal);
	color *= keep;

outputColor = vec4(color, 1.0);
}
