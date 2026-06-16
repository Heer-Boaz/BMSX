/*
 * crt_processor.cpp - Software CRT post processor
 */

#include "crt_processor.h"

#include "common/clamp.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"

#include <array>
#include <cmath>
#include <cstddef>

namespace bmsx {
namespace CRTPipeline {
namespace Software {

namespace {

constexpr f32 kPi = 3.14159265359f;
constexpr f32 kLumaR = 0.299f;
constexpr f32 kLumaG = 0.587f;
constexpr f32 kLumaB = 0.114f;

constexpr f32 kScanlineDepth = 0.07f;
constexpr f32 kApertureStrength = 0.08f;
constexpr f32 kFringingBasePx = 0.8f;
constexpr f32 kFringingQuadCoef = 2.5f;
constexpr f32 kFringingContrastCoef = 0.4f;
constexpr f32 kFringingMix = 0.11f;
constexpr f32 kFringingOffset = 0.5f;
constexpr f32 kBlurFootprintPx = 0.5f;

constexpr f32 kBlackCutoff = 0.015f;
constexpr f32 kBlackSoft = 0.060f;

constexpr f32 kKernelNorm = 1.0f / 256.0f;
constexpr f32 kKernel5x5[25] = {
	1.0f,  4.0f,  6.0f,  4.0f, 1.0f,
	4.0f, 16.0f, 24.0f, 16.0f, 4.0f,
	6.0f, 24.0f, 36.0f, 24.0f, 6.0f,
	4.0f, 16.0f, 24.0f, 16.0f, 4.0f,
	1.0f,  4.0f,  6.0f,  4.0f, 1.0f,
};

inline f32 smoothstep(f32 edge0, f32 edge1, f32 x) {
	const f32 t = clamp((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
	return t * t * (3.0f - 2.0f * t);
}

inline u8 signalByte(f32 c) {
	return static_cast<u8>(clamp(c, 0.0f, 1.0f) * 255.0f + 0.5f);
}

inline f32 fract(f32 v) {
	return v - static_cast<f32>(static_cast<i32>(v));
}

std::array<f32, 256> buildByteToLinearTable() {
	std::array<f32, 256> table{};
	for (i32 i = 0; i < 256; ++i) {
		table[static_cast<size_t>(i)] = static_cast<f32>(i) / 255.0f;
	}
	return table;
}

const std::array<f32, 256> kByteToLinearTable = buildByteToLinearTable();

struct LinearRgb {
	f32 r = 0.0f;
	f32 g = 0.0f;
	f32 b = 0.0f;
};

inline LinearRgb unpackLinear(u32 pixel, const std::array<f32, 256>& table) {
	const u8 r = (pixel >> 16) & 0xFF;
	const u8 g = (pixel >> 8) & 0xFF;
	const u8 b = pixel & 0xFF;
	return {table[r], table[g], table[b]};
}

inline LinearRgb sampleLinear(const u32* src, i32 width, i32 height, f32 x, f32 y,
							const std::array<f32, 256>& table) {
	const i32 xi = static_cast<i32>(x + 0.5f);
	const i32 yi = static_cast<i32>(y + 0.5f);
	const i32 clampedX = clamp(xi, 0, width - 1);
	const i32 clampedY = clamp(yi, 0, height - 1);
	return unpackLinear(src[clampedY * width + clampedX], table);
}

inline f32 luminance(const LinearRgb& c) {
	return c.r * kLumaR + c.g * kLumaG + c.b * kLumaB;
}

struct BlurContrast {
	LinearRgb blurred;
	f32 contrast = 0.0f;
};

inline BlurContrast applyBlurAndContrast(const u32* src, i32 width, i32 height,
											f32 x, f32 y,
											const std::array<f32, 256>& table) {
	f32 accumR = 0.0f;
	f32 accumG = 0.0f;
	f32 accumB = 0.0f;
	f32 centerLum = 0.0f;
	f32 neighLum = 0.0f;
	f32 neighCount = 0.0f;
	i32 idx = 0;

	for (i32 oy = -2; oy <= 2; ++oy) {
		for (i32 ox = -2; ox <= 2; ++ox, ++idx) {
			const f32 sampleX = x + static_cast<f32>(ox) * kBlurFootprintPx;
			const f32 sampleY = y + static_cast<f32>(oy) * kBlurFootprintPx;
			const LinearRgb s = sampleLinear(src, width, height, sampleX, sampleY, table);
			const f32 w = kKernel5x5[idx] * kKernelNorm;
			accumR += s.r * w;
			accumG += s.g * w;
			accumB += s.b * w;

			if (std::abs(ox) <= 1 && std::abs(oy) <= 1) {
				const f32 lum = luminance(s);
				if (ox == 0 && oy == 0) {
					centerLum = lum;
				} else {
					neighLum += lum;
					neighCount += 1.0f;
				}
			}
		}
	}

	const f32 neighAvg = (neighCount > 0.0f) ? (neighLum / neighCount) : centerLum;
	BlurContrast out;
	out.blurred = {accumR, accumG, accumB};
	out.contrast = std::abs(centerLum - neighAvg);
	return out;
}

// Mirrors the GPU CRT shader hash exactly (crt.frag.glsl / crt.frag.wgsl
// hashNoise): wrap the inputs for precision, scale the z/time term by 1e-4
// (NOT 0.1), then the same dot/fract mix. Inputs here are non-negative, so the
// truncating fract() above matches GLSL fract().
inline f32 hashNoise(f32 u, f32 v, f32 t) {
	const f32 wu = u - 1024.0f * std::floor(u / 1024.0f);
	const f32 wv = v - 1024.0f * std::floor(v / 1024.0f);
	const f32 wt = t - 4096.0f * std::floor(t / 4096.0f);
	f32 px = fract(wu * 0.1f * 12.9898f);
	f32 py = fract(wv * 0.1f * 78.233f);
	f32 pz = fract(wt * 0.0001f * 43758.5453f);
	const f32 dotp = px * (py + 19.19f) + py * (pz + 19.19f) + pz * (px + 19.19f);
	px += dotp;
	py += dotp;
	pz += dotp;
	return fract((px + py) * pz);
}



} // namespace

void renderCRT(SoftwareBackend& backend, const CRTPipelineState& state) {
	auto* colorTex = static_cast<SoftwareTexture*>(state.colorTex);
	const u32* src = colorTex->data.data();
	const i32 srcWidth = colorTex->width;
	const i32 srcHeight = colorTex->height;
	u32* dst = backend.framebuffer();
	const i32 dstWidth = backend.width();
	const i32 dstHeight = backend.height();
	const i32 dstPitch = backend.pitch();

	const i32 dstPixelsPerRow = dstPitch / sizeof(u32);

	const auto& table = kByteToLinearTable;
	const f32 invOutW = 1.0f / static_cast<f32>(dstWidth);
	const f32 invOutH = 1.0f / static_cast<f32>(dstHeight);
	const f32 srcWf = static_cast<f32>(srcWidth);
	const f32 srcHf = static_cast<f32>(srcHeight);
	const f32 srcMaxX = srcWf - 1.0f;
	const f32 srcMaxY = srcHf - 1.0f;
	const f32 time = static_cast<f32>(state.time);
	const f32 random = hashNoise(time, srcWf, srcHf);

	const bool useNoise = state.options.applyNoise;
	const bool useColorBleed = state.options.applyColorBleed;
	const bool useScanlines = state.options.applyScanlines;
	const bool useBlur = state.options.applyBlur;
	const bool useGlow = state.options.applyGlow;
	const bool useFringing = state.options.applyFringing;
	const bool useAperture = state.options.applyAperture;
	const f32 blurMix = state.options.blurIntensity;
	const u32* sampleSource = src;

	for (i32 y = 0; y < dstHeight; ++y) {
		const f32 uvY = (static_cast<f32>(y) + 0.5f) * invOutH;
		const f32 srcY = uvY * srcMaxY;
		for (i32 x = 0; x < dstWidth; ++x) {
			const f32 uvX = (static_cast<f32>(x) + 0.5f) * invOutW;
			const f32 srcX = uvX * srcMaxX;
			const i32 dstIdx = y * dstPixelsPerRow + x;

			const LinearRgb baseTex = sampleLinear(sampleSource, srcWidth, srcHeight, srcX, srcY, table);
			LinearRgb color = baseTex;

			if (useColorBleed) {
				color.r += state.options.colorBleed[0];
				color.g += state.options.colorBleed[1];
				color.b += state.options.colorBleed[2];
			}

			BlurContrast bc;
			if (useBlur || useFringing || useAperture || useScanlines) {
				bc = applyBlurAndContrast(sampleSource, srcWidth, srcHeight, srcX, srcY, table);
			} else {
				bc.blurred = color;
				bc.contrast = 0.0f;
			}

			const f32 edge = smoothstep(0.01f, 0.05f, bc.contrast);

			if (useBlur) {
				const f32 blurEdge = 1.0f - (0.75f * edge);
				const f32 blurK = blurEdge * blurMix;
				color.r += (bc.blurred.r - color.r) * blurK;
				color.g += (bc.blurred.g - color.g) * blurK;
				color.b += (bc.blurred.b - color.b) * blurK;
			}

			if (useFringing) {
				const f32 mixK = kFringingMix * edge;
				const f32 dUVx = uvX - kFringingOffset;
				const f32 dUVy = uvY - kFringingOffset;
				const f32 d = std::sqrt(dUVx * dUVx + dUVy * dUVy) * 1.41421356f;
				const f32 invD = (d > 0.0f) ? (1.0f / d) : 0.0f;
				const f32 dirX = (d > 0.0f) ? (dUVx * invD) : 1.0f;
				const f32 dirY = (d > 0.0f) ? (dUVy * invD) : 0.0f;
				const f32 shiftPx = kFringingBasePx +
									kFringingQuadCoef * (d * d) +
									kFringingContrastCoef * bc.contrast;
				const f32 shiftX = dirX * shiftPx;
				const f32 shiftY = dirY * shiftPx;

				const LinearRgb rSample = sampleLinear(sampleSource, srcWidth, srcHeight,
													srcX + shiftX, srcY + shiftY, table);
				const LinearRgb bSample = sampleLinear(sampleSource, srcWidth, srcHeight,
													srcX - shiftX, srcY - shiftY, table);
				const LinearRgb fringed{rSample.r, baseTex.g, bSample.b};
				color.r += (fringed.r - color.r) * mixK;
				color.g += (fringed.g - color.g) * mixK;
				color.b += (fringed.b - color.b) * mixK;
			}

			if (useScanlines) {
				const f32 lum = luminance(color);
				const f32 A = kScanlineDepth + (0.12f - kScanlineDepth) * lum;
				const f32 row = static_cast<f32>(static_cast<i32>(uvY * srcHf));
				const f32 phase = std::cos(kPi * row);
				f32 mask = 1.0f - A * (0.5f - 0.5f * phase);
				mask /= (1.0f - 0.5f * A);
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 scale = 1.0f + k * (mask - 1.0f);
				const f32 scanR = color.r * scale;
				const f32 scanG = color.g * scale;
				const f32 scanB = color.b * scale;
				color.r = scanR * (1.0f - edge) + color.r * edge;
				color.g = scanG * (1.0f - edge) + color.g * edge;
				color.b = scanB * (1.0f - edge) + color.b * edge;
			}

			if (useAperture) {
				const i32 aperturePhase = static_cast<i32>(uvX * srcWf) % 3;
				const f32 r = aperturePhase == 0 ? 1.0f : 0.0f;
				const f32 g = aperturePhase == 1 ? 1.0f : 0.0f;
				const f32 b = aperturePhase == 2 ? 1.0f : 0.0f;
				const f32 maskR = 1.0f + kApertureStrength * ((r * 2.0f) - 1.0f);
				const f32 maskG = 1.0f + kApertureStrength * ((g * 2.0f) - 1.0f);
				const f32 maskB = 1.0f + kApertureStrength * ((b * 2.0f) - 1.0f);
				const f32 lum = luminance(color);
				f32 k = smoothstep(0.0f, 0.25f, lum);
				k = std::sqrt(k);
				const f32 apertureR = color.r * (1.0f + k * (maskR - 1.0f));
				const f32 apertureG = color.g * (1.0f + k * (maskG - 1.0f));
				const f32 apertureB = color.b * (1.0f + k * (maskB - 1.0f));
				color.r = apertureR * (1.0f - edge) + color.r * edge;
				color.g = apertureG * (1.0f - edge) + color.g * edge;
				color.b = apertureB * (1.0f - edge) + color.b * edge;
			}

			if (useGlow) {
				const f32 lum = luminance(color);
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 glow = lum * k;
				color.r += state.options.glowColor[0] * glow;
				color.g += state.options.glowColor[1] * glow;
				color.b += state.options.glowColor[2] * glow;
			}

			if (useNoise) {
				const f32 ySrc = uvY * srcHf;
				const f32 lineNoise =
					hashNoise(0.0f, static_cast<f32>(static_cast<i32>(ySrc)) + time * 30.0f, 0.0f) - 0.5f;
				const f32 pixNoise =
					hashNoise(uvX * srcWf + random,
								uvY * srcHf + random,
								time) - 0.5f;
				const f32 lum = luminance(color);
				const f32 n = pixNoise * 0.65f + lineNoise * 0.35f;
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 amp = state.options.noiseIntensity * (1.0f - 0.8f * lum);
				color.r += color.r * (n * amp * k);
				color.g += color.g * (n * amp * k);
				color.b += color.b * (n * amp * k);
			}

			const f32 lumFinal = luminance(color);
			const f32 keep = smoothstep(kBlackCutoff, kBlackSoft, lumFinal);
			color.r *= keep;
			color.g *= keep;
			color.b *= keep;

			const u8 r = signalByte(color.r);
			const u8 g = signalByte(color.g);
			const u8 b = signalByte(color.b);
			dst[dstIdx] = (0xFF << 24) | (r << 16) | (g << 8) | b;
		}
	}
}

} // namespace Software
} // namespace CRTPipeline
} // namespace bmsx
