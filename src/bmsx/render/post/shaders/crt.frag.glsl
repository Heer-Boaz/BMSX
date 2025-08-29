#version 300 es
precision highp float;

// --- Textures & core uniforms ---
uniform sampler2D u_texture;          // offscreen scene (size = u_srcResolution * u_fragscale)
uniform vec2 u_srcResolution;         // base "logical" resolution (e.g., 256x212)
uniform float u_fragscale;            // integer upscale (e.g., 2.0)

// Time/random for noise
uniform float u_time;
uniform float u_random;

// --- Feature toggles ---
uniform bool u_applyNoise;
uniform bool u_applyColorBleed;
uniform bool u_applyScanlines;
uniform bool u_applyBlur;
uniform bool u_applyGlow;
uniform bool u_applyFringing;

// --- Parameters ---
uniform float u_noiseIntensity;       // 0..~0.5
uniform vec3  u_colorBleed;           // small additive bias, linear space
uniform float u_blurIntensity;        // 0..1 blend
uniform vec3  u_glowColor;            // glow tint (linear)

// ---- Constants ----
const vec3  LUMA = vec3(0.299, 0.587, 0.114);

// optics
const float SCANLINE_INTERVAL = 1.0;
const float APERTURE_STRENGTH = 0.08;
const float GLOW_BRIGHTNESS_CLAMP = 0.6;

// fringing
const float FRINGING_BASE_PX       = 0.8;
const float FRINGING_QUAD_COEF     = 2.5;
const float FRINGING_CONTRAST_COEF = 0.4;
const float FRINGING_MIX           = 0.11; // Was 0.22

const float FRINGING_OFFSET = 0.5;
const float BLUR_FOOTPRINT_PX = 0.5;

// black gating
const float BLACK_CUTOFF = 0.015; // linear
const float BLACK_SOFT   = 0.060; // linear

// 5x5 kernel (unnormalized; multiply by K_NORM)
const float K_NORM = 1.0 / 256.0;
const float KERNEL_5x5[25] = float[](
	1.0,  4.0,  6.0,  4.0, 1.0,
	4.0, 16.0, 24.0, 16.0, 4.0,
	6.0, 24.0, 36.0, 24.0, 6.0,
	4.0, 16.0, 24.0, 16.0, 4.0,
	1.0,  4.0,  6.0,  4.0, 1.0
);

in vec2 v_texcoord;
out vec4 outputColor;

// --- Gamma helpers (WebGL: textures are SRGB8_A8; framebuffer is linear, so we encode once at end) ---
#define MANUAL_GAMMA 0
vec3 toLinear(vec3 c){ return c; }
vec3 toSRGB(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }

// --- Noise ---
float hashNoise(vec2 uv, float t){
	vec3 p = vec3(uv * 0.1, t * 0.1);
	p = fract(p * vec3(12.9898, 78.233, 43758.5453));
	p += dot(p, p.yzx + 19.19);
	return fract((p.x + p.y) * p.z);
}

// --- Blur + local contrast ---
struct BlurContrast { vec3 blurred; float contrast; };

BlurContrast applyBlurAndContrast(vec2 uv, vec2 texel, float footprintPx){
	vec2 stepUV = texel * footprintPx;
	vec3 accum = vec3(0.0);
	float centerLum = 0.0, neighLum = 0.0, neighCount = 0.0;

	int r = 2; int idx = 0;
	for (int y=-r; y<=r; ++y){
		for (int x=-r; x<=r; ++x, ++idx){
			vec2 ofs = vec2(float(x), float(y)) * stepUV;
			vec3 s   = texture(u_texture, uv + ofs).rgb; // already linear
			float w  = KERNEL_5x5[idx] * K_NORM;
			accum += s * w;

			if (abs(x)<=1 && abs(y)<=1){
				float lum = dot(s, LUMA);
				if (x==0 && y==0) centerLum = lum;
				else { neighLum += lum; neighCount += 1.0; }
			}
		}
	}
	float neighAvg = (neighCount > 0.0) ? (neighLum / neighCount) : centerLum;
	return BlurContrast(accum, abs(centerLum - neighAvg));
}

// --- Scanlines: row-alternating, DC-preserving, delta-only gating ---
const float SCANLINE_DEPTH = 0.07; // 0..0.6

vec3 applyScanlines(vec3 colorLinear, vec2 uv, vec2 srcPxRes){
	float row   = floor(uv.y * srcPxRes.y);
	float phase = cos(3.14159265359 * row);         // +1/-1 per row

	float lum = dot(colorLinear, LUMA);
	float A   = mix(SCANLINE_DEPTH, 0.12, clamp(lum, 0.0, 1.0));

	float m = 1.0 - A * (0.5 - 0.5 * phase);        // mask around 1.0
	m      /= (1.0 - 0.5 * A);                      // DC normalize

	float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	return colorLinear * (1.0 + k * (m - 1.0));     // gate only the delta
}

// --- Aperture grille: delta-only gating ---
vec3 applyApertureMask(vec3 colorLinear, vec2 uv, vec2 srcPxRes){
	float x_src = uv.x * srcPxRes.x;
	float triad = 0.5 + 0.5 * cos(6.2831853 * x_src);
	vec3  mask  = vec3(1.0 + APERTURE_STRENGTH * triad,
										 1.0,
										 1.0 - APERTURE_STRENGTH * triad);

	float lum = dot(colorLinear, LUMA);
	float k   = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	return colorLinear * (1.0 + k * (mask - 1.0));  // gate only the delta
}

// --- Fringing ---
vec3 applyFringing(vec3 color, vec2 uv, vec2 texel, float contrast, float mixAmount){
	vec2 dUV = uv - vec2(FRINGING_OFFSET);
	float d  = length(dUV) / length(vec2(0.5));
	vec2 dir = (d > 0.0) ? (dUV / max(d, 1e-6)) : vec2(1.0, 0.0);

	float shiftPx = FRINGING_BASE_PX
								+ FRINGING_QUAD_COEF * (d * d)
								+ FRINGING_CONTRAST_COEF * contrast;

	vec2 shiftUV = dir * (shiftPx * texel);

	// sample original texture (linear) for channels
	float r = texture(u_texture, uv + shiftUV).r;
	float g = texture(u_texture, uv).g;
	float b = texture(u_texture, uv - shiftUV).b;
	vec3 fringed = vec3(r, g, b);

	return mix(color, fringed, mixAmount);
}

// --- Noise helper (extracted from main) ---
vec3 applyNoise(vec3 color, vec2 uv, vec2 srcPxRes){
	float y_src    = uv.y * srcPxRes.y;
	float lineNoise= hashNoise(vec2(0.0, floor(y_src) + u_time * 30.0), 0.0) - 0.5;
	float pixNoise = hashNoise(uv * srcPxRes + vec2(u_random), u_time) - 0.5;
	float lum      = dot(color, LUMA);
	float n        = mix(pixNoise, lineNoise, 0.35);
	float k        = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
	return color * n * (u_noiseIntensity * mix(0.2, 1.0, 1.0 - lum)) * k;
}

void main(){
	vec2 srcPxRes = u_srcResolution * u_fragscale;
	vec2 texel    = 1.0 / srcPxRes;

	// base (texture() is already linear because atlas is SRGB8_A8)
	vec3 color = texture(u_texture, v_texcoord).rgb;

	// 1) signal tweak
	if (u_applyColorBleed) color += u_colorBleed;

	// 2) blur (pre-scanline/fringing)
	BlurContrast bc;
	if (u_applyBlur || u_applyFringing) {
		bc = applyBlurAndContrast(v_texcoord, texel, BLUR_FOOTPRINT_PX);
	} else {
		bc.blurred = color; bc.contrast = 0.0;
	}
	if (u_applyBlur) {
		color = mix(color, bc.blurred, clamp(u_blurIntensity, 0.0, 1.0));
	}

	// 3) fringing
	if (u_applyFringing){
		color = applyFringing(color, v_texcoord, texel, bc.contrast, FRINGING_MIX);
	}

	// 4) scanlines
	if (u_applyScanlines) color = applyScanlines(color, v_texcoord, srcPxRes);

	// 5) aperture mask
	// TODO: Add flag for aperture mask as u_applyApertureMask
	color = applyApertureMask(color, v_texcoord, srcPxRes);

	// 6) glow (gate by near-black)
	if (u_applyGlow){
		float b = dot(color, LUMA);
		float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, b);
		color += u_glowColor * clamp(b, 0.0, GLOW_BRIGHTNESS_CLAMP) * k;
	}

	// 7) noise (gate by near-black)
	if (u_applyNoise){
		color += applyNoise(color, v_texcoord, srcPxRes);
	}

	// --- Final black clamp (safety net) ---
	float lumFinal = dot(color, LUMA);
	float keep     = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lumFinal);
	color *= keep;

	// gamma encode for WebGL backbuffer
	outputColor = vec4(toSRGB(color), 1.0);
}
