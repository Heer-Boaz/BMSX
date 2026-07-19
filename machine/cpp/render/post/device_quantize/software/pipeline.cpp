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
constexpr u32 kQuantizeInputCount = 256u;
constexpr u32 kBayerThresholdCount = 16u;

constexpr std::array<u8, 16> kBayer4x4{{
	0u,  8u,  2u, 10u,
	12u, 4u, 14u,  6u,
	3u, 11u,  1u,  9u,
	15u, 7u, 13u,  5u,
}};

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

inline u8 byteFromLinear(f32 c) {
	const f32 v = clamp(c, 0.0f, 1.0f) * 255.0f;
	return static_cast<u8>(v);
}

using QuantizeTable = std::array<u8, kBayerThresholdCount * kQuantizeInputCount>;

QuantizeTable buildQuantizeTable(f32 levels) {
	QuantizeTable table{};
	for (u32 thresholdIndex = 0u; thresholdIndex < kBayerThresholdCount; thresholdIndex += 1u) {
		const f32 threshold = (static_cast<f32>(thresholdIndex) + 0.5f) * (1.0f / 16.0f);
		for (u32 signalByte = 0u; signalByte < kQuantizeInputCount; signalByte += 1u) {
			const f32 signal = linearToSignal(
				kLinearToSignalTable,
				static_cast<f32>(signalByte) * (1.0f / 255.0f));
			const f32 value = signal * levels;
			const f32 bucket = static_cast<f32>(static_cast<i32>(value));
			const f32 quantized = (bucket + (value - bucket >= threshold ? 1.0f : 0.0f)) / levels;
			table[thresholdIndex * kQuantizeInputCount + signalByte] = byteFromLinear(
				signalToLinear(kSignalToLinearTable, quantized));
		}
	}
	return table;
}

const QuantizeTable kQuantize7 = buildQuantizeTable(7.0f);
const QuantizeTable kQuantize15 = buildQuantizeTable(15.0f);
const QuantizeTable kQuantize31 = buildQuantizeTable(31.0f);
const QuantizeTable kQuantize63 = buildQuantizeTable(63.0f);

const std::array<const QuantizeTable*, 2> kRedTableByActiveMode{{
	&kQuantize31,
	&kQuantize7,
}};

const std::array<const QuantizeTable*, 2> kGreenTableByActiveMode{{
	&kQuantize63,
	&kQuantize15,
}};

void renderDeviceQuantizeSoftware(SoftwareBackend& backend, const DeviceQuantizePipelineState& state) {
	auto* colorTex = static_cast<SoftwareTexture*>(state.colorTex);
	const u32* src = colorTex->data.data();
	u32* dst = backend.framebuffer();
	const i32 srcWidth = colorTex->width;
	const i32 dstWidth = backend.width();
	const i32 dstHeight = backend.height();
	const i32 dstPixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));

	const u32 activeModeIndex = static_cast<u32>(state.deviceQuantizeMode) - static_cast<u32>(DeviceQuantizeMode::Rgb565);
	const QuantizeTable& redBlueTable = *kRedTableByActiveMode[activeModeIndex];
	const QuantizeTable& greenTable = *kGreenTableByActiveMode[activeModeIndex];
	const i32 sourceXStep = srcWidth / dstWidth;
	const i32 sourceXRemainder = srcWidth % dstWidth;
	const i32 sourceYStep = colorTex->height / dstHeight;
	const i32 sourceYRemainder = colorTex->height % dstHeight;
	i32 sourceY = 0;
	i32 sourceYError = 0;

	for (i32 y = 0; y < dstHeight; y += 1) {
		const u32* srcRow = src + static_cast<size_t>(sourceY) * static_cast<size_t>(srcWidth);
		u32* dstRow = dst + static_cast<size_t>(y) * static_cast<size_t>(dstPixelsPerRow);
		const u32 bayerRowOffset = static_cast<u32>(sourceY & 3) << 2u;
		i32 sourceX = 0;
		i32 sourceXError = 0;
		for (i32 x = 0; x < dstWidth; x += 1) {
			const u32 pixel = srcRow[sourceX];
			const u32 bayerIndex = static_cast<u32>(sourceX & 3) | bayerRowOffset;
			const u32 tableOffset = static_cast<u32>(kBayer4x4[bayerIndex]) << 8u;
			const u32 red = redBlueTable[tableOffset + ((pixel >> 16u) & 0xffu)];
			const u32 green = greenTable[tableOffset + ((pixel >> 8u) & 0xffu)];
			const u32 blue = redBlueTable[tableOffset + (pixel & 0xffu)];
			dstRow[x] = (0xffu << 24)
				| (red << 16u)
				| (green << 8u)
				| blue;
			sourceX += sourceXStep;
			sourceXError += sourceXRemainder;
			if (sourceXError >= dstWidth) {
				sourceXError -= dstWidth;
				sourceX += 1;
			}
		}
		sourceY += sourceYStep;
		sourceYError += sourceYRemainder;
		if (sourceYError >= dstHeight) {
			sourceYError -= dstHeight;
			sourceY += 1;
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
