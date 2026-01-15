/*
 * crt_pipeline_gles2.cpp - GLES2 CRT post-processing pipeline
 */

#include "crt_pipeline_gles2.h"

#include "../core/engine.h"
#include <cstdio>
#include <stdexcept>
#include <string>

namespace bmsx {
namespace CRTPipeline {
namespace {

constexpr bool kCRTVerboseLog = false;

constexpr int kTexUnitPostProcess = 3;

struct CRTGLES2State {
	GLuint program = 0;
	GLint attrib_pos = -1;
	GLint attrib_uv = -1;
	GLint uniform_resolution = -1;
	GLint uniform_src_resolution = -1;
	GLint uniform_scale = -1;
	GLint uniform_fragscale = -1;
	GLint uniform_time = -1;
	GLint uniform_random = -1;
	GLint uniform_apply_noise = -1;
	GLint uniform_apply_color_bleed = -1;
	GLint uniform_apply_scanlines = -1;
	GLint uniform_apply_blur = -1;
	GLint uniform_apply_glow = -1;
	GLint uniform_apply_fringing = -1;
	GLint uniform_apply_aperture = -1;
	GLint uniform_noise_intensity = -1;
	GLint uniform_color_bleed = -1;
	GLint uniform_blur_intensity = -1;
	GLint uniform_glow_color = -1;
	GLint uniform_texture = -1;
	GLuint vbo_pos = 0;
	GLuint vbo_uv = 0;
	i32 width = -1;
	i32 height = -1;
};

CRTGLES2State g_crt;

struct DeviceQuantizeGLES2State {
	GLuint program = 0;
	GLint attrib_pos = -1;
	GLint attrib_uv = -1;
	GLint uniform_resolution = -1;
	GLint uniform_src_resolution = -1;
	GLint uniform_scale = -1;
	GLint uniform_fragscale = -1;
	GLint uniform_dither_type = -1;
	GLint uniform_texture = -1;
	GLuint vbo_pos = 0;
	GLuint vbo_uv = 0;
	i32 width = -1;
	i32 height = -1;
};

DeviceQuantizeGLES2State g_device;

struct PresentGLES2State {
	GLuint program = 0;
	GLint attrib_pos = -1;
	GLint attrib_uv = -1;
	GLint uniform_resolution = -1;
	GLint uniform_scale = -1;
	GLint uniform_texture = -1;
	GLuint vbo_pos = 0;
	GLuint vbo_uv = 0;
	i32 width = -1;
	i32 height = -1;
};

PresentGLES2State g_present;

const char* kCRTVertexShader = R"(
precision mediump float;

attribute vec2 a_position;
attribute vec2 a_texcoord;

uniform vec2 u_resolution;
uniform float u_scale;

varying vec2 v_texcoord;

void main() {
	vec2 scaledPosition = a_position * u_scale;
	vec2 clipSpace = ((scaledPosition / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0);
	gl_Position = vec4(clipSpace, 0.0, 1.0);
	v_texcoord = a_texcoord;
}
)";

const char* kPresentFragmentShader = R"(
precision mediump float;

uniform sampler2D u_texture;
varying vec2 v_texcoord;

vec3 linear_to_srgb(vec3 c) {
	c = max(c, vec3(0.0));
	bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
	vec3 lo = c * 12.92;
	vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
	return mix(hi, lo, vec3(cutoff));
}

void main() {
	vec3 color = texture2D(u_texture, v_texcoord).rgb;
	gl_FragColor = vec4(linear_to_srgb(color), 1.0);
}
)";

const char* kCRTFragmentShader = R"(
precision mediump float;

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
const float GLOW_BRIGHTNESS_CLAMP = 0.6;

const float FRINGING_BASE_PX       = 0.8;
const float FRINGING_QUAD_COEF     = 2.5;
const float FRINGING_CONTRAST_COEF = 0.4;
const float FRINGING_MIX           = 0.11;

const float FRINGING_OFFSET = 0.5;
const float BLUR_FOOTPRINT_PX = 0.5;
const float K_NORM = 1.0 / 256.0;

const float BLACK_CUTOFF = 0.015;
const float BLACK_SOFT   = 0.060;

varying vec2 v_texcoord;

vec3 linear_to_srgb(vec3 c) {
	c = max(c, vec3(0.0));
	bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
	vec3 lo = c * 12.92;
	vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
	return mix(hi, lo, vec3(cutoff));
}

float hashNoise(vec2 uv, float t){
	vec3 p = vec3(uv * 0.1, t * 0.1);
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
	s = texture2D(u_texture, uv + vec2(-2.0, -2.0) * stepUV).rgb;
	accum += s * 1.0;
	s = texture2D(u_texture, uv + vec2(-1.0, -2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture2D(u_texture, uv + vec2(0.0, -2.0) * stepUV).rgb;
	accum += s * 6.0;
	s = texture2D(u_texture, uv + vec2(1.0, -2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture2D(u_texture, uv + vec2(2.0, -2.0) * stepUV).rgb;
	accum += s * 1.0;

	s = texture2D(u_texture, uv + vec2(-2.0, -1.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture2D(u_texture, uv + vec2(-1.0, -1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(0.0, -1.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(1.0, -1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(2.0, -1.0) * stepUV).rgb;
	accum += s * 4.0;

	s = texture2D(u_texture, uv + vec2(-2.0, 0.0) * stepUV).rgb;
	accum += s * 6.0;
	s = texture2D(u_texture, uv + vec2(-1.0, 0.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv).rgb;
	accum += s * 36.0;
	centerLum = dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(1.0, 0.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(2.0, 0.0) * stepUV).rgb;
	accum += s * 6.0;

	s = texture2D(u_texture, uv + vec2(-2.0, 1.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture2D(u_texture, uv + vec2(-1.0, 1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(0.0, 1.0) * stepUV).rgb;
	accum += s * 24.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(1.0, 1.0) * stepUV).rgb;
	accum += s * 16.0;
	neighLum += dot(s, LUMA);
	s = texture2D(u_texture, uv + vec2(2.0, 1.0) * stepUV).rgb;
	accum += s * 4.0;

	s = texture2D(u_texture, uv + vec2(-2.0, 2.0) * stepUV).rgb;
	accum += s * 1.0;
	s = texture2D(u_texture, uv + vec2(-1.0, 2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture2D(u_texture, uv + vec2(0.0, 2.0) * stepUV).rgb;
	accum += s * 6.0;
	s = texture2D(u_texture, uv + vec2(1.0, 2.0) * stepUV).rgb;
	accum += s * 4.0;
	s = texture2D(u_texture, uv + vec2(2.0, 2.0) * stepUV).rgb;
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
	float A   = mix(SCANLINE_DEPTH, 0.12, clamp(lum, 0.0, 1.0));

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
	vec2 dir = (d > 0.0) ? (dUV / max(d, 1e-6)) : vec2(1.0, 0.0);

	float shiftPx = FRINGING_BASE_PX
					+ FRINGING_QUAD_COEF * (d * d)
					+ FRINGING_CONTRAST_COEF * contrast;

	vec2 shiftUV = dir * (shiftPx * texel);

	float r = texture2D(u_texture, uv + shiftUV).r;
	float g = texture2D(u_texture, uv).g;
	float b = texture2D(u_texture, uv - shiftUV).b;
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

	vec3 color = texture2D(u_texture, v_texcoord).rgb;

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
		color += u_glowColor * clamp(b, 0.0, GLOW_BRIGHTNESS_CLAMP) * k;
	}

	if (u_enableNoise) color += applyNoise(color, v_texcoord, srcPxRes);

	float lumFinal = dot(color, LUMA);
	float keep     = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lumFinal);
	color *= keep;

gl_FragColor = vec4(linear_to_srgb(color), 1.0);
}
)";

const char* kDeviceQuantizeFragmentShader = R"(
precision mediump float;

uniform sampler2D u_texture;
uniform vec2 u_srcResolution;
uniform float u_fragscale;
uniform int u_dither_type;

varying vec2 v_texcoord;

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

vec3 quantize_rgb565_dither(vec3 sRGB, vec2 pix){
	vec3 levels = vec3(31.0, 63.0, 31.0);
	float fx = mod(pix.x, 4.0);
	float fy = mod(pix.y, 4.0);
	int ix = int(fx < 0.0 ? fx + 4.0 : fx);
	int iy = int(fy < 0.0 ? fy + 4.0 : fy);
	float thr;
	if (iy == 0) {
		if (ix == 0) thr = 0.0;
		else if (ix == 1) thr = 8.0;
		else if (ix == 2) thr = 2.0;
		else thr = 10.0;
	} else if (iy == 1) {
		if (ix == 0) thr = 12.0;
		else if (ix == 1) thr = 4.0;
		else if (ix == 2) thr = 14.0;
		else thr = 6.0;
	} else if (iy == 2) {
		if (ix == 0) thr = 3.0;
		else if (ix == 1) thr = 11.0;
		else if (ix == 2) thr = 1.0;
		else thr = 9.0;
	} else {
		if (ix == 0) thr = 15.0;
		else if (ix == 1) thr = 7.0;
		else if (ix == 2) thr = 13.0;
		else thr = 5.0;
	}
	float thrNorm = (thr + 0.5) / 16.0;
	vec3 x = clamp(sRGB, 0.0, 1.0);
	return floor(x * levels + thrNorm) / levels;
}

vec3 quantize_msx10_343(vec3 sRGB, vec2 pix){
	vec3 levels = vec3(7.0, 15.0, 7.0);
	float fx = mod(pix.x, 4.0);
	float fy = mod(pix.y, 4.0);
	int ix = int(fx < 0.0 ? fx + 4.0 : fx);
	int iy = int(fy < 0.0 ? fy + 4.0 : fy);
	float thr;
	if (iy == 0) {
		if (ix == 0) thr = 0.0;
		else if (ix == 1) thr = 8.0;
		else if (ix == 2) thr = 2.0;
		else thr = 10.0;
	} else if (iy == 1) {
		if (ix == 0) thr = 12.0;
		else if (ix == 1) thr = 4.0;
		else if (ix == 2) thr = 14.0;
		else thr = 6.0;
	} else if (iy == 2) {
		if (ix == 0) thr = 3.0;
		else if (ix == 1) thr = 11.0;
		else if (ix == 2) thr = 1.0;
		else thr = 9.0;
	} else {
		if (ix == 0) thr = 15.0;
		else if (ix == 1) thr = 7.0;
		else if (ix == 2) thr = 13.0;
		else thr = 5.0;
	}
	float thrNorm = (thr + 0.5) / 16.0;
	vec3 x = clamp(sRGB, 0.0, 1.0);
	return floor(x * levels + thrNorm) / levels;
}

int psxDitherOffset4x4(vec2 pix){
	float fx = mod(pix.x, 4.0);
	float fy = mod(pix.y, 4.0);
	int ix = int(fx < 0.0 ? fx + 4.0 : fx);
	int iy = int(fy < 0.0 ? fy + 4.0 : fy);
	if (iy == 0) {
		if (ix == 0) return -4;
		if (ix == 1) return 0;
		if (ix == 2) return -3;
		return 1;
	} else if (iy == 1) {
		if (ix == 0) return 2;
		if (ix == 1) return -2;
		if (ix == 2) return 3;
		return -1;
	} else if (iy == 2) {
		if (ix == 0) return -3;
		if (ix == 1) return 1;
		if (ix == 2) return -4;
		return 0;
	}
	if (ix == 0) return 3;
	if (ix == 1) return -1;
	if (ix == 2) return 2;
	return -2;
}

vec3 quantize_rgb555_psx(vec3 sRGB, vec2 pix){
	int off = psxDitherOffset4x4(pix);
	vec3 v8 = sRGB * 255.0 + float(off);
	v8 = clamp(v8, 0.0, 255.0);
	vec3 v5 = floor(v8 / 8.0);
	return v5 / 31.0;
}

void main(){
	vec2 dst = gl_FragCoord.xy - vec2(0.5);
	vec2 uvp = (dst + vec2(0.5)) / (u_srcResolution * u_fragscale);
	vec2 srcMax = u_srcResolution - vec2(1.0);
	vec2 srcXY = uvp * srcMax;
	vec2 sPix = floor(srcXY + vec2(0.5));

	vec3 color = texture2D(u_texture, v_texcoord).rgb;
	vec3 sigS = linear_to_srgb(color);
	if (u_dither_type == 1) {
		sigS = quantize_rgb555_psx(sigS, sPix);
	} else if (u_dither_type == 2) {
		sigS = quantize_rgb565_dither(sigS, sPix);
	} else if (u_dither_type == 3) {
		sigS = quantize_msx10_343(sigS, sPix);
	}
	color = srgb_to_linear(sigS);

	gl_FragColor = vec4(color, 1.0);
}
)";

	GLuint compileShader(GLenum type, const char* src) {
		GLuint shader = glCreateShader(type);
		glShaderSource(shader, 1, &src, nullptr);
		glCompileShader(shader);
		GLint status = 0;
		glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
		if (status == GL_FALSE) {
			GLint log_length = 0;
			glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &log_length);
			std::string log;
			if (log_length > 1) {
				std::string log_buffer;
				log_buffer.resize(static_cast<size_t>(log_length));
				GLsizei written = 0;
				glGetShaderInfoLog(shader, log_length, &written, log_buffer.data());
				log.assign(log_buffer.data(), static_cast<size_t>(written));
			}
			EngineCore::instance().log(LogLevel::Error,
									   "[BMSX] GLES2 CRT shader compile failed: %s\n",
									   log.c_str());
			glDeleteShader(shader);
			throw BMSX_RUNTIME_ERROR(std::string("[BMSX] GLES2 CRT shader compile failed: ") + log);
		}
		return shader;
	}

	GLuint linkProgram(GLuint vs, GLuint fs) {
		GLuint program = glCreateProgram();
		glAttachShader(program, vs);
		glAttachShader(program, fs);
		glLinkProgram(program);
		GLint status = 0;
		glGetProgramiv(program, GL_LINK_STATUS, &status);
		if (status == GL_FALSE) {
			GLint log_length = 0;
			glGetProgramiv(program, GL_INFO_LOG_LENGTH, &log_length);
			std::string log;
			if (log_length > 1) {
				std::string log_buffer;
				log_buffer.resize(static_cast<size_t>(log_length));
				GLsizei written = 0;
				glGetProgramInfoLog(program, log_length, &written, log_buffer.data());
				log.assign(log_buffer.data(), static_cast<size_t>(written));
			}
			EngineCore::instance().log(LogLevel::Error,
									   "[BMSX] GLES2 CRT program link failed: %s\n",
									   log.c_str());
			glDeleteProgram(program);
			glDeleteShader(vs);
			glDeleteShader(fs);
			throw BMSX_RUNTIME_ERROR(std::string("[BMSX] GLES2 CRT program link failed: ") + log);
		}
		glDeleteShader(vs);
		glDeleteShader(fs);
		return program;
	}

void updateFullscreenQuad(i32 width, i32 height) {
	if (g_crt.width == width && g_crt.height == height) return;

	g_crt.width = width;
	g_crt.height = height;

	const float w = static_cast<float>(width);
	const float h = static_cast<float>(height);
	const float positions[12] = {
		0.0f, 0.0f,
		0.0f, h,
		w, 0.0f,
		w, 0.0f,
		0.0f, h,
		w, h
	};
	const float texcoords[12] = {
		0.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 1.0f,
		1.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 0.0f
	};

	glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_pos);
	glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);

	glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_uv);
	glBufferData(GL_ARRAY_BUFFER, sizeof(texcoords), texcoords, GL_STATIC_DRAW);
}

void updateDeviceQuad(i32 width, i32 height) {
	if (g_device.width == width && g_device.height == height) return;

	g_device.width = width;
	g_device.height = height;

	const float w = static_cast<float>(width);
	const float h = static_cast<float>(height);
	const float positions[12] = {
		0.0f, 0.0f,
		0.0f, h,
		w, 0.0f,
		w, 0.0f,
		0.0f, h,
		w, h
	};
	const float texcoords[12] = {
		0.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 1.0f,
		1.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 0.0f
	};

	glBindBuffer(GL_ARRAY_BUFFER, g_device.vbo_pos);
	glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);

	glBindBuffer(GL_ARRAY_BUFFER, g_device.vbo_uv);
	glBufferData(GL_ARRAY_BUFFER, sizeof(texcoords), texcoords, GL_STATIC_DRAW);
}

} // namespace

void initPresentGLES2(OpenGLES2Backend* backend) {
	(void)backend;

	GLuint vs = compileShader(GL_VERTEX_SHADER, kCRTVertexShader);
	GLuint fs = compileShader(GL_FRAGMENT_SHADER, kPresentFragmentShader);
	g_present.program = linkProgram(vs, fs);

	g_present.attrib_pos = glGetAttribLocation(g_present.program, "a_position");
	g_present.attrib_uv = glGetAttribLocation(g_present.program, "a_texcoord");

	g_present.uniform_resolution = glGetUniformLocation(g_present.program, "u_resolution");
	g_present.uniform_scale = glGetUniformLocation(g_present.program, "u_scale");
	g_present.uniform_texture = glGetUniformLocation(g_present.program, "u_texture");

	glGenBuffers(1, &g_present.vbo_pos);
	glGenBuffers(1, &g_present.vbo_uv);

	glUseProgram(g_present.program);
	glUniform1i(g_present.uniform_texture, kTexUnitPostProcess);
}

void initDeviceQuantizeGLES2(OpenGLES2Backend* backend) {
	(void)backend;

	GLuint vs = compileShader(GL_VERTEX_SHADER, kCRTVertexShader);
	GLuint fs = compileShader(GL_FRAGMENT_SHADER, kDeviceQuantizeFragmentShader);
	g_device.program = linkProgram(vs, fs);

	g_device.attrib_pos = glGetAttribLocation(g_device.program, "a_position");
	g_device.attrib_uv = glGetAttribLocation(g_device.program, "a_texcoord");

	g_device.uniform_resolution = glGetUniformLocation(g_device.program, "u_resolution");
	g_device.uniform_src_resolution = glGetUniformLocation(g_device.program, "u_srcResolution");
	g_device.uniform_scale = glGetUniformLocation(g_device.program, "u_scale");
	g_device.uniform_fragscale = glGetUniformLocation(g_device.program, "u_fragscale");
	g_device.uniform_dither_type = glGetUniformLocation(g_device.program, "u_dither_type");
	g_device.uniform_texture = glGetUniformLocation(g_device.program, "u_texture");

	glGenBuffers(1, &g_device.vbo_pos);
	glGenBuffers(1, &g_device.vbo_uv);

	glUseProgram(g_device.program);
	glUniform1i(g_device.uniform_texture, kTexUnitPostProcess);
}

void initGLES2(OpenGLES2Backend* backend) {
	(void)backend;

	GLuint vs = compileShader(GL_VERTEX_SHADER, kCRTVertexShader);
	GLuint fs = compileShader(GL_FRAGMENT_SHADER, kCRTFragmentShader);
	g_crt.program = linkProgram(vs, fs);

	g_crt.attrib_pos = glGetAttribLocation(g_crt.program, "a_position");
	g_crt.attrib_uv = glGetAttribLocation(g_crt.program, "a_texcoord");

	g_crt.uniform_resolution = glGetUniformLocation(g_crt.program, "u_resolution");
	g_crt.uniform_src_resolution = glGetUniformLocation(g_crt.program, "u_srcResolution");
	g_crt.uniform_scale = glGetUniformLocation(g_crt.program, "u_scale");
	g_crt.uniform_fragscale = glGetUniformLocation(g_crt.program, "u_fragscale");
	g_crt.uniform_time = glGetUniformLocation(g_crt.program, "u_time");
	g_crt.uniform_random = glGetUniformLocation(g_crt.program, "u_random");
	g_crt.uniform_apply_noise = glGetUniformLocation(g_crt.program, "u_enableNoise");
	g_crt.uniform_apply_color_bleed = glGetUniformLocation(g_crt.program, "u_enableColorBleed");
	g_crt.uniform_apply_scanlines = glGetUniformLocation(g_crt.program, "u_enableScanlines");
	g_crt.uniform_apply_blur = glGetUniformLocation(g_crt.program, "u_enableBlur");
	g_crt.uniform_apply_glow = glGetUniformLocation(g_crt.program, "u_enableGlow");
	g_crt.uniform_apply_fringing = glGetUniformLocation(g_crt.program, "u_enableFringing");
	g_crt.uniform_apply_aperture = glGetUniformLocation(g_crt.program, "u_enableAperture");
	g_crt.uniform_noise_intensity = glGetUniformLocation(g_crt.program, "u_noiseIntensity");
	g_crt.uniform_color_bleed = glGetUniformLocation(g_crt.program, "u_colorBleed");
	g_crt.uniform_blur_intensity = glGetUniformLocation(g_crt.program, "u_blurIntensity");
	g_crt.uniform_glow_color = glGetUniformLocation(g_crt.program, "u_glowColor");
	g_crt.uniform_texture = glGetUniformLocation(g_crt.program, "u_texture");

	glGenBuffers(1, &g_crt.vbo_pos);
	glGenBuffers(1, &g_crt.vbo_uv);

	glUseProgram(g_crt.program);
	// Re-apply sampler binding every draw; shared contexts can clobber uniform state.
	// This keeps the CRT pass sampling the offscreen color texture.
	glUniform1i(g_crt.uniform_texture, kTexUnitPostProcess);
	if (kCRTVerboseLog) {
		std::fprintf(stderr,
					 "[BMSX][GLES2][CRT] init program=%u attribs(pos=%d uv=%d) uniforms(res=%d srcRes=%d scale=%d fragscale=%d time=%d random=%d tex=%d)\n",
					 static_cast<unsigned>(g_crt.program), g_crt.attrib_pos,
					 g_crt.attrib_uv, g_crt.uniform_resolution,
					 g_crt.uniform_src_resolution, g_crt.uniform_scale,
					 g_crt.uniform_fragscale, g_crt.uniform_time,
					 g_crt.uniform_random, g_crt.uniform_texture);
	}
}

void shutdownGLES2(OpenGLES2Backend* backend) {
	(void)backend;
	if (g_crt.program != 0) glDeleteProgram(g_crt.program);
	if (g_crt.vbo_pos != 0) glDeleteBuffers(1, &g_crt.vbo_pos);
	if (g_crt.vbo_uv != 0) glDeleteBuffers(1, &g_crt.vbo_uv);
	if (g_device.program != 0) glDeleteProgram(g_device.program);
	if (g_device.vbo_pos != 0) glDeleteBuffers(1, &g_device.vbo_pos);
	if (g_device.vbo_uv != 0) glDeleteBuffers(1, &g_device.vbo_uv);
	if (g_present.program != 0) glDeleteProgram(g_present.program);
	if (g_present.vbo_pos != 0) glDeleteBuffers(1, &g_present.vbo_pos);
	if (g_present.vbo_uv != 0) glDeleteBuffers(1, &g_present.vbo_uv);
	g_crt = CRTGLES2State{};
	g_device = DeviceQuantizeGLES2State{};
	g_present = PresentGLES2State{};
}

void renderPresentGLES2(OpenGLES2Backend* backend, GameView* context, const CRTPipelineState& state) {
	(void)context;

	glUseProgram(g_present.program);
	glUniform1i(g_present.uniform_texture, kTexUnitPostProcess);

	if (g_present.width != state.width || g_present.height != state.height) {
		g_present.width = state.width;
		g_present.height = state.height;
		const float w = static_cast<float>(state.width);
		const float h = static_cast<float>(state.height);
		const float positions[12] = {
			0.0f, 0.0f,
			0.0f, h,
			w, 0.0f,
			w, 0.0f,
			0.0f, h,
			w, h
		};
		const float texcoords[12] = {
			0.0f, 1.0f,
			0.0f, 0.0f,
			1.0f, 1.0f,
			1.0f, 1.0f,
			0.0f, 0.0f,
			1.0f, 0.0f
		};
		glBindBuffer(GL_ARRAY_BUFFER, g_present.vbo_pos);
		glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);
		glBindBuffer(GL_ARRAY_BUFFER, g_present.vbo_uv);
		glBufferData(GL_ARRAY_BUFFER, sizeof(texcoords), texcoords, GL_STATIC_DRAW);
	}

	backend->setRenderTarget(backend->backbuffer(), state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);

	glBindBuffer(GL_ARRAY_BUFFER, g_present.vbo_pos);
	glEnableVertexAttribArray(static_cast<GLuint>(g_present.attrib_pos));
	glVertexAttribPointer(static_cast<GLuint>(g_present.attrib_pos), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glBindBuffer(GL_ARRAY_BUFFER, g_present.vbo_uv);
	glEnableVertexAttribArray(static_cast<GLuint>(g_present.attrib_uv));
	glVertexAttribPointer(static_cast<GLuint>(g_present.attrib_uv), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glUniform2f(g_present.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform1f(g_present.uniform_scale, 1.0f);

	backend->setActiveTextureUnit(kTexUnitPostProcess);
	backend->bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void renderDeviceQuantizeGLES2(OpenGLES2Backend* backend, GameView* context, const DeviceQuantizePipelineState& state) {
	(void)context;

	glUseProgram(g_device.program);
	glUniform1i(g_device.uniform_texture, kTexUnitPostProcess);

	updateDeviceQuad(state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);

	glBindBuffer(GL_ARRAY_BUFFER, g_device.vbo_pos);
	glEnableVertexAttribArray(static_cast<GLuint>(g_device.attrib_pos));
	glVertexAttribPointer(static_cast<GLuint>(g_device.attrib_pos), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glBindBuffer(GL_ARRAY_BUFFER, g_device.vbo_uv);
	glEnableVertexAttribArray(static_cast<GLuint>(g_device.attrib_uv));
	glVertexAttribPointer(static_cast<GLuint>(g_device.attrib_uv), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glUniform2f(g_device.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform2f(g_device.uniform_src_resolution, static_cast<float>(state.baseWidth), static_cast<float>(state.baseHeight));
	glUniform1f(g_device.uniform_scale, 1.0f);
	glUniform1f(g_device.uniform_fragscale, static_cast<float>(state.width) / static_cast<float>(state.baseWidth));
	glUniform1i(g_device.uniform_dither_type, state.ditherType);

	backend->setActiveTextureUnit(kTexUnitPostProcess);
	backend->bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void renderCRTGLES2(OpenGLES2Backend* backend, GameView* context, const CRTPipelineState& state) {
	(void)context;

	glUseProgram(g_crt.program);
	glUniform1i(g_crt.uniform_texture, kTexUnitPostProcess);
	if (kCRTVerboseLog) {
		auto* srcTex = OpenGLES2Backend::asTexture(state.colorTex);
		std::fprintf(stderr,
					 "[BMSX][GLES2][CRT] render backbuffer_fbo=%u colorTex=%u size=%dx%d base=%dx%d\n",
					 static_cast<unsigned>(backend->backbuffer()),
					 static_cast<unsigned>(srcTex->id), state.width,
					 state.height, state.baseWidth, state.baseHeight);
	}
	updateFullscreenQuad(state.width, state.height);

	backend->setRenderTarget(backend->backbuffer(), state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);

	glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_pos);
	glEnableVertexAttribArray(static_cast<GLuint>(g_crt.attrib_pos));
	glVertexAttribPointer(static_cast<GLuint>(g_crt.attrib_pos), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_uv);
	glEnableVertexAttribArray(static_cast<GLuint>(g_crt.attrib_uv));
	glVertexAttribPointer(static_cast<GLuint>(g_crt.attrib_uv), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glUniform2f(g_crt.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform2f(g_crt.uniform_src_resolution, static_cast<float>(state.baseWidth), static_cast<float>(state.baseHeight));
	glUniform1f(g_crt.uniform_scale, 1.0f);
	glUniform1f(g_crt.uniform_fragscale, static_cast<float>(state.srcWidth) / static_cast<float>(state.baseWidth));
  glUniform1f(g_crt.uniform_time, static_cast<float>(EngineCore::instance().totalTime()));
	glUniform1f(g_crt.uniform_random, static_cast<float>(std::rand()) / static_cast<float>(RAND_MAX));

	glUniform1i(g_crt.uniform_apply_noise, state.options.applyNoise ? 1 : 0);
	glUniform1i(g_crt.uniform_apply_color_bleed, state.options.applyColorBleed ? 1 : 0);
	glUniform1i(g_crt.uniform_apply_scanlines, state.options.applyScanlines ? 1 : 0);
	glUniform1i(g_crt.uniform_apply_blur, state.options.applyBlur ? 1 : 0);
	glUniform1i(g_crt.uniform_apply_glow, state.options.applyGlow ? 1 : 0);
	glUniform1i(g_crt.uniform_apply_fringing, state.options.applyFringing ? 1 : 0);
	glUniform1i(g_crt.uniform_apply_aperture, state.options.applyAperture ? 1 : 0);

	glUniform1f(g_crt.uniform_noise_intensity, state.options.noiseIntensity);
	glUniform3f(g_crt.uniform_color_bleed, state.options.colorBleed[0], state.options.colorBleed[1], state.options.colorBleed[2]);
	glUniform1f(g_crt.uniform_blur_intensity, state.options.blurIntensity);
	glUniform3f(g_crt.uniform_glow_color, state.options.glowColor[0], state.options.glowColor[1], state.options.glowColor[2]);

	backend->setActiveTextureUnit(kTexUnitPostProcess);
	backend->bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

} // namespace CRTPipeline
} // namespace bmsx
