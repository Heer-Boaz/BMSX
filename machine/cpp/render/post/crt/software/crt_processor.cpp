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

constexpr f32 kBlackCutoff = 0.015f;
constexpr f32 kBlackSoft = 0.060f;

constexpr f32 kKernelNorm = 1.0f / 256.0f;

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
	LinearRgb center;
	LinearRgb blurred;
	f32 contrast = 0.0f;
};

struct SampleAxis {
	i32 before;
	i32 center;
	i32 after;
	f32 blurBefore;
	f32 blurAfter;
	f32 contrastBefore;
	f32 contrastAfter;
};

// Nearest sampling merges the half-pixel five-tap axis into three source
// pixels; the subpixel phase selects the exact combined weights.
inline SampleAxis collapsedKernelAxis(f32 coordinate, i32 size) {
	const f32 nearestCoordinate = coordinate + 0.5f;
	const i32 center = static_cast<i32>(nearestCoordinate);
	const bool upperHalf = nearestCoordinate - static_cast<f32>(center) >= 0.5f;
	return {
		clamp(center - 1, 0, size - 1),
		center,
		clamp(center + 1, 0, size - 1),
		upperHalf ? 1.0f : 5.0f,
		upperHalf ? 5.0f : 1.0f,
		upperHalf ? 0.0f : 1.0f,
		upperHalf ? 1.0f : 0.0f,
	};
}

struct CollapsedKernelRow {
	LinearRgb center;
	LinearRgb blurred;
	LinearRgb neighborhood;
};

inline CollapsedKernelRow collapseKernelRow(
	const u32* row,
	const SampleAxis& x,
	const std::array<f32, 256>& table) {
	const LinearRgb before = unpackLinear(row[x.before], table);
	const LinearRgb center = unpackLinear(row[x.center], table);
	const LinearRgb after = unpackLinear(row[x.after], table);
	return {
		center,
		{
			before.r * x.blurBefore + center.r * 10.0f + after.r * x.blurAfter,
			before.g * x.blurBefore + center.g * 10.0f + after.g * x.blurAfter,
			before.b * x.blurBefore + center.b * 10.0f + after.b * x.blurAfter,
		},
		{
			before.r * x.contrastBefore + center.r * 2.0f + after.r * x.contrastAfter,
			before.g * x.contrastBefore + center.g * 2.0f + after.g * x.contrastAfter,
			before.b * x.contrastBefore + center.b * 2.0f + after.b * x.contrastAfter,
		},
	};
}

inline BlurContrast applyBlurAndContrast(
	const u32* topRow,
	const u32* middleRow,
	const u32* bottomRow,
	const SampleAxis& x,
	const SampleAxis& y,
	const std::array<f32, 256>& table) {
	const CollapsedKernelRow top = collapseKernelRow(topRow, x, table);
	const CollapsedKernelRow middle = collapseKernelRow(middleRow, x, table);
	const CollapsedKernelRow bottom = collapseKernelRow(bottomRow, x, table);
	const LinearRgb neighborhood = {
		top.neighborhood.r * y.contrastBefore + middle.neighborhood.r * 2.0f + bottom.neighborhood.r * y.contrastAfter - middle.center.r,
		top.neighborhood.g * y.contrastBefore + middle.neighborhood.g * 2.0f + bottom.neighborhood.g * y.contrastAfter - middle.center.g,
		top.neighborhood.b * y.contrastBefore + middle.neighborhood.b * 2.0f + bottom.neighborhood.b * y.contrastAfter - middle.center.b,
	};
	return {
		middle.center,
		{
			(top.blurred.r * y.blurBefore + middle.blurred.r * 10.0f + bottom.blurred.r * y.blurAfter) * kKernelNorm,
			(top.blurred.g * y.blurBefore + middle.blurred.g * 10.0f + bottom.blurred.g * y.blurAfter) * kKernelNorm,
			(top.blurred.b * y.blurBefore + middle.blurred.b * 10.0f + bottom.blurred.b * y.blurAfter) * kKernelNorm,
		},
		std::abs(luminance(middle.center) - luminance(neighborhood) * 0.125f),
	};
}

// Mirrors the GPU CRT shader hash exactly (crt.frag.glsl / crt.frag.wgsl
// hashNoise): wrap the inputs for precision, scale the z/time term by 1e-4
// (NOT 0.1), then the same dot/fract mix. Inputs here are non-negative, so the
// truncating fract() above matches GLSL fract().
inline f32 hashNoise(f32 u, f32 v, f32 t) {
	const f32 wu = u - 1024.0f * static_cast<f32>(static_cast<i32>(u / 1024.0f));
	const f32 wv = v - 1024.0f * static_cast<f32>(static_cast<i32>(v / 1024.0f));
	const f32 wt = t - 4096.0f * static_cast<f32>(static_cast<i32>(t / 4096.0f));
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
	const auto& options = state.options;
	const bool usesCollapsedKernel = options.applyBlur || options.applyFringing || options.applyAperture || options.applyScanlines;
	const f32 random = options.applyNoise ? hashNoise(time, srcWf, srcHf) : 0.0f;
	const u32* sampleSource = src;

	for (i32 y = 0; y < dstHeight; ++y) {
		const f32 uvY = (static_cast<f32>(y) + 0.5f) * invOutH;
		const f32 srcY = uvY * srcMaxY;
		u32* dstRow = dst + y * dstPixelsPerRow;
		const SampleAxis kernelY = collapsedKernelAxis(srcY, srcHeight);
		const u32* topRow = sampleSource + kernelY.before * srcWidth;
		const u32* middleRow = sampleSource + kernelY.center * srcWidth;
		const u32* bottomRow = sampleSource + kernelY.after * srcWidth;
		const f32 sourceY = uvY * srcHf;
		const i32 sourceRow = static_cast<i32>(sourceY);
		const f32 scanlinePhase = (sourceRow & 1) == 0 ? 1.0f : -1.0f;
		const f32 lineNoise = options.applyNoise
			? hashNoise(0.0f, static_cast<f32>(sourceRow) + time * 30.0f, 0.0f) - 0.5f
			: 0.0f;
		for (i32 x = 0; x < dstWidth; ++x) {
			const f32 uvX = (static_cast<f32>(x) + 0.5f) * invOutW;
			const f32 srcX = uvX * srcMaxX;

			BlurContrast bc;
			if (usesCollapsedKernel) {
				const SampleAxis kernelX = collapsedKernelAxis(srcX, srcWidth);
				bc = applyBlurAndContrast(topRow, middleRow, bottomRow, kernelX, kernelY, table);
			} else {
				bc.center = sampleLinear(sampleSource, srcWidth, srcHeight, srcX, srcY, table);
				bc.blurred = bc.center;
				bc.contrast = 0.0f;
			}
			const LinearRgb baseTex = bc.center;
			LinearRgb color = bc.center;

			if (options.applyColorBleed) {
				color.r += options.colorBleed[0];
				color.g += options.colorBleed[1];
				color.b += options.colorBleed[2];
			}

			const f32 edge = smoothstep(0.01f, 0.05f, bc.contrast);

			if (options.applyBlur) {
				const f32 blurEdge = 1.0f - (0.75f * edge);
				const f32 blurK = blurEdge * options.blurIntensity;
				color.r += (bc.blurred.r - color.r) * blurK;
				color.g += (bc.blurred.g - color.g) * blurK;
				color.b += (bc.blurred.b - color.b) * blurK;
			}

			if (options.applyFringing) {
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

			if (options.applyScanlines) {
				const f32 lum = luminance(color);
				const f32 A = kScanlineDepth + (0.12f - kScanlineDepth) * lum;
				f32 mask = 1.0f - A * (0.5f - 0.5f * scanlinePhase);
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

			if (options.applyAperture) {
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

			if (options.applyGlow) {
				const f32 lum = luminance(color);
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 glow = lum * k;
				color.r += options.glowColor[0] * glow;
				color.g += options.glowColor[1] * glow;
				color.b += options.glowColor[2] * glow;
			}

			if (options.applyNoise) {
				const f32 pixNoise =
					hashNoise(uvX * srcWf + random,
								sourceY + random,
								time) - 0.5f;
				const f32 lum = luminance(color);
				const f32 n = pixNoise * 0.65f + lineNoise * 0.35f;
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 amp = options.noiseIntensity * (1.0f - 0.8f * lum);
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
			dstRow[x] = (0xFF << 24) | (r << 16) | (g << 8) | b;
		}
	}
}

} // namespace Software
} // namespace CRTPipeline
} // namespace bmsx
