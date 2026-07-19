/*
 * pipeline.cpp - Software device quantize post pass
 */

#include "pipeline.h"

#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/post/device_quantize/lut.h"

namespace bmsx {
namespace DeviceQuantizePipeline {
namespace Software {
namespace {

void renderDeviceQuantizeSoftware(SoftwareBackend& backend, const DeviceQuantizePipelineState& state) {
	auto* colorTex = static_cast<SoftwareTexture*>(state.colorTex);
	const u32* src = colorTex->data.data();
	u32* dst = backend.framebuffer();
	const i32 width = state.width;
	const i32 height = state.height;
	const i32 dstPixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	const DeviceQuantizeChannelLut& redBlueLut = state.luts->redBlue;
	const DeviceQuantizeChannelLut& greenLut = state.luts->green;

	for (i32 y = 0; y < height; y += 1) {
		const u32* srcRow = src + static_cast<size_t>(y) * static_cast<size_t>(width);
		u32* dstRow = dst + static_cast<size_t>(y) * static_cast<size_t>(dstPixelsPerRow);
		const u32 bayerRowOffset = static_cast<u32>(y & 3) << 2u;
		for (i32 x = 0; x < width; x += 1) {
			const u32 pixel = srcRow[x];
			const u32 bayerIndex = static_cast<u32>(x & 3) | bayerRowOffset;
			const u32 tableOffset = static_cast<u32>(DEVICE_QUANTIZE_BAYER_4X4[bayerIndex]) << 8u;
			const u32 red = redBlueLut[tableOffset | ((pixel >> 16u) & 0xffu)];
			const u32 green = greenLut[tableOffset | ((pixel >> 8u) & 0xffu)];
			const u32 blue = redBlueLut[tableOffset | (pixel & 0xffu)];
			dstRow[x] = 0xff000000u
				| (red << 16u)
				| (green << 8u)
				| blue;
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
