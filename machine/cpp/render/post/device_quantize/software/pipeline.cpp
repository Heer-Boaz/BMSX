/*
 * pipeline.cpp - Software device quantize post pass
 */

#include "pipeline.h"

#include "common/clamp.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"

#include <array>
#include <cmath>

namespace bmsx {
namespace DeviceQuantizePipeline {
namespace Software {
namespace {

constexpr f32 kLinearToSignalTableScale = 4095.0f;
constexpr f32 kSignalToLinearTableScale = 4095.0f;

std::array<f32, 4096> buildLinearToSignalTable() {
	std::array<f32, 4096> table{};
	for (i32 i = 0; i < 4096; i += 1) {
		const f32 c = static_cast<f32>(i) / kLinearToSignalTableScale;
		table[static_cast<size_t>(i)] = c <= 0.0031308f
			? c * 12.92f
			: 1.055f * std::pow(c, 1.0f / 2.4f) - 0.055f;
	}
	return table;
}

std::array<f32, 4096> buildSignalToLinearTable() {
	std::array<f32, 4096> table{};
	for (i32 i = 0; i < 4096; i += 1) {
		const f32 c = static_cast<f32>(i) / kSignalToLinearTableScale;
		table[static_cast<size_t>(i)] = c <= 0.04045f
			? c / 12.92f
			: std::pow((c + 0.055f) / 1.055f, 2.4f);
	}
	return table;
}

const std::array<f32, 4096> kLinearToSignalTable = buildLinearToSignalTable();
const std::array<f32, 4096> kSignalToLinearTable = buildSignalToLinearTable();

inline f32 tableLookup(const std::array<f32, 4096>& table, f32 value, f32 scale) {
	const f32 clamped = clamp(value, 0.0f, 1.0f);
	return table[static_cast<size_t>(clamped * scale + 0.5f)];
}

inline f32 linearToSignal(const std::array<f32, 4096>& table, f32 c) {
	return tableLookup(table, c, kLinearToSignalTableScale);
}

inline f32 signalToLinear(const std::array<f32, 4096>& table, f32 c) {
	return tableLookup(table, c, kSignalToLinearTableScale);
}

inline f32 bayer4x4_0_1(i32 x, i32 y) {
	static constexpr f32 bayer[16] = {
		0.0f,  8.0f,  2.0f, 10.0f,
		12.0f, 4.0f, 14.0f, 6.0f,
		3.0f, 11.0f, 1.0f,  9.0f,
		15.0f, 7.0f, 13.0f, 5.0f,
	};
	return (bayer[(x & 3) + ((y & 3) << 2)] + 0.5f) * (1.0f / 16.0f);
}

inline i32 psxDitherOffset4x4(i32 x, i32 y) {
	static constexpr i32 dither[16] = {
		-4,  0, -3,  1,
			2, -2,  3, -1,
		-3,  1, -4,  0,
			3, -1,  2, -2,
	};
	return dither[(x & 3) + ((y & 3) << 2)];
}

inline f32 quantizeOrderedConditional(f32 c, f32 levels, f32 threshold) {
	const f32 v = c * levels;
	const f32 q = static_cast<f32>(static_cast<i32>(v));
	const f32 f = v - q;
	return (q + (f >= threshold ? 1.0f : 0.0f)) / levels;
}

inline f32 quantizeRgb555PSX(f32 c, i32 ditherOffset) {
	const f32 v = (c * 255.0f + static_cast<f32>(ditherOffset)) * 0.125f;
	return static_cast<f32>(static_cast<i32>(v)) / 31.0f;
}

inline u8 byteFromLinear(f32 c) {
	const f32 v = clamp(c, 0.0f, 1.0f) * 255.0f;
	return static_cast<u8>(v);
}

void renderDeviceQuantizeSoftware(SoftwareBackend& backend, const DeviceQuantizePipelineState& state) {
	auto* colorTex = static_cast<SoftwareTexture*>(state.colorTex);
	const u32* src = colorTex->data.data();
	u32* dst = backend.framebuffer();
	const i32 srcWidth = colorTex->width;
	const i32 dstWidth = backend.width();
	const i32 dstHeight = backend.height();
	const i32 dstPixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));

	const auto& linearToSignalLut = kLinearToSignalTable;
	const auto& signalToLinearLut = kSignalToLinearTable;

	for (i32 y = 0; y < dstHeight; y += 1) {
		const i32 sy = y * colorTex->height / dstHeight;
		const u32* srcRow = src + static_cast<size_t>(sy) * static_cast<size_t>(srcWidth);
		u32* dstRow = dst + static_cast<size_t>(y) * static_cast<size_t>(dstPixelsPerRow);
		for (i32 x = 0; x < dstWidth; x += 1) {
			const i32 sx = x * srcWidth / dstWidth;
			const u32 pixel = srcRow[sx];
			const f32 signalR = linearToSignal(linearToSignalLut, static_cast<f32>((pixel >> 16) & 0xffu) * (1.0f / 255.0f));
			const f32 signalG = linearToSignal(linearToSignalLut, static_cast<f32>((pixel >> 8) & 0xffu) * (1.0f / 255.0f));
			const f32 signalB = linearToSignal(linearToSignalLut, static_cast<f32>(pixel & 0xffu) * (1.0f / 255.0f));
			f32 outR = signalR;
			f32 outG = signalG;
			f32 outB = signalB;
			if (state.ditherType == 1) {
				const i32 off = psxDitherOffset4x4(sx, sy);
				outR = quantizeRgb555PSX(signalR, off);
				outG = quantizeRgb555PSX(signalG, off);
				outB = quantizeRgb555PSX(signalB, off);
			} else if (state.ditherType == 2) {
				outR = quantizeOrderedConditional(signalR, 127.0f, bayer4x4_0_1(sx, sy));
				outG = quantizeOrderedConditional(signalG, 127.0f, bayer4x4_0_1(sx + 1, sy + 2));
				outB = quantizeOrderedConditional(signalB, 127.0f, bayer4x4_0_1(sx + 2, sy + 1));
			} else if (state.ditherType == 3) {
				const f32 threshold = bayer4x4_0_1(sx, sy);
				outR = quantizeOrderedConditional(signalR, 7.0f, threshold);
				outG = quantizeOrderedConditional(signalG, 15.0f, threshold);
				outB = quantizeOrderedConditional(signalB, 7.0f, threshold);
			}
			dstRow[x] = (0xffu << 24)
				| (static_cast<u32>(byteFromLinear(signalToLinear(signalToLinearLut, outR))) << 16)
				| (static_cast<u32>(byteFromLinear(signalToLinear(signalToLinearLut, outG))) << 8)
				| static_cast<u32>(byteFromLinear(signalToLinear(signalToLinearLut, outB)));
		}
	}
}

} // namespace

void registerPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "device_quantize";
	desc.name = "DeviceQuantize";
	setDeviceQuantizeGraph(desc);
	desc.shouldExecute = shouldExecuteDeviceQuantizePass;
	desc.exec = executeStateRenderPass<
		SoftwareBackend,
		DeviceQuantizePipelineState,
		&RenderPassStateStorage::deviceQuantize,
		renderDeviceQuantizeSoftware>;
	registry.registerPass(desc);
}

} // namespace Software
} // namespace DeviceQuantizePipeline
} // namespace bmsx
