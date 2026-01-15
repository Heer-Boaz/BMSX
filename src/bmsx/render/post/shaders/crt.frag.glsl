#version 300 es
precision highp float;

// CRT optics pass (scanlines/aperture/glow/noise/blur/fringe).

// --- Textures & core uniforms ---
uniform sampler2D u_texture;          // offscreen scene (size = u_srcResolution * u_fragscale)
uniform vec2 u_srcResolution;         // base "logical" resolution (e.g., 256x212)
uniform float u_fragscale;            // integer upscale (e.g., 2.0)

// Time/random for noise
uniform float u_random;

// Frame-shared UBO (std140). Only time is used in this shader.
layout(std140) uniform FrameUniforms {
  vec2 u_offscreenSize;
  vec2 u_logicalSize;
  vec4 u_timeDelta; // x=time, y=delta, z,w unused
  mat4 u_view;
  mat4 u_proj;
  vec4 u_cameraPos; // xyz, w pad
  vec4 u_ambient_frame; // rgb,intensity
};

// --- Feature toggles ---
uniform bool u_enableNoise;
uniform bool u_enableColorBleed;
uniform bool u_enableScanlines;
uniform bool u_enableBlur;
uniform bool u_enableGlow;
uniform bool u_enableFringing;
uniform bool u_enableAperture;

// --- Parameters ---
uniform float u_noiseIntensity;       // 0..~0.5
uniform vec3  u_colorBleed;           // small additive bias, linear space
uniform float u_blurIntensity;        // 0..1 blend
uniform vec3  u_glowColor;            // glow tint (linear)

// ---- Constants ----
const vec3  LUMA = vec3(0.299, 0.587, 0.114);

// optics
const float APERTURE_STRENGTH = 0.08;
const float GLOW_BRIGHTNESS_CLAMP = 0.6;

// fringing
const float FRINGING_BASE_PX       = 0.8;
const float FRINGING_QUAD_COEF     = 2.5;
const float FRINGING_CONTRAST_COEF = 0.4;
const float FRINGING_MIX           = 0.11;
const float FRINGING_OFFSET        = 0.5;
const float BLUR_FOOTPRINT_PX      = 0.5;

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

// --- Exact sRGB transfer functions (IEC 61966-2-1) ---
vec3 linear_to_srgb(vec3 c) {
  c = max(c, vec3(0.0));
  bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(cutoff));
}

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
      vec3 s   = texture(u_texture, uv + ofs).rgb; // linear
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
const float SCANLINE_DEPTH = 0.07;

vec3 applyScanlines(vec3 colorLinear, vec2 uv, vec2 srcPxRes){
  float row   = floor(uv.y * srcPxRes.y);
  float phase = cos(3.14159265359 * row); // +1/-1 per row

  float lum = dot(colorLinear, LUMA);
  float A   = mix(SCANLINE_DEPTH, 0.12, clamp(lum, 0.0, 1.0));

  float m = 1.0 - A * (0.5 - 0.5 * phase);
  m      /= (1.0 - 0.5 * A);

  float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
  return colorLinear * (1.0 + k * (m - 1.0));
}

// --- Aperture grille: delta-only gating ---
// vec3 applyApertureMask(vec3 c, vec2 uv, vec2 srcPxRes){ // More compute heavy version, but still relatively light
//   float x_src = uv.x * srcPxRes.x;
//   float x = floor(x_src);

//   // 3-stripe triad per pixel group
//   float p = mod(x, 3.0);
//   vec3 stripe =
//       (p < 1.0) ? vec3(1.0 + APERTURE_STRENGTH, 1.0, 1.0 - APERTURE_STRENGTH) :
//       (p < 2.0) ? vec3(1.0, 1.0, 1.0) :
//                   vec3(1.0 - APERTURE_STRENGTH, 1.0, 1.0 + APERTURE_STRENGTH);

//   float lum = dot(c, LUMA);
//   float k = smoothstep(0.0, 0.25, lum); // earlier activation
//   k = sqrt(k);

//   return c * (1.0 + k * (stripe - 1.0));
// }

vec3 applyApertureMask(vec3 c, vec2 uv, vec2 srcPxRes){
	float x = floor(uv.x * srcPxRes.x);
	float p = mod(x, 3.0);
	float r = step(0.0, 1.0 - abs(p - 0.0)); // 1 als p≈0
	float g = step(0.0, 1.0 - abs(p - 1.0)); // 1 als p≈1
	float b = step(0.0, 1.0 - abs(p - 2.0)); // 1 als p≈2
	vec3 stripe = vec3(r, g, b);
	vec3 mask = vec3(1.0) + APERTURE_STRENGTH * (stripe * 2.0 - 1.0);
	  float lum = dot(c, LUMA);
  float k = smoothstep(0.0, 0.25, lum); // earlier activation
  k = sqrt(k);

  return c * (1.0 + k * (mask - 1.0));
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

  float r = texture(u_texture, uv + shiftUV).r;
  float g = texture(u_texture, uv).g;
  float b = texture(u_texture, uv - shiftUV).b;
  vec3 fringed = vec3(r, g, b);

  return mix(color, fringed, mixAmount);
}

// --- Noise helper ---
vec3 applyNoise(vec3 color, vec2 uv, vec2 srcPxRes){
  float y_src     = uv.y * srcPxRes.y;
  float lineNoise = hashNoise(vec2(0.0, floor(y_src) + u_timeDelta.x * 30.0), 0.0) - 0.5;
  float pixNoise  = hashNoise(uv * srcPxRes + vec2(u_random), u_timeDelta.x) - 0.5;
  float lum       = dot(color, LUMA);
  float n         = mix(pixNoise, lineNoise, 0.35);
  float k         = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
  float amp       = u_noiseIntensity * mix(0.2, 1.0, 1.0 - lum);
  return color * (n * amp * k);
}

void main(){
  vec2 srcPxRes = u_srcResolution * u_fragscale;
  vec2 texel    = 1.0 / srcPxRes;

  // base (texture() returns linear if the texture is SRGB8_A8)
  vec3 color = texture(u_texture, v_texcoord).rgb;

  // 1) signal tweak
  if (u_enableColorBleed) color += u_colorBleed;

// 2) blur (pre-scanline/fringing)
BlurContrast bc;
if (u_enableBlur || u_enableFringing || u_enableAperture || u_enableScanlines) {
    bc = applyBlurAndContrast(v_texcoord, texel, BLUR_FOOTPRINT_PX);
} else {
    bc.blurred = color;
    bc.contrast = 0.0;
}

// edge metric (0=flat, 1=edge) — compute AFTER bc is valid
float edge = smoothstep(0.01, 0.05, bc.contrast);

// blur: reduce on edges (text)
if (u_enableBlur) {
    float blurK = mix(0.25, 1.0, 1.0 - edge) * u_blurIntensity;
    color = mix(color, bc.blurred, blurK);
}

// fringing: apply only on edges
if (u_enableFringing) {
    float mixK = FRINGING_MIX * edge;
    color = applyFringing(color, v_texcoord, texel, bc.contrast, mixK);
}

// scanlines: reduce on edges (optional but usually helps text)
if (u_enableScanlines) {
    vec3 s = applyScanlines(color, v_texcoord, srcPxRes);
    color = mix(s, color, edge);
}

// aperture: reduce on edges
if (u_enableAperture) {
    vec3 a = applyApertureMask(color, v_texcoord, srcPxRes);
    color = mix(a, color, edge);
}

// 6) glow (gate by near-black)
  if (u_enableGlow) {
    float b = dot(color, LUMA);
    float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, b);
    color += u_glowColor * clamp(b, 0.0, GLOW_BRIGHTNESS_CLAMP) * k;
  }

  // 7) noise (gate by near-black)
  if (u_enableNoise) color += applyNoise(color, v_texcoord, srcPxRes);

  // final black clamp (safety net)
  float lumFinal = dot(color, LUMA);
  float keep     = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lumFinal);
  color *= keep;

  // Final output encode (single encode at the end; no dither here)
  outputColor = vec4(linear_to_srgb(color), 1.0);
}
